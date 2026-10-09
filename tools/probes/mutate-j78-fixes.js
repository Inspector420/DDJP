// tools/probes/mutate-j78-fixes.js
// SUBJECT: J78 — the three fixes from the owner's bot-room test. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-fixes.js
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
const ROWS = [
  ["H1", SM, "History.ingest(_drop, _heldBase, Object.assign({ src: \"trim\" }, _droppedReach(_prevCut, fl.floorL) || {}))", "History.ingest(_drop, _heldBase)", HF, "FAIL — A: after moving on to n=2", "RED"],
  ["H2", "backends/backend1/history.js", "      _ranges = _ranges.filter((r) => r[0] <= cut).map((r) => [r[0], Math.min(r[1], cut)]);\n", "      { const _t = _entries.reduce((m, e) => (typeof e.l === \"number\" && (m === null || e.l > m)) ? e.l : m, null); const _k = (_t === null) ? cut : Math.min(cut, _t); _ranges = _ranges.filter((r) => r[0] <= _k).map((r) => [r[0], Math.min(r[1], _k)]); }\n", "check-history-floor-reach", "FAIL — C: rows above the cut", "RED"],   // re-anchored at ddjp_557: clipping at the last surviving row, not the cut
  ["E1", PB, "    if (typeof pi === \"string\" && pi && np && np.pi !== pi) return false;\n", "", EB, "FAIL — A: a late ENDED from the FIRST play", "RED"],
  ["E2", PL, "    if (np.pi && cur.pi !== np.pi) return \"pi-changed\";\n", "", EB, "FAIL — B: the same video twice in a row RELOADS", "RED"],   // re-anchored at ddjp_537: the pi-changed branch of _loadReason
  ["E3", PL, "t._ddjpPlayingPi = t._ddjpLoadingPi || null;", "t._ddjpPlayingPi = t._ddjpPlayingPi || null;", EB, "FAIL — B: a stale ENDED from the first play does NOT end", "RED"],
  ["E4", PL, "endedPi = (t && t._ddjpPlayingPi) || null;", "endedPi = null;", EB, "FAIL — B: a stale ENDED from the first play does NOT end", "RED"],
  ["J1", MB, "  const JOIN_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];", "  const JOIN_RETRY_MS = [];", CJ, "FAIL — C: a 429 child", "RED"],   // ddjp_539: joins never wait; refusals wait for an event
  ["J2", MB, "          if (x.refused) {", "          if (false) {", CJ, "FAIL — D: a 403 child", "RED"],   // ddjp_539: joins never wait; refusals wait for an event
  ["J3", MB, "            try { _joinAdvertised(childId); } catch (e) {}   // a channel advertised later is joined too (J78)\n", "", CJ, "FAIL — G:", "RED"],   // ddjp_539: joins never wait; refusals wait for an event
  ["J4", MB, "  onRankChange(() => { try { if (_rankRetryTimer) clearTimeout(_rankRetryTimer); _rankRetryTimer = _rankRetryLater(() => { _rankRetryTimer = null; retryWaitingJoins(\"this account's rank changed\"); }, RANK_RETRY_DEBOUNCE_MS); } catch (e) {} });\n", "", CJ, "FAIL — E: seven rank changes in a row schedule ONE retry", "RED"],   // re-anchored at ddjp_546: the hook is debounced
  ["L1", HI, "return ingest(log, s, (typeof from === \"number\") ? { retain: true, from: from, src: \"refresh\" } : { retain: true, src: \"refresh\" });", "return ingest(log, s, { retain: true });", HL, "FAIL — A: after moving on to n=4", "RED"],
  ["L2", SM, "  function heldFrom() {\n    if (_adopted", "  function heldFrom() {\n    return null;\n    if (_adopted", HL, "FAIL — A: after moving on to n=4", "RED"],   // the adopted branch alone is redundant: adoption also raises the trimmed cut
  ["L3", MB, "heldFrom: () => { try { return StreamManager.heldFrom ? StreamManager.heldFrom() : null; } catch (e) { return null; } },   // owner's re-test: the held log is complete from here", "", HL, "FAIL — D:", "RED"],
  ["V1", AU, "      if (dup) return { ok: false, reason: \"already cast for this play\", code: \"duplicate\", silent: true };\n", "", VD, "FAIL — ddjp.dj.vote: a second one", "RED"],
  ["V2", AU, " || _committedFor(log).some((ev) => ev && ev.t === intent.t", " || false && _committedFor(log).some((ev) => ev && ev.t === intent.t", VD, "FAIL — a vote committed and not yet echoed", "RED"],
  ["V3", RX, "    if (_has(_myVotes, \"v\", pi)) { _log(\"vote refused — already voted pi=\" + pi); return { ok: false, reason: \"already voted this song\" }; }\n", "", VL, "FAIL — vote: a second press sends nothing", "RED"],   // re-anchored: the latch check
  ["R1", BR, "      if (o.before === true) return { ok: true, reason: \"added-before-change\"", "      if (false) return { ok: true, reason: \"added-before-change\"", RR, "FAIL — decentralized: added BEFORE the setting took effect", "RED"],
  ["R2", BR, "      if (o.before === null) return { ok: true, reason: \"cannot-tell-order\"", "      if (false) return { ok: true, reason: \"cannot-tell-order\"", RC, "FAIL — H3: when the add's position is unknown", "RED"],
  ["R3", SP, "      if (s[key] !== prev) { since = e.l; changed = true; prev = s[key]; }", "      if (s[key] !== prev) { changed = true; prev = s[key]; }", RR, "FAIL — decentralized: added BEFORE the setting took effect", "RED"],
  ["R4", MB, "    try { const h = (typeof History !== \"undefined\" && History.addedAtL) ? History.addedAtL(user, videoId, beforeL) : null; if (typeof h === \"number\" && (best === null || h > best)) best = h; } catch (e) {}\n    return best;\n", "    try { const h = (typeof History !== \"undefined\" && History.addedAtL) ? History.addedAtL(user, videoId, beforeL) : null; if (typeof h === \"number\" && (best === null || h > best)) best = h; } catch (e) {}\n    return null;\n", RR, "FAIL — decentralized: added AFTER the setting", "RED"],   // historyAddedAtL as a whole: refresh already records held-log adds
  ["R5", BR, "    try { since = (typeof StreamManager.settingSince === \"function\") ? StreamManager.settingSince(\"repeatCooldownMs\") : null; } catch (e) { since = null; }\n", "    since = null;\n", RR, "FAIL — decentralized: added AFTER the setting", "RED"],
  ["L4", RX, "  function _has(set, kind, pi) { return set.has(pi) || _ledgerHas(kind, pi); }", "  function _has(set, kind, pi) { return set.has(pi); }", VL, "FAIL — C: after the reload", "RED"],
  ["P1", PL, "      if (player && np.pi && player._ddjpLoadingPi === np.pi && player._ddjpLoadingVid === np.song.videoId &&\n          player._ddjpPlayingPi !== np.pi) return null;\n", "", PO, "FAIL — a new play loads EXACTLY once", "RED"],   // the load in flight counts as loaded (owner's report, ddjp_536)
  ["A1", SM, "    try { return (_foldRefusals && _foldRefusals[String(eventId)]) || null; } catch (e) { return null; }\n", "    try { const r = StateDeriver.deriveRefusals(orderEvents(eventLog), null); return (r && r[String(eventId)]) || null; } catch (e) { return null; }\n", AF, "FAIL — A: after the save point, a vote is not refused", "RED"],   // the null seed restored
  ["F1", RX, "      if (a.status === \"none\" && _roomHolds(set, pi)) {", "      if (false && _roomHolds(set, pi)) {", VL, "FAIL — D: a 'none' answer while the room already holds my vote", "RED"],
  ["J5", MB, "_joinWaiting.delete(roomId); return { ok: true, reason: null };", "return { ok: true, reason: null };", CJ, "FAIL — E: or an invite arrives", "RED"],
  // U1–U6 (ddjp_539): ranks wait for their channels; each upgrade batch reconciles — invite only, the shared rule.
  ["U1", MB, "    try { await _reconcileAfterUpgrade(spaceId, added); } catch (e) { Logger.warn(\"MatrixBridge: upgrade reconcile failed — \" + ((e && e.message) || e)); }\n", "", UR, "FAIL — D: each upgrade batch reconciles", "RED"],
  ["U2", MB, "      if (typeof v !== \"number\" || !isFinite(v)) { out.skipped.push(uid); continue; }\n", "", UR, "FAIL — A: nobody is invited to a channel below", "RED"],
  ["U3", MB, "(space.getMembersWithMembership ? space.getMembersWithMembership(\"join\") : [])", "(space.getMembersWithMembership ? space.getMembersWithMembership(\"leave\").concat(space.getMembersWithMembership(\"join\")) : [])", UR, "FAIL — A: nobody is invited to a channel below", "RED"],
  ["U4", MB, "        if (!roomId || !(_desiredMembership(key, v) === true || (key === _presenceChatKey() && _presenceManager(v)))) continue;\n", "        if (!roomId) continue;\n", UR, "FAIL — A: nobody is invited to a channel below", "RED"],   // re-anchored at ddjp_546: the condition now names the presence manager
  ["U5", MB, "    if (!gate.ok) {\n      Logger.warn(\"MatrixBridge: refused to assign level", "    if (false) {\n      Logger.warn(\"MatrixBridge: refused to assign level", UR, "FAIL — C: promoting to a level whose OWN channel is missing", "RED"],
  ["U6", MB, "    return { ok: missing.length === 0, missing: missing };", "    return { ok: true, missing: missing };", UR, "FAIL — C: promoting to a level whose OWN channel is missing", "RED"],
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
