// tests/check-bot-restore.js
// SUBJECT: features/room.js, backends/backend2/streammanager.js, backends/backend2/checkpoint.js,
//          backends/backend2/transport.js, backends/backend1/streammanager.js, backends/backend1/checkpoint.js,
//          backends/backend1/matrixbridge.js, backends/backend1/statederiver.js, backends/backend1/settingsproof.js,
//          backends/backend1/capabilities.js, backends/backend1/ranks.js, features/actions.js, ui/settings.js,
//          features/botruntime.js
//
// WALL: THE ROOM'S OWNER RESTORES A BOT ROOM FROM A SAVE FILE, BY HAND, AND IT IS THE ROOM'S NEW BEGINNING (J79).
//   Before J79 the "Restore from file" control in a bot room posted the file's settings and then failed: backend1's
//   checkpoint publisher looked for a `checkpoints_` channel a bot room does not have, so the room's rules changed and its
//   queue did not (`probe-restore-today`). The owner's rulings: only the owner restores, by hand, with the existing control;
//   non-owners never see or reach it; the bot adopts the restore and never reverts it; it works with the bot offline.
//   Driven through the real modules — the seam, the transport, `Room.overrideFromFile`, `Actions`, the doors, the reducer,
//   History — with the SDK client as the only double.
//
//   A  ONE EVENT. A bot-room restore is a single save point in `events-owner`, carrying the file's state and settings; no
//      settings post. Every device that reads it derives the file's room.
//   B  EVERY CHECK BEFORE ANYTHING IS POSTED: the bot (99), every delegated rank, a client still loading (`mayAuthor`'s
//      OBJECT), a file of the other room type in either direction, an unreadable file — each refused with nothing sent.
//      A failed send changes nothing in either room type ("never half-done").
//   C  RECOGNITION: an origin is the owner's only when its CARRIER is above the ladder — the bot, a staff member, and body
//      fields claiming the owner are refused, in the bot door and at the shared room's arrival.
//   D  NEVER REVERTED: a seal the bot made on the old floor, landing after the restore, is refused everywhere; the bot's
//      next seal builds on the restore and is moved on to; the restore itself is adopted without being asked to reproduce.
//   E  THE BOT OFFLINE: nothing in A needs the bot; when it comes back it opens from the restore and seals on it; a
//      download stops at the restore, and never at a stale seal whose predecessor it has not reached.
//   F  SONG HISTORY AFTER A BOT-ROOM RESTORE, on four kinds of device — holding everything, trimmed, joining after the
//      restore, and reopening with a table stored before it: identical history, truth = device in the audit, and a second
//      open reads 0 pages and corrects 0 rows. The origin is found when it is older than the save points a device keeps.
//   G  SAVE FILES ROUND TRIP, both room types; a file saved after a restore starts at the restore, and carries each save point's
//      restart (`ddjp_571`).
//   H  CREATE FROM FILE MAKES THE FILE'S ROOM TYPE, from either lobby; a bot file makes a bot room holding the file's queue.
//   I  THE CONTROL: drawn from `Actions.describe("room.restore")` — the owner (100) sees it; the bot (99) and every
//      delegated rank never do, whatever the delegation table says. The UI decides nothing.
//   J  THE SHARED ROOM'S ANCHOR IS INERT (D1): the reducer and SettingsProof share `StateDeriver.isRestoreAnchor`; an
//      orphan anchor changes nothing and licenses nothing; the anchor the restore names counts.
//   K  EXISTING ROOMS: `decent-534-497`'s shape — a J28 restore at ?v=519, its origin carried by the room's creator over an
//      UNMARKED settings anchor — still adopts and derives the file's room; the same origin carried by anyone else does not.
//      Built at restart 0, as ?v=519 wrote it (`ddjp_571`), over the room's own floor: a file saved from it starts at it.
//   L  THIS ROOM'S DOOR (D4): a restore and a create-from-file keep this room's `vis`; the posted seed carries it.
//   M  THE BOT'S SETTINGS REQUESTS WHILE IT CATCHES UP are held and answered once live, never lost and never answered from
//      a state still loading (the cascade's second half; the race that remains is `bot-backend.md` §6a).
//   N  THE OWED RIDER: `StreamManager.reset()` clears the move-on log mark, so the next room's first line is printed.
//   O  A RESTORE DELIVERED AGAIN, OR AN OLDER ONE AFTER A NEWER, CHANGES NOTHING (`ddjp_570`, the supervisor's finding: a repeat
//      moved every device back to it). Held or long forgotten, on every kind of device, by its place in the log; the fold refuses
//      it on its own; the room goes on and the bot's next seal chains to the latest. Shared rooms checked the same way.
//   P  THE BOT SEALED TWICE ON THE OLD FLOOR BEFORE THE RESTORE REACHED IT (`ddjp_570`): the first lands before the restore with
//      its `n` and the restore still wins; the second, its `n` one higher, lands after it and is refused everywhere. P2: the same
//      with the bot's clock a tick ahead, so the first seal, landing first, sits LATER in the log — the restore still wins.
//      (Since `ddjp_571` O, P and P2 keep their assertions and pass by RESTART: the owner's ruling replaced the chain walk.)
//   Q  TWO RESTORES OF ONE RESTART (`ddjp_571`): two of the owner's devices restore at once; the later restore wins its restart,
//      over the bot's confirmation of the other, on every device in either order.
//   R  THE BOT'S CONFIRMATION (`ddjp_571`): at once, through Scheduler and the ordered gate; owed only while the restore is the save
//      point; one per device; never a restore — across the duplicate-delivery routes, a reload and an offline return. Gap 3 heals.
//   S  A SHARED ROOM KEEPS ITS RESTORE against the bot's seal of the old room, before or after it (`ddjp_571`, the design's M1);
//      the owner's next seal carries the restart, a file saved from it leaves the old room's seal out, and a lower rung claiming
//      a later restart opens nothing.
//   U  THE NEW RULES ONE AT A TIME: the format (restart 0 hashes as before), the order (restart, `n`, then position), a restore's
//      restart, the download's stop, the runner's in-flight test.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-restore] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-restore] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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
  const sb = loadInContext(o.order || ORDER, {
    Date, Math, JSON, Promise, setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    window: { addEventListener: noop }, document: { addEventListener: noop, visibilityState: "visible" },
    navigator: { onLine: true }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    Store: { history: { load: async () => stored.snap, persist: (sid, snap) => { stored.snap = JSON.parse(JSON.stringify(snap)); } } },
    StorageIO: deep(), IDB: deep(), ChatPrefs: deep(), Queue: deep(), Skip: deep(), Playback: deep(),
    Chat: deep(), Reactions: deep(), MediaLength: deep(), MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(),
    RoomUpgrade: deep(), BotRuntime: botRuntime(), Interface: deep(),
  });
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
  const w = { sb, sent, logs, CH, mode, me, client, rooms, server, stored, live, open, reload, pages: () => pages };
  return w;
}
// A raw as sync delivers it: what the client sent, back through the door, carried by `sender`.
const echo = (w, s, sender, ts) => ({ type: "m.room.message", event_id: s.id, room_id: s.roomId, sender: sender || w.me,
  ts: ts || 1e6, senderRank: 99, content: { body: JSON.stringify(s.body) } });

// THE FILE: a room of its own — settings, a DJ with songs, one playing — saved by its owner.
function fileRoom(sb, o) {
  o = o || {};
  const r = F.playingRoom({ songs: o.songs || 3 });
  const log = F.sortLog(r.log);
  const seed = sb.StateDeriver.buildSeed(log, null);
  if (o.settings) Object.assign(seed.settings, o.settings);
  const cp = { t: "ddjp.checkpoint", n: 7, prev: "h-prev", seed, floorL: log[log.length - 1].l, thin: false,
    covers: log[0].eventId + ".." + log[log.length - 1].eventId };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return { seed, file: JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({ mode: o.mode || "bot", snapshots: [cp],
    keyset: Object.keys(sb.StateDeriver.defaultSettings()), author: { rank: "owner" } }))) };
}
const shape = (st) => JSON.stringify({ q: (st.rotation || []).map((r) => [r.user, (r.pending || []).map((p) => p.videoId)]),
  np: st.nowPlaying && st.nowPlaying.song ? st.nowPlaying.song.videoId : null });

const PARTS = [];
const part = (fn) => PARTS.push(fn);

// ── A — ONE EVENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const w = world({ mode: "backend2" });
  const { seed, file } = fileRoom(w.sb, { settings: { bg: "https://example.org/file.jpg", vis: "public" } });
  const res = await w.sb.Room.overrideFromFile(file);
  ok(res && res.ok === true, "A: the owner's restore in a bot room succeeds", res);
  ok(w.sent.length === 1, "A: APPLIED — and it is ONE send: no settings post before it, nothing after", w.sent.map((s) => s.t + "@" + s.roomId));
  const s = w.sent[0] || { body: {} };
  ok(s.roomId === BOT_CH.events_owner && s.t === "ddjp.checkpoint", "A: a save point, in the bot's log (`events-owner`) — the room's own format and place", s.roomId);
  const cp = s.body;
  ok(cp.prev === null && cp.thin === true && w.sb.B2Checkpoint.isOrigin(cp), "A: it declares an origin — `prev` null, `thin` — the pair no seal can produce", { prev: cp.prev, thin: cp.thin });
  ok(cp.n === 1 && cp.seed && cp.seed.settingsFrom === null && cp.covers === null, "A: `n` continues the floor's count (1 with no floor); settings ride in the seed, with no pointer", { n: cp.n, sf: cp.seed && cp.seed.settingsFrom, covers: cp.covers });
  ok(w.sb.CheckpointFormat.verify(cp) === true && w.sb.StateDeriver.isSeed(cp.seed), "A: its fingerprint verifies and its seed is a real starting state");
  ok(cp.seed.settings.bg === "https://example.org/file.jpg", "A: it carries the FILE's settings", cp.seed.settings.bg);
  // A reader: the restore arrives, carried by the owner. The room becomes the file's.
  const truth = shape(w.sb.StateDeriver.derive([], seed));
  w.sb.B2StreamManager.openFromSavePoint();
  w.sb.StreamManager.ingest(echo(w, s, OWNER));
  const st = w.sb.StreamManager.getState();
  ok(shape(st) === truth, "A: and the room derives the FILE's queue and now-playing", { room: shape(st), file: truth });
  ok(st.settings.bg === "https://example.org/file.jpg", "A: and its settings", st.settings.bg);
});

// A settings change the owner writes straight to `settings-owner`, as the panel does.
let _setL = 100;
function setSettings(w, patch) {
  const s = Object.assign(w.sb.StateDeriver.defaultSettings(), (w.sb.StreamManager.getState() || {}).settings || {}, patch);
  w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$set" + (++_setL), room_id: w.CH.settings_owner, sender: OWNER, ts: 1000 + _setL,
    senderRank: 99, content: { body: JSON.stringify({ t: "ddjp.room.settings", s: s, l: _setL, dv: 2 }) } });
}
const ALL_TO_ANYONE = (sb) => { const d = {}; for (const k of Object.keys(sb.StateDeriver.defaultSettings())) if (k !== "botDelegation") d[k] = "uncategorized"; return d; };

// ── B — EVERY CHECK BEFORE ANYTHING IS POSTED ────────────────────────────────────────────────────────────────────────────
part(async () => {
  // The bot, and every delegated rank — with EVERY setting delegated to the bottom of the ladder.
  for (const who of [BOT, HS, STAFF, VIP]) {
    const w = world({ mode: "backend2", me: who });
    setSettings(w, { botDelegation: ALL_TO_ANYONE(w.sb) });
    const { file } = fileRoom(w.sb);
    const res = await w.sb.Room.overrideFromFile(file);
    ok(res && res.ok === false && res.reason === "not-owner" && w.sent.length === 0,
      "B: " + who + " (" + (LEVELS[who]) + ") is refused as not the room's owner, with every setting delegated to anyone — and nothing is sent", { res, sent: w.sent.length });
  }
  // THE ENGINE ASKS AGAIN, at the moment of posting: the bot's own plan, and a shared room's top-rung non-creator's, are refused.
  { const w = world({ mode: "backend2", me: BOT });
    ok(w.sb.StreamManager.planRestore(fileRoom(w.sb).seed).reason === "not-owner", "B: and the bot room's engine refuses the bot's own plan — the write side asks too");
    const w2 = world({ mode: "backend1", me: ADMIN });
    ok(w2.sb.StreamManager.planRestore(fileRoom(w2.sb, { mode: "full" }).seed).reason === "not-owner", "B: as the shared room's does a top-rung account that is not the room's owner"); }
  // A client still loading: `mayAuthor` answers an OBJECT. J28 read it as a boolean, which an object never fails.
  {
    const w = world({ mode: "backend2", live: false });
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb).file);
    ok(res && res.reason === "not-live" && w.sent.length === 0, "B: a client still loading is refused — `mayAuthor()`'s `{ ok: false }` is read as the object it is — and nothing is sent", { res, sent: w.sent.length });
  }
  // A file of the other room type, both directions.
  for (const [mode, fileMode] of [["backend2", "full"], ["backend1", "bot"]]) {
    const w = world({ mode });
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { mode: fileMode }).file);
    ok(res && res.ok === false && res.reason === "wrong-room-type" && w.sent.length === 0,
      "B: a " + fileMode + " file into a " + mode + " room is refused by name before anything is posted (D2)", { res, sent: w.sent.length });
    ok(res && typeof res.detail === "string" && /this room is a/.test(res.detail), "B: and the refusal says which kind each is", res && res.detail);
  }
  // A control on the same worlds: the SAME type is accepted, so the refusal above is about the type.
  for (const [mode, fileMode] of [["backend2", "bot"], ["backend1", "full"]]) {
    const w = world({ mode });
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { mode: fileMode }).file);
    ok(res && res.ok === true, "B CONTROL: a " + fileMode + " file into a " + mode + " room is accepted", res);
  }
  // An unreadable file.
  {
    const w = world({ mode: "backend2" });
    const bad = fileRoom(w.sb).file; bad.payload.snapshots[0].h = "0".repeat(64);
    const res = await w.sb.Room.overrideFromFile(bad);
    ok(res && res.ok === false && w.sent.length === 0, "B: a file that does not verify is refused, and nothing is sent", { res, sent: w.sent.length });
  }
  // NEVER HALF-DONE: the send that carries the restore fails.
  {
    const w = world({ mode: "backend2", sendFails: () => true });
    const before = JSON.stringify(w.sb.StreamManager.getState().settings);
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { settings: { bg: "https://example.org/half.jpg" } }).file);
    ok(res && res.reason === "checkpoint-not-published" && res.changed === false, "B: a bot room whose restore send fails reports it, and says nothing changed", res);
    ok(JSON.stringify(w.sb.StreamManager.getState().settings) === before && w.sent.length === 0, "B: and nothing did: no settings were posted first");
  }
  {
    const w = world({ mode: "backend1", sendFails: (roomId) => roomId === FULL_CH.checkpoints_owner });
    const before = w.sb.StreamManager.getState().settings.bg;
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { mode: "full", settings: { bg: "https://example.org/half.jpg" } }).file);
    ok(res && res.reason === "checkpoint-not-published" && res.changed === false, "B: a shared room whose checkpoint send fails reports it, and says nothing changed", res);
    const anchor = w.sent.find((x) => x.roomId === FULL_CH.settings_owner);
    ok(anchor && anchor.body.restore === true, "B PREMISE — its settings anchor was posted, marked as a restore anchor (D1)", anchor && anchor.body);
    if (anchor) w.sb.StreamManager.ingest(Object.assign(echo(w, anchor, OWNER), { senderRank: 99 }));
    ok(w.sb.StreamManager.getState().settings.bg === before, "B: and the anchor, folded, changed NOTHING — the reducer refuses it until a restore names it",
      { before, after: w.sb.StreamManager.getState().settings.bg });
    // CONTROL: the same event WITHOUT the mark is an ordinary settings change and does apply — so the row above is the mark's.
    if (anchor) { const plain = Object.assign({}, anchor, { id: anchor.id + "-plain", body: Object.assign({}, anchor.body, { l: anchor.body.l + 1 }) }); delete plain.body.restore;
      w.sb.StreamManager.ingest(echo(w, plain, OWNER)); }
    ok(w.sb.StreamManager.getState().settings.bg === "https://example.org/half.jpg", "B CONTROL: the same settings unmarked DO apply — what held them back was the restore mark",
      w.sb.StreamManager.getState().settings.bg);
  }
});

// ── C — RECOGNITION: AN ORIGIN IS THE OWNER'S ONLY BY WHO CARRIED IT ───────────────────────────────────────────────────────
part(async () => {
  // What a device checks before it drops anything below a restore's cut (owner's addition 1) — each, on its own:
  const base = world({ mode: "backend2" });
  const { seed } = fileRoom(base.sb);
  const good = base.sb.B2Checkpoint.restore(Object.assign({}, seed, { settingsFrom: null }), { floorL: 5, covers: null }).cp;
  const raw = (cp, sender, id, body) => ({ type: "m.room.message", event_id: id, room_id: BOT_CH.events_owner, sender: sender, ts: 2e6, senderRank: 99,
    content: { body: JSON.stringify(Object.assign({}, cp, body || {}, { l: 9 })) } });
  const cases = [
    ["the room's bot (99)", raw(good, BOT, "$c1")],
    ["a staff member", raw(good, STAFF, "$c2")],
    ["a staff member whose body names the owner (`actor`, `by`)", raw(good, STAFF, "$c3", { actor: OWNER, by: OWNER, rank: 100 })],
    ["a top-rung account that is not the room's creator", raw(good, ADMIN, "$c4")],
  ];
  for (const [who, r] of cases) {
    const w = world({ mode: "backend2" }); w.sb.StreamManager.openFromSavePoint();
    w.sb.StreamManager.ingest(r);
    ok(!w.sb.StreamManager.getState().nowPlaying && !w.sb.B2Checkpoint.floor() &&
       w.sb.B2Checkpoint.refused().some((x) => /not carried by the room's owner/.test(x.why)),
      "C: an origin carried by " + who + " is REFUSED in the bot door — the carrier's level, never a body field", w.sb.B2Checkpoint.refused());
  }
  {
    // OPENING (`ddjp_571`): a device that opens while such an origin is the newest save point by position opens from the room's
    // own seal — the restart it stands in — never from the refused origin.
    const w = world({ mode: "backend2" });
    const own = fileRoom(base.sb, { songs: 3 }).seed;
    const s0 = w.sb.B2Checkpoint.seal(Object.assign({}, own, { settingsFrom: null }), { isRunner: true, floorL: 3, covers: "$own" }).cp;
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$own", room_id: BOT_CH.events_owner, sender: BOT, ts: 2e6, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, s0, { l: 4 })) } });
    w.sb.StreamManager.ingest(raw(good, BOT, "$c8"));
    const op = w.sb.StreamManager.openFromSavePoint();
    ok(op && op.ok === true && op.cp === "$own" && shape(w.sb.StreamManager.getState()) === shape(w.sb.StateDeriver.derive([], s0.seed)),
      "C: a device OPENING while that origin is the newest save point by position opens from the room's own seal — never from the refused origin", op);
  }
  {
    const w = world({ mode: "backend2" }); w.sb.StreamManager.openFromSavePoint();
    w.sb.StreamManager.ingest(raw(good, OWNER, "$c5"));
    ok(w.sb.B2Checkpoint.floorIsOwnerOrigin() && shape(w.sb.StreamManager.getState()) === shape(w.sb.StateDeriver.derive([], seed)),
      "C CONTROL: the same origin carried by the room's owner is adopted, and the room is the file's");
    ok(w.sb.StreamManager.lastMoveOn() && w.sb.StreamManager.lastMoveOn().origin === true && w.sb.StreamManager.lastMoveOn().ok === true,
      "C: adopted AS the origin — not asked to reproduce what this device held (it replaces it)", w.sb.StreamManager.lastMoveOn());
    const v = w.sb.StreamManager.seedValidation();
    ok(v && v.status === "validated" && v.reason === "origin-seed",
      "C: and recorded as decentralized rooms record their origin — `validated / origin-seed`, the same exception, not a new one (addition 1)", v);
  }
  {
    // the fingerprint: the owner's own restore with its seed altered after fingerprinting
    const w = world({ mode: "backend2" }); w.sb.StreamManager.openFromSavePoint();
    const forged = JSON.parse(JSON.stringify(good)); forged.seed.settings.bg = "https://example.org/forged.jpg";
    w.sb.StreamManager.ingest(raw(forged, OWNER, "$c6"));
    ok(!w.sb.B2Checkpoint.floor() && !w.sb.StreamManager.getState().nowPlaying, "C: an owner's origin whose fingerprint does not verify is refused");
    // the seed: a properly fingerprinted origin over the DISPLAY state, not a starting state
    const w2 = world({ mode: "backend2" }); w2.sb.StreamManager.openFromSavePoint();
    const disp = JSON.parse(JSON.stringify(w2.sb.StateDeriver.derive([], seed)));
    // (`ddjp_571`: fingerprinted WITH its restart, which a restore now carries and the fingerprint commits — without it this origin
    // was refused for its fingerprint, not for the seed this row is about.)
    const shown = Object.assign({}, good, { seed: disp, h: w2.sb.CheckpointFormat.fingerprint(good.n, null, disp, good.floorL, true, null, good.era, null) });
    w2.sb.StreamManager.ingest(raw(shown, OWNER, "$c7"));
    ok(!w2.sb.StreamManager.getState().nowPlaying && (w2.sb.StreamManager.lastMoveOn() || {}).ok !== true,
      "C: and so is one whose seed is not a real starting state — nothing is dropped for it", w2.sb.StreamManager.lastMoveOn());
  }
});

// ── THE BOT-ROOM STORY, shared by D, E, F and G ─────────────────────────────────────────────────────────────────────────────
// A bot room as its server holds it: the owner's settings, DJs joining, songs relayed by the bot, the bot's save points. Then the
// owner restores from a file; then the room plays on from the file's queue, the bot sealing on the restore — more save points
// than any device keeps (24), so the restore is older than every save point a device holds by the end.
const T0 = 1.7e12, MIN = 60000;
async function botStory(opts) {
  opts = opts || {};
  const server = { [SPACE]: [], [BOT_CH.events_uncategorized]: [], [BOT_CH.events_owner]: [], [BOT_CH.settings_owner]: [] };
  let L = 0, TS = T0, nIn = 0;
  const post = (roomId, sender, body) => { if (typeof body.l === "number" && body.l > L + 1) L = body.l - 1; L++; TS += MIN;
    const raw = { type: "m.room.message", event_id: "$ev" + String(L).padStart(4, "0"), room_id: roomId, sender: sender, origin_server_ts: TS,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: L })) } };
    server[roomId].push(raw); return raw; };
  const S = { server, devices: {}, live: [] };
  const deliver = (raw) => { for (const d of S.live) d.live(raw); };
  const dev = async (name, me, o) => { const d = world(Object.assign({ me, server, opened: false }, o || {})); d.name = name; S.devices[name] = d; d.first = await d.open(); S.live.push(d); return d; };
  const owner = await dev("owner", OWNER);
  let bot = await dev("bot", BOT);
  if (opts.listener) await dev("listener", "@listener:hs");
  const PL = owner.sb.Ranks.levelOf("player");
  deliver(post(BOT_CH.settings_owner, OWNER, { t: "ddjp.room.settings", s: Object.assign(owner.sb.StateDeriver.defaultSettings(), { vis: "public" }) }));
  let pi = null;
  const rel = (b, actor, rank) => Object.assign({}, b, { actor: actor, rank: rank, src: "$in" + (++nIn), at: null });
  const play = () => { const r = post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.play", p: pi }, BOT, 99)); deliver(r); pi = r.event_id; };
  const join = (who, v) => deliver(post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.join", v: v, u: "https://www.youtube.com/watch?v=" + v }, who, PL)));
  // THE RUNNER'S SEAL: its own seed builder, sealed at its head — the two calls `B2Runner` makes.
  const sealCp = () => { const log = bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = bot.sb.B2Checkpoint.seal(bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); return out.cp; };
  const seal = () => { const cp = sealCp(); deliver(post(BOT_CH.events_owner, BOT, cp)); return cp; };
  S.seals = [];
  // To play on (`ddjp_570`, part O) — and, since `ddjp_571`, from inside the story too (`afterReopen`, part R).
  Object.assign(S, { post, deliver, play, join, seal, sealCp, rel, PL, dev, setPi: (x) => { pi = x; } });
  for (let k = 0; k < 3; k++) join("@d" + k + ":hs", "pre" + k + "aaaaaaa");
  for (let s = 0; s < 3; s++) { play(); join("@d" + s + ":hs", "prx" + s + "bbbbbbb"); }
  if (!opts.noSealsBefore) {
    S.seals.push(seal());
    S.devices.trimmed = null;
    await dev("trimmed", "@trimmed:hs");                 // opens from save point n=1, then follows live
    for (let s = 0; s < 3; s++) { play(); join("@d" + s + ":hs", "pry" + s + "ccccccc"); }
    S.seals.push(seal());
    const before = world({ me: "@reopened:hs", server, opened: false }); await before.open(); before.sb.MatrixBridge.persistHistoryNow();
    S.storedBefore = before.stored.snap; S.cacheBefore = before.sb.EventCache.values();   // a table stored BEFORE the restore
  }
  play(); join("@d0:hs", "przzzzzzzzz");
  // THE FILE, and the restore
  S.fileSeed = null; S.file = null;
  { const f = fileRoom(owner.sb, { settings: { bg: "https://example.org/file.jpg", vis: "private" } }); S.fileSeed = f.seed; S.file = f.file; }
  let stale = null;
  if (opts.botOffline) { S.live = S.live.filter((d) => d !== bot); bot = null; }      // the bot's tab is closed
  else if (opts.staleBefore) {
    // THE BOT SEALS TWICE ON THE OLD FLOOR BEFORE THE RESTORE REACHES IT (`ddjp_570`). The owner has the room's acts but not the
    // first seal when it restores, so that seal lands BEFORE the restore with the restore's `n`; the second lands after it, built
    // on the first, its `n` one HIGHER than the restore's — the case a stale-seal rule keyed on `n` would let through. (With the
    // bot's acts ahead of the owner's cut too, the first seal's cut sits above the restore's: `bot-backend.md` §6a, gap 2.)
    S.lag = post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.vote", p: pi, dv: 1 }, "@v0:hs", PL));
    deliver(S.lag);
    // `staleLater`: THE BOT'S CLOCK IS A TICK AHEAD (an intent it has received and not yet relayed), so its seal — same cut, same
    // `n` — carries a position ABOVE the one the owner's restore will carry, though it lands first. By the log the restore comes
    // first and the seal after it, built on the old floor: the restore must stand, whatever this client saw first.
    S.stale1 = sealCp();
    if (opts.staleLater) { S.skipL = L + 1; S.stale1Raw = post(BOT_CH.events_owner, BOT, Object.assign({}, S.stale1, { l: L + 2 })); }
    else S.stale1Raw = post(BOT_CH.events_owner, BOT, S.stale1);
    for (const d of S.live) if (d !== owner) d.live(S.stale1Raw);
    S.lag2 = post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.vote", p: pi, dv: 1 }, "@v1:hs", PL));
    for (const d of S.live) if (d !== owner) d.live(S.lag2);
    stale = sealCp();                                                                 // the second, on the first
    S.ownerLate = [S.stale1Raw, S.lag2];                                              // they land before the restore, so reach the owner first
  } else {
    // THE BOT IS AHEAD OF THE OWNER: one more act relayed that the owner has not received when it restores — so the seal the bot
    // then makes on the OLD floor sits ABOVE the restore's cut: the newest save point by position, and never a place to open from.
    S.lag = post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.vote", p: pi, dv: 1 }, "@v0:hs", PL));
    for (const d of S.live) if (d !== owner) d.live(S.lag);
    stale = sealCp();                                                                 // the bot seals on the OLD floor, not yet seeing the restore
  }
  S.result = await owner.sb.Room.overrideFromFile(S.file);
  S.restoreSent = owner.sent.slice();
  const rs = owner.sent[owner.sent.length - 1];
  S.restore = rs ? rs.body : null;
  if (S.ownerLate) for (const r of S.ownerLate) owner.live(r);
  if (rs) {
    const r = post(rs.roomId, OWNER, rs.body);
    if (typeof S.skipL === "number") { const b = JSON.parse(r.content.body); b.l = S.skipL; r.content.body = JSON.stringify(b); }   // the owner's tick
    deliver(r);
  }
  S.restoreRaw = rs ? server[rs.roomId][server[rs.roomId].length - 1] : null;
  if (S.lag && !S.ownerLate) owner.live(S.lag);                                       // the act reaches the owner after its restore (not in the stale-before story: it had it)
  S.afterRestore = {};
  for (const d of S.live) S.afterRestore[d.name] = { floor: d.sb.B2Checkpoint.floor(), moveOn: d.sb.StreamManager.lastMoveOn(), state: shape(d.sb.StreamManager.getState()),
    v: d.sb.StreamManager.seedValidation(), settings: d.sb.StreamManager.getState().settings };
  if (stale) { S.stale = stale; deliver(post(BOT_CH.events_owner, BOT, stale)); }
  S.afterStale = {};
  for (const d of S.live) S.afterStale[d.name] = { floor: d.sb.B2Checkpoint.floor(), refused: d.sb.B2Checkpoint.refused().map((x) => x.why), state: shape(d.sb.StreamManager.getState()) };
  if (stale) { const b = await dev("between", "@between:hs"); S.between = { opened: b.first.opened, state: shape(b.sb.StreamManager.getState()) }; }
  if (opts.botOffline) {                                                              // the bot comes back
    bot = await dev("bot", BOT);
    S.botReopen = bot.first;
    if (opts.afterReopen) await opts.afterReopen(S, bot);                               // part R: the returning confirmer (`ddjp_571`)
  }
  pi = S.restore ? S.restore.seed.nowPlaying.pi : pi;
  play(); join("@dj:hs", "aft00dddddd");
  S.firstOnRestore = seal();
  { const pick = owner.sb.StreamManager.heldCheckpoints().find((h) => (owner.sb.B2Checkpoint.byId(h.id) || {}).h === S.firstOnRestore.h);
    S.earlyExport = pick ? owner.sb.StreamManager.exportCheckpoint(pick.id) : null;
    const st = S.stale ? owner.sb.StreamManager.heldCheckpoints().find((h) => (owner.sb.B2Checkpoint.byId(h.id) || {}).h === S.stale.h) : null;
    S.staleExport = st ? owner.sb.StreamManager.exportCheckpoint(st.id) : null; }
  S.afterFirst = {};
  for (const d of S.live) S.afterFirst[d.name] = { floor: d.sb.B2Checkpoint.floor(), moveOn: d.sb.StreamManager.lastMoveOn() };
  for (let k = 1; k < (opts.seals || 27); k++) { play(); join("@dj:hs", "aft" + String(k).padStart(2, "0") + "dddddd"); S.seals.push(seal()); }
  play();
  if (S.storedBefore) await dev("reopened", "@reopened:hs", { storedTable: S.storedBefore, cache: S.cacheBefore });
  await dev("joined", "@joined:hs");
  S.bot = bot; S.owner = owner;
  return S;
}
const rowsOf = (d) => d.sb.History.recent(5000).map((r) => r.pi + "|" + r.videoId).sort().join(";");

// ── D — NEVER REVERTED ───────────────────────────────────────────────────────────────────────────────────────────────────────
let STORY = null;
part(async () => {
  STORY = await botStory({});
  const S = STORY;
  ok(S.result && S.result.ok === true && S.restoreSent.length === 1, "D PREMISE — the owner's restore went out as one event", { res: S.result, sent: S.restoreSent.length });
  const R = S.restore;
  // CHANGED AT `ddjp_571`, by the owner's ruling (design round 2): a restore STARTS A NEW RESTART — `era` one higher than
  // the floor it replaces, `n` back to 1 — where `ddjp_569` continued the floor's count (`n` = floor `n` + 1). The restart,
  // not the count, is what makes it stand over everything before it.
  ok(R && R.era === (S.seals[1].era || 0) + 1 && R.n === 1 && !R.root,
    "D: the restore starts a NEW RESTART — era one past the owner's floor's (the bot's n=" + S.seals[1].n + ", restart " + (S.seals[1].era || 0) + "), n back to 1",
    R && { era: R.era, n: R.n, root: R.root });
  for (const n of Object.keys(S.afterRestore)) {
    const a = S.afterRestore[n];
    ok(a.floor && a.floor.h === R.h && a.moveOn && a.moveOn.origin === true && a.moveOn.ok === true,
      "D: the " + n.toUpperCase() + " device adopted the restore as its origin, without being asked to reproduce what it held", { floor: a.floor && a.floor.n, moveOn: a.moveOn });
    ok(a.state === shape(S.owner.sb.StateDeriver.derive([], S.fileSeed)), "D: and the " + n.toUpperCase() + " device's room is the FILE's queue and song", a.state);
    ok(a.settings.bg === "https://example.org/file.jpg", "D: with the file's settings", a.settings.bg);
    ok(a.v && a.v.status === "validated" && a.v.reason === "origin-seed", "D: recorded `validated / origin-seed` (addition 1)", a.v);
  }
  for (const n of Object.keys(S.afterStale)) {
    const a = S.afterStale[n];
    ok(a.floor && a.floor.h === R.h && a.refused.indexOf("does not build on the room's restore") >= 0 && a.state === S.afterRestore[n].state,
      "D: a seal the bot made on the OLD floor, landing after the restore, is refused on the " + n.toUpperCase() + " device and changes nothing", a);
  }
  ok(S.stale && S.stale.prev === S.seals[1].h && S.stale.floorL > R.floorL, "D PREMISE — that seal really was built on the old floor, and sits ABOVE the restore's cut", S.stale && { prev: S.stale.prev, at: S.stale.floorL, cut: R.floorL });
  ok(S.between && S.between.opened && S.between.opened.ok === true && S.between.opened.origin === true && S.between.state === shape(S.owner.sb.StateDeriver.derive([], S.fileSeed)),
    "D: a device opening right then opens FROM THE RESTORE — the save point it stands on — never from that seal, the newest by position", S.between);
  for (const n of ["owner", "bot", "trimmed"]) {
    const L = S.devices[n].logs;
    // The lines themselves CHANGED AT `ddjp_571` (owner's ruling: the live check reads the restart and the count).
    ok(L.some((m) => m.indexOf("adopted the owner's restore — restart " + R.era + " n=" + R.n + " at l=" + R.floorL) >= 0) &&
       L.some((m) => /save point restart 0 n=\d+ from @bot:hs refused — from before the room's restore \(restart 0, the room is at 1\)/.test(m)),
      "D: the " + n.toUpperCase() + " device SAYS both — the lines the owner's live check reads (J79's Done-when)", L.filter((m) => /restore/.test(m)));
  }
  ok(S.firstOnRestore.prev === R.h && S.firstOnRestore.n === R.n + 1, "D: the bot's next seal BUILDS ON the restore — `prev` is the restore, `n` one past it",
    { prev: S.firstOnRestore.prev, n: S.firstOnRestore.n, restore: R.n });
  ok(S.firstOnRestore.era === R.era && S.firstOnRestore.root && S.firstOnRestore.root.id === S.restoreRaw.event_id &&
     S.firstOnRestore.root.l === JSON.parse(S.restoreRaw.content.body).l,
    "D: and carries the restore's restart — its era, and its root: where the restore's own event sits (`ddjp_571`)", S.firstOnRestore.root);
  for (const n of Object.keys(S.afterFirst)) {
    const a = S.afterFirst[n];
    ok(a.floor && a.floor.h === S.firstOnRestore.h && a.moveOn && a.moveOn.ok === true && !a.moveOn.origin,
      "D: and the " + n.toUpperCase() + " device moved on to it — proved, as any seal is", a.moveOn);
  }
});

// ── E — THE BOT OFFLINE ──────────────────────────────────────────────────────────────────────────────────────────────────────
let STORY_OFF = null;
part(async () => {
  STORY_OFF = await botStory({ botOffline: true, noSealsBefore: true, listener: true, seals: 4 });
  const S = STORY_OFF;
  ok(S.result && S.result.ok === true && S.restoreSent.length === 1, "E: the restore needs no bot — with its tab closed, the owner's restore is one event, sent", S.result);
  for (const n of Object.keys(S.afterRestore)) {
    const a = S.afterRestore[n];
    ok(a.floor && a.floor.h === S.restore.h && a.state === shape(S.owner.sb.StateDeriver.derive([], S.fileSeed)),
      "E: the " + n.toUpperCase() + " device — which HELD EVERYTHING, the room never having sealed — adopted it with no bot running", a.state);
  }
  const b = S.botReopen && S.botReopen.opened;
  ok(b && b.ok === true && b.origin === true && b.cp, "E: the bot, reopened, opens FROM the restore", b);
  ok(S.firstOnRestore.prev === S.restore.h && S.firstOnRestore.n === S.restore.n + 1,
    "E: and its next seal builds on it", { prev: S.firstOnRestore.prev, restore: S.restore.h });
  // THE DOWNLOAD'S STOP RULE, through the door's own question
  const D = world({ mode: "backend2" }).sb.StreamManager;
  const tl = (raws) => raws.map((r) => ({ type: r.type, content: r.content, sender: r.sender }));
  const log = S.server[BOT_CH.events_owner];
  const iR = log.findIndex((r) => JSON.parse(r.content.body).h === S.restore.h);
  ok(iR > 0 && D.replayHasEnough(BOT_CH.events_owner, tl(log.slice(iR))) === true, "E: a download stops at the owner's restore — a beginning");
  const asBot = log.slice(iR).map((r, i) => (i === 0 ? Object.assign({}, r, { sender: BOT }) : r)).slice(0, 1);
  ok(D.replayHasEnough(BOT_CH.events_owner, tl(asBot)) === false, "E: but not at an origin the bot carried — nothing a non-owner posts can end a download");
  const ST = STORY;
  if (ST) {
    const L2 = ST.server[BOT_CH.events_owner];
    const iS = L2.findIndex((r) => JSON.parse(r.content.body).h === ST.stale.h);
    ok(iS > 0 && D.replayHasEnough(BOT_CH.events_owner, tl(L2.slice(iS, iS + 1))) === false,
      "E: and never at a stale seal whose predecessor it has not reached — the restore may sit between them");
    const iFirst = L2.findIndex((r) => JSON.parse(r.content.body).h === ST.firstOnRestore.h);
    const iRes = L2.findIndex((r) => JSON.parse(r.content.body).h === ST.restore.h);
    ok(D.replayHasEnough(BOT_CH.events_owner, tl(L2.slice(iFirst, iFirst + 1))) === false && D.replayHasEnough(BOT_CH.events_owner, tl(L2.slice(iRes, iFirst + 1))) === true,
      "E: a seal on the restore stops it only once its predecessor — the restore — is in hand");
  }
});

// ── F — SONG HISTORY AFTER A BOT-ROOM RESTORE, ON EVERY KIND OF DEVICE ────────────────────────────────────────────────────────
part(async () => {
  for (const [label, S] of [["", STORY], ["(bot offline) ", STORY_OFF]]) {
    if (!S) { ok(false, "F PREMISE — the story ran"); continue; }
    const names = Object.keys(S.devices).filter((n) => S.devices[n]);
    const ref = rowsOf(S.devices.owner);
    const fileNp = S.fileSeed.nowPlaying;
    for (const n of names) {
      const d = S.devices[n];
      const a = await d.sb.MatrixBridge.historyAudit();
      ok(a && a.truthCount > 0 && a.truthCount === a.deviceCount && !a.missing.length && !a.extra.length,
        "F: " + label + "the " + n.toUpperCase() + " device — truth = device in the History audit", { truth: a && a.truthCount, device: a && a.deviceCount, missing: a && a.missing.map((r) => r.videoId), extra: a && a.extra.map((r) => r.videoId) });
      ok(rowsOf(d) === ref, "F: " + label + "the " + n.toUpperCase() + " device holds the SAME history as the owner's", { n: d.sb.History.count(), owner: S.devices.owner.sb.History.count() });
      const rows = d.sb.History.recent(5000).slice().sort((x, y) => (x.l || 0) - (y.l || 0));
      ok(rows.length && rows[0].pi === fileNp.pi && !rows.some((r) => /^pr[exyz]/.test(r.videoId || "")),
        "F: " + label + "on the " + n.toUpperCase() + " device history starts FRESH at the restore — the file's now-playing song first, nothing of the old room", rows.slice(0, 2).map((r) => r.videoId));
    }
    // RELOAD TWICE: the first reload corrects nothing; the second reads nothing and corrects nothing.
    for (const n of names) {
      const r1 = S.devices[n].reload(); const o1 = await r1.open();
      ok(o1.verify && o1.verify.corrected === 0 && rowsOf(r1) === ref, "F: " + label + "the " + n.toUpperCase() + " device, reloaded, corrects 0 rows and holds the same history", o1.verify);
      const r2 = r1.reload(); const o2 = await r2.open();
      ok(o2.verify && o2.verify.pages === 0 && o2.verify.corrected === 0 && o2.pages === 0 && rowsOf(r2) === ref,
        "F: " + label + "and its second open reads 0 pages and corrects 0 rows", { verify: o2.verify, pageRequests: o2.pages });
    }
  }
  const S = STORY;
  if (S && S.devices.joined) {
    ok(S.devices.joined.sb.StreamManager.floorChain().length < S.seals.length - 2, "F PREMISE — by the end every device keeps fewer save points than the restore is old",
      { kept: S.devices.joined.sb.StreamManager.floorChain().length, sealedSince: S.seals.length - 2 });
    ok(S.devices.joined.first.said.some((m) => /chain resolved from the room: \d+ older floor\(s\), ending at the origin floor/.test(m)),
      "F: so the joining device found the restore by paging the room — the chain it keeps does not reach it");
    ok(S.devices.reopened && S.devices.reopened.first.said.some((m) => /chain resolved from the room: \d+ older floor\(s\), ending at the origin floor/.test(m)),
      "F: and so did the device reopening with a table stored BEFORE the restore — whose stored origin, the room's start, is not taken as the chain's");
  }
});

// ── G — SAVE FILES ROUND TRIP ────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const S = STORY;
  if (!S) return ok(false, "G PREMISE — the story ran");
  const owner = S.devices.owner;
  const held = owner.sb.StreamManager.heldCheckpoints();
  const newest = held.slice().sort((a, b) => b.floorL - a.floorL)[0];
  const ex = owner.sb.StreamManager.exportCheckpoint(newest.id);
  ok(ex && ex.ok === true && ex.file.mode === "bot", "G: a bot room restored from a file saves a file again", ex && ex.reason);
  const snaps = (ex && ex.file.payload.snapshots) || [];
  ok(!snaps.some((c) => c.n < S.restore.n) && !snaps.some((c) => c.h === S.stale.h || c.h === S.seals[0].h || c.h === S.seals[1].h),
    "G: and a file saved after a restore carries nothing of the room it replaced", snaps.map((c) => c.n));
  // THE RESTART TRAVELS (`ddjp_571`): committed by the fingerprint, so a file without it would not verify where it is read.
  ok(snaps.length >= 1 && snaps.every((c) => c.era === S.restore.era) && snaps.filter((c) => c.prev).length >= 1 &&
     snaps.filter((c) => c.prev).every((c) => c.root && c.root.id === S.restoreRaw.event_id) && snaps.filter((c) => !c.prev).every((c) => !c.root),
    "G: and the file carries each save point's restart — the era on every one, the root on all but the restore — so each verifies where it is read",
    snaps.map((c) => ({ n: c.n, era: c.era, root: c.root })));
  const early = S.earlyExport && S.earlyExport.ok ? S.earlyExport.file.payload.snapshots.map((c) => c.h) : null;
  ok(early && early.join() === [S.restore.h, S.firstOnRestore.h].join(), "G: a file saved while the old room's save points are still held STARTS AT THE RESTORE — the restore, then what was sealed on it",
    early && early.length);
  ok(S.staleExport && S.staleExport.ok === false && S.staleExport.reason === "replaced-by-restore", "G: and the refused seal on the old floor cannot be saved as this room's file", S.staleExport);
  const into = world({ mode: "backend2" });
  const res = await into.sb.Room.overrideFromFile(ex.file);
  ok(res && res.ok === true && into.sent.length === 1, "G: that file restores into another bot room", res);
  into.sb.StreamManager.openFromSavePoint(); into.sb.StreamManager.ingest(echo(into, into.sent[0], OWNER));
  const last = owner.sb.B2Checkpoint.byId(newest.id);
  ok(shape(into.sb.StreamManager.getState()) === shape(owner.sb.StateDeriver.derive([], last.seed)), "G: and that room derives the saved state — round trip, bot",
    { got: shape(into.sb.StreamManager.getState()) });
  // THE SHARED ROOM'S ROUND TRIP, through a J79 restore: the inert anchor and the import checkpoint, both echoed.
  const sh = world({ mode: "backend1" });
  { // the room's own history first: events, and an owner floor over them — the old room a file saved later must not carry
    const room = F.sortLog(F.playingRoom({ songs: 2, dj: "@roomdj:hs" }).log);
    for (const e of room) sh.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const last = room[room.length - 1], seedOld = sh.sb.StateDeriver.buildSeed(room, undefined);
    const old = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seedOld, floorL: last.l, thin: false, covers: room[0].eventId + ".." + last.eventId };
    old.h = sh.sb.CheckpointFormat.fingerprint(old.n, old.prev, old.seed, old.floorL, old.thin, old.covers);
    sh.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$oldfloor", room_id: FULL_CH.checkpoints_owner, sender: OWNER, ts: 2e6, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, old, { l: last.l + 1 })) } });
    ok(sh.sb.Floor.current() && sh.sb.Floor.current().h === old.h, "G PREMISE — the shared room stands on its own floor before the restore");
  }
  const f = fileRoom(sh.sb, { mode: "full", settings: { bg: "https://example.org/full.jpg" } });
  const r1 = await sh.sb.Room.overrideFromFile(f.file);
  ok(r1 && r1.ok === true && sh.sent.length === 2 && sh.sent[0].body.restore === true, "G PREMISE — a shared room's restore: the anchor, then the checkpoint", sh.sent.map((x) => x.t));
  for (const x of sh.sent) sh.sb.StreamManager.ingest(echo(sh, x, OWNER));
  ok(shape(sh.sb.StreamManager.getState()) === shape(sh.sb.StateDeriver.derive([], f.seed)) && sh.sb.StreamManager.getState().settings.bg === "https://example.org/full.jpg",
    "G: the shared room derives the file — the anchor counted because the restore names it", shape(sh.sb.StreamManager.getState()));
  const cpId = sh.sent[1].body.h;
  const ex2 = sh.sb.StreamManager.exportCheckpoint(cpId);
  ok(ex2 && ex2.ok === true && ex2.importable === true, "G: and saves a file again", ex2 && ex2.reason);
  ok(ex2 && ex2.snapshots === 1 && ex2.file.payload.snapshots[0].h === cpId, "G: starting at the restore — nothing of the floor it replaced", ex2 && ex2.snapshots);
  const into2 = world({ mode: "backend1" });
  const r2 = ex2 && ex2.ok ? await into2.sb.Room.overrideFromFile(ex2.file) : null;
  for (const x of into2.sent) into2.sb.StreamManager.ingest(echo(into2, x, OWNER));
  ok(r2 && r2.ok === true && shape(into2.sb.StreamManager.getState()) === shape(sh.sb.StateDeriver.derive([], f.seed)), "G: which restores into another shared room as the same state — round trip, shared", r2);
});

// ── H — CREATE FROM FILE MAKES THE FILE'S ROOM TYPE ──────────────────────────────────────────────────────────────────────────
part(async () => {
  const ORDER_H = ORDER.slice(0, ORDER.indexOf("features/room.js")).concat(["core/bind-bootstrap.js", "features/room.js", "features/actions.js"]);
  for (const [lobby, fileMode, want] of [[null, "bot", "backend2"], ["backend1", "bot", "backend2"], ["backend2", "full", "backend1"]]) {
    const posts = []; let asked = null; const rooms = {};
    const sb = loadInContext(ORDER_H, {
      Date, Math, JSON, Promise, setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
      window: { addEventListener: noop }, document: { addEventListener: noop, visibilityState: "visible" },
      navigator: { onLine: true }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      Store: deep(), StorageIO: deep(), IDB: deep(), ChatPrefs: deep(), Queue: deep(), Skip: deep(), Playback: deep(), Chat: deep(), Reactions: deep(),
      MediaLength: deep(), MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(), RoomUpgrade: deep(), BotRuntime: deep(), Interface: deep() });
    for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = noop;
    if (lobby) sb.Backends.bind(lobby);
    const client = { getRoom: (id) => rooms[id] || null, getRooms: () => Object.values(rooms), getUserId: () => OWNER, getDeviceId: () => "DEV",
      sendMessage: async (roomId, content) => { const body = JSON.parse(content.body); posts.push({ roomId, t: body.t, body, id: "$p" + posts.length }); return { event_id: "$p" + posts.length }; },
      on: noop, removeListener: noop };
    sb.MatrixBridge._setClientForTest(client);
    // DOUBLES: making the Matrix rooms (the channel plan is the real registry's, for the mode it was asked for) and the replay.
    for (const M of [sb.B1MatrixBridge, sb.B2MatrixBridge, sb.MatrixBridge]) {
      M.createDDJPSpace = async (name, resuming, mode) => {
        asked = mode;
        const channels = {};
        for (const c of (sb.Backends.planFor(mode) || [])) {
          const key = c.key || (c.kind + "_" + c.slug); const id = "!" + key + ":hs"; channels[key] = id;
          const lvl = SEND_LEVEL[key] !== undefined ? SEND_LEVEL[key] : 0;
          rooms[id] = { roomId: id, name: key.replace("_", "-"), timeline: [], currentState: { getStateEvents: (t) => {
            if (t === "m.room.create") return { getContent: () => ({ room_version: "12", ddjp_mode: mode }), getSender: () => OWNER };
            if (t === "m.room.power_levels") return { getContent: () => ({ users: {}, users_default: 0, events: { "m.room.message": lvl }, events_default: lvl }) };
            return null; } } };
        }
        return { spaceId: "!space:hs", channels };
      };
      M.replayRoom = async () => {};
    }
    sb.Session._setPhaseForTest && sb.Session._setPhaseForTest(sb.Session.LIVE);
    const f = fileRoom(sb, { mode: fileMode, settings: { vis: "public" } });
    let threw = null; try { await sb.Room.createFromFile("R", f.file); } catch (e) { threw = e && e.message; }
    const label = "from " + (lobby ? "a " + lobby + " lobby" : "a fresh page") + ", a " + fileMode + " file";
    ok(!threw && asked === want && sb.Backends.active() === want, "H: " + label + " makes a " + want + " room", { asked, bound: sb.Backends.active(), threw });
    if (want === "backend2") {
      const restore = posts.find((x) => x.t === "ddjp.checkpoint");
      ok(restore && restore.roomId === "!events_owner:hs" && restore.body.prev === null && restore.body.thin === true,
        "H: " + label + ": the file's state is ONE save point in the new room's log", posts.map((x) => x.t + "@" + x.roomId));
      if (restore) { sb.StreamManager.openFromSavePoint(); sb.StreamManager.ingest({ type: "m.room.message", event_id: restore.id, room_id: restore.roomId, sender: OWNER, ts: 1e6, senderRank: 99, content: { body: JSON.stringify(restore.body) } }); }
      ok(shape(sb.StreamManager.getState()) === shape(sb.StateDeriver.derive([], f.seed)), "H: " + label + ": and it is a bot room holding the FILE's queue", shape(sb.StreamManager.getState()));
      ok(restore && restore.body.seed.settings.vis === sb.Room.getSettings().vis && restore.body.seed.settings.vis !== "public",
        "H/L: and its door is the new room's, not the file's (D4)", restore && restore.body.seed.settings.vis);
    }
  }
});

// ── I — THE CONTROL: THE OWNER SEES IT; THE BOT AND EVERY DELEGATED RANK NEVER DO ────────────────────────────────────────────
part(async () => {
  for (const [who, see] of [[OWNER, true], [BOT, false], [ADMIN, false], [HS, false], [STAFF, false], [VIP, false], ["@guest:hs", false]]) {
    const w = world({ mode: "backend2", me: who });
    setSettings(w, { botDelegation: ALL_TO_ANYONE(w.sb) });
    const d = w.sb.Actions.describe("room.restore");
    ok(d.enabled === see, "I: " + who + " " + (see ? "SEES" : "never sees") + " the restore control — `Actions.describe(\"room.restore\")`, every setting delegated to anyone", d);
    if (!see) {
      let rejected = null; try { await w.sb.Actions.perform("room.restore", { file: fileRoom(w.sb).file }); } catch (e) { rejected = e && e.message; }
      ok(rejected && w.sent.length === 0, "I: and cannot reach it — the action refuses, and nothing is sent", { rejected, sent: w.sent.length });
    }
  }
  const caps = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js"], {});
  const at = (lvl) => caps.Capabilities.can("room.restore", { settings: caps.StateDeriver.defaultSettings() }, { myId: "@x:hs", myRank: lvl }).permitted;
  ok(at(100) === true && [99, 75, 50, 25, 10, 0].every((l) => at(l) === false), "I: the verb answers above the ladder only — 100 yes; 99 (the bot) and every rung below, no");
  const ui = src("ui/settings.js").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");   // code, not comments
  const row = ui.slice(ui.indexOf("function _renderRestoreFromFileRow"), ui.indexOf("function _renderRestoreFromFileRow") + 3000);
  ok(/if \(!Actions\.describe\("room\.restore"\)\.enabled\) return;/.test(row.slice(0, 300)) && /Actions\.perform\("room\.restore"/.test(row) && !/Room\.overrideFromFile/.test(ui),
    "I (textual — the panel needs a DOM): the row draws itself only when the verb allows it, and acts through `Actions.perform` — never `Room` directly");
  ok(/if \(Actions\.describe\("room\.restore"\)\.enabled\) \{\s*_section\("files"/.test(ui), "I (textual): and the files section is drawn by the same question");
});

// ── J — THE SHARED ROOM'S ANCHOR IS INERT UNTIL A RESTORE NAMES IT (D1) ─────────────────────────────────────────────────────
part(async () => {
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/settingsproof.js"], {});
  const SD = sb.StateDeriver, SP = sb.SettingsProof;
  const ev = (id, l, s, restore) => ({ eventId: id, l: l, type: "ddjp.room.settings", senderRank: 99, sender: OWNER, ts: l, roomId: "!s",
    content: Object.assign({ t: "ddjp.room.settings", s: Object.assign(SD.defaultSettings(), s) }, restore ? { restore: true } : {}) });
  const s1 = ev("$s1", 1, { maxLen: 300 }), orphan = ev("$a", 5, { maxLen: 900 }, true), s2 = ev("$s2", 8, { maxLen: 300, minLen: 20 });
  ok(SD.isRestoreAnchor(orphan.content) === true && SD.isRestoreAnchor(s1.content) === false, "J: `StateDeriver.isRestoreAnchor` names the mark");
  const st = SD.derive([s1, orphan], undefined);
  ok(st.settings.maxLen === 300, "J: the reducer refuses an anchor — folded alone it changes nothing", st.settings.maxLen);
  ok(SD.derive([s1, ev("$p", 5, { maxLen: 900 })], undefined).settings.maxLen === 900, "J CONTROL: the same settings unmarked apply");
  SP.reset(); SP.ingest([s1, orphan, s2]); SP.markGenesisReached();
  ok(SP.inForceAt(6, null).eventId === "$s1", "J: SettingsProof does not take an ORPHAN anchor as the event in force", SP.inForceAt(6, null));
  ok(SP.inForceAt(6, "$a").eventId === "$a", "J: but the anchor a restore NAMES is the event in force for it", SP.inForceAt(6, "$a"));
  ok(SP.heldSince("maxLen").l === 1 && SP.heldSince("maxLen", "$a").l === 8, "J: and the same rule holds for `heldSince` (the repeat rule's reading): an orphan is no change; a named anchor is one",
    [SP.heldSince("maxLen"), SP.heldSince("maxLen", "$a")]);
  // THE FORGET LICENCE: a restore's own claim proves on the anchor it names; an orphan never costs a later claim it.
  const blob = (e) => e.content.s;
  ok(SP.proveClaim({ claimed: blob(orphan), settingsFrom: "$a", atL: 6 }).status === "validated",
    "J: the restore's own claim proves on the anchor it names — the shared room's forget licence holds after a restore");
  const later = SP.proveClaim({ claimed: blob(s1), settingsFrom: "$s1", atL: 6 });
  ok(later.status === "validated", "J: and an ORPHAN anchor does not supersede the settings in force — a later claim naming them still proves, " +
    "where it would otherwise read `named-event-was-superseded`, a verdict that is conclusive", later);
  const one = (f) => (src(f).match(/restore\s*===\s*true/g) || []).length;
  ok(one("backends/backend1/statederiver.js") === 1 && one("backends/backend1/settingsproof.js") === 0 && /StateDeriver\.isRestoreAnchor/.test(src("backends/backend1/settingsproof.js")),
    "J (textual): ONE predicate — the reducer and SettingsProof both ask `isRestoreAnchor`; neither restates the mark");
});

// ── K — EXISTING ROOMS: decent-534-497, restored by its owner at ?v=519 ─────────────────────────────────────────────────────
part(async () => {
  // Its shape: a running shared room; a J28 restore — an UNMARKED settings event, then the import checkpoint naming it, carried on
  // `checkpoints-owner` by the room's CREATOR. Every device that opens it after J79 must still adopt that origin.
  const run = (carrier) => {
    const w = world({ mode: "backend1" });
    const room = F.sortLog(F.playingRoom({ songs: 2, dj: "@roomdj:hs" }).log);
    for (const e of room) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const f = fileRoom(w.sb, { mode: "full", settings: { bg: "https://example.org/534.jpg" } });
    const head = room[room.length - 1].l;
    // CHANGED AT `ddjp_571`: the room's own owner floor under the restore, so a file saved from it can show where it starts (below).
    const last = room[room.length - 1];
    const old = { t: "ddjp.checkpoint", n: 1, prev: null, seed: w.sb.StateDeriver.buildSeed(room, undefined), floorL: last.l, thin: false, covers: room[0].eventId + ".." + last.eventId };
    old.h = w.sb.CheckpointFormat.fingerprint(old.n, old.prev, old.seed, old.floorL, old.thin, old.covers);
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$k-oldfloor", room_id: FULL_CH.checkpoints_owner, sender: OWNER, ts: 2e6, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, old, { l: last.l })) } });
    const anchor = { type: "m.room.message", event_id: "$j28anchor", room_id: FULL_CH.settings_owner, sender: OWNER, ts: 3e6, senderRank: 99,
      content: { body: JSON.stringify({ t: "ddjp.room.settings", s: Object.assign(w.sb.StateDeriver.defaultSettings(), f.seed.settings), l: head + 1, dv: 2 }) } };
    const built = w.sb.Checkpoint.buildImport(f.seed, { settingsFrom: "$j28anchor", eventId: "$j28anchor", l: head + 1 });
    // CHANGED AT `ddjp_571`: AS ?v=519 WROTE IT — with no restart number. `buildImport` starts a restart now, so the import it builds is
    // re-made here at restart 0 (`era` absent, fingerprinted as before restarts existed), which is what that room actually holds.
    const cp0 = Object.assign({}, built.cp); delete cp0.era;
    cp0.h = w.sb.CheckpointFormat.fingerprint(cp0.n, cp0.prev, cp0.seed, cp0.floorL, cp0.thin, cp0.covers);
    built.cp = cp0;
    w.sb.StreamManager.ingest(anchor);
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$j28cp", room_id: FULL_CH.checkpoints_owner, sender: carrier, ts: 3e6 + 1, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, built.cp, { l: head + 2 })) } });
    return { w, f, built, old, before: shape(w.sb.StateDeriver.derive(room, undefined)) };
  };
  const a = run(OWNER);
  const fl = a.w.sb.Floor.current();
  ok(a.built.ok && fl && fl.h === a.built.cp.h, "K: decent-534-497's restore — an origin carried by the room's CREATOR over an unmarked anchor — is still adopted", fl && fl.h);
  ok(shape(a.w.sb.StreamManager.getState()) === shape(a.w.sb.StateDeriver.derive([], a.f.seed)) && a.w.sb.StreamManager.getState().settings.bg === "https://example.org/534.jpg",
    "K: and the room still derives the file's state and settings", shape(a.w.sb.StreamManager.getState()));
  // A FILE SAVED FROM IT STARTS AT THAT RESTORE (`ddjp_571`): both save points are of restart 0, so it is the newest ORIGIN at or below the
  // pick that cuts the file there, not the restart — the rule an existing room's own J28 restore still needs.
  const kx = a.w.sb.StreamManager.exportCheckpoint(a.built.cp.h);
  ok(a.built.cp.era === undefined && kx && kx.ok && kx.snapshots === 1 && kx.file.payload.snapshots[0].h === a.built.cp.h,
    "K: a file saved from it starts at that restore — at restart 0 the newest origin cuts the file, and nothing of the floor under it travels", kx && { ok: kx.ok, n: kx.snapshots });
  const b = run(ADMIN);
  // (`ddjp_571`: the room now holds its own floor under the restore, so "ignored" reads as standing on no floor or on that one.)
  ok((!b.w.sb.Floor.current() ||b.w.sb.Floor.current().h === b.old.h) && shape(b.w.sb.StreamManager.getState()) !== shape(b.w.sb.StateDeriver.derive([], b.f.seed)),
    "K: the same origin carried by a top-rung account that is NOT the creator is ignored", b.w.sb.Floor.current());
  ok(b.w.logs.some((m) => /an origin checkpoint not carried by the room's owner was ignored/.test(m)), "K: and says so");
});

// ── L — THIS ROOM'S DOOR (D4) ────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  for (const [mode, fileMode] of [["backend2", "bot"], ["backend1", "full"]]) {
    const w = world({ mode });
    setSettings(w, { vis: "public" });
    const res = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { mode: fileMode, settings: { vis: "private", bg: "https://example.org/l.jpg" } }).file);
    const cp = (w.sent.find((x) => x.t === "ddjp.checkpoint") || {}).body;
    ok(res && res.ok && cp && cp.seed.settings.vis === "public" && cp.seed.settings.bg === "https://example.org/l.jpg",
      "L: a " + mode + " restore keeps THIS room's door — the posted seed carries this room's `vis`, and the file's other settings", cp && cp.seed.settings.vis);
    const an = w.sent.find((x) => x.t === "ddjp.room.settings");
    if (mode === "backend1") ok(an && an.body.s.vis === "public", "L: and so does the shared room's anchor", an && an.body.s.vis);
    else ok(!an, "L: and a bot room posts no settings at all — they ride in the restore");
  }
});

// ── M — THE BOT'S SETTINGS REQUESTS WAIT FOR LIVE ────────────────────────────────────────────────────────────────────────────
part(async () => {
  const sd = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const CH = { events_owner: "!eo:hs", events_staff: "!es:hs", settings_owner: "!so:hs" };
  const wire = [], ready = []; let sub = null, liveNow = false;
  let st = Object.assign(sd.StateDeriver.defaultSettings(), { maxLen: 600, bg: "https://example.org/old.jpg", botDelegation: { maxLen: "staff" } });
  const e2e = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "features/room.js", "features/botsettings.js", "features/botruntime.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: noop, window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, ChatPrefs: { chatTier: () => null, onChange() {}, botView: () => false },
    Chat: { setRoom() {}, setReadableTiers() {}, init() {}, dmInit() {}, send: () => Promise.resolve({ ok: true }) }, Queue: { remove: () => Promise.resolve() },
    ServerClock: { serverNow: () => 1000000 },
    StreamManager: { getState: () => ({ settings: st, rotation: [] }), getLog: () => [], isLegal: () => true, on() {},
      settingRanges: () => { const s0 = sd.StateDeriver.SETTING_RANGES || {}, o = {}; for (const k in s0) { const r = s0[k] || {}, c = {}; for (const f in r) c[f] = (typeof r[f] === "function") ? r[f]() : r[f]; o[k] = c; } return o; } },
    MatrixBridge: { getUserId: () => BOT, getMyRank: () => 99, getMyPowerLevel: () => 99, getUserEffectiveRank: () => 99, getRoster: () => [], rankLadder: () => sd.Ranks.LADDER,
      onRawEvent: (fn) => { sub = fn; }, offRawEvent: () => { sub = null; }, eventsKeyForLevel: (l) => "events_" + (l >= 99 ? "owner" : "staff"),
      channelTaxonomy: () => [], presenceChatKey: () => "presence_chat", amJoined: () => false, spaceChildLevel: () => 100,
      mayAuthor: () => (liveNow ? { ok: true, reason: null } : { ok: false, reason: "replaying" }), onAuthorReady: (fn) => ready.push(fn),
      sendEvent: (ch, type, content) => { wire.push({ ch, type, content }); return Promise.resolve({ eventId: "$w" + wire.length, l: 1 }); },
      setSpaceJoinRule: () => Promise.resolve() },
  });
  e2e.Room._setCurrentForTest({ spaceId: "!space:hs", channels: CH });
  const r = e2e.BotRuntime.start({ roomId: "!space:hs", channels: CH, authorSettings: async (partial) => { const x = await e2e.Room.setSettings(partial); if (!x || !x.ok) throw new Error("no"); return x; } });
  ok(r && r.ok && typeof sub === "function", "M PREMISE — the real bot runtime started and subscribed", r);
  const payload = { s: { maxLen: 601 }, t: "ddjp.bot.request", l: 20 };
  sub({ event_id: "$req", type: "m.room.message", sender: "@p:hs", room_id: CH.events_staff, ts: 1, content: { msgtype: "m.text", body: JSON.stringify(payload) },
    l: 20, ddjpType: "ddjp.bot.request", ddjpBody: payload, senderRank: 60 }, null, null);
  await new Promise((res) => setTimeout(res, 20));
  ok(wire.filter((x) => x.type === "ddjp.room.settings").length === 0, "M: a request arriving while the bot is still catching up is HELD — no settings are posted from a state still loading", wire);
  // The owner's restore reaches the bot while it catches up; then it goes LIVE.
  st = Object.assign({}, st, { bg: "https://example.org/restored.jpg", maxLen: 700 });
  liveNow = true; for (const fn of ready) fn();
  await new Promise((res) => setTimeout(res, 20));
  const w = wire.filter((x) => x.type === "ddjp.room.settings");
  ok(w.length === 1 && w[0].content.s.maxLen === 601 && w[0].content.s.bg === "https://example.org/restored.jpg",
    "M: once live it is answered against the room AS IT STANDS — the requested value merged onto the restored settings, never the old ones",
    w.map((x) => ({ maxLen: x.content.s.maxLen, bg: x.content.s.bg })));
  // A DROPPED REQUEST IS SAID (`ddjp_570`): more than the cap wait while the tab catches up, and the oldest goes — with a line.
  const warned = []; const _w = e2e.Logger.warn; e2e.Logger.warn = (m) => { warned.push(String(m)); };
  liveNow = false;
  for (let k = 0; k < 51; k++) {
    const pk = { s: { maxLen: 602 }, t: "ddjp.bot.request", l: 100 + k };
    sub({ event_id: "$q" + k, type: "m.room.message", sender: "@q" + k + ":hs", room_id: CH.events_staff, ts: 2 + k, content: { msgtype: "m.text", body: JSON.stringify(pk) },
      l: 100 + k, ddjpType: "ddjp.bot.request", ddjpBody: pk, senderRank: 60 }, null, null);
  }
  e2e.Logger.warn = _w;
  ok(warned.filter((m) => /settings request from @q0:hs was DROPPED unanswered/.test(m)).length === 1 && !warned.some((m) => /@q1:hs was DROPPED/.test(m)),
    "M: the 51st held request pushes the oldest out — and it is SAID, naming who asked, never silent", warned.filter((m) => /DROPPED/.test(m)));
  try { e2e.BotRuntime.stop(); } catch (e) {}
});

// ── N — THE OWED RIDER: reset() CLEARS THE MOVE-ON LOG MARK ─────────────────────────────────────────────────────────────────
// A shared-room device trims under real seals, so the move-on check prints its line for floor n=2 — once (the log limit). It
// leaves and re-enters the same room (`StreamManager.reset()`, as `Room._initModules` does) and is fed the room again: a new
// visit is a new reading, so the line is printed again. Before the rider the mark outlived the room and the second visit was silent.
part(async () => {
  const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
    "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
    "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js", "backends/backend1/vouch.js", "backends/backend1/eventcache.js"];
  const MB = src("backends/backend1/matrixbridge.js");
  const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
  const P = F.RANK.player, O = F.RANK.owner;
  const SET = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(),
    { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: SET })];
  { let prev = null;
    for (let l = 2; l <= 70; l++) { const id = "$e" + l;
      if (l <= 4) E.push(F.reducerEvent(id, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
      else if (l % 5 === 0) { E.push(F.reducerEvent(id, l, T0 + l * 4 * MIN, "@d2:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
      else E.push(F.reducerEvent(id, l, T0 + l * MIN, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); } }
  const device = (logs) => {
    const sb = loadInContext(FILES, {});
    for (const lv of ["info", "warn", "debug", "error"]) sb.Logger[lv] = (m) => { if (logs) logs.push(String(m)); };
    const d = { sb, SM: sb.StreamManager, Fl: sb.Floor };
    d.enter = () => { sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {}
      try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); } catch (e) {}
      if (sb.Session._setPhaseForTest) sb.Session._setPhaseForTest(sb.Session.LIVE); };
    d.enter();
    d.Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { d.SM.trimToFloor(); } catch (e) {} } });   // the bridge's trim subscriber
    d.arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", "_carriedByRoomOwner", ARRIVED + "\nreturn _onCheckpointArrived;")(
      d.Fl, sb.TrustPolicy, sb.Continuity, d.SM, quiet, () => d.SM.getState().settings, () => false);
    d.feed = (lo, hi) => { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) d.SM.ingest(F.toRaw(e)); };
    return d;
  };
  // the real seals, by a live sealer device that holds the room
  const S = device(null), cps = []; let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings, myRank: () => 99,
    myUserId: () => BOT, myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { cps.push(JSON.parse(JSON.stringify(cp))); } });
  for (const [hi, lo] of [[17, 1], [66, 18]]) { S.feed(lo, hi); clock = T0 + (hi + 1) * 4 * MIN; await S.sb.Checkpoint.seal(); }
  ok(cps.length === 2, "N PREMISE — the sealer produced two real seals", cps.length);
  const logs = []; const d = device(logs);
  const visit = () => { d.feed(1, 17); d.arrive({ content: cps[0], senderRank: 99, sender: BOT, ts: T0 }); d.feed(18, 66); d.arrive({ content: cps[1], senderRank: 99, sender: BOT, ts: T0 + MIN }); };
  const said = () => logs.filter((m) => m.indexOf("move-on check — floor n=2 ") >= 0).length;
  visit();
  ok(said() === 1, "N PREMISE — the first visit prints the move-on line for floor n=2, once", said());
  d.enter(); visit();
  ok(said() === 2, "N: re-entering the room clears the mark (`StreamManager.reset()`), so the next visit prints its own line", said());
});

// ── O — A RESTORE DELIVERED AGAIN, OR AN OLDER ONE AFTER A NEWER, CHANGES NOTHING (`ddjp_570`) ────────────────────────────────
// The supervisor's finding on `ddjp_569`, driven with this file's own story: one more seal adopted everywhere, then the restore's
// raw delivered again — every device's save point went back to the restore, the devices that had opened from a later seal
// re-adopted it, and two clients then disagreed. Routes that can deliver a repeat: a live event that replay's scrollback then
// folds again; the owner's own event admitted early and echoed late.
const placeOf = (d) => { const f = d.sb.B2Checkpoint.floor(), a = d.sb.B1StreamManager.adoptedFloor();
  return JSON.stringify({ floor: f && f.h, adopted: a && a.floorL, state: shape(d.sb.StreamManager.getState()), history: rowsOf(d) }); };
const kindsOf = (S) => Object.keys(S.devices).filter((n) => S.devices[n]);
part(async () => {
  // (1) THE SAME RESTORE AGAIN, after later seals, while every device that saw it still holds it.
  const S = await botStory({ seals: 3 });
  S.play(); S.join("@dj:hs", "xtr00dddddd"); const last = S.seal();
  const names = kindsOf(S), before = {};
  for (const n of names) before[n] = placeOf(S.devices[n]);
  ok(names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === last.h) && names.length >= 6,
    "O PREMISE — one more seal is adopted on every kind of device", names.map((n) => S.devices[n].sb.B2Checkpoint.floor().n));
  for (const n of names) S.devices[n].live(S.restoreRaw);
  for (const n of names) ok(placeOf(S.devices[n]) === before[n], "O: the restore delivered AGAIN after later seals changes nothing on the " + n.toUpperCase() +
    " device — its save point, its adopted floor, its room, its song history", { before: before[n], after: placeOf(S.devices[n]) });
  S.join("@d1:hs", "one00dddddd");
  const one = names.map((n) => shape(S.devices[n].sb.StreamManager.getState()));
  ok(new Set(one).size === 1, "O: and after one more act every device of every kind holds the same room — the supervisor's reading had two disagree", one);

  // (2) THE SAME, WHERE NO DEVICE REMEMBERS IT: the long room — 27 seals since, so it has left every device's held window.
  if (STORY) {
    const T = STORY, tn = kindsOf(T), tb = {};
    for (const n of tn) tb[n] = placeOf(T.devices[n]);
    ok(tn.every((n) => !T.devices[n].sb.B2Checkpoint.held().some((h) => h.ownerOrigin)),
      "O PREMISE — in the long room no device still holds the restore, so what refuses it below is its PLACE IN THE LOG, not memory");
    for (const n of tn) T.devices[n].live(T.restoreRaw);
    for (const n of tn) ok(placeOf(T.devices[n]) === tb[n], "O: and where nothing remembers it, its place in the log refuses it — the " + n.toUpperCase() +
      " device is unchanged", { before: tb[n], after: placeOf(T.devices[n]) });
  } else ok(false, "O PREMISE — the long story ran");

  // (3) A NEWER RESTORE, then the newer again and the OLDER again.
  const f2 = fileRoom(S.owner.sb, { songs: 2, settings: { bg: "https://example.org/second.jpg" } });
  const r2 = await S.owner.sb.Room.overrideFromFile(f2.file);
  const s2 = S.owner.sent[S.owner.sent.length - 1];
  S.deliver(S.post(s2.roomId, OWNER, s2.body));
  const R2raw = S.server[s2.roomId][S.server[s2.roomId].length - 1];
  ok(r2 && r2.ok === true && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === s2.body.h),
    "O PREMISE — a second restore is adopted on every device", r2);
  S.setPi(s2.body.seed.nowPlaying.pi);
  let lastSeal = null;
  for (let k = 0; k < 2; k++) { S.play(); S.join("@dj:hs", "sec0" + k + "ddddddd"); lastSeal = S.seal(); }
  const b2 = {};
  for (const n of names) b2[n] = placeOf(S.devices[n]);
  for (const n of names) { S.devices[n].live(R2raw); S.devices[n].live(S.restoreRaw); }
  for (const n of names) ok(placeOf(S.devices[n]) === b2[n], "O: the newer restore again, then the OLDER one, change nothing on the " + n.toUpperCase() + " device",
    { before: b2[n], after: placeOf(S.devices[n]) });

  // (4) THE FOLD ON ITS OWN: an origin below the floor it stands on is never re-adopted, whatever the engine above hands it.
  //     Handed its restart as the door hands it (`ddjp_571`: the reasons are now the restart's — `earlier-restart` for the older
  //     restore, `not-a-later-restart` for the one the fold already stands in; `ddjp_570` said `not-later-in-log`).
  {
    const d = S.devices.owner, a0 = placeOf(d), R1 = S.restore, rl = JSON.parse(S.restoreRaw.content.body).l;
    const rr = d.sb.B1StreamManager.adoptFloor({ floorL: R1.floorL, seed: R1.seed, covers: R1.covers, era: R1.era, root: { l: rl, id: S.restoreRaw.event_id },
      id: S.restoreRaw.event_id, h: R1.h, n: R1.n }, { take: "all", origin: true });
    const r2l = JSON.parse(R2raw.content.body).l;
    const rr2 = d.sb.B1StreamManager.adoptFloor({ floorL: s2.body.floorL, seed: s2.body.seed, covers: s2.body.covers, era: s2.body.era, root: { l: r2l, id: R2raw.event_id },
      id: R2raw.event_id, h: s2.body.h, n: s2.body.n }, { take: "all", origin: true });
    ok(rr && rr.ok === false && rr.reason === "earlier-restart" && rr2 && rr2.ok === false && rr2.reason === "not-a-later-restart" && placeOf(d) === a0,
      "O: the fold refuses it by itself — `adoptFloor` never re-adopts an origin earlier in the log than the floor it stands on", [rr, rr2]);
  }

  // (5) THE ROOM GOES ON: every device of every kind agrees after one more act, and the bot's next seal chains to the latest SEAL —
  //     the last one made before the repeats, never a restore delivered again.
  S.play(); S.join("@dj:hs", "nxt00dddddd");
  const acted = names.map((n) => shape(S.devices[n].sb.StreamManager.getState()));
  ok(new Set(acted).size === 1, "O: after the repeats and one more act, every device of every kind holds the same room", acted);
  const next = S.seal();
  ok(next.prev === lastSeal.h && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === next.h),
    "O: the bot's next seal chains to the LATEST seal and is adopted everywhere", { prev: next.prev, latest: lastSeal.h });
  const shapes = names.map((n) => shape(S.devices[n].sb.StreamManager.getState()));
  ok(new Set(shapes).size === 1, "O: and every device, of every kind, holds the same room", shapes);

  // (6) SHARED ROOMS, CHECKED: `Floor.adopt` takes only a strictly higher cut, so a repeated or older origin was never able to move
  //     one back. Driven, so the claim is a reading: the restore again over a later owner floor, and the older after a newer.
  {
    const w = world({ mode: "backend1" });
    const room = F.sortLog(F.playingRoom({ songs: 2, dj: "@roomdj:hs" }).log);
    for (const e of room) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const restoreShared = async (file) => { const n0 = w.sent.length; const r = await w.sb.Room.overrideFromFile(file); const mine = w.sent.slice(n0);
      for (const x of mine) w.sb.StreamManager.ingest(echo(w, x, OWNER)); return { r: r, cp: mine[mine.length - 1] }; };
    const A = await restoreShared(fileRoom(w.sb, { mode: "full" }).file);
    const AR = A.cp.body;
    const more = [F.reducerEvent("$m1", AR.floorL + 2, 9e6, "@dj:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGX" })];
    for (const e of more) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const seedG = Object.assign({}, w.sb.StateDeriver.buildSeed(more, AR.seed), { settingsFrom: AR.seed.settingsFrom });
    // An owner seal on the restore, as `Checkpoint.seal` writes one since `ddjp_571`: the restore's restart — its era, and its root,
    // where the restore's own event sits. (Without them it would be a seal of the room's earlier restart, and refused.)
    const G = { t: "ddjp.checkpoint", n: 2, prev: AR.h, seed: seedG, floorL: AR.floorL + 2, thin: false, covers: "$m1..$m1",
      era: AR.era, root: { l: AR.l, id: A.cp.id } };
    G.h = w.sb.CheckpointFormat.fingerprint(G.n, G.prev, G.seed, G.floorL, G.thin, G.covers, G.era, G.root);
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$G", room_id: FULL_CH.checkpoints_owner, sender: OWNER, ts: 9e6 + 1, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, G, { l: AR.floorL + 3 })) } });
    const atG = shape(w.sb.StreamManager.getState());
    ok(A.r.ok && w.sb.Floor.current() && w.sb.Floor.current().h === G.h, "O PREMISE — a shared room stands on an owner floor above its restore");
    w.sb.StreamManager.ingest(echo(w, A.cp, OWNER));
    ok(w.sb.Floor.current().h === G.h && shape(w.sb.StreamManager.getState()) === atG, "O: a shared room's restore delivered again changes nothing (checked: no fix needed)");
    const B = await restoreShared(fileRoom(w.sb, { mode: "full", songs: 2 }).file);
    const atB = shape(w.sb.StreamManager.getState());
    ok(B.r.ok && w.sb.Floor.current().h === B.cp.body.h, "O PREMISE — a newer restore is adopted in the shared room");
    w.sb.StreamManager.ingest(echo(w, A.cp, OWNER));
    ok(w.sb.Floor.current().h === B.cp.body.h && shape(w.sb.StreamManager.getState()) === atB, "O: nor does the OLDER restore after a newer one (checked: no fix needed)");
  }
  // (7) THE ORDER ITSELF, one home (`CheckpointFormat.laterInLog`), and `B2Checkpoint` reading it.
  {
    const CF = loadInContext(["core/logger.js", "backends/backend1/consensushash.js", "backends/backend1/checkpointformat.js"], {}).CheckpointFormat;
    // REMOVED AT `ddjp_571` by the owner's ruling: "at one `l`, an owner origin sorts after a seal" — the restart decides that now.
    ok(CF.compareRestart({ era: 1, root: { l: 5, id: "$r" } }, { era: 0, root: null }) > 0 && CF.compareRestart({ era: 0 }, { era: 1, root: { l: 5, id: "$r" } }) < 0,
      "O: the RESTART decides first — a restore's era stands over every save point of the one before, wherever either sits in the log (`ddjp_571`)");
    ok(CF.compareRestart({ era: 1, root: { l: 6, id: "$a" } }, { era: 1, root: { l: 5, id: "$z" } }) > 0 &&
       CF.compareRestart({ era: 1, root: { l: 5, id: "$b" } }, { era: 1, root: { l: 5, id: "$a" } }) > 0 &&
       CF.compareRestart({ era: 1, root: { l: 5, id: "$a" } }, { era: 1, root: { l: 5, id: "$a" } }) === 0,
      "O: at one restart, the restore LATER IN THE LOG wins — its root's `l`, then its event id (`ddjp_571`)");
    ok(CF.laterInLog({ l: 4, id: "$z" }, { l: 5, id: "$a" }) === false && CF.laterInLog({ l: 6, id: "$a" }, { l: 5, id: "$z" }) === true &&
       CF.laterInLog({ l: 5, id: "$b" }, { l: 5, id: "$a" }) === true, "O: otherwise the position decides — `l`, then the event id — whatever the kind");
    const sbc = loadInContext(["core/logger.js", "backends/backend1/consensushash.js", "backends/backend1/checkpointformat.js", "backends/backend2/checkpoint.js"], {});
    const C = sbc.B2Checkpoint;
    const s1 = C.seal({ a: 1 }, { isRunner: true, floorL: 10, covers: "$x" }).cp;
    C.observe(s1, { id: "$s1", l: 10 });
    const stale = C.seal({ a: 2 }, { isRunner: true, floorL: 12, covers: "$y" }).cp;
    const R = C.restore({ b: 1 }, { floorL: 11, covers: null }).cp;
    const older = C.restore({ b: 0 }, { floorL: 9, covers: null }).cp;
    C.observe(stale, { id: "$st", l: 13 });
    const o1 = C.observe(R, { id: "$r", l: 13, owner: true });
    ok(o1.adopted === true && C.floor().h === R.h, "O: a seal and a restore at the same `l`, the seal observed first — the restore stands", o1);
    const o2 = C.observe(older, { id: "$old", l: 12, owner: true });
    ok(o2.adopted === false && C.floor().h === R.h, "O: an owner restore earlier in the log than the floor is refused, though observed later", o2);
    const s2 = C.seal({ a: 3 }, { isRunner: true, floorL: 14, covers: "$z" }).cp;
    C.observe(s2, { id: "$s2", l: 15 });
    const o3 = C.observe(R, { id: "$r", l: 13, owner: true }), o4 = C.observe(R, { id: "$r-again", l: 16, owner: true });
    ok(o3.duplicate === true && o4.duplicate === true && C.floor().h === s2.h,
      "O: and a save point already held — by its event id, or its fingerprint under another id — changes nothing", [o3, o4]);
  }
  // (7b) A FLOOR LATER IN THE LOG THAN THE RESTORE: the old room's, seen first — or one built on the restore.
  {
    const load = () => loadInContext(["core/logger.js", "backends/backend1/consensushash.js", "backends/backend1/checkpointformat.js", "backends/backend2/checkpoint.js"], {}).B2Checkpoint;
    const C = load(), Cr = load();
    const base = C.seal({ a: 1 }, { isRunner: true, floorL: 10, covers: "$x" }).cp;
    C.observe(base, { id: "$b", l: 10 }); Cr.observe(base, { id: "$b", l: 10 });
    const R = C.restore({ b: 1 }, { floorL: 10, covers: "$x" }).cp;
    const stale = C.seal({ a: 2 }, { isRunner: true, floorL: 10, covers: "$x" }).cp;          // the bot's seal on the old floor, same `n`
    C.observe(stale, { id: "$st", l: 12 });
    const o = C.observe(R, { id: "$R", l: 11, owner: true });
    const st = C.held().find((h) => h.id === "$st");
    // By its restart since `ddjp_571` (the walk and `replacedBy` are gone, by the owner's ruling): the restore is a later restart.
    ok(o.adopted === true && C.floor().h === R.h && st.accepted === false && o.era === 1 && st.era === 0,
      "O: a seal on the old floor LATER in the log than the restore, seen first, is replaced — it never stood, by the log", { o: o, st: st });
    Cr.observe(R, { id: "$R", l: 11, owner: true });
    const child = Cr.seal({ c: 1 }, { isRunner: true, floorL: 13, covers: "$y" }).cp;        // built on the restore
    const D = load();
    D.observe(base, { id: "$b", l: 10 }); D.observe(child, { id: "$c", l: 14 });
    const od = D.observe(R, { id: "$R", l: 11, owner: true });
    ok(od.adopted === false && D.floor().h === child.h, "O: and a restore whose floor already BUILDS ON IT, seen after, is refused", od);
  }

});

// ── P — THE BOT SEALED TWICE ON THE OLD FLOOR BEFORE THE RESTORE REACHED IT (`ddjp_570`) ─────────────────────────────────────
// The supervisor's guard gap: a stale-seal rule keyed on `n` (`… && cp.n <= _floor.n`) stayed green, because part D only offers a
// stale seal with the restore's `n`. Here the bot seals TWICE on the old floor before the restore reaches it: the first lands
// before the restore with its `n` — the restore still wins — and the second, built on the first, lands after it with an `n` one
// higher than the restore's.
part(async () => {
  // Twice: with the positions in the order things landed, and with the bot's clock a tick ahead, so its first stale seal — landing
  // FIRST — sits LATER in the log than the restore (P2). The second is the case a rule comparing the restore with whatever floor this
  // client happens to hold gets wrong: it would refuse the restore wherever the seal was seen first, the owner's included.
  for (const [P, opts] of [["P", { staleBefore: true, seals: 2 }], ["P2", { staleBefore: true, staleLater: true, seals: 2 }]]) {
    const S = await botStory(opts);
    const R = S.restore, fileShape = shape(S.owner.sb.StateDeriver.derive([], S.fileSeed));
    const lOf = (raw) => JSON.parse(raw.content.body).l;
    // CHANGED AT `ddjp_571`: a restore's `n` is 1 now (a new restart), so "the first has the restore's `n`" cannot be built. The
    // scenario is the same — two seals the bot made on the old floor, the first landing before the restore, the second after —
    // and both now have an `n` HIGHER than the restore's: exactly what a stale-seal rule keyed on `n` would let through.
    ok(R && S.stale1 && R.era === 1 && R.n === 1 && !S.stale1.era && S.stale1.n > R.n && S.stale && !S.stale.era && S.stale.prev === S.stale1.h &&
       S.stale.n === S.stale1.n + 1,
      P + " PREMISE — two seals the bot made on the old floor, the first landing before the restore, the second built on it after; both of the earlier restart, both with an `n` HIGHER than the restore's",
      { restore: R && [R.era, R.n], first: S.stale1 && [S.stale1.era, S.stale1.n], second: S.stale && [S.stale.era, S.stale.n] });
    if (P === "P2") ok(lOf(S.stale1Raw) > lOf(S.restoreRaw) && S.stale1.floorL === R.floorL,
      "P2 PREMISE — the first stale seal, landing first, sits LATER in the log than the restore, at the same cut",
      { seal: lOf(S.stale1Raw), restore: lOf(S.restoreRaw) });
    for (const n of Object.keys(S.afterRestore)) {
      const a = S.afterRestore[n];
      ok(a.floor && a.floor.h === R.h && a.moveOn && a.moveOn.origin === true && a.moveOn.ok === true && a.state === fileShape,
        P + ": the restore still WINS on the " + n.toUpperCase() + " device, though a seal with its `n` landed first", { moveOn: a.moveOn, state: a.state });
    }
    for (const n of Object.keys(S.afterStale)) {
      const a = S.afterStale[n];
      ok(a.floor && a.floor.h === R.h && a.refused.indexOf("does not build on the room's restore") >= 0 && a.state === S.afterRestore[n].state,
        P + ": the second stale seal — its `n` one higher than the restore's — is refused on the " + n.toUpperCase() + " device and changes nothing", a);
    }
    ok(S.between && S.between.state === S.afterStale.owner.state, P + ": a device opening after both agrees", S.between);
    ok(S.firstOnRestore.prev === R.h && S.firstOnRestore.n === R.n + 1, P + ": the bot's next seal builds on the restore", { prev: S.firstOnRestore.prev });
    const all = kindsOf(S);
    const floors = all.map((n) => S.devices[n].sb.B2Checkpoint.floor().h), shapes = all.map((n) => shape(S.devices[n].sb.StreamManager.getState()));
    ok(new Set(floors).size === 1 && new Set(shapes).size === 1, P + ": and at the end every device, of every kind, stands on the same save point and holds the same room",
      { kinds: all, floors: new Set(floors).size, shapes: new Set(shapes).size });
    if (P === "P2") {
      const st = all.map((n) => S.devices[n].sb.B2Checkpoint.held().find((h) => h.n === R.n && !h.ownerOrigin)).filter(Boolean);
      ok(st.length >= 3 && st.every((h) => h.accepted === false),
        "P2: and the stale seal seen first is not a save point that stood — by the log it came after the restore and did not build on it", st);
    }
  }
});

// ── Q — TWO RESTORES OF ONE RESTART: THE ROOT DECIDES (`ddjp_571`, owner's ruling) ─────────────────────────────────────────────
// Two devices of the room's owner restore at once, from the same floor, so both restores carry the same restart number. The one
// later in the log wins its restart, and with it everything built on it — the bot's confirmation of the other included. Without
// the root, a confirmation of the losing restore (`n` 2) would outrank the winner (`n` 1) on devices that saw it first, the fold
// could not cross between the two files with a proof, and the room would split between them (the design round's trace).
const CONFIRMS = (d, h) => d.sent.filter((x) => x.t === "ddjp.checkpoint" && x.body && x.body.prev === h);
part(async () => {
  const S = await botStory({ seals: 2 });
  const owner = S.devices.owner, owner2 = await S.dev("owner2", OWNER), bot = S.bot;
  const J = bot.sb.B2Runner.CONFIRM_JOB || "b2:confirm-restore";     // read so the part runs on a build without it (red first)
  const fA = fileRoom(owner.sb, { songs: 2, settings: { bg: "https://example.org/a.jpg" } });
  const fB = fileRoom(owner2.sb, { songs: 3, settings: { bg: "https://example.org/b.jpg" } });
  const e0 = (owner.sb.B2Checkpoint.floor() && owner.sb.B2Checkpoint.floor().era) || 0;
  const rA = await owner.sb.Room.overrideFromFile(fA.file), sA = owner.sent[owner.sent.length - 1];
  const rB = await owner2.sb.Room.overrideFromFile(fB.file), sB = owner2.sent[owner2.sent.length - 1];
  ok(rA.ok && rB.ok && sA.body.era === e0 + 1 && sB.body.era === e0 + 1 && sA.body.n === 1 && sB.body.n === 1,
    "Q PREMISE — two restores made at once from one floor carry the SAME restart number", { a: [sA.body.era, sA.body.n], b: [sB.body.era, sB.body.n], floor: e0 });
  const RA = S.post(sA.roomId, OWNER, sA.body), RB = S.post(sB.roomId, OWNER, sB.body);
  const placeA = { l: JSON.parse(RA.content.body).l, id: RA.event_id }, placeB = { l: JSON.parse(RB.content.body).l, id: RB.event_id };
  ok(owner.sb.CheckpointFormat.laterInLog(placeB, placeA), "Q PREMISE — B's restore sits later in the log", { a: placeA, b: placeB });
  // A reaches every device first; the bot confirms it before B arrives; half the devices hold that confirmation before B, half after.
  S.deliver(RA);
  bot.sb.Scheduler._fireNowForTest(J); bot.sb.B2Authority.flush();
  const cA = CONFIRMS(bot, sA.body.h);
  ok(cA.length === 1, "Q PREMISE — the bot confirmed A while A was all it had", cA.length);
  const CA = cA[0] ? S.post(BOT_CH.events_owner, BOT, cA[0].body) : null;
  const names = kindsOf(S);
  if (CA) names.forEach((n, i) => { if (i % 2 === 0) S.devices[n].live(CA); });
  S.deliver(RB);
  if (CA) names.forEach((n, i) => { if (i % 2 === 1) S.devices[n].live(CA); });
  for (const n of names) {
    const f = S.devices[n].sb.B2Checkpoint.floor();
    ok(f && f.h === sB.body.h, "Q: on the " + n.toUpperCase() + " device the LATER restore stands — over the earlier one and over the bot's confirmation of it, in either order",
      f && { n: f.n, era: f.era, h: f.h === sA.body.h ? "A" : (cA[0] && f.h === cA[0].body.h) ? "conf A" : "?" });
  }
  bot.sb.Scheduler._fireNowForTest(J); bot.sb.B2Authority.flush();
  const cB = CONFIRMS(bot, sB.body.h);
  ok(cB.length === 1 && cB[0].body.root && cB[0].body.root.id === RB.event_id && cB[0].body.n === 2,
    "Q: the bot confirms B in turn — one confirmation per restore, its root B's own event", cB.map((x) => x.body.root));
  if (cB[0]) S.deliver(S.post(BOT_CH.events_owner, BOT, cB[0].body));
  const shapeB = shape(owner.sb.StateDeriver.derive([], fB.seed));
  const states = names.map((n) => shape(S.devices[n].sb.StreamManager.getState()));
  ok(cB[0] && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === cB[0].body.h) && states.every((x) => x === shapeB),
    "Q: and every device of every kind ends in B's room, standing on B's confirmation — no device on A's lineage", { states: new Set(states).size, b: shapeB });
  S.setPi(sB.body.seed.nowPlaying.pi);
  S.play(); S.join("@dj:hs", "qqq00dddddd");
  const nxt = S.seal();
  ok(nxt.root && nxt.root.id === RB.event_id && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === nxt.h),
    "Q: the bot's next seal carries B's root and is adopted everywhere", nxt.root);
  ok(CONFIRMS(owner, sA.body.h).length + CONFIRMS(owner2, sB.body.h).length + CONFIRMS(owner, sB.body.h).length + CONFIRMS(owner2, sA.body.h).length === 0,
    "Q: and neither of the owner's devices confirms anything (owner's ruling: the bot confirms)");
});

// ── R — THE BOT'S CONFIRMATION, AND ITS BOUND (`ddjp_571`, owner's ruling) ──────────────────────────────────────────────────────
// The bot confirms the owner's restore at once, as its next seal, through the ordered gate. Owed only while the restore is still
// the save point, re-read through `Scheduler` just before it goes; at most one per device; never a restore, so it sets off nothing.
// Driven across the duplicate-delivery routes (the restore and the confirmation delivered again), a reload, and an offline return.
part(async () => {
  const S = await botStory({ seals: 2 });
  const owner = S.devices.owner, bot = S.bot, names = kindsOf(S), J = bot.sb.B2Runner.CONFIRM_JOB || "b2:confirm-restore";
  const adopted = (d) => { if (d.sb.B2Runner.restoreAdopted) d.sb.B2Runner.restoreAdopted(); };   // so the part runs on a build without it
  const f2 = fileRoom(owner.sb, { songs: 2 });
  await owner.sb.Room.overrideFromFile(f2.file);
  const s2 = owner.sent[owner.sent.length - 1];
  const before = JSON.parse(JSON.stringify(S.server));          // the room as a device whose download never reaches the restore sees it (gap 3)
  const R2 = S.post(s2.roomId, OWNER, s2.body);
  S.deliver(R2);
  ok(bot.sb.Scheduler.isPending(J), "R: the moment the bot's fold stands on the owner's restore, its confirmation is planned — through Scheduler");
  ok(names.filter((n) => n !== "bot").every((n) => !S.devices[n].sb.Scheduler.isPending(J)),
    "R: and no other device plans one — the owner's device does not confirm (owner's ruling)", names.filter((n) => S.devices[n].sb.Scheduler.isPending(J)));
  bot.sb.Scheduler._fireNowForTest(J);
  ok(CONFIRMS(bot, s2.body.h).length === 0 && bot.sb.B2Authority.unsent() >= 1,
    "R: and it waits in the ordered gate — handed to `B2Authority` as the bot's next seal, never written past it", { sent: CONFIRMS(bot, s2.body.h).length, unsent: bot.sb.B2Authority.unsent() });
  bot.sb.B2Authority.flush();
  const c = CONFIRMS(bot, s2.body.h);
  const rl = JSON.parse(R2.content.body).l;
  ok(c.length === 1 && c[0].body.thin === false && c[0].body.n === 2 && c[0].body.era === s2.body.era &&
     c[0].body.root && c[0].body.root.id === R2.event_id && c[0].body.root.l === rl,
    "R: the bot confirms it AT ONCE — a save point built on the restore: `prev` the restore, `n` 2, its restart, never a restore itself",
    c.map((x) => ({ n: x.body.n, era: x.body.era, thin: x.body.thin, root: x.body.root })));
  ok(bot.logs.some((m) => m.indexOf("B2Runner: confirming the owner's restore — restart " + s2.body.era + " n=1 at l=" + s2.body.floorL +
     " — with save point restart " + s2.body.era + " n=2 built on it") >= 0), "R: and says so — the line the owner's live check reads (J79's Done-when)",
    bot.logs.filter((m) => /confirming/.test(m)));
  adopted(bot); bot.sb.Scheduler._fireNowForTest(J); bot.sb.B2Authority.flush();
  ok(CONFIRMS(bot, s2.body.h).length === 1, "R: asked again while it is in flight, nothing more is sent — one per device", CONFIRMS(bot, s2.body.h).length);
  const C = c[0] ? S.post(BOT_CH.events_owner, BOT, c[0].body) : null;
  if (C) S.deliver(C);
  ok(c[0] && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === c[0].body.h),
    "R: every device of every kind holds it — a save point that builds on the restore", names.map((n) => S.devices[n].sb.B2Checkpoint.floor().n));
  ok(bot.sb.B2Runner._confirmOwed && !bot.sb.B2Runner._confirmOwed(), "R: and none is owed any more: the restore is no longer the save point — read from the log, not remembered");
  // GAP 3 (`bot-backend.md` §6a; the owner's ruling): a device that opened without ever reading the restore moves to its restart the
  // moment the confirmation arrives — a save point of a later restart replaces its room, with no proof, as the restore would have.
  {
    const late = world({ me: "@late:hs", server: before, opened: false }); await late.open();
    const was = late.sb.B2Checkpoint.floorRestart ? late.sb.B2Checkpoint.floorRestart().era : null;
    if (C) late.live(C);
    const f2Shape = shape(owner.sb.StateDeriver.derive([], f2.seed));
    ok(was === s2.body.era - 1 && late.sb.B2Checkpoint.floorRestart && late.sb.B2Checkpoint.floorRestart().era === s2.body.era && shape(late.sb.StreamManager.getState()) === f2Shape &&
       late.logs.some((m) => m.indexOf("B2StreamManager: moved to restart " + s2.body.era + " at save point n=2") >= 0),
      "R: a device that never read the restore moves to its restart when the bot's confirmation arrives — and says so (gap 3)",
      { was: was, said: late.logs.filter((m) => /moved to restart/.test(m)) });
  }
  // THE DUPLICATE-DELIVERY ROUTES (`ddjp_570`): the restore and the confirmation delivered again, on every device.
  for (const n of names) { S.devices[n].live(R2); if (C) S.devices[n].live(C); }
  adopted(bot); bot.sb.Scheduler._fireNowForTest(J); bot.sb.B2Authority.flush();
  ok(CONFIRMS(bot, s2.body.h).length === 1 && c[0] && names.every((n) => S.devices[n].sb.B2Checkpoint.floor().h === c[0].body.h),
    "R: delivered again — the restore and its confirmation — nothing changes, nothing more is owed or sent");
  // A RELOAD: the bot reopens and reads the log.
  const b2 = bot.reload(); await b2.open();
  adopted(b2); b2.sb.Scheduler._fireNowForTest(J); b2.sb.B2Authority.flush();
  ok(c[0] && b2.sb.B2Checkpoint.floor() && b2.sb.B2Checkpoint.floor().h === c[0].body.h && CONFIRMS(b2, s2.body.h).length === 0,
    "R: the bot reloaded reads the log — a save point already builds on the restore, so it confirms nothing", CONFIRMS(b2, s2.body.h).length);
  // RE-READ JUST BEFORE SENDING: a third restore, then — before the planned confirmation fires — the bot's ordinary seal lands on it.
  const f3 = fileRoom(owner.sb, { songs: 3 });
  await owner.sb.Room.overrideFromFile(f3.file);
  const s3 = owner.sent[owner.sent.length - 1];
  S.deliver(S.post(s3.roomId, OWNER, s3.body));
  ok(bot.sb.Scheduler.isPending(J), "R PREMISE — a confirmation of the third restore is planned");
  S.setPi(s3.body.seed.nowPlaying.pi);
  S.play(); S.join("@dj:hs", "rrr00dddddd"); S.seal();
  const fired = bot.sb.Scheduler._fireNowForTest(J); bot.sb.B2Authority.flush();
  ok(bot.sb.B2Runner.CONFIRM_JOB && fired && fired.fired === false && fired.reason === "no-longer-needed" && CONFIRMS(bot, s3.body.h).length === 0,
    "R: re-read just before sending — a save point already built on the restore, so the planned confirmation stands down", fired);
  // THE BOUND, over every device and every restore in this story.
  const restores = [s2.body.h, s3.body.h];
  const per = restores.map((h) => names.reduce((k, n) => k + CONFIRMS(S.devices[n], h).length, 0));
  const origins = names.reduce((k, n) => k + S.devices[n].sent.filter((x) => x.t === "ddjp.checkpoint" && x.body && !x.body.prev).length, 0);
  ok(per.every((k) => k <= 1) && origins === 1 + 2,
    "R: THE BOUND — at most one confirmation per restore per device (here the bot's, and only while owed), and the only save points with no " +
    "predecessor any device sent are the restores clicked: a confirmation sets off nothing", { per: per, origins: origins });
  // NOT OWED FOR A RESTORE THE BOT'S FOLD DOES NOT STAND ON: an owner's origin whose seed is not a starting state is the save point
  // `B2Checkpoint` holds, but the fold never adopts it — so a confirmation would be a seal of the room the fold still shows.
  {
    const disp = JSON.parse(JSON.stringify(bot.sb.StreamManager.getState()));
    const af = bot.sb.B1StreamManager.adoptedFloor();
    const Rb = owner.sb.B2Checkpoint.restore(disp, { floorL: ((af && af.floorL) || 0) + 1, covers: null }).cp;
    S.deliver(S.post(BOT_CH.events_owner, OWNER, Rb));
    ok(bot.sb.B2Checkpoint.floor().h === Rb.h && bot.sb.B1StreamManager.adoptedFloor().h !== Rb.h && bot.sb.B2Runner._confirmOwed && !bot.sb.B2Runner._confirmOwed() &&
       !bot.sb.Scheduler.isPending(J),
      "R: and none is owed for a restore the bot's fold could not stand on — one whose seed is not a starting state", { floor: bot.sb.B2Checkpoint.floor().h === Rb.h });
  }

  // THE OFFLINE RETURN: the bot's tab is closed during the restore; it confirms on its return, once, if still owed.
  let back = null;
  const T = await botStory({ botOffline: true, noSealsBefore: true, seals: 1, afterReopen: async (U, b) => {
    const pending = b.sb.Scheduler.isPending(J);
    b.sb.Scheduler._fireNowForTest(J); b.sb.B2Authority.flush();
    const sent = CONFIRMS(b, U.restore.h);
    b.sb.Scheduler._fireNowForTest(J); b.sb.B2Authority.flush();
    back = { pending: pending, sent: sent.length, again: CONFIRMS(b, U.restore.h).length, body: sent[0] && sent[0].body };
    if (sent[0]) U.deliver(U.post(BOT_CH.events_owner, BOT, sent[0].body));
  } });
  ok(back && back.pending === true && back.sent === 1 && back.again === 1 && back.body.n === 2 && back.body.prev === T.restore.h,
    "R: OFFLINE — the bot, back after the restore, confirms it on its return, once: it is still owed", back && { pending: back.pending, sent: back.sent, again: back.again });
  ok(kindsOf(T).every((n) => T.devices[n].sb.B2Checkpoint.floor().n >= 2),
    "R: and every device moves on from the bare restore", kindsOf(T).map((n) => T.devices[n].sb.B2Checkpoint.floor().n));
});

// ── S — A SHARED ROOM KEEPS ITS RESTORE AGAINST THE BOT'S SEAL OF THE OLD ROOM (`ddjp_571`, the design round's M1) ───────────────
// The room's bot writes `checkpoints-owner` and is the room's de facto sealer, and an owner-channel floor is adopted on authority. At
// `ddjp_570`, its seal of the OLD room with a cut above the restore's, made in the same moment, won in either order and the restore
// was lost. The restart decides first now: the restore is restart 1, the bot's seal restart 0.
part(async () => {
  for (const [label, who, rank, ch, after] of [["the bot's seal after the restore", BOT, 99, FULL_CH.checkpoints_owner, true],
      ["the bot's seal before the restore", BOT, 99, FULL_CH.checkpoints_owner, false],
      ["control: a staff member's seal after the restore", STAFF, 50, "!c50:hs", true]]) {
    const w = world({ mode: "backend1" });
    const room = F.sortLog(F.playingRoom({ songs: 2, dj: "@roomdj:hs" }).log);
    for (const e of room) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const n0 = w.sent.length, f = fileRoom(w.sb, { mode: "full" });
    const r = await w.sb.Room.overrideFromFile(f.file); const mine = w.sent.slice(n0);
    const AR = mine[mine.length - 1].body, fileShape = shape(w.sb.StateDeriver.derive([], f.seed));
    const more = [F.reducerEvent("$m1", AR.floorL + 2, 9e6, "@dj:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGX" })];
    const St = { t: "ddjp.checkpoint", n: 1, prev: null, seed: w.sb.StateDeriver.buildSeed(room.concat(more), null), floorL: AR.floorL + 2, thin: false,
      covers: room[0].eventId + "..$m1" };
    St.h = w.sb.CheckpointFormat.fingerprint(St.n, St.prev, St.seed, St.floorL, St.thin, St.covers);
    const seal = () => { for (const e of more) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
      w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$stale", room_id: ch, sender: who, ts: 9e6 + 1, senderRank: rank,
        content: { body: JSON.stringify(Object.assign({}, St, { l: AR.floorL + 3 })) } }); };
    const restore = () => { for (const x of mine) w.sb.StreamManager.ingest(echo(w, x, OWNER)); };
    if (after) { restore(); seal(); } else { seal(); restore(); }
    const fl = w.sb.Floor.current();
    ok(r.ok && fl && fl.h === AR.h && shape(w.sb.StreamManager.getState()) === fileShape,
      "S: " + label + " — the RESTORE stands and the room is the file's", { floor: fl && (fl.h === St.h ? "the old room's seal" : fl.h === AR.h ? "the restore" : "?"),
        room: shape(w.sb.StreamManager.getState()) === fileShape ? "file" : "old" });
    if (who === BOT) ok(AR.era === 1 && w.sb.Floor.restartOf(fl).era === 1, "S: by its restart — the restore opens restart 1, the bot's seal is of restart 0", AR.era);
    if (label.indexOf("after") >= 0 && who === BOT) {
      // the room goes on in the restart: the next restore is one higher, and a file saved now carries the restart and reads back
      const B = await (async () => { const k = w.sent.length; const rr = await w.sb.Room.overrideFromFile(fileRoom(w.sb, { mode: "full", songs: 2 }).file);
        const m2 = w.sent.slice(k); for (const x of m2) w.sb.StreamManager.ingest(echo(w, x, OWNER)); return { r: rr, cp: m2[m2.length - 1].body }; })();
      ok(B.r.ok && B.cp.era === 2 && w.sb.Floor.current().h === B.cp.h && w.sb.Floor.bindingRestart().era === 2,
        "S: and the next restore starts restart 2 — one past the restart that binds", { era: B.cp.era });
      const ex = w.sb.StreamManager.exportCheckpoint(B.cp.h);
      const snap = ex && ex.file && ex.file.payload.snapshots[ex.file.payload.snapshots.length - 1];
      const back = ex && ex.ok ? w.sb.StreamManager.importFile(ex.file) : null;
      ok(ex && ex.ok && snap && snap.era === 2 && back && back.ok === true,
        "S: a file saved from it carries the restart, and reads back — the fingerprint commits it (`ddjp_571`)", { ex: ex && ex.reason, snap: snap && snap.era, back: back && back.reason });
    }
  }
  // THE ROOM GOES ON IN THE RESTART, AND ONLY THE OWNER CHANNEL OPENS ONE: the owner's next seal carries the restore's restart and
  // stands; a seal from a lower rung CLAIMING a later restart — fingerprinted, with a cut above — binds nothing and is adopted nowhere.
  {
    const w = world({ mode: "backend1" });
    const room = F.sortLog(F.playingRoom({ songs: 2, dj: "@roomdj:hs" }).log);
    for (const e of room) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const n0 = w.sent.length, f = fileRoom(w.sb, { mode: "full" });
    await w.sb.Room.overrideFromFile(f.file); const mine = w.sent.slice(n0);
    for (const x of mine) w.sb.StreamManager.ingest(echo(w, x, OWNER));
    const AR = mine[mine.length - 1].body, AE = echo(w, mine[mine.length - 1], OWNER);
    const more = [F.reducerEvent("$m1", AR.floorL + 2, 9e6, "@dj:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGX" }),
                  F.reducerEvent("$m1b", AR.floorL + 3, 9e6 + 5, "@dj2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGY" })];
    for (const e of more) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    // the bot's seal of the OLD room, its cut between the restore's and the owner's next seal's — held, refused
    const St = { t: "ddjp.checkpoint", n: 4, prev: null, seed: w.sb.StateDeriver.buildSeed(room.concat(more.slice(0, 1)), null), floorL: AR.floorL + 2, thin: false,
      covers: room[0].eventId + "..$m1" };
    St.h = w.sb.CheckpointFormat.fingerprint(St.n, St.prev, St.seed, St.floorL, St.thin, St.covers);
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$stale-s", room_id: FULL_CH.checkpoints_owner, sender: BOT, ts: 9e6 + 6, senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, St, { l: AR.floorL + 4 })) } });
    const k = w.sent.length, sr = await w.sb.Checkpoint.seal(), mineS = w.sent.slice(k).filter((x) => x.t === "ddjp.checkpoint");
    const sc = mineS[0] && mineS[0].body;
    for (const x of mineS) w.sb.StreamManager.ingest(echo(w, x, OWNER));
    ok(sr && sr.ok && sc && sc.era === AR.era && sc.root && sc.root.id === AE.event_id && sc.prev === AR.h && w.sb.Floor.current().h === sc.h,
      "S: the owner's next seal carries the restore's restart — its era, and its root where the restore's own event sits — and stands", sc && { era: sc.era, root: sc.root, res: sr });
    const sx = sc ? w.sb.StreamManager.exportCheckpoint(sc.h) : null, sxs = (sx && sx.ok) ? sx.file.payload.snapshots.map((c) => c.h) : null;
    ok(sxs && sxs.join() === [AR.h, sc.h].join(),
      "S: a file saved from it carries the restore and that seal — never the bot's seal of the old room, though its cut sits between them",
      sxs && sxs.map((h) => h === St.h ? "the old room's seal" : h === AR.h ? "restore" : h === (sc && sc.h) ? "seal" : "?"));
    const more2 = [F.reducerEvent("$m2", AR.floorL + 9, 9e6 + 9, "@dj2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGZ" })];
    for (const e of more2) w.sb.StreamManager.ingest(Object.assign(F.toRaw(e), { room_id: FULL_CH.events_owner, senderRank: 99 }));
    const Fk = { t: "ddjp.checkpoint", n: 9, prev: sc ? sc.h : AR.h, seed: w.sb.StateDeriver.buildSeed(room.concat(more, more2), null), floorL: AR.floorL + 9, thin: false,
      covers: room[0].eventId + "..$m2", era: AR.era + 1, root: { l: AR.floorL + 8, id: "$claimed" } };
    Fk.h = w.sb.CheckpointFormat.fingerprint(Fk.n, Fk.prev, Fk.seed, Fk.floorL, Fk.thin, Fk.covers, Fk.era, Fk.root);
    w.sb.StreamManager.ingest({ type: "m.room.message", event_id: "$forged", room_id: "!c50:hs", sender: STAFF, ts: 9e6 + 10, senderRank: 50,
      content: { body: JSON.stringify(Object.assign({}, Fk, { l: AR.floorL + 10 })) } });
    ok(w.sb.CheckpointFormat.verify(Fk) && sc && w.sb.Floor.current().h === sc.h && w.sb.Floor.bindingRestart().era === AR.era,
      "S: a seal from a lower rung CLAIMING a later restart opens nothing — only the owner channel raises the restart",
      { floor: w.sb.Floor.current().h === Fk.h ? "the claimed restart" : "?", binding: w.sb.Floor.bindingRestart() });
  }
});

// ── U — THE NEW RULES, ONE AT A TIME (`ddjp_571`) ─────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const sbc = loadInContext(["core/logger.js", "backends/backend1/consensushash.js", "backends/backend1/checkpointformat.js", "backends/backend2/checkpoint.js"], {});
  const CF = sbc.CheckpointFormat, C = sbc.B2Checkpoint;
  // THE FORMAT: era 0 hashes as it always did; from era 1 the restart is committed.
  const body = { n: 3, prev: "hp", seed: { a: 1 }, floorL: 7, thin: false, covers: "$x" };
  const old = sbc.ConsensusHash.contentHash({ n: 3, prev: "hp", seed: { a: 1 }, floorL: 7, thin: false, covers: "$x" });
  ok(CF.fingerprint(body.n, body.prev, body.seed, body.floorL, body.thin, body.covers) === old &&
     CF.fingerprint(body.n, body.prev, body.seed, body.floorL, body.thin, body.covers, 0, null) === old,
    "U: a save point of restart 0 hashes EXACTLY as before restarts existed — no checkpoint in any room is re-fingerprinted");
  const cp = Object.assign({}, body, { era: 2, root: { l: 5, id: "$r" } });
  cp.h = CF.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers, cp.era, cp.root);
  ok(cp.h !== old && CF.verify(cp) === true && CF.verify(Object.assign({}, cp, { era: 3 })) === false &&
     CF.verify(Object.assign({}, cp, { root: { l: 6, id: "$r" } })) === false && CF.verify(Object.assign({}, cp, { era: undefined, root: undefined })) === false,
    "U: from restart 1 both are COMMITTED — a raised era, or another root, does not verify");
  ok(CF.verify(Object.assign({}, body, { h: old, era: 0 })) === false && CF.verify(Object.assign({}, body, { h: old, era: "1" })) === false,
    "U: and a malformed restart (`era: 0`, a string) is refused, not read as restart 0");
  // THE ORDER: restart, then n, then position.
  const s0 = C.seal({ a: 1 }, { isRunner: true, floorL: 10, covers: "$a" }).cp;
  C.observe(s0, { id: "$s0", l: 10 });
  const R = C.restore({ b: 1 }, { floorL: 10, covers: null }).cp;
  ok(R.era === 1 && R.n === 1 && !R.root, "U: a restore starts restart floor+1 with `n` 1, and names no root — it is the root", { era: R.era, n: R.n });
  const big = C.seal({ a: 2 }, { isRunner: true, floorL: 20, covers: "$b" }).cp;      // restart 0, n 2
  C.observe(R, { id: "$R", l: 15, owner: true });
  const ob = C.observe(big, { id: "$big", l: 30 });
  ok(C.floor().h === R.h && ob.adopted === false, "U: the restart decides before `n` and before position — restart 0 `n` 2, later in the log, stays under restart 1 `n` 1", ob);
  const R2nd = C.restore({ d: 1 }, { floorL: 17, covers: null }).cp;
  ok(R2nd.era === 2 && R2nd.n === 1, "U: and a restore on a restart-1 floor starts restart 2 — one past the floor's, never a fixed number", { era: R2nd.era, n: R2nd.n });
  // AT ONE RESTART AND ONE `n` — two writers sealing at once — the save point LATER IN THE LOG stands, in either order of arrival.
  {
    const ld = () => loadInContext(["core/logger.js", "backends/backend1/consensushash.js", "backends/backend1/checkpointformat.js", "backends/backend2/checkpoint.js"], {}).B2Checkpoint;
    const X1 = ld(), X2 = ld();
    const b0 = X1.seal({ a: 1 }, { isRunner: true, floorL: 10, covers: "$a" }).cp;
    X1.observe(b0, { id: "$b0", l: 10 }); X2.observe(b0, { id: "$b0", l: 10 });
    const tA = X1.seal({ t: "a" }, { isRunner: true, floorL: 12, covers: "$t" }).cp, tB = X1.seal({ t: "b" }, { isRunner: true, floorL: 12, covers: "$t" }).cp;
    const x1 = [X1.observe(tB, { id: "$tB", l: 14 }), X1.observe(tA, { id: "$tA", l: 13 })];
    const x2 = [X2.observe(tA, { id: "$tA", l: 13 }), X2.observe(tB, { id: "$tB", l: 14 })];
    ok(tA.n === tB.n && X1.floor().h === tB.h && X2.floor().h === tB.h && x1[1].adopted === false && x2[1].adopted === true,
      "U: at one restart and one `n`, the save point LATER IN THE LOG stands — whichever a device saw first", { x1: x1, x2: x2 });
  }
  const c1 = C.seal({ c: 1 }, { isRunner: true, floorL: 16, covers: "$c" }).cp;
  ok(c1.era === 1 && c1.root && c1.root.l === 15 && c1.root.id === "$R" && c1.n === 2, "U: a seal on the restore carries its restart — era, and root = the restore's own event", c1);
  const noRoot = Object.assign({}, c1, { root: undefined, n: 5 });
  noRoot.h = CF.fingerprint(noRoot.n, noRoot.prev, noRoot.seed, noRoot.floorL, noRoot.thin, noRoot.covers, noRoot.era, null);
  const onr = C.observe(noRoot, { id: "$nr", l: 40 });
  ok(onr.adopted === false && /must name its restore/.test(onr.why), "U: a save point of a restart that names no restore is refused, not read as restart 0", onr);
  // THE DOWNLOAD STOPS ONLY AT THE HIGHEST RESTART READ (owner's gap-3 ruling).
  const w = world({ mode: "backend2" });
  const C2 = w.sb.B2Checkpoint, sd = (q) => w.sb.StateDeriver.buildSeed([], null);
  const ev = (id, sender, b) => ({ type: "m.room.message", event_id: id, sender: sender, content: { body: JSON.stringify(Object.assign({ t: "ddjp.checkpoint" }, b)) } });
  const X = C2.seal(sd(), { isRunner: true, floorL: 1, covers: "$e1" }).cp;
  C2.observe(X, { id: "$X", l: 2 });
  const RR = C2.restore(sd(), { floorL: 3, covers: null }).cp;
  C2.observe(RR, { id: "$RR", l: 4, owner: true });
  const CC = C2.seal(sd(), { isRunner: true, floorL: 4, covers: "$e2" }).cp;           // the confirmation, on the restore
  const q1 = Object.assign({}, X, { n: 2, prev: X.h, floorL: 5, covers: "$e3", era: undefined, root: undefined });
  q1.h = w.sb.CheckpointFormat.fingerprint(q1.n, q1.prev, q1.seed, q1.floorL, q1.thin, q1.covers);
  const q2 = Object.assign({}, q1, { n: 3, prev: q1.h, floorL: 6, covers: "$e4" });
  q2.h = w.sb.CheckpointFormat.fingerprint(q2.n, q2.prev, q2.seed, q2.floorL, q2.thin, q2.covers);
  const page = [ev("$X", BOT, X), ev("$CC", BOT, CC), ev("$q1", BOT, q1), ev("$q2", BOT, q2)];  // oldest first; the restore not yet read
  w.sb.StreamManager.reset();
  ok(w.sb.StreamManager.replayHasEnough(BOT_CH.events_owner, page) === false,
    "U: a download that has read a save point of restart 1 does not stop at two seals of restart 0 — though one's predecessor is in hand");
  ok(w.sb.StreamManager.replayHasEnough(BOT_CH.events_owner, [ev("$RR", OWNER, RR)].concat(page)) === true,
    "U: and stops once the restart's own restore is read");
  ok(w.sb.StreamManager.replayHasEnough(BOT_CH.events_owner, [ev("$X", BOT, X), ev("$q1", BOT, q1), ev("$q2", BOT, q2)]) === true,
    "U CONTROL — with no later restart read, the same two seals stop it, as before");
  // THE RUNNER'S SEAL IN FLIGHT, BY RESTART AND COUNT.
  const K = w.sb.B2Runner._keyBelow;
  ok(K({ era: 1, n: 1 }, { era: 0, n: 7 }) === false && K({ era: 0, n: 6 }, { era: 0, n: 7 }) === true && K({ era: 1, n: 1 }, { era: 1, n: 2 }) === true,
    "U: the runner reads a restore (restart 1, `n` 1) as PAST its last seal of restart 0 (`n` 7), not as that seal still in flight");
});

(async () => {
  for (const p of PARTS) { try { await p(); } catch (e) { failed++; console.log("[bot-restore] FAIL — a part threw: " + (e && e.stack)); } }
  _finished = true;
  if (failed) { console.log("[bot-restore] FAIL — " + failed + " of " + asserts + " assertions failed"); process.exit(1); }
  console.log("[bot-restore] PASS — the room's owner restores a bot room from a save file and it is the room's new beginning (J79, " + asserts +
    " assertions). ONE EVENT: a save point in the bot's log carrying the file's state and settings, adopted by every device from who " +
    "CARRIED it — a sender above the ladder; the bot, staff, a non-creator at the top rung and body fields claiming the owner are refused. " +
    "EVERY CHECK BEFORE ANYTHING IS POSTED: not the owner, still loading (`mayAuthor`'s object, read as one), the other room type either " +
    "way, an unreadable file — nothing sent; a failed send changes nothing in either room type, the shared room's anchor being inert " +
    "until a restore names it (one predicate, `isRestoreAnchor`, for the reducer and SettingsProof). NEVER REVERTED: a seal the bot made " +
    "on the old floor is refused everywhere, however many and whatever their `n`; its next seal builds on the restore. NEVER MOVED " +
    "BACK: a restore delivered again, or an older one after a newer, changes nothing on any kind of device — by its place in the log, " +
    "never the order a device saw it in, so a seal on the old floor seen first is replaced — the RESTART decides first (`ddjp_571`): " +
    "two restores of one restart, the later wins; the bot confirms the owner's restore at once, once, never as a restore, and a " +
    "device that never read the restore moves to its restart then; a shared room keeps its restore against the bot's seal of the " +
    "old room. THE BOT OFFLINE: nothing needs it, and it reopens from " +
    "the restore. SONG HISTORY on every kind of device — held everything, received everything, trimmed, joined after, reopened with a " +
    "table stored before — is the same, starts at the file's now-playing song, equals the audit's truth, and a second open reads 0 pages " +
    "and corrects 0 rows. Save files round trip in both room types; create-from-file makes the file's room type from either lobby; the " +
    "control is the owner's alone; decent-534-497's J28 restore still adopts; this room's door is kept; the bot's settings requests wait " +
    "for live; and a re-entered room prints its own move-on line");
})();
