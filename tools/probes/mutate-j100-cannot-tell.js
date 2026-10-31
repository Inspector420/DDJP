// tools/probes/mutate-j100-cannot-tell.js
// SUBJECT: J100's second case, fixed at `ddjp_627` (the owner's option (i)): a difference the genesis check finds on a log that is
// not the whole room — the door set events aside below the floor, or the log never reached the room's start — is "cannot tell"
// (`backends/backend1/streammanager.js` `_deriveBest`), with its own reason and no warning. Each row undoes one piece and must
// turn `check-seed-validation` PART O red NAMING it; the control changes a branch no guard reaches and must leave it green.
//   CT1 — the incomplete-data rule is not asked.            CT2 — the reason names the wrong gap.
//   CT3 — the set-aside verdict is asked again on every arrival.   CT4 — "cannot tell" warns.
//   CT5 — only the door's set-aside counts (a log short of the start mismatches).   CT6 — everything is "cannot tell" (PART D, the whole room, goes red first).
//   CTc — the control: a log short of the start is also asked once; no guard watches its retry.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j100-cannot-tell.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js", SV = "check-seed-validation";
const COND = "if (_canon(seeded) !== _canon(genesis.state) && !_checkHadCompleteData()) {";
const GAP = "const _gap = (_derivedLogTrimmed !== 0) ? \"set-aside-below-floor\" : \"log-not-from-start\";";
const REC = "_recordValidation(\"not-yet-run\", _gap, sig, _gap === \"set-aside-below-floor\");";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["CT1", [[SM, COND, "if (false) {"]], SV, "FAIL — O1: the banked tab's difference is recorded \"cannot tell\"", "RED"],
  ["CT2", [[SM, GAP, "const _gap = \"log-not-from-start\";"]], SV, "FAIL — O1: the banked tab's difference is recorded \"cannot tell\"", "RED"],
  ["CT3", [[SM, REC, "_recordValidation(\"not-yet-run\", _gap, sig);"]], SV, "FAIL — O2: asked once", "RED"],
  ["CT4", [[SM, REC, REC + " Logger.warn(\"StreamManager: this tab's fold of the room from its start differs from save point n=\" + ((tr && tr.n !== undefined) ? tr.n : \"?\"));"]],
    SV, "FAIL — O1: and it warns nothing", "RED"],
  ["CT5", [[SM, COND, "if (_canon(seeded) !== _canon(genesis.state) && _derivedLogTrimmed !== 0) {"]], SV, "FAIL — O3: a log that does not reach the room's start", "RED"],
  ["CT6", [[SM, COND, "if (_canon(seeded) !== _canon(genesis.state)) {"]], SV, "FAIL — D: a diverging seed is recorded as mismatched", "RED"],
  // CTc WAS A CONTROL ("settling log-not-from-start too changes nothing"), measured green while the check re-ran at every
  // arrival anyway. CHANGED ON PURPOSE at `ddjp_645` (J125): "cannot tell" is now asked again per save point AND reach, and
  // settling it would record a non-conclusion as checked for good — paging further back would then never ask again (O6).
  ["CTc", [[SM, REC, "_recordValidation(\"not-yet-run\", _gap, sig, true);"]], SV, "FAIL — O6: and so does PAGING FURTHER BACK", "RED"],
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
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
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
