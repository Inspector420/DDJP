// tools/probes/mutate-j78-differential.js
// SUBJECT: J78 — the three fixes from the owner's bot-room test. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-differential.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js", HI = "backends/backend1/history.js", PB = "features/playback.js", PL = "ui/player.js", MB = "backends/backend1/matrixbridge.js";
const HF = "check-history-floor-reach", EB = "check-ended-by-play", CJ = "check-channel-join", HL = "check-history-live-reach", VD = "check-vote-dedupe", VL = "check-vote-latch";
const AU = "backends/backend2/authority.js", RX = "features/reactions.js", BR = "features/botruntime.js", SP = "backends/backend1/settingsproof.js";
const RR = "check-repeat-rule", RC = "check-repeat-cooldown", PO = "check-player-load-once", AF = "check-answer-after-floor", UR = "check-upgrade-reconcile";
const FD = "check-forgetting-differential";
const ROWS = [
  // D1–D3 (ddjp_549, plan step 1): the differential harness catches forgetting too much — the held events above the cut,
  // a settings event above it, or the dropped plays' song history (trimToFloor's own call).
  ["D1", SM, "    const _keep = new Set(_aboveCut(orderEvents(eventLog), t));\n", "    const _keep = new Set();\n", FD, "FAIL — S1: forgetting on and off give identical state and history", "RED"],
  ["D2", SM, "    const _keep = new Set(_aboveCut(orderEvents(eventLog), t));\n", "    const _keep = new Set(_aboveCut(orderEvents(eventLog), t).filter((e) => e.type !== \"ddjp.room.settings\"));\n", FD, "FAIL — S1: forgetting on and off give identical state and history", "RED"],
  // D3 RE-AIMED AT J92: the dropped plays reach song history twice now — at the save point's adoption (`StreamManager._settleHistory`)
  // and at the trim — so removing the trim's call alone changes nothing S7 sees. The row refuses both, where History takes them,
  // unconditionally (the same edit as `mutate-j73-tallies` T6).
  ["D3", "backends/backend1/history.js", "    if (opts && (opts.src === \"trim\" || opts.src === \"settle\") && typeof _env.settled === \"function\") { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }\n      if (!_s) return { added: 0, total: _entries.length, deferred: \"not-settled\" }; }\n", "    if (opts && (opts.src === \"trim\" || opts.src === \"settle\")) return { added: 0, total: _entries.length, deferred: \"refused\" };\n", FD, "FAIL — S7: forgetting on and off give identical state and history", "RED"],
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
