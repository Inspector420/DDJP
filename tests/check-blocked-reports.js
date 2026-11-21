// tests/check-blocked-reports.js
// SUBJECT: features/mediablocked.js, backends/backend1/statederiver.js
// BOTH, because REDUCER-INERT is a claim about the REDUCER and the WALL below already says so.
// Declared single-path before compares-two (`ddjp_366`). PART D loads `statederiver.js` in its own
// sandbox — no `mediablocked.js` in it — and asserts across nowPlaying, rotation, history and counts
// that folding `ddjp.play.blocked` moves none of them. For that to become false `statederiver.js`
// would have to start folding blocked reports into state, which is the defect the part exists for.
// `capabilities.js` is loaded for the feature sandbox only and is never asserted on.
// WALL: blocked reports (features/mediablocked.js) — the "I can't see this" tally.
// DISPLAY-ONLY and REDUCER-INERT (Phase 5: information, nothing auto-skips).
//
// Guarantees:
//   PART A — DEDUPED + GROW-ONLY. blockedCount(pi) = distinct reporters; the same reporter
//     twice counts once; the count only ever goes up as reports arrive; per-instance.
//   PART B — LADDER ORDERED. report delays: owner<HS<staff<VIP<rest (only order is
//     load-bearing; seconds are dials).
//   PART C — SELF-REPORT ACCOUNTING. iReportedBlocked reflects my own recorded report;
//     a report from someone else never marks me.
//   PART D — REDUCER-INERT. Injecting ddjp.media.blocked leaves derived state identical.
//   PART E — EVERY PERSON'S REPORT IN THE LOG, ONCE PER PLAYING (J153; the owner: "we may want to see it in logs"): one info
//     line when a person's report first arrives for a playing — who, the reason it names as it arrived ("no reason" when it
//     names none), the playing and how many have reported it — mine included; none for a repeat; and it sends nothing.

const assert = require("assert");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[blocked-reports] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

function harness(me) {
  let np = { pi: "$p1", startedAt: 0, song: { songKey: "AAAAAAAAAAA" } };
  const subs = {};
  const sent = [];
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [] }; },
    on(t, fn) { (subs[t] = subs[t] || []).push(fn); },
    off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
  };
  const MatrixBridge = {
    getUserId() { return me; },
    async sendEvent(ch, type, content) { sent.push({ type, content }); },
  };
  const Logger = { info() {}, warn() {}, debug() {} };
  return {
    StreamManager, MatrixBridge, Logger, sent, subs,
    setNp(pi) { np = pi == null ? null : { pi, startedAt: 0, song: { songKey: "AAAAAAAAAAA" } }; },
    emitBlocked(p, sender) {
      const entry = { type: "ddjp.play.blocked", sender, content: { pi: p } };
      for (const fn of subs["ddjp.play.blocked"] || []) fn(entry);
    },
  };
}
function load(h) {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"], {
    StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Logger: h.Logger,
    setTimeout, clearTimeout, Date,
  });
  if (!sb.MediaBlocked) fail("MediaBlocked did not load");
  return sb.MediaBlocked;
}

// ---- PART A: deduped + grow-only + per-instance ---------------------------------
(() => {
  const h = harness("@me:hs");
  const M = load(h);
  M.init("!ev:hs");
  assert.strictEqual(M.blockedCount("$p1"), 0, "starts at 0");
  h.emitBlocked("$p1", "@a:hs");
  h.emitBlocked("$p1", "@b:hs");
  assert.strictEqual(M.blockedCount("$p1"), 2, "two distinct reporters → 2");
  h.emitBlocked("$p1", "@a:hs");   // duplicate reporter
  assert.strictEqual(M.blockedCount("$p1"), 2, "duplicate reporter counts once (deduped)");
  h.emitBlocked("$p1", "@c:hs");
  assert.strictEqual(M.blockedCount("$p1"), 3, "grows monotonically as new reporters arrive");
  // a different instance is tallied separately
  h.emitBlocked("$p2", "@a:hs");
  assert.strictEqual(M.blockedCount("$p2"), 1, "per-instance tally");
  assert.strictEqual(M.blockedCount("$p1"), 3, "other instance unaffected");
})();

// ---- PART B: ladder ordered ----------------------------------------------------
(() => {
  const h = harness("@me:hs");
  const M = load(h);
  const d = (r) => M._delayForRank(r);
  // The ladder is no longer this module's. It comes from the ONE shared stagger, so the
  // exact numbers belong to Ranks.staggerMs and the room's vouchJitter — what this guard
  // pins is the PROPERTY that matters: rank order is strict, and the owner moves first.
  if (!(d(100) < d(80) && d(80) < d(60) && d(60) < d(40) && d(40) < d(0)))
    fail("ladder must be strictly increasing owner<HS<staff<VIP<rest", [d(100), d(80), d(60), d(40), d(0)]);
  assert.strictEqual(d(100), 0, "owner moves first (device-local offset defaults to 0)");
  assert.ok(d(0) > d(80), "the weakest rank waits longest");
})();

// ---- PART C: self-report accounting --------------------------------------------
(() => {
  const h = harness("@me:hs");
  const M = load(h);
  M.init("!ev:hs");
  assert.strictEqual(M.iReportedBlocked("$p1"), false, "not reported initially");
  h.emitBlocked("$p1", "@someone:hs");
  assert.strictEqual(M.iReportedBlocked("$p1"), false, "someone else's report doesn't mark me");
  h.emitBlocked("$p1", "@me:hs");
  assert.strictEqual(M.iReportedBlocked("$p1"), true, "my own recorded report marks me");
})();

// ---- PART E: every person's report in the log, once per playing (J153) -----------
(() => {
  const h = harness("@me:hs");
  const lines = [];
  h.Logger = { info: (m) => lines.push(m), warn() {}, debug() {} };
  const M = load(h);
  M.init("!ev:hs");
  const emit = (p, sender, k) => { const c = { pi: p }; if (k !== undefined) c.k = k; for (const fn of h.subs["ddjp.play.blocked"] || []) fn({ type: "ddjp.play.blocked", sender, content: c }); };
  const said = () => lines.filter((m) => /^MediaBlocked: report from /.test(m));
  emit("$p1", "@a:hs", "blocked-for-me");
  if (JSON.stringify(said()) !== JSON.stringify(["MediaBlocked: report from @a:hs (blocked-for-me) on pi=$p1 \u2014 1 for this playing"]))
    fail("E: a person's first report for a playing is said once — who, its reason, the playing, how many so far", lines);
  emit("$p1", "@a:hs", "blocked-for-me");
  if (said().length !== 1) fail("E: the same person again for the same playing says nothing", lines);
  emit("$p1", "@b:hs", "not-allowed");
  emit("$p1", "@c:hs");
  emit("$p1", "@me:hs", "blocked-for-me");
  emit("$p2", "@a:hs", "not-allowed");
  const want = [
    "MediaBlocked: report from @a:hs (blocked-for-me) on pi=$p1 \u2014 1 for this playing",
    "MediaBlocked: report from @b:hs (not-allowed) on pi=$p1 \u2014 2 for this playing",
    "MediaBlocked: report from @c:hs (no reason) on pi=$p1 \u2014 3 for this playing",
    "MediaBlocked: report from @me:hs (blocked-for-me) on pi=$p1 \u2014 4 for this playing",
    "MediaBlocked: report from @a:hs (not-allowed) on pi=$p2 \u2014 1 for this playing",
  ];
  if (JSON.stringify(said()) !== JSON.stringify(want))
    fail("E: each person's first report per playing, the other reason, one naming none, this device's own as it comes back, and another playing", said());
  if (h.sent.length !== 0) fail("E: the line sends nothing", h.sent);
  if (M.blockedCount("$p1") !== 4 || M.blockedCount("$p2") !== 1) fail("E: and the tally is as before", [M.blockedCount("$p1"), M.blockedCount("$p2")]);
})();

// ---- PART D: reducer-inert -----------------------------------------------------
(() => {
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
  const SD = ctx.StateDeriver;
  let L = 0;
  const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 1000, l: L, content: Object.assign({}, body) }; };
  const base = [
    mk("ddjp.dj.join", "@a:hs", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    mk("ddjp.dj.join", "@b:hs", 20, { v: "BBBBBBBBBBB", u: "https://y/b" }),
    mk("ddjp.dj.play", "@a:hs", 20, { p: null }),
  ];
  const before = SD.derive(base);
  const after = SD.derive(base.concat([
    mk("ddjp.play.blocked", "@a:hs", 20, { pi: "$e3" }),
    mk("ddjp.play.blocked", "@b:hs", 60, { pi: "$e3" }),
    mk("ddjp.play.blocked", "@c:hs", 100, { pi: "$e3" }),
  ]));
  assert.deepStrictEqual(after.nowPlaying, before.nowPlaying, "nowPlaying unchanged by media.blocked");
  assert.deepStrictEqual(after.rotation, before.rotation, "rotation unchanged by media.blocked");
  assert.deepStrictEqual(after.history, before.history, "history unchanged by media.blocked");
  assert.deepStrictEqual(after.counts, before.counts, "counts unchanged by media.blocked");
})();

console.log("[blocked-reports] PASS — tally deduped + grow-only + per-instance; ladder ordered (owner<HS<staff<VIP<rest); self-report accounting correct; ddjp.media.blocked is reducer-inert; every person's first report per playing said once in the log, with its reason and the playing, sending nothing (J153)");
