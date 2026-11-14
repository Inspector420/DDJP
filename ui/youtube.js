// ui/youtube.js — YouTubePlayer: YouTube's player, behind the song players' plug (`ui/songplayer.js`; J29, step 2)
//
// THE ONE FILE THAT KNOWS YOUTUBE'S PLAYER: its script and the hook it calls when it is up, `YT.Player`, its numbered states,
// its error codes and its calls. Everything else plays a song through the plug, by its key (`core/songs.js`), and reads back
// the plug's words. `core/songs.js`'s YouTube row names this file and the hosts the page lets it reach.
//
// ── ITS SCRIPT, LOADED WHERE THE PAGE ALWAYS LOADED IT ───────────────────────────────────────────────────────────────────
// This file's tag sits where `index.html`'s tag for YouTube's script sat — the top of the page's body — so the request goes out
// at the same moment (the supervisor's decision 7). It owns the hook the script calls once it is up.
//
// ── THE CALLS, THE SAME AS BEFORE THE PLUG (decision 5) ──────────────────────────────────────────────────────────────────
// Each thing the plug asks is the one call the room's player and the preview made before: a load is `loadVideoById`, a seek
// `seekTo(s, true)`, the song showing `getVideoData().video_id`, its title `getVideoData().title`, the time `getCurrentTime`,
// the length `getDuration`, the volume `setVolume`/`mute`/`unMute`/`getVolume`/`isMuted`. So its readings are the player
// itself, as fresh as they ever were: every reading is the call, made when it is asked. The two players are made with the
// options each was made with: the room's empty, 300 high and muted; the preview's on its song, filling its box, inline,
// suggesting nothing after it (`rel: 0`), with YouTube's own bar (`controls: 1`, J136).
//
// ── ITS ERRORS, AS THE APP'S REASONS (decision 4) — THE TABLE MOVED HERE FROM `features/mediablocked.js` UNCHANGED ──────
// YouTube iframe error codes:
//   2   invalid parameter — a request problem, not the media. Conservative: local.
//   5   HTML5 player error — the embed would not come up. Local.
//   100 the video is gone (removed, private, never existed).
//   101 the uploader disallows embedding.
//   150 the same condition as 101, reported differently by different hosts.
// REGION BLOCKS ARRIVE AS 101/150 AND ARE REPORTED AS `embed-denied`. The protocol has a `region-blocked` token because a road
// counts both identically and a player that can tell them apart may use it; YouTube's cannot. An unrecognised code yields NO
// reason (null): untyped is the conservative answer the reducer already gives (it does not count). Whether the room's
// vocabulary knows a reason is `MediaBlocked`'s question, asked where the declaration is made.
//
// Depends on: SongPlayer (at load), YT (once its script is up), Logger (at call time)

const YouTubePlayer = (() => {
  "use strict";
  const SHORT = "yt";                       // its row in `core/songs.js`
  const API = "https://www.youtube.com/iframe_api";
  const INIT_RETRY_MS = 500;                // make the player once the script is up (it retried this way before the plug)
  const STATE_WORD = { "-1": "unstarted", "0": "ended", "1": "playing", "2": "paused", "3": "buffering", "5": "cued" };
  const _REASON_FOR_CODE = {
    2:   "player-failed",
    5:   "player-failed",
    100: "unavailable",
    101: "embed-denied",
    150: "embed-denied",
  };
  function reasonFor(code) { return _REASON_FOR_CODE[code] || null; }
  function wordFor(n) { return STATE_WORD[String(n)] || null; }

  // ── THE SCRIPT AND ITS HOOK ──
  function _loadScript() {
    try {
      if (typeof document === "undefined" || !document.createElement || !document.currentScript) return;   // no page being read
      window.onYouTubeIframeAPIReady = function () { try { if (typeof Logger !== "undefined") Logger.debug("YouTube API ready"); } catch (e) {} };
      const s = document.createElement("script");
      s.src = API;
      const at = document.currentScript;   // this file's own tag, the page's line for it
      if (at && at.parentNode) at.parentNode.insertBefore(s, at.nextSibling);
    } catch (e) { /* no page: a guard's sandbox */ }
  }
  function available() { return !!(typeof window !== "undefined" && window.YT && window.YT.Player); }

  function make(box, opts, on) {
    const o = opts || {}, cb = on || {};
    let p = null, isReady = false, retry = null, destroyed = false;
    // ITS OWN ELEMENT, INSIDE THE SCREEN'S BOX: YouTube replaces it with its iframe, which keeps its id.
    const mountId = SHORT + "-" + ((box && box.id) || "player");
    let mount = null;
    try { mount = document.createElement("div"); mount.id = mountId; box.appendChild(mount); } catch (e) { mount = null; }
    const cfg = o.preview
      ? { width: "100%", height: "100%", videoId: o.id || "", playerVars: { autoplay: 1, controls: 1, mute: o.startMuted ? 1 : 0, playsinline: 1, rel: 0 } }
      : { height: "300", width: "100%", videoId: o.id || "", playerVars: { autoplay: 1, controls: 1, mute: o.startMuted ? 1 : 0 } };
    cfg.events = {
      onReady: () => { isReady = true; if (typeof cb.ready === "function") cb.ready(); },
      onStateChange: (e) => { if (typeof cb.state === "function") cb.state(wordFor(e && e.data)); },
      // The raw code goes no further than this file: the plug reports the app's reason, and the log names the code.
      onError: (e) => {
        const code = e && e.data;
        if (typeof cb.failed === "function") cb.failed(reasonFor(code), "YouTube error " + code);
      },
    };
    function _build() {
      retry = null;
      if (destroyed) return;
      if (!available()) { retry = setTimeout(_build, INIT_RETRY_MS); return; }
      p = new YT.Player(mountId, cfg);
    }
    _build();
    const fn = (name) => p && typeof p[name] === "function";
    return {
      // calls
      load(id, startSec) { p.loadVideoById({ videoId: id, startSeconds: startSec }); },
      play() { p.playVideo(); },
      pause() { p.pauseVideo(); },
      seek(sec) { p.seekTo(sec, true); },
      stop() { p.stopVideo(); },
      setVolume(n) { p.setVolume(n); },
      mute() { p.mute(); },
      unmute() { p.unMute(); },
      show(onOff) { try { const f = document.getElementById(mountId); if (f) f.style.display = onOff ? "" : "none"; } catch (e) {} },
      destroy() { destroyed = true; if (retry) { clearTimeout(retry); retry = null; } if (p) p.destroy(); },
      // readings — each the call it always was, made when asked
      ready() { return isReady && !!p; },
      id() { if (!fn("getVideoData")) return null; const vd = p.getVideoData(); return (vd && vd.video_id) ? vd.video_id : null; },
      title() { if (!fn("getVideoData")) return null; const vd = p.getVideoData(); return (vd && vd.title) ? vd.title : null; },
      time() { return fn("getCurrentTime") ? p.getCurrentTime() : null; },
      length() { if (!fn("getDuration")) return 0; return p.getDuration(); },
      state() { return fn("getPlayerState") ? wordFor(p.getPlayerState()) : null; },
      volume() { return fn("getVolume") ? p.getVolume() : null; },
      muted() { return fn("isMuted") ? p.isMuted() : null; },
    };
  }

  _loadScript();
  const impl = { available, make };
  if (typeof SongPlayer !== "undefined") SongPlayer.register(SHORT, impl);
  return { SHORT, available, make, reasonFor, wordFor, _REASON_FOR_CODE, STATE_WORD };
})();
