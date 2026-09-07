// tests/check-length-freshness.js
//
// A LENGTH IS MEASURED WHEN IT IS SENT, NOT WHEN THE SONG STARTED.
//
// The bug this locks out, and it cost a room ten minutes per song: the player's duration was read
// once, at YT.PlayerState.PLAYING, and then held while the client waited its rank slot. Six
// seconds later it sent the number it had captured — never asking the player again. During a song
// SWAP YouTube updates the video id immediately (we just told it the new one) while getDuration()
// still returns the PREVIOUS song's length, so the capture reads "new id, old length". The id
// check passes, because the id really is right. Only the NUMBER is stale.
//
// It then lands on the worst possible client. The owner's slot is zero, so the owner declares at
// the instant the stale read is most likely — the client with the least time to be right carries
// the most authority. And the reducer accepts ONE length per person per playing, so a client that
// declares a wrong number can never correct it, however quickly its player recovers.
//
// The room's rule is fine and is NOT what this guard touches: authority cascades, majority decides
// within a rank, a tie falls to the rank below. That rule was never the problem — the INPUT was.
//
// GUARANTEES:
//   PART A — THE READING IS TAKEN AT FIRE TIME. A provider that changes its answer between the
//     song starting and the slot firing has the LATER answer sent. This is the whole fix; a
//     captured value would send the earlier one.
//   PART B — AN UNCONFIRMABLE READING IS SILENCE, NOT A GUESS. No provider, a provider naming a
//     different video, or a non-positive duration sends NOTHING. Silence costs the room only the
//     grace floor; a wrong number costs it the ceiling.
//   PART C — THE OWNER GETS A SETTLING FLOOR. Slot zero is correct for ORDER and useless as an
//     observation window: with delay 0 the re-read happens in the same tick as the capture and can
//     never differ. Checkpoint already learned this and applied minDelayMs; the advance path never
//     did.
//   PART D — THE LOCAL DURATION IS CORRECTED TOO. knownDuration drives the wall-clock advance net
//     and the countdown, so leaving the stale value in place would keep firing early advances the
//     gate then refuses.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[length-freshness] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// A controllable clock + manual timer queue, so the rank slot can be fired deliberately.
function harness(opts) {
  const o = opts || {};
  let now = 0;
  const timers = [];
  const sent = [];
  const np = {
    dj: "@dj:hs", song: { videoId: o.playing || "NEWSONGAAAA" }, pi: "$p2", startedAt: 0,
    settings: { vouchJitter: 1000, maxLen: 600, minLen: 10, minGate: 8000, graceMs: 1000, presendMs: 300 },
  };
  const state = {
    nowPlaying: np,
    rotation: [{ user: "@dj:hs", pending: [] }],
    settings: np.settings,
    advance: { pi: "$p2", gateLenSec: o.agreed !== undefined ? o.agreed : null, earliestAt: 0, ceilingAt: 600000 },
  };
  const sb = loadInContext(["features/playback.js"], {
    Date: { now: () => now },
    Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: () => state, on: () => {}, off: () => {} },
    MatrixBridge: { async sendEvent(ch, type, content) { sent.push({ type: type, content: content }); } },
    Capabilities: { staggerMs: (rank, spacing) => (rank === 100 ? 0 : 6000) },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  sb.Playback.initWiring("!ev:hs");
  if (typeof o.myRank === "number") sb.Playback.setMyRank(o.myRank);
  return {
    Playback: sb.Playback, sent, np, state,
    delays: () => timers.map((t) => t.at - 0),
    fire: (at) => {
      now = (typeof at === "number") ? at : now;
      const due = timers.splice(0).sort((a, b) => a.at - b.at);
      due.forEach((t) => t.fn());
    },
  };
}

// ── PART A — the reading is taken at FIRE time ────────────────────────────────────────────────
// The player reports the PREVIOUS song's length at capture and the real one by the time the slot
// fires. The later answer is what must go on the wire.
(() => {
  const h = harness({ myRank: 0, playing: "NEWSONGAAAA" });
  if (!h.Playback.setDurationProvider) {
    failures++;
    console.log("[length-freshness] FAIL — A: Playback exposes no way to re-read the player at fire "
      + "time. A captured number is the bug; the fix is a PROVIDER, the same shape loadVideo "
      + "already uses for the playhead.");
    return;
  }
  let reading = { videoId: "NEWSONGAAAA", seconds: 600 };   // stale: the previous song's length
  h.Playback.setDurationProvider(() => reading);
  h.Playback.setDuration("NEWSONGAAAA", 600);              // captured at PLAYING, mid-swap
  reading = { videoId: "NEWSONGAAAA", seconds: 200 };       // metadata has now loaded: the truth
  h.fire(7000);
  const len = h.sent.filter((s) => s.type === "ddjp.play.len");
  ok(len.length === 1, "A: exactly one length declaration is authored", h.sent);
  ok(len.length === 1 && len[0].content.sec === 200,
    "A: APPLIED — the FIRE-TIME reading is sent (200), not the one captured when the song started "
    + "(600). Sending the capture is what pinned a whole room's gate to the previous song's length",
    len.map((x) => x.content));
})();

// ── PART B — an unconfirmable reading is silence ───────────────────────────────────────────────
(() => {
  // B1: the provider names a DIFFERENT video than the room says is playing.
  const h1 = harness({ myRank: 0, playing: "NEWSONGAAAA" });
  if (h1.Playback.setDurationProvider) {
    h1.Playback.setDurationProvider(() => ({ videoId: "OLDSONGAAAA", seconds: 600 }));
    h1.Playback.setDuration("NEWSONGAAAA", 600);
    h1.fire(7000);
    ok(h1.sent.filter((s) => s.type === "ddjp.play.len").length === 0,
      "B1: APPLIED — a reading whose video does not match the one consensus says is playing is not "
      + "declared. The room falls back to the grace floor, which is recoverable; a wrong number is "
      + "not", h1.sent);
  }

  // B2: no provider wired at all (a partial load, or a host that cannot answer).
  const h2 = harness({ myRank: 0, playing: "NEWSONGAAAA" });
  h2.Playback.setDuration("NEWSONGAAAA", 600);
  h2.fire(7000);
  ok(h2.sent.filter((s) => s.type === "ddjp.play.len").length === 0,
    "B2: APPLIED — with nothing able to confirm the reading, nothing is declared. An unconfirmed "
    + "measurement must never reach the wire, because one per person per playing is all the room "
    + "will ever accept", h2.sent);

  // B3: the provider answers, but with a non-positive duration.
  const h3 = harness({ myRank: 0, playing: "NEWSONGAAAA" });
  if (h3.Playback.setDurationProvider) {
    h3.Playback.setDurationProvider(() => ({ videoId: "NEWSONGAAAA", seconds: 0 }));
    h3.Playback.setDuration("NEWSONGAAAA", 200);
    h3.fire(7000);
    ok(h3.sent.filter((s) => s.type === "ddjp.play.len").length === 0,
      "B3: APPLIED — a zero/absent duration is refused rather than rounded into a claim", h3.sent);
  }
})();

// ── PART C — the owner gets a settling floor ───────────────────────────────────────────────────
(() => {
  const h = harness({ myRank: 100 });   // owner: staggerMs answers 0
  if (h.Playback.setDurationProvider) h.Playback.setDurationProvider(() => ({ videoId: "NEWSONGAAAA", seconds: 200 }));
  h.Playback.setDuration("NEWSONGAAAA", 200);
  const d = h.delays();
  ok(d.length === 1 && d[0] > 0,
    "C: APPLIED — the owner's declaration is planned with a delay ABOVE zero. Rank zero is the "
    + "right answer to 'whose turn is it' and the wrong answer to 'has anything had time to "
    + "settle' — a re-read in the same tick as the capture can never differ, which is what left "
    + "the highest authority in the room with the least chance of being right", d);
})();

// ── PART D — the local duration is corrected too ───────────────────────────────────────────────
// knownDuration drives the wall-clock advance net and the countdown. A stale value there keeps
// producing advances the reducer then refuses, which reads as the room ignoring this client.
(() => {
  const h = harness({ myRank: 0 });
  if (!h.Playback.setDurationProvider) return;   // PART A already reported the missing seam
  let reading = { videoId: "NEWSONGAAAA", seconds: 600 };
  h.Playback.setDurationProvider(() => reading);
  h.Playback.setDuration("NEWSONGAAAA", 600);
  reading = { videoId: "NEWSONGAAAA", seconds: 200 };
  h.fire(7000);
  const dd = h.Playback.knownDurationFor ? h.Playback.knownDurationFor("NEWSONGAAAA") : null;
  ok(dd === 200,
    "D: APPLIED — the confirmed reading replaces the stale local one, so the wall-clock net and "
    + "the countdown stop running on a number the client itself has already disproved", dd);
})();

if (failures) process.exit(1);
console.log("[length-freshness] PASS — a declared song length is MEASURED AT THE MOMENT IT IS SENT, "
  + "never captured when the song started and held through the rank slot: a provider that changes "
  + "its answer while we wait has the later answer declared, a reading that cannot be confirmed "
  + "against the song consensus says is playing is not declared at all, the owner is given a "
  + "settling floor so slot zero is an observation window rather than the same tick, and the "
  + "corrected reading replaces the stale local one that drives the wall-clock net");
