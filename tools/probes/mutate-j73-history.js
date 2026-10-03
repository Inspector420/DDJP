// tools/probes/mutate-j73-history.js
// SUBJECT: J73 job 6 — song history says how far back it reaches and never decides past it; added
// times for the repeat rule; the store cadence; unfolded rooms not paged.
// Each row puts ONE fix site back the way it was, confirms the edit LANDED, runs the named guard and
// reads the outcome; restored after every row and on any exit (mutate-j67-j72.js's shape). H7 is the
// defect this job's first draft shipped to its own guard — a reach declared inside a `try` and read
// after it, so every download claimed it reached the start.
//   node tools/probes/mutate-j73-history.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", RM = "features/room.js";
const QU = "features/queue.js", BR = "features/botruntime.js", HR = "check-history-reach", RC = "check-repeat-cooldown";
const ROWS = [
  ["H1", HI, "      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);\n", "      if (false) last[1] = Math.max(last[1], r[1]);\n", HR, "FAIL — A CONTROL", "RED"],
  ["H2", HI, "    if (unique > MAX && _entries.length && typeof _entries[0].l === \"number\") _clipBelow(_entries[0].l);\n", "", HR, "FAIL — B", "RED"],
  ["H3", RM, "    if (topFrom !== null) rows = rows.filter((r) => r && typeof r.l === \"number\" && r.l >= topFrom);\n", "", HR, "FAIL — C:", "RED"],
  ["H4", HI, "    if (opts && opts.retain && both && both.state) _retain(both.state);\n", "", HR, "FAIL — D: a song that has played", "RED"],
  ["H5", HI, "      if (typeof isLegal === \"function\" && isLegal(e.eventId || e.event_id) === false) continue;\n", "", HR, "FAIL — D: a REFUSED", "RED"],
  ["H6", HI, "      if (base) _cover(a, b);\n", "", HR, "FAIL — E2: after the fill", "RED"],
  ["H7", MB, "    out.reachedFrom = _reachedFrom;\n", "    out.reachedFrom = fromL;\n", HR, "FAIL — E5", "RED"],
  ["H8", MB, "|| StreamManager.foldsRoom(r.roomId);", "|| true;", HR, "FAIL — F: a room the engine never folds", "RED"],
  ["H9", MB, "    if (_persistTimer !== null) return;\n", "", HR, "FAIL — G: five advances", "RED"],
  ["H10", MB, "      _persistSoon();                     // added times change without the count changing\n", "", HR, "FAIL — G: five advances", "RED"],
  ["H11", QU, "if (document.visibilityState === \"hidden\" && typeof MatrixBridge", "if (false && typeof MatrixBridge", HR, "FAIL — G: when the tab hides", "RED"],
  ["H12", BR, "    if (since.exact) return { before: addL < since.l,", "    if (since.exact) return { before: addL > since.l,", RC, "FAIL — H3", "RED"],   // re-anchored at ddjp_536: the add-against-change comparison
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
