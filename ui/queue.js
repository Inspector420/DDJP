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
// ui/shell.js and REBOUND there — by tab handlers in `buildMainDom` and by the misclick
// locks. They are read here through `H.*()` READERS rather than copied: a snapshot taken at load
// would be stale the moment anyone changed a tab. `_commitAnchors` went the other way — it is
// declared in MODULE STATE and read by nothing but this cluster, so it came with it.
//
// Depends on: UIBase (and its `host`), Queue, Actions, UserQueue, ServerClock, WindowedList, Logger

const QueuePanels = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // --- state this cluster owns. Declared in MODULE STATE and read by nothing else, so it
  // came across rather than being read back through the seam for no reason.
  // Per-song commit-bar countdown anchors (songKey -> ms when it entered "pending").
  // The UserQueue settle timer is queue-wide and resets on ANY edit; keying the bar
  // to the song instead means an unrelated edit can't restart a song that didn't
  // change — only a newly-pending song starts from zero.
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
    // Opening People draws it fresh, which also starts its refresh while it is on screen (ddjp_471).
    if (t === "people") { try { Panels.renderActivePanel(); Roster.renderRoster(); } catch (e) {} }
    if (refs.settings) refs.settings.style.display = t === "roomset" ? "flex" : "none";
    if (refs.gear) refs.gear.style.display = t === "gear" ? "flex" : "none";
    // A tab change moves what is on screen, so the dots on every level are redrawn (ddjp_441).
    try { ChatPanels._renderLevelDots(); } catch (e) {}
  }

  // The gear panel's own Logs / Feed / Settings sub-tabs (one sub-panel visible at a time).
  function _renderGear() {
    const g = H.gearTab();
    if (refs.subtabLogs) refs.subtabLogs.classList.toggle("active", g === "logs");
    if (refs.subtabSettings) refs.subtabSettings.classList.toggle("active", g === "settings");
    if (refs.logs) refs.logs.style.display = g === "logs" ? "flex" : "none";
    if (refs.chatSettings) refs.chatSettings.style.display = g === "settings" ? "flex" : "none";
    if (refs.subtabFeed) refs.subtabFeed.classList.toggle("active", g === "feed");
    if (refs.feedPanel) refs.feedPanel.style.display = g === "feed" ? "flex" : "none";
    // Paint the feed now it may be showing; when it is not, the same call stops its age timer.
    if (typeof Panels !== "undefined" && Panels.renderFeedPanel) Panels.renderFeedPanel();
    // Settings showing: the bot's card as it stands now, if it moved while the panel was closed (J117, `ddjp_630`).
    if (g === "settings" && typeof Settings !== "undefined" && Settings.refreshRepCard) Settings.refreshRepCard();
  }

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

  // THE UNCONDITIONAL REDRAW: a tab click, room entry, and the owner's own actions (a lock, a rename, a remove). It clears the
  // container, dispatches, and keeps the record of what the tab now shows (J130, below).
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
    _keepDrawn();
  }

  // ── A ROOM EVENT REDRAWS ONLY WHAT CHANGED (J130, the owner's decisions at `ddjp_653`) ─────────────────────────────────────
  // "A list in the queue pane redraws only when what it shows has changed. A room event that changes nothing on screen causes
  // no redraw. Playlists, the library and inside a playlist, ignore room events entirely." Every redraw rebuilt every row and
  // made a new picture URL for each, so a vote, a join, a skip — any of the room's fifteen queue events, a rank change, a
  // reaction — blinked the whole list, whichever tab was open.
  //
  // WHAT EACH TAB HEARS. The room's triggers (ui/screens.js, ui/chat.js) all come here, named by their source:
  //   "queue"     — `Queue.onStateChange`: a DJ or reaction event folded into the room's state.
  //   "mine"      — `UserQueue.onChange`: My queue's own list, told AFTER it has applied the event. features/room.js wires
  //                 Queue before UserQueue, so on every DJ event the Queue listener saw a state UserQueue had not absorbed yet
  //                 and My queue redrew twice; the second was the true one. So My queue hears only this.
  //   "reactions" — `Reactions.onChange` and this account's own ★/▲: the save and vote latch on now playing.
  //   "rank"      — `Room.onRankChange`: names' colours and what the controls allow.
  //   "history"   — `Queue.onHistoryChange`: song history wrote (J130's correction, `ddjp_662`). The queue's notice came BEFORE
  //                 the play's refresh on a page's first room, and not at all when a tab that was away paid the refresh it
  //                 owed, so History showed a new song late, or not until the next one.
  // Playlists hears none of them — its lists are the owner's own, and a room event cannot change them.
  const _HEARS = { room: ["queue", "reactions", "rank"], mine: ["mine"], history: ["queue", "rank", "history"], playlists: [] };
  // WHAT A TAB SHOWS, AS A STRING — built from the values its renderer draws, and nothing it does not: not the lock states (the
  // locks repaint in place, ui/shell.js), not an age (refreshed in place), not a title or picture arriving from the cache (they
  // fill the row in place). Compared before a rebuild: equal, nothing is touched. `tests/check-queue-redraw` A holds it to the
  // screen in both directions — each value drawn, changed alone, redraws once; a change not drawn, none.
  function _recordOf(tab) {
    if (tab === "room") return _roomqRecord();
    if (tab === "mine") return _mineRecord();
    if (tab === "history") return Panels.historyRecord();
    return null;   // Playlists: never compared, since no room event reaches it
  }
  let _drawn = null;   // { body, tab, rec } — what the pane shows now
  function _keepDrawn() { _drawn = refs.queueBody ? { body: refs.queueBody, tab: H.queueTab(), rec: _recordOf(H.queueTab()) } : null; }
  function roomEvent(source) {
    if (!refs.queueBody) return;
    const tab = H.queueTab();
    if ((_HEARS[tab] || []).indexOf(source) < 0) return;
    const rec = _recordOf(tab);
    const same = !!_drawn && _drawn.body === refs.queueBody && _drawn.tab === tab;
    // Nothing it shows changed: nothing is touched. (A tab with no record is never "unchanged": what it hears, it redraws —
    // so Playlists' silence is `_HEARS` alone, one place.)
    if (same && rec !== null && _drawn.rec === rec) return;
    // MY QUEUE REDRAWS ONLY ITS LIST (the owner, `ddjp_653`): the add line above it stays, so a typed link, the focus and a
    // refusal's note ("Couldn't add: …") survive. Anything else — another tab, a new room's pane — is drawn whole.
    if (same && tab === "mine") { _redrawMyList(); _drawn.rec = rec; return; }
    renderQueuePanel();
  }

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
      // A TIMED DISPLAY, SO IT REDRAWS UNASKED (J130): the cooldown's end is a time, not a room event. What it drew is kept.
      if (H.queueTab() === "room") { renderRoomQueue(); _keepDrawn(); }
    }, ms + 60);
  }

  // Per-row rotation controls for a room-queue song (Batch 1 — now WIRED). Each button
  // routes through the Actions adapter (the UI decides no permissions) and posts a real
  // rotation intent: ▲ ▼ ⏫ ⏬ = ddjp.dj.move (Staff+); ✕🎵 = ddjp.dj.strike (remove ONE
  // song, Staff+ / rank-blind, with an advisory 3s per-DJ cooldown); ✕👤 = ddjp.dj.remove
  // (remove the whole DJ, Staff+ / rank-blind) — the capability layer decides. Layout mirrors My
  // Queue. Buttons and their separators are class-tagged `rq-ctl` so the `.roomq-locked` CSS
  // hides them without a row rebuild (no thumbnail flash); the click
  // handlers also read `_roomqLocked` live so keyboard activation is blocked while locked.
  // The position-disabled ends (up/top on the first row, down/bottom on the last) use the
  // `disabled` attribute, matching My Queue — those don't change on a lock toggle.
  // WHAT A ROW'S CONTROLS SHOW, read once and used twice (J130): to build them, and in the room queue's record — so the record
  // cannot ask the capability layer anything the buttons did not.
  function _roomqRowState(entry, index, rotation) {
    const ids = (rotation || []).map(r => r.user);
    const user = entry.user;
    const songId = (entry.pending && entry.pending.length) ? entry.pending[0].songKey : null;  // the song this row shows
    const strike = songId ? Actions.describe("dj.strike", { userId: user, songKey: songId })
                          : { enabled: false, reason: "No song to remove" };
    const nowMs = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : Date.now();
    const coolUntil = (typeof Queue !== "undefined" && Queue.lastStrikeTs)
      ? Queue.lastStrikeTs(user) + (Queue.STRIKE_COOLDOWN_MS || 0) : 0;
    return { ids, user, songId, i: index, last: ids.length - 1, nowMs, coolUntil, cooling: coolUntil > nowMs,
             canMove: Actions.describe("dj.move", { userId: user }).enabled,
             strike: { enabled: !!strike.enabled, reason: strike.reason || null },
             remove: (({ enabled, reason }) => ({ enabled: !!enabled, reason: reason || null }))(Actions.describe("dj.remove", { userId: user })) };
  }
  // The row's part of the record: everything its controls show. While cooling, the cooldown's END (not the seconds left, which
  // the button's title states once as it is drawn): an event during it redraws nothing, and the end redraws it (its timer).
  function _roomqRowRecord(s) {
    return [s.canMove, s.i === 0, s.i === s.last, s.strike.enabled, s.strike.reason, s.cooling ? s.coolUntil : 0, s.remove.enabled, s.remove.reason];
  }
  function _roomqRowControls(entry, index, rotation) {
    const s = _roomqRowState(entry, index, rotation);
    const ids = s.ids;
    const i = index, last = s.last;
    const isFirst = (i === 0), isLast = (i === last);
    const user = entry.user;
    const songId = s.songId;
    const mk = (glyph, title, fn, on) => {
      const b = H.el("button", { class: "mini rq-ctl", text: glyph, title: title, "aria-label": title });
      if (on) b.onclick = () => { if (H.roomqLocked()) return; fn(); }; else b.disabled = true;
      return b;
    };
    const sep = () => H.el("span", { class: "q-sep rq-ctl", "aria-hidden": "true" });   // hidden with the controls
    // Move is expressed as the reducer's "place AFTER <userId>" (null = to the front),
    // computed over the visible rotation order this row list is already in: up one = after
    // the member two above (or the front if we're second); down one = after our successor;
    // top = front; bottom = after the current last member.
    const moveAfter = (afterUserId) => Actions.perform("dj.move", { userId: user, afterUserId: afterUserId });
    const canMove = s.canMove;
    const moves = [
      mk("\u25B2",       "Move up",        () => moveAfter(i >= 2 ? ids[i - 2] : null), canMove && !isFirst),
      mk("\u25BC",       "Move down",      () => moveAfter(ids[i + 1]),                  canMove && !isLast),
      sep(),             // divide one-step moves from jump-to-end (matches My queue)
      mk("\u23EB\uFE0E", "Move to top",    () => moveAfter(null),                         canMove && !isFirst),
      mk("\u23EC\uFE0E", "Move to bottom", () => moveAfter(ids[last]),                    canMove && !isLast),
    ];
    // Remove ONE song — the one shown in this row (entry.pending[0]) — via ddjp.dj.strike.
    // Staff+ / rank-blind: the UI passes the songKey as DATA and lets Actions/Capabilities
    // decide. Plus an ADVISORY 3s per-DJ cooldown (display-only): once a strike lands this
    // DJ's ✕song greys until ServerClock.serverNow() >= Queue.lastStrikeTs(user) +
    // STRIKE_COOLDOWN_MS. The reducer enforces NO cooldown (it reads no time); a stale click
    // is still re-checked by Actions.perform. We schedule a re-render at expiry so it re-enables.
    const strikeDesc = s.strike;
    const nowMs = s.nowMs, coolUntil = s.coolUntil, cooling = s.cooling;
    const strikeTitle = cooling ? ("Cooling down \u2014 " + Math.ceil((coolUntil - nowMs) / 1000) + "s")
                                : (strikeDesc.enabled ? "Remove this song" : (strikeDesc.reason || "Can't remove song"));
    const strikeBtn = mk("\u2715\uD83C\uDFB5", strikeTitle,
                         () => Actions.perform("dj.strike", { userId: user, songKey: songId }),
                         strikeDesc.enabled && !cooling);
    strikeBtn.classList.add("rq-strike");
    if (cooling) _scheduleRoomqRerender(coolUntil - nowMs);   // re-enable the button when the cooldown lapses

    // Remove the whole DJ from the rotation via ddjp.dj.remove — now Staff+ / rank-blind
    // (Staff+ may remove anyone, exactly like the VIP+ skip-others rule). The UI passes only
    // the target id and lets Actions/Capabilities decide; the ✕person disables (with reason)
    // only when the target isn't in the rotation or I'm below Staff.
    const rmDesc = s.remove;
    const removeBtn = mk("\u2715\uD83D\uDC64", rmDesc.enabled ? "Remove DJ from rotation" : (rmDesc.reason || "Can't remove"),
                         () => Actions.perform("dj.remove", { userId: user }), rmDesc.enabled);
    removeBtn.classList.add("rq-remove");
    return moves.concat([sep(), strikeBtn, removeBtn]);   // ✕song then ✕DJ — guarded from a misclick
  }

  // THE ROOM QUEUE'S RECORD (J130): what `renderRoomQueue` draws, read as it reads it — whether Reset and the row controls are
  // offered; now playing's DJ (name and colour), its song, and its ★ and ▲ as they read; and a row per waiting DJ: name and
  // colour, the song shown, and the controls as they read. A DJ's later songs, another playing's counts, History, a rank no
  // name on it wears — none of them is drawn here, so none of them is in it.
  function _roomqRecord() {
    const np = Queue.getNowPlaying();
    const rotation = Queue.getRotation() || [];
    const canReset = !!Actions.describe("dj.reset").enabled;
    const canManageRows = !!rotation.length && !!Actions.describe("dj.move", { userId: rotation[0].user }).enabled;
    const who = (u) => [u, H.shortName(u), H.rankColor(H._rosterLevel(u))];
    const playing = !!(np && np.song);
    const rows = [];
    rotation.forEach((entry, idx) => {
      const vid = (entry.pending && entry.pending.length) ? entry.pending[0].songKey : null;
      if (!vid) return;
      rows.push([who(entry.user), vid, canManageRows ? _roomqRowRecord(_roomqRowState(entry, idx, rotation)) : null]);
    });
    return JSON.stringify([canReset, canManageRows, playing ? [who(np.dj), np.song.songKey, ChatPanels._npReactRecord()] : null, rows]);
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

    // ── THE "NOW PLAYING" LINE CARRIES THE CONTROLS (the owner, ddjp_635; the box around it went at J131) ─────────
    // "Reset rotation" (High-Staff+) sits at the left of the "Now Playing" line and the room-queue lock at its
    // far right, both 30 px high as everywhere in this panel. The lock is TIMED (5s) like Skip.
    // Room-queue management is rank-gated: a user who can't manage it sees neither the controls NOR the lock that
    // gates them — decided by the capability system, no rank check here. While locked, `.roomq-locked` HIDES Reset
    // and the row controls (not greys them), so the song information gets the room.
    const canReset = Actions.describe("dj.reset").enabled;
    const canManageRows = !!(rotation && rotation.length) &&
      Actions.describe("dj.move", { userId: rotation[0].user }).enabled;
    const showRoomqControls = canReset || canManageRows;
    refs.queueBody.classList.toggle("roomq-locked", H.roomqLocked() && showRoomqControls);   // gate the controls below

    // ONE LIST, AS MY QUEUE'S AND A PLAYLIST'S (J131, the owner's direction at `ddjp_654`). A line above it keeps Reset (left),
    // the bright-white "Now Playing" tag — "Nothing playing" when nothing is, in its place and style — and the lock (far
    // right); under it one block of rows, at My queue's rows' size and together: Now Playing first, a read-only (cacheOnly)
    // row with ▶ where the number goes, its DJ on the sub line in the DJ's colour, the blue edge and the ★ save / ▲ vote
    // affordances; then each waiting DJ's next song, numbered on from 2. The box that held Now Playing is gone. With nothing
    // playing the first row is an EMPTY PLAY ROW (below), the playing row's size, so nothing below moves when a song starts or
    // ends.
    const playing = !!(np && np.song);
    const npHead = H.el("div", { class: "rq-np-head" });
    if (canReset) {
      npHead.appendChild(H.el("button", { class: "danger rq-reset", text: "Reset rotation",
        onclick: () => { if (!H.roomqLocked()) Actions.perform("dj.reset").catch((e) => Logger.warn("reset: " + ((e && e.message) || e))); } }));
    }
    npHead.appendChild(H.el("span", { class: "rq-np-tag", text: playing ? "Now Playing" : "Nothing playing" }));
    // The lock only appears when there's actually a gated control to lock.
    if (showRoomqControls) {
      refs.roomqLockBtn = H._roomqLockBtn();
      npHead.appendChild(refs.roomqLockBtn);
    } else {
      refs.roomqLockBtn = null;
    }
    refs.queueBody.appendChild(npHead);
    const list = H.el("div", { class: "rq-list" });
    if (playing) {
      const npRow = PlaylistPanels.songRow(np.song.songKey, { pos: "\u25B6", sub: H.shortName(np.dj), thumbMode: "cacheOnly",
        actions: [ChatPanels._starBtn(), ChatPanels._voteBtn()] });
      npRow.classList.add("playing");
      const npWho = npRow.querySelector(".sr-when");
      if (npWho) {
        npWho.style.color = H.rankColor(H._rosterLevel(np.dj));
        Roster._wireCardTrigger(npWho, np.dj);   // the card, from the queue (J14)
      }
      list.appendChild(npRow);
    } else {
      // THE EMPTY PLAY ROW (the owner's, `main/04-features.md` §DJ rotation): the playing row's shape and height with nothing
      // playing in it — its picture's square empty (no ♪, and no preview: no role, no key, no handler; the sheet's
      // `.rq-np-empty`), ▶ where the number goes, no title and no DJ line, ★ and ▲ in their places, disabled with no numbers
      // (`_starBtn` / `_voteBtn`'s `empty`), so a click does nothing. Its edge stays grey: blue is the mark of a song playing.
      list.appendChild(H.el("div", { class: "song-row rq-np-empty", "aria-hidden": "true" }, [
        H.el("span", { class: "thumb-slot" }),
        H.el("span", { class: "sr-pos", text: "\u25B6" }),
        H.el("div", { class: "sr-main" }),
        H.el("span", { class: "uq-actions" }, [ChatPanels._starBtn({ empty: true }), ChatPanels._voteBtn({ empty: true })]),
      ]));
    }

    if (rotation && rotation.length) {
      // One row per waiting DJ (their next declared song). Each row shows the
      // thumbnail + id/title (filling in from cache/fetch), the user who queued it
      // (sub line, rank-coloured), and the wired reorder/remove controls (Staff+).
      rotation.forEach((entry, idx) => {
        const vid = (entry.pending && entry.pending.length) ? entry.pending[0].songKey : null;
        if (!vid) return;                        // a rotation entry always has >=1 pending song
        const row = PlaylistPanels.songRow(vid, {
          pos: (idx + 2) + ".",                  // numbered on from Now Playing (J131)
          thumbMode: "fetch",                    // load thumbnails/titles for the room queue now
          sub: H.shortName(entry.user),            // who queued it
          actions: canManageRows ? _roomqRowControls(entry, idx, rotation) : [],
        });
        const whoEl = row.querySelector(".sr-when");
        if (whoEl) {
          whoEl.style.color = H.rankColor(H._rosterLevel(entry.user));
          Roster._wireCardTrigger(whoEl, entry.user);   // the card, from the queue (J14)
        }
        list.appendChild(row);
      });
    }
    refs.queueBody.appendChild(list);
  }

  // Windowed render of a (possibly huge) in-RAM song list: only the visible
  // slice is in the DOM; top/bottom spacers keep the scrollbar proportional. The
  // full ID list stays in RAM (and storage); this just bounds what's painted.
  // Because the list lives fully in memory, the window is a pure function of the
  // scroll offset (WindowedList.visibleRange) — which lets us PRESERVE the scroll
  // position across re-renders (add/remove/reorder re-run this, and without the
  // saved offset the view would snap back to the top each time).
  // (Review-only DOM wiring; the windowing math itself is guarded.)
  const STACK_ROW_H = 34;          // fallback row height (px), only for a caller that passes no `rowH`: rows are drawn at the
                                   // `rowH` their caller passes (My queue and a playlist pass `SONG_ROW_H`, ui/playlists.js), which the spacers count
  const STACK_VIEWPORT_H = 320;    // fallback visible height (px) when we can't measure the panel
  const STACK_BUFFER = 6;          // off-screen rows rendered each side
  let _stackScrollTop = 0;         // preserved across re-renders within a room/tab session
  // Every tab click and room entry start the lists at the top — the playlists library's own offset too (J130, the owner:
  // "back to the top, as the other tabs"), which a redraw of the library otherwise keeps.
  function _resetStackScroll() {
    _stackScrollTop = 0;
    if (typeof PlaylistPanels !== "undefined" && PlaylistPanels.resetLibraryScroll) PlaylistPanels.resetLibraryScroll();
  }
  function _renderWindowedStack(parent, getList, rowFor, rowH) {
    const RH = (typeof rowH === "number" && rowH > 0) ? rowH : STACK_ROW_H;
    // Fill the space the panel actually gives us (flex:1) instead of a fixed cap, so
    // a tall window shows a long list and a short one scrolls. The virtual-scroll math
    // still needs a concrete pixel height, so we measure the scroller's own clientHeight
    // each paint (it flexes to fill), falling back to STACK_VIEWPORT_H before layout /
    // in headless. maxHeight is dropped in favour of flex + min-height:0 (set in CSS).
    const scroller = H.el("div", { class: "uq-scroll" });
    scroller.style.overflowY = "auto";
    // NO SCROLL ANCHORING (J130). Chromium keeps a node in view when content above it changes size, and every paint replaces
    // the rows and resizes the spacers — so it moved the scroll, which fired a scroll event, which painted again: measured on
    // 653, one scroll by hand to 600 set off twelve paints and ran the list to 1356. This list keeps its own place. Nothing
    // it shows changes.
    scroller.style.overflowAnchor = "none";
    const topSpacer = H.el("div");
    const rowsBox = H.el("div");
    const botSpacer = H.el("div");
    scroller.appendChild(topSpacer); scroller.appendChild(rowsBox); scroller.appendChild(botSpacer);
    parent.appendChild(scroller);

    function _viewportH() {
      const h = scroller.clientHeight;
      return (typeof h === "number" && h > 0) ? h : STACK_VIEWPORT_H;
    }
    // ONE PAINT PER RENDER (J130). A render painted, then again at the next frame, then again from the scroll restore's event
    // — the same window three times, every row rebuilt each time (measured in Chromium on 653: the first paint already reads
    // the scroller's real height). A paint now builds rows only when its window — first row, last row, the songs in it —
    // is not the one already on screen; otherwise it only sizes the spacers.
    let painted = null;   // { start, end, items } — the window on screen
    function paint() {
      const list = getList() || [];
      const r = WindowedList.visibleRange(_stackScrollTop, _viewportH(), RH, list.length, STACK_BUFFER);
      topSpacer.style.height = r.topPad + "px";
      botSpacer.style.height = r.botPad + "px";
      const items = list.slice(r.start, r.end);
      if (painted && painted.start === r.start && painted.end === r.end && painted.items.length === items.length &&
          painted.items.every((it, k) => it === items[k])) return;
      H.clear(rowsBox);
      for (let i = r.start; i < r.end; i++) {
        const row = rowFor(list[i], i);
        // EACH ROW IS DRAWN AT THE HEIGHT IT IS COUNTED: its outer height is RH, which the spacers count. (J130 reasoned that the
        // sheet drew rows content-box, 14 px taller than counted, from a reader that lost the page's first rule; in a browser
        // every box is border-box, so rows were drawn as counted, at 44, and J130's 58 made them taller. Every song row is 48 now,
        // the owner's, J131's correction. `SONG_ROW_H`, ui/playlists.js.)
        row.style.boxSizing = "border-box";
        row.style.height = RH + "px";
        rowsBox.appendChild(row);
      }
      painted = { start: r.start, end: r.end, items };
    }
    // A scroll event from a list already replaced (its render's restore, landing after the next render) reads 0 off a
    // detached node and would paint it and reset the shared offset to the top: it is ignored (J130).
    scroller.addEventListener("scroll", () => { if (!scroller.isConnected) return; _stackScrollTop = scroller.scrollTop; paint(); });
    paint();
    // Repaint once after layout settles: the first paint runs before the flex height is
    // known (clientHeight 0), so it would only render the fallback window. rAF gives the
    // browser a chance to lay the scroller out, then we fill the real height. Guarded for
    // headless (no rAF) where the fallback height already applied. (When the first paint
    // already had the height, this one finds its window on screen and builds nothing.)
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { if (scroller.isConnected) paint(); });
    // Restore the saved offset (after paint set the spacers, so scrollHeight is
    // correct). The browser clamps if the list shrank since last render.
    scroller.scrollTop = _stackScrollTop;
    return scroller;
  }

  function renderMyQueue() {
    // Add-by-link box
    const input = H.el("input", { class: "uq-input chat-tint", placeholder: "Paste a song link…" });   // the chat's tint (`ddjp_670`)
    const note = H.el("div", { class: "uq-note muted" });
    const addOne = () => {
      const v = input.value.trim();
      if (!v) return;
      const r = UserQueue.add(v);
      if (r.ok) {
        input.value = "";
        // NO NOTE FOR AN ADD (the owner's, `ddjp_678`: "need to remove small tests in my queue"): the song appearing in the
        // list is the answer, and Join says itself whether you are in the rotation. A refusal still says why, below; an add
        // clears an earlier refusal, so the line is empty again (and takes no room: `.uq-note:empty`).
        note.textContent = "";
      } else {
        note.textContent = "Couldn't add: " + r.reason;
      }
      Roster.renderJoinBtn();   // a newly-added song can enable the Join button
    };
    input.onkeydown = (e) => { if (e.key === "Enter") addOne(); };
    // The lock (right of Add) gates "✕ Clear", which sits LEFT of Add on this line (the owner, ddjp_637). Toggling the
    // lock — and arming/cancelling Clear — only re-renders Clear's small slot (no thumbnails), NOT the whole panel, so
    // the song rows don't flash. Non-timed.
    refs.uqLockBtn = H._uqLockBtnEl();
    refs.uqClear = H.el("span", { class: "uq-clear-slot" });
    refs.queueBody.appendChild(H.el("div", { class: "uq-add" }, [input, refs.uqClear, H.el("button", { text: "Add", onclick: addOne }), refs.uqLockBtn]));
    refs.queueBody.appendChild(note);
    // Mirror of the room-queue's .roomq-locked: while the My-Queue lock is engaged, the
    // .uq-locked class hides the per-row remove ✕ (see `.uq-locked .uq-remove`)
    // WITHOUT re-rendering the rows, so toggling the lock never flashes thumbnails.
    refs.queueBody.classList.toggle("uq-locked", H.uqLocked());

    H._renderUqClear();
    _uqList = null;
    _renderMyList();
  }

  // MY QUEUE'S RECORD (J130): the songs in order, and the top slots' commit states — all its list draws (a row's place,
  // its moves and ✕ follow from its index). The lock and Clear's arming repaint in place (ui/shell.js), so they are not in it.
  function _mineRecord() {
    const items = UserQueue.items ? UserQueue.items() : [];
    const slots = [];
    if (UserQueue.slotState) for (let i = 0; i < items.length; i++) { const s = UserQueue.slotState(i); if (s == null) break; slots.push(s); }
    return JSON.stringify([items.map((s) => s.songKey), slots]);
  }
  // MY QUEUE'S LIST, REDRAWN UNDER ITS ADD LINE (J130, the owner at `ddjp_653`): the list goes and comes back in its place —
  // the last thing in the pane — and Clear's slot follows the count; the add line, its typed link, its focus and its note
  // are not touched. It REMOVES the list it replaces before drawing the new one, so it can never draw a second copy
  // (`check-ui-render`).
  let _uqList = null;   // My queue's list now in the pane (the stack's scroller), or null when the queue is empty
  function _redrawMyList() {
    if (_uqList) { _uqList.remove(); _uqList = null; }
    H._renderUqClear();
    _renderMyList();
  }
  function _renderMyList() {
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
      for (let k = 0; k < Math.min(2, items.length); k++) top[items[k].songKey] = true;
      for (const v in _commitAnchors) if (!top[v]) delete _commitAnchors[v];
    }
    // An empty queue SAYS NOTHING (the owner, ddjp_637): the add line above is the way in.
    if (items.length) {
      const mv = (glyph, title, fn, on) => {
        const b = H.el("button", { class: "mini", text: glyph, title: title, "aria-label": title });
        if (on) b.onclick = fn; else { b.disabled = true; }   // disabled = same spot, greyed, inert
        return b;
      };
      const sep = () => H.el("span", { class: "q-sep", "aria-hidden": "true" });
      _uqList = _renderWindowedStack(refs.queueBody, () => (UserQueue.items ? UserQueue.items() : []), (song, i) => {
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
        // .uq-locked class on the queue body HIDES it and the separator guarding it (the owner, ddjp_635 —
        // flash-free, no row re-render, same mechanism as the room-queue controls) and the onclick guard
        // stops keyboard activation. The ▲▼⏫⏬ moves stay usable (reordering is reversible).
        const removeBtn = mv("\u2715", "Remove", () => { if (H.uqLocked()) return; UserQueue.removeAt(i); }, true);
        removeBtn.classList.add("uq-remove");
        const acts = moves.slice();
        if (moves.length) { const guard = sep(); guard.classList.add("uq-remove-sep"); acts.push(guard); }   // guard the ✕ from a misclick
        acts.push(removeBtn);
        const row = PlaylistPanels.songRow(song.songKey, {
          pos: isFirst ? "\u25B6" : (i + 1) + ".",
          thumbMode: "fetch",
          actions: acts
        });
        // Commit bar on the top-CAP rows only.
        const state = UserQueue.slotState ? UserQueue.slotState(i) : null;
        if (state) {
          const vid = song.songKey;
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
    roomEvent,   // J130: a room event, redrawing only what changed
  };
})();
