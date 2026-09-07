// ui/interface.js
// UI only. Reads from feature modules, fires user intents downward. No logic,
// no consensus, no direct Matrix or stream access — every read and write goes
// through a feature module. All DOM is built with createElement / textContent
// so no network-derived string is ever interpreted as HTML.
// Depends on: Room, Queue, Skip, Playback, UserQueue, Chat, RoomUpgrade, Store, Logger
//
// ── WHAT IS IN HERE, IN ORDER ──────────────────────────────────────────────────
// This file is long. It is grouped, and the groups are banner-marked below; search
// a section title to jump. Line numbers are deliberately not listed — they drift
// with every edit, and a stale one makes a correct change look wrong.
//
//   CONSTANTS
//   PRIMITIVES
//   MODULE STATE
//   BACKGROUND ENGINE
//   LAYOUT
//   LOGS PANEL
//   SCREENS AND ROOM LIST
//   THE MAIN SCREEN
//   RANK AND AVATAR
//   NOW PLAYING
//   RIGHT PANEL
//   USER SETTINGS PANEL
//   ROOM SETTINGS PANEL
//   THUMBNAIL PIPELINE
//   SONG ROWS AND PREVIEW
//   QUEUE PANELS
//   ROOM HISTORY
//   PLAYLISTS
//   REACTIONS
//   MISCLICK LOCKS
//   JOIN BUTTON, ROSTER, UPGRADE
//   WHO HAS DONE SOMETHING RECENTLY
//   THE EVENT FEED
//   CHAT (and THE TIER STRIP, and DELETING A MESSAGE)
//   PLAYER
//   MODALS
//   EXPORTS
//
// Two rules this file is held to, both by guards that read it as text:
//   · the UI decides no permissions — no rank comparison, no capability call. It reads
//     a descriptor from Actions and renders it. (check-ui-no-permission)
//   · a panel renderer must not paint on top of itself — the queue container is shared
//     by four panels and cleared by their dispatcher. (check-ui-render)

const Interface = (() => {

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ CONSTANTS
  //
  // The rank display table and every timing dial. Display only: authority lives in the
  // channels.
  // ────────────────────────────────────────────────────────────────────────────────────────
  // Display-only rank table (highest first). Authority lives in the channels;
  // this is just labels and the gates for which controls to show.
  // THE LEVELS ARE READ FROM THE LADDER, NOT RESTATED. Only the display strings live here.
  //
  // This was a hand-written table whose first row said `level: 100`. When the ladder's owner
  // rung moved to 99 that copy kept the old number, and the damage was not a wrong label —
  // `rankSelect` filters every option through `Room.isRankUnlocked`, which resolves the level
  // through the channel taxonomy, and `eventsKeyForLevel(100)` answers null. **The Owner option
  // disappeared from the rank picker**, which is the only surface by which a human appoints the
  // Phase 3 bot. The change that made the bot's level possible removed the control that creates
  // one, and the whole suite stayed green.
  //
  // This is the SECOND hand-written copy of the ladder found in one release — `Room.highest
  // UnlockedRank` held the first. A hand-written copy of a derived list is a second copy of the
  // RULE, and the guard that catches the first cannot reach the second. `check-rank-injection`
  // now pins both.
  //
  // `Room.rankLadder()` is the legal route: ui/ may NOT reach `Capabilities` directly (check-
  // boundaries, check-ui-no-permission). Names and colours are keyed by the ladder's own NAME, never by level, so a rung that
  // moves again carries its label with it.
  const _RANK_FACE = {
    "owner":         { name: "Owner",         color: "#E8890C" },  // legendary orange
    "high-staff":    { name: "High Staff",    color: "#7C3AED" },  // heroic purple
    "staff":         { name: "Staff",         color: "#3B82F6" },  // deep blue
    "vip":           { name: "VIP",           color: "#60A5FA" },  // blue
    "player":        { name: "Player",        color: "#4ADE80" },  // green
    "guest":         { name: "Guest",         color: "#A7C4A0" },  // greyish green
    "uncategorized": { name: "Uncategorized", color: "#9CA3AF" },  // grey
  };
  const RANKS = Room.rankLadder().map((r) => ({
    level: r.level,
    name:  (_RANK_FACE[r.name] || {}).name  || r.name,
    color: (_RANK_FACE[r.name] || {}).color || "#9CA3AF",
  }));
  // Rank thresholds are no longer compared in the UI — permission comes from the
  // capability system (Actions.describe). RANKS (below) is kept for DISPLAY only
  // (rankName / rankColor / the rank-select option labels).

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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ PRIMITIVES
  //
  // Rank labels and colours, avatars, the text-only DOM builders, countdowns, formatting.
  // ────────────────────────────────────────────────────────────────────────────────────────
  // ── THE TOP RUNG IS THE BOT SLOT, AND CALLING IT "OWNER" WAS A VISIBLE LIE ────────────────
  // REPORTED FROM A LIVE ROOM: the owner opened the rank dropdown and read *"I can make another
  // person Owner"*. Granting that option sets level 99, and `BotRuntime` accepts **exactly** 99 and
  // nothing else — so the option does not make a co-owner, it appoints the room's bot.
  //
  // The ladder SATURATES: `Ranks.nameOf` answers `owner` for both 99 and the human owner's 100,
  // which is correct for authority (both outrank everyone) and useless as a label, because the two
  // do completely different things. `ranks.js` records this saturation as the thing a reader gets
  // wrong; here it reached a person.
  //
  // SPLIT BY LEVEL, WHICH IS THE ONLY THING THAT SEPARATES THEM. Above the ladder's top rung is the
  // human owner; AT it is the bot slot. An unknown level still falls through to `L<n>` rather than
  // guessing — a label invented for a level nobody defined is how this started.
  const _BOT_LEVEL = Math.max.apply(null, RANKS.map((r) => r.level));
  function rankName(level) {
    if (typeof level === "number" && level > _BOT_LEVEL) return "Owner";
    if (level === _BOT_LEVEL) return "Bot";
    const r = RANKS.find((x) => x.level === level);
    return r ? r.name : ("L" + level);
  }
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ MODULE STATE
  //
  // Every mutable value in this file, gathered. A render reads these live, so a render is never
  // purely a function of backend state.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- module-level refs (built in enterMainScreen) ---
  let player = null, playerReady = false;
  // Preview (mini-player, 14 §7) — a LOCAL-only player takeover. While active the
  // main player pauses in place and onPlaybackStateChange stops driving it (keeps
  // tracking via _lastNp). No protocol event is ever sent from here.
  let _previewActive = false, _previewPlayer = null, _previewOverlay = null, _previewKeyHandler = null;
  let _previewColumn = null, _previewResizeHandler = null;   // the column the preview floats over + its reposition hook
  let _lastNp = null;   // latest consensus now-playing, cached so preview re-syncs to LIVE on close
  let queueTab = "room";   // "room" | "mine" | "history" | "playlists"
  let rightTab = "chat"; // "chat" | "dm" | "people" | "feed" | "roomset" | "gear"
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
  let _joinResizeWired = false;   // one-time window-resize hook for the Join/Leave text-ladder
  // Per-song commit-bar countdown anchors (videoId -> ms when it entered "pending").
  // The UserQueue settle timer is queue-wide and resets on ANY edit; keying the bar
  // to the song instead means an unrelated edit can't restart a song that didn't
  // change — only a newly-pending song starts from zero.
  let _commitAnchors = {};
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
  let _marqueeSeq = 0;     // bumped per fit → a UNIQUE @keyframes name each time, so resize never reuses a stale travel distance
  let _marqueeRaf = 0;     // pending rAF handle, so rapid resize/RO bursts coalesce to one fit
  let _chatPrefsWired = false;  // ChatPrefs load + onChange subscription happen once
  let _lastChatTier = null; // so we can clear the chat box when the main chat tier changes
  let _reflectCryptoBanner = null;   // set in buildMainDom; shows/hides the "secure chat offline" banner from Chat.cryptoReady()
  let _reflectPlaybackHold = null;   // set in buildMainDom; shows/hides the "catching up / waiting for history" banner from Playback.onHoldChange
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ BACKGROUND ENGINE
  //
  // Blob fetch to object-URL to paint, and revoke on swap. Dimming vars. Debounced on owner
  // changes, immediate on room entry.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
    renderJoinBtn();    // re-label Join/Leave for the mode (full text ↔ JQ/LQ on phone)
    if (typeof _fitAllMarquees === "function") _fitAllMarquees();   // title box widths change per mode
    if (_previewActive) _positionPreview();   // keep an open preview pinned to its column across a layout switch
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
  function _setPhonePane(pane) { if (pane === "social") { rightTab = "chat"; renderRightPanel(); } phonePane = pane; _applyLayout(); _relockAllPanels(); }
  function _setCompactSide(side) { if (side === "social") { rightTab = "chat"; renderRightPanel(); } compactSide = side; _applyLayout(); _relockAllPanels(); }

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
  // ══ LOGS PANEL
  //
  // The in-app log view. Logger output lands here, not in the browser console.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Logger → Logs tab -----------------------------------------------------
  // The bottom debug log, relocated into the Logs tab. Lines from BEFORE this
  // page load (restored from storage) render grey; lines logged in THIS session
  // render green. Persisted (capped) so "older" actually exists across reloads.
  // ── HOW MUCH OF A SESSION THE PANEL CAN ACTUALLY HOLD ────────────────────────────────────
  // 300 was set when the log was quiet. The decision trail added since — SONG, ADVANCE, ORDER,
  // LEN — is what makes a stalled room readable, and it costs lines.
  //
  // THE PRESSURE IS REPLAY, not steady play, and that part is arithmetic rather than a guess:
  // joining a room ingests its whole history and every ingest logs a line, so a room with 300
  // events fills the panel before a single song has played. Steady play is far cheaper — roughly
  // ten lines a song — so the cap is spent on JOINING, which is exactly when the interesting part
  // happens. The OLDEST lines roll off first: startup, floor adoption, and the first thing that
  // went wrong. A line is a short string, so 2000 costs little in memory or in the stored record.
  const _logCap = 2000;
  // WHAT THE PANEL SHOWS. The full log is always kept and always copied; this only filters the
  // view, so turning the noise down can never lose evidence that was already recorded.
  const _LOG_LEVELS = ["debug", "info", "warn", "error"];
  let _logLevel = "debug";                    // show everything until asked otherwise
  function _lineLevel(line) {
    const m = /^\[(debug|info|warn|error)\]/.exec(line || "");
    // An unprefixed line is treated as INFO — visible by default, hidden at warn-and-above like
    // any other info line. Stated because the first version of this comment claimed it always
    // showed, which the comparison below does not do, and a note that promises more than the code
    // delivers is the thing this tree keeps having to delete.
    return m ? m[1] : "info";
  }
  function _passesLevel(line) {
    return _LOG_LEVELS.indexOf(_lineLevel(line)) >= _LOG_LEVELS.indexOf(_logLevel);
  }
  // ── THE SECOND FILTER: WHICH MODULE IS TALKING ───────────────────────────────────────────
  // The level filter answers "how bad", and that is the wrong axis for the question people
  // actually arrive with, which is "what is the BOT doing". Every interesting bot line is `info`,
  // and so are MatrixBridge's 74 and Room's 58 — so turning the level up hides the subject along
  // with the noise, and leaving it down buries seven lines under several hundred.
  //
  // THE CATEGORY IS THE PREFIX THE TREE ALREADY WRITES, not a new field on Logger. 88% of log
  // calls open with `Module: `, including the diagnostic families — `StreamManager: ORDER …`,
  // `MatrixBridge: SEAL …`, `Playback: ADVANCE …` — so the vocabulary exists and is maintained by
  // use. A `category` argument added to `Logger.debug/info/warn/error` would be a SECOND way of
  // saying what the string already says, free to disagree with it, and it would have to be
  // threaded through every Logger call site in the tree to be complete. Derived, not declared: a module that starts
  // logging appears in the picker on its own, and one that stops disappears.
  //
  // VIEW-ONLY, exactly like the level above, and for the reason stated there: the full log is
  // always held and `_logText` always copies everything, so narrowing to one module can never
  // discard the line somebody needed. That matters more here than for the level, because the
  // reason to narrow is that you are hunting something and do not yet know what.
  const _LOG_CAT_ALL = "*";
  const _LOG_CAT_OTHER = "other";
  let _logCat = _LOG_CAT_ALL;
  // ── THE TIME, WHICH `Logger` ALREADY COMPUTED AND THIS PANEL WAS DISCARDING ───────────────
  // Every entry carries `ts: Date.now()` and the line built below used to drop it. Everything the
  // bot does is a DURATION — `botAfkMs`, `botPingMs`, `queueIdleMs`, the sweep's own minute — so a
  // log without times cannot tell one sweep from forty, cannot measure the gap between a warning
  // and the removal it authorises, and cannot tell a stalled room from a quiet one. That last
  // distinction is the one that ran unnoticed for two days here.
  //
  // AFTER THE LEVEL TAG, NOT BEFORE IT, AND THAT PLACEMENT IS LOAD-BEARING. `_lineLevel` and
  // `_lineCategory` both anchor on `^[level]`; a stamp in front of it would leave every line
  // reading as level `info` and category `other`, which is a filter that silently stops filtering
  // rather than one that breaks visibly.
  //
  // LOCAL CLOCK, and `_logText` says so once at the top rather than every line saying it. No date
  // per line: `_priorLog` can be days old, so the DATE is carried by the session banners in
  // `_logText` where it is stated once, and the per-line cost stays twelve characters.
  function _stamp(ts) {
    const d = new Date((typeof ts === "number" && isFinite(ts)) ? ts : Date.now());
    const p2 = (n) => (n < 10 ? "0" : "") + n;
    const p3 = (n) => (n < 100 ? (n < 10 ? "00" : "0") : "") + n;
    return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + "." + p3(d.getMilliseconds());
  }
  // The stored line is `[level] HH:MM:SS.mmm Module: message`, so the level tag comes off first
  // and the stamp second. BOTH STRIPS ARE OPTIONAL-MATCHING, because `_priorLog` is restored from
  // storage and lines written before the stamp existed carry none — a required strip would send
  // every one of them to `other` on the first load after an upgrade, which reads as the previous
  // session having no modules in it.
  function _lineCategory(line) {
    const t = String(line == null ? "" : line)
      .replace(/^\[(?:debug|info|warn|error)\]\s*/, "")
      .replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+/, "");
    const m = /^([A-Za-z][A-Za-z0-9_]*):/.exec(t);
    return m ? m[1] : _LOG_CAT_OTHER;
  }
  function _passesCategory(line) {
    return _logCat === _LOG_CAT_ALL || _lineCategory(line) === _logCat;
  }
  // The categories PRESENT in the log, sorted. Derived on demand rather than accumulated, so a
  // category cannot outlive the lines that produced it — the picker describes the log in the box,
  // never a list of what some module might one day say.
  function _logCategories(lines) {
    const seen = Object.create(null);
    for (const l of lines) seen[_lineCategory(l)] = true;
    return Object.keys(seen).sort();
  }
  let _priorLog = [];
  let _sessionLog = [];
  // Captured at load rather than at the first log line: a room that boots quietly would otherwise
  // date its session from whenever something first went wrong.
  const _sessionStart = Date.now();
  // ── THE COPY-OUT, WITH THE ONE THING THE SCREEN SHOWS AND THE CLIPBOARD LOST ──────────────
  // The panel renders prior-session lines grey and this session's green, and the copied text had
  // NO equivalent — the two runs ran straight together. So a reader of a pasted log could take a
  // stale `bot mode on` from yesterday as the current run, with nothing on the page to correct
  // them. That is a plausible value at document scale, and the copy is the form the log is
  // actually read in, because nobody diagnoses by scrolling somebody else's screen.
  //
  // THE BANNERS ARE BUILT HERE AND NOWHERE ELSE. They must never be pushed into `_priorLog` or
  // `_sessionLog`: those two arrays are what `_saveLogSoon` persists, so a banner placed in them
  // would be restored as an ordinary line next session, banner-ed again by the session after
  // that, and accumulate one marker per reload forever.
  //
  // Unfiltered, as before — a report carries what happened rather than what the reader was
  // looking at when they pressed the button.
  function _logFullStamp(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }
  function _logText() {
    const out = [];
    out.push("=== DDJP log — copied " + _logFullStamp(Date.now()) +
             " — line times are this device's LOCAL clock ===");
    if (_priorLog.length) {
      out.push("=== " + _priorLog.length + " line(s) below are from an EARLIER SESSION, not from " +
               "the run that follows ===");
      for (const l of _priorLog) out.push(l);
    }
    out.push("=== " + _sessionLog.length + " line(s) below are THIS session, which began " +
             _logFullStamp(_sessionStart) + " ===");
    for (const l of _sessionLog) out.push(l);
    return out.join("\n");
  }
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
    // Filtered from the VIEW only; still held and copied. BOTH filters are asked here rather than
    // one here and one in renderLogs, so a live line and a re-rendered one can never disagree
    // about whether it is shown.
    if (!_passesLevel(text) || !_passesCategory(text)) return;
    // STICK TO THE BOTTOM ONLY IF ALREADY THERE. Appending used to force a scroll on every line,
    // so reading anything older than the last screenful was impossible in a busy room — the log
    // yanked itself away mid-read. Within a few pixels counts as "at the bottom".
    const box = refs.logsBox;
    const atBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 24;
    box.appendChild(el("div", { class: "log-line " + (fresh ? "fresh" : "old") + " lvl-" + _lineLevel(text), text: text }));
    while (box.childNodes.length > _logCap) box.removeChild(box.firstChild);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  // The picker's options are rebuilt here rather than on every arriving line, because rebuilding a
  // select per log message is the shape `_updateLogCount` already had to be rescued from. This
  // runs when a human is looking — the tab opens, or a filter changes — so a module that has only
  // just started logging appears the next time either happens.
  function _syncLogCatOptions() {
    const sel = refs.logsCat;
    if (!sel) return;
    const cats = _logCategories(_priorLog.concat(_sessionLog));
    // A selection naming a category the log no longer holds falls back to ALL. Leaving it selected
    // would render an empty panel, which is indistinguishable from a broken one — and the count
    // beside it would read `0 of 1400 lines`, which reads as a fault rather than as a filter.
    if (_logCat !== _LOG_CAT_ALL && cats.indexOf(_logCat) < 0) _logCat = _LOG_CAT_ALL;
    clear(sel);
    const all = el("option", { value: _LOG_CAT_ALL, text: "all modules" });
    all.value = _LOG_CAT_ALL;
    sel.appendChild(all);
    for (const c of cats) {
      const o = el("option", { value: c, text: c });
      o.value = c;
      sel.appendChild(o);
    }
    sel.value = _logCat;
  }
  function renderLogs() {
    if (!refs.logsBox) return;
    _syncLogCatOptions();
    clear(refs.logsBox);
    for (const line of _priorLog) _appendLogRow(line, false);
    for (const line of _sessionLog) _appendLogRow(line, true);
    _updateLogCount();
  }
  Logger.on(entry => {
    const line = "[" + entry.level + "] " + _stamp(entry.ts) + " " + entry.message;
    _sessionLog.push(line);
    if (_sessionLog.length > _logCap) _sessionLog.shift();
    _saveLogSoon();
    _appendLogRow(line, true);
    _updateLogCount();
  });

  // ── THE COUNTER IS UPDATED, NOT RE-RENDERED ────────────────────────────────────────────────
  // The first version of this called renderLogs() on every incoming line to keep the count
  // honest, which clears the container and rebuilds every row — up to two thousand DOM nodes per
  // log message, in the panel whose whole purpose is being readable while a room is busy. The
  // count is two numbers; only the two numbers need to change.
  function _updateLogCount() {
    if (!refs.logsCount) return;
    const shown = refs.logsBox ? refs.logsBox.childNodes.length : 0;
    const total = _priorLog.length + _sessionLog.length;
    refs.logsCount.textContent = (shown === total) ? (total + " lines")
                                                   : (shown + " of " + total + " lines");
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ SCREENS AND ROOM LIST
  //
  // showScreen, the room list, entering a room.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
  // "display names only" rule used by the main header (docs/main/02-architecture.md /
  // docs/main/07-security.md): it is always the viewer's own id, never another user's. Reads
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
    // ── THE SAVES SECTION IS NO LONGER ON THE SELECTOR (v273) ─────────────────────────────
    // It described "the room you last opened" — a permanent list on a screen whose whole subject
    // is a CHOICE between rooms, so it was always about a room other than the one being looked at.
    // It renders inside the room now, from `renderSettings`, where its heading is true.
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
      const b = el("button", { class: "btn-secondary room-open-btn", text: "Open",
        title: "Open this room" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        _savesWanted = null;
        openRoom(room);
      };
      return b;
    }
    function savesButton(room) {
      const b = el("button", { class: "btn-secondary room-saves-btn", text: "Saves",
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
      const row = el("div", { class: "room-item room-with-saves" });
      const btn = el("button", { class: "room-item-main" }, [room.name || room.spaceId]);
      btn.appendChild(el("span", { class: "room-badge-owner", text: "owner" }));
      btn.onclick = () => openRoom(room);
      row.appendChild(btn);
      row.appendChild(openButton(room));
      row.appendChild(savesButton(room));
      return row;
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
    const a = el("a", { href: url, download: filename });
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
      box = refs.settingsExport = el("div", { class: "export-section" });
      refs.settingsBox.appendChild(box);
    }
    clear(box);   // CLEARS ITSELF, so it is safe from every call site rather than trusting each one
    const info = (Room.heldCheckpoints && Room.heldCheckpoints()) || { room: null, held: [] };
    const held = info.held || [];
    // ── NOTHING HELD IS NOT AN ERROR, AND IT IS NO LONGER SILENT ───────────────────────────
    // It used to `display: none`, which is why a browser run reported "no save control exists":
    // the section is hidden until a room has been opened once, and the owner never saw it. An
    // empty section that SAYS it is empty is reachable; a hidden one is indistinguishable from an
    // absent feature — and it was, for as long as anybody looked.
    box.style.display = "flex";
    if (!held.length) {
      box.appendChild(el("h3", { class: "room-section-title", text: "Saves" }));
      box.appendChild(el("p", { class: "muted", text: _savesWanted
        ? "That room has no saved checkpoints yet."
        : "Open a room to see the saves it holds. This client keeps them for one room at a time." }));
      return;
    }

    box.appendChild(el("h3", { class: "room-section-title", text: "Saves" }));
    // ── THE LABEL IS TRUE OF WHAT IT LISTS, WHICH IS THE WHOLE CONSTRAINT ───────────────────
    // `heldCheckpoints()` returns the room the list is OF, and it is the only place that answer
    // exists — so the heading names it rather than saying "the room you last opened", which is
    // true and tells a reader nothing about whether it is the room they just clicked.
    box.appendChild(el("p", { class: "muted", text: info.room
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
    const note = el("p", { class: "muted" });

    for (const [rank, list] of groups) {
      box.appendChild(el("h4", { class: "room-section-title", text: rank }));
      // Newest cut first, by POSITION — the same key the chain fold uses, never the author's own
      // seal counter, which is incomparable across authors.
      list.slice().sort((a, b) => (b.floorL || 0) - (a.floorL || 0)).forEach((cp) => {
        const row = el("div", { class: "room-item room-invite-row" });
        row.appendChild(el("span", { class: "room-invite-name",
          text: _fmtStamp(cp.at) + (cp.thin ? " · thin" : "") }));
        const btn = el("button", { class: "btn-secondary room-accept-btn", text: "Save" });
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
    // renderActivePanel joins these because the activity list is folded from the LOG, so it is
    // stale the moment anything enters it — and Queue.onStateChange is the re-derive announcement,
    // which is the one signal that fires for every event that reached the fold.
    // renderFeedPanel (J13) joins for exactly the same reason and through the same signal: it is
    // folded from the same log, so anything that re-derives the room has already changed it.
    Queue.onStateChange(() => { renderNowPlaying(); _syncNpButtons(); renderQueuePanel(); renderRoster(); renderActivePanel(); renderFeedPanel(); renderJoinBtn(); });
    Playback.onStateChange(onPlaybackStateChange);
    // A deliberate hold must not look like a hang. Playback emits only on TRANSITIONS, so this
    // is not a poll — the advance path retries every tick and would otherwise fire constantly.
    Playback.onHoldChange((reason) => { if (_reflectPlaybackHold) _reflectPlaybackHold(reason); });
    Chat.onMessage(addChatMessage);
    Chat.onRedaction(removeChatMessage);
    _wireDMPanel();   // J15 — the DM panel's own message + index listeners
    renderDMPanel();  // paint the (usually empty) list and the badge on entry
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
    Room.onRankChange(() => { renderMyRank(); renderRoster(); renderActivePanel(); renderFeedPanel(); renderQueuePanel(); renderUpgradePanel(); renderSettings(); });
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
    if (RoomUpgrade.onStatusChange) RoomUpgrade.onStatusChange(() => renderUpgradePanel());
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
          _repaintChat(refs.chatBox);
        }
        _renderChatTierStrip();
      }
      _bgOnSetting(_bg.roomId, (s && s.bg) || null);   // react to a background link change (debounced)
      renderSettings();
    });

    renderMyRank();
    renderNowPlaying();
    renderQueuePanel();
    renderRoster();
    renderActivePanel();
    renderFeedPanel();
    // J12 — seed the visible tier from the resolver before the strip is drawn, so the box knows
    // which buffer it is showing from the first paint rather than from the first message.
    try { if (refs.chatBox) refs.chatBox._chatTier = Room.chatTiers().activeTier; } catch (e) {}
    _renderChatTierStrip();
    renderUpgradePanel();
    renderSettings();
    renderLogs();
    if (!_chatPrefsWired) {
      ChatPrefs.load();
      // Restore the remembered layout choice now that prefs are loaded (per user,
      // device-local). Falls back to "wide" if none saved.
      try { _setLayout(ChatPrefs.layout()); } catch (e) {}
      // A pref change re-renders the mounted chat (text <-> image/link) and the
      // settings panel itself (checkboxes / chips reflect the persisted state).
      // The bg toggle also lives in ChatPrefs, so re-apply the background here:
      // flipping "Room backgrounds" off unpaints immediately; on re-evaluates the
      // current room setting (may download).
      ChatPrefs.onChange(() => { _repaintChat(refs.chatBox); _renderChatTierStrip(); renderChatSettings(); renderSettings(); _bgApplyToggle(); _applyDisplayDims(); });
      _chatPrefsWired = true;
    }
    // ── LAND ON THE SAVES, IF THAT IS WHERE THE PERSON WAS GOING ──────────────────────────
    // `Saves` on the selector carries a DESTINATION, and this is the only place it can be honoured:
    // the saves section is built by `renderSettings`, which has just run. Cleared as it is read, so
    // a later ordinary open does not jump somewhere nobody asked for.
    if (_savesWanted) {
      _savesWanted = null;
      try {
        rightTab = "roomset";
        _relockAllPanels();
        renderRightPanel();
        if (refs.settingsExport && refs.settingsExport.scrollIntoView) {
          refs.settingsExport.scrollIntoView({ block: "start" });
        }
      } catch (e) { Logger.warn("UI: could not land on the saves section — " + (e && e.message)); }
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
    backBtn.onclick = () => { _bgLeaveRoom(); showScreen("screen-rooms"); renderRoomList(Room.scanDDJPRooms()); };
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
    refs.grabIco = el("span", { class: "np-ico", text: "\u2606" });
    refs.grabCount = el("span", { class: "np-count", text: "0" });
    refs.grabBtn = el("button", { class: "mini ico grab np-react", title: "Save this song" },
      [refs.grabIco, refs.grabCount]);
    refs.grabBtn.onclick = _onStarPress;
    refs.upvoteCount = el("span", { class: "np-count", text: "0" });
    refs.upvoteBtn = el("button", { class: "mini ico upvote np-react", title: "Upvote this song" },
      [el("span", { class: "np-ico", text: "\u25B2" }), refs.upvoteCount]);
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
    refs.tabRoom.onclick = () => { queueTab = "room"; _resetStackScroll(); _resetQueueLocks(); renderQueuePanel(); };
    refs.tabMine.onclick = () => { queueTab = "mine"; _resetStackScroll(); _resetQueueLocks(); renderQueuePanel(); };
    refs.tabHistory.onclick = () => { queueTab = "history"; _resetStackScroll(); _resetQueueLocks(); renderQueuePanel(); };
    refs.tabPlaylists.onclick = () => { queueTab = "playlists"; _plView = "list"; _resetStackScroll(); _resetQueueLocks(); renderQueuePanel(); };
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
    refs.tabChat.onclick = () => { rightTab = "chat"; _relockAllPanels(); renderRightPanel(); };
    refs.tabDM.onclick = () => {
      rightTab = "dm";
      // OPENING THE INBOX SHOWS THE INBOX. A tab that resumes the last conversation is right for
      // a room and wrong here: the reason to open DMs is almost always to see what has arrived,
      // and landing inside one conversation hides every other one behind a back button.
      _dmResetToList();
      _relockAllPanels(); renderDMPanel(); renderRightPanel();
    };
    refs.tabPeople.onclick = () => { rightTab = "people"; _relockAllPanels(); renderRightPanel(); };
    refs.tabFeed.onclick = () => { rightTab = "feed"; _relockAllPanels(); renderFeedPanel(); renderRightPanel(); };
    refs.tabRoomset.onclick = () => { rightTab = "roomset"; _relockAllPanels(); renderRightPanel(); };
    refs.tabGear.onclick = () => { rightTab = "gear"; _relockAllPanels(); _renderGear(); renderRightPanel(); };

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
    for (const lv of _LOG_LEVELS) {
      const o = el("option", { value: lv, text: lv === "debug" ? "everything" : lv + " and above" });
      o.value = lv;
      levelSel.appendChild(o);
    }
    levelSel.value = _logLevel;
    levelSel.onchange = () => { _logLevel = levelSel.value; renderLogs(); };
    // ── THE MODULE PICKER, WHICH BORROWS `logs-level` RATHER THAN DECLARING A RULE ───────────
    // Same control doing the same job one axis over, so it takes the same class. A `.logs-cat`
    // rule copying those declarations would render identically today and drift the next time
    // either is touched — the `.dm-sender` / `.sender` failure `check-visual-reuse` exists for.
    // Its options are filled by `_syncLogCatOptions` on every render; empty until then, which is
    // why the picker is built here and populated there rather than seeded with a guess.
    refs.logsCat = el("select", { class: "logs-level", title: "Show only one module's lines (the view only — copying always takes everything)" });
    refs.logsCat.onchange = () => { _logCat = refs.logsCat.value; renderLogs(); };
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
      copyButton("Copy log", () => _logText(), "copy-btn logs-copy", "Copy the WHOLE log — every level, both sessions — to the clipboard"),
    ]);
    refs.logs = el("div", { class: "logs" }, [refs.logsBar, refs.logsBox]);

    // Settings sub-panel (chat image/link display prefs).
    refs.chatSettingsBox = el("div", { class: "chat-settings-box" });
    refs.chatSettings = el("div", { class: "chat-settings" }, [refs.chatSettingsBox]);

    // The gear panel nests a Logs / Settings sub-tab bar over the two sub-panels.
    refs.subtabLogs = el("button", { class: "subtab", text: "Logs" });
    refs.subtabSettings = el("button", { class: "subtab", text: "Settings" });
    refs.subtabLogs.onclick = () => { gearTab = "logs"; renderLogs(); _renderGear(); };
    refs.subtabSettings.onclick = () => { gearTab = "settings"; _prefsLocked = true; renderChatSettings(); _renderGear(); };
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
        _marqueeRo = new ResizeObserver(() => _fitMarquee());
        _marqueeRo.observe(refs.videoTitle);
      }
      // The room title is in the HEADER, which reflows for its own reasons (the fit ladder, the
      // rank badge appearing) that never touch the video title's box — so it needs its own
      // observer rather than sharing one.
      if (refs.roomTitle) {
        _roomTitleRo = new ResizeObserver(() => _fitMarquee(refs.roomTitle, refs.roomTitleText));
        _roomTitleRo.observe(refs.roomTitle);
      }
    } else {
      window.addEventListener("resize", _fitHeader);
      window.addEventListener("resize", _fitAllMarquees);
    }
    _fitHeader();
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ RANK AND AVATAR
  //
  // Own rank display and avatar upload.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- My rank + own avatar (live) ---
  function renderMyRank() {
    const myId = Room.getMyId() || "";
    _headerFit.fullId = myId;                       // remember the full @user:server for the shrinker
    if (refs.myIdBadge) refs.myIdBadge.textContent = myId;
    if (refs.rankBadge) {
      // ── THE HEADER NAMES WHO I AM, SO IT ASKS THE AUTHORITY LEVEL ────────────────────────
      // `Room.getMyRank()` answers the highest events CHANNEL I can write to, which caps at the
      // ladder's top rung — so a human owner at Matrix level 100 answers 99 from it, exactly as the
      // bot does. With the top rung correctly labelled `Bot`, that made the header call the HUMAN
      // OWNER "Bot", and made the two accounts indistinguishable in the one place a person looks to
      // see who they are signed in as.
      //
      // THIRD PLACE THIS CONFUSION HAS SURFACED — after the upgrade gate and the rank dropdown. The
      // rule that covers all three: a reading that must separate the owner from the bot asks
      // `getMyAuthorityLevel`; a reading about what I may AUTHOR asks `getMyRank`. This is the
      // first kind.
      _headerFit.fullRank = rankName(
        (Room.getMyAuthorityLevel ? Room.getMyAuthorityLevel() : Room.getMyRank()));
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ NOW PLAYING
  //
  // The label and the skip-enabled state.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
    // Skip enablement tracks CONSENSUS now-playing (via the capability system), not the local wall-clock
    // "ended" estimate — a song that's still the current play-instance stays
    // skippable even if this client guessed it was over.
    if (refs.skipBtn) refs.skipBtn.disabled = !Actions.describe("dj.skip").enabled;
    if ((np && np.pi && np.pi === _endedPi) || !np || !np.song) {
      // Nothing playing right now: either the derived state has no real song, or the current
      // instance genuinely finished on this client's player (_endedPi, from the real iframe
      // ENDED — never from the wall-clock estimate, which trips while a song is still audible).
      // In both cases show "Nothing playing" and don't present a song to replay — Playback's
      // tick advances the rotation (or it stays empty if idle).
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
      // Server-time so the coarse clock agrees across devices (both ends server-time).
      // Falls back to the local clock until ServerClock has an offset — never worse.
      const nowMs = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : Date.now();
      const elapsed = Math.max(0, Math.floor((nowMs - np.startedAt) / 1000));
      mid = " · " + fmt(elapsed);
    }
    _setNpLabel(np.dj, mid);
    if (!_currentSong || _currentSong.videoId !== np.song.videoId) {
      _currentSong = { videoId: np.song.videoId, dj: np.dj, startedAt: np.startedAt };
      updateVideoTitle();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ RIGHT PANEL
  //
  // The tab strip: chat, DMs, people, the event feed, room settings, gear.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // QUEUE PANEL
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // RIGHT PANEL — People / Chat toggle (one visible at a time)
  // ---------------------------------------------------------------------------
  function renderRightPanel() {
    const t = rightTab;
    if (refs.tabChat) refs.tabChat.classList.toggle("active", t === "chat");
    if (refs.tabDM) refs.tabDM.classList.toggle("active", t === "dm");
    if (refs.tabPeople) refs.tabPeople.classList.toggle("active", t === "people");
    if (refs.tabFeed) refs.tabFeed.classList.toggle("active", t === "feed");
    if (refs.tabRoomset) refs.tabRoomset.classList.toggle("active", t === "roomset");
    if (refs.tabGear) refs.tabGear.classList.toggle("active", t === "gear");
    if (refs.chat) refs.chat.style.display = t === "chat" ? "flex" : "none";
    if (refs.dm) refs.dm.style.display = t === "dm" ? "flex" : "none";
    if (refs.roster) refs.roster.style.display = t === "people" ? "flex" : "none";
    if (refs.feed) refs.feed.style.display = t === "feed" ? "flex" : "none";
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
  // Disable every interactive control under `root` (used to enforce the prefs
  // master lock). View-only: it only flips `.disabled`, never rebuilds the DOM.
  function _disableAllControls(root) {
    if (!root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll("input, button, select, textarea");
    for (const n of nodes) n.disabled = true;
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ USER SETTINGS PANEL
  //
  // Per-user device config: chat display toggles, the host allowlist, the two dim sliders.
  // Never touches the backend.
  // ────────────────────────────────────────────────────────────────────────────────────────

  function renderChatSettings() {
    const boxEl = refs.chatSettingsBox;
    if (!boxEl) return;
    clear(boxEl);

    // Master lock — mirrors the Room-tab settings lock (same .settings-lock button).
    // These are per-user display prefs, so the lock just guards against accidental
    // changes: locked by default, re-locked on entry to this sub-tab, no timed relock.
    const lockBtn = el("button", {
      class: "settings-lock" + (_prefsLocked ? " locked" : ""),
      text: _prefsLocked ? "\uD83D\uDD12 Unlock settings" : "\uD83D\uDD13 Lock settings",
      title: _prefsLocked ? "Settings are locked — click to unlock" : "Settings unlocked — click to lock"
    });
    lockBtn.onclick = () => { _prefsLocked = !_prefsLocked; renderChatSettings(); };
    boxEl.appendChild(lockBtn);

    // Everything below lives in one wrapper so a single pass can disable it all
    // while locked (the lock button itself stays enabled, outside the wrapper).
    const wrap = el("div", { class: "prefs-body" + (_prefsLocked ? " prefs-locked" : "") });
    // Images: ONE shared provider list, TWO independent toggles — inline chat
    // images and room backgrounds. The list greys only when BOTH are off; with
    // either on it stays active (it's feeding a live consumer). Removing a host
    // drops it from both at once (the merged-providers design).
    wrap.appendChild(_prefSection({
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
    wrap.appendChild(_prefSection({
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
    wrap.appendChild(_dimSection());
    // ONLY THE BOT SEES THIS, and only while it is actually running as the bot. It is not a
    // permission — anybody may flip a device-local display pref — it is that the row is
    // meaningless to a client that is not the bot, and a control that does nothing is the
    // "button that did nothing" defect this tree has already shipped once.
    const botRow = _botViewSection();
    if (botRow) wrap.appendChild(botRow);
    boxEl.appendChild(wrap);

    // When locked, every control below the lock button is inert (mirrors the
    // Room-tab lock, which disables each settings control while locked).
    if (_prefsLocked) _disableAllControls(wrap);
  }

  // The bot's view toggle. Returns null for every client that is not currently the room's bot, so
  // the section simply does not exist rather than appearing greyed out for everybody else.
  function _botViewSection() {
    let isBot = false;
    try { isBot = !!(typeof BotRuntime !== "undefined" && BotRuntime.actingAsBot && BotRuntime.actingAsBot()); }
    catch (e) { isBot = false; }
    if (!isBot) return null;
    let on = false;
    try { on = ChatPrefs.botView() === true; } catch (e) { on = false; }

    const wrap = el("div", { class: "set-row" });
    wrap.appendChild(el("div", { class: "set-label", text: "This account is the room's bot" }));
    wrap.appendChild(el("div", { class: "muted", text: on
      ? "Watching the video, and reporting song lengths like anyone else."
      : "Not loading the video. Everything else works as normal — this account still moderates, "
        + "sweeps for idle DJs and reads the room. It will not report song lengths or say it "
        + "cannot see the video, because not watching is deliberate." }));
    const btn = el("button", { class: "set-opt" + (on ? " active" : ""),
      text: on ? "Stop watching videos" : "Watch videos on this device" });
    btn.onclick = () => {
      try { ChatPrefs.setBotView(!on); } catch (e) {}
      renderChatSettings();
    };
    wrap.appendChild(el("div", { class: "set-opts" }, [btn]));
    return wrap;
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
  // ── THE DEVICE-LOCAL ACTIVITY WINDOW IS GONE (v272) ──────────────────────────────────────
  // `_activityWindowSection` offered "How far back the People tab counts someone as active. This
  // device only — nobody else sees it and nothing in the room depends on it." The second half of
  // that sentence stopped being true the moment a bot could act on `botAfkMs`: the People panel is
  // the surface showing the basis for the bot REMOVING somebody, so a wider local window makes the
  // panel say a person is present while the bot is about to remove them.
  //
  // REMOVED RATHER THAN NARROWED. A knob narrowed until it cannot disagree is a control that does
  // nothing, which this tree files as a visible lie; and a knob that CAN disagree is the collision
  // itself. The window is `botAfkMs` and lives in the room settings panel, where an owner changes
  // it for everyone — including for the bot that acts on it.


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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ ROOM SETTINGS PANEL
  //
  // Owner-written room dials. Bounds come from the reducer through the feature seam, so the
  // panel cannot offer a value the reducer will refuse.
  // ────────────────────────────────────────────────────────────────────────────────────────

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

  // ── WHO MAY CHANGE WHICH SETTING, AND HOW IT GETS WRITTEN (J17's missing half) ─────────────
  // The room's `botDelegation` table maps a settings KEY to the weakest rank allowed to REQUEST
  // it. `BotSettings.decide` has always enforced that and `BotSettings.request` has always been
  // able to send one — but NOTHING CALLED IT. The table was configurable and unreachable: an
  // owner could delegate `maxLen` to staff and no staff member had any control that asked.
  //
  // THE PANEL IS REUSED RATHER THAN DUPLICATED. Every row already knows its key, its label, its
  // bounds and its wording; a second delegated-settings panel would be a second copy of all of it,
  // free to drift. So the rows stay exactly as they are and only two things change: WHETHER a row
  // is editable becomes a per-key question, and the WRITE routes to the bot when the person is
  // not the owner.
  //
  // "write"   — I am the owner: `Room.setSettings`, straight to the blob, as before.
  // "request" — I am not, but this key is delegated to a rank I hold: `ddjp.bot.request`, which
  //             the bot re-checks against the same table before authoring anything.
  // null      — neither. The row renders inert, exactly as it does today.
  //
  // THE REQUEST IS NOT A WRITE AND MUST NOT LOOK LIKE ONE. The bot may be offline, may refuse, or
  // may not exist; `_settingSentNote` says so rather than showing the optimistic "Updating…" a
  // direct write earns.
  // THE RULE IS ASKED, NEVER RESTATED — AND TWO GUARDS INSISTED. A first version compared the
  // table and the rank here with `Capabilities.atLeast`; `check-boundaries` rule D and
  // `check-ui-no-permission` both refused it, and they were right twice over. The UI must not
  // decide permission, and this particular decision already HAS an owner: `BotSettings.decide` is
  // the function the BOT runs on an arriving request. Asking it means the panel and the bot cannot
  // disagree about who may change what — the panel offers exactly what the bot would honour,
  // because it is the same function answering.
  //
  // THE VALUE PASSED IS THE CURRENT ONE, and `decide` deliberately does not validate values —
  // `applySettingsEvent` re-validates everything and is TOTAL. So this asks purely "may this
  // person request this key", which is the question.
  function _maySetSetting(key) {
    try {
      if (Actions.describe("room.settings").enabled) return "write";
    } catch (e) { /* not the owner, or unreadable — fall through to the delegated path */ }
    try {
      const s = Room.getSettings() || {};
      const myLevel = Room.getMyAuthorityLevel();
      const d = BotSettings.decide({ k: key, v: s[key] }, myLevel, s);
      return (d && d.ok) ? "request" : null;
    } catch (e) { return null; }
  }

  // Route one settings change. `partial` is the same one-key object every row already builds, so
  // no row needs to know which path it took.
  function _commitSetting(key, partial) {
    const how = _maySetSetting(key);
    if (how === "write") return Room.setSettings(partial);
    if (how !== "request") return null;   // inert rows should never reach here
    let cur = null;
    try { cur = Room.getCurrent(); } catch (e) { cur = null; }
    let myLevel = null;
    try { myLevel = Room.getMyAuthorityLevel(); } catch (e) { myLevel = null; }
    if (!cur || !cur.channels || myLevel === null) { _settingSentNote(key, false); return null; }
    return Promise.resolve(BotSettings.request(cur.channels, myLevel, key, partial[key]))
      .then((r) => { _settingSentNote(key, !!(r && r.ok)); return r; })
      .catch(() => { _settingSentNote(key, false); return null; });
  }

  // A REQUEST IS AN ASK, AND THE WORDING SAYS SO. A direct write shows "Updating…" because it
  // either lands or errors; a request travels to another account that may be offline, may refuse
  // on rank, or may not exist. Telling somebody their change is saved when it has only been
  // posted is the same class as the AFK sweep counting an undelivered warning as delivered.
  function _settingSentNote(key, sent) {
    _setLocks[key] = false;
    const box = refs.settingsBox;
    if (!box) return;
    const note = el("div", { class: "set-hint", text: sent
      ? "Asked the room's bot to change this. It applies only if the bot is running and the room "
        + "still delegates this setting to your rank."
      : "That request could not be sent." });
    box.appendChild(note);
  }

  function renderSettings() {
    if (!refs.settingsBox) return;
    clear(refs.settingsBox);
    // The saves section is a child of this box, so clearing the box destroys it — the ref must go
    // with it or the next render appends into a node no longer in the document.
    refs.settingsExport = null;
    const s = Room.getSettings();
    const settingsDesc = Actions.describe("room.settings");
    const isOwner = settingsDesc.enabled;
    // Master lock: the owner must explicitly unlock before any room setting can change.
    // Locked by default and re-locked on every entry to the Room tab (see the tab handler);
    // NO timed auto-relock — it stays as the owner leaves it until they lock or leave the tab.
    // EDITABILITY IS PER-KEY NOW, NOT ONE BOOLEAN. The owner may change everything; a delegated
    // person may change exactly the keys the room's `botDelegation` table grants their rank, and
    // nothing else. `_editableFor` answers that per row, and the master lock still applies to both
    // — a delegated person can fat-finger a dial as easily as an owner can.
    //
    // THE SINGLE `editable` BOOLEAN IS GONE, not merely unused. Every row now asks per key, and
    // leaving the old name in scope would be a second answer to the same question — free to
    // disagree the moment somebody reaches for the shorter one. The two rows that are genuinely
    // owner-only (`botDelegation`, restore-from-file) say so at their call site instead.
    const _editableFor = (key) => _maySetSetting(key) !== null && !_settingsLocked;

    refs.settingsBox.appendChild(el("div", { class: "uq-section", text: "Room settings" }));
    // THE DESCRIPTOR'S OWN REASON, NOT A SENTENCE WRITTEN HERE. "Only the owner can change these"
    // is FALSE on the bot's screen — the bot IS at owner rank, and the reason it may not edit them
    // is that it changes settings only when asked. A hardcoded sentence that contradicts the
    // account reading it is the same defect class as the rank named "Owner" that appoints a bot
    // and the header that called the human owner "Bot": both were wrong words on a correct
    // mechanism, and both reached the owner because nothing reads rendered text.
    if (!isOwner) {
      refs.settingsBox.appendChild(el("p", { class: "muted",
        text: settingsDesc.reason || "Only the owner can change these." }));
    }

    // ── THE LOCK IS FOR ANYONE WHO CAN CHANGE SOMETHING, NOT JUST THE OWNER ──────────────────
    // `_settingsLocked` starts TRUE and every editable row is gated on it. Rendering the unlock
    // button `if (isOwner)` was correct while the owner was the only person who could change
    // anything — and became a DEAD END the moment delegation shipped: a staff member granted
    // `maxLen` saw the row, could not unlock, and had no way to reach it. The feature was
    // reachable in every layer except the one a person touches.
    //
    // ANYONE WITH AT LEAST ONE CHANGEABLE ROW GETS THE LOCK, which is the same rule the rows
    // themselves use rather than a second one: if `_editableFor` can ever answer true for this
    // person, the lock is theirs to open. Somebody with nothing delegated gets no button, because
    // unlocking would reveal nothing.
    const canChangeSomething = Object.keys(s).some((k) => _maySetSetting(k) !== null)
      || _maySetSetting("chat") !== null;
    if (canChangeSomething) {
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
        const clickable = _editableFor(key) && !active && !locked;
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
      [["uncategorized", "Uncategorized"], ["guest", "Guest"], ["staff", "Staff"]],
      (v) => _commitSetting("chat", { chat: v }));
    optionRow("vis", "Visibility", s.vis,
      [["private", "Private — invite only"], ["public", "Public — anyone can join"]],
      (v) => _commitSetting("vis", { vis: v }));
    _renderMinDjRankRow(s, _editableFor("minDjRank"));

    _renderBgSettingRow(s, isOwner, _editableFor("bg"));
    _renderNumberSettingRow("maxLen", "Max song length (sec)", s.maxLen, 10, 86400, _editableFor("maxLen"), "Songs auto-advance past this (10-min default keeps the room from freezing on unplayable songs).");
    _renderNumberSettingRow("minLen", "Grace period (sec)", s.minLen, 0, 600, _editableFor("minLen"), "Nothing auto-acts in the first few seconds of a song.");
    // -- WHEN A SONG MOVES ON (advance safety) ---------------------------------------------
    _renderSettingNote("When a song moves on",
      "These decide how the room agrees a song has ended, so nobody can cut a song short and everyone lands on the same next song.");
    _renderNumberSettingRow("minGate", "Shortest time before the next song (sec)", s.minGate, 0, 60000, _editableFor("minGate"),
      "Even a very short song waits at least this long before moving on, so everyone has time to react in order. Longer is safer but adds a little silence on short songs.", 1000);
    _renderNumberSettingRow("graceMs", "Allowance for length disagreement (sec)", s.graceMs, 0, 10000, _editableFor("graceMs"),
      "A small cushion for when people measured a song's length slightly differently. Bigger allows more disagreement; smaller is stricter.", 1000);
    _renderNumberSettingRow("presendMs", "Pause before you post the next song (ms)", s.presendMs, 0, 5000, _editableFor("presendMs"),
      "A tiny wait before your own device posts the next song, so it notices if someone already did. Keep it small.");
    _renderSkipRoadsSetting("skipRoads", "When to skip a song too many can't see", s.skipRoads, _editableFor("skipRoads"),
      "The room skips a song the moment ANY of these is true. Counts are different people who report being blocked. Uncategorized people are never counted, so a crowd of them can't force a skip.");
    // ── BACKUPS & SUMMARIES (advanced) ────────────────────────────────────────────────────
    // Written for a room owner, not an engineer: no protocol vocabulary, each row says what it
    // does, which way to move it, and (where one exists) the trap.
    _renderSettingNote("Backups & summaries",
      "Everyone here keeps small backups of what happens, so that if something is deleted the room can rebuild it by itself. These settings decide who keeps backups, how many are enough, and how often the room saves a summary so old history can be cleared. They only change who does what and when — they can never change what actually happened. What they do change is how quickly the room lets go of old history, so the summary settings below are worth a slower read than the rest.");

    _renderTableSetting("How many people must back up an event", "vouchTable", s.vouchTable, _editableFor("vouchTable"), true,
      "For each rank: how many different people at that rank or higher need a backup before an event counts as safe. Nobody backs up their own events, so a rank needs one more person present than its number to cover its own. The strongest rank that reaches its number settles it; ranks above that keep backing up anyway. Leave blank if that rank should never be enough on its own, and tick 'always helps' so they still pitch in when nobody stronger is covering. The owner is the one exception: their own events count as backed up already, because only they can delete them and they always have them. That one is built in and there is no switch for it — the alternative would be defending the owner against the owner, and would leave a quiet room permanently unable to save anything. Blank plus 'always helps' is the shipped setting for Player and Guest: their backups count towards nobody else's number, but having their own full set lets them save a summary for themselves and clear their own old history. Choose numbers your room can actually reach: a number nobody can meet means people keep trying forever.");

    _renderTableSetting("Who can replace the owner's summary", "checkpointTable", s.checkpointTable, _editableFor("checkpointTable"), false,
      "The owner's summary is always trusted. When the owner is away, this decides how many different people at each rank must produce matching summaries to stand in for one. They have to agree with each other, and each has to be checkable against the last one — if they don't line up, none of them is used. THIS IS ALSO THE DELETE SETTING: once a summary is trusted, everyone who trusts it clears the history underneath it, so this number is how many people would have to agree with each other before the room lets go of what came before. The people it takes are ones you promoted, so it is a number about how much you trust your own staff together. Higher is safer and harder to reach; blank means that rank can never stand in.");

    _renderNumberSettingRow("checkpointCooldownMs", "Minimum gap between summaries (minutes)", s.checkpointCooldownMs, 0, 1440, _editableFor("checkpointCooldownMs"),
      "The minimum time between summaries for the whole room — the owner included, so nobody can flood it. Nothing is saved until this has passed, whatever the other settings say. Lower clears old history sooner; higher means less traffic.", 60000);

    _renderNumberSettingRow("checkpointEvery", "Save a summary after this many actions", s.checkpointEvery, 5, 1000, _editableFor("checkpointEvery"),
      "A summary is also due once this many things have happened since the last one, whether or not the gap above has passed. The gap covers a quiet room; this covers a busy one — either is reason enough. Lower means more summaries and shorter history to keep; higher means fewer.");

    _renderNumberSettingRow("checkpointRankOffsetMs", "Head start for each rank (seconds)", s.checkpointRankOffsetMs, 0, 120, _editableFor("checkpointRankOffsetMs"),
      "The owner saves a summary first. Each rank below waits this much longer, so they only step in when the ranks above them did not — one summary instead of one per person. Give it enough time for the owner's summary to actually arrive; a few seconds is usually right.", 1000);


    optionRow("selfWitnessCheckpoint", "Save a summary from your own backups", s.selfWitnessCheckpoint ? "on" : "off",
      [["on", "On — allowed if I have every backup myself"], ["off", "Off — only when the room has enough backups"]],
      (v) => _commitSetting("selfWitnessCheckpoint", { selfWitnessCheckpoint: v === "on" }));
    _renderSettingNote(null,
      "Normally you can only save a summary once enough of the room has backups, so anything cleared can still be recovered by someone. With this on, you may also save one when you personally hold every backup for that stretch — useful in a quiet room, and safe because you could rebuild it all yourself.");

    _renderNumberSettingRow("vouchJitter", "Turn-taking step & peer jitter (ms)", s.vouchJitter, 0, 10000, _editableFor("vouchJitter"),
      "People take turns backing things up, strongest rank first, so the whole room doesn't send at once. This is the gap between each rank's turn. Bigger spreads the work out and avoids duplicates but reacts more slowly; smaller is quicker and chattier.");

    _renderNumberSettingRow("receiptsPerMessage", "Backups carried per message", s.receiptsPerMessage, 1, 50, _editableFor("receiptsPerMessage"),
      "Messages carry a few small backups of recent events along with them. More per message spreads history faster, but too many makes the message too big to send. 10 sits comfortably under the limit.");

    // ── THE BOT DIALS (J17) ──────────────────────────────────────────────────────────────────
    // EVERY SETTING THE REDUCER DEFINES MUST BE REACHABLE HERE — `check-settings-rows` PART G and
    // `check-settings-passthrough` both require it, and the J17 lattice measured them as
    // independently load-bearing rather than one dominating the other. J17's Touches field did not
    // name `ui/interface.js`; the build step is what discovers that, and the omission is why this
    // change earns a `?v=` bump a reader of that field alone would not have expected.
    //
    // ── THE BOT IS LIVE AS OF v322, AND THIS SAID IT DID NOT EXIST ────────────────────────
    // The original note was written when nothing called `BotRuntime.start()`, and it was accurate
    // then. It is not now: a client signed in as an account holding the ladder's top rung in this
    // room BECOMES the bot, with no button and no setting, because the owner grants the level in
    // Matrix and that is the switch.
    //
    // The reasoning the old note carried still stands and is why these were built before the
    // runtime was: the reducer defines the keys, so the room HAS these values whether or not
    // anything reads them, and a value the owner can neither see nor change is what PART G exists
    // to prevent. What was rejected on exactly those grounds was a speculative DISPLAY toggle for
    // J19 — a control that does nothing is a visible lie. That distinction is the reason this
    // block had to be re-read the moment the runtime landed: the text below is shown to a PERSON,
    // and it was telling them a feature they are using does not exist.
    _renderSettingNote("The bot", "These settle how the room's bot behaves. A bot is any client signed in as an account you have given the top rank in this room — there is nothing to switch on here. If no such account is present the room simply holds these settings.");

    optionRow("botPresenceSpine", "Count queue actions as being around", s.botPresenceSpine ? "on" : "off",
      [["on", "On — playing, voting and saving count"], ["off", "Off — ignore them"]],
      (v) => _commitSetting("botPresenceSpine", { botPresenceSpine: v === "on" }));
    _renderSettingNote(null,
      "Whether things people do in the room — joining the queue, voting, saving — count as a sign they are around.");

    optionRow("botPresenceChat", "Count chat as being around", s.botPresenceChat ? "on" : "off",
      [["on", "On — chatting counts too"], ["off", "Off — chat is not counted"]],
      (v) => _commitSetting("botPresenceChat", { botPresenceChat: v === "on" }));

    // THE QUEUE'S OWN CHAT SWITCH. Deliberately beside the presence one so an owner sees that the
    // two timers ask the same question separately, rather than discovering later that turning chat
    // on for one did nothing for the other.
    optionRow("botQueueChat", "Count chat as keeping your queue place", s.botQueueChat ? "on" : "off",
      [["on", "On — chatting keeps your place"], ["off", "Off — only queue actions count"]],
      (v) => _commitSetting("botQueueChat", { botQueueChat: v === "on" }));
    // OFF BY DEFAULT and the note says why rather than leaving it to be discovered. Every other
    // rule in this project keeps chat out of durable surfaces, and turning this on is the one
    // place a person opts into chat being read for anything.
    _renderSettingNote(null,
      "Off by default. Chat is private to the room and is never stored or included in summaries; turning this on only lets a bot notice that a message arrived, nothing about what it said.");

    _renderFlagMapSetting(optionRow, "What keeps you in the presence chat", "activityPresence", s.activityPresence, _editableFor("activityPresence"),
      "Which actions count as being around for the presence chat. Usually more generous than the queue list: being in a chat costs the room nothing, and the cost of getting this wrong is throwing out somebody who was there.");

    _renderNumberSettingRow("botAfkMs", "Treat someone as away after (minutes)", s.botAfkMs, 1, 1440, _editableFor("botAfkMs"),
      "How long without doing any of the things above before a bot treats somebody as away. This measures what people DO, not whether they are watching — somebody quietly listening for an hour counts as away.", 60000);

    _renderNumberSettingRow("botPingMs", "Wait for an answer for (seconds)", s.botPingMs, 15, 3600, _editableFor("botPingMs"),
      "After a bot asks whether somebody is still there, how long it waits before acting on the silence.", 1000);

    // ── WHAT COUNTS AS BEING AROUND, PER GROUP (v322) ──────────────────────────────────────
    // TWO maps and not one, because they answer two questions the room may answer differently:
    // what keeps your PLACE IN THE QUEUE, and what keeps you in the presence chat. Holding a deck
    // while gone blocks other people; sitting in a chat while gone blocks nobody.
    //
    // `botPresenceSpine` above is the master switch for the whole log; these say WHICH acts
    // within it. A room with the switch off is not asked these questions — rendering them would
    // offer an owner controls that decide nothing, which is the shape `check-settings-rows` PART
    // G exists to refuse from the other direction.
    _renderFlagMapSetting(optionRow, "What keeps your place in the queue", "activityQueue", s.activityQueue, _editableFor("activityQueue"),
      "Which deliberate actions count as still wanting your turn. A bot removes somebody from the queue after the time below without doing any of these. Things your player does on its own — starting the next song, reporting a length — never count, or somebody who queued songs and walked away would look busy forever.");

    _renderNumberSettingRow("queueIdleMs", "Give up a queue place after (minutes)", s.queueIdleMs, 1, 1440, _editableFor("queueIdleMs"),
      "How long a deck is held for somebody who has stopped doing any of the things above. Shorter than the away time, because an idle deck blocks everybody else while an idle chat member blocks nobody. Coming back does not restore the place — a moderator can put somebody back.", 60000);

    _renderNumberSettingRow("repeatCooldownMs", "Don't replay a song within (minutes)", s.repeatCooldownMs, 0, 43200, _editableFor("repeatCooldownMs"),
      "0 turns this off. A song that played inside this window is skipped when it comes up again, and clients will not let it into a queue in the first place. It needs a bot running to do the skipping. Very long windows may do less than they look like they do: each client's play history only reaches so far back, and a client that cannot see far enough blocks nothing rather than guessing.", 60000);

    _renderDelegationSetting("What a bot may change on request", "botDelegation", s.botDelegation, isOwner && !_settingsLocked,
      "Which settings a bot is allowed to change when somebody asks it to, and the lowest rank that may ask. Anything not listed here can only be changed by you. This list itself is not on it, and cannot be: whoever could change it could give themselves everything else.");

    _renderRestoreFromFileRow(isOwner && !_settingsLocked);
    // The saves this client holds — rendered HERE, inside the room, because that is the only place
    // "held from this room" is a true statement (v273).
    renderExportSection();
  }

  // ── THE DELEGATION TABLE (J17) ─────────────────────────────────────────────────────────────
  // A map control rather than a per-rank one, because `botDelegation` is keyed by SETTING. Both
  // halves are read from `SETTING_RANGES` — the key domain from the entry's own `keys()` and the
  // rank vocabulary from its `values` — rather than restated here. That is the whole reason the
  // key got a row: a key with no row leaves the panel with no bounds to read and forces it to
  // restate the vocabulary, which is the `chat` drift `roles.md` §Confusables already flags.
  //
  // `botDelegation` NEVER APPEARS IN ITS OWN LIST, and the panel does not have to remember that:
  // the domain it iterates is the reducer's, and the reducer's excludes it structurally. A panel
  // filtering it out by name would be a second copy of the rule, free to disagree.
  // Collapsed by default — see the shape decision inside. Module-level so the disclosure
  // survives the re-render that toggling it causes.
  let _delegationOpen = false;

  // ── A BOOLEAN MAP CONTROL ─────────────────────────────────────────────────────────────────
  // One on/off row per group, through `optionRow` like every other choice in this panel. The
  // delegation table needed its own collapsed shape because 22 settings x 8 ranks is 176 pills;
  // this is 6 groups x 2, which the established control handles without becoming a wall. Matching
  // the precedent is right HERE and was wrong THERE, and the difference is the measurement rather
  // than a preference.
  //
  // THE DOMAIN COMES FROM THE REDUCER, through the feature layer — `check-boundaries` rule D
  // forbids `ui/` naming `StateDeriver` at all. So a group added to `ACTIVITY_GROUPS` grows a row
  // here with no edit, and a group removed loses one.
  //
  // WRITES THE WHOLE MAP, never one key. The blob is last-write-wins and the reducer accepts a
  // flag map WHOLE or refuses it whole, so posting a single-key object would mean the map became
  // that one key and every other group silently reverted to absent — which reads as false.
  function _renderFlagMapSetting(optionRow, label, key, value, editable, note) {
    const entry = (Room.getSettingRanges() || {})[key];
    if (!entry || !Array.isArray(entry.keys)) return;
    const cur = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
    // Human names for the groups. A group with no label here still renders, under its own id —
    // failing OPEN, because a missing label is a cosmetic gap and a missing ROW is a setting the
    // owner cannot reach, which is the more expensive of the two.
    const NAMES = {
      rotation:   "Joining, leaving or reordering the queue",
      moderation: "Moving, removing or striking somebody",
      skip:       "Skipping a song",
      vote:       "Upvoting a song",
      save:       "Saving a song",
      settings:   "Changing the room settings",
    };
    _renderSettingNote(label, note);
    for (const g of entry.keys) {
      const on = cur[g] === true;
      optionRow(key + ":" + g, NAMES[g] || g, on ? "on" : "off",
        [["on", "Counts"], ["off", "Does not count"]],
        (v) => {
          // Rebuild the FULL map from the domain, so the write is whole and every group carries an
          // explicit boolean. Reading `cur` for the others rather than the DOM: the DOM holds what
          // is drawn, and a row that failed to draw would silently write false.
          const next = {};
          for (const k of entry.keys) next[k] = (k === g) ? (v === "on") : (cur[k] === true);
          const patch = {}; patch[key] = next;
          _commitSetting(key, patch);
        });
    }
  }

  function _renderDelegationSetting(label, key, value, editable, note) {
    // Bounds through the FEATURE LAYER, never `StateDeriver` — `check-boundaries` rule D forbids
    // `ui/` naming the reducer at all, and it caught this on the first run. `Room.getSettingRanges`
    // is the seam the rest of this panel already reads its bounds from, and it resolves the map
    // entry's derived key domain to a plain array on the way across.
    const entry = (Room.getSettingRanges() || {})[key];
    if (!entry || !Array.isArray(entry.keys)) return;
    const domain = entry.keys;
    const names = entry.values;
    // ── THE PRECEDENT DOES NOT FIT, AND THAT IS THE DECISION ────────────────────────────────
    // Every other option goes through `optionRow` → `.set-opts` with `.set-opt` pills, and this
    // table did not: it built `.setting-row` / `.setting-label` / `.setting-delegation`, **none of
    // which `index.html` declares.** The select was themed at v273; the row around it never
    // existed.
    //
    // MEASURED BEFORE FORCING THE PRECEDENT: 22 delegable settings × 8 rank choices = **176
    // pills**. That is a wall whatever it is styled as, and `optionRow`'s pill row does not scale
    // to it — "match the others" would have produced a themed wall, which is still a wall.
    //
    // **AND ZERO SETTINGS ARE DELEGATED BY DEFAULT**, which is what makes the honest shape
    // obvious: the table is empty in almost every room, so the default view should be the empty
    // one. It renders COLLAPSED — a summary line naming what is delegated, and the full list only
    // when asked for. A room that has delegated nothing shows one line instead of twenty-two rows
    // of "Nobody", and a room that has delegated three shows those three.
    //
    // THE CLASSES ARE THE ONES THE STYLESHEET ACTUALLY DECLARES, checked rather than assumed —
    // the first attempt reached for `pref-block`/`pref-row`/`pref-label`, three names that do not
    // exist, which is the same mistake this item is about, made again one layer along. `set-row`
    // and `set-label` are the settings panel's own; `dim-row`/`dim-label` is the established
    // label-plus-control pair; `set-opts`/`set-opt` is the disclosure.
    // ── `cur` IS DECLARED BEFORE IT IS READ, AND THAT IS THE WHOLE OF v288's FIRST BUG ────────
    // v287 added the summary line, which reads `cur` — and left `const cur = …` twelve lines
    // BELOW it, where the expanded branch had always declared it. `const` is hoisted into a
    // temporal dead zone, so the read threw `ReferenceError: Cannot access 'cur' before
    // initialization` on EVERY render of this panel, from the first room open.
    //
    // The consequence is the v280 shape exactly: nothing between `renderSettings()` and the end of
    // `enterMainScreen` is inside a `try`, so `renderLogs`, `ChatPrefs.load`, `_setLayout`,
    // `_applyDisplayDims`, `renderChatSettings` and `_renderGear` never ran — the all-panels-
    // combined display, and the delegation table missing, are ONE bug.
    const cur = (value && typeof value === "object") ? value : {};
    const wrap = el("div", { class: "set-row setting-delegation" });
    wrap.appendChild(el("div", { class: "set-label", text: label }));
    const set = Object.keys(cur).filter((k) => typeof cur[k] === "string" && cur[k]);
    // ── THIS PANEL IS READ BY PEOPLE WHO ARE NOT THE OWNER, AND IT ADDRESSED ONLY THE OWNER ──
    // The rows are inert for them but the panel renders, so a delegated staff member read
    // "Only YOU can change these settings" — false to them in the one direction that matters, and
    // the same defect as "Only the owner can change these" on the bot's screen. The names are
    // listed with their display names for the same reason the rows are.
    const listed = set.map((k) => _settingDisplayName(k)).join(", ");
    const summary = el("div", { class: "muted", text: set.length
      ? set.length + (set.length === 1 ? " setting is" : " settings are") + " delegated: " + listed
      : (editable ? "Nothing is delegated. Only you can change these settings."
                  : "Nothing is delegated — only the room's owner can change these settings.") });
    wrap.appendChild(summary);
    // AND THE BUTTON PROMISED AN ACTION TO SOMEBODY WHO CANNOT TAKE IT. For a reader who cannot
    // edit the table, this opens a read-only view, and the label now says that instead of
    // "Change what a bot may do".
    const toggle = el("button", { class: "set-opt", text: _delegationOpen ? "Hide the list"
      : (editable ? "Change what a bot may do" : "See what a bot may do") });
    toggle.onclick = () => { _delegationOpen = !_delegationOpen; renderSettings(); };
    wrap.appendChild(el("div", { class: "set-opts" }, [toggle]));
    if (!_delegationOpen) {
      refs.settingsBox.appendChild(wrap);
      if (note) _renderSettingNote(null, note);
      return;
    }
    for (const k of domain) {
      const row = el("div", { class: "dim-row delegation-row" });
      row.appendChild(el("span", { class: "dim-label delegation-key", text: _settingDisplayName(k) }));
      // `rank-select` is the themed precedent every other dropdown in this panel uses.
      // `delegation-rank` was declared NOWHERE, so eighteen of these rendered as native dropdowns —
      // the third unstyled control shipped in five packages, each guarded by nothing.
      const sel = el("select", { class: "rank-select delegation-rank" });
      // "Nobody" is the ABSENCE of a row, not a rank — a delegation table naming a rank for every
      // key would be a table that delegates everything, which is the opposite of its default.
      sel.appendChild(el("option", { value: "", text: "Nobody — owner only" }));
      // `owner` IS SKIPPED, AND IT IS THE ONLY ONE. Delegating a setting TO the owner is a no-op:
      // the owner writes settings directly and never travels through a bot request, so the row
      // would mean exactly what "Nobody — owner only" already means. Two options with one meaning
      // is a choice a person has to work out rather than read.
      //
      // The list is otherwise the ladder as the reducer hands it over — including
      // `uncategorized`, which really does mean everyone in the room, and is a delegation an
      // owner may legitimately want.
      for (const n of names) {
        if (n === "owner") continue;
        sel.appendChild(el("option", { value: n, text: n }));
      }
      sel.value = (typeof cur[k] === "string") ? cur[k] : "";
      sel.disabled = !editable;
      sel.onchange = () => {
        // WHOLE-OR-NOTHING, matching the reducer: the full map is rebuilt and sent, never a patch.
        // A partial write would be merged field-by-field by `applySettingsEvent` and could not
        // express a REMOVAL, so a row could be added and never taken away.
        const next = {};
        for (const kk of domain) {
          const v = (kk === k) ? sel.value : cur[kk];
          if (typeof v === "string" && v) next[kk] = v;
        }
        // OWNER-ONLY, AND DELIBERATELY NOT ROUTED. `botDelegation` is excluded from its own key
        // domain precisely so no rank can be delegated the power to widen its own delegation.
        // Routing it through `_commitSetting` would be harmless today — the bot refuses a key
        // outside the domain — but it would put the one control that must never be delegable on
        // the delegable path, which is a fact about this line worth stating rather than relying
        // on a refusal two modules away.
        Room.setSettings({ botDelegation: next });
      };
      row.appendChild(sel);
      wrap.appendChild(row);
    }
    // ── `refs.settingsBox`, NOT `settingsBody` ────────────────────────────────────────────────
    // THIS LINE THREW IN THE FIRST BROWSER RUN AND KILLED SEVEN OTHER THINGS. `refs.settingsBody`
    // is not a stale reference — it is a name that HAS NEVER EXISTED anywhere in this file, one
    // character of divergence from the `settingsBox` all twenty-one sibling appends use. Every
    // guard passed, because no guard has ever CALLED this function.
    refs.settingsBox.appendChild(wrap);
    if (note) _renderSettingNote(null, note);
  }

  // ── RESTORE THIS ROOM FROM A SAVE FILE (J28) ─────────────────────────────────────────────────
  // The counterpart to the export picker on the rooms screen: that one writes a file, this one
  // reads one back into a room that is already running.
  //
  // IT DECIDES NOTHING. Whether the file is readable, whether its version and settings key set are
  // ones this build reads, whether its author declaration can be corroborated, whether the client
  // is caught up enough to anchor on the head, and whether this client is the owner are all
  // answered below the seam — the first four by `Room.overrideFromFile` and the backend it calls,
  // the last inside `Checkpoint.publishImport`. The only judgement here is "is this even JSON",
  // because a parse failure has no meaning to report from any deeper layer. Same division as the
  // create-from-file control in `app.js`.
  //
  // THE GATE IS `Actions.describe`, NEVER A RANK. The UI compares no rank to anything
  // (check-ui-no-permission), so whether to offer this at all is asked of the capability system
  // using the same verb that gates every other row in this panel.
  //
  // AND IT IS DELIBERATELY BEHIND THE SAME MASTER LOCK as every setting here. Restoring a room is
  // the most consequential thing on this panel — every client that adopts the checkpoint stops
  // computing from its own history below the cut — so it should not be one stray click away.
  function _renderRestoreFromFileRow(editable) {
    if (!Actions.describe("room.settings").enabled) return;   // not the owner: no control at all

    _renderSettingNote("Restore this room from a save file",
      "Loads a saved copy of a room into this one: the queue, who was DJing, what was playing and "
      + "the room's settings all come from the file. The room carries on from there. What was "
      + "happening here before is not deleted, but the room stops computing from it — so treat "
      + "this as a restore rather than an undo. Nobody is invited and nobody's rank changes: "
      + "people in the file who are not in this room simply drop out of the queue as their saved "
      + "songs play. Only an owner-authored file works, and only the owner can do this.");

    const note = el("p", { class: "muted" });
    const input = el("input", { type: "file", accept: "application/json,.json" });
    const btn = el("button", { class: "btn-secondary", text: "Restore from file" });
    if (!editable) {
      btn.disabled = true;
      note.textContent = "Unlock settings above to restore.";
    }
    btn.onclick = async () => {
      const f = input.files && input.files[0];
      if (!f) { note.textContent = "Choose a save file first."; return; }
      let parsed;
      try { parsed = JSON.parse(await f.text()); }
      catch (e) { note.textContent = "That file is not readable JSON."; return; }
      btn.disabled = true;
      note.textContent = "Restoring…";
      // THE RESULT IS READ, and every branch says something different. A refusal that renders as
      // silence is the shape that leaves a person pressing a button twice — the same reason the
      // feature layer RETURNS its refusals instead of dropping them (paths.md §8c).
      let res;
      try { res = await Room.overrideFromFile(parsed); }
      catch (e) { res = { ok: false, reason: "failed", detail: e && e.message }; }
      btn.disabled = false;
      if (res && res.ok) {
        note.textContent = "Restored. The room is now running from the file — everyone here "
          + "will pick it up as it reaches them.";
        return;
      }
      const reason = (res && res.reason) || "unknown";
      // The one refusal whose remedy is a DIFFERENT FILE rather than a retry, kept in the words
      // J27 established: no re-export can supply the joining segment of a room this client will
      // never hold.
      if (reason === "peer-file-unimportable") {
        note.textContent = "That file was saved by somebody who is not the room's owner, and only "
          + "an owner-authored file can restore a room. Ask the owner of the room it came from "
          + "for their own copy — saving this one again will not help.";
      } else if (reason === "not-live") {
        note.textContent = "This room is still loading. Wait until it has caught up and try again "
          + "— a restore has to know where the room is now.";
      } else if (reason === "checkpoint-not-published") {
        note.textContent = "The room is now using the file's settings but still its own queue — "
          + "the restore did not finish. Try again; repeating it is harmless.";
      } else {
        note.textContent = "Could not restore: " + reason
          + ((res && res.detail) ? " — " + res.detail : "");
      }
    };
    const row = el("div", { class: "set-row" }, [
      el("div", { class: "set-label", text: "Save file" }),
      el("div", { class: "set-opts" }, [input, btn]),
    ]);
    refs.settingsBox.appendChild(row);
    refs.settingsBox.appendChild(note);
  }

  // ── WHO MAY JOIN THE DJ QUEUE (J07) ──────────────────────────────────────────────────────────
  // A rank row, and the OPTIONS ARE DERIVED FROM THE REDUCER'S OWN TABLE rather than written here.
  // `Room.getSettingRanges().minDjRank.values` is the vocabulary the fold will accept, so the panel
  // cannot offer a rank the reducer refuses — the same relationship every number row already has
  // with its bounds, and the reason this key's validation was put in that table at all.
  //
  // Contrast `Main chat` a few lines above, whose three values ARE written in this file and again
  // in the reducer. That is the older shape and the drift this row exists not to repeat; it is left
  // alone here because changing it is not this job.
  //
  // The label is a DISPLAY form of the rank NAME — ui/ compares no rank to a number, so there is
  // nothing here for check-boundaries rule H to catch. It reuses `_rankLabel`, the helper the two
  // per-rank tables below already use; a second copy of that one-line transform is exactly the
  // duplication this row is otherwise built to avoid.
  function _renderMinDjRankRow(s, editable) {
    const r = (Room.getSettingRanges ? (Room.getSettingRanges().minDjRank || null) : null);
    const values = (r && Array.isArray(r.values)) ? r.values : [];
    const cur = (s && typeof s.minDjRank === "string") ? s.minDjRank : null;
    const locked = !!_setLocks.minDjRank;
    const row = el("div", { class: "set-row" });
    row.appendChild(el("div", { class: "set-label", text: "Who may join the DJ queue" }));
    if (!editable || !values.length) {
      row.appendChild(el("div", { class: "set-hint", text: cur ? (_rankLabel(cur) + " and above") : "\u2014" }));
      refs.settingsBox.appendChild(row);
      return;
    }
    const opts = el("div", { class: "set-opts" });
    for (const name of values) {
      const active = name === cur;
      const b = el("button", { class: "set-opt" + (active ? " active" : ""), text: _rankLabel(name) });
      if (!active && !locked) b.onclick = () => { _commitSetting("minDjRank", { minDjRank: name }); _lockSetting("minDjRank"); };
      else b.disabled = true;
      opts.appendChild(b);
    }
    row.appendChild(opts);
    row.appendChild(el("div", { class: "set-hint", text:
      "The weakest rank allowed to join the rotation. Raising it does NOT remove anyone already in "
      + "the queue — it decides who may join from now on, and someone who leaves or falls out is "
      + "judged by whatever the bar is when they come back." }));
    if (locked) row.appendChild(el("div", { class: "set-hint", text: "Updating\u2026" }));
    refs.settingsBox.appendChild(row);
  }

  // A plain explanatory row: an optional bold heading plus body text. Used to introduce a group of
  // settings once, instead of repeating the same context in every row's hint.
  function _renderSettingNote(heading, text) {
    const row = el("div", { class: "set-row" });
    if (heading) row.appendChild(el("div", { class: "set-label", text: heading }));
    row.appendChild(el("div", { class: "set-hint", text: text }));
    refs.settingsBox.appendChild(row);
  }

  // ── The two per-rank TABLES. Editing any row posts the WHOLE table, because the reducer accepts
  // a table only if it is COMPLETE and well-formed — that all-or-nothing rule is what stops a room
  // ending up half on a new policy and half on the old one. A BLANK count means "never": that rank
  // can never satisfy on its own (it can still help via the always toggle).
  // ONE ROW PER LADDER RUNG, asked for rather than written down. This was six hand-written labels
  // against a seven-rung ladder — guest missing, uncategorized wrongly editable — and since an edit
  // posts the whole table, six values went into seven slots and the last landed on the wrong rung.
  // Capabilities owns the row set and the edit so the count cannot drift from the ladder again, and
  // so a guard can RUN the rule instead of only reading it (check-settings-rows).
  const _rankRows = () => Room.getSettingRows();
  const _rankLabel = (name) => name.replace(/(^|-)([a-z])/g, (m, d, c) => (d ? "-" : "") + c.toUpperCase());

  function _renderTableSetting(title, key, table, editable, withAlways, hint) {
    refs.settingsBox.appendChild(el("div", { class: "set-row" }, [
      el("div", { class: "set-label", text: title }),
      el("div", { class: "set-hint", text: hint || "" }),
    ]));
    const rows = Array.isArray(table) ? table : [];
    const specs = _rankRows();
    for (let i = 0; i < specs.length; i++) {
      const cur = rows[i] || {};
      const row = el("div", { class: "set-row" });
      row.appendChild(el("div", { class: "set-label", text: "\u2003" + _rankLabel(specs[i].name) }));
      // A locked rung is shown READ-ONLY even to the owner: uncategorized is a structural rule
      // ("no number of unplaced accounts is ever enough"), not a preference, and it is displayed
      // rather than hidden so the rule is visible instead of merely absent.
      if (!editable || !specs[i].editable) {
        const txt = (typeof cur.enough === "number") ? String(cur.enough) : "never";
        const extra = (withAlways && cur.always) ? " \u00b7 always helps" : "";
        row.appendChild(el("div", { class: "set-hint", text: txt + extra }));
        refs.settingsBox.appendChild(row);
        continue;
      }
      const input = el("input", { type: "number", class: "uq-input", value: (typeof cur.enough === "number") ? String(cur.enough) : "" });
      input.min = "1"; input.max = "50"; input.placeholder = "never";
      const controls = [input];
      let always = null;
      if (withAlways) {
        always = el("input", { type: "checkbox" });
        always.checked = (cur.always === true);
        controls.push(el("label", { class: "set-hint", style: "display:flex;align-items:center;gap:4px;" },
          [always, el("span", { text: "always helps" })]));
      }
      const err = el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
      const setBtn = el("button", { class: "pref-add-btn", text: "Set" });
      setBtn.onclick = () => {
        const rawVal = String(input.value).trim();
        const n = (rawVal === "") ? null : Math.round(Number(rawVal));
        if (n !== null && (!isFinite(n) || n < 1 || n > 50)) {
          err.textContent = "Enter 1-50, or leave blank for never.";
          err.style.display = "block";
          return;
        }
        err.style.display = "none";
        // The complete table is built by Capabilities, not here: the posted shape is decided by the
        // ladder rather than by whatever this panel happens to be holding, which is what made the
        // short post possible in the first place.
        const next = Room.editSettingTable(rows, i, n, withAlways, always ? always.checked : false);
        if (!next) {
          err.textContent = "That row cannot be changed.";
          err.style.display = "block";
          return;
        }
        _commitSetting(key, { [key]: next });
        _lockSetting(key);
      };
      controls.push(setBtn);
      row.appendChild(el("div", { class: "uq-add", style: "display:flex;gap:6px;align-items:center;" }, controls));
      row.appendChild(err);
      refs.settingsBox.appendChild(row);
    }
  }

  // A generic owner-only NUMERIC setting row (maxLen/minLen/gate dials). Mirrors the bg
  // input row: an <input> + Set button, non-owner sees the current value read-only.
  // The range mirrors the reducer's validation so the UI can't offer an out-of-range
  // value; Room.setSettings re-validates regardless. Passes a partial with just this key.
  // `scale` (optional) lets a row show friendly units while storing raw ones — e.g. the checkpoint
  // cooldown is shown in MINUTES but stored in ms. min/max are expressed in the SHOWN unit.
  // The SKIP ROADS control. Each road is a pair (guest+, VIP+) of distinct-blocked-user
  // thresholds; the room skips when ANY road's both numbers are met. Rendered as plain
  // rows the owner reads as "5 blocked from guest up, OR 4 from VIP up, OR 3 and 2". Read
  // only for owners; others see the current roads. Writes the whole list back at once so a
  // half-edited table never reaches the reducer.
  function _renderSkipRoadsSetting(key, title, roads, editable, hint) {
    const list = Array.isArray(roads) ? roads : [];
    const row = el("div", { class: "set-row" });
    row.appendChild(el("div", { class: "set-label", text: title }));
    const describe = (r) => {
      const parts = [];
      if (r.guestPlus > 0) parts.push(r.guestPlus + " from guest up");
      if (r.vipPlus > 0) parts.push(r.vipPlus + " from VIP up");
      return parts.join(" and ") || "(nothing)";
    };
    row.appendChild(el("div", { class: "set-hint", text: list.map(describe).join("   OR   ") }));
    if (editable) {
      // Two inputs per road plus add/remove, kept deliberately simple; the reducer validates
      // and drops a malformed list wholesale, so the UI only has to assemble pairs.
      const draft = list.map((r) => ({ guestPlus: r.guestPlus || 0, vipPlus: r.vipPlus || 0 }));
      const box = el("div", { class: "uq-add", style: "display:flex;flex-direction:column;gap:6px;" });
      const commit = () => { _commitSetting(key, { [key]: draft.filter((r) => r.guestPlus > 0 || r.vipPlus > 0) }); _lockSetting(key); };
      const redraw = () => {
        while (box.firstChild) box.removeChild(box.firstChild);   // no innerHTML in the DOM layer
        draft.forEach((r, i) => {
          const g = el("input", { type: "number", class: "uq-input", value: String(r.guestPlus) }); g.min = "0"; g.max = "200";
          const v = el("input", { type: "number", class: "uq-input", value: String(r.vipPlus) }); v.min = "0"; v.max = "200";
          g.onchange = () => { r.guestPlus = Math.max(0, Math.round(Number(g.value) || 0)); };
          v.onchange = () => { r.vipPlus = Math.max(0, Math.round(Number(v.value) || 0)); };
          const del = el("button", { class: "pref-add-btn", text: "x" });
          del.onclick = () => { draft.splice(i, 1); redraw(); };
          box.appendChild(el("div", { style: "display:flex;gap:6px;align-items:center;" },
            [el("span", { class: "set-hint", text: "guest+" }), g, el("span", { class: "set-hint", text: "VIP+" }), v, del]));
        });
        const add = el("button", { class: "pref-add-btn", text: "Add a rule" });
        add.onclick = () => { draft.push({ guestPlus: 0, vipPlus: 0 }); redraw(); };
        const save = el("button", { class: "pref-add-btn", text: "Save rules" });
        save.onclick = commit;
        box.appendChild(el("div", { style: "display:flex;gap:6px;" }, [add, save]));
      };
      redraw();
      row.appendChild(box);
    }
    if (hint) row.appendChild(el("div", { class: "set-hint", text: hint }));
    refs.settingsBox.appendChild(row);
  }

  function _renderNumberSettingRow(key, label, current, min, max, editable, hint, scale) {
    // BOUNDS COME FROM THE REDUCER, and are converted into the unit the user actually types.
    // The caller's min/max are a fallback only. Previously each row carried its own copy: three
    // drifted when the reducer narrowed its ranges, and two compared a seconds input against
    // millisecond bounds — so the panel accepted values the reducer then silently discarded.
    const _r = (Room.getSettingRanges ? (Room.getSettingRanges()[key] || null) : null);
    const f = (_r && typeof _r.scale === "number" && _r.scale > 0)
      ? _r.scale : ((typeof scale === "number" && scale > 0) ? scale : 1);
    if (_r) { min = _r.min / f; max = _r.max / f; }
    const cur = (typeof current === "number") ? (current / f) : "";
    const row = el("div", { class: "set-row" });
    row.appendChild(el("div", { class: "set-label", text: label }));
    if (!editable) {
      row.appendChild(el("div", { class: "set-hint", text: (cur === "" ? "—" : String(cur)) }));
      refs.settingsBox.appendChild(row);
      return;
    }
    const input = el("input", { type: "number", class: "uq-input", value: String(cur) });
    input.min = String(min); input.max = String(max);
    const setBtn = el("button", { class: "pref-add-btn", text: "Set" });
    const err = el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    const submit = () => {
      const n = Math.round(Number(input.value));
      if (!isFinite(n) || n < min || n > max) {
        err.textContent = "Enter a number between " + min + " and " + max + ".";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      _commitSetting(key, { [key]: n * f });
      _lockSetting(key);
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    row.appendChild(el("div", { class: "uq-add", style: "display:flex;gap:6px;" }, [input, setBtn]));
    if (hint) row.appendChild(el("div", { class: "set-hint", text: hint }));
    row.appendChild(err);
    refs.settingsBox.appendChild(row);
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
      _commitSetting("bg", { bg: safe });
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    clearBtn.onclick = () => { input.value = ""; err.style.display = "none"; _commitSetting("bg", { bg: null }); };

    row.appendChild(el("div", { class: "uq-add", style: "display:flex;gap:6px;" }, [input, setBtn, clearBtn]));
    if (!ChatPrefs.bgOpts().bgOn) {
      row.appendChild(el("div", { class: "set-hint",
        text: "Note: you have backgrounds turned off for yourself (⚙ Settings), so you won't see this even when set." }));
    }
    row.appendChild(err);
    refs.settingsBox.appendChild(row);
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ THUMBNAIL PIPELINE
  //
  // Its own scheduler, not an img src: observe, enqueue, pump with a concurrency cap, blob
  // cache, LRU, failure backoff.
  // ────────────────────────────────────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ SONG ROWS AND PREVIEW
  //
  // songRow is used by every list. The thumbnail slot is the preview trigger for the local
  // mini-player.
  // ────────────────────────────────────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ QUEUE PANELS
  //
  // Room queue, my queue, history and playlists all render into ONE container. The dispatcher
  // clears it; a renderer reached from anywhere else must clear it itself.
  // ────────────────────────────────────────────────────────────────────────────────────────

  function renderQueuePanel() {
    if (!refs.queueBody) return;
    if (refs.tabRoom) refs.tabRoom.classList.toggle("active", queueTab === "room");
    if (refs.tabMine) refs.tabMine.classList.toggle("active", queueTab === "mine");
    if (refs.tabHistory) refs.tabHistory.classList.toggle("active", queueTab === "history");
    if (refs.tabPlaylists) refs.tabPlaylists.classList.toggle("active", queueTab === "playlists");
    clear(refs.queueBody);
    refs.queueBody.classList.remove("roomq-locked");   // room-queue-only gating class; re-added by renderRoomQueue
    refs.queueBody.classList.remove("uq-locked");       // My-queue-only gating class; re-added by renderMyQueue
    if (queueTab === "room") renderRoomQueue();
    else if (queueTab === "history") renderHistory();
    else if (queueTab === "playlists") renderPlaylists();
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
      if (queueTab === "room") renderRoomQueue();
    }, ms + 60);
  }

  function _roomqRowControls(entry, index, rotation) {
    const ids = (rotation || []).map(r => r.user);
    const i = index, last = ids.length - 1;
    const isFirst = (i === 0), isLast = (i === last);
    const user = entry.user;
    const songId = (entry.pending && entry.pending.length) ? entry.pending[0].videoId : null;  // the song this row shows
    const mk = (glyph, title, fn, on) => {
      const b = el("button", { class: "mini rq-ctl", text: glyph, title: title, "aria-label": title });
      if (on) b.onclick = () => { if (_roomqLocked) return; fn(); }; else b.disabled = true;
      return b;
    };
    const sep = () => el("span", { class: "q-sep", "aria-hidden": "true" });
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
    clear(refs.queueBody);
    const np = Queue.getNowPlaying();
    const rotation = Queue.getRotation();

    // Header row (ABOVE the now-playing box): "Reset rotation" (High-Staff+, greyed by
    // the lock via the .roomq-locked class) on the left, the room-queue lock button on
    // the right. Lock is TIMED (5s) like Skip. Height matches the My-Queue / Playlists
    // locks (fixed .panel-lock-btn).
    const headRow = el("div", { class: "rq-head-row" });
    // Room-queue management is rank-gated. A user who can't manage it should see
    // neither the controls NOR the lock that gates them. Reset is High-Staff+; the
    // per-row move/remove are Staff+ — both decided by the capability system, no rank
    // check here.
    const canReset = Actions.describe("dj.reset").enabled;
    const canManageRows = !!(rotation && rotation.length) &&
      Actions.describe("dj.move", { userId: rotation[0].user }).enabled;
    const showRoomqControls = canReset || canManageRows;
    if (canReset) {
      const reset = el("button", { class: "danger", text: "Reset rotation", onclick: () => { if (!_roomqLocked) Actions.perform("dj.reset"); } });
      headRow.appendChild(reset);          // greyed/inert when locked via CSS (.roomq-locked .danger)
    }
    // The lock only appears when there's actually a gated control to lock.
    if (showRoomqControls) {
      refs.roomqLockBtn = _roomqLockBtn();
      headRow.appendChild(refs.roomqLockBtn);
    } else {
      refs.roomqLockBtn = null;
    }
    if (headRow.childNodes.length) refs.queueBody.appendChild(headRow);
    refs.queueBody.classList.toggle("roomq-locked", _roomqLocked && showRoomqControls);   // gate the controls below

    // Now-playing box: a bright-white "Now Playing" tag next to the DJ name, then a
    // read-only (cacheOnly) song row with the ★ save / ▲ vote affordances.
    if (np && np.song) {
      const npTag = el("span", { class: "rq-np-tag", text: "Now Playing" });
      const npName = el("span", { class: "who", text: shortName(np.dj) });
      npName.style.color = rankColor(_rosterLevel(np.dj));
      _wireCardTrigger(npName, np.dj);   // the card, from the queue (J14)
      const npHead = el("div", { class: "rq-np-head" }, [npTag, npName]);
      const npRow = songRow(np.song.videoId, { thumbMode: "cacheOnly", actions: [_starBtn(), _voteBtn()] });
      npRow.classList.add("playing");
      refs.queueBody.appendChild(el("div", { class: "rq-group playing" }, [npHead, npRow]));
    }

    if (!rotation || rotation.length === 0) {
      refs.queueBody.appendChild(el("p", { class: "muted", text: "No DJs waiting" }));
    } else {
      // One row per waiting DJ (their next declared song). Each row shows the
      // thumbnail + id/title (filling in from cache/fetch), the user who queued it
      // (sub line, rank-coloured), and the wired reorder/remove controls (Staff+).
      rotation.forEach((entry, idx) => {
        const vid = (entry.pending && entry.pending.length) ? entry.pending[0].videoId : null;
        if (!vid) return;                        // a rotation entry always has >=1 pending song
        const row = songRow(vid, {
          thumbMode: "fetch",                    // load thumbnails/titles for the room queue now
          sub: shortName(entry.user),            // who queued it
          actions: canManageRows ? _roomqRowControls(entry, idx, rotation) : [],
        });
        const whoEl = row.querySelector(".sr-when");
        if (whoEl) {
          whoEl.style.color = rankColor(_rosterLevel(entry.user));
          _wireCardTrigger(whoEl, entry.user);   // the card, from the queue (J14)
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
    // The lock (right of Add) gates the "Clear" affordance below. Toggling it — and
    // arming/cancelling Clear — only re-renders the small clear header (which has no
    // thumbnails), NOT the whole panel, so the song rows don't flash. Non-timed.
    refs.uqLockBtn = _uqLockBtnEl();
    refs.queueBody.appendChild(el("div", { class: "uq-add" }, [input, el("button", { text: "Add", onclick: addOne }), refs.uqLockBtn]));
    refs.queueBody.appendChild(note);
    // Mirror of the room-queue's .roomq-locked: while the My-Queue lock is engaged, the
    // .uq-locked class greys + disables the per-row remove ✕ (see `.uq-locked .uq-remove`)
    // WITHOUT re-rendering the rows, so toggling the lock never flashes thumbnails.
    refs.queueBody.classList.toggle("uq-locked", _uqLocked);

    // Clear header lives in a persistent container so we can repaint just it.
    refs.uqListHead = el("div");
    refs.queueBody.appendChild(refs.uqListHead);
    _renderUqListHead();

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
        // Remove ✕ is gated by the My-Queue lock, like the Clear button: while locked, the
        // .uq-locked class on the queue body greys it + blocks pointer events (flash-free —
        // no row re-render, same mechanism as the room-queue controls) and the onclick guard
        // stops keyboard activation. The ▲▼⏫⏬ moves stay free (reordering is reversible).
        const removeBtn = mv("\u2715", "Remove", () => { if (_uqLocked) return; UserQueue.removeAt(i); }, true);
        removeBtn.classList.add("uq-remove");
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
          const vid = song.videoId;
          const bar = el("div", { class: "commit-bar " + state });
          const fill = el("div", { class: "commit-fill" });
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
      }, SONG_ROW_H);
    }
    // Join/Leave the DJ queue now lives under the now-playing song (see buildMainDom).
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ ROOM HISTORY
  //
  // Newest first, read through the feature seam so it survives a trim.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
    // ── SAY HOW MUCH OF THE ROOM THIS ACTUALLY IS ────────────────────────────────────────────
    // The module reports its reach honestly and nothing was showing it. A pane that says "the last
    // 40 songs" is useful; one that implies it has everything when it holds a window is not — and
    // this pane has spent a while quietly holding a window while looking complete.
    try {
      const cov = (Queue.historyReach ? Queue.historyReach() : null);
      if (cov && cov.entries) {
        refs.queueBody.appendChild(el("p", { class: "muted history-reach", text:
          cov.complete ? (cov.entries + " songs — the whole room")
                       : (cov.entries + " songs — as far back as this client can reach") }));
      }
    } catch (e) {}
    const now = Date.now();
    // THE JOIN, MADE HERE. Both tables key on the play instance, so a row's reactions are
    // counts[row.pi] — this playing's own, not the song's running total. Two plays of one track
    // are two rows showing two different figures, which is the whole point of a playing having
    // its own identity. Done at render because a history row records WHAT PLAYED and a vote must
    // not mutate that record (check-reactions).
    const counts = (typeof Queue !== "undefined" && Queue.getState) ? (Queue.getState().counts || {}) : {};
    rows.forEach((h) => {
      const c = counts[h.pi] || null;
      const reactions = c
        ? ((c.votes ? " · ▲ " + c.votes : "") + (c.saves ? " · ★ " + c.saves : ""))
        : "";
      const row = songRow(h.videoId, {
        thumbMode: "cacheOnly",                       // display-if-known; no ambient fetch
        sub: _fmtAgo(h.at, now) + (h.skipped ? " · skipped" : "") + reactions,
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ PLAYLISTS
  //
  // Library, detail, the add-to-playlist picker, and import/export.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
    // The lock (right of Create) gates rename + delete on every row below — while
    // locked they can't even be armed. Non-timed; re-locks on any tab change.
    const plLock = _panelLockBtn(_plLocked,
      _plLocked ? "Locked — click to unlock editing" : "Unlocked — click to lock",
      () => { _plLocked = !_plLocked; _plConfirmDelete = null; renderQueuePanel(); });
    refs.queueBody.appendChild(el("div", { class: "pl-lib-head" }, [
      el("div", { class: "uq-add" }, [input, el("button", { text: "Create", onclick: create }), plLock]),
      el("div", { class: "pl-io-entry" }, [
        el("button", { class: "mini pl-io-open", text: "\u21C5 Import / Export",
          title: "Import or export playlists to a file", onclick: () => _openLibraryIO("export") }),
      ]),
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
    name.onclick = () => { _plView = p.id; _plConfirmDelete = null; renderQueuePanel(); };
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
    if (_plConfirmDelete === p.id) {
      // Armed: REPLACE [✎ rename][✕ delete] with [✔ confirm] · [✘ cancel], fenced by the
      // .q-sep. The confirm is `mini ico dconfirm` — the SAME icon-button geometry as the
      // cancel ✕ (26×24, centered, no border/margin), just tinted red. It must NOT carry
      // the bare `.danger` class: that is the big standalone-button style (align-self
      // flex-start + margin-top + border + large padding) and it was pushing the confirm
      // down and growing the whole row. \uFE0E keeps the glyph text-presented (no taller
      // color-emoji). See `.mini.ico.dconfirm` / `.dconfirm + .q-sep` in index.html.
      acts.push(el("button", { class: "mini ico dconfirm", text: "\u2714\uFE0E", title: "Confirm delete",
        onclick: async () => { _plConfirmDelete = null; delete _plCounts[p.id]; await Playlists.remove(p.id); } }));
      acts.push(el("span", { class: "q-sep", "aria-hidden": "true" }));
      acts.push(el("button", { class: "mini ico", text: "\u2718\uFE0E", title: "Cancel",
        onclick: () => { _plConfirmDelete = null; renderQueuePanel(); } }));
    } else {
      const renameBtn = el("button", { class: "mini ico", text: "✎",
        title: _plLocked ? "Locked — unlock (top) to rename" : "Rename",
        onclick: () => { if (_plLocked) return; _plRenaming = p.id; _plConfirmDelete = null; renderQueuePanel(); } });
      renameBtn.disabled = _plLocked;
      const delBtn = el("button", { class: "mini ico", text: "✕",
        title: _plLocked ? "Locked — unlock (top) to delete" : "Delete playlist",
        onclick: () => { if (_plLocked) return; _plConfirmDelete = p.id; renderQueuePanel(); } });
      delBtn.disabled = _plLocked;
      acts.push(renameBtn, delBtn);
    }
    row.appendChild(el("span", { class: "uq-actions" }, acts));
    return row;
  }

  // --- Detail view: one playlist's tracks --------------------------------------
  function _renderPlaylistDetail(id) {
    const back = el("button", { class: "mini pl-back", text: "← Back", title: "Back to playlists" });
    back.onclick = () => { _plView = "list"; _plConfirmDelete = null; renderQueuePanel(); };
    const titleEl = el("span", { class: "pl-detail-title", text: "…" });
    const addAll = el("button", { class: "mini", text: "＋ All to my queue", title: "Add every song to my queue" });
    // Same Playlists-tab lock (_plLocked) that gates rename/delete in the library view,
    // surfaced here so it also gates the per-row ✕ remove-from-playlist. Same style
    // (.panel-lock-btn) and mannerism (non-timed, re-locks on tab change) as the other
    // panel locks; toggling disarms any pending remove and repaints the detail view.
    const detailLock = _panelLockBtn(_plLocked,
      _plLocked ? "Locked — click to unlock removing" : "Unlocked — click to lock",
      () => { _plLocked = !_plLocked; _plConfirmDelete = null; renderQueuePanel(); });
    const header = el("div", { class: "pl-detail-head" }, [back, titleEl, el("span", { class: "uq-actions" }, [addAll, detailLock])]);
    refs.queueBody.appendChild(header);
    const note = el("div", { class: "uq-note muted" });

    // Add-by-link: the playlist analogue of My Queue's add box. Paste a YouTube link
    // (or a bare id) to drop a song straight into THIS playlist — routes through
    // Playlists.addTrackByUrl -> addTrack, so it inherits dedup + the track cap. On
    // success we re-render the detail (still on this playlist) so the new row shows.
    const linkInput = el("input", { class: "uq-input", placeholder: "Paste a YouTube link…" });
    const addByLink = async () => {
      const v = linkInput.value.trim();
      if (!v) return;
      const r = await Playlists.addTrackByUrl(id, v);
      if (r && r.ok) {
        linkInput.value = "";
        delete _plCounts[id];      // count is stale; reloads on re-render
        renderQueuePanel();        // _plView is still this id -> detail re-renders with the new track
      } else {
        note.textContent = "Couldn't add: " + ((r && r.reason) || "unknown") + ".";
      }
    };
    linkInput.onkeydown = (e) => { if (e.key === "Enter") addByLink(); };
    refs.queueBody.appendChild(el("div", { class: "uq-add" }, [linkInput, el("button", { text: "Add", onclick: addByLink })]));

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
        body.appendChild(el("p", { class: "muted", text: "No songs yet — paste a link above, or use the ＋ on a song in History or Now Playing." }));
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
    // ＋ add-to-my-queue is always available (non-destructive). The ✕ remove-from-playlist
    // is a SINGLE click — no two-step confirm — because the Playlists lock already guards
    // it: while locked the ✕ is greyed + inert (mirroring the library view's delete ✕), so
    // an accidental removal isn't possible without deliberately unlocking at the top first.
    // NOTE: dropping the confirm is scoped to per-song removal INSIDE a playlist only; the
    // library view (deleting a WHOLE playlist) keeps its two-step confirm. A .q-sep fences
    // ＋ from ✕ so the remove can't be fat-fingered, matching the My-Queue clusters.
    const acts = [];
    acts.push(el("button", { class: "mini ico", text: "＋", title: "Add to my queue",
      onclick: () => { const r = Playlists.cloneToQueue(videoId); renderJoinBtn();
        if (r && !r.ok && r.reason) Logger.info("My queue: " + r.reason); } }));
    acts.push(el("span", { class: "q-sep", "aria-hidden": "true" }));
    const rmBtn = el("button", { class: "mini ico", text: "✕",
      title: _plLocked ? "Locked — unlock (top) to remove" : "Remove from playlist",
      onclick: async () => {
        if (_plLocked) return;
        delete _plCounts[playlistId];
        await Playlists.removeTrack(playlistId, videoId);
        renderQueuePanel();
      } });
    rmBtn.disabled = _plLocked;
    acts.push(rmBtn);
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

    const close = () => { if (Playlists.offChange) Playlists.offChange(repaint); overlay.remove(); };
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
    // Re-paint wrapper for the onChange subscription. Self-heals the double-open
    // edge: if a later open replaced this overlay (its node detached) without our
    // close() firing, the next notify unsubscribes this stale listener instead of
    // painting into a detached node.
    const repaint = () => {
      if (!listWrap.isConnected) { if (Playlists.offChange) Playlists.offChange(repaint); return; }
      paint();
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
    // Playlists.init()'s IndexedDB hydrate is ASYNC. On the FIRST time the picker
    // opens (before Playlists has ever hydrated), Playlists.list() above is still
    // empty and paint() shows "No playlists yet" even though lists exist. Re-paint
    // when the index lands (and on any later create/rename/remove); close()
    // unsubscribes so this doesn't leak across opens.
    if (Playlists.onChange) Playlists.onChange(repaint);

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

  // === 15: Playlists Import / Export overlay =================================
  // Body-mounted (the add-to-playlist / Preview precedent), reusing the .pl-pick-*
  // card. Two modes (Export | Import). During a run the view is LOCKED — no
  // backdrop/Close exit, only Cancel — and the run aborts cleanly (no partial file /
  // no half-written import beyond whole playlists already made). All non-consensus.
  function _ioTab(label, active, onclick) {
    return el("button", { class: "pl-io-tab" + (active ? " active" : ""), text: label, onclick: onclick });
  }

  function _openLibraryIO(startMode) {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined" || typeof Playlists.exportPrepare !== "function") return;
    const prior = document.querySelector(".pl-io-overlay");
    if (prior) prior.remove();

    const S = {
      mode: startMode === "import" ? "import" : "export",
      phase: "pick",           // pick | running
      prep: null, selected: null, includeThumbs: true,
      run: null, prog: { done: 0, total: 0 }, note: "",
      file: null, fileName: "", inspect: null, summary: null,
    };

    const bodyEl = el("div", { class: "pl-io-body" });
    const card = el("div", { class: "pl-pick-card pl-io-card" });
    const overlay = el("div", { class: "pl-pick-overlay pl-io-overlay" }, [card]);
    const locked = () => S.phase === "running";
    const close = () => { overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay && !locked()) close(); };

    function _fmtBytes(n) {
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
      return (n / 1024 / 1024).toFixed(1) + " MB";
    }
    function _estimate() {
      const sizes = (S.prep && S.prep.thumbSizes) || {};
      let lists = 0, songs = 0, withThumb = 0, thumbChars = 0, textChars = 0;
      for (const l of (S.prep ? S.prep.lists : [])) {
        if (!S.selected.has(l.id)) continue;
        lists++; textChars += (l.name || "").length + 24;
        for (const t of l.tracks) {
          songs++; textChars += (t.videoId || "").length + 40;
          const s = sizes[t.videoId];
          if (typeof s === "number") { withThumb++; thumbChars += Math.ceil(s * 4 / 3) + 30; }
        }
      }
      const base = 80;
      return { lists, songs, withThumb, without: base + textChars, withT: base + textChars + thumbChars };
    }
    function _filename() {
      const d = new Date(), p = (n) => String(n).padStart(2, "0");
      return "ddjp-playlists-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".json";
    }
    function _download(obj) {
      const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: _filename() });
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 4000);
    }

    function head() {
      const doneBtn = el("button", { class: "mini", text: "Close", onclick: () => { if (!locked()) close(); } });
      doneBtn.disabled = locked();
      const tabs = el("span", { class: "pl-io-tabs" }, [
        _ioTab("Export", S.mode === "export", () => { if (!locked()) { S.mode = "export"; S.phase = "pick"; S.note = ""; render(); } }),
        _ioTab("Import", S.mode === "import", () => { if (!locked()) { S.mode = "import"; S.phase = "pick"; S.note = ""; render(); } }),
      ]);
      return el("div", { class: "pl-pick-head" }, [
        el("span", { class: "pl-pick-title", text: "Playlists" }), tabs,
        el("span", { class: "uq-actions" }, [doneBtn]),
      ]);
    }

    function progressView() {
      const pct = S.prog.total ? Math.round(S.prog.done / S.prog.total * 100) : 0;
      const fill = el("div", { class: "pl-io-bar-fill" }); fill.setAttribute("style", "width:" + pct + "%");
      S._fill = fill;
      S._label = el("div", { class: "pl-io-prog-label", text: (S.mode === "export" ? "Exporting…" : "Importing…") + " " + S.prog.done + " / " + S.prog.total + " songs" });
      const cancel = el("button", { class: "mini danger", text: "Cancel", onclick: () => { if (S.run) S.run.cancelled = true; } });
      return el("div", { class: "pl-io-prog" }, [S._label, el("div", { class: "pl-io-bar" }, [fill]), el("div", { class: "pl-io-prog-actions" }, [cancel])]);
    }
    function _tick(done, total) {
      S.prog.done = done; S.prog.total = total;
      if (S._fill) S._fill.setAttribute("style", "width:" + (total ? Math.round(done / total * 100) : 0) + "%");
      if (S._label) S._label.textContent = (S.mode === "export" ? "Exporting…" : "Importing…") + " " + done + " / " + total + " songs";
    }

    function exportPick() {
      const wrap = el("div", { class: "pl-io-export" });
      if (!S.prep) {
        wrap.appendChild(el("p", { class: "muted", text: "Loading your playlists…" }));
        Playlists.exportPrepare().then((prep) => {
          S.prep = prep || { lists: [], thumbSizes: {} };
          S.selected = new Set(S.prep.lists.map((l) => l.id));
          render();
        }).catch(() => { S.prep = { lists: [], thumbSizes: {} }; S.selected = new Set(); render(); });
        return wrap;
      }
      if (!S.prep.lists.length) { wrap.appendChild(el("p", { class: "muted", text: "No playlists to export yet." })); return wrap; }

      wrap.appendChild(el("div", { class: "pl-io-selrow" }, [
        el("button", { class: "mini", text: "Select all", onclick: () => { S.selected = new Set(S.prep.lists.map((l) => l.id)); render(); } }),
        el("button", { class: "mini", text: "Deselect all", onclick: () => { S.selected = new Set(); render(); } }),
      ]));

      const listWrap = el("div", { class: "pl-io-list" });
      for (const l of S.prep.lists) {
        const cb = el("input", { type: "checkbox" }); cb.checked = S.selected.has(l.id);
        cb.onchange = () => { if (cb.checked) S.selected.add(l.id); else S.selected.delete(l.id); _repaintEst(); };
        listWrap.appendChild(el("label", { class: "pl-io-item" }, [cb,
          el("span", { class: "pl-io-item-name", text: l.name }),
          el("span", { class: "pl-io-item-count", text: String(l.tracks.length) })]));
      }
      wrap.appendChild(listWrap);

      const thumbCb = el("input", { type: "checkbox" }); thumbCb.checked = S.includeThumbs;
      thumbCb.onchange = () => { S.includeThumbs = thumbCb.checked; _repaintEst(); };
      wrap.appendChild(el("label", { class: "pl-io-thumbs" }, [thumbCb, el("span", { text: "Include thumbnails" })]));

      S._est = el("div", { class: "pl-io-est muted" });
      S._cov = el("div", { class: "pl-io-cov muted" });
      wrap.appendChild(S._est); wrap.appendChild(S._cov);
      _repaintEst();

      const btn = el("button", { class: "pl-io-go", text: "Export to file", onclick: () => _runExport() });
      wrap.appendChild(el("div", { class: "pl-io-go-row" }, [btn]));
      if (S.note) wrap.appendChild(el("div", { class: "uq-note muted", text: S.note }));
      return wrap;
    }
    function _repaintEst() {
      if (!S._est) return;
      const e = _estimate();
      let txt = e.lists + (e.lists === 1 ? " playlist · " : " playlists · ") + e.songs + (e.songs === 1 ? " song — " : " songs — ");
      txt += S.includeThumbs ? ("~" + _fmtBytes(e.withT) + " with thumbnails") : (_fmtBytes(e.without) + " without thumbnails");
      S._est.textContent = txt;
      if (S._cov) S._cov.textContent = S.includeThumbs ? ("thumbnails for " + e.withThumb + " of " + e.songs + " songs (the rest re-fetch on import)") : "";
    }
    async function _runExport() {
      const ids = S.prep.lists.filter((l) => S.selected.has(l.id)).map((l) => l.id);
      if (!ids.length) { S.note = "Select at least one playlist to export."; render(); return; }
      S.phase = "running"; S.run = { cancelled: false }; S.prog = { done: 0, total: 0 }; render();
      const res = await Playlists.exportBuild(ids, { includeThumbs: S.includeThumbs, onProgress: _tick, isCancelled: () => S.run.cancelled });
      S.phase = "pick";
      if (res && res.ok) { _download(res.file); S.note = "Exported " + ids.length + (ids.length === 1 ? " playlist." : " playlists."); }
      else if (res && res.reason === "cancelled") { S.note = "Export cancelled — no file saved."; }
      else { S.note = "Export failed."; }
      render();
    }

    function importPick() {
      const wrap = el("div", { class: "pl-io-import" });
      const fileInput = el("input", { type: "file", accept: ".json,application/json" });
      fileInput.setAttribute("style", "display:none");
      fileInput.onchange = () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        S.fileName = f.name || "file"; S.summary = null;
        const rd = new FileReader();
        rd.onload = () => {
          let obj = null; try { obj = JSON.parse(String(rd.result)); } catch (e) { obj = null; }
          S.file = obj;
          S.inspect = obj ? Playlists.inspectLibrary(obj) : { ok: false, reason: "not valid JSON" };
          render();
        };
        rd.onerror = () => { S.file = null; S.inspect = { ok: false, reason: "couldn't read the file" }; render(); };
        rd.readAsText(f);
      };
      wrap.appendChild(el("div", { class: "pl-io-choose" }, [
        el("button", { class: "mini", text: "Choose file…", onclick: () => fileInput.click() }),
        el("span", { class: "muted", text: S.fileName ? (" " + S.fileName) : " no file chosen" }),
      ]));
      wrap.appendChild(fileInput);

      if (S.summary) {
        const su = S.summary;
        const t = su.err ? ("Import failed: " + su.err)
          : su.cancelled ? ("Cancelled — kept " + su.playlists + (su.playlists === 1 ? " playlist (" : " playlists (") + su.added + " songs) already imported.")
          : ("Imported " + su.playlists + (su.playlists === 1 ? " playlist · " : " playlists · ") + su.added + (su.added === 1 ? " song added · " : " songs added · ") + su.skipped + " skipped.");
        wrap.appendChild(el("div", { class: "uq-note", text: t }));
        return wrap;
      }
      if (S.inspect) {
        if (S.inspect.ok) {
          wrap.appendChild(el("div", { class: "pl-io-est muted", text: S.inspect.playlists + (S.inspect.playlists === 1 ? " playlist · " : " playlists · ") + S.inspect.songs + (S.inspect.songs === 1 ? " song in this file." : " songs in this file.") }));
          wrap.appendChild(el("div", { class: "pl-io-cov muted", text: "Added as new playlists (a repeated name gets a number). Nothing you already have is changed." }));
          wrap.appendChild(el("div", { class: "pl-io-go-row" }, [el("button", { class: "pl-io-go", text: "Import", onclick: () => _runImport() })]));
        } else {
          wrap.appendChild(el("div", { class: "uq-note muted", text: "This doesn't look like a DDJP playlists file (" + (S.inspect.reason || "unrecognized") + ")." }));
        }
      } else {
        wrap.appendChild(el("p", { class: "muted", text: "Choose a DDJP playlists file to import." }));
      }
      return wrap;
    }
    async function _runImport() {
      if (!S.file) return;
      S.phase = "running"; S.run = { cancelled: false }; S.prog = { done: 0, total: 0 }; render();
      const res = await Playlists.importLibrary(S.file, { onProgress: _tick, isCancelled: () => S.run.cancelled });
      S.phase = "pick";
      S.summary = (res && res.ok) ? res : { playlists: 0, added: 0, skipped: 0, err: (res && res.reason) || "unknown" };
      render();
    }

    function render() {
      clear(card); card.appendChild(head());
      clear(bodyEl);
      if (S.phase === "running") bodyEl.appendChild(progressView());
      else if (S.mode === "export") bodyEl.appendChild(exportPick());
      else bodyEl.appendChild(importPick());
      card.appendChild(bodyEl);
    }
    render();
    document.body.appendChild(overlay);
  }

  // A ＋ action button that opens the add-to-playlist picker for a videoId. Shared
  // by the History rows and the Now-Playing row.
  function _addToPlaylistBtn(videoId) {
    return el("button", { class: "mini ico", text: "＋", title: "Add to a playlist",
      onclick: () => _openAddToPlaylist(videoId) });
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ REACTIONS
  //
  // Save and upvote, and their latched state.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
      if (typeof Actions !== "undefined" && Actions.perform) {
        try { await Actions.perform("react.save", { pi: pi }); } catch (e) { return; }
        _reflectReactions();
      }
    });
  }
  // ▲ press: emit ddjp.dj.vote for the current instance + latch. One-way (no un-vote).
  async function _onVotePress() {
    if (typeof Reactions === "undefined" || !Reactions.vote) return;
    if (Reactions.hasVoted && Reactions.hasVoted()) return;
    try { await Actions.perform("react.vote"); } catch (e) { return; }
    _reflectReactions();
  }
  // ★ button for a row (the room-queue now-playing row). Reflects Reactions.hasSaved():
  // ☆ outline when not yet saved this instance, ★ filled once saved. Acts on the current
  // song, so no videoId arg — it reads now-playing itself.
  function _starBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved();
    const _sc = _npCount("save");
    const b = el("button", { class: "mini ico grab np-react" + (on ? " on" : ""),
      title: !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song") },
      [el("span", { class: "np-ico", text: on ? "\u2605" : "\u2606" }),
       el("span", { class: "np-count" + (_sc.adjusted ? " adjusted" : ""), text: String(_sc.n), title: _sc.adjusted ? "owner-adjusted" : "" })]);
    b.disabled = !playing;
    b.onclick = _onStarPress;
    return b;
  }
  // ▲ upvote button for a row. Reflects Reactions.hasVoted().
  function _voteBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasVoted && Reactions.hasVoted();
    const _vc = _npCount("vote");
    const b = el("button", { class: "mini ico upvote np-react" + (on ? " on" : ""),
      title: !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song") },
      [el("span", { class: "np-ico", text: "\u25B2" }),
       el("span", { class: "np-count" + (_vc.adjusted ? " adjusted" : ""), text: String(_vc.n), title: _vc.adjusted ? "owner-adjusted" : "" })]);
    b.disabled = !playing;
    b.onclick = _onVotePress;
    return b;
  }
  // The derived vote/save count for the now-playing song (from the reducer's counts map),
  // plus whether it was owner-adjusted. { n, adjusted }. 0 when nothing is playing / uncounted.
  function _npCount(kind) {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    if (!np || !np.song || !np.song.videoId) return { n: 0, adjusted: false };
    const st = (typeof Queue !== "undefined" && Queue.getState) ? Queue.getState() : null;
    // KEYED ON THE PLAYING, not the song. Two plays of one track are two different moments in the
    // room and carry their own figures — which is also what makes the ★/▲ affordance agree with
    // the number beside it, since the affordance was always keyed on the instance.
    const c = st && st.counts ? st.counts[np.pi] : null;
    if (!c) return { n: 0, adjusted: false };
    return kind === "save"
      ? { n: c.saves || 0, adjusted: !!c.savesAdjusted }
      : { n: c.votes || 0, adjusted: !!c.votesAdjusted };
  }
  function _applyCount(span, kind) {
    if (!span) return;
    const c = _npCount(kind);
    span.textContent = String(c.n);
    span.title = c.adjusted ? "owner-adjusted" : "";
    span.classList.toggle("adjusted", c.adjusted);
  }
  // Keep the player-bar ★/▲ buttons in step with the current now-playing song: reflect
  // its latched add/vote state (from Reactions), and disable both when nothing is playing.
  function _syncNpButtons() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const R = (typeof Reactions !== "undefined") ? Reactions : null;
    _applyCount(refs.grabCount, "save");
    _applyCount(refs.upvoteCount, "vote");
    if (refs.grabBtn) {
      const on = playing && R && R.hasSaved && R.hasSaved();
      refs.grabBtn.disabled = !playing;
      refs.grabBtn.classList.toggle("on", !!on);
      if (refs.grabIco) refs.grabIco.textContent = on ? "\u2605" : "\u2606";
      refs.grabBtn.title = !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song");
    }
    if (refs.upvoteBtn) {
      const on = playing && R && R.hasVoted && R.hasVoted();
      refs.upvoteBtn.disabled = !playing;
      refs.upvoteBtn.classList.toggle("on", !!on);
      refs.upvoteBtn.title = !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song");
    }
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
    _plConfirmDelete = null;
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
      || _plConfirmDelete || _uqConfirmClear;
    _settingsLocked = true;
    _prefsLocked = true;
    _resetQueueLocks();
    if (settingsOpen) renderSettings();
    if (prefsOpen) renderChatSettings();
    if (queueOpen) renderQueuePanel();
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
      confirmBtn.onclick = () => { _uqConfirmClear = false; UserQueue.clearQueue(); renderJoinBtn(); };
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
  // ══ JOIN BUTTON, ROSTER, UPGRADE
  //
  // The responsive Join text-ladder, the people list, rank assignment and the batch upgrade.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // Longest→shortest label ladders for the Join/Leave button. _fitJoinLabel steps
  // down until the player-control row stops overflowing, so the button yields
  // horizontal space and never wraps to a second line (fixed height). Full label
  // stays as the tooltip. Re-run on render, layout change, and window resize.
  const _JOIN_LADDER  = ["Join the DJ queue", "Join DJ queue", "Join queue", "Join", "JQ"];
  const _LEAVE_LADDER = ["Leave the DJ queue", "Leave DJ queue", "Leave queue", "Leave", "LQ"];
  function _fitJoinLabel(active) {
    const btn = refs.joinBtn;
    if (!btn) return;
    const ladder = active ? _LEAVE_LADDER : _JOIN_LADDER;
    btn.title = ladder[0];
    const row = btn.closest ? btn.closest(".playback-controls") : null;
    for (let i = 0; i < ladder.length; i++) {
      btn.textContent = ladder[i];
      if (i === ladder.length - 1) break;                 // shortest is the floor
      if (!row) break;                                    // not mounted yet — keep longest
      if (row.scrollWidth <= row.clientWidth + 1) break;  // fits without overflowing the row
    }
    if (!_joinResizeWired) {
      _joinResizeWired = true;
      let _rt;
      window.addEventListener("resize", () => {
        clearTimeout(_rt);
        _rt = setTimeout(() => { if (refs.joinBtn) _fitJoinLabel(UserQueue.isActive()); }, 120);
      });
    }
  }

  function renderJoinBtn() {
    if (!refs.joinBtn) return;
    const active = UserQueue.isActive();
    const stackLeft = UserQueue.stackCount ? UserQueue.stackCount() : 0;

    refs.joinBtn.classList.remove("active", "dropped", "refilling");

    // The Join/Leave label shortens under horizontal pressure instead of stacking or
    // growing the row — see _fitJoinLabel (a longest→shortest ladder that steps down
    // until the player-control row stops overflowing). Fixed height; full text stays
    // as the tooltip.
    if (active) {
      // In the rotation, or actively (re)joining — auto-feed is on.
      refs.joinBtn.classList.add("active");
      refs.joinBtn.disabled = false;
    } else {
      // Not in the rotation — whether we never joined or just ran out.
      // Joining with nothing to play would put us in as an invisible member that
      // never rotates, so require at least one queued song before Join is live.
      refs.joinBtn.disabled = stackLeft === 0;
    }
    _fitJoinLabel(active);

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
  // THE USER CARD (J14)
  // ---------------------------------------------------------------------------
  // Click a person anywhere they appear — chat, the people list, the room queue —
  // and get their profile plus every action you are permitted against them. This is
  // the CONTAINER J15 (the DM panel) and J16 (who-is-here) plug into, which is why
  // it is built before either.
  //
  // ── THE CARD DECIDES NOTHING, AND THE LIST IS WHY ────────────────────────────
  // Every control comes out of one declared table, `_CARD_ACTIONS`, and each row is
  // rendered from whatever `Actions.describe` says about it — enabled, reason, and
  // nothing else. There is no rank comparison here, no `Capabilities` call, and no
  // per-control branch that could quietly become a rule. Adding a moderation action
  // means adding a row to that table and a gate to `Ranks.GATES`; it does not mean
  // editing this function.
  //
  // ── THE DM SLOT IS DECLARED AND NOT YET BUILT, DELIBERATELY ──────────────────
  // J14's entry lists "open a DM" among the card's actions and names J15 as the job
  // that builds the panel. A button wired to a feature that does not exist is the
  // "prose describing code nobody wrote" failure (`08-build-and-deploy.md`
  // §Deciding what is dead), and a permanently dead control teaches people to ignore
  // the card. So the row EXISTS in the table and renders only when the adapter knows
  // the action: `_cardActions()` filters against `Actions.ACTIONS`. J15 adds one
  // catalog entry and the control appears with NO change to this file — which is the
  // whole claim of "the container J15 plugs into", made checkable rather than
  // asserted. `check-user-card` PART E drives it both ways.
  //
  // ── A REMOVAL IS NOT A ROTATION REMOVAL ──────────────────────────────────────
  // `dj.remove` (already on the room-queue rows) drops somebody from the DJ ROTATION
  // and is a Spine event every client folds. `member.kick` removes them from the
  // MATRIX ROOMS and no reducer ever sees it. Two different acts, adjacent on this
  // card, and the labels have to keep them apart — see `roles.md` §6.
  const _CARD_ACTIONS = [
    { action: "member.kick", label: "Remove from room",
      confirm: (m) => "Remove " + m.name + " from this room?",
      note: "They are removed from all of this room's channels now. It does not keep them out.",
      danger: false },
    { action: "member.ban", label: "Ban",
      confirm: (m) => "Ban " + m.name + " from this room?",
      note: "They are removed and cannot come back unless the ban is lifted.",
      danger: true },
    // J15 filled this slot with one catalog entry, exactly as J14 said it would — the
    // `action`/`label`/`confirm`/`note`/`danger` shape above needed no change. `closeOnRun`
    // is the ONE field J15 added, and it is here rather than in the adapter because it is
    // presentation: a DM opens a panel BEHIND this overlay, so a card that stayed up would
    // cover the thing the click just opened. The moderation rows do not take it — their
    // result is a verdict the person has to read.
    { action: "chat.dm", label: "Message",
      confirm: null, note: null, danger: false, closeOnRun: true },
  ];

  // Only rows the adapter actually knows. An action the adapter has never heard of
  // would describe as "Unknown action" and render a control that can never work.
  function _cardActions() {
    const known = (typeof Actions !== "undefined" && Actions.ACTIONS) ? Actions.ACTIONS : [];
    return _CARD_ACTIONS.filter((row) => known.indexOf(row.action) >= 0);
  }

  let _userCard = null;
  function _closeUserCard() {
    if (_userCard) { try { _userCard.remove(); } catch (e) {} _userCard = null; }
  }

  // ONE trigger, used by every surface a person appears in — the roster, a chat
  // sender, the now-playing DJ, a queue row's DJ. Written once because the affordance
  // has to be identical everywhere ("click a person ANYWHERE they appear"), and four
  // hand-wired copies is four places for the keyboard path to be forgotten in three
  // of them. `level` is optional: the roster carries one, the other surfaces resolve
  // it from the roster, and 0 is the fallback for somebody not in it yet.
  function _wireCardTrigger(node, userId, level) {
    if (!node || !userId) return node;
    const lvl = (typeof level === "number") ? level : _rosterLevel(userId);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.classList.add("uc-trigger");
    node.onclick = () => openUserCard({ userId: userId, name: shortName(userId), level: lvl });
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); node.onclick(); }
    };
    return node;
  }

  // Mount point, split out so the guard can drive `openUserCard` without a document.
  function _cardMount(node) {
    _closeUserCard();
    _userCard = node;
    document.body.appendChild(node);
  }

  function openUserCard(member) {
    if (!member || !member.userId) return;
    const m = {
      userId: member.userId,
      name: member.name || shortName(member.userId),
      level: typeof member.level === "number" ? member.level : 0,
    };

    const result = el("div", { class: "uc-note muted" });

    // --- head: avatar, name, rank. Display uses of rank only — a name and a colour
    // decide nothing, which is the line `check-ui-no-permission` draws.
    const nameEl = el("span", { class: "uc-name", text: m.name });
    nameEl.style.color = rankColor(m.level);
    const head = el("div", { class: "uc-head" }, [
      avatarEl(m.userId, 40),
      el("div", { class: "uc-id" }, [
        nameEl,
        el("span", { class: "rank-tag", text: rankName(m.level) }),
      ]),
    ]);

    const body = el("div", { class: "uc-body" });

    // --- rank change. The control the tree already had; it keeps its own shape
    // (a select of grantable levels) because WHICH levels may be granted is a
    // second question the descriptor answers per-level.
    if (Actions.describe("rank.assign", { userId: m.userId, targetRank: m.level }).enabled) {
      const row = el("div", { class: "uc-row" }, [el("span", { class: "uc-label", text: "Rank" })]);
      row.appendChild(rankSelect(m.level, async (lvl) => {
        try { await Actions.perform("rank.assign", { userId: m.userId, targetRank: m.level, newLevel: lvl }); }
        catch (e) { result.textContent = e.message || "Couldn't change that rank."; }
      }));
      body.appendChild(row);
    }

    // --- the moderation and messaging actions, every one of them rendered from its
    // descriptor. A denied action is shown DISABLED with the backend's own reason as
    // the tooltip rather than hidden, so somebody who cannot act can see why — the
    // hide-vs-disable choice is presentation and stays here (`10-capabilities.md`).
    for (const spec of _cardActions()) {
      const d = Actions.describe(spec.action, { userId: m.userId, targetRank: m.level });
      const btn = el("button", {
        class: "uc-action" + (spec.danger ? " uc-danger" : ""),
        text: d.label || spec.label,
      });
      btn.dataset.action = spec.action;
      btn.disabled = !d.enabled;
      if (!d.enabled && d.reason) btn.title = d.reason;
      if (d.enabled) {
        btn.onclick = () => _runCardAction(spec, m, btn, result);
      }
      body.appendChild(btn);
    }

    const close = el("button", { class: "mini", text: "Close", onclick: _closeUserCard });
    const card = el("div", { class: "uc-card" }, [head, body, result, el("div", { class: "uc-foot" }, [close])]);
    const overlay = el("div", { class: "uc-overlay" }, [card]);
    overlay.onclick = (e) => { if (e.target === overlay) _closeUserCard(); };
    _cardMount(overlay);
  }

  // Two-step for anything with a confirm string. The 5s misclick locks elsewhere in
  // this file are a timer; this is a deliberate second click, because a removal has
  // no undo the way a mis-struck song does.
  //
  // AND THE RESULT IS REPORTED AS THE BACKEND STATES IT. `Room.ban`/`Room.kick`
  // return a verdict across the room set, and a PARTIAL is the case J14's entry says
  // will bite on day one — twenty rooms closed and one open is not a success, so this
  // never prints one. The count comes out of the verdict rather than being assumed
  // from the absence of a throw.
  function _runCardAction(spec, m, btn, result) {
    if (spec.confirm && btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = "Confirm";
      btn.title = spec.confirm(m);
      result.textContent = spec.note || "";
      setTimeout(() => {
        if (btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = spec.label; btn.title = ""; }
      }, 5000);
      return;
    }
    btn.dataset.armed = "";
    btn.disabled = true;
    btn.textContent = "Working…";
    Actions.perform(spec.action, { userId: m.userId, targetRank: m.level })
      .then((res) => {
        // An action that opens a surface of its own closes the card instead of reporting into
        // it. Checked BEFORE the verdict branch below, because that branch's wording is about a
        // room set — "N of M channels done" is a true sentence about a ban and a false narrative
        // about anything else, which is `roles.md` §10's second signature. An action whose result
        // is not a room-set verdict must not reach it.
        if (spec.closeOnRun) {
          _closeUserCard();
          // ── AND FOR `chat.dm`, GO WHERE IT OPENED ─────────────────────────────────────────
          // "Opens a surface of its own" was doing half the job: `Chat.openDM` creates or finds
          // the room and returns its id, the card closed, and **nothing moved** — the person was
          // left looking at the panel they started on with a conversation waiting somewhere they
          // could not see it. The action's job is the ROOM; landing in it is the panel's.
          //
          // Driven off the RETURNED room id rather than the action name plus a lookup: a second
          // `findDMRoom` here could disagree with the one the action just used.
          if (spec.action === "chat.dm" && res && res.ok !== false && res.roomId) {
            _openDMFromAction(res.roomId);
          }
          return;
        }
        if (res && res.ok === false) {
          const open = (res.failed || []).concat(res.unverified || []).length;
          result.textContent = "Not finished: " + (res.closed || 0) + " of " + (res.total || 0) +
            " channels done, " + open + " still open. Try again — repeating it is safe.";
          btn.disabled = false; btn.textContent = spec.label;
          return;
        }
        if (res && res.reentry === "open") {
          result.textContent = "Removed. This room is public, so they can come back in.";
        } else {
          result.textContent = "Done.";
        }
        btn.textContent = spec.label;
      })
      .catch((e) => {
        result.textContent = (e && e.message) || "That didn't work.";
        btn.disabled = false; btn.textContent = spec.label;
      });
  }

  // ---------------------------------------------------------------------------
  // THE DM PANEL (J15)
  // ---------------------------------------------------------------------------
  // A list of recent conversations, scrollable, each opening into a one-to-one
  // chat, with an incoming message raising a notification in the panel itself.
  //
  // ── THE PANEL DECIDES NOTHING, AND THE FEATURE IS WHY ────────────────────────
  // Every row comes from `Chat.conversations()` and every unread mark comes from
  // the same row's own flag. There is no rank here, no `Capabilities` call, and no
  // second copy of "is this conversation unread" — the read marker lives in
  // `ChatPrefs` beside the index it marks, so the badge and the row can never
  // disagree. Sending is `Chat.sendDM`, which returns the same `{ok, reason}`
  // status room chat does, so a refusal renders instead of vanishing.
  //
  // ── WHAT IS PERSISTED, AND WHAT IS NOT ───────────────────────────────────────
  // The message list rendered here is RAM only, exactly like room chat: reload and
  // it is gone, and one capped backfill per conversation is the whole history
  // policy. What survives a reload is the conversation INDEX — who and when, never
  // what — which is what makes this list non-empty on a second visit. `Clear` drops
  // it. See `core/chatprefs.js`, which holds the reasoning and the cap.
  //
  // ── NOT WINDOWED, DELIBERATELY ───────────────────────────────────────────────
  // `core/windowedlist.js` is the tool for a list that can grow without bound. This
  // one cannot: the index is capped at `ChatPrefs.DM_CAP`, so the row count has a
  // ceiling and a plain scrollable container is the honest amount of machinery.
  // The message view is bounded the same way room chat's is.
  // ── AN INBOX DOES NOT REMEMBER WHERE YOU WERE (v274) ──────────────────────────────────────
  // Resuming the last conversation is right for a ROOM — you were doing something there and want
  // it back. It is wrong for an inbox, where the reason to open the tab is almost always to see
  // what has arrived, and landing inside one conversation hides every other one behind a back
  // button. `_dmResetToList()` is called when the tab is shown, so the view is a property of
  // OPENING the panel rather than of the last thing that happened in it.
  let _dmView = "list";     // "list" | "convo"
  let _dmRows = [];         // the last rendered conversation list (RAM)
  let _dmMessages = [];     // messages of the OPEN conversation (RAM only, capped)
  let _dmNewError = "";     // the last refusal from starting a DM by id, shown not swallowed
  let _dmBackfilled = 0;    // how many messages the last fetch ASKED for — stated, not guessed
  const DM_BACKFILL_STEP = 50;
  const DM_MSG_CAP = 500;

  // Pure: fold one arriving message into the RAM view. Split out and named so the
  // cap and the non-downgrading upsert are reachable by a guard rather than being
  // asserted as source text — the same reason `ChatBuffer`'s helpers are.
  function _dmFoldMessage(list, msg, cap) {
    const max = (typeof cap === "number" && cap > 0) ? cap : DM_MSG_CAP;
    const out = (Array.isArray(list) ? list : []).slice();
    // ── THE TRANSITION RULES ARE `ChatBuffer`'s, NOT A COPY OF THEM (gap 4) ──────────────────
    // This used to say *"Same rule as ChatBuffer"* in a comment and then implement it again — the
    // non-downgrade test, one line, restated. J11 then added a THIRD state (`redacted`, orthogonal
    // to `failed`, admitting real→redacted and refusing redacted→real) to `ChatBuffer` and **the
    // DM path inherited none of it**, because a comment saying "same rule" is not the same rule.
    // That is the duplication category this project has recorded four times, and the guard
    // covering the first copy could not reach the second.
    //
    // So the list is folded THROUGH a real `ChatBuffer` and the rules are read from where they
    // live: a late decryption failure still cannot clobber real text, a redaction is terminal, a
    // tombstone holds no body, and `keepTs` preserves the slot — none of it written here. The
    // buffer is rebuilt per fold, which is O(n) against a cap of 200 and buys one definition.
    const b = ChatBuffer.create();
    for (const m of out) b.upsert(m.id, m.sender, m.body, m.failed, m.ts, m.redacted);
    if (msg && msg.redact) b.redact(msg.id);
    else if (msg && msg.id) b.upsert(msg.id, msg.sender, msg.body, msg.failed, msg.ts, msg.redacted);
    const rows = b.ids().map((i) => b.get(i));
    return rows.length > max ? rows.slice(rows.length - max) : rows;
  }

  // The unread badge on the DM tab. Reads the feature's count; renders nothing when
  // it is zero rather than a "0", because a zero badge trains people to ignore it.
  function _renderDMBadge() {
    if (!refs.tabDM) return;
    let n = 0;
    try { n = (typeof Chat !== "undefined" && Chat.dmUnreadCount) ? Chat.dmUnreadCount() : 0; } catch (e) { n = 0; }
    refs.tabDM.textContent = n > 0 ? ("DMs " + (n > 9 ? "9+" : n)) : "DMs";
    refs.tabDM.classList.toggle("has-unread", n > 0);
  }

  function renderDMPanel() {
    const box = refs.dmBox;
    if (!box) return;
    clear(box);
    _renderDMBadge();
    if (_dmView === "convo") { _renderDMConvo(box); return; }

    let rows = [];
    try { rows = (typeof Chat !== "undefined" && Chat.conversations) ? Chat.conversations() : []; }
    catch (e) { rows = []; }
    _dmRows = rows;

    const head = el("div", { class: "dm-head" }, [
      el("span", { class: "dm-title", text: "Direct messages" }),
    ]);
    if (rows.length > 0) {
      head.appendChild(el("button", {
        class: "mini", text: "Clear list",
        title: "Forget which conversations you have had on this device. No messages are stored.",
        onclick: () => { try { Chat.clearConversations(); } catch (e) {} renderDMPanel(); },
      }));
    }
    box.appendChild(head);

    if (rows.length === 0) {
      box.appendChild(el("p", { class: "muted",
        text: "No conversations yet. Click a person anywhere they appear and choose Message." }));
      return;
    }

    const list = el("div", { class: "dm-list" });
    for (const r of rows) {
      // ── THE ROOM LIST'S ROW SHAPE, REUSED (v273) ──────────────────────────────────────────
      // DMs were bare names on a background — no box, no avatar, and only a short name, so two
      // people whose names truncate the same way were indistinguishable. `.room-item` is the
      // established row: a bordered box with its own background and hover. Reused rather than
      // invented, which would have been a fifth row shape in a file that already has four.
      //
      // THE FULL MATRIX ID IS SHOWN under the short name, because it is the only thing that
      // actually identifies a person — a display name is chosen by them and is not unique.
      const nameEl = el("span", { class: "dm-who", text: shortName(r.userId) });
      const idEl = el("span", { class: "dm-full-id", text: r.userId });
      const who = el("div", { class: "dm-who-col" }, [nameEl, idEl]);
      const row = el("div", { class: "room-item dm-row" + (r.unread ? " unread" : "") }, [
        avatarEl(r.userId, 28),
        who,
        el("span", { class: "dm-when", text: r.lastTs ? _fmtAgo(r.lastTs) : "" }),
      ]);
      if (r.unread) row.appendChild(el("span", { class: "dm-dot", text: "●", title: "New message" }));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.onclick = () => _openDMConversation(r.roomId);
      row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onclick(); } };
      list.appendChild(row);
    }
    // ── PENDING REQUESTS (gap 1) ────────────────────────────────────────────────────────────
    // A room somebody else invited us to is not in `m.direct`, so it never reached DM scope and a
    // stranger's first message arrived NOWHERE. It is offered here as a decision, NOT bound:
    // binding on arrival would let anyone put a room into this account's DM scope by inviting it,
    // and scope is the only thing the DM receive filter tests.
    let invites = [];
    try { invites = Chat.dmInvites() || []; } catch (e) { invites = []; }
    if (invites.length) {
      box.appendChild(el("div", { class: "dm-requests-head",
        text: invites.length === 1 ? "1 message request" : invites.length + " message requests" }));
      for (const inv of invites) {
        const who = el("span", { class: "dm-who", text: inv.from ? shortName(inv.from) : "someone" });
        if (inv.from) _wireCardTrigger(who, inv.from);
        const acc = el("button", { class: "mini", text: "Accept",
          onclick: () => { Promise.resolve(Chat.acceptDMInvite(inv.roomId)).then(() => renderDMPanel(), () => renderDMPanel()); } });
        const dec = el("button", { class: "mini", text: "Decline",
          onclick: () => { Promise.resolve(Chat.declineDMInvite(inv.roomId)).then(() => renderDMPanel(), () => renderDMPanel()); } });
        box.appendChild(el("div", { class: "dm-request" }, [who, acc, dec]));
      }
      box.appendChild(el("p", { class: "muted dm-requests-note",
        text: "Nothing sent to you here reaches your conversations until you accept." }));
    }

    box.appendChild(list);

    // ── START ONE BY USER ID (gap 3) ────────────────────────────────────────────────────────
    // `openDM` has always refused `no-user` and `self`; no surface could reach either. The refusal
    // is shown rather than swallowed — a typo'd id must fail VISIBLY, because the alternative is a
    // room created with nobody in it and a conversation that looks open and is not.
    const idInput = el("input", { class: "dm-new-id", placeholder: "@someone:server" });
    const go = el("button", { class: "mini", text: "Start", onclick: () => {
      const v = String(idInput.value || "").trim();
      _startDMByUserId(v);
    } });
    box.appendChild(el("div", { class: "dm-new" }, [idInput, go]));
    if (_dmNewError) box.appendChild(el("p", { class: "muted dm-new-error", text: _dmNewError }));
  }

  // The refusals, named. `openDM` answers a reason and this turns each into a sentence — an
  // unnamed failure is what makes a typo look like a working conversation.
  function _startDMByUserId(userId) {
    _dmNewError = "";
    if (!userId) { _dmNewError = "Type a user id, like @someone:server."; renderDMPanel(); return; }
    if (userId.indexOf("@") !== 0 || userId.indexOf(":") < 2) {
      _dmNewError = "That is not a user id. They look like @someone:server.";
      renderDMPanel(); return;
    }
    Promise.resolve(Chat.openDM(userId)).then((res) => {
      if (res && res.ok) { _dmNewError = ""; _openDMConversation(res.roomId); return; }
      const why = (res && res.reason) || "failed";
      _dmNewError = why === "self" ? "That is you."
        : why === "no-user" ? "Type a user id, like @someone:server."
        : "Could not start that conversation. Check the id and that the server knows them.";
      renderDMPanel();
    }, () => { _dmNewError = "Could not start that conversation."; renderDMPanel(); });
  }

  // The inbox's default state. Closing the open conversation matters as much as changing the view:
  // leaving `Chat`'s room bound would keep a conversation receiving into a panel showing the list.
  function _dmResetToList() {
    if (_dmView !== "convo") return;
    _dmView = "list";
    _dmMessages = [];
    try { Chat.closeDM(); } catch (e) {}
  }

  // ── OPEN A CONVERSATION AND LAND IN IT (v274) ─────────────────────────────────────────────
  // The user card's Message button ran `chat.dm`, which creates or finds the room — and then
  // nothing moved. The action's job is the ROOM; landing the person in it is the panel's, and no
  // one was doing it. This is the panel's half, callable from anywhere that has a room id.
  function _openDMFromAction(roomId) {
    if (!roomId) return;
    rightTab = "dm";
    _relockAllPanels();
    _openDMConversation(roomId);
    renderRightPanel();
  }

  function _openDMConversation(roomId) {
    let res = { ok: false };
    try { res = Chat.openDMRoom(roomId) || { ok: false }; } catch (e) { res = { ok: false }; }
    if (!res.ok) { renderDMPanel(); return; }
    _dmView = "convo";
    _dmMessages = [];
    _dmBackfilled = DM_BACKFILL_STEP;
    renderDMPanel();
    // One capped backfill, present-forward after — the same policy room chat has.
    try {
      Promise.resolve(Chat.backfillDM(DM_BACKFILL_STEP)).then((r) => {
        for (const m of ((r && r.messages) || [])) _dmMessages = _dmFoldMessage(_dmMessages, m, DM_MSG_CAP);
        if (_dmView === "convo") renderDMPanel();
      }).catch(() => {});
    } catch (e) {}
  }

  // Ask for more of the same conversation. Doubles rather than paginating, because
  // `recentChatMessages` takes a COUNT and not a cursor — asking for twice as many and re-folding
  // is the honest use of the seam that exists, and `_dmFoldMessage` deduplicates by id so the
  // overlap costs nothing. What is NOT claimed is that this reaches the beginning: it reaches
  // further, and the note says which.
  function _loadEarlierDM() {
    const want = _dmBackfilled * 2;
    try {
      Promise.resolve(Chat.backfillDM(want)).then((r) => {
        _dmBackfilled = want;
        for (const m of ((r && r.messages) || [])) _dmMessages = _dmFoldMessage(_dmMessages, m, DM_MSG_CAP);
        renderDMPanel();
      }, () => {});
    } catch (e) {}
  }

  // A redaction ARRIVING for a DM. Routed through `_dmFoldMessage`, so the transition rules are
  // `ChatBuffer`'s — the same ones room chat uses — rather than a second copy here.
  function _dmRedactionArrived(redactedId) {
    if (!redactedId) return;
    _dmMessages = _dmFoldMessage(_dmMessages, { id: redactedId, redact: true }, DM_MSG_CAP);
    renderDMPanel();
  }

  // Sending one. The row goes when the redaction comes BACK through the door, not optimistically —
  // same rule as room chat, so this client is not the one place a failed deletion looks like
  // success.
  async function _deleteDMMessage(eventId) {
    if (!eventId) return;
    let res;
    try { res = await Chat.dmRedact(eventId); }
    catch (e) { res = { ok: false }; }
    if (!res || !res.ok) _setChatNote("That deletion did not go through.");
    else _setChatNote(CHAT_DELETE_NOTE);
  }

  function _renderDMConvo(box) {
    const who = (_dmRows.find((r) => r.roomId === (Chat.currentDM && Chat.currentDM())) || {}).userId || "";
    const back = el("button", { class: "mini", text: "← Conversations", onclick: () => {
      try { Chat.closeDM(); } catch (e) {}
      _dmView = "list"; _dmMessages = []; renderDMPanel();
    } });
    box.appendChild(el("div", { class: "dm-head" }, [back, el("span", { class: "dm-title", text: shortName(who) })]));

    const msgs = el("div", { class: "dm-msgs" });
    for (const m of _dmMessages) {
      if (m.failed) continue;   // an undecryptable message is hidden, as in room chat
      // `sender` is the chat panel's own name styling; `dm-sender` keeps only the flex behaviour
      // a DM row needs, so there is one rule deciding what a name looks like in this app.
      // THE SAME BUILDER ROOM CHAT USES. Every branch that used to live here — the sender span,
      // the tombstone, the own-rows-only delete — was the same decision written twice.
      msgs.appendChild(_chatRow(msgs, m, { rowClass: "dm-msg", onDelete: _deleteDMMessage }));
    }
    // ── WHAT THIS CONVERSATION IS NOT SHOWING (gap 2) ───────────────────────────────────────
    // `backfillDM` IS called on open — with 50, not the room-chat 10 — so the brief's premise was
    // half right: the start of a conversation is not unreached because nothing asks, it is
    // unreached because **nothing asks TWICE**. One capped fetch, present-forward after, and no
    // way back. Stated rather than implied, and a control that asks for more.
    if (_dmMessages.length >= _dmBackfilled) {
      box.appendChild(el("p", { class: "muted dm-earlier-note",
        text: "Showing the most recent " + _dmBackfilled + " messages. Earlier ones are not loaded." }));
      box.appendChild(el("button", { class: "mini", text: "Load earlier messages",
        onclick: () => _loadEarlierDM() }));
    }
    box.appendChild(msgs);

    const note = el("div", { class: "dm-note muted" });
    // ── THE CHAT PANEL'S OWN CLASSES, NOT A SECOND SET (browser run) ───────────────────────
    // `.dm-input` declared only `flex: 1; min-width: 0` — no background, colour, border, padding
    // or font-size — so it rendered as a browser-default white box with black text beside a
    // dark-themed panel. `.dm-input-row button` had NO RULE AT ALL, so Send was a bare default
    // button. Both are solved already by `.chat-input` and `.chat-input-row button` one panel over.
    //
    // WHY NOT A NEW RULE: there is nothing about a DM composer that differs from a chat composer —
    // same width behaviour, same dark field, same send affordance. A second set of declarations
    // would be two descriptions of one appearance, free to drift the next time either is touched.
    // `dm-input` / `dm-input-row` stay on the elements so the DM-specific gap rule still applies.
    const input = el("input", { class: "dm-input chat-input", type: "text", placeholder: "Message…" });
    const doSend = async () => {
      const text = input.value;
      if (!text || !text.trim()) return;
      let res = { ok: false, reason: "send-failed" };
      try { res = await Chat.sendDM(text); } catch (e) { res = { ok: false, reason: "send-failed" }; }
      if (res.ok) { input.value = ""; note.textContent = ""; return; }
      note.textContent = res.reason === "no-crypto"
        ? "Secure chat is offline — the message was not sent."
        : "That didn't send. Try again.";
    };
    input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };
    box.appendChild(note);
    box.appendChild(el("div", { class: "dm-input-row chat-input-row" },
      [input, el("button", { text: "Send", onclick: doSend })]));
  }

  // The notification. A message in the OPEN conversation is rendered; one in any
  // other conversation moves the index and repaints the list, which is what makes
  // the badge and the row's dot appear without the person doing anything. Wired in
  // `enterMainScreen` beside the room-chat wiring.
  function _wireDMPanel() {
    if (typeof Chat === "undefined" || !Chat.onDMMessage) return;
    Chat.onDMRedaction(_dmRedactionArrived);
    Chat.onDMMessage((id, sender, body, failed, ts) => {
      _dmMessages = _dmFoldMessage(_dmMessages, { id, sender, body, failed, ts }, DM_MSG_CAP);
      if (rightTab === "dm" && _dmView === "convo") renderDMPanel();
    });
    Chat.onDMChange(() => {
      _renderDMBadge();
      if (rightTab === "dm") renderDMPanel();
    });
  }

  // ══ WHO HAS DONE SOMETHING RECENTLY (J16) ═══════════════════════════════════════════════════
  // Three declarations, extracted by name and EXECUTED by `check-who-is-here` — the fifth guard in
  // the tree to run this file rather than read it, after `check-blocked-wire`, `check-playback-end`
  // part 5, `check-user-card` and `check-dm-panel`. Nine guards read `ui/interface.js` as source
  // text and a regex proving a sentence is SPELLED here would prove nothing about whether the
  // panel ever says it.

  // Pure. A duration in server-stamp milliseconds as words. Rounds DOWN, so the panel never claims
  // to have looked further back than it did — the same direction every bound in this feature takes.
  function _spanText(ms) {
    const m = Math.floor((typeof ms === "number" && isFinite(ms) && ms > 0 ? ms : 0) / 60000);
    if (m < 1) return "less than a minute";
    if (m === 1) return "1 minute";
    if (m < 60) return m + " minutes";
    const h = Math.floor(m / 60), r = m % 60;
    const hs = h === 1 ? "1 hour" : h + " hours";
    return r === 0 ? hs : hs + " " + (r === 1 ? "1 minute" : r + " minutes");
  }

  // Pure. Turns one fold into the strings the panel shows. Separate from the renderer so the
  // HONESTY of the label can be driven directly, which is the whole reason this job exists: the
  // Done-when asks that the list be honestly labelled, and a label is a claim about behaviour like
  // any other (`roles.md` §10's second signature).
  //
  // THE STATED SPAN IS THE EFFECTIVE WINDOW, NEVER THE REQUESTED ONE. That single substitution is
  // what keeps the panel from claiming a reach it does not have, and it is the line the mutation
  // pass aims at: with the requested window here, a freshly-loaded or freshly-trimmed room says
  // "in the last 15 minutes" over a log holding four, which is true of nothing and reads as fact.
  function _activityLabel(fold) {
    const f = fold || {};
    const people = Array.isArray(f.people) ? f.people : [];
    const n = people.length;
    const span = _spanText(f.effectiveWindowMs);
    return {
      count: n,
      heading: n === 1 ? "1 person active" : n + " people active",
      // The claim, and it is deliberately about ACTIVITY rather than presence. There is no presence
      // protocol here, so "who is here" is not a question this system can answer at all.
      window: n === 0 ? ("Nobody has done anything in the last " + span)
                      : ("Did something in the last " + span),
      // Named BOTH ways round when the window is wider than what this client holds, because the
      // discrepancy is the information: one number is what you asked for and the other is what
      // there was to look at. A young room reaches this the same way a trimmed one does.
      reachNote: f.bounded
        ? ("Your window is " + _spanText(f.requestedWindowMs) + ", but this client holds only " +
           _spanText(f.reach) + " of this room — anything older has been forgotten or was never seen.")
        : "",
      // THE LIMIT, STATED RATHER THAN IMPLIED. Chat is Skin: `_routeEvent` skips chat-named rooms
      // before both the store and the fold, so a chat message reaches the raw listeners and nothing
      // else and a person who has only chatted is invisible here. Three of the four sources J16's
      // entry names, and saying "activity" without saying which would imply the fourth.
      // ── THE ROOM DECIDES WHAT COUNTS; THIS DEVICE DECIDES HOW FAR BACK IT LOOKS ─────────────
      // Two settings, two questions, and until this was settled they were two ANSWERS to one
      // question — the panel counted from a device-local window while `botPresenceSpine` /
      // `botPresenceChat` / `botAfkMs` are room truth, so the People list and a bot's channel
      // membership would list different people, each correct by its own rule.
      //
      // The rule is now READ FROM THE ROOM and stated here, so a person can see which definition
      // produced the list rather than assuming the only one they know about.
      sources: (f.sources && f.sources.spine === false)
        ? "This room is not counting queue activity, so nobody is listed as around."
        : "Counts queue actions, votes and saves, as this room defines being around. Actions the " +
          "room refused are not counted.",
      // AND WHERE THIS PANEL CANNOT HONOUR THE ROOM'S RULE, IT SAYS SO INSTEAD OF IMPLYING
      // AGREEMENT. `botPresenceChat` is not a filter the fold is missing — chat never reaches the
      // log and cannot, so a room counting chat has a definition of *active* this panel is
      // structurally incapable of computing. The list is then a SUBSET, and a person comparing it
      // with what a bot does needs to know that before they conclude one of them is wrong.
      unobservable: (f.unobservable && f.unobservable.length)
        ? "This room also counts chat as being around, and this list cannot see chat — so it shows " +
          "fewer people than the room considers active. The difference is not a fault in either."
        : "",
    };
  }

  // The panel. Renders what the feature layer hands it and decides nothing: it does not filter by
  // window, does not compute recency, and does not sort — every one of those is `Room.foldActivity`'s
  // and a second copy here is the drift P7 is about.
  function renderActivePanel() {
    if (!refs.activeBox) return;
    clear(refs.activeBox);
    // ServerClock, never Date.now() (P2). Every `ts` in the log is the homeserver's stamp, so the
    // reference this is measured against has to be one too. With no offset learned yet serverNow()
    // degrades to the local clock, which is this client's best available answer and never worse
    // than what it does today.
    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
    // NO WINDOW SUPPLIED. `recentlyActive` reads the room's rule — window and sources both — so
    // there is nothing for this panel to disagree through.
    let fold;
    try { fold = Room.recentlyActive(now); }
    catch (e) { return; }
    const lab = _activityLabel(fold);

    refs.activeBox.appendChild(el("div", { class: "active-head", text: lab.heading }));
    refs.activeBox.appendChild(el("p", { class: "muted active-window", text: lab.window }));
    if (lab.reachNote) {
      refs.activeBox.appendChild(el("p", { class: "muted active-reach", text: lab.reachNote }));
    }
    for (const p of (fold.people || [])) {
      const nameEl = el("span", { class: "who", text: shortName(p.userId) });
      nameEl.style.color = rankColor(_rosterLevel(p.userId));
      // The same one trigger every surface uses (J14), so the card and its keyboard path cannot be
      // right in four places and forgotten in the fifth.
      _wireCardTrigger(nameEl, p.userId);
      refs.activeBox.appendChild(el("div", { class: "person active-person" }, [
        nameEl,
        el("span", { class: "active-acts", text: p.acts === 1 ? "1 action" : p.acts + " actions" }),
      ]));
    }
    refs.activeBox.appendChild(el("p", { class: "muted active-sources", text: lab.sources }));
    if (lab.unobservable) {
      refs.activeBox.appendChild(el("p", { class: "muted active-unobservable", text: lab.unobservable }));
    }
  }

  // ══ THE EVENT FEED (J13) ════════════════════════════════════════════════════════════════════
  // Three declarations, extracted by name and EXECUTED by `check-event-feed` — the sixth guard in
  // the tree to run this file rather than read it. Same argument as J16's panel directly above:
  // the subject is a SENTENCE about what the feed can and cannot show, and a regex proving one is
  // spelled here proves nothing about whether it is ever rendered.
  //
  // THE PANEL DECIDES NOTHING. It does not filter refused events, does not choose which kinds are
  // named, does not sort, and does not work out which kind of empty it is looking at — all four
  // are `Room.foldFeed`'s, and a second copy here is the drift P7 is about.

  // Pure. One feed row -> the line the panel shows. `nowTs` is a SERVER stamp and there is no
  // fallback to a device clock (P2): the row's own `ts` is the homeserver's, so the reference it
  // is subtracted from has to be one too. `_fmtAgo` in the history pane defaults to `Date.now()`
  // when it is handed nothing; this deliberately does not, because a feed rendered against a
  // device clock in a room whose server is minutes off produces "3 mins ago" for something that
  // just happened, which is exactly the plausible value P2 is about.
  function _feedRowText(row, nowTs) {
    const r = row || {};
    const who = r.sender ? shortName(r.sender) : "somebody";
    const ago = (typeof nowTs === "number" && nowTs > 0 && typeof r.ts === "number" && r.ts > 0)
      ? _fmtAgo(r.ts, nowTs) : "";
    return { who: who, verb: r.verb || "did something", ago: ago };
  }

  // Pure. Turns one fold into the panel's claims. Separated from the renderer for the same reason
  // `_activityLabel` is: the honesty of the wording is the half of this job that can be wrong
  // while everything still works, so it has to be drivable on its own.
  //
  // ── THE DONE-WHEN ASKED FOR A SENTENCE THE TREE CANNOT SAY ─────────────────────────────────
  // "A forgotten room shows a feed that starts at the floor, not an empty one with no
  // explanation." Driven before this was written (`probe-j13-feed.js` R2/R3): the trim keeps
  // `l > floorL` STRICTLY, so nothing at the floor survives and a feed can never start AT it; and
  // a room that seals at its own head holds ZERO rows while still deriving a live `nowPlaying`
  // from the seed, so the empty feed is both reachable and correct. What the entry was reaching
  // for is the last three words, and that is what these strings are: the empty case is EXPLAINED
  // rather than filled, and the explanation is a reading of what this client holds rather than a
  // claim about a floor the panel cannot see.
  function _feedLabel(fold) {
    const f = fold || {};
    const rows = Array.isArray(f.rows) ? f.rows : [];
    const total = (typeof f.total === "number") ? f.total : rows.length;
    // The three origins are decided by the fold. The panel states each one plainly and never
    // guesses between them — "nothing has happened" and "everything was forgotten" look identical
    // from an empty list, and telling a person the wrong one is worse than telling them neither.
    let empty = "";
    if (f.origin === "forgotten") {
      empty = "Nothing here yet — everything this room has done so far has been banked into a " +
              "checkpoint and forgotten by this client. The room's state comes from that " +
              "checkpoint; the events behind it are gone from here, so there is nothing to list.";
    } else if (f.origin === "nothing-yet") {
      empty = "Nothing has happened in this room yet.";
    }
    return {
      count: total,
      heading: total === 1 ? "1 event" : total + " events",
      empty: empty,
      // WHERE THE FEED BEGINS, STATED AS A READING. Not "starts at the floor": this client cannot
      // see the floor from here and does not need to. What it can say is how much it is holding,
      // and that anything older is not held — which is true whether the cause was a trim, a fresh
      // join, or an imported seed (J46), and needs no second rule for any of them.
      reachNote: (f.origin === "held" && f.oldestTs)
        ? "Showing what this client still holds. Anything older has been forgotten or was never seen."
        : "",
      // REFUSED EVENTS ARE COUNTED, NEVER NARRATED. The log holds what the reducer rejected as
      // well as what it accepted — a settings blob from a player, a reset from a guest — and
      // listing them would be a feed naming acts nobody performed (`roles.md` §10's second
      // signature). Dropping them silently would under-report instead, so the count is stated.
      refusedNote: f.refused
        ? (f.refused === 1
            ? "1 event in the log was refused by the room and is not listed."
            : f.refused + " events in the log were refused by the room and are not listed.")
        : "",
      // THE LIMIT, STATED RATHER THAN IMPLIED — the same shape as the activity panel's, and for
      // the same reason. Chat never reaches the log this is read from, so a person who has only
      // chatted appears nowhere here, and a feed that said "everything that has happened" would
      // be inviting the reader to supply it themselves.
      sources: "Rotation, playback, reactions, settings and moderation. Chat is not listed — " +
               "it never reaches the log this is read from.",
      truncated: f.truncated
        ? ("Showing the most recent " + f.limit + " of " + total + ".")
        : "",
    };
  }

  // The panel. Windowed with `WindowedList.visibleRange`, which is the SYNCHRONOUS half of that
  // module and the only half that fits here.
  //
  // ── WHY NOT `WindowedList.create()`, WHICH IS THE OBVIOUS READING OF THE JOB'S OPEN ────────
  // The Open says `core/windowedlist.js` is the tool, and it is — but the module has two halves
  // with opposite behaviour when the list shortens beneath them, which is precisely what a trim
  // does to this list. DRIVEN (`probe-j13-feed.js` R6/R7):
  //   · `visibleRange` CLAMPS. Scrolled to row 200 of 500, then the list becomes 12 rows: it
  //     returns `{start:12,end:12}` — an empty slice with proportional padding, never a throw and
  //     never a row that is not there.
  //   · `create()` + `arraySource` DOES NOT. Its cursor is a POSITIONAL index, so a 40-row list
  //     shortening to 20 leaves the open window still naming `_i=0..29`, and held `_i=0` now
  //     addresses what used to be `e20`. Nothing re-inits it and nothing tells it to. That is the
  //     plausible-value signature with a scrollbar attached.
  // The stateful controller is also the wrong shape for the Done-when independently of that: it
  // HOLDS the window, and this feed is required to hold no state of its own (P5).
  const FEED_LIMIT = 200;      // rows the fold returns; the window paints a slice of these
  const FEED_ROW_H = 30;
  function renderFeedPanel() {
    if (!refs.feedBox) return;
    clear(refs.feedBox);
    // ServerClock, never Date.now() (P2) — see `_feedRowText`.
    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
    let fold;
    try { fold = Room.recentEvents({ limit: FEED_LIMIT }); }
    catch (e) { return; }
    const lab = _feedLabel(fold);

    refs.feedBox.appendChild(el("div", { class: "feed-head", text: lab.heading }));
    if (lab.empty) {
      refs.feedBox.appendChild(el("p", { class: "muted feed-empty", text: lab.empty }));
    }
    if (lab.reachNote) {
      refs.feedBox.appendChild(el("p", { class: "muted feed-reach", text: lab.reachNote }));
    }
    if (lab.truncated) {
      refs.feedBox.appendChild(el("p", { class: "muted feed-truncated", text: lab.truncated }));
    }
    const rows = fold.rows || [];
    if (rows.length) {
      _renderWindowedStack(refs.feedBox, () => rows, (r) => {
        const t = _feedRowText(r, now);
        const whoEl = el("span", { class: "who", text: t.who });
        whoEl.style.color = rankColor(_rosterLevel(r.sender));
        // The same one trigger every surface uses (J14).
        if (r.sender) _wireCardTrigger(whoEl, r.sender);
        return el("div", { class: "feed-row feed-" + (r.group || "other") }, [
          whoEl,
          el("span", { class: "feed-verb", text: t.verb }),
          el("span", { class: "feed-ago", text: t.ago }),
        ]);
      }, FEED_ROW_H);
    }
    if (lab.refusedNote) {
      refs.feedBox.appendChild(el("p", { class: "muted feed-refused", text: lab.refusedNote }));
    }
    refs.feedBox.appendChild(el("p", { class: "muted feed-sources", text: lab.sources }));
  }

  function renderRoster() {
    if (!refs.rosterBox) return;
    clear(refs.rosterBox);
    const roster = Room.getRoster();
    if (!roster || roster.length === 0) {
      refs.rosterBox.appendChild(el("p", { class: "muted", text: "Just you so far" }));
      return;
    }
    roster.forEach(member => {
      const nameEl = el("span", { class: "who", text: member.name || shortName(member.userId) });
      nameEl.style.color = rankColor(member.level);
      // The name is the card trigger (J14) — same affordance in every surface a
      // person appears in, through the one helper so the keyboard path cannot be
      // remembered in three places and forgotten in the fourth.
      _wireCardTrigger(nameEl, member.userId, member.level);
      const row = el("div", { class: "person" }, [
        nameEl,
        el("span", { class: "rank-tag", text: rankName(member.level) })
      ]);
      // Staff+ may set ranks strictly below their own, for people below them —
      // and only ranks the room has actually unlocked channels for. The rank rule
      // (Staff+, target strictly below me — which also excludes myself) now comes
      // from the capability system; rankSelect still filters WHICH levels appear.
      if (Actions.describe("rank.assign", { targetRank: member.level }).enabled) {
        row.appendChild(rankSelect(member.level, async (lvl) => {
          try { await Room.assignRank(member.userId, lvl); }
          catch (e) { Logger.warn("assignRank: " + e.message); }
        }));
      }
      refs.rosterBox.appendChild(row);
    });
  }

  function rankSelect(currentLevel, onPick) {
    const sel = el("select", { class: "rank-select" });
    const channels = Room.getChannels();
    RANKS.forEach(r => {
      // Which levels I may GRANT is the capability's call (rank strictly below mine);
      // isRankUnlocked is a structural fact (the room has that rank's channel yet).
      if (!Actions.describe("rank.assign", { targetRank: currentLevel, newLevel: r.level }).enabled) return;
      if (!Room.isRankUnlocked(channels, r.level)) return;     // room hasn't created this rank's channels yet
      // THE OPTION SAYS WHAT PICKING IT DOES. On a person's card the top rung reads "Bot"; here it
      // has to be a verb-ish phrase, because a dropdown of nouns reads as "set them to this" and
      // the consequence — this account becomes the room's bot, with one bot per room — is not
      // something a noun conveys.
      const label = (r.level === _BOT_LEVEL) ? "Bot (appoint as room bot)" : r.name;
      const opt = el("option", { value: String(r.level), text: label });
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
    // Owner-only panel. Ask the capability with retryAt:0 so the cooldown branch is
    // bypassed — this yields pure ownership; the panel's own status()/countdown below
    // still shows the cooldown to owners.
    if (!Actions.describe("room.upgrade", { retryAt: 0 }).enabled) return;   // owner-only
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ CHAT
  //
  // The render window, sorted insert, scrollback and the one-shot backfill. Rows are placed by
  // timestamp and id, never arrival order.
  // ────────────────────────────────────────────────────────────────────────────────────────

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
  // What a tombstone says. Deliberately about the ACT and not the actor: the row keeps its
  // author's name and colour, so "Message deleted" beside it already reads as *they took it back*.
  // Naming a redactor here would be wrong the moment a moderator case exists.
  const REDACTED_TEXT = "Message deleted";

  // Per-box state. The ChatBuffer is the RAM source of truth (up to 5000 msgs,
  // oldest evicted on overflow); the DOM renders a window of it. domIds = ids
  // currently mounted (trim removes from here, NOT from the buffer, so a trimmed
  // message re-renders from RAM on scroll-up with no network). imgLRU = ids of
  // inline images that currently hold a live src, most-recently-shown last.
  function _newChatState() {
    return { buf: ChatBuffer.create(), domIds: new Set(), loading: false, backfilled: false, backfilling: false, liveFromTs: 0, io: null, imgLRU: [] };
  }
  // ── ONE BUFFER PER TIER, AND THE MEASUREMENT THAT FORCED IT (J12) ──────────────────────────
  // Before J12 there was ONE buffer on the box, and a tier change ran `_resetChatState`, which
  // replaced it wholesale. DRIVEN (`probe-j12-tiers.js` R0): 120 messages in, switch, 0 out — a
  // different buffer object, the old one unreachable. Chat is RAM-ONLY and there is no server
  // copy to recover from except a SINGLE capped `backfillRecent(CHAT_BACKFILL)` = 10 messages,
  // against a buffer cap of 5000. So a switch could destroy up to 4990 messages with a ten-message
  // recovery, permanently. **J12's Done-when — "switching tiers does not lose messages" — was
  // asking for something the old shape could not give**, and no amount of care at the call site
  // would have changed that; the shape had to change.
  //
  // So the buffers are HELD PER TIER and a switch is a re-render from a retained buffer rather
  // than a re-init. Bounded and stated: the tier set is the room's chat channels (three today),
  // each capped at the same 5000, so the ceiling is tiers × CAP and does not grow with time. This
  // is RAM the module already spends, one bucket per tier instead of one bucket.
  //
  // ── `_resetChatState` IS DECIDED, NOT PARKED AGAIN (v284) ─────────────────────────────────
  // It has been filed as "unused" twice and re-parked twice, each time reconstructing the
  // reasoning. The comment here used to say it "STILL EXISTS AND IS STILL RIGHT — for a ROOM
  // change, where the old room's messages genuinely must go."
  //
  // **DRIVEN, AND A ROOM CHANGE DOES NOT NEED IT.** `enterMainScreen` calls `clear(main)` and then
  // `buildMainDom(main, room)`, which builds `refs.chatBox` fresh — so on every room entry the box
  // is a NEW ELEMENT with no `_chats` at all. There is nothing of the old room's to clear, and no
  // caller anywhere in the tree. (A first reading placed the build inside `enterMainScreen` and was
  // wrong; the measurement corrected it — the build is in `buildMainDom`, which `enterMainScreen`
  // calls after clearing.)
  //
  // **IT STAYS, AND THE REASON IS THE EXTRACTIONS.** `check-chat-tiers` and `probe-j12-tiers` both
  // list it in the `names` array they brace-match from — not in prose, in the array. Removing it
  // makes those REFUSE rather than fail, and a refusal reads like a pass. Moving them off it is a
  // change to two harnesses to delete one dead function, and it would cost the thing those
  // harnesses exist to demonstrate: that a tier change does NOT reach the reset.
  //
  // **SO THE COST OF KEEPING IT IS ONE UNCALLED FUNCTION; THE COST OF REMOVING IT IS TWO HARNESS
  // EDITS AND A WEAKER DEMONSTRATION.** Kept deliberately. `check-lint` parks the resulting
  // `no-unused-vars` finding at this single site with the same reason, so a later lint run does
  // not re-file it — and this comment is here so the reasoning is not reconstructed a fourth time.
  function _chatStates(box) {
    if (!box._chats) box._chats = Object.create(null);
    return box._chats;
  }
  function _chatState(box, tier) {
    const all = _chatStates(box);
    const key = (typeof tier === "string" && tier) ? tier : (box._chatTier || "_active");
    if (!all[key]) all[key] = _newChatState();
    return all[key];
  }
  // Every tier's state, for the paths that must reach all of them (a room change disconnects
  // every observer, not just the visible one).
  function _allChatStates(box) {
    const all = _chatStates(box);
    return Object.keys(all).map((k) => all[k]);
  }
  function _resetChatState(box) {
    if (!box) return;
    for (const st of _allChatStates(box)) {
      if (st && st.io) { try { st.io.disconnect(); } catch (e) {} }
    }
    box._chats = Object.create(null);
  }

  // ── THE TIER STRIP AND ITS BADGES (J12) ────────────────────────────────────────────────────
  // Three declarations, extracted by name and EXECUTED by `check-chat-tiers` — the seventh guard
  // in the tree to run this file rather than read it. Same argument as J13's feed panel and J16's
  // activity panel: the subject is a CLAIM about what a badge means, and a regex proving a label
  // is spelled here proves nothing about whether it is ever rendered, or about what it says when
  // a tier is silent.
  //
  // THE PANEL DECIDES NOTHING. Which tiers exist and which is active is `Room.chatTiers()`;
  // whether a tier is unread is `ChatPrefs.tierUnread`. A second copy of either here is the drift
  // P7 is about, and the P7 collision is the one thing J12's Open names.

  // ── WHAT A TIER IS CALLED ON SCREEN ────────────────────────────────────────────────────────
  // The tier IDs are protocol — they are channel-key slugs and rank names, and they must not
  // change. What a person reads is a different question, and it was being answered by printing
  // the protocol name: the strip said `uncategorized (main)`, `guest`, `staff`. "Uncategorized"
  // is what the LADDER calls its bottom rung; as the name of a chat room it tells a reader
  // nothing, and "guest" reads as *only* guests rather than *guests and above*.
  //
  // DISPLAY-ONLY AND THAT IS THE WHOLE POINT. Nothing downstream reads these strings — the tier
  // id still travels everywhere else, so this cannot drift into a second vocabulary.
  //
  // AN UNKNOWN TIER FALLS BACK TO ITS ID RATHER THAN TO A BLANK. A tier added to the channel
  // table and not to this map should look unfinished, not invisible: `check-chat-tiers` fails on
  // a missing label, and until somebody reads that failure the strip still shows something a
  // person can name when they report it.
  // THE MAP LIVES INSIDE THE FUNCTION so `check-chat-tiers` can EXTRACT AND EXECUTE it — its
  // extractor takes `function` declarations, and a bare `const` beside one would have to be
  // stubbed by the guard, which would prove the strip renders something and nothing about what it
  // says. Called rather than read, the real labels are what the assertions see.
  function _chatTierName(tier) {
    const LABELS = {
      uncategorized: "Everyone",   // the ladder's bottom rung is everyone in the room
      guest: "Guest+",             // guests AND above — "guest" alone reads as only guests
      staff: "Staff",
      presence: "Present",         // the bot-managed channel: who the room says is here now
    };
    return LABELS[tier] || String(tier || "");
  }

  // ── WHAT A SETTING IS CALLED, IN ONE PLACE ─────────────────────────────────────────────────
  // The delegation table listed every row by its RAW KEY — `checkpointRankOffsetMs`,
  // `vouchJitter`, `receiptsPerMessage` — while the settings panel a few lines above called the
  // same three things "Head start for each rank (seconds)", "Turn-taking step & peer jitter (ms)"
  // and "Backups carried per message". So the owner met two vocabularies for one setting, in one
  // panel, and the delegation one was the machine's.
  //
  // MEASURED: 22 of the 25 delegable keys already had a human label at their row's call site.
  // This is that name, hoisted so both places read it — the row and the delegation table cannot
  // disagree because there is one source.
  //
  // A KEY WITH NO NAME FALLS BACK TO THE KEY. Same reason as the chat tiers: a setting added to
  // the domain and not named here must look unfinished rather than invisible, and `check-settings-
  // labels` fails on it so somebody is told.
  function _settingDisplayName(key) {
    const NAMES = {
      chat: "Main chat", vis: "Visibility", bg: "Room background",
      minDjRank: "Who can DJ", maxLen: "Max song length (sec)", minLen: "Grace period (sec)",
      minGate: "Shortest time before the next song (sec)",
      graceMs: "Allowance for length disagreement (sec)",
      presendMs: "Pause before you post the next song (ms)",
      skipRoads: "When to skip a song too many can't see",
      vouchTable: "How many people must back up an event",
      checkpointTable: "Who can replace the owner's summary",
      botPresenceSpine: "Count queue actions as being around",
      botPresenceChat: "Count chat as being around",
      botQueueChat: "Count chat as keeping your queue place",
      botAfkMs: "Treat someone as away after (minutes)",
      botPingMs: "Wait for an answer for (seconds)",
      activityQueue: "What keeps your place in the queue",
      activityPresence: "What keeps you in the presence chat",
      queueIdleMs: "Give up a queue place after (minutes)",
      repeatCooldownMs: "Don't replay a song within (minutes)",
      checkpointCooldownMs: "Minimum gap between summaries (minutes)",
      checkpointEvery: "Save a summary after this many actions",
      checkpointRankOffsetMs: "Head start for each rank (seconds)",
      selfWitnessCheckpoint: "Save a summary from your own backups",
      vouchJitter: "Turn-taking step & peer jitter (ms)",
      receiptsPerMessage: "Backups carried per message",
    };
    return NAMES[key] || String(key || "");
  }

  // Pure. One resolution + the read markers -> the strip's labels. Separated from the renderer so
  // what a badge CLAIMS can be driven without a DOM.
  function _chatTierLabel(res, unreadFor) {
    const r = res || {};
    const tiers = Array.isArray(r.tiers) ? r.tiers : [];
    const unread = (typeof unreadFor === "function") ? unreadFor : (() => false);
    return {
      tiers: tiers.map((t) => ({
        tier: t.tier,
        // The room's MAIN tier is marked rather than renamed, because "main" is a fact about the
        // room and the tier keeps its own name in every client regardless of which is main.
        main: !!t.main,
        active: t.tier === r.activeTier,
        // A TIER WITH NO TRAFFIC CARRIES NO BADGE, and that is a decision rather than a
        // side-effect. `tierUnread` answers false for a tier with no row at all — nothing has
        // ever arrived there — so a silent staff channel does not invite somebody to open an
        // empty room. A tier you have NEVER OPENED but which HAS traffic does carry one, because
        // there is something there you have not seen, which is what a badge is for.
        unread: !!unread(t.tier),
        label: _chatTierName(t.tier) + (t.main ? " (main)" : ""),
      })),
      // Stated rather than implied, the same way the feed and the activity panel state theirs:
      // this strip shows the tiers the ROOM HAS and this client has joined, which is not the same
      // as every tier the protocol defines.
      note: tiers.length <= 1
        ? "This room has one chat tier."
        : "Tiers your rank grants. Unread marks a tier with messages you have not seen.",
    };
  }

  // Which tier a channel id belongs to, resolved through the feature layer rather than by
  // reversing the `chat_` key here — the UI does not own the channel vocabulary.
  function _tierForChannel(roomId) {
    if (!roomId) return null;
    let res;
    try { res = Room.chatTiers(); } catch (e) { return null; }
    const hit = (res && res.tiers || []).find((t) => t.id === roomId);
    return hit ? hit.tier : null;
  }

  function _renderChatTierStrip() {
    if (!refs.chatTiers) return;
    clear(refs.chatTiers);
    let res;
    try { res = Room.chatTiers(); } catch (e) { return; }
    const lab = _chatTierLabel(res, (t) => { try { return ChatPrefs.tierUnread(t); } catch (e) { return false; } });
    if (!lab.tiers.length) return;
    for (const t of lab.tiers) {
      // `tab` is the queue's own sub-button class and `active` is the queue's own selected marker,
      // so which tier is live reads exactly as which queue pane is live. `chat-tier` stays for the
      // unread dot's positioning — the badge is this strip's alone and the queue has no equivalent.
      const b = el("button", { class: "tab chat-tier" + (t.active ? " active" : "") + (t.unread ? " unread" : ""),
                               text: t.label, title: t.main ? "The room's main chat tier" : "" });
      b.onclick = () => _selectChatTier(t.tier);
      refs.chatTiers.appendChild(b);
    }
    refs.chatTiers.appendChild(el("span", { class: "muted chat-tier-note", text: lab.note }));
  }

  // The switch. Re-points the feature layer through the ONE resolver, then repaints from the
  // RETAINED buffer for that tier — no re-init, so nothing is lost (J12's Done-when).
  function _selectChatTier(tier) {
    const box = refs.chatBox;
    let res;
    try { res = Room.selectChatTier(tier); } catch (e) { return; }
    if (!box) return;
    box._chatTier = res.activeTier;
    // Reading a tier is what clears its badge, and it is marked at the tier's OWN newest stamp
    // rather than at a clock — the marker and the messages have to be on one scale or a badge
    // could survive being read (P2, one level up from the clock rule).
    try {
      const st = _chatState(box, res.activeTier);
      const ids = st.buf.ids();
      const newest = ids.length ? (st.buf.get(ids[ids.length - 1]) || {}).ts : 0;
      if (newest) ChatPrefs.tierMarkRead(res.activeTier, newest);
    } catch (e) {}
    _repaintChat(box);
    _renderChatTierStrip();
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
    // THE TOMBSTONE (J11b). A vanished row is indistinguishable from one that was never there, so
    // a deletion leaves a mark instead of a hole. Checked AFTER `failed` deliberately: a message
    // this device never decrypted is hidden by the caller, and a redaction must not turn a hidden
    // row into a visible one — a deletion causing a row to APPEAR is backwards. The buffer keeps
    // `failed` across a redaction for exactly that reason.
    if (record.redacted) {
      const t = document.createElement("span");
      t.className = "chat-redacted";
      t.textContent = " " + REDACTED_TEXT;
      return t;
    }
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

  // ── ONE MESSAGE ROW, TWO SURFACES (v274) ──────────────────────────────────────────────────
  // The DM thread had its own row builder — its own sender span, its own tombstone branch, its own
  // delete control — and **none of the avatar work**, because v285's avatars reached the
  // conversation LIST and not the messages inside a conversation. That is the seventh instance of
  // one rule with two implementations and the SECOND in DMs, after `_dmFoldMessage` said *"same
  // rule as ChatBuffer"* and then implemented it again.
  //
  // **THEY MERGE, AND THE DIFFERENCES ARE TWO ARGUMENTS.** Everything that looked DM-specific was
  // the same decision written twice: hide a failed row, tombstone a redacted one, offer delete on
  // your own only and never on a tombstone. What genuinely differs is WHICH delete function to
  // call and WHICH class the row carries. Both are now parameters, so avatars, the live avatar
  // refresh, tombstones and anything added later arrive in both for free.
  function _chatRow(box, record, opts) {
    const o = opts || {};
    const level = _rosterLevel(record.sender);
    const color = rankColor(level);
    const senderEl = el("span", { class: "sender", text: shortName(record.sender) });
    senderEl.style.color = color;
    // The card, from chat (J14). `_rosterLevel` answers 0 for somebody not in the
    // roster, which is the right fallback: a descriptor computed against too WEAK a
    // target rank can only be MORE permissive than the truth — so `Room.kick`/`Room.ban`
    // re-read both ranks live and refuse. That is the same defence-in-depth
    // `rank.assign` has always relied on, and it is why a stale roster level here is a
    // rendering imprecision rather than a permission hole.
    _wireCardTrigger(senderEl, record.sender, level);
    const av = avatarEl(record.sender, 20);
    av.style.marginRight = "5px";
    av.style.verticalAlign = "middle";
    av.dataset.avatarFor = record.sender;   // lets onAvatarChange find and refresh it
    const msg = el("div", { class: o.rowClass || "chat-msg" }, [av, senderEl]);
    msg.appendChild(_chatContent(box, record));
    if (record.id) msg.dataset.eid = record.id;   // window key (dedup + in-place update)
    // ── TAKE IT BACK (J11) ─────────────────────────────────────────────────────────────────
    // ON YOUR OWN ROWS ONLY, AND THAT IS A DECISION RATHER THAN A GATE. The homeserver ladder
    // reads `redact: 100` with `events_default: 0`, so deleting your OWN message needs only
    // permission to send a redaction — which everyone has — while deleting someone else's needs
    // level 100. So the self case works for every rank and the moderator case is not a rank check
    // that was left out; it would need the room's power levels changed, which is a different job
    // from the one J11's Open defers it to.
    //
    // The absence of the control on other people's rows is a UI choice about what to OFFER, not a
    // permission check. `features/chat.js` carries no gate either: a redaction is adjudicated by
    // the homeserver and never reaches the reducer, so a gate would report permitted against
    // nothing — J14's lesson and the 403 drift `10-capabilities.md` exists to prevent.
    // Not on a tombstone: there is nothing left to take back, and offering it would send a second
    // redaction the homeserver has no reason to honour.
    if (record.id && !record.redacted && _isOwnMessage(record.sender)) {
      const del = el("button", { class: "chat-del", text: "×", title: "Delete this message" });
      del.onclick = () => (o.onDelete || _deleteChatMessage)(record.id);
      msg.appendChild(del);
    }
    return msg;
  }

  // Own-ness compared against the live account id rather than a cached one, so a row rendered
  // before a re-login does not keep somebody else's affordance.
  function _isOwnMessage(sender) {
    if (!sender) return false;
    let me = null;
    try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
    return !!me && sender === me;
  }

  // ── WHAT A DELETION ACTUALLY PROMISES, AND THE PANEL SAYS IT ───────────────────────────────
  // A redaction is a REQUEST other clients honour, not an erasure. The homeserver strips the
  // content from its copy and tells everyone; each client then removes it if it is listening. A
  // client that had already rendered the message and is not running may still show it, and
  // anything already screenshotted or copied is beyond reach entirely. Stated the way J16 stated
  // chat's invisibility and J13 stated its reach — a promise the tree cannot keep must not be
  // implied by silence.
  const CHAT_DELETE_NOTE = "Deleted for everyone still connected. Copies already saved elsewhere " +
    "are beyond reach.";

  async function _deleteChatMessage(eventId) {
    if (!eventId) return;
    let res;
    try { res = await Chat.redact(eventId); }
    catch (e) { res = { ok: false, reason: "redact-failed" }; }
    if (res && res.ok) {
      // NOT REMOVED HERE. The row goes when the redaction comes BACK through the door, so the
      // local view and every other client change for the same reason at the same point. Removing
      // optimistically would make this client the one place a failed deletion still looks like a
      // success, which is the failure mode hardest to notice from inside it.
      _setChatNote(CHAT_DELETE_NOTE);
      return;
    }
    _setChatNote(res && res.reason === "forbidden"
      ? "The server refused that deletion."
      : "That deletion did not go through.");
  }

  function _setChatNote(text) {
    if (!refs.chatNote) return;
    refs.chatNote.textContent = text || "";
  }

  // ── A REDACTION ARRIVING (J11) ─────────────────────────────────────────────────────────────
  // THE MEASUREMENT THAT DECIDED THIS FUNCTION'S SHAPE. The obvious handler is an upsert to a
  // placeholder — exactly what a decryption failure does — and `probe-j11-redact.js` R0 shows the
  // buffer REFUSES it: `prev.failed === false && failed` returns `noop`, so the message stays on
  // screen after being deleted and nothing throws. The non-downgrading rule that protects real
  // text from a decryption placeholder protects it from a deletion too, and it cannot tell the
  // two apart because both arrive as "replace real text with an absence".
  //
  // So the row is REMOVED rather than tombstoned, and that is what the buffer can express: `remove`
  // has been there since the buffer was written, marked *for a future delete/redaction feature*.
  // A tombstone would have to be remove-then-reinsert, which re-enters at the sorted slot and
  // leaves a row a later real message could clobber — the dedup rule expresses one of the two
  // cleanly and it is disappearance.
  //
  // A REDACTION FOR A MESSAGE THIS CLIENT NEVER HELD IS A NO-OP, NOT AN ERROR. It is the normal
  // case, not the exotic one: buffers are per tier and capped, the client may have joined after
  // the message, the tier may never have been opened, and the row may have been evicted. `remove`
  // answers false and that is the whole response.
  function removeChatMessage(redactedId, roomId) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box || !redactedId) return;
    // Routed to the tier the deleted message is IN, not the tier being viewed — buffers are per
    // tier (J12) and a redaction carries its own room_id. Driven rather than assumed (R3).
    const tier = _tierForChannel(roomId);
    const visible = box._chatTier || null;
    const st = _chatState(box, tier || visible);
    // TOMBSTONE, NOT REMOVAL. `redact` mutates the record IN PLACE, which is what makes this safe:
    // the update branch never touches `order[]`, so the row keeps its chronological slot. Driven
    // (R1b) — remove-then-reinsert lands the row at the FRONT, because `_place` sorts on the ts it
    // is handed and the original is lost with the record. The clobber that ruled a tombstone out
    // the first time belongs to REINSERTION, not to mutation.
    //
    // Answers false when this client never held the message, which is the normal case and is
    // still a no-op: a tombstone for a message the person never saw would create a row rather
    // than mark one, which is the same objection as the hidden-row case above.
    if (!st.buf.redact(redactedId)) return;
    // The DOM row only exists if this tier is the visible one AND the row was mounted. It is
    // REPLACED rather than removed, so the mark lands in the slot the message occupied.
    if (!tier || tier === visible) {
      const node = box.querySelector(_eidSel(redactedId));
      const rec = st.buf.get(redactedId);
      if (node && rec) {
        if (rec.failed) { node.remove(); st.domIds.delete(redactedId); return; }
        node.replaceWith(_chatRow(box, rec));
      }
    }
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
  //   insert -> a new row, placed in CHRONOLOGICAL order (not blindly at the bottom)
  //   update -> patch the existing row IN PLACE (placeholder -> real text, etc.)
  //   noop   -> ignored (no id, or a placeholder that must not clobber real text)
  // ts is the Matrix origin_server_ts; the buffer orders by it, so a message
  // delivered out of arrival-order (E2E history decrypts newest-first; late keys)
  // still lands in its correct slot.
  // `roomId` is J12's addition and is what makes per-tier buffers possible: `Chat` now forwards
  // every readable tier, so the message has to say which one it belongs to. A message for a tier
  // that is NOT the visible one is buffered and touched for the badge, and returns before any
  // DOM work — it has no rows on screen to patch.
  function addChatMessage(id, sender, body, failed, ts, roomId) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box) return;
    const tier = _tierForChannel(roomId);
    const visible = box._chatTier || null;
    const st = _chatState(box, tier || visible);
    const res = st.buf.upsert(id, sender, body, failed, ts);
    if (res.type === "noop") return;

    // THE BADGE IS TOUCHED FOR EVERY TIER INCLUDING THE VISIBLE ONE, and the visible one is then
    // marked read immediately below. Touching only the hidden tiers would look equivalent and is
    // not: `tierTouch` is what CREATES the row, so a tier that had only ever been read while
    // visible would have no row at all and `tierUnread` would answer false for it forever after.
    if (tier && !failed) {
      try {
        ChatPrefs.tierTouch(tier, ts);
        if (tier === visible) ChatPrefs.tierMarkRead(tier, ts);
      } catch (e) {}
      _renderChatTierStrip();
    }
    if (tier && visible && tier !== visible) return;   // buffered, badged, not drawn

    // While the one-shot backfill is in flight, the scrollback it runs re-fires
    // Event.decrypted for a flood of OLDER messages. Buffer them (done above) but
    // DON'T render here — _backfillChatOnce renders the last CHAT_BACKFILL from the
    // buffer once, in order. Rendering them live is exactly what produced the
    // reversed, over-cap history. (New live messages during this brief window are
    // buffered too and appear as part of that one render.)
    if (st.backfilling) return;

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

    // insert. Undecryptable old/re-key messages are hidden (kept in the buffer for
    // ordering/dedup, but never drawn — no readable content on this device).
    if (res.record.failed) return;

    // Late history (older than the newest we've shown) is not "live" — drop it from
    // the live path so it can't pile onto the bottom. It stays buffered and is
    // revealed in order by scroll-up (_loadOlderChat). Genuinely-new messages
    // (ts beyond the backfill horizon) fall through to the ordered insert below.
    if (st.liveFromTs && (Number(ts) || 0) <= st.liveFromTs && !st.domIds.has(id)) return;

    const stick = _chatAtBottom(box);
    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;

    // Place the row in chronological (buffer) order: find the nearest mounted
    // message AFTER this one and insert before it; if none, it belongs at the tail.
    const all = st.buf.ids();                 // oldest -> newest (ts-sorted)
    const idx = all.indexOf(id);
    let beforeNode = null;
    for (let i = idx + 1; i < all.length; i++) {
      if (st.domIds.has(all[i])) { beforeNode = box.querySelector(_eidSel(all[i])); break; }
    }
    const row = _chatRow(box, res.record);
    if (beforeNode) box.insertBefore(row, beforeNode);
    else box.appendChild(row);
    if (id) st.domIds.add(id);

    if (stick) { _trimChat(box); box.scrollTop = box.scrollHeight; }   // following the tail
    else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);     // scrolled up: anchor, don't jump
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
  // if live messages later render decryption errors (the two are decoupled).
  //
  // ORDER + CAP: because chat is E2E, the fetch's own scrollback re-fires
  // Event.decrypted for a FLOOD of older messages, and they arrive NEWEST-first.
  // Two things keep the join view correct: (1) the RAM buffer orders by ts, so the
  // flood + the fetched tail interleave into true chronological order; (2) while
  // `backfilling` is set, addChatMessage buffers those events but does NOT draw
  // them (see there) — this single render is the only one. We then draw just the
  // LAST CHAT_BACKFILL readable messages (the intended cap), leaving the rest in
  // RAM for scroll-up (_loadOlderChat), and set liveFromTs to the newest ts so any
  // later straggler decrypts are treated as history, not appended to the tail.
  // Runs once per room entry; chat is present-forward after. A brand-new room — or
  // one whose recent messages are all undecryptable — yields nothing (clean no-op).
  async function _backfillChatOnce(box) {
    if (!box) return;
    const st = _chatState(box);
    if (st.backfilled || st.loading) return;
    st.backfilled = true;
    st.loading = true;
    st.backfilling = true;   // defer live rendering of the scrollback flood until this render
    _ensureChatScrollWired(box);
    try {
      let res;
      try { res = await Chat.backfillRecent(CHAT_BACKFILL); }
      catch (e) { return; }
      // Readable-only: drop undecryptable backfilled messages before they ever
      // reach the buffer (so they can never surface an error row).
      const older = ((res && res.messages) || []).filter((m) => m && !m.failed);
      st.buf.prependOlder(older);   // interleaves by ts with anything the flood already buffered

      // The initial view is the last CHAT_BACKFILL READABLE messages, in order.
      const readable = st.buf.ids().filter((idv) => { const r = st.buf.get(idv); return r && !r.failed; });
      const show = readable.slice(Math.max(0, readable.length - CHAT_BACKFILL));   // oldest -> newest
      if (!show.length) return;

      const atBottom = _chatAtBottom(box);
      const beforeH = box.scrollHeight;
      const beforeTop = box.scrollTop;
      const frag = document.createDocumentFragment();
      for (const idv of show) {
        if (st.domIds.has(idv)) continue;
        st.domIds.add(idv);
        frag.appendChild(_chatRow(box, st.buf.get(idv)));
      }
      if (frag.childNodes.length) {
        box.insertBefore(frag, box.firstChild);
        if (atBottom) box.scrollTop = box.scrollHeight;                 // fresh box: stick to bottom
        else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);  // else keep the reader put
      }
      // Newest ts we've folded in becomes the live horizon: strictly-newer messages
      // are live and append; anything at-or-below is history (backfill / stragglers).
      const newest = st.buf.get(show[show.length - 1]);
      st.liveFromTs = (newest && newest.ts) || 0;
    } finally {
      st.backfilling = false;
      st.loading = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ PLAYER
  //
  // The YouTube iframe, the progress tick, the title marquee, and two-way volume sync.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // YOUTUBE PLAYER (the song element)
  // ---------------------------------------------------------------------------
  let _currentSong = null;   // { videoId, dj } of what's loaded, for reset/title
  // ── THE FINISHED STATE IS KEYED TO THE SONG, AND ENTERED ONCE ──────────────────────────────
  // This was a bare boolean set by the one push that carried `ended` and cleared by the next push
  // that did not — which was the ordinary progress tick two seconds later, describing a song that
  // was exactly as finished as before. So every song boundary ran a loop, and it is worth being
  // exact about which parts of that loop are certain:
  //
  //   CERTAIN, from reading the two functions: the finished state was torn down and rebuilt every
  //   two seconds — shield off, progress loop restarted, the label flipping between the song and
  //   "nothing playing" — for as long as the room took to advance.
  //   CONDITIONAL: whether it also RELOADED the finished song depends on what getVideoData()
  //   reports after stopVideo(). If it stops reporting the id, the load branch fires and the
  //   player reloads a song it just stopped, seeking past its own end so it ends again. That
  //   matches the reported symptom — the player loading and reloading at the end of songs — but
  //   it was not captured, and the fix does not depend on which of the two was happening.
  //
  // Playback now records the fact against the PLAY INSTANCE, so it stops flipping. This holds the
  // instance we have already torn down for, so the teardown happens ONCE per song rather than on
  // every tick, and so a song we know has finished is never reloaded.
  let _endedPi = null;       // the play instance this client's player has finished, or null

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
  // The shield is a click-blocker AND, when given a label, the deliberate waiting screen drawn
  // over a player we have stopped touching. Transparent with no label (its original job); opaque
  // with one, so YouTube's own end-of-video related grid is never what a room looks at between
  // songs. Text via textContent, never markup — the same rule every other untrusted-adjacent
  // string in this file follows, and this one is ours but the rule does not get exceptions.
  function _showPlayerShield(show, label) {
    if (!refs.playerShield) return;
    refs.playerShield.style.display = show ? "block" : "none";
    const waiting = show && typeof label === "string" && label;
    refs.playerShield.classList.toggle("waiting", !!waiting);
    clear(refs.playerShield);
    if (waiting) refs.playerShield.appendChild(el("span", { class: "shield-note", text: label }));
  }

  function _driveNowPlaying(np) {
    if (!np) {
      _endedPi = null;
      _showPlayerShield(true, "Nothing playing");
      clearVideo(); clearProgress(); renderNowPlaying(); _currentSong = null; updateVideoTitle();
      return;
    }
    if (np.ended) {
      // The current song has finished and nothing has replaced it yet. ENTER THIS STATE ONCE.
      // The flag is sticky now, so this branch is reached on every tick until the room advances —
      // repeating the teardown each time is what produced the reloading, the flickering label and
      // YouTube's end-of-video grid blinking in and out. Doing it once and then leaving the player
      // alone is what makes a song END rather than thrash.
      if (_endedPi === np.pi) return;              // already settled here — do nothing at all
      _endedPi = np.pi;
      // Stop the video so it cannot replay, then cover it. The shield is what the person actually
      // sees: without it, stopping the video hands the frame back to YouTube, which paints its own
      // poster and related-video grid — the least graceful ending available.
      clearVideo();
      _showPlayerShield(true, "Waiting for the next song…");
      clearProgress();
      _currentSong = null;
      updateVideoTitle();
      renderNowPlaying();
      return;
    }
    // A live instance: if it is the one we finished, we are still waiting — hold the settled state
    // rather than tearing it down and rebuilding it on the next tick.
    if (np.pi && np.pi === _endedPi) return;
    _endedPi = null;
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
      // ── THE ONE PLACE THE BOT DIFFERS FROM ANY OTHER OWNER ──────────────────────────────
      // With its view off, the room's bot does not LOAD the media. That is the whole of the
      // difference: `playback.js` holds no bot rule at all, and everything the deleted rules used
      // to buy falls out of there being no player — no measured duration, so no length declared
      // and no wall-clock advance; no `onError`, so no `ddjp.play.blocked`. The second matters
      // beyond traffic: blocked reports feed the auto-skip roads, so a deliberate non-watcher
      // reporting "blocked" would help vote off a song everyone else can see fine.
      //
      // ASKED AT LOAD TIME, NOT CACHED. Both halves can change while the page is open — the
      // setting from this panel, and bot-ness from `_evaluateBot` on any rank change — and the
      // next song asks again.
      if (_botViewOff()) {
        _currentSong = null;   // nothing was loaded, so do not claim a song is on this player
        updateVideoTitle();
        if (refs.progressFill) refs.progressFill.style.width = "0%";
        return;
      }
      loadVideo(np.song.videoId, np.startedAt, () => Playback.elapsedSec(np));
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
  // ── ONE MARQUEE, TWO TARGETS (browser run) ─────────────────────────────────────────────────
  // The room title also needs to scroll when it does not fit, and this machinery already does it
  // for the video title: a ResizeObserver on the box, a UNIQUE `@keyframes` name per fit so a
  // resize never reuses a stale travel distance, and coalesced rAF so a drag collapses to one fit.
  //
  // GENERALISED RATHER THAN COPIED. A second implementation of a rule is the category this tree
  // has now recorded five times — `_dmFoldMessage` was the last, where a comment claiming *"same
  // rule as ChatBuffer"* stood in for the rule and the DM path missed a state change entirely.
  // The three fixes that live in this function (the unique keyframe name, the clean-slate reset,
  // the retry when the box has no width yet) each cost a bug to find; a copy would inherit today's
  // version of them and none of tomorrow's.
  //
  // The per-fit STATE moves onto the element, because two targets fitting at once must not cancel
  // each other's rAF — one shared `_marqueeRaf` would have made the second target's fit silently
  // eat the first's, which is the shape of bug a copy would also have had.
  function _fitMarquee(boxEl, txtEl) {
    const box = boxEl || refs.videoTitle, txt = txtEl || refs.videoTitleText;
    if (!box || !txt) return;

    // Coalesce bursts (a window-resize drag fires the ResizeObserver many times):
    // cancel any pending fit so only the latest measurement wins. PER TARGET.
    if (box._marqueeRaf) { cancelAnimationFrame(box._marqueeRaf); box._marqueeRaf = 0; }

    // Clean slate every call. This is what makes resize correct in BOTH
    // directions: stop any running animation and drop the transform, then
    // re-measure against the CURRENT box width and re-apply from scratch.
    txt.style.animation = "";
    txt.style.transform = "";

    let tries = 0;
    const apply = () => {
      // The target may have been torn down between frames (leaving a room rebuilds the header),
      // so the liveness test is about THIS box rather than about the video title specifically.
      if (!box.isConnected && box.isConnected !== undefined) return true;
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
      box._marqueeRaf = 0;
      if (apply()) return;
      if (++tries < 10) box._marqueeRaf = requestAnimationFrame(tick);
    };
    box._marqueeRaf = requestAnimationFrame(tick);
  }

  // Fit BOTH marquee targets. One name for "everything that scrolls", so a caller that reflows the
  // header does not have to know which titles exist.
  function _fitAllMarquees() {
    _fitMarquee();
    if (refs.roomTitle && refs.roomTitleText) _fitMarquee(refs.roomTitle, refs.roomTitleText);
  }

  function initYouTubePlayer() {
    player = null; playerReady = false;
    if (!window.YT || !window.YT.Player) { setTimeout(initYouTubePlayer, YT_INIT_RETRY_MS); return; }
    // ── WHAT THE PLAYER SAYS RIGHT NOW ───────────────────────────────────────────────────
    // A PROVIDER, NOT A PUSH. The id and the duration are read TOGETHER and only when somebody
    // actually asks — which is what lets Playback re-read at the moment it declares instead of
    // sending a number captured when the song started. During a swap YouTube accepts the new
    // video id immediately while getDuration() still returns the PREVIOUS song's length, so a
    // read taken at PLAYING can be "right id, wrong number"; a read taken a moment later is not.
    // The UI stays dumb here — it reports what the player says and makes no protocol decision.
    Playback.setDurationProvider(() => {
      if (!player || !playerReady) return null;
      try {
        const vd = player.getVideoData ? player.getVideoData() : null;
        const d = player.getDuration ? player.getDuration() : 0;
        if (!vd || !vd.video_id) return null;
        return { videoId: vd.video_id, seconds: (typeof d === "number" && isFinite(d)) ? d : 0 };
      } catch (e) { return null; }
    });

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
        },
        // ── THE EMBED WOULD NOT PLAY (J41) ───────────────────────────────────────────────
        // The other thing this iframe can tell us, and for most of this project's life the
        // only one nobody listened for. Without this handler nothing ever called
        // MediaBlocked.reportCannotSee, so no client authored a ddjp.play.blocked, the skip
        // road tally was permanently zero, and the availability escape could not fire in a
        // live room — while every guard on that feature stayed green, because they drive the
        // module at its second and fourth steps and the missing first one is invisible from
        // either end.
        //
        // FORWARD THE RAW FACT, LET THE FEATURE DECIDE — exactly the notifyEnded contract
        // directly above, applied to the other signal. We stay dumb here: no play instance
        // (that is protocol, and ui/ may not read StreamManager at all), no error-code
        // mapping, no reason vocabulary, no rank. Two facts go down — the number the player
        // reported, and the video the player says is loaded — and MediaBlocked decides
        // whether either means anything. getVideoData() can return undefined mid-swap, and a
        // missing id makes the feature decline rather than declare against the wrong song.
        onError: (e) => {
          let erroredId = null;
          try {
            const vd = player.getVideoData();
            if (vd && vd.video_id) erroredId = vd.video_id;
          } catch (e2) { /* player not in a state to report video data — the feature declines */ }
          MediaBlocked.notifyPlayerError(e && e.data, erroredId);
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
  // A PROVIDER, NOT A VALUE. `_doLoad` retries while the player is not ready, so a captured number
  // is stale by however long the wait lasted and the player lands behind by exactly that. It showed
  // as the owner sitting slightly further back than a guest — the owner has replay, floor and
  // checkpoint work to finish on load, so it waits longer and drifts further. Asking again at the
  // moment of the actual load costs nothing and cannot go stale.
  // Ask the runtime. The decision lives in `BotRuntime.viewOff` so a guard can DRIVE it with all
  // four combinations instead of regexing this file — an earlier source-level check matched the
  // defensive `typeof` lines rather than the logic, and deleting either real check left it green.
  function _botViewOff() {
    try { return !!(typeof BotRuntime !== "undefined" && BotRuntime.viewOff && BotRuntime.viewOff()); }
    catch (e) { return false; }
  }

  function loadVideo(videoId, startedAt, elapsedAt) {
    _wantVideo = { videoId: videoId, startedAt: startedAt, elapsedAt: elapsedAt };
    _doLoad();
  }
  function _doLoad() {
    if (!_wantVideo) return;
    if (!player || !playerReady) {
      if (!_loadTimer) _loadTimer = setTimeout(() => { _loadTimer = null; _doLoad(); }, PLAYER_LOAD_RETRY_MS);
      return;
    }
    const w = _wantVideo;
    // ── SEEK IN SERVER TIME, NOT LOCAL TIME ──────────────────────────────────────────────
    // This computed `(Date.now() - w.startedAt) / 1000`. `startedAt` is a SERVER timestamp, so
    // subtracting the raw local clock yields the true elapsed PLUS this device's clock skew — and
    // every client seeks to a different point in the same song. Observed live: a late joiner and a
    // reloaded client both landed behind while the room still ADVANCED in step, because the
    // schedule comes from startedAt + the agreed length in shared server time. The playhead was
    // wrong; the timing never was, which is why it read as a sync bug rather than a clock one.
    //
    // ServerClock is on ui/'s forbidden list (boundary rule D), and rightly. The fix is not to
    // reach for it here but to let the feature that already computes this correctly hand the
    // answer over: Playback's elapsed helper has always used ServerClock — it simply was not asked.
    // Asked HERE, not when the intent was recorded — see the note on loadVideo.
    let elapsed = null;
    try { if (typeof w.elapsedAt === "function") elapsed = w.elapsedAt(); } catch (e) { elapsed = null; }
    if (typeof elapsed !== "number" || !isFinite(elapsed)) {
      elapsed = (Date.now() - w.startedAt) / 1000;   // fallback: only until Playback can answer
    }
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

  // ────────────────────────────────────────────────────────────────────────────────────────
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
    clear(host);
    host.appendChild(node);
    showScreen("screen-encryption");
  }

  // "Enter your recovery key" — the normal path for an account set up in Element.
  // onUnlock(key) resolves on success (and transitions away) or throws on a bad key.
  // onForgot() routes to the reset-understanding gate. onLogout() is the escape hatch.
  function showEnterRecoveryKey({ onUnlock, onForgot, onLogout }) {
    // type=password so the key is masked (dots), not shown in the clear.
    const input = el("input", { type: "password", class: "enc-input", placeholder: "Recovery key (e.g. EsTc ABCD …)" });
    const err = el("p", { class: "enc-error" });
    const btn = el("button", { class: "btn-primary", text: "Unlock" });
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

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  //
  // What app.js and the feature layer may call. Everything else in this file is private to it.
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    showScreen, renderRoomList, renderExportSection, setCreateRoomVisible, enterMainScreen,
    showEnterRecoveryKey, showResetWarning, showSaveNewKey, showAccounts,
    addChatMessage, startCountdown, clearCountdown, setRoomListBusy, setResumeHandler
  };
})();
