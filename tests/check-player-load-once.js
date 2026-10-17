// tests/check-player-load-once.js
// SUBJECT: ui/player.js
// WALL: A NEW PLAY CALLS loadVideoById EXACTLY ONCE UNTIL IT PLAYS (owner's report on `ddjp_536`: playback loads forever).
//   Driven with the shipped `_loadReason`, `_needsLoad`, `loadVideo`, `_doLoad`, `_driveNowPlaying`, `renderNowPlaying` and the
//   main player's `onStateChange`, against a fake YT player that takes 2–5 s to load and reports the OLD video_id until it
//   has, under redraws every 200 ms (the now-playing path and the label path, the label path sometimes first).
//   Cases: a new video, a same-video replay, a different video — each must load once.
"use strict";
const fs = require("fs"), path = require("path");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[player-load-once] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const W = require("./_probe-j41-wire");
const ev = W.playerEvents();
const PS = fs.readFileSync(path.join(__dirname, "..", "ui/player.js"), "utf8");
const fn = (name) => { const i = PS.indexOf("  function " + name + "("); const j = PS.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? PS.slice(i, j + 4) : ""; };
// The label path's only effect on loading is its `_currentSong` block: that exact shipped text, run as `_labelPath(np)`.
const LB = (() => { const a = PS.indexOf("    if (!_currentSong || _currentSong.videoId !== np.song.videoId) {"); const b = PS.indexOf("\n    }\n", a); return (a >= 0 && b > a) ? PS.slice(a, b + 7) : ""; })();
const SRC = ["_loadReason", "loadVideo", "_doLoad", "_driveNowPlaying"].map(fn).join("") + "  function _labelPath(np) {\n" + LB + "  }\n";
ok(ev.ok && !!ev.handlers.onStateChange && LB.indexOf("_currentSong = {") >= 0 && ["_loadReason", "_doLoad", "_driveNowPlaying"].every((n) => SRC.indexOf("function " + n + "(") >= 0),
  "PREMISE — the shipped load path, label path and state handler were found", ev.stage);
function run(loadMs, plays, labelFirst) {
  const clock = { t: 1.7e12 };
  const loads = [];
  let shown = null, loadedAt = Infinity, pendingVid = null;
  const fake = { loadVideoById: (o) => { loads.push({ vid: o.videoId, at: clock.t }); pendingVid = o.videoId; loadedAt = clock.t + loadMs; },
    getVideoData: () => (shown ? { video_id: shown } : {}), getDuration: () => 200, getCurrentTime: () => 0, getPlayerState: () => 3 };
  const quiet = { info() {}, warn() {}, debug() {}, error() {} };
  let np = null;
  const target = { player: fake, playerReady: true, _wantVideo: null, _loadTimer: null, _currentSong: null, _endedPi: null, _lastPlayPi: null,
    PLAYER_LOAD_RETRY_MS: 100, VOLUME_APPLY_DELAY_MS: 0, Logger: quiet, Date, Math, JSON,
    ServerClock: { serverNow: () => clock.t }, setTimeout: () => 0, clearTimeout() {},
    StreamManager: { getState: () => ({ nowPlaying: np }) },
    Queue: new Proxy({}, { get: (o, k) => (k === "getNowPlaying" ? () => np : () => null) }),   // the label path reads the play here
    YT: { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } },
    Playback: { elapsedSec: () => 0, notifyEnded() {}, setDuration() {}, isHeld: () => false }, MediaBlocked: { notifyPlayerError() {} },
    _botViewOff: () => false, _loadsByPi: Object.create(null), _plog() {} };
  // Anything the drive does not care about (panels, refs, labels) is a DEEP no-op: callable, and itself for any property.
  const deep = new Proxy(function () { return undefined; }, { get: (o, k) => (k === "then" || k === Symbol.toPrimitive || k === Symbol.iterator ? undefined : deep), apply: () => deep, set: () => true });
  const scope = new Proxy(target, { has: () => true, set: (o, k, v) => { o[k] = v; return true; },
    get: (o, k) => (k in o) ? o[k] : (k === Symbol.unscopables ? undefined : (k in globalThis ? globalThis[k] : deep)) });
  const api = new Function("scope", "with (scope) {\n" + SRC + "\nreturn { _driveNowPlaying, _labelPath };\n}")(scope);
  const onState = new Function("scope", "with (scope) { return (" + ev.handlers.onStateChange + "); }")(scope);
  const perPlay = [];
  for (const p of plays) {
    np = { pi: p.pi, dj: "@d:hs", song: { videoId: p.vid }, startedAt: clock.t };
    const before = loads.length;
    let played = false;
    for (let step = 0; step < 60 && !played; step++) {        // 200 ms redraws, up to 12 s
      // UI helpers after the load may throw against the stand-ins; the drive carries on, since the load already happened.
      const step1 = labelFirst ? () => api._labelPath(np) : () => api._driveNowPlaying(np), step2 = labelFirst ? () => api._driveNowPlaying(np) : () => api._labelPath(np);
      try { step1(); } catch (e) {} try { step2(); } catch (e) {}
      clock.t += 200;
      if (pendingVid && clock.t >= loadedAt) { shown = pendingVid; pendingVid = null; loadedAt = Infinity; onState({ data: 1, target: fake }); played = true; }
    }
    perPlay.push({ pi: p.pi, vid: p.vid, loads: loads.length - before, played });
  }
  return perPlay;
}
const PLAYS = [{ pi: "$p1", vid: "vidAAAAAAAA" }, { pi: "$p2", vid: "vidAAAAAAAA" }, { pi: "$p3", vid: "vidBBBBBBBB" }];
for (const loadMs of [2000, 5000]) for (const labelFirst of [false, true]) {
  const r = run(loadMs, PLAYS, labelFirst);
  const tag = loadMs / 1000 + " s load, " + (labelFirst ? "label path first" : "now-playing path first");
  console.log("[player-load-once] MEASURED " + tag + ": " + r.map((x) => x.pi + "→" + (x.threw ? "threw " + x.threw : x.loads + " load(s)" + (x.played ? "" : ", never played"))).join("; "));
  ok(r.every((x) => !x.threw && x.loads === 1 && x.played), "a new play loads EXACTLY once until it plays — new video, same-video replay, different video (" + tag + ")", r);
}
if (failed) { console.log("[player-load-once] " + failed + " failure(s)"); process.exit(1); }
console.log("[player-load-once] PASS — under redraws every 200 ms and a player that reports the old video until it has loaded, each new play calls loadVideoById exactly once until it plays (" + asserts + " assertions)");
