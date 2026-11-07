// tests/check-history-skip.js
// SUBJECT: backends/backend1/statederiver.js, backends/backend1/history.js, ui/panels.js
// WALL: History marks THE SONG A SKIP CUT SHORT, and says which kind of skip (J131's correction, the owner's decisions in
// `main/04-features.md` §Room History).
//
// THE DEFECT (the owner's report, driven at `ddjp_663` on 662's real fold): the fold set `skipped` on the `nowPlaying` a skip
// STARTED and History copied it, so the mark sat one song late — the song after the one skipped — and the last song before an
// empty room was never marked. Now the fold records, BY PLAY, how each playing it saw end was ended (`state.cutShortBy`:
// "dj" for `ddjp.dj.skip` — a person's, or the bot's own, its repeat skip included — "media" for `ddjp.media.skip`, the room's
// skip of a song that could not play, `false` for a plain advance), and History writes it onto that play's row. By play, not
// only by row: a fold that starts at a save point has no row for the save point's song, yet sees it end.
//
//   PART A — the real fold: each skip marks the song it ENDED (the event's own `p`, which the advance lock holds), the last
//            song before an empty room included; a fold from a save point records the save point's song.
//   PART B — the record is outside every save point: two rooms that differ only in HOW a song was cut short seal the same
//            seed, byte for byte, while their records differ; and it is bounded as the fold's history is.
//   PART C — order-independent: every arrival order through the real door (`StreamManager.ingest`) gives the same record, as
//            `check-convergence` asks of the room; and History, fed in any order, marks the same rows.
//   PART D — the real History: the mark reaches the row on every path that writes one — a fold, a fold from a save point,
//            a rewrite that cannot see the ending (kept), verify across two save points, the floor-anchored truth — and a later
//            fold that settles a same-position race the other way corrects it.
//   PART E — the real History tab (DOM-shaped, `tests/_screen-world.js`, its rows from PART D's real History): "skipped" for
//            a person's skip and for the bot's repeat skip, "Sys Skip" for the room's, both in `.hist-skip` (the teal,
//            `check-list-look` B), nothing on a song that ran out; and History's record states the words as displayed.
//            CHANGED ON PURPOSE (`ddjp_667`, the owner: "also system skipped news to say Sys Skip to be not far from Skipped"):
//            the room's word is "Sys Skip", where it was "Sys Skipped" — a word on screen only; every row keeps its kind.
//
// EACH PART ASSERTS ITS OWN PREMISE (the fixture reached the path: the songs that played, the room emptying, the seeded fold
// holding no row for the save point's song, a race resolved the other way), so a row refuses itself rather than pin nothing.
// The feature pass-through (`Queue.recentHistory` → the transport → `History.recent`) is a stand-in answering `History.recent`;
// that chain is driven whole by `check-queue-redraw` K.

"use strict";
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures.js");
const S = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-skip] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
async function part(name, fn) {
  try { await fn(); } catch (e) { failed++; console.log("[history-skip] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
}

const E = F.reducerEvent, R = F.RANK;
const DJ = "@dj:hs", OWN = "@own:hs", BOT = "@bot:hs";
// ── THE ROOM: five songs, each ended a different way ─────────────────────────────────────────────────────────────────────
// A — a person skips it. B — it cannot play (five guests report it) and the room skips it. C — it runs out; a plain advance.
// D — the bot's repeat skip (the body `Skip.skip("repeat")` sends: `p` and `k`). E — a person skips it and the room empties
// (the DJ's last song: nothing starts). Bodies as the real authors send them (`features/skip.js`, `features/mediablocked.js`).
function scenario() {
  const log = []; let l = 0;
  const add = (id, ts, who, rank, body) => { log.push(E(id, ++l, ts, who, rank, body)); return id; };
  add("$join", 1000, DJ, R.player, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" });
  add("$dec1", 1000, DJ, R.player, { t: "ddjp.dj.declare", v: "BBBBBBBBBBB" });
  add("$pA", 100000, DJ, R.player, { t: "ddjp.dj.play", p: null });
  add("$dec2", 100500, DJ, R.player, { t: "ddjp.dj.declare", v: "CCCCCCCCCCC" });
  add("$sB", 110000, OWN, R.owner, { t: "ddjp.dj.skip", p: "$pA" });
  add("$dec3", 110500, DJ, R.player, { t: "ddjp.dj.declare", v: "DDDDDDDDDDD" });
  for (const b of F.blockedCrowd(l + 1, 120000, "$sB")) { log.push(b); l = b.l; }
  add("$mC", 130000, DJ, R.player, { t: "ddjp.media.skip", p: "$sB", blockedGuestPlus: 5, blockedVipPlus: 0, by: R.player });
  add("$dec4", 130500, DJ, R.player, { t: "ddjp.dj.declare", v: "EEEEEEEEEEE" });
  add("$pD", 400000, DJ, R.player, { t: "ddjp.dj.play", p: "$mC" });
  add("$sE", 410000, BOT, R.owner, { t: "ddjp.dj.skip", p: "$pD", k: "repeat" });
  add("$sX", 420000, OWN, R.owner, { t: "ddjp.dj.skip", p: "$sE" });
  return log;
}
const LOG = scenario();
const SONGS = ["$pA", "$sB", "$mC", "$pD", "$sE"];
const VIDS = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD", "EEEEEEEEEEE"];
const ENDED = { "$pA": "dj", "$sB": "media", "$mC": false, "$pD": "dj", "$sE": "dj" };
const WORDS = { "$pA": "skipped", "$sB": "Sys Skip", "$mC": null, "$pD": "skipped", "$sE": "skipped" };   // "Sys Skip" since `ddjp_667` (PART E)
// The save point taken while B plays: everything up to B's start and the declare after it.
const CUT = LOG.findIndex((e) => e.eventId === "$dec3") + 1;
const PREFIX = LOG.slice(0, CUT), AFTER = LOG.slice(CUT);

const fold = () => loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/statederiver.js"], {}).StateDeriver;
const historyCtx = () => loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/statederiver.js", "backends/backend1/history.js"], {});
const marks = (rows) => { const o = {}; for (const r of rows || []) if (r && r.pi) o[r.pi] = (r.cutShortBy === undefined) ? "(none)" : r.cutShortBy; return o; };
const want = (pis) => { const o = {}; for (const p of pis) o[p] = ENDED[p]; return o; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byPi = (H) => { const m = {}; for (const r of H.recent()) m[r.pi] = r; return m; };

(async () => {
// ═══ PART A — the fold names the song a skip cut short ═══════════════════════════════════════════════════════════════════
await part("A", () => {
  const SD = fold();
  const st = SD.derive(LOG);
  const rows = st.history || [];
  const d = rows.find((r) => r.pi === "$pD");
  ok(rows.map((r) => r.pi).join() === SONGS.join() && rows.map((r) => r.videoId).join() === VIDS.join() && st.nowPlaying === null
    && d && d.endedBy === "repeat",
    "A PREMISE — five songs played, A to E, the last skip emptied the room, and the bot's skip was the repeat skip (D's row says so)",
    { rows: rows.map((r) => [r.pi, r.videoId, r.endedBy]), np: st.nowPlaying });
  const rec = st.cutShortBy || {};
  ok(rec["$pA"] === "dj" && rec["$sB"] !== "dj", "A: A PERSON'S SKIP MARKS THE SONG IT CUT SHORT (A), not the song it started (B)", rec);
  ok(rec["$sB"] === "media", "A: THE ROOM'S SKIP OF A SONG THAT COULD NOT PLAY MARKS THAT SONG (B) AS ITS OWN KIND", rec);
  ok(rec["$mC"] === false, "A: A SONG THAT RAN OUT IS RECORDED AS NOT CUT SHORT (C)", rec);
  ok(rec["$pD"] === "dj", "A: THE BOT'S REPEAT SKIP MARKS THE SONG IT ENDED (D), as a person's skip does", rec);
  ok(rec["$sE"] === "dj", "A: THE LAST SONG BEFORE AN EMPTY ROOM IS MARKED (E) — the skip started nothing", rec);
  ok(same(rec, ENDED), "A: THE RECORD IS EXACTLY THE FIVE SONGS THAT ENDED, nothing else", rec);
  ok(rows.every((r) => !("skipped" in r)), "A: NO ROW CARRIES THE MARK OF HOW IT STARTED — that is what put \"skipped\" on the next song",
    rows.map((r) => [r.pi, r.skipped]));
  // From the save point taken while B plays: the fold has no row for B, yet sees the room skip it.
  const seed = SD.buildSeed(PREFIX);
  const s2 = SD.derive(AFTER, seed);
  ok(seed.nowPlaying && seed.nowPlaying.pi === "$sB" && !(s2.history || []).some((r) => r.pi === "$sB") && (s2.history || []).length === 3,
    "A PREMISE — the save point holds B on air, and the fold from it has no row for B (C, D, E only)",
    { seedNp: seed.nowPlaying && seed.nowPlaying.pi, rows: (s2.history || []).map((r) => r.pi) });
  ok(same(s2.cutShortBy, want(["$sB", "$mC", "$pD", "$sE"])), "A: A FOLD FROM A SAVE POINT RECORDS THE SAVE POINT'S SONG BY PLAY (B, \"media\")", s2.cutShortBy);
});

// ═══ PART B — outside every save point, and bounded ══════════════════════════════════════════════════════════════════════
await part("B", () => {
  const SD = fold();
  // Two rooms identical but for HOW A ended: the DJ's own skip, or the room's skip (five guests reported it in both).
  const room = (ending) => {
    const log = []; let l = 0;
    const add = (id, ts, who, rank, body) => { log.push(E(id, ++l, ts, who, rank, body)); };
    add("$join", 1000, DJ, R.player, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" });
    add("$dec1", 1000, DJ, R.player, { t: "ddjp.dj.declare", v: "BBBBBBBBBBB" });
    add("$pA", 100000, DJ, R.player, { t: "ddjp.dj.play", p: null });
    for (const b of F.blockedCrowd(l + 1, 101000, "$pA")) { log.push(b); l = b.l; }
    add("$xA", 110000, DJ, R.player, ending === "media"
      ? { t: "ddjp.media.skip", p: "$pA", blockedGuestPlus: 5, blockedVipPlus: 0, by: R.player } : { t: "ddjp.dj.skip", p: "$pA" });
    add("$dec2", 110500, DJ, R.player, { t: "ddjp.dj.declare", v: "CCCCCCCCCCC" });
    return log;
  };
  const a = room("dj"), b = room("media");
  const sa = SD.derive(a), sb = SD.derive(b);
  ok(sa.nowPlaying && sb.nowPlaying && sa.nowPlaying.pi === "$xA" && sb.nowPlaying.pi === "$xA"
    && (sa.cutShortBy || {})["$pA"] === "dj" && (sb.cutShortBy || {})["$pA"] === "media",
    "B PREMISE — both endings were accepted (B on air in both), and the two records differ at A",
    { a: [sa.nowPlaying && sa.nowPlaying.pi, sa.cutShortBy], b: [sb.nowPlaying && sb.nowPlaying.pi, sb.cutShortBy] });
  const ja = JSON.stringify(SD.buildSeed(a)), jb = JSON.stringify(SD.buildSeed(b));
  ok(ja === jb, "B: THE RECORD IS OUTSIDE THE SAVE POINT — two rooms that differ only in how A was cut short seal the same seed, byte for byte",
    { a: ja.length, b: jb.length });
  const keys = []; (function walk(x) { if (x && typeof x === "object") for (const k of Object.keys(x)) { keys.push(k); walk(x[k]); } })(JSON.parse(ja));
  ok(keys.indexOf("cutShortBy") < 0, "B: NO KEY OF THE SEED, AT ANY DEPTH, CARRIES IT", keys.filter((k) => /cut/i.test(k)));
  // BOUNDED AS HISTORY IS: a room longer than the fold's history window keeps the newest endings only.
  const long = []; let l = 0;
  long.push(E("$j", ++l, 1000, DJ, R.player, { t: "ddjp.dj.join", v: "V0000000000" }));
  long.push(E("$d0", ++l, 1000, DJ, R.player, { t: "ddjp.dj.declare", v: "V0000000001" }));
  const N = 5010; let prev = null;
  for (let i = 0; i < N; i++) {
    const id = "$q" + i;
    long.push(E(id, ++l, 100000 + i * 20000, DJ, R.player, { t: "ddjp.dj.play", p: prev }));
    long.push(E("$e" + i, ++l, 100000 + i * 20000 + 500, DJ, R.player, { t: "ddjp.dj.declare", v: "W" + String(i).padStart(10, "0") }));
    prev = id;
  }
  const sl = SD.derive(long), rk = Object.keys(sl.cutShortBy || {});
  ok((sl.history || []).length > 0 && sl.history.length < N && sl.nowPlaying && sl.nowPlaying.pi === "$q" + (N - 1),
    "B PREMISE — the room is longer than the fold's history window (its history stopped growing)", { history: (sl.history || []).length, N });
  ok(rk.length > 0 && rk.length <= sl.history.length && rk.indexOf("$q" + (N - 2)) >= 0 && rk.indexOf("$q0") < 0,
    "B: THE RECORD IS BOUNDED AS THE FOLD'S HISTORY IS — the newest endings kept, the oldest gone", { kept: rk.length, history: sl.history.length, first: rk[0], last: rk[rk.length - 1] });
});

// ═══ PART C — every arrival order gives the same record ══════════════════════════════════════════════════════════════════
await part("C", () => {
  const client = () => loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js"], { Date }).StreamManager;
  const raws = LOG.map(F.toRaw);
  const base = client(); raws.forEach((r) => base.ingest(r));
  const baseRec = JSON.stringify(base.getState().cutShortBy);
  ok(baseRec === JSON.stringify(ENDED) && base.getState().nowPlaying === null,
    "C PREMISE — through the real door, in order, the room is the scenario (the five endings, the room empty)", baseRec);
  let rnd = 663; const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
  const runs = 60; let bad = null;
  for (let i = 0; i < runs && !bad; i++) {
    const c = client(); F.shuffled(raws, rand).forEach((r) => c.ingest(r));
    const got = JSON.stringify(c.getState().cutShortBy);
    if (got !== baseRec) bad = { run: i, got };
  }
  ok(!bad, "C: EVERY ARRIVAL ORDER THROUGH THE DOOR GIVES THE SAME RECORD (" + runs + " shuffled orders)", bad);
  // History, fed the same log in any order, marks the same rows.
  const HX = historyCtx(), H = HX.History;
  H.ingest(LOG, undefined, { src: "refresh" });
  const first = JSON.stringify(marks(H.recent()));
  ok(first === JSON.stringify(marks(SONGS.slice().reverse().map((p) => ({ pi: p, cutShortBy: ENDED[p] })))),
    "C PREMISE — History, fed in order, marks the five rows", first);
  let badH = null;
  for (let i = 0; i < runs && !badH; i++) {
    H.reset(); H.ingest(F.shuffled(LOG, rand), undefined, { src: "refresh" });
    const got = JSON.stringify(marks(H.recent()));
    if (got !== first) badH = { run: i, got };
  }
  ok(!badH, "C: HISTORY FED IN ANY ORDER MARKS THE SAME ROWS (" + runs + " shuffled orders)", badH);
});

// ═══ PART D — the real History writes it onto the row, on every path ═══════════════════════════════════════════════════
let SHOWN = null;   // PART D's History after the plain fold, for PART E's screen
await part("D", async () => {
  const SD = fold();
  // D1 — one fold of the room.
  const HX = historyCtx(), H = HX.History;
  H.ingest(LOG, undefined, { src: "refresh" });
  const r1 = byPi(H);
  ok(H.count() === 5 && SONGS.every((p, i) => r1[p] && r1[p].videoId === VIDS[i]), "D PREMISE — History holds the five songs", H.recent().map((r) => r.pi));
  ok(same(marks(SONGS.map((p) => r1[p])), want(SONGS)), "D: A FOLD MARKS EACH ROW BY HOW ITS SONG ENDED (A, D, E \"dj\"; B \"media\"; C not cut short)",
    marks(SONGS.map((p) => r1[p])));
  ok(SONGS.every((p) => r1[p] && !("skipped" in r1[p])), "D: NO ROW CARRIES THE OLD MARK (the song a skip started)", SONGS.map((p) => r1[p] && r1[p].skipped));
  SHOWN = HX;
  // D2 — the device folded up to the save point, then folds from it: the seeded fold has no row for B.
  const H2 = historyCtx().History;
  H2.ingest(PREFIX, undefined, { src: "refresh" });
  const before = byPi(H2)["$sB"];
  const seed = SD.buildSeed(PREFIX);
  ok(before && before.cutShortBy === undefined && H2.count() === 2, "D PREMISE — before the save point, History holds A and B, B still playing (no mark)", H2.recent().map((r) => [r.pi, r.cutShortBy]));
  H2.ingest(AFTER, seed, { src: "refresh" });
  const r2 = byPi(H2);
  ok(H2.count() === 5 && r2["$sB"] && r2["$sB"].cutShortBy === "media",
    "D: FROM A SAVE POINT, THE SAVE POINT'S SONG IS MARKED ON THE ROW HISTORY ALREADY HELD (B \"media\")", marks(H2.recent()));
  ok(same(marks(SONGS.map((p) => r2[p])), want(SONGS)), "D: AND EVERY OTHER ROW AS ONE FOLD MARKS IT", marks(SONGS.map((p) => r2[p])));
  // D3 — a rewrite whose fold cannot see the ending (it ends at the save point) keeps the mark.
  const pre = SD.derive(PREFIX);
  ok((pre.history || []).some((r) => r.pi === "$sB") && !Object.prototype.hasOwnProperty.call(pre.cutShortBy || {}, "$sB"),
    "D PREMISE — the rewrite's fold produces B's row and does not see B end", { rows: (pre.history || []).map((r) => r.pi), rec: pre.cutShortBy });
  H2.ingest(PREFIX, undefined, { src: "refresh" });
  ok(byPi(H2)["$sB"] && byPi(H2)["$sB"].cutShortBy === "media", "D: A REWRITE THAT CANNOT SEE THE ENDING KEEPS THE MARK (final is final, as the tallies)", marks(H2.recent()));
  // D4 — verify, paging two save points from the room's start: B is on air at the first and ends in the second stretch.
  const H4 = historyCtx().History;
  const L1 = PREFIX[PREFIX.length - 1].l, L2 = LOG[LOG.length - 1].l;
  const seed2 = SD.buildSeed(LOG);
  H4.attach({ pageRange: async (lo, hi) => LOG.filter((e) => e.l >= lo && e.l <= hi) });
  const v = await H4.verifyIncremental([{ h: "f1", l: L1, seed: seed, prevNull: true }, { h: "f2", l: L2, seed: seed2 }]);
  const r4 = byPi(H4);
  ok(v && v.ok && v.verified === 2 && H4.count() === 5, "D PREMISE — verify read both stretches and holds the five songs", { v, n: H4.count() });
  ok(same(marks(SONGS.map((p) => r4[p])), want(SONGS)), "D: VERIFY MARKS EVERY ROW, B FROM THE STRETCH AFTER ITS SAVE POINT", marks(SONGS.map((p) => r4[p])));
  // D5 — the floor-anchored truth (the audit's, and verifyFrom's).
  const tr = H4.deriveAnchored(LOG, [{ l: L1, seed: seed }, { l: L2, seed: seed2 }]).rows;
  ok(tr.length === 5, "D PREMISE — the floor-anchored truth holds the five songs", tr.map((r) => r.pi));
  ok(same(marks(SONGS.map((p) => tr.find((r) => r.pi === p))), want(SONGS)), "D: THE FLOOR-ANCHORED TRUTH MARKS B ACROSS ITS SAVE POINT", marks(tr));
  // D6 — a race at one position, after a save point taken while A plays: a plain advance and a skip both name A. Heard the
  // skip first; then the play, which the room's order folds first (ids compared by code unit: "$a…" before "$z…"), so the skip
  // is refused and A ran out. The folds from the save point have no row for A: the correction lands on the row History HELD,
  // which is the case where a held mark and a fresh one disagree.
  const race = []; let l = 0;
  race.push(E("$join", ++l, 1000, DJ, R.player, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" }));
  race.push(E("$dec1", ++l, 1000, DJ, R.player, { t: "ddjp.dj.declare", v: "BBBBBBBBBBB" }));
  race.push(E("$pA", ++l, 100000, DJ, R.player, { t: "ddjp.dj.play", p: null }));
  const rseed = SD.buildSeed(race);
  const skip = E("$zSkip", ++l, 200000, OWN, R.owner, { t: "ddjp.dj.skip", p: "$pA" });
  const play = E("$aPlay", l, 200000, DJ, R.player, { t: "ddjp.dj.play", p: "$pA" });
  const H6 = historyCtx().History;
  H6.ingest(race, undefined, { src: "refresh" });
  H6.ingest([skip], rseed, { src: "refresh" });
  const first = byPi(H6)["$pA"];
  const s1 = SD.derive([skip], rseed), s2 = SD.derive([play, skip], rseed);
  ok(s1.nowPlaying && s1.nowPlaying.pi === "$zSkip" && s2.nowPlaying && s2.nowPlaying.pi === "$aPlay"
    && !(s1.history || []).concat(s2.history || []).some((r) => r.pi === "$pA"),
    "D PREMISE — from the save point, heard alone the skip ends A; with the play, the room's order makes the play end it; neither fold has a row for A",
    [s1.nowPlaying && s1.nowPlaying.pi, s2.nowPlaying && s2.nowPlaying.pi]);
  H6.ingest([skip, play], rseed, { src: "refresh" });
  const then = byPi(H6)["$pA"];
  ok(first && first.cutShortBy === "dj" && then && then.cutShortBy === false,
    "D: A LATER FOLD THAT SETTLES THE RACE THE OTHER WAY CORRECTS THE MARK HISTORY HELD (A \"dj\", then not cut short)", [first && first.cutShortBy, then && then.cutShortBy]);
  // D7 — the cache rebuild (the open's), through the same two save points.
  const H7 = historyCtx().History;
  const rb = H7.rebuildAnchored(LOG, [{ h: "f1", l: L1, seed: seed, prevNull: true }, { h: "f2", l: L2, seed: seed2 }]);
  ok(rb && rb.segments >= 2 && H7.count() === 5, "D PREMISE — the cache rebuild folded both stretches and holds the five songs", { rb, n: H7.count() });
  ok(same(marks(SONGS.map((p) => byPi(H7)[p])), want(SONGS)), "D: THE CACHE REBUILD MARKS EVERY ROW, B FROM THE STRETCH AFTER ITS SAVE POINT",
    marks(SONGS.map((p) => byPi(H7)[p])));
});

// ═══ PART E — the real History tab ═══════════════════════════════════════════════════════════════════════════════════════
await part("E", () => {
  const H = SHOWN && SHOWN.History;
  ok(!!H, "E PREMISE — PART D's History is here to show");
  if (!H) return;
  const NOW = 1.9e12;
  const LEVEL = { [DJ]: 20, [OWN]: 99, [BOT]: 99 };
  const features = {
    Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "staff", level: 60 }, { name: "vip", level: 40 }, { name: "player", level: 20 }, { name: "guest", level: 10 }],
            getMyId: () => "@me:hs", getRoster: () => Object.keys(LEVEL).map((u) => ({ userId: u, level: LEVEL[u] })), recentEvents: () => ({ rows: [] }), FEED_KINDS: {} },
    Queue: { getNowPlaying: () => null, getRotation: () => [], lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
             recentHistory: (n) => H.recent(n), historyReach: () => H.coverage(), getState: () => ({ counts: {} }) },
    UserQueue: { items: () => [], count: () => 0, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
    Reactions: { hasSaved: () => false, hasVoted: () => false },
    Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible: () => {} },
    ChatPrefs: { layout: () => "wide", setLayout: () => {}, videoHidden: () => false, overlayBlocked: () => false },
    Playlists: { list: () => [], get: (id) => Promise.resolve({ id, name: "Mine", tracks: [] }) },
    ServerClock: { serverNow: () => NOW },
    Store: { meta: { peek: (v) => ({ title: "Title " + v, durationSec: 200 }) } },
  };
  const w = S.world({ features, domShaped: true });
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  w.refs.tabHistory.click();
  const rows = Array.from(w.refs.queueBody.querySelectorAll(".song-row"));
  const order = SONGS.slice().reverse();
  ok(rows.length === 5 && rows.map((r) => r.dataset.vid).join() === order.map((p) => VIDS[SONGS.indexOf(p)]).join(),
    "E PREMISE — the History tab draws the five songs, newest first", rows.map((r) => r.dataset && r.dataset.vid));
  const word = (r) => { const s = r.querySelectorAll(".hist-skip"); return s.length ? Array.from(s).map((x) => x.textContent).join("+") : null; };
  const got = rows.map(word), exp = order.map((p) => WORDS[p]);
  ok(got[order.indexOf("$pA")] === "skipped", "E: A PERSON'S SKIP SHOWS \"skipped\" ON THE SONG IT CUT SHORT (A)", got);
  ok(got[order.indexOf("$sB")] === "Sys Skip", "E: THE ROOM'S SKIP SHOWS \"Sys Skip\" (B)", got);
  ok(got[order.indexOf("$pD")] === "skipped", "E: THE BOT'S REPEAT SKIP SHOWS \"skipped\" (D)", got);
  ok(got[order.indexOf("$sE")] === "skipped", "E: THE LAST SONG BEFORE AN EMPTY ROOM SHOWS \"skipped\" (E)", got);
  ok(got[order.indexOf("$mC")] === null, "E: A SONG THAT RAN OUT SHOWS NO MARK (C)", got);
  ok(same(got, exp), "E: EVERY ROW SHOWS EXACTLY ITS OWN WORD", { got, exp });
  const sub = (r) => { const s = r.querySelector(".sr-sub"); return s ? s.textContent : ""; };
  // CHANGED ON PURPOSE (`ddjp_667`): a row with no word is checked for both words — `/kipped/` alone no longer matches "Sys Skip".
  ok(rows.every((r, i) => (exp[i] === null) ? !/kipped|Sys Skip/.test(sub(r)) : sub(r).indexOf(" · " + exp[i]) >= 0),
    "E: THE SUB LINE READS THE WORD AFTER THE AGE, as before", rows.map(sub));
  // HISTORY'S RECORD (J130) STATES THE WORDS AS DISPLAYED, so a change of word redraws.
  const rec = JSON.parse(w.sb.Panels.historyRecord())[1] || [];
  const recWord = (row) => (row.indexOf("Sys Skip") >= 0 ? "Sys Skip" : (row.indexOf("skipped") >= 0 ? "skipped" : null));
  ok(rec.length === 5 && same(rec.map(recWord), exp), "E: HISTORY'S RECORD STATES EACH ROW'S WORD AS DISPLAYED", rec);
  const was = w.sb.Panels.historyRecord();
  H._setForTest(H.recent().reverse().map((r) => (r.pi === "$sB" ? Object.assign({}, r, { cutShortBy: "dj" }) : r)));
  ok(w.sb.Panels.historyRecord() !== was, "E: AND IT MOVES WHEN A ROW'S WORD DOES (B \"Sys Skip\" → \"skipped\")");
});

if (failed) { console.log("[history-skip] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[history-skip] PASS — History marks the song a skip cut short, and says which kind (J131's correction; " + asserts +
  " assertions): the real fold records by play how each song it saw end was ended — \"dj\" for a person's or the bot's skip, the repeat skip " +
  "included, \"media\" for the room's skip of a song that could not play, not cut short for one that ran out — on the song the skip ENDED, " +
  "the last song before an empty room included, and from a save point for the save point's own song. The record is in no save point " +
  "(two rooms differing only in how a song ended seal the same seed) and bounded as history is; every arrival order gives the same " +
  "record, through the door and through History. History writes it onto the row on every path (a fold, from a save point, verify, " +
  "the floor-anchored truth), keeps it through a rewrite that cannot see the ending, and corrects it when a race settles the other " +
  "way. The History tab shows \"skipped\" and \"Sys Skip\" in `.hist-skip`, nothing on a song that ran out, and its record states the words.");
})();
