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
  let _coveredFrom = null;  // the position we have read back to, or null for "nothing yet"
  let _coveredTo = null;    // the newest position folded in
  let _complete = false;    // have we read all the way to the room's beginning?

  let _env = {
    // NO SILENT GLOBAL FALLBACK. An unwired module must answer "I hold nothing" rather than
    // quietly working off whatever happens to be loaded.
    log: () => [],
    seed: null,             // () => the floor's seed, so a trimmed log can still be folded
    pageRange: null,        // optional: (fromL, toL) => Promise<events> for lazy backfill
  };
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
  function ingest(events, seed) {
    const list = Array.isArray(events) ? events : [];
    if (!list.length) return { added: 0, total: _entries.length };
    const before = _entries.length;
    // ATTACH THE POSITION. A play instance IS an event id, so the events we were handed tell us
    // where each play sat. The reducer's history entries carry a timestamp but no position, and
    // ordering a display by a display value is what this fixes.
    const posOf = Object.create(null);
    for (const e of list) {
      const id = e && (e.eventId || e.event_id);
      if (id && typeof e.l === "number") posOf[id] = e.l;
    }
    // ── THE FLOOR THIS STRETCH WAS SETTLED UNDER ────────────────────────────────────────
    // A play event does NOT name its song: its body is `{t, p}` and the video is whatever the
    // reducer pops off the head DJ's queue. So a row's CONTENT depends on the fold, and the fold
    // depends on which floor the trust cascade selected. When a higher rank publishes a floor that
    // disagrees, every row derived under the replaced answer is wrong — and without recording
    // which floor that was, there is no way to say WHICH rows. The pane then keeps them for the
    // life of the room, which is the shape that gets weird over time.
    //
    // `null` is a real answer meaning "folded from genesis, under no floor", and it is kept
    // distinct from a signature — but NOT because such a row is immune. An earlier version of this
    // comment claimed a genesis-derived row "is not invalidated by a floor changing, because it
    // never rested on one", and the code has always done the opposite: audited (A7), a pane of six
    // null-stamped rows meeting a floor at cut 5 keeps two and drops four.
    //
    // THE CODE IS RIGHT AND THE COMMENT WAS WRONG. A row folded from this client's own genesis view
    // is exactly the kind that a same-position race corrupts — it is the LEAST trustworthy row,
    // not the most. Above a floor's cut it is dropped and re-read from the room, which is what
    // converges two clients that disagreed. Below the cut the checkpoint covers it and it stays.
    //
    // What `null` is really for is telling a reader HOW a row was derived, so a pane full of them
    // is recognisable as a client that has never had a floor rather than one whose stamps are
    // missing.
    const stamp = _floorSig();
    const folded = foldRange(list, seed).map((h) => {
      if (!h) return h;
      const withPos = (posOf[h.pi] !== undefined) ? Object.assign({}, h, { l: posOf[h.pi] }) : Object.assign({}, h);
      withPos.floorSig = stamp;
      return withPos;
    });
    _entries = merge(_entries, folded);
    const lo = list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l < m)) ? e.l : m, null);
    const hi = list.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l > m)) ? e.l : m, null);
    if (lo !== null && (_coveredFrom === null || lo < _coveredFrom)) _coveredFrom = lo;
    if (hi !== null && (_coveredTo === null || hi > _coveredTo)) _coveredTo = hi;
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
    return ingest(log, s);
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
    const ceiling = (_coveredFrom !== null) ? _coveredFrom
                  : ((typeof toL === "number") ? toL : null);
    if (ceiling === null) return { ok: false, reason: "nothing-read-yet" };
    if (fromL >= ceiling) return { ok: true, added: 0, reason: "already-covered" };
    let events = null;
    try { events = await _env.pageRange(fromL, ceiling); }
    catch (e) { return { ok: false, reason: "page-threw" }; }
    if (!Array.isArray(events) || !events.length) return { ok: false, reason: "page-empty" };
    const r = ingest(events, seed);
    if (fromL <= 0) _complete = true;
    return { ok: true, added: r.added, total: r.total };
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
      _coveredTo = _entries.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l > m)) ? e.l : m, null);
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
    return { v: 1, rows: _entries.slice(), fromL: _coveredFrom, toL: _coveredTo, complete: _complete };
  }
  // TOTAL. Junk, a missing file, or a version this build does not know all restore to "nothing",
  // because every row is derivable — losing the table costs one re-fold and never a fact. A
  // restore that threw would take the pane down over a cache.
  function restore(snap) {
    if (!snap || typeof snap !== "object" || snap.v !== 1 || !Array.isArray(snap.rows)) {
      return { ok: false, reason: "unreadable", restored: 0 };
    }
    // Through `merge` rather than by assignment, so a restore into a session that has already
    // folded something behaves like any other ingest — dedup and ordering are the same code.
    _entries = merge(_entries, snap.rows.filter((r) => r && typeof r.pi === "string"));
    if (typeof snap.fromL === "number" && (_coveredFrom === null || snap.fromL < _coveredFrom)) _coveredFrom = snap.fromL;
    if (typeof snap.toL === "number" && (_coveredTo === null || snap.toL > _coveredTo)) _coveredTo = snap.toL;
    if (snap.complete === true) _complete = true;
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
    return { fromL: _coveredFrom, toL: _coveredTo, complete: _complete, entries: _entries.length, cap: MAX };
  }

  // A room change clears everything. Per-room state that survives a room change is its own bug
  // class, and history is per-room by definition.
  function reset() { _entries = []; _coveredFrom = null; _coveredTo = null; _complete = false; }

  function _setForTest(list) { _entries = (list || []).slice(); }

  return { MAX, attach, reconcileFloor, unbackedRows, backing, snapshot, restore, droppableBelow, ingest, refresh, _looksLikeSegment, backfill, recent, count, coverage, reset, foldRange, merge, _setForTest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { History };
