// tests/check-catchup-reentry.js
// SUBJECT: features/botruntime.js, backends/backend1/streammanager.js, backends/backend2/streammanager.js,
//          backends/backend1/matrixbridge.js, backends/backend1/history.js
//
// WALL: WHAT J79 BUILT THAT OUTLIVES ROOM FILES (J82; design-after-571 B.2 and B.6). Parts M and N moved here, unchanged in
//   what they assert, from `check-bot-restore`, which J82 retired with the owner's restore (ruling 1); part H is new, the
//   re-measurement B.2 asked for.
//
//   M  THE BOT'S SETTINGS REQUESTS WHILE IT CATCHES UP are held and answered once live, never lost and never answered from
//      a state still loading; a request dropped from a full hold is said, naming who asked.
//   N  THE RE-ENTRY RIDER: `StreamManager.reset()` clears the move-on log mark, so the next room's first line is printed.
//   H  SONG HISTORY IN A BOT ROOM, ON EVERY KIND OF DEVICE — the room never restored: the owner's, the bot's, a device that
//      opened from the first save point and followed, one reopening with a table stored early, one joining after more save
//      points than a device keeps. Each: truth = device in the History audit, the owner's history exactly, and a reload that
//      corrects nothing. A bot room has no `Floor`, so song history's chain is the bot engine's (`floorChain`): measured at
//      J82, without it the device that opened from a save point misses songs.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[catchup-reentry] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[catchup-reentry] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const { noop, OWNER, BOT, SPACE, BOT_CH, quiet, world } = require(path.join(__dirname, "_botroom.js"));
const T0 = 1.7e12, MIN = 60000;
const PARTS = [];
const part = (fn) => PARTS.push(fn);

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
  // The owner changes the room's settings while the bot catches up; then it goes LIVE.
  st = Object.assign({}, st, { bg: "https://example.org/changed.jpg", maxLen: 700 });
  liveNow = true; for (const fn of ready) fn();
  await new Promise((res) => setTimeout(res, 20));
  const w = wire.filter((x) => x.type === "ddjp.room.settings");
  ok(w.length === 1 && w[0].content.s.maxLen === 601 && w[0].content.s.bg === "https://example.org/changed.jpg",
    "M: once live it is answered against the room AS IT STANDS — the requested value merged onto the changed settings, never the old ones",
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
    d.arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", ARRIVED + "\nreturn _onCheckpointArrived;")(
      d.Fl, sb.TrustPolicy, sb.Continuity, d.SM, quiet, () => d.SM.getState().settings);
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

// ── H — SONG HISTORY IN A BOT ROOM, ON EVERY KIND OF DEVICE ───────────────────────────────────────────────────────────────────
// The room as its homeserver holds it, shared by every device; each device a real world (`_botroom.js`) that opens it. The
// bot's seals are made the way `B2Runner` makes them (its own seed builder, sealed at its head). More save points than a device
// keeps (24), so a late device's chain stops short of the room's start and is resolved by paging.
const rowsOf = (d) => d.sb.History.recent(5000).map((r) => r.pi + "|" + r.videoId).sort().join(";");
part(async () => {
  const server = { [SPACE]: [], [BOT_CH.events_uncategorized]: [], [BOT_CH.events_owner]: [], [BOT_CH.settings_owner]: [] };
  let L = 0, TS = T0, nIn = 0;
  const post = (roomId, sender, body) => { L++; TS += MIN;
    const raw = { type: "m.room.message", event_id: "$ev" + String(L).padStart(4, "0"), room_id: roomId, sender: sender, origin_server_ts: TS,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: L })) } };
    server[roomId].push(raw); return raw; };
  const devices = {}, live = [];
  const deliver = (raw) => { for (const d of live) d.live(raw); };
  const dev = async (name, me, o) => { const d = world(Object.assign({ me, server, opened: false }, o || {})); d.name = name; devices[name] = d; d.first = await d.open(); live.push(d); return d; };
  const owner = await dev("owner", OWNER);
  const bot = await dev("bot", BOT);
  const PL = owner.sb.Ranks.levelOf("player");
  deliver(post(BOT_CH.settings_owner, OWNER, { t: "ddjp.room.settings", s: Object.assign(owner.sb.StateDeriver.defaultSettings(), { vis: "public" }) }));
  let pi = null, seals = 0;
  const rel = (b, actor, rank) => Object.assign({}, b, { actor: actor, rank: rank, src: "$in" + (++nIn), at: null });
  const play = () => { const r = post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.play", p: pi }, BOT, 99)); deliver(r); pi = r.event_id; };
  const join = (who, v) => deliver(post(BOT_CH.events_owner, BOT, rel({ t: "ddjp.dj.join", v: v, u: "https://www.youtube.com/watch?v=" + v }, who, PL)));
  const seal = () => { const log = bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = bot.sb.B2Checkpoint.seal(bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); deliver(post(BOT_CH.events_owner, BOT, out.cp)); seals++; return out.cp; };
  for (let k = 0; k < 3; k++) join("@d" + k + ":hs", "pre" + k + "aaaaaaa");
  for (let s = 0; s < 3; s++) { play(); join("@d" + s + ":hs", "prx" + s + "bbbbbbb"); }
  seal();
  await dev("trimmed", "@trimmed:hs");                 // opens from save point n=1, then follows live
  for (let s = 0; s < 3; s++) { play(); join("@d" + s + ":hs", "pry" + s + "ccccccc"); }
  seal();
  const early = world({ me: "@reopened:hs", server, opened: false }); await early.open(); early.sb.MatrixBridge.persistHistoryNow();
  const storedEarly = early.stored.snap, cacheEarly = early.sb.EventCache.values();
  for (let k = 1; k < 27; k++) { play(); join("@dj:hs", "aft" + String(k).padStart(2, "0") + "dddddd"); seal(); }
  play();
  await dev("reopened", "@reopened:hs", { storedTable: storedEarly, cache: cacheEarly });
  await dev("joined", "@joined:hs");
  ok(devices.joined.sb.B2Checkpoint.held().length < seals, "H PREMISE — a device keeps fewer save points than the room has",
    { kept: devices.joined.sb.B2Checkpoint.held().length, seals: seals });
  ok(devices.joined.first.said.some((m) => /chain resolved from the room: \d+ older floor\(s\), ending at the room's first floor/.test(m)),
    "H: so the joining device found the room's first floor by paging — the chain it keeps does not reach it");
  const ref = rowsOf(owner);
  ok(owner.sb.History.count() > 30, "H PREMISE — the owner holds the room's history", owner.sb.History.count());
  for (const n of Object.keys(devices)) {
    const d = devices[n];
    const a = await d.sb.MatrixBridge.historyAudit();
    ok(a && a.truthCount > 0 && a.truthCount === a.deviceCount && !a.missing.length && !a.extra.length,
      "H: the " + n.toUpperCase() + " device — truth = device in the History audit", { truth: a && a.truthCount, device: a && a.deviceCount, missing: a && a.missing.map((r) => r.videoId), extra: a && a.extra.map((r) => r.videoId) });
    ok(rowsOf(d) === ref, "H: the " + n.toUpperCase() + " device holds the SAME history as the owner's", { n: d.sb.History.count(), owner: owner.sb.History.count() });
    const r1 = d.reload(); const o1 = await r1.open();
    ok(o1.verify && o1.verify.corrected === 0 && rowsOf(r1) === ref, "H: the " + n.toUpperCase() + " device, reloaded, corrects 0 rows and holds the same history", o1.verify);
  }
});

(async () => {
  for (const p of PARTS) { try { await p(); } catch (e) { failed++; console.log("[catchup-reentry] FAIL — a part threw: " + (e && e.stack)); } }
  _finished = true;
  if (failed) { console.log("[catchup-reentry] FAIL — " + failed + " of " + asserts + " assertions failed"); process.exit(1); }
  console.log("[catchup-reentry] PASS — what J79 built that outlives room files (J82, " + asserts + " assertions): the bot's " +
    "settings requests wait for live and are answered against the room as it stands, a dropped one is said; a re-entered room " +
    "prints its own move-on line (`StreamManager.reset()` clears the mark); and song history in a bot room is the room's on " +
    "every kind of device — the owner's, the bot's, one opened from a save point, one reopened with an early table, one joining " +
    "after more save points than it keeps — truth = device, the owner's rows exactly, a reload correcting nothing");
})();
