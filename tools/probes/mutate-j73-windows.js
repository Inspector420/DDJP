// tools/probes/mutate-j73-windows.js
// SUBJECT: J73 job 4 — settings changes re-run or keep the background reads (the owner's brief).
// Each row puts ONE fix site back, confirms the edit LANDED, runs `check-settings-windows` and reads the
// outcome; restored after every row and on any exit (mutate-j67-j72.js's shape). Not a row: the chat
// read's `finally` — the early return it protects (the bot stopping mid-read) is driven by no guard,
// so no row could go red; recorded rather than counted.
//   node tools/probes/mutate-j73-windows.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", RM = "features/room.js", BR = "features/botruntime.js", AC = "backends/backend1/activity.js";
const SW = "check-settings-windows";
const ROWS = [
  ["W1", MB, "      if (StreamManager.activityCovered()) return false;\n", "", SW, "FAIL — C CONTROL", "RED"],
  ["W2", MB, "      _readActivityBack(_activityReadAt.roomId, _activityReadAt.room);\n      return true;\n", "      return true;\n", SW, "FAIL — C: once read back far enough", "RED"],
  ["W3", MB, "    _activityReadAt = { roomId: roomId, room: room };\n", "", SW, "FAIL — C: extending starts a read", "RED"],
  ["W4", MB, "    _activityReadAt = null;   // a new room: the read-back belongs to the room it read (J73 job 4)\n", "", SW, "FAIL — C: after a room switch", "RED"],
  ["W5", RM, "    try { if (typeof MatrixBridge !== \"undefined\" && MatrixBridge.extendActivityRead) MatrixBridge.extendActivityRead(); } catch (e) {}\n", "", SW, "FAIL — G", "RED"],
  // W6–W8 RE-ANCHORED AT J84-2 (the reason): the bot's own chat watch (`_readChatBack`, `_onSettingsForChat`) retired —
  // the bot reads the room's one record through `Room.presenceView` (ruling 30a). The same three breaks, on that record:
  // W6 a read taken as covering every window (a grown window never read further back),
  ["W6", RM, "      if (typeof reached === \"number\") t.coveredFrom = (t.coveredFrom === null) ? reached : Math.min(t.coveredFrom, reached);\n", "      if (typeof reached === \"number\") t.coveredFrom = -Infinity;\n", SW, "FAIL — D: the window grew", "RED"],
  // W7 a tier read back at every view, covered or not; W8 the bot's start no longer touching the record.
  ["W7", RM, "      if (t.coveredFrom === null || t.coveredFrom > since) _vcRead(id, since);  ", "      if (true) _vcRead(id, since);  ", SW, "FAIL — D CONTROL", "RED"],
  ["W8", BR, "      if (t0 && typeof Room !== \"undefined\" && Room.presenceView) _noteView(Room.presenceView(t0));\n", "", SW, "FAIL — D PREMISE", "RED"],
  ["W10", MB, "    if (_activityReadAt && _activityReadAt.roomId !== roomId) _releaseActivityRead();   // another room's read stops; this one runs\n", "", SW, "FAIL — H: room B's read RUNS", "RED"],
  ["W11", MB, "        if (!live()) break;   // released while waiting: a newer read owns the evidence now\n", "", SW, "FAIL — H: room A's read STOPS", "RED"],
  ["W12", MB, "    } finally { if (live()) _activityReadBusy = false; }", "    } finally { _activityReadBusy = false; }", SW, "FAIL — H: A stopping late", "RED"],
  ["W9", AC, "      return (typeof w === \"number\" && isFinite(w) && w > 0) ? w : Infinity;\n", "      return 10 * 60000;\n", SW, "FAIL — E", "RED"],
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
