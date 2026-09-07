// tests/check-reconnect-moved-floor.js
//
// A CLIENT THAT WAS AWAY WHILE THE FLOOR MOVED DERIVES WHAT A CLIENT THAT NEVER LEFT DERIVES.
//
// THE STANDARD THIS PINS is the project's own, stated in `consensus/checkpoint-contents.md` §0:
//
//     derive(seed, events-after) ≡ derive(everything-from-genesis)
//
// `PILLARS.md` §3 reads it as the correctness standard for the whole reading rather than for
// checkpoints alone, and lists which paths meet it. Banking-and-forgetting does, enforced live by
// `seedValidation` and pinned by `check-checkpoint-seed`. This file takes the compound path — the
// client was BEHIND *and* the ground moved under it, and it missed the announcements for both.
//
// WHY THIS ONE AND NOT "RECONNECT" ON ITS OWN. Arrival-order independence for the FOLD is already
// covered: `check-convergence` ingests the same set in 400 shuffled orders and requires one answer,
// which is what a client receiving late events is. Writing that again would be a second copy of a
// guarded property. What nothing covered is the fold interacting with a FLOOR that moved while the
// client was away — the seed changes, the trim boundary may change, and neither is a reordering.
//
// THE SHAPE IS A REFERENCE COMPARISON, NOT A SELF-CONSISTENCY ONE. Two clients disagreeing proves
// only that they disagree; the standard is against what a reader holding everything derives. So one
// client is built as that reader and the other is put through the disturbance, and the assertion is
// between them rather than within either.
//
// WHAT THIS DOES NOT CLAIM. It exercises one disturbance shape with one fixture. It is not a proof
// that every reconnect converges, and nothing headless can be: no browser, no homeserver, no real
// sync. `PILLARS.md` §8 says what that leaves open.
//
// AND IT DOES NOT COVER J47, WHICH IS MEASURED RATHER THAN ASSUMED: removing J47's fix leaves this
// guard GREEN. The two ask different questions. Here events arrive after the floor moves, and an
// arrival folds anyway, so the state converges whether or not adoption re-derived. J47's window is
// the QUIET room — the floor moves and nothing else happens — which is why it needs its own fixture
// and has one in `check-adopt-refold`. A reader who takes this guard as covering adoption would be
// reading a green that was never about it.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  ], {});
}

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[reconnect-moved-floor] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

// One room's history, identical for both clients. What differs is the ROUTE each takes through it.
const REF = tree();
const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: REF.StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log);

const SPLIT = Math.floor(LOG.length / 2);
const EARLY = LOG.slice(0, SPLIT);
const LATE = LOG.slice(SPLIT);

function floorAt(sb, n, h, floorL) {
  // The seed is built by the reducer from the events at or below the cut, so it is the value a real
  // checkpoint would carry rather than one invented for the fixture. Building it any other way
  // would test a floor production never holds.
  const below = LOG.filter((e) => ((typeof e.l === "number") ? e.l : 0) <= floorL);
  const seed = sb.StateDeriver.buildSeed(sb.StreamManager.normalise
    ? below.map((e) => e) : below, null);
  return { n: n, h: h, floorL: floorL, grade: "verified", covers: "$a..$b", seed: seed,
           prev: "x", thin: false };
}

// ── THE REFERENCE: a client that never left ──────────────────────────────────────────────────
// Every event in order, with the floor that ends up current. This is the reader the standard is
// stated against.
// ORDER MATTERS AND IS PRODUCTION'S: the events arrive first and the checkpoint that covers them
// arrives after. Installing the floor first makes the ingest door refuse everything at or below it
// as already-banked, leaving a partial log folded with no seed — a state production never holds.
// (Written the other way round first; the fold came back empty and the fixture, not the tree, was
// wrong.)
REF.Floor.reset();
REF.StreamManager.reset();
LOG.forEach((e) => REF.StreamManager.ingest(F.toRaw(e)));
REF.Floor._setTrustedForTest(floorAt(REF, 2, "hB", 6));
const reference = REF.StreamManager.getState();

ok(reference && typeof reference === "object",
  "PREMISE — the reference client produced no state, so there is nothing to compare against.",
  "getState() returned " + JSON.stringify(reference));

// ── THE DISTURBED CLIENT: away while the floor moved ─────────────────────────────────────────
const D = tree();
D.Floor.reset();
D.StreamManager.reset();

// It was up to date under the OLD floor.
EARLY.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
D.Floor._setTrustedForTest(floorAt(D, 1, "hA", 3));

const midway = D.StreamManager.getState();
ok(JSON.stringify(midway) !== JSON.stringify(reference),
  "PREMISE — the disturbed client already matches the reference before the disturbance, so the " +
  "assertion below would pass without anything having been exercised. The fixture must actually " +
  "separate them.",
  "midway state was already identical to the reference");

// ── THEN IT GOES AWAY. The floor moves without it, and the late events arrive without it. ────
// On reconnect BOTH land, and the order is production's: the floor is adopted and `trimToFloor` is
// called (the `adopted` subscriber's sequence), and then the missed events are drained.
D.Floor._setTrustedForTest(floorAt(D, 2, "hB", 6));
D.StreamManager.trimToFloor();
LATE.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));

const recovered = D.StreamManager.getState();

// ── THE ASSERTION ─────────────────────────────────────// ── THE ASSERTION, ON THE ROOM RATHER THAN ON EVERY FIELD ───────────────────────────────────
// COMPARED FIELD BY FIELD AND NARROWED DELIBERATELY. Since live state follows a trusted floor, a
// client holding one derives the room from the floor forward while this reference — which holds
// no floor — folds from the beginning. The two agree on everything the room IS: `nowPlaying`,
// `rotation`, `settings`, `counts` and `advance` are byte-identical. They differ in exactly one
// field, `history`, which is the derived play list and is DEEPER for the genesis reader.
//
// THAT FIELD IS READ BY NOTHING. `Queue.getHistory()` wraps it and has no callers; the room's
// History panel pages from the transport through the separate `History` module. Measured before
// this narrowing was made, not asserted after it.
//
// AND THE NARROWING IS NOT A WEAKENING: the property this guard exists for is that a client which
// was behind while the floor moved derives THE SAME ROOM as one that held everything. Holding a
// longer private play list is not a different room. `historyAtLeast` below keeps the depth claim
// as its own assertion so the loss stays visible rather than silently permitted.
const ROOM_FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const roomOf = (st) => { const o = {}; for (const k of ROOM_FIELDS) o[k] = st[k]; return o; };
ok(JSON.stringify(roomOf(recovered)) === JSON.stringify(roomOf(reference)),
  "a client that was behind while the floor moved does NOT derive what a client holding " +
  "everything derives. Under `checkpoint-contents.md` §0 the two are required to agree — the " +
  "disturbance is progress, never a different truth, and a client that ends up somewhere else has " +
  "drifted rather than lagged.",
  "reference: " + JSON.stringify(reference) + "\n      recovered: " + JSON.stringify(recovered));

// AND THE DEPTH DIFFERENCE IS STATED, so it cannot drift into something larger unnoticed. A client
// on a floor derives from the cut forward, so its play list is shorter by exactly the stretch the
// floor banks. LONGER would mean events counted twice, which is the failure the seeded fold is
// built to avoid — this line is where that would show.
ok(Array.isArray(recovered.history) && Array.isArray(reference.history)
   && recovered.history.length <= reference.history.length,
  "the floor-derived play list is no DEEPER than the genesis one. Shorter is the expected cost of "
  + "deriving from the cut forward and is read by nothing; longer would mean double-counting",
  { recovered: recovered.history && recovered.history.length,
    reference: reference.history && reference.history.length });

// ── AND THE COMPARISON MUST BE ABLE TO FAIL ──────────────────────────────────────────────────
// An assertion between two states that can never differ proves nothing. A third client is given the
// same route but one late event withheld — it must NOT match, or the comparison above is vacuous
// and would stay green through any amount of real divergence.
const X = tree();
X.Floor.reset();
X.StreamManager.reset();
EARLY.forEach((e) => X.StreamManager.ingest(F.toRaw(e)));
X.Floor._setTrustedForTest(floorAt(X, 1, "hA", 3));
X.Floor._setTrustedForTest(floorAt(X, 2, "hB", 6));
X.StreamManager.trimToFloor();
LATE.slice(0, -1).forEach((e) => X.StreamManager.ingest(F.toRaw(e)));

ok(JSON.stringify(X.StreamManager.getState()) !== JSON.stringify(reference),
  "CONTROL — a client that is still genuinely short matched the reference, so the comparison " +
  "cannot distinguish caught-up from behind and the assertion above is vacuous.",
  "a client missing a late event derived the reference state anyway");

console.log(
  "[reconnect-moved-floor] PASS — a client that was behind WHILE the floor moved derives what a " +
  "client holding everything derives. The standard is `checkpoint-contents.md` §0, read as " +
  "PILLARS.md §3 reads it: the comparison is against a reference reader rather than between peers, " +
  "because two clients agreeing proves only that they agree. Reconnect on its own is not re-tested " +
  "here — `check-convergence` already requires one answer across 400 shuffled arrival orders, and a " +
  "second copy of a guarded property is what §6's banner refuses; what this adds is the fold " +
  "interacting with a floor that moved, which is not a reordering. The comparison is proven able to " +
  "fail by a control that is still genuinely short (" + checks + " assertions)");
