// tests/check-tier-inclusive.js
// A RANK BAND INCLUDES ITS OWN RUNG, AND THE TWO PLACES THAT COUNT IT MUST AGREE.
//
// Found by the J39 sweep, filed as F3: three `<= tier` comparisons decide who counts toward a
// quorum, and nothing in the suite could tell `<=` from `<`.
//
//   `t <= vTier`     statederiver.js:769  the reducer's own re-validation of `ddjp.media.skip`
//   `t <= vipTier`   statederiver.js:981  the SAME tally, in the derived `advance` view
//   `sat <= myTier`  vouch.js:430         `bandOf`'s "this has left my list" early return
//
// ── THE DIRECTION IS THE OPPOSITE OF THE INTUITION ───────────────────────────────────────────
// `<=` on a TIER is `>=` on a RANK. The two scales have zeros that mean opposite things
// (`../docs/main/05-matrix.md` §Ranks), so `t <= vipTier` means *vip or STRONGER*, and flipping it
// to `<` removes VIP itself and leaves staff-and-above. The bar moves UP a rung: a road stops
// firing, a song that should have been escapable is not. Anyone hunting for something firing too
// easily is looking the wrong way and will find nothing, which reads as agreement.
//
// ── WHY THE RULE IS "THE TWO MUST AGREE" AND NOT "THE TALLY MUST BE 4" ───────────────────────
// The tally is computed TWICE — once in the reducer, which decides whether an authored escape is
// legal, and once in the `advance` view, which is what `MediaBlocked` reads to decide whether to
// author one at all. That is one rule with two copies, which P7 says will drift, and drift is
// exactly what the flip produces. Measured, one site at a time:
//
//   flip the REDUCER's copy   -> the view still says `skipWarranted: true`, so every client keeps
//                                authoring the escape, and every client keeps refusing it. The
//                                room cannot escape a dead song by the authority road while its
//                                own advance view goes on telling it to try.
//   flip the VIEW's copy      -> `skipWarranted: false`, so nobody ever authors one, and the
//                                reducer's willingness to accept it is never exercised. Silence
//                                rather than refusal, which is the harder of the two to notice.
//
// So PART B asserts the two copies agree, which catches EITHER site alone. And PART A asserts the
// band boundary itself, which is what catches BOTH AT ONCE — the case one-at-a-time mutation is
// structurally blind to (`09-roadmap.md` §J39), since two flipped copies agree with each other
// perfectly while both are wrong.
//
// ── THIS FILE OWNS THE RANK AXIS. IT HOLDS THE REASON AXIS CONSTANT, AND THAT IS DELIBERATE ──
// The tally reads TWO things about each reporter: the rung they hold, and — since J06 — the typed
// reason their declaration carries. This file varies the first and pins every fixture to a single
// counting reason (`_fixtures.blockedDecl`'s default, itself derived from the reducer's vocabulary).
// So the agreement PART B asserts is agreement *at one point on the reason axis*.
//
// **Recorded because the J06 handoff predicted the opposite, and the prediction was measured
// wrong.** A reason filter added to one copy of the tally and not the other was expected to turn
// this file red. It does not: with both copies filtering and the fixtures typed, a tree where only
// one filters is byte-identical here. That is `09-roadmap.md` §8's *a control that varies the wrong
// axis* — the assertions are load-bearing for the rank claim and say nothing about the reason one,
// which is the hardest version to see, because the guard is not decorative.
//
// The reason axis and the agreement across it are `check-blocked-reason`'s subject. Do not add
// reason cases here; two files varying one axis each is the split, and a third copy of either would
// be the drift both exist to catch.
//
// ── DERIVED, NEVER RESTATED ──────────────────────────────────────────────────────────────────
// **No rank name appears in this file.** The bands are read off the shape of `skipRoads` itself —
// a road's keys are `<rung>Plus`, so the rungs it bands by are derivable — and each band's rung is
// resolved through `Ranks`. A road banding by a third rung would be covered the day it is added.
// The ladder walk for PART C comes from `Ranks.LADDER`. A guard naming `vip` in a string would
// have restated the ladder, and would go quiet the day somebody inserts a rung.
//
// ── WHAT THE SUITE ALREADY COVERED, AND WHY THESE THREE DID NOT ──────────────────────────────
// The family has SEVEN sites, and the four absent from the survivor list are absent because they
// already fail — which is the point of the warning at the top of `CLASSIFIED-SURVIVORS.md`. Driven
// here, each flipped alone:
//   statederiver `t <= gTier`             -> RED  (check-blocked-skip)
//   statederiver `t <= guestTier`         -> RED  (check-fixtures)
//   trustpolicy  `sat <= _observerTier`   -> RED  (check-vouch, check-checkpoint, check-retention-by-duty)
//   vouch        `tierOf(v.r) <= myTier`  -> RED  (check-vouch)
// The pattern is not luck: every existing fixture reaches a skip road through the CROWD road, which
// bands by the weakest rung a road can name, so the guest band is exercised everywhere and the vip
// band nowhere. The bar that needed rank was the one nothing tested.

const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[tier-inclusive] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver, Ranks } = sb;

// ── THE BANDS, DERIVED FROM THE ROAD SHAPE ───────────────────────────────────────────────────
// A road is `{ <rung>Plus: n, ... }`, so the rungs the tally bands by are the road's own keys.
// Nothing here is written down; a road gaining a third band is picked up by this scan.
const D = StateDeriver.defaultSettings();
const roads = Array.isArray(D.skipRoads) ? D.skipRoads : [];
const bandKeys = [];
for (const r of roads) {
  for (const k of Object.keys(r || {})) {
    if (/Plus$/.test(k) && bandKeys.indexOf(k) < 0) bandKeys.push(k);
  }
}
const bands = bandKeys.map((key) => {
  const rungName = key.replace(/Plus$/, "");
  const level = Ranks.levelOf(rungName);
  return {
    key: key,
    rungName: rungName,
    level: level,
    tier: (typeof level === "number") ? Ranks.tierOf(level) : null,
    // the field the derived view exposes for this band
    viewField: "blocked" + key.charAt(0).toUpperCase() + key.slice(1),
    // the largest requirement any road places on this band
    maxNeed: roads.reduce((m, r) => Math.max(m, (r && r[key]) || 0), 0),
  };
});

ok(bands.length >= 2,
  "setup: the scan must find at least two rank bands in `skipRoads` — with one band there is no " +
  "control, and with none this file asserts nothing at all", bandKeys);
for (const b of bands) {
  ok(typeof b.level === "number" && b.tier !== null,
    "setup: band `" + b.key + "` must name a real ladder rung — a band the ladder does not know " +
    "cannot be placed on either side of any comparison, which is the same hole as no band at all", b);
}

// One rung WEAKER than a given tier, or null at the bottom of the ladder. This is the exclusive
// side of the boundary: a reporter here must NOT count toward that band.
function weakerRungThan(tier) {
  const next = Ranks.LADDER[tier + 1];
  return next ? next : null;
}

// ── the fixture: N people at one rung report the live song blocked ───────────────────────────
// TWO FOLDS, because the escape consumes the thing the view describes: `state.advance` is computed
// for whatever is playing NOW, so a fold including a SUCCESSFUL escape has already moved on and
// reports an empty tally for the next song — `skipWarranted: false`, which is indistinguishable
// from a road that never fired. The view is read without the escape; the authorisation with it.
function reportBlocked(rungLevel, n) {
  const room = F.playingRoom({ songs: 2 });
  // THE LIVE PI IS THE LAST PLAY. A declaration is legal only if it names the pi live AT ITS OWN
  // FOLD POSITION, and these all sort after the whole room log — naming the first play refuses
  // every one of them silently and empties the tally, which is the same reading the flip produces.
  const pi = room.pis[room.pis.length - 1];

  const decls = [];
  for (let i = 0; i < n; i++) {
    decls.push(F.blockedDecl("$blk" + i, room.lastL + 1 + i, room.startTs + 1000 + i,
      pi, rungLevel, "@r" + i + ":hs"));      // DISTINCT senders: the reducer counts people
  }
  const escape = F.reducerEvent("$escape", room.lastL + 1 + n, room.startTs + 400000,
    "@anyone:hs", Ranks.levelOf(Ranks.LADDER[Ranks.LADDER.length - 1].name),
    { t: "ddjp.media.skip", p: pi, blockedGuestPlus: 99, blockedVipPlus: 99 });

  const view = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls)));
  const auth = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls, [escape])));
  const accView = new Set(view.accepted);
  const adv = view.state.advance;
  return {
    declarationsAccepted: decls.filter((d) => accView.has(d.eventId)).length,
    expectedDeclarations: n,
    hasAdvance: !!adv,
    counts: adv || {},
    skipWarranted: adv ? adv.skipWarranted : null,
    escapeAccepted: new Set(auth.accepted).has("$escape"),
  };
}

// ══ PART A — EVERY BAND INCLUDES ITS OWN RUNG, AND EXCLUDES THE NEXT ONE DOWN ══════════════════
// The inclusive-at-the-endpoint / exclusive-one-step-outside shape of `check-setting-endpoints`,
// applied to a ladder instead of a number line. This is the part that survives BOTH copies being
// flipped together, because it asserts the tally's value rather than the two copies' agreement.
let bandChecks = 0;
for (const b of bands) {
  // INCLUSIVE: one reporter at exactly this band's rung must be counted by it.
  const at = reportBlocked(b.level, 1);
  ok(at.declarationsAccepted === at.expectedDeclarations,
    "A: setup — the blocked declaration for band `" + b.key + "` was REFUSED, so the tally was " +
    "never reached and any count below is a count of nothing", at);
  ok(at.hasAdvance, "A: setup — no advance view for band `" + b.key + "`", at);
  ok(at.counts[b.viewField] === 1,
    "A: a reporter at EXACTLY the `" + b.rungName + "` rung must count toward the `" + b.key +
    "` band. `<= tier` means *this rung or stronger*, so the rung the band is named for is the " +
    "endpoint — and an endpoint a bar excludes is a bar one rung higher than the room configured",
    { band: b.key, field: b.viewField, got: at.counts[b.viewField], expected: 1 });
  bandChecks++;

  // EXCLUSIVE: one reporter a rung WEAKER must not be counted by it.
  const weaker = weakerRungThan(b.tier);
  if (weaker) {
    const below = reportBlocked(weaker.level, 1);
    ok(below.declarationsAccepted === below.expectedDeclarations,
      "A: setup — the below-band declaration was REFUSED, so `not counted` cannot be told apart " +
      "from `never folded`", below);
    ok(below.counts[b.viewField] === 0,
      "A: a reporter at `" + weaker.name + "`, one rung weaker than `" + b.rungName + "`, must " +
      "NOT count toward the `" + b.key + "` band — otherwise the band is not a band and the " +
      "structural floor (no quantity of the weakest rung ever adds up) is gone",
      { band: b.key, reporterRung: weaker.name, got: below.counts[b.viewField], expected: 0 });
    bandChecks++;
  }
}
ok(bandChecks >= bands.length,
  "A: every band must contribute at least one boundary check — a loop that filtered to nothing " +
  "reports a clean sweep of a subset", { bandChecks: bandChecks, bands: bands.length });

// ══ PART B — THE TWO COPIES OF THE TALLY MUST AGREE ═══════════════════════════════════════════
// The reducer decides whether an authored escape is LEGAL; the advance view decides whether one is
// ever AUTHORED. Two copies of one tally, and the whole failure mode is that they disagree — a
// client told to act by one and refused by the other, forever, with no error anywhere.
let agreementChecks = 0, anyRoadFired = false;
for (const b of bands) {
  // Enough reporters at this band's own rung to meet the largest requirement any road places on
  // it. Derived from the roads, so a re-tuned room still drives a road that actually fires.
  const n = Math.max(1, b.maxNeed);
  const r = reportBlocked(b.level, n);
  ok(r.declarationsAccepted === r.expectedDeclarations,
    "B: setup — " + r.declarationsAccepted + " of " + n + " declarations accepted for band `" +
    b.key + "`; a partial tally makes both answers meaningless rather than comparable", r);
  ok(r.skipWarranted === r.escapeAccepted,
    "B: the derived view and the reducer must reach the SAME verdict about band `" + b.key +
    "`. They are two copies of one tally: the view is what makes a client author the availability " +
    "escape and the reducer is what accepts it, so a disagreement is a room that authors an event " +
    "every client refuses (or one nobody ever authors), with nothing anywhere reporting it",
    { band: b.key, reporters: n, atRung: b.rungName,
      skipWarranted: r.skipWarranted, escapeAccepted: r.escapeAccepted });
  if (r.skipWarranted === true && r.escapeAccepted === true) anyRoadFired = true;
  agreementChecks++;
}
// A CONTROL FOR THE AGREEMENT ITSELF. `false === false` satisfies PART B just as well as
// `true === true`, so without this the whole part could pass on a fixture that never fires a road
// — two copies agreeing that nothing happened.
ok(anyRoadFired,
  "B: at least one band must actually AUTHORISE an escape, or the agreement above is agreement " +
  "about nothing — two copies of a tally both reading zero agree perfectly", { agreementChecks });

// ══ PART C — `bandOf` AND `owesVouch` ARE TWO COPIES OF ONE COMPARISON, AND MUST AGREE ════════
// `owed()` asks `TrustPolicy.owesVouch` and then, ONE LINE LATER, `Vouch.bandOf` — and both decide
// "has this left my list?" with their own `<= myTier`.
//
// DRIVEN, AND THE ROW IS DOMINATED: `owesVouch` returns false exactly when `bandOf` would return
// null, and `owed` has already `continue`d by then. Measured across the whole ladder, flipping
// `bandOf`'s comparison alone leaves `owed`'s target list byte-identical at every rank. So this is
// NOT an unguarded semantic boundary; it is a dominated duplicate, and asserting on `owed`'s output
// would have been decorative — it cannot fail, however wrong the duplicate becomes.
//
// What is asserted instead is the property that actually holds the pair together: the two copies
// agree. That survives someone removing the domination, which is the only way the duplicate ever
// becomes live, and it is the P7 rule stated where the second copy lives.
{
  const vsb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/vouch.js",
  ], { Date, Math, JSON });
  const { Vouch, TrustPolicy } = vsb;

  const settings = { vouchTable: StateDeriver.defaultSettings().vouchTable };
  const author = { u: "@author:hs", r: Ranks.LADDER[Ranks.LADDER.length - 2].level };

  let compared = 0, atOwnBar = 0, atOrAboveChecks = 0;
  for (const rung of Ranks.LADDER) {
    const myRank = rung.level;
    const myTier = Ranks.tierOf(myRank);
    const row = (settings.vouchTable || [])[myTier] || {};
    const need = row.enough;
    if (need === null || need === undefined) continue;   // a rung that satisfies nobody

    // Exactly enough distinct vouchers AT this rung to meet this rung's own bar — which is the
    // value `<=` admits and `<` does not, and therefore the only fixture that can see the flip.
    const vouchers = [];
    for (let i = 0; i < need; i++) vouchers.push({ u: "@v" + myTier + "_" + i + ":hs", r: myRank });

    const sat = TrustPolicy.satisfiedTier(vouchers, author, settings);
    const owes = TrustPolicy.owesVouch(myRank, "@me:hs", author, vouchers, settings);
    const band = Vouch.bandOf(vouchers, author, myRank, settings);
    if (sat === myTier) atOwnBar++;
    compared++;

    ok((owes === false) === (band === null),
      "C: `owesVouch` and `bandOf` must agree that an event has left my list, at the `" +
      rung.name + "` rung. They are two spellings of one comparison one line apart in `owed`, " +
      "which is the shape P7 exists for — and the seal gate and the vouching path have already " +
      "disagreed once this way",
      { rung: rung.name, myTier: myTier, satisfiedAt: sat, owesVouch: owes, bandOf: band });

    // ── THE SAME INCLUSIVITY, ONE LINE FURTHER DOWN ─────────────────────────────────────
    // `bandOf` reads the ladder TWICE: once to decide whether the event has left my list, and
    // again to sort what remains into "protected only from BELOW me" (band 1) and "protected at
    // my rank or above, but short of my bar" (band 2). Both are `<= myTier` and both mean *this
    // rung or stronger*. Reached only when the first comparison does NOT fire, so it needs its
    // own fixture: vouchers at exactly my own rung, one short of my bar.
    //
    // The band decides ORDER, not duty — which is why nothing about the room breaks when it is
    // wrong, and why it is worth pinning here rather than trusting a correctness guard to notice.
    // Getting it backwards makes an event covered by my own rank look as exposed as one covered
    // by nobody at my level, so the most endangered events stop going first.
    if (need >= 2) {
      const short = [];
      for (let i = 0; i < need - 1; i++) short.push({ u: "@s" + myTier + "_" + i + ":hs", r: myRank });
      const shortBand = Vouch.bandOf(short, author, myRank, settings);
      atOrAboveChecks++;
      ok(shortBand === 2,
        "C: a voucher at EXACTLY my own rung must count as `at my rank or above`, at the `" +
        rung.name + "` rung. Short of my bar it belongs in the nearly-there band, never in the " +
        "covered-only-from-below one — quantity below never promotes, and the inclusive endpoint " +
        "is what stops my own rank reading as below me",
        { rung: rung.name, myTier: myTier, vouchersAtMyRung: need - 1, bandOf: shortBand, expected: 2 });
    }
  }

  ok(compared >= 2,
    "C: the ladder walk must compare at least two rungs — a filter that emptied reports a clean " +
    "agreement it never tested", { compared: compared });
  ok(atOrAboveChecks >= 1,
    "C: no rung produced a short-of-my-bar fixture, so `bandOf`'s SECOND ladder read was never " +
    "reached — the part would pass while that comparison went untested",
    { atOrAboveChecks: atOrAboveChecks });
  // THE DISCRIMINATING VALUE HAS TO OCCUR. `<=` and `<` differ at exactly one point: coverage
  // satisfied at EXACTLY my own tier. A sweep that never produces one is identical in both trees
  // for reasons that have nothing to do with the comparison.
  ok(atOwnBar >= 1,
    "C: no rung produced coverage satisfied at EXACTLY its own tier, which is the single value " +
    "the comparison under test decides. Every reading here would be the same under either " +
    "operator, so the part would pass without exercising anything",
    { rungsCompared: compared, atOwnBar: atOwnBar });
}

if (failures) process.exit(1);
console.log("[tier-inclusive] PASS — a rank band includes its own rung and excludes the next one " +
  "down, and the two places that count it agree. The bands are DERIVED from the shape of " +
  "`skipRoads` (a road's keys name the rungs it bands by) and the ladder walk from `Ranks.LADDER`, " +
  "so no rank name appears in this file and a road banding by a third rung is covered the day it " +
  "is added. Driven: a reporter at exactly the band's rung counts and one a rung weaker does not, " +
  "so the bar is where the room configured it rather than one rung higher; the reducer's " +
  "re-validation of `ddjp.media.skip` and the `advance` view reach the same verdict, which is what " +
  "stops a room authoring an escape every client refuses; and `bandOf` agrees with `owesVouch` " +
  "about what has left my list, at the one value — coverage satisfied at exactly my own tier — " +
  "where `<=` and `<` differ. `<=` on a TIER is `>=` on a RANK, so each of these flips moves a bar " +
  "UP a rung and makes the room harder to act in, which is the opposite of what the comparison " +
  "looks like it does (F3, from the J39 sweep)");
