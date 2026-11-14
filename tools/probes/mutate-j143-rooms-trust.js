// tools/probes/mutate-j143-rooms-trust.js
// SUBJECT: J143 — rooms you can trust (the owner's plan, part 2, `ddjp_695`): "Needs attention" on the room list and its Repair
// (`backends/backend1/matrixbridge.js` `roomAttention`, `repairRoomChannels`; `features/room.js` `needsAttention`, `repairRoom`,
// `refusedOpening` and the refusal `join` keeps; `ui/screens.js` `attentionRow`; `index.html`), held by `check-needs-attention`;
// and other Matrix rooms, to clean up (`features/room.js` `otherRooms`, `otherRoomWords`, `quietWords`, `leaveOtherRooms`;
// `matrixbridge.js` `leaveRooms`, `newestStampHeld`, the one leave's pacing in `_joinWithRetry` and `_leaveAll`; `ui/screens.js`
// `otherLine`; `index.html`), held by `check-other-rooms`. One row per way it could go wrong, each naming the failure it must
// cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j143-rooms-trust.js            every row
//   node tools/probes/mutate-j143-rooms-trust.js NA1 OR3    named rows
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
const SC = "ui/screens.js";
const PAGE = "index.html";
const GN = "check-needs-attention";
const GO = "check-other-rooms";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 2: "Needs attention" and its Repair (`matrixbridge.js` `roomAttention`, `repairRoomChannels`; `features/room.js`
  //    `needsAttention`, `repairRoom`, the refusal kept by `join`; `ui/screens.js` `attentionRow`), held by `check-needs-attention` ──
  ["NA1", [[MB, "    for (const p of plan) if (p && present[p.key] && typeof p.batch === \"number\" && p.batch > started) started = p.batch;\n", ""]],
    GN, "A: MISSING CHANNELS OF A BATCH BEGUN", "RED"],   // the batch begun never read: an upgrade's missing channels not told
  ["NA2", [[MB, "    const missing = unreadable ? [] : plan.filter(", "    const missing = plan.filter("],
    [ROOM, "      if ((a && a.readable && a.missing.length) || (job && job.state !== \"done\")) {", "      if ((a && a.missing.length) || (job && job.state !== \"done\")) {"]],
    GN, "A: A ROOM ONE OF WHOSE LISTED CHANNELS THIS ACCOUNT HOLDS NOTHING OF", "RED"],   // missing told where a channel it cannot read might be the one (both sites: each alone is held by the other — G4)
  ["NA3", [[MB, "      if (why && ms === \"join\") { wrong.push({ id: id, why: why, room: m.room, kind: m.kind }); continue; }", "      if (why && ms === \"join\") { continue; }"]],
    GN, "A: A WRONG MARK", "RED"],   // a channel marked for another room passed over in silence
  ["NA4", [[ROOM, "          repair: (typeof lv === \"number\" && typeof need === \"number\" && lv >= need) ? \"yes\" : \"owner\" }));", "          repair: \"yes\" }));"]],
    GN, "A: A ROOM THIS ACCOUNT HOLDS EVERY CHANNEL OF BUT CANNOT WRITE THE LIST OF", "RED"],   // Repair offered to an account Matrix will refuse
  ["NA5", [[MB, "    if (typeof lv !== \"number\" || lv < SPACE_CHILD_LEVEL) return no(\"not-owner\");\n", ""]],
    GN, "B: REFUSED, NOTHING MADE", "RED"],   // the bridge makes channels for an account that cannot list them
  ["NA6", [[MB, "    const missing = unreadable ? [] : plan.filter((p) => p && (p.batch || 1) <= started && !present[p.key])", "    const missing = unreadable ? [] : plan.filter((p) => p && (p.batch || 1) <= started + 1 && !present[p.key])"]],
    GN, "B: NEVER THE NEXT UPGRADE", "RED"],   // the batch after the one begun counted missing: Repair starts the next upgrade
  ["NA7", [[MB, "it.gates, it.key, _copiedUsers(spaceId, creatorId)), label);", "it.gates, it.key), label);"]],
    GN, "B: A MISSING CREATION CHANNEL REMADE BY ITS BUILDER", "RED"],   // a creation channel remade naming its creator only (JOB 1's copy dropped)
  ["NA8", [[ROOM, "      if (made && made.added && Object.keys(made.added).length) bot = await upgradeBotLevel(spaceId, made.added, { turn: turn });\n", ""]],
    GN, "B: and its log line says so", "RED"],   // the bot step skipped: nothing would ever catch a copy that failed
  ["NA9", [[MB, "        try { await _reconcileAfterUpgrade(spaceId, Object.assign({}, added)); } catch (e) { Logger.warn(\"MatrixBridge: repair reconcile failed — \" + ((e && e.message) || e)); }\n", ""]],
    GN, "B: and its members invited", "RED"],   // a remade creation channel's members never invited
  ["NA10", [[ROOM, "    const r = await upgradeTurn(spaceId, { what: \"repair\", onWait: (text) => { job.waitsFor = text; _repairTold(spaceId); } }, async (turn) => {", "    const r = await (async (f) => f(null))(async (turn) => {"]],
    GN, "B: A REPAIR HOLDS THE ROOM'S ONE RANK TURN", "RED"],   // a Repair outside the turn: a rank change lands between its creates
  ["NA11", [[ROOM, "    if (busy) return { ok: false, reason: busy.spaceId === spaceId ? \"already-repairing\" : \"repair-running\", running: busy };\n", ""]],
    GN, "B: ONE REPAIR AT A TIME", "RED"],   // two Repairs at once
  ["NA12", [[ROOM, "        _refused[spaceId] = { words: _refusalWords(why), why: why };\n", ""]],
    GN, "A: AN OPENING REFUSED", "RED"],   // a refused opening said only in the log (HANDOFF's owed item back)
  ["NA13", [[ROOM, "    if (_refused[spaceId]) { delete _refused[spaceId]; }\n", ""]],
    GN, "A: UNTIL IT IS NEXT OPENED", "RED"],   // a refusal said after the room was opened again
  ["NA14", [[SC, "    if (attn.length) {\n      list.appendChild(H.el(\"h3\", { class: \"room-section-title\", text: \"Needs attention\" }));", "    if (false) {\n      list.appendChild(H.el(\"h3\", { class: \"room-section-title\", text: \"Needs attention\" }));"]],
    GN, "C: \"NEEDS ATTENTION\" FIRST", "RED"],   // no section: a room with something wrong looks as today
  ["NA15", [[SC, "    section(\"Your rooms\", owned.filter((r) => !inAttn[r.spaceId]), listed(true));", "    section(\"Your rooms\", owned, listed(true));"]],
    GN, "C: A ROOM LISTED THERE IS NOT LISTED AGAIN BELOW", "RED"],   // a room listed twice
  ["NA16", [[SC, "      if (a.kind === \"missing\" && a.repair === \"yes\" && !running && !(job && job.state === \"failed\")) {", "      if (!_roomsLocked && a.kind === \"missing\" && a.repair === \"yes\" && !running && !(job && job.state === \"failed\")) {"]],
    GN, "C: LOCKED — Repair, live", "RED"],   // Repair behind the lock (it only adds)
  ["NA17", [[SC, "      if (!_roomsLocked && !leave && _armedLeave !== a.spaceId && !running) acts.push(leaveButton(room));", "      if (!leave && _armedLeave !== a.spaceId && !running) acts.push(leaveButton(room));"]],
    GN, "C: LOCKED — Repair, live (it only adds); no Leave", "RED"],   // Leave outside the lock
  ["NA18", [[SC, "          H.el(\"span\", { class: \"dm-head-actions\" }, [again])]));", "          H.el(\"span\", { class: \"dm-head-actions\" }, [])]));"]],
    GN, "C: A FAILURE", "RED"],   // a failed Repair with no Repair again
  ["NA19", [[SC, "        lines.push(H.el(\"div\", { class: \"room-leave-track\" }, [fill]));\n", ""]],
    GN, "C: A REPAIR RUNNING", "RED"],   // progress with no bar
  ["NA20", [[SC, "      const lines = [H.el(\"p\", { class: \"room-invite-note room-attn-why\", text: a.words })];", "      const lines = [H.el(\"p\", { class: \"muted room-attn-why\", text: a.words })];"]],
    GN, "C: A ROW — the room's name, one plain reason under it in amber", "RED"],   // the reason in grey, not amber
  ["NA21", [[SC, "      if (a.kind === \"missing\" && a.repair === \"owner\") lines.push(", "      if (false) lines.push("]],
    GN, "C: WHERE THIS ACCOUNT MAY NOT", "RED"],   // nothing said where this account may not repair
  ["NA22", [[SC, "        if (busy && busy.spaceId !== a.spaceId) { b.disabled = true; b.title = \"Waits for: repairing \" + busy.name; }\n", ""]],
    GN, "C: ANOTHER ROW'S REPAIR WAITS", "RED"],   // a second Repair offered while one runs
  ["NA23", [[ROOM, "      if (r && !fixable && !job) { out.push(Object.assign(base, { kind: \"refused\", words: r.words })); continue; }\n", ""]],
    GN, "A: and the room is in \"Needs attention\" with it", "RED"],   // a refusal's own words hidden behind the reading's
  ["NA24", [[ROOM, "          (n === 1 && !upgrades ? \"Its \" + _attnLabel(miss[0].key) + \" is missing.\" :", "          (false ? \"\" :"]],
    GN, "A: A MISSING CREATION CHANNEL", "RED"],   // a missing creation channel said as an upgrade's
  ["NA25", [[ROOM, "if (!s || s.room !== c.spaceId) return; _upStep = null;", "if (!s) return; _upStep = null;"]],
    GN, "B: A ROOM OPENED AND LEFT DURING A REPAIR DOES NOT STOP IT", "RED"],   // leaving a room opened during a lobby Repair stops the Repair's turn
  // ── JOB 3: other Matrix rooms (`features/room.js` `otherRooms`, `otherRoomWords`, `quietWords`, `leaveOtherRooms`; `matrixbridge.js`
  //    `leaveRooms`, `newestStampHeld`, the one leave's pacing; `ui/screens.js` `otherLine`), held by `check-other-rooms` ──
  ["OR1", [[ROOM, "      if (isDDJPRoom(c) || _ddjpFields(c)) continue;\n", ""]],
    GO, "A: NONE OF WHAT DDJP MAKES IS LISTED", "RED"],   // DDJP's own rooms offered as junk
  ["OR2", [[ROOM, "    try { for (const id of (MatrixAccount.dmRoomIds() || [])) add(id); } catch (e) { /* none read */ }\n", ""]],
    GO, "A: NEVER A DM (MATRIX'S OWN LIST)", "RED"],   // a DM offered as junk
  ["OR3", [[ROOM, "    try { if (typeof Chat !== \"undefined\" && Chat.conversations) for (const c of (Chat.conversations() || [])) {", "    try { if (false) for (const c of (Chat.conversations() || [])) {"]],
    GO, "A: NEVER A CONVERSATION MESSAGES LISTS", "RED"],   // a conversation offered as junk
  ["OR4", [[ROOM, "    for (const k of Object.keys(_joinJobs)) add(k);\n", ""]],
    GO, "A: NEVER A ROOM IN A JOIN JOB", "RED"],   // a room Join Room is still deciding about offered as junk
  ["OR5", [[ROOM, "      const c = MatrixBridge.getCreateContent(id);\n      if (!c || typeof c !== \"object\") continue;", "      const c = MatrixBridge.getCreateContent(id) || {};\n      if (!c || typeof c !== \"object\") continue;"]],
    GO, "A: NEVER A ROOM WHOSE CREATION RECORD CANNOT BE READ", "RED"],   // a room nothing can tell about offered as junk
  ["OR6", [[ROOM, "      if (ms !== \"join\") continue;\n      const c = MatrixBridge.getCreateContent(id);", "      if (ms !== \"join\" && ms !== \"invite\") continue;\n      const c = MatrixBridge.getCreateContent(id);"]],
    GO, "A: NEVER AN INVITE FROM ELSEWHERE", "RED"],   // an invite offered as junk
  ["OR7", [[ROOM, " || ((a.last || 0) - (b.last || 0)) || ", " || ((b.last || 0) - (a.last || 0)) || "]],
    GO, "A: QUIETEST FIRST", "RED"],   // the busiest first
  ["OR8", [[ROOM, "((a.last === null) - (b.last === null))", "((b.last === null) - (a.last === null))"]],
    GO, "A: QUIETEST FIRST", "RED"],   // unknown activity first
  ["OR9", [[ROOM, "    try { now = MatrixBridge.newestStampHeld(); } catch (e) { now = null; }", "    try { now = Date.now(); } catch (e) { now = null; }"]],
    GO, "A: \"now\" is the newest server time", "RED"],   // the device's clock against server stamps
  ["OR10", [[ROOM, "r.people <= 1 ? \"Just you\"", "r.people < 1 ? \"Just you\""]],
    GO, "A: alone", "RED"],   // a room with nobody else said as "1 people"
  ["OR11", [[ROOM, "    if (days >= 30) return \"quiet for \" + n(Math.floor(days / 30), \"month\");", "    if (days >= 300) return \"quiet for \" + n(Math.floor(days / 30), \"month\");"]],
    GO, "A: a group", "RED"],   // a room quiet for months said in weeks
  ["OR12", [[MB, "    const gap = _sendPace.wait();\n    if (gap > 0) await _paceCounted((ms) => turn.sleep(ms, \"pace\"))(gap);", "    const gap = (kind === \"leave\") ? 0 : _sendPace.wait();\n    if (gap > 0) await _paceCounted((ms) => turn.sleep(ms, \"pace\"))(gap);"]],
    GO, "B: PACED", "RED"],   // the one leave's sends in a burst (re-anchored at `ddjp_697`: every join and leave is paced at the door's sender, `sendMembership`)
  // OR13 RETIRED AT `ddjp_697`: it sent a room's own leave, last, past the pacer — through the leave's `paced` option, which went
  // when every join and leave came to the one door (`sendMembership`, the owner's second correction). Sent past the door instead,
  // the 19-channel leave still shows its 19 gaps, so `check-other-rooms` B cannot tell; a leave unpaced is OR12's, at the door.
  ["OR14", [[MB, "      if (_is429(e)) _sendPace.pushedBack(\"membership\", _retryAfterMs(e));   // the server pushed back: the sends that follow come further apart\n", ""]],   // re-anchored at `ddjp_697`: every join and leave is paced at the door's sender
    GO, "B: A PUSH-BACK WIDENS THE GAP", "RED"],   // a push-back heard and the leaves' pace unchanged
  // OR15 RETIRED AT `ddjp_696`: it held "a space is left alone", which the owner's JOB 1 reverses — a space is left WITH its rooms,
  // held by `mutate-j144-leave-everything`'s SP rows.
  ["OR16", [[SC, "            all.onclick = (ev) => { stop(ev); if (_roomsLocked) return; _othersArmed = true; redraw(); };", "            all.onclick = (ev) => { stop(ev); if (_roomsLocked) return; Room.leaveOtherRooms(ids, { all: true }); };"]],
    GO, "C: LEAVE ALL ASKS ONCE", "RED"],   // Leave all with no question
  ["OR17", [[SC, "            if (!_roomsLocked && !rj && !job && !asking) {", "            if (!rj && !job && !asking) {"]],   // re-anchored at `ddjp_696` (a space's question)
    GO, "C: OPENED, LOCKED", "RED"],   // a row's Leave outside the lock
  ["OR18", [[SC, " _othersOpen = false; _othersArmed = false; _othersAsk = null; }   // J139", " _othersArmed = false; _othersAsk = null; }   // J139"]],   // re-anchored at `ddjp_696`
    GO, "C: CLOSED AGAIN WHEN THE ROOM LIST IS LEFT", "RED"],   // the line left open across screens
  ["OR19", [[SC, "        if (!n && !job) return H.el(\"span\", { class: \"room-leftover-none\" });\n        const ids = now", "        const ids = now"],
    [SC, "      if (!othersCount && !(Room.leaveJob && Room.leaveJob(key))) return;\n      const entry = { el: null, build: build };", "      const entry = { el: null, build: build };"]],
    GO, "C: SHOWN ONLY WHEN N > 0", "RED"],   // a line saying 0
  ["OR20", [[SC, "    _renderRoomsLock(owned.length + joined.length + loCount + othersCount > 0);", "    _renderRoomsLock(owned.length + joined.length + loCount > 0);"]],
    GO, "C: WITH NO DDJP ROOM BUT OTHER ROOMS", "RED"],   // only other rooms: no lock, so no Leave ever
  ["OR21", [[SC, "Quietest first. Not listed: DDJP rooms, and your chats and invites (those are in Messages).", "Quietest first."]],
    GO, "C: UNDER IT", "RED"],   // what is left out not said
  ["OR22", [[SC, "    _redrawRoomRow(String(spaceId).indexOf(others + \":\") === 0 ? others : spaceId);", "    _redrawRoomRow(spaceId);"]],
    GO, "C: ONE ROW'S LEAVE THAT FAILS", "RED"],   // one row's leave drawn nowhere until the list is redrawn
  ["OR23", [[SC, "text: \"Other Matrix rooms on this account (not DDJP): \" + n", "text: \"Other rooms: \" + n"]],
    GO, "C: ONE LINE, LAST IN THE ROOM LIST", "RED"],   // the line's words
  ["OR24", [[PAGE, "    .room-other-list { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; margin-top: 4px; }", "    .room-other-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }"]],
    GO, "C: EVERY ROOM, IN A LIST THAT SCROLLS", "RED"],   // a long list pushing the page
  ["OR25", [[SC, "      const otherWords = { running: (j) => \"Leaving \" + j.done + \" of \" + j.total + \"…\" };", "      const otherWords = {};"]],
    GO, "C: ITS PROGRESS IN THE LINE", "RED"],   // the leave counted in "channels"
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[ROOM, "  const DAY_MS = 86400000;", "  const DAY_MS = 24 * 60 * 60 * 1000;"]],
    GO, "", "GREEN"],   // the same day, spelt another way
  ["G2", [[MB, "      batches.sort((x, y) => x - y);", "      batches.sort((x, y) => (x < y ? -1 : (x > y ? 1 : 0)));"]],
    GN, "", "GREEN"],   // the same order, spelt another way
  ["G4", [[MB, "    const missing = unreadable ? [] : plan.filter(", "    const missing = plan.filter("]],
    GN, "", "GREEN"],   // MEASURED: the bridge's alone is held by the room's `readable` test (and the Repair's own), NA2 drops both
  ["G3", [[ROOM, "const mine = had || _upLeft || !_upStep;", "const mine = true;"]],
    GN, "", "GREEN"],   // MEASURED: while the bot step finds every level in place (JOB 1's copy) no run of the transport is in flight to stop — the scoping guards the window a failed copy would open
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
      const h = J.open("mutate-j143-rooms-trust:" + id, file);   // journalled BEFORE the write
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
