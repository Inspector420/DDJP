// backends/backend2/streammanager.js — the bot-run engine's door (J24 slice 3).
//
// WHAT IS ACTUALLY DIFFERENT ABOUT BOT MODE, AND WHAT IS NOT.
//
// The fold is not different. `statederiver.js` reads these fields of an event and no others — type,
// eventId, ts, sender, senderRank, content — and one definition of what a room IS serves both
// engines. That is the largest saving in J24 and the thing that stops the two modes drifting into
// two different games. So this file does not reimplement folding, deduplication, the already-banked
// floor gate, or the emit loop: it reshapes what arrives and hands it to the shared machinery.
//
// What IS different is **where authorship comes from**. backend1 proves your rung by which channel
// accepted your write — seven events channels, homeserver-enforced, and the channel an event landed
// in is unforgeable. Bot mode has one events channel anybody may write to, so that proof is gone.
// The bot reads intents, decides, and republishes into `events-owner`, which only it and the owner
// may write. The Matrix `sender` of every event there is therefore THE BOT, and the real actor,
// their rung and the moment they acted travel in the body.
//
// ── THE THREE FIELDS, AND WHY THE THIRD IS NOT COSMETIC ────────────────────────────────────────
//   actor -> sender       who really did it
//   rank  -> senderRank   the rung the bot evaluated them at, frozen at that moment
//   at    -> ts           WHEN THE PERSON ACTED, not when the bot relayed it
//
// `at` was nearly missed. The reducer reads `ev.ts`, and `ServerClock` learns the
// shared server-time offset from incoming timestamps, so taking Matrix's `origin_server_ts` would
// make every action appear to happen when the bot spoke — shifting playback elapsed, AFK timing and
// the countdown by exactly the batch window. Reading it live is for deciding; the stamped values
// are for folding.
//
// ── WHY THIS DELEGATES RATHER THAN DUPLICATES ─────────────────────────────────────────────────
// backend1's `normalise` already passes through anything that arrives reducer-shaped. That is the
// hook: reshape here, and the whole of the shared door runs unchanged behind it — the same five
// checks, the same dedupe, the same floor gate. A second copy of that machinery would be a second
// place for the two engines to disagree about what a room is, which is the collision this tree
// spends most of its guards preventing.
//
// LIVE. `skeleton.js` registers `backend2` with `ready: true`, so a room created as bot-run binds
// this door. (This paragraph said NOT READY / `ready: false` for as long as that had stopped being
// true — corrected at ddjp_415. Read readiness from the registration, never from this comment.)
// It is driven by `check-backends` PART G.

const B2StreamManager = (() => {
  // The rooms whose events may be FOLDED. Everything else the transport delivers is refused here.
  // `events-uncategorized` carries intents: they are what the bot reads, never what a client folds,
  // and a client that folded them would be running a different room from everyone else — every
  // request treated as though it had been granted.
  let _fold = null;

  function setFoldScope(channels) {
    const ch = channels || {};
    _fold = {
      log: ch.events_owner || null,
      settings: ch.settings_owner || null,
    };
    return _fold;
  }
  function foldScope() { return _fold; }

  function _inScope(roomId) {
    if (!_fold) return false;            // fail closed: nothing folds until a scope is bound
    return roomId === _fold.log || roomId === _fold.settings;
  }

  // One inner event -> reducer shape. `event_id` and `room_id` are carried alongside the reducer
  // fields because the shared door validates and deduplicates on those.
  // `carrierL` is the position of the Matrix event the inner one arrived in. An inner event of a
  // batch has no `l` of its own — `sendEvent` stamps the CARRIER from the room clock, and a second
  // counter in the runner would have been a second opinion about ordering. So the whole batch shares
  // its carrier's position and the `#i` suffix separates the members, which the reducer's
  // `(l, event_id)` sort already orders correctly.
  function _shape(raw, parsed, id, carrierL) {
    return {
      eventId: id,
      event_id: id,                       // the shared door dedupes on this
      room_id: raw.room_id,
      roomId: raw.room_id,
      type: parsed.t,
      content: parsed,
      l: typeof parsed.l === "number" ? parsed.l
       : (typeof carrierL === "number" ? carrierL : (typeof raw.l === "number" ? raw.l : 0)),
      // THE THREE OVERRIDES. Each falls back to the Matrix-level answer, so an event the bot did
      // not relay — an owner-written `ddjp.room.settings`, which is authored directly (§2a) — still
      // folds correctly with its own sender and timestamp.
      ts: typeof parsed.at === "number" ? parsed.at : (raw.ts || raw.origin_server_ts || 0),
      sender: parsed.actor || raw.sender || null,
      // FALLS BACK TO WHAT TRANSPORT STAMPED, exactly as `sender` and `ts` do above. This read
      // `: undefined` and it shipped: a directly-authored event — an owner's `ddjp.room.settings`,
      // which is written straight to `settings-owner` (§2a) — carries no `rank` in its body, so its
      // rung became `undefined`, `Ranks.permits(undefined, "room.settings")` was false, and the
      // reducer refused it as not-permitted. The event reached the log and changed nothing: the
      // write succeeded, the message was visible in the channel, and the UI never moved.
      //
      // AND THE FALLBACK IS SOUND RATHER THAN CONVENIENT. Channel-origin rank still PROVES
      // something in a bot room — just not everywhere. `settings-owner` is gated at 99 by the
      // homeserver, so anyone whose write landed there is 99, and `_channelRank` says so. What bot
      // mode gives up is the proof for `events-uncategorized`, which anyone may write to — and
      // events from there never fold at all (`_inScope`). Every room this line can see is
      // rank-gated, so the stamp it falls back on is as good as the channel it came from.
      senderRank: typeof parsed.rank === "number" ? parsed.rank
                : (typeof raw.senderRank === "number" ? raw.senderRank : undefined),
    };
  }

  // A batch is ONE Matrix message carrying several ddjp events: one API call instead of N, which is
  // the actual saving, and crash-atomic because a Matrix event either landed or it did not — there
  // is no half-applied batch to reconcile. Inner ids are derived from the carrier's so dedupe and
  // the reducer's `(l, event_id)` sort still separate them.
  function _unpack(raw) {
    let parsed = null;
    try { parsed = JSON.parse(raw.content.body); } catch (e) { return []; }
    if (!parsed || !parsed.t || !String(parsed.t).startsWith("ddjp.")) return [];
    if (parsed.t === "ddjp.batch") {
      const evs = Array.isArray(parsed.evs) ? parsed.evs : [];
      const out = [];
      for (let i = 0; i < evs.length; i++) {
        const inner = evs[i];
        if (!inner || !inner.t || !String(inner.t).startsWith("ddjp.")) continue;
        out.push(_shape(raw, inner, raw.event_id + "#" + i, parsed.l));
      }
      return out;
    }
    return [_shape(raw, parsed, raw.event_id)];
  }

  function normalise(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.eventId && raw.content && typeof raw.content === "object" && raw.content.t) return raw;
    if (raw.type !== "m.room.message") return null;
    if (!_inScope(raw.room_id)) return null;
    const out = _unpack(raw);
    return out.length ? out[0] : null;
  }

  // A checkpoint rides in `events-owner` beside the events it covers (§2c), so it arrives on the
  // ordinary fold path rather than from a separate room. Routed to the runner's floor, and NOT
  // handed to the shared door: the reducer has no `ddjp.checkpoint` case, and backend1's checkpoint
  // machinery is the candidate-and-grading apparatus bot mode exists without.
  // B2Checkpoint IS REQUIRED, not optional. An earlier draft guarded these three with
  // `typeof B2Checkpoint !== "undefined"`, which would have let a module that failed to load leave
  // the saves list quietly empty and every checkpoint quietly unadopted — a defensive guard hiding
  // a real absence, which is the shape this tree spends most of its guards catching. All three
  // references are at RUNTIME, so load order between these files is free either way.
  function _routeCheckpoint(shaped) {
    if (!shaped || !shaped.content || shaped.content.t !== B2Checkpoint.TYPE) return false;
    B2Checkpoint.observe(shaped.content, { id: shaped.event_id, at: shaped.ts });
    return true;
  }

  function ingest(raw) {
    if (!raw || typeof raw !== "object") return;
    if (raw.eventId && raw.content && typeof raw.content === "object" && raw.content.t) {
      if (_routeCheckpoint(raw)) return;
      return B1StreamManager.ingest(raw);          // already shaped (replay of our own output)
    }
    if (raw.type !== "m.room.message") return;
    if (!_inScope(raw.room_id)) return;            // intents never fold — see `_fold` above
    for (const ev of _unpack(raw)) { if (!_routeCheckpoint(ev)) B1StreamManager.ingest(ev); }
  }

  // Everything not listed here is the shared door's, deliberately: the state, the log, the
  // subscriptions, the settings readers and the checkpoint surface all behave identically, because
  // in bot mode they are answering about the same folded room.
  // The lobby's saves list reads `heldCheckpoints` and `exportCheckpoint` through `Room`, and in a
  // bot room those answers come from the runner's floor rather than backend1's candidate set.
  // `BEHAVIOUR.md` §Entering a room is why this must keep answering after a room is left: the list
  // is of the LAST room, and clearing on leave would blank the control.
  function heldCheckpoints() { return B2Checkpoint.held(); }
  function exportCheckpoint(id) {
    const cp = B2Checkpoint.byId(id);
    if (!cp) return null;
    try { return CheckpointFormat.saveFile(cp); } catch (e) { return cp; }
  }
  function reset() {
    B2Checkpoint.reset();
    return B1StreamManager.reset();
  }

  return Object.assign({}, B1StreamManager, {
    ingest, normalise, setFoldScope, foldScope,
    heldCheckpoints, exportCheckpoint, reset,
    _engine: "backend2",
  });
})();

Backends.register("backend2", { StreamManager: B2StreamManager });
