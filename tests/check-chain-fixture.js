// tests/check-chain-fixture.js
//
// THE CHAIN BUILDER IS GUARDED, BECAUSE A FIXTURE NOTHING EXERCISES ROTS SILENTLY.
//
// `F.chainOf` exists so guards can reach `Floor`'s selection path at all. Until v321 nothing could:
// `chainVerifies` returns false at `list.length < 2` before examining anything, and a hand-written
// `h` is refused by `verify` at `remember`'s door — so candidates vanished and a guard reported a
// floor problem that was really a fixture problem. Six fixtures were attempted against this module
// in one session and all six failed on their own premises.
//
// A BUILDER THAT QUIETLY STOPS PRODUCING VERIFYING CHAINS IS WORSE THAN NOT HAVING ONE. Every guard
// built on it would go green on candidates the floor never accepted — absence reported as agreement,
// which is the failure shape this whole suite is arranged around. So the builder is asserted here
// directly: what it produces verifies, and it stops verifying when the evidence is genuinely broken.
//
// THE SECOND HALF IS THE LOAD-BEARING ONE. A builder that returned chains verifying against ANY log
// would pass the first assertion and be useless — it would make every floor guard green by
// construction. So a hole is punched in the log and the same chain must be REFUSED.

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
  assert.ok(cond, "[chain-fixture] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const LOG = F.sortLog([
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log));

const CUTS = [4, 9, 14];
const chain = F.chainOf(C, LOG, CUTS, "@owner:hs");

// ── IT PRODUCES WHAT IT CLAIMS ───────────────────────────────────────────────────────────────
ok(chain.length === CUTS.length,
  "the builder returned a different number of checkpoints than cuts asked for.",
  "cuts " + CUTS.length + ", got " + chain.length);

ok(chain.every((c) => Floor.verify(c)),
  "a checkpoint the builder produced is refused by `Floor.verify`, so `remember` would drop it at " +
  "the door and every candidate would silently vanish — the exact failure this builder exists to " +
  "end.",
  JSON.stringify(chain.map((c) => Floor.verify(c))));

// ── IT VERIFIES AS A CHAIN ───────────────────────────────────────────────────────────────────
ok(Floor.chainVerifies(chain, LOG) === true,
  "the chain does not verify against the log it was built from. Without this every guard reaching " +
  "for the floor's selection path is testing a candidate the floor would never accept.",
  "chainVerifies returned false");

// A PAIR is the minimum `chainVerifies` will look at, and guards will use pairs.
ok(Floor.chainVerifies(chain.slice(0, 2), LOG) === true,
  "a two-checkpoint slice of a valid chain does not verify, so the smallest usable group is not " +
  "buildable.",
  "chainVerifies on the first two returned false");

// ── AND IT MUST BE ABLE TO FAIL ──────────────────────────────────────────────────────────────
// Punch a hole in the middle segment. The recomputed seed then differs from the sealed one and the
// fingerprint must not match. A builder whose chains verify against anything would make every floor
// guard green by construction, which is worse than having no builder at all.
const holed = LOG.filter((e) => e.eventId !== LOG[7].eventId);
ok(Floor.chainVerifies(chain, holed) === false,
  "the chain still verified against a log with an event REMOVED from the middle of a covered " +
  "segment. A builder that verifies against anything makes every guard built on it green by " +
  "construction — absence reported as agreement.",
  "chainVerifies returned true against a holed log");

// ── AND A SINGLE CHECKPOINT IS NOT A CHAIN ───────────────────────────────────────────────────
// Recorded because it is the trap that cost six fixtures: one checkpoint returns false before
// anything is examined, so a guard built on one reads as a floor defect and is a fixture defect.
ok(Floor.chainVerifies(chain.slice(0, 1), LOG) === false,
  "a single checkpoint verified as a chain, which contradicts `chainVerifies`'s own minimum and " +
  "would make one-checkpoint fixtures look valid.",
  "chainVerifies on one checkpoint returned true");

console.log(
  "[chain-fixture] PASS — `F.chainOf` builds checkpoint chains the floor actually accepts: each " +
  "one passes `Floor.verify` so `remember` will take it, the chain verifies against the log it was " +
  "built from, and a two-checkpoint slice verifies so the smallest usable group is reachable. It is " +
  "also proven able to REFUSE — a hole punched in a covered segment makes the same chain fail, " +
  "because a builder that verified against anything would make every guard resting on it green by " +
  "construction. A single checkpoint is asserted NOT to verify, which is the trap that cost six " +
  "fixtures before this existed: it returns false before anything is examined, so a guard built on " +
  "one reports a floor defect that is really its own (" + checks + " assertions)");
