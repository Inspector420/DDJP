// transport/matrixbridge.js
// Pure transport. Moves bytes between the core and Matrix homeservers.
// Stamps Lamport clock on outbound. Caches raw events. Delivers to StreamManager.
// Depends on: EventCache, StreamManager, Logger

// Channel model. Events exist for every rank (down to uncategorized);
// checkpoints exist for guest and up (no uncategorized checkpoint); chat has
// exactly three encrypted tiers (uncategorized, guest, staff). Power levels on
// every channel make access track rank: promote -> invited, demote -> removed.
//
// Batch 1 — room creation (8 channels + space):
//   events-uncategorized  open, lvl 0    | events-guest  open, lvl 10 | events-owner open, lvl 100
//   checkpoints-guest     open, lvl 10   | checkpoints-owner open, lvl 100
//   chat-uncategorized    E2E,  lvl 0    | chat-guest     E2E,  lvl 10
//   settings-owner        open, lvl 100
//
// Batch 2 — upgrade 1 (player + VIP, 4 channels):
//   events-player lvl 20 | checkpoints-player lvl 20 | events-vip lvl 40 | checkpoints-vip lvl 40
//
// Batch 3 — upgrade 2 (staff + high-staff, 5 channels):
//   events-staff lvl 60 | checkpoints-staff lvl 60 | events-high-staff lvl 80 |
//   checkpoints-high-staff lvl 80 | chat-staff E2E lvl 60
//
// Map keys use underscores: events_uncategorized, checkpoints_guest, chat_staff, settings_owner, ...
// Everyone currently chats in chat-uncategorized (a temporary default; a future
// room setting will let an owner repoint the default to guest — not hardcoded).

const MatrixBridge = (() => {
  let client = null;
  let _loginInProgress = false;

  // --- Lamport clock — now PER ROOM, not per client ---
  // Each room/space keeps its own monotonic counter. Ordering and convergence
  // only ever compare events WITHIN one room's log (StreamManager is reset on
  // every room switch), so a per-room clock is sufficient and correct — and it
  // means event numbers restart low in each room instead of carrying a single
  // ever-climbing count across every room the client has ever touched.
  // _activeClockRoom names which room tickOutbound/updateInbound currently
  // operate on; seedClock(roomId) sets it (and creates the entry if absent),
  // called at room entry alongside StreamManager.reset().
  const _clocks = {};            // roomId -> highest l seen/sent in that room
  let _activeClockRoom = null;
  let _currentSpaceId = null;    // the space we're currently in — scopes the new-channel watcher

  function seedClock(roomId) {
    if (!roomId) return;
    if (typeof _clocks[roomId] !== "number") _clocks[roomId] = 0;
    _activeClockRoom = roomId;
    _currentSpaceId = roomId;    // room.js calls this with the space id at room entry
  }

  function tickOutbound() {
    if (!_activeClockRoom) return 1;          // no room active yet — defensive
    _clocks[_activeClockRoom] = (_clocks[_activeClockRoom] || 0) + 1;
    return _clocks[_activeClockRoom];
  }

  function updateInbound(l) {
    if (!_activeClockRoom) return;
    if (typeof l === "number") {
      _clocks[_activeClockRoom] = Math.max(_clocks[_activeClockRoom] || 0, l);
    }
  }

  // --- Session persistence ---
  // Saves access token so reloading reuses the same device session.
  // Without this, every login creates a new device and hits matrix.org's device limit.
  const SESSION_KEY = "ddjp_session";

  function _saveSession(homeserver, userId, accessToken, deviceId) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ homeserver, userId, accessToken, deviceId }));
    } catch (e) {
      Logger.warn("MatrixBridge: failed to save session");
    }
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function _clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function hasSession() {
    return _loadSession() !== null;
  }

  async function restoreSession() {
    const session = _loadSession();
    if (!session) return false;
    try {
      client = matrixcs.createClient({
        baseUrl: session.homeserver,
        accessToken: session.accessToken,
        userId: session.userId,
        deviceId: session.deviceId,
      });
      Logger.info("MatrixBridge: restored session as " + session.userId);
      return session;
    } catch (e) {
      Logger.warn("MatrixBridge: session restore failed — " + e.message);
      _clearSession();
      return false;
    }
  }

  // --- Login ---
  async function login(homeserver, username, password) {
    if (_loginInProgress) throw new Error("MatrixBridge: login already in progress");
    _loginInProgress = true;
    try {
      const temp = matrixcs.createClient({ baseUrl: homeserver });
      const response = await temp.loginWithPassword(username, password);
      temp.stopClient();
      client = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        userId: response.user_id,
        deviceId: response.device_id,
      });
      _saveSession(homeserver, response.user_id, response.access_token, response.device_id);
      Logger.info("MatrixBridge: logged in as " + response.user_id);
      return response;
    } finally {
      _loginInProgress = false;
    }
  }

  async function logout() {
    try {
      if (client) await client.logout();
    } catch (e) {}
    _clearSession();
    client = null;
    Logger.info("MatrixBridge: logged out");
  }

  // --- Start sync ---
  async function start() {
    if (!client) throw new Error("MatrixBridge: not logged in");

    // Helper: build raw object and route to StreamManager + rawListeners
    function _routeEvent(event, room) {
      if (!room) return;

      // CRITICAL: ignore local echo that hasn't reached a real event_id yet.
      // matrix-js-sdk fires Room.timeline for an event the instant it's sent
      // locally — before the homeserver confirms it — carrying a temporary
      // placeholder ID (~roomId:txnId) while status is "sending"/"queued"/
      // "encrypting"/"not_sent". If that placeholder ever gets ingested into
      // StreamManager, it can become nowPlaying.pi (StateDeriver just uses
      // whatever eventId is attached), and a skip/play sent while that
      // placeholder is "current" will carry it as p — a value that can never
      // match a real event_id on ANY client, including the one that sent it,
      // once the confirmed version with the real ID lands. This was the
      // actual cause of skips that work locally but never take effect
      // anywhere, confirmed by inspecting the raw room content directly: a
      // stuck skip's p field was a literal "~!room:matrix.org:txnId..." string.
      //
      // Per matrix-js-sdk: status is EventStatus.SENT ("sent") once the
      // server has accepted the event and assigned its real ID — at that
      // point getId() already returns the real $-prefixed ID, so "sent" is
      // safe to let through. status becomes null/undefined once the full
      // remote-echo sync round-trip completes, also safe. Only the earlier
      // pending statuses still carry the placeholder ID and must be blocked.
      const PENDING_STATUSES = { sending: 1, queued: 1, encrypting: 1, not_sent: 1, cancelled: 1 };
      if (event.status && PENDING_STATUSES[event.status]) return;
      // Belt and suspenders: a temporary ID is never our real event_id shape.
      const eid = event.getId ? event.getId() : null;
      if (typeof eid === "string" && eid.indexOf("~") === 0) return;

      const content = event.getContent();

      let parsedL = 0;
      if (event.getType() === "m.room.message" && content.body) {
        try {
          const parsed = JSON.parse(content.body);
          if (typeof parsed.l === "number") parsedL = parsed.l;
        } catch (e) {}
      }
      updateInbound(parsedL);

      const raw = {
        event_id: event.getId(),
        type: event.getType(),
        sender: event.getSender(),
        room_id: room.roomId,
        ts: event.getTs(),
        content: content,
        l: parsedL,
        senderRank: _channelRank(room),   // channel origin = rank proof
        unsigned: event.getUnsigned ? event.getUnsigned() : null,
      };
      EventCache.store(raw);
      StreamManager.ingest(raw);

      for (const fn of _rawListeners) {
        try { fn(raw, event, room); } catch (e) {}
      }
    }

    // Fire rank-change listeners on power-level moves; fire channel-added
    // listeners when a new child channel is ADDED to the space we're in (an
    // upgrade), so every present client can join it immediately.
    client.on("RoomState.events", (stateEvent) => {
      try {
        if (!stateEvent || !stateEvent.getType) return;
        const t = stateEvent.getType();
        if (t === "m.room.power_levels") {
          for (const fn of _rankListeners) { try { fn(); } catch (e) {} }
          return;
        }
        if (t === "m.room.join_rules") {
          // Space visibility changed (or a channel's join rule). Notify only for
          // the current space — that's the value the Room-settings UI reflects.
          const isSpace = stateEvent.getRoomId && stateEvent.getRoomId() === _currentSpaceId;
          if (isSpace) for (const fn of _visListeners) { try { fn(); } catch (e) {} }
          return;
        }
        if (t === "m.space.child") {
          // Only adds (content has `via`) to the current space. An empty content
          // is a child *removal* — ignore it.
          const inCurrentSpace = stateEvent.getRoomId && stateEvent.getRoomId() === _currentSpaceId;
          if (!inCurrentSpace) return;
          const childId = stateEvent.getStateKey ? stateEvent.getStateKey() : null;
          const content = stateEvent.getContent ? stateEvent.getContent() : {};
          if (childId && content && Array.isArray(content.via) && content.via.length > 0) {
            for (const fn of _channelAddedListeners) { try { fn(childId); } catch (e) {} }
          }
          return;
        }
        if (t === "m.room.member") {
          // A membership event carries the member's current avatar_url. When a
          // user changes their global avatar, the homeserver propagates it into
          // these events across shared rooms — this is the most reliable
          // cross-client signal that someone's picture changed. Re-fetch using
          // the FRESH mxc straight from the event content (not the stale global
          // User store, which updates on a different event and lags behind).
          const userId = stateEvent.getStateKey ? stateEvent.getStateKey() : null;
          const content = stateEvent.getContent ? stateEvent.getContent() : {};
          if (userId) _refetchAvatar(userId, content && content.avatar_url ? content.avatar_url : null);
          return;
        }
      } catch (e) {}
    });

    client.on("Room.timeline", (event, room) => {
      _routeEvent(event, room);
    });

    // CRITICAL companion to the local-echo guard in _routeEvent: that guard
    // correctly refuses to ingest an event while it's still pending (status
    // sending/queued/etc, temporary ~roomId:txnId ID) — see _routeEvent for
    // why. But matrix-js-sdk does NOT re-fire Room.timeline when a pending
    // event resolves to its final, confirmed state; it fires a SEPARATE event,
    // Room.localEchoUpdated, instead. Without listening for that too, an
    // event the local client itself sent would be filtered out once (while
    // pending) and then NEVER offered to _routeEvent again — meaning a
    // client's own sends would never update its own StreamManager at all.
    // This was a real regression: it surfaced as a single client repeatedly
    // re-attempting a genesis play forever, because their own successful
    // ddjp.dj.play never registered in their own local state, even though it
    // was genuinely present in the room (confirmed by inspecting raw room
    // content directly — the event existed and was correct).
    // By the time this fires, event.getId() already returns the real,
    // confirmed event ID and status is no longer a pending one, so it passes
    // _routeEvent's existing guard naturally — no special-casing needed here.
    client.on("Room.localEchoUpdated", (event, room) => {
      _routeEvent(event, room);
    });

    // E2E chat: SDK fires Event.decrypted once it has decrypted the content.
    // Re-route through the same path so rawListeners (chat.js) see the plain body.
    client.on("Event.decrypted", (event) => {
      const room = client.getRoom(event.getRoomId());
      _routeEvent(event, room);
    });

    // Initialise crypto (requires window.Olm to be loaded first via olm.js).
    // Must be called after createClient() and before startClient().
    try {
      await client.initCrypto();
      // Set at login/restore time: never block sends due to unverified devices.
      // Each device still has real keys and messages are still encrypted —
      // we're only skipping the manual fingerprint verification step.
      // Replaced with proper cross-signing verification in the final system.
      client.setGlobalErrorOnUnknownDevices(false);
      Logger.info("MatrixBridge: crypto initialised");
    } catch (e) {
      Logger.warn("MatrixBridge: crypto init failed — E2E chat will not work: " + e.message);
    }

    await client.startClient({ initialSyncLimit: 20 });
    _watchAvatarChanges();   // wire real-time avatar update listeners
    Logger.info("MatrixBridge: sync started");
  }

  // Wait for the initial sync to complete before reading room state.
  // Returns a Promise that resolves when state is "PREPARED" or "SYNCING"
  // (both mean the client has received its first sync response).
  function waitForSync() {
    return new Promise((resolve) => {
      if (!client) { resolve(); return; }
      // If already synced, resolve immediately
      const currentState = client.getSyncState ? client.getSyncState() : null;
      if (currentState === "PREPARED" || currentState === "SYNCING") {
        resolve();
        return;
      }
      function onSync(state) {
        if (state === "PREPARED" || state === "SYNCING") {
          client.removeListener("sync", onSync);
          resolve();
        }
      }
      client.on("sync", onSync);
    });
  }

  // Pub/sub for non-protocol events (chat, room state)
  const _rawListeners = [];
  function onRawEvent(fn) { if (fn && !_rawListeners.includes(fn)) _rawListeners.push(fn); }
  function offRawEvent(fn) { const i = _rawListeners.indexOf(fn); if (i >= 0) _rawListeners.splice(i, 1); }

  // Pub/sub for rank changes — fired when m.room.power_levels moves anywhere.
  const _rankListeners = [];
  function onRankChange(fn) { if (fn && !_rankListeners.includes(fn)) _rankListeners.push(fn); }
  function offRankChange(fn) { const i = _rankListeners.indexOf(fn); if (i >= 0) _rankListeners.splice(i, 1); }

  // Pub/sub for new channels — fired when a child is added to the current space
  // (a room upgrade). Lets clients join the new channel right away.
  const _channelAddedListeners = [];
  function onChannelAdded(fn) { if (fn && !_channelAddedListeners.includes(fn)) _channelAddedListeners.push(fn); }
  function offChannelAdded(fn) { const i = _channelAddedListeners.indexOf(fn); if (i >= 0) _channelAddedListeners.splice(i, 1); }

  // Pub/sub for space visibility — fired when the current space's join_rules move.
  const _visListeners = [];
  function onVisibilityChange(fn) { if (fn && !_visListeners.includes(fn)) _visListeners.push(fn); }
  function offVisibilityChange(fn) { const i = _visListeners.indexOf(fn); if (i >= 0) _visListeners.splice(i, 1); }

  // --- Rank detection by write permission ---
  // My rank = the highest events-[rank] channel I can actually write to
  // (my power level >= that channel's message send level). That same channel is
  // where I post protocol events. Only channels that EXIST are considered, so
  // this degrades gracefully before higher-rank channels are created.
  function getRankInfo(channels) {
    if (!client || !channels) return { rank: 0, channelId: null, key: null };
    const me = getUserId();
    let best = { rank: -1, channelId: null, key: null };
    for (const key in channels) {
      if (key.indexOf("events_") !== 0) continue;
      const room = client.getRoom(channels[key]);
      if (!room) continue;
      const rank = _rankFromKey(key);
      const myLevel = _userLevelInRoom(room, me);
      const sendLevel = _messageSendLevel(room);
      if (myLevel >= sendLevel && rank > best.rank) {
        best = { rank: rank, channelId: channels[key], key: key };
      }
    }
    if (best.rank < 0) return { rank: 0, channelId: channels.events_uncategorized || channels.events_player || null, key: null };
    return best;
  }
  function getMyRank(channels) { return getRankInfo(channels).rank; }
  function getWriteChannelId(channels) { return getRankInfo(channels).channelId; }

  // Roster of the space: joined members with display name and power level.
  function getRoster(spaceId) {
    const room = client ? client.getRoom(spaceId) : null;
    if (!room) return [];
    const out = [];
    const members = room.getJoinedMembers ? room.getJoinedMembers() : [];
    for (const m of members) {
      out.push({ userId: m.userId, name: m.name || m.userId, level: _userLevelInRoom(room, m.userId) });
    }
    out.sort((a, b) => b.level - a.level);
    return out;
  }

  // A user's true authority = the highest power level they hold across the space
  // and every channel. Used to gate rank changes so an inconsistency in one
  // channel can't be used to demote someone who is actually higher elsewhere.
  function getUserEffectiveRank(spaceId, channels, userId) {
    if (!client) return 0;
    let max = 0;
    const ids = [spaceId].concat(Object.values(channels || {})).filter(Boolean);
    for (const roomId of ids) {
      const room = client.getRoom(roomId);
      if (!room) continue;
      const lvl = _userLevelInRoom(room, userId);
      if (lvl > max) max = lvl;
    }
    return max;
  }

  // What membership a user at power `level` should have in a given channel:
  //   chat channels   -> member only if the channel's rank <= level (rank-gated)
  //   everything else -> member always (events/checkpoints/settings are read-by-all;
  //                      writing is gated by power level, not membership)
  // Pure, so it can be tested without a homeserver.
  function _desiredMembership(channelKey, level) {
    if (channelKey.indexOf("chat_") === 0) return _rankFromKey(channelKey) <= level;
    return true;
  }

  // --- Assign rank ---
  // The single source of per-user correctness. Sets the target's power level on
  // the space and every channel, then reconciles membership channel-by-channel to
  // exactly what the rank should have — inviting where they belong and missing,
  // kicking where they don't belong. Running it re-applies the full correct state,
  // so it doubles as a per-user repair: corruption (wrong power, missing or extra
  // channel membership) is overwritten with the right values everywhere.
  async function assignRank(spaceId, channels, userId, level) {
    const allRoomIds = [spaceId].concat(Object.values(channels));
    for (const roomId of allRoomIds) {
      try {
        const room = client.getRoom(roomId);
        if (!room) continue;
        const plEvent = room.currentState.getStateEvents("m.room.power_levels", "");
        const pl = plEvent ? Object.assign({}, plEvent.getContent()) : {};
        pl.users = Object.assign({}, pl.users);
        pl.users[userId] = level;
        await client.sendStateEvent(roomId, "m.room.power_levels", pl, "");
      } catch (e) {
        Logger.warn("MatrixBridge: assignRank power level failed for " + roomId + ": " + e.message);
      }
    }
    // Always a member of the space itself.
    try { await client.invite(spaceId, userId); } catch (e) { /* already in */ }
    // Per-channel membership reconciliation.
    for (const key in channels) {
      const roomId = channels[key];
      try {
        if (_desiredMembership(key, level)) await client.invite(roomId, userId);
        else await client.kick(roomId, userId, "rank below this channel");
      } catch (e) { /* already-in invite / not-in kick are expected no-ops */ }
    }
    Logger.info("MatrixBridge: assigned " + userId + " to level " + level + " (all channels reconciled)");
  }

  // --- Rate limiting & progress ---
  const CREATION_DELAY_MS = 20000; // 20s between channels
  const TOTAL_CHANNELS = 8;
  let _onProgress = null;

  function onProgress(fn) { _onProgress = fn; }

  function _reportProgress(completed, label) {
    if (_onProgress) _onProgress(completed, TOTAL_CHANNELS, label);
  }

  async function _delay() {
    await new Promise(resolve => setTimeout(resolve, CREATION_DELAY_MS));
  }

  // Progressive retry on 429 — waits on the server's retry-after, then a fixed window, then gives up
  async function _createWithRetry(createFn, label) {
    const waits = [30000, 60000];
    let attempt = 0;
    while (true) {
      try {
        return await createFn();
      } catch (e) {
        const isRateLimit =
          e.errcode === "M_LIMIT_EXCEEDED" ||
          e.httpStatus === 429 ||
          (e.message && e.message.includes("429")) ||
          (e.message && e.message.toLowerCase().includes("too many requests"));
        if (isRateLimit && attempt < waits.length) {
          const serverWait = e.retryAfterMs || (e.data && e.data.retry_after_ms);
          const waitMs = serverWait ? serverWait + 2000 : waits[attempt];
          const waitUntil = Date.now() + waitMs;
          Logger.warn("MatrixBridge: rate limited on " + label +
            " (attempt " + (attempt + 1) + ") — waiting " + Math.round(waitMs / 1000) + "s");
          // 4th arg = absolute timestamp the wait ends, so the UI can tick a
          // live countdown rather than freezing on a one-shot number.
          if (_onProgress) _onProgress(null, TOTAL_CHANNELS, "Rate limited — retrying in ", waitUntil);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          attempt++;
        } else {
          throw e;
        }
      }
    }
  }

  // Leave all created rooms on failure — leaves no orphaned channels
  async function _cleanupRooms(spaceId, channels) {
    Logger.warn("MatrixBridge: cleaning up partial room creation...");
    const allIds = [spaceId, ...Object.values(channels)].filter(Boolean);
    for (const roomId of allIds) {
      try {
        await client.leave(roomId);
        Logger.info("MatrixBridge: left " + roomId);
      } catch (e) {
        Logger.warn("MatrixBridge: cleanup failed for " + roomId + ": " + e.message);
      }
    }
  }

  // --- Power level helpers ---
  // --- Rank <-> channel mapping ---
  // Rank is proven by the channel an event lives in (channel origin). A channel
  // named "events-staff" or a map key "events_staff" denotes Staff rank.
  const RANK_LEVELS = {
    owner: 100, "high-staff": 80, highstaff: 80, staff: 60,
    vip: 40, player: 20, guest: 10, uncategorized: 0
  };

  // "events-high-staff" -> 80 ; "chat-player" -> 20 ; unknown -> 0
  function _rankFromName(name) {
    if (!name) return 0;
    const dash = name.indexOf("-");
    if (dash < 0) return 0;
    const slug = name.slice(dash + 1);
    return RANK_LEVELS[slug] !== undefined ? RANK_LEVELS[slug] : 0;
  }
  // "events_high_staff" -> 80 (map keys use underscores)
  function _rankFromKey(key) {
    const us = key.indexOf("_");
    if (us < 0) return 0;
    const slug = key.slice(us + 1).replace(/_/g, "-");
    return RANK_LEVELS[slug] !== undefined ? RANK_LEVELS[slug] : 0;
  }
  // The rank of the channel an event arrived on = the sender's proven rank.
  function _channelRank(room) {
    return room ? _rankFromName(room.name) : 0;
  }
  function _userLevelInRoom(room, userId) {
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      const c = pl ? pl.getContent() : {};
      const users = c.users || {};
      if (users[userId] !== undefined) return users[userId];
      return typeof c.users_default === "number" ? c.users_default : 0;
    } catch (e) { return 0; }
  }
  function _messageSendLevel(room) {
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      const c = pl ? pl.getContent() : {};
      if (c.events && typeof c.events["m.room.message"] === "number") return c.events["m.room.message"];
      return typeof c.events_default === "number" ? c.events_default : 0;
    } catch (e) { return 0; }
  }

  function _powerLevels(sendLevel, creatorId, isSpace) {
    const pl = {
      ban: 100,
      kick: 60,
      redact: 100,
      invite: 60,
      state_default: 100,
      users_default: 0,
      events_default: 0,
      events: {
        "m.room.message": sendLevel,
        "m.room.power_levels": 60
      }
    };
    // On the space, adding/removing sub-rooms is owner-only and explicit (so it
    // can't drift even if state_default is ever loosened).
    if (isSpace) {
      pl.events["m.space.child"] = 100;
      pl.events["m.space.parent"] = 100;
    }
    if (creatorId) pl.users = { [creatorId]: 100 };
    return pl;
  }

  // Unencrypted channel — events, checkpoints, settings. These are read-by-all:
  // when spaceId is given, the channel is created with a "restricted" join rule
  // gated on space membership, so ANY member of the space can join it themselves
  // with NO invite. That's what makes channels added later by an upgrade show up
  // in Element and be self-joinable for existing members (uncategorized included)
  // without the owner inviting anyone per-channel. Writing is still gated by power
  // level, not membership. (Chat is NOT created here — it stays invite-only,
  // because chat membership is the rank gate.)
  async function _createOpenChannel(name, sendLevel, creatorId, spaceId) {
    const initial_state = [
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" }},
      { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
      { type: "m.room.power_levels",       state_key: "", content: _powerLevels(sendLevel, creatorId) }
    ];
    const opts = { name, preset: "private_chat", initial_state };
    if (spaceId) {
      // Restricted join needs a room version that supports it (v8+). Pin to v10
      // (matrix.org's default) so the rule is honored regardless of the server's
      // own default. Self-hosted servers must support v10 (or lower this).
      opts.room_version = "10";
      initial_state.push({
        type: "m.room.join_rules", state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }
      });
    }
    const room = await client.createRoom(opts);
    return room.room_id;
  }

  // E2E encrypted channel — chat. Only the UNCATEGORIZED tier (level 0) is open:
  // it's the default everyone uses, so it's created restricted-join (any space
  // member joins with no invite), same as the read-by-all channels. The guest
  // and staff chat tiers stay invite-only because their membership IS the rank
  // gate (guest+ / staff+), applied via assignRank's invite/kick.
  async function _createChatChannel(name, sendLevel, creatorId, spaceId) {
    const initial_state = [
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" }},
      { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
      { type: "m.room.power_levels",       state_key: "", content: _powerLevels(sendLevel, creatorId) },
      { type: "m.room.encryption",         state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" }}
    ];
    const opts = { name, preset: "private_chat", initial_state };
    if (spaceId && sendLevel === 0) {
      opts.room_version = "10";   // restricted join needs v8+; pin to matrix.org's default
      initial_state.push({
        type: "m.room.join_rules", state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }
      });
    }
    const room = await client.createRoom(opts);
    return room.room_id;
  }

  // FLAGGED: via hardcoded to matrix.org — needs federation scope decision
  async function _addToSpace(spaceId, roomId) {
    await client.sendStateEvent(spaceId, "m.space.child", { via: ["matrix.org"] }, roomId);
  }

  // --- Room creation ---
  // Creates the first-build 7-channel DDJP room structure.
  // Progress reported via onProgress callback after each successful channel creation.
  // On failure: leaves all created rooms and throws so UI can show the error.
  async function createDDJPSpace(name) {
    let completed = 0;
    const creatorId = client.getUserId();
    const channels = {};
    let spaceId = null;

    try {
      // Space
      const space = await client.createRoom({
        name,
        preset: "private_chat",
        creation_content: { type: "m.space" },
        initial_state: [
          { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" }},
          { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
          { type: "m.room.power_levels",       state_key: "", content: _powerLevels(100, creatorId, true) }
        ]
      });
      spaceId = space.room_id;
      Logger.info("MatrixBridge: space created " + spaceId);

      // Events channels — uncategorized, guest, owner (Batch 1)
      const eventChannels = [
        { slug: "uncategorized", key: "events_uncategorized", level: 0   },
        { slug: "guest",         key: "events_guest",         level: 10  },
        { slug: "owner",         key: "events_owner",         level: 100 },
      ];
      for (const ch of eventChannels) {
        const label = "events-" + ch.slug;
        await _delay();
        const id = await _createWithRetry(() => _createOpenChannel(label, ch.level, creatorId, spaceId), label);
        await _addToSpace(spaceId, id);
        channels[ch.key] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      // Checkpoints channels — guest and owner (no uncategorized checkpoint)
      const checkpointChannels = [
        { slug: "guest", key: "checkpoints_guest", level: 10  },
        { slug: "owner", key: "checkpoints_owner", level: 100 },
      ];
      for (const ch of checkpointChannels) {
        const label = "checkpoints-" + ch.slug;
        await _delay();
        const id = await _createWithRetry(() => _createOpenChannel(label, ch.level, creatorId, spaceId), label);
        await _addToSpace(spaceId, id);
        channels[ch.key] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      // Chat channels — uncategorized and guest (both E2E encrypted)
      const chatChannels = [
        { slug: "uncategorized", key: "chat_uncategorized", level: 0  },
        { slug: "guest",         key: "chat_guest",         level: 10 },
      ];
      for (const ch of chatChannels) {
        const label = "chat-" + ch.slug;
        await _delay();
        const id = await _createWithRetry(() => _createChatChannel(label, ch.level, creatorId, spaceId), label);
        await _addToSpace(spaceId, id);
        channels[ch.key] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      // Settings channel — owner only
      {
        const label = "settings-owner";
        await _delay();
        const id = await _createWithRetry(() => _createOpenChannel(label, 100, creatorId, spaceId), label);
        await _addToSpace(spaceId, id);
        channels["settings_owner"] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      Logger.info("MatrixBridge: room creation complete — " + TOTAL_CHANNELS + " channels");
      return { spaceId, channels };

    } catch (e) {
      Logger.error("MatrixBridge: room creation failed — " + e.message);
      await _cleanupRooms(spaceId, channels);
      throw new Error("Room creation failed and was cancelled. " + e.message);
    }
  }

  // --- Incremental upgrade batches ---
  // Batch 1 (Owner/Player/Uncategorized) is created at room creation. Higher
  // ranks arrive later, one batch at a time, 2h apart (see RoomUpgrade).
  const UPGRADE_BATCHES = {
    2: [
      { kind: "events",      slug: "player", level: 20 },
      { kind: "checkpoints", slug: "player", level: 20 },
      { kind: "events",      slug: "vip",    level: 40 },
      { kind: "checkpoints", slug: "vip",    level: 40 },
    ],
    3: [
      { kind: "events",      slug: "staff",      level: 60 },
      { kind: "checkpoints", slug: "staff",      level: 60 },
      { kind: "events",      slug: "high-staff", level: 80 },
      { kind: "checkpoints", slug: "high-staff", level: 80 },
      { kind: "chat",        slug: "staff",      level: 60 },
    ],
  };

  // Create the channels for one batch. Resumable: channels that already exist
  // are skipped (and counted as done for progress), so a retry after a partial
  // failure completes the rest. Uses the same per-channel delay + retry + progress
  // as room creation. Returns only the newly created { key: roomId } entries.
  // Read the space's ACTUAL current child channels straight from Matrix state,
  // keyed by name ("events-player" -> "events_player") the same way Room.join
  // builds its map. This is ground truth: it reflects exactly what exists in
  // the space right now, including channels created by a previous upgrade
  // attempt that failed before its results were merged into the in-memory map.
  // Using this as the dedup baseline is what makes upgrade resumable and
  // duplicate-proof, the same way room creation is reliable.
  function _liveChannelMap(spaceId) {
    const out = {};
    const space = client ? client.getRoom(spaceId) : null;
    if (!space) return out;
    const children = space.currentState.getStateEvents("m.space.child");
    for (const child of children) {
      const roomId = child.getStateKey();
      const room = client.getRoom(roomId);
      if (!room || !room.name) continue;
      // Skip tombstoned/left child rooms — only count ones we're actually in.
      const key = room.name.replace(/-/g, "_");
      // If two children somehow share a name (the very bug we're fixing),
      // keep the first and ignore the rest so we don't re-create either.
      if (!out[key]) out[key] = roomId;
    }
    return out;
  }

  // Ground-truth "how upgraded is this room": the highest batch whose channels
  // ALL physically exist in the given channel map. This is independent of the
  // upgrade done-markers — so a room whose channels were fully created but whose
  // done-marker never landed (or, pre-pagination, didn't replay) still reads as
  // upgraded and never offers a redundant batch. A partially-created batch does
  // NOT count (so it stays resumable). Batch 1 is the creation baseline.
  function highestPresentBatch(channels) {
    if (!channels) return 1;
    let highest = 1;
    for (const n of [2, 3]) {
      const items = UPGRADE_BATCHES[n];
      if (!items) continue;
      const allPresent = items.every(it => !!channels[it.kind + "_" + it.slug.replace(/-/g, "_")]);
      if (allPresent) highest = n; else break;   // batches are ordered; stop at the first gap
    }
    return highest;
  }

  async function createUpgradeBatch(spaceId, channels, batchN) {
    const items = UPGRADE_BATCHES[batchN];
    if (!items) return {};
    const creatorId = client.getUserId();
    const added = {};
    const total = items.length;
    let completed = 0;
    // Dedup against BOTH the caller's in-memory map AND the space's real,
    // current children. The live map catches channels a prior failed attempt
    // already created but never got merged back — without it, a retry would
    // recreate them, producing duplicate channels of the same name.
    const live = _liveChannelMap(spaceId);
    try {
      for (const it of items) {
        const key = it.kind + "_" + it.slug.replace(/-/g, "_");
        const label = it.kind + "-" + it.slug;
        const existingId = channels[key] || added[key] || live[key];
        if (existingId) {                         // already exists anywhere — resumable skip
          added[key] = existingId;                // make sure the caller learns about it too
          completed++;
          if (_onProgress) _onProgress(completed, total, label + " (exists)");
          Logger.info("MatrixBridge: upgrade skip " + label + " — already exists (" + completed + "/" + total + ")");
          continue;
        }
        await _delay();
        const create = it.kind === "chat"
          ? () => _createChatChannel(label, it.level, creatorId, spaceId)
          : () => _createOpenChannel(label, it.level, creatorId, spaceId);
        const id = await _createWithRetry(create, label);
        await _addToSpace(spaceId, id);
        added[key] = id;
        completed++;
        if (_onProgress) _onProgress(completed, total, label);
        Logger.info("MatrixBridge: upgrade created " + label + " (" + completed + "/" + total + ")");
      }
    } catch (e) {
      // Hard failure mid-batch (e.g. rate limit exhausted). Attach whatever we
      // DID create so the caller can persist it — otherwise those channels
      // would be orphaned from the in-memory map and a retry would recreate
      // them (the duplicate-channel bug). Live-dedup also catches them, but
      // persisting keeps the map honest immediately.
      e.partial = added;
      throw e;
    }
    return added;
  }

  // --- Join ---
  async function joinDDJPSpace(spaceId) {
    await client.joinRoom(spaceId);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const space = client.getRoom(spaceId);
    if (space) {
      const children = space.currentState.getStateEvents("m.space.child");
      for (const child of children) {
        try { await client.joinRoom(child.getStateKey()); } catch (e) {}
      }
    }
    Logger.info("MatrixBridge: joined " + spaceId);
    return spaceId;
  }

  // --- Invite ---
  // New members default to Uncategorized (level 0) until promoted. Events,
  // checkpoints, and settings channels are readable by everyone; chat channels
  // are joined by rank, so a fresh member only lands in chat-uncategorized.
  async function inviteToSpace(spaceId, channels, userId) {
    await client.invite(spaceId, userId);
    const level = 0;
    for (const key in channels) {
      const roomId = channels[key];
      if (!roomId) continue;
      const isChat = key.indexOf("chat_") === 0;
      if (isChat && _rankFromKey(key) > level) continue;   // chat above rank — skip
      try { await client.invite(roomId, userId); }
      catch (e) { Logger.warn("MatrixBridge: invite failed for " + roomId + ": " + e.message); }
    }
    Logger.info("MatrixBridge: invited " + userId);
  }

  // --- Promote / Demote ---
  // NOTE: superseded by assignRank below, which is what room.js actually calls
  // (it does full membership reconciliation, not just power levels + chat).

  // --- Send ---
  async function sendMessage(roomId, text) {
    await client.sendMessage(roomId, { msgtype: "m.text", body: text });
  }

  async function sendEvent(roomId, type, content) {
    const stamped = Object.assign({}, content, { t: type, l: tickOutbound(), dv: 1 });
    await client.sendMessage(roomId, {
      msgtype: "m.text",
      body: JSON.stringify(stamped)
    });
  }

  // --- Replay existing timeline into StreamManager ---
  async function replayRoom(roomId) {
    const room = client.getRoom(roomId);
    if (!room) return;
    Logger.info("MatrixBridge: replaying " + roomId);
    // Load the COMPLETE history first. startClient's initialSyncLimit only brings
    // the last N events per room into room.timeline; without paging back to the
    // start, a reload replays a TRUNCATED Spine — the advance-lock chain can't
    // anchor from its p=null genesis, so already-played songs never get shifted
    // out of their buffers and resurface ("past timeline" on reload). Page
    // backwards until the timeline stops growing (no older history) or a hard
    // guard trips, so derive always sees the whole ordered log.
    try {
      let prevLen = -1, guard = 0;
      while (room.timeline.length !== prevLen && guard < 200) {
        prevLen = room.timeline.length;
        await client.scrollback(room, 100);
        guard++;
      }
    } catch (e) {
      Logger.warn("MatrixBridge: scrollback failed for " + roomId + ": " + (e && e.message));
    }
    const channelRank = _channelRank(room);
    room.timeline.forEach(event => {
      const content = event.getContent();
      let parsedL = 0;
      if (event.getType() === "m.room.message" && content.body) {
        try {
          const parsed = JSON.parse(content.body);
          if (typeof parsed.l === "number") parsedL = parsed.l;
        } catch (e) {}
      }
      updateInbound(parsedL);   // replayed history must advance our clock too
      const raw = {
        event_id: event.getId(),
        type: event.getType(),
        sender: event.getSender(),
        room_id: room.roomId,
        ts: event.getTs(),
        content,
        l: parsedL,
        senderRank: channelRank,
        unsigned: event.getUnsigned ? event.getUnsigned() : null,
      };
      EventCache.store(raw);
      StreamManager.ingest(raw);
    });
  }

  function getClient() { return client; }
  function getUserId() { return client ? client.getUserId() : null; }
  function getClock() { return _activeClockRoom ? (_clocks[_activeClockRoom] || 0) : 0; }

  // Set the space's visibility. public = anyone can join the space; private =
  // invite-only. Owner-only — m.room.join_rules is state_default 100, so a
  // non-owner's call is refused by the homeserver (correct). This is the side
  // effect of the ddjp.room.settings `vis` value; the setting itself is the
  // shared truth everyone derives, this is what actually opens/closes the door.
  async function setSpaceJoinRule(spaceId, isPublic) {
    if (!client || !spaceId) return;
    const content = isPublic ? { join_rule: "public" } : { join_rule: "invite" };
    await client.sendStateEvent(spaceId, "m.room.join_rules", content, "");
  }

  // Read the space's current visibility straight from Matrix state — the single
  // source of truth (no DDJP settings event mirrors it). "public" iff the space
  // join rule is public; anything else (invite/restricted/knock/none) = private.
  function getSpaceVisibility(spaceId) {
    const room = client ? client.getRoom(spaceId) : null;
    if (!room) return "private";
    const jr = room.currentState.getStateEvents("m.room.join_rules", "");
    const rule = jr ? jr.getContent().join_rule : null;
    return rule === "public" ? "public" : "private";
  }

  // Join a single channel (used by the auto-join path when a new channel appears
  // in the space). events/checkpoints/settings are restricted-join, so a space
  // member joins with NO invite; chat is invite-only and will simply fail here
  // for anyone not ranked for it (expected — chat membership is the rank gate).
  // Returns true if we're in the room afterward. The caller replays it (room.js
  // routes new events channels through mergeChannels). Waits briefly so the
  // timeline has a chance to sync before the caller reads it.
  async function joinChannel(roomId) {
    if (!client || !roomId) return false;
    try {
      await client.joinRoom(roomId);
    } catch (e) {
      Logger.debug("MatrixBridge: did not join " + roomId + " (expected for rank-gated chat): " + e.message);
      return false;
    }
    await new Promise(r => setTimeout(r, 1000));
    return true;
  }


  // --- Avatar cache ---
  // Fetches each user's avatar exactly once, converts mxc:// to an HTTPS
  // thumbnail URL, and caches the result (null = no avatar / failed). Fires
  // _avatarListeners when a profile updates so the UI can re-render.
  // Thumbnail size 96px — small enough to be cheap, big enough for 2x screens.
  const AVATAR_SIZE = 96;
  const _avatarCache = {};   // userId -> blob/HTTP URL string | null
  const _avatarMxc = {};     // userId -> last mxc loaded (dedups repeat change events)
  const _avatarListeners = [];
  function onAvatarChange(fn)  { if (fn && !_avatarListeners.includes(fn)) _avatarListeners.push(fn); }
  function offAvatarChange(fn) { const i = _avatarListeners.indexOf(fn); if (i >= 0) _avatarListeners.splice(i, 1); }
  function _fireAvatarChange(userId) {
    for (const fn of _avatarListeners) { try { fn(userId); } catch (e) {} }
  }

  // Parse "mxc://server/mediaId" -> { server, mediaId } or null.
  function _parseMxc(mxc) {
    if (typeof mxc !== "string" || mxc.indexOf("mxc://") !== 0) return null;
    const rest = mxc.slice("mxc://".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    return { server: rest.slice(0, slash), mediaId: rest.slice(slash + 1) };
  }

  // Returns the cached avatar URL (a blob: object URL) for userId, or null.
  // On a cache miss it kicks off an async authenticated fetch and fires
  // _fireAvatarChange when the blob URL is ready — so the UI updates then.
  // Subsequent calls return the cached value synchronously.
  function getAvatarUrl(userId) {
    if (!userId || !client) return null;
    if (userId in _avatarCache) return _avatarCache[userId];
    _avatarCache[userId] = null;   // mark in-flight so we don't double-fetch
    _loadAvatar(userId);
    return null;
  }

  // Async loader. Resolves the user's mxc (local store or profile fetch),
  // then downloads the thumbnail WITH the access token and caches a blob URL.
  // Plain <img src> can't send an auth header, and matrix.org now requires
  // authenticated media — so we fetch the bytes ourselves and hand the UI a
  // local blob: URL it can render. Falls back to the legacy unauthenticated
  // endpoint for older homeservers that don't enforce auth.
  async function _loadAvatar(userId, mxcHint) {
    // 1. Resolve the mxc://. If a fresh hint is supplied (from a change event),
    //    use it directly — it's authoritative and avoids the stale global store.
    //    Otherwise try the in-memory store, else fetch the profile from server.
    let mxc = mxcHint || null;
    if (!mxc) {
      const user = client.getUser ? client.getUser(userId) : null;
      if (user && user.avatarUrl) mxc = user.avatarUrl;
    }
    if (!mxc) {
      try {
        const profile = await client.getProfileInfo(userId);
        mxc = profile && profile.avatar_url;
      } catch (e) {
        Logger.debug("Avatar: getProfileInfo failed for " + userId + ": " + e.message);
      }
    }
    if (!mxc) {
      // No avatar (never had one, or it was just removed). Clear to null and
      // notify so the UI can fall back to initials if it was showing a picture.
      if (_avatarCache[userId]) _setAvatar(userId, null);
      else _avatarCache[userId] = null;
      return;
    }

    const parts = _parseMxc(mxc);
    const base = client.baseUrl || (client.getHomeserverUrl ? client.getHomeserverUrl() : null);
    const token = client.getAccessToken ? client.getAccessToken() : null;

    // 2. Preferred path: authenticated media endpoint (Matrix 1.11+, MSC3916),
    //    fetched with the bearer token and turned into a local blob: URL.
    if (parts && base && token) {
      const authUrl = base.replace(/\/$/, "") +
        "/_matrix/client/v1/media/thumbnail/" + encodeURIComponent(parts.server) +
        "/" + encodeURIComponent(parts.mediaId) +
        "?width=" + AVATAR_SIZE + "&height=" + AVATAR_SIZE + "&method=crop";
      try {
        const res = await fetch(authUrl, { headers: { Authorization: "Bearer " + token } });
        if (res.ok) {
          const blob = await res.blob();
          _setAvatar(userId, URL.createObjectURL(blob));
          return;
        }
        Logger.debug("Avatar: authed media " + res.status + " for " + userId);
      } catch (e) {
        Logger.debug("Avatar: authed media fetch failed for " + userId + ": " + e.message);
      }
    }

    // 3. Fallback: legacy unauthenticated URL (older homeservers). If this also
    //    fails to load, the UI's onerror handler shows initials.
    try {
      const legacy = client.mxcUrlToHttp(mxc, AVATAR_SIZE, AVATAR_SIZE, "crop");
      if (legacy) { _setAvatar(userId, legacy); return; }
    } catch (e) {
      Logger.debug("Avatar: legacy mxcUrlToHttp failed for " + userId + ": " + e.message);
    }
  }

  // Cache a resolved avatar URL and notify listeners. Revokes a prior blob URL
  // for this user so we don't leak object URLs across profile changes.
  function _setAvatar(userId, url) {
    const prev = _avatarCache[userId];
    if (prev && typeof prev === "string" && prev.indexOf("blob:") === 0 && prev !== url) {
      try { URL.revokeObjectURL(prev); } catch (e) {}
    }
    _avatarCache[userId] = url;
    _fireAvatarChange(userId);
  }

  // Re-fetch a user's avatar in response to a live change event, using the FRESH
  // mxc the event carried (authoritative). De-dups: if the new mxc resolves to a
  // value we already have, _loadAvatar still produces a new blob and _setAvatar
  // fires once — cheap for a one-off profile change. Pass mxc=null when unknown
  // and it falls back to a server profile fetch.
  function _refetchAvatar(userId, mxc) {
    if (!userId) return;
    // Track the last mxc we loaded per user so a burst of identical membership
    // events (common on sync) doesn't re-download the same picture repeatedly.
    if (mxc && _avatarMxc[userId] === mxc) return;   // already loaded this exact avatar
    _avatarMxc[userId] = mxc || null;
    delete _avatarCache[userId];
    _loadAvatar(userId, mxc || null);
  }

  // Upload a new profile picture for the current user from a File/Blob.
  // Validates type + size, uploads to the (authenticated) media repo via the
  // SDK, sets it as the account's global avatar, then busts our own cache so
  // the new picture shows immediately. Returns { ok: true } or
  // { ok: false, reason } — never throws, so the UI can show a clean message.
  // Note: this sets the GLOBAL Matrix avatar (every room/client), matching how
  // standard clients behave — it is not scoped to this DDJP room.
  const AVATAR_MAX_BYTES = 8 * 1024 * 1024;   // 8MB — generous for a profile pic
  async function uploadAvatar(file) {
    if (!client) return { ok: false, reason: "not connected" };
    if (!file) return { ok: false, reason: "no file selected" };
    if (!file.type || file.type.indexOf("image/") !== 0) {
      return { ok: false, reason: "please choose an image file" };
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return { ok: false, reason: "image is too large (max " + (AVATAR_MAX_BYTES / 1024 / 1024) + "MB)" };
    }
    // 1. Upload the bytes — SDK handles the auth + endpoint. Returns an mxc URL.
    let mxc = null;
    try {
      const res = await client.uploadContent(file, { type: file.type, name: file.name || "avatar" }); // no-media-ok: account avatar — account-level exception, never touches the Spine (06_fundamentals.md)
      // uploadContent returns either { content_uri } or the uri string depending on SDK version.
      mxc = (res && res.content_uri) ? res.content_uri : (typeof res === "string" ? res : null);
    } catch (e) {
      const rl = e && (e.errcode === "M_LIMIT_EXCEEDED" || e.httpStatus === 429);
      if (rl) return { ok: false, reason: "rate limited — wait a moment and try again" };
      const tooBig = e && (e.errcode === "M_TOO_LARGE" || e.httpStatus === 413);
      if (tooBig) return { ok: false, reason: "the server rejected the image as too large" };
      Logger.warn("MatrixBridge: avatar upload failed: " + (e && e.message));
      return { ok: false, reason: "upload failed — check your connection and try again" };
    }
    if (!mxc) return { ok: false, reason: "upload did not return a media URL" };
    // 2. Set it as the account avatar.
    try {
      await client.setAvatarUrl(mxc);
    } catch (e) {
      Logger.warn("MatrixBridge: setAvatarUrl failed: " + (e && e.message));
      return { ok: false, reason: "the picture uploaded but updating your profile failed" };
    }
    // 3. Bust our own cache and re-fetch so the new picture appears at once.
    const me = getUserId();
    if (me) { _refetchAvatar(me, mxc); }
    Logger.info("MatrixBridge: avatar updated");
    return { ok: true };
  }

  // Bust the cache and re-notify when a user's profile picture changes live.
  // Called inside start() after the client is ready.
  function _watchAvatarChanges() {
    if (!client) return;
    client.on("RoomMember.membership", (event, member) => {
      // New member joined — pre-warm their avatar (mxc from the membership).
      if (member && member.membership === "join") {
        const mxc = member.getMxcAvatarUrl ? member.getMxcAvatarUrl() : null;
        _refetchAvatar(member.userId, mxc);
      }
    });
    client.on("User.avatarUrl", (event, user) => {
      // Global profile avatar changed — the user object's avatarUrl is fresh.
      if (user && user.userId) _refetchAvatar(user.userId, user.avatarUrl || null);
    });
    client.on("RoomMember.avatarUrl", (event, member) => {
      // Room-member avatar changed — read the fresh mxc straight off the member.
      if (member && member.userId) {
        const mxc = member.getMxcAvatarUrl ? member.getMxcAvatarUrl() : null;
        _refetchAvatar(member.userId, mxc);
      }
    });
  }

  return {
    login, logout, hasSession, restoreSession,
    start, waitForSync, onRawEvent, offRawEvent, onProgress,
    createDDJPSpace, joinDDJPSpace, inviteToSpace, assignRank, createUpgradeBatch, highestPresentBatch,
    sendMessage, sendEvent, replayRoom,
    getRankInfo, getMyRank, getWriteChannelId, getRoster, getUserEffectiveRank, desiredMembership: _desiredMembership,
    onRankChange, offRankChange, onChannelAdded, offChannelAdded, joinChannel, setSpaceJoinRule,
    getSpaceVisibility, onVisibilityChange, offVisibilityChange,
    getClient, getUserId, getClock, seedClock,
    getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar
  };
})();
