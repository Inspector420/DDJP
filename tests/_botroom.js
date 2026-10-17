// tests/_botroom.js
// THE ONE BOT-ROOM WORLD — a harness, not a guard (no `check-` prefix, so `run-all` does not run it). Moved out of
// `check-bot-restore.js` at J80 so `check-runner-room-change` drives the SAME real modules behind the SAME seam rather than a
// second copy of the world: two doubles of one room is the copied-rule shape, one level out (the `_chat-world.js` precedent).
// `check-bot-restore`'s rows stay where they are; only the world moved, unchanged — with the defaults below, `world(o)` builds
// exactly what it built inside that guard.
//
// WHAT IS REAL: every backend module of both engines, the seam (`core/backends.js`), `features/room.js` and `features/actions.js`,
// loaded in `index.html`'s order. WHAT IS A DOUBLE, AND WHY: the SDK client (no homeserver) — rooms whose creator is OWNER (room
// v12 => 100), power levels from LEVELS, send levels per channel; and the feature modules a room wires but these guards do not
// judge (deep proxies that answer anything with nothing).
//
// THREE OPT-INS, OFF by default so the world above is unchanged (`o.timers` and `o.fanOut` at J80, `o.extras` at J83):
//   · `o.timers` — the sandbox's timers are CAPTURED instead of swallowed, so a guard can fire the runner's own beats
//     (`w.timers.fire(ms)` runs every live interval of that period; cleared timers are gone, as in a browser).
//   · `o.fanOut` — the raw fan-out (`MatrixBridge.onRawEvent`) is RECORDED as it is subscribed, delegating to the real one, so
//     `w.deliver(raw)` can do what `_ingestSpineEvent` does with a live event: the room-scope gate, the cache, the door, and
//     then every raw listener still subscribed — the route the runner hears the room by.
//   · `o.extras` (J83) — globals laid OVER the defaults below, for a guard that loads the REAL feature modules (`o.order`) and
//     must hand them what they read (`Store`'s queue and config, `sessionStorage`). `w.timers.live()` lists the live timers.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

// ── THE WORLD: the real modules, in `index.html`'s order, behind the real seam ────────────────────────────────────────────
const ORDER = ["core/logger.js", "core/backends.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js",
  "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
  "backends/backend1/checkpoint.js", "backends/backend1/continuity.js", "backends/backend1/history.js",
  "backends/backend1/settingsproof.js", "backends/backend1/matrixbridge.js", "backends/backend2/transport.js",
  "backends/backend2/runner.js", "backends/backend1/matrixaccount.js", "backends/backend2/skeleton.js",
  "features/room.js", "features/actions.js"];
const noop = () => {};
const deep = () => new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : deep()), apply: () => undefined });
// The bot runtime's display rule offers every act to every caller here, so what refuses the bot below is the VERB itself.
const botRuntime = () => new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : (k === "mayOffer" ? () => ({ may: true, why: null }) : deep())), apply: () => undefined });
const OWNER = "@owner:hs", BOT = "@bot:hs", ADMIN = "@admin:hs", STAFF = "@staff:hs", HS = "@hs:hs", VIP = "@vip:hs";
const SPACE = "!space:hs";
const BOT_CH = { events_uncategorized: "!intents:hs", events_owner: "!log:hs", settings_owner: "!set:hs" };
const FULL_CH = { events_uncategorized: "!e0:hs", events_owner: "!e99:hs", settings_owner: "!s99:hs", checkpoints_owner: "!c99:hs" };
const LEVELS = { [BOT]: 99, [ADMIN]: 99, [HS]: 75, [STAFF]: 50, [VIP]: 25 };   // the creator OWNER reads 100 (room v12); ADMIN is a top-rung human, not the creator
const quiet = { info() {}, warn() {}, debug() {}, error() {} };

// A Matrix event as the SDK hands it over: the raw JSON on `.event`, and the getters the bridge reads.
const mev = (raw) => ({ event: raw, getId: () => raw.event_id, getType: () => raw.type, getSender: () => raw.sender,
  getTs: () => raw.origin_server_ts, getContent: () => raw.content, getUnsigned: () => ({}), isRedacted: () => false,
  getRoomId: () => raw.room_id });
const SEND_LEVEL = { events_uncategorized: 0, events_owner: 99, settings_owner: 99, checkpoints_owner: 99 };

// THE CAPTURED TIMERS (`o.timers`). Ids are distinct and a cleared timer is gone, as in a browser; nothing fires on its own.
function timerBox() {
  const live = new Map();
  let n = 0;
  const add = (kind) => (fn, ms) => { const id = ++n; live.set(id, { kind, fn, ms: ms || 0 }); return id; };
  const drop = (id) => { live.delete(id); };
  return {
    setInterval: add("interval"), setTimeout: add("timeout"), clearInterval: drop, clearTimeout: drop,
    // Every live INTERVAL of that period, once; a timeout of that period fires and is gone. Answers how many ran.
    fire(ms) {
      let ran = 0;
      for (const [id, t] of Array.from(live.entries())) {
        if (t.ms !== ms || !live.has(id)) continue;
        if (t.kind === "timeout") live.delete(id);
        t.fn(); ran++;
      }
      return ran;
    },
    count: (ms) => Array.from(live.values()).filter((t) => ms === undefined || t.ms === ms).length,
    live: () => Array.from(live.entries()).map(([id, t]) => ({ id: id, kind: t.kind, ms: t.ms, fn: t.fn })),
  };
}

// ONE DEVICE. `o.server` is the room as its homeserver holds it ({ roomId: [raw, ...] }, oldest first) — shared by every device
// of one story, so what one device posts another pages. `o.storedTable` and `o.cache` are what a reload finds on disk: the
// song-history table (`Store.history`) and the raw cache (`EventCache`, rehydrated from IndexedDB). `o.opened: false` leaves
// the device replaying until `open()`; otherwise it is caught up from the start, and `o.live: false` keeps it loading.
function world(o) {
  o = o || {};
  const mode = o.mode || "backend2", CH = mode === "backend2" ? BOT_CH : FULL_CH, me = o.me || OWNER;
  const server = o.server || {};
  const sent = [], logs = [], stored = { snap: o.storedTable || null };
  let pages = 0;
  const timers = o.timers ? timerBox() : null;
  const sb = loadInContext(o.order || ORDER, Object.assign({
    Date, Math, JSON, Promise,
    setTimeout: timers ? timers.setTimeout : () => 1, clearTimeout: timers ? timers.clearTimeout : noop,
    setInterval: timers ? timers.setInterval : () => 1, clearInterval: timers ? timers.clearInterval : noop,
    window: { addEventListener: noop }, document: { addEventListener: noop, visibilityState: "visible" },
    navigator: { onLine: true }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    Store: { history: { load: async () => stored.snap, persist: (sid, snap) => { stored.snap = JSON.parse(JSON.stringify(snap)); } } },
    StorageIO: deep(), IDB: deep(), ChatPrefs: deep(), Queue: deep(), Skip: deep(), Playback: deep(),
    Chat: deep(), Reactions: deep(), MediaLength: deep(), MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(),
    RoomUpgrade: deep(), BotRuntime: botRuntime(), Interface: deep(),
  }, o.extras || {}));
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = (m) => { logs.push(k + ": " + m); };
  // THE SDK CLIENT, the only double: rooms whose creator is OWNER (room v12 => 100), levels from LEVELS, send levels per channel;
  // `scrollback` pages the server's list into the timeline, `getRooms` is what `pageRange` asks once per page request.
  const rooms = {};
  for (const id of [SPACE].concat(Object.values(CH))) {
    const key = Object.keys(CH).find((k) => CH[k] === id);
    const lvl = key && SEND_LEVEL[key] !== undefined ? SEND_LEVEL[key] : 0;
    rooms[id] = { roomId: id, name: key ? key.replace("_", "-") : "space", timeline: [], currentState: { getStateEvents: (t) => {
      if (t === "m.room.create") return { getContent: () => ({ room_version: "12", ddjp_mode: mode }), getSender: () => OWNER };
      if (t === "m.room.power_levels") return { getContent: () => ({ users: Object.assign({}, LEVELS), users_default: 0, events: { "m.room.message": lvl }, events_default: lvl }) };
      return null; } } };
  }
  const client = { getRoom: (id) => rooms[id] || null, getRooms: () => { pages++; return Object.values(rooms); }, getUserId: () => me, getDeviceId: () => "DEV",
    scrollback: async (room, n) => {
      const all = server[room.roomId] || [];
      const first = room.timeline.length ? all.findIndex((r) => r.event_id === room.timeline[0].getId()) : all.length;
      const from = Math.max(0, first - (n || 100));
      room.timeline.unshift(...all.slice(from, first).map(mev));
    },
    sendMessage: async (roomId, content) => {
      if (o.sendFails && o.sendFails(roomId, content)) throw new Error("the homeserver said no");
      const body = JSON.parse(content.body); const id = "$" + me.slice(1, me.indexOf(":")) + "-sent" + (sent.length + 1);
      sent.push({ roomId, t: body.t, body, id }); return { event_id: id }; },
    on: noop, removeListener: noop };
  sb.Backends.bind(mode);
  sb.MatrixBridge._setClientForTest(client);
  // THE RAW FAN-OUT, RECORDED (`o.fanOut`): every subscription reaches the real `onRawEvent` too, so nothing about who is
  // subscribed changes — the record only lets `deliver` hand a live raw to the listeners the bridge would call.
  const fan = [];
  if (o.fanOut) {
    const on0 = sb.B1MatrixBridge.onRawEvent, off0 = sb.B1MatrixBridge.offRawEvent;
    sb.B1MatrixBridge.onRawEvent = (fn) => { if (typeof fn === "function" && !fan.includes(fn)) fan.push(fn); return on0(fn); };
    sb.B1MatrixBridge.offRawEvent = (fn) => { const i = fan.indexOf(fn); if (i >= 0) fan.splice(i, 1); return off0(fn); };
  }
  sb.MatrixBridge.seedClock(SPACE);        // room entry, in `features/room.js`'s order: the clock, then the scope
  sb.MatrixBridge.setRoomScope(CH);        // the transport's room entry: binds the bot door's env (J79) and the runner
  sb.MatrixBridge.wireCheckpoints(CH);     // the real wiring, backend1's function in both room types
  sb.Room._setCurrentForTest({ spaceId: SPACE, channels: CH });
  for (const r of (o.cache || [])) sb.EventCache.store(r);   // the raw cache, as IndexedDB rehydrates it on a reload
  const goLive = () => { try { sb.Session.replayFinished(); } catch (e) {} if (sb.Session._setPhaseForTest) sb.Session._setPhaseForTest(sb.Session.LIVE); };
  if (o.opened !== false && o.live !== false) goLive();
  // LIVE DELIVERY, as `_ingestSpineEvent` does it: the raw (stamped with the channel's rank), into the cache, then the door.
  const live = (raw) => {
    const key = Object.keys(CH).find((k) => CH[k] === raw.room_id);
    let parsed = null; try { parsed = JSON.parse(raw.content.body); } catch (e) { parsed = null; }
    const r = { event_id: raw.event_id, type: raw.type, sender: raw.sender, room_id: raw.room_id, ts: raw.origin_server_ts, content: raw.content,
      l: parsed && typeof parsed.l === "number" ? parsed.l : 0, ddjpType: parsed && parsed.t, ddjpBody: parsed,
      senderRank: key && SEND_LEVEL[key] !== undefined ? SEND_LEVEL[key] : 0, unsigned: {} };
    if (rooms[raw.room_id]) rooms[raw.room_id].timeline.push(mev(raw));
    sb.EventCache.store(r); sb.StreamManager.ingest(r);
  };
  // OPENING, as `Room` does it: every events/settings/checkpoints channel replayed (the real `replayRoom`, which stops a bot room's
  // download where the door says), the save point opened from, LIVE, and the history backfill `setRoomLive` starts — awaited here.
  const open = async () => {
    await Promise.allSettled(Object.keys(CH).map((k) => sb.MatrixBridge.replayRoom(CH[k])));
    const opened = sb.StreamManager.openFromSavePoint ? sb.StreamManager.openFromSavePoint() : null;
    goLive();
    const p0 = pages, l0 = logs.length;
    await sb.MatrixBridge.backfillHistory();
    const said = logs.slice(l0);
    const v = said.map((m) => /verified (\d+) segment\(s\) against the room in (\d+) page request\(s\); (\d+) already verified; (\d+) row\(s\) corrected/.exec(m)).filter(Boolean)[0];
    return { opened, pages: pages - p0, said, verify: v ? { verified: +v[1], pages: +v[2], already: +v[3], corrected: +v[4] } : null };
  };
  const reload = (w2) => { w.sb.MatrixBridge.persistHistoryNow(); return world(Object.assign({ mode, me, server, opened: false, storedTable: stored.snap, cache: sb.EventCache.values() }, w2 || {})); };
  // A LIVE RAW FROM ANY ROOM THE CLIENT KNOWS (`o.fanOut`), as `_ingestSpineEvent` handles one: refused unless the bound room
  // scope admits it, then the cache and the door, then every raw listener still subscribed. `rank` is the send level of the
  // channel it arrived on (the channel-origin stamp); the room's own channels default to SEND_LEVEL.
  const deliver = (raw, rank) => {
    if (!o.fanOut) throw new Error("_botroom: deliver needs world({ fanOut: true })");
    const key = Object.keys(CH).find((k) => CH[k] === raw.room_id);
    let parsed = null; try { parsed = JSON.parse(raw.content.body); } catch (e) { parsed = null; }
    const r = { event_id: raw.event_id, type: raw.type, sender: raw.sender, room_id: raw.room_id, ts: raw.origin_server_ts, content: raw.content,
      l: parsed && typeof parsed.l === "number" ? parsed.l : 0, ddjpType: parsed && parsed.t, ddjpBody: parsed,
      senderRank: typeof rank === "number" ? rank : (key && SEND_LEVEL[key] !== undefined ? SEND_LEVEL[key] : 0), unsigned: {} };
    if (rooms[raw.room_id]) rooms[raw.room_id].timeline.push(mev(raw));
    if (sb.MatrixBridge.inScope(raw.room_id)) { sb.EventCache.store(r); sb.StreamManager.ingest(r); }
    for (const fn of fan.slice()) { if (fan.includes(fn)) { try { fn(r, null, rooms[raw.room_id] || null); } catch (e) {} } }
    return r;
  };
  const w = { sb, sent, logs, CH, mode, me, client, rooms, server, stored, live, open, reload, pages: () => pages,
    timers, deliver, goLive, listeners: () => fan.length };
  return w;
}
// A raw as sync delivers it: what the client sent, back through the door, carried by `sender`.
const echo = (w, s, sender, ts) => ({ type: "m.room.message", event_id: s.id, room_id: s.roomId, sender: sender || w.me,
  ts: ts || 1e6, senderRank: 99, content: { body: JSON.stringify(s.body) } });

// ANOTHER DDJP ROOM THE SAME CLIENT KNOWS: a space and its channels, declaring `o.mode`, created by `o.creator`, with `o.levels`
// as its power list and a channel's send level from SEND_LEVEL — for a guard that walks one tab from room to room.
function addRoom(w, spaceId, ch, o) {
  o = o || {};
  const mode = o.mode || "backend2", creator = o.creator || OWNER, levels = o.levels || LEVELS;
  for (const id of [spaceId].concat(Object.values(ch))) {
    const key = Object.keys(ch).find((k) => ch[k] === id);
    const lvl = key && SEND_LEVEL[key] !== undefined ? SEND_LEVEL[key] : 0;
    w.rooms[id] = { roomId: id, name: key ? key.replace("_", "-") : "space", timeline: [], currentState: { getStateEvents: (t) => {
      if (t === "m.room.create") return { getContent: () => ({ room_version: "12", ddjp_mode: mode }), getSender: () => creator };
      if (t === "m.room.power_levels") return { getContent: () => ({ users: Object.assign({}, levels), users_default: 0, events: { "m.room.message": lvl }, events_default: lvl }) };
      return null; } } };
  }
  return { spaceId, channels: ch, mode };
}

module.exports = { ORDER, noop, deep, botRuntime, OWNER, BOT, ADMIN, STAFF, HS, VIP, SPACE, BOT_CH, FULL_CH, LEVELS, quiet, mev,
  SEND_LEVEL, world, echo, addRoom };
