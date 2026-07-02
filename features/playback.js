// features/playback.js
// Reads now-playing from the stream and drives the rotation forward. When the
// current song ends (or nothing is playing but someone is ready), it emits
// ddjp.dj.play with p = the current play-instance. Any present client may emit;
// the advance lock in the reducer keeps the first and drops the rest, so a small
// random jitter + re-check is enough to avoid a thundering herd.
// Depends on: StreamManager, MatrixBridge, Logger

const Playback = (() => {
  const GRACE_MS = 15000;   // don't advance in the first 15s of a song
  const TICK_MS = 2000;
  const JITTER_MS = 1200;
  const MAX_FAST_RETRIES = 5;     // after this many advance attempts with no real song landing, slow down
  const BACKOFF_MS = 15000;       // cooldown between attempts once backing off

  let eventsChannel = null;
  let loop = null;
  let _onState = null;
  let _advancing = false;
  let _emptyAdvanceStreak = 0;    // consecutive advances that resolved to "no real song" — defensive backoff
  let _lastAdvanceAttempt = 0;
  const knownDuration = {};  // videoId -> seconds (player-supplied, never in events)
  const _subs = [];

  const TYPES = [
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.dj.join", "ddjp.dj.declare",
    "ddjp.dj.leave", "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.reset"
  ];

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
    if (loop) clearInterval(loop);
    loop = null;
  }

  // Wiring only: subscribe to stream changes and remember the channel, but do
  // NOT start the live tick loop yet. Room.join calls this BEFORE replay so the
  // loop can't fire _maybeAdvance against empty pre-replay state.
  function initWiring(channel) {
    _cleanup();
    eventsChannel = channel;
    const notify = () => _notifyUI();
    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }
    Logger.debug("Playback: wired on " + channel);
  }

  // Begin the live tick loop. Called only after history is in place (after
  // replay for join, immediately after wiring for a fresh create).
  function start() {
    if (loop) clearInterval(loop);
    loop = setInterval(_tick, TICK_MS);
    Logger.debug("Playback: started ticking");
  }

  // Convenience: wire + start in one call. Safe for callers that have nothing
  // to replay between the two phases (and for existing tests).
  function init(channel) {
    initWiring(channel);
    start();
  }

  function destroy() { _cleanup(); eventsChannel = null; }
  function stop() { if (loop) clearInterval(loop); loop = null; }

  // Registering a listener immediately pushes the CURRENT now-playing state,
  // not just future changes. Without this, a joiner who replays history before
  // the UI subscribes (see Room.join) never gets told what's already playing —
  // the player sits at local 0:00 forever, because nothing ever calls
  // loadVideo for a song that was already playing before they joined.
  function onStateChange(fn) {
    _onState = fn;
    if (_onState) _onState(_attach(StreamManager.getState().nowPlaying));
  }
  function setDuration(videoId, d) { knownDuration[videoId] = d; }

  function _attach(np) {
    if (np && np.song && knownDuration[np.song.videoId]) {
      return Object.assign({}, np, { duration: knownDuration[np.song.videoId] });
    }
    return np;
  }
  function _notifyUI() {
    if (_onState) _onState(_attach(StreamManager.getState().nowPlaying));
  }

  async function _emitPlay(prev) {
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.play", { p: prev || null });
  }

  function _tick() {
    const s = StreamManager.getState();
    const np = s.nowPlaying;
    const hasHead = (s.rotation || []).length > 0;

    if (!np) {
      if (hasHead) _maybeAdvance(null);          // genesis: someone is ready to play
      return;
    }
    // Defensive: nowPlaying can be set but carry no real song if the buffer it
    // was shifted from was empty at processing time (e.g. a declare/join event
    // was deleted out from under a client that already advanced past it — the
    // reducer's own visible() filter prevents this in normal operation, but a
    // client whose view of history changed after the fact, such as after a
    // redaction, replay, or reload, can land here). There is nothing to wait
    // for — no duration will ever arrive for a song that doesn't exist — so
    // treat it the same as nothing playing and try to advance past it,
    // instead of crashing on np.song.videoId or freezing silently forever.
    // _emptyAdvanceStreak is incremented just below, each time this branch is
    // hit — a real song landing resets it to 0 a few lines down. The backoff
    // gate itself lives in _maybeAdvance.
    if (!np.song) {
      if (hasHead) {
        _emptyAdvanceStreak++;
        _maybeAdvance(np.pi);
      }
      return;
    }
    _emptyAdvanceStreak = 0;
    const dur = knownDuration[np.song.videoId];
    if (!dur) return;                            // wait for the player to report duration
    if (Date.now() - np.startedAt < GRACE_MS) return;
    const elapsed = (Date.now() - np.startedAt) / 1000;
    if (elapsed >= dur) {
      // Wall-clock SAFETY-NET advance only. Writers emit the advance to move the
      // rotation on for clients whose real iframe ENDED never fires. We deliberately
      // do NOT declare the song ended to the UI here: this estimate can trip while
      // the song is still actually playing — a short or incorrect player-reported
      // duration, or a mid-song joiner whose startedAt runs ahead of real audio
      // position — and a false "ended" used to grey Skip and flash "Nothing playing"
      // over a song that was still audible. The authoritative end now comes from the
      // real iframe ENDED (notifyEnded); np changing on advance is what updates the
      // UI. We still clamp the progress readout to full so the bar doesn't sit short.
      _maybeAdvance(np.pi);
      if (_onState) _onState(Object.assign({}, _attach(np), { elapsed: dur }));
    } else if (_onState) {
      _onState(Object.assign({}, _attach(np), { elapsed: elapsed }));
    }
  }

  function _maybeAdvance(prev) {
    if (_advancing) return;
    // Backoff only kicks in once we've seen several consecutive advances that
    // didn't resolve to a real playing song (see _tick's !np.song branch,
    // which is the only place _emptyAdvanceStreak is ever incremented). A
    // normal genesis or end-of-song advance is unaffected — this only guards
    // against a genuinely stuck state (e.g. a redacted declare leaving an
    // empty buffer) repeatedly re-triggering itself every TICK_MS forever.
    if (_emptyAdvanceStreak >= MAX_FAST_RETRIES) {
      const since = Date.now() - _lastAdvanceAttempt;
      if (since < BACKOFF_MS) return;
    }
    _advancing = true;
    _lastAdvanceAttempt = Date.now();
    const jitter = Math.floor(Math.random() * JITTER_MS);
    setTimeout(async () => {
      try {
        const cur = StreamManager.getState().nowPlaying;
        const curPi = cur ? cur.pi : null;
        if (curPi !== (prev || null)) { _advancing = false; return; }  // already advanced
        await _emitPlay(prev);
      } catch (e) { Logger.warn("Playback advance: " + e.message); }
      _advancing = false;
    }, jitter);
  }

  // Pure decision: should an ENDED signal for `videoId` end the current song?
  // True ONLY when the id we were told ended matches the song we believe is
  // now-playing — so a stale ENDED fired during a video swap (or with no id
  // available) can never advance the wrong song. Kept pure + exported so the
  // guard exercises it without the iframe.
  function shouldEndOn(np, videoId) {
    return !!(np && np.song && videoId && np.song.videoId === videoId);
  }

  // The real "song is over" signal from the YouTube iframe (state ENDED),
  // forwarded down from the UI (interface.js onStateChange). This is the
  // authoritative end — unlike the wall-clock _tick fallback it does NOT wait
  // for the GRACE window or a player-reported duration. It routes through the
  // SAME advance path (_maybeAdvance with p = np.pi), so the reducer's advance
  // lock keeps the first emit and drops the rest exactly as for a wall-clock
  // advance — no double-advance. If we can't tell which video ended
  // (getVideoData() can return undefined mid-swap), shouldEndOn is false and we
  // no-op, leaving the wall-clock path to handle it.
  function notifyEnded(videoId) {
    const np = StreamManager.getState().nowPlaying;
    if (!shouldEndOn(np, videoId)) return;
    _maybeAdvance(np.pi);
    // Reflect "ended" locally even if THIS client can't write the advance —
    // same contract as the wall-clock branch in _tick.
    if (_onState) _onState(Object.assign({}, _attach(np), { ended: true }));
  }

  return { init, initWiring, start, destroy, stop, onStateChange, setDuration, notifyEnded, shouldEndOn };
})();
