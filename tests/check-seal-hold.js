// tests/check-seal-hold.js
//
// WAITING FOR A REPAIR MUST BE BOUNDED.
//
// When transport sees a redaction it holds sealing for one repair cycle, so whoever still holds the
// missing event can vouch it. That is right, and the burst case was already handled: a hole arriving
// while a hold is active does not extend it.
//
// What was not handled is a PACED stream of holes. The burst rule stops one hold being extended; it
// does not stop a new one starting every cycle. Measured before this guard existed: one redaction
// per cycle blocked every seal for as long as it continued — for every client INCLUDING the owner,
// because the hold is consulted before the owner-unstick path can bound anything.
//
// The cost was far past sealing. No checkpoints means no floor advancement, which means forgetting
// never runs and the log grows without limit, and a client short of history can never be rescued by
// a floor above its hole. One account, a few events a minute, and no damage to any history at all —
// the attacker only has to redact their own messages, which every client then successfully restores
// from cache while still stopping sealing.
//
// The fix is not new policy. The writer of this hold already reasoned that "against a determined
// attacker we were always going to lose something; the question is only whether we lose the event or
// the room" — and then, with no cap, lost the room. This asserts the completed version: wait for
// repair, and when the waiting has gone on long enough, proceed and SAY SO.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const MB = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
  "backends/backend1/matrixbridge.js"], {}).MatrixBridge;

const CYCLE = 10000;
const CAP = 6 * CYCLE;          // Continuity.STUCK_CYCLES worth, which is what production derives

// ── PART A — one hole still buys exactly one cycle ───────────────────────────────────────────
// The control. A cap that fired early would remove the legitimate wait, which is the whole reason
// the hold exists: a holder who can still re-broadcast needs a window to do it in.
{
  const d1 = MB.sealHoldDecision(1000, 1500, CYCLE, 1000, CAP);
  ok(d1.hold === true && d1.capped === false,
    "A: a fresh hole holds sealing, and is not reported as capped", d1);

  const d2 = MB.sealHoldDecision(1000, 1000 + CYCLE + 1, CYCLE, 1000, CAP);
  ok(d2.hold === false && d2.capped === false,
    "A: APPLIED — and when the cycle elapses with nothing outstanding the hold simply ends. That "
    + "is a different event from the cap firing, and the two must not be reported the same way", d2);

  ok(MB.sealHoldDecision(0, 5000, CYCLE, 0, CAP).hold === false,
    "A: APPLIED — no hole, no hold");
}

// ── PART B — a BURST does not extend one hold (the rule that already existed) ─────────────────
{
  let stamp = MB.holeStampAt(0, 1000, 1000, CYCLE, 0, CAP);
  ok(stamp === 1000, "B: the first hole sets the stamp", stamp);
  for (const t of [1500, 2000, 3000, 5000, 9000]) {
    stamp = MB.holeStampAt(stamp, t, t, CYCLE, 1000, CAP);
  }
  ok(stamp === 1000,
    "B: APPLIED — five more holes inside the active window leave the deadline where it was. Each "
    + "one buying another full cycle is how a burst used to hold the room indefinitely", stamp);
}

// ── PART C — a PACED stream is bounded by the cap ────────────────────────────────────────────
// THE FIX, and this part is written the way the attacker would actually play it. An earlier
// version paced holes exactly one cycle apart, which lets each hold lapse for an instant before
// the next begins — and a first attempt at the fix passed that while being completely defeated in
// practice, because it restarted the run on every momentary lapse. A real attacker restamps a
// millisecond AFTER each expiry: never extending a single hold, always starting a new one.
{
  let stamp = 0, runSince = 0, blocked = 0, total = 0, firstFree = -1;
  for (let k = 0; k < 15; k++) {
    const t = (k === 0) ? 1000 : stamp + CYCLE + 1;      // 1ms after the previous hold lapses
    const fresh = MB.startsNewHoldRun(stamp, t, CYCLE);
    const next = MB.holeStampAt(stamp, t, t, CYCLE, runSince, CAP);
    if (fresh) runSince = next;
    stamp = next;
    const d = MB.sealHoldDecision(stamp, t + CYCLE / 2, CYCLE, runSince, CAP);
    total++;
    if (d.hold) blocked++; else if (firstFree < 0) firstFree = k;
  }
  ok(blocked < total,
    "C: a hole a millisecond after every expiry no longer holds sealing forever. Without the "
    + "aggregate bound this ran indefinitely and the room never banked another checkpoint",
    { blocked, total });
  ok(firstFree >= 5 && firstFree <= 7,
    "C: APPLIED — and it releases after the CAP's worth of holding rather than at some other "
    + "moment, so the bound is the one configured and not an accident of the loop",
    { firstFree, capCycles: CAP / CYCLE });
}

// ── PART C2 — a momentary lapse does NOT restart the run ─────────────────────────────────────
// The rule the first attempt got wrong, pinned directly. "We are not holding at this instant" is
// not the same question as "the trouble is over", and treating them as one defeats the cap.
{
  ok(MB.startsNewHoldRun(1000, 1000 + CYCLE + 1, CYCLE) === false,
    "C2: a hole arriving just after a hold lapses CONTINUES the run — this is the exact instant a "
    + "paced attacker aims for, and calling it a fresh run is what let the cap never accumulate");
  ok(MB.startsNewHoldRun(1000, 1000 + CYCLE * 2 + 1, CYCLE) === true,
    "C2: APPLIED — but a full cycle of genuine silence past the expiry does end the run, so an "
    + "unlucky room is not punished for trouble that actually stopped");
  ok(MB.startsNewHoldRun(0, 5000, CYCLE) === true,
    "C2: APPLIED — and with no prior hole there is nothing to continue");
}

// ── PART D — the release is reported as capped, not as a clean expiry ────────────────────────
{
  const d = MB.sealHoldDecision(1000 + CAP, 1000 + CAP + 1, CYCLE, 1000, CAP);
  ok(d.hold === false && d.capped === true,
    "D: releasing on the cap sets `capped`. A seal that happens over an unrepaired hole is a "
    + "different event from a clean one — the owner-unstick path already announces the other route "
    + "to the same place, and a caller that cannot tell them apart cannot report it", d);
}

// ── PART E — maySeal proceeds on a capped hold, and carries the marker ───────────────────────
// The pure decision is only half of it: the consumer has to act on it. This is where the earlier
// version of the bug lived — the value was produced and nothing downstream changed.
{
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
    "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/dials.js",
    "backends/backend1/session.js", "backends/backend1/checkpoint.js"], {});
  const log = [];
  for (let i = 1; i <= 80; i++) {
    log.push(F.reducerEvent("$e" + i, i, 1000 + i, "@a:hs", F.RANK.player,
      { t: "ddjp.dj.play", p: i > 1 ? "$e" + (i - 1) : null }));
  }
  let HOLD = { hold: true, remainingMs: 5000, cycleMs: CYCLE, capped: false };
  sb.Session.attach({ now: () => 1e6, setInterval: () => 1, clearInterval: () => {}, headCount: () => 0 });
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Checkpoint.attach({
    now: () => 1e6, send: () => {}, log: () => log, held: () => [],
    settings: () => sb.StateDeriver.defaultSettings(), myRank: () => F.RANK.owner,
    myUserId: () => "@own:hs", amOwner: () => true, floorL: () => -1, seedFor: () => ({}),
    holdForWitness: () => HOLD, coverageFor: () => ({}), isLegal: () => true,
  });
  sb.Checkpoint._setStateForTest({ lastOwnSealAt: 0, lastSealHead: 0, sealedSinceArrival: false });

  ok(sb.Checkpoint.maySeal(1e6).reason === "witness-hold",
    "E: while the hold is genuinely active the owner does not seal — the wait is real");

  HOLD = { hold: false, remainingMs: 0, cycleMs: CYCLE, capped: true };
  const v = sb.Checkpoint.maySeal(1e6);
  ok(v.ok === true,
    "E: APPLIED — once the cap releases it, the owner seals. This is the assertion that matters: "
    + "the bound existing in the decision changes nothing unless the consumer acts on it", v);
  ok(v.cappedOver === "hold-capped",
    "E: APPLIED — and the seal records WHY it went ahead, so an operator can see a room sealing "
    + "over unrepaired holes rather than discovering it from a log that grew forever", v);

  HOLD = { hold: false, remainingMs: 0, cycleMs: CYCLE, capped: false };
  const clean = sb.Checkpoint.maySeal(1e6);
  ok(clean.ok === true && !clean.cappedOver,
    "E: APPLIED — and a clean seal carries no such marker, so the marker means something", clean);
}

console.log("[seal-hold] PASS — waiting for a repair is bounded: one hole still buys exactly one "
  + "cycle and a burst of holes inside it buys nothing more, but a PACED stream is released at the "
  + "aggregate cap instead of holding the room forever — which is what one account redacting its "
  + "own messages a few times a minute used to do, to every client including the owner, with no "
  + "damage to any history; the release is reported as capped rather than as a clean expiry, the "
  + "owner acts on it, and the seal records why it went ahead ("
  + checks + " assertions)");
