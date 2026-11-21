#!/usr/bin/env node
// tests/check-history-ending.js
// SUBJECT: backends/backend1/history.js
//
// WALL: WHEN EACH SONG ENDED, WORKED OUT IN SONG HISTORY — NEVER BY THE FOLD (`ddjp_736`; the owner's words 5 in `main/01-project.md`
// item 7, "its modular and downstream of the machinery, no affect on room state, just histroy", and his decision on the agreed
// length, "lets drop it yes": a summary row carries a song's start and its end, and the fold is untouched;
// `consensus/history-rules.md` §12). A play ends at the advance the fold ACCEPTED that names it as the song it ends (`p`) — the
// advance lock lets exactly one through — so a row's `endedAt` is that event's server stamp, read by `History` from the events a
// fold was given and the fold's own verdict on them. Driven on the real `History` and `StateDeriver`:
//   E1  ONE ROOM, FOLDED FROM ITS START: a song ended by the next play ends at that play's stamp; a song whose ending empties the
//       room ends at that advance's stamp (no next row to read it from); a song ended by a skip ends at the skip's; an advance the
//       fold REFUSED that names a song ends nothing; the song playing has no end.
//   E2  ACROSS A SAVE POINT, IN EITHER ORDER: the save point's song — its row from the stretch below, its end seen by the fold
//       above, which has no row for it — gets its end whether the stretch below is read first (the row held when the end is seen)
//       or last (the end seen first, a newest-first open's order); the table equals the room read from its start.
//   E3  KEPT THROUGH A REWRITE: a later fold that sees the song still playing (the stretch below read again) rewrites its row and
//       leaves its end — in the visit that saw the end, and in a table restored from storage; the floor-anchored derivation
//       (verify's truth) carries the same ends.
//   E4  NEVER GUESSED: an end no fold this device ran has seen is left empty — not the next row's start.
//   E5  THE FOLD IS UNTOUCHED (CONTROL): the reducer's state carries no end of its own — its keys are `ddjp_735`'s — and the seed's.
// RED FIRST ON `ddjp_735`: no row carries `endedAt` (E1–E4); E5 holds on both (it is the control the owner's decision asks for).
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-ending] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 700) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-ending] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

const FILES = ["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"];
const MIN = 60000, T0 = 1700000000000;
const ts = (l) => T0 + l * 4 * MIN;
function world() {
  const sb = loadInContext(FILES, {});
  sb.History.attach({ log: () => [], seed: () => undefined, settled: () => true });
  return sb;
}
// THE ROOM: two DJs with one song each; A's plays, B's plays (A's ended by the next play), a REFUSED play naming A's song (the
// lock: B's is on air), B's ended by a play that empties the room (nobody has a song), C joins, C's plays, C's skipped by the
// owner, D's plays and is on air.
function roomEvents(sb) {
  const SD = sb.StateDeriver, OWN = sb.Ranks.levelOf("owner"), PL = sb.Ranks.levelOf("player");
  const ev = (id, l, sender, rank, body) => ({ eventId: id, type: body.t, content: body, l, ts: ts(l), sender, senderRank: rank, roomId: "!r:hs" });
  return [
    ev("$set", 1, "@o:hs", OWN, { t: "ddjp.room.settings", s: SD.defaultSettings() }),
    ev("$ja", 2, "@a:hs", PL, { t: "ddjp.dj.join", v: "yt:AAAAAAAAAAA" }),
    ev("$jb", 3, "@b:hs", PL, { t: "ddjp.dj.join", v: "yt:BBBBBBBBBBB" }),
    ev("$pA", 4, "@a:hs", PL, { t: "ddjp.dj.play", p: null }),
    ev("$pB", 5, "@a:hs", PL, { t: "ddjp.dj.play", p: "$pA" }),          // ends A's; B's starts
    ev("$no", 6, "@a:hs", PL, { t: "ddjp.dj.play", p: "$pA" }),          // REFUSED: names A's, but B's is on air
    ev("$e0", 7, "@b:hs", PL, { t: "ddjp.dj.play", p: "$pB" }),          // ends B's; nobody has a song: the room empties
    ev("$jc", 8, "@c:hs", PL, { t: "ddjp.dj.join", v: "yt:CCCCCCCCCCC" }),
    ev("$jd", 9, "@d:hs", PL, { t: "ddjp.dj.join", v: "yt:DDDDDDDDDDD" }),
    ev("$pC", 10, "@c:hs", PL, { t: "ddjp.dj.play", p: null }),           // the room's next song names no parent
    ev("$sk", 11, "@o:hs", OWN, { t: "ddjp.dj.skip", p: "$pC" }),         // the owner skips C's; D's starts
  ];
}
const rowsOf = (sb) => sb.History.recent(50).slice().sort((a, b) => a.l - b.l).map((r) => [r.pi, r.endedAt === undefined ? null : r.endedAt]);
const J = (x) => JSON.stringify(x);

(async () => {
  const sb0 = world();
  const E = roomEvents(sb0);
  const both = sb0.StateDeriver.deriveBoth(E);
  const acc = new Set(both.accepted);
  const hist = (both.state.history || []).map((h) => h.pi);
  ok(J(hist) === J(["$pA", "$pB", "$pC", "$sk"]) && !acc.has("$no") && acc.has("$e0") && acc.has("$sk") && both.state.nowPlaying && both.state.nowPlaying.pi === "$sk",
    "PREMISE — the room as the fold reads it: four songs; the play naming A's song while B's is on air REFUSED; the emptying play and the skip accepted; D's on air",
    { hist, refused: !acc.has("$no"), np: both.state.nowPlaying && both.state.nowPlaying.pi });
  const WANT = [["$pA", ts(5)], ["$pB", ts(7)], ["$pC", ts(11)], ["$sk", null]];

  // ── E1 ──
  const a = world();
  a.History.ingest(roomEvents(a), undefined, { src: "fold" });
  const r1 = rowsOf(a);
  ok(J(r1) === J(WANT),
    "E1: EACH SONG'S END IS THE ADVANCE THE FOLD ACCEPTED THAT NAMES IT — A's at the next play, B's at the play that emptied the room, C's at the owner's skip; " +
    "the refused play naming A's ends nothing; D's, playing, has none", { got: r1, want: WANT });
  ok(r1.length && r1[0][1] !== ts(6), "E1: THE REFUSED ADVANCE IS NOT A's END (it names A's song, at a later stamp)", r1[0]);

  // ── E2 ──
  const cut = 5;   // a save point at l=5: A's song ended there, B's is on air — the save point's song
  const seedAt = (sb, l) => sb.StateDeriver.buildSeed(roomEvents(sb).filter((e) => e.l <= l), null);
  const below = (sb) => roomEvents(sb).filter((e) => e.l <= cut), above = (sb) => roomEvents(sb).filter((e) => e.l > cut);
  const b = world();
  b.History.ingest(below(b), undefined, { src: "fold" });
  const midB = rowsOf(b);
  b.History.ingest(above(b), seedAt(b, cut), { src: "fold" });
  ok(J(midB) === J([["$pA", ts(5)], ["$pB", null]]) && J(rowsOf(b)) === J(WANT),
    "E2: THE STRETCH BELOW FIRST — B's row held, still playing; the fold above, from the save point, sees it end and has no row for it: the held row gets its end", { mid: midB, got: rowsOf(b) });
  const c = world();
  c.History.ingest(above(c), seedAt(c, cut), { src: "fold" });
  const midC = rowsOf(c);
  c.History.ingest(below(c), undefined, { src: "fold" });
  ok(midC.every((r) => r[0] !== "$pB") && J(rowsOf(c)) === J(WANT),
    "E2: THE STRETCH ABOVE FIRST (a newest-first open) — B's end seen before its row exists; the row, when the stretch below brings it, takes it", { mid: midC, got: rowsOf(c) });

  // ── E3 ──
  b.History.ingest(below(b), undefined, { src: "fold" });   // the stretch below again: B's still playing there, its row rewritten
  ok(J(rowsOf(b)) === J(WANT), "E3: KEPT THROUGH A REWRITE — a later fold that sees B's still playing rewrites its row and leaves its end", rowsOf(b));
  // A TABLE RESTORED FROM STORAGE (no fold seen this session): its ends kept through the same rewrite.
  const st = world();
  st.History.restore(JSON.parse(JSON.stringify(b.History.snapshot())));
  st.History.ingest(below(st), undefined, { src: "fold" });
  ok(J(rowsOf(st)) === J(WANT), "E3: AND A TABLE RESTORED FROM STORAGE KEEPS THEM THROUGH THE SAME REWRITE — the end it held, with no fold of this visit having seen it", rowsOf(st));
  const d = world();
  const anch = [{ l: cut, seed: seedAt(d, cut) }];
  const truth = d.History.deriveAnchored(roomEvents(d), anch).rows.slice().sort((x, y) => x.l - y.l).map((r) => [r.pi, r.endedAt === undefined ? null : r.endedAt]);
  ok(J(truth) === J(WANT), "E3: THE FLOOR-ANCHORED DERIVATION (verify's truth) CARRIES THE SAME ENDS — across the save point", truth);
  const v = d.History.verifyFrom(roomEvents(d), anch);
  ok(v && v.ok && J(rowsOf(d)) === J(WANT), "E3: and verify writes them onto the table", { v, got: rowsOf(d) });

  // ── E4 ──
  const e = world();
  e.History.ingest(roomEvents(e).filter((x) => x.l <= 4), undefined, { src: "fold" });   // A's row, playing
  e.History.ingest(roomEvents(e).filter((x) => x.l > 9), seedAt(e, 9), { src: "fold" });   // a later stretch: C's and D's, never A's end
  const r4 = rowsOf(e);
  ok(J(r4) === J([["$pA", null], ["$pC", ts(11)], ["$sk", null]]),
    "E4: AN END NO FOLD SAW IS LEFT EMPTY — A's has no end here, not the next row's start (the stretch that ended it was never read)", r4);

  // ── E5 (CONTROL) ──
  const keys = Object.keys(both.state).sort();
  ok(J(keys) === J(["advance", "counts", "cutShortBy", "endedBy", "history", "nowPlaying", "rotation", "settings"]),
    "E5 CONTROL — THE FOLD IS UNTOUCHED: its state carries no end of its own; its keys are `ddjp_735`'s", keys);
  const seed = sb0.StateDeriver.buildSeed(E, null);
  ok(seed && !("endedAt" in seed) && !("lenSec" in seed) && (both.state.history || []).every((h) => !("endedAt" in h)),
    "E5 CONTROL — and neither the seed nor the fold's own history rows carry one", Object.keys(seed || {}));

  _finished = true;
  if (failed) { console.log("[history-ending] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-ending] PASS — when each song ended is worked out in song history, never by the fold (`ddjp_736`; " + asserts +
    " assertions): the stamp of the advance the fold accepted that names the song — the next play, a play that emptied the room, a " +
    "skip — and never a refused one; the song playing has none; across a save point in either order (the row first, or the end first); " +
    "kept through a rewrite; the floor-anchored truth and verify carry the same; an end no fold saw left empty, never guessed; and the " +
    "fold's state and seed carry no end of their own (control).");
})();
