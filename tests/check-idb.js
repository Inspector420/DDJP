// tests/check-idb.js
// WALL: the pure logic inside the IndexedDB engine. The async DB calls are
// browser-only (review-only, like transport's SDK calls), but the decisions the
// engine makes — namespaced key layout and bounded eviction — are pure and MUST
// be correct: eviction is what stops the event tail (the voucher store) from
// growing without bound, the hazard that currently weakens redaction-refusal.
// We lock that logic here. (idb.js loads fine under node: it touches indexedDB
// only inside the async wrappers, never at eval.)

const { loadInContext } = require("./_load");
const { IDB } = loadInContext(["core/idb.js"], {});

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[idb] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

// --- keyFor: per-user vs per-room namespacing (09 §3) ---
eq(IDB.keyFor(null, "events", "$e1"), "u:events:$e1", "no scope -> per-user namespace");
eq(IDB.keyFor({}, "events", "$e1"), "u:events:$e1", "empty scope -> per-user namespace");
eq(IDB.keyFor({ room: "!s:hs" }, "events", "$e1"), "r:!s:hs:events:$e1", "room scope -> per-room namespace");
eq(IDB.keyFor({ room: "!s:hs" }, "queue", 7), "r:!s:hs:queue:7", "non-string id is stringified");

// --- evictionPlan: oldest-first, keep at most `cap` ---
const E = (k, o) => ({ key: k, order: o });
eq(IDB.evictionPlan([E("a", 1), E("b", 2)], 5), [], "under cap -> evict nothing");
eq(IDB.evictionPlan([E("a", 1), E("b", 2), E("c", 3)], 3), [], "exactly at cap -> evict nothing");
eq(IDB.evictionPlan([E("a", 3), E("b", 1), E("c", 2), E("d", 4)], 2), ["b", "c"], "over cap -> drop the two oldest by order");
eq(IDB.evictionPlan([E("a", 10), E("b", 20), E("c", 5)], 1), ["c", "a"], "keeps only the newest; order, not insertion, decides");

// --- evictionPlan totality: never throws on junk, returns [] ---
eq(IDB.evictionPlan(null, 3), [], "non-array -> []");
eq(IDB.evictionPlan([E("a", 1)], -1), [], "negative cap -> [] (no crash)");
eq(IDB.evictionPlan([E("a", 1)], "x"), [], "non-number cap -> []");
eq(IDB.evictionPlan([{ key: "a" }, { key: "b" }, { key: "c" }], 1), ["a", "b"], "missing order treated as 0 (stable)");

// --- supported(): false under node (no indexedDB global), never throws ---
eq(typeof IDB.supported(), "boolean", "supported() returns a boolean");
eq(IDB.supported(), false, "supported() is false under node (no indexedDB) — degrades, doesn't crash");

if (failed) { console.log("[idb] " + failed + " failure(s)"); process.exit(1); }
console.log("[idb] PASS — namespaced keys, bounded eviction (oldest-first, total), and graceful no-IDB degradation");
process.exit(0);
