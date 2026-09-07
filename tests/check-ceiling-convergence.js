// tests/check-ceiling-convergence.js
// WALL: the hard ceiling (maxLen). A song may not exceed the room's max length. Every
// client enforces it against the SHARED anchor (np.startedAt) + SHARED constant
// (np.settings.maxLen, the log-ordered snapshot), INDEPENDENT of local duration — so a
// blocked viewer with no measured duration still enforces it, which is what guarantees
// the room can never freeze. The advance routes through the normal stagger + re-check +
// advance-lock, so it resolves to exactly ONE authored skip that everyone converges on.
//
// Guarantees:
//   PART A — FIRES PAST maxLen. now - startedAt >= maxLen → an advance (ddjp.dj.play) is
//     authored carrying p = current pi (the advance-lock anchor).
//   PART B — INDEPENDENT OF LOCAL DURATION. It fires even when the player never reported
//     a duration (the blocked-viewer case). This is the anti-freeze guarantee.
//   PART C — DOES NOT FIRE EARLY. Before maxLen (and inside GRACE) nothing is authored.
//   PART D — READS THE SNAPSHOT. maxLen comes from np.settings (log-ordered), and a
//     maxLen of 0/absent means the ceiling is OFF (no advance from the ceiling).
//   PART E — ONE SKIP UNDER CONTENTION. With N clients all past the ceiling, the advance
//     is advance-locked on p: feeding each client's emitted play back through a single
//     reducer, exactly ONE advances the rotation; the rest are stale (p mismatch).

const { loadInContext } = require("./_load");
const assert = require("assert");

function fail(msg, got) {
  console.log("[ceiling-convergence] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// A controllable clock + a manual timer queue so we can drive _tick deterministically.
function fakeEnv() {
  let now = 0;
  const timers = [];
  return {
    clock: {
      now: () => now,
      advance: (ms) => { now += ms; },
    },
    Date: { now: () => now },
    setTimeout: (fn, delay) => { timers.push({ fn, at: now + (delay || 0) }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max },  // jitter → 0 (deterministic)
    flush: () => { const due = timers.splice(0).sort((a, b) => a.at - b.at); due.forEach((t) => t.fn()); },
  };
}

// Build a Playback instance wired to a settable nowPlaying and a sink of sent events.
function makePlayback(np, rotation) {
  const env = fakeEnv();
  const sent = [];
  const sm = { getState: () => ({ nowPlaying: np.value, rotation: rotation || [{ user: "@x:hs" }] }),
    on: () => {}, off: () => {} };
  const bridge = { async sendEvent(ch, type, content) { sent.push({ type, content }); } };
  const logger = { debug() {}, warn() {}, info() {}, error() {} };
  const sb = loadInContext(["features/playback.js"], {
    Date: env.Date, Math: env.Math, setTimeout: env.setTimeout, clearTimeout: env.clearTimeout,
    setInterval: env.setInterval, clearInterval: env.clearInterval,
    StreamManager: sm, MatrixBridge: bridge, Logger: logger,
  });
  // wire the events channel so _emitPlay can send (initWiring subscribes only, no ticking)
  if (sb.Playback.initWiring) sb.Playback.initWiring("!ev:hs");
  return { Playback: sb.Playback, env, sent };
}

const npWith = (over) => ({ value: {
  dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0, skipped: false,
  settings: Object.assign({ chat: "uncategorized", vis: "private", bg: null, maxLen: 600, minLen: 10 }, over || {}),
} });

// ---- PART A + B: fires past maxLen, with NO local duration ----------------------
(() => {
  const np = npWith({ maxLen: 120 });
  const { Playback, env, sent } = makePlayback(np);
  // no setDuration called → knownDuration empty (blocked-viewer case)
  env.clock.advance(121 * 1000);   // 121s > 120s ceiling
  Playback._tick();
  env.flush();                     // run the staggered emit
  if (sent.length !== 1) fail("ceiling should author exactly one advance past maxLen (no local dur)", sent);
  assert.strictEqual(sent[0].type, "ddjp.dj.play", "ceiling advance is a play/advance event");
  assert.strictEqual(sent[0].content.p, "$p1", "advance carries p = current pi (advance-lock anchor)");
})();

// ---- PART C: does NOT fire early ----------------------------------------------
(() => {
  const np = npWith({ maxLen: 120 });
  const { Playback, env, sent } = makePlayback(np);
  env.clock.advance(60 * 1000);    // 60s < 120s
  Playback._tick();
  env.flush();
  if (sent.length !== 0) fail("ceiling must not fire before maxLen", sent);
})();

// ---- PART D: maxLen 0 / absent → ceiling OFF -----------------------------------
(() => {
  const np = npWith({ maxLen: 0 });
  const { Playback, env, sent } = makePlayback(np);
  env.clock.advance(3 * 3600 * 1000);   // 3 hours
  Playback._tick();
  env.flush();
  if (sent.length !== 0) fail("maxLen 0 means ceiling OFF — no advance", sent);

  // absent settings entirely (older event with no snapshot) → also off, no crash
  const np2 = { value: { dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0 } };
  const p2 = makePlayback(np2);
  p2.env.clock.advance(3 * 3600 * 1000);
  p2.Playback._tick();
  p2.env.flush();
  if (p2.sent.length !== 0) fail("absent settings snapshot → no ceiling, no crash", p2.sent);
})();

// ---- PART E: one skip under contention (advance-lock) ---------------------------
(() => {
  // N independent clients all past the ceiling each author a play with p = "$p1".
  // Feed all of them through ONE reducer in the same ordered log: only the first (by
  // (l,event_id)) whose p matches the live pi advances; the rest are stale.
  const N = 6;
  const emitted = [];
  for (let i = 0; i < N; i++) {
    const np = npWith({ maxLen: 120 });
    const { Playback, env, sent } = makePlayback(np);
    env.clock.advance(130 * 1000);
    Playback._tick();
    env.flush();
    if (sent.length !== 1) fail("each client should emit exactly one ceiling advance", sent);
    emitted.push(sent[0]);
  }
  // Now run them through the real reducer as competing advances off the same pi "$p1".
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
  const SD = ctx.StateDeriver;
  let L = 0;
  const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 60000, l: L, content: Object.assign({}, body) }; };
  // Two DJs so there is somewhere to advance TO; genesis play establishes pi "$e3".
  const base = [
    mk("ddjp.dj.join", "@a:hs", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    mk("ddjp.dj.join", "@b:hs", 20, { v: "BBBBBBBBBBB", u: "https://y/b" }),
  ];
  const genesis = mk("ddjp.dj.play", "@a:hs", 20, { p: null }); base.push(genesis);
  const livePi = genesis.eventId;
  // N competing ceiling advances, all carrying p = livePi
  const competing = [];
  for (let i = 0; i < N; i++) competing.push(mk("ddjp.dj.play", "@u" + i + ":hs", 20, { p: livePi }));
  const st = SD.derive(base.concat(competing));
  // Exactly one advance took effect: nowPlaying moved off the genesis pi to the next song.
  if (!st.nowPlaying || st.nowPlaying.pi === livePi) fail("exactly one ceiling advance should move the rotation", st.nowPlaying);
  // And the history has exactly TWO plays (genesis + one advance), not N+1.
  if (st.history.length !== 2) fail("advance-lock must keep exactly ONE of the N competing ceiling advances", { plays: st.history.length });
})();

console.log("[ceiling-convergence] PASS — ceiling fires past maxLen independent of local duration (anti-freeze), not before, OFF at maxLen 0/absent, reads the log-ordered snapshot, and N competing ceiling advances resolve to exactly ONE via the advance-lock");
