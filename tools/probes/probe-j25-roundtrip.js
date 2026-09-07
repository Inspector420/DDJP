// tools/probes/probe-j25-roundtrip.js
//
// J25 — THE SAVE-FILE FORMAT. What does a checkpoint seed actually reproduce, and what does it
// silently drop? `checkpoint-contents.md` §7 says "Export format = the checkpoint format. No new
// artifact", so every Open in J25's entry is a question about what that artifact already carries.
// This probe answers four of them by measurement rather than by reading §1's list.
//
// THE ADMISSIBILITY GATE IS THE POINT. Every question here is of the form "is X missing from the
// seeded fold?", and an unreached fixture answers YES to all of them — absence reads as a finding
// (docs/paths.md §9.6, tests/_fixtures.js). So every row that asserts an absence is paired with a
// GENESIS control that must show the thing PRESENT first. If the control is empty the row prints
// SKIPPED-UNREACHED and the run is void, not clean.
//
// Rows:
//   R1  core state (nowPlaying / rotation / settings) survives the seed  → expect IDENTICAL
//   R2  history                                                          → expect PRESENT then GONE
//   R3  off-air reaction counts                                          → expect PRESENT then GONE
//   R4  live-playing counts + dedup set                                  → expect PRESENT and KEPT
//   R5  tick: seed it at high-water vs at 0, then let somebody join      → rotation ORDER differs
//   R6  one snapshot vs two: chainVerifies below two members             → expect REFUSED
//
// PROBE DEFECT, CAUGHT BY THE GATE AND RECORDED RATHER THAN QUIETLY FIXED: rows R3 and R4 first
// read the tally as `.v`/`.s` — the reducer's INTERNAL bucket names — while `state.counts` exposes
// `{votes, saves, votesAdjusted, savesAdjusted}`. Both rows therefore reported "no reaction landed"
// for a room where three had. Had the gate not been there, R3 would have printed the answer the
// session expected (off-air counts are gone) for entirely the wrong reason.
//
// Run: node tools/probes/probe-j25-roundtrip.js   (from the tree root)

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));

const BACKEND = "backends/backend1/";
const sb = loadInContext([
  "core/logger.js",
  BACKEND + "ranks.js",
  BACKEND + "consensushash.js",
  BACKEND + "trustpolicy.js",
  BACKEND + "statederiver.js",
  BACKEND + "checkpointformat.js",
  BACKEND + "floor.js",
], { Date, Math, JSON, setTimeout, clearTimeout, Promise });

const SD = sb.StateDeriver;
const CF = sb.CheckpointFormat;
const Floor = sb.Floor;

let voids = 0;
function row(id, what, verdict, detail) {
  console.log("  " + id + " · " + what + "\n        → " + verdict +
    (detail ? "\n        " + JSON.stringify(detail) : ""));
}
function gate(id, cond, why) {
  if (cond) return true;
  voids++;
  console.log("  " + id + " · GATE FAILED — " + why + "\n        → VOID (an unreached measurement " +
    "returns the same value in every tree)");
  return false;
}
const canon = (x) => {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") {
    return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  }
  return JSON.stringify(x);
};

// ── the room ──────────────────────────────────────────────────────────────────────────────────
// Four songs so three playings are OFF AIR by the end, plus reactions on an early playing and on
// the live one, plus an owner settings event so `settingsFrom` is a real id rather than null.
const room = F.playingRoom({ songs: 4 });
const log = room.log.slice();
let l = room.lastL;

log.push(F.reducerEvent("$set1", ++l, 120000, "@owner:hs", F.RANK.owner,
  { t: "ddjp.room.settings", s: { maxLen: 900 } }));

// reactions on the FIRST playing (off air by the end) and on the LAST (live)
const early = room.pi(0), live = room.pi(3);
log.push(F.reducerEvent("$v1", ++l, 130000, "@a:hs", F.RANK.player, { t: "ddjp.dj.vote", p: early }));
log.push(F.reducerEvent("$v2", ++l, 130001, "@b:hs", F.RANK.player, { t: "ddjp.dj.vote", p: early }));
log.push(F.reducerEvent("$s1", ++l, 130002, "@a:hs", F.RANK.player, { t: "ddjp.dj.save", p: early }));
log.push(F.reducerEvent("$v3", ++l, 900000, "@c:hs", F.RANK.player, { t: "ddjp.dj.vote", p: live }));

const ordered = F.sortLog(log);

console.log("[j25-roundtrip] room: " + ordered.length + " events, " + room.pis.length +
  " playings, live pi = " + live);

// ── the two folds ─────────────────────────────────────────────────────────────────────────────
const genesis = SD.derive(ordered);
const seed = SD.buildSeed(ordered);          // seal the WHOLE log: the export cut
const seeded = SD.derive([], seed);          // a fresh client with nothing but the file

// R1 — core state
{
  const g = canon({ np: genesis.nowPlaying, rot: genesis.rotation, set: genesis.settings });
  const s = canon({ np: seeded.nowPlaying, rot: seeded.rotation, set: seeded.settings });
  if (gate("R1", genesis.nowPlaying && genesis.rotation.length > 0,
      "the genesis fold has no nowPlaying or an empty rotation, so there is nothing to reproduce")) {
    row("R1", "core state (nowPlaying · rotation · settings) across the seed",
      g === s ? "IDENTICAL — the core needs no new field" : "DIVERGED",
      g === s ? { rotation: genesis.rotation.length, maxLen: genesis.settings.maxLen } : { g: g.slice(0, 300), s: s.slice(0, 300) });
  }
}

// R2 — history
{
  if (gate("R2", Array.isArray(genesis.history) && genesis.history.length > 0,
      "the genesis fold produced no history, so 'the seeded fold has none' would measure nothing")) {
    row("R2", "history across the seed",
      (seeded.history || []).length === 0 ? "GONE — the pane is blank after an import" : "CARRIED",
      { genesis: genesis.history.length, seeded: (seeded.history || []).length });
  }
}

// R3 — off-air counts
{
  const gEarly = (genesis.counts && genesis.counts[early]) || null;
  if (gate("R3", gEarly && (gEarly.votes || 0) > 0,
      "no votes landed on the off-air playing in the genesis fold")) {
    const sEarly = (seeded.counts && seeded.counts[early]) || null;
    row("R3", "off-air playing's reaction counts across the seed",
      !sEarly ? "GONE — figures for finished songs do not survive" : "CARRIED",
      { pi: early, genesis: gEarly, seeded: sEarly });
  }
}

// R4 — live counts and their dedup set
{
  const gLive = (genesis.counts && genesis.counts[live]) || null;
  if (gate("R4", gLive && (gLive.votes || 0) > 0, "no vote landed on the live playing")) {
    const sLive = (seeded.counts && seeded.counts[live]) || null;
    const dedup = seed.ledger && seed.ledger.counts && seed.ledger.counts[live];
    row("R4", "live playing's counts + dedup set across the seed",
      (sLive && sLive.votes === gLive.votes && dedup && dedup.v.users.length > 0)
        ? "KEPT, WITH THE DEDUP SET — a repeat vote after import cannot double-count"
        : "LOST OR THINNED",
      { genesis: gLive, seeded: sLive, dedupUsers: dedup ? dedup.v.users : null });
  }
}

// R5 — tick: high-water vs renumbered-to-zero, with a real join afterwards
{
  const joiner = F.reducerEvent("$late", 9000, 950000, "@late:hs", F.RANK.player,
    { t: "ddjp.dj.join", v: "LATESONG" });

  const highWater = JSON.parse(JSON.stringify(seed));
  const zeroed = JSON.parse(JSON.stringify(seed));
  zeroed.tick = 0;                                   // "renumber densely" done WRONG: keys kept, counter dropped

  const keys = Object.keys(seed.members).map((u) => seed.members[u].orderKey);
  if (gate("R5", seed.tick > 0 && keys.some((k) => k > 0),
      "the seed's tick or every orderKey is zero, so the two arms cannot differ")) {
    const a = SD.derive([joiner], highWater).rotation.map((r) => r.user);
    const b = SD.derive([joiner], zeroed).rotation.map((r) => r.user);
    row("R5", "a join AFTER import, with tick at high-water vs reset to 0",
      a.join(",") === b.join(",")
        ? "NO DIFFERENCE — tick is not load-bearing here (suspect the fixture)"
        : "ORDER DIFFERS — a dropped tick puts the newcomer at the HEAD of the rotation",
      { seedTick: seed.tick, orderKeys: keys, highWater: a, zeroed: b });
  }
}

// R6 — one snapshot or a ladder: what can a receiver actually verify?
{
  const mk = (n, prev, sd, floorL, covers) => {
    const cp = { n: n, prev: prev, seed: sd, floorL: floorL, thin: false, covers: covers,
                 u: "@peer" + n + ":hs", r: F.RANK.staff };
    cp.h = CF.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
    return cp;
  };
  const cut1 = ordered[5], cut2 = ordered[ordered.length - 1];
  const seed1 = SD.buildSeed(ordered.slice(0, 6));
  const seed2 = SD.buildSeed(ordered.slice(6), seed1);
  const cpA = mk(1, null, seed1, cut1.l, CF.coversOf(ordered[0].eventId, cut1.eventId));
  const cpB = mk(2, cpA.h, seed2, cut2.l, CF.coversOf(ordered[6].eventId, cut2.eventId));

  const selfOnly = CF.verify(cpA);
  const one = Floor.chainVerifies([cpA], ordered);
  const two = Floor.chainVerifies([cpA, cpB], ordered);
  if (gate("R6", selfOnly === true && two === true,
      "the two-snapshot control does not verify, so a refusal of one snapshot proves nothing")) {
    row("R6", "verifying a file that carries ONE snapshot vs TWO",
      one === false ? "ONE IS REFUSED, TWO VERIFIES — a lone snapshot is self-consistent only"
                    : "ONE VERIFIED — the ladder question is not decided by chaining",
      { selfConsistent: selfOnly, chainOne: one, chainTwo: two });
  }
}

// R7 — is a value the file PINS repairable in the imported room, or stuck?
// This decides whether a dial change is cheap after the freeze or expensive. The seed's blob
// overrides `defaultSettings()` on every fold, so an imported room runs on the exporting room's
// numbers for ever unless an ordinary room action can move them.
//
// TWO PROBE DEFECTS ARE RECORDED HERE RATHER THAN QUIETLY FIXED, because the first one produced a
// confident wrong answer ("REFUSED — a pinned value would need a format change to move"):
//   1. The first arm posted a PARTIAL blob `{vouchJitter}`. The reducer accepts a settings event
//      whole or not at all, testing `applySettingsEvent(defaults, s)` against
//      `applySettingsEvent(current, s)` — so a partial blob is refused outright the moment the
//      room's settings differ from defaults in ANY key, which in an imported room they do. The
//      panel posts the FULL blob; the probe has to as well.
//   2. `minGate` and `vouchJitter` are a PAIR, reverted together when minGate < 7.5 × jitter. So a
//      full blob that raises the jitter alone is ACCEPTED and moves nothing — which reads exactly
//      like a refusal from the outside. Both arms are kept below, because the difference between
//      them is the whole answer.
{
  const fromFile = SD.derive([], seed).settings;
  const full = (over) => Object.assign({}, fromFile, over);
  const post = (id, l, blob) => F.reducerEvent(id, l, 960000, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: blob });

  const jitterOnly = SD.derive([post("$fixA", 9500, full({ vouchJitter: 3000 }))], seed).settings;
  const withPair   = SD.derive([post("$fixB", 9500, full({ vouchJitter: 3000, minGate: 24000 }))], seed).settings;

  if (gate("R7", fromFile.vouchJitter !== 3000 && fromFile.minGate < 22500,
      "the seed already satisfies the target pair, so neither arm could move anything")) {
    row("R7", "an owner re-authoring a dial in a room imported from the file",
      (jitterOnly.vouchJitter === fromFile.vouchJitter && withPair.vouchJitter === 3000)
        ? "REPAIRABLE BY AN ORDINARY SETTINGS EVENT — but only as a PAIR: the full blob moving the " +
          "jitter alone is accepted and changes nothing"
        : "NOT THE EXPECTED SHAPE — read both arms before concluding",
      { fromFile: { vouchJitter: fromFile.vouchJitter, minGate: fromFile.minGate },
        jitterAloneFullBlob: { vouchJitter: jitterOnly.vouchJitter, minGate: jitterOnly.minGate },
        pairTogether: { vouchJitter: withPair.vouchJitter, minGate: withPair.minGate } });
  }
}

console.log("[j25-roundtrip] " + (voids ? voids + " ROW(S) VOID — do not read the rest as a result"
                                        : "all gates passed; every row above is attributable"));
