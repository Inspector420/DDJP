// ui/screens.js
// SCREENS AND ROOM LIST · MODALS — extracted from ui/interface.js at ddjp_394 as the eighth of
// the ten files roles.md §5 records.
//
// ── CUT LAST-BUT-ONE ON PURPOSE, AND THE REORDER IS MEASURABLE ───────────────────────────────
// `enterMainScreen` is a WIRING HUB: 164 lines calling sixteen render/build/wire functions across
// the roster, chat, DM, settings, feed, queue and player. Banner order would have cut it THIRD.
// Measured then: 24 reach-backs into eight clusters that had not moved. Measured now, after six
// of them landed: **NINE**. The fifteen that vanished are direct ui/ -> ui/ calls today instead of
// entries this file would have published and every later cut would have had to retire.
// **A wiring hub is cut after the things it wires** (roles.md §5).
//
// ── THE WHOLE PUBLIC SURFACE MOVED, SO `Interface` FORWARDS ──────────────────────────────────
// All eleven names `app.js` calls — `showScreen`, `enterMainScreen`, `renderRoomList` and the
// rest — are declared here now. They sat in `Interface`'s return as SHORTHAND, which cannot be
// re-pointed in place (the 51st signature), so that object holds FORWARDERS: the public surface
// keeps its shape while the code behind it moves. Arrows, so they bind at CALL time.
//
// Depends on: UIBase (and its `host`), Room, Chat, Playback, Queue, UserQueue, Reactions, Media,
// RoomUpgrade, ChatPrefs, Logger, and the other ui/ files at call time

const Screens = (() => {

  const { refs, _bg } = UIBase;   // room entry resets the background engine's room id
  const H = UIBase.host;

  // --- state and constants this cluster owns, moved out with it -------------
  const RECOVERY_COPY_REVERT_MS = 1500;  // same, for the recovery-key modal's copy button
  let _mainWired = false;      // the app's change subscriptions, made once per page (ddjp_472)
  let _chatPrefsWired = false;  // ChatPrefs load + onChange subscription happen once
  let _cryptoPollStarted = false;    // guard so the health poll is wired once

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ SCREENS AND ROOM LIST
  //
  // showScreen, the room list, entering a room.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Screens ---
  let _currentScreen = null;
  function showScreen(id) {
    if (PlaylistPanels.previewActive()) PlaylistPanels._closePreview();   // never leave a floating preview behind on navigation
    ["screen-login", "screen-encryption", "screen-rooms", "screen-accounts", "screen-main"].forEach(s => {
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
  // The room-list "Finish creating" card triggers this; app.js registers a
  // handler that drives the same create-progress flow as a fresh create. Keeps
  // the create orchestration in one place (the app shell) instead of the UI.
  let _resumeHandler = null;
  function setResumeHandler(fn) { _resumeHandler = (typeof fn === "function") ? fn : null; }
  function _wireLiveRoomList() {
    if (_roomsLiveWired) return;
    if (!Room.onRoomsChanged) return;
    Room.onRoomsChanged((scanned) => {
      if (_roomListBusy) return;
      if (_currentScreen === "screen-rooms") renderRoomList(scanned);
    });
    // REMOVED FROM THE ROOM ELSEWHERE (J83, the owner's E7): the room has already left itself; the screen follows it to the
    // lobby and says why.
    if (Room.onLeft) Room.onLeft(_onRoomLeft);
    _roomsLiveWired = true;
  }
  function _onRoomLeft(info) {
    if (!info || !info.removed) return;
    _pendingJoinId = null;
    try { H._bgLeaveRoom(); } catch (e) {}
    setLobbyNote("You are no longer in " + (info.name || info.left) + " \u2014 it was closed on this tab.");
    showScreen("screen-rooms");
    renderRoomList(Room.scanDDJPRooms());
  }

  // ── A LINE ABOVE THE ROOM LIST (J83): why the tab is in the lobby when it did not go there itself — a reopen after a reload
  // that was refused, or a room this account was removed from. Cleared when a room is opened.
  let _lobbyNote = "";
  function setLobbyNote(text) { _lobbyNote = text || ""; }

  // ── THE DM PANEL, REACHABLE FROM THE LOBBY (J83, the owner's E3) ─────────────────────────────────────────────────────
  // DMs are bound at login (`app.js`), so the lobby's Messages button opens the same panel a room's DM tab shows.
  let _lobbyDMOpen = false;
  function _wireLobbyDM() {
    const b = (typeof document !== "undefined") ? document.getElementById("btn-lobby-dm") : null;
    if (b && !b._ddjpWired) { b._ddjpWired = true; b.onclick = () => toggleLobbyDM(); }
    try { ChatPanels._wireDMPanel(); ChatPanels._renderDMBadge(); } catch (e) {}
  }
  function toggleLobbyDM(open) {
    const host = (typeof document !== "undefined") ? document.getElementById("lobby-dm") : null;
    if (!host) return;
    _lobbyDMOpen = (typeof open === "boolean") ? open : !_lobbyDMOpen;
    host.style.display = _lobbyDMOpen ? "flex" : "none";
    if (_lobbyDMOpen) ChatPanels.openLobbyDM(host); else ChatPanels.closeLobbyDM();
  }

  // --- Rooms-screen identity (top-right, left of Log out) ---
  // Shows the viewer's OWN full Matrix ID plus a copy button, so they can copy
  // it from the room selector (e.g. to send to an owner for an invite) without
  // first entering a room. This is a deliberate, scoped exception to the "display names only"
  // rule (docs/main/02-architecture.md / docs/main/07-security.md) — the main header no longer
  // shows the id as text: it is always the viewer's own id, never another user's. Reads
  // Room.getMyId at click time so it stays correct. Idempotent — safe to call
  // on every room-list render (the id doesn't change between renders).
  function renderRoomsIdentity() {
    const slot = document.getElementById("rooms-identity");
    if (!slot) return;
    H.clear(slot);
    const myId = Room.getMyId() || "";
    if (!myId) return;
    // Order matches the main header (copy button to the LEFT of the id).
    slot.appendChild(H.copyButton("⧉", () => Room.getMyId() || "", "copy-btn icon-only", "Copy my ID for an invite"));
    slot.appendChild(H.el("span", { class: "my-id", title: myId, text: myId }));
  }

  // --- Room list (login → rooms) ---
  function renderRoomList(scanned) {
    _wireLiveRoomList();   // idempotent — sets up auto-refresh on first render
    _wireLobbyDM();        // J83: the Messages button and its unread dot
    renderRoomsIdentity(); // viewer's own id + copy button, top-right of this screen
    // ── THE SAVES SECTION IS NO LONGER ON THE SELECTOR (v273) ─────────────────────────────
    // It described "the room you last opened" — a permanent list on a screen whose whole subject
    // is a CHOICE between rooms, so it was always about a room other than the one being looked at.
    // It went with room files at J82 (the owner's ruling 1) — see OPEN, below.
    const list = document.getElementById("room-list");
    if (!list) return;
    H.clear(list);
    if (_lobbyNote) list.appendChild(H.el("p", { class: "muted rooms-note", text: _lobbyNote }));

    const ownedRaw = (scanned && scanned.owned) || [];
    const joined = (scanned && scanned.joined) || [];
    const invited = (scanned && scanned.invited) || [];
    const unconfirmed = (scanned && scanned.unconfirmed) || [];

    // An interrupted creation (this or a prior session) — its half-built space
    // already shows up in `owned`, so pull it out and present it as a dedicated
    // "Finish creating" entry instead, to avoid a broken double-listing.
    const pending = (Room.pendingCreate && Room.pendingCreate()) || null;
    const owned = pending ? ownedRaw.filter(r => r.spaceId !== pending.spaceId) : ownedRaw;

    if (!pending && owned.length === 0 && joined.length === 0 && invited.length === 0 && unconfirmed.length === 0) {
      list.appendChild(H.el("p", { class: "muted", text: "No rooms yet — create one or join with a Space ID" }));
      setCreateRoomVisible(true);
      return;
    }
    setCreateRoomVisible(owned.length === 0);

    function section(title, rooms, builder) {
      if (rooms.length === 0) return;
      list.appendChild(H.el("h3", { class: "room-section-title", text: title }));
      rooms.forEach(room => list.appendChild(builder(room)));
    }

    if (pending) {
      list.appendChild(H.el("h3", { class: "room-section-title", text: "Finish creating" }));
      const row = H.el("div", { class: "room-item room-invite-row" });
      row.appendChild(H.el("span", { class: "room-invite-name",
        text: (pending.name || pending.spaceId) + " — interrupted (" + pending.built + "/" + pending.total + " channels)" }));
      const resumeBtn = H.el("button", { class: "btn-primary room-accept-btn", text: "Resume" });
      resumeBtn.onclick = () => {
        resumeBtn.disabled = true; resumeBtn.textContent = "Resuming…";
        if (_resumeHandler) _resumeHandler(pending);
        else Logger.warn("Interface: no resume handler registered");
      };
      const discardBtn = H.el("button", { class: "btn-secondary room-accept-btn", text: "Discard" });
      discardBtn.onclick = async () => {
        if (!window.confirm("Discard the half-built room \"" + (pending.name || pending.spaceId) + "\"? "
          + "This leaves its channels behind and can't be resumed afterward.")) return;
        resumeBtn.disabled = true; discardBtn.disabled = true; discardBtn.textContent = "Discarding…";
        try { await Room.discardPendingCreate(); }
        catch (e) { Logger.warn("Discard failed: " + e.message); }
        renderRoomList(Room.scanDDJPRooms());
      };
      row.appendChild(resumeBtn);
      row.appendChild(discardBtn);
      list.appendChild(row);
    }

    // ── OPEN, BESIDE EACH OWNED ROOM ─────────────────────────────────────────────────────
    // An explicit button that opens the room, beside the row that does the same. (It had a sibling,
    // `Saves`, which opened the room on its saves list; room files were removed at J82, owner's
    // ruling 1, and the list and the button went with them.)
    function openButton(room) {
      const b = H.el("button", { class: "btn-secondary room-open-btn", text: "Open",
        title: "Open this room" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        openRoom(room);
      };
      return b;
    }

    section("Your rooms", owned, (room) => {
      // ── THE WRAPPER CARRIES THE LOOK; THE CHILD INHERITS IT ───────────────────────────────
      // `.room-item` is a themed row AND, one section down, a bare clickable button — one class in
      // two roles. When v270 wrapped it to add a second control, the wrapper kept the theme and the
      // inner `<button>` got only `flex`/`text-align`, so **the browser's default chrome won** and
      // the row rendered white. Same defect as `.dm-input` one release earlier, introduced by that
      // restructure.
      //
      // FIXED AT THE CAUSE RATHER THAN BY PATCHING ONE RULE: the WRAPPER is the row, so the
      // wrapper keeps the look and `.room-item-main` is declared as inheriting — transparent,
      // `color: inherit`, `font: inherit`, no border. The alternative (moving the theme onto the
      // child) would have left the wrapper unstyled and the Open button sitting outside the row's
      // background, which is the same defect one element over.
      const row = H.el("div", { class: "room-item room-with-open" });
      const btn = H.el("button", { class: "room-item-main" }, [room.name || room.spaceId]);
      btn.appendChild(H.el("span", { class: "room-badge-owner", text: "owner" }));
      btn.onclick = () => openRoom(room);
      row.appendChild(btn);
      row.appendChild(openButton(room));
      return withWaiting(row, room);
    });

    section("Joined rooms", joined, (room) => {
      const btn = H.el("button", { class: "room-item" }, [room.name || room.spaceId]);
      btn.onclick = () => openRoom(room);
      return withWaiting(btn, room);
    });

    // ── INVITATIONS: ACCEPT AND DECLINE WORK AS EXPECTED EVERYWHERE (J81; rulings 15 and 16) ──────────────────────────
    // A room invitation has Accept (it joins the room only — its channels are joined when you open it, D4) AND Decline
    // (which also declines the channel invitations waiting under it). "Invitations not confirmed" has Decline only. A
    // failure is said on the row, with its reason, and the buttons come back: never a stuck button, and a decline that
    // fails leaves the invite where it is.
    function inviteButtons(row, acts) {
      const note = H.el("span", { class: "room-invite-note muted", text: "" });
      const btns = acts.map((a) => H.el("button", { class: a.cls, text: a.label }));
      const lock = (v) => { for (const b of btns) b.disabled = v; };
      acts.forEach((a, i) => {
        btns[i].onclick = async () => {
          lock(true); note.textContent = ""; btns[i].textContent = a.busy;
          let r = null, err = null;
          try { r = await a.run(); } catch (e) { err = e; }
          if (!err && !(r && r.ok === false)) { renderRoomList(Room.scanDDJPRooms()); return; }
          const why = err ? ((err && err.message) || String(err)) : ((r.failed && r.failed.join(", ")) || r.reason || "failed");
          Logger.warn("Interface: " + a.label.toLowerCase() + " failed — " + why);
          lock(false); btns[i].textContent = a.label;
          note.textContent = "could not " + a.label.toLowerCase() + ": " + why + " \u2014 it stays";
        };
        row.appendChild(btns[i]);
      });
      row.appendChild(note);
      return row;
    }

    section("Room invitations", invited, (room) => {
      const row = H.el("div", { class: "room-item room-invite-row" });
      row.appendChild(H.el("span", { class: "room-invite-name", text: room.name || room.spaceId }));
      inviteButtons(row, [
        { label: "Accept", busy: "Joining…", cls: "btn-primary room-accept-btn", run: () => Room.acceptInvite(room.spaceId) },
        { label: "Decline", busy: "Declining…", cls: "btn-secondary room-decline-btn", run: () => Room.declineInvite(room.spaceId) },
      ]);
      if (room.waiting && room.waiting.length) {
        const wrap = H.el("div", { class: "room-invite-wrap" }, [row]);
        wrap.appendChild(H.el("p", { class: "muted room-invite-waiting",
          text: "also waiting: " + room.waiting.join(", ") + " \u2014 joined when you open the room" }));
        return wrap;
      }
      return row;
    });

    section("Invitations not confirmed", unconfirmed, (inv) => {
      const row = H.el("div", { class: "room-item room-invite-row room-unconfirmed-row" });
      row.appendChild(H.el("span", { class: "room-invite-name", text: "\u201c" + (inv.name || inv.roomId) + "\u201d" + (inv.from ? " from " + inv.from : "") }));
      inviteButtons(row, [
        { label: "Decline", busy: "Declining…", cls: "btn-secondary room-decline-btn", run: () => Room.declineInvite(inv.roomId) },
      ]);
      return H.el("div", { class: "room-invite-wrap" }, [row, H.el("p", { class: "muted room-invite-why", text: inv.why || "not confirmed" })]);
    });
  }
  // Under a joined room that is not running on this tab: how many verified channel invitations wait for its opening.
  function withWaiting(rowEl, room) {
    if (!room || !room.waiting) return rowEl;
    const wrap = H.el("div", { class: "room-invite-wrap" }, [rowEl]);
    wrap.appendChild(H.el("p", { class: "muted room-invite-waiting",
      text: room.waiting + " channel invitation" + (room.waiting === 1 ? "" : "s") + " waiting \u2014 accepted when you open it" }));
    return wrap;
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
    H.clear(main);

    const back = H.el("button", { class: "back-btn", text: "← Rooms" });
    back.onclick = () => {
      _pendingJoinId = null;   // the pending swap is cancelled...
      // ...AND THE OPENING WITH IT (J83, the owner's E8): before, the join finished in the background and the room ran,
      // unseen, with its bot. It stops at its next step now, and a room it had already switched to is left.
      Room.cancelOpening("back on the loading card");
      H._bgLeaveRoom();
      showScreen("screen-rooms");
      renderRoomList(Room.scanDDJPRooms());
    };

    const card = H.el("div", { class: "room-loading" }, [
      H.el("h2", { class: "room-loading-title", title: room.spaceId || "", text: room.name || room.spaceId }),
      H.el("div", { class: "room-loading-bar-track" }, [H.el("div", { class: "room-loading-bar-fill" })]),
      H.el("p", { class: "muted", text: "Loading room…" })
    ]);

    main.appendChild(H.el("div", { class: "room-loading-screen" }, [back, card]));
  }

  async function openRoom(room, opts) {
    const o = opts || {};
    _pendingJoinId = room.spaceId;
    if (!o.reopen) _lobbyNote = "";
    if (ChatPanels.lobbyDMOpen && ChatPanels.lobbyDMOpen()) toggleLobbyDM(false);
    showRoomLoading(room);
    try {
      // A REOPEN AFTER A RELOAD (J83, E1) goes through `Room.reopen`, which says so and, when refused, forgets the tab's room.
      await (o.reopen ? Room.reopen(room.spaceId) : Room.join(room.spaceId));
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (!(e && e.cancelled)) Logger.warn("Join failed: " + msg);
      if (_pendingJoinId !== room.spaceId) return;   // user already navigated away
      _pendingJoinId = null;
      if (o.reopen && !(e && e.cancelled)) _lobbyNote = "Could not reopen " + (room.name || room.spaceId) + " \u2014 " + msg;
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

  // AFTER A RELOAD (J83, the owner's E1): the room this tab was in, if it remembers one for this account, is opened again
  // through the same loading card. Answers whether there was one.
  function reopenAfterReload() {
    const sid = (Room.rememberedRoom && Room.rememberedRoom()) || null;
    if (!sid) return false;
    let name = sid;
    try {
      const sc = Room.scanDDJPRooms() || {};
      const hit = [].concat(sc.owned || [], sc.joined || []).find((r) => r && r.spaceId === sid);
      if (hit && hit.name) name = hit.name;
    } catch (e) { /* the id is the name */ }
    openRoom({ spaceId: sid, name: name }, { reopen: true });
    return true;
  }

  // ---------------------------------------------------------------------------
  // MAIN SCREEN — built programmatically so the UI owns its own layout.
  // ---------------------------------------------------------------------------
  // ── THE APP'S CHANGE SUBSCRIPTIONS, MADE ONCE (owner audit, ddjp_472) ─────────────────────────────
  // These were made in `enterMainScreen`, so every room entered added another copy — each registry kept
  // each new handler — and after N rooms every change redrew everything N times. Every handler reads the
  // CURRENT screen (`refs`, the modules), never the room it was made for, so one copy serves every room.
  function _wireMainOnce() {
    if (_mainWired) return;
    _mainWired = true;
    // Wire feature callbacks. Each one only re-renders the affected region.
    // renderActivePanel joins these because the activity list is folded from the LOG, so it is
    // stale the moment anything enters it — and Queue.onStateChange is the re-derive announcement,
    // which is the one signal that fires for every event that reached the fold.
    // The CHAT joins for exactly the same reason and through the same signal (ddjp_425): its feed
    // rows are folded from the same log, so anything that re-derives the room has already changed
    // them — and a re-derive can REMOVE a row as well as add one, when a late event turns an
    // accepted act into a refused one. `renderChat` re-reads the fold, and so does the Gear → Feed
    // panel (`Panels.renderFeedPanel`, ddjp_447).
    Queue.onStateChange(() => { Player.renderNowPlaying(); ChatPanels._syncNpButtons(); QueuePanels.renderQueuePanel(); _peopleRedraw(); ChatPanels.renderChat(); Panels.renderFeedPanel(); Roster.renderJoinBtn(); });
    Playback.onStateChange(Player.onPlaybackStateChange);
    // A deliberate hold must not look like a hang. Playback emits only on TRANSITIONS, so this
    // is not a poll — the advance path retries every tick and would otherwise fire constantly.
    Playback.onHoldChange((reason) => { H.reflectPlaybackHold(reason); });
    Chat.onMessage(ChatPanels.addChatMessage);
    Chat.onRedaction(ChatPanels.removeChatMessage);
    UserQueue.onChange(() => { if (H.queueTab() === "mine") QueuePanels.renderQueuePanel(); Roster.renderJoinBtn(); });
    // My ★/▲ latch is derived from my own vote/add events on the spine. Those don't move
    // consensus state (the reducer ignores them), so the Queue.onStateChange render above
    // won't fire when they replay on reload — this re-presses the buttons when the latch
    // is (re)built from history, and on any live echo.
    if (typeof Reactions !== "undefined" && Reactions.onChange) {
      Reactions.onChange(() => { ChatPanels._syncNpButtons(); if (H.queueTab() === "room") QueuePanels.renderQueuePanel(); });
    }
    // A member joined, left or was removed (ddjp_471): the People tab and an open user card redraw.
    Room.onMembersChange(_peopleChanged);
    // ...and anything else the People tab shows (the owner's ruling 35: REP's numbers, in real time), once per burst.
    if (Room.onPeopleViewChange) Room.onPeopleViewChange(Panels.peopleViewChanged);
    // ...and the bot's own card (J117, `ddjp_630`): when what it shows moved, the panel redraws that card alone, while open.
    if (Room.onBotCardChange) Room.onBotCardChange(Settings.refreshRepCard);
    // A chat mapped after the room was wired (ddjp_621: joined late, or its mark read late): the panel re-resolves its tiers.
    if (Room.onChatTiersChanged) Room.onChatTiersChanged(() => ChatPanels.syncChatTier());
    // The Join button is here because its live/greyed state now comes from the room's join rule,
    // which reads MY rank — and a promotion is a power-level change, not a room event, so the
    // `Queue.onStateChange` render above never fires for it (`check-min-dj-rank` PART H5).
    Room.onRankChange(() => { Roster.renderMyRank(); Roster.renderJoinBtn(); _peopleChanged(); ChatPanels.syncChatTier(); ChatPanels._repaintChat(refs.chatBox); QueuePanels.renderQueuePanel(); Roster.renderUpgradePanel(); Settings.renderSettings(); });
    // Re-render avatar spots when a profile picture updates in real time.
    if (Media.onAvatarChange) Media.onAvatarChange((userId) => {
      const url = Media.getAvatarUrl ? Media.getAvatarUrl(userId) : null;
      // url may be null here on avatar REMOVAL — _applyUrl handles both: a real
      // URL swaps initials→img / updates src; null swaps img→initials.
      // Helper: update an existing avatar node in-place to match `url`.
      function _applyUrl(node) {
        if (!node) return;
        const sz = parseInt(node.style.width) || H.AVATAR_CSS_SIZE();
        if (!url) {
          // Avatar removed → revert to initials (only if currently an img).
          if (node.tagName === "IMG") {
            const fresh = H._initialsEl(userId, sz);
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
          img.alt = H.shortName(userId);
          img.style.cssText = node.style.cssText;
          img.dataset.avatarFor = userId;
          img.onerror = () => { img.replaceWith(H._initialsEl(userId, parseInt(img.style.width) || H.AVATAR_CSS_SIZE())); };
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
      // ── EVERY CONTAINER THAT HOLDS MESSAGE ROWS, NOT JUST THE CHAT BOX ──────────────────
      // This was keyed on `refs.chatBox` alone. Now that DM messages are built by the same row
      // builder they carry `data-avatar-for` too, and a refresh that swept one container would
      // have given room chat live avatars and left DM threads frozen at whatever was cached when
      // the row mounted — the merge half-done, which is worse than not merging, because the rows
      // would look identical and behave differently.
      for (const container of [refs.chatBox, refs.dmBox]) {
        if (!container) continue;
        container.querySelectorAll("[data-avatar-for='" + userId + "']").forEach(_applyUrl);
      }
    });
    if (RoomUpgrade.onStatusChange) RoomUpgrade.onStatusChange(() => Roster.renderUpgradePanel());
    if (Room.onSettingsChange) Room.onSettingsChange((s) => {
      // THE ROOM'S MAIN CHAT MAY HAVE MOVED (ddjp_425). `Room._applySettings` has already re-pointed
      // `Chat` through the one resolver before this listener runs; this re-reads the same resolution
      // for the box. A device following the room lands on the new main tier's OWN messages — a fresh
      // screen, never the old tier's rows under the new name, which is what the J12 repaint did —
      // and a device with an override stays where it is. Every tier's buffer survives either way.
      // Unconditional rather than keyed on `s.chat`: the sync is idempotent, and a compare against a
      // remembered value is one more copy of the room's state to keep true across room changes.
      ChatPanels.syncChatTier();
      Player._bgOnSetting(_bg.roomId, (s && s.bg) || null);   // react to a background link change (debounced)
      Settings.renderSettings();
    });

  }

  // People redraws only while it is on screen; it is drawn fresh when opened. An open user card always.
  function _peopleRedraw() {
    if (H.rightTab() === "people") { Roster.renderRoster(); Panels.renderActivePanel(); }
  }
  function _peopleChanged() { _peopleRedraw(); Roster.refreshUserCard(); }

  function enterMainScreen(room) {
    if (ChatPanels.lobbyDMOpen && ChatPanels.lobbyDMOpen()) toggleLobbyDM(false);   // J83: the room's DM tab takes over
    showScreen("screen-main");
    const main = document.getElementById("screen-main");
    if (!main) return;
    H.clear(main);
    QueuePanels._resetStackScroll();   // a new room's queue starts at the top (scroll is preserved within a room)
    H.buildMainDom(main, room);

    _wireMainOnce();   // the change subscriptions — once per page, not once per room (ddjp_472)
    ChatPanels._wireDMPanel();   // J15 — the DM panel's own message + index listeners
    ChatPanels.renderDMPanel();  // paint the (usually empty) list and the badge on entry
    // Reflect the secure-chat banner now (crypto init has already run by the time we reach
    // the main screen) and keep it current with a light poll — crypto can recover (a retry
    // elsewhere) or lapse (token expiry) out of band, so the banner shouldn't be one-shot.
    H.reflectCryptoBanner();
    if (!_cryptoPollStarted) { _cryptoPollStarted = true; setInterval(() => { H.reflectCryptoBanner(); }, 5000); }
    // Start the room's chat (ddjp_425): bind the box to the resolver's channel, draw the go-forward
    // line for feed rows, and backfill the last few messages of EVERY readable tier — not only the
    // active one. It reads the resolution itself, so it no longer depends on the box's tier being
    // seeded first; that dependency is what filed the old one-shot backfill under `_active`.
    if (refs.chatBox) ChatPanels.startChat(refs.chatBox);
    Roster.renderMyRank();
    Player.renderNowPlaying();
    QueuePanels.renderQueuePanel();
    Roster.renderRoster();
    Panels.renderActivePanel();
    ChatPanels._renderChatTierStrip();
    Roster.renderUpgradePanel();
    Settings.renderSettings();
    Panels.renderLogs();
    if (!_chatPrefsWired) {
      ChatPrefs.load();
      // Restore the remembered layout choice now that prefs are loaded (per user,
      // device-local). Falls back to "wide" if none saved.
      try { H._setLayout(ChatPrefs.layout()); } catch (e) {}
      // A pref change re-renders the mounted chat (text <-> image/link) and the
      // settings panel itself (checkboxes / chips reflect the persisted state).
      // The bg toggle also lives in ChatPrefs, so re-apply the background here:
      // flipping "Room backgrounds" off unpaints immediately; on re-evaluates the
      // current room setting (may download).
      ChatPrefs.onChange(() => { ChatPanels._repaintChat(refs.chatBox); ChatPanels._renderChatTierStrip(); Settings.renderChatSettings(); Settings.renderSettings(); Player._bgApplyToggle(); Player._applyDisplayDims(); });
      _chatPrefsWired = true;
    }
    Player._applyDisplayDims();   // push the saved dim levels onto the CSS vars for this entry
    Settings.renderChatSettings();
    QueuePanels._renderGear();
    QueuePanels.renderRightPanel();
    Roster.renderJoinBtn();
    Player._bgEnterRoom(room && room.spaceId ? room.spaceId : (Room.getCurrent() || {}).spaceId || null);
    Player.initYouTubePlayer();
  }


  // ══ MODALS
  //
  // Encryption recovery key entry, reset, save, and the account picker.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ===== Encryption / recovery-key screens (Topic 2) =====
  // Render into #screen-encryption. These never touch the SDK — app.js passes
  // callbacks that do the MatrixAccount work; these methods collect input, enforce
  // the save/understanding gates, and surface errors.

  function _encMount(node) {
    const host = document.getElementById("screen-encryption");
    if (!host) return;
    H.clear(host);
    host.appendChild(node);
    showScreen("screen-encryption");
  }

  // "Enter your recovery key" — the normal path for an account set up in Element.
  // onUnlock(key) resolves on success (and transitions away) or throws on a bad key.
  // onForgot() routes to the reset-understanding gate. onLogout() is the escape hatch.
  function showEnterRecoveryKey({ onUnlock, onForgot, onLogout }) {
    // type=password so the key is masked (dots), not shown in the clear.
    const input = H.el("input", { type: "password", class: "enc-input", placeholder: "Recovery key (e.g. EsTc ABCD …)" });
    const err = H.el("p", { class: "enc-error" });
    const btn = H.el("button", { class: "btn-primary", text: "Unlock" });
    btn.onclick = async () => {
      err.textContent = "";
      // Guard the empty key: a stray Enter carried over from the login screen (or a
      // too-fast Enter before typing) must NOT submit a blank key — that could resolve
      // the encryption gate with nothing entered and skip the step entirely.
      if (!input.value || !input.value.trim()) { err.textContent = "Enter your recovery key first."; return; }
      btn.disabled = true; btn.textContent = "Unlocking…";
      try { await onUnlock(input.value); }
      catch (e) { err.textContent = (e && e.message) || "Couldn't unlock."; btn.disabled = false; btn.textContent = "Unlock"; }
    };
    input.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
    const forgot = H.el("button", { class: "enc-link", text: "I don't have my recovery key" });
    forgot.onclick = () => onForgot();
    const logout = H.el("button", { class: "enc-link enc-link-muted", text: "Log out" });
    logout.onclick = () => onLogout && onLogout();
    _encMount(H.el("div", { class: "enc-box" }, [
      H.el("h2", { text: "Unlock encrypted messages" }),
      H.el("p", { class: "enc-sub", text: "Enter the recovery key you saved when you set up your account in Element. This verifies this device and restores your encrypted message history." }),
      input, err, btn,
      H.el("div", { class: "enc-divider" }),
      forgot, logout,
    ]));
    setTimeout(() => input.focus(), 0);
  }

  // Gate A — understanding that resetting is destructive. Continue stays disabled
  // until both acknowledgements are ticked. onConfirm() proceeds to create a new key.
  function showResetWarning({ onConfirm, onBack }) {
    const ack1 = H.el("input", { type: "checkbox", class: "enc-check" });
    const ack2 = H.el("input", { type: "checkbox", class: "enc-check" });
    const cont = H.el("button", { class: "btn-primary", text: "Create a new recovery key", disabled: true });
    const refresh = () => { cont.disabled = !(ack1.checked && ack2.checked); };
    ack1.onchange = refresh; ack2.onchange = refresh;
    cont.onclick = () => onConfirm();
    const back = H.el("button", { class: "btn-secondary", text: "Go back" });
    back.onclick = () => onBack();
    _encMount(H.el("div", { class: "enc-box enc-box-wide" }, [
      H.el("h2", { text: "Create a new recovery key?" }),
      H.el("p", { class: "enc-sub", text: "Do this only if you genuinely cannot find your existing recovery key. Check Element and your password manager first — the old key cannot be recovered once you replace it." }),
      H.el("label", { class: "enc-ack" }, [ack1, H.el("span", { text: "I understand that creating a new key permanently replaces my old one, and any encrypted messages that only the old key could unlock will become unreadable." })]),
      H.el("label", { class: "enc-ack" }, [ack2, H.el("span", { text: "I understand this affects encrypted messages only — my account, my rooms, and my ownership are not affected — and that I should look for my existing key before continuing." })]),
      cont, back,
    ]));
  }

  // Gate B — show the new key; require both the saved-it checkbox and a correct
  // re-entry before committing. confirmMatch(typed) checks the re-entry locally;
  // onConfirm() commits. onBack is optional (omitted on first-time setup).
  function showSaveNewKey({ recoveryKey, confirmMatch, onConfirm, onBack }) {
    const keyBox = H.el("div", { class: "enc-key", text: recoveryKey });
    const copy = H.el("button", { class: "btn-secondary", text: "Copy" });
    copy.onclick = () => { try { navigator.clipboard.writeText(recoveryKey); copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", RECOVERY_COPY_REVERT_MS); } catch (e) {} };
    const saved = H.el("input", { type: "checkbox", class: "enc-check" });
    const reentry = H.el("input", { type: "text", class: "enc-input", placeholder: "Type your recovery key again to confirm" });
    const err = H.el("p", { class: "enc-error" });
    const cont = H.el("button", { class: "btn-primary", text: "Confirm & continue", disabled: true });
    const refresh = () => { cont.disabled = !(saved.checked && reentry.value.trim().length > 0); };
    saved.onchange = refresh; reentry.oninput = refresh;
    cont.onclick = async () => {
      err.textContent = "";
      if (!confirmMatch(reentry.value)) { err.textContent = "That doesn't match the key above. Check and try again."; return; }
      cont.disabled = true; cont.textContent = "Setting up…";
      try { await onConfirm(); }
      catch (e) { err.textContent = (e && e.message) || "Couldn't finish setup."; cont.disabled = false; cont.textContent = "Confirm & continue"; }
    };
    const children = [
      H.el("h2", { text: "Save your recovery key" }),
      H.el("p", { class: "enc-sub", text: "This is the only way to unlock your encrypted messages on another device or after logging out. Save it in a password manager now — it won't be shown again." }),
      keyBox, copy,
      H.el("label", { class: "enc-ack" }, [saved, H.el("span", { text: "I have saved my recovery key somewhere safe." })]),
      reentry, err, cont,
    ];
    if (onBack) { const back = H.el("button", { class: "enc-link", text: "Back" }); back.onclick = () => onBack(); children.push(back); }
    _encMount(H.el("div", { class: "enc-box enc-box-wide" }, children));
  }

  // --- Manage accounts (multi-account picker) ---
  // Lists known accounts with the active one badged; non-active accounts can be
  // switched to (or signed into, if their session was cleared) or forgotten. All
  // side effects run through the passed-in handlers (the app shell owns the bridge
  // + store calls) — this view only builds DOM, per the UI/storage boundary.
  // shape: showAccounts({ accounts:[{userId,homeserver}], activeUserId,
  //   hasSession(userId)->bool, onSwitch(userId), onForget(userId), onAdd(), onBack() })
  function showAccounts(opts) {
    opts = opts || {};
    const screen = document.getElementById("screen-accounts");
    if (!screen) return;
    H.clear(screen);

    const rows = (opts.accounts || []).map((a) => {
      const isActive = a.userId === opts.activeUserId;
      const left = H.el("div", { class: "acct-id" }, [
        H.el("span", { class: "my-id", title: a.userId, text: a.userId }),
        isActive ? H.el("span", { class: "acct-badge", text: "Active" }) : null,
      ]);
      const actions = H.el("div", { class: "acct-actions" });
      if (!isActive) {
        const signedIn = opts.hasSession ? opts.hasSession(a.userId) : true;
        const sw = H.el("button", { class: "btn-secondary", text: signedIn ? "Switch" : "Sign in" });
        sw.onclick = () => { sw.disabled = true; opts.onSwitch && opts.onSwitch(a.userId); };
        const forget = H.el("button", { class: "enc-link enc-link-muted", text: "Forget" });
        forget.onclick = async () => {
          if (!confirm("Forget " + a.userId + " on this browser? This removes its local data and encryption keys here. Encrypted history will need the recovery key to restore if you sign in again.")) return;
          forget.disabled = true; forget.textContent = "Forgetting…";
          try { opts.onForget && await opts.onForget(a.userId); } catch (e) {}
        };
        actions.appendChild(sw); actions.appendChild(forget);
      }
      return H.el("div", { class: "acct-row" }, [left, actions]);
    });

    const add = H.el("button", { class: "btn-primary", text: "Add account" });
    add.onclick = () => opts.onAdd && opts.onAdd();
    const back = H.el("button", { class: "btn-secondary", text: "Back" });
    back.onclick = () => opts.onBack && opts.onBack();

    screen.appendChild(H.el("div", { class: "accounts-wrap" }, [
      H.el("div", { class: "accounts-head" }, [H.el("h2", { text: "Accounts" }), back]),
      H.el("p", { class: "enc-sub", text: "Each account keeps its own separate storage and encryption on this browser." }),
      H.el("div", { class: "accounts-list" }, rows.length ? rows : [H.el("p", { class: "muted", text: "No accounts yet." })]),
      add,
    ]));
    showScreen("screen-accounts");
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    showScreen, renderRoomList, setCreateRoomVisible, enterMainScreen,
    showEnterRecoveryKey, showResetWarning, showSaveNewKey, showAccounts,
    setRoomListBusy, setResumeHandler, openRoom,
    reopenAfterReload, setLobbyNote, toggleLobbyDM,   // J83
  };
})();
