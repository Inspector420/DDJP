// tests/check-rank-trust.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, features/actions.js, features/roomupgrade.js, ui/roster.js, ui/base.js, ui/chat.js, ui/player.js, index.html
// WALL: RANKS YOU CAN TRUST (the owner's plan, part 1; his "1 yes", `main/05-matrix.md` §Ranks you can trust). A person whose
//   level is not the same in every room a rank change sets it in is OUT OF STEP: the room says so (`Room.rankStanding`, the one
//   rule), a thin red ring marks their picture wherever it shows, and their card says what each room says and repairs it —
//   to the level set LAST, by the server time of the power-levels event that set it — paced, one at a time, within the minute.
//   Driven in BOTH room types through the REAL bridge, room and adapter over a model homeserver (`tests/_inviteworld.js`) whose
//   power-levels events carry what a server sends: a server time, what each replaced (`unsigned.prev_content`, and
//   `replaces_state`), the current one in the room's state and the ones a live sync delivered in its timeline; each room's
//   creation record carries the server time it was made.
//   PART A — the rule: in step; a half-done promotion and a half-done demotion each name the newest level; a tie goes to the
//            Space; creators, the presence chat where this account is not in it, and channels not yet created are never out of
//            step; a level set at a time this device cannot place gives no target — an event that does not carry what it
//            replaced is the room's first only when sent with its creation record; a channel an upgrade made after the person's
//            rank was set (it never named them) is not out of step, one the change missed is; the rooms read are a change's;
//            and it is cheap where it can be — no timeline read for a person in step, none walked again (counted);
//            and it is read from the rooms' state — a fresh client (a reload) reads the same, a set still in the loaded
//            timeline is found, and after a reload that same room cannot tell.
//   PART B — the ring, drawn by the real ui/ code (`tests/_screen-world.js`) from the real rule: People rows, chat rows, the
//            player's line, and this account's own picture in the header — on the person out of step and on nobody else; the
//            page's sheet rings the picture INSIDE the wrapper (its declared outline, the app's red), and the wrapper gains no
//            style of its own. Read a minute and a second after the split, in server time (`ddjp_693`: PART F's wait).
//   PART C — the card (the real card, picker, room and adapter, `tests/_probe-j14-card.js`): its line from the facts; "Repair to
//            <rank>" behind the lock; anyone who may not is told which rank may — "<Rank>+ can repair it.", "Owner can repair
//            it." for Bot, worked out here from the rule as the docs state it; with nobody present who could, still the rank,
//            and where nobody may now, nothing (`ddjp_693`; it replaced names); Bot: the owner only, and "Bot already assigned"
//            while another account holds it; where this device cannot tell, each level offered; a repair says "Repairing
//            <name>'s rank… N of M" over a bar, then the ring is gone; one that stops says where and offers Repair again.
//   PART D — an ordinary rank change's progress shows the same bar.
//   PART E — the pacer: at least a second between sends, wider after a push-back, easing back after a send lands; a change
//            still stops at the minute, naming what is left; a step confirmed is never sent again.
//   PART F — the ring waits (`ddjp_693`, the owner's "ok"): out of step for longer than a rank change may take (the bridge's
//            `RANK_LIMIT_MS`), in SERVER time — the newest level change against `ServerClock.serverNow` — so a fresh split rings
//            nothing and one past the minute rings; never the device's clock (set an hour either side); a waiting ring sets one
//            timer and is drawn when it fires, with no event; a tab whose own change for the person runs shows its progress and
//            no ring, the screen told as it starts; one that stopped is the rule again.
//   PART G — the card's own picture (`ddjp_693`): the same ring, drawn, in a wrapper that draws no box; none in step or fresh.
//   PART H — Bot only after the room's last upgrade (`ddjp_693`): before it the picker shows "Bot — upgrade the room first",
//            locked, `Room.assignRank` and the adapter refuse it as upgrade-first naming the last batch's channels, nothing sent,
//            and Repair to Bot is shown locked in the same words; after it, offered and it lands; a room built in one piece as
//            today.
//   PART I — an upgrade gives a bot already there its level in the new channels (`ddjp_693`): one level step each, the bot's
//            only, paced, with progress, the success logged; a refusal named as a rank step's; no bot, nothing sent; a change
//            running on this tab, nothing sent and said; and the wiring — `RoomUpgrade.upgrade` asks it after the batch is the
//            room's and marked, through the room's one rank turn (`ddjp_694`), its progress on the bar ("Bot's level") and its wait
//            for a change ("Waiting — a rank change for … is running"), its answer back — and the bar names what did not land.
//   PART J — the room's bot holds its level in every channel (`ddjp_694`): a bot appointed before the room's last upgrade,
//            missing one late channel's level, is out of step (every channel a change sets counts for it), its target Bot, the
//            ring after the minute, People drawing it; the card's line, "Repair to Bot" for the owner only ("Owner can repair
//            it."); the repair the rank change itself, the one missing level sent, progress, done; several late channels paced, a
//            refusal named; after a reload with its set unplaceable, still Bot. A Staff member in the same room, their set one
//            this device can place (decision 2's own case), is never rung.
//   PART K — a rank change and an upgrade's bot step go one at a time (`ddjp_694`): the step running, a change is refused by name
//            and every picker waits, saying "Waiting — the room is upgrading"; a change running, the upgrade waits, says so,
//            keeps its turn, then runs; the leave stops a running step, and stops both while the step waits.
//   PART L — every channel counts, for everyone (`ddjp_695`, JOB 1): 694's two reload cases for the Staff member ranked before
//            the room's last upgrade — the upgrade after the last change, and a change for someone else after the upgrade — read
//            out of step with Staff the target (694: Uncategorized, and no target), the card's one "Repair to Staff", and the
//            repair sends the late channel's level alone. (`ddjp_695` also changed A's late-channel rows, I's wiring and J's
//            Staff rows on purpose; each says so where it stands.)
// RED FIRST ON 691: there `rankStanding`, `rankReadings`, the ring and the card's repair do not exist, and nothing paces a
// send — each part asserts its premise by name, so an absent subject reads red, never green by silence. ON 692 (`ddjp_693`):
// C's rank wording and PARTs F–I are red there; the rest green, as they should be. ON 693 (`ddjp_694`): J's bot rows, K and I's
// wiring are red there; J's Staff controls green, as they should be. ON 694 (`ddjp_695`): L's Staff rows, A's late channel, I's
// wiring and J's Staff rows are red there; the rest green, as they should be.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const P = require(path.join(__dirname, "_probe-j14-card.js"));
const S = require(path.join(__dirname, "_screen-world.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[rank-trust] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }

const ME = W.ME, OWNER = W.OWNER, THEM = "@them:hs", OTHER = "@other:hs", BOT = "@bot:hs";
const lv = (name) => P.Ranks.levelOf(name);
const STAFF = lv("staff"), PLAYER = lv("player"), GUEST = lv("guest"), TOP = lv("owner");
const LABEL = (l) => { if (l > TOP) return "Owner"; if (l === TOP) return "Bot"; const r = P.Ranks.LADDER.find((x) => x.level === l); return r ? (r.label || r.name) : String(l); };
// THE RANK THAT MAY REPAIR IT (`ddjp_693`), worked out HERE from the rank change's rule as `main/05-matrix.md` §Ranks & power
// levels states it — Staff+ only, strictly above the person's highest level, and strictly above the level given — over the
// ladder's own rungs, not from the rule under test; where no rung may, the owner, who stands above the ladder.
const RUNGS_UP = P.Ranks.LADDER.map((r) => r.level).sort((a, b) => a - b);
const giverText = (eff, lvl) => { const r = RUNGS_UP.find((l) => l >= STAFF && l > eff && l > lvl); return r === undefined ? "Owner can repair it." : LABEL(r) + "+ can repair it."; };
const MODES = [["backend1", "shared room"], ["backend2", "bot room"]];
const T0 = 1.9e12;   // the server time the rooms were made at
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
const cap = (p, ms) => Promise.race([Promise.resolve(p).then((v) => ({ v }), (e) => ({ threw: (e && e.message) || String(e) })),
  new Promise((r) => setTimeout(() => r({ timedOut: true }), ms || 6000))]);
const e429 = (ms) => Object.assign(new Error("Too Many Requests"), { errcode: "M_LIMIT_EXCEEDED", httpStatus: 429, data: { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: ms } });
const e403 = (msg) => Object.assign(new Error(msg || "Forbidden"), { errcode: "M_FORBIDDEN", httpStatus: 403, data: { errcode: "M_FORBIDDEN", error: msg || "Forbidden" } });

// ── THE WORLD ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `check-rank-change`'s rank world (one DDJP room, this account at 100, two people at 0; a send applied a few turns after it is
// answered and delivered as the sync's state event; a virtual clock for the change's sleeps and its minute — and here its
// `now` too, so the pacer reads it), with POWER-LEVELS EVENTS AS A SERVER SENDS THEM: each room's current one carries its
// server time, its id, and what it replaced (`unsigned.prev_content`, `replaces_state`); a room's first carries neither; a send
// that lands makes a new one, stamped at the server's time now, and a live sync puts it in the room's timeline as well.
// `o.reload: x` builds a second client over the same homeserver — the state as it stands, an EMPTY timeline (a reload's sync
// brings the current state only) — as a page would after a reload.
function rankWorld(mode, o) {
  o = o || {};
  const prior = o.reload || null;
  const hs = prior ? prior.hs : W.homeserver();
  const sends = [], clock = { t: 0, sleeps: [], cut: null };
  let gate = null, wref = null, n = 0;
  const script = { fn: o.script || null };
  const LAG = 3;
  const meta = prior ? prior.meta : Object.create(null);   // room id -> its current power-levels event: { eid, ts, prev, prevId }
  const timeline = Object.create(null);                    // room id -> the power-levels events a live sync delivered
  const made = prior ? prior.made : Object.create(null);   // room id -> when it was made, where not T0 (a channel an upgrade made later)
  const counts = { timelineReads: 0 };                     // how often a room's loaded timeline was asked for (the cost, PART A)
  const serverNow = () => T0 + 100000 + clock.t;
  const evOf = (rid, m, content) => ({
    getType: () => "m.room.power_levels", getStateKey: () => "", getId: () => m.eid, getTs: () => m.ts, getContent: () => content,
    getSender: () => ME, getRoomId: () => rid, getPrevContent: () => m.prev || {},
    getUnsigned: () => { const u = {}; if (m.prev) u.prev_content = m.prev; if (m.prevId) u.replaces_state = m.prevId; return u; },
  });
  // A new power-levels event in `rid`: as a send landing, or as a guard sets a room's history up.
  const setPL = (rid, content, at, opt) => {
    const p = opt || {};
    const old = meta[rid] || (meta[rid] = { eid: "$pl-first-" + rid, ts: T0 });   // before any, the room's first (its creation's)
    const m = { eid: "$pl-" + (++n) + "-" + rid, ts: at, prev: p.noPrev ? undefined : (p.prev !== undefined ? p.prev : (old ? JSON.parse(JSON.stringify(hs.rooms[rid].power)) : undefined)),
      prevId: p.prevId !== undefined ? p.prevId : (old ? old.eid : undefined) };
    hs.rooms[rid].power = JSON.parse(JSON.stringify(content));
    meta[rid] = m;
    if (p.live !== false) (timeline[rid] = timeline[rid] || []).push(evOf(rid, m, JSON.parse(JSON.stringify(content))));
    return m;
  };
  const userOf = (rid, content) => { const now = (hs.rooms[rid] && hs.rooms[rid].power.users) || {}; const u = (content && content.users) || {};
    return Object.keys(u).find((k) => now[k] !== u[k]) || null; };
  async function serve(kind, roomId, userId, content) {
    const k = sends.filter((s) => s.kind === kind && s.roomId === roomId && s.userId === userId).length + 1;
    const s = { kind, roomId, userId, n: k, at: clock.t };
    sends.push(s);
    if (gate) await gate.p;
    if (!hs.rooms[roomId] || hs.rooms[roomId].members[ME] !== "join") throw e403("User " + ME + " not in room " + roomId);
    const a = (script.fn && script.fn(s)) || {};
    if (a.hang) return new Promise(() => {});
    const apply = () => {
      if (a.lost || !hs.rooms[roomId]) return;
      if (kind === "level") { setPL(roomId, content, serverNow()); if (wref) wref.state(roomId, "m.room.power_levels", "", hs.rooms[roomId].power, ME); }
      else if (kind === "in") { if (hs.rooms[roomId].members[userId] !== "join") hs.invite(roomId, userId, { from: ME }); }
      else hs.rooms[roomId].members[userId] = "leave";
    };
    if (a.error) { if (a.applied) turns(a.lag || LAG).then(apply); throw a.error; }
    turns(a.lag || LAG).then(apply);
    return {};
  }
  // The client: the invite world's own views (membership, creation record, members), with each room's power levels and live
  // timeline as above.
  const base = W.clientFor(hs, ME);
  const wraps = Object.create(null);
  const wrap = (id, v) => {
    if (wraps[id] && wraps[id].__v === v) return wraps[id];
    const r = Object.create(v);
    r.__v = v;
    r.currentState = { getStateEvents: (type, key) => {
      if (type === "m.room.create") {   // the creation record, at the server time the room was made (`made`, T0 unless set)
        const c = v.currentState.getStateEvents(type, key);
        const at = (typeof made[id] === "number") ? made[id] : T0;
        const one = (e) => (e ? Object.assign({}, e, { getTs: () => at }) : e);
        return Array.isArray(c) ? c.map(one) : one(c);
      }
      if (type !== "m.room.power_levels") return v.currentState.getStateEvents(type, key);
      const real = v.currentState.getStateEvents(type, key);   // the invite world's answer decides whether there is one to see
      if (!real || (Array.isArray(real) && !real.length)) return real;
      const m = meta[id] || (meta[id] = { eid: "$pl-first-" + id, ts: T0 });
      const e = evOf(id, m, hs.rooms[id].power);
      return (key !== undefined) ? e : [e];
    } };
    r.getLiveTimeline = () => ({ getEvents: () => { counts.timelineReads++; return (timeline[id] || []).slice(); } });
    wraps[id] = r;
    return r;
  };
  const client = {
    getRoom: (id) => { const v = base.client.getRoom(id); return v ? wrap(id, v) : null; },
    sendStateEvent: (rid, type, content) => (type === "m.room.power_levels" ? serve("level", rid, userOf(rid, content), content) : Promise.resolve({})),
    invite: (rid, u) => serve("in", rid, u),
    kick: (rid, u) => serve("out", rid, u),
  };
  const w = W.inviteWorld({ hs, client });
  wref = w;
  // THE ROOM'S SERVER CLOCK (`ddjp_693`: the ring waits for a rank change's minute, measured in server time): the route the
  // app reads, `ServerClock.serverNow` — the server's time now, unless a row moves it (`server.at`). The device's own clock
  // (`Date.now`) is never this; PART F sets the two apart.
  const server = { at: null };
  w.sb.ServerClock = { serverNow: () => (server.at !== null ? server.at : serverNow()) };
  // `o.upTo: n` — a room upgraded through batch n only (`ddjp_693`, PART H): the later batches' channels do not exist at all.
  const plan = (w.sb.Backends.planFor(mode) || []);
  const keys = plan.filter((r) => !(typeof o.upTo === "number" && r.batch > o.upTo)).map((r) => r.key);
  const sid = "!rt-" + mode + ":hs";
  let R;
  if (prior) R = { ch: prior.ch };
  else {
    R = hs.ddjpRoom(sid, { mode, keys });
    const ids = [sid].concat(Object.values(R.ch));
    const levels = Object.assign({ [ME]: 100 }, o.levels || {});
    for (const id of ids) { hs.rooms[id].power = { users: Object.assign({}, levels), users_default: 0 }; hs.rooms[id].members[ME] = "join"; }
    for (const u of [THEM, OTHER, BOT]) {
      hs.rooms[sid].members[u] = "join";
      for (const k of keys) if ((!/^chat_/.test(k) && !/presence/.test(k)) || k === "chat_uncategorized") hs.rooms[R.ch[k]].members[u] = "join";
    }
    if (o.setup) o.setup(hs, R, sid, setPL, made);
  }
  const sleep = async (ms) => { clock.sleeps.push(ms); clock.t += ms; if (clock.cut && clock.cut.at <= clock.t) { const f = clock.cut.fn; clock.cut = null; f(); } await turns(1); };
  const later = (fn, ms) => { clock.cut = { fn, at: clock.t + ms }; return clock.cut; };
  const unlater = (h) => { if (clock.cut === h) clock.cut = null; };
  const seam = typeof w.MB._setRankClockForTest === "function";
  if (seam) w.MB._setRankClockForTest(sleep, later, unlater, () => clock.t);
  const channels = Object.assign({}, R.ch);
  for (const k of (o.drop || [])) delete channels[k];   // a channel the room has not created yet: not in its map
  w.Room._enterForTest({ name: "Rank room", spaceId: sid, channels }, mode);
  const jobs = [];
  if (typeof w.Room.onRankJob === "function") w.Room.onRankJob((j) => jobs.push(j ? JSON.parse(JSON.stringify(j)) : null));
  const standing = (u) => (typeof w.Room.rankStanding === "function" ? w.Room.rankStanding(u) : undefined);
  return {
    w, hs, sid, ch: R.ch, keys, plan, sends, clock, script, jobs, seam, mode, meta, timeline, made, counts, setPL, serverNow, standing, server,
    hold() { let r; gate = { p: new Promise((x) => { r = x; }) }; gate.r = r; },
    release() { const g = gate; gate = null; if (g) g.r(); },
    level(u, k) { const id = k ? R.ch[k] : sid; const p = hs.rooms[id].power; return (p.users && p.users[u] !== undefined) ? p.users[u] : p.users_default; },
    sentTo(kind, k, u) { const id = k === "space" ? sid : R.ch[k]; return sends.filter((s) => s.kind === kind && s.roomId === id && (u === undefined || s.userId === u)).length; },
    line(re, from) { return w.logs.slice(from || 0).filter((m) => re.test(m)); },
    async settle(k) { await turns(k || 20); },
  };
}
// THE ROOMS A CHANGE SETS A LEVEL IN, counted from the plan's own rows (not from the rule under test): the Space and every
// channel in the room's map, the presence chat only where this account is in it.
const levelRooms = (x, channels) => 1 + Object.keys(channels || x.ch).filter((k) => !/presence/.test(k) || x.hs.rooms[x.ch[k]].members[ME] === "join").length;
// The channel keys in the order a change sends them (its level steps), and the last two of them.
const lastTwo = (x) => { const ks = Object.keys(x.ch).filter((k) => x.ch[k]); return ks.slice(-2); };
const refuseLevelsIn = (x, ks) => (s) => (s.kind === "level" && ks.some((k) => x.ch[k] === s.roomId) ? { error: e403("You don't have permission") } : null);

(async () => {
  // ═══ PART A — THE RULE ═════════════════════════════════════════════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    ok(typeof x.w.Room.rankStanding === "function" && typeof x.w.MB.rankReadings === "function",
      "A " + name + ": APPLIED — the room's one rule (`Room.rankStanding`) and the bridge's readings (`MatrixBridge.rankReadings`) exist");
    if (typeof x.w.Room.rankStanding !== "function" || typeof x.w.MB.rankReadings !== "function") continue;
    const s0 = x.standing(THEM);
    ok(s0 && s0.outOfStep === false && s0.space === 0, "A " + name + ": IN STEP — the same level everywhere is not out of step", s0);
    const rd = x.w.MB.rankReadings(x.sid, x.ch, THEM);
    ok(Array.isArray(rd) && rd.length === levelRooms(x) && rd[0].key === "space",
      "A " + name + ": THE ROOMS READ ARE THE ROOMS A CHANGE SETS — the Space first, then every channel (" + levelRooms(x) + ")", rd && rd.map((r) => r.key));
    // A HALF-DONE PROMOTION: the change stops with two channels refused; they keep the old level, the rest have the new one.
    const two = lastTwo(x);
    x.script.fn = refuseLevelsIn(x, two);
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    ok(r.v && r.v.ok === false && two.every((k) => x.level(THEM, k) === 0) && x.level(THEM) === STAFF,
      "A " + name + ": PREMISE — a promotion to " + LABEL(STAFF) + " stopped half-done: the Space at " + STAFF + ", two channels left at 0", { r: r.v, two: two.map((k) => x.level(THEM, k)) });
    const s1 = x.standing(THEM);
    // CHANGED ON PURPOSE AT `ddjp_695`: no room named them before, so the two the change missed hold the default and never
    // named them — the target is read from the rooms that do, which agree (`by: "named"`; it was the newest set, the same level).
    ok(s1 && s1.outOfStep === true && s1.space === STAFF && s1.target === STAFF && s1.by === "named",
      "A " + name + ": A HALF-DONE PROMOTION IS OUT OF STEP, AND ITS REPAIR TARGET IS THE LEVEL THE ROOMS NAMING THEM AGREE ON — " + LABEL(STAFF), s1);
    ok(s1 && s1.channels === levelRooms(x) - 1 && JSON.stringify(s1.byLevel) === JSON.stringify([{ level: STAFF, n: levelRooms(x) - 3 }, { level: 0, n: 2 }]),
      "A " + name + ": and it says what each room says — the channels by level", s1 && { channels: s1.channels, byLevel: s1.byLevel });
    ok(s1 && s1.effective === STAFF, "A " + name + ": and the level the rank gates read (the highest) rides with it", s1 && s1.effective);
    const so = x.standing(OTHER);
    ok(so && so.outOfStep === false, "A " + name + ": CONTROL — the other person, untouched, is in step", so);
    // CHEAP WHERE IT CAN BE (a count, not a stopwatch — the fifty-eighth signature): every picture asks, on every power-levels
    // event, and an events channel's loaded timeline is its whole history. A person in step reads no timeline at all; a
    // reading asked again over unchanged rooms walks none again (one look per room, to see that nothing changed).
    x.counts.timelineReads = 0; x.standing(OTHER);
    ok(x.counts.timelineReads === 0, "A " + name + ": CHEAP — A PERSON IN STEP: NO ROOM'S TIMELINE IS READ", x.counts.timelineReads);
    x.counts.timelineReads = 0; x.standing(THEM);
    const again = x.counts.timelineReads;
    ok(again === levelRooms(x), "A " + name + ": CHEAP — THE SAME READING ASKED AGAIN WALKS NO TIMELINE AGAIN — one look per room (" + levelRooms(x) + ")", again);
    // THE SAME, AFTER A RELOAD: a fresh client over the same homeserver, state only.
    const y = rankWorld(mode, { reload: x });
    const s2 = y.standing(THEM);
    ok(s2 && s2.outOfStep === true && s2.target === STAFF && s2.by === "named",
      "A " + name + ": A RELOAD LOSES NOTHING — read from the rooms' state, the same answer on a fresh client", s2);
  }
  for (const [mode, name] of MODES) {
    // A HALF-DONE DEMOTION: at Staff since the rooms were made; a demotion to 0 stops with two channels refused.
    const x = rankWorld(mode, { levels: { [THEM]: STAFF }, setup: (hs, R) => { hs.rooms[R.ch.chat_guest].members[THEM] = "join"; hs.rooms[R.ch.chat_staff].members[THEM] = "join"; } });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "A " + name + ": APPLIED — `Room.rankStanding` (demotion)"); continue; }
    const two = lastTwo(x);
    x.script.fn = refuseLevelsIn(x, two);
    await cap(x.w.Room.assignRank(THEM, 0));
    await x.settle(20);
    ok(two.every((k) => x.level(THEM, k) === STAFF) && x.level(THEM) === 0, "A " + name + ": PREMISE — a demotion stopped half-done: the Space at 0, two channels still " + LABEL(STAFF));
    const s = x.standing(THEM);
    ok(s && s.outOfStep === true && s.target === 0 && s.by === "newest",
      "A " + name + ": A HALF-DONE DEMOTION'S REPAIR TARGET IS THE NEWEST LEVEL — 0, not the " + LABEL(STAFF) + " left behind", s);
  }
  for (const [mode, name] of MODES) {
    // A TIE: the Space and one channel set at the same server time to different levels.
    const x = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      setPL(sid, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000);
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 5000);
    } });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "A " + name + ": APPLIED — `Room.rankStanding` (tie)"); continue; }
    const s = x.standing(THEM);
    ok(s && s.outOfStep === true && s.target === GUEST && s.by === "tie", "A " + name + ": A TIE GOES TO THE SPACE'S LEVEL — " + LABEL(GUEST), s);
    const c = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      setPL(sid, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000);
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 5001);
    } });
    const sc = c.standing(THEM);
    ok(sc && sc.target === PLAYER && sc.by === "newest", "A " + name + ": CONTROL — a millisecond later is no tie: the channel's " + LABEL(PLAYER), sc);
  }
  for (const [mode, name] of MODES) {
    // NEVER OUT OF STEP: a creator; the presence chat where this account is not in it; a channel not created yet.
    const x = rankWorld(mode, { setup: (hs, R) => { hs.rooms[R.ch.events_uncategorized].power.users[OWNER] = 50; hs.rooms[R.ch.chat_uncategorized].power.users[OWNER] = 20; } });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "A " + name + ": APPLIED — `Room.rankStanding` (never)"); continue; }
    const so = x.standing(OWNER);
    ok(so && so.outOfStep === false && x.w.MB.rankReadings(x.sid, x.ch, OWNER).length === 0,
      "A " + name + ": A CREATOR IS NEVER OUT OF STEP — 100 by the server's rule, in no power list, not read at all", so);
    const p = rankWorld(mode, { setup: (hs, R) => { delete hs.rooms[R.ch.presence_chat].members[ME]; hs.rooms[R.ch.presence_chat].power.users[THEM] = STAFF; } });
    const sp = p.standing(THEM);
    ok(sp && sp.outOfStep === false, "A " + name + ": THE PRESENCE CHAT WHERE THIS ACCOUNT IS NOT IN IT (the bot's room) is never read, so never out of step", sp);
    const pc = rankWorld(mode, { setup: (hs, R) => { hs.rooms[R.ch.presence_chat].power.users[THEM] = STAFF; } });
    const spc = pc.standing(THEM);
    ok(spc && spc.outOfStep === true, "A " + name + ": CONTROL — with this account in it, the same split is read (the change sets it there)", spc);
    const d = rankWorld(mode, { drop: ["chat_staff"], setup: (hs, R) => { hs.rooms[R.ch.chat_staff].power.users[THEM] = STAFF; } });
    const sd = d.standing(THEM);
    ok(sd && sd.outOfStep === false, "A " + name + ": A CHANNEL NOT CREATED YET (not in the room's map) is never out of step", sd);
    // A ROOM THIS ACCOUNT LEFT: the SDK still holds it (`ddjp_652`), its state as of leaving — not a reading of now.
    const l = rankWorld(mode, { setup: (hs, R) => { hs.rooms[R.ch.chat_uncategorized].members[ME] = "leave"; hs.rooms[R.ch.chat_uncategorized].power.users[THEM] = STAFF; } });
    ok(l.w.client.getRoom(l.ch.chat_uncategorized) && l.w.client.getRoom(l.ch.chat_uncategorized).getMyMembership() === "leave",
      "A " + name + ": PREMISE — a room this account left, still held as the SDK holds it");
    const sl = l.standing(THEM);
    ok(sl && sl.outOfStep === false, "A " + name + ": A ROOM THIS ACCOUNT LEFT IS NOT READ — its state as of leaving says nothing now", sl);
  }
  for (const [mode, name] of MODES) {
    // CANNOT TELL: the newest event in one room replaced one this client was not sent (no `prev_content`).
    const x = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 9000, { noPrev: true, prevId: "$unseen", live: false });
    } });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "A " + name + ": APPLIED — `Room.rankStanding` (cannot tell)"); continue; }
    const s = x.standing(THEM);
    ok(s && s.outOfStep === true && s.target === null && s.by === "unknown",
      "A " + name + ": A LEVEL SET AT A TIME THIS DEVICE CANNOT PLACE AFTER THE NEWEST — no target: it does not assume", s);
    const c = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 9000, { live: false });
    } });
    const sc = c.standing(THEM);
    ok(sc && sc.target === PLAYER && sc.by === "newest", "A " + name + ": CONTROL — the same event carrying what it replaced is placed: the newest, " + LABEL(PLAYER), sc);
    // HELD IN THE TIMELINE, AND NOT AFTER A RELOAD: a later change for someone else rewrote the channel, keeping THEM's level;
    // the set itself is still in the loaded timeline — found — and after a reload only the later event is held, which says
    // nothing about THEM: then this device cannot tell.
    const t = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 9000);
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER, [OTHER]: GUEST }, users_default: 0 }, T0 + 9500);
    } });
    const st = t.standing(THEM);
    ok(st && st.target === PLAYER && st.by === "newest", "A " + name + ": A SET STILL IN THE LOADED TIMELINE IS FOUND — under a later change for someone else", st);
    // A LATER CHANGE FOR SOMEONE ELSE IS NOT A SET FOR THEM: a half-done promotion left one channel at the old level, and a
    // change for another person then rewrote that channel, carrying THEM's old level along. Its time is not THEM's set time.
    const z = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch)).filter((i) => i !== R.ch.events_uncategorized)) setPL(id, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: 0, [OTHER]: GUEST }, users_default: 0 }, T0 + 9000, { live: false });
    } });
    const sz = z.standing(THEM);
    ok(sz && sz.outOfStep === true && sz.target !== 0 && sz.by === "unknown",
      "A " + name + ": A LATER CHANGE FOR SOMEONE ELSE IS NOT A SET FOR THEM — its time is not taken as theirs, so the old level is not named; this device cannot tell", sz);
    // A MISSING `prev_content` ALONE IS NO PROOF OF A ROOM'S FIRST: long after the room was made, it cannot say.
    const m1 = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 900000, { noPrev: true, prevId: null, live: false });   // 15 min after the making
    } });
    const sm1 = m1.standing(THEM);
    ok(sm1 && sm1.outOfStep === true && sm1.target === null && sm1.by === "unknown",
      "A " + name + ": A POWER-LEVELS EVENT WITHOUT WHAT IT REPLACED, LONG AFTER THE ROOM WAS MADE, IS NOT TAKEN AS THE ROOM'S FIRST — it cannot say", sm1);
    // THE ROOM'S FIRST, SENT WITH ITS CREATION RECORD, SET EVERY LEVEL: rooms made naming them at different levels — a tie at
    // the making, to the Space.
    const f = rankWorld(mode, { setup: (hs, R, sid) => { hs.rooms[sid].power.users[THEM] = GUEST; hs.rooms[R.ch.events_uncategorized].power.users[THEM] = PLAYER; } });
    const sf = f.standing(THEM);
    ok(sf && sf.outOfStep === true && sf.target === GUEST && sf.by === "tie",
      "A " + name + ": THE ROOM'S FIRST POWER LEVELS, SENT WITH ITS CREATION RECORD, SET EVERY LEVEL — placed at the making (a tie, to the Space)", sf);
    // HIS EXAMPLE, THE SPACE STILL NAMING THEIR OLD LEVEL (`ddjp_695`): every room named them a Player; a promotion to Staff then
    // landed in every channel and not the Space. The rooms naming them disagree, so the newest set decides — the channels', Staff —
    // never the Space's (the supervisor's rejected first idea: the part left behind repaired to). Where the Space never named them
    // (his own example, below in C), the rooms that do agree, and the Space's default cannot be the target at all.
    const he = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 5000, { live: false });
      for (const id of Object.values(R.ch)) setPL(id, { users: { [ME]: 100, [THEM]: STAFF }, users_default: 0 }, T0 + 8000, { live: false });
    } });
    const she = he.standing(THEM);
    ok(she && she.outOfStep === true && she.space === PLAYER && she.target === STAFF && she.by === "newest",
      "A " + name + ": HIS EXAMPLE, THE SPACE STILL NAMING THEIR OLD LEVEL — the newest set, " + LABEL(STAFF) + ", never the part left behind", she);
    // ONE THAT NAMES AN EVENT IT REPLACED IS NOT THE FIRST, however near the making.
    const n1 = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 9000, { noPrev: true, prevId: "$unseen", live: false });
    } });
    for (const id of Object.keys(n1.made)) delete n1.made[id];
    n1.made[n1.ch.events_uncategorized] = T0 + 8500;   // that channel made just before it: within the window of its making
    const sn1 = n1.standing(THEM);
    ok(sn1 && sn1.by === "unknown", "A " + name + ": AN EVENT NAMING ONE IT REPLACED IS NOT THE ROOM'S FIRST, however near the making", sn1);
    // AN UPGRADE'S CHANNEL, MADE AFTER THEIR RANK WAS SET, NEVER NAMED THEM. CHANGED ON PURPOSE AT `ddjp_695` (JOB 1, the owner's
    // "ok"): every channel counts, for everyone — it is out of step, and the target is the level the rooms naming them agree on,
    // never the late channel's default.
    const u = rankWorld(mode, { setup: (hs, R, sid, setPL, mk) => {
      for (const id of [sid].concat(Object.values(R.ch)).filter((i) => i !== R.ch.chat_uncategorized)) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      mk[R.ch.chat_uncategorized] = T0 + 9000;   // made by a later upgrade: its power levels name only its creator
    } });
    const su = u.standing(THEM);
    ok(su && su.outOfStep === true && su.target === GUEST && su.by === "named",
      "A " + name + ": A CHANNEL AN UPGRADE MADE AFTER THEIR RANK WAS SET (it never named them) IS OUT OF STEP — every channel counts; repaired to " + LABEL(GUEST) + ", the level the rooms naming them agree on", su);
    const uc = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch)).filter((i) => i !== R.ch.chat_uncategorized)) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
    } });
    const suc = uc.standing(THEM);
    ok(suc && suc.outOfStep === true && suc.target === GUEST && suc.by === "named",
      "A " + name + ": and the same channel made BEFORE their rank was set, still at the default, reads the same: the change missed it; repaired to " + LABEL(GUEST) + ", never the default", suc);
    // A TIE WITH A SPACE THAT NEVER NAMED THEM (`ddjp_695`): two channels set to two levels at one server time, the Space naming
    // them nowhere — the Space holds the default, which is never their rank, so it settles nothing: this device cannot tell.
    const tu = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 6000, { live: false });
      setPL(R.ch.events_owner, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 6000, { live: false });
    } });
    const stu = tu.standing(THEM);
    ok(stu && stu.outOfStep === true && stu.target === null && stu.by === "unknown",
      "A " + name + ": A TIE WITH A SPACE THAT NEVER NAMED THEM IS NOT SETTLED BY THE SPACE'S DEFAULT — it cannot tell (`ddjp_695`)", stu);
    const tr = rankWorld(mode, { reload: t });
    const str = tr.standing(THEM);
    ok(str && str.outOfStep === true && str.target === null && str.by === "unknown", "A " + name + ": and after a reload, with only the later event held, it cannot tell — and says so", str);
  }

  // ═══ PART B — THE RING ═════════════════════════════════════════════════════════════════════════════════════════════════
  const NOW = T0 + 500000;
  const LADDER = P.Ranks.LADDER.map((r) => ({ name: r.name, level: r.level, label: r.label }));
  async function screen(x, dj) {
    const L = {};
    const listen = (k) => (fn) => { (L[k] = L[k] || []).push(fn); };
    const np = { dj, song: { songKey: "NOWPLAYING1" }, pi: "p0", startedAt: NOW - 10000 };
    const features = {
      Room: { rankLadder: () => LADDER, getMyId: () => ME, getCurrent: () => ({ spaceId: x.sid, roomId: x.sid }),
        getRoster: () => x.w.Room.getRoster(), getMyRank: () => 99, getMyAuthorityLevel: () => x.w.Room.getMyAuthorityLevel(),
        rankStanding: (u) => x.w.Room.rankStanding(u),   // THE REAL RULE, over the world's real bridge
        onRankChange: listen("rank"), onMembersChange: listen("members"),
        peopleOrder: (fold, roster) => roster.map((m) => ({ member: m, active: null })) },
      Queue: { onStateChange: listen("queue"), onHistoryChange: listen("history"), getNowPlaying: () => np, getRotation: () => [],
        getState: () => ({ counts: {}, rotation: [], nowPlaying: np }), recentHistory: () => [], historyReach: () => ({ entries: 0, complete: true }) },
      Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
      ServerClock: { serverNow: () => NOW },
      Media: { getAvatarUrl: () => null },
      ChatPrefs: { playerHidden: () => false, overlayBlocked: () => false, tierList: () => [], layout: () => "wide", load() {}, onChange: listen("prefs"),
        classify: () => ({ kind: "text" }) },
      Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, onDMRedaction: listen("x"), onDMMessage: listen("x"),
        onDMNotify: listen("x"), onDMChange: listen("x"), onMessage: listen("x"), onRedaction: listen("x"), mentions: () => false },
    };
    // YOUR OWN PICTURE'S RING IS THE STATUS PIECE'S (`ddjp_697`): the real module, over this screen's room (its `rankStanding` the
    // world's real rule) and the world's real bridge — red only for My Rank out of spec.
    const { loadInContext } = require(path.join(__dirname, "_load.js"));
    const ms = loadInContext(["features/matrixstatus.js"], { Room: features.Room, MatrixBridge: x.w.MB, setTimeout: () => 0, clearTimeout: () => {}, Date, Math, JSON }).MatrixStatus;
    const w = S.world({ features, domShaped: true, clock: NOW, globals: { MatrixStatus: ms } });
    w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
    let entry = null;
    try { w.sb.Screens.enterMainScreen({ roomId: x.sid, spaceId: x.sid, name: "Rank room" }); } catch (e) { entry = String(e && e.message); }
    return { w, entry, L };
  }
  const ringed = (n) => !!n && /(^|\s)rank-off(\s|$)/.test(n.className || "");
  // Your own picture's ring (`ddjp_697`): one of four, a class on its wrapper, and the colour the sheet DRAWS for it.
  const ownRing = (n) => { const m = n && /(^|\s)st-(green|orange|red|both)(\s|$)/.exec(n.className || ""); return m ? m[2] : null; };
  const ringBg = (sc, n) => { const d = n ? sc.w.cas.declared(n, "background") : null; return d ? d.val : null; };
  // The outline the page's sheet declares for the picture inside a wrapper: the ring that is DRAWN, not a class.
  const outlineOf = (sc, wrapper) => { const pic = wrapper && wrapper.children && wrapper.children[0]; const d = pic ? sc.w.cas.declared(pic, "outline") : null; return d ? d.val : null; };
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    x.script.fn = null;
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "B " + name + ": APPLIED — `Room.rankStanding`, the rule the ring reads"); continue; }
    // A MINUTE AND A SECOND LATER, in server time (`ddjp_693`): the ring waits for a rank change's own minute — PART F — so the
    // surfaces are read once the split is older than any change could be.
    x.server.at = x.serverNow() + 61000;
    ok(x.standing(THEM).outOfStep === true && x.standing(OTHER).outOfStep === false, "B " + name + ": PREMISE — THEM out of step, OTHER in step");
    const sc = await screen(x, THEM);
    ok(sc.entry === null, "B " + name + ": PREMISE — the main screen was entered by the real code", sc.entry);
    const w = sc.w;
    // People.
    w.sb.Roster.renderRoster();
    const rows = Array.from(w.refs.rosterBox.children);
    const avOf = (u) => { const row = rows.find((r) => r.querySelector && r.querySelector(".who") && r.querySelector(".who").textContent === (x.w.Room.getRoster().find((m) => m.userId === u) || {}).name); return row ? row.querySelector(".person-av") : null; };
    ok(avOf(THEM) && avOf(OTHER), "B " + name + ": PREMISE — People drew both people", rows.length);
    ok(ringed(avOf(THEM)) && !ringed(avOf(OTHER)), "B " + name + ": PEOPLE — THE RING IS ON THE PERSON OUT OF STEP, AND ON NOBODY ELSE", { them: avOf(THEM) && avOf(THEM).className, other: avOf(OTHER) && avOf(OTHER).className });
    ok(outlineOf(sc, avOf(THEM)) === "2px solid #ff6b6b" && !outlineOf(sc, avOf(OTHER)),
      "B " + name + ": and the sheet DRAWS it — the picture inside has the app's red outline; the other picture none", { them: outlineOf(sc, avOf(THEM)), other: outlineOf(sc, avOf(OTHER)) });
    // Chat rows.
    const box = w.doc.createElement("div");
    const rowT = w.sb.ChatPanels._chatRow(box, { id: "$m1", sender: THEM, body: "hello", ts: NOW - 1000 }, {});
    const rowO = w.sb.ChatPanels._chatRow(box, { id: "$m2", sender: OTHER, body: "hi", ts: NOW - 900 }, {});
    const cav = (row) => row && row.querySelector ? row.querySelector(".chat-av") : null;
    ok(cav(rowT) && cav(rowO), "B " + name + ": PREMISE — the real chat row builder drew both rows with their pictures");
    ok(ringed(cav(rowT)) && !ringed(cav(rowO)) && outlineOf(sc, cav(rowT)) === "2px solid #ff6b6b" && !outlineOf(sc, cav(rowO)),
      "B " + name + ": CHAT ROWS — THE RING ON THE PERSON OUT OF STEP, DRAWN; NONE ON THE OTHER", { them: cav(rowT) && cav(rowT).className, other: cav(rowO) && cav(rowO).className });
    // The player's line.
    w.sb.Player.renderNowPlaying();
    const npBox = w.refs.npLabel && w.refs.npLabel.children[0];
    ok(npBox && npBox === w.refs.npAvBox && ringed(npBox) && outlineOf(sc, npBox) === "2px solid #ff6b6b",
      "B " + name + ": THE PLAYER'S LINE — THE DJ OUT OF STEP: THE RING ON THEIR PICTURE, DRAWN", npBox && { cls: npBox.className, outline: outlineOf(sc, npBox) });
    ok(npBox && !npBox.getAttribute("style") && (npBox.className || "").split(/\s+/).filter(Boolean).every((c) => c === "uc-trigger" || c === "rank-off"),
      "B " + name + ": and its wrapper gains no style and no class but the ring's (nothing else on screen changes)", npBox && { cls: npBox.className, style: npBox.getAttribute("style") });
    // The header: this account in step — no ring.
    w.sb.Roster.renderMyRank();
    ok(w.refs.myAvatarSlot && !ringed(w.refs.myAvatarSlot) && ownRing(w.refs.myAvatarSlot) === "green" && ringBg(sc, w.refs.myAvatarSlot) === "#6ee7a0",
      "B " + name + ": THE HEADER — this account in step: its own picture's ring is green, not red (`ddjp_697`)", w.refs.myAvatarSlot && w.refs.myAvatarSlot.className);
    // A repair: the ring goes, on the next draw, from the rooms' own state.
    await cap(x.w.Room.assignRank(THEM, STAFF, { repair: true }));
    await x.settle(20);
    w.sb.Roster.renderRoster();
    const rows2 = Array.from(w.refs.rosterBox.children);
    const themAv2 = rows2.map((r) => r.querySelector && r.querySelector(".person-av")).find((a) => a && a.parent && a.parent.querySelector(".who") && a.parent.querySelector(".who").textContent === (x.w.Room.getRoster().find((m) => m.userId === THEM) || {}).name);
    ok(x.standing(THEM).outOfStep === false && themAv2 && !ringed(themAv2), "B " + name + ": REPAIRED — THE RING GOES", themAv2 && themAv2.className);
    w.sb.Player.renderNowPlaying();
    ok(w.refs.npAvBox && !ringed(w.refs.npAvBox), "B " + name + ": and from the player's line at its next draw", w.refs.npAvBox && w.refs.npAvBox.className);
  }
  for (const [mode, name] of MODES) {
    // THIS ACCOUNT OUT OF STEP: its own picture in the header is ringed.
    const x = rankWorld(mode, { setup: (hs, R) => { hs.rooms[R.ch.chat_uncategorized].power.users[ME] = STAFF; } });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "B " + name + ": APPLIED — `Room.rankStanding` (header)"); continue; }
    const sc = await screen(x, OTHER);
    sc.w.sb.Roster.renderMyRank();
    const slot = sc.w.refs.myAvatarSlot;
    ok(x.standing(ME).outOfStep === true && slot && ownRing(slot) === "red" && !ringed(slot) && ringBg(sc, slot) === "#ff6b6b",
      "B " + name + ": THE HEADER — THIS ACCOUNT OUT OF STEP: THE RING ON ITS OWN PICTURE, DRAWN — red, the status piece's My Rank (`ddjp_697`)", slot && { cls: slot.className, bg: ringBg(sc, slot) });
  }

  // ═══ PART C — THE CARD ═════════════════════════════════════════════════════════════════════════════════════════════════
  const flat = (k) => [k].concat(...Array.from((k && k.children) || []).map(flat));
  const nodes = (c) => [].concat(...c.mountedNodes.map(flat));
  const byClass = (c, cls) => nodes(c).filter((k) => typeof k.className === "string" && new RegExp("(^|\\s)" + cls + "(\\s|$)").test(k.className));
  const textIn = (k) => (k ? flat(k).map((q) => q.text || "").filter(Boolean).join(" | ") : null);
  const offOf = (c) => textIn(byClass(c, "uc-rank-off")[0]);
  const lineOf = (c) => textIn(byClass(c, "uc-rank-note")[0]);
  const repairs = (c) => byClass(c, "uc-repair");
  const until = async (cond, k) => { for (let i = 0; i < (k || 4000); i++) { if (cond()) return true; await turns(1); } return cond(); };
  const card = (x, who, o) => P.driveCard(Object.assign({ domShaped: true, realRankSelect: true, chromiumFocus: true, unlock: true, Room: x.w.Room, Actions: x.w.sb.Actions,
    rankName: LABEL, member: { userId: who, name: who === THEM ? "Them" : "Other", level: x.level(who) } }, o || {}));
  // HALF-DONE ELSEWHERE: the change ran on another tab (the world that made it), so the card reads the rooms on a fresh one. On
  // the tab whose own change stopped, the card shows that change's line instead (`check-rank-change` F) — its Try again.
  const halfStaff = async (mode, o) => {
    const x = rankWorld(mode, o);
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    return rankWorld(mode, { reload: x });
  };
  for (const [mode, name] of MODES) {
    const x = await halfStaff(mode);
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "C " + name + ": APPLIED — `Room.rankStanding`, the rule the card reads"); continue; }
    const n = levelRooms(x) - 1;
    const c = card(x, THEM);
    if (mode === "backend1") {
      // ON THE TAB WHOSE OWN CHANGE STOPPED, that change's line stands in for this one: one answer on the card, not two.
      const own = rankWorld(mode);
      own.script.fn = refuseLevelsIn(own, lastTwo(own));
      await cap(own.w.Room.assignRank(THEM, STAFF));
      await own.settle(20);
      const co = card(own, THEM);
      ok(own.standing(THEM).outOfStep === true && !offOf(co) && /^Not finished — not confirmed: /.test(lineOf(co) || ""),
        "C " + name + ": ON THE TAB WHOSE OWN CHANGE STOPPED, ITS LINE AND TRY AGAIN STAND IN — no second answer", { off: offOf(co), line: lineOf(co) });
    }
    x.w.Room.onRankChange(() => c.refresh());
    ok(c.ok, "C " + name + ": PREMISE — the card opened", c.stage);
    const want = "Them's rank isn't the same everywhere in this room: " + LABEL(STAFF) + " in the room, " + LABEL(0) + " in 2 of its " + n + " channels.";
    ok(offOf(c) && offOf(c).indexOf(want) === 0, "C " + name + ": THE LINE, FROM THE FACTS — \"" + want + "\"", offOf(c));
    const b = repairs(c)[0];
    ok(repairs(c).length === 1 && b.text === "Repair to " + LABEL(STAFF) && !b.disabled && typeof b.onclick === "function",
      "C " + name + ": \"REPAIR TO " + LABEL(STAFF).toUpperCase() + "\" — the level set last, live on the unlocked card", repairs(c).map((q) => [q.text, q.disabled]));
    const locked = card(x, THEM, { unlock: false });
    const bl = repairs(locked)[0];
    ok(bl && bl.disabled && /^Locked/.test(bl.title || (bl.attrs && bl.attrs.title) || ""), "C " + name + ": and behind the card's lock, as the picker is", bl && [bl.disabled, bl.title]);
    // THE REPAIR: the same change, said as a repair; its progress on a bar; done, the line and the ring gone.
    x.hold();
    b.onclick();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
    const j = x.w.Room.rankJob();
    ok(j && j.repair === true && j.level === STAFF && j.userId === THEM, "C " + name + ": REPAIR STARTS THE RANK CHANGE ITSELF, marked a repair, to " + LABEL(STAFF), j);
    ok(new RegExp("^Repairing Them's rank… \\d+ of \\d+$").test(lineOf(c) || ""), "C " + name + ": \"Repairing Them's rank… N of M\"", lineOf(c));
    const bar = byClass(c, "uc-rank-bar")[0], fill = bar && bar.children && bar.children[0];
    ok(bar && fill && /^\d+%$/.test(fill.style.width || "") && parseInt(fill.style.width, 10) === Math.round((100 * j.done) / j.total),
      "C " + name + ": with a bar, filled to steps confirmed of steps", bar && fill && { width: fill.style.width, done: j.done, total: j.total });
    ok(!offOf(c), "C " + name + ": while it runs, the out-of-step line gives way to the progress", offOf(c));
    x.release();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running");
    await x.settle(20);
    ok(x.w.Room.rankJob().state === "done" && x.standing(THEM).outOfStep === false && !offOf(c) && lineOf(c) === LABEL(STAFF) + " ✓",
      "C " + name + ": DONE — in step everywhere, the line gone, \"" + LABEL(STAFF) + " ✓\"", { job: x.w.Room.rankJob(), off: offOf(c), line: lineOf(c) });
  }
  for (const [mode, name] of MODES) {
    // ANYONE WHO MAY NOT IS TOLD WHICH RANK MAY (the owner's, `ddjp_693`; it replaces the names): this account at Guest.
    const x = await halfStaff(mode);
    if (typeof x.w.Room.rankStanding !== "function") continue;
    const meGuest = rankWorld(mode, { reload: x });
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = GUEST;
    const c = card(meGuest, THEM);
    const want = giverText(STAFF, STAFF);   // THEM at Staff, repaired to Staff: High Staff and above
    ok(repairs(c).length === 0 && (offOf(c) || "").split(" | ")[1] === want,
      "C " + name + ": A VIEWER WHO MAY NOT GIVE IT SEES NO REPAIR — and the rank that may: \"" + want + "\"", offOf(c));
    ok(!/@/.test((offOf(c) || "").split(" | ")[1] || "@"), "C " + name + ": AND NAMES NOBODY — a rank, not people", offOf(c));
    // NOBODY PRESENT WHO COULD (his "or nothing since owner always can"): the owner gone from the room, everyone left below
    // High Staff — still the rank; "Nobody in this room can repair it now." is gone.
    x.hs.rooms[x.sid].members[OWNER] = "leave";
    const cg = card(rankWorld(mode, { reload: x }), THEM);
    ok(!x.w.Room.getRoster().some((m) => m.userId === OWNER) && (offOf(cg) || "").split(" | ")[1] === want && !/Nobody/.test(offOf(cg) || ""),
      "C " + name + ": WITH NOBODY PRESENT WHO COULD, STILL THE RANK — \"" + want + "\", never \"Nobody in this room…\"", offOf(cg));
    x.hs.rooms[x.sid].members[OWNER] = "join";
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = 100;
  }
  for (const [mode, name] of MODES) {
    // A HALF-DONE DEMOTION: THE RANK MUST OUTRANK THEIR HIGHEST LEVEL, not only the level given — Staff left in two channels,
    // repaired to 0: High Staff+, never Staff+ (a Staff could not touch them).
    const x = rankWorld(mode, { levels: { [THEM]: STAFF }, setup: (hs, R) => { hs.rooms[R.ch.chat_guest].members[THEM] = "join"; hs.rooms[R.ch.chat_staff].members[THEM] = "join"; } });
    if (typeof x.w.Room.rankStanding !== "function") continue;
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, 0));
    await x.settle(20);
    x.script.fn = null;
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = GUEST;
    const c = card(rankWorld(mode, { reload: x }), THEM);
    const want = giverText(STAFF, 0);
    ok(x.standing(THEM).target === 0 && want !== giverText(-1, 0) && (offOf(c) || "").split(" | ")[1] === want,
      "C " + name + ": A HALF-DONE DEMOTION — THE RANK THAT MAY MUST OUTRANK THEIR HIGHEST LEVEL: \"" + want + "\", not \"" + giverText(-1, 0) + "\"", offOf(c));
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = 100;
  }
  for (const [mode, name] of MODES) {
    // BOT: the owner only — his example: the channels at the bot's level, the Space left behind at 0.
    const x = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of Object.values(R.ch)) setPL(id, { users: { [ME]: 100, [THEM]: TOP }, users_default: 0 }, T0 + 5000);
    } });
    if (typeof x.w.Room.rankStanding !== "function") continue;
    const s = x.standing(THEM);
    ok(s && s.target === TOP && s.space === 0, "C " + name + ": HIS EXAMPLE — the bot's level in the channels, the room left at 0: the target is Bot", s);
    const c = card(x, THEM);
    const b = repairs(c)[0];
    ok(b && b.text === "Repair to Bot" && !b.disabled, "C " + name + ": \"Repair to Bot\", live for the owner (this account, at 100)", b && [b.text, b.disabled]);
    const staffView = rankWorld(mode, { reload: x });
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = STAFF;
    const cs = card(staffView, THEM);
    ok(repairs(cs).length === 0 && (offOf(cs) || "").split(" | ")[1] === "Owner can repair it." && giverText(TOP, TOP) === "Owner can repair it.",
      "C " + name + ": FOR BOT, THE OWNER ONLY — Staff sees no Repair, and \"Owner can repair it.\"", offOf(cs));
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = 100;
    // ONE BOT PER ROOM (J140): another account holds the bot's level in the Space — the Repair greyed in the adapter's words.
    x.hs.rooms[x.sid].power.users[BOT] = TOP;
    const ct = card(x, THEM);
    const bt = repairs(ct)[0];
    ok(bt && bt.disabled && (bt.title || (bt.attrs && bt.attrs.title)) === "Bot already assigned", "C " + name + ": AND WHILE ANOTHER ACCOUNT HOLDS IT, \"Bot already assigned\", greyed", bt && [bt.disabled, bt.title]);
    // AND NOBODY MAY NOW: to Staff, nothing at all is said (his "or nothing") — no Repair, no line.
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = STAFF;
    const cn = card(rankWorld(mode, { reload: x }), THEM);
    ok(repairs(cn).length === 0 && (offOf(cn) || "").split(" | ").length === 1 && /^Them's rank isn't the same everywhere/.test(offOf(cn) || ""),
      "C " + name + ": WHERE NOBODY MAY NOW (the bot's level held by another), NOTHING IS SAID — the line alone", offOf(cn));
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = 100;
    delete x.hs.rooms[x.sid].power.users[BOT];
  }
  for (const [mode, name] of MODES) {
    // CANNOT TELL: each level offered, and it says so.
    const x = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 9000, { noPrev: true, prevId: "$unseen", live: false });
    } });
    if (typeof x.w.Room.rankStanding !== "function") continue;
    const c = card(x, THEM);
    ok(/This device can't tell which was set last\.$/.test((offOf(c) || "").split(" | ")[0]) && repairs(c).map((q) => q.text).sort().join(",") === ["Repair to " + LABEL(GUEST), "Repair to " + LABEL(PLAYER)].sort().join(","),
      "C " + name + ": WHERE IT CANNOT TELL, IT SAYS SO AND OFFERS EACH LEVEL", { off: offOf(c), repairs: repairs(c).map((q) => q.text) });
  }
  for (const [mode, name] of MODES) {
    // A REPAIR THAT STOPS: a level refused on the way — named, where it stopped, and Repair again.
    const x = await halfStaff(mode);
    if (typeof x.w.Room.rankStanding !== "function") continue;
    const two = lastTwo(x);
    x.script.fn = (s) => (s.kind === "level" && s.roomId === x.ch[two[1]] ? { error: e403("You don't have permission") } : null);
    const c = card(x, THEM);
    x.w.Room.onRankChange(() => c.refresh());
    const from = x.w.logs.length;
    repairs(c)[0].onclick();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "failed");
    await x.settle(10);
    const lab = "level in " + two[1].replace(/_/g, "-");
    ok(new RegExp("^Repair stopped at \\d+ of \\d+ — not confirmed: " + lab + " \\| Repair again$").test(lineOf(c) || ""),
      "C " + name + ": A REPAIR THAT STOPS SAYS WHERE — \"Repair stopped at N of M — not confirmed: " + lab + "\" — and offers Repair again", lineOf(c));
    ok(x.line(new RegExp("stopped: the server refused a step — \\d+ of \\d+ steps confirmed; not confirmed: " + lab + " \\(M_FORBIDDEN\\)"), from).length === 1,
      "C " + name + ": A REFUSAL NAMED — the log names the step and the server's error", x.line(/MatrixBridge: rank change/, from));
    x.script.fn = null;
    const again = byClass(c, "uc-retry")[0];
    ok(again && again.text === "Repair again" && typeof again.onclick === "function", "C " + name + ": PREMISE — Repair again is live", again && again.text);
    if (again && again.onclick) again.onclick();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "done");
    await x.settle(20);
    ok(x.w.Room.rankJob().repair === true && x.standing(THEM).outOfStep === false, "C " + name + ": REPAIR AGAIN IS THE SAME REPAIR, and it lands", x.w.Room.rankJob());
  }

  // ═══ PART D — AN ORDINARY CHANGE'S PROGRESS SHOWS THE SAME BAR ═════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    const c = card(x, THEM);
    x.w.Room.onRankChange(() => c.refresh());
    const sel = nodes(c).find((k) => k.tag === "select");
    if (!(c.ok && sel)) { ok(false, "D " + name + ": PREMISE — the card and its picker", c.stage); continue; }
    x.hold();
    sel.focus(); sel.value = String(STAFF); sel.onchange();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
    const j = x.w.Room.rankJob();
    const bar = byClass(c, "uc-rank-bar")[0], fill = bar && bar.children && bar.children[0];
    ok(j && !j.repair && new RegExp("^Changing to " + LABEL(STAFF) + "… \\d+ of \\d+$").test(lineOf(c) || "") && bar && fill && parseInt(fill.style.width, 10) === Math.round((100 * j.done) / j.total),
      "D " + name + ": AN ORDINARY CHANGE — \"Changing to " + LABEL(STAFF) + "… N of M\" over the same bar", { line: lineOf(c), width: fill && fill.style.width, j });
    x.release();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running");
    await x.settle(10);
    ok(byClass(c, "uc-rank-bar").length === 0, "D " + name + ": and the bar goes when the change ends", byClass(c, "uc-rank-bar").length);
  }

  // ═══ PART E — THE PACER ════════════════════════════════════════════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    const pace = typeof x.w.MB._paceForTest === "function" ? x.w.MB._paceForTest() : null;
    ok(pace && pace.min === 1000 && pace.max > pace.min, "E " + name + ": APPLIED — the transport's one send pacer: at least a second, and a ceiling above it", pace);
    if (!pace) continue;
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(10);
    const at = x.sends.map((s) => s.at);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    ok(r.v && r.v.ok === true && x.sends.length > 3 && gaps.every((g) => g >= 1000),
      "E " + name + ": AT LEAST A SECOND BETWEEN SENDS — every one of a change's " + x.sends.length + " sends", { min: Math.min.apply(null, gaps), gaps: gaps.slice(0, 8) });
    // The next change, at once: its first send waits its turn too.
    const t0 = x.clock.t;
    await cap(x.w.Room.assignRank(OTHER, PLAYER));
    const first = x.sends.find((s) => s.userId === OTHER);
    ok(first && first.at - at[at.length - 1] >= 1000, "E " + name + ": and the next change's first send waits for it too", first && { last: at[at.length - 1], next: first.at, t0 });
  }
  for (const [mode, name] of MODES) {
    // A PUSH-BACK: two 429s on one invite — the sends after each come further apart, then ease back once one lands.
    const x = rankWorld(mode);
    if (typeof x.w.MB._paceForTest !== "function") { ok(false, "E " + name + ": APPLIED — the pacer (push-back)"); continue; }
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff && s.n <= 2 ? { error: e429(300) } : null);
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(10);
    const i1 = x.sends.findIndex((s) => s.kind === "in" && s.roomId === x.ch.chat_staff && s.n === 1);
    const after1 = x.sends[i1 + 1], after2 = x.sends.find((s) => s.kind === "in" && s.roomId === x.ch.chat_staff && s.n === 2);
    const i2 = x.sends.indexOf(after2), next2 = x.sends[i2 + 1];
    ok(r.v && r.v.ok === true && after1 && after1.at - x.sends[i1].at >= 2000,
      "E " + name + ": AFTER A PUSH-BACK THE NEXT SEND COMES FURTHER APART — at least twice the floor, though the server asked " + 300 + " ms", after1 && { gap: after1.at - x.sends[i1].at });
    ok(next2 && next2.at - after2.at >= 4000, "E " + name + ": and after a second, further still (the ceiling)", next2 && { gap: next2.at - after2.at });
    const g = x.w.MB._paceForTest();
    ok(g.gap === Math.max(g.min, g.max / 2), "E " + name + ": and once a send lands again it eases back — the gap halved from the ceiling", g);
    ok(x.clock.sleeps.filter((ms) => ms === 300).length === 2, "E " + name + ": the server's own retry_after is still waited out", x.clock.sleeps.slice(0, 16));
  }
  for (const [mode, name] of MODES) {
    // THE MINUTE STILL STOPS IT, NAMING WHAT IS LEFT; A STEP CONFIRMED IS NEVER SENT AGAIN.
    const x = rankWorld(mode);
    if (typeof x.w.MB._paceForTest !== "function") continue;
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff ? { error: e429(1500) } : null);
    const r = await cap(x.w.Room.assignRank(THEM, STAFF, { repair: true }));
    const v = r.v || {};
    const g = x.w.MB._paceForTest();
    ok(!r.timedOut && v.ok === false && v.reason === "limit" && x.clock.t >= 60000 && x.clock.t < 60000 + g.max + 250 + 1,
      "E " + name + ": A REPAIR THAT CANNOT LAND STOPS AT THE MINUTE", { v, t: x.clock.t });
    ok(JSON.stringify(v.failed) === JSON.stringify(["invite to chat-staff"]) && x.jobs[x.jobs.length - 1].repair === true,
      "E " + name + ": NAMING WHAT IS LEFT — the staff-chat invite", v.failed);
    const tries = x.sentTo("in", "chat_staff", THEM);
    ok(tries >= 2 && tries <= Math.ceil(60000 / 1500), "E " + name + ": PACED RETRIES — sent again, but within the minute's waits, not in a loop (" + tries + ")", tries);
    const ra = x.sends.map((s) => s.at), rg = ra.slice(1).map((t, i) => t - ra[i]);
    ok(x.sends.length > 3 && rg.every((q) => q >= 1000), "E " + name + ": A REPAIR IS PACED LIKE ANY CHANGE — a second or more between every one of its sends", { min: Math.min.apply(null, rg) });
    const once = x.sends.filter((s) => s.kind === "level").map((s) => s.roomId);
    ok(once.length === new Set(once).size, "E " + name + ": A STEP CONFIRMED IS NEVER SENT AGAIN — each level once", once.length - new Set(once).size);
  }

  // ═══ PART F — THE RING WAITS FOR A RANK CHANGE'S OWN MINUTE, IN SERVER TIME (the owner's "ok", `ddjp_693`) ═══════════════════
  const peopleAv = (sc, x, u) => {
    const name = (x.w.Room.getRoster().find((m) => m.userId === u) || {}).name;
    const row = Array.from(sc.w.refs.rosterBox.children).find((r) => r.querySelector && r.querySelector(".who") && r.querySelector(".who").textContent === name);
    return row ? row.querySelector(".person-av") : null;
  };
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    const LIMIT = x.w.MB.RANK_LIMIT_MS;
    ok(LIMIT === 60000, "F " + name + ": APPLIED — the ring's wait is the bridge's one minute (`RANK_LIMIT_MS`), read through the interface", LIMIT);
    if (typeof LIMIT !== "number" || typeof x.w.Room.rankStanding !== "function") continue;
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    x.script.fn = null;
    // The newest level change for THEM, from the world's own record: every power-levels event here was this change's.
    const at = Math.max.apply(null, Object.values(x.meta).map((m) => m.ts));
    // FRESH: five seconds after it, in server time — out of step, and no ring; People draws none.
    x.server.at = at + 5000;
    const sF = x.standing(THEM);
    ok(sF && sF.outOfStep === true && sF.ring === false && sF.since === at,
      "F " + name + ": A FRESH DISAGREEMENT (5 s, in server time) IS OUT OF STEP AND RINGS NOTHING — `since` the newest level change", sF && { outOfStep: sF.outOfStep, ring: sF.ring, since: sF.since, at });
    const sc = await screen(x, THEM);
    sc.w.sb.Roster.renderRoster();
    ok(peopleAv(sc, x, THEM) && !ringed(peopleAv(sc, x, THEM)) && !outlineOf(sc, peopleAv(sc, x, THEM)), "F " + name + ": and People draws no ring on them", peopleAv(sc, x, THEM) && peopleAv(sc, x, THEM).className);
    // OLDER THAN THE LIMIT: the minute and a millisecond — the ring, drawn; at the minute exactly, still a change's time.
    x.server.at = at + LIMIT;
    ok(x.standing(THEM).ring === false, "F " + name + ": AT THE MINUTE EXACTLY, STILL WITHIN A CHANGE'S TIME — no ring (longer than, not as long as)");
    x.server.at = at + LIMIT + 1;
    sc.w.sb.Roster.renderRoster();
    ok(x.standing(THEM).ring === true && ringed(peopleAv(sc, x, THEM)) && outlineOf(sc, peopleAv(sc, x, THEM)) === "2px solid #ff6b6b",
      "F " + name + ": ONE OLDER THAN THE LIMIT RINGS — drawn by the sheet", peopleAv(sc, x, THEM) && { cls: peopleAv(sc, x, THEM).className, outline: outlineOf(sc, peopleAv(sc, x, THEM)) });
    // NEVER THE LOCAL CLOCK AGAINST A SERVER STAMP: the device's own clock an hour past the change while the server's is five
    // seconds past — no ring; the device's an hour BEFORE it while the server's is a minute past — the ring.
    const RealDate = x.w.sb.Date;
    x.w.sb.Date = class extends RealDate { static now() { return at + 3600000; } };
    x.server.at = at + 5000;
    const sAhead = x.standing(THEM);
    x.w.sb.Date = class extends RealDate { static now() { return at - 3600000; } };
    x.server.at = at + LIMIT + 1;
    const sBehind = x.standing(THEM);
    x.w.sb.Date = RealDate;
    ok(sAhead.ring === false && sBehind.ring === true, "F " + name + ": NEVER THE DEVICE'S CLOCK — an hour ahead, no ring at the server's 5 s; an hour behind, the ring at its minute",
      { ahead: sAhead.ring, behind: sBehind.ring });
    // A RING THAT WAITS IS DRAWN WHEN IT FALLS DUE, WITH NO EVENT: one timer for the minute past the newest change, which tells
    // the rank listeners — the screen's own redraws the header, People and chat from them.
    const timers = [];
    x.w.Room._setRingLaterForTest((fn, ms) => { const h = { fn, ms }; timers.push(h); return h; }, (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); });
    let told = 0;
    x.w.Room.onRankChange(() => { told++; for (const fn of (sc.L.rank || [])) { try { fn(); } catch (e) {} } });
    x.server.at = at + 5000;
    x.standing(THEM); x.standing(THEM);
    ok(timers.length === 1 && timers[0].ms >= LIMIT - 5000 && timers[0].ms <= LIMIT - 5000 + 1000,
      "F " + name + ": A WAITING RING SETS ONE TIMER, FOR JUST PAST THE MINUTE (asked twice, one timer)", timers.map((t) => t.ms));
    // People shown (its tab clicked) and drawn while the split is fresh: no ring — then only the timer fires.
    if (sc.w.refs.tabPeople && sc.w.refs.tabPeople.onclick) sc.w.refs.tabPeople.onclick();
    sc.w.sb.Roster.renderRoster();
    ok(peopleAv(sc, x, THEM) && !ringed(peopleAv(sc, x, THEM)), "F " + name + ": PREMISE — People shown and drawn while the split is fresh: no ring yet", peopleAv(sc, x, THEM) && peopleAv(sc, x, THEM).className);
    x.server.at = at + LIMIT + 300;
    const t0 = told;
    if (timers[0]) timers[0].fn();
    ok(told === t0 + 1 && ringed(peopleAv(sc, x, THEM)), "F " + name + ": WHEN IT FIRES, THE RANK LISTENERS ARE TOLD ONCE — and the screen draws the ring with no event", { told: told - t0, cls: peopleAv(sc, x, THEM) && peopleAv(sc, x, THEM).className });
    // A TAB WHOSE OWN CHANGE FOR THEM RUNS: its progress line as today, and no ring until it ends — over a split long past the
    // minute too — the listeners told as it starts; it lands, and nothing rings.
    const c = card(x, THEM);
    x.w.Room.onRankChange(() => c.refresh());
    x.hold();
    const before = told;
    const rep = x.w.Room.assignRank(THEM, STAFF, { repair: true });
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
    ok(x.standing(THEM).ring === false && told > before && new RegExp("^Repairing Them's rank… \\d+ of \\d+$").test(lineOf(c) || ""),
      "F " + name + ": THIS TAB'S OWN CHANGE FOR THEM RUNNING — NO RING (the screen told as it starts), its progress line as today", { ring: x.standing(THEM).ring, told: told - before, line: lineOf(c) });
    sc.w.sb.Roster.renderRoster();
    ok(!ringed(peopleAv(sc, x, THEM)), "F " + name + ": and People draws none while it runs", peopleAv(sc, x, THEM) && peopleAv(sc, x, THEM).className);
    x.release();
    await cap(rep);
    await x.settle(20);
    ok(x.standing(THEM).outOfStep === false && x.standing(THEM).ring === false, "F " + name + ": it lands — in step, nothing rings");
    // NO SERVER TIME TO READ measures nothing, so nothing is hidden: the ring shows (a page always has the clock).
    const u = rankWorld(mode, { setup: (hs, R) => { hs.rooms[R.ch.chat_uncategorized].power.users[THEM] = STAFF; } });
    u.w.sb.ServerClock = { serverNow: () => undefined };
    ok(u.standing(THEM).outOfStep === true && u.standing(THEM).ring === true, "F " + name + ": NO SERVER TIME TO READ — NOTHING MEASURED IS NOTHING HIDDEN: the ring shows", u.standing(THEM));
    // THE LEAVE TAKES A WAITING RING'S TIMER WITH THE ROOM.
    const lt = [];
    const lw = rankWorld(mode);
    lw.w.Room._setRingLaterForTest((fn, ms) => { const h = { fn, ms }; lt.push(h); return h; }, (h) => { const i = lt.indexOf(h); if (i >= 0) lt.splice(i, 1); });
    lw.script.fn = refuseLevelsIn(lw, lastTwo(lw));
    await cap(lw.w.Room.assignRank(THEM, STAFF));
    await lw.settle(20);
    lw.standing(THEM);
    const waiting = lt.length;
    try { lw.w.Room.leave("the guard leaves"); } catch (e) {}
    ok(waiting === 1 && lt.length === 0, "F " + name + ": THE LEAVE STOPS A WAITING RING'S TIMER — it goes with the room", { before: waiting, after: lt.length });
  }
  for (const [mode, name] of MODES) {
    // A SET THIS DEVICE CANNOT PLACE, BOUNDED RECENTLY: the rooms set long ago, and in one the newest power-levels event, two
    // minutes later, does not carry what it replaced — their level there may have been set by it. So the split may be as
    // fresh as that event: no ring until a minute past it.
    const x = rankWorld(mode, { setup: (hs, R, sid, setPL) => {
      for (const id of [sid].concat(Object.values(R.ch))) setPL(id, { users: { [ME]: 100, [THEM]: GUEST }, users_default: 0 }, T0 + 5000, { live: false });
      setPL(R.ch.events_uncategorized, { users: { [ME]: 100, [THEM]: PLAYER }, users_default: 0 }, T0 + 125000, { noPrev: true, prevId: "$unseen", live: false });
    } });
    if (typeof x.w.MB.RANK_LIMIT_MS !== "number") continue;
    x.server.at = T0 + 130000;
    const s1 = x.standing(THEM);
    x.server.at = T0 + 125000 + x.w.MB.RANK_LIMIT_MS + 1;
    const s2 = x.standing(THEM);
    ok(s1.outOfStep === true && s1.since === T0 + 125000 && s1.ring === false && s2.ring === true,
      "F " + name + ": A SET IT CANNOT PLACE COUNTS AS RECENT AS IT MAY BE — `since` the unplaceable event, no ring for its minute, then the ring", { since: s1.since, fresh: s1.ring, old: s2.ring });
  }
  for (const [mode, name] of MODES) {
    // ONE THAT STOPS, ON ITS OWN TAB: the rule again — its newest landed step is fresh, so no ring until a minute past it; its
    // card says where it stopped (the stopped change's line stands in for the out-of-step one, as at `ddjp_692`).
    const x = rankWorld(mode);
    if (typeof x.w.MB.RANK_LIMIT_MS !== "number") continue;
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    const at = Math.max.apply(null, Object.values(x.meta).map((m) => m.ts));
    x.server.at = at + 5000;
    const s1 = x.standing(THEM);
    x.server.at = at + x.w.MB.RANK_LIMIT_MS + 1;
    const s2 = x.standing(THEM);
    ok(x.w.Room.rankJob().state === "failed" && s1.ring === false && s2.ring === true,
      "F " + name + ": THIS TAB'S CHANGE STOPPED — THE RULE AGAIN: no ring while its last landed step is fresh, the ring a minute past it", { job: x.w.Room.rankJob().state, fresh: s1.ring, old: s2.ring });
  }

  // ═══ PART G — THE CARD'S OWN PICTURE GETS THE SAME RING (the owner's "ok", `ddjp_693`) ═══════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    if (typeof x.w.Room.rankStanding !== "function") continue;
    x.script.fn = refuseLevelsIn(x, lastTwo(x));
    await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    x.script.fn = null;
    const at = Math.max.apply(null, Object.values(x.meta).map((m) => m.ts));
    const sc = await screen(x, OTHER);
    // A card that throws on the way is a row's answer, not the guard's end (a tree before `ddjp_693` reads its rows too).
    const openCard = (u) => { try { sc.w.sb.Roster.openUserCard({ userId: u, name: u === THEM ? "Them" : "Other", level: 0 }); return sc.w.doc.body.querySelector(".uc-card"); }
      catch (e) { ok(false, "G " + name + ": the real card opened without throwing", String(e && e.message)); return null; } };
    x.server.at = at + x.w.MB.RANK_LIMIT_MS + 1;
    const cardT = openCard(THEM);
    const avT = cardT && cardT.querySelector(".uc-av");
    const pic = avT && avT.children && avT.children[0];
    ok(cardT && avT && pic, "G " + name + ": PREMISE — the real card opened, its picture in its own wrapper (`.uc-av`)", !!cardT);
    ok(ringed(avT) && outlineOf(sc, avT) === "2px solid #ff6b6b", "G " + name + ": THE CARD'S OWN PICTURE, THEIRS OUT OF STEP — THE SAME RING, drawn by the sheet", avT && { cls: avT.className, outline: outlineOf(sc, avT) });
    const idEl = cardT && cardT.querySelector(".uc-id"), lockEl = cardT && cardT.querySelector(".uc-lock");
    ok(idEl && lockEl && !sc.w.cas.declared(idEl, "outline") && !sc.w.cas.declared(lockEl, "outline") && avT && !avT.getAttribute("style"),
      "G " + name + ": and only the picture: the name's block and the lock have no outline, the wrapper no style", idEl && { id: sc.w.cas.declared(idEl, "outline"), lock: lockEl && sc.w.cas.declared(lockEl, "outline") });
    const disp = avT ? sc.w.cas.declared(avT, "display") : null;
    ok(disp && disp.val === "contents", "G " + name + ": THE WRAPPER DRAWS NO BOX (`display: contents`), so the card's head lays out as before", disp);
    const cardO = openCard(OTHER);
    const avO = cardO && cardO.querySelector(".uc-av");
    ok(avO && !ringed(avO) && !outlineOf(sc, avO), "G " + name + ": SOMEONE IN STEP — their card's picture has no ring", avO && avO.className);
    x.server.at = at + 5000;
    const cardF = openCard(THEM);
    const avF = cardF && cardF.querySelector(".uc-av");
    ok(avF && !ringed(avF), "G " + name + ": A FRESH DISAGREEMENT — no ring on the card either: the same rule as every picture", avF && avF.className);
  }

  // ═══ PART H — BOT ONLY AFTER THE ROOM'S LAST UPGRADE (the owner's "we must fix that bot is assignable before last upgrade", `ddjp_693`) ═══
  for (const [mode, name] of MODES) {
    const top = (rankWorld(mode).plan || []).reduce((n, r) => Math.max(n, r.batch || 1), 1);
    if (top < 2) {
      // A ROOM BUILT IN ONE PIECE (the bot room): as today — the Bot choice offered.
      const x = rankWorld(mode);
      const c = card(x, THEM);
      const opts = nodes(c).find((k) => k.tag === "select");
      const botOpt = opts && Array.from(opts.children || []).find((o) => String(o.value) === String(TOP));
      ok(botOpt && botOpt.text === "Bot (appoint as room bot)" && !botOpt.disabled && !(botOpt.attrs && botOpt.attrs.disabled),
        "H " + name + ": A ROOM BUILT IN ONE PIECE — THE BOT CHOICE OFFERED, AS TODAY", botOpt && [botOpt.text, botOpt.disabled]);
      continue;
    }
    // BEFORE THE LAST BATCH: the room upgraded through the batch below its last.
    const x = rankWorld(mode, { upTo: top - 1 });
    const lastKeys = x.plan.filter((r) => r.batch === top).map((r) => r.key);
    ok(lastKeys.length > 0 && lastKeys.every((k) => !x.ch[k]), "H " + name + ": PREMISE — a room upgraded through batch " + (top - 1) + " of " + top + ": the last batch's channels do not exist", lastKeys);
    ok(x.w.Room.isRankUnlocked(x.w.Room.getChannels(), TOP) === false && x.w.Room.isRankUnlocked(x.w.Room.getChannels(), lv("vip")) === true,
      "H " + name + ": BEFORE THE LAST BATCH THE BOT'S RUNG IS LOCKED — and a rung whose channels exist is not");
    const c = card(x, THEM);
    const sel = nodes(c).find((k) => k.tag === "select");
    const optsOf = () => Array.from((sel && sel.children) || []).map((o) => ({ v: String(o.value !== undefined ? o.value : (o.attrs && o.attrs.value)), text: o.text, off: !!(o.disabled || (o.attrs && o.attrs.disabled)) }));
    const bo = optsOf().find((o) => o.v === String(TOP));
    ok(bo && bo.text === "Bot — upgrade the room first" && bo.off === true, "H " + name + ": THE PICKER SHOWS IT LOCKED, IN ITS OWN WORDS — \"Bot — upgrade the room first\"", optsOf());
    ok(!optsOf().some((o) => o.text === "Bot (appoint as room bot)") && optsOf().some((o) => o.v === String(lv("vip")) && !o.off),
      "H " + name + ": no choice appoints a bot; the rungs the room has stay live", optsOf());
    const from = x.w.logs.length, n0 = x.sends.length;
    const r = await cap(x.w.Room.assignRank(THEM, TOP));
    ok(r.v && r.v.ok === false && r.v.reason === "upgrade-first" && lastKeys.every((k) => (r.v.missing || []).indexOf(k) >= 0) && x.sends.length === n0 && x.w.Room.rankJob() === null,
      "H " + name + ": ROOM.ASSIGNRANK REFUSES IT WITH THAT REASON — upgrade-first, the last batch's channels named, nothing sent, no change started", r.v);
    ok(x.line(/Room: level \d+ cannot be assigned yet — upgrade the room first/, from).length === 1, "H " + name + ": and says so in the log", x.line(/Room:/, from));
    const d = await cap(x.w.sb.Actions.perform("rank.assign", { userId: THEM, targetRank: 0, newLevel: TOP }));
    ok(d.v && d.v.ok === false && d.v.reason === "upgrade-first" && x.sends.length === n0, "H " + name + ": through the adapter too — the same refusal, nothing sent", d);
    // HIS EXAMPLE, BEFORE THE LAST BATCH: the bot's level in the channels, the Space left at 0 — Repair to Bot is shown, locked
    // in the picker's words (the card never offers what the room refuses).
    const e = rankWorld(mode, { upTo: top - 1, setup: (hs, R, sid, setPL) => { for (const id of Object.values(R.ch)) setPL(id, { users: { [ME]: 100, [THEM]: TOP }, users_default: 0 }, T0 + 5000); } });
    const ce = card(e, THEM);
    const be = repairs(ce)[0];
    ok(e.standing(THEM).target === TOP && be && be.text === "Repair to Bot" && be.disabled && (be.title || (be.attrs && be.attrs.title)) === "Bot — upgrade the room first",
      "H " + name + ": AND REPAIR TO BOT, BEFORE THE LAST BATCH, IS SHOWN LOCKED IN THE SAME WORDS", be && [be.text, be.disabled, be.title]);
    // AFTER: every batch — offered, and it lands.
    const y = rankWorld(mode);
    const cy = card(y, THEM);
    const sy = nodes(cy).find((k) => k.tag === "select");
    const by = Array.from((sy && sy.children) || []).find((o) => String(o.value) === String(TOP));
    ok(by && by.text === "Bot (appoint as room bot)" && !(by.disabled || (by.attrs && by.attrs.disabled)), "H " + name + ": AFTER THE LAST BATCH — \"Bot (appoint as room bot)\", offered", by && [by.text, by.disabled]);
    const ry = await cap(y.w.Room.assignRank(THEM, TOP));
    await y.settle(20);
    ok(ry.v && ry.v.ok === true && y.level(THEM) === TOP, "H " + name + ": and the change lands", ry.v);
  }

  // ═══ PART I — AN UPGRADE GIVES A BOT ALREADY THERE ITS LEVEL IN THE NEW CHANNELS (the owner's, `ddjp_693`) ═══════════════════
  for (const [mode, name] of MODES) {
    const top = (rankWorld(mode).plan || []).reduce((n, r) => Math.max(n, r.batch || 1), 1);
    if (top < 2) continue;   // a room built in one piece has no upgrade
    // AN OLD ROOM: the bot appointed before the last batch — its level in the Space and every earlier channel; the last batch's
    // channels, made after, name only their creator.
    const lastKeys = rankWorld(mode).plan.filter((r) => r.batch === top).map((r) => r.key);
    const x = rankWorld(mode, { setup: (hs, R, sid) => { for (const id of [sid].concat(Object.keys(R.ch).filter((k) => lastKeys.indexOf(k) < 0).map((k) => R.ch[k]))) hs.rooms[id].power.users[BOT] = TOP; } });
    ok(typeof x.w.MB.botLevelAfterUpgrade === "function", "I " + name + ": APPLIED — the transport's step for an upgrade (`MatrixBridge.botLevelAfterUpgrade`)");
    if (typeof x.w.MB.botLevelAfterUpgrade !== "function") continue;
    const batch = {}; for (const k of lastKeys) batch[k] = x.ch[k];
    ok(lastKeys.every((k) => x.level(BOT, k) === 0) && x.level(BOT) === TOP, "I " + name + ": PREMISE — the bot at its level in the Space, at 0 in the last batch's " + lastKeys.length + " channels");
    const prog = [], from = x.w.logs.length;
    const r = await cap(x.w.MB.botLevelAfterUpgrade(x.sid, batch, { onProgress: (n, t) => prog.push([n, t]) }));
    await x.settle(20);
    const sent = x.sends.filter((s) => s.kind === "level");
    ok(r.v && r.v.ok === true && lastKeys.every((k) => x.level(BOT, k) === TOP) && sent.length === lastKeys.length && sent.every((s) => s.userId === BOT),
      "I " + name + ": THE UPGRADE SETS THE BOT'S LEVEL IN EACH NEW CHANNEL — one level step each, the bot's only", { r: r.v, sent: sent.length, levels: lastKeys.map((k) => x.level(BOT, k)) });
    ok(x.sends.every((s) => s.kind === "level"), "I " + name + ": and nothing else — no invite, no removal (membership is the reconcile's)", x.sends.map((s) => s.kind));
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
    ok(gaps.length > 0 && gaps.every((g) => g >= 1000), "I " + name + ": ONE AT A TIME THROUGH THE PACER — a second or more between sends", gaps);
    ok(prog.length > 0 && prog[prog.length - 1][0] === lastKeys.length && prog[prog.length - 1][1] === lastKeys.length, "I " + name + ": WITH PROGRESS — steps confirmed of steps, to " + lastKeys.length + " of " + lastKeys.length, prog);
    ok(x.line(new RegExp("upgrade — the bot " + BOT + " holds level " + TOP + " in the batch's " + lastKeys.length + " channel\\(s\\)"), from).length === 1,
      "I " + name + ": and the log says it landed", x.line(/MatrixBridge: upgrade/, from));
    // A FAILURE NAMED: one channel refuses.
    const f = rankWorld(mode, { setup: (hs, R, sid) => { for (const id of [sid].concat(Object.keys(R.ch).filter((k) => lastKeys.indexOf(k) < 0).map((k) => R.ch[k]))) hs.rooms[id].power.users[BOT] = TOP; } });
    const bad = lastKeys.find((k) => /^chat_/.test(k)) || lastKeys[0];
    f.script.fn = (s) => (s.kind === "level" && s.roomId === f.ch[bad] ? { error: e403("You don't have permission") } : null);
    const fb = {}; for (const k of lastKeys) fb[k] = f.ch[k];
    const ff = f.w.logs.length;
    const rf = await cap(f.w.MB.botLevelAfterUpgrade(f.sid, fb, {}));
    const lab = "level in " + bad.replace(/_/g, "-");
    ok(rf.v && rf.v.ok === false && JSON.stringify(rf.v.failed) === JSON.stringify([lab]) && rf.v.reason === "refused",
      "I " + name + ": A FAILURE IS NAMED, AS A RANK STEP'S — \"" + lab + "\"", rf.v);
    ok(f.line(new RegExp("the bot " + BOT + " was not given level " + TOP + " everywhere in the batch: stopped: the server refused a step — \\d+ of \\d+ steps confirmed; not confirmed: " + lab + " \\(M_FORBIDDEN\\)"), ff).length === 1,
      "I " + name + ": and the log names the step and the server's error", f.line(/MatrixBridge: upgrade/, ff));
    // NO BOT IN THE ROOM: nothing is sent.
    const z = rankWorld(mode);
    const zb = {}; for (const k of lastKeys) zb[k] = z.ch[k];
    const rz = await cap(z.w.MB.botLevelAfterUpgrade(z.sid, zb, {}));
    ok(rz.v && rz.v.ok === true && rz.v.total === 0 && z.sends.length === 0, "I " + name + ": A ROOM WITH NO BOT — nothing sent", rz.v);
    // A RANK CHANGE RUNNING ON THIS TAB: nothing sent, and the answer says why.
    const q = rankWorld(mode, { setup: (hs, R, sid) => { hs.rooms[sid].power.users[BOT] = TOP; } });
    q.hold();
    const held = q.w.Room.assignRank(THEM, PLAYER);
    await until(() => q.w.Room.rankJob() && q.w.Room.rankJob().state === "running", 400);
    const qb = {}; for (const k of lastKeys) qb[k] = q.ch[k];
    const n0 = q.sends.length;
    const rq = await cap(q.w.MB.botLevelAfterUpgrade(q.sid, qb, {}));
    ok(rq.v && rq.v.ok === false && rq.v.reason === "rank-change-running" && q.sends.length === n0, "I " + name + ": WHILE A RANK CHANGE RUNS ON THIS TAB — nothing sent, and the answer says why", rq.v);
    q.release(); await cap(held);
  }
  {
    // THE WIRING: `RoomUpgrade.upgrade` asks it once the batch is this room's and its marker sent, its progress on the upgrade's
    // bar ("Bot's level"), and answers with it. The real module, its transport and room stood in (their shapes from the real
    // bridge's `createUpgradeBatch` and `botLevelAfterUpgrade`, above, and the real room's `upgradeBotLevel`, PART K), in the
    // page's order. CHANGED ON PURPOSE AT `ddjp_694`: the upgrade asks the ROOM's one rank turn (`Room.upgradeBotLevel`, which
    // waits for a running change and asks the bridge), so the room's stand-in carries it, passing the bridge's answer back, and
    // a wait for a change reaches the bar as the upgrade's waiting line (`onWait` → `onProgress(null, null, text)`). CHANGED ON
    // PURPOSE AT `ddjp_695` (JOB 1): the WHOLE BATCH holds that turn (`Room.upgradeTurn`), from before its start marker to its bot
    // step, so the stand-in carries it too — shaped as the real one: the wait said, then the batch run in the turn it hands over —
    // and the bot step is asked IN that turn (`upgradeBotLevel`'s `turn`), not again.
    const { loadInContext } = require(path.join(__dirname, "_load.js"));
    const calls = [];
    const bridge = { maxUpgradeBatch: () => 3, highestPresentBatch: () => 2, spaceChildLevel: () => 100, getMyPowerLevel: () => 100, onProgress() {},
      createUpgradeBatch: async (sid, ch, n) => { calls.push("create " + n); return { chat_staff: "!cs:hs", events_staff: "!es:hs" }; },
      sendEvent: async (rid, type, body) => { calls.push("send " + type + " " + body.n); },
      botLevelAfterUpgrade: async (sid, added, o) => { calls.push("bot " + sid + " " + Object.keys(added).sort().join(",")); o.onProgress(1, 2); o.onProgress(2, 2);
        return { ok: false, reason: "refused", who: [BOT], done: 1, total: 2, failed: ["level in chat-staff"] }; } };
    const WAIT = "Waiting — a rank change for Them is running";
    const TURN = { room: "!sp:hs" };
    const room = { getCurrent: () => ({ spaceId: "!sp:hs" }), getChannels: () => ({}), mergeChannels: (a) => { calls.push("merge " + Object.keys(a).sort().join(",")); },
      upgradeTurn: async (sid, o, fn) => { calls.push("turn " + sid + " " + o.what); if (typeof o.onWait === "function") o.onWait(WAIT); const r = await fn(TURN); calls.push("turn given back"); return r; },
      upgradeBotLevel: async (sid, added, o) => { calls.push("bot step " + (o.turn === TURN ? "in the turn" : "outside it")); return bridge.botLevelAfterUpgrade(sid, added, o); } };
    const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/roomupgrade.js"],
      { Date, MatrixBridge: bridge, Room: room, StreamManager: { on() {}, off() {} }, Logger: { info() {}, warn() {}, error() {}, debug() {} }, setInterval: () => 0, clearInterval() {} });
    sb.RoomUpgrade.init("!owner:hs");
    const bar = [];
    const ans = await cap(sb.RoomUpgrade.upgrade((n, t, label) => bar.push([n, t, label])));
    ok(JSON.stringify(calls) === JSON.stringify(["turn !sp:hs upgrade", "send ddjp.room.upgrade.start 3", "create 3", "merge chat_staff,events_staff", "send ddjp.room.upgrade.done 3", "bot step in the turn", "bot !sp:hs chat_staff,events_staff", "turn given back"]),
      "I: THE UPGRADE ASKS IT ONCE THE BATCH IS THE ROOM'S AND ITS MARKER SENT — the whole batch in the room's one rank turn (`ddjp_695`), the bot step in it, with the batch's channels", calls);
    ok(JSON.stringify(bar.filter((b) => b[2] === "Bot's level")) === JSON.stringify([[1, 2, "Bot's level"], [2, 2, "Bot's level"]]), "I: ITS PROGRESS ON THE UPGRADE'S BAR — \"Bot's level (N/M)\"", bar);
    ok(bar.some((b) => b[0] === null && b[1] === null && b[2] === WAIT), "I: AND A WAIT FOR A RANK CHANGE ON THE BAR AS THE UPGRADE'S WAITING LINE — \"" + WAIT + "\" (`ddjp_694`)", bar);
    ok(ans.v && ans.v.ok === true && ans.v.batch === 3 && ans.v.bot && ans.v.bot.ok === false && JSON.stringify(ans.v.bot.failed) === JSON.stringify(["level in chat-staff"]),
      "I: AND THE UPGRADE ANSWERS WITH IT — the batch done, what did not land named", ans.v);
    // THE BAR NAMES IT: `runUpgrade` (ui/roster.js), extracted by name and run, its pause stood in.
    const fs = require("fs"), vm = require("vm");
    const roster = fs.readFileSync(path.join(__dirname, "..", "ui/roster.js"), "utf8");
    const a = roster.indexOf("  async function runUpgrade() {"), b = a >= 0 ? roster.indexOf("\n  }\n", a) : -1;
    ok(a >= 0 && b > a, "I: PREMISE — `runUpgrade` found in ui/roster.js");
    if (a >= 0 && b > a) {
      const src = roster.slice(a, b + 4);
      const made = [];
      const H = { el: (tag, attrs, kids) => { const n = { tag, cls: (attrs && attrs.class) || "", textContent: (attrs && attrs.text) || "", style: {}, kids: kids || [] }; made.push(n); return n; },
        clear() {}, startCountdown() {}, clearCountdown() {}, UPGRADE_DONE_PAUSE_MS: () => 0, UPGRADE_NOTE_PAUSE_MS: () => 0 };
      const ctx = { setTimeout: (fn) => setImmediate(fn), Logger: { warn() {}, info() {} }, RoomUpgrade: { isRunning: () => false } };
      vm.createContext(ctx);
      const mk = (answer) => vm.runInContext("(function (refs, H, Actions) { function renderUpgradePanel() {} " + src + " return runUpgrade; })", ctx)({ upgradeSlot: { appendChild() {} } }, H,
        { perform: async () => answer });
      const labelOf = () => (made.find((n) => n.cls === "upgrade-bar-label") || {}).textContent;
      await mk({ ok: true, batch: 3, bot: { ok: false, failed: ["level in chat-staff"] } })();
      ok(labelOf() === "Done — the bot's level not confirmed: level in chat-staff", "I: THE BAR NAMES WHAT DID NOT LAND — \"Done — the bot's level not confirmed: level in chat-staff\"", labelOf());
      made.length = 0;
      await mk({ ok: true, batch: 3, bot: { ok: true, failed: [] } })();
      ok(labelOf() === "Done", "I: CONTROL — all landed: \"Done\"", labelOf());
      // THE UPGRADE WAITING FOR A RANK CHANGE (`ddjp_694`): the bar reads the room's words while it waits.
      made.length = 0;
      let seen = null;
      const mw = vm.runInContext("(function (refs, H, Actions) { function renderUpgradePanel() {} " + src + " return runUpgrade; })", ctx)({ upgradeSlot: { appendChild() {} } }, H,
        { perform: async (action, a) => { a.onProgress(null, null, WAIT); seen = labelOf(); return { ok: true, batch: 3, bot: { ok: true, failed: [] } }; } });
      await mw();
      ok(seen === WAIT, "I: WHILE THE UPGRADE WAITS FOR A RANK CHANGE THE BAR SAYS SO — \"" + WAIT + "\"", seen);
    }
  }

  // ═══ PART J — THE ROOM'S BOT HOLDS ITS LEVEL IN EVERY CHANNEL (`ddjp_694`) ═══════════════════════════════════════════════════
  // A room made before `ddjp_693`, its bot appointed before its last upgrade: the bot's level set in the Space and every channel
  // that existed then, and a channel the upgrade made later names only its creator. Decision 2 (a channel made after a person's
  // rank was set, never naming them, does not count) left the bot in step there — no rights in that channel, and nothing shown.
  // For the bot every channel a change sets counts; everyone else keeps decision 2 (the Staff member beside it, the control).
  // CHANGED ON PURPOSE AT `ddjp_695` (JOB 1, the owner's "ok"): decision 2 is gone for EVERYONE — the Staff member beside the bot,
  // ranked before the same upgrade, is out of step too, repaired to Staff (the level the rooms naming them agree on, `by:
  // "named"`, which replaced `"bot"`). The control is the person no room names (`OTHER`): in step, never ringed.
  const LATE = "chat_staff";   // in both plans: in a shared room it is the last batch's
  const oldRoom = (late, extra) => (hs, R, sid, setPL, made) => {
    const ids = [sid].concat(Object.values(R.ch));
    for (const id of ids) hs.rooms[id].members[BOT] = "join";   // the reconcile admitted it everywhere its level belongs
    hs.rooms[R.ch.chat_guest].members[THEM] = "join"; hs.rooms[R.ch.chat_staff].members[THEM] = "join";
    const lateIds = late.map((k) => R.ch[k]);
    for (const id of ids.filter((i) => lateIds.indexOf(i) < 0)) setPL(id, { users: { [ME]: 100, [BOT]: TOP, [THEM]: STAFF }, users_default: 0 }, T0 + 5000, { live: false });
    for (const id of lateIds) made[id] = T0 + 9000;   // made by a later upgrade: its power levels name only its creator
    if (extra) extra(hs, R, sid, setPL, made, ids, lateIds);
  };
  const B_NAME = "B";
  const botCard = (x, o) => card(x, BOT, Object.assign({ member: { userId: BOT, name: B_NAME, level: TOP } }, o || {}));
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode, { setup: oldRoom([LATE]) });
    if (typeof x.w.Room.rankStanding !== "function") { ok(false, "J " + name + ": APPLIED — `Room.rankStanding`, the rule"); continue; }
    const n = levelRooms(x) - 1;
    ok(x.level(BOT) === TOP && x.level(BOT, LATE) === 0 && x.level(THEM, LATE) === 0 && x.w.MB.accountsAtLevel(x.sid, TOP).who.join() === BOT,
      "J " + name + ": PREMISE — the room's bot at " + TOP + " in the Space and every channel but `" + LATE + "`, made later, which names neither it nor the Staff member");
    const made = T0 + 9000;
    x.server.at = made + 5000;
    const s0 = x.standing(BOT);
    ok(s0 && s0.outOfStep === true && s0.space === TOP && s0.channels === n && JSON.stringify(s0.byLevel) === JSON.stringify([{ level: TOP, n: n - 1 }, { level: 0, n: 1 }]),
      "J " + name + ": THE BOT MISSING ONE LATE CHANNEL'S LEVEL IS OUT OF STEP — every channel a change sets counts for it: " + TOP + " in " + (n - 1) + ", 0 in 1 of " + n, s0);
    ok(s0 && s0.target === TOP && s0.by === "named", "J " + name + ": ITS REPAIR TARGET IS BOT — read from the rooms that name it, never the late channel's default", s0 && { target: s0.target, by: s0.by });
    ok(s0 && s0.since === made && s0.ring === false, "J " + name + ": THE RING WAITS — five seconds after the channel was made, none (`since` its making)", s0 && { since: s0.since, ring: s0.ring });
    x.server.at = made + x.w.MB.RANK_LIMIT_MS + 1;
    const s1 = x.standing(BOT), st = x.standing(THEM);
    ok(s1.ring === true, "J " + name + ": AFTER THE MINUTE, THE RING", s1);
    ok(st && st.outOfStep === true && st.target === STAFF && st.by === "named" && st.ring === true,
      "J " + name + ": THE STAFF MEMBER IN THE SAME ROOM, the same late channel naming them neither: out of step too, repaired to " + LABEL(STAFF) + ", the ring after the minute (`ddjp_695`: every channel counts, for everyone)", st);
    const so = x.standing(OTHER);
    ok(so && so.outOfStep === false && so.ring === false, "J " + name + ": CONTROL — THE PERSON NO ROOM NAMES: in step, no ring", so);
    // On the screen: People rings the bot, drawn by the sheet, and not the Staff member.
    const sc = await screen(x, OTHER);
    sc.w.sb.Roster.renderRoster();
    ok(ringed(peopleAv(sc, x, BOT)) && outlineOf(sc, peopleAv(sc, x, BOT)) === "2px solid #ff6b6b" && ringed(peopleAv(sc, x, THEM)) && outlineOf(sc, peopleAv(sc, x, THEM)) === "2px solid #ff6b6b" &&
       peopleAv(sc, x, OTHER) && !ringed(peopleAv(sc, x, OTHER)) && !outlineOf(sc, peopleAv(sc, x, OTHER)),
      "J " + name + ": PEOPLE — THE BOT'S PICTURE AND THE STAFF MEMBER'S RINGED, DRAWN; THE PERSON NO ROOM NAMES NOT", { bot: peopleAv(sc, x, BOT) && peopleAv(sc, x, BOT).className, them: peopleAv(sc, x, THEM) && peopleAv(sc, x, THEM).className, other: peopleAv(sc, x, OTHER) && peopleAv(sc, x, OTHER).className });
    // The card: the line, Repair to Bot for the owner (this account, at 100), and "Owner can repair it." for anyone else.
    const c = botCard(x);
    x.w.Room.onRankChange(() => c.refresh());
    const want = B_NAME + "'s rank isn't the same everywhere in this room: " + LABEL(TOP) + " in the room, " + LABEL(0) + " in 1 of its " + n + " channels.";
    ok(offOf(c) && offOf(c).indexOf(want) === 0, "J " + name + ": THE CARD'S LINE — \"" + want + "\"", offOf(c));
    const b = repairs(c)[0];
    ok(repairs(c).length === 1 && b.text === "Repair to Bot" && !b.disabled && typeof b.onclick === "function", "J " + name + ": \"REPAIR TO BOT\", LIVE FOR THE OWNER", repairs(c).map((q) => [q.text, q.disabled]));
    const sv = rankWorld(mode, { reload: x });
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = STAFF;
    sv.server.at = x.server.at;
    const cs = card(sv, BOT, { member: { userId: BOT, name: B_NAME, level: TOP } });
    ok(repairs(cs).length === 0 && (offOf(cs) || "").split(" | ")[1] === "Owner can repair it.", "J " + name + ": THE OWNER ONLY — a Staff viewer sees no Repair, and \"Owner can repair it.\"", offOf(cs));
    for (const id of [x.sid].concat(Object.values(x.ch))) x.hs.rooms[id].power.users[ME] = 100;
    if (!b || typeof b.onclick !== "function") continue;   // no Repair to press (a tree before `ddjp_694`): its rows above say so
    // THE REPAIR: the rank change itself, to Bot, marked a repair; its progress over a bar; the one missing level sent, and only
    // it; done — in step everywhere, "Bot ✓", the ring gone.
    const from = x.w.logs.length;
    x.hold();
    b.onclick();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
    const j = x.w.Room.rankJob();
    ok(j && j.repair === true && j.level === TOP && j.userId === BOT, "J " + name + ": REPAIR STARTS THE RANK CHANGE ITSELF, marked a repair, to Bot", j);
    const bar = byClass(c, "uc-rank-bar")[0];
    ok(new RegExp("^Repairing " + B_NAME + "'s rank… \\d+ of \\d+$").test(lineOf(c) || "") && bar, "J " + name + ": WITH PROGRESS — \"Repairing " + B_NAME + "'s rank… N of M\" over a bar", lineOf(c));
    x.release();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running");
    await x.settle(20);
    ok(x.sends.length === 1 && x.sends[0].kind === "level" && x.sends[0].roomId === x.ch[LATE] && x.sends[0].userId === BOT && x.level(BOT, LATE) === TOP,
      "J " + name + ": THE REPAIR GIVES THE MISSING CHANNEL THE BOT'S LEVEL — one level step, `" + LATE + "`, and nothing else sent", x.sends.map((s) => [s.kind, s.userId, s.roomId]));
    ok(x.w.Room.rankJob().state === "done" && x.standing(BOT).outOfStep === false && x.standing(BOT).ring === false && lineOf(c) === LABEL(TOP) + " ✓",
      "J " + name + ": DONE — in step everywhere, the ring gone, \"Bot ✓\"", { job: x.w.Room.rankJob(), line: lineOf(c) });
    ok(x.line(new RegExp("MatrixBridge: assigned " + BOT + " to level " + TOP + " \\(all channels reconciled — (\\d+) of \\1 steps confirmed\\)"), from).length === 1,
      "J " + name + ": and the log says it landed", x.line(/MatrixBridge: (assigned|rank change)/, from));
  }
  for (const [mode, name] of MODES) {
    // SEVERAL LATE CHANNELS (a shared room's whole last batch; in a bot room two): each missing level sent, paced, counted, and a
    // refusal named where the repair stopped, with Repair again.
    const late = mode === "backend1" ? rankWorld(mode).plan.filter((r) => r.batch === rankWorld(mode).plan.reduce((m, q) => Math.max(m, q.batch || 1), 1)).map((r) => r.key) : ["chat_guest", LATE];
    const x = rankWorld(mode, { setup: oldRoom(late) });
    if (typeof x.w.Room.rankStanding !== "function") continue;
    x.server.at = T0 + 9000 + x.w.MB.RANK_LIMIT_MS + 1;
    const s = x.standing(BOT);
    const lateLevels = late.filter((k) => !/presence/.test(k) || x.hs.rooms[x.ch[k]].members[ME] === "join").length;
    ok(s.outOfStep === true && s.target === TOP && s.ring === true && s.byLevel.some((q) => q.level === 0 && q.n === lateLevels),
      "J " + name + ": " + lateLevels + " LATE CHANNELS — out of step, the ring, Bot the target", s);
    ok(x.standing(THEM).outOfStep === true && x.standing(THEM).target === STAFF, "J " + name + ": and the Staff member: out of step, repaired to " + LABEL(STAFF) + " (`ddjp_695`)", x.standing(THEM));
    ok(x.standing(OTHER).outOfStep === false, "J " + name + ": CONTROL — the person no room names: in step", x.standing(OTHER));
    const bad = late[late.length - 1] === "presence_chat" ? late[late.length - 2] : late[late.length - 1];
    x.script.fn = (q) => (q.kind === "level" && q.roomId === x.ch[bad] ? { error: e403("You don't have permission") } : null);
    const c = botCard(x);
    x.w.Room.onRankChange(() => c.refresh());
    const prog = [];
    x.w.Room.onRankJob((jj) => { if (jj && jj.userId === BOT) prog.push(jj.done + "/" + jj.total); });
    const from = x.w.logs.length;
    const rb = repairs(c)[0];
    ok(rb && typeof rb.onclick === "function" && rb.text === "Repair to Bot", "J " + name + ": PREMISE — Repair to Bot on the card", rb && rb.text);
    if (!rb || typeof rb.onclick !== "function") continue;
    rb.onclick();
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "failed");
    await x.settle(10);
    const lv = x.sends.filter((q) => q.kind === "level");
    const gaps = x.sends.slice(1).map((q, i) => q.at - x.sends[i].at);
    ok(lv.length >= lateLevels && lv.every((q) => q.userId === BOT && late.some((k) => x.ch[k] === q.roomId)), "J " + name + ": THE REPAIR SENDS THE MISSING LEVELS ONLY — the late channels', the bot's", lv.map((q) => q.roomId));
    ok(gaps.length > 0 && gaps.every((g) => g >= 1000), "J " + name + ": PACED — a second or more between its sends", gaps);
    ok(prog.length > 1 && new Set(prog).size > 1, "J " + name + ": WITH PROGRESS — steps confirmed of steps, counting", prog);
    const lab = "level in " + bad.replace(/_/g, "-");
    ok(new RegExp("^Repair stopped at \\d+ of \\d+ — not confirmed: " + lab + " \\| Repair again$").test(lineOf(c) || ""),
      "J " + name + ": A FAILURE NAMED — \"Repair stopped at N of M — not confirmed: " + lab + "\", and Repair again", lineOf(c));
    ok(x.line(new RegExp("rank change for " + BOT + " to level " + TOP + " stopped: the server refused a step — \\d+ of \\d+ steps confirmed; not confirmed: " + lab + " \\(M_FORBIDDEN\\)"), from).length === 1,
      "J " + name + ": and the log names the step and the server's error", x.line(/MatrixBridge: rank change/, from));
  }
  for (const [mode, name] of MODES) {
    // AFTER A RELOAD, WHEN THIS DEVICE CANNOT PLACE THE BOT'S SET: (a) a change for someone else rewrote the earlier rooms before
    // the upgrade; (b) after it, the late channel too. The late channel's making must never become the bot's target (a repair
    // that demotes it), nor "can't tell": the rooms that name it say Bot.
    const before = rankWorld(mode, { setup: oldRoom([LATE], (hs, R, sid, setPL, made, ids, lateIds) => {
      for (const id of ids.filter((i) => lateIds.indexOf(i) < 0)) setPL(id, { users: { [ME]: 100, [BOT]: TOP, [THEM]: STAFF, [OTHER]: GUEST }, users_default: 0 }, T0 + 7000, { live: false });
    }) });
    if (typeof before.w.Room.rankStanding !== "function") continue;
    const after = rankWorld(mode, { setup: oldRoom([LATE], (hs, R, sid, setPL, made, ids) => {
      for (const id of ids) setPL(id, { users: Object.assign({}, hs.rooms[id].power.users, { [OTHER]: GUEST }), users_default: 0 }, T0 + 9500, { live: false });
    }) });
    for (const [x, what] of [[rankWorld(mode, { reload: before }), "a change for someone else BEFORE the upgrade"], [rankWorld(mode, { reload: after }), "one AFTER it"]]) {
      const s = x.standing(BOT);
      ok(s && s.outOfStep === true && s.target === TOP && s.by === "named", "J " + name + ": AFTER A RELOAD, THE BOT'S SET UNPLACEABLE (" + what + ") — still Bot the target, never the default nor \"can't tell\"", s && { target: s.target, by: s.by });
      const c = botCard(x);
      ok(repairs(c).map((q) => q.text).join() === "Repair to Bot" && !/can't tell/.test(offOf(c) || ""), "J " + name + ": and the card offers Repair to Bot alone (" + what + ")", { off: offOf(c), repairs: repairs(c).map((q) => q.text) });
    }
  }

  // ═══ PART L — STAFF RANKED BEFORE AN UPGRADE, AFTER A RELOAD (`ddjp_695`, JOB 1; 694's finding) ════════════════════════════════
  // 694 found, driven on 693's code: the Staff member beside the bot, ranked before the room's last upgrade, read after a reload
  // with no target ("can't tell", Repair to Staff and to Uncategorized — a change for someone else after the upgrade) or with
  // Uncategorized as the target (the upgrade after the last change: a repair that demotes). Every channel counts now, and the
  // target is read from the rooms that name them: Staff in both, the card's one Repair, and the repair gives the late channel
  // their level — one level step, and nothing else. RED ON 694 at the rows naming Staff.
  for (const [mode, name] of MODES) {
    const before = rankWorld(mode, { setup: oldRoom([LATE], (hs, R, sid, setPL, made, ids, lateIds) => {
      for (const id of ids.filter((i) => lateIds.indexOf(i) < 0)) setPL(id, { users: { [ME]: 100, [BOT]: TOP, [THEM]: STAFF, [OTHER]: GUEST }, users_default: 0 }, T0 + 7000, { live: false });
    }) });
    if (typeof before.w.Room.rankStanding !== "function") continue;
    const after = rankWorld(mode, { setup: oldRoom([LATE], (hs, R, sid, setPL, made, ids) => {
      for (const id of ids) setPL(id, { users: Object.assign({}, hs.rooms[id].power.users, { [OTHER]: GUEST }), users_default: 0 }, T0 + 9500, { live: false });
    }) });
    for (const [x, what, was] of [[rankWorld(mode, { reload: before }), "the upgrade after the last change", "694: Uncategorized, a repair that demotes"],
                                  [rankWorld(mode, { reload: after }), "a change for someone else after the upgrade", "694: no target, Repair to Staff and to Uncategorized"]]) {
      x.server.at = T0 + 9500 + x.w.MB.RANK_LIMIT_MS + 1;
      const s = x.standing(THEM);
      ok(s && s.outOfStep === true && s.target === STAFF && s.by === "named" && s.ring === true,
        "L " + name + ": STAFF RANKED BEFORE THE UPGRADE, AFTER A RELOAD (" + what + ") — out of step, the target " + LABEL(STAFF) + " (" + was + ")", s && { outOfStep: s.outOfStep, target: s.target, by: s.by, ring: s.ring });
      const c = card(x, THEM, { member: { userId: THEM, name: "Them", level: STAFF } });
      x.w.Room.onRankChange(() => c.refresh());
      const off = offOf(c) || "";
      ok(repairs(c).map((q) => q.text).join() === "Repair to " + LABEL(STAFF) && !/can't tell/.test(off) && off.indexOf("Them's rank isn't the same everywhere in this room: " + LABEL(STAFF) + " in the room, " + LABEL(0) + " in 1 of its ") === 0,
        "L " + name + ": THE CARD SAYS SO AND OFFERS \"Repair to " + LABEL(STAFF) + "\" ALONE (" + what + ")", { off: off, repairs: repairs(c).map((q) => q.text) });
      const b = repairs(c)[0];
      if (!b || typeof b.onclick !== "function") continue;
      const n0 = x.sends.length;
      b.onclick();
      await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running", 400);
      await x.settle(20);
      const sent = x.sends.slice(n0);
      ok(x.w.Room.rankJob().state === "done" && sent.length === 1 && sent[0].kind === "level" && sent[0].roomId === x.ch[LATE] && sent[0].userId === THEM && x.level(THEM, LATE) === STAFF,
        "L " + name + ": THE REPAIR GIVES THE LATE CHANNEL THEIR LEVEL — one level step, `" + LATE + "`, nothing else (" + what + ")", sent.map((q) => [q.kind, q.userId, q.roomId]));
      ok(x.standing(THEM).outOfStep === false && x.standing(THEM).ring === false, "L " + name + ": DONE — in step, the ring gone (" + what + ")", x.standing(THEM));
    }
  }

  // ═══ PART K — A RANK CHANGE AND AN UPGRADE'S BOT STEP GO ONE AT A TIME (`ddjp_694`) ═══════════════════════════════════════════
  // At 693 a card's change started while an upgrade gave the bot its level was not refused, and leaving stopped only one of the
  // two. Now the upgrade's bot step takes the room's one rank turn (`Room.upgradeBotLevel`): it waits for a running change; while
  // it waits or runs a change is refused and every picker waits, saying why; the leave stops both. In a shared room (a room built
  // in one piece has no upgrade).
  {
    const mode = "backend1", name = "shared room";
    const plan = rankWorld(mode).plan, top = plan.reduce((m, r) => Math.max(m, r.batch || 1), 1);
    const lastKeys = plan.filter((r) => r.batch === top).map((r) => r.key);
    const kRoom = () => rankWorld(mode, { setup: (hs, R, sid) => { for (const id of [sid].concat(Object.keys(R.ch).filter((k) => lastKeys.indexOf(k) < 0).map((k) => R.ch[k]))) hs.rooms[id].power.users[BOT] = TOP; } });
    const batchOf = (x) => { const b = {}; for (const k of lastKeys) b[k] = x.ch[k]; return b; };
    const UP = "Waiting — the room is upgrading";
    const x0 = kRoom();
    ok(typeof x0.w.Room.upgradeBotLevel === "function" && typeof x0.w.Room.upgradeBotStep === "function",
      "K " + name + ": APPLIED — the room's one rank turn for an upgrade's bot step (`Room.upgradeBotLevel`, `Room.upgradeBotStep`)");
    if (typeof x0.w.Room.upgradeBotLevel === "function") {
      // ── ORDER 1: THE BOT STEP RUNS; A CARD'S CHANGE IS ASKED ──
      const x = kRoom();
      x.hold();
      const prog = [];
      const up = cap(x.w.Room.upgradeBotLevel(x.sid, batchOf(x), { onProgress: (a, t) => prog.push([a, t]) }), 8000);
      await until(() => x.sends.length > 0, 400);
      const st = x.w.Room.upgradeBotStep();
      ok(st && st.state === "running" && st.text === UP && x.sends.every((s) => s.userId === BOT), "K " + name + ": PREMISE — the upgrade's bot step runs, its first level held in flight", st);
      const n0 = x.sends.length, from = x.w.logs.length;
      const r2 = await cap(x.w.Room.assignRank(THEM, PLAYER), 1500);
      ok(r2.v && r2.v.ok === false && r2.v.reason === "room-upgrading" && x.w.Room.rankJob() === null && x.sends.slice(n0).every((s) => s.userId !== THEM),
        "K " + name + ": A RANK CHANGE ASKED WHILE THE BOT STEP RUNS IS REFUSED BY NAME — room-upgrading, no change started, nothing sent", r2);
      ok(x.line(new RegExp("Room: the room is upgrading — the bot's level in its new channels is being set — this rank change, " + THEM + " to level " + PLAYER + ", was not started"), from).length === 1,
        "K " + name + ": and the log says so", x.line(/Room:/, from));
      const d = x.w.sb.Actions.describe("rank.assign", { userId: THEM, targetRank: 0 });
      ok(!d.enabled && d.reason === UP, "K " + name + ": EVERY RANK PICKER WAITS — the adapter: not available, \"" + UP + "\"", d);
      const c = card(x, THEM);
      const pk = nodes(c).find((k) => k.tag === "select");
      ok(c.ok && pk && pk.disabled && pk.title === UP && lineOf(c) === UP && !pk.onchange,
        "K " + name + ": THE CARD'S PICKER WAITS, SAYING WHY — greyed, \"" + UP + "\", the line the same, and it cannot ask", { title: pk && pk.title, line: lineOf(c), disabled: pk && pk.disabled });
      x.release();
      const ru = await up;
      await x.settle(20);
      ok(ru.v && ru.v.ok === true && lastKeys.every((k) => !/presence/.test(k) ? x.level(BOT, k) === TOP : true) && x.w.Room.upgradeBotStep() === null && prog.length > 0,
        "K " + name + ": THE STEP LANDS — the bot's level in the batch's channels, the turn given back", { r: ru.v, step: x.w.Room.upgradeBotStep() });
      const live = nodes(c).find((k) => k.tag === "select");
      ok(x.w.sb.Actions.describe("rank.assign", { userId: THEM, targetRank: 0 }).enabled && live && !live.disabled && !lineOf(c),
        "K " + name + ": AND THE PICKERS ARE LIVE AGAIN, the card repainted at the step's end — the line gone", { line: lineOf(c), disabled: live && live.disabled });
      const r3 = await cap(x.w.Room.assignRank(THEM, PLAYER));
      await x.settle(20);
      ok(r3.v && r3.v.ok === true && x.level(THEM) === PLAYER, "K " + name + ": a change asked after it runs", r3.v);
    }
    if (typeof x0.w.Room.upgradeBotLevel === "function") {
      // ── ORDER 2: A CHANGE RUNS; THE UPGRADE ASKS ──
      const x = kRoom();
      x.hold();
      const ch = cap(x.w.Room.assignRank(THEM, STAFF), 8000);
      await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
      const waits = [], from = x.w.logs.length;
      const up = cap(x.w.Room.upgradeBotLevel(x.sid, batchOf(x), { onWait: (t) => waits.push(t) }), 8000);
      await x.settle(10);
      const st = x.w.Room.upgradeBotStep();
      ok(st && st.state === "waiting" && x.sends.every((s) => s.userId === THEM), "K " + name + ": AN UPGRADE ASKED WHILE A CHANGE RUNS WAITS — nothing sent for the bot", { st, sent: x.sends.map((s) => s.userId) });
      const jn = x.w.Room.rankJob().name;   // the running change's person, named as the room names them
      ok(waits.length === 1 && waits[0] === "Waiting — a rank change for " + jn + " is running" && x.line(new RegExp("Room: the upgrade waits for the rank change for " + jn + " \\(\\d+ of \\d+\\) before giving the bot its level in the batch's channels"), from).length === 1,
        "K " + name + ": and says so — on the upgrade's bar and in the log", { waits, log: x.line(/Room:/, from) });
      // THE TURN IS KEPT: a change asked at the very moment the running one ends is refused — the step goes first.
      let sneak = null;
      x.w.Room.onRankJob((jj) => { if (sneak === null && jj && jj.userId === THEM && jj.state !== "running") sneak = x.w.Room.assignRank(OTHER, PLAYER); });
      x.release();
      const rc = await ch, ru = await up;
      await x.settle(20);
      const sv = sneak ? await cap(sneak, 1500) : null;
      ok(sv && sv.v && sv.v.ok === false && sv.v.reason === "room-upgrading", "K " + name + ": THE TURN IS KEPT — a change asked as the running one ends is refused, room-upgrading", sv && sv.v);
      const firstBot = x.sends.findIndex((s) => s.userId === BOT), lastThem = x.sends.map((s) => s.userId).lastIndexOf(THEM);
      ok(rc.v && rc.v.ok === true && ru.v && ru.v.ok === true && firstBot > lastThem && x.sends.every((s) => s.userId !== OTHER),
        "K " + name + ": ONE AFTER THE OTHER — the change lands, then the bot step sends and lands; nothing for the change refused", { change: rc.v, step: ru.v, order: x.sends.map((s) => s.userId) });
    }
    if (typeof x0.w.Room.upgradeBotLevel === "function") {
      // ── THE LEAVE, THE STEP RUNNING: it stops, nothing more sent ──
      const x = kRoom();
      x.hold();
      const up = cap(x.w.Room.upgradeBotLevel(x.sid, batchOf(x), {}), 8000);
      await until(() => x.sends.length > 0, 400);
      const from = x.w.logs.length;
      try { x.w.Room.leave("the guard leaves"); } catch (e) {}
      const n0 = x.sends.length;
      x.release();
      const r = await up;
      await x.settle(30);
      ok(r.v && r.v.ok === false && r.v.reason === "stopped" && x.sends.length === n0 && x.w.Room.upgradeBotStep() === null,
        "K " + name + ": LEAVING STOPS A RUNNING BOT STEP — it answers stopped, nothing more is sent, its state goes with the room", { r: r.v, more: x.sends.length - n0 });
      ok(x.line(new RegExp("upgrade — the bot " + BOT + " was not given level " + TOP + " everywhere in the batch: stopped when the room was left"), from).length === 1,
        "K " + name + ": and the log says why", x.line(/MatrixBridge: upgrade/, from));
    }
    if (typeof x0.w.Room.upgradeBotLevel === "function") {
      // ── THE LEAVE, THE STEP WAITING FOR A CHANGE: both stop; nothing is ever sent for the bot ──
      const x = kRoom();
      x.hold();
      const ch = cap(x.w.Room.assignRank(THEM, STAFF), 8000);
      await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 400);
      const up = cap(x.w.Room.upgradeBotLevel(x.sid, batchOf(x), {}), 8000);
      await x.settle(10);
      const from = x.w.logs.length;
      try { x.w.Room.leave("the guard leaves"); } catch (e) {}
      const n0 = x.sends.length;
      x.release();
      const rc = await ch, ru = await up;
      await x.settle(30);
      ok(rc.v && rc.v.reason === "stopped" && ru.v && ru.v.reason === "stopped" && x.sends.length === n0 && x.sends.every((s) => s.userId !== BOT),
        "K " + name + ": LEAVING STOPS BOTH — the change and the bot step waiting for it answer stopped, nothing more is sent, nothing ever for the bot", { change: rc.v, step: ru.v, more: x.sends.length - n0 });
      ok(x.w.Room.rankJob() === null && x.w.Room.upgradeBotStep() === null && x.line(/Room: the upgrade's step for the bot's level stopped when the room was left — nothing sent/, from).length === 1,
        "K " + name + ": both states go with the room, and the log says the step sent nothing", { job: x.w.Room.rankJob(), step: x.w.Room.upgradeBotStep(), log: x.line(/Room:/, from) });
    }
  }

  if (failed) { console.log("[rank-trust] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[rank-trust] PASS — ranks you can trust (the owner's plan, part 1), in a shared room and in a bot room, through the real " +
    "bridge, room, adapter, card and screen (" + asserts + " assertions): a person whose level is not the same in every room a change " +
    "sets it in is out of step — never a creator, the presence chat where this account is not in it, or a channel not created yet — " +
    "and the repair's target is the level set last, by the server time of the event that set it, a tie to the Space, nothing assumed " +
    "where this device cannot tell; it is read from the rooms' state, so a reload reads the same; a thin red ring marks their picture " +
    "in People, chat rows, the player's line and the header's own, drawn by the sheet on the picture inside; the card says what each " +
    "room says and repairs it, behind its lock, for whoever may give the rank (for Bot the owner only, greyed while another holds it), " +
    "naming the rank that may to anyone else; a repair says so over a bar, stops at the minute naming what is left, offers Repair again, and the " +
    "ring goes when it lands; an ordinary change shows the same bar; every send is paced, a second apart at least and wider after a push-back; " +
    "the ring waits for a change's minute in server time, the card's own picture rings too, the Bot choice waits for the room's last upgrade, " +
    "and an upgrade gives a bot already there its level in the new channels, naming what did not land.");
  process.exit(0);
})().catch((e) => { console.log("[rank-trust] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
