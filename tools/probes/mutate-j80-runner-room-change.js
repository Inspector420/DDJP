// tools/probes/mutate-j80-runner-room-change.js
// SUBJECT: J80 — the bot runs exactly when its room runs on that tab (the owner's ruling 10; since J83 ruling 18). R10, R23 and R43
// moved here at J82 (from `mutate-j79-restore`, retired). B8, B9 and
// B9b added at J81 (owed from the `ddjp_572` audit: no row held `takesOwn`'s self-check or the unreadable case). One row per
// site of the fix, a parity pair (P1 INVERTED AT J83: the back button that does NOT leave the room, so the runner runs on in the
// lobby; stopped during the leave but NOT at the reset that ends the room's processing), and the control. Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the
// outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j80-runner-room-change.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RN = "backends/backend2/runner.js", B2 = "backends/backend2/streammanager.js", MB = "backends/backend1/matrixbridge.js";
const SH = "ui/shell.js", RS = "tests/check-room-scope.js";
const BR = "features/botruntime.js", B1S = "backends/backend1/streammanager.js";
const G = "check-runner-room-change", SC = "check-room-scope", CR = "check-catchup-reentry";
// Re-anchored at J83: the reset is the leave's, takes the leave's reason, and hands the runner's result back.
const STOP_AT_RESET = "    try { if (typeof B2Runner !== \"undefined\") runner = B2Runner.stop(why || \"the tab is opening a room; the room it ran stops here\"); } catch (e) {}\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // B1 — the stop at the room-entry reset is the fix itself.
  ["B1", [[B2, STOP_AT_RESET, ""]], G, "FAIL — R-a: entering the shared room stopped the runner", "RED"],
  // B2 — `start` assigns the room before its guards again: a refused start re-points the runner at the room that refused it.
  ["B2", [[RN, "    const spaceId = o.spaceId || null;\n", "    const spaceId = o.spaceId || null;\n    _ch = ch; _spaceId = spaceId;\n"]],
    G, "FAIL — R-f: the refused start did not re-point the runner at room B", "RED"],
  // B3 — "already running" for ANY log, as before: asked to run another room's log, the runner is not restarted.
  ["B3", [[RN, "    if (_on && _ch && _ch.events_owner === ch.events_owner) return { ok: true, already: true };\n",
    "    if (_on) return { ok: true, already: true };\n"]], G, "FAIL — R-c2: asked to run another room's log while running, it starts afresh", "RED"],
  // B4 — a refusal while running no longer stops the runner.
  ["B4", [[RN, "    const refuse = (r) => { if (_on) stop(\"the room this tab entered refused it: \" + r.reason); return r; };\n",
    "    const refuse = (r) => r;\n"]], G, "FAIL — R-f: a refusal while running stops the runner", "RED"],
  // B5 — the self-check answers "in its room" whatever is bound.
  ["B5", [[RN, "  function _inItsRoom() {\n    if (!_on) return false;\n", "  function _inItsRoom() {\n    if (!_on) return false;\n    return true;\n"]],
    G, "FAIL — R-g: the tick stopped a runner whose tab is no longer in its room", "RED"],
  // B6 — the gate is cleared before its closing opening: what the bot had promised is lost instead of sent.
  ["B6", [[RN, "    try { out = B2Authority.flush(); } catch (e) { _loudWrite(e); }\n",
    "    B2Authority.reset();\n    try { out = B2Authority.flush(); } catch (e) { _loudWrite(e); }\n"]],
    G, "FAIL — R-d: the promised join went to the bot room when its tab entered another room", "RED"],
  // B7 — `check-room-scope` narrowed back to the shared engine's directory: its premise (every backend file the app loads is
  // in the population) refuses, by name.
  ["B7", [[RS, "  .filter((d) => fs.statSync(path.join(BACKENDS, d)).isDirectory())\n",
    "  .filter((d) => fs.statSync(path.join(BACKENDS, d)).isDirectory() && d === \"backend1\")\n"]],
    SC, "FAIL — the population does not cover every backend file `index.html` loads", "RED"],
  // B8 — `takesOwn` without its self-check (owed from the `ddjp_572` audit, where no row held it): an act handed in to a
  // runner whose tab has left its room is taken.
  ["B8", [[RN, "  function takesOwn() { return _on === true && _inItsRoom(); }", "  function takesOwn() { return _on === true; }"]],
    G, "FAIL — R-g: an act handed in — `takesOwn` answers no", "RED"],
  // B9 — "unreadable is not in its room" turned into "unreadable counts as in its room" (owed from the same audit): an
  // unreadable fold scope reads as this runner's log.
  ["B9", [[RN, "    catch (e) { log = null; }\n", "    catch (e) { log = _ch ? _ch.events_owner : null; }\n"]],
    G, "FAIL — R-g: an unreadable the fold scope is not", "RED"],
  // B9b — the same for the bound engine: unreadable reads as the bot engine.
  ["B9b", [[RN, "catch (e) { mode = null; }", "catch (e) { mode = MODE; }"]],
    G, "FAIL — R-g: an unreadable the bound engine is not", "RED"],
  // P1 — PARITY, INVERTED AT J83 (ruling 18): the back button no longer leaves the room — the room and its runner run on in the
  // lobby, which is what ruling 10 asked and ruling 18 forbids. (Before J83 this row made the back button stop the runner alone.)
  ["P1", [[SH, "    backBtn.onclick = () => { Room.leave(\"back to the lobby\"); _bgLeaveRoom();", "    backBtn.onclick = () => { _bgLeaveRoom();"]],
    G, "FAIL — P: the tab went to the lobby and the runner STOPPED", "RED"],
  // P2 — PARITY: the runner still stops during a room entry, but in the next coordinator rather than at the engine reset that
  // ends the room's processing — the two no longer share one switch.
  ["P2", [[B2, STOP_AT_RESET, ""],
          [MB, "  function resetCheckpoints() {\n", "  function resetCheckpoints() {\n    try { if (typeof B2Runner !== \"undefined\") B2Runner.stop(\"moved\"); } catch (e) {}\n"]],
    G, "FAIL — P: at that reset, BOTH stopped", "RED"],
  // R10, R23 and R43 — MOVED HERE AT J82 from `mutate-j79-restore`, which J82 retired with room files (owner's ruling 1; the design's
  // C.4, B8): the bot holds a settings request until it is live (R10), says when a full hold drops one (R43), and a re-entered room
  // clears the move-on log mark (R23). Held by `check-catchup-reentry` M and N, which moved there from `check-bot-restore`.
  ["R10", [[BR, "    if (!_mayAnswer()) {\n", "    if (false) {\n"]],
    CR, "FAIL — M: a request arriving while the bot is still catching up is HELD", "RED"],
  ["R23", [[B1S, "    _moveOnLogged = null;\n    _bankedOwed = false;", "    _bankedOwed = false;"]],
    CR, "FAIL — N: re-entering the room clears the mark", "RED"],
  ["R43", [[BR, "        Logger.warn(\"BotRuntime: a settings request from \" + ((gone && gone.sender) || \"?\") + \" was DROPPED unanswered — more than \" +\n          MAX_HELD_REQUESTS + \" waited while this tab caught up (\" + _running.droppedHeld + \" dropped so far)\");\n", ""]],
    CR, "FAIL — M: the 51st held request pushes the oldest out — and it is SAID", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[RN, "const B2Runner = (() => {\n", "const B2Runner = (() => {\n\n"]], G, "", "GREEN"],
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
