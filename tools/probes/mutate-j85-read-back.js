// tools/probes/mutate-j85-read-back.js
// SUBJECT: J85, one "read a channel back to a time" step (the owner: no duplicated code between the bot's presence reading
// and REP). `backends/backend1/matrixbridge.js` `_pageBackTo` is the one time-based page-back; `readBackActivity` (the chat
// read behind `Room.presenceView`) and `readChannelBack` (REP's look-back, E3) page through it and keep only what they pick
// out; `addToRoomScope` and `features/room.js` `_adoptJoinedChannel` keep a chat channel joined after the opening in the
// room's scope. One row per rule, each naming the failure it must cause in `check-read-back-one` (or `check-bot-open`'s
// re-aimed row), and the control. Each row plants its edit(s), confirms every one LANDED, runs the guard and reads the
// outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j85-read-back.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", RM = "features/room.js";
const G = "check-read-back-one", BO = "check-bot-open";
// Re-anchored at J87: the chat read no longer reads this client's id (its own messages count).
const STEP_CALL_CHAT = "      const back = await _pageBackTo(roomId, sinceTs);\n      if (!back.ok) return out;\n      const room = client.getRoom(roomId);\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // PB1 — THE SCOPE CHECK DROPPED: the step pages any room it is handed (the chat read's old way, now for both).
  ["PB1", [[MB, "    if (!room || typeof sinceTs !== \"number\" || !inScope(roomId)) return out;\n", "    if (!room || typeof sinceTs !== \"number\") return out;\n"]],
    G, "FAIL — B: THE ROOM'S SCOPE, FOR BOTH", "RED"],
  // PB2 — THE PAGE CAP SPLIT AGAIN: the chat read hands the step its old cap of 200.
  ["PB2", [[MB, "  async function _pageBackTo(roomId, sinceTs) {\n", "  async function _pageBackTo(roomId, sinceTs, cap) {\n"],
    [MB, "    while (out.pages < PAGE_BACK_MAX) {\n", "    while (out.pages < (cap || PAGE_BACK_MAX)) {\n"],
    [MB, "      const back = await _pageBackTo(roomId, sinceTs);\n", "      const back = await _pageBackTo(roomId, sinceTs, 200);\n"]],
    G, "FAIL — B: ONE CAP — both stop after the same number of requests", "RED"],
  // PB3 — A SECOND TIME LOOP, BACK IN ITS OLD PLACE: the chat read pages for itself again, as before J85.
  ["PB3", [[MB, STEP_CALL_CHAT,
    "      const room = (client && client.getRoom) ? client.getRoom(roomId) : null;\n      if (!room || typeof sinceTs !== \"number\") return out;\n" +
    "      const me = getUserId(), back = { complete: false, reachedTs: null };\n      const oldestTs = () => (room.timeline.length ? room.timeline[0].getTs() : null);\n" +
    "      let prev = -1, guard = 0;\n      while (guard < 200) {\n        const o = oldestTs();\n        if (o !== null && o <= sinceTs) break;\n" +
    "        if (room.timeline.length === prev) { back.complete = true; break; }\n        prev = room.timeline.length;\n" +
    "        try { await client.scrollback(room, 100); } catch (e) { return out; }\n        guard++;\n      }\n      back.reachedTs = oldestTs();\n"]],
    G, "FAIL — A: ONE TIME-BASED PAGE-BACK LOOP", "RED"],
  // PB4 — A SECOND TIME LOOP UNDER A NEW NAME: a third reader writes its own copy instead of asking the step.
  ["PB4", [[MB, "  // ── ONE CHANNEL, READ BACK OVER A TIME WINDOW (J84, hook E3; generic)",
    "  async function _readBackToo(room, sinceTs) {   // eslint-disable-line no-unused-vars\n    let prev = -1;\n" +
    "    while (room.timeline.length !== prev && !(_tsOfItem(room.timeline[0]) < sinceTs)) { prev = room.timeline.length; await client.scrollback(room, 100); }\n  }\n\n" +
    "  // ── ONE CHANNEL, READ BACK OVER A TIME WINDOW (J84, hook E3; generic)"]],
    G, "FAIL — A: ONE TIME-BASED PAGE-BACK LOOP", "RED"],
  // PB5 — the same, as an arrow function assigned to a name (the scan reads names, not one declaration style).
  ["PB5", [[MB, "  // ── ONE CHANNEL, READ BACK OVER A TIME WINDOW (J84, hook E3; generic)",
    "  const _backAgain = async (room) => { await client.scrollback(room, 100); };   // eslint-disable-line no-unused-vars\n\n" +
    "  // ── ONE CHANNEL, READ BACK OVER A TIME WINDOW (J84, hook E3; generic)"]],
    G, "FAIL — A: ONE TIME-BASED PAGE-BACK LOOP", "RED"],
  // PB6 — THE STOP RULE SPLIT: the step stops with its oldest event AT the time (the chat read's old `<=`).
  ["PB6", [[MB, "      if (o !== null && o < sinceTs) break;\n    ", "      if (o !== null && o <= sinceTs) break;\n    "]],
    G, "FAIL — B: ONE STOP RULE", "RED"],
  // PB7 — THE ROOM'S START LOST: a timeline that stops growing is not said to be complete.
  ["PB7", [[MB, "      if (room.timeline.length === prev) { out.complete = true; break; }   // nothing older exists\n      prev = room.timeline.length;\n      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs",
    "      if (room.timeline.length === prev) break;\n      prev = room.timeline.length;\n      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs"]],
    G, "FAIL — B: A TIMELINE THAT STOPS GROWING IS THE ROOM'S START", "RED"],
  // PB8 — the same break, read by `check-bot-open`'s re-aimed textual row L.
  ["PB8", [[MB, "      if (room.timeline.length === prev) { out.complete = true; break; }   // nothing older exists\n      prev = room.timeline.length;\n      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs",
    "      if (room.timeline.length === prev) break;\n      prev = room.timeline.length;\n      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs"]],
    BO, "FAIL — L (textual): and a timeline that stops growing is the chat's start", "RED"],
  // PB9 — A FAILED REQUEST TAKEN AS A READ: the step breaks out and answers ok.
  ["PB9", [[MB, "      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs = oldestTs(); return out; }\n",
    "      try { await client.scrollback(room, 100); } catch (e) { break; }\n"]],
    G, "FAIL — B: a request that fails is not a read", "RED"],
  // PB10 — THE CHAT READ'S OWN PART DRIFTS: an encrypted message no longer counted (the outputs are each their own).
  // Re-aimed at J87: its old break (this client's own messages counted) is now the rule; an encrypted message dropped instead.
  ["PB10", [[MB, "if ((ty !== \"m.room.message\" && ty !== \"m.room.encrypted\") || !who || typeof ts", "if (ty !== \"m.room.message\" || !who || typeof ts"]],
    G, "FAIL — C: `readBackActivity` answers { ok, people, reachedTs, complete }", "RED"],
  // PB11 — REP'S OWN PART DRIFTS: everything the page brought back is kept, older than the time included.
  ["PB11", [[MB, "typeof ts !== \"number\" || ts < sinceTs) continue;\n        let body = null;", "typeof ts !== \"number\") continue;\n        let body = null;"]],
    G, "FAIL — C: `readChannelBack` answers an array", "RED"],
  // PB12 — A CHAT CHANNEL JOINED AFTER THE OPENING LEFT OUT OF THE SCOPE: the room side never adds it.
  ["PB12", [[RM, "    try { if (typeof MatrixBridge.addToRoomScope === \"function\") MatrixBridge.addToRoomScope(roomId); } catch (e) {}\n", ""]],
    G, "FAIL — D (textual): `features/room.js` adds each chat channel it maps", "RED"],
  // PB13 — THE ADD STARTS A SCOPE where no room runs (fail open).
  ["PB13", [[MB, "    if (!_activeScope || !roomId || typeof roomId !== \"string\") return false;\n",
    "    if (!roomId || typeof roomId !== \"string\") return false;\n    if (!_activeScope) _activeScope = Object.create(null);\n"]],
    G, "FAIL — D: with no room running nothing is added", "RED"],
  // PB14 — THE ADD REPLACES the opening's scope instead of adding to it.
  ["PB14", [[MB, "    _activeScope[roomId] = 1;\n    return true;\n", "    _activeScope = Object.create(null); _activeScope[roomId] = 1;\n    return true;\n"]],
    G, "FAIL — D: added to the bound scope, which keeps the opening's channels", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[MB, "  const PAGE_BACK_MAX = 250;\n", "  const PAGE_BACK_MAX = 250;\n\n"]], G, "", "GREEN"],
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
