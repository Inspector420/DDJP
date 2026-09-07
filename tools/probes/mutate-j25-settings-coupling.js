// tools/probes/mutate-j25-settings-coupling.js
//
// J25 — WHAT A FILE WRITTEN TODAY MEANS WHEN IT IS READ AFTER THE SETTINGS CHANGE.
//
// `seed.settings` is a WHOLE-BLOB copy (`statederiver.js` buildSeed) and `h` commits the seed
// (`checkpointformat.js`), so the save file is coupled to every settings key by construction. The
// J25 entry does not say this; `checkpoint-contents.md` §1.3 says it for checkpoints. This probe
// measures what that coupling actually does, in BOTH directions, because the two mechanisms that
// read a seed disagree and the disagreement is the finding:
//
//   ROW 1 · a KEY IS ADDED after the file was written
//   ROW 2 · a DEFAULT VALUE CHANGES after the file was written   (this is J10's whole shape)
//
// For each, three questions, each with its own control:
//   Q-chain    does `Floor.chainVerifies` still verify checkpoints sealed under the old reducer?
//   Q-licence  does the production pre-forget check (`StreamManager.seedValidation`) still say
//              `validated`? Reached through the real predicate, with a stubbed Floor exactly as
//              `check-seed-validation` does, not by re-implementing `_canon` here.
//   Q-import   what settings does a client that holds ONLY the file end up running under?
//
// ── THE RULES THIS FILE OBEYS (09-roadmap.md §8) ──────────────────────────────────────────────
// · A JOURNAL ON DISK BEFORE THE FIRST EDIT, recovered on the next run. A restore that lives only
//   in the running process is not a restore.
// · THE ANCHOR MUST MATCH EXACTLY ONCE, asserted before the edit — `replace` reports success on
//   matching nothing.
// · THE MUTATION MUST STILL BE PRESENT WHEN THE RESULT IS READ. Before-only is worthless if a
//   second hand is on the tree; a green row from a file somebody restored underneath you is VOID.
// · EVERY ROW HAS A CONTROL THAT MUST MOVE. A refusal is evidence only if something adjacent was
//   admitted.
//
// Usage:  node tools/probes/mutate-j25-settings-coupling.js [--suite]
//         --suite additionally runs the whole guard suite under each mutation and reports which
//         guards go red, because "I predicted a guard would fire" is a claim about the guard.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, "tools", "probes", ".mutate-j25-settings.journal.json");
const SD_FILE = "backends/backend1/statederiver.js";
const RUN_SUITE = process.argv.indexOf("--suite") >= 0;

// ── recover from an interrupted previous run BEFORE touching anything ────────────────────────
if (fs.existsSync(JOURNAL)) {
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  for (const rel in j.files) fs.writeFileSync(path.join(ROOT, rel), j.files[rel]);
  fs.unlinkSync(JOURNAL);
  console.log("[j25-coupling] recovered a mutated tree from a previous run (" + j.row + ")");
}

const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const B = "backends/backend1/";
const noop = () => {};

function load() {
  return loadInContext([
    "core/logger.js", B + "ranks.js", B + "consensushash.js", B + "trustpolicy.js",
    B + "statederiver.js", B + "checkpointformat.js", B + "floor.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise,
       Logger: { info: noop, warn: noop, error: noop, debug: noop } });
}

// A room that never authors the dial under test, which is the case the coupling bites: the value
// in the file came from `defaultSettings()` rather than from anything anybody wrote down.
function roomLog() {
  const r = F.playingRoom({ songs: 3 });
  return { ordered: F.sortLog(r.log), cutIdx: 5 };
}

// ROW 3's fixture: the same room plus ONE owner settings event the reducer refuses TODAY, because
// its `vouchJitter` sits above `SETTING_RANGES`' max. The pair is satisfied (minGate 45000 clears
// 7.5 x 6000), so the ONLY thing standing between this blob and the fold is the range bound.
function refusedBlobLog() {
  const r = F.playingRoom({ songs: 3 });
  const log = r.log.slice();
  const base = load().StateDeriver.defaultSettings();
  log.push(F.reducerEvent("$wide", r.lastL + 1, 500000, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings",
      s: Object.assign({}, base, { vouchJitter: 6000, minGate: 45000 }) }));
  return F.sortLog(log);
}

// ── the artefacts, built ONCE against the UNMUTATED tree — this is "the file written today" ───
const { ordered, cutIdx } = roomLog();
const WIDE_LOG = refusedBlobLog();
const base = load();
const preSeedAtCut = base.StateDeriver.buildSeed(ordered.slice(0, cutIdx + 1));
const preSeedFull = base.StateDeriver.buildSeed(ordered);
const preSettings = base.StateDeriver.derive(ordered).settings;

function mkCp(SBcf, n, prev, seed, floorL, covers, who) {
  const cp = { n, prev, seed, floorL, thin: false, covers, u: who, r: F.RANK.staff };
  cp.h = SBcf.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}
const cutA = ordered[cutIdx], cutB = ordered[ordered.length - 1];
const cpA = mkCp(base.CheckpointFormat, 1, null, preSeedAtCut, cutA.l,
  base.CheckpointFormat.coversOf(ordered[0].eventId, cutA.eventId), "@p1:hs");
const cpB = mkCp(base.CheckpointFormat, 2, cpA.h,
  base.StateDeriver.buildSeed(ordered.slice(cutIdx + 1), preSeedAtCut), cutB.l,
  base.CheckpointFormat.coversOf(ordered[cutIdx + 1].eventId, cutB.eventId), "@p2:hs");
// JSON round-trip: what leaves this process in a file is bytes, not live objects.
const FILE = JSON.parse(JSON.stringify({ cps: [cpA, cpB], seedAtCut: preSeedAtCut, seedFull: preSeedFull }));

// ── the three measurements, run against WHATEVER the tree currently says ──────────────────────
function measure() {
  const sb = load();
  const SD = sb.StateDeriver;

  const chain = sb.Floor.chainVerifies(FILE.cps, ordered);

  const importSettings = SD.derive([], FILE.seedFull).settings;
  const freshSettings = SD.derive(ordered).settings;

  // Q-licence, through the production predicate.
  // THE FLOOR GOES ON AFTER THE LOG IS IN, and this is the third probe defect this session's
  // gates have caught rather than the arrangement anyone would write first. With `Floor.current()`
  // answering from the first ingest, J03's accepted boundary IGNORES every arrival at or below the
  // cut — so the boundary event never enters the log, `_eventsAfterCheckpoint` cannot locate it,
  // and every tree returns `not-yet-run/no-boundary`. That is the same value in the control and in
  // both mutations: absence reading as agreement, exactly the shape the gate exists for.
  const cp = FILE.cps[0];
  let floorOn = false;
  const sm = loadInContext(
    ["core/logger.js", B + "ranks.js", B + "consensushash.js", B + "trustpolicy.js",
     B + "statederiver.js", B + "streammanager.js"],
    { Date, Math, JSON, setTimeout, clearTimeout, Promise,
      Logger: { info: noop, warn: noop, error: noop, debug: noop },
      Floor: { current: () => (floorOn ? cp : null), seed: () => (floorOn ? cp.seed : null) },
      SettingsProof: { licensesForget: () => true, verdict: () => ({ status: "validated" }) } });
  for (let i = 0; i < ordered.length - 1; i++) sm.StreamManager.ingest(F.toRaw(ordered[i]));
  floorOn = true;                                   // the checkpoint arrives once the log is whole
  sm.StreamManager.ingest(F.toRaw(ordered[ordered.length - 1]));
  const v = sm.StreamManager.seedValidation();

  const widened = SD.derive(WIDE_LOG).settings.vouchJitter;
  const untouched = SD.derive(ordered).settings.vouchJitter;   // ROW 3's control: no settings event

  return { chain, licence: v.status + (v.reason ? "/" + v.reason : ""),
           refusedBlobFoldsTo: widened, noBlobRoomFoldsTo: untouched,
           importDial: importSettings.vouchJitter, freshDial: freshSettings.vouchJitter,
           importKeys: Object.keys(importSettings).length, freshKeys: Object.keys(freshSettings).length,
           probeDialAfterImport: importSettings.probeDial };
}

// ── mutation plumbing ─────────────────────────────────────────────────────────────────────────
const ROWS = [
  { id: "ROW 1", name: "a settings KEY IS ADDED after the file was written",
    from: "      receiptsPerMessage: 10,",
    to:   "      receiptsPerMessage: 10,\n      probeDial: 7,",
    expect: "chain REFUSES (the recomputed blob has a key the sealed one cannot have); the licence " +
            "is UNAFFECTED (both folds gain the key from the same defaults)" },
  { id: "ROW 2", name: "a DEFAULT VALUE CHANGES after the file was written (J10's shape)",
    from: "      vouchJitter: 1000,",
    to:   "      vouchJitter: 3000,",
    expect: "chain STILL VERIFIES (the sealed blob overrides the new default); the LICENCE breaks " +
            "for a room that never set the dial; the import runs on the OLD value for ever" },
  { id: "ROW 3", name: "a SETTING_RANGES BOUND IS WIDENED (J10's other half)",
    from: "    vouchJitter:          { min: 500, max: 5000,      scale: 1 },",
    to:   "    vouchJitter:          { min: 500, max: 20000,     scale: 1 },",
    expect: "the SAME LOG folds to a DIFFERENT room: an owner blob refused today merges tomorrow. " +
            "This is retroactive re-judgement of an event already in the log, which is a different " +
            "and heavier class than re-tuning a default" },
];

function applyRow(r) {
  const abs = path.join(ROOT, r.file || SD_FILE);
  const src = fs.readFileSync(abs, "utf8");
  const n = src.split(r.from).length - 1;
  if (n !== 1) return { ok: false, why: "anchor matched " + n + " times, not exactly once" };
  fs.writeFileSync(JOURNAL, JSON.stringify({ row: r.id, files: { [r.file || SD_FILE]: src } }));
  fs.writeFileSync(abs, src.split(r.from).join(r.to));
  return { ok: true, before: src };
}
function stillApplied(r) {
  return fs.readFileSync(path.join(ROOT, r.file || SD_FILE), "utf8").indexOf(r.to) >= 0;
}
function restore() {
  if (!fs.existsSync(JOURNAL)) return;
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  for (const rel in j.files) fs.writeFileSync(path.join(ROOT, rel), j.files[rel]);
  fs.unlinkSync(JOURNAL);
}
function suiteReds() {
  try { execFileSync("node", ["tests/run-all.js"], { cwd: ROOT, encoding: "utf8" }); return []; }
  catch (e) {
    const out = String((e.stdout || "") + (e.stderr || ""));
    return Array.from(new Set((out.match(/^\[[a-z0-9-]+\] FAIL/gm) || [])
      .map((s) => s.replace(/^\[|\] FAIL$/g, ""))));
  }
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────
console.log("[j25-coupling] the file was written by the UNMUTATED tree: " + FILE.cps.length +
  " snapshots, seed.settings carries " + Object.keys(preSettings).length + " keys");

const control = measure();
console.log("\n  CONTROL (no mutation) — the row below is readable only if this one is clean");
console.log("        " + JSON.stringify(control));
if (!(control.chain === true && control.licence === "validated" &&
      control.refusedBlobFoldsTo === control.noBlobRoomFoldsTo)) {
  console.log("  → VOID: the unmutated control does not verify, does not license, or already folds " +
    "the out-of-range blob. Nothing after this measures a mutation.");
  process.exit(1);
}

for (const r of ROWS) {
  console.log("\n  " + r.id + " · " + r.name);
  console.log("        expected: " + r.expect);
  const a = applyRow(r);
  if (!a.ok) { console.log("        → NOT RUN — " + a.why); continue; }
  let observed = null, reds = null, err = null;
  try {
    observed = measure();
    if (RUN_SUITE) reds = suiteReds();
  } catch (e) { err = String((e && e.message) || e); }
  const held = stillApplied(r);
  restore();
  if (!held) { console.log("        → VOID — the mutation was not present when the result was read"); continue; }
  if (err) { console.log("        → THREW: " + err); continue; }
  console.log("        observed: " + JSON.stringify(observed));
  console.log("        chain " + (observed.chain === control.chain ? "UNCHANGED (" : "MOVED (") +
    control.chain + " → " + observed.chain + ") · licence " +
    (observed.licence === control.licence ? "UNCHANGED (" : "MOVED (") +
    control.licence + " → " + observed.licence + ")");
  if (reds) console.log("        suite under this mutation: " +
    (reds.length ? reds.length + " red — " + reds.join(" · ") : "ALL GREEN — nothing in the tree " +
     "notices, which is a fact about the guards, not about the change"));
}

restore();
console.log("\n[j25-coupling] tree restored; journal " + (fs.existsSync(JOURNAL) ? "STILL PRESENT (investigate)" : "clean"));
