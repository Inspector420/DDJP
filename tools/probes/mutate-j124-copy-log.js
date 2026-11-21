// tools/probes/mutate-j124-copy-log.js
// SUBJECT: J124 — "Copy log" starts with the version (the owner, `ddjp_643`): `ui/panels.js` `_logText`'s first line names
// the build, read by `_logBuild` from the boot banner's own function (`app.js` `_runningVersion`, the window's), and the
// moment it was copied; held by `check-version-banner` (d). One row per way it could go wrong, each naming the failure it
// must cause in that guard, and a control. Each row plants its edit(s), confirms every one LANDED, runs the named guard and
// reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j124-copy-log.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const PN = "ui/panels.js";
const VB = "check-version-banner";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // CL1 — the copy opens as at `ddjp_643`, with no build.
  ["CL1", [[PN, "out.push(\"=== DDJP \" + _logBuild() + \" log — copied \"", "out.push(\"=== DDJP log — copied \""]],
    VB, "STARTS WITH THE BUILD", "RED"],
  // CL2 — the build written as a literal: right today, wrong after the next bump.
  ["CL2", [[PN, "return (typeof f === \"function\") ? String(f()) : \"v?\";", "return \"v575\";"]],
    VB, "STARTS WITH THE BUILD", "RED"],
  // CL3 — the copy no longer reaches the banner's function: it says "v?" on a page whose tags say otherwise.
  ["CL3", [[PN, "window._runningVersion : null;", "window._runningVersionOf : null;"]],
    VB, "STARTS WITH THE BUILD", "RED"],
  // CL4 — the moment it was copied goes.
  ["CL4", [[PN, "\" log — copied \" + _logFullStamp(Date.now()) +", "\" log\" +"]],
    VB, "and the moment it was copied", "RED"],
  // CL5 — the build a second time, lower down: one line, at the top.
  ["CL5", [[PN, "\" — line times are this device's LOCAL clock ===\");", "\" — line times are this device's LOCAL clock ===\");\n    out.push(\"DDJP \" + _logBuild());"]],
    VB, "once, at the top", "RED"],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[PN, "  function _logBuild() {\n", "  function _logBuild() {\n\n"]], VB, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
