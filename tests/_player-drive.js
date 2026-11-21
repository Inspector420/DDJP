// tests/_player-drive.js
// BOTH PLAYERS, DRIVEN THROUGH THE WHOLE UI, AND EVERY CALL YOUTUBE'S PLAYER IS HANDED, IN ORDER — a harness, not a guard (no
// `check-` prefix, so `run-all` does not run it). Added at J29's step 2 (`ddjp_706`) for the supervisor's decision 5: the plug
// changes nothing YouTube's player is asked, nor when. `check-player-plug` PART D drives this tree and compares what it records
// with the recording of `ddjp_705`, taken by THIS FILE run unchanged on an untouched 705 tree (`tests/_player-calls-705.js`).
//
// WRITTEN TO RUN ON EITHER TREE: it loads the main screen with that tree's own `tests/_screen-world.js` (every ui/ file, whole,
// in page order — on 706 the plug and YouTube's player among them, on 705 neither), and drives only what both trees have: the
// room player's exported doors (`Player.initSongPlayer`, `onPlaybackStateChange`, `clearPlayer`), the volume slider and mute
// button the screen builds, and a song row's picture, clicked, for the preview, whose own controls are then pressed. YouTube is a
// recording stand-in (`YT.Player`) the drive moves on: its ready, its states and an error, each written into the recording where
// it happens, so the two recordings line up by event as well as by call.
//
// THE SCENARIO (the supervisor's list): a song joined late (its load at the room's point); a drift past 10 s (a seek); the
// volume changed and muted from the room's controls; a song ending by the room's clock and the next starting (since `ddjp_711`,
// when the control was recorded again on 705 with this drive); a song YouTube will not play (error
// 150); a preview opened, paused, played, its volume changed, closed; the room left. The clock is virtual and every timer runs
// as it falls due, so the volume polls and the title polls are in the recording too.
//
//   drive() → { calls: [...], unscripted: [...] }   (`node tests/_player-drive.js` prints the recording as JSON)
"use strict";
const SW = require("./_screen-world.js");

const K1 = "yt:AAAAAAAAAAA", K2 = "yt:BBBBBBBBBBB", K3 = "yt:CCCCCCCCCCC";

function standIn() {
  const calls = [];
  const made = [];
  const round = (a) => (typeof a === "number" ? Math.round(a * 10) / 10 : a);
  function Player(el, cfg) {
    const name = typeof el === "string" ? el : (el && el.id);
    calls.push("new " + name + " " + JSON.stringify(JSON.parse(JSON.stringify(cfg || {}))));
    const st = { vid: (cfg && cfg.videoId) || null, t: 0, vol: 100, muted: false, state: -1 };
    const base = {
      loadVideoById(o) { st.vid = o && typeof o === "object" ? o.videoId : o; st.t = (o && o.startSeconds) || 0; st.state = 3; },
      playVideo() { st.state = 1; }, pauseVideo() { st.state = 2; }, stopVideo() { st.state = 0; },
      seekTo(s) { st.t = s; },
      getCurrentTime() { return st.t; }, getDuration() { return st.vid ? 200 : 0; },
      getVideoData() { return st.vid ? { video_id: st.vid, title: "Title of " + st.vid } : {}; },
      getPlayerState() { return st.state; },
      setVolume(v) { st.vol = v; }, getVolume() { return st.vol; }, mute() { st.muted = true; }, unMute() { st.muted = false; },
      isMuted() { return st.muted; }, destroy() {},
    };
    const rec = {};
    for (const k of Object.keys(base)) {
      rec[k] = function () {
        calls.push(name + "." + k + "(" + JSON.stringify(Array.prototype.slice.call(arguments).map(round)).slice(1, -1) + ")");
        return base[k].apply(base, arguments);
      };
    }
    made.push({ name, cfg, st, p: rec });
    return rec;
  }
  const YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, loaded: 1 };
  const find = (name) => made.filter((m) => m.name === name).slice(-1)[0];
  const fire = (name, ev, arg, note) => {
    const m = find(name);
    if (!m || !m.cfg || !m.cfg.events || typeof m.cfg.events[ev] !== "function") { calls.push("!! no " + ev + " on " + name); return; }
    calls.push("→ " + name + " " + note);
    m.cfg.events[ev](Object.assign({ target: m.p }, arg));
  };
  return {
    YT, calls, made, find,
    ready: (name) => fire(name, "onReady", {}, "ready"),
    state: (name, n) => { const m = find(name); if (m) { m.st.state = n; if (n === 1 && m.st.t === 0) m.st.t = m.st.t; } fire(name, "onStateChange", { data: n }, "state " + n); },
    error: (name, code) => fire(name, "onError", { data: code }, "error " + code),
    setTime: (name, t) => { const m = find(name); if (m) m.st.t = t; },
  };
}

// THE MAIN SCREEN, BUILT AS A ROOM'S ENTRY BUILDS IT, over YouTube's stand-in `yt` (and `more` globals: `ddjp_709` gives
// SoundCloud's stand-in widget here, for `check-player-plug` PART E's preview over a room song of the other service).
// `more.Playback` (`ddjp_711`) is the REAL Playback a guard built, in place of the recording stand-in, so the room player's
// ENDED reaches the module that answers it (`check-sc-frames` PART E).
// `drive()` below is unchanged by this: it builds exactly this screen, with nothing more.
function screen(yt, more) {
  const noted = [];
  const extra = Object.assign({}, more || {});
  const playback = extra.Playback || null;
  delete extra.Playback;
  const prefs = { level: 70, muted: false };
  const w = SW.world({
    clock: 1.9e12, domShaped: true,
    globals: Object.assign({ YT: yt.YT, URL, MetadataService: { thumbUrl: () => null, get: () => Promise.resolve(null) } }, extra),
    features: {
      Playback: playback || { setDurationProvider() {}, elapsedSec: (np) => (np && typeof np.elapsed === "number" ? np.elapsed : 0),
        setDuration: (k, d) => noted.push("setDuration " + k + " " + d), notifyEnded: (k, pi) => noted.push("notifyEnded " + k + " " + pi),
        isHeld: () => false },
      BotRuntime: { viewOff: () => false, isBot: () => false },
      ChatPrefs: { playerVolume: () => prefs.level, playerMuted: () => prefs.muted,
        setPlayerVolume: (l, m) => { prefs.level = l; if (typeof m === "boolean") prefs.muted = m; },
        previewVolume: () => null, previewMuted: () => null, setPreviewVolume() {},
        overlayBlocked: () => false, playerHidden: () => false, layout: () => "wide", setLayout() {} },
      MediaBlocked: { notifyPlayerFailed: (r, k) => noted.push("blocked " + r + " " + k), notifyPlayerError: (c, k) => noted.push("blocked " + c + " " + k) },
      Store: { meta: { peek: () => null, load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null), has: () => Promise.resolve(false) } },
      // What the main screen asks when it is built (as `check-owner-screens` scripts it): an empty room, nobody to moderate.
      Room: { rankLadder: () => [], getMyId: () => "@me:hs", getRoster: () => [], recentEvents: () => ({ rows: [], truncated: false, refused: 0 }),
        FEED_KINDS: {}, scanDDJPRooms: () => [], getCurrent: () => ({ roomId: "!room:hs", spaceId: "!space:hs" }) },
      Queue: { getNowPlaying: () => null, getRotation: () => [], lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000, recentHistory: () => [],
        historyReach: () => ({ entries: 0, complete: true }), getState: () => ({ counts: {} }) },
      UserQueue: { items: () => [], count: () => 0, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
      Actions: { describe: () => ({ enabled: false, reason: "Not permitted" }), perform: () => Promise.resolve({ ok: true }) },
      Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, closeDM() {}, dmAnswering: () => false },
      Playlists: { list: () => [], get: (id) => Promise.resolve({ id, name: "Mine", tracks: [] }) },
      RoomUpgrade: { isRunning: () => false, status: () => null },
      ServerClock: { serverNow: () => Date.now() },
      Metadata: { get: () => null, cached: () => null },
    },
  });
  // The window's YouTube: what the page's script defines once it is up (705's room player asks `window.YT`).
  w.sb.window = w.sb.window || {};
  try { w.sb.window.YT = yt.YT; } catch (e) {}
  // The main screen, built as a room's entry builds it (its volume slider, its mute button, the player's box).
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  return { w, noted, prefs };
}

async function drive() {
  const yt = standIn();
  const { w, noted } = screen(yt);
  const P = w.sb.Player;
  const ROOM = "yt-player", PREV = "yt-preview-player";
  const now = () => w.clock.now;
  const np = (pi, key, startedAgoS, elapsed, extra) => Object.assign({ pi, dj: "@d:hs", song: { songKey: key },
    startedAt: now() - startedAgoS * 1000, elapsed, duration: 200 }, extra || {});
  const step = async (ms) => { await w.advance(ms); for (let i = 0; i < 2; i++) w.frame(); };

  // ── THE ROOM'S PLAYER ── made as a room's entry makes it (`ui/screens.js`)
  P.initSongPlayer();
  await step(100);
  yt.ready(ROOM);
  await step(1000);
  // A song joined late: the room is 30 s in.
  const n1 = np("$p1", K1, 30, 30);
  P.onPlaybackStateChange(n1);
  await step(200);
  yt.state(ROOM, 3);
  await step(300);
  yt.state(ROOM, 1);
  await step(1500);
  // The room is 60 s in and the player says 31: more than 10 s apart, so the player is moved.
  yt.setTime(ROOM, 31);
  P.onPlaybackStateChange(np("$p1", K1, 60, 60, { startedAt: n1.startedAt }));
  await step(500);
  // The volume, from the room's own controls: the slider to 40, then muted, then unmuted.
  const R = w.refs;
  if (R.volumeSlider) { R.volumeSlider.value = "40"; R.volumeSlider.oninput(); }
  await step(500);
  if (R.muteBtn) R.muteBtn.onclick();
  await step(500);
  if (R.muteBtn) R.muteBtn.onclick();
  await step(500);
  // The song ends BY THE ROOM'S CLOCK (`ddjp_711`): the room reaches its agreed length (200 s) with the player near its own
  // end, and the player's ENDED arrives then — a wake-up at a normal end, never the decision; the room settles; the next
  // starts from 0. (Until 711 the ENDED came with the room at 60 s, the end the player decided.)
  yt.setTime(ROOM, 199.5);
  P.onPlaybackStateChange(np("$p1", K1, 200, 200, { startedAt: n1.startedAt }));
  await step(200);
  yt.state(ROOM, 0);
  await step(200);
  P.onPlaybackStateChange(np("$p1", K1, 200, 200, { startedAt: n1.startedAt, ended: true }));
  await step(500);
  const n2 = np("$p2", K2, 0, 0);
  P.onPlaybackStateChange(n2);
  await step(200);
  yt.state(ROOM, 3);
  await step(300);
  yt.state(ROOM, 1);
  await step(1500);
  // A song YouTube will not play.
  yt.error(ROOM, 150);
  await step(500);

  // ── THE PREVIEW ── a song row's picture, clicked.
  let opened = false;
  try {
    const row = w.sb.PlaylistPanels.songRow(K3, {});
    const all = []; (function walk(n) { all.push(n); for (const c of (n._kids || [])) walk(c); })(row);
    const slot = all.find((n) => n.nodeType === 1 && /\bthumb-slot\b/.test(n.className || ""));
    if (slot && typeof slot.onclick === "function") { slot.onclick(); opened = true; }
  } catch (e) { yt.calls.push("!! the preview did not open: " + (e && e.message)); }
  await step(100);
  if (opened) {
    yt.ready(PREV);
    await step(200);
    yt.state(PREV, 1);
    await step(1000);
    const card = w.doc.body._kids.find((n) => /\bpreview-overlay\b/.test(n.className || ""));
    const all = []; if (card) (function walk(n) { all.push(n); for (const c of (n._kids || [])) walk(c); })(card);
    const by = (cls) => all.find((n) => n.nodeType === 1 && new RegExp("\\b" + cls + "\\b").test(n.className || ""));
    const play = by("pv-play"), vol = by("pv-vol"), mute = by("pv-mute"), x = by("preview-x");
    if (play) { play.onclick(); await step(300); play.onclick(); await step(300); }
    if (vol) { vol.value = "25"; vol.oninput(); await step(500); }
    if (mute) { mute.onclick(); await step(300); }
    if (x) { x.onclick(); await step(500); }
  }
  // ── LEAVING THE ROOM ──
  P.clearPlayer();
  await step(100);
  return { calls: yt.calls, noted, unscripted: w.unscripted.slice() };
}

module.exports = { drive, screen, standIn, K1, K2, K3 };
if (require.main === module) drive().then((r) => console.log(JSON.stringify(r, null, 1)), (e) => { console.error(e); process.exit(1); });
