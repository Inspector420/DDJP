// backends/backend2/transport.js — the bot-run engine's transport (J24).
//
// SHARED, NOT SEPARATE. Auth, discovery, room CRUD, sync, sending, replay, membership, moderation
// and the whole SDK surface are backend1's and are used unchanged — `backend-selection.md` §4 says
// transport is shared, and it very nearly is. Three answers change, and each of them changes for
// the same underlying reason: **backend1 encodes the rank ladder in the channel topology and bot
// mode does not.**
//
// backend1 has seven events channels at seven power levels, so two questions have the same answer
// there and different answers here:
//
//   "what rung am I?"      -> backend1: the highest events channel I can WRITE to
//   "where do I write?"    -> backend1: that same channel
//
// A bot room has ONE events channel that anybody may write to. So the rung is no longer provable by
// where a write lands, and where you write no longer says anything about your rung. They come apart:
//
//   "what rung am I?"      -> the power level itself, which is where `assignRank` has always put it
//   "where do I write?"    -> `events-uncategorized`, for everybody, always
//
// Nothing above the seam notices, because both are asked through the same interface methods.
//
// WHY THE SHAPE IS `Object.assign` OVER backend1's MODULE. A hand-written subset would be a second
// list of what transport does, and it would fall behind the first the next time a method is added —
// the forty-ninth signature, a list that covers one thing less than it claims. Copying the whole
// surface and naming only the differences means a new transport method arrives in both engines at
// once, and this file stays a statement of what bot mode does DIFFERENTLY rather than a duplicate.

let _spaceId = null;

// SAY IT OUT LOUD. This engine has never run in a browser, so the first person to open a bot room is
// the one who finds out what breaks. Anything that goes wrong here must therefore be legible in the
// console rather than inferred from a room that quietly does nothing.
function _say(m) { try { Logger.info("backend2: " + m); } catch (e) {} }
function _loud(m, e) { try { Logger.error("backend2: " + m + " — " + ((e && e.message) || e)); } catch (x) {} }

const B2MatrixBridge = Object.assign({}, B1MatrixBridge, {

  // EVERYONE WRITES TO THE SAME PLACE. Not "the best channel you can write to" — there is only one,
  // and its level is 0 so the answer never depends on who is asking. A room where the write target
  // varied by rank would be a room where the bot could tell rungs apart by where a message landed,
  // which is the proof bot mode deliberately gives up.
  getWriteChannelId: function (channels) {
    return (channels && channels.events_uncategorized) || null;
  },

  // Checkpoints ride in `events-owner` beside the events they cover (§2c), so there is no
  // `checkpoints_` channel to choose between. Only the runner and the owner may write there.
  getCheckpointChannelId: function (channels) {
    return (channels && channels.events_owner) || null;
  },

  // ── EVERY RUNG USES THE SAME EVENTS CHANNEL, SO EVERY RUNG EXISTS ───────────────────────────
  // backend1 maps each rung to its OWN events channel, and `features/room.js` decides which ranks a
  // room has "unlocked" by asking whether that channel is present — rungs appear as the room
  // upgrades and grows more of them. A bot room has two events channels, so only two rungs showed in
  // the rank menu and **no middle rank could be granted at all.** Reported from a live room: the
  // dropdown was missing every option between uncategorized and owner, which is also why a guest
  // could never be lifted to `minDjRank` and so could never join the queue.
  //
  // In this engine rank is a power level, not a place you may write (§5) — everyone writes to the
  // one events channel whatever their rung. So every rung maps to it, every rung is present, and the
  // whole ladder is grantable. The two other callers want the same answer for the same reason: they
  // ask for "the channel my rung writes to" in order to send, and there is only one.
  eventsKeyForLevel: function () { return "events_uncategorized"; },

  // THE RUNG IS THE POWER LEVEL, READ DIRECTLY. `assignRank` has always written
  // `m.room.power_levels` → `users[userId] = level` across the Space and every channel; backend1
  // just reads it back indirectly by testing writes. Here it is read for what it is.
  //
  // `getUserEffectiveRank` already takes the maximum across every room it is given, and tolerates a
  // null space id, so the channel map alone is enough. Reusing it rather than writing a second
  // reader is the point: one definition of how a rung is read from Matrix, shared by both engines.
  getMyRank: function (channels) {
    const me = B1MatrixBridge.getUserId();
    if (!me) return 0;
    return B1MatrixBridge.getUserEffectiveRank(null, channels, me);
  },

  // ── `wireCheckpoints` IS NOT OVERRIDDEN, AND THAT WAS TRIED ─────────────────────────────────
  // v382 made it a no-op here, to stop `SEAL asked by cadence tick — not yet — nowhere-to-post`
  // repeating once a minute in a bot room. The seal genuinely cannot work: `wireCheckpoints`
  // resolves its target with backend1's OWN `getCheckpointChannelId` — a local call the bound
  // override cannot reach — and it looks for a `checkpoints_` channel a bot room does not have.
  //
  // **BUT THAT FUNCTION DOES TWO JOBS.** Its first line is `_wireConcepts(channels)`, which sets the
  // settings channel and attaches `Floor` — the history pager among them. Stubbing the whole
  // function to silence a log line took those with it, and the next live run said
  // `history backfill failed (no-pager)` where it had said `backfill ok` before.
  //
  // So it runs. The seal still finds nowhere to post and still says so once a minute, and that line
  // is NOISE rather than breakage — the wrong trade was silencing it at the cost of a working
  // feature. What a bot room actually needs is `B2Checkpoint` sealing on a schedule, which nothing
  // drives yet.

  // ── ROOM ENTRY: SCOPE THE FOLD, AND START THE RUNNER IF THAT IS ME ──────────────────────────
  // `features/room.js` calls `seedClock(spaceId)` and then `setRoomScope(channels)` on every room
  // entry, in that order. Those are the two hooks the engine gets, so this is where the pieces that
  // need a room get connected — inside the engine, with no feature file changed.
  seedClock: function (roomId) {
    _spaceId = roomId || null;          // captured here because `setRoomScope` is given channels only
    return B1MatrixBridge.seedClock(roomId);
  },

  setRoomScope: function (channels) {
    const out = B1MatrixBridge.setRoomScope(channels);

    // WITHOUT THIS NOTHING FOLDS. `B2StreamManager` fails closed until a fold scope is bound, which
    // is the right direction and useless if nobody ever binds one: the room would sit permanently
    // empty with no error anywhere. It was built and left unwired until the pre-deploy audit.
    try { B2StreamManager.setFoldScope(channels); }
    catch (e) { _loud("could not scope the fold", e); }

    // AND THE RUNNER, IF THIS CLIENT IS IT. `start` refuses unless the bot-run engine is bound, the
    // room declares it, and this client holds the ladder's top rung exactly — so on every other
    // client in the room this is a no-op that says why.
    try {
      const r = B2Runner.start({ channels: channels, spaceId: _spaceId });
      if (r && r.ok) _say("runner started");
      else _say("runner not started: " + ((r && r.reason) || "unknown"));
    } catch (e) { _loud("runner threw on start", e); }

    return out;
  },

  _engine: "backend2",
});

Backends.register("backend2", { MatrixBridge: B2MatrixBridge });
