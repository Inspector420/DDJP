// ui/queue.js
// QUEUE PANELS · RIGHT PANEL — extracted from ui/interface.js at ddjp_388 as the third of the
// ten files roles.md §5 records.
//
// ── THE GLOBAL IS `QueuePanels`, NOT `Queue` ─────────────────────────────────────────────────
// `Queue` is the FEATURE module — the DJ rotation and its consensus. This file is the panels that
// DRAW it and decides nothing. Two globals one letter apart would be the confusable pair this
// tree keeps a section for, so the name says which side of the seam it is on.
//
// ── WHAT IT READS RATHER THAN OWNS ───────────────────────────────────────────────────────────
// `queueTab`, `rightTab`, `gearTab`, `_roomqLocked` and `_uqLocked` are declared in
// ui/interface.js and REBOUND there — by tab handlers in `buildMainDom` and by the misclick
// locks. They are read here through `H.*()` READERS rather than copied: a snapshot taken at load
// would be stale the moment anyone changed a tab. `_commitAnchors` went the other way — it is
// declared in MODULE STATE and read by nothing but this cluster, so it came with it.
//
// Depends on: UIBase, Interface (via UIBase.host), Room, Queue, Playback, RoomQueue, Continuity

const QueuePanels = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // --- state this cluster owns. Declared in MODULE STATE and read by nothing else, so it
  // came across rather than being read back through the seam for no reason.
  let _commitAnchors = {};

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ RIGHT PANEL
  //
  // The tab strip: chat, DMs, people, room settings, gear. (No feed tab since ddjp_425 — its rows
  // are in chat.)
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // QUEUE PANEL
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // RIGHT PANEL — People / Chat toggle (one visible at a time)
  // ---------------------------------------------------------------------------
  function renderRightPanel() {
    const t = H.rightTab();
    if (refs.tabChat) refs.tabChat.classList.toggle("active", t === "chat");
    if (refs.tabDM) refs.tabDM.classList.toggle("active", t === "dm");
    if (refs.tabPeople) refs.tabPeople.classList.toggle("active", t === "people");
    if (refs.tabRoomset) refs.tabRoomset.classList.toggle("active", t === "roomset");
    if (refs.tabGear) refs.tabGear.classList.toggle("active", t === "gear");
    if (refs.chat) refs.chat.style.display = t === "chat" ? "flex" : "none";
    if (refs.dm) refs.dm.style.display = t === "dm" ? "flex" : "none";
    if (refs.roster) refs.roster.style.display = t === "people" ? "flex" : "none";
    if (refs.settings) refs.settings.style.display = t === "roomset" ? "flex" : "none";
    if (refs.gear) refs.gear.style.display = t === "gear" ? "flex" : "none";
    // A tab change moves what is on screen, so the dots on every level are redrawn (ddjp_441).
    try { ChatPanels._renderLevelDots(); } catch (e) {}
  }

  // The gear panel's own Logs / Settings sub-tabs (one sub-panel visible at a time).
  function _renderGear() {
    const g = H.gearTab();
    if (refs.subtabLogs) refs.subtabLogs.classList.toggle("active", g === "logs");
    if (refs.subtabSettings) refs.subtabSettings.classList.toggle("active", g === "settings");
    if (refs.logs) refs.logs.style.display = g === "logs" ? "flex" : "none";
    if (refs.chatSettings) refs.chatSettings.style.display = g === "settings" ? "flex" : "none";
  }

  // Build the gear → Settings sub-tab: two opt-in sections (Images, Links), each
  // with a master toggle, a checklist of default hosts you can uncheck, and an
  // "add your own" field with removable chips. Reads/writes ChatPrefs; every change
  // persists per-user and re-renders chat live (via the ChatPrefs.onChange wiring
  // in enterMainScreen, which calls back here + _repaintChat). Plain DOM only.
  // Disable every interactive control under `root` (used to enforce the prefs
  // master lock). View-only: it only flips `.disabled`, never rebuilds the DOM.
  function _disableAllControls(root) {
    if (!root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll("input, button, select, textarea");
    for (const n of nodes) n.disabled = true;
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ QUEUE PANELS
  //
  // Room queue, my queue, history and playlists all render into ONE container. The dispatcher
  // clears it; a renderer reached from anywhere else must clear it itself.
  // ────────────────────────────────────────────────────────────────────────────────────────

  function renderQueuePanel() {
    if (!refs.queueBody) return;
    if (refs.tabRoom) refs.tabRoom.classList.toggle("active", H.queueTab() === "room");
    if (refs.tabMine) refs.tabMine.classList.toggle("active", H.queueTab() === "mine");
    if (refs.tabHistory) refs.tabHistory.classList.toggle("active", H.queueTab() === "history");
    if (refs.tabPlaylists) refs.tabPlaylists.classList.toggle("active", H.queueTab() === "playlists");
    H.clear(refs.queueBody);
    refs.queueBody.classList.remove("roomq-locked");   // room-queue-only gating class; re-added by renderRoomQueue
    refs.queueBody.classList.remove("uq-locked");       // My-queue-only gating class; re-added by renderMyQueue
    if (H.queueTab() === "room") renderRoomQueue();
    else if (H.queueTab() === "history") Panels.renderHistory();
    else if (H.queueTab() === "playlists") PlaylistPanels.renderPlaylists();
    else renderMyQueue();
  }

  // Per-row rotation controls for a room-queue song (Batch 1 — now WIRED). Each button
  // routes through the Actions adapter (the UI decides no permissions) and posts a real
  // rotation intent: ▲ ▼ ⏫ ⏬ = ddjp.dj.move (Staff+); ✕🎵 = ddjp.dj.strike (remove ONE
  // song, Staff+ / rank-blind, with an advisory 3s per-DJ cooldown); ✕👤 = ddjp.dj.remove
  // (remove the whole DJ, Staff+ / rank-blind) — the capability layer decides. Layout mirrors My
  // Queue. Buttons are class-tagged `rq-ctl` so the `.roomq-locked` CSS greys +
  // pointer-events:none them without a row rebuild (no thumbnail flash); the click
  // handlers also read `_roomqLocked` live so keyboard activation is blocked while locked.
  // The position-disabled ends (up/top on the first row, down/bottom on the last) use the
  // `disabled` attribute, matching My Queue — those don't change on a lock toggle.
  // Re-render the room queue after `ms` so a lapsed strike cooldown re-enables its ✕🎵
  // button. Coalesces to the SOONEST pending expiry across rows and self-terminates (the
  // re-render only reschedules for DJs still cooling). Advisory/display only.
  let _roomqRerenderTimer = null;
  let _roomqRerenderAt = 0;
  function _scheduleRoomqRerender(ms) {
    if (!(ms > 0)) return;
    const at = Date.now() + ms + 60;   // small pad so the window has surely elapsed
    if (_roomqRerenderTimer !== null && _roomqRerenderAt <= at) return;
    if (_roomqRerenderTimer !== null) clearTimeout(_roomqRerenderTimer);
    _roomqRerenderAt = at;
    _roomqRerenderTimer = setTimeout(() => {
      _roomqRerenderTimer = null; _roomqRerenderAt = 0;
      if (H.queueTab() === "room") renderRoomQueue();
    }, ms + 60);
  }

  function _roomqRowControls(entry, index, rotation) {
    const ids = (rotation || []).map(r => r.user);
    const i = index, last = ids.length - 1;
    const isFirst = (i === 0), isLast = (i === last);
    const user = entry.user;
    const songId = (entry.pending && entry.pending.length) ? entry.pending[0].videoId : null;  // the song this row shows
    const mk = (glyph, title, fn, on) => {
      const b = H.el("button", { class: "mini rq-ctl", text: glyph, title: title, "aria-label": title });
      if (on) b.onclick = () => { if (H.roomqLocked()) return; fn(); }; else b.disabled = true;
      return b;
    };
    const sep = () => H.el("span", { class: "q-sep", "aria-hidden": "true" });
    // Move is expressed as the reducer's "place AFTER <userId>" (null = to the front),
    // computed over the visible rotation order this row list is already in: up one = after
    // the member two above (or the front if we're second); down one = after our successor;
    // top = front; bottom = after the current last member.
    const moveAfter = (afterUserId) => Actions.perform("dj.move", { userId: user, afterUserId: afterUserId });
    const canMove = Actions.describe("dj.move", { userId: user }).enabled;
    const moves = [
      mk("\u25B2",       "Move up",        () => moveAfter(i >= 2 ? ids[i - 2] : null), canMove && !isFirst),
      mk("\u25BC",       "Move down",      () => moveAfter(ids[i + 1]),                  canMove && !isLast),
      sep(),             // divide one-step moves from jump-to-end (matches My queue)
      mk("\u23EB\uFE0E", "Move to top",    () => moveAfter(null),                         canMove && !isFirst),
      mk("\u23EC\uFE0E", "Move to bottom", () => moveAfter(ids[last]),                    canMove && !isLast),
    ];
    // Remove ONE song — the one shown in this row (entry.pending[0]) — via ddjp.dj.strike.
    // Staff+ / rank-blind: the UI passes the videoId as DATA and lets Actions/Capabilities
    // decide. Plus an ADVISORY 3s per-DJ cooldown (display-only): once a strike lands this
    // DJ's ✕song greys until ServerClock.serverNow() >= Queue.lastStrikeTs(user) +
    // STRIKE_COOLDOWN_MS. The reducer enforces NO cooldown (it reads no time); a stale click
    // is still re-checked by Actions.perform. We schedule a re-render at expiry so it re-enables.
    const strikeDesc = songId ? Actions.describe("dj.strike", { userId: user, videoId: songId })
                              : { enabled: false, reason: "No song to remove" };
    const nowMs = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : Date.now();
    const coolUntil = (typeof Queue !== "undefined" && Queue.lastStrikeTs)
      ? Queue.lastStrikeTs(user) + (Queue.STRIKE_COOLDOWN_MS || 0) : 0;
    const cooling = coolUntil > nowMs;
    const strikeTitle = cooling ? ("Cooling down \u2014 " + Math.ceil((coolUntil - nowMs) / 1000) + "s")
                                : (strikeDesc.enabled ? "Remove this song" : (strikeDesc.reason || "Can't remove song"));
    const strikeBtn = mk("\u2715\uD83C\uDFB5", strikeTitle,
                         () => Actions.perform("dj.strike", { userId: user, videoId: songId }),
                         strikeDesc.enabled && !cooling);
    strikeBtn.classList.add("rq-strike");
    if (cooling) _scheduleRoomqRerender(coolUntil - nowMs);   // re-enable the button when the cooldown lapses

    // Remove the whole DJ from the rotation via ddjp.dj.remove — now Staff+ / rank-blind
    // (Staff+ may remove anyone, exactly like the VIP+ skip-others rule). The UI passes only
    // the target id and lets Actions/Capabilities decide; the ✕person disables (with reason)
    // only when the target isn't in the rotation or I'm below Staff.
    const rmDesc = Actions.describe("dj.remove", { userId: user });
    const removeBtn = mk("\u2715\uD83D\uDC64", rmDesc.enabled ? "Remove DJ from rotation" : (rmDesc.reason || "Can't remove"),
                         () => Actions.perform("dj.remove", { userId: user }), rmDesc.enabled);
    removeBtn.classList.add("rq-remove");
    return moves.concat([sep(), strikeBtn, removeBtn]);   // ✕song then ✕DJ — guarded from a misclick
  }

  function renderRoomQueue() {
    if (!refs.queueBody) return;
    // CLEAR FIRST — this function APPENDS, and it has a second call site: the strike-cooldown
    // timer in _scheduleRoomqRerender re-renders directly rather than through renderQueuePanel.
    // Without this, striking a song (✕🎵) painted the entire room queue a second time about
    // three seconds later, which read as a random duplication because it was detached from the
    // click. Clearing here makes the function safe from ANY call site rather than relying on
    // every caller remembering; renderQueuePanel's own clear is then simply redundant.
    H.clear(refs.queueBody);
    const np = Queue.getNowPlaying();
    const rotation = Queue.getRotation();

    // Header row (ABOVE the now-playing box): "Reset rotation" (High-Staff+, greyed by
    // the lock via the .roomq-locked class) on the left, the room-queue lock button on
    // the right. Lock is TIMED (5s) like Skip. Height matches the My-Queue / Playlists
    // locks (fixed .panel-lock-btn).
    const headRow = H.el("div", { class: "rq-head-row" });
    // Room-queue management is rank-gated. A user who can't manage it should see
    // neither the controls NOR the lock that gates them. Reset is High-Staff+; the
    // per-row move/remove are Staff+ — both decided by the capability system, no rank
    // check here.
    const canReset = Actions.describe("dj.reset").enabled;
    const canManageRows = !!(rotation && rotation.length) &&
      Actions.describe("dj.move", { userId: rotation[0].user }).enabled;
    const showRoomqControls = canReset || canManageRows;
    if (canReset) {
      const reset = H.el("button", { class: "danger", text: "Reset rotation", onclick: () => { if (!H.roomqLocked()) Actions.perform("dj.reset").catch((e) => Logger.warn("reset: " + ((e && e.message) || e))); } });
      headRow.appendChild(reset);          // greyed/inert when locked via CSS (.roomq-locked .danger)
    }
    // The lock only appears when there's actually a gated control to lock.
    if (showRoomqControls) {
      refs.roomqLockBtn = H._roomqLockBtn();
      headRow.appendChild(refs.roomqLockBtn);
    } else {
      refs.roomqLockBtn = null;
    }
    if (headRow.childNodes.length) refs.queueBody.appendChild(headRow);
    refs.queueBody.classList.toggle("roomq-locked", H.roomqLocked() && showRoomqControls);   // gate the controls below

    // Now-playing box: a bright-white "Now Playing" tag next to the DJ name, then a
    // read-only (cacheOnly) song row with the ★ save / ▲ vote affordances.
    if (np && np.song) {
      const npTag = H.el("span", { class: "rq-np-tag", text: "Now Playing" });
      const npName = H.el("span", { class: "who", text: H.shortName(np.dj) });
      npName.style.color = H.rankColor(H._rosterLevel(np.dj));
      Roster._wireCardTrigger(npName, np.dj);   // the card, from the queue (J14)
      const npHead = H.el("div", { class: "rq-np-head" }, [npTag, npName]);
      const npRow = PlaylistPanels.songRow(np.song.videoId, { thumbMode: "cacheOnly", actions: [ChatPanels._starBtn(), ChatPanels._voteBtn()] });
      npRow.classList.add("playing");
      refs.queueBody.appendChild(H.el("div", { class: "rq-group playing" }, [npHead, npRow]));
    }

    if (!rotation || rotation.length === 0) {
      refs.queueBody.appendChild(H.el("p", { class: "muted", text: "No DJs waiting" }));
    } else {
      // One row per waiting DJ (their next declared song). Each row shows the
      // thumbnail + id/title (filling in from cache/fetch), the user who queued it
      // (sub line, rank-coloured), and the wired reorder/remove controls (Staff+).
      rotation.forEach((entry, idx) => {
        const vid = (entry.pending && entry.pending.length) ? entry.pending[0].videoId : null;
        if (!vid) return;                        // a rotation entry always has >=1 pending song
        const row = PlaylistPanels.songRow(vid, {
          thumbMode: "fetch",                    // load thumbnails/titles for the room queue now
          sub: H.shortName(entry.user),            // who queued it
          actions: canManageRows ? _roomqRowControls(entry, idx, rotation) : [],
        });
        const whoEl = row.querySelector(".sr-when");
        if (whoEl) {
          whoEl.style.color = H.rankColor(H._rosterLevel(entry.user));
          Roster._wireCardTrigger(whoEl, entry.user);   // the card, from the queue (J14)
        }
        refs.queueBody.appendChild(row);
      });
    }
  }

  // Windowed render of a (possibly huge) in-RAM song list: only the visible
  // slice is in the DOM; top/bottom spacers keep the scrollbar proportional. The
  // full ID list stays in RAM (and storage); this just bounds what's painted.
  // Because the list lives fully in memory, the window is a pure function of the
  // scroll offset (WindowedList.visibleRange) — which lets us PRESERVE the scroll
  // position across re-renders (add/remove/reorder re-run this, and without the
  // saved offset the view would snap back to the top each time).
  // (Review-only DOM wiring; the windowing math itself is guarded.)
  const STACK_ROW_H = 34;          // fixed row height (px) so spacers can size the scroll area
  const STACK_VIEWPORT_H = 320;    // fallback visible height (px) when we can't measure the panel
  const STACK_BUFFER = 6;          // off-screen rows rendered each side
  let _stackScrollTop = 0;         // preserved across re-renders within a room/tab session
  function _resetStackScroll() { _stackScrollTop = 0; }
  function _renderWindowedStack(parent, getList, rowFor, rowH) {
    const RH = (typeof rowH === "number" && rowH > 0) ? rowH : STACK_ROW_H;
    // Fill the space the panel actually gives us (flex:1) instead of a fixed cap, so
    // a tall window shows a long list and a short one scrolls. The virtual-scroll math
    // still needs a concrete pixel height, so we measure the scroller's own clientHeight
    // each paint (it flexes to fill), falling back to STACK_VIEWPORT_H before layout /
    // in headless. maxHeight is dropped in favour of flex + min-height:0 (set in CSS).
    const scroller = H.el("div", { class: "uq-scroll" });
    scroller.style.overflowY = "auto";
    const topSpacer = H.el("div");
    const rowsBox = H.el("div");
    const botSpacer = H.el("div");
    scroller.appendChild(topSpacer); scroller.appendChild(rowsBox); scroller.appendChild(botSpacer);
    parent.appendChild(scroller);

    function _viewportH() {
      const h = scroller.clientHeight;
      return (typeof h === "number" && h > 0) ? h : STACK_VIEWPORT_H;
    }
    function paint() {
      const list = getList() || [];
      const r = WindowedList.visibleRange(_stackScrollTop, _viewportH(), RH, list.length, STACK_BUFFER);
      topSpacer.style.height = r.topPad + "px";
      botSpacer.style.height = r.botPad + "px";
      H.clear(rowsBox);
      for (let i = r.start; i < r.end; i++) {
        const row = rowFor(list[i], i);
        row.style.height = RH + "px";
        rowsBox.appendChild(row);
      }
    }
    scroller.addEventListener("scroll", () => { _stackScrollTop = scroller.scrollTop; paint(); });
    paint();
    // Repaint once after layout settles: the first paint runs before the flex height is
    // known (clientHeight 0), so it would only render the fallback window. rAF gives the
    // browser a chance to lay the scroller out, then we fill the real height. Guarded for
    // headless (no rAF) where the fallback height already applied.
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { if (scroller.isConnected) paint(); });
    // Restore the saved offset (after paint set the spacers, so scrollHeight is
    // correct). The browser clamps if the list shrank since last render.
    scroller.scrollTop = _stackScrollTop;
  }

  function renderMyQueue() {
    // Add-by-link box
    const input = H.el("input", { class: "uq-input", placeholder: "Paste a YouTube link…" });
    const note = H.el("div", { class: "uq-note muted" });
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
      Roster.renderJoinBtn();   // a newly-added song can enable the Join button
    };
    input.onkeydown = (e) => { if (e.key === "Enter") addOne(); };
    // The lock (right of Add) gates the "Clear" affordance below. Toggling it — and
    // arming/cancelling Clear — only re-renders the small clear header (which has no
    // thumbnails), NOT the whole panel, so the song rows don't flash. Non-timed.
    refs.uqLockBtn = H._uqLockBtnEl();
    refs.queueBody.appendChild(H.el("div", { class: "uq-add" }, [input, H.el("button", { text: "Add", onclick: addOne }), refs.uqLockBtn]));
    refs.queueBody.appendChild(note);
    // Mirror of the room-queue's .roomq-locked: while the My-Queue lock is engaged, the
    // .uq-locked class greys + disables the per-row remove ✕ (see `.uq-locked .uq-remove`)
    // WITHOUT re-rendering the rows, so toggling the lock never flashes thumbnails.
    refs.queueBody.classList.toggle("uq-locked", H.uqLocked());

    // Clear header lives in a persistent container so we can repaint just it.
    refs.uqListHead = H.el("div");
    refs.queueBody.appendChild(refs.uqListHead);
    H._renderUqListHead();

    // ONE list — your intent. Its top CAP rows carry a commit bar whose colour is a
    // MATCH, not an event: green when the room's declared slot equals this row
    // (confirmed), blue when it's a top-CAP song not yet confirmed. Movement/remove are
    // pure-local reorders of intent by ABSOLUTE index (instant, no events); the
    // reconciler then makes the room's declared buffer match. No declared/stack split.
    const items = UserQueue.items ? UserQueue.items() : [];
    // Keep commit-bar anchors only for songs currently in the top-2 — so a song that
    // was removed (or fell out) and later comes back starts a fresh countdown rather
    // than resuming a stale one.
    {
      const top = {};
      for (let k = 0; k < Math.min(2, items.length); k++) top[items[k].videoId] = true;
      for (const v in _commitAnchors) if (!top[v]) delete _commitAnchors[v];
    }
    if (items.length === 0) {
      refs.queueBody.appendChild(H.el("p", { class: "muted", text: "Your queue is empty" }));
    } else {
      const mv = (glyph, title, fn, on) => {
        const b = H.el("button", { class: "mini", text: glyph, title: title, "aria-label": title });
        if (on) b.onclick = fn; else { b.disabled = true; }   // disabled = same spot, greyed, inert
        return b;
      };
      const sep = () => H.el("span", { class: "q-sep", "aria-hidden": "true" });
      _renderWindowedStack(refs.queueBody, () => (UserQueue.items ? UserQueue.items() : []), (song, i) => {
        const list = UserQueue.items ? UserQueue.items() : [];
        const isFirst = (i === 0), isLast = (i === list.length - 1);
        // Fixed 4-button layout in a stable order: ▲ up · ▼ down · ⏫ to top · ⏬ to
        // bottom. Every row shows all four in the SAME columns; the ones that don't apply
        // (up/top on the first row, down/bottom on the last) are just disabled in place,
        // so nothing shifts around row to row. The trailing \uFE0E forces the monochrome
        // (text) form of the double-triangles so they match ▲ ▼ ✕ instead of colour emoji.
        const moves = [
          mv("\u25B2",       "Move up",        () => UserQueue.moveUp(i),       !isFirst),
          mv("\u25BC",       "Move down",      () => UserQueue.moveDown(i),     !isLast),
          sep(),             // divide the one-step moves from the jump-to-end moves
          mv("\u23EB\uFE0E", "Move to top",    () => UserQueue.moveToTop(i),    !isFirst),
          mv("\u23EC\uFE0E", "Move to bottom", () => UserQueue.moveToBottom(i), !isLast),
        ];
        // Remove ✕ is gated by the My-Queue lock, like the Clear button: while locked, the
        // .uq-locked class on the queue body greys it + blocks pointer events (flash-free —
        // no row re-render, same mechanism as the room-queue controls) and the onclick guard
        // stops keyboard activation. The ▲▼⏫⏬ moves stay free (reordering is reversible).
        const removeBtn = mv("\u2715", "Remove", () => { if (H.uqLocked()) return; UserQueue.removeAt(i); }, true);
        removeBtn.classList.add("uq-remove");
        const acts = moves.slice();
        if (moves.length) acts.push(sep());   // guard the ✕ from a misclick
        acts.push(removeBtn);
        const row = PlaylistPanels.songRow(song.videoId, {
          pos: isFirst ? "\u25B6" : (i + 1) + ".",
          thumbMode: "fetch",
          actions: acts
        });
        // Commit bar on the top-CAP rows only.
        const state = UserQueue.slotState ? UserQueue.slotState(i) : null;
        if (state) {
          const vid = song.videoId;
          const bar = H.el("div", { class: "commit-bar " + state });
          const fill = H.el("div", { class: "commit-fill" });
          if (state === "pending") {
            // Resume THIS song's countdown from when it first entered "pending", not
            // from the queue-wide settle timer (which resets on any edit). So editing an
            // unrelated song no longer restarts a top-2 bar that didn't change — only a
            // freshly-pending song starts from zero. Committed/sent slots drop their
            // anchor so a later re-entry starts a fresh countdown.
            if (_commitAnchors[vid] == null) _commitAnchors[vid] = Date.now();
            const elapsed = Date.now() - _commitAnchors[vid];
            if (elapsed > 0) fill.style.animationDelay = "-" + Math.round(elapsed) + "ms";
          } else {
            delete _commitAnchors[vid];
          }
          bar.appendChild(fill);
          row.appendChild(bar);
        }
        return row;
      }, PlaylistPanels.SONG_ROW_H());
    }
    // Join/Leave the DJ queue now lives under the now-playing song (see buildMainDom).
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderRightPanel, _renderGear, _disableAllControls,
    renderQueuePanel, _resetStackScroll, _renderWindowedStack,
  };
})();
