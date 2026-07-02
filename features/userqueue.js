// features/userqueue.js
// A personal, client-only list of songs (persisted locally) — your "intent". Add by
// pasting a full YouTube link. `intent` is ONE ordered list of ALL your songs; its top
// CAP entries are the ones that should be declared to the room. While you're active,
// _reconcile keeps the room's declared buffer matching intent's top CAP: it declares
// what's missing, undeclares what you removed, and reorders when the arrangement
// changed. Movement/remove are pure-local reorders of intent that then poke reconcile.
//
// SAFE-DROP INVARIANT (the rule that stops songs vanishing): a song leaves `intent`
// ONLY when (a) you explicitly remove it, or (b) that exact entry actually played. NOT
// on a kick, a mod remove, a self-leave, a network blip, or a reconcile — in all those
// the song just goes back to un-declared and STAYS in intent. Drop is keyed on a local
// entry-id (`eid`) bound to the declared head that advanced — NEVER "a song with this
// videoId played" — so duplicates and recently-played repeats can't drop the wrong one.
//
// Nothing here touches Matrix except via Queue.submitSong/undeclare/reorder/leave.
// Depends on: StreamManager, Queue, MatrixBridge, Store, Logger

const UserQueue = (() => {
  const CAP = 2;   // matches the rotation's per-DJ buffer depth
  const QUEUE_MAX = 5000;   // fill-then-refuse ceiling — a full add is rejected, never dropping what's already queued (mirrors the playlist cap)

  let roomSpaceId = null;   // the space this personal queue belongs to (Store.queue key owner)
  let _loadGen = 0;         // bumped each init; a late async hydrate for a stale room is ignored
  let _dirty = false;       // set once intent is edited; a late hydrate must not clobber edits
  let intent = [];          // [{ eid, videoId, url, title }] — the ONE local list
  let active = false;       // are we participating (feeding the room queue)?
  let inFlight = [];        // videoIds we've submitted (declare) but not yet seen land
  let _pendingRemovals = [];// videoIds we've undeclared but not yet seen leave declared()
  let _reconciling = false; // guards absorb/emit/fallout against synchronous re-entrancy
  let _live = false;        // false until resync() (post history-replay): don't absorb historical plays
  let _lastPi = null;       // play-index we've already accounted for (dedupe a play)
  let _boundHeadEid = null; // the eid currently bound to declared[0] — what safe-drop drops on a play
  let _lastDeclared = {};   // videoId -> count last seen declared; a rise = a declare landed, a fall = an undeclare landed (duplicate-safe by delta)
  const DEBOUNCE_MS = 5000; // settle window: after your last top-2 edit, wait this long, then send ONE reconcile
  let _timer = null;        // the pending settle timer (via _clock), or null
  let _settleAt = 0;        // wall-clock deadline of the running settle timer (0 = none); lets the UI resume the countdown bar instead of restarting it
  let _lastTopSig = "";     // identity (eids) of the top-CAP window the current timer is settling; an edit BELOW the window leaves this unchanged, so it won't restart the countdown
  // Injectable clock so the settle timer is deterministic in tests (the guard fast-
  // forwards instead of really sleeping). Production uses real timers + wall-clock.
  // `now` is display-only (drives the countdown-bar resume math) — never consensus —
  // so wall-clock is fine here, like ids/createdAt elsewhere. Optional: a guard clock
  // without a `now` transparently falls back to Date.now (it never reads the bar).
  let _clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
  function _now() { return (_clock && typeof _clock.now === "function") ? _clock.now() : Date.now(); }
  let _seq = 0;             // entry-id counter
  const _listeners = [];
  const _subs = [];

  function _eid() { return "e" + Date.now().toString(36) + "_" + (++_seq); }

  const DJ_TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave", "ddjp.dj.play",
    "ddjp.dj.skip", "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.order",
    "ddjp.dj.undeclare"
  ];

  // A YouTube id is exactly 11 chars of [A-Za-z0-9_-]. Trim at the first non-id
  // character (drops copy-paste junk) and require an exact 11-char match.
  function _cleanId(s) {
    if (!s) return null;
    const clean = String(s).replace(/[^A-Za-z0-9_-].*$/, "");
    return /^[A-Za-z0-9_-]{11}$/.test(clean) ? clean : null;
  }
  function _extractVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.indexOf("youtu.be") >= 0) {
        const seg = u.pathname.slice(1).split("/")[0];
        return _cleanId(seg);
      }
      if (u.hostname.indexOf("youtube.com") >= 0) {
        const v = u.searchParams.get("v");
        if (v) return _cleanId(v);
        const parts = u.pathname.split("/").filter(Boolean);
        const si = parts.indexOf("shorts"); if (si >= 0 && parts[si + 1]) return _cleanId(parts[si + 1]);
        const ei = parts.indexOf("embed"); if (ei >= 0 && parts[ei + 1]) return _cleanId(parts[ei + 1]);
      }
      return null;
    } catch (e) { return null; }
  }

  // --- derived reads (shared, stream-derived truth) ---
  function _me() { return MatrixBridge.getUserId(); }
  function _rotEntry() { const s = StreamManager.getState(); return (s.rotation || []).find(r => r.user === _me()); }
  function _declaredIds() { const e = _rotEntry(); return e ? e.pending.map(p => p.videoId) : []; }
  function declared() { const e = _rotEntry(); return e ? e.pending.slice() : []; }   // [{ videoId, videoUrl }]
  function amInRotation() { return !!_rotEntry(); }
  function _nowPlaying() { return StreamManager.getState().nowPlaying; }
  function _amNowPlaying() { const np = _nowPlaying(); return !!(np && np.dj === _me()); }

  // --- small multiset helpers (duplicates are allowed in intent now) ---
  function _countIn(arr, id) { let n = 0; for (const x of arr) if (x === id) n++; return n; }
  function _countBy(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return m; }
  function _pull(arr, id) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); }

  // Declared count for capacity, discounting copies we've undeclared but not yet seen leave.
  function _effectiveDeclaredCount() {
    const have = _declaredIds();
    if (!_pendingRemovals.length) return have.length;
    const pr = _pendingRemovals.slice(); let n = 0;
    for (const id of have) { const j = pr.indexOf(id); if (j >= 0) pr.splice(j, 1); else n++; }
    return n;
  }

  // Reconcile in-flight bookkeeping against reality. Attribute each per-videoId change
  // in the declared buffer to a landed operation: a COUNT RISE means a declare landed
  // (clear that many from inFlight), a FALL means an undeclare (or a play) landed (clear
  // that many from pendingRemovals). Delta-based, so duplicate videoIds never leave a
  // stale token — the flaw that a membership test has once two copies of one id exist.
  // Runs on EVERY change (even re-entrant), so a synchronous ingest frees capacity for
  // the rest of an in-progress reconcile.
  function _clearLanded() {
    const cur = _countBy(_declaredIds());
    const seen = {};
    for (const v in cur) seen[v] = 1;
    for (const v in _lastDeclared) seen[v] = 1;
    for (const v in seen) {
      const delta = (cur[v] || 0) - (_lastDeclared[v] || 0);
      if (delta > 0) { for (let k = 0; k < delta; k++) _pull(inFlight, v); }
      else if (delta < 0) { for (let k = 0; k < -delta; k++) _pull(_pendingRemovals, v); }
    }
    _lastDeclared = cur;
  }

  // SAFE-DROP. When MY declared head genuinely plays (a new nowPlaying.pi, dj===me,
  // and the played videoId matches the entry currently bound to the head), drop THAT
  // entry from intent — by eid, so a duplicate or a recent repeat can't be mistaken
  // for it. When anything is uncertain, keep the song (never lose one). Returns true
  // if it dropped an entry. Before _live (history replay), it only advances _lastPi.
  function _absorbPlays() {
    const np = _nowPlaying();
    if (!np || np.dj !== _me()) return false;
    if (np.pi === _lastPi) return false;                 // already accounted for this play
    const played = np.song ? np.song.videoId : null;
    if (!_live) { _lastPi = np.pi; return false; }        // replay: track, don't drop
    let dropped = false;
    if (_boundHeadEid) {
      const e = intent.find(x => x.eid === _boundHeadEid);
      if (e && e.videoId === played) {
        const i = intent.findIndex(x => x.eid === _boundHeadEid);
        if (i >= 0) { intent.splice(i, 1); dropped = true; }
      }
    }
    _lastPi = np.pi; _boundHeadEid = null;
    return dropped;
  }

  // THE reconciler. Make the room's declared buffer equal intent's top CAP, minimal
  // emits: undeclare surplus copies, declare the deficit (respecting capacity), and
  // spend an `order` only when the arrangement actually differs from the natural
  // post-declare order. Count-based throughout, so duplicate videoIds are handled.
  function _emitDiff() {
    const wantEntries = intent.slice(0, CAP);
    const wantIds = wantEntries.map(e => e.videoId);
    // 1) undeclare surplus copies I no longer want
    {
      const have = _declaredIds();
      const wc = _countBy(wantIds), hc = _countBy(have);
      for (const id in hc) {
        let surplus = hc[id] - (wc[id] || 0) - _countIn(_pendingRemovals, id);
        while (surplus-- > 0) {
          _pendingRemovals.push(id);
          Promise.resolve(Queue.undeclare(id)).catch(() => _pull(_pendingRemovals, id));
        }
      }
    }
    // 2) declare the deficit, respecting buffer capacity
    for (const e of wantEntries) {
      const have = _declaredIds();
      const need = _countIn(wantIds, e.videoId);
      const present = _countIn(have, e.videoId) + _countIn(inFlight, e.videoId);
      if (present >= need) continue;
      if (_effectiveDeclaredCount() + inFlight.length >= CAP) break;
      inFlight.push(e.videoId);
      Promise.resolve(Queue.submitSong(e.videoId, e.url)).catch(() => _pull(inFlight, e.videoId));
    }
    // 3) pin the order only if it differs from the natural arrangement — and ONLY over
    // songs actually PRESENT IN THE BUFFER. `covered` is checked against `have` (the
    // declared/pending buffer), NOT have+inFlight: an `order` event can only reorder songs
    // that are in the buffer, so a wanted song still in flight (submitted, not yet landed)
    // must be waited on, not "ordered". Using inFlight here caused a catastrophic loop —
    // covered would be true via a stuck in-flight song while `seq` (read from the buffer)
    // could never match it, so step 3 emitted `order` forever; with a starving buffer
    // _onChange re-fired _emitDiff on every echo, flooding the room. Ordering only what's in
    // the buffer converges in one event and can never loop; songs order when they land.
    if (wantIds.length > 1) {
      const have = _declaredIds();
      const pool = _countBy(have);
      const wc = _countBy(wantIds);
      let covered = true;
      for (const id in wc) { if ((pool[id] || 0) < wc[id]) { covered = false; break; } }
      if (covered) {
        const seq = have.slice(0, wantIds.length);
        const same = seq.length === wantIds.length && seq.every((id, i) => id === wantIds[i]);
        if (!same) Queue.reorder(wantIds);
      }
    }
  }

  // Bind the eid of intent[0] to the declared head when they match — this is what a
  // later play drops. Null when the head isn't (yet) confirmed as our intent[0].
  function _rebindHead() {
    const have = _declaredIds();
    _boundHeadEid = (intent[0] && have[0] === intent[0].videoId) ? intent[0].eid : null;
  }

  // Fall-out: our buffer emptied and nothing is in flight and we're not in the
  // rotation — either we ran dry or a staff action removed us. Turn participation OFF
  // (re-entry is a deliberate Join) but LEAVE intent intact, so the songs survive.
  function _detectFallout() {
    if (active && inFlight.length === 0 && _pendingRemovals.length === 0 && !amInRotation()) {
      active = false; _persist();
    }
  }

  // Would filling the buffer right now be URGENT — i.e. the room has nothing of mine to
  // play and I have a song to give? That's the one case the settle timer must NOT delay
  // (never starve the rotation; keep Join instant). Everything else can wait to settle.
  function _bufferStarving() { return active && intent.length > 0 && _declaredIds().length === 0; }

  // Run the full reconcile now (declare/undeclare/order to match intent's top two).
  function _reconcileNow() {
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    if (_reconciling) return;
    _reconciling = true;
    try { if (active) _emitDiff(); _rebindHead(); _detectFallout(); }
    finally { _reconciling = false; }
  }

  // Identity of the top-CAP window, by eid in order. Adding / removing / reordering
  // entries BELOW the window leaves this string unchanged, so such an edit must not
  // restart the settle countdown; a change to a top-CAP slot does.
  function _topSig() {
    let s = "";
    for (let i = 0; i < Math.min(CAP, intent.length); i++) s += intent[i].eid + "|";
    return s;
  }

  // Debounce: after the last TOP-CAP edit, wait DEBOUNCE_MS then reconcile ONCE. A
  // below-CAP edit (add/remove/reorder outside the top two) leaves the top-CAP identity
  // unchanged and must NOT restart a countdown already in flight — otherwise queuing a
  // song at the bottom would visibly reset the plays-next slot's progress bar. No-op
  // when inactive. (We always schedule on a real top-CAP change even if it looks
  // already-settled: shrinking intent leaves a SURPLUS the settle must undeclare, which
  // a "nothing pending" shortcut would miss — the emit is what falls you out.)
  function _scheduleReconcile() {
    if (!active) {
      if (_timer !== null) { _clock.clear(_timer); _timer = null; }
      _settleAt = 0; _lastTopSig = _topSig();
      return;
    }
    const sig = _topSig();
    // Same top-CAP window as the running timer → leave its countdown alone.
    if (_timer !== null && sig === _lastTopSig) return;
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    _lastTopSig = sig;
    _settleAt = _now() + DEBOUNCE_MS;
    _timer = _clock.set(() => {
      _timer = null; _settleAt = 0;
      if (_reconciling) return;
      _reconciling = true;
      try { _emitDiff(); _rebindHead(); _detectFallout(); } finally { _reconciling = false; }
      _notify();
    }, DEBOUNCE_MS);
  }

  // Stream-driven change (an event landed). Always reconcile bookkeeping; then, guarded,
  // absorb a play and rebind/detect-fallout. A play's slot-2 REFILL is debounced (the new
  // song counts down) — except when the buffer is starving, which fills immediately.
  function _onChange() {
    _clearLanded();
    if (_reconciling) return;         // a re-entrant landing during our own reconcile — bookkeeping only, no re-render (the outer call notifies once at the end; avoids a flash storm)
    _reconciling = true;
    let changed = false;
    try {
      changed = _absorbPlays();       // may shrink intent (a genuine play)
      if (_bufferStarving()) _emitDiff();   // urgent: never leave the room with nothing to play
      _rebindHead();
      _detectFallout();
    } finally { _reconciling = false; }
    if (changed) _persist();          // only a play mutated intent — persist that
    _scheduleReconcile();             // settle the non-urgent remainder (slot-2 refill, etc.)
    _notify();
  }

  // A local intent edit (add/remove/reorder/join). Fill immediately only if that would
  // otherwise starve the room; otherwise start the settle timer so rapid edits batch.
  function _kick() {
    if (_reconciling) return;
    _reconciling = true;
    try { if (_bufferStarving()) _emitDiff(); _rebindHead(); _detectFallout(); }
    finally { _reconciling = false; }
    _scheduleReconcile();
    _notify();
  }

  function _persist() {
    _dirty = true;
    if (roomSpaceId) Store.queue.persist(roomSpaceId, { intent: intent, active: active });
  }
  function _notify() {
    const snap = { items: intent.slice(), active: active };
    for (const fn of _listeners) { try { fn(snap); } catch (e) {} }
  }
  function onChange(fn) { if (fn && !_listeners.includes(fn)) _listeners.push(fn); }

  function _cleanup() { for (const s of _subs) StreamManager.off(s[0], s[1]); _subs.length = 0; }

  function init(spaceId) {
    _cleanup();
    roomSpaceId = spaceId;
    intent = []; active = false; _dirty = false;
    inFlight = []; _pendingRemovals = []; _reconciling = false;
    _live = false; _lastPi = null; _boundHeadEid = null; _lastDeclared = {};
    _settleAt = 0; _lastTopSig = "";
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    const gen = ++_loadGen;
    // Hydrate the saved list asynchronously. Apply ONLY if still the current room and
    // nothing has been edited/loaded meanwhile. Migrates the old { stack } shape.
    Promise.resolve(Store.queue.load(spaceId)).then((saved) => {
      if (gen !== _loadGen || _dirty || intent.length || active) return;
      if (saved && Array.isArray(saved.intent)) {
        intent = saved.intent.map(e => ({ eid: e.eid || _eid(), videoId: e.videoId, url: e.url, title: e.title || e.videoId }));
        active = !!saved.active; _notify();
      } else if (saved && Array.isArray(saved.stack)) {   // migrate legacy { stack, active }
        intent = saved.stack.map(s => ({ eid: _eid(), videoId: s.videoId, url: s.url, title: s.title || s.videoId }));
        active = !!saved.active; _notify();
      }
    }).catch(() => {});
    const handler = () => _onChange();
    for (const t of DJ_TYPES) { StreamManager.on(t, handler); _subs.push([t, handler]); }
    // Don't reconcile here: init runs pre-replay with an empty rotation. resync() does
    // it once replay is done and membership is real.
    _notify();
  }

  // Called by room.js once history replay is complete. Trust the derived rotation now:
  // resume participation iff we're actually in it, sync the play cursor so the current
  // song isn't mistaken for a fresh play, go _live, and reconcile.
  function resync() {
    inFlight = []; _pendingRemovals = []; _reconciling = false;
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    _settleAt = 0; _lastTopSig = "";
    _lastDeclared = _countBy(_declaredIds());
    active = amInRotation();
    const np = _nowPlaying(); _lastPi = np ? np.pi : null;
    _live = true;
    _persist();
    _reconciling = true;
    try { if (active) _emitDiff(); _rebindHead(); } finally { _reconciling = false; }
    _notify();
  }

  function destroy() {
    _cleanup(); roomSpaceId = null;
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    _settleAt = 0; _lastTopSig = "";
    intent = []; inFlight = []; _pendingRemovals = [];
    _reconciling = false; _live = false; _lastPi = null; _boundHeadEid = null; _lastDeclared = {}; active = false;
  }

  // Test hook: swap in a deterministic clock so the settle timer can be fast-forwarded.
  function setClock(c) { if (c && typeof c.set === "function" && typeof c.clear === "function") _clock = c; }

  // --- user actions ---
  function add(url) {
    const id = _extractVideoId(url);
    if (!id) return { ok: false, reason: "not a YouTube link" };
    // Fill, then refuse — a full queue rejects new songs and keeps everything it has.
    if (intent.length >= QUEUE_MAX) return { ok: false, reason: "queue is full (" + QUEUE_MAX + " max)" };
    // Duplicates are allowed now (each is its own entry with its own eid).
    intent.push({ eid: _eid(), videoId: id, url: url, title: id });
    // Auto-rejoin: if participation went off but MY song is the one currently playing,
    // adding should put us back in (as if Join were pressed) — local flag only.
    if (!active && _amNowPlaying()) active = true;
    _persist(); _kick();
    return { ok: true, videoId: id };
  }

  // All movement/remove are pure-local reorders of intent by ABSOLUTE index, then a
  // reconcile. Crossing into or out of the top-CAP window simply changes what's wanted.
  function removeAt(i) { if (i >= 0 && i < intent.length) { intent.splice(i, 1); _persist(); _kick(); } }
  function moveUp(i) { if (i > 0 && i < intent.length) { const t = intent[i]; intent[i] = intent[i - 1]; intent[i - 1] = t; _persist(); _kick(); } }
  function moveDown(i) { if (i >= 0 && i < intent.length - 1) { const t = intent[i]; intent[i] = intent[i + 1]; intent[i + 1] = t; _persist(); _kick(); } }
  function moveToTop(i) { if (i > 0 && i < intent.length) { const s = intent.splice(i, 1)[0]; intent.unshift(s); _persist(); _kick(); } }
  function moveToBottom(i) { if (i >= 0 && i < intent.length - 1) { const s = intent.splice(i, 1)[0]; intent.push(s); _persist(); _kick(); } }

  function joinRoomQueue() { active = true; _persist(); _kick(); }
  async function leaveRoomQueue() {
    active = false;
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    _persist(); _notify();                       // intent is kept — leaving never loses songs
    try { await Queue.leave(); } catch (e) { Logger.warn("UserQueue: leave failed: " + e.message); }
  }
  // Empty the WHOLE list in one go (the "Clear my queue" button, behind a confirm in
  // the UI). A deliberate wipe: reconcile IMMEDIATELY (don't sit on the settle timer)
  // so everything undeclares and we fall out at once. Intent is the only thing cleared.
  function clearQueue() { intent = []; _persist(); _reconcileNow(); _notify(); }

  // --- reads for the UI ---
  function items() { return intent.slice(); }                 // the whole list [{ eid, videoId, url, title }]
  function list() { return intent.slice(CAP); }               // compat: entries below the declared window
  function isActive() { return active; }
  function count() { return intent.length; }
  // Songs not currently confirmed-declared (drives the Join button's "have something to play").
  function stackCount() {
    const have = _declaredIds().slice(); let declaredHere = 0;
    for (let i = 0; i < Math.min(CAP, intent.length); i++) {
      const j = have.indexOf(intent[i].videoId);
      if (j >= 0) { have.splice(j, 1); declaredHere++; }
    }
    return intent.length - declaredHere;
  }
  // The commit-bar state for row i (top CAP only). MEMBERSHIP-based, not position-based:
  // a song already in the room's declared buffer is 'green' WHEREVER it sits, so a play
  // that slides slot-2 up to slot-1, or a manual reorder of two declared songs, never
  // restarts a countdown on a song that's already submitted — only its ORDER is pending,
  // which is not a "loading" state. A song not yet in the buffer is 'pending' (awaiting
  // its debounced submit) or 'sent' (its declare is in flight). Matched copies are
  // consumed left→right so duplicates resolve per-copy (a 2nd copy of a song declared
  // once is still pending until its own declare lands). This mirrors stackCount()'s
  // multiset accounting, so the bar and the Join button agree on what's "submitted".
  function slotState(i) {
    const cap = Math.min(CAP, intent.length);
    if (i < 0 || i >= cap) return null;
    const dec = _declaredIds().slice();
    const flight = inFlight.slice();
    let verdict = "pending";
    for (let k = 0; k <= i; k++) {
      const vid = intent[k].videoId;
      let s;
      const dj = dec.indexOf(vid);
      if (dj >= 0) { dec.splice(dj, 1); s = "green"; }
      else { const fj = flight.indexOf(vid); if (fj >= 0) { flight.splice(fj, 1); s = "sent"; } else s = "pending"; }
      if (k === i) verdict = s;
    }
    return verdict;
  }
  // How far (ms) the current settle countdown has already run, 0..DEBOUNCE_MS. The UI
  // uses this to RESUME a 'pending' commit bar (negative animation-delay) instead of
  // restarting it from zero on a re-render, so an unrelated edit can't reset its progress.
  function settleElapsedMs() {
    if (!_settleAt) return 0;
    const elapsed = DEBOUNCE_MS - (_settleAt - _now());
    return elapsed <= 0 ? 0 : (elapsed >= DEBOUNCE_MS ? DEBOUNCE_MS : elapsed);
  }

  return {
    init, destroy, onChange, resync, setClock,
    add, removeAt, moveUp, moveDown, moveToTop, moveToBottom,
    joinRoomQueue, leaveRoomQueue, clearQueue,
    items, list, isActive, count, stackCount, amInRotation, declared, slotState, settleElapsedMs
  };
})();
