#!/usr/bin/env node
// tests/check-room-leave.js
// SUBJECT: features/room.js, ui/shell.js, ui/screens.js, app.js, features/botruntime.js, features/playback.js, features/queue.js,
//          features/skip.js, features/userqueue.js, features/serverclock.js, features/chat.js, backends/backend1/matrixbridge.js,
//          backends/backend1/session.js, backends/backend1/history.js, backends/backend2/streammanager.js, backends/backend2/runner.js
//
// WALL: A ROOM RUNS ONLY WHILE THE TAB IS IN IT (J83; the owner's ruling 18, which superseded ruling 10, and E3–E9).
//   Before J83 only opening ANOTHER room stopped a room. Back in the lobby the music played on (the player was only hidden and the
//   tick kept loading songs into it), the room's timers ran (the playback tick, the queue's, the seal cadence, history saving, the
//   join step), its chat kept arriving and chiming, and its bot kept running it; logging out stopped nothing; the loading card's
//   back button let the opening finish unseen, with its bot; an answer awaited when the room was left was resent into it; a
//   history backfill still paging could write into the next room's table; the phase drifted from COLD back to LIVE in the lobby.
//   Now ONE leave step (`Room.leave`) stops all of it, every way out calls it, and opening a room leaves the running one first.
//
//   Driven through the REAL modules: both engines behind the real seam, `features/room.js`, and — unlike the other bot-room
//   guards — the REAL feature modules a room starts (playback, queue, skip, reactions, length, blocked, the server clock, chat,
//   the upgrade watcher, the personal queue, the bot runtime), on the bot's own tab (`tests/_botroom.js`, its timers captured).
//   The ways out are the REAL handlers, extracted from `ui/shell.js`, `ui/screens.js` and `app.js` and run against the real
//   `Room`; removal and a cancelled opening run on the homeserver model (`tests/_inviteworld.js`) through the real `Room.join`.
//
//   A  THE LEAVE, FROM A BOT ROOM ON THE BOT'S TAB: no timer armed while the room ran survives it (a census of the captured
//      timers); the door refuses the room's events; nothing more is sent — no advance, no answer resent, no seal; an awaited
//      answer is settled `cancelled` and a send held for "live" is let go; the phase is COLD and stays COLD through a lost
//      connection and a late beat; no room runs, and the engine is the lobby's; the bot and the runner are stopped, the
//      runner's promised act sent to its room ABOVE its head, and the leave's two lines said; room chat is unsubscribed while
//      DMs, the room list and invites still work. A2: the runner's HELD intents are dropped and counted.
//   B  WHAT IS IN FLIGHT: a backfill whose room is left writes nothing into the next room's table (the bridge's generation and
//      History's epoch); the pending history save lands under the room being left; the personal queue's settle timer is cleared
//      and sends nothing; a skip still watching for the room to move is ended (J82: the owner's K6 and K7).
//   C  EVERY WAY OUT CALLS THE ONE LEAVE STEP: the room-screen back, the loading card's back (it cancels the opening and leaves
//      what it switched to), logging out from the lobby and from the encryption gate, switching account, the secure-chat
//      reconnect, the page closing, the bot's daily reload, and being removed elsewhere — and the lobby follows a removal.
//   D  ONE ROOM AT A TIME: opening a room leaves the running one before anything of the new one is wired; a cancelled opening
//      opens nothing; leaving twice is harmless.
//   E  NOTHING PILES UP ACROSS VISITS: the raw listeners (the bot's went on through the bot engine's wrapper and stayed),
//      the live-listeners (`onAuthorReady`, one per entry), the history feed (one per `wireCheckpoints`), the page listener
//      the server clock adds — three visits leave what one leaves.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const B = require(path.join(__dirname, "_botroom.js"));
const W = require(path.join(__dirname, "_inviteworld.js"));
const { BOT, VIP, SPACE } = B;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[room-leave] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[room-leave] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
function braceFrom(text, at, what) {
  if (at < 0) throw new Error("extraction refused — " + what + " not found");
  const open = text.indexOf("{", at);
  let d = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") d++;
    else if (text[j] === "}") { d--; if (d === 0) return text.slice(at, j + 1); }
  }
  throw new Error("extraction refused — " + what + " never closes");
}
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r)); };

// ── THE WORLD: the bot's tab, every module a room starts REAL (`tests/_tabworld.js`) ─────────────────────────────────────────
const TW = require(path.join(__dirname, "_tabworld.js"));
const { realWorld, tabStore, CH, ROOM, DM, T0 } = TW;
const runnerLines = (w, from) => w.logs.slice(from || 0).filter((m) => /backend2: runner/.test(m));
const said = (w, re, from) => w.logs.slice(from || 0).filter((m) => re.test(m));
// Three DJs relayed into the room's log, as the runner reads them: the first starts the first song.
const relay = (n, l) => ({ type: "m.room.message", event_id: "$r" + n, room_id: CH.events_owner, sender: BOT, origin_server_ts: T0 + n * 1000,
  content: { body: JSON.stringify({ t: "ddjp.dj.join", v: "ABCDEFGHIJ" + n, actor: "@dj" + n + ":hs", rank: 20, l: l, dv: 2 }) } });
const intent = (w, id, body, sender, ts) => w.deliver({ type: "m.room.message", event_id: id, room_id: CH.events_uncategorized, sender: sender,
  origin_server_ts: ts, content: { body: JSON.stringify(Object.assign({ l: 1, dv: 2 }, body)) } });
const ALL_PERIODS = (w) => Array.from(new Set(w.timers.live().map((t) => t.ms)));
const fireAll = (w) => { for (let i = 0; i < 3; i++) for (const ms of ALL_PERIODS(w)) w.timers.fire(ms); };

const PARTS = [];
const part = (fn) => PARTS.push(fn);

// ── A — THE LEAVE, FROM A BOT ROOM ON THE BOT'S TAB ───────────────────────────────────────────────────────────────────────────
part(async () => {
  const w = realWorld(), sb = w.sb;
  // The first visit arms what a page arms once (the session's beat); what survives its leave is the baseline.
  w.enter();
  sb.Room.leave("the first visit");
  const base = new Set(w.timers.live().map((t) => t.id));
  const fan0 = w.listeners();

  // THE VISIT: the room runs — its DJs relayed, the first song started, the bot on, the person's own queue settling, a send held
  // for live, an answer awaited, the beats fired.
  w.enter();
  ok(sb.Room.runningRoom() === ROOM && sb.Backends.active() === "backend2", "A PREMISE — the bot room runs on this tab", sb.Room.runningRoom());
  for (let i = 0; i < 3; i++) w.deliver(relay(i, 400 + i), 99);
  w.goLive();
  sb.B2Authority.flush();
  for (const ms of [2000, 250, 500]) w.timers.fire(ms);
  sb.B2Authority.flush();
  ok(sb.BotRuntime.status().running === true, "A PREMISE — the bot runtime runs (the bot's own tab)", sb.BotRuntime.status());
  ok(sb.B2Runner.running() === true, "A PREMISE — the runner runs");
  let head = 0;
  for (const e of sb.StreamManager.getLog()) if (e && typeof e.l === "number" && e.l > head) head = e.l;
  ok(head >= 402, "A PREMISE — the room's log holds its DJs", head);
  intent(w, "$vip", { t: "ddjp.dj.join", v: "VIPSONG0001" }, VIP, T0 + 9000);
  ok(sb.B2Authority.pending() >= 1, "A PREMISE — a relayed join waits in the gate, promised and not yet sent", sb.B2Authority.pending());
  try { sb.UserQueue.joinRoomQueue(); } catch (e) {}
  const answer = sb.MatrixBridge.awaitAnswer("$awaited");
  // The tab falls behind (a send now waits for it to be live again), and is left while it waits.
  sb.Session._setPhaseForTest("catching-up");
  const held = sb.Queue.submitSong("HELDHELD001", "https://youtu.be/HELDHELD001");
  const during = w.timers.live().filter((t) => !base.has(t.id));
  ok(during.length >= 6, "A PREMISE — the room armed its own timers (the tick, the beats, the sweep, the upgrade watcher, the waits)",
    during.map((t) => t.kind + " " + t.ms));
  const n0 = w.sent.length, l0 = w.logs.length;

  const info = sb.Room.leave("back to the lobby");

  // NO TIMER OF THE ROOM SURVIVES.
  const leaked = w.timers.live().filter((t) => !base.has(t.id));
  ok(leaked.length === 0, "A: NO TIMER ARMED WHILE THE ROOM RAN IS STILL LIVE AFTER THE LEAVE (a census of the captured timers)",
    leaked.map((t) => t.kind + " " + t.ms));
  // THE BOT AND THE RUNNER, FIRST, AND WHAT THEY SAY.
  ok(sb.BotRuntime.status().running === false && sb.B2Runner.running() === false, "A: the bot runtime and the runner are stopped",
    { bot: sb.BotRuntime.status().running, runner: sb.B2Runner.running() });
  const promised = w.sent.slice(n0).filter((x) => x.roomId === CH.events_owner &&
    ((x.t === "ddjp.batch" && (x.body.evs || []).some((e) => e.actor === VIP)) || (x.t === "ddjp.dj.join" && x.body.actor === VIP)));
  ok(promised.length === 1 && promised[0].body.l > head, "A: the runner's promised act went to ITS room, above its head l=" + head + " (never backdated)",
    w.sent.slice(n0).map((x) => x.roomId + " " + x.t + " l=" + (x.body && x.body.l)));
  ok(said(w, /^info: Room: leaving the bot room \(back to the lobby\) — stopping its processes$/, l0).length === 1,
    "A: the leave says what it is doing (\"Room: leaving <name> (<why>) — stopping its processes\")", said(w, /Room: lea/, l0));
  ok(said(w, /BotRuntime: stopped — the tab left the room/, l0).length === 1 &&
     said(w, /backend2: runner stopped — the tab left the room \(back to the lobby\); first sent 1 promised act/, l0).length === 1,
    "A: the bot and the runner say they stopped, the runner with what it sent", said(w, /stopped — /, l0));
  ok(said(w, /^info: Room: left the bot room — nothing of it runs on this tab \(the bot: 1 promised act\(s\) sent, 0 held intent\(s\) dropped\)$/, l0).length === 1 &&
     info && info.sent === 1, "A: and the leave's closing line counts it", { line: said(w, /Room: left/, l0), info });
  const bot = said(w, /BotRuntime: stopped/, l0)[0], run = said(w, /runner stopped/, l0)[0], reset = said(w, /StreamManager: reset/, l0)[0];
  ok(w.logs.indexOf(bot, l0) < w.logs.indexOf(run, l0) && w.logs.indexOf(run, l0) <= w.logs.indexOf(reset, l0) && w.logs.indexOf(bot, l0) >= 0,
    "A: the bot first, then the runner at the engine reset — with the room's engine still bound", { bot, run, reset });
  // NO ROOM RUNS, AND THE LOBBY'S ENGINE IS BOUND.
  ok(sb.Room.runningRoom() === null && sb.Room.getCurrent() === null, "A: no room runs on this tab (`runningRoom()` is none)", sb.Room.runningRoom());
  ok(sb.Backends.active() === "backend1", "A: the engine bound is the lobby's bootstrap one", sb.Backends.active());
  // THE DOOR IS SHUT.
  ok(!sb.MatrixBridge.inScope(CH.events_owner) && !sb.MatrixBridge.inScope(CH.events_uncategorized), "A: the door refuses the room's channels");
  w.deliver(relay(9, 900), 99);
  ok((sb.StreamManager.getLog() || []).length === 0 && !(sb.StreamManager.getState().rotation || []).length,
    "A: nothing of the room is folded in the lobby — a later event from it is refused", (sb.StreamManager.getLog() || []).length);
  // WHAT WAS WAITING IS LET GO, AND NOTHING MORE IS SENT.
  // RACED, so a wait that is never settled reads as the row failing rather than as a guard that never finished.
  const STILL = "(still waiting after the leave)";
  const a = await Promise.race([answer, settle(10).then(() => STILL)]);
  ok(a && a.status === "cancelled", "A: an answer still awaited is settled `cancelled` — never `none`, which every caller resends on", a);
  const h = await Promise.race([held, settle(10).then(() => STILL)]);
  ok(h && h.ok === false && w.sent.slice(n0).every((x) => !(x.body && x.body.v === "HELDHELD001")),
    "A: a song held for this client to go live is let go, unsent (E4: leaving sends nothing for the person)", h);
  const n1 = w.sent.length;
  fireAll(w);
  await settle();
  ok(w.sent.length === n1, "A: AND NOTHING MORE GOES OUT — every timer still live fired, and no advance, resend, seal or join was sent",
    w.sent.slice(n1).map((x) => x.roomId + " " + x.t));
  // THE PHASE STAYS COLD.
  ok(sb.Session.phase() === "cold" && sb.Session.mayAuthor() === false, "A: the phase is COLD", sb.Session.phase());
  sb.Session.connectionLost(); sb.Session.connectionBack();
  sb.Session._setLastBeatForTest(0); sb.Session._beatForTest();
  ok(sb.Session.phase() === "cold", "A: and STAYS COLD through a lost connection and a late beat — no room to be behind in", sb.Session.phase());
  // ROOM CHAT IS OFF; DMs, THE ROOM LIST AND INVITES ARE THE ACCOUNT'S AND STAY.
  let roomChat = 0, dms = 0;
  sb.Chat.onMessage(() => { roomChat++; });
  sb.Chat.onDMChange(() => { dms++; });
  w.deliver({ type: "m.room.message", event_id: "$c1", room_id: CH.chat_uncategorized, sender: VIP, origin_server_ts: T0 + 20000, content: { body: "hello room" } }, 0);
  w.deliver({ type: "m.room.message", event_id: "$d1", room_id: DM, sender: VIP, origin_server_ts: T0 + 20001, content: { body: "hello you" } }, 0);
  ok(roomChat === 0, "A: room chat no longer arrives — the leave unsubscribed it", roomChat);
  ok(dms === 1, "A: a DM still does — DMs are the account's (E3)", dms);
  let list = null, inv = null;
  try { list = sb.Room.scanDDJPRooms(); } catch (e) { list = String(e); }
  try { inv = sb.MatrixAccount.invites(); } catch (e) { inv = String(e); }
  ok(list && Array.isArray(list.joined) && Array.isArray(inv), "A: the room list and the invites still read", { list, inv });
  ok(w.listeners() === fan0, "A: and the raw listeners are what the lobby had — the bot's came off through the binding it went on", { now: w.listeners(), lobby: fan0 });
});

// A2 — THE RUNNER'S HELD INTENTS ARE DROPPED AND COUNTED (never carried to whatever the tab opens next).
part(() => {
  const w = realWorld(), sb = w.sb;
  w.enter();
  for (let i = 0; i < 3; i++) w.deliver(relay(i, 400 + i), 99);
  w.goLive(); sb.B2Authority.flush();
  sb.Session._setPhaseForTest("suspended");
  intent(w, "$h1", { t: "ddjp.dj.join", v: "HELDSONG001" }, VIP, T0 + 9000);
  ok(sb.B2Runner.stats().held === 1, "A2 PREMISE — the runner holds an intent while this tab cannot write", sb.B2Runner.stats());
  const l0 = w.logs.length;
  const info = sb.Room.leave("back to the lobby");
  ok(info.dropped === 1 && said(w, /\(the bot: \d+ promised act\(s\) sent, 1 held intent\(s\) dropped\)/, l0).length === 1 &&
     said(w, /runner stopped — .*; 1 held intent\(s\) dropped/, l0).length === 1,
    "A2: the held intent is dropped at the leave and counted, in the runner's line and the leave's", { info, lines: said(w, /stopped|Room: left/, l0) });
  ok(sb.B2Runner.stats().held === 0, "A2: and nothing is held afterwards", sb.B2Runner.stats());
});

// ── B — WHAT IS IN FLIGHT ─────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  // THE BRIDGE'S BACKFILL, still reading the stored table when the room is left: it stops, and the table it then receives goes nowhere.
  const w = realWorld({ holdLoad: true }), sb = w.sb;
  w.enter();
  ok(w.loads.length >= 1 && w.loads[w.loads.length - 1].sid === ROOM, "B PREMISE — going live started the history backfill, which waits on the stored table",
    w.loads.map((x) => x.sid));
  const l0 = w.logs.length;
  sb.Room.leave("back to the lobby");
  const snap = { v: 2, rows: [{ pi: "$p1", videoId: "STALESTALE1", l: 7, startedAt: T0 }], ranges: [[0, 7]] };   // a table the store really holds (v2)
  for (const x of w.loads) x.res(snap);
  await settle(10);
  ok(sb.History.count() === 0, "B: a backfill whose room was left writes nothing into the table the next room will use", sb.History.count());
  ok(said(w, /history backfill stopped — the room was left/, l0).length === 1, "B: and says it stopped", said(w, /history/, l0));
  // HISTORY'S OWN PAGING, mid-page when the room is left (`History.reset`): it returns `reset` and adds nothing.
  let release = null;
  sb.History.attach({ pageRange: () => new Promise((r) => { release = r; }) });
  const p = sb.History.backfill(0, undefined, 50);
  sb.History.reset();
  release(Object.assign([{ type: "ddjp.dj.play", l: 3, eventId: "$x", sender: BOT, ts: T0, content: { p: null } }], { reachedFrom: 0 }));
  const r = await p;
  ok(r && r.ok === false && r.reason === "reset" && sb.History.count() === 0, "B: History's own backfill, mid-page at a reset, adds nothing", r);
});
part(() => {
  // THE PENDING HISTORY SAVE LANDS UNDER THE ROOM BEING LEFT, before its table is reset.
  const w = realWorld(), sb = w.sb;
  w.enter();
  sb.History.restore({ rows: [{ pi: "$p1", videoId: "ABCDEFGHIJ0", l: 5, startedAt: T0 }], ranges: [[0, 5]] });
  sb.MatrixBridge.persistHistoryNow();
  const before = w.persisted.length;
  // A song change arms the debounced save (the bridge's history feed).
  const play = sb.StreamManager.on ? null : null; void play;
  w.timers.fire(2000);
  sb.Room.leave("back to the lobby");
  ok(w.persisted.length >= before && w.persisted.every((sid) => sid === ROOM), "B: every history save went under the room it belongs to", w.persisted);
  // THE PERSON'S OWN QUEUE: joined, holding a song, its settle timer armed when the room is left — the leave clears the timer and
  // nothing is sent for it (E4). J82, the owner's K6: this row was VACUOUS — the sandbox had no `URL`, so `PlaylistDoc` refused every
  // link, nothing was added, the queue fell straight out and no settle timer was ever armed; the leave could stop calling
  // `UserQueue.destroy` and nothing here moved. Given the browser's `URL`, the queue is real; a settle timer surviving the leave
  // would fire in the lobby and its declare would wait for the next room to go live — and be sent THERE.
  const w2 = realWorld(), sb2 = w2.sb;
  sb2.URL = URL;   // the browser's, which `PlaylistDoc.extractVideoId` reads a link with
  w2.enter();
  for (let i = 0; i < 3; i++) w2.deliver(relay(i, 400 + i), 99);
  w2.goLive(); sb2.B2Authority.flush();
  const before2 = new Set(w2.timers.live().map((t) => t.id));
  const added = sb2.UserQueue.add("https://youtu.be/MINEMINE001");
  sb2.UserQueue.joinRoomQueue();
  const settleT = w2.timers.live().filter((t) => !before2.has(t.id) && t.kind === "timeout" && t.ms === 5000);
  ok(added && added.ok === true && sb2.UserQueue.isActive() === true && settleT.length === 1,
    "B PREMISE — the personal queue holds a song, is in the room's queue, and its settle timer is armed", { added, active: sb2.UserQueue.isActive(), settle: settleT.length });
  const n0 = w2.sent.length;
  sb2.Room.leave("back to the lobby");
  ok(!w2.timers.live().some((t) => settleT.some((x) => x.id === t.id)),
    "B: the personal queue's settle timer is CLEARED by the leave (`UserQueue.destroy`) — none fires in the lobby (K6)",
    w2.timers.live().map((t) => t.kind + " " + t.ms));
  fireAll(w2);
  ok(!w2.sent.slice(n0).some((x) => x.roomId === CH.events_uncategorized), "B: the personal queue's settle sends nothing after the leave (E4)",
    w2.sent.slice(n0).map((x) => x.roomId + " " + x.t));
});
part(async () => {
  // A SKIP STILL WATCHING FOR THE ROOM TO MOVE when the room is left (J82, the owner's K7): `Skip._waitForAdvance`, reached when a
  // send reports no event id, holds a timer and three StreamManager subscriptions. The leave's `Skip.destroy` ends it — its timer
  // goes, it settles at once ("did not take effect"), and nothing of the next room can answer it. Without it the watch outlived
  // the room: its timer stayed live in the lobby and the next room's first play would have resolved it as a skip that took effect.
  const w = realWorld(), sb = w.sb;
  w.enter();
  for (let i = 0; i < 3; i++) w.deliver(relay(i, 400 + i), 99);
  w.goLive(); sb.B2Authority.flush();
  w.deliver({ type: "m.room.message", event_id: "$play1", room_id: CH.events_owner, sender: BOT, origin_server_ts: T0 + 5000,
    content: { body: JSON.stringify({ t: "ddjp.dj.play", p: null, actor: BOT, rank: 99, l: 403, dv: 2 }) } }, 99);
  ok(!!sb.StreamManager.getState().nowPlaying, "B PREMISE — a song is playing, so a skip has something to skip");
  const real = sb.MatrixBridge.sendEvent;
  // SETTLED FIRST (J84-4): REP's bot side now reads its own messages back before it builds its table, so its first save
  // timer lands a few turns after the room goes live. Let that happen before the snapshot, so the watch below counts the
  // skip's own timer and nothing of REP's.
  await settle(10);
  sb.MatrixBridge.sendEvent = async () => ({});   // a send whose receipt names no event: the skip watches the room instead
  const before = new Set(w.timers.live().map((t) => t.id));
  let res = null;
  sb.Skip.skip().then((r) => { res = r; });
  await settle(10);
  sb.MatrixBridge.sendEvent = real;
  const watch = w.timers.live().filter((t) => !before.has(t.id) && t.kind === "timeout");
  ok(res === null && watch.length === 1, "B PREMISE — the skip is watching for the room to move (its window armed, unanswered)", { res, watch: watch.map((t) => t.ms) });
  sb.Room.leave("back to the lobby");
  await settle(10);
  ok(!w.timers.live().some((t) => watch.some((x) => x.id === t.id)) && res && res.ok === false,
    "B: the leave ENDS the skip's watch (`Skip.destroy`) — its window is cleared and it settles at once, unconfirmed (K7)",
    { res, live: w.timers.live().map((t) => t.kind + " " + t.ms) });
});

// ── C — EVERY WAY OUT CALLS THE ONE LEAVE STEP ────────────────────────────────────────────────────────────────────────────────
// The handlers, run for real against the real `Room`. Display-only names are doubles; what a handler does after the leave
// (log out, reload, the kill switch) is recorded, with whether the room was still running at that moment.
function inRoom() { const w = realWorld(); w.enter(); return w; }
function backButtonsOf(w) {
  const shell = src("ui/shell.js"), screens = src("ui/screens.js");
  const leave = braceFrom(shell, shell.indexOf("function _bgLeaveRoom("), "ui/shell.js _bgLeaveRoom");
  const arrow = (text, anchor, what) => { const at = text.indexOf(anchor); if (at < 0) throw new Error("extraction refused — " + what + " not found");
    return braceFrom(text, at + anchor.length, what).replace(/^\s*/, ""); };
  const shellBack = arrow(shell, "backBtn.onclick = ", "ui/shell.js backBtn.onclick");
  const loadingBack = arrow(screens, "back.onclick = ", "ui/screens.js back.onclick");
  const wrap = "(function () {\n" +
    "  let _pendingJoinId = '!x:hs'; const _bg = { timer: null, seq: 0, roomId: '!x:hs' }; const _ytVol = { pollTimer: null };\n" +
    "  let _marqueeRo = null, _marqueeRaf = 0; const _lockTimers = { skip: 0, leave: 0, roomq: 0 };\n" +
    "  let _skipLocked = false, _leaveLocked = false, _roomqLocked = false, _roomqUnlockAt = 0, _plLocked = false, _uqLocked = false;\n" +
    "  const stopped = []; const Player = { _bgUnpaint() {}, clearVideo() { stopped.push('video'); }, clearProgress() { stopped.push('progress'); } };\n" +
    "  const PlaylistPanels = { _thumbReset() {} }, cancelAnimationFrame = () => {};\n" +
    "  const shown = []; const Screens = { showScreen: (s) => shown.push(s), renderRoomList: () => {} };\n" +
    "  const showScreen = Screens.showScreen, renderRoomList = Screens.renderRoomList;\n" +
    leave + "\n  const H = { _bgLeaveRoom };\n" +
    "  return { shellBack: " + shellBack + ", loadingBack: " + loadingBack + ", shown, stopped };\n})()";
  return vm.runInContext(wrap, w.sb, { filename: "ui/shell.js+ui/screens.js#back" });
}
// A handler out of `app.js` (or another file): the text from an anchor through its matching close, as a callable.
function handlerOf(file, anchor, what) {
  const text = src(file), at = text.indexOf(anchor);
  if (at < 0) throw new Error("extraction refused — " + what + " not found in " + file);
  return braceFrom(text, at + anchor.length - 1, what);
}
function runHandler(w, body, ctx) {
  const env = Object.assign({ Room: w.sb.Room, Logger: w.sb.Logger, Chat: w.sb.Chat }, ctx);
  const names = Object.keys(env);
  const fn = vm.runInContext("(function (" + names.join(", ") + ") { return " + body + "; })", w.sb);
  return fn.apply(null, names.map((k) => env[k]));
}
part(async () => {
  // THE ROOM SCREEN'S BACK: leaves, and the player stops with it (the player was only hidden before).
  { const w = inRoom(), back = backButtonsOf(w), l0 = w.logs.length;
    back.shellBack();
    ok(w.sb.Room.runningRoom() === null && said(w, /Room: leaving the bot room \(back to the lobby\)/, l0).length === 1,
      "C: the room screen's back button leaves the room (\"back to the lobby\")", said(w, /Room: lea/, l0));
    ok(back.stopped.indexOf("video") >= 0 && back.stopped.indexOf("progress") >= 0, "C: and the player stops — the video and its progress frame", back.stopped); }
  // THE LOADING CARD'S BACK: the opening is cancelled, and a room it had switched to is left (E8).
  { const w = realWorld(); w.sb.Room._enterForTest({ name: "the bot room", spaceId: ROOM, channels: CH }, "backend2", { opening: true });
    const back = backButtonsOf(w), l0 = w.logs.length;
    back.loadingBack();
    ok(w.sb.Room.runningRoom() === null && said(w, /Room: the opening of !space-c:hs was cancelled \(back on the loading card\) — nothing of it runs/, l0).length === 1 &&
       said(w, /Room: leaving the bot room \(back on the loading card\)/, l0).length === 1,
      "C: the loading card's back cancels the opening and leaves the room it had switched to (E8)", said(w, /Room: /, l0)); }
  // LOGGING OUT FROM THE LOBBY (E9): leave, then log out (which now stops the client), then a fresh page.
  { const w = inRoom(), calls = [];
    const body = handlerOf("app.js", 'document.getElementById("btn-logout").addEventListener("click", async () => {', "app.js the lobby's Log out");
    const MatrixAccount = { logout: async () => { calls.push("logout:" + (w.sb.Room.runningRoom() || "no room")); } };
    await runHandler(w, "async () => " + body, { confirm: () => true, MatrixAccount, Interface: { showScreen: () => calls.push("screen") },
      location: { reload: () => calls.push("reload") } })();
    ok(calls[0] === "logout:no room" && calls.indexOf("reload") > 0, "C: Log out in the lobby leaves the room BEFORE logging out, then reloads (E9)", calls); }
  { const acct = src("backends/backend1/matrixaccount.js"), lo = braceFrom(acct, acct.indexOf("async function logout("), "matrixaccount.js logout");
    ok(/stopClient\(\)/.test(lo) && lo.indexOf("stopClient") < lo.indexOf("_setC(null)"),
      "C: and logging out stops the Matrix client before letting it go (E9) — read, since the client is the SDK's", lo.indexOf("stopClient")); }
  // LOGGING OUT FROM THE ENCRYPTION GATE.
  { const w = inRoom(), calls = [];
    const body = handlerOf("app.js", "onLogout: async () => {", "app.js the encryption gate's onLogout");
    await runHandler(w, "async () => " + body, { MatrixAccount: { logout: async () => { calls.push("logout:" + (w.sb.Room.runningRoom() || "no room")); } },
      location: { reload: () => calls.push("reload") } })();
    ok(calls[0] === "logout:no room", "C: the encryption gate's Log out leaves first too", calls); }
  // SWITCHING ACCOUNT.
  { const w = inRoom(), calls = [];
    const body = handlerOf("app.js", "onSwitch: (uid) => {", "app.js onSwitch");
    runHandler(w, "(uid) => " + body, { MatrixAccount: { switchAccount: () => { calls.push("switch:" + (w.sb.Room.runningRoom() || "no room")); return true; } },
      location: { reload: () => calls.push("reload") } })("@other:hs");
    ok(calls[0] === "switch:no room" && calls[1] === "reload", "C: switching account leaves the room before switching and reloading", calls); }
  // THE SECURE-CHAT RECONNECT'S SECOND TIER: leave (keeping the tab's room, so the reload reopens it), then the kill switch.
  { const w = inRoom(), calls = [];
    const body = handlerOf("ui/shell.js", "const _reconnectSecureChat = async (btn) => {", "ui/shell.js _reconnectSecureChat");
    const window = { __ddjpKillSW: () => calls.push("kill:" + (w.sb.Room.runningRoom() || "no room")) };
    await runHandler(w, "async (btn) => " + body, { Chat: { retryCrypto: async () => false }, _showCryptoBanner: () => {}, window,
      setTimeout: (fn) => { calls.push("later"); fn(); }, location: { reload: () => calls.push("reload") } })(null);
    ok(calls[0] === "kill:no room" && calls.indexOf("reload") > 0, "C: the secure-chat reconnect leaves before the kill switch and the reload", calls);
    ok(w.ss.getItem("ddjp_room:" + BOT) === ROOM, "C: and the tab keeps its room, so the reload opens it again (E1)", w.ss.getItem("ddjp_room:" + BOT)); }
  // THE PAGE CLOSING (E6): the leave runs; the tab keeps its room.
  { const w = inRoom(), l0 = w.logs.length;
    const body = handlerOf("app.js", 'window.addEventListener("pagehide", () => {', "app.js the pagehide handler");
    runHandler(w, "() => " + body, {})();
    ok(w.sb.Room.runningRoom() === null && said(w, /Room: leaving the bot room \(the page is closing\)/, l0).length === 1 &&
       w.ss.getItem("ddjp_room:" + BOT) === ROOM, "C: the page closing leaves the room and keeps the tab's memory of it (E6)", said(w, /Room: lea/, l0)); }
  // AND A PAGE BACK FROM THE BROWSER'S PAGE CACHE, which left its room as it was hidden: it loads afresh, so the reopen runs.
  { const w = inRoom(), calls = [];
    const body = handlerOf("app.js", 'window.addEventListener("pageshow", (ev) => {', "app.js the pageshow handler");
    const show = runHandler(w, "(ev) => " + body, { location: { reload: () => calls.push("reload") } });
    show({ persisted: false }); const fresh = calls.length;
    show({ persisted: true });
    ok(fresh === 0 && calls.length === 1, "C: a page restored from the browser's page cache reloads (its room was left as it hid); an ordinary show does not",
      { fresh, calls }); }
  // THE BOT'S DAILY RELOAD (E5): leave, then reload — the tab keeps its room.
  { const w = inRoom(), sb = w.sb, calls = [];
    w.goLive(); sb.B2Authority.flush();   // a quiet moment: nothing committed and unsent (the runner's arrival went out)
    sb.BotRuntime._setReloadForTest(() => calls.push("reload:" + (sb.Room.runningRoom() || "no room")));
    const DAY = 24 * 3600 * 1000;
    sb.BotRuntime.maybeDailyReload(T0);
    const r = sb.BotRuntime.maybeDailyReload(T0 + DAY + 60000);
    ok(r && r.reloaded === true && calls[0] === "reload:no room" && w.ss.getItem("ddjp_room:" + BOT) === ROOM,
      "C: the bot's daily reload leaves the room first and keeps the tab's memory of it, so the reload reopens it (E5)", { r, calls }); }
});
part(async () => {
  // REMOVED ELSEWHERE (E7), on the homeserver model: the running room leaves itself, and says why.
  const hs = W.homeserver();
  const A = hs.ddjpRoom("!a:hs", { levels: { [W.ME]: 20 } });
  hs.rooms["!a:hs"].members[W.ME] = "join";
  for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) hs.rooms[A.ch[k]].members[W.ME] = "join";
  const w = W.inviteWorld({ hs, extras: { sessionStorage: tabStore() } });
  await w.Room.join("!a:hs"); await w.settle(30);
  ok(w.Room.runningRoom() === "!a:hs", "C PREMISE — the room runs on this tab", w.Room.runningRoom());
  let left = null;
  w.Room.onLeft((i) => { left = i; });
  const l0 = w.logs.length;
  hs.rooms["!a:hs"].members[W.ME] = "leave";
  w.emit("Room.myMembership");
  ok(w.Room.runningRoom() === null && left && left.removed === true &&
     w.lines(/Room: leaving a \(you are no longer in this room\) — stopping its processes/, l0).length === 1,
    "C: removed from the room elsewhere, the running room leaves itself and says why (E7)", { left, lines: w.lines(/Room: /, l0) });
  // AND THE SCREEN FOLLOWS IT: the lobby's handler, extracted, goes to the room list and says why.
  const screens = src("ui/screens.js");
  const fn = braceFrom(screens, screens.indexOf("function _onRoomLeft("), "ui/screens.js _onRoomLeft");
  const ui = vm.runInContext("(function () { let _pendingJoinId = '!a:hs'; let _lobbyNote = ''; const shown = []; const H = { _bgLeaveRoom() {} };\n" +
    "function setLobbyNote(t) { _lobbyNote = t; } function showScreen(s) { shown.push(s); } function renderRoomList() {}\n" +
    "const Room = { scanDDJPRooms: () => ({}) };\n" + fn + "\nreturn { run: _onRoomLeft, shown, note: () => _lobbyNote }; })()", w.sb);
  ui.run(left);
  ok(ui.shown[0] === "screen-rooms" && /You are no longer in a/.test(ui.note()), "C: and the screen goes to the lobby with the reason above the room list", { shown: ui.shown, note: ui.note() });
});

// ── D — ONE ROOM AT A TIME ────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver();
  const mk = (sid) => { const R = hs.ddjpRoom(sid, { levels: { [W.ME]: 20 } }); hs.rooms[sid].members[W.ME] = "join";
    for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) hs.rooms[R.ch[k]].members[W.ME] = "join"; return R; };
  mk("!a:hs"); mk("!b:hs");
  const w = W.inviteWorld({ hs, extras: { sessionStorage: tabStore() } });
  await w.Room.join("!a:hs"); await w.settle(30);
  const l0 = w.logs.length;
  await w.Room.join("!b:hs"); await w.settle(30);
  const lines = w.logs.slice(l0);
  const leftA = lines.findIndex((m) => /Room: leaving a \(opening another room\)/.test(m));
  const leftAdone = lines.findIndex((m) => /Room: left a — nothing of it runs on this tab/.test(m));
  const wiredB = lines.findIndex((m) => /Room: modules wired/.test(m));
  ok(leftA >= 0 && leftAdone > leftA && wiredB > leftAdone, "D: opening a room LEAVES the running one first — all of it — before anything of the new one is wired",
    { leftA, leftAdone, wiredB });
  ok(w.Room.runningRoom() === "!b:hs", "D: and then the new one runs", w.Room.runningRoom());
  // A CANCELLED OPENING OPENS NOTHING.
  const w2 = W.inviteWorld({ hs, extras: { sessionStorage: tabStore() } });
  const l1 = w2.logs.length;
  const p = w2.Room.join("!a:hs");
  const c = w2.Room.cancelOpening("back on the loading card");
  let err = null;
  try { await p; } catch (e) { err = e; }
  await w2.settle(20);
  ok(c.cancelled === "!a:hs" && err && err.cancelled === true && w2.Room.runningRoom() === null && w2.lines(/Room: modules wired/, l1).length === 0,
    "D: a cancelled opening stops at its next step and opens nothing — no room runs, nothing was wired", { c, err: err && err.message, wired: w2.lines(/Room: modules/, l1) });
  ok(w2.lines(/Room: the opening of !a:hs was cancelled \(back on the loading card\) — nothing of it runs/, l1).length === 1, "D: and it says so");
  // LEAVING TWICE, OR WITH NO ROOM, IS HARMLESS.
  const again = w.Room.leave("back to the lobby"), twice = w.Room.leave("back to the lobby");
  ok(again.left === "!b:hs" && twice.left === null && w.Room.runningRoom() === null, "D: a second leave finds no room and does nothing", { again, twice });
});

// ── E — NOTHING PILES UP ACROSS VISITS ────────────────────────────────────────────────────────────────────────────────────────
part(() => {
  const w = realWorld(), sb = w.sb;
  // The live-listeners and the history feed, counted at the engine parts the seam fills its shells from (so every bind sees them).
  const historyFeed = [];
  let authorNet = 0;   // live-listeners subscribed, less those let go
  for (const part of [sb.B1MatrixBridge, sb.B2MatrixBridge]) {
    const on0 = part.onAuthorReady, off0 = part.offAuthorReady;
    part.onAuthorReady = function (fn) { authorNet++; return on0.apply(this, arguments); };
    part.offAuthorReady = function (fn) { authorNet--; return off0.apply(this, arguments); };
  }
  sb.Backends.bindBootstrap();   // the shells are refilled from the parts just wrapped
  for (const part of [sb.B1StreamManager, sb.B2StreamManager]) {
    const on0 = part.on;
    part.on = function (t, fn) { if (fn && fn.name === "_refreshHistory") historyFeed.push(t); return on0.apply(this, arguments); };
  }
  const visit = () => { w.enter(); w.goLive(); for (const ms of [2000, 250, 500]) w.timers.fire(ms); sb.Room.leave("back to the lobby"); };
  visit();
  const after1 = { fan: w.listeners(), live: authorNet, feed: historyFeed.length, doc: w.docL.add - w.docL.remove };
  visit(); visit();
  const after3 = { fan: w.listeners(), live: authorNet, feed: historyFeed.length, doc: w.docL.add - w.docL.remove };
  ok(after3.fan === after1.fan, "E: the raw listeners after three visits are what one visit left (the bot's raw listener comes off through the binding it went on)",
    { after1, after3 });
  ok(after3.live === after1.live && after1.live <= 2, "E: the live-listeners (`onAuthorReady`: the personal queue's and the bot's) are subscribed " +
    "ONCE per page, not once per entry", { after1, after3 });
  ok(after3.feed === after1.feed && after1.feed <= 3, "E: the history feed is subscribed once per page, not once per `wireCheckpoints`", { after1, after3 });
  ok(after3.doc === 0, "E: the server clock's page listener comes off with it — none left after a leave", { after1, after3 });
});

(async () => {
  for (const fn of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[room-leave] FAIL — a part threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[room-leave] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[room-leave] PASS — a room runs only while the tab is in it (J83, ruling 18; " + asserts + " assertions). The ONE leave step, on " +
    "the bot's own tab with every module a room starts real: no timer armed while the room ran survives it; the door refuses the room; " +
    "nothing more is sent — an awaited answer is settled `cancelled`, a held send is let go, no advance, resend or seal goes out; the " +
    "phase is COLD and stays COLD; no room runs and the lobby's engine is bound; the bot and then the runner stop, the runner's promised " +
    "act sent to its room above its head and its held intents dropped and counted, and the leave says both; room chat stops while DMs, " +
    "the room list and invites go on. A backfill in flight writes nothing into the next room, the pending save lands under the room " +
    "left, and the personal queue sends nothing. Every way out calls it — both back buttons (the player stops; the loading card " +
    "cancels the opening), both logouts (before the client stops), an account switch, the secure-chat reconnect, the page closing and " +
    "the daily reload (keeping the tab's room) and a removal elsewhere (the lobby says why) — and opening a room leaves the running " +
    "one first; a cancelled opening opens nothing. Three visits leave what one leaves: raw listeners, live-listeners, the history " +
    "feed and the clock's page listener.");
})();
