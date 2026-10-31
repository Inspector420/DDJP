// tools/probes/mutate-j95-on-arrival.js
// SUBJECT: J95, the owner's calls on J94's decisions (ruling 43). An arrival set aside below the save point a tab follows is owed
// to the "recently active" record and the repeat rule's added record at once: the coalesced sweep (`settleBanked`) takes the
// stretch's acts and additions as soon as its fold from the held base reproduces that save point (`_setAsideLate`,
// `_takeSetAside`, `_firstDiffering` in `backends/backend1/streammanager.js`); the trim's added record takes the set-aside
// additions too. One row per rule, each naming the failure it must cause, and the control. Each row plants its edit(s),
// confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is
// restored after every row, and checked restored.
//   node tools/probes/mutate-j95-on-arrival.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const SB = "check-short-base-readers";
const NOW = "FAIL — N: WHO IS RECENTLY ACTIVE", ADDS = "FAIL — N: THE REPEAT RULE'S ADDED RECORD", W = "FAIL — W: A STRETCH NOT YET WHOLE";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // AR1 — NOTHING OWED WHEN AN ARRIVAL IS SET ASIDE: the set-aside acts wait for the trim again (J94's window).
  // (A statement of its own, not an `else` of the trimmed line: `mutate-j78-cleanup` C2 removes that line.)
  ["AR1", [[SM, "      if (_bank.kind === \"accepted\" && !_adopted) _setAsideLate();   // set aside: its acts and additions are taken once its stretch is whole (J95)\n", ""]], SB, NOW, "RED"],
  // AR2 — THE SWEEP DOES NOT PAY THE DEBT.
  ["AR2", [[SM, "    if (aside) _takeSetAside();   // ruling 43, as they arrive (J95)\n", ""]], SB, NOW, "RED"],
  // AR3 — THE SWEEP NOT ASKED FOR: measured green. In the drive the same reopen also banks arrivals below the trimmed boundary,
  // whose sweep pays this debt too; a reopen that banks none would wait for the next banked arrival or the trim.
  ["AR3", [[SM, "    _asideOwed = true;\n    for (const fn of (subscribers[\"ddjp.local.banked\"] || [])) { try { fn({}); } catch (e) {} }\n", "    _asideOwed = true;\n"]], SB, "", "GREEN"],
  // AR4 — TAKEN BEFORE THE STRETCH IS WHOLE: acts judged by a fold short of it.
  ["AR4", [[SM, "    if (_firstDiffering(st, StateDeriver.derive([], sb.from.seed))) return false;   // not whole yet\n", ""]], SB, W, "RED"],
  // AR5 — JUDGED FROM THE SAVE POINT'S SEED, which already banks the stretch: every act in it is unknown to that fold, so refused.
  ["AR5", [[SM, "    const judge = _acceptedBy(stretch, _heldBase);\n", "    const judge = _acceptedBy(stretch, sb.from.seed);\n"]], SB, NOW, "RED"],
  // AR6 — THE ACTS NOT TAKEN.
  ["AR6", [[SM, "    if (typeof Activity !== \"undefined\" && Activity.take) Activity.take(aside, judge, {});\n", ""]], SB, NOW, "RED"],
  // AR7 — THE ADDITIONS NOT NOTED.
  ["AR7", [[SM, "    if (typeof History !== \"undefined\" && History.noteAdds) History.noteAdds(aside, judge);\n", ""]], SB, ADDS, "RED"],
  // AR8 — THE TRIM'S ADDED RECORD WITHOUT THE SET-ASIDE ADDITIONS. RE-AIMED AT J96 (the supervisor's J95 check): measured green
  // while only N read the record, which the sweep fills first (and song history's hand-off notes them too when the cache holds the
  // whole stretch); W now reads it after a stretch that never became whole, where only the trim's own record can fill it.
  ["AR8", [[SM, "History.noteAdds(_taken, _legal);", "History.noteAdds(_drop, _legal);"]], SB, "FAIL — W: AT THE TRIM, THE REPEAT RULE'S ADDED RECORD TAKES THE SET-ASIDE ADDITIONS", "RED"],
  // AR9 — A NEW ROOM INHERITS THE DEBT: measured green. The take reads the room it is in, and a new room has nothing set aside.
  ["AR9", [[SM, "    _asideOwed = false;       // nor a set-aside take (J95)\n", ""]], SB, "", "GREEN"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[SM, "  let _asideOwed = false;\n", "  let _asideOwed = false;\n\n"]], SB, "", "GREEN"],
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
