#!/usr/bin/env node
// tests/check-join-by-id.js
// SUBJECT: features/room.js, backends/backend1/matrixbridge.js, ui/screens.js, app.js
//
// WALL: JOIN ROOM, BY A ROOM'S ID, IS LIKE ACCEPTING AN INVITE (the owner's, `ddjp_690`). Found at `ddjp_689`: "Join Room by
// Space ID opens with no card" (it joined and opened the room at once, with `alert()` for an empty box and for a failure). Asked
// whether it should show the opening's card and count, his words: "well im thinking the room could appear int he list and show
// progress isntead? as if you accepted an invite maybe?". Read plainly: Join Room joins the room only, as Accept does — its
// channels are joined when it is first opened, with the opening's count — in its turn at the one-at-a-time door; at once a
// "Joining" section at the top of the list shows the pasted ID with a greyed "Joining…", or "Waits for: …" while the door is
// busy; done, the room is in the list under its name and is not opened; a failure is said in the list and the ID stays in the
// box; an empty box gets a note; no window.
//
// Driven on the REAL modules (`features/room.js`, both engines, the bridge and its door) against the homeserver MODEL
// (`tests/_inviteworld.js`), and the REAL ui/ files (`tests/_screen-world.js`) drawn over that same real room:
//   A  THE ROOM ONLY: a public room this account was never invited to, joined by its ID — the space joined and no channel, the
//      room not opened, and `Room.scanDDJPRooms` lists it under its name (the statement's question: it does); an invited room
//      the same. Then its first opening joins its channels with the opening's count ("joining" N of M, then "loading").
//   B  IN ITS TURN: with the door held by another act, the join sends nothing and says what it waits for; let go, it is joining,
//      then done; the log says both.
//   C  FAILURES, NAMED: a refusal and its code; retries that gave up, and the code; a room that is not a DDJP room — rejected, left
//      again, nothing stays joined (`ddjp_691`); an empty ID sends nothing; a new Join Room forgets the last failures.
//   D  THE ROOM LIST (the screen world over the real room): an empty box gets a note at the top and no window; a pasted ID shows
//      AT ONCE under "Joining", at the top, with a greyed "Joining…"; done, the room is under "Joined rooms" by its name, the
//      Joining section gone, the box cleared, nothing opened; with the door busy Join Room is NOT greyed and the row says "Waits
//      for: …", then "Joining…"; a failure's row says why and the ID stays in the box; a not-DDJP room's row says "That isn't a
//      DDJP room.".
//   F  REJECT A ROOM THAT IS NOT A DDJP ROOM (the owner's, `ddjp_691`: "ok maybe reject non ddjp rooms"): joined, its creation record
//      read by the list's own test (`Room.isDDJPRoom`), and left again IN THE SAME TURN — an act asked meanwhile goes only after the
//      leave; a leave that fails names the room on the row and the room stays; a room this account was already in is asked and
//      never left, nothing sent; a creation record that never arrives is left again too, the row saying it could not be read; a
//      DDJP room joined the same way is kept (part A).
//   E  NO WINDOW IN THIS PATH: `app.js` wires nothing to Join Room and calls no `alert` for it; the room list's handler has none.
// RED FIRST ON 689: there Join Room is `app.js`'s and opens the room, with `alert()`, and `Room.joinById` does not exist — every
// part refuses by name.
"use strict";
const fs = require("fs");
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ROOT = path.join(__dirname, "..");
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[join-by-id] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[join-by-id] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
const later = async (cond, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (cond()) return true; await waitMs(20); } return cond(); };

// A DDJP room this account is NOT in: public (anyone can join) unless `o.invite` (invite-only, this account invited) or
// `o.closed` (invite-only, no invite).
function room(hs, sid, o) {
  o = o || {};
  const R = hs.ddjpRoom(sid, { name: o.name });
  hs.rooms[sid].joinRule = (o.invite || o.closed) ? "invite" : "public";
  if (o.invite) hs.invite(sid, ME, { from: OWNER });
  return R;
}
// A Matrix space that declares no DDJP engine, public, listing one child (so the room's listing is read at once).
function plainSpace(hs, sid) {
  hs.room("!child-" + sid.slice(1), { name: "child", content: { room_version: "12" } });
  hs.room(sid, { name: "Plain", content: { room_version: "12", type: "m.space" }, members: { [OWNER]: "join" }, joinRule: "public", children: ["!child-" + sid.slice(1)] });
}
const applied = (w) => typeof w.Room.joinById === "function" && typeof w.Room.joinJobs === "function";
// HOLD THE DOOR: another act takes the turn and keeps it until `release()`.
function holdDoor(w, what) {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const done = w.MB.inTurn(what, { key: "!z:hs" }, () => gate);
  return { release: async () => { release(); await done.catch(() => {}); } };
}

// ── A — THE ROOM ONLY ──────────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const hs = W.homeserver();
  const P = room(hs, "!p:hs", { name: "Room P" });
  room(hs, "!i:hs", { name: "Room I", invite: true });
  const w = W.inviteWorld({ hs });
  ok(applied(w), "A: APPLIED — `Room.joinById` and `Room.joinJobs` exist (Join Room by a room's ID)", typeof w.Room.joinById);
  if (!applied(w)) return;
  ok(hs.rooms["!p:hs"].members[ME] === undefined && !hs.rooms["!p:hs"].inviteMeta[ME], "A PREMISE — this account is not in Room P and was never invited to it");
  const p = w.Room.joinById("  !p:hs ");
  const during = w.Room.joinJobs();
  ok(during.length === 1 && during[0].spaceId === "!p:hs" && during[0].state === "joining", "A: AT ONCE the join is a job, joining, under the ID as pasted (trimmed)", during);
  const r = await p;
  await w.settle(10);
  ok(r && r.ok === true && r.name === "Room P", "A: the join answers done, with the room's name", r);
  ok(JSON.stringify(hs.joins) === JSON.stringify([ME + " !p:hs"]), "A: THE ROOM ONLY — the space joined, and no channel", hs.joins);
  ok(w.Room.runningRoom() === null, "A: and it is NOT OPENED — no room runs on the tab", w.Room.runningRoom());
  ok(w.Room.joinJobs().length === 0, "A: and the job is gone", w.Room.joinJobs());
  const scan = w.Room.scanDDJPRooms();
  const hit = scan.joined.find((x) => x.spaceId === "!p:hs");
  ok(hit && hit.name === "Room P", "A: `Room.scanDDJPRooms` LISTS A ROOM JOINED BY ITS ID WITH NO INVITE (a public room), under its name", scan);
  ok(w.lines(/Room: joining !p:hs by its ID — the room only; its channels are joined when it is opened/).length === 1 &&
     w.lines(/Room: joined Room P by its ID — it is in the room list; its channels are joined when it is opened/).length === 1,
    "A: the log says it joins the room only, and that it is in the list", w.lines(/Room: join/));
  // An invited room joined by its ID: the same.
  const ri = await w.Room.joinById("!i:hs");
  ok(ri && ri.ok === true && w.Room.scanDDJPRooms().joined.some((x) => x.spaceId === "!i:hs") && w.Room.runningRoom() === null,
    "A: an INVITED room joined by its ID — the same: listed, not opened", ri);
  // ITS FIRST OPENING joins its channels, with the opening's count.
  const steps = [];
  await w.Room.join("!p:hs", { onProgress: (s) => steps.push(s) });
  await w.settle(10);
  const counts = steps.filter((s) => s.step === "joining");
  const total = Object.keys(P.ch).length;
  ok(counts.length >= 2 && counts[0].done === 0 && counts.every((s) => s.total === total) && steps.some((s) => s.step === "loading") &&
     w.Room.runningRoom() === "!p:hs",
    "A: ITS FIRST OPENING JOINS ITS CHANNELS WITH THE OPENING'S COUNT — \"joining\" 0 of " + total + " upward, then \"loading\"", steps);
});

// ── B — IN ITS TURN ────────────────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const hs = W.homeserver();
  room(hs, "!p:hs", { name: "Room P" });
  const w = W.inviteWorld({ hs });
  if (!applied(w)) { ok(false, "B: APPLIED — `Room.joinById` exists"); return; }
  const h = holdDoor(w, "leaving Room Z");
  ok(w.MB.doorState().busy === true && w.MB.doorState().what === "leaving Room Z", "B PREMISE — another act holds the door", w.MB.doorState());
  const l0 = w.logs.length;
  const p = w.Room.joinById("!p:hs");
  await w.settle(10);
  const j = w.Room.joinJobs()[0];
  ok(j && j.state === "waiting" && j.waitsFor === "leaving Room Z", "B: WITH THE DOOR BUSY IT WAITS ITS TURN, saying what for", j);
  ok(hs.joins.length === 0, "B: and sends NOTHING meanwhile", hs.joins);
  const seen = [];
  w.Room.onJoinJob(() => { const x = w.Room.joinJobs()[0]; seen.push(x ? x.state : "gone"); });
  await h.release();
  const r = await p;
  await w.settle(10);
  ok(seen[0] === "joining" && seen[seen.length - 1] === "gone" && r && r.ok === true && hs.joins.length === 1,
    "B: LET GO, IT IS JOINING, THEN DONE", { seen, r, joins: hs.joins });
  ok(w.lines(/MatrixBridge: one at a time — joining .* waits for leaving Room Z/, l0).length === 1 && w.lines(/MatrixBridge: one at a time — joining .* goes/, l0).length === 1,
    "B: and the door's lines say both", w.lines(/one at a time/, l0));
});

// ── C — FAILURES, NAMED ────────────────────────────────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const hs = W.homeserver();
  room(hs, "!x:hs", { name: "Room X", closed: true });
  room(hs, "!b:hs", { name: "Room B" });
  plainSpace(hs, "!s:hs");
  hs.failNext["!b:hs"] = Array.from({ length: 7 }, () => ({ errcode: "M_UNKNOWN", httpStatus: 502 }));
  const w = W.inviteWorld({ hs });
  if (!applied(w)) { ok(false, "C: APPLIED — `Room.joinById` exists"); return; }
  const rx = await w.Room.joinById("!x:hs");
  const jx = w.Room.joinJobs().find((j) => j.spaceId === "!x:hs");
  ok(rx && rx.ok === false && jx && jx.state === "failed" && jx.why === "refused: M_FORBIDDEN" && jx.rejected === false,
    "C: A REFUSAL IS NAMED, with its code — \"refused: M_FORBIDDEN\" — and the job stays", { rx, jx });
  ok(w.lines(/Room: could not join !x:hs by its ID — refused: M_FORBIDDEN; it stays in the box/).length === 1, "C: and its line", w.lines(/Room: could not/));
  const rb = await w.Room.joinById("!b:hs");
  const jb = w.Room.joinJobs().find((j) => j.spaceId === "!b:hs");
  ok(rb && rb.ok === false && jb && jb.why === "gave up after a minute of retries: M_UNKNOWN", "C: RETRIES THAT GAVE UP are named, with the code", { rb, jb });
  ok(!w.Room.joinJobs().some((j) => j.spaceId === "!x:hs"), "C: A NEW JOIN ROOM FORGETS THE LAST FAILURES", w.Room.joinJobs());
  // CHANGED ON PURPOSE (`ddjp_691`, the owner's "reject non ddjp rooms"): this row read "joined, not listed, and said"; such a room
  // is now left again, in the same turn — part F drives the rest.
  const rs = await w.Room.joinById("!s:hs");
  const js = w.Room.joinJobs().find((j) => j.spaceId === "!s:hs");
  ok(rs && rs.ok === false && rs.reason === "not-ddjp" && js && js.state === "failed" && js.rejected === true && js.leftAgain === true && hs.rooms["!s:hs"].members[ME] === "leave",
    "C: A ROOM THAT IS NOT A DDJP ROOM IS REJECTED — left again, nothing stays joined, and said", { rs, js, ms: hs.rooms["!s:hs"].members[ME] });
  const n0 = hs.joins.length;
  const re = await w.Room.joinById("   ");
  ok(re && re.ok === false && re.reason === "empty" && hs.joins.length === n0, "C: AN EMPTY ID sends nothing", re);
});

// ── D — THE ROOM LIST ──────────────────────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const hs = W.homeserver();
  room(hs, "!p:hs", { name: "Room P" });
  room(hs, "!q:hs", { name: "Room Q" });
  room(hs, "!x:hs", { name: "Room X", closed: true });
  plainSpace(hs, "!s:hs");
  const w = W.inviteWorld({ hs });
  if (!applied(w)) { ok(false, "D: APPLIED — `Room.joinById` exists (the list's Join Room has nothing to call)"); return; }
  const windows = [];
  const sw = SW.world({ features: { Room: w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } },
    globals: { alert: (m) => windows.push("alert: " + m), confirm: (m) => { windows.push("confirm: " + m); return false; } } });
  const doc = sw.doc, S = sw.sb.Screens;
  const add = (tag, id) => { const n = doc.createElement(tag); n.id = id; doc.body.appendChild(n); return n; };
  const box = add("input", "input-join-code"), btn = add("button", "btn-join-room");
  btn.className = "btn-secondary";
  const list = add("div", "room-list"); add("span", "rooms-lock");
  S.showScreen("screen-rooms");
  S.renderRoomList(w.Room.scanDDJPRooms());
  const q = (sel) => list.querySelectorAll(sel);
  const titles = () => q("h3").map((h) => h.textContent);
  const joiningRows = () => { const out = []; let on = false; for (const c of list.children) { if (c.tag === "h3") on = c.textContent === "Joining"; else if (on) out.push(c); } return out; };
  const rowText = (r) => r.textContent;
  const rowBtn = (r) => r.querySelectorAll("button")[0] || null;
  // AN EMPTY BOX: a note at the top, nothing sent, no window.
  box.value = "  ";
  btn.click();
  await w.settle(4);
  const first = list.children[0];
  ok(first && first.tag === "p" && first.textContent === "Paste a Space ID to join." && hs.joins.length === 0 && windows.length === 0,
    "D: AN EMPTY BOX GETS A NOTE at the top of the list — nothing sent, no window", { first: first && first.textContent, joins: hs.joins, windows });
  // A PASTED ID: at once, "Joining", at the top, with a greyed "Joining…".
  box.value = "!p:hs";
  btn.click();
  const rows = joiningRows();
  ok(titles()[0] === "Joining" && rows.length === 1 && rows[0].querySelector(".room-invite-name") && rows[0].querySelector(".room-invite-name").textContent === "!p:hs",
    "D: AT ONCE, A \"Joining\" SECTION AT THE TOP OF THE LIST SHOWS THE PASTED ID", { titles: titles(), rows: rows.map(rowText) });
  const b0 = rows[0] && rowBtn(rows[0]);
  ok(b0 && b0.textContent === "Joining…" && b0.disabled === true && /\broom-accept-btn\b/.test(b0.className),
    "D: with a GREYED \"Joining…\" (Accept's own look while it joins)", b0 && { text: b0.textContent, disabled: b0.disabled, cls: b0.className });
  ok(!list.children.some((c) => c.tag === "p" && /Paste a Space ID/.test(c.textContent)), "D: the empty box's note goes with the next press", list.children.map((c) => c.textContent).slice(0, 2));
  // DONE: under its name, nothing opened, the box free.
  await later(() => !titles().includes("Joining"));
  const joinedSec = titles().indexOf("Joined rooms");
  ok(!titles().includes("Joining") && joinedSec >= 0 && list.querySelectorAll(".room-item, .room-item-main").some((n) => n.textContent === "Room P"),
    "D: WHEN IT'S DONE, THE ROOM IS IN THE LIST UNDER ITS NAME and the Joining section is gone", { titles: titles(), text: list.textContent.slice(0, 200) });
  ok(w.Room.runningRoom() === null && JSON.stringify(hs.joins) === JSON.stringify([ME + " !p:hs"]), "D: and it is NOT OPENED by itself — the room only", { running: w.Room.runningRoom(), joins: hs.joins });
  ok(box.value === "", "D: and the box is cleared", box.value);
  // THE DOOR BUSY: Join Room is not greyed; the row says what it waits for, then "Joining…".
  const h = holdDoor(w, "leaving Room Z");
  await w.settle(4);
  ok(btn.disabled === false, "D: WITH THE DOOR BUSY, JOIN ROOM IS NOT GREYED — a press waits its turn in its row", { disabled: btn.disabled, title: btn.title });
  box.value = "!q:hs";
  btn.click();
  await w.settle(6);
  const wr = joiningRows()[0], wb = wr && rowBtn(wr);
  ok(wb && wb.textContent === "Waits for: leaving Room Z" && wb.disabled === true && hs.joins.length === 1,
    "D: THE ROW SAYS \"Waits for: leaving Room Z\", greyed, and nothing is sent", wb && { text: wb.textContent, joins: hs.joins });
  await h.release();
  await later(() => w.Room.scanDDJPRooms().joined.some((x) => x.spaceId === "!q:hs") && !titles().includes("Joining"));
  ok(!titles().includes("Joining") && list.textContent.indexOf("Room Q") >= 0, "D: let go, it joins and is listed", titles());
  // A FAILURE: said in the row; the ID stays in the box.
  box.value = "!x:hs";
  btn.click();
  await later(() => joiningRows().some((r) => /Couldn't join/.test(r.textContent)));
  const fr = joiningRows()[0];
  const note = fr && fr.querySelector(".room-invite-note");
  ok(note && note.textContent === "Couldn't join (refused: M_FORBIDDEN).", "D: A FAILURE IS SAID IN THE LIST — \"Couldn't join (refused: M_FORBIDDEN).\"", fr && fr.textContent);
  ok(box.value === "!x:hs", "D: and THE ID STAYS IN THE BOX", box.value);
  // NOT A DDJP ROOM: said.
  box.value = "!s:hs";
  btn.click();
  await later(() => joiningRows().some((r) => /DDJP room/.test(r.textContent)), 6000);
  const sr = joiningRows().find((r) => r.querySelector(".room-invite-name") && r.querySelector(".room-invite-name").textContent === "!s:hs");
  // CHANGED ON PURPOSE (`ddjp_691`): the row read "Joined, but it is not a DDJP room, so it is not listed."; it is rejected now.
  ok(sr && sr.querySelector(".room-invite-note") && sr.querySelector(".room-invite-note").textContent === "That isn't a DDJP room." &&
     hs.rooms["!s:hs"].members[ME] === "leave",
    "D: A ROOM THAT IS NOT A DDJP ROOM — its row says \"That isn't a DDJP room.\", and it is left again", { row: sr && sr.textContent, ms: hs.rooms["!s:hs"].members[ME] });
  ok(!joiningRows().some((r) => /refused/.test(r.textContent)), "D: and the last failure went with the new press", joiningRows().map(rowText));
  ok(windows.length === 0, "D: NO WINDOW at any step", windows);
});

// ── F — REJECT A ROOM THAT IS NOT A DDJP ROOM (`ddjp_691`) ─────────────────────────────────────────────────────────────────
part("F", async () => {
  const seqOf = (w, hs) => { const seq = []; const j0 = w.client.joinRoom, l0 = w.client.leave;
    w.client.joinRoom = async (id) => { seq.push("join " + id); return j0(id); }; w.client.leave = async (id) => { seq.push("leave " + id); return l0(id); }; return seq; };
  // IN THE SAME TURN: another act asked while the join runs goes only after the leave.
  const hs = W.homeserver();
  plainSpace(hs, "!s:hs");
  room(hs, "!o:hs", { name: "Room O", invite: true });
  const w = W.inviteWorld({ hs });
  if (!applied(w) || typeof w.Room.isDDJPRoom !== "function") { ok(false, "F: APPLIED — `Room.isDDJPRoom`, the room list's test, exists for Join Room to ask"); return; }
  ok(w.Room.isDDJPRoom({ type: "m.space", ddjp_mode: "backend1" }) === true && w.Room.isDDJPRoom({ type: "m.space" }) === false && w.Room.isDDJPRoom({ ddjp_mode: "backend1" }) === false,
    "F: the list's test: a space that declares its engine, and nothing else");
  const seq = seqOf(w, hs);
  const p = w.Room.joinById("!s:hs");
  const other = w.Room.acceptInvite("!o:hs").then(() => seq.push("accepted !o:hs"), () => seq.push("accept failed"));
  const r = await p; await other; await w.settle(10);
  const ji = seq.indexOf("join !s:hs"), li = seq.indexOf("leave !s:hs"), oi = seq.indexOf("join !o:hs");
  ok(r && r.ok === false && r.reason === "not-ddjp" && ji >= 0 && li > ji && oi > li, "F: JOINED, READ, AND LEFT AGAIN IN THE SAME TURN — the Accept asked meanwhile goes only after the leave", seq);
  ok(hs.rooms["!s:hs"].members[ME] === "leave" && !w.Room.scanDDJPRooms().joined.some((x) => x.spaceId === "!s:hs"), "F: and nothing stays joined", hs.rooms["!s:hs"].members[ME]);
  ok(w.lines(/MatrixBridge: joined Plain \(!s:hs\) and did not keep it — its creation record is not a DDJP room's; left again/).length === 1 &&
     w.lines(/Room: !s:hs is not a DDJP room — left again; nothing stays joined/).length === 1, "F: the lines say so", w.lines(/not keep|not a DDJP/));
  // THE LEAVE FAILS: the row names the room, and it stays.
  const hs2 = W.homeserver();
  plainSpace(hs2, "!s:hs");
  hs2.failNext["leave:!s:hs"] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const w2 = W.inviteWorld({ hs: hs2 });
  const r2 = await w2.Room.joinById("!s:hs");
  const j2 = w2.Room.joinJobs().find((j) => j.spaceId === "!s:hs");
  ok(r2 && r2.ok === false && j2 && j2.rejected === true && j2.leftAgain === false && j2.name === "Plain" && j2.why === "refused: M_FORBIDDEN" && hs2.rooms["!s:hs"].members[ME] === "join",
    "F: A LEAVE THAT FAILS IS SAID, NAMING THE ROOM (\"Plain\", refused: M_FORBIDDEN) — and it stays", { r2, j2 });
  // ALREADY IN IT: asked, never left; nothing sent.
  const hs3 = W.homeserver();
  plainSpace(hs3, "!s:hs");
  hs3.rooms["!s:hs"].members[ME] = "join";
  const w3 = W.inviteWorld({ hs: hs3 });
  const r3 = await w3.Room.joinById("!s:hs");
  const j3 = w3.Room.joinJobs().find((j) => j.spaceId === "!s:hs");
  ok(r3 && r3.ok === false && j3 && j3.rejected === true && j3.leftAgain === null && hs3.joins.length === 0 && hs3.leaves.length === 0 && hs3.rooms["!s:hs"].members[ME] === "join",
    "F: A ROOM THIS ACCOUNT WAS ALREADY IN is said not to be a DDJP room and is NOT left — nothing sent", { r3, j3, joins: hs3.joins, leaves: hs3.leaves });
  // THE CREATION RECORD NEVER ARRIVES: left again, and the row says it could not be read.
  const hs4 = W.homeserver();
  room(hs4, "!u:hs", { name: "Room U" });
  hs4.rooms["!u:hs"].unsynced = true;
  const w4 = W.inviteWorld({ hs: hs4 });
  const r4 = await w4.Room.joinById("!u:hs");
  const j4 = w4.Room.joinJobs().find((j) => j.spaceId === "!u:hs");
  ok(r4 && r4.ok === false && j4 && j4.rejected === true && j4.unreadable === true && j4.leftAgain === true && hs4.rooms["!u:hs"].members[ME] === "leave",
    "F: A CREATION RECORD THAT NEVER ARRIVES — left again, and said to be unreadable", { r4, j4 });
  // THE ROWS' WORDS, drawn by the real room list over each world's own jobs.
  const noteOf = (wx, id) => {
    const sw = SW.world({ features: { Room: wx.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
    const doc = sw.doc;
    const add = (tag, nid) => { const n = doc.createElement(tag); n.id = nid; doc.body.appendChild(n); return n; };
    add("input", "input-join-code"); add("button", "btn-join-room");
    const list = add("div", "room-list"); add("span", "rooms-lock");
    sw.sb.Screens.showScreen("screen-rooms");
    sw.sb.Screens.renderRoomList(wx.Room.scanDDJPRooms());
    const row = list.children.find((c) => c.querySelector && c.querySelector(".room-invite-name") && c.querySelector(".room-invite-name").textContent === id);
    const n = row && row.querySelector(".room-invite-note");
    return n ? n.textContent : null;
  };
  ok(noteOf(w2, "!s:hs") === "That isn't a DDJP room, and leaving it again failed: Plain (refused: M_FORBIDDEN).",
    "F: ITS ROW SAYS SO AND NAMES THE ROOM — \"That isn't a DDJP room, and leaving it again failed: Plain (refused: M_FORBIDDEN).\"", noteOf(w2, "!s:hs"));
  // THE PLAIN WORDS (the owner's "lets small fix", then "now", `ddjp_692`): a record that did not come in time is said as the
  // app not having checked the room in time — left again, or the leave failing, naming the room. Changed on purpose at
  // `ddjp_692`: this row read "Couldn't read that room's creation record, so it was left again."; the failed leave's row is new.
  ok(noteOf(w4, "!u:hs") === "Couldn't check this room in time, so the app left it. Try again.",
    "F: AN UNREADABLE ONE'S ROW — \"Couldn't check this room in time, so the app left it. Try again.\"", noteOf(w4, "!u:hs"));
  const hs5 = W.homeserver();
  room(hs5, "!u:hs", { name: "Room U" });
  hs5.rooms["!u:hs"].unsynced = true;
  hs5.failNext["leave:!u:hs"] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const w5 = W.inviteWorld({ hs: hs5 });
  const r5 = await w5.Room.joinById("!u:hs");
  const j5 = w5.Room.joinJobs().find((j) => j.spaceId === "!u:hs");
  ok(r5 && r5.ok === false && j5 && j5.unreadable === true && j5.leftAgain === false && hs5.rooms["!u:hs"].members[ME] === "join",
    "F: PREMISE — an unreadable room whose leave fails stays joined, the job saying so", { r5, j5 });
  ok(noteOf(w5, "!u:hs") === "Couldn't check this room in time, and leaving it again failed: Room U (refused: M_FORBIDDEN).",
    "F: AN UNREADABLE ONE WHOSE LEAVE FAILED — \"Couldn't check this room in time, and leaving it again failed: Room U (refused: M_FORBIDDEN).\"", noteOf(w5, "!u:hs"));
});

// ── E — NO WINDOW IN THIS PATH (source-level: it proves what is SPELLED, which is all it claims) ──────────────────────────
part("E", async () => {
  const strip = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const app = strip(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
  const scr = fs.readFileSync(path.join(ROOT, "ui/screens.js"), "utf8");
  ok(!/btn-join-room/.test(app) && !/Paste a Space ID/.test(app) && !/Join failed/.test(app),
    "E: `app.js` wires nothing to Join Room and has no window for it (its `alert`s for an empty box and a failure are gone)", (app.match(/[^\n]*(btn-join-room|Join failed|Paste a Space ID)[^\n]*/g) || []));
  const i = scr.indexOf("function joinRoomById(");
  const body = i >= 0 ? scr.slice(i, scr.indexOf("\n  }\n", i)) : "";
  ok(i >= 0 && !/\balert\s*\(|\bconfirm\s*\(/.test(body), "E: the room list's handler opens no window", body.slice(0, 120));
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[join-by-id] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[join-by-id] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[join-by-id] PASS — Join Room by a room's ID is like accepting an invite (the owner's, `ddjp_690`; " + asserts +
    " assertions): it joins the room only, in its turn at the door — saying what it waits for, then joining — and opens nothing; " +
    "a public room joined with no invite is listed under its name, and its first opening joins its channels with the opening's " +
    "count; a refusal and retries that gave up are each named and kept until the next Join Room; a room that is not a DDJP room " +
    "is rejected — left again in the same turn, or named when that leave fails, and never left when this account was in it " +
    "before (`ddjp_691`); " +
    "on the room list a pasted ID shows at once under \"Joining\", at the top, greyed, done it is under its name with the box " +
    "cleared, a failure stays with the ID in the box, an empty box gets a note, Join Room is not greyed while the door is busy, " +
    "and no window opens.");
  process.exit(0);
})();
