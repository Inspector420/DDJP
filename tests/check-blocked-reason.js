// tests/check-blocked-reason.js
// SUBJECT: features/mediablocked.js, backends/backend1/statederiver.js, backends/backend1/streammanager.js, ui/youtube.js
// `streammanager.js` ADDED at `ddjp_384` — under-declared. PART A loads the REAL module and asserts
// on it twice: that the reason vocabulary is reachable through the interface at all (`features/` may
// not reach `StateDeriver`, so if this accessor goes the feature must keep its own copy — the exact
// drift this file exists to prevent), and that `blockedReasons()` hands out a FRESH COPY, since a
// caller able to mutate the returned table changes what counts toward a skip for everything
// downstream. Defensive copying is `streammanager.js`'s own behaviour and nothing else's.
// Note the file has TWO sandboxes and StreamManager's status differs between them: real and judged in
// PART A, STUBBED in the feature sandbox below. The stub is not evidence about PART A.
// A BLOCKED DECLARATION CARRIES WHY (J06), AND SINCE J153 THERE ARE TWO REASONS AND BOTH COUNT.
//
//   the two       "blocked for me" and "not allowed" (the owner's two abstractions): the song is
//                 the problem, so each counts toward a skip road
//   absent        REFUSED, with its own code (`no-block-reason`): the untyped report went with
//                 old rooms (the owner's decision 2). A person whose own end failed sends nothing
//   unknown       REFUSED (`unknown-block-reason`), because the token reaches a hashed field
//
// CHANGED AT J153 (`ddjp_720`), AND WHY: the reason axis used to hold a non-counting kind and an
// accepted-untyped case; both are gone by the owner's decision, so the axis now runs over
// {absent, unknown, each token} and the "refused" half of every control is supplied by the two
// refusals rather than by a reason that does not count.
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
  // EXACTLY TWO, BOTH COUNTING (J153, the owner's: "blocked for me, or not allowed / as a abstraction"). A third reason,
  // or one that does not count, is a decision for him and moves the room surface (`check-room-compat`): this row is what
  // makes it a decision rather than an edit. Counted, never spelled.
  ok(COUNTING.length === 2 && LOCAL.length === 0,
    "A: the vocabulary must be the owner's two reasons and both must count. A person reports only when the song's player " +
    "is at fault, never their own end, so a non-counting reason has nothing left to say", { counting: COUNTING, local: LOCAL });

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

  // ── A PLAYER'S MAPPING CANNOT PRODUCE A TOKEN THE FOLD REFUSES ──────────────────────────────
  // Two homes, two questions: the reducer owns *which tokens exist and which count*, each service's player owns *which of
  // its failures means which token* (J29 step 2: YouTube's table moved, unchanged, from MediaBlocked to `ui/youtube.js`).
  // What must hold between them is that the player's RANGE is a subset of the reducer's DOMAIN. Derived by reading the
  // player's own map, so a code added to it tomorrow is checked tomorrow.
  const YTP = require("./_player-world.js").world({}).YouTubePlayer;
  const map = (YTP && YTP._REASON_FOR_CODE) || {};
  const codes = Object.keys(map);
  ok(codes.length >= 3,
    "A: the player-error mapping is implausibly small — a scan that found nothing would report a " +
    "clean subset check", { codes: codes });
  const strays = codes.filter((c) => !Object.prototype.hasOwnProperty.call(REASONS, map[c]));
  ok(strays.length === 0,
    "A: every token a player can report must be one the reducer accepts. A stray one is not a " +
    "cosmetic mismatch: the fold REFUSES an unknown token outright, so the declaration is lost " +
    "entirely rather than merely not counting",
    strays.map((c) => c + " -> " + map[c]));
  // and an unrecognised code yields NO token rather than a guess — reporting an unknown failure as
  // though the song were the problem is the one direction that could force a skip on nothing
  ok(YTP.reasonFor(999999) === null && YTP.reasonFor(undefined) === null,
    "A: an unrecognised player error must map to NO token. Guessing a counting reason from an " +
    "unknown failure is the only direction here that can force a skip the room did not earn",
    { unknown: YTP.reasonFor(999999), absent: YTP.reasonFor(undefined) });
  // AND THE PERSON'S OWN END MAPS TO NONE (J153, the owner's: "if we cant see and its not the players fault we dont send
  // anything"): YouTube's 2 (a bad request), 5 (its HTML5 player) and 153 (no referrer or client identity sent).
  const ownEnd = [2, 5, 153].filter((c) => YTP.reasonFor(c) !== null);
  ok(ownEnd.length === 0,
    "A: YouTube's 2, 5 and 153 are the person's own end or the app's, not the song's, so they map to NO reason and send " +
    "nothing", ownEnd.map((c) => c + " -> " + YTP.reasonFor(c)));
  // AND THE FEATURE, HANDED A REASON, SENDS ONLY ONE THE FOLD KNOWS: an unknown token or none answers null, and a null is
  // sent as nothing at all (J153) — the fold refuses a declaration with no reason or an unknown one.
  const fsb = require("./_load").loadInContext([
    "backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js",
  ], {
    StreamManager: { getState: () => ({ nowPlaying: null, settings: {} }), on() {}, off() {},
                     blockedReasons: () => JSON.parse(JSON.stringify(REASONS)) },
    MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
    Logger: { info() {}, warn() {}, debug() {} }, setTimeout, clearTimeout, Date,
  });
  const MB = fsb.MediaBlocked;
  const known = Object.keys(REASONS)[0];
  ok(MB.countedReason(known) === known && MB.countedReason("no-such-reason") === null && MB.countedReason(null) === null,
    "A: the feature sends a reason the fold knows as itself, and answers null for anything else, which sends nothing — " +
    "the fold refuses an unknown token and a missing one", { known: MB.countedReason(known), unknown: MB.countedReason("no-such-reason") });

  // ── NO REASON, NO REPORT, DRIVEN THROUGH THE REAL MODULE (J153) ─────────────────────────────────────────────────────────
  // `reportCannotSee(pi, null)` and an unknown reason schedule NOTHING and send nothing; a counting reason schedules one report
  // and it carries the reason. And the wire's log line names what happened: "not reported" for no reason, never "scheduling".
  const timers = [], sent = [], said = [];
  const NP = { pi: "$p1", song: { songKey: "yt:AAAAAAAAAAA" } };
  const rsb = require("./_load").loadInContext([
    "backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js",
  ], {
    StreamManager: { getState: () => ({ nowPlaying: NP, settings: {}, advance: null }), on() {}, off() {},
                     blockedReasons: () => JSON.parse(JSON.stringify(REASONS)) },
    MatrixBridge: { getUserId: () => "@me:hs", sendEvent: (ch, type, content) => { sent.push({ type, content }); return Promise.resolve({}); } },
    Logger: { info: (m) => said.push(String(m)), warn() {}, debug() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, Date,
  });
  const R = rsb.MediaBlocked;
  R.init("!ev:hs");
  const t0 = timers.length;
  R.reportCannotSee("$p1", null);
  R.reportCannotSee("$p1", "no-such-reason");
  ok(timers.length === t0 && sent.length === 0,
    "A: `reportCannotSee(pi, null)` and an unknown reason must schedule and send NOTHING (J153: no reason, no report — the room " +
    "refuses a declaration without a reason it knows)", { scheduled: timers.length - t0, sent: sent });
  R.notifyPlayerFailed(null, "yt:AAAAAAAAAAA");
  ok(timers.length === t0 && said.some((m) => /^MediaBlocked: player failed \(no reason\) on pi=\$p1 — not reported/.test(m)) &&
    !said.some((m) => /scheduling/.test(m)),
    "A: a player failure with no reason logs that it was NOT reported, and schedules nothing — a line naming a report that never " +
    "goes out is the second signature", said);
  R.reportCannotSee("$p1", COUNTING[0]);
  for (const fn of timers.slice(t0)) fn();
  ok(timers.length === t0 + 1 && sent.length === 1 && sent[0].type === "ddjp.play.blocked" && sent[0].content.k === COUNTING[0],
    "A CONTROL: a reason the room counts schedules ONE report, and it carries the reason", { scheduled: timers.length - t0, sent: sent });
}

// ══ PART B — THE THREE VERDICTS, DRIVEN, EVERY TOKEN ══════════════════════════════════════════
// The job's Done-when, in order: a counting reason advances a road, a non-counting one does not, an
// untyped declaration does not. Driven over the WHOLE vocabulary rather than one token of each, so
// a token added with the wrong verdict is caught rather than sampled around.
const guestLevel = Ranks.levelOf("guest");
let verdicts = 0;
// THE REFUSAL'S CODE, read from the fold's own record (`deriveRefusals`), for one declaration with reason `k` on a live song.
const F = require("./_fixtures");
function codeOf(k) {
  const room = F.playingRoom({ songs: 2 });
  const pi = room.pis[room.pis.length - 1];
  const d = F.blockedDecl("$code", room.lastL + 1, room.startTs + 1000, pi, guestLevel, "@code:hs", k);
  const refusals = StateDeriver.deriveRefusals(F.sortLog(room.log.concat([d])));
  const r = refusals && refusals["$code"];
  return r ? r.code : null;
}
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

  // ABSENT — REFUSED, WITH ITS OWN CODE (J153; the owner's decision 2). This used to be the mid-flight rule (accepted,
  // counting nothing); old rooms are not supported, and a report now says why or is not a report. The case's declarations
  // are MEANT to be refused, hence the inverted gate.
  const u = measure({ rungLevel: guestLevel, n: need, reason: null });
  const gu = admissible(u, { expectAccepted: false });
  ok(gu.ok, "B: measurement inadmissible for the ABSENT case", gu.problems);
  if (gu.ok) {
    ok(u.accepted === 0 && u.guestPlus === 0 && u.skipWarranted === false && u.escapeAccepted === false,
      "B: a declaration with NO reason must be REFUSED and reach no road. The untyped report went with old rooms (the " +
      "owner's decision 2): accepted, it would be protected and sealed while saying nothing", u);
    ok(codeOf(null) === "no-block-reason",
      "B: an absent reason must be refused with ITS OWN code, `no-block-reason` — not as an unknown one. \"It gave a reason " +
      "the room doesn't know\" would be a false sentence about a report that gave none", { code: codeOf(null) });
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
    ok(codeOf("definitely-not-a-real-reason") === "unknown-block-reason",
      "B: an unknown token keeps its own code, `unknown-block-reason`", { code: codeOf("definitely-not-a-real-reason") });
    ok(bad.skipWarranted === false && bad.escapeAccepted === false,
      "B: an unknown token must reach no road either", bad);
    verdicts++;
  }
}
ok(verdicts >= COUNTING.length + 2,
  "B: fewer verdicts were driven than the vocabulary has entries, so some token was never " +
  "exercised — a loop that filtered to nothing reports a clean sweep of a subset",
  { verdicts: verdicts, expected: COUNTING.length + 2 });

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
// So the assertion is AGREEMENT, at every point on the axis, including the two refusals (absent, unknown). Both
// readings come from ONE fixture per case, so a disagreement cannot be an artefact of two setups.
{
  let compared = 0, sawWarranted = false, sawRefused = false;
  const roads = StateDeriver.defaultSettings().skipRoads || [];
  const need = roads.reduce((m, r) => Math.max(m, (r && r.guestPlus) || 0), 0) || 5;
  const UNKNOWN = "definitely-not-a-real-reason";
  const axis = COUNTING.concat(LOCAL).concat([null, UNKNOWN]);
  for (const k of axis) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r, { expectAccepted: (k !== null && k !== UNKNOWN) });
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
    "C: no axis point REFUSED one, so the agreement was never tested against a report that does " +
    "not count — which is the half this file is for", { compared: compared });
  ok(compared >= 3,
    "C: the axis walk compared too few points to mean anything", { compared: compared });
}
// C2 — THE SAME AGREEMENT THROUGH THE ROOM'S OTHER TABLE (J153). "Skip songs blocked for some people" has its own table,
// read by the same one function (`skipVerdict`) on both sides. The dead-song route is set out of reach (a road of the most
// guests a road may ask for), so every escape this walk sees is the blocked-for-some table's — the reason axis driven through it.
{
  const R = StateDeriver.SETTING_RANGES.skipRoads;
  const SOME = { skipBlockedForSome: true, skipRoads: [{ guestPlus: R.itemMax, vipPlus: 0 }] };
  const someRoads = StateDeriver.defaultSettings().skipBlockedForSomeRoads || [];
  const need = someRoads.reduce((m, r) => Math.max(m, (r && r.guestPlus) || 0), 0) || 5;
  const UNKNOWN = "definitely-not-a-real-reason";
  let compared = 0, sawWarranted = false, sawRefused = false;
  for (const k of COUNTING.concat(LOCAL).concat([null, UNKNOWN])) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k, settings: SOME });
    const g = admissible(r, { expectAccepted: (k !== null && k !== UNKNOWN) });
    ok(g.ok, "C2: measurement inadmissible at axis point `" + String(k) + "`", g.problems);
    if (!g.ok) continue;
    ok(r.skipWarranted === r.escapeAccepted,
      "C2: through the blocked-for-some table, the view and the reducer reach the SAME verdict for reason `" + String(k) + "`",
      { reason: String(k), skipWarranted: r.skipWarranted, escapeAccepted: r.escapeAccepted });
    if (r.skipWarranted === true) sawWarranted = true; else sawRefused = true;
    compared++;
  }
  ok(sawWarranted, "C2: no axis point warranted an escape through the blocked-for-some table, so the agreement is about nothing", { compared });
  ok(sawRefused, "C2: no axis point refused one", { compared });
  const ctl = measure({ rungLevel: guestLevel, n: need, reason: COUNTING[0], settings: { skipRoads: SOME.skipRoads } });
  ok(ctl.accepted === need && ctl.skipWarranted === false && ctl.escapeAccepted === false,
    "C2 CONTROL: the same reports with the switch off warrant nothing, so the escapes above are the blocked-for-some table's", ctl);
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
  for (const k of COUNTING.concat([null])) {
    const r = measure({ rungLevel: guestLevel, n: need, reason: k });
    const g = admissible(r, { expectAccepted: k !== null });
    ok(g.ok, "D: measurement inadmissible for seed case `" + String(k) + "`", g.problems);
    if (!g.ok) continue;
    if (k === null) {
      // A REFUSED DECLARATION IS NOT SEALED: the seed carries no entry for a report with no reason.
      ok(r.seedBlocked && Object.keys(r.seedBlocked).length === 0,
        "D: a declaration the fold refused (no reason) must not reach the seed — a sealed entry would be a tally a genesis " +
        "fold never had", { sealed: r.seedBlocked && Object.keys(r.seedBlocked).length });
      ok(r.seededEscapeAccepted === r.escapeAccepted, "D: and the seeded fold reaches the genesis fold's verdict",
        { fromGenesis: r.escapeAccepted, fromSeed: r.seededEscapeAccepted });
      seedChecks++;
      continue;
    }
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
  ok(seedChecks >= COUNTING.length + 1,
    "D: too few seed cases were driven to have covered each reason and the absent one",
    { seedChecks: seedChecks });
}

if (failures) process.exit(1);
console.log("[blocked-reason] PASS — a blocked declaration carries WHY, from the owner's two reasons, and both count " +
  "toward a room skip (J153); a declaration with NO reason is refused with its own code, `no-block-reason`, and the " +
  "person's own end (YouTube's 2, 5 and 153, any unknown code) maps to no reason and sends nothing. An UNKNOWN token is " +
  "refused outright rather than accepted and ignored, " +
  "because the token is folded into `liveDecl` and so into a checkpoint seed the fingerprint " +
  "commits, and that refusal is what keeps an unbounded string out of a hashed field. The " +
  "vocabulary is DERIVED from `StateDeriver.BLOCKED_REASONS` — no token is spelled in this file or " +
  "its probe — it is reachable by the reporter through the interface rather than restated in the " +
  "feature, and the feature's player-error map is asserted to be a subset of it. The tally's TWO " +
  "copies (the reducer's re-validation and the `advance` view) are driven to the same verdict at " +
  "every point on the reason axis — each reason, absent and unknown — with a control in each direction: that axis is the one " +
  "`check-tier-inclusive` holds constant, so a filter added to one copy and not the other is " +
  "invisible to it, which was measured rather than assumed. And the reason reaches the checkpoint " +
  "SEED, with the seeded fold's verdict driven against the genesis fold's, because the road tally " +
  "is a carry-forward value and a seed that omits it makes a client that forgot count differently " +
  "from one that did not");
