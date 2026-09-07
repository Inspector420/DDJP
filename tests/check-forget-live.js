// tests/check-forget-live.js
//
// FORGETTING MUST ACTUALLY HAPPEN.
//
// Every other guard around the floor asks whether trimming is CORRECT. None asked whether it ever
// RUNS. It did not — not once, in production, ever:
//
//   trimToFloor()            requires seedLicensesForget()
//   seedLicensesForget()     requires SettingsProof.licensesForget()
//   licensesForget()         requires verdict().status === "validated"
//   the verdict starts at    "not-yet-run"
//   and nothing moved it     — ingest / markGenesisReached / markReadFrom were reachable only
//                              from tests, and the module's pager was the literal `null`
//
// So the floor was selected, verified, re-validated, graded and adopted, and then nothing was
// dropped below it. Checkpoints, the trust cascade and the whole floor apparatus exist to make
// forgetting safe, and forgetting had never run. Nothing errored, nothing went red, and every
// component reported success — the failure signature this codebase is built around, at the largest
// scale it has appeared.
//
// WHY THE EXISTING TRIM GUARD MISSED IT, which matters more than the bug. check-derived-log-bound
// exercises trimToFloor thoroughly and passes. Its sandbox does not load settingsproof.js — and
// seedLicensesForget contains `if (typeof SettingsProof === "undefined") return true`, an absent-
// engine fallback that is right in production and fatal in a harness. The guard therefore tested
// trimming in a world where the blocking half did not exist. A test that omits a dependency does
// not merely fail to cover it; it can actively certify the opposite.
//
// So PART A drives the real path with BOTH engines present, and PART B is the negative control:
// the same room with the settings claim unproven must NOT trim. Without B, A would pass again the
// moment someone reintroduced a permissive default.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const OWNER = F.RANK.owner;

// A full settings blob, so the claim is the shape a real seed carries.
function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    // Floor is loaded because the floor now has ONE home. A guard sets it through Floor's own
    // seam, which is the same state trimToFloor AND seed validation both read. Setting it
    // anywhere else was how a guard could be green on a floor production would never hold.
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js",
    "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
  ], {});
}

// A settings event in the shape the stream produces and SettingsProof.ingest reads.
function settingsEvent(sb, id, l, over) {
  const blob = Object.assign(sb.StateDeriver.defaultSettings(), over || {});
  return {
    eventId: id, type: "ddjp.room.settings", l: l, ts: 1000 + l,
    sender: "@owner:hs", senderRank: OWNER, content: { t: "ddjp.room.settings", s: blob },
  };
}

// A room whose log runs well past the floor, so a trim has something to remove.
function buildRoom(sb) {
  const log = [];
  log.push(settingsEvent(sb, "$s1", 1, { maxLen: 300 }));
  for (let i = 2; i <= 12; i++) {
    log.push({
      eventId: "$e" + i, type: "ddjp.dj.join", l: i, ts: 1000 + i,
      sender: "@a:hs", senderRank: F.RANK.player, content: { t: "ddjp.dj.join", v: "V" + i },
    });
  }
  return log;
}

const BOUNDARY_L = 6;

function floorFor(sb, grade) {
  const blob = Object.assign(sb.StateDeriver.defaultSettings(), { maxLen: 300 });
  return {
    n: 1, prev: null, h: "hhhhhhhh", covers: "$s1..$e6", floorL: BOUNDARY_L,
    by: "@owner:hs", grade: grade,
    seed: { settings: blob, settingsFrom: "$s1", nowPlaying: null, rotation: [] },
  };
}

// ── PART A — with the claim proved, the room forgets ─────────────────────────────────────────
{
  const sb = tree();
  const log = buildRoom(sb);

  // The reading half — exactly what transport now supplies: the settings events the log holds,
  // plus an honest statement of how far back we read. markGenesisReached is the claim that there
  // is nothing earlier, and only a caller that really read to the start may make it.
  sb.SettingsProof.ingest(log.filter((e) => e.type === "ddjp.room.settings"));
  sb.SettingsProof.markGenesisReached();

  ok(sb.SettingsProof.verdict().status === "not-yet-run",
    "A: before anything is proved the verdict is not-yet-run — reading is not proving");
  ok(sb.SettingsProof.licensesForget() === false,
    "A: and not-yet-run does NOT license forgetting. Unverified is not permission");

  const f = floorFor(sb, "verified");
  const v = sb.SettingsProof.proveClaim({
    claimed: f.seed.settings, settingsFrom: f.seed.settingsFrom, atL: f.floorL, floorL: f.floorL,
  });
  ok(v.status === "validated",
    "A: the floor's settings claim is PROVED against the event it names", v);
  ok(sb.SettingsProof.licensesForget() === true,
    "A: APPLIED — and a validated claim licenses forgetting");

  // The seed half is a genesis cross-check a headless harness cannot stage cheaply; it has its own
  // guard (check-seed-validation). Forced here so this file tests the half that was missing.
  sb.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  sb.StreamManager._setLogForTest(log);
  sb.Floor._setTrustedForTest(f);

  const before = sb.StreamManager.getLog().length;
  const dropped = sb.StreamManager.trimToFloor();

  ok(dropped > 0,
    "A: APPLIED — trimToFloor DROPS EVENTS. This is the assertion that did not exist, and its "
    + "absence is why a permanently-zero return looked exactly like a healthy room", { before, dropped });
  ok(sb.StreamManager.getLog().length === before - dropped,
    "A: APPLIED — and the log really shrank by what it reported, rather than reporting a number "
    + "nothing performed");
  ok(sb.StreamManager.getLog().every((e) => e.l > BOUNDARY_L),
    "A: APPLIED — everything kept is strictly ABOVE the floor; the boundary event is banked in the "
    + "seed and keeping it would double-count on the next fold");
}

// ── PART B — the negative control ────────────────────────────────────────────────────────────
// Identical room, identical floor, identical forced seed licence. The ONLY difference is that the
// settings claim was never proved. If this trims, the settings half is decorative and PART A is
// passing for the wrong reason.
{
  const sb = tree();
  const log = buildRoom(sb);
  const f = floorFor(sb, "verified");

  sb.SettingsProof.ingest(log.filter((e) => e.type === "ddjp.room.settings"));
  sb.SettingsProof.markGenesisReached();
  // deliberately NOT proved

  sb.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  sb.StreamManager._setLogForTest(log);
  sb.Floor._setTrustedForTest(f);

  const dropped = sb.StreamManager.trimToFloor();
  ok(dropped === 0,
    "B: an unproven settings claim withholds the licence and NOTHING is dropped — even with the "
    + "seed licence granted and a floor that earns forgetting. This is the state production was "
    + "permanently in", { dropped });
  ok(sb.StreamManager.getLog().length === log.length,
    "B: APPLIED — and the log is untouched, not merely the count unchanged");
}

// ── PART C — a mismatched claim is refused, and refused differently ──────────────────────────
// Proving is not a formality that turns green once wired. A seed claiming settings the named event
// does not carry must fail, or the whole check is a switch that only ever points one way.
{
  const sb = tree();
  const log = buildRoom(sb);
  sb.SettingsProof.ingest(log.filter((e) => e.type === "ddjp.room.settings"));
  sb.SettingsProof.markGenesisReached();

  const f = floorFor(sb, "verified");
  const lying = Object.assign({}, f.seed.settings, { maxLen: 999 });   // $s1 says 300
  const v = sb.SettingsProof.proveClaim({
    claimed: lying, settingsFrom: "$s1", atL: f.floorL, floorL: f.floorL,
  });
  ok(v.status === "mismatched", "C: a seed claiming values its named event does not carry is a mismatch", v);
  ok(sb.SettingsProof.licensesForget() === false, "C: APPLIED — and a mismatch withholds the licence");

  sb.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  sb.StreamManager._setLogForTest(log);
  sb.Floor._setTrustedForTest(f);
  ok(sb.StreamManager.trimToFloor() === 0,
    "C: APPLIED — so the room keeps everything. Detection is not response: the mismatch revokes no "
    + "floor and rejects no event, it only declines to let history be dropped on a claim that "
    + "did not check out");
}

// ── PART D — a grade that does not earn forgetting still blocks, proof or no proof ────────────
// Two independent conditions, and neither may stand in for the other.
{
  const sb = tree();
  const log = buildRoom(sb);
  sb.SettingsProof.ingest(log.filter((e) => e.type === "ddjp.room.settings"));
  sb.SettingsProof.markGenesisReached();
  const f = floorFor(sb, "stale");
  sb.SettingsProof.proveClaim({
    claimed: f.seed.settings, settingsFrom: f.seed.settingsFrom, atL: f.floorL, floorL: f.floorL,
  });
  ok(sb.SettingsProof.licensesForget() === true, "D: the settings claim is proved");

  sb.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  sb.StreamManager._setLogForTest(log);
  sb.Floor._setTrustedForTest(f);
  ok(sb.StreamManager.trimToFloor() === 0,
    "D: APPLIED — a proved claim does not rescue a floor whose GRADE does not earn forgetting. "
    + "The two conditions are independent and neither substitutes for the other");
}

console.log("[forget-live] PASS — forgetting actually happens, which nothing previously asserted: "
  + "with the settings claim proved against the event the seed names, trimToFloor drops real events "
  + "and the log really shrinks; with the claim unproven the identical room drops NOTHING, which is "
  + "the state production was permanently in and which the existing trim guard could not see "
  + "because its sandbox omitted the blocking engine; a seed claiming values its named event does "
  + "not carry is refused without revoking anything; and a floor whose grade does not earn "
  + "forgetting still blocks, so the two conditions cannot stand in for each other ("
  + checks + " assertions)");
