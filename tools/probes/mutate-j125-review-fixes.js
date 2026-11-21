// tools/probes/mutate-j125-review-fixes.js
// SUBJECT: J125 — the supervisor's review of `ddjp_644` and the owner's REP timing (`ddjp_645`). Three changes, each held by
// the guard named in its rows: a tab that slept is suspended before the first answer's events reach anything
// (`backends/backend1/session.js` `arrived`, called first in `matrixbridge.js` `_routeEvent`; `check-session-awake` G); the
// genesis check's "cannot tell" asked once per save point and reach (`backends/backend1/streammanager.js` `_cannotTellOn`,
// `_reachOf`; `check-seed-validation` O5–O7); and REP's 30-minute floor in one reading, new rooms at 1 h, the slider at 30
// (`features/rep-rules.js` `intervalOf`, `rep-bot.js`, `rep-reader.js`, `statederiver.js` `NEW_ROOM_VALUES`, `ui/settings.js`
// `_ROW_LEAST`; `check-rep-rules` S, `check-rep-bot` R, `check-rep-reader` B, `check-genesis-settings` A). One row per way it
// could go wrong, each naming the failure it must cause, and controls. Each row plants its edit(s), confirms every one
// LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after
// every row, and checked restored.
//   node tools/probes/mutate-j125-review-fixes.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SE = "backends/backend1/session.js", MB = "backends/backend1/matrixbridge.js", SM = "backends/backend1/streammanager.js";
const SD = "backends/backend1/statederiver.js", RR = "features/rep-rules.js", RB = "features/rep-bot.js", RD = "features/rep-reader.js";
const UI = "ui/settings.js";
const AW = "check-session-awake", SV = "check-seed-validation", RU = "check-rep-rules", BOT = "check-rep-bot", RDR = "check-rep-reader", GS = "check-genesis-settings";
const RAW = "const s = RepPorts.settings() || {}; return (typeof s.repSummaryMs === \"number\" && s.repSummaryMs > 0) ? s.repSummaryMs : null;";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── A TAB THAT SLEPT ──
  // SL1 — the arrival is no longer tested: the first answer's events reach the listeners while the tab reads LIVE (644's order).
  ["SL1", [[MB, "      try { if (typeof Session !== \"undefined\" && Session.arrived) Session.arrived(); } catch (e) {}\n", ""]],
    AW, "G1: A TAB THAT SLEPT DOES NOT ACT ON THE FIRST ANSWER AFTER WAKING", "RED"],
  // SL2 — every arrival is a full sign of life: during a catch-up an arrival half-way through an answer settles the tab.
  ["SL2", [[SE, "    if (!sleptDetected(_lastLifeAt, _env.now(), SLEEP_MS)) return;\n    _life(\"arrival\");", "    _life(\"arrival\");"]],
    AW, "G3 CONTROL: AN ARRIVAL DURING A CATCH-UP DOES NOT SETTLE IT", "RED"],
  // SL3 — an arrival suspends the tab with no gap at all.
  ["SL3", [[SE, "    if (!sleptDetected(_lastLifeAt, _env.now(), SLEEP_MS)) return;\n    _life(\"arrival\");", "    _suspendedBecause = \"slept\"; _to(SUSPENDED, \"slept\");"]],
    AW, "G2 CONTROL: AN ORDINARY ANSWER CHANGES NOTHING", "RED"],
  // ── THE GENESIS CHECK ──
  // GV1 — "cannot tell" is not remembered: the seed is folded again at every arrival (644).
  ["GV1", [[SM, "            if (_gap === \"log-not-from-start\") _cannotTellOn = { sig: sig, reach: _reach };", ""]],
    SV, "O5: WITH THE SAVE POINT AND THE REACH UNCHANGED", "RED"],
  // GV2 — the key forgets the save point: a new save point is not asked.
  ["GV2", [[SM, "!(_cannotTellOn && _cannotTellOn.sig === sig && _cannotTellOn.reach === _reach)", "!(_cannotTellOn && _cannotTellOn.reach === _reach)"]],
    SV, "O6: a NEW SAVE POINT asks again", "RED"],
  // GV3 — the reach forgets what the door set aside: paging further back is not asked.
  ["GV3", [[SM, "    return (first ? first.l + \":\" + first.eventId : \"none\") + \"|\" + _derivedLogTrimmed + \"|\" +", "    return (first ? first.l + \":\" + first.eventId : \"none\") + \"|\" +"]],
    SV, "O6: and so does PAGING FURTHER BACK", "RED"],
  // GV4 — the reach forgets the first held event (`ddjp_646`, the supervisor's check of `ddjp_645`): an older event HELD, nothing
  // set aside, is not asked about. Written so `first` stays read and lint stays clean.
  ["GV4", [[SM, "    return (first ? first.l + \":\" + first.eventId : \"none\") + \"|\" +", "    return (first ? \"held\" : \"none\") + \"|\" +"]],
    SV, "O7: AN OLDER EVENT HELD ASKS AGAIN", "RED"],
  // ── REP'S TIMING ──
  // RT1 — the bot reads the room's setting raw: a room set to 10 min is sent to every 10.
  ["RT1", [[RB, "  function _interval() { return RepRules.intervalOf(RepPorts.settings() || {}); }", "  function _interval() { " + RAW + " }"]],
    BOT, "R: A ROOM SET TO 10 MIN IS READ AS 30", "RED"],
  // RT2 — the reader reads it raw: its look-back no longer spans what the bot sends.
  ["RT2", [[RD, "  function _interval() { return RepRules.intervalOf(RepPorts.settings() || {}); }", "  function _interval() { " + RAW + " }"]],
    RDR, "B: A ROOM SET TO 10 MIN LOOKS BACK 60 MIN", "RED"],
  // RT3 — the floor in the one reading drops to the fold's 10 min.
  ["RT3", [[RR, "    minIntervalMs: 30 * 60 * 1000,", "    minIntervalMs: 10 * 60 * 1000,"]], RU, "S: REP'S LEAST INTERVAL IS 30 MIN", "RED"],
  // RT4 — the row's least is not applied: the reducer's 10 min wins and the slider starts there.
  ["RT4", [[UI, "    if (typeof _ROW_LEAST[key] === \"number\" && _ROW_LEAST[key] > min) min = _ROW_LEAST[key];\n", ""]],
    RU, "S: THE SLIDER STARTS AT 30", "RED"],
  // RT5 — a new room starts at 30 min again.
  ["RT5", [[SD, "    checkpointCooldownMs: 30 * 60 * 1000, checkpointEvery: 200, repSummaryMs: 60 * 60 * 1000,", "    checkpointCooldownMs: 30 * 60 * 1000, checkpointEvery: 200, repSummaryMs: 30 * 60 * 1000,"]],
    GS, "A: IT DIFFERS FROM THE BUILT-IN DEFAULTS IN THE OWNER'S KEYS AND NO OTHER", "RED"],
  // RT6 — the floor moved into the fold instead: a settings event at 10 min no longer folds to 10 (old and new builds disagree).
  ["RT6", [[SD, "    repSummaryMs:         { min: 10 * 60 * 1000,", "    repSummaryMs:         { min: 30 * 60 * 1000,"]],
    RU, "S: the interval runs from 10 minutes to 24 hours", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[SE, "  function arrived() {\n", "  function arrived() {\n\n"]], AW, "", "GREEN"],
  ["N2", [[SM, "  function _reachOf(ordered) {\n", "  function _reachOf(ordered) {\n\n"]], SV, "", "GREEN"],
  ["N3", [[RR, "  function intervalOf(settings) {\n", "  function intervalOf(settings) {\n\n"]], RU, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
