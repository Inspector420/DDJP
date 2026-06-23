// ui/interface.js
// UI only. Reads from feature modules, fires user intents downward. No logic,
// no consensus, no direct Matrix or stream access — every read and write goes
// through a feature module. All DOM is built with createElement / textContent
// so no network-derived string is ever interpreted as HTML.
// Depends on: Room, Queue, Skip, Playback, UserQueue, Chat, RoomUpgrade, StorageIO, Logger

const Interface = (() => {
  // Display-only rank table (highest first). Authority lives in the channels;
  // this is just labels and the gates for which controls to show.
  const RANKS = [
    { level: 100, name: "Owner",         color: "#E8890C" },  // legendary orange
    { level: 80,  name: "High Staff",    color: "#7C3AED" },  // heroic purple
    { level: 60,  name: "Staff",         color: "#3B82F6" },  // deep blue
    { level: 40,  name: "VIP",           color: "#60A5FA" },  // blue
    { level: 20,  name: "Player",        color: "#4ADE80" },  // green
    { level: 10,  name: "Guest",         color: "#A7C4A0" },  // greyish green
    { level: 0,   name: "Uncategorized", color: "#9CA3AF" },  // grey
  ];
  const VIP = 40, STAFF = 60, HIGH_STAFF = 80, OWNER = 100;
  function rankName(level) { const r = RANKS.find(x => x.level === level); return r ? r.name : ("L" + level); }
  // Returns the hex color for a given power level, falling back to grey.
  function rankColor(level) { const r = RANKS.find(x => x.level === level); return r ? r.color : "#9CA3AF"; }
  // Look up a user's power level from the live roster by full Matrix ID.
  // Returns 0 (Uncategorized) if they aren't in the roster yet.
  function _rosterLevel(userId) {
    const roster = Room.getRoster ? Room.getRoster() : [];
    const member = roster.find(m => m.userId === userId);
    return member ? member.level : 0;
  }

  // --- Avatar elements ---
  // avatarEl(userId, size) returns an <img> showing the user's Matrix profile
  // picture, or an initials circle as fallback. Always synchronous: uses the
  // cached URL from Media (null on first call, fills in via onAvatarChange).
  // Size is the CSS pixel dimension for width + height (default 28).
  const AVATAR_CSS_SIZE = 28;   // px — small but readable at 1x and 2x
  const AVATAR_RADIUS = "6px";  // rounded-square corners (was a full circle)
  function avatarEl(userId, size) {
    const sz = size || AVATAR_CSS_SIZE;
    const url = Media.getAvatarUrl ? Media.getAvatarUrl(userId) : null;
    const base = "border-radius:" + AVATAR_RADIUS + ";width:" + sz + "px;height:" + sz + "px;object-fit:cover;flex-shrink:0;";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = shortName(userId);
      img.style.cssText = base;
      img.onerror = () => { img.replaceWith(_initialsEl(userId, sz)); };
      return img;
    }
    return _initialsEl(userId, sz);
  }
  function _initialsEl(userId, sz) {
    const d = document.createElement("div");
    const initials = shortName(userId).slice(0, 2).toUpperCase();
    const color = rankColor(_rosterLevel(userId));
    d.textContent = initials;
    d.style.cssText = "border-radius:" + AVATAR_RADIUS + ";width:" + sz + "px;height:" + sz + "px;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "font-size:" + Math.round(sz * 0.38) + "px;font-weight:bold;flex-shrink:0;" +
      "background:#2a2a2a;color:" + color + ";";
    return d;
  }

  // --- tiny DOM helper: text only, never HTML ---
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "class") n.className = props[k];
        else if (k === "text") n.textContent = props[k];
        else if (k === "onclick") n.onclick = props[k];
        else if (k === "value") n.value = props[k];
        else if (k === "placeholder") n.placeholder = props[k];
        else if (k === "disabled") n.disabled = props[k];
        else n.setAttribute(k, props[k]);
      }
    }
    if (children) for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  function clear(node) { if (node) node.replaceChildren(); }

  // --- Live countdown timers (#4) ---
  // Tracks active countdown intervals by key so re-rendering a panel clears the
  // old timer instead of stacking duplicates. fmtCountdown renders a remaining
  // millisecond span as a human duration that ticks down each second.
  const _countdowns = {};
  function fmtCountdown(ms) {
    let s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    if (m > 0) return m + ":" + String(s).padStart(2, "0");
    return s + "s";
  }
  // Start a per-second countdown writing into `node`. key dedups/replaces an
  // existing timer. prefix/suffix wrap the formatted time. onDone fires once
  // when the target is reached. Returns nothing; cleared via clearCountdown.
  function startCountdown(key, node, targetMs, prefix, suffix, onDone) {
    clearCountdown(key);
    const tick = () => {
      const remaining = targetMs - Date.now();
      if (!node || !node.isConnected) { clearCountdown(key); return; }
      if (remaining <= 0) {
        node.textContent = (prefix || "") + "now" + (suffix || "");
        clearCountdown(key);
        if (onDone) { try { onDone(); } catch (e) {} }
        return;
      }
      node.textContent = (prefix || "") + fmtCountdown(remaining) + (suffix || "");
    };
    tick();
    _countdowns[key] = setInterval(tick, 1000);
  }
  function clearCountdown(key) {
    if (_countdowns[key]) { clearInterval(_countdowns[key]); delete _countdowns[key]; }
  }


  // Reusable copy-to-clipboard button. getText() is called at click time so the
  // value can be dynamic. Shows brief "Copied!" feedback, then reverts.
  function copyButton(label, getText, className, title) {
    const btn = el("button", { class: className || "copy-btn", text: label, title: title || "Copy to clipboard" });
    btn.onclick = () => {
      const text = (getText() || "").toString();
      if (!text) return;
      const done = () => {
        const iconOnly = btn.classList.contains("icon-only");
        btn.textContent = iconOnly ? "✓" : "Copied!";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = label; btn.classList.remove("copied"); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => Logger.warn("copy failed"));
      } else {
        // Fallback for non-secure contexts / older browsers
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          done();
        } catch (e) { Logger.warn("copy fallback failed"); }
      }
    };
    return btn;
  }

  function fmt(sec) {
    if (sec == null || isNaN(sec)) return "0:00";
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }
  function shortName(userId) { return (userId || "").split(":")[0].replace("@", ""); }

  // --- module-level refs (built in enterMainScreen) ---
  let player = null, playerReady = false;
  let queueTab = "room";   // "room" | "mine"
  let rightTab = "chat"; // "chat" | "people" | "roomset" | "logs"
  let _lastChatTier = null; // so we can clear the chat box when the main chat tier changes
  const _setLocks = {};   // settingKey -> true while a just-changed option is locked (3s)
  // Local-only playback volume/mute. Never a protocol event — applies to THIS
  // browser's player instance only. Re-applied on every player state change so
  // a fresh video (which YouTube resets to its own default volume) is forced
  // back to the user's chosen level/mute state as fast as possible.
  const volumeState = { level: 100, muted: false };
  const refs = {};

  // --- Logger → Logs tab -----------------------------------------------------
  // The bottom debug log, relocated into the Logs tab. Lines from BEFORE this
  // page load (restored from storage) render grey; lines logged in THIS session
  // render green. Persisted (capped) so "older" actually exists across reloads.
  const _logCap = 300;
  let _priorLog = [];
  let _sessionLog = [];
  try { const saved = StorageIO.load("log"); if (Array.isArray(saved)) _priorLog = saved.slice(-_logCap); } catch (e) {}
  let _logSaveTimer = null;
  function _saveLogSoon() {
    if (_logSaveTimer) return;
    _logSaveTimer = setTimeout(() => {
      _logSaveTimer = null;
      try { StorageIO.save("log", _priorLog.concat(_sessionLog).slice(-_logCap)); } catch (e) {}
    }, 800);
  }
  function _appendLogRow(text, fresh) {
    if (!refs.logsBox) return;
    refs.logsBox.appendChild(el("div", { class: "log-line " + (fresh ? "fresh" : "old"), text: text }));
    while (refs.logsBox.childNodes.length > _logCap) refs.logsBox.removeChild(refs.logsBox.firstChild);
    refs.logsBox.scrollTop = refs.logsBox.scrollHeight;
  }
  function renderLogs() {
    if (!refs.logsBox) return;
    clear(refs.logsBox);
    for (const line of _priorLog) _appendLogRow(line, false);
    for (const line of _sessionLog) _appendLogRow(line, true);
  }
  Logger.on(entry => {
    const line = "[" + entry.level + "] " + entry.message;
    _sessionLog.push(line);
    if (_sessionLog.length > _logCap) _sessionLog.shift();
    _saveLogSoon();
    _appendLogRow(line, true);
  });

  // --- Screens ---
  let _currentScreen = null;
  function showScreen(id) {
    ["screen-login", "screen-rooms", "screen-main"].forEach(s => {
      const elx = document.getElementById(s);
      if (elx) elx.style.display = "none";
    });
    const target = document.getElementById(id);
    if (target) target.style.display = "flex";
    _currentScreen = id;
  }

  // Wire live room-list updates exactly once. When Matrix reports a membership
  // or room change (new invite, a room joined elsewhere, etc.), re-render the
  // list — but only if the rooms screen is actually visible, so we never fight
  // with the main room screen or rebuild a hidden DOM. Also suppressed while a
  // creation/join is in progress: those operations create many channels in a
  // burst, each firing a Matrix Room event, which would otherwise repaint the
  // rooms screen on top of the creation progress bar.
  let _roomsLiveWired = false;
  let _roomListBusy = false;        // set true during create/join to pause live repaints
  function setRoomListBusy(v) { _roomListBusy = !!v; }
  function _wireLiveRoomList() {
    if (_roomsLiveWired) return;
    if (!Room.onRoomsChanged) return;
    Room.onRoomsChanged((scanned) => {
      if (_roomListBusy) return;
      if (_currentScreen === "screen-rooms") renderRoomList(scanned);
    });
    _roomsLiveWired = true;
  }

  // --- Rooms-screen identity (top-right, left of Log out) ---
  // Shows the viewer's OWN full Matrix ID plus a copy button, so they can copy
  // it from the room selector (e.g. to send to an owner for an invite) without
  // first entering a room. This is the SAME deliberate, scoped exception to the
  // "display names only" rule used by the main header (06_fundamentals.md /
  // CLAUDE.md): it is always the viewer's own id, never another user's. Reads
  // Room.getMyId at click time so it stays correct. Idempotent — safe to call
  // on every room-list render (the id doesn't change between renders).
  function renderRoomsIdentity() {
    const slot = document.getElementById("rooms-identity");
    if (!slot) return;
    clear(slot);
    const myId = Room.getMyId() || "";
    if (!myId) return;
    // Order matches the main header (copy button to the LEFT of the id).
    slot.appendChild(copyButton("⧉", () => Room.getMyId() || "", "copy-btn icon-only", "Copy my ID for an invite"));
    slot.appendChild(el("span", { class: "my-id", title: myId, text: myId }));
  }

  // --- Room list (login → rooms) ---
  function renderRoomList(scanned) {
    _wireLiveRoomList();   // idempotent — sets up auto-refresh on first render
    renderRoomsIdentity(); // viewer's own id + copy button, top-right of this screen
    const list = document.getElementById("room-list");
    if (!list) return;
    clear(list);

    const owned = (scanned && scanned.owned) || [];
    const joined = (scanned && scanned.joined) || [];
    const invited = (scanned && scanned.invited) || [];

    if (owned.length === 0 && joined.length === 0 && invited.length === 0) {
      list.appendChild(el("p", { class: "muted", text: "No rooms yet — create one or join with a Space ID" }));
      setCreateRoomVisible(true);
      return;
    }
    setCreateRoomVisible(owned.length === 0);

    function section(title, rooms, builder) {
      if (rooms.length === 0) return;
      list.appendChild(el("h3", { class: "room-section-title", text: title }));
      rooms.forEach(room => list.appendChild(builder(room)));
    }

    section("Your rooms", owned, (room) => {
      const btn = el("button", { class: "room-item" }, [room.name || room.spaceId]);
      btn.appendChild(el("span", { class: "room-badge-owner", text: "owner" }));
      btn.onclick = () => openRoom(room);
      return btn;
    });

    section("Joined rooms", joined, (room) => {
      const btn = el("button", { class: "room-item" }, [room.name || room.spaceId]);
      btn.onclick = () => openRoom(room);
      return btn;
    });

    section("Pending invites", invited, (room) => {
      const row = el("div", { class: "room-item room-invite-row" });
      row.appendChild(el("span", { class: "room-invite-name", text: room.name || room.spaceId }));
      const acceptBtn = el("button", { class: "btn-primary room-accept-btn", text: "Accept" });
      acceptBtn.onclick = async () => {
        acceptBtn.disabled = true; acceptBtn.textContent = "Joining…";
        try {
          await Room.acceptInvite(room.spaceId);
          renderRoomList(Room.scanDDJPRooms());
        } catch (e) {
          Logger.warn("Accept invite failed: " + e.message);
          acceptBtn.disabled = false; acceptBtn.textContent = "Accept";
        }
      };
      row.appendChild(acceptBtn);
      return row;
    });
  }
  function setCreateRoomVisible(visible) {
    const section = document.getElementById("create-room-section");
    if (section) section.style.display = visible ? "flex" : "none";
  }

  // ---------------------------------------------------------------------------
  // OPENING A ROOM — instant transition, then live.
  //
  // Joining replays the room's full history (back-paginating every channel),
  // which can take a moment. We don't want to block on that with the rooms list
  // still on screen, so we switch to the main screen immediately and show a
  // loading card for the room (its name is already known from the scan), then
  // run the join in the background and swap in the live room when it resolves.
  // ---------------------------------------------------------------------------
  let _pendingJoinId = null;   // spaceId currently loading, or null

  function showRoomLoading(room) {
    showScreen("screen-main");
    const main = document.getElementById("screen-main");
    if (!main) return;
    clear(main);

    const back = el("button", { class: "back-btn", text: "← Rooms" });
    back.onclick = () => {
      _pendingJoinId = null;   // cancel the pending swap; join may finish in the background
      showScreen("screen-rooms");
      renderRoomList(Room.scanDDJPRooms());
    };

    const card = el("div", { class: "room-loading" }, [
      el("h2", { class: "room-loading-title", title: room.spaceId || "", text: room.name || room.spaceId }),
      el("div", { class: "room-loading-bar-track" }, [el("div", { class: "room-loading-bar-fill" })]),
      el("p", { class: "muted", text: "Loading room…" })
    ]);

    main.appendChild(el("div", { class: "room-loading-screen" }, [back, card]));
  }

  async function openRoom(room) {
    _pendingJoinId = room.spaceId;
    showRoomLoading(room);
    try {
      await Room.join(room.spaceId);
    } catch (e) {
      Logger.warn("Join failed: " + (e && e.message ? e.message : e));
      if (_pendingJoinId !== room.spaceId) return;   // user already navigated away
      _pendingJoinId = null;
      showScreen("screen-rooms");
      renderRoomList(Room.scanDDJPRooms());
      return;
    }
    // If the user hit back (or opened a different room) while we were loading,
    // don't yank them into this room.
    if (_pendingJoinId !== room.spaceId) return;
    _pendingJoinId = null;
    enterMainScreen(Room.getCurrent());
  }

  // ---------------------------------------------------------------------------
  // MAIN SCREEN — built programmatically so the UI owns its own layout.
  // ---------------------------------------------------------------------------
  function enterMainScreen(room) {
    showScreen("screen-main");
    const main = document.getElementById("screen-main");
    if (!main) return;
    clear(main);
    buildMainDom(main, room);

    // Wire feature callbacks. Each one only re-renders the affected region.
    Queue.onStateChange(() => { renderNowPlaying(); renderQueuePanel(); renderRoster(); renderJoinBtn(); });
    Playback.onStateChange(onPlaybackStateChange);
    Chat.onMessage(addChatMessage);
    UserQueue.onChange(() => { if (queueTab === "mine") renderQueuePanel(); renderJoinBtn(); });
    Room.onRankChange(() => { renderMyRank(); renderRoster(); renderQueuePanel(); renderUpgradePanel(); renderSettings(); });
    // Re-render avatar spots when a profile picture updates in real time.
    if (Media.onAvatarChange) Media.onAvatarChange((userId) => {
      const url = Media.getAvatarUrl ? Media.getAvatarUrl(userId) : null;
      // url may be null here on avatar REMOVAL — _applyUrl handles both: a real
      // URL swaps initials→img / updates src; null swaps img→initials.
      // Helper: update an existing avatar node in-place to match `url`.
      function _applyUrl(node) {
        if (!node) return;
        const sz = parseInt(node.style.width) || AVATAR_CSS_SIZE;
        if (!url) {
          // Avatar removed → revert to initials (only if currently an img).
          if (node.tagName === "IMG") {
            const fresh = _initialsEl(userId, sz);
            fresh.style.cssText = node.style.cssText.replace(/object-fit:cover;?/, "");
            fresh.dataset.avatarFor = userId;
            node.replaceWith(fresh);
          }
          return;
        }
        if (node.tagName === "IMG") {
          if (node.src !== url) node.src = url;
        } else {
          // Was an initials div — replace once with a real img, keep data-avatar-for
          const img = document.createElement("img");
          img.src = url;
          img.alt = shortName(userId);
          img.style.cssText = node.style.cssText;
          img.dataset.avatarFor = userId;
          img.onerror = () => { img.replaceWith(_initialsEl(userId, parseInt(img.style.width) || AVATAR_CSS_SIZE)); };
          node.replaceWith(img);
        }
      }
      // Own avatar in header
      const myId = Room.getMyId();
      if (userId === myId && refs.myAvatarSlot) {
        _applyUrl(refs.myAvatarSlot.firstChild);
      }
      // Now-playing DJ avatar — update src on the persistent refs.npAvatar node
      if (refs.npAvatar && refs.npAvatar.dataset.avatarFor === userId) {
        _applyUrl(refs.npAvatar);
      }
      // Chat: update all avatar nodes for this user by data-avatar-for attribute
      if (refs.chatBox) {
        refs.chatBox.querySelectorAll("[data-avatar-for='" + userId + "']").forEach(_applyUrl);
      }
    });
    if (RoomUpgrade.onStatusChange) RoomUpgrade.onStatusChange(() => renderUpgradePanel());
    if (Room.onSettingsChange) Room.onSettingsChange((s) => {
      // If the main chat tier changed, clear the chat box so we don't mix tiers.
      if (s && s.chat !== _lastChatTier) { if (refs.chatBox) clear(refs.chatBox); _lastChatTier = s.chat; }
      renderSettings();
    });

    renderMyRank();
    renderNowPlaying();
    renderQueuePanel();
    renderRoster();
    renderUpgradePanel();
    renderSettings();
    renderLogs();
    _lastChatTier = Room.getSettings().chat;
    renderRightPanel();
    renderJoinBtn();
    initYouTubePlayer();
  }

  function buildMainDom(main, room) {
    // Header: back, room title (+ room code next to it), upgrade slot, my identity on the right.
    const backBtn = el("button", { class: "back-btn", text: "← Rooms" });
    backBtn.onclick = () => { showScreen("screen-rooms"); renderRoomList(Room.scanDDJPRooms()); };

    const code = el("code", { class: "room-code", title: room.spaceId || "", text: room.spaceId || "" });
    const copyIdBtn = copyButton("⧉", () => room.spaceId || "", "copy-btn copy-id-btn icon-only", "Copy room ID");
    const titleGroup = el("div", { class: "title-group" }, [
      el("h2", { text: room.name || room.spaceId }),
      code,
      copyIdBtn
    ]);

    // NOTE — deliberate, scoped exception to the "display names only" rule
    // (03_fundamentals.md / CLAUDE.md): this shows the CURRENT USER's OWN full
    // Matrix ID, never another user's. Every other surface (roster, chat
    // sender, etc.) still shows display names only — this is a one-off,
    // explicitly requested override for the viewer's own identity, not a
    // general relaxation of the rule.
    refs.myIdBadge = el("span", { class: "my-id" });
    refs.rankBadge = el("span", { class: "rank-badge" });
    // Copy-invite: shares the viewer's OWN full Matrix ID so they can send it
    // to a room owner to be invited. Reads from Room.getMyId at click time.
    // Sits between the rank badge and the ID itself.
    const copyInviteBtn = copyButton("⧉", () => Room.getMyId() || "", "copy-btn copy-invite-btn icon-only", "Copy my ID for an invite");
    // Own avatar — top-right next to rank badge. Clickable to upload a new
    // picture; updated live via onAvatarChange. avatarNote shows upload status.
    refs.myAvatarSlot = el("div", { style: "display:inline-flex;align-items:center;" });
    refs.avatarNote = el("span", { style: "font-size:11px;color:#888;white-space:nowrap;" });
    const myIdentity = el("div", { class: "my-identity" }, [refs.myAvatarSlot, refs.avatarNote, refs.rankBadge, copyInviteBtn, refs.myIdBadge]);

    const header = el("div", { class: "main-header" }, [
      backBtn,
      titleGroup,
      refs.upgradeSlot = el("div", { class: "upgrade-slot" }),
      myIdentity
    ]);

    // Now-playing: video title (left) + Skip (right) above the embed; a
    // controls row below it with join/leave (left), reset (middle), and
    // volume/mute (right).
    refs.videoTitle = el("span", { class: "video-title muted", text: "" });
    refs.skipBtn = el("button", { class: "skip-btn", text: "⏭ Skip" });
    refs.skipBtn.onclick = async () => {
      refs.skipBtn.disabled = true;
      if (refs.skipNote) refs.skipNote.textContent = "";
      try {
        const result = await Skip.skip();
        if (!result.ok && refs.skipNote) {
          refs.skipNote.textContent = result.reason || "Skip didn't go through";
          setTimeout(() => { if (refs.skipNote) refs.skipNote.textContent = ""; }, 4000);
        }
      } catch (e) {
        Logger.warn(e.message);
        if (refs.skipNote) refs.skipNote.textContent = "Skip failed — try again";
      } finally {
        renderNowPlaying();   // re-evaluate disabled state from real stream state
      }
    };
    refs.player = el("div", { id: "yt-player" });
    // Playback progress bar — thin button-blue fill that glides left→right with
    // the song. Display only (not a scrubber). Driven by a rAF loop seeded from
    // startedAt/duration, re-synced to the real elapsed on every playback tick.
    refs.progressFill = el("div", { class: "progress-fill" });
    refs.progressBar = el("div", { class: "progress-bar" }, [refs.progressFill]);
    refs.npLabel = el("div", { class: "np-label muted" });

    // Join/Leave the DJ rotation — moved here from the personal-queue tab.
    refs.joinBtn = el("button", { class: "join-btn" });
    refs.joinBtn.onclick = () => {
      if (UserQueue.isActive()) UserQueue.leaveRoomQueue(); else UserQueue.joinRoomQueue();
      renderJoinBtn();
    };

    // Refresh reloads the current video from the start in THIS browser only —
    // a local re-sync, not a protocol event. Does nothing to the room state.
    refs.resetBtn = el("button", { class: "mini reset-btn", text: "↻", title: "Reload this video (local only — doesn't affect the room)" });
    refs.resetBtn.onclick = () => { reloadCurrentVideo(); };

    // Volume + mute — entirely local playback control, applied straight to
    // the YT.Player instance. Never a protocol event; nothing here is sent
    // to the room or other clients.
    refs.volumeSlider = el("input", { class: "volume-slider", type: "range", min: "0", max: "100", value: String(volumeState.level) });
    refs.volumeSlider.oninput = () => {
      volumeState.level = parseInt(refs.volumeSlider.value, 10);
      if (volumeState.level > 0) volumeState.muted = false;
      applyVolumeState();
    };
    refs.muteBtn = el("button", { class: "mini mute-btn", text: "🔊" });
    refs.muteBtn.onclick = () => { volumeState.muted = !volumeState.muted; applyVolumeState(); };

    const playbackControls = el("div", { class: "playback-controls" }, [
      refs.joinBtn,
      el("div", { class: "volume-group" }, [refs.muteBtn, refs.volumeSlider, refs.resetBtn])
    ]);

    refs.skipNote = el("div", { class: "skip-note" });

    const nowPlaying = el("div", { class: "now-playing" }, [
      el("div", { class: "skip-row" }, [refs.videoTitle, refs.skipBtn]),
      refs.player,
      refs.progressBar,
      refs.npLabel,
      refs.skipNote,
      playbackControls
    ]);

    // One queue panel toggling Room rotation vs My personal queue.
    refs.tabRoom = el("button", { class: "tab", text: "Room queue" });
    refs.tabMine = el("button", { class: "tab", text: "My queue" });
    refs.tabRoom.onclick = () => { queueTab = "room"; renderQueuePanel(); };
    refs.tabMine.onclick = () => { queueTab = "mine"; renderQueuePanel(); };
    refs.queueBody = el("div", { class: "queue-body" });
    const queuePanel = el("div", { class: "queue-panel" }, [
      el("div", { class: "tabs" }, [refs.tabRoom, refs.tabMine]),
      refs.queueBody
    ]);

    // Roster + rank controls + invite
    refs.rosterBox = el("div", { class: "roster-box" });
    const inviteInput = el("input", { class: "invite-input", placeholder: "@user:server to invite" });
    const inviteBtn = el("button", { class: "invite-btn", text: "Invite" });
    inviteBtn.onclick = async () => {
      const v = inviteInput.value.trim();
      if (!v) return;
      try { await Room.invite(v); inviteInput.value = ""; Logger.info("Invited " + v); }
      catch (e) { Logger.warn("Invite failed: " + e.message); }
    };
    refs.roster = el("div", { class: "roster" }, [
      refs.rosterBox,
      el("div", { class: "invite-row" }, [inviteInput, inviteBtn])
    ]);

    // Chat
    refs.chatBox = el("div", { id: "chat-messages", class: "chat-messages" });
    refs.chatInput = el("input", { class: "chat-input", placeholder: "Message…" });
    const sendChat = () => {
      const v = refs.chatInput.value.trim();
      if (!v) return;
      Chat.send(v); refs.chatInput.value = "";
    };
    refs.chatInput.onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
    refs.chat = el("div", { class: "chat" }, [
      refs.chatBox,
      el("div", { class: "chat-input-row" }, [refs.chatInput, el("button", { text: "Send", onclick: sendChat })])
    ]);

    // Tabs: chat · people · room-set · logs — one panel visible at a time. Each
    // panel keeps rendering into its (hidden) DOM even when not active, so chat
    // history and the live log aren't lost while another tab is showing.
    refs.tabChat = el("button", { class: "tab", text: "Chat" });
    refs.tabPeople = el("button", { class: "tab", text: "People" });
    refs.tabRoomset = el("button", { class: "tab", text: "Room" });
    refs.tabLogs = el("button", { class: "tab", text: "Logs" });
    refs.tabChat.onclick = () => { rightTab = "chat"; renderRightPanel(); };
    refs.tabPeople.onclick = () => { rightTab = "people"; renderRightPanel(); };
    refs.tabRoomset.onclick = () => { rightTab = "roomset"; renderSettings(); renderRightPanel(); };
    refs.tabLogs.onclick = () => { rightTab = "logs"; renderLogs(); renderRightPanel(); };

    // Room settings panel (form of toggles; owner-editable, everyone can see).
    refs.settingsBox = el("div", { class: "settings-box" });
    refs.settings = el("div", { class: "settings" }, [refs.settingsBox]);

    // Logs panel (the relocated debug log).
    refs.logsBox = el("div", { class: "logs-box" });
    refs.logs = el("div", { class: "logs" }, [refs.logsBox]);

    const rightPanel = el("div", { class: "right-panel" }, [
      el("div", { class: "tabs" }, [refs.tabChat, refs.tabPeople, refs.tabRoomset, refs.tabLogs]),
      refs.roster,
      refs.chat,
      refs.settings,
      refs.logs
    ]);

    // Three columns: queues left, player middle, people/chat toggle right.
    const columns = el("div", { class: "columns" }, [
      el("div", { class: "column column-left" }, [queuePanel]),
      el("div", { class: "column column-mid" }, [nowPlaying]),
      el("div", { class: "column column-right" }, [rightPanel])
    ]);

    main.appendChild(header);
    main.appendChild(columns);
  }

  // --- My rank + own avatar (live) ---
  function renderMyRank() {
    const myId = Room.getMyId() || "";
    if (refs.myIdBadge) refs.myIdBadge.textContent = myId;
    if (refs.rankBadge) {
      refs.rankBadge.textContent = rankName(Room.getMyRank());
    }
    if (refs.myAvatarSlot && myId) {
      const av = avatarEl(myId, 28);
      av.style.cursor = "pointer";
      av.title = "Click to change your picture";
      av.onclick = _pickAvatarFile;
      refs.myAvatarSlot.replaceChildren(av);
    }
  }

  // --- Avatar upload (own picture) ---
  // Clicking your own avatar (top-right) opens a device file picker. The chosen
  // image is validated + uploaded by Media.uploadAvatar, which sets it as
  // your global Matrix avatar. We show a brief uploading/updated/error note in
  // the header (refs.avatarNote) and let onAvatarChange swap the picture in.
  let _avatarUploading = false;
  function _pickAvatarFile() {
    if (_avatarUploading) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) _doAvatarUpload(file);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  }

  function _setAvatarNote(text, isError) {
    if (!refs.avatarNote) return;
    refs.avatarNote.textContent = text || "";
    refs.avatarNote.style.color = isError ? "#ff6b6b" : "#888";
  }

  async function _doAvatarUpload(file) {
    if (!Media.uploadAvatar) return;
    _avatarUploading = true;
    _setAvatarNote("Uploading…", false);
    try {
      const r = await Media.uploadAvatar(file);
      if (r && r.ok) {
        _setAvatarNote("Updated", false);
        setTimeout(() => _setAvatarNote("", false), 2500);
      } else {
        _setAvatarNote((r && r.reason) || "Upload failed", true);
        setTimeout(() => _setAvatarNote("", false), 5000);
      }
    } catch (e) {
      Logger.warn("Avatar upload: " + (e && e.message));
      _setAvatarNote("Upload failed — try again", true);
      setTimeout(() => _setAvatarNote("", false), 5000);
    } finally {
      _avatarUploading = false;
    }
  }

  // Build the now-playing label with DJ avatar + colored name.
  // Called from both renderNowPlaying (static) and onPlaybackStateChange (ticking).
  // Keeps a persistent avatar img node (refs.npAvatar) and only updates its src
  // rather than rebuilding from scratch every 2s tick — avoids flicker.
  function _setNpLabel(djId, middle) {
    if (!refs.npLabel) return;
    const color = rankColor(_rosterLevel(djId));
    // Only rebuild the whole label structure when the DJ changes.
    // On every tick we just update the text node and avatar src in-place.
    if (!refs.npAvatar || refs.npAvatar.dataset.avatarFor !== djId) {
      const nameEl = el("span", { text: shortName(djId) });
      nameEl.style.color = color;
      nameEl.style.fontWeight = "bold";
      refs.npAvatar = avatarEl(djId, 22);
      refs.npAvatar.style.marginRight = "6px";
      refs.npAvatar.style.verticalAlign = "middle";
      refs.npAvatar.dataset.avatarFor = djId;
      refs.npMiddle = document.createTextNode(middle);
      refs.npLabel.replaceChildren(
        document.createTextNode("Now playing — "),
        refs.npAvatar,
        nameEl,
        refs.npMiddle
      );
    } else {
      // Same DJ — just update the time/song text and avatar src if it changed.
      if (refs.npMiddle) refs.npMiddle.textContent = middle;
      const url = Media.getAvatarUrl ? Media.getAvatarUrl(djId) : null;
      if (url && refs.npAvatar.tagName === "IMG" && refs.npAvatar.src !== url) refs.npAvatar.src = url;
    }
  }

  // --- Now-playing label + Skip enabled state ---
  function renderNowPlaying() {
    const np = Queue.getNowPlaying();
    if (refs.skipBtn) refs.skipBtn.disabled = !np || _endedNow;
    if (_endedNow || !np || !np.song) {
      // Nothing playing right now: either the derived state has no real song, or
      // the current one has already finished in wall-clock time (_endedNow). In
      // both cases show "Nothing playing" and don't present a song to replay —
      // Playback's tick advances the rotation (or it stays empty if idle).
      if (refs.npLabel) refs.npLabel.textContent = "Nothing playing";
      refs.npAvatar = null;   // force label rebuild on next song
      clearProgress();        // hide the progress bar when nothing is playing
      _currentSong = null;
      updateVideoTitle();
      return;
    }
    _setNpLabel(np.dj, " · " + np.song.videoId);
    if (!_currentSong || _currentSong.videoId !== np.song.videoId) {
      _currentSong = { videoId: np.song.videoId, dj: np.dj, startedAt: np.startedAt };
      updateVideoTitle();
    }
  }

  // ---------------------------------------------------------------------------
  // QUEUE PANEL
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // RIGHT PANEL — People / Chat toggle (one visible at a time)
  // ---------------------------------------------------------------------------
  function renderRightPanel() {
    const t = rightTab;
    if (refs.tabChat) refs.tabChat.classList.toggle("active", t === "chat");
    if (refs.tabPeople) refs.tabPeople.classList.toggle("active", t === "people");
    if (refs.tabRoomset) refs.tabRoomset.classList.toggle("active", t === "roomset");
    if (refs.tabLogs) refs.tabLogs.classList.toggle("active", t === "logs");
    if (refs.chat) refs.chat.style.display = t === "chat" ? "flex" : "none";
    if (refs.roster) refs.roster.style.display = t === "people" ? "flex" : "none";
    if (refs.settings) refs.settings.style.display = t === "roomset" ? "flex" : "none";
    if (refs.logs) refs.logs.style.display = t === "logs" ? "flex" : "none";
  }

  // A form of toggles, not a view of a channel. The buttons ALWAYS reflect the
  // current state read from Matrix (chat tier is derived; visibility is the
  // space's live join rule), so there's nothing to reconcile. Only the owner can
  // change them, and after a change the just-touched setting locks for 3s so it
  // can't be re-toggled before the new state lands and re-renders.
  function _lockSetting(key) {
    _setLocks[key] = true;
    renderSettings();
    setTimeout(() => { delete _setLocks[key]; renderSettings(); }, 3000);
  }

  function renderSettings() {
    if (!refs.settingsBox) return;
    clear(refs.settingsBox);
    const s = Room.getSettings();
    const isOwner = Room.getMyRank() >= 100;

    refs.settingsBox.appendChild(el("div", { class: "uq-section", text: "Room settings" }));
    if (!isOwner) refs.settingsBox.appendChild(el("p", { class: "muted", text: "Only the owner can change these." }));

    const optionRow = (key, label, current, options, onPick) => {
      const locked = !!_setLocks[key];
      const opts = el("div", { class: "set-opts" });
      options.forEach(([val, text]) => {
        const active = val === current;
        const clickable = isOwner && !active && !locked;
        const b = el("button", { class: "set-opt" + (active ? " active" : ""), text: text });
        if (clickable) b.onclick = () => { onPick(val); _lockSetting(key); };
        else b.disabled = true;   // non-owner, the current choice, or a locked setting → inert
        opts.appendChild(b);
      });
      const row = el("div", { class: "set-row" }, [el("div", { class: "set-label", text: label }), opts]);
      if (locked) row.appendChild(el("div", { class: "set-hint", text: "Updating…" }));
      refs.settingsBox.appendChild(row);
    };

    optionRow("chat", "Main chat", s.chat,
      [["uncategorized", "Uncategorized"], ["guest", "Guest"]],
      (v) => Room.setSettings({ chat: v }));
    optionRow("vis", "Visibility", s.vis,
      [["private", "Private — invite only"], ["public", "Public — anyone can join"]],
      (v) => Room.setSettings({ vis: v }));
  }

  function renderQueuePanel() {
    if (!refs.queueBody) return;
    if (refs.tabRoom) refs.tabRoom.classList.toggle("active", queueTab === "room");
    if (refs.tabMine) refs.tabMine.classList.toggle("active", queueTab === "mine");
    clear(refs.queueBody);
    if (queueTab === "room") renderRoomQueue(); else renderMyQueue();
  }

  function renderRoomQueue() {
    const myRank = Room.getMyRank();
    const np = Queue.getNowPlaying();
    const rotation = Queue.getRotation();

    if (np && np.song) {
      const npName = el("span", { class: "who", text: shortName(np.dj) });
      npName.style.color = rankColor(_rosterLevel(np.dj));
      refs.queueBody.appendChild(el("div", { class: "rot-item playing" }, [
        npName,
        el("span", { class: "song", text: "▶ " + np.song.videoId })
      ]));
    }
    if (!rotation || rotation.length === 0) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "No DJs waiting" }));
    } else {
      rotation.forEach(entry => {
        const songs = entry.pending.map(p => p.videoId).join(", ");
        const entryName = el("span", { class: "who", text: shortName(entry.user) });
        entryName.style.color = rankColor(_rosterLevel(entry.user));
        const row = el("div", { class: "rot-item" }, [
          entryName,
          el("span", { class: "song", text: songs || "(empty)" })
        ]);
        if (myRank >= STAFF) {
          const up = el("button", { class: "mini", text: "▲", onclick: () => Queue.move(entry.user, null) });
          const rm = el("button", { class: "mini", text: "✕", onclick: () => Queue.remove(entry.user) });
          row.appendChild(el("span", { class: "rot-actions" }, [up, rm]));
        }
        refs.queueBody.appendChild(row);
      });
    }
    if (myRank >= HIGH_STAFF) {
      refs.queueBody.appendChild(el("button", { class: "danger", text: "Reset rotation", onclick: () => Queue.reset() }));
    }
  }

  function renderMyQueue() {
    // Add-by-link box
    const input = el("input", { class: "uq-input", placeholder: "Paste a YouTube link…" });
    const note = el("div", { class: "uq-note muted" });
    const addOne = () => {
      const v = input.value.trim();
      if (!v) return;
      const r = UserQueue.add(v);
      if (r.ok) {
        input.value = "";
        // Adding never joins the rotation now — make that discoverable the first
        // time someone queues a song while they're not in the rotation.
        note.textContent = UserQueue.isActive() ? "Added." : "Added — click Join to start playing.";
      } else {
        note.textContent = "Couldn't add: " + r.reason;
      }
      renderJoinBtn();   // a newly-added song can enable the Join button
    };
    input.onkeydown = (e) => { if (e.key === "Enter") addOne(); };
    refs.queueBody.appendChild(el("div", { class: "uq-add" }, [input, el("button", { text: "Add", onclick: addOne })]));
    refs.queueBody.appendChild(note);

    // Declared buffer — the songs committed to the room rotation (up to 2),
    // derived from the stream and shared with everyone. The ▲ on the second one
    // promotes it to play next, emitting ddjp.dj.order; the reorder is consensus,
    // so a last-second change that races an advance resolves the same for you and
    // everyone else. No optimistic local swap — the view updates when the
    // reordered state comes back through the stream.
    const decl = UserQueue.declared ? UserQueue.declared() : [];
    if (decl.length > 0) {
      refs.queueBody.appendChild(el("div", { class: "uq-section", text: "In the room queue — plays next" }));
      decl.forEach((song, i) => {
        const actions = [];
        if (i > 0) {
          actions.push(el("button", { class: "mini", text: "▲", title: "Play this one next",
            onclick: () => { if (UserQueue.promote) UserQueue.promote(song.videoId); } }));
        }
        refs.queueBody.appendChild(el("div", { class: "uq-item declared" }, [
          el("span", { class: "song", text: (i === 0 ? "▶ " : (i + 1) + ". ") + song.videoId }),
          el("span", { class: "uq-actions" }, actions)
        ]));
      });
    }

    // The personal stack (songs not yet declared to the room)
    const list = UserQueue.list();
    if (decl.length > 0) {
      refs.queueBody.appendChild(el("div", { class: "uq-section", text: "Your stack — not yet declared" }));
    }
    if (list.length === 0) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: decl.length > 0 ? "Nothing else queued" : "Your queue is empty" }));
    } else {
      list.forEach((song, i) => {
        const row = el("div", { class: "uq-item" }, [
          el("span", { class: "song", text: (i + 1) + ". " + song.videoId }),
          el("span", { class: "uq-actions" }, [
            el("button", { class: "mini", text: "▲", onclick: () => UserQueue.moveUp(i) }),
            el("button", { class: "mini", text: "✕", onclick: () => UserQueue.removeAt(i) })
          ])
        ]);
        refs.queueBody.appendChild(row);
      });
    }
    // Join/Leave the DJ queue now lives under the now-playing song (see buildMainDom).
  }

  function renderJoinBtn() {
    if (!refs.joinBtn) return;
    const active = UserQueue.isActive();
    const stackLeft = UserQueue.stackCount ? UserQueue.stackCount() : 0;

    refs.joinBtn.classList.remove("active", "dropped", "refilling");

    if (active) {
      // In the rotation, or actively (re)joining — auto-feed is on.
      refs.joinBtn.textContent = "Leave the DJ queue";
      refs.joinBtn.classList.add("active");
      refs.joinBtn.disabled = false;
    } else {
      // Not in the rotation — whether we never joined or just ran out.
      refs.joinBtn.textContent = "Join the DJ queue";
      // Joining with nothing to play would put us in as an invisible member that
      // never rotates, so require at least one queued song before Join is live.
      refs.joinBtn.disabled = stackLeft === 0;
    }
  }

  // ---------------------------------------------------------------------------
  // ROSTER + rank assignment (Staff+)
  // ---------------------------------------------------------------------------
  function renderRoster() {
    if (!refs.rosterBox) return;
    clear(refs.rosterBox);
    const myRank = Room.getMyRank();
    const myId = Room.getMyId();
    const roster = Room.getRoster();
    if (!roster || roster.length === 0) {
      refs.rosterBox.appendChild(el("p", { class: "muted", text: "Just you so far" }));
      return;
    }
    roster.forEach(member => {
      const nameEl = el("span", { class: "who", text: member.name || shortName(member.userId) });
      nameEl.style.color = rankColor(member.level);
      const row = el("div", { class: "person" }, [
        nameEl,
        el("span", { class: "rank-tag", text: rankName(member.level) })
      ]);
      // Staff+ may set ranks strictly below their own, for people below them —
      // and only ranks the room has actually unlocked channels for.
      if (myRank >= STAFF && member.userId !== myId && member.level < myRank) {
        row.appendChild(rankSelect(member.level, myRank, async (lvl) => {
          try { await Room.assignRank(member.userId, lvl); }
          catch (e) { Logger.warn("assignRank: " + e.message); }
        }));
      }
      refs.rosterBox.appendChild(row);
    });
  }

  function rankSelect(currentLevel, myRank, onPick) {
    const sel = el("select", { class: "rank-select" });
    const channels = Room.getChannels();
    RANKS.forEach(r => {
      if (r.level >= myRank) return;                          // can't grant at-or-above yourself
      if (!Room.isRankUnlocked(channels, r.level)) return;     // room hasn't created this rank's channels yet
      const opt = el("option", { value: String(r.level), text: r.name });
      if (r.level === currentLevel) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => onPick(parseInt(sel.value, 10));
    return sel;
  }

  // ---------------------------------------------------------------------------
  // OWNER upgrade control (lives in the header, top-left by the room name)
  // ---------------------------------------------------------------------------
  function renderUpgradePanel() {
    const slot = refs.upgradeSlot;
    if (!slot) return;
    // While an upgrade is actively running, runUpgrade() owns this slot and is
    // updating a live progress bar inside it. renderUpgradePanel is ALSO wired to
    // fire on events that occur DURING an upgrade: the start/done markers
    // (RoomUpgrade.onStatusChange) and the m.room.power_levels state event emitted
    // by every freshly-created channel (Room.onRankChange). Each such call would
    // clear the slot and repaint the "Resume unlock" button on top of the bar —
    // so the bar shows correctly at first, then gets clobbered the instant the
    // first of those events lands (the reported "displays well, then offers to
    // upgrade instead of showing progress"). Defer to the running upgrade and
    // leave its bar alone; runUpgrade() repaints this panel itself once it
    // finishes, so the normal button/cooldown view is restored then.
    if (RoomUpgrade.isRunning && RoomUpgrade.isRunning()) return;
    clearCountdown("upgrade-cooldown");   // drop any prior countdown before rebuilding
    clear(slot);
    if (Room.getMyRank() < OWNER) return;   // owner-only
    let st;
    try { st = RoomUpgrade.status(); } catch (e) { return; }
    if (!st) return;

    if (st.currentBatch >= st.maxBatch) {
      slot.appendChild(el("span", { class: "upgrade-note", text: "All ranks unlocked" }));
      return;
    }
    if (st.canUpgradeNow) {
      const label = st.inProgress ? "Resume unlock (" + st.currentBatch + "/" + st.maxBatch + ")"
                                  : "Unlock next ranks (" + st.currentBatch + "/" + st.maxBatch + ")";
      const btn = el("button", { class: "upgrade-btn", text: label });
      btn.onclick = () => runUpgrade();
      slot.appendChild(btn);
    } else if (st.nextAvailableAt) {
      const note = el("span", { class: "upgrade-note" });
      slot.appendChild(note);
      startCountdown("upgrade-cooldown", note, st.nextAvailableAt,
        "Next unlock in ", "",
        () => renderUpgradePanel());   // cooldown hit zero — re-render to show the button
    } else {
      clearCountdown("upgrade-cooldown");
    }
    // (status-change re-render is wired once in enterMainScreen)
  }

  async function runUpgrade() {
    const slot = refs.upgradeSlot;
    if (!slot) return;
    if (RoomUpgrade.isRunning && RoomUpgrade.isRunning()) {
      Logger.warn("upgrade: already running — ignoring repeat trigger");
      return;
    }
    clear(slot);
    const fill = el("div", { class: "upgrade-bar-fill" });
    const lbl = el("span", { class: "upgrade-bar-label", text: "Starting…" });
    slot.appendChild(el("div", { class: "upgrade-bar" }, [el("div", { class: "upgrade-bar-track" }, [fill]), lbl]));
    let ok = true;
    try {
      await RoomUpgrade.upgrade((completed, total, label, waitUntil) => {
        if (completed == null) {
          if (waitUntil) {
            startCountdown("upgrade-ratelimit", lbl, waitUntil, label || "Retrying in ", "");
          } else {
            clearCountdown("upgrade-ratelimit");
            lbl.textContent = label || "Waiting…";
          }
          return;
        }
        clearCountdown("upgrade-ratelimit");
        fill.style.width = Math.round((completed / total) * 100) + "%";
        lbl.textContent = label + " (" + completed + "/" + total + ")";
      });
    } catch (e) {
      ok = false;
      Logger.warn("upgrade: " + e.message);
    }
    clearCountdown("upgrade-ratelimit");
    // On success, hold a brief "Done" state (mirrors room creation) so the done
    // marker has time to round-trip and be recorded before we repaint. Without
    // it, renderUpgradePanel can fire in the gap between the batch finishing and
    // the done event being ingested — when status still shows start-without-done
    // — and flash the stale "Resume unlock" button for a moment. On failure the
    // batch is resumable, so repaint immediately to bring the Resume button back.
    if (ok) {
      fill.style.width = "100%";
      lbl.textContent = "Done";
      await new Promise(r => setTimeout(r, 600));
    }
    renderUpgradePanel();
  }

  // ---------------------------------------------------------------------------
  // CHAT
  // ---------------------------------------------------------------------------
  function addChatMessage(sender, body) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box) return;
    // Look up the sender's rank for their color. Falls back to grey if not in roster yet.
    const color = rankColor(_rosterLevel(sender));
    const senderEl = el("span", { class: "sender", text: shortName(sender) });
    senderEl.style.color = color;
    const av = avatarEl(sender, 20);
    av.style.marginRight = "5px";
    av.style.verticalAlign = "middle";
    av.dataset.avatarFor = sender;   // lets onAvatarChange find and refresh it
    const msg = el("div", { class: "chat-msg" }, [av, senderEl, " " + body]);
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // YOUTUBE PLAYER (the song element)
  // ---------------------------------------------------------------------------
  let _currentSong = null;   // { videoId, dj } of what's loaded, for reset/title
  let _endedNow = false;     // current song has ended in wall-clock time (Playback overlay)

  // --- Smooth playback progress bar ---
  // Driven DIRECTLY off the live YouTube player each animation frame:
  // currentTime / duration, read via getPlayerTime() + player.getDuration().
  // Because it reads the real player, it follows skips, seeks, and song swaps
  // automatically — no wall-clock anchoring to keep in sync. The tradeoff
  // (accepted): it inherits the player's quirks — sits at 0 while buffering,
  // can jump on a seek, and may read stale for a frame right at a song swap.
  // Those are smoothed lightly below (ignore non-finite / zero-duration reads).
  let _progRaf = null;
  function _readPlayerDuration() {
    if (!player || !playerReady || !player.getDuration) return 0;
    try { const d = player.getDuration(); return (typeof d === "number" && isFinite(d)) ? d : 0; }
    catch (e) { return 0; }
  }
  function _progTick() {
    if (!refs.progressFill) { _progRaf = null; return; }
    const dur = _readPlayerDuration();
    const cur = getPlayerTime();   // null if player not ready
    // While the player isn't reporting usable numbers yet (buffering, swap),
    // hold the last width rather than snapping to 0 — avoids a flicker to empty.
    if (dur > 0 && cur !== null && isFinite(cur)) {
      const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
      refs.progressFill.style.width = pct + "%";
      if (refs.progressBar) refs.progressBar.style.visibility = "visible";
    }
    _progRaf = requestAnimationFrame(_progTick);
  }
  // Start the live-read loop (idempotent). Called when a real song is playing.
  function startProgress() {
    if (refs.progressBar) refs.progressBar.style.visibility = "visible";
    if (!_progRaf) _progRaf = requestAnimationFrame(_progTick);
  }
  function clearProgress() {
    if (_progRaf) { cancelAnimationFrame(_progRaf); _progRaf = null; }
    if (refs.progressFill) refs.progressFill.style.width = "0%";
    if (refs.progressBar) refs.progressBar.style.visibility = "hidden";
  }

  function onPlaybackStateChange(np) {
    if (!np) { _endedNow = false; clearVideo(); clearProgress(); renderNowPlaying(); _currentSong = null; updateVideoTitle(); return; }
    if (np.ended) {
      // The current song has finished in real time and nothing has replaced it
      // yet. Reflect "nothing playing" and stop the video so it can't replay.
      // Don't re-read the derived state here — it still holds the just-ended
      // song until the advance lands; the overlay flag makes renderNowPlaying
      // show nothing too. Cleared as soon as a real song (or null) arrives.
      _endedNow = true;
      clearVideo();
      clearProgress();
      _currentSong = null;
      updateVideoTitle();
      renderNowPlaying();
      return;
    }
    _endedNow = false;
    // getVideoData() can return undefined — not just lack a video_id — when no
    // video has ever loaded yet, right after stopVideo()/clearVideo(), or
    // transiently during a fast video swap. The old `.video_id` access here had
    // no guard for that and threw, which StreamManager's per-subscriber
    // try/catch swallowed silently (logged as a warn) — so this whole function
    // would abort before ever reaching loadVideo(), leaving the player stuck on
    // the previous song with no further error and no retry. This is the actual
    // cause behind "I skipped but the other person stays on the old song."
    let currentId = null;
    if (player && player.getVideoData) {
      try {
        const vd = player.getVideoData();
        if (vd && vd.video_id) currentId = vd.video_id;
      } catch (e) { /* player not in a state to report video data yet — treat as no video loaded */ }
    }
    if (np.song && np.song.videoId !== currentId) {
      _currentSong = { videoId: np.song.videoId, dj: np.dj, startedAt: np.startedAt };
      loadVideo(np.song.videoId, np.startedAt);
      updateVideoTitle();
      // New video — snap the bar back to 0 right away so a skip visibly restarts
      // it, instead of holding the previous song's width until the player catches up.
      if (refs.progressFill) refs.progressFill.style.width = "0%";
    }
    if (np.elapsed !== undefined && np.duration) {
      const t = getPlayerTime();
      if (t !== null && Math.abs(t - np.elapsed) > 10) seekPlayer(np.elapsed);
    }
    // A real song is playing — make sure the live-read progress loop is running.
    // It reads the player directly each frame, so it follows skips/seeks itself.
    if (np.song) startProgress();
    if (refs.npLabel && np.elapsed !== undefined) {
      _setNpLabel(np.dj, " · " + fmt(np.elapsed) + (np.duration ? " / " + fmt(np.duration) : ""));
    }
    // Re-assert the user's chosen volume/mute on every tick. Local-only state,
    // never sent over the protocol — this is what makes it "override as fast
    // as possible" if a video reload or YouTube's own defaults try to change it.
    applyVolumeState();
  }

  function updateVideoTitle() {
    if (!refs.videoTitle) return;
    if (!_currentSong) { refs.videoTitle.textContent = ""; return; }
    // YouTube's IFrame API only exposes a real title after the player has
    // buffered the video (getVideoData().title); until then, fall back to the
    // video ID so something is shown immediately instead of staying blank.
    const vd = player && player.getVideoData ? player.getVideoData() : null;
    const title = vd && vd.title ? vd.title : _currentSong.videoId;
    refs.videoTitle.textContent = title;
  }

  function initYouTubePlayer() {
    player = null; playerReady = false;
    if (!window.YT || !window.YT.Player) { setTimeout(initYouTubePlayer, 500); return; }
    player = new YT.Player("yt-player", {
      height: "300", width: "100%", videoId: "",
      playerVars: { autoplay: 1, controls: 1, mute: 1 },
      events: {
        onReady: () => {
          playerReady = true;
          Logger.debug("Interface: player ready");
          applyVolumeState();   // enforce the user's chosen volume immediately on ready
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            const d = player.getDuration(), vd = player.getVideoData();
            if (d && vd) Playback.setDuration(vd.video_id, d);
            updateVideoTitle();      // title is often only available once playing
            applyVolumeState();      // re-assert on every state transition
          }
        }
      }
    });
  }

  // The latest video we actually want playing. loadVideo only ever records this
  // and asks _doLoad to reconcile — so if the player isn't ready yet (e.g. during
  // the replay burst, which fires many state changes before YouTube is up), the
  // pending retry loads the CURRENT desired video, never a stale one captured
  // when an intermediate replay state flashed by. This is what kept one client
  // (whose player happened to become ready mid-replay) stuck on a much earlier
  // song while another, ready before the burst, showed the right one.
  let _wantVideo = null;     // { videoId, startedAt } or null = nothing
  let _loadTimer = null;
  function loadVideo(videoId, startedAt) {
    _wantVideo = { videoId: videoId, startedAt: startedAt };
    _doLoad();
  }
  function _doLoad() {
    if (!_wantVideo) return;
    if (!player || !playerReady) {
      if (!_loadTimer) _loadTimer = setTimeout(() => { _loadTimer = null; _doLoad(); }, 500);
      return;
    }
    const w = _wantVideo;
    const elapsed = (Date.now() - w.startedAt) / 1000;
    player.loadVideoById({ videoId: w.videoId, startSeconds: Math.max(0, elapsed) });
    // Apply the user's actual chosen state — NOT an unconditional unmute.
    // (Previously this always force-unmuted after load, which would silently
    // override a user who had chosen to mute. The player starts muted only to
    // satisfy browser autoplay policy; applyVolumeState corrects it right after.)
    setTimeout(() => applyVolumeState(), 1000);
  }

  // Reset = reload the current song from the start, in THIS browser only. Pure
  // local re-sync — does not touch the room, the rotation, or any other client.
  function reloadCurrentVideo() {
    if (!_currentSong || !player || !playerReady) return;
    player.loadVideoById({ videoId: _currentSong.videoId, startSeconds: 0 });
    setTimeout(() => applyVolumeState(), 1000);
  }

  // Push the local volume/mute state onto the actual player. Safe to call
  // anytime — no-ops if the player isn't ready yet.
  function applyVolumeState() {
    if (!player || !playerReady) return;
    try {
      player.setVolume(volumeState.level);
      if (volumeState.muted || volumeState.level === 0) player.mute();
      else player.unMute();
    } catch (e) { /* player not fully initialized yet — next call will catch up */ }
    if (refs.muteBtn) refs.muteBtn.textContent = (volumeState.muted || volumeState.level === 0) ? "🔇" : "🔊";
    if (refs.volumeSlider && parseInt(refs.volumeSlider.value, 10) !== volumeState.level) {
      refs.volumeSlider.value = String(volumeState.level);
    }
  }

  function seekPlayer(seconds) { if (player && playerReady) player.seekTo(seconds, true); }
  function getPlayerTime() { if (!player || !playerReady) return null; try { return player.getCurrentTime(); } catch (e) { return null; } }
  function clearVideo() {
    _wantVideo = null;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
    if (player && playerReady) player.stopVideo();
  }

  return {
    showScreen, renderRoomList, setCreateRoomVisible, enterMainScreen,
    addChatMessage, startCountdown, clearCountdown, setRoomListBusy
  };
})();
