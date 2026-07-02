// core/eventcache.js
// The durable raw-events store — the VOUCHER SEAM (a copy of each Spine event's
// original content, kept so a redaction/edit can be refused by re-ingesting the
// original). MatrixBridge writes here; the redaction path reads here; the future
// voucher layer reads here too. No feature/ui module touches it (check-storage).
//
// Two representations (09 §5.1):
//   • a synchronous RAM map — the HOT read path. store/get/has are synchronous
//     and unchanged, so the redaction-restoration path (which reads inline during
//     ingest/replay) does not move.
//   • IndexedDB (via the private IDB engine) — DURABLE backing + fast-reload seed.
//     Writes are write-through (fire-and-forget); a refresh rehydrates the RAM
//     map from IDB via ensureLoaded() before replay needs it.
//
// This replaces the old localStorage backing, whose ~5 MB cap silently swallowed
// writes once full — which weakened redaction-refusal (an uncached original can't
// be restored). IndexedDB is roomy AND we now cap explicitly (oldest-first), so
// the recent, still-vulnerable tail is reliably retained. The real, consensus-
// driven bound is checkpoint retention (Phase 1b); CAP is the interim ceiling.
//
// Degradation (09 §10): if IndexedDB is unavailable (or the engine isn't loaded,
// e.g. a headless guard), EventCache runs RAM-only — durability is lost across
// reloads, but every synchronous operation still works and the app still runs.
//
// Depends on: IDB (engine, optional at runtime).

const EventCache = (() => {
  const STORE = "events";
  const CAP = 5000;            // generous interim ceiling (far beyond the old localStorage cap)

  const _mem = new Map();      // eventId -> raw  (the synchronous hot store, authoritative for reads)
  let _loadPromise = null;     // idempotent hydrate

  function _idbOk() {
    try { return typeof IDB !== "undefined" && IDB.supported(); }
    catch (e) { return false; }
  }

  // Enforce CAP on the RAM map (oldest by Lamport l first), and mirror the
  // evictions into IDB. Uses the engine's pure, guard-tested evictionPlan.
  function _evict() {
    if (_mem.size <= CAP) return;
    const entries = [];
    for (const [id, raw] of _mem) entries.push({ key: id, order: (raw && raw.l) || 0 });
    const drop = (typeof IDB !== "undefined" && IDB.evictionPlan) ? IDB.evictionPlan(entries, CAP) : [];
    for (const id of drop) {
      _mem.delete(id);
      if (_idbOk()) IDB.del(STORE, id).catch(() => {});
    }
  }

  function store(raw) {
    if (!raw || !raw.event_id) return;
    _mem.set(raw.event_id, raw);          // hot path: available to a restore decision immediately
    _evict();
    if (_idbOk()) {                       // durability: write-through, never blocks the caller
      try { IDB.set(STORE, raw.event_id, raw).catch((e) => console.warn("EventCache.store IDB:", raw.event_id, e)); }
      catch (e) { console.warn("EventCache.store failed:", raw.event_id, e); }
    }
  }

  function get(eventId) {
    return _mem.has(eventId) ? _mem.get(eventId) : null;
  }

  function has(eventId) {
    return _mem.has(eventId);
  }

  // Rehydrate the RAM map from IDB once, before replay relies on cached originals
  // to refuse redactions. Idempotent; resolves immediately (RAM-only) when there
  // is no IndexedDB. Awaited at the top of MatrixBridge.replayRoom.
  function ensureLoaded() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      if (!_idbOk()) return;              // RAM-only: nothing to rehydrate
      try {
        const all = await IDB.values(STORE);
        if (Array.isArray(all)) {
          for (const raw of all) if (raw && raw.event_id) _mem.set(raw.event_id, raw);
          _evict();                       // defensively re-enforce CAP after a bulk load
        }
      } catch (e) {
        console.warn("EventCache.ensureLoaded failed:", e);
      }
    })();
    return _loadPromise;
  }

  return { store, get, has, ensureLoaded };
})();
