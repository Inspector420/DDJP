// tests/check-floor-retreat.js
// SUBJECT: backends/backend1/floor.js, backends/backend1/streammanager.js
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
// AND ONLY WHERE THIS DEVICE CAN PROVE THE OLDER FLOOR (retreat by proof, `ddjp_550`). Computing from
// a mark beneath its own holdings is the failure above exactly, and the proof is what rules it out:
// `StreamManager.canProve` answers yes for the floor this device trimmed under, or for one whose seed
// rebuilds from what it holds. BEING TRIMMED IS NOT THE TEST, IN EITHER DIRECTION, and the three cases
// below are chosen to show both: a trimmed device that can prove the older floor retreats (PART B), and
// an untrimmed one that cannot does not (PART C).
//
// WIRED AS THE BRIDGE WIRES IT, AGAINST THE REAL MODULE. This guard used to attach Floor with no
// `canProve`, so it drove the no-proof fallback (`trimmed ? needs-fetch : proved`) — a branch the one
// production attach (matrixbridge `_wireConcepts`, both engines) never takes, since it always supplies
// `canProve` and `Floor.reset()` keeps the env. Measured before this change: the guard stayed GREEN
// with `canProve` ignored in floor.js. The fallback is therefore NOT kept as a case here; production
// cannot reach it. Each part gets its own sandbox. That used to be required: `reset()` left the trim
// proof (`_heldBaseH`) behind, so a part could inherit another's (`ddjp_566` clears it, held by
// `check-reset-proof`). It is kept because a fresh sandbox is a certainty a reset is only a claim of.
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

const FILES = [
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/streammanager.js",
];
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const sandbox = () => loadInContext(FILES, { Logger: quiet });
const C = sandbox();
const { StateDeriver } = C;
let Floor = C.Floor;   // re-bound per part by standUp

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

const asTrusted = (c) => ({ n: c.n, h: c.h, floorL: c.floorL, grade: "quorum", covers: c.covers,
                           seed: c.seed, prev: c.prev, thin: false });

// One device: a fresh sandbox, its held log, optionally trimmed under `trimUnder` by the real
// `trimToFloor`, then standing on the newest floor. Floor is attached EXACTLY as matrixbridge's
// `_wireConcepts` attaches it — `proofLog`, `_trimState`, and `canProve` behind the same try/catch —
// with every `canProve` answer recorded, so each part can assert the PROOF decided, not a fallback.
function standUp(log, trimUnder) {
  const sb = sandbox(), SM = sb.StreamManager;
  Floor = sb.Floor;
  const emissions = [], proofs = [];
  Floor.reset(); SM.reset(); SM._setLogForTest(log);
  Floor.attach({
    log: () => { try { return SM.proofLog ? SM.proofLog() : SM.getLog(); } catch (e) { return []; } },
    settings: () => SETTINGS,
    myRank: () => 80,
    trimmed: () => { try { return SM._trimState() !== null; } catch (e) { return false; } },
    canProve: (f) => { let r; try { r = SM.canProve(f); } catch (e) { r = { ok: false, needsFetch: true }; } proofs.push(r); return r; },
  });
  Floor.onChange((ev) => emissions.push(ev.kind));
  CHAIN.forEach((c, i) => Floor.remember(c, 80, AUTHORS[i], 1000 + i));
  let dropped = 0;
  if (trimUnder) { Floor._setTrustedForTest(asTrusted(trimUnder)); dropped = SM.trimToFloor(); }
  Floor._setTrustedForTest(asTrusted(CHAIN[2]));
  emissions.length = 0;
  return { emissions, proofs, SM, dropped };
}

// ── PREMISES: the scenario is the one described, not one the fixture invented ────────────────
ok(Floor.chainVerifies(CHAIN, HOLED) === false,
  "PREMISE — the full chain must NOT verify against this client's log, or the floor never stops " +
  "verifying and nothing below is exercised.");

ok(Floor.chainVerifies(CHAIN.slice(0, 2), HOLED) === true,
  "PREMISE — the older pair MUST still verify, or there is no floor to retreat to and a refusal " +
  "here would be correct rather than the defect.");

// ── PART A — UNTRIMMED, PROVED BY REBUILD: THE RETREAT ───────────────────────────────────────
let dev = standUp(HOLED, null);
ok(Floor.current() && Floor.current().floorL === CHAIN[2].floorL,
  "PREMISE — the client must start on the newest floor.",
  "current() was " + JSON.stringify(Floor.current()));

const r = Floor.revalidate();
const now = Floor.current();

ok(dev.proofs.length === 1 && dev.proofs[0].ok === true && !dev.proofs[0].reason,
  "PREMISE — PART A's retreat must be decided by `canProve` proving the older floor by REBUILD (no " +
  "reason token), or this part is reading a fallback rather than the production path.",
  "canProve answered " + JSON.stringify(dev.proofs));

// THE TARGET IS THE OLDEST CUT OF THE VERIFYING QUORUM, NOT THE NEAREST FLOOR BELOW. `select`'s
// own rule: three peers sealing at 100, 120 and 140 have each implicitly attested to everything up
// to 100, so the quorum is real at the OLDEST cut and thins above it. Expecting the nearest cut is
// the natural guess and it is wrong — measured here as `floorL 4`, not 9.
ok(now && now.floorL === CHAIN[0].floorL,
  "the floor stopped verifying and the client did not fall back to the older floor it can PROVE. " +
  "`select` had already found it and `canProve` had proved it; leaving the client computing from a " +
  "floor that FAILED verification or from none at all is worse than the answer in hand.",
  "revalidate returned " + JSON.stringify(r) + "; floor is now " +
  JSON.stringify(now && now.floorL) + ", expected " + CHAIN[0].floorL);

// ── AND THE ANNOUNCEMENT MUST BE ONE NOTHING ACTS ON ─────────────────────────────────────────
function announcedAsRetreat(emissions, part) {
  ok(emissions.indexOf("moved") < 0,
    part + ": a retreat was announced as `moved`, the kind the TRIM subscriber acts on — so the forget " +
    "boundary would follow the floor DOWN. That is exactly the failure that got the earlier version " +
    "of this deleted.",
    "emissions were " + JSON.stringify(emissions));
  ok(emissions.indexOf("demoted") < 0 && emissions.indexOf("withdrawn") < 0 && emissions.indexOf("needs-fetch") < 0,
    part + ": a retreat was announced as `demoted`, `withdrawn` or `needs-fetch`, which the RE-PAGE and " +
    "FETCH-BACK subscribers act on — so a client that now stands on a floor it has proved would " +
    "immediately go looking for another.",
    "emissions were " + JSON.stringify(emissions));
  ok(emissions.indexOf("retreated") >= 0,
    part + ": a retreat announced nothing. It is a real change of compute base and has to be visible, " +
    "or the only record that the room moved backwards is absent.",
    "emissions were " + JSON.stringify(emissions));
}
announcedAsRetreat(dev.emissions, "PART A");

// ── PART B — TRIMMED, AND IT CAN PROVE THE OLDER FLOOR: IT RETREATS ──────────────────────────
// The device trimmed under the oldest cut by the real `trimToFloor`, which records that floor as the
// one its held log folds from. When the newest floor stops verifying, the older one is the floor it
// trimmed under — proved here already — so it retreats. Before retreat by proof this exact device was
// asserted NOT to retreat, because the test was "trimmed?" rather than "proved?".
dev = standUp(HOLED, CHAIN[0]);
ok(dev.SM._trimState() === CHAIN[0].floorL && dev.dropped > 0,
  "PREMISE — PART B's device must really have trimmed under the oldest cut, or it is not the trimmed " +
  "case.", "trimState " + JSON.stringify(dev.SM._trimState()) + ", dropped " + dev.dropped);
Floor.revalidate();
ok(dev.proofs.length === 1 && dev.proofs[0].ok === true && dev.proofs[0].reason === "trimmed-under",
  "PREMISE — PART B's retreat must be decided by `canProve` recognising the floor this device trimmed " +
  "under.", "canProve answered " + JSON.stringify(dev.proofs));
ok(Floor.current() && Floor.current().floorL === CHAIN[0].floorL,
  "a TRIMMED device that can PROVE the older floor did not retreat to it. Being trimmed is not the " +
  "test; the proof is — and this floor is the one it trimmed under.",
  "floor is now " + JSON.stringify(Floor.current() && Floor.current().floorL));
announcedAsRetreat(dev.emissions, "PART B");

// ── PART C — UNTRIMMED, AND IT CANNOT PROVE THE OLDER FLOOR: NO RETREAT ──────────────────────
// A thin holder: nothing trimmed, but the room's start is not held, so the older floor (the first,
// `prev` null) cannot be rebuilt from what it holds. The chain still verifies — that needs only the
// events BETWEEN members — so `select` still hands the older floor over. Holding everything it has is
// not the test either: it must not stand on a floor it cannot prove.
dev = standUp(HOLED.filter((e) => e.l > 2), null);
ok(dev.SM._trimState() === null,
  "PREMISE — PART C's device must be untrimmed.", "trimState " + JSON.stringify(dev.SM._trimState()));
const rc = Floor.revalidate();
ok(dev.proofs.length === 1 && dev.proofs[0].ok === false && dev.proofs[0].needsFetch === true,
  "PREMISE — PART C must reach the retreat branch and have `canProve` answer that the proof needs " +
  "older events, or this part is not about a floor this device cannot prove.",
  "canProve answered " + JSON.stringify(dev.proofs));
ok(dev.emissions.indexOf("retreated") < 0 && !(Floor.current() && Floor.current().floorL === CHAIN[0].floorL),
  "a device RETREATED to a floor it cannot PROVE. It would be computing from a seed it has never " +
  "rebuilt — the precise failure that got the earlier version deleted (seed at 6, oldest event held " +
  "at 15).", "revalidate returned " + JSON.stringify(rc) + "; emissions " + JSON.stringify(dev.emissions));
ok(dev.emissions.indexOf("withdrawn") >= 0,
  "an UNTRIMMED device that cannot prove the older floor must WITHDRAW (the re-page subscriber's kind) " +
  "— it still holds its own history, so falling back to it is safe.",
  "emissions were " + JSON.stringify(dev.emissions));

console.log(
  "[floor-retreat] PASS — a floor that stops verifying is replaced by an older one this device can " +
  "PROVE, instead of the client computing from a floor that FAILED or from none at all. Driven through " +
  "the real `StreamManager.canProve`, attached as the bridge attaches it, so the proof decides rather " +
  "than a fallback production never takes. The retreat is its own emission kind and the point is that " +
  "NOTHING subscribes to it: asserted not `moved` (which the trim subscriber acts on, and following a " +
  "retreat down is what got the earlier version deleted) and not `demoted`/`withdrawn`/`needs-fetch` " +
  "(which would send a client now on a proved floor looking for another). Being trimmed is not the test " +
  "in either direction: a trimmed device that trimmed under the older floor retreats to it, and an " +
  "untrimmed one that cannot rebuild it withdraws instead. Every premise is asserted, so a fixture that " +
  "stopped producing its scenario fails here rather than passing quietly (" + checks + " assertions)");
