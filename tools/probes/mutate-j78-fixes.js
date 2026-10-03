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
const RR = "check-repeat-rule", RC = "check-repeat-cooldown", PO = "check-player-load-once", AF = "check-answer-after-floor";
const ROWS = [
  ["H1", SM, "History.ingest(_drop, _heldBase, _droppedReach(_prevCut, fl.floorL))", "History.ingest(_drop, _heldBase)", HF, "FAIL — A: after moving on to n=2", "RED"],
  ["H2", HI, "const keep = (cut !== null) ? Math.max(cut, top === null ? -Infinity : top) : top;", "const keep = top;", HF, "FAIL — C: rows above the cut", "RED"],
  ["E1", PB, "    if (typeof pi === \"string\" && pi && np && np.pi !== pi) return false;\n", "", EB, "FAIL — A: a late ENDED from the FIRST play", "RED"],
  ["E2", PL, "    if (np.pi && cur.pi !== np.pi) return \"pi-changed\";\n", "", EB, "FAIL — B: the same video twice in a row RELOADS", "RED"],   // re-anchored at ddjp_537: the pi-changed branch of _loadReason
  ["E3", PL, "t._ddjpPlayingPi = t._ddjpLoadingPi || null;", "t._ddjpPlayingPi = t._ddjpPlayingPi || null;", EB, "FAIL — B: a stale ENDED from the first play does NOT end", "RED"],
  ["E4", PL, "endedPi = (t && t._ddjpPlayingPi) || null;", "endedPi = null;", EB, "FAIL — B: a stale ENDED from the first play does NOT end", "RED"],
  ["J1", MB, "  const JOIN_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];", "  const JOIN_RETRY_MS = [];", CJ, "FAIL — A: a channel that fails twice", "RED"],
  ["J2", MB, "    if (unjoined.length) Logger.warn(", "    if (false) Logger.warn(", CJ, "FAIL — B: a channel that never joins", "RED"],
  ["J3", MB, "            try { _joinAdvertised(childId); } catch (e) {}   // a channel advertised later is joined too (J78)\n", "", CJ, "FAIL — C: the bridge's live m.space.child handler", "RED"],
  ["J4", MB, "    for (let round = 0; round <= JOIN_RETRY_MS.length; round++) {\n      if (joinedNow()) return true;", "    for (let round = 0; round <= 0; round++) {\n      if (joinedNow()) return true;", CJ, "FAIL — C: a channel advertised later is joined as it arrives", "RED"],
  // L1–L3, V1–V3 (J78, the owner's re-test at ddjp_535): the live history reach, the vote backstop, the vote latch.
  ["L1", HI, "return ingest(log, s, (typeof from === \"number\") ? { retain: true, from: from } : { retain: true });", "return ingest(log, s, { retain: true });", HL, "FAIL — A: after moving on to n=4", "RED"],
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
