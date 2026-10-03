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

  // ── WHO WAS ACTIVE BEFORE THE SAVE POINT: THE BACKGROUND READ (J67, stage 2) ───────────────
  // Older events of the bot's log, read after the room opened, feed ONLY this list: last act per
  // person per activity group, credited to the person who acted (a relay's `actor`), never to the
  // bot and never to the queue. `since` is how far back the read has looked; `complete`, that it
  // reached the room's start. Until the read covers the activity window, AFK and presence say
  // "can't tell" (the owner's rule).
  // Activity read back past the save point lives in the ONE module, `Activity` (J73 job 2, Q2).
  function noteActivity(raws, opts) {
    // Into the one module (J73 job 2, Q2). Every relayed act counts: the judge refuses what the
    // reducer would refuse, so the bot's log carries accepted acts only (Q3).
    return Activity.noteRaws(raws, _fold && _fold.log, opts);
  }
  function olderActivity() { return Activity.read(); }   // null when nothing was read: no list, not "nobody"
  // `now` defaults to the newest SERVER stamp the held log carries — the backend's own clock, so
  // the transport need not reach for an app module to ask (check-boundaries).
  function activityCovered(now) {
    if (typeof now !== "number") {
      now = null;
      try { for (const e of (B1StreamManager.getLog() || [])) if (e && typeof e.ts === "number" && (now === null || e.ts > now)) now = e.ts; }
      catch (e) { now = null; }
    }
    let w = 0;
    try { w = activityWindowMs((B1StreamManager.getState() || {}).settings); } catch (e) { w = 0; }
    return Activity.covered(now, w);
  }

  function setFoldScope(channels) {
    const ch = channels || {};
    Activity.reset();                               // a new room (J73 job 2)
    _opened = false; _lastMoveOn = null;              // a new room has not opened yet (J73 job 7)
    _downloadStopped = false;
    _fold = {
      log: ch.events_owner || null,
      settings: ch.settings_owner || null,
    };
    // EACH ROOM HAS ONE WRITER HERE, so the door judges "claims the past" inside a room, where
    // every client sees the same server order — never across rooms, whose arrival order differs
    // by client (J70; the shared door's own header has the bot-501 case).
    try { B1StreamManager.setDoorScope("per-room"); } catch (e) {}
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
  // `(l, event_id)` sort orders correctly up to ten members (the authority sends no more per message).
  //
  // THAT WAS THE INTENT AND, UNTIL J64, NOT THE FACT. The runner copied each intent whole, so every
  // member carried its AUTHOR's `l`, and the `parsed.l` branch below took it — the door then refused
  // a member as backdated whenever an instant relay had moved the head past the author's clock. The
  // runner drops the field now. The branch stays because rooms written before J64 hold members that
  // carry one, and their logs must read exactly as they did.
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
  // MEMBER IDS — ONE HOME (J77, reader half). A batch's members share its position and are told apart by an id suffix
  // that every ordering site compares AS TEXT. Batches of ten or fewer keep today's `#0`…`#9` exactly, so every existing
  // message and save point names its members as before; a batch of MORE than ten uses two digits, `#00`…`#19`, so `#10`
  // sorts after `#09`. Readers compute these; the authority names what it sent with the same function.
  function memberId(carrierId, k, n) { return carrierId + "#" + (n > 10 ? String(k).padStart(2, "0") : String(k)); }
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
        out.push(_shape(raw, inner, memberId(raw.event_id, i, evs.length), parsed.l));
      }
      return out;
    }
    return [_shape(raw, parsed, raw.event_id)];
  }

  // ONE event, for callers that can only take one. A group answers with its FIRST member — which
  // is why every caller converting held or paged raws asks `normaliseAll` instead (J64).
  function normalise(raw) {
    const all = normaliseAll(raw);
    return all.length ? all[0] : null;
  }
  // EVERY member. Song history rebuilt from held raws, and paged from the server, went through
  // `normalise` and saw a group's first member only: bot-501's opening two songs rebuilt as one.
  function normaliseAll(raw) {
    if (!raw || typeof raw !== "object") return [];
    if (raw.eventId && raw.content && typeof raw.content === "object" && raw.content.t) return [raw];
    if (raw.type !== "m.room.message") return [];
    if (!_inScope(raw.room_id)) return [];
    return _unpack(raw);
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
  // BOT ROOMS MOVE ON AT EVERY NEW SAVE POINT (J73 job 7, Q7), the same as decentralized rooms. They
  // opened from one and then held everything, so the held log — and with it the judge's cost and the
  // memory — grew all session. After the first opening, each newer usable save point is adopted once
  // it PROVES it reproduces what is held (Q6); activity, history and added times are taken first.
  let _opened = false, _lastMoveOn = null;
  function _moveOn() {
    const cur = (typeof B1StreamManager.adoptedFloor === "function") ? B1StreamManager.adoptedFloor() : null;
    const curL = (cur && typeof cur.floorL === "number") ? cur.floorL : -Infinity;
    const newer = B2Checkpoint.held().filter((h) => typeof h.floorL === "number" && h.floorL > curL)
      .sort((a, b) => b.floorL - a.floorL);
    for (const h of newer) {
      const cp = B2Checkpoint.byId(h.id);
      if (!_usableSavePoint(cp)) continue;
      const r = B1StreamManager.adoptFloor({ floorL: cp.floorL, seed: cp.seed, covers: cp.covers, id: h.id, at: h.at },
        { take: "all", prove: true });
      _lastMoveOn = Object.assign({ cp: h.id }, r);
      if (r && r.ok) return _lastMoveOn;
    }
    return _lastMoveOn;
  }
  function lastMoveOn() { return _lastMoveOn; }
  function _routeCheckpoint(shaped) {
    if (!shaped || !shaped.content || shaped.content.t !== B2Checkpoint.TYPE) return false;
    B2Checkpoint.observe(shaped.content, { id: shaped.event_id, at: shaped.ts });
    if (_opened) { try { _moveOn(); } catch (e) {} }
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
  //
  // ── THE SHAPES THE SAVES LIST READS, AND THE ONES THE NORMAL DOOR RETURNS (J64) ───────────────
  // `ui/screens.js` shows each held checkpoint by `rank`, `floorL`, `at` and `thin`, and its Save
  // button reads `{ ok, file, importable, snapshots, rank }`. This returned `B2Checkpoint.held()`
  // as-is (no rank, no position) and, for Save, `saveFile(cp)` — a checkpoint handed to a function
  // that takes `{ mode, snapshots, keyset, author }` — so the button said "Could not export: unknown"
  // and the file it would have made was empty and marked as a shared room. Both shapes now come
  // from backend1's `exportCheckpoint`, which the button was written against.
  //
  // The author is the runner, which sits at the ladder's top rung, so every checkpoint here is
  // owner-authored and every file importable.
  function _ownerName() { try { return Ranks.nameOf(Ranks.levelOf("owner")); } catch (e) { return "owner"; } }
  // ── OPEN FROM THE BOT'S NEWEST SAVE POINT (J67) ────────────────────────────────────────────
  // The newest held save point (verified on arrival by `B2Checkpoint`) that holds a real starting
  // state, and — when a window is given — is at least that old, so everything inside the window
  // stays held for the activity answers. Old-shape save points are skipped; with none usable the
  // room keeps everything, as before.
  // THE ACTIVITY WINDOW: the longest AFK or idle-queue window plus the longest warning time — a
  // removal decided at the window's edge must still see the evidence behind its warning. The bot
  // engine's own policy, so it is sized here rather than by the app layer (bot settings).
  // Owned by Capabilities (one home — the bot's chat read uses the same rule).
  function activityWindowMs(settings) { return Capabilities.activityWindowMs(settings); }
  // TWO-STAGE OPENING (owner, J67): the room opens from the NEWEST usable save point; the activity
  // window is covered by a background read, not by holding it here. A caller may still pass a
  // window to choose an older save point.
  // ONE RULE FOR "USABLE", shared by the download's stop and the opening (audit, ddjp_512): a
  // save point the opening would skip must never stop the download, or the room folds a cut-off
  // log from an empty start. Usable = verifies, holds a real starting state, AND names a position.
  function _usableSavePoint(cp) {
    if (!cp || typeof cp.floorL !== "number" || !isFinite(cp.floorL) || !StateDeriver.isSeed(cp.seed)) return false;
    try { return typeof CheckpointFormat !== "undefined" && CheckpointFormat.verify(cp) === true; } catch (e) { return false; }
  }
  let _downloadStopped = false;
  function openFromSavePoint() {
    const held = B2Checkpoint.held().slice().sort((a, b) => (b.floorL || 0) - (a.floorL || 0));
    for (const h of held) {
      const cp = B2Checkpoint.byId(h.id);
      if (!_usableSavePoint(cp)) continue;
      const r = B1StreamManager.adoptFloor({ floorL: cp.floorL, seed: cp.seed, covers: cp.covers, id: h.id, at: h.at }, { take: "all" });
      _opened = true;
      return Object.assign({ cp: h.id, stopped: _downloadStopped }, r);
    }
    _opened = true;                     // no save point yet: the first one to arrive is moved on to
    // Only true to say "nothing was dropped" — a download that STOPPED and found nothing to open
    // from is incomplete, and the caller is told so (`stopped`).
    return { ok: false, reason: "no-usable-save-point", stopped: _downloadStopped };
  }

  // ── HAS THE DOWNLOAD REACHED FAR ENOUGH? (J67, stage 1) ───────────────────────────────────
  // Asked by the transport before each page of history. Only the bot's events room stops early,
  // and only once a save point that verifies and holds a real starting state is in — the one the
  // room will open from. Every other room is downloaded whole (settings are read back fully).
  function replayHasEnough(roomId, events) {
    if (!_fold.log || roomId !== _fold.log || !Array.isArray(events)) return false;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (!ev || ev.type !== "m.room.message" || !ev.content || typeof ev.content.body !== "string") continue;
      let b = null;
      try { b = JSON.parse(ev.content.body); } catch (e) { continue; }
      if (!b || b.t !== "ddjp.checkpoint" || !_usableSavePoint(b)) continue;
      _downloadStopped = true;
      return true;
    }
    return false;
  }

  function heldCheckpoints() {
    const rank = _ownerName();
    return B2Checkpoint.held().map((h) => Object.assign({}, h, { rank: rank }));
  }
  function exportCheckpoint(id) {
    try {
      const held = B2Checkpoint.held();
      const pick = held.find((h) => h.id === id);
      if (!pick) return { ok: false, reason: "not-held" };
      if (typeof pick.floorL !== "number") return { ok: false, reason: "unplaceable" };
      const chain = held
        .filter((h) => typeof h.floorL === "number" && h.floorL <= pick.floorL)
        .sort((a, b) => a.floorL - b.floorL)
        .map((h) => B2Checkpoint.byId(h.id))
        .filter(Boolean)
        .map((cp) => ({ t: CheckpointFormat.TYPE, n: cp.n, prev: cp.prev || null, seed: cp.seed,
                        floorL: cp.floorL, thin: cp.thin === true, covers: cp.covers, h: cp.h }));
      const rank = _ownerName();
      const file = CheckpointFormat.saveFile({
        mode: "bot", snapshots: chain,
        keyset: Object.keys(StateDeriver.defaultSettings()),
        author: { rank: rank },
      });
      return { ok: true, reason: null, file: file, importable: true, ownerAuthored: true,
               snapshots: chain.length, rank: rank };
    } catch (e) { return { ok: false, reason: "export-failed" }; }
  }
  function reset() {
    B2Checkpoint.reset();
    return B1StreamManager.reset();
  }

  return Object.assign({}, B1StreamManager, {
    // Which rooms this engine folds — song history pages only those (J73 job 6). Intents never fold.
    foldsRoom: (roomId) => _inScope(roomId),

    lastMoveOn,
    memberId,                 // J77: how a batch's members are named — the authority names its sends with it
    // What the bot has committed to send but not sent — a reload now would lose it (J73, the daily reload).
    unsentCount: () => { try { return (typeof B2Authority !== "undefined" && B2Authority.unsent) ? B2Authority.unsent() : 0; } catch (e) { return 1; } },
    ingest, normalise, normaliseAll, setFoldScope, foldScope, openFromSavePoint, activityWindowMs, replayHasEnough,
    noteActivity, olderActivity, activityCovered,
    heldCheckpoints, exportCheckpoint, reset,
    _engine: "backend2",
  });
})();

Backends.register("backend2", { StreamManager: B2StreamManager });
