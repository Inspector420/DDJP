// tests/check-declarations.js
// SUBJECT: backends/backend1/statederiver.js
// WALL: THE PREFIX RULE. A declaration may only influence events that sort AFTER it, and its
// legality is judged once, at its own fold position, from the state as of then.
//
// This guard exists because 69 guards passed while a rank-zero account could rewrite settled
// history. Nothing in the corpus put a ddjp.play.len or ddjp.play.blocked into a shuffled or
// seeded scenario, so the entire class was invisible. The five sections below are that class:
//
//   (a) RETROACTIVE — a declaration arriving after the advance it describes must not change
//       that advance's verdict. This is the one that was live.
//   (b) LEGALITY — judged at fold position: live pi, well-formed, first from that sender.
//       Junk while nothing plays is NOT protectable; a declaration about a song that has since
//       finished IS, because every genesis replay re-judges the advance it governed.
//   (c) ANTI-FLOOD — five declarations from one person count as one, four are unprotected.
//   (d) CONVERGENCE — declarations converge across arrival orders, at corpus scale.
//   (e) SEEDED EQUIVALENCE — derive(seed@N, after) === derive(genesis) when the seal lands
//       MID-SONG with declarations already folded. Without the seed's liveDecl section the
//       forget path silently accepts an advance the genesis path rejects.
//   (f) PROTECTION BY REASON (J153) — a blocked report with either of the room's reasons is
//       PROTECTED (vouch-eligible) exactly as a length report is, and one the room refuses — no
//       reason, a second from one person, a finished song — is not. Reports now decide more (the
//       owner's room rule, J153), so what keeps them is pinned against the real `Vouch.eligible`.
//
// CHANGED AT J153 (`ddjp_720`), AND WHY: `blk` built its reports with NO reason, which the room
// now refuses (`no-block-reason`, the owner's decision 2), so (c)'s "same for blocked reports" read
// zero. The fixture carries a reason now, read from the reducer's own list (never spelled); every
// assertion is unchanged, and (f) adds the rows the reason makes possible.

const assert = require("assert");
const { loadInContext } = require("./_load");

const c = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js", "core/playlistdoc.js", "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/checkpoint.js", "backends/backend1/continuity.js", "backends/backend1/history.js", "backends/backend1/settingsproof.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js",
], { Date });
const { StateDeriver, Ranks } = c;

const VIP = Ranks.levelOf("vip"),
      PLAYER = Ranks.levelOf("player"), GUEST = Ranks.levelOf("guest"),
      UNCAT = Ranks.levelOf("uncategorized");

function ev(id, l, ts, sender, rank, body) {
  return { eventId: id, l: l, ts: ts, sender: sender, senderRank: rank,
           type: body.t, content: body, roomId: "!r:hs" };
}
const pi = (st) => (st.nowPlaying ? st.nowPlaying.pi : null);
// Key-order-independent compare of everything a seeded fold must reproduce. `history` is
// deliberately excluded: it is a recomputed DISPLAY window that a checkpoint restarts empty
// by design (checkpoint-contents.md 2), not a carry-forward accumulator.
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
const forward = (st) => canon({ nowPlaying: st.nowPlaying, rotation: st.rotation,
                                settings: st.settings, counts: st.counts, advance: st.advance });
const acc = (log, seed) => Array.from(StateDeriver.deriveAccepted(log, seed));

// A DJ with two songs, a genesis play at ts=100000, then an advance at a chosen stamp.
function base() {
  return [
    ev("$j", 1, 1000, "@a:hs", PLAYER, { t: "ddjp.dj.join", v: "yt:S1_________" }),
    ev("$d", 2, 1000, "@a:hs", PLAYER, { t: "ddjp.dj.declare", v: "yt:S2_________" }),
    ev("$p", 3, 100000, "@a:hs", PLAYER, { t: "ddjp.dj.play", p: null }),
  ];
}
const adv = (l, ts) => ev("$adv", l, ts, "@a:hs", PLAYER, { t: "ddjp.dj.play", p: "$p" });
const len = (id, l, ts, who, rank, sec) => ev(id, l, ts, who, rank, { t: "ddjp.play.len", pi: "$p", sec: sec });
// A REASON THE ROOM COUNTS, read from its one home (J153: a report without one is refused).
const REASONS = Object.keys(StateDeriver.BLOCKED_REASONS || {}).filter((k) => StateDeriver.BLOCKED_REASONS[k].counts);
const blk = (id, l, ts, who, rank, k) => ev(id, l, ts, who, rank,
  Object.assign({ t: "ddjp.play.blocked", pi: "$p" }, (k === null) ? {} : { k: (k === undefined) ? REASONS[0] : k }));

// ── (a) RETROACTIVE INVALIDATION — the live bug ──────────────────────────────────
(() => {
  const honest = base().concat([adv(4, 300000)]);            // 200s in, no length declared
  assert.strictEqual(pi(StateDeriver.derive(honest)), "$adv",
    "an honest advance past the minGate floor is accepted");

  // the same log plus ONE declaration that sorts AFTER the advance, about the finished song
  const late = honest.concat([
    ev("$lie", 5, 400000, "@evil:hs", UNCAT, { t: "ddjp.play.len", pi: "$p", sec: 600 }),
  ]);
  assert.strictEqual(pi(StateDeriver.derive(late)), "$adv",
    "a declaration arriving AFTER the advance it describes must not change that advance's " +
    "verdict — the gate reads the PREFIX, never the whole log");

  // and the two clients agree, which is the property that actually matters
  assert.strictEqual(pi(StateDeriver.derive(late)), pi(StateDeriver.derive(honest)),
    "a client holding the late declaration derives the same head as one that does not");

  // the late declaration is also not protectable — it named a pi that had already ended
  assert.ok(acc(late).indexOf("$lie") < 0,
    "a declaration about an already-finished playing is REJECTED, so it is never protected");
})();

// ── (b) LEGALITY, judged at fold position ────────────────────────────────────────
(() => {
  // junk while NOTHING is playing is not protectable
  const idle = [
    ev("$j", 1, 1000, "@a:hs", PLAYER, { t: "ddjp.dj.join", v: "yt:S1_________" }),
    ev("$n1", 2, 2000, "@spam:hs", PLAYER, { t: "ddjp.play.len", pi: "$nope", sec: -5 }),
    ev("$n2", 3, 2000, "@spam:hs", PLAYER, { t: "ddjp.play.len" }),
    ev("$n3", 4, 2000, "@spam:hs", PLAYER, { t: "ddjp.play.blocked", pi: "$nope", k: REASONS[0] }),
  ];
  const a = acc(idle);
  for (const id of ["$n1", "$n2", "$n3"]) {
    assert.ok(a.indexOf(id) < 0,
      "a declaration with nothing playing is NOT legal — an open channel cannot mint " +
      "protectable events by declaring into the void (" + id + ")");
  }

  // a well-formed declaration about the LIVE playing is legal
  const live = base().concat([len("$L", 4, 102000, "@v:hs", VIP, 60)]);
  assert.ok(acc(live).indexOf("$L") >= 0, "a live, well-formed declaration is legal");

  // ...and STAYS legal once the song has moved on. This is load-bearing, not a nicety:
  // every genesis replay re-judges the advance using exactly these events.
  const after = live.concat([adv(5, 130000)]);   // 30s in, against a declared 60s
  assert.ok(acc(after).indexOf("$L") >= 0,
    "a declaration stays legal after its song ends — legality is judged ONCE, at fold " +
    "position. Losing it would flip the verdict on the advance it governed.");
  assert.strictEqual(pi(StateDeriver.derive(after)), "$p",
    "and it still gates: with 60s declared, an advance 30s in is inside the length floor");

  // a declaration that sorts BEFORE the play it names is rejected
  const early = [
    ev("$j", 1, 1000, "@a:hs", PLAYER, { t: "ddjp.dj.join", v: "yt:S1_________" }),
    ev("$d", 2, 1000, "@a:hs", PLAYER, { t: "ddjp.dj.declare", v: "yt:S2_________" }),
    len("$pre", 3, 50000, "@v:hs", VIP, 60),
    ev("$p", 4, 100000, "@a:hs", PLAYER, { t: "ddjp.dj.play", p: null }),
  ];
  assert.ok(acc(early).indexOf("$pre") < 0,
    "a declaration sorting BEFORE the play it names is rejected — you cannot measure a song " +
    "before it starts, and allowing it is a pre-seeding vector");

  // a declaration naming a play the reducer REJECTED is not legal: an event id exists,
  // but it never became a play instance.
  const rejectedPlay = base().concat([
    ev("$bad", 4, 101000, "@a:hs", PLAYER, { t: "ddjp.dj.play", p: "$wrong" }),   // stale lock
    ev("$L2", 5, 102000, "@v:hs", VIP, { t: "ddjp.play.len", pi: "$bad", sec: 60 }),
  ]);
  assert.ok(acc(rejectedPlay).indexOf("$L2") < 0,
    "a declaration naming a REJECTED play is not legal — check against plays that actually " +
    "started, not against 'an event with this id exists'");
})();

// ── (c) ANTI-FLOOD — one per person per playing ──────────────────────────────────
(() => {
  const log = base();
  for (let i = 0; i < 5; i++) log.push(len("$L" + i, 4 + i, 102000, "@g:hs", GUEST, 60 + i));
  for (let i = 0; i < 5; i++) log.push(blk("$B" + i, 9 + i, 102000, "@g:hs", GUEST));
  const a = acc(log);
  assert.strictEqual(a.filter((x) => x.indexOf("$L") === 0).length, 1,
    "five length declarations from one person count as ONE; the four extras are rejected " +
    "and therefore unprotected, so spam cannot consume protection");
  assert.strictEqual(a.filter((x) => x.indexOf("$B") === 0).length, 1,
    "same for blocked reports");
  // the one that counted is the FIRST in sorted order, deterministically
  assert.ok(a.indexOf("$L0") >= 0 && a.indexOf("$B0") >= 0,
    "the surviving declaration is the first in (l, event_id) order — not arrival order");
})();

// ── (d) CONVERGENCE with declarations present, at corpus scale ───────────────────
(() => {
  const SCENARIO = base().concat([
    len("$L1", 4, 102000, "@v:hs", VIP, 60),
    len("$L2", 5, 102500, "@x:hs", PLAYER, 300),
    blk("$B1", 6, 103000, "@g1:hs", GUEST),
    blk("$B2", 7, 103100, "@g2:hs", GUEST),
    blk("$B3", 8, 103200, "@g3:hs", GUEST),
    blk("$B4", 9, 103300, "@v2:hs", VIP),
    blk("$B5", 10, 103400, "@v3:hs", VIP),
    adv(11, 400000),
  ]);
  const sort = (a) => a.slice().sort((x, y) => (x.l !== y.l ? x.l - y.l : (x.eventId < y.eventId ? -1 : 1)));
  const canonical = JSON.stringify(StateDeriver.derive(sort(SCENARIO)));
  const canonAcc = acc(sort(SCENARIO)).slice().sort().join(",");

  let runs = 0;
  for (let i = 0; i < 400; i++) {
    const shuffled = SCENARIO.slice();
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      const t = shuffled[k]; shuffled[k] = shuffled[j]; shuffled[j] = t;
    }
    // derive takes an ORDERED log (StreamManager.orderEvents' job); shuffling models
    // arrival order, and the sort is what every client applies before folding.
    assert.strictEqual(JSON.stringify(StateDeriver.derive(sort(shuffled))), canonical,
      "a shuffled arrival order with declarations present produced different state (run " + i + ")");
    assert.strictEqual(acc(sort(shuffled)).slice().sort().join(","), canonAcc,
      "the accepted set also converges across arrival orders (run " + i + ")");
    runs++;
  }
  assert.strictEqual(runs, 400);
})();

// ── (e) SEEDED EQUIVALENCE with a MID-SONG seal ──────────────────────────────────
(() => {
  // The seal lands after a length declaration and before the advance it governs. The genesis
  // fold rejects the advance (too early against 300s); a seeded fold that lost the declaration
  // would accept it. That is a divergence between a client that forgot and one that did not.
  const log = base().concat([
    len("$L", 4, 102000, "@v:hs", VIP, 300),
    adv(5, 350000),                                  // 250s in — inside 300s − grace
  ]);
  const genesis = StateDeriver.derive(log);
  assert.strictEqual(pi(genesis), "$p", "genesis rejects the too-early advance");

  for (let cut = 3; cut <= 4; cut++) {
    const seed = StateDeriver.buildSeed(log.slice(0, cut));
    const seeded = StateDeriver.derive(log.slice(cut), seed);
    assert.strictEqual(forward(seeded), forward(genesis),
      "derive(seed@" + cut + ", after) must equal derive(genesis) with declarations folded " +
      "before the cut — the seed carries the live playing's declarations, or the forget path " +
      "diverges from the full-log path");
  }

  // and the seed section is live-pi ONLY: after the song advances, the old declarations
  // are pruned rather than carried forever.
  const moved = base().concat([
    len("$L", 4, 102000, "@v:hs", VIP, 60),
    adv(5, 400000),                                   // past 60s − grace: accepted
  ]);
  assert.strictEqual(pi(StateDeriver.derive(moved)), "$adv", "the advance clears the length floor");
  const s2 = StateDeriver.buildSeed(moved);
  assert.ok(!s2.liveDecl || s2.liveDecl.pi === "$adv",
    "the seed's declaration section is scoped to the LIVE playing only — off-air declarations " +
    "are dead and must not be sealed (checkpoint-contents.md 1/2)");
  assert.ok(!s2.liveDecl || Object.keys(s2.liveDecl.len).length === 0,
    "and it is empty after an advance, so it is bounded by participants, not by log length");
})();

// ── (f) PROTECTION BY REASON (J153) ──────────────────────────────────────────────────
// Protection is `Vouch.eligible`: legal (the fold accepted it), critical (its type is not on the non-critical list) and not
// mine. Driven against the REAL module with the fold's own accepted set, so a report the room refuses can never be vouched,
// and a report with either reason is vouched like a length report. Adding `ddjp.play.blocked` to `NON_CRITICAL_TYPES` turns
// the "protected" rows red; refusing a reason in the fold turns them red too.
(() => {
  const V = c.Vouch;
  const raw = (e) => ({ event_id: e.eventId, sender: e.sender, senderRank: e.senderRank, l: e.l, ts: e.ts,
                        room_id: e.roomId, type: "m.room.message", content: { body: JSON.stringify(e.content) } });
  const vouched = (log, e) => { const a = new Set(acc(log)); return V.eligible(raw(e), "@me:hs", (id) => a.has(id)); };
  assert.ok(REASONS.length >= 2, "(f) premise: the room has its two reasons to drive, each by name from its own list");
  const L = len("$Lf", 4, 102000, "@g0:hs", GUEST, 60);
  assert.ok(vouched(base().concat([L]), L), "(f) control: a length report on the live song is protected");
  REASONS.forEach((k, i) => {
    const B = blk("$Bf" + i, 4, 102000, "@g" + (i + 1) + ":hs", GUEST, k);
    assert.ok(vouched(base().concat([B]), B),
      "(f) a blocked report with the reason `" + k + "` is PROTECTED exactly as a length report is — reports decide when a " +
      "song may end, so losing one flips a verdict on replay");
  });
  const none = blk("$Bn", 4, 102000, "@gn:hs", GUEST, null);
  assert.ok(!vouched(base().concat([none]), none),
    "(f) a report with NO reason is refused by the room (`no-block-reason`), so it is never protected");
  const first = blk("$B1st", 4, 102000, "@gx:hs", GUEST), second = blk("$B2nd", 5, 102100, "@gx:hs", GUEST, REASONS[1]);
  const two = base().concat([first, second]);
  assert.ok(vouched(two, first) && !vouched(two, second),
    "(f) a second report from one person is refused, so only the first is protected");
  const late = blk("$Blate", 5, 400000, "@gl:hs", GUEST);
  assert.ok(!vouched(base().concat([adv(4, 300000), late]), late),
    "(f) a report about a finished song is refused, so it is never protected");
})();

console.log("[declarations] PASS — declarations influence only what sorts AFTER them (a late " +
  "declaration cannot re-judge a settled advance); legality is decided ONCE at fold position " +
  "(live pi, well-formed, first-per-sender — junk while idle and a declaration naming a rejected " +
  "or not-yet-started play are never protectable, while one about a since-finished song stays " +
  "protected because every genesis replay re-judges the advance it governed); five declarations " +
  "from one person count as one and the extras are unprotected; state and the accepted set both " +
  "converge across 400 shuffled arrival orders with declarations present; and a MID-SONG " +
  "checkpoint reproduces the genesis verdict, with the sealed section scoped to the live playing; and a blocked report " +
  "with either of the room's reasons is protected as a length report is, while one the room refuses (no reason, a second " +
  "from one person, a finished song) is not");
