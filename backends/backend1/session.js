// backends/backend1/session.js
//
// SESSION — THE ONE QUESTION: what phase am I in, and am I entitled to act?
//
// This module exists because of a gap the old code had everywhere except one place. Every
// staggered action already re-checked, at fire time, whether its JOB was still needed — has the
// song moved on, does the room already agree, is the event covered. That discipline is solid.
// What none of them asked is the DIFFERENT question: "am I even caught up?"
//
// Exactly one piece of the old system knew it might be behind: sealing re-read the head after
// waiting its slot. That fix was correct and was applied to one caller. This module generalises
// it, because the underlying mistake — a client acting as though it knows the present when it
// does not — was never specific to sealing:
//
//   · a client four events into replaying yesterday sealed a faithful snapshot of a moment that
//     had already ended, published it, and then adopted its own answer
//   · a laptop that slept for two hours woke with ~20 pending timers scheduled against a world
//     that no longer existed
//   · a client that reconnected mid-backlog is LIVE the whole time and just as wrong
//
// THE SINGLE RULE THIS BUYS: only a LIVE client authors anything. One condition, asked at every
// fire point, retires the stale-timer advance, the mid-replay seal and the catch-up seal as a
// CATEGORY rather than one at a time.
//
// WHY THERE WAS NO WAKE DETECTION AT ALL. Verified against the old tree: no visibilitychange
// listener, no online/offline listener, and the only sync-state listener was a one-shot at
// startup that removed itself once the first sync completed. There was no code path by which a
// client could learn it had been away. The heartbeat below is the primary detector precisely
// because it needs no browser API to work — the browser signals are corroboration, not the
// mechanism.
//
// LAYER NOTE: backends/backend1. Depends on nothing at load time. Every browser API is
// INJECTED (see attach), so the whole module runs headless — the decisions below are pure and
// guarded directly, which is the same split the rest of this backend uses for its plan helpers.

const Session = (() => {

  // ── THE PHASES ───────────────────────────────────────────────────────────────────────────
  // Ordered from "knows nothing" to "knows the present". Only LIVE may author.
  const COLD        = "cold";          // nothing loaded
  const REPLAYING   = "replaying";     // folding history; the past is not the present
  const CATCHING_UP = "catching-up";   // live connection, but a burst is still arriving
  const LIVE        = "live";          // caught up — the only phase that may author
  const SUSPENDED   = "suspended";     // we were away; we do not yet know what we missed

  const PHASES = [COLD, REPLAYING, CATCHING_UP, LIVE, SUSPENDED];

  // ── DIALS ────────────────────────────────────────────────────────────────────────────────
  // The heartbeat interval, and how much overshoot counts as "time jumped". A tab that is merely
  // throttled in the background drifts by a second or two; a sleep overshoots by minutes or
  // hours. The threshold sits far above normal throttling and far below any real sleep, so it
  // cannot false-positive on a busy main thread.
  const BEAT_MS = 5000;
  const JUMP_FACTOR = 4;               // a beat 4x late means the clock moved without us

  // How long the log must stop growing before CATCHING-UP becomes LIVE. Derived from the room's
  // own turn-taking step where one is available, not pinned — the same reasoning the seal settle
  // uses, so it moves with the dial that governs every other wait.
  const DEFAULT_SETTLE_MS = 500;

  // ── PURE DECISION: did the wall clock jump? ──────────────────────────────────────────────
  // Split out for the reason every plan helper in this backend is split out: the only production
  // caller is a timer, and a timer cannot be exercised headlessly. Asserted directly instead of
  // inferred from a phase change.
  //
  // A MISSING previous beat is NOT a jump — it is a first beat. Answering "jumped" there would
  // suspend every client at startup.
  function jumpDetected(lastBeatAt, now, beatMs) {
    if (typeof lastBeatAt !== "number" || lastBeatAt <= 0) return false;
    const expected = (typeof beatMs === "number" && beatMs > 0) ? beatMs : BEAT_MS;
    const elapsed = now - lastBeatAt;
    return elapsed > expected * JUMP_FACTOR;
  }

  // ── PURE DECISION: has the burst settled? ────────────────────────────────────────────────
  // The same test sealing already used and the only one that works: wait a settle, then look
  // again. If the log grew while we waited, the room moved under us and we are still behind.
  // During a catch-up it grows continuously, so this stays false for as long as the burst lasts
  // and turns true once the stream settles.
  //
  // Note it takes the head COUNT rather than a timestamp. A backlog arriving over a slow link
  // takes real time to deliver, so "no new events for N ms" is the honest test and "N ms have
  // passed" is not.
  function settled(headBefore, headNow, waitedMs, settleMs) {
    if (headNow !== headBefore) return false;
    const need = (typeof settleMs === "number" && settleMs >= 0) ? settleMs : DEFAULT_SETTLE_MS;
    return waitedMs >= need;
  }

  // ── PURE DECISION: may a client in this phase author? ────────────────────────────────────
  // One line, exported, so the rule has exactly one home and a guard can assert it directly
  // rather than through a caller. Everything that sends anything asks this.
  function phaseMayAuthor(phase) { return phase === LIVE; }

  // ── STATE ────────────────────────────────────────────────────────────────────────────────
  let _phase = COLD;
  let _lastBeatAt = 0;
  let _beatHandle = null;
  let _settleFrom = 0;        // head count when we entered CATCHING-UP
  let _settleAt = 0;          // when we last saw the head change
  let _roomId = null;
  // WHY WE SUSPENDED, and whether anything is coming to release us. A suspension SIGNALLED by the
  // platform (hidden, offline, connection lost) is sticky: it has a counterpart and waits for it.
  // One INFERRED from a late beat is not: the beat is the only thing that will ever undo it. The
  // two used to be one state, which made the beat both a trap for the first and an override for
  // the second. Reported, not just held, so a stuck client can say which kind it is.
  let _sticky = null;              // the signal we are waiting on, or null
  let _suspendedBecause = null;    // last reason we entered SUSPENDED (diagnostic)
  const _listeners = [];

  // INJECTED ENVIRONMENT. Nothing here reaches for a browser global directly, so the module runs
  // under a headless guard unchanged. The old tree could not test its wake behaviour at all
  // because there was no wake behaviour to test; this shape means the replacement is testable
  // from the first line.
  let _env = {
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
    headCount: () => 0,       // how many events we hold — supplied by the stream
    // DERIVED BY THE CALLER, not pinned here. Every other wait in this system comes from the room's
    // own turn-taking step (half of vouchJitter) rather than a constant, so that changing the dial
    // moves them together. This module has no settings access by design, so the caller supplies it:
    //     settleMs: () => Math.floor(Dials.live(settings, "vouchJitter") / 2)
    // The constant below is the fallback for a client that has not read settings yet, and it
    // matches the shipped default so the two agree until they are told otherwise.
    settleMs: () => DEFAULT_SETTLE_MS,
    onVisibility: null,       // optional: (fn) => void
    onConnectivity: null,     // optional: (fn(online)) => void
  };

  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  function _emit(from, to, reason) {
    for (const fn of _listeners) {
      try { fn({ from: from, to: to, reason: reason, phase: to }); } catch (e) {}
    }
  }

  // THE ONE MUTATOR. Every phase change goes through here so the transition is observable in one
  // place — a phase that changed without an event is a phase nobody could react to, which is the
  // shape of the flag that was raised and never read.
  function _to(next, reason) {
    if (next === _phase) return false;
    const from = _phase;
    _phase = next;
    if (next === CATCHING_UP) {
      _settleFrom = _safeHead();
      _settleAt = _env.now();
    }
    _emit(from, next, reason || "");
    return true;
  }

  function _safeHead() {
    try { const n = _env.headCount(); return (typeof n === "number") ? n : 0; }
    catch (e) { return 0; }
  }

  // ── THE HEARTBEAT — the primary wake detector ────────────────────────────────────────────
  // Fires on a fixed interval and measures the REAL gap. A gap far larger than the interval
  // means the clock advanced without us: we slept, were frozen, or were throttled hard. It works
  // with no browser support at all, which is why it is the mechanism rather than the fallback.
  //
  // It also drives the CATCHING-UP -> LIVE settle, so there is one clock in this module rather
  // than two that can disagree.
  function _beat() {
    const now = _env.now();
    const jumped = jumpDetected(_lastBeatAt, now, BEAT_MS);
    _lastBeatAt = now;

    // ── A LATE BEAT WHILE ALREADY SUSPENDED IS NOT NEWS ──────────────────────────────────────
    // This asked "did the clock jump?" and returned before it could ever ask "is it time to come
    // back?". A browser clamps timers in a background tab to roughly one per minute, so every beat
    // was ~60s late, so every beat read as a fresh jump, so every beat re-suspended — and the
    // resume branch below was unreachable. Measured: six consecutive throttled beats, still
    // suspended, mayAuthor false throughout. A client stuck there advances no song, seals nothing
    // and vouches for nothing — every one of those asks this question first.
    //
    // PRECISELY: the BEAT could never release it. A platform signal still could, so a tab that
    // was merely hidden recovered on being shown. The trap closed on a tab whose timers were
    // throttled WITHOUT being hidden — an occluded or minimised window, or a machine returning
    // from sleep — where no signal is coming and the beat was the only way out.
    //
    // Being away is exactly what a late beat LOOKS like, so seeing one while already suspended
    // confirms the state we are in rather than establishing a new one. Fall through.
    if (jumped && _phase !== SUSPENDED) {
      // We do not know what we missed. Not LIVE, and deliberately not straight back to LIVE when
      // the backlog arrives either — SUSPENDED drains into CATCHING-UP, which has to settle.
      _suspendedBecause = "clock-jump";
      _to(SUSPENDED, "clock-jump");
      return;
    }

    if (_phase === SUSPENDED) {
      // ── TWO REASONS TO BE HERE, AND ONLY ONE OF THEM IS THE BEAT'S TO UNDO ─────────────────
      // SIGNALLED (hidden / offline / connection lost): a counterpart signal is coming — shown,
      //   online, connection back. It must wait for it. Letting the beat overrule this would
      //   delete the visibility rule while fixing the trap above, which is how one fix becomes
      //   two bugs. (Worth recording: before this split the beat DID overrule it — a hidden tab
      //   was promoted back to LIVE on the very next beat, so the deliberate rule was already
      //   being ignored whenever timers were not throttled.)
      // INFERRED (clock-jump): nothing will ever arrive to say otherwise. The beat is the only
      //   thing that can release it, so it must.
      if (_sticky) return;
      // The connection is presumed back the moment events resume. Enter CATCHING-UP and let the
      // settle decide, rather than guessing at a fixed delay.
      _to(CATCHING_UP, "resumed");
      return;
    }

    if (_phase === CATCHING_UP) {
      const head = _safeHead();
      if (head !== _settleFrom) { _settleFrom = head; _settleAt = now; return; }   // still growing
      if (settled(_settleFrom, head, now - _settleAt, _env.settleMs())) _to(LIVE, "settled");
    }
  }

  function start() {
    if (_beatHandle !== null) return;                       // idempotent, like every wire in this tree
    _lastBeatAt = _env.now();
    _beatHandle = _env.setInterval(_beat, BEAT_MS);
    // ── THE SIGNALLED SUSPENSIONS ────────────────────────────────────────────────────────────
    // Each sets the sticky flag on the way down and clears it on the way up, so the beat knows
    // whether this one is its to release.
    //
    // RETURNING ALSO REFRESHES THE BEAT CLOCK, and that is not cosmetic. A tab in the background
    // has its timers clamped, so by the time it is shown again `_lastBeatAt` is minutes stale —
    // and the first ordinary beat after coming back would read that gap as a fresh jump and knock
    // the client straight back to SUSPENDED. Two more beats to climb out: ten to fifteen seconds
    // during which the person now looking at the room cannot author. We have just observed the
    // clock, so recording that is honest rather than a workaround.
    if (typeof _env.onVisibility === "function") {
      try {
        _env.onVisibility((visible) => {
          if (!visible) { _sticky = "hidden"; _suspendedBecause = "hidden"; _to(SUSPENDED, "hidden"); return; }
          _sticky = null; _lastBeatAt = _env.now();
          if (_phase === SUSPENDED) _to(CATCHING_UP, "shown");
        });
      } catch (e) {}
    }
    if (typeof _env.onConnectivity === "function") {
      try {
        _env.onConnectivity((online) => {
          if (!online) { _sticky = "offline"; _suspendedBecause = "offline"; _to(SUSPENDED, "offline"); return; }
          _sticky = null; _lastBeatAt = _env.now();
          if (_phase === SUSPENDED) _to(CATCHING_UP, "online");
        });
      } catch (e) {}
    }
  }

  function stop() {
    if (_beatHandle !== null) { try { _env.clearInterval(_beatHandle); } catch (e) {} _beatHandle = null; }
  }

  // ── THE LIFECYCLE CALLS ──────────────────────────────────────────────────────────────────
  // Room entry drives these. They are deliberately verbs rather than setters: a caller states
  // what HAPPENED and this module decides what phase that implies, so the phase rules stay here.

  // A room change wipes everything. In the old tree this was scattered across six modules and
  // forgetting one was its own bug class — a floor from the previous room binding the next one,
  // a hole clock deferring seals in a room where nothing was deleted.
  function enterRoom(roomId) {
    _roomId = roomId || null;
    _settleFrom = 0; _settleAt = 0;
    // A wait belonging to the room we just left must not hold this one down.
    _sticky = null; _suspendedBecause = null;
    _lastBeatAt = _env.now();
    _to(REPLAYING, "room-enter");
  }

  // Called by the room's start phase, which runs only AFTER replay has finished. Not LIVE
  // directly: replay is one route to being behind, and a client that replayed a long history may
  // already have a backlog queued behind it. Let the settle decide.
  function replayFinished() {
    if (_phase === COLD) return false;
    return _to(CATCHING_UP, "replay-finished");
  }

  // The transport reports the connection dropped or resumed.
  // Signalled, exactly like hidden/offline: the transport will tell us when it is back, so the
  // beat must not second-guess it in the meantime.
  function connectionLost() {
    _sticky = "connection"; _suspendedBecause = "connection-lost";
    return _to(SUSPENDED, "connection-lost");
  }
  function connectionBack() {
    _sticky = null; _lastBeatAt = _env.now();
    return (_phase === SUSPENDED) ? _to(CATCHING_UP, "connection-back") : false;
  }

  // An event arrived. Cheap, called on every ingest: it only matters while catching up, where it
  // keeps the settle window open for as long as the burst continues.
  function sawEvent() {
    if (_phase !== CATCHING_UP) return;
    _settleFrom = _safeHead();
    _settleAt = _env.now();
  }

  function leaveRoom() { _roomId = null; _sticky = null; _suspendedBecause = null; _to(COLD, "room-leave"); }

  // ── THE QUESTIONS EVERYTHING ELSE ASKS ───────────────────────────────────────────────────
  function phase() { return _phase; }
  // WHY THIS CLIENT SUSPENDED — and only that. A client can also be unable to author because it
  // is REPLAYING or CATCHING-UP, and those are answered by phase(), not here; this returns null
  // unless the phase is SUSPENDED. Worth having because "suspended" alone cannot tell an operator
  // whether the tab is in the background, the connection dropped, or a late timer made the client
  // infer it had been away — three situations needing three different answers.
  function suspendedBecause() { return (_phase === SUSPENDED) ? _suspendedBecause : null; }
  function awaitingSignal() { return _sticky; }
  function roomId() { return _roomId; }
  function mayAuthor() { return phaseMayAuthor(_phase); }
  function onChange(fn) { if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }
  function offChange(fn) { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }

  // Guard seams. The phase is normally reached through a real lifecycle; what is under test is
  // what the RULES do once a phase exists.
  function _setPhaseForTest(p) { if (PHASES.indexOf(p) >= 0) { const f = _phase; _phase = p; _emit(f, p, "test"); } }
  function _beatForTest() { _beat(); }
  function _setLastBeatForTest(t) { _lastBeatAt = t; }

  return {
    COLD, REPLAYING, CATCHING_UP, LIVE, SUSPENDED, PHASES: PHASES.slice(),
    BEAT_MS, JUMP_FACTOR,
    attach, start, stop,
    enterRoom, replayFinished, connectionLost, connectionBack, sawEvent, leaveRoom,
    phase, roomId, mayAuthor, onChange, offChange, suspendedBecause, awaitingSignal,
    // pure, exported so the guards assert the decisions directly rather than through a timer
    jumpDetected, settled, phaseMayAuthor,
    _setPhaseForTest, _beatForTest, _setLastBeatForTest,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Session };
