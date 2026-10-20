// tools/probes/mutate-j73-trim.js
// SUBJECT: J73 job 1 — forgetting keeps an event at the floor's position that sorts after its boundary.
//
// Each row puts ONE fix site back the way it was, confirms the edit LANDED (anchor exactly once, bytes
// changed), runs the named guard and reads the outcome. The file is restored after every row and on
// any exit, Ctrl-C included (the same shape as mutate-j67-j72.js). A row whose anchor is gone reports
// VOID, never GREEN.
//
// `expect: "GREEN"` rows are MEASUREMENTS, not checks: the fallback in `_aboveCut` is unreachable while
// `Floor` is loaded, so reverting it must change no answer. A green there says no guard reaches the
// line — the honest status of an unreachable branch — and is printed as MEASURED rather than as RED.
//   node tools/probes/mutate-j73-trim.js            every row
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const ROWS = [
  ["T1", SM, "    const _keep = new Set(_aboveCut(orderEvents(eventLog), t));\n    const kept = eventLog.filter((e) => _keep.has(e));\n",
             "    const kept = eventLog.filter((e) => ((typeof e.l === \"number\") ? e.l : 0) > t.floorL);\n",
             "check-trim-boundary", "FAIL — A", "RED"],
  ["T2", SM, "    if (!sf) return _atOrBeforeBoundary(f, e);\n", "    if (!sf) return el <= f.floorL;\n",
             "check-trim-boundary", "FAIL — D1", "RED"],
  ["T3", SM, "    if (!pos) return _atOrBeforeBoundary(f, e);      // the named change not seen yet: the plain rule\n",
             "    if (!pos) return el <= f.floorL;\n", "check-trim-boundary", "FAIL — D2", "RED"],
  ["T4", SM, "    return el < f.floorL || (el === f.floorL && (!bid || String(e.eventId) <= String(bid)));\n  }\n  function _settingsCovered",
             "    return el <= f.floorL;\n  }\n  function _settingsCovered", "check-trim-boundary", "FAIL — D1", "RED"],
  ["T5", SM, "      return el !== f.floorL ? el > f.floorL : String(e.eventId) > _bidF;\n",
             "      return el > f.floorL;\n", "check-trim-boundary", null, "GREEN"],
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
