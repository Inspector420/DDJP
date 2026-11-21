#!/usr/bin/env node
// tests/check-history-channel.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend2/skeleton.js, backends/backend2/transport.js, features/room.js
//
// WALL: THE SONG HISTORY CHANNEL — ITS OWN CHANNEL, ITS OWN ROUTE, AND ROOMS OF ANOTHER FORMAT (`ddjp_736`, 737; the owner's
// answers 1, 2 and 10 and his words 5 in `main/01-project.md` item 7: "its modular and downstream of the machinery, no affect on room
// state, just histroy"; the design in `consensus/history-rules.md` §12). This package lays the ground only — the reader and the
// bot's summaries are 737–738 — so what is walled here is what they will stand on:
//   A  THE ROUTE, through the REAL `_routeEvent` with the REAL predicates (`tests/_probe-j15-dm.js`): a message on the history channel
//      of a room this tab is in reaches the raw listeners and NOTHING ELSE — never `EventCache.store`, never `StreamManager.ingest`
//      (the fold, the log, the seed, the floor), never the inbound clock (`updateInbound`), never the spine door; out of scope it
//      reaches nobody. CONTROLS: the same message on a channel that is neither spine, chat nor history is cached and folded (the
//      second door would take it — the branch is what stops it); a chat still moves the clock and is neither cached nor folded.
//      The predicate itself: the channel by its row's kind in the plan, nothing else.
//   B  THE CHANNEL IN BOTH ENGINES' PLANS AND CREATION: `history_owner`, kind `history`, written at the owner level (99), batch 1,
//      last of its batch, in both plans; created with the room through the REAL `createDDJPSpace` for both engines — born with its
//      mark, open to the room (`restricted`), its messages at 99 — and the room's Space carries its format (`ddjp_format`, the
//      bridge's `ROOM_FORMAT`) beside its engine. The invite world's copy of the format equals the module's.
//   C  A ROOM OF AN OLDER FORMAT IS NOT A DDJP ROOM (the owner's option 3, his answer "3", 737; `main/05-matrix.md` §Rooms you can
//      trust): not among the room list's DDJP rooms and not in "Needs attention"; counted in the closed "Other Matrix rooms (not DDJP)"
//      line — its Space and the channels marked for it, so it is left with them — with ONE log line a room however often the list is
//      drawn; opened by its ID it answers as any space that is not DDJP's (Join Room rejects it and leaves it again; its opening throws
//      "That isn't a DDJP room, so this build cannot open it." before anything is rebound); Repair refuses it (`not-ddjp`) and makes
//      nothing. A ROOM OF A NEWER FORMAT (made by a build newer than this tab; job 4 at 737) is refused at its opening — "This room was
//      made by a newer version of DDJP. Reload the page to open it." — before anything is rebound, and is in "Needs attention" at once
//      with "It was made by a newer version of DDJP. Reload the page to open it.", no Repair (the bridge refuses: `newer-room`).
//      CONTROL: a room of this format missing its history channel is a missing channel, as any — "Its song history channel is
//      missing.", Repair offered.
//      CHANGED ON PURPOSE AT 737: at 736 an older room was refused by name at its opening and listed under "Needs attention" with
//      "It was made before rooms had a song history channel, so it can't open." — the owner chose option 3 ("3") instead.
//   D  `sendSide` NAMES ITS CHANNEL, in both engines: with the history channel's key, one message there, at the owner level; a key
//      of no history row, or an account below the row's level, refused by name and nothing sent; no key, the owner channel as
//      before (backend1) or the runner's gate as before (backend2).
//   E  THE PUSH-BACK HOLD APPLIES TO IT (the supervisor's condition on Q3): while the server's `retry_after` for room events runs,
//      a keyed side message is kept, not sent, and goes after it, in order — through the transport's one hold (`_eventOut`).
// RED FIRST ON `ddjp_735`: no history row in either plan, no `_isHistoryChannel` (the second door caches and folds the message), no
// `ROOM_FORMAT` or format written, no refusal, `sendSide` ignores a key and sends on the owner channel. ON `ddjp_736` (part C as
// rewritten at 737): the older room listed in "Needs attention" and refused by its own words, never in the other rooms' line; a
// newer room opened (no refusal).
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const P = require(path.join(__dirname, "_probe-j15-dm.js"));
const W = require(path.join(__dirname, "_inviteworld.js"));
const { ORDER, deep, botRuntime } = require(path.join(__dirname, "_botroom.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-channel] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 600) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-channel] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
const SIDE = "ddjp.side.history";
const ME = W.ME;

// ── A — THE ROUTE ──────────────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const MB = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], { Logger: { info() {}, warn() {}, error() {}, debug() {} } }).MatrixBridge;
  const isHist = MB._isHistoryChannel;
  ok(typeof isHist === "function", "A APPLIED — the bridge has the history channel's predicate (`_isHistoryChannel`)", typeof isHist);
  const name = MB.channelName ? MB.channelName("history", "owner") : "history-owner";
  ok(name === "history-owner", "A PREMISE — the history channel's name, from the bridge's own naming", name);
  const body = JSON.stringify({ t: SIDE, l: 9, v: 1 });
  const route = (roomName, scoped) => P.driveRoute({ room: { roomId: "!h:hs", name: roomName }, body, scope: scoped ? ["!h:hs"] : [],
    isSpineChannel: MB._isSpineChannel, isChatChannel: MB._isChatChannel, isHistoryChannel: isHist });
  const h = route(name, true);
  ok(h.ok, "A PREMISE — `_routeEvent` was extracted and ran", h.stage);
  ok(h.ok && h.fannedOut && !h.stored && !h.folded && !h.spined && h.names.indexOf("updateInbound") < 0,
    "A: A MESSAGE ON THE HISTORY CHANNEL REACHES THE RAW LISTENERS ONLY — never the cache, the fold, the spine door or the inbound clock", h.names);
  const out = route(name, false);
  ok(out.ok && out.names.length === 0, "A: OUT OF SCOPE IT REACHES NOBODY — a history channel of a room this tab is not in", out.names);
  const other = route("notes-room", true);
  ok(other.ok && other.stored && other.folded && other.fannedOut,
    "A CONTROL — the same message on an in-scope channel that is neither spine, chat nor history is cached and folded: the second door takes it, so the history branch is what stops it", other.names);
  const chat = route("chat-guest", true);
  ok(chat.ok && chat.fannedOut && !chat.stored && !chat.folded && chat.names.indexOf("updateInbound") >= 0,
    "A CONTROL — a chat still moves the clock and is neither cached nor folded (unchanged)", chat.names);
  if (typeof isHist === "function") {
    const v = [name, "events-owner", "chat-guest", "settings-owner", "checkpoints-owner", "history-guest", ""].map((n) => isHist({ name: n }));
    ok(JSON.stringify(v) === JSON.stringify([true, false, false, false, false, false, false]) && isHist(null) === false,
      "A: THE PREDICATE IS THE PLAN'S — the channel by its row's kind (`history`), and no other name", v);
  }
});

// ── B — BOTH PLANS, AND THE CREATION ───────────────────────────────────────────────────────────────────────────────────────
function sandbox() {
  const sb = loadInContext(ORDER, {
    Date, Math, JSON, Promise, setTimeout: (fn) => { Promise.resolve().then(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    window: { addEventListener() {} }, document: { addEventListener() {}, visibilityState: "visible" }, navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Store: { history: { load: async () => null, persist() {} } }, StorageIO: deep(), IDB: deep(), ChatPrefs: deep(), Queue: deep(), Skip: deep(),
    Playback: deep(), Chat: deep(), Reactions: deep(), MediaLength: deep(), MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(),
    RoomUpgrade: deep(), BotRuntime: botRuntime(), Interface: deep(),
  });
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = () => {};
  const tb = sb.B1MatrixBridge || sb.MatrixBridge;
  if (tb && typeof tb._setAnswerClockForTest === "function") tb._setAnswerClockForTest(() => 0, () => {});
  return sb;
}
// A client that records every room asked for and answers for it as a homeserver would hold it (as `check-channel-mark`'s).
function recorder() {
  const made = [], rooms = Object.create(null);
  let n = 0;
  const view = (id) => {
    const r = rooms[id];
    return { roomId: id, name: r.name, getMyMembership: () => "join", currentState: { getStateEvents: (t, k) => {
      const one = k !== undefined;
      if (t === "m.room.create") {
        const c = { getContent: () => Object.assign({ room_version: r.opts.room_version }, r.opts.creation_content || {}), getSender: () => W.OWNER, getStateKey: () => "" };
        return one ? (k === "" ? c : null) : [c];
      }
      if (t === "m.room.power_levels") { const p = { getContent: () => ({ users: {}, users_default: 0 }) }; return one ? p : [p]; }
      return one ? null : [];
    } } };
  };
  const client = {
    getUserId: () => W.OWNER, getRoom: (id) => (rooms[id] ? view(id) : null), getRooms: () => Object.keys(rooms).map(view),
    createRoom: async (opts) => { const id = "!r" + (++n) + ":hs"; rooms[id] = { opts, name: opts.name }; made.push({ id, opts }); return { room_id: id }; },
    sendStateEvent: async () => ({}), invite: async () => {}, kick: async () => {},
  };
  return { client, made };
}
const stateOf = (opts, type) => ((opts.initial_state || []).find((s) => s.type === type) || {}).content || null;
part("B", async () => {
  for (const mode of ["backend1", "backend2"]) {
    const sb = sandbox();
    const plan = sb.Backends.planFor(mode) || [];
    const b1 = plan.filter((r) => (r.batch || 1) === 1);
    const row = plan.find((r) => r.key === "history_owner") || null;
    ok(row && row.kind === "history" && row.slug === "owner" && row.level === 99 && row.batch === 1,
      "B (" + mode + "): THE PLAN HAS THE SONG HISTORY CHANNEL — `history_owner`, kind history, written at the owner level (99), batch 1", row);
    ok(row && b1[b1.length - 1] === row && plan.filter((r) => r.kind === "history").length === 1,
      "B (" + mode + "): ONE, AND LAST OF ITS BATCH — the rooms' creation order is unchanged before it", b1.map((r) => r.key));
    const rec = recorder();
    sb.Backends.bind(mode);
    sb.MatrixBridge._setClientForTest(rec.client);
    let res = null, err = null;
    try { res = await sb.MatrixBridge.createDDJPSpace("Test room", null, mode); } catch (e) { err = e.message; }
    ok(!err && res && res.spaceId, "B PREMISE (" + mode + ") — a room was created through the real flow", err);
    if (!res) continue;
    const space = rec.made.find((m) => m.id === res.spaceId);
    const hist = rec.made.find((m) => m.id !== res.spaceId && (m.opts.creation_content || {}).ddjp_kind === "history_owner");
    const pl = hist ? stateOf(hist.opts, "m.room.power_levels") : null, jr = hist ? stateOf(hist.opts, "m.room.join_rules") : null;
    ok(hist && (hist.opts.creation_content || {}).ddjp_room === res.spaceId && hist.opts.name === "history-owner" && res.channels && res.channels.history_owner === hist.id,
      "B (" + mode + "): CREATED WITH THE ROOM — born with its mark, named `history-owner`, in the room's channel map", hist && { name: hist.opts.name, cc: hist.opts.creation_content });
    ok(pl && pl.events && pl.events["m.room.message"] === 99 && jr && jr.join_rule === "restricted",
      "B (" + mode + "): READ BY ALL IN THE ROOM, WRITTEN AT THE OWNER LEVEL — `restricted` to the room, its messages at 99", { pl: pl && pl.events, jr });
    ok(space && (space.opts.creation_content || {}).ddjp_format === sb.MatrixBridge.ROOM_FORMAT && sb.MatrixBridge.ROOM_FORMAT === 2 &&
       (space.opts.creation_content || {}).ddjp_mode === mode,
      "B (" + mode + "): THE ROOM CARRIES ITS FORMAT — `ddjp_format: " + sb.MatrixBridge.ROOM_FORMAT + "` beside `ddjp_mode`, on its Space's creation record", space && space.opts.creation_content);
  }
  const MB = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], { Logger: { info() {}, warn() {}, error() {}, debug() {} } }).MatrixBridge;
  ok(W.ROOM_FORMAT === MB.ROOM_FORMAT, "B: THE INVITE WORLD BUILDS ROOMS OF THIS FORMAT — its copy equals the module's (`ROOM_FORMAT`)", [W.ROOM_FORMAT, MB.ROOM_FORMAT]);
});

// ── C — A ROOM MADE BEFORE IT ──────────────────────────────────────────────────────────────────────────────────────────────
function account() {
  const hs = W.homeserver();
  const store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {}, loadPendingCreate: () => null, saveLeaving() {}, loadLeaving: () => [] } };
  let made = 0;
  const creates = [];
  const extra = {
    getSyncState: () => "SYNCING",   // the room list's other rooms are told once the client has synced (737: part C reads them)
    createRoom: async (opts) => { creates.push(opts); const id = "!made" + (++made) + ":hs"; hs.room(id, { name: opts.name, creator: ME, content: opts.creation_content || {}, members: { [ME]: "join" } }); return { room_id: id }; },
    sendStateEvent: async (rid, type, content, key) => { if (type === "m.space.child" && hs.rooms[rid].children.indexOf(key) < 0) hs.rooms[rid].children.push(key); return {}; },
  };
  const w = W.inviteWorld({ hs, client: extra, extras: { Store: store } });
  const room = (sid, mode, keys, format) => {
    const R = hs.ddjpRoom(sid, { mode, keys, creator: ME, name: "Room " + sid.slice(1, 3), format });
    for (const id of [sid].concat(Object.values(R.ch))) { hs.rooms[id].power = { users: { [ME]: 100 }, users_default: 0 }; hs.rooms[id].members[ME] = "join"; }
    return R;
  };
  return { hs, w, room, creates };
}
const byId = (list, sid) => (list || []).find((a) => a.spaceId === sid) || null;
part("C", async () => {
  const x = account();
  const plan1 = x.w.sb.Backends.planFor("backend1") || [], plan2 = x.w.sb.Backends.planFor("backend2") || [];
  const k1 = plan1.filter((r) => r.batch === 1 && r.key !== "history_owner").map((r) => r.key);
  const k2 = plan2.map((r) => r.key).filter((k) => k !== "history_owner");
  const O1 = x.room("!o1:hs", "backend1", k1, null);   // a shared room of the first format: no `ddjp_format`, no history channel
  const O2 = x.room("!o2:hs", "backend2", k2, null);   // a bot room of the first format
  x.room("!nh:hs", "backend2", k2);                    // a bot room of THIS format, missing its history channel
  x.room("!nw:hs", "backend2", plan2.map((r) => r.key), 3);   // a bot room of a NEWER format (a build newer than this tab made it)
  // an older room this account is not in yet, open to join: for Join Room by its ID
  x.hs.ddjpRoom("!o3:hs", { mode: "backend2", keys: k2, creator: W.OWNER, name: "Room o3", format: null });
  x.hs.rooms["!o3:hs"].joinRule = "public";
  const NEWER = "It was made by a newer version of DDJP. Reload the page to open it.";
  const NEWER_OPEN = /^This room was made by a newer version of DDJP\. Reload the page to open it\.$/;
  const NOT_DDJP_OPEN = /^That isn't a DDJP room, so this build cannot open it\.$/;
  ok(typeof x.w.MB.roomFormatOf === "function" && x.w.MB.roomFormatOf("!o1:hs") === 1 && x.w.MB.roomFormatOf("!nh:hs") === 2 && x.w.MB.roomFormatOf("!nw:hs") === 3,
    "C APPLIED — the bridge reads a room's format (`roomFormatOf`): none written reads as 1, this build's as 2, a newer one as written",
    typeof x.w.MB.roomFormatOf === "function" ? [x.w.MB.roomFormatOf("!o1:hs"), x.w.MB.roomFormatOf("!nh:hs"), x.w.MB.roomFormatOf("!nw:hs")] : "absent");
  // ── OPTION 3: an older room is not a DDJP room ──
  const scan = x.w.Room.scanDDJPRooms();
  const listed = [].concat(scan.owned || [], scan.joined || []).map((r) => r.spaceId);
  ok(listed.indexOf("!o1:hs") < 0 && listed.indexOf("!o2:hs") < 0 && listed.indexOf("!nh:hs") >= 0 && listed.indexOf("!nw:hs") >= 0,
    "C: AN OLDER ROOM IS NOT A DDJP ROOM — not among the room list's rooms (this format's and a newer one's are)", listed);
  const at0 = x.w.Room.needsAttention(scan);
  ok(!byId(at0, "!o1:hs") && !byId(at0, "!o2:hs"), "C: NOT IN \"NEEDS ATTENTION\" — no row, no words, no Repair", at0.map((a) => a.spaceId));
  const l0 = x.w.lines(/is from an older version of DDJP/).length;
  const oth = x.w.Room.otherRooms();
  x.w.Room.otherRooms(); x.w.Room.otherRooms();
  const ids = oth ? oth.rooms.map((r) => r.roomId) : [];
  const want = ["!o1:hs", "!o2:hs"].concat(Object.values(O1.ch), Object.values(O2.ch));
  ok(oth && want.every((id) => ids.indexOf(id) >= 0) && oth.count === ids.length,
    "C: COUNTED IN THE CLOSED \"OTHER MATRIX ROOMS (NOT DDJP)\" LINE — its Space and every channel marked for it", { missing: want.filter((id) => ids.indexOf(id) < 0), count: oth && oth.count });
  const s1 = oth && oth.rooms.find((r) => r.roomId === "!o1:hs");
  ok(s1 && s1.space === true && s1.inside === Object.keys(O1.ch).length, "C: AS A SPACE WITH ITS ROOMS INSIDE — so its Leave leaves them with it", s1);
  ok(!ids.some((id) => ["!nh:hs", "!nw:hs"].indexOf(id) >= 0), "C CONTROL — a room of this format, and a newer one, are not in that line", ids.filter((id) => /!n[hw]/.test(id)));
  const said = x.w.lines(/is from an older version of DDJP/).slice(l0);
  ok(said.length === 2 && said.some((m) => /^info: Room: Room o1 \(!o1:hs\) is from an older version of DDJP \(format 1; this build opens format 2\) — counted with the other Matrix rooms \(not DDJP\)$/.test(m)),
    "C: ONE LOG LINE A ROOM, for the developer, however often the list is drawn (three times here)", said);
  // opened by its ID: as any space that is not DDJP's
  for (const sid of ["!o1:hs", "!o2:hs"]) {
    const before = x.w.sb.Backends.active();
    let threw = null;
    try { await x.w.Room.join(sid); } catch (e) { threw = (e && e.message) || String(e); }
    ok(threw && NOT_DDJP_OPEN.test(threw), "C: ITS OPENING ANSWERS AS FOR ANY SPACE THAT IS NOT DDJP'S — \"That isn't a DDJP room, so this build cannot open it.\" (" + sid + ")", threw);
    ok(x.w.sb.Backends.active() === before, "C: BEFORE ANYTHING IS REBOUND — the engine bound before the opening is still bound (" + sid + ")", [before, x.w.sb.Backends.active()]);
  }
  const rj = await x.w.Room.joinById("!o3:hs");
  ok(rj && rj.ok === false && rj.reason === "not-ddjp" && x.hs.rooms["!o3:hs"].members[ME] === "leave",
    "C: JOIN ROOM BY ITS ID REJECTS IT — \"That isn't a DDJP room.\" — and leaves it again, as any such space", { rj, ms: x.hs.rooms["!o3:hs"].members[ME] });
  // Repair makes nothing
  const n0 = x.creates.length;
  const rep = await x.w.Room.repairRoom("!o1:hs");
  const rb = await x.w.MB.repairRoomChannels("!o1:hs", {});
  ok(rep && rep.ok === false && rb && rb.ok === false && rb.reason === "not-ddjp" && x.creates.length === n0,
    "C: REPAIR MAKES NOTHING FOR IT — the bridge refuses (`not-ddjp`) and no channel is created", { rep, rb, made: x.creates.length - n0 });
  ok(x.w.MB.roomAttention("!o1:hs") === null, "C: and the bridge reads nothing of it (`roomAttention` null)", x.w.MB.roomAttention("!o1:hs"));
  // ── A NEWER ROOM: reload the page ──
  const nw = byId(at0, "!nw:hs");
  ok(nw && nw.kind === "refused" && nw.words === NEWER && nw.repair === null, "C: A NEWER ROOM IS IN \"NEEDS ATTENTION\" AT ONCE — \"" + NEWER + "\", no Repair (never opened)", nw);
  const beforeN = x.w.sb.Backends.active();
  let threwN = null;
  try { await x.w.Room.join("!nw:hs"); } catch (e) { threwN = (e && e.message) || String(e); }
  ok(threwN && NEWER_OPEN.test(threwN), "C: ITS OPENING IS REFUSED — \"This room was made by a newer version of DDJP. Reload the page to open it.\"", threwN);
  ok(x.w.sb.Backends.active() === beforeN, "C: before anything is rebound", [beforeN, x.w.sb.Backends.active()]);
  const roN = x.w.Room.refusedOpening("!nw:hs");
  ok(roN && roN.words === NEWER, "C: and the refusal says the same words on the list", roN);
  const n1 = x.creates.length;
  const rbN = await x.w.MB.repairRoomChannels("!nw:hs", {});
  const raN = x.w.MB.roomAttention("!nw:hs");
  ok(rbN && rbN.ok === false && rbN.reason === "newer-room" && x.creates.length === n1 && raN && raN.newer === true && raN.missing.length === 0,
    "C: REPAIR MAKES NOTHING FOR IT (`newer-room`); the bridge reads it as newer, nothing called missing", { rbN, raN });
  // ── CONTROL ──
  const nh = byId(at0, "!nh:hs");
  ok(nh && nh.kind === "missing" && nh.words === "Its song history channel is missing." && nh.repair === "yes",
    "C CONTROL — a room of this format missing its history channel is a missing channel as any: \"Its song history channel is missing.\", Repair", nh);
});

// ── D AND E — `sendSide` WITH A KEY, AND THE HOLD ──────────────────────────────────────────────────────────────────────────
function sideWorld(mode, myLevel) {
  const hs = W.homeserver();
  const sent = [];
  let fail = [];
  const client = {
    sendMessage: async (roomId, content) => {
      sent.push({ roomId, body: content.body });
      if (fail.length) { const e = fail.shift(); throw Object.assign(new Error("Too Many Requests"), e); }
      return { event_id: "$s" + sent.length };
    },
  };
  const w = W.inviteWorld({ hs, client });
  const R = hs.ddjpRoom("!s:hs", { mode, creator: W.OWNER, keys: (w.sb.Backends.planFor(mode) || []).map((r) => r.key) });
  for (const id of ["!s:hs"].concat(Object.values(R.ch))) { hs.rooms[id].members[ME] = "join"; hs.rooms[id].power = { users: { [ME]: myLevel }, users_default: 0 }; }
  w.sb.Backends.bind(mode);
  return { w, hs, R, sent, setFail: (f) => { fail = f; }, T: w.sb.B1MatrixBridge, E: mode === "backend2" ? w.sb.B2MatrixBridge : w.sb.B1MatrixBridge };
}
const bodyOf = (s) => { try { return JSON.parse(s.body); } catch (e) { return null; } };
part("D", async () => {
  for (const mode of ["backend1", "backend2"]) {
    const x = sideWorld(mode, 99);
    const ch = x.R.ch;
    ok(!!ch.history_owner, "D PREMISE (" + mode + ") — the room has its history channel", Object.keys(ch));
    const r = await x.E.sendSide(ch, SIDE, { v: 1, rows: [] }, "history_owner");
    const b = x.sent[0] ? bodyOf(x.sent[0]) : null;
    ok(r && r.ok === true && x.sent.length === 1 && x.sent[0].roomId === ch.history_owner && b && b.t === SIDE && b.v === 1,
      "D (" + mode + "): WITH THE HISTORY CHANNEL'S KEY, ONE MESSAGE THERE — at the owner level, its body under its type", { r, sent: x.sent.map((s) => s.roomId) });
    ok(r && typeof r.eventId === "string" && r.eventId === "$s1", "D (" + mode + "): and the answer carries the event id the homeserver gave it", r);
    const n1 = x.sent.length;
    const wrong = await x.E.sendSide(ch, SIDE, { v: 1 }, "events_uncategorized");
    const none = await x.E.sendSide(ch, SIDE, { v: 1 }, "nowhere_at_all");
    ok(wrong && wrong.ok === false && /not a channel a side message goes on \(events_uncategorized\)/.test(wrong.reason || "") &&
       none && none.ok === false && /not a channel a side message goes on/.test(none.reason || "") && x.sent.length === n1,
      "D (" + mode + "): A KEY OF NO HISTORY ROW IS REFUSED BY NAME — and nothing is sent", { wrong, none });
    const bad = await x.E.sendSide(ch, "ddjp.dj.vote", { p: "$x" }, "history_owner");
    ok(bad && bad.ok === false && /side type/.test(bad.reason || "") && x.sent.length === n1, "D (" + mode + "): the side-message refusals still come first (a non-side type)", bad);
    const y = sideWorld(mode, 60);
    const low = await y.E.sendSide(y.R.ch, SIDE, { v: 1 }, "history_owner");
    ok(low && low.ok === false && /cannot write the history_owner channel/.test(low.reason || "") && y.sent.length === 0,
      "D (" + mode + "): AN ACCOUNT BELOW THE ROW'S LEVEL (60 < 99) IS REFUSED — nothing sent", low);
    // No key: as before — the owner channel (backend1); the runner's gate (backend2), which no runner here runs.
    const z = sideWorld(mode, 99);
    const plain = await z.E.sendSide(z.R.ch, SIDE, { v: 1 });
    if (mode === "backend1") ok(plain && plain.ok === true && z.sent.length === 1 && z.sent[0].roomId === z.R.ch.events_owner,
      "D CONTROL (backend1): NO KEY — the owner-level channel, as before", { plain, sent: z.sent.map((s) => s.roomId) });
    else ok(plain && plain.ok === false && /no runner is running/.test(plain.reason || "") && z.sent.length === 0,
      "D CONTROL (backend2): NO KEY — the runner's gate, as before (no runner here, so it is refused and nothing is sent)", plain);
  }
});
part("E", async () => {
  for (const mode of ["backend1", "backend2"]) {
    const x = sideWorld(mode, 99);
    if (typeof x.T._setPaceSleepForTest !== "function") { ok(false, "E APPLIED — the transport's hold has its sleep seam"); return; }
    let release = null;
    x.T._setPaceSleepForTest(() => new Promise((r) => { release = r; }));
    // A room event pushed back: the server's `retry_after` for room events starts.
    x.setFail([{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429, data: { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 3000 } }]);
    const first = x.T.sendMessage(x.R.ch.chat_uncategorized, "hello");
    first.catch(() => {});
    await turns(6);
    ok(x.sent.length === 1 && typeof release === "function", "E PREMISE (" + mode + ") — a message was pushed back and its retry waits", x.sent.map((s) => s.roomId));
    const side = x.E.sendSide(x.R.ch, SIDE, { v: 1 }, "history_owner");
    side.catch(() => {});
    await turns(6);
    ok(x.sent.length === 1, "E (" + mode + "): WHILE THE SERVER'S retry_after RUNS, A KEYED SIDE MESSAGE IS KEPT — not sent", x.sent.map((s) => s.roomId));
    x.T._setPaceSleepForTest(() => Promise.resolve());
    if (release) release();
    const done = await Promise.all([first, side]).then((v) => v, (e) => "threw: " + e.message);
    await turns(6);
    ok(Array.isArray(done) && done[1] && done[1].ok === true && x.sent.length === 3 && x.sent[1].roomId === x.R.ch.chat_uncategorized && x.sent[2].roomId === x.R.ch.history_owner,
      "E (" + mode + "): THEN SENT, IN ORDER — the pushed-back message again, then the side message on the history channel; nothing dropped", { done, sent: x.sent.map((s) => s.roomId) });
  }
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { ok(false, name + ": threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[history-channel] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-channel] PASS — the song history channel (`ddjp_736`, `consensus/history-rules.md` §12; " + asserts + " assertions): " +
    "a message on it reaches the raw listeners only — never the cache, the fold, the spine door or the inbound clock — and out of scope " +
    "nobody (through the real `_routeEvent`, the real predicates; controls: the second door would cache and fold it, a chat unchanged); " +
    "`history_owner` at 99, batch 1, last, in both plans, created with the room by the real flow in both engines, open to the room, its " +
    "messages at 99, the Space carrying `ddjp_format` " + "beside its engine; a room of an older format not a DDJP room (option 3): " +
    "counted in the other Matrix rooms' line with its channels, one log line, opened by its ID as any space not DDJP's, Repair making " +
    "nothing; a newer one refused at its opening and on the list with words to reload, no Repair (control: this format missing " +
    "the channel is a missing channel, Repair offered); `sendSide` naming the history channel in both engines, a key of no history row " +
    "or a level below the row's refused by name; and the push-back hold keeping a keyed side message until the server's retry_after ends, " +
    "then sending it in order.");
})();
