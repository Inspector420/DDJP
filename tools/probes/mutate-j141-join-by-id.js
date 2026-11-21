// tools/probes/mutate-j141-join-by-id.js
// SUBJECT: J141's owed item, built at `ddjp_690` — Join Room by a room's ID is like accepting an invite (the owner's: "as if you
// accepted an invite maybe?"): `Room.joinById` (`features/room.js`) joins the room only, in its turn at the door
// (`MatrixBridge.joinSpace`, which names a refusal), and opens nothing; the room list (`ui/screens.js`) shows it under "Joining" at
// once, its wait, its failure, an empty box's note, and Join Room not greyed; `app.js` keeps no handler and no window for it.
// And (`ddjp_691`, the owner's: "ok maybe reject non ddjp rooms") a room that is not a DDJP room, by the list's own test
// (`Room.isDDJPRoom`), is left again in the same turn (`joinSpace`'s `keep`), its row saying so — naming the room when that leave
// fails, saying it could not be read when its creation record never came — and a room this account was in before is never left
// (rows JR1–JR14 — JR13 and JR14, and JR11 re-anchored, for the plain words of `ddjp_692`; JB1, JB2, JB4 and JB5 re-anchored on the rewritten code). Held by `check-join-by-id`. One row per way it could go wrong, each naming the failure it must cause; the controls change
// nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j141-join-by-id.js            every row
//   node tools/probes/mutate-j141-join-by-id.js JB1 JB3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js";
const MB = "backends/backend1/matrixbridge.js";
const SC = "ui/screens.js";
const APP = "app.js";
const G = "check-join-by-id";
const DONE = "    const nm = (hit && hit.name) || id;\n    Logger.info(\"Room: joined \"";
const ONWAIT = "await MatrixBridge.joinSpace(id, { verb: \"joining\", keep: isDDJPRoom, onWait: (h) => { job.state = \"waiting\"; job.waitsFor = h; _joinJobTold(); } });";
const TURN = "if (job.state === \"waiting\" && s && s.key === id)";
const KEEP = "      job.why = _joinWhy(e);\n";
const NOTDDJP = "        return { ok: false, reason: \"not-ddjp\", leftAgain: job.leftAgain };";
const FORGET = "    for (const k of Object.keys(_joinJobs)) if (_joinJobs[k].state === \"failed\") delete _joinJobs[k];";
const REFUSED = "        if (r.refused) err.refused = true;\n";
const SECTION = "      for (const j of joining) list.appendChild(_joiningRow(j));\n";
const HEARS = "    if (Room.onJoinJob) Room.onJoinJob(_onJoinJob);";
const GATES = "    for (const b of _gated) _applyGate(b, d);\n";
const WAITWORDS = "text: (j.state === \"waiting\" && j.waitsFor) ? \"Waits for: \" + j.waitsFor : \"Joining\\u2026\" });";
const CLEAR = "      if (r && r.ok && box && String(box.value || \"\").trim() === id) box.value = \"\";";
const EMPTY = "    if (!id) { _joinNote = \"Paste a Space ID to join.\"; renderRoomList(Room.scanDDJPRooms());";
const WHY = "\"Couldn't join (\" + (j.why || \"failed\") + \").\"";
const APPNOTE = "  // Join Room (by a room's ID) is the room list's own";
const JOBS = "  function joinJobs() { return Object.keys(_joinJobs).map((k) => Object.assign({}, _joinJobs[k])); }";
// `ddjp_691`, JOB 1 — the rejection:
const ASKS = "            if (!j.joined || !keepOf) return j;";
const LEAVE = "            const l = await _joinWithRetry(spaceId, null, false, { kind: \"leave\", turn: t });";
const THROWN = "      if (r.rejected) throw _rejected(spaceId, r);";
const BEFORE = "      if (!_keeps(o, c)) throw _rejected(spaceId, { unreadable: c === null, leftAgain: null });";
const LEFTAGAIN = "leftAgain: !!l.left,";
const KEEPS = "function _keeps(o, c) { try { return c !== null && o.keep(c) === true; } catch (e) { return false; } }";
const POLL = "const CREATE_WAIT_MS = 8000, CREATE_POLL_MS = 150;";
const NAMED = "job.name = e.roomName || id;";
const TEST = "createContent && typeof createContent === \"object\" && createContent.type === \"m.space\" && Backends.resolveMode(createContent)";
const ASKED = "keep: isDDJPRoom, ";
const LEAVEWORDS = "(j.leftAgain === false ? ";
// Re-anchored at `ddjp_692` (the owner's plainer words): the unreadable room's two texts.
const UNREAD = "(j.unreadable ? \"Couldn't check this room in time, so the app left it. Try again.\" : \"That isn't a DDJP room.\"));";
const UNREADFAIL = "(j.unreadable ? \"Couldn't check this room in time, and leaving it again failed: \" : ";
const NOTWORDS = "\"That isn't a DDJP room.\"));";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["JB1", [[RM, DONE, "    const nm = (hit && hit.name) || id;\n    await join(id);\n    Logger.info(\"Room: joined \""]],
    G, "A: and it is NOT OPENED", "RED"],   // joined and then opened, as 689's Join Room did
  ["JB2", [[RM, ONWAIT, "await MatrixBridge.joinSpace(id, { verb: \"joining\", keep: isDDJPRoom });"]],
    G, "B: WITH THE DOOR BUSY IT WAITS ITS TURN, saying what for", "RED"],   // its wait not told: the row says "Joining…" while it waits
  ["JB3", [[RM, TURN, "if (false)"]],
    G, "B: LET GO, IT IS JOINING, THEN DONE", "RED"],   // its turn not heard: it says it waits while it joins
  ["JB4", [[RM, KEEP, "      delete _joinJobs[id]; job.why = _joinWhy(e);\n"]],
    G, "C: A REFUSAL IS NAMED", "RED"],   // a failure not kept: the row vanishes with nothing said
  ["JB5", [[RM, NOTDDJP, "        delete _joinJobs[id]; _joinJobTold(); return { ok: true, spaceId: id };"]],
    G, "C: A ROOM THAT IS NOT A DDJP ROOM", "RED"],   // RE-ANCHORED AT `ddjp_691` (the not-DDJP branch is the rejection now): answered as done, a row that vanishes into nothing
  ["JB6", [[RM, FORGET, ""]],
    G, "C: A NEW JOIN ROOM FORGETS THE LAST FAILURES", "RED"],   // old failures pile up
  ["JB7", [[MB, REFUSED, ""]],
    G, "C: A REFUSAL IS NAMED, with its code", "RED"],   // a refusal not marked: read as retries that gave up
  ["JB8", [[SC, SECTION, ""]],
    G, "D: AT ONCE, A \"Joining\" SECTION AT THE TOP OF THE LIST SHOWS THE PASTED ID", "RED"],   // the section's rows not drawn
  ["JB9", [[SC, HEARS, ""]],
    G, "D: AT ONCE, A \"Joining\" SECTION AT THE TOP OF THE LIST SHOWS THE PASTED ID", "RED"],   // the list does not hear the job: nothing at once
  ["JB10", [[SC, GATES, GATES + "    const jb = (typeof document !== \"undefined\") ? document.getElementById(\"btn-join-room\") : null;\n    if (jb) { if (jb._gateOwn === undefined) { jb._gateOwn = false; jb._gateTitle = jb.title || \"\"; } _applyGate(jb, d); }\n"]],
    G, "D: WITH THE DOOR BUSY, JOIN ROOM IS NOT GREYED", "RED"],   // 689's greying back: the wait can never be seen
  ["JB11", [[SC, WAITWORDS, "text: \"Joining\\u2026\" });"]],
    G, "D: THE ROW SAYS \"Waits for: leaving Room Z\"", "RED"],   // the wait not shown
  ["JB12", [[SC, CLEAR, "      if (box) box.value = \"\";"]],
    G, "D: and THE ID STAYS IN THE BOX", "RED"],   // the box emptied on a failure too
  ["JB13", [[SC, EMPTY, "    if (!id) { window.alert(\"Paste a Space ID\"); renderRoomList(Room.scanDDJPRooms());"]],
    G, "D: AN EMPTY BOX GETS A NOTE", "RED"],   // a window for an empty box, as 689's
  ["JB14", [[APP, APPNOTE, "  document.getElementById(\"btn-join-room\").addEventListener(\"click\", async () => { alert(\"Join failed\"); });\n" + APPNOTE]],
    G, "E: `app.js` wires nothing to Join Room", "RED"],   // a second handler with a window, in the app shell
  ["JB15", [[SC, WHY, "\"Couldn't join.\""]],
    G, "D: A FAILURE IS SAID IN THE LIST", "RED"],   // a failure with no reason
  // ── `ddjp_691`, JOB 1 (the owner's: "ok maybe reject non ddjp rooms"): joined, read by the list's test, left again in the same turn ──
  ["JR1", [[MB, ASKS, "            if (!j.joined || true) return j;"]],
    G, "C: A ROOM THAT IS NOT A DDJP ROOM IS REJECTED", "RED"],   // the keep test never asked: 690's "joined, not listed"
  ["JR2", [[MB, LEAVE, "            const l = { left: true };"]],
    G, "C: A ROOM THAT IS NOT A DDJP ROOM IS REJECTED", "RED"],   // said left again, and never left: it stays joined
  ["JR3", [[MB, LEAVE, "            const l = { left: true };"], [MB, THROWN, "      if (r.rejected) { await inTurn(\"leaving \" + _roomName(spaceId), { key: spaceId }, (t) => _joinWithRetry(spaceId, null, false, { kind: \"leave\", turn: t })); throw _rejected(spaceId, r); }"]],
    G, "F: JOINED, READ, AND LEFT AGAIN IN THE SAME TURN", "RED"],   // left in a turn of its own: an act asked meanwhile goes between
  ["JR4", [[MB, BEFORE, "      if (!_keeps(o, c)) { await inTurn(\"leaving \" + _roomName(spaceId), { key: spaceId }, (t) => _joinWithRetry(spaceId, null, false, { kind: \"leave\", turn: t })); throw _rejected(spaceId, { unreadable: c === null, leftAgain: true }); }"]],
    G, "F: A ROOM THIS ACCOUNT WAS ALREADY IN", "RED"],   // a room this account was already in left by a Join Room
  ["JR5", [[MB, LEFTAGAIN, "leftAgain: true,"]],
    G, "F: A LEAVE THAT FAILS IS SAID", "RED"],   // a failed leave reported as left: the room stays joined, unsaid
  ["JR6", [[MB, KEEPS, "function _keeps(o, c) { try { return c === null || o.keep(c) === true; } catch (e) { return false; } }"]],
    G, "F: A CREATION RECORD THAT NEVER ARRIVES", "RED"],   // a record never read is kept: an unknown room stays joined
  ["JR7", [[RM, NAMED, "job.name = id;"]],
    G, "F: A LEAVE THAT FAILS IS SAID, NAMING THE ROOM", "RED"],   // the room not named by its name
  ["JR8", [[RM, TEST, "createContent && typeof createContent === \"object\" && Backends.resolveMode(createContent)"]],
    G, "F: the list's test", "RED"],   // a room that is not a space passes
  ["JR9", [[RM, ASKED, "keep: (c) => !!(c && c.type === \"m.space\"), "]],
    G, "C: A ROOM THAT IS NOT A DDJP ROOM IS REJECTED", "RED"],   // Join Room asks its own test, not the list's: any space kept
  ["JR10", [[SC, LEAVEWORDS, "(false ? "]],
    G, "F: ITS ROW SAYS SO AND NAMES THE ROOM", "RED"],   // a failed leave said as a clean rejection
  ["JR11", [[SC, UNREAD, "\"That isn't a DDJP room.\");"]],
    G, "F: AN UNREADABLE ONE'S ROW", "RED"],   // an unread record said as "not a DDJP room"
  ["JR13", [[SC, UNREADFAIL, "(false ? \"\" : "]],
    G, "F: AN UNREADABLE ONE WHOSE LEAVE FAILED", "RED"],   // `ddjp_692`: an unread record whose leave failed said as "not a DDJP room"
  ["JR14", [[SC, UNREAD, "(j.unreadable ? \"Couldn't read that room's creation record, so it was left again.\" : \"That isn't a DDJP room.\"));"]],
    G, "F: AN UNREADABLE ONE'S ROW", "RED"],   // `ddjp_692`: 691's words back
  ["JR12", [[SC, NOTWORDS, "\"Joined, but it is not a DDJP room, so it is not listed.\"));"]],
    G, "D: A ROOM THAT IS NOT A DDJP ROOM", "RED"],   // 690's words back
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[RM, FORGET, "    Object.keys(_joinJobs).filter((k) => _joinJobs[k].state === \"failed\").forEach((k) => { delete _joinJobs[k]; });"]], G, "", "GREEN"],   // the same forgetting, spelt another way
  ["G2", [[RM, JOBS, "  function joinJobs() { return Object.keys(_joinJobs).map((k) => JSON.parse(JSON.stringify(_joinJobs[k]))); }"]], G, "", "GREEN"],   // the same copies, made another way
  ["G3", [[MB, POLL, "const CREATE_WAIT_MS = 8000, CREATE_POLL_MS = 100;"]], G, "", "GREEN"],   // the record read a little more often (`ddjp_691`)
  ["G4", [[MB, KEEPS, "function _keeps(o, c) { try { return c !== null && Boolean(o.keep(c)); } catch (e) { return false; } }"]], G, "", "GREEN"],   // the list's test answers a boolean: the same keep
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
      const h = J.open("mutate-j141-join-by-id:" + id, file);   // journalled BEFORE the write
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
