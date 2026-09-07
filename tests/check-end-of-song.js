// tests/check-end-of-song.js
//
// A SONG THAT HAS ENDED STAYS ENDED UNTIL THE ROOM MOVES ON.
//
// `ended` was a ONE-SHOT: it rode on the single state push made when the iframe reported ENDED,
// and the very next push — the ordinary progress tick, two seconds later — carried no such flag
// while the song was exactly as finished as before. The view took that second push at face value
// and undid everything the first one had set up.
//
// What that produced at every song boundary, on a loop until the advance landed:
//   ENDED -> stop the video, shield the player, say "nothing playing"
//   +2s   -> a tick with no `ended` -> un-shield, restart the progress loop, say the song is
//            playing again, and — because stopping the video makes the player stop reporting an
//            id — RELOAD the finished song and seek past its own end, so it ends again
//   +2s   -> repeat
// The player visibly reloading itself at the end of every song, the label flickering between the
// song and "nothing playing", and YouTube's own end-of-video related-grid flashing in and out.
//
// The fix is not to add the flag at the second call site. It is to stop asking each push to
// remember: the FACT is "this play instance has ended", it belongs to the instance, and it is
// true from the moment it happens until a different instance replaces it.
//
// WHAT MUST NOT CHANGE: the wall-clock estimate still does NOT declare a song over. That estimate
// can trip while a song is genuinely still audible — a short or wrong player-reported duration, or
// a mid-song joiner whose startedAt runs ahead of real audio position — and a false "ended" used
// to grey out Skip and flash "nothing playing" over music that was still going. Only the real
// iframe signal sets this. PART C is what keeps that true.
//
// GUARANTEES:
//   PART A — STICKY. Once the real ENDED arrives for an instance, every later push about that
//     same instance still says ended. This is the whole fix.
//   PART B — INSTANCE-SCOPED. A new play instance is not ended. The flag follows the song, not
//     the client, so it cannot leak across an advance and blank out the next song.
//   PART C — THE WALL CLOCK STILL DOES NOT DECLARE AN END. An instance that only ran past its
//     estimated duration is NOT reported ended; only the real signal does that.
//
// The VIEW half — not reloading an instance already ended, and drawing one deliberate waiting
// state instead of churning — is DOM and is review-only, exactly like the SDK edges elsewhere.
// What is guarded here is the fact the view reads, because a view that is handed a flag which
// keeps flipping cannot be written correctly no matter how careful it is.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[end-of-song] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function harness() {
  let now = 0;
  const timers = [];
  const np = {
    value: {
      dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
      settings: { maxLen: 600, minLen: 10, vouchJitter: 1000, minGate: 8000, graceMs: 1000, presendMs: 300 },
    },
  };
  const state = () => ({
    nowPlaying: np.value,
    rotation: [{ user: "@a:hs", pending: [] }],
    settings: np.value ? np.value.settings : {},
    advance: np.value ? { pi: np.value.pi, gateLenSec: null, earliestAt: 0, ceilingAt: 600000 } : null,
  });
  const pushes = [];
  const sb = loadInContext(["features/playback.js"], {
    Date: { now: () => now },
    Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: state, on: () => {}, off: () => {} },
    MatrixBridge: { async sendEvent() {}, mayAdvance: () => ({ ok: true }) },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "uncategorized" },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  sb.Playback.initWiring("!ev:hs");
  sb.Playback.onStateChange((s) => { if (s) pushes.push(s); });
  return {
    P: sb.Playback, np, pushes,
    at: (t) => { now = t; },
    tick: () => sb.Playback._tick(),
    last: () => pushes[pushes.length - 1] || null,
  };
}

// ── PART A — sticky across later pushes ────────────────────────────────────────────────────────
(() => {
  const h = harness();
  h.P.setDuration("AAAAAAAAAAA", 200);        // the player reports a real duration
  h.at(200000);
  h.P.notifyEnded("AAAAAAAAAAA");             // the REAL iframe signal
  ok(h.last() && h.last().ended === true,
    "A: the push made at the moment of ENDED says so", h.last());

  h.pushes.length = 0;
  h.at(202000);
  h.tick();                                   // the ordinary progress tick, two seconds later
  const after = h.last();
  ok(after !== null, "A: the tick still pushes state for a finished song", after);
  ok(after && after.ended === true,
    "A: APPLIED — a later push about the SAME instance still reports it as ended. It was a "
    + "one-shot flag, so this push said the song was playing again while it was exactly as "
    + "finished as before — which is what made the view tear the ended state down, reload the "
    + "song it had just stopped, and do it all again two seconds later", after);
})();

// ── PART B — the flag belongs to the instance, not the client ─────────────────────────────────
(() => {
  const h = harness();
  h.P.setDuration("AAAAAAAAAAA", 200);
  h.at(200000);
  h.P.notifyEnded("AAAAAAAAAAA");
  ok(h.last() && h.last().ended === true, "B: ended before the advance", h.last());

  // the room advances: a new play instance, a new song
  h.np.value = { dj: "@b:hs", song: { videoId: "BBBBBBBBBBB" }, pi: "$p2", startedAt: 200000,
                 settings: h.np.value.settings };
  h.pushes.length = 0;
  h.at(203000);
  h.tick();
  const after = h.last();
  ok(!after || after.ended !== true,
    "B: APPLIED — the new instance is NOT ended. A flag that outlived its song would blank the "
    + "next one out the moment it started", after);
})();

// ── PART C — the wall clock still does not declare an end ─────────────────────────────────────
(() => {
  const h = harness();
  h.P.setDuration("AAAAAAAAAAA", 30);         // an under-reported duration: the song is still going
  h.at(60000);                                // well past the estimate, no real ENDED ever fired
  h.pushes.length = 0;
  h.tick();
  const after = h.last();
  ok(after && after.ended !== true,
    "C: APPLIED — running past the ESTIMATED duration does not report the song as over. That "
    + "estimate trips while music is still audible, and a false end greys out Skip and shows "
    + "'nothing playing' over a song that is still going. Only the real iframe signal ends a song",
    after);
})();

if (failures) process.exit(1);
console.log("[end-of-song] PASS — a finished song stays finished: the real end signal is recorded "
  + "against the PLAY INSTANCE rather than ridden on a single state push, so every later push "
  + "about that song still reports it as over instead of claiming it is playing again two seconds "
  + "later; the fact clears when a new instance replaces it and never leaks onto the next song; "
  + "and the wall-clock estimate still declares nothing, because it trips while music is audible");
