// ui/shell.js
// THE MAIN SCREEN · LAYOUT · MISCLICK LOCKS · MODULE STATE · `_bgLeaveRoom` — the last of the ten
// files roles.md §5 records, extracted at ddjp_397. `ui/interface.js` no longer exists.
//
// ── CUT LAST, AND THE REASON HELD ────────────────────────────────────────────────────────────
// This file holds `buildMainDom` and 202 of the `refs` assignments: it is the WRITER every other
// ui/ file reads. Extracting it while nine readers were still inside one file would have made
// every one of those a seam to negotiate. Cut once the readers were already out, the seam is a
// destructure and a publish.
//
// ── `_bgLeaveRoom` CAME FROM INSIDE `MODULE STATE` ──────────────────────────────────────────
// A function sitting among the declarations, left there at ddjp_386 when the player cluster went.
// It is room TEARDOWN and it owns the locks below, so it is this file's — the partition finding
// one last time: **the banner is a reading aid; the cluster is an ownership unit.**
//
// ── THE PRIMITIVES ARE DESTRUCTURED, NOT REWRITTEN ──────────────────────────────────────────
// `el`, `clear`, `RANKS` and the rest live in ui/base.js now. They are bound to local names below
// so that every call in the moved code reads exactly as it did — a rewrite of hundreds of call
// sites would have been hundreds of chances to get a call SHAPE wrong, which is the fragile kind.
//
// Depends on: UIBase, and every other ui/ file at call time.

const Shell = (() => {

  const { refs, _bg, _ytVol, volumeState } = UIBase;
  const H = UIBase.host;
  // MEASURED, not guessed: these are the only names from ui/base.js the moved code actually uses.
  // The first version of this line destructured everything the old published seam carried and
  // `no-unused-vars` refused thirteen of them — a destructure is a DECLARATION, so importing what
  // you might need is the same defect as declaring what you do not use.
  const { el, clear, copyButton } = H;
  const SKIP_NOTE_CLEAR_MS = H.SKIP_NOTE_CLEAR_MS();   // `_LOCK_UNLOCK_MS` is declared below, here

  // ══ MODULE STATE
  //
  // Every mutable value in this file, gathered. A render reads these live, so a render is never
  // purely a function of backend state.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- module-level refs (built in enterMainScreen) ---
  // Preview (mini-player, 14 §7) — a LOCAL-only player takeover. While active the
  // main player pauses in place and onPlaybackStateChange stops driving it (keeps
  // tracking via _lastNp). No protocol event is ever sent from here.
  let queueTab = "room";   // "room" | "mine" | "history" | "playlists"
  let rightTab = "chat"; // "chat" | "dm" | "people" | "feed" | "roomset" | "gear"
  let gearTab = "logs";  // sub-tab within the gear panel: "logs" | "settings"
  // Playlists panel (14 §5 / P3). The panel is two-level: the LIBRARY (list of
  // playlists) or INSIDE one playlist (its tracks). Transient per-row UI state
  // (which row is armed for a two-step delete, which is being renamed) lives here
  // so it survives the panel's full re-render on a Playlists.onChange.
  let _uqConfirmClear = false;  // My-Queue "Clear" armed for its two-step inline confirm
  // The now-playing ★ (save to a playlist) and ▲ (upvote) affordances are backed by the
  // Reactions feature module, keyed by PLAY-INSTANCE (not videoId): pressing emits a
  // spine event (ddjp.dj.save / ddjp.dj.vote) and latches the button "on" for the current
  // song; it goes live again when the song changes. The star opens the same add-to-
  // playlist picker as History's ＋, and only latches if a track was actually added. Both
  // affordances appear in two places (the player bar + the room-queue now-playing row) and
  // read the same Reactions state, so pressing one reflects in the other. No UI-local
  // pressed-state is kept here — the module is the single source of truth.
  let layoutMode = "wide";   // "wide" | "compact" | "phone" — the layout selector (header button)
  // Per-song commit-bar countdown anchors (videoId -> ms when it entered "pending").
  // The UserQueue settle timer is queue-wide and resets on ANY edit; keying the bar
  // to the song instead means an unrelated edit can't restart a song that didn't
  // change — only a newly-pending song starts from zero.
  let phonePane = "player";  // which single pane shows in phone mode: "queues" | "player" | "social"
  let compactSide = "social"; // compact mode's switchable panel: "social" (chat/people) | "queues"
  let _layoutMenuCloserWired = false;  // document click-to-close handler registered once
  // Skip / Leave locks (local-only, view-only). Both DEFAULT to LOCKED and
  // auto-relock: a click unlocks the action for _LOCK_UNLOCK_MS while a small timer
  // bar fills left→right under the button, then it re-locks itself. Clicking again
  // while unlocked re-locks immediately. Never a protocol event.
  let _skipLocked = true;    // local-only: when true, the Skip button is inert (clicking does nothing)
  let _leaveLocked = true;   // local-only: when true, the Leave-the-DJ-queue button is inert
  const _LOCK_UNLOCK_MS = 5000;
  const _lockTimers = { skip: 0, leave: 0, roomq: 0 };   // pending auto-relock setTimeout handles
  // Room-queue master lock (like Skip: a click unlocks for _LOCK_UNLOCK_MS with a timer
  // bar, then auto-relocks; also relocks on any tab change). While locked the per-row
  // controls (placeholders) and "Reset rotation" are inert. View-only, no protocol.
  let _roomqLocked = true;
  let _roomqUnlockAt = 0;   // Date.now() at unlock — lets the timer bar resume across re-renders
  // Playlists-tab and My-Queue-tab master locks (NON-timed, like the settings lock):
  // locked by default, re-lock on any tab change (queue tabs + right-panel tabs).
  // While locked, the playlist rename/delete and the My-Queue "Clear" can't even be armed.
  let _plLocked = true;
  let _uqLocked = true;
  // Room-settings master lock (owner-only, local-only, view-only). Like skip/leave it
  // DEFAULTS to LOCKED and re-locks whenever the owner (re-)enters the Room settings tab,
  // so a stray click can't change room config. UNLIKE skip/leave there is NO timed
  // auto-relock: once the owner unlocks, settings stay editable until they lock again or
  // leave the tab. When locked, every settings control is inert.
  let _settingsLocked = true;
  // Same master-lock idea for the ⚙ gear -> Settings sub-tab (per-user display
  // prefs). Locked by default, re-locked on every entry to the Settings sub-tab,
  // NO timed auto-relock — exactly like the Room-tab lock above, just guarding
  // accidental changes rather than owner-only config. When locked, every pref
  // control is inert.
  let _prefsLocked = true;
  // Header responsive shrinker state. The header shrinks in PRIORITY order when it
  // overflows: server part of @user:server dies first, then username, then rank,
  // then room title (always >=1 char), then the back button collapses to an arrow.
  // The copy buttons, layout button, and avatar never shrink.
  const _headerFit = { fullId: "", fullRank: "", level: 0, ro: null };
  let _marqueeRo = null;
  let _roomTitleRo = null;   // ResizeObserver on the title box — re-fits the marquee on width changes (window resize, layout switch)
  let _marqueeRaf = 0;     // pending rAF handle, so rapid resize/RO bursts coalesce to one fit
  let _reflectCryptoBanner = null;   // set in buildMainDom; shows/hides the "secure chat offline" banner from Chat.cryptoReady()
  let _reflectPlaybackHold = null;   // set in buildMainDom; shows/hides the "catching up / waiting for history" banner from Playback.onHoldChange
  // --- shared with every extracted ui/ file, and OWNED BY ui/base.js ---------
  // `refs` and these three objects are read and written on both sides of the split, so
  // they live in ui/base.js and both files bind the SAME object here. Not a copy: a
  // second `refs` would be two tables describing one screen.
  // (the UIBase alias that lived here is at the top of this file now)



  // ROOM TEARDOWN, and it stays HERE rather than going to ui/player.js with its banner.
  // Owner ruling at ddjp_386: the banner is a reading aid, the cluster is an ownership
  // unit. This function owns teardown of the misclick locks below and the thumbnail
  // observer, so it belongs with them; the background half of it reaches into
  // ui/player.js for `_bgUnpaint`, which is the whole of the reverse dependency and is
  // named in that file's header too.
  function _bgLeaveRoom() {
    if (_bg.timer) { clearTimeout(_bg.timer); _bg.timer = null; }
    _bg.seq++;
    _bg.roomId = null;
    Player._bgUnpaint();
    // Stop the two-way volume poll — the player is going away; it restarts on the
    // next player-ready. (Was previously left running after leaving a room.)
    if (_ytVol.pollTimer) { clearInterval(_ytVol.pollTimer); _ytVol.pollTimer = null; }
    if (_marqueeRo) { try { _marqueeRo.disconnect(); } catch (e) {} _marqueeRo = null; }
    if (_marqueeRaf) { cancelAnimationFrame(_marqueeRaf); _marqueeRaf = 0; }
    PlaylistPanels._thumbReset();                                  // disconnect the thumbnail viewport observer + clear pending fetches
    if (_lockTimers.skip)  { clearTimeout(_lockTimers.skip);  _lockTimers.skip = 0; }
    if (_lockTimers.leave) { clearTimeout(_lockTimers.leave); _lockTimers.leave = 0; }
    if (_lockTimers.roomq) { clearTimeout(_lockTimers.roomq); _lockTimers.roomq = 0; }
    _skipLocked = true; _leaveLocked = true;   // next room entry starts locked
    _roomqLocked = true; _roomqUnlockAt = 0; _plLocked = true; _uqLocked = true;
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ LAYOUT
  //
  // Wide, compact and phone. The header text-ladder and the pane-nav placement.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Layout selector -------------------------------------------------------
  // Three layouts, all driven by a data-layout attribute on .columns plus a
  // data-pane attribute for phone mode — PURE CSS visibility/sizing. The player
  // iframe (#yt-player) is NEVER unmounted or moved between modes; switching only
  // toggles what's shown, so playback continues even when the player pane is
  // hidden (phone mode). This is the hard constraint: re-rendering or relocating
  // the player node would tear down the YouTube iframe and stop the music.
  //   • wide    — three columns side by side (the default).
  //   • compact — queues + player share the left/main area; chat/people stays.
  //   • phone   — one pane at a time (queues | player | social), 3 buttons up top.
  // The active mode is a per-device view preference, not a room/protocol setting.
  const LAYOUTS = [
    { id: "wide",    label: "Wide",    icon: "▭▭▭", hint: "Three columns" },
    { id: "compact", label: "Compact", icon: "▭▭",  hint: "Player + chat or queues" },
    { id: "phone",   label: "Phone",   icon: "▮",   hint: "One pane at a time" },
  ];

  function _applyLayout() {
    if (refs.columns) {
      refs.columns.setAttribute("data-layout", layoutMode);
      refs.columns.setAttribute("data-pane", phonePane);
      refs.columns.setAttribute("data-compact-side", compactSide);
    }
    _renderPaneNav();   // rebuild the bar's buttons for the mode + active pane
    _placePaneNav();    // move the (stateless) bar to the right slot for the mode
    Roster.renderJoinBtn();    // re-label Join/Leave for the mode (full text ↔ JQ/LQ on phone)
    if (typeof Player._fitAllMarquees === "function") Player._fitAllMarquees();   // title box widths change per mode
    if (PlaylistPanels.previewActive()) PlaylistPanels._positionPreview();   // keep an open preview pinned to its column across a layout switch
  }

  function _setLayout(mode) {
    if (!LAYOUTS.some(l => l.id === mode)) return;
    layoutMode = mode;
    try { ChatPrefs.setLayout(mode); } catch (e) {}   // remember it for next login (device-local)
    _applyLayout();
    if (refs.layoutMenu) refs.layoutMenu.style.display = "none";
  }
  // Entering the social pane via the top pane switcher ("Chat") always lands on the CHAT
  // sub-tab — not whatever sub-tab (People / Room / ⚙) was last open — so the labelled
  // "Chat" button does what it says. Reset + repaint the right panel before switching pane.
  function _setPhonePane(pane) { if (pane === "social") { rightTab = "chat"; QueuePanels.renderRightPanel(); } phonePane = pane; _applyLayout(); _relockAllPanels(); }
  function _setCompactSide(side) { if (side === "social") { rightTab = "chat"; QueuePanels.renderRightPanel(); } compactSide = side; _applyLayout(); _relockAllPanels(); }

  // Apply one shrink level to the header (idempotent for a given level).
  function _applyHeaderLevel(n) {
    const idEl = refs.myIdBadge, rankEl = refs.rankBadge, backBtn = refs.backBtn, title = refs.roomTitle;
    const full = _headerFit.fullId || "";
    const at = full.indexOf(":");
    const userPart = at > 0 ? full.slice(0, at) : full;   // @user (no :server)
    // L1+: drop the :server from the id.
    if (idEl) idEl.textContent = (n >= 1 && userPart) ? userPart : full;
    // L2+: let the username ellipsis-truncate (tighten its max-width via a class).
    if (idEl) idEl.classList.toggle("fit-tight", n >= 2);
    // L3+: shrink the rank badge — keep it visible but allow truncation.
    if (rankEl) rankEl.classList.toggle("fit-tight", n >= 3);
    // L4+: truncate the room title harder (still >=1 char via CSS min-width).
    if (title) title.classList.toggle("fit-tight", n >= 4);
    // L5+: nothing left to collapse. The button is `copy-btn icon-only`, which is a fixed 26px
    // square from L0 — it is already at its minimum before the ladder reaches this rung, so the
    // old `collapsed` toggle would have been a class that changed nothing. Removed rather than
    // left in place, because a ladder step that does nothing reads as a step that works.
    if (backBtn) backBtn.textContent = "\u2190";
  }

  // Progressively shrink the header until it stops overflowing (or we run out of
  // levels). Measures scrollWidth vs clientWidth on the header row.
  function _fitHeader() {
    const header = refs.mainHeader;
    if (!header) return;
    const MAX = 5;
    // Start from nothing-shrunk and step up only as needed.
    let n = 0;
    _applyHeaderLevel(0);
    // overflow check: add levels while the content is wider than the box.
    while (n < MAX && header.scrollWidth > header.clientWidth + 1) {
      n += 1;
      _applyHeaderLevel(n);
    }
    _headerFit.level = n;
  }

  // The header control: a single icon button that opens a tiny 3-option popover.
  // Costs one button in the existing header — never a column or floating overlay,
  // so it takes no layout space and is reachable in every mode.
  function _buildLayoutSelector() {
    const btn = el("button", { class: "layout-btn icon-only", title: "Layout", text: "⊞" });
    const menu = el("div", { class: "layout-menu" });
    menu.style.display = "none";
    LAYOUTS.forEach(l => {
      const item = el("button", { class: "layout-menu-item" }, [
        el("span", { class: "layout-menu-icon", text: l.icon }),
        el("span", {}, [el("div", { class: "layout-menu-label", text: l.label }),
                        el("div", { class: "layout-menu-hint", text: l.hint })]),
      ]);
      item.onclick = (e) => { e.stopPropagation(); _setLayout(l.id); };
      menu.appendChild(item);
    });
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = (menu.style.display === "none") ? "flex" : "none";
    };
    // Close on any outside click. Registered ONCE for the lifetime of the module
    // (guarded by _layoutMenuCloserWired) so repeated room entries don't stack
    // duplicate document listeners.
    if (!_layoutMenuCloserWired) {
      document.addEventListener("click", () => {
        if (refs.layoutMenu && refs.layoutMenu.style.display !== "none") refs.layoutMenu.style.display = "none";
      });
      _layoutMenuCloserWired = true;
    }
    refs.layoutMenu = menu;
    return el("div", { class: "layout-selector" }, [btn, menu]);
  }

  // The higher-level pane nav — built ONCE as a buttons-only bar that lives in
  // the top slot (above the columns) for both compact and phone; hidden in wide.
  // It behaves like the settings sub-bar, but as a tier ABOVE the natural bars.
  // Compact and phone are just "wide, filtered": the buttons toggle which of the
  // three existing columns are visible — nothing renders, moves, or rebuilds. So
  // chat (RAM-only) and the player iframe are never touched, and switching
  // layouts or panes never drops chat or stops playback.
  //   • wide    — not shown (the natural tabs suffice; all three columns show).
  //   • compact — Chat | Queues: player column always shown + the selected one of
  //               (chat column, queue column).
  //   • phone   — Queues | Player | Chat: exactly one column shown at a time
  //               (like wide, one section at a time).
  function _buildPaneNav() {
    const bar = el("div", { class: "pane-nav" });
    refs.paneNav = bar;
    return bar;
  }

  function _renderPaneNav() {
    const bar = refs.paneNav;
    if (!bar) return;
    clear(bar);

    if (layoutMode === "wide") { bar.style.display = "none"; return; }
    bar.style.display = "flex";

    let items, active, onPick;
    if (layoutMode === "phone") {
      // Phone = wide, but one of the three sections at a time. The bar simply
      // picks which single column shows; each section keeps its own inner bars.
      items = [["queues", "Queues"], ["player", "Player"], ["social", "Chat"]];
      active = phonePane;
      onPick = (id) => _setPhonePane(id);
    } else { // compact
      items = [["social", "Chat"], ["queues", "Queues"]];
      active = compactSide;
      onPick = (id) => _setCompactSide(id);
    }
    for (const [id, label] of items) {
      const b = el("button", { class: "pane-nav-btn" + (id === active ? " active" : ""), text: label });
      b.onclick = () => onPick(id);
      bar.appendChild(b);
    }
  }

  // Put the (stateless) bar inside the mount of the square it controls, so it
  // rides INSIDE the active/visible square — never floating above, never inside a
  // hidden one. Phone: the active column's mount. Compact: the combined
  // chat/queues square's mount (whichever of the two is currently shown). Wide:
  // not mounted anywhere visible (the bar is hidden via CSS).
  function _placePaneNav() {
    const bar = refs.paneNav;
    if (!bar) return;
    let mount = null;
    if (layoutMode === "phone") {
      mount = (phonePane === "queues") ? refs.queueBarMount
            : (phonePane === "player") ? refs.playerBarMount
            : refs.rightBarMount;
    } else if (layoutMode === "compact") {
      // The bar belongs to the combined chat/queues square — mount it in whichever
      // of the two is visible right now.
      mount = (compactSide === "queues") ? refs.queueBarMount : refs.rightBarMount;
    }
    if (mount && bar.parentNode !== mount) mount.appendChild(bar);
    // Wide: leave the bar wherever; it's hidden via CSS (_renderPaneNav).
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ THE MAIN SCREEN
  //
  // buildMainDom builds the whole main screen in one function. By some way the largest thing in
  // this file.
  // ────────────────────────────────────────────────────────────────────────────────────────

  function buildMainDom(main, room) {
    // Header: back, room title (+ room code next to it), upgrade slot, my identity on the right.
    // ── SQUARE, BY BORROWING THE COPY BUTTON'S SHAPE (browser run) ─────────────────────────
    // `.back-btn.collapsed` set `width: 32px; padding: 6px 0` with NO height, so the box was sized
    // by the arrow's line-height and came out oblong and borderless beside the copy buttons it
    // sits next to. `.copy-btn.icon-only` already solves exactly this — both dimensions explicit,
    // flex-centred, bordered — so this borrows it rather than adding a FOURTH button style.
    // The box is 26px and the arrow is sized to fit it, not the other way round.
    //
    // ORDER MATTERS AND IS WHY NO NEW RULE IS NEEDED: `.copy-btn` and `.copy-btn.icon-only` are
    // declared AFTER `.back-btn` in `index.html`, so their background, border and box win on
    // source order at equal specificity. `.back-btn` still supplies `flex-shrink` and the cursor.
    //
    // THE OTHER CALLER IS UNTOUCHED: `← Rooms` on the loading screen keeps the wide pill, because
    // it has a WORD in it and a 26px square would clip it. Two callers, one changed.
    const backBtn = el("button", { class: "back-btn copy-btn icon-only", text: "\u2190" });
    backBtn.onclick = () => { _bgLeaveRoom(); Screens.showScreen("screen-rooms"); Screens.renderRoomList(Room.scanDDJPRooms()); };
    refs.backBtn = backBtn;

    // The room's Matrix space id is intentionally NOT shown as text (it's long and noisy);
    // the copy button beside the title still copies it for invites/sharing.
    const copyIdBtn = copyButton("⧉", () => room.spaceId || "", "copy-btn copy-id-btn icon-only", "Copy room ID");
    // A BOX AND AN INNER TEXT NODE, the same shape `videoTitle`/`videoTitleText` has — the marquee
    // translates the TEXT inside a clipping BOX, so a bare `<h2>` has nothing to move.
    refs.roomTitleText = el("span", { class: "room-title-text", text: room.name || room.spaceId });
    refs.roomTitle = el("h2", { class: "room-title" }, [refs.roomTitleText]);
    const titleGroup = el("div", { class: "title-group" }, [
      refs.roomTitle,
      copyIdBtn
    ]);

    // NOTE — deliberate, scoped exception to the "display names only" rule
    // (docs/main/07-security.md): this shows the CURRENT USER's OWN full
    // Matrix ID, never another user's. Every other surface (roster, chat
    // sender, etc.) still shows display names only — this is a one-off,
    // explicitly requested override for the viewer's own identity, not a
    // general relaxation of the rule.
    // The viewer's own Matrix id is intentionally NOT shown as text anymore — the
    // copy-invite button beside the rank badge still copies it (for getting invited).
    // refs.myIdBadge stays defined (renderMyRank / the header shrinker reference it,
    // both null-guarded) but is not placed in the header.
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
    const myIdentity = el("div", { class: "my-identity" }, [refs.myAvatarSlot, refs.avatarNote, refs.rankBadge, copyInviteBtn]);

    const header = el("div", { class: "main-header" }, [
      backBtn,
      titleGroup,
      _buildLayoutSelector(),                                    // sits right beside the room-ID copy button
      refs.upgradeSlot = el("div", { class: "upgrade-slot" }),   // upgrade (when shown) to the RIGHT of the layout button
      myIdentity
    ]);
    refs.mainHeader = header;

    // Now-playing: video title (left) + Skip (right) above the embed; a
    // controls row below it with join/leave (left), reset (middle), and
    // volume/mute (right).
    refs.videoTitleText = el("span", { class: "video-title-text" });
    refs.videoTitle = el("span", { class: "video-title" }, [refs.videoTitleText]);
    refs.skipBtn = el("button", { class: "skip-btn", text: "⏭ Skip" });
    refs.skipBtn.onclick = async () => {
      if (_skipLocked) return;   // lock engaged — Skip is inert (local-only); the button itself doesn't change
      refs.skipBtn.disabled = true;
      if (refs.skipNote) refs.skipNote.textContent = "";
      try {
        const result = await Actions.perform("dj.skip");
        if (!result.ok && refs.skipNote) {
          refs.skipNote.textContent = result.reason || "Skip didn't go through";
          setTimeout(() => { if (refs.skipNote) refs.skipNote.textContent = ""; }, SKIP_NOTE_CLEAR_MS);
        }
      } catch (e) {
        Logger.warn(e.message);
        if (refs.skipNote) refs.skipNote.textContent = "Skip failed — try again";
      } finally {
        Player.renderNowPlaying();   // re-evaluate disabled state from real stream state
      }
    };
    // Skip lock (local-only): a square button the same height as Skip. Starts
    // LOCKED; a click unlocks Skip for 5s (timer bar fills left→right under the
    // button) then it auto-relocks. While locked, clicking Skip does nothing.
    refs.skipLockBtn = el("button", { class: "skip-lock-btn", title: "Click to unlock Skip" });
    refs.skipLockIco = el("span", { class: "lock-ico" });
    refs.skipLockBar = el("div", { class: "lock-timer" });
    refs.skipLockBtn.appendChild(refs.skipLockIco);
    refs.skipLockBtn.appendChild(refs.skipLockBar);
    refs.skipLockBtn.onclick = () => _onLockClick("skip");
    _renderSkipLock();
    refs.player = el("div", { id: "yt-player" });
    // A transparent click-shield over the player. Shown ONLY when nothing is actually
    // playing (consensus null/ended), it blocks YouTube's replay/poster controls so a
    // finished song can't be restarted locally in the main player (which would desync
    // from the room). Hidden whenever a real song is playing, so native controls work.
    refs.playerShield = el("div", { class: "player-shield" });
    refs.playerFrame = el("div", { class: "player-frame" }, [refs.player, refs.playerShield]);
    // Playback progress bar — thin button-blue fill that glides left→right with
    // the song. Display only (not a scrubber). Driven by a rAF loop seeded from
    // startedAt/duration, re-synced to the real elapsed on every playback tick.
    // PLAYBACK HOLD BANNER — mounted under the player, because that is what the user is looking
    // at when the music stops. A deliberate hold is indistinguishable from a hang unless it says
    // so. No button: there is nothing for the user to do, and offering an action would imply
    // otherwise. It clears itself when this client catches up or the gap fills.
    const _holdText = (r) => (r === "not-live")
      ? "\u23F3 Catching up with the room \u2014 playback resumes on its own."
      : "\u23F3 Waiting for missing history \u2014 playback resumes once it arrives.";
    refs.playbackHoldBanner = el("div", { class: "chat-crypto-banner", style: "display:none;" }, [
      el("span", { class: "ccb-text", text: "" })
    ]);
    _reflectPlaybackHold = (reason) => {
      if (!refs.playbackHoldBanner) return;
      refs.playbackHoldBanner.style.display = reason ? "flex" : "none";
      if (reason) {
        const t = refs.playbackHoldBanner.querySelector(".ccb-text");
        if (t) t.textContent = _holdText(reason);
      }
    };
    refs.progressFill = el("div", { class: "progress-fill" });
    refs.progressBar = el("div", { class: "progress-bar" }, [refs.progressFill]);
    refs.playerFrame.appendChild(refs.playbackHoldBanner);
    refs.npLabel = el("div", { class: "np-label muted" });

    // Join/Leave the DJ rotation — moved here from the personal-queue tab.
    refs.joinBtn = el("button", { class: "join-btn" });
    refs.joinBtn.onclick = () => {
      // The leave-lock only gates LEAVING (when active). Join is never gated.
      if (UserQueue.isActive()) {
        if (_leaveLocked) return;   // locked — Leave is inert; the button doesn't change
        UserQueue.leaveRoomQueue();
      } else {
        UserQueue.joinRoomQueue();
      }
      Roster.renderJoinBtn();
    };
    // Leave lock (local-only): a square button the same height as the join/leave
    // button, shown ONLY while in the queue (Leave mode). Starts LOCKED each time it
    // appears; a click unlocks Leave for 5s (timer bar fills left→right) then it
    // auto-relocks. While locked, clicking Leave does nothing.
    refs.leaveLockBtn = el("button", { class: "leave-lock-btn", title: "Click to unlock Leave" });
    refs.leaveLockIco = el("span", { class: "lock-ico" });
    refs.leaveLockBar = el("div", { class: "lock-timer" });
    refs.leaveLockBtn.appendChild(refs.leaveLockIco);
    refs.leaveLockBtn.appendChild(refs.leaveLockBar);
    refs.leaveLockBtn.onclick = () => _onLockClick("leave");
    refs.joinGroup = el("div", { class: "join-group" }, [refs.joinBtn, refs.leaveLockBtn]);

    // Refresh reloads the current video from the start in THIS browser only —
    // a local re-sync, not a protocol event. Does nothing to the room state.
    refs.resetBtn = el("button", { class: "reset-btn", text: "↻", title: "Reload this video (local only — doesn't affect the room)" });
    refs.resetBtn.onclick = () => { Player.reloadCurrentVideo(); };

    // Volume + mute — entirely local playback control, applied straight to
    // the YT.Player instance. Never a protocol event; nothing here is sent
    // to the room or other clients.
    refs.volumeSlider = el("input", { class: "volume-slider", type: "range", min: "0", max: "100", value: String(volumeState.level) });
    refs.volumeSlider.oninput = () => {
      volumeState.level = parseInt(refs.volumeSlider.value, 10);
      if (volumeState.level > 0) volumeState.muted = false;
      Player.applyVolumeState();
    };
    refs.muteBtn = el("button", { class: "mute-btn", text: "🔊" });
    refs.muteBtn.onclick = () => { volumeState.muted = !volumeState.muted; Player.applyVolumeState(); };

    // ★ save-to-playlist + ▲ upvote for the now-playing song, backed by Reactions
    // (see the note by the top-of-file state comment). They act on the current song and
    // reflect its latched add/vote state; disabled when nothing is playing. Same handlers
    // drive the room-queue now-playing row, so the two locations stay in step.
    refs.grabIco = el("span", { class: "np-ico", text: "\u2606" });
    refs.grabCount = el("span", { class: "np-count", text: "0" });
    refs.grabBtn = el("button", { class: "mini ico grab np-react", title: "Save this song" },
      [refs.grabIco, refs.grabCount]);
    refs.grabBtn.onclick = ChatPanels._onStarPress;
    refs.upvoteCount = el("span", { class: "np-count", text: "0" });
    refs.upvoteBtn = el("button", { class: "mini ico upvote np-react", title: "Upvote this song" },
      [el("span", { class: "np-ico", text: "\u25B2" }), refs.upvoteCount]);
    refs.upvoteBtn.onclick = ChatPanels._onVotePress;
    const npActions = el("div", { class: "np-actions" }, [refs.grabBtn, refs.upvoteBtn]);

    const playbackControls = el("div", { class: "playback-controls" }, [
      refs.joinGroup,
      el("div", { class: "volume-group" }, [refs.muteBtn, refs.volumeSlider, refs.resetBtn, npActions])
    ]);

    refs.skipNote = el("div", { class: "skip-note" });

    refs.playerBarMount = el("div", { class: "col-bar-mount" });
    const nowPlaying = el("div", { class: "now-playing" }, [
      refs.playerBarMount,
      el("div", { class: "skip-row" }, [refs.videoTitle, el("div", { class: "skip-group" }, [refs.skipBtn, refs.skipLockBtn])]),
      refs.playerFrame,
      refs.progressBar,
      refs.npLabel,
      refs.skipNote,
      playbackControls
    ]);

    // One queue panel toggling Room rotation vs My personal queue vs History vs Playlists.
    refs.tabRoom = el("button", { class: "tab", text: "Room queue" });
    refs.tabMine = el("button", { class: "tab", text: "My queue" });
    refs.tabHistory = el("button", { class: "tab", text: "History" });
    refs.tabPlaylists = el("button", { class: "tab", text: "Playlists" });
    // Switching queue tabs resets the windowed-stack scroll so re-entering a tab (My
    // Queue / a playlist) shows the top, not wherever you last were. The offset is still
    // preserved across the WITHIN-tab re-renders that add/remove/reorder trigger — those
    // don't go through here. (_stackScrollTop is shared by both windowed surfaces, so the
    // reset also stops one surface's depth leaking into the other.)
    refs.tabRoom.onclick = () => { queueTab = "room"; QueuePanels._resetStackScroll(); _resetQueueLocks(); QueuePanels.renderQueuePanel(); };
    refs.tabMine.onclick = () => { queueTab = "mine"; QueuePanels._resetStackScroll(); _resetQueueLocks(); QueuePanels.renderQueuePanel(); };
    refs.tabHistory.onclick = () => { queueTab = "history"; QueuePanels._resetStackScroll(); _resetQueueLocks(); QueuePanels.renderQueuePanel(); };
    refs.tabPlaylists.onclick = () => { queueTab = "playlists"; PlaylistPanels.setView("list"); QueuePanels._resetStackScroll(); _resetQueueLocks(); QueuePanels.renderQueuePanel(); };
    refs.queueBody = el("div", { class: "queue-body" });
    refs.queueBarMount = el("div", { class: "col-bar-mount" });
    const queuePanel = el("div", { class: "queue-panel" }, [
      refs.queueBarMount,
      el("div", { class: "tabs" }, [refs.tabRoom, refs.tabMine, refs.tabHistory, refs.tabPlaylists]),
      refs.queueBody
    ]);

    // Roster + rank controls + invite
    refs.rosterBox = el("div", { class: "roster-box" });
    const inviteInput = el("input", { class: "invite-input", placeholder: "@user:server to invite" });
    const inviteBtn = el("button", { class: "invite-btn", text: "Invite" });
    inviteBtn.onclick = async () => {
      const v = inviteInput.value.trim();
      if (!v) return;
      try { await Actions.perform("room.invite", { userId: v }); inviteInput.value = ""; Logger.info("Invited " + v); }
      catch (e) { Logger.warn("Invite failed: " + e.message); }
    };
    // WHO HAS DONE SOMETHING RECENTLY (J16) — its own box ABOVE the roster, never merged into it.
    // The two lists answer different questions and merging them would produce a third that is
    // neither: the roster is Matrix MEMBERSHIP (who has joined the Space, which is also where rank
    // assignment belongs) while this one is ACTIVITY folded out of the log. Somebody can be in one
    // and not the other in both directions, and that is information rather than a discrepancy.
    refs.activeBox = el("div", { class: "active-box" });
    refs.roster = el("div", { class: "roster" }, [
      refs.activeBox,
      refs.rosterBox,
      el("div", { class: "invite-row" }, [inviteInput, inviteBtn])
    ]);

    // Chat
    refs.chatBox = el("div", { id: "chat-messages", class: "chat-messages" });
    refs.chatInput = el("input", { class: "chat-input", placeholder: "Message…" });

    // Secure-chat health banner. When E2E crypto didn't come up, chat can't encrypt and
    // sends are refused — this makes that VISIBLE (instead of a silent console throw) and
    // one-click recoverable. Hidden whenever crypto is ready; polled + reflected on send.
    const _showCryptoBanner = (show) => { if (refs.chatCryptoBanner) refs.chatCryptoBanner.style.display = show ? "flex" : "none"; };
    _reflectCryptoBanner = () => _showCryptoBanner(!(typeof Chat !== "undefined" && Chat.cryptoReady && Chat.cryptoReady()));
    const _reconnectSecureChat = async (btn) => {
      if (btn) { btn.disabled = true; btn.textContent = "Reconnecting…"; }
      let ok = false;
      try { ok = !!(Chat.retryCrypto && await Chat.retryCrypto()); } catch (e) {}   // Tier 1: re-init in place, no reload
      if (ok) { _showCryptoBanner(false); if (btn) { btn.disabled = false; btn.textContent = "Reconnect"; } return; }
      // Tier 2: in-place retry couldn't fix it (dead session / stale cached WASM) → drop the
      // service worker so the crypto bundle/WASM re-fetch, then hard reload. This lands on the
      // login / recovery-key flow if the session is truly gone. (Mirrors the manual fix.)
      try { if (typeof window.__ddjpKillSW === "function") window.__ddjpKillSW(); } catch (e) {}
      setTimeout(() => location.reload(), 150);   // give unregister a tick to settle
    };
    refs.chatCryptoBanner = el("div", { class: "chat-crypto-banner", style: "display:none;" }, [
      el("span", { class: "ccb-text", text: "\uD83D\uDD12 Secure chat is offline — messages can't send." }),
      el("button", { class: "ccb-btn", text: "Reconnect", onclick: (e) => _reconnectSecureChat(e.currentTarget) })
    ]);

    const sendChat = async () => {
      const v = refs.chatInput.value.trim();
      if (!v) return;
      if (!(Chat.cryptoReady && Chat.cryptoReady())) { _showCryptoBanner(true); return; }  // keep the text; don't send into the void
      refs.chatInput.value = "";
      let res;
      try { res = await Chat.send(v); } catch (e) { res = { ok: false, reason: "send-failed" }; }
      if (res && res.ok === false) {
        if (!refs.chatInput.value) refs.chatInput.value = v;   // restore the message so it isn't lost
        if (res.reason === "no-crypto") _showCryptoBanner(true);
      }
    };
    refs.chatInput.onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
    // J12 — the tier strip sits ABOVE the message box, so which tier you are reading is visible
    // without opening anything. Its own row rather than merged into the tab strip: the right-panel
    // tabs choose a PANEL and these choose a VIEW inside one, and merging them would make "Chat"
    // three tabs and bury DMs and the feed.
    // ── SUB-TABS UNDER THE CHAT TAB, THE QUEUE'S SHAPE (browser run) ────────────────────────
    // J12 built the tier picker as a flat row with its own `chat-tiers` class — a THIRD shape
    // beside the queue pane's (a top tab with sub-tabs under it) and the right panel's. The owner
    // asked for the established one, and following it means the tiers read as *inside Chat* rather
    // than as a separate control that happens to sit above the messages.
    //
    // The container carries `tabs` — the SAME class the queue's sub-tab strip uses, so the two
    // are styled by one rule and cannot drift apart — plus `chat-tiers` for the badge positioning
    // that is genuinely particular to this strip.
    refs.chatTiers = el("div", { class: "tabs chat-tiers" });
    // J11 — where a deletion says what it did and did not do. Below the box rather than above it,
    // because it answers an action the person just took rather than describing the panel.
    refs.chatNote = el("div", { class: "muted chat-note" });
    refs.chat = el("div", { class: "chat" }, [
      refs.chatCryptoBanner,
      refs.chatTiers,
      refs.chatBox,
      refs.chatNote,
      el("div", { class: "chat-input-row" }, [refs.chatInput, el("button", { text: "Send", onclick: sendChat })])
    ]);

    // Tabs: chat · DMs · people · feed · room-set · logs — one panel visible at a time. Each
    // panel keeps rendering into its (hidden) DOM even when not active, so chat
    // history and the live log aren't lost while another tab is showing.
    refs.tabChat = el("button", { class: "tab", text: "Chat" });
    // The DM tab (J15). It carries its own unread badge, which is the "notification in
    // the panel itself" the job asks for — a conversation you are not looking at is the
    // only case a badge is for, so the count comes from the index rather than from the
    // rendered view.
    refs.tabDM = el("button", { class: "tab tab-dm", text: "DMs", title: "Direct messages" });
    refs.tabPeople = el("button", { class: "tab", text: "People" });
    // The event feed (J13). Read-only, so it carries no misclick lock: the seven locks exist for
    // clicks that DO something, and a list you cannot act on has nothing to protect.
    refs.tabFeed = el("button", { class: "tab", text: "Feed", title: "What has happened in this room" });
    refs.tabRoomset = el("button", { class: "tab", text: "Room" });
    refs.tabGear = el("button", { class: "tab tab-gear", text: "⚙", title: "Logs & settings" });
    // Switching ANY right-panel (upper) tab re-locks every panel lock and repaints
    // the panels so the locks visibly engage (see _relockAllPanels).
    refs.tabChat.onclick = () => { rightTab = "chat"; _relockAllPanels(); QueuePanels.renderRightPanel(); };
    refs.tabDM.onclick = () => {
      rightTab = "dm";
      // OPENING THE INBOX SHOWS THE INBOX. A tab that resumes the last conversation is right for
      // a room and wrong here: the reason to open DMs is almost always to see what has arrived,
      // and landing inside one conversation hides every other one behind a back button.
      ChatPanels._dmResetToList();
      _relockAllPanels(); ChatPanels.renderDMPanel(); QueuePanels.renderRightPanel();
    };
    refs.tabPeople.onclick = () => { rightTab = "people"; _relockAllPanels(); QueuePanels.renderRightPanel(); };
    refs.tabFeed.onclick = () => { rightTab = "feed"; _relockAllPanels(); Panels.renderFeedPanel(); QueuePanels.renderRightPanel(); };
    refs.tabRoomset.onclick = () => { rightTab = "roomset"; _relockAllPanels(); QueuePanels.renderRightPanel(); };
    refs.tabGear.onclick = () => { rightTab = "gear"; _relockAllPanels(); QueuePanels._renderGear(); QueuePanels.renderRightPanel(); };

    // The DM panel (J15) — its own scrollable box, rendered by renderDMPanel.
    refs.dmBox = el("div", { class: "dm-box" });
    refs.dm = el("div", { class: "dm" }, [refs.dmBox]);

    // The event feed (J13) — its own box, rendered by renderFeedPanel. NOT merged into the
    // History pane beside it, and the pair is a §Confusables row: history is the derived play-log
    // (what SONGS played, from `state.history`, surviving a trim through the feature seam), while
    // this is what PEOPLE did, folded from the raw log and bounded by what this client still
    // holds. They answer different questions from different sources and disagree in both
    // directions — a song can be in history while the events that queued it are forgotten.
    refs.feedBox = el("div", { class: "feed-box" });
    refs.feed = el("div", { class: "feed" }, [refs.feedBox]);

    // Room settings panel (form of toggles; owner-editable, everyone can see).
    refs.settingsBox = el("div", { class: "settings-box" });
    refs.settings = el("div", { class: "settings" }, [refs.settingsBox]);

    // Logs sub-panel (the relocated debug log).
    refs.logsBox = el("div", { class: "logs-box" });
    // ── THE TOOLS THAT MAKE A LOG USABLE AS EVIDENCE ────────────────────────────────────────
    // Copying was a mouse-drag through a scrolling box that appends while you drag, which is how
    // a report ends up truncated at exactly the interesting part. The filter is view-only: the
    // full log is always held and the copy is always complete, so turning the noise down can
    // never quietly discard the line somebody needed.
    refs.logsCount = el("span", { class: "logs-count", text: "" });
    const levelSel = el("select", { class: "logs-level", title: "Hide lines below this level (the view only — copying always takes everything)" });
    for (const lv of Panels.logLevels()) {
      const o = el("option", { value: lv, text: lv === "debug" ? "everything" : lv + " and above" });
      o.value = lv;
      levelSel.appendChild(o);
    }
    levelSel.value = Panels.logLevel();
    // The state this drives is declared in ui/panels.js, so the write goes through its
    // setter rather than being rebound from here. The setter runs the same body.
    levelSel.onchange = () => { Panels.setLogLevel(levelSel.value); };
    // ── THE MODULE PICKER, WHICH BORROWS `logs-level` RATHER THAN DECLARING A RULE ───────────
    // Same control doing the same job one axis over, so it takes the same class. A `.logs-cat`
    // rule copying those declarations would render identically today and drift the next time
    // either is touched — the `.dm-sender` / `.sender` failure `check-visual-reuse` exists for.
    // Its options are filled by `_syncLogCatOptions` on every render; empty until then, which is
    // why the picker is built here and populated there rather than seeded with a guess.
    refs.logsCat = el("select", { class: "logs-level", title: "Show only one module's lines (the view only — copying always takes everything)" });
    refs.logsCat.onchange = () => { Panels.setLogCat(refs.logsCat.value); };
    // ── THE BOT'S OWN STATE, ON DEMAND, INTO THE LOG ─────────────────────────────────────────
    // `BotRuntime.status()` returns an object and nothing rendered it, so "is this client the
    // bot, and has it seen anything" needed devtools. This writes it where the rest of the
    // evidence is, so a copied log carries the answer alongside the lines it explains.
    //
    // SHOWN TO EVERYONE, not only to the bot. `NOT running on this client` is the answer to the
    // most common version of the question — a person watching the wrong tab wondering why nothing
    // moderates — and a button that appeared only for the bot could never give it. Borrows the
    // copy button's classes rather than declaring a rule, like the picker above.
    const botStatusBtn = el("button", { class: "copy-btn logs-copy",
      title: "Write this client's bot state into the log below" , text: "Bot status" });
    botStatusBtn.onclick = () => {
      try {
        if (typeof BotRuntime !== "undefined" && BotRuntime.report) BotRuntime.report();
        else Logger.info("BotRuntime: not loaded in this build");
      } catch (e) { Logger.warn("BotRuntime: status unavailable — " + (e && e.message)); }
    };
    refs.logsBar = el("div", { class: "logs-bar" }, [
      levelSel,
      refs.logsCat,
      refs.logsCount,
      botStatusBtn,
      copyButton("Copy log", () => Panels._logText(), "copy-btn logs-copy", "Copy the WHOLE log — every level, both sessions — to the clipboard"),
    ]);
    refs.logs = el("div", { class: "logs" }, [refs.logsBar, refs.logsBox]);

    // Settings sub-panel (chat image/link display prefs).
    refs.chatSettingsBox = el("div", { class: "chat-settings-box" });
    refs.chatSettings = el("div", { class: "chat-settings" }, [refs.chatSettingsBox]);

    // The gear panel nests a Logs / Settings sub-tab bar over the two sub-panels.
    refs.subtabLogs = el("button", { class: "subtab", text: "Logs" });
    refs.subtabSettings = el("button", { class: "subtab", text: "Settings" });
    refs.subtabLogs.onclick = () => { gearTab = "logs"; Panels.renderLogs(); QueuePanels._renderGear(); };
    refs.subtabSettings.onclick = () => { gearTab = "settings"; _prefsLocked = true; Settings.renderChatSettings(); QueuePanels._renderGear(); };
    refs.gear = el("div", { class: "gear-panel" }, [
      el("div", { class: "subtabs" }, [refs.subtabLogs, refs.subtabSettings]),
      refs.logs,
      refs.chatSettings
    ]);

    refs.rightBarMount = el("div", { class: "col-bar-mount" });
    const rightPanel = el("div", { class: "right-panel" }, [
      refs.rightBarMount,
      el("div", { class: "tabs" }, [refs.tabChat, refs.tabDM, refs.tabPeople, refs.tabFeed, refs.tabRoomset, refs.tabGear]),
      refs.roster,
      refs.chat,
      refs.dm,
      refs.feed,
      refs.settings,
      refs.gear
    ]);

    const rightColumn = el("div", { class: "column column-right", "data-pane": "social" }, [rightPanel]);

    // Three columns: queues left, player middle, people/chat toggle right.
    // data-pane on each column lets phone mode show exactly one at a time.
    const columns = el("div", { class: "columns" }, [
      el("div", { class: "column column-left", "data-pane": "queues" }, [queuePanel]),
      el("div", { class: "column column-mid", "data-pane": "player" }, [nowPlaying]),
      rightColumn
    ]);
    refs.columns = columns;

    // The pane nav is built once and then mounted INSIDE the active square by
    // _placePaneNav (phone) / the combined chat-queues square (compact).
    _buildPaneNav();

    main.appendChild(header);
    main.appendChild(columns);
    _applyLayout();

    // Re-fit the header whenever its width changes (window resize, layout switch).
    // One observer for the life of this DOM; disconnected on the next build.
    if (_headerFit.ro) { try { _headerFit.ro.disconnect(); } catch (e) {} }
    if (_marqueeRo) { try { _marqueeRo.disconnect(); } catch (e) {} _marqueeRo = null; }
    if (typeof ResizeObserver !== "undefined") {
      _headerFit.ro = new ResizeObserver(() => _fitHeader());
      _headerFit.ro.observe(header);
      // Re-fit the title marquee whenever its box width changes — window resize,
      // layout switch, or the header shrinker reflowing the row. (Bug fix: the
      // marquee only re-measured on title/layout change before, so resizing the
      // window left it stale.)
      if (refs.videoTitle) {
        _marqueeRo = new ResizeObserver(() => Player._fitMarquee());
        _marqueeRo.observe(refs.videoTitle);
      }
      // The room title is in the HEADER, which reflows for its own reasons (the fit ladder, the
      // rank badge appearing) that never touch the video title's box — so it needs its own
      // observer rather than sharing one.
      if (refs.roomTitle) {
        _roomTitleRo = new ResizeObserver(() => Player._fitMarquee(refs.roomTitle, refs.roomTitleText));
        _roomTitleRo.observe(refs.roomTitle);
      }
    } else {
      window.addEventListener("resize", _fitHeader);
      window.addEventListener("resize", Player._fitAllMarquees);
    }
    _fitHeader();
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ MISCLICK LOCKS
  //
  // Seven independent five-second locks. Presentation only: the backend enforces nothing of the
  // sort.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Skip / Leave auto-relock controller (local, view-only) ----------------
  // Both lock buttons start LOCKED. A click unlocks the action for _LOCK_UNLOCK_MS
  // while a timer bar fills left→right under the button; at the end it re-locks
  // itself. Clicking again while unlocked re-locks immediately. No protocol event.
  function _lockBar(which)  { return which === "skip" ? refs.skipLockBar : refs.leaveLockBar; }
  function _renderLock(which) { if (which === "skip") _renderSkipLock(); else _renderLeaveLock(); }
  function _setLock(which, locked) { if (which === "skip") _skipLocked = locked; else _leaveLocked = locked; }
  function _isLock(which) { return which === "skip" ? _skipLocked : _leaveLocked; }

  function _clearLockTimer(which) {
    if (_lockTimers[which]) { clearTimeout(_lockTimers[which]); _lockTimers[which] = 0; }
  }
  // Re-lock now: cancel the window, snap the bar back to empty, lock, re-render.
  function _relock(which) {
    _clearLockTimer(which);
    _setLock(which, true);
    const bar = _lockBar(which);
    if (bar) { bar.style.transition = "none"; bar.style.transform = "scaleX(0)"; }
    _renderLock(which);
  }
  // Unlock for the window: drive the bar 0→full over _LOCK_UNLOCK_MS, re-lock at end.
  function _unlockTimed(which) {
    _clearLockTimer(which);
    _setLock(which, false);
    _renderLock(which);
    const bar = _lockBar(which);
    if (bar) {
      bar.style.transition = "none";
      bar.style.transform = "scaleX(0)";
      void bar.offsetWidth;                       // commit the empty state before animating
      bar.style.transition = "transform " + (_LOCK_UNLOCK_MS / 1000) + "s linear";
      bar.style.transform = "scaleX(1)";
    }
    _lockTimers[which] = setTimeout(() => { _lockTimers[which] = 0; _relock(which); }, _LOCK_UNLOCK_MS);
  }
  function _onLockClick(which) { if (_isLock(which)) _unlockTimed(which); else _relock(which); }

  // Reflect the skip-lock button's icon/state (🔓/🔒).
  function _renderSkipLock() {
    if (!refs.skipLockBtn || !refs.skipLockIco) return;
    refs.skipLockIco.textContent = _skipLocked ? "🔒" : "🔓";
    refs.skipLockBtn.classList.toggle("locked", _skipLocked);
    refs.skipLockBtn.title = _skipLocked ? "Click to unlock Skip" : "Skip unlocked — click to lock now";
  }

  // Reflect the leave-lock button's icon/state (🔓/🔒).
  function _renderLeaveLock() {
    if (!refs.leaveLockBtn || !refs.leaveLockIco) return;
    refs.leaveLockIco.textContent = _leaveLocked ? "🔒" : "🔓";
    refs.leaveLockBtn.classList.toggle("locked", _leaveLocked);
    refs.leaveLockBtn.title = _leaveLocked ? "Click to unlock Leave" : "Leave unlocked — click to lock now";
  }

  // --- Queue-panel locks (room queue / playlists / My-Queue Clear) ------------
  // All local, view-only, no protocol event. Re-lock EVERY panel lock (room-settings,
  // ⚙ settings, playlists, My-Queue Clear, room queue) AND repaint the panels that show
  // one, so the lock visibly engages no matter how you navigated here — a queue tab, a
  // right-panel tab, OR the phone/compact pane nav (one level up). Setting a flag alone
  // never updates the DOM (that was the bug); the panel has to re-render, so this repaints
  // all of them. Also disarms any pending two-step confirm so nothing stays half-armed.
  // Reset just the queue-panel locks (+ timer + any armed confirm). No render — the
  // queue-tab handlers call this and then render the (changed) tab themselves.
  function _resetQueueLocks() {
    _plLocked = true;
    _uqLocked = true;
    _roomqLocked = true;
    _roomqUnlockAt = 0;
    if (_lockTimers.roomq) { clearTimeout(_lockTimers.roomq); _lockTimers.roomq = 0; }
    PlaylistPanels.setConfirmDelete(null);
    _uqConfirmClear = false;
  }

  // Re-lock EVERY panel lock, but repaint ONLY the panels that actually had something
  // open (an unlocked lock or an armed confirm). This is what higher-level navigation
  // uses — a right-panel tab or the phone/compact pane nav — so a stray tab click never
  // rebuilds the queue rows (that was the flicker) unless a queue lock really needed to
  // re-engage. Setting a flag alone never updates the DOM, hence the targeted repaints.
  function _relockAllPanels() {
    const settingsOpen = !_settingsLocked;
    const prefsOpen = !_prefsLocked;
    const queueOpen = !_plLocked || !_uqLocked || !_roomqLocked
      || PlaylistPanels.confirmDelete() || _uqConfirmClear;
    _settingsLocked = true;
    _prefsLocked = true;
    _resetQueueLocks();
    if (settingsOpen) Settings.renderSettings();
    if (prefsOpen) Settings.renderChatSettings();
    if (queueOpen) QueuePanels.renderQueuePanel();
  }

  // A compact lock button (red when locked). Shared by the non-timed panel locks
  // (playlists, My-Queue Clear). `onToggle` flips the caller's flag + re-renders.
  function _panelLockBtn(locked, title, onToggle) {
    const btn = el("button", {
      class: "panel-lock-btn" + (locked ? " locked" : ""),
      title: title || (locked ? "Locked — click to unlock" : "Unlocked — click to lock"),
    });
    btn.appendChild(el("span", { class: "lock-ico", text: locked ? "🔒" : "🔓" }));
    btn.onclick = onToggle;
    return btn;
  }

  // My-Queue lock button + its "Clear" header, both repaintable in place. Toggling the
  // lock, or arming/cancelling Clear, repaints ONLY the small header (no thumbnails), so
  // the song rows below never flash. The header uses a RESERVED ✔ slot (hidden until
  // armed) so it never changes size, and the "✕ Clear" button is trigger + cancel.
  function _uqLockBtnEl() {
    return _panelLockBtn(_uqLocked,
      _uqLocked ? "Locked — click to unlock Clear" : "Unlocked — click to lock",
      () => { _uqLocked = !_uqLocked; _uqConfirmClear = false; _reflectUqLock(); });
  }
  function _reflectUqLock() {
    if (refs.uqLockBtn && refs.uqLockBtn.parentNode) {
      const fresh = _uqLockBtnEl();
      refs.uqLockBtn.parentNode.replaceChild(fresh, refs.uqLockBtn);
      refs.uqLockBtn = fresh;
    }
    _renderUqListHead();
    // Grey/enable the per-row remove ✕ in place — no row re-render (see `.uq-locked`).
    refs.queueBody.classList.toggle("uq-locked", _uqLocked);
  }
  function _renderUqListHead() {
    if (!refs.uqListHead) return;
    clear(refs.uqListHead);
    const n = UserQueue.count ? UserQueue.count() : 0;
    if (n <= 0) return;
    const bar = el("div", { class: "uq-listhead" });
    bar.appendChild(el("span", { class: "muted", text: n + (n === 1 ? " song" : " songs") }));
    const confirmBtn = el("button", { class: "mini danger", text: "\u2714\uFE0E", title: "Confirm — clear my whole queue" });
    const sep = el("span", { class: "q-sep", "aria-hidden": "true" });
    if (_uqConfirmClear) {
      confirmBtn.onclick = () => { _uqConfirmClear = false; UserQueue.clearQueue(); Roster.renderJoinBtn(); };
    } else {
      confirmBtn.style.visibility = "hidden";   // reserve its width; not interactive
      sep.style.visibility = "hidden";
      confirmBtn.disabled = true;
    }
    const clearBtn = el("button", { class: "mini", text: "✕ Clear",
      title: _uqLocked ? "Locked — unlock (top) to clear"
           : (_uqConfirmClear ? "Cancel — keep my queue" : "Clear my whole queue"),
      onclick: () => { if (_uqLocked) return; _uqConfirmClear = !_uqConfirmClear; _renderUqListHead(); } });
    clearBtn.disabled = _uqLocked;
    bar.appendChild(el("span", { class: "uq-actions" }, [confirmBtn, sep, clearBtn]));
    refs.uqListHead.appendChild(bar);
  }

  // Room-queue lock: TIMED like Skip (unlock → 5s window with a resuming timer bar →
  // auto-relock). Rendered fresh on every renderRoomQueue, so the bar resumes via a
  // negative animation-delay computed from _roomqUnlockAt rather than restarting.
  // Reflect the room-queue lock WITHOUT rebuilding the rows: flip the `.roomq-locked`
  // class on the queue body (CSS greys/disables the per-row controls + Reset) and swap
  // the lock button in place. No thumbnail rebuild → no flash.
  function _roomqReflectLock() {
    if (queueTab !== "room" || !refs.queueBody) return;
    refs.queueBody.classList.toggle("roomq-locked", _roomqLocked);
    if (refs.roomqLockBtn && refs.roomqLockBtn.parentNode) {
      const fresh = _roomqLockBtn();
      refs.roomqLockBtn.parentNode.replaceChild(fresh, refs.roomqLockBtn);
      refs.roomqLockBtn = fresh;
    }
  }
  function _roomqRelockAndRender() {
    _roomqLocked = true; _roomqUnlockAt = 0;
    if (_lockTimers.roomq) { clearTimeout(_lockTimers.roomq); _lockTimers.roomq = 0; }
    _roomqReflectLock();
  }
  function _roomqLockClick() {
    if (_roomqLocked) {
      _roomqLocked = false; _roomqUnlockAt = Date.now();
      if (_lockTimers.roomq) clearTimeout(_lockTimers.roomq);
      _lockTimers.roomq = setTimeout(_roomqRelockAndRender, _LOCK_UNLOCK_MS);
    } else {
      _roomqLocked = true; _roomqUnlockAt = 0;
      if (_lockTimers.roomq) { clearTimeout(_lockTimers.roomq); _lockTimers.roomq = 0; }
    }
    _roomqReflectLock();
  }
  function _roomqLockBtn() {
    const btn = el("button", {
      class: "panel-lock-btn" + (_roomqLocked ? " locked" : ""),
      title: _roomqLocked ? "Locked — click to unlock the queue controls for 5s" : "Unlocked — click to lock now",
    });
    btn.appendChild(el("span", { class: "lock-ico", text: _roomqLocked ? "🔒" : "🔓" }));
    if (!_roomqLocked) {
      const bar = el("div", { class: "roomq-lock-timer" });
      const elapsed = _roomqUnlockAt ? (Date.now() - _roomqUnlockAt) : 0;
      if (elapsed > 0 && elapsed < _LOCK_UNLOCK_MS) bar.style.animationDelay = "-" + Math.round(elapsed) + "ms";
      btn.appendChild(bar);
    }
    btn.onclick = () => _roomqLockClick();
    return btn;
  }


  // ────────────────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  //
  // Published into the shared host rather than returned, because every consumer already reaches
  // these through `H.` — the names do not change, only the file that owns them.
  // ────────────────────────────────────────────────────────────────────────────────────────

  UIBase.publish({
    _uqLockBtnEl, _renderUqListHead, _roomqLockBtn, _panelLockBtn, _relockAllPanels,
    _fitHeader, _relock, _renderLeaveLock, _bgLeaveRoom, _setLayout, buildMainDom,
    headerFit: () => _headerFit,
    plLocked: () => _plLocked, setPlLocked: (v) => { _plLocked = v; },
    queueTab: () => queueTab, rightTab: () => rightTab, gearTab: () => gearTab,
    setRightTab: (v) => { rightTab = v; },
    settingsLocked: () => _settingsLocked, setSettingsLocked: (v) => { _settingsLocked = v; },
    prefsLocked: () => _prefsLocked, setPrefsLocked: (v) => { _prefsLocked = v; },
    roomqLocked: () => _roomqLocked, uqLocked: () => _uqLocked,
    reflectCryptoBanner: (...a) => { if (_reflectCryptoBanner) _reflectCryptoBanner(...a); },
    reflectPlaybackHold: (...a) => { if (_reflectPlaybackHold) _reflectPlaybackHold(...a); },
  });

  return { buildMainDom, _setLayout, _bgLeaveRoom };
})();
