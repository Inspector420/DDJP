// core/storageio.js
// Local persistence. No dependencies.

const StorageIO = (() => {
  const SCHEMA_VERSION = 1;
  const VERSION_KEY = "ddjp_schema_version";

  // --- per-user key namespacing (multi-account isolation) -----------------
  // App data (room-list cache, pending-create, logs, queues) is prefixed with the
  // active Matrix user id, so two accounts on the same browser keep separate,
  // non-clobbering storage and re-link to the right data on re-login. Set via
  // setNamespace (from Store.setUser only). Auth/registry keys (session blobs,
  // the account registry, the schema marker, SSO-pending) are deliberately GLOBAL
  // and never prefixed — they're managed in transport and excluded from migration.
  let _ns = "";
  function prefixFor(ns) { return ns ? ("ddjp_" + ns + "_") : "ddjp_"; }   // pure
  function _p() { return prefixFor(_ns); }
  function setNamespace(userId) { _ns = userId || ""; }
  function currentNamespace() { return _ns; }

  function checkSchema() {
    try {
      const v = localStorage.getItem(VERSION_KEY);
      const current = v ? parseInt(v, 10) : 0;
      if (current < SCHEMA_VERSION) {
        migrate(current);
        localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
      }
    } catch (e) {}
  }

  function migrate(from) {
    // v0 → v1: no existing data to migrate
    // future migrations go here
  }

  // "Forget account": drop every key under a user's namespace.
  function clearNamespace(ns) {
    try {
      const pre = prefixFor(ns), kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) kill.push(k); }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  function save(key, value) {
    try {
      localStorage.setItem(_p() + key, JSON.stringify(value));
    } catch (e) {
      console.warn("StorageIO.save failed:", key, e);
    }
  }

  function load(key) {
    try {
      const val = localStorage.getItem(_p() + key);
      if (val === null) return null;
      return JSON.parse(val);
    } catch (e) {
      console.warn("StorageIO.load failed:", key, e);
      return null;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(_p() + key); }
    catch (e) { console.warn("StorageIO.remove failed:", key, e); }
  }

  function saveRoom(room) {
    const rooms = load("rooms") || [];
    const idx = rooms.findIndex(r => r.spaceId === room.spaceId);
    if (idx >= 0) rooms[idx] = room;
    else rooms.unshift(room);
    save("rooms", rooms.slice(0, 20));
  }

  function loadRooms() { return load("rooms") || []; }

  // Cross-reload resume of an interrupted room creation. A single pending record
  // { name, spaceId, channels } written when createDDJPSpace fails part way, so a
  // half-built room survives a page reload and can be finished. Cleared on
  // successful completion. (Kept tiny + bootstrap-style; will move behind the
  // future Store facade with the rest of local config — 09 §5.)
  function savePendingCreate(rec) { save("pending_create", rec); }
  function loadPendingCreate() { return load("pending_create"); }
  function clearPendingCreate() { remove("pending_create"); }

  checkSchema();
  return {
    save, load, remove, saveRoom, loadRooms, savePendingCreate, loadPendingCreate, clearPendingCreate,
    setNamespace, currentNamespace, prefixFor, clearNamespace,
  };
})();
