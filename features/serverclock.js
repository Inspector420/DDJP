// features/serverclock.js
//
// THE LOCAL MATRIX CLOCK. A tiny, standalone read of "what time is it on the server, right
// now" — reconstructed locally, with ZERO extra messages. Every event we already receive
// carries the homeserver's timestamp (entry.ts); the moment we receive one we also know our
// own local clock, so the difference is our OFFSET ("my device is N ms ahead of the server").
// From then on:  serverNow() = Date.now() - offset  — computed locally, no network, no ping.
//
// ── Why this exists (replaces the drift beacon) ──────────────────────────────────
// A song's start is already the SHARED server ts of its play event (StateDeriver: startedAt
// = ev.ts). The only reason clients disagreed on "how far into the song we are" was that
// each computed elapsed against its OWN wall clock. Anchor `now` to the same server clock as
// `startedAt`, and elapsed = serverNow() - startedAt is computed entirely in server-time —
// so everyone agrees, by construction, with no broadcasting. This is the correct fix the
// ddjp.media.time beacon was clumsily approximating; the beacon is deleted.
//
// ── Safety / non-authoritativeness ───────────────────────────────────────────────
// This is TIMING ONLY. It feeds the playhead (progress bar, countdown) and the ceiling's
// *timing*. It NEVER decides which song plays (that's the ordered, advance-locked event) and
// it is NOT read by the reducer. Worst case a bad offset makes a countdown/ceiling fire a
// beat early or late, and the advance-lock absorbs it exactly like any other early skip —
// identical to the guarantee the old beacon had, minus the messages.
//
// ── The offset estimate (smoothed) ───────────────────────────────────────────────
// A single sample is noisy: network latency means "when I received it" is a hair after "when
// the server stamped it", so a raw sample slightly OVER-estimates how far ahead we are.
// Latency is one-sided (never negative), so the MINIMUM recent sample is the least-polluted
// estimate — but we take the MEDIAN of a small recent window for robustness against outliers
// (a single laggy or clock-jumped message can't yank the countdown). Federation note: events
// may be stamped by different homeservers whose clocks differ slightly; the median over
// recent traffic tracks the servers we actually hear from, and worst case degrades to the
// old raw-local-clock behavior — never worse. All dials below are tunable and NOT load-bearing.
// The window is fed by LIVE events only (see _onStreamEvent): a replayed event's age is not a
// measurement of anything, and a median of ages is a confident wrong answer rather than a noisy
// right one — which the smoothing above cannot help with, because nothing in the window is good.
//
// Depends on: StreamManager (to observe event ts), Logger, and MatrixBridge for ONE read —
// mayAuthor(), to tell live traffic from replayed history. It still SENDS nothing, which is the
// property that mattered; the old note said "No MatrixBridge" and that was a statement about a
// dependency rather than about behaviour, so it read as a guarantee it was not making.

const ServerClock = (() => {
  const WINDOW = 12;          // how many recent offset samples to keep (median over these)
  // `MAX_SAMPLE_AGE` was bound to 0 and never read: samples are kept by COUNT (`WINDOW`) and
  // never by age, so the constant described a policy the code does not implement.

  let _subscribed = false;
  let _samples = [];          // recent { offset } — offset = localAtReceive - serverTs (ms)
  let _offset = 0;            // current smoothed offset (ms). serverNow = local - _offset.
  let _haveOffset = false;    // false until we've observed at least one event

  const _observers = [];
  function onChange(fn) { if (typeof fn === "function") _observers.push(fn); }
  function _notify() { for (const fn of _observers) { try { fn(); } catch (e) {} } }

  function _median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Fold one observed event's server ts into the offset estimate. Called for EVERY event via
  // the "*" subscription — so the clock stays fresh purely as a byproduct of normal traffic.
  function _observe(entry) {
    if (!entry || typeof entry.ts !== "number" || entry.ts <= 0) return;   // no usable server ts
    const localNow = _localNow();
    const sample = localNow - entry.ts;                 // +ve => my clock is ahead of the server
    _samples.push(sample);
    if (_samples.length > WINDOW) _samples.shift();
    const next = _median(_samples);
    if (next !== _offset || !_haveOffset) { _offset = next; _haveOffset = true; _notify(); }
  }

  // Server-time NOW, in ms since epoch, computed locally. Before we've seen any event (no
  // offset yet) this equals the local clock — i.e. it degrades to today's behavior, never worse.
  function serverNow() { return _localNow() - _offset; }

  // Server-time elapsed since a server-stamped anchor (ms). Convenience for playback:
  // elapsedSince(startedAt) is server-time on BOTH ends, so it agrees across clients.
  function elapsedSince(anchorMs) {
    if (typeof anchorMs !== "number") return 0;
    return Math.max(0, serverNow() - anchorMs);
  }

  function offsetMs() { return _offset; }
  function hasOffset() { return _haveOffset; }

  // seam so tests can drive the local clock deterministically (never used in prod)
  let _clock = null;
  function _localNow() { return _clock ? _clock() : Date.now(); }
  function _setClockForTest(fn) { _clock = fn; }

  // ── LIVE TRAFFIC ONLY — THE ASSUMPTION THIS MODULE ALWAYS RESTED ON ──────────────────────
  // Every sample here means "an event stamped T arrived at local time L, so my clock is L-T ahead".
  // That is only true if the event ARRIVED at roughly the time it was STAMPED. Replay breaks it
  // absolutely: `init()` runs in room.js's wire phase and `_replayAllChannels` runs after it, so
  // the room's entire history came through this same subscription and each old event contributed a
  // sample equal to its own AGE. A two-hour room taught the client the server was minutes in the
  // past, and everything downstream reads that one number — the seek position, the progress bar,
  // the wall-clock advance net, and the grace test that gates auto-calibration. One wrong value,
  // four symptoms, which is why it looked like several unrelated faults.
  //
  // The phase machine already knows which is which, and `mayAuthor()` is the interface's own way to
  // ask it — features may not reach Session directly (check-boundaries rule F), and a second
  // opinion about "am I caught up" is exactly the duplication that drifts.
  //
  // FAIL DIRECTION (CONCEPTS.md §3.2 — state it, never inherit it): if liveness cannot be
  // established, DO NOT LEARN. No offset means serverNow() is the local clock, which is this
  // module's own documented degradation and wrong by a device's skew — seconds. Learning from
  // history is wrong by a room's quietness — minutes — and that is what stopped the music.
  function _live() {
    try {
      if (typeof MatrixBridge === "undefined" || !MatrixBridge.mayAuthor) return false;
      const v = MatrixBridge.mayAuthor();
      return !!(v && v.ok);
    } catch (e) { return false; }
  }

  // What the stream subscription calls. `_observe` stays directly callable so the arithmetic can be
  // exercised on its own; the GATE lives here, on the path production actually uses, so a guard
  // that drives the subscription drives the real thing.
  function _onStreamEvent(entry) {
    if (!_live()) return;
    _observe(entry);
  }

  function init() {
    if (!_subscribed) {
      StreamManager.on("*", _onStreamEvent);   // learn the offset from LIVE incoming events
      _subscribed = true;
    }
  }
  function destroy() {
    if (_subscribed) { StreamManager.off("*", _onStreamEvent); _subscribed = false; }
    _samples = []; _offset = 0; _haveOffset = false;
  }

  return {
    init, destroy, onChange,
    serverNow, elapsedSince, offsetMs, hasOffset,
    // exposed for guards/tests:
    _observe, _median, _setClockForTest, _samples, WINDOW,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { ServerClock };
