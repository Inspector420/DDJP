// ui/interface.js
// UI only. Reads from feature modules, fires user intents downward. No logic,
// no consensus, no direct Matrix or stream access — every read and write goes
// through a feature module. All DOM is built with createElement / textContent
// so no network-derived string is ever interpreted as HTML.
// Depends on: Room, Queue, Skip, Playback, UserQueue, Chat, RoomUpgrade, Store, Logger

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

  // ── Timing constants (ms) — UI feedback delays, poll intervals, and debounces.
  // Gathered so durations are named and tunable in one place. None of these
  // affect consensus or storage; they are purely presentation/timing niceties.
  const COUNTDOWN_TICK_MS       = 1000;  // live rate-limit countdown re-render cadence
  const COPY_LABEL_REVERT_MS    = 1400;  // a "Copied" button label reverts back after this
  const RECOVERY_COPY_REVERT_MS = 1500;  // same, for the recovery-key modal's copy button
  const SKIP_NOTE_CLEAR_MS      = 4000;  // transient skip/vote note auto-clears after this
  const SETTINGS_LOCK_CLEAR_MS  = 3000;  // optimistic settings lock releases + re-renders
  const UPGRADE_DONE_PAUSE_MS   = 600;   // hold the "Done" state briefly so the user sees it
  const VIDEO_META_POLL_MS      = 500;   // poll interval while waiting for video metadata (title)
  const VIDEO_META_MAX_POLLS    = 10;    // give up reading metadata after this many polls
  const YT_INIT_RETRY_MS        = 500;   // retry YT Player init until the iframe API is ready
  const PLAYER_LOAD_RETRY_MS    = 500;   // retry a queued load until the player reports ready
  const VOLUME_APPLY_DELAY_MS   = 1000;  // re-apply the saved volume shortly after a (re)load
  const YT_VOLUME_POLL_MS       = 400;   // poll the player's volume to mirror external changes
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
    _countdowns[key] = setInterval(tick, COUNTDOWN_TICK_MS);
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
        setTimeout(() => { btn.textContent = label; btn.classList.remove("copied"); }, COPY_LABEL_REVERT_MS);
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
  // Preview (mini-player, 14 §7) — a LOCAL-only player takeover. While active the
  // main player pauses in place and onPlaybackStateChange stops driving it (keeps
  // tracking via _lastNp). No protocol event is ever sent from here.
  let _previewActive = false, _previewPlayer = null, _previewOverlay = null, _previewKeyHandler = null;
  let _previewColumn = null, _previewResizeHandler = null;   // the column the preview floats over + its reposition hook
  let _lastNp = null;   // latest consensus now-playing, cached so preview re-syncs to LIVE on close
  let queueTab = "room";   // "room" | "mine" | "history" | "playlists"
  let rightTab = "chat"; // "chat" | "people" | "roomset" | "gear"
  let gearTab = "logs";  // sub-tab within the gear panel: "logs" | "settings"
  // Playlists panel (14 §5 / P3). The panel is two-level: the LIBRARY (list of
  // playlists) or INSIDE one playlist (its tracks). Transient per-row UI state
  // (which row is armed for a two-step delete, which is being renamed) lives here
  // so it survives the panel's full re-render on a Playlists.onChange.
  let _plView = "list";        // "list" (library) | a playlist id (inside one)
  let _plInited = false;       // one-time Playlists.init() guard (user-global feature)
  let _plConfirmDelete = null; // playlist id armed for the two-step inline delete
  let _uqConfirmClear = false;  // My-Queue "Clear" armed for its two-step inline confirm
  let _plRenaming = null;      // playlist id whose name row is an inline editor
  let _plRemoveArm = null;     // "<playlistId>\0<videoId>" armed for a two-step track remove
  const _plCounts = {};        // id -> track count, cached so the library list doesn't reload every render
  // The now-playing ★ (save to a playlist) and ▲ (upvote) affordances are backed by the
  // Reactions feature module, keyed by PLAY-INSTANCE (not videoId): pressing emits a
  // spine event (ddjp.dj.save / ddjp.dj.vote) and latches the button "on" for the current
  // song; it goes live again when the song changes. The star opens the same add-to-
  // playlist picker as History's ＋, and only latches if a track was actually added. Both
  // affordances appear in two places (the player bar + the room-queue now-playing row) and
  // read the same Reactions state, so pressing one reflects in the other. No UI-local
  // pressed-state is kept here — the module is the single source of truth.
  let layoutMode = "wide";   // "wide" | "compact" | "phone" — the layout selector (header button)
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
  const _lockTimers = { skip: 0, leave: 0 };   // pending auto-relock setTimeout handles
  // Room-settings master lock (owner-only, local-only, view-only). Like skip/leave it
  // DEFAULTS to LOCKED and re-locks whenever the owner (re-)enters the Room settings tab,
  // so a stray click can't change room config. UNLIKE skip/leave there is NO timed
  // auto-relock: once the owner unlocks, settings stay editable until they lock again or
  // leave the tab. When locked, every settings control is inert.
  let _settingsLocked = true;
  // Header responsive shrinker state. The header shrinks in PRIORITY order when it
  // overflows: server part of @user:server dies first, then username, then rank,
  // then room title (always >=1 char), then the back button collapses to an arrow.
  // The copy buttons, layout button, and avatar never shrink.
  const _headerFit = { fullId: "", fullRank: "", level: 0, ro: null };
  let _marqueeRo = null;   // ResizeObserver on the title box — re-fits the marquee on width changes (window resize, layout switch)
  let _marqueeSeq = 0;     // bumped per fit → a UNIQUE @keyframes name each time, so resize never reuses a stale travel distance
  let _marqueeRaf = 0;     // pending rAF handle, so rapid resize/RO bursts coalesce to one fit
  let _chatPrefsWired = false;  // ChatPrefs load + onChange subscription happen once
  let _lastChatTier = null; // so we can clear the chat box when the main chat tier changes
  let _reflectCryptoBanner = null;   // set in buildMainDom; shows/hides the "secure chat offline" banner from Chat.cryptoReady()
  let _cryptoPollStarted = false;    // guard so the health poll is wired once
  const _setLocks = {};   // settingKey -> true while a just-changed option is locked (3s)
  // Local-only playback volume/mute. Never a protocol event — applies to THIS
  // browser's player instance only. Re-applied on every player state change so
  // a fresh video (which YouTube resets to its own default volume) is forced
  // back to the user's chosen level/mute state as fast as possible.
  const volumeState = { level: 100, muted: false };
  // The last volume/mute the APP pushed into the YT player. Used to tell an
  // in-iframe change (user moved YouTube's own slider) apart from our own writes:
  // if a poll reads a value different from what we pushed, the user changed it
  // inside the iframe and we adopt it (two-way sync).
  const _ytVol = { pushedLevel: -1, pushedMuted: null, pollTimer: null };
  const refs = {};

  // --- Room background engine ------------------------------------------------
  // Paints the room's background image (a translucent glass card sits over it per
  // column). The room SETTING (ddjp.room.settings.bg) carries a validated link;
  // each client downloads the bytes into its own per-room blob cache
  // (Store.background) and paints from the blob — never a passive CSS load of a
  // remote URL. Flow per setting value:
  //   • null/cleared           -> remove the background
  //   • same as what's painted  -> no-op
  //   • new/different           -> debounce 5s, then (only if it's STILL the
  //                                latest setting) cache-or-fetch and paint
  // The 5s debounce means rapid owner changes (5 links in 5s) collapse to ONE
  // download — the last one — because each new value cancels the prior timer and
  // the timer re-checks the live setting before doing any work. No fetch
  // fallback: if the download fails, the room simply shows no background.
  // Gated by the per-user bgEnabled toggle (ChatPrefs); when off, nothing paints
  // and nothing downloads.
  const _bg = {
    roomId: null,        // the space this engine is currently bound to
    paintedUrl: null,    // the setting URL currently painted (or null)
    objectUrl: null,     // the live object URL backing the CSS (revoked on swap)
    timer: null,         // pending debounce timer
    seq: 0,              // bumps on every setting change; a resolve aborts if stale
  };

  // The element we paint the background + scrim onto.
  function _bgLayer() { return document.getElementById("screen-main"); }

  // Push the per-user dim sliders (percent 10..100 in ChatPrefs) onto the two CSS
  // custom properties the scrim + glass cards read (alpha = percent/100). View-only:
  // it sets two variables, never rebuilds or moves any DOM. Called on entry and on
  // every ChatPrefs change (the onChange wiring), so adjusting a slider is live.
  function _applyDisplayDims() {
    const layer = _bgLayer();
    if (!layer) return;
    layer.style.setProperty("--bg-dim", (ChatPrefs.bgDim() / 100).toFixed(2));
    layer.style.setProperty("--panel-dim", (ChatPrefs.panelDim() / 100).toFixed(2));
  }

  // Live preview for a single dim var during a slider drag — sets the CSS var
  // straight from the slider value WITHOUT persisting (so the settings panel isn't
  // rebuilt mid-drag). The value is committed to ChatPrefs on the slider's `change`
  // (drag end), which persists + re-renders from the saved, clamped value.
  function _setDimVar(varName, percent) {
    const layer = _bgLayer();
    if (layer) layer.style.setProperty(varName, (percent / 100).toFixed(2));
  }

  // Drop the painted image (and free its object URL). Leaves the CSS default
  // (#111) showing. Does NOT touch the cache — clearing the VIEW only.
  function _bgUnpaint() {
    const layer = _bgLayer();
    if (layer) { layer.style.backgroundImage = ""; layer.classList.remove("has-bg"); }
    if (_bg.objectUrl) { try { URL.revokeObjectURL(_bg.objectUrl); } catch (e) {} _bg.objectUrl = null; }
    _bg.paintedUrl = null;
  }

  // Paint a blob as the background. Swaps the object URL atomically (new one
  // created before the old is revoked) so there's no flash to the default.
  function _bgPaintBlob(blob, settingUrl) {
    const layer = _bgLayer();
    if (!layer) return;
    let next;
    try { next = URL.createObjectURL(blob); } catch (e) { return; }
    const prev = _bg.objectUrl;
    layer.style.backgroundImage = "url(\"" + next + "\")";
    layer.classList.add("has-bg");
    _bg.objectUrl = next;
    _bg.paintedUrl = settingUrl;
    if (prev) { try { URL.revokeObjectURL(prev); } catch (e) {} }
  }

  // Re-apply the engine's current state against the live toggle. Called when the
  // user flips "Room backgrounds" on/off in Settings: off -> unpaint immediately;
  // on -> re-evaluate the current room setting (may trigger a download).
  function _bgApplyToggle() {
    if (!_bg.roomId) return;
    const on = ChatPrefs.bgOpts().bgOn;
    if (!on) { _bgUnpaint(); return; }
    const cur = (Room.getSettings() || {}).bg || null;
    _bgOnSetting(_bg.roomId, cur, true);   // local trigger — paint immediately, no 5s wait
  }

  // Resolve a setting URL to a painted background: cache hit (cached url matches)
  // paints from the blob; a miss/divergence downloads, caches, then paints — but
  // only if this is still the latest setting (seq guard) and the toggle is on.
  function _bgResolve(spaceId, safeUrl, mySeq) {
    Promise.resolve(Store.background.load(spaceId)).then((cached) => {
      if (mySeq !== _bg.seq || _bg.roomId !== spaceId) return;          // superseded
      if (!ChatPrefs.bgOpts().bgOn) return;                            // toggled off meanwhile
      if (cached && cached.url === safeUrl && cached.blob) { _bgPaintBlob(cached.blob, safeUrl); return; }
      // Miss or different URL — download the bytes, cache, paint.
      fetch(safeUrl).then((res) => {
        if (!res.ok) throw new Error("bg http " + res.status);
        return res.blob();
      }).then((blob) => {
        if (mySeq !== _bg.seq || _bg.roomId !== spaceId) return;        // superseded mid-download
        if (!ChatPrefs.bgOpts().bgOn) return;                          // toggled off mid-download
        Store.background.persist(spaceId, safeUrl, blob);              // cache (fire-and-forget)
        _bgPaintBlob(blob, safeUrl);
      }).catch((e) => { Logger.warn("background: load failed — showing none"); });   // no fallback by design
    }).catch(() => {});
  }

  // The entry point: react to a (possibly new) bg setting value. `immediate`
  // skips the 5s debounce — used for LOCAL triggers (room entry, the user
  // enabling the toggle), where there's no flood to protect against and the user
  // expects the image now. The debounce exists only to collapse rapid OWNER
  // setting changes (5 links in 5s -> one download), so only that path waits.
  function _bgOnSetting(spaceId, rawUrl, immediate) {
    if (_bg.roomId !== spaceId) return;   // setting for a room we've since left
    _bg.seq++;                            // any in-flight resolve from a prior value is now stale
    if (_bg.timer) { clearTimeout(_bg.timer); _bg.timer = null; }

    // Validate against the user's background provider allowlist (shared with chat
    // images). An invalid/unauthorized/cleared link paints nothing.
    const safeUrl = rawUrl ? Media.safeBgUrl(rawUrl, ChatPrefs.bgOpts().hostAllowed) : null;

    if (!safeUrl) { _bgUnpaint(); return; }              // cleared or not allowed
    if (!ChatPrefs.bgOpts().bgOn) { _bgUnpaint(); return; }  // user has backgrounds off
    if (safeUrl === _bg.paintedUrl && _bg.objectUrl) return; // already showing this exact image

    const mySeq = _bg.seq;
    if (immediate) { _bgResolve(spaceId, safeUrl, mySeq); return; }   // local trigger — paint now
    _bg.timer = setTimeout(() => {
      _bg.timer = null;
      if (mySeq !== _bg.seq || _bg.roomId !== spaceId) return;          // a newer change arrived
      // Re-read the LIVE setting: only proceed if it still equals what we queued
      // (this is what makes 5-changes-in-5s download only the final one).
      const live = (Room.getSettings() || {}).bg || null;
      const liveSafe = live ? Media.safeBgUrl(live, ChatPrefs.bgOpts().hostAllowed) : null;
      if (liveSafe !== safeUrl) return;                                // setting moved on
      _bgResolve(spaceId, safeUrl, mySeq);
    }, 5000);
  }

  // Bind/unbind the engine to a room. Entering applies the current setting once;
  // leaving cancels any pending work and clears the view (cache is kept).
  function _bgEnterRoom(spaceId) {
    _bg.roomId = spaceId;
    _bg.seq++;
    _bgUnpaint();
    const cur = (Room.getSettings() || {}).bg || null;
    _bgOnSetting(spaceId, cur, true);   // local trigger — paint immediately on entry
  }
  function _bgLeaveRoom() {
    if (_bg.timer) { clearTimeout(_bg.timer); _bg.timer = null; }
    _bg.seq++;
    _bg.roomId = null;
    _bgUnpaint();
    // Stop the two-way volume poll — the player is going away; it restarts on the
    // next player-ready. (Was previously left running after leaving a room.)
    if (_ytVol.pollTimer) { clearInterval(_ytVol.pollTimer); _ytVol.pollTimer = null; }
    if (_marqueeRo) { try { _marqueeRo.disconnect(); } catch (e) {} _marqueeRo = null; }
    if (_marqueeRaf) { cancelAnimationFrame(_marqueeRaf); _marqueeRaf = 0; }
    _thumbReset();                                  // disconnect the thumbnail viewport observer + clear pending fetches
    if (_lockTimers.skip)  { clearTimeout(_lockTimers.skip);  _lockTimers.skip = 0; }
    if (_lockTimers.leave) { clearTimeout(_lockTimers.leave); _lockTimers.leave = 0; }
    _skipLocked = true; _leaveLocked = true;   // next room entry starts locked
  }

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
    if (typeof _fitMarquee === "function") _fitMarquee();   // title box width changes per mode
    if (_previewActive) _positionPreview();   // keep an open preview pinned to its column across a layout switch
  }

  function _setLayout(mode) {
    if (!LAYOUTS.some(l => l.id === mode)) return;
    layoutMode = mode;
    _applyLayout();
    if (refs.layoutMenu) refs.layoutMenu.style.display = "none";
  }
  function _setPhonePane(pane) { phonePane = pane; _applyLayout(); }
  function _setCompactSide(side) { compactSide = side; _applyLayout(); }

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
    // L5+: collapse the back button's padding. Its label is already just the arrow
    // (the word "Rooms" was dropped), so only the collapsed styling toggles here.
    if (backBtn) {
      backBtn.classList.toggle("collapsed", n >= 5);
      backBtn.textContent = "\u2190";
    }
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

  // --- Logger → Logs tab -----------------------------------------------------
  // The bottom debug log, relocated into the Logs tab. Lines from BEFORE this
  // page load (restored from storage) render grey; lines logged in THIS session
  // render green. Persisted (capped) so "older" actually exists across reloads.
  const _logCap = 300;
  let _priorLog = [];
  let _sessionLog = [];
  // Hydrate the prior log asynchronously (Store.logs is now IndexedDB-backed).
  // Only seeds _priorLog; _sessionLog accumulates live, so a late resolve is safe.
  Promise.resolve(Store.logs.load()).then((saved) => {
    if (Array.isArray(saved)) _priorLog = saved.slice(-_logCap);
  }).catch(() => {});
  let _logSaveTimer = null;
  function _saveLogSoon() {
    if (_logSaveTimer) return;
    _logSaveTimer = setTimeout(() => {
      _logSaveTimer = null;
      try { Store.logs.persist(_priorLog.concat(_sessionLog).slice(-_logCap)); } catch (e) {}
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
    if (_previewActive) _closePreview();   // never leave a floating preview behind on navigation
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

    const ownedRaw = (scanned && scanned.owned) || [];
    const joined = (scanned && scanned.joined) || [];
    const invited = (scanned && scanned.invited) || [];

    // An interrupted creation (this or a prior session) — its half-built space
    // already shows up in `owned`, so pull it out and present it as a dedicated
    // "Finish creating" entry instead, to avoid a broken double-listing.
    const pending = (Room.pendingCreate && Room.pendingCreate()) || null;
    const owned = pending ? ownedRaw.filter(r => r.spaceId !== pending.spaceId) : ownedRaw;

    if (!pending && owned.length === 0 && joined.length === 0 && invited.length === 0) {
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

    if (pending) {
      list.appendChild(el("h3", { class: "room-section-title", text: "Finish creating" }));
      const row = el("div", { class: "room-item room-invite-row" });
      row.appendChild(el("span", { class: "room-invite-name",
        text: (pending.name || pending.spaceId) + " — interrupted (" + pending.built + "/" + pending.total + " channels)" }));
      const resumeBtn = el("button", { class: "btn-primary room-accept-btn", text: "Resume" });
      resumeBtn.onclick = () => {
        resumeBtn.disabled = true; resumeBtn.textContent = "Resuming…";
        if (_resumeHandler) _resumeHandler(pending);
        else Logger.warn("Interface: no resume handler registered");
      };
      const discardBtn = el("button", { class: "btn-secondary room-accept-btn", text: "Discard" });
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
      _bgLeaveRoom();
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
    _resetStackScroll();   // a new room's queue starts at the top (scroll is preserved within a room)
    buildMainDom(main, room);

    // Wire feature callbacks. Each one only re-renders the affected region.
    Queue.onStateChange(() => { renderNowPlaying(); renderQueuePanel(); renderRoster(); renderJoinBtn(); });
    Playback.onStateChange(onPlaybackStateChange);
    Chat.onMessage(addChatMessage);
    // Reflect the secure-chat banner now (crypto init has already run by the time we reach
    // the main screen) and keep it current with a light poll — crypto can recover (a retry
    // elsewhere) or lapse (token expiry) out of band, so the banner shouldn't be one-shot.
    if (_reflectCryptoBanner) _reflectCryptoBanner();
    if (!_cryptoPollStarted) { _cryptoPollStarted = true; setInterval(() => { if (_reflectCryptoBanner) _reflectCryptoBanner(); }, 5000); }
    // One-shot recent backfill for this room's chat (the room-settings default
    // channel; present-forward after). currentChatId is set by Room's wiring first.
    if (refs.chatBox) _backfillChatOnce(refs.chatBox);
    UserQueue.onChange(() => { if (queueTab === "mine") renderQueuePanel(); renderJoinBtn(); });
    // My ★/▲ latch is derived from my own vote/add events on the spine. Those don't move
    // consensus state (the reducer ignores them), so the Queue.onStateChange render above
    // won't fire when they replay on reload — this re-presses the buttons when the latch
    // is (re)built from history, and on any live echo.
    if (typeof Reactions !== "undefined" && Reactions.onChange) {
      Reactions.onChange(() => { _syncNpButtons(); if (queueTab === "room") renderQueuePanel(); });
    }
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
      if (s && s.chat !== _lastChatTier) { if (refs.chatBox) { clear(refs.chatBox); _resetChatState(refs.chatBox); } _lastChatTier = s.chat; }
      _bgOnSetting(_bg.roomId, (s && s.bg) || null);   // react to a background link change (debounced)
      renderSettings();
    });

    renderMyRank();
    renderNowPlaying();
    renderQueuePanel();
    renderRoster();
    renderUpgradePanel();
    renderSettings();
    renderLogs();
    if (!_chatPrefsWired) {
      ChatPrefs.load();
      // A pref change re-renders the mounted chat (text <-> image/link) and the
      // settings panel itself (checkboxes / chips reflect the persisted state).
      // The bg toggle also lives in ChatPrefs, so re-apply the background here:
      // flipping "Room backgrounds" off unpaints immediately; on re-evaluates the
      // current room setting (may download).
      ChatPrefs.onChange(() => { _repaintChat(refs.chatBox); renderChatSettings(); renderSettings(); _bgApplyToggle(); _applyDisplayDims(); });
      _chatPrefsWired = true;
    }
    _applyDisplayDims();   // push the saved dim levels onto the CSS vars for this entry
    renderChatSettings();
    _renderGear();
    _lastChatTier = Room.getSettings().chat;
    renderRightPanel();
    renderJoinBtn();
    _bgEnterRoom(room && room.spaceId ? room.spaceId : (Room.getCurrent() || {}).spaceId || null);
    initYouTubePlayer();
  }

  function buildMainDom(main, room) {
    // Header: back, room title (+ room code next to it), upgrade slot, my identity on the right.
    const backBtn = el("button", { class: "back-btn", text: "\u2190" });
    backBtn.onclick = () => { _bgLeaveRoom(); showScreen("screen-rooms"); renderRoomList(Room.scanDDJPRooms()); };
    refs.backBtn = backBtn;

    // The room's Matrix space id is intentionally NOT shown as text (it's long and noisy);
    // the copy button beside the title still copies it for invites/sharing.
    const copyIdBtn = copyButton("⧉", () => room.spaceId || "", "copy-btn copy-id-btn icon-only", "Copy room ID");
    refs.roomTitle = el("h2", { text: room.name || room.spaceId });
    const titleGroup = el("div", { class: "title-group" }, [
      refs.roomTitle,
      copyIdBtn
    ]);

    // NOTE — deliberate, scoped exception to the "display names only" rule
    // (03_fundamentals.md / CLAUDE.md): this shows the CURRENT USER's OWN full
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
      refs.upgradeSlot = el("div", { class: "upgrade-slot" }),
      _buildLayoutSelector(),
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
        const result = await Skip.skip();
        if (!result.ok && refs.skipNote) {
          refs.skipNote.textContent = result.reason || "Skip didn't go through";
          setTimeout(() => { if (refs.skipNote) refs.skipNote.textContent = ""; }, SKIP_NOTE_CLEAR_MS);
        }
      } catch (e) {
        Logger.warn(e.message);
        if (refs.skipNote) refs.skipNote.textContent = "Skip failed — try again";
      } finally {
        renderNowPlaying();   // re-evaluate disabled state from real stream state
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
    refs.progressFill = el("div", { class: "progress-fill" });
    refs.progressBar = el("div", { class: "progress-bar" }, [refs.progressFill]);
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
      renderJoinBtn();
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
    refs.muteBtn = el("button", { class: "mute-btn", text: "🔊" });
    refs.muteBtn.onclick = () => { volumeState.muted = !volumeState.muted; applyVolumeState(); };

    // ★ save-to-playlist + ▲ upvote for the now-playing song, backed by Reactions
    // (see the note by the top-of-file state comment). They act on the current song and
    // reflect its latched add/vote state; disabled when nothing is playing. Same handlers
    // drive the room-queue now-playing row, so the two locations stay in step.
    refs.grabBtn = el("button", { class: "mini ico grab", text: "\u2606", title: "Save this song" });
    refs.grabBtn.onclick = _onStarPress;
    refs.upvoteBtn = el("button", { class: "mini ico upvote", text: "\u25B2", title: "Upvote this song" });
    refs.upvoteBtn.onclick = _onVotePress;
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
    refs.tabRoom.onclick = () => { queueTab = "room"; _resetStackScroll(); renderQueuePanel(); };
    refs.tabMine.onclick = () => { queueTab = "mine"; _uqConfirmClear = false; _resetStackScroll(); renderQueuePanel(); };
    refs.tabHistory.onclick = () => { queueTab = "history"; _uqConfirmClear = false; _resetStackScroll(); renderQueuePanel(); };
    refs.tabPlaylists.onclick = () => { queueTab = "playlists"; _plView = "list"; _plRemoveArm = null; _plConfirmDelete = null; _uqConfirmClear = false; _resetStackScroll(); renderQueuePanel(); };
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
    refs.chat = el("div", { class: "chat" }, [
      refs.chatCryptoBanner,
      refs.chatBox,
      el("div", { class: "chat-input-row" }, [refs.chatInput, el("button", { text: "Send", onclick: sendChat })])
    ]);

    // Tabs: chat · people · room-set · logs — one panel visible at a time. Each
    // panel keeps rendering into its (hidden) DOM even when not active, so chat
    // history and the live log aren't lost while another tab is showing.
    refs.tabChat = el("button", { class: "tab", text: "Chat" });
    refs.tabPeople = el("button", { class: "tab", text: "People" });
    refs.tabRoomset = el("button", { class: "tab", text: "Room" });
    refs.tabGear = el("button", { class: "tab tab-gear", text: "⚙", title: "Logs & settings" });
    refs.tabChat.onclick = () => { rightTab = "chat"; renderRightPanel(); };
    refs.tabPeople.onclick = () => { rightTab = "people"; renderRightPanel(); };
    refs.tabRoomset.onclick = () => { rightTab = "roomset"; _settingsLocked = true; renderSettings(); renderRightPanel(); };
    refs.tabGear.onclick = () => { rightTab = "gear"; _renderGear(); renderRightPanel(); };

    // Room settings panel (form of toggles; owner-editable, everyone can see).
    refs.settingsBox = el("div", { class: "settings-box" });
    refs.settings = el("div", { class: "settings" }, [refs.settingsBox]);

    // Logs sub-panel (the relocated debug log).
    refs.logsBox = el("div", { class: "logs-box" });
    refs.logs = el("div", { class: "logs" }, [refs.logsBox]);

    // Settings sub-panel (chat image/link display prefs).
    refs.chatSettingsBox = el("div", { class: "chat-settings-box" });
    refs.chatSettings = el("div", { class: "chat-settings" }, [refs.chatSettingsBox]);

    // The gear panel nests a Logs / Settings sub-tab bar over the two sub-panels.
    refs.subtabLogs = el("button", { class: "subtab", text: "Logs" });
    refs.subtabSettings = el("button", { class: "subtab", text: "Settings" });
    refs.subtabLogs.onclick = () => { gearTab = "logs"; renderLogs(); _renderGear(); };
    refs.subtabSettings.onclick = () => { gearTab = "settings"; renderChatSettings(); _renderGear(); };
    refs.gear = el("div", { class: "gear-panel" }, [
      el("div", { class: "subtabs" }, [refs.subtabLogs, refs.subtabSettings]),
      refs.logs,
      refs.chatSettings
    ]);

    refs.rightBarMount = el("div", { class: "col-bar-mount" });
    const rightPanel = el("div", { class: "right-panel" }, [
      refs.rightBarMount,
      el("div", { class: "tabs" }, [refs.tabChat, refs.tabPeople, refs.tabRoomset, refs.tabGear]),
      refs.roster,
      refs.chat,
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
        _marqueeRo = new ResizeObserver(() => _fitMarquee());
        _marqueeRo.observe(refs.videoTitle);
      }
    } else {
      window.addEventListener("resize", _fitHeader);
      window.addEventListener("resize", _fitMarquee);
    }
    _fitHeader();
  }

  // --- My rank + own avatar (live) ---
  function renderMyRank() {
    const myId = Room.getMyId() || "";
    _headerFit.fullId = myId;                       // remember the full @user:server for the shrinker
    if (refs.myIdBadge) refs.myIdBadge.textContent = myId;
    if (refs.rankBadge) {
      _headerFit.fullRank = rankName(Room.getMyRank());
      refs.rankBadge.textContent = _headerFit.fullRank;
    }
    _fitHeader();                                   // re-apply responsive shrink after text changes
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
    _syncNpButtons();   // keep the player-bar grab/upvote in step with the current song
    // Skip tracks CONSENSUS now-playing (Skip.canSkip), not the local wall-clock
    // "ended" estimate — a song that's still the current play-instance stays
    // skippable even if this client guessed it was over.
    if (refs.skipBtn) refs.skipBtn.disabled = !Skip.canSkip(np);
    if (_endedNow || !np || !np.song) {
      // Nothing playing right now: either the derived state has no real song, or
      // the current one genuinely finished (_endedNow, set from the real iframe
      // ENDED — no longer from the wall-clock estimate). In both cases show
      // "Nothing playing" and don't present a song to replay — Playback's tick
      // advances the rotation (or it stays empty if idle).
      if (refs.npLabel) refs.npLabel.textContent = "Nothing playing";
      refs.npAvatar = null;   // force label rebuild on next song
      clearProgress();        // hide the progress bar when nothing is playing
      _currentSong = null;
      updateVideoTitle();
      return;
    }
    // Show the playback time, never the raw video ID. Until the ticking playback
    // update kicks in (which has precise elapsed/duration), derive a coarse elapsed
    // from startedAt so the line reads as a clock, not an ID.
    let mid = "";
    if (np.startedAt) {
      const elapsed = Math.max(0, Math.floor((Date.now() - np.startedAt) / 1000));
      mid = " · " + fmt(elapsed);
    }
    _setNpLabel(np.dj, mid);
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
    if (refs.tabGear) refs.tabGear.classList.toggle("active", t === "gear");
    if (refs.chat) refs.chat.style.display = t === "chat" ? "flex" : "none";
    if (refs.roster) refs.roster.style.display = t === "people" ? "flex" : "none";
    if (refs.settings) refs.settings.style.display = t === "roomset" ? "flex" : "none";
    if (refs.gear) refs.gear.style.display = t === "gear" ? "flex" : "none";
  }

  // The gear panel's own Logs / Settings sub-tabs (one sub-panel visible at a time).
  function _renderGear() {
    const g = gearTab;
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
  function renderChatSettings() {
    const boxEl = refs.chatSettingsBox;
    if (!boxEl) return;
    clear(boxEl);
    // Images: ONE shared provider list, TWO independent toggles — inline chat
    // images and room backgrounds. The list greys only when BOTH are off; with
    // either on it stays active (it's feeding a live consumer). Removing a host
    // drops it from both at once (the merged-providers design).
    boxEl.appendChild(_prefSection({
      note: "Off by default. These approved providers are shared by inline chat images and room backgrounds. A provider sees your IP when an image loads from it.",
      toggles: [
        { label: "Images in chat", on: ChatPrefs.imagesEnabled(), onToggle: (v) => ChatPrefs.setImagesEnabled(v) },
        { label: "Room backgrounds", on: ChatPrefs.bgEnabled(), onToggle: (v) => ChatPrefs.setBgEnabled(v) },
      ],
      defaults: ChatPrefs.imageDefaults(),
      onDefault: (h, on) => ChatPrefs.setDefaultImageHost(h, on),
      custom: ChatPrefs.imageCustomHosts(),
      onAdd: (h) => ChatPrefs.addImageHost(h),
      onRemove: (h) => ChatPrefs.removeImageHost(h),
    }));
    boxEl.appendChild(_prefSection({
      title: "Links in chat",
      note: "Off by default. When on, a link to an allowed host becomes clickable and opens in a new tab.",
      enabled: ChatPrefs.linksEnabled(),
      onToggle: (v) => ChatPrefs.setLinksEnabled(v),
      defaults: ChatPrefs.linkDefaults(),
      onDefault: (h, on) => ChatPrefs.setDefaultLinkHost(h, on),
      custom: ChatPrefs.linkCustomHosts(),
      onAdd: (h) => ChatPrefs.addLinkHost(h),
      onRemove: (h) => ChatPrefs.removeLinkHost(h),
    }));
    boxEl.appendChild(_dimSection());
  }

  // The background/panel dimness sliders (percent 10..100, per-user). Live preview
  // on drag (CSS var only); commit to ChatPrefs on release. View-only — no DOM
  // rebuild during a drag, no protocol event.
  function _dimRow(label, getPct, varName, commit, range) {
    const valEl = el("span", { class: "dim-val", text: getPct() + "%" });
    const lbl = el("div", { class: "dim-label" }, [el("span", { text: label }), valEl]);
    const slider = el("input", {
      type: "range", class: "dim-slider",
      min: String(range.min), max: String(range.max), step: "1",
      value: String(getPct()),
    });
    slider.oninput  = () => { const v = Number(slider.value); valEl.textContent = v + "%"; _setDimVar(varName, v); };
    slider.onchange = () => { commit(Number(slider.value)); };
    return el("div", { class: "dim-row" }, [lbl, slider]);
  }
  function _dimSection() {
    const sec = el("div", { class: "pref-section" });
    sec.appendChild(el("div", { class: "pref-master-row" }, [el("span", { class: "pref-title", text: "Appearance" })]));
    sec.appendChild(el("div", { class: "pref-note", text: "How dark the room background and the panels look. Applies to this device only." }));
    sec.appendChild(_dimRow("Background dimness", () => ChatPrefs.bgDim(),   "--bg-dim",   (v) => ChatPrefs.setBgDim(v),   ChatPrefs.DIM_RANGES.bgDim));
    sec.appendChild(_dimRow("Panel dimness",      () => ChatPrefs.panelDim(), "--panel-dim", (v) => ChatPrefs.setPanelDim(v), ChatPrefs.DIM_RANGES.panelDim));
    return sec;
  }

  // One settings section. Supports a SHARED host list governed by one or more
  // master toggles: the list is active when ANY toggle is on, and greys only when
  // ALL are off. `cfg.toggles` is an array of { label, on, onToggle }; the legacy
  // single-toggle form (cfg.enabled/onToggle/title) is still accepted and wrapped.
  // Checkbox `.checked`/`.onchange` are set imperatively (el doesn't bind those).
  // Mutations go through ChatPrefs, which notifies onChange -> the panel
  // re-renders, so controls always reflect persisted state.
  function _prefSection(cfg) {
    const sec = el("div", { class: "pref-section" });

    // Normalize to a toggle list. Legacy callers pass title/enabled/onToggle.
    const toggles = Array.isArray(cfg.toggles) && cfg.toggles.length
      ? cfg.toggles
      : [{ label: cfg.title, on: cfg.enabled, onToggle: cfg.onToggle }];
    const anyOn = toggles.some(t => !!t.on);   // list active when ANY toggle is on

    for (const t of toggles) {
      const master = el("input", { type: "checkbox", class: "pref-master" });
      master.checked = !!t.on;
      master.onchange = () => t.onToggle(master.checked);
      sec.appendChild(el("label", { class: "pref-master-row" }, [master, el("span", { class: "pref-title", text: t.label })]));
    }
    if (cfg.note) sec.appendChild(el("div", { class: "pref-note", text: cfg.note }));

    const hosts = el("div", { class: "pref-hosts" + (anyOn ? "" : " pref-disabled") });

    for (const d of cfg.defaults) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = !!d.on;
      cb.disabled = !anyOn;
      cb.onchange = () => cfg.onDefault(d.host, cb.checked);
      hosts.appendChild(el("label", { class: "pref-host" }, [cb, el("span", { text: d.host })]));
    }

    for (const h of cfg.custom) {
      const x = el("button", { class: "pref-chip-x", text: "×", title: "Remove", disabled: !anyOn, onclick: () => cfg.onRemove(h) });
      hosts.appendChild(el("span", { class: "pref-chip" }, [el("span", { text: h }), x]));
    }

    const input = el("input", { type: "text", class: "pref-add-input", placeholder: "add a host, e.g. example.com", disabled: !anyOn });
    const submit = () => { const v = input.value; input.value = ""; if (v) cfg.onAdd(v); };
    const addBtn = el("button", { class: "pref-add-btn", text: "Add", disabled: !anyOn, onclick: submit });
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    hosts.appendChild(el("div", { class: "pref-add-row" }, [input, addBtn]));

    sec.appendChild(hosts);
    return sec;
  }

  // A form of toggles, not a view of a channel. The buttons ALWAYS reflect the
  // current state read from Matrix (chat tier is derived; visibility is the
  // space's live join rule), so there's nothing to reconcile. Only the owner can
  // change them, and after a change the just-touched setting locks for 3s so it
  // can't be re-toggled before the new state lands and re-renders.
  function _lockSetting(key) {
    _setLocks[key] = true;
    renderSettings();
    setTimeout(() => { delete _setLocks[key]; renderSettings(); }, SETTINGS_LOCK_CLEAR_MS);
  }

  function renderSettings() {
    if (!refs.settingsBox) return;
    clear(refs.settingsBox);
    const s = Room.getSettings();
    const isOwner = Room.getMyRank() >= 100;
    // Master lock: the owner must explicitly unlock before any room setting can change.
    // Locked by default and re-locked on every entry to the Room tab (see the tab handler);
    // NO timed auto-relock — it stays as the owner leaves it until they lock or leave the tab.
    const editable = isOwner && !_settingsLocked;

    refs.settingsBox.appendChild(el("div", { class: "uq-section", text: "Room settings" }));
    if (!isOwner) refs.settingsBox.appendChild(el("p", { class: "muted", text: "Only the owner can change these." }));

    if (isOwner) {
      const lockBtn = el("button", {
        class: "settings-lock" + (_settingsLocked ? " locked" : ""),
        text: _settingsLocked ? "\uD83D\uDD12 Unlock settings" : "\uD83D\uDD13 Lock settings",
        title: _settingsLocked ? "Settings are locked — click to unlock" : "Settings unlocked — click to lock"
      });
      lockBtn.onclick = () => { _settingsLocked = !_settingsLocked; renderSettings(); };
      refs.settingsBox.appendChild(lockBtn);
    }

    const optionRow = (key, label, current, options, onPick) => {
      const locked = !!_setLocks[key];
      const opts = el("div", { class: "set-opts" });
      options.forEach(([val, text]) => {
        const active = val === current;
        const clickable = editable && !active && !locked;
        const b = el("button", { class: "set-opt" + (active ? " active" : ""), text: text });
        if (clickable) b.onclick = () => { onPick(val); _lockSetting(key); };
        else b.disabled = true;   // non-owner, current choice, a per-setting lock, OR the master lock → inert
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

    _renderBgSettingRow(s, isOwner, editable);
  }

  // The room background-image control (owner-only). A validated PNG/JPEG link from
  // an approved provider; clients download it into their per-room cache and paint
  // it (see the _bg engine). Non-owners see the current link read-only. Validation
  // uses the SAME provider allowlist as chat images (ChatPrefs), so the hint and
  // the gate agree with what each viewer will actually load.
  function _renderBgSettingRow(s, isOwner, editable) {
    const cur = (s && s.bg) || null;
    const row = el("div", { class: "set-row" });
    row.appendChild(el("div", { class: "set-label", text: "Background image" }));

    // Non-owner, OR owner while the master lock is on → read-only (show the current link).
    if (!editable) {
      row.appendChild(el("div", { class: "set-hint", text: cur ? cur : "None set." }));
      refs.settingsBox.appendChild(row);
      return;
    }

    const input = el("input", { type: "text", class: "uq-input",
      placeholder: "https://i.imgur.com/example.png", value: cur || "" });
    const setBtn = el("button", { class: "pref-add-btn", text: "Set" });
    const clearBtn = el("button", { class: "set-opt", text: "Clear" });
    const err = el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });

    const submit = () => {
      const raw = input.value.trim();
      if (!raw) { err.style.display = "none"; return; }
      const safe = Media.safeBgUrl(raw, ChatPrefs.bgOpts().hostAllowed);
      if (!safe) {
        err.textContent = "Not an approved image link. Use a PNG/JPEG from an approved provider (see ⚙ Settings).";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      Room.setSettings({ bg: safe });
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    clearBtn.onclick = () => { input.value = ""; err.style.display = "none"; Room.setSettings({ bg: null }); };

    row.appendChild(el("div", { class: "uq-add", style: "display:flex;gap:6px;" }, [input, setBtn, clearBtn]));
    if (!ChatPrefs.bgOpts().bgOn) {
      row.appendChild(el("div", { class: "set-hint",
        text: "Note: you have backgrounds turned off for yourself (⚙ Settings), so you won't see this even when set." }));
    }
    row.appendChild(err);
    refs.settingsBox.appendChild(row);
  }

  // ---------------------------------------------------------------------------
  // THUMBNAIL VIEWPORT TRIGGER (14 §3 / §3a) — fetch on scroll-into-view only
  // ---------------------------------------------------------------------------
  // Mirrors the chat image observer: an IntersectionObserver gates work to rows a
  // viewer actually looks at, so a 5000-song list costs nothing until scrolled.
  // The room queue is the heaviest caller, so the §3a guardrails live here:
  //   • DEBOUNCE (THUMB_DEBOUNCE_MS) — a row must stay in view this long before we
  //     act, so fast scroll-throughs never fetch;
  //   • a SERIALIZED, CONCURRENCY-LIMITED pump (THUMB_CONCURRENCY wide);
  //   • 429 / error BACK-OFF — on a failure burst, pause fetching for a cooldown
  //     and fall back to cached/URL only.
  // Bounded RAM: at most THUMB_LRU thumbnails hold a live <img> src at once;
  // scroll one far away and its src is released (re-set on return, served from the
  // browser HTTP cache or the stored blob).
  //
  // Per-mode policy (set by songRow as data-thumb-mode):
  //   "fetch"     — cache hit (Store.images) → blob; else ensureThumb (downscale+
  //                 store), and on any failure fall back to the direct ytimg URL;
  //                 also ensure(title) to fill the title/duration gap.
  //   "cacheOnly" — Store.images hit → blob; otherwise leave the slot blank. Never
  //                 fetch, never URL-fallback, never title-fetch (display-if-known).
  //
  // SEAM (deferred, 14 §3): a background pre-fetch service for the room queue and
  // (selective) user queue would call the SAME MetadataService.ensure/ensureThumb
  // with its own which-songs/which-fields policy — this trigger is just the
  // viewport policy; the mechanism is field-selective and trigger-agnostic so the
  // pump can be added later without reshaping anything here.
  const THUMB_DEBOUNCE_MS = 250;    // in-view dwell before a row fetches (§3a)
  const THUMB_CONCURRENCY = 3;      // max simultaneous lookups (§3a, "2–3 wide")
  const THUMB_BACKOFF_MS  = 30000;  // pause fetching this long after a failure burst (§3a)
  const THUMB_BACKOFF_HITS = 4;     // consecutive failures that trip the back-off
  const THUMB_LRU = 60;             // max thumbnails holding a live <img> src at once

  // One observer + pump for the queue body (root). Lazily created; torn down on
  // room exit. State keyed by videoId (stable) — rows are ephemeral (the windowed
  // stack recreates them on scroll), so we never key on the node.
  let _thumb = null;   // { io, root, pending:Map(vid->timer), inflight:Set, queue:[], running:0, lru:[], fails:0, backoffUntil:0 }
  // videoIds whose thumbnail has loaded at least once this session. The windowed stack
  // recreates row DOM on every re-render (reorder/add/remove), so a freshly-mounted <img>
  // would otherwise start blank and FADE IN again — reading as a flash. For an id we've
  // already shown, we paint its (HTTP-cached) URL synchronously with no transition, so a
  // re-mount is seamless. Keyed by videoId (stable); the ytimg URL is immutable so there's
  // nothing to revoke. Never used for cacheOnly rows (they must not fetch a stranger's art).
  const _thumbSeen = new Set();
  // In-memory cache of the loaded thumbnail BLOB per videoId (the stored downscale). The
  // room-queue / history / now-playing rows are cacheOnly — they have no ytimg URL to
  // instant-paint on re-mount, so a full re-render (renderRoomQueue rebuilds EVERY row
  // when a single song changes) would blank each <img> and async-reload it from IDB,
  // reading as a FLASH. Holding the blob in RAM lets songRow paint it synchronously on
  // re-mount (no blank, no fade) — the cacheOnly analogue of the fetch-mode URL re-mount
  // above. Bounded LRU-by-insertion; blobs are small downscales so the cap is generous.
  const _thumbBlobs = new Map();
  const THUMB_BLOB_CACHE = 200;
  function _thumbCacheBlob(vid, blob) {
    if (!vid || !blob) return;
    if (_thumbBlobs.has(vid)) _thumbBlobs.delete(vid);   // re-insert to bump recency
    _thumbBlobs.set(vid, blob);
    while (_thumbBlobs.size > THUMB_BLOB_CACHE) { const k = _thumbBlobs.keys().next().value; _thumbBlobs.delete(k); }
  }
  function _newThumbState(root) {
    return { io: null, root: root, pending: new Map(), inflight: new Set(), queue: [], running: 0, lru: [], fails: 0, backoffUntil: 0 };
  }
  function _thumbReset() {
    if (_thumb && _thumb.io) { try { _thumb.io.disconnect(); } catch (e) {} }
    if (_thumb) for (const t of _thumb.pending.values()) clearTimeout(t);
    _thumb = null;
  }
  function _thumbObserver(root) {
    if (_thumb && _thumb.root === root) return _thumb;
    _thumbReset();
    _thumb = _newThumbState(root);
    if (typeof IntersectionObserver === "undefined") return _thumb;   // no IO → rows stay id-only
    _thumb.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const img = e.target;
        const vid = img.dataset ? img.dataset.vid : null;
        if (!vid) continue;
        if (e.isIntersecting) {
          // Debounce: only enqueue if it's still in view after the dwell.
          if (_thumb.pending.has(vid)) continue;
          const t = setTimeout(() => { _thumb.pending.delete(vid); _thumbEnqueue(vid); }, THUMB_DEBOUNCE_MS);
          _thumb.pending.set(vid, t);
        } else {
          // Left view before the dwell elapsed → cancel the pending fetch.
          const t = _thumb.pending.get(vid);
          if (t) { clearTimeout(t); _thumb.pending.delete(vid); }
        }
      }
    }, { root: root, rootMargin: "150px 0px" });
    return _thumb;
  }
  // Find the live <img.thumb> element(s) for a videoId within the current queue
  // body. There may be MORE THAN ONE: Room History renders a row per play, so a
  // song played N times has N rows sharing this videoId (My Queue / Playlists dedup
  // by videoId, so those surfaces never do). The observer STATE stays keyed by
  // videoId — one fetch per id, never N — but the APPLY step must reach EVERY
  // mounted row for that id, or only the first duplicate ever gets its thumbnail.
  // Rows may be absent entirely (scrolled away / re-rendered) — that's fine.
  function _thumbSel(vid) {
    return '[data-vid="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(vid) : vid) + '"]';
  }
  // First match only — used where one representative row is enough (existence +
  // the row's thumb-mode, which is uniform across a surface's duplicates).
  function _thumbNode(vid) {
    if (!_thumb || !_thumb.root) return null;
    return _thumb.root.querySelector('img.thumb' + _thumbSel(vid));
  }
  // ALL matches — used by the apply helpers so a resolved fetch fills every row.
  function _thumbNodes(vid) {
    if (!_thumb || !_thumb.root) return [];
    return Array.prototype.slice.call(_thumb.root.querySelectorAll('img.thumb' + _thumbSel(vid)));
  }
  function _thumbRows(vid) {
    if (!_thumb || !_thumb.root) return [];
    return Array.prototype.slice.call(_thumb.root.querySelectorAll('.song-row' + _thumbSel(vid)));
  }
  // LRU bookkeeping: bump vid to most-recent; release the least-recent over cap by
  // clearing its <img> src (the stored blob / URL reloads on return).
  function _thumbTouch(vid) {
    const i = _thumb.lru.indexOf(vid);
    if (i >= 0) _thumb.lru.splice(i, 1);
    _thumb.lru.push(vid);
    while (_thumb.lru.length > THUMB_LRU) {
      const old = _thumb.lru.shift();
      // Release EVERY mounted <img> for the evicted id — duplicate History rows each
      // hold their own object URL — so nothing leaks and the cap stays honest.
      for (const node of _thumbNodes(old)) {
        const src = node.getAttribute("src");
        if (!src) continue;
        if (src.indexOf("blob:") === 0) { try { URL.revokeObjectURL(src); } catch (e) {} }
        node.removeAttribute("src");
      }
    }
  }
  function _thumbEnqueue(vid) {
    if (!_thumb) return;
    if (_thumb.inflight.has(vid) || _thumb.queue.indexOf(vid) >= 0) return;
    _thumb.queue.push(vid);
    _thumbPump();
  }
  function _thumbPump() {
    if (!_thumb) return;
    if (Date.now() < _thumb.backoffUntil) return;   // backed off → serve cache/URL only
    while (_thumb.running < THUMB_CONCURRENCY && _thumb.queue.length) {
      const vid = _thumb.queue.shift();
      if (_thumb.inflight.has(vid)) continue;
      _thumb.inflight.add(vid);
      _thumb.running++;
      _thumbProcess(vid).then(
        () => { _thumb && (_thumb.fails = 0); },
        () => {
          if (!_thumb) return;
          if (++_thumb.fails >= THUMB_BACKOFF_HITS) { _thumb.backoffUntil = Date.now() + THUMB_BACKOFF_MS; setTimeout(() => { if (_thumb) { _thumb.fails = 0; _thumbPump(); } }, THUMB_BACKOFF_MS); }
        }
      ).then(() => {
        if (!_thumb) return;
        _thumb.inflight.delete(vid);
        _thumb.running--;
        _thumbPump();
      });
    }
  }
  // Apply a stored thumbnail Blob to EVERY live img for vid (duplicate History rows
  // included). Each node gets its OWN object URL so its release stays independent
  // (no shared-URL double-revoke). Returns true if at least one row was filled.
  function _thumbShowBlob(vid, blob) {
    if (!blob) return false;
    _thumbCacheBlob(vid, blob);        // keep in RAM so a re-mount paints instantly (kills the cacheOnly flash)
    const nodes = _thumbNodes(vid);
    if (!nodes.length) return false;
    let any = false;
    for (const node of nodes) {
      // Already showing art for this id (e.g. the instant re-mount painted the direct
      // ytimg URL) → leave it. Swapping a wide 16:9 URL for the 120px center-cropped
      // square blob in the same object-fit:cover slot reframes the image and reads as
      // a zoom. The two are the same frame to the eye, so the swap buys nothing.
      if (node.classList.contains("loaded") && node.getAttribute("src")) { any = true; continue; }
      try {
        const url = URL.createObjectURL(blob);
        const prev = node.getAttribute("src");
        node.setAttribute("src", url);
        if (prev && prev.indexOf("blob:") === 0) { try { URL.revokeObjectURL(prev); } catch (e) {} }
        any = true;
      } catch (e) {}
    }
    if (any) _thumbTouch(vid);
    return any;
  }
  function _thumbShowUrl(vid) {
    const nodes = _thumbNodes(vid);
    if (!nodes.length) return;
    let any = false;
    for (const node of nodes) {
      if (node.classList.contains("loaded") && node.getAttribute("src")) { any = true; continue; }   // already painted — don't reframe
      const url = node.dataset ? node.dataset.url : null;
      if (url && node.getAttribute("src") !== url) { node.setAttribute("src", url); any = true; }
    }
    if (any) _thumbTouch(vid);
  }
  // Fill the row's title/duration from freshly-fetched metadata (fetch mode only) —
  // on EVERY mounted row for the id, not just the first duplicate.
  function _thumbDecorateMeta(vid, m) {
    if (!m) return;
    for (const rowEl of _thumbRows(vid)) {
      if (m.title) { const t = rowEl.querySelector(".sr-title"); if (t) { t.textContent = m.title; t.title = m.title; } }
      if (typeof m.durationSec === "number") { const d = rowEl.querySelector(".sr-dur"); if (d) d.textContent = _fmtDur(m.durationSec); }
    }
  }
  // The per-row work, by mode. Returns a Promise; rejects only on a real fetch
  // failure (so the back-off counter is meaningful) — a cache miss in cacheOnly
  // is a normal resolve.
  function _thumbProcess(vid) {
    const node = _thumbNode(vid);
    if (!node) return Promise.resolve();             // row gone — nothing to do
    const mode = node.dataset ? node.dataset.thumbMode : "cacheOnly";
    const imagesOk = (typeof Store !== "undefined" && Store.images);

    if (mode === "cacheOnly") {
      // Display-if-known: stored blob only, no fetch, no URL fallback.
      if (!imagesOk) return Promise.resolve();
      return Promise.resolve(Store.images.load(vid)).then((blob) => { if (blob) _thumbShowBlob(vid, blob); }).catch(() => {});
    }

    // fetch mode (your own songs): cache → ensureThumb → URL fallback; + title gap.
    const thumbWork = (imagesOk ? Promise.resolve(Store.images.load(vid)).catch(() => null) : Promise.resolve(null))
      .then((blob) => {
        if (blob) { _thumbShowBlob(vid, blob); return; }
        if (typeof MetadataService === "undefined" || !MetadataService.ensureThumb) { _thumbShowUrl(vid); return; }
        return Promise.resolve(MetadataService.ensureThumb(vid)).then((b) => {
          if (b) _thumbShowBlob(vid, b); else _thumbShowUrl(vid);     // taint/fail → direct URL
        }, () => { _thumbShowUrl(vid); });                            // never blank in fetch mode
      });
    // Title/duration gap (cache-first inside ensure). nowMs is supplied to the
    // pure freshness check; the clock lives in transport, so read it via the
    // bridge's stamp — here we just use Date.now() for the freshness comparison
    // (display-only; not consensus).
    const metaWork = (typeof MetadataService !== "undefined" && MetadataService.ensure)
      ? Promise.resolve(MetadataService.ensure(vid, ["title"], Date.now())).then((m) => _thumbDecorateMeta(vid, m)).catch(() => {})
      : Promise.resolve();
    return Promise.all([thumbWork, metaWork]);
  }

  // Called by songRow on each thumb it builds, when a fetch/cacheOnly slot exists.
  function _observeThumb(img) {
    if (!refs.queueBody) return;
    const st = _thumbObserver(refs.queueBody);
    if (st && st.io) st.io.observe(img); else if (img.dataset && img.dataset.thumbMode === "fetch") {
      // No IntersectionObserver → can't viewport-gate; show the URL directly so
      // your own queue still has thumbnails (cacheOnly stays blank without IO).
      _thumbShowUrlImmediate(img);
    }
  }
  function _thumbShowUrlImmediate(img) {
    const url = img.dataset ? img.dataset.url : null;
    if (url) img.setAttribute("src", url);
  }

  // On-demand fetch for a SINGLE row, triggered by an explicit interaction (clicking
  // the thumbnail to preview). Unlike the viewport observer this ignores the row's
  // thumbMode — even a cacheOnly surface (Room Queue / History / Now-Playing) fetches
  // here, because the user asked to interact with THIS song (not an ambient decorate,
  // 14 §3). Targets the given img/row directly, so duplicate rows for the same id
  // don't cross-update. Fetches the downscaled thumbnail (cache → ensureThumb → direct
  // URL) and fills the title/duration gap; results are cached, so other rows pick it up.
  function _previewFetch(vid, thumbImg, rowEl) {
    if (typeof MetadataService === "undefined" || !thumbImg) return;
    const imagesOk = (typeof Store !== "undefined" && Store.images);
    const showBlob = (blob) => {
      try {
        const u = URL.createObjectURL(blob);
        const prev = thumbImg.getAttribute("src");
        thumbImg.setAttribute("src", u);
        if (prev && prev.indexOf("blob:") === 0) { try { URL.revokeObjectURL(prev); } catch (e) {} }
      } catch (e) {}
    };
    const showUrl = () => { const url = thumbImg.dataset ? thumbImg.dataset.url : null; if (url && thumbImg.getAttribute("src") !== url) thumbImg.setAttribute("src", url); };
    (imagesOk ? Promise.resolve(Store.images.load(vid)).catch(() => null) : Promise.resolve(null)).then((blob) => {
      if (blob) { showBlob(blob); return; }
      if (!MetadataService.ensureThumb) { showUrl(); return; }
      return Promise.resolve(MetadataService.ensureThumb(vid)).then((b) => { if (b) showBlob(b); else showUrl(); }, () => showUrl());
    }).catch(() => {});
    if (MetadataService.ensure && rowEl) {
      Promise.resolve(MetadataService.ensure(vid, ["title"], Date.now())).then((m) => {
        if (!m) return;
        if (m.title) { const t = rowEl.querySelector(".sr-title"); if (t) { t.textContent = m.title; t.title = m.title; } }
        if (typeof m.durationSec === "number") { const d = rowEl.querySelector(".sr-dur"); if (d) d.textContent = _fmtDur(m.durationSec); }
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // SONG ROW — one reusable component for every list of songs (14 §4)
  // ---------------------------------------------------------------------------
  // A song is just a videoId; title/thumbnail/duration are regenerable CACHE,
  // never truth (storage law). The row builds a thumbnail slot + title +
  // duration (geo cell reserved, blank until a geo provider is wired) + caller-
  // supplied action buttons, all via createElement/textContent (never innerHTML,
  // check-html-safety). Title/duration come cache-first from Store.meta and fill
  // in async when that resolves; the thumbnail is handled by the viewport trigger
  // (_thumbObserver) so nothing fetches for a row nobody looks at (14 §3).
  //
  // thumbMode decides the thumbnail policy on the row's surface:
  //   "fetch"     (My Queue — your own songs): on viewport, prefer the stored
  //               downscale; after attempting it, fall back to the direct ytimg
  //               URL so the slot is never blank.
  //   "cacheOnly" (Room Queue — other people's songs): show the stored downscale
  //               ONLY if already cached; never fetch, never URL-fallback (a
  //               stranger's song is display-only-if-known — no ambient load).
  // Both are expressed as data-attributes the observer reads; the row builder
  // itself triggers no network.
  const SONG_ROW_H = 44;            // fixed row height (px) — windowed-stack spacer math depends on it
  function _fmtDur(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec <= 0) return "";
    const s = Math.round(sec), m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  // Build the row. opts: { pos?, actions?, thumbMode? ("fetch"|"cacheOnly"), sub? }
  function songRow(videoId, opts) {
    opts = opts || {};
    const mode = opts.thumbMode === "fetch" ? "fetch" : "cacheOnly";
    const row = el("div", { class: "song-row" });
    row.dataset.vid = videoId;

    // Thumbnail slot — the observer fills .src (stored blob → URL fallback in
    // fetch mode; stored blob only in cacheOnly). data-thumb-mode tells it which.
    const thumb = el("img", { class: "thumb", alt: "" });
    thumb.dataset.vid = videoId;
    thumb.dataset.thumbMode = mode;
    const fb = (typeof MetadataService !== "undefined") ? MetadataService.thumbUrl(videoId) : null;
    if (fb) thumb.dataset.url = fb;                 // the direct ytimg fallback (used only in fetch mode)
    // The thumb sits in a slot showing a tasteful placeholder (a ♪ in a neutral
    // box) until a real image actually loads. A cacheOnly row with no stored image
    // (e.g. an unwitnessed History song) therefore reads as an intentional empty
    // card, not a bare/broken sliver — and we still never fetch to fill it.
    thumb.addEventListener("load", () => { if (thumb.getAttribute("src")) { thumb.classList.add("loaded"); _thumbSeen.add(videoId); } });
    // Seamless re-mount: paint the art NOW, transition suppressed, so a full re-render
    // (a reorder/add, or renderRoomQueue rebuilding every row on a single song change)
    // shows it immediately instead of blank-then-fade. Prefer the cached BLOB — the
    // stored downscale, correct aspect, and the ONLY source cacheOnly rows have, so this
    // is what stops the room-queue / history / now-playing flash. Fall back to the
    // fetch-mode ytimg URL for a fetch row we've shown before but whose blob isn't cached.
    // The observer still runs and reconciles (same image; no visible change / no reframe).
    const _cachedBlob = _thumbBlobs.get(videoId);
    if (_cachedBlob) {
      try {
        thumb.classList.add("instant", "loaded");
        thumb.setAttribute("src", URL.createObjectURL(_cachedBlob));
        _thumbSeen.add(videoId);
      } catch (e) {}
    } else if (mode === "fetch" && fb && _thumbSeen.has(videoId)) {
      thumb.classList.add("instant", "loaded");
      thumb.setAttribute("src", fb);
    }
    // The thumbnail (or its ♪ placeholder) IS the preview button — click it to open
    // the mini-player (14 §7). This replaces the separate ▷ button on every row, to
    // save horizontal space. A ▶ overlay appears on hover/focus to signal it's live.
    const slot = el("span", { class: "thumb-slot", title: "Preview this song" }, [
      thumb, el("span", { class: "thumb-play", text: "\u25B6", "aria-hidden": "true" }),
    ]);
    slot.setAttribute("role", "button");
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("aria-label", "Preview this song");
    const _openFromSlot = () => {
      _previewFetch(videoId, thumb, row);   // fetch this song's thumbnail + title/duration on demand
      _openPreview(videoId, slot.closest ? slot.closest(".column") : null);
    };
    slot.onclick = _openFromSlot;
    slot.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _openFromSlot(); } };
    row.appendChild(slot);
    _observeThumb(thumb);                           // viewport-gated load (14 §3) — see _thumbObserver

    // Main column: title (defaults to the id until a cached/fetched title lands)
    // and a sub line carrying duration (and, later, geo) — plus an optional
    // caller sub (e.g. History's "played 5 min ago").
    const titleEl = el("div", { class: "sr-title", text: videoId });
    titleEl.title = videoId;
    const durEl = el("span", { class: "sr-dur" });
    const geoEl = el("span", { class: "sr-geo" });   // reserved; stays blank (no geo provider yet)
    const subKids = [durEl, geoEl];
    if (opts.sub) subKids.push(el("span", { class: "sr-when", text: opts.sub }));
    const subEl = el("div", { class: "sr-sub" }, subKids);
    const main = el("div", { class: "sr-main" }, [titleEl, subEl]);
    if (opts.pos != null) row.appendChild(el("span", { class: "sr-pos", text: String(opts.pos) }));
    row.appendChild(main);

    // Decorate from the per-video metadata cache (title/duration) — read-only,
    // cache-first, no fetch. The fetch (for gaps) is the observer's job in fetch
    // mode. Async, so it fills in after the row mounts (like avatars/chat images).
    if (typeof MetadataService !== "undefined" && MetadataService.get) {
      Promise.resolve(MetadataService.get(videoId)).then((m) => {
        if (!m) return;
        if (m.title) { titleEl.textContent = m.title; titleEl.title = m.title; }
        if (typeof m.durationSec === "number") durEl.textContent = _fmtDur(m.durationSec);
      }).catch(() => {});
    }

    // Action area: caller actions only (e.g. ＋ save-to-playlist, or move/remove on lists
    // you own). The preview affordance is the THUMBNAIL itself (see the slot above) — it
    // fetches title + thumbnail on demand — so there's no separate view or fetch button,
    // which saves a button's width on every row across the app.
    const acts = [];
    if (opts.actions && opts.actions.length) for (const a of opts.actions) acts.push(a);
    row.appendChild(el("span", { class: "uq-actions" }, acts));
    return row;
  }

  // The preview affordance now lives on the THUMBNAIL of every row (see songRow):
  // clicking the thumb/placeholder opens the mini-player below. It's LOCAL-only — it
  // sends no protocol event, never advances the rotation, and only reads title+duration
  // into the display cache — and reaches every surface at once (My Queue / Playlists /
  // Room Queue / Room History) because they all build rows through songRow.
  // ===== Preview mini-player (14 §7) =========================================
  // LOCAL-only takeover. _openPreview pauses the room player IN PLACE (no event,
  // the Spine is untouched, every other client keeps playing), mounts a centred
  // modal with a SECOND YT.Player on the chosen song, and reads its title+duration
  // into the metadata CACHE (display-only — never truth, never Playback). While
  // active, onPlaybackStateChange keeps caching _lastNp but stops driving the main
  // player. On close we tear the overlay down and re-sync the room player to LIVE
  // (the current consensus song at the live position — the room moved on while you
  // watched) and resume. Esc / the ✕ / a backdrop click all close it.
  function _applyVolumeToPreview() {
    if (!_previewPlayer) return;
    try {
      // Preview audio is INDEPENDENT of the main player — it must be audible even when
      // the room player is muted (they are NOT tied). Start unmuted at a sensible level
      // (the main's level if it's non-zero, else full); the preview's own native YT
      // controls take it from there, and nothing here ever touches the main player.
      _previewPlayer.unMute();
      _previewPlayer.setVolume((volumeState && volumeState.level > 0) ? volumeState.level : 100);
    } catch (e) { /* preview player not ready yet */ }
  }
  // Pull the player-sourced title + duration into the display cache (one combined
  // write via recordMeta — same no-clobber path the room player uses) and live-
  // update any rendered rows. NEVER calls Playback (this isn't the room song).
  function _previewRecordMeta(videoId) {
    if (!_previewPlayer) return;
    let title = null, dur = null;
    try { const vd = _previewPlayer.getVideoData(); if (vd && vd.title) title = vd.title; } catch (e) {}
    try { const d = _previewPlayer.getDuration(); if (typeof d === "number" && isFinite(d) && d > 0) dur = Math.round(d); } catch (e) {}
    if (typeof MetadataService !== "undefined" && MetadataService.recordMeta && (title || dur)) {
      const fields = {};
      if (title) fields.title = title;
      if (dur) fields.durationSec = dur;
      Promise.resolve(MetadataService.recordMeta(videoId, fields))
        .then(() => { _applyMetaToRows(videoId, title, dur); })
        .catch(() => {});
    }
    // Also warm the thumbnail cache so the launching row fills in on next render.
    if (typeof MetadataService !== "undefined" && MetadataService.ensureThumb) {
      Promise.resolve(MetadataService.ensureThumb(videoId)).catch(() => {});
    }
  }
  function _openPreview(videoId, columnEl) {
    if (_previewActive || !videoId) return;
    if (typeof YT === "undefined" || !window.YT || !window.YT.Player) return;   // YT not up yet
    _previewActive = true;
    _previewColumn = (columnEl && columnEl.getBoundingClientRect) ? columnEl : null;
    // Pause the room player in place — do NOT unmount the iframe, do NOT advance.
    try { if (player && playerReady) player.pauseVideo(); } catch (e) {}

    // Build the overlay with createElement only (no innerHTML — html-safety wall).
    const mount   = el("div", { id: "yt-preview-player" });
    const closeBtn = el("button", { class: "preview-x", text: "\u2715", "aria-label": "Close preview", onclick: _closePreview });
    const card = el("div", { class: "preview-card" }, [closeBtn, el("div", { class: "preview-frame" }, [mount])]);
    _previewOverlay = el("div", { class: "preview-overlay" }, [card]);
    // The full-screen backdrop LOCKS the rest of the UI: it captures every click so
    // nothing behind it is reachable, and clicking the backdrop itself does nothing —
    // the only way out is the ✕ (or Esc). The room (e.g. chat) stays visible through
    // the light scrim and keeps updating; you just can't interact until you exit.
    // Mount on <body>: the overlay is position:fixed (viewport-rect coords), and the
    // `#screen-main > * { position: relative }` clickability rule would otherwise force
    // it back into flow. Body keeps it free-floating over the live column.
    document.body.appendChild(_previewOverlay);
    _positionPreview();   // float it over the row's column (adapts to wide/compact/phone)

    _previewKeyHandler = (e) => { if (e.key === "Escape") _closePreview(); };
    document.addEventListener("keydown", _previewKeyHandler);
    _previewResizeHandler = () => _positionPreview();   // keep it pinned to the column on resize/layout change
    window.addEventListener("resize", _previewResizeHandler);

    // Second player — its OWN handlers; it NEVER calls Playback.notifyEnded /
    // setDuration (those drive consensus). It only records title+duration to cache.
    try {
      _previewPlayer = new YT.Player("yt-preview-player", {
        width: "100%", height: "100%", videoId: videoId,
        playerVars: { autoplay: 1, controls: 1, mute: 0, playsinline: 1, rel: 0 },
        events: {
          onReady: () => { _applyVolumeToPreview(); try { _previewPlayer.playVideo(); } catch (e) {} },
          onStateChange: (e) => { if (e.data === YT.PlayerState.PLAYING) _previewRecordMeta(videoId); }
        }
      });
    } catch (e) { _previewPlayer = null; }
  }
  // The overlay is the full-screen LOCK (fixed inset:0, CSS). This places the CARD over
  // the column the row lives in — so the preview sits IN that panel — and sizes its 16:9
  // frame to fit. Adapts to whatever layout is active. If the column is missing/hidden
  // (a layout where it's display:none), the card centres on the whole viewport instead.
  function _positionPreview() {
    if (!_previewOverlay) return;
    const card = _previewOverlay.querySelector(".preview-card");
    const frame = _previewOverlay.querySelector(".preview-frame");
    if (!card || !frame) return;
    const r = _previewColumn ? _previewColumn.getBoundingClientRect() : null;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const area = (r && r.width > 40 && r.height > 40)
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: 0, top: 0, width: vw, height: vh };
    // Largest 16:9 frame that fits the area (card padding 12 + a margin from the edges).
    const pad = 12, gap = 14;
    const availW = Math.max(80, area.width - 2 * gap - 2 * pad);
    const availH = Math.max(45, area.height - 2 * gap - 2 * pad - 8);   // headroom for the card
    let fw = availW, fh = fw * 9 / 16;
    if (fh > availH) { fh = availH; fw = fh * 16 / 9; }
    frame.style.width = Math.round(fw) + "px";
    frame.style.height = Math.round(fh) + "px";
    // Centre the card within the area (read its size now that the frame is sized).
    const cr = card.getBoundingClientRect();
    card.style.left = Math.round(area.left + (area.width - cr.width) / 2) + "px";
    card.style.top  = Math.round(area.top + (area.height - cr.height) / 2) + "px";
  }
  function _closePreview() {
    if (!_previewActive) return;
    _previewActive = false;
    if (_previewKeyHandler) { document.removeEventListener("keydown", _previewKeyHandler); _previewKeyHandler = null; }
    if (_previewResizeHandler) { window.removeEventListener("resize", _previewResizeHandler); _previewResizeHandler = null; }
    if (_previewPlayer) { try { _previewPlayer.destroy(); } catch (e) {} _previewPlayer = null; }
    if (_previewOverlay && _previewOverlay.parentNode) _previewOverlay.parentNode.removeChild(_previewOverlay);
    _previewOverlay = null; _previewColumn = null;
    // Reattach the room player and re-sync to LIVE (loads the now-current consensus
    // song at the live position if it changed, else seeks the paused player forward),
    // then resume — the room kept moving while the preview played.
    _driveNowPlaying(_lastNp);
    try { if (player && playerReady && _lastNp && _lastNp.song && !_lastNp.ended) player.playVideo(); } catch (e) {}
  }

  function renderQueuePanel() {
    if (!refs.queueBody) return;
    if (refs.tabRoom) refs.tabRoom.classList.toggle("active", queueTab === "room");
    if (refs.tabMine) refs.tabMine.classList.toggle("active", queueTab === "mine");
    if (refs.tabHistory) refs.tabHistory.classList.toggle("active", queueTab === "history");
    if (refs.tabPlaylists) refs.tabPlaylists.classList.toggle("active", queueTab === "playlists");
    clear(refs.queueBody);
    if (queueTab === "room") renderRoomQueue();
    else if (queueTab === "history") renderHistory();
    else if (queueTab === "playlists") renderPlaylists();
    else renderMyQueue();
  }

  function renderRoomQueue() {
    const myRank = Room.getMyRank();
    const np = Queue.getNowPlaying();
    const rotation = Queue.getRotation();

    // Now-playing: a read-only (cacheOnly) song row — shows a thumbnail/title only
    // if we already hold it (it was yours, played, or previewed); never fetches a
    // stranger's song just to decorate the room queue (14 §1c/§3).
    if (np && np.song) {
      const npName = el("span", { class: "who", text: shortName(np.dj) });
      npName.style.color = rankColor(_rosterLevel(np.dj));
      const npRow = songRow(np.song.videoId, { thumbMode: "cacheOnly", actions: [_starBtn(), _voteBtn()] });
      npRow.classList.add("playing");
      refs.queueBody.appendChild(el("div", { class: "rq-group playing" }, [npName, npRow]));
    }
    if (!rotation || rotation.length === 0) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "No DJs waiting" }));
    } else {
      rotation.forEach(entry => {
        const entryName = el("span", { class: "who", text: shortName(entry.user) });
        entryName.style.color = rankColor(_rosterLevel(entry.user));
        const head = el("div", { class: "rq-head" }, [entryName]);
        if (myRank >= STAFF) {
          const up = el("button", { class: "mini", text: "▲", title: "Move to front", onclick: () => Queue.move(entry.user, null) });
          const rm = el("button", { class: "mini", text: "✕", title: "Remove from rotation", onclick: () => Queue.remove(entry.user) });
          head.appendChild(el("span", { class: "rot-actions" }, [up, rm]));
        }
        const group = el("div", { class: "rq-group" }, [head]);
        // Each pending song → a read-only song row (cacheOnly). Staff actions stay
        // on the PERSON (the head), not the song — the rotation is of people.
        // Show only the DJ's NEXT declared song — the rotation is of PEOPLE, so we
        // surface who's up and the one track that plays on their turn, not their
        // whole declared buffer (a second declared song is their business, not the
        // room's). cacheOnly: never fetch a stranger's upcoming song to decorate.
        if (entry.pending && entry.pending.length) {
          group.appendChild(songRow(entry.pending[0].videoId, { thumbMode: "cacheOnly" }));
        } else {
          group.appendChild(el("p", { class: "muted", text: "(empty)" }));
        }
        refs.queueBody.appendChild(group);
      });
    }
    if (myRank >= HIGH_STAFF) {
      refs.queueBody.appendChild(el("button", { class: "danger", text: "Reset rotation", onclick: () => Queue.reset() }));
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
    const scroller = el("div", { class: "uq-scroll" });
    scroller.style.overflowY = "auto";
    const topSpacer = el("div");
    const rowsBox = el("div");
    const botSpacer = el("div");
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
      clear(rowsBox);
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

    // Header row: count + "Clear my queue". Clear is a deliberate wipe of the whole
    // list, so it uses the same two-step inline confirm as deleting a playlist (no
    // modal): click ✕ Clear → "Clear N songs?" ✓ / ✗. Only shown when there's something
    // to clear. Hitting Add or otherwise re-rendering disarms it (transient by design).
    {
      const n = UserQueue.count ? UserQueue.count() : 0;
      if (n > 0) {
        const bar = el("div", { class: "uq-listhead" });
        bar.appendChild(el("span", { class: "muted", text: n + (n === 1 ? " song" : " songs") }));
        if (_uqConfirmClear) {
          bar.appendChild(el("span", { class: "pl-confirm", text: "Clear " + n + "?" }));
          bar.appendChild(el("button", { class: "mini ico danger", text: "✓", title: "Confirm clear",
            onclick: () => { _uqConfirmClear = false; UserQueue.clearQueue(); renderJoinBtn(); } }));
          bar.appendChild(el("button", { class: "mini ico", text: "✗", title: "Cancel",
            onclick: () => { _uqConfirmClear = false; renderQueuePanel(); } }));
        } else {
          bar.appendChild(el("button", { class: "mini", text: "✕ Clear", title: "Clear my whole queue",
            onclick: () => { _uqConfirmClear = true; renderQueuePanel(); } }));
        }
        refs.queueBody.appendChild(bar);
      }
    }

    // ONE list — your intent. Its top CAP rows carry a commit bar whose colour is a
    // MATCH, not an event: green when the room's declared slot equals this row
    // (confirmed), blue when it's a top-CAP song not yet confirmed. Movement/remove are
    // pure-local reorders of intent by ABSOLUTE index (instant, no events); the
    // reconciler then makes the room's declared buffer match. No declared/stack split.
    const items = UserQueue.items ? UserQueue.items() : [];
    if (items.length === 0) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "Your queue is empty" }));
    } else {
      const mv = (glyph, title, fn, on) => {
        const b = el("button", { class: "mini", text: glyph, title: title, "aria-label": title });
        if (on) b.onclick = fn; else { b.disabled = true; }   // disabled = same spot, greyed, inert
        return b;
      };
      const sep = () => el("span", { class: "q-sep", "aria-hidden": "true" });
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
        const removeBtn = mv("\u2715", "Remove", () => UserQueue.removeAt(i), true);
        const acts = moves.slice();
        if (moves.length) acts.push(sep());   // guard the ✕ from a misclick
        acts.push(removeBtn);
        const row = songRow(song.videoId, {
          pos: isFirst ? "\u25B6" : (i + 1) + ".",
          thumbMode: "fetch",
          actions: acts
        });
        // Commit bar on the top-CAP rows only.
        const state = UserQueue.slotState ? UserQueue.slotState(i) : null;
        if (state) {
          const bar = el("div", { class: "commit-bar " + state });
          const fill = el("div", { class: "commit-fill" });
          // A 'pending' bar counts down over the settle window. On a re-render (e.g.
          // queuing another song below the top two) the element is rebuilt, which would
          // restart the CSS animation from 0. Anchor it to how far the real settle timer
          // has already run (negative animation-delay) so it RESUMES rather than resets —
          // an unrelated edit no longer wipes the plays-next slot's progress.
          if (state === "pending" && UserQueue.settleElapsedMs) {
            const elapsed = UserQueue.settleElapsedMs();
            if (elapsed > 0) fill.style.animationDelay = "-" + Math.round(elapsed) + "ms";
          }
          bar.appendChild(fill);
          row.appendChild(bar);
        }
        return row;
      }, SONG_ROW_H);
    }
    // Join/Leave the DJ queue now lives under the now-playing song (see buildMainDom).
  }

  // ---------------------------------------------------------------------------
  // ROOM HISTORY — the shared, DERIVED play log (newest-first, "time ago")
  // ---------------------------------------------------------------------------
  // Not a stored list: it is StateDeriver's `history` (a byproduct of the same
  // pure fold that produces now-playing), so every client shows the same record
  // and it survives reload via replay (14: Room History is a derived shared view,
  // not a separate store). It therefore includes songs that played BEFORE you
  // arrived / while away — songs you didn't witness. Rows render cacheOnly
  // (thumbnail/title only if already known): a WITNESSED song is known because the
  // player pushed its title on play (_pushPlayerMeta); an UNWITNESSED song shows
  // id-only until you open its preview (clicking the thumbnail), which fetches title +
  // thumbnail on demand (no ambient load — same restraint as the room queue).
  const HISTORY_SHOW = 500;          // most-recent plays shown (the derived array is itself bounded)
  function _fmtAgo(at, now) {
    if (typeof at !== "number" || at <= 0) return "";
    const s = Math.max(0, Math.floor(((now || Date.now()) - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? " min ago" : " mins ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hr ago" : " hrs ago");
    const d = Math.floor(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  // On-demand metadata for an unwitnessed history row now rides the SAME path as every
  // other row: clicking the thumbnail opens the preview, which fetches title + thumbnail
  // (_previewFetch). There's no separate ↻ button — one affordance, less row clutter.
  function renderHistory() {
    const rows = (Queue.recentHistory ? Queue.recentHistory(HISTORY_SHOW) : []);   // newest-first, via the feature layer
    if (!rows.length) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "Nothing has played yet" }));
      return;
    }
    const now = Date.now();
    rows.forEach((h) => {
      const row = songRow(h.videoId, {
        thumbMode: "cacheOnly",                       // display-if-known; no ambient fetch
        sub: _fmtAgo(h.at, now) + (h.skipped ? " · skipped" : ""),
        actions: [_addToPlaylistBtn(h.videoId)],      // ＋ → save this song into a playlist
      });
      // DJ name goes on the SUB line (rank-colored), so the row keeps the same
      // 2-line shape (title + sub) as My Queue's rows. Prepending it into .sr-main
      // made history a 3-line row, which left the fixed 30px thumb undersized and
      // off-centre in a taller row — the "wrong size square areas" mismatch.
      const sub = row.querySelector(".sr-sub");
      if (sub) {
        const who = el("span", { class: "sr-who", text: shortName(h.dj) });
        who.style.color = rankColor(_rosterLevel(h.dj));
        sub.insertBefore(who, sub.firstChild);
      }
      refs.queueBody.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // PLAYLISTS — the saved-library panel (14 §5 / P3). UI only: it reads/commands
  // the Playlists feature (create/rename/remove, addTrack/removeTrack, clone) and
  // renders the same song-rows the other surfaces use. All truth + protections
  // (dedup, caps, name disambiguation, the submit-path clone) live in the feature;
  // this layer never persists or mutates a playlist directly. Every node is built
  // via el() → check-html-safety stays clean.
  // ---------------------------------------------------------------------------

  // Playlists is USER-GLOBAL (not room-scoped like UserQueue), so it inits once —
  // lazily, the first time the panel or the add-to-playlist picker is opened — and
  // wires its onChange exactly once. Account switch reloads the page, so one init
  // per page load is correct per account. Kept out of the boot path on purpose.
  function _ensurePlaylistsInit() {
    if (_plInited || typeof Playlists === "undefined") return;
    _plInited = true;
    try { Playlists.init(); } catch (e) {}
    if (Playlists.onChange) Playlists.onChange(() => {
      // Fires on library changes (create/rename/remove/reorder). Refresh only when
      // the panel is showing the library list.
      if (queueTab === "playlists" && _plView === "list") renderQueuePanel();
    });
  }

  // Alphabetical, case-folded, natural-number sort — shared by the library tab and
  // the picker so both surfaces agree. "2" < "11", "apple" groups with "Apple".
  function _plSort(list) {
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  function renderPlaylists() {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined") {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "Playlists are unavailable." }));
      return;
    }
    // Opening the Playlists tab always shows the library list (the tab's onclick
    // resets _plView); this validate is a safety for a detail view left pointing at
    // a since-deleted playlist.
    if (_plView !== "list" && !Playlists.list().some((p) => p.id === _plView)) _plView = "list";
    if (_plView === "list") _renderPlaylistLibrary();
    else _renderPlaylistDetail(_plView);
  }

  // --- Library view: create + the list of playlists (name · count) -------------
  // The create row is PINNED (in the panel's fixed head); only the list scrolls.
  function _renderPlaylistLibrary() {
    // New-playlist row (same shape as My Queue's add-by-link box) — fixed at the top.
    const input = el("input", { class: "uq-input", placeholder: "New playlist name…" });
    const note = el("div", { class: "uq-note muted" });
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      const r = await Playlists.create(name);
      if (r && r.ok) { input.value = ""; note.textContent = "Created “" + r.name + "”."; }
      else { note.textContent = "Couldn't create: " + ((r && r.reason) || "unknown"); }
      // On success create() notifies → the panel re-renders and the new list appears
      // (the note element is rebuilt, so the confirmation is transient — that's fine,
      // the new row IS the confirmation). On failure there's no notify, so the error
      // note stays put.
    };
    input.onkeydown = (e) => { if (e.key === "Enter") create(); };
    refs.queueBody.appendChild(el("div", { class: "pl-lib-head" }, [
      el("div", { class: "uq-add" }, [input, el("button", { text: "Create", onclick: create })]),
      note,
    ]));

    const scroll = el("div", { class: "pl-scroll" });
    refs.queueBody.appendChild(scroll);
    const lists = _plSort(Playlists.list());
    if (!lists.length) {
      scroll.appendChild(el("p", { class: "muted", text: "No playlists yet — create one above." }));
      return;
    }
    for (const p of lists) scroll.appendChild(_playlistRow(p));
  }

  // One library row: name (click to open) · count · rename · delete (two-step).
  function _playlistRow(p) {
    const row = el("div", { class: "pl-row" });

    if (_plRenaming === p.id) {
      // Inline rename editor — commits through the feature (sanitize/collapse/cap/
      // non-empty + (2)/(3) disambiguation all apply). Enter/blur commit, Esc cancels.
      const edit = el("input", { class: "uq-input pl-rename", value: p.name });
      let done = false;   // Enter commits, which re-renders and fires blur → guard the second commit
      const commit = async () => {
        if (done) return;
        done = true;
        const v = edit.value.trim();
        _plRenaming = null;
        if (v && v !== p.name) { await Playlists.rename(p.id, v); }  // notify → re-render
        else renderQueuePanel();
      };
      edit.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") { done = true; _plRenaming = null; renderQueuePanel(); }
      };
      edit.onblur = commit;
      row.appendChild(edit);
      setTimeout(() => { try { edit.focus(); edit.select(); } catch (e) {} }, 0);
      return row;
    }

    const name = el("button", { class: "pl-name", text: p.name, title: "Open" });
    name.onclick = () => { _plView = p.id; _plConfirmDelete = null; _plRemoveArm = null; renderQueuePanel(); };
    row.appendChild(name);

    // Count · loaded lazily and cached (the index carries no counts). Shows the
    // cached number immediately if we have it, else fills in when the record loads.
    const count = el("span", { class: "pl-count" });
    if (typeof _plCounts[p.id] === "number") count.textContent = _plCounts[p.id] + (_plCounts[p.id] === 1 ? " song" : " songs");
    else {
      Promise.resolve(Playlists.get(p.id)).then((rec) => {
        const n = rec && rec.tracks ? rec.tracks.length : 0;
        _plCounts[p.id] = n;
        count.textContent = n + (n === 1 ? " song" : " songs");
      }).catch(() => {});
    }
    row.appendChild(count);

    const acts = [];
    acts.push(el("button", { class: "mini ico", text: "✎", title: "Rename",
      onclick: () => { _plRenaming = p.id; _plConfirmDelete = null; renderQueuePanel(); } }));
    if (_plConfirmDelete === p.id) {
      // Two-step confirm, in place. The ✓ deletes; ✗ backs out. No modal.
      acts.push(el("span", { class: "pl-confirm", text: "Delete?" }));
      acts.push(el("button", { class: "mini ico danger", text: "✓", title: "Confirm delete",
        onclick: async () => { _plConfirmDelete = null; delete _plCounts[p.id]; await Playlists.remove(p.id); } }));
      acts.push(el("button", { class: "mini ico", text: "✗", title: "Cancel",
        onclick: () => { _plConfirmDelete = null; renderQueuePanel(); } }));
    } else {
      acts.push(el("button", { class: "mini ico", text: "✕", title: "Delete playlist",
        onclick: () => { _plConfirmDelete = p.id; renderQueuePanel(); } }));
    }
    row.appendChild(el("span", { class: "uq-actions" }, acts));
    return row;
  }

  // --- Detail view: one playlist's tracks --------------------------------------
  function _renderPlaylistDetail(id) {
    const back = el("button", { class: "mini pl-back", text: "← Back", title: "Back to playlists" });
    back.onclick = () => { _plView = "list"; _plRemoveArm = null; _plConfirmDelete = null; renderQueuePanel(); };
    const titleEl = el("span", { class: "pl-detail-title", text: "…" });
    const addAll = el("button", { class: "mini", text: "＋ All to my queue", title: "Add every song to my queue" });
    const header = el("div", { class: "pl-detail-head" }, [back, titleEl, el("span", { class: "uq-actions" }, [addAll])]);
    refs.queueBody.appendChild(header);
    const note = el("div", { class: "uq-note muted" });
    refs.queueBody.appendChild(note);
    const body = el("div", { class: "pl-detail-body" });
    refs.queueBody.appendChild(body);

    addAll.onclick = async () => {
      const r = await Playlists.addWholeToQueue(id);
      if (r && r.ok) { note.textContent = "Added " + r.added + ", skipped " + r.skipped + "."; renderJoinBtn(); }
      else { note.textContent = "Couldn't add: " + ((r && r.reason) || "unknown"); }
    };

    Promise.resolve(Playlists.get(id)).then((rec) => {
      if (!rec) { titleEl.textContent = "(missing)"; body.appendChild(el("p", { class: "muted", text: "This playlist is gone." })); return; }
      titleEl.textContent = rec.name;
      titleEl.title = rec.name;
      _plCounts[id] = rec.tracks.length;
      if (!rec.tracks.length) {
        body.appendChild(el("p", { class: "muted", text: "No songs yet — add from History or Now Playing (the ＋ on a song)." }));
        return;
      }
      // Windowed like My Queue's stack (a playlist can hold up to 5000). Each row:
      // ＋-to-my-queue (clone via the submit path), the view/preview button (built
      // into songRow), and a two-step remove-from-list.
      _renderWindowedStack(body, () => rec.tracks, (t, i) =>
        _playlistTrackRow(id, t.videoId, i), SONG_ROW_H);
    }).catch(() => { titleEl.textContent = "(error)"; });
  }

  function _playlistTrackRow(playlistId, videoId, i) {
    const cloneBtn = el("button", { class: "mini ico", text: "＋", title: "Add to my queue",
      onclick: () => { const r = Playlists.cloneToQueue(videoId); renderJoinBtn();
        if (r && !r.ok && r.reason) Logger.info("My queue: " + r.reason); } });
    // Two-step remove with an explicit cancel, matching the playlist-delete confirm.
    // Armed state is module-level (keyed playlistId+videoId) so it survives the detail's
    // re-render and can't leak across playlists that happen to share a videoId.
    const armKey = playlistId + "\u0000" + videoId;
    const acts = [cloneBtn];
    if (_plRemoveArm === armKey) {
      acts.push(el("span", { class: "pl-confirm", text: "Remove?" }));
      acts.push(el("button", { class: "mini ico danger", text: "✓", title: "Confirm remove",
        onclick: async () => { _plRemoveArm = null; delete _plCounts[playlistId]; await Playlists.removeTrack(playlistId, videoId); renderQueuePanel(); } }));
      acts.push(el("button", { class: "mini ico", text: "✗", title: "Cancel",
        onclick: () => { _plRemoveArm = null; renderQueuePanel(); } }));
    } else {
      acts.push(el("button", { class: "mini ico", text: "✕", title: "Remove from playlist",
        onclick: () => { _plRemoveArm = armKey; renderQueuePanel(); } }));
    }
    return songRow(videoId, { pos: (i + 1) + ".", thumbMode: "fetch", actions: acts });
  }

  // --- The cross-surface "add to a playlist" picker (History / Now Playing) -----
  // A body-mounted overlay (the Preview precedent), so it floats above the panel.
  // Structure: a FIXED head (title + Done) and a FIXED "new playlist" create row
  // stay pinned at the top; only the list of playlists scrolls beneath them. Adding
  // — whether to an existing list or via create-and-add — KEEPS THE PICKER OPEN so
  // you can add the same song to several playlists; it closes only on Done/backdrop.
  // onAdded (optional): fired ONCE, only when a track was genuinely added (r.ok), after
  // the picker closes. Used by the now-playing ★ to emit ddjp.dj.save + latch the star;
  // History's ＋ passes nothing (saving an old song is not a reaction to now-playing).
  function _openAddToPlaylist(videoId, onAdded) {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined") return;
    const prior = document.querySelector(".pl-pick-overlay");
    if (prior) prior.remove();

    const result = el("div", { class: "uq-note muted pl-pick-note" });
    const listWrap = el("div", { class: "pl-pick-list" });

    const close = () => { overlay.remove(); };
    const addTo = async (pid, pname) => {
      const r = await Playlists.addTrack(pid, videoId);
      delete _plCounts[pid];   // library count is stale now; it reloads on next view
      const added = !!(r && r.ok);
      result.textContent = added ? "Added to “" + pname + "”."
        : "Not added: " + ((r && r.reason) || "unknown") + ".";
      close();   // one-and-done: adding a song closes the picker (as if Done)
      if (added && typeof onAdded === "function") { try { await onAdded(); } catch (e) {} }
    };

    const paint = () => {
      clear(listWrap);
      const lists = _plSort(Playlists.list());
      if (!lists.length) { listWrap.appendChild(el("p", { class: "muted", text: "No playlists yet — make one above." })); return; }
      for (const p of lists) {
        const b = el("button", { class: "pl-pick-item", text: p.name });
        b.onclick = () => addTo(p.id, p.name);
        listWrap.appendChild(b);
      }
    };

    const newInput = el("input", { class: "uq-input", placeholder: "New playlist…" });
    const newAdd = async () => {
      const name = newInput.value.trim();
      if (!name) return;
      const c = await Playlists.create(name);
      if (c && c.ok) { newInput.value = ""; await addTo(c.id, c.name); }   // create, add, then close (addTo closes)
      else { result.textContent = "Couldn't create: " + ((c && c.reason) || "unknown") + "."; }
    };
    newInput.onkeydown = (e) => { if (e.key === "Enter") newAdd(); };
    paint();

    // Fixed head: title + Done.
    const closeBtn = el("button", { class: "mini", text: "Done", onclick: close });
    const head = el("div", { class: "pl-pick-head" }, [
      el("span", { class: "pl-pick-title", text: "Add to a playlist" }),
      el("span", { class: "uq-actions" }, [closeBtn]),
    ]);
    // Fixed create row + result note, pinned under the head, above the scrolling list.
    const newRow = el("div", { class: "uq-add pl-pick-new" }, [newInput, el("button", { text: "Create + add", onclick: newAdd })]);

    const card = el("div", { class: "pl-pick-card" }, [head, newRow, result, listWrap]);
    const overlay = el("div", { class: "pl-pick-overlay" }, [card]);
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    setTimeout(() => { try { newInput.focus(); } catch (e) {} }, 0);
  }

  // A ＋ action button that opens the add-to-playlist picker for a videoId. Shared
  // by the History rows and the Now-Playing row.
  function _addToPlaylistBtn(videoId) {
    return el("button", { class: "mini ico", text: "＋", title: "Add to a playlist",
      onclick: () => _openAddToPlaylist(videoId) });
  }

  // After any add/vote, refresh BOTH surfaces the affordances live on: the player bar
  // (persistent refs, updated in place) and the room-queue now-playing row (rebuilt).
  function _reflectReactions() {
    _syncNpButtons();
    if (queueTab === "room") renderQueuePanel();
  }
  // ★ press: capture the play-instance + song NOW (the picker is async and the song may
  // advance), open the same add-to-playlist picker History's ＋ uses, and only on a real
  // add emit ddjp.dj.save + latch the star lit for this instance. Cancelling saves nothing.
  // One-way: no-op once already saved this instance.
  function _onStarPress() {
    if (typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved()) return;
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    if (!np || !np.song) return;
    const pi = np.pi != null ? np.pi : null;
    _openAddToPlaylist(np.song.videoId, async () => {
      if (typeof Reactions !== "undefined" && Reactions.recordSave) {
        await Reactions.recordSave(pi);
        _reflectReactions();
      }
    });
  }
  // ▲ press: emit ddjp.dj.vote for the current instance + latch. One-way (no un-vote).
  async function _onVotePress() {
    if (typeof Reactions === "undefined" || !Reactions.vote) return;
    if (Reactions.hasVoted && Reactions.hasVoted()) return;
    await Reactions.vote();
    _reflectReactions();
  }
  // ★ button for a row (the room-queue now-playing row). Reflects Reactions.hasSaved():
  // ☆ outline when not yet saved this instance, ★ filled once saved. Acts on the current
  // song, so no videoId arg — it reads now-playing itself.
  function _starBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved();
    const b = el("button", { class: "mini ico grab" + (on ? " on" : ""), text: on ? "\u2605" : "\u2606",
      title: !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song") });
    b.disabled = !playing;
    b.onclick = _onStarPress;
    return b;
  }
  // ▲ upvote button for a row. Reflects Reactions.hasVoted().
  function _voteBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasVoted && Reactions.hasVoted();
    const b = el("button", { class: "mini ico upvote" + (on ? " on" : ""), text: "\u25B2",
      title: !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song") });
    b.disabled = !playing;
    b.onclick = _onVotePress;
    return b;
  }
  // Keep the player-bar ★/▲ buttons in step with the current now-playing song: reflect
  // its latched add/vote state (from Reactions), and disable both when nothing is playing.
  function _syncNpButtons() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const R = (typeof Reactions !== "undefined") ? Reactions : null;
    if (refs.grabBtn) {
      const on = playing && R && R.hasSaved && R.hasSaved();
      refs.grabBtn.disabled = !playing;
      refs.grabBtn.classList.toggle("on", !!on);
      refs.grabBtn.textContent = on ? "\u2605" : "\u2606";
      refs.grabBtn.title = !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song");
    }
    if (refs.upvoteBtn) {
      const on = playing && R && R.hasVoted && R.hasVoted();
      refs.upvoteBtn.disabled = !playing;
      refs.upvoteBtn.classList.toggle("on", !!on);
      refs.upvoteBtn.title = !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song");
    }
  }

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

    // The leave-lock is shown ONLY in Leave mode. It starts LOCKED each time it
    // newly appears (a Join→Leave transition); while it stays visible across
    // re-renders, an in-progress unlock window is preserved (don't disturb it).
    if (refs.leaveLockBtn) {
      const wasShown = refs.leaveLockBtn.style.display !== "none";
      if (active) {
        if (!wasShown) _relock("leave");          // newly appearing → locked, bar reset
        refs.leaveLockBtn.style.display = "";
      } else {
        refs.leaveLockBtn.style.display = "none";
        _relock("leave");                          // hidden → cancel any window, back to locked
      }
      _renderLeaveLock();
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
      const label = st.inProgress ? "Resume (" + st.currentBatch + "/" + st.maxBatch + ")"
                                  : "Upgrade (" + st.currentBatch + "/" + st.maxBatch + ")";
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
      await new Promise(r => setTimeout(r, UPGRADE_DONE_PAUSE_MS));
    }
    renderUpgradePanel();
  }

  // ---------------------------------------------------------------------------
  // CHAT
  // ---------------------------------------------------------------------------
  // Chat is a bounded RAM window backed by Matrix. Decrypted text never touches
  // disk (ephemeral/E2E preserved; cleared-on-boot automatic). At the bottom the
  // DOM holds the most-recent CHAT_DOM_CAP messages and the oldest fall away as
  // new ones arrive — but the moment you scroll UP, the homeserver is asked for
  // older messages and they're prepended (the history RAM dropped comes back),
  // with your scroll position anchored so nothing you're reading jumps. Trimming
  // is STICKY-AWARE: it pauses while you read older messages and resumes when you
  // return to the bottom (collapsing the window back to the cap). Dedup is owned
  // by the window itself — an id is "seen" only while its row is in the DOM, so a
  // trimmed-then-reloaded message renders again instead of being suppressed.
  const CHAT_DOM_CAP = 600;        // most-recent rows kept mounted while following the tail
  const CHAT_BOTTOM_SLOP = 48;     // px from the bottom still counts as "at the bottom"
  const CHAT_TOP_SLOP = 64;        // px from the top that triggers a load-older
  const CHAT_PAGE = 30;            // messages revealed from RAM per scroll-up
  const CHAT_BACKFILL = 10;        // one-shot recent-history fetch on room entry (hardcoded for now)
  const CHAT_IMG_LRU = 30;         // max inline images kept decoded (with a live src) at once
  const UTD_TEXT = "Couldn't decrypt this message";   // shown for an undecryptable message

  // Per-box state. The ChatBuffer is the RAM source of truth (up to 5000 msgs,
  // oldest evicted on overflow); the DOM renders a window of it. domIds = ids
  // currently mounted (trim removes from here, NOT from the buffer, so a trimmed
  // message re-renders from RAM on scroll-up with no network). imgLRU = ids of
  // inline images that currently hold a live src, most-recently-shown last.
  function _newChatState() {
    return { buf: ChatBuffer.create(), domIds: new Set(), loading: false, backfilled: false, io: null, imgLRU: [] };
  }
  function _chatState(box) {
    if (!box._chat) box._chat = _newChatState();
    return box._chat;
  }
  function _resetChatState(box) {
    if (!box) return;
    if (box._chat && box._chat.io) { try { box._chat.io.disconnect(); } catch (e) {} }
    box._chat = _newChatState();
  }

  function _chatAtBottom(box) { return (box.scrollHeight - box.scrollTop - box.clientHeight) <= CHAT_BOTTOM_SLOP; }
  function _eidSel(id) { return '[data-eid="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id) + '"]'; }

  // Lazily load an inline image's src only when it scrolls into view, and keep at
  // most CHAT_IMG_LRU images decoded — scroll one far away and it's released;
  // scroll back and it reloads (served from the browser's HTTP cache, so the
  // image host isn't re-hit). RAM-only; nothing persisted.
  function _chatObserver(box) {
    const st = _chatState(box);
    if (st.io || typeof IntersectionObserver === "undefined") return st.io;
    st.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        const src = img.dataset ? img.dataset.src : null;
        if (!src) continue;
        if (img.getAttribute("src") !== src) img.setAttribute("src", src);   // (re)load
        const id = img.dataset ? img.dataset.eid : null;
        if (!id) continue;
        const i = st.imgLRU.indexOf(id);
        if (i >= 0) st.imgLRU.splice(i, 1);
        st.imgLRU.push(id);                                  // most-recently-shown last
        while (st.imgLRU.length > CHAT_IMG_LRU) {             // release the least-recent
          const oldId = st.imgLRU.shift();
          const node = box.querySelector('img' + _eidSel(oldId));
          if (node) node.removeAttribute("src");             // free decode; data-src kept for reload
        }
      }
    }, { root: box, rootMargin: "200px 0px" });
    return st.io;
  }

  // Inner content for a message record, decided at RENDER time from the viewer's
  // current chat prefs (ChatPrefs): an undecryptable placeholder, an inline image,
  // a clickable link, or plain text. Images and links are BOTH off by default
  // (opt in per category under the gear → Settings tab), so by default every body
  // is a plain text node and nothing auto-fetches a third party. Images/links are
  // built via createElement + setAttribute/textContent — never innerHTML
  // (check-html-safety) — and classify only ever yields an https URL on a host the
  // user allowlisted.
  function _chatContent(box, record) {
    if (record.failed) return document.createTextNode(" " + UTD_TEXT);
    const c = ChatBuffer.classify(record.body, ChatPrefs.classifyOpts());
    if (c.kind === "image" && c.src) {
      const img = document.createElement("img");
      img.className = "chat-img";
      img.alt = c.src;
      img.title = c.src;                                   // hover shows where the image points
      img.setAttribute("referrerpolicy", "no-referrer");   // don't leak the room to the image host
      img.style.maxWidth = "240px";
      img.style.maxHeight = "240px";
      img.style.borderRadius = "6px";
      img.style.display = "block";
      img.style.marginTop = "3px";
      if (record.id) img.dataset.eid = record.id;
      img.dataset.src = c.src;
      const io = _chatObserver(box);
      if (io) io.observe(img); else img.setAttribute("src", c.src);   // no IO -> load directly
      return img;
    }
    if (c.kind === "link" && c.href) {
      const a = document.createElement("a");
      a.className = "chat-link";
      a.textContent = " " + record.body;                   // label is the URL text (safe text node)
      a.href = c.href;                                     // https-only, allowlisted host (classify-enforced)
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";              // no window.opener, no referrer, no SEO transfer
      a.setAttribute("referrerpolicy", "no-referrer");
      return a;
    }
    return document.createTextNode(" " + record.body);
  }

  function _chatRow(box, record) {
    const color = rankColor(_rosterLevel(record.sender));
    const senderEl = el("span", { class: "sender", text: shortName(record.sender) });
    senderEl.style.color = color;
    const av = avatarEl(record.sender, 20);
    av.style.marginRight = "5px";
    av.style.verticalAlign = "middle";
    av.dataset.avatarFor = record.sender;   // lets onAvatarChange find and refresh it
    const msg = el("div", { class: "chat-msg" }, [av, senderEl]);
    msg.appendChild(_chatContent(box, record));
    if (record.id) msg.dataset.eid = record.id;   // window key (dedup + in-place update)
    return msg;
  }

  function _trimChat(box) {
    const st = _chatState(box);
    while (box.children.length > CHAT_DOM_CAP) {
      const node = box.firstChild;
      const id = node && node.dataset ? node.dataset.eid : null;
      if (id) st.domIds.delete(id);     // freed from the DOM (stays in buf) -> re-renders on scroll-up
      box.removeChild(node);
    }
  }

  // A chat display pref changed (image/link master toggle, or a host edit). The
  // buffer is content-only and untouched; we just rebuild each MOUNTED row from
  // its record so a body flips between text / image / link to match the new prefs.
  // Bounded by what's currently mounted; the image LRU resets and the observer
  // re-attaches to any rows that just became images.
  function _repaintChat(box) {
    if (!box) return;
    const st = _chatState(box);
    st.imgLRU = [];
    for (const id of Array.from(st.domIds)) {
      const old = box.querySelector(_eidSel(id));     // the row div is the first match in tree order
      const rec = st.buf.get(id);
      if (!old) { st.domIds.delete(id); continue; }
      if (!rec || rec.failed) { old.remove(); st.domIds.delete(id); continue; }
      old.replaceWith(_chatRow(box, rec));
    }
  }

  // A previously-hidden message just became readable (its megolm key arrived and
  // the SDK re-fired Event.decrypted). Insert it in correct timeline order — find
  // the nearest mounted message AFTER it in buffer order and put it before that
  // row; if it belongs after everything mounted, append it. If NEITHER neighbour
  // is on screen (it sits in a scrolled-away region), do nothing — it renders in
  // order when you scroll there. Anchored so the view never jumps; never reorders.
  function _insertDecrypted(box, id, record) {
    const st = _chatState(box);
    const all = st.buf.ids();                 // oldest -> newest
    const idx = all.indexOf(id);
    if (idx < 0) return;

    // nearest mounted neighbour AFTER this message -> insert right before it
    let beforeNode = null;
    for (let i = idx + 1; i < all.length; i++) {
      if (st.domIds.has(all[i])) { beforeNode = box.querySelector(_eidSel(all[i])); break; }
    }
    // nearest mounted neighbour BEFORE this message (to confirm we're inside the window)
    let hasPrevMounted = false;
    for (let i = idx - 1; i >= 0; i--) {
      if (st.domIds.has(all[i])) { hasPrevMounted = true; break; }
    }

    // Only insert if this message sits inside the currently-mounted region:
    // either it has a mounted neighbour after it, or it has one before it and
    // belongs at the live tail. Otherwise leave it for scroll-driven render.
    if (!beforeNode && !hasPrevMounted) return;

    const atBottom = _chatAtBottom(box);
    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const row = _chatRow(box, record);
    if (beforeNode) box.insertBefore(row, beforeNode);
    else box.appendChild(row);                // belongs after everything mounted (live tail)
    st.domIds.add(id);

    if (atBottom && !beforeNode) box.scrollTop = box.scrollHeight;     // following the tail
    else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);     // anchor; don't jump
  }

  // Live receive. upsert() into the RAM buffer, then render the outcome:
  //   insert -> a new newest row (append + follow the tail if sticky)
  //   update -> patch the existing row IN PLACE (placeholder -> real text, etc.)
  //   noop   -> ignored (no id, or a placeholder that must not clobber real text)
  function addChatMessage(id, sender, body, failed) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box) return;
    const st = _chatState(box);
    const res = st.buf.upsert(id, sender, body, failed);
    if (res.type === "noop") return;

    _ensureChatScrollWired(box);

    if (res.type === "update") {
      const old = box.querySelector(_eidSel(id));
      if (res.record.failed) {                               // undecryptable -> hidden
        if (old) { st.domIds.delete(id); old.remove(); }
        return;
      }
      if (old) { old.replaceWith(_chatRow(box, res.record)); return; }   // mounted -> patch in place
      // Not mounted but now readable (a pending message whose key just arrived).
      // Insert it in correct timeline order, but ONLY if its neighbours are on
      // screen — otherwise it lives in a scrolled-away region and will render in
      // order when you scroll there. Never reorder, never dump at the bottom.
      _insertDecrypted(box, id, res.record);
      return;
    }

    // insert: new newest message. Undecryptable old/re-key messages are hidden
    // (kept in the buffer for ordering/dedup, but never drawn — they carry no
    // readable content on this device).
    if (res.record.failed) return;
    const stick = _chatAtBottom(box);
    box.appendChild(_chatRow(box, res.record));
    if (id) st.domIds.add(id);
    if (stick) { _trimChat(box); box.scrollTop = box.scrollHeight; }
    // Scrolled up: leave scroll + DOM untouched so the reader isn't disturbed; the
    // next return-to-bottom trims back to the cap.
  }

  // Wire the scroll handler once per box: trim back to the cap when we return to
  // the bottom, and reveal older RAM-buffered messages when we near the top.
  function _ensureChatScrollWired(box) {
    if (!box || box.dataset.scrollWired) return;
    box.dataset.scrollWired = "1";
    box.addEventListener("scroll", () => {
      if (_chatAtBottom(box)) _trimChat(box);
      else if (box.scrollTop <= CHAT_TOP_SLOP) _loadOlderChat(box);
    });
  }

  // Scroll-up: reveal up to CHAT_PAGE older messages that are ALREADY in the RAM
  // buffer but not currently mounted (trimmed when we followed the tail). This is
  // RAM-only — chat never pages history from Matrix on scroll. Chat is
  // present-forward: the only history the buffer holds is the one-shot join
  // backfill (_backfillChatOnce) plus whatever has arrived live this session.
  // Hidden (undecryptable) messages are skipped. View stays anchored.
  function _loadOlderChat(box) {
    const st = _chatState(box);
    const all = st.buf.ids();                              // oldest -> newest
    const firstNode = box.firstChild;
    const oldestDom = firstNode && firstNode.dataset ? firstNode.dataset.eid : null;
    let firstIdx = oldestDom ? all.indexOf(oldestDom) : all.length;
    if (firstIdx < 0) firstIdx = all.length;

    const picked = new Set();
    for (let i = firstIdx - 1; i >= 0 && picked.size < CHAT_PAGE; i--) {
      const idv = all[i];
      if (st.domIds.has(idv)) continue;
      const rec = st.buf.get(idv);
      if (rec && !rec.failed) picked.add(idv);             // skip hidden (undecryptable)
    }
    if (!picked.size) return;

    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const frag = document.createDocumentFragment();
    for (const idv of st.buf.ids()) {        // render in buffer order (oldest -> newest)
      if (!picked.has(idv) || st.domIds.has(idv)) continue;
      const rec = st.buf.get(idv);
      if (!rec) continue;
      st.domIds.add(idv);
      frag.appendChild(_chatRow(box, rec));
    }
    box.insertBefore(frag, box.firstChild);
    box.scrollTop = beforeTop + (box.scrollHeight - beforeH);   // anchor the view
  }

  // One-shot history backfill when a room's chat starts: pull the last
  // CHAT_BACKFILL messages of the active channel from Matrix in a SINGLE fetch
  // (the recent TAIL — recentChatMessages). Only the READABLE ones become buffer
  // rows: a backfilled message this device can't decrypt is DROPPED entirely here
  // — never buffered, never drawn — so it shows NO error now and stays silent even
  // if live messages later render decryption errors (the two are decoupled). The
  // readable ones are folded in oldest-first (prependOlder), in chronological
  // order, as ORDINARY messages: they count toward the buffer CAP and evict like
  // any other (oldest first, so these go first). Runs once per room entry; chat is
  // present-forward after. A brand-new room — or one whose recent messages are all
  // undecryptable — yields nothing and this is a clean no-op.
  async function _backfillChatOnce(box) {
    if (!box) return;
    const st = _chatState(box);
    if (st.backfilled || st.loading) return;
    st.backfilled = true;
    st.loading = true;
    _ensureChatScrollWired(box);
    try {
      let res;
      try { res = await Chat.backfillRecent(CHAT_BACKFILL); }
      catch (e) { return; }
      // Readable-only: drop undecryptable backfilled messages before they ever
      // reach the buffer (so they can never surface an error row).
      const older = ((res && res.messages) || []).filter((m) => m && !m.failed);
      if (!older.length) return;
      const atBottom = _chatAtBottom(box);
      const beforeH = box.scrollHeight;
      const beforeTop = box.scrollTop;
      st.buf.prependOlder(older);
      const frag = document.createDocumentFragment();
      for (const idv of st.buf.ids()) {        // oldest -> newest
        if (st.domIds.has(idv)) continue;
        const rec = st.buf.get(idv);
        if (!rec || rec.failed) continue;      // never draw a failed row (e.g. a racing live insert)
        st.domIds.add(idv);
        frag.appendChild(_chatRow(box, rec));
      }
      if (frag.childNodes.length) {
        box.insertBefore(frag, box.firstChild);
        if (atBottom) box.scrollTop = box.scrollHeight;                 // fresh box: stick to bottom
        else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);  // else keep the reader put
      }
    } finally {
      st.loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // YOUTUBE PLAYER (the song element)
  // ---------------------------------------------------------------------------
  let _currentSong = null;   // { videoId, dj } of what's loaded, for reset/title
  let _endedNow = false;     // current song genuinely ended (set from the real iframe ENDED via Playback's overlay; no longer the wall-clock estimate)

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

  // Consensus delivers the room's now-playing here. We always cache it (_lastNp) so a
  // running preview keeps TRACKING the live position; while a preview is active we stop
  // DRIVING the local player (the preview has taken it over) and re-sync on close.
  function onPlaybackStateChange(np) {
    _lastNp = np;
    if (_previewActive) return;   // detached during preview: track, don't drive
    _driveNowPlaying(np);
  }
  // Show/hide the click-shield over the main player. Shown when nothing is actually
  // playing so YouTube's replay/poster can't restart a finished song locally.
  function _showPlayerShield(show) {
    if (refs.playerShield) refs.playerShield.style.display = show ? "block" : "none";
  }

  function _driveNowPlaying(np) {
    if (!np) { _endedNow = false; _showPlayerShield(true); clearVideo(); clearProgress(); renderNowPlaying(); _currentSong = null; updateVideoTitle(); return; }
    if (np.ended) {
      // The current song has finished in real time and nothing has replaced it
      // yet. Reflect "nothing playing" and stop the video so it can't replay.
      // Don't re-read the derived state here — it still holds the just-ended
      // song until the advance lands; the overlay flag makes renderNowPlaying
      // show nothing too. Cleared as soon as a real song (or null) arrives.
      _endedNow = true;
      _showPlayerShield(true);
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
    if (np.song) { startProgress(); _showPlayerShield(false); }
    if (refs.npLabel && np.elapsed !== undefined) {
      _setNpLabel(np.dj, " · " + fmt(np.elapsed) + (np.duration ? " / " + fmt(np.duration) : ""));
    }
    // NOTE: volume/mute is NO LONGER force-re-asserted every tick — that would
    // overwrite a change the user makes inside the YouTube iframe. Two-way sync is
    // handled by _pollYtVolume (adopts in-iframe changes) plus re-assertion on real
    // player transitions (onReady / onStateChange / load).
  }

  // Push the player-sourced title + duration into the metadata cache when a song
  // is witnessed playing (14 §3: the player is a robust title source and the only
  // duration source). This is what makes a WITNESSED play "known/stored" — its
  // metadata is cached, so it shows full in History/Room queue and never refetches.
  // Push player-sourced title/duration onto every already-rendered row for this
  // video. The now-playing room-queue row (and a freshly-played History row) get
  // built the instant the song starts — before YouTube's IFrame API reports the
  // title — so they show the bare videoId. Nothing else re-reads metadata for an
  // existing row, so when the title finally lands we apply it directly. Titles are
  // regenerable CACHE, never truth (storage law), so this is display-only.
  function _applyMetaToRows(videoId, title, durationSec) {
    if (!refs.queueBody || !videoId) return;
    const esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(videoId) : videoId;
    refs.queueBody.querySelectorAll('.song-row[data-vid="' + esc + '"]').forEach((row) => {
      if (title) { const t = row.querySelector(".sr-title"); if (t) { t.textContent = title; t.title = title; } }
      if (typeof durationSec === "number" && durationSec > 0) {
        const d = row.querySelector(".sr-dur"); if (d) d.textContent = _fmtDur(durationSec);
      }
    });
  }

  function _pushPlayerMeta(videoId) {
    if (typeof MetadataService === "undefined" || !videoId) return;
    try {
      const vd = player && player.getVideoData ? player.getVideoData() : null;
      const title = vd && vd.title ? vd.title : null;
      const dn = player && player.getDuration ? player.getDuration() : 0;
      const dur = (typeof dn === "number" && isFinite(dn) && dn > 0) ? dn : null;
      // ONE combined write — recording title and duration separately raced on the
      // same Store.meta record and the title kept getting clobbered, so it never
      // persisted and every re-render / History read fell back to the videoId.
      if ((title || dur) && MetadataService.recordMeta) {
        const fields = {};
        if (title) fields.title = title;
        if (dur) fields.durationSec = dur;
        Promise.resolve(MetadataService.recordMeta(videoId, fields))
          .then(() => { _applyMetaToRows(videoId, title, dur); })
          .catch(() => { _applyMetaToRows(videoId, title, dur); });
      } else {
        _applyMetaToRows(videoId, title, dur);
      }
    } catch (e) { /* player not ready to report yet — a later poll/tick will catch it */ }
  }

  function updateVideoTitle() {
    if (!refs.videoTitle || !refs.videoTitleText) return;
    if (!_currentSong) { refs.videoTitleText.textContent = ""; _fitMarquee(); return; }
    // YouTube's IFrame API only exposes a real title after the player has
    // buffered the video (getVideoData().title); until then, fall back to the
    // video ID so something is shown immediately instead of staying blank.
    const vd = player && player.getVideoData ? player.getVideoData() : null;
    const realTitle = vd && vd.title ? vd.title : null;
    refs.videoTitleText.textContent = realTitle || _currentSong.videoId;
    _fitMarquee();
    if (realTitle) _pushPlayerMeta(_currentSong.videoId);   // witnessed → store player-sourced meta
    // The real title is often not ready at the moment this first runs (right at
    // PLAYING). If we only had the ID, poll a few times for the real title and
    // re-fit the marquee once it lands.
    if (!realTitle) {
      const want = _currentSong.videoId;
      let n = 0;
      const poll = () => {
        if (!_currentSong || _currentSong.videoId !== want) return;   // song changed — stop
        const v = player && player.getVideoData ? player.getVideoData() : null;
        if (v && v.title) {
          refs.videoTitleText.textContent = v.title;
          _fitMarquee();
          _pushPlayerMeta(want);                          // witnessed → store once the title lands
          return;
        }
        if (++n < VIDEO_META_MAX_POLLS) setTimeout(poll, VIDEO_META_POLL_MS);
      };
      setTimeout(poll, VIDEO_META_POLL_MS);
    }
  }

  // Marquee: if the title is wider than its box, scroll it slowly to the end,
  // pause, return, pause, and repeat. Implementation note: rather than rely on a
  // CSS custom property in the keyframe (which needs @property registration to
  // interpolate, and was the reason this silently didn't animate), we inject a
  // dedicated keyframe carrying the literal pixel distance and a self-contained
  // `animation` shorthand. No custom props, no class/inline longhand mixing.
  function _ensureMarqueeStyleEl() {
    if (refs.marqueeStyleEl) return refs.marqueeStyleEl;
    const s = document.createElement("style");
    s.id = "ddjp-marquee-style";
    document.head.appendChild(s);
    refs.marqueeStyleEl = s;
    return s;
  }
  function _fitMarquee() {
    const box = refs.videoTitle, txt = refs.videoTitleText;
    if (!box || !txt) return;

    // Coalesce bursts (a window-resize drag fires the ResizeObserver many times):
    // cancel any pending fit so only the latest measurement wins.
    if (_marqueeRaf) { cancelAnimationFrame(_marqueeRaf); _marqueeRaf = 0; }

    // Clean slate every call. This is what makes resize correct in BOTH
    // directions: stop any running animation and drop the transform, then
    // re-measure against the CURRENT box width and re-apply from scratch.
    txt.style.animation = "";
    txt.style.transform = "";

    let tries = 0;
    const apply = () => {
      if (!refs.videoTitle || !refs.videoTitleText) return true;
      const boxW = box.clientWidth;
      if (boxW <= 0) return false;                 // not laid out yet — retry next frame
      const overflow = txt.scrollWidth - boxW;
      if (overflow > 4) {
        const dist = Math.round(overflow);
        const travelSec = Math.max(3, dist / 30);  // ~30px/sec each way
        const total = (travelSec * 2) + 3;         // out + back + ~3s paused ends
        // A UNIQUE keyframe name per fit. Reusing one constant name with a new
        // distance was the resize bug: the browser kept the previous animation's
        // travel distance (grow → scrolled past the left edge / out of view) or
        // failed to restart at all (shrink → stayed static). A fresh name forces
        // a fresh parse + a clean start with the new distance every time.
        const name = "ddjp-marquee-" + (++_marqueeSeq);
        _ensureMarqueeStyleEl().textContent =
          "@keyframes " + name + " {" +
          "  0%,18% { transform: translateX(0); }" +
          "  50%,68% { transform: translateX(-" + dist + "px); }" +
          "  100% { transform: translateX(0); }" +
          "}";
        // Commit the cleared animation before re-adding so the restart is
        // guaranteed even when this runs many times during a resize drag.
        void txt.offsetWidth;
        txt.style.animation = name + " " + total.toFixed(1) + "s ease-in-out infinite";
      }
      // overflow <= 4: it fits — leave the animation cleared above (static title).
      return true;
    };
    const tick = () => {
      _marqueeRaf = 0;
      if (apply()) return;
      if (++tries < 10) _marqueeRaf = requestAnimationFrame(tick);
    };
    _marqueeRaf = requestAnimationFrame(tick);
  }

  function initYouTubePlayer() {
    player = null; playerReady = false;
    if (!window.YT || !window.YT.Player) { setTimeout(initYouTubePlayer, YT_INIT_RETRY_MS); return; }
    player = new YT.Player("yt-player", {
      height: "300", width: "100%", videoId: "",
      playerVars: { autoplay: 1, controls: 1, mute: 1 },
      events: {
        onReady: () => {
          playerReady = true;
          Logger.debug("Interface: player ready");
          applyVolumeState();   // enforce the user's chosen volume immediately on ready
          _startYtVolumePoll(); // begin two-way volume/mute sync with the iframe
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            const d = player.getDuration(), vd = player.getVideoData();
            if (d && vd) Playback.setDuration(vd.video_id, d);
            updateVideoTitle();      // title is often only available once playing
            applyVolumeState();      // re-assert on every state transition
          } else if (e.data === YT.PlayerState.ENDED) {
            // The iframe itself reports the song finished — the authoritative
            // end signal (the wall-clock elapsed>=duration check in playback.js
            // is only a fallback). Forward the ended video's id down to
            // Playback, which decides (shouldEndOn) and advances through the
            // normal lock-guarded path. We stay dumb here — no protocol decision
            // in the UI. getVideoData() can return undefined mid-swap, so guard
            // the read; a missing id makes Playback no-op and the wall-clock
            // fallback take over.
            let endedId = null;
            try {
              const vd = player.getVideoData();
              if (vd && vd.video_id) endedId = vd.video_id;
            } catch (e2) { /* player not in a state to report video data yet */ }
            Playback.notifyEnded(endedId);
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
      if (!_loadTimer) _loadTimer = setTimeout(() => { _loadTimer = null; _doLoad(); }, PLAYER_LOAD_RETRY_MS);
      return;
    }
    const w = _wantVideo;
    const elapsed = (Date.now() - w.startedAt) / 1000;
    player.loadVideoById({ videoId: w.videoId, startSeconds: Math.max(0, elapsed) });
    // Apply the user's actual chosen state — NOT an unconditional unmute.
    // (Previously this always force-unmuted after load, which would silently
    // override a user who had chosen to mute. The player starts muted only to
    // satisfy browser autoplay policy; applyVolumeState corrects it right after.)
    setTimeout(() => applyVolumeState(), VOLUME_APPLY_DELAY_MS);
  }

  // Reset = reload the current song from the start, in THIS browser only. Pure
  // local re-sync — does not touch the room, the rotation, or any other client.
  function reloadCurrentVideo() {
    if (!_currentSong || !player || !playerReady) return;
    player.loadVideoById({ videoId: _currentSong.videoId, startSeconds: 0 });
    setTimeout(() => applyVolumeState(), VOLUME_APPLY_DELAY_MS);
  }

  // Push the local volume/mute state onto the actual player. Safe to call
  // anytime — no-ops if the player isn't ready yet.
  function applyVolumeState() {
    if (!player || !playerReady) return;
    try {
      player.setVolume(volumeState.level);
      if (volumeState.muted || volumeState.level === 0) player.mute();
      else player.unMute();
      // Remember what we pushed so the poll can distinguish our own writes from a
      // user change made inside the YouTube iframe.
      _ytVol.pushedLevel = volumeState.level;
      _ytVol.pushedMuted = (volumeState.muted || volumeState.level === 0);
    } catch (e) { /* player not fully initialized yet — next call will catch up */ }
    _syncVolumeUI();
  }

  // Reflect volumeState into the slider + mute button (no player write).
  function _syncVolumeUI() {
    if (refs.muteBtn) refs.muteBtn.textContent = (volumeState.muted || volumeState.level === 0) ? "🔇" : "🔊";
    if (refs.volumeSlider && parseInt(refs.volumeSlider.value, 10) !== volumeState.level) {
      refs.volumeSlider.value = String(volumeState.level);
    }
  }

  // Two-way sync: poll the YouTube player's own volume/mute. If they differ from
  // what we last pushed, the user changed them via the iframe's native controls —
  // adopt those values into our state + UI (don't fight them). YT exposes no
  // volume-change event, so polling is the only way to observe in-iframe changes.
  function _pollYtVolume() {
    if (!player || !playerReady) return;
    let lvl, muted;
    try { lvl = player.getVolume(); muted = player.isMuted(); }
    catch (e) { return; }
    if (typeof lvl !== "number") return;
    const changedInIframe =
      (_ytVol.pushedLevel >= 0 && Math.abs(lvl - _ytVol.pushedLevel) > 1) ||
      (_ytVol.pushedMuted !== null && muted !== _ytVol.pushedMuted);
    if (changedInIframe) {
      volumeState.level = Math.round(lvl);
      volumeState.muted = !!muted;
      _ytVol.pushedLevel = volumeState.level;     // treat the adopted value as current
      _ytVol.pushedMuted = volumeState.muted || volumeState.level === 0;
      _syncVolumeUI();                            // reflect into our controls (no re-push)
    }
  }
  function _startYtVolumePoll() {
    if (_ytVol.pollTimer) return;
    _ytVol.pollTimer = setInterval(_pollYtVolume, YT_VOLUME_POLL_MS);
  }

  function seekPlayer(seconds) { if (player && playerReady) player.seekTo(seconds, true); }
  function getPlayerTime() { if (!player || !playerReady) return null; try { return player.getCurrentTime(); } catch (e) { return null; } }
  function clearVideo() {
    _wantVideo = null;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
    if (player && playerReady) player.stopVideo();
  }

  // ===== Encryption / recovery-key screens (Topic 2) =====
  // Render into #screen-encryption. These never touch the SDK — index.html passes
  // callbacks that do the MatrixBridge work; these methods collect input, enforce
  // the save/understanding gates, and surface errors.

  function _encMount(node) {
    const host = document.getElementById("screen-encryption");
    if (!host) return;
    clear(host);
    host.appendChild(node);
    showScreen("screen-encryption");
  }

  // "Enter your recovery key" — the normal path for an account set up in Element.
  // onUnlock(key) resolves on success (and transitions away) or throws on a bad key.
  // onForgot() routes to the reset-understanding gate. onLogout() is the escape hatch.
  function showEnterRecoveryKey({ onUnlock, onForgot, onLogout }) {
    const input = el("input", { type: "text", class: "enc-input", placeholder: "Recovery key (e.g. EsTc ABCD …)" });
    const err = el("p", { class: "enc-error" });
    const btn = el("button", { class: "btn-primary", text: "Unlock" });
    btn.onclick = async () => {
      err.textContent = "";
      btn.disabled = true; btn.textContent = "Unlocking…";
      try { await onUnlock(input.value); }
      catch (e) { err.textContent = (e && e.message) || "Couldn't unlock."; btn.disabled = false; btn.textContent = "Unlock"; }
    };
    input.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
    const forgot = el("button", { class: "enc-link", text: "I don't have my recovery key" });
    forgot.onclick = () => onForgot();
    const logout = el("button", { class: "enc-link enc-link-muted", text: "Log out" });
    logout.onclick = () => onLogout && onLogout();
    _encMount(el("div", { class: "enc-box" }, [
      el("h2", { text: "Unlock encrypted messages" }),
      el("p", { class: "enc-sub", text: "Enter the recovery key you saved when you set up your account in Element. This verifies this device and restores your encrypted message history." }),
      input, err, btn,
      el("div", { class: "enc-divider" }),
      forgot, logout,
    ]));
    setTimeout(() => input.focus(), 0);
  }

  // Gate A — understanding that resetting is destructive. Continue stays disabled
  // until both acknowledgements are ticked. onConfirm() proceeds to create a new key.
  function showResetWarning({ onConfirm, onBack }) {
    const ack1 = el("input", { type: "checkbox", class: "enc-check" });
    const ack2 = el("input", { type: "checkbox", class: "enc-check" });
    const cont = el("button", { class: "btn-primary", text: "Create a new recovery key", disabled: true });
    const refresh = () => { cont.disabled = !(ack1.checked && ack2.checked); };
    ack1.onchange = refresh; ack2.onchange = refresh;
    cont.onclick = () => onConfirm();
    const back = el("button", { class: "btn-secondary", text: "Go back" });
    back.onclick = () => onBack();
    _encMount(el("div", { class: "enc-box enc-box-wide" }, [
      el("h2", { text: "Create a new recovery key?" }),
      el("p", { class: "enc-sub", text: "Do this only if you genuinely cannot find your existing recovery key. Check Element and your password manager first — the old key cannot be recovered once you replace it." }),
      el("label", { class: "enc-ack" }, [ack1, el("span", { text: "I understand that creating a new key permanently replaces my old one, and any encrypted messages that only the old key could unlock will become unreadable." })]),
      el("label", { class: "enc-ack" }, [ack2, el("span", { text: "I understand this affects encrypted messages only — my account, my rooms, and my ownership are not affected — and that I should look for my existing key before continuing." })]),
      cont, back,
    ]));
  }

  // Gate B — show the new key; require both the saved-it checkbox and a correct
  // re-entry before committing. confirmMatch(typed) checks the re-entry locally;
  // onConfirm() commits. onBack is optional (omitted on first-time setup).
  function showSaveNewKey({ recoveryKey, confirmMatch, onConfirm, onBack }) {
    const keyBox = el("div", { class: "enc-key", text: recoveryKey });
    const copy = el("button", { class: "btn-secondary", text: "Copy" });
    copy.onclick = () => { try { navigator.clipboard.writeText(recoveryKey); copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", RECOVERY_COPY_REVERT_MS); } catch (e) {} };
    const saved = el("input", { type: "checkbox", class: "enc-check" });
    const reentry = el("input", { type: "text", class: "enc-input", placeholder: "Type your recovery key again to confirm" });
    const err = el("p", { class: "enc-error" });
    const cont = el("button", { class: "btn-primary", text: "Confirm & continue", disabled: true });
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
      el("h2", { text: "Save your recovery key" }),
      el("p", { class: "enc-sub", text: "This is the only way to unlock your encrypted messages on another device or after logging out. Save it in a password manager now — it won't be shown again." }),
      keyBox, copy,
      el("label", { class: "enc-ack" }, [saved, el("span", { text: "I have saved my recovery key somewhere safe." })]),
      reentry, err, cont,
    ];
    if (onBack) { const back = el("button", { class: "enc-link", text: "Back" }); back.onclick = () => onBack(); children.push(back); }
    _encMount(el("div", { class: "enc-box enc-box-wide" }, children));
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
    clear(screen);

    const rows = (opts.accounts || []).map((a) => {
      const isActive = a.userId === opts.activeUserId;
      const left = el("div", { class: "acct-id" }, [
        el("span", { class: "my-id", title: a.userId, text: a.userId }),
        isActive ? el("span", { class: "acct-badge", text: "Active" }) : null,
      ]);
      const actions = el("div", { class: "acct-actions" });
      if (!isActive) {
        const signedIn = opts.hasSession ? opts.hasSession(a.userId) : true;
        const sw = el("button", { class: "btn-secondary", text: signedIn ? "Switch" : "Sign in" });
        sw.onclick = () => { sw.disabled = true; opts.onSwitch && opts.onSwitch(a.userId); };
        const forget = el("button", { class: "enc-link enc-link-muted", text: "Forget" });
        forget.onclick = async () => {
          if (!confirm("Forget " + a.userId + " on this browser? This removes its local data and encryption keys here. Encrypted history will need the recovery key to restore if you sign in again.")) return;
          forget.disabled = true; forget.textContent = "Forgetting…";
          try { opts.onForget && await opts.onForget(a.userId); } catch (e) {}
        };
        actions.appendChild(sw); actions.appendChild(forget);
      }
      return el("div", { class: "acct-row" }, [left, actions]);
    });

    const add = el("button", { class: "btn-primary", text: "Add account" });
    add.onclick = () => opts.onAdd && opts.onAdd();
    const back = el("button", { class: "btn-secondary", text: "Back" });
    back.onclick = () => opts.onBack && opts.onBack();

    screen.appendChild(el("div", { class: "accounts-wrap" }, [
      el("div", { class: "accounts-head" }, [el("h2", { text: "Accounts" }), back]),
      el("p", { class: "enc-sub", text: "Each account keeps its own separate storage and encryption on this browser." }),
      el("div", { class: "accounts-list" }, rows.length ? rows : [el("p", { class: "muted", text: "No accounts yet." })]),
      add,
    ]));
    showScreen("screen-accounts");
  }

  return {
    showScreen, renderRoomList, setCreateRoomVisible, enterMainScreen,
    showEnterRecoveryKey, showResetWarning, showSaveNewKey, showAccounts,
    addChatMessage, startCountdown, clearCountdown, setRoomListBusy, setResumeHandler
  };
})();
