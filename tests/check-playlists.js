// tests/check-playlists.js
// WALL: the pure core of Playlists (14 §1a) + the Store.playlists async contract.
// All the TESTABLE decisions live in PlaylistDoc (pure, zero-dep) and are exercised
// directly here; the IDB bodies in Store.playlists are review-only browser I/O, so
// under node (no IndexedDB) we assert only their async CONTRACT and safe no-op path,
// exactly as check-store does for queue/logs. Covered:
//   - name disambiguation "(2)/(3)", name clamping;
//   - dedup by videoId (first wins), makePlaylist (caps/dedups/drops bad ids);
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
    { localStorage }
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

  // ---- validId ----
  ok(P.validId(V1), "11-char id valid");
  ok(!P.validId("short"), "wrong length rejected");
  ok(!P.validId("../etc/passwd"), "path-like rejected");
  ok(!P.validId(123), "non-string rejected");

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
  eq(P.dedupTracks([{ videoId: V1 }, { videoId: V1 }, { videoId: V2 }]).map((t) => t.videoId),
     [V1, V2], "dedup keeps first, drops later dupes");
  eq(P.dedupTracks([{ videoId: "bad" }, { videoId: V1 }, null]).map((t) => t.videoId),
     [V1], "dedup drops bad/null ids");
  eq(P.dedupTracks("nope"), [], "dedup total on non-array");

  // ---- makePlaylist: clamps, dedups, drops bad, caps ----
  const mp = P.makePlaylist("pl_1", "  My List ", [{ videoId: V1 }, { videoId: V1 }, { videoId: "x" }, { videoId: V2 }], 1000);
  eq(mp.name, "My List", "makePlaylist clamps name");
  eq(mp.tracks.map((t) => t.videoId), [V1, V2], "makePlaylist dedups + drops bad ids");
  eq(mp.createdAt, 1000, "makePlaylist keeps createdAt passed in");
  ok(P.makePlaylist("pl_x", "big", Array.from({ length: 6000 }, (_, i) => ({ videoId: V1 })), 0).tracks.length === 1,
     "makePlaylist dedups a huge same-id list to 1 (cap not even reached)");
  const many = []; for (let i = 0; i < 6000; i++) many.push({ videoId: (i.toString(36).padStart(11, "a")).slice(0, 11) });
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

  if (failed) { console.log("[playlists] " + failed + " failure(s)"); process.exit(1); }
  console.log("[playlists] PASS — pure CRUD/index/dedup/caps hold; index never auto-evicts (truth); Store.playlists async contract + no-IDB no-op safe");
  process.exit(0);
})();
