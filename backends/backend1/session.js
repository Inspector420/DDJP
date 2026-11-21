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
// BEHIND IS NOT HIDDEN (J68; the owner's decision 1, `ddjp_634`). No tab pauses because it is hidden — every tab, not only
// the bot. "Am I behind?" is answered by whether the server kept answering, plus this tab's own clock for a real sleep (the
// laptop closed, the tab frozen): two signs of life, the heartbeat and the server's answer (`serverAnswered`), and the gap
// since the last of either. The gate stays as it was: only a LIVE tab authors (v391's ruling). Visibility no longer reaches
// this module at all.
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
  // The heartbeat interval, and the real-sleep test. A tab throttled in the background does NOT drift by a second or two:
  // since Chrome 88, a page hidden more than five minutes and silent has its chained timers (this interval is one) woken
  // once a minute, so its beat comes about 60 s late for as long as it stays hidden. A beat's lateness alone therefore
  // cannot say "behind" — the old test (4 beats, 20 s) read every hidden tab as asleep (J68).
  //
  // A SIGN OF LIFE is a beat or a server answer, and a tab has slept when the gap since the last one is over SLEEP_MS.
  // 90 s: above the long-poll's 30 s (the SDK's `pollTimeout`, not overridden here), so a hidden tab whose server answers
  // is never asleep; above the 60 s at which Chrome wakes a throttled timer, so a hidden tab whose connection is down — no
  // answer can come, and it already waits on the connection — does not read as asleep from its beats alone; far below any
  // real sleep or freeze, which last minutes.
  const BEAT_MS = 5000;
  const SLEEP_MS = 90000;

  // How long the log must stop growing before CATCHING-UP becomes LIVE. Derived from the room's
  // own turn-taking step where one is available, not pinned — the same reasoning the seal settle
  // uses, so it moves with the dial that governs every other wait.
  const DEFAULT_SETTLE_MS = 500;

  // ── PURE DECISION: did this tab sleep? ───────────────────────────────────────────────────
  // Split out for the reason every plan helper in this backend is split out: the callers are a
  // timer and a network answer, and neither can be exercised headlessly. Asserted directly instead
  // of inferred from a phase change.
  //
  // A MISSING previous sign of life is NOT a sleep — it is a first one. Answering "slept" there
  // would suspend every client at startup.
  function sleptDetected(lastLifeAt, now, sleepMs) {
    if (typeof lastLifeAt !== "number" || lastLifeAt <= 0) return false;
    const limit = (typeof sleepMs === "number" && sleepMs > 0) ? sleepMs : SLEEP_MS;
    return now - lastLifeAt > limit;
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
  let _lastLifeAt = 0;        // the last sign of life: a beat or a server answer
  let _beatHandle = null;
  let _settleFrom = 0;        // head count when we entered CATCHING-UP
  let _settleAt = 0;          // when we last saw the head change
  let _roomId = null;
  // WHY WE SUSPENDED, and whether anything is coming to release us. A suspension SIGNALLED by the
  // platform (offline, connection lost) is sticky: it has a counterpart and waits for it. One
  // INFERRED from a sleep is not: the next sign of life is the only thing that will ever undo it.
  // The two used to be one state, which made the beat both a trap for the first and an override
  // for the second. Reported, not just held, so a stuck client can say which kind it is.
  let _sticky = null;              // the signal we are waiting on, or null
  let _suspendedBecause = null;    // last reason we entered SUSPENDED (diagnostic)
  const _listeners = [];
  const _sleptListeners = [];      // told of every sleep detected, whether or not the phase changes (`onSlept`)

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
    // COLD STAYS COLD UNTIL A ROOM IS ENTERED (J83, the owner's ruling 18). No room runs, so nothing is "behind": only
    // `enterRoom` (-> REPLAYING) leaves it. Before this a hidden tab, a lost connection or a late beat took a tab in the
    // lobby to SUSPENDED, and the next show, reconnect or beat walked it on to CATCHING-UP and LIVE with no room at all.
    if (_phase === COLD && next !== REPLAYING) return false;
    const from = _phase;
    _phase = next;
    if (next === CATCHING_UP) {
      _settleFrom = _safeHead();
      _settleAt = _env.now();
    }
    _emit(from, next, reason || "");
    _say(from, next, reason || "");
    return true;
  }

  // ── EVERY CHANGE IS ONE INFO LINE, WITH ITS REASON (ddjp_621) ───────────────────────────────
  // The owner's bot tab was not live on and off for about 25 minutes; every sweep said "refused — not-live" and the
  // log never said why. Said HERE, in the one mutator, so it is once per change by construction: a sign of life while
  // live, a repeated signal and a sleep while already suspended change nothing and so say nothing.
  // Becoming live again says how long the tab was not live. `check-session-log`.
  const _WORD = { cold: "cold", replaying: "replaying", "catching-up": "catching up", live: "live", suspended: "suspended" };
  let _notLiveSince = 0;     // when this tab last stopped being live in this room; 0 until it has been live once
  let _lateGapMs = 0;        // the gap since the sign of life before this one, for the line that names it
  let _lifeFrom = "beat";    // what the latest sign of life was: a beat, or an answer
  function _span(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60), r = s % 60;
    return m + " min" + (r ? " " + r + " s" : "");
  }
  function _secs(ms) { return Math.max(0, Math.round(ms / 1000)) + " s"; }
  function _why(reason, next) {
    switch (reason) {
      case "room-enter":      return "entered the room";
      case "replay-finished": return "the replay finished; waiting for the room's events to stop arriving";
      case "settled":         return "caught up: no new events for " + _env.settleMs() + " ms";
      case "offline":         return "the browser went offline";
      case "online":          return "the browser is back online";
      case "connection-lost": return "the connection to the homeserver dropped";
      case "connection-back": return "the connection to the homeserver is back";
      // In SECONDS, whatever the size, so a run of these lines reads as one column of numbers.
      case "slept":           return "nothing from its heartbeat or the server for " + _secs(_lateGapMs) + " (the heartbeat runs every " +
                                     _secs(BEAT_MS) + ", the server answers at least every 30 s) — the machine slept or the page was frozen";
      // A sleep's suspension is released by the next sign of life that is not itself a sleep (nothing else will ever release it).
      case "resumed":         return (_lifeFrom === "answer" ? "the server answered again, " : "the heartbeat ran again, ") +
                                     _secs(_lateGapMs) + " after the last sign of life";
      case "room-leave":      return "left the room";
      default:                return reason || "no reason given";
    }
  }
  function _say(from, next, reason) {
    const now = _env.now();
    let tail = "";
    if (next === LIVE && _notLiveSince) tail = "; not live for " + _span(now - _notLiveSince);
    if (from === LIVE) _notLiveSince = now;
    if (next === COLD || next === REPLAYING) _notLiveSince = 0;
    try {
      if (typeof Logger !== "undefined" && Logger.info) {
        Logger.info("Session: " + (_WORD[next] || next) + " (was " + (_WORD[from] || from) + ") — " + _why(reason, next) + tail);
      }
    } catch (e) {}
  }

  function _safeHead() {
    try { const n = _env.headCount(); return (typeof n === "number") ? n : 0; }
    catch (e) { return 0; }
  }

  // ── A SIGN OF LIFE — the heartbeat, or a server answer (J68) ──────────────────────────────
  // Each measures the REAL gap since the last of either. A gap over SLEEP_MS means the clock advanced without us: the
  // machine slept or the page was frozen. The heartbeat needs no browser support at all, which is why it is the mechanism
  // rather than the fallback; the answer is the other half, because a hidden tab's heartbeat is slowed to once a minute
  // and its network is not.
  //
  // Each also drives the CATCHING-UP -> LIVE settle, so a slowed tab settles on the server's answer rather than waiting a
  // minute for its beat — and the next late beat no longer suspends it again, which was the "never settles live" of v391.
  function _life(from) {
    const now = _env.now();
    const slept = sleptDetected(_lastLifeAt, now, SLEEP_MS);
    _lateGapMs = now - _lastLifeAt;
    _lastLifeAt = now;
    _lifeFrom = from;
    // A SLEEP IS TOLD whatever the phase: a tab already waiting on its connection slept all the same (the machine woke
    // and the failed request reported first), and the bot's alarm wants to know (the owner's decision 3).
    if (slept) {
      for (const fn of _sleptListeners.slice()) { try { fn({ gapMs: _lateGapMs, from: from }); } catch (e) {} }
    }
    if (_phase === SUSPENDED) {
      // ── TWO REASONS TO BE HERE, AND ONLY ONE OF THEM IS A SIGN OF LIFE'S TO UNDO ───────────
      // SIGNALLED (offline / connection lost): a counterpart is coming — online, the connection back. A beat must wait for
      //   it. An ANSWER ends it: the server answered, whatever the signal says (a browser that never says "online" again
      //   must not trap a tab whose server is talking to it).
      // INFERRED (slept): nothing will ever arrive to say otherwise, so the next sign of life that is not itself a sleep
      //   releases it — a tab that is still asleep is still asleep.
      if (_sticky && from === "answer") _sticky = null;
      if (_sticky || slept) return;
      // Enter CATCHING-UP and let the settle decide, rather than guessing at a fixed delay.
      _to(CATCHING_UP, "resumed");
      return;
    }
    if (slept) {
      // We do not know what we missed. Not LIVE, and deliberately not straight back to LIVE when
      // the backlog arrives either — SUSPENDED drains into CATCHING-UP, which has to settle.
      _suspendedBecause = "slept";
      _to(SUSPENDED, "slept");
      return;
    }
    if (_phase === CATCHING_UP) {
      const head = _safeHead();
      if (head !== _settleFrom) { _settleFrom = head; _settleAt = now; return; }   // still growing
      if (settled(_settleFrom, head, now - _settleAt, _env.settleMs())) _to(LIVE, "settled");
    }
  }
  function _beat() { _life("beat"); }
  // EVERY SERVER ANSWER, empty or not — the bridge calls this on each SDK `sync` SYNCING or PREPARED.
  function serverAnswered() { _life("answer"); }
  // ── AN ARRIVING EVENT IS TESTED FOR A SLEEP BEFORE ANYTHING HANDLES IT (`ddjp_645`, the supervisor's review of `ddjp_644`) ──
  // The SDK hands an answer's events out BEFORE it says the server answered (41.8.0: `processSyncResponse` emits every
  // `Room.timeline`, then `updateSyncState(SYNCING)`), so after a sleep the first answer's events reached the bot's sweep and
  // runner while this still said LIVE, and they acted on a stale view. The bridge calls this first for every arriving event,
  // before routing it (`matrixbridge.js` `_routeEvent`). A gap over SLEEP_MS is the same sleep `_life` tells — told once,
  // suspended here, before any listener runs — and the answer that follows is then the sign of life that releases it, as the
  // next one after a sleep always was. With no such gap it does nothing: an ordinary arrival changes nothing. No timer.
  function arrived() {
    if (!sleptDetected(_lastLifeAt, _env.now(), SLEEP_MS)) return;
    _life("arrival");
  }

  function start() {
    if (_beatHandle !== null) return;                       // idempotent, like every wire in this tree
    _lastLifeAt = _env.now();
    _beatHandle = _env.setInterval(_beat, BEAT_MS);
    // ── THE SIGNALLED SUSPENSION ─────────────────────────────────────────────────────────────
    // It sets the sticky flag on the way down and clears it on the way up, so a beat knows it is
    // not its to release. Coming back does NOT refresh the clock: a sign of life measures the gap,
    // and a machine that slept while offline must still read as having slept.
    // (Hidden and shown were signals here until J68 — the owner's decision 1, `ddjp_634`.)
    if (typeof _env.onConnectivity === "function") {
      try {
        _env.onConnectivity((online) => {
          if (!online) { _sticky = "offline"; _suspendedBecause = "offline"; _to(SUSPENDED, "offline"); return; }
          _sticky = null;
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
    _lastLifeAt = _env.now();
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
  // Signalled, exactly like offline: the transport will tell us when it is back, so the beat must
  // not second-guess it in the meantime.
  //
  // `connectionBack` IS THE SDK'S RETURN AND NOTHING ELSE (J68). The bridge calls it only when a
  // sync answer follows ERROR, RECONNECTING or CATCHUP. Until J68 it ran on EVERY answer, so it
  // ended every wait (the hidden one included) and reset the beat's clock — a server answer
  // half-worked as a sign of life by accident, and hid a sleep whose first sign was an answer. It
  // ends the wait and touches no clock; `serverAnswered` is the sign of life.
  function connectionLost() {
    _sticky = "connection"; _suspendedBecause = "connection-lost";
    return _to(SUSPENDED, "connection-lost");
  }
  function connectionBack() {
    _sticky = null;
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
  // whether the browser went offline, the connection dropped, or the machine slept — three
  // situations needing three different answers.
  function suspendedBecause() { return (_phase === SUSPENDED) ? _suspendedBecause : null; }
  function awaitingSignal() { return _sticky; }
  function roomId() { return _roomId; }
  function mayAuthor() { return phaseMayAuthor(_phase); }
  function onChange(fn) { if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }
  function offChange(fn) { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }
  // Every sleep detected, with `{ gapMs, from }` — whether or not it changed the phase (J68; the bot's alarm hears it).
  function onSlept(fn) { if (typeof fn === "function" && _sleptListeners.indexOf(fn) < 0) _sleptListeners.push(fn); }

  // Guard seams. The phase is normally reached through a real lifecycle; what is under test is
  // what the RULES do once a phase exists.
  function _setPhaseForTest(p) { if (PHASES.indexOf(p) >= 0) { const f = _phase; _phase = p; _emit(f, p, "test"); } }
  function _beatForTest() { _beat(); }
  function _setLastLifeForTest(t) { _lastLifeAt = t; }

  return {
    COLD, REPLAYING, CATCHING_UP, LIVE, SUSPENDED, PHASES: PHASES.slice(),
    BEAT_MS, SLEEP_MS,
    attach, start, stop,
    enterRoom, replayFinished, connectionLost, connectionBack, serverAnswered, arrived, sawEvent, leaveRoom,
    phase, roomId, mayAuthor, onChange, offChange, onSlept, suspendedBecause, awaitingSignal,
    // pure, exported so the guards assert the decisions directly rather than through a timer
    sleptDetected, settled, phaseMayAuthor,
    _setPhaseForTest, _beatForTest, _setLastLifeForTest,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Session };
