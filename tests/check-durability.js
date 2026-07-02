// tests/check-durability.js
// WALL: the durability lock-in. The browser persistence/estimate calls are
// review-only, but two things must be correct and are pure/headless-testable:
//   (1) the degradation POLICY — how engine support + granted-persistence map to
//       a storage mode and whether to warn (so "no durable storage" is a visible
//       state, never silent);
//   (2) the boot-recovery CONTRACT — EventCache.ensureLoaded() is idempotent and
//       safe to await before replay refuses a redaction, including with no IDB.

const { loadInContext } = require("./_load");
const sb = loadInContext(["core/logger.js", "core/idb.js", "core/eventcache.js", "core/store.js"], {});
const { Store, EventCache } = sb;

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[durability] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}
function ok(cond, msg) { if (!cond) { console.log("[durability] FAIL — " + msg); failed++; } }

// --- (1) degradation policy (pure) ---
const C = Store.durability.classify;
eq(C(false, false), { mode: "ram-only", durable: false, warn: true,
   reason: "IndexedDB unavailable — running without cross-reload persistence" },
   "no IDB -> ram-only, not durable, warn");
eq(C(false, true), { mode: "ram-only", durable: false, warn: true,
   reason: "IndexedDB unavailable — running without cross-reload persistence" },
   "no IDB beats persisted flag -> still ram-only");
ok(C(true, false).mode === "idb-best-effort" && C(true, false).durable === true && C(true, false).warn === true,
   "IDB but not persisted -> best-effort, durable-ish, warn (browser may evict)");
ok(C(true, true).mode === "idb-persisted" && C(true, true).durable === true && C(true, true).warn === false,
   "IDB + persisted -> persisted, durable, no warn");

// --- under node there is no indexedDB/navigator: never throws, reports ram-only ---
ok(Store.durability.supported() === false, "supported() false under node");
(async () => {
  const dur = await Store.durability.lockIn();
  eq(dur.mode, "ram-only", "lockIn with no browser APIs -> ram-only (no throw)");
  ok(dur.warn === true && dur.durable === false, "lockIn surfaces the no-durable-storage warning");
  ok(typeof dur.usage === "number" && typeof dur.quota === "number", "lockIn always returns a numeric estimate");

  // --- (2) ensureLoaded idempotency + RAM-only safety (the boot-recovery contract) ---
  const p1 = EventCache.ensureLoaded();
  const p2 = EventCache.ensureLoaded();
  ok(p1 === p2, "ensureLoaded() is idempotent (same promise on repeat calls)");
  await p1;  // resolves without throwing even with no IDB
  // After hydrate, the synchronous hot path still works (RAM-only).
  EventCache.store({ event_id: "$e1", content: { body: "x" }, l: 1 });
  ok(EventCache.has("$e1") === true && EventCache.get("$e1").event_id === "$e1",
     "sync store/get/has work after ensureLoaded in RAM-only mode");

  if (failed) { console.log("[durability] " + failed + " failure(s)"); process.exit(1); }
  console.log("[durability] PASS — degradation policy classifies all modes; lockIn never throws; ensureLoaded idempotent + RAM-only-safe");
  process.exit(0);
})();
