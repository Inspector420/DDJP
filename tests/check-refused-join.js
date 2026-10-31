// tests/check-refused-join.js
// SUBJECT: features/userqueue.js
// WALL: A JOIN THE ROOM REFUSES DOES NOT LEAVE "MY QUEUE" ACTIVE FOREVER (the owner's ruling, ddjp_423).
//
// `Queue.submitSong` resolves once the SEND succeeds, and the fold may still refuse the join — below
// the room's `minDjRank`, for one. `UserQueue._clearLanded` released an in-flight song only when it
// appeared in my declared buffer, which a refused join never does; so the song stayed in flight,
// `_detectFallout` never fired, and the Join button read "Leave" for somebody the room had turned
// away. Nothing was re-sent, which is why it was silent rather than noisy.
//
// DRIVEN AGAINST THE REAL REDUCER, never a double deciding legality: the owner raises the bar with a
// real `ddjp.room.settings` event and an uncategorized account's join is refused by the real fold
// (`rank-below-min-dj`). The harness is `check-reconcile-order`'s — the real StreamManager, Queue and
// UserQueue, with a transport that lands each sent event synchronously.
//
//   J1  the refused join ends "active" — Join comes back, so the button can ask the rules and say why
//   J2  it ends AT ONCE: the same song is not re-sent into the same refusal (`_bufferStarving` runs
//       in the same state change, and would have)
//   J3  control: at the default bar the same join is accepted, and I stay active and in the rotation
//   J4  an OLD refusal for the same song does not end a NEW join that the room accepts — attempts are
//       told apart by log identity, not by a clock

const { loadInContext } = require("./_load");

let checks = 0;
function fail(msg, got) {
  console.log("[refused-join] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { checks++; if (!c) fail(msg, got); }

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function harness() {
  let rank = 0;                       // the rank MY events carry; the owner's settings carry 100
  const sent = [], pending = [];
  const bridge = {
    _sm: null, l: 0, n: 0, getUserId() { return "@me:hs"; },
    async sendEvent(c, t, co) {
      bridge.l++; bridge.n++;
      sent.push({ t, v: co && co.v });
      const raw = {
        event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message",
        sender: "@me:hs", senderRank: rank, ts: 1000 + bridge.n,
        content: { body: JSON.stringify(Object.assign({}, co, { t: t, l: bridge.l, dv: 1 })) }, l: bridge.l,
      };
      // JOINS LAND LATER, as on a network. A join that lands INSIDE its own send is handled as a
      // re-entrant update, which skips `_bufferStarving` — so a synchronous harness can never see the
      // re-send this guards against (J2), nor the gap in which an old refusal could end a new join (J4).
      if (t === "ddjp.dj.join") pending.push(raw); else bridge._sm.ingest(raw);
      return raw;
    },
  };
  const storage = (() => { const m = {}; return {
    save(k, v) { m[k] = JSON.parse(JSON.stringify(v)); }, load(k) { return m[k] ? JSON.parse(JSON.stringify(m[k])) : null; },
    remove(k) { delete m[k]; } }; })();
  const sb = loadInContext(
    ["core/logger.js", "core/store.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
     "backends/backend1/streammanager.js", "core/playlistdoc.js", "features/queue.js", "features/userqueue.js"],
    { Date, URL, MatrixBridge: bridge, StorageIO: storage });
  bridge._sm = sb.StreamManager;
  const clock = { set() { return 0; }, clear() {}, now() { return 0; } };
  sb.UserQueue.setClock(clock);
  // A real owner settings event, through the same ingest path, carrying the FULL blob.
  const setBar = (bar, extra) => {
    bridge.l++; bridge.n++;
    const s = Object.assign(sb.StateDeriver.defaultSettings(), { minDjRank: bar }, extra || {});
    sb.StreamManager.ingest({ event_id: "$s" + bridge.n, room_id: "!r:hs", type: "m.room.message",
      sender: "@owner:hs", senderRank: 100, ts: 1000 + bridge.n,
      content: { body: JSON.stringify({ s, t: "ddjp.room.settings", l: bridge.l, dv: 1 }) }, l: bridge.l });
  };
  // SOMEBODY ELSE'S queue act — the kind of update that actually wakes UserQueue (a settings change
  // does not: it listens for queue and rotation changes, which is the whole room's traffic).
  const other = (vid) => {
    bridge.l++; bridge.n++;
    sb.StreamManager.ingest({ event_id: "$o" + bridge.n, room_id: "!r:hs", type: "m.room.message",
      sender: "@other:hs", senderRank: 20, ts: 1000 + bridge.n,
      content: { body: JSON.stringify({ v: vid, u: "https://www.youtube.com/watch?v=" + vid, t: "ddjp.dj.join", l: bridge.l, dv: 1 }) }, l: bridge.l });
  };
  const inRot = () => !!(sb.StreamManager.getState().rotation || []).find((r) => r.user === "@me:hs");
  // BOUNDED: a re-send loop is exactly what J2 exists to catch, and an unbounded flush would turn
  // that failure into a hang. Twenty deliveries is far past any honest join sequence here.
  const flush = async () => { for (let i = 0; i < 20 && pending.length; i++) { bridge._sm.ingest(pending.shift()); await settle(); } };
  return { sb, sent, setBar, other, inRot, flush, setRank: (r) => { rank = r; } };
}
const url = (id) => "https://www.youtube.com/watch?v=" + id;
const joins = (h) => h.sent.filter((x) => x.t === "ddjp.dj.join").length;

(async () => {
  // ── J1 + J2: below the bar ─────────────────────────────────────────────────────────────────
  {
    const h = harness();
    const { Queue, UserQueue } = h.sb;
    Queue.init("!ev:hs"); UserQueue.init("!r:hs"); await settle();
    h.setBar("guest");
    ok(h.sb.StreamManager.getState().settings.minDjRank === "guest", "J PREMISE: the owner's settings event raised the bar",
      h.sb.StreamManager.getState().settings.minDjRank);
    h.setRank(0);                                           // uncategorized: below a Guest bar
    UserQueue.add(url("AAAAAAAAAAA"));
    UserQueue.joinRoomQueue();
    await settle();
    ok(joins(h) >= 1, "J PREMISE: the join was actually sent", h.sent);
    await h.flush();                                        // it lands, and the real fold refuses it
    ok(!h.inRot(), "J PREMISE: and the REAL fold refused it — I am not in the rotation");
    ok(UserQueue.isActive() === false,
      "J1: a join the room refused ends \"active\", so Join comes back instead of a Leave for a queue I am not in",
      { active: UserQueue.isActive() });
    ok(joins(h) === 1,
      "J2: and it ends AT ONCE — the refused song is not re-sent into the same refusal", { joinsSent: joins(h) });
  }

  // ── J3: control — the same join at the default bar ─────────────────────────────────────────
  {
    const h = harness();
    const { Queue, UserQueue } = h.sb;
    Queue.init("!ev:hs"); UserQueue.init("!r:hs"); await settle();
    h.setRank(0);
    UserQueue.add(url("AAAAAAAAAAA"));
    UserQueue.joinRoomQueue();
    await settle();
    await h.flush();
    ok(h.inRot() && UserQueue.isActive() === true,
      "J3 control: at the default bar the same join is accepted and I stay active — J1 is a reading of the refusal",
      { inRotation: h.inRot(), active: UserQueue.isActive() });
  }

  // ── J4: an old refusal does not end a new, accepted join ──────────────────────────────────
  {
    const h = harness();
    const { Queue, UserQueue } = h.sb;
    Queue.init("!ev:hs"); UserQueue.init("!r:hs"); await settle();
    h.setBar("guest"); h.setRank(0);
    UserQueue.add(url("AAAAAAAAAAA"));
    UserQueue.joinRoomQueue();
    await settle(); await h.flush();
    ok(UserQueue.isActive() === false, "J4 premise: the first join was refused and ended", UserQueue.isActive());
    h.setBar("uncategorized");                              // the owner lowers the bar again
    UserQueue.joinRoomQueue();
    await settle();                                         // the new join is SENT, not yet landed…
    // …when somebody else's queue act arrives — the update that really wakes UserQueue. (A settings
    // change does not, which is why an earlier draft of this part could not fail.)
    h.other("BBBBBBBBBBB");
    ok(!!(h.sb.StreamManager.getState().rotation || []).find((r) => r.user === "@other:hs"),
      "J4 PREMISE: the other person's join really landed while mine was in flight");
    await settle();
    ok(UserQueue.isActive() === true,
      "J4: an update arriving while the NEW join is in flight must not read the OLD refusal as this one's",
      { active: UserQueue.isActive() });
    await h.flush();
    ok(h.inRot() && UserQueue.isActive() === true,
      "J4: the OLD refused join for the same song does not end the NEW one the room accepted",
      { inRotation: h.inRot(), active: UserQueue.isActive(), joinsSent: joins(h) });
  }

  console.log("[refused-join] PASS — a join the room refuses no longer leaves \"my queue\" active: driven "
    + "against the real fold at a raised bar, it ends at once without re-sending the song, an accepted "
    + "join at the default bar is untouched, and an old refusal cannot end a new accepted join (" + checks + " assertions)");
})().catch((e) => { console.log("[refused-join] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
