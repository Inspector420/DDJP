#!/usr/bin/env node
// tests/check-history-reader.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js, core/historysummary.js
//
// WALL: DEVICES READ THE BOT'S SUMMARIES FIRST (737; the owner's design, `consensus/history-rules.md` §12, his words 4: "load all of
// the history channel until we reach the room start or 5000 (or room cap) cap and then we start looking at other channels"). Driven
// through the REAL bridge (`backfillHistory` → `_readSummaries` → `readChannelBack`) and the REAL `History`, in both engines, on the
// one bot-room world (`tests/_botroom.js`) and the shared-room world (`tests/_reopen.js`), with summaries the harness writes through
// the REAL format piece (`HistorySummary.summary`) from what a device reading the room the `ddjp_736` way derived. Every request is
// counted per channel (the SDK's `scrollback`).
//   A  A FIRST OPEN FROM SUMMARIES (bot room, past the window): the history channel read newest back, NO event read for the songs
//      the summaries hold (the events channel paged zero times by song history), verify reading none of their stretches; the table
//      the room's newest songs exactly; the rows inside the summaries' stretches the bot's; far fewer requests than the 736 way
//      (CONTROL: the same room opened with no history channel in the map pays them).
//   B  THE LIVE GAP AND A HOLE, THE 735 WAY: two summaries whose stretches do not meet leave a hole, filled from the nearest save
//      point at or below it (never deeper), its rows this device's own; the live gap after the newest summary this device's own.
//   C  A YOUNG ROOM STOPS AT ITS START: one request, the read stopped at the newest summary's count; the table holds every song;
//      `full` and `fromStart`, never `complete`.
//   D  A RELOAD READS ONLY WHAT IS NEW: it stops at the summary already held (stored with the table); then new summaries arrive and
//      a re-armed backfill takes those alone, with no request.
//   E  THE FOLD IS NEVER TOLD "COMPLETE" FROM SUMMARIES: `StreamManager.setHistoryComplete` receives `coverage().complete` — the room's
//      events reaching its start — and nothing else, never `full` or `fromStart` (bot rooms, window and young). CONTROL: a shared room
//      whose replay holds it from its start is told true.
//   F  A SUMMARY FROM A SENDER BELOW THE OWNER LEVEL IS IGNORED, and said once (an open and a re-arm say it once between them).
//   G  THE NEWEST SUMMARY FOR A PLAY WINS: a correction (a higher serial over the same stretch) replaces the older summary's row; a
//      play the correction leaves out leaves song history, and no later fold of this device puts it back.
//   H  A SUMMARY ROW REPLACES A DERIVED ONE, AND THE LOG SAYS SO ONCE (shared room: the held log's rows derived first): the bot's song
//      kept, one line naming the play and both songs, never again as the device derives it again; a row of this device inside a
//      summary's stretch that the summary does not name leaves, said once.
//   I  A COUNT NEVER MET (a lying or truncated bot) costs at most the read-back's own cap ONCE, and a reload does not read it again
//      (it stops at the held serial).
//   J  THE REPLAY RULE (`Room.playedWithin`) READS THE START HELD: in a young room held from its start by the bot's count, a song
//      never played is "not played" (known), as in a room read to its start; one a summary names is "played".
// RED FIRST on `ddjp_736`: no format piece, no reader — the history channel is never read and song history pages the 736 way.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));
const RO = require(path.join(__dirname, "_reopen.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-reader] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 700) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-reader] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const HIST = "!hist:hs", MIN = 60000, PER = 15;
const ORDER = ["core/historysummary.js"].concat(B.ORDER);
const raw = (roomId, sender, body, id, ts) => ({ type: "m.room.message", event_id: id, room_id: roomId, sender: sender, origin_server_ts: ts,
  content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body)) } });

// ── A BOT ROOM ON ONE HOMESERVER (the bot's tab seals its save points, as `check-queue-redraw` K does) ─────────────────────────────
function botRoom(settings) {
  const BC = B.BOT_CH;
  const server = { [B.SPACE]: [], [BC.events_uncategorized]: [], [BC.events_owner]: [], [BC.settings_owner]: [], [HIST]: [] };
  const R = { server, BC, L: 0, TS: 1792447900000, nIn: 0, pi: null, k: 0, live: [], seals: [], plays: [], n: 0, from: 0, done: 0, cursor: 0 };
  R.post = (roomId, sender, body) => { R.L++; R.TS += (body.t === "ddjp.dj.play" ? 4 * MIN : 1000);
    const r = raw(roomId, sender, Object.assign({}, body, { l: R.L }), "$k" + String(R.L).padStart(6, "0"), R.TS);
    server[roomId].push(r); for (const d of R.live) d.live(r); return r; };
  R.bot = B.world({ me: B.BOT, server, opened: false, order: B.ORDER.filter((f) => f !== "backends/backend1/history.js") });
  const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++R.nIn), at: null });
  R.key = () => "yt:v" + String(++R.k).padStart(10, "0");
  R.join = (who, v) => R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v.slice(3) }, who, R.PL));
  R.play = () => { const r = R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.play", p: R.pi }, B.BOT, 99)); R.pi = r.event_id; R.plays.push({ pi: r.event_id, l: R.L }); return r; };
  R.song = (s) => { R.play(); R.join("@d" + (s % 3) + ":hs", R.key()); };
  R.seal = () => { const log = R.bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = R.bot.sb.B2Checkpoint.seal(R.bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); R.post(BC.events_owner, B.BOT, out.cp); R.seals.push(head.l); };
  R.start = async () => { await R.bot.open(); R.live.push(R.bot); R.PL = R.bot.sb.Ranks.levelOf("player");
    R.post(BC.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(R.bot.sb.StateDeriver.defaultSettings(), { vis: "public" }, settings || {}) });
    for (let k = 0; k < 3; k++) R.join("@d" + k + ":hs", R.key()); };
  R.build = async (songs, every) => { await R.start(); for (let s = 0; s < songs; s++) { R.song(s); if ((s + 1) % every === 0) R.seal(); } R.song(songs); R.song(songs + 1); };
  // A SUMMARY ON THE HISTORY CHANNEL, as the bot posts one: the rows handed, the stretch, the room's count; `o.sender`, `o.n`, `o.from`.
  R.summary = (HS, rows, to, count, o) => {
    o = o || {};
    const n = (o.n !== undefined) ? o.n : ++R.n;
    const body = HS.summary({ n: n, from: (o.from !== undefined) ? o.from : R.from, to: to, count: count, rows: rows });
    if (o.from === undefined) R.from = to + 1;
    R.TS += 10;
    const r = raw(HIST, o.sender || B.BOT, Object.assign({}, body, { t: HS.TYPE, l: R.L }), "$h" + String(R.server[HIST].length + 1).padStart(6, "0"), R.TS);
    R.server[HIST].push(r);
    return r;
  };
  // Every ended play not yet summarised but the newest `gap`, PER a summary, its rows as `rowOf` gives each; `skip(n)` leaves one unsent.
  R.summarise = (HS, rowOf, gap, size, skip) => {
    const endIdx = R.plays.length - 1 - gap;
    while (endIdx - R.cursor >= PER) {
      const g = R.plays.slice(R.cursor, R.cursor + PER); R.cursor += PER; R.done += g.length;
      const to = R.plays[R.cursor].l - 1, count = Math.min(R.done, size || 5000);
      if (skip && skip(R.n + 1)) { R.n++; R.from = to + 1; continue; }
      R.summary(HS, g.map(rowOf), to, count);
    }
  };
  return R;
}
// A DEVICE of that room: the real modules with the format piece, its SDK requests counted by channel; `hist` adds the room's song
// history channel to its map (the Space lists it; the opening maps it by its mark), as `features/room.js` hands the bridge.
function device(R, o) {
  o = o || {};
  // the replay rule's reads (`Room.playedWithin` → `Queue`), through the real transport — the queue is a stand-in in this world
  const qh = {};
  const extras = { Queue: { recentHistory: (n) => qh.w.sb.MatrixBridge.roomHistory(n), historyReach: () => qh.w.sb.MatrixBridge.historyCoverage(), historyAddedAt: () => null } };
  const w = o.reloadOf ? o.reloadOf.reload({ order: ORDER, me: o.me || B.OWNER, extras: extras }) : B.world({ me: o.me || B.OWNER, server: R.server, opened: false, order: ORDER, extras: extras });
  qh.w = w;
  const m = { calls: 0, byRoom: {}, low: {} };
  const s0 = w.client.scrollback;
  w.client.scrollback = async (room, n) => {
    const before = room.timeline.length; await s0(room, n);
    m.calls++; m.byRoom[room.roomId] = (m.byRoom[room.roomId] || 0) + 1;
    for (const ev of room.timeline.slice(0, room.timeline.length - before)) { try { const b = JSON.parse(ev.event.content.body); if (typeof b.l === "number" && !(m.low[room.roomId] <= b.l)) m.low[room.roomId] = b.l; } catch (e) {} }
  };
  w.m = m; w.mark = () => ({ calls: m.calls, byRoom: Object.assign({}, m.byRoom) });
  w.since = (k) => { const out = { calls: m.calls - k.calls }; for (const id of Object.keys(m.byRoom)) out[id] = m.byRoom[id] - (k.byRoom[id] || 0); return out; };
  if (o.hist !== false) { B.addRoom(w, B.SPACE, { history_owner: HIST }); w.sb.MatrixBridge.addToRoomScope(HIST); w.sb.MatrixBridge.wireCheckpoints(Object.assign({}, w.CH, { history_owner: HIST })); }
  // THE FOLD'S EAR (part E): every report song history makes to it, beside the coverage at that moment.
  w.told = [];
  w.sb.StreamManager.setHistoryComplete = ((prev) => function (v) { w.told.push({ v: v, cov: w.sb.History.coverage() }); if (typeof prev === "function") return prev.apply(null, arguments); })(w.sb.StreamManager.setHistoryComplete);
  return w;
}
// OPENING as the room does it: the replay (its own requests), the save point, LIVE, then song history's backfill — measured alone.
async function open(w, R) {
  await Promise.allSettled(Object.keys(w.CH).map((k) => w.sb.MatrixBridge.replayRoom(w.CH[k])));
  if (w.sb.StreamManager.openFromSavePoint) w.sb.StreamManager.openFromSavePoint();
  w.goLive();
  if (R && R.live.indexOf(w) < 0) R.live.push(w);
  const k = w.mark(), l0 = w.logs.length;
  w.m.low = {};
  await w.sb.MatrixBridge.backfillHistory();
  return { req: w.since(k), said: w.logs.slice(l0), low: Object.assign({}, w.m.low) };
}
async function rearm(w) { const k = w.mark(), l0 = w.logs.length; w.sb.MatrixBridge.rearmHistoryBackfill(); await w.sb.MatrixBridge.backfillHistory(); return { req: w.since(k), said: w.logs.slice(l0) }; }
const lines = (said, re) => said.filter((m) => re.test(m));
const truthOf = (w) => new Map(w.sb.History.recent(100000).map((h) => [h.pi, h]));
const rowFrom = (truth) => (p) => { const r = truth.get(p.pi);
  return r ? { pi: r.pi, l: r.l, songKey: r.songKey, dj: r.dj, at: r.at, endedAt: r.endedAt, counts: r.counts || { votes: 0, saves: 0 }, cutShortBy: r.cutShortBy, endedBy: r.endedBy }
    : { pi: p.pi, l: p.l, songKey: "yt:oldoldoldol", dj: "@d0:hs", at: 1, counts: { votes: 0, saves: 0 }, cutShortBy: false }; };
const exactNewest = (w, R, k) => w.sb.History.recent(100000).map((h) => h.pi).sort().join() === R.plays.slice(-k).map((p) => p.pi).sort().join();

// ── A (and E, F) — A FIRST OPEN FROM SUMMARIES, PAST THE WINDOW ──────────────────────────────────────────────────────────────────
let WROOM = null;
part("A", async () => {
  const SIZE = 1000, R = botRoom({ historySize: SIZE });
  await R.build(1300, 40);
  const ref = device(R, { hist: false });
  const oc = await open(ref);
  ok(oc.req.calls > 10 && ref.sb.History.count() === SIZE && exactNewest(ref, R, SIZE),
    "A CONTROL — the same room opened with no history channel in its map (the `ddjp_736` way) pages the window from the events: " + oc.req.calls + " request(s)", oc.req);
  const HS = ref.sb.HistorySummary;
  ok(!!HS, "A PREMISE — the device holds the format piece (`HistorySummary`)");
  if (!HS) return;
  R.summarise(HS, rowFrom(truthOf(ref)), 12, SIZE);
  // F: a summary from a sender below the owner level, NEWEST, naming the newest summarised plays with other songs
  const last = R.plays.slice(R.cursor - PER, R.cursor);
  R.summary(HS, last.map((p) => Object.assign(rowFrom(truthOf(ref))(p), { songKey: "yt:liarliarlia" })), R.from - 1, SIZE, { sender: B.STAFF, n: 9999, from: last[0].l });
  const d = device(R);
  const o = await open(d, R);
  const H = d.sb.History, cov = H.coverage();
  const newest = R.server[HIST].map((r) => JSON.parse(r.content.body)).filter((b) => b.n !== 9999).pop();
  ok(lines(o.said, /read the song history channel back in \d+ request\(s\): \d+ summaries from the bot taken/).length === 1,
    "A: THE HISTORY CHANNEL IS READ FIRST — one line says how many requests and summaries", lines(o.said, /song history channel/));
  ok((o.req[R.BC.events_owner] || 0) === 0 && (o.req[HIST] || 0) >= 1 && (o.req[HIST] || 0) <= 2,
    "A: NO EVENT IS READ FOR THE SONGS THE SUMMARIES HOLD — song history pages the events channel zero times, the history channel " + (o.req[HIST] || 0) + " time(s)", o.req);
  ok(o.req.calls * 5 <= oc.req.calls, "A: A FIRST OPEN COSTS A FIFTH OR LESS OF THE 736 WAY — " + o.req.calls + " request(s) against " + oc.req.calls, [o.req.calls, oc.req.calls]);
  ok(lines(o.said, /held by the bot's summaries \(nothing read\)/).length === 1, "A: VERIFY READS NONE OF THEIR STRETCHES — it says which it left to the summaries", lines(o.said, /verified/));
  ok(H.count() === SIZE && exactNewest(d, R, SIZE), "A: THE TABLE IS THE ROOM'S NEWEST " + SIZE + " SONGS, EXACTLY", H.count());
  const rows = H.recent(100000);
  const inside = rows.filter((r) => r.l <= newest.to), above = rows.filter((r) => r.l > newest.to);
  ok(inside.length > 400 && inside.every((r) => r.src === "summary" && typeof r.sum === "number") && above.length >= 10 && above.every((r) => r.src !== "summary"),
    "A: THE ROWS IN THE SUMMARIES' STRETCHES ARE THE BOT'S (`src: summary`), THE LIVE GAP'S THIS DEVICE'S OWN", { inside: inside.length, above: above.length, srcAbove: above.map((r) => r.src).slice(0, 4) });
  ok(cov.full && !cov.complete && cov.windowFrom !== null, "A: the window held — `full`, never `complete`", cov);
  // E: the fold heard only `complete`
  ok(d.told.length >= 1 && d.told.every((t) => t.v === t.cov.complete) && d.told.every((t) => t.v !== true),
    "E (bot room, the window): THE FOLD IS TOLD `complete` ALONE — never true from summaries, never `full`", d.told.map((t) => [t.v, t.cov.complete, t.cov.full]));
  // F: the low sender's summary
  ok(!rows.some((r) => r.songKey === "yt:liarliarlia") && rows.every((r) => r.sum !== 9999),
    "F: A SUMMARY FROM A SENDER BELOW THE OWNER LEVEL IS IGNORED — none of its rows taken", rows.filter((r) => r.sum === 9999).length);
  const ign = (said) => lines(said, /a message on the song history channel was ignored \(\$h\d+, ddjp\.side\.history\.summary, from @staff:hs\) — its sender is below level 99/);
  const o2 = await rearm(d);
  ok(ign(o.said).length === 1 && ign(o2.said).length === 0, "F: …AND SAID ONCE — the open says it, the re-armed backfill does not again", [ign(o.said).length, ign(o2.said).length]);
  WROOM = { R, ref, d, HS, SIZE };
});

// ── B — THE LIVE GAP AND A HOLE, THE 735 WAY ─────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  if (!WROOM) { ok(false, "B PREMISE — part A built its room"); return; }
  const SIZE = 500, R = botRoom({ historySize: SIZE });
  await R.build(700, 40);
  const ref = device(R, { hist: false }); await open(ref);
  const HS = ref.sb.HistorySummary;
  const total = Math.floor((R.plays.length - 13) / PER), holeAt = total - 12;   // two summaries well inside the window left unsent
  R.summarise(HS, rowFrom(truthOf(ref)), 12, SIZE, (n) => n === holeAt || n === holeAt + 1);
  const bodies = R.server[HIST].map((r) => JSON.parse(r.content.body));
  const before = bodies.filter((b) => b.n < holeAt).pop(), after = bodies.find((b) => b.n > holeAt + 1);
  ok(before && after && after.from > before.to + 1, "B PREMISE — two summaries whose stretches do not meet: a hole at l=" + (before && before.to + 1) + ".." + (after && after.from - 1), [before && before.to, after && after.from]);
  const d = device(R);
  const o = await open(d, R);
  const H = d.sb.History, a = before.to + 1, b = after.from - 1;
  const holeRows = H.recent(100000).filter((r) => r.l >= a && r.l <= b);
  const anchor = R.seals.filter((l) => l < a).pop();
  ok(H.count() === SIZE && exactNewest(d, R, SIZE), "B: THE HOLE IS FILLED — the room's newest " + SIZE + " exactly", H.count());
  ok(holeRows.length >= 25 && holeRows.every((r) => r.src !== "summary"), "B: ITS ROWS ARE THIS DEVICE'S OWN, computed the 735 way", holeRows.map((r) => r.src).slice(0, 5));
  const below = R.seals.filter((l) => l < anchor).pop();   // the save point before that one: a read reaching it went a stretch too deep
  ok((o.req[R.BC.events_owner] || 0) >= 1 && typeof o.low[R.BC.events_owner] === "number" && o.low[R.BC.events_owner] > below,
    "B: FROM THE NEAREST SAVE POINT AT OR BELOW IT — the events read reach l=" + o.low[R.BC.events_owner] + ", above the save point before that one (l=" + below + "; the nearest, l=" + anchor + ")", { req: o.req, low: o.low, anchor, a, b, said: o.said.filter((x) => /history/.test(x)) });
  const newest = bodies[bodies.length - 1];
  const gap = H.recent(100000).filter((r) => r.l > newest.to);
  ok(gap.length >= 10 && gap.every((r) => r.src !== "summary"), "B: THE LIVE GAP AFTER THE NEWEST SUMMARY IS THIS DEVICE'S OWN", gap.map((r) => r.src).slice(0, 4));
});

// ── C (and E, J) — A YOUNG ROOM STOPS AT ITS START ───────────────────────────────────────────────────────────────────────────────
let YOUNG = null;
const COOL = 30 * 24 * 60 * 60 * 1000;   // the replay rule's longest cooldown: longer than this young room has lived
part("C", async () => {
  const R = botRoom({ repeatCooldownMs: COOL });
  await R.build(120, 40);
  const ref = device(R, { hist: false }); await open(ref);
  const HS = ref.sb.HistorySummary;
  R.summarise(HS, rowFrom(truthOf(ref)), 12, 5000);
  const d = device(R);
  const o = await open(d, R);
  const H = d.sb.History, cov = H.coverage();
  ok((o.req[HIST] || 0) === 1 && lines(o.said, /song\(s\) — the room's start reached\)/).length === 1,
    "C: ONE REQUEST, THE READ STOPPED AT THE NEWEST SUMMARY'S COUNT — \"the room's start reached\"", { req: o.req, said: lines(o.said, /song history channel/) });
  ok(H.count() === R.plays.length && exactNewest(d, R, R.plays.length), "C: THE TABLE HOLDS EVERY SONG THE ROOM HAS HAD", [H.count(), R.plays.length]);
  ok(cov.full && cov.fromStart && !cov.complete && cov.summaries && cov.summaries.met, "C: `full` and `fromStart` — the start held by the count — and never `complete`", cov);
  R.song(150);   // a song: refresh writes, and tells the fold what song history holds now
  const lastTold = d.told[d.told.length - 1];
  ok(d.told.every((t) => t.v === t.cov.complete && t.v !== true) && lastTold && lastTold.cov.fromStart === true && lastTold.cov.full === true && lastTold.v === false,
    "E (bot room, young): THE FOLD IS TOLD `complete` ALONE — `false` while the start is held by the bot's count (`fromStart`, `full`), never true", d.told.map((t) => [t.v, t.cov.complete, t.cov.fromStart]));
  // J: THE REPLAY RULE READS THE START HELD — a song never played answers "not played" (known), as in a room read to its start;
  // one that played answers "played". CONTROL: the same question of the reference tab, which read the room to its start (`complete`).
  const now = R.TS + 60000;
  const never = d.sb.Room.playedWithin("yt:neverplayed1", now), ctl = ref.sb.Room.playedWithin("yt:neverplayed1", now);
  const one = d.sb.History.recent(100000).find((r) => r.l < 100 && r.songKey);
  const played = one ? d.sb.Room.playedWithin(one.songKey, now) : null;
  ok(ctl && ctl.known === true && ctl.reason === "not-played", "J PREMISE — the reference tab, read to its start, answers \"not played\"", ctl);
  ok(never && never.known === true && never.reason === "not-played" && never.complete === true,
    "J: A YOUNG ROOM HELD FROM ITS START BY THE BOT'S COUNT ANSWERS \"NOT PLAYED\" — known, as one read to its start (`fromStart`)", never);
  ok(played && played.blocked === true && played.reason === "played" && one.src === "summary", "J: and a song a summary names, played", played);
  YOUNG = { R, d, ref, HS };
});

// ── D — A RELOAD READS ONLY WHAT IS NEW ──────────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  if (!YOUNG) { ok(false, "D PREMISE — part C built its room"); return; }
  const { R, d, HS } = YOUNG;
  d.sb.MatrixBridge.persistHistoryNow();   // as a tab does when it hides (and as the reload below does first)
  const top = d.sb.History.summaryTop();
  ok(typeof top === "number" && top === R.n && JSON.stringify(d.stored.snap.sums || []).indexOf("\"n\":" + top) >= 0,
    "D PREMISE — the newest serial taken is stored with the table", { top, n: R.n });
  const d2 = device(R, { reloadOf: d });
  const o = await open(d2, R);
  ok((o.req[HIST] || 0) <= 1 && lines(o.said, new RegExp("nothing newer than the summary already held \\(n=" + top + "\\)")).length === 1 && d2.sb.History.count() === R.plays.length,
    "D: A RELOAD STOPS AT THE SUMMARY ALREADY HELD — " + (o.req[HIST] || 0) + " request(s), nothing taken, nothing lost", { req: o.req, said: lines(o.said, /song history channel/) });
  // two more summaries arrive (sync puts them in the channel's timeline) after more songs; the next backfill takes those two alone
  for (let s = 0; s < 32; s++) R.song(200 + s);
  const ref2 = device(R, { reloadOf: YOUNG.ref, hist: false }); await open(ref2);
  const n0 = R.n, len0 = R.server[HIST].length;
  R.summarise(HS, rowFrom(truthOf(ref2)), 1, 5000);
  const fresh = R.server[HIST].slice(len0);
  const kNew = R.n - n0;
  ok(kNew >= 2 && fresh.length === kNew, "D PREMISE — new summaries posted (" + kNew + ")", kNew);
  for (const r of fresh) d2.rooms[HIST].timeline.push(B.mev(r));
  const re = await rearm(d2);
  ok((re.req[HIST] || 0) === 0 && lines(re.said, new RegExp(": " + kNew + " summaries from the bot taken .*stopped at the summary already held")).length === 1,
    "D: A RE-ARMED BACKFILL TAKES THE NEW ONES ALONE, WITH NO REQUEST — and stops at the one already held", { req: re.req, said: lines(re.said, /song history channel/) });
  ok(d2.sb.History.summaryTop() === R.n, "D: and the newest it holds is the newest posted", [d2.sb.History.summaryTop(), R.n]);
});

// ── G — THE NEWEST SUMMARY FOR A PLAY WINS ───────────────────────────────────────────────────────────────────────────────────────
part("G", async () => {
  const R = botRoom();
  await R.build(60, 40);
  const ref = device(R, { hist: false }); await open(ref);
  const HS = ref.sb.HistorySummary, truth = truthOf(ref), row = rowFrom(truth);
  const g1 = R.plays.slice(0, PER), to1 = R.plays[PER].l - 1;
  R.summary(HS, g1.map((p, i) => i === 2 ? Object.assign(row(p), { counts: { votes: 1, saves: 0 } }) : row(p)), to1, PER);
  const g2 = R.plays.slice(PER, 2 * PER), to2 = R.plays[2 * PER].l - 1;
  R.summary(HS, g2.map(row), to2, 2 * PER);
  // the correction: a higher serial over the first stretch — the third play's votes 5, the seventh play left out
  R.summary(HS, g1.filter((p, i) => i !== 6).map((p, i) => i === 2 ? Object.assign(row(p), { counts: { votes: 5, saves: 0 } }) : row(p)), to1, PER, { from: 0 });
  const d = device(R);
  const o = await open(d, R);
  ok(lines(o.said, /: 3 summaries from the bot taken \(newest n=2, /).length === 1,
    "G PREMISE — all three read (the correction's count is its old stretch's: the read goes on to the newest stretch's count)", lines(o.said, /song history channel/));
  const by = new Map(d.sb.History.recent(100000).map((r) => [r.pi, r]));
  const third = by.get(g1[2].pi);
  ok(third && third.counts && third.counts.votes === 5 && third.sum === R.n, "G: THE NEWEST SUMMARY NAMING A PLAY WINS — the correction's votes (5), from its serial", third);
  ok(!by.has(g1[6].pi), "G: A PLAY THE CORRECTION LEAVES OUT LEAVES SONG HISTORY", by.get(g1[6].pi));
  R.song(500); await rearm(d);
  ok(!new Map(d.sb.History.recent(100000).map((r) => [r.pi, r])).has(g1[6].pi), "G: …and no later fold of this device puts it back (a re-armed backfill and a new song later)");
  ok(lines(o.said, /is not in the bot's summar/).length <= 1, "G: (said at most once)", lines(o.said, /is not in the bot's summar/));
});

// ── H (and E's control) — A SUMMARY ROW REPLACES A DERIVED ONE; THE LOG SAYS SO ONCE (shared room) ─────────────────────────────────
part("H", async () => {
  const R = RO.room();
  const O = R.tab(B.OWNER, { w: { order: ORDER.filter((f) => f !== "backends/backend1/history.js") } });
  await O.open();
  R.put(B.OWNER, { t: "ddjp.room.settings", s: Object.assign(O.sb.StateDeriver.defaultSettings(), { checkpointCooldownMs: 0 }) });
  let prev = null, k = 0; const plays = [];
  const song = () => "yt:v" + String(++k).padStart(10, "0");
  for (const u of ["@d0:hs", "@d1:hs", "@d2:hs"]) R.put(u, { t: "ddjp.dj.join", v: song() });
  const one = (s) => { R.now += 4 * MIN; prev = R.put(B.OWNER, { t: "ddjp.dj.play", p: prev }).event_id; plays.push({ pi: prev, l: R.L }); R.put("@d" + (s % 3) + ":hs", { t: "ddjp.dj.join", v: song() }); };
  for (let s = 0; s < 34; s++) one(s);
  const D = R.tab(B.STAFF, { detached: true, w: { opened: false, order: ORDER } });
  B.addRoom(D, B.SPACE, { history_owner: HIST }); D.sb.MatrixBridge.addToRoomScope(HIST); D.sb.MatrixBridge.wireCheckpoints(Object.assign({}, D.CH, { history_owner: HIST }));
  D.told = []; D.sb.StreamManager.setHistoryComplete = ((p0) => function (v) { D.told.push({ v: v, cov: D.sb.History.coverage() }); return p0.apply(null, arguments); })(D.sb.StreamManager.setHistoryComplete);
  // the truth, from a reference tab reading it the 736 way
  const T = R.tab(B.ADMIN, { detached: true, w: { opened: false, order: ORDER } }); await T.open();
  const HS = T.sb.HistorySummary, row = rowFrom(truthOf(T));
  R.server[HIST] = [];
  const mk = (n, g, to, count, fix) => { const body = HS.summary({ n: n, from: g.from, to: to, count: count, rows: g.rows.map((p, i) => fix ? fix(row(p), i) : row(p)) });
    R.server[HIST].push(raw(HIST, B.BOT, Object.assign({}, body, { t: HS.TYPE, l: R.L }), "$sh" + n, (R.now += 10))); };
  mk(1, { from: 0, rows: plays.slice(0, PER) }, plays[PER].l - 1, PER, (r, i) => (i === 4 ? Object.assign(r, { songKey: "yt:botbotbotbo" }) : r));
  mk(2, { from: plays[PER].l, rows: plays.slice(PER, 2 * PER).filter((p, i) => i !== 3) }, plays[2 * PER].l - 1, 2 * PER);
  await D.open();
  const by = () => new Map(D.sb.History.recent(100000).map((r) => [r.pi, r]));
  const fifth = by().get(plays[4].pi), dropped = plays[PER + 3];
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const differ = (from) => D.said(new RegExp("the bot's summary n=1 says " + esc(plays[4].pi) + " at l=" + plays[4].l + ": songKey yt:botbotbotbo \\(this device: yt:v\\d+\\); this device's row came from \\w+ — the bot's row is kept"), from);
  ok(fifth && fifth.songKey === "yt:botbotbotbo" && fifth.src === "summary", "H: THE BOT'S ROW REPLACES THIS DEVICE'S DERIVED ONE (the held log's, derived first)", fifth);
  ok(differ().length === 1, "H: AND THE LOG SAYS SO ONCE — the play, the field, both songs, where this device's row came from", D.said(/the bot's summary n=/));
  ok(!by().has(dropped.pi) && D.said(new RegExp("\\" + dropped.pi + " at l=" + dropped.l + " \\(yt:v\\d+, from \\w+\\) is not in the bot's summary n=2 \\(l=\\d+\\.\\.\\d+\\) — it leaves song history")).length === 1,
    "H: A ROW OF THIS DEVICE IN A SUMMARY'S STRETCH THAT THE SUMMARY DOES NOT NAME LEAVES, SAID ONCE", { has: by().has(dropped.pi), said: D.said(/not in the bot's summar/) });
  const l0 = D.logs.length;
  R.tabs.push(D); one(40); one(41);
  D.sb.MatrixBridge.rearmHistoryBackfill(); await D.sb.MatrixBridge.backfillHistory();
  ok(by().get(plays[4].pi).songKey === "yt:botbotbotbo" && !by().has(dropped.pi) && differ(l0).length === 0 && D.said(/not in the bot's summar/, l0).length === 0,
    "H: NEVER AGAIN — new songs refresh the held log and a re-armed backfill derives it again: the bot's row stays, the left one stays out, nothing said twice",
    { said: D.said(/bot's summar/, l0) });
  ok(D.told.some((t) => t.v === true && t.cov.complete === true) && D.told.every((t) => t.v === t.cov.complete),
    "E CONTROL (shared room): A ROOM WHOSE REPLAY HOLDS IT FROM ITS START IS TOLD TRUE — `complete`, the events', and only it", D.told.map((t) => [t.v, t.cov.complete]));
});

// ── I — A COUNT NEVER MET COSTS THE READ-BACK'S CAP ONCE ─────────────────────────────────────────────────────────────────────────
part("I", async () => {
  const R = botRoom();
  await R.build(30, 40);
  const ref = device(R, { hist: false }); await open(ref);
  const HS = ref.sb.HistorySummary;
  // the channel: more than the read-back's cap of other events (no message the reader is asked about), then one summary claiming 5000
  for (let i = 0; i < 25300; i++) R.server[HIST].push({ type: "m.room.member", event_id: "$m" + i, room_id: HIST, sender: "@x" + i + ":hs", origin_server_ts: R.TS + i, content: { membership: "join" } });
  R.TS += 30000;
  R.summary(HS, R.plays.slice(0, PER).map(rowFrom(truthOf(ref))), R.plays[PER].l - 1, 5000, { from: 0 });
  const d = device(R);
  const o = await open(d, R);
  ok((o.req[HIST] || 0) > 100 && (o.req[HIST] || 0) <= 250 && lines(o.said, /stopped at the read-back's limit, short of the count/).length === 1,
    "I: A COUNT NEVER MET COSTS AT MOST THE READ-BACK'S OWN CAP — " + (o.req[HIST] || 0) + " request(s), said so", { req: o.req[HIST], said: lines(o.said, /song history channel/) });
  ok(d.sb.History.summaryTop() === R.n && d.sb.History.count() === R.plays.length, "I: the summary is taken (its serial held) and the room's songs are all in song history (the fill, the 735 way)",
    [d.sb.History.summaryTop(), d.sb.History.count(), R.plays.length]);
  const d2 = device(R, { reloadOf: d });
  const o2 = await open(d2, R);
  ok((o2.req[HIST] || 0) <= 1 && lines(o2.said, /nothing newer than the summary already held/).length === 1,
    "I: …ONCE — a reload stops at the held serial: " + (o2.req[HIST] || 0) + " request(s)", { req: o2.req[HIST], said: lines(o2.said, /song history channel/) });
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { ok(false, name + ": threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[history-reader] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-reader] PASS — devices read the bot's summaries first (737, `consensus/history-rules.md` §12; " + asserts + " assertions, through the real " +
    "bridge and History, both engines, every request counted): A FIRST OPEN FROM SUMMARIES reads the history channel and no event for the songs " +
    "they hold, verify none of their stretches, the newest songs exactly, a fifth or less of the 736 way (control); THE LIVE GAP AND A HOLE " +
    "computed the 735 way, from the nearest save point; A YOUNG ROOM stops at its start in one request (`fromStart`, never `complete`); A " +
    "RELOAD stops at the summary already held and a re-arm takes only the new; THE FOLD is told `complete` alone (control: a shared room " +
    "read to its start is told true); A LOW SENDER ignored and said once; THE NEWEST SUMMARY WINS and a play a correction leaves out stays " +
    "out; A SUMMARY ROW REPLACES A DERIVED ONE, said once, and a row it does not name leaves, said once; A COUNT NEVER MET costs the " +
    "read-back's cap once; THE REPLAY RULE reads the start held by the count.");
})();
