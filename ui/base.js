// ui/base.js
// THE SHARED SCAFFOLDING EVERY ui/ MODULE READS. Owns `refs`, the module state that more than
// one ui file touches, the rank display table, the shared primitives (`el`, `avatarEl`, `fmt`, …)
// and the `Interface` forwarders. No panel rendering.
//
// WHY THIS FILE EXISTS, AND IT IS AN OWNER RULING RATHER THAN A TIDY-UP.
// `ui/interface.js` was split into ten files (roles.md §5) and is gone (ddjp_397). The ruling at ddjp_386
// is that `refs` lives HERE and every panel reads it from here — revised from "leave
// `refs` where it is", which was correct reasoning but capped the achievable split at
// about 12% of the file, because every cluster worth extracting reads `refs`.
//
// `host` IS HOW EVERY ui/ FILE REACHES THE SHARED PRIMITIVES (`el`, `clear`, `fmt`, …) rather
// than a copy in each — the copied-rule family, the single most repeated defect shape in this
// tree. This file publishes them itself: see "THE SEAM IS NO LONGER INTERIM" below.

const UIBase = (() => {

  // Local-only playback volume/mute. Never a protocol event — applies to THIS
  // browser's player instance only. Re-applied on every player state change so
  // a fresh video (which YouTube resets to its own default volume) is forced
  // back to the user's chosen level/mute state as fast as possible.
  const volumeState = { level: 100, muted: false };
  // The room's two-way volume poll (`ui/player.js` `_pollPlayerVolume`), stopped when the room is left. What the app last gave
  // each player — to tell a change made inside its own frame apart from our own writes — is the box's record since `ddjp_714`
  // (`ui/songplayer.js`), so every write, the check's included, goes through one place.
  const _playerVol = { pollTimer: null };
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
  //
  // THE TWO FACES AT THE TOP ARE KEPT BY LEVEL, NOT BY RUNG (the owner's ruling 37, J88). The ladder's top rung is NAMED
  // `owner` but is the bot's slot (99), and the human owner (100) sits above the ladder with no rung of its own — see "THE
  // TOP RUNG IS THE BOT SLOT" below. Keyed by rung, this table painted the BOT the owner's orange and left the OWNER grey,
  // in a live room (`?v=536`). So the top rung's entry here is the bot's pink, and the owner's orange is its own constant;
  // `_rankFace` is the one place that splits them.
  const _OWNER_COLOR   = "#E8890C";   // legendary orange — the human owner, above the ladder (100)
  const _BOT_COLOR     = "#EC4899";   // pink — the room's bot, the ladder's top rung (99)
  const _NO_RANK_COLOR = "#9CA3AF";   // grey — uncategorized, and any level nobody defined
  const _RANK_FACE = {
    "owner":         { color: _BOT_COLOR },  // the top rung, which the saturating ladder names `owner`: the BOT's slot
    "high-staff":    { color: "#7C3AED" },  // heroic purple
    "staff":         { color: "#3B82F6" },  // deep blue
    "vip":           { color: "#60A5FA" },  // blue
    "player":        { color: "#4ADE80" },  // green
    "guest":         { color: "#A7C4A0" },  // greyish green
    "uncategorized": { color: _NO_RANK_COLOR },  // grey
  };
  const RANKS = Room.rankLadder().map((r) => ({
    level: r.level,
    name:  r.label || r.name,
    color: (_RANK_FACE[r.name] || {}).color || _NO_RANK_COLOR,
  }));
  // Rank thresholds are no longer compared in the UI — permission comes from the
  // capability system (Actions.describe). RANKS (above) is kept for DISPLAY only
  // (rankName / rankColor / the rank-select option labels).

  // ── Timing constants (ms) — UI feedback delays, poll intervals, and debounces.
  // Gathered so durations are named and tunable in one place. None of these
  // affect consensus or storage; they are purely presentation/timing niceties.
  const COUNTDOWN_TICK_MS       = 1000;  // live rate-limit countdown re-render cadence
  const COPY_LABEL_REVERT_MS    = 1400;  // a "Copied" button label reverts back after this
  const SKIP_NOTE_CLEAR_MS      = 4000;  // transient skip/vote note auto-clears after this
  const UPGRADE_DONE_PAUSE_MS   = 600;   // hold the "Done" state briefly so the user sees it
  const UPGRADE_NOTE_PAUSE_MS   = 6000;  // and a "Done" that names what did not land long enough to read (`ddjp_693`)

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
  //
  // THE NAME AND THE COLOUR SPLIT IN ONE PLACE (J88). `rankName` made this split and `rankColor` did not — it looked the
  // level up in `RANKS`, so the bot (99, filed as `owner`) was painted orange and the owner (100, in no list) grey, while
  // their names read right. Both now read `_rankFace`, and neither compares a level of its own.
  const _BOT_LEVEL = Math.max.apply(null, RANKS.map((r) => r.level));
  function _rankFace(level) {
    if (typeof level === "number" && level > _BOT_LEVEL) return { name: "Owner", color: _OWNER_COLOR };
    if (level === _BOT_LEVEL) return { name: "Bot", color: _BOT_COLOR };
    const r = RANKS.find((x) => x.level === level);
    return r ? { name: r.name, color: r.color } : { name: "L" + level, color: _NO_RANK_COLOR };
  }
  function rankName(level) { return _rankFace(level).name; }
  // The hex colour for a power level (ruling 37): every name the app colours — People, the user card, chat, the queue, now
  // playing, history, the player, avatar initials — comes through here.
  function rankColor(level) { return _rankFace(level).color; }
  // Look up a user's power level from the live roster by full Matrix ID.
  // Returns 0 (Uncategorized) if they aren't in the roster yet.
  function _rosterLevel(userId) {
    const roster = (Room.getRoster ? Room.getRoster() : null) || [];   // null: the members not loaded yet (`ddjp_699`)
    const member = roster.find(m => m.userId === userId);
    return member ? member.level : 0;
  }

  // --- Avatar elements ---
  // avatarEl(userId, size) returns an <img> showing the user's Matrix profile
  // picture, or an initials circle as fallback. Always synchronous: uses the
  // cached URL from Media (null on first call, fills in via onAvatarChange).
  // Size is the CSS pixel dimension for width + height (default 28).
  // EVERY PICTURE CARRIES WHOSE IT IS (`data-avatar-for`, `ddjp_700`), so a picture change finds it wherever it is shown —
  // People, chat, the player's line, the DM list and its threads, the card, your own — by one sweep of the page
  // (`ui/screens.js`, the avatar-change listener). Before, only chat's rows and the player's picture carried it.
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
      img.dataset.avatarFor = userId;
      img.onerror = () => { img.replaceWith(_initialsEl(userId, sz)); };
      return img;
    }
    return _initialsEl(userId, sz);
  }
  function _initialsEl(userId, sz) {
    const d = document.createElement("div");
    d.dataset.avatarFor = userId;
    const initials = shortName(userId).slice(0, 2).toUpperCase();
    const color = rankColor(_rosterLevel(userId));
    d.textContent = initials;
    d.style.cssText = "border-radius:" + AVATAR_RADIUS + ";width:" + sz + "px;height:" + sz + "px;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "font-size:" + Math.round(sz * 0.38) + "px;font-weight:bold;flex-shrink:0;" +
      "background:#2a2a2a;color:" + color + ";";
    return d;
  }

  // ── THE RING: A RANK THAT IS NOT THE SAME EVERYWHERE (the owner's plan, part 1; `main/05-matrix.md` §Ranks you can trust) ──
  // A thin red ring on the person's picture wherever it shows — the player's line, chat rows, People rows, and this account's
  // own picture in the header — so a problem with someone's rank is seen by design, and their card is the answer. `node` is
  // the picture's WRAPPER, which a picture loading later does not replace; the stylesheet rings what is inside it
  // (`.rank-off > *`, the app's own red outline, borrowed as a rule). Whether to ring is the room's (`Room.rankStanding`'s
  // `ring`: out of step for longer than a rank change may take, `ddjp_693`): this draws it and decides nothing. The user card's
  // own picture is ringed too (`ui/roster.js` `openUserCard`, `ddjp_693`).
  function rankRing(node, userId) {
    if (!node || !node.classList) return node;
    let off = false;
    try { const st = (userId && Room.rankStanding) ? Room.rankStanding(userId) : null; off = !!(st && st.ring); } catch (e) { off = false; }
    if (off) node.classList.add("rank-off"); else node.classList.remove("rank-off");
    return node;
  }

  // ── A WAIT SAID WHERE IT HAPPENS (the owner's plan, part 3, `ddjp_697`) ────────────────────────────────────────────────
  // Anything waiting because Matrix asked us to slow down says so in place, in the same orange, with the countdown: "Waiting 12 s
  // — Matrix asked us to slow down." The seconds are the status piece's (`MatrixStatus.waitingSecs(kind)`); nothing here
  // decides. `slowWait` is the line, or null while nothing of that kind waits; `slowWaitSig` is what a surface compares to
  // redraw only when a countdown it shows has moved.
  const SLOW_WAIT_KINDS = ["ranks", "membership", "build"];
  function _waitSecs(kind) {
    try { return (typeof MatrixStatus !== "undefined" && MatrixStatus.waitingSecs) ? MatrixStatus.waitingSecs(kind) : 0; } catch (e) { return 0; }
  }
  function slowWaitText(kind) {
    const n = _waitSecs(kind);
    return n > 0 ? "Waiting " + n + " s \u2014 Matrix asked us to slow down." : "";
  }
  function slowWait(kind) {
    const t = slowWaitText(kind);
    return t ? el("div", { class: "slow-wait", text: t }) : null;
  }
  function slowWaitSig() { return SLOW_WAIT_KINDS.map(_waitSecs).join(","); }

  // ── A MENU THAT STAYS WITH ITS BUTTON (`ddjp_698`, JOB 6; the owner's: "the pop up menu in chat follows resizing window but
  // the new status one and layout button one in the top bar dont, they should") ────────────────────────────────────────────
  // THE ONE WAY a top-bar menu stays attached — your picture's (`ui/roster.js`), the only one since `ddjp_699` took ⊞ out of the
  // top bar (its tiles are in that menu now, and J134's left-edge rule went with it): fixed to the window under its button, 6 px
  // below it; its right edge at the button's right edge; moved only as far as it must to stay 8 px inside the window on both
  // sides. Placed on open, again on every resize (live while the window's edge is dragged), again whenever the header's fit runs
  // (`placeMenus`, from `_fitHeader`), and again on any frame where its button has moved for another reason — the header's
  // content changing without the window (an upgrade's countdown appearing, the picture's upload note, the rank's words), which
  // is the case the owner saw at a narrow width: the button moved and the menu stayed. Let go when it closes. The chat's
  // pop-up needs none of this: it sits inside its button's own box (`position: absolute`), so it follows by construction.
  const MENU_EDGE = 8;   // px kept between a menu and either side of the window
  const MENU_GAP = 6;    // px between the button's bottom and the menu
  const _sticks = new Set();   // the menus open now, each kept under its button
  function stickToButton(menu, button) {
    let live = true, frame = null, seen = "";
    const open = () => !(menu.style && menu.style.display === "none") && menu.isConnected !== false && button.isConnected !== false;
    const where = () => { const b = button.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, window.innerWidth].join(","); };
    const stick = { place: place, stop: stop };
    function place() {
      if (!live) return;
      if (!open()) { stop(); return; }
      const b = button.getBoundingClientRect();
      const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
      const w = menu.getBoundingClientRect().width || menu.offsetWidth || 0;
      const from = b.right - w;
      const left = Math.max(MENU_EDGE, Math.min(from, vw - MENU_EDGE - w));
      menu.style.left = Math.round(left) + "px";
      menu.style.right = "auto";
      menu.style.top = Math.round(b.bottom + MENU_GAP) + "px";
      seen = where();
    }
    function watch() {
      frame = null;
      if (!live) return;
      if (!open()) { stop(); return; }
      if (where() !== seen) place();
      if (live && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(watch);
    }
    function stop() {
      if (!live) return;
      live = false;
      _sticks.delete(stick);
      if (window.removeEventListener) window.removeEventListener("resize", place);
      if (frame !== null && typeof cancelAnimationFrame === "function") { try { cancelAnimationFrame(frame); } catch (e) {} }
      frame = null;
    }
    _sticks.add(stick);
    window.addEventListener("resize", place);   // live while the window is dragged
    place();
    if (live && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(watch);   // and whatever else moves the button
    return stick;
  }
  // Every open menu placed again now (the header's fit calls it: the fit can move a button after the resize that caused it).
  function placeMenus() { for (const s of Array.from(_sticks)) s.place(); }

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
  // A WAIT MATRIX ASKED FOR, COUNTED DOWN IN PLACE (`ddjp_697`): a create's or an upgrade's own retry knows when it goes again
  // (`untilMs`); its line says so in the slow-down's words and orange ("Waiting 12 s — Matrix asked us to slow down.") until then,
  // then "Trying again…". The surface takes the orange off when its progress moves on (`node.classList.remove("slow-wait")`).
  function slowCountdown(key, node, untilMs) {
    clearCountdown(key);
    if (node && node.classList) node.classList.add("slow-wait");
    const tick = () => {
      if (!node || !node.isConnected) { clearCountdown(key); return; }
      const n = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
      node.textContent = n > 0 ? "Waiting " + n + " s \u2014 Matrix asked us to slow down." : "Trying again\u2026";
      if (n <= 0) clearCountdown(key);
    };
    tick();
    if (_countdowns[key] === undefined && node && node.isConnected && untilMs > Date.now()) _countdowns[key] = setInterval(tick, COUNTDOWN_TICK_MS);
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

  // ── ↻: A TAP RELOADS, A HOLD REBUILDS (`ddjp_712`, the owner's design) ──────────────────────────────────────────────────
  // His words: "maybe we can make a circle load around the button like the avatar outline if we keep the button pressed and
  // that reloads the whole player a simple click just reloads the song", and "tapping it or letting go to fast still
  // refreshes the song, and completly pusing it does the action upon the circle closing even if you dont lift click but waits
  // for a lift to be pressed again". For the room's ↻ and the song preview's: a tap — or a press let go before the ring
  // closes — calls `onTap` on the lift; held, a ring in the app's blue fills clockwise from the top (`.hold-btn::before`,
  // drawn from `--hold`, 0 to 1) and when it closes `onHold` runs at once, still held; then nothing more happens until the
  // press is lifted (the lift does nothing) and the next press starts afresh. Mouse and touch alike (pointer events, the
  // press captured); a press the browser cancels (a touch taken for a scroll) does nothing; the long-press menu is refused;
  // Enter or Space (a click no pointer made) is a tap. HOLD_MS is the one number (his last word: "lets do 1 second").
  const HOLD_MS = 1000;
  const RELOAD_TITLE = "Tap: reload the song \u00b7 Hold: rebuild the player";   // both ↻ say it on hover (the supervisor's words)
  function holdButton(btn, onTap, onHold) {
    let press = null;   // { id, at, fired, timer, raf } while a press is down
    const show = (p) => { try { btn.style.setProperty("--hold", String(p)); } catch (e) {} };
    const run = (f) => { try { if (typeof f === "function") f(); } catch (e) { try { Logger.warn("↻: " + ((e && e.message) || e)); } catch (x) {} } };
    btn.classList.add("hold-btn");
    show(0);
    function end() {
      const p = press;
      press = null;
      if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      if (p.raf && typeof cancelAnimationFrame === "function") { try { cancelAnimationFrame(p.raf); } catch (e) {} }
      show(0);
      btn.classList.remove("hold-done");
    }
    function draw() {
      const p = press;
      if (!p || p.fired) return;
      show(Math.min(1, (Date.now() - p.at) / HOLD_MS));
      p.raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame(draw) : null;
    }
    btn.addEventListener("pointerdown", (e) => {
      if (press || (e && typeof e.button === "number" && e.button !== 0)) return;   // one press at a time; the main button only
      if (e && e.preventDefault) e.preventDefault();   // no text selection and no focus ring from a press
      try { if (btn.setPointerCapture && e && e.pointerId !== undefined) btn.setPointerCapture(e.pointerId); } catch (x) {}
      const p = { id: e ? e.pointerId : undefined, at: Date.now(), fired: false, timer: null, raf: null };
      press = p;
      p.timer = setTimeout(() => {
        if (press !== p) return;
        p.timer = null;
        p.fired = true;
        show(1);
        btn.classList.add("hold-done");
        run(onHold);   // the ring closed: at once, while still held
      }, HOLD_MS);
      draw();
    });
    btn.addEventListener("pointerup", (e) => {
      if (!press || (e && e.pointerId !== press.id)) return;
      const tap = !press.fired;
      end();
      if (tap) run(onTap);   // let go before the ring closed; after it closed, the lift does nothing
    });
    const cancelled = (e) => { if (press && (!e || e.pointerId === undefined || e.pointerId === press.id)) end(); };
    btn.addEventListener("pointercancel", cancelled);       // the browser took the press (a scroll): nothing
    btn.addEventListener("lostpointercapture", cancelled);  // after a lift `press` is already gone, so only a lost press ends here
    btn.addEventListener("contextmenu", (e) => { if (e && e.preventDefault) e.preventDefault(); });   // no long-press menu
    btn.addEventListener("click", (e) => { if (!press && !(e && e.detail > 0)) run(onTap); });     // Enter or Space: a tap
  }

  function fmt(sec) {
    if (sec == null || isNaN(sec)) return "0:00";
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }
  function shortName(userId) { return (userId || "").split(":")[0].replace("@", ""); }

  // ────────────────────────────────────────────────────────────────────────────────────────

  // ── THE ACTIVITY GROUPS' NAMES, IN ONE PLACE (ddjp_456) ───────────────────────────────────────
  // Two surfaces name the same groups: the room settings panel in full ("Joining, leaving or
  // reordering the queue") and the People header in a word ("queue"). One table holds both forms, so
  // a group added later is named in one place or visibly not at all. A group missing here still
  // shows under its own id — failing OPEN: a missing name is cosmetic, a missing row is not.
  // The order is the reducer's ACTIVITY_GROUPS order, so the People line reads the way settings lists.
  const ACTIVITY_GROUP_NAMES = {
    rotation:   { short: "queue",            long: "Joining, leaving or reordering the queue" },
    moderation: { short: "moderation",       long: "Moving, removing or striking someone" },
    skip:       { short: "skips",            long: "Skipping a song" },
    vote:       { short: "votes",            long: "Upvoting a song" },
    save:       { short: "saves",            long: "Saving a song" },
    settings:   { short: "settings changes", long: "Changing room settings" },
  };
  function activityGroupName(g, form) {
    const e = ACTIVITY_GROUP_NAMES[g];
    return e ? (form === "long" ? e.long : e.short) : String(g);
  }
  // --- the primitive seam (see the header) ----------------------------------
  // Filled by `publish` (below, and from ui/shell.js). Read by every ui/ file. A key used
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
    el, clear, fmt, shortName, avatarEl, rankColor, _rosterLevel, rankName, activityGroupName,
    _initialsEl, copyButton, startCountdown, clearCountdown, rankRing,
    slowWait, slowWaitText, slowWaitSig, slowCountdown,   // `ddjp_697`: a wait said where it happens
    stickToButton, placeMenus,   // `ddjp_698`: the one way a top-bar menu stays with its button
    holdButton, HOLD_MS: () => HOLD_MS, RELOAD_TITLE: () => RELOAD_TITLE,   // `ddjp_712`: ↻ — a tap reloads the song, a hold rebuilds the player
    RANKS: () => RANKS, BOT_LEVEL: () => _BOT_LEVEL,
    UPGRADE_DONE_PAUSE_MS: () => UPGRADE_DONE_PAUSE_MS, UPGRADE_NOTE_PAUSE_MS: () => UPGRADE_NOTE_PAUSE_MS, AVATAR_CSS_SIZE: () => AVATAR_CSS_SIZE,
    SKIP_NOTE_CLEAR_MS: () => SKIP_NOTE_CLEAR_MS,
  });

  return { refs, volumeState, _playerVol, _bg, host, publish };
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
    setCreateRoomVisible: (...a) => Screens.setCreateRoomVisible(...a),
    enterMainScreen: (...a) => Screens.enterMainScreen(...a),
    showEnterRecoveryKey: (...a) => Screens.showEnterRecoveryKey(...a),
    showResetWarning: (...a) => Screens.showResetWarning(...a),
    showSaveNewKey: (...a) => Screens.showSaveNewKey(...a),
    showAccounts: (...a) => Screens.showAccounts(...a),
    setRoomListBusy: (...a) => Screens.setRoomListBusy(...a),
    setResumeHandler: (...a) => Screens.setResumeHandler(...a),
    reopenAfterReload: (...a) => Screens.reopenAfterReload(...a),   // J83: the room this tab was in, after a reload
    addChatMessage: (...a) => ChatPanels.addChatMessage(...a),
    startCountdown: (...a) => UIBase.host.startCountdown(...a),
    clearCountdown: (...a) => UIBase.host.clearCountdown(...a),
    slowCountdown: (...a) => UIBase.host.slowCountdown(...a),   // `ddjp_697`: making a room's wait, said in place
  };
})();
