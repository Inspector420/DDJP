// tools/probes/mutate-j77-ids.js
// SUBJECT: J77, the reader half — member ids for batches of more than ten. Each row undoes ONE site, confirms the edit
// LANDED, runs `check-batch20` and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j77-ids.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend2/streammanager.js", AU = "backends/backend2/authority.js", BT = "check-batch20";
const ROWS = [
  ["K1", SM, "(n > 10 ? String(k).padStart(2, \"0\") : String(k))", "String(k)", BT, "FAIL — A: a 20-member batch", "RED"],
  ["K2", SM, "(n > 10 ? String(k).padStart(2, \"0\") : String(k))", "String(k).padStart(2, \"0\")", BT, "FAIL — A: a 10-member batch keeps today", "RED"],
  ["K3", SM, "memberId(raw.event_id, i, evs.length)", "raw.event_id + \"#\" + i", BT, "FAIL — A: a 20-member batch", "RED"],
  ["K4", AU, "B2StreamManager.memberId(id, k, items.length)", "id + \"#\" + k", BT, "FAIL — F: each learns the id", "RED"],
  ["K5", AU, "POLICY.maxPerMessage <= 20)) out.push(\"maxPerMessage must be 1..20\");", "POLICY.maxPerMessage <= 10)) out.push(\"maxPerMessage must be 1..20\");", BT, "FAIL — G: 20 is accepted", "RED"],
  // K6–K7 (J77, `ddjp_534`): put the shipped value back to 10.
  ["K6", AU, "    maxPerMessage: 20,", "    maxPerMessage: 10,", BT, "FAIL — G: the shipped value is 20", "RED"],
  ["K7", AU, "    maxPerMessage: 20,", "    maxPerMessage: 10,", BT, "FAIL — H: twenty acts leave through the gate as ONE message", "RED"],
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
