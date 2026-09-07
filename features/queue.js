// features/queue.js
// The room queue = the DJ rotation. Reads { nowPlaying, rotation } from the
// stream and emits the ddjp.dj.* events. Every send goes to the highest-rank
// channel we can write to (room.js passes it in), so the event carries our rank
// via channel origin. Move/remove/reset are rank-gated in the reducer.
// Depends on: StreamManager, MatrixBridge, Logger

const Queue = (() => {
  let eventsChannel = null;
  const _subs = [];
  const _stateListeners = [];
  // Advisory strike cooldown (display-level, reducer-inert): server ts of the last
  // ddjp.dj.strike per TARGET DJ. The UI greys that DJ's remove-song button until
  // ServerClock.serverNow() >= ts + STRIKE_COOLDOWN_MS. The reducer never reads this —
  // it's timing/UX only, so it can't affect derived truth (no wall-clock in derive).
  const _lastStrikeTs = Object.create(null);
  const STRIKE_COOLDOWN_MS = 3000;

  // ddjp.media.skip advances the room like any other advance; leaving it out meant the panel did
  // not repaint when the availability escape fired, so the queue showed a song that had already
  // ended. Same omission Playback had on its own list.
  const TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave",
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip", "ddjp.dj.move",
    "ddjp.dj.remove", "ddjp.dj.strike", "ddjp.dj.reset", "ddjp.dj.order", "ddjp.dj.undeclare",
    // Count-affecting (derived into state.counts): a remote vote/save/owner-set must
    // notify state listeners too, so the ★/▲ counts repaint without the local user acting.
    "ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set"
  ];

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
  }

  function init(channel) {
    _cleanup();
    eventsChannel = channel;
    for (const k in _lastStrikeTs) delete _lastStrikeTs[k];   // per-room cooldown state
    const notify = () => _notify();
    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }
    // Record the last strike's server ts per target DJ (advisory UI cooldown; reducer-inert).
    const onStrike = (e) => { const x = e && e.content && e.content.x; if (x) _lastStrikeTs[x] = (typeof e.ts === "number" ? e.ts : 0); };
    StreamManager.on("ddjp.dj.strike", onStrike); _subs.push(["ddjp.dj.strike", onStrike]);
    Logger.debug("Queue: init on " + channel);
  }

  function destroy() { _cleanup(); eventsChannel = null; }

  function onStateChange(fn) { if (fn && !_stateListeners.includes(fn)) _stateListeners.push(fn); }
  function _notify() {
    const s = StreamManager.getState();
    for (const fn of _stateListeners) { try { fn(s); } catch (e) { Logger.warn("Queue sub: " + e.message); } }
  }

  // --- reads ---
  function getState() { return StreamManager.getState(); }
  function getRotation() { return StreamManager.getState().rotation || []; }
  function getNowPlaying() { return StreamManager.getState().nowPlaying || null; }
  // The derived room play-history (oldest→newest, bounded; see StateDeriver). The
  // UI orders/limits it for display via recentHistory() — it must not reach into
  // StateDeriver itself (ui → feature → core boundary), so the projection lives
  // here in the feature layer.
  function getHistory() { return StreamManager.getState().history || []; }
  // Newest-first (optionally limited) play history for display. Pure projection,
  // delegated through the backend interface (StreamManager) — the app never
  // reaches into StateDeriver, a backend internal (check-boundaries).
  // How much of the room the history actually accounts for. Delegated for the same reason
  // recentHistory is: `History` is a backend module and ui/ may only reach a feature.
  function historyReach() {
    try {
      if (typeof MatrixBridge !== "undefined" && MatrixBridge.historyCoverage) {
        return MatrixBridge.historyCoverage();
      }
    } catch (e) {}
    return null;
  }

  function recentHistory(limit) {
    // ── READ THE MODULE THAT KEEPS ITS OWN LIST, NOT THE LIVE FOLD ──────────────────────────
    // The fold's history is deliberately not seeded from a checkpoint, so once a client trims to
    // its floor the fold's list restarts there and the pane empties. `History` accumulates instead
    // and can page back past the floor, which is the whole reason it was separated.
    try {
      if (typeof MatrixBridge !== "undefined" && MatrixBridge.roomHistory) {
        const rows = MatrixBridge.roomHistory(limit);
        if (Array.isArray(rows)) return rows;
      }
    } catch (e) {}
    return [];
  }

  function myId() { return MatrixBridge.getUserId(); }
  function myPending() {
    const me = myId();
    const e = getRotation().find(r => r.user === me);
    return e ? e.pending : [];
  }
  function amIIn() { return myPending().length > 0; }

  // --- actions ---
  // submitSong = join with a song. Works whether or not we're already a member,
  // so the personal queue can feed songs in without tracking membership.
  // ── DO NOT SPEAK BEFORE YOU KNOW WHERE THE ROOM IS ──────────────────────────────────────
  // ONE HELPER, EVERY SENDER. This began as a check inside submitSong alone, and that was not
  // enough: the reconcile also calls undeclare and reorder, so the same window stayed open behind
  // two other doors. A room still diverged on reload with only submitSong gated — the advance
  // chain agreed (both clients moved to the next song together) while the ROTATION did not, which
  // is the signature of one client holding queue events the other refused.
  //
  // The queue reconciles against derived state, so on a reload it sees its songs "missing" while
  // replay is still running and tries to correct the room. Those sends carry positions below the
  // room's head: the sender accepts them (its own head is legitimately low at that instant) and
  // everyone else refuses them as backdated.
  //
  // Gating one call is the bug this codebase keeps repeating — a rule reached by SOME of the paths
  // that need it. Anything here that writes to the room asks first.
  function _mayWrite(what) {
    try {
      if (typeof MatrixBridge.mayAuthor !== "function") return { ok: true };
      const fit = MatrixBridge.mayAuthor();
      if (fit && fit.ok === false) {
        Logger.info("Queue: not sending " + what + " yet — " + fit.reason + "; will retry when live");
        return { ok: false, reason: fit.reason, retrying: true };
      }
    } catch (e) { /* unknown is not a no */ }
    return { ok: true };
  }

  async function submitSong(videoId, url) {
    { const w = _mayWrite("a song"); if (!w.ok) return w; }
    if (!eventsChannel || !videoId) return;
    // URL CANONICALIZATION (docs/consensus/consensus-models.md, tidy task (a)): the on-wire `u` is ALWAYS
    // the canonical watch URL derived purely from the (already-validated) video id — never the
    // raw pasted string. This makes `u` a pure function of `v`, so a witness's compact record
    // can drop it and rebuild it byte-for-byte (Vouch). The only thing discarded is a
    // pasted `?t=` timestamp the app never reads. `url` stays in the signature for callers but
    // is intentionally unused. Unconditional: every room this app creates canonicalises.
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.join", { v: videoId, u: PlaylistDoc.watchUrl(videoId) });
  }
  async function join() {
    { const w = _mayWrite("a join"); if (!w.ok) return w; }
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.join", {});
  }
  async function leave() {
    { const w = _mayWrite("a leave"); if (!w.ok) return w; }
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.leave", {});
  }
  async function move(userId, afterUserId) {
    { const w = _mayWrite("a move"); if (!w.ok) return w; }
    if (!eventsChannel || !userId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.move", { x: userId, after: afterUserId || null });
  }
  async function remove(userId) {
    { const w = _mayWrite("a remove"); if (!w.ok) return w; }
    if (!eventsChannel || !userId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.remove", { x: userId });
  }
  // Strike ONE specific declared song from a target DJ's buffer (ddjp.dj.strike) — the
  // moderator counterpart to undeclare. Staff+ / rank-blind, gated in the reducer. Total:
  // an unknown target or a videoId not in their buffer is a clean no-op.
  async function strike(userId, videoId) {
    { const w = _mayWrite("a strike"); if (!w.ok) return w; }
    if (!eventsChannel || !userId || !videoId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.strike", { x: userId, v: videoId });
  }
  // Advisory strike cooldown (display-level): the server ts of the last strike against
  // `userId` (0 if none). The UI greys that DJ's remove-song button until
  // ServerClock.serverNow() >= this + STRIKE_COOLDOWN_MS. Never read by the reducer.
  function lastStrikeTs(userId) { return _lastStrikeTs[userId] || 0; }
  async function reset() {
    { const w = _mayWrite("a reset"); if (!w.ok) return w; }
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.reset", {});
  }
  // Reorder MY declared buffer. videoIds is the desired order (front = next to
  // play). The reducer applies it in sorted order, so the outcome is consensus.
  async function reorder(videoIds) {
    { const w = _mayWrite("a reorder"); if (!w.ok) return w; }
    if (!eventsChannel || !Array.isArray(videoIds) || videoIds.length === 0) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.order", { o: videoIds.slice() });
  }
  // Remove ONE song from MY OWN declared buffer WITHOUT playing it (ddjp.dj.undeclare).
  // Sender-only (the reducer gates it to the sender's own buffer, no rank needed);
  // the reducer is total (unknown/already-played id is a no-op) and converges. This
  // is the "take a declared song back off the room queue" primitive (14 §4b) — NOT a
  // skip (the now-playing song is never in a buffer).
  async function undeclare(videoId) {
    { const w = _mayWrite("an undeclare"); if (!w.ok) return w; }
    if (!eventsChannel || !videoId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.undeclare", { v: videoId });
  }

  return {
    init, destroy, onStateChange,
    getState, getRotation, getNowPlaying, getHistory, recentHistory, historyReach, myId, myPending, amIIn,
    submitSong, join, leave, move, remove, strike, reset, reorder, undeclare,
    lastStrikeTs, STRIKE_COOLDOWN_MS
  };
})();
