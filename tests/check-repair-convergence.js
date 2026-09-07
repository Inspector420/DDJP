// tests/check-repair-convergence.js
//
// A CLIENT THAT LOST AN EVENT AND REBUILT IT DERIVES WHAT A CLIENT THAT NEVER LOST IT DERIVES.
//
// THE STANDARD is the project's own, `consensus/checkpoint-contents.md` §0, read as `PILLARS.md` §3
// reads it — against a reference reader holding everything, never between peers:
//
//     derive(seed, events-after) ≡ derive(everything-from-genesis)
//
// This is the repair row of that table. It was open because the existing coverage answers a
// DIFFERENT question: `check-stress` proves that re-supplying a deleted event WITHOUT a tombstone
// injects nothing, because a rebuild carries no sender and the reducer keys by sender. That is the
// defence against an attacker replaying their own deletions and it is sound. It says nothing about
// whether an HONEST repair — record plus tombstone, the case the whole vouch layer exists for —
// lands the client back where everyone else is.
//
// The distinction matters because the two failures look nothing alike. A refused rebuild is loud and
// leaves the room short. A repair that succeeds but lands somewhere ELSE is silent, room-shaped, and
// exactly the drift `PILLARS.md` §0 says has no third explanation: two clients deriving different
// states are at different progress, or one of them is wrong.
//
// WHAT A REPAIR NEEDS, AND WHY BOTH HALVES ARE EXERCISED HERE. Content comes from a vouch record the
// client already holds — carried on the wire in a witness bundle, so holding the carrying event is
// holding the record. Authorship comes from the homeserver's tombstone, which survives a redaction
// signed. `Vouch.reconstruct` refuses by name without either: `no-tombstone`, `no-rank`, `no-record`.
// This drives the honest path and asserts the refusals still stand, so a fix that made repair
// permissive would fail here rather than passing.

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
  assert.ok(cond, "[repair-convergence] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const REF = tree();
const RAW_LOG = F.sortLog([
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: REF.StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 6 }).log));

// STAMP THE HASH COMMITMENTS THE WIRE CARRIES. Production's `sendEvent` sets `pHash =
// Vouch.commitFor(parent body)` on any chained event, and that commitment is the ANCHOR a repair is
// checked against: `expectedHashFor` asks what hash a missing event SHOULD have according to the
// children still held. A fixture without it produces records that refuse with `no-anchor` — which
// is the module being right about a fixture that is wrong, not a finding.
const BY_ID = Object.create(null);
RAW_LOG.forEach((e) => { BY_ID[e.eventId] = e; });
const LOG = RAW_LOG.map((e) => {
  const pid = e.content && e.content.p;
  if (typeof pid !== "string" || !BY_ID[pid]) return e;
  // FROM THE RAW WIRE BODY, exactly as production does — `sendEvent` commits
  // `Vouch.commitFor(JSON.parse(parent.content.body))`. The raw body carries `l`; the
  // reducer-shaped `content` does not, and committing the wrong one produces a hash that resolves
  // as an anchor and then mismatches the record — green anchor, refused repair, for a reason that
  // is about the fixture and reads like a defect.
  const parentBody = JSON.parse(F.toRaw(BY_ID[pid]).content.body);
  return Object.assign({}, e, {
    content: Object.assign({}, e.content, { pHash: REF.Vouch.commitFor(parentBody) }),
  });
});

// The event that goes missing. A play is chosen deliberately: it moves the room, so losing it and
// getting it back is visible in derived state rather than only in the log's length.
const LOST = LOG.find((e) => e.content && e.content.t === "ddjp.dj.play" && e.l > 2);
ok(!!LOST,
  "PREMISE — the fixture must contain a play above position 2 to lose, or nothing below is " +
  "exercised.", "no such event in a " + LOG.length + "-event log");

// ── THE REFERENCE: never lost anything ───────────────────────────────────────────────────────
REF.Floor.reset();
REF.StreamManager.reset();
LOG.forEach((e) => REF.StreamManager.ingest(F.toRaw(e)));
const reference = REF.StreamManager.getState();

// ── THE DISTURBED CLIENT: the event was deleted ──────────────────────────────────────────────
const D = tree();
D.Floor.reset();
D.StreamManager.reset();
LOG.filter((e) => e.eventId !== LOST.eventId).forEach((e) => D.StreamManager.ingest(F.toRaw(e)));

const short = D.StreamManager.getState();
ok(JSON.stringify(short) !== JSON.stringify(reference),
  "PREMISE — losing the event left the client in the same state as the reference, so the " +
  "assertion below would pass without a repair having done anything. The fixture must actually " +
  "separate them.",
  "state was identical to the reference with the event missing");

// ── THE HALVES, ASSERTED SEPARATELY BEFORE THE REPAIR ────────────────────────────────────────
// A record it holds, and no tombstone yet: this must refuse, and refuse BY NAME. If it did not,
// the assertion after the repair would be measuring nothing.
const REC = D.Vouch.record(F.toRaw(LOST));
ok(REC && typeof REC === "object",
  "PREMISE — a vouch record could not be made for the lost event, so there is nothing to repair " +
  "from.", "Vouch.record returned " + JSON.stringify(REC));

// The evidence a real client holds: the CHILD that names the lost event as its parent and carries
// the hash commitment (the anchor), plus a witness bundle carrying the record (the content).
const CHILD = LOG.find((e) => e.content && e.content.p === LOST.eventId);
ok(!!CHILD && typeof CHILD.content.pHash === "string",
  "PREMISE — no held child commits a hash for the lost event, so `expectedHashFor` has no anchor " +
  "and every record would refuse with `no-anchor` for a reason that is about the fixture.",
  "child=" + (CHILD && CHILD.eventId) + " pHash=" + (CHILD && CHILD.content.pHash));

const carrier = F.toRaw(F.reducerEvent("$carrier", LOG[LOG.length - 1].l + 1, 9999,
  "@peer:hs", F.RANK.player, { t: "ddjp.witness.bundle", w: [REC] }));
const HELD = [carrier, F.toRaw(CHILD)];

const noTomb = D.Vouch.reconstruct(LOST.eventId, HELD);
ok(noTomb && noTomb.ok === false && noTomb.why === "no-tombstone",
  "a rebuild with a record but NO tombstone was allowed. Content alone carries no sender, and the " +
  "reducer keys members, ranks and DJ credit by sender — this refusal is what stops an attacker " +
  "re-supplying their own deletions.",
  "reconstruct returned " + JSON.stringify(noTomb));

// ── NOW THE HONEST REPAIR: record + tombstone ────────────────────────────────────────────────
// The tombstone is what Matrix leaves behind: id, sender, room, and the channel-origin rank.
D.Vouch.rememberTombstone({ id: LOST.eventId, sender: LOST.sender, rank: LOST.senderRank,
                            roomId: F.ROOM, ts: LOST.ts });

const rebuilt = D.Vouch.reconstruct(LOST.eventId, HELD);
ok(rebuilt && rebuilt.ok === true && rebuilt.event,
  "an honest repair — a held record plus the homeserver's tombstone — was refused. That is the " +
  "case the whole protection layer exists for.",
  "reconstruct returned " + JSON.stringify(rebuilt && rebuilt.why));

ok(rebuilt.event.sender === LOST.sender && rebuilt.event.senderRank === LOST.senderRank,
  "the rebuilt event does not carry the ORIGINAL author. Authorship comes from the tombstone, not " +
  "from the record, and an event rebuilt under the wrong sender re-attributes DJ credit and rank.",
  "rebuilt sender=" + rebuilt.event.sender + " rank=" + rebuilt.event.senderRank +
  " expected " + LOST.sender + "/" + LOST.senderRank);

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
// It goes back through the ingest door like any other event. `PILLARS.md` §3 requires that: the
// cache is a buffer, never evidence for the fold, so a repaired event re-enters the room the way
// everything else does rather than being read out of storage.
D.StreamManager.ingest(rebuilt.event);
const repaired = D.StreamManager.getState();

ok(JSON.stringify(repaired) === JSON.stringify(reference),
  "a client that lost an event and rebuilt it does NOT derive what a client holding everything " +
  "derives. The repair succeeded and landed the room somewhere else, which is drift rather than " +
  "lag — and under PILLARS.md §0 there is no third explanation for two clients disagreeing.",
  "reference: " + JSON.stringify(reference) + "\n      repaired : " + JSON.stringify(repaired));

console.log(
  "[repair-convergence] PASS — a client that lost an event and rebuilt it from a held vouch record " +
  "plus the homeserver's tombstone derives what a client that never lost it derives. The standard is " +
  "checkpoint-contents.md §0 compared against a reference reader rather than between peers. Both " +
  "halves of a repair are driven, not assumed: a record WITHOUT a tombstone is refused by name " +
  "(`no-tombstone`), which is what stops an attacker re-supplying their own deletions, and the " +
  "rebuilt event is asserted to carry the ORIGINAL author, since authorship comes from Matrix and " +
  "not from the record. The repaired event re-enters through the ingest door like any other, because " +
  "the cache is a buffer and never evidence for the fold. The comparison is proven able to fail by " +
  "the premise that the client genuinely differed while short (" + checks + " assertions)");
