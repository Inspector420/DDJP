// ui/player.js
// PLAYER · NOW PLAYING · BACKGROUND ENGINE — extracted from ui/interface.js at ddjp_386
// as the first of the ten files roles.md §5 records. UI only, same rules as every ui/ file:
// no logic, no consensus, no direct Matrix or stream access, and all DOM built with
// createElement / textContent so no network-derived string is ever interpreted as HTML.
//
// ── BACKGROUND ENGINE IS SPLIT ACROSS TWO FILES, DELIBERATELY ─────────────────────────
// `_bgLeaveRoom` sat under the BACKGROUND ENGINE banner in ui/interface.js and did NOT
// come here. It is room TEARDOWN: it writes six misclick-lock variables and calls
// `_thumbReset`. Owner ruling at ddjp_386, and the principle generalises —
// **the banner is a reading aid; the cluster is an ownership unit.** A function under a
// banner is not necessarily of that banner's cluster. `_bgLeaveRoom` owns teardown of the
// shell's locks, so it belongs with `ui/shell.js`; moving it here would have this file
// writing six of shell's variables and calling into ui/playlists.js, which is the exact
// coupling the ten-file grouping exists to prevent.
//
// It lives in ui/shell.js and calls back in here for `_bgUnpaint` and, since J83,
// `clearPlayer` / `clearProgress`. Those calls are the whole of the reverse dependency, and they
// are named at both sites rather than left for a reader to discover — a comment claiming two
// files agree is not the same as them agreeing, which is this tree's eighth signature.
//
// ── WHAT REACHES ACROSS, AND WHY IT IS NOT A COPY ─────────────────────────────────────
// `refs` and the shared state objects come from `ui/base.js`, and the primitives through
// `UIBase.host`, which ui/base.js publishes. Neither is duplicated here: a copy inherits
// today's version of a fix and none of tomorrow's.
//
// Depends on: UIBase (and its `host`), Room, Playback, ChatPrefs, Logger,
// MetadataService, MediaBlocked, Songs, SongPlayer (the song players' plug, `ui/songplayer.js`)
//
// ── THE ROOM'S PLAYER IS THE PLUG'S (J29, step 2) ─────────────────────────────────────────────────────────────────────────
// This file plays the room's song through `SongPlayer`, in the box `ui/shell.js` builds (`#player`), and never meets a
// service: it loads a song by its KEY, reads back the key of what is showing, its title, time, length and volume, and hears
// the plug's words — ready, a state, a failure with the app's own reason. Which service's player does it is the key's
// business (`core/songs.js`'s row names the file). Every call each reading makes is the call it made when this file spoke to
// YouTube's player itself, in the same order (`check-player-plug`).

const Player = (() => {

  const { refs, volumeState, _playerVol, _bg } = UIBase;
  const H = UIBase.host;      // el, clear, fmt, shortName, avatarEl, rankColor,
                              // _rosterLevel

  // --- constants this cluster owns (nothing else in ui/ reads them) ----------
  const SONG_META_POLL_MS      = 500;   // poll interval while waiting for video metadata (title)
  const SONG_META_MAX_POLLS    = 10;    // give up reading metadata after this many polls
  const PLAYER_LOAD_RETRY_MS    = 500;   // retry a queued load until the player reports ready
  const VOLUME_APPLY_DELAY_MS   = 1000;  // re-apply the saved volume shortly after a (re)load
  const PLAYER_VOLUME_POLL_MS       = 400;   // poll the player's volume to mirror external changes

  // --- state this cluster owns. `player` — the room's box player, the plug's (`SongPlayer.make`) — is rebound HERE and read
  // by the preview mini-player in ui/playlists.js, which goes through the accessors at the bottom of this file rather than
  // holding its own copy. Whether it can take calls is its own `ready()`.
  let player = null;
  let _lastNp = null;   // latest consensus now-playing, cached so preview re-syncs to LIVE on close
  let _lastNpAt = 0;    // when it came (`ddjp_714`): the room's point now is its `elapsed` plus the time since
  let _marqueeSeq = 0;     // bumped per fit → a UNIQUE @keyframes name each time, so resize never reuses a stale travel distance

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
    const color = H.rankColor(H._rosterLevel(djId));
    // Only rebuild the whole label structure when the DJ changes.
    // On every tick we just update the text node and avatar src in-place.
    if (!refs.npAvatar || refs.npAvatar.dataset.avatarFor !== djId) {
      const nameEl = H.el("span", { text: H.shortName(djId) });
      nameEl.style.color = color;
      nameEl.style.fontWeight = "bold";
      // THE DJ'S NAME OPENS THEIR CARD (the owner's, `ddjp_678`), as the room queue's names do: the one trigger
      // (`Roster._wireCardTrigger`). Wired here because the name is built only when the DJ changes; a tick keeps it.
      Roster._wireCardTrigger(nameEl, djId);
      refs.npAvatar = H.avatarEl(djId, 22);
      refs.npAvatar.style.marginRight = "6px";
      refs.npAvatar.style.verticalAlign = "middle";
      refs.npAvatar.dataset.avatarFor = djId;
      // THE PICTURE OPENS THE CARD TOO (the owner's, J138), through the same trigger, as People's and Chat's pictures do — and
      // wired on a WRAPPER, as theirs are: the picture node itself is replaced when an avatar loads or fails to
      // (`ui/screens.js` `_applyUrl`, `H.avatarEl`'s `onerror`), and a handler on it would go with it. The wrapper is a bare
      // span, no class or style of its own, so the line looks as it did — but the ring's class while the DJ's rank is not the
      // same everywhere (below), which outlines the picture inside and moves nothing.
      const avBox = H.el("span", {}, [refs.npAvatar]);
      Roster._wireCardTrigger(avBox, djId);
      refs.npAvBox = avBox;   // kept, so every redraw of the line re-asks the ring (below)
      refs.npMiddle = document.createTextNode(middle);
      // The line starts WITH THE DJ (owner ruling, ddjp_454) — the player above it already says what
      // is playing, so a "Now playing —" prefix only pushed the name and the time to the right.
      refs.npLabel.replaceChildren(
        avBox,
        nameEl,
        refs.npMiddle
      );
    } else {
      // Same DJ — just update the time/song text and avatar src if it changed.
      if (refs.npMiddle) refs.npMiddle.textContent = middle;
      const url = Media.getAvatarUrl ? Media.getAvatarUrl(djId) : null;
      if (url && refs.npAvatar.tagName === "IMG" && refs.npAvatar.src !== url) refs.npAvatar.src = url;
    }
    // THE RING (the owner's plan, part 1): the DJ's rank not the same everywhere — asked at every redraw of the line, so a
    // rank change reaches it at the next tick.
    if (refs.npAvBox && H.rankRing) H.rankRing(refs.npAvBox, djId);
  }

  // --- Now-playing label + Skip enabled state ---
  function renderNowPlaying() {
    const np = Queue.getNowPlaying();
    ChatPanels._syncNpButtons();   // keep the player-bar grab/upvote in step with the current song
    // Skip enablement tracks CONSENSUS now-playing (via the capability system), not this player's own
    // end — a song that's still the current play-instance stays
    // skippable even if this client's player has finished it.
    if (refs.skipBtn) refs.skipBtn.disabled = !Actions.describe("dj.skip").enabled;
    if ((np && np.pi && np.pi === _endedPi) || !np || !np.song) {
      // Nothing playing right now: either the derived state has no real song, or the current
      // instance genuinely finished on this client's player (_endedPi, from its own end, held until the
      // room moves on, `ddjp_711`).
      // In both cases the line says NOTHING and no song is presented to replay — the room's clock
      // advances the rotation (or it stays empty if idle). The cover over the video already says
      // it (the owner's, J134: "we dont need the nithing playing in the frame of the player
      // since the video screen says it too"): the line said "Nothing playing", and between
      // songs too while the cover said "Waiting for the next song…". 🖱 and 👁 hold its height.
      if (refs.npLabel) refs.npLabel.textContent = "";
      refs.npAvatar = null;   // force label rebuild on next song
      clearProgress();        // hide the progress bar when nothing is playing
      _currentSong = null;
      updateSongTitle();
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
      mid = " · " + H.fmt(elapsed);
    }
    _setNpLabel(np.dj, mid);
    if (!_currentSong || _currentSong.songKey !== np.song.songKey) {
      _currentSong = { songKey: np.song.songKey, dj: np.dj, startedAt: np.startedAt };
      updateSongTitle();
    }
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ PLAYER
  //
  // The song player, the progress tick, the title marquee, and two-way volume sync.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // THE ROOM'S PLAYER (the song element)
  // ---------------------------------------------------------------------------
  let _currentSong = null;   // { songKey, dj } of what's loaded, for reset/title

  // A song no service's player plays — a room made before `ddjp_705` names its song by a bare id, and a bare id names no
  // service — is not loaded, and the log says so once per play (the owner's: such rooms stop working; the log line is enough).
  let _notPlayablePi;        // the play whose song no player plays, said once (undefined: none yet)
  // ── THE FINISHED STATE IS KEYED TO THE SONG, AND ENTERED ONCE ──────────────────────────────
  // This was a bare boolean set by the one push that carried `ended` and cleared by the next push
  // that did not — which was the ordinary progress tick two seconds later, describing a song that
  // was exactly as finished as before. So every song boundary ran a loop, and it is worth being
  // exact about which parts of that loop are certain:
  //
  //   CERTAIN, from reading the two functions: the finished state was torn down and rebuilt every
  //   two seconds — shield off, progress loop restarted, the label flipping between the song and
  //   "nothing playing" — for as long as the room took to advance.
  //   CONDITIONAL: whether it also RELOADED the finished song depends on what the player reports
  //   after it is stopped. If it stops reporting the song, the load branch fires and the
  //   player reloads a song it just stopped, seeking past its own end so it ends again. That
  //   matches the reported symptom — the player loading and reloading at the end of songs — but
  //   it was not captured, and the fix does not depend on which of the two was happening.
  //
  // Playback now records the fact against the PLAY INSTANCE, so it stops flipping. This holds the
  // instance we have already torn down for, so the teardown happens ONCE per song rather than on
  // every tick, and so a song we know has finished is never reloaded.
  let _endedPi = null;       // the play instance this client's player has finished, or null

  // --- Smooth playback progress bar ---
  // Driven DIRECTLY off the live player each animation frame:
  // currentTime / duration, read via getPlayerTime() + the player's length().
  // Because it reads the real player, it follows skips, seeks, and song swaps
  // automatically — no wall-clock anchoring to keep in sync. The tradeoff
  // (accepted): it inherits the player's quirks — sits at 0 while buffering,
  // can jump on a seek, and may read stale for a frame right at a song swap.
  // Those are smoothed lightly below (ignore non-finite / zero-duration reads).
  let _progRaf = null;
  function _readPlayerDuration() {
    if (!player || !player.ready()) return 0;
    try { const d = player.length(); return (typeof d === "number" && isFinite(d)) ? d : 0; }
    catch (e) { return 0; }
  }
  // ── THE TIME ON THE NOW-PLAYING LINE IS THE PLAYER'S OWN (owner report, ddjp_454) ────────────
  // It was written by the room's playback tick, which arrives about every two seconds, while the bar
  // beside it read the player every frame — two clocks, so the time stepped while the bar flowed. Now
  // THIS loop writes it too, from the same read as the bar, so the two cannot disagree and the time
  // moves each second the song does. It writes only when the shown second changes. The room's tick
  // still writes it — the player's position when it has one, the room's only until it does.
  function _npTimeText(cur, dur) {
    return " \u00b7 " + H.fmt(Math.floor(cur)) + (dur ? " / " + H.fmt(Math.floor(dur)) : "");
  }
  function _npWriteTime(cur, dur) {
    if (!refs.npMiddle) return;
    const t = _npTimeText(cur, dur);
    if (refs.npMiddle.textContent !== t) refs.npMiddle.textContent = t;
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
      // A playlist PREVIEW borrows this player for somebody else's song: its time is not the room's.
      let preview = false;
      try { preview = !!(typeof PlaylistPanels !== "undefined" && PlaylistPanels.previewActive && PlaylistPanels.previewActive()); } catch (e) { preview = false; }
      if (!preview) _npWriteTime(cur, dur);
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
    _lastNpAt = Date.now();
    if (PlaylistPanels.previewActive()) return;   // detached during preview: track, don't drive
    _driveNowPlaying(np);
  }
  // ── ONE COVER OVER THE PLAYER, THREE REASONS (owner rulings, ddjp_450) ─────────────────────────
  // The click-shield has always been a transparent blocker when nothing plays (so YouTube's replay
  // cannot restart a finished song locally), and the room's waiting screen when given a label.
  // It gains two reasons that are this device's, not the room's, and the order is the whole rule:
  //   1. NOTHING PLAYING, with a label — the room's own screen with its words, whatever the toggles say.
  //   2. THE VIDEO HIDDEN (👁) — the same screen, saying so; the sound plays on underneath.
  // A COVER WITH WORDS IS SEE-THROUGH, darker than the player's card (the owner's, `ddjp_678`): the chat box's darkness over
  // the room background (the sheet's `.player-shield.waiting`, in the chat box's rule). What it covers — YouTube's poster and
  // suggested-video grid, or the hidden video — would show through it, so while it shows words the frame carries
  // `cover-words` and the sheet takes the iframe to opacity 0: not drawn, still playing, never moved, resized or rebuilt.
  //   3. YOUTUBE'S OVERLAY BLOCKED (🖱) — shown TRANSPARENT: the video is seen, the mouse cannot
  //      reach the iframe, so YouTube's hover overlay never appears.
  // The player itself is never moved, resized or rebuilt — the shell's hard rule — so neither toggle
  // can stop the music. `_coverFor` is the decision, pure; `_renderCover` draws it and the toggles.
  // Text via textContent, never markup, as every untrusted-adjacent string in this file.
  // The cover says only "Player hidden" (the owner's, `ddjp_619`, then "player", not "video", at `ddjp_707`); the 👁 button's
  // hint still says the sound plays on.
  const COVER_HIDDEN_LABEL = "Player hidden";
  // The bot's tab with "Play songs on this device" off, while the room plays: it does not load the song, and its cover
  // says so — it said "Nothing playing", which was false (the owner's, `ddjp_620`).
  const COVER_BOT_OFF_LABEL = "Playback is off on this tab (the bot's)";
  let _idleLabel = null;   // the room's reason for a cover: a label, "" (transparent), or null while a song plays

  function _coverFor(idleLabel, hidden, blocked) {
    if (typeof idleLabel === "string" && idleLabel) return { show: true, label: idleLabel };
    if (hidden) return { show: true, label: COVER_HIDDEN_LABEL };
    if (typeof idleLabel === "string" || blocked) return { show: true, label: null };
    return { show: false, label: null };
  }
  function _prefOn(name) {
    try { return !!(typeof ChatPrefs !== "undefined" && ChatPrefs[name] && ChatPrefs[name]()); } catch (e) { return false; }
  }
  function _renderCoverToggles() {
    const set = (btn, on, onTitle, offTitle) => {
      if (!btn) return;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("title", on ? onTitle : offTitle);
    };
    set(refs.coverBlockBtn, _prefOn("overlayBlocked"),
      "The player's overlay is blocked \u2014 click to let the mouse reach it again",
      "Block the player's overlay: keep the mouse off it");
    set(refs.coverHideBtn, _prefOn("playerHidden"),
      "The player is hidden \u2014 click to show it",
      "Hide the player: the sound keeps playing");
  }
  function _renderCover() {
    const c = _coverFor(_idleLabel, _prefOn("playerHidden"), _prefOn("overlayBlocked"));
    const sh = refs.playerShield;
    if (sh) {
      sh.style.display = c.show ? "block" : "none";
      sh.classList.toggle("waiting", !!c.label);
      H.clear(sh);
      if (c.label) sh.appendChild(H.el("span", { class: "shield-note", text: c.label }));
    }
    // The video under a cover with words is not drawn (`ddjp_678`): a class on the frame, which the sheet turns into the
    // iframe's opacity 0 — the iframe itself is never touched here.
    if (refs.playerFrame) refs.playerFrame.classList.toggle("cover-words", !!c.label);
    _renderCoverToggles();
  }
  // The room's side, as every caller has always said it: shown with a label when nothing plays,
  // hidden when a song does. The device's two reasons are layered on in `_renderCover`.
  function _showPlayerShield(show, label) {
    _idleLabel = show ? ((typeof label === "string") ? label : "") : null;
    _renderCover();
  }
  function togglePlayerHidden()    { try { ChatPrefs.setPlayerHidden(!_prefOn("playerHidden")); } catch (e) {} _renderCover(); }
  function toggleOverlayBlocked() { try { ChatPrefs.setOverlayBlocked(!_prefOn("overlayBlocked")); } catch (e) {} _renderCover(); }
  function applyCover() { _renderCover(); }

  // ── THE ROOM'S PUSH: ITS OWN DECISIONS, THEN THE CHECK (`ddjp_714`) ── `_followRoom` is what this file decides from the room
  // — the cover, the hold, which song to load and why, the bot's tab — and `_checkPlayer` then has the plug keep every player in
  // the box to it (`ui/songplayer.js`, the check: the song, playing or paused and silent, the point, the volume).
  function _driveNowPlaying(np) {
    try { _followRoom(np); }
    finally { _checkPlayer(np); }   // a fault in drawing the room's line never keeps the players from being checked
  }
  function _followRoom(np) {
    if (!np) {
      _endedPi = null;
      _showPlayerShield(true, "Nothing playing");
      clearPlayer(); clearProgress(); renderNowPlaying(); _currentSong = null; updateSongTitle();
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
      clearPlayer();
      _showPlayerShield(true, "Waiting for the next song…");
      clearProgress();
      _currentSong = null;
      updateSongTitle();
      renderNowPlaying();
      return;
    }
    // A live instance: if it is the one we finished, we are still waiting — hold the settled state
    // rather than tearing it down and rebuilding it on the next tick.
    if (np.pi && np.pi === _endedPi) return;
    _endedPi = null;
    // The player can report no song when none has ever loaded yet, right after it
    // was stopped (clearPlayer()), or transiently during a fast swap. The old read here had
    // no guard for that and threw, which StreamManager's per-subscriber
    // try/catch swallowed silently (logged as a warn) — so this whole function
    // would abort before ever reaching loadSong(), leaving the player stuck on
    // the previous song with no further error and no retry. This is the actual
    // cause behind "I skipped but the other person stays on the old song."
    let currentId = null;
    if (player) {
      try {
        currentId = player.song();   // the key of what the player shows, compared with the room's key below
      } catch (e) { /* player not in a state to report video data yet — treat as no video loaded */ }
    }
    // A NEW PLAY reloads, even of the same video (owner's test, `ddjp_534`): keyed by video alone, a replay was never
    // loaded and the first play's ENDED ended it.
    if (np.pi && np.pi !== _lastPlayPi) {
      if (_lastPlayPi) _plog("play " + _lastPlayPi + " had " + (_loadsByPi[_lastPlayPi] || 0) + " load(s)");
      _lastPlayPi = np.pi;
    }
    let _why = _loadReason(np, currentId, _currentSong);
    // THE PLAYER SHOWING ANOTHER SONG BY ITSELF, the room's song and play unchanged (`ddjp_714`): not a new song for this path to
    // load quietly — the check's to correct, and to say (`Player: corrected …`), right after this.
    if (_why === "song-changed" && currentId && _currentSong && np.pi && _currentSong.pi === np.pi && _currentSong.songKey === np.song.songKey &&
        typeof player.check === "function") _why = null;
    if (_why && !SongPlayer.plays(np.song.songKey)) {
      // NO SERVICE'S PLAYER PLAYS IT: nothing is loaded and nothing is claimed — the previous song stops, the title is empty —
      // and the log says so once per play, since this branch is reached on every tick of that play.
      if (_notPlayablePi !== np.pi) {
        _notPlayablePi = np.pi;
        _currentSong = null;
        clearPlayer(); clearProgress(); updateSongTitle();
        Logger.warn("Player: not loading " + JSON.stringify(np.song.songKey) + " pi=" + np.pi + " — no song player plays it: a " +
          "song is named by its service and its id, and this name holds no service the page has");
      }
      return;
    }
    if (_why) {
      _currentSong = { songKey: np.song.songKey, dj: np.dj, startedAt: np.startedAt, pi: np.pi || null };
      // ── THE ONE PLACE THE BOT DIFFERS FROM ANY OTHER OWNER ──────────────────────────────
      // With its view off, the room's bot does not LOAD the media. That is the whole of the
      // difference: `playback.js` holds no bot rule at all, and everything the deleted rules used
      // to buy falls out of there being no player — no measured duration, so no length declared (no device
      // ends a song by its own length: the room's clock does, `ddjp_711`); no `onError`, so no `ddjp.play.blocked`. The second matters
      // beyond traffic: blocked reports feed the auto-skip roads, so a deliberate non-watcher
      // reporting "blocked" would help vote off a song everyone else can see fine.
      //
      // ASKED AT LOAD TIME, NOT CACHED. Both halves can change while the page is open — the
      // setting from this panel, and bot-ness from `_evaluateBot` on any rank change — and the
      // next song asks again.
      if (_botViewOff()) {
        _currentSong = null;   // nothing was loaded, so do not claim a song is on this player
        updateSongTitle();
        if (refs.progressFill) refs.progressFill.style.width = "0%";
        // The room IS playing: the cover says this tab's playback is off, never "Nothing playing" (J112, `ddjp_620`).
        if (_idleLabel !== COVER_BOT_OFF_LABEL) _showPlayerShield(true, COVER_BOT_OFF_LABEL);
        return;
      }
      loadSong(np.song.songKey, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, _why);
      updateSongTitle();
      // New video — snap the bar back to 0 right away so a skip visibly restarts
      // it, instead of holding the previous song's width until the player catches up.
      if (refs.progressFill) refs.progressFill.style.width = "0%";
    }
    // THE 10 s CHECK is the plug's since `ddjp_714` (`_checkPlayer`, below): never during the hold, never past the player's own
    // length less 1 s (`ddjp_711`: the parked "seek to 600.0 s in a 339 s song every 2 s").
    // A real song is playing — make sure the live-read progress loop is running.
    // It reads the player directly each frame, so it follows skips/seeks itself.
    if (np.song) { startProgress(); _showPlayerShield(false); }
    if (refs.npLabel && np.elapsed !== undefined) {
      // The PLAYER's position when it reports one — the number the bar and the frame loop use — and
      // the room's elapsed only until it does (a song just starting, a buffer). One clock on screen.
      const pt = getPlayerTime(), pd = _readPlayerDuration();
      const live = pt !== null && isFinite(pt) && pd > 0;
      _setNpLabel(np.dj, live ? _npTimeText(pt, pd) : _npTimeText(np.elapsed, np.duration));
    }
    // NOTE: volume/mute is NO LONGER force-re-asserted every tick — that would
    // overwrite a change the user makes inside the YouTube iframe. Two-way sync is
    // handled by _pollPlayerVolume (adopts in-iframe changes) plus re-assertion on real
    // player transitions (onReady / onStateChange / load).
  }

  // Push player-sourced title/duration onto every already-rendered row for this
  // video. The now-playing room-queue row (and a freshly-played History row) get
  // built the instant the song starts — before YouTube's IFrame API reports the
  // title — so they show the bare songKey. Nothing else re-reads metadata for an
  // existing row, so when the title finally lands we apply it directly. Titles are
  // regenerable CACHE, never truth (storage law), so this is display-only.
  function _applyMetaToRows(songKey, title, durationSec) {
    if (!refs.queueBody || !songKey) return;
    const esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(songKey) : songKey;
    refs.queueBody.querySelectorAll('.song-row[data-vid="' + esc + '"]').forEach((row) => {
      if (title) { const t = row.querySelector(".sr-title"); if (t) { t.textContent = title; t.title = title; } }
      if (typeof durationSec === "number" && durationSec > 0) {
        const d = row.querySelector(".sr-dur"); if (d) d.textContent = PlaylistPanels._fmtDur(durationSec);
      }
    });
  }

  // Push the player-sourced title + duration into the metadata cache when a song
  // is witnessed playing (14 §3: the player is a robust title source and the only
  // duration source). This is what makes a WITNESSED play "known/stored" — its
  // metadata is cached, so it shows full in History/Room queue and never refetches.
  function _pushPlayerMeta(songKey) {
    if (typeof MetadataService === "undefined" || !songKey) return;
    try {
      const title = player ? player.title() : null;
      const dn = player ? player.length() : 0;
      const dur = (typeof dn === "number" && isFinite(dn) && dn > 0) ? dn : null;
      // ONE combined write — recording title and duration separately raced on the
      // same Store.meta record and the title kept getting clobbered, so it never
      // persisted and every re-render / History read fell back to the songKey.
      if ((title || dur) && MetadataService.recordMeta) {
        const fields = {};
        if (title) fields.title = title;
        if (dur) fields.durationSec = dur;
        Promise.resolve(MetadataService.recordMeta(songKey, fields))
          .then(() => { _applyMetaToRows(songKey, title, dur); })
          .catch(() => { _applyMetaToRows(songKey, title, dur); });
      } else {
        _applyMetaToRows(songKey, title, dur);
      }
    } catch (e) { /* player not ready to report yet — a later poll/tick will catch it */ }
  }

  function updateSongTitle() {
    if (!refs.songTitle || !refs.songTitleText) return;
    if (!_currentSong) { refs.songTitleText.textContent = ""; _fitMarquee(); return; }
    // A player may only know the real title once it has buffered the song (`title()`); until then, fall back to the
    // song's own id so something is shown immediately instead of staying blank — the service's own id, as a person read it
    // before song keys (`Songs.shownAs`), never the key.
    const realTitle = player ? player.title() : null;
    refs.songTitleText.textContent = realTitle || Songs.shownAs(_currentSong.songKey);
    _fitMarquee();
    if (realTitle) _pushPlayerMeta(_currentSong.songKey);   // witnessed → store player-sourced meta
    // The real title is often not ready at the moment this first runs (right at
    // PLAYING). If we only had the ID, poll a few times for the real title and
    // re-fit the marquee once it lands.
    if (!realTitle) {
      const want = _currentSong.songKey;
      let n = 0;
      const poll = () => {
        if (!_currentSong || _currentSong.songKey !== want) return;   // song changed — stop
        const vt = player ? player.title() : null;
        if (vt) {
          refs.songTitleText.textContent = vt;
          _fitMarquee();
          _pushPlayerMeta(want);                          // witnessed → store once the title lands
          return;
        }
        if (++n < SONG_META_MAX_POLLS) setTimeout(poll, SONG_META_POLL_MS);
      };
      setTimeout(poll, SONG_META_POLL_MS);
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
    const box = boxEl || refs.songTitle, txt = txtEl || refs.songTitleText;
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

  // THE ROOM'S BOX PLAYER, MADE THROUGH THE PLUG ON EVERY ROOM ENTRY (its name is step 3's to change): in the box the shell
  // builds, empty and muted until the room's song is loaded — each service's player inside it, made as its file makes it.
  function initSongPlayer() {
    // ── WHAT THE PLAYER SAYS RIGHT NOW ───────────────────────────────────────────────────
    // A PROVIDER, NOT A PUSH. The song and the length are read TOGETHER and only when somebody
    // actually asks — which is what lets Playback re-read at the moment it declares instead of
    // sending a number captured when the song started. During a swap a player can accept the new
    // song at once while its length is still the PREVIOUS song's, so a read taken at PLAYING can be
    // "right song, wrong number"; a read taken a moment later is not. The reading is the plug's
    // (`reading()`): a key and seconds, or null wholesale when no key names what is showing.
    // The UI stays dumb here — it reports what the player says and makes no protocol decision.
    player = null;
    Playback.setDurationProvider(() => (player ? player.reading() : null));
    player = SongPlayer.make(refs.player, { startMuted: true }, { ready: _onPlayerReady, state: _onPlayerState, failed: _onPlayerFailed });
    _startChecks();
  }
  // ── ↻ HELD: THE WHOLE PLAYER, REBUILT (`ddjp_712`, the owner's: "if we keep the button pressed and that reloads the whole
  // player") ── For a player that has gone wrong in a way a reload does not fix. The box player goes — every service's player
  // in it destroyed and the box emptied — and a new one is made as the room's entry makes it (`initSongPlayer`); what this
  // file remembered about the old one (the song loaded, a held end, a load waiting) is forgotten; then the room's own push is
  // driven again, so the song loads at the room's point, or the held end or "nothing playing" is shown again. With nothing
  // playing it still rebuilds the empty player, for troubleshooting. Nothing goes to the room. An event the old player sends
  // after this — a late end, an error — names the old box player (`bp`) and each handler below ignores it; a caller
  // that names none is heard, as before.
  function rebuildPlayer() {
    const old = player;
    _wantSong = null;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
    player = null;
    try { if (old) old.destroy(); } catch (e) {}
    try { if (refs.player) refs.player.replaceChildren(); } catch (e) {}
    _currentSong = null; _endedPi = null; _heldPi = null; _notPlayablePi = undefined; _loadAsk = null;
    initSongPlayer();
    Logger.info("Player: rebuilt by hand");
    if (_lastNp) _driveNowPlaying(_lastNp);
    else updateSongTitle();
  }
  function _onPlayerReady(bp) {
    if (bp && player && bp !== player) return;   // from a player rebuilt away (`rebuildPlayer`)
    Logger.debug("Interface: player ready");
    applyVolumeState();   // enforce the user's chosen volume immediately on ready
    _startPlayerVolumePoll(); // begin two-way volume/mute sync with the player
  }
  function _onPlayerState(word, bp) {
    if (bp && player && bp !== player) return;   // from a player rebuilt away (`rebuildPlayer`)
    const t = bp || player;
    try { _plog(word + " " + (t && t.song()) + " loading=" + (t && t._ddjpLoadingPi) + " playing=" + (t && t._ddjpPlayingPi)); } catch (x) {}
    try { _noteLoadState(word, t); } catch (x) {}   // the load's own line at its first "playing" (diagnostic only)
    if (word === "playing") { try { t._ddjpPlayingPi = t._ddjpLoadingPi || null; } catch (x) {} }   // this load is now the one playing
    // ITS SONG UP AND NOT STARTED ("cued", before this load's first "playing"; `ddjp_715`): the length is declared now, as at
    // "playing" — the owner's words: "the device needs to send length from the song barely attempting to play at all even if it
    // looks or waits for a click". The player names the song only for the load it is on (SoundCloud's, by that load's number),
    // and Playback asks it again when it sends, so it is never an earlier song's length.
    let firstCued = false;
    try { firstCued = word === "cued" && !!t._ddjpLoadingPi && t._ddjpPlayingPi !== t._ddjpLoadingPi; } catch (x) { firstCued = false; }
    if (firstCued) {
      const d = player.length(), k = player.song();
      if (d && k) Playback.setDuration(k, d);
    }
    if (word === "playing") {
      const d = player.length(), k = player.song();
      if (d && k) Playback.setDuration(k, d);
      updateSongTitle();      // title is often only available once playing
      applyVolumeState();      // re-assert on every state transition
    } else if (word === "ended") {
      // THIS PLAYER REACHED ITS END — a wake-up for the room's clock, never the decision (`ddjp_711`): the room ends the
      // song at its agreed length. Forwarded down with the song and the play it was on; Playback answers what this device
      // does: "reload" (an early end — once per play, at the room's point; SoundCloud's in a fresh frame), "hold" (a normal
      // end, or a second early one: the room's push carries `ended` and the box waits), or null (not this song). We stay
      // dumb here — no protocol decision in the UI. The player can report nothing mid-swap, so guard the read.
      let endedId = null;
      try { endedId = player.song(); } catch (e2) { /* player not in a state to report yet */ }
      let endedPi = null;
      try { endedPi = (t && t._ddjpPlayingPi) || null; } catch (x) {}
      const verdict = Playback.notifyEnded(endedId, endedPi);   // the play the player last reported "playing" for
      if (verdict === "reload") _reloadAtRoomPoint(endedId, endedPi);
      else if (verdict === "hold" && endedPi) _heldPi = endedPi;   // held here until the room's push says so (the check holds it silent)
    }
  }
  // ── WHAT THE ROOM'S PLAYER SHOULD BE, FROM THE ROOM AND THIS DEVICE ALONE (`ddjp_714`; the plug's check, `ui/songplayer.js`) ──
  // The room's song by its key — none when nothing plays, when no service's player plays it, or on the bot's tab with its
  // playback off; whether it is HELD (the room's push says its end came, or this player reached its end and Playback said
  // hold); the room's point, asked when the check runs (`Playback.elapsedSec`, the shared clock); whether a song preview holds
  // the room's player (`aside`); and the length this player measured for the song (`Playback.knownDurationFor`: the seek never
  // goes past it less 1 s). This device's volume is the box's own, given by `applyVolumeState`.
  let _heldPi = null;        // the play this player reached its end on and Playback said hold (until the room's push says so)
  function _wantOf(np) {
    let aside = false;
    try { aside = !!(typeof PlaylistPanels !== "undefined" && PlaylistPanels.previewActive && PlaylistPanels.previewActive()); } catch (e) { aside = false; }
    if (!np || !np.song) return { song: null, held: false, aside: aside, at: null, len: null };
    const key = np.song.songKey;
    const held = !!np.ended || (!!np.pi && (np.pi === _endedPi || np.pi === _heldPi));
    const plays = SongPlayer.plays(key) && !_botViewOff();
    let len = null;
    try { if (typeof Playback.knownDurationFor === "function") len = Playback.knownDurationFor(key); } catch (e) { len = null; }
    // THE ROOM'S POINT NOW: the push's own `elapsed` (the shared clock's, as Playback gave it) plus the time since that push — at
    // the push itself exactly what the 10 s check always compared with; from the 2 s timer or a player's event, moved on since.
    const t0 = (np === _lastNp && typeof _lastNpAt === "number" && _lastNpAt > 0) ? _lastNpAt : Date.now();
    const at = (np.elapsed !== undefined && np.duration) ? () => np.elapsed + Math.max(0, Date.now() - t0) / 1000 : null;
    return { song: plays ? key : null, held: held, aside: aside, at: at, len: (typeof len === "number" && len > 0) ? len : null };
  }
  // What the check asks back of this file: the room's song loaded by this file's own path (its retries, its log line, its
  // play), and a volume the person set inside the shown player's frame taken as this device's.
  const _act = {
    load: (key, why) => {
      const np = _lastNp;
      if (!np || !np.song || np.song.songKey !== key) return false;
      // A load of it already waiting here for the player to be ready goes now — not a correction.
      if (_wantSong && _wantSong.songKey === key && _loadTimer) { _doLoad(); return false; }
      loadSong(key, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, "corrected");
      return true;
    },
    chose: (level, muted) => _adoptVolume(level, muted),
  };
  function _checkPlayer(np) {
    if (!player || typeof player.check !== "function") return;
    try { player.check(_wantOf(np), _act); } catch (e) { /* a check that throws never stops the room's drive */ }
  }
  // EVERY 2 s WHILE IN THE ROOM (`ddjp_714`), beside every push and every player event: in a hidden tab, where this timer is
  // held back, the room's messages and 711's end timer still bring pushes, so the check still runs.
  const CHECK_MS = 2000;
  let _checkTimer = null;
  function _startChecks() {
    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer = setInterval(() => { if (player) _checkPlayer(_lastNp); }, CHECK_MS);
    _watchTab(true);
  }
  // THE TAB HIDDEN AND SHOWN, IN THE LOG, while in a room (`ddjp_715`): `Player: tab hidden` and `Player: tab shown (hidden 4m12s)`,
  // so a log says which songs came while the tab was behind another — the owner's report was about background tabs, and his log
  // could not say when the tab was hidden.
  let _hiddenAt = null, _tabWatched = false;
  function _span(ms) {
    const all = Math.max(0, Math.round(ms / 1000)), m = Math.floor(all / 60), sec = all % 60, h = Math.floor(m / 60);
    const two = (n) => (n < 10 ? "0" : "") + n;
    return h > 0 ? h + "h" + two(m % 60) + "m" : (m > 0 ? m + "m" + two(sec) + "s" : sec + "s");
  }
  function _onTab() {
    if (!_tabWatched) return;   // the room left: says nothing
    let hidden = false;
    try { hidden = document.visibilityState === "hidden"; } catch (e) { return; }
    if (hidden && _hiddenAt === null) { _hiddenAt = Date.now(); Logger.info("Player: tab hidden"); }
    else if (!hidden && _hiddenAt !== null) { const ms = Date.now() - _hiddenAt; _hiddenAt = null; Logger.info("Player: tab shown (hidden " + _span(ms) + ")"); }
  }
  function _watchTab(on) {
    try {
      if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
      if (on && !_tabWatched) { document.addEventListener("visibilitychange", _onTab); _tabWatched = true; _onTab(); }   // hidden at entry: said
      else if (!on && _tabWatched) { document.removeEventListener("visibilitychange", _onTab); _tabWatched = false; _hiddenAt = null; }
    } catch (e) { /* no page: a guard's sandbox */ }
  }
  // LEAVING THE ROOM (`ui/shell.js` `_bgLeaveRoom`, `ddjp_714`): the check stops, and the box lets go of what it keeps —
  // SoundCloud's frame goes out of the page; YouTube's player, stopped by `clearPlayer` before this, stays as it always did.
  function releasePlayer() {
    if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
    _watchTab(false);
    try { if (player && typeof player.release === "function") player.release(); } catch (e) {}
  }
  // AN EARLY END, LOADED ONCE MORE AT THE ROOM'S POINT (`ddjp_711`): the room's own push, so the point is asked at the load.
  function _reloadAtRoomPoint(songKey, pi) {
    const np = _lastNp;
    if (!np || !np.song || np.song.songKey !== songKey || (pi && np.pi !== pi)) return;
    loadSong(np.song.songKey, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, "ended-early");
  }
  // ── THE PLAYER COULD NOT PLAY THE SONG (J41) ──────────────────────────────────────────────────
  // The other thing a player can tell us, and for most of this project's life the only one nobody
  // listened for. Without it nothing ever called MediaBlocked, so no client authored a
  // ddjp.play.blocked, the skip road tally was permanently zero, and the availability escape could
  // not fire in a live room — while every guard on that feature stayed green, because they drive the
  // module at its second and fourth steps and the missing first one is invisible from either end.
  //
  // FORWARD THE FACT, LET THE FEATURE DECIDE — exactly the notifyEnded contract above, applied to
  // the other signal. We stay dumb here: no play instance (that is protocol, and ui/ may not read
  // StreamManager at all), no rank. Two facts go down — the app's reason the service's player gave
  // (its own code never leaves its file, decision 4) and the song the player says is showing — and
  // MediaBlocked decides whether either means anything. A player can report nothing mid-swap, and a
  // missing key makes the feature decline rather than declare against the wrong song.
  function _onPlayerFailed(reason, bp, short, detail) {
    if (bp && player && bp !== player) return;   // from a player rebuilt away (`rebuildPlayer`)
    let erroredId = null;
    try { erroredId = player.song(); } catch (e2) { /* player not in a state to report — the feature declines */ }
    try { _plog("failed: " + (reason || "no reason the app knows") + " " + erroredId + (detail ? " (" + detail + ")" : "")); } catch (x) {}
    MediaBlocked.notifyPlayerFailed(reason, erroredId);
  }

  // The latest video we actually want playing. loadSong only ever records this
  // and asks _doLoad to reconcile — so if the player isn't ready yet (e.g. during
  // the replay burst, which fires many state changes before YouTube is up), the
  // pending retry loads the CURRENT desired video, never a stale one captured
  // when an intermediate replay state flashed by. This is what kept one client
  // (whose player happened to become ready mid-replay) stuck on a much earlier
  // song while another, ready before the burst, showed the right one.
  let _wantSong = null;     // { songKey, startedAt } or null = nothing
  let _loadTimer = null;
  // Ask the runtime. The decision lives in `BotRuntime.viewOff` so a guard can DRIVE it with all
  // four combinations instead of regexing this file — an earlier source-level check matched the
  // defensive `typeof` lines rather than the logic, and deleting either real check left it green.
  function _botViewOff() {
    try { return !!(typeof BotRuntime !== "undefined" && BotRuntime.viewOff && BotRuntime.viewOff()); }
    catch (e) { return false; }
  }

  // WHICH PLAY THE PLAYER IS ON (owner's test). The player's "ended" carries no play, and a late one from the previous
  // load can arrive after the next load was asked for; it is attributed to the play last reported "playing". The play
  // rides ON THE BOX PLAYER (`_ddjpLoadingPi`, `_ddjpPlayingPi`), so the state handler needs nothing outside its event.
  // THE LOAD DECISION, NAMED so a guard can run the shipped one: a NEW PLAY loads, even of the same video.
  // Which branch asks for a load — logged, so a live log names it (owner's report, `ddjp_536`).
  function _loadReason(np, currentId, cur) {
    if (!(np && np.song)) return null;
    // A LOAD IN FLIGHT FOR THIS PLAY COUNTS AS LOADED (owner's report, `ddjp_536`): until it has loaded, the player reports
    // the OLD song, so every redraw read "video-changed" and asked for the load again — each call restarting the load,
    // which never finished. `tests/check-player-load-once.js` drives it.
    try {
      if (player && np.pi && player._ddjpLoadingPi === np.pi && player._ddjpLoadingVid === np.song.songKey &&
          player._ddjpPlayingPi !== np.pi) return null;
    } catch (e) {}
    if (np.song.songKey !== currentId) return "song-changed";
    if (!cur) return "no-current";
    if (np.pi && cur.pi !== np.pi) return "pi-changed";
    return null;
  }
  // RATE-LIMITED PLAYER DIAGNOSTICS: at most 30 lines in 10 s; what is held back is counted and reported.
  let _plogWin = 0, _plogN = 0, _plogHeld = 0;
  const _loadsByPi = Object.create(null);
  let _lastPlayPi = null;
  function _plog(m) {
    try {
      const now = Date.now();
      if (now - _plogWin > 10000) { if (_plogHeld) Logger.info("Player: " + _plogHeld + " diagnostic line(s) held back"); _plogWin = now; _plogN = 0; _plogHeld = 0; }
      if (_plogN++ < 30) Logger.info("Player: " + m); else _plogHeld++;
    } catch (e) {}
  }
  // ── WHAT A LOAD TOOK (diagnostic lines only, `ddjp_627`: the owner's "black for about 5 seconds on almost every new song") ──
  // When the app asked for this play's song, from what point, and every state the player reported until it first played — said
  // ONCE, at that first "playing", so "the service was slow to start" reads as one line with its milliseconds, and "the app asked
  // twice" or "seeked during the load" read as the load count and the seek line below. Nothing here changes what the player does.
  // In the plug's words (decision 6): the song by its key, the states by name.
  let _loadAsk = null;   // { pi, vid, at, start, states, done } — the latest load
  function _noteLoadState(word, t) {
    if (!_loadAsk || _loadAsk.done) return;
    _loadAsk.states.push(word);
    if (word !== "playing") return;
    _loadAsk.done = true;
    let at = null;
    try { const p = t || player; at = p ? p.time() : null; } catch (x) { at = null; }
    _plog("playing pi=" + _loadAsk.pi + " " + _loadAsk.vid + " " + (Date.now() - _loadAsk.at) + " ms after its load (asked start=" +
      _loadAsk.start.toFixed(1) + "s, playing from " + ((typeof at === "number" && isFinite(at)) ? at.toFixed(1) + "s" : "?") +
      "; states since: " + _loadAsk.states.join(",") + ")");
  }
  // A PROVIDER, NOT A VALUE. `_doLoad` retries while the player is not ready, so a captured number
  // is stale by however long the wait lasted and the player lands behind by exactly that. It showed
  // as the owner sitting slightly further back than a guest — the owner has replay, floor and
  // checkpoint work to finish on load, so it waits longer and drifts further. Asking again at the
  // moment of the actual load costs nothing and cannot go stale.
  function loadSong(songKey, startedAt, elapsedAt, pi, reason) {
    _wantSong = { songKey: songKey, startedAt: startedAt, elapsedAt: elapsedAt, pi: pi || null, reason: reason || null };
    _doLoad();
  }
  function _doLoad() {
    if (!_wantSong) return;
    if (!player || !player.ready(_wantSong.songKey)) {
      if (!_loadTimer) _loadTimer = setTimeout(() => { _loadTimer = null; _doLoad(); }, PLAYER_LOAD_RETRY_MS);
      return;
    }
    const w = _wantSong;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }   // loading now: a retry still waiting would load it twice
    // ── SEEK IN SERVER TIME, NOT LOCAL TIME ──────────────────────────────────────────────
    // This computed `(Date.now() - w.startedAt) / 1000`. `startedAt` is a SERVER timestamp, so
    // subtracting the raw local clock yields the true elapsed PLUS this device's clock skew — and
    // every client seeks to a different point in the same song. Observed live: a late joiner and a
    // reloaded client both landed behind while the room still ADVANCED in step, because the
    // schedule comes from startedAt + the agreed length in shared server time. The playhead was
    // wrong; the timing never was, which is why it read as a sync bug rather than a clock one.
    //
    // Playback's elapsed helper already computes this in shared server time, so it is asked first.
    // (An earlier comment here said boundary rule D forbade that. Rule D never listed it, and the owner
    // ruled at ddjp_423 that ui/ may read the shared clock, as three other ui/ files already do.)
    // Asked HERE, not when the intent was recorded — see the note on loadSong.
    let elapsed = null;
    try { if (typeof w.elapsedAt === "function") elapsed = w.elapsedAt(); } catch (e) { elapsed = null; }
    if (typeof elapsed !== "number" || !isFinite(elapsed)) {
      // Fallback until Playback can answer — in SERVER time too: `startedAt` is a homeserver stamp,
      // and a device clock minutes off would start the song minutes early or late (README trap 2).
      elapsed = (((typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : Date.now()) - w.startedAt) / 1000;
    }
    try { player._ddjpLoadingPi = w.pi || null; player._ddjpLoadingVid = w.songKey; } catch (e) {}   // the play and song this load is for; "playing" makes it the playing one
    if (w.pi) _loadsByPi[w.pi] = (_loadsByPi[w.pi] || 0) + 1;
    _plog("load " + w.songKey + " pi=" + w.pi + " reason=" + (w.reason || "?") + " start=" + Math.max(0, elapsed).toFixed(1) + "s (#" + (w.pi ? _loadsByPi[w.pi] : "?") + " for this play)");
    _loadAsk = { pi: w.pi || null, vid: w.songKey, at: Date.now(), start: Math.max(0, elapsed), states: [], done: false };   // diagnostic only
    player.load(w.songKey, Math.max(0, elapsed));   // the key: the plug hands its service's player the service's own id
    // Apply the user's actual chosen state — NOT an unconditional unmute.
    // (Previously this always force-unmuted after load, which would silently
    // override a user who had chosen to mute. The player starts muted only to
    // satisfy browser autoplay policy; applyVolumeState corrects it right after.)
    setTimeout(() => applyVolumeState(), VOLUME_APPLY_DELAY_MS);
  }

  // ↻ TAPPED (`ddjp_712`): the song again AT THE ROOM'S POINT, directly — as an early end's reload does
  // (`_reloadAtRoomPoint`) — where it loaded from 0 and the 10 s check then moved it. In THIS browser only: nothing goes to
  // the room. With no song loaded here (nothing playing, a held end, the bot's tab), nothing, as before.
  function reloadCurrentSong() {
    const np = _lastNp;
    if (!_currentSong || !player || !np || !np.song || np.song.songKey !== _currentSong.songKey || !SongPlayer.plays(np.song.songKey)) return;
    loadSong(np.song.songKey, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, "reload-by-hand");
  }

  // Push the local volume/mute state onto the actual player. Safe to call
  // anytime — no-ops if the player isn't ready yet.
  function applyVolumeState() {
    if (!player || !player.ready()) return;
    try {
      // THIS DEVICE'S VOLUME, given to the box (`ddjp_714`): it keeps it, gives it to the player it shows (not held), and
      // remembers what it gave, so a change made inside that player's own frame tells itself apart from these writes.
      player.setVolume(volumeState.level);
      if (volumeState.muted || volumeState.level === 0) player.mute();
      else player.unmute();
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

  // Two-way sync: poll the shown player's own volume/mute. If they differ from what the box last gave it, the person changed
  // them in the player's own controls — adopt those values into our state + UI (don't fight them). A player may expose no
  // volume-change event, so polling is the way to observe in-frame changes. What was given is the box's record since
  // `ddjp_714` (`chosenVolume`, `ui/songplayer.js`), so the check's own writes — a player stepped aside or held, at 0 — are
  // never taken for the person's; and SoundCloud's in-frame volume is read back now too (its widget's `getVolume`).
  function _pollPlayerVolume() {
    if (!player || !player.ready() || typeof player.chosenVolume !== "function") return;
    let got = null;
    try { got = player.chosenVolume(); } catch (e) { return; }
    if (got) _adoptVolume(got.level, got.muted);
  }
  function _adoptVolume(level, muted) {
    volumeState.level = Math.round(level);
    volumeState.muted = !!muted;
    _syncVolumeUI();                            // reflect into our controls (no re-push)
    // And remember it, as a change on our own slider is (J134) — but only if a PERSON could have made it (J135). A reload where
    // nothing is touched can start the player silent (the browser's autoplay rule), and the poll sees that as a change made in
    // YouTube's frame; saved, it became this person's mute and the next reload started at 🔇. A page that has had no activation
    // has had no click in YouTube's frame either (activation there reaches the frames above it), so its change is shown — 🔇 is
    // the truth — and never saved. Without the API, nothing adopted is saved.
    if (_personHasActed()) rememberVolumeState();
  }
  function _personHasActed() {
    try { return !!(typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive); }
    catch (e) { return false; }
  }
  // THE MAIN PLAYER'S SOUND, REMEMBERED ON THIS DEVICE (J134; the owner, asked whether it should survive a reload: "yes"). Saved
  // where a person changes it — its slider, its 🔊, and inside YouTube's frame (adopted above, when a person can have done it:
  // J135) — once per value (`ChatPrefs`' `_saveIfMoved`), and seeded into `volumeState` when the main screen is built
  // (ui/shell.js), so a reload keeps it.
  function rememberVolumeState() {
    try { ChatPrefs.setPlayerVolume(volumeState.level); ChatPrefs.setPlayerMuted(volumeState.muted); } catch (e) { /* no prefs: as before */ }
  }
  function _startPlayerVolumePoll() {
    if (_playerVol.pollTimer) return;
    _playerVol.pollTimer = setInterval(_pollPlayerVolume, PLAYER_VOLUME_POLL_MS);
  }

  // EVERY SEEK SAYS WHY: the 10 s check is the plug's since `ddjp_714`, and its line is `Player: corrected <service> — the
  // player at … s, the room at … s: more than 10 s apart (sought to … s)`.
  function getPlayerTime() { if (!player || !player.ready()) return null; try { return player.time(); } catch (e) { return null; } }
  function clearPlayer() {
    _wantSong = null;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
    if (player && player.ready()) player.stop();
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  //
  // What the other ui/ files may call. The three accessors exist because `player`
  // and `_lastNp` are rebound in this file and read in ui/playlists.js — a
  // `let` cannot be shared across files, and a second copy of a scalar describing
  // one thing is a copied rule wearing different clothes.
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    applyCover, togglePlayerHidden, toggleOverlayBlocked,
    // background engine
    _applyDisplayDims, _setDimVar, _bgUnpaint, _bgApplyToggle, _bgOnSetting, _bgEnterRoom,
    // now playing
    renderNowPlaying, _driveNowPlaying, _applyMetaToRows,
    // player
    onPlaybackStateChange, initSongPlayer, reloadCurrentSong, rebuildPlayer, applyVolumeState, rememberVolumeState,
    clearPlayer, clearProgress,   // J83: the room's leave stops the player (`ui/shell.js` `_bgLeaveRoom`)
    releasePlayer,                // `ddjp_714`: and lets go of what it keeps (SoundCloud's frame), the check stopped
    _fitMarquee, _fitAllMarquees,
    // accessors over state this file owns
    instance: () => player,
    isReady: () => !!(player && player.ready()),
    lastNp: () => _lastNp,
  };
})();
