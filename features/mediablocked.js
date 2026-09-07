// features/mediablocked.js
//
// BLOCKED REPORTS -- "I can't see this one." When a viewer's embed fails (region block,
// embedding disabled, deleted -> YouTube onError 100/101/150), their client posts a
// ddjp.play.blocked declaration scoped to the current play instance. The reducer FOLDS
// these into the availability tally and, when a SKIP ROAD is met, derives that a skip is
// warranted (advance.skipWarranted). So this is no longer information-only: it is the
// evidence the availability skip is built on. One declaration per person per playing;
// the reducer rejects extras, which also excludes them from protection (the legality rule).
//
// -- Authoring split ---------------------------------------------------------------
// This module does two things:
//   1. REPORT -- when I can't see the current song, post one ddjp.play.blocked, staggered
//      by rank so the room doesn't burst (a higher-authority channel reports sooner).
//      REACHED FROM `notifyPlayerError`, which the main player's `onError` handler calls
//      (J41). Before that wire existed everything below it was correct and ran for nobody.
//   2. AUTHOR THE ESCAPE -- when the reducer has derived advance.skipWarranted for the
//      current playing, author one ddjp.media.skip. ANY rank may author it, because the
//      ROOM decided (via the road tally), not the author; the reducer re-validates the
//      tally on the resulting skip, so the author cannot fake it. This is what lets a room
//      with no VIPs still escape a dead song.
//
// The skip ROADS (how many blocked at each rank band trigger a skip) live in room settings
// and are evaluated by the reducer -- see statederiver's declaration pass. Uncategorized
// reach no road, so they can never skip among themselves.
//
// Deduped by (reporter, pi): one report per person per instance. Rank is the unforgeable
// CHANNEL origin. The local tally kept here (blockedCount) is for this module's own
// scheduling; the AUTHORITATIVE tally the skip is judged on is the reducer's.
//
// Depends on: StreamManager, MatrixBridge, Logger

const MediaBlocked = (() => {
  // Turn-taking is NOT this module's to define. It asks the ONE shared stagger
  // (Capabilities.staggerMs -> Ranks.staggerMs): rank decides the slot, jitter spreads
  // peers inside it, and the room's vouchJitter setting sets the step. This module used
  // to hardcode its own 0/2/4/6/8s ladder — one of seven that disagreed with each other.

  // ── THE PLAYER ERROR -> REASON TOKEN MAPPING (J06) ───────────────────────────────────────
  // The declaration carries a typed reason, and THIS is where a player's numeric error becomes
  // one. It lives here and never in the reducer: an error code is a per-client observation from
  // one particular embed, and the reducer reads authored declarations only
  // (`blocked-content-survival.md` §1). A second source would put a player's vocabulary inside
  // consensus.
  //
  // TWO HOMES, TWO QUESTIONS. This table answers *which error means what*. The reducer's
  // `BLOCKED_REASONS` answers *which reasons count toward a road* and is read through
  // `StreamManager.blockedReasons()` — never restated here, so this module cannot invent a token
  // the fold will refuse.
  //
  // YouTube iframe error codes:
  //   2   invalid parameter — a request problem, not the media. Conservative: local.
  //   5   HTML5 player error — the embed would not come up. Local.
  //   100 the video is gone (removed, private, never existed).
  //   101 the uploader disallows embedding.
  //   150 the same condition as 101, reported differently by different hosts.
  //
  // REGION BLOCKS ARRIVE AS 101/150 AND ARE REPORTED AS `embed-denied`. The protocol has a
  // `region-blocked` token because a road counts both identically and a future player adapter
  // (09-roadmap.md J29) may distinguish them; nothing emits it today. Recorded so the next reader
  // does not hunt for the emitter, and so nobody deletes the token as unused — the vocabulary is
  // protocol and every client must accept what any other client can legitimately send.
  const _REASON_FOR_CODE = {
    2:   "player-failed",
    5:   "player-failed",
    100: "unavailable",
    101: "embed-denied",
    150: "embed-denied",
  };

  // An unrecognised code yields NO token, and untyped is the conservative answer the reducer
  // already gives (it does not count). Reporting an unknown failure as though the song were the
  // problem is the one direction that could force a skip on nothing.
  function reasonForErrorCode(code) {
    const k = _REASON_FOR_CODE[code];
    if (!k) return null;
    // FAIL CLOSED ON THE COUNTING QUESTION, NOT ON THE REPORT. If the reducer does not know this
    // token, sending it gets the whole declaration REJECTED — the report is lost as well as the
    // reason. Sending it untyped keeps the report and forfeits only the counting, which is the
    // cheaper of the two failures. A mapping that can produce an unknown token is a build error,
    // and `check-blocked-reason` PART A is what fails on it rather than a live room.
    try {
      const vocab = (typeof StreamManager !== "undefined" && StreamManager.blockedReasons)
        ? StreamManager.blockedReasons() : null;
      if (vocab && !Object.prototype.hasOwnProperty.call(vocab, k)) return null;
    } catch (e) { /* no interface to ask: send the token the mapping chose */ }
    return k;
  }

  let eventsChannel = null;
  let _subscribed = false;
  let _injectedRank = null;               // my channel authority (injected by room.js)
  let _pendingTimer = null;
  let _pendingPi = null;

  // pi -> Set of reporter ids that reported blocked (deduped tally)
  const _blocked = {};
  // pi values I (this client) currently believe I cannot see (drives my own report)
  const _iCannotSee = {};

  const _observers = [];
  function onChange(fn) { if (typeof fn === "function") _observers.push(fn); }
  function _notify() { for (const fn of _observers) { try { fn(); } catch (e) {} } }

  function setMyRank(r) { if (typeof r === "number") _injectedRank = r; }
  function _myRank() { return _injectedRank != null ? _injectedRank : 0; }
  function _delayForRank(rank) {
    const st = (typeof StreamManager !== "undefined" && StreamManager.getState)
      ? (StreamManager.getState().settings || {}) : {};
    return Capabilities.staggerMs(rank, st.vouchJitter, null, (typeof Store !== "undefined" && Store.stagger ? Store.stagger.offsetMs() : 0));
  }

  // ── ingest a ddjp.media.blocked { p } from the spine (mine or anyone's) ───────
  function _ingest(entry) {
    if (!entry || !entry.content) return;
    const p = entry.content.pi || entry.content.p;   // play.blocked uses pi (media.blocked used p)
    const who = entry.sender;
    if (typeof p !== "string" || who == null) return;
    const set = _blocked[p] || (_blocked[p] = new Set());
    if (!set.has(who)) {
      set.add(who);
      _notify();
      // a new report may push us over the threshold → (re)arm the escape for the
      // current instance. ANY rank may author the escape once a road is met — the room
      // decides via the tally, not the author's rank, and the reducer re-validates it.
      const np = StreamManager.getState().nowPlaying;
      if (np && np.pi === p) _maybeScheduleSkip();
    }
  }

  // How many DISTINCT present clients have reported blocked for instance p.
  function blockedCount(pi) { return (pi && _blocked[pi]) ? _blocked[pi].size : 0; }
  // Have I reported (or been recorded) blocked for this instance?
  function iReportedBlocked(pi) {
    const me = MatrixBridge.getUserId ? MatrixBridge.getUserId() : null;
    return !!(pi && me && _blocked[pi] && _blocked[pi].has(me));
  }

  // ── the player told us THIS instance failed to load (onError 2/5/100/101/150) ─────
  // We record it locally, with the reason, and schedule our staggered report.
  //
  // ITS PRODUCTION CALLER IS `notifyPlayerError` BELOW, WIRED BY J41. For most of this tree's life
  // it had none: the main `YT.Player` in `ui/interface.js` wired `onReady` and `onStateChange` and
  // no `onError`, so `_iCannotSee` was never set, `_maybeScheduleReport` always returned at its
  // first condition, no `ddjp.play.blocked` was ever authored by anybody, the road tally was
  // permanently zero, and the availability escape below could not fire in a live room. The reducer
  // half was built, guarded and correct — and reached by nothing, which is README.md trap 1, and
  // the reason `check-blocked-wire` drives the UI's own handler rather than this function.
  //
  // ONE REPORT PER PLAYING, LAST REASON WINS, AND THAT IS AN OBSERVATION RATHER THAN A RULE. The
  // iframe can fire more than once for one load, and this assignment lets a later code overwrite an
  // earlier one until the staggered timer fires. Left as it is because no measurement supports
  // either alternative: both first-wins and last-wins can only ever UNDER-count (they choose between
  // reasons the player actually reported), and under-counting costs the early escape while the
  // `maxLen` ceiling still fires. If a room is ever seen reporting the wrong reason, that is the
  // line to instrument — not to re-argue from here.
  function reportCannotSee(pi, errorCode) {
    if (typeof pi !== "string") return;
    _iCannotSee[pi] = { k: reasonForErrorCode(errorCode) };
    _maybeScheduleReport();
  }

  // ── SHOULD A PLAYER ERROR BECOME A REPORT? (J41) ─────────────────────────────────────────────
  // Pure decision, exported so a guard can exercise it without an iframe — deliberately the same
  // shape as `Playback.shouldEndOn`, which answers the sibling question for the other thing this
  // player tells us. True ONLY when the video the player says it is showing is the song the room
  // says is playing, so an error fired during a swap cannot be declared against the wrong playing.
  //
  // IT CANNOT BE CONFIRMED, SO IT IS NOT DECLARED — the rule `playback.js` already applies to a
  // measured length, for the same reason: the reducer accepts ONE declaration per person per
  // playing, so a wrong one can never be withdrawn. Silence costs the room its early escape; a
  // wrong report spends this client's single say on the wrong song.
  function shouldReportBlocked(np, videoId) {
    return !!(np && np.song && videoId && np.song.videoId === videoId);
  }

  // The wire itself: the UI forwards the two raw facts its iframe gave it — the numeric error and
  // the video the player says is loaded — and THIS decides. The play instance is resolved here
  // rather than there because `ui/` may not reach `StreamManager` at all (`check-boundaries` rule
  // D), and because a `pi` is a protocol fact and the UI decides nothing.
  function notifyPlayerError(errorCode, videoId) {
    const np = StreamManager.getState().nowPlaying;
    if (!shouldReportBlocked(np, videoId)) {
      Logger && Logger.debug && Logger.debug(
        "MediaBlocked: player error " + errorCode + " for vid=" + videoId +
        " — not declared; it is not the song the room says is playing");
      return;
    }
    Logger && Logger.info && Logger.info(
      "MediaBlocked: player error " + errorCode + " on pi=" + np.pi +
      " — scheduling my staggered blocked report");
    reportCannotSee(np.pi, errorCode);
  }

  // The player recovered / a new song loaded fine — clear my local "can't see".
  //
  // ⚠ DELIBERATELY UNCALLED, AND THIS IS THE DECISION RATHER THAN AN OVERSIGHT (J41's fourth Open).
  // It can only ever suppress a report that has not been SENT yet — a sent declaration is judged
  // once at its own fold position and is never revisited, so nothing here could retract one and
  // nothing should. So the only thing wiring it would buy is silence when a player errors and then
  // recovers before its rank slot fires, and MEASURED AGAINST THE REASON TABLE that window is
  // empty of anything that matters: the codes that can recover (2, 5) map to `player-failed`, which
  // counts toward no road, and the codes that count toward a road (100, 101, 150) are permanent
  // facts about the video that do not recover. So a retraction would change no room's outcome.
  //
  // THE CONDITION THAT WOULD END THAT, written down because a redundancy is a statement about the
  // routes that exist: a player adapter (J29) mapping a RECOVERABLE error to a COUNTING token. At
  // that point this function has work to do and wants a caller and a guard.
  function clearCannotSee(pi) { if (pi) delete _iCannotSee[pi]; }

  function _clearPending() { if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; } }

  function _maybeScheduleReport() {
    const np = StreamManager.getState().nowPlaying;
    if (!np || !eventsChannel) return;
    const pi = np.pi;
    if (!_iCannotSee[pi]) return;                 // I can see it → nothing to report
    if (iReportedBlocked(pi)) return;             // already recorded (echo/replay)
    if (_pendingPi === pi && _pendingTimer) return;
    _clearPending();
    _pendingPi = pi;
    const wait = _delayForRank(_myRank());
    _pendingTimer = setTimeout(() => { _reportNow(pi); }, wait);
  }

  function _reportNow(pi) {
    _clearPending();
    const np = StreamManager.getState().nowPlaying;
    if (!np || np.pi !== pi) return;              // song moved on — stale
    if (!_iCannotSee[pi]) return;                 // I can see it now
    if (iReportedBlocked(pi)) return;             // someone already recorded me / echo
    // Staggered de-storm: if enough of the SAME verdict already exist AND a higher
    // authority already reported, a lower one can stay quiet. Simple Phase-5 rule:
    // if any report already exists for this instance and I'm not the one who can
    // uniquely change the picture, I still report once (dedup handles duplicates) —
    // the ladder delay already spread us out. (Majority/disagreement nuance is the
    // Phase-6 concern where the tally becomes load-bearing.)
    // .catch, not try/catch — sendEvent rejects rather than throwing, so the try never saw a send
    // failure (see the note in MediaLength).
    // THE TYPED REASON RIDES ON THE DECLARATION (J06), and the key is OMITTED rather than sent as
    // null when we have no token for it. Two reasons: the body is fingerprinted, so an absent key
    // and an explicit null are different bytes for the same fact; and absent is the shape the
    // reducer reads as untyped, which is what an older client sends.
    const body = { pi: pi };
    const mine = _iCannotSee[pi];
    if (mine && typeof mine.k === "string") body.k = mine.k;
    MatrixBridge.sendEvent(eventsChannel, "ddjp.play.blocked", body)
      .catch((e) => Logger && Logger.warn && Logger.warn("MediaBlocked report failed: " + (e && e.message)));
  }

  function _onNowPlaying() {
    // new song → re-arm for whatever the local player says about it (UI will call
    // reportCannotSee if it fails). Drop the pending timer for the old instance.
    _pendingPi = null;
    _clearPending();
    _clearSkipPending();
    _maybeScheduleReport();
    _maybeScheduleSkip();
  }

  // -- THE BLOCKED-SKIP ESCAPE --------------------------------------------------
  // Presence is no longer counted here. Under the SKIP ROADS model the reducer derives whether a
  // skip is warranted (advance.skipWarranted) from the blocked declarations, using absolute
  // per-rank-band counts -- no denominator, so no "present" estimate is needed at all. This module
  // just AUTHORS the escape once the room has derived it, staggered by rank; the reducer re-checks
  // the road tally on the resulting media.skip so the author cannot fake it.
  let _skipTimer = null;
  let _skipPendingPi = null;

  function _clearSkipPending() { if (_skipTimer) { clearTimeout(_skipTimer); _skipTimer = null; } }

  function _skipDelayForRank(rank) {
    const st = (typeof StreamManager !== "undefined" && StreamManager.getState)
      ? (StreamManager.getState().settings || {}) : {};
    return Capabilities.staggerMs(rank, st.vouchJitter, null,
      (typeof Store !== "undefined" && Store.stagger) ? Store.stagger.offsetMs() : 0);
  }

  function _maybeScheduleSkip() {
    const s = StreamManager.getState();
    const np = s.nowPlaying, adv = s.advance;
    if (!np || !eventsChannel) return;
    // The ROOM decides, not this client's rank: author only when the reducer has derived that a
    // road is met for the current playing. Any rank may then author it -- a room with no VIPs must
    // still escape a dead song -- because the reducer re-checks the tally, not the author.
    if (!adv || adv.pi !== np.pi || !adv.skipWarranted) return;
    if (_skipPendingPi === np.pi && _skipTimer) return;
    _clearSkipPending();
    _skipPendingPi = np.pi;
    _skipTimer = setTimeout(() => { _maybeAuthorSkip(np.pi); }, _skipDelayForRank(_myRank()));
  }

  // Re-check at fire time; author one media.skip if the road is still met and the song hasn't
  // already moved on (send-suppression -- the advance-lock is the correctness guarantee, this just
  // avoids a redundant authored event).
  function _maybeAuthorSkip(pi) {
    _clearSkipPending();
    const s = StreamManager.getState();
    const np = s.nowPlaying, adv = s.advance;
    if (!np || np.pi !== pi) return;                 // song already moved on
    if (!adv || adv.pi !== pi || !adv.skipWarranted) return;   // road no longer met
    // author the escape (advance-locked + road-revalidated in the reducer, judged as a skip). The
    // body carries the derived tally purely as a human-readable reason; the reducer trusts none of it.
    // .catch, not try/catch — sendEvent rejects rather than throwing (see MediaLength).
    MatrixBridge.sendEvent(eventsChannel, "ddjp.media.skip", {
      p: pi, blockedGuestPlus: adv.blockedGuestPlus, blockedVipPlus: adv.blockedVipPlus, by: _myRank(),
    }).catch((e) => Logger && Logger.warn && Logger.warn("MediaBlocked skip failed: " + (e && e.message)));
  }

  // ── lifecycle (mirrors MediaLength) ──────────────────────────────────────────
  function init(channel) {
    eventsChannel = channel;
    if (!_subscribed) {
      StreamManager.on("ddjp.play.blocked", _ingest);
      StreamManager.on("ddjp.dj.play", _onNowPlaying);
      StreamManager.on("ddjp.dj.skip", _onNowPlaying);
      // The availability escape advances the room too. Without this the module never re-arms
      // after the very skip it authored: timers for the old instance are left standing and no
      // report or escape is scheduled for the new song until an ordinary play/skip happens.
      StreamManager.on("ddjp.media.skip", _onNowPlaying);
      _subscribed = true;
    }
    _onNowPlaying();
  }
  function destroy() {
    if (_subscribed) {
      StreamManager.off("ddjp.play.blocked", _ingest);
      StreamManager.off("ddjp.dj.play", _onNowPlaying);
      StreamManager.off("ddjp.dj.skip", _onNowPlaying);
      StreamManager.off("ddjp.media.skip", _onNowPlaying);
      _subscribed = false;
    }
    _clearPending();
    _clearSkipPending();
    eventsChannel = null;
    for (const k of Object.keys(_blocked)) delete _blocked[k];
    for (const k of Object.keys(_iCannotSee)) delete _iCannotSee[k];
  }

  return {
    init, destroy, onChange, setMyRank,
    reportCannotSee, clearCannotSee, blockedCount, iReportedBlocked,
    reasonForErrorCode, notifyPlayerError, shouldReportBlocked,
    // exposed for the guard:
    _ingest, _delayForRank, _blocked, _skipDelayForRank, _maybeAuthorSkip, _REASON_FOR_CODE,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { MediaBlocked };
