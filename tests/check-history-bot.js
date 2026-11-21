#!/usr/bin/env node
// tests/check-history-bot.js
// SUBJECT: features/history-bot.js, features/history-ports.js, backends/backend1/history.js, backends/backend1/matrixbridge.js, core/store.js
//
// WALL: THE ROOM'S BOT WRITES THE SONG HISTORY SUMMARIES AND FILLS THEIR HOLES, AND CORRECTS NOTHING AFTER (738; 740; the owner's design,
// `consensus/history-rules.md` §12, his words in `main/01-project.md` item 7: "the bot should try to repair from the hsitory of events",
// "oldest first? … (maybe 10 seconds appart?)", "the bot says 3 songs in histroy batch and once it reaches 5000 itself just posts that every
// time", "the bot also repairs holes and trust itself to forget too"; and at 740, in §12: "the bot can correct holes in the timeline, but yes
// noting to correct after"). Driven through the REAL modules — both engines behind the real seam, song history, the bridge's reader
// and `sendSide`, the real bot side (`features/history-bot.js` through `features/history-ports.js`) and the format (`core/historysummary.js`)
// — on the one bot-room world (`tests/_botroom.js`) and, for a shared room with a bot account, the same world in the shared engine. The
// bot's echo is handed back as `_routeEvent`'s history branch hands one on (`check-history-channel` A drives that branch): to the raw
// listeners only, into the channel's timeline, and onto the server. Server time is the room's newest stamp; the bot's timers are captured.
//   A  A SUMMARY EVERY N SONGS (bot room, N = 5): each carries N finished songs, UP TO THE SONG THAT JUST ENDED — sent when the (N+1)th
//      song starts, none held back (740; 738 waited one song) — its stretch from just above the one before (0 for the first) to just below
//      the song playing, the rows what a device reading the room the `ddjp_736` way derives, the count the songs up to its end; each
//      marked on the bot's own tab only once its echo is read back. The bot's lines say each.
//   B  ONLY THE BOT WRITES: the owner's tab with the same modules (the runtime says it is not the bot) sends nothing and never starts; a
//      bot tab in a room whose map has no song history channel never starts.
//   C  MARKED ONLY WHEN READ BACK; A FAILED SEND IS OWED: a refused send marks nothing, is said, and is sent again no sooner than the
//      spacing (10 s), which doubles after a second failure; a send whose echo is late is not marked, and nothing else goes, until a
//      read-back finds it on the server; a send that never reached the server is owed again 30 s later and re-sent under a new serial.
//   D  OFFLINE, THEN BACK (shared room, the bot an account in it): a hole it left (a lost send) and the songs played while its tab was
//      closed are sent OLDEST FIRST, one in flight (the second only once the first is read back), at least 10 s apart; a device that
//      opens then holds exactly the room, every song inside a summary's stretch from the bot's summaries.
//   E  A LATE VOTE, AND NO CORRECTION (740): a vote on a song already summarised lands after its song ended — the room refuses it and the bot
//      sends nothing for it, its row unchanged; the summary of the song that just ended carries the vote cast while it played and not the
//      last-second one landing after the next song started. No stretch is ever sent twice for what the bot reads of it, and a device holds
//      the bot's rows.
//   F  THE HISTORY SIZE LOWERED AND RAISED (bot room past the size): the count is the size once the window is held and never more; raised,
//      a DEVICE does not read the old count as the room's start (737 did) — neither one live through the raise nor one opening after it —
//      and fills to the new window, exact; the bot sends its newest stretch again with the new count (still sent at 740: it is the count,
//      not a correction); lowered, its next count is the new size and the newest stretch is not re-sent. A DEVICE OPENING THEN (the re-sends read back)
//      takes every summarised song in its window from the channel: the reader counts a play once, so the stretch the re-send names twice does
//      not meet the count before the stretches below it are read.
//   G  THE BOT'S OWN REOPEN (bot room with save points): it reads its own summaries — the channel read stops at the one already held —
//      and pages no events below the save point the live gap starts from, and sends nothing already marked; with its store lost, it
//      reads its summaries back (it trusts itself to forget) and still sends nothing already marked.
//   H  NOTHING REACHES THE FOLD: every send is on the song history channel, the bot's log and cache hold no summary, and a device's fold
//      is told `complete` only as the room's events say it (never from a summary).
//   I  THE LEAVE STOPS IT (the real `Room.leave`): no timer or listener of it survives; a song after sends nothing; a send in flight at
//      the leave marks nothing and is followed by none.
//   J  ONE WRITER: REP's lock is asked under REP's name, byte for byte (`ddjp:<account>:rep-writer:<room>`); the bot's under its own
//      (`…:history-writer:<room>`), so neither waits on the other; a second tab of the bot refused the lock sends nothing.
//   K  IT WAITS FOR SONG HISTORY'S READING: while a run of song history's reading is in flight (its channel read held), a summary due
//      is not sent, the table full all along; the run done, it goes.
// RED FIRST on `ddjp_737`: no bot side (A–E, G–J find no summary and no `HistoryBot`), the old count read as the room's start after a raise
// (F), no lock under the bot's name (J). On `ddjp_739` (740's change): one song behind (A, C, D, K), a late vote accepted and corrected (E).
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-bot] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 900) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-bot] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const HIST = "!hist:hs", MIN = 60000;
const DEV = ["core/historysummary.js"].concat(B.ORDER);
const BOTS = DEV.concat(["features/history-ports.js", "features/history-bot.js"]);
const tick = () => new Promise((r) => setImmediate(r));
const rawOf = (roomId, sender, body, id, ts) => ({ type: "m.room.message", event_id: id, room_id: roomId, sender: sender, origin_server_ts: ts,
  content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body)) } });

// ── ONE ROOM ON ONE HOMESERVER: a bot room (the bot relays every act) or a shared room (each account authors its own) ─────────────
function room(o) {
  o = o || {};
  const mode = o.mode || "backend2", CH = mode === "backend2" ? B.BOT_CH : B.FULL_CH;
  const server = { [B.SPACE]: [], [HIST]: [] };
  for (const k of Object.keys(CH)) server[CH[k]] = [];
  const R = { mode, CH, server, L: 0, TS: 1792447900000, nIn: 0, pi: null, k: 0, tabs: [], plays: [], seals: [], failing: 0, attempts: [] };
  R.post = (roomId, sender, body) => { R.L++; R.TS += (body.t === "ddjp.dj.play" ? 4 * MIN : 1000);
    const r = rawOf(roomId, sender, Object.assign({}, body, { l: R.L }), "$k" + String(R.L).padStart(6, "0"), R.TS);
    server[roomId].push(r); for (const w of R.tabs) w.live(r); return r; };
  const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++R.nIn), at: null });
  const act = (who, body) => (mode === "backend2" ? R.post(CH.events_owner, B.BOT, rel(body, who, who === B.BOT ? 99 : R.PL)) : R.post(CH.events_owner, who, body));
  R.key = () => "yt:v" + String(++R.k).padStart(10, "0");
  R.join = (who) => { const v = R.key(); return act(who, { t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v.slice(3) }); };
  R.play = () => { const r = act(mode === "backend2" ? B.BOT : B.OWNER, { t: "ddjp.dj.play", p: R.pi }); R.pi = r.event_id; R.plays.push({ pi: r.event_id, l: R.L }); return r; };
  R.vote = (who, pi) => act(who, { t: "ddjp.dj.vote", p: pi });
  R.song = (s) => { R.play(); R.join("@d" + (s % 3) + ":hs"); };
  R.settings = (s) => R.post(CH.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(R.S0(), { vis: "public" }, o.settings || {}, s || {}) });
  // a bot room's save point, sealed from what the bot's tab holds (`check-history-reader`'s way)
  R.seal = (w) => { const log = w.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = w.sb.B2Checkpoint.seal(w.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); R.post(CH.events_owner, B.BOT, out.cp); R.seals.push(head.l); };
  R.pump = async (n) => { for (const w of R.tabs.slice()) if (w.pump) await w.pump(n); };
  // server time passing: the tabs' wake-ups pumped every step, and their 15-s beats fired as the time crosses them
  R.beatAt = R.TS;
  R.wait = async (ms, step) => { const st = step || 1000; for (let t = 0; t < ms; t += st) { R.TS += st;
    if (R.TS - R.beatAt >= 15000) { R.beatAt = R.TS; for (const w of R.tabs.slice()) if (w.beat) w.beat(); }
    await R.pump(3); } };
  return R;
}
// ONE TAB. `o.bot`: the runtime says this tab is the room's bot; `o.hist === false`: no song history channel in its map. Song history's
// requests are counted per channel, with the lowest position each brought.
function tab(R, me, o) {
  o = o || {};
  const extras = { ServerClock: { serverNow: () => R.TS, init() {}, destroy() {} },
    BotRuntime: new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : (k === "actingAsBot" ? () => o.bot === true : B.deep())), apply: () => undefined }) };
  const base = { mode: R.mode, me: me, server: R.server, opened: false, order: o.order || BOTS, timers: true, extras: extras,
    sendFails: (roomId) => { if (roomId !== HIST) return false; R.attempts.push({ at: R.TS }); if (R.failing > 0) { R.failing--; return true; } return false; } };
  const w = o.reloadOf ? o.reloadOf.reload(Object.assign(base, o.store === false ? { storedTable: null } : {})) : B.world(Object.assign(base, { storedTable: o.storedTable || null }));
  if (o.hist !== false) {
    B.addRoom(w, B.SPACE, { history_owner: HIST });
    w.sb.MatrixBridge.addToRoomScope(HIST);
    w.CHH = Object.assign({}, w.CH, { history_owner: HIST });
    w.sb.MatrixBridge.wireCheckpoints(w.CHH);
  } else w.CHH = Object.assign({}, w.CH);
  const fan = [];
  const on0 = w.sb.B1MatrixBridge.onRawEvent, off0 = w.sb.B1MatrixBridge.offRawEvent;
  w.sb.B1MatrixBridge.onRawEvent = (fn) => { if (typeof fn === "function" && !fan.includes(fn)) fan.push(fn); return on0(fn); };
  w.sb.B1MatrixBridge.offRawEvent = (fn) => { const i = fan.indexOf(fn); if (i >= 0) fan.splice(i, 1); return off0(fn); };
  if (R.mode === "backend1") w.sb.MatrixBridge.onRawEvent = w.sb.B1MatrixBridge.onRawEvent, w.sb.MatrixBridge.offRawEvent = w.sb.B1MatrixBridge.offRawEvent;
  w.fan = fan;
  const m = { calls: 0, byRoom: {}, low: {} };
  const s0 = w.client.scrollback;
  w.readGate = null;   // song history's reading held, when the guard asks (K)
  w.client.scrollback = async (room, n) => {
    if (w.readGate) await w.readGate;
    const before = room.timeline.length; await s0(room, n); m.calls++; m.byRoom[room.roomId] = (m.byRoom[room.roomId] || 0) + 1;
    for (const ev of room.timeline.slice(0, room.timeline.length - before)) { try { const b = JSON.parse(ev.event.content.body); if (typeof b.l === "number" && !(m.low[room.roomId] <= b.l)) m.low[room.roomId] = b.l; } catch (e) {} }
  };
  w.m = m; w.mark = () => ({ calls: m.calls, byRoom: Object.assign({}, m.byRoom) });
  w.since = (k) => { const out = { calls: m.calls - k.calls }; for (const id of Object.keys(m.byRoom)) out[id] = m.byRoom[id] - (k.byRoom[id] || 0); return out; };
  // THE SEND'S ANSWER, held by the guard when asked (`w.gate`), and WHEN each history send left (server time)
  const send0 = w.client.sendMessage;
  w.sendAt = [];
  w.starts = 0;
  w.client.sendMessage = async (roomId, content) => { if (roomId === HIST) w.starts++; if (roomId === HIST && w.gate) await w.gate; const r = await send0(roomId, content); if (roomId === HIST) w.sendAt.push(R.TS); return r; };
  // THE ECHO, as the homeserver holds it and as `_routeEvent`'s history branch hands it on (raw listeners only). `w.drop(s)`: lost on the
  // way (never reaches the server); `w.hold`: sync is slow — on the server, not yet delivered (`w.release()` delivers what waited).
  let seen = 0;
  const waiting = [];
  w.drop = null; w.hold = false;
  const deliver = (s, r) => {
    w.rooms[HIST].timeline.push(B.mev(r));
    const rr = { event_id: r.event_id, type: r.type, sender: r.sender, room_id: HIST, ts: r.origin_server_ts, content: r.content, l: s.body.l,
      ddjpType: s.body.t, ddjpBody: s.body, senderRank: 99, unsigned: null, redacts: null };
    for (const fn of fan.slice()) { try { fn(rr, null, w.rooms[HIST]); } catch (e) {} }
  };
  w.echoes = () => {
    let n = 0;
    while (seen < w.sent.length) {
      const s = w.sent[seen++];
      if (s.roomId !== HIST) continue;
      if (w.drop && w.drop(s)) continue;
      R.TS += 50;
      // its event id the homeserver's, unique on the channel (two worlds of one tab — a reload — number their sends alike)
      const r = rawOf(HIST, w.me, s.body, "$h" + String(R.server[HIST].length + 1).padStart(6, "0"), R.TS); R.server[HIST].push(r);
      if (w.hold) { waiting.push([s, r]); continue; }
      deliver(s, r); n++;
    }
    return n;
  };
  w.release = () => { w.hold = false; while (waiting.length) { const [s, r] = waiting.shift(); deliver(s, r); } };
  // THE PUMP: the bot's own wake-ups and song history's (the backfill's re-arm, the table's save) fired, the echoes handed back, promises
  // settled — until quiet. Nothing else is fired: a seal or a vouch fired early would trim a shared room's tab under a save point that
  // never reached it (the room's own beats are `beat`'s, and this world's sealing is the guard's).
  const OURS = /s\.soon = null|_rearmTimer = null|_persistTimer = null/;
  w.pump = async (rounds) => {
    for (let i = 0; i < (rounds || 10); i++) {
      for (let k = 0; k < 6; k++) await tick();
      const live = w.timers.live().filter((t) => t.kind === "timeout" && OURS.test(String(t.fn)));
      for (const t of live) w.timers.clearTimeout(t.id);
      for (const t of live) { try { t.fn(); } catch (e) {} }
      for (let k = 0; k < 6; k++) await tick();
      const e = w.echoes();
      if (!live.length && !e) break;
    }
  };
  w.beat = () => w.timers.fire(15000);
  w.sums = () => w.sent.filter((s) => s.roomId === HIST && s.body.t === "ddjp.side.history.summary").map((s) => s.body);
  w.said = (re) => w.logs.filter((x) => re.test(x));
  w.state = () => (w.sb.HistoryBot ? w.sb.HistoryBot._stateForTest() : null);
  w.enter = () => { if (w.sb.HistoryBot) w.sb.HistoryBot.enter({ spaceId: B.SPACE, channels: w.CHH }); };
  if (!o.detached) R.tabs.push(w);
  return w;
}
async function open(w) {
  await Promise.allSettled(Object.keys(w.CH).map((k) => w.sb.MatrixBridge.replayRoom(w.CH[k])));
  if (w.sb.StreamManager.openFromSavePoint) w.sb.StreamManager.openFromSavePoint();
  w.goLive();
  const k = w.mark(), l0 = w.logs.length;
  w.m.low = {};
  await w.sb.MatrixBridge.backfillHistory();
  return { req: w.since(k), said: w.logs.slice(l0), low: Object.assign({}, w.m.low) };
}
async function start(R, bot) {
  for (const w of R.tabs) await open(w);
  R.S0 = () => R.tabs[0].sb.StateDeriver.defaultSettings();
  R.PL = R.tabs[0].sb.Ranks.levelOf("player");
  R.settings();
  for (let k = 0; k < 3; k++) R.join("@d" + k + ":hs");
  for (const w of R.tabs) w.enter();
  await R.pump();
}
const reserved = (w) => w.sb.MatrixBridge.sideReserved();
const decode = (w, body) => { const HS = w.sb.HistorySummary; const r = HS.read(HS.unstamp(body), reserved(w)); return r.ok ? r.value : null; };
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
// the room's own reading, the `ddjp_736` way: a device with no song history channel, opened now
async function truthOf(R) { const t = tab(R, B.OWNER, { order: DEV, hist: false, detached: true }); await open(t); return new Map(t.sb.History.recent(100000).map((h) => [h.pi, h])); }

// ── A — A SUMMARY EVERY N SONGS ─────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  const sentAfter = [];
  for (let s = 0; s < 23; s++) { R.song(s); await R.pump(); const n = bot.sums().length; if (n > sentAfter.length) sentAfter.push(R.plays.length); }
  const sums = bot.sums(), dec = sums.map((b) => decode(bot, b));
  ok(sums.length === 4 && dec.every(Boolean), "A PREMISE — four summaries of five, read by the format piece, after 23 songs (22 finished: 20 summarised, two waiting for the fifth)", sums.map((b) => [b.from, b.to, b.rows.length]));
  ok(JSON.stringify(sentAfter) === JSON.stringify([6, 11, 16, 21]), "A: EACH GOES UP TO THE SONG THAT JUST ENDED — the summary of songs 5k-4..5k when song 5k+1 starts, none held back (740)", sentAfter);
  ok(dec.every((d) => d.rows.length === 5), "A: each carries N (5) finished songs", dec.map((d) => d.rows.length));
  ok(dec[0] && dec[0].from === 0 && dec.every((d, i) => i === 0 || d.from === dec[i - 1].to + 1), "A: THE STRETCHES MEET: the first from the room's start (0), each from just above the one before — no overlap, no gap", dec.map((d) => [d.from, d.to]));
  const lOf = (pi) => (R.plays.find((p) => p.pi === pi) || {}).l;
  ok(dec.every((d, i) => d.to === R.plays[5 * (i + 1)].l - 1 && d.rows[0].pi === R.plays[5 * i].pi && d.rows[4].pi === R.plays[5 * i + 4].pi),
    "A: each stretch ends just below the song playing when it went (the next summary's first)", dec.map((d) => [d.to, d.rows.map((r) => lOf(r.pi))]));
  const truth = await truthOf(R);
  const same = (r) => { const t = truth.get(r.pi); return !!t && t.songKey === r.songKey && t.dj === r.dj && t.at === r.at && t.endedAt === r.endedAt && t.cutShortBy === r.cutShortBy && (t.counts ? t.counts.votes : 0) === r.counts.votes; };
  ok(dec.every((d) => d.rows.every(same)), "A: THE ROWS ARE WHAT THE ROOM SAYS — song, DJ, start, end, ending, votes as a device reading the room the `ddjp_736` way derives them",
    dec.flatMap((d) => d.rows.filter((r) => !same(r)).map((r) => [r, truth.get(r.pi)])).slice(0, 2));
  ok(dec.every((d, i) => d.count === 5 * (i + 1)), "A: THE COUNT: the room's songs up to each stretch's end (a young room)", dec.map((d) => d.count));
  const marks = bot.sb.History.summaries();
  ok(marks.length === 4 && marks.every((m, i) => m.n === dec[i].n && m.from === dec[i].from && m.to === dec[i].to), "A: each is a MARK on the bot's tab — taken from its echo by song history's reader", marks);
  ok(bot.said(/History bot: summary n=\d+ sent — l=0\.\.\d+, 5 song\(s\), the room's count 5, \d+ bytes \(every 5 songs\)/).length === 1 && bot.said(/History bot: summary n=\d+ read back — marked/).length === 4,
    "A: THE LINES — each send (its stretch, songs, count, bytes, why) and each mark", bot.said(/History bot:/).slice(0, 6));
  R.A = { R, bot, dec };
  PARTS.A = R.A;
});

// ── B — ONLY THE BOT WRITES ─────────────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true }), own = tab(R, B.OWNER, { bot: false }), nohist = tab(R, B.ADMIN, { bot: true, hist: false });
  await start(R);
  for (let s = 0; s < 14; s++) { R.song(s); await R.pump(); }
  ok(bot.sums().length === 2, "B PREMISE — the room's bot sent its summaries (two of five)", bot.sums().length);
  ok(own.sums().length === 0 && own.state() === null && own.sent.every((s) => s.roomId !== HIST), "B: THE OWNER'S TAB — not the bot — sends nothing on the history channel and never starts", { sent: own.sent.length, state: own.state() });
  ok(nohist.sums().length === 0 && nohist.state() === null, "B: a bot tab in a room with no song history channel in its map never starts", nohist.state());
  ok(own.said(/History bot:/).length === 0, "B: and says nothing", own.said(/History bot:/));
});

// ── C — MARKED ONLY WHEN READ BACK; A FAILED SEND IS OWED ───────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 5; s++) { R.song(s); await R.pump(); }
  // C1: refused, said, owed — again no sooner than the spacing, which doubles after a second refusal
  R.failing = 2; const a0 = R.attempts.length;
  R.song(5); await R.pump();
  const first = R.attempts.slice(a0);
  ok(first.length === 1 && bot.sums().length === 0 && bot.sb.History.summaries().length === 0, "C1: a REFUSED send marks nothing", { attempts: first.length, marks: bot.sb.History.summaries() });
  ok(bot.said(/History bot: summary n=\d+ not sent — .*; its songs are owed, tried again in 10 s/).length === 1, "C1: and is said — owed, and when it is tried again", bot.said(/not sent/));
  await R.wait(9000); const early = R.attempts.length - a0;
  await R.wait(12000); const retry = R.attempts.slice(a0);
  ok(early === 1 && retry.length === 2 && retry[1].at - retry[0].at >= 10000, "C1: AGAIN NO SOONER THAN THE SPACING (10 s)", retry.map((x) => x.at - retry[0].at));
  await R.wait(30000);
  const third = R.attempts.slice(a0);
  ok(third.length === 3 && third[2].at - third[1].at >= 20000 && bot.sums().length === 1, "C1: AFTER A SECOND REFUSAL THE SPACING DOUBLES (20 s), then it goes", third.map((x) => x.at - third[0].at));
  const c1 = decode(bot, bot.sums()[0]);
  ok(c1 && c1.from === 0 && c1.rows.length === 5 && bot.sb.History.summaries().length === 1, "C1: the stretch it owed, sent and marked", c1 && [c1.from, c1.to, c1.rows.length]);
  // C2: ONE IN FLIGHT while its send has not answered — nothing else, however long; then a LATE ECHO: not a mark until it arrives
  let open2 = null; bot.gate = new Promise((r) => { open2 = r; });
  const a2 = bot.starts;
  for (let s = 6; s < 11; s++) { R.song(s); await R.pump(); }
  await R.wait(45000, 3000);
  ok(bot.starts === a2 + 1 && bot.state().sending === true, "C2: ONE IN FLIGHT — its send has not answered, and nothing else goes, 45 s on", { starts: bot.starts - a2, state: bot.state() });
  bot.hold = true; bot.gate = null; open2(); await R.pump();
  const n2 = bot.sums()[1] && bot.sums()[1].n;
  ok(n2 && !bot.sb.History.summaries().some((m) => m.n === n2), "C2: ANSWERED, ITS ECHO NOT YET HEARD: no mark", bot.sb.History.summaries().map((m) => m.n));
  await R.wait(15000);
  ok(bot.sums().length === 2 && !bot.sb.History.summaries().some((m) => m.n === n2), "C2: a read-back cannot find what sync has not delivered — still no mark, and nothing re-sent, 15 s on", bot.sums().length);
  bot.release(); await R.pump();
  ok(bot.sb.History.summaries().some((m) => m.n === n2) && bot.sums().length === 2, "C2: THE LATE ECHO ARRIVES: marked then, and only then — sent once", { marks: bot.sb.History.summaries().map((m) => m.n), sent: bot.sums().length });
  // C3: lost on the way — owed again 30 s after it was sent, under a new serial, the same stretch
  let lost = null; bot.drop = (s) => { if (lost === null) { lost = s.body.n; return true; } return false; };
  for (let s = 11; s < 16; s++) { R.song(s); await R.pump(); }
  ok(lost !== null && bot.sums().length === 3, "C3 PREMISE — a summary was sent and lost on the way", { lost, n: bot.sums().length });
  await R.wait(20000);
  ok(bot.sums().length === 3, "C3: not re-sent before the echo's deadline", bot.sums().length);
  await R.wait(20000, 2000);
  const re = bot.sums()[3], was = bot.sums()[2];
  ok(re && re.n > was.n && re.from === was.from && bot.sb.History.summaries().some((m) => m.n === re.n) && !bot.sb.History.summaries().some((m) => m.n === lost),
    "C3: OWED AGAIN — re-sent under a new serial for the same stretch, that one marked, the lost one never", re && { re: [re.n, re.from, re.to], was: [was.n, was.from] });
  ok(bot.said(/History bot: summary n=\d+ was sent and is not on the channel 30 s later — its songs are owed again/).length === 1, "C3: and said", bot.said(/not on the channel/));
});

// ── D — OFFLINE, THEN BACK (shared room) ────────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const R = room({ mode: "backend1", settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });   // the owner's plays are the homeserver's here: what the bot's tab hears is what matters
  await start(R);
  for (let s = 0; s < 12; s++) { R.song(s); await R.pump(); }
  const was = bot.sums().map((b) => decode(bot, b));
  ok(was.length === 2 && was[0].from === 0, "D PREMISE — the bot, an account of this shared room, sent its summaries", was.map((d) => [d.from, d.to]));
  // its tab closes, and the room plays on — more songs than one message holds
  bot.sb.HistoryBot.leave("the tab closed"); R.tabs.splice(R.tabs.indexOf(bot), 1);
  for (let s = 12; s < 900; s++) { R.song(s); if (s % 50 === 0) await R.pump(2); }
  await R.pump();
  const back = tab(R, B.BOT, { bot: true, reloadOf: bot, detached: true });
  await open(back); R.tabs.push(back);
  back.enter(); await R.pump();
  const t0 = R.TS; await R.wait(40000);
  const sums = back.sums().map((b) => decode(back, b));
  ok(sums.length === 2 && sums.every(Boolean), "D: BACK — the songs played while it was away went, in two messages (one holds the budget's worth)", sums.map((d) => d && [d.from, d.to, d.rows.length]));
  ok(sums[0] && sums[0].from === was[1].to + 1 && sums[1] && sums[1].from === sums[0].to + 1, "D: OLDEST FIRST, the stretches meeting the last one it had sent", sums.map((d) => d && [d.from, d.to]));
  ok(back.sendAt.length === 2 && back.sendAt[1] - back.sendAt[0] >= 10000, "D: AT LEAST 10 s APART", back.sendAt.map((t) => t - t0));
  const L = back.logs, iSent2 = L.findIndex((x, i) => /History bot: summary n=\d+ sent/.test(x) && L.slice(0, i).some((y) => /History bot: summary n=\d+ sent/.test(y)));
  ok(iSent2 > 0 && L.slice(0, iSent2).some((x) => /read back — marked/.test(x)), "D: ONE IN FLIGHT — the second sent only once the first was read back", back.said(/History bot: summary/).slice(0, 4));
  ok(sums[1] && sums[1].to === R.plays[R.plays.length - 1].l - 1, "D: the last reaches up to just below the song playing — the song that just ended in it (740)", sums[1] && [sums[1].to, R.plays[R.plays.length - 1].l]);
  const d = tab(R, B.OWNER, { order: DEV, detached: true }); const od = await open(d);
  const marks = d.sb.History.summaries(), rows = d.sb.History.recent(100000);
  const inside = (l) => marks.some((m) => l >= m.from && l <= m.to);
  ok(rows.map((r) => r.pi).sort().join() === R.plays.map((p) => p.pi).sort().join(), "D: A DEVICE OPENING NOW HOLDS EXACTLY THE ROOM", { rows: rows.length, plays: R.plays.length });
  ok(rows.filter((r) => inside(r.l)).every((r) => r.src === "summary") && rows.filter((r) => r.src === "summary").length === R.plays.length - 1,
    "D: every song inside a summary's stretch from the bot's summaries — all but the song playing", rows.filter((r) => r.src !== "summary").map((r) => [r.l, r.src]).slice(0, 6));
  ok(od.req[HIST] >= 1 && od.req[HIST] <= 2, "D: read off the history channel in a request or two", od.req);
});

// ── E — A LATE VOTE, AND NO CORRECTION (740, the owner's: "the room shouldent accept it and the history dosent need to corrwect it") ──
part("E", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 11; s++) { R.song(s); await R.pump(); }
  ok(bot.sums().length === 2, "E PREMISE — two summaries (ten finished songs), the eleventh playing", bot.sums().length);
  const verdict = (id) => ({ legal: bot.sb.StreamManager.isLegal(id), code: ((bot.sb.StreamManager.refusalOf(id) || {}).code) || null });
  // E1: a vote on a song inside the first summary — it lands after its song ended
  const S1 = decode(bot, bot.sums()[0]), target = S1.rows[2];
  const late = R.vote("@v2:hs", target.pi); await R.pump();
  ok(verdict(late.event_id).legal === false && verdict(late.event_id).code === "not-on-air",
    "E1: A VOTE ON A SUMMARISED SONG lands after its song ended — the room refuses it (`not-on-air`)", verdict(late.event_id));
  // E2: a vote while the eleventh song plays; then, four songs on, the last-second vote on the song that just ended, landing after the next
  // play — the race the owner's rule refuses with no message
  const onAir = R.vote("@v3:hs", R.pi); await R.pump();
  for (let s = 11; s < 15; s++) { R.song(s); await R.pump(); }
  const ended = R.plays[R.plays.length - 1];
  R.song(15); const race = R.vote("@v4:hs", ended.pi);
  await R.pump(); await R.wait(31000);
  ok(verdict(onAir.event_id).legal === true && verdict(race.event_id).legal === false && verdict(race.event_id).code === "not-on-air",
    "E2 PREMISE — the vote while its song played stands; the last-second one, ordered after the next play, is refused", { onAir: verdict(onAir.event_id), race: verdict(race.event_id) });
  const all = bot.sums().map((b) => decode(bot, b));
  const S3 = all.find((d) => d.rows.some((r) => r.pi === ended.pi));
  ok(S3 && S3.rows.length === 5 && S3.rows[0].counts.votes === 1 && S3.rows[4].pi === ended.pi && S3.rows[4].counts.votes === 0,
    "E2: THE SUMMARY RUNS TO THE SONG THAT JUST ENDED, ITS VOTES FINAL — the vote cast while a song played is in its row, the last-second one landing after the next song started is not",
    S3 && S3.rows.map((r) => [r.pi === ended.pi ? "ended" : "", r.counts.votes]));
  ok(all.every((d, i) => all.findIndex((x) => x.from === d.from) === i) && all.length === 3,
    "E3: NO CORRECTION — no stretch is sent twice: three summaries, each its own stretch", all.map((d) => [d.n, d.from, d.to]));
  ok(bot.said(/correction/).length === 0 && bot.state().resent === 0, "E3: and nothing is said or counted as one", { said: bot.said(/correction/), state: bot.state() });
  const mine = bot.sb.History.recent(100000).find((r) => r.pi === target.pi);
  ok(mine && mine.src === "summary" && mine.sum === S1.n && mine.counts.votes === 0, "E1: the summarised song's row on the bot's own tab is as its summary said, the refused vote nowhere", mine);
  const d = tab(R, B.OWNER, { order: DEV, detached: true }); await open(d);
  const dr = d.sb.History.recent(100000).find((r) => r.pi === target.pi), de = d.sb.History.recent(100000).find((r) => r.pi === ended.pi);
  ok(dr && dr.src === "summary" && dr.sum === S1.n && dr.counts.votes === 0 && de && de.src === "summary" && de.counts.votes === 0,
    "E4: A DEVICE HOLDS THE BOT'S ROWS — and neither refused vote counts on it either", { dr, de });
});

// ── F — THE HISTORY SIZE LOWERED AND RAISED; THE COUNT CAPPED ───────────────────────────────────────────────────────────────────
part("F", async () => {
  const R = room({ settings: { historySize: 500, historySummaryEvery: 15 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 700; s++) { R.song(s); if ((s + 1) % 40 === 0) R.seal(bot); await R.pump(4); }
  const sums = bot.sums().map((b) => decode(bot, b));
  ok(sums.length >= 40 && sums.every(Boolean), "F PREMISE — the bot summarised a room past its history size (500)", sums.length);
  ok(sums.every((d) => d.count <= 500) && sums[sums.length - 1].count === 500 && sums.filter((d) => d.count === 500).length >= 10, "F: THE COUNT CAPPED — never more than the size, and the size once the window is held",
    sums.map((d) => d.count).slice(-4));
  ok(sums.filter((d) => d.count < 500).every((d, i, a) => i === 0 || d.count === a[i - 1].count + 15), "F: before that, the room's songs up to each stretch's end", sums.map((d) => d.count).slice(0, 4));
  // a DEVICE live through the raise
  const dl = tab(R, B.OWNER, { order: DEV }); await open(dl);
  ok(dl.sb.History.coverage().windowFrom !== null && dl.sb.History.count() === 500, "F PREMISE — a device at size 500 holds the window", dl.sb.History.coverage());
  const sentBefore = bot.sums().length;
  R.settings({ historySize: 600, historySummaryEvery: 15 });
  const cRaised = dl.sb.History.coverage();
  ok(cRaised.fromStart === false && cRaised.full === false, "F: RAISED TO 600, A DEVICE LIVE THROUGH IT does not take the old count (500) for the room's start (737 did)", cRaised);
  await dl.sb.MatrixBridge.backfillHistory();
  const cAfter = dl.sb.History.coverage();
  ok(cAfter.fromStart === false && cAfter.windowFrom !== null && dl.sb.History.recent(100000).map((r) => r.pi).sort().join() === R.plays.slice(-600).map((p) => p.pi).sort().join(),
    "F: and fills to the new window — the room's newest 600 songs exactly, never the room's start", { fromStart: cAfter.fromStart, windowFrom: cAfter.windowFrom, rows: cAfter.entries });
  // a DEVICE opening after the raise, before the bot says the new count
  const df = tab(R, B.OWNER, { order: DEV, detached: true }); await open(df);
  const cf = df.sb.History.coverage();
  ok(cf.fromStart === false && df.sb.History.recent(100000).map((r) => r.pi).sort().join() === R.plays.slice(-600).map((p) => p.pi).sort().join(),
    "F: A DEVICE OPENING AFTER THE RAISE, before the bot's new count, does not take the old count for the room's start either, and holds the newest 600", { fromStart: cf.fromStart, rows: cf.entries });
  // the bot: its newest stretch again, with the new count
  await bot.sb.MatrixBridge.backfillHistory(); await R.wait(12000);
  const after = bot.sums().slice(sentBefore).map((b) => decode(bot, b));
  const newest = sums[sums.length - 1];
  const again = after.filter((d) => d.from === newest.from && d.to === newest.to);
  ok(again.length === 1 && again[0].count === 600 && bot.said(/the count is now 600/).length === 1,
    "F: THE BOT SENDS ITS NEWEST STRETCH AGAIN WITH THE NEW COUNT, once its own table holds the new window", after.map((d) => [d.from, d.to, d.count]));
  // the songs below its old window that it read back for the new one are unmarked on its tab (their marks went with its rows at 500):
  // sent once more, oldest first, in one message — the channel already holds them, and a device takes the newest, the same rows
  ok(after.length === 2 && after[0].to < newest.from && after[0].rows.every((r) => r.l >= R.plays[R.plays.length - 600].l), "F: and, first, the songs below its old window that it read back (one message)",
    after.map((d) => [d.from, d.to, d.rows.length]));
  // A DEVICE OPENING THEN, the re-sends just read back (the HB27 holder since 740, when corrections went): the channel names some plays
  // twice — the newest stretch at the raise, sent again with its new count, and the songs below the old window, summarised again — and
  // the reader counts a play once, so it takes every summarised song of its window from the channel before it stops; counted twice, it
  // would stop short and read the rest from the room's events.
  const named = new Map(); for (const b of bot.sums()) for (const r of (decode(bot, b) || { rows: [] }).rows) named.set(r.pi, (named.get(r.pi) || 0) + 1);
  ok(Array.from(named.values()).some((k) => k > 1), "F PREMISE — the channel names some plays twice (the re-sends)", Array.from(named.values()).filter((k) => k > 1).length);
  const dz = tab(R, B.OWNER, { order: DEV, detached: true }); await open(dz);
  const zr = dz.sb.History.recent(100000), topTo = dz.sb.History.summaries().reduce((m, x) => Math.max(m, x.to), -1);
  ok(zr.map((r) => r.pi).sort().join() === R.plays.slice(-600).map((p) => p.pi).sort().join() && zr.filter((r) => r.l <= topTo).every((r) => r.src === "summary"),
    "F: A DEVICE OPENING THEN TAKES EVERY SUMMARISED SONG OF ITS WINDOW FROM THE CHANNEL — the reader counts a play the channel names twice once",
    { rows: zr.length, notBot: zr.filter((r) => r.l <= topTo && r.src !== "summary").map((r) => [r.l, r.src]).slice(0, 4) });
  for (let s = 700; s < 720; s++) { R.song(s); await R.pump(4); }
  const later = bot.sums().slice(sentBefore).map((b) => decode(bot, b));
  ok(later[later.length - 1].count === 600, "F: and its next summaries count 600", later.map((d) => d.count));
  // LOWERED: the next count the new size; the newest stretch not re-sent for it
  const nLow = bot.sums().length;
  R.settings({ historySize: 550, historySummaryEvery: 15 });
  await R.wait(12000);
  ok(bot.sums().length === nLow, "F: LOWERED TO 550 — the newest stretch is not sent again for it (a device caps a larger count at its own size)", bot.sums().slice(nLow).map((b) => [b.from, b.count]));
  for (let s = 720; s < 740; s++) { R.song(s); await R.pump(4); }
  const low = bot.sums().slice(nLow).map((b) => decode(bot, b));
  ok(low.length >= 1 && low.every((d) => d.count === 550), "F: and its next summary counts 550", low.map((d) => d.count));
});

// ── G — THE BOT'S OWN REOPEN ────────────────────────────────────────────────────────────────────────────────────────────────────
part("G", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 60; s++) { R.song(s); if ((s + 1) % 10 === 0) R.seal(bot); await R.pump(); }
  const before = bot.sums().length, marks0 = bot.sb.History.summaries();
  ok(before === 11, "G PREMISE — the bot summarised the room (11 of 5)", before);
  bot.sb.HistoryBot.leave("reload"); R.tabs.splice(R.tabs.indexOf(bot), 1);
  const re = tab(R, B.BOT, { bot: true, reloadOf: bot, detached: true });
  const o = await open(re); R.tabs.push(re); re.enter(); await R.wait(12000);
  const newestTo = marks0.reduce((m, x) => Math.max(m, x.to), -1);
  const anchor = R.seals.filter((l) => l <= newestTo).reduce((m, l) => Math.max(m, l), 0);
  ok(o.req[HIST] <= 1 && o.said.some((x) => /holds nothing newer than the summary already held/.test(x)), "G: ITS REOPEN READS ITS OWN SUMMARIES — the channel read stops at the one already held", { req: o.req, said: o.said.filter((x) => /history channel/.test(x)) });
  ok(!(o.low[B.BOT_CH.events_owner] < anchor), "G: AND PAGES NO EVENT BELOW THE SAVE POINT THE LIVE GAP STARTS FROM (l=" + anchor + ") — its summaries hold the rest", { low: o.low, anchor, newestTo });
  ok(re.sums().length === 0, "G: it sends nothing already marked", re.sums().map((b) => [b.from, b.to]));
  // its store lost: it reads its summaries back and trusts them
  re.sb.HistoryBot.leave("lost"); R.tabs.splice(R.tabs.indexOf(re), 1);
  const lost = tab(R, B.BOT, { bot: true, reloadOf: re, store: false, detached: true });
  const ol = await open(lost); R.tabs.push(lost); lost.enter(); await R.wait(12000);
  ok(lost.sb.History.summaries().length === marks0.length && lost.sums().length === 0, "G: ITS STORE LOST, it reads its summaries back (it trusts itself to forget) and sends nothing already marked",
    { marks: lost.sb.History.summaries().length, sent: lost.sums().map((b) => [b.from, b.to]), req: ol.req });
});

// ── H — NOTHING REACHES THE FOLD ────────────────────────────────────────────────────────────────────────────────────────────────
part("H", async () => {
  const A = PARTS.A;
  if (!ok(!!A, "H PREMISE — part A's room ran")) return;
  const { R, bot } = A;
  ok(bot.sent.filter((s) => s.body.t === "ddjp.side.history.summary").every((s) => s.roomId === HIST) && bot.sums().length > 0, "H: EVERY SUMMARY WENT ON THE SONG HISTORY CHANNEL", bot.sent.map((s) => s.roomId));
  ok(!bot.sb.StreamManager.getLog().some((e) => (e.type || (e.content && e.content.t)) === "ddjp.side.history.summary") &&
     !bot.sb.EventCache.values().some((r) => { try { return JSON.parse(r.content.body).t === "ddjp.side.history.summary"; } catch (e) { return false; } }),
    "H: the bot's log and its raw cache hold no summary");
  const d = tab(R, B.OWNER, { order: DEV, detached: true });
  const told = [];
  d.sb.StreamManager.setHistoryComplete = ((prev) => function (v) { told.push({ v: v, c: d.sb.History.coverage().complete }); return prev.apply(null, arguments); })(d.sb.StreamManager.setHistoryComplete);
  await open(d);
  ok(told.length > 0 && told.every((t) => t.v === t.c), "H: A DEVICE'S FOLD IS TOLD `complete` ONLY AS THE ROOM'S EVENTS SAY IT", told);
});

// ── I — THE LEAVE STOPS IT ──────────────────────────────────────────────────────────────────────────────────────────────────────
part("I", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 8; s++) { R.song(s); await R.pump(); }
  ok(bot.state() !== null && bot.state().timers.tick && bot.fan.length > 0, "I PREMISE — the bot side runs, its beat armed and its ear on", bot.state());
  const ears = bot.fan.length, ticks = bot.timers.live().filter((t) => t.ms === 15000).length;
  // a send in flight at the leave
  let open1 = null; bot.gate = new Promise((r) => { open1 = r; });
  for (let s = 8; s < 13; s++) { R.song(s); await R.pump(); }
  ok(bot.state().sending === true, "I PREMISE — a summary's send is in flight", bot.state());
  bot.sb.Room.leave("the guard leaves");
  ok(bot.state() === null && bot.said(/History bot: stopped — the tab left the room/).length === 1, "I: THE REAL `Room.leave` STOPS IT, and says so", bot.said(/History bot: stopped/));
  ok(bot.timers.live().filter((t) => t.ms === 15000).length === ticks - 1 && bot.fan.length < ears, "I: its beat and its ear are gone", { ticks: bot.timers.live().filter((t) => t.ms === 15000).length, ears: bot.fan.length });
  bot.gate = null; open1(); await bot.pump();
  const marks = bot.sb.History.summaries().length;
  R.song(13); await bot.pump(); bot.beat(); await bot.pump();
  const iStop = bot.logs.findIndex((x) => /History bot: stopped/.test(x));
  ok(bot.sums().length === 2 && bot.state() === null && bot.sb.History.summaries().length === marks && !bot.logs.slice(iStop + 1).some((x) => /History bot:/.test(x)),
    "I: the send in flight lands, and nothing follows it — not even a line", { sums: bot.sums().length, state: bot.state(), after: bot.logs.slice(iStop + 1).filter((x) => /History bot:/.test(x)) });
});

// ── J — ONE WRITER ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
part("J", async () => {
  const noop = () => {};
  const held = new Set(), asked = [];
  const locks = { request: (name, opts, cb) => { asked.push([name, opts]); if (held.has(name)) return Promise.resolve(cb(null)); held.add(name); return Promise.resolve(cb({ name: name })); } };
  const IDB = { supported: () => true, currentNamespace: () => "@bot:hs", keyFor: () => "k", get: () => Promise.resolve(undefined), set: () => Promise.resolve(), del: () => Promise.resolve() };
  const S = loadInContext(["core/store.js"], { IDB: IDB, StorageIO: { load: () => null, save: noop }, navigator: { locks: locks } }).Store;
  const rep = await S.rep.writerLock("!r1", () => new Promise(noop));
  const hist = S.history && S.history.writerLock ? await S.history.writerLock("!r1", () => new Promise(noop)) : "none";
  const hist2 = S.history && S.history.writerLock ? await S.history.writerLock("!r1", () => Promise.resolve()) : "none";
  ok(asked[0] && asked[0][0] === "ddjp:@bot:hs:rep-writer:!r1" && JSON.stringify(asked[0][1]) === JSON.stringify({ ifAvailable: true }) && rep === true,
    "J: REP'S LOCK IS ASKED UNDER REP'S NAME, BYTE FOR BYTE, as before", asked[0]);
  ok(asked[1] && asked[1][0] === "ddjp:@bot:hs:history-writer:!r1" && hist === true && hist2 === false, "J: THE BOT'S UNDER ITS OWN — granted beside REP's, refused to a second asker", { asked, hist, hist2 });
  const none = loadInContext(["core/store.js"], { IDB: IDB, StorageIO: { load: () => null, save: noop }, navigator: {} }).Store;
  ok(await none.rep.writerLock("!r1", () => Promise.resolve()) === null && (none.history.writerLock ? await none.history.writerLock("!r1", () => Promise.resolve()) : "none") === null,
    "J: with no Web Locks both answer `null`, not a pretend lock");
  // a second tab of the bot, refused the lock, sends nothing
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true }), twin = tab(R, B.BOT, { bot: true });
  twin.sb.Store.history.writerLock = () => Promise.resolve(false);
  await start(R);
  for (let s = 0; s < 8; s++) { R.song(s); await R.pump(); }
  ok(bot.sums().length === 1 && twin.sums().length === 0 && twin.said(/another tab of this account sends this room's history summaries — this tab sends none/).length === 1,
    "J: A SECOND TAB OF THE BOT, REFUSED THE LOCK, SENDS NOTHING, and says why", { bot: bot.sums().length, twin: twin.sums().length });
});

// ── K — IT WAITS FOR SONG HISTORY'S READING ─────────────────────────────────────────────────────────────────────────────────────
part("K", async () => {
  const R = room({ settings: { historySummaryEvery: 5 } });
  const bot = tab(R, B.BOT, { bot: true });
  await start(R);
  for (let s = 0; s < 5; s++) { R.song(s); await R.pump(); }
  ok(bot.sums().length === 0 && bot.sb.MatrixBridge.historyIdle() === true && bot.sb.MatrixBridge.historyCoverage().full === true,
    "K PREMISE — ready, nothing due yet (four finished songs), no reading in flight", { sums: bot.sums().length, cov: bot.sb.MatrixBridge.historyCoverage() });
  let open = null; bot.readGate = new Promise((r) => { open = r; });
  bot.sb.MatrixBridge.rearmHistoryBackfill(); await bot.pump();
  ok(bot.sb.MatrixBridge.historyIdle() === false, "K PREMISE — a run of song history's reading is in flight, its channel read held", bot.sb.MatrixBridge.historyIdle());
  R.song(5); await R.pump(); await R.wait(45000, 3000);
  ok(bot.sb.MatrixBridge.historyCoverage().full === true && bot.state() && bot.state().writer === true, "K PREMISE — the table full and the bot writing all along", bot.sb.MatrixBridge.historyCoverage());
  ok(bot.sums().length === 0 && bot.starts === 0, "K: WHILE SONG HISTORY IS BEING READ, A SUMMARY DUE IS NOT SENT (45 s on)", { sums: bot.sums().length, starts: bot.starts });
  bot.readGate = null; open(); await R.pump(); await R.wait(16000);
  const d = bot.sums()[0] && decode(bot, bot.sums()[0]);
  ok(bot.sb.MatrixBridge.historyIdle() === true && bot.sums().length === 1 && d && d.from === 0 && d.rows.length === 5, "K: THE RUN DONE, IT GOES — the five songs owed", d && [d.from, d.to, d.rows.length]);
});

// `HB_PARTS=A,E` runs only those parts (a break row names the part its mutation reaches; H reads part A's room, so A runs with it). The
// suite runs them all; the line below says which ran.
const ONLY = (process.env.HB_PARTS || "").split(",").filter(Boolean);
if (ONLY.indexOf("H") >= 0 && ONLY.indexOf("A") < 0) ONLY.unshift("A");
(async () => {
  const ran = [];
  for (const [name, fn] of PARTS) {
    if (ONLY.length && ONLY.indexOf(name) < 0) continue;
    const t0 = Date.now();
    try { await fn(); } catch (e) { ok(false, name + ": THREW — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
    ran.push(name + " " + (Date.now() - t0) + " ms");
  }
  if (process.env.HB_TIMES) console.log("[history-bot] parts: " + ran.join(", "));
  ok(ran.length > 0, "PREMISE — a part ran", ONLY);
  _finished = true;
  if (failed) { console.log("[history-bot] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-bot] PASS — THE ROOM'S BOT WRITES THE SONG HISTORY SUMMARIES AND FILLS THEIR HOLES (738, 740; " + asserts + " assertions, parts " + (ONLY.length ? ONLY.join(",") : "A–K") + ", through the real modules of both engines). " +
    "A SUMMARY EVERY N SONGS, UP TO THE SONG THAT JUST ENDED (740): N finished songs, the stretches meeting from the room's start, the rows the room's own, the count its songs, each marked only from its echo. " +
    "ONLY THE BOT WRITES. A REFUSED SEND IS OWED and tried again no sooner than 10 s, doubling; a LATE ECHO is not a mark and holds the next; a LOST ONE is owed again 30 s on, under a new serial. " +
    "OFFLINE THEN BACK in a shared room: the hole and the missed songs OLDEST FIRST, one in flight, 10 s apart; a device then holds the room exactly from the summaries. " +
    "A LATE VOTE IS REFUSED BY THE ROOM AND NOTHING IS CORRECTED (740): no stretch is sent twice for it, and a summary's votes are final when it goes. " +
    "THE COUNT CAPPED at the size; RAISED, no device takes the old count for the room's start (737 did) and the bot says the new count; LOWERED, its next count; a device then takes its window from the channel, a play named twice counted once. " +
    "ITS OWN REOPEN reads its summaries, pages nothing below the live gap's save point, and sends nothing marked — its store lost too. NOTHING REACHES THE FOLD. THE LEAVE STOPS IT. " +
    "ONE WRITER: REP's lock byte for byte, the bot's its own. IT WAITS FOR SONG HISTORY'S READING, then sends.");
})();
