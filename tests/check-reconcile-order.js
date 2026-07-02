// tests/check-reconcile-order.js
// WALL: the reconciler's ORDER pin (_emitDiff step 3) must never loop.
//
// The bug this guards against: step 3 decided a slot arrangement was "covered" using
// have + inFlight, but compared the wanted order against the DECLARED BUFFER only. So a
// wanted song stuck in flight (submitted, never landed) made covered=true while the
// buffer could never match it — step 3 emitted ddjp.dj.order every reconcile. With a
// starving buffer, _onChange re-fires _emitDiff on every echo, so the room got FLOODED
// with order events (an endless ddjp.dj.order loop, same pi, no advance). The fix: only
// pin the order over songs actually IN THE BUFFER; a song in flight is waited on, never
// ordered. Ordering only buffer contents converges in one event and cannot loop.
//
// This test delivers order echoes deferred (like the network), which is what escapes the
// re-entrancy guard and let the loop run — a synchronous harness can't see it.

const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[reconcile-order] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

function harness(opts) {
  opts = opts || {};
  const pending = [];        // order events awaiting their (deferred) echo
  const bridge = {
    _sm: null, l: 0, n: 0, getUserId() { return "@me:hs"; },
    async sendEvent(c, t, co) {
      bridge.l++; bridge.n++;
      const raw = {
        event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message",
        sender: "@me:hs", senderRank: 20, ts: 1000 + bridge.n,
        content: { body: JSON.stringify(Object.assign({}, co, { t: t, l: bridge.l, dv: 1 })) }, l: bridge.l
      };
      if (opts.dropJoins && t === "ddjp.dj.join") return raw;   // simulate a declare that never lands
      if (t === "ddjp.dj.order") { pending.push(raw); return raw; }   // order echoes back LATER
      bridge._sm.ingest(raw); return raw;                       // everything else lands synchronously
    }
  };
  const storage = (() => { const m = {}; return { save(k, v) { m[k] = JSON.parse(JSON.stringify(v)); }, load(k) { return m[k] ? JSON.parse(JSON.stringify(m[k])) : null; }, remove(k) { delete m[k]; } }; })();
  const sb = loadInContext(
    ["core/logger.js", "core/store.js", "core/statederiver.js", "core/streammanager.js", "features/queue.js", "features/userqueue.js"],
    { Date, URL, MatrixBridge: bridge, StorageIO: storage });
  bridge._sm = sb.StreamManager;
  let now = 0, seq = 0, jobs = {};
  const clock = { set(fn, ms) { const id = ++seq; jobs[id] = { fn, at: now + ms }; return id; }, clear(id) { delete jobs[id]; }, now() { return now; },
    tick(ms) { now += ms; const d = Object.keys(jobs).map(k => [k, jobs[k]]).filter(e => e[1].at <= now).sort((a, b) => a[1].at - b[1].at); for (const e of d) { delete jobs[e[0]]; e[1].fn(); } } };
  sb.UserQueue.setClock(clock);
  let orders = 0; const orig = bridge.sendEvent;
  bridge.sendEvent = async (c, t, co) => { if (t === "ddjp.dj.order") orders++; return orig(c, t, co); };
  return { sb, bridge, clock, pending, orders: () => orders };
}

const url = (id) => "https://www.youtube.com/watch?v=" + id;
const decl = (sb) => (sb.StreamManager.getState().rotation.find(r => r.user === "@me:hs") || { pending: [] }).pending.map(p => p.videoId);

// --- Scenario 1: a stuck-in-flight song must NOT trigger an order flood ---
(async () => {
  const h = harness({ dropJoins: true });
  const { Queue, UserQueue } = h.sb;
  Queue.init("!ev:hs"); UserQueue.init("!r:hs"); await new Promise(r => setImmediate(r));
  UserQueue.add(url("AAAAAAAAAAA")); UserQueue.add(url("BBBBBBBBBBB"));   // 2 songs → step-3 order path
  UserQueue.joinRoomQueue();                                             // starving; joins dropped → stuck inFlight
  for (let i = 0; i < 40 && h.pending.length; i++) { h.bridge._sm.ingest(h.pending.shift()); await Promise.resolve(); }
  // Correct behaviour: at most one order attempt, then silence (nothing to order in an empty buffer).
  if (h.orders() > 2) fail("stuck-in-flight song floods ddjp.dj.order (the loop is back)", h.orders());
  console.log("[reconcile-order] ok — a stuck in-flight song does NOT flood order (" + h.orders() + " emitted)");

  // --- Scenario 2: a legit reorder of two DECLARED songs emits ONE order and converges ---
  const g = harness({});
  const Q = g.sb.Queue, UQ = g.sb.UserQueue;
  Q.init("!ev:hs"); UQ.init("!r:hs"); await new Promise(r => setImmediate(r));
  UQ.add(url("AAAAAAAAAAA")); UQ.add(url("BBBBBBBBBBB"));
  UQ.joinRoomQueue(); g.clock.tick(5000);
  while (g.pending.length) { g.bridge._sm.ingest(g.pending.shift()); await Promise.resolve(); }   // flush any settle-time order
  UQ.resync();
  const base = g.orders();
  UQ.moveUp(1);                                   // want [B, A]
  g.clock.tick(5000);
  while (g.pending.length) { g.bridge._sm.ingest(g.pending.shift()); await Promise.resolve(); }
  const afterReorder = g.orders();
  if (JSON.stringify(decl(g.sb)) !== JSON.stringify(["BBBBBBBBBBB", "AAAAAAAAAAA"]))
    fail("legit reorder did not apply to the buffer", decl(g.sb));
  if (afterReorder - base < 1) fail("legit reorder emitted no order at all", afterReorder - base);
  g.clock.tick(5000); g.clock.tick(5000);         // idle
  while (g.pending.length) { g.bridge._sm.ingest(g.pending.shift()); await Promise.resolve(); }
  if (g.orders() !== afterReorder) fail("reorder kept emitting order while idle (did not converge)", g.orders() - afterReorder);
  console.log("[reconcile-order] ok — a legit reorder emits and converges (no idle re-emit)");

  console.log("[reconcile-order] PASS — the ORDER pin only reorders buffered songs; stuck in-flight can't loop, real reorders converge");
  process.exit(0);
})();
