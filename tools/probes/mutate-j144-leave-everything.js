// tools/probes/mutate-j144-leave-everything.js
// SUBJECT: J144 — leaving means leaving everything; three fixes from 695 (`ddjp_696`): a space from another app left WITH its rooms
// (`features/room.js` `_spaceGroups`, `_insideOf`, `_otherPlan`, `otherRoomWords`; `backends/backend1/matrixbridge.js`
// `leaveRoomGroups`; `ui/screens.js` the space row's question), held by `check-other-rooms` D; a removed room's channels left by
// themselves (`features/room.js` `autoLeaveLeftovers`, `_busyExclude`, its wiring in `_fireRoomsChanged` and `resumeLeaves`;
// `matrixbridge.js` `leftoverChannels`, `leaveLeftovers`; `ui/screens.js` the leftover line), held by `check-leftovers` C and D;
// Repair adopting this account's unlisted channel (`matrixbridge.js` `_adoptable`, `createUpgradeBatch`, `repairRoomChannels`) and
// the upgrade's wait from the batch's newest channel (`batchMadeAt`; `features/roomupgrade.js` `_computeStatus`, `status`), held by
// `check-needs-attention` D and E; the bot step waiting for a new channel to sync (`botLevelAfterUpgrade`), held by
// `check-upgrade-copy` C. One row per way it could go wrong, each naming the failure it must cause; the controls change nothing
// that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j144-leave-everything.js            every row
//   node tools/probes/mutate-j144-leave-everything.js SP1 LV3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const ROOM = "features/room.js";
const RU = "features/roomupgrade.js";
const SC = "ui/screens.js";
const GO = "check-other-rooms";
const GL = "check-leftovers";
const GN = "check-needs-attention";
const GU = "check-upgrade-copy";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: a space from another app left with its rooms (`check-other-rooms` D) ──
  ["SP1", [[ROOM, "    if (one) return isSpace(list[0]) ? _spaceGroups(list[0], listable, isSpace, new Set(), []) : [{ room: null, ids: list.slice(), after: [] }];", "    if (one) return [{ room: null, ids: list.slice(), after: [] }];"]],
    GO, "B: A SPACE IS LEFT WITH ITS ROOM", "RED"],   // the space left alone, as at 695: its rooms stay behind
  ["SP2", [[ROOM, "    groups.push({ room: spaceId, ids: rooms, after: subs });", "    groups.push({ room: null, ids: [spaceId].concat(rooms), after: subs });"]],
    GO, "D: THE WHOLE TREE, THE SPACE LAST", "RED"],   // the space left first, before its rooms are out
  ["SP3", [[MB, "      if (room) {\n        if (!failed.length) {", "      if (room) {\n        if (true) {"]],
    GO, "D: A ROOM INSIDE THAT WILL NOT LEAVE KEEPS THE SPACE", "RED"],   // the space left though a room inside it would not leave
  ["SP4", [[MB, "        const blocked = !!(g.room && inside.length);", "        const blocked = false;"]],
    GO, "D: A SPACE INSIDE IT STILL IN KEEPS THE OUTER SPACE", "RED"],   // the outer space left while a space inside it stays
  ["SP5", [[ROOM, "    for (const sp of subs) _spaceGroups(sp, listable, isSpace, seen, groups);\n", ""]],
    GO, "D: A SPACE'S WORDS SAY HOW MANY OF YOUR ROOMS ARE INSIDE IT, AT ANY DEPTH", "RED"],   // one level only: a space inside a space keeps its rooms
  ["SP6", [[ROOM, "    try { kids = (MatrixBridge.spaceChildIds(spaceId) || []).filter((id) => listable.has(id) && !seen.has(id)); } catch (e) { kids = []; }",
    "    try { kids = (MatrixBridge.spaceChildIds(spaceId) || []).filter((id) => !seen.has(id)); } catch (e) { kids = []; }"]],
    GO, "D: NEVER A DDJP CHANNEL, A DM OR AN INVITE INSIDE IT", "RED"],   // the space's list taken whole, past the one classifier
  ["SP7", [[ROOM, "    if (r && r.space && typeof r.inside === \"number\" && r.inside > 0) out.push(r.inside + \" of your rooms inside\");   // `ddjp_696`\n", ""]],
    GO, "D: A SPACE'S WORDS SAY HOW MANY", "RED"],   // the row says nothing of the rooms its Leave will take
  ["SP8", [[SC, "if (inside > 0) { _othersAsk = r.roomId; redraw(); return; } ", ""]],
    GO, "D: ITS LEAVE ASKS ONCE", "RED"],   // a space and its rooms left without a question
  ["SP9", [[SC, "\" inside it you're in?\" }),", "\" inside it?\" }),"]],
    GO, "D: ITS LEAVE ASKS ONCE", "RED"],   // the question's words not the statement's
  ["SP10", [[ROOM, "    const groups = [{ room: null, ids: list.filter((id) => !isSpace(id) && !inside.has(id)), after: [] }];", "    const groups = [{ room: null, ids: list.filter((id) => !isSpace(id)), after: [] }];"]],
    GO, "D: LEAVE ALL", "RED"],   // Leave all: a space's rooms mixed into the first group, not left with their space
  ["SP11", [[SC, "    const inside = (r.space && typeof r.inside === \"number\") ? r.inside : 0;", "    const inside = r.space ? Math.max(1, r.inside || 0) : 0;"]],
    GO, "D: A SPACE WITH NONE INSIDE ASKS NOTHING", "RED"],   // an empty space asks about rooms it has not got
  ["SP12", [[MB, "          failed.push({ id: g.room, kind: null, name: _roomName(g.room), space: true, notTried: true, why: \"not tried: a room inside it is still in\" });\n", ""]],
    GO, "D: A ROOM INSIDE THAT WILL NOT LEAVE KEEPS THE SPACE", "RED"],   // the space kept but not named as what failed
  ["SP13", [[MB, "      const label = (id) => (room && !o.byName ? _labelOf(id, room) : _roomName(id));", "      const label = (id) => (room ? _labelOf(id, room) : _roomName(id));"]],
    GO, "D: ITS LINES", "RED"],   // a space's rooms named by their ids in its leave's line
  // ── JOB 2: a removed room's channels left by themselves (`check-leftovers` C, D) ──
  ["LV1", [[ROOM, "      try { autoLeaveLeftovers(); } catch (e) { /* the next change asks again */ }   // `ddjp_696`: a room this account was removed from\n", ""]],
    GL, "D: REMOVED FROM A ROOM, SEEN LIVE", "RED"],   // a removal seen live leaves its channels behind
  ["LV2", [[ROOM, "    try { autoLeaveLeftovers(); } catch (e) { Logger.warn(\"Room: the leftover channels were not left at start — \" + ((e && e.message) || e)); }\n", ""]],
    GL, "D: FOUND AT START", "RED"],   // leftovers found at start not left
  ["LV3", [[ROOM, "    if (!synced) return null;\n    const job = _leaveJobs[LEFTOVERS];", "    const job = _leaveJobs[LEFTOVERS];"],
    [MB, "    if (!client || !isSynced()) return null;\n    let exl = ", "    if (!client) return null;\n    let exl = "]],
    GL, "D: NEVER BEFORE THE FIRST SYNC", "RED"],   // a leave before the client has its rooms (both sites: the bridge's alone is LO3's)
  ["LV4", [[ROOM, "    for (const k of Object.keys(_joinJobs)) { const j = _joinJobs[k]; if (!j || j.state === \"failed\") continue; ex.push(k); if (j.spaceId) ex.push(j.spaceId); }\n", ""]],
    GL, "D: NEVER A ROOM IN A JOIN JOB", "RED"],   // a room being joined has its channels left under it
  ["LV5", [[MB, "    try { return await _leaveAll(\"leaving leftover channels\", \"leftovers\", () => leftoverChannels(o) || [], null, o); }",
    "    try { const once = leftoverChannels(o) || []; return await _leaveAll(\"leaving leftover channels\", \"leftovers\", () => once.filter(_inOrInvited), null, o); }"]],
    GL, "D: THE SET IS READ AGAIN AT THE START OF ITS TURN", "RED"],   // the set read once, before the turn: a room rejoined meanwhile loses its channels
  ["LV6", [[ROOM, "    if (!Array.isArray(ids) || !ids.length || ids.every((id) => _autoLeave.failed.has(id))) return null;", "    if (!Array.isArray(ids) || !ids.length) return null;"]],
    GL, "D: A LEAVE THAT FAILED IS NOT TRIED AGAIN BY ITSELF", "RED"],   // a refusal sent again on every room change
  ["LV7", [[ROOM, "    if (!Array.isArray(ids) || !ids.length || ids.every((id) => _autoLeave.failed.has(id))) return null;", "    if (!Array.isArray(ids) || !ids.length || _autoLeave.failed.size) return null;"]],
    GL, "D: A NEW LEFTOVER STARTS IT AGAIN", "RED"],   // one failure stops it for good: a later removal's channels stay
  ["LV8", [[ROOM, "Logger.info(\"Room: removed from \" + _heldName(room) + \": leaving its \"", "Logger.info(\"Room: leaving the channels of \" + _heldName(room) + \": its \""]],
    GL, "D: ONE LINE SAYS WHY", "RED"],   // the line says what, not why
  ["LV9", [[SC, "        return lines.length ? H.el(\"div\", { class: \"room-item room-invite-wrap\" }, [row].concat(lines)) : row;",
    "        if (!job) row.appendChild(H.el(\"button\", { class: \"btn-secondary room-open-btn room-leave-btn\", text: \"Leave\" }));\n        return lines.length ? H.el(\"div\", { class: \"room-item room-invite-wrap\" }, [row].concat(lines)) : row;"]],
    GL, "C: UNLOCKED, STILL NO LEAVE OF ITS OWN", "RED"],   // the leftovers' own Leave back on the line
  ["LV10", [[ROOM, "    const ex = _leftoverExclude();\n    try { const p = _resolvePending();", "    const ex = [];\n    try { const p = _resolvePending();"],
    [ROOM, "    try { const p = _resolvePending(); if (p && p.partial) { ex.push(p.partial.spaceId); for (const k of Object.keys(p.partial.channels || {})) ex.push(p.partial.channels[k]); } } catch (e) { /* none */ }\n", ""]],
    GL, "D: NOTHING ELSE", "RED"],   // the room being created has its channels left
  // ── JOB 3: 695's three owed items (`check-needs-attention` D, E; `check-upgrade-copy` C) ──
  ["AD1", [[MB, "        if (own[key]) {                           // made by this account before and never listed: adopted (`ddjp_696`)", "        if (false) {"]],
    GN, "D: AN UNFINISHED BATCH", "RED"],   // a batch's own channel made a second time
  ["AD2", [[MB, "          if (own[m.key]) {\n            await _addToSpace(spaceId, own[m.key]);", "          if (false) {\n            await _addToSpace(spaceId, own[m.key]);"]],
    GN, "D: A CREATION CHANNEL", "RED"],   // a creation channel made a second time
  ["AD3", [[MB, "      if (listed.has(id) || _membershipOf(id) !== \"join\" || _createSenderOf(id) !== me) continue;", "      if (listed.has(id) || _membershipOf(id) !== \"join\") continue;"]],
    GN, "D: AND NEVER ADOPTED", "RED"],   // a channel someone else made adopted into the room
  ["AD4", [[MB, "          await _addToSpace(spaceId, own[key]);\n          added[key] = own[key];", "          added[key] = own[key];"]],
    GN, "D: AN UNFINISHED BATCH", "RED"],   // adopted but never listed: the room still lacks it
  ["AD5", [[MB, "            onAdopted: (label, key) => { made++; adopted++; added[key] = true; tell(); } });", "            onAdopted: (label, key) => {} });"]],
    GN, "D: AN UNFINISHED BATCH", "RED"],   // an adoption not counted as repaired
  ["WT1", [[RU, "    const from = Math.max(lastDoneTs || 0, (typeof madeAt === \"number\" && isFinite(madeAt) && madeAt > 0) ? madeAt : 0);", "    const from = lastDoneTs || 0;"]],
    GN, "E: A CHANNEL NEWER THAN THE MARKER", "RED"],   // the wait from the marker alone, as at 695
  ["WT2", [[RU, "    return _computeStatus(_events, Date.now(), floor, _topBatch(), madeAt);", "    return _computeStatus(_events, Date.now(), floor, _topBatch());"]],
    GN, "E: A BATCH A REPAIR FINISHED WAITS ITS TWO HOURS FROM THE REPAIR", "RED"],   // the status never handed the channel's making
  ["WT3", [[MB, "      if (t !== null && (best === null || t > best)) best = t;\n    }\n    return best;", "      if (t !== null && (best === null || t < best)) best = t;\n    }\n    return best;"]],
    GN, "E: A BATCH A REPAIR FINISHED WAITS", "RED"],   // the oldest channel's making, not the newest
  ["WT4", [[RU, "MatrixBridge.batchMadeAt(Room.getChannels(), floor) : null;", "MatrixBridge.batchMadeAt(Room.getChannels(), floor - 1) : null;"]],
    GN, "E: A BATCH A REPAIR FINISHED WAITS", "RED"],   // the batch below the room's top one read
  ["BS1", [[MB, "      while (ids.some((id) => !amJoined(id)) && waited < CREATE_WAIT_MS) {", "      while (false) {"]],
    GU, "C: A CHANNEL THAT SYNCS LATE IS WAITED FOR", "RED"],   // checked at once, as at 695
  ["BS2", [[MB, "      while (ids.some((id) => !amJoined(id)) && waited < CREATE_WAIT_MS) {", "      while (ids.some((id) => !amJoined(id)) && waited < 600) {"]],
    GU, "C: A CHANNEL THAT SYNCS LATE IS WAITED FOR", "RED"],   // a bound shorter than the creation's own
  ["BS3", [[MB, "        Logger.info(\"MatrixBridge: upgrade — the bot step waited \" + waited + \" ms for the batch's new channels to sync\" +", "        Logger.info(\"MatrixBridge: upgrade — the bot step went on\" +"]],
    GU, "C: THE WAIT IS SAID", "RED"],   // the wait unsaid
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[SC, "title: inside ? \"Leave this space and the rooms inside it\" : \"Leave this room\" });", "title: inside ? \"Leave this space and its rooms\" : \"Leave this room\" });"]], GO, "", "GREEN"],   // a title no row reads
  ["G2", [[ROOM, "    return roomId || \"a room\";", "    return roomId || \"a room no longer held\";"]], GL, "", "GREEN"],   // a fallback no row reaches: every leftover's room is named by its id at least
  ["G3", [[MB, "    if (who.length && !_rankRun) {", "    if (who.length) {"]], GU, "", "GREEN"],   // dominated: with a change running the step answers so below, before any check
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
      const h = J.open("mutate-j144-leave-everything:" + id, file);   // journalled BEFORE the write
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
