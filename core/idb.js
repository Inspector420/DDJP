// core/idb.js
// The private async IndexedDB engine — the bulk storage tier (09 §2). Owned by
// the storage layer: the `Store` facade and the core stores that need durable
// backing (EventCache, and later chat/queues/blobs/logs) call it. features/ and
// ui/ never touch it (enforced by check-storage).
//
// Browser-only. The thin DB calls are review-only, exactly like transport's SDK
// calls — they can't run under node. The DECISION logic (key/namespace building,
// bounded eviction) is pulled out as PURE functions so it can be guarded
// headlessly (check-idb), the same split transport uses for creationPlan /
// spineRestoreDecision.
//
// Degradation (09 §10): if IndexedDB is unavailable, supported() returns false
// and callers fall back to RAM-only — the app still runs, just without durability
// across reloads. No dependencies.

const IDB = (() => {
  const DB_NAME = "ddjp";
  const DB_VERSION = 1;
  const STORES = ["kv", "blobs", "events"];   // kv: JSON records; blobs: binary caches (later); events: raw Spine originals (EventCache)
  let _dbPromise = null;
  let _db = null;        // resolved connection (held so a namespace switch can close it)
  let _ns = null;        // per-user namespace (the Matrix user id), set via setNamespace

  function supported() {
    try { return typeof indexedDB !== "undefined" && indexedDB !== null; }
    catch (e) { return false; }
  }

  // ---- per-user database namespacing (multi-account isolation) -----------
  // Each Matrix user gets a SEPARATE physical database (`ddjp:@user:hs`), so two
  // accounts on the same browser never share or clobber each other's cached
  // state — and "forget account" is a single deleteDatabase. `keyFor`'s u/r:
  // scoping is unchanged: it still namespaces inside whichever user's DB is
  // active.

  // Pure: the physical DB name for a namespace (null = the legacy/global DB).
  function dbNameFor(ns) { return ns ? (DB_NAME + ":" + ns) : DB_NAME; }
  function currentNamespace() { return _ns; }

  // Select the active user's database. Resets the cached connection so the next
  // call opens the right DB. Called only from Store.setUser (storage boundary).
  function setNamespace(ns) {
    ns = ns || null;
    if (ns === _ns) return;
    _ns = ns;
    if (_db) { try { _db.close(); } catch (e) {} }
    _db = null;
    _dbPromise = null;
  }

  // ---- pure helpers (no IndexedDB; guard-tested) -------------------------

  // Namespaced key (09 §3): per-user ("u") or per-room ("r:<spaceId>"), then the
  // domain, then the id. Callers pass domain + id and (optionally) a room scope;
  // the engine owns the layout so no caller ever assembles a raw key.
  function keyFor(scope, domain, id) {
    const s = (scope && scope.room) ? ("r:" + scope.room) : "u";
    return s + ":" + String(domain) + ":" + String(id);
  }

  // Given existing entries [{ key, order }] and a numeric cap, return the keys to
  // EVICT (oldest first) so at most `cap` remain. `order` is any monotonic number
  // — insertion sequence, Lamport l, or ts. Reused by every bounded store
  // (events tail cap, logs ring, media/chat size caps). Pure and total.
  function evictionPlan(entries, cap) {
    if (!Array.isArray(entries) || typeof cap !== "number" || cap < 0) return [];
    if (entries.length <= cap) return [];
    const sorted = entries.slice().sort((a, b) => ((a && a.order) || 0) - ((b && b.order) || 0));
    return sorted.slice(0, entries.length - cap).map((e) => e && e.key).filter((k) => k != null);
  }

  // Pure: upsert one entry into an order-indexed map { key -> { order, ... } } and
  // evict the oldest by `order` down to `cap`. Returns the new index plus the keys
  // evicted. Backs the bounded image cache (14 §3) and any future order-indexed
  // bounded store: the caller writes the blob, then calls this to learn which old
  // blobs to delete. A just-upserted entry carries the newest order, so it is
  // never the one evicted. Pure and total (junk index -> treated as empty).
  function indexUpsertEvict(index, key, meta, cap) {
    const ix = Object.assign({}, (index && typeof index === "object") ? index : {});
    ix[String(key)] = meta;
    const entries = Object.keys(ix).map((k) => ({ key: k, order: (ix[k] && ix[k].order) || 0 }));
    const evicted = evictionPlan(entries, cap);
    for (const k of evicted) delete ix[k];
    return { index: ix, evicted: evicted };
  }

  // ---- thin async DB wrappers (review-only) ------------------------------

  // Open a specific database by name (used by _open for the active namespace).
  // Same schema for all of them.
  function _openNamed(name) {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(name, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Another tab holding an older version open (09 §10): don't force; the
      // upgrade completes when the other connection closes.
      req.onblocked = () => {};
    });
  }

  function _open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = _openNamed(dbNameFor(_ns)).then((db) => { _db = db; return db; });
    return _dbPromise;
  }

  // Run one request inside a transaction and resolve with its result.
  function _req(store, mode, make) {
    return _open().then((db) => new Promise((resolve, reject) => {
      let out;
      const tx = db.transaction(store, mode);
      const r = make(tx.objectStore(store));
      if (r) { r.onsuccess = () => { out = r.result; }; r.onerror = () => reject(r.error); }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function get(store, key)        { return _req(store, "readonly",  (os) => os.get(key)); }
  function set(store, key, value) { return _req(store, "readwrite", (os) => os.put(value, key)); }
  function del(store, key)        { return _req(store, "readwrite", (os) => os.delete(key)); }
  function keys(store)            { return _req(store, "readonly",  (os) => os.getAllKeys()); }
  function values(store)          { return _req(store, "readonly",  (os) => os.getAll()); }
  function clear(store)           { return _req(store, "readwrite", (os) => os.clear()); }

  // ---- multi-account teardown (review-only) ------------------------------

  // Permanently delete a user's database ("forget account"). Closes the active
  // connection first if it's the one being deleted.
  function deleteNamespace(ns) {
    return new Promise((resolve) => {
      if (!supported()) return resolve(false);
      if (ns === _ns) { if (_db) { try { _db.close(); } catch (e) {} } _db = null; _dbPromise = null; }
      let req;
      try { req = indexedDB.deleteDatabase(dbNameFor(ns)); }
      catch (e) { return resolve(false); }
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    });
  }

  return {
    supported, keyFor, evictionPlan, indexUpsertEvict, dbNameFor,   // pure / capability
    setNamespace, currentNamespace, deleteNamespace,   // multi-account
    get, set, del, keys, values, clear,        // async KV over a named store
    STORES,
  };
})();
