// tests/check-store.js
// SUBJECT: core/store.js
// WALL: the Store facade's IDB-backed domains. queue + logs are async and IndexedDB-backed, with a localStorage
// fallback when IDB is unavailable. Under node there is no IndexedDB, so PART A exercises the FALLBACK path end-to-end:
// the async contract (load returns a Promise) and round-trip persist/load. PART B gives the store an IndexedDB stand-in
// and holds the drop (`ddjp_707`, the last of the old data): once IndexedDB is up, what localStorage held from before the
// IndexedDB move — the old `uq_<spaceId>` list, the old `log` — is NOT read through, and nothing is copied over.

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
  const rec = { intent: [{ eid: "e1", songKey: "yt:AAAAAAAAAAA" }, { eid: "e2", songKey: "yt:BBBBBBBBBBB" }], active: true };
  Store.queue.persist("s1", rec);
  eq(await Store.queue.load("s1"), rec, "queue round-trips: persist then load returns the same record");
  Store.queue.clear("s1");
  eq(await Store.queue.load("s1"), null, "queue.clear removes the record");


  // logs round-trip + async contract
  const lp = Store.logs.load();
  ok(lp && typeof lp.then === "function", "logs.load returns a Promise");
  Store.logs.persist(["line one", "line two"]);
  eq(await Store.logs.load(), ["line one", "line two"], "logs round-trip");

  // ── PART B — IndexedDB up: nothing localStorage held from before it is read through (`ddjp_707`) ──
  {
    const m = {};
    const localStorage = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
    const map = new Map(), writes = [];
    const IDB = { supported: () => true, keyFor: (scope, a, b) => JSON.stringify([scope, a, b]),
      get: (st, k) => Promise.resolve(map.has(st + k) ? map.get(st + k) : undefined),
      set: (st, k, v) => { writes.push(k); map.set(st + k, v); return Promise.resolve(); },
      del: (st, k) => { map.delete(st + k); return Promise.resolve(); }, keys: () => Promise.resolve([]) };
    const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/store.js"], { localStorage, IDB });
    sb.StorageIO.save("uq_s9", { intent: [{ eid: "e1", songKey: "yt:CCCCCCCCCCC" }], active: false });
    sb.StorageIO.save("log", ["an old line"]);
    ok(sb.StorageIO.load("uq_s9") && sb.StorageIO.load("log"), "B PREMISE — localStorage holds a list and a log written before the move");
    eq(await sb.Store.queue.load("s9"), null, "B: WITH INDEXEDDB UP, MY QUEUE'S OLD localStorage LIST IS NOT READ THROUGH — nothing old");
    eq(await sb.Store.logs.load(), null, "B: NOR IS THE OLD localStorage LOG");
    eq(writes, [], "B: and nothing was copied into IndexedDB");
    sb.Store.queue.persist("s9", rec);
    eq(await sb.Store.queue.load("s9"), rec, "B CONTROL — what this build writes to IndexedDB reads back, so the nulls above are the drop");
  }

  if (failed) { console.log("[store] " + failed + " failure(s)"); process.exit(1); }
  console.log("[store] PASS — async queue/logs facade: Promise contract, round-trip, clear through the fallback; with IndexedDB up, " +
    "nothing localStorage held from before it is read through or copied (`ddjp_707`)");
  process.exit(0);
})();
