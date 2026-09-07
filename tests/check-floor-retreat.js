// tests/check-floor-retreat.js
//
// J54 — A FLOOR THAT STOPS VERIFYING IS REPLACED BY THE NEWEST ONE THAT STILL DOES.
//
// `revalidate` already finds the answer and throws it away. `select` returns the best group that
// verifies against the derived log; when that group sits BELOW the floor in hand, the result is
// discarded and the floor is weakened instead. Driven here on a real chain: a client holding a
// valid floor at the second cut ends up `{moved:true, reason:"withdrawn", why:"replaced-by-older"}`
// — no floor at all, while a floor that PASSES sits in `select`'s own return value.
//
// The two outcomes it takes instead are both worse than the answer in hand: `stale` means computing
// from a floor that FAILED verification, and `withdrawn` means computing from none.
//
// WHY IT WAS DELETED BEFORE, AND WHY THAT DOES NOT APPLY. The earlier version announced the older
// floor as `moved` — the kind the TRIM subscriber acts on — so the forget boundary followed the
// floor DOWN and the re-page subscriber never fired. Driven then: seed at 6, oldest event actually
// held at 15, the room reporting a state six songs old with an empty history and nothing thrown.
// The idea was not wrong; the ANNOUNCEMENT was.
//
// SO A RETREAT IS ITS OWN KIND, AND THE POINT IS THAT NOTHING SUBSCRIBES TO IT. Measured: the trim
// subscriber keys on `adopted`/`moved` and must not follow a retreat down; the re-page subscriber
// keys on `demoted`/`withdrawn` and must not fire, because after a retreat this client HOLDS a floor
// that verifies. Both are asserted below rather than reasoned about.
//
// AND ONLY WHILE THE CLIENT STILL HOLDS EVERYTHING. A trimmed client may have forgotten below the
// older floor, and computing from a mark beneath its own holdings is the failure above exactly.
// Untrimmed means the log reaches genesis. A trimmed client falls through unchanged — the new path
// runs only where it is provably safe rather than being made general and then guarded.
//
// THE FIXTURE IS THE POINT OF THIS FILE AS MUCH AS THE RULE. `F.chainOf` is what makes
// `revalidate`'s selection path reachable at all; before it existed six attempts failed on their own
// premises. Two things it taught, both load-bearing here: a group needs TWO checkpoints or
// `chainVerifies` refuses before examining anything, and OWNER-authored checkpoints end the search
// on authority with NO recompute — so the authors below are substitutes and the owner bar is set out
// of reach, or the chain is never consulted and this guard would pass without exercising it.

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
  assert.ok(cond, "[floor-retreat] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

const LOG = F.sortLog([
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: StateDeriver.defaultSettings() }),
].concat(F.playingRoom({ songs: 8 }).log));

const CHAIN = F.chainOf(C, LOG, [4, 9, 14], "@hs1:hs");
const AUTHORS = ["@hs1:hs", "@hs2:hs", "@hs3:hs"];   // distinct, so a quorum is real

// The client's log has a hole above the second cut: the full chain no longer verifies, the older
// pair still does. That is precisely "my floor stopped verifying and an older one still holds".
const HOLED = LOG.filter((e) => e.eventId !== LOG[12].eventId);

// Owner bar out of reach so the search must CHAIN rather than end on authority.
const SETTINGS = { checkpointTable: [{ enough: 9 }, { enough: 2 }, { enough: 2 }, { enough: 2 },
                                     { enough: 2 }, { enough: 2 }, { enough: 2 }] };

function standUp(trimmed) {
  const emissions = [];
  Floor.reset();
  Floor.attach({ log: () => HOLED, myRank: () => 80, trimmed: () => trimmed,
                 settings: () => SETTINGS });
  Floor.onChange((ev) => emissions.push(ev.kind));
  CHAIN.forEach((c, i) => Floor.remember(c, 80, AUTHORS[i], 1000 + i));
  Floor._setTrustedForTest({ n: 3, h: CHAIN[2].h, floorL: CHAIN[2].floorL, grade: "quorum",
                             covers: CHAIN[2].covers, seed: CHAIN[2].seed,
                             prev: CHAIN[2].prev, thin: false });
  emissions.length = 0;
  return emissions;
}

// ── PREMISES: the scenario is the one described, not one the fixture invented ────────────────
ok(Floor.chainVerifies(CHAIN, HOLED) === false,
  "PREMISE — the full chain must NOT verify against this client's log, or the floor never stops " +
  "verifying and nothing below is exercised.");

ok(Floor.chainVerifies(CHAIN.slice(0, 2), HOLED) === true,
  "PREMISE — the older pair MUST still verify, or there is no floor to retreat to and a refusal " +
  "here would be correct rather than the defect.");

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────
let emissions = standUp(false);
ok(Floor.current() && Floor.current().floorL === CHAIN[2].floorL,
  "PREMISE — the client must start on the newest floor.",
  "current() was " + JSON.stringify(Floor.current()));

const r = Floor.revalidate();
const now = Floor.current();

// THE TARGET IS THE OLDEST CUT OF THE VERIFYING QUORUM, NOT THE NEAREST FLOOR BELOW. `select`'s
// own rule: three peers sealing at 100, 120 and 140 have each implicitly attested to everything up
// to 100, so the quorum is real at the OLDEST cut and thins above it. Expecting the nearest cut is
// the natural guess and it is wrong — measured here as `floorL 4`, not 9.
ok(now && now.floorL === CHAIN[0].floorL,
  "the floor stopped verifying and the client did not fall back to the older floor that still " +
  "does. `select` had already found it; `revalidate` discarded it, leaving the client computing " +
  "from a floor that FAILED verification or from none at all — both worse than the answer in hand.",
  "revalidate returned " + JSON.stringify(r) + "; floor is now " +
  JSON.stringify(now && now.floorL) + ", expected " + CHAIN[0].floorL);

// ── AND THE ANNOUNCEMENT MUST BE ONE NOTHING ACTS ON ─────────────────────────────────────────
ok(emissions.indexOf("moved") < 0,
  "a retreat was announced as `moved`, the kind the TRIM subscriber acts on — so the forget " +
  "boundary would follow the floor DOWN. That is exactly the failure that got the earlier version " +
  "of this deleted.",
  "emissions were " + JSON.stringify(emissions));

ok(emissions.indexOf("demoted") < 0 && emissions.indexOf("withdrawn") < 0,
  "a retreat was announced as `demoted` or `withdrawn`, which the RE-PAGE subscriber acts on — so " +
  "a client that now holds a perfectly good floor would immediately go looking for another.",
  "emissions were " + JSON.stringify(emissions));

ok(emissions.indexOf("retreated") >= 0,
  "a retreat announced nothing. It is a real change of compute base and has to be visible, or the " +
  "only record that the room moved backwards is absent.",
  "emissions were " + JSON.stringify(emissions));

// ── A TRIMMED CLIENT MUST NOT RETREAT ────────────────────────────────────────────────────────
emissions = standUp(true);
Floor.revalidate();
ok(emissions.indexOf("retreated") < 0,
  "a TRIMMED client retreated. It may have forgotten everything below that floor, so it would be " +
  "computing from a mark beneath its own holdings — the precise failure that got the earlier " +
  "version deleted (seed at 6, oldest event held at 15).",
  "emissions were " + JSON.stringify(emissions));

console.log(
  "[floor-retreat] PASS — a floor that stops verifying is replaced by the newest one that still " +
  "does, instead of the client computing from a floor that FAILED or from none at all. `select` " +
  "already found that floor; this stops it being discarded. The retreat is its own emission kind and " +
  "the point is that NOTHING subscribes to it: asserted not `moved` (which the trim subscriber acts " +
  "on, and following a retreat down is what got the earlier version deleted) and not " +
  "`demoted`/`withdrawn` (which would send a client now holding a good floor looking for another). A " +
  "TRIMMED client does not retreat, because it may have forgotten below the older floor. Both " +
  "premises are asserted, so a fixture that stopped producing the scenario fails here rather than " +
  "passing quietly (" + checks + " assertions)");
