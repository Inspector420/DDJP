// tools/probes/mutate-j73-protect.js
// SUBJECT: J73 job 1b — protection judges an event at the floor's position by its id; the bump tool
// refuses arguments.
//
// Each row puts ONE fix site back the way it was (or drops the boundary id at one caller), confirms
// the edit LANDED (anchor exactly once, bytes changed), runs the named guard and reads the outcome.
// The file is restored after every row and on any exit, Ctrl-C included (mutate-j67-j72.js's shape).
// A row whose anchor is gone reports VOID, never GREEN.
//   node tools/probes/mutate-j73-protect.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const V = "backends/backend1/vouch.js", C = "backends/backend1/continuity.js", K = "backends/backend1/checkpoint.js";
const M = "backends/backend1/matrixbridge.js", E = "backends/backend1/eventcache.js", PB = "check-protect-boundary";
const ROWS = [
  ["P1", V, "      if (floorL !== null && _bankedAt(l, r.event_id, floorL, floorId)) { bankedSkipped++; continue; }\n",
            "      if (floorL !== null && l <= floorL) { bankedSkipped++; continue; }\n", PB, "FAIL — A", "RED"],
  ["P2", V, "      if (floorL !== null && floorL !== undefined && _bankedAt(r.l, r.event_id, floorL, floorId)) continue;\n",
            "      if (floorL !== null && r.l <= floorL) continue;\n", PB, "FAIL — B", "RED"],
  ["P3", V, "_bankedAt(eventL, eventId, floorL, floorId)) return true;", "eventL <= floorL) return true;", PB, "FAIL — C", "RED"],
  ["P4", V, "    return l !== floorL ? l < floorL : String(id) <= String(floorId == null ? \"\" : floorId);\n",
            "    return l !== floorL ? l < floorL : String(id) <= String(floorId);\n", PB, "FAIL — A: with the boundary id UNKNOWN", "RED"],
  ["P5", C, "      return l !== floorL ? l > floorL : String(r.event_id) > bid;\n", "      return l > floorL;\n", PB, "FAIL — D", "RED"],
  ["P6", K, "(l !== floorL ? l < floorL : String(r.event_id) <= _bidCov)", "l <= floorL", PB, "FAIL — E", "RED"],
  ["P7", M, "              floorL: (typeof Floor !== \"undefined\" && Floor.position) ? Floor.position() : -1,\n              floorId: _floorBoundaryId(),\n            });\n",
            "              floorL: (typeof Floor !== \"undefined\" && Floor.position) ? Floor.position() : -1,\n            });\n", PB, "FAIL — G:", "RED"],
  ["P8", M, "                                       _banked, _floorBoundaryId());\n", "                                       _banked);\n", PB, "FAIL — G:", "RED"],
  ["P9", K, "                                      _banked, _fid);\n", "                                      _banked);\n", PB, "FAIL — G:", "RED"],
  ["P10", E, "_myRank(), it.key, floorId);", "_myRank());", PB, "FAIL — G:", "RED"],
  ["P11", "tools/bump-version.js", "if (_args.length) {", "if (false) {", "check-bump-args", "FAIL — --help", "RED"],
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
