// tests/check-may-advance.js
//
// THE ADVANCE PATH MUST ASK WHETHER IT MAY.
//
// Two rules existed, were correct, were guarded, and were reached by nothing that advances:
//
//   Session    "only a LIVE client authors anything" — its own header names THE STALE-TIMER
//              ADVANCE as what it retires "as a CATEGORY". Scheduler.plan had two call sites, both
//              inside the backend. `grep "Session\\." features/ ui/` returned nothing at all.
//   Continuity "a client that knows it is missing history must not advance" — called in exactly
//              one place: the owner's SEAL gate. It decided whether a snapshot could be published
//              and never whether a song could be played. The right rule on the wrong door.
//
// WHY THIS GUARD IS EXECUTED AND NOT READ. The first version of it was static — it checked that
// "MatrixBridge.mayAdvance" appeared inside _maybeAdvance. Mutation testing then showed that
// wrapping the whole call in `if (false)` left it GREEN, because the string was still there. So
// was deleting the wholeness branch, and so was removing the hold. A textual guard over source can
// only ever prove a name is spelled somewhere; it cannot prove anything runs. Since playback is
// drivable headlessly (check-ceiling-convergence already does it), the honest test is to refuse
// and watch whether an event goes out.

const assert = require("assert");
const { loadInContext } = require("./_load");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

// A controllable clock + timer queue, so the staggered emit can be flushed deterministically.
function fakeEnv() {
  let now = 0;
  const timers = [];
  return {
    clock: { advance: (ms) => { now += ms; } },
    Date: class extends Date { static now() { return now; } },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    flush: () => { timers.splice(0).sort((a, b) => a.at - b.at).forEach((t) => t.fn()); },
  };
}

// verdict is a function so a case can change the answer between ticks.
function makePlayback(verdict) {
  const env = fakeEnv();
  const sent = [];
  const holds = [];
  const np = {
    dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0, skipped: false,
    settings: { chat: "uncategorized", vis: "private", bg: null, maxLen: 120, minLen: 10 },
  };
  const sm = {
    getState: () => ({ nowPlaying: np, rotation: [{ user: "@x:hs" }] }),
    on: () => {}, off: () => {},
  };
  const bridge = {
    async sendEvent(ch, type, content) { sent.push({ type, content }); },
    mayAdvance: () => verdict(),
  };
  const sb = loadInContext(["features/playback.js"], {
    Date: env.Date, Math: env.Math, setTimeout: env.setTimeout, clearTimeout: env.clearTimeout,
    setInterval: env.setInterval, clearInterval: env.clearInterval,
    StreamManager: sm, MatrixBridge: bridge, Logger: { debug() {}, warn() {}, info() {}, error() {} },
  });
  if (sb.Playback.initWiring) sb.Playback.initWiring("!ev:hs");
  if (sb.Playback.onHoldChange) sb.Playback.onHoldChange((r) => holds.push(r));
  return { Playback: sb.Playback, env, sent, holds };
}

// The ceiling path: past maxLen with no local duration. Chosen deliberately because it is an
// EXEMPT path — exempt from the earliest-time gate — so it also proves the exemption does not
// carry over to the fitness question.
function driveCeiling(h) {
  h.env.clock.advance(121 * 1000);
  h.Playback._tick();
  h.env.flush();
}

// ── PART A — a fit client advances ───────────────────────────────────────────────────────────
{
  const h = makePlayback(() => ({ ok: true }));
  driveCeiling(h);
  ok(h.sent.length === 1 && h.sent[0].type === "ddjp.dj.play",
    "A: the control — with mayAdvance saying yes, the ceiling advance goes out exactly as before. "
    + "A gate that blocks everything would pass PART B while breaking the room", h.sent);
}

// ── PART B — a client missing history does NOT advance ───────────────────────────────────────
{
  const h = makePlayback(() => ({ ok: false, reason: "missing-history", state: "short" }));
  driveCeiling(h);
  ok(h.sent.length === 0,
    "B: a client holding a corroborated gap emits NOTHING. This is the fork the whole restraint "
    + "exists to prevent, on the path that actually forks — and until now the rule was consulted "
    + "only by the owner's seal gate, so this event went out", h.sent);
  ok(h.holds.indexOf("missing-history") >= 0,
    "B: APPLIED — and the hold is PUBLISHED. To the user the music simply stopped; silence makes a "
    + "deliberate hold indistinguishable from a hang", h.holds);
}

// ── PART C — a client that is not caught up does NOT advance ─────────────────────────────────
{
  const h = makePlayback(() => ({ ok: false, reason: "not-live", state: "catching-up" }));
  driveCeiling(h);
  ok(h.sent.length === 0,
    "C: a client that is not caught up emits nothing either. Session's header named the stale-timer "
    + "advance as the thing it retired 'as a CATEGORY', and this is the path that proves the "
    + "category now includes it", h.sent);
  ok(h.holds.indexOf("not-live") >= 0, "C: APPLIED — with its own reason, not a generic one", h.holds);
}

// ── PART D — the exemption does not carry ────────────────────────────────────────────────────
// The ceiling is exempt from the EARLIEST-TIME gate, by design: it is clock-only and it is the
// room's no-freeze guarantee. Parts B and C drove that exact path and got silence, which is the
// assertion — `exemptFromGate` waives when this client may act, never whether it is fit to. The
// room does not freeze as a result: every whole client holds the same ceiling and still fires.
{
  const h = makePlayback(() => ({ ok: false, reason: "missing-history", state: "short" }));
  driveCeiling(h);
  ok(h.sent.length === 0,
    "D: the ceiling path is exempt from the timing gate and still refuses when unfit. Two "
    + "different questions that happen to sit next to each other in the same function");
}

// ── PART E — the hold clears, and only on transitions ────────────────────────────────────────
{
  let fit = false;
  const h = makePlayback(() => (fit ? { ok: true } : { ok: false, reason: "missing-history" }));
  driveCeiling(h);
  ok(h.sent.length === 0, "E: blocked while short");
  const holdsAfterBlock = h.holds.length;
  driveCeiling(h);
  ok(h.holds.length === holdsAfterBlock,
    "E: APPLIED — a second refusal emits NOTHING new. The advance path retries every tick, so "
    + "notifying per refusal would fire several times a second for as long as the hold lasts", h.holds);
  fit = true;
  driveCeiling(h);
  ok(h.sent.length === 1, "E: APPLIED — and once the gap fills it advances, with no reset needed", h.sent);
  ok(h.holds[h.holds.length - 1] === null,
    "E: APPLIED — and the hold is cleared, so the banner goes away by itself", h.holds);
}

// ── PART F — an absent or throwing check does not stop the room ──────────────────────────────
// Permissive on failure, restrictive only on a definite no. A backend without Continuity (a lite
// or bot model) must still play, and a transient throw must not silence a client — the costs are
// lopsided. A short client that advances emits an event every whole client REJECTS, which is inert
// and self-heals once the hole fills, because the reducer re-derives rather than patches. A client
// that refuses on an error stops the music for a real person.
{
  const h = makePlayback(() => { throw new Error("boom"); });
  let threw = false;
  try { driveCeiling(h); } catch (e) { threw = true; }
  ok(!threw && h.sent.length === 1,
    "F: a throwing fitness check does not stop the advance — unknown is not a no", { threw, sent: h.sent });

  const h2 = makePlayback(() => undefined);
  driveCeiling(h2);
  ok(h2.sent.length === 1,
    "F: APPLIED — and neither does an absent answer, so a backend that does not implement this "
    + "question still plays music", h2.sent);
}

console.log("[may-advance] PASS — the advance path asks whether it may, and the answer is obeyed "
  + "rather than merely present: a client holding a corroborated gap or still catching up emits "
  + "NOTHING, on the exempt ceiling path too, because exemption waives the timing gate and never "
  + "fitness to author; the refusal is published once per transition so a deliberate hold cannot "
  + "read as a hang, and clears itself when the client recovers; and an absent or throwing check "
  + "lets the room play on, because unknown is not a no (" + checks + " assertions)");
