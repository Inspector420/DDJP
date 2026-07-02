// tests/check-image-cache.js
// WALL: the A1 bounded thumbnail cache (14 §3). The IndexedDB blob reads/writes are
// browser-only (review-only), but the DECISION the cache makes — keep the newest,
// evict the oldest, never exceed the cap, keep the index consistent — is pure and
// MUST hold, because it is what stops the thumbnail cache from growing without bound
// (the storage-governor rule, 09). That logic lives in IDB.indexUpsertEvict, and the
// per-user key layout in keyFor; we lock both here. (idb.js loads fine under node.)

const { loadInContext } = require("./_load");
const { IDB } = loadInContext(["core/idb.js"], {});

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[image-cache] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}
function ok(cond, msg) { if (!cond) { console.log("[image-cache] FAIL — " + msg); failed++; } }

// Thumbnails are keyed per-USER (u), not per-room — one fetch serves every room.
eq(IDB.keyFor(null, "img", "dQw4w9WgXcQ"), "u:img:dQw4w9WgXcQ", "thumbnail key is user-global (u:img:<id>)");
eq(IDB.keyFor({ room: "!s:hs" }, "img", "x"), "r:!s:hs:img:x", "room scope still possible but unused by images");

// --- indexUpsertEvict: add newest, evict oldest, respect cap ---

// Under cap: nothing evicted, entry added.
let r = IDB.indexUpsertEvict({ a: { order: 1 }, b: { order: 2 } }, "c", { order: 3, size: 9 }, 5);
eq(r.evicted, [], "under cap -> nothing evicted");
eq(Object.keys(r.index).sort(), ["a", "b", "c"], "under cap -> new id present");
eq(r.index.c, { order: 3, size: 9 }, "new entry stored with its meta");

// At cap after insert: still nothing to drop.
r = IDB.indexUpsertEvict({ a: { order: 1 }, b: { order: 2 } }, "c", { order: 3 }, 3);
eq(r.evicted, [], "exactly at cap -> nothing evicted");

// Over cap: oldest by order is dropped, newest (just-added) always kept.
r = IDB.indexUpsertEvict({ a: { order: 5 }, b: { order: 1 }, c: { order: 3 } }, "d", { order: 9 }, 3);
eq(r.evicted, ["b"], "over cap by one -> drops the single oldest by order");
ok(!!r.index.d, "the just-added entry is never evicted");
ok(!r.index.b, "evicted key removed from the index");
eq(Object.keys(r.index).sort(), ["a", "c", "d"], "index holds exactly the survivors");

// Over cap by several: drops the N oldest, order (not insertion) decides.
r = IDB.indexUpsertEvict({ a: { order: 50 }, b: { order: 10 }, c: { order: 30 }, d: { order: 20 } }, "e", { order: 99 }, 2);
eq(r.evicted.sort(), ["b", "c", "d"], "drops the three oldest to leave cap=2");
eq(Object.keys(r.index).sort(), ["a", "e"], "keeps the two newest by order");

// A re-touch (same id, higher order) must not duplicate or evict it.
r = IDB.indexUpsertEvict({ a: { order: 1 }, b: { order: 2 }, c: { order: 3 } }, "a", { order: 9 }, 3);
eq(r.evicted, [], "re-touching an existing id at cap evicts nothing");
eq(r.index.a, { order: 9 }, "re-touch updates order in place (no duplicate)");
eq(Object.keys(r.index).sort(), ["a", "b", "c"], "count unchanged after re-touch");

// Totality: junk index treated as empty, never throws.
r = IDB.indexUpsertEvict(null, "a", { order: 1 }, 5);
eq(r.index, { a: { order: 1 } }, "null index -> treated as empty, entry added");
eq(r.evicted, [], "null index -> nothing evicted");

if (failed) { console.log("[image-cache] " + failed + " failure(s)"); process.exit(1); }
console.log("[image-cache] PASS — user-global thumbnail keys; bounded LRU (newest kept, oldest evicted, cap honoured, index consistent)");
process.exit(0);
