// core/eventcache.js
// Stores full original raw events keyed by eventId.
// No other module writes here. MatrixBridge writes, voucher layer reads later.
// No dependencies.

const EventCache = (() => {
  const PREFIX = "ddjp_evt_";

  function store(raw) {
    if (!raw || !raw.event_id) return;
    try {
      localStorage.setItem(PREFIX + raw.event_id, JSON.stringify(raw));
    } catch (e) {
      console.warn("EventCache.store failed:", raw.event_id, e);
    }
  }

  function get(eventId) {
    try {
      const val = localStorage.getItem(PREFIX + eventId);
      if (val === null) return null;
      return JSON.parse(val);
    } catch (e) {
      console.warn("EventCache.get failed:", eventId, e);
      return null;
    }
  }

  function has(eventId) {
    try {
      return localStorage.getItem(PREFIX + eventId) !== null;
    } catch (e) {
      return false;
    }
  }

  return { store, get, has };
})();
