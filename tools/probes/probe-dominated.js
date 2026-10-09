// probe-dominated.js — the DOMINATED pair, with an ADMISSIBILITY GATE.
//
// Two independent audits of this result reached `null` in every tree, including their controls.
// `null` is what you get from a length tally that never received a declaration, and it is
// indistinguishable from a tally that received one and refused it. So this probe refuses to report
// anything until it has PROVED it reached the tally, and it names the stage that broke when it
// hasn't.
//
// THREE THINGS HAVE TO BE TRUE before `state.advance.gateLenSec` can be anything but null, and the
// gate below checks each one separately so a failure says WHICH:
//   1. There is a live playing. `state.nowPlaying` must exist, or nothing has a `pi` to name.
//   2. The declaration is ACCEPTED. `ddjp.play.len` must appear in `deriveBoth().accepted`. It is
//      refused unless it names the pi that is live AT ITS OWN FOLD POSITION — so a declaration
//      built with the wrong `pi`, or with an `l` that folds before the play, vanishes silently.
//      This is the stage both audits almost certainly died at.
//   3. A tier resolves outright. Declarations tally per tier and a TIE cascades down and can end in
//      null with every declaration accepted. Same value from the same tier avoids it.
//
// The field is `state.advance.gateLenSec` — nested under `advance`. `state.gateLenSec` and
// `nowPlaying.lenSec` do not exist, and reading them returns undefined in every tree, which reads
// as agreement.

const path = require("path");
const TREE = process.env.DDJP_TREE || "/home/claude/proj/dev/tree";
const { loadInContext } = require(path.join(TREE, "tests", "_load.js"));
const F = require(path.join(TREE, "tests", "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver } = sb;

const D = StateDeriver.defaultSettings();

// One room per case: a tie cascades to null, so cases must not share a tally.
function measure(sec, opts) {
  const o = opts || {};
  const room = F.playingRoom({ songs: 2 });
  const pi = o.wrongPi ? "$not-a-real-pi" : room.pi(1);
  const ids = ["$d1", "$d2"];
  const log = room.log.concat([
    F.lenDecl(ids[0], room.lastL + 1, room.startTs + 500000, pi, sec, F.RANK.vip, "@a:hs"),
    F.lenDecl(ids[1], room.lastL + 2, room.startTs + 500001, pi, sec, F.RANK.vip, "@b:hs"),
  ]);
  const r = StateDeriver.deriveBoth(F.sortLog(log));
  const acc = new Set(r.accepted);
  return {
    sec,
    hasNowPlaying: !!r.state.nowPlaying,
    declarationsAccepted: ids.filter((i) => acc.has(i)).length,
    hasAdvance: !!r.state.advance,
    gateLenSec: r.state.advance ? r.state.advance.gateLenSec : null,
  };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
// Run before any comparison. If this fails, every reading that follows is a reading of nothing,
// and reporting "identical across all trees" would be reporting that nothing changed nothing.
function admissible() {
  const probe = measure(D.maxLen);
  const fail = (stage, detail) => {
    console.log("INADMISSIBLE — the probe never reached the length tally.");
    console.log("  broke at: " + stage);
    console.log("  detail:   " + detail);
    console.log("  Nothing below this line would mean anything, so nothing is printed.");
    process.exit(1);
  };
  if (!probe.hasNowPlaying) fail("no live playing", "state.nowPlaying is absent — the fixture never started a song");
  if (probe.declarationsAccepted === 0) {
    fail("declarations REFUSED", "0 of 2 `ddjp.play.len` events are in accepted[] — almost always a pi "
      + "that is not live at the event's own fold position, or an `l` that folds before the play");
  }
  if (!probe.hasAdvance) fail("no advance block", "state.advance is absent");
  if (probe.gateLenSec === null) fail("tally resolved to null", "declarations accepted but no tier resolved — a tie cascades to null");
  console.log("ADMISSIBLE — reached the tally: " + probe.declarationsAccepted +
              "/2 declarations accepted, gateLenSec=" + probe.gateLenSec + " at declared=" + probe.sec);
}

// Self-test of the gate: a deliberately mis-targeted declaration MUST be caught by it. Without
// this, the gate itself is untested code certifying everything downstream.
if (process.argv.indexOf("--selftest") >= 0) {
  const bad = measure(D.maxLen, { wrongPi: true });
  console.log("gate self-test — declaration aimed at a pi that is not live:");
  console.log("  declarationsAccepted=" + bad.declarationsAccepted + "  gateLenSec=" + bad.gateLenSec);
  console.log("  " + (bad.declarationsAccepted === 0
    ? "the gate's stage-2 condition catches this — a null here is DISTINGUISHABLE from a real null"
    : "UNEXPECTED — the gate cannot tell a refused declaration from a resolved one"));
  process.exit(0);
}

admissible();

const CASES = [D.maxLen, D.maxLen - 1, D.maxLen + 1, D.minLen, D.minLen - 1, D.minLen + 1, D.maxLen * 3, 1, 0];
const out = CASES.map((s) => measure(s));
console.log(JSON.stringify(out, null, 1));
