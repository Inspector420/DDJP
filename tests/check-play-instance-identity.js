// tests/check-play-instance-identity.js
//
// A PLAYING IS THE UNIT OF IDENTITY, NOT A VIDEO ID.
//
// The same song played twice is two different events in the life of a room. It has two slots in
// the history, two DJs who may be different people, two start times, its own skipped-or-not — and
// its own reactions. Everything about a playing was already scoped to the play instance except the
// one thing people actually look at: the vote and save counts, which were tallied per VIDEO ID and
// therefore accumulated across every playing the song ever had.
//
// TWO SYMPTOMS, ONE CAUSE, and the second is the one that matters:
//   · a replayed song opened with the previous playing's votes already on it
//   · someone who voted the FIRST time could vote again — the affordance unlatches correctly,
//     because it is keyed on the instance — and their vote changed nothing. The reducer accepted
//     it, the vouch layer spent protection on it, and the count did not move. A legal event that
//     changes nothing is the exact failure shape this codebase refuses everywhere else.
//
// The cause was one line: `piToVid[c.p]` took the instance the voter actually reacted to and
// collapsed it into the song. The instance was in the event body the whole time.
//
// WHAT THIS COSTS, stated rather than discovered later: a checkpoint seals the LIVE playing's
// counts only, exactly as it already seals only the live playing's length declarations and calls
// off-air ones dead. Keyed per playing, sealing them all would grow the seed with every song the
// room ever played, and a checkpoint is specified to stay small however old the room is. So a past
// playing's counts are recomputed from the log while it is held and are gone below a forget floor.
// They are display data about something that already happened, which is the same category history
// is in.
//
// GUARANTEES:
//   PART A — A REPLAY STARTS CLEAN. The same videoId played again has its own, zero, counts.
//   PART B — A RETURNING VOTER COUNTS. Someone who reacted to an earlier playing can react to a
//     new one and the number moves. This is the symptom that was silent.
//   PART C — EACH HISTORY SLOT CAN REPORT ITS OWN. Both tables key on the play instance, so a
//     history row joins to exactly that playing's figures and two rows for one video give two
//     different answers. The figures are deliberately NOT written onto the row: a history row
//     records WHAT PLAYED, and check-reactions holds the line that a vote must not change it.
//   PART D — THE OWNER'S OVERRIDE NAMES A PLAYING. count.set adjusts one playing, not a song for
//     all time, and does not leak onto a later one.
//   PART E — THE SEED STAYS SMALL. Only the live playing's counts are sealed; a long room does not
//     grow its checkpoints one entry per song played.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[play-instance-identity] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
const { StateDeriver } = sb;

const OWNER = sb.Ranks.levelOf("owner");
const PLAYER = sb.Ranks.levelOf("player");

let _l = 0;
function ev(id, ts, sender, rank, body) {
  return { eventId: id, l: ++_l, ts: ts, sender: sender, senderRank: rank,
           type: body.t, content: body, roomId: "!r:hs" };
}
// A DJ who stays stocked, playing SONG_A, then SONG_B, then SONG_A again — three playings, two of
// them the same video. Positions are far apart so the advance gate is never the thing under test.
function threePlayings(extra) {
  _l = 0;
  const log = [
    ev("$j", 1000, "@dj:hs", PLAYER, { t: "ddjp.dj.join", v: "SONG_A" }),
    ev("$d1", 1000, "@dj:hs", PLAYER, { t: "ddjp.dj.declare", v: "SONG_B" }),
    ev("$playA1", 100000, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: null }),
    ev("$va", 101000, "@alice:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA1" }),
    ev("$vb", 101100, "@bob:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA1" }),
    ev("$sa", 101200, "@alice:hs", PLAYER, { t: "ddjp.dj.save", p: "$playA1" }),
    ev("$playB", 400000, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: "$playA1" }),
    ev("$j2", 401000, "@dj:hs", PLAYER, { t: "ddjp.dj.join", v: "SONG_A" }),
    ev("$playA2", 700000, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: "$playB" }),
  ];
  for (const e of (extra || [])) log.push(e);
  return log;
}
const countsFor = (st, pi) => (st.counts && st.counts[pi]) || null;

// ── PART A — a replay starts clean ────────────────────────────────────────────────────────────
(() => {
  const st = StateDeriver.derive(threePlayings());
  ok(st.nowPlaying && st.nowPlaying.pi === "$playA2" && st.nowPlaying.song.videoId === "SONG_A",
    "A: the third playing is SONG_A again, under a new instance", st.nowPlaying);
  const first = countsFor(st, "$playA1");
  const replay = countsFor(st, "$playA2");
  ok(first && first.votes === 2 && first.saves === 1,
    "A: the first playing keeps its own two votes and one save", first);
  ok(!replay || (replay.votes === 0 && replay.saves === 0),
    "A: APPLIED — the REPLAY opens with nothing on it. Counted per video id, it opened showing the "
    + "previous playing's reactions, which is a figure about a different moment in the room",
    replay);
})();

// ── PART B — a returning voter counts ─────────────────────────────────────────────────────────
(() => {
  const st = StateDeriver.derive(threePlayings([
    ev("$va2", 701000, "@alice:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA2" }),
  ]));
  const replay = countsFor(st, "$playA2");
  ok(replay && replay.votes === 1,
    "B: APPLIED — alice voted on the first playing and votes again on this one, and the number "
    + "MOVES. Deduped per video id her second vote was accepted, protected by the vouch layer, and "
    + "counted for nothing — a legal event that changes nothing, which is the failure this whole "
    + "codebase is organised around refusing", replay);
  const first = countsFor(st, "$playA1");
  ok(first && first.votes === 2,
    "B: and the earlier playing is untouched by it", first);
})();

// ── PART B2 — dedup still holds WITHIN one playing ────────────────────────────────────────────
(() => {
  const st = StateDeriver.derive(threePlayings([
    ev("$va2", 701000, "@alice:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA2" }),
    ev("$va3", 701500, "@alice:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA2" }),
  ]));
  const replay = countsFor(st, "$playA2");
  ok(replay && replay.votes === 1,
    "B2: one person still counts ONCE per playing. Scoping the tally to the instance must not "
    + "loosen the rule inside it", replay);
})();

// ── PART C — history carries its own ──────────────────────────────────────────────────────────
(() => {
  const st = StateDeriver.derive(threePlayings([
    ev("$va2", 701000, "@alice:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA2" }),
  ]));
  const rows = st.history.filter((h) => h.videoId === "SONG_A");
  ok(rows.length === 2, "C: two playings of SONG_A are two rows in the history", rows);
  // The join a renderer makes: row.pi -> that playing's own tally.
  const figures = rows.map((h) => ({ pi: h.pi, votes: (st.counts[h.pi] || { votes: 0 }).votes }));
  const first = figures.find((f) => f.pi === "$playA1");
  const second = figures.find((f) => f.pi === "$playA2");
  ok(first && first.votes === 2,
    "C: APPLIED — the first row joins to the reactions to THAT playing", first);
  ok(second && second.votes === 1,
    "C: APPLIED — and the second joins to its own, so one song played twice is two rows with two "
    + "different figures rather than one number shown twice", second);
  ok(rows.every((h) => h.votes === undefined && h.saves === undefined),
    "C: and the figures are NOT written onto the row — a history row records what PLAYED, and a "
    + "reaction must not mutate the record of the past (check-reactions holds that line)", rows);
})();

// ── PART D — the owner's override names a playing ─────────────────────────────────────────────
(() => {
  const st = StateDeriver.derive(threePlayings([
    ev("$set", 701000, "@owner:hs", OWNER, { t: "ddjp.count.set", k: "vote", id: "$playA2", n: 40 }),
    ev("$vc", 702000, "@carol:hs", PLAYER, { t: "ddjp.dj.vote", p: "$playA2" }),
  ]));
  const replay = countsFor(st, "$playA2");
  ok(replay && replay.votes === 41 && replay.votesAdjusted === true,
    "D: an owner baseline applies to the playing it names, and organic votes resume on top", replay);
  const first = countsFor(st, "$playA1");
  ok(first && first.votes === 2 && first.votesAdjusted !== true,
    "D: APPLIED — and it does NOT reach a different playing of the same song. Keyed by video id an "
    + "owner adjusting one playing silently restated every other one", first);
})();

// ── PART E — the seed stays small ─────────────────────────────────────────────────────────────
(() => {
  const seed = StateDeriver.buildSeed(threePlayings());
  const sealed = Object.keys((seed.ledger && seed.ledger.counts) || {});
  ok(sealed.length <= 1,
    "E: APPLIED — a checkpoint seals the LIVE playing's counts only. Sealed per playing, a room "
    + "would grow its seed by one entry for every song it ever played, and a checkpoint is "
    + "specified to stay small however old the room is — the same reason only the live playing's "
    + "length declarations are sealed and off-air ones are called dead", sealed);
  ok(sealed.length === 0 || sealed[0] === "$playA2",
    "E: and it is the LIVE one that is sealed, not an arbitrary survivor", sealed);
})();

if (failures) process.exit(1);
console.log("[play-instance-identity] PASS — a PLAYING owns its reactions: the same song played "
  + "again starts clean instead of opening on the previous playing's votes, a listener who "
  + "reacted to an earlier playing can react to this one and the number actually moves (their "
  + "vote used to be accepted, protected, and counted for nothing), one person still counts once "
  + "within a playing, each history slot joins to its own figures, an owner baseline adjusts the "
  + "playing it names and no other, and only the live playing is sealed so a checkpoint does not "
  + "grow with every song the room has ever played");
