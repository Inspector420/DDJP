// backends/backend1/scheduler.js
//
// SCHEDULER — ONE PLACE THAT TAKES A TURN. Replaces ~20 hand-rolled setTimeout sites.
//
// The old tree shared the DELAY correctly — every site called the one stagger primitive, after a
// consolidation that replaced seven ladders with one. What it never shared was everything around
// the delay, and that is where the bugs were:
//
//   · "look again before you act" was hand-written FIVE times (vouching, sealing, playback
//     advance, length declaration, availability escape), slightly differently each time, and was
//     missing entirely from sealing until late
//   · six debounce windows with six different values that had never been compared to each other
//   · the vouch pass re-read the event list at fire time but CAPTURED its rank and the room
//     settings at schedule time, so sleeping through a rank change published under the wrong rank
//   · nothing anywhere noticed that a timer had fired hours late against a world that had moved
//
// FOUR RULES, and they are the whole design:
//
//   1. NOTHING IS CAPTURED. A plan is a DESCRIPTION evaluated at fire time. Rank, settings and
//      state are read through getters when the job runs, never closed over when it is planned.
//      This kills the stale-value class outright instead of one call site at a time.
//   2. `stillNeeded` IS MANDATORY. A plan without one is refused. The stagger creates the
//      observation window; the re-check is the only thing that USES it, so it cannot be optional.
//   3. A JOB THAT FIRES FAR LATE IS RE-PLANNED, NOT RUN. This is the sleep fix, in one place.
//   4. A ROOM CHANGE CANCELS EVERYTHING. One owner, so no module can forget.
//
// AND IT ASKS SESSION FIRST. Only a LIVE client authors. That single condition retires the
// stale-timer advance, the mid-replay seal and the catch-up seal as a category.
//
// WHAT THIS MODULE DOES NOT OWN: whether it is your turn for a PARTICULAR item. Vouching counts
// critical events since the event; the seal cadence counts events since your own last seal.
// Those are different questions with concept-specific answers, so the concept owns the policy and
// this module owns the mechanism — `turnsPassed` below is the shared counter each of them reads.
// That is the split: a concept may own its policy, never its own copy of how to take a turn.
//
// LAYER NOTE: backends/backend1. Reads Ranks for the slot and Session for the gate, both at fire
// time and both guarded by typeof so a partial load degrades rather than throws.

const Scheduler = (() => {

  // ── STALENESS ────────────────────────────────────────────────────────────────────────────
  // How much overshoot is normal, versus "the clock moved without us". A busy main thread or a
  // throttled background tab delivers a timer late by a fraction of its own delay plus a little.
  // A sleep overshoots by minutes. The rule below scales with the planned delay so a long ladder
  // wait is not judged by the same absolute margin as a short debounce:
  //
  //     stale  <=>  elapsed > delay + max(GRACE, delay)
  //
  // i.e. roughly double the plan, floored at five seconds. Generous enough never to trip on
  // ordinary lateness; nowhere near a real sleep.
  const STALE_GRACE_MS = 5000;

  function isStale(plannedDelayMs, actualElapsedMs) {
    const d = (typeof plannedDelayMs === "number" && plannedDelayMs >= 0) ? plannedDelayMs : 0;
    const e = (typeof actualElapsedMs === "number" && actualElapsedMs >= 0) ? actualElapsedMs : 0;
    return e > d + Math.max(STALE_GRACE_MS, d);
  }

  // ── THE SHARED TURN COUNTER ──────────────────────────────────────────────────────────────
  // Turns are measured in EVENTS, not seconds. Every client derives the same number from the same
  // log with no clock involved, so two clients can never disagree about whose turn it is — and the
  // room's own pace sets the tempo, which is correct: a quiet room is not producing much that
  // needs protecting.
  //
  // The CALLER supplies which positions count. Vouching passes critical-event positions; the seal
  // cadence passes its own. Shared mechanism, concept-owned policy.
  function turnsPassed(positions, afterL) {
    const ls = [];
    for (const p of (Array.isArray(positions) ? positions : [])) if (typeof p === "number") ls.push(p);
    ls.sort((a, b) => a - b);
    let lo = 0, hi = ls.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ls[m] <= afterL) lo = m + 1; else hi = m; }
    return ls.length - lo;
  }

  // ── ENVIRONMENT, INJECTED ────────────────────────────────────────────────────────────────
  let _env = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    random: () => Math.random(),
  };
  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  const _plans = Object.create(null);   // name -> { handle, plannedAt, delay, spec, replans }

  // ── THE SLOT ─────────────────────────────────────────────────────────────────────────────
  // Rank picks the slot; jitter spreads equal peers INSIDE it; the gap before the next rank's
  // slot is the observation window the re-check uses. Delegated to the one ladder primitive
  // rather than recomputed — this module adds no second opinion about ordering.
  //
  // URGENT SKIPS THE LADDER, JITTER ONLY. There is exactly one reason to break the ladder: a
  // DETECTED DELETION inside your window. That is history actively at risk. Routine
  // under-coverage stays lazy on purpose — treat everything as urgent and the ladder stops
  // saving anything.
  function slotMs(spec) {
    const rank = _read(spec.rank, null);
    const spacing = _read(spec.spacing, 1000);
    if (spec.urgent) return Math.floor(_env.random() * (spacing / 2));
    const ownerOffset = _read(spec.ownerOffsetMs, 0);
    try {
      if (typeof Ranks !== "undefined" && Ranks.staggerMs) {
        return Ranks.staggerMs(rank, spacing, _env.random, ownerOffset);
      }
    } catch (e) {}
    return 0;   // no ladder loaded: act immediately rather than never
  }

  function _read(v, dflt) {
    try { const r = (typeof v === "function") ? v() : v; return (r === undefined || r === null) ? dflt : r; }
    catch (e) { return dflt; }
  }

  function _mayAuthor() {
    try { if (typeof Session !== "undefined" && Session.mayAuthor) return Session.mayAuthor(); }
    catch (e) {}
    return true;   // no Session loaded (headless guards, partial load): do not block the work
  }

  // ── PLAN ─────────────────────────────────────────────────────────────────────────────────
  // spec = {
  //   rank:        () => my channel rank NOW          (getter — never captured)
  //   spacing:     () => the turn dial NOW            (getter — never captured)
  //   ownerOffsetMs: () => device-local owner offset  (getter, optional)
  //   urgent:      bool     — a DETECTED hole only
  //   stillNeeded: (ctx) => bool                       REQUIRED
  //   run:         (ctx) => void
  //
  // ctx = { rank, spacing, plannedDelay, lateBy } — READ AT FIRE TIME and handed in, so a job
  // physically cannot act on a value captured when it was planned.
  //   maxReplans:  number   — give up after this many re-plans (default 3)
  // }
  //
  // COALESCING: planning a name that is already pending is a no-op. A burst of triggers produces
  // one action, which is what the six separate debounces were each doing by hand.
  function plan(name, spec) {
    if (typeof name !== "string" || !name) return { ok: false, reason: "no-name" };
    if (!spec || typeof spec.run !== "function") return { ok: false, reason: "no-run" };
    // RULE 2, enforced rather than documented. The old tree's seal path shipped without a
    // re-check for a long time and nothing noticed, because nothing could.
    if (typeof spec.stillNeeded !== "function") return { ok: false, reason: "no-stillNeeded" };
    if (_plans[name]) return { ok: true, coalesced: true };

    return _arm(name, spec, 0);
  }

  function _arm(name, spec, replans) {
    // ── THE SLOT DECIDES ORDER; minDelayMs DECIDES THAT THERE IS A WINDOW AT ALL ────────────
    // slotMs answers "when is my turn", and for tier zero the honest answer is ZERO — the owner
    // goes first, by design. But a job whose whole value is the re-check it performs before firing
    // needs some time to have PASSED for that re-check to observe anything: with delay 0 the
    // stillNeeded head comparison runs against the same head that was captured a microtask ago and
    // can never differ. That is not a slot question, so it is not slotMs's to answer.
    //
    // This field was set by both callers and read by NOBODY, so the settle floor that
    // trust-cascade calls load-bearing was zero-width for exactly the client it was written for —
    // the owner, who is who hit the stale-seal bug. Its guard asserted the field was a positive
    // number, never that anything consulted it: a decorative assertion, green for as long as the
    // property was absent.
    //
    // Applied here rather than inside slotMs because slotMs is also called directly (the proactive
    // witness pass uses it), and a floor belongs to a PLAN — "wait before acting" — not to the
    // pure arithmetic of whose turn it is.
    const floor = Math.max(0, _read(spec.minDelayMs, 0));
    const delay = Math.max(floor, Math.max(0, slotMs(spec)));
    const plannedAt = _env.now();
    const handle = _env.setTimeout(() => _fire(name), delay);
    _plans[name] = { handle: handle, plannedAt: plannedAt, delay: delay, spec: spec, replans: replans };
    return { ok: true, delay: delay, replans: replans };
  }

  // ── FIRE ─────────────────────────────────────────────────────────────────────────────────
  // The order of the four checks is deliberate and each one is a bug the old tree had:
  //   1. stale?        — the sleep fix. Re-plan against the world as it is now.
  //   2. may I author? — the phase gate. Not caught up means not entitled.
  //   3. still needed? — the observation window, finally used.
  //   4. run.
  function _fire(name) {
    const p = _plans[name];
    if (!p) return;
    delete _plans[name];

    const elapsed = _env.now() - p.plannedAt;

    // RULE 3. A job that fires far later than planned was scheduled against a world that no
    // longer exists — its rank, its dials and its reason may all have moved. Re-plan from
    // scratch. Bounded, so a pathological clock cannot loop forever; giving up is safe because
    // every one of these jobs is also woken by real room activity.
    if (isStale(p.delay, elapsed)) {
      if (p.replans < _maxReplans(p.spec)) {
        _arm(name, p.spec, p.replans + 1);
        return { fired: false, reason: "stale-replanned" };
      }
      return { fired: false, reason: "stale-gave-up" };
    }

    // RULE: only a LIVE client authors. Dropped rather than re-planned — whatever wakes us when
    // we are caught up will plan it again, and re-planning here would spin while suspended.
    if (!_mayAuthor()) return { fired: false, reason: "not-live" };

    // THE INPUTS ARE READ HERE, AT FIRE TIME, AND HANDED TO THE JOB.
    // Handing them over rather than trusting the job to fetch them is what makes rule 1
    // ENFORCEABLE rather than merely intended: a job that is GIVEN its rank cannot accidentally
    // close over an older one.
    //
    // This came out of mutating the scheduler to capture at plan time and watching the guard stay
    // GREEN. The guard had been reading its own variable, so the property was asserted by nothing —
    // exactly the decorative assertion this project's build law says to expect in a guard written
    // minutes earlier. The fix belonged in the API, not the test.
    const ctx = {
      rank: _read(p.spec.rank, null),
      spacing: _read(p.spec.spacing, 1000),
      plannedDelay: p.delay,
      lateBy: elapsed - p.delay,
    };

    // RULE 2 in action. Everything the old sites did by hand: has the song moved, does the room
    // already agree, is the event covered now.
    let needed = false;
    try { needed = !!p.spec.stillNeeded(ctx); } catch (e) { needed = false; }
    if (!needed) return { fired: false, reason: "no-longer-needed" };

    try { p.spec.run(ctx); } catch (e) {
      try { if (typeof Logger !== "undefined" && Logger.warn) Logger.warn("Scheduler: " + name + " threw: " + (e && e.message)); }
      catch (_) {}
    }
    return { fired: true };
  }

  function _maxReplans(spec) {
    const n = spec && spec.maxReplans;
    return (typeof n === "number" && n >= 0) ? n : 3;
  }

  function cancel(name) {
    const p = _plans[name];
    if (!p) return false;
    try { _env.clearTimeout(p.handle); } catch (e) {}
    delete _plans[name];
    return true;
  }

  // RULE 4. One owner for "the room changed", so no module can forget its own timer. In the old
  // tree this was six modules each remembering to clear their own, and the failure mode was a
  // wait from the previous room deferring an action in the next one.
  function cancelAll() {
    let n = 0;
    for (const name in _plans) { if (cancel(name)) n++; }
    return n;
  }

  function pending() { return Object.keys(_plans); }
  function isPending(name) { return !!_plans[name]; }

  // Guard seam: fire a plan synchronously without waiting out its delay. What is under test is the
  // decision order at fire time, not the browser's timer.
  function _fireNowForTest(name) { return _fire(name); }

  return {
    STALE_GRACE_MS,
    attach, plan, cancel, cancelAll, pending, isPending,
    // pure, exported so the rules are asserted directly
    isStale, turnsPassed, slotMs,
    _fireNowForTest,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Scheduler };
