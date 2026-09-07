// tools/probes/mutate-j17-lattice.js
//
// J17 — THE KEEP-ONE LATTICE OVER THE PANEL-COVERAGE RULE.
//
// `mutate-j17-settings.js` M4 found that adding one settings key with no panel control turns TWO
// guards red, not the one J45 recorded at v248: `check-settings-passthrough` and
// `check-settings-rows` PART G. Both are genuine assertions rather than crashes, and both say the
// same sentence — every setting the reducer defines must be reachable in the panel.
//
// Two sites, one rule. `roles.md` §9 is explicit about what that means and about what a
// single-site pass CANNOT answer: "each site is individually droppable" and "which site is
// enforcing" are different questions, and only the lattice separates them. Three outcomes have
// been seen in this tree and they exhaust the shapes — one enforcement with the others dominated
// (the activity-window clamps), none among four (`Floor.select`), and each independently
// load-bearing (J12's tier caps). Reasoning from "it looks redundant" has now been wrong in three
// different directions, which is the argument for running the rotations rather than arguing.
//
//   rotation 1   keep passthrough, drop rows PART G
//   rotation 2   keep rows PART G, drop passthrough
//   rotation 3   drop BOTH
//   CONTROL      with both dropped, do the two guards still RUN and PASS?
//
// ── THE CONTROL IS THE POINT, NOT CEREMONY ───────────────────────────────────────────────────
// J12's first lattice came back all-green INCLUDING its control, which does not mean "no
// enforcement" — it means the suite never reached the subjects, so the rotations were
// INADMISSIBLE rather than informative. A lattice without a control adjacent to the subjects
// cannot tell "all redundant" from "nothing here is tested at all". Here the control is
// adjacency in the strongest available form: after dropping an assertion, its own guard must
// still execute to completion and print its PASS line. A guard that stopped running would make
// every green below meaningless.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const journal = require(path.join(__dirname, "_journal.js"));

const PROBE = "mutate-j17-lattice";
const SD = path.join(ROOT, "backends", "backend1", "statederiver.js");
const PASSTHRU = path.join(ROOT, "tests", "check-settings-passthrough.js");
const ROWS = path.join(ROOT, "tests", "check-settings-rows.js");

const rec = journal.recover();
if (rec.restored.length) console.log("[lattice] recovered a dirty tree: " + rec.restored.map((r) => r.file).join(", "));
if (rec.skipped.length) { console.log("[lattice] REFUSING — unrestorable: " + JSON.stringify(rec.skipped)); process.exit(1); }

// ── anchors, each asserted to match exactly once ─────────────────────────────────────────────
const KEY_ANCHOR = "      receiptsPerMessage: 10,                 // how many vouch receipts ride along in one message";
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
const KEY_INSERT = '      zzProbeVehicleKey: {},                      // LATTICE';

// The two subject assertions, quoted from their own files.
const S_PASSTHRU = `  ok(named || read, "the settings panel surfaces a control for '" + key + "'");`;
const S_ROWS = `  ok(unexposed.length === 0,
    "G: every setting the reducer defines must be reachable in the panel — one that is not is a " +
    "value the room has and the owner can neither see nor change", unexposed);`;

function verifyAnchors() {
  const p = fs.readFileSync(PASSTHRU, "utf8"), r = fs.readFileSync(ROWS, "utf8");
  const problems = [];
  if (p.split(S_PASSTHRU).length - 1 !== 1) problems.push("the passthrough anchor matched " + (p.split(S_PASSTHRU).length - 1) + " times, expected 1");
  if (r.split(S_ROWS).length - 1 !== 1) problems.push("the rows anchor matched " + (r.split(S_ROWS).length - 1) + " times, expected 1");
  return problems;
}
const anchorProblems = verifyAnchors();
if (anchorProblems.length) {
  console.log("[lattice] INADMISSIBLE — the anchors do not identify the subjects:");
  for (const p of anchorProblems) console.log("      " + p);
  console.log("      Every red below would trace to a bad anchor rather than to the lattice —");
  console.log("      which is the inadmissible run roles.md §9 records happening to Floor.select.");
  process.exit(1);
}

// Run one guard; return { red, ran, passLine }.
function runGuard(file) {
  let out = "", red = false;
  try { out = execFileSync(process.execPath, [file], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }); }
  catch (e) { red = true; out = (e.stdout || "") + (e.stderr || ""); }
  return { red, ran: out.length > 0, passLine: /PASS/.test(out), out };
}

// A rotation: add the key, optionally drop each subject, run both guards.
function rotate(label, dropPassthru, dropRows) {
  const hSD = journal.open(PROBE, SD);
  const hP = dropPassthru ? journal.open(PROBE, PASSTHRU) : null;
  const hR = dropRows ? journal.open(PROBE, ROWS) : null;
  let result = null;
  try {
    hSD.apply(KEY_ANCHOR, KEY_ANCHOR + "\n" + KEY_INSERT, 1);
    if (hP) hP.apply(S_PASSTHRU, "/* LATTICE-DROPPED */", 1);
    if (hR) hR.apply(S_ROWS, "  /* LATTICE-DROPPED */", 1);

    // APPLIED CHECK, BEFORE.
    const bad = [];
    if (!hSD.stillApplied("zzProbeVehicleKey")) bad.push("the key");
    if (hP && !hP.stillApplied("LATTICE-DROPPED")) bad.push("the passthrough drop");
    if (hR && !hR.stillApplied("LATTICE-DROPPED")) bad.push("the rows drop");
    if (bad.length) throw new Error("APPLIED CHECK FAILED before the run: " + bad.join(", "));

    const p = runGuard(PASSTHRU), r = runGuard(ROWS);

    // APPLIED CHECK, AFTER THE RESULT IS READ. §8: under collision a green mutation is VOID.
    const bad2 = [];
    if (!hSD.stillApplied("zzProbeVehicleKey")) bad2.push("the key");
    if (hP && !hP.stillApplied("LATTICE-DROPPED")) bad2.push("the passthrough drop");
    if (hR && !hR.stillApplied("LATTICE-DROPPED")) bad2.push("the rows drop");
    if (bad2.length) {
      console.log("[lattice] " + label + ": VOID — undone underneath the reader (" + bad2.join(", ") + "). Discarded.");
      return null;
    }
    result = { label, passthru: p, rows: r, suiteRed: p.red || r.red };
  } finally {
    if (hR) hR.restore();
    if (hP) hP.restore();
    hSD.restore();
  }
  // restores must have worked or every later rotation reads a dirty tree
  for (const [f, m] of [[SD, "zzProbeVehicleKey"], [PASSTHRU, "LATTICE-DROPPED"], [ROWS, "LATTICE-DROPPED"]]) {
    if (fs.readFileSync(f, "utf8").indexOf(m) !== -1) {
      console.log("[lattice] REFUSING TO CONTINUE — restore failed on " + f); process.exit(1);
    }
  }
  return result;
}

console.log("[lattice] the rule: every key in defaultSettings() must be reachable in the settings panel");
console.log("[lattice] the mutation: +1 key with NO panel control\n");

const rots = [
  rotate("keep BOTH        (baseline)", false, false),
  rotate("keep passthrough (drop rows)", false, true),
  rotate("keep rows PART G (drop passthrough)", true, false),
  rotate("keep NOTHING     (drop both)", true, true),
];

console.log("  " + "rotation".padEnd(36) + "passthrough   rows   suite");
for (const r of rots) {
  if (!r) { console.log("  (a rotation was VOID — see above)"); continue; }
  console.log("  " + r.label.padEnd(36) +
    (r.passthru.red ? "RED" : "green").padEnd(14) +
    (r.rows.red ? "RED" : "green").padEnd(7) +
    (r.suiteRed ? "RED" : "GREEN"));
}

// ── THE ADJACENT CONTROL ─────────────────────────────────────────────────────────────────────
// In the drop-both rotation both guards go green. That is only a reading if they RAN. A guard
// that exits 0 having asserted nothing is indistinguishable from one that passed — which is the
// exact failure `08-build-and-deploy.md` §"A guard must announce itself" exists to catch, so the
// announcement is what is checked.
const both = rots[3];
console.log("");
if (!both) {
  console.log("[lattice] no control reading — the drop-both rotation was void");
} else {
  console.log("  CONTROL — with its assertion dropped, does each guard still RUN to completion?");
  console.log("    check-settings-passthrough  ran=" + both.passthru.ran + "  printed PASS=" + both.passthru.passLine);
  console.log("    check-settings-rows         ran=" + both.rows.ran + "  printed PASS=" + both.rows.passLine);
  if (!both.passthru.passLine || !both.rows.passLine) {
    console.log("    → INADMISSIBLE: a guard did not announce itself, so its green is not a reading");
  } else {
    console.log("    → both guards executed and announced; the greens above are readings");
  }
}

const j = JSON.parse(fs.readFileSync(journal.JOURNAL, "utf8"));
console.log("\n[lattice] tree restored; journal entries outstanding: " + j.entries.length);
