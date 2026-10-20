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
  // THE ROOM'S OWN RECORD TOO (owner's re-test): the live play's ledger names who voted and saved, and it travels in a save
  // point's seed — so after a reload from a save point, a vote cast below the floor still lights the button.
  // The ledger travels in the floor's SEED (`seed.ledger.counts[pi]`), not in the derived state: votes above the floor are
  // re-recorded as the held log replays; the seed is what remembers those below it.
  function _ledgerHas(kind, pi) {
    try {
      const me = MatrixBridge.getUserId();
      const seed = (typeof StreamManager.floorSeed === "function") ? StreamManager.floorSeed() : null;
      const st = StreamManager.getState();
      for (const led of [seed && seed.ledger, st && st.ledger]) {
        const c = led && led.counts && led.counts[pi], u = c && c[kind] && c[kind].users;
        if (Array.isArray(u) && u.indexOf(me) >= 0) return true;
      }
      return false;
    } catch (e) { return false; }
  }
  function _has(set, kind, pi) { return set.has(pi) || _ledgerHas(kind, pi); }
  // Does the room already hold MY vote (or save) for this play? The held log, then the ledger the floor's seed carries.
  function _roomHolds(set, pi) {
    const kind = (set === _myVotes) ? "v" : "s", t = (set === _myVotes) ? "ddjp.dj.vote" : "ddjp.dj.save";
    try {
      const me = MatrixBridge.getUserId();
      const log = (typeof StreamManager.getLog === "function") ? (StreamManager.getLog() || []) : [];
      if (log.some((e) => e && (e.type === t || (e.content && e.content.t === t)) && e.sender === me && e.content && e.content.p === pi)) return true;
    } catch (e) {}
    return _ledgerHas(kind, pi);
  }
  function _log(m) { try { if (typeof Logger !== "undefined") Logger.info("Reactions: " + m); } catch (e) {} }   // diagnostic (owner's re-test)
  async function vote() {
    const pi = _curPi();
    if (!eventsChannel || pi == null) return { ok: false, reason: "nothing is playing" };
    if (_has(_myVotes, "v", pi)) { _log("vote refused — already voted pi=" + pi); return { ok: false, reason: "already voted this song" }; }
    _myVotes.add(pi);
    const sent = await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.vote", { p: pi });
    _log("vote sent pi=" + pi + " intent=" + (sent && sent.eventId));
    _follow(sent, 1, _myVotes, pi, () => MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.vote", { p: pi }));
    return { ok: true };
  }
  function hasVoted() { const pi = _curPi(); return pi != null && _has(_myVotes, "v", pi); }

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
    if (_has(_mySaves, "s", pi)) { _log("save refused — already saved pi=" + pi); return { ok: false, reason: "already saved this song" }; }
    _mySaves.add(pi);
    const sent = await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.save", { p: pi });
    _log("save sent pi=" + pi + " intent=" + (sent && sent.eventId));
    _follow(sent, 1, _mySaves, pi, () => MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.save", { p: pi }));
    return { ok: true };
  }

  // ── A LATCHED BUTTON MUST NOT OUTLIVE A LOST VOTE (J65) ──────────────────────────────────────
  // The button lights before the send, so a double-click cannot double-send — and it used to stay
  // lit forever, even when the vote never counted. Now the send is followed to its answer: no answer
  // is retried ONCE while that song is still playing (a second vote from one person counts once, so
  // a late duplicate is harmless); a refusal, or no answer twice, un-presses the button.
  function _follow(sent, attempt, set, pi, resend) {
    if (!sent || !sent.eventId || typeof MatrixBridge.awaitAnswer !== "function") return;
    Promise.resolve(MatrixBridge.awaitAnswer(sent.eventId)).then((a) => {
      if (!a || a.status === "yes") return;
      // SILENCE CAN MEAN "ALREADY COUNTED" (owner's live log, `ddjp_537`): the bot drops a duplicate vote or save in silence,
      // so before resending or clearing, ask whether the room already holds mine for this play — in the log or the ledger.
      if (a.status === "none" && _roomHolds(set, pi)) { _log("no answer for intent=" + sent.eventId + ", but the room already holds it pi=" + pi + " — kept"); return; }
      if (a.status === "none" && attempt < 2 && _curPi() === pi) {
        _log("no answer for intent=" + sent.eventId + " (" + (a.reason || "none") + ") — resending pi=" + pi);
        return Promise.resolve(resend()).then((r2) => _follow(r2, attempt + 1, set, pi, resend));
      }
      if (set.has(pi)) { set.delete(pi); _log("latch cleared pi=" + pi + " — answer " + a.status + " (" + (a.reason || "") + ")"); _notifyChange(); }
    }).catch(() => {});
  }
  function hasSaved() { const pi = _curPi(); return pi != null && _has(_mySaves, "s", pi); }

  return { init, destroy, vote, hasVoted, recordSave, hasSaved, onChange };
})();
