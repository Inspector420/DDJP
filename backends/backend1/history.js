// backends/backend1/history.js
//
// HISTORY — THE ONE QUESTION: what has played in this room?
//
// This concept is different from every other one here, and the difference is the whole reason it
// gets its own module. Everything else computes the PRESENT. History displays the PAST. They pull
// in opposite directions: the present wants to forget as much as it can, and history wants to
// remember as much as it can.
//
// THE CONFLICT THIS FIXES. In the old tree the play-log was a byproduct of the live fold, and it
// was deliberately NOT sealed into checkpoints — correctly, because a snapshot carries what is
// needed to keep playing and a play-log is not that. But forgetting is now switched on. So the
// moment a client adopted a floor and trimmed below it, its History pane emptied down to whatever
// had happened since. Two features actively fighting, and separating them is not tidiness — it is
// the fix.
//
// SO: history keeps its OWN list, fed from its own reading of the log, and is never trimmed by the
// floor. It can be filled eagerly, lazily, or page by page as the user scrolls, and none of that
// can affect what the room believes is playing.
//
// WHY IT MAY NOT FEED BACK. A play's videoId is NOT a field in the play event — it is whatever the
// reducer pops from the head DJ's buffer. So history has to be DERIVED by folding, never scanned
// off the events in isolation. That makes it tempting to reuse the live fold, which is exactly the
// coupling this module exists to remove. Instead it folds independently, and the one rule is that
// nothing here is ever read for truth: reducer-inert, display-only, and it can be wrong or absent
// without the room noticing.
//
// Depends on: StateDeriver (the fold). Nothing depends on it.

const History = (() => {

  // The window the pane can show. 5000 is the same number the old tree used, and the POLICY is the
  // meaningful part rather than the number: history is REGENERABLE from the log, so it evicts the
  // oldest when full. Contrast the queue and playlists, which are local truth and REFUSE a new item
  // instead — losing your data is worse than refusing to add to it.
  const MAX = 5000;

  let _entries = [];        // oldest -> newest
  // COVERAGE IS A LIST OF RANGES (J73 job 6, Q8). One range could not say "I hold my last visit and
  // everything since a newer save point, but not the songs in between" — it spanned the gap and
  // claimed it. Each range is [lo, hi] in positions READ, merged when they touch. COMPLETE means one
  // range reaching the room's start: no holes all the way down.
  let _ranges = [];          // [[lo, hi], ...] ascending, disjoint
  // ADDED TIMES (J73 Q10): who added which video, and when — the latest few per person and video.
  // Kept only while that song is queued or playing; the same device store as the rows.
  let _added = Object.create(null);   // user \u0000 videoId -> [ts ascending] (at most 4)
  let _addedL = Object.create(null);   // the same adds, by ROOM POSITION (the owner's repeat rule)
  let _retainKeep = null;   // the add keys the last retain kept (queued or playing songs)
  let _lastRestore = null;   // the stored table's origin, for the audit (ddjp_559)
  // SEGMENTS VERIFIED AGAINST THE ROOM (`ddjp_561`): key = the fingerprints of the two floors that bound it -> { lo, hi }. A
  // replaced floor is a new key; a coverage reset forgets the keys above its cut. Persisted with the table.
  let _verified = Object.create(null);
  // THE ORIGIN (`ddjp_564`, J28, the owner's ruling: history starts fresh at the origin floor). An override posts an import floor
  // (`prev` null, `thin`) and every later floor chains back to it. Rows at or below its cut are not this room's history: not
  // shown, rebuilt or verified. Its banked song (the file's now playing) is the first row. Persisted with the table. `start`:
  // a room never overridden — its origin is the room's start, recorded so a long chain need not be walked again.
  let _origin = null;   // { l, h, banked, start }
  let _opened = true;   // false until the open's restore step, when the env asks to await it
  const KEY_V = "v2|";
  let _touchedBeforeRestore = [], _restoredOnce = false;   // positions written before the first restore (ddjp_563)

  let _env = {
    // NO SILENT GLOBAL FALLBACK. An unwired module must answer "I hold nothing" rather than
    // quietly working off whatever happens to be loaded.
    log: () => [],
    seed: null,             // () => the floor's seed, so a trimmed log can still be folded
    pageRange: null,        // optional: (fromL, toL) => Promise<events> for lazy backfill
    anchorOf: null,         // optional: (event) => { l, seed } when the event is a save point with a seed
  };
  function _cover(lo, hi) {
    if (typeof lo !== "number" || typeof hi !== "number" || hi < lo) return;
    const all = _ranges.concat([[lo, hi]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    _ranges = out;
  }
  // EVICTION LOWERS THE CLAIMED REACH (J73 job 6). Rows past MAX are dropped oldest first; what lay
  // below the oldest kept row is no longer known, so no range may claim it.
  function _clipBelow(l) {
    if (typeof l !== "number") return;
    _ranges = _ranges.filter((r) => r[1] >= l).map((r) => [Math.max(r[0], l), r[1]]);
  }
  function _mergeIn(incoming, finals, incomingWins) {
    if (_origin && !_origin.start && Array.isArray(incoming)) incoming = incoming.filter((r) => !_belowOrigin(r));   // below the origin: not this room's
    const before = new Set(_entries.map((e) => e && e.pi));
    let unique = _entries.length;
    for (const e of (incoming || [])) if (e && e.pi && !before.has(e.pi)) { before.add(e.pi); unique++; }
    _entries = merge(_entries, incoming, incomingWins);
    // A row first seen while its song was live has no counts; once a fold sees it ended, it gets them.
    // Final is final: a row that has counts keeps them.
    const _final = finals ? Object.assign(Object.create(null), finals) : Object.create(null);
    for (const e of (incoming || [])) if (e && e.pi && e.counts) _final[e.pi] = e.counts;
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (e && !e.counts && _final[e.pi]) _entries[i] = Object.assign({}, e, { counts: _final[e.pi] });
    }
    if (unique > MAX && _entries.length && typeof _entries[0].l === "number") _clipBelow(_entries[0].l);
  }
  function _isAdd(e) {
    const t = e && (e.type || (e.content && e.content.t));
    return (t === "ddjp.dj.declare" || t === "ddjp.dj.join") && e.content && typeof e.content.v === "string" && !!e.content.v;
  }
  function _noteAdd(user, videoId, ts, l) {
    if (!user || !videoId || typeof ts !== "number") return;
    const k = user + "\u0000" + videoId;
    const list = _added[k] || (_added[k] = []);
    if (list.indexOf(ts) < 0) { list.push(ts); list.sort((a, b) => a - b); }
    if (list.length > 4) list.splice(0, list.length - 4);
    // ITS ROOM POSITION TOO (the owner's repeat rule, `ddjp_536`): "added before the setting took effect" is judged by
    // position, never by a device clock.
    if (typeof l === "number") { const pl = _addedL[k] || (_addedL[k] = []); if (pl.indexOf(l) < 0) { pl.push(l); pl.sort((a, b) => a - b); } if (pl.length > 4) pl.splice(0, pl.length - 4); }
  }
  // The latest position at which this person added this video, at or before `beforeL` (the play's position).
  function addedAtL(user, videoId, beforeL) {
    const list = _addedL[user + "\u0000" + videoId];
    if (!list || !list.length) return null;
    for (let i = list.length - 1; i >= 0; i--) if (typeof beforeL !== "number" || list[i] <= beforeL) return list[i];
    return null;
  }
  // TAKE BEFORE DROPPING (J73 Q10): an engine about to drop events hands them here first. `isLegal`
  // is the fold's verdict (refused adds do not count); null where every act was accepted.
  function noteAdds(events, isLegal) {
    let n = 0;
    for (const e of (Array.isArray(events) ? events : [])) {
      if (!_isAdd(e)) continue;
      if (typeof isLegal === "function" && isLegal(e.eventId || e.event_id) === false) continue;
      _noteAdd(e.sender, e.content.v, e.ts, e.l); n++;
    }
    return n;
  }
  // The most recent time this person added this video, at or before `beforeTs` (the song's start).
  function addedAt(user, videoId, beforeTs) {
    const list = _added[user + "\u0000" + videoId];
    if (!list || !list.length) return null;
    for (let i = list.length - 1; i >= 0; i--) if (typeof beforeTs !== "number" || list[i] <= beforeTs) return list[i];
    return null;
  }
  // KEPT ONLY WHILE ITS SONG IS QUEUED — or playing, because the repeat rule asks at the song's start.
  function _retain(state) {
    if (!state || !Array.isArray(state.rotation)) return;
    const keep = new Set();
    for (const r of state.rotation) for (const s of (r && r.pending) || []) if (s && s.videoId) keep.add(r.user + "\u0000" + s.videoId);
    const np = state.nowPlaying;
    if (np && np.dj && np.song && np.song.videoId) keep.add(np.dj + "\u0000" + np.song.videoId);
    for (const k of Object.keys(_added)) if (!keep.has(k)) delete _added[k];
    for (const k of Object.keys(_addedL)) if (!keep.has(k)) delete _addedL[k];
    _retainKeep = keep;
  }
  function holes() {
    const out = [];
    let at = 0;
    for (const r of _ranges) { if (r[0] > at) out.push([at, r[0] - 1]); at = r[1] + 1; }
    return out;
  }

  function attach(env) { _env = Object.assign({}, _env, env || {}); if (env && env.awaitOpen) _opened = false; }   // ddjp_564

  // ── PURE: fold a stretch of log into play entries ────────────────────────────────────────
  // Uses the reducer, so a played videoId is whatever the reducer would actually have popped —
  // never a guess from the event body. `seed` lets a caller fold a segment onto known prior state
  // rather than from the beginning, which is what makes paged backfill possible at all.
  function foldRange(events, seed) {
    try {
      const st = StateDeriver.derive(Array.isArray(events) ? events : [], seed);
      return Array.isArray(st.history) ? st.history.slice() : [];
    } catch (e) { return []; }
  }

  // ── PURE: merge, dedup and bound ─────────────────────────────────────────────────────────
  // Deduped by play-instance, because the same stretch may be folded twice — a re-page overlapping
  // what we already had, or a replay after a reconnect.
  //
  // ── ORDERED BY POSITION, NOT BY TIMESTAMP ────────────────────────────────────────────────
  // This sorted by the play's start stamp, and that was wrong. `at` is the server timestamp on the
  // play event, and plays are NOT ordered by timestamp anywhere in this system — they are ordered
  // by (position, event id), which is intrinsic and identical on every client. Timestamps come from
  // whichever homeserver stamped the event, so two plays can carry stamps that disagree with the
  // order they actually happened in, and the pane would then show songs in an order the room never
  // played them.
  //
  // The rule everywhere else is one ordering key. Using a DISPLAY value to order a display is
  // exactly the kind of second opinion that drifts, and it drifts silently: nothing errors, the
  // list is just quietly wrong. `at` stays in the entry because the pane renders "time ago" from
  // it; it does not decide sequence.
  //
  // The position is attached at ingest (see `ingest`), because the reducer's history entries do not
  // carry one — and attaching it here rather than changing the reducer keeps the truth layer
  // untouched.
  // `incomingWins` (`ddjp_560`): a fresh DERIVATION replaces a row with the same pi — a wrong row once in the table was never
  // corrected, because the existing row always won. A stored table (restore) still never overrides a derived row.
  function merge(existing, incoming, incomingWins) {
    const byPi = Object.create(null);
    const out = [];
    for (const list of (incomingWins ? [incoming || [], existing || []] : [existing || [], incoming || []])) {
      for (const e of list) {
        if (!e || !e.pi) continue;
        if (byPi[e.pi]) continue;
        byPi[e.pi] = 1;
        out.push(e);
      }
    }
    out.sort((a, b) => {
      // Position first. An entry with no position (one folded before this rule existed, or from a
      // range whose events were not supplied) sorts by stamp as a fallback rather than jumping to
      // the front.
      const la = (typeof a.l === "number") ? a.l : (a.at || 0);
      const lb = (typeof b.l === "number") ? b.l : (b.at || 0);
      if (la !== lb) return la - lb;
      // Two plays CAN share a position, so the id is the tiebreak — the same key the reducer
      // itself sorts by. Comparing position alone would make the pair's order arbitrary.
      return String(a.pi) < String(b.pi) ? -1 : (String(a.pi) > String(b.pi) ? 1 : 0);
    });
    if (out.length > MAX) return out.slice(out.length - MAX);   // regenerable -> evict the oldest
    return out;
  }

  // ── FEED IT ──────────────────────────────────────────────────────────────────────────────
  // Called with whatever stretch of log is available. Safe to call repeatedly and with overlapping
  // ranges — merge dedups. This is what makes history independent: the live path may trim its log
  // to the floor whenever it likes, and history keeps what it already read.
  function ingest(events, seed, opts) {
    // THE TRIM HAND-OFF OBEYS THE SAME RULE AS REFRESH (`ddjp_563`, the bot's burst of trims before `modules started (live)`):
    // nothing is written until the device is settled — those closed segments are verify's, from the room.
    if (opts && opts.src === "trim" && typeof _env.settled === "function") { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }
      if (!_s) return { added: 0, total: _entries.length, deferred: "not-settled" }; }
    const list = Array.isArray(events) ? events : [];
    if (!list.length) return { added: 0, total: _entries.length };
    const before = _entries.length;
    const posOf = Object.create(null);
    for (const e of list) {
      const id = e && (e.eventId || e.event_id);
      if (id && typeof e.l === "number") posOf[id] = e.l;
    }
    const stamp = _floorSig();
    let both = null;
    try { both = StateDeriver.deriveBoth(list, seed); } catch (e) { both = null; }
    const rows = (both && both.state && Array.isArray(both.state.history)) ? both.state.history.slice() : foldRange(list, seed);
    const folded = rows.map((h) => {
      if (!h) return h;
      const withPos = (posOf[h.pi] !== undefined) ? Object.assign({}, h, { l: posOf[h.pi] }) : Object.assign({}, h);
      withPos.floorSig = stamp;
      withPos.src = (opts && opts.src) || "fold";   // WHICH PATH PRODUCED THIS ROW (`ddjp_559`, the history audit)
      return withPos;
    });
    // PAST TALLIES, KEPT (J73, owner `ddjp_518`): when a play has ENDED its counts are final, so its row
    // takes them — votes and saves — here, where every fold that is about to drop events passes first.
    // Never the live play's: its counts still move. The panel shows `counts[row.pi]`, and the derived
    // counts lose past plays at every save point and every trim, so without this they vanished.
    const live = both && both.state && both.state.nowPlaying ? both.state.nowPlaying.pi : null;
    const cs = (both && both.state && both.state.counts) || {};
    // BY PLAY, NOT ONLY BY ROW: a fold from a seed has no row for the seed's live play (it started before
    // the fold), yet sees it END — so every ended play's final tally is offered to the rows already held.
    const _finals = Object.create(null);
    for (const pi of Object.keys(cs)) if (pi !== live) _finals[pi] = { votes: cs[pi].votes || 0, saves: cs[pi].saves || 0 };
    const acc = (both && Array.isArray(both.accepted)) ? new Set(both.accepted) : null;
    // ADD RECORDS DO NOT DEPEND ON WHICH STEP RAN LAST (`ddjp_558`, the owner's reloads): only the live refresh retains; a backfill's
    // ingest records adds only for songs that retain kept (queued or playing) — so a first open and a reload agree.
    const _addsFrom = (opts && opts.retain) || !_retainKeep ? list : list.filter((e) => _isAdd(e) && _retainKeep.has(e.sender + "\u0000" + e.content.v));
    noteAdds(_addsFrom, acc ? (id) => acc.has(id) : null);
    const lo = (opts && typeof opts.from === "number") ? opts.from
      : list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l < m)) ? e.l : m, null);
    const hi = (opts && typeof opts.to === "number") ? opts.to
      : list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l > m)) ? e.l : m, null);
    _cover(lo, hi);
    if (!(opts && opts.src === "verify")) _dropKeysChangedBy(folded);   // ddjp_562: a verified segment another path changes is re-verified
    if (!_restoredOnce) for (const r of folded) if (r && typeof r.l === "number") _touchedBeforeRestore.push(r.l);   // ddjp_563
    _mergeIn(folded, _finals, true);   // a derivation wins over what the table held for the same play (ddjp_560)
    if (opts && opts.retain && both && both.state) _retain(both.state);
    return { added: _entries.length - before, total: _entries.length };
  }

  // Fold whatever the live log currently holds. The ordinary path, and cheap: it is one fold of a
  // bounded window, not of the room's whole life.
  //
  // ── THE SEED IS NOT OPTIONAL ONCE THE LOG HAS BEEN TRIMMED ───────────────────────────────
  // Found by reading. A play's videoId is not in its event body — it is whatever the reducer pops
  // from the head DJ's buffer — so history can only be produced by folding. And a fold needs
  // somewhere to start: given a mid-log SEGMENT with no seed, every play in it names a parent the
  // fold has never seen, the advance lock refuses all of them, and the result is not "fewer
  // entries" but ZERO entries.
  //
  // That failure is silent and it arrives exactly when forgetting is switched on: the moment a
  // client adopts a floor and trims below it, `refresh()` starts folding a segment from empty and
  // history quietly stops growing. It would look like the very bug this module was separated to
  // fix, wearing a different hat.
  //
  // So the seed is fetched from the floor when the caller does not supply one, and a segment with
  // NEITHER is refused rather than folded into silence. Refusing is the honest answer: "I cannot
  // produce history for this stretch" is information, and an empty list that looks like a quiet
  // room is not.
  // ── AND THE SEED IS ONLY FOR A SEGMENT ───────────────────────────────────────────────────
  // The floor's seed was reached for whenever the caller supplied none — including for a log that
  // still starts at GENESIS, which is exactly what a client holds from the end of replay until its
  // first trim. Seeding a genesis fold with a mid-room state makes the fold begin at the floor and
  // then replay events from position 1: every early play names a parent that does not match the
  // seeded now-playing, the advance lock refuses them, and a room that had played eight songs
  // folded down to two. Nothing errors — a refused play is not an error — so the pane simply
  // reported a room that had barely played anything.
  //
  // `_looksLikeSegment` was already here, consulted only to decide whether to REFUSE. It answers
  // the question that actually decides this: does the seed APPLY at all.
  function refresh(seed) {
    // NOT BEFORE THE DEVICE IS SETTLED (`ddjp_562`, the rank-0 listener): rows folded from a replay still arriving (floors not
    // adopted, early events missing) were kept as final — l=55 and l=59 with the wrong video. Until settled, nothing is written.
    if (typeof _env.settled === "function") { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }
      if (!_s) return { added: 0, total: _entries.length, deferred: "not-settled" }; }
    if (!_opened) return { added: 0, total: _entries.length, deferred: "not-opened" };   // ddjp_564: the table's origin is not known yet
    try { const _eo = (typeof _env.origin === "function") ? _env.origin() : null; if (_eo && _eo.origin) setOrigin(_eo); } catch (e) {}
    let log = _env.log() || [];
    if (!log.length) return { added: 0, total: _entries.length };
    const isSegment = _looksLikeSegment(log);
    // A SEGMENT IS FOLDED ONLY FROM THE SEED THAT MATCHES ITS START (`ddjp_559`, the rank-0 listener's 22 songs). A device that
    // follows a floor it cannot prove keeps its history under it, so its held log starts BELOW the floor; folding all of it
    // from the floor's seed applied the stretch between the two twice, and later plays came out refused. Only the events
    // above the cut are folded from the floor's seed; the stretch below is left uncovered for the backfill, from the start.
    // ON A FLOOR, ALWAYS FROM ITS SEED (`ddjp_562`): a device that keeps history under a floor it cannot prove holds a log from l=1
    // with gaps (banked events) — not a "segment", so it was folded whole from the room's start, gaps and all, and re-wrote the
    // rows below the floor wrong. The stretch below a floor is verify's, the backfill's and the trims'; refresh folds above the cut.
    let _cutFrom = null;
    let _whole = true; try { _whole = (typeof _env.heldComplete === "function") ? _env.heldComplete() !== false : true; } catch (e) { _whole = true; }
    if (seed === undefined && (isSegment || !_whole || (_origin && !_origin.start)) && typeof _env.cut === "function") {   // a segment, a log with gaps, or an origin room
      let c = null; try { c = _env.cut(); } catch (e) { c = null; }
      if (typeof c === "number" && log.some((e) => typeof e.l === "number" && e.l <= c)) { log = log.filter((e) => typeof e.l === "number" && e.l > c); _cutFrom = c + 1; }
      if (!log.length) return { added: 0, total: _entries.length };
    }
    const s = (seed !== undefined) ? seed : ((isSegment || _cutFrom !== null) ? _floorSeed() : undefined);
    if ((isSegment || _cutFrom !== null) && s === undefined) {
      return { added: 0, total: _entries.length, refused: "segment-without-seed" };
    }
    // THE HELD LOG IS COMPLETE FROM JUST ABOVE THE FLOOR (owner's re-test, `ddjp_535`): covered from there, not from its
    // first event — else the save point's own position, between the cut and the first held event, stays a hole until
    // the NEXT move-on, and the repeat rule cannot tell. A real gap below the floor then shows as a hole to fill.
    let from;
    try { const h = (typeof _env.heldFrom === "function") ? _env.heldFrom() : null; const f0 = log[0] && log[0].l;
          if (typeof h === "number") from = (typeof f0 === "number") ? Math.min(h, f0) : h; } catch (e) { from = undefined; }
    if (_cutFrom !== null) from = _cutFrom;            // covered only from above the cut: the stretch below is the backfill's
    return ingest(log, s, (typeof from === "number") ? { retain: true, from: from, src: "refresh" } : { retain: true, src: "refresh" });   // the held log is the live room: prune added times to its queue
  }

  function _floorSeed() {
    if (typeof _env.seed === "function") { try { return _env.seed(); } catch (e) {} }
    return undefined;
  }

  // Does this log start mid-history? A genesis log opens with an advance that follows nothing
  // (p:null). Anything else is a segment, and folding it from empty produces nothing at all.
  function _looksLikeSegment(log) {
    for (const e of log) {
      if (!e || !e.content) continue;
      const t = e.type || e.content.t;
      if (t === "ddjp.dj.play" || t === "ddjp.dj.skip" || t === "ddjp.media.skip") {
        return !!e.content.p;          // the first advance follows something -> we are mid-history
      }
    }
    return false;                      // no advance at all: nothing to get wrong
  }

  // ── LAZY BACKFILL ────────────────────────────────────────────────────────────────────────
  // Reach further back than the live log goes. Optional by design: the pane works without it, just
  // with a shorter list. This is the seam where "load it all at once" and "load as you scroll" are
  // the same code with a different `toL` — which is exactly why the concept had to be separated
  // before the choice could be made.
  //
  // A page that fails returns nothing rather than a partial range presented as complete.
  // `toL` is the ceiling to page UP TO when nothing has been read yet. A client whose live log is
  // a segment it cannot seed reads zero entries from it, and refusing to backfill there would
  // leave the pane empty in precisely the case this function exists for. The caller knows where
  // its own knowledge starts even when the fold could not use it.
  async function backfill(fromL, seed, toL) {
    if (typeof _env.pageRange !== "function") return { ok: false, reason: "no-pager" };
    const ceiling = _ranges.length ? _ranges[0][0] : ((typeof toL === "number") ? toL : null);
    if (ceiling === null) return { ok: false, reason: "nothing-read-yet" };
    if (fromL >= ceiling) return { ok: true, added: 0, reason: "already-covered" };
    let events = null;
    try { events = await _env.pageRange(fromL, ceiling); }
    catch (e) { return { ok: false, reason: "page-threw" }; }
    if (!Array.isArray(events) || !events.length) return { ok: false, reason: "page-empty" };
    // HOW FAR BACK IT REALLY GOT. A download that stopped at its page limit reached only its oldest
    // event; claiming `fromL` there was claiming what was never read (J73 job 6).
    const reached = (typeof events.reachedFrom === "number") ? Math.max(fromL, events.reachedFrom) : fromL;
    // FLOOR-ANCHORED (`ddjp_560`): each segment from the checkpoint it follows, as the app follows floors — one fold from the
    // room's start diverges from the settled floors where live acceptance and a replay differ (this room: l=98).
    const _within = events.filter((e) => typeof e.l === "number" && e.l >= reached);
    let _added = 0, _r = null;
    for (const sg of _segments(_within, _anchorsIn(_within), seed)) {
      _r = ingest(sg.seg, sg.seed, { from: Math.max(reached, sg.lo + 1), to: Math.min(ceiling, sg.hi), src: "backfill" }); _added += (_r && _r.added) || 0; }
    const r = { added: _added, total: _entries.length };
    return { ok: true, added: r.added, total: r.total, reachedFrom: reached };
  }
  // FILL THE HOLES (J73 job 6, Q8): newest first, each anchored to a save point at or below its start
  // — a hole's first plays chain from songs before it, so it cannot be folded from nothing. The fill
  // reads further down until it finds one (or the room's start); what it cannot anchor stays a hole,
  // and the repeat rule then says it cannot tell.
  async function fillGaps(maxTries) {
    if (typeof _env.pageRange !== "function") return { ok: false, reason: "no-pager", filled: 0 };
    const tries = (typeof maxTries === "number") ? maxTries : 6;
    let filled = 0;
    for (const [a, b] of holes().reverse()) {
      let from = a, events = null, anchor = null, reachedStart = false;
      for (let t = 0; t < tries; t++) {
        try { events = await _env.pageRange(from, b); } catch (e) { events = null; }
        if (!Array.isArray(events)) break;
        const reach = (typeof events.reachedFrom === "number") ? events.reachedFrom : from;
        reachedStart = (from <= 0 && reach <= 0);
        const anchors = events.map((e) => (typeof _env.anchorOf === "function") ? _env.anchorOf(e) : null)
          .filter((x) => x && typeof x.l === "number" && x.l < a);
        if (anchors.length) { anchor = anchors.sort((x, y) => y.l - x.l)[0]; break; }
        if (reachedStart || reach > from) break;              // at the start, or the download ran out
        from = Math.max(0, a - (b - a + 1) * Math.pow(2, t + 1));
      }
      if (!Array.isArray(events)) continue;
      const base = anchor ? anchor : (reachedStart ? { l: -1, seed: undefined } : null);
      const inner = events.map((e) => ({ e, an: (typeof _env.anchorOf === "function") ? _env.anchorOf(e) : null }))
        .filter((x) => x.an && typeof x.an.l === "number" && x.an.l >= a && x.an.l <= b).map((x) => x.an)
        .sort((x, y) => x.l - y.l);
      const cuts = (base ? [base] : []).concat(inner);
      for (let i = 0; i < cuts.length; i++) {
        const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : b;
        const seg = events.filter((e) => typeof e.l === "number" && e.l > lo && e.l <= hi);
        if (!seg.length) continue;
        ingest(seg, cuts[i].seed, { from: Math.max(a, lo + 1), to: hi, src: "gaps" });
        filled++;
      }
      // Read through the whole hole from a save point (or the room's start): positions with no event
      // in them were read too, so the hole is covered, not only where songs happened to be.
      if (base) _cover(a, b);
    }
    return { ok: true, filled: filled, holes: holes().length };
  }

  // ── READ IT ──────────────────────────────────────────────────────────────────────────────
  // Newest first, optionally limited. Time-ago FORMATTING is a UI concern — it needs the wall
  // clock, which is not this layer's to read — so this only orders and limits.
  function recent(limit) {
    const out = _entries.slice().reverse();
    if (typeof limit === "number" && limit >= 0 && out.length > limit) return out.slice(0, limit);
    return out;
  }
  function count() { return _entries.length; }

  // How much of the room we can actually account for. Honest rather than reassuring: a pane that
  // says "showing the last 40 songs" is useful, and one that implies it has everything when it has
  // a window is not.
  // ── WHICH FLOOR IS THIS CLIENT ON ─────────────────────────────────────────────────────────
  // Read through the same `Floor.sigOf` the fold uses, so the two cannot name a floor differently.
  // Best-effort: with no floor module loaded, rows stamp `null` and behave as genesis-derived,
  // which is the honest reading rather than a guess.
  function _floorSig() {
    try {
      if (typeof Floor !== "undefined" && Floor.current && Floor.sigOf) {
        const f = Floor.current();
        return f ? Floor.sigOf(f) : null;
      }
    } catch (e) {}
    return null;
  }

  // ── THE HEAL ──────────────────────────────────────────────────────────────────────────────
  // Rows settled under a floor the trust cascade no longer selects are SUSPECT, not wrong — the
  // new floor usually agrees, which is the ordinary case and why this is cheap. They are dropped
  // rather than rewritten, because the events that would rebuild them may have been discarded and
  // a rebuilt-from-nothing row is a fabrication. Dropping is recoverable: the chain names what is
  // missing and the backfill re-reads it.
  //
  // ONLY rows at or above the floor's cut. A row below it is covered by the checkpoint itself —
  // the room's settled account — and re-deriving those is what would make this expensive.
  // UNDER WHICH FLOOR WAS THE COVERAGE ABOVE THE CUT DERIVED? (`ddjp_557`) A different floor can derive differently — a play refused
  // under one can be accepted under the next (a same-position race at the cut) — so every position above a new floor's cut
  // that was derived under another floor is suspect, row or no row. `null`: unknown (a restored stored table).
  let _coverageSig = null;
  function reconcileFloor(sig, floorL) {
    const before = _entries.length;
    if (typeof sig !== "string" && sig !== null) return { dropped: 0, reason: "no-signature" };
    const cut = (typeof floorL === "number") ? floorL : null;
    _entries = _entries.filter((e) => {
      if (!e) return false;
      if (e.floorSig === sig) return true;              // settled under the floor we are on
      if (e.floorSig === undefined) return true;        // predates stamping: left alone, not judged
      if (cut !== null && typeof e.l === "number" && e.l <= cut) return true;  // the checkpoint covers it
      return false;                                     // above the cut, under a replaced answer
    });
    const dropped = before - _entries.length;
    // CLIP TO THE CUT (`ddjp_557`, the owner's audit of 556): whenever rows were dropped, or the coverage above the cut was derived
    // under another floor, coverage is kept only up to the new floor's cut — the gap filler and the held log then re-read
    // everything above it. Re-reading is idempotent: rows merge by their play.
    if (cut !== null && (dropped > 0 || _coverageSig !== sig)) {
      _ranges = _ranges.filter((r) => r[0] <= cut).map((r) => [r[0], Math.min(r[1], cut)]);
      for (const k of Object.keys(_verified)) if (_verified[k].hi > cut) delete _verified[k];   // coverage reset: re-verify above the cut
    }
    _coverageSig = sig;
    return { dropped: dropped, remaining: _entries.length, sig: sig, cut: cut };
  }


  // ── THE INVARIANT, ASKABLE ────────────────────────────────────────────────────────────────
  // Every row is backed by a checkpoint covering it, or by events this client still holds. Never
  // neither. Discarding raw events below a checkpoint is safe only while that stays true, and a
  // rule nobody can ASK is a hope — the pane that has quietly lost its footing looks exactly like
  // the one that has not.
  //
  // `heldFrom` is the lowest position whose events this client still holds; rows at or above it
  // are backed by events. `floorL` is the cut a trusted checkpoint covers; rows at or below it are
  // backed by the checkpoint. Anything in neither is unbacked and is what this reports.
  function unbackedRows(heldFrom, floorL) {
    const held = (typeof heldFrom === "number") ? heldFrom : null;
    const cut = (typeof floorL === "number") ? floorL : null;
    const bad = [];
    for (const e of _entries) {
      if (!e || typeof e.l !== "number") continue;      // no position: cannot be judged, not counted
      const byCheckpoint = cut !== null && e.l <= cut;
      const byEvents = held !== null && e.l >= held;
      if (!byCheckpoint && !byEvents) bad.push({ pi: e.pi, l: e.l });
    }
    return bad;
  }
  // The same question as a verdict rather than a list, for a caller that only needs to gate on it.
  function backing(heldFrom, floorL) {
    const bad = unbackedRows(heldFrom, floorL);
    return { ok: bad.length === 0, unbacked: bad.length, rows: bad.slice(0, 10) };
  }

  // ── SNAPSHOT / RESTORE ────────────────────────────────────────────────────────────────────
  // PURE and storage-agnostic on purpose: this module does not know what IndexedDB is, and the
  // layer that owns durability does not know how to fold. Keeping the two apart is why the pane
  // could be made durable without touching the fold at all.
  //
  // The snapshot is the rows plus the reach, because reach is not recomputable from rows alone —
  // a client that read back to position 40 and found no songs there still knows it read that far,
  // and losing that would make it page the same empty stretch again on every load.
  function snapshot() {
    const c = coverage();
    const adds = {};
    for (const k of Object.keys(_added)) adds[k] = _added[k].slice();
    const addsL = {};
    for (const k of Object.keys(_addedL)) addsL[k] = _addedL[k].slice();
    return { v: 2, rows: _entries.slice(), ranges: _ranges.map((r) => r.slice()), adds: adds, addsL: addsL,
             fromL: c.fromL, toL: c.toL, complete: c.complete, verified: Object.assign({}, _verified), origin: _origin ? Object.assign({}, _origin) : null };
  }
  // TOTAL. Junk, a missing file, or a version this build does not know all restore to "nothing",
  // because every row is derivable — losing the table costs one re-fold and never a fact. A
  // restore that threw would take the pane down over a cache.
  // THE HISTORY AUDIT (`ddjp_559`, read-only): the room's events, paged from its start, folded by the app's own reducer from the
  // beginning, compared with this device's table row by row. Nothing here changes the table.
  // ONE CLOSED SEGMENT, FOR EVERY FLOOR-ANCHORED WRITER (`ddjp_563`): the events in (a, b] folded from a's seed, plus THE CLOSING
  // FLOOR'S BANKED SONG. The reducer's history lists the songs a fold STARTED; a song spanning the cut is produced only by the
  // segment it started in — and where that segment's fold diverges from its closing floor (the J71 late-arrival race), the fold
  // refuses it and the next segment carries it only as its seed's now-playing. The closing floor is the room's account: its
  // banked song is a row, taken from the floor. Shared by the truth, verify and the cache rebuild, so they cannot disagree.
  function _segmentRows(seg, aSeed, bSeed, prevByPi) {
    const posOf = Object.create(null); for (const e of seg) if (e && e.eventId) posOf[e.eventId] = e.l;
    // THE SAME FOLD AS `ingest` (`ddjp_564`): `deriveBoth`'s state, so a row has one shape whichever writer produced it.
    let st = null; try { const b = StateDeriver.deriveBoth ? StateDeriver.deriveBoth(seg, aSeed) : null; st = (b && b.state) ? b.state : StateDeriver.derive(seg, aSeed); } catch (e) { st = null; }
    if (!st) return null;
    const cs = st.counts || {}, live = st.nowPlaying ? st.nowPlaying.pi : null;
    const lOf = (pi, d) => (posOf[pi] !== undefined) ? posOf[pi] : ((prevByPi && prevByPi.get(pi) && typeof prevByPi.get(pi).l === "number") ? prevByPi.get(pi).l : d);
    const rows = (st.history || []).filter((h) => h && h.pi).map((h) => Object.assign({}, h, { l: lOf(h.pi, h.l),
      counts: (h.pi !== live && cs[h.pi]) ? { votes: cs[h.pi].votes || 0, saves: cs[h.pi].saves || 0 } : h.counts }));
    const banked = bSeed && bSeed.nowPlaying && bSeed.nowPlaying.pi ? bSeed.nowPlaying : null;
    if (banked && !rows.some((r) => r.pi === banked.pi)) {
      const old = prevByPi ? prevByPi.get(banked.pi) : null;
      // IN THE REDUCER'S OWN ROW SHAPE (`ddjp_564`): { videoId, dj, at, pi, skipped } — one shape whichever writer produced it
      rows.push(Object.assign({}, old || {}, { pi: banked.pi, videoId: (banked.song || {}).videoId || null, dj: banked.dj || null,
        at: (typeof banked.startedAt === "number") ? banked.startedAt : ((old && old.at) || null), skipped: !!banked.skipped, l: lOf(banked.pi, null), src: "floor" }));
    }
    return { rows: rows, live: live, banked: banked ? banked.pi : null };
  }
  // A ROW'S IDENTITY ACROSS DERIVATIONS (`ddjp_564`): its play and its video. A start time set from a floor's seed (a banked row) and
  // one a fold carries differ only in form — counting that as a change dropped keys on every open.
  const _k3 = (r) => [r.pi, r.videoId].join("|");
  // ── FLOOR-ANCHORED DERIVATION (`ddjp_560`) ──────────────────────────────────────────────────────────────────────────────
  // The room's song history as the app follows it: the stretch before the first floor folded from the room's start, and
  // each later stretch folded from the seed of the floor it follows. `anchors` are the ACCEPTED floors ({ l, seed }); without
  // them, the checkpoints among `events` that `anchorOf` recognises.
  function _anchorsIn(events, given) {
    const list = Array.isArray(given) ? given : ((typeof _env.anchorOf === "function") ? (events || []).map((e) => { try { return _env.anchorOf(e); } catch (x) { return null; } }) : []);
    const byL = new Map();
    for (const a of list) if (a && typeof a.l === "number" && a.seed) byL.set(a.l, a);
    return Array.from(byL.values()).sort((x, y) => x.l - y.l);
  }
  function _segments(events, anchors, baseSeed) {
    if (anchors && anchors.length && anchors[0].origin) baseSeed = null;   // ddjp_564: an origin room starts at its origin
    const ev = (events || []).filter((e) => e && typeof e.l === "number" && !(e.type === "ddjp.checkpoint")).slice()
      .sort((a, b) => (a.l - b.l) || String(a.eventId || "").localeCompare(String(b.eventId || "")));
    const cuts = (baseSeed === null) ? (anchors || []).slice() : [{ l: -Infinity, seed: baseSeed }].concat(anchors || []);
    const out = [];
    for (let i = 0; i < cuts.length; i++) {
      const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : Infinity;
      out.push({ lo: lo, hi: hi, seed: cuts[i].seed, next: (i + 1 < cuts.length) ? cuts[i + 1] : null, seg: ev.filter((e) => e.l > lo && e.l <= hi) });
    }
    return out;
  }
  function deriveAnchored(events, anchors) {
    const all = (events || []).filter((e) => e && typeof e.l === "number");
    const posOf = Object.create(null); for (const e of all) if (e.eventId) posOf[e.eventId] = e.l;
    const rows = new Map(), floorChecks = [];
    const _an = _anchorsIn(all, anchors);
    if (_an.length && _an[0].origin && _an[0].seed && _an[0].seed.nowPlaying && _an[0].seed.nowPlaying.pi) { const np = _an[0].seed.nowPlaying;   // the origin's banked song, the first row
      rows.set(np.pi, { pi: np.pi, videoId: (np.song || {}).videoId || null, dj: np.dj || null, at: (typeof np.startedAt === "number") ? np.startedAt : null, skipped: !!np.skipped, l: _an[0].l, src: "floor" }); }
    for (const sg of _segments(all, _an, undefined)) {
      const r = _segmentRows(sg.seg, sg.seed, sg.next ? sg.next.seed : null, rows);
      if (!r) continue;
      for (const row of r.rows) if (!rows.has(row.pi) || row.src !== "floor") rows.set(row.pi, Object.assign({}, row, { l: posOf[row.pi] !== undefined ? posOf[row.pi] : row.l }));
      if (sg.next) floorChecks.push({ floorL: sg.next.l, segmentHead: r.live, floorHead: (sg.next.seed && sg.next.seed.nowPlaying) ? sg.next.seed.nowPlaying.pi : null });
    }
    return { rows: Array.from(rows.values()).sort((a, b) => (a.l || 0) - (b.l || 0)), floorChecks: floorChecks };
  }
  // VERIFY (`ddjp_560`): replace this device's rows within the re-derived range by the floor-anchored truth — a table built
  // by an earlier, wrong path (rows inside coverage are never re-read) is repaired once the room has been read from its start.
  function verifyFrom(events, anchors) {
    const all = (events || []).filter((e) => e && typeof e.l === "number");
    if (!all.some((e) => e.l <= 1)) return { ok: false, reason: "did-not-reach-the-start", changed: 0 };
    const hi = all.reduce((m, e) => Math.max(m, e.l), 0);
    const truth = deriveAnchored(all, anchors).rows;
    const key = (r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|");
    const before = new Set(_entries.filter((e) => e && typeof e.l === "number" && e.l <= hi).map(key));
    const after = new Set(truth.map(key));
    let changed = 0; for (const k of before) if (!after.has(k)) changed++; for (const k of after) if (!before.has(k)) changed++;
    _entries = _entries.filter((e) => !(e && typeof e.l === "number" && e.l <= hi));
    _mergeIn(truth.map((r) => Object.assign({}, r, { src: "verify", floorSig: _floorSig() })), null, true);
    _cover(0, hi);
    return { ok: true, changed: changed, rows: truth.length };
  }
  function _belowOrigin(r) { return !!(_origin && !_origin.start && r && typeof r.l === "number" && r.l <= _origin.l && !(_origin.banked && r.pi === _origin.banked.pi)); }
  function origin() { return _origin ? Object.assign({}, _origin) : null; }
  function setOrigin(o) {
    if (!o || typeof o.l !== "number") return;
    if (o.start) { if (!_origin) _origin = { l: 0, h: o.h || null, banked: null, start: true }; return; }
    if (_origin && !_origin.start && _origin.h === o.h) return;
    const np = o.seed && o.seed.nowPlaying;
    _origin = { l: o.l, h: o.h || null, start: false, banked: (np && np.pi) ? { pi: np.pi, videoId: (np.song || {}).videoId || null,
      dj: np.dj || null, at: (typeof np.startedAt === "number") ? np.startedAt : null, skipped: !!np.skipped, l: o.l, src: "floor" } : null };
    _entries = _entries.filter((r) => !_belowOrigin(r));
    if (_origin.banked) _mergeIn([Object.assign({}, _origin.banked)], null, false);
    _cover(0, o.l);
    for (const k of Object.keys(_verified)) if (_verified[k].hi <= o.l) delete _verified[k];
  }
  function markOpened() { _opened = true; }
  // DOES THIS TABLE KNOW THE FLOOR? (J79) A floor that opens or closes a segment this table verified stood, then, on the chain
  // from this table's origin — and a floor's ancestry never changes (`prev` is in its fingerprint). So a chain that starts at a
  // floor the table knows stands on the table's origin. One that starts at a floor it does NOT know may stand on a newer one —
  // an owner's restore since the table was stored — and the bridge pages once to find out (`_resolvedChain`).
  function knowsFloor(h) {
    if (typeof h !== "string" || !h) return false;
    if (_origin && _origin.h === h) return true;
    for (const k of Object.keys(_verified)) { const ab = k.slice(KEY_V.length).split(">"); if (ab[0] === h || ab[1] === h) return true; }
    return false;
  }
  // VERIFIED KEYS DO NOT OUTLIVE THEIR ROWS (`ddjp_562`, the owner's choice of two): when any path other than verify CHANGES a row
  // inside a verified segment, that segment's key is dropped, so the next verify re-derives it from the room. Verify stays the
  // only authority; an identical write changes nothing and keeps the key (an unchanged room still reads nothing). The one
  // exception: adding the row of the song in progress at the segment's closing floor — that row is the next segment's.
  function _dropKeysChangedBy(rows) {
    const keys = Object.keys(_verified); if (!keys.length) return;
    const byPi = new Map(_entries.map((r) => [r.pi, r]));
    for (const r of rows || []) {
      if (!r || typeof r.l !== "number") continue;
      const old = byPi.get(r.pi);
      if (old && _k3(old) === _k3(r)) continue;                        // identical: nothing changed
      for (const k of keys) { const v = _verified[k]; if (!v || r.l < v.lo || r.l > v.hi) continue;
        if (!old && ((v.live && r.pi === v.live) || (v.banked && r.pi === v.banked))) continue;   // the song in progress at the closing floor
        delete _verified[k]; }
    }
  }
  // WHERE A WRITER'S CUTS START (`ddjp_564`): at the origin floor (an override); after a known origin when the chain the device
  // remembers is shorter (Floor keeps 24); otherwise at the room's start, as before.
  function _cutsFrom(chain) {
    const ch = (chain || []).filter((c) => c && c.h && typeof c.l === "number" && c.seed);
    if (ch.length && ch[0].origin) { setOrigin(ch[0]); return ch.slice(); }
    if (ch.length && ch[0].prevNull) setOrigin({ start: true, l: 0, h: ch[0].h });
    if (_origin && !_origin.start && ch.length && ch[0].l > _origin.l) return ch.slice();
    return [{ h: "start", l: -Infinity, seed: undefined }].concat(ch);
  }
  // THE CACHE REBUILD, THROUGH THE SAME SEGMENT FUNCTION (`ddjp_563`): the closed segments of the accepted chain folded exactly as
  // verify folds them — so a second open corrects nothing — and the open stretch after the newest floor as refresh does.
  function rebuildAnchored(events, chain) {
    const ev = (events || []).filter((e) => e && typeof e.l === "number" && e.type !== "ddjp.checkpoint")
      .sort((x, y) => (x.l - y.l) || String(x.eventId || "").localeCompare(String(y.eventId || "")));
    const cuts = _cutsFrom(chain);
    let segments = 0, added = 0;
    for (let i = 0; i < cuts.length; i++) {
      const a = cuts[i], b = (i + 1 < cuts.length) ? cuts[i + 1] : null;
      const seg = ev.filter((e) => e.l > a.l && (!b || e.l <= b.l)); if (!seg.length) continue;
      if (!b) { const r = ingest(seg, a.seed, { src: "cache" }); added += (r && r.added) || 0; segments++; continue; }
      const sr = _segmentRows(seg, a.seed, b.seed, new Map(_entries.map((r) => [r.pi, r]))); if (!sr) continue;
      const rows = sr.rows.map((r) => Object.assign({}, r, { src: "cache", floorSig: _floorSig() }));
      _dropKeysChangedBy(rows);
      if (!_restoredOnce) for (const r of rows) if (typeof r.l === "number") _touchedBeforeRestore.push(r.l);
      const n0 = _entries.length; _mergeIn(rows.filter((r) => r.src !== "floor"), null, true); _mergeIn(rows.filter((r) => r.src === "floor"), null, false); added += Math.max(0, _entries.length - n0); segments++;
      _cover(Math.max(0, a.l + 1), b.l);
    }
    return { segments: segments, added: added };
  }
  // INCREMENTAL VERIFY (`ddjp_561`, the owner's audit of 560): only the floor-anchored segments not yet verified are read from the
  // room — on a later open of an unchanged room, none. `chain` = the accepted floors, oldest first ({ h, l, seed }). The stretch
  // after the newest floor is the held log's (refresh), not paged here.
  async function verifyIncremental(chain) {
    if (typeof _env.pageRange !== "function") return { ok: false, reason: "no-pager", pages: 0 };
    const cuts = _cutsFrom(chain).map((c) => (c.h === "start") ? { h: "start", l: 0, seed: undefined } : c);
    let pages = 0, verified = 0, skipped = 0, changed = 0;
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], key = KEY_V + a.h + ">" + b.h;   // versioned: marks made under an older rule re-verify once
      if (_verified[key]) { skipped++; continue; }
      const lo = (a.h === "start") ? 0 : a.l + 1, hi = b.l;
      let events = null; try { events = await _env.pageRange(lo, hi); pages++; } catch (e) { events = null; }
      if (!Array.isArray(events)) continue;
      if (a.h === "start" && !events.some((e) => typeof e.l === "number" && e.l <= 1)) continue;   // the room's start not reached: cannot verify
      const seg = events.filter((e) => e && typeof e.l === "number" && e.l >= lo && e.l <= hi && e.type !== "ddjp.checkpoint")
        .sort((x, y) => (x.l - y.l) || String(x.eventId || "").localeCompare(String(y.eventId || "")));
      const prev = new Map(_entries.map((r) => [r.pi, r]));
      const sr = _segmentRows(seg, a.seed, b.seed, prev);
      if (!sr) continue;
      const produced = sr.rows.map((r) => Object.assign({}, r, { src: r.src === "floor" ? "floor" : "verify", floorSig: _floorSig() }));
      const keepPi = new Set(produced.map((r) => r.pi)); if (sr.live) keepPi.add(sr.live); if (sr.banked) keepPi.add(sr.banked);   // never delete a banked song
      const before = _entries.filter((r) => r && typeof r.l === "number" && r.l >= lo && r.l <= hi);
      _entries = _entries.filter((r) => !(r && typeof r.l === "number" && r.l >= lo && r.l <= hi && !keepPi.has(r.pi)));
      const was = new Set(before.map(_k3)), now = new Set(produced.map(_k3));
      for (const k of was) if (!now.has(k)) changed++; for (const k of now) if (!was.has(k)) changed++;
      _mergeIn(produced.filter((r) => r.src !== "floor"), null, true); _mergeIn(produced.filter((r) => r.src === "floor"), null, false);   // a banked row is a fallback
      _cover(lo, hi); _verified[key] = { lo: lo, hi: hi, live: sr.live || null, banked: sr.banked || null }; verified++;
    }
    return { ok: true, pages: pages, verified: verified, skipped: skipped, changed: changed };
  }
  function auditAgainst(events, opts) {
    const evs = (Array.isArray(events) ? events : []).filter((e) => e && typeof e.l === "number").slice().sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));
    const posOf = Object.create(null); for (const e of evs) if (e.eventId) posOf[e.eventId] = e.l;
    // THE TRUTH IS FLOOR-ANCHORED (`ddjp_560`): one fold from the room's start diverges from the settled floors where a replay
    // and live acceptance differ; the app follows floors. The raw fold is still reported, where it disagrees.
    const _anch = deriveAnchored(evs, opts && opts.anchors);
    const truth = _anch.rows;
    let _raw = null; try { _raw = StateDeriver.derive(evs); } catch (e) { _raw = null; }
    const rawRows = (_raw && Array.isArray(_raw.history)) ? _raw.history : [];
    const mine = _entries.slice();
    const tset = new Map(truth.map((r) => [r.pi, r])), mset = new Map(mine.map((r) => [r.pi, r]));
    const ranges = _ranges.map((r) => r.slice());
    const why = (l) => { if (typeof l !== "number") return "position unknown";
      if (!ranges.length || l < ranges[0][0]) return "below the first covered position — never fetched";
      if (ranges.some((r) => l >= r[0] && l <= r[1])) return "claimed as covered, yet absent";
      return "in an uncovered hole"; };
    const row = (r) => ({ pi: r.pi, l: (typeof r.l === "number") ? r.l : (posOf[r.pi] !== undefined ? posOf[r.pi] : null), videoId: r.videoId || null, dj: r.dj || r.user || null });
    const missing = truth.filter((r) => !mset.has(r.pi)).map((r) => Object.assign(row(r), { why: why(posOf[r.pi]) }));
    const extra = mine.filter((r) => !tset.has(r.pi)).map((r) => Object.assign(row(r), { src: r.src || "unknown", floorSig: r.floorSig === undefined ? null : r.floorSig }));
    const differs = truth.filter((r) => mset.has(r.pi) && (mset.get(r.pi).videoId || null) !== (r.videoId || null))
      .map((r) => Object.assign(row(r), { deviceVideoId: mset.get(r.pi).videoId || null, src: mset.get(r.pi).src || "unknown" }));
    const rset = new Map(rawRows.map((r) => [r.pi, r]));
    const rawVsFloors = truth.filter((r) => !rset.has(r.pi)).map((r) => Object.assign(row(r), { raw: "absent" }))
      .concat(rawRows.filter((r) => !tset.has(r.pi)).map((r) => Object.assign(row(r), { raw: "only in the raw fold" })))
      .concat(truth.filter((r) => rset.has(r.pi) && (rset.get(r.pi).videoId || null) !== (r.videoId || null)).map((r) => Object.assign(row(r), { raw: "video " + rset.get(r.pi).videoId })));
    const anchorsUsed = _anchorsIn(evs, opts && opts.anchors);
    const rawHeads = anchorsUsed.map((a) => { let h = null; try { const s2 = StateDeriver.derive(evs.filter((e) => e.l <= a.l)); h = s2 && s2.nowPlaying ? s2.nowPlaying.pi : null; } catch (x) {} return { floorL: a.l, rawHead: h, floorHead: (a.seed && a.seed.nowPlaying) ? a.seed.nowPlaying.pi : null }; })
      .filter((x) => x.rawHead !== x.floorHead);
    return { truthCount: truth.length, deviceCount: mine.length, missing: missing, extra: extra, differs: differs, rawVsFloors: rawVsFloors, rawHeadsDisagree: rawHeads,
             floorChecks: _anch.floorChecks.filter((c) => c.segmentHead !== c.floorHead), coverage: { ranges: ranges, complete: !!(ranges.length && ranges[0][0] <= 0) },
             stored: _lastRestore ? Object.assign({}, _lastRestore) : null, eventsRead: evs.length, reachedFrom: (opts && typeof opts.reachedFrom === "number") ? opts.reachedFrom : null };
  }

  function restore(snap) {
    // An old stored ARRAY is rows only: kept, but it claims no reach (J73 job 6b).
    if (Array.isArray(snap)) snap = { v: 1, rows: snap };
    if (!snap || typeof snap !== "object" || (snap.v !== 1 && snap.v !== 2) || !Array.isArray(snap.rows)) {
      return { ok: false, reason: "unreadable", restored: 0 };
    }
    // Ranges first, then rows: eviction past MAX must find the ranges it has to clip.
    if (snap.v === 2 && Array.isArray(snap.ranges)) {
      for (const r of snap.ranges) if (Array.isArray(r)) _cover(r[0], r[1]);
      for (const k of Object.keys(snap.adds || {})) for (const ts of snap.adds[k] || []) {
        const i = k.indexOf("\u0000"); if (i > 0) _noteAdd(k.slice(0, i), k.slice(i + 1), ts);
      }
      for (const k of Object.keys(snap.addsL || {})) { const pl = (snap.addsL[k] || []).filter((x) => typeof x === "number"); if (pl.length) _addedL[k] = pl.slice(-4); }
    } else {
      // A v1 table is one range; "complete" there meant from the start.
      const lo = (snap.complete === true) ? 0 : snap.fromL;
      if (typeof lo === "number" && typeof snap.toL === "number") _cover(lo, snap.toL);
    }
    _mergeIn(snap.rows.filter((r) => r && typeof r.pi === "string").map((r) => r.src ? r : Object.assign({}, r, { src: "stored" })));
    _lastRestore = { rows: snap.rows.length, ranges: Array.isArray(snap.ranges) ? snap.ranges.slice() : null, v: snap.v };
    // MARKS RESTORED AFTER A WRITER TOUCHED A SEGMENT DO NOT COUNT (`ddjp_563`, the bot's open: 16 trims wrote rows before the
    // restore, and the restored marks then said "verified"); a mark of an older rule (no `v2|`) does not count either.
    if (snap.verified && typeof snap.verified === "object") for (const k of Object.keys(snap.verified)) { const v = snap.verified[k];
      if (!v || typeof v.hi !== "number" || k.indexOf(KEY_V) !== 0) continue;
      if (_touchedBeforeRestore.some((l) => l >= v.lo && l <= v.hi)) continue;
      _verified[k] = { lo: v.lo, hi: v.hi, live: v.live || null, banked: v.banked || null }; }
    _restoredOnce = true;
    if (snap.origin && typeof snap.origin.l === "number" && !_origin) { _origin = Object.assign({}, snap.origin); _entries = _entries.filter((r) => !_belowOrigin(r)); if (!_origin.start) _cover(0, _origin.l); }
    _coverageSig = null;   // a stored table's coverage was derived under a floor we cannot name: the next reconcile clips it
    return { ok: true, restored: _entries.length };
  }

  // ── WHAT MAY BE FORGOTTEN ─────────────────────────────────────────────────────────────────
  // The whole reason the table is stored: once a row is banked, the events behind it can go. This
  // answers WHICH, and it answers conservatively — the lowest position still needed.
  //
  // A row is safe to un-back only when a checkpoint covers it, because a play event does not name
  // its song and re-deriving needs either the events or the seed. So: keep every event above the
  // floor's cut. Below it the checkpoint carries the queue state and the events are redundant.
  //
  // Returns null when nothing may be dropped — no floor, or no rows — and null is the honest
  // answer rather than a position that happens to be safe. A caller that could not tell "drop
  // below 40" from "I do not know" would drop on not-knowing, which is the one irreversible act
  // here.
  //
  // ── NOTHING CALLS THIS YET, AND THAT IS DELIBERATE ────────────────────────────────────────
  // Audited and left: the RULE and its guard exist, the eviction does not. Deleting events is the
  // one act in this module that cannot be undone, and it is not being wired until the table has
  // survived real reloads in a real room. **Named here rather than left to be discovered**,
  // because an unused predicate is indistinguishable from a missing feature and this tree has
  // found that shape six times this cycle — the difference is that this one is written down.
  //
  // `unbackedRows` and `backing` are in the same position for the same reason: they answer the
  // question a future evictor must ask before it drops anything, and they are guard-driven now so
  // the answer is known-good on the day something acts on it.
  function droppableBelow(floorL) {
    if (typeof floorL !== "number" || !_entries.length) return null;
    return floorL;
  }

  function coverage() {
    const n = _ranges.length;
    const complete = n === 1 && _ranges[0][0] <= 0;
    return { fromL: n ? _ranges[0][0] : null, toL: n ? _ranges[n - 1][1] : null, complete: complete,
             entries: _entries.length, cap: MAX, ranges: _ranges.map((r) => r.slice()),
             // where the unbroken stretch back from the newest position starts — the only reach a
             // decision may use (`Room.playedWithin`)
             topFromL: n ? _ranges[n - 1][0] : null };
  }

  // A room change clears everything. Per-room state that survives a room change is its own bug
  // class, and history is per-room by definition.
  function reset() { _entries = []; _ranges = []; _added = Object.create(null); _addedL = Object.create(null); }

  function _setForTest(list) { _entries = (list || []).slice(); }

  return {
    auditAgainst, deriveAnchored, verifyFrom, verifyIncremental, rebuildAnchored, origin, setOrigin, markOpened, knowsFloor, MAX, attach, noteAdds, addedAt, addedAtL, holes, fillGaps, reconcileFloor, unbackedRows, backing, snapshot, restore, droppableBelow, ingest, refresh, _looksLikeSegment, backfill, recent, count, coverage, reset, foldRange, merge, _setForTest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { History };
