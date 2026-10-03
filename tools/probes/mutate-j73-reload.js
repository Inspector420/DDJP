// tools/probes/mutate-j73-reload.js
// SUBJECT: J73 job 8 — the bot tab's daily reload, at most once a day and only at a quiet moment.
// Each row removes ONE condition (or one hop of the unsent count), confirms the edit LANDED, runs
// `check-bot-reload` and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j73-reload.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const BR = "features/botruntime.js", AU = "backends/backend2/authority.js", B2 = "backends/backend2/streammanager.js", RL = "check-bot-reload";
const ROWS = [
  ["L1", BR, "    if (now - _pageStartedAt < RELOAD_AFTER_MS) return { reloaded: false, reason: \"not-a-day\" };\n", "", RL, "FAIL — B", "RED"],
  ["L2", BR, "      if (typeof np.startedAt !== \"number\" || now - np.startedAt < QUIET.settledMs) return { quiet: false, reason: \"song-just-changed\" };\n", "", RL, "FAIL — C: not while a song has just changed", "RED"],
  ["L3", BR, "      if (typeof adv.earliestAt !== \"number\" || now >= adv.earliestAt - QUIET.beforeChangeMs) return { quiet: false, reason: \"song-about-to-change\" };\n", "", RL, "FAIL — C: not while a song is about to change", "RED"],
  ["L4", BR, "    if (unsent > 0) return { quiet: false, reason: \"unsent-acts\" };\n", "", RL, "FAIL — D", "RED"],
  ["L5", BR, "    if (Object.keys(_pending).length > 0) return { quiet: false, reason: \"queue-warning-outstanding\" };\n", "", RL, "FAIL — E: not with a queue warning", "RED"],
  ["L6", BR, "    if (Object.keys(_presPending).length > 0) return { quiet: false, reason: \"presence-warning-outstanding\" };\n", "", RL, "FAIL — E: not with a presence warning", "RED"],
  ["L7", BR, "    if (_reloading) return { reloaded: false, reason: \"already-reloading\" };\n", "", RL, "FAIL — A: and only once", "RED"],
  ["L8", BR, "    try { if (typeof MatrixBridge !== \"undefined\" && MatrixBridge.persistHistoryNow) MatrixBridge.persistHistoryNow(); } catch (e) {}\n    try { Logger.info(\"BotRuntime: a quiet moment", "    try { Logger.info(\"BotRuntime: a quiet moment", RL, "FAIL — F", "RED"],
  ["L9", BR, "    try { maybeDailyReload((typeof ServerClock !== \"undefined\" && ServerClock.serverNow) ? ServerClock.serverNow() : 0); } catch (e) {}\n", "", RL, "FAIL — H", "RED"],
  ["L10", AU, "  function unsent() { return _q.length; }", "  function unsent() { return 0; }", RL, "FAIL — G: an act the bot has committed", "RED"],   // re-anchored at J76: one queue
  ["L11", B2, "B2Authority.unsent() : 0;", "0 : 0;", RL, "FAIL — G: an act the bot has committed", "RED"],
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
