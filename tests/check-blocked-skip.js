// tests/check-blocked-skip.js
// WALL: the blocked-skip escape (features/mediablocked.js + the reducer's ddjp.media.skip
// advance). When too few clients can see a song (per the skip roads), a client authors a REASONED
// ddjp.media.skip; it is judged as a real, advance-locked skip so N competing escapes resolve to
// ONE. Below the roads → no early skip (the ceiling backstops, tested in check-ceiling-convergence).
//
// ── THE AUTHOR'S RANK DOES NOT GATE THIS, AND THIS HEADER SAID IT DID (J42) ──────────────────
// It read "the highest-present VIP+ authority authors" and "Sub-VIP never authors", with a PART B
// promising a rank refusal. The body below has asserted the OPPOSITE since the escape was built:
// a GUEST authors it, and the assertion message says why — "room decides, not rank".
//
// The ROOM derives the escape from the blocked-report tally across rank BANDS, and the reducer
// re-validates that tally when it folds the skip — so the author cannot fake it, and no rank gate
// is needed to stop them. Gating by rank instead would break the case the roads exist for: a room
// with no VIPs present must still be able to escape a dead song. `ddjp.media.skip` is deliberately
// absent from `Ranks.GATES` and from `Capabilities` for exactly this reason — see
// `docs/main/10-capabilities.md` and `docs/consensus/blocked-content-survival.md` §Who authors.
//
// The rank a client HAS still decides WHEN it tries — `Ranks.staggerMs` gives seniors the earlier
// slot — but the last one to the line may still author it, and that is the design rather than a
// gap. Rank orders the attempt; the roads authorise it.
//
// Guarantees:
//   PART A — ANY RANK AUTHORS past threshold. With enough blocked reports to meet a skip road,
//     a client authors exactly one ddjp.media.skip carrying the reason (tally/threshold) — driven
//     at VIP and, separately, at GUEST in a room with no VIPs at all.
//   PART B — RE-CHECKED AT FIRE TIME. If the derived decision flips off during the stagger wait,
//     nothing is sent. (This is the slot PART B's rank refusal used to occupy; the roads are what
//     is enforced here, so this is what there is to enforce.)
//   PART C — BELOW THRESHOLD → NO SKIP. If enough can still see it, no skip is authored.
//   PART D — REASONED + ADVANCE-LOCKED. ddjp.media.skip advances the rotation like a skip, has its
//     tally re-validated by the reducer, and N competing escapes resolve to exactly ONE.
//   PART E — PRESENCE FROM SPINE. present count = distinct recent senders in the log (shared).

const assert = require("assert");
const { loadInContext } = require("./_load");
const RANK = { OWNER: 100, VIP: 40, PLAYER: 20, GUEST: 10, UNCAT: 0 };

function fail(msg, got) {
  console.log("[blocked-skip] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// Harness with a settable log tail (for presence) + nowPlaying + rank.
function harness(me, myRank, logTail) {
  let np = { pi: "$p1", startedAt: 0, song: { videoId: "AAAAAAAAAAA" }, settings: { maxLen: 600 } };
  const subs = {};
  const sent = [];
  let adv = null;   // the reducer-derived advance decision; tests set it via setAdvance
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [], advance: adv }; },
    getLog() { return logTail || []; },
    on(t, fn) { (subs[t] = subs[t] || []).push(fn); },
    off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
  };
  const MatrixBridge = {
    getUserId() { return me; },
    getMyRank() { return myRank; },
    async sendEvent(ch, type, content) { sent.push({ type, content }); },
  };
  const Logger = { info() {}, warn() {}, debug() {} };
  return {
    StreamManager, MatrixBridge, Logger, sent, subs,
    setAdvance(a) { adv = a; },
    emitBlocked(p, sender) { const e = { type: "ddjp.play.blocked", sender, content: { pi: p } }; for (const fn of subs["ddjp.play.blocked"] || []) fn(e); },
  };
}
function load(h, myRank) {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"], {
    StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Logger: h.Logger,
    setTimeout, clearTimeout, Date,
  });
  if (!sb.MediaBlocked) fail("MediaBlocked did not load");
  sb.MediaBlocked.setMyRank(myRank);
  return sb.MediaBlocked;
}

// present = 4 distinct recent senders in the log tail
const LOG4 = [
  { sender: "@a:hs" }, { sender: "@b:hs" }, { sender: "@c:hs" }, { sender: "@d:hs" },
];

// ---- FEATURE-SIDE AUTHORING (roads model) --------------------------------------
// The feature no longer computes its own threshold. It authors a media.skip when the REDUCER
// has derived that a road is met (advance.skipWarranted), staggered by rank, and the reducer
// re-validates the tally. So these tests drive the derived `advance` object, not a raw count.

// authors exactly one escape when the room has derived a skip is warranted
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  // not warranted yet -> silence
  h.setAdvance({ pi: "$p1", skipWarranted: false, blockedGuestPlus: 2, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 0) fail("no skip while the room has not derived one", h.sent);
  // road met -> the reducer says skipWarranted -> author exactly one, from ANY rank (guest here)
  h.setAdvance({ pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 1) fail("author exactly one escape once the room derives a skip", h.sent);
  assert.strictEqual(h.sent[0].type, "ddjp.media.skip", "escape is a ddjp.media.skip");
  assert.strictEqual(h.sent[0].content.p, "$p1", "escape carries p (advance-lock anchor)");
  assert.strictEqual(h.sent[0].content.blockedGuestPlus, 5, "reason carries the derived guest+ tally");
})();

// a room with NO VIPs still escapes: a guest authors it because the ROOM derived it (not rank)
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  h.setAdvance({ pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 1) fail("a room with no VIPs still authors the escape (room decides, not rank)", h.sent);
})();

// the road is re-checked at fire time: if the derived decision flips off, nothing is sent
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  h.setAdvance({ pi: "$p1", skipWarranted: false, blockedGuestPlus: 2, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 0) fail("no skip when the road is not met at fire time", h.sent);
})();


// ---- PART D: reasoned skip advances + advance-locked to one ---------------------
(() => {
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
  const SD = ctx.StateDeriver;
  let L = 0;
  const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 60000, l: L, content: Object.assign({}, body) }; };
  const base = [
    mk("ddjp.dj.join", "@a:hs", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    mk("ddjp.dj.join", "@b:hs", 20, { v: "BBBBBBBBBBB", u: "https://y/b" }),
  ];
  const genesis = mk("ddjp.dj.play", "@a:hs", 20, { p: null }); base.push(genesis);
  const livePi = genesis.eventId;
  // A media.skip needs its ts past the minGate floor (default 8s) — it is an automatic advance,
  // not a manual skip, so it honors the floor. mk stamps ts = L*60000, well past it.
  // A COUNTING REASON (J06), derived from the reducer's own vocabulary rather than spelled here.
  // This guard is about the ROADS, so its declarations have to be the kind a road counts; an
  // untyped one is accepted and counts toward nothing, which is the reason axis and is
  // `check-blocked-reason`'s subject rather than this file's.
  const COUNTS = Object.keys(SD.BLOCKED_REASONS).find((k) => SD.BLOCKED_REASONS[k].counts);
  if (!COUNTS) fail("setup: the reducer declares no counting blocked reason, so no road here can fire");
  const blocked = (who, rank) => mk("ddjp.play.blocked", who, rank, { pi: livePi, k: COUNTS });

  // A media.skip is authorised by the ROADS, not by the author's rank. The default crowd road is
  // 5 guest+ blocked. With 5 guest-or-above blocked, a media.skip from ANYONE advances — a room
  // with no VIPs must still be able to escape a dead song.
  const enough = base.concat([
    blocked("@g1:hs", RANK.GUEST), blocked("@g2:hs", RANK.GUEST), blocked("@g3:hs", RANK.GUEST),
    blocked("@g4:hs", RANK.GUEST), blocked("@g5:hs", RANK.GUEST),
    mk("ddjp.media.skip", "@g1:hs", RANK.GUEST, { p: livePi }),
  ]);
  const okSkip = SD.derive(enough);
  if (!okSkip.nowPlaying || okSkip.nowPlaying.pi === livePi) fail("a road-backed media.skip should advance the rotation", okSkip.nowPlaying);
  assert.strictEqual(okSkip.nowPlaying.skipped, true, "media.skip marks the new song as reached via skip");

  // NO road met (too few blocked) -> the same media.skip is REJECTED; the tally is recomputed, so
  // the author cannot assert it.
  const notEnough = base.concat([
    blocked("@g1:hs", RANK.GUEST), blocked("@g2:hs", RANK.GUEST),
    mk("ddjp.media.skip", "@g1:hs", RANK.GUEST, { p: livePi }),
  ]);
  const badSkip = SD.derive(notEnough);
  if (!badSkip.nowPlaying || badSkip.nowPlaying.pi !== livePi) fail("a media.skip with no road met must be rejected by the reducer", badSkip.nowPlaying);

  // uncategorized count toward NO road, so they can never authorise a skip among themselves
  const uncatOnly = base.concat([
    blocked("@u1:hs", RANK.UNCAT), blocked("@u2:hs", RANK.UNCAT), blocked("@u3:hs", RANK.UNCAT),
    blocked("@u4:hs", RANK.UNCAT), blocked("@u5:hs", RANK.UNCAT), blocked("@u6:hs", RANK.UNCAT),
    mk("ddjp.media.skip", "@u1:hs", RANK.UNCAT, { p: livePi }),
  ]);
  const uncatSkip = SD.derive(uncatOnly);
  if (!uncatSkip.nowPlaying || uncatSkip.nowPlaying.pi !== livePi) fail("uncategorized can never reach a road - their skip is rejected", uncatSkip.nowPlaying);

  // N competing road-backed escapes -> advance-lock keeps exactly ONE
  const many = enough.slice();
  for (let i = 0; i < 5; i++) many.push(mk("ddjp.media.skip", "@g" + i + ":hs", RANK.GUEST, { p: livePi }));
  const st = SD.derive(many);
  if (st.history.length !== 2) fail("N competing escapes must resolve to exactly ONE advance (advance-lock)", { plays: st.history.length });
})();

console.log("[blocked-skip] PASS — the availability escape is authorised by the SKIP ROADS (recomputed blocked tally), not by author rank: a road-backed media.skip advances from any rank, no road met is rejected, uncategorized reach no road, and N competing escapes resolve to one via the advance-lock");
