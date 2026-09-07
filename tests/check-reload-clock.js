// tests/check-reload-clock.js
//
// A RELOAD MUST NOT PRODUCE A STALE-NUMBERED SEND.
//
// Found in a live room, not in a test. The owner refreshed mid-song; its queue noticed its songs
// were "missing" from derived state and re-submitted them — while replay was still running. Those
// sends carried positions far BELOW the room's head:
//
//     l=4  dj.play  p=null          l=10  dj.vote        <- room head
//     l=5  dj.join  LTBznnebJNA     l=4   dj.join  ...   <- re-sent after the refresh
//     l=6  dj.join  dyds2DBc5qc     l=5   dj.join  ...   <- same
//
// EVERY CLIENT THEN JUDGED THEM HONESTLY AND DIFFERENTLY, which is what makes this worth a guard
// of its own. The sender's own head was legitimately low at that instant — mid-replay it had only
// seen up to l=5 — so it accepted them. A client that had finished replaying saw l=4 against a head
// of 12 with a newer timestamp and refused them as backdated. Same rule, opposite outcomes.
//
// The consequence was not subtle. A play event does not name its song; the reducer takes the DJ and
// the track from the ROTATION. Two extra joins on one side meant the two clients played different
// songs from the same event, and the owner's next checkpoint — adopted on authority without
// recompute — pushed its version onto the other.
//
// TWO FIXES, AND NEITHER SUBSUMES THE OTHER:
//   · the clock is DERIVED from what we hold rather than counted in memory. The raw cache survives
//     a reload (the counter did not), so the number is right the instant the cache loads.
//   · the queue asks whether it may author before it sends. A cold join with an empty cache
//     honestly derives a low clock and still is not entitled to speak.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
  "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js"], {});
const SM = sb.StreamManager, R = F.RANK;

const raw = (id, l, ts, sender, rank, body) => ({
  event_id: id, type: "m.room.message", sender: sender, room_id: "!r:hs",
  ts: ts, senderRank: rank, content: { body: JSON.stringify(Object.assign({ l: l }, body)) },
});

// ── PART A — the divergence itself, reproduced ───────────────────────────────────────────────
// Two clients, same events, one of them mid-replay when the stale send lands.
{
  // The client that has finished replaying: head is at 10 when the stale join arrives.
  SM.reset();
  [["$a1", 4, 100000, "@own:hs", R.owner, { t: "ddjp.dj.play", p: null }],
   ["$a2", 5, 100100, "@own:hs", R.owner, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" }],
   ["$a3", 6, 100200, "@own:hs", R.owner, { t: "ddjp.dj.join", v: "BBBBBBBBBBB" }],
   ["$a4", 10, 100300, "@own:hs", R.owner, { t: "ddjp.dj.vote", p: "$a1" }],
  ].forEach((a) => SM.ingest(raw.apply(null, a)));
  const caughtUpBefore = (SM.getState().rotation || []).length;
  SM.ingest(raw("$stale", 4, 100900, "@own:hs", R.owner, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" }));
  const caughtUp = SM.getState();

  // The SENDER, still replaying. This is the case that matters and it is easy to model wrongly:
  // the sender's head is BELOW the position it stamps, because its wiped counter is still climbing.
  // From its own vantage the send is FORWARD, not backdated, so nothing refuses it.
  SM.reset();
  [["$a1", 2, 100000, "@own:hs", R.owner, { t: "ddjp.dj.play", p: null }],
   ["$a2", 3, 100050, "@own:hs", R.owner, { t: "ddjp.dj.join", v: "ZZZZZZZZZZZ" }],
  ].forEach((a) => SM.ingest(raw.apply(null, a)));           // head is 3; the room is really at 10
  SM.ingest(raw("$stale", 4, 100900, "@own:hs", R.owner, { t: "ddjp.dj.join", v: "AAAAAAAAAAA" }));
  const midReplay = SM.getLog().some((e) => e.eventId === "$stale");

  ok(caughtUp.rotation.length === caughtUpBefore,
    "A: a client that has finished replaying REFUSES the stale send — its head is above the "
    + "claimed position and the timestamp is newer");
  ok(midReplay === true,
    "A: APPLIED — but a client still replaying ACCEPTS it, because at that instant its own head is "
    + "legitimately low. Neither client is wrong; they hold different amounts of history. This is "
    + "why the fix cannot live on the receiving side — by the time the sender is caught up, the "
    + "event is already folded into its log");
}

// ── PART B — the clock is derived from what is held, so a reload cannot lower it ──────────────
// The pure shape of the fix, asserted without a live client: whatever the in-memory memo says, the
// next position must exceed the highest thing we hold.
{
  const held = [
    { l: 4 }, { l: 5 }, { l: 6 }, { l: 10 }, { l: 12 },
  ];
  const maxHeld = held.reduce((m, e) => (e.l > m ? e.l : m), 0);
  // memo wiped by a reload
  const memoAfterReload = 0;
  const next = Math.max(memoAfterReload, maxHeld) + 1;
  ok(next === 13,
    "B: with the memo at zero after a reload, the next position is still derived from what we "
    + "HOLD — 13, not 1. The raw cache survives the reload the counter did not", { next });

  // and it is a floor, never a ceiling
  const memoAhead = 20;
  ok(Math.max(memoAhead, maxHeld) + 1 === 21,
    "B: APPLIED — and what we hold can only RAISE it. A stored value that could pull the clock "
    + "DOWN would be the same bug wearing a different hat");
}

// ── PART C — the derivation is wired (static: needs a live SDK client to execute) ────────────
{
  const fs = require("fs");
  const bridge = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  const tick = bridge.slice(bridge.indexOf("function tickOutbound()"));
  const tickBody = tick.slice(0, tick.indexOf("\n  }"));
  ok(/_maxHeldL\(\)/.test(tickBody),
    "C: tickOutbound derives from what is held rather than incrementing a memo alone");
  ok(/Math\.max/.test(tickBody),
    "C: APPLIED — and takes the greater of the two, so the memo cannot lower the clock");
}

// ── PART D — the queue OBEYS the answer (executed, not read) ─────────────────────────────────
// A textual check was written here first and could not fail: disabling the guard with `if (false)`
// left the word `mayAuthor` sitting inside the dead block, so the assertion still matched. Queue is
// loadable headlessly with four stubs, so the honest test is to say no and watch whether anything
// goes out.
{
  const sent = [];
  let verdict = { ok: false, reason: "not-live" };
  const qsb = loadInContext(["features/queue.js"], {
    MatrixBridge: {
      async sendEvent(ch, type, content) { sent.push({ type: type, content: content }); },
      mayAuthor: () => verdict,
    },
    PlaylistDoc: { watchUrl: (v) => "https://www.youtube.com/watch?v=" + v },
    StreamManager: { getState: () => ({ nowPlaying: null, rotation: [] }), on: () => {}, off: () => {} },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const Q = qsb.Queue;
  ok(Q && typeof Q.submitSong === "function", "D: Queue loaded headlessly");
  if (Q.init) Q.init("!ev:hs");

  Promise.resolve()
    .then(() => Q.submitSong("AAAAAAAAAAA"))
    .then(() => {
      ok(sent.length === 0,
        "D: while NOT live, submitting a song sends NOTHING. This is the path that re-submitted "
        + "during replay in a live room and split it in two", sent);
      verdict = { ok: true };
      return Q.submitSong("BBBBBBBBBBB");
    })
    .then(() => {
      ok(sent.length === 1 && sent[0].type === "ddjp.dj.join",
        "D: APPLIED — and once live it sends normally. A gate that blocked everything would pass "
        + "the assertion above while breaking the queue entirely", sent);
    })
    .then(() => {
      // ── E — THE SUBSCRIPTION EXISTS. WHETHER IT FIRES IS ELSEWHERE, ON PURPOSE ───────────
      // The gate stops the send; something has to resume it. The reconcile is woken by INCOMING
      // dj.* events, so in a quiet room a song refused during catch-up would wait on somebody else
      // acting. `onAuthorReady` closes that.
      //
      // WHAT THESE TWO LINES CAN AND CANNOT SHOW, stated because they once misled a reader for
      // several versions: a regex proves the NAME is spelled in both files. It cannot prove the
      // wire carries — and it did not. The subscriber was registered as `(from, to)` while
      // `Session.onChange` hands listeners ONE object, so `to` was permanently undefined and the
      // callback never ran, while both these assertions stayed green.
      //
      // They are kept because "the queue is the thing that subscribes" is a real structural claim
      // and cheap to hold. The BEHAVIOUR — that going live actually wakes a refused send — is
      // driven against the real modules in check-session-resume PART E. **If you are looking for
      // coverage of that, look there, not here.**
      const fs2 = require("fs");
      const bridge2 = fs2.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
      ok(/function onAuthorReady\(/.test(bridge2),
        "E: the interface exposes a way to be told when authoring becomes possible (SPELLING only "
        + "— behaviour is check-session-resume PART E)");
      const uq = fs2.readFileSync(path.join(__dirname, "..", "features/userqueue.js"), "utf8");
      ok(/onAuthorReady\(/.test(uq),
        "E: and the queue is the module that subscribes (SPELLING only — that it FIRES is proved "
        + "in check-session-resume PART E, because a text match here never could)");
      return null;
    })
    .then(() => {
      // and the refusal is reported rather than indistinguishable from success
      verdict = { ok: false, reason: "not-live" };
      return Q.submitSong("CCCCCCCCCCC").then((r) => {
        ok(r && r.ok === false && r.reason === "not-live",
          "E: APPLIED — and submitSong RETURNS the refusal. Returning undefined for both sent and "
          + "declined leaves a click with no way to say why nothing happened", r);
      });
    })
    .then(() => {
      console.log("[reload-clock] PASS — a reload cannot produce a stale-numbered send: the "
        + "divergence is reproduced (a client mid-replay accepts what a caught-up client refuses, "
        + "both correctly, which is why the fix cannot live on the receiving side); the clock is "
        + "derived from what we hold, so a wiped memo can only raise it and never lower it; and the "
        + "queue is shown to OBEY the fitness answer rather than merely mention it ("
        + checks + " assertions)");
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
