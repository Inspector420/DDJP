// tests/run-all.js
// One command to run every architecture guard. Exits non-zero if any fail —
// wire this into a pre-commit hook or CI so violations can't land.
//
//   node tests/run-all.js

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── THE SET IS DERIVED FROM DISK, NOT LISTED ────────────────────────────────────────────────
// This was a hand-written array of 105 names against 106 files on disk. The missing one was
// `check-spine.js` — the guard three documents lean on hardest, the one that locks the six-layer
// placement and fails when a backend module appears with no layer named for it. It passed when
// invoked by hand and was invoked by nothing. Adding a module would have failed nothing, while
// SPINE.md said "where this page and that guard disagree, the guard is right".
//
// A hand-written list is the same mechanism that produced the six missing `ddjp.media.skip`
// subscriptions, and the answer there was not to add a sixth entry — it was to make the guard
// DERIVE its candidates by scanning. Same failure, same answer: there is no list to forget.
//
// SILENCE IS NOT SUCCESS caught a guard that runs and prints nothing. It could never catch one that
// is never asked, because an unlisted file produces no output to judge. That net was one level too
// low; this is the level above it, and check-runner-coverage.js locks the accounting.
//
// EXCLUSION IS A DECISION, WRITTEN DOWN. Anything skipped needs a reason here — an entry with no
// reason fails check-runner-coverage, so an omission cannot pass as a choice. Empty today: nothing
// in this suite has earned a skip.
const EXCLUDED = {
  // "check-example.js": "why this one is deliberately not run",
};

const guards = fs.readdirSync(__dirname)
  .filter((f) => /^check-[a-z0-9-]+\.js$/.test(f))
  .filter((f) => !Object.prototype.hasOwnProperty.call(EXCLUDED, f))
  .sort();

// ASKABLE, AND ONLY SELF-EXECUTING WHEN INVOKED DIRECTLY. Required as a module this used to run
// the whole suite and then process.exit out of its caller — which is why check-runner-coverage can
// ask it what it will run instead of reading its source and proving only that names are spelled.
function coverage() { return { run: guards.slice(), excluded: Object.assign({}, EXCLUDED) }; }

// ── THE VERDICT — A FUNCTION, NOT AN INLINE TEST, SO A GUARD CAN DRIVE THE REAL ONE ──────────
// EXPORTED because nothing tested this runner at all, which is how the defect below shipped. A
// guard that re-implemented the rule would prove a copy correct; `check-runner-verdict.js` calls
// THIS function, and the loop below calls it too, so there is one rule with two callers.
//
// ── THE DEFECT THIS REPLACES: A GUARD COULD BOTH FAIL AND PASS ───────────────────────────────
// The rule used to be *exit 0, and `\bPASS\b` appears somewhere in stdout*. Both halves are
// satisfiable by output that also announces a failure. DRIVEN on the shipped `ddjp_274`: a guard
// printing `[x] FAIL …` then `[x] PASS …` and exiting 0 was counted GREEN, and the suite printed
// `✓ All guards passed` with a FAIL line on screen. That is not a hypothetical — it is exactly what
// `check-setting-endpoints` did for part of J17's build, when a new PART was appended below its own
// `process.exit(1)` gate. **A false green here is a false claim about every guard at once**, which
// is why this is checked rather than asserted.
//
// ── WHY THE FORM IS ANCHORED RATHER THAN A SUBSTRING ─────────────────────────────────────────
// MEASURED on a fully green run: the word `FAIL` appears on **one** line — inside
// `check-chat-redaction`'s PASS narrative, which describes the failure it prevents. A substring
// rule would refuse a green suite. The ANNOUNCEMENT form `^[name] FAIL` appears **zero** times in
// a green run, and `^[name] PASS` appears on all 131 announcing lines from all 129 guards. So the
// convention every guard already follows is the thing to parse, and both halves are anchored the
// same way — a rule that is strict about one and loose about the other is the asymmetry that let
// this through.
//
// `INADMISSIBLE` counts as a failure announcement: a guard whose admissibility gate refuses has
// not passed, it has declined to answer, and an unanswered guard must not read as a green one.
const ANNOUNCED_FAILURE = /^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE)\b/m;
const ANNOUNCED_PASS = /^\[[a-z0-9-]+\] PASS\b/m;

function verdictOf(status, stdout) {
  const out = String(stdout || "");
  if (status !== 0) return { ok: false, why: "exited " + status };
  if (ANNOUNCED_FAILURE.test(out)) {
    return { ok: false, why: "announced a FAILURE and still exited 0 — a guard cannot both fail " +
      "and pass, and the exit code is not the only thing it says" };
  }
  // ── SILENCE IS NOT SUCCESS ──────────────────────────────────────────────────────────────
  // A guard that runs NOTHING and exits 0 is indistinguishable from one that passed. Not
  // hypothetical: check-reload-clock was written with its summary line after a `return`, so its
  // assertions ran and it printed nothing, and this runner reported the suite green while one
  // member said nothing at all.
  if (!ANNOUNCED_PASS.test(out)) {
    return { ok: false, why: "exited 0 but announced no PASS. A guard that says nothing cannot be " +
      "distinguished from one that ran nothing; every guard must announce what it locked" };
  }
  return { ok: true, why: null };
}

module.exports = { coverage, verdictOf, ANNOUNCED_FAILURE, ANNOUNCED_PASS };
if (require.main !== module) return;

console.log("DDJP architecture guards\n========================");

let failed = 0;
for (const g of guards) {
  const r = spawnSync(process.execPath, [path.join(__dirname, g)], { encoding: "utf8" });
  process.stdout.write(r.stdout || "");
  if (r.stderr) process.stderr.write(r.stderr);
  // ONE RULE, ONE PLACE. The verdict is `verdictOf` above, which `check-runner-verdict.js` drives
  // directly — so the thing that decides the suite's colour is itself under test.
  const v = verdictOf(r.status, r.stdout);
  if (!v.ok) {
    if (r.status === 0) console.log("[run-all] FAIL — " + g + " " + v.why);
    failed++;
  }
}

console.log("========================");
if (failed) {
  console.log("✗ " + failed + " guard(s) FAILED — see above.");
  process.exit(1);
}
console.log("✓ All guards passed.");
process.exit(0);
