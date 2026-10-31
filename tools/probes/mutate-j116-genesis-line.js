// tools/probes/mutate-j116-genesis-line.js
// SUBJECT: the genesis check's warning says what it compared (`backends/backend1/streammanager.js` `_comparedWords`; the owner's
// `?v=558` run of J116's live checks, where the bot's tab named only "save point n=2"). It has no job of its own, so it carries
// the number of the run it came from. Each row puts one part of the line back the way it was and must turn
// `check-seed-validation` PART N red NAMING it; the control changes a branch no guard reaches and must leave it green.
//   GL1 — the line names nothing but n again.          GL2 — the save point's event is looked up without its fingerprint.
//   GL3 — the save point's event is not looked up.      GL4 — the channel's rung is not read.
//   GL5 — the field is picked in another order.         GL6 — the two values are swapped.
//   GL7 — the line is built outside its own try, so a line that cannot be built turns the verdict into "threw".
//   GL8 — an object field is shown whole again (`ddjp_627`'s narrowing undone).   GL9 — the equal keys are listed too.
//   GL10 — a narrowed key's two values are swapped.    GL11 — the keys come in reverse order.
//   GL12 — a field that is null on one side is taken for an object.
//   GLc — the control: the wording for an event whose channel rung cannot be read, which no guard drives.
//   GLc2 — the control: the wording for a key one side does not have, which no guard drives.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j116-genesis-line.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js", SV = "check-seed-validation";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["GL1", [[SM, "((tr && tr.n !== undefined) ? tr.n : \"?\") + _what + \" — most often", "((tr && tr.n !== undefined) ? tr.n : \"?\") + \" — most often"]],
    SV, "FAIL — N1: the line names the save point's n and its author", "RED"],
  ["GL2", [[SM, "e.type === \"ddjp.checkpoint\" && e.content && e.content.h === f.h)", "e.type === \"ddjp.checkpoint\" && e.content)"]],
    SV, "FAIL — N3: a save point whose event this tab does not hold is said so", "RED"],
  ["GL3", [[SM, "  function _comparedWords(f, ordered, fromStart, fromSeed) {\n    const cp = (f && f.h) ?", "  function _comparedWords(f, ordered, fromStart, fromSeed) {\n    const cp = false ?"]],
    SV, "FAIL — N1: the line names the save point's own event", "RED"],
  ["GL4", [[SM, "typeof Ranks !== \"undefined\") ? Ranks.nameOf(cp.senderRank) : null;", "typeof Ranks !== \"undefined\") ? null : null;"]],
    SV, "FAIL — N1: the line names the save point's own event", "RED"],
  ["GL5", [[SM, "    const k = _firstDiffering(fromStart, fromSeed);\n", "    const k = REPRODUCE_FIELDS.slice().reverse().find((x) => _canonAny(_field(fromStart, x)) !== _canonAny(_field(fromSeed, x))) || null;\n"]],
    SV, "FAIL — N1: the line names the first differing field", "RED"],
  ["GL6", [[SM, "return \" — from the start: \" + _canonAny(a) + \"; from the save point: \" + _canonAny(b);",
    "return \" — from the start: \" + _canonAny(b) + \"; from the save point: \" + _canonAny(a);"]],
    SV, "FAIL — N1: the line names the first differing field", "RED"],
  ["GL7", [[SM, "try { _what = _comparedWords(tr, ordered, genesis.state, seeded); } catch (eW) { _what = \" (what it compared could not be said)\"; }",
    "_what = _comparedWords(tr, ordered, genesis.state, seeded);"]],
    SV, "FAIL — N4: a line that cannot be built changes no verdict", "RED"],
  ["GL8", [[SM, "(k ? \" first at \" + k + _keysThatDiffer(_field(fromStart, k), _field(fromSeed, k)) : \"\");",
    "(k ? \" first at \" + k + \" — from the start: \" + _canonAny(_field(fromStart, k)) + \"; from the save point: \" + _canonAny(_field(fromSeed, k)) : \"\");"]],
    SV, "FAIL — N5: an object field is shown by the one key that differs", "RED"],
  ["GL9", [[SM, "const diff = keys.filter((x) => has(a, x) !== has(b, x) || _canonAny(a[x]) !== _canonAny(b[x]));", "const diff = keys;"]],
    SV, "FAIL — N5: an object field is shown by the one key that differs", "RED"],
  ["GL10", [[SM, "diff.map((x) => x + \" from the start: \" + shown(a, x) + \", from the save point: \" + shown(b, x))",
    "diff.map((x) => x + \" from the start: \" + shown(b, x) + \", from the save point: \" + shown(a, x))"]],
    SV, "FAIL — N5: an object field is shown by the one key that differs", "RED"],
  ["GL11", [[SM, "const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();",
    "const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort().reverse();"]],
    SV, "FAIL — N6: two keys that differ are both named, in key order", "RED"],
  ["GL12", [[SM, "const plain = (x) => !!x && typeof x === \"object\" && !Array.isArray(x);", "const plain = (x) => typeof x === \"object\" && !Array.isArray(x);"]],
    SV, "FAIL — N7: a field that is not an object on both sides is shown whole", "RED"],
  ["GLc", [[SM, "\" arrived on the \" + (tier || \"unknown\") + \" channel\"", "\" arrived on the \" + (tier || \"unreadable\") + \" channel\""]],
    SV, "", "GREEN"],
  ["GLc2", [[SM, "const shown = (o, x) => has(o, x) ? _canonAny(o[x]) : \"(absent)\";", "const shown = (o, x) => has(o, x) ? _canonAny(o[x]) : \"(missing)\";"]],
    SV, "", "GREEN"],
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
