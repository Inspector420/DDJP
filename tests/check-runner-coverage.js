// tests/check-runner-coverage.js
// WALL: A GUARD THAT IS NEVER ASKED IS NOT A GUARD.
//
// The runner already refuses SILENCE — a guard that exits 0 having printed no PASS line fails the
// build, because "ran nothing" and "passed" are otherwise indistinguishable. That net was placed
// one level too low. It catches a guard that RUNS and says nothing; it cannot see a guard that is
// never run at all, because an unlisted file produces no output to judge.
//
// That hole was live. `check-spine.js` sat on disk, passed when invoked by hand, and was named by
// NOTHING — not the runner, not another guard, not package.json. Its only mention in the tree was
// its own header. Meanwhile three documents lean on it harder than on any other guard:
//
//   SPINE.md          "The structure on this page is verified by check-spine … where this page and
//                      that guard disagree, the guard is right."
//   BEHAVIOUR.md      "Verified by check-spine PART E."
//   08-build-and-deploy.md  an entire section, "A guard may lock a concept, not only a rule."
//
// So the six-layer placement, the four announcers, the one door and the derived cascade list were
// documented as locked against the tree, while `node tests/run-all.js` — which the README calls the
// only source of truth for guard count and status — never asked. Adding a backend module would
// have failed nothing.
//
// ── WHY THE FIX IS THE DERIVATION, NOT THE MISSING LINE ─────────────────────────────────────────
// The runner hand-listed its guards. A hand-written list is exactly what produced the six missing
// `ddjp.media.skip` subscriptions, and the answer there was not to add a sixth entry: it was to
// make `check-advance-notify` DERIVE its candidates by scanning. Same failure, same answer. The
// runner now reads `tests/check-*.js` from disk, so there is no list to forget.
//
// This guard is what stops it silently reverting to a list. It asserts the ACCOUNTING, not the
// mechanism: every guard file on disk is either run or excluded with a recorded reason. An
// exclusion is a DECISION someone has to write down, which is the shape this codebase already uses
// for event types and for advance subscribers — a guard that demands a decision cannot be wrong the
// way a guard asserting one correct answer can.
//
// THE RED THIS WAS WRITTEN AGAINST, so a future red is checkable against the one it was built for:
//
//   [runner-coverage] FAIL — 1 guard file(s) on disk that run-all neither runs nor excludes:
//         check-spine.js
//
// A different shape is a new finding rather than a regression of this one.
//
// ── WHAT THIS DOES NOT LOCK, STATED SO NOBODY ASSUMES IT DOES ───────────────────────────────────
// It locks the ACCOUNTING, not the mechanism. A hand-written list that happens to be complete today
// passes here — mutation-checked, and it does. What it cannot do is stay passing: the moment anyone
// adds a guard file, a stale list fails this immediately, which is the realistic shape of the
// failure it exists for (somebody reverts to a list AND the suite grows). A complete list that
// never grows loses nothing, so the residual is small and self-closing.
//
// A stronger version would create a temp guard file and ask the runner whether it appeared —
// deciding membership by EXECUTION, the way check-advance-notify does. Not done, deliberately: it
// writes into the tests directory, and a guard that can leave litter behind on a crash is a worse
// trade than a residual that closes itself on the next commit. Recorded so the next reader knows
// this boundary was chosen rather than missed.

const fs = require("fs");
const path = require("path");

const TESTS = __dirname;
let failed = 0;
function fail(m, d) { console.log("[runner-coverage] FAIL — " + m + (d ? "\n      " + d : "")); failed++; }
function ok(c, m, d) { if (!c) fail(m, d); }

// ── What is on disk ──────────────────────────────────────────────────────────────────────────
const onDisk = fs.readdirSync(TESTS)
  .filter((f) => /^check-[a-z0-9-]+\.js$/.test(f))
  .sort();
ok(onDisk.length >= 50,
  "fixture: found only " + onDisk.length + " guard files — the scan is not reaching the tests " +
  "directory, so every assertion below would pass vacuously");

// ── What the runner accounts for ─────────────────────────────────────────────────────────────
// Loaded rather than parsed. A regex over the runner's source would prove a name is SPELLED there,
// which is the textual-guard failure this project records repeatedly — and it is exactly how a
// derived runner could be replaced by a list of the same names without this noticing. `coverage()`
// is the runner's own answer about what it will actually execute.
let runner = null;
try { runner = require(path.join(TESTS, "run-all.js")); }
catch (e) { fail("could not load run-all.js as a module: " + (e && e.message)); }

ok(runner && typeof runner.coverage === "function",
  "run-all.js must export coverage() so this guard can ask the runner what it will run, rather " +
  "than reading its source and proving only that some names are spelled in it");

if (runner && typeof runner.coverage === "function") {
  const cov = runner.coverage();

  ok(Array.isArray(cov.run), "coverage().run must be an array");
  ok(cov.excluded && typeof cov.excluded === "object", "coverage().excluded must be an object of file -> reason");

  const run = new Set(cov.run || []);
  const excluded = cov.excluded || {};

  // ── THE ASSERTION ──────────────────────────────────────────────────────────────────────────
  const unaccounted = onDisk.filter((f) => !run.has(f) && !Object.prototype.hasOwnProperty.call(excluded, f));
  ok(unaccounted.length === 0,
    unaccounted.length + " guard file(s) on disk that run-all neither runs nor excludes:",
    unaccounted.join("\n      ") + "\n      A guard nobody asks is not a guard. Run it, or exclude " +
    "it with a reason — an omission must not be able to pass as a decision.");

  // The reverse: a name accounted for that no longer exists. Left behind by a rename, it would make
  // the suite look bigger than it is.
  const ghosts = [].concat(cov.run || [], Object.keys(excluded)).filter((f) => onDisk.indexOf(f) < 0);
  ok(ghosts.length === 0,
    ghosts.length + " name(s) accounted for that are not on disk:",
    ghosts.join("\n      ") + "\n      A stale entry inflates the count and hides a deletion.");

  // An exclusion must carry a REASON, not an empty string. The whole point of the excluded map is
  // that skipping is a decision somebody wrote down.
  const blank = Object.keys(excluded).filter((f) => typeof excluded[f] !== "string" || excluded[f].trim().length < 10);
  ok(blank.length === 0,
    blank.length + " exclusion(s) carry no usable reason:",
    blank.join("\n      ") + "\n      An exclusion with no reason is an omission wearing a decision's clothes.");

  // ── AND THE RUNNER MUST STILL BE DERIVING ─────────────────────────────────────────────────
  // The accounting above would be satisfied by a hand-written list that happens to be complete
  // today — which is precisely the state this guard exists to end, and it would go stale the next
  // time somebody adds a file. So: what the runner reports must equal what is on disk minus the
  // recorded exclusions, computed here from the DIRECTORY rather than from anything the runner said.
  const expected = onDisk.filter((f) => !Object.prototype.hasOwnProperty.call(excluded, f));
  const missing = expected.filter((f) => !run.has(f));
  ok(missing.length === 0,
    "the runner is not deriving from disk — " + missing.length + " file(s) present, not excluded, " +
    "and not scheduled:", missing.join("\n      "));

  if (!failed) {
    console.log("[runner-coverage] PASS — every guard on disk is accounted for by the runner: " +
      run.size + " scheduled, " + Object.keys(excluded).length + " excluded with a written reason, " +
      "0 unaccounted and 0 stale names. The set is DERIVED from the directory rather than listed, " +
      "so a guard added tomorrow runs tomorrow — and the runner is asked for its own answer rather " +
      "than having its source read, because a name spelled in a file proves nothing about what runs. " +
      "This closes the level above 'silence is not success': that rule catches a guard that runs and " +
      "says nothing, and could never see one that is never asked.");
  }
}

if (failed) { console.log("[runner-coverage] " + failed + " failure(s)"); process.exit(1); }
process.exit(0);
