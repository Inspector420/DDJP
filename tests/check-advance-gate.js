// tests/check-advance-gate.js
// WALL: WHEN A SONG MAY MOVE ON. This is the grief-proofing core — the rule that stops
// anyone ending anyone's song a second in by relabelling a skip as a play.
//
// An AUTOMATIC advance (a plain play, or an availability media.skip) is rejected unless its
// committed server stamp clears BOTH floors:
//   • minGate — the absolute floor, so even a 3-second song waits for the ordered cascade;
//   • agreed length − grace — once a well-supported length has been folded.
// Judged entirely on committed stamps (ev.ts, startedAt) and folded numbers, so every client
// reaches the same verdict whenever it replays — delivery lag and clock drift cannot move it.
//
// A MANUAL skip (ddjp.dj.skip) WAIVES the floor: a named person with rank ending a song early
// is the feature, gated by rank, not a grief. The waiver keys on the event TYPE, so a
// mislabelled play can never claim it.
//
// THE LENGTH RULE: highest rank that spoke wins; within one rank the majority value wins; a
// stalemate at a rank cascades down to the next. min and max ALWAYS clamp the result, which is
// what makes a liar harmless in both directions — no claim can push past the room's own bounds.

const assert = require("assert");
const { loadInContext } = require("./_load");

const c = loadInContext([
  "backends/backend1/ranks.js",
  "backends/backend1/statederiver.js",
], {});
const { StateDeriver, Ranks } = c;

const OWNER = Ranks.levelOf("owner"), VIP = Ranks.levelOf("vip"),
      PLAYER = Ranks.levelOf("player"), UNCAT = Ranks.levelOf("uncategorized");

// production-shaped event: eventId (camelCase), parsed content, server ts
function ev(id, l, sender, rank, content) {
  return { eventId: id, l: l, sender: sender, senderRank: rank,
           type: content.t, content: content, ts: l * 1000, roomId: "!r:hs" };
}
// a DJ with two songs so the rotation never empties, then a genesis play at ts = 5000ms.
function base(startTs) {
  return [
    ev("$j", 1, "@a:hs", PLAYER, { t: "ddjp.dj.join", v: "S1" }),
    ev("$d", 2, "@a:hs", PLAYER, { t: "ddjp.dj.declare", v: "S1b" }),
    { eventId: "$p", l: 5, sender: "@a:hs", senderRank: PLAYER,
      type: "ddjp.dj.play", content: { t: "ddjp.dj.play", p: null }, ts: startTs, roomId: "!r:hs" },
  ];
}
const livePi = "$p";
// an advance (play) at a chosen server stamp
function advanceAt(ts, sender, rank) {
  return { eventId: "$adv", l: 6, sender: sender || "@a:hs", senderRank: rank == null ? PLAYER : rank,
    type: "ddjp.dj.play", content: { t: "ddjp.dj.play", p: livePi }, ts: ts, roomId: "!r:hs" };
}
function len(sender, rank, sec, id) {
  return ev(id || ("$l_" + sender), 5, sender, rank, { t: "ddjp.play.len", pi: livePi, sec: sec });
}
function advanced(st) { return st.nowPlaying && st.nowPlaying.pi !== livePi; }

// ── (a) the minGate floor: an advance before started+minGate is rejected ─────────
(() => {
  const started = 100000;   // arbitrary shared server stamp
  const log = base(started);
  // minGate defaults to 8000ms. An advance 3s later is too early.
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 3000)]))),
    "an advance before the minGate floor is rejected");
  // an advance past the floor (no length declared) is accepted
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 9000)]))),
    "past the minGate floor, with no length, the advance is accepted");
})();

// ── (b) the length gate: a well-supported length extends the floor ───────────────
(() => {
  const started = 100000;
  // VIP declares 60s. Gate = started + 60000 − grace(1000) = started + 59000.
  const log = base(started).concat([len("@v:hs", VIP, 60)]);
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 30000)]))),
    "an advance before (length − grace) is rejected once a length is agreed");
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 59500)]))),
    "an advance past (length − grace) is accepted");
})();

// ── (c) the length rule: high rank wins, majority within rank, stalemate cascades ──
(() => {
  const started = 100000;
  // a lone low-rank claim of an enormous length is CLAMPED to maxLen (default 600s), not honoured
  // literally — the clamp is the defence, so a liar can never push past the room's own ceiling.
  const liar = base(started).concat([len("@liar:hs", UNCAT, 999999)]);
  assert.ok(!advanced(StateDeriver.derive(liar.concat([advanceAt(started + 9000)]))),
    "a huge claim still gates (it is clamped, not ignored)");
  assert.ok(advanced(StateDeriver.derive(liar.concat([advanceAt(started + 600000)]))),
    "but only up to maxLen — the clamp bounds any liar in the long direction");

  // HIGH RANK WINS: a VIP's 60s beats two players claiming 600s
  const outranked = base(started).concat([
    len("@x:hs", PLAYER, 600, "$lx"), len("@y:hs", PLAYER, 600, "$ly"), len("@v:hs", VIP, 60, "$lv"),
  ]);
  assert.ok(advanced(StateDeriver.derive(outranked.concat([advanceAt(started + 59500)]))),
    "the highest rank that spoke sets the length, outranking a lower-rank majority");

  // MAJORITY WITHIN RANK: three players, two agree on 60
  const majority = base(started).concat([
    len("@a2:hs", PLAYER, 60, "$m1"), len("@b2:hs", PLAYER, 60, "$m2"), len("@c2:hs", PLAYER, 600, "$m3"),
  ]);
  assert.ok(advanced(StateDeriver.derive(majority.concat([advanceAt(started + 59500)]))),
    "within one rank the majority value wins");

  // STALEMATE CASCADES DOWN: two VIPs tie, so the next rank down decides
  const stale = base(started).concat([
    len("@v1:hs", VIP, 600, "$s1"), len("@v2:hs", VIP, 30, "$s2"), len("@p1:hs", PLAYER, 60, "$s3"),
  ]);
  assert.ok(advanced(StateDeriver.derive(stale.concat([advanceAt(started + 59500)]))),
    "a tie at the top rank is unresolved and cascades down to the next rank");
})();

// ── (d) min and max always clamp the agreed length ──────────────────────────────
(() => {
  const started = 100000;
  // set maxLen to 300s, then VIP claims 999s. Gate is capped at 300 − grace.
  const settingsEv = ev("$s", 3, "@o:hs", OWNER, { t: "ddjp.room.settings", s: { maxLen: 300 } });
  const log = [settingsEv].concat(base(started)).concat([len("@v:hs", VIP, 999)]);
  // just past 300 − grace should be accepted (the cap, not 999, governs)
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 300000)]))),
    "the gate is capped at maxLen — a claim beyond the ceiling cannot extend it");
})();

// ── (e) manual skip waives the floor; availability skip does not ─────────────────
(() => {
  const started = 100000;
  const log = base(started);
  // a manual ddjp.dj.skip 1s in, from a VIP (may skip others), advances despite the floor
  const manual = { eventId: "$sk", l: 6, sender: "@v:hs", senderRank: VIP,
    type: "ddjp.dj.skip", content: { t: "ddjp.dj.skip", p: livePi }, ts: started + 1000, roomId: "!r:hs" };
  assert.ok(advanced(StateDeriver.derive(log.concat([manual]))),
    "a manual skip by an authorised rank waives the floor (authority IS the justification)");
  // a mislabelled play cannot claim the waiver — it is still floored
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 1000, "@v:hs", VIP)]))),
    "a play (even from a VIP) is NOT a manual skip and stays floored");
})();

// ── (f) a declaration only counts if it sorts BEFORE the advance ────────────────
// This case used to reorder the ADVANCE to the front of the log and assert both runs agreed.
// They did — but for different reasons: the front-loaded advance was rejected by the advance
// LOCK (nothing playing yet), not by the gate, so the test passed while a late declaration
// could still re-judge a settled advance. It also fed derive an unsorted log, which is a
// contract violation (ordering is StreamManager.orderEvents' job). Move the DECLARATION
// instead — that is the property that actually needed proving.
(() => {
  const started = 100000;
  const before = base(started).concat([len("@v:hs", VIP, 600), advanceAt(started + 30000)]);
  assert.ok(!advanced(StateDeriver.derive(before)),
    "a declaration that sorts BEFORE the advance gates it");

  // the same declaration, moved after the advance: it must have no effect on that advance.
  const after = base(started).concat([advanceAt(started + 30000)]).concat([
    { eventId: "$l_late", l: 9, sender: "@v:hs", senderRank: VIP, type: "ddjp.play.len",
      content: { t: "ddjp.play.len", pi: livePi, sec: 600 }, ts: started + 90000, roomId: "!r:hs" },
  ]);
  const noDecl = base(started).concat([advanceAt(started + 30000)]);
  assert.strictEqual(advanced(StateDeriver.derive(after)), advanced(StateDeriver.derive(noDecl)),
    "a declaration that sorts AFTER an advance cannot change that advance's verdict — the gate " +
    "reads the prefix, so history stays append-only and a rank-zero message cannot rewrite it");
  assert.ok(advanced(StateDeriver.derive(after)),
    "and the advance stands: 30s clears the 8s floor, with no length in force at its position");
})();

console.log("[advance-gate] PASS — an automatic advance clears BOTH the minGate floor and the agreed " +
  "length (highest rank wins, majority within a rank, a stalemate cascades down, min/max always " +
  "clamp so no claim can push past the room's own bounds); a manual skip waives the floor by rank " +
  "while a mislabelled play cannot; and only a declaration that sorts BEFORE an advance can gate " +
  "it, so a late one cannot re-judge a settled verdict");
