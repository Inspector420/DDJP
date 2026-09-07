// tests/check-checkpoint-seed.js
// WALL: checkpoint seed-mode (Phase 7). The release gate for the whole checkpoint feature:
//
//   derive( buildSeed(events[0..N]), events[N+1..end] )  ===  derive(events[0..end])
//
// i.e. sealing the reducer's carry-forward accumulators at a cut point N and folding ONLY
// the events after N reproduces the SAME state as folding the whole log from genesis. If
// this holds at every cut, a client can forget everything before N and keep deriving.
//
// Guarantees:
//   PART A — EQUIVALENCE at every cut point, for a rich scenario (joins, declares, plays,
//     skips, a settings change, votes/saves, a mod move/remove).
//   PART B — CHAINED seeds: seed at N1, then seed the result at N2>N1, then fold the rest —
//     still equals genesis (checkpoints chain, not re-derive from birth).
//   PART C — SEED IS SELF-CONSISTENT: buildSeed's live-pi mapping makes a post-cut vote
//     attribute to the right song (counts match genesis).
//   PART D — NO-SEED unchanged: derive(events) === derive(events, undefined).

const assert = require("assert");
const { loadInContext } = require("./_load");
const RANK = { OWNER: 100, STAFF: 60, VIP: 40, PLAYER: 20 };

function fail(msg, got) {
  console.log("[checkpoint-seed] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
const SD = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date }).StateDeriver;
// Canonical stringify: sort object keys recursively, so a difference in KEY ORDER (the seed
// rebuilds nowPlaying in a different field order than a fresh fold) is not a false mismatch —
// only differing VALUES matter for equivalence.
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
const j = canon;
// Compare the FORWARD-DERIVATION-RELEVANT QUEUE state PLUS counts. Excludes only:
//  • `history` — a bounded DISPLAY window, deliberately not seeded (restarts + refills).
// As of Phase 9 the checkpoint seed carries the LEDGER SECTION (counts + dedup sets), so
// counts now survive a forget too — derive(seed@N, after) must reproduce them identically.
// Everything that governs the future QUEUE (nowPlaying/rotation/settings) and the grow-only
// counts MUST match — that is the full seed-mode equivalence contract.
function core(state) {
  return j({ nowPlaying: state.nowPlaying, rotation: state.rotation, settings: state.settings, counts: state.counts });
}

// A rich ordered scenario. Each entry is already in (l,event_id) order.
let L = 0;
const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 1000, l: L, content: Object.assign({}, body) }; };
const EVENTS = [
  mk("ddjp.dj.join", "@a:hs", RANK.PLAYER, { v: "S1aaaaaaaaa", u: "https://y/1" }),
  mk("ddjp.dj.join", "@b:hs", RANK.PLAYER, { v: "S2bbbbbbbbb", u: "https://y/2" }),
  mk("ddjp.dj.join", "@c:hs", RANK.PLAYER, { v: "S3ccccccccc", u: "https://y/3" }),
  mk("ddjp.dj.declare", "@a:hs", RANK.PLAYER, { v: "S1dddddddd2" }),
  mk("ddjp.room.settings", "@o:hs", RANK.OWNER, { s: { maxLen: 300, minGate: 6000 } }),
  mk("ddjp.dj.play", "@a:hs", RANK.PLAYER, { p: null }),          // S1 starts (maxLen 300)
  mk("ddjp.dj.vote", "@b:hs", RANK.PLAYER, { p: "$e6" }),
  mk("ddjp.dj.vote", "@c:hs", RANK.PLAYER, { p: "$e6" }),
  mk("ddjp.dj.save", "@b:hs", RANK.PLAYER, { p: "$e6" }),
  mk("ddjp.dj.play", "@b:hs", RANK.PLAYER, { p: "$e6" }),          // B plays S2
  mk("ddjp.room.settings", "@o:hs", RANK.OWNER, { s: { maxLen: 120 } }),  // mid-stream change
  mk("ddjp.dj.vote", "@a:hs", RANK.PLAYER, { p: "$e10" }),
  mk("ddjp.dj.skip", "@staff:hs", RANK.STAFF, { p: "$e10" }), // staff skips S2 → C plays S3
  mk("ddjp.dj.join", "@a:hs", RANK.PLAYER, { v: "S1eeeeeeee3" }),   // A re-joins (ran out earlier? still has S1d2)
  mk("ddjp.dj.move", "@staff:hs", RANK.STAFF, { x: "@a:hs" }),
  mk("ddjp.dj.vote", "@b:hs", RANK.PLAYER, { p: "$e13" }),
];
const genesis = SD.derive(EVENTS);

// ---- PART D: no-seed path unchanged --------------------------------------------
(() => {
  const a = SD.derive(EVENTS);
  const b = SD.derive(EVENTS, undefined);
  if (j(a) !== j(b)) fail("derive(events) must equal derive(events, undefined)");
})();

// ---- PART A: equivalence at every cut point ------------------------------------
(() => {
  for (let n = 0; n <= EVENTS.length; n++) {
    const before = EVENTS.slice(0, n);
    const after = EVENTS.slice(n);
    const seed = SD.buildSeed(before);
    const seeded = SD.derive(after, seed);
    if (core(seeded) !== core(genesis)) {
      fail("seed@" + n + " + after !== genesis", { at: n, seeded: seeded.nowPlaying, genesis: genesis.nowPlaying });
    }
  }
})();

// ---- PART B: chained seeds -----------------------------------------------------
(() => {
  const N1 = 6, N2 = 11;
  const seed1 = SD.buildSeed(EVENTS.slice(0, N1));
  // seed at N2 by continuing from seed1 over events N1..N2
  const seed2 = SD.buildSeed(EVENTS.slice(N1, N2), seed1);
  const seeded = SD.derive(EVENTS.slice(N2), seed2);
  if (core(seeded) !== core(genesis)) fail("chained seeds (N1→N2→rest) must equal genesis", { seeded: seeded.nowPlaying, genesis: genesis.nowPlaying });
})();

// ---- PART C: seed's live-pi mapping attributes post-cut votes to the live PLAYING --
(() => {
  // Cut right at the play (so the play + its votes are all AFTER the cut, and the seed
  // carries the members/rotation up to it). The live-pi map is rebuilt as the play folds,
  // so votes attribute correctly — proving the seed doesn't break attribution for the
  // live instance. (Pre-cut votes being dropped is the separate counts-section concern.)
  //
  // Counts key on the PLAY INSTANCE, not the video id: two plays of one track are two moments in
  // the room and hold their own reactions (check-play-instance-identity). So this reads the tally
  // under the live pi, which is the id of the play event itself.
  const cut = 5; // right before S1's play ($e6)
  const seed = SD.buildSeed(EVENTS.slice(0, cut));
  const seeded = SD.derive(EVENTS.slice(cut), seed);
  const pi = genesis.nowPlaying ? genesis.nowPlaying.pi : null;
  const gCounts = (pi && genesis.counts[pi]) || { votes: 0 };
  const sCounts = (pi && seeded.counts[pi]) || { votes: 0 };
  assert.strictEqual(sCounts.votes, gCounts.votes, "votes after the cut attribute to the live playing (seed doesn't break attribution)");
  if (gCounts.votes < 2) fail("scenario sanity: the live playing should have >=2 votes", gCounts);
})();

// ---- PART E: dedup survives the checkpoint (no double-count after a forget) -----
(() => {
  // A votes for the live song BEFORE the cut; the checkpoint seals the dedup set; A votes
  // AGAIN after the cut — must still count once (deduped via the seeded user set).
  let k = 0;
  const e = (type, sender, body) => { k++; return { eventId: "$k" + k, type, sender, senderRank: RANK.PLAYER, ts: k * 1000, l: k, content: Object.assign({}, body) }; };
  const evs = [
    e("ddjp.dj.join", "@a:hs", { v: "Zvvvvvvvvvv", u: "https://y/z" }),
    e("ddjp.dj.join", "@b:hs", { v: "Ywwwwwwwwww", u: "https://y/y" }),
    e("ddjp.dj.play", "@a:hs", { p: null }),          // $k3 plays Z
    e("ddjp.dj.vote", "@c:hs", { p: "$k3" }),          // C votes Z (before cut)
  ];
  // Keyed on the PLAYING ($k3, the play event's own id), not the video id — see PART C.
  const genesisCounts = SD.derive(evs.concat([ e("ddjp.dj.vote", "@c:hs", { p: "$k3" }) ])).counts["$k3"];
  // seal after C's first vote, then replay C's duplicate vote against the seed
  const seed = SD.buildSeed(evs);
  const dupVote = { eventId: "$k99", type: "ddjp.dj.vote", sender: "@c:hs", senderRank: RANK.PLAYER, ts: 99000, l: 99, content: { p: "$k3" } };
  const seededCounts = SD.derive([dupVote], seed).counts["$k3"];
  assert.strictEqual(seededCounts.votes, 1, "a repeat voter after the checkpoint is still deduped (counts once)");
  assert.strictEqual(seededCounts.votes, genesisCounts.votes, "dedup-across-checkpoint matches genesis");
})();

console.log("[checkpoint-seed] PASS — derive(seed@N, after) === derive(genesis) at every cut INCLUDING the live playing's counts (ledger section); chained seeds equal genesis; dedup survives the checkpoint for the playing still on air (no double-count after a forget); no-seed path unchanged");

// ---- SETTINGS PROVENANCE: the seed NAMES the event, it does not merely copy the values -------
// A checkpoint asserts the room's settings. The seed copies them, and a copy carries no evidence:
// once the events below the floor are gone, nobody can check whether those settings are what the
// log actually produced — they are believed because of who sealed the checkpoint. Naming the event
// makes the claim checkable by anyone holding it, which is what lets EventCache pin it.
(() => {
  const noop = () => {};
  const sb = loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"],
    { Logger: { info: noop, warn: noop, error: noop, debug: noop } }
  );
  const SD = sb.StateDeriver;
  let n = 0;
  const ev = (t, sender, rank, body) => { n++; return { eventId: "$s" + n, type: t, sender, senderRank: rank, ts: n * 1000, l: n, content: Object.assign({}, body) }; };

  // A room still on defaults references nothing — and that is verifiable, because defaults are
  // code rather than data.
  const bare = SD.buildSeed([ev("ddjp.dj.join", "@a", 100, { v: "AAAAAAAAAAA", u: "https://y/a" })]);
  assert.strictEqual(bare.settingsFrom, null, "a room on defaults names no settings event");

  // Once the owner sets settings, the seed names that event.
  n = 0;
  const log = [
    ev("ddjp.dj.join", "@a", 100, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    ev("ddjp.room.settings", "@a", 100, { s: { maxLen: 300 } }),
    ev("ddjp.dj.play", "@a", 100, { p: null }),
  ];
  const seed = SD.buildSeed(log);
  assert.strictEqual(seed.settingsFrom, "$s2", "the seed names the settings event it honoured");
  assert.strictEqual(seed.settings.maxLen, 300, "and still carries the values as a checksum");
  assert.strictEqual(seed.nowPlaying.settingsFrom, "$s2",
    "the per-song freeze names its event too — 'what governed this song' is its own claim");

  // A LATER settings change moves the room's pointer but must NOT rewrite the running song's.
  // Reading these from one field would let a mid-song change retroactively re-govern the song,
  // which is the precise thing the frozen snapshot exists to prevent.
  const log2 = log.concat([ev("ddjp.room.settings", "@a", 100, { s: { maxLen: 500 } })]);
  const seed2 = SD.buildSeed(log2);
  assert.strictEqual(seed2.settingsFrom, "$s4", "the room's pointer follows the newest event");
  assert.strictEqual(seed2.nowPlaying.settingsFrom, "$s2",
    "the playing song still points at the settings in force when it STARTED");
  assert.notStrictEqual(seed2.settingsFrom, seed2.nowPlaying.settingsFrom,
    "so the two references genuinely differ mid-song — both must survive a forget");

  // An event the rank gate REJECTED must never be named: the pointer records what was honoured.
  const log3 = log.concat([ev("ddjp.room.settings", "@b", 20, { s: { maxLen: 999 } })]);
  const seed3 = SD.buildSeed(log3);
  assert.strictEqual(seed3.settingsFrom, "$s2", "a rejected settings event is not recorded");
  assert.strictEqual(seed3.settings.maxLen, 300, "and does not reach the values either");
  console.log("[checkpoint-seed] settings provenance OK");
})();
