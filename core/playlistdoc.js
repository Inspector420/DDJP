// core/playlistdoc.js
// Pure functions. No side effects, no dependencies (browser, IDB, clock, network).
// Same input -> same output, forever. This is the guardable core of the Playlists
// feature (14 §1a/§5): the playlists file (the library envelope, 15) — its import boundary
// and its export —, the playlist-index transforms, name-collision disambiguation, and dedup.
// The async I/O lives in Store.playlists; the DOM lives in the panel (P3) — both compose these.
// THE SINGLE-PLAYLIST FILE IS GONE (`ddjp_712`, the owner's: old versions are not supported): the app had read and written
// only the library file since 15, and the older form's reader and writer were kept for nothing; a file in that form is
// refused as any file that is not a playlists file is (`validateLibrary`: "not a ddjp file").
//
// A SONG IS ITS KEY, IN MEMORY, AT REST AND IN A FILE (J29; the owner's, `ddjp_706`: one form everywhere). What a song id
// may look like, the links it is read from and its canonical link are `core/songs.js`'s, the one home of the song services;
// this file asks it and keeps no copy. A track carries its key in `songKey` (`yt:` + YouTube's id; the field was `videoId`
// until `ddjp_707`) — in memory, in a record on the device and in a file. A track with no key in `songKey` (a record or a file
// written before: a bare id, or a key under the old field name) is not a song: an import skips it as it skips any invalid entry, and
// `keptTracks` drops it from a stored record, so it is never shown half-read (`core/store.js` says so once in the log).
//
// LAYER NOTE: core/ cannot depend upward on features/, so the two validators below
// (MAX_TITLE / REGION_RE) are RE-DECLARED here rather than imported from
// features/metadata.js. They are the sibling precedent — keep the two in lockstep.
//
// CAPS (14 §1a caps NOTHING — these are OPERATOR DECISIONS, recorded as such):
//   MAX_PLAYLIST_TRACKS = 5000  — storage economy + a sane ceiling. NOTE: doc 14 §1b's
//     "My Queue capped at 5000" is spec-only/UNENFORCED today (features/userqueue.js
//     enforces only CAP=2, the per-DJ buffer depth; the other 5000s in the tree —
//     History.MAX and ui/chatbuffer.js's CAP — are unrelated). We define our own constant fresh
//     and do NOT chase fixing §1b here.
//   MAX_PLAYLISTS = 200  — bounds ADDITIVE import (each import mints a new list, so a
//     repeated/scripted import could balloon the count). Gives the guard a defined
//     "max playlists reached" boundary. Index is ~40 B/entry -> ~8 KB at the cap.
//
// TRUTH vs CACHE: a track is its song and nothing else (storage law) — its key, everywhere.
// title/durationSec/geo are OPTIONAL regenerable cache; rows decorate from Store.meta
// at render (the enrichment loop, 14 §5b). Export SNAPSHOTS title and length from a
// caller-supplied map; a thumbnail travels as a small compressed image when the caller has one (15 §4).

const PlaylistDoc = (() => {

  // --- operator-decided caps (see header; NOT spec-derived) ----------------
  const MAX_PLAYLIST_TRACKS = 5000;
  const MAX_PLAYLISTS       = 200;

  // --- untrusted-input validators (re-declared; sibling: features/metadata.js) --
  const MAX_TITLE  = 300;                      // cap untrusted title length
  const REGION_RE  = /^[A-Z]{2}$/;             // ISO-3166-1 alpha-2
  const MAX_NAME   = 200;                       // cap untrusted playlist-name length

  // --- the LIBRARY envelope (15: export/import many playlists in one file) ------
  // A GROWABLE wrapper so a future PROFILE export is the SAME file with kind:"profile"
  // and more sections beside `playlists`. The library format may carry the COMPRESSED
  // thumbnail bytes per track (user-chosen, ~2 KB, re-fetchable if absent) — a deliberate
  // choice for this format (15 §4; playlists are local non-consensus truth).
  const LIBRARY_APP    = "ddjp";
  const LIBRARY_KIND   = "playlists";
  const LIBRARY_FORMAT = 1;
  // A thumbnail travels as a compressed base64 DATA-URL; shape + length are the only
  // gate the pure core applies (no decode, no I/O). ~24k chars ≈ ~18 KB decoded — our
  // downscaled thumbs are ~2 KB (~2.7k b64), so this bounds a hostile blob generously.
  const THUMB_DATAURL_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
  const MAX_THUMB_CHARS  = 24000;

  // A song is a key (`Songs.isKey`). The link parser and the canonical link are `Songs.fromLink` and `Songs.linkOf`: one
  // home for every service's link forms (J29).
  function validId(v) { return Songs.isKey(v); }

  // ---- PURE: a stored record's tracks, the songs alone. A track whose `songKey` is not a key is dropped, so a playlist
  // is never shown half-read; `dropped` says how many, for the store's one log line. Every other field is kept. ----
  function keptTracks(rec) {
    if (!rec || typeof rec !== "object") return { rec: rec || null, dropped: 0 };
    if (!Array.isArray(rec.tracks)) return { rec: rec, dropped: 0 };
    const tracks = rec.tracks.filter((t) => t && typeof t === "object" && validId(t.songKey));
    return { rec: Object.assign({}, rec, { tracks: tracks }), dropped: rec.tracks.length - tracks.length };
  }

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

  // ---- PURE: clean ONE track from untrusted input. Its song — a key in `songKey` — is REQUIRED (the only truth); returns a
  // clean track or null (drop). Unknown fields are dropped. ----
  function sanitizeTrack(raw) {
    if (!raw || typeof raw !== "object" || !validId(raw.songKey)) return null;
    const t = { songKey: raw.songKey };
    const m = sanitizeMeta(raw);
    if (m.title !== undefined)       t.title = m.title;
    if (m.durationSec !== undefined) t.durationSec = m.durationSec;
    if (m.geo !== undefined)         t.geo = m.geo;
    return t;
  }

  // ---- PURE: dedup a track list by songKey, first occurrence wins ----
  function dedupTracks(tracks) {
    const seen = Object.create(null);
    const out = [];
    if (!Array.isArray(tracks)) return out;
    for (const t of tracks) {
      const id = t && t.songKey;
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

  // ---- PURE: MOVE ONE SONG WITHIN A PLAYLIST (J131, the owner: the room queue's four moves, inside a playlist) ----
  // `to` is "up" | "down" | "top" | "bottom". Returns { ok: true, tracks } — a NEW list with that song moved and nothing
  // else — or { ok: false, reason } naming why nothing moved: "not a move", "not in playlist", "already first",
  // "already last". The list given is never changed. The screen draws a move with this at once and the feature writes it
  // with this, so what is shown and what is stored cannot disagree.
  const MOVES = { up: 1, down: 1, top: 1, bottom: 1 };
  function moveTrack(tracks, songKey, to) {
    if (!Object.prototype.hasOwnProperty.call(MOVES, to)) return { ok: false, reason: "not a move" };
    const list = Array.isArray(tracks) ? tracks : [];
    const i = list.findIndex((t) => !!t && t.songKey === songKey);
    if (i < 0) return { ok: false, reason: "not in playlist" };
    if ((to === "up" || to === "top") && i === 0) return { ok: false, reason: "already first" };
    if ((to === "down" || to === "bottom") && i === list.length - 1) return { ok: false, reason: "already last" };
    const out = list.slice();
    const moved = out.splice(i, 1)[0];
    out.splice(to === "up" ? i - 1 : to === "down" ? i + 1 : to === "top" ? 0 : out.length, 0, moved);
    return { ok: true, tracks: out };
  }

  // ---- PURE: validate ONE optional embedded thumbnail (the 15 bytes path). A thumb
  // travels as a compressed base64 image data-URL (webp|jpeg|png), length-capped.
  // Untrusted on import: anything that isn't a small image data-URL of an allowed type
  // is DROPPED (the track keeps its songKey and re-fetches its art on the other machine).
  // Returns the clean data-URL string or undefined. Pure — a shape+length gate, no decode.
  function sanitizeThumb(v) {
    if (typeof v !== "string") return undefined;
    if (v.length > MAX_THUMB_CHARS) return undefined;
    if (!THUMB_DATAURL_RE.test(v)) return undefined;
    return v;
  }

  // ---- PURE: the v1 LIBRARY export (15 §3). Wraps MANY playlists in the growable
  // envelope. Per track: its song, its key in `songKey` + optional title/durationSec
  // snapshotted from metaByVid + optional `thumb` (a compressed image data-URL the
  // CALLER resolved from Store.images — the pure core only shape/size-validates it; it
  // never reads storage). Absent meta/thumb is simply omitted (re-fetches elsewhere).
  // Deterministic; exportedAt is passed IN (no clock here). A future profile export
  // reuses this by nesting `payload.playlists` inside its own envelope.
  function serializeLibrary(playlists, metaByVid, exportedAt) {
    const mm = (metaByVid && typeof metaByVid === "object") ? metaByVid : {};
    const lists = (Array.isArray(playlists) ? playlists : []).map((p) => {
      const src = (p && Array.isArray(p.tracks)) ? p.tracks : [];
      const tracks = src.filter((t) => t && validId(t.songKey)).map((t) => {
        const meta = mm[t.songKey] || {};
        const snap = sanitizeMeta({
          title:       t.title       !== undefined ? t.title       : meta.title,
          durationSec: t.durationSec !== undefined ? t.durationSec : meta.durationSec,
        });
        const out = { songKey: t.songKey };
        if (snap.title !== undefined)       out.title = snap.title;
        if (snap.durationSec !== undefined) out.durationSec = snap.durationSec;
        const th = sanitizeThumb(t.thumb !== undefined ? t.thumb : meta.thumb);
        if (th !== undefined) out.thumb = th;
        return out;
      });
      return { name: cleanName(p && p.name), tracks: tracks };
    });
    return {
      app: LIBRARY_APP,
      kind: LIBRARY_KIND,
      formatVersion: LIBRARY_FORMAT,
      exportedAt: (typeof exportedAt === "string" || typeof exportedAt === "number") ? exportedAt : 0,
      payload: { playlists: lists },
    };
  }

  // ---- PURE: the v1 LIBRARY import boundary (15 §6). The whole file is UNTRUSTED.
  // Hard-validate the envelope; for each playlist, validate its tracks with the SAME
  // per-track rules for every playlist (songKey required, meta sanitized, markup kept as
  // PLAIN TEXT, dedup within the playlist, cap) PLUS an optional embedded `thumb`
  // (dropped unless it's a small allowed image data-URL). Returns
  // { ok, playlists:[{name,tracks}], counts:{playlists,imported,skipped}, reason? }.
  // Never throws; total on junk. Name-collision disambiguation is the CALLER's job (the
  // feature knows the user's existing names); this only yields clean, named playlists.
  function validateLibrary(obj) {
    const bad = (reason) => ({ ok: false, reason: reason, playlists: [], counts: { playlists: 0, imported: 0, skipped: 0 } });
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return bad("not an object");
    if (obj.app !== LIBRARY_APP)              return bad("not a ddjp file");
    if (obj.kind !== LIBRARY_KIND)            return bad("not a playlists file");
    if (obj.formatVersion !== LIBRARY_FORMAT) return bad("unknown formatVersion");
    const payload = obj.payload;
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.playlists)) return bad("no playlists");
    let imported = 0, skipped = 0;
    const out = [];
    for (const rawPl of payload.playlists) {
      if (!rawPl || typeof rawPl !== "object") continue;   // drop a junk playlist entry
      const seen = Object.create(null);
      const tracks = [];
      const src = Array.isArray(rawPl.tracks) ? rawPl.tracks : [];
      for (const raw of src) {
        const t = sanitizeTrack(raw);
        if (!t) { skipped++; continue; }
        if (seen[t.songKey]) { skipped++; continue; }
        if (tracks.length >= MAX_PLAYLIST_TRACKS) { skipped++; continue; }
        const th = sanitizeThumb(raw && raw.thumb);
        if (th !== undefined) t.thumb = th;
        seen[t.songKey] = 1;
        tracks.push(t);
        imported++;
      }
      out.push({ name: cleanName(rawPl.name, "Imported playlist"), tracks: tracks });
    }
    return { ok: true, playlists: out, counts: { playlists: out.length, imported: imported, skipped: skipped } };
  }

  return {
    MAX_PLAYLIST_TRACKS, MAX_PLAYLISTS, MAX_TITLE, MAX_NAME, MAX_THUMB_CHARS,
    validId, keptTracks, sanitizeThumb, dedupTracks, cleanName, disambiguateName,
    makePlaylist, atPlaylistCap, atTrackCap,
    emptyIndex, indexUpsert, indexRemove, indexReorder, moveTrack,
    serializeLibrary, validateLibrary,
  };
})();
