// tests/_probe-blocked-reason.js
// THE DRIVING PROBE FOR THE TYPED "CAN'T PLAY" REASON (J06), AND ITS ADMISSIBILITY GATE.
//
// One measurement: fold a room in which N people at one rung report the live song blocked with a
// given reason, and report what the two copies of the road tally each concluded.
//
// ── WHY THIS IS A SEPARATE FILE WITH A GATE ──────────────────────────────────────────────────
// Everything this probe can return is a small number or a boolean, and EVERY WAY OF FAILING TO
// REACH THE CODE RETURNS THE SAME VALUES AS "the reason correctly did not count". A declaration
// refused for naming a dead `pi`, a room with nothing playing, a road nobody could meet, a
// vocabulary with no token of the kind asked for — all of them produce `blockedGuestPlus: 0,
// skipWarranted: false`, which is exactly what a working non-counting reason produces.
//
// That is the failure `08-build-and-deploy.md` §Writing a guard records as costing three separate
// audits: three attempts to measure one result returned `null` from every tree INCLUDING their
// controls, so ABSENCE READ AS AGREEMENT each time. So the preconditions are checked SEPARATELY,
// before the comparison, and the probe refuses to answer if one fails — naming which stage.
//
// AND THE GATE IS ITSELF UNTESTED CODE, so `selfTest()` below feeds it deliberately broken inputs
// and shows it catches each one. Without that it certifies everything downstream on its own
// authority.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver, Ranks } = sb;

// ── the vocabulary, DERIVED ──────────────────────────────────────────────────────────────────
// No token is spelled in this file or in the guard that uses it. The list is protocol and lives in
// the reducer; restating it here would be the second copy the whole design forbids, and it would go
// quiet the day a token is added.
const REASONS = StateDeriver.BLOCKED_REASONS || {};
const COUNTING = Object.keys(REASONS).filter((k) => REASONS[k].counts);
const LOCAL = Object.keys(REASONS).filter((k) => !REASONS[k].counts);

// ── the measurement ──────────────────────────────────────────────────────────────────────────
// `reason` is a token, or `null` for an UNTYPED declaration, or a string the vocabulary does not
// contain (to drive the malformed branch).
//
// TWO FOLDS, and the reason is the same one `check-tier-inclusive` records: a SUCCESSFUL escape
// ADVANCES the room, so a fold containing it reports `advance` for the NEXT song — an empty tally
// and `skipWarranted: false`, indistinguishable from a road that never fired. The view is read from
// a fold WITHOUT the escape; the reducer's authorisation from one WITH it.
function measure(opts) {
  const o = opts || {};
  const rungLevel = o.rungLevel;
  const n = (typeof o.n === "number") ? o.n : 1;
  const reason = (o.reason === undefined) ? (COUNTING[0] || null) : o.reason;

  const room = F.playingRoom({ songs: 2 });
  // THE LIVE PI IS THE LAST PLAY. A declaration is legal only if it names the pi live at its own
  // fold position, and these all sort after the whole room log. Naming an earlier play refuses
  // every one of them silently — the stage three earlier audits of this surface died at.
  const pi = room.pis[room.pis.length - 1];

  const decls = [];
  for (let i = 0; i < n; i++) {
    decls.push(F.blockedDecl("$blk" + i, room.lastL + 1 + i, room.startTs + 1000 + i,
      pi, rungLevel, "@r" + i + ":hs", reason));   // DISTINCT senders: the reducer counts people
  }
  const escape = F.reducerEvent("$escape", room.lastL + 1 + n, room.startTs + 400000,
    "@anyone:hs", Ranks.levelOf(Ranks.LADDER[Ranks.LADDER.length - 1].name),
    { t: "ddjp.media.skip", p: pi, blockedGuestPlus: 99, blockedVipPlus: 99 });

  const view = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls)));
  const auth = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls, [escape])));
  const accepted = new Set(view.accepted);
  const adv = view.state.advance;
  // THE SEED, from the SAME log. `deriveBoth` returns state and the accepted set only, so the
  // carry-forward half is read through `buildSeed` — which folds the same events and returns the
  // section a checkpoint would seal. This is the half J06's job entry does not mention and the half
  // that decides whether a client which forgot behind a checkpoint reaches the same verdict.
  const seed = StateDeriver.buildSeed(F.sortLog(room.log.concat(decls)));

  return {
    reason: reason,
    requested: n,
    accepted: decls.filter((d) => accepted.has(d.eventId)).length,
    hasAdvance: !!adv,
    guestPlus: adv ? adv.blockedGuestPlus : null,
    vipPlus: adv ? adv.blockedVipPlus : null,
    skipWarranted: adv ? adv.skipWarranted : null,
    escapeAccepted: new Set(auth.accepted).has("$escape"),
    // the SEED's own view of the same declarations — the carry-forward half, which is what a
    // client that forgot behind a checkpoint folds against
    seedBlocked: (seed && seed.liveDecl && seed.liveDecl.blocked) || null,
    // and the seeded fold's own answer: fold the seed forward over the escape ALONE, which is what
    // a client that banked the declarations and dropped them actually does.
    seededEscapeAccepted: (() => {
      try {
        const after = StateDeriver.deriveBoth([escape], seed);
        return new Set(after.accepted).has("$escape");
      } catch (e) { return null; }
    })(),
    livePi: pi,
  };
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Each precondition is its own check with its own name, run BEFORE any comparison. `expectAccepted`
// says whether the fixture intends its declarations to be folded: the malformed-token case intends
// them REFUSED, so "0 accepted" is the result there rather than a broken fixture — and the gate has
// to be told which, or it cannot tell a finding from a fixture that never arrived.
function admissible(r, opts) {
  const o = opts || {};
  const expectAccepted = (o.expectAccepted === undefined) ? true : o.expectAccepted;
  const problems = [];
  if (!r || typeof r !== "object") { return { ok: false, problems: ["no reading at all"] }; }
  if (!r.livePi) problems.push("stage: no live playing — the fixture's room never started a song");
  if (expectAccepted && r.accepted !== r.requested) {
    problems.push("stage: declarations REFUSED, " + r.accepted + " of " + r.requested +
      " accepted — the tally was never reached, so every count below is a count of nothing");
  }
  if (!expectAccepted && r.accepted !== 0) {
    problems.push("stage: declarations were ACCEPTED (" + r.accepted + " of " + r.requested +
      ") when this case exists to prove they are refused");
  }
  if (!r.hasAdvance) {
    problems.push("stage: no advance view — nothing is playing at the end of the fold, so " +
      "`skipWarranted` is absent rather than false");
  }
  if (typeof r.escapeAccepted !== "boolean") {
    problems.push("stage: the authorisation fold produced no verdict on the escape");
  }
  return { ok: problems.length === 0, problems: problems };
}

// ── THE GATE'S OWN TEST ──────────────────────────────────────────────────────────────────────
// Feed it inputs that are broken in each way it claims to catch, and require that it refuses each.
// Then feed it a good one and require that it passes — a gate that refuses everything is as useless
// as one that refuses nothing, and only the pair distinguishes them.
function selfTest() {
  const cases = [
    { name: "no live playing", r: { livePi: null, accepted: 1, requested: 1, hasAdvance: true, escapeAccepted: false } },
    { name: "declarations refused", r: { livePi: "$p", accepted: 0, requested: 5, hasAdvance: true, escapeAccepted: false } },
    { name: "partial tally", r: { livePi: "$p", accepted: 3, requested: 5, hasAdvance: true, escapeAccepted: false } },
    { name: "no advance view", r: { livePi: "$p", accepted: 1, requested: 1, hasAdvance: false, escapeAccepted: false } },
    { name: "no escape verdict", r: { livePi: "$p", accepted: 1, requested: 1, hasAdvance: true, escapeAccepted: null } },
    { name: "nothing at all", r: null },
  ];
  const missed = [];
  for (const c of cases) if (admissible(c.r).ok) missed.push(c.name);
  // and the inverse: a sound reading must be admitted, or the gate blocks every real measurement
  const good = { livePi: "$p", accepted: 5, requested: 5, hasAdvance: true, escapeAccepted: true };
  const rejectedGood = admissible(good).ok ? null : admissible(good).problems;
  // and the expectAccepted inversion must work in both directions
  const refusedCase = { livePi: "$p", accepted: 0, requested: 2, hasAdvance: true, escapeAccepted: false };
  const inversionOk = admissible(refusedCase, { expectAccepted: false }).ok
    && !admissible(good, { expectAccepted: false }).ok;
  return { missed: missed, rejectedGood: rejectedGood, inversionOk: inversionOk };
}

module.exports = { measure, admissible, selfTest, REASONS, COUNTING, LOCAL, StateDeriver, Ranks };
