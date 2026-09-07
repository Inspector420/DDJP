// tests/check-derived-log-bound.js
// WALL: THERE ARE TWO MEMORIES AND ONLY ONE WAS EVER BOUNDED.
//
//   EventCache            raw copies, for vouching and refusing redactions   — 200 MB, three tiers
//   StreamManager.eventLog  the derived log, re-sorted and re-folded on EVERY ingest — unbounded,
//                           cleared only on room change
//
// "Hold everything since my floor" has to mean both. Bounding only the cache leaves RAM growing and
// CPU climbing: a long-lived room re-derives its entire history dozens of times a minute.
//
// TRIMMING IS GATED ON THE GRADE, and the gate is the one that already decides forgetting:
// `earnsForget`. Since Step 12 that is "real" (I computed it), "verified" (an owner floor) AND
// "quorum" (a substitute whose members chain into each other). It is NOT "stale" — the grade a quorum
// floor is demoted to when it stops verifying under a client that has already forgotten below it.
//
// That demotion is the answer to a collision this guard used to assert could not happen. Step 7 can
// withdraw a floor whose quorum stops chaining, and a client that had trimmed below a withdrawn floor
// could not re-derive: records carry no `sender` and the reducer needs one. Before Step 12 the two
// features never met, because a substitute earned no forgetting. Now they do, so:
//   not trimmed -> withdraw, as before. Falling back to folding what we hold is safe.
//   trimmed     -> demote to "stale", keep the floor as the compute base, flag a re-page.
// PART C pins both ends.
// Guarantees:
//   PART A — trimming does not change what the room believes. The whole point is that it is invisible.
//   PART B — a forget-earning floor bounds the log; the events below it go.
//   PART C — a substitute floor bounds the log TOO (quorum earns forgetting since Step 12), and
//            what is pinned is that the overlap with re-validation has ONE answer, not two.
//            This line used to describe the pre-Step-12 rule and so contradicted PART C's own
//            body — and a header is what a reader checks first, so it agreed with the equally
//            stale paragraph in streammanager.js and the two of them read as corroboration.
//   PART D — the log stays correctly ordered across an out-of-order arrival, trimmed or not.
//   PART E — trimming never outruns the floor: the boundary event itself and everything above stay.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[derived-log-bound] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
const carry = (s) => canon({ nowPlaying: s.nowPlaying, rotation: s.rotation, tick: s.tick, counts: s.counts });

// THE SANDBOX MUST LOAD EVERY MODULE THE SUBJECT CONSULTS. This list omitted settingsproof.js,
// and seedLicensesForget contains `if (typeof SettingsProof === "undefined") return true` — an
// absent-engine fallback that is correct in production and fatal in a harness. This guard was
// therefore exercising trimming in a world where the blocking half did not exist, and stayed green
// while trimToFloor returned 0 in every real room. Omitting a dependency does not merely fail to
// cover it; it can certify the opposite.
//
// Floor is loaded for the same reason: the floor has ONE home now, and a guard that plants it
// anywhere else tests a state production never holds.
const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/settingsproof.js",
  "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, TrustPolicy, Floor, SettingsProof } = C;

// EVERY ROOM STATES ITS OWN RULES. Since the owner posts a complete settings blob at creation,
// a room whose seed names no settings event cannot exist any more — and the proof path correctly
// answers "unverifiable" for one, which withholds the forget licence. A fixture without a settings
// event therefore models a room that is not reachable, and would only pass here by way of the
// absent-engine fallback this guard's sandbox no longer relies on.
//
// So the genesis event is prepended and the room's own clocks shift up by one, exactly as they
// would in a real room where the settings write is the first thing in the log.
const SETTINGS_BLOB = StateDeriver.defaultSettings();
const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: SETTINGS_BLOB }),
].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
  F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
const CUT = 7;                       // one more than before: the genesis event took a slot
const BELOW = LOG.slice(0, CUT), ABOVE = LOG.slice(CUT);
const SEED = StateDeriver.buildSeed(BELOW);
const BOUNDARY_L = BELOW[BELOW.length - 1].l;

// A floor of a given grade, planted directly. Adoption needs a quorum and a transport; what is
// under test is what the LOG does once a floor of that grade exists.
function floor(grade) {
  return { n: 1, prev: null, seed: SEED, h: "hhhhhhhh", covers: BELOW[0].eventId + ".." + BELOW[BELOW.length - 1].eventId,
           floorL: BOUNDARY_L, by: "@owner:hs", grade: grade };
}
// _fixtures builds REDUCER events; StreamManager.ingest takes RAW ones. The library says so at the
// top and warns that conflating the two "generates confident wrong reports" — it does: the first
// version of this fed reducer events straight in, every one was dropped as unparseable, and the room
// derived to nothing while the APPLIED check reported it honestly.
function feed(events) {
  StreamManager.reset && StreamManager.reset();
  // ROOM ENTRY RESETS THE FLOOR TOO, AND SINCE J03 THAT MATTERS HERE. `_initModules` calls
  // `StreamManager.reset()` and then `resetCheckpoints()` -> `Floor.reset()`; a helper that resets
  // only the first models a client that cannot exist. It also fails in a way that reads as a
  // finding rather than as a harness fault: the ingest gate now derives its ACCEPTED boundary from
  // `Floor.current()`, so a floor inherited from the part above silently refuses this fixture's
  // genesis settings event, which costs the settings reading, which costs the licence, which means
  // nothing trims — and the failure surfaces three steps from its cause.
  Floor.reset();
  // A fresh room means a fresh reading. Attached once per feed, before anything is ingested.
  SettingsProof.reset();
  SettingsProof.attach({ now: () => Date.now(), pageSettings: null });
  for (const e of events) StreamManager.ingest(F.toRaw(e));
  // GRANT THE SEED LICENCE. Trimming needs the floor's grade AND a seed that validated against a
  // genesis fold — the ordering that stops a client bounding its derived log and then never being
  // able to shed a raw copy. Staging that cross-check here would be testing the licence rather than
  // the trim, so it is granted explicitly; check-forget-wiring PART B is where the gate itself is
  // asserted, including that a client without the licence keeps its whole log.
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  proveSettings(SEED, BOUNDARY_L);
}

// THE SETTINGS HALF — PROVED, NOT ABSENT. The seed licence above is granted explicitly because
// staging a genesis cross-check here would be testing the licence rather than the trim. The
// settings claim is a different case: it is cheap to satisfy honestly, and satisfying it by
// leaving the engine out of the sandbox is precisely what hid the fact that forgetting never ran.
// One helper, so a part that plants its own floor cannot quietly skip the precondition.
//
// IT ACCUMULATES, IT DOES NOT RESET. The first version reset the reading on every call, and from
// the second floor onward the claim stopped verifying — because the trim had already removed the
// settings event from the LOG, so re-reading the log found nothing. That is not a harness quirk:
// it is the reason SettingsProof keeps its own copy of what it has read, and the reason EventCache
// pins the named settings event as never-forget. A helper that re-reads the log each time models a
// client that forgets its own evidence.
function proveSettings(seed, atL) {
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markGenesisReached();
  return SettingsProof.proveClaim({ claimed: seed.settings, settingsFrom: seed.settingsFrom,
                                    atL: atL, floorL: atL });
}

// ── PART A: trimming must not change what the room believes ──────────────────────────────────
{
  feed(LOG);
  const before = StreamManager.getState();
  ok(before && before.nowPlaying, "A: APPLIED — the untrimmed room must actually be playing something", before && before.nowPlaying);
  const fullLen = StreamManager.getLog().length;
  ok(fullLen === LOG.length, "A: APPLIED — the whole log must be held before any trim", { held: fullLen, whole: LOG.length });

  Floor._setTrustedForTest(floor("verified"));
  StreamManager.trimToFloor();
  const after = StreamManager.getState();
  ok(carry(after) === carry(before),
    "A: the room's state must be identical after trimming — the trim is a memory change, not a truth change",
    { before: before.nowPlaying, after: after.nowPlaying });

  // AND THE STATE MUST BE RE-DERIVED AT THE TRIM, not left until something else arrives. The check
  // above passes on a stale value if trimming only drops events: the state in hand was folded from a
  // log that no longer exists, and the first fold afterwards is what exposes it. Verified by mutation
  // — without the re-derive, both this part and the seeded-path branch read as green.
  StreamManager.ingest(F.toRaw(F.reducerEvent("$after", LOG[LOG.length - 1].l + 1, 9999,
    "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGZ" })));
  const later = StreamManager.getState();
  ok(StreamManager.getLog().some((e) => e.eventId === "$after"),
    "A: APPLIED — the follow-up event must actually have landed, or no fold ran at all");
  ok(later.nowPlaying && String(later.nowPlaying.pi) === String(before.nowPlaying.pi),
    "A: the room is still on the same track after a post-trim fold — it continued from the floor " +
    "rather than starting over from an empty room, which is what a fold from genesis would now give",
    { before: before.nowPlaying.pi, later: later.nowPlaying && later.nowPlaying.pi });
}

// ── PART B: a forget-earning floor bounds the log ────────────────────────────────────────────
{
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  const trimmed = StreamManager.trimToFloor();
  const held = StreamManager.getLog();
  ok(trimmed === LOG.length - ABOVE.length,
    "B: trimToFloor must report how many events it dropped", { dropped: trimmed, expected: LOG.length - ABOVE.length });
  ok(held.length === ABOVE.length,
    "B: the derived log is bounded to what sits above the floor", { held: held.length, above: ABOVE.length });
  ok(held.every((e) => e.l > BOUNDARY_L),
    "B: and nothing at or below the floor's position survives", held.map((e) => e.l));

  // The same must hold for a floor I computed myself.
  feed(LOG);
  Floor._setTrustedForTest(floor("real"));
  StreamManager.trimToFloor();
  ok(StreamManager.getLog().length === ABOVE.length, "B: a floor I computed myself bounds it too");
}

// ── PART C: a substitute floor bounds it too now, and the collision is handled ───────────────
// This part used to assert that a substitute floor trims NOTHING, and that the disjointness between
// "earns forgetting" and "can be withdrawn" was what made trimming safe beside Step 7. STEP 12
// REMOVED THAT DISJOINTNESS on purpose: "quorum" now earns forgetting, so a substitute floor bounds
// the log like any other. The property worth guarding is no longer that the sets do not overlap — it
// is that the overlap has ONE answer instead of two.
{
  feed(LOG);
  Floor._setTrustedForTest(floor("quorum"));
  const trimmed = StreamManager.trimToFloor();
  ok(trimmed === LOG.length - ABOVE.length,
    "C: a substitute floor bounds the log too — this is Step 12", trimmed);
  ok(StreamManager.getLog().length === ABOVE.length, "C: and holds only what is above it");

  // A DEMOTED floor does not. This is the brake: a quorum floor that stopped verifying under a client
  // that had already forgotten below it is demoted to "stale" rather than withdrawn, because
  // withdrawal would leave no state at all — and "stale" must not license any FURTHER forgetting
  // while the re-page it flagged is outstanding.
  feed(LOG);
  Floor._setTrustedForTest(floor("stale"));
  ok(StreamManager.trimToFloor() === 0,
    "C: a demoted floor trims nothing — a doubtful floor must not license more forgetting",
    StreamManager.trimToFloor());
  ok(StreamManager.getLog().length === LOG.length, "C: and the log stays whole under one");

  // The two features now overlap, and the overlap is answered in `Floor.revalidate()` rather than
  // avoided (there is no `revalidateFloor`; this comment named one for several releases):
  //   not trimmed -> withdraw, as before.
  //   trimmed     -> demote to "stale", keep it as the compute base, flag a re-page (Step 10).
  ok(TrustPolicy.earnsForget("quorum") === true && TrustPolicy.earnsForget("stale") === false,
    "C: the grade that earns forgetting and the grade that does not are the two ends of that answer",
    { quorum: TrustPolicy.earnsForget("quorum"), stale: TrustPolicy.earnsForget("stale") });
  ok(TrustPolicy.earnsForget("none") === false, "C: APPLIED — and an ungraded floor earns nothing");
  // ── WHAT THIS PART DOES NOT REACH, STATED SO THE PASS LINE CANNOT BE READ AS MORE ──────────
  // `Floor.revalidate()` is never called here. The floor arrives already graded via
  // `_setTrustedForTest`, so this asserts the CONSEQUENCE of a demotion and not the demotion.
  // DRIVEN at v310, both directions: making `revalidate()` withdraw on an already-trimmed
  // client, and making it demote to `quorum` instead of `stale`, each leaves THIS guard green.
  // `check-floor` PART F and `check-forget-wiring` PART C go red on both. Adding the call here
  // would need this file to stand up the quorum-selection path, which is those two guards'
  // subject — so the fix was the sentence, not a fourth copy of their fixture.
}

// ── PART D: ordering survives an out-of-order arrival ────────────────────────────────────────
// The log is kept sorted as events land rather than re-sorted from scratch on every ingest. A
// late-arriving event is the case that would expose an append-only shortcut.
{
  feed(LOG.slice(0, LOG.length - 1));
  const late = LOG[LOG.length - 1];
  const misplaced = Object.assign({}, LOG[3], { eventId: "$late" });
  StreamManager.ingest(F.toRaw(misplaced));
  const held = StreamManager.getLog();
  for (let i = 1; i < held.length; i++) {
    const a = held[i - 1], b = held[i];
    ok(a.l < b.l || (a.l === b.l && String(a.eventId) <= String(b.eventId)),
      "D: the log must stay in (l, event_id) order across an out-of-order arrival",
      { prev: [a.l, a.eventId], next: [b.l, b.eventId] });
  }
  ok(held.some((e) => e.eventId === "$late"), "D: APPLIED — the late event must actually have landed");
}

// ── PART E: the trim never outruns the floor ─────────────────────────────────────────────────
{
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  StreamManager.trimToFloor();
  const held = StreamManager.getLog();
  ok(held.length > 0, "E: APPLIED — a trim that emptied the log would pass the next check vacuously");
  ok(held[0].l === ABOVE[0].l,
    "E: the oldest surviving event is the first one ABOVE the floor, not one past it",
    { oldest: held[0].l, expected: ABOVE[0].l });

  // Trimming twice is a no-op, not a second bite.
  const again = StreamManager.trimToFloor();
  ok(again === 0, "E: trimming again drops nothing", again);
  ok(StreamManager.getLog().length === held.length, "E: and leaves the log exactly where it was");
}

// ── PART F: a new room inherits no boundary ─────────────────────────────────────────────────
// reset() clears the trim state along with the log. Without that, the next room folds seeded against
// a floor belonging to the room we just left — and it would look plausible, because the fold would
// still succeed. Asserted directly: mutation shows PART A stopped catching it once its APPLIED check
// was corrected, so this cannot rest on being a side effect of another part.
{
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  StreamManager.trimToFloor();
  ok(StreamManager.getLog().length === ABOVE.length, "F: APPLIED — the first room must really be trimmed");

  feed(LOG);                                    // reset + a fresh room, with NO floor of its own
  const fresh = StreamManager.getState();
  const expected = StateDeriver.derive(LOG);
  ok(carry(fresh) === carry(expected),
    "F: a fresh room derives from genesis — it must not inherit the previous room's floor or boundary",
    { fresh: fresh.nowPlaying, expected: expected.nowPlaying });
  ok(StreamManager.getLog().length === LOG.length,
    "F: and holds its whole log, because it has no floor to trim to", StreamManager.getLog().length);
  // ASSERTED DIRECTLY. Whether we have trimmed decides which fold is truth, and a stale value does
  // not announce itself — the next room folds seeded against a floor it never had and still returns a
  // room-shaped answer. Checking the derived state did not catch it; mutation showed that.
  ok(StreamManager._trimState() === null,
    "F: and carries no trim boundary into the new room", StreamManager._trimState());
}

// ── PART G: bounded over a LONG run, which is the whole point ────────────────────────────────
// The per-part checks above prove one trim works. What matters is that the log stays bounded while a
// room runs for a long time — the derived log used to be re-sorted and re-folded on every ingest and
// never trimmed, so cost grew with history: 1,202 events cost 1,247ms of ingest, and it kept climbing.
//
// With floors arriving on a cadence the held log never exceeds that cadence, so the fold is over a
// FIXED window and the per-event cost stops growing. Measured across rooms of 200 to 3,600 events:
// peak held stayed at 39 and per-event cost stayed flat at roughly 0.2ms.
//
// This is why the incremental fold was not built. The two-pass obstacle is real — a vote can sort
// before the play it references, so an append-only fast path loses votes silently — and it turned
// out not to need solving: the growth it would have addressed was a symptom of the unbounded log,
// not of the fold. Asserted STRUCTURALLY rather than on a stopwatch, because the bound is what
// causes the cost and a timing assertion in a guard is a flake waiting to happen.
{
  const long = [
    F.reducerEvent("$gLong", 1, 900, "@owner:hs", F.RANK.owner,
      { t: "ddjp.room.settings", s: SETTINGS_BLOB }),
  ].concat(F.playingRoom({ songs: 300 }).log.map((e) =>
    F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
  ok(long.length > 500, "G: APPLIED — the run must be long enough for growth to show", long.length);
  feed([]);
  let peak = 0;
  const CADENCE = 40;
  for (let i = 0; i < long.length; i++) {
    StreamManager.ingest(F.toRaw(long[i]));
    if (i % CADENCE === CADENCE - 1) {
      const seed = StateDeriver.buildSeed(long.filter((e) => e.l <= long[i].l));
      Floor._setTrustedForTest({
        n: 1, prev: null, seed: seed,
        h: "h", covers: "a..b", floorL: long[i].l, grade: "verified" });
      // The precondition, per floor. Skipping it here would put this part back on the absent-engine
      // fallback — the exact defect this guard was rewritten to remove.
      proveSettings(seed, long[i].l);
      StreamManager.trimToFloor();
    }
    if (StreamManager.getLog().length > peak) peak = StreamManager.getLog().length;
  }
  ok(peak <= CADENCE,
    "G: the held log never exceeds the seal cadence, however long the room runs — this is what makes " +
    "the fold a fixed-size job instead of one that grows with history",
    { peak: peak, cadence: CADENCE, roomSize: long.length });
  ok(StreamManager.getLog().length < long.length / 4,
    "G: APPLIED — and it really did shed, rather than the room being too short to trim",
    { held: StreamManager.getLog().length, room: long.length });
}

// ── PART H: a late event from BELOW the floor is refused ────────────────────────────────────
// Found in a live room, not by reading. The log showed a trim to l=45 followed immediately by
// back-paginated events at l=4, l=5, l=12 … all below it. `ingest` had no idea a boundary existed,
// so they went straight back into the log and were folded onto the floor's seed — which already
// counted them. Every one is a double-count, and the symptom was an owner reloading onto a song
// from the past with an empty history.
//
// Whether a given event type survives that is luck: a join whose video is already in the buffer
// dedupes and looks fine, while a join from a member the seed did not have adds them again. Correct
// by accident is not correct.
{
  feed(LOG);
  const f = floor("verified");
  const boundaryId = String(f.covers).split("..")[1];
  Floor._setTrustedForTest(f);
  StreamManager.trimToFloor();
  const held = StreamManager.getLog().length;
  ok(held === ABOVE.length, "H: APPLIED — the trim must have happened", held);

  // Exactly the live pattern: an event we already banked arrives again, late.
  StreamManager.ingest(F.toRaw(BELOW[1]));
  StreamManager.ingest(F.toRaw(BELOW[2]));
  const after = StreamManager.getLog();
  ok(after.length === held,
    "H: an event at or below the floor is REFUSED — the seed already counts it, so folding it again " +
    "counts it twice", { before: held, after: after.length, oldest: after[0] && after[0].l });
  ok(after.every((e) => e.l > BOUNDARY_L),
    "H: and nothing below the boundary is ever back in the log", after.map((e) => e.l));

  // The state must be untouched by the attempt.
  const expected = carry(StateDeriver.derive(ABOVE, SEED));
  ok(carry(StreamManager.getState()) === expected,
    "H: and the room is exactly where the floor left it");

  // THE TIE AT THE BOUNDARY. Two events can share a Lamport position, and the one that sorts AFTER
  // the boundary at that position is NOT banked — the floor covers up to the boundary event, not up
  // to the position. Comparing on `l` alone would silently swallow it: not below the floor, not in
  // the log, gone. Same tiebreak the seal path uses, for the same reason.
  const sibling = F.reducerEvent("$zzsib", BOUNDARY_L, 1500, "@sib:hs", F.RANK.player,
    { t: "ddjp.dj.join", v: "SIBSONGxx" });
  ok(sibling.l === BOUNDARY_L && String(sibling.eventId) > String(boundaryId),
    "H: APPLIED — the sibling must share the boundary's position and sort AFTER it",
    { sib: sibling.eventId, boundary: boundaryId });
  StreamManager.ingest(F.toRaw(sibling));
  ok(StreamManager.getLog().some((e) => e.eventId === "$zzsib"),
    "H: an event sharing the boundary's position but sorting after it is NOT banked, and must land");

  // A NEW event above the floor is still accepted — the boundary must not become a wall.
  StreamManager.ingest(F.toRaw(F.reducerEvent("$fresh", LOG[LOG.length - 1].l + 1, 9999,
    "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "FRESH" })));
  ok(StreamManager.getLog().some((e) => e.eventId === "$fresh"),
    "H: APPLIED — an event above the floor still lands, or the refusal is just a broken ingest");
}

console.log("[derived-log-bound] PASS — the derived log is bounded to the floor and not only the raw cache: trimming leaves the room's state byte-identical, every floor that earns forgetting bounds the log — including a SUBSTITUTE floor graded \"quorum\", which Step 12 promoted and which this line claimed for a while still did not, while PART C below it asserted the opposite; a floor ALREADY graded \"stale\" trims nothing and `earnsForget` separates the two ends — note that this PART is HANDED a stale floor via `_setTrustedForTest` and never calls `Floor.revalidate()`, so the DEMOTION itself is pinned by `check-floor` PART F and `check-forget-wiring` PART C, not here; the log stays in (l, event_id) order across a late arrival, and a second trim is a no-op rather than a second bite");
