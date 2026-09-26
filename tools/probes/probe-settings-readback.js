// tools/probes/probe-settings-readback.js
//
// J35's FIRST OPEN QUESTION, MEASURED: "should the caller pass a real `atL` distinct from
// `floorL`?" The entry says the answer may shrink the whole job, and that it must be settled
// before deciding anything about `readBack`. This probe settles it by driving the production
// caller's shape rather than by reading `_canAnswerAt`.
//
// WHAT IS BEING COMPARED. `matrixbridge.js`'s floor-change subscriber calls
//   SettingsProof.proveClaim({ claimed: seed.settings, settingsFrom: seed.settingsFrom,
//                             atL: Floor.position(), floorL: Floor.position(),
//                             floorNames: seed.settingsFrom })
// so `_canAnswerAt`'s floor branch (`l > floorL`) tests `floorL > floorL` and is unreachable.
// Three candidate shapes are driven against the same trees:
//   AT_CUT     atL = floorL          (today)
//   AT_HEAD    atL = newest position (the "distinct atL" the entry asks about)
// and two seeds — an HONEST one and a LYING one whose `settingsFrom` names a settings event that
// did not exist at the cut. A shape is only acceptable if it validates the honest seed AND
// refuses the lying one.
//
// ── THE ADMISSIBILITY GATE, AND WHY IT IS NOT OPTIONAL ─────────────────────────────────────
// Every reading below can come back "unverifiable" for at least five reasons that have nothing
// to do with the comparison: the log never landed, the fixture holds no settings event, the seed
// carries no pointer, the room never played, or the control tree cannot validate either. An
// unreached measurement returns the same value in every tree, so absence would read as
// agreement. The gate states each precondition SEPARATELY, runs before any comparison, and
// refuses to print a result if one fails — naming which stage broke.
//
// AND THE GATE IS ITSELF UNTESTED CODE, so `--selftest` feeds it deliberately broken inputs and
// shows it catches each one. Without that it certifies everything downstream on its own
// authority.
//
// Usage:  node tools/probes/probe-settings-readback.js [--selftest]

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

const SELFTEST = process.argv.includes("--selftest");

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/settingsproof.js",
    "backends/backend1/streammanager.js",
  ], {});
}

// ── THE FIXTURE ────────────────────────────────────────────────────────────────────────────
// A room with TWO owner settings events: one at genesis (governing at the cut) and one well
// above the cut. The second is what makes the lying seed possible and what makes AT_HEAD's
// answer differ from AT_CUT's — without it both shapes read the same and the comparison would
// vary nothing (a control that varies the wrong axis).
const CUT_L = 6;
function buildLog(sb) {
  const D = sb.StateDeriver.defaultSettings();
  const early = Object.assign({}, D, { maxLen: 300 });
  const late = Object.assign({}, D, { maxLen: 500 });
  const room = F.playingRoom({ songs: 8 });
  const body = [
    F.reducerEvent("$sGenesis", 1, 900, "@owner:hs", F.RANK.owner,
      { t: "ddjp.room.settings", s: early }),
  ].concat(room.log.map((e) =>
    F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
  const topL = Math.max.apply(null, body.map((e) => e.l));
  const topTs = Math.max.apply(null, body.map((e) => e.ts));
  // The LATE settings event sits above the cut, in the stretch a thin client still holds.
  body.push(F.reducerEvent("$sLate", topL + 1, topTs + 1000, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: late }));
  return { log: body, early: early, late: late,
           topL: topL + 1, topTs: topTs + 1000 };
}

function cutAt(sb, log, n) {
  const below = log.slice(0, n);
  const seed = sb.StateDeriver.buildSeed(below);
  return { n: 1, prev: null, seed: seed, h: "h" + n,
           covers: below[0].eventId + ".." + below[below.length - 1].eventId,
           floorL: below[below.length - 1].l, by: "@owner:hs", grade: "quorum" };
}

// ── STAGES ─────────────────────────────────────────────────────────────────────────────────
// Each returns a string naming the failure, or null when the stage is sound. Named so a null
// reading is attributable to a stage rather than to "something".
function stages(o) {
  return [
    ["S1-modules", () => (o.sb && o.sb.SettingsProof && typeof o.sb.SettingsProof.readBack === "function")
      ? null : "SettingsProof.readBack is not present — the subject of this probe is absent"],
    ["S2-log-landed", () => (o.held === o.log.length)
      ? null : "the fixture log did not land in StreamManager (" + o.held + " of " + o.log.length + ")"],
    ["S3-two-settings-events", () => (o.settingsInLog === 2)
      ? null : "the fixture must hold exactly two owner settings events, one below and one above the cut; found " + o.settingsInLog],
    ["S4-seed-names-an-event", () => (o.honest && typeof o.honest.seed.settingsFrom === "string")
      ? null : "the seed at the cut carries no settingsFrom, so there is no pointer to prove"],
    ["S5-room-is-playing", () => (o.playing)
      ? null : "the fixture room is not playing anything, so the fold never reached the settings branch"],
    ["S6-cut-below-late-settings", () => (o.honest && o.honest.floorL < o.lateL)
      ? null : "the late settings event must sort ABOVE the cut or AT_HEAD varies nothing"],
    ["S7-control-validates", () => (o.controlStatus === "validated")
      ? null : "the CONTROL (full-replay client, honest seed, today's caller shape) does not " +
               "validate — it answered '" + o.controlStatus + "', so no refusal below is " +
               "attributable to the shape under test"],
  ];
}

function runGate(o, only) {
  const broken = [];
  for (const [name, fn] of stages(o)) {
    if (only && only !== name) continue;
    let why = null;
    try { why = fn(); } catch (e) { why = "stage threw: " + (e && e.message); }
    if (why) broken.push(name + ": " + why);
  }
  return broken;
}

// ── THE READINGS ───────────────────────────────────────────────────────────────────────────
// A client is set up two ways. FULL replay reached the settings channel's start, so
// `markGenesisReached` is honest. THIN holds only the stretch above the cut and claims coverage
// only from the floor's position — which is exactly what `_feedSettingsProofFromLog` does in
// production (`markReadFrom(Floor.position())`), so the reading window is modelled rather than
// invented.
function setup(mode, floor, log) {
  const sb = tree();
  const { StreamManager, SettingsProof, Floor } = sb;
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  SettingsProof.attach({ now: () => 1, pageSettings: null });
  const held = (mode === "full") ? log : log.filter((e) => e.l > floor.floorL);
  for (const e of held) StreamManager.ingest(F.toRaw(e));
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-probe" });
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  if (mode === "full") SettingsProof.markGenesisReached();
  else SettingsProof.markReadFrom(floor.floorL);      // what the production feed claims
  Floor._setTrustedForTest(floor);
  return sb;
}

function prove(sb, floor, atL) {
  return sb.SettingsProof.proveClaim({
    claimed: floor.seed.settings, settingsFrom: floor.seed.settingsFrom,
    atL: atL, floorL: floor.floorL, floorNames: floor.seed.settingsFrom,
  });
}

function main() {
  const sb0 = tree();
  const built = buildLog(sb0);
  const log = built.log;
  const honest = cutAt(sb0, log, CUT_L);
  // THE LYING SEED: same cut, but the pointer names the settings event that landed LATER, and
  // the claimed values are that later event's. Nothing at the cut produced these values.
  const lying = JSON.parse(JSON.stringify(honest));
  lying.seed.settingsFrom = "$sLate";
  lying.seed.settings = sb0.StateDeriver.applySettingsEvent(
    sb0.StateDeriver.defaultSettings(), built.late);

  // Control first, because the gate depends on it.
  const ctl = setup("full", honest, log);
  const controlStatus = prove(ctl, honest, honest.floorL).status;

  const o = {
    sb: ctl, log: log, held: ctl.StreamManager.getLog().length,
    settingsInLog: log.filter((e) => e.type === "ddjp.room.settings").length,
    honest: honest, lateL: built.topL,
    playing: !!ctl.StreamManager.getState().nowPlaying,
    controlStatus: controlStatus,
  };

  if (SELFTEST) return selftest(o);

  const broken = runGate(o);
  if (broken.length) {
    console.log("PROBE INADMISSIBLE — no result printed. Stage(s) that broke:");
    for (const b of broken) console.log("  " + b);
    process.exit(2);
  }

  const rows = [];
  for (const [seedName, floor] of [["HONEST", honest], ["LYING", lying]]) {
    for (const mode of ["full", "thin"]) {
      const sb = setup(mode, floor, log);
      const headL = built.topL;
      rows.push({ seed: seedName, client: mode, shape: "AT_CUT",
                  v: prove(sb, floor, floor.floorL) });
      const sb2 = setup(mode, floor, log);
      rows.push({ seed: seedName, client: mode, shape: "AT_HEAD",
                  v: prove(sb2, floor, headL) });
    }
  }

  console.log("J35 Q1 — does a distinct `atL` make the floor branch usable?");
  console.log("cut l=" + honest.floorL + "  late settings at l=" + built.topL +
              "  seed.settingsFrom=" + honest.seed.settingsFrom);
  console.log("");
  console.log("seed    client  shape    verdict       reason");
  for (const r of rows) {
    console.log(
      (r.seed + "      ").slice(0, 8) +
      (r.client + "      ").slice(0, 8) +
      (r.shape + "         ").slice(0, 9) +
      (r.v.status + "              ").slice(0, 14) +
      (r.v.reason || ""));
  }

  // The one row that decides the question: a LYING seed that AT_HEAD lets through.
  const leak = rows.find((r) => r.seed === "LYING" && r.shape === "AT_HEAD" &&
                                r.v.status === "validated");
  const atCutCatches = rows.filter((r) => r.seed === "LYING" && r.shape === "AT_CUT")
                          .every((r) => r.v.status !== "validated");
  console.log("");
  console.log("AT_HEAD validates a lying seed : " + (leak ? "YES — " + JSON.stringify(leak) : "no"));
  console.log("AT_CUT never validates a lie   : " + atCutCatches);

  // Q2 — the read-back, driven. A thin client with a WORKING pager and with a broken one.
  console.log("");
  console.log("J35 Q2 — does readBack move the thin client's verdict, and does a failed page withhold?");
  for (const [seedName, floor] of [["HONEST", honest], ["LYING", lying]]) {
    for (const [pagerName, pager] of [
      ["works", async () => log.filter((e) => e.type === "ddjp.room.settings")],
      ["throws", async () => { throw new Error("scrollback failed"); }],
      ["not-an-array", async () => null],
      ["absent", null],
    ]) {
      const sb = setup("thin", floor, log);
      sb.SettingsProof.attach({ now: () => 1, pageSettings: pager });
      const before = prove(sb, floor, floor.floorL).status;
      const r = sb.SettingsProof.readBack(0);
      const done = (r && typeof r.then === "function") ? r : Promise.resolve(r);
      // eslint-disable-next-line no-loop-func
      done.then((res) => {
        const after = prove(sb, floor, floor.floorL);
        console.log("  " + (seedName + "      ").slice(0, 8) +
                    "pager=" + (pagerName + "            ").slice(0, 13) +
                    "before=" + (before + "          ").slice(0, 11) +
                    "readBack=" + (res && res.ok ? "ok" : "fail") +
                    "  after=" + after.status + " " + (after.reason || "") +
                    "  licence=" + sb.SettingsProof.licensesForget());
      });
    }
  }
}

// ── THE GATE'S OWN SELF-TEST ───────────────────────────────────────────────────────────────
// Each row breaks exactly one precondition and must be caught by exactly the stage written for
// it. A gate that passes everything is a gate that certifies everything.
function selftest(good) {
  const cases = [
    ["S1-modules", Object.assign({}, good, { sb: { SettingsProof: {} } })],
    ["S2-log-landed", Object.assign({}, good, { held: 0 })],
    ["S3-two-settings-events", Object.assign({}, good, { settingsInLog: 1 })],
    ["S4-seed-names-an-event", Object.assign({}, good, {
      honest: { seed: { settingsFrom: null }, floorL: good.honest.floorL } })],
    ["S5-room-is-playing", Object.assign({}, good, { playing: false })],
    ["S6-cut-below-late-settings", Object.assign({}, good, { lateL: 0 })],
    ["S7-control-validates", Object.assign({}, good, { controlStatus: "unverifiable" })],
  ];
  let bad = 0;
  console.log("GATE SELF-TEST — each row breaks one precondition:");
  const clean = runGate(good);
  if (clean.length) { console.log("  FAIL: the good input was refused: " + clean.join("; ")); bad++; }
  else console.log("  ok    the good input is admitted");
  for (const [stage, obj] of cases) {
    const broke = runGate(obj);
    const caught = broke.some((b) => b.indexOf(stage) === 0);
    if (!caught) { bad++; console.log("  FAIL  " + stage + " was NOT caught (got: " + broke.join("; ") + ")"); }
    else console.log("  ok    " + stage + " caught: " + broke.find((b) => b.indexOf(stage) === 0));
  }
  console.log(bad ? "GATE SELF-TEST FAILED (" + bad + ")" : "GATE SELF-TEST PASSED");
  process.exit(bad ? 1 : 0);
}

main();
