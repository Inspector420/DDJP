// tools/probes/mutate-j73-presence.js
// SUBJECT: J73 job 5 — the bot publishes who is active; the People tab shows it; chat is who and when only.
// Each row puts ONE site back, confirms the edit LANDED, runs `check-bot-presence` and reads the outcome by
// the suite's own rule (`_verdict.js`); restored after every row and on any exit (mutate-j67-j72.js's shape).
// P9 is not job 5's code: it is the existing gate that counts chat only when the settings say so, guarded
// here because "follows the room's presence settings" is part of the ruling.
//   node tools/probes/mutate-j73-presence.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const BR = "features/botruntime.js", B2 = "backends/backend2/streammanager.js", RM = "features/room.js", PN = "ui/panels.js";
const BP = "check-bot-presence", PD = "check-presence-decentralized", B1 = "backends/backend1/streammanager.js";
const PP = "check-presence-powerlevels", MBR = "backends/backend1/matrixbridge.js", SK = "backends/backend2/skeleton.js";
// RETIRED AT J75 (owner ruling 1, `ddjp_532`): P1–P6, P9, Q1–Q5 and R1–R4 broke the bot's published presence list, its
// acceptance check and its power-level entry — all removed, so their anchors are gone and the parts they reddened are
// retired. P7 and P8 stand: the bot's own chat record and the views the tab reads are unchanged.
const ROWS = [
  ["P7", PN, "    try { fold = Room.presenceView ? Room.presenceView(now) : Room.recentlyActive(now); }\n", "    try { fold = Room.recentlyActive(now); }\n", BP, "FAIL — I", "RED"],
  ["P8", BR, "    _pruneChat(t);\n", "", BP, "FAIL — G", "RED"],
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
