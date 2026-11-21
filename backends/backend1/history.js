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
// WHY IT MAY NOT FEED BACK. A play's songKey is NOT a field in the play event — it is whatever the
// reducer pops from the head DJ's buffer. So history has to be DERIVED by folding, never scanned
// off the events in isolation. That makes it tempting to reuse the live fold, which is exactly the
// coupling this module exists to remove. Instead it folds independently, and the one rule is that
// nothing here is ever read for truth: reducer-inert, display-only, and it can be wrong or absent
// without the room noticing.
//
// Depends on: StateDeriver (the fold); reads Floor's signature when loaded. Fed by the transport and
// by the engine's trim hand-offs; nothing reads it for truth (`check-history` G: it names neither).
// It ANNOUNCES (J130's correction, `ddjp_662`; BEHAVIOUR.md's fifth announcer): `onChange` says it wrote — see THE NOTICE.

const History = (() => {

  // The window the pane can show. 5000 is the same number the old tree used, and the POLICY is the
  // meaningful part rather than the number: history is REGENERABLE from the log, so it evicts the
  // oldest when full. Contrast the queue and playlists, which are local truth and REFUSE a new item
  // instead — losing your data is worse than refusing to add to it.
  const MAX = 5000;
  // THE ROOM'S WINDOW (the owner's `historySize`, `consensus/history-rules.md` §10 and §12): how many songs this room's history
  // keeps and reads back to, read live from the room's settings through the env (`size`). `MAX` stays the ceiling — the most
  // any room may ask for, and the reducer's own — so a value that is not a whole number from 1 to `MAX` reads as `MAX`
  // (the reducer refuses anything outside 500–5000 already; this only refuses to be the place a bad value lands).
  function _max() {
    let v = null;
    try { v = (typeof _env.size === "function") ? _env.size() : null; } catch (e) { v = null; }
    return (Number.isSafeInteger(v) && v >= 1 && v <= MAX) ? v : MAX;
  }

  let _entries = [];        // oldest -> newest
  // COVERAGE IS A LIST OF RANGES (J73 job 6, Q8). One range could not say "I hold my last visit and
  // everything since a newer save point, but not the songs in between" — it spanned the gap and
  // claimed it. Each range is [lo, hi] in positions READ, merged when they touch. COMPLETE means one
  // range reaching the room's start: no holes all the way down.
  let _ranges = [];          // [[lo, hi], ...] ascending, disjoint
  // ADDED TIMES (J73 Q10): who added which video, and when — the latest few per person and video.
  // Kept only while that song is queued or playing; the same device store as the rows.
  let _added = Object.create(null);   // user \u0000 songKey -> [ts ascending] (at most 4)
  let _addedL = Object.create(null);   // the same adds, by ROOM POSITION (the owner's repeat rule)
  let _retainKeep = null;   // the add keys the last retain kept (queued or playing songs)
  let _lastRestore = null;   // the stored table's origin, for the audit (ddjp_559)
  // SEGMENTS VERIFIED AGAINST THE ROOM (`ddjp_561`): key = the fingerprints of the two floors that bound it -> { lo, hi }. A
  // replaced floor is a new key; a coverage reset forgets the keys above its cut. Persisted with the table.
  let _verified = Object.create(null);
  // THE ORIGIN (`ddjp_564`): the room's start, reached by the chain's first floor (`prev` null) and recorded so a long chain
  // need not be walked again. Persisted with the table. (A second kind — an owner's restore from a save file, with the rows
  // below its cut dropped — went with room files at J82, owner's ruling 1; a table that stored one restores none.)
  let _origin = null;   // { l: 0, h, banked: null, start: true }
  let _opened = true;   // false until the open's restore step, when the env asks to await it
  let _openedEpoch = -1;   // the room (`_epoch`) the open step last opened the table for (J89)
  // THE RULE A "VERIFIED" MARK WAS MADE UNDER (the owner's ruling 42, J92). `v3`: the room's order as the engine keeps it — ids by
  // code unit (J91). A table stored before `?v=540` holds `v2` marks, made by locale order, and its wrong rows were never read
  // again: the owner's `?v=540` audit, "missing $P4cT… at l=53 — claimed as covered, yet absent; extra $mt8E… — from cache".
  // A mark of an older rule does not count (`restore`), so each such segment is re-verified once, in the engine's order.
  const KEY_V = "v3|";
  let _touchedBeforeRestore = [], _restoredOnce = false;   // positions written before the first restore (ddjp_563)
  // EVERY END A FOLD SAW THIS SESSION, BY PLAY (`_endsOnto`, §12): pi -> server stamp, the newest kept, at most MAX. The song at a
  // save point's cut is seen to end by the fold ABOVE the save point, which has no row for it — and a newest-first open folds
  // that stretch before the one below that makes the row. Here the row takes its end when it arrives (`_mergeIn`). Not stored:
  // a later open that reads neither stretch again keeps the end the stored row holds (none, if it never had one).
  let _seenEnds = new Map();
  // THE BOT'S SUMMARIES, TAKEN (the owner's design, `consensus/history-rules.md` §12; the format: `core/historysummary.js`): each
  // summary this table took, by its serial — the stretch of positions it covers and the room's song count up to it. Their rows are
  // in `_entries` with `src: "summary"` and `sum: <serial>`. Persisted with the table. A summary's stretch is NOT coverage read
  // from the room's events (`_ranges`): it counts towards what song history holds — the window, the holes, the replay rule's
  // reach — and never towards `complete`, which the fold is told (`StreamManager.setHistoryComplete`) and which keeps meaning
  // "this device read the room's start" (the permissive direction is closed: a summary never counts as holding the room's events).
  let _sums = [];             // [{ n, from, to, count }] ascending by `from`
  let _differSaid = new Set();   // plays whose disagreement with the bot was said this visit (cleared with the room)
  const _isBot = (r) => !!(r && r.src === "summary");

  let _env = {
    // NO SILENT GLOBAL FALLBACK. An unwired module must answer "I hold nothing" rather than
    // quietly working off whatever happens to be loaded.
    log: () => [],
    seed: null,             // () => the floor's seed, so a trimmed log can still be folded
    pageRange: null,        // optional: (fromL, toL) => Promise<events> for lazy backfill
    anchorOf: null,         // optional: (event) => { l, seed } when the event is a save point with a seed
    size: null,             // optional: () => the room's `historySize` (the window); none, or not a whole number to MAX: MAX
    say: null,              // optional: (line) => a log line — a summary disagreeing with this device's own row, said once a play
  };
  function _say(line) { try { if (typeof _env.say === "function") _env.say(line); } catch (e) { /* a log that fails is its own */ } }
  function _cover(lo, hi) {
    if (typeof lo !== "number" || typeof hi !== "number" || hi < lo) return;
    // NOTHING BELOW THE WINDOW IS CLAIMED ONCE THE WINDOW IS HELD (the owner's, `consensus/history-rules.md` §10): a writer that
    // folded a stretch whose rows were then evicted re-claimed it here, so a table of 5000 songs said it reached the room's start.
    const w = windowFrom();
    if (w !== null) { if (hi < w) return; if (lo < w) lo = w; }
    const all = _ranges.concat([[lo, hi]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    _ranges = out;
    _wrote = true;
  }
  // EVICTION LOWERS THE CLAIMED REACH (J73 job 6). Rows past the room's window (`_max()`) are dropped oldest first; what lay
  // below the oldest kept row is no longer known, so no range may claim it.
  function _clipBelow(l) {
    if (typeof l !== "number") return;
    _ranges = _ranges.filter((r) => r[1] >= l).map((r) => [Math.max(r[0], l), r[1]]);
    // and a verify mark for a stretch wholly below what is kept: the window never reads it again, so the table does not carry it
    for (const k of Object.keys(_verified)) if (_verified[k] && typeof _verified[k].hi === "number" && _verified[k].hi < l) delete _verified[k];
    // and a summary's stretch the same way as a range: what lay below the oldest kept row is no longer held (its serial stays known)
    _sums = _sums.filter((s) => s.to >= l).map((s) => (s.from < l ? Object.assign({}, s, { from: l }) : s));
    _wrote = true;
  }
  // WHAT SONG HISTORY HOLDS: the positions read from the room's events (`_ranges`) and the stretches the bot's summaries cover, as one
  // list of ranges, merged where they touch. Every reader of "how far does it reach" reads this; `complete` alone reads `_ranges`.
  function _spans() {
    if (!_sums.length) return _ranges;
    const all = _ranges.concat(_sums.map((s) => [s.from, s.to])).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of all) { const last = out[out.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]); }
    return out;
  }
  // Is every position of [lo, hi] inside a stretch the bot's summaries cover (joined)? Verify and the cache rebuild compute nothing there.
  function _insideSums(lo, hi) {
    if (!_sums.length || typeof lo !== "number" || typeof hi !== "number") return false;
    if (hi < lo) return true;
    let at = lo;
    for (const s of _sums) { if (s.from > at) break; if (s.to >= at) at = s.to + 1; if (at > hi) return true; }
    return at > hi;
  }
  // Where the NEWEST stretch of [lo, hi] that neither the room's events read nor the bot's summaries hold begins, or null: how deep a
  // read below a floor has to go next where summaries hold the rest (verify's walk, §12) — the nearest hole first; a deeper one is
  // the next step's, if the table still needs it.
  function _newestUnheld(lo, hi) {
    let at = lo, last = null;
    for (const r of _spans()) {
      if (r[1] < at) continue;
      if (r[0] > hi) break;
      if (r[0] > at) last = at;
      at = r[1] + 1;
      if (at > hi) return last;
    }
    return at <= hi ? at : last;
  }
  // The summary of the NEWEST STRETCH taken — the one reaching highest, the higher serial on a tie — or null. Its count is the room's
  // up to the newest summarised song. (An old stretch sent again — a correction an older build sent — has a higher serial and an old
  // count: not this one.)
  function _newestSum() { let t = null; for (const s of _sums) if (!t || s.to > t.to || (s.to === t.to && s.n > t.n)) t = s; return t; }
  // THE SUMMARY'S SONG COUNT, MET (his words 4, item 7: "we know room start distance"): the newest summary says how many songs the room
  // has had from its start up to its stretch's end, counted up to the history size; the rows running back unbroken from the newest
  // position, at or below that end, number at least that many — so the table holds the room's start (a count below the history size)
  // or its window, and nothing further back is needed. Never `complete`: that is the room's events reaching the start.
  // A COUNT BELOW THE HISTORY SIZE SAYS THE ROOM'S START (738, open (g)), so the summaries that hold it reach position 0: the bot
  // writes its first summary from the room's start whenever its table holds it, and a reader stops only once its rows reach that
  // count, so it has taken them back to there. A count the bot STOPPED at an older, smaller size — the size since raised — reads as
  // the room's start too, and is not: the room had at least that many songs. The marks such a table holds start above 0 (clipped
  // below its old window, or read only as far as that count), and that is what tells the two apart. 737 read it as exact: after a
  // raise from 500 to 1000 a room of 1,202 songs said `fromStart`, and a device stopped reading at the old count (driven at 738).
  function _countMet() {
    const s = _newestSum();
    if (!s || !(s.count >= 0)) return false;
    if (s.count < _max() && !(_sums.length && _sums[0].from <= 0)) return false;
    const sp = _spans(), last = sp[sp.length - 1];
    if (!last || s.to < last[0] || s.to > last[1]) return false;
    let n = 0;
    for (const e of _entries) if (e && typeof e.l === "number" && e.l >= last[0] && e.l <= s.to) n++;
    return n >= Math.min(s.count, _max());
  }
  // ── THE WINDOW: THE ROOM'S NEWEST `_max()` SONGS (the owner's, his words in `consensus/history-rules.md` §10: "its not supposed to
  // read past 5000 (to start)", "stopping at 5000 is priority no loading to start if so") ───────────────────────────────────────
  // The table HOLDS the window when it keeps `_max()` songs (the room's `historySize`, at most `MAX`) and one unbroken range of positions read runs from the oldest of them up to
  // the newest covered position — no hole between the newest song and the 5000th back. Then nothing below that oldest song is
  // needed: no reader pages below it (`holes`, `fillGaps`, `backfill`, `verifyIncremental`, the bridge's chain walk and audit),
  // and coverage never claims below it (`_cover`). Its position, or null while the window is not held. `complete` (the room's
  // start reached) is a different fact and keeps its meaning: the fold is told it (`StreamManager.setHistoryComplete`).
  // The same "unbroken stretch back from the newest" `coverage().topFromL` gives `Room.playedWithin`.
  // The bot's summaries count here as what the table holds (`_spans`, §12).
  function windowFrom() {
    const sp = _spans(), n = sp.length;
    if (!n || _entries.length < _max()) return null;
    const lo = _entries[0] && _entries[0].l;
    if (typeof lo !== "number") return null;
    return (sp[n - 1][0] <= lo) ? lo : null;
  }
  // The room's start held: read from its events, or held unbroken from it by events and the bot's summaries together, or the newest
  // summary's count — below the history size — met. Not `complete` (events only), which the fold is told.
  function _fromStart() {
    const n = _ranges.length;
    if (n === 1 && _ranges[0][0] <= 0) return true;
    const sp = _spans();
    if (sp.length === 1 && sp[0][0] <= 0) return true;
    const s = _newestSum();
    return !!(s && s.count < _max() && _countMet());
  }
  // The table holds all it needs: the room's start, or the window — the newest summary's count met is either (§12).
  function _full() { return _fromStart() || windowFrom() !== null || _countMet(); }
  // Rows above position `l`: the songs a read below `l` no longer has to find. Each song is at least one position (its advance),
  // so the window's oldest song lies at least `_max() - _rowsAbove(l)` positions below `l` — a read that deep cannot pass it.
  function _rowsAbove(l) { let n = 0; for (const e of _entries) if (e && typeof e.l === "number" && e.l > l) n++; return n; }
  // The highest position a verify mark checked below `l` (null: none) — where an earlier open's checks resume under a floor.
  function _verifiedTopBelow(l) {
    let top = null;
    for (const k of Object.keys(_verified)) { const v = _verified[k]; if (v && typeof v.hi === "number" && v.hi < l && (top === null || v.hi > top)) top = v.hi; }
    return top;
  }
  // Is every position of [lo, hi] inside a stretch verify has checked (its marks' ranges, joined)?
  function _verifiedSpan(lo, hi) {
    if (typeof lo !== "number" || typeof hi !== "number") return false;
    if (hi < lo) return true;
    const rs = Object.keys(_verified).map((k) => _verified[k]).filter((v) => v && typeof v.lo === "number" && typeof v.hi === "number").sort((a, b) => a.lo - b.lo);
    let at = lo;
    for (const v of rs) { if (v.lo > at) break; if (v.hi >= at) at = v.hi + 1; if (at > hi) return true; }
    return at > hi;
  }
  // HOW EACH SONG ENDED (J131's correction; the reducer's THE ENDING, BY PLAY): `ended` is a fold's by-play record
  // (`state.cutShortBy`), written onto the row of that play, held or incoming — a fold from a save point has no row for the save
  // point's song, yet sees it end. A fold that saw a song end is the answer (a race settled the other way corrects it); one that
  // did not leaves what the row held, kept through a rewrite as the tallies are.
  function _mergeIn(incoming, finals, incomingWins, ended, reasons) {
    const _hadEnd = Object.create(null), _hadWhy = Object.create(null);
    for (const e of _entries) if (e && e.pi && e.cutShortBy !== undefined) _hadEnd[e.pi] = e.cutShortBy;
    for (const e of _entries) if (e && e.pi && e.endedBy !== undefined) _hadWhy[e.pi] = e.endedBy;
    const _hadAt = Object.create(null);   // and when it ended (`endedAt`, §12), kept through a rewrite below
    for (const e of _entries) if (e && e.pi && typeof e.endedAt === "number") _hadAt[e.pi] = e.endedAt;
    // THE BOT'S ROW IS KEPT (§12, the owner's answer 6: devices believe the bot): a row this device derives for a play a summary
    // names never replaces the bot's (`merge`), and where it says something else the difference is said once a play. Nothing more:
    // nothing corrects a summary after the fact (740, the owner's words in `consensus/history-rules.md` §12 — 738 kept this device's
    // reading beside the bot's row, for the corrections its tab sent).
    const _bot = new Map();
    for (const e of _entries) if (_isBot(e)) _bot.set(e.pi, e);
    if (_bot.size) for (const r of (incoming || [])) if (r && !_isBot(r) && _bot.has(r.pi)) _differ(_bot.get(r.pi), r);
    // AND A SUMMARY IS THE ACCOUNT OF ITS STRETCH: a play this device derives inside one that no summary names does not enter (said
    // once, as `takeSummaries` says the rows it lets go) — a later refresh, verify or fill cannot put back what the bot's account left out.
    if (_sums.length && incoming && incoming.length) incoming = incoming.filter((r) => {
      if (!r || _isBot(r) || typeof r.l !== "number" || _bot.has(r.pi) || !_sums.some((m) => r.l >= m.from && r.l <= m.to)) return true;
      if (!_differSaid.has(r.pi)) { _differSaid.add(r.pi);
        _say(r.pi + " at l=" + r.l + " (" + (r.songKey || "no song") + ", from " + (r.src || "unknown") + ") is not in the bot's summaries for that stretch — it is not taken into song history"); }
      return false;
    });
    const before = new Set(_entries.map((e) => e && e.pi));
    let unique = _entries.length;
    for (const e of (incoming || [])) if (e && e.pi && !before.has(e.pi)) { before.add(e.pi); unique++; }
    // FINAL IS FINAL, ALSO WHEN ANOTHER PATH REWRITES THE ROW (J96, the owner's call on J95's finding): verify's rows carry no
    // counts, and the backfill a trim rearms runs verify over every closed song — so the rows that won here dropped the tallies
    // the rows they replaced held, on every tab, moments after every trim (`check-history-tallies` F). Taken before the merge.
    const _had = Object.create(null);
    for (const e of _entries) if (e && e.pi && e.counts) _had[e.pi] = e.counts;
    _entries = merge(_entries, incoming, incomingWins, _max());
    _wrote = true;
    // A row first seen while its song was live has no counts; once a fold sees it ended, it gets them.
    // Final is final: a row that has counts keeps them — a fold's own finals first, then what the row already held. So a LATER
    // count — a late vote on a finished song, the owner's count change — replaces the one the row held (J97: `check-history-tallies` G).
    const _final = Object.assign(Object.create(null), _had, finals || {});
    for (const e of (incoming || [])) if (e && e.pi && e.counts) _final[e.pi] = e.counts;
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (e && !e.counts && _final[e.pi]) _entries[i] = Object.assign({}, e, { counts: _final[e.pi] });
    }
    // (A ROW FROM A SUMMARY says how its song ended and when itself: the passes below leave it as the bot wrote it, §12.)
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (!e || !e.pi || _isBot(e)) continue;
      const v = (ended && Object.prototype.hasOwnProperty.call(ended, e.pi)) ? ended[e.pi] : (e.cutShortBy !== undefined ? e.cutShortBy : _hadEnd[e.pi]);
      if (v !== undefined && e.cutShortBy !== v) _entries[i] = Object.assign({}, e, { cutShortBy: v });
    }
    // THE REASON, BY PLAY, THE SAME WAY (`state.endedBy`, the owner's §11: "we see them in history with skipped"): the token a skip
    // named lands on the row of the play it ended, so `Room.playedWithin` does not count a repeat skip as a play where the fold
    // that saw it end started at a save point. A fold that saw the song end is the answer — null (no token) clears what the row
    // held; one that did not leaves it. The row's word ("skipped") is `cutShortBy`'s and unchanged.
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (!e || !e.pi || _isBot(e)) continue;
      const v = (reasons && Object.prototype.hasOwnProperty.call(reasons, e.pi)) ? reasons[e.pi] : (e.endedBy !== undefined ? e.endedBy : _hadWhy[e.pi]);
      if (v === null && e.endedBy !== undefined) { const c = Object.assign({}, e); delete c.endedBy; _entries[i] = c; }
      else if (typeof v === "string" && e.endedBy !== v) _entries[i] = Object.assign({}, e, { endedBy: v });
    }
    // WHEN IT ENDED, KEPT THROUGH A REWRITE as the tallies are (`endedAt`, written by `_endsOnto` after the fold that saw it): a
    // row without its end takes the newest one a fold saw this session (`_seenEnds`: a row that arrives after its end was seen),
    // else the one it held.
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (!e || !e.pi || e.endedAt !== undefined || _isBot(e)) continue;
      const v = _seenEnds.has(e.pi) ? _seenEnds.get(e.pi) : _hadAt[e.pi];
      if (v !== undefined) _entries[i] = Object.assign({}, e, { endedAt: v });
    }
    if (unique > _max() && _entries.length && typeof _entries[0].l === "number") _clipBelow(_entries[0].l);
  }
  // ── WHEN EACH SONG ENDED, WORKED OUT HERE (the owner's, `ddjp_736`: song history is "modular and downstream of the machinery, no
  // affect on room state"; `consensus/history-rules.md` §12) ─────────────────────────────────────────────────────────────────
  // Never written by the fold. A play ends at the advance the fold ACCEPTED that names it as the song it ends (`p`): the advance
  // lock (`canAdvance`) lets exactly one such advance through, so the play's end is that event's server stamp (`ts`). Read from
  // the events a fold was given and the fold's own verdict on them (`deriveBoth`'s `accepted`); without a verdict, nothing — an
  // end is never guessed. Answers { pi: ts }.
  function _endsIn(list, accepted) {
    const out = Object.create(null);
    if (!Array.isArray(accepted) || !accepted.length) return out;
    const acc = new Set(accepted.map(String));
    for (const e of (list || [])) {
      const t = e && (e.type || (e.content && e.content.t));
      if (!_ADVANCES[t] || !acc.has(_idOf(e))) continue;
      const p = e.content && e.content.p;
      if (typeof p === "string" && p && typeof e.ts === "number" && e.ts > 0) out[p] = e.ts;
    }
    return out;
  }
  // The ends one fold saw, onto the rows held now — a save point's song among them, which a fold from that save point sees end
  // but has no row for (as `ended` above). A fold that saw a song end is the answer; a row it did not see end keeps what it held.
  function _endsOnto(ends) {
    if (!ends) return;
    for (const pi of Object.keys(ends)) { _seenEnds.delete(pi); _seenEnds.set(pi, ends[pi]); }
    while (_seenEnds.size > MAX) _seenEnds.delete(_seenEnds.keys().next().value);   // the oldest seen goes
    for (let i = 0; i < _entries.length; i++) {
      const e = _entries[i];
      if (e && e.pi && !_isBot(e) && Object.prototype.hasOwnProperty.call(ends, e.pi) && e.endedAt !== ends[e.pi]) { _entries[i] = Object.assign({}, e, { endedAt: ends[e.pi] }); _wrote = true; }
    }
  }
  // ── A SUMMARY DISAGREEING WITH THIS DEVICE'S OWN ROW (§12, open (d) at 737): said once a play a visit, the bot's row kept. Only what
  // both rows say is compared — a field this device does not know (no tally yet, no end) is no disagreement.
  const _FIELDS = [["songKey", (r) => r.songKey], ["DJ", (r) => r.dj], ["start", (r) => r.at], ["end", (r) => r.endedAt],
    ["votes", (r) => (r.counts ? r.counts.votes : undefined)], ["saves", (r) => (r.counts ? r.counts.saves : undefined)],
    ["ending", (r) => r.cutShortBy], ["reason", (r) => r.endedBy]];
  function _differ(bot, mine) {
    if (!bot || !mine || _differSaid.has(bot.pi)) return false;
    const diffs = [];
    for (const [name, get] of _FIELDS) {
      const b = get(bot), m = get(mine);
      if (b === undefined || m === undefined || b === null || m === null) continue;
      if (b !== m) diffs.push(name + " " + b + " (this device: " + m + ")");
    }
    if (!diffs.length) return false;
    _differSaid.add(bot.pi);
    _say("the bot's summary n=" + bot.sum + " says " + bot.pi + " at l=" + bot.l + ": " + diffs.join(", ") + "; this device's row came from " +
      (mine.src || "unknown") + " — the bot's row is kept");
    return true;
  }
  function _isAdd(e) {
    const t = e && (e.type || (e.content && e.content.t));
    return (t === "ddjp.dj.declare" || t === "ddjp.dj.join") && e.content && typeof e.content.v === "string" && !!e.content.v;
  }
  function _noteAdd(user, songKey, ts, l) {
    if (!user || !songKey || typeof ts !== "number") return;
    const k = user + "\u0000" + songKey;
    const list = _added[k] || (_added[k] = []);
    if (list.indexOf(ts) < 0) { list.push(ts); list.sort((a, b) => a - b); }
    if (list.length > 4) list.splice(0, list.length - 4);
    // ITS ROOM POSITION TOO (the owner's repeat rule, `ddjp_536`): "added before the setting took effect" is judged by
    // position, never by a device clock.
    if (typeof l === "number") { const pl = _addedL[k] || (_addedL[k] = []); if (pl.indexOf(l) < 0) { pl.push(l); pl.sort((a, b) => a - b); } if (pl.length > 4) pl.splice(0, pl.length - 4); }
  }
  // The latest position at which this person added this video, at or before `beforeL` (the play's position).
  function addedAtL(user, songKey, beforeL) {
    const list = _addedL[user + "\u0000" + songKey];
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
  function addedAt(user, songKey, beforeTs) {
    const list = _added[user + "\u0000" + songKey];
    if (!list || !list.length) return null;
    for (let i = list.length - 1; i >= 0; i--) if (typeof beforeTs !== "number" || list[i] <= beforeTs) return list[i];
    return null;
  }
  // KEPT ONLY WHILE ITS SONG IS QUEUED — or playing, because the repeat rule asks at the song's start.
  function _retain(state) {
    if (!state || !Array.isArray(state.rotation)) return;
    const keep = new Set();
    for (const r of state.rotation) for (const s of (r && r.pending) || []) if (s && s.songKey) keep.add(r.user + "\u0000" + s.songKey);
    const np = state.nowPlaying;
    if (np && np.dj && np.song && np.song.songKey) keep.add(np.dj + "\u0000" + np.song.songKey);
    for (const k of Object.keys(_added)) if (!keep.has(k)) delete _added[k];
    for (const k of Object.keys(_addedL)) if (!keep.has(k)) delete _addedL[k];
    _retainKeep = keep;
  }
  function holes() {
    const out = [];
    if (windowFrom() !== null) return out;   // the window is held: nothing below its oldest song is a hole (§10)
    // A HOLE IS WHAT NEITHER THE ROOM'S EVENTS READ NOR THE BOT'S SUMMARIES HOLD (§12): between two summaries whose stretches do not
    // meet, or below the oldest — filled the `ddjp_735` way, from the nearest save point. The room's start held by the newest
    // summary's count leaves nothing below to fill.
    if (_sums.length && _countMet()) return out;
    let at = 0;
    for (const r of _spans()) { if (r[0] > at) out.push([at, r[0] - 1]); at = r[1] + 1; }
    return out;
  }

  // THE TABLE IS CLOSED ONCE PER ROOM, NEVER BY A RE-ATTACH (J89, the owner's `?v=537` run). `awaitOpen` (ddjp_564) closes it
  // until the room's open step has run — but the bridge attaches again on EVERY rewire of the running room (a rank change, a
  // late channel, an upgrade: `wireCheckpoints`), and the open step runs only at the opening. So one rank change left the table
  // closed for the rest of the visit: `refresh` answered "not-opened" and no song started after it, by any advance, entered
  // history ("1 missing $IRH7… at l=37 — in an uncovered hole"). Now the room change closes it (`reset`) and the first attach
  // does; an attach for a room whose table is already open leaves it open.
  function attach(env) { _env = Object.assign({}, _env, env || {}); if (env && env.awaitOpen && _openedEpoch !== _epoch) _opened = false; }

  // ── PURE: fold a stretch of log into play entries ────────────────────────────────────────
  // Uses the reducer, so a played songKey is whatever the reducer would actually have popped —
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
  // THE BOT'S ROW WINS EVERY TIME (§12, the owner's answer 6): a row from a summary (`src: "summary"`) is never replaced by one this
  // device derived, and of two from summaries the higher serial wins (his answer 7: "the latest claim to that instance").
  function merge(existing, incoming, incomingWins, cap) {
    const byPi = Object.create(null);
    const out = [];
    for (const list of (incomingWins ? [incoming || [], existing || []] : [existing || [], incoming || []])) {
      for (const e of list) {
        if (!e || !e.pi) continue;
        if (byPi[e.pi] !== undefined) {
          const i = byPi[e.pi], cur = out[i];
          if (_isBot(e) && (!_isBot(cur) || (e.sum || 0) > (cur.sum || 0))) out[i] = e;
          continue;
        }
        byPi[e.pi] = out.length;
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
    const k = (Number.isSafeInteger(cap) && cap >= 1 && cap <= MAX) ? cap : MAX;   // the room's window, else the ceiling
    if (out.length > k) return out.slice(out.length - k);   // regenerable -> evict the oldest
    return out;
  }

  // ── FEED IT ──────────────────────────────────────────────────────────────────────────────
  // Called with whatever stretch of log is available. Safe to call repeatedly and with overlapping
  // ranges — merge dedups. This is what makes history independent: the live path may trim its log
  // to the floor whenever it likes, and history keeps what it already read.
  // THE ROOM'S ORDER, AS THE ENGINE KEEPS IT (J91): position, then the event id compared CODE UNIT BY CODE UNIT — the order
  // `StreamManager.orderEvents` folds by, and `Floor` and the trim's boundary judge by. History sorted ids by locale, which
  // puts "$mt8E…" before "$Nab…" where the engine puts it after: two plays at one position whose ids differ in case were
  // resolved one way by every device and the other way by verify, the cache rebuild and the audit's truth and raw fold.
  // One comparator, here, for every fold this module makes; the bridge's pager sorts by the same rule.
  function _roomOrder(a, b) {
    if (a.l !== b.l) return a.l - b.l;
    const x = String((a && (a.eventId || a.event_id)) || ""), y = String((b && (b.eventId || b.event_id)) || "");
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  function ingest(events, seed, opts) {
    // THE TRIM HAND-OFF OBEYS THE SAME RULE AS REFRESH (`ddjp_563`, the bot's burst of trims before `modules started (live)`):
    // nothing is written until the device is settled — those closed segments are verify's, from the room.
    if (opts && (opts.src === "trim" || opts.src === "settle") && typeof _env.settled === "function") { let _s = true; try { _s = _env.settled() !== false; } catch (e) { _s = true; }
      if (!_s) return { added: 0, total: _entries.length, deferred: "not-settled" }; }
    // IN THE ROOM'S ORDER (J91): the trim hands over what it drops in ARRIVAL order (`eventLog.filter`), and a race's two
    // plays folded in arrival order made the first to arrive the song — the trim re-wrote the race's loser into history.
    let list = Array.isArray(events) ? events.slice().sort(_roomOrder) : [];
    if (!list.length) return { added: 0, total: _entries.length };
    // A CLOSED STRETCH FOLLOWS ITS SAVE POINT (ruling 41, J91): `opts.settle` = { at, seed } — the save point that closes the
    // events at or below `at`. Where their fold does not reach its song, the same-position plays it did not count are left out.
    let _st = null;
    if (opts && opts.settle && opts.settle.seed && typeof opts.settle.seed === "object") {
      const at = opts.settle.at;
      _st = _settleOnce(typeof at === "number" ? list.filter((e) => e && typeof e.l === "number" && e.l <= at) : list, seed, opts.settle.seed, at);
      if (_st.dropped.length) { const gone = new Set(_st.dropped.map((d) => d.pi)); list = list.filter((e) => !gone.has(_idOf(e))); }
    }
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
    // A ROW THE LIVE FOLD NO LONGER HAS LEAVES (J90, the owner's `?v=538` run: "1 extra $7FS82… at l=67 — from refresh"). Two plays
    // at one position: the first to arrive was accepted and entered history; the second sorts first in the room's order, so the
    // next fold made IT the song and refused the first — and `merge` only adds, so the loser stayed ("8 songs", then "9"). The
    // held log is the room from `lo` to `hi`, so a row an earlier refresh wrote in that stretch that this fold does not produce
    // is a play the room no longer has. Only refresh's own rows: the other paths' rows are verify's to correct (`ddjp_560`).
    const removed = [];
    if (opts && opts.src === "refresh" && both && both.state && typeof lo === "number" && typeof hi === "number") {
      const keep = new Set(folded.map((r) => r && r.pi));
      for (const r of _entries) if (r && r.src === "refresh" && typeof r.l === "number" && r.l >= lo && r.l <= hi && !keep.has(r.pi)) removed.push(r);
      if (removed.length) _entries = _entries.filter((r) => removed.indexOf(r) < 0);
    }
    // AND A STRETCH ITS SAVE POINT RE-DECIDED, handed over by the engine (ruling 41; J92, the owner's `?v=540` seal n=7): the
    // save point's sealer trims its own floor, and a play at the save point's own position can reach it while the seal is being
    // sent — so the trim's stretch holds a race the save point settled the other way. The rows the live writers put in that
    // stretch that the settled fold does not produce leave. Only when the settle left a play out: a stretch its save point agrees
    // with is the fold refresh already wrote. (J91 judged this unreachable; the sealer's own trim reaches it.)
    if (opts && (opts.src === "trim" || opts.src === "settle") && _st && _st.dropped.length && both && both.state && typeof lo === "number" && typeof hi === "number") {
      const keep = new Set(folded.map((r) => r && r.pi)), n0 = removed.length;
      for (const r of _entries) if (r && (r.src === "refresh" || r.src === "trim" || r.src === "settle") && typeof r.l === "number" && r.l >= lo && r.l <= hi && !keep.has(r.pi)) removed.push(r);
      if (removed.length > n0) _entries = _entries.filter((r) => removed.indexOf(r) < 0);
    }
    if (!(opts && opts.src === "verify")) _dropKeysChangedBy(folded);   // ddjp_562: a verified segment another path changes is re-verified
    if (!_restoredOnce) for (const r of folded) if (r && typeof r.l === "number") _touchedBeforeRestore.push(r.l);   // ddjp_563
    _mergeIn(folded, _finals, true, both && both.state ? both.state.cutShortBy : null, both && both.state ? both.state.endedBy : null);   // a derivation wins over what the table held for the same play (ddjp_560)
    _endsOnto(_endsIn(list, both && both.accepted));   // and when each song this fold saw end ended (§12)
    if (opts && opts.retain && both && both.state) _retain(both.state);
    const _uncounted = new Set(_st ? _st.dropped.map((d) => d.pi) : []);
    return { added: _entries.length - before, total: _entries.length, settled: (_st && _st.dropped.length) ? { at: opts.settle.at, dropped: _st.dropped.slice() } : null,
      removed: removed.map((r) => ({ pi: r.pi, l: r.l, samePos: folded.some((f) => f && f.l === r.l), settledAt: _uncounted.has(r.pi) ? opts.settle.at : null })) };
  }

  // Fold whatever the live log currently holds. The ordinary path, and cheap: it is one fold of a
  // bounded window, not of the room's whole life.
  //
  // ── THE SEED IS NOT OPTIONAL ONCE THE LOG HAS BEEN TRIMMED ───────────────────────────────
  // Found by reading. A play's songKey is not in its event body — it is whatever the reducer pops
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
    if (seed === undefined && (isSegment || !_whole) && typeof _env.cut === "function") {   // a segment, or a log with gaps
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
    // A WHOLE LOG UNDER A SAVE POINT FOLLOWS IT (ruling 41, J91): folded from the room's start, the stretch up to the save point
    // is folded as that save point counted it — the device that heard both plays of a race kept the room-order one (J90).
    let settle = null;
    if (s === undefined && _cutFrom === null && typeof _env.cut === "function") {
      let c = null; try { c = _env.cut(); } catch (e) { c = null; }
      const fs = (typeof c === "number") ? _floorSeed() : undefined;
      if (typeof c === "number" && fs && typeof fs === "object" && log.some((e) => typeof e.l === "number" && e.l <= c)) settle = { at: c, seed: fs };
    }
    const o = (typeof from === "number") ? { retain: true, from: from, src: "refresh" } : { retain: true, src: "refresh" };
    if (settle) o.settle = settle;
    return ingest(log, s, o);   // the held log is the live room: prune added times to its queue
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
    const _sp0 = _spans();   // the bot's summaries hold their stretches too (§12)
    let ceiling = _sp0.length ? _sp0[0][0] : ((typeof toL === "number") ? toL : null);
    if (ceiling === null) return { ok: false, reason: "nothing-read-yet" };
    if (fromL >= ceiling) return { ok: true, added: 0, reason: "already-covered" };
    let events = null;
    const ep = _epoch;
    // NO DEEPER THAN THE WINDOW (§10), from the room's start only (a seed the caller hands is its own base, folded as before): a
    // stretch deeper than the songs still needed is read from its top down, as `fillGaps` reads a deep hole, and the read stops
    // once the table holds the window. A stretch with no save point in it is read whole, to the room's start: nothing else can
    // fold it.
    if (seed === undefined) {
      const n0 = _entries.length;
      let hi = ceiling - 1;
      while (hi >= fromL && !_full() && hi - fromL + 1 > Math.max(1, _max() - _rowsAbove(hi))) {   // deeper than the songs still needed
        const st = await _stepDown(fromL, hi, ep);
        if (st && st.reset) return { ok: false, reason: "reset" };
        if (!st || st.whole) break;
        hi = st.next;
      }
      if (_full()) { const sp = _spans(); return { ok: true, added: Math.max(0, _entries.length - n0), total: _entries.length, reachedFrom: sp.length ? sp[0][0] : null, window: windowFrom() }; }
      { const sp = _spans(); ceiling = sp.length ? sp[0][0] : ceiling; }
      if (fromL >= ceiling) return { ok: true, added: Math.max(0, _entries.length - n0), total: _entries.length, reachedFrom: ceiling };
    }
    try { events = await _env.pageRange(fromL, ceiling); }
    catch (e) { return { ok: false, reason: "page-threw" }; }
    if (ep !== _epoch) return { ok: false, reason: "reset" };
    if (!Array.isArray(events) || !events.length) return { ok: false, reason: "page-empty" };
    // HOW FAR BACK IT REALLY GOT. A download that stopped at its page limit reached only its oldest
    // event; claiming `fromL` there was claiming what was never read (J73 job 6).
    const reached = (typeof events.reachedFrom === "number") ? Math.max(fromL, events.reachedFrom) : fromL;
    // FLOOR-ANCHORED (`ddjp_560`): each segment from the checkpoint it follows, as the app follows floors — one fold from the
    // room's start diverges from the settled floors where live acceptance and a replay differ (this room: l=98).
    const _within = events.filter((e) => typeof e.l === "number" && e.l >= reached);
    let _added = 0, _r = null;
    for (const sg of _segments(_within, _anchorsIn(_within), seed)) {
      _r = ingest(sg.seg, sg.seed, { from: Math.max(reached, sg.lo + 1), to: Math.min(ceiling, sg.hi), src: "backfill",
        settle: sg.next ? { at: sg.next.l, seed: sg.next.seed } : undefined }); _added += (_r && _r.added) || 0; }   // ruling 41: as its save point counted it
    const r = { added: _added, total: _entries.length };
    return { ok: true, added: r.added, total: r.total, reachedFrom: reached };
  }
  // FILL THE HOLES (J73 job 6, Q8): newest first, each anchored to a save point at or below its start
  // — a hole's first plays chain from songs before it, so it cannot be folded from nothing. The fill
  // reads further down until it finds one (or the room's start); what it cannot anchor stays a hole,
  // and the repeat rule then says it cannot tell.
  // ONE HOLE, WHOLE (the fill as it was before the window): read from its bottom `a` — further down until a save point at or below
  // it, or the room's start — and fold it to its top `b`. Used for a hole no deeper than the songs still needed.
  async function _fillHole(a, b, tries, ep) {
    let filled = 0;
    let from = a, events = null, anchor = null, reachedStart = false;
    for (let t = 0; t < tries; t++) {
      // ONE POSITION PAST THE HOLE (ruling 41, J91): a save point sits just above the position it closes, so a hole that ends
      // at a save point's cut is read with that save point, and its last stretch follows it. Only `a..b` is folded or covered.
      try { events = await _env.pageRange(from, b + 1); } catch (e) { events = null; }
      if (ep !== _epoch) return { reset: true, filled: filled };
      if (!Array.isArray(events)) break;
      const reach = (typeof events.reachedFrom === "number") ? events.reachedFrom : from;
      reachedStart = (from <= 0 && reach <= 0);
      const anchors = events.map((e) => (typeof _env.anchorOf === "function") ? _env.anchorOf(e) : null)
        .filter((x) => x && typeof x.l === "number" && x.l < a);
      if (anchors.length) { anchor = anchors.sort((x, y) => y.l - x.l)[0]; break; }
      if (reachedStart || reach > from) break;              // at the start, or the download ran out
      from = Math.max(0, a - (b - a + 1) * Math.pow(2, t + 1));
    }
    if (!Array.isArray(events)) return { filled: filled };
    const base = anchor ? anchor : (reachedStart ? { l: -1, seed: undefined } : null);
    const inner = events.map((e) => ({ e, an: (typeof _env.anchorOf === "function") ? _env.anchorOf(e) : null }))
      .filter((x) => x.an && typeof x.an.l === "number" && x.an.l >= a && x.an.l <= b).map((x) => x.an)
      .sort((x, y) => x.l - y.l);
    const cuts = (base ? [base] : []).concat(inner);
    for (let i = 0; i < cuts.length; i++) {
      const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : b;
      const seg = events.filter((e) => typeof e.l === "number" && e.l > lo && e.l <= hi);
      if (!seg.length) continue;
      ingest(seg, cuts[i].seed, { from: Math.max(a, lo + 1), to: hi, src: "gaps", settle: (i + 1 < cuts.length) ? { at: cuts[i + 1].l, seed: cuts[i + 1].seed } : undefined });   // ruling 41
      filled++;
    }
    // Read through the whole hole from a save point (or the room's start): positions with no event
    // in them were read too, so the hole is covered, not only where songs happened to be.
    if (base) _cover(a, b);
    return { filled: filled };
  }
  // ONE STEP DOWN A DEEP HOLE (the window, §10): read the `span` positions just below `hi`, fold from the lowest save point the read
  // reached and cover from it up to `hi`; the hole then ends at that save point's cut. `span` starts at the songs still needed (a
  // song is at least one position, so the read cannot pass the window's oldest song) and doubles only while the read holds no save
  // point — the one reason to read past that song is the save point a fold of it starts from. Null: nothing to step on (the read
  // failed); `{ whole: true }`: the rest of the hole fits in the read — folded whole, as before the window.
  async function _stepDown(a, hi, ep) {
    let span = Math.max(1, _max() - _rowsAbove(hi));
    for (;;) {
      if (hi - a + 1 <= span) return { whole: true };
      const from = hi + 1 - span;
      let events = null;
      try { events = await _env.pageRange(from, hi + 1); } catch (e) { events = null; }
      if (ep !== _epoch) return { reset: true };
      if (!Array.isArray(events)) return null;
      const an = events.map((e) => (typeof _env.anchorOf === "function") ? _env.anchorOf(e) : null)
        .filter((x) => x && typeof x.l === "number" && x.l >= from - 1 && x.l < hi).sort((x, y) => x.l - y.l);
      if (!an.length) { span *= 2; continue; }
      let filled = 0;
      for (let i = 0; i < an.length; i++) {
        const lo = an[i].l, top = (i + 1 < an.length) ? an[i + 1].l : hi;
        const seg = events.filter((e) => typeof e.l === "number" && e.l > lo && e.l <= top);
        if (!seg.length) continue;
        ingest(seg, an[i].seed, { from: lo + 1, to: top, src: "gaps", settle: (i + 1 < an.length) ? { at: an[i + 1].l, seed: an[i + 1].seed } : undefined });   // ruling 41
        filled++;
      }
      _cover(an[0].l + 1, hi);   // read through from that save point: positions with no event in them were read too
      return { filled: filled, next: an[0].l };
    }
  }
  // THE ROOM'S START, CONFIRMED FROM ITS EVENTS (737, `consensus/history-rules.md` §12): where the events read run from the room's
  // first position (1) and a summary's stretch already holds position 0, the fill no longer sees a hole there — yet `complete`, the
  // one fact the fold is told, is the EVENTS reaching the start, never a summary. So that one position is read the `ddjp_735` way
  // (`_fillHole`), as the fill read it before summaries existed: the fold is told what it was told then. Nothing else is read.
  async function confirmStart() {
    if (typeof _env.pageRange !== "function" || !(_ranges.length && _ranges[0][0] === 1)) return { ok: false, reason: "not-needed" };
    const r = await _fillHole(0, 0, 6, _epoch);
    return { ok: !r.reset, complete: _ranges.length === 1 && _ranges[0][0] <= 0 };
  }
  async function fillGaps(maxTries) {
    if (typeof _env.pageRange !== "function") return { ok: false, reason: "no-pager", filled: 0 };
    const tries = (typeof maxTries === "number") ? maxTries : 6;
    let filled = 0;
    const ep = _epoch;
    for (const [a, b] of holes().reverse()) {
      // NEWEST FIRST, AND NO DEEPER THAN THE WINDOW (§10): a hole deeper than the songs still needed is read from its top down,
      // a step at a time, and the fill stops the moment the table holds the window.
      let hi = b;
      while (hi >= a && !_full()) {
        // a hole that fits in the songs still needed is filled whole, at once, as before the window
        if (hi - a + 1 <= Math.max(1, _max() - _rowsAbove(hi))) { const r = await _fillHole(a, hi, tries, ep); filled += r.filled; if (r.reset) return { ok: false, reason: "reset", filled: filled }; break; }
        const st = await _stepDown(a, hi, ep);
        if (st && st.reset) return { ok: false, reason: "reset", filled: filled };
        if (!st) break;
        if (st.whole) { const r = await _fillHole(a, hi, tries, ep); filled += r.filled; if (r.reset) return { ok: false, reason: "reset", filled: filled }; break; }
        filled += st.filled; hi = st.next;
      }
      if (_full()) break;
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
      if (_isBot(e)) return true;                       // the bot's row (§12): no floor derived it, so no floor change judges it
      if (e.floorSig === sig) return true;              // settled under the floor we are on
      if (e.floorSig === undefined) return true;        // predates stamping: left alone, not judged
      if (cut !== null && typeof e.l === "number" && e.l <= cut) return true;  // the checkpoint covers it
      return false;                                     // above the cut, under a replaced answer
    });
    _wrote = true;
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
             fromL: c.fromL, toL: c.toL, complete: c.complete, verified: Object.assign({}, _verified), origin: _origin ? Object.assign({}, _origin) : null,
             sums: _sums.map((x) => Object.assign({}, x)) };   // the summaries taken (§12): a reload reads only what is newer
  }
  // ── A STRETCH FOLLOWS THE SAVE POINT THAT CLOSES IT (the owner's ruling 41, J91) ───────────────────────────────────────
  // A save point records what its sealer had heard when it sealed. Two plays at one position, one of them not yet at the
  // sealer: the save point counts the other, and the late one, at a settled position, is dropped by every device. A fold
  // of the stretch that holds BOTH resolves the race by the room's order instead, and from there it tells another story
  // (J90: three devices, three histories; the audit's truth counting both plays). So where a closed stretch's fold does
  // not reach the song its closing save point records, it is folded again without the same-position plays the save
  // point did not count — the fewest that make it reach that song, the first such set in the room's order — and its rows
  // are that fold's. Nothing else is guessed: a stretch no such set settles is left as it folds, and the audit says so.
  // Pure; the save point itself is unchanged (option A was declined), and so is every device's live fold.
  const _ADVANCES = { "ddjp.dj.play": 1, "ddjp.dj.skip": 1, "ddjp.media.skip": 1 };
  const SETTLE_MAX = 8;                     // same-position plays tried in one stretch (2^8 - 1 folds at the very worst)
  const _idOf = (e) => String((e && (e.eventId || e.event_id)) || "");
  const _ordered = (list) => list.slice().sort(_roomOrder);
  function _headOf(list, seed) {
    try { const st = StateDeriver.derive(_ordered(list), seed); return (st && st.nowPlaying) ? st.nowPlaying.pi : null; } catch (e) { return undefined; }
  }
  function _settle(seg, aSeed, bSeed) {
    const out = { seg: seg, dropped: [], unsettled: false };
    if (!Array.isArray(seg) || !seg.length || !bSeed || typeof bSeed !== "object") return out;
    const want = (bSeed.nowPlaying && bSeed.nowPlaying.pi) ? bSeed.nowPlaying.pi : null;
    const head = _headOf(seg, aSeed);
    if (head === undefined || head === want) return out;
    const byL = new Map();
    for (const e of seg) {
      const t = e && (e.type || (e.content && e.content.t));
      if (!_ADVANCES[t] || typeof e.l !== "number") continue;
      if (!byL.has(e.l)) byL.set(e.l, []);
      byL.get(e.l).push(e);
    }
    const cand = _ordered([].concat(...Array.from(byL.values()).filter((g) => g.length > 1)));
    if (!cand.length || cand.length > SETTLE_MAX) return Object.assign(out, { unsettled: true, head: head, want: want });
    const pick = (k, from, acc) => {               // the subsets of size k, in the room's order
      if (acc.length === k) { const drop = new Set(acc); const rest = seg.filter((e) => !drop.has(e)); return _headOf(rest, aSeed) === want ? { rest: rest, acc: acc.slice() } : null; }
      for (let i = from; i < cand.length; i++) { acc.push(cand[i]); const r = pick(k, i + 1, acc); acc.pop(); if (r) return r; }
      return null;
    };
    for (let k = 1; k <= cand.length; k++) {
      const r = pick(k, 0, []);
      if (r) return { seg: r.rest, dropped: r.acc.map((e) => ({ pi: _idOf(e), l: e.l })), unsettled: false, head: head, want: want };
    }
    return Object.assign(out, { unsettled: true, head: head, want: want });
  }
  // The live refresh asks on every advance about the same closed stretch: answered once until that stretch changes.
  let _settleMemo = null;
  function _settleOnce(closed, aSeed, bSeed, at) {
    const np = (x) => (x && x.nowPlaying && x.nowPlaying.pi) || "";
    const key = [_epoch, at, closed.length, closed.length ? _idOf(closed[0]) : "", closed.length ? _idOf(closed[closed.length - 1]) : "",
      aSeed ? np(aSeed) + "/" + aSeed.tick : "start", np(bSeed) + "/" + bSeed.tick].join("|");
    if (_settleMemo && _settleMemo.key === key) {
      const gone = new Set(_settleMemo.dropped.map((d) => d.pi));
      return { seg: closed.filter((e) => !gone.has(_idOf(e))), dropped: _settleMemo.dropped.slice(), unsettled: _settleMemo.unsettled };
    }
    const r = _settle(closed, aSeed, bSeed);
    _settleMemo = { key: key, dropped: r.dropped.slice(), unsettled: r.unsettled };
    return r;
  }
  // ONE CLOSED SEGMENT, FOR EVERY FLOOR-ANCHORED WRITER (`ddjp_563`): the events in (a, b] folded from a's seed, plus THE CLOSING
  // FLOOR'S BANKED SONG. The reducer's history lists the songs a fold STARTED; a song spanning the cut is produced only by the
  // segment it started in — and where that segment's fold diverges from its closing floor (the J71 late-arrival race), the fold
  // refuses it and the next segment carries it only as its seed's now-playing. The closing floor is the room's account: its
  // banked song is a row, taken from the floor. Shared by the truth, verify and the cache rebuild, so they cannot disagree.
  function _segmentRows(seg, aSeed, bSeed, prevByPi) {
    const _st = _settle(seg, aSeed, bSeed);   // ruling 41: the stretch as its closing save point counted it
    seg = _st.seg;
    const posOf = Object.create(null); for (const e of seg) if (e && e.eventId) posOf[e.eventId] = e.l;
    // THE SAME FOLD AS `ingest` (`ddjp_564`): `deriveBoth`'s state, so a row has one shape whichever writer produced it.
    let st = null, acc = null; try { const b = StateDeriver.deriveBoth ? StateDeriver.deriveBoth(seg, aSeed) : null; st = (b && b.state) ? b.state : StateDeriver.derive(seg, aSeed); acc = (b && b.accepted) || null; } catch (e) { st = null; }
    if (!st) return null;
    const cs = st.counts || {}, live = st.nowPlaying ? st.nowPlaying.pi : null;
    const lOf = (pi, d) => (posOf[pi] !== undefined) ? posOf[pi] : ((prevByPi && prevByPi.get(pi) && typeof prevByPi.get(pi).l === "number") ? prevByPi.get(pi).l : d);
    const rows = (st.history || []).filter((h) => h && h.pi).map((h) => Object.assign({}, h, { l: lOf(h.pi, h.l),
      counts: (h.pi !== live && cs[h.pi]) ? { votes: cs[h.pi].votes || 0, saves: cs[h.pi].saves || 0 } : h.counts }));
    const banked = bSeed && bSeed.nowPlaying && bSeed.nowPlaying.pi ? bSeed.nowPlaying : null;
    if (banked && !rows.some((r) => r.pi === banked.pi)) {
      const old = prevByPi ? prevByPi.get(banked.pi) : null;
      // IN THE REDUCER'S OWN ROW SHAPE (`ddjp_564`): { songKey, dj, at, pi } — one shape whichever writer produced it
      rows.push(Object.assign({}, old || {}, { pi: banked.pi, songKey: (banked.song || {}).songKey || null, dj: banked.dj || null,
        at: (typeof banked.startedAt === "number") ? banked.startedAt : ((old && old.at) || null), l: lOf(banked.pi, null), src: "floor" }));
    }
    // `ended`: how each song this stretch saw END was ended, by play — the opening save point's song among them (J131's correction).
    // `ends`: when (`_endsIn`, §12).
    return { rows: rows, live: live, banked: banked ? banked.pi : null, settled: _st, ends: _endsIn(seg, acc), ended: st.cutShortBy || null, reasons: st.endedBy || null };
  }
  // A ROW'S IDENTITY ACROSS DERIVATIONS (`ddjp_564`): its play and its video. A start time set from a floor's seed (a banked row) and
  // one a fold carries differ only in form — counting that as a change dropped keys on every open.
  const _k3 = (r) => [r.pi, r.songKey].join("|");
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
    const ev = (events || []).filter((e) => e && typeof e.l === "number" && !(e.type === "ddjp.checkpoint")).slice()
      .sort(_roomOrder);
    const cuts = (baseSeed === null) ? (anchors || []).slice() : [{ l: -Infinity, seed: baseSeed }].concat(anchors || []);
    const out = [];
    for (let i = 0; i < cuts.length; i++) {
      const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : Infinity;
      out.push({ lo: lo, hi: hi, seed: cuts[i].seed, next: (i + 1 < cuts.length) ? cuts[i + 1] : null, seg: ev.filter((e) => e.l > lo && e.l <= hi) });
    }
    return out;
  }
  // `o.fromAnchor` (the audit under the window, §10): the events start at a floor, not at the room's start — the first stretch is
  // folded from the first anchor's seed, and nothing below it from nothing.
  function deriveAnchored(events, anchors, o) {
    const all = (events || []).filter((e) => e && typeof e.l === "number");
    const posOf = Object.create(null); for (const e of all) if (e.eventId) posOf[e.eventId] = e.l;
    const rows = new Map(), floorChecks = [], settled = [], ended = Object.create(null), reasons = Object.create(null);
    const ends = Object.create(null);
    const _an = _anchorsIn(all, anchors);
    for (const sg of _segments(all, _an, (o && o.fromAnchor) ? null : undefined)) {
      const r = _segmentRows(sg.seg, sg.seed, sg.next ? sg.next.seed : null, rows);
      if (!r) continue;
      if (r.ended) Object.assign(ended, r.ended);   // a song is seen to end in the stretch after the save point it spans
      if (r.reasons) Object.assign(reasons, r.reasons);   // and its reason with it (§11)
      if (r.ends) Object.assign(ends, r.ends);   // and when it ended (§12)
      for (const row of r.rows) if (!rows.has(row.pi) || row.src !== "floor") rows.set(row.pi, Object.assign({}, row, { l: posOf[row.pi] !== undefined ? posOf[row.pi] : row.l }));
      if (sg.next) floorChecks.push({ floorL: sg.next.l, segmentHead: r.live, floorHead: (sg.next.seed && sg.next.seed.nowPlaying) ? sg.next.seed.nowPlaying.pi : null });
      if (sg.next && r.settled && r.settled.dropped.length) settled.push({ floorL: sg.next.l, dropped: r.settled.dropped.slice(), kept: r.settled.want });
    }
    for (const [pi, row] of rows) if (Object.prototype.hasOwnProperty.call(ended, pi)) rows.set(pi, Object.assign({}, row, { cutShortBy: ended[pi] }));
    for (const [pi, row] of rows) if (Object.prototype.hasOwnProperty.call(reasons, pi)) {
      const c = Object.assign({}, row); if (typeof reasons[pi] === "string") c.endedBy = reasons[pi]; else delete c.endedBy; rows.set(pi, c); }
    for (const [pi, row] of rows) if (Object.prototype.hasOwnProperty.call(ends, pi)) rows.set(pi, Object.assign({}, row, { endedAt: ends[pi] }));
    return { rows: Array.from(rows.values()).sort((a, b) => (a.l || 0) - (b.l || 0)), floorChecks: floorChecks, settled: settled };
  }
  // VERIFY (`ddjp_560`): replace this device's rows within the re-derived range by the floor-anchored truth — a table built
  // by an earlier, wrong path (rows inside coverage are never re-read) is repaired once the room has been read from its start.
  function verifyFrom(events, anchors) {
    const all = (events || []).filter((e) => e && typeof e.l === "number");
    if (!all.some((e) => e.l <= 1)) return { ok: false, reason: "did-not-reach-the-start", changed: 0 };
    const hi = all.reduce((m, e) => Math.max(m, e.l), 0);
    const truth = deriveAnchored(all, anchors).rows;
    const key = (r) => [r.pi, r.songKey, r.startedAt, r.endedAt || null].join("|");
    const before = new Set(_entries.filter((e) => e && typeof e.l === "number" && e.l <= hi).map(key));
    const after = new Set(truth.map(key));
    let changed = 0; for (const k of before) if (!after.has(k)) changed++; for (const k of after) if (!before.has(k)) changed++;
    _entries = _entries.filter((e) => !(e && typeof e.l === "number" && e.l <= hi && !_isBot(e)));
    _mergeIn(truth.map((r) => Object.assign({}, r, { src: "verify", floorSig: _floorSig() })), null, true);
    _cover(0, hi);
    return { ok: true, changed: changed, rows: truth.length };
  }
  // THE ROOM'S WINDOW CHANGED (the owner's `historySize`, `consensus/history-rules.md` §12). Lowered: the oldest rows past it go
  // now and what lay below them is no longer claimed, as any eviction (`_clipBelow`). Raised: nothing goes; the window is no
  // longer held, so the stretch below is a hole the existing fill reads (the bridge re-arms it). Answers { size, dropped }.
  // A CHECK THAT STRADDLES THE OLDEST SONG KEPT no longer vouches for the stretch below that song: the rows it covered there were
  // let go (now, or at an earlier, smaller window). While the window is held nothing below is read again, so such a mark is kept
  // (a reload reads nothing); once the window is NOT held — raised past what the table keeps — it would let verify skip that
  // stretch while its songs are missing, and the table would fill from further down instead (driven: 650 of 650 held, one of
  // them 150 songs too old, the window's own oldest song missing). So then it goes, and verify reads that stretch again.
  function resize() {
    const k = _max();
    let n = 0;
    if (_entries.length > k) {
      n = _entries.length - k;
      _entries = _entries.slice(n);
      _wrote = true;
      if (_entries.length && typeof _entries[0].l === "number") _clipBelow(_entries[0].l);
    }
    const lo = (_entries.length && typeof _entries[0].l === "number") ? _entries[0].l : null;
    if (lo !== null && !_full()) {
      for (const key of Object.keys(_verified)) { const v = _verified[key]; if (v && typeof v.lo === "number" && v.lo < lo) { delete _verified[key]; _wrote = true; } }
    }
    return { size: k, dropped: n };
  }
  // ── THE BOT'S SUMMARIES, TAKEN (the owner's design, `consensus/history-rules.md` §12) ──────────────────────────────────────────
  // `list`: summaries as `HistorySummary.read` gives them, each with its message's event id and position attached ({ n, from, to,
  // count, rows, id, l }), in any order; the transport reads them off the song history channel, first in its backfill. Their
  // rows are trusted and nothing is computed for them (his words 4): each comes in as `src: "summary"`, `sum: <serial>`, and
  //   · REPLACES this device's row for the same play (answer 6: "belive the bot"); where the two differ, it is said once a play;
  //   · for one play, the NEWEST summary naming it wins (answer 7): a higher serial; a position a newer summary covers is that
  //     summary's alone, so an older one's row there is not taken;
  //   · a summary is the account of its STRETCH: a row of this device in it that it does not name (a race the bot's save point
  //     settled the other way) leaves song history, said once — and an older summary's row there that a newer one over the same stretch
  //     does not name leaves with it.
  // Each stretch is kept (`_sums`) with the room's count, so the reader stops at the newest held next time. Nothing here is
  // `complete` (`coverage`). Answers { taken, rows, left, differ, newest: the newest stretch's { n, from, to, count } | null }.
  function takeSummaries(list) {
    const ok = (s) => s && [s.n, s.from, s.to, s.count].every((v) => Number.isSafeInteger(v) && v >= 0) && s.to >= s.from && Array.isArray(s.rows);
    const xs = (Array.isArray(list) ? list : []).filter(ok).slice().sort((a, b) => (b.n - a.n) || ((b.l || 0) - (a.l || 0)));
    const out = { taken: 0, rows: 0, left: 0, differ: 0, newest: null };
    if (!xs.length) return out;
    const marks = _sums.slice();
    const byPi = new Map(_entries.map((r) => [r.pi, r]));
    const incoming = new Map(), leave = new Set();
    for (const s of xs) {
      if (marks.some((m) => m.n === s.n)) continue;                                 // taken before
      const newerHolds = (l) => marks.some((m) => m.n > s.n && l >= m.from && l <= m.to);
      const named = new Set(s.rows.map((r) => r && r.pi));
      for (const r of s.rows) {
        if (!r || typeof r.pi !== "string" || typeof r.l !== "number" || newerHolds(r.l)) continue;
        const cur = incoming.get(r.pi) || byPi.get(r.pi);
        if (cur && _isBot(cur) && (cur.sum || 0) >= s.n) continue;
        const row = Object.assign({}, r, { src: "summary", sum: s.n });
        if (cur && !_isBot(cur) && _differ(row, cur)) out.differ++;
        incoming.set(r.pi, row); out.rows++;
      }
      for (const e of _entries) {
        if (!e || typeof e.l !== "number" || e.l < s.from || e.l > s.to || named.has(e.pi) || newerHolds(e.l) || leave.has(e.pi)) continue;
        if (_isBot(e) && (e.sum || 0) > s.n) continue;
        leave.add(e.pi);
        if (_isBot(e) || _differSaid.has(e.pi)) continue;
        _differSaid.add(e.pi); out.left++;
        _say(e.pi + " at l=" + e.l + " (" + (e.songKey || "no song") + ", from " + (e.src || "unknown") + ") is not in the bot's summary n=" + s.n +
          " (l=" + s.from + ".." + s.to + ") — it leaves song history");
      }
      marks.push({ n: s.n, from: s.from, to: s.to, count: s.count });
      out.taken++;
      if (!out.newest || s.to > out.newest.to || (s.to === out.newest.to && s.n > out.newest.n)) out.newest = { n: s.n, from: s.from, to: s.to, count: s.count };
    }
    if (!out.taken) return out;
    if (leave.size) _entries = _entries.filter((e) => !(e && leave.has(e.pi) && !incoming.has(e.pi)));
    _sums = marks.sort((a, b) => a.from - b.from);
    _wrote = true;
    if (incoming.size) _mergeIn(Array.from(incoming.values()), null, true);
    return out;
  }
  // The newest summary's serial this table took, or null: the reader stops at it (a reload reads only what is new).
  function summaryTop() { let n = null; for (const s of _sums) if (n === null || s.n > n) n = s.n; return n; }
  // ── FOR THE BOT'S OWN TAB (738, `consensus/history-rules.md` §12) — read-only: nothing below writes ───────────────────────────────
  // The summaries this table took — the bot's marks, set only from what it read back on the channel — each { n, from, to, count }, by
  // position.
  function summaries() { return _sums.map((s) => ({ n: s.n, from: s.from, to: s.to, count: s.count })); }
  // A STRETCH AS THIS DEVICE HOLDS IT: the rows song history holds from `from` to `to`, in the room's order — what the bot's tab sends
  // again when the room's count changes (the history size, `features/history-bot.js`). Copies.
  function readingOf(from, to) {
    if (typeof from !== "number" || typeof to !== "number") return [];
    return _entries.filter((r) => r && typeof r.l === "number" && r.l >= from && r.l <= to).map((r) => Object.assign({}, r));
  }
  // The room's window as this table reads it now (`_max()`): the bridge's page cap is derived from it.
  function size() { return _max(); }
  function origin() { return _origin ? Object.assign({}, _origin) : null; }
  // The room's start, once the chain reaches it. Only a start is an origin (J82): anything else is not recorded.
  function setOrigin(o) {
    if (!o || typeof o.l !== "number" || o.start !== true) return;
    if (!_origin) _origin = { l: 0, h: o.h || null, banked: null, start: true };
  }
  function markOpened() { _opened = true; _openedEpoch = _epoch; }
  // DOES THIS TABLE KNOW THE FLOOR? (J79) A floor that opens or closes a segment this table verified stood, then, on the chain
  // from this table's origin — and a floor's ancestry never changes (`prev` is in its fingerprint). So a chain that starts at a
  // floor the table knows stands on the table's origin; one it does NOT know, the bridge pages once to resolve
  // (`_resolvedChain`). Written for an owner's restore, which J82 removed; KEPT, because dropping it changes how many pages a
  // device reads in rooms never restored (design-after-571 B.2), and that was not re-measured.
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
      if (old && _isBot(old) && !_isBot(r)) continue;                  // the bot's row stays (§12): this write changes nothing
      for (const k of keys) { const v = _verified[k]; if (!v || r.l < v.lo || r.l > v.hi) continue;
        if (!old && ((v.live && r.pi === v.live) || (v.banked && r.pi === v.banked))) continue;   // the song in progress at the closing floor
        delete _verified[k]; }
    }
  }
  // WHERE A WRITER'S CUTS START (`ddjp_564`): at the room's start. A chain that reaches the room's first floor records it.
  function _cutsFrom(chain) {
    const ch = (chain || []).filter((c) => c && c.h && typeof c.l === "number" && c.seed);
    if (ch.length && ch[0].prevNull) setOrigin({ start: true, l: 0, h: ch[0].h });
    return [{ h: "start", l: -Infinity, seed: undefined }].concat(ch);
  }
  // THE CACHE REBUILD, THROUGH THE SAME SEGMENT FUNCTION (`ddjp_563`): the closed segments of the accepted chain folded exactly as
  // verify folds them — so a second open corrects nothing — and the open stretch after the newest floor as refresh does.
  function rebuildAnchored(events, chain) {
    const ev = (events || []).filter((e) => e && typeof e.l === "number" && e.type !== "ddjp.checkpoint")
      .sort(_roomOrder);
    const cuts = _cutsFrom(chain);
    let segments = 0, added = 0;
    // THE WINDOW (§10): with the window held, a held stretch wholly below its oldest song is not folded again, nor the stretch from
    // the room's start to a chain that does not reach the room's first floor — local reads, and the same rule as every reader's:
    // the rows such a fold makes are evicted at once, read as changes, and drop the window's lowest verify mark, so verify would
    // read that stretch from the room again (a shared room's reopening holds its whole room in the raw cache).
    const w = windowFrom(), reachesFirst = !!(cuts[1] && cuts[1].prevNull);
    for (let i = 0; i < cuts.length; i++) {
      const a = cuts[i], b = (i + 1 < cuts.length) ? cuts[i + 1] : null;
      if (w !== null && b && (b.l < w || (a.h === "start" && !reachesFirst))) continue;
      // A CLOSED STRETCH THE BOT'S SUMMARIES REACH INTO is not rebuilt from what is held (§12): where they hold it nothing is computed,
      // and the rest — a hole between two — is verify's and the fill's, read the `ddjp_735` way. A rebuild's claim there would hide that
      // hole: a stretch is claimed from whatever few events are held in it (a bot room's first one from its settings event alone).
      if (b && _sums.some((m) => m.to >= Math.max(0, a.l + 1) && m.from <= b.l)) continue;
      const seg = ev.filter((e) => e.l > a.l && (!b || e.l <= b.l)); if (!seg.length) continue;
      if (!b) { const r = ingest(seg, a.seed, { src: "cache" }); added += (r && r.added) || 0; segments++; continue; }
      const sr = _segmentRows(seg, a.seed, b.seed, new Map(_entries.map((r) => [r.pi, r]))); if (!sr) continue;
      const rows = sr.rows.map((r) => Object.assign({}, r, { src: "cache", floorSig: _floorSig() }));
      _dropKeysChangedBy(rows);
      if (!_restoredOnce) for (const r of rows) if (typeof r.l === "number") _touchedBeforeRestore.push(r.l);
      const n0 = _entries.length; _mergeIn(rows.filter((r) => r.src !== "floor"), null, true, sr.ended, sr.reasons); _mergeIn(rows.filter((r) => r.src === "floor"), null, false, sr.ended, sr.reasons); added += Math.max(0, _entries.length - n0); segments++;
      _endsOnto(sr.ends);   // when each song this stretch saw end ended (§12)
      _cover(Math.max(0, a.l + 1), b.l);
    }
    return { segments: segments, added: added };
  }
  // INCREMENTAL VERIFY (`ddjp_561`, the owner's audit of 560): only the floor-anchored segments not yet verified are read from the
  // room — on a later open of an unchanged room, none. `chain` = the accepted floors, oldest first ({ h, l, seed }). The stretch
  // after the newest floor is the held log's (refresh), not paged here.
  // NEWEST FIRST, AND NO DEEPER THAN THE WINDOW (the owner's, §10). A segment wholly below the window's oldest song is never read.
  // At the oldest floor the chain names, the stretch below it is read only if the table still needs it and verify has not
  // checked it on an earlier open (`_verifiedSpan`): then `opts.older(floor, positions)` — the bridge's walk — hands the floors
  // just below, back through `prev`, from one bounded read; and the stretch from the room's start is folded only once the chain
  // reaches the room's first floor (`prevNull`) — or when no walk is given (a caller with the whole chain) or the walk cannot go
  // on and the table does not hold the window, as before. Before this, the stretch from the room's start to the oldest floor a
  // device remembers was re-read at every open (and, in a shared room, every trim), because that floor moves.
  // ENDINGS LAND AS THEY DID OLDEST FIRST: a song spanning a cut is seen to end in the newer stretch, read first now, so every
  // stretch's endings are put on the rows once more at the end (§11).
  async function verifyIncremental(chain, opts) {
    if (typeof _env.pageRange !== "function") return { ok: false, reason: "no-pager", pages: 0 };
    const older = (opts && typeof opts.older === "function") ? opts.older : null;
    let ch = (chain || []).filter((c) => c && c.h && typeof c.l === "number" && c.seed);
    let pages = 0, verified = 0, skipped = 0, changed = 0, walked = 0, summarised = 0;
    const ep = _epoch;
    const endedAll = Object.create(null), reasonsAll = Object.create(null);
    const endsAll = Object.create(null);   // and when (§12)
    const START = { h: "start", l: 0, seed: undefined };
    const one = async (a, b) => {
      const key = KEY_V + a.h + ">" + b.h;   // versioned: marks made under an older rule re-verify once
      if (_verified[key]) { skipped++; return "skipped"; }
      const lo = (a.h === "start") ? 0 : a.l + 1, hi = b.l;
      // WHOLLY INSIDE THE BOT'S SUMMARIES (§12): trusted, nothing computed and nothing read for it — never marked verified, which is
      // verify's own word.
      if (_insideSums(lo, hi)) { summarised++; return "summarised"; }
      let events = null; try { events = await _env.pageRange(lo, hi); pages++; } catch (e) { events = null; }
      if (ep !== _epoch) return "reset";
      if (!Array.isArray(events)) return "failed";
      if (a.h === "start" && !events.some((e) => typeof e.l === "number" && e.l <= 1)) return "failed";   // the room's start not reached: cannot verify
      const seg = events.filter((e) => e && typeof e.l === "number" && e.l >= lo && e.l <= hi && e.type !== "ddjp.checkpoint")
        .sort(_roomOrder);
      const prev = new Map(_entries.map((r) => [r.pi, r]));
      const sr = _segmentRows(seg, a.seed, b.seed, prev);
      if (!sr) return "failed";
      const produced = sr.rows.map((r) => Object.assign({}, r, { src: r.src === "floor" ? "floor" : "verify", floorSig: _floorSig() }));
      const keepPi = new Set(produced.map((r) => r.pi)); if (sr.live) keepPi.add(sr.live); if (sr.banked) keepPi.add(sr.banked);   // never delete a banked song
      // nor the bot's rows (§12): a stretch partly inside its summaries keeps them, whatever this fold says
      const before = _entries.filter((r) => r && typeof r.l === "number" && r.l >= lo && r.l <= hi && !_isBot(r));
      _entries = _entries.filter((r) => !(r && typeof r.l === "number" && r.l >= lo && r.l <= hi && !keepPi.has(r.pi) && !_isBot(r)));
      const botPi = new Set(_entries.filter(_isBot).map((r) => r.pi));   // the bot's rows stay as they are: not a correction either way
      const was = new Set(before.map(_k3)), now = new Set(produced.filter((r) => !botPi.has(r.pi)).map(_k3));
      for (const k of was) if (!now.has(k)) changed++; for (const k of now) if (!was.has(k)) changed++;
      _mergeIn(produced.filter((r) => r.src !== "floor"), null, true, sr.ended, sr.reasons); _mergeIn(produced.filter((r) => r.src === "floor"), null, false, sr.ended, sr.reasons);   // a banked row is a fallback
      _endsOnto(sr.ends); if (sr.ends) Object.assign(endsAll, sr.ends);
      if (sr.ended) Object.assign(endedAll, sr.ended); if (sr.reasons) Object.assign(reasonsAll, sr.reasons);
      _cover(lo, hi); _verified[key] = { lo: lo, hi: hi, live: sr.live || null, banked: sr.banked || null }; verified++;
      return "verified";
    };
    const origin = () => { if (ch.length && ch[0].prevNull) setOrigin({ start: true, l: 0, h: ch[0].h }); };   // the room's first floor reached
    origin();
    let i = ch.length - 1;
    for (;;) {
      if (i >= 1) {
        const w = windowFrom();
        if (w !== null && ch[i].l < w) break;                       // wholly below the window's oldest song: never read
        if (await one(ch[i - 1], ch[i]) === "reset") return { ok: false, reason: "reset", pages: pages };
        i--; continue;
      }
      if (!ch.length) break;
      const c0 = ch[0], w = windowFrom();
      if (w !== null && c0.l < w) break;                             // the window starts above the oldest floor: all read
      // the room's first floor, or a caller with no walk: the stretch from the room's start, its own mark deciding, as before
      if (c0.prevNull || !older) { if (await one(START, c0) === "reset") return { ok: false, reason: "reset", pages: pages }; break; }
      if (_verifiedSpan((w !== null) ? w : 0, c0.l)) break;          // checked on an earlier open: nothing to read
      if (_insideSums((w !== null) ? w : 0, c0.l)) break;            // the bot's summaries hold it (§12): nothing to read
      let ext = [];
      // HOW FAR BELOW `c0` TO READ (§10): the songs the NEWEST window still needs below `c0` (positions, so the read cannot pass
      // that window's oldest song), no deeper than the window held, AND NO DEEPER THAN WHERE AN EARLIER OPEN'S CHECKS RESUME (the
      // supervisor's finding at `ddjp_735`): a tab back after a long absence holds the window of its last visit, so what it still
      // needs is the stretch it missed. Sized from that old window alone, the walk read down to its floor — nearly the whole
      // window again — for any absence past the download's reach. And at least the last stretch's length: the save point below
      // sits about that far down, and the fold of the oldest stretch it needs starts from it.
      let need = Math.max(1, _max() - _rowsAbove(c0.l));
      if (w !== null) need = Math.min(need, c0.l - w + 1);
      const top = _verifiedTopBelow(c0.l);
      if (top !== null) need = Math.min(need, c0.l - top + 1);
      // AND NO DEEPER THAN WHAT THE BOT'S SUMMARIES LEAVE UNHELD (§12): the nearest stretch below `c0` neither they nor the events read
      // hold — a hole between two summaries — and the save point at or below it, which the fold of that hole starts from.
      if (_sums.length) { const u = _newestUnheld((w !== null) ? w : 0, c0.l); if (u !== null) need = Math.min(need, c0.l - u + 1); }
      try { ext = await older(c0, Math.max(need, (ch.length > 1) ? (ch[1].l - c0.l + 1) : 1)); } catch (e) { ext = []; }
      if (ep !== _epoch) return { ok: false, reason: "reset", pages: pages };
      const seen = new Set(ch.map((c) => c.h));
      ext = (Array.isArray(ext) ? ext : []).filter((c) => c && c.h && typeof c.l === "number" && c.seed && c.l < c0.l && !seen.has(c.h));
      if (!ext.length) {                                              // the walk cannot go on: from the room's start, as before,
        // unless the window is held (a "reaches the start" claim is not asked here: a rebuild can make one from one held event)
        if (windowFrom() === null) { if (await one(START, c0) === "reset") return { ok: false, reason: "reset", pages: pages }; }
        break;
      }
      walked += ext.length; ch = ext.concat(ch); i = ext.length; origin();
    }
    if (verified) _mergeIn([], null, true, endedAll, reasonsAll);   // every stretch's endings, on the rows as they now stand (§11)
    if (verified) _endsOnto(endsAll);   // and when each ended (§12)
    return { ok: true, pages: pages, verified: verified, skipped: skipped, changed: changed, walked: walked, summarised: summarised, window: windowFrom() };
  }
  // THE HISTORY AUDIT (`ddjp_559`, read-only): the room's events, paged from its start, folded by the app's own reducer from the
  // beginning, compared with this device's table row by row. Nothing here changes the table.
  function auditAgainst(events, opts) {
    const evs = (Array.isArray(events) ? events : []).filter((e) => e && typeof e.l === "number").slice().sort(_roomOrder);
    const posOf = Object.create(null); for (const e of evs) if (e.eventId) posOf[e.eventId] = e.l;
    // THE TRUTH IS FLOOR-ANCHORED (`ddjp_560`): one fold from the room's start diverges from the settled floors where a replay
    // and live acceptance differ; the app follows floors. The raw fold is still reported, where it disagrees.
    // UNDER THE WINDOW (§10): `opts.from` is the window's oldest song — the events start at the floor that anchors it, the truth is
    // folded from that floor, and only rows at or above it are compared. The raw fold from the room's start has no start to fold
    // from then, so its comparisons are not made.
    const win = (opts && typeof opts.from === "number") ? opts.from : null;
    const _anch = deriveAnchored(evs, opts && opts.anchors, win !== null ? { fromAnchor: true } : null);
    const truth = (win !== null) ? _anch.rows.filter((r) => typeof r.l === "number" && r.l >= win) : _anch.rows;
    let _raw = null; if (win === null) { try { _raw = StateDeriver.derive(evs); } catch (e) { _raw = null; } }
    const rawRows = (_raw && Array.isArray(_raw.history)) ? _raw.history : [];
    const mine = _entries.slice();
    const tset = new Map(truth.map((r) => [r.pi, r])), mset = new Map(mine.map((r) => [r.pi, r]));
    const ranges = _ranges.map((r) => r.slice());
    const why = (l) => { if (typeof l !== "number") return "position unknown";
      if (!ranges.length || l < ranges[0][0]) return "below the first covered position — never fetched";
      if (ranges.some((r) => l >= r[0] && l <= r[1])) return "claimed as covered, yet absent";
      return "in an uncovered hole"; };
    const row = (r) => ({ pi: r.pi, l: (typeof r.l === "number") ? r.l : (posOf[r.pi] !== undefined ? posOf[r.pi] : null), songKey: r.songKey || null, dj: r.dj || r.user || null });
    const missing = truth.filter((r) => !mset.has(r.pi)).map((r) => Object.assign(row(r), { why: why(posOf[r.pi]) }));
    const extra = mine.filter((r) => !tset.has(r.pi)).map((r) => Object.assign(row(r), { src: r.src || "unknown", floorSig: r.floorSig === undefined ? null : r.floorSig }));
    const differs = truth.filter((r) => mset.has(r.pi) && (mset.get(r.pi).songKey || null) !== (r.songKey || null))
      .map((r) => Object.assign(row(r), { deviceSongKey: mset.get(r.pi).songKey || null, src: mset.get(r.pi).src || "unknown" }));
    const rset = new Map(rawRows.map((r) => [r.pi, r]));
    const rawVsFloors = (win !== null) ? [] : truth.filter((r) => !rset.has(r.pi)).map((r) => Object.assign(row(r), { raw: "absent" }))
      .concat(rawRows.filter((r) => !tset.has(r.pi)).map((r) => Object.assign(row(r), { raw: "only in the raw fold" })))
      .concat(truth.filter((r) => rset.has(r.pi) && (rset.get(r.pi).songKey || null) !== (r.songKey || null)).map((r) => Object.assign(row(r), { raw: "song " + rset.get(r.pi).songKey })));
    const anchorsUsed = _anchorsIn(evs, opts && opts.anchors);
    const rawHeads = (win !== null) ? [] : anchorsUsed.map((a) => { let h = null; try { const s2 = StateDeriver.derive(evs.filter((e) => e.l <= a.l)); h = s2 && s2.nowPlaying ? s2.nowPlaying.pi : null; } catch (x) {} return { floorL: a.l, rawHead: h, floorHead: (a.seed && a.seed.nowPlaying) ? a.seed.nowPlaying.pi : null }; })
      .filter((x) => x.rawHead !== x.floorHead);
    return { truthCount: truth.length, deviceCount: mine.length, missing: missing, extra: extra, differs: differs, rawVsFloors: rawVsFloors, rawHeadsDisagree: rawHeads,
             floorChecks: _anch.floorChecks.filter((c) => c.segmentHead !== c.floorHead), settled: _anch.settled, coverage: { ranges: ranges, complete: !!(ranges.length && ranges[0][0] <= 0) },
             stored: _lastRestore ? Object.assign({}, _lastRestore) : null, eventsRead: evs.length, reachedFrom: (opts && typeof opts.reachedFrom === "number") ? opts.reachedFrom : null,
             window: win };
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
    // Ranges first, then rows: eviction past the window must find the ranges it has to clip.
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
    // THE SUMMARIES TAKEN BEFORE (§12; with the ranges, before the rows, for the same reason): their stretches and serials, so this
    // visit's read stops at the newest one held. A table stored without them holds none, and the read goes as a first open's does.
    if (Array.isArray(snap.sums)) for (const x of snap.sums) {
      if (!x || ![x.n, x.from, x.to, x.count].every((v) => Number.isSafeInteger(v) && v >= 0) || x.to < x.from || _sums.some((y) => y.n === x.n)) continue;
      _sums.push({ n: x.n, from: x.from, to: x.to, count: x.count });
    }
    _sums.sort((a, b) => a.from - b.from);
    // A ROW SAVED BEFORE `ddjp_707` NAMES ITS SONG BY ANOTHER FIELD (the owner's rule since `ddjp_706`: nothing saved before
    // is carried over): every row this build writes carries `songKey`, null or not, so a row without it is skipped — never
    // shown half-read — and counted for the caller's one log line.
    const _rows = snap.rows.filter((r) => r && typeof r.pi === "string");
    const _kept = _rows.filter((r) => Object.prototype.hasOwnProperty.call(r, "songKey"));
    _mergeIn(_kept.map((r) => r.src ? r : Object.assign({}, r, { src: "stored" })));
    _lastRestore = { rows: snap.rows.length, ranges: Array.isArray(snap.ranges) ? snap.ranges.slice() : null, v: snap.v };
    // MARKS RESTORED AFTER A WRITER TOUCHED A SEGMENT DO NOT COUNT (`ddjp_563`, the bot's open: 16 trims wrote rows before the
    // restore, and the restored marks then said "verified"); a mark of an older rule (not `KEY_V`) does not count either, and
    // is counted so the open can say so (ruling 42).
    // NOR A MARK OVER TWO SONGS AT ONE POSITION (J97, the owner's `?v=545` audit). One position holds one song — a race's plays
    // name one parent, and the fold accepts one — so a checked segment holding two was written to after its check: a second
    // restore in one visit put the old order's row back beside verify's. Such a segment is checked against the room once more.
    const _twoAtOne = (lo, hi) => { const at = new Set();
      for (const r of _entries) { if (!r || typeof r.l !== "number" || r.l < lo || r.l > hi) continue; if (at.has(r.l)) return true; at.add(r.l); }
      return false; };
    let older = 0, doubled = 0;
    if (snap.verified && typeof snap.verified === "object") for (const k of Object.keys(snap.verified)) { const v = snap.verified[k];
      if (v && typeof v.hi === "number" && k.indexOf(KEY_V) !== 0) older++;
      if (!v || typeof v.hi !== "number" || k.indexOf(KEY_V) !== 0) continue;
      if (_touchedBeforeRestore.some((l) => l >= v.lo && l <= v.hi)) continue;
      if (_twoAtOne(v.lo, v.hi)) { doubled++; continue; }
      _verified[k] = { lo: v.lo, hi: v.hi, live: v.live || null, banked: v.banked || null }; }
    _restoredOnce = true;
    if (snap.origin && snap.origin.start === true && !_origin) _origin = { l: 0, h: snap.origin.h || null, banked: null, start: true };   // only a start (J82)
    _coverageSig = null;   // a stored table's coverage was derived under a floor we cannot name: the next reconcile clips it
    return { ok: true, restored: _entries.length, olderMarks: older, doubled: doubled, skipped: _rows.length - _kept.length };
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

  // How much of the room we can actually account for. Honest rather than reassuring: a pane that
  // says "showing the last 40 songs" is useful, and one that implies it has everything when it has
  // a window is not.
  // THE BOT'S SUMMARIES (§12) are part of what the table holds — the ranges, the reach, `full` — and never of `complete`, the room's
  // events reaching its start, which is the one thing the fold is told. `fromStart`: the room's start is held — by its events, by
  // events and summaries together, or by the newest summary's count (below the history size) met — what the replay rule reads to
  // tell "not played" from "cannot tell" (`Room.playedWithin`).
  function coverage() {
    const n = _ranges.length;
    const complete = n === 1 && _ranges[0][0] <= 0;
    const sp = _spans(), m = sp.length, top = _newestSum();
    return { fromL: m ? sp[0][0] : null, toL: m ? sp[m - 1][1] : null, complete: complete,
             entries: _entries.length, cap: _max(), ranges: sp.map((r) => r.slice()),
             // where the unbroken stretch back from the newest position starts — the only reach a
             // decision may use (`Room.playedWithin`)
             topFromL: m ? sp[m - 1][0] : null,
             // THE WINDOW (§10): the oldest kept song's position while the table holds the room's newest `_max()` songs, else null;
             // `full` — nothing more is needed: the room's start reached, the window held, or the newest summary's count met
             windowFrom: windowFrom(), fromStart: _fromStart(), full: _full(), eventsFrom: n ? _ranges[0][0] : null,
             summaries: top ? { taken: _sums.length, n: top.n, to: top.to, count: top.count, met: _countMet() } : null };
  }

  // A room change clears everything. Per-room state that survives a room change is its own bug
  // class, and history is per-room by definition.
  // A RESET ENDS THE WORK IN FLIGHT TOO (J83): the paging steps below check the epoch after every page they wait for, so a
  // backfill, gap fill or verify still running when its room is left writes nothing into the next room's table.
  let _epoch = 0;
  // THE CHECKS AND THE RESTORE ARE THE ROOM'S TOO (J97): a mark this visit's verify made, kept past the room change, vouched in the
  // next visit for rows that visit's restore brought back unchecked — the same hole a second restore in one visit made. They are
  // stored with the table, so the next visit's restore reads them again.
  function reset() { _epoch++; _entries = []; _ranges = []; _added = Object.create(null); _addedL = Object.create(null); if (_env.awaitOpen) _opened = false;
    _verified = Object.create(null); _origin = null; _lastRestore = null; _touchedBeforeRestore = []; _restoredOnce = false; _seenEnds = new Map();
    _sums = []; _differSaid = new Set(); }

  function _setForTest(list) { _entries = (list || []).slice(); }

  // ── THE NOTICE: SONG HISTORY SAYS WHEN IT WROTE (J130's correction, `ddjp_662`; BEHAVIOUR.md's fifth announcer) ─────────────
  // The History tab was told only by the queue's notice, which on a page's first room runs BEFORE the refresh a play asks for
  // (`Queue.init` subscribes before `wireCheckpoints`, once a page) — so the tab read the table one song late — and which never
  // runs when a tab that was not settled pays the refresh it owes. And the engine writes here too (a trim, following a save
  // point, a bot room moving on), with nothing told. So the one place every write passes says so: `onChange(fn)`, `fn()` with no
  // argument, each listener in its own try. Reached by the app through the transport's `onHistoryChange` (ui/ may only reach a
  // feature: `Queue.onHistoryChange`); the tab compares its record (J130), so a notice that changes nothing on screen redraws
  // nothing. It tells; it sends nothing and moves nothing (PART G of `check-history`).
  // DUMB, ON PURPOSE (the owner, `ddjp_662`): "did it change" is "was the table or its reach written" — a flag set where they
  // are (`_cover`, `_clipBelow`, `_mergeIn`, `reconcileFloor`), never a comparison of contents. ONE OPERATION, AT MOST ONE
  // NOTICE, never one per row: the exported writers below are wrapped, and the inner calls are not — a sync one tells at its
  // end (a depth count keeps a nested call quiet), an async one (backfill, fillGaps, verifyIncremental: pages in between) once
  // it settles, so a backfill's segments or a rebuild's are one notice. Not told: `reset` (the room being left — its listeners
  // stay, the next room's pane is drawn whole at entry, and telling would redraw the leaving room's History empty), and what
  // writes nothing the table holds for the screen (`markOpened`, `attach`, `setOrigin`, `noteAdds`' added times).
  // THE LISTENERS ARE THE PAGE'S: a reset never clears them, as `Floor`'s and `StreamManager`'s survive a room change — the
  // bridge's relay is wired once a page. A room left cannot write (the epoch above), so it cannot tell.
  const _listeners = [];
  let _wrote = false, _depth = 0;
  function onChange(fn) { if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }
  function offChange(fn) { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }
  function _tell() {
    if (!_wrote || _depth > 0) return;
    _wrote = false;
    for (const fn of _listeners.slice()) { try { fn(); } catch (e) { /* a listener's fault is its own */ } }
  }
  const _op = (fn) => function () { _depth++; try { return fn.apply(null, arguments); } finally { _depth--; _tell(); } };
  const _opAsync = (fn) => function () { return Promise.resolve(fn.apply(null, arguments)).finally(() => { _tell(); }); };
  const _quiet = (fn) => function () { try { return fn.apply(null, arguments); } finally { _wrote = false; } };

  return {
    auditAgainst, deriveAnchored, windowFrom, verifyFrom: _op(verifyFrom), verifyIncremental: _opAsync(verifyIncremental), rebuildAnchored: _op(rebuildAnchored), origin, setOrigin, markOpened, knowsFloor, MAX, attach, noteAdds, addedAt, addedAtL, holes, fillGaps: _opAsync(fillGaps), confirmStart: _opAsync(confirmStart), reconcileFloor: _op(reconcileFloor), unbackedRows, backing, snapshot, restore: _op(restore), resize: _op(resize), size, takeSummaries: _op(takeSummaries), summaryTop, summaries, readingOf, droppableBelow, ingest: _op(ingest), refresh: _op(refresh), _looksLikeSegment, backfill: _opAsync(backfill), recent, count, coverage, reset: _quiet(reset), foldRange, merge, _setForTest, onChange, offChange };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { History };
