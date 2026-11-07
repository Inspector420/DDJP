// tests/check-session-resume.js
// SUBJECT: backends/backend1/session.js, backends/backend1/matrixbridge.js
// `matrixbridge.js` ADDED at `ddjp_384` — under-declared. PART E says in its own comment that a
// stand-in listener is exactly what will not do: "What has to be driven is `MatrixBridge.onAuthorReady`
// ITSELF." It loads the real module, registers through it, and asserts the callback fires. The defect
// it pins lived in `matrixbridge.js` — the subscriber destructured `Session.onChange`'s ONE object as
// two positional arguments, so `to` was permanently undefined and the callback never ran. Both sides
// are independently written (the emitter's payload shape, the subscriber's expectation), so this is
// compares-two rather than delegation, and a revert on either side turns PART E red.
// Note the earlier parts load `session.js` ALONE; only PART E builds the full tree. A reading that
// stopped at the first sandbox would see a single-module guard.
//
// A CLIENT THAT SUSPENDED ITSELF MUST BE ABLE TO COME BACK.
//
// Only a LIVE client authors anything — that rule is right and is not what this guard questions.
// What it locks is the way OUT of the phase that rule creates.
//
// THE TRAP, found by driving the beat with a throttled clock. `_beat` asked "did the wall clock
// jump?" BEFORE it asked "am I suspended, and is it time to come back?". A browser clamps timers in
// a background tab to roughly one per minute, so every beat was ~60s late, so every beat read as a
// fresh clock jump, so every beat re-suspended and returned — never reaching the resume branch below
// it. Measured: six consecutive throttled beats, still suspended, mayAuthor false throughout. The
// client could not advance a song, seal, or vouch again for the rest of its life.
//
// THE DISTINCTION THIS TURNS ON, and why the fix is not simply "let any sign of life resume":
//   OFFLINE / CONNECTION LOST — suspended DELIBERATELY, by a signal with a counterpart. It must stay
//     suspended until the counterpart arrives (online / the connection back). A beat must not
//     overrule it.
//   SLEPT — suspended by an INFERENCE from the gap since the last sign of life. Nothing will ever
//     arrive to say otherwise, so the next sign of life is the only thing that can undo it, and it must.
// Collapsing those two is what makes either a trap or a defeated rule.
//
// CHANGED AT J68, ON PURPOSE (the owner's decision 1, `ddjp_634`: no tab pauses because it is hidden). Hiding was the first
// of the signalled suspensions, and PART C held it sticky and PART D held its return untaxed. It is gone: what is "behind" is
// now whether the server kept answering, plus the tab's own clock for a real sleep. A beat a minute late is how Chrome wakes a
// hidden tab's timers, and is no longer a sleep (PART A); C holds the CONNECTION's wait sticky in its place, and D holds that
// coming back neither taxes nor hides.
//
// GUARANTEES:
//   PART A — A SLEEP SUSPENDS, A THROTTLED BEAT DOES NOT. A beat a minute late (Chrome's throttling) changes nothing; one after
//     two silent minutes suspends. Asserted as behaviour, not as source text.
//   PART B — A SLEEP'S SUSPENSION SELF-RECOVERS. Beats keep arriving a minute apart and the client still climbs back to LIVE;
//     a sign of life that is itself a sleep keeps it suspended, and the next answer releases it.
//   PART C — THE CONNECTION'S SUSPENSION IS STICKY. A beat does NOT promote a client whose connection dropped; only the
//     connection coming back does. The deliberate rule survives the fix.
//   PART D — COMING BACK IS NOT TAXED, AND DOES NOT HIDE A SLEEP. Back online after two minutes of throttled beats, the first
//     beat is not read as a sleep; but a sleep while offline still reads as one after the browser says "online".

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[session-resume] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function fresh() {
  const sb = loadInContext(["backends/backend1/session.js"], { Date: Date });
  const S = sb.Session;
  let now = 0;
  let onConn = null;
  S.attach({
    now: () => now,
    setInterval: () => 1, clearInterval: () => {},
    headCount: () => 0,
    settleMs: () => 500,
    onConnectivity: (fn) => { onConn = fn; },
  });
  S.start();
  S.enterRoom("!r:hs");
  S.replayFinished();
  return {
    S,
    at: (t) => { now = t; },
    now: () => now,
    // A beat `gapMs` after the last sign of life; an answer from the server, `gapMs` after whatever came before.
    beat: (gapMs) => { S._setLastLifeForTest(now); now += gapMs; S._beatForTest(); },
    answer: (gapMs) => { now += gapMs; S.serverAnswered(); },
    online: (v) => { if (onConn) onConn(v); },
  };
}

// ── PART A + B — a sleep suspends, a throttled beat does not, and the suspension self-recovers ──
(() => {
  const h = fresh();
  h.beat(1000);                          // an ordinary beat settles us
  ok(h.S.phase() === "live", "A: a client with a quiet log reaches LIVE", h.S.phase());

  h.beat(60000);                         // hidden and throttled: a beat 60s late
  ok(h.S.phase() === "live",
    "A: A BEAT A MINUTE LATE DOES NOT SUSPEND — it is how Chrome wakes a hidden tab's timers, and hiding is not being behind " +
    "(the owner's decision 1, `ddjp_634`)", h.S.phase());

  h.beat(120000);                        // two minutes with no sign of life: the machine slept
  ok(h.S.phase() === "suspended",
    "A: two silent minutes still suspend — the clock moved without us and we do not know what we missed", h.S.phase());

  // Still throttled. Under the old shape every one of these re-suspended and returned.
  const seen = [];
  for (let i = 0; i < 3; i++) { h.beat(60000); seen.push(h.S.phase()); }
  ok(seen.indexOf("live") >= 0 || seen.indexOf("catching-up") >= 0,
    "B: APPLIED — a client suspended by a SLEEP climbs back out even while beats keep arriving a minute apart. Nothing else "
    + "will ever tell it the coast is clear, so the next sign of life has to; the old order asked 'did time jump?' first and "
    + "re-suspended forever, and a client stuck there can never advance a song again", seen);
  ok(h.S.mayAuthor() === true || seen[seen.length - 1] === "catching-up",
    "B: and it ends able to author, or one settle away from it", h.S.phase());

  h.beat(120000); h.beat(120000);        // asleep, then asleep again
  ok(h.S.phase() === "suspended", "B: a sign of life that is itself a sleep keeps it suspended — a tab still asleep is still asleep", h.S.phase());
  h.answer(20000);                       // the server's answer 20 s on
  ok(h.S.phase() === "catching-up", "B: and the next answer releases it", h.S.phase());
})();

// ── PART C — the CONNECTION's suspension is sticky ────────────────────────────────────────────
(() => {
  const h = fresh();
  h.beat(1000);
  ok(h.S.phase() === "live", "C: live before the connection drops", h.S.phase());

  h.S.connectionLost();                   // the transport says the connection dropped
  ok(h.S.phase() === "suspended" && h.S.awaitingSignal() === "connection", "C: a lost connection suspends", h.S.phase());

  const seen = [];
  for (let i = 0; i < 4; i++) { h.beat(5000); seen.push(h.S.phase()); }
  ok(seen.every((p) => p === "suspended"),
    "C: APPLIED — beats do NOT promote a client whose connection dropped. This suspension has a counterpart signal coming "
    + "and must wait for it; letting the beat overrule it would delete the rule while fixing the sleep trap", seen);

  h.S.connectionBack();                   // the counterpart arrives
  ok(h.S.phase() === "catching-up",
    "C: the connection coming back is what releases it", h.S.phase());
})();

// ── PART D — coming back is not taxed, and does not hide a sleep ──────────────────────────────
(() => {
  const h = fresh();
  h.beat(1000);
  h.online(false);
  for (let i = 0; i < 2; i++) h.beat(60000); // two minutes offline, hidden: beats a minute apart
  h.online(true);
  ok(h.S.phase() === "catching-up", "D: back online -> catching up", h.S.phase());
  h.beat(5000);                           // the first ordinary beat after coming back
  ok(h.S.phase() !== "suspended",
    "D: APPLIED — the first beat after returning does not read the throttled period as a sleep and knock the client straight "
    + "back to suspended", h.S.phase());

  const h2 = fresh();
  h2.beat(1000);
  h2.online(false);
  h2.at(h2.now() + 10 * 60000);           // offline, and the machine sleeps: no beat, no answer, ten minutes
  h2.online(true);                        // on waking the browser says "online" first
  h2.answer(1000);
  ok(h2.S.phase() === "suspended",
    "D: AND COMING BACK DOES NOT HIDE A SLEEP — `online` no longer resets the clock, so the first sign of life after ten silent "
    + "minutes reads as the sleep it was (until J68 the return refreshed the clock and the sleep went unseen)", h2.S.phase());
})();

// ── PART E — GOING LIVE MUST WAKE THE THINGS THAT WERE REFUSED ────────────────────────────────
// The phase gate stops a client authoring while it is behind, which is right. Something then has to
// resume the work, or the gate does not DEFER it — it DROPS it. `MatrixBridge.onAuthorReady` is
// that something, and the queue subscribes to it, because the reconcile is otherwise woken only by
// INCOMING dj.* events: in a quiet room a song refused during catch-up would wait for somebody else
// to act.
//
// It was registered with the wrong shape. `Session.onChange` hands its listeners ONE object —
// `{ from, to, reason, phase }` — and the subscriber destructured it as two positional arguments,
// so `to` was permanently undefined and the callback never fired. A textual guard passed it,
// because the name was spelled in both files; only executing the emit shows it.
(() => {
  // THE REAL SUBSCRIBER, not a stand-in. The first version of this part registered its own
  // correctly-shaped listener on Session and asserted that the emit worked — which it always did.
  // That is the decorative assertion this project keeps finding: it exercised everything except
  // the line that was wrong. What has to be driven is `MatrixBridge.onAuthorReady` itself.
  const sb = loadInContext([
    "core/logger.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js", "backends/backend1/session.js",
    "backends/backend1/matrixbridge.js",
  ], {
    Date: Date, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined,
    matrixcs: {}, navigator: {},
  });
  const S = sb.Session, MB = sb.MatrixBridge;
  let now = 0;
  S.attach({ now: () => now, setInterval: () => 1, clearInterval: () => {},
             headCount: () => 0, settleMs: () => 500 });
  S.enterRoom("!r:hs");
  S.replayFinished();

  let woke = 0;
  MB.onAuthorReady(() => { woke++; });

  S._setLastLifeForTest(now); now += 1000; S._beatForTest();
  ok(S.phase() === "live", "E: the client reaches LIVE (the control)", S.phase());
  ok(woke === 1,
    "E: APPLIED — MatrixBridge.onAuthorReady really fires when the client becomes able to author. "
    + "It was registered as two positional arguments while Session hands its listeners ONE object "
    + "({ from, to, reason, phase }), so `to` was permanently undefined and the callback never ran. "
    + "A refusal during catch-up was then a DROP rather than a deferral, and in a quiet room the "
    + "song simply waited for somebody else to act. A textual guard passed this, because the name "
    + "was spelled in both files", { woke: woke });
})();

if (failures) process.exit(1);
console.log("[session-resume] PASS — the phase that stops a client authoring has a way out, and "
  + "the two reasons for entering it are kept apart: a beat a minute late suspends nothing, and a suspension INFERRED from "
  + "a sleep undoes itself on the next sign of life, because nothing else ever will and a client stuck there never "
  + "advances another song; a suspension SIGNALLED by a lost connection waits for its counterpart and no beat overrules it; "
  + "coming back is not taxed by the throttled period and does not hide a sleep; and a subscriber really is told when "
  + "authoring becomes possible, so a refusal while catching up defers the work instead of dropping it");
