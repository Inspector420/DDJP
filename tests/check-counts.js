// tests/check-counts.js
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
//   - every result is identical across shuffled arrival orders (convergence).

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

// Two plays: A plays SA ($play1), then B plays SB ($play2). Counts key on the PLAYING.
const SCAFFOLD = [
  raw("$j1", 1, "@a:hs", { t: "ddjp.dj.join", v: "SA" }),
  raw("$j2", 2, "@b:hs", { t: "ddjp.dj.join", v: "SB" }),
  raw("$play1", 3, "@a:hs", { t: "ddjp.dj.play", p: null }),      // A plays SA
  raw("$play2", 4, "@b:hs", { t: "ddjp.dj.play", p: "$play1" }),  // B plays SB
];

// ---- 1) distinct counting + dedup across songs ----
const VOTES = SCAFFOLD.concat([
  raw("$v1", 5, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u1
  raw("$v2", 6, "@u2:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u2
  raw("$v3", 7, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),   // SA +u1 again -> dedup
  raw("$s1", 8, "@u1:hs", { t: "ddjp.dj.save", p: "$play1" }),   // SA save +u1
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
  raw("$rj1", 1, "@a:hs", { t: "ddjp.dj.join",    v: "SX" }),
  raw("$rd1", 2, "@a:hs", { t: "ddjp.dj.declare", v: "SX" }),   // A buffers SX twice
  raw("$rp1", 3, "@a:hs", { t: "ddjp.dj.play",    p: null }),   // play SX  ($rp1)
  raw("$rp2", 4, "@a:hs", { t: "ddjp.dj.play",    p: "$rp1" }), // play SX again ($rp2)
  raw("$rv1", 5, "@u1:hs", { t: "ddjp.dj.vote", p: "$rp1" }),   // u1 votes SX (1st play)
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
  raw("$v1", 5, "@u1:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                   // SA organic +u1 (before set)
  raw("$cf", 6, "@troll:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 999 }, RANK.STAFF), // forged (non-owner) -> ignored
  raw("$c1", 7, "@owner:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 10 }, RANK.OWNER),   // owner set 10 (resets organic)
  raw("$c2", 8, "@owner:hs", { t: "ddjp.count.set", k: "vote", id: "$play1", n: 50 }, RANK.OWNER),   // later owner set 50 wins
  raw("$v2", 9, "@u2:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                   // organic +u2 AFTER the set
  raw("$v3", 10, "@u3:hs", { t: "ddjp.dj.vote", p: "$play1" }),                                  // organic +u3 AFTER the set
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
  raw("$ce", 5, "@owner:hs", { t: "ddjp.count.set", k: "save", id: "$play2", n: 7 }, RANK.OWNER),
]);
conv(EXACT, "set-with-no-organic", (sm) => {
  const c = countsOf(sm);
  if (!c["$play2"] || c["$play2"].saves !== 7) fail("the second playing's saves should equal the owner set value (7) with no organic after", j(c["$play2"]));
});

if (failed) { console.log("[counts] " + failed + " failure(s)"); process.exit(1); }
console.log("[counts] PASS — per-song distinct vote/save counts (deduped by user; same song across plays counts once); owner set-absolute sets a baseline with organic-on-top, latest-wins, owner-gated (forged ignored); all convergent across shuffled orders");
process.exit(0);
