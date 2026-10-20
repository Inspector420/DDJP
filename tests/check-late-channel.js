#!/usr/bin/env node
// tests/check-late-channel.js
// SUBJECT: features/room.js, features/roomupgrade.js
//
// A CHANNEL JOINED AFTER THE OPENING IS FOLDED AT ONCE (J86, the owner's call on J85's finding).
//
// ── WHAT WAS FOUND (J85, measured on `ddjp_582` and `ddjp_583`) ───────────────────────────────────────────────────
// `MatrixBridge.setRoomScope` takes the channel map the opening built. A SPINE channel mapped later — an upgrade's new
// channel, or an open channel whose join landed after the opening's map — went through `Room.mergeChannels`, which never
// added it to that scope. The ingest door (`_ingestSpineEvent`) refused it: its replay folded nothing and its live events
// were dropped, on every tab, until the room was reopened. A channel of a room that SPLITS its ranks over channels is
// silent the moment it exists.
//
// ── WHAT THIS HOLDS, ALL DRIVEN (the real `features/room.js`, `features/roomupgrade.js`, both engines, the seam) ─────
//   A  THE JOIN PATH, a shared room: a spine channel joined after the opening is mapped, put in the room's scope BEFORE
//      its replay, its replay is folded and its next LIVE event is folded — through the bridge's own timeline handler
//      (`start()` registers it on the client), the door every live event takes. No reopen.
//   B  THE UPGRADE PATH: `RoomUpgrade.upgrade` (the transport's batch stubbed) — the batch's new channel is folded at
//      once the same way, and its done marker goes to this room's owner channel.
//   C  ANOTHER ROOM'S CHANNEL IS NEVER IN THE SCOPE, BY EITHER PATH. The join path: a channel whose mark names another
//      room (spine or chat), or carries no mark, is not mapped and not scoped, and its live event is not folded — the
//      mark is checked BEFORE anything is added. The upgrade path: a room left and another opened while the batch ran —
//      the batch's channel is not merged into the new room, not scoped, and no done marker is sent into it. And
//      `mergeChannels` asked for a room that is not the one running refuses.
//   D  A BOT ROOM: `setRoomScope` there also binds the bot engine's FOLD, by role (the log, `events_owner`; the settings,
//      `settings_owner`), once, at entry. `addToRoomScope` widens the shared door only, so a late channel reaches the bot
//      engine's ingest and is folded only if it is one of those roles as bound at entry — measured here, so a change
//      to it is a decision. A bot room has no upgrade path (it is built in one piece).
//
// ── WHAT IT DOES NOT HOLD ───────────────────────────────────────────────────────────────────────────────────────────
//   · That a homeserver delivers the late channel's events — the live check's.
//   · A bot room whose log or settings channel itself joined late: the fold's role stays unbound until a reopen (D says
//     so; J86 does not re-bind it — re-binding resets the fold's opened state and its activity record).

"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[late-channel] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const ORDER = B.ORDER.slice(0, B.ORDER.indexOf("features/room.js")).concat(["features/roomupgrade.js", "features/room.js", "features/actions.js"]);
const STORE = () => ({ history: { load: async () => null, persist() {} }, config: { saveRoom() {} } });
const SPACE = B.SPACE, OTHER = "!space-b:hs";
const raw = (id, room, l) => ({ event_id: id, type: "m.room.message", sender: B.STAFF, room_id: room, origin_server_ts: 1e6 + l,
  content: { msgtype: "m.text", body: JSON.stringify({ t: "ddjp.dj.join", l: l, v: "S" }) } });

// A tab in a room of `mode`, entered through the REAL switch (`Room._enterForTest` -> `_enter`: the leave, the binding,
// the scope, the wiring, and the channel-joined listener). The bridge's announcement of a joined channel is the listener
// list `onChannelJoined` fills; it is recorded as it is subscribed and fired as the bridge's `_announceJoined` does.
// The bridge's live timeline handler is the one `MatrixBridge.start()` registers on the client.
function tab(mode, o) {
  o = o || {};
  const w = B.world({ mode, order: ORDER, extras: { RoomUpgrade: undefined, Store: STORE() } });
  const sb = w.sb, joined = [], handlers = {}, sent = [];
  for (const part of [sb.B1MatrixBridge].concat(mode === "backend2" ? [sb.B2MatrixBridge] : [])) {
    const on0 = part.onChannelJoined;
    part.onChannelJoined = (fn) => { if (!joined.includes(fn)) joined.push(fn); return on0(fn); };
    if (o.upgrade) Object.assign(part, {
      getMyPowerLevel: () => 100, spaceChildLevel: () => 100, highestPresentBatch: () => 1, onProgress: () => {},
      sendEvent: async (ch, type, body) => { sent.push({ ch, type, body }); return { event_id: "$sent" + sent.length }; },
      createUpgradeBatch: (spaceId, channels, n) => o.upgrade(w, spaceId, channels, n) });
  }
  w.client.on = (name, fn) => { handlers[name] = fn; };
  w.channel = (id, name, mark, kind) => {
    w.rooms[id] = { roomId: id, name: name, timeline: [], currentState: { getStateEvents: (t) => {
      if (t === "m.room.create") return { getContent: () => Object.assign({ room_version: "12", ddjp_mode: mode }, mark ? { ddjp_room: mark, ddjp_kind: kind } : {}), getSender: () => B.OWNER };
      if (t === "m.room.power_levels") return { getContent: () => ({ users: Object.assign({}, B.LEVELS), users_default: 0, events: { "m.room.message": 50 }, events_default: 50 }) };
      return null; } } };
  };
  w.enter = (spaceId, channels) => sb.Room._enterForTest({ name: spaceId, spaceId: spaceId, channels: Object.assign({}, channels) }, mode);
  w.join = async (id) => { for (const fn of joined.slice()) fn(id); await settle(); };
  w.live = async (r) => {
    if (!handlers["Room.timeline"]) { try { await sb.MatrixBridge.start(); } catch (e) { /* stops at the SDK's startClient; the handlers are on */ } }
    if (w.rooms[r.room_id]) w.rooms[r.room_id].timeline.push(B.mev(r));
    handlers["Room.timeline"](B.mev(r), w.rooms[r.room_id], false, false, { liveEvent: true });
    await settle(10);
  };
  w.folded = () => sb.StreamManager.getLog().map((e) => e.eventId);
  w.sent = sent; w.joinedListeners = () => joined.length;
  return w;
}

async function main() {
  // ── A — THE JOIN PATH, a shared room ──────────────────────────────────────────────────────────────────────────────
  {
    const w = tab("backend1");
    w.channel("!e50:hs", "events-staff", SPACE, "events_staff");
    w.server["!e50:hs"] = [raw("$late1", "!e50:hs", 7)];
    w.enter(SPACE, w.CH);
    ok(w.joinedListeners() >= 1 && w.sb.MatrixBridge.inScope("!e50:hs") === false,
      "A: PREMISE — the room is open, listening for joined channels, and the late channel is not in the opening's scope");
    await w.join("!e50:hs");
    const cur = w.sb.Room.getCurrent();
    ok(cur && cur.channels.events_staff === "!e50:hs", "A: a spine channel joined after the opening is mapped into the running room", cur && cur.channels);
    ok(w.sb.MatrixBridge.inScope("!e50:hs") === true, "A: and put in the room's scope — what the next opening would give");
    ok(w.folded().indexOf("$late1") >= 0, "A: ITS REPLAY IS FOLDED — scoped BEFORE the replay, so the door takes it (it folded nothing until a reopen)", w.folded());
    await w.live(raw("$late2", "!e50:hs", 8));
    ok(w.folded().indexOf("$late2") >= 0, "A: AND ITS NEXT LIVE EVENT IS FOLDED, through the bridge's own timeline handler — no reopen", w.folded());
  }
  // ── B — THE UPGRADE PATH ──────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = tab("backend1", { upgrade: async (wd, spaceId, channels, n) => {
      wd.channel("!u25:hs", "events-vip", spaceId, "events_vip");
      wd.server["!u25:hs"] = [raw("$up1", "!u25:hs", 9)];
      return { events_vip: "!u25:hs" };
    } });
    w.enter(SPACE, w.CH);
    await w.sb.RoomUpgrade.upgrade();
    await settle();
    ok(w.sb.Room.getCurrent().channels.events_vip === "!u25:hs" && w.sb.MatrixBridge.inScope("!u25:hs") === true,
      "B: AN UPGRADE'S NEW CHANNEL is merged into the room it was made for and put in its scope", w.sb.Room.getCurrent().channels);
    ok(w.folded().indexOf("$up1") >= 0, "B: its replay is folded at once", w.folded());
    await w.live(raw("$up2", "!u25:hs", 10));
    ok(w.folded().indexOf("$up2") >= 0, "B: and its live events — no reopen", w.folded());
    const done = w.sent.filter((s) => s.type === "ddjp.room.upgrade.done");
    ok(done.length === 1 && done[0].ch === B.FULL_CH.events_owner, "B: CONTROL — the batch's done marker goes to this room's owner channel", w.sent);
  }
  // ── C — ANOTHER ROOM'S CHANNEL IS NEVER IN THE SCOPE, BY EITHER PATH ──────────────────────────────────────────────
  {
    const w = tab("backend1");
    w.channel("!x50:hs", "events-staff", OTHER, "events_staff");          // a spine channel whose mark names another room
    w.channel("!xchat:hs", "chat-staff", OTHER, "chat_staff");            // a chat channel whose mark names another room
    w.channel("!nomark:hs", "events-vip", null, null);                    // a channel with no mark at all
    w.server["!x50:hs"] = [raw("$foreign1", "!x50:hs", 7)];
    w.enter(SPACE, w.CH);
    for (const id of ["!x50:hs", "!xchat:hs", "!nomark:hs"]) await w.join(id);
    const vals = Object.values(w.sb.Room.getCurrent().channels);
    ok(!vals.includes("!x50:hs") && !vals.includes("!xchat:hs") && !vals.includes("!nomark:hs"),
      "C: THE JOIN PATH — a channel whose mark names another room, or carries none, is not mapped", w.sb.Room.getCurrent().channels);
    ok(w.sb.MatrixBridge.inScope("!x50:hs") === false && w.sb.MatrixBridge.inScope("!xchat:hs") === false && w.sb.MatrixBridge.inScope("!nomark:hs") === false,
      "C: THE JOIN PATH — and never added to the room's scope, spine or chat: the mark is checked BEFORE anything is added",
      { spine: w.sb.MatrixBridge.inScope("!x50:hs"), chat: w.sb.MatrixBridge.inScope("!xchat:hs"), none: w.sb.MatrixBridge.inScope("!nomark:hs") });
    await w.live(raw("$foreign2", "!x50:hs", 8));
    ok(w.folded().indexOf("$foreign1") < 0 && w.folded().indexOf("$foreign2") < 0, "C: and nothing of it is folded, its history nor its live events", w.folded());
  }
  {
    // The room is left and another opened WHILE the batch runs: what it made belongs to the first room.
    const CHB = { events_uncategorized: "!b0:hs", events_owner: "!b99:hs", settings_owner: "!bs99:hs", checkpoints_owner: "!bc99:hs" };
    const w = tab("backend1", { upgrade: async (wd, spaceId, channels, n) => {
      wd.enter(OTHER, CHB);                                                // the tab moves on mid-batch
      wd.channel("!u25a:hs", "events-vip", spaceId, "events_vip");
      wd.server["!u25a:hs"] = [raw("$upA", "!u25a:hs", 9)];
      return { events_vip: "!u25a:hs" };
    } });
    B.addRoom(w, OTHER, CHB, { mode: "backend1" });
    w.enter(SPACE, w.CH);
    await w.sb.RoomUpgrade.upgrade();
    await settle();
    const cur = w.sb.Room.getCurrent();
    ok(cur && cur.spaceId === OTHER, "C: PREMISE — the tab is in the other room when the batch returns", cur && cur.spaceId);
    ok(cur && !Object.values(cur.channels).includes("!u25a:hs") && w.sb.MatrixBridge.inScope("!u25a:hs") === false,
      "C: THE UPGRADE PATH — a batch that returns after its room was left is not merged into the room running now, nor scoped", cur && cur.channels);
    ok(w.folded().indexOf("$upA") < 0, "C: and nothing of it is folded there", w.folded());
    ok(!w.sent.some((s) => s.type === "ddjp.room.upgrade.done"), "C: and no done marker is sent into the other room's owner channel", w.sent);
    w.sb.Room.mergeChannels({ events_vip: "!zz:hs" }, SPACE);
    ok(!Object.values(w.sb.Room.getCurrent().channels).includes("!zz:hs") && w.sb.MatrixBridge.inScope("!zz:hs") === false,
      "C: `mergeChannels` asked for a room that is not the one running refuses — not mapped, not scoped");
  }
  // ── D — A BOT ROOM: THE DOOR WIDENS, THE FOLD'S ROLES DO NOT ──────────────────────────────────────────────────────
  {
    const w = tab("backend2");
    w.channel("!late:hs", "events-staff", SPACE, "events_staff");
    w.server["!late:hs"] = [raw("$botlate1", "!late:hs", 7)];
    w.enter(SPACE, w.CH);
    const before = JSON.stringify(w.sb.B2StreamManager.foldScope());
    ok(before === JSON.stringify({ log: B.BOT_CH.events_owner, settings: B.BOT_CH.settings_owner }),
      "D: PREMISE — the bot room's entry bound the fold by role: the log and the settings", before);
    await w.join("!late:hs");
    ok(w.sb.MatrixBridge.inScope("!late:hs") === true, "D: a late spine channel of a bot room joins the shared door's scope, as in a shared room");
    ok(JSON.stringify(w.sb.B2StreamManager.foldScope()) === before && w.folded().indexOf("$botlate1") < 0,
      "D: but the bot engine's fold keeps the roles its entry bound — a channel that is neither is not folded (measured: a " +
      "change here is a decision)", { fold: w.sb.B2StreamManager.foldScope(), folded: w.folded() });
  }
}

main().catch((e) => { failed++; console.log("[late-channel] FAIL — threw: " + ((e && e.stack) || e)); }).then(() => {
  if (failed) { console.log("[late-channel] " + failed + " of " + asserts + " assertions failed"); process.exit(1); }
  console.log("[late-channel] PASS — a channel joined after the opening is folded at once (J86; " + asserts + " assertions, all " +
    "driven). THE JOIN PATH and THE UPGRADE PATH each put the room's new channel in its scope before its replay, so its " +
    "history and its next live event (through the bridge's own timeline handler) fold without a reopen. A channel whose " +
    "mark names another room, or none, is never mapped or scoped by the join path; an upgrade that returns after its room " +
    "was left merges nothing into the next room and sends it no done marker; `mergeChannels` refuses a room not running. " +
    "In a bot room the shared door widens and the bot engine's fold keeps the roles its entry bound. THIS GUARD CANNOT " +
    "TELL YOU A HOMESERVER DELIVERS THE LATE CHANNEL'S EVENTS — that is the live check's.");
});
