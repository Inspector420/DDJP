// probe-loopbounds.js — DIAGNOSTIC. Tests a CLASSIFICATION, not a behaviour.
//
// Three J39 survivors were labelled "loop bound — a defensive check inside the body absorbs it":
//   trustpolicy.js:110  for (let t = 0; t < rows.length; t++)   in satisfiedTier
//   trustpolicy.js:168  for (let t = 0; t < rows.length; t++)   in substituteTrusted
//   floor.js:271        for (let start = 0; start < ordered.length; start++)  in select
//
// That label was assigned BY READING THE SOURCE — the same method that produced a wrong reading of
// line 109, where a zero-second declaration was said to reach the length tally and does not,
// because another comparison eats it upstream. So the label gets driven.
//
// Flipping `<` to `<=` runs each loop one extra time with an index one past the end. The claim is
// that the extra pass is inert. Inert means: identical output across a corpus that actually
// exercises the function.
//
// TWO THINGS MAKE THIS ADMISSIBLE, and the second is the one I got wrong last time:
//   · NON-VACUITY — the pristine corpus must produce a spread of real answers. If every call
//     returns null, identical output proves the probe never reached the code.
//   · AN ADMISSIBLE CONTROL — a mutation that MUST move the output. A control that cannot move
//     certifies whatever you already believed. The first control used on the clamps only differed
//     on an input the corpus never contained, and its IDENTICAL reading meant nothing.

const path = require("path");
const T = "/home/claude/proj/dev/tree/tests";
const { loadInContext } = require(path.join(T, "_load.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
], { Date, Math, JSON });
const { TrustPolicy, Ranks } = sb;

// Ranks exports no per-rank constants — the ladder is data. Taking the LEVELS from it is also the
// non-brittle choice: a rung added later widens the corpus instead of silently narrowing it.
const RANKS = Ranks.LADDER.map((r) => r.level);
if (!RANKS.length) { console.log("EMPTY RANK SET — the corpus would be vacuous"); process.exit(1); }

function voucher(u, r) { return { u: u, r: r }; }

// A corpus wide enough that the tier walk actually resolves at several different tiers: vouchers
// at every rank, in every count from none up to more than any bar requires, asked about by senders
// at every rank. If the walk never resolves, the spread below will show it.
const corpus = [];
for (const askRank of RANKS) {
  for (const vRank of RANKS) {
    for (const n of [0, 1, 2, 3, 5]) {
      const vs = [];
      for (let i = 0; i < n; i++) vs.push(voucher("@v" + i + ":hs", vRank));
      corpus.push({ vs, sender: { u: "@s:hs", r: askRank }, askRank, vRank, n });
    }
  }
}

const out = [];
for (const c of corpus) {
  out.push({
    k: "satisfiedTier",
    askRank: String(c.askRank), vRank: String(c.vRank), n: c.n,
    v: TrustPolicy.satisfiedTier(c.vs, c.sender, {}),
  });
}
for (const c of corpus) {
  out.push({
    k: "substituteTrusted",
    askRank: String(c.askRank), vRank: String(c.vRank), n: c.n,
    v: TrustPolicy.substituteTrusted(c.vs, {}, c.askRank),
  });
}
// observerTier and tierOf sit on the same walk and are cheap to include.
for (const r of RANKS) {
  out.push({ k: "observerTier", askRank: String(r), vRank: "-", n: 0, v: TrustPolicy.observerTier(r) });
}

if (process.argv.indexOf("--spread") >= 0) {
  const byKind = {};
  for (const o of out) {
    byKind[o.k] = byKind[o.k] || {};
    const key = String(o.v);
    byKind[o.k][key] = (byKind[o.k][key] || 0) + 1;
  }
  console.log("NON-VACUITY — distinct answers produced per function:");
  for (const k of Object.keys(byKind)) {
    console.log("  " + k.padEnd(20) + JSON.stringify(byKind[k]));
  }
} else {
  console.log(JSON.stringify(out));
}
