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
// Depends on: UIBase, Interface (via UIBase.host), Room, Rooms, Chat, Playback, Continuity,
// Capabilities, StorageIO, Logger

const Screens = (() => {

  const { refs, _bg } = UIBase;   // room entry resets the background engine's room id
  const H = UIBase.host;

  // --- state and constants this cluster owns, moved out with it -------------
  const RECOVERY_COPY_REVERT_MS = 1500;  // same, for the recovery-key modal's copy button
  let _chatPrefsWired = false;  // ChatPrefs load + onChange subscription happen once
  let _lastChatTier = null; // so we can clear the chat box when the main chat tier changes
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
  // The room-list "Finish creating" card triggers this; index.html registers a
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
    _roomsLiveWired = true;
  }

  // --- Rooms-screen identity (top-right, left of Log out) ---
  // Shows the viewer's OWN full Matrix ID plus a copy button, so they can copy
  // it from the room selector (e.g. to send to an owner for an invite) without
  // first entering a room. This is the SAME deliberate, scoped exception to the
  // "display names only" rule used by the main header (docs/main/02-architecture.md /
  // docs/main/07-security.md): it is always the viewer's own id, never another user's. Reads
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
    renderRoomsIdentity(); // viewer's own id + copy button, top-right of this screen
    // ── THE SAVES SECTION IS NO LONGER ON THE SELECTOR (v273) ─────────────────────────────
    // It described "the room you last opened" — a permanent list on a screen whose whole subject
    // is a CHOICE between rooms, so it was always about a room other than the one being looked at.
    // It renders inside the room now, from `renderSettings`, where its heading is true.
    const list = document.getElementById("room-list");
    if (!list) return;
    H.clear(list);

    const ownedRaw = (scanned && scanned.owned) || [];
    const joined = (scanned && scanned.joined) || [];
    const invited = (scanned && scanned.invited) || [];

    // An interrupted creation (this or a prior session) — its half-built space
    // already shows up in `owned`, so pull it out and present it as a dedicated
    // "Finish creating" entry instead, to avoid a broken double-listing.
    const pending = (Room.pendingCreate && Room.pendingCreate()) || null;
    const owned = pending ? ownedRaw.filter(r => r.spaceId !== pending.spaceId) : ownedRaw;

    if (!pending && owned.length === 0 && joined.length === 0 && invited.length === 0) {
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

    // ── "SAVES" BESIDE EACH ROOM, AND IT OPENS THE ROOM (browser run) ────────────────────────
    // The ask was a per-room list of that room's saves. **DRIVEN, AND IT CANNOT EXIST.**
    // `Floor._seen` holds exactly ONE room's checkpoints — `Floor.reset()` runs on room ENTRY and
    // never on leave — and a checkpoint SEED carries no room id at all (measured: its keys are
    // `members settings settingsFrom tick nowPlaying liveDecl ledger`). So a held checkpoint
    // cannot be attributed to a room by inspection, and a per-row list would serve one room's
    // saves under another room's name. `features/room.js` already recorded that: *"offering the
    // export per room-row would silently serve one room's state under another room's name."*
    //
    // A list that quietly showed the open room's saves is a PLAUSIBLE VALUE WITH A SCROLLBAR, a
    // shape this tree has recorded more than once. So the button does the one honest thing: it
    // OPENS the room, and the export section — which is true of the open room — becomes reachable
    // and correct. The label promises what it does and nothing more.
    // ── TWO BUTTONS: OPEN, AND SAVES WITH A DESTINATION ───────────────────────────────────
    // The ask has been raised three times and twice answered "a menu is impossible". **The ask was
    // never a menu** — it was reaching a room's saves in ONE CLICK from the selector. The
    // impossibility is real and does not block that: a per-room LIST on the selector cannot exist,
    // because `Floor._seen` holds one room's checkpoints and a seed carries no room id. A button
    // with a DESTINATION can, and `Open` already navigates.
    //
    // So `Saves` opens the room AND lands on its saves section, exactly as `Open` opens the room
    // and lands where a room normally opens. One control, one destination, and the label promises
    // a place rather than a list.
    function openButton(room) {
      const b = H.el("button", { class: "btn-secondary room-open-btn", text: "Open",
        title: "Open this room" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        _savesWanted = null;
        openRoom(room);
      };
      return b;
    }
    function savesButton(room) {
      const b = H.el("button", { class: "btn-secondary room-saves-btn", text: "Saves",
        title: "Open this room and go to the saves it holds" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        // The DESTINATION, carried across the navigation. `enterMainScreen` reads it once the
        // room's settings have rendered — which is the only point at which the saves section
        // exists, because it is built by `renderSettings`.
        _savesWanted = room.spaceId || null;
        openRoom(room);
      };
      return b;
    }

    section("Your rooms", owned, (room) => {
      // ── THE WRAPPER CARRIES THE LOOK; THE CHILD INHERITS IT ───────────────────────────────
      // `.room-item` is a themed row AND, one section down, a bare clickable button — one class in
      // two roles. When v270 wrapped it to add a Saves control, the wrapper kept the theme and the
      // inner `<button>` got only `flex`/`text-align`, so **the browser's default chrome won** and
      // the row rendered white. Same defect as `.dm-input` one release earlier, introduced by that
      // restructure.
      //
      // FIXED AT THE CAUSE RATHER THAN BY PATCHING ONE RULE: the WRAPPER is the row, so the
      // wrapper keeps the look and `.room-item-main` is declared as inheriting — transparent,
      // `color: inherit`, `font: inherit`, no border. The alternative (moving the theme onto the
      // child) would have left the wrapper unstyled and the Saves button sitting outside the row's
      // background, which is the same defect one element over.
      const row = H.el("div", { class: "room-item room-with-saves" });
      const btn = H.el("button", { class: "room-item-main" }, [room.name || room.spaceId]);
      btn.appendChild(H.el("span", { class: "room-badge-owner", text: "owner" }));
      btn.onclick = () => openRoom(room);
      row.appendChild(btn);
      row.appendChild(openButton(room));
      row.appendChild(savesButton(room));
      return row;
    });

    section("Joined rooms", joined, (room) => {
      const btn = H.el("button", { class: "room-item" }, [room.name || room.spaceId]);
      btn.onclick = () => openRoom(room);
      return btn;
    });

    section("Pending invites", invited, (room) => {
      const row = H.el("div", { class: "room-item room-invite-row" });
      row.appendChild(H.el("span", { class: "room-invite-name", text: room.name || room.spaceId }));
      const acceptBtn = H.el("button", { class: "btn-primary room-accept-btn", text: "Accept" });
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

  // ── EXPORT A HELD CHECKPOINT (J26) ───────────────────────────────────────────────────────
  // The checkpoints this client holds, grouped by the rank that authored them, each labelled with
  // its own server timestamp. Pick one; save it as a file.
  //
  // WHY THIS IS ONE SECTION AND NOT A BUTTON PER ROOM ROW. The held list belongs to the room this
  // client last ENTERED — `Floor` is cleared on room entry, never on leave — and a checkpoint seed
  // carries no room id, so nothing in the file says which room it came from. Hanging the control
  // off a room row would offer one room's state under another room's name. The section names its
  // room instead, and disappears when nothing is held.
  //
  // ABSOLUTE TIMES ONLY, AND THIS IS NOT A STYLE CHOICE. `at` is a homeserver stamp. Rendering it
  // as a date is a display transformation of a server value; rendering it as "2 hours ago" would
  // be `Date.now() - at`, a device clock subtracted from a server stamp, which is P2 exactly — in
  // a label whose whole purpose is to be compared against what another client shows. An absent
  // stamp is stated as unknown rather than filled in from the local clock.
  function _fmtStamp(at) {
    if (typeof at !== "number") return "time unknown";
    try { return new Date(at).toLocaleString(); } catch (e) { return "time unknown"; }
  }
  function _exportFilename(roomName) {
    const slug = String(roomName || "room").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
    return "ddjp-checkpoint-" + slug + ".json";
  }
  function _downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = H.el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 4000);
  }

  // Which room the person asked for saves on. Recorded so the empty case can say *that room has
  // none* rather than the generic *open a room* — two different facts, and telling somebody the
  // second when the first is true reads as the control not working.
  let _savesWanted = null;

  function renderExportSection() {
    // ── THE RENDERER MOVED AT v273 AND THE CONTAINER DID NOT ────────────────────────────────
    // `#export-section` is the last child of `screen-rooms`, so `renderSettings` was filling a
    // node that physically lives on the ROOM SELECTOR — and setting `display: flex` on it, which
    // made a section headed "Held from <room>" appear permanently underneath the room list the
    // moment anybody opened a room's settings once. **The move reached the caller and not the
    // DOM**, which is why the owner still saw a list underneath: not a stale second render, and
    // not a path that was missed — a half-move, and the half that shows is the one that stayed.
    //
    // The section is BUILT INTO THE SETTINGS PANEL now and the id travels with it, so there is one
    // node and it is where the thing it describes is true. `#export-section` stays in the document
    // as an empty mount that nothing fills, because `check-import` pins its POSITION between
    // `create-room-section` and the row below it — moving the markup would break an unrelated
    // guard's premise for a reason that has nothing to do with imports.
    let box = refs.settingsExport;
    if (!box) {
      if (!refs.settingsBox) return;
      box = refs.settingsExport = H.el("div", { class: "export-section" });
      refs.settingsBox.appendChild(box);
    }
    H.clear(box);   // CLEARS ITSELF, so it is safe from every call site rather than trusting each one
    const info = (Room.heldCheckpoints && Room.heldCheckpoints()) || { room: null, held: [] };
    const held = info.held || [];
    // ── NOTHING HELD IS NOT AN ERROR, AND IT IS NO LONGER SILENT ───────────────────────────
    // It used to `display: none`, which is why a browser run reported "no save control exists":
    // the section is hidden until a room has been opened once, and the owner never saw it. An
    // empty section that SAYS it is empty is reachable; a hidden one is indistinguishable from an
    // absent feature — and it was, for as long as anybody looked.
    box.style.display = "flex";
    if (!held.length) {
      box.appendChild(H.el("h3", { class: "room-section-title", text: "Saves" }));
      box.appendChild(H.el("p", { class: "muted", text: _savesWanted
        ? "That room has no saved checkpoints yet."
        : "Open a room to see the saves it holds. This client keeps them for one room at a time." }));
      return;
    }

    box.appendChild(H.el("h3", { class: "room-section-title", text: "Saves" }));
    // ── THE LABEL IS TRUE OF WHAT IT LISTS, WHICH IS THE WHOLE CONSTRAINT ───────────────────
    // `heldCheckpoints()` returns the room the list is OF, and it is the only place that answer
    // exists — so the heading names it rather than saying "the room you last opened", which is
    // true and tells a reader nothing about whether it is the room they just clicked.
    box.appendChild(H.el("p", { class: "muted", text: info.room
      ? "Held from " + (info.room.name || info.room.spaceId)
      : "Held from the room you last opened" }));

    // GROUPED BY THE RANK THAT AUTHORED THEM. The rank arrives as a NAME — the backend resolves it,
    // because outside the backend a rank is a name and never a level to compare.
    const groups = new Map();
    for (const cp of held) {
      const key = cp.rank || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cp);
    }
    const note = H.el("p", { class: "muted" });

    for (const [rank, list] of groups) {
      box.appendChild(H.el("h4", { class: "room-section-title", text: rank }));
      // Newest cut first, by POSITION — the same key the chain fold uses, never the author's own
      // seal counter, which is incomparable across authors.
      list.slice().sort((a, b) => (b.floorL || 0) - (a.floorL || 0)).forEach((cp) => {
        const row = H.el("div", { class: "room-item room-invite-row" });
        row.appendChild(H.el("span", { class: "room-invite-name",
          text: _fmtStamp(cp.at) + (cp.thin ? " · thin" : "") }));
        const btn = H.el("button", { class: "btn-secondary room-accept-btn", text: "Save" });
        btn.onclick = () => {
          const out = Room.exportCheckpoint(cp.id);
          if (!out || !out.ok) {
            note.textContent = "Could not export: " + ((out && out.reason) || "unknown");
            return;
          }
          _downloadJson(out.file, _exportFilename(info.room && info.room.name));
          // Said AFTER the fact only as confirmation; the same fact is stated before the click by
          // the line below, because whether the file can be imported is knowable without paging.
          // THE REASON CHANGED AT J27 AND THE OLD ONE WAS WRONG, not merely wordy. It said a peer
          // file needs "a chain of at least two", which is what `readFile` asks when the reader
          // holds the joining log. An importer creating a room holds none of it, so a peer file is
          // refused however long its chain — the fix is a different file, never a longer one.
          note.textContent = out.importable
            ? "Saved — " + out.snapshots + " snapshot(s)."
            : "Saved — but a room cannot be created from this file: it was authored by "
              + (out.rank || "a peer") + ", and a peer's checkpoint is verified by folding the log "
              + "between its snapshots, which a brand-new room does not have. Only an "
              + "owner-authored checkpoint can start a room.";
        };
        row.appendChild(btn);
        box.appendChild(row);
      });
    }
    box.appendChild(note);
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
      _pendingJoinId = null;   // cancel the pending swap; join may finish in the background
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
    H.clear(main);
    QueuePanels._resetStackScroll();   // a new room's queue starts at the top (scroll is preserved within a room)
    H.buildMainDom(main, room);

    // Wire feature callbacks. Each one only re-renders the affected region.
    // renderActivePanel joins these because the activity list is folded from the LOG, so it is
    // stale the moment anything enters it — and Queue.onStateChange is the re-derive announcement,
    // which is the one signal that fires for every event that reached the fold.
    // renderFeedPanel (J13) joins for exactly the same reason and through the same signal: it is
    // folded from the same log, so anything that re-derives the room has already changed it.
    Queue.onStateChange(() => { Player.renderNowPlaying(); ChatPanels._syncNpButtons(); QueuePanels.renderQueuePanel(); Roster.renderRoster(); Panels.renderActivePanel(); Panels.renderFeedPanel(); Roster.renderJoinBtn(); });
    Playback.onStateChange(Player.onPlaybackStateChange);
    // A deliberate hold must not look like a hang. Playback emits only on TRANSITIONS, so this
    // is not a poll — the advance path retries every tick and would otherwise fire constantly.
    Playback.onHoldChange((reason) => { H.reflectPlaybackHold(reason); });
    Chat.onMessage(ChatPanels.addChatMessage);
    Chat.onRedaction(ChatPanels.removeChatMessage);
    ChatPanels._wireDMPanel();   // J15 — the DM panel's own message + index listeners
    ChatPanels.renderDMPanel();  // paint the (usually empty) list and the badge on entry
    // Reflect the secure-chat banner now (crypto init has already run by the time we reach
    // the main screen) and keep it current with a light poll — crypto can recover (a retry
    // elsewhere) or lapse (token expiry) out of band, so the banner shouldn't be one-shot.
    H.reflectCryptoBanner();
    if (!_cryptoPollStarted) { _cryptoPollStarted = true; setInterval(() => { H.reflectCryptoBanner(); }, 5000); }
    // One-shot recent backfill for this room's chat (the room-settings default
    // channel; present-forward after). currentChatId is set by Room's wiring first.
    if (refs.chatBox) ChatPanels._backfillChatOnce(refs.chatBox);
    UserQueue.onChange(() => { if (H.queueTab() === "mine") QueuePanels.renderQueuePanel(); Roster.renderJoinBtn(); });
    // My ★/▲ latch is derived from my own vote/add events on the spine. Those don't move
    // consensus state (the reducer ignores them), so the Queue.onStateChange render above
    // won't fire when they replay on reload — this re-presses the buttons when the latch
    // is (re)built from history, and on any live echo.
    if (typeof Reactions !== "undefined" && Reactions.onChange) {
      Reactions.onChange(() => { ChatPanels._syncNpButtons(); if (H.queueTab() === "room") QueuePanels.renderQueuePanel(); });
    }
    Room.onRankChange(() => { Roster.renderMyRank(); Roster.renderRoster(); Panels.renderActivePanel(); Panels.renderFeedPanel(); QueuePanels.renderQueuePanel(); Roster.renderUpgradePanel(); Settings.renderSettings(); });
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
      // If the main chat tier changed, clear the chat box so we don't mix tiers.
      // J12 — A MAIN-TIER CHANGE NO LONGER DESTROYS ANYTHING. This line used to call
      // `_resetChatState`, which replaced the single buffer and lost every message in it
      // permanently (chat is RAM-only; the only recovery is a ten-message backfill). The buffers
      // are now per tier and survive, so a main-tier change repaints from the tier the resolver
      // now points at and the old tier's messages are still there when you switch back.
      if (s && s.chat !== _lastChatTier) {
        _lastChatTier = s.chat;
        try { Room.applyChatTiers(); } catch (e) {}
        if (refs.chatBox) {
          try { refs.chatBox._chatTier = Room.chatTiers().activeTier; } catch (e) {}
          ChatPanels._repaintChat(refs.chatBox);
        }
        ChatPanels._renderChatTierStrip();
      }
      Player._bgOnSetting(_bg.roomId, (s && s.bg) || null);   // react to a background link change (debounced)
      Settings.renderSettings();
    });

    Roster.renderMyRank();
    Player.renderNowPlaying();
    QueuePanels.renderQueuePanel();
    Roster.renderRoster();
    Panels.renderActivePanel();
    Panels.renderFeedPanel();
    // J12 — seed the visible tier from the resolver before the strip is drawn, so the box knows
    // which buffer it is showing from the first paint rather than from the first message.
    try { if (refs.chatBox) refs.chatBox._chatTier = Room.chatTiers().activeTier; } catch (e) {}
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
    // ── LAND ON THE SAVES, IF THAT IS WHERE THE PERSON WAS GOING ──────────────────────────
    // `Saves` on the selector carries a DESTINATION, and this is the only place it can be honoured:
    // the saves section is built by `renderSettings`, which has just run. Cleared as it is read, so
    // a later ordinary open does not jump somewhere nobody asked for.
    if (_savesWanted) {
      _savesWanted = null;
      try {
        H.setRightTab("roomset");
        H._relockAllPanels();
        QueuePanels.renderRightPanel();
        if (refs.settingsExport && refs.settingsExport.scrollIntoView) {
          refs.settingsExport.scrollIntoView({ block: "start" });
        }
      } catch (e) { Logger.warn("UI: could not land on the saves section — " + (e && e.message)); }
    }
    Player._applyDisplayDims();   // push the saved dim levels onto the CSS vars for this entry
    Settings.renderChatSettings();
    QueuePanels._renderGear();
    _lastChatTier = Room.getSettings().chat;
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
  // Render into #screen-encryption. These never touch the SDK — index.html passes
  // callbacks that do the MatrixBridge work; these methods collect input, enforce
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
    showScreen, renderRoomList, renderExportSection, setCreateRoomVisible, enterMainScreen,
    showEnterRecoveryKey, showResetWarning, showSaveNewKey, showAccounts,
    setRoomListBusy, setResumeHandler, openRoom,
  };
})();
