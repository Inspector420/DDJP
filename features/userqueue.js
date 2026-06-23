// features/userqueue.js
// A personal, client-only stack of songs (persisted locally). Add by pasting a
// full YouTube link. While you're "in" the room queue, the stack auto-feeds the
// rotation: it tops your declared buffer up to 2 and refills as your songs play.
// When the stack and buffer are both empty you fall out (HARD): the reducer
// removes you from the rotation and auto-feed switches OFF, so adding more songs
// just stacks them — you re-enter only by an explicit Join. Nothing here touches
// Matrix except via Queue.submitSong/leave.
// Depends on: StreamManager, Queue, MatrixBridge, StorageIO, Logger

const UserQueue = (() => {
  const CAP = 2;   // matches the rotation's per-DJ buffer depth

  let roomKey = null;
  let stack = [];          // [{ videoId, url, title }]
  let active = false;      // are we feeding the room queue?
  let inFlight = [];        // videoIds submitted but not yet seen in our pending
  const _subs = [];
  const _listeners = [];

  const DJ_TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave", "ddjp.dj.play",
    "ddjp.dj.skip", "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.order"
  ];

  function _extractVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.indexOf("youtu.be") >= 0) {
        const seg = u.pathname.slice(1).split("/")[0];
        return seg || null;
      }
      if (u.hostname.indexOf("youtube.com") >= 0) {
        const v = u.searchParams.get("v");
        if (v) return v;
        const parts = u.pathname.split("/").filter(Boolean);
        const si = parts.indexOf("shorts"); if (si >= 0 && parts[si + 1]) return parts[si + 1];
        const ei = parts.indexOf("embed"); if (ei >= 0 && parts[ei + 1]) return parts[ei + 1];
      }
      return null;
    } catch (e) { return null; }
  }

  function _myPendingIds() {
    const me = MatrixBridge.getUserId();
    const s = StreamManager.getState();
    const e = (s.rotation || []).find(r => r.user === me);
    return e ? e.pending.map(p => p.videoId) : [];
  }

  function _reconcile() {
    const pend = _myPendingIds();
    for (const id of pend) {
      const i = inFlight.indexOf(id);
      if (i >= 0) inFlight.splice(i, 1);   // it landed — no longer in flight
    }
  }

  let _pumping = false;
  function _pump() {
    if (!active || _pumping) return;   // submitSong ingests synchronously and
    _pumping = true;                   // re-enters via _onChange; guard against it
    try {
      while (stack.length > 0 && (_myPendingIds().length + inFlight.length) < CAP) {
        const song = stack.shift();
        inFlight.push(song.videoId);
        _persist();
        Queue.submitSong(song.videoId, song.url).catch(() => {
          const i = inFlight.indexOf(song.videoId);
          if (i >= 0) inFlight.splice(i, 1);
          stack.unshift(song);                // put it back on failure
          _persist();
        });
      }
    } finally {
      _pumping = false;
    }
  }

  function _onChange() { _reconcile(); _detectFallout(); _pump(); _notify(); }

  // Hard fall-out (we ran out of buffered songs), or a staff remove/reset,
  // deletes us from the rotation in the reducer. If that happens while auto-feed
  // is on, switch it OFF so that queuing more songs does NOT silently re-join us
  // — after running out, re-entry must be a deliberate Join click. We require
  // inFlight to be empty too: right after a Join our submitted songs sit in
  // inFlight and we aren't visible in the rotation yet, and that transient must
  // not be mistaken for a fall-out. The personal stack is left intact, so a
  // later Join replays it. Must run BEFORE _pump so we don't feed our way back
  // in on the same change.
  function _detectFallout() {
    if (active && inFlight.length === 0 && !amInRotation()) {
      active = false;
      _persist();
    }
  }

  function _persist() {
    if (roomKey) StorageIO.save(roomKey, { stack: stack, active: active });
  }
  function _notify() {
    const snap = { stack: stack.slice(), active: active };
    for (const fn of _listeners) { try { fn(snap); } catch (e) {} }
  }
  function onChange(fn) { if (fn && !_listeners.includes(fn)) _listeners.push(fn); }

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
  }

  function init(spaceId) {
    _cleanup();
    roomKey = "uq_" + spaceId;
    const saved = StorageIO.load(roomKey) || {};
    stack = Array.isArray(saved.stack) ? saved.stack : [];
    active = !!saved.active;
    inFlight = [];
    const handler = () => _onChange();
    for (const t of DJ_TYPES) { StreamManager.on(t, handler); _subs.push([t, handler]); }
    // Do NOT auto-feed here. init runs in the wiring phase, before history
    // replay, when the rotation is still empty — pumping now could fire a live
    // re-join from empty pre-replay state. resync() (called by room.js once
    // replay is done) reconciles `active` to real membership and starts feeding.
    _notify();
  }

  // Called by room.js once history replay is complete (and on fresh create). The
  // rotation now reflects our true current membership and nothing is in flight,
  // so trust it: if we're actually in the rotation, resume auto-feed; otherwise
  // we left or fell out earlier and stay inactive until an explicit Join. This
  // also repairs the rejoin-then-reload case, where per-event fall-out detection
  // during replay would otherwise leave us inactive while we're visibly back in
  // the rotation.
  function resync() {
    inFlight = [];
    active = amInRotation();
    _persist();
    if (active) _pump();
    _notify();
  }

  function destroy() { _cleanup(); roomKey = null; stack = []; inFlight = []; active = false; }

  // --- user actions ---
  function add(url) {
    const id = _extractVideoId(url);
    if (!id) return { ok: false, reason: "not a YouTube link" };
    if (stack.some(s => s.videoId === id) || inFlight.indexOf(id) >= 0 || _myPendingIds().indexOf(id) >= 0) {
      return { ok: false, reason: "already queued" };
    }
    stack.push({ videoId: id, url: url, title: id });
    _persist();
    if (active) _pump();
    _notify();
    return { ok: true, videoId: id };
  }

  function removeAt(i) { if (i >= 0 && i < stack.length) { stack.splice(i, 1); _persist(); _notify(); } }
  function moveUp(i) {
    if (i > 0 && i < stack.length) {
      const t = stack[i]; stack[i] = stack[i - 1]; stack[i - 1] = t; _persist(); _notify();
    }
  }
  function list() { return stack.slice(); }
  function isActive() { return active; }
  // Am I actually present in the live rotation right now? Distinct from
  // isActive() (the local "auto-feed" intent): under hard fall-out a DJ who runs
  // out is removed from the rotation. Since fall-out now also turns auto-feed off
  // (see _detectFallout), these usually move together, but amInRotation reads the
  // shared derived state while isActive is the local toggle.
  function amInRotation() {
    const me = MatrixBridge.getUserId();
    const s = StreamManager.getState();
    return (s.rotation || []).some(r => r.user === me);
  }
  // How many songs are still queued locally to auto-feed into the rotation.
  function stackCount() { return stack.length; }

  // My declared buffer as derived from the rotation — the up-to-2 songs I've
  // committed to the room that will play on my next turns (front = next). This
  // is shared, stream-derived state, distinct from the local stack (list()),
  // which holds songs not yet declared. Returns [{ videoId, videoUrl }].
  function declared() {
    const me = MatrixBridge.getUserId();
    const s = StreamManager.getState();
    const e = (s.rotation || []).find(r => r.user === me);
    return e ? e.pending.slice() : [];
  }
  // Move one of my declared songs to the front so it plays next. Emits
  // ddjp.dj.order via Queue (the only way UserQueue touches the room). The
  // reducer applies it in sorted order, so the result is identical for me and
  // everyone — including a last-second change that races an advance.
  function promote(videoId) {
    const cur = declared().map(s => s.videoId);
    const at = cur.indexOf(videoId);
    if (at <= 0) return;   // not in my buffer, or already next
    const order = [videoId].concat(cur.filter(v => v !== videoId));
    Queue.reorder(order);
  }

  function joinRoomQueue() { active = true; _persist(); _pump(); _notify(); }
  async function leaveRoomQueue() {
    active = false; _persist(); _notify();
    try { await Queue.leave(); } catch (e) { Logger.warn("UserQueue: leave failed: " + e.message); }
  }

  return { init, destroy, onChange, resync, add, removeAt, moveUp, list, isActive, amInRotation, stackCount, declared, promote, joinRoomQueue, leaveRoomQueue };
})();
