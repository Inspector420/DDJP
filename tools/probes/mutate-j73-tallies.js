// tools/probes/mutate-j73-tallies.js
// SUBJECT: J73 — past vote tallies kept in history rows (owner, `ddjp_518`) and job 7b, one
// before-forgetting check for both room types.
// Each row puts ONE fix site back, confirms the edit LANDED, runs the named guard and reads the outcome;
// restored after every row and on any exit (mutate-j67-j72.js's shape). L1 is the audit's finding: the
// decentralized licence comparing only nowPlaying, rotation and settings.
//   node tools/probes/mutate-j73-tallies.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", B1 = "backends/backend1/streammanager.js", PN = "ui/panels.js";
const HT = "check-history-tallies", LF = "check-licence-fields";
const ROWS = [
  ["T1", HI, "    for (const pi of Object.keys(cs)) if (pi !== live) _finals[pi]", "    for (const pi of Object.keys(cs)) _finals[pi]", HT, "FAIL — C: while the song is live", "RED"],
  ["T2", HI, "      if (e && !e.counts && _final[e.pi]) _entries[i]", "      if (false) _entries[i]", HT, "FAIL — A: every play that ended", "RED"],
  ["T3", HI, "    _mergeIn(folded, _finals);\n", "    _mergeIn(folded);\n", HT, "FAIL — A: every play that ended", "RED"],
  ["T4", PN, "return (cs && cs[h.pi]) || (h && h.counts) || null;", "return (cs && cs[h.pi]) || null;", HT, "FAIL — D: where the derived counts", "RED"],
  ["T5", PN, "      const c = rowCounts(counts, h);\n", "      const c = counts[h.pi] || null;\n", HT, "FAIL — D: the history list renders", "RED"],
  ["T6", B1, "      if (typeof History !== \"undefined\" && History.noteAdds) History.noteAdds(_drop, _legal);\n      if (typeof History !== \"undefined\" && History.ingest && _drop.length) { try { History.ingest(_drop, _heldBase, _droppedReach(_trimmedBelow, t.floorL)); } catch (e) {} }\n", "      if (typeof History !== \"undefined\" && History.noteAdds) History.noteAdds(_drop, _legal);\n", HT, "FAIL — A: every play that ended", "RED"],   // re-anchored at J78: the dropped stretch now declares its reach
  ["L1", B1, "  function _canon(s) { const o = {}; for (const k of REPRODUCE_FIELDS) o[k] = _field(s, k); return _canonAny(o); }\n",
             "  function _canon(s) { return _canonAny({ np: s.nowPlaying, rot: s.rotation, set: s.settings }); }\n", LF, "FAIL — A: a decentralized seed", "RED"],
  ["L2", B1, "    if (k !== \"counts\") return (st && st[k] !== undefined) ? st[k] : null;\n", "    return (st && st[k] !== undefined) ? st[k] : null;\n", LF, "FAIL — C: every honest floor", "RED"],
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
