// tests/check-bot-awake.js
// SUBJECT: features/botruntime.js
// WALL: THE BOT'S IDLE SWEEP RUNS WHEN IT IS DUE, ON WHATEVER TELLS IT THE TIME, AND SAYS A REFUSAL ONCE (J68).
//
// The sweep rode one 15 s interval, and Chrome wakes a hidden tab's chained timers once a minute — so a bot nobody looks at
// swept four times less often than it says, and warned `idle sweep refused — not-live` on every pass it did make (filed at
// J98). The owner's decisions (`ddjp_634`): 2 — the bot keeps time from arriving messages; due work runs on arrival, and every
// timed duty, the idle sweep among them, is armed fresh from a message or a server answer, never only from a chain of its own
// timers. 4 — say a refusal once per reason, and again when the sweep runs.
//
// No second timer: `check-bot-runtime` PART C holds this module to its one sweep interval, so the sweep is RUN when due on
// every arriving message and every server answer, rather than armed as a timer of its own. The server answers at least every
// 30 s (the SDK's long-poll), so a hidden bot sweeps at most one answer late.
//
//   PART A — an arriving message runs the sweep when it is due (15 s since the last pass), and not again before the next is
//            due; a server answer does too. The interval is never run here. (Red on `ddjp_634`.)
//   PART B — a refusal is said once per reason: ten refused passes, one line; a new reason, one more line; when the sweep
//            runs again it says so once; refused again, it is said again. (Red on `ddjp_634`: a line every pass.)
// Driven: the real runtime, its sweep's collaborators doubles that count their calls, the clock a double.

const path = require("path");
const { loadInContext } = require("./_load");

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[bot-awake] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const SEC = 1000;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function world() {
  let now = 1792000000000;
  const D = function (...a) { return a.length ? new Date(...a) : new Date(now); };
  D.now = () => now; D.UTC = Date.UTC; D.parse = Date.parse;
  // THE REAL KEY SET, as `check-bot-runtime` PART J builds it: a two-key blob is a shape the reducer never produces.
  const settings = Object.assign(loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON }).StateDeriver.defaultSettings(), { queueIdleMs: 60000, botPingMs: 30000 });
  const T = { intervals: [], raw: [], answers: [], live: true, clock: true };
  const calls = { idleFor: 0 };
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botsettings.js", "features/botruntime.js",
  ], {
    Date: D, Math, JSON, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // CAPTURED, NEVER RUN: the rows below drive the sweep only by what tells the bot the time.
    setInterval: (fn, ms) => { T.intervals.push({ fn, ms }); return T.intervals.length; }, clearInterval: () => {},
    StreamManager: { getState: () => ({ settings: settings, rotation: [{ user: "@dj:hs", pending: [] }] }), getLog: () => [], on() {} },
    ServerClock: { serverNow: () => now, hasOffset: () => T.clock },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
    MatrixBridge: {
      getMyPowerLevel: () => 99, getUserId: () => "@bot:hs", getRoster: () => [],
      onRawEvent(fn) { if (T.raw.indexOf(fn) < 0) T.raw.push(fn); }, offRawEvent(fn) { const i = T.raw.indexOf(fn); if (i >= 0) T.raw.splice(i, 1); },
      onServerAnswer(fn) { if (T.answers.indexOf(fn) < 0) T.answers.push(fn); },
      offServerAnswer(fn) { const i = T.answers.indexOf(fn); if (i >= 0) T.answers.splice(i, 1); },
      mayAuthor: () => (T.live ? { ok: true } : { ok: false, reason: "not-live" }),
      sendEvent: async () => {}, eventsKeyForLevel: (l) => "events_L" + l,
    },
  });
  sb.Room = { rankLadder: () => sb.Capabilities.LADDER,
    idleFor: () => { calls.idleFor++; return { known: false }; }, presenceView: () => ({ people: [] }) };
  const lines = [];
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = (m) => lines.push(k + ": " + m);
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: {} });
  const msg = (id) => { for (const f of T.raw.slice()) f({ type: "m.room.message", event_id: "$" + id, room_id: "!r:hs", sender: "@a:hs", ts: now, content: { body: "{}" } }, null, null); };
  return { sb, T, calls, lines, started, adv: (ms) => { now += ms; }, msg, answer: () => { for (const f of T.answers.slice()) f(); },
    tick: () => T.intervals.find((t) => t.ms === sb.BotRuntime.SWEEP_EVERY_MS) };
}

(async () => {
  // ═══ PART A — the sweep runs when due, on what tells it the time ═══
  {
    const w = world();
    ok(w.started && w.started.ok && w.tick() && w.T.raw.length >= 1,
      "A PREMISE — the bot started, its sweep interval was captured (and is never run here), and it watches the room's messages",
      { started: w.started, intervals: w.T.intervals.length });
    w.adv(5 * SEC); w.msg("m1"); await settle();
    ok(w.calls.idleFor === 0, "A: a message 5 s after the start runs no sweep — none is due yet", w.calls.idleFor);
    w.adv(11 * SEC); w.msg("m2"); await settle();
    ok(w.calls.idleFor === 1,
      "A: AN ARRIVING MESSAGE RUNS THE SWEEP WHEN IT IS DUE — 16 s after the start, with the interval never run (the owner's " +
      "decision 2: due work runs on arrival)", w.calls.idleFor);
    w.adv(4 * SEC); w.msg("m3"); await settle();
    ok(w.calls.idleFor === 1, "A: and not again before the next pass is due — a busy room is not a faster sweep", w.calls.idleFor);
    ok(w.T.answers.length === 1, "A: THE BOT HEARS THE SERVER'S ANSWERS — it subscribed through the bridge", w.T.answers.length);
    w.adv(12 * SEC); w.answer(); await settle();
    ok(w.calls.idleFor === 2,
      "A: A SERVER ANSWER RUNS IT TOO — a quiet room still sweeps, at most one answer late (the long-poll is 30 s)", w.calls.idleFor);
    w.sb.BotRuntime.stop();
    w.adv(20 * SEC); w.answer(); w.msg("m4"); await settle();
    ok(w.T.answers.length === 0 && w.T.raw.length === 0 && w.calls.idleFor === 2,
      "A: stopping lets go of the answers, and nothing sweeps after it", { answers: w.T.answers.length, sweeps: w.calls.idleFor });
  }

  // ═══ PART B — a refusal is said once per reason ═══
  {
    const w = world();
    const t = w.tick();
    ok(!!t, "B PREMISE — the sweep's interval was captured, so its passes can be driven at its own cadence");
    const said = () => w.lines.filter((m) => /idle sweep refused/.test(m));
    const again = () => w.lines.filter((m) => /idle sweep is running again/.test(m));
    w.T.live = false;
    for (let i = 0; i < 10; i++) { w.adv(15 * SEC); t.fn(); await settle(); }
    ok(w.calls.idleFor === 0 && said().length === 1 && /not-live/.test(said()[0]) && /^warn: /.test(said()[0]),
      "B: A REFUSAL IS SAID ONCE PER REASON — ten passes refused `not-live`, one warning (the owner's decision 4; on `ddjp_634` " +
      "a hidden bot said it about every 15 s)", said());
    w.T.live = true; w.T.clock = false;
    for (let i = 0; i < 3; i++) { w.adv(15 * SEC); t.fn(); await settle(); }
    ok(said().length === 2 && /no-clock/.test(said()[1]), "B: a NEW reason is said, once", said());
    w.T.clock = true;
    w.adv(15 * SEC); t.fn(); await settle();
    w.adv(15 * SEC); t.fn(); await settle();
    ok(w.calls.idleFor === 2 && again().length === 1 && /no-clock/.test(again()[0]),
      "B: WHEN THE SWEEP RUNS AGAIN IT SAYS SO, ONCE — naming the refusal it ended", again());
    w.T.live = false;
    w.adv(15 * SEC); t.fn(); await settle();
    w.adv(15 * SEC); t.fn(); await settle();
    ok(said().length === 3 && /not-live/.test(said()[2]), "B: and refused again after a run, the refusal is said again — once", said());
    w.sb.BotRuntime.stop();
  }

  if (failed) { console.log("[bot-awake] " + failed + " FAILED of " + asserts); process.exit(1); }
  console.log("[bot-awake] PASS — the bot's idle sweep runs when it is due on whatever tells it the time, and says a refusal once (" +
    asserts + " assertions): an arriving message and a server answer each run a due pass with the interval never run, and no more " +
    "often than the cadence; stopping lets go of both; a refusal is said once per reason, the return to running once, and a later " +
    "refusal again");
})();
