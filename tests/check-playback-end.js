// tests/check-playback-end.js
// WALL: the real-ENDED advance path. The YouTube iframe's ENDED event is the
// authoritative "song is over" signal; the wall-clock elapsed>=duration check
// in _tick is only a fallback. This guard pins the PURE decision that gates it
// — Playback.shouldEndOn(np, videoId) — and the synchronous behaviour of
// Playback.notifyEnded: it ends the song ONLY when the id that ended matches
// the song we believe is now-playing, so a stale ENDED during a video swap (or
// with no id available) can never advance the wrong song.

const { loadInContext } = require("./_load");

let cur = null;                       // settable nowPlaying for the stub stream
const sm = { getState: () => ({ nowPlaying: cur, rotation: [] }) };
const bridge = { async sendEvent() {} };
const logger = { debug() {}, warn() {}, info() {}, error() {} };

const sb = loadInContext(
  ["features/playback.js"],
  {
    Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
    StreamManager: sm, MatrixBridge: bridge, Logger: logger,
  }
);
const { Playback } = sb;

function fail(msg, got) {
  console.log("[playback-end] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// --- 1) shouldEndOn is a total, pure match test -----------------------------
const np = { song: { videoId: "VID1" }, pi: "$p1", dj: "@a:hs", startedAt: 0 };
if (Playback.shouldEndOn(np, "VID1") !== true)  fail("matching id should end the current song");
if (Playback.shouldEndOn(np, "VID2") !== false) fail("a different id must NOT end the current song");
if (Playback.shouldEndOn(np, null)  !== false)  fail("a missing ended-id must not end (wall-clock fallback handles it)");
if (Playback.shouldEndOn(np, "")    !== false)  fail("empty ended-id must not end");
if (Playback.shouldEndOn({ pi: "$p" }, "VID1") !== false) fail("np with no real song must not end");
if (Playback.shouldEndOn(null, "VID1")      !== false) fail("null now-playing must not end");
if (Playback.shouldEndOn(undefined, "VID1") !== false) fail("undefined now-playing must not end");

// --- 2) notifyEnded fires the local 'ended' push only on a real match -------
let pushes = [];
Playback.onStateChange((s) => pushes.push(s));   // registering also pushes current (null) once
pushes = [];                                     // ignore that initial push

cur = np;
Playback.notifyEnded("VID1");
const ended = pushes.filter((p) => p && p.ended === true);
if (ended.length !== 1) fail("matching ENDED should push exactly one ended:true state", pushes);
if (!ended[0].song || ended[0].song.videoId !== "VID1") fail("the ended push should carry the song that ended", ended[0]);

pushes = [];
Playback.notifyEnded("VID2");                    // wrong id — no-op
if (pushes.some((p) => p && p.ended)) fail("ENDED for a non-current song must not end anything", pushes);

pushes = [];
Playback.notifyEnded(null);                      // unknown id — no-op (wall-clock fallback)
if (pushes.some((p) => p && p.ended)) fail("ENDED with no id must not end anything", pushes);

cur = { pi: "$p", dj: "@a:hs" };                 // now-playing carries no real song
pushes = [];
Playback.notifyEnded("VID1");
if (pushes.some((p) => p && p.ended)) fail("ENDED while no real song is playing must not end anything", pushes);

// --- 3) Skip.canSkip: the button gate tracks consensus now-playing ----------
const sbSkip = loadInContext(
  ["features/skip.js"],
  { StreamManager: { getState: () => ({ nowPlaying: null }) }, MatrixBridge: {}, Room: {}, Logger: logger }
);
const { Skip } = sbSkip;
if (Skip.canSkip({ song: { videoId: "V" }, pi: "$p" }) !== true) fail("canSkip should be true when a real song is the current play-instance");
if (Skip.canSkip({ pi: "$p" }) !== false) fail("canSkip should be false when now-playing carries no real song");
if (Skip.canSkip(null) !== false) fail("canSkip should be false when nothing is playing");
if (Skip.canSkip(undefined) !== false) fail("canSkip should be false when now-playing is undefined");

// --- 4) the wall-clock fallback must NOT declare the song ended to the UI ----
// It still kicks the safety-net advance, but only the real ENDED signal ends the
// UI — so a song that's still the current play-instance stays skippable.
let clock = 0;
let tickFn = null;
const sent = [];
const np2 = { song: { videoId: "VIDX" }, pi: "$pX", dj: "@me:hs", startedAt: 0 };
const sm2 = { getState: () => ({ nowPlaying: np2, rotation: [{}] }), on() {}, off() {} };
const bridge2 = { getUserId: () => "@me:hs", async sendEvent(ch, type, body) { sent.push({ type, body }); } };
const sb2 = loadInContext(
  ["features/playback.js"],
  {
    Date: { now: () => clock },
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 1; },       // run the jittered advance emit synchronously
    clearTimeout: () => {},
    StreamManager: sm2, MatrixBridge: bridge2, Logger: logger,
  }
);
const PB = sb2.Playback;
let pushes2 = [];
PB.onStateChange((st) => pushes2.push(st));
PB.setDuration("VIDX", 100);                       // 100s song
PB.init("!room:hs");                               // wiring + start -> captures _tick via fake setInterval
clock = 200000;                                    // 200s elapsed: past GRACE and well past duration
pushes2 = [];
sent.length = 0;
if (typeof tickFn !== "function") fail("expected start() to register a tick via setInterval");
tickFn();                                          // one tick in the elapsed >= duration branch
if (pushes2.some((p) => p && p.ended)) fail("the wall-clock fallback must NOT push ended:true — only the real ENDED signal ends the UI", pushes2);
const lastPush = pushes2[pushes2.length - 1];
if (!lastPush || lastPush.elapsed !== 100) fail("the wall-clock branch should clamp the progress readout to full duration", lastPush);
if (!sent.some((e) => e.type === "ddjp.dj.play")) fail("the wall-clock fallback must still emit the safety-net advance", sent);

console.log("[playback-end] PASS — shouldEndOn/notifyEnded end only on a real id match; canSkip tracks consensus now-playing; the wall-clock fallback advances without falsely declaring the song ended");
process.exit(0);
