// ui/base.js
// THE SHARED SCAFFOLDING EVERY ui/ MODULE READS. Owns `refs` and the module state
// that more than one ui file touches — nothing else. No DOM building, no rendering.
//
// WHY THIS FILE EXISTS, AND IT IS AN OWNER RULING RATHER THAN A TIDY-UP.
// `ui/interface.js` is being split into ten files (roles.md §5). The ruling at ddjp_386
// is that `refs` lives HERE and every panel reads it from here — revised from "leave
// `refs` where it is", which was correct reasoning but capped the achievable split at
// about 12% of the file, because every cluster worth extracting reads `refs`.
//
// WHAT IS NOT HERE YET, STATED SO NOBODY READS THE ABSENCE AS A DECISION.
// roles.md §5 has this file eventually holding CONSTANTS, PRIMITIVES, all of MODULE
// STATE and EXPORTS. It holds `refs` plus the state that CROSSES a file boundary today,
// and no more: moving PRIMITIVES means moving the rank display table with it, and a guard
// asserts that table is declared in `ui/interface.js`. That is a re-point to make when
// the cluster needing it moves, not one to make early.
//
// `host` IS THE INTERIM SEAM AND IT IS DELIBERATELY SHAPED TO DISAPPEAR.
// An extracted cluster still needs primitives that have not moved yet (`el`, `clear`,
// `fmt`, …). Rather than a copy in each file — the copied-rule family, the single most
// repeated defect shape in this tree — `ui/interface.js` PUBLISHES them here and the
// extracted files read them from here. When PRIMITIVES genuinely moves into this file the
// call sites do not change: only where the function is defined does.

const UIBase = (() => {

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
  // ── COLOUR ONLY (J36). THE NAMES USED TO BE HERE AND THEY WERE A SECOND COPY. ────────────────
  // `capabilities.js` needs a rank's written form too — it builds the denial sentence a person
  // reads off a button tooltip — and `ui/` is downstream of it, so it could not ask. It grew its
  // own title-caser instead, and the two answers disagreed: this table said "VIP", that one said
  // "Vip". Neither was reachable from the other, so nothing could see it.
  //
  // The label now comes from the ladder, through `Room.rankLadder()` — the same route the level
  // already took, and the only legal one from here. What is left is paint: a hex value means
  // nothing to a gate and belongs nowhere near the module that decides authority.
  const _RANK_FACE = {
    "owner":         { color: "#E8890C" },  // legendary orange
    "high-staff":    { color: "#7C3AED" },  // heroic purple
    "staff":         { color: "#3B82F6" },  // deep blue
    "vip":           { color: "#60A5FA" },  // blue
    "player":        { color: "#4ADE80" },  // green
    "guest":         { color: "#A7C4A0" },  // greyish green
    "uncategorized": { color: "#9CA3AF" },  // grey
  };
  const RANKS = Room.rankLadder().map((r) => ({
    level: r.level,
    name:  r.label || r.name,
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
  const SKIP_NOTE_CLEAR_MS      = 4000;  // transient skip/vote note auto-clears after this
  const UPGRADE_DONE_PAUSE_MS   = 600;   // hold the "Done" state briefly so the user sees it

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

  // --- the interim primitive seam (see the header) ---------------------------
  // Filled by ui/interface.js at load. Read by every extracted ui/ cluster. A key used
  // but never published is the "correct module reached by nothing" shape, so
  // check-ui-files asserts every key read out of here is published somewhere in ui/.
  const host = {};
  function publish(fns) { Object.assign(host, fns); }

  // ── THE SEAM IS NO LONGER INTERIM ────────────────────────────────────────────────────────
  // It existed because extracted clusters needed primitives that had not moved yet, and
  // ui/interface.js published them from the file they were still in. They are HERE now, so this
  // file publishes them into its own host. ~400 `H.x(` call sites across nine files are unchanged
  // — only the definition site moved. What ended is the seam being a bridge out of a file that is
  // disappearing; what remains is the ordinary way a ui/ file reaches the shared layer.
  publish({
    el, clear, fmt, shortName, avatarEl, rankColor, _rosterLevel, rankName,
    _initialsEl, copyButton, startCountdown, clearCountdown,
    RANKS: () => RANKS, BOT_LEVEL: () => _BOT_LEVEL,
    UPGRADE_DONE_PAUSE_MS: () => UPGRADE_DONE_PAUSE_MS, AVATAR_CSS_SIZE: () => AVATAR_CSS_SIZE,
    SKIP_NOTE_CLEAR_MS: () => SKIP_NOTE_CLEAR_MS,
  });

  return { refs, volumeState, _ytVol, _bg, host, publish };
})();

// ── THE PUBLIC SURFACE — `EXPORTS` FROM THE OLD ui/interface.js ────────────────────────────────
// A SECOND global in this file, which is why `check-ui-files` was widened at ddjp_396 to check
// every declared global rather than the first: a missing KNOWN_GLOBALS entry for this one would
// otherwise have been invisible.
//
// Every name is a FORWARDER and every one is an arrow, so they bind at CALL time. The objects they
// forward to are declared in files that load AFTER this one — with direct references this object
// would capture `undefined` and the <script> order would be load-bearing for correctness rather
// than merely for the shared state.
const Interface = (() => {
  return {
    showScreen: (...a) => Screens.showScreen(...a),
    renderRoomList: (...a) => Screens.renderRoomList(...a),
    renderExportSection: (...a) => Screens.renderExportSection(...a),
    setCreateRoomVisible: (...a) => Screens.setCreateRoomVisible(...a),
    enterMainScreen: (...a) => Screens.enterMainScreen(...a),
    showEnterRecoveryKey: (...a) => Screens.showEnterRecoveryKey(...a),
    showResetWarning: (...a) => Screens.showResetWarning(...a),
    showSaveNewKey: (...a) => Screens.showSaveNewKey(...a),
    showAccounts: (...a) => Screens.showAccounts(...a),
    setRoomListBusy: (...a) => Screens.setRoomListBusy(...a),
    setResumeHandler: (...a) => Screens.setResumeHandler(...a),
    addChatMessage: (...a) => ChatPanels.addChatMessage(...a),
    startCountdown: (...a) => UIBase.host.startCountdown(...a),
    clearCountdown: (...a) => UIBase.host.clearCountdown(...a),
  };
})();
