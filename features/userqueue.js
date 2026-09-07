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
  let _evicted = false;     // a mod removed me / reset the room since my last deliberate Join —
                            // suppresses the "still now-playing" auto-rejoin until I choose to Join
  let inFlight = [];        // videoIds we've submitted (declare) but not yet seen land
  let _pendingRemovals = [];// videoIds we've undeclared but not yet seen leave declared()
  let _reconciling = false; // guards absorb/emit/fallout against synchronous re-entrancy
  let _live = false;        // false until resync() (post history-replay): don't absorb historical plays
  let _lastPi = null;       // play-index we've already accounted for (dedupe a play)
  let _boundHeadEid = null; // the eid currently bound to declared[0] — what safe-drop drops on a play
  let _lastDeclared = {};   // videoId -> count last seen declared; a rise = a declare landed, a fall = an undeclare landed (duplicate-safe by delta)
  const DEBOUNCE_MS = 5000; // settle window: after your last top-2 edit, wait this long, then send ONE reconcile
  let _timer = null;        // the pending settle timer (via _clock), or null
  let _lastTopSig = "";     // identity (eids) of the top-CAP window the current timer is settling; an edit BELOW the window leaves this unchanged, so it won't restart the countdown
  // Injectable clock so the settle timer is deterministic in tests (the guard fast-
  // forwards instead of really sleeping). Production uses real timers.
  // TIMERS ONLY. It carried a `now` as well, read by exactly one function — `settleElapsedMs`,
  // which nothing ever called (J05). The UI resumes its commit bar from its own per-song
  // `_commitAnchors`, which survive a re-render where a single module-level deadline would not.
  // The clock itself stays: `set`/`clear` are the debounce timer and two guards inject them.
  let _clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
  let _seq = 0;             // entry-id counter
  const _listeners = [];
  const _subs = [];

  function _eid() { return "e" + Date.now().toString(36) + "_" + (++_seq); }

  const DJ_TYPES = [
    "ddjp.dj.join", "ddjp.dj.declare", "ddjp.dj.leave", "ddjp.dj.play",
    // ddjp.media.skip is an ADVANCE. It plays a song out of a buffer exactly as a play or a
    // manual skip does — and when that song is MINE, _absorbPlays is what drops it from my intent
    // and frees the slot for a refill. Without it here the availability escape moved the room and
    // my private stack did not notice: the played song sat in my intent, the freed slot went
    // unfilled, and nothing corrected it until some unrelated dj.* event happened along. In a
    // quiet room — which is the worst case for everything reactive here — that could be a long
    // time. The fourth instance of an omission this codebase had already found three times.
    "ddjp.dj.skip", "ddjp.media.skip", "ddjp.dj.move", "ddjp.dj.order",
    "ddjp.dj.undeclare"
  ];
  // ddjp.dj.remove (targeting me) and ddjp.dj.reset are EVICTIONS — handled by _onEvict, NOT
  // the generic reconcile. Through _onChange they'd read my now-empty declared buffer as
  // "starving" and instantly re-declare (auto-rejoin) me; _onEvict falls me out cleanly so I
  // get the offer-to-join state and return only with a deliberate Join. (A voluntary leave is
  // already safe: leaveRoomQueue sets active=false BEFORE the event, so no rejoin.)

  // A YouTube link -> 11-char id. The parser is the pure, shared one in PlaylistDoc
  // (core) so the queue and playlists accept links the SAME way — one copy to keep
  // correct. (videoId is the only truth we carry downstream.)
  function _extractVideoId(url) { return PlaylistDoc.extractVideoId(url); }

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
    let i = -1;
    // Fast path: the confirmed head (intent[0] bound to the declared head) played.
    if (_boundHeadEid) {
      const bi = intent.findIndex(x => x.eid === _boundHeadEid);
      if (bi >= 0 && intent[bi].videoId === played) i = bi;
    }
    // Fallback: a play can land while our order is still settling, so the song that
    // actually played is the declared head — which may be a DIFFERENT top-CAP entry than
    // intent[0]. Drop that exact song by identity so we lose precisely what played (even
    // if it wasn't at the top), keep the other submitted song, and let the reconciler
    // refill the freed slot.
    if (i < 0 && played) {
      for (let k = 0; k < Math.min(CAP, intent.length); k++) {
        if (intent[k].videoId === played) { i = k; break; }
      }
    }
    let dropped = false;
    if (i >= 0) { intent.splice(i, 1); dropped = true; }
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
      _lastTopSig = _topSig();
      return;
    }
    const sig = _topSig();
    // Same top-CAP window as the running timer → leave its countdown alone.
    if (_timer !== null && sig === _lastTopSig) return;
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    _lastTopSig = sig;
    _timer = _clock.set(() => {
      _timer = null;
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

  // A moderator struck ONE of my declared songs (ddjp.dj.strike { x, v }). Only my own
  // struck songs matter here — a strike on another DJ leaves my buffer untouched (the room
  // queue repaints via Queue, not us). Semantics, mirroring the reducer and undeclare:
  //   • The struck song leaves MY intent too (a targeted SAFE-DROP, exactly like ✕'ing it
  //     myself — so it does NOT bounce back on the next reconcile). No-op if it isn't mine.
  //   • If that emptied my buffer I've fallen OUT of the rotation (the reducer removed me):
  //     honor it (active off, no auto-rejoin), the SAME hard fall-out as undeclare.
  //   • Otherwise I kept ≥1 song, so reconcile IMMEDIATELY to declare my next queued song
  //     into the freed slot — a fresh 2nd song, never waiting the settle timer (never-starve).
  // Purely client-local: the reducer already removed the song from the room; "resubmit" is
  // just my client re-declaring my own next intent song.
  function _onStrike(e) {
    const c = (e && e.content) || {};
    if (c.x !== _me()) return;                 // not my queue — ignore
    if (_reconciling) return;                  // never re-enter mid-reconcile
    if (typeof c.v === "string" && c.v) {
      const i = intent.findIndex(s => s.videoId === c.v);
      if (i >= 0) { intent.splice(i, 1); _persist(); }   // the struck song leaves my queue
    }
    _clearLanded();
    _detectFallout();                          // emptied buffer -> fall out, no auto-rejoin
    if (active) _reconcileNow();               // still in -> instant fresh-song refill
    _notify();
  }

  // A moderator removed ME (ddjp.dj.remove with x === me) or cleared the whole rotation
  // (ddjp.dj.reset). Either way I've been evicted: FALL OUT — stop participating, with NO
  // auto-rejoin — and keep my intent (SAFE-DROP; the personal queue is never truth). I show
  // the "offer to join" state and re-enter only with a deliberate Join, exactly like a
  // voluntary leave. A remove of someone ELSE leaves my queue untouched. Mirrors
  // leaveRoomQueue (active off + timer cleared) so the generic reconcile can't re-declare me.
  function _onEvict(e) {
    const isReset = !!(e && e.type === "ddjp.dj.reset");
    const removedMe = !!(e && e.type === "ddjp.dj.remove" && e.content && e.content.x === _me());
    if (!isReset && !removedMe) return;               // a remove of someone else — not my queue
    if (_timer !== null) { _clock.clear(_timer); _timer = null; }
    inFlight = []; _pendingRemovals = []; _boundHeadEid = null;   // drop optimistic state so a late echo can't re-add me
    _lastDeclared = _countBy(_declaredIds());         // resync count bookkeeping to the now-empty buffer
    _evicted = true;                                  // block the on-the-decks auto-rejoin until a deliberate Join
    if (active) { active = false; _persist(); }
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
    intent = []; active = false; _evicted = false; _dirty = false;
    inFlight = []; _pendingRemovals = []; _reconciling = false;
    _live = false; _lastPi = null; _boundHeadEid = null; _lastDeclared = {};
    _lastTopSig = "";
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
    // AND WHEN THIS CLIENT BECOMES ABLE TO SPEAK. Queue.submitSong refuses while the client is
    // still catching up — correctly, since a send then carries a position below the room's head.
    // But the reconcile above is woken only by INCOMING dj.* events, so in a quiet room a song
    // refused during catch-up would wait for somebody else to act. Reconciling on the transition to
    // live is what makes the refusal a deferral rather than a drop.
    try { if (MatrixBridge.onAuthorReady) MatrixBridge.onAuthorReady(handler); } catch (e) {}
    // Strike gets its OWN handler (not the generic _onChange): a strike on my song must
    // drop it from my intent and instantly refill, which the plain reconcile won't do.
    StreamManager.on("ddjp.dj.strike", _onStrike); _subs.push(["ddjp.dj.strike", _onStrike]);
    // Evictions (a mod removing me, or a reset) fall me out cleanly instead of auto-rejoining.
    StreamManager.on("ddjp.dj.remove", _onEvict); _subs.push(["ddjp.dj.remove", _onEvict]);
    StreamManager.on("ddjp.dj.reset", _onEvict); _subs.push(["ddjp.dj.reset", _onEvict]);
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
    _lastTopSig = "";
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
    _lastTopSig = "";
    intent = []; inFlight = []; _pendingRemovals = [];
    _reconciling = false; _live = false; _lastPi = null; _boundHeadEid = null; _lastDeclared = {}; active = false; _evicted = false;
  }

  // Test hook: swap in a deterministic clock so the settle timer can be fast-forwarded.
  function setClock(c) { if (c && typeof c.set === "function" && typeof c.clear === "function") _clock = c; }

  // --- user actions ---
  // ── THE ROOM'S REPLAY COOLDOWN, ENFORCED AT THE ONE DOOR EVERY ADD GOES THROUGH ──────────────
  // Typing a link, cloning one song from a playlist and "add all" ALL arrive here — `Playlists`
  // reaches the queue only by handing `add` a canonical watch URL, which is its own stated
  // submit-path invariant. So one refusal covers every route, and a new route inherits it.
  //
  // THIS IS PREVENTION, NEVER THE RULE. It answers "is this blocked RIGHT NOW", not "will it still
  // be blocked when your turn comes" — a song fifty-nine minutes into an hour-long cooldown passes
  // here and is skipped a minute later. That is inherent rather than a defect: nothing can know
  // when a queued song will reach the front. The bot is the enforcement; this only stops the adds
  // that are already doomed.
  //
  // AND IT NEVER BLOCKS ON IGNORANCE. `Room.canQueue` answers `known: false` when this client's
  // play-log does not reach back a full cooldown, and a `known: false` is not a refusal — see the
  // reasoning on `playedWithin`.
  // Held by `check-repeat-cooldown` PART F, which drives the refusal through the real `UserQueue`
  // with `Room` stubbed at the seam — including that an unparseable link never reaches the reader,
  // and that the pre-existing refusals kept the sentence today's two panels render.
  function _repeatGate(videoId) {
    try {
      if (typeof Room === "undefined" || typeof Room.canQueue !== "function") return null;
      const v = Room.canQueue(videoId);
      if (v && v.ok === false) {
        return { ok: false, code: v.code, reason: v.reason, detail: v.detail, videoId: videoId };
      }
    } catch (e) { /* an unreadable room never blocks an add */ }
    return null;
  }

  function add(url) {
    const id = _extractVideoId(url);
    if (!id) return { ok: false, code: "bad-link", reason: "not a YouTube link" };
    // Fill, then refuse — a full queue rejects new songs and keeps everything it has.
    if (intent.length >= QUEUE_MAX) return { ok: false, code: "queue-full", reason: "queue is full (" + QUEUE_MAX + " max)" };
    const blocked = _repeatGate(id);
    if (blocked) return blocked;
    // Duplicates are allowed now (each is its own entry with its own eid).
    intent.push({ eid: _eid(), videoId: id, url: url, title: id });
    // Auto-rejoin: if participation went off but MY song is the one currently playing,
    // adding puts us back in (as if Join were pressed) — local flag only. BUT if a mod
    // removed me (or reset the room), suppress it: an eviction requires a deliberate Join,
    // even mid-song. _evicted clears the instant I press Join.
    if (!active && !_evicted && _amNowPlaying()) active = true;
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

  function joinRoomQueue() { _evicted = false; active = true; _persist(); _kick(); }
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
    const dec = _declaredIds();          // the room's declared buffer, IN ORDER
    const vid = intent[i].videoId;
    // Committed AT THIS POSITION: the room holds this exact song at this slot. Position
    // matters — a song that's declared but at the wrong slot (a reorder still in flight)
    // is NOT green; its bar loads until the order lands. This is what makes moving a
    // submitted song show loading at its new position instead of staying green.
    if (dec[i] === vid) return "green";
    // Not (yet) committed here: submitted-but-not-landed shows 'sent' (solid); otherwise
    // 'pending' (the animated loading bar) — covers both a fresh declare and a pending
    // reorder of an already-declared song.
    if (inFlight.indexOf(vid) >= 0) return "sent";
    return "pending";
  }
  return {
    init, destroy, onChange, resync, setClock,
    add, removeAt, moveUp, moveDown, moveToTop, moveToBottom,
    joinRoomQueue, leaveRoomQueue, clearQueue,
    items, list, isActive, count, stackCount, amInRotation, declared, slotState
  };
})();
