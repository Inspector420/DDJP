// probe-clamp-equivalence.js — DIAGNOSTIC. Settles the one judgement the J39 reducer collapse
// rests on: are the two length-clamp comparisons EQUIVALENT MUTATIONS?
//
//   if (... minLenSec > 0 && out < minLenSec) out = minLenSec;
//   if (... maxLenSec > 0 && out > maxLenSec) out = maxLenSec;
//
// The argument is that at `out === maxLenSec` the clamp assigns a value already equal, so `>` and
// `>=` cannot be told apart by any observer and no guard could catch the flip. That is REASONING.
// 34 reducer survivors collapse to one finding only if it is true, so it gets measured.
//
// `gateLengthSec` is not exported, so the clamp is reachable only through a full fold. This drives
// it that way on purpose: build a room, have clients declare lengths sitting EXACTLY on each
// clamp and one step either side, then compare the complete derived state, the accepted set, and
// the seed. Byte-identical output under both operators is equivalence measured, not argued.
//
// Run twice — once against pristine source, once with the operator flipped — and diff.

const path = require("path");
const T = "/home/claude/proj/dev/tree/tests";
const { loadInContext } = require(path.join(T, "_load.js"));
const F = require(path.join(T, "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver } = sb;

const D = StateDeriver.defaultSettings();
const MIN = D.minLen, MAX = D.maxLen;

// Declarations placed ON each clamp and one step either side. A tier resolves only when one value
// leads outright, so each case is its own room rather than one room with everything in it —
// otherwise the tally ties and cascades, and the clamp is never reached at all.
const CASES = [
  ["exactly maxLen", MAX],
  ["one below maxLen", MAX - 1],
  ["one above maxLen", MAX + 1],
  ["exactly minLen", MIN],
  ["one below minLen", MIN - 1],
  ["one above minLen", MIN + 1],
  ["far above maxLen", MAX * 3],
  ["one second", 1],
  ["zero seconds", 0],
];

const out = [];
for (const [label, sec] of CASES) {
  const room = F.playingRoom({ songs: 2 });
  const pi = room.pi(1);
  const log = room.log.concat([
    F.lenDecl("$d1", room.lastL + 1, room.startTs + 500000, pi, sec, F.RANK.vip, "@a:hs"),
    F.lenDecl("$d2", room.lastL + 2, room.startTs + 500001, pi, sec, F.RANK.vip, "@b:hs"),
  ]);
  const ordered = F.sortLog(log);
  const r = StateDeriver.deriveBoth(ordered);
  const seed = StateDeriver.buildSeed(ordered, null);
  out.push({
    case: label,
    declared: sec,
    gateLenSec: r.state.advance ? r.state.advance.gateLenSec : null,
    accepted: r.accepted.slice().sort(),
    state: r.state,
    seed: seed,
  });
}

// Whole-output digest: if a single byte of derived state or seed differs under the flip, this moves.
console.log(JSON.stringify(out, null, 1));
