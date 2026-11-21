// features/mediablocked.js
//
// BLOCKED REPORTS -- "I can't see this one." When a viewer's player fails because of the SONG (blocked where
// they are, or not allowed to play here -- each service's player says which, as the app's reason), their client posts a
// ddjp.play.blocked declaration scoped to the current play instance. A failure with no such reason -- the person's own
// end, or one the player cannot name -- sends nothing (J153, the owner's). The reducer FOLDS
// these into the availability tally and, when the room's rule is met (a skip road with no ranked
// length, or the blocked-for-some table when the room turns it on), derives that a skip is
// warranted (advance.skipWarranted). So this is no longer information-only: it is the
// evidence the availability skip is built on. One declaration per person per playing;
// the reducer rejects extras, which also excludes them from protection (the legality rule).
//
// -- Authoring split ---------------------------------------------------------------
// This module does two things:
//   1. REPORT -- when I can't see the current song, post one ddjp.play.blocked, staggered
//      by rank so the room doesn't burst (a higher-authority channel reports sooner).
//      REACHED FROM `notifyPlayerFailed`, which the room's player calls when its service's player fails
//      (J41). Before that wire existed everything below it was correct and ran for nobody.
//   2. AUTHOR THE ESCAPE -- when the reducer has derived advance.skipWarranted for the
//      current playing, author one ddjp.media.skip. ANY rank may author it, because the
//      ROOM decided (via the road tally), not the author; the reducer re-validates the
//      tally on the resulting skip, so the author cannot fake it. This is what lets a room
//      with no VIPs still escape a dead song.
//
// The skip ROADS (how many blocked at each rank band trigger a skip) live in room settings
// and are evaluated by the reducer -- `skipVerdict` in statederiver, which its gate and its
// advance view both read. Uncategorized reach no road, so they can never skip among themselves.
//
// Deduped by (reporter, pi): one report per person per instance. Rank is the unforgeable
// CHANNEL origin. The local tally kept here (blockedCount) is for this module's own
// scheduling; the AUTHORITATIVE tally the skip is judged on is the reducer's.
//
// Depends on: StreamManager, MatrixBridge, Logger; ServerClock (the escape's wait, as MediaLength reads it) and Playback (its
// ADVANCE_RESEND_MS, the one home for the resend wait), both at call time (J153). Listens for each play, skip, room skip and
// report, and for `ddjp.play.len`, since a ranked length can end the room's willingness to act (J153)

const MediaBlocked = (() => {
  // Turn-taking is NOT this module's to define. It asks the ONE shared stagger
  // (Capabilities.staggerMs -> Ranks.staggerMs): rank decides the slot, jitter spreads
  // peers inside it, and the room's vouchJitter setting sets the step. This module used
  // to hardcode its own 0/2/4/6/8s ladder — one of seven that disagreed with each other.

  // ── A PLAYER'S FAILURE ARRIVES AS THE APP'S REASON (J06; J29 step 2, the supervisor's decision 4) ──────────────────────
  // The declaration carries a typed reason. Which failure of a service's player means which reason is that service's player
  // file's to say — YouTube's codes and their table moved, unchanged, to `ui/youtube.js` — and never the reducer's: a
  // service's error is a per-client observation from one particular player, and the reducer reads authored declarations
  // only (`blocked-content-survival.md` §1). So this module takes a REASON, or null when the service's player knew none.
  //
  // TWO HOMES, TWO QUESTIONS. A player's table answers *which failure means what*. The reducer's `BLOCKED_REASONS` answers
  // *which reasons count toward a road* and is read through `StreamManager.blockedReasons()` — never restated here, so no
  // player can make this module send a token the fold will refuse.
  //
  // NO REASON, NO REPORT (J153, the owner's: "if we cant see and its not the players fault we dont send anything"). A null
  // reason (the person's own end, or a failure the player cannot name) and a reason the room does not know both answer null,
  // and a null schedules NOTHING: the room refuses a declaration with no reason or an unknown one, so sending it would spend a
  // message on a refusal. A player table that can produce an unknown token is a build error, and `check-blocked-reason`
  // PART A is what fails on it rather than a live room.
  function countedReason(reason) {
    if (typeof reason !== "string" || !reason) return null;
    try {
      const vocab = (typeof StreamManager !== "undefined" && StreamManager.blockedReasons)
        ? StreamManager.blockedReasons() : null;
      if (vocab && !Object.prototype.hasOwnProperty.call(vocab, reason)) return null;
    } catch (e) { /* no interface to ask: send the reason the player chose */ }
    return reason;
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
    return Capabilities.staggerMs(rank, st.vouchJitter, null);   // the song acts take no rung (the owner's decision, `ddjp_628`)
  }

  // ── ingest a ddjp.play.blocked { pi } from the spine (mine or anyone's) ───────
  function _ingest(entry) {
    if (!entry || !entry.content) return;
    const p = entry.content.pi || entry.content.p;   // play.blocked uses pi (media.blocked used p)
    const who = entry.sender;
    if (typeof p !== "string" || who == null) return;
    const set = _blocked[p] || (_blocked[p] = new Set());
    if (!set.has(who)) {
      set.add(who);
      // EVERY PERSON'S REPORT, SAID ONCE PER PLAYING (J153; the owner: "we may want to see it in logs"): who, the reason it
      // names as it arrived, and the playing — mine as it comes back too, and a replayed one. It says a report ARRIVED, not
      // that the room counted it: the fold judges each one at its own position (`StateDeriver.skipVerdict`).
      const k = entry.content.k;
      Logger && Logger.info && Logger.info(
        "MediaBlocked: report from " + who + " (" + ((typeof k === "string" && k) ? k : "no reason") + ") on pi=" + p +
        " \u2014 " + set.size + " for this playing");
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

  // ── the player told us THIS instance failed to load (its reason, or null) ─────
  // We record it locally, with the reason, and schedule our staggered report — only for a reason the room counts: a null or
  // unknown one records and schedules nothing (`countedReason`, above).
  //
  // ITS PRODUCTION CALLER IS `notifyPlayerFailed` BELOW, WIRED BY J41. For most of this tree's life
  // it had none: the room's player in `ui/interface.js` wired its ready and state events and
  // no error event, so `_iCannotSee` was never set, `_maybeScheduleReport` always returned at its
  // first condition, no `ddjp.play.blocked` was ever authored by anybody, the road tally was
  // permanently zero, and the availability escape below could not fire in a live room. The reducer
  // half was built, guarded and correct — and reached by nothing, which is README.md trap 1, and
  // the reason `check-blocked-wire` drives the UI's own handler rather than this function.
  //
  // ONE REPORT PER PLAYING, LAST REASON WINS, AND THAT IS AN OBSERVATION RATHER THAN A RULE. The
  // player can fail more than once for one load, and this assignment lets a later reason overwrite an
  // earlier one until the staggered timer fires. Left as it is because no measurement supports
  // either alternative: both first-wins and last-wins can only ever UNDER-count (they choose between
  // reasons the player actually reported), and under-counting costs the early escape while the
  // `maxLen` ceiling still fires. If a room is ever seen reporting the wrong reason, that is the
  // line to instrument — not to re-argue from here.
  function reportCannotSee(pi, reason) {
    if (typeof pi !== "string") return;
    const k = countedReason(reason);
    if (k === null) return;                       // no reason the room counts: nothing to report
    _iCannotSee[pi] = { k: k };
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
  function shouldReportBlocked(np, songKey) {
    return !!(np && np.song && songKey && np.song.songKey === songKey);
  }

  // The wire itself: the UI forwards the two facts its player gave it — the app's reason (or null) and
  // the song the player says is showing, by key — and THIS decides. The play instance is resolved here
  // rather than there because `ui/` may not reach `StreamManager` at all (`check-boundaries` rule
  // D), and because a `pi` is a protocol fact and the UI decides nothing.
  function notifyPlayerFailed(reason, songKey) {
    const np = StreamManager.getState().nowPlaying;
    if (!shouldReportBlocked(np, songKey)) {
      Logger && Logger.debug && Logger.debug(
        "MediaBlocked: player failed (" + (reason || "no reason") + ") for " + songKey +
        " — not declared; it is not the song the room says is playing");
      return;
    }
    // THE LINE NAMES WHAT HAPPENS (the second signature): a report is scheduled only for a reason the room counts, which
    // `reportCannotSee` decides; this asks the same question only to say which happened.
    if (countedReason(reason) === null) {
      Logger && Logger.info && Logger.info(
        "MediaBlocked: player failed (" + (reason || "no reason") + ") on pi=" + np.pi +
        " — not reported: not a reason the room counts");
      return;
    }
    Logger && Logger.info && Logger.info(
      "MediaBlocked: player failed (" + reason + ") on pi=" + np.pi +
      " — scheduling my staggered blocked report");
    reportCannotSee(np.pi, reason);
  }

  // The player recovered / a new song loaded fine — clear my local "can't see".
  //
  // ⚠ DELIBERATELY UNCALLED, AND THIS IS THE DECISION RATHER THAN AN OVERSIGHT (J41's fourth Open).
  // It can only ever suppress a report that has not been SENT yet — a sent declaration is judged
  // once at its own fold position and is never revisited, so nothing here could retract one and
  // nothing should. So the only thing wiring it would buy is silence when a player errors and then
  // recovers before its rank slot fires, and that window is EMPTY BY CONSTRUCTION (J153): a failure that can recover
  // (YouTube's 2 and 5, SoundCloud's error) has no reason and sends nothing at all, and the ones that carry a reason
  // (`not-allowed`, YouTube's 100, 101 and 150) are permanent facts about the song (`ui/youtube.js`'s table). So a retraction
  // would change no room's outcome.
  //
  // THE CONDITION THAT WOULD END THAT, written down because a redundancy is a statement about the
  // routes that exist: a service's player (J29) mapping a RECOVERABLE failure to one of the two reasons. At
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

  // ── QUIET ONCE THE ROOM WILL ACT (J153, the owner's: "we want to be efficient with traffic") ─────────────────────────────
  // The cascade's second half for a report: wait your turn, then re-check whether it is still needed. A report is no longer
  // needed once the room will already act on the reports it has for THIS playing — `advance.skipWarranted` for the same pi —
  // or once the song moved on. A report is still a fact about this person's player, and it is never retracted; it is only not
  // sent when it can change nothing the room does (the bot does not act on reports, so the room's rule is all they feed).
  // THE ANSWER CAN TURN FALSE WITHIN A SONG (J153): a ranked person's length closes the dead-song route (`skipVerdict` in the
  // reducer), so the room may stop acting on the reports it has. A person who stayed quiet then owes their report after all,
  // so this module listens for `ddjp.play.len` (`_onLength`) and re-arms the report, in the rank slot as before. Reports only
  // add and each person counts once, so nothing else turns it back, except a late event sorting before the song (a re-sort),
  // which the ceiling covers.
  function _roomWillAct(pi) {
    const adv = StreamManager.getState().advance;
    return !!(adv && adv.pi === pi && adv.skipWarranted);
  }

  function _reportNow(pi) {
    _clearPending();
    const np = StreamManager.getState().nowPlaying;
    if (!np || np.pi !== pi) return;              // song moved on — stale
    if (!_iCannotSee[pi]) return;                 // I can see it now
    if (iReportedBlocked(pi)) return;             // someone already recorded me / echo
    if (_roomWillAct(pi)) {                       // the room already acts on the reports it has: mine changes nothing
      Logger && Logger.info && Logger.info("MediaBlocked: my report for pi=" + pi + " not sent — the room already acts on the reports it has");
      return;
    }
    // Staggered de-storm: if enough of the SAME verdict already exist AND a higher
    // authority already reported, a lower one can stay quiet. Simple Phase-5 rule:
    // if any report already exists for this instance and I'm not the one who can
    // uniquely change the picture, I still report once (dedup handles duplicates) —
    // the ladder delay already spread us out. (Majority/disagreement nuance is the
    // Phase-6 concern where the tally becomes load-bearing.)
    // .catch, not try/catch — sendEvent rejects rather than throwing, so the try never saw a send
    // failure (see the note in MediaLength).
    // THE TYPED REASON RIDES ON THE DECLARATION (J06), always (J153): `_iCannotSee` holds only a reason the room counts —
    // `reportCannotSee` is the one place that decides, so it is not decided again here — and the room refuses a declaration
    // without one.
    const body = { pi: pi, k: _iCannotSee[pi].k };
    Promise.resolve(MatrixBridge.sendEvent(eventsChannel, "ddjp.play.blocked", body))
      .then((sent) => _followReport(pi, body, sent, 1))
      .catch((e) => Logger && Logger.warn && Logger.warn("MediaBlocked report failed: " + (e && e.message)));
  }
  // A LOST REPORT IS SENT ONCE MORE (J66). Sent once per song, a report lost in the seconds a bot
  // spends reloading left a song nobody could play on air until the ten-minute ceiling. Retried
  // only if no answer came, the same song is still on, I still cannot see it, and the room has not
  // recorded me — doing it twice is harmless, since a report counts once per person.
  function _followReport(pi, body, sent, attempt) {
    if (!sent || !sent.eventId || typeof MatrixBridge.awaitAnswer !== "function") return;
    return Promise.resolve(MatrixBridge.awaitAnswer(sent.eventId)).then((a) => {
      if (!a || a.status !== "none" || attempt >= 2) return;
      const np = StreamManager.getState().nowPlaying;
      if (!np || np.pi !== pi || !_iCannotSee[pi] || iReportedBlocked(pi) || _roomWillAct(pi)) return;
      return Promise.resolve(MatrixBridge.sendEvent(eventsChannel, "ddjp.play.blocked", body))
        .then((again) => _followReport(pi, body, again, attempt + 1));
    });
  }

  // A LENGTH CAN END THE ROOM'S WILLINGNESS TO ACT (J153): re-ask whether my report is owed, for the playing it names. The
  // re-check in `_reportNow` decides; a pending report or one already recorded is left alone (`_maybeScheduleReport`).
  function _onLength(entry) {
    const np = StreamManager.getState().nowPlaying;
    const pi = entry && entry.content ? entry.content.pi : null;
    if (np && np.pi && pi === np.pi) _maybeScheduleReport();
  }

  // A NEW PLAYING RE-ARMS; AN EVENT THAT DID NOT CHANGE IT DOES NOT (J153). Every ingested play, skip and media.skip reaches
  // this handler, refused ones included (`StreamManager.notify` tells subscribers about each), so re-arming on each one made a
  // refused escape's own echo schedule the next escape at once: 49 sends in 2 s from an owner-tier screen (rank slot 0) on
  // `ddjp_718`. So it acts only when the playing it last armed for has changed; `init` arms for whatever is on.
  let _armedPi;                 // the playing this module last armed for (undefined: not armed since init)
  function _onNowPlaying() {
    const np = StreamManager.getState().nowPlaying;
    const pi = (np && np.pi) ? np.pi : null;
    if (_armedPi !== undefined && pi === _armedPi) return;   // the same playing: a refused advance changes nothing here
    _armedPi = pi;
    // new song → re-arm for whatever the local player says about it (UI will call
    // reportCannotSee if it fails). Drop the pending timers and the escape's ask for the old instance.
    _pendingPi = null;
    _clearPending();
    _clearSkipPending();
    _skipAsked = null;
    _maybeScheduleReport();
    _maybeScheduleSkip();
  }

  // -- THE BLOCKED-SKIP ESCAPE --------------------------------------------------
  // Presence is no longer counted here. Under the SKIP ROADS model the reducer derives whether a
  // skip is warranted (advance.skipWarranted, `skipVerdict`) from the blocked declarations, using absolute
  // per-rank-band counts -- no denominator, so no "present" estimate is needed at all. This module
  // just AUTHORS the escape once the room has derived it, staggered by rank; the reducer re-checks
  // the road tally on the resulting media.skip so the author cannot fake it.
  let _skipTimer = null;
  let _skipPendingPi = null;

  // ── THE ESCAPE WAITS FOR ITS MOMENT, AND ASKS ONCE (J153) ────────────────────────────────────────────────────────────────
  // THE MOMENT: the reducer refuses a `media.skip` before `advance.skipAt` (the room's minimum time; a length never moves it,
  // `skipVerdict` in the reducer), so the escape is armed for that moment or its rank slot, whichever is later, by the shared
  // clock — `ServerClock.serverNow()`, as `MediaLength` reads it, never the device clock against a server stamp — and
  // re-checks at fire time whether the room still acts and whether a resend wait still runs.
  // ASKS ONCE: the next-song advance's shape (`features/playback.js` §ONE "NEXT SONG" IN FLIGHT PER SONG), mirrored here because
  // its record is that advance's own: once an escape is sent for a playing, no other is sent for it until its answer comes back
  // (`MatrixBridge.awaitAnswer`, which answers "none" at its own deadline); after the answer, another only after
  // `Playback.ADVANCE_RESEND_MS`, read from its one home. Unlike playback's, no deadline is measured here: the answer always
  // comes, by the transport's deadline. A transport that cannot answer counts as answered at the send. With no number to read
  // (no `Playback`), nothing is sent again: quiet is the safe direction, and the ceiling remains.
  let _skipAsked = null;        // { pi, answeredAt } for the last escape sent
  function _nowMs() {
    try { if (typeof ServerClock !== "undefined" && ServerClock.serverNow) return ServerClock.serverNow(); }
    catch (e) {}
    return Date.now();   // fallback: only until ServerClock has an offset (the same fallback MediaLength and Playback take)
  }
  function _resendMs() {
    try { if (typeof Playback !== "undefined" && typeof Playback.ADVANCE_RESEND_MS === "number") return Playback.ADVANCE_RESEND_MS; }
    catch (e) {}
    return null;
  }
  // How long until this playing's escape may go, or null when it may not go again (still waiting for its answer, or no resend).
  // `withSlot`: count the rank slot too — when arming; never when the armed timer fires, whose slot has been waited already.
  function _escapeWait(adv, withSlot) {
    let wait = withSlot ? _skipDelayForRank(_myRank()) : 0;
    if (typeof adv.skipAt === "number") wait = Math.max(wait, adv.skipAt - _nowMs());
    if (_skipAsked && _skipAsked.pi === adv.pi) {
      if (_skipAsked.answeredAt === null) return null;          // its answer re-arms
      const r = _resendMs();
      if (r === null) return null;
      wait = Math.max(wait, _skipAsked.answeredAt + r - Date.now());
    }
    return Math.max(0, wait);
  }
  function _noteSkipAsked(pi, sent) {
    const mine = { pi: pi, answeredAt: null };
    _skipAsked = mine;
    const answered = () => { if (_skipAsked === mine) { mine.answeredAt = Date.now(); _maybeScheduleSkip(); } };
    Promise.resolve(sent).then((s) => {
      if (!s || !s.eventId || typeof MatrixBridge.awaitAnswer !== "function") { answered(); return; }
      return Promise.resolve(MatrixBridge.awaitAnswer(s.eventId)).then(answered, answered);
    }, answered);
  }

  function _clearSkipPending() { if (_skipTimer) { clearTimeout(_skipTimer); _skipTimer = null; } }

  function _skipDelayForRank(rank) {
    const st = (typeof StreamManager !== "undefined" && StreamManager.getState)
      ? (StreamManager.getState().settings || {}) : {};
    return Capabilities.staggerMs(rank, st.vouchJitter, null);   // the song acts take no rung (the owner's decision, `ddjp_628`)
  }

  function _maybeScheduleSkip() {
    const s = StreamManager.getState();
    const np = s.nowPlaying, adv = s.advance;
    if (!np || !eventsChannel) return;
    // The ROOM decides, not this client's rank: author only when the reducer has derived that its
    // rule is met for the current playing. Any rank may then author it -- a room with no VIPs must
    // still escape a dead song -- because the reducer re-checks the tally, not the author.
    if (!adv || adv.pi !== np.pi || !adv.skipWarranted) return;
    if (_skipPendingPi === np.pi && _skipTimer) return;
    const wait = _escapeWait(adv, true);
    if (wait === null) return;                       // asked and not yet answered, or not to be asked again
    _clearSkipPending();
    _skipPendingPi = np.pi;
    _skipTimer = setTimeout(() => { _maybeAuthorSkip(np.pi); }, wait);
  }

  // Re-check at fire time; author one media.skip if the room still acts and the song hasn't
  // already moved on (send-suppression -- the advance-lock is the correctness guarantee, this just
  // avoids a redundant authored event).
  function _maybeAuthorSkip(pi) {
    _clearSkipPending();
    const s = StreamManager.getState();
    const np = s.nowPlaying, adv = s.advance;
    if (!np || np.pi !== pi) return;                 // song already moved on
    if (!adv || adv.pi !== pi || !adv.skipWarranted) return;   // the room no longer acts (a ranked length closed its route)
    const wait = _escapeWait(adv, false);
    if (wait === null) return;                       // asked and not yet answered: its answer re-arms
    if (wait > 0) { _maybeScheduleSkip(); return; }  // the moment not reached yet, or the resend wait runs: re-armed
    // author the escape (advance-locked + road-revalidated in the reducer, judged as a skip). The
    // body carries the derived tally purely as a human-readable reason; the reducer trusts none of it.
    // .catch, not try/catch — sendEvent rejects rather than throwing (see MediaLength).
    const sent = MatrixBridge.sendEvent(eventsChannel, "ddjp.media.skip", {
      p: pi, blockedGuestPlus: adv.blockedGuestPlus, blockedVipPlus: adv.blockedVipPlus, by: _myRank(),
    });
    _noteSkipAsked(pi, sent);
    Promise.resolve(sent).catch((e) => Logger && Logger.warn && Logger.warn("MediaBlocked skip failed: " + (e && e.message)));
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
      // A ranked length can end the room's willingness to act on the reports it has (J153): a quiet person's report is owed.
      StreamManager.on("ddjp.play.len", _onLength);
      _subscribed = true;
    }
    _armedPi = undefined;
    _skipAsked = null;
    _onNowPlaying();
  }
  function destroy() {
    if (_subscribed) {
      StreamManager.off("ddjp.play.blocked", _ingest);
      StreamManager.off("ddjp.dj.play", _onNowPlaying);
      StreamManager.off("ddjp.dj.skip", _onNowPlaying);
      StreamManager.off("ddjp.media.skip", _onNowPlaying);
      StreamManager.off("ddjp.play.len", _onLength);
      _subscribed = false;
    }
    _clearPending();
    _clearSkipPending();
    _armedPi = undefined;
    _skipAsked = null;
    eventsChannel = null;
    for (const k of Object.keys(_blocked)) delete _blocked[k];
    for (const k of Object.keys(_iCannotSee)) delete _iCannotSee[k];
  }

  return {
    init, destroy, onChange, setMyRank,
    reportCannotSee, clearCannotSee, blockedCount, iReportedBlocked,
    countedReason, notifyPlayerFailed, shouldReportBlocked,
    // exposed for the guard:
    _ingest, _delayForRank, _maybeAuthorSkip,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { MediaBlocked };
