// tests/check-settings-windows.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, features/botruntime.js, backends/backend1/activity.js
// WALL: SETTINGS CHANGES, LIVE AND PAST, ARE HANDLED GRACEFULLY (J73 job 4, the owner's brief).
//   What counts changes: answer from what is already kept. A window grows: read further back, and say
//   "can't tell" until done. A window shrinks: let go of what is too old — read through the Q10
//   settlement's bound, "older than the longest window the settings allow", so a window that shrinks and
//   grows again needs no read-back. Past actions: each judged under the rules of its own moment.
//   PART A — what counts changes: the answer moves at once, from what is kept, as a full reader's does.
//   PART B — a decentralized window grows: answered at once, from what was taken before the trim.
//   PART C — a bot room's window grows: "can't tell" until the real read-back reaches further, then the
//            answer; covered, it reads nothing; a room switch forgets the read.
//   PART D — the bot's chat watch is read further back when the window outgrows it, and only then.
//   PART E — a window that shrinks and grows back loses nothing.
//   PART F — a past act is judged under the settings of its own moment.
//   PART G — Room's settings step asks the transport to extend its read.
//   PART H — a read in flight for room A does not swallow room B's: B's runs and covers B, A stops, and A
//            finishing late does not free B's busy flag (the audit's case against job 4).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[settings-windows] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// A GUARD THAT NEVER FINISHES IS NOT A PASS (J73 job 4, found by `mutate-j73-windows` W12). Its rows
// run in an async block; a promise that never settles stopped it before its verdict, and Node then
// exited 0 — so a mutation that hung the code under test read GREEN. Exiting unfinished fails.
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[settings-windows] FAIL — the guard did not finish: a promise " +
  "never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MIN = 60000, HOUR = 60 * MIN, N = 100 * HOUR;
const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const P = F.RANK.player, O = F.RANK.owner;
const ids = (f) => f.people.map((p) => p.userId).sort().join(",");
const tick = () => new Promise((r) => setImmediate(r));
const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); return (i >= 0 && j > i) ? src.slice(i, j) : null; };
const fnOf = (src, sig) => { const i = src.indexOf(sig); const j = src.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? src.slice(i, j + 4) : null; };

// A shared room: people acting at different ages, then owner settings events (the room's own record).
function shared(changes) {
  const sb0 = loadInContext(B1F, {}); const S = sb0.StateDeriver;
  const ev = [F.reducerEvent("$s", 1, N - 20 * HOUR, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
  let l = 2;
  for (const [who, ago] of [["@old", 3 * HOUR], ["@mid", 40 * MIN], ["@new", 5 * MIN]]) ev.push(F.reducerEvent("$" + who.slice(1), l++, N - ago, who + ":hs", P, { t: "ddjp.dj.join" }));
  ev.push(F.reducerEvent("$cut", l++, N - 4 * MIN, "@cut:hs", P, { t: "ddjp.dj.join" }));
  for (const [i, s] of changes.entries()) ev.push(F.reducerEvent("$set" + i, l++, N - 3 * MIN + i, "@owner:hs", O, { t: "ddjp.room.settings", s: Object.assign(S.defaultSettings(), s) }));
  return ev;
}
function readers(ev) {
  const R = loadInContext(B1F.concat(["features/room.js"]), {}); R.Floor.reset(); R.StreamManager.reset();
  ev.forEach((e) => R.StreamManager.ingest(F.toRaw(e)));
  const D = loadInContext(B1F.concat(["features/room.js"]), {}); D.Floor.reset(); D.StreamManager.reset();
  ev.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
  const ord = D.StreamManager.getLog(), b = ord.find((e) => e.eventId === "$cut");
  D.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: b.l, grade: "verified", covers: "$s..$cut", seed: D.StateDeriver.buildSeed(ord.slice(0, ord.indexOf(b) + 1), undefined), prev: null, thin: false });
  const dropped = D.StreamManager.trimToFloor();
  return { R, D, dropped };
}
// ── PART A — what counts changes ────────────────────────────────────────────────────────────
{
  const C = loadInContext(B1F, {}); const rot = C.Capabilities.activityGroupOf("ddjp.dj.join", { t: "ddjp.dj.join" });
  // `activityPresence` is a map of group -> on/off; joins no longer counting is that group off.
  const groups = Object.assign({}, C.StateDeriver.defaultSettings().activityPresence, { [rot]: false });
  const { R, D, dropped } = readers(shared([{ activityPresence: groups }]));
  ok(dropped > 0, "A PREMISE — the trim happened, so what is answered comes from what was kept");
  const ref = R.Room.recentlyActive(N), got = D.Room.recentlyActive(N);
  ok(ids(got) === ids(ref) && got.bounded === false && !/@old|@mid|@new/.test(ids(got)),
    "A: with joins no longer counting, the kept evidence answers at once — as a reader holding everything does (only the owner's settings change still counts)", { ref: ids(ref), got: ids(got), bounded: got.bounded });
}
// ── PART B — a decentralized window grows ───────────────────────────────────────────────────
{
  const { R, D } = readers(shared([{ botAfkMs: 6 * HOUR }]));
  const ref = R.Room.recentlyActive(N), got = D.Room.recentlyActive(N);
  ok(got.bounded === false && ids(got) === ids(ref) && ids(got).indexOf("@old") >= 0,
    "B: a window grown to 6 h is answered at once from what was taken before the trim — @old, 3 h ago, counts", { ref: ids(ref), got: ids(got), bounded: got.bounded });
}
// ── PART E — shrinks, then grows back ───────────────────────────────────────────────────────
{
  const { R, D } = readers(shared([{ botAfkMs: 10 * MIN }, { botAfkMs: 6 * HOUR }]));
  const ref = R.Room.recentlyActive(N), got = D.Room.recentlyActive(N);
  ok(got.bounded === false && ids(got) === ids(ref) && ids(got).indexOf("@old") >= 0,
    "E: a window that shrank and grew back needs no read-back — nothing within the longest allowed window was let go", { ref: ids(ref), got: ids(got) });
}
// ── PART F — a past act under the rules of its own moment ───────────────────────────────────
{
  const S = loadInContext(B1F, {}).StateDeriver;
  const ev = [F.reducerEvent("$s", 1, N - 2 * HOUR, "@owner:hs", O, { t: "ddjp.room.settings", s: Object.assign(S.defaultSettings(), { minDjRank: "guest" }) }),   // the only values: uncategorized, guest
    F.reducerEvent("$g", 2, N - 50 * MIN, "@guest:hs", loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("uncategorized"), { t: "ddjp.dj.join", v: "vidG0000001" }),   // uncategorized: refused under "guest"
    F.reducerEvent("$cut", 3, N - 4 * MIN, "@owner:hs", O, { t: "ddjp.dj.join" }),
    F.reducerEvent("$s2", 4, N - 3 * MIN, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })]; // lowered later
  const { R, D } = readers(ev);
  ok(R.StreamManager.isLegal("$g") === false, "F PREMISE — the join was refused under the settings of its moment");
  const ref = R.Room.recentlyActive(N), got = D.Room.recentlyActive(N);
  ok(ids(got) === ids(ref) && ids(got).indexOf("@guest") < 0,
    "F: lowering the bar later does not make the earlier refused join count — each act is judged under its own moment", { ref: ids(ref), got: ids(got) });
}
// ── PART G — Room's settings step asks the transport to extend ──────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8");
  let asked = 0;
  const run = new Function("current", "getSettings", "applyChatTiers", "_settingsListeners", "MatrixBridge",
    fnOf(src, "  function _applySettings() {") + "\nreturn _applySettings;")({}, () => ({}), () => {}, [], { extendActivityRead: () => { asked++; return false; } });
  run();
  ok(asked === 1, "G: applying settings asks the transport to extend its activity read", asked);
}
// ── PARTs C and D (asynchronous) ────────────────────────────────────────────────────────────
(async () => {
  // C — a bot room: the real door, the bridge's real read-back and extension.
  {
    const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "features/room.js"]), {});
    const D = sb.B2StreamManager, S = sb.StateDeriver, R = sb.Ranks;
    D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
    const setRaw = (id, l, ts, s) => Object.assign(F.toRaw(F.reducerEvent(id, l, ts, "@owner:hs", O, { t: "ddjp.room.settings", s: Object.assign(S.defaultSettings(), s) })), { room_id: "!set:hs" });
    const relay = (id, ts, actor) => ({ event_id: id, room_id: "!log:hs", sender: "@bot:hs", ts: ts, type: "m.room.message",
      content: { body: JSON.stringify({ t: "ddjp.dj.join", actor: actor, rank: R.levelOf("player"), l: 2 }) } });
    // Recent: in a bot room the held log starts at the save point, so it cannot itself reach back hours.
    D.ingest(setRaw("$s1", 1, N - 20 * MIN, { botAfkMs: HOUR, botPresencePingMs: 10 * MIN, botPingMs: 10 * MIN, queueIdleMs: 15 * MIN }));
    D.ingest(relay("$now", N, "@new:hs"));
    // The SDK room: one relay every 10 minutes for 30 hours; the newest 3 are downloaded, older come a page at a time.
    const all = []; for (let k = 180; k >= 0; k--) all.push(relay("$r" + k, N - k * 10 * MIN, k === 18 ? "@old:hs" : "@p" + (k % 5) + ":hs"));
    const sdk = (r) => ({ getId: () => r.event_id, getSender: () => r.sender, getTs: () => r.ts, getType: () => r.type, getContent: () => r.content });
    const room = { roomId: "!log:hs", timeline: all.slice(-3).map(sdk) };
    let next = all.length - 3, pages = 0;
    const client = { scrollback: async (rm, n) => { pages++; const f = Math.max(0, next - 6); rm.timeline = all.slice(f, next).map(sdk).concat(rm.timeline); next = f; } };
    const target = { StreamManager: D, client: client, Logger: { info() {}, warn() {} }, clearRoomScope: () => {}, _flushPendingPersist: () => {}, _currentSpaceId: "!r" };
    const scope = new Proxy(target, { has: () => true, get: (t, k) => (k in t) ? t[k] : (k === Symbol.unscopables ? undefined : globalThis[k]), set: (t, k, v) => { t[k] = v; return true; } });
    const block = between(MB, "  let _activityReadAt = null, _activityReadBusy = false;", "  // ── end of the activity read-back (J73 job 4) ──");
    ok(!!block, "C PREMISE — the read-back and its extension are extracted from the shipped file");
    const api = new Function("scope", "with (scope) {\n" + block + fnOf(MB, "  function resetCheckpoints() {") +
      "\nreturn { _readActivityBack, extendActivityRead, resetCheckpoints };\n}")(scope);
    ok(api.extendActivityRead() === false, "C: before any read-back there is nothing to extend");
    await api._readActivityBack("!log:hs", room);
    ok(D.activityCovered() === true, "C PREMISE — the first read covers the 1-hour window");
    const fold = () => sb.Room.foldActivity(sb.B1StreamManager.getLog(), N, D.getState().settings.botAfkMs, { spine: true, chat: false },
      (id) => sb.B1StreamManager.isLegal(id), D.getState().settings.activityPresence, sb.Capabilities.activityGroupOf, D.olderActivity());
    D.ingest(setRaw("$s2", 3, N - MIN, { botAfkMs: 6 * HOUR, botPresencePingMs: 10 * MIN, botPingMs: 10 * MIN, queueIdleMs: 15 * MIN }));
    ok(D.activityCovered() === false && fold().bounded === true, "C: the window grew to 6 h — not covered, and presence says can't tell until it is", { covered: D.activityCovered(), bounded: fold().bounded });
    const before = pages;
    ok(api.extendActivityRead() === true, "C: extending starts a read further back");
    for (let i = 0; i < 80; i++) await tick();
    const f = fold();
    ok(D.activityCovered() === true && f.bounded === false && f.people.some((p) => p.userId === "@old:hs") && pages > before,
      "C: once read back far enough, the 6-hour answer comes — @old, active 3 h ago, counts", { covered: D.activityCovered(), bounded: f.bounded, pages: pages - before });
    const p2 = pages;
    ok(api.extendActivityRead() === false && pages === p2, "C CONTROL: covered, it reads nothing");
    D.ingest(setRaw("$s3", 4, N - 30000, { botAfkMs: 20 * HOUR, botPresencePingMs: 10 * MIN, botPingMs: 10 * MIN, queueIdleMs: 15 * MIN }));
    api.resetCheckpoints();
    ok(api.extendActivityRead() === false, "C: after a room switch the old room's read is not extended");
  }
  // H — room A's read in flight; room B's stopped download asks for B's.
  {
    const COVER = N - 2 * HOUR;
    let cur = "!A";
    const notes = [];
    const SM = { noteActivity: (raws, opts) => { for (const r of raws || []) notes.push(r); if (opts && opts.complete) notes.push({ room_id: cur, ts: -Infinity }); },
                 activityCovered: () => notes.some((r) => r.room_id === cur && r.ts <= COVER) };
    const ev = (id, ts) => ({ getId: () => id, getSender: () => "@x:hs", getTs: () => ts, getType: () => "m.room.message", getContent: () => ({ body: "{}" }) });
    const roomA = { roomId: "!A", timeline: [ev("$a0", N)] }, roomB = { roomId: "!B", timeline: [ev("$b0", N)] };
    let resolveA, resolveB, aCalls = 0, bCalls = 0;
    const client = { scrollback: (rm) => {
      if (rm === roomA) { aCalls++; return new Promise((r) => { resolveA = () => { rm.timeline = [ev("$a1", N - HOUR)].concat(rm.timeline); r(); }; }); }
      bCalls++; return new Promise((r) => { resolveB = () => { rm.timeline = [ev("$b1", COVER - MIN)].concat(rm.timeline); r(); }; }); } };
    const target = { StreamManager: SM, client: client, Logger: { info() {}, warn() {} }, clearRoomScope: () => {}, _flushPendingPersist: () => {}, _currentSpaceId: "!r" };
    const scope = new Proxy(target, { has: () => true, get: (t, k) => (k in t) ? t[k] : (k === Symbol.unscopables ? undefined : globalThis[k]), set: (t, k, v) => { t[k] = v; return true; } });
    const block = between(MB, "  let _activityReadAt = null, _activityReadBusy = false;", "  // ── end of the activity read-back (J73 job 4) ──");
    const api = new Function("scope", "with (scope) {\n" + block + "\nreturn { _readActivityBack, extendActivityRead };\n}")(scope);
    const readA = api._readActivityBack("!A", roomA);
    await tick();
    ok(aCalls === 1, "H PREMISE — room A's read is in flight, its scrollback pending", aCalls);
    cur = "!B";
    const readB = api._readActivityBack("!B", roomB);
    await tick();
    ok(bCalls === 1 && notes.some((r) => r.room_id === "!B"), "H: room B's read RUNS while A's is in flight — it is not swallowed by A's busy flag", { bCalls, bNotes: notes.filter((r) => r.room_id === "!B").length });
    api._readActivityBack("!B", roomB); await tick();
    ok(bCalls === 1, "H CONTROL: a second call for the same room while it is read starts no second read", bCalls);
    const aNotes = notes.filter((r) => r.room_id === "!A").length;
    resolveA(); for (let i = 0; i < 10; i++) await tick();
    ok(aCalls === 1 && notes.filter((r) => r.room_id === "!A").length === aNotes, "H: room A's read STOPS — nothing more noted, no more scrolling", { aCalls, aNotesAfter: notes.filter((r) => r.room_id === "!A").length - aNotes });
    ok(api.extendActivityRead() === false && bCalls === 1, "H: A stopping late does not free B's flag — no second read of B starts", bCalls);
    resolveB(); for (let i = 0; i < 10; i++) await tick();
    await readA; await readB;
    ok(SM.activityCovered() === true, "H: and B's read covers B", notes.filter((r) => r.room_id === "!B").map((r) => r.ts));
  }
  // D — the bot's chat watch.
  {
    const reads = []; let windowMs = HOUR;
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "features/botruntime.js"], {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      window: {}, document: { body: { appendChild() {} }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      ServerClock: { serverNow: () => N }, Skip: { skip: () => Promise.resolve({ ok: true }) },
      Chat: { sendTo: () => Promise.resolve({ ok: true }), send: () => Promise.resolve({ ok: true }), onMessage() {} },   // the chat watch starts only with one
      MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99, getRoster: () => [], onRawEvent() {}, offRawEvent() {},
        joinedMembersOf: () => [], invitedMembersOf: () => [], mayAuthor: () => ({ ok: true }), onAuthorReady() {},
        readBackActivity: async (roomId, since) => { reads.push(since); return { ok: true, people: {}, reachedTs: since, complete: false }; } },
    });
    let listener = null;
    sb.Room = { rankLadder: () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }], chatTiers: () => ({ mainId: "!main", tiers: [{ id: "!chat:hs" }] }),
                onSettingsChange: (fn) => { listener = fn; }, playedWithin: () => null, recentlyActive: () => ({ people: [], bounded: true }) };
    sb.StreamManager = { getLog: () => [], isLegal: () => true, on() {}, getState: () => ({ settings: Object.assign(sb.StateDeriver.defaultSettings(),
      { botAfkMs: windowMs, botPresencePingMs: 10 * MIN, botPingMs: 10 * MIN, queueIdleMs: 15 * MIN }), rotation: [], nowPlaying: null }) };
    const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!p" } });
    for (let i = 0; i < 20; i++) await tick();
    ok(started && started.ok === true && reads.length === 1 && typeof listener === "function", "D PREMISE — the bot started, read chat back once, and listens for settings", { started, reads: reads.length });
    listener();
    for (let i = 0; i < 20; i++) await tick();
    ok(reads.length === 1, "D CONTROL: a settings change that leaves the window covered reads nothing", reads.length);
    windowMs = 6 * HOUR; listener();
    for (let i = 0; i < 20; i++) await tick();
    ok(reads.length === 2 && reads[1] < reads[0], "D: the window grew — chat is read further back", reads.map((r) => (N - r) / MIN + " min"));
    try { sb.BotRuntime.stop(); } catch (e) {}
  }
})().then(done, (e) => { failed++; console.log("[settings-windows] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[settings-windows] " + failed + " failure(s)"); process.exit(1); }
  console.log("[settings-windows] PASS — settings changes are handled gracefully (J73 job 4): a change to what counts and a grown " +
    "window are answered from what was kept, a bot room's grown window says can't tell until the real read-back reaches further " +
    "and reads nothing once covered, the bot's chat watch is read further back only when outgrown, a shrink-and-grow loses " +
    "nothing, and a past act stays judged under its own moment (" + asserts + " assertions)");
  process.exit(0);
}
