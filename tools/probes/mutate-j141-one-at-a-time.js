// tools/probes/mutate-j141-one-at-a-time.js
// SUBJECT: J141 and the owner's rule for `ddjp_689` ("yes but joinaccept and leave one at a time") — the one join step joining one
// channel at a time and telling its progress (`backends/backend1/matrixbridge.js` `_joinPassOnce`), the opening's card
// (`features/room.js` `_openRoom`, `ui/screens.js` `showRoomLoading`), and the transport's door every join and leave goes through
// (`inTurn`, `sendMembership`, `recheckTurns`; `backends/backend1/matrixaccount.js`'s chat invites; the room's `wanted`s), with
// the buttons that show it (`ui/screens.js`, `ui/chat.js`). Held by `check-join-progress` and `check-one-at-a-time`. One row per
// way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j141-one-at-a-time.js            every row
//   node tools/probes/mutate-j141-one-at-a-time.js OT1 OT8    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", MA = "backends/backend1/matrixaccount.js", RM = "features/room.js", SC = "ui/screens.js", CH = "ui/chat.js";
const JP = "check-join-progress", OT = "check-one-at-a-time";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── ONE CHANNEL AT A TIME, AND THE OPENING'S PROGRESS (`check-join-progress`) ──
  ["OT1", [[MB, "    for (at = 0; at < ids.length; at++) { results.push(await one(ids[at])); answered++; tell(); }",
    "    results.push(...(await Promise.all(ids.map(async (id) => { const x = await one(id); answered++; tell(); return x; }))));"]],
    JP, "A: AT THE OPENING, ONE CHANNEL AT A TIME", "RED"],   // the pass joins every channel at once again (688's)
  ["OT2", [[MB, "results.push(await one(ids[at])); answered++; tell(); }", "results.push(await one(ids[at])); answered++; }"]],
    JP, "B: \"Joining channels\" 0 OF 7, THEN ONE MORE AS EACH CHANNEL ANSWERS", "RED"],   // no word as each channel answers
  ["OT3", [[RM, "        if (p.retrying) for (const id of (p.notYet || [])) notYet.add(id);\n", ""]],
    JP, "C: A CHANNEL IN ITS BACKOFF, THE ONES AFTER IT NOT TRIED", "RED"],   // the opening waits for the channels behind a retry
  ["OT4", [[RM, "    await turnCame;\n", ""]],
    JP, "D: AND ITS WAIT FOR THE CHANNELS COUNTS FROM ITS TURN", "RED"],   // the cap runs while the opening waits its turn: no channels
  ["OT5", [[SC, "        fill.className = \"room-loading-bar-fill steps\";", "        fill.className = \"room-loading-bar-fill\";"]],
    JP, "E: over a bar a third full that does not slide", "RED"],   // the count over the endless sliding bar
  ["OT6", [[SC, "if (card && card.progress && _pendingJoinId === room.spaceId) card.progress(p);", "if (card && card.progress) card.progress(p);"]],
    JP, "E: an opening the person has left draws nothing", "RED"],   // a left opening still draws on its card
  ["OT7", [[RM, "    const say = (p) => { if (loading && p.step !== \"loading\") return; ", "    const say = (p) => { "]],
    JP, "C: and the card, already loading, hears none of it", "RED"],   // a pass going on after the opening talks over "Loading…"
  // ── THE DOOR (`check-one-at-a-time`) ──
  ["OT8", [[MB, "    while (!_door.held && _door.queue.length) {", "    while (_door.queue.length) {"]],
    OT, "A: WHILE ONE RUNS THE OTHER WAITS", "RED"],   // the door lets the next one through while one runs
  ["OT9", [[MB, "    if (outside()) {\n      Logger.error(", "    if (false) {\n      Logger.error("]],   // re-anchored at `ddjp_697`: the door's sender paces its sends, its turn read by `outside()`
    OT, "C: and it REFUSES one asked for outside its turn", "RED"],   // the one sender sends for anyone
  ["OT10", [[RM, "    _recheckTurns(\"its opening was cancelled\");\n", ""]],
    OT, "D: THE LOADING CARD'S BACK FREES ITS TURN AT ONCE", "RED"],   // a cancelled opening's retry holds every other act
  ["OT11", [[RM, "{ wanted: () => runningRoom() === sid && (_opening === null || _opening === sid), ifWouldJoin", "{ wanted: () => runningRoom() === sid, ifWouldJoin"]],
    OT, "D: AN OPENING DOES NOT WAIT FOR THE RUNNING ROOM'S RETRY", "RED"],   // an opening waits behind the running room's backoff
  ["OT12", [[MB, "    for (const t of _door.queue) if (!_stillWanted(t)) drop.push(t);\n", ""]],
    OT, "D: the cancelled opening's waiting turn LEAVES THE QUEUE at once", "RED"],   // a cancelled turn kept in the queue
  ["OT13", [[MB, "      if (!_stillWanted(t)) { t.live = false; t.over = true; t.grant(false); continue; }\n", ""]],
    OT, "D: A TURN NOBODY WANTS ANY MORE IS NEVER GIVEN", "RED"],   // a turn given to an act nobody wants
  ["OT14", [[RM, "        const r = await MatrixBridge.declineInvite(id, { turn });", "        const r = await MatrixBridge.declineInvite(id);"]],
    OT, "A: then the Decline goes, in its turn", "RED"],   // a Decline asks for a second turn inside its own: it waits on itself (a deadlock)
  ["OT15", [[MA, "    await B1MatrixBridge.inTurn(\"accepting a chat invite\", { key: roomId }, (t) => B1MatrixBridge.sendMembership(\"join\", roomId, t));",
    "    await _c().joinRoom(roomId);"]],
    OT, "C: THE ONE SENDER", "RED"],   // a chat invite's join around the door (688's)
  // ── THE BUTTONS (`check-one-at-a-time` E) ──
  ["OT16", [[SC, "    btn.disabled = !!btn._gateOwn || busy;", "    btn.disabled = !!btn._gateOwn;"]],
    OT, "E: WHILE ONE RUNS, EVERY ACCEPT, DECLINE, OPEN, LEAVE AND DISCARD IS GREYED", "RED"],   // the buttons stay live while one runs
  ["OT17", [[CH, "      acc.disabled = g.own || busy; ref.disabled = g.own || busy;", "      acc.disabled = g.own; ref.disabled = g.own;"]],
    OT, "E: A CHAT INVITE'S ACCEPT AND REFUSE WAIT TOO", "RED"],   // a chat invite's buttons stay live
  ["OT18", [[SC, "    if (Room.onDoorChange) Room.onDoorChange(() => _reflectDoor());\n", ""]],
    OT, "E: APPLIED — the room list hears the door", "RED"],   // the door's changes reach no button
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[SC, "fill.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 100) + \"%\";", "fill.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 99) + \"%\";"]], JP, "", "GREEN"],   // no row opens a room listing nothing
  // G2 re-anchored at `ddjp_701`: `_roomName` reads the name through the transport's room-fact read (`roomName`); the same control.
  ["G2", [[MB, "    return roomName(id) || _short(id);   // the table's `name` (`ddjp_701`)", "    return roomName(id) || _short(String(id));   // the table's `name` (`ddjp_701`)"]], OT, "", "GREEN"],   // the same name
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
      const h = J.open("mutate-j141-one-at-a-time:" + id, file);   // journalled BEFORE the write
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
