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

  function _watchUrl(videoId) { return PlaylistDoc.watchUrl(videoId); }
  function _newId() { return "pl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

  function _notify() {
    const snap = { order: _index.order.slice(), names: Object.assign({}, _index.names) };
    for (const fn of _listeners) { try { fn(snap); } catch (e) {} }
  }
  function onChange(fn) { if (fn && !_listeners.includes(fn)) _listeners.push(fn); }
  function offChange(fn) { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }

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

  // Add a song to a playlist FROM A LINK — the playlist analogue of UserQueue.add.
  // Accepts any YouTube URL form PlaylistDoc.extractVideoId groks (or a bare 11-char
  // id), resolves it to a videoId, then routes through addTrack so it inherits the
  // SAME validId / dedup / track-cap protections and the write-through persist.
  async function addTrackByUrl(id, url) {
    const raw = url == null ? "" : String(url).trim();
    const videoId = PlaylistDoc.extractVideoId(raw) || (PlaylistDoc.validId(raw) ? raw : null);
    if (!videoId) return { ok: false, reason: "not a YouTube link" };
    return addTrack(id, videoId);
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
    if (!PlaylistDoc.validId(videoId)) return { ok: false, code: "bad-id", reason: "not a valid video id" };
    // STILL THE ONLY ROUTE, and deliberately unchanged: a cloned song is handed to `UserQueue.add`
    // as a canonical watch URL so it behaves exactly like a pasted link — including inheriting the
    // room's replay cooldown, which is enforced there rather than being re-implemented per caller.
    return UserQueue.add(_watchUrl(videoId));
  }

  // Whole playlist: clone each track through the same path, tallying add vs skip
  // (skips = songs UserQueue already had) -> "added N, skipped M".
  // ── THE TALLY KEEPS ITS SHAPE AND GAINS A LIST ───────────────────────────────────────────────
  // `added` / `skipped` stay exactly as they were, because the panel renders them today. `refused`
  // is what a surface that wants to SAY WHY reads: one entry per song, carrying the code and the
  // detail `Room.canQueue` produced, unformatted. Written now rather than later so the information
  // is not thrown away at the only point in the flow where it exists.
  // Held by `check-repeat-cooldown` PART G, which drives BOTH playlist routes and asserts each
  // reaches `UserQueue.add` as a canonical watch URL — the claim the one-door argument rests on.
  async function addWholeToQueue(id) {
    const rec = await Store.playlists.loadOne(id);
    if (!rec) return { ok: false, reason: "no such playlist", added: 0, skipped: 0, refused: [] };
    let added = 0, skipped = 0;
    const refused = [];
    for (const t of rec.tracks) {
      const r = cloneToQueue(t.videoId);
      if (r && r.ok) { added++; continue; }
      skipped++;
      refused.push({ videoId: t.videoId, code: (r && r.code) || null,
                     reason: (r && r.reason) || null, detail: (r && r.detail) || null });
    }
    return { ok: true, added: added, skipped: skipped, refused: refused };
  }

  // --- 15: export / import a LIBRARY of playlists to/from a portable file ----------
  // All real shaping/validation is in PlaylistDoc (pure, guarded). This sequences the
  // async storage reads/writes and reports per-song progress so the UI can show an
  // accurate bar and a Cancel. Nothing here is consensus — playlists are local truth.

  function _yield() { return new Promise((r) => setTimeout(r, 0)); }

  // Blob -> compressed base64 data-URL (for embedding a cached thumbnail in the file).
  function _blobToDataUrl(blob) {
    return new Promise((resolve) => {
      try {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      } catch (e) { resolve(null); }
    });
  }
  // data-URL -> Blob (to persist an imported thumbnail into the cache). Local, no network.
  function _dataUrlToBlob(dataUrl) {
    try {
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return null;
      const mime = (dataUrl.slice(5, comma).split(";")[0]) || "image/webp";
      const bin = atob(dataUrl.slice(comma + 1));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) { return null; }
  }

  // One-time snapshot for the export overlay: every playlist's ids + a { vid: bytes }
  // map of cached thumbnail sizes (one kv read). The UI computes the live size estimate
  // purely from this as the checklist toggles — no per-toggle storage calls.
  async function exportPrepare() {
    const lists = [];
    for (const { id } of list()) {
      const rec = await get(id);
      if (rec) lists.push({ id: rec.id, name: rec.name, tracks: (rec.tracks || []).map((t) => ({ videoId: t.videoId })) });
    }
    let thumbSizes = {};
    try { thumbSizes = await Store.images.sizes(); } catch (e) { thumbSizes = {}; }
    return { lists: lists, thumbSizes: thumbSizes };
  }

  // Build the portable file object for the selected playlist ids. includeThumbs embeds
  // each cached thumbnail (~2 KB) as a data-URL. onProgress(done,total) per song;
  // isCancelled() aborts cleanly (no file emitted). Returns { ok, file } | { ok:false }.
  async function exportBuild(ids, opts) {
    opts = opts || {};
    const includeThumbs = opts.includeThumbs !== false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    const isCancelled = typeof opts.isCancelled === "function" ? opts.isCancelled : function () { return false; };

    const recs = [];
    for (const id of (Array.isArray(ids) ? ids : [])) { const r = await get(id); if (r) recs.push(r); }
    let total = 0; for (const r of recs) total += (r.tracks || []).length;
    let done = 0;

    const metaByVid = {};                 // videoId -> { title?, durationSec?, thumb? } (deduped)
    const seen = Object.create(null);
    const plainLists = [];
    for (const r of recs) {
      const tracks = [];
      for (const t of (r.tracks || [])) {
        if (isCancelled()) return { ok: false, reason: "cancelled" };
        const vid = t.videoId;
        tracks.push({ videoId: vid });
        if (!seen[vid]) {
          seen[vid] = 1;
          const m = {};
          try { const mrec = await Store.meta.load(vid); if (mrec) { if (mrec.title) m.title = mrec.title; if (mrec.durationSec) m.durationSec = mrec.durationSec; } } catch (e) {}
          if (includeThumbs) {
            try { const blob = await Store.images.load(vid); if (blob) { const d = await _blobToDataUrl(blob); if (d) m.thumb = d; } } catch (e) {}
          }
          metaByVid[vid] = m;
        }
        done++; onProgress(done, total);
        if ((done & 15) === 0) await _yield();     // keep the bar painting + Cancel live
      }
      plainLists.push({ id: r.id, name: r.name, tracks: tracks });
    }
    if (isCancelled()) return { ok: false, reason: "cancelled" };
    const file = PlaylistDoc.serializeLibrary(plainLists, metaByVid, Date.now());
    return { ok: true, file: file };
  }

  // Import a parsed library file. Validates via PlaylistDoc (untrusted input), then
  // creates each playlist as NEW — create() disambiguates the name against the user's
  // existing lists, so import is purely ADDITIVE and never overwrites. Imported
  // meta/thumbnails are cached best-effort so rows show art at once. onProgress(done,
  // total) per song; isCancelled() stops before the next list. Returns a summary.
  async function importLibrary(fileObj, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    const isCancelled = typeof opts.isCancelled === "function" ? opts.isCancelled : function () { return false; };

    const v = PlaylistDoc.validateLibrary(fileObj);
    if (!v.ok) return { ok: false, reason: v.reason };

    let total0 = 0; for (const p of v.playlists) total0 += p.tracks.length;
    let total = total0;
    let done = 0, added = 0, skipped = v.counts.skipped, listsMade = 0, cancelled = false;

    for (const pl of v.playlists) {
      if (isCancelled()) { cancelled = true; break; }
      const created = await create(pl.name);
      if (!created || !created.id) { skipped += pl.tracks.length; continue; }
      listsMade++;
      for (const t of pl.tracks) {
        if (isCancelled()) { cancelled = true; break; }
        const r = await addTrack(created.id, t.videoId);
        if (r && r.ok) added++; else skipped++;
        // cache the imported meta/art best-effort (only when we don't already have it),
        // so an imported song shows its title/thumbnail without a re-fetch.
        try {
          if (t.title !== undefined || t.durationSec !== undefined) {
            const cur = await Store.meta.load(t.videoId);
            if (!cur) { const rec = {}; if (t.title !== undefined) rec.title = t.title; if (t.durationSec !== undefined) rec.durationSec = t.durationSec; await Store.meta.persist(t.videoId, rec); }
          }
          if (t.thumb) { const have = await Store.images.has(t.videoId); if (!have) { const blob = _dataUrlToBlob(t.thumb); if (blob) await Store.images.persist(t.videoId, blob); } }
        } catch (e) {}
        done++; onProgress(done, total);
        if ((done & 15) === 0) await _yield();
      }
      if (cancelled) break;
    }
    return { ok: true, cancelled: cancelled, playlists: listsMade, added: added, skipped: skipped };
  }

  // Preview a parsed file WITHOUT writing anything (validate + summarize) for the
  // import screen. Same validation the write uses, so the preview can't disagree.
  function inspectLibrary(fileObj) {
    const v = PlaylistDoc.validateLibrary(fileObj);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, playlists: v.counts.playlists, songs: v.counts.imported, skipped: v.counts.skipped };
  }

  return {
    init, destroy, onChange, offChange,
    list, count, get,
    create, rename, remove, reorder,
    addTrack, addTrackByUrl, removeTrack,
    cloneToQueue, addWholeToQueue,
    exportPrepare, exportBuild, importLibrary, inspectLibrary,
  };
})();
