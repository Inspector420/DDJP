// tools/probes/mutate-j126-imp-exp.js
// SUBJECT: J126 — the Playlists library's import and export button reads "Imp / Exp" (the owner, `ddjp_645`): `ui/playlists.js`,
// the `pl-io-open` button on the Create line, its tooltip keeping the full words, the window it opens unchanged; held by
// `check-owner-screens` H. One row per way it could go wrong, each naming the failure it must cause, and a control. Each row
// plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j126-imp-exp.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const PL = "ui/playlists.js";
const OS = "check-owner-screens";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // IE1 — the label back to the full words.
  ["IE1", [[PL, `const io = H.el("button", { class: "pl-io-open", text: "Imp / Exp",`, `const io = H.el("button", { class: "pl-io-open", text: "Import / Export",`]],
    OS, `H: IT READS "Imp / Exp"`, "RED"],
  // IE2 — the tooltip loses the full words.
  ["IE2", [[PL, `      title: "Import or export playlists to a file", onclick: () => _openLibraryIO("export") });`, `      title: "Imp / Exp", onclick: () => _openLibraryIO("export") });`]],
    OS, "H: AND ITS TOOLTIP KEEPS THE FULL WORDS", "RED"],
  // IE3 — the button opens its window on Import, not Export: the window is not the one it was.
  ["IE3", [[PL, `      title: "Import or export playlists to a file", onclick: () => _openLibraryIO("export") });`, `      title: "Import or export playlists to a file", onclick: () => _openLibraryIO("import") });`]],
    OS, "H CONTROL: IT OPENS THE SAME WINDOW", "RED"],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[PL, `const io = H.el("button", { class: "pl-io-open", text: "Imp / Exp",`, `const io = H.el("button", { class: "pl-io-open",  text: "Imp / Exp",`]], OS, "", "GREEN"],
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
