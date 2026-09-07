// tests/check-playhead.js
//
// TWO DEVICES WITH DIFFERENT LOCAL CLOCKS MUST LAND IN THE SAME PLACE.
//
// `startedAt` is a SERVER timestamp. Elapsed is therefore only meaningful against server time — and
// for the whole of this project's life the UI computed it as `(Date.now() - startedAt) / 1000`: a
// local clock minus a server stamp, which is the true elapsed PLUS that device's own skew. Every
// client seeked to a different point in the same song.
//
// WHY IT READ AS A CONSENSUS BUG AND WAS NOT, which is the part worth keeping. Three symptoms were
// reported together, and the combination identifies it:
//
//   a LATE JOINER landed behind   -> no reload, no history: not the ordering clock
//   the SAME SONG on both         -> the rotation agreed: not the queue
//   they ADVANCED IN STEP         -> startedAt and the agreed length were shared
//
// The schedule is `startedAt + agreedLength` in shared server time, so it fires at the same instant
// everywhere regardless of where each player happens to be. The playhead was wrong; the timing never
// was. Anything that advances in step but displays differently is a rendering-of-time problem, not
// an agreement problem.
//
// This guard exists because the fix shipped WITHOUT one — a straight violation of this project's own
// build law, caught only by auditing the fix against the principles it was written under.

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

// ── PART A — the property, executed: skew must not change the answer ─────────────────────────
{
  const STARTED_AT = 990000;      // the play event's server timestamp
  const SERVER_NOW = 1050000;     // 60s of real elapsed

  function clientWithSkew(skewMs) {
    const sb = loadInContext(["core/logger.js", "features/serverclock.js"], {
      StreamManager: { on: () => {}, off: () => {} },
    });
    const SC = sb.ServerClock;
    // This machine's local clock reads SERVER_NOW + skew.
    SC._setClockForTest(() => SERVER_NOW + skewMs);
    // It observes the same server-stamped event everyone else does — which is what teaches it the
    // offset, purely as a byproduct of normal traffic.
    SC._observe({ ts: STARTED_AT });
    return SC;
  }

  const ahead = clientWithSkew(+60000);    // a minute fast
  const behind = clientWithSkew(-60000);   // a minute slow
  const eAhead = ahead.elapsedSince(STARTED_AT);
  const eBehind = behind.elapsedSince(STARTED_AT);

  ok(typeof eAhead === "number" && typeof eBehind === "number",
    "A: both clients produce an elapsed", { eAhead, eBehind });
  ok(Math.abs(eAhead - eBehind) < 1000,
    "A: APPLIED — two devices whose LOCAL clocks differ by two minutes compute the same elapsed to "
    + "within a second, because both ends of the subtraction are server time. Computing it as "
    + "(Date.now() - startedAt) instead yields each device's skew, silently, in a number that still "
    + "looks entirely plausible", { eAhead, eBehind, apartMs: Math.abs(eAhead - eBehind) });

  // The control: without correcting for skew, the two DO differ — so the assertion above is
  // measuring the correction and not an accident of the fixture.
  const naiveAhead = (SERVER_NOW + 60000) - STARTED_AT;
  const naiveBehind = (SERVER_NOW - 60000) - STARTED_AT;
  ok(Math.abs(naiveAhead - naiveBehind) === 120000,
    "A: APPLIED — and the naive local-clock computation puts them two minutes apart, which is the "
    + "gap the correction closes", { naiveAhead, naiveBehind });
}

// ── PART B — the feature exposes it, and the UI asks rather than recomputing ─────────────────
// Static, because interface.js needs a DOM. Bounded to the loader so a match elsewhere in a
// 4,800-line file cannot stand in for it.
{
  const pb = fs.readFileSync(path.join(__dirname, "..", "features/playback.js"), "utf8");
  ok(/elapsedSec:\s*_elapsedSec/.test(pb),
    "B: Playback exposes its server-time elapsed. ui/ may not touch ServerClock (boundaries rule D) "
    + "and rightly — the UI renders, it does not compute. The feature that already had the answer "
    + "simply was not asked");

  const ui = fs.readFileSync(path.join(__dirname, "..", "ui/interface.js"), "utf8");
  const i = ui.indexOf("function _doLoad()");
  const body = ui.slice(i, ui.indexOf("loadVideoById", i));
  ok(i >= 0 && /w\.elapsedAt\(\)/.test(body),
    "B: APPLIED — the loader seeks with the value handed to it rather than recomputing from a raw "
    + "local clock");

  const call = ui.slice(ui.indexOf("loadVideo(np.song.videoId"), ui.indexOf("loadVideo(np.song.videoId") + 120);
  ok(/\(\) => Playback\.elapsedSec\(np\)/.test(call),
    "B: APPLIED — and the call site is where the server-time answer comes from", call.slice(0, 90));
}

// ── PART C — every OTHER comparison of a server stamp is server-time too ─────────────────────
// The sibling check. Fixing the one caller that was noticed and leaving the rest is this codebase's
// recurring bug — committed twice in the session that produced this guard. Derived by scanning
// rather than by listing what anyone remembered.
{
  const offenders = [];
  const files = ["features/playback.js", "ui/interface.js", "features/medialength.js",
                 "features/mediablocked.js", "features/skip.js", "features/reactions.js"];
  let scanned = 0;
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(__dirname, "..", rel), "utf8").split("\n");
    scanned++;
    lines.forEach((ln, n) => {
      if (/^\s*\/\//.test(ln)) return;                            // a comment describing the bug is fine
      if (!/Date\.now\(\)\s*-\s*\w*\.?[Ss]tartedAt/.test(ln)) return;
      const near = (lines[n - 1] || "") + ln;
      if (/only until|degrades|fallback/i.test(near)) return;     // the documented pre-offset fallback
      offenders.push(rel + ":" + (n + 1));
    });
  }
  ok(scanned === files.length,
    "C: the sibling scan actually read every file it claims to", { scanned, want: files.length });
  ok(offenders.length === 0,
    "C: APPLIED — no code subtracts a SERVER timestamp from the local clock, except the documented "
    + "fallback used until ServerClock has seen its first event. One such line is a whole-room "
    + "desync that still looks plausible in every log", offenders);
}

console.log("[playhead] PASS — where a client starts a song it arrived late to is computed in server "
  + "time on every device: two machines whose local clocks differ by two minutes land within a "
  + "second of each other where the naive computation puts them two minutes apart; the UI asks the "
  + "feature that already computes it rather than reaching for a clock it is not allowed to correct; "
  + "and no other comparison of a server stamp against local time survives except the documented "
  + "pre-offset fallback (" + checks + " assertions)");
