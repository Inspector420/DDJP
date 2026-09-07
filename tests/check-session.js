// tests/check-session.js
// WALL: A CLIENT MAY NOT ACT AS THOUGH IT KNOWS THE PRESENT WHEN IT DOES NOT.
//
// The old tree had no wake detection of any kind — verified: no visibilitychange listener, no
// online/offline listener, and the only sync-state listener was a one-shot at startup that
// removed itself. There was no code path by which a client could learn it had been away, so this
// property could not be asserted at all. Everything below therefore FAILS against the old tree by
// construction; it is new behaviour, not a regression test.
//
// PART A — only LIVE authors. The single rule that retires a whole bug category.
// PART B — a clock jump suspends. This is the sleep detector, and it needs no browser API.
// PART C — resuming does NOT go straight to LIVE. Draining a backlog is being behind.
// PART D — the settle is measured in EVENTS STOPPING, not time passing. A slow backlog over a
//          slow link takes real time; "no new events for N ms" is the honest test.
// PART E — replay finishing does not mean caught up.
// PART F — a first beat is not a jump. Getting this wrong suspends every client at startup.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

function fail(msg, got) {
  console.log("[session] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const { Session } = loadInContext(["backends/backend1/session.js"], {});

// A controllable world: no timers, no clock, no browser.
let NOW = 1000000;
let HEAD = 0;
Session.attach({
  now: () => NOW,
  setInterval: () => 1,
  clearInterval: () => {},
  headCount: () => HEAD,
  settleMs: () => 500,
});

// ── PART A — only LIVE authors ───────────────────────────────────────────────────────────────
{
  for (const p of Session.PHASES) {
    const expect = (p === Session.LIVE);
    ok(Session.phaseMayAuthor(p) === expect,
      "A: only LIVE may author — " + p + " should be " + expect, { phase: p });
  }
  // and through the live accessor, not just the pure helper
  Session._setPhaseForTest(Session.REPLAYING);
  ok(Session.mayAuthor() === false, "A: APPLIED — a replaying client must not author");
  Session._setPhaseForTest(Session.LIVE);
  ok(Session.mayAuthor() === true, "A: APPLIED — a live client may author");
}

// ── PART B — a clock jump is detected without any browser API ────────────────────────────────
{
  const beat = Session.BEAT_MS;
  ok(Session.jumpDetected(1000, 1000 + beat, beat) === false,
    "B: a beat arriving on time is not a jump");
  ok(Session.jumpDetected(1000, 1000 + beat * 2, beat) === false,
    "B: ordinary lateness (2x) is not a jump — background throttling must not suspend us");
  ok(Session.jumpDetected(1000, 1000 + beat * 100, beat) === true,
    "B: a beat 100x late IS a jump");
  ok(Session.jumpDetected(1000, 1000 + 2 * 60 * 60 * 1000, beat) === true,
    "B: a two-hour sleep is a jump");

  // APPLIED: drive the real beat and assert the phase actually moves.
  Session._setPhaseForTest(Session.LIVE);
  Session._setLastBeatForTest(NOW);
  NOW += 2 * 60 * 60 * 1000;                       // the laptop slept
  Session._beatForTest();
  ok(Session.phase() === Session.SUSPENDED,
    "B: APPLIED — a live client that slept must be SUSPENDED, not still LIVE", Session.phase());
  ok(Session.mayAuthor() === false,
    "B: APPLIED — and it must not author with ~20 stale timers about to fire");
}

// ── PART C — resuming does not go straight to LIVE ───────────────────────────────────────────
{
  NOW += Session.BEAT_MS;
  Session._beatForTest();
  ok(Session.phase() === Session.CATCHING_UP,
    "C: a resumed client is CATCHING-UP, never straight to LIVE", Session.phase());
  ok(Session.mayAuthor() === false,
    "C: and it still may not author — draining a backlog is being behind");
}

// ── PART D — the settle is events stopping, not time passing ─────────────────────────────────
{
  ok(Session.settled(5, 7, 999999, 500) === false,
    "D: the log grew — no amount of elapsed time settles that");
  ok(Session.settled(5, 5, 100, 500) === false,
    "D: steady but not yet for long enough");
  ok(Session.settled(5, 5, 500, 500) === true,
    "D: steady for the settle window");

  // APPLIED: a burst arriving keeps the window open for as long as it lasts.
  HEAD = 10;
  NOW += Session.BEAT_MS; Session._beatForTest();     // head moved -> restart the settle
  ok(Session.phase() === Session.CATCHING_UP, "D: APPLIED — still catching up while events arrive");
  HEAD = 20;
  NOW += Session.BEAT_MS; Session._beatForTest();
  ok(Session.phase() === Session.CATCHING_UP, "D: APPLIED — a continuing burst holds it down");
  NOW += Session.BEAT_MS; Session._beatForTest();     // head steady, settle elapsed
  ok(Session.phase() === Session.LIVE,
    "D: APPLIED — once the stream settles it goes LIVE", Session.phase());
}

// ── PART E — replay finishing is not the same as caught up ───────────────────────────────────
{
  Session.enterRoom("!room:hs");
  ok(Session.phase() === Session.REPLAYING, "E: entering a room means replaying");
  ok(Session.mayAuthor() === false, "E: nothing is authored during replay — a checkpoint sealed "
    + "mid-replay banks a moment that already ended");
  Session.replayFinished();
  ok(Session.phase() === Session.CATCHING_UP,
    "E: replay finishing goes to CATCHING-UP, not LIVE — a long replay may have a backlog behind it",
    Session.phase());
}

// ── PART F — a first beat is not a jump ──────────────────────────────────────────────────────
{
  ok(Session.jumpDetected(0, NOW, Session.BEAT_MS) === false,
    "F: no previous beat is a FIRST beat, not a jump — otherwise every client suspends at startup");
  ok(Session.jumpDetected(null, NOW, Session.BEAT_MS) === false,
    "F: and a missing value likewise");
}

console.log("[session] PASS — a client knows what phase it is in and only authors when it knows "
  + "the present: only LIVE authors; a clock jump suspends with no browser API involved; resuming "
  + "drains through CATCHING-UP rather than jumping to LIVE; the settle is the log going quiet "
  + "rather than time passing, so a slow backlog holds it down for as long as it lasts; replay "
  + "finishing is not caught up; and a first beat is not a jump");
