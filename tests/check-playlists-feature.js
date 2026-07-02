// tests/check-playlists-feature.js
// WALL: the Playlists FEATURE glue (features/playlists.js) — the sequencing the pure
// core can't own. Drives the real Playlists module through in-memory Store + UserQueue
// doubles. Asserts the invariants that make this feature correct:
//   - clone-to-queue goes through the SUBMIT PATH (UserQueue.add) with a canonical
//     watch URL — never a direct/other queue write;
//   - addTrack DEDUPS and respects the track cap; create respects the playlist cap
//     and disambiguates names; rename disambiguates against other lists;
//   - add-whole-playlist tallies "added N, skipped M" (skips = songs the queue had);
//   - the gen-token/dirty-flag hydrate DISCARDS a stale late index load (newer init,
//     or a user edit in the load window), exactly as userqueue.js does over Store.queue.

const { loadInContext } = require("./_load");

const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = () => new Promise((r) => setImmediate(r));   // setImmediate runs after the microtask queue fully drains (both realms) — deterministic for the cross-realm Store double

// In-memory Store.playlists double. loadIndex is DEFERRED (resolvers queued) so the
// hydrate tests can control resolution timing; _resolveNext(val) resolves the oldest
// pending load with `val` (or the live index when val is omitted).
function makeStore() {
  const recs = {}; let index = { order: [], names: {} };
  const pending = [];
  return {
    playlists: {
      loadIndex() { return new Promise((res) => pending.push((val) => res(clone(val === undefined ? index : val)))); },
      loadOne(id) { return Promise.resolve(recs[id] ? clone(recs[id]) : null); },
      persist(pl) { recs[pl.id] = clone(pl); if (index.order.indexOf(pl.id) < 0) index.order.push(pl.id); index.names[pl.id] = pl.name; return Promise.resolve(true); },
      remove(id) { delete recs[id]; index.order = index.order.filter((x) => x !== id); delete index.names[id]; return Promise.resolve(true); },
      reorder(ord) { index.order = ord.slice(); return Promise.resolve(true); },
      clear() { for (const k in recs) delete recs[k]; index = { order: [], names: {} }; return Promise.resolve(); },
    },
    durability: { supported: () => true },
    _resolveNext(val) { const r = pending.shift(); if (r) r(val); return !!r; },
    _pending() { return pending.length; },
  };
}

// UserQueue double — records every add(url) and dedups by url (like the real one).
function makeUQ() {
  const seen = [];
  return {
    add(url) { if (seen.indexOf(url) >= 0) return { ok: false, reason: "already queued" }; seen.push(url); return { ok: true, videoId: url }; },
    _urls() { return seen.slice(); },
    _seed(url) { seen.push(url); },
  };
}

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[playlists-feature] FAIL — " + msg); failed++; } }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[playlists-feature] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}

const V1 = "dQw4w9WgXcQ", V2 = "9bZkp7q19f0", V3 = "kJQP7kiw5Fk";
const WATCH = (v) => "https://www.youtube.com/watch?v=" + v;

// Fresh feature bound to fresh doubles; hydrate the initial (empty) load.
function fresh() {
  const store = makeStore(), uq = makeUQ();
  const sb = loadInContext(["core/playlistdoc.js", "features/playlists.js"], { Store: store, UserQueue: uq, Date });
  return { P: sb.Playlists, store, uq };
}

(async () => {
  // ---- create: mints, disambiguates, respects the playlist cap ----
  {
    const { P, store } = fresh();
    P.init(); store._resolveNext(); await settle();
    const a = await P.create("Road Trip");
    ok(a.ok && a.id, "create returns ok + id");
    eq(P.list().map((x) => x.name), ["Road Trip"], "create adds to the library index");
    const b = await P.create("Road Trip");
    eq(b.name, "Road Trip (2)", "create disambiguates a duplicate name");
    eq(P.count(), 2, "count reflects both lists");
  }
  {
    // playlist cap: hydrate an index already at MAX_PLAYLISTS, then create -> rejected
    const { P, store } = fresh();
    const order = [], names = {};
    for (let i = 0; i < 200; i++) { const id = "pl" + i; order.push(id); names[id] = "n" + i; }
    P.init(); store._resolveNext({ order: order, names: names }); await settle();
    ok(P.count() === 200, "hydrated to the cap (200)");
    const r = await P.create("one too many");
    ok(!r.ok && /max/.test(r.reason), "create rejected at the playlist cap");
  }

  // ---- rename: disambiguates against OTHER lists; protects empty ----
  {
    const { P, store } = fresh();
    P.init(); store._resolveNext(); await settle();
    const a = await P.create("Alpha");
    const b = await P.create("Beta");
    const r = await P.rename(b.id, "Alpha");
    eq(r.name, "Alpha (2)", "rename to a taken name disambiguates");
    const r2 = await P.rename(a.id, "   ");
    ok(r2.ok && r2.name && r2.name.trim().length > 0, "rename to blank -> non-empty (protected)");
    const r3 = await P.rename("nope", "x");
    ok(!r3.ok, "rename of a missing id rejected");
  }

  // ---- remove ----
  {
    const { P, store } = fresh();
    P.init(); store._resolveNext(); await settle();
    const a = await P.create("Gone");
    await P.remove(a.id);
    eq(P.list(), [], "remove drops the list from the index");
  }

  // ---- addTrack: dedup + track cap; removeTrack ----
  {
    const { P, store } = fresh();
    P.init(); store._resolveNext(); await settle();
    const a = await P.create("Songs");
    ok((await P.addTrack(a.id, V1)).ok, "addTrack accepts a valid id");
    ok(!(await P.addTrack(a.id, V1)).ok, "addTrack dedups the same id");
    ok(!(await P.addTrack(a.id, "bad")).ok, "addTrack rejects a bad id");
    ok((await P.removeTrack(a.id, V1)).ok, "removeTrack removes it");
    ok(!(await P.removeTrack(a.id, V1)).ok, "removeTrack of an absent id rejected");
    // track cap: persist a record already at the cap, then addTrack -> rejected
    const full = { id: a.id, name: "Songs", createdAt: 0, tracks: [] };
    for (let i = 0; i < 5000; i++) full.tracks.push({ videoId: (i.toString(36).padStart(11, "a")).slice(0, 11), source: "youtube" });
    await store.playlists.persist(full);
    const r = await P.addTrack(a.id, V1);
    ok(!r.ok && /full/.test(r.reason), "addTrack rejected at the track cap");
  }

  // ---- cloneToQueue goes THROUGH the submit path (UserQueue.add), dedups ----
  {
    const { P, store, uq } = fresh();
    P.init(); store._resolveNext(); await settle();
    const r1 = P.cloneToQueue(V1);
    ok(r1.ok, "cloneToQueue(valid) ok");
    eq(uq._urls(), [WATCH(V1)], "clone went through UserQueue.add with the canonical watch URL");
    const r2 = P.cloneToQueue(V1);
    ok(!r2.ok, "cloneToQueue dedups via UserQueue");
    const before = uq._urls().length;
    const r3 = P.cloneToQueue("bad");
    ok(!r3.ok, "cloneToQueue rejects a bad id");
    ok(uq._urls().length === before, "a bad id never reaches the queue");
  }

  // ---- addWholeToQueue: added N / skipped M ----
  {
    const { P, store, uq } = fresh();
    P.init(); store._resolveNext(); await settle();
    const a = await P.create("Set");
    await P.addTrack(a.id, V1); await P.addTrack(a.id, V2); await P.addTrack(a.id, V3);
    uq._seed(WATCH(V2));   // V2 is already in the queue
    const r = await P.addWholeToQueue(a.id);
    eq({ added: r.added, skipped: r.skipped }, { added: 2, skipped: 1 }, "add-whole reports added 2 / skipped 1");
    ok(uq._urls().indexOf(WATCH(V1)) >= 0 && uq._urls().indexOf(WATCH(V3)) >= 0, "the two new songs went through the submit path");
  }

  // ---- hydrate: a STALE late load is discarded (newer init) ----
  {
    const { P, store } = fresh();
    P.init();                 // gen 1, load pending
    P.init();                 // gen 2, second load pending
    store._resolveNext({ order: ["A"], names: { A: "Aa" } });   // resolves gen-1's load
    await settle();
    eq(P.list(), [], "stale (gen-1) load ignored after a newer init");
    store._resolveNext({ order: ["B"], names: { B: "Bb" } });   // resolves gen-2's load
    await settle();
    eq(P.list().map((x) => x.name), ["Bb"], "current (gen-2) load applies");
  }

  // ---- hydrate: an edit in the load window is not clobbered (dirty flag) ----
  {
    const { P, store } = fresh();
    P.init();                 // load pending
    const c = await P.create("Edited");   // edit before the load resolves -> _dirty
    store._resolveNext({ order: ["Z"], names: { Z: "Zed" } });   // late load
    await settle();
    const names = P.list().map((x) => x.name);
    ok(names.indexOf("Edited") >= 0 && names.indexOf("Zed") < 0, "a late load does not clobber an in-window edit");
  }

  if (failed) { console.log("[playlists-feature] " + failed + " failure(s)"); process.exit(1); }
  console.log("[playlists-feature] PASS — clone-to-queue routes through the submit path; addTrack dedups + caps; create/rename disambiguate + cap; add-whole reports added/skipped; gen/dirty hydrate discards a stale late load");
  process.exit(0);
})();
