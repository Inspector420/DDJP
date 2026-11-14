// tests/check-runner-rank.js
// SUBJECT: backends/backend2/transport.js, backends/backend2/runner.js
//
// WALL: THE RUNNER FOLLOWS THIS ACCOUNT'S RANK WHILE THE TAB IS IN ITS BOT ROOM (J137). Live, `?v=605`: the owner gave the bot
//   account the Bot rank (99) while its tab was already in the bot room; no song played until that tab reloaded, because the
//   runner's one start was the room's entry (`setRoomScope`) and the rank change reached only `features/room.js`, which restarts
//   the bot runtime. Now the engine hears the change itself (`backends/backend2/transport.js` `_runnerFollowsRank`, on the
//   shared transport's `onRankChange`), with no bot-room branch above the seam.
//
//   Driven through the real modules (`tests/_botroom.js`: both engines, the seam, `features/room.js`), the SDK client the only
//   double, and the rank change delivered the way a sync delivers it — one `m.room.power_levels` state event per room, through
//   the bridge's real state-event door (`_onStateEventForTest`), in the order `assignRank` sends them (the space, then each
//   channel: "N of M steps"). The runner's gate reads the LOG channel's level, so the order is varied: the log channel's step
//   last, and first.
//
//   A  RAISED AFTER ENTRY, THE LOG CHANNEL'S STEP LAST: not running through the steps before it; running at it, for this room,
//      announced once (the tab is live), and it relays a request made after it started. A request made before it started is
//      not read (the runner's own rule, kept).
//   B  RAISED, THE LOG CHANNEL'S STEP FIRST (after the space): running at that step; the steps after it change nothing — one
//      start, one announcement.
//   C  LOWERED, THE LOG CHANNEL'S STEP LAST (the bot itself, running since its entry): running until that step lands; stopped
//      at it, saying why; nothing relayed after. And FIRST: stopped at that step. Raised again: a fresh start, announced again.
//   D  RAISED WHILE THE ROOM IS STILL LOADING: started, holding — nothing announced — until the tab is live; then announced.
//   E  CONTROLS: someone else's rank changing changes nothing, on the runner's tab and on a member's (no runner line either);
//      in the lobby after the leave, and in a shared room, a raised rank starts no runner.
"use strict";
const path = require("path");
const { BOT, BOT_CH, SPACE, VIP, LEVELS, world } = require(path.join(__dirname, "_botroom.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[runner-rank] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// An account no room lists: level 0 (the rooms' `users_default`) everywhere until a step raises it.
const NEW = "@newbot:hs";
const LOG = BOT_CH.events_owner, INTENTS = BOT_CH.events_uncategorized, SETTINGS = BOT_CH.settings_owner;
// The steps of one change, as `assignRank` orders them: the space first, then the channels. Two orders of the channels.
const LOG_LAST = [SPACE, INTENTS, SETTINGS, LOG];
const LOG_FIRST = [SPACE, LOG, INTENTS, SETTINGS];

// THE ROOMS' POWER LEVELS, MUTABLE: each room's `m.room.power_levels` reads the world's own list, with this guard's changes laid
// over it per room. A step changes one room's list and then delivers that room's state event through the bridge's real door —
// what a sync does.
function levels(w) {
  const over = {};
  for (const id of Object.keys(w.rooms)) {
    const cs = w.rooms[id].currentState, orig = cs.getStateEvents;
    cs.getStateEvents = (t) => {
      const ev = orig(t);
      if (t !== "m.room.power_levels" || !ev) return ev;
      const c = ev.getContent();
      return { getContent: () => Object.assign({}, c, { users: Object.assign({}, c.users, over[id] || {}) }) };
    };
  }
  const step = (roomId, user, level) => {
    over[roomId] = Object.assign({}, over[roomId], { [user]: level });
    w.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => roomId, getStateKey: () => "",
      getContent: () => ({}) });
  };
  return { over, step };
}
const lines = (w, from) => w.logs.slice(from || 0).filter((m) => /backend2: runner/.test(m));
// What a start or a stop says — not the runner's own minute beat ("seen …, relayed …"), which a drained beat prints anyway.
const turns = (w, from) => lines(w, from).filter((m) => /runner (started|stopped|not started)|announced/.test(m));
const sentTo = (w, from, roomId, t) => w.sent.slice(from).filter((x) => x.roomId === roomId && (!t || x.t === t));
const intent = (w, id, body, sender, ts) => w.deliver({ type: "m.room.message", event_id: id, room_id: INTENTS, sender: sender,
  origin_server_ts: ts, content: { body: JSON.stringify(Object.assign({ l: 1, dv: 2 }, body)) } });
// The gate is opened for good, twice: whatever anything queued goes and is read (the runner's own beats are spaced on a real
// clock, so a fired timer here finds the gate "between openings"; `check-runner-room-change` explains the same drain).
const drain = (w) => { for (const ms of [250, 500, 60000]) w.timers.fire(ms); w.sb.B2Authority.flush(); w.sb.B2Authority.flush(); };
// A tab entering its bot room as an account that is not (yet) the runner: the world's own entry (`setRoomScope`) runs and the
// runner refuses it. `o.live: false` leaves it loading.
function entered(o) {
  const w = world(Object.assign({ me: NEW, timers: true, fanOut: true }, o || {}));
  w.sb.Room._setCurrentForTest({ name: SPACE, spaceId: SPACE, channels: BOT_CH });
  return Object.assign(w, levels(w));
}
const T = 7e6;

const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);

// ── PREMISE: the tab entered its bot room as nobody's runner, and the room's steps reach the bridge's door ──────────────────
part("premise", () => {
  const w = entered();
  ok(w.sb.Backends.active() === "backend2", "PREMISE — the tab runs the bot room's engine", w.sb.Backends.active());
  ok(w.logs.some((m) => /runner not started: not the runner in this room/.test(m)),
    "PREMISE — at entry the runner refused this account (level 0): the start this guard is about is not entry's", lines(w));
  ok(w.sb.B2Runner.running() === false, "PREMISE — no runner runs at entry");
  ok(w.sb.MatrixBridge.getMyPowerLevel(LOG) === 0, "PREMISE — the account's level on the log channel reads 0", w.sb.MatrixBridge.getMyPowerLevel(LOG));
  w.step(LOG, NEW, 42);
  ok(w.sb.MatrixBridge.getMyPowerLevel(LOG) === 42, "PREMISE — a step changes the level the bridge reads back (the double applies)",
    w.sb.MatrixBridge.getMyPowerLevel(LOG));
  ok(w.sb.B2Runner.runnerLevel() === 99, "PREMISE — the runner's rung is the ladder's top, 99", w.sb.B2Runner.runnerLevel());
});

// ── A — RAISED AFTER ENTRY, THE LOG CHANNEL'S STEP LAST ─────────────────────────────────────────────────────────────────────
part("A", () => {
  const w = entered(), sb = w.sb;
  // A request made while this account is not the runner: nobody reads it.
  intent(w, "$before", { t: "ddjp.dj.join", v: "BEFORESONG1" }, VIP, T);
  const n0 = w.sent.length, l0 = w.logs.length;
  const states = [];
  for (const id of LOG_LAST) { w.step(id, NEW, 99); states.push([id, sb.B2Runner.running()]); }
  ok(states.slice(0, 3).every((s) => s[1] === false),
    "A: THROUGH THE STEPS BEFORE THE LOG CHANNEL'S, NO RUNNER — its gate reads the log channel's level, still 0", states);
  ok(states[3][1] === true, "A: AT THE LOG CHANNEL'S STEP THE RUNNER STARTS — without a reopen", states);
  const room = sb.B2Runner.room();
  ok(room && room.log === LOG && room.intents === INTENTS, "A: and it runs THIS room's log", room);
  ok(lines(w, l0).some((m) => /runner started — this account's level on the log channel reached the runner's rung after the room opened/.test(m)),
    "A: and the engine says why it started (\"runner started — this account's level on the log channel reached …\")", lines(w, l0));
  drain(w);
  ok(sentTo(w, n0, LOG, "ddjp.bot.here").length === 1, "A: THE TAB IS LIVE, SO IT ANNOUNCES ITSELF, ONCE",
    w.sent.slice(n0).map((x) => x.roomId + " " + x.t));
  ok(!sentTo(w, n0, LOG).some((x) => x.body && x.body.v === "BEFORESONG1") && !lines(w, l0).some((m) => /BEFORESONG1|\$before/.test(m)),
    "A: A REQUEST MADE BEFORE IT STARTED IS NOT READ — the runner's own rule, kept (the asking app sends it again after its answer window)",
    sentTo(w, n0, LOG).map((x) => x.t + " " + JSON.stringify(x.body)));
  const n1 = w.sent.length;
  intent(w, "$after", { t: "ddjp.dj.join", v: "AFTERSONG01" }, VIP, T + 5000);
  drain(w);
  const relayed = sentTo(w, n1, LOG).filter((x) => JSON.stringify(x.body).indexOf("AFTERSONG01") >= 0);
  ok(relayed.length === 1, "A: A REQUEST MADE AFTER IT STARTED IS RELAYED TO THE LOG — the room runs again",
    w.sent.slice(n1).map((x) => x.roomId + " " + x.t + " " + JSON.stringify(x.body).slice(0, 120)));
});

// ── B — RAISED, THE LOG CHANNEL'S STEP FIRST ────────────────────────────────────────────────────────────────────────────────
part("B", () => {
  const w = entered(), sb = w.sb;
  const n0 = w.sent.length, l0 = w.logs.length;
  const states = [];
  for (const id of LOG_FIRST) { w.step(id, NEW, 99); states.push([id, sb.B2Runner.running()]); }
  ok(states[0][1] === false && states[1][1] === true, "B: THE LOG CHANNEL'S STEP FIRST — the runner starts at it", states);
  ok(states[2][1] === true && states[3][1] === true, "B: and the steps after it keep it running", states);
  drain(w);
  ok(lines(w, l0).filter((m) => /runner started — /.test(m)).length === 1 &&
     lines(w, l0).filter((m) => /caught up — announced and now relaying/.test(m)).length === 1,
    "B: ONE START AND ONE ANNOUNCEMENT for the whole change — a later step finds it already running", lines(w, l0));
  ok(sentTo(w, n0, LOG, "ddjp.bot.here").length === 1, "B: one `ddjp.bot.here` in the log", w.sent.slice(n0).map((x) => x.t));
});

// ── C — LOWERED: STOPPED AT THE LOG CHANNEL'S STEP, WHICHEVER IT IS ─────────────────────────────────────────────────────────
part("C", () => {
  // THE BOT ITSELF, RUNNING SINCE ENTRY (99 in every room's list): this direction is read on its own, not through A's start.
  for (const [name, order] of [["log last", LOG_LAST], ["log first", LOG_FIRST]]) {
    const w = entered({ me: BOT }), sb = w.sb;
    drain(w);
    ok(sb.B2Runner.running() === true && sb.B2Runner.room() && sb.B2Runner.room().log === LOG,
      "C PREMISE (" + name + ") — the bot's tab has run the room since its entry", sb.B2Runner.room());
    const l0 = w.logs.length;
    const states = [];
    for (const id of order) { w.step(id, BOT, 0); states.push([id, sb.B2Runner.running()]); }
    const at = order.indexOf(LOG);
    ok(states.slice(0, at).every((s) => s[1] === true), "C (" + name + "): RUNNING UNTIL THE LOG CHANNEL'S STEP LANDS", states);
    ok(states.slice(at).every((s) => s[1] === false), "C (" + name + "): STOPPED AT THE LOG CHANNEL'S STEP, and stays stopped", states);
    ok(lines(w, l0).some((m) => /runner stopped — this account's level on the log channel is now 0, not the runner's 99/.test(m)),
      "C (" + name + "): and it says why (\"runner stopped — this account's level on the log channel is now 0, not the runner's 99\")", lines(w, l0));
    const n1 = w.sent.length;
    intent(w, "$late-" + at, { t: "ddjp.dj.join", v: "LATESONG001" }, VIP, T + 9000);
    drain(w);
    ok(sentTo(w, n1, LOG).length === 0, "C (" + name + "): NOTHING IS WRITTEN TO THE LOG AFTER IT STOPPED — no relay, no song started, no seal",
      w.sent.slice(n1).map((x) => x.roomId + " " + x.t));
    if (name === "log last") {
      const l1 = w.logs.length, n2 = w.sent.length;
      for (const id of LOG_LAST) w.step(id, BOT, 99);
      drain(w);
      ok(sb.B2Runner.running() === true && sentTo(w, n2, LOG, "ddjp.bot.here").length === 1,
        "C: RAISED AGAIN, A FRESH START — running, and announced again", { running: sb.B2Runner.running(), lines: lines(w, l1) });
    }
  }
});

// ── D — RAISED WHILE THE ROOM IS STILL LOADING ──────────────────────────────────────────────────────────────────────────────
part("D", () => {
  const w = entered({ live: false }), sb = w.sb;
  const live0 = (() => { const f = sb.MatrixBridge.mayAuthor(); return !(f && f.ok === false); })();
  ok(live0 === false, "D PREMISE — the tab is not live yet (still loading the room)", sb.MatrixBridge.mayAuthor());
  const n0 = w.sent.length, l0 = w.logs.length;
  for (const id of LOG_LAST) w.step(id, NEW, 99);
  drain(w);
  ok(sb.B2Runner.running() === true, "D: THE RAISED RANK STARTS THE RUNNER while the room loads");
  ok(sentTo(w, n0, LOG).length === 0 && !lines(w, l0).some((m) => /caught up — announced/.test(m)),
    "D: BUT IT WRITES NOTHING UNTIL THE TAB IS LIVE — no announcement while loading", w.sent.slice(n0).map((x) => x.t));
  w.goLive();
  drain(w);
  ok(sentTo(w, n0, LOG, "ddjp.bot.here").length === 1 && lines(w, l0).some((m) => /caught up — announced and now relaying/.test(m)),
    "D: ONCE THE FOLD IS LIVE IT ANNOUNCES, ONCE", { sent: w.sent.slice(n0).map((x) => x.t), lines: lines(w, l0) });
});

// ── E — CONTROLS ────────────────────────────────────────────────────────────────────────────────────────────────────────────
part("E", () => {
  {   // Someone else's rank, on the runner's tab: nothing changes.
    const w = entered(), sb = w.sb;
    for (const id of LOG_LAST) w.step(id, NEW, 99);
    drain(w);
    const l0 = w.logs.length, n0 = w.sent.length;
    for (const id of LOG_LAST) w.step(id, VIP, 50);
    drain(w);
    ok(sb.B2Runner.running() === true && turns(w, l0).length === 0 && sentTo(w, n0, LOG, "ddjp.bot.here").length === 0,
      "E: SOMEONE ELSE'S RANK CHANGING LEAVES THE RUNNER AS IT WAS — running, no start or stop line, no second announcement",
      { running: sb.B2Runner.running(), lines: lines(w, l0) });
  }
  {   // Someone else's rank, on a member's tab: no runner, and no runner line.
    const w = entered(), sb = w.sb, l0 = w.logs.length;
    for (const id of LOG_LAST) w.step(id, VIP, 50);
    ok(sb.B2Runner.running() === false && lines(w, l0).length === 0,
      "E: ON A MEMBER'S TAB A RANK CHANGE STARTS NOTHING AND SAYS NOTHING (no line for everybody who is not the bot)", lines(w, l0));
  }
  {   // The lobby: the tab left the room; a raised rank starts nothing there.
    const w = entered(), sb = w.sb;
    let left = null;
    try { left = sb.Room.leave("the guard leaves"); } catch (e) { left = { threw: String(e && e.message) }; }
    ok(left && left.ok === true && sb.Room.runningRoom() === null, "E PREMISE — the tab left its room by the one leave step", left);
    const l0 = w.logs.length;
    for (const id of LOG_LAST) w.step(id, NEW, 99);
    ok(sb.B2Runner.running() === false && lines(w, l0).length === 0, "E: IN THE LOBBY A RAISED RANK STARTS NO RUNNER", lines(w, l0));
  }
  {   // A shared room: the bot-run engine is not bound; a raised rank starts no runner.
    const w = world({ mode: "backend1", me: NEW, timers: true, fanOut: true }), sb = w.sb;
    const lv = levels(w);
    ok(sb.Backends.active() === "backend1", "E PREMISE — a shared room's engine is bound", sb.Backends.active());
    const l0 = w.logs.length;
    for (const id of [SPACE].concat(Object.values(w.CH))) lv.step(id, NEW, 99);
    ok(sb.B2Runner.running() === false && lines(w, l0).length === 0, "E: IN A SHARED ROOM A RAISED RANK STARTS NO RUNNER", lines(w, l0));
  }
  ok(LEVELS[NEW] === undefined, "E PREMISE — the raised account is listed in no room before its steps", LEVELS[NEW]);
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[runner-rank] FAIL — part " + name + " threw: " + ((e && e.stack) || e)); }
  }
  if (failed) { console.log("[runner-rank] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[runner-rank] PASS — the runner follows this account's rank while the tab is in its bot room (J137; " + asserts +
    " assertions). Through the bridge's real state-event door, one power-levels event per room in assignRank's order: raised " +
    "after entry, it starts at the log channel's step, whichever it is, runs this room, announces once and relays what is asked " +
    "after it started (what was asked before is not read, its own rule); lowered, it stops at the log channel's step and says " +
    "why, and nothing reaches the log after; raised again, it starts afresh; raised while the room loads, it holds until the tab " +
    "is live and then announces. Someone else's rank changes nothing on the runner's tab or a member's, and in the lobby or a " +
    "shared room a raised rank starts no runner.");
})();
