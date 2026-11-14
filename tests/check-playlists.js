// tests/check-playlists.js
// SUBJECT: core/playlistdoc.js, core/store.js
// WALL: the pure core of Playlists (14 §1a) + the Store.playlists async contract.
// All the TESTABLE decisions live in PlaylistDoc (pure, zero-dep) and are exercised
// directly here; the IDB bodies in Store.playlists are review-only browser I/O, so
// under node (no IndexedDB) we assert only their async CONTRACT and safe no-op path,
// exactly as check-store does for queue/logs. Covered:
//   - name disambiguation "(2)/(3)", name clamping;
//   - dedup by songKey (first wins), makePlaylist (caps/dedups/drops bad ids);
//   - the record-per-playlist INDEX transforms (upsert appends new / refreshes name,
//     remove is total, reorder is permutation-only) and the NEVER-AUTO-EVICT property;
//   - the cap boundaries atPlaylistCap(200) / atTrackCap(5000) (operator decisions);
//   - Store.playlists returns Promises and no-ops safely with no IDB.

const { loadInContext } = require("./_load");

function ctx() {
  const m = {};
  const localStorage = {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
  return loadInContext(
    ["core/logger.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js", "core/store.js"],
    { localStorage, URL }
  );
}

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[playlists] FAIL — " + msg); failed++; } }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[playlists] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

(async () => {
  const { PlaylistDoc: P, Store } = ctx();

  const V1 = "dQw4w9WgXcQ", V2 = "9bZkp7q19f0", V3 = "kJQP7kiw5Fk";
  const K1 = "yt:" + V1, K2 = "yt:" + V2;   // the same songs as the app names them: keys, everywhere (J29, steps 1–2)

  // ---- validId: a song is its KEY — in memory, at rest and in a file (J29; one form everywhere since step 2) ----
  ok(P.validId("yt:" + V1), "a YouTube song key valid");
  ok(!P.validId(V1), "a bare 11-char id is not a key: it names no service");
  ok(!P.validId("short"), "wrong length rejected");
  ok(!P.validId("../etc/passwd"), "path-like rejected");
  ok(!P.validId(123), "non-string rejected");

  // ---- the link parser (`cleanId` / `extractVideoId`) MOVED to `core/songs.js` at J29 (step 1), with `watchUrl`: the
  // one home of every service's link forms. Its forms are held there against the old parser's own answers
  // (`check-song-services` PART C), so they are not re-asserted here. ----

  // ---- cleanName ----
  eq(P.cleanName("  Friday   warmup  "), "Friday warmup", "name trimmed + whitespace-collapsed");
  eq(P.cleanName(""), "Playlist", "empty name -> default");
  eq(P.cleanName(42), "Playlist", "non-string name -> default");
  ok(P.cleanName("x".repeat(9999)).length === P.MAX_NAME, "name length-capped");

  // ---- disambiguateName ----
  eq(P.disambiguateName("Mix", []), "Mix", "no collision -> unchanged");
  eq(P.disambiguateName("Mix", ["Mix"]), "Mix (2)", "collision -> (2)");
  eq(P.disambiguateName("Mix", ["Mix", "Mix (2)"]), "Mix (3)", "(2) taken -> (3)");
  eq(P.disambiguateName("Mix", ["Mix", "Mix (3)"]), "Mix (2)", "gap reused -> (2)");

  // ---- dedupTracks: first occurrence wins, bad ids dropped ----
  eq(P.dedupTracks([{ songKey: K1 }, { songKey: K1 }, { songKey: K2 }]).map((t) => t.songKey),
     [K1, K2], "dedup keeps first, drops later dupes");
  eq(P.dedupTracks([{ songKey: "bad" }, { songKey: K1 }, null]).map((t) => t.songKey),
     [K1], "dedup drops bad/null ids");
  eq(P.dedupTracks("nope"), [], "dedup total on non-array");

  // ---- makePlaylist: clamps, dedups, drops bad, caps ----
  const mp = P.makePlaylist("pl_1", "  My List ", [{ songKey: K1 }, { songKey: K1 }, { songKey: "x" }, { songKey: V3 }, { songKey: K2 }], 1000);
  eq(mp.name, "My List", "makePlaylist clamps name");
  eq(mp.tracks.map((t) => t.songKey), [K1, K2], "makePlaylist dedups + drops bad ids — a bare id among them: it names no service (J29, step 2)");
  eq(mp.createdAt, 1000, "makePlaylist keeps createdAt passed in");
  ok(P.makePlaylist("pl_x", "big", Array.from({ length: 6000 }, (_, i) => ({ songKey: K1 })), 0).tracks.length === 1,
     "makePlaylist dedups a huge same-id list to 1 (cap not even reached)");
  const many = []; for (let i = 0; i < 6000; i++) many.push({ songKey: "yt:" + (i.toString(36).padStart(11, "a")).slice(0, 11) });
  ok(P.makePlaylist("pl_y", "big2", many, 0).tracks.length === P.MAX_PLAYLIST_TRACKS,
     "makePlaylist caps distinct tracks at MAX_PLAYLIST_TRACKS");

  // ---- cap predicates (the operator-decided boundaries) ----
  ok(P.MAX_PLAYLISTS === 200, "MAX_PLAYLISTS is 200");
  ok(P.MAX_PLAYLIST_TRACKS === 5000, "MAX_PLAYLIST_TRACKS is 5000");
  ok(P.atPlaylistCap(200) === true && P.atPlaylistCap(199) === false, "atPlaylistCap boundary at 200");
  ok(P.atTrackCap(5000) === true && P.atTrackCap(4999) === false, "atTrackCap boundary at 5000");

  // ---- index transforms (record-per-playlist + one index) ----
  let ix = P.emptyIndex();
  eq(ix, { order: [], names: {} }, "emptyIndex shape");
  ix = P.indexUpsert(ix, { id: "a", name: "Alpha" });
  ix = P.indexUpsert(ix, { id: "b", name: "Beta" });
  eq(ix.order, ["a", "b"], "upsert appends new ids in order");
  eq(ix.names, { a: "Alpha", b: "Beta" }, "upsert records names");
  ix = P.indexUpsert(ix, { id: "a", name: "Alpha renamed" });
  eq(ix.order, ["a", "b"], "re-upsert keeps position (no duplicate in order)");
  eq(ix.names.a, "Alpha renamed", "re-upsert refreshes the name (rename path)");

  // NEVER AUTO-EVICTS: adding far more than any cache cap keeps every entry.
  let big = P.emptyIndex();
  for (let i = 0; i < 1000; i++) big = P.indexUpsert(big, { id: "p" + i, name: "n" + i });
  ok(big.order.length === 1000, "index never evicts — all 1000 kept (truth, not cache)");
  ok(typeof P.indexUpsertEvict === "undefined" && typeof P.evictionPlan === "undefined",
     "PlaylistDoc exposes NO eviction path");

  // remove is total
  let ix2 = P.indexRemove(ix, "a");
  eq(ix2.order, ["b"], "remove drops the id from order");
  ok(!("a" in ix2.names), "remove drops the name");
  eq(P.indexRemove(ix, "missing").order, ["a", "b"], "remove is total on a missing id");

  // reorder: permutation only
  eq(P.indexReorder(ix, ["b", "a"]).order, ["b", "a"], "reorder to a valid permutation");
  eq(P.indexReorder(ix, ["a"]).order, ["a", "b"], "reorder ignored — wrong length");
  eq(P.indexReorder(ix, ["a", "zzz"]).order, ["a", "b"], "reorder ignored — not a permutation");

  // ---- Store.playlists: async contract + safe no-op with no IDB ----
  ok(Store.durability.supported() === false, "no IndexedDB under node -> no-op path");
  const pi = Store.playlists.loadIndex();
  ok(pi && typeof pi.then === "function", "loadIndex returns a Promise");
  eq(await Store.playlists.loadIndex(), { order: [], names: {} }, "loadIndex -> empty index with no IDB");
  eq(await Store.playlists.loadOne("x"), null, "loadOne -> null with no IDB");
  eq(await Store.playlists.loadOne(null), null, "loadOne(null) -> null (no throw)");
  ok((await Store.playlists.persist({ id: "p", name: "n", tracks: [] })) === false, "persist -> false with no IDB");
  ok((await Store.playlists.persist(null)) === false, "persist(null) -> false (no throw)");
  ok((await Store.playlists.remove("p")) === false, "remove -> false with no IDB");
  ok((await Store.playlists.reorder(["p"])) === false, "reorder -> false with no IDB");
  await Store.playlists.clear();   // must resolve, not throw

  // ── LOCKSTEP: playlistdoc re-declares metadata's validators, on purpose ─────────
// core/ cannot depend upward on features/, so PlaylistDoc re-declares MAX_TITLE and
// REGION_RE rather than importing them from features/metadata.js (VIDEOID_RE was the third, and
// went from both at J29, step 1: the id rule's one home is `core/songs.js`, and
// `check-song-services` PART A holds every other file to having none). The
// header says "keep the two in lockstep" — and until now nothing checked, which is the
// same shape as a rule that exists only as a comment. If they drift, a songKey that one
// layer accepts the other silently rejects, and a playlist round-trip loses tracks.
(() => {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..");
  const doc = fs.readFileSync(path.join(root, "core/playlistdoc.js"), "utf8");
  const meta = fs.readFileSync(path.join(root, "features/metadata.js"), "utf8");
  const grab = (src, name) => {
    const m = new RegExp("const\\s+" + name + "\\s*=\\s*([^;]+);").exec(src);
    return m ? m[1].trim() : null;
  };
  for (const name of ["MAX_TITLE", "REGION_RE"]) {
    const a = grab(doc, name), b = grab(meta, name);
    ok(a && b, "lockstep validator " + name + " must exist in BOTH core/playlistdoc.js and " +
      "features/metadata.js (playlistdoc=" + a + ", metadata=" + b + ")");
    ok(a === b, "lockstep validator " + name + " has DRIFTED between core/playlistdoc.js and " +
      "features/metadata.js — they are deliberately duplicated and must stay identical " +
      "(playlistdoc=" + a + ", metadata=" + b + ")");
  }
})();

  // THE GATE, BELOW THE LOCKSTEP PART (moved at J29): it sat ABOVE it, so a drifted validator printed FAIL after the gate had
  // passed — the fourth signature (a part below the gate); the runner's own rule still refused it, the file did not.
  if (failed) { console.log("[playlists] " + failed + " failure(s)"); process.exit(1); }
console.log("[playlists] PASS — pure CRUD/index/dedup/caps hold; index never auto-evicts (truth); Store.playlists async contract + no-IDB no-op safe");
  process.exit(0);
})();
