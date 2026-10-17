// tests/check-rep-ports.js
// SUBJECT: features/rep-ports.js, backends/backend1/matrixbridge.js, backends/backend1/capabilities.js, core/store.js
//
// WALL: EVERY PORT REP REACHES THE APP THROUGH EXISTS, PASSES ITS CALL THROUGH, AND THE HOOKS BEHIND THEM DO WHAT THEY
// SAY (J84, the owner's ruling 21; hooks E3–E6). The ports are REP's whole boundary, so a port that pointed at nothing
// would be a hole nobody sees until a piece calls it; and the generic hooks they reach are new, so they are driven here
// against the real modules rather than trusted.
//
//   A  THE LIST: `RepPorts.PORTS` is exactly the functions it exports.
//   B  EVERY PORT IS A PASS-THROUGH: driven against a recording stub of each module, each reaches the one function it
//      names with its arguments unchanged — and with no module loaded at all, every port answers safely (an empty list,
//      null, false, a refused promise), never a throw.
//   C  E3 `readChannelBack`: one channel, back to a time, top-level events only (a relay batch is one event, never
//      unpacked), each with its sender's level; nothing older than the window; a channel outside the running room's
//      scope is not read.
//   D  E4 `pageRange`'s stops: `kinds` reads only the `events-*` channels; `notBeforeTs` drops and stops at older
//      events; called without options it answers exactly as before.
//   E  E5 through the port: the room's owner may command the bot; the bot (99) may not.
//   F  E6 `Store.rep`: the table and the bot-only settings round-trip per room; a non-object is refused; the writer lock
//      is granted once per room and refused to a second asker; with no Web Locks the caller is told so (`null`).
//   G  `Rep`, THE APP'S ONE ENTRY (J84-2, J84-3, J84-5): `enter` and `leave` reach the reader and the bot side, `badge` the
//      reader alone, `botCard` the bot side alone, read at call time; with no piece loaded all four are no-ops, never a
//      throw; and `Rep` decides nothing.
"use strict";
const { loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-ports] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const noop = () => {};

// ── A — THE LIST ────────────────────────────────────────────────────────────────────────────────────────────────────
const bare = loadInContext(["features/rep-ports.js"], {}).RepPorts;
{
  const exported = Object.keys(bare).filter((k) => k !== "PORTS" && typeof bare[k] === "function").sort();
  ok(Array.isArray(bare.PORTS) && JSON.stringify(bare.PORTS.slice().sort()) === JSON.stringify(exported),
    "A: `PORTS` lists exactly the ports the object exports — none unlisted, none listed without existing",
    { listed: bare.PORTS, exported: exported });
  ok(exported.length >= 25, "A: APPLIED — the boundary has its ports", exported.length);
}

// ── B — EVERY PORT IS A PASS-THROUGH ────────────────────────────────────────────────────────────────────────────────
async function partB() {
  const calls = [];
  const rec = (mod, fn, ret) => function () { calls.push(mod + "." + fn + "(" + JSON.stringify(Array.from(arguments).filter((a) => typeof a !== "function")) + ")"); return typeof ret === "function" ? ret.apply(null, arguments) : ret; };
  const stubs = {
    StreamManager: { on: rec("SM", "on"), off: rec("SM", "off"), getLog: rec("SM", "getLog", [{ eventId: "$e" }]), isLegal: rec("SM", "isLegal", true),
      getState: rec("SM", "getState", { settings: { repSummaryMs: 600000 }, nowPlaying: { pi: "$np", dj: "@a:hs", song: {} } }),
      holdsWholeRoom: rec("SM", "holdsWholeRoom", true), heldFrom: rec("SM", "heldFrom", 41) },
    MatrixBridge: { roomHistory: rec("MB", "roomHistory", [{ pi: "$p1", dj: "@a:hs", l: 5, videoId: "v" }, { pi: null }]),
      historyCoverage: rec("MB", "historyCoverage", { ranges: [] }), backfillHistory: rec("MB", "backfillHistory", "bf"),
      pageRange: rec("MB", "pageRange", Promise.resolve(["r"])), onRawEvent: rec("MB", "onRawEvent"), offRawEvent: rec("MB", "offRawEvent"),
      readChannelBack: rec("MB", "readChannelBack", Promise.resolve(["c"])), sendSide: rec("MB", "sendSide", Promise.resolve({ ok: true })),
      getUserEffectiveRank: rec("MB", "getUserEffectiveRank", 60), getUserId: rec("MB", "getUserId", "@me:hs"),
      mayAuthor: rec("MB", "mayAuthor", { ok: true, reason: null }) },
    Capabilities: { can: rec("CAP", "can", { permitted: true }) },
    Room: { onSettingsChange: rec("RM", "onSettingsChange"), presenceView: rec("RM", "presenceView", { people: [] }), chatTiers: rec("RM", "chatTiers", { tiers: [] }),
      peopleViewChanged: rec("RM", "peopleViewChanged"), getCurrent: rec("RM", "getCurrent", { name: "Test Room", spaceId: "!s" }) },
    Chat: { onMessage: rec("CH", "onMessage"), sendTo: rec("CH", "sendTo", Promise.resolve({ ok: true })) },
    ServerClock: { serverNow: rec("SC", "serverNow", 1234) },
    Store: { rep: { load: rec("ST", "load", Promise.resolve({ a: 1 })), save: rec("ST", "save", Promise.resolve(true)),
      loadPrefs: rec("ST", "loadPrefs", Promise.resolve({ w: 1 })), savePrefs: rec("ST", "savePrefs", Promise.resolve(true)),
      writerLock: rec("ST", "writerLock", Promise.resolve(true)) } },
    BotRuntime: { actingAsBot: rec("BR", "actingAsBot", true) },
    Logger: { info: rec("LG", "info"), warn: rec("LG", "warn") },
  };
  const P = loadInContext(["features/rep-ports.js"], stubs).RepPorts;
  const ch = { events_owner: "!own" };
  const fn = function () {};
  P.onReactions(fn); P.offReactions(fn);
  ok(calls.filter((c) => /^SM\.on\(/.test(c)).length === 2 && calls.indexOf('SM.on(["ddjp.dj.vote"])') >= 0 && calls.indexOf('SM.on(["ddjp.dj.save"])') >= 0,
    "B: onReactions subscribes the vote and the save, and nothing else", calls);
  ok(calls.filter((c) => /^SM\.off\(/.test(c)).length === 2, "B: offReactions unsubscribes both", calls);
  ok(JSON.stringify(P.heldLog()) === JSON.stringify([{ eventId: "$e" }]) && P.isLegal("$e") === true, "B: heldLog and isLegal pass through");
  ok(JSON.stringify(P.playings(10)) === JSON.stringify([{ pi: "$p1", dj: "@a:hs", l: 5 }]) && calls.indexOf("MB.roomHistory([10])") >= 0,
    "B: playings reads song history's rows as { pi, dj, l } and drops a row with no playing", P.playings(10));
  ok(P.historyCoverage().ranges && P.backfillHistory() === "bf", "B: historyCoverage and backfillHistory pass through");
  // J84-2's three: the current playing (its play instance only), whether this tab holds the room from its start, and
  // whether it is caught up enough to say anything.
  ok(JSON.stringify(P.nowPlaying()) === JSON.stringify({ pi: "$np" }), "B: nowPlaying reads the reducer's current playing, as its play instance alone", P.nowPlaying());
  ok(P.holdsWholeRoom() === true && calls.indexOf("SM.holdsWholeRoom([])") >= 0, "B: holdsWholeRoom asks the engine whether this tab holds the room from its start");
  ok(P.mayAuthor() === true && calls.indexOf("MB.mayAuthor([])") >= 0, "B: mayAuthor asks the transport whether this tab is caught up enough to say anything");
  // J84-3's one: where the held log starts being complete — a position, `null` (nothing forgotten), or `undefined` when
  // the engine cannot say, which the reader treats as "cannot show", never as "holds everything".
  ok(P.heldFrom() === 41 && calls.indexOf("SM.heldFrom([])") >= 0, "B: heldFrom asks the engine where the held log starts being complete");
  // J84-5: the running room's name, for an export file and its preview.
  ok(P.roomName() === "Test Room" && calls.indexOf("RM.getCurrent([])") >= 0, "B: roomName reads the running room's name", P.roomName());
  // J84-4 (the owner's ruling 35): the reader's "what I show moved" reaches the feature layer's generic signal, and only that.
  P.peopleChanged();
  ok(calls.indexOf("RM.peopleViewChanged([])") >= 0, "B: peopleChanged raises the feature layer's generic \"the people view changed\" (ruling 35)", calls.filter((c) => /^RM/.test(c)));
  {
    const H = (v) => loadInContext(["features/rep-ports.js"], { StreamManager: { heldFrom: () => v } }).RepPorts.heldFrom();
    const thr = loadInContext(["features/rep-ports.js"], { StreamManager: { heldFrom: () => { throw new Error("x"); } } }).RepPorts.heldFrom();
    ok(H(null) === null && H(7) === 7 && H("7") === undefined && H(NaN) === undefined && thr === undefined,
      "B: and passes a position or `null` through, and anything else — a throw included — as `undefined` (cannot say)", [H(null), H(7), H("7"), thr]);
  }
  const pr = await P.pageReactions(3, 9, 1000);
  ok(pr[0] === "r" && calls.indexOf('MB.pageRange([3,9,{"kinds":["events"],"notBeforeTs":1000}])') >= 0,
    "B: pageReactions asks for the events channels only, with the time stop", calls.filter((c) => /pageRange/.test(c)));
  P.onRaw(fn); P.offRaw(fn);
  ok(calls.some((c) => /^MB\.onRawEvent/.test(c)) && calls.some((c) => /^MB\.offRawEvent/.test(c)), "B: onRaw and offRaw pass through");
  const cb = await P.readOwnerChannelBack(ch, 500);
  ok(cb[0] === "c" && calls.indexOf('MB.readChannelBack([{"events_owner":"!own"},"events_owner",500])') >= 0,
    "B: readOwnerChannelBack reads the owner-level channel back to the time given", calls.filter((c) => /readChannelBack/.test(c)));
  const ss = await P.sendSide(ch, "ddjp.side.x", { v: 1 });
  ok(ss.ok === true && calls.indexOf('MB.sendSide([{"events_owner":"!own"},"ddjp.side.x",{"v":1}])') >= 0, "B: sendSide passes through unchanged");
  ok(P.settings().repSummaryMs === 600000, "B: settings reads the room's current settings");
  P.onSettingsChange(fn); P.onChat(fn);
  ok(calls.some((c) => /^RM\.onSettingsChange/.test(c)) && calls.some((c) => /^CH\.onMessage/.test(c)), "B: onSettingsChange and onChat pass through");
  ok(P.whoIsActive(77) && calls.indexOf("RM.presenceView([77])") >= 0, "B: whoIsActive asks the one shared function, `Room.presenceView`, with the time");
  const sc = await P.sendChat("!tier", "hello");
  ok(sc.ok === true && calls.indexOf('CH.sendTo(["!tier","hello"])') >= 0, "B: sendChat replies to the tier given");
  ok(P.chatTiers() && P.myId() === "@me:hs" && P.serverNow() === 1234 && P.actingAsBot() === true,
    "B: chatTiers, myId, serverNow and actingAsBot pass through");
  ok(P.mayCommand(100) === true && calls.some((c) => c.indexOf('CAP.can(["bot.command",{},{"myRank":100}])') === 0),
    "B: mayCommand asks the capability verb `bot.command` with the level given", calls.filter((c) => /CAP/.test(c)));
  ok(P.levelOf("!s", ch, "@u:hs") === 60 && calls.indexOf('MB.getUserEffectiveRank(["!s",{"events_owner":"!own"},"@u:hs"])') >= 0,
    "B: levelOf reads the authority level across the Space and its channels");
  const sl = await P.storeLoad("!s"), sv = await P.storeSave("!s", { x: 1 }), pl = await P.prefsLoad("!s"), ps = await P.prefsSave("!s", { w: 2 }), wl = await P.writerLock("!s", fn);
  ok(sl.a === 1 && sv === true && pl.w === 1 && ps === true && wl === true &&
     ["ST.load([\"!s\"])", "ST.save([\"!s\",{\"x\":1}])", "ST.loadPrefs([\"!s\"])", "ST.savePrefs([\"!s\",{\"w\":2}])", "ST.writerLock([\"!s\"])"].every((c) => calls.indexOf(c) >= 0),
    "B: the five storage ports reach `Store.rep` with their arguments", calls.filter((c) => /^ST/.test(c)));
  P.log("info", "hello");
  ok(calls.indexOf('LG.info(["REP: hello"])') >= 0, "B: log writes one line prefixed `REP: `", calls.filter((c) => /^LG/.test(c)));

  // AND WITH NOTHING LOADED, EVERY PORT ANSWERS SAFELY.
  const N = bare;
  let threw = null;
  try {
    N.onReactions(fn); N.offReactions(fn); N.onRaw(fn); N.offRaw(fn); N.onSettingsChange(fn); N.onChat(fn); N.log("info", "x"); N.peopleChanged();
    ok(JSON.stringify(N.heldLog()) === "[]" && N.isLegal("$x") === null && JSON.stringify(N.playings()) === "[]" &&
       N.historyCoverage() === null && N.backfillHistory() === null && N.settings() === null && N.whoIsActive(1) === null &&
       N.chatTiers() === null && N.mayCommand(100) === false && N.levelOf("!s", {}, "@u") === 0 && N.myId() === null &&
       N.serverNow() === null && N.actingAsBot() === false && N.nowPlaying() === null && N.holdsWholeRoom() === null && N.heldFrom() === undefined && N.mayAuthor() === false && N.roomName() === null,
      "B: with no module loaded, every synchronous port answers safely — empty, null, false or 0");
    const res = await Promise.all([N.pageReactions(0, 1, 0), N.readOwnerChannelBack({}, 0), N.sendSide({}, "ddjp.side.x", {}),
      N.sendChat("!t", "x"), N.storeLoad("!s"), N.storeSave("!s", {}), N.prefsLoad("!s"), N.prefsSave("!s", {}), N.writerLock("!s", fn)]);
    ok(JSON.stringify(res) === JSON.stringify([[], [], { ok: false, reason: "no transport" }, { ok: false, reason: "no chat" }, null, false, null, false, null]),
      "B: and every asynchronous one resolves to an empty or refused answer", res);
  } catch (e) { threw = e; }
  ok(threw === null, "B: and none throws", threw && String(threw));
}

// ── C, D — THE TWO READERS, against a fake client ───────────────────────────────────────────────────────────────────
function raw(id, ts, sender, body) {
  return { event_id: id, type: "m.room.message", sender: sender, room_id: "!own", origin_server_ts: ts,
    content: { msgtype: "m.text", body: JSON.stringify(body) } };
}
function fakeRoom(id, name, events, older, users) {
  const r = { roomId: id, name: name, timeline: events.map((e) => ({ event: e })), findEventById: () => null, _older: (older || []).slice(),
    currentState: { getStateEvents: (type) => type === "m.room.power_levels" ? { getContent: () => ({ users: users || {}, users_default: 0, events: { "m.room.message": 0 } }) } : null } };
  return r;
}
function bridgeWith(rooms) {
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js"], {
    Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined, matrixcs: {}, navigator: {} });
  const byId = {}; for (const r of rooms) byId[r.roomId] = r;
  let scrolls = 0;
  sb.MatrixBridge._setClientForTest({ getUserId: () => "@me:hs", getRoom: (id) => byId[id] || null, getRooms: () => rooms,
    scrollback: async (room) => { scrolls++; const batch = room._older.splice(-3, 3); room.timeline = batch.map((e) => ({ event: e })).concat(room.timeline); } });
  return { MB: sb.MatrixBridge, scrolls: () => scrolls };
}
async function partC() {
  const now = 100000;
  const recent = [raw("$a", now - 1000, "@bot:hs", { t: "ddjp.side.rep.summary", l: 50, v: 1 }),
    raw("$b", now - 500, "@bot:hs", { t: "ddjp.batch", l: 51, evs: [{ t: "ddjp.dj.vote", p: "$p", actor: "@x:hs" }, { t: "ddjp.side.rep.add", actor: "@x:hs" }] }),
    raw("$c", now - 100, "@owner:hs", { t: "ddjp.dj.join", l: 52, v: "S" })];
  const older = [raw("$o1", now - 90000, "@bot:hs", { t: "ddjp.side.rep.summary", l: 10, v: 1 }), raw("$o2", now - 60000, "@bot:hs", { t: "ddjp.side.rep.add", l: 20 }),
    raw("$o3", now - 30000, "@bot:hs", { t: "ddjp.side.rep.summary", l: 30, v: 1 })];
  const own = fakeRoom("!own", "events-owner", recent, older, { "@bot:hs": 99, "@owner:hs": 100 });
  const B = bridgeWith([own]);
  const ch = { events_owner: "!own" };
  const none = await B.MB.readChannelBack(ch, "events_owner", now - 40000);
  ok(none.length === 0 && none.ok === false, "C: a channel outside the running room's scope is not read (ruling 14)", none.length);
  B.MB.setRoomScope(ch);
  const out = await B.MB.readChannelBack(ch, "events_owner", now - 40000);
  ok(out.ok === true, "C: APPLIED — read", out.ok);
  const ids = out.map((e) => e.id);
  ok(JSON.stringify(ids) === JSON.stringify(["$o3", "$a", "$b", "$c"]), "C: everything since the time given, oldest first, and nothing older", ids);
  ok(B.scrolls() >= 1 && out.pages >= 1, "C: it paged back to reach the window", { scrolls: B.scrolls(), pages: out.pages });
  const b = out.find((e) => e.id === "$b");
  ok(b && b.type === "ddjp.batch" && out.filter((e) => e.type === "ddjp.side.rep.add").length === 0,
    "C: a relay batch is ONE event, never unpacked — a side type inside it does not pass as its carrier's own", out.map((e) => e.type));
  const a = out.find((e) => e.id === "$a"), c = out.find((e) => e.id === "$c");
  ok(a && a.sender === "@bot:hs" && a.senderLevel === 99 && a.l === 50 && a.body && a.body.v === 1 && c && c.senderLevel === 100,
    "C: each with its Matrix sender, that sender's level in the channel, its position and its body", [a, c]);
  const far = await bridgeWith([fakeRoom("!own", "events-owner", recent, older, { "@bot:hs": 99 })]);
  far.MB.setRoomScope(ch);
  const all = await far.MB.readChannelBack(ch, "events_owner", 0);
  ok(all.length === 6 && all.complete === true, "C: and back to the channel's start when the window reaches it, saying so", { n: all.length, complete: all.complete });
}
async function partD() {
  const ev = (id, room, l, ts) => ({ event_id: id, type: "m.room.message", sender: "@a:hs", room_id: room, origin_server_ts: ts,
    content: { body: JSON.stringify({ l: l, t: "ddjp.dj.vote", p: "$p" }) } });
  const mk = () => [fakeRoom("!e", "events-player", [ev("$e1", "!e", 1, 1000), ev("$e2", "!e", 2, 5000), ev("$e3", "!e", 3, 9000)]),
    fakeRoom("!k", "checkpoints-owner", [ev("$k1", "!k", 2, 5000)]), fakeRoom("!s", "settings-owner", [ev("$s1", "!s", 3, 9000)])];
  const plain = bridgeWith(mk()); plain.MB.setRoomScope({ a: "!e", b: "!k", c: "!s" });
  const p0 = await plain.MB.pageRange(0, 99);
  ok(JSON.stringify(p0.map((e) => e.eventId)) === JSON.stringify(["$e1", "$e2", "$k1", "$e3", "$s1"]),
    "D: without options, every spine channel in scope, as before (the control)", p0.map((e) => e.eventId));
  const k = bridgeWith(mk()); k.MB.setRoomScope({ a: "!e", b: "!k", c: "!s" });
  const p1 = await k.MB.pageRange(0, 99, { kinds: ["events"] });
  ok(JSON.stringify(p1.map((e) => e.eventId)) === JSON.stringify(["$e1", "$e2", "$e3"]), "D: `kinds: [\"events\"]` reads the events channels only", p1.map((e) => e.eventId));
  const t = bridgeWith(mk()); t.MB.setRoomScope({ a: "!e", b: "!k", c: "!s" });
  const p2 = await t.MB.pageRange(0, 99, { notBeforeTs: 4000 });
  ok(JSON.stringify(p2.map((e) => e.eventId)) === JSON.stringify(["$e2", "$k1", "$e3", "$s1"]), "D: `notBeforeTs` drops what is older than the time", p2.map((e) => e.eventId));
  ok(p2.reachedFrom >= 2, "D: and says the read did not reach the room's older positions", p2.reachedFrom);
}

// ── E — E5 THROUGH THE PORT, WITH THE REAL CAPABILITIES ─────────────────────────────────────────────────────────────
{
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/rep-ports.js"], {});
  ok(sb.RepPorts.mayCommand(100) === true, "E: the room's owner (100, above the ladder) may command the bot");
  ok(sb.RepPorts.mayCommand(99) === false && sb.RepPorts.mayCommand(80) === false && sb.RepPorts.mayCommand(0) === false,
    "E: the bot (99), high staff and a guest may not");
}

// ── F — E6 `Store.rep` ──────────────────────────────────────────────────────────────────────────────────────────────
async function partF() {
  const mem = new Map();
  const IDB = { supported: () => true, currentNamespace: () => "@bot:hs",
    keyFor: (scope, domain, id) => (scope && scope.room ? "r:" + scope.room + ":" : "u:") + domain + ":" + id,
    get: (store, key) => Promise.resolve(mem.has(store + "|" + key) ? JSON.parse(mem.get(store + "|" + key)) : undefined),
    set: (store, key, v) => { mem.set(store + "|" + key, JSON.stringify(v)); return Promise.resolve(); },
    del: (store, key) => { mem.delete(store + "|" + key); return Promise.resolve(); } };
  const held = new Set();
  const locks = { request: (name, opts, cb) => { if (held.has(name)) return Promise.resolve(cb(null)); held.add(name); return Promise.resolve(cb({ name: name })); } };
  const S = loadInContext(["core/store.js"], { IDB: IDB, StorageIO: { load: () => null, save: noop }, navigator: { locks: locks } }).Store;
  ok(!!S.rep, "F: APPLIED — `Store.rep` exists");
  ok(await S.rep.save("!r1", { people: { "@a:hs": [1, 2] } }) === true && await S.rep.save("!r2", { people: {} }) === true, "F: a table saves per room");
  const t1 = await S.rep.load("!r1"), t2 = await S.rep.load("!r2");
  ok(t1 && t1.people["@a:hs"][1] === 2 && t2 && Object.keys(t2.people).length === 0, "F: and loads back, each room its own", [t1, t2]);
  ok(mem.has("kv|r:!r1:rep:table"), "F: under the room's own key in `kv`", [...mem.keys()]);
  ok(await S.rep.save("!r1", [1, 2]) === false && await S.rep.save("!r1", null) === false, "F: a non-object table is refused");
  ok(await S.rep.savePrefs("!r1", { windowDays: 7 }) === true && (await S.rep.loadPrefs("!r1")).windowDays === 7 && await S.rep.loadPrefs("!r2") === null,
    "F: the bot-only settings round-trip per room, apart from the table");
  const releases = [];
  const first = await S.rep.writerLock("!r1", () => new Promise((res) => releases.push(res)));
  const second = await S.rep.writerLock("!r1", () => Promise.resolve());
  const other = await S.rep.writerLock("!r2", () => Promise.resolve());
  ok(first === true && second === false && other === true, "F: the writer lock is granted once per room; a second asker is refused; another room is its own", [first, second, other]);
  ok([...held].every((n) => /^ddjp:@bot:hs:rep-writer:!r[12]$/.test(n)), "F: named per account and per room", [...held]);
  const noLocks = loadInContext(["core/store.js"], { IDB: IDB, StorageIO: { load: () => null, save: noop }, navigator: {} }).Store;
  ok(await noLocks.rep.writerLock("!r1", () => Promise.resolve()) === null, "F: with no Web Locks the caller is told so — `null`, not a pretend lock");
  const noIdb = loadInContext(["core/store.js"], { IDB: Object.assign({}, IDB, { supported: () => false }), StorageIO: { load: () => null, save: noop } }).Store;
  ok(await noIdb.rep.load("!r1") === null && await noIdb.rep.save("!r1", { a: 1 }) === false, "F: with no IndexedDB there is simply no table");
}

// ── G — `Rep`, THE APP'S ONE ENTRY ───────────────────────────────────────────────────────────────────────────────────
async function partG() {
  const seen = [];
  const withBot = loadInContext(["features/rep-ports.js"], { RepBot: { enter: (c) => seen.push(["enter", c]), leave: (w) => seen.push(["leave", w]) } });
  withBot.Rep.enter({ spaceId: "!s", channels: { events_owner: "!o" } });
  withBot.Rep.leave("the tab left the room");
  ok(JSON.stringify(seen) === JSON.stringify([["enter", { spaceId: "!s", channels: { events_owner: "!o" } }], ["leave", "the tab left the room"]]),
    "G: `Rep.enter` and `Rep.leave` reach the bot side with what the app handed them", seen);
  // J84-3: the reader joins. `enter` and `leave` reach it as well as the bot side, and `badge` (H3, the People tab's row)
  // reaches it alone, answering what it answers — or `null`, never a 0, when it says nothing or is not there.
  const both = [];
  const withBoth = loadInContext(["features/rep-ports.js"], {
    RepBot: { enter: () => both.push("bot.enter"), leave: () => both.push("bot.leave") },
    RepReader: { enter: () => both.push("reader.enter"), leave: () => both.push("reader.leave"),
      badge: (u) => (u === "@a:hs" ? { rep: 12, text: "12 REP" } : null) } });
  withBoth.Rep.enter({ spaceId: "!s", channels: { events_owner: "!o" } });
  withBoth.Rep.leave("x");
  ok(both.join() === "reader.enter,bot.enter,reader.leave,bot.leave", "G: and the reader too, on every tab — `enter` and `leave` reach both pieces", both);
  ok(JSON.stringify(withBoth.Rep.badge("@a:hs")) === JSON.stringify({ rep: 12, text: "12 REP" }) && withBoth.Rep.badge("@b:hs") === null,
    "G: `Rep.badge` hands back the reader's answer, and `null` where it has none", [withBoth.Rep.badge("@a:hs"), withBoth.Rep.badge("@b:hs")]);
  const R0 = loadInContext(["features/rep-ports.js"], {}).Rep;
  let threw = null, b0 = "unset";
  try { R0.enter({ spaceId: "!s" }); R0.leave("x"); R0.enter(); b0 = R0.badge("@a:hs"); } catch (e) { threw = e; }
  let c0 = "unset";
  try { c0 = R0.botCard(); } catch (e) { threw = e; }
  ok(threw === null && b0 === null && c0 === null && Object.keys(R0).sort().join() === "badge,botCard,enter,leave",
    "G: with no piece loaded all four are no-ops, never a throw (`badge` and `botCard` say nothing) — and `Rep` has nothing else to say", threw ? String(threw) : [b0, c0]);
  // J84-5: H4 — `Rep.botCard` hands back the bot side's card, and nothing when its piece throws.
  const card = { heading: "Reputation (REP)", rows: [] };
  ok(loadInContext(["features/rep-ports.js"], { RepBot: { card: () => card } }).Rep.botCard() === card &&
     loadInContext(["features/rep-ports.js"], { RepBot: { card: () => { throw new Error("x"); } } }).Rep.botCard() === null,
    "G: `Rep.botCard` (H4) hands back the bot side's card — and nothing, never a throw, when it fails");
  const boom = loadInContext(["features/rep-ports.js"], { RepReader: { badge: () => { throw new Error("x"); } } }).Rep;
  let bt = "unset";
  try { bt = boom.badge("@a:hs"); } catch (e) { bt = "threw"; }
  ok(bt === null, "G: a reader that throws shows nothing, and the People tab still draws", bt);
  const late = loadInContext(["features/rep-ports.js"], {});
  const got = [];
  late.RepBot = { enter: () => got.push("late") };   // a piece defined after the ports load is still reached: read at call time
  try { late.Rep.enter({}); } catch (e) {}
  ok(got.length === 1, "G: the piece is read at CALL time, so the load order cannot matter", got);
}

(async () => {
  for (const [n, f] of [["B", partB], ["C", partC], ["D", partD], ["F", partF], ["G", partG]]) {
    try { await f(); } catch (e) { ok(false, n + ": threw — " + ((e && e.stack) || e)); }
  }
  if (failed) { console.log("[rep-ports] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[rep-ports] PASS — every port REP reaches the app through exists, passes its call through, and the hooks behind " +
    "them do what they say (J84; " + asserts + " assertions). THE LIST IS THE OBJECT: `PORTS` names exactly what is exported. " +
    "EVERY PORT IS A PASS-THROUGH, driven against a recording stub of each module — and with nothing loaded each answers " +
    "safely and none throws. `readChannelBack` (E3) reads one channel of the running room back to a time, top-level only " +
    "(a relay batch is one event), with each sender's level, and reads nothing outside the room's scope. `pageRange`'s stops " +
    "(E4) read the events channels only and drop what is older than the time, and without them it answers as before. The " +
    "`bot.command` verb (E5), through the port: the owner yes, the bot no. `Store.rep` (E6) keeps a table and the bot-only " +
    "settings per room, refuses a non-object, and its writer lock is granted once per room per account. `Rep`, the app's one " +
    "entry, hands `enter` and `leave` to the bot side read at call time, and is a no-op without it. THIS GUARD CANNOT " +
    "TELL YOU A REAL BROWSER'S LOCKS OR STORAGE BEHAVE AS THESE STUBS DO");
})();
