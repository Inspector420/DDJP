// tools/probes/mutate-j86-late-channel.js
// SUBJECT: J86, a channel joined after the opening is folded at once (the owner's call on J85's finding).
// `features/room.js` `mergeChannels` puts each new channel into the room's scope BEFORE its replay, and only for the room
// it names; `features/roomupgrade.js` names its room before the slow batch and records nothing in a room it no longer
// runs; `_adoptJoinedChannel` checks the mark before anything is added; the page cap stays at no less than 250 (J85's
// step). One row per rule, each naming the failure it must cause in `check-late-channel` (or `check-read-back-one`), and
// the control. Each row plants its edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's
// own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j86-late-channel.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", RU = "features/roomupgrade.js", MB = "backends/backend1/matrixbridge.js", TR = "backends/backend2/transport.js";
const G = "check-late-channel", RB = "check-read-back-one";
const MERGE_SCOPE = "      try { if (newChannels[key] && typeof MatrixBridge.addToRoomScope === \"function\") MatrixBridge.addToRoomScope(newChannels[key]); } catch (e) {}\n";
const ADOPT_SCOPE = "    try { if (typeof MatrixBridge.addToRoomScope === \"function\") MatrixBridge.addToRoomScope(roomId); } catch (e) {}\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // LC1 — J85'S STATE BACK: `mergeChannels` never scopes what it merges; a late spine channel waits for a reopen.
  ["LC1", [[RM, "    for (const key in newChannels) {\n" + MERGE_SCOPE + "    }\n", ""]],
    G, "FAIL — A: ITS REPLAY IS FOLDED", "RED"],
  // LC2 — SCOPED, BUT ONLY AFTER THE REPLAY: the door refuses the history and takes only what comes next.
  ["LC2", [[RM, "    for (const key in newChannels) {\n" + MERGE_SCOPE + "    }\n", ""],
    [RM, "        MatrixBridge.replayRoom(newChannels[key])\n", "        MatrixBridge.replayRoom(newChannels[key]).then(() => MatrixBridge.addToRoomScope(newChannels[key]))\n"]],
    G, "FAIL — A: ITS REPLAY IS FOLDED", "RED"],
  // LC3 — `mergeChannels` takes any room's channels: its own room check dropped.
  ["LC3", [[RM, "    if (spaceId !== current.spaceId) {\n", "    if (false) {\n"]],
    G, "FAIL — C: `mergeChannels` asked for a room that is not the one running refuses", "RED"],
  // LC4 — THE UPGRADE RECORDS ITSELF IN THE NEXT ROOM: its "left while it ran" stop dropped (the merge still refuses).
  ["LC4", [[RU, "      if (!nowIn || nowIn.spaceId !== spaceId) {\n", "      if (false) {\n"]],
    G, "FAIL — C: and no done marker is sent into the other room's owner channel", "RED"],
  // LC5 — THE UPGRADE NAMES ITS ROOM AFTER THE BATCH, so a switched tab's new room takes the old room's channels.
  ["LC5", [[RU, "      if (!nowIn || nowIn.spaceId !== spaceId) {\n", "      if (!nowIn) {\n"],
    [RU, "      Room.mergeChannels(added, spaceId);\n", "      Room.mergeChannels(added, Room.getCurrent().spaceId);\n"]],
    G, "FAIL — C: THE UPGRADE PATH — a batch that returns after its room was left is not merged", "RED"],
  // LC6 — THE SUPERVISOR'S BREAK: J85's scope add moved above the mark check in `_adoptJoinedChannel`.
  ["LC6", [[RM, ADOPT_SCOPE, ""],
    [RM, "    if (Object.values(current.channels).indexOf(roomId) >= 0) return;   // already mapped\n",
     "    if (Object.values(current.channels).indexOf(roomId) >= 0) return;   // already mapped\n" + ADOPT_SCOPE]],
    G, "FAIL — C: THE JOIN PATH — and never added to the room's scope", "RED"],
  // LC7 — THE MARK CHECK GONE: any channel's kind is taken, whichever room its mark names.
  ["LC7", [[RM, "    return (m && current && m.room === current.spaceId && m.kind) ? m.kind : null;", "    return (m && m.kind) ? m.kind : null;"]],
    G, "FAIL — C: THE JOIN PATH — a channel whose mark names another room, or carries none, is not mapped", "RED"],
  // LC8 — THE SUPERVISOR'S BREAK: the page cap lowered, 250 -> 200 (both reads alike, so "one cap" alone stayed green).
  ["LC8", [[MB, "  const PAGE_BACK_MAX = 250;\n", "  const PAGE_BACK_MAX = 200;\n"]],
    RB, "FAIL — B: AND THE CAP IS NO LESS THAN 250 REQUESTS", "RED"],
  // LC9 — A BOT ROOM'S FOLD RE-BOUND ON A LATE CHANNEL: the late channel taken into the fold as a role (D pins that it is not).
  ["LC9", [[TR, "  leaveRoom: function () {\n",
    "  addToRoomScope: function (roomId) {\n    const r = B1MatrixBridge.addToRoomScope(roomId);\n" +
    "    try { B2StreamManager.setFoldScope(Object.assign({}, _channels || {}, { settings_owner: roomId })); } catch (e) {}\n    return r;\n  },\n\n" +
    "  leaveRoom: function () {\n"]],
    G, "FAIL — D: but the bot engine's fold keeps the roles its entry bound", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[RM, "  function mergeChannels(newChannels, spaceId) {\n", "  function mergeChannels(newChannels, spaceId) {\n\n"]], G, "", "GREEN"],
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
