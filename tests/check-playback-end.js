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
  ["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/skip.js"],
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

// --- 5) THE ID-PRESENT CLAUSE IS LOAD-BEARING, AND ONLY ON MATCHING ABSENCES (J48) ----------
// `shouldEndOn` opens with `videoId &&`, which reads as dominated by the equality beside it — a
// null id cannot equal a string. It is the ONLY enforcement when the room's own song carries no
// id EITHER, where the equality answers TRUE on two absences and an ENDED nobody could confirm
// advances the room. Part 1 above cannot express that: every `np` it builds has a real id, so
// dropping the clause left all of it green and the whole suite with it.
//
// WHY THIS IS DRIVEN AND NOT A ROW CALLING THE PREDICATE. A hand-built `{ song: { videoId: null } }`
// would go red under the mutation and prove nothing anybody needed: the open question was whether
// the room can BE in that state and whether the signal can ARRIVE in the shape that collides with
// it. Both halves are other modules', so both come from those modules here — the state out of
// `StateDeriver`'s seed path, the signal out of `ui/interface.js`'s own ENDED branch, executed.
//
// AND THE PAIRING MATTERS, which is the correction this part carries. `09-roadmap.md` J48 describes
// the state as a seed whose song object has no `videoId` key at all, folding to `undefined`. That
// state is real — but the shipped UI normalises an unconfirmable reading to `null`, and
// `undefined === null` is FALSE, so that pairing refuses with or without the clause. The clause
// defends MATCHING absences. `null`/`null` is the one reachable through today's wire.
{
  const P = require("./_probe-j48-endon.js");

  const st = P.selfTest();
  if (st.missed.length) fail("5: the admissibility gate MISSED " + JSON.stringify(st.missed) +
    " — every reading below would then be certified by a gate that cannot refuse");
  if (st.rejectedGood) fail("5: the gate rejects honest readings " + JSON.stringify(st.rejectedGood) +
    " — a gate that refuses everything makes every row below free");

  // ── the state, from the reducer's own seed path ──────────────────────────────────────────
  const sReal = P.seededState("real");
  const sNull = P.seededState(null);
  const sAbsent = P.seededState("absent");
  for (const [name, s] of [["real", sReal], ["null", sNull], ["absent", sAbsent]]) {
    if (!s.ok) fail("5: the seeded fold did not produce a state for the " + name + " case — " + s.stage);
  }
  if (!sNull.np.song) fail("5: a seed whose song carries a null id must still fold to a TRUTHY song " +
    "— if the reducer starts refusing it, this row has stopped testing anything and the clause may " +
    "genuinely be dominated", sNull.np);
  if (sNull.np.song.videoId !== null) fail("5: expected the seed path to copy the null id through " +
    "verbatim (it applies `videoId: n.song.videoId` with no type check)", sNull.np.song);
  if (sAbsent.np.song.videoId !== undefined) fail("5: expected an absent key to survive as undefined",
    sAbsent.np.song);

  // ── the signal, from the shipped UI's own ENDED branch ───────────────────────────────────
  // Pinned rather than assumed: which absence the clause has to defend is decided HERE, and a
  // future tidy that forwards `undefined` instead would move the answer without touching playback.js.
  for (const [what, data, opts] of [
    ["getVideoData() answers undefined (the documented mid-swap reading)", undefined, null],
    ["getVideoData() answers an object with no video_id", {}, null],
    ["getVideoData() throws", null, { throws: true }],
  ]) {
    const w = P.endedIdFromWire(data, opts);
    if (!w.ok) fail("5: the ENDED branch could not be driven — " + w.stage);
    if (w.threw) fail("5: the extracted ENDED branch threw (" + w.threw + ")");
    if (w.forwarded.length !== 1) fail("5: the ENDED branch should forward exactly once when " +
      what, w.forwarded);
    if (w.forwarded[0] !== null) fail("5: an unconfirmable reading must reach Playback as null, " +
      "because that is the value the clause has to survive being compared against a song with no " +
      "id — got " + JSON.stringify(w.forwarded[0]) + " when " + what);
  }
  const wReal = P.endedIdFromWire({ video_id: sReal.np.song.videoId });
  if (!wReal.ok || wReal.forwarded[0] !== sReal.np.song.videoId) {
    fail("5: a confirmed reading must forward the id itself, or the control below is not a control",
      wReal.forwarded);
  }

  // ── THE CONTROL, first: a refusal is evidence only if something adjacent was admitted ─────
  const control = P.driveEnded(sReal.np, wReal.forwarded[0]);
  const ca = P.admissible(control, { expectAdvance: true, np: sReal.np });
  if (!ca.ok) fail("5: the CONTROL authored no advance, so every refusal below is free and this " +
    "whole part would pass on a build that can never advance at all", ca.problems);

  // ── THE PINS ─────────────────────────────────────────────────────────────────────────────
  // `collides` is what keeps each row honest: the equality beside the clause must answer TRUE, or
  // the row would refuse for one of the three conditions next to it and pin nothing.
  const pins = [
    { name: "a seed-restored song with a NULL id, and the ENDED the wire hands over when the " +
            "player cannot say which video finished",
      np: sNull.np, ended: null,
      why: "`null === null` answers TRUE, so without the id-present clause this authors a " +
           "ddjp.dj.play for a song neither the client nor the room can name — an advance on an " +
           "ENDED nobody confirmed. The room's own gate and advance lock still judge it, so this " +
           "is a wrong proposal rather than a fork; the cost is a real playing cut short on one " +
           "client's unconfirmable reading" },
    { name: "the same collision reached the other way: a song object with no id key at all, and a " +
            "caller that passes undefined",
      np: sAbsent.np, ended: undefined,
      why: "no production caller passes undefined today — the UI normalises to null — so this pins " +
           "the clause against a J29 player adapter arriving with the other absence, rather than " +
           "against the shipped wire" },
  ];
  for (const p of pins) {
    const r = P.driveEnded(p.np, p.ended);
    const a = P.admissible(r, { expectAdvance: false, np: p.np,
      collides: { videoId: p.ended, expect: true } });
    if (!a.ok) fail("5: " + p.name + " — expected NO advance. " + p.why, a.problems);
    if (r.endedPushes.length !== 0) fail("5: " + p.name + " — and no ended:true push either, or " +
      "the UI greys out Skip and reports nothing playing over a song that is still going",
      r.endedPushes);
  }

  // ── THE PAIRING THAT DOES **NOT** PIN, recorded so nobody rebuilds this row from the entry ──
  // A row asserting "no advance" here would be green with the clause and green without it: the
  // decorative assertion this part exists to avoid, one step from where it was nearly written.
  // What is asserted instead is the fact that makes it non-pinning, which is a real claim about
  // the two shapes and goes red if either end changes.
  {
    const eq = sAbsent.np.song.videoId === null;
    if (eq) fail("5: an ABSENT song id now compares equal to the wire's null. The pairing above " +
      "that was recorded as non-discriminating has become discriminating, and the pins need " +
      "re-deriving rather than trusting");
    const r = P.driveEnded(sAbsent.np, null);
    if (r.ok && r.advances.length !== 0) fail("5: an absent song id with a null ENDED authored an " +
      "advance, which no condition in shouldEndOn should allow", r.advances);
  }
}

console.log("[playback-end] PASS — shouldEndOn/notifyEnded end only on a real id match; canSkip tracks consensus now-playing; the wall-clock fallback advances without falsely declaring the song ended. AND the id-present clause is pinned where it is the ONLY bar: a checkpoint SEED restores `song: { videoId: n.song.videoId }` with no type check, so the room can hold a truthy song it cannot name, and the shipped ENDED branch — extracted from ui/interface.js and EXECUTED — hands over exactly `null` when the player cannot say which video finished. On that pair the equality answers TRUE and only `videoId &&` stops an unconfirmed ENDED authoring an advance; driven beside a control that authors a real one, so the refusal is the clause rather than the fixture");
process.exit(0);
