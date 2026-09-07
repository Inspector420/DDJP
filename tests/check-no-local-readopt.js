// tests/check-no-local-readopt.js
//
// A CLIENT MAY NOT RE-ADOPT A FLOOR IT JUST REFUSED, ON EVIDENCE IT ALREADY HELD.
//
// THE RULE IS THE SYSTEM'S, not this file's: a client never holds a truth the room cannot hold.
// Being behind is ordinary; computing from a base the room rejected is a fork. So local evidence may
// make a client MORE CAUTIOUS and never MORE PERMISSIVE.
//
// `Continuity` already reads that way and is the shape to copy: uncorroborated local evidence of a
// gap yields `suspect` and PERMITS anyway, because one fabricated parent must not freeze a room;
// only corroborated — shared — evidence yields `short` and stops.
//
// WHERE IT WAS BROKEN (J43). `revalidate` refuses a floor whose chain no longer verifies against the
// DERIVED LOG and announces `withdrawn`/`demoted`. The subscriber then calls
// `Floor.thinJoin(_localPager())`, and that pager reads the RAW CACHE — which still holds what the
// fold refused. The same floor at the same cut verified again and returned within a microtask of
// being refused, on evidence the client had held the whole time. Nothing was learned; a looser
// question was asked of the same pile and the better answer taken.
//
// THE FIX IS NARROW, AND THE NARROWNESS IS THE POINT. It does not forbid re-adoption and does not
// forbid reading the cache — a trimmed client whose derived log no longer REACHES is recovering, not
// forking. What is refused is the one move that cannot be honest: taking back the floor you just
// rejected without having learned anything since. So the pager reports whether it FETCHED, and
// re-adopting the refused floor requires that it did.
//
// THE FIXTURE RANK IS LOAD-BEARING AND WAS THE REAL BLOCKER. `Ranks.defaultCheckpointTable()` is
// `[1,3,4,5,null,null,null]` — `null` means NEVER, so player-and-below authors can form no quorum at
// any count. Three guards' worth of "this path cannot be driven" were three fixtures built from
// player-rank checkpoints, where `select` was correctly refusing and the refusal was read as the
// path being untestable. Authors here are HIGH-STAFF and the settings are the reducer's own
// defaults, which is the shape `check-accepted-boundary` uses and the only one that selects.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js",
], {});
const { Floor, StateDeriver } = C;

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[no-local-readopt] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const LOG = F.sortLog([
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log));

const CPS = F.chainOf(C, LOG, [4, 9, 14], "@a:hs");

// ONE CLIENT, TWO PILES. The derived log lost the joining segment; the raw cache still holds it.
// Nothing here is foreign evidence — it is the client's own fold having discarded what its cache
// kept, which is J43 exactly.
const DERIVED = LOG.filter((e) => !(e.l > 4 && e.l <= 9));
const CACHE = LOG;

ok(Floor.chainVerifies(CPS, CACHE) === true,
  "PREMISE — the chain must verify against the CACHE, or there is no looser answer to be tempted by.");
ok(Floor.chainVerifies(CPS, DERIVED) === false,
  "PREMISE — the chain must FAIL against the derived log, or nothing is refused and the re-adoption " +
  "below is ordinary rather than a loop.");

function standUp(log) {
  Floor.reset();
  Floor.attach({
    log: () => log,
    myRank: () => F.RANK.highStaff,
    settings: () => StateDeriver.defaultSettings(),
    trimmed: () => false,
  });
  Floor.remember(CPS[0], F.RANK.highStaff, "@a:hs", 1000);
  Floor.remember(CPS[1], F.RANK.highStaff, "@b:hs", 1100);
  Floor.remember(CPS[2], F.RANK.highStaff, "@c:hs", 1200);
  return Floor.adopt(Floor.select(F.RANK.highStaff, StateDeriver.defaultSettings(),
    (q) => Floor.chainVerifies(q, CACHE)));
}

// ── PREMISE: the client really holds a floor, selected the way production selects ────────────
ok(standUp(DERIVED) === true && Floor.current(),
  "PREMISE — the client must adopt a floor through `select`/`adopt`, or nothing below is a " +
  "re-adoption. If this fails the fixture is wrong, not the tree.",
  "current() was " + JSON.stringify(Floor.current()));
const HELD = Floor.current().h;

// ── THE REFUSAL ──────────────────────────────────────────────────────────────────────────────
Floor.revalidate();
ok(!Floor.current() || Floor.current().grade === "stale" || Floor.current().h !== HELD,
  "PREMISE — the derived log must actually refuse the floor, or there is nothing to take back.",
  "after revalidate, current() was " + JSON.stringify(Floor.current()));

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
Floor.thinJoin(async () => ({ events: CACHE, fetched: false })).then(() => {
  ok(!Floor.current() || Floor.current().h !== HELD,
    "the floor refused by the derived log was re-adopted from evidence the client already held. " +
    "Nothing was learned between the refusal and the re-adoption, so the client is computing from " +
    "a base the room rejected.",
    "current() is " + JSON.stringify(Floor.current()));

  // A BARE ARRAY SAYS NOTHING ABOUT PROVENANCE and must be read as "learned nothing", or the rule
  // holds only for callers that opted in.
  standUp(DERIVED); Floor.revalidate();
  return Floor.thinJoin(async () => CACHE);
}).then(() => {
  ok(!Floor.current() || Floor.current().h !== HELD,
    "a pager returning a BARE ARRAY was treated as having fetched. Absence read as permission is " +
    "the shape this suite refuses everywhere.",
    "current() is " + JSON.stringify(Floor.current()));

  // ── AND A GENUINE FETCH MUST STILL RECOVER ─────────────────────────────────────────────────
  // The over-block risk is the one that matters: a rule that stops the loop and also strands honest
  // recovery is worse than the loop.
  standUp(DERIVED); Floor.revalidate();
  return Floor.thinJoin(async () => ({ events: CACHE, fetched: true }));
}).then((r) => {
  ok(r && r.mode === "quorum" && Floor.current(),
    "a re-adoption backed by a GENUINE FETCH was refused. The rule is that nothing was learned, " +
    "not that the cache is untouchable — refusing this strands every honest recovery.",
    "thinJoin returned " + JSON.stringify(r));

  // ── AND THE REFUSAL IS ONE DECISION, NOT A STANDING BAN ────────────────────────────────────
  standUp(DERIVED); Floor.revalidate(); Floor.reset();
  ok(standUp(DERIVED) === true && Floor.current() && Floor.current().h === HELD,
    "a client re-entering a room could not take the floor it had refused in the PREVIOUS room. " +
    "Carrying a refusal across a reset turns a guard against one bad move into a permanent loss of " +
    "recovery.",
    "current() was " + JSON.stringify(Floor.current()));

  console.log(
    "[no-local-readopt] PASS — a floor refused by the derived log is not re-adopted on evidence the " +
    "client already held: local evidence may make a client more cautious and never more permissive, " +
    "which is `Continuity`'s rule applied to the floor. A pager saying nothing about provenance is " +
    "read as having learned nothing, so the rule does not hold only for callers that opted in. A " +
    "GENUINE FETCH still recovers and a `reset` clears the refusal, both asserted, because a rule " +
    "that stops the loop and strands honest recovery is worse than the loop. The fixture's authors " +
    "are HIGH-STAFF against the reducer's own defaults — `defaultCheckpointTable` is `null` at " +
    "player and below, so a player-rank fixture selects nothing and reads as an untestable path (" +
    checks + " assertions)");
});
