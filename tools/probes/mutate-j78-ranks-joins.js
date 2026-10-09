// tools/probes/mutate-j78-ranks-joins.js
// SUBJECT: J78 — the three fixes from the owner's bot-room test. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-ranks-joins.js
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
const AR = "check-assign-rank-retry";
const ROWS = [
  // K1–K9 (ddjp_546): assignRank confirmed-or-partial with 429 retries; the debounced rank retry; the opening and waiting
  // channels; the presence chat's manager.
  ["K1", MB, "    if (failed.length) {\n      Logger.warn(\"MatrixBridge: assigned \" + userId + \" to level \" + level + \" — PARTIAL: power level not confirmed in \" + failed.join(\", \") + \"; retrying\");\n      _retryRankLater(userId, level, failed, 0, token);\n      return { ok: false, partial: true, failed: failed.slice() };\n    }\n", "", AR, "FAIL — B: a channel that stays 429 is a PARTIAL", "RED"],
  ["K2", MB, "        if (_is429(e) && k < RANK_PL_RETRY_MS.length) {", "        if (false) {", AR, "FAIL — A: a 429 retried and then confirmed", "RED"],
  ["K3", MB, "await _rankSleep(ra !== null ? ra : RANK_PL_RETRY_MS[k]);", "await _rankSleep(RANK_PL_RETRY_MS[k]);", AR, "FAIL — A: retried twice, honouring retry_after_ms", "RED"],
  ["K4", MB, "      _retryRankLater(userId, level, failed, 0, token);\n", "", AR, "FAIL — B: and it keeps retrying in the background", "RED"],
  ["K5", MB, "      if (_rankJobs[userId] !== token) return;                       // superseded by a newer assignment\n", "", AR, "FAIL — D: a newer assignment supersedes", "RED"],
  ["K6", MB, "  onRankChange(() => { try { if (_rankRetryTimer) clearTimeout(_rankRetryTimer); _rankRetryTimer = _rankRetryLater(() => { _rankRetryTimer = null; retryWaitingJoins(\"this account's rank changed\"); }, RANK_RETRY_DEBOUNCE_MS); } catch (e) {} });\n", "  onRankChange(() => { try { retryWaitingJoins(\"this account's rank changed\"); } catch (e) {} });\n", CJ, "FAIL — E: seven rank changes in a row schedule ONE retry", "RED"],
  ["K7", MB, "              if (rid && (client.getRoom(rid) || _joinWaiting.has(rid))) resolved++;\n", "              if (rid && client.getRoom(rid)) resolved++;\n", CJ, "FAIL — H: the opening counts a channel already marked waiting", "RED"],
  ["K8", MB, "        if (!roomId || !(_desiredMembership(key, v) === true || (key === _presenceChatKey() && _presenceManager(v)))) continue;\n", "        if (!roomId || _desiredMembership(key, v) !== true) continue;\n", UR, "FAIL — P: the upgrade reconcile invites the bot", "RED"],
  ["K9", MB, "        if (want === null && key === _presenceChatKey() && _presenceManager(level)) { await client.invite(roomId, userId); continue; }\n", "", UR, "FAIL — P: and assignRank to the owner tier", "RED"],
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
