// tests/check-bot-room-history.js
// SUBJECT: backends/backend1/streammanager.js, backends/backend1/matrixbridge.js, backends/backend1/history.js, backends/backend1/statederiver.js
// WALL: SONG HISTORY IN A BOT ROOM KEEPS WHAT A SAVE POINT CROSSES — the two owed song-history fixes (the owner's, `main/01-project.md`
// item 7; `consensus/history-rules.md` §9 and §11).
//
//   A  A TAB AWAY THROUGH THE BOT'S SAVE POINT KEEPS THAT STRETCH'S SONGS (found at `ddjp_662`, J130's entry). The move-on hands
//      song history the stretch it drops, and song history writes nothing before the tab is settled; a shared room's trim
//      re-arms the backfill, a bot room's move-on did not, so two songs played while a device was away through a seal were
//      missing after it was back and after the next song, and came back only at a reload. Now the move-on owes the backfill and
//      the tab pays it the moment it is settled (`MatrixBridge.oweHistoryBackfill`, paid by `_payHistory`, J97's shape) — not
//      before. CONTROL: the same story with the tab settled through the save point.
//   B  A REPEAT SKIP AT A SAVE POINT KEEPS ITS REASON (driven at `ddjp_663`). The token the bot's skip names (`repeat`) went only on
//      the fold's own row, and a fold from a save point has no row for that song — so the replay cooldown (`Room.playedWithin`)
//      counted the skipped try as a play and dated the cooldown from it. Now the fold records it by play (`state.endedBy`, beside
//      `cutShortBy`) and song history writes it onto the row. His words: "3 yes but we see them in history with skipped" — the
//      row still shows "skipped". CONTROL: the same skip with no save point between the repeat's start and its skip.
//
// ALL DRIVEN: every backend module of both engines, `History`, the bridge, `features/room.js` and `features/queue.js` (B), behind the
// real seam (`tests/_botroom.js`, its SDK client the only double; `away()`/`back()` and the captured timers its opt-ins). Each part
// asserts its premise: the tab moved on, it was suspended while the songs played, the repeat started, the save point held it.
"use strict";
const B = require("./_botroom.js");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[bot-room-history] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 700) : "")); } }
async function part(name, fn) { try { await fn(); } catch (e) { failed++; console.log("[bot-room-history] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 4).join(" | ")); } }
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 25));

function botRoom(settings) {
  const BC = B.BOT_CH, MIN = 60000;
  const server = { [B.SPACE]: [], [BC.events_uncategorized]: [], [BC.events_owner]: [], [BC.settings_owner]: [] };
  const R = { server, BC, L: 0, TS: 1792447900000, nIn: 0, pi: null, k: 0, live: [] };
  R.post = (roomId, sender, body) => { R.L++; R.TS += (body.t === "ddjp.dj.play" || body.t === "ddjp.dj.skip" ? 4 * MIN : 1000);
    const raw = { type: "m.room.message", event_id: "$b" + String(R.L).padStart(5, "0"), room_id: roomId, sender, origin_server_ts: R.TS,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: R.L })) } };
    server[roomId].push(raw); for (const d of R.live) d.live(raw); return raw; };
  R.bot = B.world({ me: B.BOT, server, opened: false });
  const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++R.nIn), at: null });
  R.key = (fixed) => "yt:" + (fixed || ("b" + String(++R.k).padStart(10, "0")));
  R.join = (who, v) => R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v.slice(3) }, who, R.PL));
  R.play = () => { const r = R.post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.play", p: R.pi }, B.BOT, 99)); R.pi = r.event_id; return r; };
  R.skip = (k) => { const r = R.post(BC.events_owner, B.BOT, rel(Object.assign({ t: "ddjp.dj.skip", p: R.pi }, k ? { k } : {}), B.BOT, 99)); R.pi = r.event_id; return r; };
  R.song = (s) => { const r = R.play(); R.join("@d" + (s % 3) + ":hs", R.key()); return r; };
  R.seal = () => { const log = R.bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
    const out = R.bot.sb.B2Checkpoint.seal(R.bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
    if (!out.ok) throw new Error("seal refused: " + out.reason); R.post(BC.events_owner, B.BOT, out.cp); return out.cp; };
  R.start = async () => { await R.bot.open(); R.live.push(R.bot); R.PL = R.bot.sb.Ranks.levelOf("player");
    R.post(BC.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(R.bot.sb.StateDeriver.defaultSettings(), { vis: "public" }, settings || {}) });
    for (let k = 0; k < 3; k++) R.join("@d" + k + ":hs", R.key()); };
  return R;
}

(async () => {
// ═══ A — AWAY THROUGH THE BOT'S SAVE POINT ═══════════════════════════════════════════════════════════════════════════════════
async function awayStory(away) {
  const R = botRoom(); await R.start();
  for (let s = 0; s < 6; s++) R.song(s);
  R.seal();
  for (let s = 6; s < 8; s++) R.song(s);
  const dev = B.world({ me: B.OWNER, server: R.server, opened: false, timers: true });
  await dev.open(); R.live.push(dev);
  const H = dev.sb.History, SS = dev.sb.Session, has = (pi) => H.recent().some((h) => h.pi === pi);
  if (away) dev.away();
  const phase = SS.phase();
  const mine = [R.song(8).event_id, R.song(9).event_id];       // two songs while (maybe) away
  const l0 = dev.logs.length;
  R.seal(); dev.timers.fire(0); await settle(40);                // the bot's save point: the tab moves on
  const mo = dev.sb.StreamManager.lastMoveOn();
  const atSeal = mine.map(has), whileAway = dev.logs.slice(l0).filter((m) => /history — verified|history backfill/.test(m)).length;
  const l1 = dev.logs.length;
  const live = away ? await dev.back() : SS.phase() === SS.LIVE;
  const atBack = mine.map(has), paid = dev.logs.slice(l1).filter((m) => /history — verified \d+ segment/.test(m)).length;
  R.song(10); await settle(20);
  const afterNext = mine.map(has);
  return { phase, mo, atSeal, whileAway, live, atBack, paid, afterNext, LIVE: SS.LIVE, SUSPENDED: SS.SUSPENDED };
}
await part("A control", async () => {
  const c = await awayStory(false);
  ok(c.phase === c.LIVE && c.mo && c.mo.ok && c.mo.dropped > 0, "A PREMISE (control) — settled through the save point, the tab moved on", c);
  ok(c.atSeal.every(Boolean) && c.afterNext.every(Boolean), "A (CONTROL): SETTLED, THE TWO SONGS ARE IN SONG HISTORY AT THE SAVE POINT AND AFTER", c);
});
await part("A away", async () => {
  const a = await awayStory(true);
  ok(a.phase === a.SUSPENDED && a.mo && a.mo.ok && a.mo.dropped > 0 && a.live === true,
    "A PREMISE — the tab was suspended while the two songs played, moved on at the bot's save point, and came back LIVE", a);
  ok(!a.atSeal.some(Boolean) && a.whileAway === 0,
    "A: WHILE AWAY, SONG HISTORY WRITES NOTHING AND THE OWED READ WAITS — no backfill runs before the tab is settled (§4)", a);
  ok(a.atBack.every(Boolean) && a.paid === 1,
    "A: SETTLED AGAIN, THE TWO SONGS ARE IN SONG HISTORY AT ONCE — the backfill the move-on owed, paid once (734: missing, back only at a reload)", a);
  ok(a.afterNext.every(Boolean), "A: AND THEY STAY AFTER THE NEXT SONG", a);
});

// ═══ B — A REPEAT SKIP AT A SAVE POINT ═══════════════════════════════════════════════════════════════════════════════════════
async function repeatStory(sealBetween) {
  const R = botRoom({ repeatCooldownMs: 60 * 60 * 1000 }); await R.start();
  const A = R.key("aaaaaaaaaaa");
  const order = B.ORDER.concat(["core/playlistdoc.js", "features/queue.js"]);
  const extras = { ServerClock: { serverNow: () => R.TS, init() {}, destroy() {} } };
  R.song(0); R.song(1);
  R.join("@d9:hs", A);
  for (let s = 2; s < 6; s++) R.song(s);
  R.seal();
  const dev = B.world({ me: B.OWNER, server: R.server, opened: false, order, extras });
  await dev.open(); R.live.push(dev); dev.sb.Queue.init(R.BC.events_uncategorized);
  for (let s = 6; s < 9; s++) R.song(s);
  const H = dev.sb.History, row = (pi) => H.recent().find((h) => h.pi === pi) || null;
  const first = H.recent().find((h) => h.songKey === A) || null;    // A's real play
  R.join("@d9:hs", A);                                             // A queued again
  let g = 0; while ((dev.sb.StreamManager.getState().nowPlaying || {}).song && dev.sb.StreamManager.getState().nowPlaying.song.songKey !== A && g++ < 10) R.song(9 + g);
  const np = dev.sb.StreamManager.getState().nowPlaying, again = np && np.song && np.song.songKey === A ? np.pi : null;
  if (sealBetween) R.seal();                                       // the bot's save point, sealed while the repeat plays
  R.skip("repeat");                                                // the bot's repeat skip ends it (`Skip.skip("repeat")`'s body)
  R.join("@d0:hs", R.key()); R.song(30); await settle(30);
  const mo = dev.sb.StreamManager.lastMoveOn(), r = row(again);
  const pw = dev.sb.Room.playedWithin(A, R.TS);
  dev.sb.MatrixBridge.persistHistoryNow();
  const d2 = dev.reload({ order, extras }); await d2.open();
  const r2 = d2.sb.History.recent().find((h) => h.pi === again) || null;
  return { first, again, mo, r, pw, r2, seedNp: mo && mo.ok ? (dev.sb.StreamManager.floorSeed() || {}).nowPlaying : null };
}
await part("B control", async () => {
  const c = await repeatStory(false);
  ok(c.first && c.again && c.again !== c.first.pi && !(c.mo && c.mo.ok), "B PREMISE (control) — A played, came up again, was skipped with no save point between", c);
  ok(c.r && c.r.cutShortBy === "dj" && c.r.endedBy === "repeat" && c.pw.reason === "played" && c.pw.at === c.first.at,
    "B (CONTROL): THE ROW SHOWS \"skipped\" AND KEEPS ITS REASON; THE COOLDOWN DATES FROM THE REAL PLAY", { row: c.r, at: c.pw.at, first: c.first.at });
});
await part("B at a save point", async () => {
  const s = await repeatStory(true);
  ok(s.first && s.again && s.mo && s.mo.ok, "B PREMISE — A came up again and the tab moved on at the save point sealed while it played", { again: s.again, mo: s.mo });
  ok(s.r && s.r.cutShortBy === "dj", "B: THE REPEAT-SKIPPED SONG STILL SHOWS IN HISTORY AS SKIPPED (his words: \"we see them in history with skipped\")", s.r);
  ok(s.r && s.r.endedBy === "repeat", "B: AND ITS ROW KEEPS THE SKIP'S REASON ACROSS THE SAVE POINT — the fold records it by play (734: lost)", s.r);
  ok(s.pw.reason === "played" && s.pw.at === s.first.at,
    "B: SO THE REPLAY COOLDOWN DATES FROM THE REAL PLAY, NOT THE SKIPPED TRY (734: from the try)", { at: s.pw.at, firstPlay: s.first.at, row: s.r });
  ok(s.r2 && s.r2.cutShortBy === "dj" && s.r2.endedBy === "repeat", "B: AND A RELOAD'S TABLE, CHECKED AGAINST THE ROOM, KEEPS IT", s.r2);
});

if (failed) { console.log("[bot-room-history] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[bot-room-history] PASS — a bot room's song history keeps what a save point crosses (" + asserts + " assertions): a tab away " +
  "through the bot's save point writes nothing while away, and once settled holds that stretch's songs at once — the backfill the " +
  "move-on owed, paid once — and after the next song; a repeat skip at a save point keeps its reason on the row, which still shows " +
  "\"skipped\", so the replay cooldown dates from the real play; a reload keeps it. Each with its control.");
})();
