// tests/check-trust-policy.js
// WALL: the TRUST SEAM (backends/backend1/trustpolicy.js — design §11 "Forward-compatibility
// contract"). ONE place turns a channel-origin rank into a trust judgment, so the rule can grow
// from owner-only (today) to the owner-set delegation ladder (§7.6) by swapping bodies THERE,
// never at a call site. This guard pins three things:
//   (a) the config-driven trust engine (tierOf / trusts / isFloorTrusted / floorGrade), flat + cascading,
//   (b) that the two LIVE trust sites — the checkpoint accept-gate and the recovery tier+quorum —
//       route THROUGH the seam and re-derive identically (byte-for-byte, no drift), and
//   (c) ANTI-EROSION: neither trust site inlines a bare rank tier literal (owner === 100, r >= 80 …).
// If a future edit puts a bare rank number back into a trust decision, (c) fails — that is the
// mechanism that keeps "owner === 100" from creeping back in and the seam eroding.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

const { TrustPolicy } = loadInContext(["backends/backend1/ranks.js",
  "core/playlistdoc.js", "backends/backend1/session.js",
  "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/floor.js", "backends/backend1/trustpolicy.js"], {});
const { Recovery } = loadInContext(
  ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
   "backends/backend1/ranks.js",],
  {}
);

let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

// ── (a1) tierOf: seven tiers, owner 0 … uncategorized 6; junk floors to the weakest tier ──
eq(TrustPolicy.tierOf(100), 0, "owner -> tier 0");
eq(TrustPolicy.tierOf(120), 0, "above owner -> tier 0");
eq(TrustPolicy.tierOf(99), 0, "owner rung is 99 -> tier 0");
eq(TrustPolicy.tierOf(98), 1, "just below owner -> high-staff");
eq(TrustPolicy.tierOf(80), 1, "high-staff -> tier 1");
eq(TrustPolicy.tierOf(60), 2, "staff -> tier 2");
eq(TrustPolicy.tierOf(40), 3, "vip -> tier 3");
eq(TrustPolicy.tierOf(20), 4, "player -> tier 4");
eq(TrustPolicy.tierOf(19), 5, "just below player -> guest");
eq(TrustPolicy.tierOf(10), 5, "guest -> tier 5 (its own rung, not folded into uncategorized)");
eq(TrustPolicy.tierOf(0), 6, "zero -> uncategorized");
eq(TrustPolicy.tierOf(-5), 6, "negative -> uncategorized");
eq(TrustPolicy.tierOf(NaN), 6, "NaN -> weakest tier (never throws, never trusts)");
eq(TrustPolicy.tierOf("100"), 6, "non-number -> weakest (no string coercion into trust)");

// helpers: a voucher entry is { u: userId, r: channelOriginRank }
const V = (u, r) => ({ u: u, r: r });

// ── (a2) satisfiedTier — the strict cascade over the default table (o1/hs2/s3/v4/p5/uncat never) ──
eq(TrustPolicy.satisfiedTier([V("@o", 100)], "@x", {}), 0, "1 owner -> satisfied at the owner tier");
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@b", 80)], "@x", {}), 1, "2 high-staff -> satisfied at HS");
eq(TrustPolicy.satisfiedTier([V("@a", 80)], "@x", {}), null, "1 high-staff -> not satisfied anywhere");
eq(TrustPolicy.satisfiedTier([V("@a", 60), V("@b", 60), V("@c", 60)], "@x", {}), 2, "3 staff -> satisfied at staff");
eq(TrustPolicy.satisfiedTier([V("@a", 60), V("@b", 60)], "@x", {}), null, "2 staff -> short of the staff bar");
eq(TrustPolicy.satisfiedTier([V("@a", 40), V("@b", 40), V("@c", 40), V("@d", 40)], "@x", {}), 3, "4 vip -> satisfied at vip");
eq(TrustPolicy.satisfiedTier([V("@a", 0), V("@b", 0), V("@c", 0), V("@d", 0), V("@e", 0), V("@f", 0)], "@x", {}), null,
  "uncategorized is 'never' — no number of them satisfies");

// higher counts toward lower tiers (rank-or-above), and the HIGHEST satisfied tier is returned
eq(TrustPolicy.satisfiedTier([V("@o", 100), V("@a", 80)], "@x", {}), 0, "owner present -> highest tier wins");
eq(TrustPolicy.satisfiedTier([V("@a", 100), V("@b", 80), V("@c", 80)], "@x", {}), 0, "owner alone already satisfies tier 0");
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@b", 60), V("@c", 60)], "@x", {}), 2,
  "1 HS + 2 staff -> HS bar unmet, but all three count toward the staff bar");

// ── (a2b) NEVER VOUCH YOURSELF: the sender is excluded, so a tier needs N+1 present for its own ──
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@b", 80)], "@a", {}), null,
  "the event's own sender doesn't count -> 2 HS where one IS the sender falls short");
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@b", 80), V("@c", 80)], "@a", {}), 1,
  "3 HS present covers an HS-emitted event (N+1 rule)");
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@a", 80), V("@a", 80)], "@x", {}), null,
  "distinct USERS only — the same user vouching thrice counts once");

// ── (a2c) the worked example: owner away, 2 HS present, 5 staff present ──
const twoHS = [V("@h1", 80), V("@h2", 80)];
const fiveStaff = [V("@s1", 60), V("@s2", 60), V("@s3", 60), V("@s4", 60), V("@s5", 60)];
eq(TrustPolicy.satisfiedTier(twoHS.concat(fiveStaff), "@player", {}), 1,
  "a player-emitted event reaches the HS tier (2 non-sender HS available)");
eq(TrustPolicy.satisfiedTier(twoHS.concat(fiveStaff), "@h1", {}), 2,
  "an HS-emitted event can't reach HS (only 1 other HS) -> falls through to the staff tier");

// ── (a3) owesVouch — duty, incl. don't-trust-down and the always toggle ──
ok(TrustPolicy.owesVouch(80, "@me", "@me", [], {}) === false, "never owe a vouch on your OWN event");
ok(TrustPolicy.owesVouch(80, "@me", "@x", [], {}) === true, "nothing satisfied -> I owe it");
ok(TrustPolicy.owesVouch(60, "@me", "@x", twoHS, {}) === false,
  "staff rests when the HS tier above is satisfied");
ok(TrustPolicy.owesVouch(80, "@me", "@x", fiveStaff, {}) === true,
  "DON'T TRUST DOWN: high-staff keeps vouching even though the staff tier is covered");
ok(TrustPolicy.owesVouch(100, "@me", "@x", twoHS, {}) === true,
  "an owner keeps working to the owner bar despite an HS-covered event");
ok(TrustPolicy.owesVouch(80, "@me", "@x", [V("@o", 100)], {}) === false,
  "an owner-satisfied event discharges everyone below");

// a "never" tier owes nothing unless its ALWAYS toggle is on
ok(TrustPolicy.owesVouch(0, "@me", "@x", [], {}) === false,
  "uncategorized ('never', toggle off) owes nothing even when nothing is satisfied");
const UNCAT_ALWAYS = { vouchTable: TrustPolicy.DEFAULT_VOUCH_TABLE.slice(0, 6).concat([{ enough: null, always: true }]) };
ok(TrustPolicy.owesVouch(0, "@me", "@x", [], UNCAT_ALWAYS) === true,
  "always-toggle on -> uncategorized pitches in when nothing above is satisfied");
ok(TrustPolicy.owesVouch(0, "@me", "@x", twoHS, UNCAT_ALWAYS) === false,
  "...but stays quiet once something above IS satisfied");

// ── (a3b) the table is DATA: a room re-shapes the whole policy from settings ──
const STRICT = { vouchTable: [{ enough: 1 }, { enough: 5 }, { enough: null }, { enough: null }, { enough: null }, { enough: null }, { enough: null }] };
eq(TrustPolicy.satisfiedTier([V("@a", 80), V("@b", 80)], "@x", STRICT), null, "re-tabled: 2 HS no longer enough");
eq(TrustPolicy.satisfiedTier([V("@a", 60), V("@b", 60), V("@c", 60)], "@x", STRICT), null, "re-tabled: staff is 'never'");

// ── (a4) substitute checkpoints: N DIFFERENT-USER checkpoints stand in for an owner floor ──
eq(TrustPolicy.substituteTrusted([{ u: "@o", r: 100 }], {}, 20 /* player observer: accepts anything above it */), 0, "one owner checkpoint is authoritative");
eq(TrustPolicy.substituteTrusted([{ u: "@a", r: 80 }, { u: "@b", r: 80 }, { u: "@c", r: 80 }], {}, 20 /* player observer: accepts anything above it */), 1,
  "3 different-user high-staff checkpoints -> substitute at HS");
eq(TrustPolicy.substituteTrusted([{ u: "@a", r: 80 }, { u: "@b", r: 80 }], {}, 20 /* player observer: accepts anything above it */), null, "2 HS checkpoints fall short");
eq(TrustPolicy.substituteTrusted([{ u: "@a", r: 80 }, { u: "@a", r: 80 }, { u: "@a", r: 80 }], {}, 20 /* player observer: accepts anything above it */), null,
  "DIFFERENT users required — three from one author don't substitute");
eq(TrustPolicy.substituteTrusted([{ u: "@a", r: 20 }, { u: "@b", r: 20 }, { u: "@c", r: 20 }, { u: "@d", r: 20 }, { u: "@e", r: 20 }], {}, 20 /* player observer: accepts anything above it */), null,
  "player checkpoints are 'never' — no count substitutes");

// ── (a5) GRADES + forget-asymmetry (one grading rule, called by the checkpoint engine) ──
eq(TrustPolicy.gradeForTier(null, true), "real", "computed myself -> real");
eq(TrustPolicy.gradeForTier(0, false), "verified", "an owner floor -> verified (owner always wins)");
eq(TrustPolicy.gradeForTier(1, false), "quorum", "a high-staff substitute -> quorum (Step 12: the name now says HOW it was obtained, which is a different question from what it is worth)");
eq(TrustPolicy.earnsForget("quorum"), true, "and a quorum floor earns forgetting");
eq(TrustPolicy.earnsForget("stale"), false, "while one demoted after failing re-validation does not");
eq(TrustPolicy.gradeForTier(3, false), "quorum", "any non-owner substitute grades the same way, whatever tier it resolved at");
eq(TrustPolicy.gradeForTier(null, false), "none", "nothing trustable -> none (FAILSAFE: don't adopt)");
eq(TrustPolicy.gradeForTier(undefined, false), "none", "an absent tier is treated as untrustable");
// THE FORGET RIGHT, AFTER STEP 12. This used to read "an ACCEPTED or absent floor NEVER earns it",
// and the two halves have come apart: "quorum" was promoted on purpose and "none"/"stale" were not.
// A quorum whose members chain into each other IS proof — that is what §5.9 means by verification —
// so the line that separated proved from accepted no longer falls between owner and peer. It falls
// between a floor that verifies and one that has stopped.
ok(TrustPolicy.earnsForget("real") === true && TrustPolicy.earnsForget("verified") === true,
  "a floor I folded myself, and an owner's, earn the right to drop the raw log");
ok(TrustPolicy.earnsForget("quorum") === true,
  "and so does a substitute quorum (Step 12) — the accepted risk is that three colluding high-staff " +
  "could forge one, and only the owner mints high-staff");
ok(TrustPolicy.earnsForget("none") === false,
  "an absent floor still earns nothing");
ok(TrustPolicy.earnsForget("stale") === false,
  "and neither does one demoted after failing re-validation — that demotion is the brake that " +
  "replaced the old asymmetry, not a weakening of it");

// ── (b) behaviour-equivalence: the SHARED stagger bins THROUGH the seam ──
// The recovery module had its own private `_tier`, which is exactly the shape this guard exists to
// catch — a second copy of a tier rule that can drift from the first. It is gone: every staggered
// job now takes its turn through one Scheduler, which asks Ranks for the slot and TrustPolicy for
// the tier. The claim is unchanged and now has one fewer place to be violated.
for (const r of [100, 99, 80, 79, 60, 59, 40, 39, 20, 0, -3, NaN, undefined]) {
  const viaSeam = TrustPolicy.tierOf(r);
  eq(typeof viaSeam, "number", "tierOf answers for rank " + r);
  eq(TrustPolicy.tierOf(r), viaSeam, "one home for the tier rule (rank " + r + ")");
}
// ── (c) ANTI-EROSION: the two live trust sites route through the seam, no bare rank literal ──
function code(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");   // scan CODE, not prose
}
// The two live trust sites are Floor (accepting a floor) and Checkpoint (deciding it may seal).
// They used to be one file, which is how the seal gate and the vouching path came to disagree about
// what "protected" meant — the same comparison, written twice.
const fl = code("backends/backend1/floor.js");
const cp = code("backends/backend1/checkpoint.js");

ok(/TrustPolicy\.tierOf/.test(fl), "the floor search bins ranks through TrustPolicy.tierOf");
ok(/TrustPolicy\.gradeForTier/.test(fl), "and GRADES through the seam instead of re-deriving the rule");
ok(!/"verified"|"quorum"|"real"/.test(fl.slice(fl.indexOf("function adopt"), fl.indexOf("function adopt") + 900)),
  "adopt inlines no grade literal — the grading rule lives in exactly one place");
ok(/TrustPolicy\.substituteTrusted/.test(fl),
  "the owner-away fallback routes through the substitute bar rather than counting for itself");
ok(!/OWNER_RANK|===\s*100\b/.test(fl), "and holds no bare owner-rank gate");
ok(/Vouch\.protectedForMe/.test(cp),
  "the seal gate ASKS whether the span is protected rather than restating the comparison — a second "
  + "copy of it is exactly how these two came to disagree");
ok(!/[><]=?\s*100\b/.test(fl), "the floor search inlines no bare rank-100 comparison — a literal tier is how the seam erodes");
ok(/TrustPolicy\.tierOf/.test(fl), "recovery tier + quorum bin through TrustPolicy.tierOf");
ok(!/[><]=?\s*(100|80|60|40)\b/.test(fl), "recovery inlines no bare rank tier literal (100/80/60/40)");

// ── ONE HOME: owesVouch must ASK for the bar comparison, not restate it ──────────────────────
// Ported from check-trust-upward. Behaviour tests above prove owesVouch answers correctly TODAY;
// this proves it will still be the same answer tomorrow, because there is only one place the
// comparison lives.
//
// A second copy of `satisfiedTier(...) <= myTier` is precisely how the seal gate and the vouching
// path once came to disagree — both were right in isolation, and they were comparing different
// things. Static, and bounded to the function, because the erosion it guards against is a plausible
// local edit that no behavioural test would catch until the two copies drifted.
{
  const fs = require("fs"), path = require("path");
  const { ROOT } = require("./_load");
  const tp = fs.readFileSync(path.join(ROOT, "backends/backend1/trustpolicy.js"), "utf8");
  const a = tp.indexOf("function owesVouch");
  const b = tp.indexOf("function substituteTrusted");
  ok(a > 0 && b > a, "one-home: could not bound owesVouch (renamed? update this guard)");
  const body = tp.slice(a, b);
  ok(/protectedFor\s*\(/.test(body),
    "one-home: owesVouch must ask protectedFor for the bar comparison rather than restating it — "
    + "two copies of one rule is how duty and the seal gate came to disagree while both were "
    + "locally correct", body.slice(0, 220));
}

console.log("[trust-policy] PASS — the trust seam is ONE table-driven strict cascade: satisfiedTier returns the highest tier whose bar of N distinct rank-or-above users is met (sender EXCLUDED, so a tier needs N+1 present for its own events, and 'never' can never satisfy); owesVouch keeps higher ranks working to their own bar (don't-trust-down) while a 'never' tier only helps via its always-toggle; substitute checkpoints need N DIFFERENT authors; grading lives in ONE place (gradeForTier) which the checkpoint engine calls rather than re-deriving; and the live trust sites inline no bare rank literal (" + checks + " assertions)");
process.exit(0);
