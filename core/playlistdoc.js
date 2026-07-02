// core/playlistdoc.js
// Pure functions. No side effects, no dependencies (browser, IDB, clock, network).
// Same input -> same output, forever. This is the guardable core of the Playlists
// feature (14 §1a/§5): the v1 import boundary, the v1 export serializer, the
// playlist-index transforms, name-collision disambiguation, and dedup. The async
// I/O lives in Store.playlists; the DOM lives in the panel (P3) — both compose these.
//
// LAYER NOTE: core/ cannot depend upward on features/, so the three validators below
// (VIDEOID_RE / MAX_TITLE / REGION_RE) are RE-DECLARED here rather than imported from
// features/metadata.js. They are the sibling precedent — keep the two in lockstep. For
// three regexes and a length constant, re-declaring is the pragmatic call (09 layer law);
// hoist to a shared core/ primitive only if this set starts to sprawl.
//
// CAPS (14 §1a caps NOTHING — these are OPERATOR DECISIONS, recorded as such):
//   MAX_PLAYLIST_TRACKS = 5000  — storage economy + a sane ceiling. NOTE: doc 14 §1b's
//     "My Queue capped at 5000" is spec-only/UNENFORCED today (features/userqueue.js
//     enforces only CAP=2, the per-DJ buffer depth; the 5000 in the tree is
//     core/eventcache.js's unrelated event ceiling). We define our own constant fresh
//     and do NOT chase fixing §1b here.
//   MAX_PLAYLISTS = 200  — bounds ADDITIVE import (each import mints a new list, so a
//     repeated/scripted import could balloon the count). Gives the guard a defined
//     "max playlists reached" boundary. Index is ~40 B/entry -> ~8 KB at the cap.
//
// TRUTH vs CACHE: a track is its videoId and nothing else (storage law). title/
// durationSec/geo/source are OPTIONAL regenerable cache; rows decorate from Store.meta
// at render (the enrichment loop, 14 §5b). Export SNAPSHOTS those optional fields from a
// caller-supplied metaMap; thumbnails travel as the marker `thumb:"v1"`, NEVER bytes.

const PlaylistDoc = (() => {

  // --- operator-decided caps (see header; NOT spec-derived) ----------------
  const MAX_PLAYLIST_TRACKS = 5000;
  const MAX_PLAYLISTS       = 200;

  // --- untrusted-input validators (re-declared; sibling: features/metadata.js) --
  const VIDEOID_RE = /^[A-Za-z0-9_-]{11}$/;   // YouTube video id shape
  const MAX_TITLE  = 300;                      // cap untrusted title length
  const REGION_RE  = /^[A-Z]{2}$/;             // ISO-3166-1 alpha-2
  const MAX_NAME   = 200;                       // cap untrusted playlist-name length
  const FORMAT_VERSION = 1;
  const SOURCES = { youtube: 1 };               // reserved; only youtube today

  function validId(v) { return typeof v === "string" && VIDEOID_RE.test(v); }

  // ---- PURE: clean ONE optional metadata partial (mirrors metadata.sanitize) --
  // Returns { title?, durationSec?, geo? }; drops anything that doesn't validate;
  // never throws; never returns markup (callers render title as textContent).
  function sanitizeMeta(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    if (typeof raw.title === "string") {
      const t = raw.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
      if (t) out.title = t;
    }
    if (typeof raw.durationSec === "number" && isFinite(raw.durationSec) &&
        raw.durationSec > 0 && raw.durationSec < 24 * 3600) {
      out.durationSec = Math.round(raw.durationSec);
    }
    if (raw.geo && typeof raw.geo === "object") {
      const blocked = Array.isArray(raw.geo.blocked)
        ? raw.geo.blocked.filter((c) => typeof c === "string" && REGION_RE.test(c)).slice(0, 400)
        : [];
      // checkedAt is a record, not logic (no geo provider wired). Keep a string
      // (envelope ISO form, 14 §5a) or a number; otherwise drop to "".
      const ca = raw.geo.checkedAt;
      const checkedAt = (typeof ca === "string" || typeof ca === "number") ? ca : "";
      out.geo = { blocked: blocked, checkedAt: checkedAt };
    }
    return out;
  }

  // ---- PURE: clean ONE track from untrusted input. videoId is REQUIRED (the only
  // truth); returns a clean track or null (drop). Unknown fields are dropped. ----
  function sanitizeTrack(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!validId(raw.videoId)) return null;
    const t = { videoId: raw.videoId, source: (typeof raw.source === "string" && SOURCES[raw.source]) ? raw.source : "youtube" };
    const m = sanitizeMeta(raw);
    if (m.title !== undefined)       t.title = m.title;
    if (m.durationSec !== undefined) t.durationSec = m.durationSec;
    if (m.geo !== undefined)         t.geo = m.geo;
    return t;
  }

  // ---- PURE: dedup a track list by videoId, first occurrence wins ----
  function dedupTracks(tracks) {
    const seen = Object.create(null);
    const out = [];
    if (!Array.isArray(tracks)) return out;
    for (const t of tracks) {
      const id = t && t.videoId;
      if (!validId(id) || seen[id]) continue;
      seen[id] = 1;
      out.push(t);
    }
    return out;
  }

  // ---- PURE: clamp a name to a trimmed, length-capped, non-empty string ----
  function cleanName(name, fallback) {
    const f = (typeof fallback === "string" && fallback) ? fallback : "Playlist";
    if (typeof name !== "string") return f;
    const n = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    return n || f;
  }

  // ---- PURE: resolve a name collision -> "name", "name (2)", "name (3)", ... ----
  // existing: array of names already in use.
  function disambiguateName(name, existing) {
    const base = cleanName(name);
    const taken = Object.create(null);
    if (Array.isArray(existing)) for (const e of existing) if (typeof e === "string") taken[e] = 1;
    if (!taken[base]) return base;
    for (let i = 2; i < 100000; i++) {
      const cand = base + " (" + i + ")";
      if (!taken[cand]) return cand;
    }
    return base + " (" + Date.now() + ")";   // unreachable in practice
  }

  // ---- PURE: build a clean playlist record. Caps tracks, dedups, drops bad ids,
  // clamps the name. createdAt is passed IN (no clock in a pure module). ----
  function makePlaylist(id, name, tracks, createdAt) {
    const clean = dedupTracks((Array.isArray(tracks) ? tracks : []).map(sanitizeTrack).filter(Boolean));
    return {
      id: String(id),
      name: cleanName(name),
      createdAt: (typeof createdAt === "number" || typeof createdAt === "string") ? createdAt : 0,
      tracks: clean.slice(0, MAX_PLAYLIST_TRACKS),
    };
  }

  // ---- PURE: cap predicates (the guard's defined boundaries) ----
  function atPlaylistCap(count) { return typeof count === "number" && count >= MAX_PLAYLISTS; }
  function atTrackCap(len)      { return typeof len === "number" && len >= MAX_PLAYLIST_TRACKS; }

  // ---- PURE: the playlist INDEX transforms (record-per-playlist + one index, 14 §1a).
  // index shape: { order: [id, ...], names: { id: name } }. NEVER auto-evicts: there is
  // no eviction path here (playlists are TRUTH; they shed only by explicit remove/clear,
  // storage law). This is the non-evicting sibling of IDB.indexUpsertEvict (which is for
  // the bounded CACHE tier). ----
  function emptyIndex() { return { order: [], names: {} }; }

  function _normIndex(ix) {
    const order = (ix && Array.isArray(ix.order)) ? ix.order.slice() : [];
    const names = (ix && ix.names && typeof ix.names === "object") ? Object.assign({}, ix.names) : {};
    return { order: order, names: names };
  }

  // Upsert one playlist header into the index. New id appends to order (no eviction);
  // an existing id keeps its position and just refreshes its name (rename path).
  function indexUpsert(ix, playlist) {
    const out = _normIndex(ix);
    const id = playlist && String(playlist.id);
    if (!id) return out;
    if (out.order.indexOf(id) < 0) out.order.push(id);
    out.names[id] = cleanName(playlist && playlist.name);
    return out;
  }

  // Remove one id from the index (total on a missing id).
  function indexRemove(ix, id) {
    const out = _normIndex(ix);
    const k = String(id);
    out.order = out.order.filter((x) => x !== k);
    delete out.names[k];
    return out;
  }

  // Reorder the index. `orderIds` must be a permutation of the existing ids; anything
  // else is IGNORED (returns the index unchanged) so a bad reorder can't drop a list.
  function indexReorder(ix, orderIds) {
    const out = _normIndex(ix);
    if (!Array.isArray(orderIds) || orderIds.length !== out.order.length) return out;
    const cur = out.order.slice().sort();
    const nxt = orderIds.map(String).slice().sort();
    for (let i = 0; i < cur.length; i++) if (cur[i] !== nxt[i]) return out;   // not a permutation
    out.order = orderIds.map(String);
    return out;
  }

  // ---- PURE: the v1 IMPORT boundary (14 §5c). File is UNTRUSTED external input.
  // Returns { ok, name?, tracks?, imported, skipped, reason? }. Never throws. ----
  function validateImport(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, reason: "not an object", imported: 0, skipped: 0, tracks: [] };
    }
    if (obj.ddjp !== "playlist") {
      return { ok: false, reason: "not a ddjp playlist envelope", imported: 0, skipped: 0, tracks: [] };
    }
    if (obj.formatVersion !== FORMAT_VERSION) {
      return { ok: false, reason: "unknown formatVersion", imported: 0, skipped: 0, tracks: [] };
    }
    if (!Array.isArray(obj.tracks)) {
      return { ok: false, reason: "tracks is not an array", imported: 0, skipped: 0, tracks: [] };
    }
    let skipped = 0;
    const clean = [];
    const seen = Object.create(null);
    for (const raw of obj.tracks) {
      const t = sanitizeTrack(raw);
      if (!t) { skipped++; continue; }                 // bad/missing videoId, junk
      if (seen[t.videoId]) { skipped++; continue; }     // duplicate within the file
      if (clean.length >= MAX_PLAYLIST_TRACKS) { skipped++; continue; }   // over the cap
      seen[t.videoId] = 1;
      clean.push(t);
    }
    return { ok: true, name: cleanName(obj.name, "Imported playlist"), tracks: clean, imported: clean.length, skipped: skipped };
  }

  // ---- PURE: the v1 EXPORT serializer (14 §5a). Identity-first, metadata-optional,
  // NO embedded bytes. metaMap { videoId: {title?,durationSec?,geo?} } is the snapshot
  // the caller reads from Store.meta (the enriched-doc-out half of the §5b loop);
  // exportedAt is passed IN (no clock in a pure module). ----
  function serializeExport(playlist, metaMap, exportedAt) {
    const p = playlist || {};
    const mm = (metaMap && typeof metaMap === "object") ? metaMap : {};
    const tracks = (Array.isArray(p.tracks) ? p.tracks : []).filter((t) => t && validId(t.videoId)).map((t) => {
      const snap = sanitizeMeta(Object.assign({}, mm[t.videoId] || {}, {
        // a field on the track itself wins over the cache snapshot if present
        title: (t.title !== undefined ? t.title : (mm[t.videoId] || {}).title),
        durationSec: (t.durationSec !== undefined ? t.durationSec : (mm[t.videoId] || {}).durationSec),
        geo: (t.geo !== undefined ? t.geo : (mm[t.videoId] || {}).geo),
      }));
      const out = { videoId: t.videoId, source: (typeof t.source === "string" && SOURCES[t.source]) ? t.source : "youtube" };
      if (snap.title !== undefined)       out.title = snap.title;
      if (snap.durationSec !== undefined) out.durationSec = snap.durationSec;
      if (snap.geo !== undefined)         out.geo = snap.geo;
      out.thumb = "v1";                  // MARKER that art is derivable — never bytes
      return out;
    });
    return {
      ddjp: "playlist",
      formatVersion: FORMAT_VERSION,
      id: String(p.id || ""),
      name: cleanName(p.name),
      exportedAt: (typeof exportedAt === "string" || typeof exportedAt === "number") ? exportedAt : 0,
      tracks: tracks,
    };
  }

  return {
    MAX_PLAYLIST_TRACKS, MAX_PLAYLISTS, MAX_TITLE, MAX_NAME, FORMAT_VERSION,
    validId, sanitizeMeta, sanitizeTrack, dedupTracks, cleanName, disambiguateName,
    makePlaylist, atPlaylistCap, atTrackCap,
    emptyIndex, indexUpsert, indexRemove, indexReorder,
    validateImport, serializeExport,
  };
})();
