// tests/check-playlist-import.js
// SUBJECT: core/playlistdoc.js
// WALL: the playlists file's boundary (15; the per-track rules of 14 §5c). An import file is UNTRUSTED external input written
// "as if DDJP made it" — the burden is on us to validate hard before trusting a byte. PlaylistDoc.validateLibrary /
// serializeLibrary are pure and exercised directly. Covered:
//   - reject anything that isn't a well-formed playlists envelope (app/kind/formatVersion/payload.playlists);
//   - require a valid songKey per track — DROP bad tracks, never import garbage;
//   - treat optional strings as untrusted (length-cap title, keep markup as PLAIN TEXT
//     for textContent, never execute), validate region codes, drop unknown fields;
//   - dedup within a playlist; cap at MAX_PLAYLIST_TRACKS; report imported/skipped counts;
//   - export lists keys in order, snapshots optional fields, embeds a valid compressed thumb only;
//   - export -> import ROUND-TRIP preserves the playlists and their songs.
// ONE FORM EVERYWHERE (J29, step 2; the owner's, `ddjp_706`): a song is its KEY (`K1` = `yt:` + `V1`) in memory, on the
// device AND IN A FILE. An export writes keys and no `source`; an import takes keys. A file written before keys (a bare id,
// `V1`) names no service, so its songs are skipped and counted as any invalid entry is — never read as YouTube's.
// CHANGED ON PURPOSE (`ddjp_712`, the owner's decision 2: old versions are not supported): the single-playlist file
// (`{ ddjp: "playlist", formatVersion: 1 }`), whose reader and writer the app had not called since the library file, is gone —
// such a file is refused as any file that is not a playlists file is. Its rows below are the same rules, read through the
// one boundary the app uses.

const { loadInContext } = require("./_load");
const { PlaylistDoc: P } = loadInContext(["core/playlistdoc.js"]);

let failed = 0;
function ok(cond, msg, got) { if (!cond) { console.log("[playlist-import] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); failed++; } }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[playlist-import] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

const V1 = "dQw4w9WgXcQ", V2 = "9bZkp7q19f0", V3 = "kJQP7kiw5Fk";
const K1 = "yt:" + V1, K2 = "yt:" + V2, K3 = "yt:" + V3;   // the same songs in memory
const lib1 = (pl) => ({ app: "ddjp", kind: "playlists", formatVersion: 1, payload: { playlists: [Object.assign({ name: "L", tracks: [] }, pl)] } });
const one = (pl) => { const r = P.validateLibrary(lib1(pl)); return { ok: r.ok, name: r.playlists[0] && r.playlists[0].name,
  tracks: r.playlists[0] ? r.playlists[0].tracks : [], imported: r.counts.imported, skipped: r.counts.skipped }; };

// ---- the single-playlist file is gone: refused as any file that is not a playlists file ----
ok(!("validateImport" in P) && !("serializeExport" in P), "THE SINGLE-PLAYLIST FILE'S READER AND WRITER ARE GONE (`ddjp_712`)");
const single = P.validateLibrary({ ddjp: "playlist", formatVersion: 1, id: "x", name: "Mine", exportedAt: 1, tracks: [{ songKey: K1, thumb: "v1" }] });
eq(single, { ok: false, reason: "not a ddjp file", playlists: [], counts: { playlists: 0, imported: 0, skipped: 0 } },
  "A SINGLE-PLAYLIST FILE IS REFUSED like any file that is not a playlists file — nothing read, nothing thrown");

// ---- valid envelope: good ids kept, bad dropped + counted ----
const r1 = one({ tracks: [
  { songKey: K1 }, { songKey: "tooShort" }, { songKey: K2 }, { songKey: 123 }, null, { nope: 1 },
] });
ok(r1.ok, "well-formed envelope accepted");
eq(r1.tracks.map((t) => t.songKey), [K1, K2], "only songs named by a valid key imported");
ok(r1.imported === 2 && r1.skipped === 4, "counts: imported 2, skipped 4");

// ---- a bare id names no service: a file from before keys has its songs skipped and counted, nothing thrown ----
const rBare = one({ tracks: [{ songKey: V1 }, { songKey: K2 }, { songKey: V3, source: "youtube" }] });
ok(rBare.ok, "a file mixing bare ids and keys is still a well-formed envelope");
eq(rBare.tracks.map((t) => t.songKey), [K2], "a BARE ID IS NOT A SONG — with or without `source`, only the key is imported");
ok(rBare.imported === 1 && rBare.skipped === 2, "the bare ids are counted as skipped");
const rOld = P.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 1, payload: { playlists: [
  { name: "Old", tracks: [{ songKey: V1, source: "youtube" }, { songKey: V2 }] } ] } });
ok(rOld.ok && rOld.playlists.length === 1 && rOld.playlists[0].tracks.length === 0 && rOld.counts.imported === 0 && rOld.counts.skipped === 2,
   "a LIBRARY written before keys: its list arrives, its bare-id songs are skipped and counted", rOld.counts);

// ---- dedup within a playlist ----
const r2 = one({ tracks: [{ songKey: K1 }, { songKey: K1 }, { songKey: K2 }] });
eq(r2.tracks.map((t) => t.songKey), [K1, K2], "duplicate songKey collapsed");
ok(r2.imported === 2 && r2.skipped === 1, "the duplicate is counted as skipped");

// ---- untrusted optional fields ----
const r3 = one({ tracks: [{
  songKey: K1,
  title: "  Hello    World  ",
  durationSec: 213.7,
  geo: { blocked: ["DE", "xx", "FRANCE", "FR"], checkedAt: "2026-04-01T00:00:00Z" },
  evil: "<script>", source: "youtube",
}] });
const t3 = r3.tracks[0];
eq(t3.title, "Hello World", "title trimmed + whitespace-collapsed");
eq(t3.durationSec, 214, "duration rounded");
eq(t3.geo.blocked, ["DE", "FR"], "geo keeps only valid ISO-2 codes");
ok(!("evil" in t3) && !("source" in t3), "unknown fields dropped (`source` among them: the key names the service)");
ok(one({ tracks: [{ songKey: K1, title: "x".repeat(5000) }] }).tracks[0].title.length === P.MAX_TITLE,
   "title length-capped");
ok(one({ tracks: [{ songKey: K1, title: "<img src=x onerror=alert(1)>" }] }).tracks[0].title.indexOf("<") >= 0,
   "markup KEPT AS PLAIN TEXT (caller renders as textContent, never HTML)");
ok(one({ tracks: [{ songKey: K1, durationSec: -5 }] }).tracks[0].durationSec === undefined,
   "non-positive duration dropped");
ok(one({ tracks: [{ songKey: K1, title: 42 }] }).tracks[0].title === undefined,
   "non-string title dropped");

// ---- name defaulting ----
eq(one({ name: "  Trip  ", tracks: [] }).name, "Trip", "name cleaned");
eq(one({ name: "", tracks: [] }).name, "Imported playlist", "empty name -> import default");
eq(P.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 1, payload: { playlists: [{ tracks: [] }] } }).playlists[0].name, "Imported playlist", "missing name -> import default");

// ---- cap at MAX_PLAYLIST_TRACKS ----
const big = []; for (let i = 0; i < P.MAX_PLAYLIST_TRACKS + 50; i++) big.push({ songKey: "yt:" + (i.toString(36).padStart(11, "a")).slice(0, 11) });
const rBig = one({ tracks: big });
ok(rBig.imported === P.MAX_PLAYLIST_TRACKS, "import truncates to the track cap");
ok(rBig.skipped >= 50, "over-cap tracks counted as skipped");

// ---- LIBRARY envelope (15): many playlists in one growable file, optional thumb bytes ----
const GOODTHUMB = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const OKPNG     = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

// sanitizeThumb: accept small allowed data-URLs, reject everything else (untrusted)
ok(P.sanitizeThumb(GOODTHUMB) === GOODTHUMB, "sanitizeThumb keeps a small webp data-URL");
ok(P.sanitizeThumb(OKPNG) === OKPNG, "sanitizeThumb keeps a small png data-URL");
ok(P.sanitizeThumb("data:image/svg+xml;base64,PHN2Zz4=") === undefined, "svg thumb rejected (not an allowed raster type)");
ok(P.sanitizeThumb("https://evil/x.png") === undefined, "non-data-URL thumb rejected");
ok(P.sanitizeThumb("data:text/html;base64,PGh0bWw+") === undefined, "non-image data-URL rejected");
ok(P.sanitizeThumb("data:image/webp;base64," + "A".repeat(P.MAX_THUMB_CHARS)) === undefined, "oversized thumb rejected");
ok(P.sanitizeThumb(12345) === undefined && P.sanitizeThumb(null) === undefined, "non-string thumb rejected");

// serializeLibrary: growable envelope, ids-in-order, meta snapshotted, valid thumbs kept
const libIn = [
  { id: "pl_a", name: "  A  ", tracks: [{ songKey: K1 }, { songKey: K2, title: "on-track" }] },   // memory form
  { id: "pl_b", name: "B",     tracks: [{ songKey: K3 }, { songKey: "bad" }] },
];
const meta = { [K1]: { title: "Cached", durationSec: 60, thumb: GOODTHUMB }, [K3]: { thumb: "not-a-dataurl" } };
const lib = P.serializeLibrary(libIn, meta, "2026-07-02T00:00:00Z");
eq(lib.app, "ddjp", "library app marker");
eq(lib.kind, "playlists", "library kind");
eq(lib.formatVersion, 1, "library formatVersion 1");
eq(lib.exportedAt, "2026-07-02T00:00:00Z", "library uses the timestamp passed in");
ok(lib.payload && Array.isArray(lib.payload.playlists) && lib.payload.playlists.length === 2, "envelope carries payload.playlists");
eq(lib.payload.playlists[0].name, "A", "playlist name cleaned in export");
eq(lib.payload.playlists[0].tracks.map((t) => t.songKey), [K1, K2], "export lists keys in order, drops bad ids");
ok(lib.payload.playlists.every((pl) => pl.tracks.every((t) => !("source" in t))), "the library writes no `source` either (J29, step 2)");
eq(lib.payload.playlists[0].tracks[0].title, "Cached", "export snapshots title from metaByVid");
eq(lib.payload.playlists[0].tracks[0].thumb, GOODTHUMB, "export embeds a valid compressed thumb");
ok(lib.payload.playlists[1].tracks[0].thumb === undefined, "export omits an invalid thumb (kept as id-only)");
ok(lib.payload.playlists[0].tracks[1].thumb === undefined, "a track with no cached thumb omits it (re-fetches later)");

// validateLibrary: reject bad envelopes; validate playlists; drop bad tracks + thumbs
ok(!P.validateLibrary(null).ok, "library: null rejected");
ok(!P.validateLibrary([]).ok, "library: array rejected");
ok(!P.validateLibrary({ app: "ddjp", kind: "profile", formatVersion: 1, payload: { playlists: [] } }).ok, "library: wrong kind rejected");
ok(!P.validateLibrary({ app: "nope", kind: "playlists", formatVersion: 1, payload: { playlists: [] } }).ok, "library: wrong app rejected");
ok(!P.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 2, payload: { playlists: [] } }).ok, "library: unknown formatVersion rejected");
ok(!P.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 1, payload: {} }).ok, "library: missing playlists rejected");
eq(P.validateLibrary(null), { ok: false, reason: "not an object", playlists: [], counts: { playlists: 0, imported: 0, skipped: 0 } }, "library reject shape is total");

// full ROUND-TRIP: export -> import preserves ids, names, valid thumbs; drops the hostile thumb
const rt = P.validateLibrary(lib);
ok(rt.ok, "library round-trips cleanly");
eq(rt.playlists.map((p) => p.name), ["A", "B"], "round-trip preserves playlist names");
eq(rt.playlists[0].tracks.map((t) => t.songKey), [K1, K2], "round-trip preserves ids of playlist A");
eq(rt.playlists[1].tracks.map((t) => t.songKey), [K3], "round-trip preserves ids of playlist B (bad id already gone)");
eq(rt.playlists[0].tracks[0].thumb, GOODTHUMB, "round-trip preserves a valid embedded thumb");
eq(rt.counts, { playlists: 2, imported: 3, skipped: 0 }, "round-trip counts: 2 lists, 3 songs, 0 skipped");

// import drops a hostile embedded thumb but KEEPS the track (id survives)
const hostile = { app: "ddjp", kind: "playlists", formatVersion: 1, payload: { playlists: [
  { name: "H", tracks: [{ songKey: K1, thumb: "data:text/html;base64,PGgxPg==" }, { songKey: "short", thumb: GOODTHUMB }] },
] } };
const rh = P.validateLibrary(hostile);
eq(rh.playlists[0].tracks.map((t) => t.songKey), [K1], "hostile file: bad id dropped, good id kept");
ok(rh.playlists[0].tracks[0].thumb === undefined, "hostile embedded thumb dropped, track survives id-only");
ok(rh.counts.imported === 1 && rh.counts.skipped === 1, "hostile file counts: 1 imported, 1 skipped");

if (failed) { console.log("[playlist-import] " + failed + " failure(s)"); process.exit(1); }
console.log("[playlist-import] PASS — the playlists file hard-validated, and a single-playlist file refused as any file that is not one (`ddjp_712`); a song is its key in a file too (a bare id, from before keys, skipped and counted; no `source` written); bad tracks/thumbs dropped + counted; optional fields sanitized (markup kept as text); dedup + cap; export id-first with optional real thumb bytes; round-trips preserve identities");
process.exit(0);
