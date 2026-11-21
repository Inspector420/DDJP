// tools/probes/mutate-j116-bot-rung.js
// SUBJECT: the bot takes its own turn before the human owner for the seal and the proactive vouch pass, only while an account
// holds the bot's rank, followed live; the song acts take none (the owner's decisions: `ddjp_626` Part E, built at `ddjp_627`,
// narrowed at `ddjp_628`; seen live in the owner's `?v=558` run of J116's checks, where the creator and the bot sealed n=2 26 ms
// apart). It has no job of its own, so it carries the number of the run it came from. Each row undoes one piece and must turn
// its guard red (BR13 `check-length-freshness`, the rest `check-bot-rung`) NAMING the row that holds it; the control changes a
// path no guard drives and must leave it green.
//   BR1 — the bot waits the step too.                    BR2 — the floor swallows the step (`max(floor, slot)` again).
//   BR3 — the creator at 100 reads as the bot.           BR4 — any room reads as having a bot.
//   BR5 — the vouch plan does not read the rung.         BR6 — the seal plan does not read the rung.
//   BR7–BR11 — CHANGED AT `ddjp_628`, with the reason: the song acts no longer read the rung, so each row now GIVES one back
//     its `ddjp_627` reading — the length declaration, the advance, the display length, the blocked report, the availability
//     skip — and `check-bot-rung` C must name it ("a song act takes NO rung").
//   BR12 — the Scheduler applies the floor outside the formula again.
//   BR13 — the length declaration hands the formula no settle floor (`check-length-freshness` C: the owner at 0 again).
//   BR14 — a rank change re-arms nothing (`ddjp_628`).      BR15 — only the space's change re-arms, not a channel's.
//   BR16 — a lone bot is not recognised: more than one account at 99 is needed (a gap the supervisor planted, `ddjp_628`).
//   BR17 — the seal's dueness ladder takes no rung (the same, `ddjp_628`).   BR18 — the re-arm says nothing in the log.
//   BR19 — the re-arm leaves the old timer running, so the turn acts at its OLD moment (a gap the supervisor planted, `ddjp_629`).
//   BRc — the control: the vouch bundle's no-Scheduler fallback (a partial load) does not read the rung; no guard drives it.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j116-bot-rung.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RK = "backends/backend1/ranks.js", MB = "backends/backend1/matrixbridge.js", CP = "backends/backend1/checkpoint.js",
  SC = "backends/backend1/scheduler.js", PB = "features/playback.js", ML = "features/medialength.js", MK = "features/mediablocked.js";
const G = "check-bot-rung";
const RUNG = "(typeof MatrixBridge !== \"undefined\" && MatrixBridge.botRung) ? MatrixBridge.botRung() : null";
// THE CALL'S NAME IN TWO PIECES: `check-spine` PART C scans the tree for that call to list every turn-taking site, and these are
// anchors to edit, not turns.
const CSM = "Capabilities" + ".staggerMs(", RSM = "Ranks" + ".staggerMs(";
// The two blocked-report sites read alike to the line; their own function's first lines tell them apart.
const ST = "    const st = (typeof StreamManager !== \"undefined\" && StreamManager.getState)\n      ? (StreamManager.getState().settings || {}) : {};\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["BR1", [[RK, "const lead = (botRoom && !(rung.iAmBot === true && tier === 0)) ? s : 0;", "const lead = botRoom ? s : 0;"]],
    G, "FAIL — A2: WITH a bot the bot keeps today's owner slot", "RED"],
  ["BR2", [[RK, "return Math.max(floor + lead, Math.round(slot));", "return Math.max(floor, Math.round(slot));"]],
    G, "FAIL — A2: WITH a bot the bot keeps today's owner slot", "RED"],
  ["BR3", [[MB, "iAmBot: botRoom && getMyPowerLevel(_currentSpaceId) === top };", "iAmBot: botRoom && getMyPowerLevel(_currentSpaceId) >= top };"]],
    G, "FAIL — B1: the creator's tab (power 100) reads a room with a bot", "RED"],
  ["BR4", [[MB, "const botRoom = at.who.length > 0 || at.defaultIsLevel === true;", "const botRoom = true;"]],
    G, "FAIL — B4: a room with no account at the ladder's top rung reads no bot", "RED"],
  ["BR5", [[MB, "      rung: () => botRung(),                             // the bot first, then the human owner (`ddjp_627`)\n", ""]],
    G, "FAIL — C vouch:proactive: with a bot, one trigger arms the bot first", "RED"],
  ["BR6", [[CP, "      rung: () => (typeof _env.rung === \"function\" ? _env.rung() : null),   // the bot first, then the owner (`ddjp_627`)\n", ""]],
    G, "FAIL — C checkpoint:seal: with a bot, one trigger arms the bot first", "RED"],
  ["BR7", [[PB, "delay = " + CSM + "_myRank(), st.vouchJitter, null, null, floor);", "delay = " + CSM + "_myRank(), st.vouchJitter, null, " + RUNG + ", floor);"]],
    G, "FAIL — C play.len: a song act takes NO rung", "RED"],
  ["BR8", [[PB, "jitter = " + CSM + "_myRank(), st.vouchJitter, null);", "jitter = " + CSM + "_myRank(), st.vouchJitter, null, " + RUNG + ");"]],
    G, "FAIL — C advance: a song act takes NO rung", "RED"],
  ["BR9", [[ML, "return " + CSM + "rank, st.vouchJitter, null);", "return " + CSM + "rank, st.vouchJitter, null, " + RUNG + ");"]],
    G, "FAIL — C media.len: a song act takes NO rung", "RED"],
  ["BR10", [[MK, "  function _delayForRank(rank) {\n" + ST + "    return " + CSM + "rank, st.vouchJitter, null);", "  function _delayForRank(rank) {\n" + ST + "    return " + CSM + "rank, st.vouchJitter, null, " + RUNG + ");"]],
    G, "FAIL — C play.blocked: a song act takes NO rung", "RED"],
  ["BR11", [[MK, "  function _skipDelayForRank(rank) {\n" + ST + "    return " + CSM + "rank, st.vouchJitter, null);", "  function _skipDelayForRank(rank) {\n" + ST + "    return " + CSM + "rank, st.vouchJitter, null, " + RUNG + ");"]],
    G, "FAIL — C media.skip: a song act takes NO rung", "RED"],
  ["BR12", [[SC, "const delay = Math.max(0, slotMs(spec, floor));", "const delay = Math.max(floor, slotMs(spec));"]],
    G, "FAIL — C vouch:proactive: with a bot, one trigger arms the bot first", "RED"],
  ["BR13", [[PB, "delay = " + CSM + "_myRank(), st.vouchJitter, null, null, floor);", "delay = " + CSM + "_myRank(), st.vouchJitter, null, null, 0);"]],
    "check-length-freshness", "FAIL — C: APPLIED — the owner's declaration is planned with a delay ABOVE zero", "RED"],
  ["BR14", [[MB, "        _rearmTurnsFor(stateEvent.getRoomId ? stateEvent.getRoomId() : null);\n", ""]],
    G, "FAIL — D: the bot at 80", "RED"],
  ["BR15", [[MB, "if (!roomId || !(roomId === _currentSpaceId || inScope(roomId))) return;", "if (!roomId || roomId !== _currentSpaceId) return;"]],
    G, "FAIL — D CONTROL: another room's power levels moving re-arms nothing here; one of this room's channels does", "RED"],
  ["BR16", [[MB, "const botRoom = at.who.length > 0 || at.defaultIsLevel === true;", "const botRoom = at.who.length > 1 || at.defaultIsLevel === true;"]],
    G, "FAIL — B6: with exactly one account at 99", "RED"],
  ["BR17", [[CP, "const ladderMs = " + RSM + "_env.myRank(), _step, () => 0, (typeof _env.rung === \"function\") ? _env.rung() : null);",
    "const ladderMs = " + RSM + "_env.myRank(), _step, () => 0, null);"]],
    G, "FAIL — E1: in a quiet room with a bot", "RED"],
  ["BR18", [[MB, "      if (r.length) Logger.info(\"MatrixBridge: the room's ranks moved — re-armed \" + r.map((x) => x.name + \" in \" + x.delay + \"ms\").join(\", \"));\n", ""]],
    G, "FAIL — D: the re-arm says what it moved", "RED"],
  ["BR19", [[SC, "      try { _env.clearTimeout(p.handle); } catch (e) {}\n      delete _plans[name];\n      const r = _arm(name, p.spec, p.replans);",
    "      delete _plans[name];\n      const r = _arm(name, p.spec, p.replans);"]],
    G, "FAIL — D TIMING: a re-armed turn does not act at its OLD moment", "RED"],
  ["BRc", [[MB, "               spacing: () => Dials.live(settings, \"vouchJitter\"),\n               rung: () => botRung(),\n", "               spacing: () => Dials.live(settings, \"vouchJitter\"),\n"]],
    G, "", "GREEN"],
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
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
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
