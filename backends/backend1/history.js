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
  function _mergeIn(incoming, finals) {
    const before = new Set(_entries.map((e) => e && e.pi));
    let unique = _entries.length;
    for (const e of (incoming || [])) if (e && e.pi && !before.has(e.pi)) { before.add(e.pi); unique++; }
    _entries = merge(_entries, incoming);
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
  }
  function holes() {
    const out = [];
    let at = 0;
    for (const r of _ranges) { if (r[0] > at) out.push([at, r[0] - 1]); at = r[1] + 1; }
    return out;
  }

  function attach(env) { _env = Object.assign({}, _env, env || {}); }

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
  function merge(existing, incoming) {
    const byPi = Object.create(null);
    const out = [];
    for (const list of [existing || [], incoming || []]) {
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
    noteAdds(list, acc ? (id) => acc.has(id) : null);
    const lo = (opts && typeof opts.from === "number") ? opts.from
      : list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l < m)) ? e.l : m, null);
    const hi = (opts && typeof opts.to === "number") ? opts.to
      : list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l > m)) ? e.l : m, null);
    _cover(lo, hi);
    _mergeIn(folded, _finals);
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
    const log = _env.log() || [];
    if (!log.length) return { added: 0, total: _entries.length };
    const isSegment = _looksLikeSegment(log);
    const s = (seed !== undefined) ? seed : (isSegment ? _floorSeed() : undefined);
    if (isSegment && s === undefined) {
      return { added: 0, total: _entries.length, refused: "segment-without-seed" };
    }
    // THE HELD LOG IS COMPLETE FROM JUST ABOVE THE FLOOR (owner's re-test, `ddjp_535`): covered from there, not from its
    // first event — else the save point's own position, between the cut and the first held event, stays a hole until
    // the NEXT move-on, and the repeat rule cannot tell. A real gap below the floor then shows as a hole to fill.
    let from;
    try { const h = (typeof _env.heldFrom === "function") ? _env.heldFrom() : null; const f0 = log[0] && log[0].l;
          if (typeof h === "number") from = (typeof f0 === "number") ? Math.min(h, f0) : h; } catch (e) { from = undefined; }
    return ingest(log, s, (typeof from === "number") ? { retain: true, from: from } : { retain: true });   // the held log is the live room: prune added times to its queue
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
    const r = ingest(events.filter((e) => typeof e.l === "number" && e.l >= reached), seed, { from: reached, to: ceiling });
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
        ingest(seg, cuts[i].seed, { from: Math.max(a, lo + 1), to: hi });
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
    if (dropped > 0) {
      const top = _entries.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l > m)) ? e.l : m, null);
      // NEVER BELOW THE CUT (owner's test): everything at or below the cut is covered by the floor itself, whether or not a
      // row sits near it; only what lay above the cut goes, to be re-read. Trimming to the last row left a false hole.
      const keep = (cut !== null) ? Math.max(cut, top === null ? -Infinity : top) : top;
      _ranges = (keep === null) ? [] : _ranges.filter((r) => r[0] <= keep).map((r) => [r[0], Math.min(r[1], keep)]);
    }
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
             fromL: c.fromL, toL: c.toL, complete: c.complete };
  }
  // TOTAL. Junk, a missing file, or a version this build does not know all restore to "nothing",
  // because every row is derivable — losing the table costs one re-fold and never a fact. A
  // restore that threw would take the pane down over a cache.
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
    _mergeIn(snap.rows.filter((r) => r && typeof r.pi === "string"));
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

  return { MAX, attach, noteAdds, addedAt, addedAtL, holes, fillGaps, reconcileFloor, unbackedRows, backing, snapshot, restore, droppableBelow, ingest, refresh, _looksLikeSegment, backfill, recent, count, coverage, reset, foldRange, merge, _setForTest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { History };
