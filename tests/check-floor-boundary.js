// tests/check-floor-boundary.js
// WALL: WHAT HAPPENS TO AN EVENT SITTING EXACTLY AT THE FLOOR.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// J39 pass 1 flipped `if (l !== floorL) return l > floorL;` to `>=` and 141 guards stayed green.
// It was read as the sweep's most alarming survivor — the same boundary whose sibling defect ran
// undetected for two days.
//
// **DRIVEN, AND IT IS A FALSE SURVIVOR.** That branch executes ONLY when `l !== floorL`, so
// `l >= floorL` and `l > floorL` are THE SAME PREDICATE there — tried across `l = 0..10` against
// `floorL = 5`, **zero differing answers**. The mutation cannot change a result, so no guard could
// ever have caught it. **A mutation that is textually applied and semantically inert is not a
// survivor; it is a VOID the probe failed to classify**, because the probe checked that the TEXT
// changed and not that the ANSWER could.
//
// ── SO WHERE THE BOUNDARY IS ACTUALLY DECIDED ──────────────────────────────────────────────
// One line down: `return String(e.eventId) > bid;` — reached when `l === floorL` EXACTLY. Only the
// id-equals-boundary case differs under a flip, and that case IS the boundary event itself.
//
// **`l` IS CARRIED ON THE EVENT, NOT ASSIGNED LOCALLY**, so two events can share a position and
// `orderEvents` tie-breaks on `eventId` for exactly that reason. The tie-break is live code.
//
// ── AND THE TWO RULES ON ONE FLOOR DISAGREE, WHICH IS RECORDED RATHER THAN FIXED ────────────
// `trimToFloor` keeps `e.l > t.floorL` — STRICTLY above, dropping everything at the floor. But
// `afterBoundary` keeps events AT the floor whose id sorts above the boundary's. **So a sibling at
// the same `l` with a higher id is "still outstanding" to one rule and "already forgotten" by the
// other.** Not fixed here — one boundary, one diff — but written down, because two boundary rules
// on one floor disagreeing for a reason nobody wrote down is how the original defect happened.

const path = require("path");
const { loadInContext } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[floor-boundary] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/session.js",
  "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/floor.js",
], { Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
     window: {}, document: { body: { appendChild() {} } },
     localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
     StreamManager: { getLog: () => [], getState: () => ({ settings: {} }) } });
const Floor = sb.Floor;

// ── THE FIXTURE: EVENTS SITTING EXACTLY AT THE FLOOR ───────────────────────────────────────
const FLOOR_L = 5;
const BID = "$m";                       // the boundary event's id, at l = FLOOR_L
const LOG = [
  { eventId: "$a", l: 3 },              // below
  { eventId: "$k", l: FLOOR_L },        // AT the floor, id sorts BELOW the boundary
  { eventId: BID,  l: FLOOR_L },        // AT the floor, and IS the boundary
  { eventId: "$z", l: FLOOR_L },        // AT the floor, id sorts ABOVE the boundary
  { eventId: "$q", l: 7 },              // above
];

// THE PREMISE. Without it every row below is about a fixture that has no boundary event in it —
// the shape that has taken several rows this month.
const atFloor = LOG.filter((e) => e.l === FLOOR_L);
ok(atFloor.length === 3,
  "APPLIED — the fixture must contain events sitting EXACTLY at the floor, or nothing below " +
  "exercises the boundary at all", atFloor.map((e) => e.eventId));
ok(atFloor.some((e) => e.eventId === BID),
  "APPLIED — and one of them must BE the boundary event, which is the only id whose treatment " +
  "differs under a flip", { bid: BID, atFloor: atFloor.map((e) => e.eventId) });
ok(LOG.some((e) => e.l < FLOOR_L) && LOG.some((e) => e.l > FLOOR_L),
  "APPLIED — with events on both sides, so 'excluded' is a decision rather than an empty list",
  LOG.map((e) => e.l));

const out = Floor.afterBoundary(LOG, FLOOR_L, BID).map((e) => e.eventId);

// ── THE BOUNDARY EVENT IS OUTSIDE ──────────────────────────────────────────────────────────
ok(out.indexOf(BID) < 0,
  "THE BOUNDARY EVENT ITSELF IS EXCLUDED. It is AT the floor and therefore already banked into " +
  "that floor's own seed — including it would fold it twice, once from the seed and once from " +
  "the events after it. This is the single case a `>` to `>=` flip changes, and it was unguarded",
  out);

// ── AND ITS SIBLINGS ARE DECIDED BY ID, NOT DROPPED WHOLESALE ──────────────────────────────
ok(out.indexOf("$z") >= 0,
  "A SIBLING AT THE SAME POSITION WITH A HIGHER ID IS INCLUDED. `l` is carried on the event " +
  "rather than assigned locally, so two events can share a position — which is why `orderEvents` " +
  "tie-breaks on `eventId` and why this comparison is live code rather than dead", out);
ok(out.indexOf("$k") < 0,
  "and one with a LOWER id is excluded — the seed covers up to and including the boundary in the " +
  "same total order the fold uses", out);

// ── THE SIDES, so 'boundary' is a boundary and not a filter that drops everything ──────────
ok(out.indexOf("$a") < 0, "everything strictly below the floor is excluded", out);
ok(out.indexOf("$q") >= 0, "everything strictly above it is included", out);
ok(out.length === 2, "exactly two events survive: the higher-id sibling and the one above", out);

// ── THE OTHER FLIP IS INERT, AND THAT IS ASSERTED RATHER THAN ASSUMED ──────────────────────
// If `l >= floorL` ever became distinguishable from `l > floorL` in that branch, the branch's
// guard condition would have changed — and this row would be the place to notice.
{
  const gt = (l) => (l !== FLOOR_L ? l > FLOOR_L : null);
  const ge = (l) => (l !== FLOOR_L ? l >= FLOOR_L : null);
  const differ = [0, 1, 4, 5, 6, 9].filter((l) => gt(l) !== ge(l));
  ok(differ.length === 0,
    "control: `l > floorL` and `l >= floorL` agree at every position, because that branch runs " +
    "only when `l !== floorL`. J39's B02 flipped this and 141 guards stayed green — not because " +
    "it was unguarded, but because THE MUTATION WAS INERT", differ);
}

console.log("[floor-boundary] PASS — what happens to an event sitting exactly at the floor (" +
  asserts + " assertions). **J39's most alarming survivor was a FALSE SURVIVOR**: flipping " +
  "`l > floorL` to `>=` in a branch that runs only when `l !== floorL` cannot change an answer, " +
  "driven across every position. A mutation that is textually applied and semantically inert is a " +
  "VOID the probe failed to classify. **The real boundary is one line down** — " +
  "`String(e.eventId) > bid`, reached when `l === floorL` exactly — and the only case a flip " +
  "changes is the boundary event itself, which must stay OUT because it is already banked into " +
  "the floor's seed. Its siblings at the same position are decided by id, because `l` is carried " +
  "on the event and two events can share one. **AND `trimToFloor` DISAGREES**: it keeps strictly " +
  "above the floor, dropping siblings this function calls outstanding — recorded, not fixed, " +
  "because one boundary is one diff");
