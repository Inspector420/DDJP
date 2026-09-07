// tests/check-statederiver-purity.js
// WALL: determinism. StateDeriver.derive is the heart of consensus — every
// client must compute the same state from the same ordered log. That only holds
// if derive is PURE: no clock, no randomness, no storage, no network.
//
// We load StateDeriver into a sandbox where Date.now / Math.random / localStorage
// THROW. If derive touches any of them, this test catches the throw and fails.
// Then we run derive twice on identical input and require identical output.
//
// If an AI later sneaks `Date.now()` or `Math.random()` into derivation, this
// turns red instead of becoming a silent desync you find weeks later.

const assert = require("assert");
const { loadInContext } = require("./_load");

function poison(name) {
  throw new Error("FORBIDDEN ACCESS: " + name);
}

const RealDate = Date;
const DatePoison = new Proxy(RealDate, {
  get(t, k) {
    return k === "now" ? () => poison("Date.now()") : t[k];
  },
  construct() {
    poison("new Date()");
  },
});
const MathPoison = new Proxy(Math, {
  get(t, k) {
    return k === "random" ? () => poison("Math.random()") : t[k];
  },
});
const localStoragePoison = {
  getItem: () => poison("localStorage.getItem"),
  setItem: () => poison("localStorage.setItem"),
  removeItem: () => poison("localStorage.removeItem"),
};

// Sample ordered log — shaped exactly like StreamManager entries
// ({ eventId, type, content, l, ts, sender }). derive() reads type, content, ts, sender.
const ORDERED = [
  { eventId: "$1", l: 1, ts: 1000, sender: "@a:hs", type: "ddjp.dj.join",    content: { t: "ddjp.dj.join", v: "AAA" } },
  { eventId: "$2", l: 2, ts: 2000, sender: "@b:hs", type: "ddjp.dj.join",    content: { t: "ddjp.dj.join", v: "BBB" } },
  { eventId: "$3", l: 3, ts: 3000, sender: "@a:hs", type: "ddjp.dj.declare", content: { t: "ddjp.dj.declare", v: "AAA2" } },
  { eventId: "$4", l: 4, ts: 4000, sender: "@x:hs", type: "ddjp.dj.play",    content: { t: "ddjp.dj.play", p: null } },
];

function fail(msg) {
  console.log("[purity] FAIL — " + msg);
  process.exit(1);
}

const ctx = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {
  Date: DatePoison,
  Math: MathPoison,
  localStorage: localStoragePoison,
});
const SD = ctx.StateDeriver;

if (!SD || typeof SD.derive !== "function")
  fail("StateDeriver.derive not found — did the file move or change shape?");

let out1, out2;
try {
  out1 = SD.derive(ORDERED);
  out2 = SD.derive(ORDERED);
} catch (e) {
  fail(
    "derive() reached for a forbidden global → " +
      e.message +
      "\n      derive() must be pure: no Date / Math.random / localStorage / network."
  );
}

try {
  assert.deepStrictEqual(out1, out2);
} catch (e) {
  fail("derive() is not deterministic — two calls on identical input returned different results.");
}

// SEED MODE purity (Phase 7/9): derive(events, seed) must NOT mutate the caller's seed, and
// must be idempotent. If a future edit aliased the seed instead of copying it, a caller that
// reuses a seed (CheckpointEngine trusting its own seal, then deriving) would corrupt — pin it.
(() => {
  if (!SD.buildSeed) fail("StateDeriver.buildSeed missing (seed mode not exported)");
  let L = 0;
  const mk = (t, s, r, b) => { L++; return { eventId: "$se" + L, type: t, sender: s, senderRank: r, ts: L * 1000, l: L, content: Object.assign({}, b) }; };
  const evs = [mk("ddjp.dj.join", "@a:hs", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }), mk("ddjp.dj.play", "@a:hs", 20, { p: null }), mk("ddjp.dj.vote", "@b:hs", 20, { p: "$se2" })];
  const seed = SD.buildSeed(evs);
  const before = JSON.stringify(seed);
  const more = [mk("ddjp.dj.vote", "@c:hs", 20, { p: "$se2" })];
  const r1 = JSON.stringify(SD.derive(more, seed).counts);
  const after = JSON.stringify(seed);
  if (before !== after) fail("derive(events, seed) MUTATED the caller's seed — must copy, never alias");
  const r2 = JSON.stringify(SD.derive(more, seed).counts);
  if (r1 !== r2) fail("derive(events, seed) is not idempotent — the seed accumulates across calls");
})();

console.log("[purity] PASS — StateDeriver.derive is pure and deterministic, and seed-mode does not mutate the seed (idempotent)");
process.exit(0);
