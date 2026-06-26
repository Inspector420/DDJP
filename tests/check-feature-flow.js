// tests/check-feature-flow.js
// WALL: the personal-queue auto-feed. Drives the real UserQueue + Queue through
// the real StreamManager + StateDeriver: songs added before joining just stack;
// joining fills the rotation buffer to 2; each play refills from the stack;
// when the stack and buffer empty the DJ falls out; adding again re-enters.

const assert = require("assert");
const { loadInContext } = require("./_load");

// Stub bridge: ingests sends into the real StreamManager as "@me:hs", rank 20.
const bridge = {
  _sm: null, l: 0, n: 0,
  getUserId() { return "@me:hs"; },
  async sendEvent(channel, type, content) {
    bridge.l++; bridge.n++;
    const body = Object.assign({}, content, { t: type, l: bridge.l, dv: 1 });
    const raw = {
      event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message",
      sender: "@me:hs", senderRank: 20, ts: 1000 + bridge.n,
      content: { body: JSON.stringify(body) }, l: bridge.l
    };
    bridge._sm.ingest(raw);
    return raw;
  }
};
// In-memory StorageIO.
const storage = (() => {
  const m = {};
  return {
    save(k, v) { m[k] = JSON.parse(JSON.stringify(v)); },
    load(k) { return m[k] ? JSON.parse(JSON.stringify(m[k])) : null; },
    remove(k) { delete m[k]; }
  };
})();

const sb = loadInContext(
  ["core/logger.js", "core/store.js", "core/statederiver.js", "core/streammanager.js", "features/queue.js", "features/userqueue.js"],
  { Date, URL, MatrixBridge: bridge, StorageIO: storage }
);
bridge._sm = sb.StreamManager;
const { Queue, UserQueue, StreamManager } = sb;

function fail(msg, got) {
  console.log("[feature-flow] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
const j = (x) => JSON.stringify(x);
function myPending() {
  const e = (StreamManager.getState().rotation || []).find(r => r.user === "@me:hs");
  return e ? e.pending.map(p => p.videoId) : [];
}
function stackIds() { return UserQueue.list().map(s => s.videoId); }
function expect(actualArr, expectedArr, msg) { if (j(actualArr) !== j(expectedArr)) fail(msg, actualArr); }

// Advance: emit a play following the current play-instance (as Playback would).
async function play() {
  const np = StreamManager.getState().nowPlaying;
  return bridge.sendEvent("!ev:hs", "ddjp.dj.play", { p: np ? np.pi : null });
}
const url = (id) => "https://www.youtube.com/watch?v=" + id;

async function run() {
  Queue.init("!ev:hs");
  UserQueue.init("space1");

  // 1) Add three songs before joining — they only stack, nothing is declared.
  UserQueue.add(url("AAA"));
  UserQueue.add(url("BBB"));
  UserQueue.add(url("CCC"));
  expect(stackIds(), ["AAA", "BBB", "CCC"], "songs should stack locally before joining");
  expect(myPending(), [], "nothing should be declared before joining");

  // 2) Join the room queue — the stack fills the buffer to 2.
  UserQueue.joinRoomQueue();
  expect(myPending(), ["AAA", "BBB"], "joining should fill the buffer to 2");
  expect(stackIds(), ["CCC"], "two songs consumed from the stack");

  // 3) A play consumes AAA — the stack refills with CCC.
  await play();
  if (StreamManager.getState().nowPlaying.song.videoId !== "AAA") fail("first play should start AAA");
  expect(myPending(), ["BBB", "CCC"], "buffer should refill from the stack after a play");
  expect(stackIds(), [], "stack now empty");

  // 4) A play consumes BBB — nothing left to refill with.
  await play();
  expect(myPending(), ["CCC"], "buffer drops to one with an empty stack");

  // 5) A play consumes CCC — buffer empty, I fall out of the rotation (soft).
  await play();
  expect(myPending(), [], "buffer empty after last song");
  const stillThere = (StreamManager.getState().rotation || []).some(r => r.user === "@me:hs");
  if (stillThere) fail("I should have fallen out of the visible rotation");

  // 6) After hard fall-out, adding a song only STACKS it — it must NOT silently
  //    re-enter the rotation. Auto-rejoin was removed by explicit design so a DJ
  //    who ran out can keep queuing songs without being thrown back on the decks.
  if (UserQueue.isActive()) fail("should be inactive after falling out of the rotation");
  UserQueue.add(url("DDD"));
  expect(myPending(), [], "adding after fall-out must NOT auto-declare or re-enter");
  expect(stackIds(), ["DDD"], "the added song should just stack locally");

  // 7) Re-joining the room queue explicitly feeds the stacked song back in.
  UserQueue.joinRoomQueue();
  expect(myPending(), ["DDD"], "re-joining should declare the stacked song");

  console.log("[feature-flow] PASS — stack feeds, refills, falls out, and stays out until an explicit re-join");
  process.exit(0);
}

run().catch(e => fail("threw: " + e.message));
