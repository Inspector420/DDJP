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
// ── ITS ERRORS, AS THE APP'S REASONS (decision 4; J153, the owner's) ──────────────────────────────────────────────────────
// YouTube iframe error codes, and the reason each is (the room knows two, `blocked-for-me` and `not-allowed`):
//   100 the video is gone (removed, private, never existed)          → `not-allowed`
//   101 the uploader disallows embedding (and a region block, too)   → the song's saved answer decides (below)
//   150 the same condition as 101, reported differently              → the song's saved answer decides (below)
//   2   invalid parameter, 5 the HTML5 player failed, 153 the request carried no referrer or client identity, and any code
//       not listed: the person's own end, or nothing the app can name → NO reason (null), and a null sends nothing.
// A REGION BLOCK ARRIVES AS 101/150, indistinguishable from an embed denial, so 101 and 150 read THE SONG'S SAVED ANSWER of
// where it is blocked (J153 (c)), at the moment it fails, through `MetadataService.heldGeo` (this session's copy; this
// file reads no storage):
//   · the answer says it cannot be embedded                         → `not-allowed`
//   · the answer says it is blocked somewhere (or allowed only in some countries, or nowhere), embedding not refused
//                                                                   → `blocked-for-me`
//   · the answer says it is blocked nowhere, or there is no answer this session (the owner's "no saved data yet")
//                                                                   → `not-allowed`
// The person's own country is never read: a failure is reported, never predicted. BOTH REASONS COUNT, the same in every one
// of the room's tables (`StateDeriver.skipVerdict`), so a device's saved answer only names a failure the room counts either
// way and can never make it more permissive (`PILLARS.md` §3). The table below is the answer with no saved data. Whether the
// room's vocabulary knows a reason is `MediaBlocked`'s question, asked where the declaration is made.
//
// Depends on: SongPlayer (at load), YT (once its script is up), Logger, Songs and MetadataService (at call time)

const YouTubePlayer = (() => {
  "use strict";
  const SHORT = "yt";                       // its row in `core/songs.js`
  const API = "https://www.youtube.com/iframe_api";
  const INIT_RETRY_MS = 500;                // make the player once the script is up (it retried this way before the plug)
  const STATE_WORD = { "-1": "unstarted", "0": "ended", "1": "playing", "2": "paused", "3": "buffering", "5": "cued" };
  const _REASON_FOR_CODE = {
    100: "not-allowed",
    101: "not-allowed",
    150: "not-allowed",
  };
  // The codes whose reason the song's saved answer decides (J153 (c)), and what each answer reads as.
  const _DATA_CODES = { 101: true, 150: true };
  const _DATA_REASON = { restricted: "blocked-for-me", other: "not-allowed" };
  // PURE: a code, and the song's saved answer (`{ blocked | allowed, embeddable }`, or null) → the app's reason, or null.
  function reasonFor(code, geo) {
    const r = _REASON_FOR_CODE[code] || null;
    if (!r || !_DATA_CODES[code] || !geo || typeof geo !== "object") return r;
    if (geo.embeddable === false) return _DATA_REASON.other;
    const restricted = Array.isArray(geo.allowed) || (Array.isArray(geo.blocked) && geo.blocked.length > 0);
    return restricted ? _DATA_REASON.restricted : _DATA_REASON.other;
  }
  // This session's saved answer for the song this player last loaded, or null.
  function _savedGeo(id) {
    try {
      if (!id || typeof MetadataService === "undefined" || !MetadataService.heldGeo) return null;
      return MetadataService.heldGeo(Songs.key(SHORT, id));
    } catch (e) { return null; }
  }
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
    let current = o.id || null;               // the song this player last loaded — the one an error is about (J153 (c))
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
        if (typeof cb.failed === "function") cb.failed(reasonFor(code, _savedGeo(current)), "YouTube error " + code);
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
      load(id, startSec) { current = id || null; p.loadVideoById({ videoId: id, startSeconds: startSec }); },
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
  return { SHORT, available, make, reasonFor, wordFor, _REASON_FOR_CODE, _DATA_CODES, _DATA_REASON, STATE_WORD };
})();
