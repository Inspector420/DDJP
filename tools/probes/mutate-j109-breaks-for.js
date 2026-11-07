// tools/probes/mutate-j109-breaks-for.js
// SUBJECT: J109 (`ddjp_606`) — `tools/breaks-for.js`, the selector that says which break files a package must run, and
// `check-breaks-for`, its guard. The selector over-selects by design; the failures worth a row are the quiet ones — it
// stops picking a file that quotes a changed module, or it starts picking everything. Each row breaks the selector and
// must turn the guard red NAMING that direction; the control changes nothing.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j109-breaks-for.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const BF = "check-breaks-for", TOOL = "tools/breaks-for.js";
const MENTION = "&& text.includes(p));";
const PUSH = "    if (why.length) run.push({ file: f, why: [...new Set(why)] });";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", options].
const ROWS = [
  // BF1 — the selector stops reading a break file's text for a changed path: the file quoting the module is not picked
  // for that reason (a named guard's subject may still pick it, which is why the guard asks for the reason).
  ["BF1", [[TOOL, MENTION, "&& false);"]], BF, "FAIL — a change to", "RED", { noPass: true }],
  // BF2 — the selector picks every file for any change: the unrelated change selects something.
  ["BF2", [[TOOL, PUSH, '    why.push("always");\n' + PUSH]], BF, "FAIL — a change nothing names selects nothing", "RED", { noPass: true }],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[TOOL, PUSH, PUSH + "   // a comment"]], BF, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want, opts] of ROWS) {
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
    let v = redAsNamed(code, out, expect);
    if (v.mark === "RED" && opts && opts.noPass && /^\[[\w-]+\] PASS/m.test(out)) v = { mark: "WRONG", why: "it printed PASS after its failure" };
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — " + (opts && opts.equivalent ? "an equivalent edit, measured (see its comment)" : "the control")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
