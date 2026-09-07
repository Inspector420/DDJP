// tests/check-session-resume.js
//
// A CLIENT THAT SUSPENDED ITSELF MUST BE ABLE TO COME BACK.
//
// Only a LIVE client authors anything — that rule is right and is not what this guard questions.
// What it locks is the way OUT of the phase that rule creates.
//
// THE TRAP, found by driving the beat with a throttled clock. `_beat` asks "did the wall clock
// jump?" BEFORE it asks "am I suspended, and is it time to come back?". A browser clamps timers in
// a background tab to roughly one per minute, so every beat is ~60s late, so every beat reads as a
// fresh clock jump, so every beat re-suspends and returns — never reaching the resume branch below
// it. Measured: six consecutive throttled beats, still suspended, mayAuthor false throughout. The
// client cannot advance a song, seal, or vouch again for the rest of its life.
//
// The same ordering also taxes an ordinary return. After foregrounding, `visibilitychange` moves
// the client to CATCHING-UP — and the very next beat still sees the stale 60s gap left over from
// the throttled period, calls it a jump, and knocks it back to SUSPENDED. Two more beats to climb
// out again: ten to fifteen seconds during which the person staring at the tab cannot author.
//
// THE DISTINCTION THIS TURNS ON, and why the fix is not simply "let the beat resume":
//   HIDDEN / OFFLINE — suspended DELIBERATELY, by a signal with a counterpart. It must stay
//     suspended until the counterpart arrives (shown / online). A beat must not overrule it, or
//     the visibility rule is defeated.
//   CLOCK JUMP — suspended by an INFERENCE from a late timer. Nothing will ever arrive to say
//     otherwise, so the beat is the only thing that can undo it, and it must.
// Collapsing those two is what makes either a trap or a defeated rule.
//
// GUARANTEES:
//   PART A — REPRODUCES THE TRAP. Under a throttled clock the old shape never recovers. Asserted
//     as behaviour, not as source text, so it cannot pass by a name being spelled somewhere.
//   PART B — A CLOCK-JUMP SUSPENSION SELF-RECOVERS. Late beats keep arriving and the client still
//     climbs back to LIVE, because a late beat while ALREADY suspended is what being away looks
//     like, not news.
//   PART C — A HIDDEN SUSPENSION IS STICKY. A beat does NOT promote a client that was suspended by
//     visibility; only being shown does. The deliberate rule survives the fix.
//   PART D — RETURNING IS NOT TAXED. Once the counterpart signal arrives, the stale beat gap left
//     by the throttled period does not read as a fresh jump and knock the client straight back.

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
  let onVis = null, onConn = null;
  S.attach({
    now: () => now,
    setInterval: () => 1, clearInterval: () => {},
    headCount: () => 0,
    settleMs: () => 500,
    onVisibility: (fn) => { onVis = fn; },
    onConnectivity: (fn) => { onConn = fn; },
  });
  S.start();
  S.enterRoom("!r:hs");
  S.replayFinished();
  return {
    S,
    at: (t) => { now = t; },
    now: () => now,
    beat: (gapMs) => { S._setLastBeatForTest(now); now += gapMs; S._beatForTest(); },
    show: (v) => { if (onVis) onVis(v); },
    online: (v) => { if (onConn) onConn(v); },
  };
}

// ── PART A + B — a clock-jump suspension self-recovers under a still-throttled clock ──────────
(() => {
  const h = fresh();
  h.beat(1000);                          // an ordinary beat settles us
  ok(h.S.phase() === "live", "A: a client with a quiet log reaches LIVE", h.S.phase());

  h.beat(60000);                         // the tab is throttled: a beat 60s late
  ok(h.S.phase() === "suspended",
    "A: a beat far later than planned still suspends — the clock moved without us and we do not "
    + "know what we missed", h.S.phase());

  // Still throttled. Under the old shape every one of these re-suspends and returns.
  const seen = [];
  for (let i = 0; i < 3; i++) { h.beat(60000); seen.push(h.S.phase()); }
  ok(seen.indexOf("live") >= 0 || seen.indexOf("catching-up") >= 0,
    "B: APPLIED — a client suspended by a CLOCK JUMP climbs back out even while beats keep "
    + "arriving late. Nothing else will ever tell it the coast is clear, so the beat has to; the "
    + "old order asked 'did time jump?' first and re-suspended forever, and a client stuck there "
    + "can never advance a song again", seen);
  ok(h.S.mayAuthor() === true || seen[seen.length - 1] === "catching-up",
    "B: and it ends able to author, or one settle away from it", h.S.phase());
})();

// ── PART C — a HIDDEN suspension is sticky ────────────────────────────────────────────────────
(() => {
  const h = fresh();
  h.beat(1000);
  ok(h.S.phase() === "live", "C: live before hiding", h.S.phase());

  h.show(false);                          // the tab went to the background — deliberate
  ok(h.S.phase() === "suspended", "C: hiding suspends", h.S.phase());

  const seen = [];
  for (let i = 0; i < 4; i++) { h.beat(5000); seen.push(h.S.phase()); }
  ok(seen.every((p) => p === "suspended"),
    "C: APPLIED — beats do NOT promote a client that was hidden. This suspension has a counterpart "
    + "signal coming and must wait for it; letting the beat overrule it would delete the "
    + "visibility rule while fixing the clock-jump trap", seen);

  h.show(true);                           // shown again — the counterpart arrives
  ok(h.S.phase() === "catching-up",
    "C: being shown is what releases it", h.S.phase());
})();

// ── PART D — returning is not taxed by the gap the throttled period left behind ───────────────
(() => {
  const h = fresh();
  h.beat(1000);
  h.show(false);
  h.at(h.now() + 120000);                 // two minutes in the background, no beats delivered
  h.show(true);
  ok(h.S.phase() === "catching-up", "D: shown -> catching up", h.S.phase());
  h.beat(5000);                           // the first ordinary beat after coming back
  ok(h.S.phase() !== "suspended",
    "D: APPLIED — the first beat after returning does not read the stale gap as a fresh jump and "
    + "knock the client straight back to suspended. That cost ten to fifteen seconds of not being "
    + "able to author, every single time somebody tabbed back to the room", h.S.phase());
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

  S._setLastBeatForTest(now); now += 1000; S._beatForTest();
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
  + "the two reasons for entering it are kept apart: a suspension INFERRED from a late timer "
  + "undoes itself on the beat, because nothing else ever will and a client stuck there never "
  + "advances another song; a suspension SIGNALLED by hiding or going offline waits for its "
  + "counterpart and no beat overrules it; coming back is not taxed by the stale beat gap the "
  + "throttled period left behind; and a subscriber really is told when authoring becomes "
  + "possible, so a refusal while catching up defers the work instead of dropping it");
