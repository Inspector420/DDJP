// tests/check-ended-by-play.js
// SUBJECT: features/playback.js, ui/player.js, ui/songplayer.js, ui/youtube.js
// WALL: AN ENDED BELONGS TO THE PLAY THAT ENDED, NOT TO ITS VIDEO (owner's bot-room test, `ddjp_534`). The same video
//   played twice in a row: SONG `pi=$8eHa…` (the second play) at 11:47:50, ENDED at 11:47:51 — the first play's late
//   iframe ENDED, matched by video id alone, ended the second and left its DJ stuck. An ENDED is now attributed to the
//   play the iframe last reported PLAYING for, and Playback refuses one from any other play.
//   PART A — Playback (the real module): a late ENDED from the first play does not end the second; the second's own does.
//   PART B — the player, DRIVEN: the shipped `_needsLoad`, `loadSong`, `_doLoad` and the room player's state handler, run
//            over the REAL plug and YouTube player (`tests/_player-world.js`) and a stand-in YT player — a replay reloads,
//            a stale ENDED does not end it, a different video loads normally.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[ended-by-play] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// THE ROOM NAMES A SONG BY ITS KEY AND THE PLAYER BY YOUTUBE'S OWN ID (J29): `VID` is the room's, `VID_YT` what the stand-in
// YT player is handed and reports; the plug (run below, never stood in for) turns one into the other.
const VID = "yt:WUldnh-K3AI", VID_YT = "WUldnh-K3AI", OTHER = "yt:otherVid123", OTHER_YT = "otherVid123";
const fs = require("fs");
let PB = null;   // part A's real Playback, which part B decides with
// ── A — Playback ──
{
  const st = { nowPlaying: { pi: "$second", dj: "@d:hs", song: { songKey: VID }, startedAt: Date.now() - 1300 } };
  const sb = loadInContext(["core/logger.js", "features/playback.js"], {
    StreamManager: { getState: () => st, getLog: () => [], on() {} },
    ServerClock: { serverNow: () => Date.now() }, Skip: {}, Queue: {}, MatrixBridge: { getUserId: () => "@me:hs" } });
  const P = sb.Playback; PB = P;
  ok(typeof P.shouldEndOn === "function", "A PREMISE — Playback decides with shouldEndOn");
  ok(P.shouldEndOn(st.nowPlaying, VID, "$first") === false, "A: a late ENDED from the FIRST play of the same video does not end the second", P.shouldEndOn(st.nowPlaying, VID, "$first"));
  ok(P.shouldEndOn(st.nowPlaying, VID, "$second") === true, "A: the second play's own ENDED does end it");
  ok(P.shouldEndOn(st.nowPlaying, VID) === true && P.shouldEndOn(st.nowPlaying, VID, null) === true, "A: with no play named, the video match stands as before");
  ok(P.shouldEndOn(st.nowPlaying, OTHER, "$second") === false, "A: an ENDED for another video never ends it");
}
// ── B — the player, DRIVEN: the shipped load decision, load and state handler over the real plug and a stand-in YT ──
{
  const W = require("./_probe-j41-wire");
  const PW = require("./_player-world.js");
  const ev = W.playerEvents();
  const PS = fs.readFileSync(path.join(__dirname, "..", "ui/player.js"), "utf8");
  const fn = (name) => { const i = PS.indexOf("  function " + name + "("); const j = PS.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? PS.slice(i, j + 4) : ""; };
  const SRC = fn("_loadReason") + fn("loadSong") + fn("_doLoad");   // _needsLoad asks _loadReason (ddjp_536)
  ok(ev.ok && !!ev.handlers.state && SRC.indexOf("function _doLoad") >= 0 && SRC.indexOf("function _loadReason") >= 0,
    "B PREMISE — the shipped load decision, load and the room player's state handler were found", ev.stage);
  const loads = [], decided = [];
  let now = null, onState = null;
  const fake = { loadVideoById: (o) => loads.push(o.videoId), getVideoData: () => (loads.length ? { video_id: loads[loads.length - 1] } : {}), getDuration: () => 200, getCurrentTime: () => 0 };
  const { bp, w } = PW.boxPlayer(fake, { on: { state: (word, b) => onState(word, b) } });   // the room's box player, through the plug
  const quiet = { info() {}, warn() {}, debug() {}, error() {} };
  const target = { _wantSong: null, _loadTimer: null, player: bp, PLAYER_LOAD_RETRY_MS: 100, VOLUME_APPLY_DELAY_MS: 0,
    ServerClock: { serverNow: () => Date.now() }, setTimeout: () => 0, Date, Math, JSON, Logger: quiet,
    Playback: { notifyEnded: (v, pi) => decided.push([v, pi, PB.shouldEndOn(now, v, pi)]), setDuration() {}, elapsedSec: () => 0 } };
  const scope = new Proxy(target, { has: () => true, set: (o, k, v) => { o[k] = v; return true; },
    get: (o, k) => (k in o) ? o[k] : (k === Symbol.unscopables ? undefined : (k in globalThis ? globalThis[k] : () => null)) });
  const api = new Function("scope", "with (scope) {\n" + SRC + "\nreturn { _needsLoad: (a, b, c) => !!_loadReason(a, b, c), loadSong, _doLoad };   // the load decision is _loadReason's truthiness\n}")(scope);
  onState = new Function("scope", "with (scope) {\nreturn (" + ev.handlers.state + "); }")(scope);
  const fire = (d) => w.state(0, d);   // YouTube's own state number, through its player and the plug
  const np = (pi, vid) => ({ pi: pi, dj: "@d:hs", song: { songKey: vid }, startedAt: Date.now() });
  // the first play
  const p1 = np("$first", VID);
  ok(api._needsLoad(p1, null, null) === true, "B: the first play loads");
  api.loadSong(VID, Date.now(), () => 0, "$first"); now = p1; fire(1);
  // the same video again, as a NEW play
  const p2 = np("$second", VID);
  ok(api._needsLoad(p2, VID, { songKey: VID, pi: "$first" }) === true, "B: the same video twice in a row RELOADS the second time");
  api.loadSong(VID, Date.now(), () => 0, "$second"); now = p2;
  ok(loads.length === 2 && loads[1] === VID_YT, "B: and plays it again — a second load of the same video, handed YouTube's own id", loads);
  fire(0);   // the first play's late ENDED, before the second reaches PLAYING
  ok(decided.length === 1 && decided[0][1] === "$first" && decided[0][2] === false, "B: a stale ENDED from the first play does NOT end the second", decided);
  fire(1); fire(0);
  ok(decided.length === 2 && decided[1][1] === "$second" && decided[1][2] === true, "B: once the second is PLAYING, its own ENDED does end it", decided);
  // a different video
  const p3 = np("$third", OTHER);
  ok(api._needsLoad(p3, VID, { songKey: VID, pi: "$second" }) === true, "B: a different video still loads");
  api.loadSong(OTHER, Date.now(), () => 0, "$third");
  ok(loads.length === 3 && loads[2] === OTHER_YT, "B: normally — its own load", loads);
  ok(api._needsLoad(p3, OTHER, { songKey: OTHER, pi: "$third" }) === false, "B CONTROL: the same play, re-rendered, does not reload");
  finish();
}
function finish() {
  if (failed) { console.log("[ended-by-play] " + failed + " failure(s)"); process.exit(1); }
  console.log("[ended-by-play] PASS — an ENDED belongs to the play the player last reported PLAYING for: a late ENDED from the " +
    "first play of a video does not end its replay, and the replay's own does — driven through the real plug and YouTube's " +
    "player (" + asserts + " assertions)");
  process.exit(0);
}
