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

const ctx = loadInContext(["core/statederiver.js"], {
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

console.log("[purity] PASS — StateDeriver.derive is pure and deterministic");
process.exit(0);
