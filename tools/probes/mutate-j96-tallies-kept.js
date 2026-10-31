// tools/probes/mutate-j96-tallies-kept.js
// SUBJECT: J96, the owner's call on J95's finding. Song history keeps a row's vote and save tallies when another path rewrites the
// row without them — verify, which the backfill a trim rearms runs over every closed song (`backends/backend1/history.js`
// `_mergeIn`: what the rows held is taken before the merge, and a fold's own finals still come first). One row per rule, each
// naming the failure it must cause, and the control. Each row plants its edit(s), confirms every one LANDED, runs the guard and
// reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j96-tallies-kept.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js";
const HT = "check-history-tallies";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // TK1 — WHAT THE ROWS HELD NOT TAKEN BEFORE THE MERGE: verify's rows win, and the past tallies go (J95's finding).
  ["TK1", [[HI, "    for (const e of _entries) if (e && e.pi && e.counts) _had[e.pi] = e.counts;\n", ""]], HT,
    "FAIL — F: AFTER THE BACKFILL'S VERIFY, THE TAB THAT HELD EVERY EVENT KEEPS EVERY PAST SONG'S TALLY", "RED"],
  // TK2 — TAKEN, BUT NOT OFFERED BACK: the same.
  ["TK2", [[HI, "    const _final = Object.assign(Object.create(null), _had, finals || {});\n", "    const _final = Object.assign(Object.create(null), finals || {});\n"]], HT,
    "FAIL — F: AFTER THE BACKFILL'S VERIFY, THE TAB THAT HELD EVERY EVENT KEEPS EVERY PAST SONG'S TALLY", "RED"],
  // TK3 — WHAT THE ROW HELD WINS OVER A FOLD'S FINALS: a later count — a late vote on a finished song, the owner's count change —
  // no longer reaches the row. Measured green at J96 (every fold A–F read a tally as it was when its song ended); RED since J97's
  // PART G (the supervisor's J96 check), which moves a finished song's count after it ended.
  ["TK3", [[HI, "    const _final = Object.assign(Object.create(null), _had, finals || {});\n", "    const _final = Object.assign(Object.create(null), finals || {}, _had);\n"]], HT,
    "FAIL — G: A LATE VOTE ON A FINISHED SONG REPLACES THE TALLY ITS ROW HELD", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[HI, "    const _had = Object.create(null);\n", "    const _had = Object.create(null);\n\n"]], HT, "", "GREEN"],
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
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green" + (id === "N1" ? " — the control" : "")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — measured green went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
