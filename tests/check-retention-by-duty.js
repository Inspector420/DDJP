// tests/check-retention-by-duty.js
// WALL: WHAT I KEEP IS DECIDED BY MY OWN BAR, and by the same comparison that decides what I vouch.
//
// `mayRetire` ended with `satisfiedTier(...) !== null` — ABSOLUTE. Anyone's coverage discharged
// anyone's storage, so a staff client dropped its last copy of an event because six guests had
// vouched it. That is the don't-trust-down violation Step 5 removed from the seal gate and the
// substitute ladder, surviving in a third place: the one whose failure mode is losing history rather
// than sealing early.
//
// A NOTE ON THE DESIGN'S WORDING, because following it literally is a bug. §3.8 says "hold an event
// while you still owe it a vouch — owesVouch returning true. Discharged means droppable." Inverting
// owesVouch does NOT give a retention rule:
//
//   my own event, nobody has vouched it   ->  owesVouch = false  ->  "discharged"  ->  DROP
//
// You never owe yourself a vouch, so your own events read as discharged the instant you publish them
// — and they are exactly the events you are the last holder of. The thing to share is the COMPARISON
// INSIDE owesVouch (`protectedFor`), not owesVouch itself; the never-vouch-yourself clause belongs to
// vouching duty alone. Same family as §14.3, where `eligible()` leaked that clause through repair.
//
// Guarantees:
//   PART A — retirability is rank-relative: the same event with the same coverage is droppable for a
//     junior client and not for a senior one.
//   PART B — MY OWN unvouched event is never retirable. The trap above.
//   PART C — banked below a floor is retirable regardless of coverage, and that is the other arm.
//   PART D — quantity below me never discharges me.
//   PART E — one home: mayRetire asks for the comparison rather than restating it.
//   PART F — an unknown rank holds MORE, not less.

const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

function fail(msg, got) {
  console.log("[retention-by-duty] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  // The record layer, the duty layer and the repair layer are ONE module now. The old split was by
  // MECHANISM — what a record is, who owes one, how to rebuild — which is what let a single concept
  // live in five files and drift between them.
  "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
  "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
  "backends/backend1/statederiver.js",
]);
const { Ranks, TrustPolicy, Vouch, StateDeriver } = C;
const R = (n) => Ranks.levelOf(n);
const ME = "@me:hs";

// A room that has switched guest vouching on, so "six guests" is a bar that exists to be applied at
// the wrong level. Under the shipped defaults guest is `never` and every case below would read the
// same for the uninteresting reason.
const S = (function () {
  const base = StateDeriver.defaultSettings();
  const t = base.vouchTable.map((r) => ({ enough: r.enough, always: r.always }));
  t[Ranks.NAMES.indexOf("guest")].enough = 6;
  return Object.assign({}, base, { vouchTable: t });
})();

const guests = (n) => Array.from({ length: n }, (_, i) => ({ u: "@g" + i + ":hs", r: R("guest") }));
const author = { u: "@author:hs", r: R("player") };

// ── PART A: rank-relative ────────────────────────────────────────────────────────────────────
{
  const cov = guests(6);
  ok(TrustPolicy.satisfiedTier(cov, author, S) === 5,
    "A: APPLIED — six guests must satisfy the guest row and no higher, or nothing below discriminates",
    TrustPolicy.satisfiedTier(cov, author, S));

  ok(Vouch.mayRetire(10, cov, author, null, S, R("guest")) === true,
    "A: a GUEST may drop an event six guests have covered — its own bar is met");
  ok(Vouch.mayRetire(10, cov, author, null, S, R("staff")) === false,
    "A: a STAFF client may NOT — six guests do not discharge a staff bar, and dropping is the one " +
    "action that actually loses history");
  ok(Vouch.mayRetire(10, cov, author, null, S, R("owner")) === false,
    "A: nor the owner, who is discharged by nobody");
}

// ── PART B: my own event ─────────────────────────────────────────────────────────────────────
{
  const mine = { u: ME, r: R("staff") };
  ok(TrustPolicy.owesVouch(R("staff"), ME, mine, [], S) === false,
    "B: APPLIED — I never owe MY OWN event a vouch, which is what makes the design's wording a trap",
    TrustPolicy.owesVouch(R("staff"), ME, mine, [], S));
  ok(Vouch.mayRetire(10, [], mine, null, S, R("staff")) === false,
    "B: and I must still HOLD it — an event nobody has vouched is one I am the last holder of, " +
    "whoever wrote it");

  // Once others have covered it at my bar, it becomes droppable like anything else.
  const covered = [{ u: "@h1:hs", r: R("high-staff") }, { u: "@h2:hs", r: R("high-staff") }];
  ok(TrustPolicy.satisfiedTier(covered, mine, S) === 1, "B: APPLIED — two high-staff must satisfy tier 1");
  ok(Vouch.mayRetire(10, covered, mine, null, S, R("staff")) === true,
    "B: my own event IS droppable once others have covered it at my bar");
}

// ── PART C: the other arm — banked below a floor ─────────────────────────────────────────────
{
  ok(Vouch.mayRetire(5, [], author, 10, S, R("owner")) === true,
    "C: an event below the floor is retirable however thin its coverage — a checkpoint has banked it");
  ok(Vouch.mayRetire(10, [], author, 10, S, R("owner")) === true,
    "C: including the boundary event itself, which the floor's seed already carries");
  ok(Vouch.mayRetire(11, [], author, 10, S, R("owner")) === false,
    "C: but not one above it");
  // The floor arm is gated elsewhere: eventcache only supplies a floorL when earnsForget says so —
  // and since Step 12 a SUBSTITUTE floor passes that gate too. That is the promotion, and it is why
  // the arm above is now reachable through a quorum rather than only through my own or the owner's
  // work. A demoted floor is not: "stale" earns nothing, which is what stops a doubtful floor
  // licensing further forgetting.
  ok(TrustPolicy.earnsForget("quorum") === true,
    "C: a substitute floor now earns forgetting (Step 12) — this arm IS reachable through one");
  ok(TrustPolicy.earnsForget("stale") === false,
    "C: but a demoted floor earns nothing further");
}

// ── PART D: quantity below me never discharges me ───────────────────────────────────────────
{
  const a = Vouch.mayRetire(10, guests(6), author, null, S, R("staff"));
  const b = Vouch.mayRetire(10, guests(50), author, null, S, R("staff"));
  ok(a === false && b === false,
    "D: fifty guests read the same as six to a staff client — nothing below you ever adds up",
    { six: a, fifty: b });
}

// ── PART E: one home for the comparison ──────────────────────────────────────────────────────
// mayRetire must ASK. A second copy of `satisfiedTier(...) <= myTier` is how the seal gate and the
// vouching path came to disagree, and this is the third site of the same rule. Static and bounded to
// the function named, comments stripped — this file discusses the expression it hunts for.
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  // The rule lives in `vouch.js` now — one module for the whole concept.
  const vp = strip(fs.readFileSync(path.join(ROOT, "backends/backend1/vouch.js"), "utf8"));
  const a = vp.indexOf("function mayRetire");
  ok(a > 0, "E: could not find mayRetire (renamed? update this guard)");
  const b = vp.indexOf("\n  function ", a + 10);
  const body = vp.slice(a, b > a ? b : a + 900);
  ok(/protectedForMe\s*\(/.test(body), "E: mayRetire must ask protectedForMe for the bar comparison", body.slice(0, 200));
  ok(!/satisfiedTier\s*\(/.test(body),
    "E: and must not make its own satisfiedTier comparison — one home for the rule");
  ok(!/owesVouch\s*\(/.test(body),
    "E: nor invert owesVouch, which would carry the never-vouch-yourself clause into retention " +
    "and drop my own events (PART B)");

  // AND THE CALLER MUST PASS THE RANK. A rank-relative predicate handed no rank is this codebase's
  // signature bug, and the eviction pass sits behind a byte cap and a live cache — so this is
  // static, bounded to the function named.
  //
  // THE USER ID IS GONE, and that is a correction rather than a regression. The old signature took
  // `myUserId` and NEVER REFERENCED IT: the body is a floor check followed by `protectedFor`, and
  // authorship is already handled by the `author` argument, which satisfiedTier excludes from its
  // own count. So my own events already require someone ELSE to vouch them, with no id needed.
  //
  // This guard used to assert that the call site passed that argument — protecting a parameter that
  // did nothing. A vestigial argument asserted by a guard is worse than one nobody notices, because
  // it reads as a rule.
  {
    const ec = strip(fs.readFileSync(path.join(ROOT, "backends/backend1/eventcache.js"), "utf8"));
    const c = ec.indexOf("function _plan");
    const d = ec.indexOf("\n  function ", c + 10);
    const planBody = ec.slice(c, d > c ? d : c + 4000);
    ok(/mayRetire\([^)]*_myRank\(\)/.test(planBody),
      "E: the eviction pass must pass MY rank to mayRetire — without it the question becomes "
      + "'is anybody at all discharged', which is the absolute reading under a new name, and a "
      + "staff client sheds its last copy of something six guests covered", planBody.slice(0, 300));
  }

}

// ── PART F: an unknown rank holds more ──────────────────────────────────────────────────────
{
  ok(Vouch.mayRetire(10, guests(6), author, null, S, undefined) === false,
    "F: a client that cannot say where it stands drops nothing on anyone else's word");
  ok(Vouch.mayRetire(5, [], author, 10, S, undefined) === true,
    "F: APPLIED — but the floor arm still works, so this is caution about COVERAGE, not paralysis");
}

console.log("[retention-by-duty] PASS — what I keep is decided by my own bar and by the same comparison that decides what I vouch: six guests discharge a guest and not a staff member, fifty read the same as six, my own unvouched event is held rather than dropped (inverting owesVouch would drop it, because I never owe myself a vouch), an event banked below a forget-earning floor is retirable regardless, the comparison has one home rather than a third hand-maintained copy, and a client that cannot state its rank drops nothing on anyone else's word");
