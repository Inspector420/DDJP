// tests/check-actions.js
// WALL: the Actions adapter must DELEGATE its rule half to Capabilities (never
// re-implement a rank rule), fold in state-availability honestly, and route every
// click to a real feature method. Runs headless with stubbed feature + interface
// globals so we can drive state/rank and capture calls.

const assert = require("assert");
const { loadInContext } = require("./_load");

// --- test-controlled state, shared by reference into the sandbox ---
let curState = {};
let curId = "@me";
let curRank = 0;
const calls = [];

const SM = { getState: () => curState };
const RoomStub = { getMyId: () => curId, getMyRank: () => curRank, assignRank: rec("Room.assignRank"), setSettings: rec("Room.setSettings"), invite: rec("Room.invite") };
function rec(name) { return (...a) => { calls.push([name, a]); return Promise.resolve("ok"); }; }
const QueueStub = { join: rec("Queue.join"), leave: rec("Queue.leave"), submitSong: rec("Queue.submitSong"), undeclare: rec("Queue.undeclare"), reorder: rec("Queue.reorder"), move: rec("Queue.move"), remove: rec("Queue.remove"), reset: rec("Queue.reset") };
const SkipStub = { skip: rec("Skip.skip") };
const ReactionsStub = { vote: rec("Reactions.vote"), recordSave: rec("Reactions.recordSave"), hasVoted: () => false, hasSaved: () => false };
const RoomUpgradeStub = { upgrade: rec("RoomUpgrade.upgrade") };

const { Capabilities, Actions } = loadInContext(
  ["backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "features/actions.js"],
  { StreamManager: SM, Room: RoomStub, Queue: QueueStub, Skip: SkipStub, Reactions: ReactionsStub, RoomUpgrade: RoomUpgradeStub, Date }
);

const RANKS = [0, 20, 40, 60, 80, 100];
let checks = 0;

// ---------- 1. Delegation: for always-available verb actions, enabled === can().permitted across ranks ----------
// state that makes each such action's `avail` true (rotation non-empty; a target member @b)
curState = { nowPlaying: { dj: "@x", pi: "p1" }, rotation: [{ user: "@b", pending: [{ videoId: "s1" }] }], settings: {}, history: [], counts: {} };
curId = "@me";

const ALWAYS_AVAIL = {
  "room.settings": {},
  "rank.assign":   { userId: "@b", targetRank: 20, newLevel: 40 },
  "room.invite":   { userId: "@b" },
  "dj.move":       { userId: "@b" },
  "dj.remove":     { userId: "@b", targetRank: 20 },
  "dj.order":      { videoIds: ["s1"] },
  "dj.undeclare":  { videoId: "s1" },
  "room.upgrade":  {},
};
for (const action in ALWAYS_AVAIL) {
  const target = ALWAYS_AVAIL[action];
  const verb = { "room.settings": "room.settings", "rank.assign": "rank.assign", "room.invite": "room.invite", "dj.move": "dj.move", "dj.remove": "dj.remove", "dj.order": "dj.order", "dj.undeclare": "dj.undeclare", "room.upgrade": "room.upgrade" }[action];
  for (const r of RANKS) {
    curRank = r;
    const ctx = { myId: curId, myRank: r, now: Date.now(), target };
    const capP = Capabilities.can(verb, curState, ctx).permitted;
    const enabled = Actions.describe(action, target).enabled;
    assert.strictEqual(enabled, capP, `[${action}] enabled must equal can().permitted at rank ${r} (delegation)`);
    checks++;
  }
}

// ---------- 2. State-availability is real (isolated from rank) ----------
// react.save has NO verb -> enabled is pure availability, independent of rank.
curRank = 0;
curState = { nowPlaying: { dj: "@x", pi: "p1" }, rotation: [], settings: {}, history: [], counts: {} };
assert.strictEqual(Actions.describe("react.save", { pi: "p1" }).enabled, true, "react.save enabled with a now-playing");
curState = { nowPlaying: null, rotation: [], settings: {}, history: [], counts: {} };
assert.strictEqual(Actions.describe("react.save", { pi: "p1" }).enabled, false, "react.save disabled with nothing playing");
assert.strictEqual(Actions.describe("react.save", { pi: "p1" }).reason, "Nothing is playing", "react.save carries an availability reason");
checks += 3;

// dj.declare availability: in rotation & buffer<2 (rank rule is 'in rotation' -> both need me in rotation)
curState = { nowPlaying: null, rotation: [{ user: "@me", pending: [{ videoId: "s1" }] }], settings: {}, history: [], counts: {} };
assert.strictEqual(Actions.describe("dj.declare", { videoId: "s9" }).enabled, true, "declare enabled: in rotation, buffer has room");
curState = { nowPlaying: null, rotation: [{ user: "@me", pending: [{ videoId: "s1" }, { videoId: "s2" }] }], settings: {}, history: [], counts: {} };
const dFull = Actions.describe("dj.declare", { videoId: "s9" });
assert.strictEqual(dFull.enabled, false, "declare disabled when buffer full");
assert.strictEqual(dFull.reason, "Your queue is full", "declare full carries availability reason");
checks += 3;

// ---------- 3. Routing: perform() calls the mapped feature method (only when enabled) ----------
function expectCall(action, args, rank, state, expectMethod, expectArgs) {
  calls.length = 0;
  curRank = rank; curState = state;
  return Actions.perform(action, args).then(() => {
    assert.ok(calls.length === 1 && calls[0][0] === expectMethod, `[${action}] perform must call ${expectMethod} (got ${JSON.stringify(calls)})`);
    if (expectArgs) assert.deepStrictEqual(calls[0][1], expectArgs, `[${action}] ${expectMethod} args`);
    checks++;
  });
}
const npState = { nowPlaying: { dj: "@me", pi: "p1" }, rotation: [{ user: "@me", pending: [{ videoId: "s2" }] }], settings: {}, history: [], counts: {} };
const roomState = { nowPlaying: null, rotation: [{ user: "@b", pending: [{ videoId: "s1" }] }], settings: {}, history: [], counts: {} };

Promise.resolve()
  .then(() => expectCall("dj.skip", {}, 0, npState, "Skip.skip"))                                   // I'm the DJ -> allowed
  .then(() => expectCall("dj.reset", {}, 80, roomState, "Queue.reset"))                              // High-Staff -> allowed
  .then(() => expectCall("rank.assign", { userId: "@b", targetRank: 20, newLevel: 40 }, 60, roomState, "Room.assignRank", ["@b", 40]))
  .then(() => expectCall("dj.remove", { userId: "@b", targetRank: 20 }, 60, roomState, "Queue.remove", ["@b"]))
  // 4. perform REJECTS (and does not route) when the rule denies it
  .then(() => {
    calls.length = 0; curRank = 20; curState = roomState;   // 20 < High-Staff
    return Actions.perform("dj.reset", {}).then(
      () => { throw new Error("dj.reset should have rejected for rank 20"); },
      () => { assert.strictEqual(calls.length, 0, "denied perform must not call the feature"); checks++; }
    );
  })
  // 5. Catalog integrity: every verb is known; every action has a run
  .then(() => {
    for (const action of Actions.ACTIONS) {
      const d = Actions.describe(action, {});
      assert.ok(d && typeof d.enabled === "boolean", `[${action}] describe returns a descriptor`);
      checks++;
    }
    const VERBS = new Set(Capabilities.VERBS);
    // the verb-backed actions must reference a real verb
    for (const v of ["dj.join", "dj.leave", "dj.declare", "dj.undeclare", "dj.order", "dj.skip", "dj.move", "dj.remove", "dj.reset", "room.settings", "react.vote", "rank.assign", "room.invite", "room.upgrade"]) {
      assert.ok(VERBS.has(v), `verb ${v} must be in Capabilities.VERBS`);
      checks++;
    }
  })
  .then(() => {
    console.log("[actions] PASS — enabled delegates to can(); state-availability is real; perform routes to the right feature and rejects denied clicks (" + checks + " assertions)");
    process.exit(0);
  })
  .catch((e) => { console.log("[actions] FAIL — " + e.message); process.exit(1); });
