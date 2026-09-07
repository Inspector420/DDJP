// tests/check-blocked-reports.js
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

const assert = require("assert");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[blocked-reports] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

function harness(me) {
  let np = { pi: "$p1", startedAt: 0, song: { videoId: "AAAAAAAAAAA" } };
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
    setNp(pi) { np = pi == null ? null : { pi, startedAt: 0, song: { videoId: "AAAAAAAAAAA" } }; },
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

console.log("[blocked-reports] PASS — tally deduped + grow-only + per-instance; ladder ordered (owner<HS<staff<VIP<rest); self-report accounting correct; ddjp.media.blocked is reducer-inert");
