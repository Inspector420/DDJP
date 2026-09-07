// tests/check-clock-not-from-history.js
//
// THE CLOCK LEARNS FROM LIVE TRAFFIC, NEVER FROM REPLAYED HISTORY.
//
// ServerClock reconstructs server time from the `ts` on incoming events: sample = localNow - ts,
// median over a small window, and serverNow() = localNow - offset. That is correct and cheap, and
// it rests entirely on one unstated assumption — that the events it sees ARRIVED at roughly the
// time they were STAMPED.
//
// Replay violates that assumption completely. `ServerClock.init()` runs in room.js's WIRE phase;
// `_replayAllChannels` runs after it. So the room's whole history is fed through the same "*"
// subscription the live path uses, and every historical event contributes a sample equal to its
// own AGE. An event from an hour ago says "the server is an hour behind you."
//
// What that costs, measured before this guard existed, for a song three minutes in:
//
//     busy room  (event every 2s)    clock  0.2 min behind   playhead 169s of 180s   works
//     normal     (event every 30s)   clock  2.8 min behind   playhead  15s of 180s   visibly wrong
//     quiet      (event every 2min)  clock 11.0 min behind   playhead   0s of 180s   STOPS
//
// Everything downstream reads that one number, so one wrong value breaks four things at once: the
// player seeks to the wrong second, the progress bar sits at zero, the wall-clock advance net
// never fires, and the auto-calibration loop never even RUNS — it is gated behind "has this song
// been playing 15 seconds?", which a clock in the past answers `no` forever.
//
// This is why it presented as three unrelated faults across several sessions. It is one.
//
// Note the severity depends on how QUIET the room is, not on any code change — `serverclock.js`
// is byte-identical across every build that carried it. Quiet rooms are the worst case for everything reactive
// here, and this is one more instance of that.
//
// GUARANTEES:
//   PART A — REPLAY TEACHES NOTHING. Old events observed while not live leave the offset alone.
//   PART B — LIVE STILL TEACHES. The gate is not "never learn", which would be a decorative fix
//            that passes PART A while deleting the feature.
//   PART C — THE CONSEQUENCE. After an aged replay, the position of a song three minutes in reads
//            three minutes, not zero. This is the property a person actually notices.
//   PART D — THE CALIBRATION GATE OPENS. The "has it been playing 15s?" test that feeds the
//            drift-correction loop must pass, because that loop is what keeps the player honest.
//
// FAIL DIRECTION, STATED (CONCEPTS.md §3.2): if liveness cannot be established, DO NOT LEARN. No
// offset means serverNow() is the local clock — the module's own documented degradation, wrong by
// a device's skew (seconds) instead of by a room's quietness (minutes). Refusing to learn is cheap;
// learning wrongly is what stopped the music.

const assert = require("assert");
const { loadInContext } = require("./_load");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

// A ServerClock wired the way production wires it: subscribed to the stream, asking the interface
// whether it is live. `live` is flipped by the test to model replay vs live traffic.
function makeClock(localNowFn, liveFlag) {
  const subs = {};
  const StreamManager = {
    on: (t, fn) => { (subs[t] = subs[t] || []).push(fn); },
    off: (t, fn) => { if (subs[t]) subs[t] = subs[t].filter((f) => f !== fn); },
    _emit: (entry) => { for (const fn of (subs["*"] || [])) fn(entry); },
  };
  const MatrixBridge = {
    mayAuthor: () => ({ ok: liveFlag.live }),
    sendEvent: () => Promise.resolve(),
  };
  const ctx = loadInContext(["core/logger.js", "features/serverclock.js"],
    { StreamManager, MatrixBridge, Date });
  const SC = ctx.ServerClock;
  SC._setClockForTest(localNowFn);
  SC.init();
  return { SC, StreamManager };
}

const NOW = 1700000000000;
const STARTED_AT = NOW - 180000;        // a song three minutes in
const GRACE_MS = 15000;                 // playback's "has it been playing long enough" gate

// ── PART A: replayed history teaches the clock nothing ───────────────────────────────────────
{
  const flag = { live: false };                       // REPLAYING — this is the wire phase
  const { SC, StreamManager } = makeClock(() => NOW, flag);

  // A quiet two-hour room, replayed newest-last exactly as replayRoom delivers it.
  let fed = 0;
  for (let i = 39; i >= 0; i--) { StreamManager._emit({ type: "ddjp.dj.play", ts: NOW - i * 120000 }); fed++; }

  ok(fed === 40, "A: APPLIED — the replay must actually have been delivered", fed);
  ok(SC.hasOffset() === false,
    "A: replayed history must not teach the clock anything. An old event says when something " +
    "HAPPENED, not what time it is NOW.",
    { offset: SC.offsetMs(), hasOffset: SC.hasOffset() });
  ok(SC.serverNow() === NOW,
    "A: with nothing learned, serverNow() is the local clock — the documented safe degradation",
    { serverNow: SC.serverNow(), local: NOW });
}

// ── PART B: live traffic still teaches it ────────────────────────────────────────────────────
// Without this, "never learn at all" would pass PART A while quietly deleting the feature — the
// shape of a fix that satisfies its own guard and does nothing.
{
  const flag = { live: true };
  const skew = 5000;                                   // this device is 5s ahead of the server
  let local = NOW;
  const { SC, StreamManager } = makeClock(() => local, flag);
  for (let i = 0; i < 8; i++) { StreamManager._emit({ type: "ddjp.dj.play", ts: local - skew }); local += 1000; }

  ok(SC.hasOffset() === true, "B: live events must still be learned from", SC.offsetMs());
  ok(Math.abs(SC.offsetMs() - skew) < 100,
    "B: and the offset must be the real skew, so cross-device agreement still works",
    { offset: SC.offsetMs(), expected: skew });
}

// ── PART C: the consequence a person notices ─────────────────────────────────────────────────
{
  const flag = { live: false };
  let local = NOW;
  const { SC, StreamManager } = makeClock(() => local, flag);

  // Reload: replay an aged room...
  for (let i = 39; i >= 0; i--) StreamManager._emit({ type: "ddjp.dj.play", ts: NOW - i * 120000 });
  // ...then the client settles and goes live.
  flag.live = true;

  const elapsed = SC.elapsedSince(STARTED_AT) / 1000;
  ok(Math.abs(elapsed - 180) < 2,
    "C: after a reload, a song three minutes in must read three minutes. Reading 0 is what made " +
    "the player restart the track and the progress bar sit at zero.",
    { elapsedSec: elapsed, expected: 180 });
}

// ── PART D: the calibration loop is reachable ────────────────────────────────────────────────
// The drift correction ("if my player is more than N seconds from where the room says, seek") sits
// behind playback's GRACE test. A clock in the past answers that test `no` forever, so calibration
// never runs at all — it is not broken, it is never asked. Same wrong number, fourth symptom.
{
  const flag = { live: false };
  const { SC, StreamManager } = makeClock(() => NOW, flag);
  for (let i = 39; i >= 0; i--) StreamManager._emit({ type: "ddjp.dj.play", ts: NOW - i * 120000 });
  flag.live = true;

  const sinceStart = SC.serverNow() - STARTED_AT;
  ok(sinceStart >= GRACE_MS,
    "D: the grace test that gates auto-calibration must PASS for a song three minutes in — " +
    "otherwise the correction loop is never reached and the player is never pulled back",
    { sinceStartMs: sinceStart, needMs: GRACE_MS });
}

console.log("[clock-not-from-history] PASS — the server clock is learned from live traffic and " +
  "never from replayed history: a reload no longer teaches the client that the server is minutes " +
  "in the past, so a song three minutes in reads three minutes rather than zero, the player lands " +
  "where the room actually is, and the grace test that gates auto-calibration opens instead of " +
  "answering 'not started yet' forever; live events still teach the real skew, so cross-device " +
  "agreement is unchanged rather than traded away; and a client that cannot establish liveness " +
  "declines to learn and falls back to its local clock, because being wrong by a device's skew is " +
  "recoverable and being wrong by a room's quietness stopped the music (" + checks + " assertions)");
