// tests/check-bot-rung.js
// SUBJECT: backends/backend1/ranks.js, backends/backend1/scheduler.js, backends/backend1/matrixbridge.js, backends/backend1/checkpoint.js, features/playback.js, features/medialength.js, features/mediablocked.js
// WALL: THE BOT TAKES ITS OWN TURN BEFORE THE HUMAN OWNER — FOR SAVE POINTS AND PROTECTION ONLY, AND ONLY WHILE AN ACCOUNT
//   HOLDS THE BOT'S RANK (the owner's decisions, `ddjp_627` and `ddjp_628`; seen live at `?v=558`: the human owner, power 100, and
//   the bot, 99, both sealed n=2 26 ms apart). In a room where an account holds exactly the ladder's top rung, read from the
//   room's power levels when the turn is worked out, the SEAL and the PROACTIVE VOUCH PASS go bot first, the human owner one step
//   later, every rung below one step later than with no bot. The five SONG ACTS take no rung (a bot that does not watch made every
//   song change wait a step for nothing). A room with no such account keeps today's slots. A rank change re-arms a waiting turn.
//   PART A — the formula (`Ranks.staggerMs`): no bot is today's arithmetic to the millisecond, floors included; with a bot the
//            bot keeps today's owner slot and every other rung moves exactly one step; with no floor no two rungs share a slot.
//   PART B — the reading (`MatrixBridge.botRung`, the REAL bridge in the bot-room world): the creator's tab reads "a bot, not
//            me", the bot's "a bot, me"; with EXACTLY ONE account at 99 too (the owner's real room); a room with no account at the
//            top rung reads "no bot"; read when asked, not cached.
//   PART C — each of check-spine PART C's seven acts, DRIVEN: two owner-tier tabs (both carry the channel rank 99) on one
//            trigger, their timers on one clock, each tab's act reaching the other after a delivery delay. The seal and the vouch
//            pass: with a bot the bot acts first and the human's re-check stays silent; a staff tab moves one step only then. The
//            five song acts: with a bot, both owner-tier tabs plan today's instant together and a staff tab does not move.
//            MEASURED at the homeserver round trip `ddjp_626` read off the owner's log (1.13 s).
//   PART D — the order follows rank changes (the bot at 99, demoted to 80, back to 99, demoted to 0): the seal through the real
//            bridge, the change delivered as a sync would, and the vouch pass; for a turn planned fresh and one planned before;
//            and on a real clock a re-armed turn does not act at its old moment (the old timer is gone, `ddjp_629`).
//   PART E — the seal's dueness ladder in a quiet room: the human owner comes due one seal step after the bot.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-rung] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const R = loadInContext(["backends/backend1/ranks.js"], {}).Ranks;
const TOP = R.levelOf("owner"), STAFF = R.levelOf("staff");
const BOT_RUNG = { botRoom: true, iAmBot: true }, HUMAN_RUNG = { botRoom: true, iAmBot: false }, NO_BOT = { botRoom: false, iAmBot: false };

// ── PART A — the formula ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  // TODAY'S ARITHMETIC, written out: the owner tier at 0, every other tier `tier × step + jitter`, and each site's settle floor
  // as `max(floor, slot)`. (The device offset is absent: nothing ever set it.)
  const today = (rank, s, r, floor) => Math.max(floor, R.tierOf(rank) === 0 ? 0 : Math.round(R.tierOf(rank) * s + Math.floor(r * (s / 2))));
  const LEVELS = [100, 99, 80, 60, 40, 20, 10, 0];
  const rows = [];
  for (const s of [1000, 5000, 750]) for (const r of [0, 0.999]) for (const floor of [0, 500, 4000]) for (const lvl of LEVELS) {
    const want = today(lvl, s, r, floor);
    for (const rung of [null, undefined, NO_BOT, 1000, { botRoom: "yes" }]) {
      const got = R.staggerMs(lvl, s, () => r, rung, floor);
      if (got !== want) rows.push({ lvl, s, r, floor, rung, got, want });
    }
  }
  ok(rows.length === 0, "A1: a room with NO bot keeps today's slots to the millisecond — every rung, three steps, both ends of the " +
    "jitter, floors 0, 500 and 4000; absent, unreadable or an older caller's number all read as no bot", rows.slice(0, 4));
  const moved = [];
  for (const s of [1000, 5000]) for (const r of [0, 0.999]) for (const floor of [0, 500, 4000]) for (const lvl of LEVELS) {
    const without = R.staggerMs(lvl, s, () => r, NO_BOT, floor);
    if (R.tierOf(lvl) === 0) {
      const bot = R.staggerMs(lvl, s, () => r, BOT_RUNG, floor), human = R.staggerMs(lvl, s, () => r, HUMAN_RUNG, floor);
      if (bot !== without || human !== without + s) moved.push({ lvl, s, r, floor, bot, human, without });
    } else {
      const withBot = R.staggerMs(lvl, s, () => r, HUMAN_RUNG, floor), asBot = R.staggerMs(lvl, s, () => r, BOT_RUNG, floor);
      if (withBot !== without + s || asBot !== without + s) moved.push({ lvl, s, r, floor, withBot, asBot, without });
    }
  }
  ok(moved.length === 0, "A2: WITH a bot the bot keeps today's owner slot, the human owner waits one step more, and every rung " +
    "below moves exactly one step — a tab that reads itself as the bot below the owner tier is not the bot", moved.slice(0, 4));
  // No two rungs share a slot when the floor is no longer than a step: the worst case, each rung at the top of its jitter
  // against the next one down at the bottom of its own.
  const share = [];
  for (const s of [1000, 5000]) for (const floor of [0, s / 2]) {
    const order = [["bot", 99, BOT_RUNG]].concat([100, 80, 60, 40, 20, 10, 0].map((l) => [R.nameOf(l), l, HUMAN_RUNG]));
    for (let i = 0; i + 1 < order.length; i++) {
      const hi = R.staggerMs(order[i][1], s, () => 0.999, order[i][2], floor), lo = R.staggerMs(order[i + 1][1], s, () => 0, order[i + 1][2], floor);
      if (!(hi < lo)) share.push({ s, floor, upper: order[i][0], hi, lower: order[i + 1][0], lo });
    }
  }
  ok(share.length === 0, "A3: with a bot and a floor no longer than a step, no two rungs share a slot — the bot, the human owner, " +
    "high-staff and on down, each rung's latest moment before the next rung's earliest", share);
  // The vouch pass's four-second floor is longer than its one-second step, and today it puts the owner tier, high-staff, staff
  // and VIP at one instant. With a bot it still does — one step later, and with the bot alone in front. Measured, not asserted away.
  const v = [["bot", 99, BOT_RUNG], ["owner (human)", 100, HUMAN_RUNG], ["high-staff", 80, HUMAN_RUNG], ["staff", 60, HUMAN_RUNG],
    ["vip", 40, HUMAN_RUNG], ["player", 20, HUMAN_RUNG]].map(([n, l, g]) => n + " " + R.staggerMs(l, 1000, () => 0, g, 4000));
  console.log("[bot-rung] MEASURED the vouch pass with a bot (step 1 s, floor 4 s): " + v.join(", ") + " ms — the floor still " +
    "puts the human owner, high-staff, staff and VIP at one instant, as today it puts them there with the bot");
}

// ── PART B — the reading, from the real bridge ───────────────────────────────────────────────────────────────────────────
const B = require("./_botroom.js");
const readings = {};
{
  ok(typeof B.world({ mode: "backend1", me: B.OWNER }).sb.MatrixBridge.botRung === "function",
    "B PREMISE — the bridge has a reading of the room's bot rung");
  const read = (me) => { const w = B.world({ mode: "backend1", me }); return { w, r: w.sb.MatrixBridge.botRung ? w.sb.MatrixBridge.botRung() : undefined }; };
  const owner = read(B.OWNER), bot = read(B.BOT), staff = read(B.STAFF);
  readings.human = owner.r; readings.bot = bot.r;
  ok(owner.r && owner.r.botRoom === true && owner.r.iAmBot === false, "B1: the creator's tab (power 100) reads a room with a bot, and not itself as the bot", owner.r);
  ok(bot.r && bot.r.botRoom === true && bot.r.iAmBot === true, "B2: the bot's tab (power 99, the ladder's top rung exactly) reads itself as the bot", bot.r);
  ok(staff.r && staff.r.botRoom === true && staff.r.iAmBot === false, "B3: a staff tab reads the room's bot too", staff.r);
  // The room's power levels change under the open tab: nobody at 99 any more. Read when asked, so the next turn sees it.
  for (const id of Object.keys(owner.w.rooms)) {
    const old = owner.w.rooms[id].currentState.getStateEvents;
    owner.w.rooms[id].currentState = { getStateEvents: (t) => {
      if (t !== "m.room.power_levels") return old(t);
      const c = old(t).getContent(); const users = Object.assign({}, c.users); delete users[B.BOT]; delete users[B.ADMIN];
      return { getContent: () => Object.assign({}, c, { users }) };
    } };
  }
  const has = typeof owner.w.sb.MatrixBridge.botRung === "function";
  const after = has ? owner.w.sb.MatrixBridge.botRung() : undefined;
  ok(after && after.botRoom === false && after.iAmBot === false, "B4: a room with no account at the ladder's top rung reads no bot — read " +
    "from the room's power levels when asked, not remembered from the opening", after);
  owner.w.sb.MatrixBridge.leaveRoom();
  const left = has ? owner.w.sb.MatrixBridge.botRung() : undefined;
  ok(left === null, "B5: after the room's leave, no room and no reading: today's turn order", left);
  // THE OWNER'S REAL ROOM: EXACTLY ONE ACCOUNT AT 99 (`ddjp_628`, a gap the supervisor planted). The world puts two there (the
  // bot and a top-rung human), so a reading that needed more than one account at the top rung stayed green on every row above.
  const admin = B.LEVELS[B.ADMIN];
  delete B.LEVELS[B.ADMIN];
  try {
    const lone = read(B.OWNER), loneBot = read(B.BOT);
    ok(lone.r && lone.r.botRoom === true && lone.r.iAmBot === false, "B6: with exactly one account at 99 — the bot — the creator's tab " +
      "reads a room with a bot, and not itself as the bot", lone.r);
    ok(loneBot.r && loneBot.r.botRoom === true && loneBot.r.iAmBot === true, "B7: and the lone bot's own tab reads itself as the bot", loneBot.r);
  } finally { B.LEVELS[B.ADMIN] = admin; }
  // PART C is driven with these readings; on a tree with no reading it is driven with the three it should give, so its rows
  // still say what the acts do rather than stopping here.
  readings.human = readings.human || HUMAN_RUNG; readings.bot = readings.bot || BOT_RUNG; readings.none = after || NO_BOT;
}

// ── PART C — the seven acts, two owner-tier tabs on one trigger ──────────────────────────────────────────────────────────
// ONE CLOCK FOR BOTH TABS. Each tab's timers land on it at `now + ms`; an act a tab sends reaches the room (and the other tab)
// `D` ms later. Deliveries are applied before timers due at the same instant.
function clock(D) {
  const c = { t: 0, D, items: [], sent: [], seq: 0 };
  c.timer = (tab) => ({
    setTimeout: (fn, ms) => { const id = ++c.seq; c.items.push({ id, at: c.t + (ms || 0), fn, tab, kind: "timer", ms: ms || 0 }); return id; },
    clearTimeout: (id) => { c.items = c.items.filter((x) => x.id !== id); },
  });
  c.send = (tab, type, apply) => { c.sent.push({ tab, type, at: c.t }); c.items.push({ id: ++c.seq, at: c.t + c.D, fn: apply || (() => {}), kind: "deliver" }); };
  c.armed = (tab) => c.items.filter((x) => x.kind === "timer" && x.tab === tab).map((x) => x.at - c.t);
  c.run = () => {
    for (let n = 0; n < 200 && c.items.length; n++) {
      c.items.sort((a, b) => (a.at - b.at) || ((a.kind === "deliver" ? 0 : 1) - (b.kind === "deliver" ? 0 : 1)) || (a.id - b.id));
      const x = c.items.shift(); c.t = Math.max(c.t, x.at);
      try { const p = x.fn(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch (e) {}
    }
  };
  return c;
}
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
// capabilities.js aliases the ladder exactly; this one's jitter is pinned to the bottom of each slot, so the clock is exact.
const R0 = loadInContext(["backends/backend1/ranks.js"], { Math: Object.assign(Object.create(Math), { random: () => 0 }) }).Ranks;
const Caps = { staggerMs: R0.staggerMs, rankNameOf: R0.nameOf, atLeast: R0.atLeast };
const VID = "AAAAAAAAAAA";
const settings = () => ({ vouchJitter: 1000, maxLen: 600, minLen: 10, minGate: 8000, graceMs: 1000, presendMs: 300 });
function sharedRoom() {
  const np = { dj: "@dj:hs", song: { videoId: VID }, pi: "$p1", startedAt: 0, settings: settings() };
  return { state: { nowPlaying: np, rotation: [{ user: "@dj:hs", pending: [{ videoId: "BBBBBBBBBBB" }] }], settings: np.settings,
    advance: { pi: "$p1", gateLenSec: null, earliestAt: -1, ceilingAt: 600000, skipWarranted: false, blockedGuestPlus: 0, blockedVipPlus: 0 } },
    handlers: [] };
}
// One feature tab: the real module, its timers on the clock, sends delivered to the room through the handlers both tabs hold.
function featureTab(file, c, room, who, rank, rung, onSend) {
  const tm = c.timer(who);
  const sb = loadInContext([file], {
    Date: { now: () => c.t }, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout, setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: () => room.state, on: (t, fn) => room.handlers.push({ t, fn, who }), off: () => {} },
    ServerClock: { serverNow: () => c.t, elapsedSince: (ts) => c.t - ts },
    MatrixBridge: { botRung: () => rung, getUserId: () => who, mayAdvance: () => ({ ok: true }),
      sendEvent: (ch, type, content) => { c.send(who, type, () => onSend(type, content, who)); return Promise.resolve({ eventId: "$" + who + c.sent.length }); } },
    Capabilities: Caps, Logger: quiet,
  });
  return sb;
}
const fanOut = (room, type, entry) => { for (const h of room.handlers.slice()) if (h.t === type) { try { h.fn(entry); } catch (e) {} } };
const nextSong = (room) => { const np = { dj: "@dj2:hs", song: { videoId: "BBBBBBBBBBB" }, pi: "$p2", startedAt: 0, settings: settings() };
  room.state.nowPlaying = np; room.state.advance = { pi: "$p2", gateLenSec: null, earliestAt: 1e12, ceilingAt: 1e12, skipWarranted: false }; };

// Each act: arm both tabs at t = 0 on one trigger, run the clock, report who sent and when each was armed.
const ACTS = {
  "play.len": (c, tabs) => {
    const room = sharedRoom();
    const onSend = (type, content) => { room.state.advance.gateLenSec = content.sec; };
    return tabs.map(([who, rank, rung]) => {
      const P = featureTab("features/playback.js", c, room, who, rank, rung, onSend).Playback;
      P.initWiring("!ev:hs"); P.setMyRank(rank);
      P.setDurationProvider(() => ({ videoId: VID, seconds: 200 }));
      return () => P.setDuration(VID, 200);
    });
  },
  "advance": (c, tabs) => {
    const room = sharedRoom();
    const onSend = (type) => { if (type === "ddjp.dj.play") { nextSong(room); fanOut(room, "ddjp.dj.play", {}); } };
    return tabs.map(([who, rank, rung]) => {
      const P = featureTab("features/playback.js", c, room, who, rank, rung, onSend).Playback;
      P.initWiring("!ev:hs"); P.setMyRank(rank);
      return () => P.notifyEnded(VID, "$p1");
    });
  },
  "media.len": (c, tabs) => {
    const room = sharedRoom();
    const onSend = (type, content, from) => fanOut(room, "ddjp.media.len", { content, sender: from, senderRank: TOP, l: 5 });
    return tabs.map(([who, rank, rung]) => {
      const M = featureTab("features/medialength.js", c, room, who, rank, rung, onSend).MediaLength;
      M.init("!ev:hs"); M.setMyRank(rank);
      return () => M.recordLocalMeasured(VID, 200);
    });
  },
  "play.blocked": (c, tabs) => {
    const room = sharedRoom();
    const onSend = (type, content, from) => fanOut(room, "ddjp.play.blocked", { content, sender: from, senderRank: TOP });
    return tabs.map(([who, rank, rung]) => {
      const M = featureTab("features/mediablocked.js", c, room, who, rank, rung, onSend).MediaBlocked;
      M.init("!ev:hs"); M.setMyRank(rank);
      return () => M.notifyPlayerError(150, VID);
    });
  },
  "media.skip": (c, tabs) => {
    const room = sharedRoom();
    room.state.advance.skipWarranted = true; room.state.advance.blockedGuestPlus = 3;
    const onSend = (type) => { if (type === "ddjp.media.skip") { nextSong(room); fanOut(room, "ddjp.media.skip", {}); } };
    const mods = tabs.map(([who, rank, rung]) => { const M = featureTab("features/mediablocked.js", c, room, who, rank, rung, onSend).MediaBlocked; M.setMyRank(rank); return M; });
    return mods.map((M) => () => M.init("!ev:hs"));   // the room has derived the road met: entering arms the escape
  },
  "checkpoint:seal": (c, tabs) => {
    const F = require("./_fixtures");
    let live = F.sortLog(F.playingRoom({ songs: 6 }).log);
    return tabs.map(([who, rank, rung]) => {
      const tm = c.timer(who);
      const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
        "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/statederiver.js",
        "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js", "backends/backend1/scheduler.js",
        "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/checkpoint.js"], { Date });
      for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = () => {};
      sb.Session._setPhaseForTest(sb.Session.LIVE);
      sb.Scheduler.attach({ now: () => 1e7 + c.t, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout, random: () => 0 });
      sb.Floor.attach({ log: () => live, settings: () => ({}), myRank: () => rank, trimmed: () => false });
      sb.Checkpoint.attach({ floorTs: () => sb.Floor.anchorTs(), floorPos: () => sb.Floor.position(), now: () => 1e7 + c.t, log: () => live,
        held: () => [], settings: () => ({}), myRank: () => rank, myUserId: () => who, amOwner: () => true, isLegal: () => null,
        holdForWitness: () => ({ hold: false, remainingMs: 0, cycleMs: 0 }), rung: () => rung,
        send: async (t, content) => { c.send(who, t, () => { live = live.concat([F.reducerEvent("$seal-" + who, 999, 1e7 + c.t, who, rank, { t: "ddjp.checkpoint" })]); }); } });
      return () => sb.Checkpoint.planSeal();
    });
  },
  "vouch:proactive": (c, tabs) => {
    const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    const i = src.indexOf("function _scheduleProactiveWitness(");
    let d = 0, j = src.indexOf("{", src.indexOf(")", i)), fnSrc = null;
    for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) { fnSrc = src.slice(i, j + 1); break; } } }
    const DEBOUNCE = Number((src.match(/const _PROACTIVE_DEBOUNCE_MS = (\d+);/) || [])[1]);
    const room = { covered: false };
    return tabs.map(([who, rank, rung]) => {
      const tm = c.timer(who);
      const S = loadInContext(["backends/backend1/ranks.js", "backends/backend1/scheduler.js"], {});
      S.Scheduler.attach({ now: () => c.t, random: () => 0, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout });
      const ctx = { Scheduler: S.Scheduler, console, Math, Date, JSON,
        __rung: () => rung, __owed: () => (room.covered ? { targets: [] } : { targets: ["$e"] }),
        __send: () => c.send(who, "ddjp.vouch.bundle", () => { room.covered = true; }) };
      vm.createContext(ctx);
      vm.runInContext(
        "let _recoveryRoom = '!ev:hs', _holeSeen = false, _proactivePlannedUrgent = false, _proactiveTimer = null;\n" +
        "const _recoveryChannels = {};\nconst _PROACTIVE_DEBOUNCE_MS = " + DEBOUNCE + ";\n" +
        "function getMyRank() { return " + rank + "; }\nfunction _mySettings() { return {}; }\nfunction getUserId() { return '" + who + "'; }\n" +
        "function botRung() { return __rung(); }\nconst Dials = { live: () => 1000 };\nconst Vouch = { owed: () => __owed() };\n" +
        "const Floor = { position: () => 0 };\nfunction _heldHere() { return []; }\nfunction _floorBoundaryId() { return null; }\nfunction _isLegal() { return null; }\n" +
        "function _proactiveWitness() { __send(); }\n" + fnSrc + "\n;globalThis.__w = { schedule: () => _scheduleProactiveWitness() };", ctx);
      return () => ctx.__w.schedule();
    });
  },
};
// Two owner-tier tabs — the creator and the bot, both carrying the owner channel's rank — plus, for the rungs below, a staff tab.
function drive(act, rungs, D) {
  const c = clock(D);
  const tabs = [["@bot:hs", TOP, rungs.bot], ["@owner:hs", TOP, rungs.human], ["@staff:hs", STAFF, rungs.staff]];
  const triggers = ACTS[act](c, tabs);
  for (const go of triggers) go();
  const armed = { bot: c.armed("@bot:hs")[0], human: c.armed("@owner:hs")[0], staff: c.armed("@staff:hs")[0] };
  c.run();
  const by = (w) => c.sent.filter((s) => s.tab === w);
  return { armed, bot: by("@bot:hs"), human: by("@owner:hs"), staff: by("@staff:hs") };
}
const STEP = { "vouch:proactive": 1000, "checkpoint:seal": 5000, "play.len": 1000, "advance": 1000, "media.len": 1000, "play.blocked": 1000, "media.skip": 1000 };
// CHANGED AT `ddjp_628` (the owner's decision), with the reason: the bot's rung reads rank 99, not whether the bot watches, so in a
// shared room whose bot does not watch videos every song change waited a step for nothing. The SONG ACTS take no rung — with a bot
// they plan both owner-tier tabs at today's instant and leave the rungs below where they are. The seal and the vouch pass keep it.
const SONG_ACTS = ["play.len", "advance", "media.len", "play.blocked", "media.skip"];
const WITH_BOT = { bot: readings.bot, human: readings.human, staff: readings.human };
const NO_BOT_R = { bot: readings.none, human: readings.none, staff: readings.none };
const RT = 1130;   // the owner's send-to-accept, `ddjp_626`: SENDING 18:16:48.687, ACCEPTED 18:16:49.818
const report = [];
for (const act of Object.keys(ACTS)) {
  const fast = drive(act, WITH_BOT, 400), none = drive(act, NO_BOT_R, 400), slow = drive(act, WITH_BOT, RT);
  const gap = (fast.armed.human != null && fast.armed.bot != null) ? fast.armed.human - fast.armed.bot : null;
  ok(none.armed.bot === none.armed.human && none.armed.bot != null, "C " + act + ": with NO bot both owner-tier tabs keep today's instant", none.armed);
  ok(none.human.length === 1 && none.bot.length === 1, "C " + act + " CONTROL: with no bot, at that one instant, both owner-tier tabs act — the " +
    "drive sees a human's send, so a silence below is the turn order's and not the harness's", { bot: none.bot, human: none.human });
  if (SONG_ACTS.indexOf(act) >= 0) {
    ok(fast.armed.bot === none.armed.bot && fast.armed.human === none.armed.human, "C " + act + ": a song act takes NO rung — with a bot, " +
      "the bot and the human owner plan today's instant, together", { withBot: fast.armed, noBot: none.armed });
    ok(fast.armed.staff === none.armed.staff, "C " + act + ": and a staff tab is not moved by the bot", { withBot: fast.armed.staff, noBot: none.armed.staff });
    report.push(act + " " + fast.armed.bot + "/" + fast.armed.human + " ms (together)");
    continue;
  }
  ok(fast.armed.bot === none.armed.bot && gap === STEP[act],
    "C " + act + ": with a bot, one trigger arms the bot first, at today's instant, and the human owner exactly one of this act's steps later (" + STEP[act] + " ms)", fast.armed);
  ok(fast.bot.length === 1 && fast.bot[0].at === fast.armed.bot, "C " + act + ": the bot acts, at its slot", { armed: fast.armed, bot: fast.bot });
  ok(fast.human.length === 0, "C " + act + ": the human owner's re-check stays SILENT — the bot's act reached it inside the step", fast.human);
  ok(fast.armed.staff - none.armed.staff === STEP[act], "C " + act + ": a staff tab moves exactly one step, and only because the room has a bot",
    { withBot: fast.armed.staff, noBot: none.armed.staff });
  report.push(act + " " + fast.armed.bot + "→" + fast.armed.human + " ms (gap " + gap + (slow.human.length ? "; at 1.13 s the human also acts)" : "; at 1.13 s the human stays silent)"));
}
console.log("[bot-rung] MEASURED bot / human owner, each act's room defaults, one trigger at 0: " + report.join("; "));

// ── PART D — the rung follows rank changes, a turn already waiting included (`ddjp_628`) ─────────────────────────────────
// The owner deranks and reranks the bot often. The owner's real room: ONE account at 99, the bot. The sequence: the bot at 99,
// demoted to 80, back to 99, demoted to 0. At each step the seal's and the vouch pass's order moves — for a turn planned fresh,
// and for one planned BEFORE the change, whose delay was worked out from the old ranks.
//   THE SEAL: the real bridge (`tests/_botroom.js`), its Scheduler's timers captured; the change is delivered as a sync would
//     (`_onStateEventForTest`, the room's power levels), and the bridge re-arms what is waiting (`Scheduler.rearmAll`).
//   THE VOUCH PASS: the bridge's own `_scheduleProactiveWitness` over the real Scheduler (PART C's world), re-armed the same way.
{
  const admin = B.LEVELS[B.ADMIN], botLvl = B.LEVELS[B.BOT];
  delete B.LEVELS[B.ADMIN];
  try {
    const SEAL_STEP = 5000, FLOOR = 500;
    const RANK_SETTLE_MS = Number((fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8").match(/const RANK_RETRY_DEBOUNCE_MS = (\d+);/) || [])[1]);
    const tabOf = (me) => {
      const w = B.world({ mode: "backend1", me, timers: true });
      w.sb.Scheduler.attach({ random: () => 0 });
      return w;
    };
    const ownerT = tabOf(B.OWNER), botT = tabOf(B.BOT);
    const planned = (w) => { w.sb.Scheduler.cancel("checkpoint:seal"); const r = w.sb.Checkpoint.planSeal(); return r && r.delay; };
    const powerChange = (w, roomId) => {
      const before = new Set(w.timers.live().map((t) => t.id));
      w.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => roomId });
      // the rank's own settle signal is a timer too (`RANK_RETRY_DEBOUNCE_MS`); what is left is the re-armed turn
      const fresh = w.timers.live().filter((t) => !before.has(t.id) && t.kind === "timeout" && t.ms !== RANK_SETTLE_MS);
      return fresh.length ? fresh[fresh.length - 1].ms : null;
    };
    ok(typeof ownerT.sb.Scheduler.rearmAll === "function", "D PREMISE — the Scheduler can re-arm what is waiting");
    const order = [];
    B.LEVELS[B.BOT] = 99;
    const first = { owner: planned(ownerT), bot: planned(botT) };
    ok(first.bot === FLOOR && first.owner === FLOOR + SEAL_STEP, "D0: the bot at 99 — the bot seals first, the human owner one step later", first);
    order.push("99: bot " + first.bot + ", owner " + first.owner);
    for (const [lvl, botFirst] of [[80, false], [99, true], [0, false]]) {
      B.LEVELS[B.BOT] = lvl;
      const re = { owner: powerChange(ownerT, B.SPACE), bot: powerChange(botT, B.SPACE) };   // the turns planned before the change
      const fresh = { owner: planned(ownerT), bot: planned(botT) };
      const want = botFirst ? { bot: FLOOR, owner: FLOOR + SEAL_STEP } : { owner: FLOOR };
      ok(re.owner === want.owner && fresh.owner === want.owner && (botFirst ? (re.bot === want.bot && fresh.bot === want.bot) : (re.bot > re.owner && fresh.bot > fresh.owner)),
        "D: the bot at " + lvl + " — " + (botFirst ? "the bot first again" : "the human owner first, no step reserved for a bot that is gone") +
        ", for a seal planned before the change (re-armed) and one planned after", { reArmed: re, fresh: fresh });
      order.push(lvl + ": bot " + fresh.bot + ", owner " + fresh.owner + " (re-armed: bot " + re.bot + ", owner " + re.owner + ")");
      if (lvl === 80) {
        const said = ownerT.logs.filter((m) => /the room's ranks moved — re-armed/.test(m));
        ok(said.some((m) => m === "info: MatrixBridge: the room's ranks moved — re-armed checkpoint:seal in " + want.owner + "ms"),
          "D: the re-arm says what it moved and its new wait, for a live check to read", said);
      }
    }
    // The control: another room's power levels moving re-arms nothing (counted at the Scheduler, which the bridge calls by name).
    B.LEVELS[B.BOT] = 99;
    planned(ownerT);
    let rearms = 0;
    const r0 = ownerT.sb.Scheduler.rearmAll;
    ownerT.sb.Scheduler.rearmAll = function () { rearms++; return r0.apply(this, arguments); };
    ownerT.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => "!another-room:hs" });
    const other = rearms;
    ownerT.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => B.FULL_CH.events_owner });
    ownerT.sb.Scheduler.rearmAll = r0;
    ok(other === 0 && rearms === 1, "D CONTROL: another room's power levels moving re-arms nothing here; one of this room's channels does",
      { another: other, thisRoomsChannel: rearms - other });
    console.log("[bot-rung] MEASURED the seal across rank changes (ms): " + order.join("; "));

    // The vouch pass, the same sequence: the rung and the bot's channel rank as the real bridge reads them at each step.
    const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    const i = src.indexOf("function _scheduleProactiveWitness(");
    let d = 0, j = src.indexOf("{", src.indexOf(")", i)), fnSrc = null;
    for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) { fnSrc = src.slice(i, j + 1); break; } } }
    const DEBOUNCE = Number((src.match(/const _PROACTIVE_DEBOUNCE_MS = (\d+);/) || [])[1]);
    const vouchTab = (w) => {
      const S = loadInContext(["backends/backend1/ranks.js", "backends/backend1/scheduler.js"], {});
      const timers = [];
      S.Scheduler.attach({ now: () => 0, random: () => 0, setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout: () => {} });
      const ctx = { Scheduler: S.Scheduler, console, Math, Date, JSON, __rung: () => w.sb.MatrixBridge.botRung(), __rank: () => w.sb.MatrixBridge.getMyRank(w.CH) };
      vm.createContext(ctx);
      vm.runInContext(
        "let _recoveryRoom = '!ev:hs', _holeSeen = false, _proactivePlannedUrgent = false, _proactiveTimer = null;\n" +
        "const _recoveryChannels = {};\nconst _PROACTIVE_DEBOUNCE_MS = " + DEBOUNCE + ";\n" +
        "function getMyRank() { return __rank(); }\nfunction _mySettings() { return {}; }\nfunction getUserId() { return 'x'; }\n" +
        "function botRung() { return __rung(); }\nconst Dials = { live: () => 1000 };\nconst Vouch = { owed: () => ({ targets: ['$e'] }) };\n" +
        "const Floor = { position: () => 0 };\nfunction _heldHere() { return []; }\nfunction _floorBoundaryId() { return null; }\nfunction _isLegal() { return null; }\n" +
        "function _proactiveWitness() {}\n" + fnSrc + "\n;globalThis.__w = { schedule: () => _scheduleProactiveWitness() };", ctx);
      return { plan: () => { S.Scheduler.cancel("vouch:proactive"); ctx.__w.schedule(); return timers[timers.length - 1]; },
               rearm: () => { if (S.Scheduler.rearmAll) S.Scheduler.rearmAll(); return timers[timers.length - 1]; } };   // no re-arm: the old delay stands
    };
    const vo = vouchTab(ownerT), vb = vouchTab(botT);
    const VSTEP = 1000, VFLOOR = DEBOUNCE;
    B.LEVELS[B.BOT] = 99;
    const v0 = { owner: vo.plan(), bot: vb.plan() };
    ok(v0.bot === VFLOOR && v0.owner === VFLOOR + VSTEP, "D0 vouch: the bot at 99 — the bot's pass first, the human owner's one step later", v0);
    const vorder = ["99: bot " + v0.bot + ", owner " + v0.owner];
    for (const [lvl, botFirst] of [[80, false], [99, true], [0, false]]) {
      B.LEVELS[B.BOT] = lvl;
      const re = { owner: vo.rearm(), bot: vb.rearm() };
      const fresh = { owner: vo.plan(), bot: vb.plan() };
      const ordered = botFirst ? (re.bot === VFLOOR && re.owner === VFLOOR + VSTEP && fresh.bot === VFLOOR && fresh.owner === VFLOOR + VSTEP)
                               : (re.owner === VFLOOR && fresh.owner === VFLOOR && re.bot > re.owner && fresh.bot > fresh.owner);
      ok(ordered, "D vouch: the bot at " + lvl + " — " + (botFirst ? "the bot's pass first again" : "the human owner's first") +
        ", re-armed and planned afresh", { reArmed: re, fresh: fresh });
      vorder.push(lvl + ": bot " + fresh.bot + ", owner " + fresh.owner);
    }
    console.log("[bot-rung] MEASURED the vouch pass across rank changes (ms): " + vorder.join("; "));

    // D TIMING — THE OLD TIMER IS GONE, NOT ONLY OUTWAITED (`ddjp_629`, a gap the supervisor planted). The rows above read only the
    // NEW delays, and their Scheduler's clearTimeout did nothing, so a re-arm that left the old timer running stayed green. It is not
    // harmless: `_fire` has no "too early" check, so the leftover timer runs the re-armed turn at its OLD moment. Driven on a real
    // clock: the human owner's pass waits 4 s with no bot; the bot is promoted at 1 s; the clock runs past the old 4 s moment, and
    // nothing may act before the new turn (1 s + 5 s).
    {
      const S = loadInContext(["backends/backend1/ranks.js", "backends/backend1/scheduler.js"], {});
      let now = 0, seq = 0;
      const live = new Map(), acted = [];
      S.Scheduler.attach({ now: () => now, random: () => 0,
        setTimeout: (fn, ms) => { const id = ++seq; live.set(id, { at: now + (ms || 0), fn }); return id; },
        clearTimeout: (id) => { live.delete(id); } });
      const runTo = (t) => {
        for (;;) {
          const due = Array.from(live.entries()).filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          live.delete(due[0]); now = due[1].at; due[1].fn();
        }
        now = t;
      };
      let rung = NO_BOT;
      const ctx = { Scheduler: S.Scheduler, console, Math, Date, JSON, __rung: () => rung, __acted: () => acted.push(now) };
      vm.createContext(ctx);
      vm.runInContext(
        "let _recoveryRoom = '!ev:hs', _holeSeen = false, _proactivePlannedUrgent = false, _proactiveTimer = null;\n" +
        "const _recoveryChannels = {};\nconst _PROACTIVE_DEBOUNCE_MS = " + DEBOUNCE + ";\n" +
        "function getMyRank() { return " + TOP + "; }\nfunction _mySettings() { return {}; }\nfunction getUserId() { return 'x'; }\n" +
        "function botRung() { return __rung(); }\nconst Dials = { live: () => 1000 };\nconst Vouch = { owed: () => ({ targets: ['$e'] }) };\n" +
        "const Floor = { position: () => 0 };\nfunction _heldHere() { return []; }\nfunction _floorBoundaryId() { return null; }\nfunction _isLegal() { return null; }\n" +
        "function _proactiveWitness() { __acted(); }\n" + fnSrc + "\n;globalThis.__w = { schedule: () => _scheduleProactiveWitness() };", ctx);
      ctx.__w.schedule();                                      // the human owner, no bot: 4000 ms
      runTo(1000);
      rung = HUMAN_RUNG;                                       // the bot promoted to 99 while the pass waits
      if (S.Scheduler.rearmAll) S.Scheduler.rearmAll();
      runTo(1000 + VFLOOR + VSTEP - 1);                        // past the old moment (4000), short of the new one (6000)
      const early = acted.slice();
      runTo(1000 + VFLOOR + VSTEP);
      ok(early.length === 0 && acted.length === 1 && acted[0] === 1000 + VFLOOR + VSTEP,
        "D TIMING: a re-armed turn does not act at its OLD moment — the clock runs past it and nothing fires before the new turn " +
        "(the bot promoted at 1 s: the human owner's pass at " + (1000 + VFLOOR + VSTEP) + " ms, not " + VFLOOR + ")", { early, acted });
    }
  } finally { B.LEVELS[B.ADMIN] = admin; B.LEVELS[B.BOT] = botLvl; }
}

// ── PART E — the seal's dueness ladder in a quiet room (`ddjp_628`, a gap the supervisor planted) ─────────────────────────
// In a quiet room the only trigger is each tab's cadence tick, and `Checkpoint.maySeal` holds a rank until the room has been due
// for its own slot's worth of time (`ladderMs`). With the bot's rung, the human owner is not due until one seal step after the
// bot; with no bot, both are due together. Replacing the rung there with nothing left the whole suite green.
{
  const F = require("./_fixtures");
  const LOG = F.sortLog(F.playingRoom({ songs: 6 }).log);
  const newest = Math.max(...LOG.map((e) => e.ts || 0));
  const cpTab = (rung) => {
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/statederiver.js",
      "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js", "backends/backend1/scheduler.js",
      "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/checkpoint.js"], { Date });
    for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = () => {};
    sb.Session._setPhaseForTest(sb.Session.LIVE);
    return { sb, at: (sinceFloor) => {
      sb.Checkpoint.attach({ floorTs: () => newest - sinceFloor, floorPos: () => LOG.length - 2, now: () => 1e13, log: () => LOG, held: () => [],
        settings: () => ({}), myRank: () => TOP, myUserId: () => "@x:hs", amOwner: () => true, isLegal: () => null,
        holdForWitness: () => ({ hold: false }), send: async () => {}, rung: () => rung });
      const v = sb.Checkpoint.maySeal(1e13);
      return { ok: v.ok, reason: v.reason || null };
    } };
  };
  const bot = cpTab(BOT_RUNG), human = cpTab(HUMAN_RUNG), solo = cpTab(NO_BOT);
  const cooldown = bot.sb.Dials.live({}, "checkpointCooldownMs"), step = bot.sb.Dials.live({}, "checkpointRankOffsetMs");
  const atDue = { bot: bot.at(cooldown), human: human.at(cooldown), solo: solo.at(cooldown) };
  ok(atDue.bot.ok === true && atDue.human.ok === false && atDue.human.reason === "not-due",
    "E1: in a quiet room with a bot, when the room comes due the bot is due and the human owner is not", atDue);
  const almost = human.at(cooldown + step - 1), then = human.at(cooldown + step);
  ok(almost.ok === false && then.ok === true, "E2: the human owner comes due exactly one seal step (" + step + " ms) after the bot", { almost, then });
  ok(atDue.solo.ok === true, "E3: with no bot the owner is due when the room is — no step reserved", atDue.solo);
}

if (failed) { console.log("[bot-rung] " + failed + " failure(s)"); process.exit(1); }
console.log("[bot-rung] PASS — in a room with a bot the bot takes its own turn first and the human owner one step later for the seal " +
  "and the vouch pass, the human's re-check silent when the bot's act reaches it inside the step; the five song acts take no rung; a " +
  "room with no bot keeps today's slots; the order follows rank changes, a turn already waiting included; and in a quiet room the " +
  "human owner comes due one seal step after the bot (" + asserts + " assertions)");
