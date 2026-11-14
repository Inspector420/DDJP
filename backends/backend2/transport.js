// backends/backend2/transport.js — the bot-run engine's transport (J24).
//
// SHARED, NOT SEPARATE. Auth, discovery, room CRUD, sync, replay, membership, moderation and the
// whole SDK surface are backend1's and are used unchanged — `backend-selection.md` §4 says transport
// is shared, and it very nearly is. Sending is backend1's too, but for two doors named below: on the
// runner's own client its own acts go straight to it in-process (`sendEvent`, J66), and a side
// message goes through the runner's gate (`sendSide`, J84). The bot engine's own few members (its
// room scope and clock seed, the raw fan-out's ranking, an app's backup and deadline) each say why.
// Three answers about rank change, and each of them changes for the same underlying reason:
// **backend1 encodes the rank ladder in the channel topology and bot mode does not.**
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
let _channels = null;             // this room's channel map, for the one question below about rank
const _rankedListeners = new Map(); // subscriber -> the wrapper handed to the shared fan-out

// SAY IT OUT LOUD. Anything that goes wrong here must be legible in the console rather than
// inferred from a room that quietly does nothing.
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

  // ── A SIDE MESSAGE GOES THROUGH THE RUNNER'S GATE (J84, hook E2) ────────────────────────────────────────────────────
  // The gate is the only door out of `events_owner` (J76), so a side message is a RAW item there — the path
  // `ddjp.bot.here` takes: alone, in order with the runner's relays, inside its send budget, never merged or batched.
  // The same refusals as backend1's (`sideRefusal`, one definition), plus: only a runner running for THIS room sends one.
  sendSide: async function (channels, type, body) {
    const why = B1MatrixBridge.sideRefusal(type, body);
    if (why) return { ok: false, reason: why };
    const owner = channels && channels.events_owner;
    if (!owner) return { ok: false, reason: "no owner-level channel" };
    let mine = false;
    try { const r = (typeof B2Runner !== "undefined" && B2Runner.running && B2Runner.running()) ? B2Runner.room() : null; mine = !!(r && r.log === owner); }
    catch (e) { mine = false; }
    if (!mine) return { ok: false, reason: "no runner is running for this room on this tab" };
    const q = B2Authority.submitRaw(type, body);
    return (q && q.queued) ? { ok: true, queued: true } : { ok: false, reason: "the gate did not queue it" };
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
  // So it runs, whole. What a bot room needs is `B2Checkpoint` sealing on a schedule, which the
  // runner's minute beat drives (`runner.js` `_maybeSeal`). Since `ddjp_620` (J113) the engine
  // declares `peerSeals: false` (`skeleton.js`), and backend1 then neither arms its cadence tick nor
  // asks its seal on a play in a bot room — the line is gone and the pager stays
  // (`check-bot-room-seal`).

  // ── ROOM ENTRY: SCOPE THE FOLD, AND START THE RUNNER IF THAT IS ME ──────────────────────────
  // `features/room.js` calls `seedClock(spaceId)` and then `setRoomScope(channels)` on every room
  // entry, in that order. Those are the two hooks the engine gets, so this is where the pieces that
  // need a room get connected — inside the engine, with no feature file changed.
  seedClock: function (roomId) {
    _spaceId = roomId || null;          // captured here because `setRoomScope` is given channels only
    return B1MatrixBridge.seedClock(roomId);
  },

  // LEAVING (J83): this room's space and channels are forgotten with the room, so the raw wrapper below ranks nothing by
  // them in the lobby; the rest is backend1's.
  leaveRoom: function () {
    _spaceId = null; _channels = null;
    return B1MatrixBridge.leaveRoom();
  },
  setRoomScope: function (channels) {
    _channels = channels || null;
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
  // A RANK CHANGE AFTER ENTRY reaches the runner too: `_runnerFollowsRank`, below the bridge.

  // ── A RAW FROM THE INTENTS CHANNEL IS RANKED BY THE PERSON, NOT BY THE CHANNEL (J64) ───────
  // The shared fan-out stamps `senderRank` from the channel an event arrived on — backend1's proof,
  // where each rung writes to its own events channel. Here EVERYBODY writes to
  // `events-uncategorized`, so that stamp is the lowest rung for every person in the room, and the
  // bot's settings-request handler (`features/botruntime.js`, which reads `raw.senderRank`) judged
  // every delegated request as coming from the bottom of the ladder: staff asking for a setting
  // delegated to staff were refused. The rung in this engine is the power level (§5), read the same
  // way the runner reads it, so subscribers get that instead — for that channel only; every other
  // raw is handed on exactly as the transport stamped it.
  onRawEvent: function (fn) {
    if (typeof fn !== "function" || _rankedListeners.has(fn)) return;
    const wrapped = function (raw, event, room) {
      let r = raw;
      try {
        if (raw && _channels && raw.room_id === _channels.events_uncategorized && raw.sender) {
          r = Object.assign({}, raw, {
            senderRank: B1MatrixBridge.getUserEffectiveRank(_spaceId, _channels, raw.sender),
          });
        }
      } catch (e) { r = raw; }
      return fn(r, event, room);
    };
    _rankedListeners.set(fn, wrapped);
    return B1MatrixBridge.onRawEvent(wrapped);
  },
  offRawEvent: function (fn) {
    const wrapped = _rankedListeners.get(fn);
    if (!wrapped) return;
    _rankedListeners.delete(fn);
    return B1MatrixBridge.offRawEvent(wrapped);
  },

  // THE RUNNER'S OWN SENDS GO STRAIGHT TO IT (J66). On the runner's own client, an act it would
  // write to the intents channel (an idle removal, a repeat skip, its own player's acts) is handed
  // to the runner in-process — same judging, same holding — instead of making a round trip through
  // the room to be relayed back: one message per act, not two. Everything else is unchanged.
  sendEvent: function (roomId, type, content) {
    try {
      if (_channels && roomId === _channels.events_uncategorized &&
          typeof B2Runner !== "undefined" && B2Runner.takesOwn && B2Runner.takesOwn()) {
        return Promise.resolve(B2Runner.submitOwn(type, content));
      }
    } catch (e) {}
    return B1MatrixBridge.sendEvent(roomId, type, content);
  },
  // AN APP'S ADVANCE IS A BACKUP HERE (J66): the runner ends songs, and an app sends one only when
  // a song is this far overdue — enough for a slow relay, short enough that a sleeping bot cannot
  // freeze the room.
  advanceBackupMs: function () { return 10000; },

  // THE APP'S DEADLINE IS THE RUNNER'S ANSWER WINDOW PLUS ITS MARGIN, read from the one send table
  // (J65), so an app gives up only after the runner has stopped trying — its "failed" is then true.
  answerDeadlineMs: function () {
    try { return B2Authority.POLICY.answerWindowMs + B2Authority.POLICY.appMarginMs; }
    catch (e) { return B1MatrixBridge.answerDeadlineMs(); }
  },

  _engine: "backend2",
});

// ── THE RUNNER FOLLOWS THIS ACCOUNT'S RANK WHILE THE TAB IS IN THE ROOM (J137) ─────────────────────────────────────────────
// `setRoomScope` above is the runner's only start, and it runs once, at the room's entry. Live (`?v=605`): the owner gave the bot
// account the Bot rank while its tab was already in the room, and no song played until that tab reloaded. The rank change
// reached `features/room.js`, which restarts the bot runtime and nothing of the engine's. So the engine listens for itself, on
// the shared transport's one rank signal (`onRankChange`, a power-levels state event anywhere), with no bot-room branch above
// the seam: on each one, while this tab is in a bot room,
//   · not running, and the account now holds the runner's rung exactly ON THE LOG CHANNEL -> `B2Runner.start`, the same call
//     entry makes, with every guard of its own (the engine bound, the room declaring it, the rung, the send table);
//   · running for this room, and that rung is gone from the log channel -> `B2Runner.stop`, which sends what was promised.
// THE ORDER A RANK CHANGE LANDS IN. A change is one power-levels event per room — the space, then each channel ("N of M steps",
// `MatrixBridge.assignRank`) — and the runner's gate reads the LOG channel's level (`B2Runner.isRunner(events_owner)`). Asking on
// every event, rather than once per change, is what makes the order not matter: before the log channel's own step lands the
// gate says no and nothing changes; at that step it says yes (or no) and the runner starts (or stops); a later step finds it
// "already" so. A change of someone else's rank asks the same question, gets the same answer, and changes nothing.
// LIVE BEFORE IT WRITES, as at entry: the runner holds every write until this tab is caught up (`onAuthorReady`), so a rank
// raised while the room is still loading starts it holding, and it announces once the fold is live. Intents sent before it
// started are not read, by its own rule (`runner.js`, STARTING, and `announce`): a request made before the rank landed is
// answered by nobody, and the asking app sends it once more after its answer window (`features/userqueue.js` `_follow`).
// Nothing runs in the lobby, in a shared room, or between rooms: `_channels` is this transport's room, set by `setRoomScope` and
// cleared by `leaveRoom`, and the bound engine must be this one.
function _runnerFollowsRank() {
  if (!_channels || !_channels.events_owner || typeof B2Runner === "undefined") return;
  let mode = null;
  try { mode = (typeof Backends !== "undefined" && Backends.active) ? Backends.active() : null; } catch (e) { mode = null; }
  if (mode !== "backend2") return;
  const log = _channels.events_owner;
  let mine = false;
  try { const r = B2Runner.running() ? B2Runner.room() : null; mine = !!(r && r.log === log); } catch (e) { mine = false; }
  if (mine) {
    let still = false;
    try { still = B2Runner.isRunner(log) === true; } catch (e) { still = false; }
    if (still) return;
    let level = null;
    try { level = B1MatrixBridge.getMyPowerLevel(log); } catch (e) { level = null; }
    try { B2Runner.stop("this account's level on the log channel is now " + level + ", not the runner's " + B2Runner.runnerLevel()); }
    catch (e) { _loud("runner threw on stop after a rank change", e); }
    return;
  }
  let r = null;
  try { r = B2Runner.start({ channels: _channels, spaceId: _spaceId }); }
  catch (e) { _loud("runner threw on start after a rank change", e); return; }
  if (r && r.ok && !r.already) _say("runner started — this account's level on the log channel reached the runner's rung after the room opened");
}
// Subscribed once, at load. A throw here is said out loud and does not keep the engine from registering below.
try { B1MatrixBridge.onRankChange(_runnerFollowsRank); }
catch (e) { _loud("the runner cannot follow this account's rank: the transport gave no rank signal", e); }

Backends.register("backend2", { MatrixBridge: B2MatrixBridge });
