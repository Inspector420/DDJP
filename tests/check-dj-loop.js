// tests/check-dj-loop.js
// WALL: the DJ-loop wiring. Drives the real Queue + Skip feature modules through
// the real StreamManager + StateDeriver pipeline (via a stub bridge that ingests
// what they send) and checks the rotation responds correctly: submit a song,
// another DJ joins, advance (play), self-skip, the VIP gate on skipping others,
// and staff move/remove + owner reset.

const assert = require("assert");
const { loadInContext } = require("./_load");

// Stub bridge: records sends and ingests them into the real StreamManager,
// stamping sender + senderRank like the real channel-origin path would.
const bridge = {
  _sm: null, l: 0, n: 0, user: "@me:hs", rank: 20,
  getUserId() { return bridge.user; },
  async sendEvent(channel, type, content) {
    bridge.l++; bridge.n++;
    const body = Object.assign({}, content, { t: type, l: bridge.l, dv: 1 });
    const raw = {
      event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message",
      sender: bridge.user, senderRank: bridge.rank, ts: 1000 + bridge.n,
      content: { body: JSON.stringify(body) }, l: bridge.l
    };
    bridge._sm.ingest(raw);
    return raw;
  }
};
// Room stub: Skip's VIP gate reads getMyRank().
const roomStub = { rank: 100, getMyRank() { return roomStub.rank; } };

const sb = loadInContext(
  ["core/logger.js", "core/statederiver.js", "core/streammanager.js", "features/queue.js", "features/skip.js"],
  { Date, MatrixBridge: bridge, Room: roomStub }
);
bridge._sm = sb.StreamManager;
const { Queue, Skip, StreamManager } = sb;

function fail(msg, got) {
  console.log("[dj-loop] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
const j = (x) => JSON.stringify(x);
function expectRotation(users, msg) {
  const got = StreamManager.getState().rotation.map(r => r.user);
  if (j(got) !== j(users)) fail(msg, got);
}
function expectNowPlaying(dj, videoId, msg) {
  const np = StreamManager.getState().nowPlaying;
  if (!np || np.dj !== dj || np.song.videoId !== videoId) fail(msg, np);
}
// Send an event as another user at a given rank (simulates a second client).
function actAs(user, rank, type, content) {
  bridge.user = user; bridge.rank = rank;
  return bridge.sendEvent("!ev:hs", type, content);
}

async function run() {
  Queue.init("!ev:hs");
  Skip.init("!ev:hs");

  // 1) I submit a song -> I'm in the rotation with it.
  bridge.user = "@me:hs"; bridge.rank = 20;
  await Queue.submitSong("S1", "https://y/S1");
  expectRotation(["@me:hs"], "submitSong did not put me in the rotation");
  if (j(Queue.myPending().map(p => p.videoId)) !== j(["S1"])) fail("myPending wrong after submit");

  // 2) Another DJ joins.
  await actAs("@b:hs", 20, "ddjp.dj.join", { v: "S2" });
  expectRotation(["@me:hs", "@b:hs"], "second DJ not appended");

  // 3) Genesis advance (Playback would emit this). I play S1, fall out, B is up.
  await actAs("@me:hs", 20, "ddjp.dj.play", { p: null });
  expectNowPlaying("@me:hs", "S1", "genesis play did not start my song");
  expectRotation(["@b:hs"], "I should have fallen out after playing my only song");

  // 4) Self-skip: I'm the DJ, any rank may skip own song -> advance to B/S2.
  bridge.user = "@me:hs"; bridge.rank = 20; roomStub.rank = 20;
  await Skip.skip();
  expectNowPlaying("@b:hs", "S2", "self-skip did not advance to the next DJ");

  // 5) Skip-others gate: I'm not the DJ and I'm below VIP -> blocked, no change.
  bridge.user = "@me:hs"; bridge.rank = 20; roomStub.rank = 0;
  await Skip.skip();
  expectNowPlaying("@b:hs", "S2", "sub-VIP skip of someone else's song was NOT blocked");
  roomStub.rank = 100;

  // 6) Rebuild a rotation, then staff move + remove and owner reset.
  bridge.user = "@me:hs"; bridge.rank = 20;
  await Queue.submitSong("S3");                 // I re-enter (soft fall-out return)
  await actAs("@c:hs", 20, "ddjp.dj.join", { v: "S4" });
  expectRotation(["@me:hs", "@c:hs"], "rebuild rotation order wrong");

  bridge.user = "@staff:hs"; bridge.rank = 60;  // Staff moves C to the front
  await Queue.move("@c:hs", null);
  expectRotation(["@c:hs", "@me:hs"], "staff move did not reorder");

  bridge.user = "@staff:hs"; bridge.rank = 60;  // Staff removes me (Player, below Staff)
  await Queue.remove("@me:hs");
  expectRotation(["@c:hs"], "staff remove did not drop the target");

  bridge.user = "@owner:hs"; bridge.rank = 100; // Owner resets the rotation
  await Queue.reset();
  expectRotation([], "owner reset did not clear the rotation");
  // reset now stops the playing song too — a true zero state for queue and now-playing
  const npAfterReset = StreamManager.getState().nowPlaying;
  if (npAfterReset !== null) fail("reset should have cleared nowPlaying too", npAfterReset);

  console.log("[dj-loop] PASS — submit, join, advance, skip, VIP gate, move, remove, reset all wired correctly");
  process.exit(0);
}

run().catch(e => fail("threw: " + e.message));
