// tests/_inviteworld.js
// THE INVITE WORLD — a harness, not a guard (no `check-` prefix, so `run-all` does not run it). Added at J81 for the guards that
// drive invites, the one classifier and the ONE join step: `check-invite-kinds`, `check-join-step`, `check-dm-invites`.
//
// WHAT IS REAL: every module `tests/_botroom.js` loads — both engines behind the real seam, `features/room.js`, `features/actions.js`
// — plus `features/chat.js` for the DM panel. WHAT IS A DOUBLE: the homeserver and the SDK client in front of it, because nothing
// headless has one. The double is a small MODEL rather than a script, so a guard states a situation (who is in which room, who
// invited whom, which room lists which channel) and the real code finds its own way through it:
//   · MEMBERSHIP per account and room: join, invite (with its sender, `is_direct` and time), leave.
//   · JOIN RULES as a homeserver applies them: an invite joins; `restricted` joins a member of the allowed space; `invite` refuses
//     anyone uninvited with 403 M_FORBIDDEN. A guard can queue failures for a room (`w.hs.failNext[id]`), e.g. a 429 first.
//   · WHAT AN ACCOUNT SEES, as the SDK shows it: a joined room in full; an INVITED room as its preview (stripped state) — its
//     creation record (unless a guard drops it: `noCreateInPreview`), its name, this account's invite event and the inviter's
//     membership, and nothing else (no child list, no power levels, no other members unless `previewAll`, no `m.space.parent`).
//   · A DDJP room built as `createDDJPSpace` builds one (`w.hs.ddjpRoom`): the space declares its engine, every channel carries
//     its MARK and names its space, the space lists every channel; open channels are `restricted`, the three chats above the
//     open one and the presence chat are `invite`. Options build the shapes the guards need: unmarked channels, a channel made
//     by someone else, a room listing a stranger's room.
// Sync is NOT simulated: a guard says when the account's membership changed (`w.emit("Room.myMembership")`) and delivers state a
// sync would carry (`w.state(...)`), so every row reads in a known order. A room a guard marks `unsynced` shows no state once
// joined, until the guard clears the mark (a channel joined before its state has synced, `ddjp_621`).
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const { ORDER, deep, botRuntime } = require(path.join(__dirname, "_botroom.js"));

const OWNER = "@owner:hs", ME = "@me:hs";
// The bot-room plan (`backends/backend2/skeleton.js`) is the world's DDJP room: seven channels, four open and three invite-only,
// all at creation. The join rule each gets is the builder's (`_builderFor`): chats above level 0 and the presence chat invite-only.
const B2_KEYS = ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized", "chat_guest", "chat_staff", "presence_chat"];
const INVITE_ONLY = { chat_guest: true, chat_staff: true, presence_chat: true };

function ev(type, content, sender, stateKey, ts) {
  return { getType: () => type, getContent: () => content, getSender: () => sender, getTs: () => ts || 1000,
    getStateKey: () => (stateKey === undefined ? "" : stateKey), getRoomId: () => null, getPrevContent: () => ({}) };
}

function homeserver() {
  const rooms = Object.create(null);
  const hs = { rooms, failNext: Object.create(null), joins: [], leaves: [], n: 0 };
  hs.room = (id, o) => {
    rooms[id] = Object.assign({ id, name: o.name || id, create: { content: o.content || { room_version: "12" }, sender: o.creator || OWNER },
      members: Object.assign({}, o.members || {}), inviteMeta: Object.create(null), joinRule: o.joinRule || "invite", allow: o.allow || null,
      children: o.children || [], power: o.power || { users: {}, users_default: 0 }, parent: o.parent || null, noCreateInPreview: false }, {});
    return rooms[id];
  };
  // An invite as the inviter's homeserver delivers it.
  hs.invite = (roomId, userId, o) => {
    const R = rooms[roomId]; o = o || {};
    R.members[userId] = "invite";
    R.inviteMeta[userId] = { sender: o.from || R.create.sender, direct: !!o.direct, ts: o.ts || (2000 + (++hs.n)) };
  };
  // A DDJP room as `createDDJPSpace` builds one (see the header). `o.me`: this account's membership in the SPACE.
  hs.ddjpRoom = (spaceId, o) => {
    o = o || {};
    const creator = o.creator || OWNER, mode = o.mode || "backend2", base = spaceId.slice(1, spaceId.indexOf(":"));
    const ch = {};
    for (const key of (o.keys || B2_KEYS)) ch[key] = "!" + base + "-" + key.replace(/_/g, "-") + ":hs";
    const power = { users: Object.assign({}, o.levels || {}), users_default: 0 };
    hs.room(spaceId, { name: o.name || base, creator, content: { room_version: "12", type: "m.space", ddjp_mode: mode },
      members: { [creator]: "join" }, joinRule: "invite", children: Object.values(ch), power });
    for (const key of Object.keys(ch)) {
      const marked = o.unmarked ? { room_version: "12" } : { room_version: "12", ddjp_room: spaceId, ddjp_kind: key };
      hs.room(ch[key], { name: key.replace(/_/g, "-"), creator: (o.madeBy && o.madeBy[key]) || creator, content: marked,
        members: { [creator]: "join" }, joinRule: INVITE_ONLY[key] ? "invite" : "restricted", allow: spaceId, power, parent: spaceId });
    }
    return { spaceId, ch };
  };
  return hs;
}

// ONE ACCOUNT'S CLIENT, on the shared homeserver: what the SDK would show `me`, and the calls the bridge makes.
function clientFor(hs, me, extra) {
  const listeners = Object.create(null), views = Object.create(null);
  const account = { direct: {} };
  const ms = (id) => (hs.rooms[id] ? hs.rooms[id].members[me] : undefined);
  const memberEv = (R, u) => {
    const m = R.members[u];
    if (!m) return null;
    const meta = R.inviteMeta[u];
    return ev("m.room.member", m === "invite" ? { membership: "invite", is_direct: !!(meta && meta.direct) } : { membership: m },
      m === "invite" && meta ? meta.sender : u, u, meta ? meta.ts : 1000);
  };
  const view = (id) => {
    if (views[id]) return views[id];
    const R = () => hs.rooms[id];
    const invited = () => ms(id) === "invite";
    const inviter = () => { const meta = R().inviteMeta[me]; return meta ? meta.sender : null; };
    // A preview shows this account and the inviter — unless the room says its server sends every member (`previewAll`), the
    // case where the preview alone can show a group.
    const visible = () => (invited() && !R().previewAll) ? [me, inviter()].filter((u) => u && R().members[u]) : Object.keys(R().members);
    const v = views[id] = {
      roomId: id, timeline: [],
      get name() { return R().name; },
      getMyMembership: () => ms(id) || "leave",
      getJoinedMemberCount: () => visible().filter((u) => R().members[u] === "join").length,
      getInvitedMemberCount: () => visible().filter((u) => R().members[u] === "invite").length,
      getMember: (u) => (visible().indexOf(u) >= 0 ? { userId: u, membership: R().members[u] } : null),
      getMembers: () => visible().map((u) => ({ userId: u, membership: R().members[u] })),
      getMembersWithMembership: (m) => visible().filter((u) => R().members[u] === m).map((u) => ({ userId: u, membership: m })),
      getJoinedMembers: () => visible().filter((u) => R().members[u] === "join").map((u) => ({ userId: u, name: u })),
      getLastActiveTimestamp: () => 0,
      currentState: { getStateEvents: (type, key) => {
        const r = R(), one = key !== undefined;
        // JOINED, NOT YET SYNCED (`ddjp_621`): `joinRoom` returns as soon as the homeserver says yes, and the room's state —
        // its mark among it — comes with a later sync. A guard sets `unsynced` on a room to hold that state back, then clears
        // it and delivers the creation record through `w.state(...)`, as the sync would.
        if (r.unsynced && ms(id) === "join") return one ? null : [];
        const pick = (list) => (one ? (list.find((e) => e.getStateKey() === key) || null) : list);
        if (type === "m.room.create") {
          if (invited() && r.noCreateInPreview) return one ? null : [];
          const c = ev("m.room.create", r.create.content, r.create.sender, "");
          return one ? (key === "" ? c : null) : [c];
        }
        if (type === "m.room.member") return pick(visible().map((u) => memberEv(r, u)).filter(Boolean));
        if (invited()) return one ? null : [];   // a preview carries nothing else
        if (type === "m.room.power_levels") { const p = ev("m.room.power_levels", r.power, r.create.sender, ""); return one ? (key === "" ? p : null) : [p]; }
        if (type === "m.space.child") return pick(r.children.map((cid) => ev("m.space.child", { via: ["hs"] }, r.create.sender, cid)));
        if (type === "m.space.parent") return pick(r.parent ? [ev("m.space.parent", { via: ["hs"], canonical: true }, r.create.sender, r.parent)] : []);
        if (type === "m.room.join_rules") { const j = ev("m.room.join_rules", { join_rule: r.joinRule }, r.create.sender, ""); return one ? (key === "" ? j : null) : [j]; }
        return one ? null : [];
      } },
    };
    return v;
  };
  const err = (code, st, msg) => Object.assign(new Error(msg || code), { errcode: code, httpStatus: st });
  const client = Object.assign({
    getUserId: () => me, getDeviceId: () => "DEV", getSyncState: () => "SYNCING", getCrypto: () => ({}),
    getRoom: (id) => ((ms(id) === "join" || ms(id) === "invite") ? view(id) : null),
    getRooms: () => Object.keys(hs.rooms).filter((id) => ms(id) === "join" || ms(id) === "invite").map(view),
    joinRoom: async (id) => {
      await Promise.resolve();
      const q = hs.failNext[id];
      if (q && q.length) { const e = q.shift(); throw err(e.errcode, e.httpStatus, e.message); }
      const R = hs.rooms[id];
      if (!R) throw err("M_NOT_FOUND", 404, "no such room");
      const m = R.members[me];
      if (m === "join") return { roomId: id };
      const allowed = m === "invite" || R.joinRule === "public" ||
        (R.joinRule === "restricted" && R.allow && hs.rooms[R.allow] && hs.rooms[R.allow].members[me] === "join");
      if (!allowed) throw err("M_FORBIDDEN", 403, "You are not invited to this room");
      R.members[me] = "join";
      hs.joins.push(me + " " + id);
      return { roomId: id };
    },
    leave: async (id) => {
      await Promise.resolve();
      const q = hs.failNext["leave:" + id];
      if (q && q.length) { const e = q.shift(); throw err(e.errcode, e.httpStatus, e.message); }
      if (hs.rooms[id]) hs.rooms[id].members[me] = "leave";
      hs.leaves.push(me + " " + id);
    },
    invite: async (roomId, userId) => { hs.invite(roomId, userId, { from: me }); },
    getAccountData: (t) => (t === "m.direct" ? { getContent: () => account.direct } : null),
    setAccountData: async (t, v) => { if (t === "m.direct") account.direct = JSON.parse(JSON.stringify(v)); },
    scrollback: async () => {}, sendMessage: async () => ({ event_id: "$sent" + (++hs.n) }), sendStateEvent: async () => ({}),
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); }, removeListener: () => {},
  }, extra || {});
  return { client, listeners, account, view };
}

// ONE DEVICE of account `o.me` (default ME), with the real modules. Timers: short ones (the bounded waits of an opening) run for
// real; anything a second or longer is held, so nothing fires behind a row's back. The join step's backoff and the rank debounce
// run at once (their own guard seams), so a retry is a reading, not a wait.
function inviteWorld(o) {
  o = o || {};
  const hs = o.hs || homeserver(), me = o.me || ME;
  const logs = [];
  const ctx = {
    Date, Math, JSON, Promise,
    setTimeout: (fn, ms) => ((ms || 0) < 1000 ? setTimeout(fn, ms) : 0),
    // A guard's own timer handle (an object marked `fake`) is cleared here too, so a debounce can be read through its seam.
    clearTimeout: (id) => { if (id && id.fake) id.live = false; else if (id) clearTimeout(id); },
    setInterval: () => 0, clearInterval: () => {},
    window: { addEventListener() {} }, document: { addEventListener() {}, visibilityState: "visible", body: { appendChild() {} } },
    navigator: { onLine: true }, localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
    indexedDB: undefined,
    Store: o.withChat ? undefined : { history: { load: async () => null, persist() {} }, config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {} } },
    StorageIO: o.withChat ? undefined : deep(), IDB: o.withChat ? undefined : deep(), ChatPrefs: o.withChat ? undefined : deep(),
    Queue: deep(), Skip: deep(), Playback: deep(), Chat: o.withChat ? undefined : deep(), Reactions: deep(), MediaLength: deep(),
    MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(), RoomUpgrade: deep(), BotRuntime: botRuntime(), Interface: deep(),
  };
  Object.assign(ctx, o.extras || {});   // J83: globals a guard adds (`sessionStorage` for the tab's room); off by default
  for (const k of Object.keys(ctx)) if (ctx[k] === undefined) delete ctx[k];   // a real module fills these (the chat world)
  const files = o.withChat ? ["core/storageio.js", "core/idb.js", "core/store.js", "core/chatprefs.js"].concat(ORDER, ["ui/chatbuffer.js", "features/chat.js"]) : ORDER;
  const sb = loadInContext(files, ctx);
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = (m) => { logs.push(k + ": " + m); };
  const c = clientFor(hs, me, o.client);
  sb.Backends.bindBootstrap();   // the lobby, as `app.js` boots it: the shared transport bound before any room is opened
  sb.MatrixBridge._setClientForTest(c.client);
  // Seams a tree before J81 does not have are skipped, not required: a guard's red-first run on the previous code must read its
  // rows, not die at the world's construction.
  if (typeof sb.MatrixBridge._setJoinSleepForTest === "function") sb.MatrixBridge._setJoinSleepForTest(() => Promise.resolve());
  if (typeof sb.MatrixBridge._setRankLaterForTest === "function") sb.MatrixBridge._setRankLaterForTest((fn) => { fn(); return 0; });
  // J84-1: a room-list burst's one request fires on the NEXT TURN here (not 250 ms later), so a row's `settle` reads it; the
  // burst still coalesces, and a row that wants the timer itself holds it through the same seam.
  if (typeof sb.Room._setJoinLaterForTest === "function") sb.Room._setJoinLaterForTest((fn) => { const h = { fake: true, live: true }; setImmediate(() => { if (h.live) fn(); }); return h; });
  const emit = (evt) => { for (const fn of (c.listeners[evt] || [])) { try { fn(); } catch (e) { logs.push("error: listener threw " + e.message); } } };
  // State a sync would deliver: `type` in room `roomId`, keyed `key`, with `content` — through the bridge's real watcher.
  const state = (roomId, type, key, content, sender) => {
    if (typeof sb.MatrixBridge._onStateEventForTest !== "function") { logs.push("error: _inviteworld: no state seam in this tree — not delivered"); return; }
    sb.MatrixBridge._onStateEventForTest(Object.assign(ev(type, content || {}, sender || OWNER, key), { getRoomId: () => roomId }));
  };
  const lines = (re, from) => logs.slice(from || 0).filter((m) => re.test(m));
  const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r)); };
  return { sb, hs, me, logs, client: c.client, account: c.account, listeners: c.listeners, emit, state, lines, settle,
    Room: sb.Room, MB: sb.MatrixBridge, MA: sb.MatrixAccount, Chat: sb.Chat };
}

module.exports = { homeserver, inviteWorld, clientFor, ev, OWNER, ME, B2_KEYS, INVITE_ONLY };
