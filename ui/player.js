// ui/player.js
// PLAYER · NOW PLAYING · BACKGROUND ENGINE — extracted from ui/interface.js at ddjp_386
// as the first of the ten files roles.md §5 records. UI only, same rules as interface.js:
// no logic, no consensus, no direct Matrix or stream access, and all DOM built with
// createElement / textContent so no network-derived string is ever interpreted as HTML.
//
// ── BACKGROUND ENGINE IS SPLIT ACROSS TWO FILES, DELIBERATELY ─────────────────────────
// `_bgLeaveRoom` sits under the BACKGROUND ENGINE banner in ui/interface.js and did NOT
// come here. It is room TEARDOWN: it writes six misclick-lock variables and calls
// `_thumbReset`. Owner ruling at ddjp_386, and the principle generalises —
// **the banner is a reading aid; the cluster is an ownership unit.** A function under a
// banner is not necessarily of that banner's cluster. `_bgLeaveRoom` owns teardown of the
// shell's locks, so it belongs with `ui/shell.js`; moving it here would have this file
// writing six of shell's variables and calling into ui/playlists.js, which is the exact
// coupling the ten-file grouping exists to prevent.
//
// It stays in ui/interface.js and calls back in here for `_bgUnpaint`. That one call is
// the whole of the reverse dependency, and it is named at both sites rather than left for
// a reader to discover — a comment claiming two files agree is not the same as them
// agreeing, which is this tree's eighth signature.
//
// ── WHAT REACHES ACROSS, AND WHY IT IS NOT A COPY ─────────────────────────────────────
// `refs` and the shared state objects come from `ui/base.js`. The primitives this file
// needs but that have not moved yet come through `UIBase.host`, published by
// ui/interface.js. Neither is duplicated here: a copy inherits today's version of a fix
// and none of tomorrow's.
//
// Depends on: UIBase, Interface (via UIBase.host), Room, Playback, ChatPrefs, Logger,
// MetadataService, YT

const Player = (() => {

  const { refs, volumeState, _ytVol, _bg } = UIBase;
  const H = UIBase.host;      // el, clear, fmt, shortName, avatarEl, rankColor,
                              // _rosterLevel, _fmtDur, _syncNpButtons, previewActive

  // --- constants this cluster owns (nothing else in ui/ reads them) ----------
  const VIDEO_META_POLL_MS      = 500;   // poll interval while waiting for video metadata (title)
  const VIDEO_META_MAX_POLLS    = 10;    // give up reading metadata after this many polls
  const YT_INIT_RETRY_MS        = 500;   // retry YT Player init until the iframe API is ready
  const PLAYER_LOAD_RETRY_MS    = 500;   // retry a queued load until the player reports ready
  const VOLUME_APPLY_DELAY_MS   = 1000;  // re-apply the saved volume shortly after a (re)load
  const YT_VOLUME_POLL_MS       = 400;   // poll the player's volume to mirror external changes

  // --- state this cluster owns. `player` and `playerReady` are rebound HERE and
  // read by the preview mini-player in ui/interface.js, which goes through the
  // accessors at the bottom of this file rather than holding its own copy.
  let player = null, playerReady = false;
  let _lastNp = null;   // latest consensus now-playing, cached so preview re-syncs to LIVE on close
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
      refs.npAvatar = H.avatarEl(djId, 22);
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
    ChatPanels._syncNpButtons();   // keep the player-bar grab/upvote in step with the current song
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
      mid = " · " + H.fmt(elapsed);
    }
    _setNpLabel(np.dj, mid);
    if (!_currentSong || _currentSong.videoId !== np.song.videoId) {
      _currentSong = { videoId: np.song.videoId, dj: np.dj, startedAt: np.startedAt };
      updateVideoTitle();
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
    if (PlaylistPanels.previewActive()) return;   // detached during preview: track, don't drive
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
    H.clear(refs.playerShield);
    if (waiting) refs.playerShield.appendChild(H.el("span", { class: "shield-note", text: label }));
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
      _setNpLabel(np.dj, " · " + H.fmt(np.elapsed) + (np.duration ? " / " + H.fmt(np.duration) : ""));
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
        const d = row.querySelector(".sr-dur"); if (d) d.textContent = PlaylistPanels._fmtDur(durationSec);
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
  // ══ EXPORTS
  //
  // What ui/interface.js may call. The three accessors exist because `player`,
  // `playerReady` and `_lastNp` are rebound in this file and read in that one — a
  // `let` cannot be shared across files, and a second copy of a scalar describing
  // one thing is a copied rule wearing different clothes.
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    // background engine
    _applyDisplayDims, _setDimVar, _bgUnpaint, _bgApplyToggle, _bgOnSetting, _bgEnterRoom,
    // now playing
    renderNowPlaying, _driveNowPlaying, _applyMetaToRows,
    // player
    onPlaybackStateChange, initYouTubePlayer, reloadCurrentVideo, applyVolumeState,
    _fitMarquee, _fitAllMarquees,
    // accessors over state this file owns
    instance: () => player,
    isReady: () => playerReady,
    lastNp: () => _lastNp,
  };
})();
