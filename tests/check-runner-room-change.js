// tests/check-runner-room-change.js
// SUBJECT: backends/backend2/runner.js, backends/backend2/streammanager.js, backends/backend2/transport.js,
//          features/room.js, ui/shell.js, ui/screens.js
//
// WALL: THE BOT RUNS EXACTLY WHEN ITS ROOM RUNS ON THAT TAB (J80; the owner's ruling 10, `ddjp_571`'s design round — and since J83,
//   `ddjp_575`, the owner's ruling 18, which superseded ruling 10: a room runs only while the tab is IN it).
//   Live, `?v=524`: the bot's tab left its bot room for a shared room and the runner never stopped. It read the bound engine — now
//   the SHARED room's — and wrote into its old room's log: "runner starting the first song", then a seal of the shared room's
//   state. `B2Runner.stop` had no caller outside tests, and `start` re-pointed a running runner before its own refusal.
//   The rule (ruling 18, J83): a room's processes run only while the tab is in it; going back to the lobby stops the room and
//   its bot, and opening a room leaves the running one first. The runner stops at the SAME switch as the room: the engine
//   reset the ONE leave step (`features/room.js` `leave`) makes first, which every way out runs. Ruling 12: no bot-only
//   lifecycle rule. (Ruling 10's "a room keeps running on a tab that shows the lobby" is what P and P-i held until J83.)
//
//   Driven through the real modules — the seam, both engines, the REAL switch (`features/room.js` `_enter`: the leave, then
//   `_initModules`, run in the world through `Room._enterForTest`; J83 — before J83 `_initModules` alone, extracted) and the
//   REAL back buttons (extracted from `ui/shell.js` and `ui/screens.js`) — with the SDK client as the only double
//   (`tests/_botroom.js`). The runner's beats are its own captured timers, fired here.
//
//   R-a  BOT ROOM -> SHARED ROOM: the runner stops at the entry; nothing reaches the bot room afterwards, however the shared
//        room plays — no song started, no seal.
//   R-b  BOT ROOM -> ANOTHER BOT ROOM WHERE THIS ACCOUNT IS NOT THE RUNNER: stopped; nothing written to either room.
//   R-c  BOT ROOM -> ANOTHER BOT ROOM WHERE IT IS: a fresh start — announced in the new room once, the gate reset, the old
//        room's held intents dropped, nothing to the old room. R-c2: the same when `start` is asked for another room's log
//        while still running, with no reset in between — never re-pointed, never "already".
//   R-d  STOPPING SENDS WHAT WAS PROMISED: an act the gate held goes to the room it was promised to, at that room's positions
//        (a member's door accepts it), and then nothing runs.
//   R-e  SHARED ROOM -> BOT ROOM (control): the runner starts as before and announces once.
//   R-f  A REFUSED START CHANGES NOTHING BUT STOPPING: the runner is not re-pointed at the room that refused it.
//   R-g  THE SELF-CHECK, ON EVERY BEAT: the engine or the fold scope changed without the reset — the tick, the gate, the minute
//        beat, an arriving message, a return to LIVE and an act handed in (`takesOwn`) each stop it, and it says so. And an
//        UNREADABLE check is not "in its room": the fold scope, or the bound engine, unreadable at a beat stops it too.
//        (Both rows added at J81, owed from the `ddjp_572` audit, where no row held either.)
//   R-h  THE YOUNG BOT ROOM: the shared room's state never becomes the bot room's save point; a device opening the bot room
//        afterwards opens from the bot room's own state.
//   P    PARITY (ruling 18 — INVERTED AT J83 from ruling 10): the room-screen back button stops the room's processing AND the
//        runner, at the leave's one engine reset, and says so; the loading-card back cancels an opening and leaves the room it
//        had switched to; entering another room stops BOTH, at one reset.
//   P-i  THE INVITE SCOPE (J81, ruling 8b; INVERTED AT J83): `Room.runningRoom()` — the one function "running" is read through —
//        moves with the same switch: the back buttons clear it, and it reads `current` alone, which the switch sets right after
//        the leave and immediately before `_initModules`.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const { BOT, VIP, BOT_CH, SPACE, world, addRoom } = require(path.join(__dirname, "_botroom.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[runner-room-change] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[runner-room-change] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── THE WIRES THIS GUARD RUNS RATHER THAN RESTATES ─────────────────────────────────────────────────────────────────────────
// A brace-matched declaration out of a file nothing here can load whole. A missing anchor REFUSES by name: a guard that ran
// nothing must not read as a pass (`roles.md` — a refusal reads like a pass to anyone not watching for it).
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
// THE SWITCH, `features/room.js` `_enter` — the ONE leave step, then `_initModules` — run on the world's REAL `Room` (J83). Before
// J83 this extracted `_initModules` alone, whose first act was the engine reset; that reset is the leave's now, and the leave
// needs the module's own `current`, so the real module runs it (`Room._enterForTest`, the switch both openings call).
function entryOf(w) {
  if (typeof w.sb.Room._enterForTest === "function") {
    return (room, o) => w.sb.Room._enterForTest({ name: room.spaceId, spaceId: room.spaceId, channels: room.channels }, room.mode, o);
  }
  // A TREE BEFORE J83 (a red-first run on the previous code): its switch was `_initModules` alone, extracted and run as J80 drove
  // it, so the rows read what that code does rather than dying on a missing seam.
  const fn = braceFrom(src("features/room.js"), src("features/room.js").indexOf("function _initModules("), "features/room.js _initModules");
  const wrap = "(function () { let current = null; let _hasEventsChannel = false;\n" +
    "const applyChatTiers = () => {}, _runJoinStep = () => {}, _wireSettings = () => {}, _applySettings = () => {}, _evaluateBot = () => {};\n" +
    fn + "\nreturn function (room, mode) { current = room; _initModules(room, mode); }; })()";
  const init = vm.runInContext(wrap, w.sb, { filename: "features/room.js#_initModules (before J83)" });
  return (room) => { init({ name: room.spaceId, spaceId: room.spaceId, channels: room.channels }, room.mode); w.sb.Room._setCurrentForTest({ spaceId: room.spaceId, channels: room.channels }); };
}
// The world enters its bot room by hand (`tests/_botroom.js`); the real Room is told it runs there, as an opening would.
function inBotRoom(w) { w.sb.Room._setCurrentForTest({ name: SPACE, spaceId: SPACE, channels: BOT_CH }); return w; }
// THE BACK BUTTONS — `ui/shell.js`'s arrow on the room screen, `ui/screens.js`'s "← Rooms" on the loading card — and the teardown
// both call (`_bgLeaveRoom`), extracted and run in the world. Their display-only names are doubles; `Room` is the world's real
// module, and so is anything they might reach in an engine, which is the point: a back button that stopped the room or the runner
// would do it here.
function backButtonsOf(w) {
  const shell = src("ui/shell.js"), screens = src("ui/screens.js");
  const leave = braceFrom(shell, shell.indexOf("function _bgLeaveRoom("), "ui/shell.js _bgLeaveRoom");
  const arrow = (text, anchor, what) => { const at = text.indexOf(anchor); if (at < 0) throw new Error("extraction refused — " + what + " not found");
    return braceFrom(text, at + anchor.length, what).replace(/^\s*/, ""); };
  const shellBack = arrow(shell, "backBtn.onclick = ", "ui/shell.js backBtn.onclick");
  const loadingBack = arrow(screens, "back.onclick = ", "ui/screens.js back.onclick");
  const wrap = "(function () {\n" +
    "  let _pendingJoinId = '!space:hs'; const _bg = { timer: null, seq: 0, roomId: '!space:hs' }; const _ytVol = { pollTimer: null };\n" +
    "  let _marqueeRo = null, _marqueeRaf = 0; const _lockTimers = { skip: 0, leave: 0, roomq: 0 };\n" +
    "  let _skipLocked = false, _leaveLocked = false, _roomqLocked = false, _roomqUnlockAt = 0, _plLocked = false, _uqLocked = false;\n" +
    "  const Player = { _bgUnpaint() {} }, PlaylistPanels = { _thumbReset() {} }, cancelAnimationFrame = () => {};\n" +
    "  const shown = []; const Screens = { showScreen: (s) => shown.push(s), renderRoomList: () => {} };\n" +
    "  const showScreen = Screens.showScreen, renderRoomList = Screens.renderRoomList;\n" +
    leave + "\n  const H = { _bgLeaveRoom };\n" +
    "  return { shellBack: " + shellBack + ", loadingBack: " + loadingBack + ", shown };\n})()";
  return vm.runInContext(wrap, w.sb, { filename: "ui/shell.js+ui/screens.js#back" });
}

// ── THE STORY: a young bot room the bot runs, with three DJs relayed at positions far above any other room's clock ────────────
const SH = { events_uncategorized: "!sh-e0:hs", events_owner: "!sh-e99:hs", settings_owner: "!sh-s99:hs", checkpoints_owner: "!sh-c99:hs" };
const B_CH = { events_uncategorized: "!b-in:hs", events_owner: "!b-log:hs", settings_owner: "!b-set:hs" };
const A_CH = { events_uncategorized: "!a-in:hs", events_owner: "!a-log:hs", settings_owner: "!a-set:hs" };
const T0 = 5e6;
const relayBody = (n) => JSON.stringify({ t: "ddjp.dj.join", v: "ABCDEFGHIJ" + n, actor: "@dj" + n + ":hs", rank: 20, l: 400 + n, dv: 2 });
const history = () => [0, 1, 2].map((i) => ({ type: "m.room.message", event_id: "$a" + i, room_id: BOT_CH.events_owner, sender: BOT,
  origin_server_ts: T0 + i * 1000, content: { body: relayBody(i) } }));
const runnerLines = (w, from) => w.logs.slice(from || 0).filter((m) => /backend2: runner/.test(m));
const room = (w) => (typeof w.sb.B2Runner.room === "function" ? w.sb.B2Runner.room() : "(this runner has no room())");
const BEATS = [250, 500, 60000];   // the runner's own timers: the schedule's tick, the gate, the minute beat
const beatAll = (w) => { for (const ms of BEATS) w.timers.fire(ms); };
// THE GATE IS GIVEN ALL THE TIME IT WANTS. Its openings are spaced on the device's real clock, and fired timers here are
// microseconds apart, so a fired gate finds itself "between openings" and sends nothing — a row reading "nothing was sent" off
// that would be a probe that never applied (FAILURE-SIGNATURES, the forty-second). So every beat is fired, then the gate is
// opened for good (`flush`, its closing opening), twice: whatever anything queued goes, and is read.
const drain = (w) => { beatAll(w); w.sb.B2Authority.flush(); beatAll(w); w.sb.B2Authority.flush(); };
function botRoom() {
  const w = inBotRoom(world({ me: BOT, timers: true, fanOut: true }));
  // Delivered live, so the runner hears them and learns the room's server time: the first one starts the first song (three
  // DJs queued, nothing playing). The gate then sends that and the runner's announcement, and what follows starts from a quiet
  // gate — anything sent later is something a row did.
  for (const r of history()) w.deliver(r, 99);
  w.sb.B2Authority.flush();
  return w;
}
const intent = (w, chan, id, body, sender, ts) => w.deliver({ type: "m.room.message", event_id: id, room_id: chan, sender: sender,
  origin_server_ts: ts, content: { body: JSON.stringify(Object.assign({ l: 1, dv: 2 }, body)) } });
const shared = (w) => addRoom(w, "!space-shared:hs", SH, { mode: "backend1", creator: "@someone:hs", levels: {} });
const otherBot = (w, level) => addRoom(w, "!space-b:hs", B_CH, { mode: "backend2", creator: "@otherowner:hs", levels: { [BOT]: level } });
const sentTo = (w, from, roomId) => w.sent.slice(from).filter((x) => x.roomId === roomId);

const PARTS = [];
const part = (fn) => PARTS.push(fn);

// ── PREMISE: the world runs a live runner in its bot room, or nothing below is a reading ─────────────────────────────────────
part(() => {
  const w = botRoom();
  ok(w.sb.B2Runner.running() === true, "PREMISE — the bot's tab runs its room's runner");
  ok(runnerLines(w).some((m) => /caught up — announced and now relaying/.test(m)), "PREMISE — the runner announced itself in its room", runnerLines(w));
  ok(w.timers.count(250) >= 1 && w.timers.count(500) >= 1 && w.timers.count(60000) >= 1, "PREMISE — the runner's three beats are armed",
    BEATS.map((ms) => w.timers.count(ms)));
  ok(w.listeners() >= 1, "PREMISE — the runner hears the room through the raw fan-out", w.listeners());
  const enter = entryOf(w);
  ok(typeof enter === "function", "PREMISE — the real switch (`_enter`) is reachable in features/room.js");
});

// ── R-a — BOT ROOM -> SHARED ROOM ────────────────────────────────────────────────────────────────────────────────────────────
part(() => {
  const w = botRoom(), sb = w.sb, enter = entryOf(w), S = shared(w);
  const n0 = w.sent.length, l0 = w.logs.length;
  enter(S);
  // Read BEFORE any beat: the self-check (R-g) would stop it at the next one anyway, and this row is about the entry itself.
  ok(sb.Backends.active() === "backend1", "R-a PREMISE — the tab is in the shared room now", sb.Backends.active());
  ok(sb.B2Runner.running() === false, "R-a: entering the shared room stopped the runner");
  ok(runnerLines(w, l0).some((m) => /runner stopped — the tab left the room \(opening another room\)/.test(m)),
    "R-a: and it said so (\"runner stopped — the tab left the room (opening another room)\", J83)", runnerLines(w, l0));
  w.goLive();
  // The shared room plays: a join arrives, the beats fire, the gate opens.
  intent(w, SH.events_uncategorized, "$sh1", { t: "ddjp.dj.join", v: "SONGXYZABCD", l: 5 }, "@dj:hs", 9e6);
  drain(w);
  ok(sentTo(w, n0, BOT_CH.events_owner).length === 0, "R-a: nothing reaches the bot room's log after the tab left it",
    sentTo(w, n0, BOT_CH.events_owner).map((x) => x.t));
  ok(!runnerLines(w, l0).some((m) => /starting the first song|ending the song|sealing checkpoint/.test(m)),
    "R-a: no song started and no seal from the old room's runner", runnerLines(w, l0));
});

// ── R-b — BOT ROOM -> ANOTHER BOT ROOM WHERE THIS ACCOUNT IS NOT THE RUNNER ──────────────────────────────────────────────────
part(() => {
  const w = botRoom(), sb = w.sb, enter = entryOf(w), B = otherBot(w, 60);
  const n0 = w.sent.length, l0 = w.logs.length;
  enter(B);
  w.goLive();
  ok(w.logs.slice(l0).some((m) => /runner not started: not the runner in this room/.test(m)), "R-b PREMISE — room B refused this account as its runner",
    runnerLines(w, l0));
  ok(sb.B2Runner.running() === false, "R-b: the runner of the room it left is stopped");
  w.deliver({ type: "m.room.message", event_id: "$b1", room_id: B_CH.events_owner, sender: "@otherbot:hs", origin_server_ts: 9e6,
    content: { body: JSON.stringify({ t: "ddjp.dj.join", v: "SONGBBBBBBB", actor: "@bdj:hs", rank: 20, l: 3, dv: 2 }) } }, 99);
  drain(w);
  ok(sentTo(w, n0, BOT_CH.events_owner).length === 0 && sentTo(w, n0, B_CH.events_owner).length === 0,
    "R-b: nothing is written to either room's log", w.sent.slice(n0).map((x) => x.roomId + " " + x.t));
});

// ── R-c — BOT ROOM -> ANOTHER BOT ROOM WHERE IT IS THE RUNNER: A FRESH START ─────────────────────────────────────────────────
part(() => {
  const w = botRoom(), sb = w.sb, enter = entryOf(w), B = otherBot(w, 99);
  // An intent arrives while the tab cannot write: the runner HOLDS it for this room.
  sb.Session._setPhaseForTest("suspended");
  intent(w, BOT_CH.events_uncategorized, "$held1", { t: "ddjp.dj.join", v: "HELDSONG001" }, VIP, T0 + 5000);
  ok(sb.B2Runner.stats().held === 1, "R-c PREMISE — the old room's intent is held", sb.B2Runner.stats());
  const n0 = w.sent.length, l0 = w.logs.length;
  enter(B);
  ok(sb.B2Runner.running() === true, "R-c: the runner runs in room B, where this account is the runner");
  ok(sb.B2Runner.stats().held === 0, "R-c: the old room's held intents are dropped at the fresh start", sb.B2Runner.stats());
  const r = room(w);
  ok(r && r.log === B_CH.events_owner, "R-c: the runner now names room B's log", r);
  w.goLive();
  drain(w);
  const inB = sentTo(w, n0, B_CH.events_owner);
  ok(inB.filter((x) => x.t === "ddjp.bot.here").length === 1, "R-c: it announced itself in room B, once", inB.map((x) => x.t));
  ok(!inB.some((x) => x.t === "ddjp.batch" || x.t === "ddjp.dj.join"), "R-c: the old room's held intent was not relayed into room B", inB.map((x) => x.t));
  ok(sentTo(w, n0, BOT_CH.events_owner).length === 0, "R-c: nothing more reaches the old room", sentTo(w, n0, BOT_CH.events_owner).map((x) => x.t));
  ok(runnerLines(w, l0).some((m) => /runner stopped — /.test(m)), "R-c: the old room's runner said it stopped", runnerLines(w, l0));
});

// R-c2 — the same fresh start when `start` is asked for another bot room's log while the runner still runs, with no reset in
// between (the transport's own order: the fold scope first, then the runner). A path that skips the reset does not exist today;
// this is what keeps `start` from re-pointing a running runner if one ever does.
part(() => {
  const w = botRoom(), sb = w.sb;
  otherBot(w, 99);
  sb.Session._setPhaseForTest("suspended");
  intent(w, BOT_CH.events_uncategorized, "$held2", { t: "ddjp.dj.join", v: "HELDSONG002" }, VIP, T0 + 5000);
  ok(sb.B2Runner.stats().held === 1, "R-c2 PREMISE — the old room's intent is held", sb.B2Runner.stats());
  const n0 = w.sent.length;
  sb.B2StreamManager.setFoldScope(B_CH);
  const r = sb.B2Runner.start({ channels: B_CH, spaceId: "!space-b:hs" });
  ok(r && r.ok === true && !r.already, "R-c2: asked to run another room's log while running, it starts afresh — not \"already\"", r);
  const at = room(w);
  ok(at && at.log === B_CH.events_owner, "R-c2: and names room B's log", at);
  ok(sb.B2Runner.stats().held === 0, "R-c2: the old room's held intents are dropped", sb.B2Runner.stats());
  w.goLive(); drain(w);
  const inB = sentTo(w, n0, B_CH.events_owner);
  ok(inB.filter((x) => x.t === "ddjp.bot.here").length === 1 && !inB.some((x) => x.t === "ddjp.batch" || x.t === "ddjp.dj.join"),
    "R-c2: it announces itself in room B once, and relays nothing of the old room there", inB.map((x) => x.t));
});

// ── R-d — STOPPING SENDS WHAT WAS PROMISED, TO ITS ROOM, AT ITS POSITIONS ────────────────────────────────────────────────────
part(() => {
  const w = botRoom(), sb = w.sb, enter = entryOf(w), S = shared(w);
  const n0 = w.sent.length;
  intent(w, BOT_CH.events_uncategorized, "$vipjoin", { t: "ddjp.dj.join", v: "VIPSONG0001" }, VIP, T0 + 5000);
  ok(sb.B2Authority.pending() === 1 && w.sent.length === n0, "R-d PREMISE — the relayed join waits in the gate, promised and not yet sent",
    { pending: sb.B2Authority.pending(), sent: w.sent.length - n0 });
  let head = 0;
  for (const e of sb.StreamManager.getLog()) if (e && typeof e.l === "number" && e.l > head) head = e.l;
  enter(S);
  const atEntry = sentTo(w, n0, BOT_CH.events_owner);
  const carried = atEntry.find((x) => (x.t === "ddjp.batch" && (x.body.evs || []).some((e) => e.t === "ddjp.dj.join" && e.actor === VIP)) ||
    (x.t === "ddjp.dj.join" && x.body.actor === VIP));
  ok(!!carried, "R-d: the promised join went to the bot room when its tab entered another room", atEntry.map((x) => x.t));
  ok(carried && carried.body.l > head, "R-d: at the bot room's own position, above its head l=" + head + " (never backdated)", carried && carried.body.l);
  // A member of the bot room, holding its log, receives it: the door takes it and the join stands.
  const m = world({ me: "@member:hs" });
  for (const r of history()) m.live(r);
  const ml = m.logs.length;
  if (carried) m.live({ type: "m.room.message", event_id: carried.id, room_id: carried.roomId, sender: BOT, origin_server_ts: T0 + 6000,
    content: { body: JSON.stringify(carried.body) } });
  const users = (m.sb.StreamManager.getState().rotation || []).map((x) => x.user);
  ok(users.indexOf(VIP) >= 0, "R-d: a member's door accepts it — the VIP is in the bot room's rotation", users);
  ok(!m.logs.slice(ml).some((x) => /backdated|REFUSED AT THE DOOR/.test(x)), "R-d: no door refused it", m.logs.slice(ml).filter((x) => /REFUSED|backdated/.test(x)));
  const n1 = w.sent.length;
  w.goLive(); drain(w);
  ok(w.sent.length === n1, "R-d: and then nothing runs", w.sent.slice(n1).map((x) => x.roomId + " " + x.t));
});

// ── R-e — SHARED ROOM -> BOT ROOM (control) ──────────────────────────────────────────────────────────────────────────────────
part(() => {
  const w = world({ mode: "backend1", me: BOT, timers: true, fanOut: true }), sb = w.sb, enter = entryOf(w);
  const A = addRoom(w, "!space-a:hs", A_CH, { mode: "backend2", creator: "@owner:hs", levels: { [BOT]: 99 } });
  ok(sb.B2Runner.running() === false, "R-e PREMISE — no runner in a shared room");
  const n0 = w.sent.length;
  enter(A);
  w.goLive(); drain(w);
  ok(sb.B2Runner.running() === true, "R-e CONTROL: entering a bot room where this account is the runner starts it");
  ok(sentTo(w, n0, A_CH.events_owner).filter((x) => x.t === "ddjp.bot.here").length === 1, "R-e CONTROL: and it announces itself once",
    sentTo(w, n0, A_CH.events_owner).map((x) => x.t));
});

// ── R-f — A REFUSED START CHANGES NOTHING BUT STOPPING ───────────────────────────────────────────────────────────────────────
part(() => {
  const w = botRoom(), sb = w.sb;
  otherBot(w, 60);
  const r = sb.B2Runner.start({ channels: B_CH, spaceId: "!space-b:hs" });
  ok(r && r.ok === false && /not the runner in this room/.test(r.reason), "R-f PREMISE — room B refuses this account as its runner", r);
  ok(sb.B2Runner.running() === false, "R-f: a refusal while running stops the runner (what runs belongs to a room the tab is not in)");
  const at = room(w);
  ok(at && at.log === BOT_CH.events_owner, "R-f: the refused start did not re-point the runner at room B", at);
  // And on a tab that never ran one: a refusal leaves nothing behind at all.
  const m = world({ me: "@member:hs", timers: true });
  ok(m.sb.B2Runner.running() === false && room(m) === null, "R-f: a tab refused in its first room holds no room at all", room(m));
});

// ── R-g — THE SELF-CHECK, ON EVERY BEAT ──────────────────────────────────────────────────────────────────────────────────────
// The engine (or the bot engine's fold scope) changes WITHOUT the room-entry reset — a path that does not exist today, and the
// reason for the check: the next beat of any kind stops the runner and says so, rather than writing into a room the tab left.
for (const beat of ["the tick", "the gate", "the minute beat", "an arriving message", "a return to LIVE", "an act handed in"]) {
  part(() => {
    const w = botRoom(), sb = w.sb, l0 = w.logs.length, n0 = w.sent.length;
    if (beat === "an arriving message") sb.B2StreamManager.setFoldScope(B_CH);   // still the bot engine, another room's log
    else sb.Backends.bind("backend1");                                          // another engine
    ok(sb.B2Runner.running() === true, "R-g PREMISE (" + beat + ") — the change itself did not stop the runner");
    if (beat === "the tick") w.timers.fire(250);
    else if (beat === "the gate") w.timers.fire(500);
    else if (beat === "the minute beat") w.timers.fire(60000);
    else if (beat === "an arriving message") w.deliver({ type: "m.room.message", event_id: "$x", room_id: B_CH.events_owner, sender: "@otherbot:hs",
      origin_server_ts: 9e6, content: { body: "{}" } }, 99);
    else if (beat === "an act handed in") {
      // AN ACT HANDED IN IS A BEAT TOO (J80): the bot runtime asks `takesOwn` before it hands the runner an act. Owed at the
      // `ddjp_572` audit — without its self-check `takesOwn` answered yes for a runner whose tab had left its room.
      const t = sb.B2Runner.takesOwn();
      ok(t === false, "R-g: " + beat + " — `takesOwn` answers no for a runner whose tab is no longer in its room", t);
    }
    else { sb.Session._setPhaseForTest("suspended"); sb.Session._setPhaseForTest("live"); }
    ok(sb.B2Runner.running() === false, "R-g: " + beat + " stopped a runner whose tab is no longer in its room");
    ok(runnerLines(w, l0).some((m) => /runner stopped — this tab is no longer in its room/.test(m)),
      "R-g: " + beat + " — and it said \"runner stopped — this tab is no longer in its room\"", runnerLines(w, l0));
    drain(w);
    ok(w.sent.length === n0, "R-g: " + beat + " — nothing written afterwards", w.sent.slice(n0).map((x) => x.roomId + " " + x.t));
  });
}

// R-g, UNREADABLE (owed at the `ddjp_572` audit): a self-check that cannot read the fold scope, or the bound engine, must
// not read as "in its room". Each is made to throw at the next tick; the runner stops and says why, and writes nothing more.
for (const what of ["the fold scope", "the bound engine"]) {
  part(() => {
    const w = botRoom(), sb = w.sb, l0 = w.logs.length, n0 = w.sent.length;
    ok(sb.B2Runner.running() === true, "R-g PREMISE (unreadable " + what + ") — a live runner in its room");
    if (what === "the fold scope") sb.StreamManager.foldScope = () => { throw new Error("unreadable"); };
    else sb.Backends.active = () => { throw new Error("unreadable"); };
    w.timers.fire(250);
    ok(sb.B2Runner.running() === false, "R-g: an unreadable " + what + " is not \"in its room\" — the tick stopped the runner");
    ok(runnerLines(w, l0).some((m) => /runner stopped — this tab is no longer in its room/.test(m)),
      "R-g: unreadable " + what + " — and it said so", runnerLines(w, l0));
    ok(w.sent.length === n0, "R-g: unreadable " + what + " — nothing written afterwards", w.sent.slice(n0).map((x) => x.roomId + " " + x.t));
  });
}

// ── R-h — THE YOUNG BOT ROOM: NO STRAY SAVE POINT ────────────────────────────────────────────────────────────────────────────
part(async () => {
  const w = botRoom(), sb = w.sb, enter = entryOf(w), S = shared(w);
  const n0 = w.sent.length;
  enter(S);
  w.goLive();
  intent(w, SH.events_uncategorized, "$sh1", { t: "ddjp.dj.join", v: "SONGXYZABCD", l: 5 }, "@dj:hs", 9e6);
  drain(w);
  const stray = sentTo(w, n0, BOT_CH.events_owner);
  ok(!stray.some((x) => x.t === "ddjp.checkpoint"), "R-h: no save point of the shared room's state reaches the bot room", stray.map((x) => x.t));
  // A device opening the bot room afterwards, from what its homeserver holds.
  const server = { [SPACE]: [], [BOT_CH.events_uncategorized]: [], [BOT_CH.settings_owner]: [], [BOT_CH.events_owner]: history() };
  stray.forEach((x, i) => server[BOT_CH.events_owner].push({ type: "m.room.message", event_id: x.id, room_id: x.roomId, sender: BOT,
    origin_server_ts: 9e6 + 5 + i, content: { body: JSON.stringify(x.body) } }));
  const o = world({ me: "@opener:hs", server: server, opened: false });
  await o.open();
  const users = (o.sb.StreamManager.getState().rotation || []).map((x) => x.user).sort();
  ok(JSON.stringify(users) === JSON.stringify(["@dj0:hs", "@dj1:hs", "@dj2:hs"]),
    "R-h: a device opening the bot room afterwards holds the bot room's own DJs and nobody from the shared room", users);
});

// ── P — PARITY: THE ROOM AND ITS RUNNER RUN AND STOP TOGETHER (ruling 18; INVERTED AT J83 from ruling 10) ───────────────────
part(() => {
  // THE LOBBY. The room-screen back button, run for real: the room AND the runner stop, at the leave's one engine reset.
  const w = botRoom(), sb = w.sb;
  const back = backButtonsOf(w);
  const l0 = w.logs.length;
  back.shellBack();
  ok(back.shown.filter((s) => s === "screen-rooms").length === 1, "P PREMISE — the room-screen back button ran and showed the room list", back.shown);
  ok(sb.B2Runner.running() === false, "P: the tab went to the lobby and the runner STOPPED (ruling 18: the back button leaves the room)");
  ok(runnerLines(w, l0).some((m) => /runner stopped — the tab left the room \(back to the lobby\)/.test(m)),
    "P: and it said so (\"runner stopped — the tab left the room (back to the lobby)\")", runnerLines(w, l0));
  const n0 = w.sent.length;
  intent(w, BOT_CH.events_uncategorized, "$lobby1", { t: "ddjp.dj.join", v: "LOBBYSONG01" }, VIP, T0 + 7000);
  sb.B2Authority.flush();
  ok(sentTo(w, n0, BOT_CH.events_owner).length === 0, "P: from the lobby nothing of its room is relayed",
    sentTo(w, n0, BOT_CH.events_owner).map((x) => x.t));
  ok((sb.StreamManager.getLog() || []).length === 0 && (sb.StreamManager.getState().rotation || []).length === 0,
    "P: and the room no longer processes on that tab — nothing is folded in the lobby", (sb.StreamManager.getLog() || []).length);
  const l1 = w.logs.length;
  w.timers.fire(60000);
  ok(!runnerLines(w, l1).some((m) => /runner seen \d+/.test(m)), "P: the runner's minute beat no longer runs from the lobby", runnerLines(w, l1));

  // THE LOADING CARD. Its back button cancels the opening, and a room the opening had already switched to is left (E8).
  {
    const w2 = world({ mode: "backend1", me: BOT, timers: true, fanOut: true }), sb2 = w2.sb, enter2 = entryOf(w2);
    const A = addRoom(w2, "!space-a:hs", A_CH, { mode: "backend2", creator: "@owner:hs", levels: { [BOT]: 99 } });
    enter2(A, { opening: true });   // the opening switched and is still replaying
    w2.goLive(); drain(w2);
    ok(sb2.B2Runner.running() === true, "P PREMISE — mid-opening, the room's runner runs");
    const back2 = backButtonsOf(w2);
    back2.loadingBack();
    ok(sb2.B2Runner.running() === false && sb2.Room.runningRoom() === null,
      "P: the loading card's back cancels the opening and leaves the room it had switched to — runner stopped, nothing runs",
      { running: sb2.B2Runner.running(), room: sb2.Room.runningRoom() });
  }

  // THE NEXT ROOM ENTRY, from a room that runs: the room's processing and the runner stop at ONE call, the leave's engine reset.
  const w3 = botRoom(), sb3 = w3.sb, enter = entryOf(w3), S = shared(w3);
  const calls = [];
  const reset0 = sb3.StreamManager.reset;
  sb3.StreamManager.reset = function () {
    const before = { running: sb3.B2Runner.running(), log: sb3.StreamManager.getLog().length };
    const out = reset0.apply(this, arguments);
    calls.push({ before, after: { running: sb3.B2Runner.running(), log: sb3.B1StreamManager.getLog().length } });
    return out;
  };
  enter(S);
  ok(calls.length === 1, "P PREMISE — the entry made exactly one engine reset", calls.length);
  const c = calls[0] || { before: {}, after: {} };
  ok(c.before.running === true && c.before.log > 0, "P: until the reset, the room was processing and its runner running", c.before);
  ok(c.after.log === 0 && c.after.running === false, "P: at that reset, BOTH stopped — the room's processing and the runner", c.after);
  ok(sb3.B2Runner.running() === false, "P: and nothing in the rest of the entry started the runner again");
});

// ── P-i — THE INVITE SCOPE MOVES WITH THE SAME SWITCH (J81; ruling 8b; INVERTED AT J83, ruling 18) ─────────────────────────
// "Which room runs here" is read through ONE function, `Room.runningRoom()`, built on `current`. The lobby half is driven with
// the real back buttons; the entry half is read from the switch's own source, because `current` is assigned there and nowhere
// else is allowed to decide "running" (the owner, `ddjp_573`).
part(() => {
  const w = botRoom(), sb = w.sb;
  const running = () => (typeof sb.Room.runningRoom === "function" ? sb.Room.runningRoom() : "(no Room.runningRoom)");
  ok(running() === SPACE, "P-i PREMISE — the bot room runs on this tab, read through `Room.runningRoom()`", running());
  const back = backButtonsOf(w);
  back.shellBack();
  ok(running() === null, "P-i: the back button clears the invite scope — the lobby runs no room (ruling 18)", running());
  ok(sb.B2Runner.running() === false, "P-i: and the runner stops with it");
  const room = src("features/room.js");
  const at = room.indexOf("function runningRoom(");
  ok(at >= 0, "P-i APPLIED — `features/room.js` reads \"running\" through ONE function, `runningRoom`", at);
  if (at < 0) return;
  const rr = braceFrom(room, at, "features/room.js runningRoom");
  const body = rr.slice(rr.indexOf("{") + 1, rr.lastIndexOf("}"));
  ok(/\bcurrent\b/.test(body) && !/_opening|MatrixBridge|_currentSpaceId|Store\./.test(body),
    "P-i: `runningRoom` reads `current` alone — no second source for \"running\" (the bridge's own copy, the opening flag)", body.trim());
  const enterSrc = braceFrom(room, room.indexOf("function _enter("), "features/room.js _enter");
  const lv = enterSrc.indexOf("leave("), set = enterSrc.indexOf("current = {"), init = enterSrc.indexOf("_initModules(current");
  const between = (set >= 0 && init > set) ? enterSrc.slice(set, init) : null;
  ok(lv >= 0 && lv < set && between !== null && !/\bawait\b/.test(enterSrc),
    "P-i: the switch leaves the running room, then sets `current` immediately before the room-entry coordinator, with nothing " +
    "awaited — the invite scope and the runner move at one switch", { leave: lv, set: set, between: between });
});

(async () => {
  for (const fn of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[runner-room-change] FAIL — a part threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[runner-room-change] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[runner-room-change] PASS — the bot runs exactly when its room runs on that tab (J80; ruling 18 since J83; " + asserts + " assertions). " +
    "Through the real switch (the leave, then the room-entry coordinator) and the real back buttons: from its bot room to a shared room, or to another bot room " +
    "where this account is not the runner, the runner stops at the entry and writes nothing more anywhere — no song started, no " +
    "seal; into another bot room where it IS the runner, a fresh start announces once there, with the gate reset and the old room's " +
    "held intents dropped — and the same when it is asked to run another room's log with no reset between. What the gate had promised goes to its room at that room's positions as it stops, and a member's door " +
    "takes it. A refused start changes nothing but stopping; the self-check stops it on the tick, the gate, the minute beat, an " +
    "arriving message and a return to LIVE when the engine or its fold scope moved without the reset; a young bot room never opens " +
    "from the shared room's state. Parity (ruling 18): the back button stops the room and its runner at the leave's one reset and " +
    "says so, the loading card's back cancels the opening and leaves what it switched to, the next entry stops both at one reset, " +
    "and the invite scope (`Room.runningRoom()`, J81) is cleared in the lobby and moves at the same switch. " +
    "An act handed in and an unreadable check stop the runner too.");
})();
