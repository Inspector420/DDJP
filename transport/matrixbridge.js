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
  // --- Encryption setup state (Topic 2) ---
  let _ssKey = null;          // decoded secret-storage private key currently in use
  let _loginPassword = null;  // held briefly to satisfy UIA on cross-signing key upload
  let _pendingNewKey = null;  // a generated recovery key awaiting save-confirmation

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

  function _saveSession(homeserver, userId, accessToken, deviceId, refreshToken, expiry) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ homeserver, userId, accessToken, deviceId, refreshToken, expiry }));
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

  // Called by the SDK when the access token has expired (reactive refresh). Exchanges
  // the refresh token for a fresh access+refresh pair — Synapse/MAS rotate and
  // invalidate the old refresh token — persists them, and returns them so the
  // in-flight request retries. A stolen access token is then only valid until it
  // expires (≈5 min on Synapse/MAS). Result shape required by the SDK:
  // { accessToken, refreshToken, expiry }. Only invoked when a refresh token exists,
  // so homeservers without refresh-token support fall back to the long-lived token.
  async function _tokenRefreshFunction(refreshToken) {
    const r = await client.refreshToken(refreshToken);
    const expiry = r.expires_in_ms ? Date.now() + r.expires_in_ms : undefined;
    const s = _loadSession();
    if (s) _saveSession(s.homeserver, s.userId, r.access_token, s.deviceId, r.refresh_token || refreshToken, expiry);
    Logger.info("MatrixBridge: access token refreshed");
    return { accessToken: r.access_token, refreshToken: r.refresh_token || refreshToken, expiry };
  }

  // Refresh the access token *proactively* when we hold a refresh token and the
  // stored access token is at/near expiry. Needed because crypto init (initRustCrypto)
  // makes authenticated requests BEFORE startClient()'s reactive refresh loop is
  // active: if the token expired while the tab was closed, crypto init would 401 and
  // throw, leaving the client with no encryption. Non-fatal: on failure we fall back
  // to the stored token. `force` skips the expiry check (used for the init retry).
  async function _ensureFreshToken(force) {
    const s = _loadSession();
    if (!s || !s.refreshToken) return;
    if (!force && s.expiry && Date.now() < s.expiry - 60000) return;   // still comfortably valid
    try {
      const r = await client.refreshToken(s.refreshToken);
      if (r && r.access_token) {
        client.setAccessToken(r.access_token);
        if (client.http && client.http.opts) client.http.opts.refreshToken = r.refresh_token || s.refreshToken;
        const expiry = r.expires_in_ms ? Date.now() + r.expires_in_ms : undefined;
        _saveSession(s.homeserver, s.userId, r.access_token, s.deviceId, r.refresh_token || s.refreshToken, expiry);
        Logger.info("MatrixBridge: token refreshed before crypto init");
      }
    } catch (e) {
      Logger.warn("MatrixBridge: pre-crypto token refresh failed — " + e.message);
    }
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
        refreshToken: session.refreshToken,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: session.userId,
        deviceId: session.deviceId,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
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
      const response = await temp.login("m.login.password", { user: username, password, refresh_token: true });
      temp.stopClient();
      _loginPassword = password;   // held to satisfy UIA on cross-signing key upload; cleared on logout
      client = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: response.user_id,
        deviceId: response.device_id,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
      _saveSession(homeserver, response.user_id, response.access_token, response.device_id,
                   response.refresh_token, response.expires_in_ms ? Date.now() + response.expires_in_ms : undefined);
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
    _ssKey = null;
    _loginPassword = null;
    _pendingNewKey = null;
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

      // Spine channels are immutable: refuse redactions/edits, ingesting the
      // verified original instead (see _ingestSpineEvent). Raw listeners are chat,
      // which filters to its own (non-Spine) channel, so Spine events never need
      // the fan-out below.
      if (_isSpineChannel(room)) {
        _ingestSpineEvent(event, room);
        return;
      }

      // Non-Spine (chat): unchanged — edits/redactions are honored for display.
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
      // Chat channels are the ephemeral Skin: do NOT cache or ingest them — that
      // would persist decrypted plaintext at rest and pollute/evict the bounded
      // voucher store. Chat lives only in RAM, rendered by the raw listeners and
      // reloaded from Matrix as needed. (No non-chat, non-Spine ddjp events exist
      // today; if display-level events are added, they'd ingest here as needed.)
      if (!_isChatChannel(room)) {
        EventCache.store(raw);
        StreamManager.ingest(raw);
      }

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

    // Initialise end-to-end encryption (Rust crypto / vodozemac, via the
    // vendored bundle — see tools/VENDOR_PROVENANCE.md). loadCrypto() instantiates
    // the WASM and must resolve before initRustCrypto(); the SDK's own internal
    // initAsync() then reuses that single load. Called after createClient() and
    // before startClient().
    //
    // No legacy cryptoStore/pickleKey is passed to createClient, so this is a
    // clean re-key, not a libolm->rust migration: existing devices get fresh
    // Rust-crypto keys. Intentional trade-off — messages encrypted under the old
    // libolm sessions may no longer decrypt. See the project SECURITY policy doc (Topic 1).
    // Ensure a live access token before crypto init (see _ensureFreshToken): crypto's
    // first server calls run before startClient()'s refresh loop, so an expired token
    // here would make initRustCrypto() fail with "client does not support encryption".
    await _ensureFreshToken();
    try {
      await matrixcs.loadCrypto();
      await client.initRustCrypto();
      // Default Rust-crypto policy: messages are encrypted to every device in the
      // room, including unverified ones, so a send is never blocked on an unverified
      // device (the old setGlobalErrorOnUnknownDevices(false) no longer exists).
      // Cross-signing + recovery-key verification is handled by the Topic 2 flow.
      Logger.info("MatrixBridge: crypto initialised (rust)");
    } catch (e) {
      // The token may have lapsed mid-init; force a refresh and retry once.
      Logger.warn("MatrixBridge: crypto init failed once, retrying after token refresh");
      try {
        await _ensureFreshToken(true);
        await client.initRustCrypto();
        Logger.info("MatrixBridge: crypto initialised (rust) after refresh");
      } catch (e2) {
        Logger.warn("MatrixBridge: crypto init failed — E2E chat will not work: " + e2.message);
      }
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

  // Pub/sub for the room LIST — fired when a room/space appears or our membership
  // in one changes (the things that move a space between owned/joined/invited).
  // Owns the SDK listeners so features never attach `.on()` to a handed-out
  // client (the transport boundary, enforced by check-boundaries). Mirror of
  // onRankChange. Subscribers get no payload; they re-scan via Room.scanDDJPRooms.
  const _roomsListeners = [];
  let _roomsWired = false;
  function _wireRoomsListeners() {
    if (_roomsWired || !client) return;
    const fire = () => { for (const fn of _roomsListeners) { try { fn(); } catch (e) {} } };
    client.on("Room", fire);
    client.on("Room.myMembership", fire);
    _roomsWired = true;
  }
  function onRoomsChanged(fn) {
    if (fn && !_roomsListeners.includes(fn)) _roomsListeners.push(fn);
    _wireRoomsListeners();
  }
  function offRoomsChanged(fn) { const i = _roomsListeners.indexOf(fn); if (i >= 0) _roomsListeners.splice(i, 1); }

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

  // Batch-1 (creation) channel spec — the single source of truth for what a
  // fresh room is made of, in creation order. Factored out of createDDJPSpace so
  // the order can be reasoned about purely (see creationPlan). kind selects the
  // creator: "chat" -> _createChatChannel (E2E), everything else (events /
  // checkpoints / settings) -> _createOpenChannel. Order MUST match the legacy
  // inline sequence so live creation behaviour (delays, progress labels) is
  // unchanged: events u/g/o, checkpoints g/o, chat u/g, settings-owner.
  const CREATION_CHANNELS = [
    { kind: "events",      slug: "uncategorized", key: "events_uncategorized", level: 0   },
    { kind: "events",      slug: "guest",         key: "events_guest",         level: 10  },
    { kind: "events",      slug: "owner",         key: "events_owner",         level: 100 },
    { kind: "checkpoints", slug: "guest",         key: "checkpoints_guest",    level: 10  },
    { kind: "checkpoints", slug: "owner",         key: "checkpoints_owner",    level: 100 },
    { kind: "chat",        slug: "uncategorized", key: "chat_uncategorized",   level: 0   },
    { kind: "chat",        slug: "guest",         key: "chat_guest",           level: 10  },
    { kind: "settings",    slug: "owner",         key: "settings_owner",       level: 100 },
  ];
  const TOTAL_CHANNELS = CREATION_CHANNELS.length;   // 8 — derived, never drifts from the spec

  // Pure: given the channels that already exist (map key -> roomId), return the
  // spec items still to create (in spec order), how many already exist, and
  // whether creation is complete. No SDK, no side effects, total on bad input —
  // the same role highestPresentBatch plays for upgrades. This is the dedup
  // brain that makes creation resumable: a retry builds only plan.todo.
  function creationPlan(existingChannels) {
    const have = (existingChannels && typeof existingChannels === "object") ? existingChannels : {};
    const todo = CREATION_CHANNELS.filter(it => !have[it.key]);
    const done = TOTAL_CHANNELS - todo.length;
    return { todo, total: TOTAL_CHANNELS, done, complete: todo.length === 0 };
  }

  let _creating = false;   // re-entrancy guard: one creation at a time (mirror of RoomUpgrade._running)
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

  // --- Spine immutability (redaction / edit refusal) ---
  // The Spine — events / checkpoints / settings channels — is append-only and
  // immutable at the protocol level (CLAUDE.md: never honor a redaction OR edit
  // there). Chat is the ephemeral Skin and is left alone. A Spine channel is one
  // whose name is events-* / checkpoints-* / settings-*.
  function _isSpineChannel(room) {
    const n = room && room.name ? room.name : "";
    return n.indexOf("events-") === 0 || n.indexOf("checkpoints-") === 0 || n.indexOf("settings-") === 0;
  }

  // Chat channels (chat-*) carry the ephemeral Skin. Chat is RAM-only, sourced
  // from Matrix — it is NEVER written to our caches: not the StreamManager log
  // (chat isn't a protocol event; the reducer ignores it anyway) and especially
  // not EventCache, which is the bounded voucher store — caching chat there both
  // persists decrypted plaintext at rest AND can evict real Spine originals,
  // weakening redaction-refusal. So the router skips both for chat and only fans
  // it out to the raw listeners (chat renders in RAM). Pure, testable.
  function _isChatChannel(room) {
    const n = room && room.name ? room.name : "";
    return n.indexOf("chat-") === 0;
  }

  // Pure decision for a Spine event's content source — testable headlessly:
  //   not redacted        -> "ingest"  (use the ORIGINAL content; defends edits)
  //   redacted + have orig -> "restore" (re-ingest the verified original; refuse the redaction)
  //   redacted, no orig    -> "gap"     (flag an unrecoverable hole; never silently drop)
  function spineRestoreDecision(isRedacted, hasVerifiedOriginal) {
    if (!isRedacted) return "ingest";
    return hasVerifiedOriginal ? "restore" : "gap";
  }

  // Resolve a VERIFIED original raw for an event id, or null.
  //
  // VOUCHER SEAM. Today the only source is our own EventCache — a copy taken
  // when we first saw the event, before any redaction/edit. It is trusted because
  // it was stored under the event's real (server-validated) id, so the content
  // already matches the content-addressed id by construction. The future voucher
  // layer (90_design_archive "Vouchers") plugs in HERE: additional sources are a
  // received `ddjp.voucher` carrying re-supplied original content, verified by
  // recomputing the Matrix reference hash and checking it equals the event id
  // (self-verifying — anyone may vouch, false content fails the hash). Many
  // vouchers for one id collapse to a single per-event record (see _integrity);
  // the selection policy (highest rank, then most recent) is specified in the
  // archive. The downstream is identical to today: a verified original is ingested
  // at its own (l, event_id) position, so it is counted as true in the timeline.
  function _verifiedOriginalFor(eventId) {
    const c = EventCache.get(eventId);
    if (c && c.event_id === eventId && c.content && typeof c.content.body === "string") return c;
    return null;
    // Voucher extension: if (!c) consult the voucher store; for each candidate
    // verify _referenceHashMatches(eventId, candidate.content) before accepting.
  }

  // Per-event integrity flags — a side record (NOT consensus state; the reducer
  // stays pure). Keyed by event id so multiple sources/vouchers can be aggregated
  // into ONE object per event later. Today each entry records a single detection.
  const _integrity = {};   // eventId -> { eventId, l, sender, channel, status, at }
  const _integrityListeners = [];
  function _flagIntegrity(rec) {
    _integrity[rec.eventId] = Object.assign(_integrity[rec.eventId] || {}, rec);
    for (const fn of _integrityListeners) { try { fn(_integrity[rec.eventId]); } catch (e) {} }
  }
  function getIntegrityFlags() { return Object.keys(_integrity).map(k => _integrity[k]); }
  function onIntegrityFlag(fn) { if (fn && !_integrityListeners.includes(fn)) _integrityListeners.push(fn); }

  // Ingest a Spine event with redaction/edit refusal. Shared by live routing and
  // replay so both honor immutability identically. `event` is the SDK MatrixEvent,
  // `room` its channel. Returns true if something was ingested.
  function _ingestSpineEvent(event, room) {
    const eid = event.getId();
    const unsigned = event.getUnsigned ? event.getUnsigned() : null;
    const isRedacted = (event.isRedacted && event.isRedacted()) || !!(unsigned && unsigned.redacted_because);
    const decision = spineRestoreDecision(isRedacted, !!_verifiedOriginalFor(eid));

    if (decision === "restore") {
      // Refuse the redaction: re-ingest the verified original we cached before it
      // was deleted. (This is exactly what a voucher will do with re-supplied,
      // hash-verified content.)
      const orig = _verifiedOriginalFor(eid);
      Logger.warn("MatrixBridge: ignoring redaction of " + eid + " in " + (room.name || "?") +
        " — restoring verified original (Spine is immutable)");
      updateInbound(orig.l || 0);
      StreamManager.ingest(orig);   // do NOT re-store: keep the cached original intact
      _flagIntegrity({ eventId: eid, l: orig.l || 0, sender: orig.sender || null,
        channel: room.name || null, status: "redaction-refused", at: Date.now() });
      return true;
    }
    if (decision === "gap") {
      // Redacted and we never cached the original (joined after the deletion, or
      // cache cleared). We cannot resurrect server-purged content — flag the hole
      // loudly instead of silently dropping it (which used to resurrect old state).
      // The voucher layer can later fill this from another client that held it.
      Logger.warn("MatrixBridge: redacted Spine event " + eid + " in " + (room.name || "?") +
        " has no cached original — integrity GAP (cannot restore without a voucher)");
      _flagIntegrity({ eventId: eid, l: (unsigned && unsigned.redacted_because && 0) || 0, sender: event.getSender(),
        channel: room.name || null, status: "integrity-gap", at: Date.now() });
      return false;
    }

    // Normal: build raw from ORIGINAL content (getOriginalContent ignores an edit's
    // m.new_content, so edits to a Spine event are refused — the reducer always
    // sees the originally-committed body). Same shape as the legacy path.
    const content = event.getOriginalContent ? event.getOriginalContent() : event.getContent();
    let parsedL = 0;
    if (event.getType() === "m.room.message" && content && content.body) {
      try { const p = JSON.parse(content.body); if (typeof p.l === "number") parsedL = p.l; } catch (e) {}
    }
    updateInbound(parsedL);
    const raw = {
      event_id: eid,
      type: event.getType(),
      sender: event.getSender(),
      room_id: room.roomId,
      ts: event.getTs(),
      content: content,
      l: parsedL,
      senderRank: _channelRank(room),
      unsigned: unsigned,
    };
    EventCache.store(raw);   // cache the original — this IS the voucher store
    StreamManager.ingest(raw);
    return true;
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
  // Creates the first-build 8-channel DDJP room structure (the space + the
  // CREATION_CHANNELS spec above).
  // Progress reported via onProgress callback after each successful channel creation.
  //
  // Idempotent & resumable: the channels still to build come from creationPlan,
  // deduped against BOTH a caller-supplied partial (`existing`) AND the space's
  // real current children (_liveChannelMap) — so anything a prior attempt already
  // made is skipped instead of duplicated, exactly like createUpgradeBatch.
  // `existing` is { spaceId, channels } from a previous failed run; omit it for a
  // fresh create (the common path). On a fresh create nothing pre-exists, so the
  // plan is the full 8 and behaviour is identical to before.
  //
  // STEP 1 NOTE: the failure path still tears the partial down (unchanged
  // behaviour). The `e.partial` it now carries is scaffolding for step 2, where
  // the teardown is removed and Room.create resumes from it; nothing reads it yet.
  async function createDDJPSpace(name, existing) {
    // Re-entrancy guard — a create is slow (8 creates, possible rate-limit
    // waits). Without this a re-trigger mid-flight could start a second create
    // that snapshots an empty space and duplicates everything (the same class of
    // bug the upgrade guard fixed). The UI also disables the button; this is the
    // code-level backstop.
    if (_creating) throw new Error("MatrixBridge: room creation already in progress");
    _creating = true;
    const creatorId = client.getUserId();
    let spaceId = (existing && existing.spaceId) ? existing.spaceId : null;
    const channels = (existing && existing.channels && typeof existing.channels === "object")
      ? Object.assign({}, existing.channels) : {};

    try {
      // Space — create only if we don't already have one (a resume reuses it).
      if (!spaceId) {
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
      }

      // Fold the space's real current children into the channel map — ground
      // truth that catches channels a prior failed attempt created but never
      // merged back. Empty on a fresh create (a new space has no children yet),
      // so this is inert on the common path and only does work on a resume.
      const live = _liveChannelMap(spaceId);
      for (const key in live) if (!channels[key]) channels[key] = live[key];

      // What's left to build, in spec order. Already-present channels count
      // toward progress so a resumed bar starts where it left off.
      const plan = creationPlan(channels);
      let completed = plan.done;
      if (completed > 0) _reportProgress(completed, "resuming");

      for (const it of plan.todo) {
        const label = it.kind + "-" + it.slug;
        await _delay();
        const create = it.kind === "chat"
          ? () => _createChatChannel(label, it.level, creatorId, spaceId)
          : () => _createOpenChannel(label, it.level, creatorId, spaceId);
        const id = await _createWithRetry(create, label);
        await _addToSpace(spaceId, id);
        channels[it.key] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      Logger.info("MatrixBridge: room creation complete — " + TOTAL_CHANNELS + " channels");
      return { spaceId, channels };

    } catch (e) {
      Logger.error("MatrixBridge: room creation failed — " + e.message);
      // No teardown: the partial channels are KEPT so the caller can resume and
      // finish them (Room.create passes `e.partial` back in, createDDJPSpace
      // dedups against it + the live space children, building only what's
      // missing). This is the orphan-proof replacement for the old all-or-nothing
      // _cleanupRooms — which could itself fail under the same rate limit that
      // caused the failure and leave channels stranded with no way back.
      const wrapped = new Error("Room creation interrupted (resumable — retry to finish). " + e.message);
      wrapped.partial = { spaceId, channels };
      throw wrapped;
    } finally {
      _creating = false;
    }
  }

  // User-initiated discard of an interrupted creation. The deliberate, explicit
  // cousin of the auto-teardown that was removed: it only ever runs when the user
  // chooses to abandon a half-built room (never automatically on a failure, where
  // resuming is the right move). Best-effort — leaving can hit the same rate limit
  // that may have interrupted creation, so a failed leave is logged, not fatal;
  // the caller still clears local state so the room stops being tracked. Any rooms
  // that couldn't be left are ordinary empty rooms the user can remove from a
  // standard Matrix client.
  async function discardCreation(spaceId, channels) {
    const ids = [spaceId, ...Object.values(channels || {})].filter(Boolean);
    let left = 0;
    for (const roomId of ids) {
      try { await client.leave(roomId); left++; }
      catch (e) { Logger.warn("MatrixBridge: discard — could not leave " + roomId + ": " + e.message); }
    }
    Logger.info("MatrixBridge: discarded interrupted creation (" + left + "/" + ids.length + " rooms left)");
    return { attempted: ids.length, left };
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

  // --- Page OLDER chat messages from Matrix ---
  // Chat is RAM-only: the live window holds the most-recent messages and lets the
  // oldest fall away. When the user scrolls up, we ask Matrix (the durable store)
  // for more of the PLAIN message log so the dropped history can be re-shown.
  // This touches NOTHING in the Spine: no protocol events, no consensus, no
  // checkpoints — chat carries none of those. One page per call (successive calls
  // page further back via the SDK's own pagination token); when the server has no
  // older events we report done so the UI stops asking. Review-only: SDK timeline
  // paging + per-event decrypt can't be exercised headlessly.
  // Returns { messages: [{ event_id, sender, body, ts }] oldest->newest, done }.
  async function scrollbackChat(roomId, count) {
    if (!client) return { messages: [], done: true };
    const room = client.getRoom(roomId);
    if (!room || !room.timeline) return { messages: [], done: true };
    const before = room.timeline.length;
    try {
      await client.scrollback(room, count || 30);
    } catch (e) {
      Logger.warn("MatrixBridge: chat scrollback failed for " + roomId + ": " + (e && e.message));
      return { messages: [], done: true };
    }
    const tl = room.timeline;
    const added = tl.length - before;          // older events were prepended at the front
    const out = [];
    for (let i = 0; i < added; i++) {
      const ev = tl[i];
      // Decrypt if the room is E2E and this older event hasn't been decrypted yet.
      try { if (client.decryptEventIfNeeded) await client.decryptEventIfNeeded(ev); } catch (e) {}
      if (ev.getType && ev.getType() === "m.room.message") {
        const c = ev.getContent ? ev.getContent() : {};
        if (c && typeof c.body === "string") {
          out.push({
            event_id: ev.getId ? ev.getId() : null,
            sender: ev.getSender ? ev.getSender() : null,
            body: c.body,
            ts: ev.getTs ? ev.getTs() : 0
          });
        }
      }
    }
    // No older events came back -> we've reached the start of the room's history.
    return { messages: out, done: added === 0 };
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
    // Rehydrate the durable raw-event cache (the voucher seam) from IndexedDB
    // BEFORE replay, so a redaction encountered during replay can be refused by
    // restoring the original we held across the reload. Idempotent + RAM-only-safe.
    await EventCache.ensureLoaded();
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
    const spine = _isSpineChannel(room);
    room.timeline.forEach(event => {
      // Replay honors Spine immutability the same way live routing does: a
      // redacted protocol event is restored from its verified original (or
      // flagged as a gap), and an edited one is read from its original content —
      // never silently dropped or read as the edited/blanked version. This is the
      // path that used to silently lose a redacted event and resurrect old state.
      if (spine) { _ingestSpineEvent(event, room); return; }

      // Defensive legacy path for any non-Spine caller (today replayRoom is only
      // called for events-*/settings-* channels).
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

  // ===== Encryption setup — cross-signing, secret storage, key backup (Topic 2) =====
  // All SDK crypto lives here in transport/. ui/interface.js renders the recovery-key
  // screens but never touches the SDK; index.html orchestrates between them.
  // Accounts and the original recovery key are created in Element — DDJP only unlocks
  // an existing identity, or (as a last resort) resets to a new one. See the project SECURITY policy doc.

  // The SDK calls this whenever it needs the secret-storage key (to read/write
  // cross-signing keys or the backup key). We return the key the user entered or the
  // one we just generated; null makes the SDK surface a recoverable error, not hang.
  async function _getSecretStorageKey({ keys }) {
    if (!_ssKey) return null;
    const keyId = Object.keys(keys)[0];
    return [keyId, _ssKey];
  }

  // UIA callback for uploading cross-signing keys (a protected endpoint, so the
  // server re-checks auth). We reuse the login password. On a restored session no
  // password is held, so this asks the user to log in again before changing setup.
  async function _authUploadDeviceSigningKeys(makeRequest) {
    if (!_loginPassword) {
      throw new Error("Please log out and log in again before changing encryption setup.");
    }
    await makeRequest({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: client.getUserId() },
      password: _loginPassword,
    });
  }

  // Report encryption state so index.html can choose a screen: nothing (already
  // verified), "enter your recovery key", or "create one".
  async function encryptionStatus() {
    const crypto = client && client.getCrypto && client.getCrypto();
    if (!crypto) return { ok: false, reason: "no-crypto" };
    try {
      const [ready, hasServerKeys, backupVersion] = await Promise.all([
        crypto.isCrossSigningReady(),
        crypto.userHasCrossSigningKeys(),
        crypto.getActiveSessionBackupVersion(),
      ]);
      return {
        ok: true,
        ready,                       // this device is already cross-signed & usable
        hasRecoveryKey: hasServerKeys, // account already has a recovery key (e.g. from Element)
        hasBackup: !!backupVersion,
      };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // Unlock with an existing recovery key (Element's "Security Key"). Validates it,
  // then cross-signs THIS device and restores the message-key backup. Throws on a
  // bad key so the UI can show an error.
  async function unlockEncryption(recoveryKey) {
    const crypto = client.getCrypto();
    let privateKey;
    try {
      privateKey = matrixcs.cryptoApi.decodeRecoveryKey(String(recoveryKey || "").replace(/\s+/g, " ").trim());
    } catch (e) {
      throw new Error("That doesn't look like a recovery key.");
    }
    // Validate against the account's default secret-storage key before trusting it.
    const defKeyId = await client.secretStorage.getDefaultKeyId();
    if (!defKeyId) throw new Error("This account has no recovery key set up yet.");
    const keyDesc = await client.secretStorage.getKey(defKeyId);
    const keyInfo = keyDesc ? keyDesc[1] : null;
    const valid = keyInfo ? await client.secretStorage.checkKey(privateKey, keyInfo) : false;
    if (!valid) throw new Error("That recovery key didn't match this account.");

    _ssKey = privateKey;
    try {
      await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: _authUploadDeviceSigningKeys });
      await crypto.restoreKeyBackup().catch(() => {});   // best-effort: pull old message keys
      await crypto.checkKeyBackupAndEnable();
      Logger.info("MatrixBridge: encryption unlocked with recovery key");
      return true;
    } catch (e) {
      _ssKey = null;
      Logger.warn("MatrixBridge: unlock failed — " + e.message);
      throw new Error("Couldn't finish unlocking: " + e.message);
    }
  }

  // Generate a new recovery key for display only. Commits nothing — index.html shows
  // the key, gates on the save-confirmation, then calls commitNewRecoveryKey().
  async function generateRecoveryKey() {
    const crypto = client.getCrypto();
    _pendingNewKey = await crypto.createRecoveryKey();
    return _pendingNewKey.encodedPrivateKey;   // the human-readable key to show & save
  }

  // Confirm the user typed the generated key back correctly, before committing.
  function confirmRecoveryKeyMatches(typed) {
    if (!_pendingNewKey) return false;
    const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
    return norm(typed) === norm(_pendingNewKey.encodedPrivateKey);
  }

  // Commit the generated key. DESTRUCTIVE: replaces any existing secret storage,
  // cross-signing identity, and key backup with new ones under the new key. Old
  // encrypted *message* history under the previous key becomes unreadable. Room
  // membership, ownership, and power levels are room state, not crypto — untouched.
  // Called only after the save + re-entry confirmation.
  async function commitNewRecoveryKey() {
    const crypto = client.getCrypto();
    if (!_pendingNewKey) throw new Error("No pending recovery key to commit.");
    const generated = _pendingNewKey;
    _ssKey = generated.privateKey;
    try {
      await crypto.bootstrapSecretStorage({
        setupNewSecretStorage: true,
        createSecretStorageKey: async () => generated,
      });
      await crypto.bootstrapCrossSigning({
        setupNewCrossSigningKeys: true,
        authUploadDeviceSigningKeys: _authUploadDeviceSigningKeys,
      });
      await crypto.resetKeyBackup();
      _pendingNewKey = null;
      Logger.info("MatrixBridge: new recovery key committed (encryption reset)");
      return true;
    } catch (e) {
      _ssKey = null;
      Logger.warn("MatrixBridge: encryption reset failed — " + e.message);
      throw new Error("Couldn't set up the new key: " + e.message);
    }
  }

  return {
    login, logout, hasSession, restoreSession,
    start, waitForSync, onRawEvent, offRawEvent, onProgress,
    createDDJPSpace, discardCreation, joinDDJPSpace, inviteToSpace, assignRank, createUpgradeBatch, highestPresentBatch, creationPlan,
    sendMessage, sendEvent, replayRoom, spineRestoreDecision, getIntegrityFlags, onIntegrityFlag,
    scrollbackChat,
    _isChatChannel, _isSpineChannel,
    getRankInfo, getMyRank, getWriteChannelId, getRoster, getUserEffectiveRank, desiredMembership: _desiredMembership,
    onRankChange, offRankChange, onRoomsChanged, offRoomsChanged, onChannelAdded, offChannelAdded, joinChannel, setSpaceJoinRule,
    getSpaceVisibility, onVisibilityChange, offVisibilityChange,
    getClient, getUserId, getClock, seedClock,
    encryptionStatus, unlockEncryption, generateRecoveryKey, confirmRecoveryKeyMatches, commitNewRecoveryKey,
    getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar
  };
})();
