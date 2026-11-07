// tools/probes/mutate-j73-store.js
// SUBJECT: J73 job 6b — song history is really stored; a pending save cannot cross a room switch; the
// added-time path is wired end to end.
// Each row puts ONE fix site back the way it was (or drops one argument on the added-time path),
// confirms the edit LANDED, runs `check-history-store` and reads the outcome; restored after every
// row and on any exit (mutate-j67-j72.js's shape). S1 and S2 are the defect the audit found.
//   node tools/probes/mutate-j73-store.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const ST = "core/store.js", HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js";
const RM = "features/room.js", QU = "features/queue.js", BR = "features/botruntime.js", HS = "check-history-store";
const ROWS = [
  ["S1", ST, "!_historyTable(table)) return;", "!Array.isArray(table)) return;", HS, "FAIL — A: the snapshot is written", "RED"],
  ["S2", ST, ".then((v) => (_historyTable(v) ? v : null))", ".then((v) => (Array.isArray(v) ? v : null))", HS, "FAIL — A: the snapshot is written", "RED"],
  ["S3", HI, "    if (Array.isArray(snap)) snap = { v: 1, rows: snap };\n", "", HS, "FAIL — A CONTROL", "RED"],
  ["S4", MB, "        if (sid && sid === _currentSpaceId) _persistHistory(sid);\n", "        _persistHistory();\n", HS, "FAIL — B: the second room's stored table is intact after the switch (timer-between)", "RED"],
  ["S5", MB, "    _flushPendingPersist();   // the room being left: its pending save goes now, before History is reset (J73 job 6b)\n", "", HS, "FAIL — B: the first room's latest", "RED"],
  ["S6", BR, "MatrixBridge.historyAddedAtL(np.dj, np.song.videoId, playL === null ? undefined : playL)", "MatrixBridge.historyAddedAtL(null, np.song.videoId, playL === null ? undefined : playL)", HS, "FAIL — C: through the real path, a song queued twice", "RED"],   // re-anchored at ddjp_536: the add is found through the bridge by position
  ["S7", RM, "Queue.historyAddedAt(opts.dj, videoId, opts.beforeTs)", "Queue.historyAddedAt(null, videoId, opts.beforeTs)", HS, "FAIL — C: the real Room reaches", "RED"],
  ["S8", QU, "return MatrixBridge.historyAddedAt(user, videoId, beforeTs);", "return MatrixBridge.historyAddedAt(videoId, beforeTs);", HS, "FAIL — C: the real Room reaches", "RED"],
  ["S9", MB, "History.addedAt(user, videoId, beforeTs)", "History.addedAt(videoId, user, beforeTs)", HS, "FAIL — C: the real Room reaches", "RED"],
  ["S10", RM, "complete: complete, addedAt: addedAt };", "complete: complete };", HS, "FAIL — C:", "RED"],
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
