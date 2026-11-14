#!/usr/bin/env node
// tests/check-other-rooms.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, ui/screens.js, index.html
//
// WALL: OTHER MATRIX ROOMS, TO CLEAN UP (the owner's plan, part 2, JOB 3, `ddjp_695`; his "3 ok... but i tought it would be nice if
// our app could clean them for us instead having to open element and figure out what is legit or not in the sea of rooms", then
// "ok" to the closed line and the opened list; `main/05-matrix.md` §Rooms you can trust). ONE CLASSIFIER (`Room.otherRooms`):
// every room this account has joined that is none of — a DDJP room, a channel carrying a DDJP mark (a room's or a leftover), a
// conversation Messages lists, an invite, the room being created, a room in a join or leave job — a room whose creation record
// cannot be read left out. One closed line last in the room list; opened, every room, quietest first, its words from sync only;
// Leave on each row and Leave all (asked once), behind the lock, through the one leave at the one-at-a-time door, PACED: at least
// a second between automated sends — every leave gains it.
// Driven on the REAL modules over the homeserver model (`tests/_inviteworld.js`, `createRoom` modelled as a homeserver applies one)
// and the REAL ui/ files (`tests/_screen-world.js`) drawn over that same real room:
//   A  THE CLASSIFIER — the guard runs every kind of room DDJP makes through it, made by the REAL code (a shared room built and
//      upgraded through every batch, a bot room, a half-built room, a DM, a leftover channel) beside invites, a conversation, a room
//      in a join job, a room whose record cannot be read — and fails if any is listed; the other rooms are listed, quietest first,
//      unknown last, each with its words ("Space", "N people" / "Just you", "quiet for …" / "last activity …"); null before sync.
//   B  THE LEAVE — one row (a space left WITH its rooms, `ddjp_696`), all of them at the door, one at a time, the rooms in no space
//      first and each space after its own rooms, its progress, a refusal named and Leave again; PACED, a second or more between
//      sends — and a 19-channel room's leave too.
//   C  THE ROOM LIST — the line last and closed, only when N > 0; opened: Hide, the line under it, every room; locked no Leave;
//      unlocked Leave each and Leave all, which asks once ("Leave all N? Some can't be rejoined without a new invite.", "Leave all
//      anyway", "Cancel"); its progress "Leaving k of N…"; done, the line goes; closed again when the room list is left.
//   D  A SPACE LEFT WITH ITS ROOMS (`ddjp_696`, JOB 1; the owner's "i just really dont want us to leave spaces until we confirme we
//      left all the sub rooms"): its words ("N of your rooms inside"); its leave — every room it lists that this line lists, and
//      those of a space inside it, the whole tree, each read back, the space last and only if none failed; a failure keeps the
//      space and names what failed, Leave again finishes it; a space inside a space still in keeps the outer one; never a DDJP
//      channel, a DM or an invite inside it; its row asks once ("Leave <name> and the N rooms inside it you're in?"), a space with
//      none inside asks nothing; Leave all: the rooms first, each space after its own rooms.
// RED FIRST ON 694: `Room.otherRooms` and the bridge's `leaveRooms` do not exist (every part refuses by name), and the one leave is
// not paced. RED FIRST ON 695: a space is left alone (B's space row, all of D).
// CHANGED ON PURPOSE AT `ddjp_696` (JOB 1): A's space words ("1 of your rooms inside"), B's space row (left with its room, not
// alone) and B's order (the rooms in no space first, then the space after its room), C's first row's words.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ME = W.ME, OWNER = W.OWNER, FRIEND = "@friend:hs";
const DAY = 86400000, NOW = 1.95e12;

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[other-rooms] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[other-rooms] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const later = async (cond, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 15)); } return cond(); };
const tev = (ts) => ({ getTs: () => ts });

// ── THE ACCOUNT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// What DDJP makes, made here by its own code; and six rooms from elsewhere: a space (S, with a room of its own, SC), a group (G),
// a room with nobody else (A), one quiet for three days (D), one active today (T), and one whose activity is not held (N).
async function account(o) {
  o = o || {};
  const hs = W.homeserver();
  let made = 0;
  const rules = { failAt: null };
  const createRoom = async (opts) => {
    const cc = Object.assign({ room_version: opts.room_version || "1" }, opts.creation_content || {});
    if (rules.failAt !== null && rules.failAt === made) { rules.failAt = null; throw Object.assign(new Error("server error"), { errcode: "M_UNKNOWN", httpStatus: 500 }); }
    const id = "!ddjp" + (++made) + ":hs";
    const pl = ((opts.initial_state || []).find((e) => e.type === "m.room.power_levels") || {}).content || { users: {}, users_default: 0 };
    hs.room(id, { name: opts.name || ("room " + made), creator: ME, content: cc, members: { [ME]: "join" }, power: JSON.parse(JSON.stringify(pl)), parent: cc.ddjp_room || null });
    for (const u of (opts.invite || [])) hs.invite(id, u, { from: ME, direct: !!opts.is_direct });
    return { room_id: id };
  };
  const sync = { state: o.sync === undefined ? "SYNCING" : o.sync };
  const extra = {
    createRoom,
    getSyncState: () => sync.state,
    sendStateEvent: async (rid, type, content, key) => { if (type === "m.space.child" && hs.rooms[rid].children.indexOf(key) < 0) hs.rooms[rid].children.push(key); return {}; },
  };
  // `ddjp_697`: a paced send's gap (a second at most here) runs for real — an upgrade's reconcile is paced now, and its bot step
  // waits out the rest of that second on the rank clock.
  const timers = (fn, ms) => ((ms || 0) === 20000 ? (setImmediate(fn), 0) : ((ms || 0) <= 1000 ? setTimeout(fn, ms) : 0));   // the creation delay at once
  let pending = null;
  const store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate(p) { pending = p; }, clearPendingCreate() { pending = null; }, loadPendingCreate: () => pending, saveLeaving() {}, loadLeaving: () => [] } };
  const convo = { list: [] };
  const w = W.inviteWorld({ hs, client: extra, extras: { setTimeout: timers, Store: store, Chat: { conversations: () => convo.list } } });
  const paced = [];
  if (typeof w.MB._setJoinSleepForTest === "function") w.MB._setJoinSleepForTest((ms, why) => { if (why === "pace") paced.push(ms); return Promise.resolve(); });
  // ── WHAT DDJP MAKES, BY ITS OWN CODE ──
  const made1 = await w.MB.createDDJPSpace("Made shared", null, "backend1");
  hs.rooms[made1.spaceId].members[FRIEND] = "join";
  const top = (w.sb.Backends.planFor("backend1") || []).reduce((m, r) => Math.max(m, r.batch || 1), 1);
  let ch1 = Object.assign({}, made1.channels);
  for (let n = 2; n <= top; n++) ch1 = Object.assign(ch1, await w.MB.createUpgradeBatch(made1.spaceId, ch1, n));
  const made2 = await w.MB.createDDJPSpace("Made bot", null, "backend2");
  rules.failAt = made + 3;   // a create that stops part-way: the half-built room, kept to resume
  let half = null;
  try { await w.Room.create("Half built", "backend1"); } catch (e) { half = w.Room.pendingCreate(); }
  const dm = await w.MA.createDM(FRIEND);
  hs.rooms[dm].members[FRIEND] = "join";
  // A leftover: a channel this account is still in, marked for a room it left.
  hs.room("!lost:hs", { name: "lost-events", content: { room_version: "12", ddjp_room: "!gone:hs", ddjp_kind: "events_owner" }, members: { [ME]: "join", [OWNER]: "join" } });
  // An invite to a DDJP room, and one to a room from elsewhere.
  const inv = hs.ddjpRoom("!inv:hs", { name: "Invited room" });
  hs.invite("!inv:hs", ME, { from: OWNER });
  hs.room("!einv:hs", { name: "Element invite", content: { room_version: "11" }, members: { [OWNER]: "join" } });
  hs.invite("!einv:hs", ME, { from: OWNER });
  // A group conversation Messages lists (its device index), not a one-to-one room.
  hs.room("!convo:hs", { name: "Group chat in Messages", content: { room_version: "11" }, members: { [ME]: "join", [OWNER]: "join", [FRIEND]: "join" } });
  convo.list = [{ userId: OWNER, roomIds: ["!convo:hs"], roomId: "!convo:hs", lastTs: NOW, unread: false }];
  // A room whose creation record cannot be read (joined, its state not synced).
  hs.room("!unread:hs", { name: "Not synced", content: { room_version: "11" }, members: { [ME]: "join" } });
  hs.rooms["!unread:hs"].unsynced = true;
  // ── SIX ROOMS FROM ELSEWHERE ──
  const other = (id, name, o2) => {
    hs.room(id, Object.assign({ name, content: Object.assign({ room_version: "11" }, o2.space ? { type: "m.space" } : {}), members: Object.assign({ [ME]: "join" }, o2.people || {}), creator: OWNER }, o2.extra || {}));
    const v = w.client.getRoom(id);
    if (typeof o2.ago === "number") v.timeline = [tev(NOW - o2.ago)];
    return id;
  };
  const S = other("!s:hs", "Old space", { space: true, people: { [OWNER]: "join" }, ago: 400 * DAY });
  const SC = other("!sc:hs", "Old space's room", { people: { [OWNER]: "join", [FRIEND]: "join" }, ago: 200 * DAY });
  hs.rooms[S].children.push(SC);
  const G = other("!g:hs", "Big group", { people: { [OWNER]: "join", [FRIEND]: "join", "@a:hs": "join", "@b:hs": "join" }, ago: 100 * DAY });
  const A = other("!a:hs", "Alone", { ago: 10 * DAY });
  const D = other("!d:hs", "Three days", { people: { [OWNER]: "join" }, ago: 3 * DAY + 3600000 });
  const T = other("!t:hs", "Today", { people: { [OWNER]: "join" }, ago: 2 * 3600000 });
  const N = other("!n:hs", "Unknown", { people: { [OWNER]: "join" } });
  // N holds no event with a time, not even this account's own membership's (the model stamps one at 1000; a held one has its time).
  { const v = w.client.getRoom(N), gse = v.currentState.getStateEvents;
    v.currentState = { getStateEvents: (type, key) => (type === "m.room.member" && key === ME ? { getTs: () => undefined, getContent: () => ({ membership: "join" }) } : gse(type, key)) }; }
  // The newest server time this account holds: a message in the DM, now.
  w.client.getRoom(dm).timeline = [tev(NOW)];
  // My own membership event's time in the six is old (the invite world stamps 1000), so the timeline decides.
  return { hs, w, sync, paced, rules, made1, ch1, made2, half, dm, inv, convo, S, SC, G, A, D, T, N,
    junk: [S, SC, G, A, D, T, N],
    ddjpIds() { return [made1.spaceId].concat(Object.values(ch1), [made2.spaceId], Object.values(made2.channels), half ? [half.spaceId] : [], Object.keys(hs.rooms).filter((id) => hs.rooms[id].create.content.ddjp_room === (half && half.spaceId))); } };
}
const applied = (w) => typeof w.Room.otherRooms === "function" && typeof w.Room.leaveOtherRooms === "function" && typeof w.MB.leaveRooms === "function";

// ── A — THE CLASSIFIER ─────────────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const x = await account();
  ok(applied(x.w), "A: APPLIED — `Room.otherRooms`, `Room.leaveOtherRooms` and the bridge's `leaveRooms` exist", typeof x.w.Room.otherRooms);
  if (!applied(x.w)) return;
  const o = x.w.Room.otherRooms();
  const ids = (o && o.rooms || []).map((r) => r.roomId);
  ok(x.half && x.half.spaceId && x.made1.spaceId && x.made2.spaceId && x.dm, "A: PREMISE — the real code made a shared room through every batch, a bot room, a half-built room and a DM", { half: x.half, dm: x.dm });
  const ddjp = x.ddjpIds();
  ok(ddjp.length >= 1 + 19 + 1 + 7 + 1 && ddjp.every((id) => ids.indexOf(id) < 0),
    "A: NONE OF WHAT DDJP MAKES IS LISTED — every room and channel the real creation, upgrade and half-built create made (" + ddjp.length + ")", ddjp.filter((id) => ids.indexOf(id) >= 0));
  const never = { "a DM (Matrix's own list)": x.dm, "a leftover channel": "!lost:hs", "an invite to a DDJP room": "!inv:hs", "an invite from elsewhere": "!einv:hs",
    "a conversation Messages lists": "!convo:hs", "a room whose creation record cannot be read": "!unread:hs" };
  for (const what of Object.keys(never)) ok(ids.indexOf(never[what]) < 0, "A: NEVER " + what.toUpperCase(), ids);
  ok(o && o.count === x.junk.length && x.junk.every((id) => ids.indexOf(id) >= 0), "A: THE OTHER ROOMS ARE LISTED — all " + x.junk.length + ", the space's own room among them", ids);
  ok(JSON.stringify(ids) === JSON.stringify([x.S, x.SC, x.G, x.A, x.D, x.T, x.N]), "A: QUIETEST FIRST, the room whose activity is not held last", ids);
  ok(o && o.now === NOW, "A: \"now\" is the newest server time this account holds (a message in the DM), never the device's clock", o && o.now);
  const words = (id) => x.w.Room.otherRoomWords(o.rooms.find((r) => r.roomId === id), o.now).join(" · ");
  ok(words(x.S) === "Space · 1 of your rooms inside · 2 people · quiet for 1 year", "A: a space — \"Space · 1 of your rooms inside · 2 people · quiet for 1 year\" (`ddjp_696`: its room counted)", words(x.S));
  ok(words(x.G) === "5 people · quiet for 3 months", "A: a group — \"5 people · quiet for 3 months\"", words(x.G));
  ok(words(x.A) === "Just you · last activity 1 week ago", "A: alone — \"Just you · last activity 1 week ago\"", words(x.A));
  ok(words(x.D) === "2 people · last activity 3 days ago", "A: three days — \"2 people · last activity 3 days ago\"", words(x.D));
  ok(words(x.T) === "2 people · last activity today", "A: today — \"2 people · last activity today\"", words(x.T));
  ok(words(x.N) === "2 people", "A: UNKNOWN ACTIVITY IS SAID AS NOTHING — \"2 people\"", words(x.N));
  // A ROOM IN A JOIN JOB: Join Room by an ID, the room joined and found not DDJP, its leave again in flight — not listed meanwhile.
  x.hs.room("!jj:hs", { name: "Joined by ID", content: { room_version: "11" }, members: { [OWNER]: "join" }, joinRule: "public", creator: OWNER });
  let letLeave = null;
  const leave0 = x.w.client.leave;
  x.w.client.leave = async (id) => { if (id === "!jj:hs") await new Promise((r) => { letLeave = r; }); return leave0(id); };
  const jp = x.w.Room.joinById("!jj:hs");
  await later(() => typeof letLeave === "function", 3000);
  const mid = x.w.Room.otherRooms();
  ok(x.hs.rooms["!jj:hs"].members[ME] === "join" && mid && mid.rooms.every((r) => r.roomId !== "!jj:hs"), "A: NEVER A ROOM IN A JOIN JOB — joined, readable, not DDJP, its leave in flight: not listed", mid && mid.rooms.map((r) => r.roomId));
  if (letLeave) letLeave();
  await jp;
  x.w.client.leave = leave0;
  // NOT DECIDED BEFORE THE FIRST SYNC.
  x.sync.state = null;
  ok(x.w.Room.otherRooms() === null, "A: NOT DECIDED BEFORE THE FIRST SYNC — null, not 0", x.w.Room.otherRooms());
  x.sync.state = "SYNCING";
});

// ── B — THE LEAVE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const x = await account();
  if (!applied(x.w)) { ok(false, "B: APPLIED — `Room.leaveOtherRooms` exists"); return; }
  // ONE ROW, A SPACE (`ddjp_696`): left WITH its room — the room first, read back, then the space.
  const n1 = x.hs.leaves.length;
  const r1 = await x.w.Room.leaveOtherRooms([x.S]);
  ok(r1 && r1.ok === true && x.hs.rooms[x.S].members[ME] === "leave" && x.hs.rooms[x.SC].members[ME] === "leave" &&
     JSON.stringify(x.hs.leaves.slice(n1)) === JSON.stringify([ME + " " + x.SC, ME + " " + x.S]) && !x.w.Room.otherRooms().rooms.some((r) => r.roomId === x.SC),
    "B: A SPACE IS LEFT WITH ITS ROOM — its room first, then the space; neither listed now", { r1, sent: x.hs.leaves.slice(n1) });
  x.hs.rooms[x.S].members[ME] = "join"; x.hs.rooms[x.SC].members[ME] = "join";   // back in both, for Leave all below
  // ALL OF THEM, IN ITS TURN AT THE DOOR, ONE AT A TIME, PACED.
  let letGo = null;
  const held = x.w.MB.inTurn("leaving Room Z", { key: "!z:hs" }, () => new Promise((r) => { letGo = r; }));
  const seen = [];
  x.w.Room.onLeaveJob((k) => { if (k !== x.w.Room.OTHERS) return; const j = x.w.Room.leaveJob(k); seen.push(j ? { state: j.state, done: j.done, total: j.total, waitsFor: j.waitsFor } : null); });
  const order = [];
  const leave0 = x.w.client.leave;
  x.w.client.leave = async (id) => { order.push({ id, paced: x.paced.slice() }); return leave0(id); };
  const ids = x.w.Room.otherRooms().rooms.map((r) => r.roomId);
  const p = x.w.Room.leaveOtherRooms(ids, { all: true });
  await x.w.settle(10);
  ok(order.length === 0 && seen.some((j) => j && j.state === "waiting" && j.waitsFor === "leaving Room Z"), "B: LEAVE ALL WAITS ITS TURN AT THE DOOR — nothing sent, and it says what for", { order, seen });
  x.paced.length = 0;
  letGo(); await held;
  const r = await p;
  await x.w.settle(10);
  ok(r && r.ok === true && r.total === ids.length && r.left === ids.length && x.w.Room.otherRooms().count === 0, "B: EVERY ROOM LISTED IS LEFT — " + ids.length + " of " + ids.length + ", none listed now", r);
  const want = ids.filter((id) => id !== x.S && id !== x.SC).concat([x.SC, x.S]);
  ok(JSON.stringify(order.map((q) => q.id)) === JSON.stringify(want), "B: ONE AT A TIME — the rooms in no space first, in the list's order, then the space after its own room (`ddjp_696`)", order.map((q) => q.id));
  const running = seen.filter((j) => j && j.state === "running").map((j) => j.done + "/" + j.total);
  ok(running[0] === "0/" + ids.length && running[running.length - 1] === ids.length + "/" + ids.length, "B: ITS PROGRESS COUNTS THEM ALL", running);
  const pacedNow = x.paced.filter((ms) => ms >= 500);
  ok(pacedNow.length >= ids.length - 1 && pacedNow.reduce((a, b) => a + b, 0) >= (ids.length - 1) * 900, "B: PACED — the one send pacer between its sends (a second at least, less what the send itself took)", x.paced);
  ok(x.hs.rooms[x.made1.spaceId].members[ME] === "join" && x.hs.rooms[x.dm].members[ME] === "join" && x.hs.rooms["!convo:hs"].members[ME] === "join", "B: AND NOTHING ELSE IS TOUCHED — DDJP's rooms, the DM, the conversation");
  ok(x.w.lines(/Room: left the other Matrix rooms — \d+ of \d+ room\(s\)/).length === 1, "B: and the room's line, counting rooms", x.w.lines(/other Matrix rooms/));
  ok(x.w.lines(/MatrixBridge: leaving \d+ other Matrix rooms — .* — \d+ of \d+ rooms left$/).length === 1, "B: and the transport's, counting rooms too", x.w.lines(/other Matrix rooms/));
  // A REFUSAL NAMED; LEAVE AGAIN SENDS ONLY WHAT IS LEFT.
  const y = await account();
  y.hs.failNext["leave:" + y.G] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const yids = y.w.Room.otherRooms().rooms.map((q) => q.roomId);
  const ry = await y.w.Room.leaveOtherRooms(yids, { all: true });
  const jy = y.w.Room.leaveJob(y.w.Room.OTHERS);
  ok(ry && ry.ok === false && jy && jy.state === "failed" && jy.left === yids.length - 1 && JSON.stringify(jy.failed) === JSON.stringify([{ label: "Big group", why: "refused: M_FORBIDDEN" }]),
    "B: A REFUSAL IS NAMED by the room's name, and the rest leave", jy);
  const before = y.hs.leaves.length;
  const ry2 = await y.w.Room.leaveOtherRooms(y.w.Room.otherRooms().rooms.map((q) => q.roomId), { all: true });
  ok(ry2 && ry2.ok === true && y.hs.leaves.slice(before).join() === ME + " " + y.G, "B: LEAVE AGAIN SENDS ONLY WHAT IS LEFT", y.hs.leaves.slice(before));
  // A PUSH-BACK WIDENS THE GAP: a 429 on one leave, and the send after it comes further apart (the pacer doubles, then eases).
  const q = await account();
  q.hs.failNext["leave:" + q.G] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  q.paced.length = 0;
  const marks = [];
  const qleave0 = q.w.client.leave;
  q.w.client.leave = async (id) => { marks.push({ id, paced: q.paced.length }); return qleave0(id); };
  const rq = await q.w.Room.leaveOtherRooms(q.w.Room.otherRooms().rooms.map((x2) => x2.roomId), { all: true });
  const after = marks.findIndex((m, i) => i > 0 && marks[i - 1].id === q.G && m.id === q.G);   // the retry of the room pushed back
  const gapAfter = after > 0 ? q.paced.slice(marks[after - 1].paced, marks[after].paced).reduce((a, b) => a + b, 0) : 0;
  ok(rq && rq.ok === true && after > 0 && gapAfter >= 1500, "B: A PUSH-BACK WIDENS THE GAP — after a 429, the next send waits longer than the floor (" + gapAfter + " ms)", { rq, marks, paced: q.paced });
  // EVERY LEAVE GAINS IT: a 19-channel room's leave for good, a second or more between its sends.
  const z = await account();
  z.paced.length = 0;
  const rz = await z.w.Room.leaveForGood(z.made1.spaceId);
  const zp = z.paced.filter((ms) => ms >= 500);
  ok(rz && rz.ok === true && rz.total === 19 && zp.length >= 19 && zp.reduce((a, b) => a + b, 0) >= 19 * 900,
    "B: EVERY LEAVE GAINS IT — a 19-channel room's leave for good: its 20 sends paced, " + Math.round(zp.reduce((a, b) => a + b, 0) / 1000) + " s of pacing in all", { rz, paced: z.paced.length });
});

// ── C — THE ROOM LIST ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function screen(x) {
  const sw = SW.world({ features: { Room: x.w.Room, Chat: { conversations: () => x.convo.list, dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const doc = sw.doc, S = sw.sb.Screens;
  const add = (tag, id) => { const n = doc.createElement(tag); n.id = id; doc.body.appendChild(n); return n; };
  add("input", "input-join-code"); add("button", "btn-join-room");
  const list = add("div", "room-list"), lock = add("span", "rooms-lock");
  S.showScreen("screen-rooms");
  S.renderRoomList(x.w.Room.scanDDJPRooms());
  const line = () => list.children.find((c) => /Other Matrix rooms on this account \(not DDJP\)/.test(c.textContent)) || null;
  const btn = (n, t) => n ? n.querySelectorAll("button").find((b) => b.textContent === t) || null : null;
  return { sw, S, list, lock, line, btn, unlock() { lock.querySelectorAll(".panel-lock-btn")[0].click(); }, render() { S.renderRoomList(x.w.Room.scanDDJPRooms()); } };
}
part("C", async () => {
  const x = await account();
  if (!applied(x.w)) { ok(false, "C: APPLIED — `Room.otherRooms` exists (the list has nothing to read)"); return; }
  const s = screen(x);
  const l = s.line();
  ok(l && l === s.list.children[s.list.children.length - 1] && l.querySelectorAll(".room-invite-name")[0].textContent === "Other Matrix rooms on this account (not DDJP): 7",
    "C: ONE LINE, LAST IN THE ROOM LIST — \"Other Matrix rooms on this account (not DDJP): 7\"", l && l.textContent);
  ok(l && s.btn(l, "Show") && !s.btn(l, "Hide") && !l.querySelectorAll(".room-other-row").length, "C: CLOSED, WITH SHOW", l && l.querySelectorAll("button").map((b) => b.textContent));
  s.btn(l, "Show").click();
  const o = s.line();
  const rows = o ? o.querySelectorAll(".room-other-row") : [];
  ok(o && s.btn(o, "Hide") && !s.btn(o, "Leave all") && rows.length === 7 && rows.every((r) => !s.btn(r, "Leave")), "C: OPENED, LOCKED — Hide, every room (7), no Leave anywhere", o && o.textContent.slice(0, 200));
  ok(o && o.querySelectorAll(".room-other-intro")[0] && o.querySelectorAll(".room-other-intro")[0].textContent === "Quietest first. Not listed: DDJP rooms, and your chats and invites (those are in Messages).",
    "C: UNDER IT: \"Quietest first. Not listed: DDJP rooms, and your chats and invites (those are in Messages).\"", o && o.textContent.slice(0, 200));
  ok(rows.length && rows[0].querySelectorAll(".room-other-name")[0].textContent === "Old space" && rows[0].querySelectorAll(".room-other-sub")[0].textContent === "Space · 1 of your rooms inside · 2 people · quiet for 1 year" &&
     rows[rows.length - 1].querySelectorAll(".room-other-name")[0].textContent === "Unknown" && rows[rows.length - 1].querySelectorAll(".room-other-sub")[0].textContent === "2 people",
    "C: ONE ROW PER ROOM — its name, its words under it; quietest first", rows.map((r) => r.textContent));
  const listBox = o ? o.querySelectorAll(".room-other-list")[0] : null;
  ok(listBox && s.sw.cas.declared(listBox, "overflow-y") && s.sw.cas.declared(listBox, "overflow-y").val === "auto", "C: EVERY ROOM, IN A LIST THAT SCROLLS (not a sample)", listBox && s.sw.cas.declared(listBox, "overflow-y"));
  s.unlock();
  const u = s.line();
  ok(u && s.btn(u, "Leave all") && u.querySelectorAll(".room-other-row").every((r) => s.btn(r, "Leave")), "C: UNLOCKED — Leave all on the line, Leave on each row", u && u.querySelectorAll("button").map((b) => b.textContent));
  s.btn(u, "Leave all").click();
  const ask = s.line();
  ok(ask && /Leave all 7\? Some can't be rejoined without a new invite\./.test(ask.textContent) && s.btn(ask, "Leave all anyway") && s.btn(ask, "Cancel") && x.hs.leaves.length === 0,
    "C: LEAVE ALL ASKS ONCE — \"Leave all 7? Some can't be rejoined without a new invite.\", \"Leave all anyway\", \"Cancel\"; nothing sent", ask && ask.textContent.slice(0, 220));
  s.btn(ask, "Cancel").click();
  ok(s.line() && !/Leave all 7\?/.test(s.line().textContent) && x.hs.leaves.length === 0, "C: CANCEL — the question goes, nothing sent");
  // LEAVING: its progress in the line, "Leaving k of 7…", then the line goes.
  const leave0 = x.w.client.leave;
  let gate = null;
  x.w.client.leave = async (id) => { if (gate) await gate.p; return leave0(id); };
  s.btn(s.line(), "Leave all").click();
  let r; gate = { p: new Promise((q) => { r = q; }) }; gate.r = r;
  s.btn(s.line(), "Leave all anyway").click();
  await later(() => s.line() && /Leaving 0 of 7…/.test(s.line().textContent), 3000);
  ok(s.line() && /Leaving 0 of 7…/.test(s.line().textContent) && s.line().querySelectorAll(".room-leave-track").length === 1, "C: ITS PROGRESS IN THE LINE — \"Leaving 0 of 7…\" over a bar", s.line() && s.line().textContent.slice(0, 160));
  gate = null; r();
  await later(() => !s.line(), 6000);
  ok(!s.line() && x.w.Room.otherRooms().count === 0, "C: DONE — none left, and the line goes", s.line() && s.line().textContent.slice(0, 160));
  x.w.client.leave = leave0;
  // CLOSED AGAIN WHEN THE ROOM LIST IS LEFT.
  const y = await account();
  const t = screen(y);
  t.btn(t.line(), "Show").click();
  ok(t.btn(t.line(), "Hide"), "C: PREMISE — opened");
  t.S.showScreen("screen-main"); t.S.showScreen("screen-rooms"); t.render();
  ok(t.line() && t.btn(t.line(), "Show") && !t.line().querySelectorAll(".room-other-row").length, "C: CLOSED AGAIN WHEN THE ROOM LIST IS LEFT", t.line() && t.line().textContent.slice(0, 120));
  // A FAILURE: what failed, and Leave again.
  y.hs.failNext["leave:" + y.A] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  t.unlock();
  t.btn(t.line(), "Show").click();
  const arow = t.line().querySelectorAll(".room-other-row").find((q) => /Alone/.test(q.textContent));
  t.btn(arow, "Leave").click();
  await later(() => t.line() && /Couldn't leave/.test(t.line().textContent), 4000);
  ok(t.line() && /Left 0 of 1\. Couldn't leave: Alone \(refused: M_FORBIDDEN\)\./.test(t.line().textContent) && t.line().querySelectorAll("button").some((b) => b.textContent === "Leave again"),
    "C: ONE ROW'S LEAVE THAT FAILS — \"Left 0 of 1. Couldn't leave: Alone (refused: M_FORBIDDEN).\" with Leave again, on its row", t.line() && t.line().textContent.slice(0, 400));
  // THE LOCK IS THERE WHEN ONLY OTHER ROOMS ARE (their Leave is behind it).
  const only = await account();
  for (const id of Object.keys(only.hs.rooms)) { const c = only.hs.rooms[id].create.content; if (c.ddjp_mode || c.ddjp_room || c.ddjp_kind) only.hs.rooms[id].members[ME] = "leave"; }
  only.w.Room.discardPendingCreate && await only.w.Room.discardPendingCreate();
  const ol = screen(only);
  ok(ol.line() && ol.lock.querySelectorAll(".panel-lock-btn").length === 1 && !only.w.Room.scanDDJPRooms().owned.length, "C: WITH NO DDJP ROOM BUT OTHER ROOMS, the line and its lock are there", ol.list.textContent.slice(0, 160));
  // NO LINE WHEN THERE ARE NONE.
  const z = await account();
  for (const id of z.junk) z.hs.rooms[id].members[ME] = "leave";
  const v = screen(z);
  ok(!v.line(), "C: SHOWN ONLY WHEN N > 0 — no line when there are none", v.list.textContent.slice(0, 160));
});

// ── D — A SPACE LEFT WITH ITS ROOMS (`ddjp_696`, JOB 1) ────────────────────────────────────────────────────────────────────────
// A tree from elsewhere: P "Outer space" lists P1, the space Q "Inner space" (which lists Q1), and — never to be left — a channel of
// the shared room DDJP made, the DM, and a room this account is only invited to; E "Empty space" lists nothing this account is in.
async function treeAccount() {
  const x = await account();
  const sp = (id, name, kids, ago) => {
    x.hs.room(id, { name, content: { room_version: "11", type: "m.space" }, members: { [ME]: "join", [OWNER]: "join" }, creator: OWNER, children: kids });
    x.w.client.getRoom(id).timeline = [tev(NOW - ago * DAY)];
  };
  const rm = (id, name, ago) => {
    x.hs.room(id, { name, content: { room_version: "11" }, members: { [ME]: "join", [OWNER]: "join" }, creator: OWNER });
    x.w.client.getRoom(id).timeline = [tev(NOW - ago * DAY)];
  };
  rm("!p1:hs", "Outer room", 50); rm("!q1:hs", "Inner room", 55);
  x.hs.room("!pi:hs", { name: "Invited inside", content: { room_version: "11" }, members: { [OWNER]: "join" }, creator: OWNER });
  x.hs.invite("!pi:hs", ME, { from: OWNER });
  sp("!q:hs", "Inner space", ["!q1:hs"], 60);
  sp("!p:hs", "Outer space", ["!p1:hs", "!q:hs", x.ch1.events_owner, x.dm, "!pi:hs"], 70);
  sp("!e:hs", "Empty space", ["!nowhere:hs"], 80);
  return Object.assign(x, { P: "!p:hs", P1: "!p1:hs", Q: "!q:hs", Q1: "!q1:hs", PI: "!pi:hs", E: "!e:hs" });
}
part("D", async () => {
  const x = await treeAccount();
  if (!applied(x.w) || typeof x.w.MB.leaveRoomGroups !== "function") { ok(false, "D: APPLIED — a space's leave with its rooms (`MatrixBridge.leaveRoomGroups`)", typeof x.w.MB.leaveRoomGroups); return; }
  const o = x.w.Room.otherRooms();
  const row = (id) => o.rooms.find((r) => r.roomId === id);
  const words = (id) => x.w.Room.otherRoomWords(row(id), o.now).join(" · ");
  ok(row(x.P) && row(x.P).inside === 3 && /^Space · 3 of your rooms inside · /.test(words(x.P)),
    "D: A SPACE'S WORDS SAY HOW MANY OF YOUR ROOMS ARE INSIDE IT, AT ANY DEPTH — \"Space · 3 of your rooms inside\" (its room, the space inside it and that one's room; not the DDJP channel, the DM or the invite)", { inside: row(x.P) && row(x.P).inside, words: words(x.P) });
  ok(row(x.Q) && row(x.Q).inside === 1 && /^Space · 1 of your rooms inside · /.test(words(x.Q)), "D: the space inside it — \"1 of your rooms inside\"", words(x.Q));
  ok(row(x.E) && row(x.E).inside === 0 && !/inside/.test(words(x.E)), "D: A SPACE WITH NONE INSIDE SAYS NOTHING OF IT", words(x.E));
  // ITS LEAVE: the space inside first (its room, then it), then its own room, then the space — each space only once its rooms are out.
  const n0 = x.hs.leaves.length, from = x.w.logs.length;
  const r = await x.w.Room.leaveOtherRooms([x.P]);
  const sent = x.hs.leaves.slice(n0).map((q) => q.split(" ")[1]);
  ok(r && r.ok === true && JSON.stringify(sent) === JSON.stringify([x.Q1, x.Q, x.P1, x.P]),
    "D: THE WHOLE TREE, THE SPACE LAST — the inner room, the inner space, the outer room, then the outer space", { r, sent });
  ok([x.Q1, x.Q, x.P1, x.P].every((id) => x.hs.rooms[id].members[ME] === "leave"), "D: and each is out");
  ok(x.hs.rooms[x.ch1.events_owner].members[ME] === "join" && x.hs.rooms[x.dm].members[ME] === "join" && x.hs.rooms[x.PI].members[ME] === "invite",
    "D: NEVER A DDJP CHANNEL, A DM OR AN INVITE INSIDE IT — the one classifier decides; they stay", { ddjp: x.hs.rooms[x.ch1.events_owner].members[ME], dm: x.hs.rooms[x.dm].members[ME], inv: x.hs.rooms[x.PI].members[ME] });
  ok(x.w.lines(/MatrixBridge: leaving Inner space and the rooms inside it — .* — 1 of 1 room left, the room itself left$/, from).length === 1 &&
     x.w.lines(/MatrixBridge: leaving Outer space and the rooms inside it — Outer room left; the room itself left — 1 of 1 room left, the room itself left$/, from).length === 1 &&
     x.w.lines(/Room: left Outer space — 4 of 4 room\(s\)/, from).length === 1,
    "D: ITS LINES — each space's leave, its rooms by their names and then the room itself, and the row's: 4 of 4", x.w.lines(/space|Outer|Inner/, from));
  // A FAILURE KEEPS THE SPACE AND NAMES WHAT FAILED; LEAVE AGAIN FINISHES IT.
  const y = await treeAccount();
  y.hs.failNext["leave:" + y.P1] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const ry = await y.w.Room.leaveOtherRooms([y.P]);
  const jy = y.w.Room.leaveJob(y.w.Room.OTHERS + ":" + y.P);
  ok(ry && ry.ok === false && y.hs.rooms[y.P].members[ME] === "join" && y.hs.rooms[y.Q].members[ME] === "leave" && y.hs.rooms[y.Q1].members[ME] === "leave" &&
     jy && jy.state === "failed" && jy.left === 2 && jy.total === 4 &&
     JSON.stringify(jy.failed) === JSON.stringify([{ label: "Outer room", why: "refused: M_FORBIDDEN" }, { label: "Outer space", why: "not tried: a room inside it is still in" }]),
    "D: A ROOM INSIDE THAT WILL NOT LEAVE KEEPS THE SPACE — the space not tried, both named; the space inside it (its room out) left", { ry, jy });
  const n2 = y.hs.leaves.length;
  const ry2 = await y.w.Room.leaveOtherRooms([y.P]);
  ok(ry2 && ry2.ok === true && JSON.stringify(y.hs.leaves.slice(n2).map((q) => q.split(" ")[1])) === JSON.stringify([y.P1, y.P]),
    "D: LEAVE AGAIN FINISHES IT — the room, then the space", y.hs.leaves.slice(n2));
  // A SPACE INSIDE IT THAT STAYS KEEPS THE OUTER ONE TOO; the outer one's own room still leaves.
  const z = await treeAccount();
  z.hs.failNext["leave:" + z.Q1] = [{ errcode: "M_FORBIDDEN", httpStatus: 403 }];
  const rz = await z.w.Room.leaveOtherRooms([z.P]);
  const jz = z.w.Room.leaveJob(z.w.Room.OTHERS + ":" + z.P);
  ok(rz && rz.ok === false && z.hs.rooms[z.Q].members[ME] === "join" && z.hs.rooms[z.P].members[ME] === "join" && z.hs.rooms[z.P1].members[ME] === "leave" &&
     jz && JSON.stringify(jz.failed) === JSON.stringify([{ label: "Inner room", why: "refused: M_FORBIDDEN" }, { label: "Inner space", why: "not tried: a room inside it is still in" },
       { label: "Outer space", why: "not tried: a space inside it is still in" }]),
    "D: A SPACE INSIDE IT STILL IN KEEPS THE OUTER SPACE — both spaces stay, named; the outer one's own room is left", { rz, jz });
  // THE ROW ASKS ONCE; A SPACE WITH NONE INSIDE ASKS NOTHING.
  const v = await treeAccount();
  const s1 = screen(v);
  s1.unlock();
  s1.btn(s1.line(), "Show").click();
  const prow = () => s1.line().querySelectorAll(".room-other-row").find((q) => q.querySelectorAll(".room-other-name")[0].textContent === "Outer space");
  const pitem = () => { const r0 = prow(); return r0 && r0.parentNode && /room-other-item/.test(r0.parentNode.className || "") ? r0.parentNode : r0; };
  const n3 = v.hs.leaves.length;
  s1.btn(prow(), "Leave").click();
  const asked = pitem();
  ok(asked && /Leave Outer space and the 3 rooms inside it you're in\?/.test(asked.textContent) && s1.btn(asked, "Leave anyway") && s1.btn(asked, "Cancel") && v.hs.leaves.length === n3,
    "D: ITS LEAVE ASKS ONCE — \"Leave Outer space and the 3 rooms inside it you're in?\", \"Leave anyway\", \"Cancel\"; nothing sent", asked && asked.textContent.slice(0, 260));
  s1.btn(pitem(), "Cancel").click();
  ok(!/you're in\?/.test(pitem().textContent) && s1.btn(prow(), "Leave") && v.hs.leaves.length === n3, "D: CANCEL — the question goes, nothing sent", pitem().textContent.slice(0, 160));
  s1.btn(prow(), "Leave").click();
  s1.btn(pitem(), "Leave anyway").click();
  await later(() => v.hs.rooms[v.P].members[ME] === "leave", 4000);
  ok(v.hs.rooms[v.P].members[ME] === "leave" && v.hs.rooms[v.Q1].members[ME] === "leave", "D: LEAVE ANYWAY — the space and its rooms leave", v.hs.leaves.slice(n3));
  const erow = s1.line().querySelectorAll(".room-other-row").find((q) => q.querySelectorAll(".room-other-name")[0].textContent === "Empty space");
  const n4 = v.hs.leaves.length;
  s1.btn(erow, "Leave").click();
  await later(() => v.hs.rooms[v.E].members[ME] === "leave", 4000);
  ok(JSON.stringify(v.hs.leaves.slice(n4)) === JSON.stringify([ME + " " + v.E]), "D: A SPACE WITH NONE INSIDE ASKS NOTHING — left at once", v.hs.leaves.slice(n4));
  // LEAVE ALL: the rooms in no space first, then each space after its own rooms.
  const a = await treeAccount();
  const ids = a.w.Room.otherRooms().rooms.map((q) => q.roomId);
  const n5 = a.hs.leaves.length;
  const ra = await a.w.Room.leaveOtherRooms(ids, { all: true });
  const seq = a.hs.leaves.slice(n5).map((q) => q.split(" ")[1]);
  const at = (id) => seq.indexOf(id);
  const plain = ids.filter((id) => [a.S, a.SC, a.P, a.P1, a.Q, a.Q1, a.E].indexOf(id) < 0);
  ok(ra && ra.ok === true && seq.length === ids.length && JSON.stringify(seq.slice(0, plain.length)) === JSON.stringify(plain) &&
     at(a.SC) < at(a.S) && at(a.Q1) < at(a.Q) && at(a.Q) < at(a.P) && at(a.P1) < at(a.P),
    "D: LEAVE ALL — the rooms in no space first, in the list's order, then each space only after its own rooms (and a space inside it)", { seq, plain });
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[other-rooms] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[other-rooms] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[other-rooms] PASS — other Matrix rooms, to clean up (the owner's plan, part 2, JOB 3; " + asserts + " assertions): one " +
    "classifier lists every joined room that is not DDJP's — none of the rooms DDJP's own code makes, nor a DM, a conversation, an " +
    "invite, a leftover, a half-built or joining room, nor one whose record cannot be read — quietest first with its words from sync; " +
    "one closed line last in the list, opened with Hide, Leave each and Leave all (asked once) behind the lock; leaves through the one " +
    "leave at the door, one at a time, with progress, a refusal named and Leave again; a space left WITH its rooms, the whole tree, " +
    "each space last and only once its rooms are out, a failure keeping it, its row asking once (none inside, nothing asked), never " +
    "a DDJP channel, a DM or an invite inside it, Leave all the rooms first; every leave paced, a " +
    "19-channel room's included; the line closed again when the list is left.");
  process.exit(0);
})();
