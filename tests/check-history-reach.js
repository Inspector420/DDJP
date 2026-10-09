// tests/check-history-reach.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js, features/room.js
// WALL: SONG HISTORY ALWAYS SAYS HOW FAR BACK IT REACHES, AND NEVER DECIDES PAST THAT (J73 job 6).
//
// Found by reading at `ddjp_513` and settled by the owner: coverage was one range, so a gap between
// a last visit and a newer save point was spanned and claimed; eviction past 5,000 rows left the old
// reach claimed; the table was stored only after a fill; and the repeat rule had no added times.
// Real `History`, the shipped `pageRange` (extracted from matrixbridge.js and RUN against an
// SDK-shaped room whose older events arrive only by scrolling back), real `Room.playedWithin`.
//   PART A — coverage is a list of ranges; a gap is a hole, not covered; touching ranges merge.
//   PART B — eviction lowers the claimed reach.
//   PART C — `playedWithin` never decides past the reach: a play below a hole decides nothing.
//   PART D — added times: accepted adds only; kept while queued or playing; dropped after.
//   PART E — the five reload cases the owner named.
//   PART F — `pageRange` skips rooms the engine never folds, and says how far back it got.
//   PART G — the store is written after an advance, debounced, and at once when the tab hides.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-reach] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// A GUARD THAT NEVER FINISHES IS NOT A PASS (J73 job 4, found by `mutate-j73-windows` W12). Its rows
// run in an async block; a promise that never settles stopped it before its verdict, and Node then
// exited 0 — so a mutation that hung the code under test read GREEN. Exiting unfinished fails.
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-reach] FAIL — the guard did not finish: a promise " +
  "never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const cut = (a, b) => { const i = MB.indexOf(a), j = MB.indexOf(b, i + 1); return (i >= 0 && j > i) ? MB.slice(i, j) : null; };
const PAGE_SRC = cut("  async function pageRange(fromL, toL) {", "  // The room's start phase runs only AFTER replay");
ok(!!PAGE_SRC, "PREMISE — pageRange is extracted from the shipped file");
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"];
const tree = () => loadInContext(FILES, {});
const P = F.RANK.player, O = F.RANK.owner, MIN = 60000;
const CP = "ddjp.checkpoint";
const anchorOf = (e) => (e && e.type === CP && e.content && typeof e.content.floorL === "number" && e.content.seed)
  ? { l: e.content.floorL, seed: e.content.seed } : null;

// A room: settings, two songs from each of four DJs, then rounds of "a song plays, its DJ adds another",
// with a save point (the cut's seed) every 20 positions. Returns events in order.
function room(sb, rounds) {
  const SD = sb.StateDeriver;
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: Object.assign(SD.defaultSettings(), { repeatCooldownMs: 30 * 24 * 60 * MIN }) })];
  let l = 2, ts = 2000, prev = null, n = 0;
  const add = (who) => { ev.push(F.reducerEvent("$add" + n, l++, ts += 100, who, P, { t: "ddjp.dj.join", v: "vid" + String(n).padStart(8, "0") })); n++; };
  const maybeSave = () => {
    if ((l - 1) % 20 !== 0) return;
    const floorL = l - 1, seed = SD.buildSeed(ev.slice(), undefined);
    ev.push(F.reducerEvent("$cp" + floorL, l++, ts += 1, "@owner:hs", O, { t: CP, floorL: floorL, seed: seed }));
  };
  for (let u = 0; u < 4; u++) { add("@u" + u + ":hs"); add("@u" + u + ":hs"); }
  for (let r = 0; r < rounds; r++) {
    const id = "$play" + r;
    ev.push(F.reducerEvent(id, l++, ts += 4 * MIN, "@u0:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; maybeSave();
    add("@u" + (r % 4) + ":hs"); maybeSave();
  }
  return ev;
}
// An SDK-shaped room over those events: the newest `live` are held, scrolling back adds `per` older.
function sdk(events, live, per) {
  const all = events.map((e) => ({ event: F.toRaw(e) }));
  const r = { roomId: "!ev:hs", timeline: all.slice(-live) };
  let next = all.length - live;
  return { getRooms: () => [r], scrollback: async (rm) => { const f = Math.max(0, next - per); rm.timeline = all.slice(f, next).concat(rm.timeline); next = f; } };
}
function pager(sb, client, folds) {
  return new Function("client", "_isSpineChannel", "inScope", "History", "_normaliseAll", "_channelRank", "Logger", "StreamManager",
    PAGE_SRC + "\nreturn pageRange;")(client, () => true, () => true, sb.History,
    (raw) => { const n = sb.StateDeriver && raw && raw.content ? [Object.assign({}, raw, { eventId: raw.event_id, type: JSON.parse(raw.content.body).t, content: JSON.parse(raw.content.body), ts: raw.ts })] : []; return n; },
    () => P, { warn() {} }, { foldsRoom: folds || (() => true) });
}
const queued = (H, st) => st;   // readability: refresh prunes added times to the live queue
const stateOf = (sb, evs, seed) => sb.StateDeriver.derive(evs, seed);

// ── PART A — ranges ─────────────────────────────────────────────────────────────────────────
{
  const sb = tree(); const H = sb.History; H.reset();
  const ev = room(sb, 30);
  H.ingest(ev.filter((e) => e.l <= 20), undefined);
  const cp = ev.find((e) => e.type === CP && e.content.floorL >= 40);
  H.ingest(ev.filter((e) => e.l > cp.content.floorL), cp.content.seed);
  const c = H.coverage();
  ok(c.ranges.length === 2 && c.complete === false, "A: a visit and a later save point with songs between them are TWO ranges, not one", c.ranges);
  ok(H.holes().some((h) => h[0] === 21 && h[1] === cp.content.floorL), "A: the stretch between them is a hole", H.holes());
  H.ingest(ev.filter((e) => e.l > 20 && e.l <= cp.content.floorL), ev.find((e) => e.type === CP && e.content.floorL === 20).content.seed);
  ok(H.coverage().ranges.length === 1, "A CONTROL: once the hole is read, the ranges merge into one", H.coverage().ranges);
}
// ── PART B — eviction lowers the claimed reach ──────────────────────────────────────────────
{
  const sb = tree(); const H = sb.History; H.reset();
  const rows = []; for (let i = 0; i < H.MAX + 10; i++) rows.push({ pi: "$r" + i, videoId: "v", dj: "@a:hs", at: 1000 + i, l: 100 + i });
  sb.History.restore({ v: 2, rows: rows.slice(0, 20), ranges: [[0, 119]], adds: {} });
  ok(H.coverage().complete === true, "B PREMISE — a table from the start is complete");
  H.restore({ v: 2, rows: rows, ranges: [[0, 100 + H.MAX + 9]], adds: {} });
  const c = H.coverage();
  ok(H.count() === H.MAX && c.fromL === 110 && c.complete === false,
    "B: evicting the oldest rows past MAX lowers the claimed reach to the oldest row kept, and it is no longer complete", { count: H.count(), fromL: c.fromL, complete: c.complete });
}
// ── PART C — playedWithin never decides past the reach ──────────────────────────────────────
function roomSandbox(H) {
  const sb = loadInContext(FILES.concat(["backends/backend1/capabilities.js", "features/room.js"]), {});
  sb.Queue = { recentHistory: () => H.recent(), historyReach: () => H.coverage(), historyAddedAt: (u, v, b) => H.addedAt(u, v, b) };
  sb.StreamManager = { getState: () => ({ settings: Object.assign(sb.StateDeriver.defaultSettings(), { repeatCooldownMs: 60 * MIN }), nowPlaying: null }) };
  return sb;
}
{
  const sb = tree(); const H = sb.History; H.reset();
  const NOW = 10000 * MIN;
  H.restore({ v: 2, ranges: [[0, 20], [50, 60]], adds: {}, rows: [
    { pi: "$old", videoId: "VVVVVVVVVVV", dj: "@a:hs", at: NOW - 30 * MIN, l: 10 },     // below the hole
    { pi: "$top", videoId: "XXXXXXXXXXX", dj: "@a:hs", at: NOW - 10 * MIN, l: 55 } ] });
  const R = roomSandbox(H);
  const v = R.Room.playedWithin("VVVVVVVVVVV", NOW);
  ok(v.known === false && v.blocked === false, "C: a play below a hole decides nothing — a newer one may sit in the hole: cannot tell, so it plays", v);
  H.restore({ v: 2, ranges: [[0, 60]], adds: {}, rows: [] });
  const w = R.Room.playedWithin("VVVVVVVVVVV", NOW);
  ok(w.blocked === true && w.known === true, "C CONTROL: once nothing lies between, the same play blocks", w);
}
// ── PART D — added times ────────────────────────────────────────────────────────────────────
{
  const sb = tree(); const H = sb.History; H.reset();
  const ev = room(sb, 6);
  H.attach({ log: () => ev, seed: () => undefined });
  H.refresh();
  const st = stateOf(sb, ev);
  const q = st.rotation.find((r) => r.pending.length);
  const qs = q.pending[0].videoId, qe = ev.find((e) => e.content && e.content.v === qs);
  ok(H.addedAt(q.user, qs, Infinity) === qe.ts, "D: a song still queued has its added time", { want: qe.ts, got: H.addedAt(q.user, qs, Infinity) });
  const np = st.nowPlaying, ne = ev.find((e) => e.content && e.content.v === np.song.videoId);
  ok(H.addedAt(np.dj, np.song.videoId, np.startedAt) === ne.ts, "D: the song now playing keeps its added time — the repeat rule asks at its start");
  const gone = ev.find((e) => e.eventId === "$add0");
  ok(H.addedAt(gone.sender, gone.content.v, Infinity) === null, "D: a song that has played and left the queue has no added time kept");
  H.reset(); H.noteAdds([F.reducerEvent("$q", 9, 500, "@z:hs", P, { t: "ddjp.dj.join", v: "zzzzzzzzzzz" })], () => false);
  ok(H.addedAt("@z:hs", "zzzzzzzzzzz", Infinity) === null, "D: a REFUSED add is not an added time");
}
// ── PART E — the five reload cases ──────────────────────────────────────────────────────────
{
  const mk = () => { const sb = tree(); sb.History.reset(); return sb; };
  const base = mk(); const EV = room(base, 60);
  const cps = EV.filter((e) => e.type === CP);
  const top = cps[cps.length - 1];                         // the newest save point
  const X = 40;                                            // the last visit's held log reached here
  const visit = (sb, held, seed, snap, client) => {
    const H = sb.History; H.reset();
    if (snap) H.restore(snap);
    H.attach({ log: () => held, seed: () => seed, pageRange: client ? pager(sb, client) : null, anchorOf: anchorOf });
    H.refresh();
    return H;
  };
  // E1 — added while present, then reload
  {
    const sb = mk(); const held = EV.filter((e) => e.l <= X);
    const H = visit(sb, held, undefined, null, null);
    const st = stateOf(sb, held); const q = st.rotation.find((r) => r.pending.length); const v0 = q.pending[0].videoId;
    const at0 = H.addedAt(q.user, v0, Infinity);
    const snap = JSON.parse(JSON.stringify(H.snapshot()));
    const sb2 = mk(); sb2.History.restore(snap);
    ok(at0 !== null && sb2.History.addedAt(q.user, v0, Infinity) === at0, "E1: added while present, then reload — the stored added time comes back", { at0, back: sb2.History.addedAt(q.user, v0, Infinity) });
  }
  // the last visit's stored table, for E2–E3
  const sbV = mk(); const HV = visit(sbV, EV.filter((e) => e.l <= X), undefined, null, null);
  const STORED = JSON.parse(JSON.stringify(HV.snapshot()));
  const HELD = EV.filter((e) => e.l > top.content.floorL);
  const stNow = stateOf(base, EV);
  // E2 — added while away, before the newest save point: arrives with the filled gap
  {
    const sb = mk(); const H = visit(sb, HELD, top.content.seed, STORED, sdk(EV, HELD.length, 100));
    ok(H.holes().some((h) => h[0] <= X + 1 && h[1] >= X + 1), "E2 PREMISE — the stretch between the visit and the save point is a hole", H.holes());
  }
  // E3 — added after the save point: the held log carries it
  {
    const sb = mk(); const H = visit(sb, HELD, top.content.seed, STORED, null);
    const a = HELD.find((e) => e.content && e.content.v && stNow.rotation.some((r) => r.user === e.sender && r.pending.some((p) => p.videoId === e.content.v)));
    ok(!!a && H.addedAt(a.sender, a.content.v, Infinity) === a.ts, "E3: added after the save point — the held log gives its added time", a && { want: a.ts, got: H.addedAt(a.sender, a.content.v, Infinity) });
  }
  E_ASYNC = (async () => {
    // E2 completion — fill the hole, then the add made while away is known
    {
      const sb = mk(); const H = visit(sb, HELD, top.content.seed, STORED, sdk(EV, HELD.length, 100));
      await H.fillGaps();
      const away = EV.filter((e) => e.l > X && e.l <= top.content.floorL && e.content && e.content.v &&
        stNow.rotation.some((r) => r.user === e.sender && r.pending.some((p) => p.videoId === e.content.v)));
      ok(H.coverage().complete === true, "E2: after the fill the table has no holes", H.coverage().ranges);
      ok(away.length > 0 && away.every((e) => H.addedAt(e.sender, e.content.v, Infinity) === e.ts),
        "E2: added while away, before the newest save point — the fill brings its added time", away.map((e) => [e.sender, e.content.v]));
    }
    // E4 — first visit, nothing stored: the fill reaches the start
    {
      const sb = mk(); const H = visit(sb, HELD, top.content.seed, null, sdk(EV, HELD.length, 100));
      await H.fillGaps();
      ok(H.coverage().complete === true && H.count() > 0, "E4: first visit with no stored history — filled to the room's start", H.coverage().ranges);
    }
    // E5 — a gap beyond the page limit: cannot tell, so the song plays. The limit is
    // max(40, ceil(MAX / 20)) = 250 pages; one event a page in a room ~430 deep leaves the bottom unread.
    {
      const sb = mk(); const EV5 = room(sb, 200); const cps5 = EV5.filter((e) => e.type === CP);
      const top5 = cps5[cps5.length - 1]; const HELD5 = EV5.filter((e) => e.l > top5.content.floorL);
      ok(EV5.length - HELD5.length > 250 + 40, "E5 PREMISE — the room is deeper than the page limit reaches", EV5.length);
      const H = visit(sb, HELD5, top5.content.seed, null, sdk(EV5, HELD5.length, 1));
      await H.fillGaps();
      ok(H.coverage().complete === false && H.holes().length > 0, "E5: a gap the page limit cannot reach stays a hole", H.coverage().ranges);
      const R = roomSandbox(H);
      const early = EV5.find((e) => e.eventId === "$play0"), earlyVid = EV5.find((e) => e.eventId === "$add0").content.v;
      const v = R.Room.playedWithin(earlyVid, early.ts + 10 * MIN);
      ok(v.known === false && v.blocked === false, "E5: and the repeat check says it cannot tell, so the song plays", v);
    }
  })();
}
var E_ASYNC;
// ── PART F — pageRange skips rooms the engine never folds, and says how far it got ──────────
const F_ASYNC = (async () => {
  const sb = tree();
  const ev = room(sb, 20);
  const a = { roomId: "!log:hs", timeline: ev.slice(-5).map((e) => ({ event: F.toRaw(e) })) };
  const b = { roomId: "!intents:hs", timeline: [] };
  let pagedB = 0, next = ev.length - 5;
  const client = { getRooms: () => [a, b], scrollback: async (rm) => { if (rm === b) { pagedB++; return; }
    const f = Math.max(0, next - 10); rm.timeline = ev.slice(f, next).map((e) => ({ event: F.toRaw(e) })).concat(rm.timeline); next = f; } };
  const pr = pager(sb, client, (id) => id === "!log:hs");
  const out = await pr(0, 999);
  ok(pagedB === 0, "F: a room the engine never folds is not paged at all", pagedB);
  ok(out.reachedFrom === 0, "F: a read that reached the room's start says so", out.reachedFrom);
})();
// ── PART G — the store cadence ──────────────────────────────────────────────────────────────
{
  const block = cut("  const PERSIST_DEBOUNCE_MS = 2000;", "  function _refreshHistory() {");
  const refresh = (() => { const i = MB.indexOf("  function _refreshHistory() {"); const j = MB.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? MB.slice(i, j + 4) : null; })();
  ok(!!block && !!refresh, "G PREMISE — the debounce and the refresh are extracted from the shipped file");
  let persisted = 0; const timers = [];
  const mk = new Function("History", "StreamManager", "Logger", "_tellFoldAboutCoverage", "_persistHistory", "setTimeout", "clearTimeout",
    // `_currentSpaceId` too: since J73 job 6b a pending save remembers the room it belongs to, and the
    // debounce block reads it. Undeclared, `_persistSoon` threw inside the refresh's try and G read nothing.
    "let _lastHistCount = -1; let _currentSpaceId = \"!r:hs\";\n" + block + refresh + "\nreturn { _persistSoon, persistHistoryNow, _refreshHistory };");
  const api = mk({ count: () => 3, refresh: () => ({}), coverage: () => ({ fromL: 0, toL: 9, complete: true }) },
    { getLog: () => [] }, { info() {}, warn() {} }, () => {}, () => { persisted++; },
    (fn) => { timers.push(fn); return timers.length; }, () => { timers.length = 0; });
  for (let i = 0; i < 5; i++) api._refreshHistory();
  ok(persisted === 0 && timers.length === 1, "G: five advances schedule ONE write, not five, and none yet", { persisted, timers: timers.length });
  timers.splice(0).forEach((f) => f());
  ok(persisted === 1, "G: the debounced write happens once", persisted);
  api._refreshHistory(); api.persistHistoryNow();
  ok(persisted === 2 && timers.length === 0, "G: a write asked for now happens now and cancels the pending one", { persisted, timers: timers.length });
  let hidden = 0; const listeners = {};
  const qs = loadInContext(["core/logger.js", "features/queue.js"], {
    document: { visibilityState: "visible", addEventListener: (t, f) => { listeners[t] = f; } },
    MatrixBridge: { persistHistoryNow: () => { hidden++; } } });
  ok(typeof listeners.visibilitychange === "function", "G PREMISE — the queue listens for the tab hiding");
  if (listeners.visibilitychange) { qs.document.visibilityState = "hidden"; listeners.visibilitychange(); }
  ok(hidden === 1, "G: when the tab hides the table is written at once", hidden);
}
Promise.all([E_ASYNC, F_ASYNC]).then(done, (e) => { failed++; console.log("[history-reach] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[history-reach] " + failed + " failure(s)"); process.exit(1); }
  console.log("[history-reach] PASS — song history says how far back it reaches and never decides past that (J73 job 6): " +
    "coverage is ranges with holes, eviction lowers the reach, a play below a hole decides nothing, added times are kept " +
    "while their song is queued or playing, the five reload cases hold, unfolded rooms are not paged, and the table is " +
    "stored after each advance (debounced) and when the tab hides (" + asserts + " assertions)");
  process.exit(0);
}
