#!/usr/bin/env node
// tests/check-join-step.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, backends/backend1/matrixaccount.js
//
// WALL: ONE JOIN STEP JOINS A ROOM'S CHANNELS, ONLY FOR THE ROOM THAT RUNS ON THIS TAB, AND SAYS WHAT HAPPENED TO EACH
// (J81; the owner's rulings 8b, 8c, 14 and 15).
//   Before J81 five paths joined channels (`_joinChildren`, `_joinAdvertised`, `retryWaitingJoins`, `acceptChannelInvite`,
//   `joinChannel`) plus `Room.acceptChannelInvites`; the lobby's Accept joined every channel a room listed; an invite to a
//   listed channel was accepted whoever had made it; and "auto-joining has often been buggy" (the owner). Now ONE function,
//   `MatrixBridge.joinRoomChannels`, called by `features/room.js` for the room that is opening or running (`Room.runningRoom()`),
//   joins the space (at an opening only) and every channel the account may join — open ones, and invite-only ones whose invite
//   the one classifier verifies — retries what a retry can fix, waits on what needs an invite or a rank, and writes ONE line.
//
//   Driven on the REAL modules (both engines, the seam, `features/room.js`) against a homeserver MODEL (`tests/_inviteworld.js`):
//   the real opening (`Room.join`), the real lobby Accept and Decline, and the triggers the way the app fires them — a
//   membership change, a power-level change, a space listing a channel.
//     WAYS IN (each a row; the owner asked for every one to be tested):
//       W1  fresh join: lobby Accept joins the room ONLY; Open joins its channels — open ones, a verified invite — in one pass.
//       W2  join by Space ID: the opening joins the room itself, then its channels.
//       W3  promoted while the room is open: the invites and the new rank are taken by the running room's passes.
//       W4  promoted while the tab shows the lobby: the same — the lobby calls nothing in Room (`check-runner-room-change` P-i).
//       W5  promoted while in another room, then opening it: the invite WAITS (not joined, shown in the lobby) and the opening
//           takes it.
//       W6  reload: no room runs, so nothing is joined until a room is opened; the opening takes it.
//       W7  an upgrade adds a channel: the running room's listing triggers a pass that joins it, and it is mapped.
//       W8  the bot invites to the presence chat: the membership trigger takes it.
//     THE STEP ITSELF:
//       S1  ONE line per pass naming every channel the room lists, and coalescing: triggers during a pass ask for ONE more.
//       S2  retries: a transient failure is retried and says how often; one that never clears gives up and says why.
//       S2b an opening never waits for a retry (`ddjp_539`): it goes on while a channel's join is in its backoff (J101).
//       S3  a refusal waits, at the level it was refused at: not tried again at that level, tried again once it rises.
//       S4  NOT VERIFIED, NOT TAKEN: an invite to a listed channel made by someone other than the room's creator.
//       S5  RULING 14: a pass stops when its room stops running here; a channel of another room is never mapped into this one.
//       S5b RULING 14: a verified invite to ANOTHER room's channel, listed by this room's space, is not taken (J82, owner's K1).
//       S6  the lobby: Accept joins no channel; Decline refuses the room AND the channel invitations waiting under it; a decline
//           that fails says so and the invite stays (ruling 15).
//       S7  an OLD room (channels without the mark) is refused by name, and the room that was running keeps running.
//       S8  rank changes in a row give ONE pass, about two seconds after the last (owner's live test: seven retries in six seconds).
//     THE STEP DOES NOT REPEAT (J84-1; the owner's quick live check at `?v=528`: six passes in five seconds right after
//     opening, each "an invite or membership changed", nothing joined):
//       J1  after an opening, room-list changes that bring nothing run no pass and write no line: ONE line, the opening's.
//       J2  a burst of room-list changes arms ONE request, 250 ms on; nothing runs before it fires.
//       J3  a change that lands DURING a pass is read by the next one; a change during a pass that brings nothing adds none.
//       J4  a channel that gave up is not skipped: the next room-list change tries it again.
//       J5  the leave cancels a pending request.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[join-step] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[join-step] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (fn) => PARTS.push(fn);

const ME = W.ME, OWNER = W.OWNER;
const steps = (w, from) => w.lines(/MatrixBridge: join step for /, from);
const joinedBy = (w, id) => w.hs.joins.indexOf(ME + " " + id) >= 0;
const attempts = (w, id) => w.hs.joins.filter((x) => x === ME + " " + id).length;
// A DDJP room `sid` this account is in: the space joined, nothing else (as a lobby Accept leaves it). `level`: this account's.
function roomIn(hs, sid, o) {
  o = o || {};
  const r = hs.ddjpRoom(sid, Object.assign({ levels: { [ME]: o.level || 0 } }, o));
  hs.rooms[sid].members[ME] = "join";
  return r;
}
// The promotion, as `assignRank` sends it: power everywhere, then the invites its level belongs in.
function promote(hs, r, level, keys) {
  for (const id of [r.spaceId].concat(Object.values(r.ch))) hs.rooms[id].power = { users: Object.assign({}, hs.rooms[id].power.users, { [ME]: level }), users_default: 0 };
  for (const k of keys) hs.invite(r.ch[k], ME, { from: OWNER });
}
const opened = async (w, sid) => { await w.Room.join(sid); await w.settle(40); };

// ── W1 — FRESH JOIN: Accept joins the room only; Open joins its channels in one pass ─────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } });
  hs.invite("!a:hs", ME, { from: OWNER });
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });   // sent with the room invite (assignRank before they joined)
  const w = W.inviteWorld({ hs });
  await w.Room.acceptInvite("!a:hs");
  await w.settle(10);
  ok(joinedBy(w, "!a:hs"), "W1 PREMISE — Accept joined the room");
  ok(Object.values(A.ch).every((id) => !joinedBy(w, id)), "W1: LOBBY ACCEPT JOINS THE ROOM ONLY — no channel, the invited staff chat " +
    "included, until the room is opened (D4)", hs.joins);
  ok(typeof w.Room.runningRoom === "function" && w.Room.runningRoom() === null, "W1: and accepting is not opening — nothing runs here yet",
    typeof w.Room.runningRoom === "function" ? w.Room.runningRoom() : "(no runningRoom)");
  const l0 = w.logs.length;
  await opened(w, "!a:hs");
  const open = steps(w, l0).filter((m) => /\(opening\)/.test(m));
  ok(open.length === 1, "W1: the opening wrote ONE join-step line", steps(w, l0));
  const line = open[0] || "";
  ok(["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"].every((k) => joinedBy(w, A.ch[k]) && new RegExp(k + " joined").test(line)),
    "W1: every OPEN channel joined at the opening, each named in that line", line);
  ok(joinedBy(w, A.ch.chat_staff) && /chat_staff joined \(invite\)/.test(line), "W1: the staff chat's invite, verified, joined at the opening", line);
  ok(!joinedBy(w, A.ch.chat_guest) && !joinedBy(w, A.ch.presence_chat) && (line.match(/waits \(no invite: M_FORBIDDEN\)/g) || []).length === 2,
    "W1: the invite-only channels with no invite WAIT, each saying why", line);
  const ch = (w.Room.getCurrent() || {}).channels || {};
  ok(ch.chat_staff === A.ch.chat_staff && ch.events_owner === A.ch.events_owner && !ch.chat_guest,
    "W1: and the map holds what was joined, keyed by each channel's MARK", ch);
  ok(w.lines(/waitForSpaceChildren timed out/).length === 0,
    "W1: the opening does not sit out its cap for the channels that wait — a channel refused counts as answered", w.lines(/timed out/));
});

// ── W2 — JOIN BY SPACE ID: the opening joins the room itself ──────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } });
  hs.invite("!a:hs", ME, { from: OWNER });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  ok(joinedBy(w, "!a:hs") && joinedBy(w, A.ch.events_owner) && joinedBy(w, A.ch.chat_uncategorized),
    "W2: opening an invited room by its id joins the room, then its open channels", hs.joins);
  ok(w.Room.runningRoom && w.Room.runningRoom() === "!a:hs", "W2: and it runs here");
});

// W3 / W4 — PROMOTED WHILE THE ROOM RUNS (open, or the tab in the lobby: the lobby calls nothing in Room — P-i)
for (const where of ["open", "in the lobby"]) {
  part(async () => {
    const hs = W.homeserver();
    const A = roomIn(hs, "!a:hs", { level: 0 });
    const w = W.inviteWorld({ hs });
    await opened(w, "!a:hs");
    ok(!joinedBy(w, A.ch.chat_staff), (where === "open" ? "W3" : "W4") + " PREMISE — not in the staff chat before the promotion");
    const l0 = w.logs.length;
    promote(hs, A, 60, ["chat_guest", "chat_staff"]);
    w.emit("Room.myMembership");                                                  // the invites arrive
    w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);         // the rank arrives
    await w.settle(60);
    const tag = where === "open" ? "W3" : "W4";
    ok(joinedBy(w, A.ch.chat_staff) && joinedBy(w, A.ch.chat_guest), tag + ": promoted while the room runs (" + where + "), the new chats' " +
      "invites are taken by the running room's passes", hs.joins);
    ok(steps(w, l0).some((m) => /chat_staff joined \(invite\)/.test(m)), tag + ": and the line says so", steps(w, l0));
    const ch = (w.Room.getCurrent() || {}).channels || {};
    ok(ch.chat_staff === A.ch.chat_staff && ch.chat_guest === A.ch.chat_guest, tag + ": and both are mapped, offered as tiers", ch);
  });
}

// ── W5 — PROMOTED WHILE IN ANOTHER ROOM, THEN OPENING IT ─────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  roomIn(hs, "!b:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  await opened(w, "!b:hs");
  ok(w.Room.runningRoom && w.Room.runningRoom() === "!b:hs", "W5 PREMISE — room B runs here");
  promote(hs, A, 60, ["chat_staff"]);
  w.emit("Room.myMembership");
  await w.settle(40);
  ok(!joinedBy(w, A.ch.chat_staff), "W5: A's staff-chat invite WAITS while B runs — nothing of one room is joined for another (8b, 14)", hs.joins);
  const scan = w.Room.scanDDJPRooms();
  const a = (scan.joined || []).concat(scan.owned || []).find((r) => r.spaceId === "!a:hs");
  ok(a && a.waiting === 1, "W5: and the lobby shows it waiting under A", scan);
  const l0 = w.logs.length;
  await opened(w, "!a:hs");
  ok(joinedBy(w, A.ch.chat_staff) && steps(w, l0).some((m) => /\(opening\)/.test(m) && /chat_staff joined \(invite\)/.test(m)),
    "W5: opening A takes it, in the opening's line", steps(w, l0));
});

// ── W6 — RELOAD: nothing runs until a room is opened ───────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  const w = W.inviteWorld({ hs });   // a fresh tab: the lobby, no room opened
  const l0 = w.logs.length;
  if (w.Room.onRoomsChanged) w.Room.onRoomsChanged(() => {});   // the room list's first render wires it, and says what is pending
  w.emit("Room.myMembership");
  await w.settle(30);
  ok(!joinedBy(w, A.ch.chat_staff) && steps(w, l0).length === 0, "W6: after a reload no room runs, so no pass runs and the invite waits",
    { joins: hs.joins, steps: steps(w, l0) });
  ok(w.lines(/Room: invite .*CHANNEL chat_staff .*verified.*waits: .* is not running on this tab/, l0).length === 1,
    "W6: and its line says it waits, and why — once, at wiring, not again for a change that did not move it", w.lines(/Room: invite/, l0));
  await opened(w, "!a:hs");
  ok(joinedBy(w, A.ch.chat_staff), "W6: opening the room takes it");
});

// ── W7 — AN UPGRADE ADDS A CHANNEL: the running room's listing triggers a pass ───────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const keys = W.B2_KEYS.filter((k) => k !== "chat_uncategorized");
  const A = roomIn(hs, "!a:hs", { level: 0, keys });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const id = "!a-chat-uncategorized:hs";
  hs.room(id, { name: "chat-uncategorized", creator: OWNER, content: { room_version: "12", ddjp_room: "!a:hs", ddjp_kind: "chat_uncategorized" },
    members: { [OWNER]: "join" }, joinRule: "restricted", allow: "!a:hs", parent: "!a:hs" });
  hs.rooms["!a:hs"].children.push(id);
  const l0 = w.logs.length;
  w.state("!a:hs", "m.space.child", id, { via: ["hs"] });
  await w.settle(40);
  ok(joinedBy(w, id) && steps(w, l0).some((m) => /the room listed a new channel/.test(m) && /chat_uncategorized joined/.test(m)),
    "W7: the room listing a new channel runs a pass that joins it", steps(w, l0));
  ok(((w.Room.getCurrent() || {}).channels || {}).chat_uncategorized === id, "W7: and it is mapped by its mark");
  // CONTROL: another room listing a channel runs nothing here.
  const l1 = w.logs.length;
  w.state("!z:hs", "m.space.child", "!z-x:hs", { via: ["hs"] });
  await w.settle(10);
  ok(steps(w, l1).length === 0, "W7 CONTROL: a listing in a room that does not run here runs no pass", steps(w, l1));
  void A;
});

// ── W8 — THE BOT INVITES TO THE PRESENCE CHAT ──────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  hs.invite(A.ch.presence_chat, ME, { from: "@bot:hs" });   // the bot invites; the CHANNEL was made by the room's creator
  w.emit("Room.myMembership");
  await w.settle(40);
  ok(joinedBy(w, A.ch.presence_chat), "W8: the presence chat's invite is taken by the membership trigger — whoever sent it, the channel " +
    "is the room's: its mark names the room, the room lists it, the room's creator made it", hs.joins);
});

// ── S1 — ONE LINE PER PASS, AND COALESCING ─────────────────────────────────────────────────────────────────────────────────
// RE-AIMED AT J84-1 (the reason): the four triggers were three room-list changes and a rank. A room-list change now waits
// for its burst and only checks for work (J1–J5 below), so it no longer lands inside this pass; the triggers here are the
// ones that name a change and always run — a rank that settled, and the room listing a channel — four of them, the first
// starting the pass and three arriving while it runs.
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const l0 = w.logs.length;
  promote(hs, A, 60, ["chat_staff"]);
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);       // starts the pass
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  w.state("!a:hs", "m.space.child", A.ch.chat_guest, { via: ["hs"] });
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  await w.settle(60);
  const s = steps(w, l0);
  ok(s.length === 2, "S1: FOUR triggers while one pass ran give that pass and exactly ONE more — coalesced, not four", s);
  ok(s.length >= 2 && /\(this account's rank changed; the room listed a new channel\)|\(the room listed a new channel; this account's rank changed\)/.test(s[1]),
    "S1: and the second pass names every reason it answers, once each", s[1]);
  const names = Object.values(A.ch).map((id) => id);
  ok(s.every((m) => names.every((id) => m.indexOf(id.slice(0, 10)) >= 0 || /(events_uncategorized|events_owner|settings_owner|chat_uncategorized|chat_staff)/.test(m))) &&
     s.every((m) => / — 7 channels, \d+ joined now$/.test(m)),
    "S1: each line names all seven channels the room lists and ends with the count", s);
});

// ── S2 — RETRIES, AND GIVING UP, EACH SAID ───────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  hs.failNext[A.ch.chat_staff] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }, { errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  hs.failNext[A.ch.chat_uncategorized] = Array.from({ length: 7 }, () => ({ errcode: "M_UNKNOWN", httpStatus: 502 }));
  const w = W.inviteWorld({ hs });
  const l0 = w.logs.length;
  await opened(w, "!a:hs");
  const line = steps(w, l0).find((m) => /\(opening\)/.test(m)) || "";
  ok(joinedBy(w, A.ch.chat_staff) && /chat_staff joined after 2 retries \(invite\)/.test(line), "S2: a transient failure is retried, and the " +
    "line says how often", line);
  ok(/gave up after 6 retries \(M_UNKNOWN\) — waits for the next change/.test(line),
    "S2: one that never clears gives up after the backoff and says why — never silent (15)", line);
  ok(attempts(w, A.ch.chat_uncategorized) === 1 && steps(w, l0).some((m) => !/\(opening\)/.test(m) && /chat_uncategorized joined/.test(m)),
    "S2: and the next change (here, the room opening's own wiring pass) tries it again and joins it", steps(w, l0));
});

// ── S2b — AN OPENING NEVER WAITS FOR A RETRY (`ddjp_539`; J101) ──────────────────────────────────────────────────────────
// `check-channel-join` A held this until J81 retired that guard (`ddjp_574`). The backoff is held open here (its seam returns
// a promise this row releases), so a channel's join is still retrying when the opening is read. The opening waits only until
// the children have synced in (an invited channel has); it must not wait for the pass, which ends with the retry.
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  hs.failNext[A.ch.chat_staff] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  const w = W.inviteWorld({ hs });
  let release = null, slept = 0;
  const held = new Promise((r) => { release = r; });
  w.MB._setJoinSleepForTest(() => { slept++; return held; });
  const l0 = w.logs.length;
  const opening = w.Room.join("!a:hs").then(() => "opened", (e) => "threw: " + ((e && e.message) || e));
  const cap = new Promise((r) => { const t = setTimeout(() => r("still opening after 4 s"), 4000); opening.then(() => clearTimeout(t)); });
  const first = await Promise.race([opening, cap]);
  ok(slept === 1 && !joinedBy(w, A.ch.chat_staff) && steps(w, l0).filter((m) => /\(opening\)/.test(m)).length === 0,
    "S2b PREMISE — the staff chat's join is still retrying when the opening is read: one backoff begun, not joined, the pass's line " +
    "not yet written", { slept, joined: joinedBy(w, A.ch.chat_staff), lines: steps(w, l0) });
  ok(first === "opened" && w.Room.runningRoom() === "!a:hs", "S2b: AN OPENING NEVER WAITS FOR A RETRY (`ddjp_539`) — it goes on, and " +
    "the room runs, while a channel's join is still in its backoff", first);
  release();
  await opening;
  await w.settle(40);
  const line = steps(w, l0).find((m) => /\(opening\)/.test(m)) || "";
  const ch = (w.Room.getCurrent() || {}).channels || {};
  ok(joinedBy(w, A.ch.chat_staff) && /chat_staff joined after 1 retry \(invite\)/.test(line) && ch.chat_staff === A.ch.chat_staff,
    "S2b: and when the retry clears, the channel is joined, the opening's line says so, and it is mapped then", { line, mapped: ch.chat_staff || null });
});

// ── S3 — A REFUSAL WAITS, AT THE LEVEL IT WAS REFUSED AT ────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const tries0 = attempts(w, A.ch.chat_staff);
  const l0 = w.logs.length;
  // RE-AIMED AT J84-1 (the reason): the trigger was a room-list change, which now runs no pass when it would join nothing
  // (J1) — so it could no longer show what a pass says of this channel. A rank that settled at the same level runs one.
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  await w.settle(40);
  ok(attempts(w, A.ch.chat_staff) === tries0 && steps(w, l0).some((m) => /waits \(no invite; refused at level 0\)/.test(m)),
    "S3: a channel refused at this level is NOT tried again at it (ddjp_563) — and the line says what it waits for", steps(w, l0));
  promote(hs, A, 60, []);   // the level rises, no invite yet: an invite-only chat still refuses, but it IS tried again
  const spy = hs.rooms[A.ch.chat_staff];
  let asked = 0; const join0 = w.client.joinRoom;
  w.client.joinRoom = async (id) => { if (id === spy.id) asked++; return join0(id); };
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  await w.settle(40);
  ok(asked === 1, "S3: once the level rises above it, it is tried again — once", asked);
});

// ── S4 — NOT VERIFIED, NOT TAKEN ───────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60, madeBy: { chat_staff: "@stranger:hs" } });
  hs.invite(A.ch.chat_staff, ME, { from: "@stranger:hs" });
  const w = W.inviteWorld({ hs });
  const l0 = w.logs.length;
  await opened(w, "!a:hs");
  ok(!joinedBy(w, A.ch.chat_staff), "S4: an invite to a channel the room lists, but made by someone other than the room's creator, is NOT " +
    "joined — before J81 any invite to a listed channel was accepted", hs.joins);
  ok(steps(w, l0).some((m) => /not taken: made by someone other than the room's creator/.test(m)), "S4: and the line says why", steps(w, l0));
});

// ── S5 — RULING 14: NOTHING OF ONE ROOM IS JOINED OR MAPPED FOR ANOTHER ────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  const B = roomIn(hs, "!b:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  // A pass for A held mid-retry, while the tab opens B: when it resumes, A no longer runs here.
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  hs.failNext[A.ch.chat_staff] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  let release = null; const gate = new Promise((r) => { release = r; });
  w.MB._setJoinSleepForTest(() => gate);
  const l0 = w.logs.length;
  w.emit("Room.myMembership");
  await w.settle(10);
  w.MB._setJoinSleepForTest(() => Promise.resolve());
  await opened(w, "!b:hs");
  release();
  await w.settle(40);
  ok(!joinedBy(w, A.ch.chat_staff) && steps(w, l0).some((m) => /^info: MatrixBridge: join step for !a:hs/.test(m) && /chat_staff stopped \(the room no longer runs on this tab\)/.test(m)),
    "S5: A's pass, resumed after the tab opened B, STOPS rather than join A's channel for a room that no longer runs here", steps(w, l0));
  // B runs; A's channels joined by a pass for A (as an opening's would) are announced — and not mapped into B.
  hs.rooms[A.ch.chat_staff].members[ME] = "invite";
  await w.MB.joinRoomChannels("!a:hs", "a guard's direct pass", { wanted: () => true });
  await w.settle(10);
  const ch = (w.Room.getCurrent() || {}).channels || {};
  ok(joinedBy(w, A.ch.chat_staff) && Object.values(ch).indexOf(A.ch.chat_staff) < 0 && Object.values(ch).every((id) => Object.values(B.ch).indexOf(id) >= 0),
    "S5: a channel of room A, joined while B runs, is never mapped into B — every channel in B's map is B's", ch);
});

// ── S5b — RULING 14: A VERIFIED INVITE TO ANOTHER ROOM'S CHANNEL IS NOT TAKEN FOR THIS ONE (J82, the owner's K1) ─────────────
// Room A's space also lists one of room B's channels, and this account holds B's creator's invite to it — an invite the one
// classifier VERIFIES, for B. A's opening pass reaches it among A's listed channels. It is B's, so A's pass does not join it, and
// the line names it as another room's. (The owner's break K1 — the join step no longer asking that a verified invite is for THIS
// room — left `check-join-step` and `check-invite-kinds` green: nothing put another room's verified channel in a room's list.)
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  const B = roomIn(hs, "!b:hs", { level: 60 });
  hs.invite(B.ch.chat_staff, ME, { from: OWNER });                 // verified for B: B lists it, B's creator made it and invited
  hs.rooms[A.spaceId].children.push(B.ch.chat_staff);             // and A's space lists it too
  const w = W.inviteWorld({ hs });
  const l0 = w.logs.length;
  let threw = null;
  try { await opened(w, "!a:hs"); } catch (e) { threw = (e && e.message) || String(e); }
  ok(!joinedBy(w, B.ch.chat_staff), "S5b: A's opening pass does NOT join room B's channel, though A lists it and the invite to it is " +
    "verified — verified for B, not for A", { joins: hs.joins, threw: threw });
  ok(!threw, "S5b: and A opens — a joined channel of another room would make the opening refuse A by name", threw);
  ok(steps(w, l0).some((m) => /^info: MatrixBridge: join step for !a:hs/.test(m) && /not taken: a channel of another room \(!b:hs\)/.test(m)),
    "S5b: and the line says it is another room's", steps(w, l0));
  ok(joinedBy(w, A.ch.events_owner) || steps(w, l0).some((m) => /events_owner (joined|in)/.test(m)),
    "S5b CONTROL: A's own channels are joined by the same pass", steps(w, l0));
});

// ── S6 — THE LOBBY: ACCEPT JOINS NO CHANNEL; DECLINE REFUSES THE ROOM AND WHAT WAITS UNDER IT; A FAILED DECLINE SAYS SO ────────
part(async () => {
  const hs = W.homeserver();
  const A = hs.ddjpRoom("!a:hs", { levels: { [ME]: 60 } });
  hs.invite("!a:hs", ME, { from: OWNER });
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  hs.invite(A.ch.chat_guest, ME, { from: OWNER });
  const w = W.inviteWorld({ hs });
  ok(typeof w.Room.declineInvite === "function", "S6: APPLIED — the lobby's room invitations have Decline (ruling 16)");
  if (typeof w.Room.declineInvite !== "function") return;
  hs.failNext["leave:!a:hs"] = [{ errcode: "M_UNKNOWN", httpStatus: 502, message: "bad gateway" }];
  const r1 = await w.Room.declineInvite("!a:hs");
  ok(r1 && r1.ok === false && hs.rooms["!a:hs"].members[ME] === "invite" && w.lines(/Room: could not decline .*it stays/).length === 1,
    "S6: a decline that fails SAYS SO and the invite stays (ruling 15)", { r1, logs: w.lines(/decline/) });
  const r2 = await w.Room.declineInvite("!a:hs");
  ok(r2 && r2.ok === true && ["!a:hs", A.ch.chat_staff, A.ch.chat_guest].every((id) => hs.rooms[id].members[ME] === "leave"),
    "S6: Decline refuses the room AND the two channel invitations waiting under it", r2);
  ok(hs.joins.length === 0, "S6 CONTROL: nothing was joined", hs.joins);
});

// ── S7 — AN OLD ROOM IS REFUSED BY NAME, AND THE ROOM THAT RAN KEEPS RUNNING ─────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  roomIn(hs, "!a:hs", { level: 0 });
  const O = hs.ddjpRoom("!old:hs", { levels: { [ME]: 0 }, unmarked: true });
  hs.rooms["!old:hs"].members[ME] = "join";
  for (const id of Object.values(O.ch)) if (!hs.rooms[id].joinRule || hs.rooms[id].joinRule === "restricted") hs.rooms[id].members[ME] = "join";
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  let msg = null;
  try { await w.Room.join("!old:hs"); } catch (e) { msg = (e && e.message) || String(e); }
  ok(msg !== null && /made before its channels carried their room's mark/.test(msg) && /created again/.test(msg),
    "S7: a room whose channels carry no mark is REFUSED BY NAME (forward only, ruling 7)", msg);
  ok(w.Room.runningRoom && w.Room.runningRoom() === "!a:hs", "S7: and refused before anything was reset — the room that was running still runs",
    w.Room.runningRoom && w.Room.runningRoom());
});

// ── S8 — RANK CHANGES IN A ROW: ONE PASS ─────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const held = [];
  w.MB._setRankLaterForTest((fn, ms) => { const h = { fake: true, live: true, fn, ms }; held.push(h); return h; });
  const l0 = w.logs.length;
  for (let i = 0; i < 7; i++) w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  const live = held.filter((h) => h.live);
  ok(held.length === 7 && live.length === 1 && live[0].ms === 2000, "S8: seven rank changes in a row leave ONE pending pass, 2 s after the last",
    held.map((h) => [h.live, h.ms]));
  for (const h of live) h.fn();
  await w.settle(30);
  ok(steps(w, l0).length === 1 && /this account's rank changed/.test(steps(w, l0)[0] || ""), "S8: and it runs ONE pass", steps(w, l0));
});

// ── J1 — AFTER AN OPENING, ROOM-LIST CHANGES THAT BRING NOTHING RUN NO PASS ───────────────────────────────────────────────
// The owner's finding, as a row: a room-list change used to run a pass every time; opening a room fires many.
part(async () => {
  const hs = W.homeserver();
  roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  const l0 = w.logs.length, k0 = w.MB._joinSkipsForTest ? w.MB._joinSkipsForTest() : null;
  await opened(w, "!a:hs");
  for (let i = 0; i < 6; i++) { w.emit("Room.myMembership"); w.emit("Room"); await w.settle(8); }
  await w.settle(20);
  const s = steps(w, l0);
  ok(s.length === 1 && /\(opening\)/.test(s[0] || ""), "J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING: ONE join-step " +
    "line, the opening's — no \"an invite or membership changed\" pass and no \"the room is open\" pass while there is nothing to join", s);
  ok(k0 !== null && w.MB._joinSkipsForTest() > k0, "J1: APPLIED — the requests were made and the bridge skipped them, rather than nothing having asked",
    k0 === null ? "(no skip counter in this tree)" : w.MB._joinSkipsForTest() - k0);
});

// ── J2 — A BURST ARMS ONE REQUEST, 250 ms ON ────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const held = [];
  if (typeof w.Room._setJoinLaterForTest === "function") w.Room._setJoinLaterForTest((fn, ms) => { const h = { fake: true, live: true, fn, ms }; held.push(h); return h; });
  const l0 = w.logs.length;
  hs.invite(A.ch.presence_chat, ME, { from: "@bot:hs" });   // work for the one pass
  for (let i = 0; i < 6; i++) w.emit("Room.myMembership");
  await w.settle(20);
  ok(held.length === 1 && held[0].ms === 250, "J2: SIX ROOM-LIST CHANGES IN A BURST ARM ONE REQUEST, 250 ms on", held.map((h) => h.ms));
  ok(steps(w, l0).length === 0 && !joinedBy(w, A.ch.presence_chat), "J2: and nothing runs before it fires", steps(w, l0));
  for (const h of held) if (h.live) h.fn();
  await w.settle(40);
  const s = steps(w, l0);
  ok(s.length === 1 && /\(an invite or membership changed\)/.test(s[0] || "") && joinedBy(w, A.ch.presence_chat),
    "J2: when it fires, ONE pass takes the work the burst brought, and its line says so", s);
});

// ── J3 — A CHANGE DURING A PASS IS READ BY THE NEXT ONE; ONE THAT BRINGS NOTHING ADDS NONE ──────────────────────────────────
// Why not a signature of what changed: a pass's own joins change what it reads, and a change landing while it runs is
// part of what it ENDS on but not of what it acted on. The bridge asks the question that cannot skip work instead.
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const holdPassOn = (key) => {   // a new channel the room lists, whose first join fails once and whose retry waits on a gate
    const id = "!a-" + key + ":hs";
    hs.room(id, { name: key, creator: OWNER, content: { room_version: "12", ddjp_room: "!a:hs", ddjp_kind: key }, members: { [OWNER]: "join" },
      joinRule: "restricted", allow: "!a:hs", parent: "!a:hs" });
    hs.rooms["!a:hs"].children.push(id);
    hs.failNext[id] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
    let release = null; const gate = new Promise((r) => { release = r; });
    w.MB._setJoinSleepForTest(() => gate);
    w.state("!a:hs", "m.space.child", id, { via: ["hs"] });
    return { id, release: () => { w.MB._setJoinSleepForTest(() => Promise.resolve()); release(); } };
  };
  // A — a room-list change while the pass runs, bringing nothing: no second pass.
  const l0 = w.logs.length;
  const x = holdPassOn("events_x");
  await w.settle(10);
  w.emit("Room.myMembership"); w.emit("Room.myMembership");
  await w.settle(10);
  x.release();
  await w.settle(40);
  const sa = steps(w, l0);
  ok(joinedBy(w, x.id) && sa.length === 1 && /the room listed a new channel/.test(sa[0] || ""),
    "J3: ROOM-LIST CHANGES WHILE A PASS RUNS, BRINGING NOTHING, ADD NO PASS — the one asked for after it is skipped", sa);
  // B — an invite arrives while the pass runs: the pass after it takes it, and says so.
  const l1 = w.logs.length;
  const y = holdPassOn("events_y");
  await w.settle(10);
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  w.emit("Room.myMembership");
  await w.settle(10);
  y.release();
  await w.settle(40);
  const sb = steps(w, l1);
  ok(joinedBy(w, A.ch.chat_staff) && sb.length === 2 && /\(an invite or membership changed\)/.test(sb[1] || "") && /chat_staff joined \(invite\)/.test(sb[1] || ""),
    "J3: AN INVITE THAT ARRIVES WHILE A PASS RUNS is taken by the pass after it, and that pass's line says so", sb);
  // C — a room-list change AND a rank while the pass runs, neither bringing work: the pass after it still runs, because the
  // rank names a change (a coalesced pass is skipped only when EVERY request in it only checked for work).
  const l2 = w.logs.length;
  const z = holdPassOn("events_z");
  await w.settle(10);
  w.emit("Room.myMembership");
  await w.settle(10);
  w.state("!a:hs", "m.room.power_levels", "", hs.rooms["!a:hs"].power);
  await w.settle(4);
  z.release();
  await w.settle(40);
  const sc = steps(w, l2);
  ok(sc.length === 2 && /an invite or membership changed/.test(sc[1] || "") && /this account's rank changed/.test(sc[1] || ""),
    "J3: A RANK THAT ARRIVES WITH A ROOM-LIST CHANGE WHILE A PASS RUNS still gets its pass after it, naming both — a coalesced pass is " +
    "skipped only when every request in it only checked for work", sc);
});

// ── J4 — A CHANNEL THAT GAVE UP IS NOT SKIPPED ───────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 0 });
  // Seven failures give up once (the first try and six retries); fourteen give up at the opening AND at its catch-up.
  hs.failNext[A.ch.chat_uncategorized] = Array.from({ length: 14 }, () => ({ errcode: "M_UNKNOWN", httpStatus: 502 }));
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  ok(!joinedBy(w, A.ch.chat_uncategorized), "J4 PREMISE — it gave up, at the opening and at the catch-up after it", hs.joins);
  const l0 = w.logs.length;
  w.emit("Room.myMembership");
  await w.settle(40);
  ok(joinedBy(w, A.ch.chat_uncategorized) && steps(w, l0).some((m) => /\(an invite or membership changed\)/.test(m) && /chat_uncategorized joined/.test(m)),
    "J4: A CHANNEL THAT GAVE UP \"waits for the next change\" — and the next room-list change tries it again and joins it", steps(w, l0));
});

// ── J5 — THE LEAVE CANCELS A PENDING REQUEST ─────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  roomIn(hs, "!a:hs", { level: 0 });
  const w = W.inviteWorld({ hs });
  await opened(w, "!a:hs");
  const held = [];
  if (typeof w.Room._setJoinLaterForTest === "function") w.Room._setJoinLaterForTest((fn, ms) => { const h = { fake: true, live: true, fn, ms }; held.push(h); return h; });
  w.emit("Room.myMembership");
  ok(held.length === 1 && held[0].live, "J5 PREMISE — a room-list change armed its request", held.length);
  w.Room.leave("a guard's leave");
  ok(held.length === 1 && held[0].live === false, "J5: THE LEAVE CANCELS IT — nothing of the room waits to run in the lobby", held.map((h) => h.live));
});

(async () => {
  for (const fn of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[join-step] FAIL — a part threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[join-step] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[join-step] PASS — one join step joins a room's channels, only for the room that runs on this tab, and says what " +
    "happened to each (J81; " + asserts + " assertions). Every way in, driven through the real opening and the real triggers: a lobby " +
    "Accept joins the room only and the opening joins its open channels and its verified invites; promoted while the room is open or " +
    "the tab in the lobby, the passes take the new invites; promoted in another room, the invite waits and is shown, and the opening " +
    "takes it; after a reload nothing is joined until a room is opened; an upgrade's new channel and the bot's presence invite are " +
    "taken. ONE line per pass names every channel, triggers during a pass give exactly one more, rank changes in a row give one pass, a transient failure is retried and " +
    "counted, one that never clears gives up and says why, a refusal waits at its level and is tried again when the level rises, an " +
    "invite to a channel made by someone else is not taken, a pass stops when its room stops running here and nothing of one room is " +
    "mapped into another, Decline refuses a room with the channel invitations waiting under it and a failed decline says so, and a " +
    "room without marks is refused by name while the running room keeps running. AND IT DOES NOT REPEAT (J84-1): after an opening, " +
    "room-list changes that bring nothing run no pass and write no line; a burst arms one request 250 ms on; a change that lands " +
    "during a pass is taken by the next one, and one that brings nothing adds none; a channel that gave up is tried again at the " +
    "next change; and the leave cancels a pending request.");
})();
