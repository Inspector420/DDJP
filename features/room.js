// features/room.js
// Owns room lifecycle — create, join, invite, rank assignment.
// Wires feature modules to the current room on entry.
// Depends on: MatrixBridge, StreamManager, Playback, Queue, Skip, Chat, Store, Logger
//
// Channel routing:
//   Protocol events write to → the highest-rank events channel we can write to
//   Chat reads/writes → chat_uncategorized (everyone, for now — later settable)
//   Every existing events-[rank] channel is replayed into StreamManager on join
//   Blocks are deferred — the room navigates the raw event stream directly

const Room = (() => {
  let current = null;
  const _rankChangeListeners = [];
  let _rankWired = false;
  let _channelWired = false;
  let _settingsWired = false;
  const _settingsListeners = [];
  let _hasEventsChannel = false;   // set in _initModules (wiring), read in _startModules
  // Same-session resume of an interrupted create. If createDDJPSpace fails part
  // way, it throws with e.partial = { spaceId, channels }; we stash it here so a
  // retry of the SAME room name resumes (building only what's missing) instead of
  // starting a second space. In-memory only — cross-reload resume is a later step.
  let _pendingCreate = null;       // { name, partial: { spaceId, channels } } | null
  let _creatingRoom = false;       // feature-layer re-entrancy guard (transport has its own backstop)

  function getCurrent() { return current; }
  function getChannels() { return current ? current.channels : null; }
  function getMyId() { return MatrixBridge.getUserId(); }
  function getMyRank() { return current ? MatrixBridge.getMyRank(current.channels) : 0; }
  function getRoster() { return current ? MatrixBridge.getRoster(current.spaceId) : []; }
  function onRankChange(fn) { if (fn && !_rankChangeListeners.includes(fn)) _rankChangeListeners.push(fn); }

  // The authority rule, in one pure place so it can be tested:
  //   - only Staff+ may set anyone's rank
  //   - you can only touch someone strictly below you (outranked or rank-matched -> denied)
  //   - you can only set a rank strictly below your own (no granting at/above yourself)
  // NOTE: this deliberately does not know about channel existence — that's a
  // separate, orthogonal gate (see highestUnlockedRank below) so the pure
  // authority rule stays exactly what tests/check-authority.js exercises.
  const STAFF_LEVEL = 60;
  function canAssignRank(actorRank, targetRank, newLevel) {
    if (typeof newLevel !== "number" || newLevel < 0) return false;
    if (actorRank < STAFF_LEVEL) return false;   // only Staff+ may assign
    if (targetRank >= actorRank) return false;   // can't touch equals or superiors
    if (newLevel >= actorRank) return false;     // can't grant at or above yourself
    return true;
  }

  // Pure: does this rank's events channel exist yet? A room can't offer or
  // grant a rank it hasn't unlocked — unlocking happens in batches
  // (RoomUpgrade); granting an unlocked rank would leave the assigned user
  // with no events/checkpoints/chat channel to use. The level -> events-channel
  // key comes from the single channel taxonomy in transport (no local copy).
  function isRankUnlocked(channels, level) {
    if (!channels) return level === 0;   // Uncategorized always exists conceptually
    const key = MatrixBridge.eventsKeyForLevel(level);
    return key ? !!channels[key] : false;
  }

  // The highest rank level whose channels exist, for display purposes (e.g.
  // "all ranks unlocked" UI text). NOT used to gate individual grants — use
  // isRankUnlocked for that, since Owner's channel existing from creation
  // doesn't imply the batch ladder in between has caught up.
  function highestUnlockedRank(channels) {
    if (!channels) return 0;
    let max = 0;
    for (const level of [0, 10, 20, 40, 60, 80, 100]) {
      if (isRankUnlocked(channels, level)) max = level;
    }
    return max;
  }

  // Promote/demote. Reads the actor's and target's true authority across all
  // channels first, denies if the actor doesn't strictly outrank both the target
  // and the new level, denies if the room hasn't unlocked the requested rank's
  // channels yet, then sets the target's power across every room.
  async function assignRank(userId, level) {
    if (!current) return false;
    const me = MatrixBridge.getUserId();
    if (userId === me) { Logger.warn("Room: you can't change your own rank"); return false; }
    const actorRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, me);
    const targetRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, userId);
    if (!canAssignRank(actorRank, targetRank, level)) {
      Logger.warn("Room: rank change denied (you=" + actorRank + ", them=" + targetRank + ", requested=" + level + ")");
      return false;
    }
    if (!isRankUnlocked(current.channels, level)) {
      Logger.warn("Room: rank change denied — level " + level + " has no channels yet (room not upgraded)");
      return false;
    }
    await MatrixBridge.assignRank(current.spaceId, current.channels, userId, level);
    Logger.info("Room: assigned " + userId + " to level " + level);
    return true;
  }

  function _wireRankChange() {
    if (_rankWired) return;
    MatrixBridge.onRankChange(_rewireWriteChannel);
    _rankWired = true;
  }

  // Subscribe once to "a new channel appeared in this space" (an upgrade). When
  // it fires, join the channel as fast as possible — events/checkpoints/settings
  // are restricted, so a space member joins with no invite — and fold it in via
  // mergeChannels (which replays new events channels and re-evaluates our write
  // channel). Wire-once-and-persist, like _wireRankChange: the bridge scopes the
  // event to the current space and _onChannelAdded guards on `current`, so a
  // stale fire after a room switch is a harmless no-op. Idempotent: the owner
  // also reaches the same channels through RoomUpgrade → mergeChannels, and
  // re-handling is a no-op (already-mapped check + StreamManager event_id dedup).
  function _wireChannelAdded() {
    if (_channelWired) return;
    MatrixBridge.onChannelAdded(_onChannelAdded);
    _channelWired = true;
  }

  async function _onChannelAdded(childRoomId) {
    if (!current || !childRoomId) return;
    if (Object.values(current.channels).indexOf(childRoomId) >= 0) return;   // already tracked
    const joined = await MatrixBridge.joinChannel(childRoomId);
    if (!joined) return;   // e.g. a rank-gated chat channel we aren't ranked for
    const client = MatrixBridge.getClient();
    const room = client ? client.getRoom(childRoomId) : null;
    if (!room || !room.name) return;
    const key = MatrixBridge.channelKeyFromName(room.name);   // "events-player" -> "events_player"
    if (current.channels[key] === childRoomId) return;
    const add = {}; add[key] = childRoomId;
    mergeChannels(add);   // map + persist + replay (events_ only) + rewire write channel
    Logger.info("Room: auto-joined new channel " + room.name);
  }

  // ---- Room settings (derived truth; owner writes the full blob) ----------
  // The owner posts the complete settings blob to settings-owner; every client
  // derives the last one (last-write-wins) via StateDeriver. getSettings reads
  // that derived value; setSettings (owner only) writes a new full blob and
  // performs the visibility side effect.
  function getSettings() {
    const s = StreamManager.getState().settings;
    return s ? { chat: s.chat, vis: s.vis, bg: s.bg } : { chat: "uncategorized", vis: "private", bg: null };
  }
  function onSettingsChange(fn) { if (fn && !_settingsListeners.includes(fn)) _settingsListeners.push(fn); }

  // Apply derived settings locally: point chat at the chosen tier (everyone),
  // then notify listeners. The visibility side effect is owner-only and is done
  // in setSettings (not here), so non-owners never try to change the space.
  function _applySettings() {
    if (!current) return;
    const s = getSettings();
    const chatId = current.channels["chat_" + s.chat] || current.channels.chat_uncategorized || current.channels.chat_guest;
    if (chatId) Chat.setRoom(chatId);
    for (const fn of _settingsListeners) { try { fn(s); } catch (e) {} }
  }

  function _wireSettings() {
    if (_settingsWired) return;
    StreamManager.on("ddjp.room.settings", _applySettings);   // reads `current` live; safe across rooms
    _settingsWired = true;
  }

  // Owner only. Merge a partial change over the current settings, post the FULL
  // blob (last-write-wins truth everyone derives), and — for visibility — also
  // perform the actual space join-rule change (only the owner can/should).
  async function setSettings(partial) {
    if (!current) return;
    if (MatrixBridge.getMyRank(current.channels) < 100) { Logger.warn("Room: only the owner can change settings"); return; }
    const cur = getSettings();
    const next = {
      chat: (partial && (partial.chat === "uncategorized" || partial.chat === "guest")) ? partial.chat : cur.chat,
      vis:  (partial && (partial.vis === "public" || partial.vis === "private")) ? partial.vis : cur.vis,
      // bg is included in the full blob each time (last-write-wins). An explicit
      // bg key sets it (non-empty string) or clears it (null/""); if bg isn't in
      // the partial, the current value is preserved. NOTE: this only plumbs the
      // value — strict host-allowlist validation of the link lives in the owner
      // settings UI and the validator module (so a malformed/unauthorized link
      // never reaches this write). The reducer stays permissive regardless.
      bg:   (partial && Object.prototype.hasOwnProperty.call(partial, "bg"))
              ? ((typeof partial.bg === "string" && partial.bg) ? partial.bg : null)
              : cur.bg
    };
    const ch = current.channels.settings_owner;
    if (!ch) { Logger.warn("Room: no settings-owner channel"); return; }
    try {
      await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: next });
    } catch (e) { Logger.error("Room: settings write failed: " + e.message); return; }
    // Visibility side effect — open/close the space door. Idempotent if unchanged.
    if (partial && partial.vis && partial.vis !== cur.vis) {
      try { await MatrixBridge.setSpaceJoinRule(current.spaceId, next.vis === "public"); }
      catch (e) { Logger.error("Room: visibility change failed: " + e.message); }
    }
  }

  // Called by RoomUpgrade after a batch creates new channels: fold them into the
  // current map, persist, replay any new events channels, and re-evaluate which
  // channel we should now be writing to (an upgrade may raise our write channel).
  function mergeChannels(newChannels) {
    if (!current || !newChannels) return;
    Object.assign(current.channels, newChannels);
    Store.config.saveRoom({ name: current.name, spaceId: current.spaceId, channels: current.channels });
    for (const key in newChannels) {
      if (key.indexOf("events_") === 0 && newChannels[key]) MatrixBridge.replayRoom(newChannels[key]);
    }
    _rewireWriteChannel();
  }

  async function create(name) {
    if (_creatingRoom) { Logger.warn("Room: a create is already in progress"); throw new Error("a room creation is already in progress"); }
    _creatingRoom = true;
    try {
      // Resume an interrupted create of the SAME room if we hold its partial;
      // otherwise start fresh. createDDJPSpace dedups what we pass against the
      // space's real children, so a resume builds only the missing channels.
      const resuming = (_pendingCreate && _pendingCreate.name === name) ? _pendingCreate.partial : null;
      Logger.info("Room: " + (resuming ? "resuming creation of " : "creating ") + name);

      let result;
      try {
        result = await MatrixBridge.createDDJPSpace(name, resuming);
      } catch (e) {
        // Keep what was built so a retry finishes it instead of orphaning it.
        // (createDDJPSpace no longer tears down on failure.) Persist it too, so
        // the half-built room survives a page reload and can be resumed later.
        if (e && e.partial && e.partial.spaceId) {
          _pendingCreate = { name: name, partial: e.partial };
          try { Store.config.savePendingCreate({ name: name, spaceId: e.partial.spaceId, channels: e.partial.channels || {} }); }
          catch (_) {}
        }
        throw e;
      }

      _pendingCreate = null;   // fully built — nothing left to resume
      try { Store.config.clearPendingCreate(); } catch (_) {}
      const { spaceId, channels } = result;
      current = { name, spaceId, channels };
      Store.config.saveRoom({ name, spaceId, channels });
      _initModules(current);
      _wireRankChange();
      _wireChannelAdded();
      _startModules();   // fresh room, nothing to replay — safe to go live immediately
      await RoomUpgrade.recordCreation();   // seed the 2h cooldown clock (batch 1 done)
      return current;
    } finally {
      _creatingRoom = false;
    }
  }

  // Hydrate the in-memory pending pointer from disk if needed (after a reload,
  // memory is empty but a persisted partial may exist). Returns the normalized
  // { name, partial:{spaceId,channels} } or null.
  function _resolvePending() {
    if (_pendingCreate) return _pendingCreate;
    let p = null;
    try { p = Store.config.loadPendingCreate(); } catch (_) { p = null; }
    if (p && p.name && p.spaceId) {
      _pendingCreate = { name: p.name, partial: { spaceId: p.spaceId, channels: p.channels || {} } };
      return _pendingCreate;
    }
    return null;
  }

  // Is there an interrupted create waiting to be resumed (this session OR a prior
  // one, via persisted state)? Lets the UI show a "Finish creating (N/total)"
  // entry and exclude the half-built space from the normal owned list by spaceId.
  // Returns { name, spaceId, built, total } | null.
  function pendingCreate() {
    const rec = _resolvePending();
    if (!rec) return null;
    const ch = rec.partial && rec.partial.channels ? rec.partial.channels : {};
    return { name: rec.name, spaceId: rec.partial ? rec.partial.spaceId : null, built: Object.keys(ch).length, total: 8 };
  }

  // Resume an interrupted creation (same- or cross-session). Loads the pending
  // partial if not already in memory, then runs create() which dedups against
  // the partial + the space's live children and builds only what's missing.
  async function resumeCreate() {
    const rec = _resolvePending();
    if (!rec) { Logger.warn("Room: nothing to resume"); return null; }
    return create(rec.name);
  }

  // User chose to abandon a half-built room. Best-effort leave of its space +
  // channels, then clear every trace of the pending so its card disappears. The
  // explicit, user-driven counterpart to the (removed) auto-teardown — we never
  // do this on a failure, only when the user asks. Local state is cleared even if
  // some leaves fail, so the abandoned room stops being tracked regardless.
  async function discardPendingCreate() {
    const rec = _resolvePending();
    if (!rec) { Logger.warn("Room: nothing to discard"); return false; }
    const sid = rec.partial ? rec.partial.spaceId : null;
    const ch = rec.partial ? rec.partial.channels : {};
    try { await MatrixBridge.discardCreation(sid, ch); }
    catch (e) { Logger.warn("Room: discard leave failed (clearing locally anyway): " + e.message); }
    _pendingCreate = null;
    try { Store.config.clearPendingCreate(); } catch (_) {}
    Logger.info("Room: discarded interrupted creation of " + rec.name);
    return true;
  }

  async function join(spaceId) {
    Logger.info("Room: joining " + spaceId);
    await MatrixBridge.joinDDJPSpace(spaceId);
    // joinDDJPSpace has joined the Space + every advertised child; now wait until
    // those child room objects have actually synced in, so the channel map below
    // is COMPLETE (a child still loading would be silently dropped from the map
    // and never replayed). Replaces a fixed 2s sleep; returns as soon as they
    // resolve, capped so it can't hang.
    await MatrixBridge.waitForSpaceChildren(spaceId, { needJoined: true });

    const space = MatrixBridge.getClient().getRoom(spaceId);
    const name = space ? space.name : spaceId;

    // Rebuild channel map from space children by room name
    // Room name "events-player" → key "events_player"
    const channels = {};
    if (space) {
      const children = space.currentState.getStateEvents("m.space.child");
      for (const child of children) {
        const roomId = child.getStateKey();
        const room = MatrixBridge.getClient().getRoom(roomId);
        if (!room) continue;
        const key = MatrixBridge.channelKeyFromName(room.name);
        channels[key] = roomId;
      }
    }

    current = { name, spaceId, channels };
    Store.config.saveRoom({ name, spaceId, channels });
    _initModules(current);
    _wireRankChange();
    _wireChannelAdded();

    // Replay every existing events-[rank] channel — full ordered log across ranks.
    // AWAIT it: history must be fully in StreamManager before we go live, or the
    // playback tick loop fires against pre-replay state (the documented cold-start
    // guarantee). The waitForSpaceChildren above already guaranteed every channel
    // room has synced in, so we go straight to replay (replayRoom paginates each
    // channel's full backlog itself); no fixed pre-replay sleep is needed.
    await _replayAllChannels(channels);

    // Only now, with history fully replayed into StreamManager, go live —
    // this starts Playback's tick loop, so it never ticks against empty state.
    _startModules();

    return current;
  }

  async function invite(userId) {
    if (!current) return;
    await MatrixBridge.inviteToSpace(current.spaceId, current.channels, userId);
    Logger.info("Room: invited " + userId);
  }

  // promote/demote both go through assignRank now.
  async function promote(userId, level) { return assignRank(userId, level); }

  async function _replayAllChannels(channels) {
    // Replay every existing events-[rank] channel so StreamManager sees the
    // complete ordered log across all ranks. Also replay settings-owner so the
    // derived room settings (ddjp.room.settings) are reconstructed. Blocks/
    // checkpoints are deferred.
    //
    // AWAIT every replay before returning. replayRoom is async — it back-paginates
    // each channel's FULL history before ingesting — so firing these without
    // waiting let _startModules() (and with it Playback's tick loop + UserQueue
    // resync) run against a half-replayed Spine. That is the exact race the
    // wire -> replay -> start split exists to prevent (03_consensus.md "Joiner
    // cold-start"): the advance-lock chain can't anchor from its p=null genesis on
    // a truncated log, so already-played songs resurface. allSettled (not all) so
    // one channel's failure can't strand the rest and leave us never going live.
    const jobs = [];
    for (const key in channels) {
      if ((key.indexOf("events_") === 0 || key === "settings_owner") && channels[key]) {
        jobs.push(MatrixBridge.replayRoom(channels[key]));
      }
    }
    await Promise.allSettled(jobs);
  }

  // Wiring phase: reset state, seed this room's clock, and wire every module
  // EXCEPT Playback's live tick loop. Safe to call before replay — nothing here
  // acts on stream state on a timer; it only subscribes and prepares.
  function _initModules(room) {
    StreamManager.reset();
    MatrixBridge.seedClock(room.spaceId);   // per-room Lamport clock starts/resumes here

    const ch = room.channels;

    // Protocol events — write to the HIGHEST-rank channel we can write to.
    // The rank of that channel is our rank; transport picks it from our write
    // permissions and degrades gracefully if higher-rank channels don't exist.
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;

    // Chat — everyone uses the uncategorized chat for now. (A future room setting
    // will let an owner repoint the default to guest; not hardcoded beyond this.)
    const chatChannel = ch.chat_uncategorized || ch.chat_guest;

    if (eventsChannel) {
      Queue.init(eventsChannel);
      Skip.init(eventsChannel);
      Playback.initWiring(eventsChannel);   // subscribe only — does NOT start ticking yet
      // Reactions is a non-critical annotation feature (★ save / ▲ vote). It wires LAST and
      // defensively: if features/reactions.js failed to load (stale cache / missing file /
      // bad ?v=), it must NOT throw and take the core play loop (Queue/Skip/Playback) down
      // with it. Guarded so a reactions problem can only ever disable reactions.
      try { if (typeof Reactions !== "undefined" && Reactions.init) Reactions.init(eventsChannel); }
      catch (e) { Logger.warn("Room: Reactions.init failed (reactions disabled): " + (e && e.message)); }
    } else {
      Logger.warn("Room: no writable events channel — queue/skip/playback not wired");
    }

    if (chatChannel) {
      Chat.init(chatChannel);
    } else {
      Logger.warn("Room: no chat channel available — chat not wired");
    }

    // Room upgrades watch the owner channel for batch start/done events.
    RoomUpgrade.init(ch.events_owner);

    // Personal song stack that auto-feeds the rotation when active.
    UserQueue.init(room.spaceId);

    // Room settings derive from settings-owner; subscribe once and apply (points
    // chat at the configured tier). Replay (join) feeds the current setting in.
    _wireSettings();
    _applySettings();   // apply current/default immediately so chat starts on the right tier

    // Blocks are deferred — the room navigates the raw event stream directly.

    _hasEventsChannel = !!eventsChannel;

    Logger.info("Room: modules wired" +
      " events=" + (eventsChannel || "none") +
      " rank=" + MatrixBridge.getMyRank(ch) +
      " chat=" + (chatChannel || "none"));
  }

  // Start phase: called only AFTER replay (for join) or immediately after
  // wiring (for create, which has no history to replay). This is what actually
  // begins Playback's live tick loop, so the loop never sees empty pre-replay
  // state. Idempotent and safe if there's no events channel.
  function _startModules() {
    UserQueue.resync();   // history is in place — reconcile auto-feed to real membership
    if (_hasEventsChannel) Playback.start();
    Logger.info("Room: modules started (live)");
  }

  // Re-route protocol writes when our rank changes (we may gain or lose a higher
  // channel). Re-points the feature modules at the new highest writable channel.
  function _rewireWriteChannel() {
    if (!current) return;
    const ch = current.channels;
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;
    if (!eventsChannel) return;
    Queue.init(eventsChannel);
    Skip.init(eventsChannel);
    Playback.init(eventsChannel);
    try { if (typeof Reactions !== "undefined" && Reactions.init) Reactions.init(eventsChannel); }
    catch (e) { Logger.warn("Room: Reactions.init (rewire) failed: " + (e && e.message)); }
    Logger.info("Room: rank changed — now writing to " + eventsChannel +
      " (rank " + MatrixBridge.getMyRank(ch) + ")");
    for (const fn of _rankChangeListeners) { try { fn(MatrixBridge.getMyRank(ch)); } catch (e) {} }
  }

  // --- DDJP room discovery ---
  // Scans the Matrix client's already-synced room list for DDJP-formatted spaces.
  // A space is DDJP if it has children named "events-owner" and "events-uncategorized".
  // Returns { owned: [...], joined: [...], invited: [...] }, each entry
  // { name, spaceId }. "owned"/"joined" are validated DDJP spaces you're
  // already a member of (children synced, checked the same way as before).
  // "invited" are spaces you've been invited to but haven't joined — their
  // child rooms are NOT synced yet (Matrix doesn't sync invite-room children),
  // so they're identified by space type alone; full validation happens once
  // accepted and joined, same as any other join.
  function scanDDJPRooms() {
    const matrixClient = MatrixBridge.getClient();
    if (!matrixClient) return { owned: [], joined: [], invited: [] };

    const userId = MatrixBridge.getUserId();
    const owned = [], joined = [], invited = [];

    for (const room of matrixClient.getRooms()) {
      // Must be a Matrix Space
      const createEvent = room.currentState.getStateEvents("m.room.create", "");
      if (!createEvent || createEvent.getContent().type !== "m.space") continue;

      const membership = room.getMyMembership ? room.getMyMembership() : "join";

      if (membership === "invite") {
        invited.push({ name: room.name || room.roomId, spaceId: room.roomId });
        Logger.debug("Room.scan: " + room.name + " — pending invite");
        continue;
      }
      if (membership !== "join") continue;   // ignore left/banned/etc.

      // Must have children named "events-owner" and "events-uncategorized" —
      // these are the two channels guaranteed to exist from room creation
      // (Batch 1). events-player does NOT exist until the room's first
      // upgrade (Batch 2), so checking for it here would hide every room
      // that hasn't been upgraded yet — including rooms you just created.
      const children = room.currentState.getStateEvents("m.space.child");
      let hasEventsOwner = false;
      let hasEventsUncategorized = false;
      for (const child of children) {
        const childRoom = matrixClient.getRoom(child.getStateKey());
        if (!childRoom) continue;
        if (childRoom.name === MatrixBridge.channelName("events", "owner"))         hasEventsOwner = true;
        if (childRoom.name === MatrixBridge.channelName("events", "uncategorized")) hasEventsUncategorized = true;
      }
      if (!hasEventsOwner || !hasEventsUncategorized) continue;

      // Power level 100 in the space = owner
      const plEvent = room.currentState.getStateEvents("m.room.power_levels", "");
      const pl = plEvent ? plEvent.getContent() : {};
      const userLevel = (pl.users && pl.users[userId] !== undefined)
        ? pl.users[userId]
        : (pl.users_default || 0);
      const isOwner = userLevel >= 100;

      const entry = { name: room.name, spaceId: room.roomId };
      (isOwner ? owned : joined).push(entry);
      Logger.debug("Room.scan: " + room.name + " isOwner=" + isOwner);
    }

    Logger.info("Room.scan: owned=" + owned.length + " joined=" + joined.length + " invited=" + invited.length);
    return { owned, joined, invited };
  }

  // Accept a pending space invite: join the space, then join every channel
  // inside it that the room already shows as a child (the channels the user
  // has matching invites/access to). Matrix does not sync an invited space's
  // children automatically, so a join is required before the room's real
  // channel state becomes visible at all.
  async function acceptInvite(spaceId) {
    await MatrixBridge.joinDDJPSpace(spaceId);
    Logger.info("Room: accepted invite to " + spaceId);
  }

  // Live room-list updates. Matrix fires events when you're invited to a room,
  // join/leave one, or a new room appears in sync. We debounce because a single
  // logical change (e.g. accepting an invite) emits several events in a burst;
  // without debouncing the list would re-scan many times in a row.
  const _roomsChangedListeners = [];
  let _roomsWired = false;
  let _roomsDebounce = null;
  function onRoomsChanged(fn) {
    if (fn && !_roomsChangedListeners.includes(fn)) _roomsChangedListeners.push(fn);
    _wireRoomsChanged();
  }
  function _fireRoomsChanged() {
    if (_roomsDebounce) clearTimeout(_roomsDebounce);
    _roomsDebounce = setTimeout(() => {
      _roomsDebounce = null;
      const scanned = scanDDJPRooms();
      for (const fn of _roomsChangedListeners) { try { fn(scanned); } catch (e) {} }
    }, 400);
  }
  function _wireRoomsChanged() {
    if (_roomsWired) return;
    if (!MatrixBridge.getClient()) return;   // not logged in yet; caller can re-invoke after login
    // The SDK listeners live in transport. "Room" fires when a new room/space
    // shows up; "Room.myMembership" fires on invite/join/leave — exactly what
    // moves a space between the owned/joined/invited buckets. We subscribe to
    // the transport emitter and re-scan (debounced); we never attach `.on()` to
    // the client ourselves (that's the transport boundary).
    MatrixBridge.onRoomsChanged(_fireRoomsChanged);
    _roomsWired = true;
  }

  return {
    create, pendingCreate, resumeCreate, discardPendingCreate, join, invite, acceptInvite, promote, assignRank, canAssignRank, isRankUnlocked, highestUnlockedRank, mergeChannels,
    getCurrent, getChannels, scanDDJPRooms, onRoomsChanged,
    getSettings, setSettings, onSettingsChange,
    getMyId, getMyRank, getRoster, onRankChange
  };
})();
