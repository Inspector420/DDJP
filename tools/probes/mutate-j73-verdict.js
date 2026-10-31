// tools/probes/mutate-j73-verdict.js
// SUBJECT: J73 — break files judge "red" by the suite's own rule (tools/probes/_verdict.js over
// tests/run-all.js `verdictOf`). Each row breaks the rule ONE way and runs `check-break-verdict`.
// V2 is the W12 gap: a guard that announced its failure and exited 0, read as a pass.
//   node tools/probes/mutate-j73-verdict.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const VD = "tools/probes/_verdict.js", BV = "check-break-verdict";
const ROWS = [
  ["V1", "tools/probes/mutate-j73-trim.js", 'const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"\n', "", BV, "FAIL — A: every break file", "RED"],
  ["V2", VD, "  if (v.ok) return { mark: \"GREEN\", why: null };\n", "  if (status === 0) return { mark: \"GREEN\", why: null };\n", BV, "FAIL — C: announced its failure and exited 0", "RED"],
  ["V3", VD, "const { verdictOf } = require(path.join(__dirname, \"..\", \"..\", \"tests\", \"run-all.js\"));\n",
             "const verdictOf = (status, out) => ({ ok: status === 0 && /PASS/.test(String(out)), why: null });\n", BV, "FAIL — D", "RED"],
  // V4's planted text is split across a "+" so this file's own source is not the pattern it plants.
  ["V4", "tools/probes/mutate-j67-j72.js", "  const v = redAsNamed(code, out, expect);\n",
         "  const v = { mark: (code !== 0 " + "&& out.indexOf(expect) >= 0) ? \"RED\" : (code !== 0 ? \"WRONG\" : \"GREEN\"), why: null };\n", BV, "FAIL — A:", "RED"],
];
let planted = null;
function restore() { if (planted) { fs.writeFileSync(planted.file, planted.original); planted = null; } }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect, want] of ROWS) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the line is unreachable, as recorded"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected no change; the 'unreachable' claim is wrong"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
