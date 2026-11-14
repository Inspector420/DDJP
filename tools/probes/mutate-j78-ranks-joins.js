// tools/probes/mutate-j78-ranks-joins.js
// SUBJECT: J78 (`ddjp_546`) — `assignRank` confirmed with 429 retries (rebuilt at J129), the debounced rank retry, the opening and waiting channels, the presence chat. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-ranks-joins.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const JS = "check-join-step";   // J81: the ONE join step's guard, where `check-channel-join`'s rows now live
const UR = "check-upgrade-reconcile";
const AR = "check-assign-rank-retry";
const ROWS = [
  // K1–K9 (ddjp_546): assignRank confirmed with 429 retries; the debounced rank retry; the opening and waiting channels; the
  // presence chat's manager. K1–K5 RE-ANCHORED AT J129 (`ddjp_651`), which rebuilt assignRank: every step read back, one
  // minute, the outcome named. K4's background retry and K5's "a newer assignment supersedes it" are gone with it, so K4 is
  // re-aimed at the minute that replaced the background retry, and K5 at the stop (the leave's) that ends a change.
  ["K1", MB, "    if (!missing.length) {\n      const pk = _presenceChatKey()", "    if (true) {\n      const pk = _presenceChatKey()", AR, "FAIL — B: a channel that stays 429 ends the change at the limit", "RED"],
  ["K2", MB, " && e.httpStatus < 500 && !_is429(e); }", " && e.httpStatus < 500; }", AR, "FAIL — A: a 429 retried and then confirmed", "RED"],
  ["K3", MB, "await until(_rankSleep(ra !== null ? ra : RANK_BACKOFF_MS[Math.min(s.tries - 1, RANK_BACKOFF_MS.length - 1)]));", "await until(_rankSleep(RANK_BACKOFF_MS[Math.min(s.tries - 1, RANK_BACKOFF_MS.length - 1)]));", AR, "FAIL — A: the level retried twice, honouring retry_after_ms", "RED"],
  ["K4", MB, "  const RANK_LIMIT_MS = 60000;\n", "  const RANK_LIMIT_MS = 600000;\n", AR, "FAIL — B: at the minute", "RED"],
  ["K5", MB, "    run.stopped = true;\n    if (run.wake) run.wake();\n    return true;\n", "    return true;\n", AR, "FAIL — D: a stop ends the change at once", "RED"],
  // K6 and K7 RE-AIMED AT J81: `check-channel-join` is retired and its rows live in `check-join-step` (K6's anchor is the step's
  // rank signal now; K7's is unchanged).
  ["K6", MB, "  onRankChange(() => { try { if (_rankRetryTimer) clearTimeout(_rankRetryTimer); _rankRetryTimer = _rankRetryLater(() => { _rankRetryTimer = null; for (const fn of _rankSettledListeners) { try { fn(\"this account's rank changed\"); } catch (e) {} } }, RANK_RETRY_DEBOUNCE_MS); } catch (e) {} });\n", "  onRankChange(() => { try { for (const fn of _rankSettledListeners) { try { fn(\"this account's rank changed\"); } catch (e) {} } } catch (e) {} });\n", JS, "FAIL — S8: seven rank changes in a row leave ONE pending pass", "RED"],
  ["K7", MB, "              if (rid && (client.getRoom(rid) || _joinWaiting.has(rid))) resolved++;\n", "              if (rid && client.getRoom(rid)) resolved++;\n", JS, "FAIL — W1: the opening does not sit out its cap", "RED"],
  ["K8", MB, "        if (!roomId || !(_desiredMembership(key, v) === true || (key === _presenceChatKey() && _presenceManager(v)))) continue;\n", "        if (!roomId || _desiredMembership(key, v) !== true) continue;\n", UR, "FAIL — P: the upgrade reconcile invites the bot", "RED"],
  // K9 RE-ANCHORED AT J129: a change's steps are built by `_rankSteps`, where the presence chat's manager is now admitted.
  ["K9", MB, "      if (want === null) { if (key === _presenceChatKey() && _presenceManager(level)) steps.push({ kind: \"in\", roomId: channels[key], key: key }); continue; }\n", "      if (want === null) continue;\n", UR, "FAIL — P: and assignRank to the owner tier", "RED"],
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
