// core/storageio.js
// Local persistence. No dependencies.

const StorageIO = (() => {
  const SCHEMA_VERSION = 1;
  const VERSION_KEY = "ddjp_schema_version";

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

  function save(key, value) {
    try {
      localStorage.setItem("ddjp_" + key, JSON.stringify(value));
    } catch (e) {
      console.warn("StorageIO.save failed:", key, e);
    }
  }

  function load(key) {
    try {
      const val = localStorage.getItem("ddjp_" + key);
      if (val === null) return null;
      return JSON.parse(val);
    } catch (e) {
      console.warn("StorageIO.load failed:", key, e);
      return null;
    }
  }

  function remove(key) {
    try { localStorage.removeItem("ddjp_" + key); }
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
  return { save, load, remove, saveRoom, loadRooms, savePendingCreate, loadPendingCreate, clearPendingCreate };
})();
