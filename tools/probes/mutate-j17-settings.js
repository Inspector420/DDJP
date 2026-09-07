// tools/probes/mutate-j17-settings.js
//
// J17 — WHAT ONE NEW SETTINGS KEY ACTUALLY COSTS, measured on THIS tree rather than inherited.
//
// The job entry states the cost as fact: "One new key in `defaultSettings` moves every checkpoint
// fingerprint and reopens the dead-checkpoint window, and that cost is per-CHANGE, not per-key."
// J45 measured it at v248 (`mutate-j25-settings-coupling.js` ROW 1). Two reasons to re-drive it
// here rather than cite it: the tree has moved a long way since v248, and the entry's per-CHANGE
// half — the thing that decides whether the schema is enumerated once or four times — was stated
// rather than measured. A claim produced by reasoning about a measurement is not the measurement.
//
//   M1  one new key            → does an existing checkpoint still verify?
//   M2  SIX new keys, one edit → is the damage the same, or six times worse?
//   M3  CONTROL: no key added, the same harness → the readings must differ from M1/M2
//   M4  which guards in the WHOLE suite go red — read, not predicted
//   M5  a key with no SETTING_RANGES row → what the reducer does with it
//
// ── THE JOURNAL, AND BOTH HALVES OF THE APPLIED CHECK ────────────────────────────────────────
// Every edit is journalled before it lands and the journal is cleared only after the bytes are
// restored, so a run that dies leaves the next reader told rather than guessing. And the applied
// check runs TWICE: before the measurement, and again after each result is read. `09-roadmap.md`
// §8 records the case that makes the second half necessary — a mutation that applied and was
// undone underneath the reader, producing a green for a mutation the tree never held. Under
// collision a green mutation is VOID rather than a survivor, so a failed re-check discards the
// row instead of keeping it for comparison.
//
// ── THE DIRECTION IS CHOSEN ON PURPOSE ───────────────────────────────────────────────────────
// §8: prefer the direction where the expected result is a CHANGE. Every row here expects
// something to APPEAR — a verification that was true becoming false, a guard that was green
// going red — because a mutation expected to leave the output alone cannot detect its own
// failure to apply.

// ── THE VEHICLE KEY WAS RENAMED WHEN J17's SCHEMA LANDED ──────────────────────────────────────
// This probe injects a NEW settings key to measure what adding one costs. It originally used
// `botDelegation` as the vehicle, which was the right choice while that key was a design and not a
// tree. J17's build landed all five bot keys, so `botDelegation` became a REAL key — and the
// probe's own applied-check then fired on every run: *"the restore did not remove botDelegation"*,
// because the restore was correctly putting back a file that has it. The probe refused rather than
// reporting a measurement taken against a key it had not added, which is the applied-check doing
// its job.
//
// The QUESTION is still live — what does adding a key cost — so the probe is repaired rather than
// retired: the vehicle is a name that is not a setting and is not going to become one. Retiring it
// would have thrown away a live measurement because its example had graduated.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const journal = require(path.join(__dirname, "_journal.js"));

const SD_FILE = path.join(ROOT, "backends", "backend1", "statederiver.js");
const PROBE = "mutate-j17-settings";

// Recover anything a previous run left behind BEFORE reading a single byte.
const rec = journal.recover();
if (rec.restored.length) {
  console.log("[mutate-j17] recovered a dirty tree from a previous run: " +
    rec.restored.map((r) => r.file + " (" + r.probe + ")").join(", "));
}
if (rec.skipped.length) {
  console.log("[mutate-j17] REFUSING TO RUN — the journal names files it could not restore: " +
    JSON.stringify(rec.skipped));
  process.exit(1);
}

// ── the measurement, run in a child process against whatever is on disk ──────────────────────
// A child process is not a nicety: the modules are `const X = (() => ...)()` IIFEs cached by the
// loader, so measuring a mutated file from the same process would read the copy loaded before the
// mutation and report the unmutated tree's answer with total confidence.
const MEASURE = `
const path = require("path");
const ROOT = ${JSON.stringify(ROOT)};
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const sb = loadInContext([
  "core/logger.js","backends/backend1/ranks.js","backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js","backends/backend1/eventcache.js",
  "backends/backend1/statederiver.js","backends/backend1/capabilities.js",
  "backends/backend1/streammanager.js","backends/backend1/checkpointformat.js",
], { localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, Date, Math, JSON,
     setTimeout, clearTimeout, setInterval, clearInterval, window:{}, document:{body:{appendChild(){}}} });
const SD = sb.StateDeriver;
const room = F.playingRoom({ songs: 2 });
const seed = SD.buildSeed(room.log);
const out = {
  keys: Object.keys(SD.defaultSettings()).sort(),
  keyCount: Object.keys(SD.defaultSettings()).length,
  seedSettingsKeys: Object.keys(seed.settings || {}).length,
  canon: JSON.stringify(seed.settings),
  rangeKeys: Object.keys(SD.SETTING_RANGES).sort(),
};
// The FINGERPRINT the floor layer recomputes and compares. This is the value that decides whether
// a checkpoint sealed under another shape can be verified at all.
try {
  const CF = sb.CheckpointFormat;
  out.fingerprintFn = !!(CF && (CF.fingerprint || CF.buildFingerprint || CF.hashSeed));
} catch (e) { out.fingerprintFn = false; }
// A stable stand-in for the fingerprint that needs no async hash: the canonical bytes the
// fingerprint commits. If these differ, the fingerprint differs — that is what canonical means.
out.seedBytes = JSON.stringify(seed);
process.stdout.write(JSON.stringify(out));
`;

function measure(label) {
  const raw = execFileSync(process.execPath, ["-e", MEASURE], { encoding: "utf8", cwd: ROOT });
  const r = JSON.parse(raw);
  r.label = label;
  return r;
}

function sha(s) { return require("crypto").createHash("sha256").update(s).digest("hex").slice(0, 16); }

// ── the anchor ───────────────────────────────────────────────────────────────────────────────
// Anchored on a line unique in the file, and `apply` refuses a match count other than 1 — the
// varieties in §8 are anchors that match nothing, match a comment, or match twice.
const ANCHOR = "      receiptsPerMessage: 10,                 // how many vouch receipts ride along in one message";

const rows = [];
function record(r) { rows.push(r); }

// ═══ BASELINE ════════════════════════════════════════════════════════════════════════════════
const base = measure("baseline");
console.log("[mutate-j17] baseline: " + base.keyCount + " settings keys, seed bytes " + sha(base.seedBytes));

// ═══ M1 — ONE NEW KEY ════════════════════════════════════════════════════════════════════════
function runMutation(label, insertText, marker) {
  const h = journal.open(PROBE, SD_FILE);
  let result = null, applied = 0;
  try {
    applied = h.apply(ANCHOR, ANCHOR + "\n" + insertText, 1);
    if (!h.stillApplied(marker)) throw new Error("APPLIED CHECK FAILED before the run — the edit is not on disk");
    const m = measure(label);
    // THE SECOND HALF: assert the mutation is STILL applied now that the result has been read.
    if (!h.stillApplied(marker)) {
      console.log("[mutate-j17] " + label + ": VOID — the mutation was undone underneath the reader. " +
        "Discarded rather than kept for comparison (§8: under collision a green mutation is void).");
      return null;
    }
    result = m;
    result.appliedHits = applied;
  } finally {
    h.restore();
  }
  // And the restore must have worked, or every row after this one reads a mutated tree.
  const after = fs.readFileSync(SD_FILE, "utf8");
  if (after.indexOf(marker) !== -1) {
    console.log("[mutate-j17] REFUSING TO CONTINUE — the restore did not remove " + marker);
    process.exit(1);
  }
  return result;
}

const m1 = runMutation("M1 one key",
  '      zzProbeVehicleKey: {},                      // MUTATION M1',
  "zzProbeVehicleKey");
if (m1) {
  record({ row: "M1", keys: m1.keyCount, bytes: sha(m1.seedBytes),
           changed: m1.seedBytes !== base.seedBytes });
  console.log("[mutate-j17] M1  +1 key  -> " + m1.keyCount + " keys, seed bytes " + sha(m1.seedBytes) +
    "  differs from baseline: " + (m1.seedBytes !== base.seedBytes));
}

// ═══ M2 — SIX NEW KEYS, ONE EDIT ═════════════════════════════════════════════════════════════
// The per-CHANGE claim. If the cost were per-key, six keys would be six times the damage; if it is
// per-change, six keys in one edit cost exactly what one key costs — one fingerprint move, one
// dead-checkpoint window.
const SIX = [
  '      zzProbeVehicleKey: {},                      // MUTATION M2',
  '      botPresenceSources: [],',
  '      botAfkMs: 900000,',
  '      botPingWindowMs: 120000,',
  '      botReputation: "believed",',
  '      botEnabled: false,',
].join("\n");
const m2 = runMutation("M2 six keys", SIX, "botPresenceSources");
if (m2) {
  record({ row: "M2", keys: m2.keyCount, bytes: sha(m2.seedBytes),
           changed: m2.seedBytes !== base.seedBytes });
  console.log("[mutate-j17] M2  +6 keys -> " + m2.keyCount + " keys, seed bytes " + sha(m2.seedBytes) +
    "  differs from baseline: " + (m2.seedBytes !== base.seedBytes));
}

// ═══ M3 — THE CONTROL ════════════════════════════════════════════════════════════════════════
// The same harness, the same child process, no key added. Without this, "the bytes differed" is
// indistinguishable from a harness that produces a different string every time it runs.
const m3 = measure("M3 control");
console.log("[mutate-j17] M3  CONTROL, no mutation -> " + m3.keyCount + " keys, seed bytes " +
  sha(m3.seedBytes) + "  differs from baseline: " + (m3.seedBytes !== base.seedBytes));

// ═══ M4 — WHICH GUARDS NOTICE ════════════════════════════════════════════════════════════════
// READ, never predicted. J45 recorded that only `check-settings-rows` goes red; that was v248 and
// this tree is 13 releases on with guards added since.
function suiteUnder(insertText, marker, label) {
  const h = journal.open(PROBE, SD_FILE);
  let reds = [], ran = false;
  try {
    h.apply(ANCHOR, ANCHOR + "\n" + insertText, 1);
    if (!h.stillApplied(marker)) throw new Error("APPLIED CHECK FAILED before the suite ran");
    const files = fs.readdirSync(path.join(ROOT, "tests"))
      .filter((f) => /^check-.*\.js$/.test(f)).sort();
    for (const f of files) {
      let ok = true;
      try { execFileSync(process.execPath, [path.join("tests", f)], { cwd: ROOT, stdio: "pipe" }); }
      catch (e) { ok = false; }
      if (!ok) reds.push(f);
    }
    ran = true;
    if (!h.stillApplied(marker)) {
      console.log("[mutate-j17] " + label + ": VOID — the mutation was undone during the suite run.");
      return null;
    }
  } finally { h.restore(); }
  const after = fs.readFileSync(SD_FILE, "utf8");
  if (after.indexOf(marker) !== -1) { console.log("[mutate-j17] REFUSING — restore failed"); process.exit(1); }
  return ran ? reds : null;
}

console.log("[mutate-j17] M4 running the whole suite under the one-key mutation (this takes a minute)...");
const redsMutated = suiteUnder('      zzProbeVehicleKey: {},                      // MUTATION M4', "zzProbeVehicleKey", "M4");
console.log("[mutate-j17] M4  guards RED under +1 key: " +
  (redsMutated && redsMutated.length ? redsMutated.join(" · ") : "(none)"));

// ═══ M5 — A KEY WITH NO SETTING_RANGES ROW ═══════════════════════════════════════════════════
// `settingKindOf` reads an entry's SHAPE, so a key with no row is `null` rather than a default —
// and a caller dispatching on the kind therefore has no predicate to apply.
const M5 = `
const path = require("path");
const ROOT = ${JSON.stringify(ROOT)};
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const sb = loadInContext(["core/logger.js","backends/backend1/ranks.js","backends/backend1/statederiver.js"],
  { Date, Math, JSON });
const SD = sb.StateDeriver;
const d = SD.defaultSettings();
const out = {
  kindOfNew: SD.settingKindOf("zzProbeVehicleKey"),
  kindOfNumeric: SD.settingKindOf("maxLen"),
  kindOfMembership: SD.settingKindOf("minDjRank"),
  inDefaults: Object.prototype.hasOwnProperty.call(d, "zzProbeVehicleKey"),
};
// Does a value for the un-ranged key survive applySettingsEvent?
const merged = SD.applySettingsEvent(d, Object.assign({}, d, { zzProbeVehicleKey: { staff: ["maxLen"] } }));
out.survives = JSON.stringify(merged.zzProbeVehicleKey);
process.stdout.write(JSON.stringify(out));
`;
const h5 = journal.open(PROBE, SD_FILE);
let m5 = null;
try {
  h5.apply(ANCHOR, ANCHOR + '\n      zzProbeVehicleKey: {},                      // MUTATION M5', 1);
  if (!h5.stillApplied("zzProbeVehicleKey")) throw new Error("APPLIED CHECK FAILED");
  m5 = JSON.parse(execFileSync(process.execPath, ["-e", M5], { encoding: "utf8", cwd: ROOT }));
  if (!h5.stillApplied("zzProbeVehicleKey")) { console.log("[mutate-j17] M5 VOID"); m5 = null; }
} finally { h5.restore(); }
if (m5) {
  console.log("[mutate-j17] M5  settingKindOf('zzProbeVehicleKey') = " + JSON.stringify(m5.kindOfNew) +
    "   (maxLen=" + m5.kindOfNew + "/" + m5.kindOfNumeric + ", minDjRank=" + m5.kindOfMembership + ")");
  console.log("[mutate-j17] M5  the key IS in defaultSettings: " + m5.inDefaults +
    " — but a settings EVENT carrying it merges to " + m5.survives);
}

// ═══ THE FINAL APPLIED CHECK ═════════════════════════════════════════════════════════════════
const finalSrc = fs.readFileSync(SD_FILE, "utf8");
for (const marker of ["zzProbeVehicleKey", "botPresenceSources", "MUTATION M"]) {
  if (finalSrc.indexOf(marker) !== -1) {
    console.log("[mutate-j17] FAILED TO RESTORE — '" + marker + "' is still on disk"); process.exit(1);
  }
}
const j = JSON.parse(fs.readFileSync(journal.JOURNAL, "utf8"));
console.log("[mutate-j17] tree restored; journal entries outstanding: " + j.entries.length);

// ═══ THE READING ═════════════════════════════════════════════════════════════════════════════
console.log("\n[mutate-j17] THE READING");
console.log("  baseline                 " + base.keyCount + " keys   seed " + sha(base.seedBytes));
if (m1) console.log("  +1 key  (M1)             " + m1.keyCount + " keys   seed " + sha(m1.seedBytes) + "   moved: " + (m1.seedBytes !== base.seedBytes));
if (m2) console.log("  +6 keys (M2, ONE edit)   " + m2.keyCount + " keys   seed " + sha(m2.seedBytes) + "   moved: " + (m2.seedBytes !== base.seedBytes));
console.log("  control (M3, no edit)    " + m3.keyCount + " keys   seed " + sha(m3.seedBytes) + "   moved: " + (m3.seedBytes !== base.seedBytes));
console.log("  guards red under +1 key: " + (redsMutated ? redsMutated.length : "?") +
  (redsMutated && redsMutated.length ? " — " + redsMutated.join(", ") : ""));
console.log("[mutate-j17] DONE");
