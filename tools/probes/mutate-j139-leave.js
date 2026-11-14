// tools/probes/mutate-j139-leave.js
// SUBJECT: J139 — leave a room for good: the room list's Leave behind its lock (`ui/screens.js`), the leave itself
// (`features/room.js` `leaveForGood`, `resumeLeaves`, `leaveNotice`; `backends/backend1/matrixbridge.js` `leaveRoomForGood`), the
// device's record of an unfinished one (`core/store.js`, `core/storageio.js`), the app's start (`app.js` `_enterLobby`) and the
// borrowed red (`index.html`), held by `check-leave-room`. And (`ddjp_691`) the owner's three from 690: EVERY CHANNEL OF THE ROOM
// — the listed ones and the ones whose mark names it, read back and swept again, the room itself read back (`leaveSetOf`,
// `_leaveAll`; rows LV1–LV7, `check-leave-room` F; LR1, LR2, LR3, LR5 and LR7 re-anchored on the rewritten leave); LEFTOVER
// CHANNELS from rooms left before, by the same leave (`leftoverChannels`, `leaveLeftovers`, `Room.leftovers`, the room list's
// line; rows LO1–LO10, `check-leftovers`); and THE ROOM LIST'S TOP ROW ON A PHONE (`index.html` `.rooms-top`; rows LT1–LT6,
// `check-lobby-top`). One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that
// matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j139-leave.js            every row
//   node tools/probes/mutate-j139-leave.js LR1 LR6    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", RM = "features/room.js", SC = "ui/screens.js", APP = "app.js", HTML = "index.html";
const G = "check-leave-room", GL = "check-leftovers", GT = "check-lobby-top";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE LEAVE ITSELF (`check-leave-room` A–C) ──
  ["LR1", [[MB, "        if (!failed.length) {\n          const r = _inOrInvited(room)", "        if (true) {\n          const r = _inOrInvited(room)"]],
    G, "B: the room itself is NOT left while a channel is still in", "RED"],   // the room left with a channel still in: no Leave again
  // LR2, LR11, LR13 AND LO8 RE-ANCHORED AT ddjp_695: the one leave's sends are paced (`paced: true`), leaving the room list closes
  // the other-rooms line too, one other room's leave redraws its line, and the lock counts other rooms — their subjects unchanged.
  ["LR2", [[MB, "      for (const id of ids) {\n        const r = await _joinWithRetry(id, null, false, { kind: \"leave\", turn: t });", "      await Promise.all(ids.map(async (id) => {\n        const r = await _joinWithRetry(id, null, false, { kind: \"leave\", turn: t });"],   // re-anchored at `ddjp_697`: the leave's `paced` option went (the door paces)
    [MB, "        done++;\n        tell({ done: done, total: total });\n      }\n", "        done++;\n        tell({ done: done, total: total });\n      }));\n"]],
    G, "A: ONE AT A TIME — never two leaves in flight at once", "RED"],   // every channel left at once
  ["LR3", [[MB, "    const listed = (spaceChildIds(spaceId) || []).filter(_inOrInvited);", "    const listed = (spaceChildIds(spaceId) || []).filter(() => true);"]],
    G, "A: a channel this account is neither in nor invited to is sent nothing", "RED"],   // a leave sent for every listed channel
  ["LR4", [[RM, "    if (f.refused) return \"refused\" + (f.code ? \": \" + f.code : \"\");\n", ""]],
    G, "B: A REFUSAL IS NAMED", "RED"],   // a refusal reported as a busy server
  ["LR5", [[RM, "    if (w.kept) _keepLeaving([{ spaceId: key, name: name }].concat(_leavingKept().filter((x) => x.spaceId !== key)));\n", ""]],
    G, "B: the unfinished leave is KEPT on the device", "RED"],   // nothing kept: a tab closed halfway never finishes
  ["LR6", [[APP, "    try { if (Room.resumeLeaves) Room.resumeLeaves(); } catch (e) { Logger.warn(\"Resuming a leave failed: \" + (e && e.message)); }\n", ""]],
    G, "C: THE APP'S START FINISHES A KEPT LEAVE", "RED"],   // the module right and reached by nothing (the 44th signature)
  ["LR7", [[RM, "      if (w.kept && rememberedRoom() === key) _forgetRoom();\n", ""]],
    G, "A: and the tab's memory of the room for a reload is forgotten", "RED"],   // a reload would reopen a room left for good
  ["LR8", [[RM, "    return { owner: typeof level === \"number\" && Capabilities.atLeast(level, \"owner\") === true, visibility: vis };",
    "    return { owner: true, visibility: vis };"]],
    G, "D: THE WARNING IS FOR ROOMS THIS ACCOUNT OWNS", "RED"],   // every room warned as the owner's
  ["LR9", [[MB, "  async function _joinWithRetry(id, wanted, invited, o) {\n    const x0 = o || {}, leaving = x0.kind === \"leave\", turn = x0.turn || null;",
    "  async function _joinWithRetry(id, wanted, invited, o) {\n    const x0 = o || {}, leaving = x0.kind === \"leave\", turn = x0.turn || null;\n    if (leaving) { _joinInFlight.add(id); try { await sendMembership(\"leave\", id, turn); return { left: true, result: \"left\" }; } catch (e) { const x = _joinErr(e); return { refused: x.refused, code: x.code, result: \"failed (\" + x.code + \")\" }; } finally { _joinInFlight.delete(id); } }"]],
    G, "B: A 429 RETRIES by the join step's rule", "RED"],   // a leave with no retry: a copy of the rule that is not the rule
  // ── THE ROOM LIST (`check-leave-room` E) ──
  ["LR10", [[SC, "        if (n && n.owner) { _armedLeave = room.spaceId; _redrawRoomRow(room.spaceId); return; }   // the owner's warning, in the row",
    "        if (n && n.owner) { if (!window.confirm(_ownerWarning(n))) return; Room.leaveForGood(room.spaceId); return; }"]],
    G, "E: an owned room's Leave sends nothing yet and opens NO window", "RED"],   // the warning as a browser window
  ["LR11", [[SC, "    if (id !== \"screen-rooms\") { _roomsLocked = true; _armedLeave = null; _othersOpen = false; _othersArmed = false; _othersAsk = null; }", "    if (id === \"never\") { _roomsLocked = true; _armedLeave = null; _othersOpen = false; _othersArmed = false; _othersAsk = null; }"]],   // re-anchored at `ddjp_696` (the space row's question, cleared there too)
    G, "E: LEAVING THE ROOM-LIST SCREEN LOCKS IT AGAIN", "RED"],   // the lock stays open across screens
  ["LR12", [[SC, "      const showLeave = !_roomsLocked && !job && _armedLeave !== room.spaceId;", "      const showLeave = !job && _armedLeave !== room.spaceId;"]],
    G, "E: locked, no Leave anywhere", "RED"],   // Leave not behind the lock
  ["LR13", [[SC, "    _redrawRoomRow(String(spaceId).indexOf(others + \":\") === 0 ? others : spaceId);   // `ddjp_695`: one other room's leave redraws its line\n  }", "    renderRoomList(Room.scanDDJPRooms());\n  }"]],
    G, "E: the leave's progress redraws its own row only", "RED"],   // every progress step rebuilds the whole list
  ["LR14", [[SC, "    return \"You're the owner. \" + (n && n.visibility === \"public\"", "    return \"You're the owner. \" + (n && n.visibility === \"private\""]],
    G, "E: THE OWNER'S WARNING, IN THE ROW (a private room's words)", "RED"],   // the two sentences swapped
  ["LR15", [[HTML, "    .panel-lock-btn.locked, .room-leave-btn { background: #5a2230; border-color: #7a3145; color: #ffb3c0; }",
    "    .panel-lock-btn.locked { background: #5a2230; border-color: #7a3145; color: #ffb3c0; }\n    .room-leave-btn { background: #5a2230; border-color: #7a3145; color: #ffb3c0; }"]],
    G, "E: and it is RED — the locked lock's own red, from the SAME rule", "RED"],   // the red copied, not borrowed: looks right, drifts
  ["LR16", [[HTML, "    .room-leave-line { flex-wrap: wrap; }", "    .room-leave-line { }"]],
    G, "E: the two together at the line's right", "RED"],   // on a phone the buttons squeeze the words to a sliver (measured: 103 px wide)
  // ── EVERY CHANNEL OF THE ROOM (`ddjp_691`, JOB 2, the owner's: "make sure all rooms are left when leaving a space"; `check-leave-room` F) ──
  ["LV1", [[MB, "    const marked = markedFor(spaceId).filter((id) => listed.indexOf(id) < 0);", "    const marked = [];"]],
    G, "F1: A CHANNEL WHOSE MARK NAMES THE ROOM, NOT LISTED, IS LEFT TOO", "RED"],   // 690's set: the listed channels only
  ["LV2", [[MB, "      for (const id of await _readBackOut(answered, t)) {", "      for (const id of []) {"]],
    G, "F2: A CHANNEL STILL IN AFTER ITS LEAVE WAS ANSWERED is read back", "RED"],   // an answered leave taken as out, never read back
  ["LV3", [[MB, "      for (const id of collect()) {\n        if (ids.indexOf(id) >= 0) continue;", "      for (const id of []) {\n        if (ids.indexOf(id) >= 0) continue;"]],
    G, "F3: A CHANNEL FOUND BY THE FRESH SWEEP is named", "RED"],   // no fresh sweep: a channel that arrived mid-leave is left behind
  ["LV4", [[MB, "      tell({ done: 0, total: total });", "      tell({ done: 0, total: (spaceChildIds(key) || []).filter(_inOrInvited).length });"],
    [MB, "        tell({ done: done, total: total });", "        tell({ done: done, total: (spaceChildIds(key) || []).filter(_inOrInvited).length });"]],
    G, "F1: THE PROGRESS COUNTS THE WHOLE SET", "RED"],   // the progress counts the listed channels only
  ["LV5", [[RM, "      try { inIt = MatrixBridge.amJoined(k.spaceId) === true || ((typeof MatrixBridge.markedFor === \"function\") && MatrixBridge.markedFor(k.spaceId).length > 0); } catch (e) { inIt = false; }",
    "      try { inIt = MatrixBridge.amJoined(k.spaceId) === true; } catch (e) { inIt = false; }"]],
    G, "F4: THE NEXT START FINISHES A KEPT LEAVE WHOSE ROOM IS OUT BUT A CHANNEL IS STILL IN", "RED"],   // the room out: its channels forgotten
  ["LV6", [[MB, "          if (r.left && (await _readBackOut([room], t)).length === 0) roomLeft = true;", "          if (r.left) roomLeft = true;"]],
    G, "F6: THE ROOM ITSELF STILL IN AFTER ITS LEAVE WAS ANSWERED", "RED"],   // the room taken as left on the server's answer alone
  ["LV7", [[MB, "    try { return await _leaveAll(\"leaving \" + name + \" for good\", spaceId, () => leaveSetOf(spaceId), spaceId, o); }",
    "    try { return await _leaveAll(\"leaving \" + name + \" for good\", spaceId, () => (spaceChildIds(spaceId) || []).filter(_inOrInvited), spaceId, o); }"]],
    G, "F1: A CHANNEL WHOSE MARK NAMES THE ROOM, NOT LISTED, IS LEFT TOO", "RED"],   // the leave's own copy of the set, missing the marks
  // ── LEFTOVER CHANNELS (`ddjp_691`, JOB 3, the owner's "yes"; `check-leftovers`), the same leave ──
  ["LO1", [[MB, "ex.has(m.room) || ex.has(id) || m.room === id || _inOrInvited(m.room)) continue;", "ex.has(m.room) || ex.has(id) || m.room === id) continue;"]],   // re-anchored at `ddjp_696` (a channel excluded by its own id too)
    GL, "A: NEVER a channel of a room this account is in", "RED"],   // every marked channel counted, the rooms this account is in too
  ["LO2", [[MB, "if (!m || !m.room || !m.kind || ex.has(m.room)", "if (!m || !m.room || ex.has(m.room)"]],
    GL, "A: NEVER a DM, nor a room without a complete mark", "RED"],   // half a mark counts
  ["LO3", [[MB, "    if (!client || !isSynced()) return null;\n    let exl = ", "    if (!client) return null;\n    let exl = "]],   // re-anchored at `ddjp_696` (the exclusions read again each time)
    GL, "A: NOT DECIDED BEFORE THE FIRST SYNC", "RED"],   // decided before the client has its rooms: a count of what is not known yet
  ["LO4", [[RM, "return (p && p.spaceId) ? [p.spaceId] : []; }", "return []; }"]],
    GL, "A: NEVER the half-built room's channels", "RED"],   // the half-built room's channels offered for leaving
  ["LO5", [[MB, "    try { return await _leaveAll(\"leaving leftover channels\", \"leftovers\", () => leftoverChannels(o) || [], null, o); }",
    "    try { const ids = leftoverChannels(o) || []; await Promise.all(ids.map((id) => client.leave(id))); return { ok: true, total: ids.length, left: ids.length, failed: [] }; }"]],
    GL, "B: IT WAITS ITS TURN AT THE DOOR", "RED"],   // a copy of the leave, outside the door and all at once
  ["LO6", [[RM, "label: (f) => String(f.name || f.id) });", "label: (f) => String(f.id) });"]],
    GL, "B: A REFUSAL IS NAMED by the channel's name", "RED"],   // a refusal named by its id
  // LO7 RETIRED AT `ddjp_696`: the leftovers' own Leave is gone (they leave by themselves, JOB 2), so there is no lock test on it to
  // break; its Leave again stays behind the lock (`leaveLines`, held by LR rows), and "no Leave of its own" is `mutate-j144`'s LV rows.
  ["LO8", [[SC, "    _renderRoomsLock(owned.length + joined.length + loCount + othersCount > 0);", "    _renderRoomsLock(owned.length + joined.length + othersCount > 0);"]],
    GL, "C: WITH NO ROOM BUT LEFTOVERS, the line and its lock are there", "RED"],   // only leftovers: no lock, so no Leave ever
  ["LO9", [[SC, "        const lines = leaveLines({ spaceId: key }, job, () => Room.leaveLeftovers());", "        const lines = leaveLines({ spaceId: key }, null, () => Room.leaveLeftovers());"]],
    GL, "C: A FAILURE —", "RED"],   // the leave's progress and failure not drawn in the line
  ["LO10", [[SC, "text: \"Leftover channels from rooms you left: \" + n })]);", "text: \"Leftover channels: \" + n })]);"]],
    GL, "C: ONE LINE AT THE LIST'S END", "RED"],   // other words than the owner's
  // ── THE ROOM LIST'S TOP ROW ON A PHONE (`ddjp_691`, JOB 4, the owner's "ok"; `check-lobby-top`) ──
  ["LT1", [[HTML, "    @media (max-width: 600px) { .rooms-top { flex-direction: column; align-items: flex-start; } .rooms-top h2 { margin: 0; } }\n", ""]],
    GT, "C: UNDER A NARROW-SCREEN RULE THE ROW STACKS", "RED"],   // no narrow rule: the title squeezed beside the buttons
  ["LT2", [[HTML, "    .rooms-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }",
    "    .rooms-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }"]],
    GT, "B: THE ROW IS A FLEX ROW THAT WRAPS", "RED"],   // 690's row: one line, past the screen
  ["LT3", [[HTML, "    .rooms-top-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }",
    "    .rooms-top-acts { display: flex; align-items: center; gap: 8px; }"]],
    GT, "B: THE BUTTONS' GROUP WRAPS", "RED"],   // the buttons in one unbreakable line
  ["LT4", [[HTML, "  <div class=\"rooms-top\">\n", "  <div class=\"rooms-top\" style=\"display:flex; justify-content:space-between; align-items:center;\">\n"]],
    GT, "A: NONE OF THE THREE CARRIES AN INLINE STYLE", "RED"],   // an inline style back: it beats the class
  ["LT5", [[HTML, "      <button id=\"btn-logout\" class=\"btn-secondary\">Log out</button>\n", "      <button id=\"btn-logout\" class=\"btn-secondary\" hidden>Log out</button>\n"]],
    GT, "A: no button and no slot is hidden", "RED"],   // fitted by hiding one
  ["LT6", [[HTML, "    .rooms-top-id { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }",
    "    .rooms-top-id { display: flex; align-items: center; gap: 8px; }"]],
    GT, "B: THE ID'S SLOT MAY SHRINK TO THE SCREEN", "RED"],   // a long ID pushes the row wide again
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[RM, "  const LEAVING_CAP = 20;", "  const LEAVING_CAP = 21;"]], G, "", "GREEN"],   // the cap no row reaches
  ["G2", [[SC, "title: \"Leave this room for good\" });", "title: \"Leave this room, for good\" });"]], G, "", "GREEN"],   // a title no row reads
  ["G3", [[MB, "  const LEAVE_READBACK_MS = 8000, LEAVE_POLL_MS = 250;", "  const LEAVE_READBACK_MS = 8000, LEAVE_POLL_MS = 200;"]], GL, "", "GREEN"],   // read back a little more often (`ddjp_691`)
  // G4 RETIRED AT `ddjp_696`: the title it changed belonged to the leftovers' own Leave, gone (JOB 2).
  ["G5", [[HTML, "    .rooms-top-acts { display: flex; align-items: center; gap: 8px;", "    .rooms-top-acts { display: flex; align-items: center; gap: 6px;"]], GT, "", "GREEN"],   // a gap no row reads
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
      const h = J.open("mutate-j139-leave:" + id, file);   // journalled BEFORE the write
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
