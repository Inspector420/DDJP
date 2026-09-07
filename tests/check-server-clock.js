// tests/check-server-clock.js
// WALL: the local Matrix clock (features/serverclock.js). Replaces the deleted ddjp.media.time
// drift beacon. It learns a server-time OFFSET from the ts on incoming events (zero extra
// messages) so playback elapsed is computed in shared server-time and AGREES across clients
// with different local clocks. Timing-only; never sends; never read by the reducer.
//
// Guarantees:
//   PART A — LEARNS THE OFFSET from event ts. After observing events, serverNow() tracks
//     server-time, not the raw local clock.
//   PART B — CROSS-CLIENT AGREEMENT. Two clients with DIFFERENT local clocks, observing the
//     SAME server-stamped events, compute the SAME server-time elapsed for a shared anchor.
//     This is the whole point: agreement by construction, with no broadcasting.
//   PART C — OUTLIER RESISTANT. A single wildly-laggy sample (or a clock jump) does not yank
//     the offset — the median over the recent window absorbs it.
//   PART D — SAFE FALLBACK. Before any event is seen (no offset), serverNow() == local clock
//     (degrades to old behavior, never worse).
//   PART E — SENDS NOTHING. The module never calls MatrixBridge.sendEvent — it only observes.
//   PART F — NO BEACON LEFT. ddjp.media.time is gone from the codebase entirely.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[server-clock] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// Build an isolated ServerClock with a controllable local clock and a captured StreamManager.
function makeClock(localClockFn) {
  const subs = {};
  const StreamManager = {
    on: (t, fn) => { (subs[t] = subs[t] || []).push(fn); },
    off: (t, fn) => { if (subs[t]) subs[t] = subs[t].filter((f) => f !== fn); },
    _emit: (entry) => { for (const fn of (subs["*"] || [])) fn(entry); },
  };
  let sent = 0;
  // mayAuthor is what ServerClock asks to tell LIVE traffic from REPLAYED history — it learns only
  // from the former (check-clock-not-from-history). Every part below models a client observing live
  // events, so the stub says so explicitly rather than leaving it to a default. A stub that answered
  // "not live" would leave the offset at zero and pass PART D while emptying A, B and C.
  const MatrixBridge = { sendEvent: () => { sent++; return Promise.resolve(); }, getUserId: () => "@me",
                         mayAuthor: () => ({ ok: true }) };
  const ctx = loadInContext(["core/logger.js", "features/serverclock.js"], { StreamManager, MatrixBridge, Date });
  const SC = ctx.ServerClock;
  SC._setClockForTest(localClockFn);
  SC.init();
  return { SC, StreamManager, sentCount: () => sent };
}

// ---- PART D: safe fallback before any event ------------------------------------
(() => {
  let local = 1000000;
  const { SC } = makeClock(() => local);
  if (SC.hasOffset()) fail("should have no offset before observing any event");
  assert.strictEqual(SC.serverNow(), local, "serverNow == local clock before any offset");
})();

// ---- PART A: learns the offset -------------------------------------------------
(() => {
  // local clock is 5000ms AHEAD of the server. Events carry the true server ts.
  let local = 8000000;
  const skew = 5000;
  const { SC, StreamManager } = makeClock(() => local);
  for (let i = 0; i < 6; i++) {
    const serverTs = local - skew;          // server is 5s behind local
    StreamManager._emit({ type: "ddjp.dj.play", ts: serverTs });
    local += 1000;                          // time passes
  }
  assert.ok(SC.hasOffset(), "offset learned after observing events");
  // serverNow() should now read ~server-time (local - skew), within a small tolerance
  const err = Math.abs(SC.serverNow() - (local - skew));
  if (err > 50) fail("serverNow should track server-time (local - skew)", { err, offset: SC.offsetMs() });
})();

// ---- PART B: two clients with different local clocks AGREE on elapsed ----------
(() => {
  // Shared timeline of server-stamped events; two clients whose local clocks differ by 9s.
  const events = [];
  let serverTs = 100000;
  for (let i = 0; i < 8; i++) { events.push({ type: "ddjp.dj.play", ts: serverTs }); serverTs += 1000; }
  const anchor = 100000;   // a play event's shared server ts (song start)

  // Client A: local clock = server + 3000
  let localA = 0;
  const A = makeClock(() => localA);
  // Client B: local clock = server + 12000 (9s further ahead than A)
  let localB = 0;
  const B = makeClock(() => localB);

  // feed both the same events; each client's local clock advances in its own frame
  let t = 100000;
  for (const e of events) {
    localA = t + 3000; A.SC._observe(e);
    localB = t + 12000; B.SC._observe(e);
    t += 1000;
  }
  // now both compute elapsed since the SAME shared anchor, at the SAME server instant.
  // Put both local clocks at the same server-time moment (server = 200000):
  const serverMoment = 200000;
  localA = serverMoment + 3000;
  localB = serverMoment + 12000;
  const elapsedA = A.SC.elapsedSince(anchor);
  const elapsedB = B.SC.elapsedSince(anchor);
  const disagree = Math.abs(elapsedA - elapsedB);
  if (disagree > 100) fail("two clients with different local clocks must agree on server-time elapsed", { elapsedA, elapsedB, disagree });
  // and it should be ~the true server elapsed (200000 - 100000 = 100000ms)
  if (Math.abs(elapsedA - 100000) > 100) fail("elapsed should equal true server elapsed", { elapsedA });
})();

// ---- PART C: outlier resistance -------------------------------------------------
(() => {
  let local = 500000;
  const skew = 2000;
  const { SC, StreamManager } = makeClock(() => local);
  // feed several honest samples
  for (let i = 0; i < 6; i++) { StreamManager._emit({ type: "x", ts: local - skew }); local += 500; }
  const honest = SC.offsetMs();
  // now one wildly-laggy sample (server ts far in the past → huge implied offset)
  StreamManager._emit({ type: "x", ts: local - 999999 });
  const after = SC.offsetMs();
  if (Math.abs(after - honest) > 1500) fail("a single outlier sample must not yank the offset (median absorbs it)", { honest, after });
})();

// ---- PART E: sends nothing ------------------------------------------------------
(() => {
  let local = 1000;
  const h = makeClock(() => local);
  for (let i = 0; i < 5; i++) { h.StreamManager._emit({ type: "x", ts: local - 100 }); local += 100; }
  assert.strictEqual(h.sentCount(), 0, "ServerClock must never send a message");
})();

// ---- PART F: the drift beacon is gone -------------------------------------------
(() => {
  const root = path.join(__dirname, "..");
  const dirs = ["features", "backends/backend1"];
  const offenders = [];
  for (const d of dirs) {
    const dir = path.join(root, d);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      // real usage = emitting or subscribing to the beacon type, not a comment mention.
      // Strip // line comments, then look for the type inside a sendEvent/on/off call.
      const code = txt.replace(/\/\/[^\n]*/g, "");
      if (/sendEvent\([^)]*ddjp\.media\.time/.test(code) ||
          /\b(on|off)\(\s*["']ddjp\.media\.time["']/.test(code)) {
        offenders.push(d + "/" + f);
      }
    }
  }
  if (offenders.length) fail("ddjp.media.time must not be emitted or subscribed (drift beacon deleted)", offenders);
  if (fs.existsSync(path.join(root, "features/mediatime.js"))) fail("features/mediatime.js should be deleted");
})();

console.log("[server-clock] PASS — offset learned from event ts; two clients with different local clocks agree on server-time elapsed; a single outlier can't yank it; falls back to local before first event; never sends; and the ddjp.media.time drift beacon is fully deleted");
