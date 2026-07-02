// features/playlists.js
// The Playlists feature — thin glue over the pure core (PlaylistDoc) and the
// storage (Store.playlists). Holds the library INDEX ({order,names}) in RAM so the
// panel (P3) can bind to it and re-render on change; individual playlist RECORDS are
// loaded on demand (when you open one) and edited read-modify-write through Store.
// Every real DECISION lives in PlaylistDoc (pure, guarded) or is asserted here by
// check-playlists-feature; this module only sequences them.
//
// Clone-to-queue goes through the EXISTING submit path (UserQueue.add) — never a
// direct queue write — so a playlist song enters your personal stack exactly like a
// pasted link (same dedup, same auto-feed). videoId is the only truth; we hand
// UserQueue a canonical watch URL built from it.
//
// The gen-token/dirty-flag hydrate mirrors userqueue.js over Store.queue: a late
// async index load is DISCARDED if a newer init ran, if the user has edited, or if
// RAM already holds an index — so a slow load can't wipe a fresh edit.
//
// Depends on: PlaylistDoc, Store, UserQueue. No Matrix/DOM/SDK.

const Playlists = (() => {

  let _index = { order: [], names: {} };   // RAM mirror of the library index
  let _loadGen = 0;                          // bumped each init; a stale late hydrate is ignored
  let _dirty = false;                        // set on any edit; a late hydrate must not clobber it
  const _listeners = [];

  function _watchUrl(videoId) { return "https://www.youtube.com/watch?v=" + videoId; }
  function _newId() { return "pl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

  function _notify() {
    const snap = { order: _index.order.slice(), names: Object.assign({}, _index.names) };
    for (const fn of _listeners) { try { fn(snap); } catch (e) {} }
  }
  function onChange(fn) { if (fn && !_listeners.includes(fn)) _listeners.push(fn); }

  function init() {
    _index = { order: [], names: {} };
    _dirty = false;
    const gen = ++_loadGen;
    Promise.resolve(Store.playlists.loadIndex()).then((ix) => {
      // Apply ONLY if this is still the current init, the user hasn't edited, and
      // RAM is still empty — otherwise a slow load would wipe a fresh edit.
      if (gen !== _loadGen || _dirty || _index.order.length) return;
      if (ix && Array.isArray(ix.order)) { _index = { order: ix.order.slice(), names: Object.assign({}, ix.names) }; _notify(); }
    }).catch(() => {});
    _notify();
  }

  function destroy() { _index = { order: [], names: {} }; _dirty = false; }

  // --- library reads (sync, from RAM) ---
  function list() { return _index.order.map((id) => ({ id: id, name: _index.names[id] })); }
  function count() { return _index.order.length; }
  function get(id) { return Promise.resolve(Store.playlists.loadOne(id)); }   // open a playlist (full record)

  // --- library edits (async, write-through; touch the index -> set _dirty) ---
  async function create(name) {
    if (PlaylistDoc.atPlaylistCap(_index.order.length)) return { ok: false, reason: "max playlists reached" };
    const finalName = PlaylistDoc.disambiguateName(name, _index.order.map((id) => _index.names[id]));
    const pl = PlaylistDoc.makePlaylist(_newId(), finalName, [], Date.now());
    const okd = await Store.playlists.persist(pl);
    if (!okd) return { ok: false, reason: "storage unavailable" };
    _dirty = true;
    _index = PlaylistDoc.indexUpsert(_index, pl);
    _notify();
    return { ok: true, id: pl.id, name: pl.name };
  }

  async function rename(id, name) {
    if (_index.order.indexOf(id) < 0) return { ok: false, reason: "no such playlist" };
    const rec = await Store.playlists.loadOne(id);
    if (!rec) return { ok: false, reason: "unavailable" };
    // Disambiguate against OTHER lists' names (not this one's current name).
    const others = _index.order.filter((x) => x !== id).map((x) => _index.names[x]);
    rec.name = PlaylistDoc.disambiguateName(name, others);
    const okd = await Store.playlists.persist(rec);
    if (!okd) return { ok: false, reason: "storage unavailable" };
    _dirty = true;
    _index = PlaylistDoc.indexUpsert(_index, rec);
    _notify();
    return { ok: true, name: rec.name };
  }

  async function remove(id) {
    await Store.playlists.remove(id);
    _dirty = true;
    _index = PlaylistDoc.indexRemove(_index, id);
    _notify();
    return { ok: true };
  }

  async function reorder(orderIds) {
    await Store.playlists.reorder(orderIds);
    _dirty = true;
    _index = PlaylistDoc.indexReorder(_index, orderIds);
    _notify();
    return { ok: true };
  }

  // --- track edits (async, read-modify-write a record; don't touch the index) ---
  async function addTrack(id, videoId) {
    if (!PlaylistDoc.validId(videoId)) return { ok: false, reason: "not a valid video id" };
    const rec = await Store.playlists.loadOne(id);
    if (!rec) return { ok: false, reason: "no such playlist" };
    if (rec.tracks.some((t) => t.videoId === videoId)) return { ok: false, reason: "already in playlist" };
    if (PlaylistDoc.atTrackCap(rec.tracks.length)) return { ok: false, reason: "playlist is full" };
    rec.tracks.push({ videoId: videoId, source: "youtube" });
    const okd = await Store.playlists.persist(rec);
    return okd ? { ok: true } : { ok: false, reason: "storage unavailable" };
  }

  async function removeTrack(id, videoId) {
    const rec = await Store.playlists.loadOne(id);
    if (!rec) return { ok: false, reason: "no such playlist" };
    const before = rec.tracks.length;
    rec.tracks = rec.tracks.filter((t) => t.videoId !== videoId);
    if (rec.tracks.length === before) return { ok: false, reason: "not in playlist" };
    const okd = await Store.playlists.persist(rec);
    return okd ? { ok: true } : { ok: false, reason: "storage unavailable" };
  }

  // --- use a playlist: clone into your personal queue via the SUBMIT PATH ---
  // Single song: hand UserQueue a canonical watch URL (built from the only truth,
  // the videoId). UserQueue owns the dedup ("already queued") + the room submit.
  function cloneToQueue(videoId) {
    if (!PlaylistDoc.validId(videoId)) return { ok: false, reason: "not a valid video id" };
    return UserQueue.add(_watchUrl(videoId));
  }

  // Whole playlist: clone each track through the same path, tallying add vs skip
  // (skips = songs UserQueue already had) -> "added N, skipped M".
  async function addWholeToQueue(id) {
    const rec = await Store.playlists.loadOne(id);
    if (!rec) return { ok: false, reason: "no such playlist", added: 0, skipped: 0 };
    let added = 0, skipped = 0;
    for (const t of rec.tracks) {
      const r = cloneToQueue(t.videoId);
      if (r && r.ok) added++; else skipped++;
    }
    return { ok: true, added: added, skipped: skipped };
  }

  return {
    init, destroy, onChange,
    list, count, get,
    create, rename, remove, reorder,
    addTrack, removeTrack,
    cloneToQueue, addWholeToQueue,
  };
})();
