// tests/check-counts.js
// SUBJECT: backends/backend1/statederiver.js, backends/backend1/streammanager.js
// BOTH, and the second was missing because this row predates compares-two (`ddjp_366`). The counts
// SEMANTICS below are the reducer's alone. The last bullet is not: `conv()` builds a FRESH client per
// run and ingests the same events in 250 shuffled orders through the REAL `StreamManager`, requiring
// one answer. That goes false if the reducer stops being a pure function of the ordered prefix OR if
// `streammanager.js` stops imposing the order — it owns `orderEvents`, and neutralising arrival order
// is exactly what the shuffles exercise. A reader sent only to the reducer by a broken sort would
// look in the wrong file, which is the forty-third signature's named cost.
// (Decided by reading this file, not by precedent. `check-convergence` declares both modules for the
// same shuffled-pipeline shape and agrees — corroboration, not the grounds.)
// WALL: per-PLAYING vote/save COUNTS + the owner SET-ABSOLUTE adjustment. Pure reducer, so fully
// headless. Proves:
//   - distinct-voter/saver tallies per PLAY INSTANCE, deduped by (instance, user);
//   - two plays count APART, including two plays of the same video — see
//     check-play-instance-identity for why that is the point rather than an implementation
//     detail. This guard used to assert the opposite (a user voting the same SONG across two
//     plays counted once), which is the behaviour that let a returning listener's vote be
//     accepted, protected, and counted for nothing;
//   - `ddjp.count.set { k, id, n }` sets an absolute baseline for the PLAYING it names, organic
//     votes/saves AFTER it add on top, LATEST set wins, and it is OWNER-gated (a forged one is
//     ignored);
//   - every result is identical across shuffled arrival orders (convergence);
//   - a vote, a save or the owner's count change counts only for the playing ON AIR where it lands (740, the owner's:
//     `consensus/consensus-models.md` §Counts + owner adjustment): one on a playing that has ended is refused (part 5).
// RE-LAID AT 740: every reaction below now lands while its playing is on air — the fixtures used to play both songs first and
// react afterwards, which the room now refuses. What each part tests is unchanged; the ended-song case is part 5's.

const { loadInContext } = require("./_load");
const RANK = { OWNER: 100, STAFF: 60, PLAYER: 20 };

function makeClient() {
  return loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"], { Date }).StreamManager;
}
function raw(eventId, l, sender, body, rank) {
  const r = { event_id: eventId, room_id: "!r:hs", type: "m.room.message", sender: sender,
              content: { body: JSON.stringify(Object.assign({ l: l }, body)) }, ts: l * 60000, l: l };
  if (rank !== undefined) r.senderRank = rank;
  return r;
}
const j = (x) => JSON.stringify(x);
let failed = 0;
function fail(m, d) { console.log("[counts] FAIL — " + m + (d ? "\n      " + d : "")); failed++; }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
function countsOf(sm) { return sm.getState().counts || {}; }
function conv(events, label, check) {
  const base = makeClient(); events.forEach((e) => base.ingest(e));
  check(base);
  const canon = j(countsOf(base));
  for (let i = 0; i < 250; i++) {
    const C = makeClient(); shuffle(events).forEach((e) => C.ingest(e));
    if (j(countsOf(C)) !== canon) { fail(label + ": a shuffled order produced different counts", "run " + i); return; }
  }
}

// Two plays: A plays SA ($play1), then B plays SB ($play2), at the position each part gives it. Counts key on the PLAYING.
const SCAFFOLD = [
  raw("$j1", 1, "@a:hs", { t: "ddjp.dj.join", v: "yt:SA_________" }),
  raw("$j2", 2, "@b:hs", { t: "ddjp.dj.join", v: "yt:SB_________" }),
  raw("$play1", 3, "@a:hs", { t: "ddjp.dj.play", p: null }),      // A plays SA
];
const play2 = (l) => raw("$play2", l, "@b:hs", { t: "ddjp.dj.play", p: "$play1" });  // B plays SB

// ---- 1) distinct counting + dedup across songs ----
const VOTES = SCAFFOLD.concat([
  raw("$v1", 4, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u1
  raw("$v2", 5, "@u2:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u2
  raw("$v3", 6, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u1 again -> dedup
  raw("$s1", 7, "@u1:hs", { t: "ddjp.dj.save", p: "$play1" }),   // SA save +u1
  play2(8),
  raw("$v4", 9, "@u1:hs", { t: "ddjp.dj.vote", p: "$play2" }),   // SB +u1 (different song)
  raw("$v5", 10, "@u3:hs", { t: "ddjp.dj.vote", p: "$play2" }),  // SB +u3
]);
conv(VOTES, "distinct-counting", (sm) => {
  const c = countsOf(sm);
  if (!c["$play1"] || c["$play1"].votes !== 2) fail("the first playing should have 2 distinct voters (u1 deduped within it)", j(c["$play1"]));
  if (!c["$play1"] || c["$play1"].saves !== 1) fail("the first playing should have 1 save", j(c["$play1"]));
  if (!c["$play2"] || c["$play2"].votes !== 2) fail("the second playing should have 2 distinct voters", j(c["$play2"]));
  if (c["$play1"].votesAdjusted || c["$play2"].votesAdjusted) fail("no adjustment -> votesAdjusted must be false", j(c));
});

// ---- 2) same user, same song, TWO plays: each playing counts its own ----
// THIS ASSERTION USED TO SAY THE OPPOSITE, and it was wrong in a way that hid a real defect: it
// required u1 to count ONCE across both plays, so the second vote was accepted by the reducer,
// carried and protected by the vouch layer, and moved no number anywhere. A legal event that
// changes nothing is the failure shape this codebase exists to refuse, and this guard was pinning
// it in place. Two plays of one track are two moments in the room; each owns its reactions.
const REPLAY = [
  raw("$rj1", 1, "@a:hs", { t: "ddjp.dj.join",    v: "yt:SX_________" }),
  raw("$rd1", 2, "@a:hs", { t: "ddjp.dj.declare", v: "yt:SX_________" }),   // A buffers SX twice
  raw("$rp1", 3, "@a:hs", { t: "ddjp.dj.play",    p: null }),   // play SX  ($rp1)
  raw("$rv1", 4, "@u1:hs", { t: "ddjp.dj.vote", p: "$rp1" }),   // u1 votes SX (1st play, on air)
  raw("$rp2", 5, "@a:hs", { t: "ddjp.dj.play",    p: "$rp1" }), // play SX again ($rp2)
  raw("$rv2", 6, "@u1:hs", { t: "ddjp.dj.vote", p: "$rp2" }),   // u1 votes SX (2nd play) -> its OWN tally
];
conv(REPLAY, "same-user-same-song-two-plays", (sm) => {
  const c = countsOf(sm);
  if (!c["$rp1"] || c["$rp1"].votes !== 1) fail("the first playing of SX counts u1's vote", j(c["$rp1"]));
  if (!c["$rp2"] || c["$rp2"].votes !== 1) fail("the SECOND playing of SX counts u1's vote too — a "
    + "returning listener reacting to a new playing must move the number, not be silently absorbed "
    + "by a tally belonging to a playing that already ended", j(c["$rp2"]));
});

// ---- 3) owner set-absolute: baseline + organic on top; latest wins; owner-gated ----
const ADJ = SCAFFOLD.concat([
  raw("$v1", 4, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                   // SA organic +u1 (before set)
  raw("$cf", 5, "@troll:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 999 }, RANK.STAFF), // forged (non-owner) -> ignored
  raw("$c1", 6, "@owner:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 10 }, RANK.OWNER),   // owner set 10 (resets organic)
  raw("$c2", 7, "@owner:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 50 }, RANK.OWNER),   // later owner set 50 wins
  raw("$v2", 8, "@u2:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                   // organic +u2 AFTER the set
  raw("$v3", 9, "@u3:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                   // organic +u3 AFTER the set
  play2(10),                                                                                       // SA ends after all of them
]);
conv(ADJ, "owner-set-absolute", (sm) => {
  const c = countsOf(sm);
  // 50 (latest owner set) + 2 distinct organic voters after it (u2,u3); the pre-set u1 and the
  // forged 999 are both subsumed/ignored.
  if (!c["$play1"] || c["$play1"].votes !== 52) fail("the first playing should be 50 (latest owner set) + 2 organic-after = 52", j(c["$play1"]));
  if (!c["$play1"] || c["$play1"].votesAdjusted !== true) fail("votesAdjusted must be true on the playing after an owner set", j(c["$play1"]));
});

// ---- 4) an owner set with NO organic after == exactly the set value ----
const EXACT = SCAFFOLD.concat([
  play2(4),
  raw("$ce", 5, "@owner:hs", { t: "ddjp.count.set", k: "save", id: "$play2", n: 7 }, RANK.OWNER),
]);
conv(EXACT, "set-with-no-organic", (sm) => {
  const c = countsOf(sm);
  if (!c["$play2"] || c["$play2"].saves !== 7) fail("the second playing's saves should equal the owner set value (7) with no organic after", j(c["$play2"]));
});

// ---- 5) a reaction on a playing that has ENDED is refused (740, the owner's: "late vote arent allowed") ----
// SA is on air, gets one vote; SB starts; then a vote, a save and the owner's count change on SA land — the last-second vote ordered
// after the next play is this case. None of them counts: SA keeps its one vote, unadjusted, and the fold refuses each, by name.
const LATE = SCAFFOLD.concat([
  raw("$on", 4, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                    // SA on air: counts
  play2(5),
  raw("$lv", 6, "@u2:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                    // SA has ended: refused
  raw("$ls", 7, "@u2:hs", { t: "ddjp.dj.save", p: "$play1" }),                                    // the same for a save
  raw("$lc", 8, "@owner:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 9 }, RANK.OWNER), // the owner's change on a past song
]);
conv(LATE, "ended-playing-refused", (sm) => {
  const c = countsOf(sm);
  if (!c["$play1"] || c["$play1"].votes !== 1 || c["$play1"].saves !== 0 || c["$play1"].votesAdjusted)
    fail("740: a vote, a save and the owner's count change on a song that has ENDED count for nothing — SA keeps its one vote", j(c["$play1"]));
  const why = ["$lv", "$ls", "$lc"].map((id) => sm.isLegal(id) === false && (sm.refusalOf(id) || {}).code);
  if (why.join() !== "not-on-air,not-on-air,not-on-air") fail("740: and the fold refuses each as `not-on-air`", j(why));
  if (sm.isLegal("$on") !== true) fail("740: CONTROL — the vote while SA was on air is accepted", j(sm.isLegal("$on")));
});

if (failed) { console.log("[counts] " + failed + " failure(s)"); process.exit(1); }
console.log("[counts] PASS — a reaction counts only for the playing on air where it lands (740), and per-song distinct vote/save counts (deduped by user; same song across plays counts once); owner set-absolute sets a baseline with organic-on-top, latest-wins, owner-gated (forged ignored); all convergent across shuffled orders");
process.exit(0);
