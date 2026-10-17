// features/medialength.js
//
// SHARED SONG LENGTH -- so a viewer who can't load a video still knows how long it
// runs. DISPLAY-LEVEL and REDUCER-INERT: this never changes the queue. It only fills a
// `displayDuration` that Playback uses for the countdown/label. The reducer has no branch
// for the event we emit here (ddjp.media.len), so derive(log) === derive(log + media.len).
//
// NOTE: the length that GATES advances is a DIFFERENT, consensus event -- ddjp.play.len,
// folded by the reducer and scoped to the play instance (see statederiver's declaration
// pass). This module is purely the display/countdown layer; it does not decide when a song
// may advance. Kept separate on purpose: display wants "roughly right for a progress bar",
// the gate wants the rank/majority/clamp cascade over ddjp.play.len, which defends against
// lying short AND long (see StateDeriver.gateLengthSec).
//
// ── The rank-staggered answering ladder (the whole idea) ────────────────────────
// We do NOT collect everyone's length and vote. Higher-AUTHORITY channels answer
// SOONER; lower ones stay SILENT if a higher one already answered. So normally exactly
// ONE report is authored per song — the highest present authority's — and the room
// stays quiet. (Same shape as Playback's stagger-then-recheck advance, but the delay
// is authority-based instead of random jitter.)
//
// AUTHORITY IS THE CHANNEL, NOT THE PERSON. An event's weight is the rank of the
// channel it arrived on (transport stamps senderRank from channel origin); we never
// look up "user X's rank". The owner events channel is a single authority — the human
// owner (100) and the owner-bot (99, but writing on owner channels) both speak with
// owner authority; there is one owner voice, so no "majority" of it exists.
//
//   Owner-tier channel   answers at ~0s after the song starts
//   High-Staff channel   answers at 2s
//   Staff channel        answers at 4s
//   VIP channel          answers at 6s
//   everyone else        answers at 8s
//
// Tiebreak rules (the B plan — see _ingest):
//   • Higher-authority channel beats lower.
//   • OWNER tier = LATEST WINS (one authority, no majority; latest owner report/
//     checkpoint is truth, whether human or bot authored it).
//   • Within a NON-owner tier, true majority is DEFERRED (cosmetic for a clamped
//     display number; becomes load-bearing only at the escape phases). Placeholder:
//     first-seen at that tier.
//   • Strong-disagreement exception: answer even against a higher tier ONLY if your own
//     measured length differs by >= DISAGREE_SEC (2s). Below that, defer silently.
//
// ── Resolution (what displayDuration a client shows) ────────────────────────────
//   1. my own player's measured length for this videoId  (localMeasuredDuration)
//   2. my Store.meta cache (durationSec) — I've played it before
//   3. the ladder-winning authored ddjp.media.len for this videoId
//   4. (a lone self-claimed dur on the play event — future; not read yet)
//   5. unknown
// Then CLAMP to [FLOOR, CEILING]. A real player ENDED still wins elsewhere (Playback),
// even below the floor — the clamp is only for the shared/fallback number.
//
// Seconds here (ladder delays, floor, ceiling) are TUNABLE DIALS; only the strict
// rank ORDER matters for correctness. Nothing in this file is read by derive().
//
// Depends on: StreamManager, MatrixBridge, Store, Logger, ServerClock (timing only)

const MediaLength = (() => {
  // ── dials (tunable; not correctness) ──────────────────────────────────────────
  const FLOOR_SEC   = 10;          // clamp floor (min shared length)
  const CEILING_SEC = 10 * 60;     // clamp ceiling (max shared length = 10 min)
  const DISAGREE_SEC = 2;          // answer against a higher rank only if you differ by >= this
  // Turn-taking is NOT this module's to define. It asks the ONE shared stagger
  // (Capabilities.staggerMs -> Ranks.staggerMs): rank decides the slot, jitter spreads
  // peers inside it, and the room's vouchJitter setting sets the step. This module used
  // to hardcode its own 0/2/4/6/8s ladder — one of seven that disagreed with each other.

  let eventsChannel = null;
  let _subscribed = false;

  // videoId -> { d, rank, l } : the best (highest-rank) reported length seen on the
  // spine so far for that video. Grow/replace-only, deduped by keeping the top rank.
  const _reports = {};
  // videoId -> seconds measured by MY OWN player this session (authoritative for me,
  // and the ONLY value that may drive a local advance — Playback owns that use).
  const _localMeasured = {};
  // pending answer timers keyed by pi, so a song change cancels a stale pending answer
  let _pendingTimer = null;
  let _pendingPi = null;

  const _observers = [];
  function onChange(fn) { if (typeof fn === "function") _observers.push(fn); }
  function _notify() { for (const fn of _observers) { try { fn(); } catch (e) {} } }

  function _clamp(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec <= 0) return null;
    return Math.min(CEILING_SEC, Math.max(FLOOR_SEC, Math.round(sec)));
  }

  // ── ingest a ddjp.media.len from the spine (mine or anyone's) ────────────────
  // Body: { v: videoId, d: seconds }. AUTHORITY IS THE CHANNEL, NOT THE PERSON:
  // entry.senderRank is the rank of the *channel the event arrived on* (transport
  // stamps it from channel origin), so we reason about channel-authority tiers, never
  // "what rank is user X". Tiebreak rules (the B plan):
  //   • Higher-authority channel beats lower  → keep the higher tier's value.
  //   • OWNER tier (99) = a single authority (human or bot both write owner channels;
  //     one owner voice, so no majority is possible) → LATEST WINS: an owner-tier
  //     ── THE RUNG IS 99, AND IT SAID 100 UNTIL v284. `owner` sits at 99 so that a bot at
  //     that rung reads as owner to every gate while Matrix's `state_default` of 100 still
  //     refuses it state events. **The ladder SATURATES**: `nameOf(99)`, `nameOf(100)` and
  //     `nameOf(101)` all answer `owner`, so an OWNER-TIER CHANNEL is written by anything at
  //     99 or above — the human owner at 100 and the bot at 99, which is exactly what the
  //     header above says. The code compares by NAME and was always right; only this number
  //     was wrong, and a wrong number in reasoning is what a later session quotes rather
  //     than re-derives.
  //     report REPLACES any prior report, including a prior owner-tier one.
  //   • Within a NON-owner tier, true "majority of that tier" is DEFERRED (TODO): for a
  //     clamped display number the difference between first-seen and modal is cosmetic,
  //     and majority only becomes load-bearing at the escape phases. Placeholder: keep
  //     the first-seen value at a given tier (equal non-owner rank → existing stays).
  // Reducer-inert either way: derive() never sees ddjp.media.len.
  // Rank questions go through Capabilities BY NAME — no numeric thresholds here.
  function _ingest(entry) {
    if (!entry || !entry.content) return;
    const v = entry.content.v, d = entry.content.d;
    const rank = typeof entry.senderRank === "number" ? entry.senderRank : 0;  // = channel authority
    if (typeof v !== "string" || typeof d !== "number" || !isFinite(d) || d <= 0) return;
    const prev = _reports[v];
    const isOwner = Capabilities.atLeast(rank, "owner");
    let take = false;
    if (!prev) take = true;
    else if (isOwner) take = true;                 // owner tier → latest wins (replace anything)
    else if (rank > prev.rank) take = true;        // higher non-owner tier beats lower
    // equal/lower non-owner tier → keep existing (first-seen placeholder for majority; TODO)
    if (take) { _reports[v] = { d: d, rank: rank, l: entry.l || 0 }; _notify(); }
  }

  // ── my own player measured a real duration ──────────────────────────────────
  // Called by Playback when the YouTube player reports its duration. This is MY
  // authoritative length; it also seeds the cache and may make me a ladder answerer.
  function recordLocalMeasured(videoId, seconds) {
    if (typeof videoId !== "string") return;
    const s = (typeof seconds === "number" && isFinite(seconds) && seconds > 0)
      ? Math.round(seconds) : null;
    if (s == null) return;
    _localMeasured[videoId] = s;
    // Caching for future sessions is the PLAYER PUSH path's job — interface.js calls
    // MetadataService.recordMeta({ title, durationSec }) when the player reports them.
    // MediaLength does not write the cache itself (it used to call a Store.recordDuration
    // that never existed, so the call was dead as well as redundant).
    _notify();
    // measuring a duration is exactly the moment we might need to answer the ladder
    _maybeScheduleAnswer();
  }

  // ── the resolver: what displayDuration should this client SHOW right now ──────
  // Priority: own measured → cache → ladder-winning peer report → unknown. Clamped.
  // Returns clamped seconds or null. (A lone play-event `dur` claim is a future step.)
  function displayDuration(videoId) {
    if (typeof videoId !== "string") return null;
    if (_localMeasured[videoId] != null) return _clamp(_localMeasured[videoId]);
    // CACHE RUNG — Store.meta's sync RAM mirror (written by the player push path via
    // MetadataService.recordMeta, warmed on any load). A HINT, never truth, so it is
    // clamped like every other source. null here means "not loaded this session", not
    // "unknown length", so we simply fall through to the peer report below.
    try {
      if (typeof Store !== "undefined" && Store.meta && Store.meta.peek) {
        const m = Store.meta.peek(videoId);
        if (m && typeof m.durationSec === "number") return _clamp(m.durationSec);
      }
    } catch (e) {}
    if (_reports[videoId]) return _clamp(_reports[videoId].d);
    return null;
  }

  // The raw own-measured value (UNCLAMPED) — Playback uses this, and ONLY this, for
  // its local wall-clock advance. Never a peer value (a peer value can't move my queue).
  function localMeasuredDuration(videoId) {
    return (typeof videoId === "string" && _localMeasured[videoId] != null)
      ? _localMeasured[videoId] : null;
  }

  // ── the ladder: decide whether/when I should author a ddjp.media.len ──────────
  // My ladder slot comes from my CHANNEL authority, injected by room.js via setMyRank
  // (MatrixBridge.getMyRank(channels)) on enter and on any mid-room rewire. Authority is
  // the channel, not the person — so this is a channel-derived rank, not a user lookup.
  let _injectedRank = null;
  function setMyRank(r) { if (typeof r === "number") _injectedRank = r; }
  function _myRank() { return _injectedRank != null ? _injectedRank : 0; }

  function _delayForRank(rank) {
    const st = (typeof StreamManager !== "undefined" && StreamManager.getState)
      ? (StreamManager.getState().settings || {}) : {};
    return Capabilities.staggerMs(rank, st.vouchJitter, null, (typeof Store !== "undefined" && Store.stagger ? Store.stagger.offsetMs() : 0));
  }

  // Schedule (or reschedule) my answer for the current song. Called on song change
  // and when I measure a duration. On fire, re-checks the rules and may emit once.
  function _maybeScheduleAnswer() {
    const np = StreamManager.getState().nowPlaying;
    if (!np || !np.song || !eventsChannel) return;
    const pi = np.pi, videoId = np.song.videoId, startedAt = np.startedAt || 0;
    // (re)arm only if the song changed or nothing is pending for this pi
    if (_pendingPi === pi && _pendingTimer) return;
    _clearPending();
    _pendingPi = pi;

    const rank = _myRank();
    const myLen = _localMeasured[videoId];
    if (myLen == null) return;                 // I can only answer with my OWN measurement

    // `startedAt` is the play event's SERVER timestamp, so the deadline it anchors must be
    // compared against SERVER time. ServerClock.serverNow() is that clock, reconstructed locally
    // from event timestamps with no extra messages. Using the raw local wall clock here would mix
    // two clocks: a device 30s fast would compute a wait 30s too short and answer immediately,
    // a slow one would wait too long — the exact drift ServerClock exists to remove.
    // Falls back to the local clock only until ServerClock has seen its first event.
    const nowMs = (typeof ServerClock !== "undefined" && ServerClock.serverNow)
      ? ServerClock.serverNow() : Date.now();
    const fireAt = startedAt + _delayForRank(rank);
    const wait = Math.max(0, fireAt - nowMs);
    _pendingTimer = setTimeout(() => { _answerNow(pi, videoId, rank, myLen); }, wait);
  }

  function _answerNow(pi, videoId, myRank, myLen) {
    _clearPending();
    // still the same song?
    const np = StreamManager.getState().nowPlaying;
    if (!np || np.pi !== pi || !np.song || np.song.videoId !== videoId) return;
    // has a HIGHER rank already answered this video?
    const existing = _reports[videoId];
    if (existing && existing.rank > myRank) {
      // defer — UNLESS I strongly disagree (>= DISAGREE_SEC)
      if (Math.abs(existing.d - myLen) < DISAGREE_SEC) return;
    }
    // has an equal-or-higher rank already answered with (nearly) my value? then it's
    // covered; stay silent to avoid an identical duplicate.
    if (existing && existing.rank >= myRank && Math.abs(existing.d - myLen) < DISAGREE_SEC) return;
    // emit one report (reducer-inert)
    // .catch, NOT try/catch. sendEvent is async: it returns a promise and REJECTS rather than
    // throwing, so a try/catch around a call that is not awaited catches nothing at all — it reads
    // as protection while the failure becomes an unhandled rejection. Fire-and-forget is right
    // here (a lost display report costs nothing), but the rejection still has to land somewhere.
    MatrixBridge.sendEvent(eventsChannel, "ddjp.media.len", { v: videoId, d: myLen })
      .catch((e) => Logger && Logger.warn && Logger.warn("MediaLength: emit failed: " + (e && e.message)));
  }

  function _clearPending() {
    if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; }
  }

  // song changed → re-arm the ladder for the new song
  function _onNowPlaying() { _pendingPi = null; _maybeScheduleAnswer(); }

  // ── lifecycle (mirrors Reactions.init/destroy) ───────────────────────────────
  function init(channel) {
    eventsChannel = channel;
    if (!_subscribed) {
      StreamManager.on("ddjp.media.len", _ingest);
      StreamManager.on("ddjp.dj.play", _onNowPlaying);
      StreamManager.on("ddjp.dj.skip", _onNowPlaying);
      // ddjp.media.skip — the availability escape changes the song, so the ladder must re-arm for
      // the new one. The recovery here is quieter than the other two omissions, which is why it
      // survived: _maybeScheduleAnswer re-arms on `_pendingPi !== pi` whenever the player reports
      // a duration, so a SIGHTED client self-corrects. But the escape fires precisely when the
      // room cannot see the song — so the clients it leaves un-re-armed are the ones with no
      // duration to report, which is the population this event exists for.
      StreamManager.on("ddjp.media.skip", _onNowPlaying);
      _subscribed = true;
    }
    _onNowPlaying();
  }
  function destroy() {
    if (_subscribed) {
      StreamManager.off("ddjp.media.len", _ingest);
      StreamManager.off("ddjp.dj.play", _onNowPlaying);
      StreamManager.off("ddjp.dj.skip", _onNowPlaying);
      StreamManager.off("ddjp.media.skip", _onNowPlaying);
      _subscribed = false;
    }
    _clearPending();
    eventsChannel = null;
  }

  return {
    init, destroy, onChange, setMyRank,
    recordLocalMeasured, displayDuration, localMeasuredDuration,
    // exposed for the guard:
    _clamp, _reports, _ingest, _delayForRank,
    FLOOR_SEC, CEILING_SEC, DISAGREE_SEC,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { MediaLength };
