#!/usr/bin/env node
// tests/check-leftovers.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, ui/screens.js
//
// WALL: LEFTOVER CHANNELS FROM ROOMS LEFT BEFORE (the owner's, `ddjp_691`). Asked: "rooms you left in Element before may have left
// channels behind on your account. Should the room list find those leftovers and offer to leave them? It would be one line,
// 'Leftover channels from rooms you left: 7', with a Leave button behind the lock. Default: yes." His answer: "yes". Read plainly:
// the room list finds every room this account is in or invited to that carries a DDJP channel mark naming a room this account is
// neither in nor invited to; shown only when there are some, one line with Leave, Leave only while the list's lock is open; Leave
// goes through the door, one at a time, with progress, failures named and "Leave again", as a room's Leave does — the SAME leave.
//
// Driven on the REAL modules (both engines, the bridge, `features/room.js`) against the homeserver MODEL (`tests/_inviteworld.js`),
// and the REAL ui/ files (`tests/_screen-world.js`) drawn over that same real room:
//   A  THE SWEEP: a left room's channels this account is still in or invited to, and a channel of a room the client does not know,
//      are counted; never counted: a channel of a room this account is in, or invited to, the half-built room's channels, a DM, a
//      room with no complete mark. Nothing is decided before the first sync (null, not 0).
//   B  THE LEAVE: every leftover, one at a time, in one turn at the door (nothing sent while another act holds it), its progress
//      counting them all; then none is left; a refusal is named by the channel's name and the rest still leave; Leave again sends
//      only what is left.
//   C  THE ROOM LIST: the line "Leftover channels from rooms you left: N" at the list's end, only when there are some; no Leave of
//      its own, locked or not — they leave by themselves (`ddjp_696`); its progress in the line; a failure "Left L of T. Couldn't
//      leave: … (…)." with Leave again (the lock is there when only leftovers are); finished, the line goes; no line before sync.
//   D  LEFT BY THEMSELVES (`ddjp_696`, JOB 2; the owner's "i dotn want to ever wonder why im still in channels after leaving a space,
//      or if i got banned form one as welll i guess"): kicked from a room, banned, or left from another app — seen live — its
//      channels are left without being asked, by the leftovers' own leave (paced, at the door, read back), one line a room saying
//      why; found at start, every leftover the same way; never before the first sync, nor the room being created, a room in a join
//      or leave job, or a channel whose room this account is in or invited to; the set read again at the start of the leave's
//      turn; a leave that failed is not tried again by itself until a new leftover appears; the line shows it all, then goes.
// RED FIRST ON 690: `Room.leftovers` and the bridge's sweep do not exist — every part refuses by name. RED FIRST ON 695: nothing
// leaves by itself (all of D), and the line has its own Leave (C).
// CHANGED ON PURPOSE AT `ddjp_696` (JOB 2): C's unlocked line has no Leave of its own (the leftovers leave by themselves: the rows
// drive `Room.autoLeaveLeftovers`, as a room change or the start does), and the failure is reached the same way.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[leftovers] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[leftovers] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const later = async (cond, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 20)); } return cond(); };

// THE ACCOUNT'S ROOMS: A (in it, and its four open channels), I (invited to the room, in one of its channels), L (left — the room
// out, three channels still in and one invite waiting), a channel of a room the client never knew (`!gone:hs`), the half-built
// room H (its space left, a channel in), a DM, and a room with half a mark. Leftovers: L's four and the unknown room's one.
function account(o) {
  o = o || {};
  const hs = W.homeserver();
  const inRoom = (sid, keys) => { const R = hs.ddjpRoom(sid, { levels: { [ME]: 20 } }); hs.rooms[sid].members[ME] = "join"; for (const k of keys) hs.rooms[R.ch[k]].members[ME] = "join"; return R; };
  const OPEN = ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"];
  const A = inRoom("!a:hs", OPEN);
  const I = hs.ddjpRoom("!i:hs", {});
  hs.invite("!i:hs", ME, { from: OWNER });
  hs.rooms[I.ch.events_owner].members[ME] = "join";
  const L = inRoom("!l:hs", ["events_uncategorized", "events_owner", "settings_owner"]);
  hs.invite(L.ch.chat_staff, ME, { from: OWNER });
  hs.rooms["!l:hs"].members[ME] = "leave";
  hs.room("!g-chan:hs", { name: "lost-chat", content: { room_version: "12", ddjp_room: "!gone:hs", ddjp_kind: "chat_uncategorized" }, members: { [OWNER]: "join", [ME]: "join" } });
  const H = inRoom("!h:hs", ["events_owner"]);
  hs.rooms["!h:hs"].members[ME] = "leave";
  hs.room("!dm:hs", { name: "dm", content: { room_version: "12" }, members: { [OWNER]: "join", [ME]: "join" } });
  hs.room("!half:hs", { name: "half-mark", content: { room_version: "12", ddjp_room: "!nowhere:hs" }, members: { [OWNER]: "join", [ME]: "join" } });
  const leftovers = [L.ch.events_uncategorized, L.ch.events_owner, L.ch.settings_owner, L.ch.chat_staff, "!g-chan:hs"].sort();
  const sync = { state: o.sync === undefined ? "SYNCING" : o.sync };
  const store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {}, loadPendingCreate: () => ({ name: "half-built", spaceId: "!h:hs", channels: { events_owner: H.ch.events_owner } }),
      saveLeaving() {}, loadLeaving: () => [] } };
  const w = W.inviteWorld({ hs, client: { getSyncState: () => sync.state }, extras: { Store: store } });
  w.account.direct = { [OWNER]: ["!dm:hs"] };   // `ddjp_695`: the DM is in Matrix's own DM list, as a DM is (so not an "other room")
  const leave0 = w.client.leave;
  w.inFlight = 0; w.maxInFlight = 0; w.leaveOrder = [];
  w.client.leave = async (id) => { w.inFlight++; w.maxInFlight = Math.max(w.maxInFlight, w.inFlight); w.leaveOrder.push(id);
    try { await Promise.resolve(); await Promise.resolve(); return await leave0(id); } finally { w.inFlight--; } };
  return { hs, w, A, I, L, H, leftovers, sync };
}
const applied = (w) => typeof w.Room.leftovers === "function" && typeof w.Room.leaveLeftovers === "function" && typeof w.MB.leftoverChannels === "function";

// ── A — THE SWEEP ──────────────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const x = account();
  ok(applied(x.w), "A: APPLIED — `Room.leftovers`, `Room.leaveLeftovers` and the bridge's `leftoverChannels` exist", typeof x.w.Room.leftovers);
  if (!applied(x.w)) return;
  const lo = x.w.Room.leftovers();
  ok(lo && lo.count === 5 && JSON.stringify(lo.ids) === JSON.stringify(x.leftovers),
    "A: COUNTED — a left room's channels still in or invited to (four), and a channel of a room the client does not know (one)", { lo, want: x.leftovers });
  const ids = (lo && lo.ids) || [];
  ok(!Object.values(x.A.ch).some((id) => ids.indexOf(id) >= 0), "A: NEVER a channel of a room this account is in", ids);
  ok(ids.indexOf(x.I.ch.events_owner) < 0, "A: NEVER a channel of a room this account is invited to", ids);
  ok(ids.indexOf(x.H.ch.events_owner) < 0, "A: NEVER the half-built room's channels", ids);
  ok(ids.indexOf("!dm:hs") < 0 && ids.indexOf("!half:hs") < 0, "A: NEVER a DM, nor a room without a complete mark", ids);
  const y = account({ sync: null });
  ok(y.w.Room.leftovers() === null, "A: NOT DECIDED BEFORE THE FIRST SYNC — null, not 0", y.w.Room.leftovers());
  y.sync.state = "PREPARED";
  ok(y.w.Room.leftovers() && y.w.Room.leftovers().count === 5, "A: and decided once it is done", y.w.Room.leftovers());
});

// ── B — THE LEAVE ──────────────────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const x = account();
  if (!applied(x.w)) { ok(false, "B: APPLIED — `Room.leaveLeftovers` exists"); return; }
  // IN ITS TURN: another act holds the door; nothing is sent until it is let go.
  let letGo = null;
  const held = x.w.MB.inTurn("leaving Room Z", { key: "!z:hs" }, () => new Promise((r) => { letGo = r; }));
  const seen = [];
  x.w.Room.onLeaveJob((k) => { if (k !== x.w.Room.LEFTOVERS) return; const j = x.w.Room.leaveJob(k); seen.push(j ? { state: j.state, done: j.done, total: j.total, waitsFor: j.waitsFor } : null); });
  const p = x.w.Room.leaveLeftovers();
  await x.w.settle(10);
  ok(x.w.leaveOrder.length === 0 && seen.some((j) => j && j.state === "waiting" && j.waitsFor === "leaving Room Z"),
    "B: IT WAITS ITS TURN AT THE DOOR — nothing sent, and it says what for", { sent: x.w.leaveOrder, seen });
  letGo(); await held;
  const r = await p;
  await x.w.settle(10);
  ok(r && r.ok === true && r.total === 5 && r.left === 5 && JSON.stringify(x.w.leaveOrder) === JSON.stringify(x.leftovers),
    "B: EVERY LEFTOVER IS LEFT, the invite declined among them", { r, sent: x.w.leaveOrder });
  ok(x.w.maxInFlight === 1, "B: ONE AT A TIME", x.w.maxInFlight);
  const running = seen.filter((j) => j && j.state === "running").map((j) => j.done + "/" + j.total);
  ok(running[0] === "0/5" && running[running.length - 1] === "5/5", "B: ITS PROGRESS COUNTS THEM ALL (0 of 5 … 5 of 5)", running);
  ok(x.w.Room.leftovers().count === 0 && x.w.Room.leaveJob(x.w.Room.LEFTOVERS) === null, "B: then none is left, and the job is gone", x.w.Room.leftovers());
  ok(x.hs.rooms["!a:hs"].members[ME] === "join" && Object.values(x.A.ch).every((id) => x.hs.rooms[id].members[ME] !== "leave") && x.hs.rooms["!dm:hs"].members[ME] === "join",
    "B: and nothing else is touched — the room this account is in, its channels, the DM");
  ok(x.w.lines(/MatrixBridge: leaving leftover channels — .* — 5 of 5 channels left$/).length === 1 && x.w.lines(/Room: left the leftover channels — 5 of 5 channel\(s\)/).length === 1,
    "B: ONE line from the bridge naming each channel's answer, and the room's", x.w.lines(/leftover/));
  // A REFUSAL is named by the channel's name; the rest still leave; Leave again sends only what is left.
  const y = account();
  y.hs.failNext["leave:" + y.L.ch.settings_owner] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const r1 = await y.w.Room.leaveLeftovers();
  const j1 = y.w.Room.leaveJob(y.w.Room.LEFTOVERS);
  ok(r1 && r1.ok === false && j1 && j1.state === "failed" && j1.left === 4 && j1.total === 5 &&
     JSON.stringify(j1.failed) === JSON.stringify([{ label: "settings-owner", why: "refused: M_FORBIDDEN" }]),
    "B: A REFUSAL IS NAMED by the channel's name, and the other four leave", { r1, j1 });
  ok(y.w.lines(/Room: the leave of the leftover channels did not finish — left 4 of 5; couldn't leave: settings-owner \(refused: M_FORBIDDEN\); Leave again finishes it/).length === 1,
    "B: and the room's line says what failed", y.w.lines(/Room: the leave/));
  const n0 = y.w.leaveOrder.length;
  const r2 = await y.w.Room.leaveLeftovers();
  ok(r2 && r2.ok === true && JSON.stringify(y.w.leaveOrder.slice(n0)) === JSON.stringify([y.L.ch.settings_owner]), "B: LEAVE AGAIN SENDS ONLY WHAT IS LEFT", y.w.leaveOrder.slice(n0));
});

// ── C — THE ROOM LIST ──────────────────────────────────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const x = account();
  if (!applied(x.w)) { ok(false, "C: APPLIED — `Room.leftovers` exists (the list has nothing to read)"); return; }
  const sw = SW.world({ features: { Room: x.w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const doc = sw.doc, S = sw.sb.Screens;
  const add = (tag, id) => { const n = doc.createElement(tag); n.id = id; doc.body.appendChild(n); return n; };
  add("input", "input-join-code"); add("button", "btn-join-room");
  const list = add("div", "room-list"), lockSlot = add("span", "rooms-lock");
  S.showScreen("screen-rooms");
  S.renderRoomList(x.w.Room.scanDDJPRooms());
  const lineOf = () => list.children.find((c) => /Leftover channels from rooms you left/.test(c.textContent)) || null;
  const line = lineOf();
  ok(line && line === list.children[list.children.length - 1] && line.querySelector(".room-invite-name").textContent === "Leftover channels from rooms you left: 5",
    "C: ONE LINE AT THE LIST'S END — \"Leftover channels from rooms you left: 5\"", line && line.textContent);
  const leaveIn = (n) => n ? n.querySelectorAll("button").filter((b) => b.textContent === "Leave") : [];
  ok(line && leaveIn(line).length === 0, "C: LOCKED, NO LEAVE in the line", line && line.textContent);
  const lock = lockSlot.querySelectorAll(".panel-lock-btn")[0];
  if (lock) lock.click();
  ok(lineOf() && leaveIn(lineOf()).length === 0, "C: UNLOCKED, STILL NO LEAVE OF ITS OWN — they leave by themselves (`ddjp_696`)", lineOf() && lineOf().textContent);
  const auto = typeof x.w.Room.autoLeaveLeftovers === "function" ? x.w.Room.autoLeaveLeftovers() : null;
  await later(() => !lineOf(), 6000);
  ok(auto && !lineOf() && x.w.Room.leftovers().count === 0, "C: THEIR LEAVE BY ITSELF LEAVES THEM, and the line goes", lineOf() && lineOf().textContent);
  // A failure: the line keeps its frame, says what failed, and offers Leave again.
  const y = account();
  y.hs.failNext["leave:" + y.L.ch.settings_owner] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const sw2 = SW.world({ features: { Room: y.w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const d2 = sw2.doc, S2 = sw2.sb.Screens;
  const add2 = (tag, id) => { const n = d2.createElement(tag); n.id = id; d2.body.appendChild(n); return n; };
  add2("input", "input-join-code"); add2("button", "btn-join-room");
  const list2 = add2("div", "room-list"), lock2 = add2("span", "rooms-lock");
  S2.showScreen("screen-rooms");
  S2.renderRoomList(y.w.Room.scanDDJPRooms());
  lock2.querySelectorAll(".panel-lock-btn")[0].click();
  const line2 = () => list2.children.find((c) => /Leftover channels from rooms you left/.test(c.textContent)) || null;
  if (typeof y.w.Room.autoLeaveLeftovers === "function") y.w.Room.autoLeaveLeftovers();
  await later(() => line2() && /Couldn't leave/.test(line2().textContent), 6000);
  const fl = line2();
  ok(fl && /Left 4 of 5\. Couldn't leave: settings-owner \(refused: M_FORBIDDEN\)\./.test(fl.textContent) &&
     fl.querySelectorAll("button").some((x) => x.textContent === "Leave again") && /Leftover channels from rooms you left: 1/.test(fl.textContent),
    "C: A FAILURE — \"Left 4 of 5. Couldn't leave: settings-owner (refused: M_FORBIDDEN).\", with Leave again, and the count now 1", fl && fl.textContent);
  // NO LINE BEFORE THE FIRST SYNC, and THE LOCK IS THERE WHEN ONLY LEFTOVERS ARE.
  const z = account({ sync: null });
  const sw3 = SW.world({ features: { Room: z.w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const d3 = sw3.doc, S3 = sw3.sb.Screens;
  const add3 = (tag, id) => { const n = d3.createElement(tag); n.id = id; d3.body.appendChild(n); return n; };
  add3("input", "input-join-code"); add3("button", "btn-join-room");
  const list3 = add3("div", "room-list"), lock3 = add3("span", "rooms-lock");
  S3.showScreen("screen-rooms");
  S3.renderRoomList(z.w.Room.scanDDJPRooms());
  ok(!list3.children.some((c) => /Leftover channels/.test(c.textContent)), "C: NO LINE BEFORE THE FIRST SYNC", list3.textContent.slice(0, 120));
  z.sync.state = "SYNCING";
  S3.renderRoomList({ owned: [], joined: [], invited: [], unconfirmed: [] });
  ok(list3.children.some((c) => /Leftover channels from rooms you left: 5/.test(c.textContent)) && lock3.querySelectorAll(".panel-lock-btn").length === 1 &&
     !list3.children.some((c) => /No rooms yet/.test(c.textContent)),
    "C: WITH NO ROOM BUT LEFTOVERS, the line and its lock are there (and no \"No rooms yet\")", list3.textContent.slice(0, 160));
});

// ── D — LEFT BY THEMSELVES (`ddjp_696`, JOB 2) ─────────────────────────────────────────────────────────────────────────────────
// A clean account: in L (its three channels and the staff chat's invite), no leftover yet. Then removed from L — kicked or banned —
// with the room changes heard as the SDK says them (`Room.myMembership`).
function clean(o) {
  const x = account(o);
  x.hs.rooms["!l:hs"].members[ME] = "join";
  x.hs.rooms["!g-chan:hs"].members[ME] = "leave";
  x.w.Room.onRoomsChanged(() => {});   // the room list wires the room changes (`_wireRoomsChanged`), as the lobby does
  x.Lset = [x.L.ch.events_uncategorized, x.L.ch.events_owner, x.L.ch.settings_owner, x.L.ch.chat_staff].sort();
  x.Lname = x.hs.rooms["!l:hs"].name;
  x.removed = (how) => { x.hs.rooms["!l:hs"].members[ME] = how || "leave"; x.w.emit("Room.myMembership"); };
  return x;
}
const autoOf = (w) => typeof w.Room.autoLeaveLeftovers === "function";
part("D", async () => {
  const x = clean();
  ok(autoOf(x.w), "D: APPLIED — `Room.autoLeaveLeftovers`", typeof x.w.Room.autoLeaveLeftovers);
  if (!autoOf(x.w)) return;
  ok(x.w.Room.leftovers().count === 0, "D: PREMISE — in L, no leftover", x.w.Room.leftovers());
  // KICKED, SEEN LIVE: its channels leave by themselves, with one line saying why.
  const from = x.w.logs.length;
  x.removed("leave");
  await later(() => x.w.Room.leftovers().count === 0 && !x.w.Room.leaveJob(x.w.Room.LEFTOVERS), 6000);
  ok(JSON.stringify(x.w.leaveOrder.slice().sort()) === JSON.stringify(x.Lset) && x.w.Room.leftovers().count === 0 && x.w.maxInFlight === 1,
    "D: REMOVED FROM A ROOM, SEEN LIVE — its four channels (three in, one invite) leave by themselves, one at a time, none left over", { sent: x.w.leaveOrder, lo: x.w.Room.leftovers() });
  ok(x.w.lines(new RegExp("Room: removed from " + x.Lname + ": leaving its 4 channels$"), from).length === 1, "D: ONE LINE SAYS WHY — \"Room: removed from " + x.Lname + ": leaving its 4 channels\"", x.w.lines(/Room: /, from));
  ok(x.w.lines(/MatrixBridge: leaving leftover channels — .* — 4 of 4 channels left$/, from).length === 1, "D: BY THE LEFTOVERS' OWN LEAVE — its line, all four confirmed out", x.w.lines(/leftover/, from));
  ok(x.hs.rooms["!a:hs"].members[ME] === "join" && Object.values(x.A.ch).every((id) => x.hs.rooms[id].members[ME] !== "leave") && x.hs.rooms[x.I.ch.events_owner].members[ME] === "join" &&
     x.hs.rooms[x.H.ch.events_owner].members[ME] === "join" && x.hs.rooms["!dm:hs"].members[ME] === "join",
    "D: NOTHING ELSE — the room it is in and its channels, a channel of a room it is invited to, the room being created, the DM");
  // BANNED: the same.
  const b = clean();
  b.removed("ban");
  await later(() => b.w.Room.leftovers().count === 0 && !b.w.Room.leaveJob(b.w.Room.LEFTOVERS), 6000);
  ok(JSON.stringify(b.w.leaveOrder.slice().sort()) === JSON.stringify(b.Lset), "D: BANNED — the same: its channels leave by themselves", b.w.leaveOrder);
  // FOUND AT START: every leftover, the same way, once the first sync is in.
  const st = account();
  const f2 = st.w.logs.length;
  st.w.Room.resumeLeaves();
  await later(() => st.w.Room.leftovers().count === 0 && !st.w.Room.leaveJob(st.w.Room.LEFTOVERS), 6000);
  ok(JSON.stringify(st.w.leaveOrder.slice().sort()) === JSON.stringify(st.leftovers), "D: FOUND AT START — every leftover leaves by itself (all five)", st.w.leaveOrder);
  ok(st.w.lines(/Room: removed from l: leaving its 4 channels$/, f2).length === 1 && st.w.lines(/Room: removed from !gone:hs: leaving its 1 channel$/, f2).length === 1,
    "D: one line a room — the one it left (named as held) and one the client never knew (its id)", st.w.lines(/Room: removed/, f2));
  // NEVER BEFORE THE FIRST SYNC.
  const ns = account({ sync: null });
  ns.w.Room.onRoomsChanged(() => {});
  ns.w.Room.resumeLeaves();
  ns.w.emit("Room.myMembership");
  await new Promise((r) => setTimeout(r, 700));
  ok(ns.w.leaveOrder.length === 0 && !ns.w.Room.leaveJob(ns.w.Room.LEFTOVERS), "D: NEVER BEFORE THE FIRST SYNC — nothing sent", ns.w.leaveOrder);
  ns.sync.state = "SYNCING";
  ns.w.emit("Room.myMembership");
  await later(() => ns.w.leaveOrder.length === 5, 6000);
  ok(ns.w.leaveOrder.length === 5, "D: and once it is in, they leave", ns.w.leaveOrder);
  // A ROOM IN A JOIN JOB IS NEVER TOUCHED: the leave asked first, Join Room by L's ID after it, both waiting their turns; when the
  // leave's turn comes, L is being joined, so its channels stay; the other leftover leaves.
  const j = account();
  let letGo = null;
  const held = j.w.MB.inTurn("leaving Room Z", { key: "!z:hs" }, () => new Promise((r) => { letGo = r; }));
  j.w.Room.autoLeaveLeftovers();
  await j.w.settle(5);
  const jp = j.w.Room.joinById("!l:hs");
  await j.w.settle(5);
  const jw = (j.w.Room.joinJobs() || []).find((q) => q.spaceId === "!l:hs");
  letGo(); await held;
  await later(() => j.w.Room.leaveJob(j.w.Room.LEFTOVERS) === null || j.w.Room.leaveJob(j.w.Room.LEFTOVERS).state === "failed", 6000);
  await jp;
  ok(jw && jw.state === "waiting" && JSON.stringify(j.w.leaveOrder) === JSON.stringify(["!g-chan:hs"]) && [j.L.ch.events_owner, j.L.ch.settings_owner].every((id) => j.hs.rooms[id].members[ME] === "join"),
    "D: NEVER A ROOM IN A JOIN JOB — L waiting to be joined by its ID when the leave's turn came: its channels stay; the other leftover leaves", { jw, sent: j.w.leaveOrder });
  // THE SET IS READ AGAIN AT THE START OF ITS TURN: back in L while the leave waits, so its channels are not left.
  const rr = clean();
  let let2 = null;
  const held2 = rr.w.MB.inTurn("leaving Room Z", { key: "!z:hs" }, () => new Promise((r) => { let2 = r; }));
  rr.hs.rooms["!l:hs"].members[ME] = "leave";
  rr.w.Room.autoLeaveLeftovers();
  await rr.w.settle(5);
  const waiting = rr.w.Room.leaveJob(rr.w.Room.LEFTOVERS);
  rr.hs.rooms["!l:hs"].members[ME] = "join";
  let2(); await held2;
  await later(() => !rr.w.Room.leaveJob(rr.w.Room.LEFTOVERS), 6000);
  ok(waiting && waiting.state === "waiting" && rr.w.leaveOrder.length === 0, "D: THE SET IS READ AGAIN AT THE START OF ITS TURN — back in the room while it waited, nothing of it is left", { waiting, sent: rr.w.leaveOrder });
  // A LEAVE THAT FAILED IS NOT TRIED AGAIN BY ITSELF — until a new leftover appears.
  const fl = clean();
  fl.hs.failNext["leave:" + fl.L.ch.settings_owner] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  fl.removed("leave");
  await later(() => fl.w.Room.leaveJob(fl.w.Room.LEFTOVERS) && fl.w.Room.leaveJob(fl.w.Room.LEFTOVERS).state === "failed", 6000);
  const n1 = fl.w.leaveOrder.length;
  fl.w.emit("Room.myMembership");
  await new Promise((r) => setTimeout(r, 700));
  ok(n1 === 4 && fl.w.leaveOrder.length === n1 && fl.w.Room.leaveJob(fl.w.Room.LEFTOVERS).state === "failed", "D: A LEAVE THAT FAILED IS NOT TRIED AGAIN BY ITSELF — its line keeps Leave again", { n1, now: fl.w.leaveOrder.length });
  fl.hs.rooms["!a:hs"].members[ME] = "leave";   // removed from another room: a new leftover
  fl.w.emit("Room.myMembership");
  await later(() => fl.w.Room.leftovers().count === 0 && !fl.w.Room.leaveJob(fl.w.Room.LEFTOVERS), 6000);
  ok(fl.w.leaveOrder.slice(n1).indexOf(fl.L.ch.settings_owner) >= 0 && Object.values(fl.A.ch).every((id) => fl.hs.rooms[id].members[ME] !== "join") && fl.w.Room.leftovers().count === 0,
    "D: A NEW LEFTOVER STARTS IT AGAIN — the new room's channels, and the one that failed, once more", fl.w.leaveOrder.slice(n1));
  // THE LINE SHOWS IT BY ITSELF, THEN GOES.
  const sc = clean();
  const sw = SW.world({ features: { Room: sc.w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const d = sw.doc, S = sw.sb.Screens;
  const add = (tag, id) => { const n = d.createElement(tag); n.id = id; d.body.appendChild(n); return n; };
  add("input", "input-join-code"); add("button", "btn-join-room");
  const list = add("div", "room-list"); add("span", "rooms-lock");
  S.showScreen("screen-rooms");
  S.renderRoomList(sc.w.Room.scanDDJPRooms());
  const lineOf = () => list.children.find((c) => /Leftover channels from rooms you left/.test(c.textContent)) || null;
  ok(!lineOf(), "D: PREMISE — no line while there is no leftover");
  const leave0 = sc.w.client.leave;
  let gate = null;
  sc.w.client.leave = async (id) => { if (gate) await gate.p; return leave0(id); };
  let rel; gate = { p: new Promise((q) => { rel = q; }) };
  sc.removed("leave");
  await later(() => lineOf() && /Leaving… 0 of 4 channels/.test(lineOf().textContent), 4000);
  ok(lineOf() && /Leftover channels from rooms you left: 4/.test(lineOf().textContent) && /Leaving… 0 of 4 channels/.test(lineOf().textContent) &&
     lineOf().querySelectorAll(".room-leave-track").length === 1 && !lineOf().querySelectorAll("button").length,
    "D: THE LINE SHOWS ITS LEAVE, UNASKED — \"Leaving… 0 of 4 channels\" over a bar, no button", lineOf() && lineOf().textContent);
  gate = null; rel();
  await later(() => !lineOf(), 6000);
  ok(!lineOf(), "D: WHEN NOTHING IS LEFT, THE LINE GOES", lineOf() && lineOf().textContent);
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[leftovers] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[leftovers] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[leftovers] PASS — leftover channels from rooms left before (the owner's \"yes\", `ddjp_691`; " + asserts + " assertions): " +
    "every room this account is in or invited to whose DDJP mark names a room it is neither in nor invited to is counted — never a " +
    "channel of a room it is in or invited to, the half-built room's, a DM, or a room without a complete mark, and nothing before the " +
    "first sync; Leave waits its turn at the door, leaves them one at a time with progress over them all, names a refusal by the " +
    "channel's name and leaves the rest, and Leave again sends only what is left; the room list shows one line at its end, no Leave " +
    "of its own (they leave by themselves), the failure with Leave again, and the line gone once none is left; and REMOVED FROM A ROOM " +
    "— kicked, banned, left elsewhere, seen live or found at start — its channels leave by themselves, one line a room saying why, " +
    "never before the first sync nor a room in a join job, the set read again at its turn, a failure not tried again until a new " +
    "leftover appears.");
  process.exit(0);
})();
