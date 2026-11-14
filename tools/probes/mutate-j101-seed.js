// tools/probes/mutate-j101-seed.js
// SUBJECT: J101's first half, closed (`ddjp_600`, the owner's call): the seed check's `log-does-not-reach-genesis` case could
// never run and was removed; what keeps a trimmed tab out of the pre-forget comparison is `_deriveBest`'s trimmed branch
// (`backends/backend1/streammanager.js`), which folds from the floor's seed and returns before it. Held by
// `tests/check-seed-validation.js` T, driven with a real trim. Each row plants its edit(s), confirms every one LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row,
// and checked restored.
//   node tools/probes/mutate-j101-seed.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const SV = "check-seed-validation";
const EARLY = "    const f = _trustedFloor();\n    if (_trimmedBelow !== null) {\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // SV1 — the trimmed branch is never taken (no literal, as J101's own drive did it): a trimmed tab falls through to the
  // genesis fold of a log that starts at its floor, and the comparison runs on it. Since `ddjp_627` that comparison records
  // "cannot tell" (its data is not the whole room), never `mismatched`, so T's first row holds and the second names it: the
  // check ran for the new floor.
  ["SV1", [[SM, EARLY, EARLY.replace("_trimmedBelow !== null) {", "_trimmedBelow !== null && _trimmedBelow === null) {")]],
    SV, "FAIL — T: because it never runs the check", "RED"],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[SM, EARLY, "\n" + EARLY]], SV, "", "GREEN"],
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
