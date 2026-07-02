// tests/check-resume.js
// WALL: the cross-reload create-resume STATE logic — the part that does not need
// a live homeserver. Verifies that an interrupted creation is persisted, surfaces
// after a "reload" (fresh module context, empty memory) via Room.pendingCreate(),
// and is fully cleared on discard. The live SDK leave/build paths stay
// review-only, exactly like createUpgradeBatch / createDDJPSpace.

const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[resume] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(actual, expected, msg) {
  if (actual !== expected) fail(msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}
function truthy(v, msg) { if (!v) fail(msg, v); }

const noop = () => {};

// A fresh module context with its own fake localStorage, simulating one browser
// session. `mbCalls` collects what MatrixBridge was asked to do (so we can assert
// discard actually requested the leave). `initial` seeds localStorage as if a
// prior session had written it (the cross-reload case).
function session(initial, mbCalls) {
  const store = Object.assign({}, initial || {});
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const Logger = { info: noop, warn: noop, error: noop, debug: noop };
  const MatrixBridge = {
    discardCreation: async (spaceId, channels) => { (mbCalls || []).push({ spaceId, channels }); return { left: 0 }; },
  };
  return loadInContext(["core/storageio.js", "core/store.js", "features/room.js"], { localStorage, Logger, MatrixBridge });
}

const PARTIAL = {
  name: "Party",
  spaceId: "!space:hs",
  channels: { events_uncategorized: "!a:hs", events_guest: "!b:hs", events_owner: "!c:hs" },
};

// 1) Cross-reload surfacing: write the pending in one session, read it back in a
//    BRAND-NEW session (memory empty) purely from persisted storage.
{
  const s1 = session();
  s1.StorageIO.savePendingCreate(PARTIAL);
  const raw = s1.StorageIO.loadPendingCreate();
  truthy(raw, "pending must persist to storage");

  const s2 = session({ "ddjp_pending_create": JSON.stringify(PARTIAL) });
  const p = s2.Room.pendingCreate();
  truthy(p, "pendingCreate() must surface a persisted partial after reload");
  eq(p.name, "Party", "surfaced name");
  eq(p.spaceId, "!space:hs", "surfaced spaceId (needed to exclude the half-built space from owned)");
  eq(p.built, 3, "surfaced built count");
  eq(p.total, 8, "surfaced total");
}

// 2) Clean slate: nothing persisted -> no card.
{
  const s = session();
  eq(s.Room.pendingCreate(), null, "empty storage -> pendingCreate() null");
}

// 3) Round-trip + clear, and a zero-channel partial (space made, no channels yet)
//    still surfaces (the space exists; built = 0).
{
  const s = session();
  s.StorageIO.savePendingCreate({ name: "X", spaceId: "!x:hs", channels: {} });
  truthy(s.StorageIO.loadPendingCreate(), "saved record loads back");
  s.StorageIO.clearPendingCreate();
  eq(s.StorageIO.loadPendingCreate(), null, "cleared record is gone");

  const z = session({ "ddjp_pending_create": JSON.stringify({ name: "Y", spaceId: "!y:hs", channels: {} }) });
  const p = z.Room.pendingCreate();
  truthy(p, "zero-channel partial still surfaces");
  eq(p.built, 0, "zero-channel partial -> built 0");
  eq(p.spaceId, "!y:hs", "zero-channel partial keeps spaceId");
}

// 4) Discard clears every trace AND requests the leave from transport. Async, so
//    drive it and assert afterwards.
(async () => {
  const calls = [];
  const s = session({ "ddjp_pending_create": JSON.stringify(PARTIAL) }, calls);
  truthy(s.Room.pendingCreate(), "precondition: a pending exists before discard");

  const ok = await s.Room.discardPendingCreate();
  eq(ok, true, "discardPendingCreate() returns true when something was discarded");
  eq(calls.length, 1, "discard requests exactly one leave from transport");
  eq(calls[0].spaceId, "!space:hs", "discard leaves the right space");
  eq(s.Room.pendingCreate(), null, "after discard, no pending in memory");
  eq(s.StorageIO.loadPendingCreate(), null, "after discard, no pending in storage");

  // Discard with nothing pending is a safe no-op.
  const s2 = session();
  eq(await s2.Room.discardPendingCreate(), false, "discard with nothing pending -> false (no-op)");

  console.log("[resume] PASS — persist, cross-reload surface, clean-slate, round-trip, and discard-clears-all");
  process.exit(0);
})().catch(e => fail("unexpected throw: " + (e && e.message)));
