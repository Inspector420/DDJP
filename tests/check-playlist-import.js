// tests/check-playlist-import.js
// WALL: the v1 portable-document boundary (14 §5a/§5c). An import file is UNTRUSTED
// external input written "as if DDJP made it" — the burden is on us to validate hard
// before trusting a byte. PlaylistDoc.validateImport / serializeExport are pure and
// exercised directly. Covered:
//   - reject anything that isn't a well-formed v1 envelope (ddjp/formatVersion/tracks);
//   - require a valid videoId per track — DROP bad tracks, never import garbage;
//   - treat optional strings as untrusted (length-cap title, keep markup as PLAIN TEXT
//     for textContent, never execute), validate region codes, drop unknown fields;
//   - dedup within the file; cap at MAX_PLAYLIST_TRACKS; report imported/skipped counts;
//   - export is identity-first, formatVersion:1, thumb marker (NEVER bytes), snapshots
//     optional fields from the supplied metaMap;
//   - export -> import ROUND-TRIP preserves the track identities.

const { loadInContext } = require("./_load");
const { PlaylistDoc: P } = loadInContext(["core/playlistdoc.js"]);

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[playlist-import] FAIL — " + msg); failed++; } }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[playlist-import] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

const V1 = "dQw4w9WgXcQ", V2 = "9bZkp7q19f0", V3 = "kJQP7kiw5Fk";
const env = (over) => Object.assign({ ddjp: "playlist", formatVersion: 1, name: "L", tracks: [] }, over);

// ---- reject malformed envelopes ----
ok(!P.validateImport(null).ok, "null rejected");
ok(!P.validateImport(undefined).ok, "undefined rejected");
ok(!P.validateImport("string").ok, "string rejected");
ok(!P.validateImport(42).ok, "number rejected");
ok(!P.validateImport([]).ok, "array rejected");
ok(!P.validateImport({}).ok, "missing ddjp rejected");
ok(!P.validateImport(env({ ddjp: "queue" })).ok, "wrong ddjp value rejected");
ok(!P.validateImport(env({ formatVersion: 2 })).ok, "unknown formatVersion rejected");
ok(!P.validateImport(env({ formatVersion: undefined })).ok, "missing formatVersion rejected");
ok(!P.validateImport({ ddjp: "playlist", formatVersion: 1, tracks: "nope" }).ok, "non-array tracks rejected");
// a rejected import never throws and reports zero counts
eq(P.validateImport(null), { ok: false, reason: "not an object", imported: 0, skipped: 0, tracks: [] }, "reject shape is total");

// ---- valid envelope: good ids kept, bad dropped + counted ----
const r1 = P.validateImport(env({ tracks: [
  { videoId: V1 }, { videoId: "tooShort" }, { videoId: V2 }, { videoId: 123 }, null, { nope: 1 },
] }));
ok(r1.ok, "well-formed envelope accepted");
eq(r1.tracks.map((t) => t.videoId), [V1, V2], "only valid videoIds imported");
ok(r1.imported === 2 && r1.skipped === 4, "counts: imported 2, skipped 4");

// ---- dedup within the file ----
const r2 = P.validateImport(env({ tracks: [{ videoId: V1 }, { videoId: V1 }, { videoId: V2 }] }));
eq(r2.tracks.map((t) => t.videoId), [V1, V2], "duplicate videoId collapsed");
ok(r2.imported === 2 && r2.skipped === 1, "the duplicate is counted as skipped");

// ---- untrusted optional fields ----
const r3 = P.validateImport(env({ tracks: [{
  videoId: V1,
  title: "  Hello    World  ",
  durationSec: 213.7,
  geo: { blocked: ["DE", "xx", "FRANCE", "FR"], checkedAt: "2026-04-01T00:00:00Z" },
  evil: "<script>", source: "youtube",
}] }));
const t3 = r3.tracks[0];
eq(t3.title, "Hello World", "title trimmed + whitespace-collapsed");
eq(t3.durationSec, 214, "duration rounded");
eq(t3.geo.blocked, ["DE", "FR"], "geo keeps only valid ISO-2 codes");
ok(!("evil" in t3), "unknown field dropped");
ok(P.validateImport(env({ tracks: [{ videoId: V1, title: "x".repeat(5000) }] })).tracks[0].title.length === P.MAX_TITLE,
   "title length-capped");
ok(P.validateImport(env({ tracks: [{ videoId: V1, title: "<img src=x onerror=alert(1)>" }] })).tracks[0].title.indexOf("<") >= 0,
   "markup KEPT AS PLAIN TEXT (caller renders as textContent, never HTML)");
ok(P.validateImport(env({ tracks: [{ videoId: V1, durationSec: -5 }] })).tracks[0].durationSec === undefined,
   "non-positive duration dropped");
ok(P.validateImport(env({ tracks: [{ videoId: V1, title: 42 }] })).tracks[0].title === undefined,
   "non-string title dropped");

// ---- name defaulting ----
eq(P.validateImport(env({ name: "  Trip  ", tracks: [] })).name, "Trip", "name cleaned");
eq(P.validateImport(env({ name: "", tracks: [] })).name, "Imported playlist", "empty name -> import default");
eq(P.validateImport({ ddjp: "playlist", formatVersion: 1, tracks: [] }).name, "Imported playlist", "missing name -> import default");

// ---- cap at MAX_PLAYLIST_TRACKS ----
const big = []; for (let i = 0; i < P.MAX_PLAYLIST_TRACKS + 50; i++) big.push({ videoId: (i.toString(36).padStart(11, "a")).slice(0, 11) });
const rBig = P.validateImport(env({ tracks: big }));
ok(rBig.imported === P.MAX_PLAYLIST_TRACKS, "import truncates to the track cap");
ok(rBig.skipped >= 50, "over-cap tracks counted as skipped");

// ---- export: identity-first, marker not bytes, snapshots from metaMap ----
const pl = { id: "pl_9", name: "  Set  ", tracks: [{ videoId: V1 }, { videoId: V2, title: "on-track title" }] };
const metaMap = { [V1]: { title: "From Cache", durationSec: 100 } };
const doc = P.serializeExport(pl, metaMap, "2026-06-30T12:00:00Z");
eq(doc.ddjp, "playlist", "export ddjp marker");
eq(doc.formatVersion, 1, "export formatVersion 1");
eq(doc.name, "Set", "export name cleaned");
eq(doc.exportedAt, "2026-06-30T12:00:00Z", "export uses the timestamp passed in");
eq(doc.tracks.map((t) => t.videoId), [V1, V2], "export lists track ids in order");
eq(doc.tracks[0].title, "From Cache", "export snapshots title from the metaMap");
eq(doc.tracks[0].durationSec, 100, "export snapshots duration from the metaMap");
eq(doc.tracks[1].title, "on-track title", "a title on the track itself is preserved");
ok(doc.tracks.every((t) => t.thumb === "v1"), "thumb travels as the 'v1' marker");
ok(doc.tracks.every((t) => !("bytes" in t) && !("data" in t) && !("blob" in t)), "export never embeds bytes");

// ---- export -> import round-trip preserves identities ----
const back = P.validateImport(doc);
ok(back.ok, "exported doc re-imports cleanly");
eq(back.tracks.map((t) => t.videoId), [V1, V2], "round-trip preserves track identities");
ok(back.skipped === 0, "round-trip drops nothing");

if (failed) { console.log("[playlist-import] " + failed + " failure(s)"); process.exit(1); }
console.log("[playlist-import] PASS — v1 envelope hard-validated; bad tracks dropped + counted; optional fields sanitized (markup kept as text); dedup + cap; export is id-first/marker-not-bytes; round-trip preserves identities");
process.exit(0);
