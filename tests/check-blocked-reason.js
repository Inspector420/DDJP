// tests/check-blocked-reason.js
// A BLOCKED DECLARATION CARRIES WHY, AND ONLY SOME REASONS COUNT TOWARD A ROOM SKIP (J06).
//
//   counts        the song is unplayable for anyone who tries — embedding disallowed, not
//                 available in your country, removed or private
//   does not      the problem is at my end — a bot check, a network failure, a player that
//                 would not load
//   untyped       does NOT count, so no client predating this can force a skip and the change
//                 lands without breaking a room mid-flight
//
// ── WHAT THIS FILE OWNS, AND WHAT IT DOES NOT ────────────────────────────────────────────────
// The road tally is computed TWICE — the reducer's re-validation of `ddjp.media.skip`, and the
// derived `advance` view that decides whether `MediaBlocked` ever authors one — and the two must
// agree on BOTH axes. `check-tier-inclusive` owns the RANK axis (F3, from the J39 sweep). This file
// owns the REASON axis and the agreement across it.
//
// THAT SPLIT IS THE FINDING THIS FILE WAS WRITTEN FROM, and it is worth stating because the
// handoff into J06 predicted the opposite. `check-tier-inclusive` was expected to catch a
// reason filter added to one copy and not the other. DRIVEN, it does not: its fixtures hold the
// reason constant — before J06 there was no reason to vary — so with both copies filtering on a
// counting token it is byte-identical to a tree where only one does. Measured on a scratch copy:
// the filter in both copies + typed fixtures is GREEN, and the drift is invisible to it. That is
// `09-roadmap.md` §8's *a control that varies the wrong axis*, reached one axis over: the guard is
// not decorative, it is load-bearing for a different claim than the one it appears to make.
//
// ── DERIVED, NEVER RESTATED ──────────────────────────────────────────────────────────────────
// **No reason token is spelled in this file.** The vocabulary is read from
// `StateDeriver.BLOCKED_REASONS`, which is the one home for it, and every case is built by asking
// that table for a token of the kind it needs. A token added tomorrow is covered tomorrow, in both
// directions — a new counting reason has to advance a road, a new local one has to not.
//
// ── THE MEASUREMENT IS GATED, AND THE GATE IS SELF-TESTED ────────────────────────────────────
// Every way of failing to reach this code returns the same values as "the reason correctly did not
// count": zero counted, no escape, nothing warranted. So the probe states its preconditions as
// separate checks and refuses to answer if one fails, naming the stage — and `selfTest()` feeds the
// gate deliberately broken inputs to show it catches them. See `_probe-blocked-reason.js`.

const P = require("./_probe-blocked-reason");
const { measure, admissible, selfTest, REASONS, COUNTING, LOCAL, StateDeriver, Ranks } = P;

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[blocked-reason] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
// `ok` COLLECTS rather than exits, deliberately. Attributing a red means knowing WHICH assertion
// fired, and in a guard whose `ok` exits, one red line names the first assertion rather than the
// only one that would have (08-build-and-deploy.md §Writing a guard). The floor guards use the
// same style for the same reason.

// ══ PART Z — THE GATE CATCHES ITS OWN BREAKAGE ════════════════════════════════════════════════
// First, because every part below rests on it. A gate that admits everything certifies the rest of
// this file on its own authority.
{
  const st = selfTest();
  ok(st.missed.length === 0,
    "Z: the admissibility gate ADMITTED a reading it exists to refuse. Every part below reads its " +
    "result through this gate, so a hole here silently converts an unreached measurement into a " +
    "clean pass — the failure that cost three separate audits of this exact surface", st.missed);
  ok(st.rejectedGood === null,
    "Z: the gate REFUSED a sound reading, which blocks every real measurement in this file. A gate " +
    "that refuses everything is as useless as one that refuses nothing, and only checking both " +
    "directions tells them apart", st.rejectedGood);
  ok(st.inversionOk === true,
    "Z: the gate must distinguish a case that intends its declarations ACCEPTED from one that " +
    "intends them REFUSED. The malformed-token case wants 0 accepted, so without this the gate " +
    "either rejects that case or stops noticing a fixture that never arrived");
}

// ══ PART A — THE VOCABULARY IS ONE CLOSED LIST, IN ONE PLACE, AND REACHABLE BY THE REPORTER ════
// P7's half of the job's Done-when: "the reason list lives in exactly one place".
{
  ok(COUNTING.length >= 1 && LOCAL.length >= 1,
    "A: the vocabulary must contain at least one reason of EACH kind. With only one kind every " +
    "case below reads the same and this file compares nothing", { counting: COUNTING, local: LOCAL });

  // CLOSED. Every token is a plain short string, because this value is folded into `liveDecl` and
  // therefore into a checkpoint seed, which the fingerprint commits. Free text there is an
  // unbounded string in a hashed field, which is what the closed vocabulary exists to prevent.
  const badTokens = Object.keys(REASONS).filter(
    (k) => typeof k !== "string" || !/^[a-z][a-z-]{1,30}$/.test(k));
  ok(badTokens.length === 0,
    "A: every reason token must be a short lower-case identifier. The token reaches a checkpoint " +
    "seed and so the fingerprint `h` commits it, so the bound on its shape is what keeps arbitrary " +
    "bytes out of a hashed field — the job's own Open list calls free text out for exactly this",
    badTokens);
  const undecided = Object.keys(REASONS).filter((k) => typeof REASONS[k].counts !== "boolean");
  ok(undecided.length === 0,
    "A: every token must DECIDE whether it counts. A token whose verdict is absent inherits " +
    "falsey by accident rather than by a decision somebody made", undecided);

  // THE REPORTER READS THE LIST RATHER THAN RESTATING IT, and the whole point is that it cannot
  // send a token the fold refuses. `features/` may not reach StateDeriver (check-boundaries rule
  // F), so the route is the interface global — the relationship the settings panel already has
  // with SETTING_RANGES.
  const smb = require("./_load").loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout });
  const viaInterface = smb.StreamManager.blockedReasons ? smb.StreamManager.blockedReasons() : null;
  ok(viaInterface && Object.keys(viaInterface).length === Object.keys(REASONS).length,
    "A: the vocabulary must be reachable through the INTERFACE, or the feature that maps a player " +
    "error onto a token has to keep its own copy — two hand-maintained copies of one table, which " +
    "is the drift that left the settings panel offering values the reducer refused",
    { viaInterface: viaInterface && Object.keys(viaInterface), direct: Object.keys(REASONS) });
  // and it is a COPY, so no caller can edit the protocol out from under the fold
  if (viaInterface) {
    const k0 = Object.keys(viaInterface)[0];
    viaInterface[k0].counts = !viaInterface[k0].counts;
    const again = smb.StreamManager.blockedReasons();
    ok(again[k0].counts === REASONS[k0].counts,
      "A: `blockedReasons()` must hand out a fresh copy. A caller that can mutate the returned " +
      "table can change what counts toward a skip for everything downstream in that page",
      { token: k0, afterMutation: again[k0] });
  }

  // ── THE FEATURE'S MAPPING CANNOT PRODUCE A TOKEN THE FOLD REFUSES ──────────────────────────
  // Two homes, two questions: the reducer owns *which tokens exist and which count*, the feature
  // owns *which player error means which token*. What must hold between them is that the feature's
  // RANGE is a subset of the reducer's DOMAIN. Derived by reading the feature's own map, so a code
  // added to it tomorrow is checked tomorrow.
  const fsb = require("./_load").loadInContext([
    "backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js",
  ], {
    StreamManager: { getState: () => ({ nowPlaying: null, settings: {} }), on() {}, off() {},
                     blockedReasons: () => JSON.parse(JSON.stringify(REASONS)) },
    MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
    Logger: { info() {}, warn() {}, debug() {} }, setTimeout, clearTimeout, Date,
  });
  const MB = fsb.MediaBlocked;
  const map = MB._REASON_FOR_CODE || {};
  const codes = Object.keys(map);
  ok(codes.length >= 3,
    "A: the player-error mapping is implausibly small — a scan that found nothing would report a " +
    "clean subset check", { codes: codes });
  const strays = codes.filter((c) => !Object.prototype.hasOwnProperty.call(REASONS, map[c]));
  ok(strays.length === 0,
    "A: every token the reporter can emit must be one the reducer accepts. A stray one is not a " +
    "cosmetic mismatch: the fold REFUSES an unknown token outright, so the declaration is lost " +
    "entirely rather than merely not counting",
    strays.map((c) => c + " -> " + map[c]));
  // and an unrecognised code yields NO token rather than a guess — reporting an unknown failure as
  // though the song were the problem is the one direction that could force a skip on nothing
  ok(MB.reasonForErrorCode(999999) === null && MB.reasonForErrorCode(undefined) === null,
    "A: an unrecognised player error must map to NO token. Guessing a counting reason from an " +
    "unknown failure is the only direction here that can force a skip the room did not earn",
    { unknown: MB.reasonForErrorCode(999999), absent: MB.reasonForErrorCode(undefined) });
}

// ══ PART B — THE THREE VERDICTS, DRIVEN, EVERY TOKEN ══════════════════════════════════════════
// The job's Done-when, in order: a counting reason advances a road, a non-counting one does not, an
// untyped declaration does not. Driven over the WHOLE vocabulary rather than one token of each, so
// a token added with the wrong verdict is caught rather than sampled around.
const guestLevel = Ranks.levelOf("guest");
let verdicts = 0;
{
  // Enough reporters at the weakest banded rung to satisfy the largest requirement any road places
  // on it — derived from the shipped roads, so a re-tuned room still drives a road that fires.
  const roads = StateDeriver.defaultSettings().skipRoads || [];
  const need = roads.reduce((m, r) => Math.max(m, (r && r.guestPlus) || 0), 0) || 5;

  for (const k of COUNTING) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r);
    ok(g.ok, "B: measurement inadmissible for counting reason `" + k + "`", g.problems);
    if (!g.ok) continue;
    ok(r.guestPlus === need,
      "B: a COUNTING reason (`" + k + "`) must be tallied. The song is unplayable for anyone who " +
      "tries, which is the whole basis on which the room — not the reporter — decides to skip",
      { reason: k, reporters: need, counted: r.guestPlus });
    ok(r.skipWarranted === true && r.escapeAccepted === true,
      "B: a road met by COUNTING reasons must both warrant the escape and accept it. One without " +
      "the other is the two copies of the tally disagreeing, which has no error path in either " +
      "direction", { reason: k, warranted: r.skipWarranted, accepted: r.escapeAccepted });
    verdicts++;
  }

  for (const k of LOCAL) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r);
    ok(g.ok, "B: measurement inadmissible for local reason `" + k + "`", g.problems);
    if (!g.ok) continue;
    // THE DECLARATION IS STILL ACCEPTED. Not counting is not the same as not being folded: the
    // report is real, it is protected like any other declaration, and J08 renders it. Only the road
    // ignores it. The gate above already asserted `accepted === requested`.
    ok(r.guestPlus === 0 && r.vipPlus === 0,
      "B: a NON-COUNTING reason (`" + k + "`) must reach no band. The problem is at the reporter's " +
      "end, so letting it advance a road would let one client's bot check or dead connection end " +
      "everyone else's song", { reason: k, guestPlus: r.guestPlus, vipPlus: r.vipPlus });
    ok(r.skipWarranted === false && r.escapeAccepted === false,
      "B: a room of NON-COUNTING reports must neither warrant an escape nor accept one",
      { reason: k, warranted: r.skipWarranted, accepted: r.escapeAccepted });
    verdicts++;
  }

  // UNTYPED — the mid-flight rule, and the reason this can land at all.
  const u = measure({ rungLevel: guestLevel, n: need, reason: null });
  const gu = admissible(u);
  ok(gu.ok, "B: measurement inadmissible for the UNTYPED case", gu.problems);
  if (gu.ok) {
    ok(u.accepted === need,
      "B: an UNTYPED declaration must still be ACCEPTED. Refusing it would break every room with a " +
      "client that predates this change, and would strip the declaration of protection as well as " +
      "of its vote", { accepted: u.accepted, requested: need });
    ok(u.guestPlus === 0 && u.skipWarranted === false && u.escapeAccepted === false,
      "B: an UNTYPED declaration must count toward NO road. This is what stops an older client " +
      "forcing a skip, and it is the whole reason the change can land without breaking rooms " +
      "mid-flight", { counted: u.guestPlus, warranted: u.skipWarranted, accepted: u.escapeAccepted });
    verdicts++;
  }

  // AN UNKNOWN TOKEN IS REFUSED, not accepted-and-ignored — because the token reaches a hashed
  // field. This is the one case whose declarations are MEANT to be refused, hence the inverted gate.
  const bad = measure({ rungLevel: guestLevel, n: need, reason: "definitely-not-a-real-reason" });
  const gb = admissible(bad, { expectAccepted: false });
  ok(gb.ok, "B: measurement inadmissible for the unknown-token case", gb.problems);
  if (gb.ok) {
    ok(bad.accepted === 0,
      "B: a declaration carrying an UNKNOWN token must be REJECTED outright, as a bad `sec` is. " +
      "Accepting it and ignoring the value is what would let an arbitrary string into `liveDecl` " +
      "and so into a checkpoint seed the fingerprint commits", { accepted: bad.accepted });
    ok(bad.skipWarranted === false && bad.escapeAccepted === false,
      "B: an unknown token must reach no road either", bad);
    verdicts++;
  }
}
ok(verdicts >= COUNTING.length + LOCAL.length + 2,
  "B: fewer verdicts were driven than the vocabulary has entries, so some token was never " +
  "exercised — a loop that filtered to nothing reports a clean sweep of a subset",
  { verdicts: verdicts, expected: COUNTING.length + LOCAL.length + 2 });

// ══ PART C — THE TWO COPIES OF THE TALLY AGREE ACROSS THE REASON AXIS ═════════════════════════
// This is the part `check-tier-inclusive` cannot supply, and the reason this file exists. The view
// decides whether a client ever AUTHORS the escape; the reducer decides whether it is LEGAL. A
// reason filter in one and not the other has no error path in either direction:
//
//   view generous  -> every client authors an escape every client refuses, forever, and each
//                     refusal reads in the log as an ordinary lost race
//   reducer generous -> nobody authors one, so the reducer's willingness is never exercised —
//                     silence, which is the harder half to notice
//
// So the assertion is AGREEMENT, at every point on the axis, including the untyped one. Both
// readings come from ONE fixture per case, so a disagreement cannot be an artefact of two setups.
{
  let compared = 0, sawWarranted = false, sawRefused = false;
  const roads = StateDeriver.defaultSettings().skipRoads || [];
  const need = roads.reduce((m, r) => Math.max(m, (r && r.guestPlus) || 0), 0) || 5;
  const axis = COUNTING.concat(LOCAL).concat([null]);
  for (const k of axis) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r);
    ok(g.ok, "C: measurement inadmissible at axis point `" + String(k) + "`", g.problems);
    if (!g.ok) continue;
    ok(r.skipWarranted === r.escapeAccepted,
      "C: the derived view and the reducer's re-validation must reach the SAME verdict for reason " +
      "`" + String(k) + "`. They are two copies of one tally and this is the axis " +
      "`check-tier-inclusive` holds constant, so a filter added to one copy and not the other is " +
      "invisible everywhere else in the suite",
      { reason: String(k), skipWarranted: r.skipWarranted, escapeAccepted: r.escapeAccepted });
    if (r.skipWarranted === true) sawWarranted = true; else sawRefused = true;
    compared++;
  }
  // A CONTROL FOR THE AGREEMENT ITSELF, in both directions. `false === false` satisfies the
  // assertion above exactly as well as `true === true`, so without these the part could pass on a
  // fixture where no road ever fires — two copies agreeing about nothing.
  ok(sawWarranted,
    "C: no axis point actually WARRANTED an escape, so every agreement above is agreement that " +
    "nothing happened", { compared: compared });
  ok(sawRefused,
    "C: no axis point REFUSED one, so the agreement was never tested against a reason that does " +
    "not count — which is the half this file is for", { compared: compared });
  ok(compared >= 3,
    "C: the axis walk compared too few points to mean anything", { compared: compared });
}

// ══ PART D — THE REASON IS IN THE CHECKPOINT SEED, OR THE TWO FOLDS DIVERGE ═══════════════════
// The half J06's own entry does not name. `liveDecl` is a carry-forward accumulator by
// checkpoint-contents.md §0's test: the advance that ends the current song is judged against the
// road tally, the tally now reads the reason, and nothing else in the seed can reproduce it. Seal
// the tier without the reason and a client that forgot behind the checkpoint counts reporters a
// genesis fold discards — which is §4.3's divergence, reached through a new field.
{
  const roads = StateDeriver.defaultSettings().skipRoads || [];
  const need = roads.reduce((m, r) => Math.max(m, (r && r.guestPlus) || 0), 0) || 5;
  let seedChecks = 0;
  for (const k of [COUNTING[0], LOCAL[0], null]) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r);
    ok(g.ok, "D: measurement inadmissible for seed case `" + String(k) + "`", g.problems);
    if (!g.ok) continue;
    ok(r.seedBlocked && Object.keys(r.seedBlocked).length === need,
      "D: the seed must carry every folded blocked reporter for the live playing. A missing one is " +
      "a client that banked the declarations and then counts differently from one that did not",
      { reason: String(k), sealed: r.seedBlocked && Object.keys(r.seedBlocked).length, expected: need });
    if (r.seedBlocked) {
      const entries = Object.keys(r.seedBlocked).map((u) => r.seedBlocked[u]);
      ok(entries.every((e) => e && typeof e.tier === "number"),
        "D: every sealed entry must carry the tier — the band cannot be recomputed without it",
        { reason: String(k), entries: entries.slice(0, 2) });
      ok(entries.every((e) => e && e.k === k),
        "D: every sealed entry must carry the REASON as folded. This is the field that makes a " +
        "seeded fold reach the same road verdict as a genesis fold; without it the seed is a tally " +
        "that silently counts something else",
        { reason: String(k), entries: entries.slice(0, 2) });
    }
    // AND THE VERDICT SURVIVES THE ROUND TRIP. The assertion that matters is not the field's
    // presence but that folding the seed forward reaches the SAME answer as folding from genesis —
    // which is the release gate checkpoint-contents.md §4 states for the whole format.
    ok(r.seededEscapeAccepted === r.escapeAccepted,
      "D: a client folding from the SEED must reach the same verdict on the escape as one folding " +
      "from genesis, for reason `" + String(k) + "`. A difference here is the forget path diverging " +
      "from the full-log path — the exact failure the seed's declaration section was added for",
      { reason: String(k), fromGenesis: r.escapeAccepted, fromSeed: r.seededEscapeAccepted });
    seedChecks++;
  }
  ok(seedChecks >= 3,
    "D: too few seed cases were driven to have covered both kinds and the untyped one",
    { seedChecks: seedChecks });
}

if (failures) process.exit(1);
console.log("[blocked-reason] PASS — a blocked declaration carries WHY, and a fixed list decides " +
  "which reasons count toward a room skip: the song being unplayable for anyone advances a road, a " +
  "problem at the reporter's own end does not, and an UNTYPED declaration is accepted and counts " +
  "toward nothing — so no client predating the change can force a skip and no room breaks while " +
  "clients are mixed. An UNKNOWN token is refused outright rather than accepted and ignored, " +
  "because the token is folded into `liveDecl` and so into a checkpoint seed the fingerprint " +
  "commits, and that refusal is what keeps an unbounded string out of a hashed field. The " +
  "vocabulary is DERIVED from `StateDeriver.BLOCKED_REASONS` — no token is spelled in this file or " +
  "its probe — it is reachable by the reporter through the interface rather than restated in the " +
  "feature, and the feature's player-error map is asserted to be a subset of it. The tally's TWO " +
  "copies (the reducer's re-validation and the `advance` view) are driven to the same verdict at " +
  "every point on the reason axis, with a control in each direction: that axis is the one " +
  "`check-tier-inclusive` holds constant, so a filter added to one copy and not the other is " +
  "invisible to it, which was measured rather than assumed. And the reason reaches the checkpoint " +
  "SEED, with the seeded fold's verdict driven against the genesis fold's, because the road tally " +
  "is a carry-forward value and a seed that omits it makes a client that forgot count differently " +
  "from one that did not");
