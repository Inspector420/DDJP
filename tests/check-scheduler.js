// tests/check-scheduler.js
// WALL: A DELAYED JOB IS A DESCRIPTION, NOT A SNAPSHOT.
//
// Two failures in the old tree motivate every part of this, and both are asserted here by
// EXECUTION rather than by reading the source:
//
//   (1) STALE CAPTURE. The vouch pass re-read the event list at fire time — good — but captured
//       its RANK and the room SETTINGS when it was scheduled. Sleep through a rank change and it
//       published under the wrong rank. Re-checking the job is not the same as re-reading the
//       inputs, and only one of the two was being done.
//   (2) NO LATENESS NOTION. ~20 setTimeout sites and nothing anywhere noticed a timer firing hours
//       late against a world that had moved on.
//
// PART A — the getters are read at FIRE time, never at plan time. (1).
// PART B — a job that fires far late is RE-PLANNED, not run. (2).
// PART C — ordinary lateness still runs. A staleness rule that trips on a busy main thread would
//          be worse than none.
// PART D — `stillNeeded` is MANDATORY and is actually consulted. The old seal path shipped with no
//          re-check at all and nothing noticed, because nothing could.
// PART E — a non-LIVE client does not act, and is not re-planned into a spin.
// PART F — coalescing: a burst of triggers is one action.
// PART G — a room change cancels everything, in one place.
// PART H — urgent skips the ladder. Exactly one reason: a detected deletion.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

function fail(msg, got) {
  console.log("[scheduler] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const sb = loadInContext([
  "backends/backend1/ranks.js",
  "backends/backend1/session.js",
  "backends/backend1/scheduler.js",
], {});
const { Scheduler, Session, Ranks } = sb;

let NOW = 500000;
const fired = [];
Scheduler.attach({
  now: () => NOW,
  setTimeout: () => 1,            // never actually fires; the guard fires it deliberately
  clearTimeout: () => {},
  random: () => 0,                // deterministic jitter
});
Session.attach({ now: () => NOW, setInterval: () => 1, clearInterval: () => {}, headCount: () => 0 });
Session._setPhaseForTest(Session.LIVE);

// ── PART 0 — the settle floor is APPLIED, not merely carried ─────────────────────────────────
// minDelayMs was set by both of the Scheduler's callers and read by NOBODY. slotMs answers "when
// is my turn", and for the owner the honest answer is zero — so a job whose entire value is the
// re-check it runs before firing had NO window at all, for exactly the client that hit the
// stale-seal bug the floor was written to fix.
//
// Its guard asserted `typeof spec.minDelayMs === "number" && spec.minDelayMs > 0` — that the field
// was SET, never that anything consulted it. Green for as long as the property was absent, which
// is the decorative-assertion shape PART A below also records. So this asserts the DELAY.
{
  const ownerSpec = (over) => Object.assign({
    rank: () => Ranks.LADDER[0].level,       // tier 0: slot is zero by design
    spacing: () => 1000,
    stillNeeded: () => true,
    run: () => {},
  }, over || {});

  const bare = Scheduler.plan("floor:none", ownerSpec());
  ok(bare.delay === 0, "0: the control — an owner with no floor plans at delay zero, as the ladder intends", bare);
  Scheduler.cancel("floor:none");

  const floored = Scheduler.plan("floor:set", ownerSpec({ minDelayMs: 4000 }));
  ok(floored.delay >= 4000,
    "0: a plan carrying minDelayMs waits AT LEAST that long, so the re-check it exists to perform "
    + "has something to observe. Without this the owner's stillNeeded compared a head against "
    + "itself", floored);
  Scheduler.cancel("floor:set");

  // A floor is a MINIMUM, never a replacement: a junior whose slot already exceeds it must not be
  // pulled forward to the floor, or the ladder inverts and the room's cheapest client acts first.
  const junior = Scheduler.plan("floor:junior", ownerSpec({
    rank: () => Ranks.LADDER[Ranks.LADDER.length - 1].level, spacing: () => 10000, minDelayMs: 500,
  }));
  ok(junior.delay > 500,
    "0: APPLIED — and a slot LONGER than the floor is kept, so the floor cannot pull a junior "
    + "ahead of its turn", junior);
  Scheduler.cancel("floor:junior");
}

// ── PART A — nothing is captured ─────────────────────────────────────────────────────────────
{
  // NOTE ON THIS TEST'S OWN HISTORY, because it is the point of the exercise.
  // The first version read `run: () => { seenRank = rank; }` — the guard's own closure over its
  // own variable. It passed whatever the scheduler did, because it was reading the live variable
  // directly rather than anything the module produced. Mutating the scheduler to capture at plan
  // time left it GREEN. It was a decorative assertion in a guard written minutes earlier, which
  // is precisely where this project's build law says to look for one.
  //
  // The property is now observable because the SCHEDULER HANDS THE JOB its fire-time values, so
  // the assertion is on `ctx` — something only the module can produce.
  let rank = Ranks.levelOf("guest");
  let ctxRank = null, ctxRankAtCheck = null;
  Scheduler.plan("a", {
    rank: () => rank,                         // a GETTER, not a value
    spacing: () => 1000,
    stillNeeded: (ctx) => { ctxRankAtCheck = ctx.rank; return true; },
    run: (ctx) => { ctxRank = ctx.rank; },
  });
  // the promotion lands while the job is waiting its slot
  rank = Ranks.levelOf("owner");
  Scheduler._fireNowForTest("a");
  ok(ctxRank === Ranks.levelOf("owner"),
    "A: APPLIED — the scheduler must HAND the job the rank as of FIRE time, not the one it was "
    + "planned with. Asserted on what the module produced, not on the guard's own variable",
    { handed: ctxRank, expected: Ranks.levelOf("owner"), plannedWith: Ranks.levelOf("guest") });
  ok(ctxRankAtCheck === Ranks.levelOf("owner"),
    "A: APPLIED — and the re-check sees the same fresh value, so it cannot stand down on stale "
    + "grounds either", { handed: ctxRankAtCheck });
}

// ── PART B — a job that fires far late is re-planned, not run ────────────────────────────────
{
  ok(Scheduler.isStale(1000, 900) === false, "B: early is not stale");
  ok(Scheduler.isStale(1000, 1500) === false, "B: mildly late is not stale");
  ok(Scheduler.isStale(1000, 2 * 60 * 60 * 1000) === true, "B: two hours late IS stale");
  ok(Scheduler.isStale(30000, 45000) === false,
    "B: the rule SCALES — a long ladder wait is not judged by a short window's margin");

  let ran = 0;
  Scheduler.plan("b", {
    rank: () => Ranks.levelOf("player"), spacing: () => 1000,
    stillNeeded: () => true, run: () => { ran++; },
  });
  const plannedAt = NOW;
  NOW += 2 * 60 * 60 * 1000;                  // the laptop slept while this was pending
  const r = Scheduler._fireNowForTest("b");
  ok(ran === 0,
    "B: APPLIED — a job whose timer fired after a two-hour sleep must NOT run", { ran: ran });
  ok(r && r.reason === "stale-replanned",
    "B: APPLIED — it must be re-planned against the world as it is now", r);
  ok(Scheduler.isPending("b") === true, "B: APPLIED — and it is pending again");
  NOW = plannedAt;
}

// ── PART C — ordinary lateness still runs ────────────────────────────────────────────────────
{
  let ran = 0;
  Scheduler.plan("c", {
    rank: () => Ranks.levelOf("owner"), spacing: () => 1000,
    stillNeeded: () => true, run: () => { ran++; },
  });
  NOW += 300;                                  // a busy main thread, not a sleep
  Scheduler._fireNowForTest("c");
  ok(ran === 1,
    "C: APPLIED — a staleness rule that trips on ordinary lateness would be worse than none", { ran: ran });
}

// ── PART D — stillNeeded is mandatory AND consulted ──────────────────────────────────────────
{
  const refused = Scheduler.plan("d-no-check", {
    rank: () => 0, spacing: () => 1000, run: () => {},
  });
  ok(refused && refused.ok === false && refused.reason === "no-stillNeeded",
    "D: a plan without a re-check must be REFUSED, not silently accepted", refused);

  let ran = 0, needed = true;
  Scheduler.plan("d", {
    rank: () => Ranks.levelOf("owner"), spacing: () => 1000,
    stillNeeded: () => needed, run: () => { ran++; },
  });
  needed = false;                              // the team covered it while we waited
  const r = Scheduler._fireNowForTest("d");
  ok(ran === 0, "D: APPLIED — the job stands down when it is no longer needed", { ran: ran });
  ok(r && r.reason === "no-longer-needed", "D: APPLIED — and says so", r);
}

// ── PART E — a non-LIVE client does not act ──────────────────────────────────────────────────
{
  let ran = 0;
  Session._setPhaseForTest(Session.CATCHING_UP);
  Scheduler.plan("e", {
    rank: () => Ranks.levelOf("owner"), spacing: () => 1000,
    stillNeeded: () => true, run: () => { ran++; },
  });
  const r = Scheduler._fireNowForTest("e");
  ok(ran === 0, "E: APPLIED — a client draining a backlog must not author", { ran: ran });
  ok(r && r.reason === "not-live", "E: APPLIED — and the reason is the phase, not the job", r);
  ok(Scheduler.isPending("e") === false,
    "E: dropped rather than re-planned — re-planning while suspended would spin");
  Session._setPhaseForTest(Session.LIVE);
}

// ── PART F — coalescing ──────────────────────────────────────────────────────────────────────
{
  let ran = 0;
  const spec = { rank: () => Ranks.levelOf("owner"), spacing: () => 1000,
                 stillNeeded: () => true, run: () => { ran++; } };
  Scheduler.plan("f", spec);
  const second = Scheduler.plan("f", spec);
  const third = Scheduler.plan("f", spec);
  ok(second.coalesced === true && third.coalesced === true,
    "F: a burst of triggers coalesces to one pending action", { second: second, third: third });
  Scheduler._fireNowForTest("f");
  ok(ran === 1, "F: APPLIED — and runs exactly once", { ran: ran });
}

// ── PART G — a room change cancels everything, in one place ──────────────────────────────────
{
  const spec = (n) => ({ rank: () => 0, spacing: () => 1000, stillNeeded: () => true, run: () => {} });
  Scheduler.plan("g1", spec()); Scheduler.plan("g2", spec()); Scheduler.plan("g3", spec());
  ok(Scheduler.pending().length >= 3, "G: three jobs pending", Scheduler.pending());
  const n = Scheduler.cancelAll();
  ok(n >= 3 && Scheduler.pending().length === 0,
    "G: APPLIED — one owner clears them all, so no module can forget its own timer", { cancelled: n });
}

// ── PART H — urgent skips the ladder ─────────────────────────────────────────────────────────
{
  const guest = Ranks.levelOf("guest");
  const normal = Scheduler.slotMs({ rank: () => guest, spacing: () => 1000, urgent: false });
  const urgent = Scheduler.slotMs({ rank: () => guest, spacing: () => 1000, urgent: true });
  ok(normal >= 1000,
    "H: a guest normally waits its tier's slot — seniors get first refusal", { normal: normal });
  ok(urgent < 1000,
    "H: APPLIED — a DETECTED DELETION skips the rank ladder (jitter only). That is the ONE reason "
    + "to break it; routine under-coverage stays lazy or the ladder stops saving anything",
    { urgent: urgent });
}

// ── the shared turn counter ──────────────────────────────────────────────────────────────────
{
  ok(Scheduler.turnsPassed([1, 2, 3, 4, 5], 2) === 3, "turns are counted in EVENTS, not seconds");
  ok(Scheduler.turnsPassed([], 0) === 0, "and an empty log is zero turns, not an error");
}

console.log("[scheduler] PASS — a delayed job is a description rather than a snapshot: its rank "
  + "and dials are read at FIRE time so sleeping through a promotion cannot publish under the old "
  + "rank; a job that fires far late is re-planned against the world as it is now while ordinary "
  + "lateness still runs; the re-check is mandatory and refused if absent; a client that is not "
  + "caught up does not author and is not spun; bursts coalesce; one owner cancels every timer on "
  + "a room change; and only a detected deletion skips the ladder");
