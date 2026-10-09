// tools/probes/mutate-j78-step5b.js
// SUBJECT: J78 — the three fixes from the owner's bot-room test. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-step5b.js
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
  // Q1–Q9 (ddjp_554, step 5b): each gate condition — grade, boundary held, the proof, the settings proof — the seal check, the
  // log limit, the cache following the rule, the by-position proof, and an origin floor's declaration.
  ["Q1", "backends/backend1/streammanager.js", "    if (typeof TrustPolicy === \"undefined\" || !TrustPolicy.earnsForget || !TrustPolicy.earnsForget(t.grade)) return 0;\n", "    /* the grade gate removed */\n", "check-trim-every-floor", "FAIL — G1: a floor whose grade does not allow forgetting", "RED"],
  ["Q2", "backends/backend1/streammanager.js", "    if (!bid || !(eventLog.some((e) => e && e.eventId === bid) || _proofKeep.some((e) => e && e.eventId === bid))) return false;   // boundary held\n", "    if (!bid || !(eventLog.some((e) => e && e.eventId === bid) || _proofKeep.some((e) => e && e.eventId === bid))) return true;   // boundary held\n", "check-trim-every-floor", "FAIL — C: a floor whose boundary this device does not hold licenses nothing", "RED"],
  ["Q3", "backends/backend1/streammanager.js", "    try { return typeof Floor !== \"undefined\" && typeof Floor.proves === \"function\" && Floor.proves(t, proofLog(), { byPosition: true }).ok === true; }\n", "    try { return true; }\n", "check-trim-every-floor", "FAIL — B: a dishonest owner-tier floor is followed", "RED"],
  ["Q4", "backends/backend1/streammanager.js", "  function _provesForForgetting(t) { return _floorProves(t) && _settingsProofAllows(); }\n", "  function _provesForForgetting(t) { return _floorProves(t); }\n", "check-forget-live", "B: an unproven settings claim withholds the licence", "RED"],
  ["Q5", "backends/backend1/checkpoint.js", "    try { if (typeof _env.disagrees === \"function\" && _env.disagrees() === true) return { ok: false, reason: \"my-view-disagrees\" }; }\n", "    try { }\n", "check-seal-disagrees", "FAIL — disagrees → no seal", "RED"],   // re-anchored at ddjp_555: the check and its fail-closed catch are two lines
  ["Q6", "backends/backend1/streammanager.js", "    if (!sig || sig === _lastValidatedCp || sig === _moveOnLogged) return;   // concluded, or already said for this floor\n", "    if (!sig || sig === _lastValidatedCp) return;\n", "check-trim-every-floor", "FAIL — G2: the log limit", "RED"],
  ["Q7", "backends/backend1/eventcache.js", "    const licensed = _fromAdopted || !!(typeof StreamManager !== \"undefined\" && typeof StreamManager.forgettingLicensed === \"function\" && StreamManager.forgettingLicensed());\n", "    const licensed = true;\n", "check-trim-every-floor", "FAIL — B: and the raw cache retires nothing under it", "RED"],
  ["Q8", "backends/backend1/floor.js", "      if (p < 0 && byPosition && typeof pred.floorL === \"number\") {\n", "      if (false) {\n", "check-forgetting-differential", "FAIL — S5: the owner's arrival order forgets", "RED"],
  ["Q9", "backends/backend1/streammanager.js", "    if (_originDeclared && t) { const v = seedValidation(); if (v && v.reason === \"origin-seed\" && v.sig === _sigOf(t)) return true; }\n", "", "check-origin-fold", "B: CONTROL — the trim actually ran", "RED"],
  // Q10–Q11 (ddjp_555): the seal check fails closed; the capture premise bites.
  ["Q10", "backends/backend1/checkpoint.js", "    catch (e) { return { ok: false, reason: \"my-view-disagrees-unknown\" }; }\n", "    catch (e) {}\n", "check-seal-disagrees", "FAIL — the seal check FAILS CLOSED", "RED"],
  ["Q11", "tests/check-trim-every-floor.js", "  if (logs && sb.Logger) { for (const lv of [\"info\", \"warn\", \"debug\", \"error\"]) sb.Logger[lv] = (m) => logs.push(String(m)); }   // every level (ddjp_555: the trim line is debug)\n", "", "check-trim-every-floor", "FAIL — A PREMISE — log capture works", "RED"],
  // Q12–Q14 (ddjp_556): disagreement only on complete data; dropped history rows re-read.
  ["Q12", "backends/backend1/streammanager.js", "    return !!(sig && v && v.sig === sig && v.status === \"mismatched\" && _checkHadCompleteData());\n", "    return !!(sig && v && v.sig === sig && v.status === \"mismatched\");\n", "check-seal-disagrees", "FAIL — the banked case seals", "RED"],
  ["Q13", "backends/backend1/history.js", "      _ranges = _ranges.filter((r) => r[0] <= cut).map((r) => [r[0], Math.min(r[1], cut)]);\n", "      { const _t = _entries.reduce((m, e) => (typeof e.l === \"number\" && (m === null || e.l > m)) ? e.l : m, null); const _k = Math.max(cut, _t === null ? -Infinity : _t); _ranges = _ranges.filter((r) => r[0] <= _k).map((r) => [r[0], Math.min(r[1], _k)]); }\n", "check-history-reread", "FAIL — the dropped row's position is NOT claimed as covered", "RED"],   // re-anchored at ddjp_557: the original defect, clipping at the top surviving row
  ["Q14", "backends/backend1/matrixbridge.js", "                  try { History.refresh(); } catch (e) {}\n                  Promise.resolve(History.fillGaps ? History.fillGaps() : null).then(() => _persistHistory(), () => _persistHistory());\n", "                  _persistHistory();\n", "check-history-reread", "FAIL — the bridge's floor handler re-reads after a drop", "RED"],
  // Q15–Q17 (ddjp_557): coverage clipped to the cut; a restored table reconciled; the backfill re-arm coalesced.
  ["Q15", "backends/backend1/history.js", "      _ranges = _ranges.filter((r) => r[0] <= cut).map((r) => [r[0], Math.min(r[1], cut)]);\n", "      { const _lo = _ranges.length ? Math.max(cut, cut + 9) : cut; _ranges = _ranges.filter((r) => r[0] <= _lo).map((r) => [r[0], Math.min(r[1], _lo)]); }\n", "check-history-reread", "FAIL — B: coverage is clipped TO THE CUT", "RED"],
  ["Q16", "backends/backend1/matrixbridge.js", "            try { const _f = (typeof Floor !== \"undefined\" && Floor.current) ? Floor.current() : null; if (_f && Floor.sigOf) History.reconcileFloor(Floor.sigOf(_f), _f.floorL); } catch (e) {}\n", "", "check-history-reread", "FAIL — C: the bridge reconciles a restored table", "RED"],
  ["Q17", "backends/backend1/matrixbridge.js", "    if (_rearmTimer) return;\n", "", "check-history-reread", "FAIL — D: six re-arms in a burst schedule ONE", "RED"],
  // Q18–Q19 (ddjp_558): a held Queue send lets go of its wait; add records do not depend on which step ran last.
  ["Q18", "features/queue.js", "          clearTimeout(timer0);\n          letGo();\n", "          clearTimeout(timer0);\n", "check-queue-hold-once", "FAIL — and its wait LETS GO", "RED"],
  ["Q19", "backends/backend1/history.js", "    const _addsFrom = (opts && opts.retain) || !_retainKeep ? list : list.filter((e) => _isAdd(e) && _retainKeep.has(e.sender + \"\\u0000\" + e.content.v));\n", "    const _addsFrom = list;\n", "check-history-audit", "FAIL — a backfill's ingest records adds only for songs the last retain kept", "RED"],
  // Q20, Q22 (ddjp_559): a held segment folds only from its matching seed; the audit is read-only. (Q21 withdrawn: the gap filler already fetches the prefix.)
  ["Q20", "backends/backend1/history.js", "      if (typeof c === \"number\" && log.some((e) => typeof e.l === \"number\" && e.l <= c)) { log = log.filter((e) => typeof e.l === \"number\" && e.l > c); _cutFrom = c + 1; }\n", "", "check-forgetting-differential", "FAIL — S13: forgetting on and off give identical", "RED"],
  ["Q22", "backends/backend1/history.js", "    const mine = _entries.slice();\n", "    const mine = _entries.slice(); _entries.push({ pi: \"$audit-wrote\", l: 1 });\n", "check-history-audit", "FAIL — READ-ONLY", "RED"],
  // Q23–Q26 (ddjp_560): the verify pass; a derivation wins; the audit's truth is floor-anchored; the backfill is floor-anchored.
  ["Q23", "backends/backend1/matrixbridge.js", "      try { const _v = History.verifyIncremental ? await History.verifyIncremental(await _resolvedChain()) : null;\n", "      try { const _v = null;\n", "check-forgetting-differential", "FAIL — S14: the ON device repairs", "RED"],   // re-anchored at ddjp_564: the verify call takes the resolved chain
  ["Q24", "backends/backend1/history.js", "    _mergeIn(folded, _finals, true);   // a derivation wins over what the table held for the same play (ddjp_560)\n", "    _mergeIn(folded, _finals);\n", "check-history-audit", "FAIL — a DERIVATION replaces a wrong row", "RED"],
  ["Q25", "backends/backend1/history.js", "    const _anch = deriveAnchored(evs, opts && opts.anchors);\n", "    const _anch = deriveAnchored(evs, []);\n", "check-history-audit", "FAIL — a row whose VIDEO DIFFERS is flagged", "RED"],
  ["Q26", "backends/backend1/history.js", "    for (const sg of _segments(_within, _anchorsIn(_within), seed)) {\n", "    for (const sg of _segments(_within, [], seed)) {\n", "check-history-audit", "FAIL — the backfill from the room's start is FLOOR-ANCHORED", "RED"],
  // Q27–Q29 (ddjp_561): an already verified segment is not read again; segments are keyed by their floors' fingerprints; a coverage reset re-verifies above its cut.
  ["Q27", "backends/backend1/history.js", "      if (_verified[key]) { skipped++; continue; }\n", "", "check-forgetting-differential", "FAIL — S16: a later open of an UNCHANGED room reads NOTHING", "RED"],
  ["Q28", "backends/backend1/history.js", "      const a = cuts[i - 1], b = cuts[i], key = KEY_V + a.h + \">\" + b.h;   // versioned: marks made under an older rule re-verify once\n", "      const a = cuts[i - 1], b = cuts[i], key = KEY_V + a.l + \">\" + b.l;\n", "check-forgetting-differential", "FAIL — S16: a REPLACED floor", "RED"],   // re-anchored at ddjp_563
  ["Q29", "backends/backend1/history.js", "      for (const k of Object.keys(_verified)) if (_verified[k].hi > cut) delete _verified[k];   // coverage reset: re-verify above the cut\n", "", "check-forgetting-differential", "FAIL — S16: a coverage reset at l=40", "RED"],
  // Q30, Q32, Q33 (ddjp_562; Q31 withdrawn — the settled-only refresh is backstopped by the rebuild's rule and the key drop, so no row turns red on its own): the cache rebuild anchors on the accepted chain; refresh waits until settled; a changed row drops its
  // segment's key; refresh folds above the cut when its log has gaps.
  ["Q30", "backends/backend1/matrixbridge.js", "          const _rb = History.rebuildAnchored ? History.rebuildAnchored(held, await _resolvedChain()) : { segments: 0, added: 0 };\n", "          const _rb = History.rebuildAnchored(held, held.filter((e) => _isHistoryAnchor(e)).map((e) => ({ h: e.content.h, l: e.content.floorL, seed: e.content.seed })));\n", "check-forgetting-differential", "FAIL — S17: and its second open", "RED"],   // re-anchored at ddjp_564: the rebuild takes the resolved chain
  ["Q32", "backends/backend1/history.js", "    if (!(opts && opts.src === \"verify\")) _dropKeysChangedBy(folded);   // ddjp_562: a verified segment another path changes is re-verified\n", "", "check-history-audit", "FAIL — a write that CHANGES a row in a verified segment drops its key", "RED"],
  ["Q33", "backends/backend1/history.js", "    if (seed === undefined && (isSegment || !_whole || (_origin && !_origin.start)) && typeof _env.cut === \"function\") {   // a segment, a log with gaps, or an origin room\n", "    if (seed === undefined && (isSegment || (_origin && !_origin.start)) && typeof _env.cut === \"function\") {   // a segment, a log with gaps, or an origin room\n", "check-forgetting-differential", "FAIL — S17: and its second open", "RED"],   // re-anchored at ddjp_564: the condition also names an origin room; the mutation still removes only the gap rule
  // Q34–Q38 (ddjp_563): the closing floor's banked song; versioned marks; the trim hand-off waits until settled; marks restored
  // after a writer touched their segment do not count; a channel refused at this rank is not retried on every rank change.
  ["Q34", "backends/backend1/history.js", "    if (banked && !rows.some((r) => r.pi === banked.pi)) {\n", "    if (false) {\n", "check-forgetting-differential", "FAIL — S18: a table that lost the floor's banked song REGAINS it", "RED"],
  ["Q35", "backends/backend1/history.js", "  const KEY_V = \"v2|\";\n", "  const KEY_V = \"\";\n", "check-forgetting-differential", "FAIL — S18: a table that lost the floor's banked song REGAINS it", "RED"],
  ["Q36", "backends/backend1/history.js", "    if (opts && opts.src === \"trim\" && typeof _env.settled === \"function\") { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }\n", "    if (false) { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }\n", "check-history-audit", "FAIL — (a) the trim hand-off writes NOTHING before the device is settled", "RED"],
  ["Q37", "backends/backend1/history.js", "      if (_touchedBeforeRestore.some((l) => l >= v.lo && l <= v.hi)) continue;\n", "", "check-history-audit", "FAIL — (b) marks a restore brings for a segment a writer already touched do NOT count", "RED"],
  ["Q38", "backends/backend1/matrixbridge.js", "      return !(typeof w.refusedAtRank === \"number\" && typeof _now === \"number\" && _now <= w.refusedAtRank); });\n", "      return true; });\n", "check-join-refused-rank", "FAIL — a channel refused at rank 99 is NOT retried", "RED"],
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
