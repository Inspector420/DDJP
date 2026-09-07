// tests/check-media-length.js
// WALL: shared song length (features/medialength.js) — the rank-staggered answering
// ladder, resolved DISPLAY-ONLY and REDUCER-INERT.
//
// Guarantees, all load-bearing:
//   PART A — CLAMP. Any resolved/reported length is squeezed into [FLOOR, CEILING]
//     (10s..10min). A forged tiny/huge value can never produce an out-of-band number.
//   PART B — AUTHORITY IS THE CHANNEL (the B plan). Ingest keeps the higher-authority
//     channel's value; the OWNER tier is LATEST-WINS (one authority, no majority); a
//     non-owner tier keeps first-seen (majority deferred). A lower channel never
//     overrides a higher one, and nothing overrides a later owner report.
//   PART C — LADDER DELAYS. Owner ~0s / High-Staff 2s / Staff 4s / VIP 6s / rest 8s.
//     Only the strict ORDER matters for correctness; the exact seconds are dials.
//   PART D — RESOLUTION priority: own measured → cache → ladder-winning peer → unknown,
//     and localMeasuredDuration returns ONLY the own value (never a peer's — a peer
//     value must never be able to drive a local advance).
//   PART E — REDUCER-INERT. Injecting ddjp.media.len into a log leaves derived state
//     (nowPlaying/rotation/settings/history) byte-identical: derive(log) === derive(log+len).

const assert = require("assert");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[media-length] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// Minimal controllable StreamManager + MatrixBridge + Store for the module.
function harness(me, myRank) {
  let np = null;
  const subs = {};
  const sent = [];
  const meta = {};   // videoId -> { durationSec }
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [], settings: {} }; },
    on(t, fn) { (subs[t] = subs[t] || []).push(fn); },
    off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
  };
  const MatrixBridge = {
    getUserId() { return me; },
    getMyRank() { return myRank; },
    async sendEvent(channel, type, content) { sent.push({ channel, type, content }); return { event_id: "$x" + sent.length }; },
  };
  // Mirrors the REAL Store.meta surface (core/store.js): a sync `peek` over the RAM
  // mirror. The harness used to invent Store.getMeta/recordDuration, which production
  // never had — so this guard passed against an API that did not exist.
  const Store = {
    meta: { peek(v) { return meta[v] || null; } },
  };
  const Logger = { info() {}, warn() {}, debug() {} };
  return {
    StreamManager, MatrixBridge, Store, Logger, sent, meta,
    setNp(pi, videoId) { np = pi == null ? null : { pi, song: { videoId: videoId || "V" }, startedAt: 0 }; },
    emitLen(v, d, senderRank, l) {
      const entry = { type: "ddjp.media.len", sender: "@x:hs", senderRank, l: l || 1, content: { v, d } };
      for (const fn of subs["ddjp.media.len"] || []) fn(entry);
    },
  };
}

function load(h) {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/medialength.js"],
    { StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Store: h.Store, Logger: h.Logger,
      setTimeout, clearTimeout, Date });
  if (!sb.MediaLength) fail("MediaLength did not load");
  return sb.MediaLength;
}

// ---- PART A: clamp -------------------------------------------------------------
(() => {
  const h = harness("@me:hs", 0);
  const M = load(h);
  assert.strictEqual(M._clamp(3), M.FLOOR_SEC, "below floor clamps up to FLOOR");
  assert.strictEqual(M._clamp(200), 200, "in-band passes through");
  assert.strictEqual(M._clamp(99999), M.CEILING_SEC, "above ceiling clamps down to CEILING");
  assert.strictEqual(M._clamp(-5), null, "non-positive → null");
  assert.strictEqual(M._clamp("x"), null, "non-number → null");
  if (M.CEILING_SEC !== 600 || M.FLOOR_SEC !== 10) fail("dials moved (expected floor 10, ceiling 600)", { f: M.FLOOR_SEC, c: M.CEILING_SEC });
})();

// ---- PART B: authority is the channel; owner latest-wins -----------------------
(() => {
  const h = harness("@me:hs", 0);
  const M = load(h);
  const V = "AAAAAAAAAAA";
  M.init("!ev:hs");

  h.emitLen(V, 120, 20, 1);                                   // player tier
  assert.strictEqual(M._reports[V].d, 120, "first report taken");
  h.emitLen(V, 118, 60, 2);                                   // staff > player → replace
  assert.strictEqual(M._reports[V].d, 118, "higher channel replaces lower");
  h.emitLen(V, 130, 60, 3);                                   // equal non-owner → keep first-seen
  assert.strictEqual(M._reports[V].d, 118, "equal non-owner tier keeps first-seen (majority deferred)");
  h.emitLen(V, 200, 100, 4);                                  // owner → replace
  assert.strictEqual(M._reports[V].d, 200, "owner tier replaces lower");
  h.emitLen(V, 205, 100, 5);                                  // owner again → LATEST wins
  assert.strictEqual(M._reports[V].d, 205, "OWNER latest-wins (replaces prior owner)");
  h.emitLen(V, 99, 40, 6);                                    // VIP < owner → no override
  assert.strictEqual(M._reports[V].d, 205, "lower channel cannot override owner");
})();

// ---- PART C: ladder delays -----------------------------------------------------
(() => {
  const h = harness("@me:hs", 0);
  const M = load(h);
  const d = (r) => M._delayForRank(r);
  // The ladder is no longer this module's. It comes from the ONE shared stagger, so the
  // exact numbers belong to Ranks.staggerMs and the room's vouchJitter — what this guard
  // pins is the PROPERTY that matters: rank order is strict, and the owner moves first.
  if (!(d(100) < d(80) && d(80) < d(60) && d(60) < d(40) && d(40) < d(0)))
    fail("ladder must be strictly increasing owner<HS<staff<VIP<rest", [d(100), d(80), d(60), d(40), d(0)]);
  assert.strictEqual(d(100), 0, "owner moves first (device-local offset defaults to 0)");
  assert.ok(d(0) > d(80), "the weakest rank waits longest");
  // player now has its OWN slot rather than sharing a catch-all "rest" bucket — the
  // ladder has one rung per rank, and guest sits between player and uncategorized.
  assert.ok(d(40) < d(20) && d(20) < d(10) && d(10) < d(0), "every rank has its own slot, in order");
})();

// ---- PART D: resolution priority + local-only advance value --------------------
(() => {
  const h = harness("@me:hs", 0);
  const M = load(h);
  const V = "BBBBBBBBBBB";
  M.init("!ev:hs");

  // unknown → null
  assert.strictEqual(M.displayDuration(V), null, "unknown length → null");
  assert.strictEqual(M.localMeasuredDuration(V), null, "no own measurement → null");

  // a peer report fills displayDuration but NOT localMeasuredDuration
  h.emitLen(V, 150, 60, 1);
  assert.strictEqual(M.displayDuration(V), 150, "peer report serves displayDuration (clamped)");
  assert.strictEqual(M.localMeasuredDuration(V), null, "peer report must NOT become a local advance value");

  // my own measurement takes priority for display AND is the only local value
  M.recordLocalMeasured(V, 152);
  assert.strictEqual(M.localMeasuredDuration(V), 152, "own measurement is the local advance value");
  assert.strictEqual(M.displayDuration(V), 152, "own measurement wins the display resolution");

  // cache path: a different video only in Store.meta resolves for display, clamped
  const V2 = "CCCCCCCCCCC";
  h.meta[V2] = { durationSec: 5 };  // below floor → clamps up
  assert.strictEqual(M.displayDuration(V2), M.FLOOR_SEC, "cache value resolves and clamps");
})();

// ---- PART E: reducer-inert (derive(log) === derive(log + media.len)) -----------
(() => {
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
  const SD = ctx.StateDeriver;
  let L = 0;
  const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 1000, l: L, content: Object.assign({}, body) }; };
  const base = [
    mk("ddjp.dj.join", "@a:hs", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    mk("ddjp.dj.join", "@b:hs", 20, { v: "BBBBBBBBBBB", u: "https://y/b" }),
  ];
  const p1 = mk("ddjp.dj.play", "@a:hs", 20, { p: null });
  base.push(p1);
  const before = SD.derive(base);
  // sprinkle media.len events (various tiers) among the log
  const withLen = base.concat([
    mk("ddjp.media.len", "@a:hs", 20, { v: "AAAAAAAAAAA", d: 200 }),
    mk("ddjp.media.len", "@o:hs", 100, { v: "AAAAAAAAAAA", d: 3 }),   // even a floor-violating owner value
    mk("ddjp.media.len", "@b:hs", 60, { v: "BBBBBBBBBBB", d: 99999 }),
  ]);
  const after = SD.derive(withLen);
  assert.deepStrictEqual(after.nowPlaying, before.nowPlaying, "nowPlaying unchanged by media.len");
  assert.deepStrictEqual(after.rotation, before.rotation, "rotation unchanged by media.len");
  assert.deepStrictEqual(after.settings, before.settings, "settings unchanged by media.len");
  assert.deepStrictEqual(after.history, before.history, "history unchanged by media.len");
  assert.deepStrictEqual(after.counts, before.counts, "counts unchanged by media.len");
})();

console.log("[media-length] PASS — clamp [10s,10min]; channel-authority + owner latest-wins; ladder ordered (owner<HS<staff<VIP<rest); resolution own>cache>peer with local-only advance value; ddjp.media.len is reducer-inert");
