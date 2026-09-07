// tests/check-store.js
// WALL: the Store facade's IDB-backed domains. queue + logs are now async and
// IndexedDB-backed, with a localStorage fallback when IDB is unavailable and a
// read-through of the pre-move key so existing data still loads. Under node there
// is no IndexedDB, so this exercises the FALLBACK path end-to-end: the async
// contract (load returns a Promise), round-trip persist/load, and that a stack
// written under the old `uq_<spaceId>` key is still returned.

const { loadInContext } = require("./_load");

function ctx() {
  const m = {};
  const localStorage = {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
  return loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js"], { localStorage });
}

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[store] FAIL — " + msg); failed++; } }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[store] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

(async () => {
  const { Store, StorageIO } = ctx();

  ok(Store.durability.supported() === false, "no IndexedDB under node -> fallback path");

  // async contract
  const p = Store.queue.load("s1");
  ok(p && typeof p.then === "function", "queue.load returns a Promise");
  eq(await Store.queue.load("s1"), null, "empty room -> null");
  eq(await Store.queue.load(null), null, "no spaceId -> null (no throw)");

  // round-trip through the fallback
  const rec = { stack: [{ videoId: "AAA" }, { videoId: "BBB" }], active: true };
  Store.queue.persist("s1", rec);
  eq(await Store.queue.load("s1"), rec, "queue round-trips: persist then load returns the same record");
  Store.queue.clear("s1");
  eq(await Store.queue.load("s1"), null, "queue.clear removes the record");

  // existing data under the old uq_<spaceId> key is still found (migration-read)
  StorageIO.save("uq_s2", { stack: [{ videoId: "ZZZ" }], active: false });
  const migrated = await Store.queue.load("s2");
  eq(migrated && migrated.stack[0].videoId, "ZZZ", "a stack under the legacy uq_ key still loads");

  // logs round-trip + async contract
  const lp = Store.logs.load();
  ok(lp && typeof lp.then === "function", "logs.load returns a Promise");
  Store.logs.persist(["line one", "line two"]);
  eq(await Store.logs.load(), ["line one", "line two"], "logs round-trip");

  if (failed) { console.log("[store] " + failed + " failure(s)"); process.exit(1); }
  console.log("[store] PASS — async queue/logs facade: Promise contract, round-trip, clear, and legacy migration-read via the fallback");
  process.exit(0);
})();
