#!/usr/bin/env node
// tests/check-one-at-a-time.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/matrixaccount.js, features/room.js, ui/screens.js, ui/chat.js, index.html
//
// WALL: EVERY JOIN AND LEAVE THE APP SENDS RUNS ONE AT A TIME (the owner's rule, `ddjp_689`; his words: "yes but joinaccept and
// leave one at a time"). Read plainly, on two levels: one ROOM at a time — while one room is being accepted, joined, opened or
// left, every other such act waits — and inside each, one channel at a time. THE RULE LIVES IN ONE PLACE, the transport's door
// (`MatrixBridge.inTurn` and `sendMembership`, the only code that sends a join or a leave), not in the buttons, which only show it.
//
// Driven on the REAL modules (`features/room.js`, both engines, the bridge, the account) against the homeserver MODEL
// (`tests/_inviteworld.js`), and the REAL ui/ files in the screen world (`tests/_screen-world.js`):
//   A  TWO ACTS AT ONCE: a lobby Accept whose join is in its backoff holds the turn; a Decline asked meanwhile sends nothing
//      until the Accept is done, then goes — and the door says what runs and what waits, and the log says both.
//   B  EVERY WAY IN WAITS ITS TURN: with the turn held, an Accept, a Decline, a Join Room / opening, a running room's later pass,
//      a Leave, a Discard of a half-built room, a chat invite's Accept and its Refuse each send NOTHING; let go, each is sent.
//   C  THE ONE SENDER: in the backend and the features, no code but `sendMembership` calls the SDK's join or leave; and it refuses
//      one asked for outside its turn — nothing sent, and said.
//   D  NO WAIT CAN DEADLOCK: the loading card's back button (`Room.cancelOpening`) frees its opening's turn AT ONCE — a Leave that
//      waited behind the opening's retrying join goes without the retry ever ending; an opening cancelled while it waits sends
//      nothing, ever; and an opening started while the running room's pass is in a backoff opens without waiting for it.
//   E  THE BUTTONS SHOW IT (the screen world): while one runs, every Accept, Decline, Open, Leave and Discard is greyed, its
//      title naming what it waits for, a line above the list saying what runs; a chat invite's Accept and Refuse too, its line
//      saying what they wait for; when it ends, each comes back — except one greyed for its own reason. JOIN ROOM IS NOT GREYED
//      (`ddjp_690`, the owner's "as if you accepted an invite"): a press waits its turn in its own row, under "Joining", which
//      says what it waits for (`check-join-by-id`).
"use strict";
const fs = require("fs");
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ROOT = path.join(__dirname, "..");
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[one-at-a-time] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[one-at-a-time] FAIL — the guard did not finish: a wait never ended, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
// A WAIT ON THE REAL CLOCK, for a condition: an opening's bounded waits poll every 150 ms of real time (the world runs short timers).
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };
const within = (p, ms) => Promise.race([p.then(() => "done", () => "done"), new Promise((r) => setTimeout(() => r("still waiting after " + ms + " ms"), ms))]);

function roomIn(hs, sid, o) {
  o = o || {};
  const R = hs.ddjpRoom(sid, { levels: { [ME]: (typeof o.level === "number") ? o.level : 20 } });
  hs.rooms[sid].members[ME] = "join";
  for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) hs.rooms[R.ch[k]].members[ME] = "join";
  return R;
}
function store(o) {
  return { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {}, loadPendingCreate: () => (o && o.pending) || null, saveLeaving() {}, loadLeaving: () => [] } };
}
const sent = (hs) => hs.joins.length + hs.leaves.length;
// THE TURN HELD BY A GUARD: a direct turn at the real door, let go when the row says.
function hold(w) {
  let let_go = null;
  const held = new Promise((r) => { let_go = r; });
  const done = w.MB.inTurn("a guard's held turn", {}, () => held);
  return { release: () => { let_go(); return done; } };
}

// ── A — TWO ACTS AT ONCE ───────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const hs = W.homeserver();
  hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.invite("!a:hs", ME, { from: OWNER });
  hs.ddjpRoom("!b:hs", { levels: { [ME]: 0 } }); hs.invite("!b:hs", ME, { from: OWNER });
  hs.failNext["!a:hs"] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  const w = W.inviteWorld({ hs, extras: { Store: store() } });
  ok(typeof w.MB.inTurn === "function" && typeof w.MB.doorState === "function", "A: APPLIED — the transport has the door (`inTurn`, `doorState`)",
    { inTurn: typeof w.MB.inTurn, doorState: typeof w.MB.doorState });
  let release = null; const gate = new Promise((r) => { release = r; });
  w.MB._setJoinSleepForTest((ms, why) => (why === "pace" ? Promise.resolve() : gate));   // the Accept's join waits out its backoff until the row lets it go (its pace is not that, `ddjp_697`)
  const l0 = w.logs.length;
  const acc = w.Room.acceptInvite("!a:hs");
  await w.settle(10);
  const dec = w.Room.declineInvite("!b:hs");
  await w.settle(10);
  const d = w.MB.doorState ? w.MB.doorState() : {};
  ok(hs.rooms["!b:hs"].members[ME] === "invite" && hs.leaves.length === 0,
    "A: WHILE ONE RUNS THE OTHER WAITS — the Accept's join is in its backoff and the Decline has sent nothing", { leaves: hs.leaves });
  ok(d.busy === true && /^accepting a/.test(d.what || "") && (d.waiting || []).length === 1 && /^declining b/.test(d.waiting[0].what),
    "A: and the door says what runs and what waits", d);
  ok(w.lines(/MatrixBridge: one at a time — declining b waits for accepting a/, l0).length === 1, "A: and the log says what waits for what", w.lines(/one at a time/, l0));
  release();
  const accDone = await within(acc, 4000), decDone = await within(dec, 4000);   // a wait that never ends is a reading too (a deadlock)
  await w.settle(10);
  ok(accDone === "done" && decDone === "done" && hs.rooms["!a:hs"].members[ME] === "join" && hs.rooms["!b:hs"].members[ME] === "leave" &&
     w.lines(/MatrixBridge: one at a time — declining b goes/, l0).length === 1,
    "A: then the Decline goes, in its turn, and says so", { accDone, decDone, a: hs.rooms["!a:hs"].members[ME], b: hs.rooms["!b:hs"].members[ME] });
  ok(w.MB.doorState && w.MB.doorState().busy === false, "A: and the door is free again", w.MB.doorState && w.MB.doorState());
});

// ── B — EVERY WAY IN WAITS ITS TURN ─────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  if (typeof W.inviteWorld({ hs: W.homeserver() }).MB.inTurn !== "function") { ok(false, "B: APPLIED — the door exists"); return; }
  const ways = {
    "a lobby Accept": async () => { const hs = W.homeserver(); hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.invite("!a:hs", ME, { from: OWNER }); return { hs, run: (w) => w.Room.acceptInvite("!a:hs") }; },
    "a lobby Decline": async () => { const hs = W.homeserver(); hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.invite("!a:hs", ME, { from: OWNER }); return { hs, run: (w) => w.Room.declineInvite("!a:hs") }; },
    // JOIN ROOM BY A ROOM'S ID joins the room only since `ddjp_690` (`Room.joinById`); opening a room not yet joined is an opening.
    "Join Room (by a room's ID)": async () => { const hs = W.homeserver(); hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.invite("!a:hs", ME, { from: OWNER }); return { hs, run: (w) => w.Room.joinById("!a:hs") }; },
    "an opening of a room not yet joined": async () => { const hs = W.homeserver(); hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.invite("!a:hs", ME, { from: OWNER }); return { hs, run: (w) => w.Room.join("!a:hs") }; },
    "an opening of a room already joined (its join step)": async () => { const hs = W.homeserver(); const R = hs.ddjpRoom("!a:hs", { levels: { [ME]: 0 } }); hs.rooms["!a:hs"].members[ME] = "join"; void R; return { hs, run: (w) => w.Room.join("!a:hs") }; },
    "a Leave (for good)": async () => { const hs = W.homeserver(); roomIn(hs, "!a:hs"); return { hs, run: (w) => w.Room.leaveForGood("!a:hs") }; },
    "a Discard of a half-built room": async () => { const hs = W.homeserver(); const R = roomIn(hs, "!a:hs"); return { hs, pending: { name: "half", spaceId: "!a:hs", channels: { events_owner: R.ch.events_owner } }, run: (w) => w.Room.discardPendingCreate() }; },
    "a chat invite's Accept": async () => { const hs = W.homeserver(); hs.room("!dm:hs", { name: "dm", creator: "@x:hs", members: { "@x:hs": "join" } }); hs.invite("!dm:hs", ME, { from: "@x:hs", direct: true }); return { hs, run: (w) => w.MA.acceptDMInvite("!dm:hs") }; },
    "a chat invite's Refuse": async () => { const hs = W.homeserver(); hs.room("!dm:hs", { name: "dm", creator: "@x:hs", members: { "@x:hs": "join" } }); hs.invite("!dm:hs", ME, { from: "@x:hs", direct: true }); return { hs, run: (w) => w.MA.declineDMInvite("!dm:hs") }; },
  };
  for (const name of Object.keys(ways)) {
    const s = await ways[name]();
    const w = W.inviteWorld({ hs: s.hs, extras: { Store: store({ pending: s.pending }) } });
    const h = hold(w);
    await w.settle(4);
    const n0 = sent(s.hs);
    const p = Promise.resolve().then(() => s.run(w)).catch((e) => e);
    await until(() => w.MB.doorState().waiting.length >= 1, 3000);   // it reached the door (an opening first reads its listing)
    await w.settle(10);
    const waitedTo = sent(s.hs) - n0;
    const d = w.MB.doorState();
    await h.release();
    await within(p, 4000);
    await w.settle(30);
    ok(waitedTo === 0 && d.waiting.length >= 1, "B: " + name.toUpperCase() + " WAITS ITS TURN — nothing sent while another act holds it", { sentMeanwhile: waitedTo, waiting: d.waiting });
    ok(sent(s.hs) - n0 >= 1, "B: and " + name + " is sent once the turn is let go", { joins: s.hs.joins, leaves: s.hs.leaves });
  }
  // A RUNNING ROOM'S LATER PASS waits too.
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs");
  const w = W.inviteWorld({ hs, extras: { Store: store() } });
  await w.Room.join("!a:hs"); await w.settle(30);
  const h = hold(w);
  await w.settle(4);
  const n0 = sent(hs);
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  w.emit("Room.myMembership");
  await w.settle(40);
  const meanwhile = sent(hs) - n0, d = w.MB.doorState();
  await h.release();
  await w.settle(40);
  ok(meanwhile === 0 && d.waiting.some((x) => /^joining the channels of a/.test(x.what)),
    "B: A RUNNING ROOM'S LATER PASS WAITS ITS TURN too — an invite taken only once the turn is let go", { meanwhile, waiting: d.waiting });
  ok(hs.rooms[A.ch.chat_staff].members[ME] === "join", "B: and then the pass takes it", hs.rooms[A.ch.chat_staff].members[ME]);
});

// ── C — THE ONE SENDER ─────────────────────────────────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const files = [];
  for (const dir of ["backends/backend1", "backends/backend2", "features", "core", "ui"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith(".js")) files.push(dir + "/" + f);
  }
  files.push("app.js");
  const sites = [];
  for (const f of files) {
    const t = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
    const re = /\.(joinRoom|leave)\s*\(/g;
    let m;
    while ((m = re.exec(t))) {
      // `Room.leave(` / `Queue.leave(` / `Rep.leave(` are the app's own verbs, not the SDK's: only a CLIENT's join or leave counts.
      const before = t.slice(Math.max(0, m.index - 40), m.index);
      if (m[1] === "leave" && !/client\s*$|_c\(\)\s*$|\bc\s*$/.test(before)) continue;
      const fnAt = t.lastIndexOf("function ", m.index);
      sites.push(f + " " + (t.slice(fnAt, t.indexOf("(", fnAt)) || "?") + " ." + m[1]);
    }
  }
  ok(sites.length === 2 && sites.every((s) => /matrixbridge\.js function sendMembership \.(joinRoom|leave)$/.test(s)),
    "C: THE ONE SENDER — no code but `sendMembership` calls the SDK's join or leave (the rule in the one place everyone goes through)", sites);
  // Planted, the sweep sees a second sender (its control: the matcher matches what it claims to).
  const planted = strip("function x() { return client.leave(id); }").match(/\.(joinRoom|leave)\s*\(/g) || [];
  ok(planted.length === 1, "C CONTROL — the sweep's matcher finds a client's leave in a planted line", planted);
  const hs = W.homeserver(); roomIn(hs, "!a:hs");
  const w = W.inviteWorld({ hs, extras: { Store: store() } });
  if (typeof w.MB.sendMembership !== "function") { ok(false, "C: APPLIED — `sendMembership` exists"); return; }
  let err = null;
  try { await w.MB.sendMembership("leave", "!a:hs", null); } catch (e) { err = e; }
  ok(err && err.errcode === "DDJP_NO_TURN" && hs.leaves.length === 0 && w.lines(/one at a time — a leave of !a:hs was asked for outside its turn; not sent/).length === 1,
    "C: and it REFUSES one asked for outside its turn — nothing sent, and said", { err: err && err.message, leaves: hs.leaves });
});

// ── D — NO WAIT CAN DEADLOCK ───────────────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  // D1: an opening whose join is in a backoff that NEVER ends; a Leave waits behind it; the card's back frees the turn.
  const hs = W.homeserver();
  const A = roomIn(hs, "!a:hs", { level: 60 });
  roomIn(hs, "!b:hs");
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  hs.failNext[A.ch.chat_staff] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  const w = W.inviteWorld({ hs, extras: { Store: store() } });
  if (typeof w.Room.leaveForGood !== "function") { ok(false, "D: APPLIED — the room list's Leave exists"); return; }
  let slept = 0;
  const sleeping = () => slept > 0;
  // The backoff never ends by itself. CHANGED ON PURPOSE AT `ddjp_695`: the Leave's sends are paced through the same seam, and a
  // pacer's gap (marked "pace") does end — this row is about the backoff.
  w.MB._setJoinSleepForTest((ms, why) => { if (why === "pace") return Promise.resolve(); slept++; return new Promise(() => {}); });
  const opening = w.Room.join("!a:hs").then(() => "opened", (e) => (e && e.cancelled) ? "cancelled" : "threw: " + e.message);
  await until(() => /^opening a/.test(w.MB.doorState().what || "") && hs.joins.length === 0 && w.lines(/one at a time/).length === 0 && sleeping(), 3000);
  const n0 = hs.leaves.length;
  const leave = w.Room.leaveForGood("!b:hs");
  await w.settle(20);
  const meanwhile = hs.leaves.length - n0;
  ok(meanwhile === 0 && w.MB.doorState().waiting.some((x) => /^leaving b/.test(x.what)), "D PREMISE — the Leave waits behind the opening's retrying join",
    { meanwhile, door: w.MB.doorState() });
  w.Room.cancelOpening("back on the loading card");
  const got = await within(leave, 4000);
  ok(got === "done" && hs.rooms["!b:hs"].members[ME] === "leave", "D: THE LOADING CARD'S BACK FREES ITS TURN AT ONCE — the Leave goes, the retry never having ended", got);
  ok(w.lines(/one at a time — opening a given up \(its opening was cancelled\); its turn is free/).length === 1 || w.lines(/one at a time — opening a given up \(.*\); its turn is free/).length === 1,
    "D: and the log says the turn was given up and is free", w.lines(/one at a time/));
  void opening;
  // D2: an opening cancelled while it WAITS for its turn sends nothing, ever.
  const hs2 = W.homeserver();
  const C = roomIn(hs2, "!c:hs");
  for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) hs2.rooms[C.ch[k]].members[ME] = "leave";
  const w2 = W.inviteWorld({ hs: hs2, extras: { Store: store() } });
  const h = hold(w2);
  const op2 = w2.Room.join("!c:hs").then(() => "opened", (e) => (e && e.cancelled) ? "cancelled" : "threw: " + e.message);
  await until(() => w2.MB.doorState().waiting.length >= 1, 3000);
  ok(w2.MB.doorState().waiting.some((x) => /^opening c/.test(x.what)), "D PREMISE — the opening waits for its turn", w2.MB.doorState());
  w2.Room.cancelOpening("back on the loading card");
  ok(!w2.MB.doorState().waiting.some((x) => /^opening c/.test(x.what)), "D: the cancelled opening's waiting turn LEAVES THE QUEUE at once", w2.MB.doorState());
  await h.release();
  const r2 = await Promise.race([op2, new Promise((r) => setTimeout(() => r("still opening"), 4000))]);
  await w2.settle(30);
  ok(r2 === "cancelled" && hs2.joins.length === 0, "D: AN OPENING CANCELLED WHILE IT WAITS ITS TURN sends nothing, ever — its turn left the queue", { r2, joins: hs2.joins });
  // A TURN NOBODY WANTS ANY MORE IS NEVER GIVEN, even when nothing said so: its `wanted` is asked again as its turn comes.
  let want = true, ran = false;
  const h2 = hold(w2);
  const late = w2.MB.inTurn("a late act", { wanted: () => want }, () => { ran = true; }).then(() => "ran", (e) => (e && e.notWanted) ? "given up" : "threw");
  await w2.settle(4);
  want = false;   // nobody tells the door
  await h2.release();
  ok((await late) === "given up" && ran === false, "D: A TURN NOBODY WANTS ANY MORE IS NEVER GIVEN — asked again as it comes, unannounced", { ran });
  // D3: an opening started while the running room's pass is in a backoff that never ends opens without waiting for it.
  const hs3 = W.homeserver();
  const P = roomIn(hs3, "!p:hs", { level: 60 });
  roomIn(hs3, "!q:hs");
  const w3 = W.inviteWorld({ hs: hs3, extras: { Store: store() } });
  await w3.Room.join("!p:hs"); await w3.settle(30);
  hs3.invite(P.ch.chat_staff, ME, { from: OWNER });
  hs3.failNext[P.ch.chat_staff] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  w3.MB._setJoinSleepForTest((ms, why) => (why === "pace" ? Promise.resolve() : new Promise(() => {})));   // `ddjp_697`: the pace is not the backoff
  w3.emit("Room.myMembership");
  await w3.settle(30);
  ok(w3.MB.doorState().busy === true, "D PREMISE — the running room's pass holds the turn, in a backoff that never ends", w3.MB.doorState());
  const r3 = await Promise.race([w3.Room.join("!q:hs").then(() => "opened", (e) => "threw: " + e.message), new Promise((r) => setTimeout(() => r("still opening"), 4000))]);
  ok(r3 === "opened" && w3.Room.runningRoom() === "!q:hs", "D: AN OPENING DOES NOT WAIT FOR THE RUNNING ROOM'S RETRY — that pass gives its turn up to it", r3);
});

// ── E — THE BUTTONS SHOW IT ───────────────────────────────────────────────────────────────────────────────────────────────
part("E", async () => {
  let door = { busy: false, what: null, waiting: [] }, doorFn = null;
  const jobs = { "!own:hs": { spaceId: "!own:hs", name: "Room A", state: "failed", done: 2, total: 2, left: 1, resumed: false, failed: [{ label: "staff chat", why: "server busy" }] } };
  const scan = { owned: [{ spaceId: "!own:hs", name: "Room A" }], joined: [{ spaceId: "!join:hs", name: "Room B" }],
    invited: [{ spaceId: "!inv:hs", name: "Room C", waiting: [] }], unconfirmed: [{ roomId: "!unc:hs", name: "x", why: "not confirmed" }] };
  const conv = [{ userId: "@x:hs", request: true, roomIds: [], invites: [{ roomId: "!dm:hs", direct: true }] }];
  const w = SW.world({ features: {
    Room: { rankLadder: () => [], scanDDJPRooms: () => scan, getMyId: () => ME,
      pendingCreate: () => ({ name: "half", spaceId: "!half:hs", built: 2, total: 6 }),
      leaveJob: (sid) => (jobs[sid] ? JSON.parse(JSON.stringify(jobs[sid])) : null), leaveNotice: () => ({ owner: false, visibility: "private" }),
      leaveForGood: () => Promise.resolve({ ok: true }), doorState: () => door, onDoorChange: (fn) => { doorFn = fn; }, onLeaveJob: () => {},
      onRoomsChanged: () => {}, onLeft: () => {}, getRoster: () => [] },
    Chat: { conversations: () => conv, dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const doc = w.doc, S = w.sb.Screens;
  const list = doc.createElement("div"); list.id = "room-list"; doc.body.appendChild(list);
  const lockSlot = doc.createElement("span"); lockSlot.id = "rooms-lock"; doc.body.appendChild(lockSlot);
  const join = doc.createElement("button"); join.id = "btn-join-room"; join.className = "btn-secondary"; doc.body.appendChild(join);
  const dmHost = doc.createElement("div"); dmHost.id = "lobby-dm"; doc.body.appendChild(dmHost);
  S.showScreen("screen-rooms");
  S.renderRoomList(scan);
  q(".panel-lock-btn", lockSlot)[0] && q(".panel-lock-btn", lockSlot)[0].click();   // unlocked: Leave shows
  w.sb.ChatPanels.openLobbyDM(dmHost);
  function q(sel, root) { return (root || doc.body).querySelectorAll(sel); }
  const named = (t) => q("button", list).filter((b) => b.textContent === t);
  const gatedNow = () => ({ Accept: named("Accept"), Decline: named("Decline"), Open: named("Open"), Leave: named("Leave"), "Leave again": named("Leave again"), Discard: named("Discard"),
    rowOpen: q(".room-item-main", list).concat(q("button.room-item", list)) });
  const before = gatedNow();
  const dmAcc = q(".dm-invite-line button", dmHost).find((b) => b.textContent === "Accept"), dmRef = q(".dm-invite-line button", dmHost).find((b) => b.textContent === "Refuse");
  ok(before.Accept.length === 1 && before.Decline.length === 2 && before.Open.length === 1 && before.Leave.length === 1 && before["Leave again"].length === 1 && before.Discard.length === 1 && dmAcc && dmRef,
    "E PREMISE — the lobby drew every kind of join and leave button, and a chat invite's line", Object.keys(before).map((k) => k + ":" + before[k].length));
  const allFree = () => [].concat(...Object.values(gatedNow())).every((b) => b.disabled === false) && join.disabled === false;
  ok(allFree(), "E PREMISE — with the door free, every one is live", null);
  // ONE RUNS.
  door = { busy: true, what: "leaving Room Z", waiting: [] };
  ok(typeof doorFn === "function", "E: APPLIED — the room list hears the door (`Room.onDoorChange`)", typeof doorFn);
  if (doorFn) doorFn(door);
  const g = gatedNow();
  const every = [].concat(...Object.values(g));
  ok(every.length >= 8 && every.every((b) => b.disabled === true && b.title === "Waits for: leaving Room Z"),
    "E: WHILE ONE RUNS, EVERY ACCEPT, DECLINE, OPEN, LEAVE AND DISCARD IS GREYED, its title naming what it waits for",
    every.filter((b) => !(b.disabled && b.title === "Waits for: leaving Room Z")).map((b) => b.textContent + "|" + b.disabled + "|" + b.title));
  // CHANGED ON PURPOSE (`ddjp_690`): this row read "and Join Room" greyed. Join Room now joins the room only and shows its own
  // row under "Joining", which says what its turn waits for — so a press while the door is busy is how that row is reached.
  ok(join.disabled === false, "E: but JOIN ROOM IS NOT GREYED — a press waits its turn in its own row (`ddjp_690`)", { disabled: join.disabled, title: join.title });
  const note = q("p", list).find((p) => /One at a time/.test(p.textContent));
  ok(note && note.textContent === "One at a time: leaving Room Z — the others wait." && list.children[0] === note,
    "E: and one line above the list says what runs", note && note.textContent);
  const dmNote = q(".dm-invite-note", dmHost)[0];
  ok(dmAcc.disabled && dmRef.disabled && dmNote && dmNote.textContent === "waits for: leaving Room Z",
    "E: A CHAT INVITE'S ACCEPT AND REFUSE WAIT TOO, the line saying what for", { acc: dmAcc.disabled, ref: dmRef.disabled, note: dmNote && dmNote.textContent });
  // IT ENDS.
  door = { busy: false, what: null, waiting: [] };
  if (doorFn) doorFn(door);
  ok(allFree() && !q("p", list).some((p) => /One at a time/.test(p.textContent)), "E: when it ends, each comes back and the line goes", null);
  ok(!dmAcc.disabled && !dmRef.disabled && (q(".dm-invite-note", dmHost)[0] || {}).textContent === "", "E: the chat invite's too", null);
  // A BUTTON GREYED FOR ITS OWN REASON STAYS GREYED: Leave again, behind the lock.
  S.showScreen("screen-main"); S.showScreen("screen-rooms"); S.renderRoomList(scan);
  const again = named("Leave again")[0];
  door = { busy: true, what: "leaving Room Z", waiting: [] }; if (doorFn) doorFn(door);
  door = { busy: false, what: null, waiting: [] }; if (doorFn) doorFn(door);
  ok(again && again.disabled === true && /Locked/.test(again.title), "E: a button greyed for its own reason (Leave again behind the lock) stays greyed when the door frees",
    again && { disabled: again.disabled, title: again.title });
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[one-at-a-time] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[one-at-a-time] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[one-at-a-time] PASS — every join and leave the app sends runs one at a time (the owner's rule, `ddjp_689`; " + asserts +
    " assertions): while a lobby Accept's join waits out its backoff a Decline sends nothing, then goes, the door and the log saying " +
    "what runs and what waits; an Accept, a Decline, a Join Room by ID and an opening, a running room's later pass, a Leave, a Discard, a " +
    "chat invite's Accept and Refuse each wait their turn; no code but the one sender calls the SDK's join or leave, and it refuses " +
    "one outside its turn; the loading card's back frees its turn at once, an opening cancelled while it waits sends nothing, and an " +
    "opening does not wait for the running room's retry; and every join and leave button greys with what it waits for, and comes back — " +
    "but Join Room, whose press waits its turn in its own row.");
})();
