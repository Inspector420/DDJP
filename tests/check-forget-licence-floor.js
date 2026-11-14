// tests/check-forget-licence-floor.js
// SUBJECT: backends/backend1/streammanager.js
//
// A FORGET LICENCE BELONGS TO THE FLOOR IT WAS EARNED FOR.
//
// `seedValidation` is the only evidence that the seeded path a client will rely on AFTER forgetting
// is sound, and the module's own comment states the constraint that makes it load-bearing: forgetting
// drops the log that makes the check possible, so THERE IS EXACTLY ONE CHANCE TO RUN IT.
//
// The record is keyed by checkpoint signature (`n + ":" + h`) and re-run when that signature changes
// — but the re-run happens inside `_deriveBest`, i.e. on a FOLD, while `seedLicensesForget()` is read
// by `trimToFloor` BEFORE any fold with the new floor in place. Measured order, adopting a floor:
//
//     Floor announces `adopted`
//       -> _proveFloorSettings()   reads the floor; does NOT fold
//       -> trimToFloor()           reads seedLicensesForget()  <-- record still belongs to the OLD floor
//            ... trims ...
//            -> _refold()          NOW the signature change is noticed and validation re-runs
//
// So the check designed to gate the irreversible act runs immediately AFTER it. Driven, with a
// floor A folded first and a different floor B adopted with nothing in between:
//
//     after fold with A   status=validated  sig=1:<A's h>
//     after adopting B    status=validated  sig=1:<A's h>   current floor sig=2:<B's h>
//
// RE-AIMED AT J82: A was an ORIGIN floor (a save file's), which earned its record by declaration
// (`origin-seed`); room files went (owner's ruling 1), so A and B are ordinary floors sealed from the
// log at real cuts, and A earns its record by the comparison every floor gets.
//
// WHY THIS IS LATENT RATHER THAN LIVE, STATED SO NOBODY READS IT AS WORSE THAN IT IS. The predicate
// is TWO independent gates and the second one is sound: `_proveFloorSettings()` re-proves the
// settings claim for the CURRENT floor immediately before the trim, so in the shipped tree a stale
// seed record is stood in front of by a floor-keyed check that would have to pass on its own. The
// defect is that the safety rests on a gate that is not the one designed for it, and nothing said so
// — which is the "each half correct, the join missing" shape this codebase keeps finding.
//
// THIS GUARD ISOLATES GATE ONE, the way `check-settingsproof` isolates gate two. SettingsProof is
// deliberately not loaded: the predicate has an explicit early return for its absence, so leaving it
// out asks gate one on its own rather than reading gate two's refusal as gate one's.
//
// THE TEST OVERRIDE IS EXEMPT ON PURPOSE. `_setLicenceForTest` exists to say "assume validated" and
// every caller plants a status with no signature; requiring one there would make a dozen guards
// restate a signature to buy nothing. The rule applies to the RECORD the module earns for itself,
// which is the only one production has.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

// SettingsProof omitted deliberately — see the header.
const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, Floor } = C;

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[forget-licence-floor] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log);

// A floor sealed from the log at a real cut: its seed is the fold up to the cut, its boundary a held event.
const ORD = F.sortLog(LOG);
function mkFloor(n, h, k, prev) {
  const cut = ORD[k];
  return { n: n, h: h, prev: prev, thin: false, floorL: cut.l, grade: "verified",
           covers: ORD[0].eventId + ".." + cut.eventId, seed: StateDeriver.buildSeed(ORD.slice(0, k + 1), null) };
}

// An ordinary floor earns a real `validated` record through the module's own path — the comparison with the
// genesis fold — so nothing here is planted through the test seam the rule deliberately exempts.
const A = mkFloor(1, "hAAA", 6, null);
const B = mkFloor(2, "hBBB", 10, "hAAA");

Floor.reset();
StreamManager.reset();

// ── PREMISE: a real, earned licence exists for A ─────────────────────────────────────────────
// The floor goes in BEFORE the fold: `getState()` returns the cached state and does not re-derive,
// so setting the floor and then reading state would record nothing and this guard would assert
// against a licence that was never granted.
Floor._setTrustedForTest(A);
StreamManager._setLogForTest(LOG);

const recA = StreamManager.seedValidation();
ok(recA.status === "validated" && recA.sig === (A.n + ":" + A.h),
  "PREMISE — a real earned licence for floor A must exist before anything can be shown to reuse " +
  "it. If this fails the assertion below is void, not passing.",
  "seedValidation() was " + JSON.stringify(recA));

ok(StreamManager.seedLicensesForget() === true,
  "PREMISE — the licence must actually license forgetting while A is the floor, or the assertion " +
  "below cannot distinguish 'correctly refused' from 'never granted'.",
  "seedLicensesForget() was false with A's own licence in hand");

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
// Adopt B exactly as production does — through Floor's own seam, with no fold in between, which is
// the real order: adopted -> _proveFloorSettings (no fold) -> trimToFloor (reads the licence).
Floor._setTrustedForTest(B);

const sigB = B.n + ":" + B.h;
const recB = StreamManager.seedValidation();

ok(StreamManager.seedLicensesForget() === false,
  "the forget licence earned for one floor is authorising a trim to a DIFFERENT one. " +
  "`seedValidation` is keyed by checkpoint signature and re-run on a fold, but `trimToFloor` reads " +
  "the licence BEFORE any fold with the new floor — so the check that exists to gate an " +
  "irreversible act runs immediately after it. Forgetting drops the evidence the check needs, and " +
  "the module states there is exactly one chance to run it.",
  "floor is " + sigB + " but the licence says " + JSON.stringify(recB) +
  " and seedLicensesForget() returned true");

// ── AND IT MUST COME BACK WHEN THE LICENCE IS EARNED FOR THE FLOOR ACTUALLY HELD ─────────────
// A fix that simply refuses whenever a signature is present would pass the assertion above and
// break forgetting entirely, which is the failure that costs a room its ability to trim at all.
StreamManager._setLogForTest(LOG);   // a fold with B installed: re-keys the record to B
ok(StreamManager.seedLicensesForget() === true,
  "refusing a licence that DOES belong to the current floor breaks forgetting outright. The rule " +
  "is that the licence must match the floor, not that a signature is disqualifying.",
  "after folding with B in place, seedValidation() was " +
  JSON.stringify(StreamManager.seedValidation()));

console.log(
  "[forget-licence-floor] PASS — a forget licence is only spent on the floor it was earned for. " +
  "`seedValidation` is keyed by checkpoint signature and re-run on a fold, while `trimToFloor` reads " +
  "the licence before any fold with a newly adopted floor — so without this the check that gates an " +
  "irreversible act would run immediately after it, on evidence the trim had already destroyed. " +
  "Driven both ways: a licence belonging to another floor is refused, and one belonging to the floor " +
  "actually held still licenses, so a fix that simply distrusted signatures would fail here rather " +
  "than passing. Gate one is isolated deliberately — SettingsProof is not loaded, so this asks the " +
  "seed half on its own instead of reading the settings half's refusal as its own (" + checks + " assertions)");
