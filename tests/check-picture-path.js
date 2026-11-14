#!/usr/bin/env node
// tests/check-picture-path.js
// SUBJECT: backends/backend1/matrixaccount.js, backends/backend1/matrixbridge.js, ui/base.js, ui/screens.js
//
// WALL: A PICTURE CHANGE REACHES THE APP THROUGH THE ROOM, SO PRESENCE IS NOT NEEDED (`ddjp_700`, JOB 1; the owner's "1 ok but
// will this stop us from noticing image changes when they occure if yes, then make it work at least when openning the room or
// maybe, how does element do it?", and the supervisor's answer: no — a picture change also updates the person's member event in
// every room they are in, which is how Element shows and updates pictures; `main/05-matrix.md` §Asking Matrix less).
//   PART S — THE SDK, RUN. matrix-js-sdk 41.8.0 itself (`node_modules`, the source `lib/matrix-sdk.bundle.js` is built from —
//            `tools/VENDOR_PROVENANCE.md`; rebuilt at `ddjp_700` to the same SHA-256): a real client, started against a
//            homeserver that answers its requests with the syncs a server would send. Which of the SDK's events fire for an
//            `m.room.member` whose `avatar_url` changed (membership and name the same), which for an `m.presence`, and which for a
//            room's members loaded on request. The app's three old listeners named, each answered: "RoomMember.membership" fires
//            only when the membership changes; "RoomMember.avatarUrl" is no event of this SDK; "User.avatarUrl" comes from presence.
//   PART A — THE ACCOUNT'S PICTURES, the real backend1 files in the invite world, its rooms' member events carrying pictures:
//            the picture shown is the member event's (a room whose members are held, the open room's first), never asking a load;
//            a member event that changes it — delivered as the SDK delivers it, on "RoomState.members" — swaps it; removed,
//            initials; the same change from the person's other rooms is fetched once; another room's own picture, unchanged
//            there, does not flip it; THE OPENING: a picture shown before the room's members landed (the profile's) gives way to
//            the member's when they land, and a profile answer arriving later does not take it back; a person in no shared room
//            (a DM search's suggestion) keeps the profile lookup; no presence listener is left.
//   PART U — EVERYWHERE IT IS SHOWN, the real ui/ files in the screen world: one picture change reaches People's row, the DM
//            list's row, a chat row, the player's line, an open card and your own picture.
// RED FIRST ON 699: A (the profile first; no "RoomState.members" listener; presence listeners) and U (People's row, the DM list
// and an open card kept the old picture); S holds what the SDK does on both trees. On 699 U's chat row and player's line read
// red here too, and that is this double's, not 699's: 699's sweep was written with single quotes (`[data-avatar-for='…']`),
// which the screen world's selector reader does not read and a browser does; since `ddjp_700` it is written with double quotes.
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[picture-path] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[picture-path] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };

// ── S — THE SDK, RUN ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function partS() {
  let sdk = null, logger = null;
  try {
    sdk = await import(path.join(ROOT, "node_modules", "matrix-js-sdk", "lib", "index.js"));
    logger = (await import(path.join(ROOT, "node_modules", "matrix-js-sdk", "lib", "logger.js"))).logger;
  } catch (e) { sdk = null; }
  if (!ok(!!sdk && typeof sdk.createClient === "function", "S APPLIED — matrix-js-sdk loads from node_modules (`npm install`, as the suite needs)", sdk ? Object.keys(sdk).length : null)) return;
  try { logger.disableAll(); } catch (e) {}
  const version = require(path.join(ROOT, "node_modules", "matrix-js-sdk", "package.json")).version;
  ok(version === "41.8.0", "S PREMISE — the SDK is the version the bundle is built from (41.8.0, `tools/VENDOR_PROVENANCE.md`)", version);
  const quiet = console.log, quietW = console.warn, quietE = console.error, quietI = console.info, quietD = console.debug;
  console.log = console.warn = console.error = console.info = console.debug = () => {};
  const ME = "@me:hs", ANN = "@ann:hs", BEA = "@bea:hs", R = "!r:hs", L = "!lazy:hs";
  const body = (u, avatar) => Object.assign({ membership: "join", displayname: u.slice(1, 4) }, avatar ? { avatar_url: avatar } : {});
  let n = 0;
  const mem = (u, avatar, prev) => Object.assign({ type: "m.room.member", state_key: u, sender: u, event_id: "$m" + (++n), origin_server_ts: 1000 + n, content: body(u, avatar) },
    prev !== undefined ? { unsigned: { prev_content: body(u, prev) } } : {});
  const syncs = [
    { next_batch: "s1", rooms: { join: {
      [R]: { state: { events: [mem(ME), mem(ANN, "mxc://hs/a")] }, timeline: { events: [], limited: false } },
      [L]: { summary: { "m.joined_member_count": 3, "m.heroes": [ANN, BEA] }, state: { events: [mem(ME)] }, timeline: { events: [], limited: false } } } } },
    { next_batch: "s2", rooms: { join: { [R]: { timeline: { events: [mem(ANN, "mxc://hs/b", "mxc://hs/a")], limited: false } } } } },
    { next_batch: "s3", presence: { events: [{ type: "m.presence", sender: ANN, content: { presence: "online", avatar_url: "mxc://hs/c" } }] } },
  ];
  let step = 0, drained;
  const drainedP = new Promise((r) => { drained = r; });
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const fetchFn = async (url) => {
    const p = new URL(url).pathname;
    if (/\/sync$/.test(p)) { if (step < syncs.length) return json(syncs[step++]); drained(); return new Promise(() => {}); }
    if (/\/rooms\/.*\/members$/.test(p)) return json({ chunk: [mem(ME), mem(ANN, "mxc://hs/d"), mem(BEA, "mxc://hs/e")] });
    if (/\/filter/.test(p)) return json({ filter_id: "f1" });
    if (/\/versions$/.test(p)) return json({ versions: ["v1.11"], unstable_features: {} });
    if (/pushrules/.test(p)) return json({ global: {} });
    return json({});
  };
  const fired = [];
  const NAMES = ["RoomMember.membership", "RoomMember.name", "RoomMember.avatarUrl", "User.avatarUrl", "User.presence", "RoomState.members", "RoomState.events", "RoomState.newMember"];
  let client = null;
  try {
    client = sdk.createClient({ baseUrl: "http://hs", accessToken: "t", userId: ME, deviceId: "D", fetchFn });
    for (const name of NAMES) client.on(name, (a, b, c) => {
      const t = a && typeof a.getType === "function" ? a.getType() : null;
      const who = t === "m.presence" ? a.getSender() : ((c && c.userId) || (b && b.userId) || (a && a.getStateKey && a.getStateKey()));
      const room = a && typeof a.getRoomId === "function" ? a.getRoomId() : null;
      fired.push({ step, name, type: t, who, room, avatar: a && a.getContent ? (a.getContent().avatar_url || null) : null });
    });
    await client.startClient({ initialSyncLimit: 1, lazyLoadMembers: true });
    await Promise.race([drainedP, new Promise((r) => setTimeout(r, 8000))]);
  } catch (e) { console.log = quiet; ok(false, "S: the SDK client ran — " + ((e && e.message) || e)); }
  const at = (s, who) => fired.filter((f) => f.step === s && f.who === who).map((f) => f.name);
  // the avatar-only change: the second sync (step 2 when its listeners ran)
  const change = at(2, ANN);
  // a room's members on request
  let lazyRoom = null, loadFired = [];
  try {
    lazyRoom = client.getRoom(L);
    const before = fired.length;
    const loadedBefore = lazyRoom && lazyRoom.membersLoaded ? lazyRoom.membersLoaded() : null;
    if (lazyRoom) await lazyRoom.loadMembersIfNeeded();
    loadFired = fired.slice(before);
    lazyRoom.__loadedBefore = loadedBefore;
  } catch (e) { loadFired = ["threw: " + ((e && e.message) || e)]; }
  try { client.stopClient(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 50));   // the SDK's own after-stop words, still silenced
  console.log = quiet; console.warn = quietW; console.error = quietE; console.info = quietI; console.debug = quietD;
  ok(at(1, ANN).indexOf("RoomMember.membership") >= 0 && at(1, ANN).indexOf("RoomState.members") >= 0,
    "S PREMISE — the first sync's join raised the SDK's member events (RoomMember.membership, RoomState.members)", at(1, ANN));
  ok(change.indexOf("RoomState.members") >= 0,
    "S: A MEMBER EVENT WHOSE PICTURE CHANGED RAISES \"RoomState.members\" — the event the app now listens on", change);
  ok(change.indexOf("RoomMember.membership") < 0 && change.indexOf("RoomMember.name") < 0 && change.indexOf("User.avatarUrl") < 0 && change.indexOf("RoomMember.avatarUrl") < 0,
    "S: AND NONE OF THE APP'S THREE OLD LISTENERS — not RoomMember.membership (the membership did not change), not User.avatarUrl, not RoomMember.avatarUrl", change);
  ok(change.join() === "RoomState.events,RoomState.members", "S: only RoomState.events and RoomState.members, in that order", change);
  const memberEvents = Object.values(sdk.RoomMemberEvent || {});
  ok(memberEvents.length > 0 && memberEvents.indexOf("RoomMember.avatarUrl") < 0,
    "S: \"RoomMember.avatarUrl\" IS NO EVENT OF THIS SDK — RoomMemberEvent is " + memberEvents.join(", "), memberEvents);
  const pres = at(3, ANN);
  ok(pres.indexOf("User.avatarUrl") >= 0 && pres.indexOf("User.presence") >= 0,
    "S: \"User.avatarUrl\" COMES FROM PRESENCE — an m.presence carrying a picture raises it (with User.presence)", pres);
  ok(fired.filter((f) => f.name === "User.avatarUrl").every((f) => f.type === "m.presence"),
    "S: and from nothing else in these syncs — never from a member event", fired.filter((f) => f.name === "User.avatarUrl"));
  const loaded = loadFired.filter((f) => f && f.name === "RoomState.members").map((f) => f.who + " " + f.avatar);
  ok(lazyRoom && lazyRoom.__loadedBefore === false && loaded.indexOf(ANN + " mxc://hs/d") >= 0 && loaded.indexOf(BEA + " mxc://hs/e") >= 0,
    "S: A ROOM'S MEMBERS LOADED ON REQUEST RAISE \"RoomState.members\" FOR EACH — so the opening's load reaches the same listener", { loaded, all: loadFired.map((f) => f.name + " " + f.who) });
  return { change, pres, loaded };
}

// ── THE INVITE WORLD, ITS MEMBER EVENTS CARRYING PICTURES ────────────────────────────────────────────────────────────────────
// The base world's member events carry the membership only; here each joined room's carry `avatar_url` from `pics[room][user]`
// (and a removed one none). A room listed in `lazy` holds, until `loaded`, only this account's member event, as the SDK holds a
// room whose members come on request; `loadMembersIfNeeded` lands on the next turn.
function pictureClient(hs, me, pics, o) {
  o = o || {};
  const base = W.clientFor(hs, me);
  // `lazy`: the rooms whose members come on request — a list, or "*" for every room.
  const loads = [], loaded = new Set(), lazy = o.lazy === "*" ? { has: () => true } : new Set(o.lazy || []), views = Object.create(null), thumbs = [], profileAsks = [];
  const memberEv = (id, u, membership) => {
    const content = { membership };
    const p = pics[id] && pics[id][u];
    if (p) content.avatar_url = p;
    return { getType: () => "m.room.member", getContent: () => content, getPrevContent: () => ({}), getSender: () => u, getStateKey: () => u, getRoomId: () => id, getTs: () => 1000 };
  };
  const wrap = (v) => {
    if (!v) return v;
    if (views[v.roomId]) return views[v.roomId];
    const id = v.roomId;
    const partial = () => lazy.has(id) && v.getMyMembership() === "join" && !loaded.has(id);
    const shown = (u) => !partial() || u === me;
    return (views[id] = Object.assign(Object.create(v), {
      roomId: id,
      getMyMembership: () => v.getMyMembership(),
      getMember: (u) => (shown(u) ? v.getMember(u) : null),
      currentState: { getStateEvents: (type, key) => {
        if (type !== "m.room.member") return v.currentState.getStateEvents(type, key);
        const ms = hs.rooms[id] ? hs.rooms[id].members : {};
        if (key !== undefined) return (ms[key] && shown(key)) ? memberEv(id, key, ms[key]) : null;
        return Object.keys(ms).filter(shown).map((u) => memberEv(id, u, ms[u]));
      } },
      membersLoaded: () => !partial(),
      loadMembersIfNeeded: () => { loads.push(id); return new Promise((res) => setImmediate(() => { loaded.add(id); res(true); })); },
    }));
  };
  const client = {
    getRoom: (id) => wrap(base.client.getRoom(id)), getRooms: () => base.client.getRooms().map(wrap),
    getProfileInfo: (u) => { profileAsks.push(u); return o.profile ? o.profile(u) : Promise.resolve({ avatar_url: (o.profiles || {})[u] || null }); },
    startClient: async () => {}, initRustCrypto: async () => {}, getCrypto: () => ({}),
    mxcUrlToHttp: (mxc) => { thumbs.push(mxc); return "http://thumb/" + mxc.replace("mxc://", ""); },
  };
  return { client, loads, loaded, thumbs, profileAsks };
}
const OPEN = "!open:hs";
function pictureWorld(o) {
  o = o || {};
  const hs = W.homeserver();
  const R = hs.ddjpRoom(OPEN, { mode: "backend2", levels: { [W.ME]: 0 } });
  const chans = Object.values(R.ch).filter((id) => !W.INVITE_ONLY[Object.keys(R.ch).find((k) => R.ch[k] === id)]);
  for (const id of [OPEN].concat(chans)) { hs.rooms[id].members[W.ME] = "join"; hs.rooms[id].members["@ann:hs"] = "join"; }
  hs.room("!other:hs", { name: "other", members: { [W.ME]: "join", "@ann:hs": "join" } });
  const pics = Object.create(null);
  for (const id of [OPEN].concat(chans)) pics[id] = { "@ann:hs": "mxc://hs/ann-room", [W.ME]: "mxc://hs/me-room" };
  pics["!other:hs"] = { "@ann:hs": "mxc://hs/ann-other" };
  const pc = pictureClient(hs, W.ME, pics, Object.assign({ profiles: { "@ann:hs": "mxc://hs/ann-profile", "@zed:hs": "mxc://hs/zed-profile" } }, o));
  const w = W.inviteWorld({ hs, client: pc.client });
  try { w.sb.MatrixAccount.initCrypto = async () => false; } catch (e) {}
  // The open room's rooms in scope, as the opening sets them (`setRoomScope`).
  const scope = {}; chans.forEach((id, i) => { scope["c" + i] = id; });
  w.MB.setRoomScope(scope);
  const heard = [];
  w.MA.onAvatarChange((u) => heard.push(u));
  // A member event as the SDK hands it to "RoomState.members": (event, state, member).
  const deliver = (roomId, u, avatar, prevAvatar) => {
    const content = { membership: "join" }; if (avatar) content.avatar_url = avatar;
    const prev = prevAvatar === undefined ? null : Object.assign({ membership: "join" }, prevAvatar ? { avatar_url: prevAvatar } : {});
    if (pics[roomId]) { if (avatar) pics[roomId][u] = avatar; else delete pics[roomId][u]; }
    const ev = { getType: () => "m.room.member", getContent: () => content, getPrevContent: () => (prev || {}), getStateKey: () => u, getSender: () => u, getRoomId: () => roomId };
    for (const fn of (w.listeners["RoomState.members"] || [])) { try { fn(ev, {}, { userId: u, roomId }); } catch (e) { w.logs.push("error: " + e.message); } }
  };
  return Object.assign(pc, { w, hs, pics, chans, deliver, heard });
}
// The real start(): it wires the picture listeners (`_watchAvatarChanges`), as the app's does.
async function pictureWorldStarted(o) {
  const x = pictureWorld(o);
  try { await x.w.MB.start(); } catch (e) { x.w.logs.push("error: start() — " + ((e && e.message) || e)); }
  return x;
}
const url = (w, u) => w.MA.getAvatarUrl(u);

async function partA() {
  // A1 — the picture shown is the member event's, from a room whose members are held; the profile is not asked.
  {
    const x = await pictureWorldStarted();
    url(x.w, "@ann:hs"); await settle();
    ok(url(x.w, "@ann:hs") === "http://thumb/hs/ann-room" && x.profileAsks.indexOf("@ann:hs") < 0,
      "A1: THE PICTURE SHOWN IS THE MEMBER EVENT'S — from the open room, whose members are held; the profile is not asked", { url: url(x.w, "@ann:hs"), asked: x.profileAsks });
    ok(x.loads.length === 0 && (x.w.MB._earlyReadsForTest ? x.w.MB._earlyReadsForTest() : []).length === 0,
      "A1: and the read asked no room's members and was no early read", { loads: x.loads });
    url(x.w, x.w.me); await settle();
    ok(url(x.w, x.w.me) === "http://thumb/hs/me-room", "A1: your own picture the same way — your member event", url(x.w, x.w.me));
    // A2 — a member event carrying a new picture, on "RoomState.members"
    x.heard.length = 0;
    x.deliver(OPEN, "@ann:hs", "mxc://hs/ann-new", "mxc://hs/ann-room"); await settle();
    ok(url(x.w, "@ann:hs") === "http://thumb/hs/ann-new" && x.heard.indexOf("@ann:hs") >= 0,
      "A2: A MEMBER EVENT THAT CHANGES THE PICTURE SWAPS IT — delivered as the SDK delivers it, on \"RoomState.members\" — and the screen is told", { url: url(x.w, "@ann:hs"), heard: x.heard });
    // A3 — the same change from the person's other rooms: fetched once
    const thumbsBefore = x.thumbs.length;
    for (const id of x.chans) x.deliver(id, "@ann:hs", "mxc://hs/ann-new", "mxc://hs/ann-room");
    await settle();
    ok(x.thumbs.length === thumbsBefore, "A3: THE SAME CHANGE ARRIVING FROM EVERY ROOM THE PERSON IS IN IS FETCHED ONCE", { more: x.thumbs.length - thumbsBefore });
    // A4 — another room's own picture, unchanged there, does not flip it
    x.deliver("!other:hs", "@ann:hs", "mxc://hs/ann-other", "mxc://hs/ann-other"); await settle();
    ok(url(x.w, "@ann:hs") === "http://thumb/hs/ann-new", "A4: A PICTURE OF THEIR OWN IN ANOTHER ROOM, UNCHANGED THERE, DOES NOT FLIP THE ONE SHOWN", url(x.w, "@ann:hs"));
    // A5 — removed: initials
    x.heard.length = 0;
    x.deliver(OPEN, "@ann:hs", null, "mxc://hs/ann-new"); await settle();
    ok(url(x.w, "@ann:hs") === null && x.heard.indexOf("@ann:hs") >= 0, "A5: A PICTURE REMOVED — initials (null), and the screen is told", { url: url(x.w, "@ann:hs"), heard: x.heard });
    // A6 — a person in no shared room keeps the profile lookup
    url(x.w, "@zed:hs"); await settle();
    ok(url(x.w, "@zed:hs") === "http://thumb/hs/zed-profile" && x.profileAsks.indexOf("@zed:hs") >= 0,
      "A6: A PERSON IN NO SHARED ROOM (a DM search's suggestion) KEEPS THE PROFILE LOOKUP", { url: url(x.w, "@zed:hs"), asked: x.profileAsks });
    // A7 — no presence listener left; the member-state one wired
    const ls = Object.keys(x.w.listeners);
    ok(ls.indexOf("RoomState.members") >= 0 && ls.indexOf("User.avatarUrl") < 0 && ls.indexOf("RoomMember.avatarUrl") < 0,
      "A7: THE APP LISTENS ON \"RoomState.members\" — and no longer on \"User.avatarUrl\" (presence) or \"RoomMember.avatarUrl\" (no such event)", ls);
  }
  // A8 — THE OPENING: a picture shown before the room's members land is the profile's; when they land, the member's.
  {
    // every room's members on request, none loaded yet
    const y = await pictureWorldStarted({ lazy: "*" });
    const all = [OPEN].concat(y.chans, ["!other:hs"]);
    url(y.w, "@ann:hs"); await settle();
    ok(url(y.w, "@ann:hs") === "http://thumb/hs/ann-profile" && y.loads.length === 0,
      "A8: BEFORE THE ROOM'S MEMBERS LAND, THE PICTURE IS THE PROFILE'S — AND ITS READ ASKED NO ROOM'S LOAD", { url: url(y.w, "@ann:hs"), loads: y.loads });
    y.heard.length = 0;
    for (const id of all) y.loaded.add(id);
    y.deliver(OPEN, "@ann:hs", "mxc://hs/ann-room");   // the opening's load, landing: each member it brings, on "RoomState.members"
    await settle();
    ok(url(y.w, "@ann:hs") === "http://thumb/hs/ann-room" && y.heard.indexOf("@ann:hs") >= 0,
      "A8: ONCE THE ROOM'S MEMBERS LAND, THE PICTURE SHOWN IS THE LOADED MEMBER'S", { url: url(y.w, "@ann:hs"), heard: y.heard });
  }
  // A9 — a profile answer arriving after the member's picture does not take it back.
  {
    let answer = null;
    const z = await pictureWorldStarted({ lazy: "*", profile: () => new Promise((res) => { answer = res; }) });
    url(z.w, "@ann:hs"); await settle();
    for (const id of [OPEN].concat(z.chans, ["!other:hs"])) z.loaded.add(id);
    z.deliver(OPEN, "@ann:hs", "mxc://hs/ann-room"); await settle();
    if (answer) answer({ avatar_url: "mxc://hs/ann-profile" });
    await settle();
    ok(url(z.w, "@ann:hs") === "http://thumb/hs/ann-room", "A9: A PROFILE ANSWER ARRIVING AFTER THE MEMBER'S PICTURE DOES NOT TAKE IT BACK", url(z.w, "@ann:hs"));
  }
}

// ── U — EVERYWHERE IT IS SHOWN ───────────────────────────────────────────────────────────────────────────────────────────────
async function partU() {
  const NOW = 1.9e12, ME = "@me:hs", ANN = "@ann:hs";
  const pics = { [ANN]: "blob:old-ann", [ME]: "blob:old-me" };
  const fns = [];
  const L = {};
  const listen = (n) => (fn) => { (L[n] = L[n] || []).push(fn); };
  const np = { dj: ANN, song: { songKey: "NOWPLAYING1" }, pi: "p0", startedAt: NOW - 10000 };
  const features = {
    Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "uncategorized", level: 0 }], getMyId: () => ME, getCurrent: () => ({ spaceId: "!s:hs", roomId: "!r:hs" }),
      getRoster: () => [{ userId: ANN, name: "ann", level: 0 }, { userId: ME, name: "me", level: 0 }], onRankChange: listen("rank"), onMembersChange: listen("members"),
      peopleOrder: (fold, roster) => roster.map((m) => ({ member: m, active: null })), getMyRank: () => 0, getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }) },
    Queue: { onStateChange: listen("queue"), onHistoryChange: listen("history"), getNowPlaying: () => np, getRotation: () => [],
      getState: () => ({ counts: {}, rotation: [], nowPlaying: np }), recentHistory: () => [], historyReach: () => ({ entries: 0, complete: true }) },
    Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: () => Promise.resolve({ ok: true }) },
    ServerClock: { serverNow: () => NOW },
    Media: { getAvatarUrl: (u) => pics[u] || null, onAvatarChange: (fn) => { fns.push(fn); }, offAvatarChange() {} },
    ChatPrefs: { playerHidden: () => false, overlayBlocked: () => false, tierList: () => [], layout: () => "wide", load() {}, onChange: listen("prefs") },
    Chat: { conversations: () => [{ userId: ANN, roomIds: ["!dm1:hs"], roomId: "!dm1:hs", lastTs: NOW - 5000, unread: false }], dmUnreadCount: () => 0,
      setDMVisible() {}, clearConversations() {}, forgetConversation() {}, closeDM() {}, dmAnswering: () => false,
      onDMRedaction: listen("x"), onDMMessage: listen("x"), onDMNotify: listen("x"), onDMChange: listen("x"), onMessage: listen("x"), onRedaction: listen("x") },
  };
  const w = SW.world({ features, domShaped: true, clock: NOW });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  let entry = null;
  try { w.sb.Screens.enterMainScreen({ roomId: "!r:hs", spaceId: "!s:hs", name: "Pictures" }); } catch (e) { entry = String(e && e.message); }
  const tryIt = (f) => { try { f(); } catch (e) { return String(e && e.message); } return null; };
  const errs = [tryIt(() => w.sb.Roster.renderRoster()), tryIt(() => w.sb.Player.renderNowPlaying()), tryIt(() => w.sb.ChatPanels.renderDMPanel()),
    tryIt(() => { const r = w.sb.ChatPanels._chatRow(w.refs.chatBox, { id: "$c1", sender: ANN, body: "hi", ts: NOW - 1000 }); if (r) w.refs.chatBox.appendChild(r); }),
    tryIt(() => w.sb.Roster.openUserCard({ userId: ANN, name: "ann", level: 0 }))].filter(Boolean);
  const where = () => {
    const pic = (box) => { if (!box) return null; const n = box.querySelector("img"); return n ? n.attrs.src || n.src : null; };
    const person = Array.from(w.refs.rosterBox.querySelectorAll(".person")).find((p) => /ann/.test(p.textContent));
    const dmRow = w.refs.dmBox ? w.refs.dmBox.querySelector(".dm-list .dm-row") : null;
    const chatRow = w.refs.chatBox ? Array.from(w.refs.chatBox.querySelectorAll(".chat-av")).pop() : null;
    const card = w.doc.body.querySelector(".uc-av");
    return { people: pic(person), dm: pic(dmRow), chat: pic(chatRow), player: pic(w.refs.npLabel), card: pic(card), own: pic(w.refs.myAvatarSlot) };
  };
  const before = where();
  ok(entry === null && fns.length > 0 && before.people === "blob:old-ann" && before.dm === "blob:old-ann" && before.chat === "blob:old-ann" && before.player === "blob:old-ann" &&
     before.card === "blob:old-ann" && before.own === "blob:old-me",
    "U PREMISE — the main screen built by the real code: ann's picture in People, the DM list, a chat row, the player's line and her card, and your own in the top bar", { entry, errs, before, listeners: fns.length });
  pics[ANN] = "blob:new-ann";
  for (const fn of fns.slice()) { try { fn(ANN); } catch (e) { errs.push("listener: " + e.message); } }
  const after = where();
  ok(after.people === "blob:new-ann", "U: ONE CHANGE REACHES PEOPLE'S ROW", after);
  ok(after.dm === "blob:new-ann", "U: AND THE DM LIST'S ROW", after);
  ok(after.chat === "blob:new-ann" && after.player === "blob:new-ann", "U: AND A CHAT ROW AND THE PLAYER'S LINE", after);
  ok(after.card === "blob:new-ann", "U: AND AN OPEN CARD", after);
  pics[ME] = "blob:new-me";
  for (const fn of fns.slice()) { try { fn(ME); } catch (e) { errs.push("listener: " + e.message); } }
  ok(where().own === "blob:new-me", "U: AND YOUR OWN PICTURE", where());
  ok(errs.length === 0, "U: nothing threw", errs);
}

(async () => {
  for (const [name, fn] of [["S", partS], ["A", partA], ["U", partU]]) {
    try { await fn(); } catch (e) { ok(false, name + " threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[picture-path] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[picture-path] PASS — a picture change reaches the app through the room (`ddjp_700`, JOB 1; " + asserts + " assertions): run " +
    "against matrix-js-sdk 41.8.0 itself, a member event whose picture changed raises \"RoomState.events\" and \"RoomState.members\" only — " +
    "not \"RoomMember.membership\" (its membership did not change), not \"User.avatarUrl\" (that comes from presence), and \"RoomMember.avatarUrl\" " +
    "is no event of the SDK — and a room's members loaded on request raise \"RoomState.members\" for each. The app's pictures are the member " +
    "events' (a room whose members are held, the open room's first, asking no load), swapped on \"RoomState.members\", once for a change from " +
    "every room, not flipped by another room's own picture, the profile's giving way when the opening's members land; a person in no shared " +
    "room keeps the profile lookup; no presence listener left; and one change reaches People, the DM list, chat, the player's line, a card and " +
    "your own picture");
  process.exit(0);
})();
