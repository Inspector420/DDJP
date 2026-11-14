#!/usr/bin/env node
// tests/check-leave-room.js
// SUBJECT: features/room.js, backends/backend1/matrixbridge.js, ui/screens.js, index.html, core/store.js, core/storageio.js, app.js
//
// WALL: LEAVE A ROOM FOR GOOD (J139; the owner's, `?v=605`: "in element we dont quit rooms rigth, so we may want to have an
// opotion to leave roomms that checks for errors and auto resumes leaving rooms if we wish to from out app"; his answer to the
// proposal, "yes lock protected and also shows progression"; and to the four questions, "yes but joinaccept and leave one at a
// time"). Before this the app left a Matrix room in three places only — an interrupted creation's discard and the two invite
// declines — and a room, once joined, stayed in the account for good.
//
// Driven on the REAL modules (`features/room.js`, both engines, the bridge) against the homeserver MODEL (`tests/_inviteworld.js`),
// and the REAL ui/ files in the screen world (`tests/_screen-world.js`) over stand-ins for the feature layer's reads:
//   A  ORDER AND PROGRESS: a room with N channels this account is in or invited to sends N+1 leaves, ONE AT A TIME, in the order
//      the room lists them, the room itself LAST, and says how far it has got after each; a channel this account is not in is
//      sent nothing; then the room leaves the list, the device forgets the leave and the tab forgets the room for a reload.
//   B  RETRIES AND REFUSALS: a 429 retries by the join step's own rule and the leave goes on; a refusal is NAMED (the channel's
//      name and "refused"), the room itself is not left while a channel is still in, the leave is kept, and Leave again sends
//      only what is left and finishes; a channel that stays busy gives up after the rule's retries and is named "server busy".
//   C  INTERRUPTED: a leave kept on the device is finished by itself at the next start (`Room.resumeLeaves`), saying so while it
//      runs; one whose room this account is no longer in is forgotten, and says so.
//   D  THE OWNER'S WARNING'S FACTS: `Room.leaveNotice` says owner for a room this account owns and not for one it joined, and
//      public only for a public room; the warning's "Staff or above" is the rung at the invite level every room is made with
//      (`_powerLevels`, run), and "(as owner)" rests on room version 12, where a creator's power cannot be taken (`ROOM_VERSION`).
//   F  EVERY CHANNEL OF THE ROOM (the owner's, `ddjp_691`): a channel whose mark names the room though the room does not list it is
//      left too, after the listed ones, counted in the progress; a channel still in after its leave was answered is read back and
//      named, the room itself not left, and Leave again finishes; a channel found by the fresh sweep is named and Leave again covers
//      it; the room itself is read back too — still in after its leave was answered, it is named and stays in the list, and Leave
//      again finishes it; the next start finishes a kept leave whose room is out while a channel is still in; one leave for rooms
//      and leftovers.
//   E  THE ROOM LIST (the screen world): locked, today's list and the app's square lock at the right of "Recent Rooms"; unlocked,
//      a red Leave at each row's right, beside Open on owned rows; an owned row's Leave shows the owner's warning IN THE ROW with
//      "Leave anyway" and "Cancel" (no window.confirm), the public room's middle sentence its own; a joined row's Leave leaves at
//      once; the progress line and its bar; the failure line with Leave again; the resumed line; leaving the screen locks it.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ROOT = path.join(__dirname, "..");
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[leave-room] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[leave-room] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);

// THE DEVICE'S KEPT LEAVES, as `Store.config` keeps them (the real StorageIO's shape, a list) — shared between two "starts".
function device() {
  const kept = { list: [] };
  const Store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {},
      saveLeaving(l) { kept.list = Array.isArray(l) ? JSON.parse(JSON.stringify(l)) : []; }, loadLeaving() { return kept.list.slice(); } } };
  const ss = { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
  return { kept, Store, ss };
}
// A room this account is IN: the space, its four open channels; `o.invited`: invites waiting under it; `o.level`: its level.
function roomIn(hs, sid, o) {
  o = o || {};
  const R = hs.ddjpRoom(sid, { levels: { [ME]: (typeof o.level === "number") ? o.level : 20 }, name: o.name });
  hs.rooms[sid].members[ME] = "join";
  for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) hs.rooms[R.ch[k]].members[ME] = "join";
  for (const k of (o.invited || [])) hs.invite(R.ch[k], ME, { from: OWNER });
  return R;
}
function world(hs, dev) {
  const w = W.inviteWorld({ hs, extras: { Store: dev.Store, sessionStorage: dev.ss } });
  // ONE AT A TIME, MEASURED: how many leaves are in flight at once.
  const leave0 = w.client.leave;
  w.inFlight = 0; w.maxInFlight = 0; w.leaveOrder = [];
  w.client.leave = async (id) => { w.inFlight++; w.maxInFlight = Math.max(w.maxInFlight, w.inFlight); w.leaveOrder.push(id);
    try { await Promise.resolve(); await Promise.resolve(); return await leave0(id); } finally { w.inFlight--; } };
  return w;
}
const jobLog = (w) => { const seen = []; w.Room.onLeaveJob((sid) => { const j = w.Room.leaveJob(sid); seen.push(j ? { state: j.state, done: j.done, total: j.total, resumed: j.resumed } : null); }); return seen; };

// ── A — ORDER AND PROGRESS ─────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const hs = W.homeserver(), dev = device();
  const A = roomIn(hs, "!a:hs", { invited: ["chat_staff"] });
  dev.ss.setItem("ddjp_room:" + ME, "!a:hs");   // the tab remembers it (as after a reload into it)
  const w = world(hs, dev);
  ok(typeof w.Room.leaveForGood === "function", "A: APPLIED — `Room.leaveForGood` exists (the room list's Leave)", typeof w.Room.leaveForGood);
  if (typeof w.Room.leaveForGood !== "function") return;
  const seen = jobLog(w);
  const r = await w.Room.leaveForGood("!a:hs");
  await w.settle(10);
  const mine = [A.ch.events_uncategorized, A.ch.events_owner, A.ch.settings_owner, A.ch.chat_uncategorized, A.ch.chat_staff];
  ok(r && r.ok === true && r.total === 5 && r.left === 5, "A PREMISE — the leave finished: five channels this account is in or invited to", r);
  ok(JSON.stringify(w.leaveOrder) === JSON.stringify(mine.concat(["!a:hs"])),
    "A: A LEAVE OF N CHANNELS SENDS N+1 LEAVES, in the order the room lists them, the room itself LAST (the invite declined among them)",
    { sent: w.leaveOrder, want: mine.concat(["!a:hs"]) });
  ok(w.maxInFlight === 1, "A: ONE AT A TIME — never two leaves in flight at once", w.maxInFlight);
  ok(w.leaveOrder.indexOf(A.ch.chat_guest) < 0 && w.leaveOrder.indexOf(A.ch.presence_chat) < 0,
    "A: a channel this account is neither in nor invited to is sent nothing", w.leaveOrder);
  const running = seen.filter((j) => j && j.state === "running").map((j) => j.done + "/" + j.total);
  ok(JSON.stringify(running) === JSON.stringify(["0/5", "1/5", "2/5", "3/5", "4/5", "5/5"]),
    "A: AND SAYS HOW FAR IT HAS GOT after each channel (0 of 5 … 5 of 5)", running);
  ok(seen[seen.length - 1] === null && w.Room.leaveJob("!a:hs") === null, "A: finished, the leave is gone from the room list's reading", seen.slice(-2));
  const scan = w.Room.scanDDJPRooms();
  ok(![].concat(scan.owned, scan.joined).some((x) => x.spaceId === "!a:hs"), "A: and the room leaves the list", scan);
  ok(dev.kept.list.length === 0, "A: the device forgets the leave", dev.kept.list);
  ok(dev.ss.getItem("ddjp_room:" + ME) === null, "A: and the tab's memory of the room for a reload is forgotten", dev.ss._v);
  ok(w.lines(/MatrixBridge: leaving a for good — .*the room itself left — 5 of 5 channels left, the room itself left/).length === 1 &&
     w.lines(/Room: left a for good — 5 of 5 channel\(s\) and the room itself; it leaves the list/).length === 1,
    "A: ONE line from the bridge naming each channel's answer, and the room's line", w.lines(/leav/));
});

// ── B — RETRIES AND REFUSALS ───────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const hs = W.homeserver(), dev = device();
  const A = roomIn(hs, "!a:hs");
  hs.failNext["leave:" + A.ch.events_uncategorized] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  hs.failNext["leave:" + A.ch.settings_owner] = [{ errcode: "M_FORBIDDEN", httpStatus: 403, message: "refused" }];
  const w = world(hs, dev);
  if (typeof w.Room.leaveForGood !== "function") { ok(false, "B: APPLIED — `Room.leaveForGood` exists"); return; }
  let slept = 0;
  // CHANGED ON PURPOSE AT `ddjp_695`: the one leave's sends are paced (the one send pacer, through the turn's own sleep), so the
  // count is of the join step's BACKOFFS — a sleep marked "pace" is the pacer's gap, not a retry.
  w.MB._setJoinSleepForTest((ms, why) => { if (why !== "pace") slept++; return Promise.resolve(); });
  const r1 = await w.Room.leaveForGood("!a:hs");
  const j1 = w.Room.leaveJob("!a:hs");
  ok(slept === 1 && hs.rooms[A.ch.events_uncategorized].members[ME] === "leave" &&
     w.lines(/events_uncategorized left after 1 retry/).length === 1,
    "B: A 429 RETRIES by the join step's rule — one backoff, then left, and the line says so", { slept, lines: w.lines(/leaving a/) });
  ok(r1 && r1.ok === false && j1 && j1.state === "failed" && j1.left === 3 && j1.total === 4 &&
     JSON.stringify(j1.failed) === JSON.stringify([{ label: "owner settings", why: "refused: M_FORBIDDEN" }]),
    "B: A REFUSAL IS NAMED — the channel by its name, and why (\"refused: M_FORBIDDEN\"); three of four left", { r1, j1 });
  ok(hs.rooms["!a:hs"].members[ME] === "join" && w.leaveOrder.indexOf("!a:hs") < 0,
    "B: the room itself is NOT left while a channel is still in — it stays in the list for Leave again", w.leaveOrder);
  ok(dev.kept.list.length === 1 && dev.kept.list[0].spaceId === "!a:hs", "B: the unfinished leave is KEPT on the device", dev.kept.list);
  ok(w.lines(/Room: the leave of a did not finish — left 3 of 4; couldn't leave: owner settings \(refused: M_FORBIDDEN\) — kept on this device; Leave again finishes it/).length === 1,
    "B: and the room's line says what failed and what finishes it", w.lines(/Room: the leave/));
  const n0 = w.leaveOrder.length;
  const r2 = await w.Room.leaveForGood("!a:hs");
  ok(r2 && r2.ok === true && JSON.stringify(w.leaveOrder.slice(n0)) === JSON.stringify([A.ch.settings_owner, "!a:hs"]),
    "B: LEAVE AGAIN FINISHES WHAT IS LEFT — only the channel still in, then the room itself", w.leaveOrder.slice(n0));
  ok(dev.kept.list.length === 0 && w.Room.leaveJob("!a:hs") === null, "B: and then nothing is kept", dev.kept.list);
  // A channel that stays busy gives up after the rule's retries and is named "server busy".
  const hs2 = W.homeserver(), dev2 = device();
  const B = roomIn(hs2, "!b:hs");
  hs2.failNext["leave:" + B.ch.chat_uncategorized] = Array.from({ length: 7 }, () => ({ errcode: "M_UNKNOWN", httpStatus: 502 }));
  const w2 = world(hs2, dev2);
  const r3 = await w2.Room.leaveForGood("!b:hs");
  const j3 = w2.Room.leaveJob("!b:hs");
  ok(r3 && r3.ok === false && j3 && JSON.stringify(j3.failed) === JSON.stringify([{ label: "uncategorized chat", why: "server busy" }]) &&
     w2.lines(/chat_uncategorized gave up after 6 retries \(M_UNKNOWN\)/).length === 1,
    "B: A CHANNEL THAT STAYS BUSY gives up after the join step's six retries and is named \"server busy\"", { j3, lines: w2.lines(/leaving b/) });
});

// ── C — INTERRUPTED: FINISHED AT THE NEXT START ───────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const hs = W.homeserver(), dev = device();
  const A = roomIn(hs, "!a:hs");
  // The first start: the leave began and the tab closed halfway (two channels out, the record kept).
  dev.kept.list = [{ spaceId: "!a:hs", name: "a" }];
  hs.rooms[A.ch.events_uncategorized].members[ME] = "leave";
  hs.rooms[A.ch.events_owner].members[ME] = "leave";
  // The next start, on the same device.
  const w = world(hs, dev);
  if (typeof w.Room.resumeLeaves !== "function") { ok(false, "C: APPLIED — `Room.resumeLeaves` exists (the app's start)"); return; }
  const seen = jobLog(w);
  w.Room.resumeLeaves();
  await w.settle(30);
  ok(hs.rooms["!a:hs"].members[ME] === "leave" && JSON.stringify(w.leaveOrder) === JSON.stringify([A.ch.settings_owner, A.ch.chat_uncategorized, "!a:hs"]),
    "C: AN INTERRUPTED LEAVE FINISHES BY ITSELF AT THE NEXT START — what was left, then the room", w.leaveOrder);
  ok(seen.some((j) => j && j.state === "running" && j.resumed === true), "C: and while it runs the row can say so (`resumed`)", seen);
  ok(w.lines(/Room: leaving a for good — finishing the leave from last time/).length === 1, "C: and the log says so", w.lines(/Room: leav/));
  ok(dev.kept.list.length === 0, "C: then nothing is kept", dev.kept.list);
  // A kept leave whose room this account is no longer in had finished: forgotten, with its line, nothing sent.
  // CHANGED ON PURPOSE (`ddjp_691`, the owner's "make sure all rooms are left when leaving a space"): this premise left the room and
  // kept its channels; a kept leave now covers its channels too (part F), so "had finished" means the room AND its channels are out.
  const hs2 = W.homeserver(), dev2 = device();
  const B2 = roomIn(hs2, "!b:hs");
  hs2.rooms["!b:hs"].members[ME] = "leave";
  for (const id of Object.values(B2.ch)) if (hs2.rooms[id].members[ME] === "join") hs2.rooms[id].members[ME] = "leave";
  dev2.kept.list = [{ spaceId: "!b:hs", name: "b" }];
  const w2 = world(hs2, dev2);
  w2.Room.resumeLeaves();
  await w2.settle(10);
  ok(w2.leaveOrder.length === 0 && dev2.kept.list.length === 0 && w2.lines(/Room: the leave of b from last time had finished — this account is not in it/).length === 1,
    "C: a kept leave whose room this account is not in had finished — forgotten, said, nothing sent", { sent: w2.leaveOrder, kept: dev2.kept.list });
  // THE APP'S START CALLS IT — the wire, run (a correct module reached by nothing is this tree's characteristic defect): the
  // lobby's entry out of `app.js`, extracted by name and run against stand-ins, after the room list is drawn so the row can say so.
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const at = app.indexOf("  function _enterLobby(");
  let body = null;
  if (at >= 0) { let i = app.indexOf("{", at), d = 0; for (; i < app.length; i++) { if (app[i] === "{") d++; else if (app[i] === "}") { d--; if (d === 0) break; } } body = app.slice(at, i + 1); }
  ok(!!body, "C: APPLIED — `app.js` `_enterLobby` was found to run (an extraction that finds nothing refuses rather than passes)", at);
  if (body) {
    const calls = [];
    const fn = new Function("Chat", "Interface", "Room", "Logger", "_fillRoomTypes", body + "\nreturn _enterLobby;")(
      { dmInit() {} }, { showScreen: (s) => calls.push("show " + s), renderRoomList: () => calls.push("list") },
      { scanDDJPRooms: () => ({}), resumeLeaves: () => calls.push("resumeLeaves") }, { warn() {}, info() {} }, () => {});
    fn();
    ok(calls.indexOf("resumeLeaves") > calls.indexOf("list") && calls.indexOf("list") >= 0,
      "C: THE APP'S START FINISHES A KEPT LEAVE — the lobby's entry calls `Room.resumeLeaves`, after the room list is drawn", calls);
  }
});

// ── D — THE OWNER'S WARNING'S FACTS ───────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const hs = W.homeserver(), dev = device();
  roomIn(hs, "!own:hs", { level: 99 });
  roomIn(hs, "!join:hs", { level: 20 });
  hs.rooms["!join:hs"].joinRule = "public";
  const w = world(hs, dev);
  if (typeof w.Room.leaveNotice !== "function") { ok(false, "D: APPLIED — `Room.leaveNotice` exists"); return; }
  const o = w.Room.leaveNotice("!own:hs"), j = w.Room.leaveNotice("!join:hs");
  ok(o.owner === true && j.owner === false, "D: THE WARNING IS FOR ROOMS THIS ACCOUNT OWNS — owner at the owner rung, not at a joined level", { o, j });
  ok(o.visibility === "private" && j.visibility === "public", "D: and its middle sentence follows the room's join rule (public or private)", { o, j });
  // "Only Staff or above … can invite you back": the rung at the invite level every room this app makes is given.
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const at = src.indexOf("  function _powerLevels(");
  let invite = null;
  if (at >= 0) {
    let i = src.indexOf("{", at), d = 0, end = -1;
    for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } } }
    const fn = vm.runInNewContext("(function(){ const SPACE_CHILD_LEVEL = 100; " + src.slice(at, end) + " return _powerLevels; })()");
    invite = [fn(0, "@c:hs", false), fn(100, "@c:hs", true)].map((p) => p.invite);
  }
  const staff = w.sb.Ranks.levelOf("staff");
  const below = w.sb.Ranks.LADDER.filter((r) => r.level < staff).map((r) => r.level);
  ok(invite && invite.every((v) => v === staff) && below.every((lv) => lv < invite[0]),
    "D: \"ONLY STAFF OR ABOVE … CAN INVITE YOU BACK\" — every channel and space is made with `invite` at the staff rung, and no rung below it reaches it",
    { invite, staff });
  ok(w.MB.ROOM_VERSION === "12", "D: \"(AS OWNER)\" — rooms are made at room version 12, where a creator's power is the room's and cannot be taken (`_creatorsOf`)", w.MB.ROOM_VERSION);
});

// ── E — THE ROOM LIST, IN THE SCREEN WORLD ─────────────────────────────────────────────────────────────────────────────────
part("E", async () => {
  const jobs = {}, notices = {}, calls = [];
  let confirms = 0, door = { busy: false, what: null, waiting: [] };
  const scan = { owned: [{ spaceId: "!own:hs", name: "Room A" }, { spaceId: "!pub:hs", name: "Room P" }],
    joined: [{ spaceId: "!join:hs", name: "Room B" }], invited: [], unconfirmed: [] };
  notices["!own:hs"] = { owner: true, visibility: "private" };
  notices["!pub:hs"] = { owner: true, visibility: "public" };
  notices["!join:hs"] = { owner: false, visibility: "private" };
  let leaveJobFn = null;
  const w = SW.world({ features: { Room: {
    rankLadder: () => [], scanDDJPRooms: () => scan, pendingCreate: () => null, getMyId: () => ME,
    leaveJob: (sid) => (jobs[sid] ? JSON.parse(JSON.stringify(jobs[sid])) : null), leaveNotice: (sid) => notices[sid] || { owner: false, visibility: "private" },
    leaveForGood: (sid) => { calls.push(sid); return Promise.resolve({ ok: true }); }, doorState: () => door,
    onDoorChange: () => {}, onLeaveJob: (fn) => { leaveJobFn = fn; }, onRoomsChanged: () => {}, onLeft: () => {} } },
    globals: { confirm: () => { confirms++; return true; } } });
  const doc = w.doc, S = w.sb.Screens;
  const list = doc.createElement("div"); list.id = "room-list"; doc.body.appendChild(list);
  const lockSlot = doc.createElement("span"); lockSlot.id = "rooms-lock"; doc.body.appendChild(lockSlot);
  S.showScreen("screen-rooms");
  S.renderRoomList(scan);
  const q = (sel, root) => (root || doc.body).querySelectorAll(sel);
  const rowOf = (name) => q(".room-item", list).find((n) => n.textContent.indexOf(name) >= 0) || null;
  const cas = (n, p) => { const d = n && w.cas.declared(n, p); return d ? d.val : null; };
  // LOCKED: today's list, and the lock.
  const lock0 = q(".panel-lock-btn", lockSlot)[0];
  ok(lock0 && / locked/.test(" " + lock0.className) && lock0.textContent === "🔒", "E: LOCKED — the app's own square lock (`_panelLockBtn`) at the right of \"Recent Rooms\"",
    lock0 && lock0.className);
  ok(q(".room-leave-btn", list).length === 0, "E: locked, no Leave anywhere — today's list", q(".room-leave-btn", list).map((b) => b.textContent));
  const ownRow0 = rowOf("Room A"), joinRow0 = rowOf("Room B");
  ok(ownRow0 && ownRow0.className === "room-item room-with-open" && ownRow0.children.length === 2 && /room-open-btn/.test(ownRow0.children[1].className) &&
     joinRow0 && joinRow0.tag === "button" && joinRow0.className === "room-item",
    "E: and every row is today's — an owned room's wrapper with Open, a joined room one button", { own: ownRow0 && ownRow0.className, join: joinRow0 && joinRow0.tag });
  // UNLOCKED.
  lock0.click();
  const lock1 = q(".panel-lock-btn", lockSlot)[0];
  ok(lock1 && !/ locked/.test(" " + lock1.className) && lock1.textContent === "🔓", "E: the lock opens on a click", lock1 && lock1.className);
  const leaves = q(".room-leave-btn", list);
  const ownRow = rowOf("Room A"), joinRow = rowOf("Room B");
  const lastOf = (row) => row && row.children[row.children.length - 1];
  ok(leaves.length === 3 && lastOf(ownRow) && lastOf(ownRow).textContent === "Leave" && /room-open-btn/.test(ownRow.children[1].className) &&
     lastOf(joinRow) && lastOf(joinRow).textContent === "Leave",
    "E: UNLOCKED — a Leave at each row's right, beside Open on the rooms you own", { leaves: leaves.length, own: ownRow && ownRow.children.map((c) => c.textContent) });
  // BORROWED, NOT COPIED: the rule that gives Leave its red is the locked lock's own — one declaration block, two selectors.
  const SHEET = SW.readSheet(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
  const redL = w.cas.declared(leaves[0], "background") || {};
  const ruleL = SHEET.find((r) => r.order === redL.order), ruleK = SHEET.find((r) => r.sel === ".panel-lock-btn.locked");
  ok(cas(leaves[0], "background") === "#5a2230" && cas(leaves[0], "color") === "#ffb3c0" && ruleL && ruleK && ruleL.decls === ruleK.decls,
    "E: and it is RED — the locked lock's own red, from the SAME rule (borrowed, not a copy)", { bg: redL.val, sel: redL.sel, same: !!(ruleL && ruleK && ruleL.decls === ruleK.decls) });
  // THE OWNER'S WARNING, IN THE ROW.
  lastOf(ownRow).click();
  const armed = rowOf("Room A");
  const words = armed ? armed.textContent : "";
  ok(confirms === 0 && calls.length === 0, "E: an owned room's Leave sends nothing yet and opens NO window (window.confirm)", { confirms, calls });
  ok(/You're the owner\. Only Staff or above still here can invite you back \(as owner\)\. If nobody is left, the room is lost\./.test(words),
    "E: THE OWNER'S WARNING, IN THE ROW (a private room's words)", words);
  const anyway = q("button", armed).find((b) => b.textContent === "Leave anyway"), cancel = q("button", armed).find((b) => b.textContent === "Cancel");
  ok(anyway && cancel && /room-leave-btn/.test(anyway.className) && !/room-leave-btn/.test(cancel.className),
    "E: with \"Leave anyway\" (red) and \"Cancel\"", armed && q("button", armed).map((b) => b.textContent + ":" + b.className));
  const grp = anyway && anyway.parent, wline = grp && grp.parent;
  ok(grp && grp === (cancel && cancel.parent) && grp.className === "dm-head-actions" && wline && wline.lastElementChild === grp &&
     cas(wline, "flex-wrap") === "wrap" && cas(grp, "display") === "flex",
    "E: the two together at the line's right (the DM head's button group, borrowed), wrapping under the words when the row is narrow",
    { group: grp && grp.className, wrap: cas(wline, "flex-wrap") });
  if (cancel) cancel.click();
  ok(calls.length === 0 && rowOf("Room A") && !/You're the owner/.test(rowOf("Room A").textContent), "E: Cancel takes it back, nothing sent", calls);
  lastOf(rowOf("Room A")).click();
  const anyway2 = q("button", rowOf("Room A")).find((b) => b.textContent === "Leave anyway");
  if (anyway2) anyway2.click();
  ok(JSON.stringify(calls) === JSON.stringify(["!own:hs"]), "E: Leave anyway leaves", calls);
  // The public room's middle sentence.
  lastOf(rowOf("Room P")).click();
  ok(/You're the owner\. Join Room with its Space ID brings you back \(as owner\)\. If nobody is left, the room is lost\./.test(rowOf("Room P").textContent),
    "E: a PUBLIC room's warning says Join Room with its Space ID brings you back", rowOf("Room P").textContent);
  // A joined room: no warning, it leaves at once.
  lastOf(rowOf("Room B")).click();
  ok(JSON.stringify(calls) === JSON.stringify(["!own:hs", "!join:hs"]) && !/You're the owner/.test(rowOf("Room B").textContent),
    "E: a joined room's Leave leaves at once — only rooms you own get the warning", calls);
  // WAITING ITS TURN (one at a time): the row says what for.
  jobs["!own:hs"] = { spaceId: "!own:hs", name: "Room A", state: "waiting", waitsFor: "opening Room Z", done: 0, total: 0, left: 0, failed: [], resumed: false };
  if (leaveJobFn) leaveJobFn("!own:hs");
  ok(/Waits for: opening Room Z\u2026/.test(rowOf("Room A").textContent), "E: a leave waiting its turn says what it waits for", rowOf("Room A").textContent);
  // PROGRESS, redrawn in its own row only.
  const other = rowOf("Room B");
  jobs["!own:hs"] = { spaceId: "!own:hs", name: "Room A", state: "running", done: 4, total: 9, left: 4, failed: [], resumed: false };
  if (leaveJobFn) leaveJobFn("!own:hs");
  const prog = rowOf("Room A");
  const fill = prog && q(".room-leave-fill", prog)[0];
  ok(prog && /Leaving… 4 of 9 channels/.test(prog.textContent) && fill && fill.style.width === "44%" && q(".room-leave-track", prog).length === 1,
    "E: \"Leaving… 4 of 9 channels\" with a bar, 44% full", { text: prog && prog.textContent, width: fill && fill.style.width });
  ok(rowOf("Room B") === other, "E: the leave's progress redraws its own row only — the others are the same elements", null);
  ok(prog && q(".room-leave-btn", prog).length === 0, "E: while it runs, the row offers no Leave", prog && q("button", prog).map((b) => b.textContent));
  const sameRule = (n, sel) => { const d = w.cas.declared(n, "background") || {}; const a = SHEET.find((r) => r.order === d.order), b = SHEET.find((r) => r.sel === sel); return !!(a && b && a.decls === b.decls); };
  ok(cas(q(".room-leave-track", prog)[0], "background") === "#333" && cas(fill, "background") === "#5865F2" &&
     sameRule(q(".room-leave-track", prog)[0], "#create-progress-bar-track") && sameRule(fill, "#create-progress-bar-fill"),
    "E: the bar is the creation bar's, borrowed (its track #333, its fill #5865F2)", { track: cas(q(".room-leave-track", prog)[0], "background"), fill: cas(fill, "background") });
  jobs["!own:hs"].resumed = true; jobs["!own:hs"].done = 3;
  if (leaveJobFn) leaveJobFn("!own:hs");
  ok(/Finishing the leave from last time… 3 of 9 channels/.test(rowOf("Room A").textContent), "E: a leave finished at the next start says so", rowOf("Room A").textContent);
  // WHAT FAILED, AND LEAVE AGAIN.
  jobs["!own:hs"] = { spaceId: "!own:hs", name: "Room A", state: "failed", done: 9, total: 9, left: 7, resumed: false,
    failed: [{ label: "staff chat", why: "server busy" }, { label: "guest events", why: "server busy" }] };
  if (leaveJobFn) leaveJobFn("!own:hs");
  const bad = rowOf("Room A");
  ok(bad && /Left 7 of 9\. Couldn't leave: staff chat, guest events \(server busy\)\./.test(bad.textContent),
    "E: \"Left 7 of 9. Couldn't leave: staff chat, guest events (server busy).\"", bad && bad.textContent);
  const again = bad && q("button", bad).find((b) => b.textContent === "Leave again");
  ok(again && /room-leave-btn/.test(again.className) && again.disabled === false, "E: with \"Leave again\", red, live while unlocked", again && again.className);
  calls.length = 0;
  if (again) again.click();
  ok(JSON.stringify(calls) === JSON.stringify(["!own:hs"]), "E: Leave again leaves again", calls);
  // LEAVING THE SCREEN LOCKS IT AGAIN (as DMs).
  S.showScreen("screen-main"); S.showScreen("screen-rooms");
  S.renderRoomList(scan);
  const lock2 = q(".panel-lock-btn", lockSlot)[0];
  const again2 = q("button", rowOf("Room A") || list).find((b) => b.textContent === "Leave again");
  ok(lock2 && / locked/.test(" " + lock2.className) && q(".room-leave-btn", list).filter((b) => b.textContent === "Leave").length === 0,
    "E: LEAVING THE ROOM-LIST SCREEN LOCKS IT AGAIN, like DMs", lock2 && lock2.className);
  ok(again2 && again2.disabled === true && /Locked/.test(again2.title), "E: and locked, what failed still shows, with Leave again greyed behind the lock",
    again2 && { disabled: again2.disabled, title: again2.title });
  // NO LOCK WITH NOTHING BEHIND IT.
  S.renderRoomList({ owned: [], joined: [], invited: [], unconfirmed: [] });
  ok(q(".panel-lock-btn", lockSlot).length === 0, "E: no room to leave, no lock (as DMs with an empty list)", q(".panel-lock-btn", lockSlot).length);
});

// ── F — EVERY CHANNEL OF THE ROOM (the owner's, `ddjp_691`: "make sure all rooms are left when leaving a space") ─────────────────
// The set is every channel the room lists that this account is in or invited to, then every room it is in or invited to whose MARK
// names the room though the room does not list it; then CHECKED AGAIN by membership and by a fresh sweep; only then the room itself.
part("F", async () => {
  // F1 — A MARKED CHANNEL THE ROOM NO LONGER LISTS is left too, after the listed ones, counted in the progress.
  const hs = W.homeserver(), dev = device();
  const A = roomIn(hs, "!a:hs");
  const unlisted = A.ch.chat_uncategorized;
  hs.rooms["!a:hs"].children = hs.rooms["!a:hs"].children.filter((id) => id !== unlisted);
  const w = world(hs, dev);
  if (typeof w.MB.leaveSetOf !== "function") { ok(false, "F: APPLIED — `MatrixBridge.leaveSetOf` exists (the leave's whole set)"); return; }
  const seen = jobLog(w);
  const r = await w.Room.leaveForGood("!a:hs");
  await w.settle(10);
  const listed = [A.ch.events_uncategorized, A.ch.events_owner, A.ch.settings_owner];
  ok(r && r.ok === true && r.total === 4 && JSON.stringify(w.leaveOrder) === JSON.stringify(listed.concat([unlisted, "!a:hs"])),
    "F1: A CHANNEL WHOSE MARK NAMES THE ROOM, NOT LISTED, IS LEFT TOO — after the listed ones, then the room itself", { r, sent: w.leaveOrder });
  ok(hs.rooms[unlisted].members[ME] === "leave", "F1: and it is out", hs.rooms[unlisted].members[ME]);
  const running = seen.filter((j) => j && j.state === "running").map((j) => j.done + "/" + j.total);
  ok(running[0] === "0/4" && running[running.length - 1] === "4/4", "F1: THE PROGRESS COUNTS THE WHOLE SET (0 of 4 … 4 of 4)", running);
  // F2 — STILL IN after its leave was answered: read back, named, the room not left; Leave again finishes.
  const hs2 = W.homeserver(), dev2 = device();
  const B = roomIn(hs2, "!b:hs");
  const w2 = world(hs2, dev2);
  const l1 = w2.client.leave;
  let stick = true;
  w2.client.leave = async (id) => { if (stick && id === B.ch.settings_owner) { w2.leaveOrder.push(id); await Promise.resolve(); return; } return l1(id); };
  const r2 = await w2.Room.leaveForGood("!b:hs");
  const j2 = w2.Room.leaveJob("!b:hs");
  ok(r2 && r2.ok === false && j2 && j2.state === "failed" && JSON.stringify(j2.failed) === JSON.stringify([{ label: "owner settings", why: "still in" }]) &&
     hs2.rooms["!b:hs"].members[ME] === "join" && w2.leaveOrder.indexOf("!b:hs") < 0,
    "F2: A CHANNEL STILL IN AFTER ITS LEAVE WAS ANSWERED is read back, named (\"owner settings (still in)\"), and the room itself is not left", { r2, j2 });
  stick = false;
  const r2b = await w2.Room.leaveForGood("!b:hs");
  ok(r2b && r2b.ok === true && hs2.rooms["!b:hs"].members[ME] === "leave", "F2: Leave again finishes it", r2b);
  // F3 — FOUND AFTER THE LEAVE BEGAN (the fresh sweep): an invite to a channel marked for the room arrives mid-leave.
  const hs3 = W.homeserver(), dev3 = device();
  roomIn(hs3, "!c:hs");
  const late = "!c-late:hs";
  const w3 = world(hs3, dev3);
  const l3 = w3.client.leave;
  let planted = false;
  w3.client.leave = async (id) => { if (!planted) { planted = true;
    hs3.room(late, { name: "late", content: { room_version: "12", ddjp_room: "!c:hs", ddjp_kind: "chat_guest" }, members: { [W.OWNER]: "join" }, parent: "!c:hs" });
    hs3.invite(late, ME, { from: W.OWNER }); } return l3(id); };
  const r3 = await w3.Room.leaveForGood("!c:hs");
  const j3 = w3.Room.leaveJob("!c:hs");
  ok(r3 && r3.ok === false && j3 && j3.failed.length === 1 && j3.failed[0].why === "found after the leave began" && hs3.rooms["!c:hs"].members[ME] === "join",
    "F3: A CHANNEL FOUND BY THE FRESH SWEEP is named (\"found after the leave began\") and the room itself is not left", { r3, j3 });
  const r3b = await w3.Room.leaveForGood("!c:hs");
  ok(r3b && r3b.ok === true && hs3.rooms[late].members[ME] === "leave" && hs3.rooms["!c:hs"].members[ME] === "leave",
    "F3: Leave again covers it — declined, then the room itself", { r3b, late: hs3.rooms[late].members[ME] });
  // F4 — THE NEXT START covers the same set: a kept leave whose room is out while a channel marked for it is still in.
  const hs4 = W.homeserver(), dev4 = device();
  const D = roomIn(hs4, "!d:hs");
  hs4.rooms["!d:hs"].members[ME] = "leave";
  dev4.kept.list = [{ spaceId: "!d:hs", name: "d" }];
  const w4 = world(hs4, dev4);
  const resumed = w4.Room.resumeLeaves();
  await w4.settle(30);
  ok(JSON.stringify(resumed) === JSON.stringify(["!d:hs"]) && Object.values(D.ch).every((id) => hs4.rooms[id].members[ME] !== "join") && dev4.kept.list.length === 0,
    "F4: THE NEXT START FINISHES A KEPT LEAVE WHOSE ROOM IS OUT BUT A CHANNEL IS STILL IN — the same set, and then nothing is kept", { resumed, kept: dev4.kept.list });
  // F6 — THE ROOM ITSELF, read back too: its leave answered and it still in — named, the leave not finished; Leave again finishes.
  const hs6 = W.homeserver(), dev6 = device();
  roomIn(hs6, "!e:hs");
  const w6 = world(hs6, dev6);
  const l6 = w6.client.leave;
  let stick6 = true;
  w6.client.leave = async (id) => { if (stick6 && id === "!e:hs") { w6.leaveOrder.push(id); await Promise.resolve(); return; } return l6(id); };
  const r6 = await w6.Room.leaveForGood("!e:hs");
  const j6 = w6.Room.leaveJob("!e:hs");
  ok(r6 && r6.ok === false && j6 && j6.state === "failed" && JSON.stringify(j6.failed) === JSON.stringify([{ label: "the room itself", why: "still in" }]) &&
     dev6.kept.list.length === 1 && w6.Room.scanDDJPRooms().joined.concat(w6.Room.scanDDJPRooms().owned).some((x) => x.spaceId === "!e:hs"),
    "F6: THE ROOM ITSELF STILL IN AFTER ITS LEAVE WAS ANSWERED is read back and named (\"the room itself (still in)\"); it stays in the list, kept", { r6, j6 });
  stick6 = false;
  const r6b = await w6.Room.leaveForGood("!e:hs");
  ok(r6b && r6b.ok === true && hs6.rooms["!e:hs"].members[ME] === "leave" && dev6.kept.list.length === 0, "F6: Leave again finishes it", r6b);
  // F5 — ONE IMPLEMENTATION: a room's leave and the leftovers' are the same function in the bridge (source-level: spelt, which is all
  // it claims; `check-leftovers` drives the leftovers').
  const src = require("fs").readFileSync(require("path").join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const body = (n) => { const i = src.indexOf("async function " + n + "("); return i < 0 ? "" : src.slice(i, src.indexOf("\n  }\n", i)); };
  ok(/_leaveAll\(/.test(body("leaveRoomForGood")) && /_leaveAll\(/.test(body("leaveLeftovers")) && !/_joinWithRetry\(/.test(body("leaveRoomForGood")) && !/_joinWithRetry\(/.test(body("leaveLeftovers")),
    "F5: a room's leave and the leftovers' go through ONE leave (`_leaveAll`), not a copy");
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[leave-room] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[leave-room] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[leave-room] PASS — leave a room for good (J139; " + asserts + " assertions): a room with N channels this account is in or " +
    "invited to sends N+1 leaves, one at a time, in its listed order, the room itself last, saying how far it has got; a channel it " +
    "is not in is sent nothing; finished, the room leaves the list and the device and the tab forget it. A 429 retries by the join " +
    "step's rule; a refusal is named and the room is not left while a channel is in; Leave again sends only what is left; a channel " +
    "that stays busy is named \"server busy\". A leave kept on the device is finished at the next start, saying so. The warning is for " +
    "rooms this account owns, its words resting on the invite rung and room version 12. The room list: locked, today's rows and the " +
    "square lock; unlocked, a red Leave at each row's right; the owner's warning in the row with Leave anyway and Cancel, no window; " +
    "the progress and its bar, redrawn in its row only; what failed and Leave again; the resumed line; and leaving the screen locks it. " +
    "EVERY CHANNEL OF THE ROOM (`ddjp_691`): the ones it lists and the ones whose mark names it, then a read-back and a fresh sweep " +
    "before the room itself, which is read back too; what remains is named, Leave again and the next start cover it, and rooms and " +
    "leftovers share one leave.");
})();
