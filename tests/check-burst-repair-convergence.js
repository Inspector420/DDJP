// tests/check-burst-repair-convergence.js
//
// A BURST OF DELETIONS, REPAIRED LATE AND OUT OF ORDER, STILL LANDS ON ONE TRUTH.
//
// THE QUESTION THIS ANSWERS, AND THE HALF IT DOES NOT. "Can an attacker deleting faster than the
// repair pass hold two clients apart?" has been recorded as unanswerable headlessly. That is TOO
// STRONG, and the overclaim is worth naming because it kept real work off the list: the question has
// two halves and only one of them needs a browser.
//
//   · CONVERGENCE — do repairs that land late, out of order, and interleaved with further deletions
//     still bring a client to the state a reader holding everything derives? That is a property of
//     the fold and the repair path. No browser, no clock, no network. It is what this file drives.
//   · TIMING — does the real 4-second `setTimeout` debounce in `_scheduleSilentRepair` keep up under
//     a real browser that may throttle it, on a real homeserver that may rate-limit? That needs a
//     browser and a room, and nothing here reaches it.
//
// So the honest boundary is: **the logic of the griefer case is testable and now tested; the timing
// of it is not.** `check-repair-convergence` already drives ONE deletion repaired promptly. This is
// the burst — the shape the question is actually about.
//
// WHY ORDER AND LATENESS ARE THE AXES. A repair is content from a held vouch record plus authorship
// from the homeserver's tombstone, and both are shared by construction — so a repair cannot inject
// anything private. What it CAN do is arrive at an awkward moment. If a late repair could land the
// client somewhere the room is not, the fork would be real and silent, because every individual
// piece verified.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/streammanager.js",
  ], {});
}

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[burst-repair] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const REF = tree();
const RAW = F.sortLog([
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: REF.StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 10 }).log));

// Stamp the hash commitments the wire carries — `sendEvent` commits
// `Vouch.commitFor(JSON.parse(parent.content.body))`, and that commitment is the ANCHOR a repair is
// checked against. From the RAW body, which carries `l`; the reducer-shaped `content` does not, and
// committing the wrong one yields an anchor that resolves and then mismatches.
const BY_ID = Object.create(null);
RAW.forEach((e) => { BY_ID[e.eventId] = e; });
const LOG = RAW.map((e) => {
  const pid = e.content && e.content.p;
  if (typeof pid !== "string" || !BY_ID[pid]) return e;
  return Object.assign({}, e, {
    content: Object.assign({}, e.content, {
      pHash: REF.Vouch.commitFor(JSON.parse(F.toRaw(BY_ID[pid]).content.body)),
    }),
  });
});

// THE BURST: every play that has both a held child (the anchor) and a parent. Deleting several at
// once is what "faster than the repair pass" means in terms the fold can see — repairs will land
// after further deletions have already happened.
const LOST = LOG.filter((e) =>
  e.content && e.content.t === "ddjp.dj.play" && e.l > 2 &&
  LOG.some((c) => c.content && c.content.p === e.eventId));

ok(LOST.length >= 3,
  "PREMISE — the fixture must lose at least three events, or this is the single-deletion case " +
  "`check-repair-convergence` already covers rather than a burst.",
  "found " + LOST.length + " losable plays");

// ── THE REFERENCE: never lost anything ───────────────────────────────────────────────────────
REF.Floor.reset(); REF.StreamManager.reset();
LOG.forEach((e) => REF.StreamManager.ingest(F.toRaw(e)));
const reference = REF.StreamManager.getState();

// ── THE DISTURBED CLIENT: the whole burst is gone at once ────────────────────────────────────
const D = tree();
D.Floor.reset(); D.StreamManager.reset();
const lostIds = LOST.map((e) => e.eventId);
LOG.filter((e) => lostIds.indexOf(e.eventId) < 0)
   .forEach((e) => D.StreamManager.ingest(F.toRaw(e)));

ok(JSON.stringify(D.StreamManager.getState()) !== JSON.stringify(reference),
  "PREMISE — losing the whole burst left the client identical to the reference, so nothing below " +
  "is being repaired.");

// Records and tombstones for every lost event. Both are SHARED by construction — the record rides
// on the wire in a witness bundle, the tombstone comes from the homeserver — so a repair moves the
// room to one truth rather than moving one client somewhere private.
const carriers = LOST.map((e) => F.toRaw(F.reducerEvent(
  "$carrier-" + e.eventId, LOG[LOG.length - 1].l + 1, 9999, "@peer:hs", F.RANK.player,
  { t: "ddjp.witness.bundle", w: [D.Vouch.record(F.toRaw(e))] })));
const anchors = LOST.map((e) => F.toRaw(LOG.find((c) => c.content && c.content.p === e.eventId)));
const HELD = carriers.concat(anchors);
LOST.forEach((e) => D.Vouch.rememberTombstone(
  { id: e.eventId, sender: e.sender, rank: e.senderRank, roomId: F.ROOM, ts: e.ts }));

// ── REPAIRS LAND LATE AND OUT OF ORDER ───────────────────────────────────────────────────────
// REVERSED deliberately: the newest lost event is repaired FIRST, so every earlier repair arrives
// after the fold has already moved on. That is the awkward moment a burst creates, and doing them
// in order would test the easy case while claiming the hard one.
const rebuilt = LOST.slice().reverse().map((e) => {
  const r = D.Vouch.reconstruct(e.eventId, HELD);
  ok(r && r.ok === true,
    "PREMISE — an honest repair was refused, so the burst cannot be reassembled and the " +
    "assertion below would be measuring a fixture failure.",
    e.eventId + " -> " + JSON.stringify(r && r.why));
  return r.event;
});
rebuilt.forEach((ev) => D.StreamManager.ingest(ev));

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
ok(JSON.stringify(D.StreamManager.getState()) === JSON.stringify(reference),
  "a client that lost a BURST of events and repaired them late and out of order does not derive " +
  "what a client holding everything derives. Each repair verified on its own, so the divergence " +
  "would be silent from both ends — which is the shape the griefer question is actually about.",
  "reference: " + JSON.stringify(reference).slice(0, 300) +
  "\n      repaired : " + JSON.stringify(D.StreamManager.getState()).slice(0, 300));

// ── AND THE COMPARISON MUST BE ABLE TO FAIL ──────────────────────────────────────────────────
// A client still genuinely short must NOT match, or the assertion above is vacuous and would stay
// green through any amount of real divergence.
const X = tree();
X.Floor.reset(); X.StreamManager.reset();
LOG.filter((e) => lostIds.indexOf(e.eventId) < 0)
   .forEach((e) => X.StreamManager.ingest(F.toRaw(e)));
rebuilt.slice(0, -1).forEach((ev) => X.StreamManager.ingest(ev));
ok(JSON.stringify(X.StreamManager.getState()) !== JSON.stringify(reference),
  "CONTROL — a client with one repair still missing matched the reference, so the comparison " +
  "cannot tell repaired from short and the assertion above proves nothing.");

console.log(
  "[burst-repair] PASS — a burst of deletions, repaired LATE and in REVERSE order, still lands on " +
  "what a reader holding everything derives. This is the reachable half of \"can an attacker delete " +
  "faster than the repair pass and hold two clients apart\": the CONVERGENCE half is a property of " +
  "the fold and the repair path and needs no browser, and it holds. The TIMING half — whether the " +
  "real 4s debounce in `_scheduleSilentRepair` keeps up under a browser that may throttle it and a " +
  "homeserver that may rate-limit — is not reachable here and is not claimed. Repairs are ordered " +
  "newest-first on purpose, so every earlier one arrives after the fold has moved on; doing them in " +
  "order would test the easy case while claiming the hard one. The comparison is proven able to " +
  "fail by a control still missing one repair (" + checks + " assertions)");
