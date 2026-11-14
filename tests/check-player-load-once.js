// tests/check-player-load-once.js
// SUBJECT: ui/player.js, ui/songplayer.js, ui/youtube.js
// WALL: A NEW PLAY CALLS loadVideoById EXACTLY ONCE UNTIL IT PLAYS (owner's report on `ddjp_536`: playback loads forever).
//   Driven with the shipped `_loadReason`, `_needsLoad`, `loadSong`, `_doLoad`, `_driveNowPlaying`, `renderNowPlaying` and the
//   room player's state handler, over the REAL plug and YouTube player (J29 step 2, `tests/_player-world.js`) and a stand-in
//   YT player that takes 2–5 s to load and reports the OLD video_id until it has, under redraws every 200 ms (the
//   now-playing path and the label path, the label path sometimes first). The room's songs are KEYS, as in a room of this
//   build: a bare id names no service, and the player would load nothing for one.
//   Cases: a new video, a same-video replay, a different video — each must load once. Since `ddjp_714` the push runs the plug's
//   check after the room's decisions (`_followRoom`, `_checkPlayer`, `_wantOf`, `_act`, all shipped): a player still showing the
//   old song while its load is on its way is NOT corrected by a second load.
"use strict";
const fs = require("fs"), path = require("path");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[player-load-once] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const W = require("./_probe-j41-wire");
const ev = W.playerEvents();
const PS = fs.readFileSync(path.join(__dirname, "..", "ui/player.js"), "utf8");
const fn = (name) => { const i = PS.indexOf("  function " + name + "("); const j = PS.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? PS.slice(i, j + 4) : ""; };
// The label path's only effect on loading is its `_currentSong` block: that exact shipped text, run as `_labelPath(np)`.
const LB = (() => { const a = PS.indexOf("    if (!_currentSong || _currentSong.songKey !== np.song.songKey) {"); const b = PS.indexOf("\n    }\n", a); return (a >= 0 && b > a) ? PS.slice(a, b + 7) : ""; })();
// The check's answer back to this file, as shipped: the `const _act = { … };` block.
const ACT = (() => { const a = PS.indexOf("  const _act = {"); const b = PS.indexOf("\n  };\n", a); return (a >= 0 && b > a) ? PS.slice(a, b + 5) : ""; })();
const SRC = ["_loadReason", "loadSong", "_doLoad", "_driveNowPlaying", "_followRoom", "_wantOf", "_checkPlayer"].map(fn).join("") + ACT +
  "  function _labelPath(np) {\n" + LB + "  }\n";
ok(ev.ok && !!ev.handlers.state && LB.indexOf("_currentSong = {") >= 0 && ACT.indexOf("load: (key") >= 0 &&
  ["_loadReason", "_doLoad", "_driveNowPlaying", "_followRoom", "_wantOf", "_checkPlayer"].every((n) => SRC.indexOf("function " + n + "(") >= 0),
  "PREMISE — the shipped load path, label path and state handler were found", ev.stage);
function run(loadMs, plays, labelFirst) {
  const clock = { t: 1.7e12 };
  const loads = [];
  let shown = null, loadedAt = Infinity, pendingVid = null;
  const fake = { loadVideoById: (o) => { loads.push({ vid: o.videoId, at: clock.t }); pendingVid = o.videoId; loadedAt = clock.t + loadMs; },
    getVideoData: () => (shown ? { video_id: shown } : {}), getDuration: () => 200, getCurrentTime: () => 0, getPlayerState: () => 3 };
  const quiet = { info() {}, warn() {}, debug() {}, error() {} };
  let np = null, onState = null;
  const PW = require("./_player-world.js");
  const { bp, w } = PW.boxPlayer(fake, { on: { state: (word, b) => onState(word, b) } });   // the room's box player, through the plug
  const target = { player: bp, SongPlayer: w.SongPlayer, _wantSong: null, _loadTimer: null, _currentSong: null, _endedPi: null, _heldPi: null, PlaylistPanels: { previewActive: () => false }, _lastNp: null, _lastPlayPi: null,
    PLAYER_LOAD_RETRY_MS: 100, VOLUME_APPLY_DELAY_MS: 0, Logger: quiet, Date, Math, JSON,
    ServerClock: { serverNow: () => clock.t }, setTimeout: () => 0, clearTimeout() {},
    StreamManager: { getState: () => ({ nowPlaying: np }) },
    Queue: new Proxy({}, { get: (o, k) => (k === "getNowPlaying" ? () => np : () => null) }),   // the label path reads the play here
    Playback: { elapsedSec: () => 0, notifyEnded() {}, setDuration() {}, isHeld: () => false }, MediaBlocked: { notifyPlayerFailed() {} },
    _botViewOff: () => false, _loadsByPi: Object.create(null), _plog() {} };
  // Anything the drive does not care about (panels, refs, labels) is a DEEP no-op: callable, and itself for any property.
  const deep = new Proxy(function () { return undefined; }, { get: (o, k) => (k === "then" || k === Symbol.toPrimitive || k === Symbol.iterator ? undefined : deep), apply: () => deep, set: () => true });
  const scope = new Proxy(target, { has: () => true, set: (o, k, v) => { o[k] = v; return true; },
    get: (o, k) => (k in o) ? o[k] : (k === Symbol.unscopables ? undefined : (k in globalThis ? globalThis[k] : deep)) });
  const api = new Function("scope", "with (scope) {\n" + SRC + "\nreturn { _driveNowPlaying, _labelPath };\n}")(scope);
  onState = new Function("scope", "with (scope) { return (" + ev.handlers.state + "); }")(scope);
  const perPlay = [];
  for (const p of plays) {
    np = { pi: p.pi, dj: "@d:hs", song: { songKey: p.vid }, startedAt: clock.t };
    target._lastNp = np;
    const before = loads.length;
    let played = false;
    for (let step = 0; step < 60 && !played; step++) {        // 200 ms redraws, up to 12 s
      // UI helpers after the load may throw against the stand-ins; the drive carries on, since the load already happened.
      const step1 = labelFirst ? () => api._labelPath(np) : () => api._driveNowPlaying(np), step2 = labelFirst ? () => api._driveNowPlaying(np) : () => api._labelPath(np);
      try { step1(); } catch (e) {} try { step2(); } catch (e) {}
      clock.t += 200;
      if (pendingVid && clock.t >= loadedAt) { shown = pendingVid; pendingVid = null; loadedAt = Infinity; w.state(0, 1); played = true; }   // YouTube's PLAYING
    }
    perPlay.push({ pi: p.pi, vid: p.vid, loads: loads.length - before, played });
  }
  return perPlay;
}
const PLAYS = [{ pi: "$p1", vid: "yt:vidAAAAAAAA" }, { pi: "$p2", vid: "yt:vidAAAAAAAA" }, { pi: "$p3", vid: "yt:vidBBBBBBBB" }];
for (const loadMs of [2000, 5000]) for (const labelFirst of [false, true]) {
  const r = run(loadMs, PLAYS, labelFirst);
  const tag = loadMs / 1000 + " s load, " + (labelFirst ? "label path first" : "now-playing path first");
  console.log("[player-load-once] MEASURED " + tag + ": " + r.map((x) => x.pi + "→" + (x.threw ? "threw " + x.threw : x.loads + " load(s)" + (x.played ? "" : ", never played"))).join("; "));
  ok(r.every((x) => !x.threw && x.loads === 1 && x.played), "a new play loads EXACTLY once until it plays — new video, same-video replay, different video (" + tag + ")", r);
}
if (failed) { console.log("[player-load-once] " + failed + " failure(s)"); process.exit(1); }
console.log("[player-load-once] PASS — under redraws every 200 ms and a player that reports the old video until it has loaded, each new play calls loadVideoById exactly once until it plays (" + asserts + " assertions)");
