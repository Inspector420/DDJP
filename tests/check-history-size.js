#!/usr/bin/env node
// tests/check-history-size.js
// SUBJECT: backends/backend1/statederiver.js, backends/backend1/dials.js, backends/backend1/history.js, backends/backend1/matrixbridge.js
//
// WALL: SONG HISTORY'S TWO SETTINGS, AND THE WINDOW FOLLOWING THE ROOM'S HISTORY SIZE (`ddjp_736`; the owner's words 3 and 4 in
// `main/01-project.md` item 7: "if its easy lets do the max room setting just make sure it cant break anything by having aminimum
// thats is too low or above 5000", "all these settings are advenced default 5000, 15 per batch"; `consensus/history-rules.md` §10
// and §12). Driven on the real modules:
//   A  THE REDUCER'S BOUNDS: `historySize` 500–5000, default 5000; `historySummaryEvery` 5–100, default 15 — each end accepted,
//      one past each refused, a fraction or a string refused (the value stays what it was), through `applySettingsEvent` and
//      through the real fold of an owner's settings event. `HISTORY_MAX`, the fold's own ceiling, stays 5000.
//   B  WHERE THEY STAND AMONG THE ROOM'S SETTINGS: the panel's bounds are the reducer's (`StreamManager.settingRanges`, which
//      `ui/settings.js` reads); both delegable (the bot's delegation domain is every setting but itself); both LIVE dials.
//   C  THE WINDOW IS THE ROOM'S, IN `History` ALONE (a pager over a room of 700 songs): the table keeps the room's `historySize`,
//      lowered — the oldest rows go at once, what lay below them is no longer claimed, the window held at the new size — and
//      raised — nothing goes, the window is no longer held, and the fill reads the stretch below until it is; a bad value reads
//      as the ceiling (5000); `coverage().cap` says the size.
//   D  THROUGH THE BRIDGE, IN A BOT ROOM (the real modules of both engines; the SDK client is the only double, `tests/_botroom.js`):
//      the owner posts a smaller size — the device lets go of its oldest songs at once and stores the table (a reload holds the
//      same songs and reads nothing); then a larger one — the device reads the songs below back at once (the backfill re-armed)
//      and holds the room's newest that many.
// NOT DRIVEN HERE: the bridge's page cap for a walk (`pageRange`'s `maxPages`, derived from `History.size()`) — an upper bound no
// room in this suite reaches; it is read from the same function the window is.
// RED FIRST ON `ddjp_735`: no such settings (A, B), the table's window fixed at `History.MAX` (C), nothing follows a settings change (D).
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const B = require(path.join(__dirname, "_botroom.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-size] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 700) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-size] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 20));

// ── A — THE REDUCER'S BOUNDS ───────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {});
  const SD = sb.StateDeriver, d = SD.defaultSettings();
  ok(d.historySize === 5000 && d.historySummaryEvery === 15, "A: THE DEFAULTS — history size 5000, songs per summary 15 (the owner's)", [d.historySize, d.historySummaryEvery]);
  const R = SD.SETTING_RANGES || {};
  ok(R.historySize && R.historySize.min === 500 && R.historySize.max === 5000 && R.historySummaryEvery && R.historySummaryEvery.min === 5 && R.historySummaryEvery.max === 100,
    "A: THE RANGES — 500 to 5000 songs, and 5 to 100 songs", { historySize: R.historySize, historySummaryEvery: R.historySummaryEvery });
  const at = (k, v) => SD.applySettingsEvent(Object.assign(SD.defaultSettings(), { historySize: 1234, historySummaryEvery: 33 }), { [k]: v })[k];
  const hs = [500, 5000, 499, 5001, 0, -1, 2500.5, "1000", null].map((v) => at("historySize", v));
  ok(JSON.stringify(hs) === JSON.stringify([500, 5000, 1234, 1234, 1234, 1234, 1234, 1234, 1234]),
    "A: HISTORY SIZE — 500 and 5000 accepted; 499, 5001, 0, a negative, a fraction, a string and null refused (the value stays)", hs);
  const se = [5, 100, 4, 101, 0, 15.5, "15"].map((v) => at("historySummaryEvery", v));
  ok(JSON.stringify(se) === JSON.stringify([5, 100, 33, 33, 33, 33, 33]),
    "A: SONGS PER SUMMARY — 5 and 100 accepted; 4, 101, 0, a fraction and a string refused (the value stays)", se);
  // Through the real fold: the owner's settings event, whole (a self-sufficient blob, as the panel sends).
  const OWN = sb.Ranks.levelOf("owner");
  const ev = (id, l, s) => ({ eventId: id, type: "ddjp.room.settings", content: { t: "ddjp.room.settings", s }, l, ts: 1000 * l, sender: "@o:hs", senderRank: OWN, roomId: "!r:hs" });
  const fold = (s) => SD.derive([ev("$s", 1, Object.assign(SD.defaultSettings(), s))]).settings;
  const f1 = fold({ historySize: 800, historySummaryEvery: 40 }), f2 = fold({ historySize: 400 }), f3 = fold({ historySummaryEvery: 200 });
  ok(f1.historySize === 800 && f1.historySummaryEvery === 40 && f2.historySize === 5000 && f3.historySummaryEvery === 15,
    "A: THROUGH THE FOLD — an owner's 800 and 40 land; 400 and 200 do not (the room keeps 5000 and 15)", [f1.historySize, f1.historySummaryEvery, f2.historySize, f3.historySummaryEvery]);
  const H = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History;
  ok(H.MAX === 5000, "A: THE CEILING STAYS — `History.MAX` 5000, the most any room may ask for", H.MAX);
});

// ── B — AMONG THE ROOM'S SETTINGS ──────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/eventcache.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"], {
    Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 }, window: { isSecureContext: false }, document: undefined, indexedDB: undefined, navigator: {} });
  const panel = sb.StreamManager.settingRanges ? sb.StreamManager.settingRanges() : {};
  ok(panel.historySize && panel.historySize.min === 500 && panel.historySize.max === 5000 && panel.historySummaryEvery && panel.historySummaryEvery.min === 5 && panel.historySummaryEvery.max === 100,
    "B: THE PANEL'S BOUNDS ARE THE REDUCER'S — what `ui/settings.js` reads for each row (`Room.getSettingRanges`, Pillar 3)", { a: panel.historySize, b: panel.historySummaryEvery });
  const dom = (sb.StateDeriver.SETTING_RANGES.botDelegation && typeof sb.StateDeriver.SETTING_RANGES.botDelegation.keys === "function") ? sb.StateDeriver.SETTING_RANGES.botDelegation.keys() : [];
  ok(dom.indexOf("historySize") >= 0 && dom.indexOf("historySummaryEvery") >= 0, "B: BOTH DELEGABLE — in the bot's delegation domain, as every setting is", dom.filter((k) => /^history/.test(k)));
  ok(sb.Dials && sb.Dials.isLive("historySize") && sb.Dials.isLive("historySummaryEvery") && !sb.Dials.isFrozen("historySize"),
    "B: BOTH LIVE — read when song history reads, never frozen at a song's start", sb.Dials && [sb.Dials.isLive("historySize"), sb.Dials.isLive("historySummaryEvery")]);
});

// ── C — THE WINDOW, IN `History` ALONE ─────────────────────────────────────────────────────────────────────────────────────
// A room of SONGS plays (one every 5 positions, a save point every 40 songs), paged by `History`'s own fills.
function room(songs) {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {});
  const SD = sb.StateDeriver, OWN = sb.Ranks.levelOf("owner"), PL = sb.Ranks.levelOf("player");
  const ev = (id, l, sender, rank, body) => ({ eventId: id, type: body.t, content: body, l, ts: 1700000000000 + 60000 * l, sender, senderRank: rank, roomId: "!r:hs" });
  const E = [ev("$set", 1, "@o:hs", OWN, { t: "ddjp.room.settings", s: SD.defaultSettings() })];
  let l = 1, prev = null, k = 0;
  const key = () => "yt:" + String(++k).padStart(11, "x").slice(-11);
  for (let d = 0; d < 3; d++) E.push(ev("$j" + (++l), l, "@d" + d + ":hs", PL, { t: "ddjp.dj.join", v: key() }));
  const plays = [], anchors = [];
  for (let s = 0; s < songs; s++) {
    const id = "$p" + String(++l).padStart(6, "0");
    E.push(ev(id, l, "@d" + (s % 3) + ":hs", PL, { t: "ddjp.dj.play", p: prev })); prev = id; plays.push({ pi: id, l });
    E.push(ev("$j" + (++l), l, "@d" + (s % 3) + ":hs", PL, { t: "ddjp.dj.join", v: key() }));
    if ((s + 1) % 40 === 0) anchors.push({ l, seed: SD.buildSeed(E.slice(), null) });
  }
  let size = null;
  const asked = [];
  sb.History.attach({ log: () => [], seed: () => undefined, settled: () => true, size: () => size,
    pageRange: async (a, b) => { asked.push([a, b]); return E.filter((e) => e.l >= a && e.l <= b); },
    anchorOf: (e) => null });
  return { sb, H: sb.History, E, plays, anchors, top: l, setSize: (v) => { size = v; }, asked };
}
const newestPis = (x, n) => x.plays.slice(-n).map((p) => p.pi).sort().join();
const heldPis = (H) => H.recent(5000).map((r) => r.pi).sort().join();
part("C", async () => {
  const x = room(700);
  const H = x.H;
  ok(typeof H.size === "function" && typeof H.resize === "function", "C APPLIED — `History` reads the room's window (`size`) and follows it (`resize`)", [typeof H.size, typeof H.resize]);
  if (typeof H.size !== "function") return;
  x.setSize(5000);
  await H.backfill(0, undefined, x.top + 1);
  ok(H.count() === 700 && H.coverage().complete === true && H.size() === 5000, "C PREMISE — a room of 700 songs read whole at the default window", { n: H.count(), cov: H.coverage().ranges });
  // LOWERED
  x.setSize(500);
  const r = H.resize();
  const cov = H.coverage(), w500 = x.plays[x.plays.length - 500].l;
  ok(r && r.size === 500 && r.dropped === 200 && H.count() === 500 && heldPis(H) === newestPis(x, 500),
    "C: LOWERED, THE OLDEST GO AT ONCE — 200 let go, the newest 500 held", { r, n: H.count() });
  ok(cov.cap === 500 && cov.complete === false && cov.ranges.length === 1 && cov.ranges[0][0] === w500 && cov.windowFrom === w500 && cov.full === true,
    "C: AND WHAT LAY BELOW THEM IS NO LONGER CLAIMED — the room's start not claimed; the window held at 500, from its oldest song", cov);
  ok(H.holes().length === 0, "C: and a held window opens no hole below it", H.holes());
  // RAISED
  x.setSize(650);
  const r2 = H.resize(), cov2 = H.coverage();
  ok(r2 && r2.dropped === 0 && H.count() === 500 && cov2.windowFrom === null && cov2.full === false && cov2.cap === 650,
    "C: RAISED, NOTHING GOES — and the window is no longer held (500 of 650)", { r2, cov: cov2 });
  const a0 = x.asked.length;
  await H.backfill(0, undefined, cov2.fromL);
  const w650 = x.plays[x.plays.length - 650].l, cov3 = H.coverage();
  ok(x.asked.length > a0 && H.count() === 650 && heldPis(H) === newestPis(x, 650) && cov3.windowFrom === w650 && cov3.full === true,
    "C: AND THE FILL READS THE STRETCH BELOW UNTIL IT IS — the newest 650 held, the window held again", { asked: x.asked.slice(a0), n: H.count(), cov: cov3 });
  // A BAD VALUE READS AS THE CEILING
  for (const bad of [0, -5, 6000, 1.5, "800", null, undefined]) { x.setSize(bad); if (H.size() !== 5000) { ok(false, "C: A VALUE THAT IS NO WHOLE NUMBER FROM 1 TO 5000 READS AS THE CEILING", { bad, size: H.size() }); break; } }
  x.setSize(6000);
  ok(H.size() === 5000 && H.resize().dropped === 0 && H.coverage().cap === 5000, "C: A VALUE THAT IS NO WHOLE NUMBER FROM 1 TO 5000 READS AS THE CEILING (5000), and lets nothing go", H.coverage().cap);
  // THE MERGE EVICTS AT THE WINDOW TOO: a table at 600 that receives the whole room keeps 600.
  const y = room(700); y.setSize(600);
  await y.H.backfill(0, undefined, y.top + 1);
  ok(y.H.count() === 600 && heldPis(y.H) === newestPis(y, 600) && y.H.coverage().full === true,
    "C: A FILL INTO A ROOM'S WINDOW KEEPS THE WINDOW — the newest 600, never 700", { n: y.H.count() });
});

// ── D — THROUGH THE BRIDGE, IN A BOT ROOM ──────────────────────────────────────────────────────────────────────────────────
function botRoom(songs) {
  const BC = B.BOT_CH, MIN = 60000;
  const server = { [B.SPACE]: [], [BC.events_uncategorized]: [], [BC.events_owner]: [], [BC.settings_owner]: [] };
  const R = { server, BC, L: 0, TS: 1792447900000, nIn: 0, pi: null, k: 0, live: [], plays: [] };
  R.post = (roomId, sender, body) => { R.L++; R.TS += (body.t === "ddjp.dj.play" ? 4 * MIN : 1000);
    const raw = { type: "m.room.message", event_id: "$z" + String(R.L).padStart(6, "0"), room_id: roomId, sender, origin_server_ts: R.TS,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: R.L })) } };
    server[roomId].push(raw); for (const d of R.live) d.live(raw); return raw; };
  R.bot = B.world({ me: B.BOT, server, opened: false, order: B.ORDER.filter((f) => f !== "backends/backend1/history.js") });
  const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++R.nIn), at: null });
  R.key = () => "yt:z" + String(++R.k).padStart(10, "0");
  R.join = (who, v) => R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v.slice(3) }, who, R.PL));
  R.song = (s) => { const r = R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.play", p: R.pi }, B.BOT, 99)); R.pi = r.event_id; R.plays.push({ pi: r.event_id, l: R.L });
    R.join("@d" + (s % 3) + ":hs", R.key()); };
  R.seal = () => { const log = R.bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = R.bot.sb.B2Checkpoint.seal(R.bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); R.post(BC.events_owner, B.BOT, out.cp); };
  R.settings = (extra) => R.post(BC.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(R.bot.sb.StateDeriver.defaultSettings(), { vis: "public" }, extra || {}) });
  R.build = async () => {
    await R.bot.open(); R.live.push(R.bot); R.PL = R.bot.sb.Ranks.levelOf("player");
    R.settings();
    for (let k = 0; k < 3; k++) R.join("@d" + k + ":hs", R.key());
    for (let s = 0; s < songs; s++) { R.song(s); if ((s + 1) % 40 === 0) R.seal(); }
    R.song(songs);
  };
  return R;
}
async function openSplit(w) {
  await Promise.allSettled(Object.keys(w.CH).map((k) => w.sb.MatrixBridge.replayRoom(w.CH[k])));
  w.sb.StreamManager.openFromSavePoint();
  w.goLive();
  const m = w.meter.mark(), l0 = w.logs.length;
  await w.sb.MatrixBridge.backfillHistory();
  return { paged: w.meter.since(m), said: w.logs.slice(l0) };
}
const pis = (w) => w.sb.History.recent(5000).map((r) => r.pi).sort().join();
const newest = (R, n) => R.plays.slice(-n).map((p) => p.pi).sort().join();
part("D", async () => {
  const R = botRoom(700);
  await R.build();
  const d = B.world({ me: B.OWNER, server: R.server, opened: false, meter: true, timers: true });
  await openSplit(d);
  const H = d.sb.History;
  ok(R.plays.length === 701 && H.count() === 701 && H.coverage().complete === true, "D PREMISE — a bot room of 701 songs, read whole at the default window", { plays: R.plays.length, held: H.count() });
  if (typeof H.size !== "function") { ok(false, "D APPLIED — `History.size` exists"); return; }
  R.live.push(d);
  // LOWERED
  const l0 = d.logs.length;
  R.settings({ historySize: 500 }); await settle(30);
  const cov = H.coverage();
  ok(d.sb.StreamManager.getState().settings.historySize === 500, "D PREMISE — the room's history size is now 500 (the owner's settings, folded)", d.sb.StreamManager.getState().settings.historySize);
  ok(H.count() === 500 && pis(d) === newest(R, 500) && cov.cap === 500 && cov.full === true && cov.complete === false,
    "D: THE OWNER LOWERS IT — the device lets go of its oldest songs at once, holds the newest 500, the window held and the room's start no longer claimed", { n: H.count(), cov: cov.ranges, full: cov.full });
  ok(d.stored.snap && Array.isArray(d.stored.snap.rows) && d.stored.snap.rows.length === 500,
    "D: AND STORES THE TABLE AT ONCE — the stored table holds the 500", d.stored.snap && d.stored.snap.rows.length);
  ok(d.logs.slice(l0).some((m) => /history — the room's window is now 500 songs \(was 5000\); 201 older song\(s\) let go/.test(m)),
    "D: AND SAYS SO — \"the room's window is now 500 songs (was 5000); 201 older song(s) let go\"", d.logs.slice(l0).filter((m) => /window/.test(m)));
  // A RELOAD HOLDS THE SAME AND READS NOTHING
  const d2 = d.reload({ meter: true, timers: true });
  const o2 = await openSplit(d2);
  ok(d2.sb.History.count() === 500 && pis(d2) === newest(R, 500) && o2.paged.calls === 0,
    "D: A RELOAD HOLDS THE SAME 500 AND READS NOTHING — the window is the room's, held", { n: d2.sb.History.count(), paged: o2.paged });
  // RAISED
  R.live.push(d2);
  const m = d2.meter.mark(), l2 = d2.logs.length;
  R.settings({ historySize: 650 }); await settle(30);
  d2.timers.fire(0); await settle(60);
  const cov2 = d2.sb.History.coverage();
  ok(d2.meter.since(m).calls > 0 && d2.sb.History.count() === 650 && pis(d2) === newest(R, 650) && cov2.full === true && cov2.cap === 650,
    "D: THE OWNER RAISES IT — the device reads the songs below back at once (the backfill re-armed), and holds the room's newest 650", { paged: d2.meter.since(m), n: d2.sb.History.count(), cov: cov2.ranges });
  ok(d2.logs.slice(l2).some((m2) => /history — the room's window is now 650 songs \(was 500\); the songs below are read back/.test(m2)),
    "D: AND SAYS SO — \"the room's window is now 650 songs (was 500); the songs below are read back\"", d2.logs.slice(l2).filter((m2) => /window/.test(m2)));
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { ok(false, name + ": threw — " + String((e && e.stack) || e).split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[history-size] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-size] PASS — song history's two settings and the window following the room's history size (`ddjp_736`; " + asserts +
    " assertions): 500–5000 (default 5000) and 5–100 (default 15), each end accepted and one past refused, through the reducer and the " +
    "fold; the panel's bounds the reducer's, both delegable and LIVE; in `History` the window is the room's — lowered, the oldest go at " +
    "once and the start is no longer claimed; raised, nothing goes and the fill reads below until the window is held; a bad value reads " +
    "as 5000 — and through the bridge in a bot room, lowered (let go at once, stored, a reload reading nothing) and raised (read back at once).");
})();
