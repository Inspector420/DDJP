// tests/check-history-window.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js
// WALL: SONG HISTORY STOPS AT THE ROOM'S NEWEST 5000 SONGS (the owner's, `consensus/history-rules.md` §10; his words: "its not
// supposed to read past 5000 (to start)", "stopping at 5000 is priority no loading to start if so").
//
// THE DEFECT (driven at `ddjp_734`, a room past `History.MAX` songs, the real modules): song history kept 5000 songs and read
// the whole room to get them, and read it again. In a bot room of 5202 songs a first open paged 112 requests down to l=2 (the
// window's oldest song at l=414), and a second open 106 more, again to l=2: verify's stretch from the room's start to the oldest
// save point the device remembers was never marked under that floor, which moves. In a shared room the same stretch was re-read
// at every trim (the re-armed backfill asked [0, 8751]) and every open; and the first open asked from 0 for every stretch. Each
// song past the window also re-opened the hole below it (evicting lowered the reach), and a fill re-claimed it once its rows
// were evicted, so a table of 5000 songs said it reached the room's start.
//
// WHAT THIS HOLDS, ALL DRIVEN (the real backend modules of both engines, `History`, the bridge's `backfillHistory`, `historyAudit`
// and pager, `features/room.js`; the SDK client is the only double, `tests/_botroom.js`; a shared room's checkpoints sealed by
// the owner's real `Checkpoint.seal`, `tests/_reopen.js`). WHAT IS PAGED is asserted, not only what is shown: in a bot room the
// SDK's scrollback requests and the lowest position they brought (`o.meter`), in a shared room — whose replay downloads every
// channel to its start whatever song history does — every position song history's steps ask its pager for.
//   A  A BOT ROOM PAST THE WINDOW, A FIRST OPEN: nothing paged more than one request's length below the save point that anchors
//      the window's oldest song; the newest 5000 songs held, no hole, the window held and the room's start not claimed; the chain
//      not walked to the room's first floor; and the room the device derives equals a reader's that holds everything (PILLARS §3),
//      the fold being told "short" now in a room past the window.
//   B  THE SECOND OPEN (a reload: the stored table and the raw cache): song history pages nothing; the same songs; the same room.
//   C  LIVE: two songs and the bot's save point (a move-on): no hole re-opens, nothing is paged, the window moves up by two songs;
//      and a third open pages nothing.
//   D  THE AUDIT UNDER THE WINDOW: read from the save point that anchors the window, truth = device on the window's 5000 songs,
//      nothing missing, nothing extra, and its line says where it read from.
//   E  A SHARED ROOM PAST THE WINDOW: the first open never asks below the anchoring checkpoint, and does not walk to the room's
//      first floor; a song and a checkpoint (a trim, which re-arms the backfill) ask only above the window; a second open asks
//      nothing below it; the room derived equals a reader's that holds everything, after each open.
//   F  A ROOM SHORTER THAN THE WINDOW (the control for A): it is read to its start, as before, and the start is recorded; its
//      second open reads nothing (it re-read the room from its start before).
//   H  BACK AFTER A LONG ABSENCE (the supervisor's finding at `ddjp_735`): a device that held the window is closed while songs and
//      save points play past the reach of its download, then reopens with its stored table. It reads the stretch it missed and no
//      more — no further below it than one request's length under the newest save point it had seen — and holds the newest 5000.
//      Sized from the window it held, the walk read down to that window's floor: 100 requests, nearly a first open's, for 150 songs
//      away. A short absence (the control) reads nothing; an absence past the whole window reads nothing below the save point
//      anchoring the NEW window. E's shared room is taken through the same story (30 checkpoints, past the 24 its floor
//      remembers): the walk goes no further down than the checkpoints it missed.
//   G  HISTORY'S OWN FILLS, DRIVEN ALONE (the real module, a pager over a room past the window with a save point every 40 songs):
//      a backfill into an empty table and a fill of a deep hole each read from the top down and stop at the window — the lowest
//      position asked within one save-point stretch of the save point anchoring the window's oldest song (734: from 0 at once).
// Each part asserts its own premise (the room is past the window, the anchoring save point exists, the device moved on, the
// trim happened), so a row refuses itself rather than pin nothing.
"use strict";
const B = require("./_botroom.js");
const { room: sharedRoom, settle } = require("./_reopen.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-window] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 900) : "")); }
}
async function part(name, fn) {
  try { await fn(); } catch (e) { failed++; console.log("[history-window] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 4).join(" | ")); }
}
const MAXS = 5000, SONGS = 5400, EVERY = 40, PAGE = 100;   // a room past History.MAX; a scrollback request is 100 events
const cmpId = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

// ── A BOT ROOM ON ITS HOMESERVER: the bot's own world (no song history: it only seals) relays and seals as `B2Runner` does ─────
function botRoom(songs) {
  const BC = B.BOT_CH, MIN = 60000;
  const server = { [B.SPACE]: [], [BC.events_uncategorized]: [], [BC.events_owner]: [], [BC.settings_owner]: [] };
  const R = { server, BC, L: 0, TS: 1792447900000, nIn: 0, pi: null, k: 0, live: [], seals: [], plays: [] };
  R.post = (roomId, sender, body) => { R.L++; R.TS += (body.t === "ddjp.dj.play" ? 4 * MIN : 1000);
    const raw = { type: "m.room.message", event_id: "$w" + String(R.L).padStart(6, "0"), room_id: roomId, sender, origin_server_ts: R.TS,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: R.L })) } };
    server[roomId].push(raw); for (const d of R.live) d.live(raw); return raw; };
  R.bot = B.world({ me: B.BOT, server, opened: false, order: B.ORDER.filter((f) => f !== "backends/backend1/history.js") });
  const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++R.nIn), at: null });
  R.key = () => "yt:w" + String(++R.k).padStart(10, "0");   // an 11-character id: a song by its key (J153: a non-key is no song)
  R.join = (who, v) => R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v.slice(3) }, who, R.PL));
  R.song = (s) => { const r = R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.play", p: R.pi }, B.BOT, 99)); R.pi = r.event_id; R.plays.push({ pi: r.event_id, l: R.L });
    R.join("@d" + (s % 3) + ":hs", R.key()); };
  R.seal = () => { const log = R.bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = R.bot.sb.B2Checkpoint.seal(R.bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); R.post(BC.events_owner, B.BOT, out.cp); R.seals.push(head.l); };
  R.build = async () => {
    await R.bot.open(); R.live.push(R.bot); R.PL = R.bot.sb.Ranks.levelOf("player");
    R.post(BC.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(R.bot.sb.StateDeriver.defaultSettings(), { vis: "public" }) });
    for (let k = 0; k < 3; k++) R.join("@d" + k + ":hs", R.key());
    for (let s = 0; s < songs; s++) { R.song(s); if ((s + 1) % EVERY === 0) R.seal(); }
    R.song(songs); R.song(songs + 1);              // two songs past the last save point
  };
  // the window's oldest song (the 5000th back), and the save point whose cut is at or below it — the fold of that song starts there
  R.window = () => { const nth = R.plays.length >= MAXS ? R.plays[R.plays.length - MAXS] : null;
    return { nth: nth, anchor: nth ? R.seals.filter((f) => f < nth.l).pop() : null }; };
  return R;
}
// OPENING, as `Room` does it, with the replay's paging told apart from song history's.
async function openSplit(w) {
  await Promise.allSettled(Object.keys(w.CH).map((k) => w.sb.MatrixBridge.replayRoom(w.CH[k])));
  w.sb.StreamManager.openFromSavePoint();
  w.goLive();
  const m = w.meter.mark(), l0 = w.logs.length;
  await w.sb.MatrixBridge.backfillHistory();
  return { paged: w.meter.since(m), said: w.logs.slice(l0) };
}
// THE ROOM AS A DEVICE DERIVES IT, AND AS A READER HOLDING EVERYTHING DERIVES IT (the standard, PILLARS §3): now playing, the queue, the DJs.
const view = (st) => JSON.stringify({ np: st && st.nowPlaying ? [st.nowPlaying.pi, st.nowPlaying.song && st.nowPlaying.song.songKey, st.nowPlaying.dj] : null,
  rotation: ((st && st.rotation) || []).map((r) => [r.user, (r.pending || []).map((p) => p.songKey)]) });
function reference(w, rawsByRoom) {
  const evs = [];
  for (const raws of rawsByRoom) for (const raw of raws) {
    let b = null; try { b = JSON.parse(raw.content.body); } catch (e) { b = null; }
    const r = Object.assign({}, raw, { ts: raw.origin_server_ts, l: b && typeof b.l === "number" ? b.l : 0, senderRank: 99 });
    for (const e of w.sb.StreamManager.normaliseAll(r)) if (e && e.type !== "ddjp.checkpoint") evs.push(e);
  }
  evs.sort((a, b) => (a.l - b.l) || cmpId(String(a.eventId), String(b.eventId)));
  return w.sb.StateDeriver.derive(evs);
}
const pisOf = (w) => w.sb.History.recent().map((r) => r.pi).sort().join();
const newest = (R, n) => R.plays.slice(-n).map((p) => p.pi).sort().join();

(async () => {
// ═══ A, B, C, D — A BOT ROOM PAST THE WINDOW ═══════════════════════════════════════════════════════════════════════════════
const R = botRoom(SONGS);
let d1 = null, d2 = null;
await part("A", async () => {
  await R.build();
  const win = R.window();
  ok(R.plays.length > MAXS + 300 && win.nth && typeof win.anchor === "number" && win.anchor > PAGE * 3,
    "A PREMISE — the bot room is past the window: more songs than History keeps, the window's oldest song well above the room's start, a save point under it",
    { plays: R.plays.length, window: win, seals: R.seals.length });
  d1 = B.world({ me: B.OWNER, server: R.server, opened: false, meter: true });
  const o = await openSplit(d1);
  const H = d1.sb.History, cov = H.coverage();
  ok(o.paged.calls > 0, "A PREMISE — the first open paged the room (song history read from the server)", o.paged);
  ok(isFinite(o.paged.minL) && o.paged.minL >= win.anchor - PAGE,
    "A: A FIRST OPEN READS NO FURTHER BELOW THE WINDOW THAN THE SAVE POINT ANCHORING ITS OLDEST SONG — one request's length at most (734: down to l=2)",
    { lowest: o.paged.minL, anchor: win.anchor, windowFrom: win.nth.l, requests: o.paged.calls });
  ok(H.count() === MAXS && pisOf(d1) === newest(R, MAXS), "A: AND HOLDS THE ROOM'S NEWEST 5000 SONGS, exactly", { count: H.count() });
  ok(cov.full === true && cov.complete === false && cov.windowFrom === win.nth.l && H.holes().length === 0 && cov.ranges.length === 1,
    "A: THE WINDOW IS HELD — one unbroken range from the 5000th song back, no hole — and the room's start is NOT claimed (734: \"back to the room's beginning\" with 5000 rows)",
    { ranges: cov.ranges, full: cov.full, complete: cov.complete, windowFrom: cov.windowFrom, holes: H.holes() });
  ok(H.origin() === null && !o.said.some((m) => /ending at the room's first floor/.test(m)),
    "A: THE CHAIN IS NOT WALKED TO THE ROOM'S FIRST FLOOR — only as far down as the window needs (734: \"chain resolved from the room: … ending at the room's first floor\", twice)", { origin: H.origin(), said: o.said.filter((m) => /chain/.test(m)) });
  ok(view(d1.sb.StreamManager.getState()) === view(reference(d1, [R.server[R.BC.events_owner], R.server[R.BC.settings_owner]])),
    "A: THE ROOM THE DEVICE DERIVES EQUALS A READER'S THAT HOLDS EVERYTHING — now playing, the queue, the DJs (PILLARS §3; the fold is told \"short\" here)",
    { device: view(d1.sb.StreamManager.getState()) });
});
await part("B", async () => {
  if (!d1) return ok(false, "B PREMISE — part A's device exists");
  d2 = d1.reload({ meter: true });
  const o = await openSplit(d2);
  const H = d2.sb.History;
  ok(o.said.some((m) => /restored 5000 stored song/.test(m)), "B PREMISE — the reload restored the stored table", o.said.filter((m) => /history/.test(m)));
  ok(o.paged.calls === 0, "B: A SECOND OPEN PAGES NOTHING — the window is already held (734: 106 requests, down to l=2)", o.paged);
  ok(H.count() === MAXS && pisOf(d2) === newest(R, MAXS) && H.coverage().full === true && H.coverage().complete === false,
    "B: AND HOLDS THE SAME NEWEST 5000 SONGS, the window held", { count: H.count(), cov: H.coverage().ranges });
  ok(o.said.some((m) => /history holds the room's newest 5000 songs, from position \d+; nothing below is read/.test(m)), "B: AND SAYS IT HOLDS THE WINDOW", o.said.filter((m) => /history/.test(m)));
  ok(view(d2.sb.StreamManager.getState()) === view(reference(d2, [R.server[R.BC.events_owner], R.server[R.BC.settings_owner]])),
    "B: THE ROOM IT DERIVES EQUALS A READER'S THAT HOLDS EVERYTHING");
});
await part("C", async () => {
  if (!d2) return ok(false, "C PREMISE — part B's device exists");
  R.live.push(d2);
  const H = d2.sb.History, m = d2.meter.mark();
  R.song(SONGS + 2); R.song(SONGS + 3);
  const after2 = { holes: H.holes(), cov: H.coverage() };
  R.seal(); await settle(30);
  const mo = d2.sb.StreamManager.lastMoveOn(), cov = H.coverage(), win = R.window();
  ok(mo && mo.ok && mo.dropped > 0, "C PREMISE — the device moved on at the bot's save point", mo);
  ok(after2.holes.length === 0 && after2.cov.full === true, "C: A SONG PAST THE WINDOW RE-OPENS NO HOLE BELOW IT (734: [[0, 417]] at once)", after2);
  ok(H.holes().length === 0 && cov.full === true && cov.windowFrom === win.nth.l && H.count() === MAXS && pisOf(d2) === newest(R, MAXS),
    "C: AFTER THE MOVE-ON TOO — the window moved up by two songs and holds the newest 5000", { cov: cov.ranges, windowFrom: cov.windowFrom, want: win.nth.l });
  ok(d2.meter.since(m).calls === 0, "C: AND NOTHING WAS PAGED", d2.meter.since(m));
  // A LONGER STRETCH: a save point's worth of songs and the next save point, so the window's oldest song passes a save point
  for (let s = 0; s < EVERY + 5; s++) R.song(SONGS + 4 + s);
  R.seal(); await settle(30);
  const win2 = R.window(), marks = Object.keys(H.snapshot().verified || {}).map((k) => H.snapshot().verified[k]);
  ok(win2.nth.l > win.nth.l + EVERY, "C PREMISE — the window's oldest song moved up past a save point", { from: win.nth.l, to: win2.nth.l });
  // (734 held no such mark either, for another reason: it re-read the stretch below the window, which dropped them; this table never
  // reads it, so it drops them as the window passes — the row is the pruning's, `mutate-history-window` WP)
  ok(marks.length > 0 && marks.every((v) => v.hi >= win2.nth.l),
    "C: THE TABLE KEEPS NO VERIFY MARK WHOLLY BELOW THE WINDOW — what the window never reads again it does not carry", { below: marks.filter((v) => v.hi < win2.nth.l), marks: marks.length });
  const d3 = d2.reload({ meter: true });
  const o = await openSplit(d3);
  ok(o.paged.calls === 0 && d3.sb.History.count() === MAXS && d3.sb.History.coverage().full === true, "C: A THIRD OPEN PAGES NOTHING EITHER", o.paged);
});
await part("D", async () => {
  if (!d2) return ok(false, "D PREMISE — part B's device exists");
  const win = R.window(), m = d2.meter.mark(), l0 = d2.logs.length;
  const a = await d2.sb.MatrixBridge.historyAudit();
  const p = d2.meter.since(m), line = d2.logs.slice(l0).find((x) => /HISTORY AUDIT — truth/.test(x)) || "";
  ok(a && a.truthCount === MAXS && a.deviceCount === MAXS && !a.missing.length && !a.extra.length,
    "D: THE AUDIT UNDER THE WINDOW — truth = device on the window's 5000 songs, nothing missing, nothing extra (734: every song below the window \"missing\")",
    { truth: a && a.truthCount, device: a && a.deviceCount, missing: a && a.missing.length, extra: a && a.extra.length });
  ok(p.calls > 0 && isFinite(p.minL) && p.minL >= win.anchor - PAGE && a.fromL === win.anchor + 1,
    "D: IT READS FROM THE SAVE POINT THAT ANCHORS THE WINDOW — no further below (734: from the room's start)", { lowest: p.minL, fromL: a && a.fromL, anchor: win.anchor });
  ok(new RegExp("from the save point at l=" + win.anchor + " that anchors the window \\(its oldest song at l=" + win.nth.l + "; nothing below it is kept or compared\\)").test(line),
    "D: AND ITS LINE SAYS WHERE IT READ FROM", line.slice(0, 300));
});

// ═══ H — BACK AFTER A LONG ABSENCE ═════════════════════════════════════════════════════════════════════════════════════════
await part("H", async () => {
  if (!d2) return ok(false, "H PREMISE — part B's device exists");
  const i2 = R.live.indexOf(d2); if (i2 >= 0) R.live.splice(i2, 1);   // closed: it hears nothing more
  const away = (songs) => { for (let s = 0; s < songs; s++) { R.song(s); if ((s + 1) % EVERY === 0) R.seal(); } R.song(songs); };
  const exact = (w) => w.sb.History.count() === MAXS && pisOf(w) === newest(R, MAXS) && w.sb.History.holes().length === 0 && w.sb.History.coverage().full === true;
  // THE CONTROL: a short absence (a save point passes), inside what the reopening's download reaches
  away(50);
  const dc = d2.reload({ meter: true }); const oc = await openSplit(dc);
  ok(oc.paged.calls === 0 && exact(dc), "H (CONTROL): BACK AFTER A SHORT ABSENCE, NOTHING IS READ AND THE NEWEST 5000 ARE HELD", { paged: oc.paged, count: dc.sb.History.count() });
  const seen = R.seals[R.seals.length - 1];                  // the newest save point it has seen (the cut it holds)
  // THE LONG ABSENCE: 300 songs and their save points, past the reach of the reopening's download
  away(300);
  const dl = dc.reload({ meter: true }); const ol = await openSplit(dl);
  const walked = +(((ol.said.find((m) => /older floor\(s\) walked to/.test(m)) || "").match(/(\d+) older floor\(s\) walked to/) || [0, 0])[1]);
  ok(ol.said.some((m) => /older floor\(s\) walked to/.test(m)), "H PREMISE — the stretch it missed is past its download's reach: verify walked below the floors it holds", ol.said.filter((m) => /history —/.test(m)));
  ok(isFinite(ol.paged.minL) && ol.paged.minL >= seen - PAGE && ol.paged.calls <= 15,
    "H: BACK AFTER A LONG ABSENCE, IT READS THE STRETCH IT MISSED AND NO MORE — no further below than one request under the newest save point it had seen (735 as checked: 100 requests, down into the window it held)",
    { lowest: ol.paged.minL, seenAt: seen, requests: ol.paged.calls, walked });
  ok(exact(dl), "H: AND HOLDS THE NEWEST 5000 SONGS, no hole", { count: dl.sb.History.count(), cov: dl.sb.History.coverage().ranges });
  ok(view(dl.sb.StreamManager.getState()) === view(reference(dl, [R.server[R.BC.events_owner], R.server[R.BC.settings_owner]])), "H: AND DERIVES THE ROOM A READER HOLDING EVERYTHING DERIVES");
  // AN ABSENCE PAST THE WHOLE WINDOW: more songs than History keeps play while it is closed, so the new window starts inside the
  // stretch it missed. What it needs is the newest 5000; the save point anchoring the NEW window's oldest song bounds the read.
  away(MAXS + 100);
  const da = dl.reload({ meter: true }); const oa = await openSplit(da), wa = R.window();
  ok(wa.anchor > seen, "H PREMISE — past the whole window: the new window's anchoring save point is above every song it held", { anchor: wa.anchor, seenAt: seen });
  ok(isFinite(oa.paged.minL) && oa.paged.minL >= wa.anchor - PAGE && exact(da),
    "H: BACK AFTER AN ABSENCE PAST THE WHOLE WINDOW, NOTHING IS READ BELOW THE SAVE POINT ANCHORING THE NEW WINDOW — and the newest 5000 are held",
    { lowest: oa.paged.minL, anchor: wa.anchor, requests: oa.paged.calls, count: da.sb.History.count(), cov: da.sb.History.coverage().ranges });
});

// ═══ E — A SHARED ROOM PAST THE WINDOW ═════════════════════════════════════════════════════════════════════════════════════
await part("E", async () => {
  const S = sharedRoom();
  const O = S.tab(B.OWNER, { w: { order: B.ORDER.filter((f) => f !== "backends/backend1/history.js") } });   // the owner seals; no song history needed
  await O.open();
  S.put(B.OWNER, { t: "ddjp.room.settings", s: Object.assign(O.sb.StateDeriver.defaultSettings(), { checkpointCooldownMs: 0 }) });
  let prev = null, k = 0; const plays = [], floors = [];
  const song = () => "yt:s" + String(++k).padStart(10, "0");
  for (const u of ["@d0:hs", "@d1:hs", "@d2:hs"]) S.put(u, { t: "ddjp.dj.join", v: song() });
  const one = (s) => { S.now += 240000; prev = S.put(B.OWNER, { t: "ddjp.dj.play", p: prev }).event_id; plays.push({ pi: prev, l: S.L }); S.put("@d" + (s % 3) + ":hs", { t: "ddjp.dj.join", v: song() }); };
  for (let s = 0; s < SONGS; s++) { one(s); if ((s + 1) % EVERY === 0) { const cp = await S.seal(O); if (cp) floors.push(cp.floorL); } }
  one(SONGS); one(SONGS + 1);
  const nth = plays[plays.length - MAXS], anchor = floors.filter((f) => f < nth.l).pop();
  ok(plays.length > MAXS + 300 && typeof anchor === "number" && anchor > 300 && floors.length > 30,
    "E PREMISE — the shared room is past the window, with checkpoints the owner sealed and a floor under the window's oldest song", { plays: plays.length, floors: floors.length, anchor });
  const raws = () => Object.keys(S.server).filter((id) => id !== B.FULL_CH.checkpoints_owner).map((id) => S.server[id]);
  const meterAsks = (w) => { const asks = []; const p0 = w.sb.MatrixBridge.pageRange; w.sb.History.attach({ pageRange: async (a, b, o) => { asks.push([a, b]); return p0(a, b, o); } }); return asks; };
  const lowest = (asks) => asks.reduce((m, x) => Math.min(m, x[0]), Infinity);
  const D = S.tab(B.STAFF, { detached: true, w: { opened: false } });
  const asks1 = meterAsks(D);
  await D.open();
  const H = D.sb.History, cov = H.coverage();
  ok(asks1.length > 0 && lowest(asks1) >= anchor,
    "E: A SHARED ROOM'S FIRST OPEN NEVER ASKS ITS PAGER BELOW THE CHECKPOINT ANCHORING THE WINDOW (734: from 0, for every stretch)", { lowest: lowest(asks1), anchor, asks: asks1.length });
  ok(H.count() === MAXS && H.recent().map((r) => r.pi).sort().join() === plays.slice(-MAXS).map((p) => p.pi).sort().join() && cov.full === true && cov.complete === false && H.origin() === null,
    "E: AND HOLDS THE NEWEST 5000 SONGS, the window held, the chain not walked to the room's first floor", { count: H.count(), ranges: cov.ranges, origin: H.origin() });
  ok(view(D.sb.StreamManager.getState()) === view(reference(D, raws())), "E: THE ROOM THE DEVICE DERIVES EQUALS A READER'S THAT HOLDS EVERYTHING (after the first open)",
    { device: view(D.sb.StreamManager.getState()).slice(0, 200), ref: view(reference(D, raws())).slice(0, 200) });
  // A SONG AND A CHECKPOINT: the device adopts it and trims, which re-arms the backfill (run on its 0-ms timer).
  S.tabs.push(D);
  asks1.length = 0; const l0 = D.logs.length;
  one(SONGS + 2);
  await S.seal(O); await settle(50);
  D.timers.fire(0); await settle(150);
  ok(D.logs.slice(l0).some((m) => /derived log trimmed to floor/.test(m)) && D.logs.slice(l0).some((m) => /history — verified/.test(m)),
    "E PREMISE — the device trimmed at the new checkpoint and the re-armed backfill ran", D.logs.slice(l0).filter((m) => /trimmed|history —/.test(m)));
  ok(asks1.length > 0 && lowest(asks1) > floors[floors.length - 1] && H.holes().length === 0 && H.coverage().full === true,
    "E: A TRIM'S RE-ARMED BACKFILL ASKS ONLY FOR THE NEW STRETCH — nothing below the window, no hole (734: it asked [0, 8751])", { asks: asks1, lastFloor: floors[floors.length - 1] });
  // THE SECOND OPEN, with the stored table and the raw cache.
  const D2 = S.tab(B.STAFF, { detached: true, stored: JSON.parse(JSON.stringify(H.snapshot())), w: { opened: false, cache: D.sb.EventCache.values() } });
  const asks2 = meterAsks(D2);
  await D2.open();
  const w2 = D2.sb.History.coverage().windowFrom;
  ok(D2.logs.some((m) => /restored 5000 stored song/.test(m)) && typeof w2 === "number", "E PREMISE — the second open restored the table and holds the window", D2.logs.filter((m) => /history —/.test(m)));
  ok(asks2.every((x) => x[0] >= w2), "E: A SECOND OPEN ASKS NOTHING BELOW THE WINDOW (734: [0, 8751])", { asks: asks2, windowFrom: w2 });
  ok(view(D2.sb.StreamManager.getState()) === view(reference(D2, raws())), "E: THE ROOM IT DERIVES EQUALS A READER'S THAT HOLDS EVERYTHING (after the second open)");
  // BACK AFTER A LONG ABSENCE (part H's story in a shared room): 30 checkpoints, past the 24 its floor remembers, then a reopening
  const snapA = JSON.parse(JSON.stringify(D2.sb.History.snapshot())), cacheA = D2.sb.EventCache.values();
  const iD = S.tabs.indexOf(D); if (iD >= 0) S.tabs.splice(iD, 1);
  let sealedAway = 0;
  for (let s = 0; s < 30 * EVERY; s++) { one(SONGS + 10 + s); if ((s + 1) % EVERY === 0) { const cp = await S.seal(O); if (cp) { floors.push(cp.floorL); sealedAway++; } } }
  one(SONGS + 10 + 30 * EVERY);
  const D3 = S.tab(B.STAFF, { detached: true, stored: snapA, w: { opened: false, cache: cacheA } });
  const asks3 = meterAsks(D3);
  await D3.open();
  const v3 = D3.logs.find((m) => /history — verified/.test(m)) || "", walked3 = +((v3.match(/(\d+) older floor\(s\) walked to/) || [0, 0])[1]);
  ok(sealedAway === 30 && /older floor\(s\) walked to/.test(v3), "E PREMISE — 30 checkpoints passed while it was closed, more than its floor remembers: verify walked below them", { sealedAway, v3 });
  ok(walked3 <= sealedAway, "E: BACK AFTER A LONG ABSENCE, THE WALK GOES NO FURTHER DOWN THAN THE CHECKPOINTS IT MISSED (735 as checked: 101 floors, to the window it held)", { walked: walked3, missed: sealedAway });
  ok(D3.sb.History.count() === MAXS && D3.sb.History.recent().map((r) => r.pi).sort().join() === plays.slice(-MAXS).map((p) => p.pi).sort().join() && asks3.every((x) => x[0] >= D3.sb.History.coverage().windowFrom),
    "E: AND HOLDS THE NEWEST 5000, asking nothing below the new window", { count: D3.sb.History.count(), lowest: asks3.reduce((m, x) => Math.min(m, x[0]), Infinity), windowFrom: D3.sb.History.coverage().windowFrom });
});

// ═══ F — A ROOM SHORTER THAN THE WINDOW (the control) ════════════════════════════════════════════════════════════════════════
await part("F", async () => {
  const Rs = botRoom(300); await Rs.build();
  const d = B.world({ me: B.OWNER, server: Rs.server, opened: false, meter: true });
  const o = await openSplit(d);
  const H = d.sb.History, cov = H.coverage();
  ok(Rs.plays.length < MAXS && Rs.seals.length > 5, "F PREMISE — a bot room shorter than the window, with several save points", { plays: Rs.plays.length, seals: Rs.seals.length });
  // (the open's whole read, the replay's download included: in so short a room the download may already hold the start)
  ok(cov.complete === true && H.count() === Rs.plays.length && d.meter.minL <= 2 && H.origin() && H.origin().start === true,
    "F: (CONTROL) A ROOM SHORTER THAN THE WINDOW IS READ TO ITS START, AS BEFORE, AND ITS START IS RECORDED", { cov: cov.ranges, count: H.count(), lowest: d.meter.minL, songHistory: o.paged, origin: H.origin() });
  const d2s = d.reload({ meter: true });
  const o2 = await openSplit(d2s);
  ok(o2.paged.calls === 0 && d2s.sb.History.count() === Rs.plays.length && d2s.sb.History.coverage().complete === true,
    "F: ITS SECOND OPEN READS NOTHING — the stretch from the room's start, checked once, is not read again (734: the whole room, again)", o2.paged);
});

// ═══ G — HISTORY'S OWN FILLS, DRIVEN ALONE ═════════════════════════════════════════════════════════════════════════════════
await part("G", async () => {
  const { loadInContext } = require("./_load");
  const F = require("./_fixtures.js");
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {});
  const SD = sb.StateDeriver;
  // the room: three DJs, each song a play and a top-up, a save point every 40 songs (its seed built by the reducer, its event just above its cut)
  const E = [F.reducerEvent("$s", 1, 1e12, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: SD.defaultSettings() })];
  let l = 1, prev = null, k = 0; const plays = [], cps = [];
  const key = () => "yt:g" + String(++k).padStart(10, "0");
  for (let d = 0; d < 3; d++) E.push(F.reducerEvent("$j" + d, ++l, 1e12 + l * 1000, "@d" + d + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: key() }));
  let seedAt = null;
  for (let s2 = 0; s2 < SONGS + 2; s2++) {   // two songs past the last save point
    const at = 1e12 + (s2 + 1) * 300000;   // five minutes a song: each play past the last one's gate
    const id = "$p" + s2; E.push(F.reducerEvent(id, ++l, at, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: prev })); prev = id; plays.push({ pi: id, l });
    E.push(F.reducerEvent("$t" + s2, ++l, at + 500, "@d" + (s2 % 3) + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: key() }));
    if ((s2 + 1) % EVERY === 0 && s2 < SONGS) { const cut = l; seedAt = SD.buildSeed(E.slice(), undefined); cps.push(cut);
      E.push({ eventId: "$c" + cut, type: "ddjp.checkpoint", l: ++l, ts: at + 600, sender: "@o:hs", senderRank: F.RANK.owner, content: { t: "ddjp.checkpoint", floorL: cut, seed: seedAt } }); }
  }
  const nth = plays[plays.length - MAXS], anchor = cps.filter((c) => c < nth.l).pop(), spacing = cps[1] - cps[0], top = l;
  const asks = [];
  const pager = async (a, b) => { asks.push([a, b]); const out = E.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; };
  const anchorOf = (e) => (e && e.type === "ddjp.checkpoint" && e.content && e.content.seed) ? { l: e.content.floorL, seed: e.content.seed } : null;
  ok(plays.length > MAXS + 300 && typeof anchor === "number" && anchor > 4 * spacing, "G PREMISE — the room is past the window, with save points under its oldest song", { plays: plays.length, anchor, spacing });
  // G1 — a backfill into an empty table, from the room's start up to the newest position (the bridge's call when nothing is covered)
  const H = sb.History; H.reset(); H.attach({ pageRange: pager, anchorOf });
  await H.backfill(0, undefined, top + 1);
  const low1 = asks.reduce((m, x) => Math.min(m, x[0]), Infinity), c1 = H.coverage();
  ok(c1.full === true && c1.complete === false && c1.windowFrom === nth.l && H.count() === MAXS,
    "G: A BACKFILL INTO AN EMPTY TABLE STOPS AT THE WINDOW — the newest 5000 songs, held, the room's start not claimed", { cov: c1.ranges, windowFrom: c1.windowFrom, want: nth.l, count: H.count() });
  ok(low1 >= anchor - spacing, "G: AND READS FROM THE TOP DOWN, NO DEEPER THAN ONE STRETCH BELOW THE SAVE POINT ANCHORING THE WINDOW (734: one read from 0)", { lowest: low1, anchor, spacing, asks: asks.length });
  // G2 — a deep hole: a table holding only the newest stretch (as a device that held the room's last songs), then the fill
  const H2 = (loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {})).History;
  H2.reset(); asks.length = 0; H2.attach({ pageRange: pager, anchorOf });
  const lastCut = cps[cps.length - 1];
  H2.ingest(E.filter((e) => e.l > lastCut && e.type !== "ddjp.checkpoint"), seedAt, { from: lastCut + 1, to: top, src: "refresh" });
  ok(H2.holes().length === 1 && H2.holes()[0][0] === 0 && !H2.coverage().full, "G PREMISE — the table holds the newest stretch only: one hole, down to the room's start", H2.holes());
  await H2.fillGaps();
  const low2 = asks.reduce((m, x) => Math.min(m, x[0]), Infinity), c2 = H2.coverage();
  ok(c2.full === true && c2.windowFrom === nth.l && H2.count() === MAXS && H2.holes().length === 0,
    "G: A DEEP HOLE IS FILLED FROM ITS TOP DOWN AND THE FILL STOPS AT THE WINDOW — no hole left, the newest 5000 held", { cov: c2.ranges, windowFrom: c2.windowFrom, count: H2.count() });
  ok(low2 >= anchor - spacing, "G: NO READ DEEPER THAN ONE STRETCH BELOW THE ANCHORING SAVE POINT (734: the hole read from 0)", { lowest: low2, anchor, spacing, asks: asks.length });
});

if (failed) { console.log("[history-window] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[history-window] PASS — song history stops at the room's newest 5000 songs (the owner's, history-rules §10; " + asserts + " assertions): " +
  "in a bot room past the window a first open reads no further below it than the save point anchoring its oldest song, holds " +
  "exactly the newest 5000 with no hole and claims no reach to the room's start, walks the chain only that far, and derives " +
  "the room a reader holding everything derives; a second and third open page nothing, a song past the window re-opens no hole " +
  "and a move-on pages nothing; the audit reads from the anchoring save point and finds truth = device; in a shared room past " +
  "the window no open and no trim asks below it; back after a long absence (bot and shared) a device reads only the stretch it " +
  "missed, no further down than where its earlier checks resume, while a short absence reads nothing; and a room shorter than " +
  "the window is read to its start once, as before.");
})();
