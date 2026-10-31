#!/usr/bin/env node
// tests/check-late-chat.js
// SUBJECT: features/room.js, backends/backend1/matrixbridge.js, ui/shell.js, ui/chat.js, ui/screens.js
// WALL: A NEW MEMBER'S FIRST OPEN OF A FRESH ROOM GETS ITS CHAT WITHOUT A RELOAD (`ddjp_621`; found in the owner's check 8).
//
// The owner's log: a rank-0 member accepted the invite to a fresh shared room and opened it. The opening's wait for the
// channels ran out (`waitForSpaceChildren timed out`), so the room was wired with `chat=none`; the join step's line came a
// minute later, and the chat channel it joined was dropped — `Room: joined …, which is not a channel of the room running
// here (its mark names another room, or none) — not mapped`. Every Enter then logged `Chat: no chat room` and showed nothing.
// A reload fixed it. Two causes, each fixed:
//   · `joinRoom` returns before the channel's state has synced, so its MARK was not readable when the join was announced,
//     and nothing asked again. The bridge now holds such a join and announces it again once the mark is readable.
//   · A room wired with no chat stayed without one: a chat mapped later only re-pointed the tiers, and `Chat.init` — the
//     subscription to the room's messages — ran only at entry. The room now wires its chat when one is mapped.
// Driven through the real opening (`Room.join`) in the invite world (`tests/_inviteworld.js`: the real modules both engines run,
// a model homeserver), the chat channel's join held past the opening's wait and its state held back past the join.
//   PART A — a fresh SHARED room: after the opening, `chat=none` (the premise); the join lands with the mark unreadable and
//            the chat is not mapped yet; the mark arrives, and the chat is mapped, wired — a message reaches chat's listeners
//            and a send is not refused for want of a room — and the UI's hook hears it.
//   PART B — the same first open in a BOT room.
//            The opening's join-step line also says how long the slow join took.
//   PART D — the same, the mark arriving as the room itself (the SDK's "Room" event, `_onRoomForTest`) with no state event.
//   PART E — a staff member's first open of a bot room: the staff chat, mapped at the opening, is still read after the late
//            wiring — `Chat.init` replaces the readable set, so it must run before the tiers are applied (`ddjp_622`).
//   PART C — Enter with no chat yet says so on screen and keeps the message (the real `sendChat`, extracted from ui/shell.js);
//            the note goes once the chat is there (the real `syncChatTier`).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const W = require(path.join(__dirname, "_inviteworld.js"));
const ROOT = path.join(__dirname, "..");
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[late-chat] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[late-chat] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

// The opening's wait is bounded by the clock (8 s of polls). A clock that moves a second per reading lets it run out in a few
// polls rather than eight real seconds; nothing else in these rows reads a duration.
let _t = 1.7e12;
class FastDate extends Date { static now() { _t += 1000; return _t; } }

const SHARED_KEYS = ["events_uncategorized", "events_owner", "checkpoints_uncategorized", "checkpoints_owner", "chat_uncategorized", "settings_owner"];

async function firstOpen(mode, via, o) {
  o = o || {};
  const hs = W.homeserver();
  const sid = "!fresh-" + mode + ":hs";
  // `o.staff`: this account is staff (60) and invited to the staff chat, which its join step takes at once (PART E).
  const lv = { [ME]: o.staff ? 60 : 0 };
  const A = hs.ddjpRoom(sid, mode === "backend1" ? { mode, keys: SHARED_KEYS, levels: lv } : { mode, levels: lv });
  hs.invite(sid, ME, { from: OWNER });
  if (o.staff) hs.invite(A.ch.chat_staff, ME, { from: OWNER });
  const w = W.inviteWorld({ hs, withChat: true, extras: { Date: FastDate } });
  const chat = A.ch.chat_uncategorized;
  // THE RAW FAN-OUT, RECORDED: every subscription still reaches the real one (both engines subscribe through backend1's).
  const fan = [];
  const on0 = w.sb.B1MatrixBridge.onRawEvent, off0 = w.sb.B1MatrixBridge.offRawEvent;
  w.sb.B1MatrixBridge.onRawEvent = (fn) => { if (typeof fn === "function" && fan.indexOf(fn) < 0) fan.push(fn); return on0(fn); };
  w.sb.B1MatrixBridge.offRawEvent = (fn) => { const i = fan.indexOf(fn); if (i >= 0) fan.splice(i, 1); return off0(fn); };
  // THE CHAT CHANNEL'S JOIN, HELD past the opening's wait — the owner's minute — and landing before its state has synced.
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const join0 = w.client.joinRoom;
  w.client.joinRoom = async (id) => { if (id === chat) { await gate; hs.rooms[chat].unsynced = true; } return join0(id); };
  const tiersHeard = [];
  if (typeof w.Room.onChatTiersChanged === "function") w.Room.onChatTiersChanged(() => tiersHeard.push(1));
  await w.Room.acceptInvite(sid);
  await w.settle(10);
  const l0 = w.logs.length;
  await w.Room.join(sid);
  await w.settle(20);
  const at = (re) => w.lines(re, l0);
  const r = { w, hs, sid, chat, fan, tiersHeard, at, l0 };
  r.premise = { timedOut: at(/waitForSpaceChildren timed out/).length > 0, noChat: at(/Room: no chat channel available — chat not wired/).length > 0,
    wiredNone: at(/Room: modules wired .* chat=none/).length > 0, mapped: ((w.Room.getCurrent() || {}).channels || {}).chat_uncategorized || null,
    staffMapped: ((w.Room.getCurrent() || {}).channels || {}).chat_staff || null };
  // The join lands; the state has not synced.
  release();
  await w.settle(20);
  r.afterJoin = { joined: hs.rooms[chat].members[ME], mapped: ((w.Room.getCurrent() || {}).channels || {}).chat_uncategorized || null,
    lines: at(/Room: joined|mark/).slice(-3) };
  r.joinLine = at(/MatrixBridge: join step for .*\(opening\)/)[0] || "";
  // The sync delivers the room's state, its creation record (the mark) first.
  hs.rooms[chat].unsynced = false;
  // Either way the SDK can say it: the creation record as a state event, or — `via: "room"` — the room itself, once the
  // sync has built it with its state (the SDK's "Room" event), with no state event heard for it.
  if (via === "room") { if (typeof w.sb.MatrixBridge._onRoomForTest === "function") w.sb.MatrixBridge._onRoomForTest(w.client.getRoom(chat)); }   // what the bridge's "Room" listener is handed
  else w.state(chat, "m.room.create", "", hs.rooms[chat].create.content, OWNER);
  await w.settle(20);
  r.mappedAfter = ((w.Room.getCurrent() || {}).channels || {}).chat_uncategorized || null;
  // A message in the room's chat, through the bridge's raw fan-out as `_routeEvent` hands it over.
  const got = [];
  w.Chat.onMessage((m) => got.push(m));
  const raw = { type: "m.room.message", event_id: "$hello", room_id: chat, sender: OWNER, origin_server_ts: 5000, ts: 5000,
    content: { msgtype: "m.text", body: "hello, new member" }, unsigned: {} };
  for (const fn of fan.slice()) { try { fn(raw, null, w.client.getRoom(chat)); } catch (e) {} }
  await w.settle(4);
  r.received = got.length;
  // THE TIER THAT WAS ALREADY THERE (PART E): after the late wiring, the staff chat is still read — in Chat's readable set,
  // and a message on it reaches chat's listeners.
  if (o.staff) {
    r.staff = A.ch.chat_staff;
    r.readable = (w.Chat.readableTiers ? w.Chat.readableTiers() : []).slice();
    const before = got.length;
    const rawS = { type: "m.room.message", event_id: "$staff", room_id: r.staff, sender: OWNER, origin_server_ts: 5001, ts: 5001,
      content: { msgtype: "m.text", body: "staff only" }, unsigned: {} };
    for (const fn of fan.slice()) { try { fn(rawS, null, w.client.getRoom(r.staff)); } catch (e) {} }
    await w.settle(4);
    r.staffReceived = got.length - before;
  }
  const n0 = w.logs.length;
  let sent = null;
  try { sent = await w.Chat.send("hi"); } catch (e) { sent = { ok: false, reason: "threw: " + e.message }; }
  r.sent = sent;
  r.noRoomLines = w.lines(/Chat: no chat room/, n0).length;
  return r;
}

(async () => {
  for (const [part, mode] of [["A", "backend1"], ["B", "backend2"]]) {
    const r = await firstOpen(mode);
    const kind = mode === "backend1" ? "a fresh shared room" : "a fresh bot room";
    ok(r.premise.timedOut && r.premise.noChat && r.premise.wiredNone && !r.premise.mapped,
      part + " PREMISE — in " + kind + ", the chat's join outlasted the opening's wait, so the room was wired with chat=none, as in " +
      "the owner's log", r.premise);
    ok(r.afterJoin.joined === "join" && !r.afterJoin.mapped, part + " PREMISE — the join landed before the channel's state had " +
      "synced, so its mark could not be read and it was not mapped yet", r.afterJoin);
    ok(new RegExp(r.chat.slice(0, 10).replace(/[!-]/g, "\\$&") + "… joined in \\d+ s").test(r.joinLine),
      part + ": the opening's join-step line says how long the slow join took — the owner's line came 66 s on and could not say " +
      "which join was slow", r.joinLine);
    ok(r.mappedAfter === r.chat, part + ": once its mark is readable, the chat channel joined after the opening is mapped — it " +
      "was dropped for good", { mapped: r.mappedAfter, chat: r.chat, lines: r.at(/Room: |MatrixBridge: .*mark/).slice(-4) });
    ok(r.at(/Room: chat wired — chat_uncategorized was joined after the room opened/).length === 1,
      part + ": and the room wires its chat then, and says so — a room wired with no chat stayed without one",
      r.at(/Room: (chat|joined)|chat=/));
    ok(r.received === 1, part + ": a message in the room's chat reaches chat's listeners — nothing was subscribed to them", r.received);
    ok(r.noRoomLines === 0 && !(r.sent && r.sent.reason === "no-room"), part + ": and a send is not refused for want of a chat room",
      { sent: r.sent, noRoom: r.noRoomLines });
    ok(r.tiersHeard.length >= 1, part + ": and the room tells the UI the chat tiers changed (`Room.onChatTiersChanged`), so the panel " +
      "re-resolves without a reload", r.tiersHeard.length);
    try { r.w.Room.leave("the guard is done"); } catch (e) {}
  }

  // ═══ PART D — the mark arriving as the room itself (the SDK's "Room" event), with no state event heard for it ═══
  {
    const r = await firstOpen("backend1", "room");
    ok(r.premise.wiredNone && !r.afterJoin.mapped, "D PREMISE — the same first open: wired with chat=none, the chat joined before its state synced",
      { premise: r.premise, afterJoin: r.afterJoin });
    ok(r.mappedAfter === r.chat && r.at(/Room: chat wired — chat_uncategorized was joined after the room opened/).length === 1 && r.received === 1,
      "D: when the sync hands over the room with its state and no state event is heard for it, the chat is mapped and wired all the same",
      { mapped: r.mappedAfter, received: r.received, lines: r.at(/Room: |MatrixBridge: .*mark/).slice(-4) });
    try { r.w.Room.leave("the guard is done"); } catch (e) {}
    // THE WIRING, READ (this world hands the bridge its events through the seams; the live client's subscriptions are made in
    // `start()`, which no world here runs): the SDK's two ways of delivering a mark both reach the bridge.
    const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    ok(/\n    client\.on\("Room", _onRoomArrived\);/.test(mb) && /\n    client\.on\("RoomState\.events", _onStateEvent\);/.test(mb),
      "D: and the live client subscribes both — the room arriving (`_onRoomArrived`) and its state events (`_onStateEvent`)");
  }

  // ═══ PART E — a chat tier that was already mapped stays read after the late wiring (the ddjp_621 audit's carry-over) ═══
  // `Chat.init` REPLACES Chat's readable set with its one channel, and `applyChatTiers` sets the whole list. So the late
  // wiring must run `Chat.init` FIRST: the other way round, a tier mapped at the opening — the staff chat, for a staff
  // member — would be dropped from the set, and its messages ignored, until the next settings change. The audit planted that
  // swap and every row above stayed green. A staff member in a fresh bot room: the staff chat is joined in time and mapped
  // at the opening, the uncategorized chat is the late one.
  {
    const r = await firstOpen("backend2", null, { staff: true });
    ok(r.premise.wiredNone && r.premise.staffMapped === r.staff && r.mappedAfter === r.chat
        && r.at(/Room: chat wired — chat_uncategorized was joined after the room opened/).length === 1,
      "E PREMISE — a staff member's first open: the staff chat mapped at the opening with no chat wired (chat=none), then the " +
      "uncategorized chat joined late and wired", { premise: r.premise, mapped: r.mappedAfter, wired: r.at(/Room: chat wired|chat=/) });
    ok(r.readable.indexOf(r.staff) >= 0 && r.readable.indexOf(r.chat) >= 0 && r.staffReceived === 1,
      "E: after the late wiring the staff chat is still in Chat's readable set, beside the late one, and a message on it " +
      "reaches chat's listeners — the wiring ran before the tiers were applied, not after", { readable: r.readable, staff: r.staff,
      staffReceived: r.staffReceived });
    try { r.w.Room.leave("the guard is done"); } catch (e) {}
  }

  // ═══ PART C — Enter with no chat yet says so on screen ═══════════════════════════════════════════
  {
    const shell = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
    const a = shell.indexOf("    const sendChat = async () => {"), b = shell.indexOf("\n    };", a);
    ok(a >= 0 && b > a, "C PREMISE — the real `sendChat` was found in ui/shell.js");
    const notes = [];
    const refs = { chatInput: { value: "hello" } };
    const ctx = { refs, console, Chat: { cryptoReady: () => true, send: async () => ({ ok: false, reason: "no-room" }) },
      ChatPanels: { _setChatNote: (t) => notes.push(t), _noteChatConnecting: () => notes.push("(connecting)") },
      _showCryptoBanner: () => notes.push("(crypto banner)") };
    vm.createContext(ctx);
    vm.runInContext(shell.slice(a, b + 7).replace("const sendChat =", "globalThis.__send =") + "\n", ctx);
    await ctx.__send();
    // THE PANEL IS TOLD (read: the main screen's one-time wiring) — the tiers-changed signal re-resolves the chat panel.
    const scr = fs.readFileSync(path.join(ROOT, "ui/screens.js"), "utf8");
    ok(/Room\.onChatTiersChanged\(\(\) => ChatPanels\.syncChatTier\(\)\)/.test(scr),
      "C: the main screen re-resolves the chat panel when the room's chat tiers change (`Room.onChatTiersChanged` → `syncChatTier`)");
    ok(refs.chatInput.value === "hello", "C: Enter with no chat yet keeps the message in the box", refs.chatInput.value);
    ok(notes.indexOf("(connecting)") >= 0, "C: and says on screen that the chat is still connecting — it did nothing", notes);
    // The note itself, and its going once the chat is there: the real `_noteChatConnecting` and `syncChatTier`.
    const X = require(path.join(__dirname, "_probe-j14-card.js")).extractNamed;
    const src = fs.readFileSync(path.join(ROOT, "ui/chat.js"), "utf8");
    const decl = (src.match(/const CHAT_CONNECTING_NOTE = [^\n]+;/) || [""])[0];
    const nc = X("ui/chat.js", "_noteChatConnecting"), sync = X("ui/chat.js", "syncChatTier"), setNote = X("ui/chat.js", "_setChatNote");
    ok(!!decl && nc.ok && sync.ok && setNote.ok, "C PREMISE — the note, its setter and `syncChatTier` were read from ui/chat.js",
      [!!decl, nc.stage, sync.stage, setNote.stage]);
    if (decl && nc.ok && sync.ok && setNote.ok) {
      let active = null;
      const ctx2 = { refs: { chatBox: {}, chatNote: { textContent: "" } }, console,
        _chatModel: () => ({ started: true }), _resolveTiers: () => ({ activeId: active, tiers: [] }), _backfillMissing() {}, _paint() {},
        _renderChatTierStrip() {} };
      vm.createContext(ctx2);
      vm.runInContext(decl + "\n" + setNote.source + "\n" + nc.source + "\n" + sync.source +
        "\n;globalThis.__c = { _noteChatConnecting, syncChatTier, NOTE: CHAT_CONNECTING_NOTE };", ctx2);
      ctx2.__c._noteChatConnecting();
      const shown = ctx2.refs.chatNote.textContent;
      ok(/still connecting/.test(shown) && /kept/.test(shown), "C: the note reads that the chat is still connecting and the message is kept",
        shown);
      ctx2.__c.syncChatTier();
      ok(ctx2.refs.chatNote.textContent === shown, "C: it stays while there is still no chat", ctx2.refs.chatNote.textContent);
      active = "!chat:hs";
      ctx2.__c.syncChatTier();
      ok(ctx2.refs.chatNote.textContent === "", "C: and it goes once the chat is there", ctx2.refs.chatNote.textContent);
    }
  }

  _finished = true;
  if (failed) { console.log("[late-chat] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[late-chat] PASS — a new member's first open of a fresh room gets its chat without a reload (ddjp_621): through the " +
    "real opening, with the chat's join held past the opening's wait and landing before its state synced, the chat is mapped " +
    "once its mark is readable, wired then — a message reaches chat's listeners and a send is not refused — and the UI is told, " +
    "in a shared room and in a bot room, a chat tier mapped at the opening still read after it; and Enter with no chat yet keeps the message and says the chat is still connecting, " +
    "the note going once it is there (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[late-chat] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
