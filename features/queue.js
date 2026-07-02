// features/queue.js
// The room queue = the DJ rotation. Reads { nowPlaying, rotation } from the
// stream and emits the ddjp.dj.* events. Every send goes to the highest-rank
// channel we can write to (room.js passes it in), so the event carries our rank
// via channel origin. Move/remove/reset are rank-gated in the reducer.
// Depends on: StreamManager, StateDeriver, MatrixBridge, Logger

const Queue = (() => {
  let eventsChannel = null;
  const _subs = [];
  const _stateListeners = [];

  const TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave",
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.dj.move",
    "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.order", "ddjp.dj.undeclare"
  ];

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
  }

  function init(channel) {
    _cleanup();
    eventsChannel = channel;
    const notify = () => _notify();
    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }
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
  // Newest-first (optionally limited) play history for display. Pure projection
  // delegated to StateDeriver; the UI calls this, never StateDeriver directly.
  function recentHistory(limit) {
    return StateDeriver.projectHistory(getHistory(), (typeof limit === "number") ? { limit: limit } : {});
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
  async function submitSong(videoId, url) {
    if (!eventsChannel || !videoId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.join", { v: videoId, u: url || null });
  }
  async function join() {
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.join", {});
  }
  async function leave() {
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.leave", {});
  }
  async function move(userId, afterUserId) {
    if (!eventsChannel || !userId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.move", { x: userId, after: afterUserId || null });
  }
  async function remove(userId) {
    if (!eventsChannel || !userId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.remove", { x: userId });
  }
  async function reset() {
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.reset", {});
  }
  // Reorder MY declared buffer. videoIds is the desired order (front = next to
  // play). The reducer applies it in sorted order, so the outcome is consensus.
  async function reorder(videoIds) {
    if (!eventsChannel || !Array.isArray(videoIds) || videoIds.length === 0) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.order", { o: videoIds.slice() });
  }
  // Remove ONE song from MY OWN declared buffer WITHOUT playing it (ddjp.dj.undeclare).
  // Sender-only (the reducer gates it to the sender's own buffer, no rank needed);
  // the reducer is total (unknown/already-played id is a no-op) and converges. This
  // is the "take a declared song back off the room queue" primitive (14 §4b) — NOT a
  // skip (the now-playing song is never in a buffer).
  async function undeclare(videoId) {
    if (!eventsChannel || !videoId) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.undeclare", { v: videoId });
  }

  return {
    init, destroy, onStateChange,
    getState, getRotation, getNowPlaying, getHistory, recentHistory, myId, myPending, amIIn,
    submitSong, join, leave, move, remove, reset, reorder, undeclare
  };
})();
