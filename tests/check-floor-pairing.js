// tests/check-floor-pairing.js
//
// THE SEED AND THE HOLDINGS MUST MEET. A client folds its held log onto its floor's seed; if the
// seed sits BELOW the oldest thing the client still has, the fold describes a room that never
// happened — and it does so silently, which is this codebase's signature failure.
//
// WHY THIS IS NOT A GUARD ON `revalidate()`. The route we found is a quorum floor being replaced
// by an older group that still verifies (09-roadmap.md J02). But the damage is the FOLD, not the
// floor position, so a check inside `revalidate` closes one route and leaves the hazard reachable
// by any other path that lowers the pairing. The two things meet in exactly one place —
// `StreamManager._deriveBest` — and that is where the invariant is asserted here.
//
// THE OBVIOUS INVARIANT DOES NOT DISCRIMINATE ON ITS OWN. `f.floorL >= _trimmedBelow` holds while
// the room is broken, because the boundary FOLLOWS the floor down: the replacement emits `moved`,
// matrixbridge's trim subscriber acts on `moved`, and `trimToFloor` writes `_trimmedBelow` on its
// early-exit path too. Both halves move together, so comparing them proves nothing until
// `_trimmedBelow` is monotonic. PART C is what pins the monotonicity; PART A would pass without it
// for the wrong reason, so PART A asserts on DERIVED STATE instead of on the two numbers.
//
// ── THE TRAP IN THIS JOB, MEASURED ───────────────────────────────────────────────────────────
// The damage is DEFERRED TO THE NEXT FOLD. `trimToFloor`'s early exit writes the boundary and
// returns WITHOUT re-folding, so immediately after a downward move the room still shows the state
// it folded against the OLD seed and looks entirely healthy. Driven:
//
//     after downward move   nowPlaying $play7   history 2    <- still correct
//     after ONE more fold   nowPlaying $play1   history 0    <- collapse, nothing thrown
//
// So an assertion placed right after the move PASSES, on a room that is already broken. Every part
// below that judges derived state folds once more first, and says so where it does it.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[floor-pairing] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

// The sandbox must load every module the subject consults. `seedLicensesForget` contains an
// absent-engine fallback (`typeof SettingsProof === "undefined" -> return true`) which is correct
// in production and would certify the inverse here, so settingsproof.js is loaded rather than
// omitted. Floor is loaded because the floor has ONE home and a guard planting it anywhere else
// tests a state production never holds.
const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/settingsproof.js",
  "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, Floor, SettingsProof } = C;

// Every room states its own rules — the owner posts a complete settings blob at creation — so a
// log without one models a room that cannot exist, and the proof path correctly refuses it.
const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
  F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));

const TOP_TS = Math.max.apply(null, LOG.map((e) => e.ts));
const TOP_L = Math.max.apply(null, LOG.map((e) => e.l));

// TWO CUTS. HIGH is what we trimmed to; LOW is the older group that still verifies.
const HIGH_CUT = 14, LOW_CUT = 6;
function cutAt(n, grade) {
  const below = LOG.slice(0, n);
  return { n: 1, prev: null, seed: StateDeriver.buildSeed(below), h: "h" + n,
           covers: below[0].eventId + ".." + below[below.length - 1].eventId,
           floorL: below[below.length - 1].l, by: "@owner:hs", grade: grade };
}
const HIGH = cutAt(HIGH_CUT, "quorum"), LOW = cutAt(LOW_CUT, "quorum");

function proveSettings(seed, atL) {
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markGenesisReached();
  return SettingsProof.proveClaim({ claimed: seed.settings, settingsFrom: seed.settingsFrom,
                                    atL: atL, floorL: atL });
}
function feed() {
  StreamManager.reset();
  // ROOM ENTRY RESETS THE FLOOR TOO, AND SINCE J03 THAT MATTERS HERE. `_initModules` calls
  // `StreamManager.reset()` and then `resetCheckpoints()` -> `Floor.reset()`; a helper that resets
  // only the first models a client that cannot exist. It also fails in a way that reads as a
  // finding rather than as a harness fault: the ingest gate now derives its ACCEPTED boundary from
  // `Floor.current()`, so a floor inherited from the part above silently refuses this fixture's
  // genesis settings event, which costs the settings reading, which costs the licence, which means
  // nothing trims — and the failure surfaces three steps from its cause.
  Floor.reset();
  SettingsProof.reset();
  SettingsProof.attach({ now: () => Date.now(), pageSettings: null });
  for (const e of LOG) StreamManager.ingest(F.toRaw(e));
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  proveSettings(HIGH.seed, HIGH.floorL);
}

// FOLD ONCE MORE, the way an ordinary arrival does. The timestamp must sit ABOVE the room's own —
// a probe that used ts=9999 in a room running at ~300000 drove the head's stamp BACKWARDS, and the
// ordering rule then refused the next arrival for a reason that had nothing to do with the floor.
// The wrong verdict read exactly like a finding.
let _n = 0;
function foldOnce() {
  _n++;
  StreamManager.ingest(F.toRaw(F.reducerEvent("$fold" + _n, TOP_L + _n, TOP_TS + 1000 * _n,
    "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGZ" })));
}
const pi = (s) => String(s.nowPlaying && s.nowPlaying.pi);

// ── PART A: a seed below the holdings must not silently produce a plausible room ──────────────
{
  feed();
  const untrimmed = StreamManager.getState();
  ok(untrimmed.nowPlaying, "A: APPLIED — the untrimmed room must actually be playing something");
  ok(StreamManager.getLog().length === LOG.length,
    "A: APPLIED — the whole log must be held before any trim");

  Floor._setTrustedForTest(HIGH);
  ok(StreamManager.trimToFloor() > 0,
    "A: APPLIED — trimming to the HIGH floor must actually drop events, or nothing below is reached");
  const truth = StreamManager.getState();
  const oldestHeld = Math.min.apply(null, StreamManager.getLog().map((e) => e.l));
  ok(oldestHeld > HIGH.floorL,
    "A: APPLIED — after the trim the client genuinely holds nothing at or below the HIGH cut",
    { oldestHeld: oldestHeld, cut: HIGH.floorL });

  // The downward move. In production this is `revalidate()` replacing the floor with an older
  // group and emitting `moved`, which the trim subscriber acts on — so this is the same call
  // production makes next, with the floor planted through Floor's own seam.
  Floor._setTrustedForTest(LOW);
  StreamManager.trimToFloor();

  // See the header: asserting HERE would pass on a room that is already broken.
  foldOnce();
  const after = StreamManager.getState();

  ok(pi(after) === pi(truth),
    "A: after the floor moves BELOW what this client still holds, the room must not report a " +
    "state from the past — the seed and the holdings do not chain, so the fold describes a room " +
    "that never happened",
    { truth: pi(truth), after: pi(after), seedAt: LOW.floorL, oldestHeld: oldestHeld });

  ok((after.history || []).length >= (truth.history || []).length,
    "A: and the history must not empty itself — an empty pane beside a live now-playing is the " +
    "measured signature of a seed the holdings cannot reach",
    { truth: (truth.history || []).length, after: (after.history || []).length });
}

// ── PART B: the ingest gate must still refuse what the OLD cut banked ────────────────────────
// The second half of the damage, and it is independent of the fold: the banked-arrival check keys
// on `_trimmedBelow`, so lowering the boundary re-opens the door for events below the old cut and
// the client folds again what a checkpoint already accounted for.
{
  feed();
  Floor._setTrustedForTest(HIGH);
  StreamManager.trimToFloor();
  Floor._setTrustedForTest(LOW);
  StreamManager.trimToFloor();

  const banked = LOG.filter((e) => e.l > LOW.floorL && e.l <= HIGH.floorL);
  ok(banked.length >= 1,
    "B: APPLIED — the fixture must actually contain events between the two cuts", banked.length);
  ok(!StreamManager.getLog().some((e) => e.eventId === banked[0].eventId),
    "B: APPLIED — that event must genuinely be absent from the held log before we re-offer it");

  StreamManager.ingest(F.toRaw(banked[0]));
  ok(!StreamManager.getLog().some((e) => e.eventId === banked[0].eventId),
    "B: an arrival the OLD cut already banked must stay refused at the door after the floor " +
    "moves down — re-folding it counts it a second time against a seed that already includes it",
    { l: banked[0].l, oldCut: HIGH.floorL, newFloor: LOW.floorL });
}

// ── PART C: the forget boundary may only RISE within a room ──────────────────────────────────
// `_trimmedBelow` records what is already destroyed. Lowering it is not a policy change, it is a
// false statement — the client then claims to hold what it threw away. This is the rule
// `Floor.adopt` already applies to the floor (`_pos(f) <= _pos(_trusted)` refuses a
// non-improvement), applied to the boundary, and it is what makes PART A's invariant expressible
// as two numbers rather than only as derived state.
{
  feed();
  Floor._setTrustedForTest(HIGH);
  StreamManager.trimToFloor();
  ok(StreamManager._trimState() === HIGH.floorL,
    "C: APPLIED — the boundary must be at the HIGH cut before the move",
    { boundary: StreamManager._trimState(), cut: HIGH.floorL });

  Floor._setTrustedForTest(LOW);
  StreamManager.trimToFloor();
  ok(StreamManager._trimState() === HIGH.floorL,
    "C: the forget boundary must not follow the floor down — it records what is already gone, " +
    "and lowering it claims back what was destroyed",
    { boundary: StreamManager._trimState(), was: HIGH.floorL, floorNow: LOW.floorL });

  // AND ITS PARTNER MOVES WITH IT OR NOT AT ALL. A boundary at one position carrying an id from
  // another is worse than either alone: the ingest gate's tiebreak at `el === _trimmedBelow`
  // compares `event_id` against the boundary id, so a mismatched pair silently admits or refuses
  // the wrong siblings at the boundary position.
  //
  // THIS ASSERTION USED TO READ `_trimState()` TWICE AND SAY "id" IN ITS MESSAGE. `_trimState()`
  // returns the POSITION only, so the id could not have been observed at all — it restated the
  // assertion above it while appearing to add one, and the mutation that splits the pair survived
  // it. Predicting a decorative assertion is not the same as not writing one.
  //
  // Driven through the DOOR that reads the field rather than through a new test-only accessor:
  // after the refused lowering the boundary is the HIGH cut ($play5). An arrival AT that position
  // whose id sorts between the two cuts' ids is banked when the pair is intact, and admitted the
  // moment the id comes from the LOW cut ($play1) instead.
  feed();
  Floor._setTrustedForTest(HIGH);
  StreamManager.trimToFloor();
  Floor._setTrustedForTest(LOW);
  StreamManager.trimToFloor();
  ok(StreamManager._trimState() === HIGH.floorL,
    "C: APPLIED — the boundary must still be at the HIGH cut for the tiebreak to be under test",
    StreamManager._trimState());

  const hiId = String(HIGH.covers).split("..")[1];
  const loId = String(LOW.covers).split("..")[1];
  const between = "$play2x";                       // loId < between <= hiId, lexicographically
  ok(loId < between && between <= hiId,
    "C: APPLIED — the probe id must actually sit between the two cuts' ids, or the tiebreak " +
    "cannot distinguish them", { loId: loId, between: between, hiId: hiId });

  // THE TIMESTAMP MUST BELONG TO THE POSITION. An arrival at l=14 stamped LATER than the head at
  // l=19 is refused by the backdating rule before the tiebreak is ever consulted — and the guard
  // then reads green while proving nothing. That mistake was made twice in this job, once in a
  // probe and once here, so the stamp is taken from the event that actually sits at this position.
  const tsAtBoundary = LOG.find((e) => e.l === HIGH.floorL).ts;

  // POSITIVE CONTROL FIRST. A sibling at the boundary position whose id sorts ABOVE the boundary
  // id is genuinely still needed and must be ADMITTED. Without this, a refusal below could come
  // from any door upstream — dedupe, ordering, rank — and still read as the tiebreak working.
  const above = "$playZZ";
  ok(above > hiId, "C: APPLIED — the control id must sort above the boundary id", { above: above, hiId: hiId });
  StreamManager.ingest(F.toRaw(F.reducerEvent(above, HIGH.floorL, tsAtBoundary,
    "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGZ" })));
  ok(StreamManager.getLog().some((e) => e.eventId === above),
    "C: APPLIED — a sibling ABOVE the boundary id must still get in, or the refusal below is not " +
    "the tiebreak's doing", { admitted: false, at: HIGH.floorL });

  StreamManager.ingest(F.toRaw(F.reducerEvent(between, HIGH.floorL, tsAtBoundary,
    "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGZ" })));
  ok(!StreamManager.getLog().some((e) => e.eventId === between),
    "C: the boundary id and its position must come from the SAME cut — an arrival at the boundary " +
    "position is judged against the boundary id, so a pair split across two cuts admits events a " +
    "checkpoint already banked",
    { boundary: StreamManager._trimState(), expectedId: hiId, staleId: loId, arrival: between });
}

// ── PART D: a room change still clears the boundary ──────────────────────────────────────────
// Monotonic WITHIN a room. `reset()` clearing it is correct and must stay — a new room inheriting
// a boundary would fold seeded against a floor it never had and still produce a room-shaped
// answer. CONCEPTS.md §3.11 lists per-room state survivng a room change as a recurring bug class.
{
  feed();
  Floor._setTrustedForTest(HIGH);
  StreamManager.trimToFloor();
  ok(StreamManager._trimState() !== null, "D: APPLIED — a boundary must exist before the reset");
  StreamManager.reset();
  ok(StreamManager._trimState() === null,
    "D: a room change clears the forget boundary — monotonic within a room, never across one",
    { boundary: StreamManager._trimState() });
}

// ── PART E: a weakening floor must ANNOUNCE, so the client goes back for another ─────────────
// Found by mutation, not by design: with monotonicity and the pairing check in place, deleting
// the downward-move refusal in `Floor.revalidate` left every part above GREEN. The state stays
// safe — the boundary will not drop and the fold refuses — but the move announces `moved`, which
// only the TRIM subscriber reads, so the re-page subscriber never fires and the client sits there
// safe and STUCK. "Does not accept a mark beneath its holdings" and "goes back for history" are
// two properties, and the parts above only prove the first.
//
// Driven through the real path: a quorum is remembered, the chain stops verifying, and an older
// group still does. This is `revalidate()`'s own selection, not a planted floor.
{
  const seg = (n) => LOG.slice(0, n);
  const sealAt = (n, author) => {
    const s = seg(n), last = s[s.length - 1];
    const seed = StateDeriver.buildSeed(s);
    const covers = s[0].eventId + ".." + last.eventId;
    const h = Floor.fingerprint(1, null, seed, last.l, false, covers);
    return { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, h: h,
             covers: covers, floorL: last.l, thin: false, by: author };
  };

  const emitted = [];
  Floor.reset();
  Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => F.RANK.staff,
                 trimmed: () => true });
  Floor.onChange((e) => emitted.push(e));

  // An older group that still verifies, at LOW_CUT.
  Floor.remember(sealAt(LOW_CUT, "@hs1:hs"), F.RANK.highStaff, "@hs1:hs", 1000);
  Floor.remember(sealAt(LOW_CUT, "@hs2:hs"), F.RANK.highStaff, "@hs2:hs", 1001);
  Floor.remember(sealAt(LOW_CUT, "@hs3:hs"), F.RANK.highStaff, "@hs3:hs", 1002);

  // And we currently stand on a HIGHER one.
  Floor._setTrustedForTest({ n: 1, prev: null, seed: HIGH.seed, h: HIGH.h, covers: HIGH.covers,
                             floorL: HIGH.floorL, by: "@hs1:hs", grade: "quorum" });

  // ASSERT THE FIXTURE REACHES THE BRANCH UNDER TEST. The first version of this part used
  // `F.RANK.highstaff`, which is undefined — the key is `highStaff` — so every checkpoint was
  // remembered at the weakest tier, `select` returned null, and this exercised the
  // "nothing verifies" branch while reading as though it tested the replacement one. It passed,
  // and the mutation that deletes the refusal survived it. An emission-count check is not enough:
  // the wrong branch emits too. This is the check that distinguishes them.
  const sel = Floor.select(F.RANK.staff, {}, (q) => Floor.chainVerifies(q, LOG));
  ok(sel && sel.floor && sel.floor.floorL < HIGH.floorL,
    "E: APPLIED — the search must actually offer an OLDER verifying group, or the replacement " +
    "branch is never reached and everything below tests the wrong exit",
    sel ? { offered: sel.floor.floorL, standingOn: HIGH.floorL } : null);

  const r = Floor.revalidate();
  ok(Floor.position() >= HIGH.floorL || Floor.grade() === "stale",
    "E: revalidate must not leave the floor standing BELOW where it already computed from",
    { position: Floor.position(), was: HIGH.floorL, grade: Floor.grade(), r: r });
  ok(emitted.length > 0, "E: APPLIED — revalidate must actually have announced something", r);
  ok(!emitted.some((e) => e.kind === "moved"),
    "E: a floor that can only be replaced by an OLDER one has weakened, not moved — announcing " +
    "`moved` reaches the trim subscriber and never the re-page one, which leaves the client safe " +
    "and permanently stuck instead of going back for a floor",
    emitted.map((e) => e.kind));
  ok(emitted.some((e) => e.kind === "demoted" || e.kind === "withdrawn"),
    "E: it must announce on the kind the re-page subscriber actually reads",
    emitted.map((e) => e.kind + ":" + (e.reason || "")));
}

// ── PART F: the boundary must still RISE when nothing sits above the floor ───────────────────
// Also found by mutation. `trimToFloor`'s early exit is the quietest line in the chain — the one a
// reader skips — and with monotonicity in place, deleting its boundary write left every part above
// green, because the only thing that write was doing in those scenarios was the LOWERING that
// monotonicity now refuses. It still has a real job: a client that adopts a floor with nothing
// above it has forgotten up to that floor and must say so, or the ingest gate never closes.
{
  // THE EARLY EXIT IS REACHED WHEN NOTHING SITS AT OR BELOW THE FLOOR. In a dense log that means
  // the held log is EMPTY — which is not exotic: it is a client caught up to its own floor, and
  // the ordinary state of a thin one. The first version of this part planted a floor at the top of
  // a non-empty log and took the REAL trim path instead, asserting nothing about the early exit
  // while reading as though it did. The APPLIED check below is what caught that.
  feed();
  const topL = Math.max.apply(null, StreamManager.getLog().map((e) => e.l));
  Floor._setTrustedForTest({ n: 2, prev: null, seed: HIGH.seed, h: "htop",
                             covers: HIGH.covers, floorL: topL, by: "@owner:hs", grade: "quorum" });
  StreamManager.trimToFloor();
  ok(StreamManager.getLog().length === 0,
    "F: APPLIED — the log must be empty, or the early exit is not the path under test",
    StreamManager.getLog().length);
  ok(StreamManager._trimState() === topL, "F: APPLIED — and the boundary sits at that floor");

  // Now a HIGHER floor with an empty log: nothing to drop, so the early exit is taken.
  const higher = topL + 10;
  Floor._setTrustedForTest({ n: 3, prev: null, seed: HIGH.seed, h: "hhigher",
                             covers: HIGH.covers, floorL: higher, by: "@owner:hs", grade: "quorum" });
  const dropped = StreamManager.trimToFloor();
  ok(dropped === 0, "F: APPLIED — this must be the early-exit path, dropping nothing", dropped);
  ok(StreamManager._trimState() === higher,
    "F: adopting a floor with nothing above it still RAISES the forget boundary — the client has " +
    "forgotten up to there, and a boundary that does not follow leaves the ingest gate open for " +
    "events that floor already banked",
    { boundary: StreamManager._trimState(), floor: higher });
}

// ── PART G: WHAT THE LICENCE STILL GUARANTEES, AND WHAT J35 TOOK AWAY ─────────────────────────
// THIS PART USED TO BE A TRIPWIRE, AND IT HAS FIRED. It pinned J02's precondition — *a client that
// cannot establish a settings reading must not trim at all* — because `_refuseUnpaired` prefers the
// last fold whose seed and holdings met, and that preference was only obviously right while such a
// fold was GUARANTEED to exist. The guarantee was a property of the licence chain, not of the
// fallback:
//
//   a client that never established a settings reading never earned the forget licence
//     -> so it never trimmed, so `_trimmedBelow` stayed null
//     -> so `_deriveBest` never took the seeded branch, so it never reached the violation.
//
// J35 wired `SettingsProof.readBack`, so a thin or post-trim client can now READ its way to the
// licence. The sentence above is therefore false in production, and this part asserts the
// consequence instead of the precondition. The re-decision it demanded is written where the
// preference lives (`streammanager.js`, `_refuseUnpaired`): the order stands, for a different
// reason — the branches are ordered by truthfulness, and the empty answer is never silent. That
// second half is a property of the code, so it is DRIVEN below rather than described there.
{
  StreamManager.reset();
  Floor.reset();      // room entry resets both; see the note on feed() above
  SettingsProof.reset();
  SettingsProof.attach({ now: () => Date.now(), pageSettings: null });

  // G1 — WHAT SURVIVES. The licence still gates the trim, and a client that can neither read nor
  // page still forgets nothing. Fails closed, which is why nothing was broken before J35 and is
  // still the behaviour when the homeserver will not answer.
  const recent = LOG.filter((e) => e.l >= 15);
  for (const e of recent) StreamManager.ingest(F.toRaw(e));
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));

  ok(StreamManager.getLog().length === recent.length,
    "G: APPLIED — the partial log must actually have landed", StreamManager.getLog().length);
  ok(!StreamManager.getLog().some((e) => e.type === "ddjp.room.settings"),
    "G: APPLIED — and it must genuinely contain no settings event, or the client could read one");

  Floor._setTrustedForTest(LOW);
  const dropped = StreamManager.trimToFloor();
  ok(dropped === 0 && StreamManager._trimState() === null,
    "G: a client that can neither establish a settings reading NOR page for one still does not " +
    "trim. J35 gave it a way to earn the licence; it did not lower the bar, and a client with no " +
    "pager attached is exactly the case that must still fail closed",
    { dropped: dropped, boundary: StreamManager._trimState() });
  ok(StreamManager.pairingFault() === null,
    "G: APPLIED — and it never reached the seeded branch, so no fault was recorded",
    StreamManager.pairingFault());
}
{
  // G2 — WHAT J35 TOOK AWAY, DRIVEN. The same client, given a pager, reads its way to the licence
  // and trims — which is what removes the guarantee that a last-good fold exists. This is the
  // assertion that replaces the tripwire: it pins the NEW state of the world, so the next person to
  // change the licence chain meets a red here rather than a silent change of J02's footing.
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  const settingsEvents = LOG.filter((e) => e.type === "ddjp.room.settings");
  ok(settingsEvents.length > 0,
    "G: APPLIED — setup: the fixture has a settings event for the pager to return", settingsEvents.length);
  SettingsProof.attach({ now: () => Date.now(), pageSettings: async () => settingsEvents });
  SettingsProof.markReadFrom(HIGH.floorL);
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  Floor._setTrustedForTest(HIGH);

  const beforeProof = SettingsProof.proveClaim({ claimed: HIGH.seed.settings,
    settingsFrom: HIGH.seed.settingsFrom, atL: HIGH.floorL, floorL: HIGH.floorL,
    floorNames: HIGH.seed.settingsFrom });
  ok(beforeProof.status === "unverifiable" && SettingsProof.licensesForget() === false,
    "G: APPLIED — setup: with no reading, the licence is withheld", beforeProof);

  // ── AND THE FILE'S VERDICT WAITS FOR IT ──────────────────────────────────────────────────
  // `readBack` is async, so a first version of this let the PASS line print before these assertions
  // ran — a guard reporting success ahead of its own checks, which is the same shape as an
  // assertion placed before the fold it judges. The summary is inside the chain for that reason.
  // The WIRING that calls this from a floor change is `check-settings-readback` PART C's subject,
  // not this file's; here the pager is called directly.
  SettingsProof.readBack(0).then(() => {
    const after = SettingsProof.proveClaim({ claimed: HIGH.seed.settings,
      settingsFrom: HIGH.seed.settingsFrom, atL: HIGH.floorL, floorL: HIGH.floorL,
      floorNames: HIGH.seed.settingsFrom });
    ok(after.status === "validated" && SettingsProof.licensesForget() === true,
      "G: a client that PAGES for its reading earns the licence. This is the precondition J35 " +
      "removed by design — from here a client can trim without ever having folded a sound room, " +
      "which is why the fallback in _refuseUnpaired was re-decided rather than inherited", after);

    // G3 — AND THE NEWLY-REACHABLE BRANCH IS HONEST. A client holding NOTHING trims 0 but still
    // raises the boundary (the early-exit path writes it), so `_lastGoodFold` is null. A floor
    // below that boundary then reaches `_refuseUnpaired` with nothing to hold — the case the old
    // precondition made impossible.
    StreamManager.trimToFloor();
    ok(StreamManager._trimState() === HIGH.floorL,
      "G: APPLIED — the boundary rose on an empty log, with no fold having happened",
      StreamManager._trimState());

    Floor._setTrustedForTest(LOW);
    StreamManager.ingest(F.toRaw(F.reducerEvent("$gfold", TOP_L + 500, TOP_TS + 500000,
      "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGZ" })));
    const st = StreamManager.getState();
    ok(!st.nowPlaying,
      "G: with no last-good fold to hold, the answer is EMPTY rather than a room folded from a seed " +
      "that cannot chain onto the holdings. An empty derive is not a lie about the past; a " +
      "fabricated room is, and only the second reaches the UI as a plausible story", pi(st));
    ok(StreamManager.pairingFault() !== null,
      "G: and the emptiness is ATTRIBUTABLE. This is what the re-decided preference now rests on: " +
      "`pairingFault()` names both numbers, so 'empty because I cannot account for the room' stays " +
      "distinguishable from 'empty because nothing has played'. Without it the honest answer and " +
      "the signature failure of this codebase look identical",
      StreamManager.pairingFault());
    const f = StreamManager.pairingFault();
    ok(f && f.seedAt === LOW.floorL && f.boundary === HIGH.floorL,
      "G: APPLIED — and it names the two numbers that disagree, not just that they did",
      f);

  console.log("[floor-pairing] PASS — the seed a client folds onto and the log it still holds must " +
    "meet: a floor that moves BELOW the boundary this client already forgot past cannot be folded " +
    "against its holdings, because the result is a plausible room that never happened rather than " +
    "an error (measured: now-playing six songs stale, history empty, nothing thrown, and the " +
    "collapse deferred to the NEXT fold so an assertion placed at the move itself passes); the " +
    "forget boundary may only RISE within a room, since it records what is already destroyed and " +
    "lowering it re-opens the ingest gate for events a checkpoint already banked; its id partner " +
    "moves with it or not at all; a weakening floor ANNOUNCES on the kind the re-page subscriber " +
    "reads, so the client goes back for history rather than sitting safe and stuck; adopting a " +
    "floor with nothing above it still raises the boundary; a room change still clears it; and the " +
    "licence chain NO LONGER guarantees a last-good fold exists — J35 wired SettingsProof.readBack, " +
    "so a client that pages for its settings reading earns the licence and can trim without ever " +
    "having folded a sound room. What was a tripwire is now the consequence, pinned: a client that " +
    "can neither read nor page still fails closed, and the newly-reachable no-last-good-fold branch " +
    "answers EMPTY and records a pairing fault naming both numbers, so the honest answer stays " +
    "distinguishable from the plausible-room failure this whole file exists to catch.");
  });
}
