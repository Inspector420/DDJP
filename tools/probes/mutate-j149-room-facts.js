// tools/probes/mutate-j149-room-facts.js
// SUBJECT: J149 — room facts through one door, ready for sliding sync later, nothing changed now (`ddjp_701`): no feature or UI
// file reaching the SDK (`features/room.js` through the transport's named reads), the named reads answering what the SDK holds
// (`backends/backend1/matrixbridge.js` `roomIds`, `roomName`, `myMembershipIn`, `joinedCount`, `roomStateEvent`, …), the table of
// the facts read of a room not open and its one door (`ROOM_FACTS`, `_fact`, `ROOM_FACTS_OPEN`, `ROOM_FACT_READS`; the account's
// `_createOfId`), and the connection's one named choice (`CONNECTION`) — `check-room-facts`. One row per way it could go wrong,
// each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j149-room-facts.js            every row
//   node tools/probes/mutate-j149-room-facts.js RF1 RF7    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const MA = "backends/backend1/matrixaccount.js";
const ROOM = "features/room.js";
const RF = "check-room-facts";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: features and UI never reach the SDK; the named reads answer what it holds ──
  ["RF1", [[ROOM, "    try { const n = roomId ? MatrixBridge.roomName(roomId) : null; if (n) return n; } catch (e) { /* the id */ }", "    try { const n = roomId ? (MatrixBridge.getClient().getRoom(roomId) || {}).name : null; if (n) return n; } catch (e) { /* the id */ }"]],
    RF, "F: NO FEATURE OR UI FILE CALLS getClient() OR READS AN SDK ROOM", "RED"],   // a name read past the transport again
  ["RF2", [[ROOM, "    for (const roomId of MatrixBridge.roomIds()) {", "    for (const roomId of MatrixBridge.getClient().getRooms().map((r) => r.roomId)) {"]],
    RF, "F: NO FEATURE OR UI FILE CALLS getClient() OR READS AN SDK ROOM", "RED"],   // the room list walking the SDK's rooms
  ["RF3", [[MB, "    return r ? r.name : null;", "    return r ? r.roomId : null;"]],
    RF, "R: EACH ROOM'S NAME, CREATION RECORD, THIS ACCOUNT'S MEMBERSHIP AND COUNTS", "RED"],   // a name read answering something else
  ["RF4", [[MB, "    if (!r) return null;\n    try { return typeof r.getMyMembership === \"function\"", "    if (!r) return \"leave\";\n    try { return typeof r.getMyMembership === \"function\""]],
    RF, "R: EACH ROOM'S NAME, CREATION RECORD, THIS ACCOUNT'S MEMBERSHIP AND COUNTS", "RED"],   // "not held" read as "left"
  ["RF5", [[MB, "    try { return Number(r.getJoinedMemberCount()); } catch (e) { return null; }", "    try { return Number(r.getInvitedMemberCount()); } catch (e) { return null; }"]],
    RF, "R: EACH ROOM'S NAME, CREATION RECORD, THIS ACCOUNT'S MEMBERSHIP AND COUNTS", "RED"],   // the joined count answering the invited
  // ── JOB 2: the table, its door, each read's rows ──
  ["RF6", [[MB, "    if (!f || !f.type || f.onRequest) {", "    if (false) {"]],
    RF, "T: A TYPE THE TABLE DOES NOT LIST IS REFUSED BY NAME", "RED"],   // an unlisted type no longer refused by name
  ["RF7", [[MB, "    const jr = _fact(spaceId, \"joinRules\");   // the table's `joinRules` (`ddjp_701`)", "    const jr = client.getRoom(spaceId).currentState.getStateEvents(\"m.room.join_rules\", \"\");"]],
    RF, "T: EVERY STATE READ IN THE TRANSPORT IS THE TABLE'S DOOR", "RED"],   // a room not open read past the door
  ["RF8", [[MB, "    joinRules: Object.freeze({ type: \"m.room.join_rules\", key: \"\",", "    joinRules: Object.freeze({ type: \"m.room.topic\", key: \"\","]],
    RF, "T: THE STATE TYPES READ OF A ROOM NOT OPEN", "RED"],   // the table naming a type that is not read, missing one that is
  ["RF9", [[MB, "    getSpaceVisibility: [\"joinRules\"], _createdAt: [\"create\"], _createSenderOf: [\"create\"],", "    getSpaceVisibility: [\"name\"], _createdAt: [\"create\"], _createSenderOf: [\"create\"],"]],
    RF, "T: EACH NAMED READ READS ONLY THE ROWS IT NAMES", "RED"],   // a read declaring rows it does not read
  ["RF10", [[MB, "    members: Object.freeze({ type: \"m.room.member\", key: \"*\", onRequest: true, for:", "    members: Object.freeze({ type: \"m.room.member\", key: \"*\", for:"]],
    RF, "T: WRITTEN AS SLIDING SYNC'S `required_state` WOULD TAKE IT", "RED"],   // every room's members asked for with it
  ["RF11", [[MB, "      const ev = _fact(spaceId, \"create\");   // the table's `create` (`ddjp_701`)", "      const ev = _fact(spaceId, \"creation\");   // the table's `create` (`ddjp_701`)"]],
    RF, "T: EVERY CALL OF THE DOOR NAMES A ROW OF THE TABLE", "RED"],   // a door call naming a row that is not there
  ["RF12", [[MB, "\"allPowerLevels\", \"_copiedUsers\", \"_liveChannelMap\"]);", "\"allPowerLevels\", \"_copiedUsers\", \"_liveChannelMap\", \"_gone\"]);"]],
    RF, "T: every function the open room's list names exists", "RED"],   // the open room's list naming what is not there
  ["RF13", [[MA, "      const ev = roomId ? B1MatrixBridge.roomStateEvent(roomId, \"m.room.create\", \"\") : null;", "      const ev = roomId ? _c().getRoom(roomId).currentState.getStateEvents(\"m.room.create\", \"\") : null;"]],
    RF, "T: EVERY STATE READ IN THE TRANSPORT IS THE TABLE'S DOOR", "RED"],   // the account's invite read past the door
  // ── JOB 3: the connection ──
  ["RF14", [[MB, "  const CONNECTION = \"classic\";", "  const CONNECTION = \"sliding\";"]],
    RF, "C: ONE NAMED CHOICE", "RED"],   // a choice that is not built
  ["RF15", [[MB, "advertises `org.matrix.simplified_msc3575` among its", "advertises sliding sync among its"]],
    RF, "C: ITS COMMENT SAYS WHERE SLIDING SYNC WOULD GO", "RED"],   // the comment no longer says how a server tells
  // ── CONTROLS: nothing that matters changes ──
  ["G1", [[ROOM, "      if (!isDDJPRoom(MatrixBridge.getCreateContent(roomId))) continue;", "      if (!isDDJPRoom(MatrixBridge.getCreateContent(roomId))) continue;   // a control: words only"]],
    RF, "", "GREEN"],
  ["G2", [[MB, "    return r ? r.name : null;", "    return r ? (r.name) : null;"]],
    RF, "", "GREEN"],
  ["G3", [[MB, "\"allPowerLevels\", \"_copiedUsers\", \"_liveChannelMap\"]);", "\"allPowerLevels\",   \"_copiedUsers\", \"_liveChannelMap\"]);"]],
    RF, "", "GREEN"],
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
// The journal file is the run's own; one this run created and left empty is removed at the end, so a copy the file ran
// in comes back byte for byte (HANDOVER §4). A journal still holding entries is never removed.
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark] of ROWS) {
  if (want.length && want.indexOf(id) < 0) continue;
  // PLANNED IN MEMORY FIRST: every anchor must occur exactly once in the bytes it will be applied to, or nothing is written.
  const files = new Map();
  let voided = null;
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    if (!files.has(file)) { const o = fs.readFileSync(file, "utf8"); files.set(file, { rel, original: o, mutated: o }); }
    const f = files.get(file);
    const n = f.mutated.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel + ": " + JSON.stringify(oldS.slice(0, 60)); break; }
    const next = f.mutated.replace(oldS, () => newS);
    if (next === f.mutated) { voided = "the edit changed nothing in " + rel; break; }
    f.mutated = next;
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  const handles = [];
  let out = "", code = 0, landed = true, held = true;
  try {
    for (const [file, f] of files) {
      const h = J.open("mutate-j149-room-facts:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
      out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
      held = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);   // still there as the result is read
    }
  } finally { for (const h of handles) h.restore(); }
  const restored = [...files].every(([file, f]) => sha(fs.readFileSync(file, "utf8")) === sha(f.original));
  if (!restored) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (!landed) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
  if (!held) { console.log("VOID  " + id + " — an edit was gone by the time the result was read"); bad++; continue; }
  if (wantMark === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else {
      bad++;
      const first = (out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160);
      console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (first ? " — got " + first : "") + (v.why ? " (" + v.why + ")" : ""));
    }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected green: " + ((out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160))); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
