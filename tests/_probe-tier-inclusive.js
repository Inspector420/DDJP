// tests/_probe-tier-inclusive.js — F3: what do the `<= tier` comparisons decide, and who reaches them?
//
// Three rows, all classified BY READING:
//   A  `t <= vTier`      statederiver.js:769  — the reducer's own re-validation of `ddjp.media.skip`
//   B  `t <= vipTier`    statederiver.js:981  — the same tally in the derived `advance` view
//   C  `sat <= myTier`   vouch.js:430         — `bandOf`'s "this leaves my list" early return
//
// ── THE TRAP THIS PROBE IS BUILT AROUND ──────────────────────────────────────────────────────
// `<=` on a TIER is `>=` on a RANK, and the two scales have zeros that mean opposite things
// (`main/05-matrix.md` §Ranks). `t <= vipTier` means *vip or STRONGER*; flipping to `<` removes
// vip itself and leaves staff-and-above. So the bar moves UP one rung and the room becomes
// HARDER to act in — a road that no longer fires, not one that fires too easily. A probe built on
// the intuition that a flip loosens something would look for a false positive and find nothing,
// which reads as agreement.
//
// ── AND THE OTHER WAY ABSENCE READS AS AGREEMENT HERE ────────────────────────────────────────
// Both reducer rows sit behind a road tally that must actually be MET before anything observable
// happens. A fixture whose blocked reporters do not satisfy any road produces "no skip" in every
// tree — the identical reading to the flip's effect. So each case proves the road fires in the
// control before it reports anything about the mutant, and every gate is exercised by `--selftest`.
//
// Run:        DDJP_TREE=/path/to/ddjp_NNN node tests/_probe-tier-inclusive.js
// Self-test:  DDJP_TREE=/path/to/ddjp_NNN node tests/_probe-tier-inclusive.js --selftest

const path = require("path");
const TREE = process.env.DDJP_TREE || path.resolve(__dirname, "..");
const { loadInContext } = require(path.join(TREE, "tests", "_load.js"));
const F = require(path.join(TREE, "tests", "_fixtures.js"));

const SELFTEST = process.argv.indexOf("--selftest") >= 0;

function inadmissible(caseName, stage, detail) {
  const payload = { INADMISSIBLE: caseName, stage: stage, detail: detail,
    note: "the fixture never reached the tally; nothing below would mean anything" };
  if (SELFTEST) throw new Error("GATE REFUSED " + caseName + " at: " + stage);
  console.log(JSON.stringify(payload, null, 1));
  process.exit(2);
}

function reducer() {
  return loadInContext([
    "core/logger.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
}

// ── a room whose current song N people have reported blocked, at one rank ──────────────────────
// The declarations are the ONLY input to the tally, so the rank on them is the whole experiment.
function blockedRoom(sb, opts) {
  const { StateDeriver, Ranks } = sb;
  const o = opts || {};
  // THE LIVE PI IS THE LAST PLAY, NOT THE FIRST. Every declaration here sorts after the whole room
  // log, and a declaration is legal only if it names the pi live AT ITS OWN FOLD POSITION — so
  // naming `pi(0)` in a two-song room refuses all four silently and empties the tally. Caught by
  // this probe's own gate on its first run, which is the stage three earlier audits of a different
  // row died at without noticing.
  const room = F.playingRoom({ songs: 2 });
  const pi = room.pis[room.pis.length - 1];
  const rank = Ranks.levelOf(o.rankName);
  const n = o.n;

  const decls = [];
  for (let i = 0; i < n; i++) {
    decls.push(F.blockedDecl("$blk" + i, room.lastL + 1 + i, room.startTs + 1000 + i,
      o.wrongPi ? "$not-a-live-pi" : pi, rank, "@" + o.rankName + i + ":hs"));
  }
  // The availability escape itself, authored AFTER the declarations so the tally is in the prefix.
  const skipL = room.lastL + 1 + n;
  const skip = F.reducerEvent("$mediaskip", skipL, room.startTs + 400000,
    "@anyone:hs", Ranks.levelOf("uncategorized"),
    { t: "ddjp.media.skip", p: pi, blockedGuestPlus: 99, blockedVipPlus: 99 });

  // TWO FOLDS, BECAUSE THE ESCAPE CONSUMES THE THING THE VIEW DESCRIBES. `state.advance` is
  // computed for whatever is playing NOW, so a fold that includes the successful `media.skip` has
  // already moved on to the next song and reports an empty tally for it — `skipWarranted: false`,
  // which is the identical reading to a road that never fired. Measured separately: the view
  // WITHOUT the escape (row B's consumer, which is what `MediaBlocked` reads before authoring one
  // at all), and the authorisation WITH it (row A's consumer, the reducer's re-validation).
  const viewFold = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls)));
  const authFold = StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls, [skip])));
  const accView = new Set(viewFold.accepted);
  const accAuth = new Set(authFold.accepted);
  const adv = viewFold.state.advance;
  return {
    rankName: o.rankName, n: n,
    declarationsAccepted: decls.filter((d) => accView.has(d.eventId)).length,
    // A: did the reducer AUTHORISE the escape? The row's own consumer.
    escapeAccepted: accAuth.has("$mediaskip"),
    // B: the derived view the feature layer reads BEFORE authoring one at all.
    blockedGuestPlus: adv ? adv.blockedGuestPlus : null,
    blockedVipPlus: adv ? adv.blockedVipPlus : null,
    skipWarranted: adv ? adv.skipWarranted : null,
    hasAdvance: !!adv,
    hasNowPlaying: !!viewFold.state.nowPlaying,
  };
}

// ══ CASES A + B — the two tally sites, driven through one fixture each ═════════════════════════
// The AUTHORITY road (0 guest+, 4 vip+) is the one that needs the vip band; the CROWD road
// (5 guest+, 0 vip+) needs only the guest band and is the control that must not move.
function casesAB() {
  const sb = reducer();
  const authority = blockedRoom(sb, { rankName: "vip", n: 4 });     // vip band only
  const crowd = blockedRoom(sb, { rankName: "guest", n: 5 });       // guest band only — CONTROL

  // ── GATE ──────────────────────────────────────────────────────────────────────────────
  // Each stage below returns the same "no escape" that the flip produces, so each is checked
  // separately and named.
  if (!authority.hasNowPlaying || !crowd.hasNowPlaying) {
    inadmissible("A/B", "no live playing", "the fixture never started a song, so no declaration " +
      "can name a live pi and the tally is empty in every tree");
  }
  if (authority.declarationsAccepted !== 4) {
    inadmissible("A/B", "blocked declarations REFUSED", authority.declarationsAccepted + " of 4 " +
      "accepted — a declaration is legal only if it names the pi live AT ITS OWN FOLD POSITION " +
      "and is the first from that sender, so a wrong pi or a duplicate sender empties the tally " +
      "silently");
  }
  if (crowd.declarationsAccepted !== 5) {
    inadmissible("A/B", "control declarations REFUSED", crowd.declarationsAccepted + " of 5 accepted");
  }
  if (!authority.hasAdvance || !crowd.hasAdvance) {
    inadmissible("A/B", "no advance view", "state.advance is absent, so the derived tally cannot " +
      "be read at all");
  }
  // THE CONTROL MUST FIRE. If the crowd road does not authorise an escape in this tree, then the
  // authority road failing proves nothing about the vip band — it would just mean roads do not
  // work here.
  if (!crowd.escapeAccepted || crowd.skipWarranted !== true) {
    inadmissible("A/B", "the CONTROL road did not fire",
      "5 guest reporters did not authorise the escape (accepted=" + crowd.escapeAccepted +
      ", warranted=" + crowd.skipWarranted + "). The guest band is the control this whole case " +
      "is measured against");
  }
  return { authority: authority, crowd: crowd };
}

// ══ CASE C — `bandOf` vs `owesVouch`: two copies of one comparison ═════════════════════════════
// `owed()` asks `owesVouch` and then, one line later, `bandOf`. Both answer "has this left my
// list?" and both do it with their own `<= myTier`. The property worth locking is that they AGREE
// — so the case sweeps the ladder and reports every rank where they do not.
function caseC(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/vouch.js",
  ], { Date, Math, JSON });
  const { Vouch, Ranks, TrustPolicy } = sb;

  const settings = { vouchTable: [
    { enough: 1, always: false }, { enough: 2, always: false }, { enough: 3, always: false },
    { enough: 4, always: false }, { enough: null, always: true }, { enough: null, always: true },
    { enough: null, always: false } ] };

  const author = { u: "@author:hs", r: Ranks.levelOf("player") };
  const rows = [];
  let sawSatEqualMyTier = 0;

  for (const rung of Ranks.LADDER) {
    const myRank = rung.level;
    const myTier = Ranks.tierOf(myRank);
    // Exactly enough distinct vouchers AT this rung to satisfy this rung's own bar.
    const need = (settings.vouchTable[myTier] || {}).enough;
    if (need === null || need === undefined) continue;      // a "never" rung satisfies nobody
    const vouchers = [];
    for (let i = 0; i < need; i++) vouchers.push({ u: "@v" + myTier + "_" + i + ":hs", r: o.weakVouchers ? Ranks.levelOf("uncategorized") : myRank });

    const sat = TrustPolicy.satisfiedTier(vouchers, author, settings);
    const owes = TrustPolicy.owesVouch(myRank, "@me:hs", author, vouchers, settings);
    const band = Vouch.bandOf(vouchers, author, myRank, settings);
    if (sat === myTier) sawSatEqualMyTier++;
    rows.push({ rung: rung.name, myTier: myTier, need: need, sat: sat,
                owesVouch: owes, bandOf: band,
                agree: (owes === false) === (band === null) });
  }

  // ── GATE ──────────────────────────────────────────────────────────────────────────────
  {
    if (!rows.length) inadmissible("C", "no rung produced a comparable case",
      "every rung's bar was `never`, so nothing was ever satisfied and the agreement is vacuous");
    // THE CASE THE ROW IS ABOUT is `sat === myTier` — satisfied at EXACTLY my own bar. That is the
    // only value `<=` admits and `<` does not, so a sweep that never produces one cannot see the
    // flip however many rungs it walks.
    if (sawSatEqualMyTier === 0) {
      inadmissible("C", "no case where sat EQUALS my own tier",
        "the flip `<=` -> `<` differs from the original at exactly one value, and this sweep " +
        "never produced it — every reading would be identical in both trees for reasons that " +
        "have nothing to do with the comparison");
    }
  }
  return { rows: rows, satEqualMyTierCases: sawSatEqualMyTier,
           disagreements: rows.filter((r) => !r.agree).map((r) => r.rung) };
}

// ══ CASE D — is C's row REACHABLE at all through the only production caller? ═══════════════════
// `bandOf` has exactly one production caller and it sits one line under `owesVouch`. If the gate
// above always answers first, the row is dominated and its flip is inert on that path — which is a
// classification, not a finding, and the difference matters.
function caseD() {
  // SCHEDULER IS NOT OPTIONAL HERE. `owed`'s turn filter calls `Scheduler.turnsPassed`, and the
  // first draft of this case omitted it. It threw, which was luck — 08-build-and-deploy records a
  // guard that omitted a dependency and got the subject's absent-engine FALLBACK instead, which
  // certified the inverse of the truth rather than failing.
  const sb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js",
  ], { Date, Math, JSON });
  const { Vouch, Ranks } = sb;

  // A held set with real positions, so the turn filter is genuinely exercised rather than skipped.
  const room = F.playingRoom({ songs: 3 });
  const held = F.heldSet(room.log.map(F.toRaw), { padding: 14 });

  const out = {};
  for (const rung of Ranks.LADDER) {
    const r = Vouch.owed(held, { myRank: rung.level, myUserId: "@me:hs",
                                 settings: {}, floorL: null, isLegal: () => true,
                                 rng: () => 0.5 });
    out[rung.name] = { targets: (r.targets || []).length, owedTotal: r.owedTotal,
                       bands: r.bands, error: r.error || null };
  }

  // ── GATE ──────────────────────────────────────────────────────────────────────────────
  {
    const anyTargets = Object.keys(out).some((k) => out[k].targets > 0);
    if (!anyTargets) {
      inadmissible("D", "no rank selected a single target",
        "every reading is an empty list, which is what a floor bound, an eligibility refusal or " +
        "an unmet turn filter each produce — so 'identical in both trees' would mean nothing. " +
        JSON.stringify(out));
    }
  }
  return out;
}

// ══ SELF-TEST — every gate must refuse a broken fixture ════════════════════════════════════════
if (SELFTEST) {
  console.log("gate self-test — each case is handed a deliberately broken fixture.");
  console.log("The gate must REFUSE it; a returned reading means that gate is decorative.\n");
  const trials = [
    ["A/B declarations aimed at a pi that is not live — the tally stays empty, which is the SAME " +
     "reading the flip produces",
      () => { const sb = reducer(); const bad = blockedRoom(sb, { rankName: "vip", n: 4, wrongPi: true });
              const crowd = blockedRoom(sb, { rankName: "guest", n: 5 });
              if (bad.declarationsAccepted !== 4) inadmissible("A/B", "blocked declarations REFUSED",
                bad.declarationsAccepted + " of 4 accepted");
              return { bad: bad, crowd: crowd }; }],
    ["A/B the CONTROL road cannot fire — only 4 guest reporters against a road needing 5",
      () => { const sb = reducer(); const crowd = blockedRoom(sb, { rankName: "guest", n: 4 });
              if (!crowd.escapeAccepted || crowd.skipWarranted !== true) {
                inadmissible("A/B", "the CONTROL road did not fire",
                  "accepted=" + crowd.escapeAccepted + ", warranted=" + crowd.skipWarranted); }
              return crowd; }],
    ["C  every voucher is uncategorized — nothing is ever satisfied, so `sat === myTier` never " +
     "occurs and the comparison under test is never the deciding one",
      () => caseC({ weakVouchers: true })],
  ];
  let refused = 0;
  for (const [name, run] of trials) {
    let out = null, why = null;
    try { out = run(); } catch (e) { why = e.message; }
    if (why) refused++;
    console.log("  " + (why ? "REFUSED " : "ADMITTED") + "  " + name);
    console.log("            " + (why ? why : "returned a reading: " + JSON.stringify(out).slice(0, 140)));
  }
  console.log("\n  " + refused + "/" + trials.length + " broken fixtures refused by their gate.");
  process.exit(refused === trials.length ? 0 : 1);
}

const out = { AB: casesAB(), C: caseC(), D: caseD(), tree: TREE };
console.log(JSON.stringify(out, null, 1));
