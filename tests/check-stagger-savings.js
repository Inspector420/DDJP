// tests/check-stagger-savings.js
//
// THE LADDER'S SAVING ACTUALLY HAPPENS.
//
// Taking turns by rank is only half of the cascade. The half that pays for it is the RE-CHECK at
// fire time: you wait your slot, and then you look again and stay silent if the room no longer
// needs you. Without the second half a stagger costs latency and saves nothing — every client
// still speaks, just politely spaced out.
//
// Two of those silences were enforced by nothing. Both were mutation-proven: disabling either left
// the ENTIRE suite green.
//
//   play.len   — "the room already agrees at my value" → say nothing.
//                Its own comment states the cost of losing it: at song start nothing is declared,
//                so every sighted client sees `agreed === null` and posts. One message per song
//                becomes one message PER SIGHTED CLIENT per song.
//   media.len  — "an equal-or-higher rank already answered with (nearly) my value" → say nothing,
//                and "a higher rank answered and I do not strongly disagree" → defer.
//                Same shape: without them a ten-person room emits ten identical display reports
//                for every song.
//
// WHY NOTHING NOTICED, and why this file exists rather than a line added to an existing guard:
// these are COST properties, not correctness ones. The room derives the same state either way, so
// every guard that checks what the room *is* stays green while the saving quietly stops happening.
// A rule whose only symptom is a bigger bill needs a guard that measures the bill.
//
// The third re-check of this family — `media.skip`'s `skipWarranted` at fire time — is already
// held by check-blocked-skip, and that one is a correctness property (it authors an advance).
// Named here so the set is visible in one place rather than looking like an omission.
//
// GUARANTEES, each with its control, because "no message was sent" is the pass state and a harness
// that sends nothing at all would produce it for free:
//   PART A — play.len is SILENT when the room already agrees at my value.
//   PART B — play.len SPEAKS when the room agrees at a different value, and when it agrees at
//            nothing. The saving must not become a mute.
//   PART C — media.len is SILENT when an equal-or-higher rank already answered with my value.
//   PART D — media.len is SILENT when a HIGHER rank already answered close to my value. Asserted
//            as behaviour, and deliberately NOT attributed to the `rank > myRank` defer branch:
//            that branch is a strict SUBSET of the `rank >= myRank` silence beneath it (a higher
//            rank is also an equal-or-higher one, and the value test is identical), so it can
//            never be the sole reason for a return. Removing it changes nothing, which mutation
//            testing showed by leaving this guard green. The first draft of PART D claimed the
//            defer branch and passed for the wrong reason — the exact defect this file is about,
//            written into the file about it.
//   PART E — media.len SPEAKS when nobody has answered, and when it strongly disagrees with what
//            a higher rank said. Deferring must not become censorship.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[stagger-savings] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// ── PLAYBACK HARNESS ──────────────────────────────────────────────────────────────────────────
// Drives the real declaration path: capture at PLAYING, fire the rank slot, see what reaches the
// wire. `agreed` is what the room has already settled on for this playing.
function playbackRun(opts) {
  const o = opts || {};
  let now = 0;
  const timers = [];
  const sent = [];
  const np = {
    dj: "@dj:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
    settings: { vouchJitter: 1000, maxLen: 600, minLen: 10, minGate: 8000, graceMs: 1000, presendMs: 300 },
  };
  const state = {
    nowPlaying: np,
    rotation: [{ user: "@dj:hs", pending: [] }],
    settings: np.settings,
    advance: { pi: "$p1", gateLenSec: (o.agreed === undefined ? null : o.agreed), earliestAt: 0, ceilingAt: 600000 },
  };
  const sb = loadInContext(["features/playback.js"], {
    Date: { now: () => now },
    Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round, abs: Math.abs },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: () => state, on: () => {}, off: () => {} },
    MatrixBridge: { async sendEvent(ch, type, content) { sent.push({ type: type, content: content }); } },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "uncategorized" },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const P = sb.Playback;
  P.initWiring("!ev:hs");
  P.setDurationProvider(() => ({ videoId: "AAAAAAAAAAA", seconds: o.mine }));
  P.setDuration("AAAAAAAAAAA", o.mine);
  now = 7000;
  timers.splice(0).sort((a, b) => a.at - b.at).forEach((t) => t.fn());
  return sent.filter((s) => s.type === "ddjp.play.len");
}

// ── PART A — play.len stays silent when the room already agrees ───────────────────────────────
(() => {
  const out = playbackRun({ mine: 200, agreed: 200 });
  ok(out.length === 0,
    "A: APPLIED — the room already agrees at 200s, so this client says nothing. Without this bail "
    + "every sighted client declares: at song start nothing is agreed, so each one sees `null`, "
    + "and one message per song becomes one message PER SIGHTED CLIENT per song. Nothing else in "
    + "the suite notices, because the room derives the same state either way", out.map((x) => x.content));
})();

// ── PART B — and it still speaks when it should ───────────────────────────────────────────────
(() => {
  const disagree = playbackRun({ mine: 200, agreed: 331 });
  ok(disagree.length === 1 && disagree[0].content.sec === 200,
    "B: the room agreeing at a DIFFERENT value is exactly when this client must speak — the bail "
    + "is 'already covered', not 'stay quiet'", disagree.map((x) => x.content));

  const nothing = playbackRun({ mine: 200, agreed: null });
  ok(nothing.length === 1 && nothing[0].content.sec === 200,
    "B: and with the room agreeing on nothing, somebody has to go first. A saving that silenced "
    + "this would leave the gate on its grace floor for every song", nothing.map((x) => x.content));
})();

// ── MEDIALENGTH HARNESS ───────────────────────────────────────────────────────────────────────
// `_answerNow` is reached through the rank slot. Drive it the way production does: seed the report
// table through the real ingest path, then let the timer fire.
function mediaLenRun(opts) {
  const o = opts || {};
  let now = 0;
  const timers = [];
  const sent = [];
  const np = { dj: "@dj:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
               settings: { vouchJitter: 1000 } };
  const state = { nowPlaying: np, settings: np.settings, advance: { pi: "$p1" } };
  const sb = loadInContext(["features/medialength.js"], {
    Date: { now: () => now },
    Math: Math,
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: () => state, on: () => {}, off: () => {} },
    MatrixBridge: { async sendEvent(ch, type, content) { sent.push({ type: type, content: content }); } },
    Capabilities: { staggerMs: () => 0, atLeast: (r) => r >= 100 },
    Store: { stagger: { offsetMs: () => 0 } },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const M = sb.MediaLength;
  M.init("!ev:hs");
  M.setMyRank(o.myRank);
  // Somebody else's report arrives first, through the real ingest path.
  if (o.theirs) {
    M._ingest({ content: { v: "AAAAAAAAAAA", d: o.theirs.d }, senderRank: o.theirs.rank, l: 1 });
  }
  M.recordLocalMeasured("AAAAAAAAAAA", o.mine);
  now = 60000;
  timers.splice(0).sort((a, b) => a.at - b.at).forEach((t) => t.fn());
  return sent.filter((s) => s.type === "ddjp.media.len");
}

// ── PART C — media.len is silent when an equal rank already said my value ─────────────────────
(() => {
  const out = mediaLenRun({ myRank: 20, mine: 200, theirs: { rank: 20, d: 200 } });
  ok(out.length === 0,
    "C: APPLIED — an equal rank has already reported (nearly) my value, so this client adds "
    + "nothing and stays quiet. Without it a ten-person room emits ten identical display reports "
    + "for every song, and no correctness guard can see the difference", out.map((x) => x.content));
})();

// ── PART D — silent when a HIGHER rank already answered close to my value ─────────────────────
// The behaviour is real and worth holding. WHICH line produces it is not what this asserts, and
// that is deliberate: the `rank > myRank` defer branch is a strict subset of the `rank >= myRank`
// silence below it, so it can never fire alone. See the header.
(() => {
  const out = mediaLenRun({ myRank: 20, mine: 200, theirs: { rank: 100, d: 201 } });
  ok(out.length === 0,
    "D: APPLIED — a higher rank answered and this client broadly agrees, so it says nothing. The "
    + "ladder exists so the most trustworthy answer arrives first; a junior repeating it a second "
    + "later spends a message to change nothing", out.map((x) => x.content));
})();

// ── PART E — deferring is not censorship ──────────────────────────────────────────────────────
(() => {
  const alone = mediaLenRun({ myRank: 20, mine: 200, theirs: null });
  ok(alone.length === 1,
    "E: with nobody having answered, this client speaks. A saving that silenced the first speaker "
    + "would leave the room with no display length at all", alone.map((x) => x.content));

  const M = loadInContext(["features/medialength.js"], {
    Date: Date, Math: Math, setTimeout: () => 0, clearTimeout: () => {},
    StreamManager: { getState: () => ({}), on: () => {}, off: () => {} },
    MatrixBridge: { async sendEvent() {} }, Capabilities: { staggerMs: () => 0, atLeast: () => false },
    Store: { stagger: { offsetMs: () => 0 } }, Logger: { debug() {}, info() {}, warn() {}, error() {} },
  }).MediaLength;
  const far = M.DISAGREE_SEC + 5;
  const loud = mediaLenRun({ myRank: 20, mine: 200, theirs: { rank: 100, d: 200 + far } });
  ok(loud.length === 1,
    "E: APPLIED — but a STRONG disagreement is still spoken, even against a higher rank. Deferring "
    + "is 'you already said what I would have said'; it is not 'seniors are never wrong', and "
    + "collapsing the two would make the display length unchallengeable",
    { disagreeSec: M.DISAGREE_SEC, sent: loud.map((x) => x.content) });
})();

if (failures) process.exit(1);
console.log("[stagger-savings] PASS — the cascade's saving is enforced rather than assumed: a "
  + "declaration the room has already agreed at is not repeated, a display length an equal-or-"
  + "higher rank has already given is not duplicated, and a junior defers to a senior it broadly "
  + "agrees with — while each silence keeps its control, so the saving cannot quietly become a "
  + "mute. These are COST properties, so every correctness guard stays green when they break, "
  + "which is why both of the first two were enforced by nothing until this file existed");
