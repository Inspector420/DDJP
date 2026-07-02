// features/reactions.js
// Two lightweight, spine-recorded reactions to the CURRENTLY-PLAYING song:
//   • vote → emits ddjp.dj.vote { p }   ("upvote this song")
//   • save → emits ddjp.dj.save { p }   ("I saved this song to a playlist")
//
// Both mirror Skip's emission model: a single event tagged with p = the current
// play-instance id (nowPlaying.pi), sent on the events channel. UNLIKE skip they
// carry NO consensus weight — the reducer has no branch for them, so they're pure
// annotations on the permanent spine (ignored by derive, still notified to any
// StreamManager subscriber). That's deliberate: later we can render "user X voted /
// saved this song" by resolving p → song + sender from the log, with NO state-shape
// change now. Song identity is NOT re-asserted in the body — p already anchors it via
// the play event, and truth comes from the envelope/spine, never a re-stated field
// (same rule as rank, 06 §fundamentals).
//
// ONE-WAY PER PLAY-INSTANCE, AND DURABLE. You may vote/save the current song once; the
// affordance latches "done" until the song changes (a new pi), then it's live again.
// The latch is DERIVED FROM THE SPINE, not a client-local flag: we track the set of pis
// *I* have voted/saved by watching my own ddjp.dj.vote/ddjp.dj.save events land. Because
// room history replays through StreamManager on join, a reload repopulates those sets —
// so if I already saved/voted the song that is STILL playing (same pi), the button comes
// back pressed and non-clickable. It keys on p (the play-instance), so a *past* play of
// the same video does NOT count — only the instance currently on air. We also add the pi
// optimistically on send so the button latches instantly, before the event echoes back
// (the echo/replay then re-adds it, idempotent).
//
// Depends on: StreamManager, MatrixBridge, Logger

const Reactions = (() => {
  let eventsChannel = null;
  const _myVotes = new Set();   // play-instance ids I've upvoted (from my own vote events on the spine)
  const _mySaves = new Set();    // play-instance ids I've saved to a playlist
  let _subscribed = false;      // subscribe to the spine exactly once (survives room changes)
  const _observers = [];        // UI callbacks fired when my latch gains an instance

  // The UI re-syncs the ★/▲ on consensus now-playing changes already, but a vote/save
  // landing does NOT change consensus state (the reducer ignores it), so on RELOAD the
  // replay of my own past reactions would repopulate the sets WITHOUT any render. This
  // observer lets the UI re-press the buttons the moment that happens. Fired only on a
  // genuinely new record (an optimistic press already re-synced; its echo is a no-op).
  function onChange(fn) { if (typeof fn === "function") _observers.push(fn); }
  function _notifyChange() { for (const fn of _observers) { try { fn(); } catch (e) {} } }

  // Record one of MY OWN vote/save events (from live echo OR history replay) into the
  // matching set, keyed by the play-instance it annotated. Someone else's events are
  // ignored here (they belong to the future per-song counting layer, not my button).
  function _record(entry) {
    if (!entry || entry.sender == null || entry.sender !== MatrixBridge.getUserId()) return;
    const p = entry.content ? entry.content.p : null;
    if (p == null) return;
    let added = false;
    if (entry.type === "ddjp.dj.vote") { if (!_myVotes.has(p)) { _myVotes.add(p); added = true; } }
    else if (entry.type === "ddjp.dj.save") { if (!_mySaves.has(p)) { _mySaves.add(p); added = true; } }
    if (added) _notifyChange();
  }

  // Room calls this like Skip.init on room enter AND on a mid-room rank rewire. It only
  // re-points the channel and (once) subscribes to the spine. It does NOT clear the sets:
  // pis are globally-unique Matrix event ids, so entries from a previous room/song can
  // never falsely match the live pi, and clearing on a rewire would wrongly drop state
  // that no replay would restore mid-room. On a fresh room ENTER the replay simply adds
  // that room's pis as history flows in. The subscription persists across rooms because
  // StreamManager keeps its subscribers through reset() — so we attach exactly once.
  function init(channel) {
    eventsChannel = channel;
    if (!_subscribed) {
      StreamManager.on("ddjp.dj.vote", _record);
      StreamManager.on("ddjp.dj.save", _record);
      _subscribed = true;
    }
  }
  function destroy() {
    if (_subscribed) {
      StreamManager.off("ddjp.dj.vote", _record);
      StreamManager.off("ddjp.dj.save", _record);
      _subscribed = false;
    }
    eventsChannel = null;
    _myVotes.clear();
    _mySaves.clear();
  }

  function _curPi() {
    const np = StreamManager.getState().nowPlaying;
    return np ? np.pi : null;
  }

  // Upvote the current song. One-way per instance: no-op (ok:false) if nothing is
  // playing or I've already voted this pi. Adds the pi to the set BEFORE the await so a
  // double-click in the same instant can't double-send and the button latches at once.
  async function vote() {
    const pi = _curPi();
    if (!eventsChannel || pi == null) return { ok: false, reason: "nothing is playing" };
    if (_myVotes.has(pi)) return { ok: false, reason: "already voted this song" };
    _myVotes.add(pi);
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.vote", { p: pi });
    return { ok: true };
  }
  function hasVoted() { const pi = _curPi(); return pi != null && _myVotes.has(pi); }

  // Record that the user saved the current song to a playlist. The UI calls this ONLY
  // after a playlist add actually succeeded (cancelling the picker records nothing).
  // It takes the pi captured when the star was PRESSED — the add-to-playlist picker is
  // async and the song may have advanced by the time the user picks a list, so the
  // annotation is anchored to the instance the user actually acted on, not whatever is
  // playing at commit time. If that instance is already over, hasSaved() (which reads
  // the CURRENT pi) simply won't light the star for the new song — correct, since the
  // song they saved is no longer playing.
  async function recordSave(pi) {
    if (!eventsChannel || pi == null) return { ok: false, reason: "no play instance" };
    if (_mySaves.has(pi)) return { ok: false, reason: "already saved this song" };
    _mySaves.add(pi);
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.save", { p: pi });
    return { ok: true };
  }
  function hasSaved() { const pi = _curPi(); return pi != null && _mySaves.has(pi); }

  return { init, destroy, vote, hasVoted, recordSave, hasSaved, onChange };
})();
