// tests/check-player-trail.js
// SUBJECT: ui/player.js, features/playback.js, ui/songplayer.js, ui/youtube.js
// WALL: A NEW SONG'S PATH TO PLAYING CAN BE READ FROM THE LOG (the owner, `ddjp_627`: "on almost every new song the video stays
//   black for about 5 seconds"). An investigation, so two DIAGNOSTIC LINES ONLY, through the player's rate-limited `_plog`, and
//   nothing the player does changes:
//     "Player: playing pi=… <key> N ms after its load (asked start=…s, playing from …s; states since: …)" — once per load;
//     "Player: corrected <service> — the player at … s, the room at … s: more than 10 s apart (sought to … s; N ms after its
//     load)" — every seek (the plug's check since `ddjp_714`; it was "Player: seek to …s pi=… — …" from `ddjp_627`).
//   In the plug's own words since J29's step 2 (`ddjp_706`, the supervisor's decision 6): the song by its key, the states by
//   name. The player is the REAL box player over the REAL YouTube player file (`tests/_player-world.js`) and a stand-in YT.
//   PART A — the lines, DRIVEN with the shipped load path, seek, `_plog` and the room player's state handler over a stand-in
//            YouTube player: said once at the first "playing" after a load and not at an unpause; a seek says why and when;
//            the player is asked exactly what it was asked before (the load's arguments, the seek's, nothing else).
//   PART B — the candidates, DRIVEN with the REAL Playback module feeding the shipped `_driveNowPlaying` (the room's own decisions,
//            `_followRoom`, then the plug's check through `_checkPlayer` and `_wantOf`, `ddjp_714`), its clock controlled:
//            B1 the 10 s seek check cannot fire in a song's first 15 s — no push in that time carries `elapsed` — even with the
//               player reporting 0 for a 5 s load; after it, a player still at 0 is seeked (the control: the check is live);
//            B2 a new song is asked to start where the room is, so every new song starts with a seek of the time the play took
//               to reach this tab (MEASURED);
//            B3 the finished song's cover ("Waiting for the next song…") goes up at its ENDED, and comes down in the same call
//               that asks for the next video's load — so what shows after that is the player's own loading.
//   PART C — THE DEVICE FOLLOWS THE ROOM'S CLOCK (`ddjp_711`), DRIVEN with the real Playback: a player that ends early (50 s into
//            a song the room agrees is 200 s) is loaded ONCE more at the room's point; a second early end holds — the waiting
//            cover, no more loads; and the 10 s check never seeks past the player's own length less 1 s (the parked "seek to
//            600.0 s in a 339 s song every 2 s"), while it still seeks inside it.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require("./_load");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[player-trail] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const W = require("./_probe-j41-wire");
const PW = require("./_player-world.js");
const SONGS = loadInContext(["core/songs.js"], {}).Songs;
const ev = W.playerEvents();
const PS = fs.readFileSync(path.join(__dirname, "..", "ui/player.js"), "utf8");
const fn = (name) => { const i = PS.indexOf("  function " + name + "("); const j = PS.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? PS.slice(i, j + 4) : ""; };
const NAMES = ["_loadReason", "loadSong", "_doLoad", "_driveNowPlaying", "_followRoom", "_wantOf", "_checkPlayer", "_reloadAtRoomPoint", "getPlayerTime", "clearPlayer", "_plog", "_noteLoadState"];
// The check's answer back to the room's file, as shipped (`const _act = { … };`, `ddjp_714`).
const ACT = (() => { const a = PS.indexOf("  const _act = {"); const b = PS.indexOf("\n  };\n", a); return (a >= 0 && b > a) ? PS.slice(a, b + 5) : ""; })();
// The room names a song by key; the stand-in YouTube player is handed and reports YouTube's own id, through the plug.
const SRC = NAMES.map(fn).join("") + ACT;
ok(ev.ok && !!ev.handlers.state && ACT.indexOf("load: (key") >= 0 && NAMES.every((n) => SRC.indexOf("function " + n + "(") >= 0),
  "PREMISE — the shipped load path, seek, `_plog`, the load's state note and the room player's state handler were found",
  { stage: ev.stage, missing: NAMES.filter((n) => SRC.indexOf("function " + n + "(") < 0) });
const STATES = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// ONE PAGE: the shipped player functions in one scope, a fake YouTube player, a clock. Anything the drive does not judge (refs,
// the label, the progress loop) is a deep no-op; the cover is recorded.
function page(o) {
  o = o || {};
  const clock = { t: 1.7e12 };
  const calls = [], lines = [], covers = [];
  let pos = 0, shown = null;
  const fake = {
    loadVideoById: (a) => { calls.push(["loadVideoById", JSON.parse(JSON.stringify(a))]); pos = 0; },
    seekTo: (s, ahead) => { calls.push(["seekTo", s, ahead]); pos = s; },
    stopVideo: () => { calls.push(["stopVideo"]); },
    getVideoData: () => (shown ? { video_id: shown } : {}), getDuration: () => 200,
    getCurrentTime: () => pos, getPlayerState: () => 3,
  };
  const deep = new Proxy(function () { return undefined; }, { get: (t, k) => (k === "then" || k === Symbol.toPrimitive || k === Symbol.iterator ? undefined : deep), apply: () => deep, set: () => true });
  let onState = null;
  // The room's box player, through the plug — whose check logs its corrections (the seek's line, `ddjp_714`) to the same log.
  const { bp, w } = PW.boxPlayer(fake, { on: { state: (word, b) => onState(word, b) },
    extras: { Logger: { info: (m) => lines.push(String(m)), warn() {}, debug() {}, error() {} }, Date: { now: () => clock.t } } });
  const target = { player: bp, SongPlayer: w.SongPlayer, _wantSong: null, _loadTimer: null, _currentSong: null, _endedPi: null, _heldPi: null, PlaylistPanels: { previewActive: () => false }, _lastPlayPi: null,
    _loadAsk: null, _plogWin: 0, _plogN: 0, _plogHeld: 0, _loadsByPi: Object.create(null),
    PLAYER_LOAD_RETRY_MS: 500, VOLUME_APPLY_DELAY_MS: 1000, JSON, Math, Number, isFinite,
    Date: { now: () => clock.t }, Logger: { info: (m) => lines.push(String(m)), warn() {}, debug() {}, error() {} },
    ServerClock: { serverNow: () => clock.t }, setTimeout: () => 0, clearTimeout() {},
    MediaBlocked: { notifyPlayerFailed() {} }, Songs: SONGS,
    Playback: o.Playback || { elapsedSec: (np) => (clock.t - np.startedAt) / 1000, notifyEnded() {}, setDuration() {} },
    _botViewOff: () => false, _showPlayerShield: (show, label) => covers.push({ at: clock.t, show: !!show, label: label || null, calls: calls.length }) };
  const scope = new Proxy(target, { has: () => true, set: (t, k, v) => { t[k] = v; return true; },
    get: (t, k) => (k in t) ? t[k] : (k === Symbol.unscopables ? undefined : (k in globalThis ? globalThis[k] : deep)) });
  const api = new Function("scope", "with (scope) {\n" + SRC + "\nreturn { _driveNowPlaying, loadSong, _plog, _noteLoadState, _reloadAtRoomPoint };\n}")(scope);
  target._plog = api._plog; target._noteLoadState = api._noteLoadState;   // the state handler reaches them by name, as in the file
  target._reloadAtRoomPoint = api._reloadAtRoomPoint;
  onState = new Function("scope", "with (scope) {\nreturn (" + ev.handlers.state + "); }")(scope);
  // YouTube shows what it was handed: the id of the wanted song's key. Its state number reaches the handler through its player and the plug.
  const state = (d) => { if (d === STATES.PLAYING) shown = (target._wantSong && SONGS.idOf(target._wantSong.songKey)) || shown; w.state(0, d); };
  // The room's push, as `onPlaybackStateChange` takes it: remembered as the last now-playing, then driven.
  const drive = (np) => { target._lastNp = np; try { api._driveNowPlaying(np); } catch (e) {} };
  return { clock, calls, lines, covers, fake, target, api, state, drive, setPos: (p) => { pos = p; }, setShown: (v) => { shown = v; } };
}
const said = (p, re) => p.lines.filter((l) => re.test(l));

// ── PART A — the lines ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const p = page();
  const np = { pi: "$p1", dj: "@d:hs", song: { songKey: "yt:vidAAAAAAAA" }, startedAt: p.clock.t - 1100 };
  p.drive(np);                                                     // the play arrives 1.1 s after the homeserver stamped it
  ok(p.calls.length === 1 && p.calls[0][0] === "loadVideoById" && JSON.stringify(p.calls[0][1]) === JSON.stringify({ videoId: "vidAAAAAAAA", startSeconds: 1.1 }),
    "A PREMISE — the new play is loaded once, with exactly the arguments the player was always given", p.calls);
  p.clock.t += 300; p.state(STATES.UNSTARTED);
  p.clock.t += 1200; p.state(STATES.BUFFERING);
  p.clock.t += 3370; p.setPos(1.1); p.state(STATES.PLAYING);
  const pl = said(p, /^Player: playing pi=/);
  ok(pl.length === 1 && pl[0] === "Player: playing pi=$p1 yt:vidAAAAAAAA 4870 ms after its load (asked start=1.1s, playing from 1.1s; states since: unstarted,buffering,playing)",
    "A1: the first \"playing\" after a load says, once, how long after its load, from where, and the states in between — in the plug's words", pl);
  p.clock.t += 60000; p.state(STATES.PAUSED); p.clock.t += 2000; p.state(STATES.PLAYING);
  ok(said(p, /^Player: playing pi=/).length === 1, "A2: an unpause later is not a load — no second line", said(p, /^Player: playing pi=/));
  // The 10 s check: the room says 40 s, the player 12 s.
  p.setPos(12);
  p.drive(Object.assign({}, np, { elapsed: 40, duration: 200 }));
  const sk = said(p, /^Player: corrected yt — the player at /);
  ok(sk.length === 1 && sk[0].indexOf("Player: corrected yt — the player at 12.0 s, the room at 40.0 s: more than 10 s apart (sought to 40.0 s; ") === 0 &&
    /; \d+ ms after its load\)$/.test(sk[0]), "A3: a seek says where to, why, and how long after its load — one line, the check's (`ddjp_714`)", sk);
  const seeks = p.calls.filter((c) => c[0] === "seekTo");
  ok(seeks.length === 1 && seeks[0][1] === 40 && seeks[0][2] === true, "A4: and the player is asked exactly what it was before: seekTo(40, true), once", seeks);
  ok(p.calls.every((c) => ["loadVideoById", "seekTo"].indexOf(c[0]) >= 0) && p.calls.length === 2,
    "A4: nothing else is asked of the player — the lines only read it", p.calls);
  // A seek DURING a load says so.
  const q = page();
  q.drive({ pi: "$p2", dj: "@d:hs", song: { songKey: "yt:vidBBBBBBBB" }, startedAt: q.clock.t - 500 });
  // The player names the song it was handed (as YouTube's does once its load has started) but has not played it yet. While a
  // player names no song at all, the check waits for its load and seeks nothing (`ddjp_714`: the load starts at the room's point).
  q.clock.t += 800; q.setPos(0); q.setShown("vidBBBBBBBB");
  q.drive({ pi: "$p2", dj: "@d:hs", song: { songKey: "yt:vidBBBBBBBB" }, startedAt: q.clock.t - 1300, elapsed: 30, duration: 200 });
  ok(said(q, /^Player: corrected yt — the player at /).some((l) => / 800 ms after its load, before it first played\)$/.test(l)),
    "A5: a seek before the load first played says so", said(q, /^Player: corrected yt — the player at /));
}

// ── PART B — the candidates, with the real Playback ────────────────────────────────────────────────────────────────────
{
  const clock = { t: 1.7e12 };
  const handlers = {};
  const st = { nowPlaying: null, rotation: [], settings: { vouchJitter: 1000, presendMs: 300 }, advance: null };
  const PB = loadInContext(["features/playback.js"], {
    Date: { now: () => clock.t }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    StreamManager: { getState: () => st, on: (t, f) => { (handlers[t] = handlers[t] || []).push(f); }, off() {} },
    ServerClock: { serverNow: () => clock.t, elapsedSince: (ts) => clock.t - ts },
    MatrixBridge: { botRung: () => null, mayAdvance: () => ({ ok: true }), sendEvent: async () => ({}) },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "owner" },
    Logger: { info() {}, warn() {}, debug() {}, error() {} },
  }).Playback;
  const p = page({ Playback: PB });
  p.clock.t = clock.t;
  Object.defineProperty(p.clock, "t", { get: () => clock.t, set: (v) => { clock.t = v; } });
  PB.initWiring("!ev:hs");
  PB.onStateChange((np) => p.drive(np));
  const pushes = [];
  const fire = (t) => (handlers[t] || []).forEach((f) => f({}));
  // Song 1 plays; it ends in this player.
  st.nowPlaying = { pi: "$s1", dj: "@d:hs", song: { songKey: "yt:vidSONG0001" }, startedAt: clock.t - 200000, settings: st.settings };
  st.advance = { pi: "$s1", earliestAt: clock.t - 1000, gateLenSec: 200 };
  fire("ddjp.dj.play");
  p.state(STATES.PLAYING);
  const c0 = p.covers.length;
  p.setShown("vidSONG0001");
  PB.notifyEnded("yt:vidSONG0001", "$s1");
  const up = p.covers.slice(c0).find((c) => c.show && c.label === "Waiting for the next song…");
  ok(!!up, "B3: the finished song's ENDED puts up the room's waiting cover at once", p.covers.slice(c0));
  // The next play is accepted 1.43 s later and reaches this tab 0.9 s after the homeserver stamped it.
  clock.t += 1430;
  st.nowPlaying = { pi: "$s2", dj: "@d:hs", song: { songKey: "yt:vidSONG0002" }, startedAt: clock.t - 900, settings: st.settings };
  st.advance = { pi: "$s2", earliestAt: clock.t + 200000, gateLenSec: null };
  const loadsBefore = p.calls.filter((c) => c[0] === "loadVideoById").length, coversBefore = p.covers.length;
  fire("ddjp.dj.play");
  const loads = p.calls.filter((c) => c[0] === "loadVideoById").slice(loadsBefore);
  const down = p.covers.slice(coversBefore).find((c) => !c.show);
  ok(loads.length === 1 && !!down && down.at === clock.t, "B3: the next play's push asks for the load and takes the cover down in the same call — " +
    "what shows after it is the player's own loading", { loads, covers: p.covers.slice(coversBefore) });
  ok(loads.length === 1 && Math.abs(loads[0][1].startSeconds - 0.9) < 1e-9, "B2: a new song is asked to start where the room is — here 0.9 s in, the time " +
    "the play took to reach this tab — so every new song starts with a seek", loads);
  console.log("[player-trail] MEASURED a new song's load: startSeconds " + (loads[0] ? loads[0][1].startSeconds : "?") + " for a play that reached the tab 0.9 s after it was stamped");
  // The first 15 s: a 5 s load during which the player reports 0, the room's tick every 2 s, the player's duration known at PLAYING.
  p.setPos(0);
  const seeksBefore = p.calls.filter((c) => c[0] === "seekTo").length;
  const s2At = st.nowPlaying.startedAt;
  let ticks = 0;
  while (clock.t + 2000 - s2At < 15000) {
    clock.t += 2000; ticks++;
    if (ticks === 3) { p.state(STATES.PLAYING); PB.setDuration("yt:vidSONG0002", 200); }   // YouTube plays about 5 s in
    PB._tick();
  }
  const early = p.calls.filter((c) => c[0] === "seekTo").length - seeksBefore;
  ok(early === 0, "B1: in the song's first 15 s nothing the room pushes carries its elapsed time, so the 10 s check cannot seek during a load — " +
    "not even with the player at 0 for 5 s", p.calls.filter((c) => c[0] === "seekTo"));
  clock.t = s2At + 17000; PB._tick();
  const late = p.calls.filter((c) => c[0] === "seekTo").length - seeksBefore;
  ok(late === 1 && said(p, /^Player: corrected yt — the player at /).length === 1, "B1 CONTROL: past 15 s a player still at 0 is seeked to the room, and says why — the check is live",
    { seeks: p.calls.filter((c) => c[0] === "seekTo"), lines: said(p, /^Player: corrected yt — the player at /) });
}

// ── PART C — the device follows the room's clock, with the real Playback ─────────────────────────────────────────────
{
  const clock = { t: 1.7e12 };
  const st = { nowPlaying: null, rotation: [], settings: { vouchJitter: 1000, presendMs: 300, graceMs: 1000 }, advance: null };
  const handlers = {};
  const PB = loadInContext(["features/playback.js"], {
    Date: { now: () => clock.t }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    StreamManager: { getState: () => st, on: (t, f) => { (handlers[t] = handlers[t] || []).push(f); }, off() {} },
    ServerClock: { serverNow: () => clock.t, elapsedSince: (ts) => clock.t - ts },
    MatrixBridge: { botRung: () => null, mayAdvance: () => ({ ok: true }), sendEvent: async () => ({}) },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "owner" },
    Logger: { info() {}, warn() {}, debug() {}, error() {} },
  }).Playback;
  const p = page({ Playback: PB });
  Object.defineProperty(p.clock, "t", { get: () => clock.t, set: (v) => { clock.t = v; } });
  PB.initWiring("!ev:hs");
  PB.onStateChange((np) => p.drive(np));
  const fire = (t) => (handlers[t] || []).forEach((f) => f({}));
  const KEY = "yt:vidCLOCK001";
  st.nowPlaying = { pi: "$c1", dj: "@d:hs", song: { songKey: KEY }, startedAt: clock.t - 50000, settings: st.settings };
  st.advance = { pi: "$c1", gateLenSec: 200, earliestAt: st.nowPlaying.startedAt + 199000, endsAt: st.nowPlaying.startedAt + 200000 };
  fire("ddjp.dj.play");
  p.state(STATES.PLAYING);
  const loads0 = p.calls.filter((c) => c[0] === "loadVideoById").length;
  clock.t += 10000; p.setPos(60);
  p.state(STATES.ENDED);                                           // the player ends 60 s into a 200 s song
  const reloads = p.calls.filter((c) => c[0] === "loadVideoById").slice(loads0);
  ok(loads0 === 1 && reloads.length === 1 && Math.abs(reloads[0][1].startSeconds - 60) < 1e-9 && reloads[0][1].videoId === "vidCLOCK001" &&
    !p.covers.some((c) => c.label === "Waiting for the next song…"),
    "C1: AN EARLY END IS LOADED ONCE MORE AT THE ROOM'S POINT (60 s), with no waiting cover", { loads0, reloads, covers: p.covers.map((c) => c.label) });
  p.state(STATES.PLAYING);
  clock.t += 1000;
  const loads1 = p.calls.filter((c) => c[0] === "loadVideoById").length;
  p.state(STATES.ENDED);                                           // and ends early again
  ok(p.calls.filter((c) => c[0] === "loadVideoById").length === loads1 && p.covers.some((c) => c.show && c.label === "Waiting for the next song…"),
    "C2: A SECOND EARLY END IN THE SAME PLAY HOLDS: the waiting cover, no more loads", { loads: p.calls.filter((c) => c[0] === "loadVideoById").length - loads1 });
  // The 10 s check against this player's own measured length (200 s), on a song the room says is further on.
  const q = page({ Playback: PB });
  Object.defineProperty(q.clock, "t", { get: () => clock.t, set: (v) => { clock.t = v; } });
  PB.setDuration("yt:vidCLOCK002", 200);
  const np2 = { pi: "$c2", dj: "@d:hs", song: { songKey: "yt:vidCLOCK002" }, startedAt: clock.t - 300000 };
  q.drive(np2);
  q.state(STATES.PLAYING); q.setPos(199);
  const s0 = q.calls.filter((c) => c[0] === "seekTo").length;
  q.drive(Object.assign({}, np2, { elapsed: 300, duration: 200 }));
  const past = q.calls.filter((c) => c[0] === "seekTo").length - s0;
  q.setPos(120);
  q.drive(Object.assign({}, np2, { elapsed: 150, duration: 200 }));
  const inside = q.calls.filter((c) => c[0] === "seekTo").slice(s0);
  ok(past === 0 && inside.length === 1 && inside[0][1] === 150,
    "C3: THE 10 s CHECK NEVER SEEKS PAST THE PLAYER'S OWN LENGTH LESS 1 s (the room at 300 s of a 200 s song: no seek), and still " +
    "seeks inside it (150 s against the player's 120: one seek)", { past, inside });
}

if (failed) { console.log("[player-trail] " + failed + " failure(s)"); process.exit(1); }
console.log("[player-trail] PASS — a new song's path to playing reads from the log, in the plug's words: the first \"playing\" after a load " +
  "says how long after its load, from where, and the states between; every seek says why and when; the player is asked nothing new. Driven with " +
  "the real Playback: the 10 s seek check cannot fire in a song's first 15 s, every new song is asked to start where the room is, and " +
  "the waiting cover comes down in the call that asks for the load; an early end is loaded once more at the room's point, a " +
  "second holds, and the 10 s check never seeks past the player's own end (" + asserts + " assertions)");
