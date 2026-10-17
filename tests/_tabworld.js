// tests/_tabworld.js
// THE TAB WORLD — a harness, not a guard (no `check-` prefix, so `run-all` does not run it). Added at J83 for the guards of the
// ONE leave step and the reload (`check-room-leave`, `check-room-reload`), so both drive the SAME tab rather than two copies.
//
// It is the bot-room world (`tests/_botroom.js`) with the REAL feature modules a room starts — playback, queue, skip, reactions,
// length, blocked, the server clock, chat, the upgrade watcher, the personal queue, the bot runtime — loaded in `index.html`'s
// order instead of the deep doubles the other bot-room guards use, its timers captured, and a per-tab `sessionStorage`. The
// world's room is a bot room with a chat channel, opened through the REAL switch (`Room._enterForTest`, `start: true`). Before
// it is returned the world's own hand entry is LEFT through the real leave and DMs are bound, as `app.js` reaches the lobby.
// `o.holdLoad` holds the stored history table back (`w.loads`, resolved by the guard) so a backfill can be caught in flight;
// `o.ss` hands in the tab's storage, so a "reload" is a second world over the same tab.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));
const { BOT } = B;

const FEAT = ["core/playlistdoc.js", "features/queue.js", "features/skip.js", "features/reactions.js", "features/medialength.js",
  "features/serverclock.js", "features/mediablocked.js", "features/playback.js", "ui/chatbuffer.js", "features/chat.js",
  "features/roomupgrade.js", "features/userqueue.js"];
const ORDER = B.ORDER.slice(0, B.ORDER.indexOf("features/room.js")).concat(FEAT,
  ["features/room.js", "features/actions.js", "features/botsettings.js", "features/botruntime.js",
   // J84-2: REP's pieces, as the page loads them — so the leave's census holds REP's timers too, and the bot side runs
   // here on the bot's tab through the real hooks (H1 at the bot's evaluation, H2 at the leave). J84-3: the reader too,
   // which runs on every tab, so a tab that is not the bot now holds REP's reader tick while it is in a room.
   "features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js", "features/rep-reader.js"]);
const REAL = { Queue: undefined, Skip: undefined, Playback: undefined, Chat: undefined, Reactions: undefined, MediaLength: undefined,
  MediaBlocked: undefined, ServerClock: undefined, UserQueue: undefined, RoomUpgrade: undefined, BotRuntime: undefined };
function tabStore() {
  return { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
}
// THE ROOM: the bot room, with a chat channel so room chat runs too.
const CH = { events_uncategorized: "!c-in:hs", events_owner: "!c-log:hs", settings_owner: "!c-set:hs", chat_uncategorized: "!c-chat:hs" };
const ROOM = "!space-c:hs", DM = "!dm:hs", T0 = 5e6;
function realWorld(o) {
  o = o || {};
  const ss = o.ss || tabStore(), persisted = [], docL = { add: 0, remove: 0 };
  const loads = o.loads || [];
  const store = { history: { load: (sid) => { if (o.holdLoad) return new Promise((res) => loads.push({ sid, res })); return Promise.resolve(null); },
      persist: (sid) => { persisted.push(sid); } },
    queue: { load: async () => null, save() {}, persist() {} }, config: { saveRoom() {} }, stagger: { offsetMs: () => 0 } };
  const document = { visibilityState: "visible", hidden: false,
    addEventListener: (t, fn) => { if (t === "visibilitychange" && fn && fn.name === "_onShown") docL.add++; },
    removeEventListener: (t, fn) => { if (t === "visibilitychange" && fn && fn.name === "_onShown") docL.remove++; }, body: { appendChild() {} } };
  const w = B.world({ me: BOT, timers: true, fanOut: true, order: ORDER, extras: Object.assign({ sessionStorage: ss, Store: store, document }, REAL) });
  B.addRoom(w, ROOM, CH, { mode: "backend2", creator: "@owner:hs", levels: { [BOT]: 99 } });
  // State lists the SDK answers with an array (the world's rooms answer only what its own guards ask): the space lists no
  // children here, so the chat tiers resolve from the map the switch is handed.
  for (const id of Object.keys(w.rooms)) {
    const cs = w.rooms[id].currentState, get0 = cs.getStateEvents;
    cs.getStateEvents = (t, k) => { const r = get0(t, k); return (r === null && t === "m.space.child" && k === undefined) ? [] : r; };
  }
  // THE LOBBY, as `app.js` reaches it: the world entered its room by hand, so it is left first (the real leave), and DMs are
  // bound at login (E3) — before any room is opened, through the lobby's binding.
  // A tree before J83 has no leave (a red-first run on the previous code): the world stays in its hand-entered room, and the
  // guard's rows read what that code does.
  if (typeof w.sb.Room.leave === "function") w.sb.Room.leave("the world's own entry", { reloading: true });   // the hand entry never wrote the tab's memory; this leaves it as it is
  // The account's one conversation, as `m.direct` lists it (the SDK's account data is not modelled); every bind fills the
  // shell from the engine part, so both are told.
  for (const m of [w.sb.B1MatrixAccount, w.sb.MatrixAccount]) m.dmRoomIds = () => [DM];
  w.sb.Chat.dmInit();
  w.ss = ss; w.persisted = persisted; w.docL = docL; w.loads = loads;
  w.enter = (opts) => {
    if (typeof w.sb.Room._enterForTest !== "function") throw new Error("_tabworld: this tree has no switch seam (`Room._enterForTest`, J83)");
    return w.sb.Room._enterForTest({ name: "the bot room", spaceId: ROOM, channels: CH }, "backend2", Object.assign({ start: true }, opts || {}));
  };
  return w;
}

module.exports = { realWorld, tabStore, CH, ROOM, DM, T0, ORDER, BOT };
