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
// Depends on: StorageIO (engine). No upward deps.

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

  return { config, logs, queue, durability };
})();
