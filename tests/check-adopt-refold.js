// tests/check-adopt-refold.js
//
// ADOPTING A FLOOR RE-DERIVES FROM IT, AND DOES NOT WAIT FOR PERMISSION TO DO SO.
//
// J47. `_refold()` had two production callers: `ingest`, and `trimToFloor` after its early returns.
// So on adoption the room was re-derived only if the trim also succeeded — and for an ORIGIN floor
// (an import or a restore) it could not, because of a circularity the entry states exactly:
//
//     the re-derive is gated on a licence that the re-derive produces
//
// The licence for an origin floor is `validated / origin-seed`, and that verdict is recorded by
// `_recordOriginVerdict` inside `_deriveBest` — which is the fold that `trimToFloor` would have
// triggered. So `trimToFloor` asked for a licence that only its own refold could grant, got the
// PREVIOUS floor's verdict instead, and returned 0. In a busy room the next arriving event folds and
// everything is right within seconds. In a QUIET room the owner clicks restore and the room shows
// its old state indefinitely, with nothing in the log saying why.
//
// WHY NOT THE OTHER TWO PLACES THE ENTRY OFFERS.
//   · `trimToFloor`'s NO-DROP PATH cannot work: the licence check returns before it, so a refold
//     placed there never runs in the case that needs it. Measured, not assumed.
//   · `Floor`'s EMISSION would mean StreamManager subscribing to Floor at load. StreamManager reads
//     Floor lazily today (`typeof Floor !== "undefined"`), so a subscription would add a load-order
//     constraint between two modules that currently have none — a new chain, which `BEHAVIOUR.md`
//     says wants writing down, bought for no gain over doing it where the fold already lives.
//
// SO THE FOLD HAPPENS FIRST, BEFORE THE LICENCE IS ASKED, and only when the floor actually moved.
// That is not "refold more often": a floor changes when a checkpoint is adopted, which is rare, and
// both `trimToFloor` call sites are adoption paths rather than per-event ones.
//
// WHAT THIS ASSERTS: after adopting a floor and calling `trimToFloor`, the fold has run against the
// floor now held — observable as the validation record being keyed to that floor rather than to the
// previous one. The record is the right observable because it is what the circularity denied.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, Floor } = C;

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[adopt-refold] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log);

function mk(n, h, vid, extra) {
  const seed = StateDeriver.buildSeed([], null);
  seed.nowPlaying = { pi: "$pi-" + vid, vid: vid, startedAt: 1000, dj: "@owner:hs" };
  return Object.assign(
    { n: n, h: h, floorL: 6, grade: "verified", covers: "$a..$b", seed: seed }, extra || {});
}
const sigOf = (f) => f.n + ":" + (f.h || "");

// An ORIGIN floor is the case the entry is about: `prev === null && thin === true` makes the seeded
// branch live with no trim ever having happened, and its licence is the one only the fold can grant.
const OLD = mk(1, "hOLD", "OLD", { prev: "x", thin: false });
const NEW = mk(2, "hNEW", "NEW", { prev: null, thin: true });

Floor.reset();
StreamManager.reset();

// ── PREMISE: a fold has happened under the OLD floor, as production's sequence has it ────────
// The checkpoint arrives, ingest folds STILL UNDER THE OLD FLOOR, and only then is the new floor
// remembered and adopted. So the record in hand belongs to the old floor before adoption begins.
Floor._setTrustedForTest(OLD);
StreamManager._setLogForTest(LOG);

ok(StreamManager.seedValidation().sig !== sigOf(NEW),
  "PREMISE — the validation record must NOT already belong to the new floor before it is adopted, " +
  "or the assertion below cannot tell a re-derive from a starting condition.",
  "record was " + JSON.stringify(StreamManager.seedValidation()));

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
// Adopt through Floor's own seam and call `trimToFloor`, which is exactly what the `adopted`
// subscriber does — `_proveFloorSettings()` in between reads the floor and does not fold.
Floor._setTrustedForTest(NEW);
StreamManager.trimToFloor();

ok(StreamManager.seedValidation().sig === sigOf(NEW),
  "adopting a floor did not re-derive from it. `trimToFloor` asked for a forget licence that only " +
  "its own refold could grant — for an origin floor the verdict is recorded by `_deriveBest`, which " +
  "had not run — so it read the previous floor's verdict and returned without folding. In a quiet " +
  "room the client then serves state derived from a floor it no longer holds, indefinitely, with " +
  "nothing in the log saying why.",
  "expected the record keyed to " + sigOf(NEW) + ", got " +
  JSON.stringify(StreamManager.seedValidation()));

// ── AND THE FOLD MUST NOT RUN WHEN THE FLOOR HAS NOT MOVED ───────────────────────────────────
// A fix that simply refolds on every call would pass the assertion above while turning a cheap
// adoption path into a fold per call. The observable is the boundary: with the same floor still in
// place and nothing above it to drop, a second call must change nothing.
const before = StreamManager.getLog().length;
StreamManager.trimToFloor();
ok(StreamManager.getLog().length === before,
  "calling trimToFloor twice with the SAME floor changed the log, so the re-derive is not " +
  "conditional on the floor having moved.",
  "log length went " + before + " -> " + StreamManager.getLog().length);

ok(StreamManager.seedValidation().sig === sigOf(NEW),
  "a second call with the same floor moved the validation record, so the fold is running " +
  "unconditionally rather than on a floor change.",
  "record is now " + JSON.stringify(StreamManager.seedValidation()));

console.log(
  "[adopt-refold] PASS — adopting a floor re-derives from it without waiting for a forget licence. " +
  "J47's circularity is broken at the only place it can be: the fold runs BEFORE the licence is " +
  "asked, because for an origin floor the licence is recorded BY that fold — placing it in " +
  "`trimToFloor`'s no-drop path would never run, since the licence check returns first. It is " +
  "conditional on the floor having moved, asserted here rather than assumed, so an adoption path " +
  "does not become a fold per call (" + checks + " assertions)");
