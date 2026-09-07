// tests/check-fixtures.js
// WALL: THE FIXTURE BUILDERS MUST STAY TRUE TO THE REDUCER.
//
// `tests/_fixtures.js` exists because nearly every false finding in this codebase's audit history
// came from a hand-typed fixture that did not reach the path under test — and an unreached path
// reports ABSENCE, which reads exactly like a finding.
//
// But a shared helper that nothing exercises is worse than none: if it drifts from the reducer
// (a changed buffer cap, a renamed field, a different event shape), every probe and guard built on
// it quietly produces the wrong answer, with no failure anywhere. That is the same shape as a rule
// that lives only in a comment. So the builders are guarded against the real reducer here.
//
// Each assertion below corresponds to a fixture mistake that actually produced a wrong conclusion.

const assert = require("assert");

// A room where PLAYER vouches. The shipped defaults switch player, guest and uncategorized OFF —
// VIP is the lowest rung that counts — so a player client owes nothing at all and this selector
// correctly returns nothing. This guard is about the selector, not about which rungs ship enabled,
// so it states the room it needs rather than inheriting whatever the defaults happen to be.
const VOUCHING = { vouchTable: [
  { enough: 1, always: false }, { enough: 2, always: false }, { enough: 3, always: false },
  { enough: 4, always: false }, { enough: 5, always: false }, { enough: 6, always: false },
  { enough: null, always: false },
] };
const F = require("./_fixtures");
const { loadInContext } = require("./_load");

const c = loadInContext([
  "core/logger.js",
  "core/playlistdoc.js",
  "backends/backend1/ranks.js",
  "core/playlistdoc.js", "backends/backend1/session.js",
  "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/floor.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js",
], { Date, Math });
const { StateDeriver, StreamManager, Vouch, Ranks } = c;

// ── the rank map matches the real ladder ────────────────────────────────────────
(() => {
  for (const name of ["owner", "high-staff", "staff", "vip", "player", "guest", "uncategorized"]) {
    const key = name === "high-staff" ? "highStaff" : (name === "uncategorized" ? "uncat" : name);
    assert.strictEqual(F.RANK[key], Ranks.levelOf(name),
      "F.RANK." + key + " has drifted from Ranks.levelOf(\"" + name + "\")");
  }
})();

// ── playingRoom produces a room that is ACTUALLY running ────────────────────────
(() => {
  const r = F.playingRoom({ songs: 3 });
  const st = StateDeriver.derive(r.log);

  assert.ok(st.nowPlaying, "playingRoom must leave a song playing — a fixture whose DJ never " +
    "started is the single most common cause of a false 'the gate is broken' finding");
  assert.strictEqual(st.nowPlaying.pi, r.pi(2),
    "pi(n) must name the n-th play instance; if this drifts, every probe asserting on a pi is wrong");

  // THE ROTATION MUST STILL BE STOCKED. Buffer cap is 2; a fixture that over-declares has the
  // extra silently refused, then the DJ runs dry a step early and every later advance is rejected
  // for a reason that looks like the gate.
  assert.strictEqual(st.rotation.length, 1,
    "the DJ must still be in the rotation after " + 3 + " plays — playingRoom tops the buffer up " +
    "between plays precisely so a probe does not hit the hard fall-out by accident");
  assert.ok(st.rotation[0].pending.length >= 1,
    "and must still hold a pending song, or the next advance fails for the wrong reason");
  assert.ok(st.rotation[0].pending.length <= F.BUFFER_CAP,
    "and must never exceed the buffer cap (" + F.BUFFER_CAP + ") — the reducer would refuse the extra");

  // one sender for the DJ. Giving each event its own sender makes the declares come from
  // non-members, which silently empties the rotation.
  const senders = new Set(r.log.filter((e) => e.type.indexOf("ddjp.dj.") === 0).map((e) => e.sender));
  assert.strictEqual(senders.size, 1,
    "every rotation event in the fixture must come from ONE sender; distinct senders make the " +
    "declares no-ops from non-members");
})();

// ── declarations land, and reach the gate ───────────────────────────────────────
(() => {
  const r = F.playingRoom({ songs: 1 });
  const live = r.pi(0);
  const log = F.sortLog(r.log.concat([F.lenDecl("$L", r.lastL + 1, r.startTs + 1000, live, 90)]));
  assert.ok(Array.from(StateDeriver.deriveAccepted(log)).indexOf("$L") >= 0,
    "a lenDecl built by the helper must be LEGAL — if it is not, a probe reads 'declarations are " +
    "rejected' and invents a bug");
  assert.strictEqual(StateDeriver.derive(log).advance.gateLenSec, 90,
    "and must actually reach the advance gate");

  // blockedCrowd must be enough distinct people to satisfy the default crowd road
  const blocked = F.sortLog(r.log.concat(F.blockedCrowd(r.lastL + 1, r.startTs + 1000, live)));
  assert.strictEqual(StateDeriver.derive(blocked).advance.skipWarranted, true,
    "blockedCrowd must reach a skip road by default — distinct senders matter here, since the " +
    "reducer counts PEOPLE, not reports");
})();

// ── both event shapes are the ones their consumers accept ───────────────────────
(() => {
  // the raw shape must survive StreamManager.ingest (needs type "m.room.message" + a JSON body)
  StreamManager.reset();
  const r = F.playingRoom({ songs: 1 });
  for (const e of r.log) StreamManager.ingest(F.toRaw(e));
  assert.ok(StreamManager.getState().nowPlaying,
    "rawEvent/toRaw must produce something StreamManager.ingest actually accepts — a raw missing " +
    "type:\"m.room.message\" is silently dropped, and the probe sees an empty room");
  StreamManager.reset();

  // and the raw must carry a top-level `l`, which the eviction floor and the vouch layer read
  const raw = F.rawEvent("$x", 7, 1000, "@a:hs", F.RANK.player, { t: "ddjp.dj.play", p: null });
  assert.strictEqual(typeof raw.l, "number",
    "a raw must carry a TOP-LEVEL l — reading it only from the body made the checkpoint floor " +
    "look like a no-op");
  assert.ok(raw.content && typeof raw.content.body === "string",
    "a raw carries its body as a JSON STRING, not a parsed object");
  const entry = F.reducerEvent("$x", 7, 1000, "@a:hs", F.RANK.player, { t: "ddjp.dj.play", p: null });
  assert.ok(entry.content && typeof entry.content === "object" && !("body" in entry.content),
    "a reducer entry carries PARSED content — conflating the two shapes generates confident " +
    "wrong reports");
})();

// ── heldSet pads past the vouch turn filter ─────────────────────────────────────
(() => {
  const held = F.heldSet([F.toRaw(F.lenDecl("$L2", 5, 1000, "$play0", 60))]);
  // `owed` takes an OPTIONS object now, and REFUSES without a floor bound — the rule the old
  // positional signature stated in the docs and enforced nowhere.
  const targets = Vouch.owed(held, { myRank: F.RANK.player, myUserId: "@me:hs",
                                     settings: VOUCHING, isLegal: () => true, floorL: -1 }).targets;
  assert.ok(targets.indexOf("$L2") >= 0,
    "heldSet must pad with enough later critical events to clear the TURN FILTER — without " +
    "padding, vouchTargets legitimately selects nothing and a probe reads it as a broken selector");
  const bundle = Vouch.bundleFor(held, targets, 10);
  assert.ok(bundle.length > 0, "and the padded set must actually build a bundle");
})();

// ── ordering helpers match the reducer's own key ─────────────────────────────────
(() => {
  const r = F.playingRoom({ songs: 2 });
  const canonical = JSON.stringify(StateDeriver.derive(F.sortLog(r.log)));
  for (let i = 0; i < 40; i++) {
    assert.strictEqual(JSON.stringify(StateDeriver.derive(F.sortLog(F.shuffled(r.log)))), canonical,
      "sortLog must reproduce the reducer's (l, event_id) order from any arrival order");
  }
})();

console.log("[fixtures] PASS — the shared builders stay true to the reducer: the rank map matches " +
  "the ladder, playingRoom leaves a genuinely running room with a stocked rotation under the " +
  "buffer cap and one DJ sender, declarations reach the advance gate and blockedCrowd reaches a " +
  "skip road, both event shapes are the ones their consumers accept (ingest-able raw with a " +
  "top-level l, parsed reducer entry), heldSet pads past the vouch turn filter, and sortLog " +
  "reproduces the reducer's own ordering");
