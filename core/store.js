// core/store.js
// THE single public storage entry point (facade). Features and UI call typed,
// domain-named methods here and never touch an engine or a raw key. The engines
// are private behind this — `StorageIO` (tiny synchronous config) today, plus an
// IndexedDB engine (`core/idb.js`) for the bulk tiers in a later increment. This
// is the exact mirror of "the Matrix SDK lives only in transport/": once the
// `check-storage` guard lands, `localStorage`/`indexedDB`/`StorageIO`/`IDB` may
// not be referenced anywhere but the storage layer. (Spec: 09 §1; CLAUDE.md
// "Storage boundary".)
//
// INCREMENT 1 — pure indirection. Every domain below currently routes to the
// existing engine (StorageIO/localStorage), so behavior is unchanged. The point
// of the facade is that later increments can move a domain's engine (events,
// chat, queues, blobs, logs → IndexedDB) WITHOUT changing this public surface or
// any caller. Tier intent is annotated per domain.
//
// Depends on: StorageIO + IDB (engines). No upward deps.

const Store = (() => {

  // Is the bulk tier (IndexedDB) actually available? Shared by the IDB-backed
  // domains and by durability.supported(). Defensive: false if the engine isn't
  // loaded (headless guards) or the browser lacks IndexedDB.
  function _idbOk() {
    try { return typeof IDB !== "undefined" && IDB.supported(); }
    catch (e) { return false; }
  }
  // localStorage read via the sync engine, for the no-IDB fallback and for the
  // one-time read-through migration of data written before the IDB move.
  function _legacyLoad(key) { try { return StorageIO.load(key); } catch (e) { return null; } }

  // --- config (bootstrap tier — stays localStorage) -----------------------
  // Small, synchronous values that are fine in localStorage by the tier rules
  // (09 §2): the room-list cache (a fallback; Room.scanDDJPRooms reads live
  // Matrix state) and the interrupted-creation pointer. These do NOT move to IDB.
  const config = {
    saveRoom(room)        { return StorageIO.saveRoom(room); },
    loadRooms()           { return StorageIO.loadRooms(); },
    savePendingCreate(r)  { return StorageIO.savePendingCreate(r); },
    loadPendingCreate()   { return StorageIO.loadPendingCreate(); },
    clearPendingCreate()  { return StorageIO.clearPendingCreate(); },
  };

  // --- logs (per-room ring — now IndexedDB, 09 §5.7) ---------------------
  // The persisted log lines. Now in IndexedDB (under the persistence umbrella),
  // with a localStorage fallback when IDB is unavailable and a one-time
  // read-through migration of the old "log" key. Async: load() returns a Promise;
  // persist() is write-through (fire-and-forget). Stored as one capped array
  // record today (the caller caps it); a per-entry ring can come later.
  const logs = {
    load() {
      if (_idbOk()) {
        const key = IDB.keyFor(null, "logs", "main");
        return IDB.get("kv", key).then((v) => {
          if (v != null) return v;
          const legacy = _legacyLoad("log");
          if (legacy != null) IDB.set("kv", key, legacy).catch(() => {});   // migrate once
          return legacy;
        }).catch(() => _legacyLoad("log"));
      }
      return Promise.resolve(_legacyLoad("log"));
    },
    persist(arr) {
      if (_idbOk()) IDB.set("kv", IDB.keyFor(null, "logs", "main"), arr).catch(() => {});
      else StorageIO.save("log", arr);
    },
  };

  // --- queue (per-room user queue — now IndexedDB; sanctioned law change) --
  // The personal song stack + auto-feed flag for a room. Moved from localStorage
  // (`uq_<spaceId>`) to IndexedDB behind these methods — the deliberate CLAUDE.md
  // rule change (08 §10 #1 / 09 §8 #1). This is must-survive local truth, so it
  // now lives under the persistence umbrella and off the shared ~5 MB localStorage
  // cap (a large list could blow it). load() is async; persist() is write-through.
  // A localStorage fallback + one-time read-through migration keep existing stacks.
  const queue = {
    load(spaceId) {
      if (!spaceId) return Promise.resolve(null);
      const legacyKey = "uq_" + spaceId;
      if (_idbOk()) {
        const key = IDB.keyFor({ room: spaceId }, "queue", "stack");
        return IDB.get("kv", key).then((v) => {
          if (v != null) return v;
          const legacy = _legacyLoad(legacyKey);
          if (legacy != null) IDB.set("kv", key, legacy).catch(() => {});   // migrate once
          return legacy;
        }).catch(() => _legacyLoad(legacyKey));
      }
      return Promise.resolve(_legacyLoad(legacyKey));
    },
    persist(spaceId, rec) {
      if (!spaceId) return;
      if (_idbOk()) IDB.set("kv", IDB.keyFor({ room: spaceId }, "queue", "stack"), rec).catch(() => {});
      else StorageIO.save("uq_" + spaceId, rec);
    },
    clear(spaceId) {
      if (!spaceId) return;
      if (_idbOk()) IDB.del("kv", IDB.keyFor({ room: spaceId }, "queue", "stack")).catch(() => {});
      else StorageIO.remove("uq_" + spaceId);
    },
  };

  // --- background (per-room URL-keyed blob cache — IndexedDB, 09 §5.4) ----
  // The room's background image, cached as bytes. Classified CACHE, never truth:
  // the room SETTING carries the link; this holds the BLOB plus the URL it was
  // fetched from. A single slot per room ("current"). Refetch is triggered by the
  // two diverging (cached url ≠ setting url) — the caller compares, never assumes.
  // Lives in the `blobs` store (binary), unlike the JSON domains above which use
  // `kv`. No window (one slot); evict = clear the slot. No localStorage fallback:
  // blobs don't belong in the synchronous tier, so with no IDB this is a RAM-only
  // no-op (load null / persist drop) and the UI simply shows no background.
  const background = {
    load(spaceId) {
      if (!spaceId || !_idbOk()) return Promise.resolve(null);
      const key = IDB.keyFor({ room: spaceId }, "background", "current");
      return IDB.get("blobs", key).then((v) => (v && v.url && v.blob) ? v : null).catch(() => null);
    },
    persist(spaceId, url, blob) {
      if (!spaceId || !url || !blob || !_idbOk()) return Promise.resolve(false);
      const key = IDB.keyFor({ room: spaceId }, "background", "current");
      return IDB.set("blobs", key, { url: String(url), blob: blob }).then(() => true).catch(() => false);
    },
    clear(spaceId) {
      if (!spaceId || !_idbOk()) return Promise.resolve();
      const key = IDB.keyFor({ room: spaceId }, "background", "current");
      return IDB.del("blobs", key).catch(() => {});
    },
  };

  // --- images (user-global bounded thumbnail cache — IndexedDB blobs, 14 §3) ----
  // Downscaled video thumbnails keyed by videoId, classified CACHE (never truth —
  // the videoId regenerates it). USER-GLOBAL (u) scope: a thumbnail is identical in
  // every room and playlist, so one fetch serves the whole account. BOUNDED to
  // IMG_CACHE_CAP entries, LRU-evicted via the pure indexUpsertEvict/evictionPlan,
  // so it can never grow without limit — it is the storage governor for thumbnails
  // (09). A tiny index in `kv` holds {order,size} per id so eviction reads one small
  // record, never the blobs. order is a session counter seeded above the persisted
  // max (so LRU stays monotonic across reloads without touching a clock — the clock
  // lives only in transport). With no IDB this is a no-op (load null / persist drop)
  // and rows simply show no thumbnail.
  const IMG_CACHE_CAP = 300;   // tune freely; downscaled thumbs are ~1–2 KB each
  let _imgSeq = 0, _imgSeqReady = false;
  function _imgIndexKey() { return IDB.keyFor(null, "img", "_index"); }
  function _imgBlobKey(videoId) { return IDB.keyFor(null, "img", String(videoId)); }
  function _imgLoadIndex() {
    return IDB.get("kv", _imgIndexKey()).then((v) => (v && typeof v === "object") ? v : {}).catch(() => ({}));
  }
  function _imgSeedSeq(ix) {                 // continue the LRU counter above prior sessions
    if (_imgSeqReady) return;
    let mx = 0; for (const k in ix) if (ix[k] && ix[k].order > mx) mx = ix[k].order;
    if (mx > _imgSeq) _imgSeq = mx;
    _imgSeqReady = true;
  }
  const images = {
    // Cached thumbnail blob for a videoId, or null. Touches LRU order (the touch
    // write is fire-and-forget — a read never blocks on it).
    load(videoId) {
      if (!videoId || !_idbOk()) return Promise.resolve(null);
      return IDB.get("blobs", _imgBlobKey(videoId)).then((v) => {
        if (!v || !v.blob) return null;
        images._touch(String(videoId));
        return v.blob;
      }).catch(() => null);
    },
    has(videoId) {
      if (!videoId || !_idbOk()) return Promise.resolve(false);
      return IDB.get("blobs", _imgBlobKey(videoId)).then((v) => !!(v && v.blob)).catch(() => false);
    },
    // Store a (downscaled) thumbnail and evict the oldest over the cap.
    persist(videoId, blob) {
      if (!videoId || !blob || !_idbOk()) return Promise.resolve(false);
      const id = String(videoId);
      const size = (blob && typeof blob.size === "number") ? blob.size : 0;
      return IDB.set("blobs", _imgBlobKey(id), { blob: blob, size: size })
        .then(() => _imgLoadIndex())
        .then((ix) => {
          _imgSeedSeq(ix);
          const r = IDB.indexUpsertEvict(ix, id, { order: ++_imgSeq, size: size }, IMG_CACHE_CAP);
          return Promise.all(r.evicted.map((k) => IDB.del("blobs", _imgBlobKey(k))))
            .then(() => IDB.set("kv", _imgIndexKey(), r.index));
        })
        .then(() => true).catch(() => false);
    },
    _touch(id) {
      _imgLoadIndex().then((ix) => {
        if (!ix[id]) return;
        _imgSeedSeq(ix);
        ix[id].order = ++_imgSeq;
        return IDB.set("kv", _imgIndexKey(), ix);
      }).catch(() => {});
    },
    clear() {
      if (!_idbOk()) return Promise.resolve();
      const prefix = IDB.keyFor(null, "img", "");
      return IDB.keys("blobs").then((ks) => {
        const mine = (ks || []).filter((k) => typeof k === "string" && k.indexOf(prefix) === 0);
        return Promise.all(mine.map((k) => IDB.del("blobs", k)));
      }).then(() => IDB.del("kv", _imgIndexKey())).catch(() => {});
    },
  };

  // --- meta (user-global per-video metadata CACHE — title/duration/geo, 14 §2) --
  // Regenerable display metadata for a videoId. CACHE, never truth — the videoId
  // regenerates all of it. USER-GLOBAL (u): a video's title/length don't change
  // between rooms, so one fetch serves the whole account. JSON in `kv` (thumbnail
  // BYTES live in Store.images). No localStorage fallback — with no IDB this is a
  // no-op and rows show ids/no metadata. The freshness rules (title/duration
  // permanent, geo TTL'd) live in MetadataService; this is dumb storage.
  const meta = {
    load(videoId) {
      if (!videoId || !_idbOk()) return Promise.resolve(null);
      return IDB.get("kv", IDB.keyFor(null, "meta", String(videoId))).then((v) => v || null).catch(() => null);
    },
    persist(videoId, rec) {
      if (!videoId || !rec || !_idbOk()) return Promise.resolve(false);
      return IDB.set("kv", IDB.keyFor(null, "meta", String(videoId)), rec).then(() => true).catch(() => false);
    },
    clear(videoId) {
      if (!videoId || !_idbOk()) return Promise.resolve();
      return IDB.del("kv", IDB.keyFor(null, "meta", String(videoId))).catch(() => {});
    },
  };

  // --- playlists (user-global, stored, portable — TRUTH, 14 §1a) ----------
  // Named song lists usable in any room. USER-GLOBAL (u) scope. ONE IDB record per
  // playlist (`u:playlists:<id>` -> { id, name, createdAt, tracks:[{videoId,...}] })
  // plus one small index record (`u:playlists:_index` -> { order:[id...], names:{} }),
  // so editing a big list never rewrites the others. This is LOCAL TRUTH, not cache:
  // it NEVER auto-evicts — it sheds only by explicit remove()/clear() (storage law).
  // Async, mirroring Store.queue; the gen-token/dirty-flag hydrate that protects
  // in-RAM edits lives in the FEATURE (features/playlists.js, P2), exactly as
  // userqueue.js owns it over Store.queue — Store here is dumb async I/O. All the
  // testable decisions (index transforms, import/export, dedup, disambiguation) are
  // pure in PlaylistDoc and guarded there; these bodies are review-only browser/IDB.
  // No localStorage fallback — with no IDB this is a no-op (load -> empty/null,
  // persist -> false) and the panel simply shows no playlists.
  function _plIndexKey()   { return IDB.keyFor(null, "playlists", "_index"); }
  function _plRecKey(id)   { return IDB.keyFor(null, "playlists", String(id)); }
  const playlists = {
    loadIndex() {
      if (!_idbOk()) return Promise.resolve(PlaylistDoc.emptyIndex());
      return IDB.get("kv", _plIndexKey())
        .then((v) => (v && Array.isArray(v.order)) ? v : PlaylistDoc.emptyIndex())
        .catch(() => PlaylistDoc.emptyIndex());
    },
    loadOne(id) {
      if (!id || !_idbOk()) return Promise.resolve(null);
      return IDB.get("kv", _plRecKey(id)).then((v) => v || null).catch(() => null);
    },
    // Write the record, then upsert its header into the index (new id appends; an
    // existing id refreshes its name — the rename path). Non-evicting.
    persist(playlist) {
      if (!playlist || !playlist.id || !_idbOk()) return Promise.resolve(false);
      return IDB.set("kv", _plRecKey(playlist.id), playlist)
        .then(() => this.loadIndex())
        .then((ix) => IDB.set("kv", _plIndexKey(), PlaylistDoc.indexUpsert(ix, playlist)))
        .then(() => true).catch(() => false);
    },
    remove(id) {
      if (!id || !_idbOk()) return Promise.resolve(false);
      return IDB.del("kv", _plRecKey(id))
        .then(() => this.loadIndex())
        .then((ix) => IDB.set("kv", _plIndexKey(), PlaylistDoc.indexRemove(ix, id)))
        .then(() => true).catch(() => false);
    },
    // Persist a new playlist ORDER (index-only). orderIds must be a permutation of the
    // current ids; a non-permutation is ignored by PlaylistDoc.indexReorder.
    reorder(orderIds) {
      if (!_idbOk()) return Promise.resolve(false);
      return this.loadIndex()
        .then((ix) => IDB.set("kv", _plIndexKey(), PlaylistDoc.indexReorder(ix, orderIds)))
        .then(() => true).catch(() => false);
    },
    clear() {
      if (!_idbOk()) return Promise.resolve();
      const prefix = IDB.keyFor(null, "playlists", "");
      return IDB.keys("kv").then((ks) => {
        const mine = (ks || []).filter((k) => typeof k === "string" && k.indexOf(prefix) === 0);
        return Promise.all(mine.map((k) => IDB.del("kv", k)));
      }).catch(() => {});
    },
  };

  // --- durability (engine health + persistence; the facade owns §10) -------
  // The bulk tier (IndexedDB) is best-effort by default — the browser may evict
  // it under storage pressure. We ask the browser to keep it, and we classify the
  // resulting mode so the app can surface a warning instead of silently running
  // without durable storage. The browser calls are review-only; the CLASSIFY
  // policy is pure and guarded.

  // Pure: given engine support + whether the browser granted persistence, return
  // the storage mode, whether data is durable across reloads, and whether to warn.
  function _durabilityMode(idbSupported, persisted) {
    if (!idbSupported)
      return { mode: "ram-only", durable: false, warn: true,
               reason: "IndexedDB unavailable — running without cross-reload persistence" };
    if (!persisted)
      return { mode: "idb-best-effort", durable: true, warn: true,
               reason: "persistent storage not granted — data may be evicted under storage pressure" };
    return { mode: "idb-persisted", durable: true, warn: false, reason: "" };
  }

  function _nav() { try { return (typeof navigator !== "undefined" && navigator.storage) ? navigator.storage : null; } catch (e) { return null; } }

  const durability = {
    classify: _durabilityMode,                 // pure (guarded + reusable)
    supported() { return _idbOk(); },
    async persisted() { const s = _nav(); try { return s && s.persisted ? await s.persisted() : false; } catch (e) { return false; } },
    async request()   { const s = _nav(); try { return s && s.persist   ? await s.persist()   : false; } catch (e) { return false; } },
    async estimate()  { const s = _nav(); try { const e = s && s.estimate ? await s.estimate() : null; return { usage: (e && e.usage) || 0, quota: (e && e.quota) || 0 }; } catch (e) { return { usage: 0, quota: 0 }; } },
    // One startup call: request persistence if not already granted, then report
    // the resolved mode + space estimate. Never throws; safe with no browser APIs.
    async lockIn() {
      const idb = this.supported();
      let persisted = false;
      if (idb) { persisted = await this.persisted(); if (!persisted) persisted = await this.request(); }
      const est = await this.estimate();
      return Object.assign(_durabilityMode(idb, persisted), { persisted, usage: est.usage, quota: est.quota });
    },
  };

  // --- chat display prefs (per-user device config — localStorage tier) ----
  // Small per-user UI prefs: whether chat renders inline images / clickable links
  // and the host allowlists for each. This is DEVICE-LOCAL CONFIG (host strings +
  // booleans) — never any message text — so it stays in the synchronous bootstrap
  // tier and is namespaced per user by StorageIO. It does NOT touch the RAM-only
  // chat-content rule (no decrypted body or image URL from chat is stored here).
  // load() is synchronous (returns the object or null); save() is write-through.
  const prefs = {
    load()    { return StorageIO.load("chatprefs"); },
    save(obj) { StorageIO.save("chatprefs", obj); },
  };

  // --- account (multi-account storage isolation) --------------------------
  // Selecting the active user namespaces BOTH engines so every domain above
  // (config/logs/queue/events) reads and writes that user's isolated storage.
  // This is the only place the engines are told which user is active — callers
  // (transport/bootstrap) go through here.
  const account = {
    async setUser(userId) {
      if (!userId) return;
      StorageIO.setNamespace(userId);
      if (_idbOk()) IDB.setNamespace(userId);
    },
    // "Forget account": drop this user's local storage entirely (auth is handled
    // separately in transport). Safe to call whether or not it's the active user.
    async forgetUser(userId) {
      if (!userId) return;
      try { StorageIO.clearNamespace(userId); } catch (e) {}
      if (_idbOk()) { try { await IDB.deleteNamespace(userId); } catch (e) {} }
    },
  };

  return { config, logs, queue, background, images, meta, playlists, durability, account, prefs };
})();
