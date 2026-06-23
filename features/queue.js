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

  const TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave",
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.dj.move",
    "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.order"
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

  return {
    init, destroy, onStateChange,
    getState, getRotation, getNowPlaying, myId, myPending, amIIn,
    submitSong, join, leave, move, remove, reset, reorder
  };
})();
