// features/history-bot.js — 738: THE SONG HISTORY CHANNEL'S BOT SIDE — the room's bot writes the room's song history summaries, and
// fills their holes (the owner's design, `consensus/history-rules.md` §12; his words in `main/01-project.md` item 7, and — that nothing
// is corrected after the fact — his 740 words in §12). Runs only on the
// room's bot tab, in both room types, and only while it holds the room's single-writer lock. REP's bot side is the model
// (`features/rep-bot.js`): its own piece, reaching the app through its own door (`features/history-ports.js`), started and stopped by
// the room beside REP.
//
// Depends on: HistorySummary (the format, `core/historysummary.js`: pure) and HistoryPorts (everything else). Nothing else:
// `check-history-bot-boundary` holds that this file names no app global. Timers are the language's own; every time it judges by is the
// server's (`HistoryPorts.serverNow`), never the device's clock.
//
// ── WHAT IT KEEPS: NOTHING OF ITS OWN ─────────────────────────────────────────────────────────────────────────────────────────────
// Its record is song history's own table, stored as every device stores it: the rows (what History holds), and the MARKS — the
// summaries History took (`HistoryPorts.marks`). THE ONE RULE (the supervisor's rundown, the owner's words): a mark is set ONLY from
// what the bot reads back on the channel — its own echo, through the reader every device uses (737's `_readSummaries`, run again
// when the echo arrives: nothing new to page while the channel's timeline holds it) — never from what it believes it sent. So a send
// that failed, or was lost, is simply unmarked, and A FINISHED SONG IN THE TABLE WITH NO MARK IS OWED A SUMMARY. That one rule covers
// new songs, the bot being offline (a shared room plays on without it), a send that never landed and a lost store: whatever the
// reason, the song has no mark. It trusts itself to forget (his words: "it uses its own recaps but protected by flore"): below its save
// point it reads its own summaries as every device does, and re-reads no events there.
//
// ── WHEN IT IS READY ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Before posting anything it checks everything since its trusted save point and every hole (his "validate all before posting"): that
// is song history's own reading of the room (the stored table, the channel, verify, the fill — the `ddjp_735` way, his "repair from
// the history of events"), and the bot waits for it — this tab caught up (`mayAuthor`), no run of it in flight (`busy`), and the
// table `full`: holding the room's start or its window. Summaries older than its trusted save point are not re-checked: nothing
// re-derives a stretch a summary holds, below the held log.
//
// ── WHAT IT SENDS, AND WHEN (one summary per message, `HistorySummary.TYPE`, on the room's song history channel) ─────────────────────
//   NEW   the finished songs no summary holds, oldest first. A stretch of them below a summary (a hole) is due at once; the newest
//         stretch once it holds N songs (N, the room's "Songs per summary", `historySummaryEvery`, read live) — sent whole, bundled up
//         to the format's budget (`HistorySummary.fit`), so normally exactly N, up to the song that just ended. No song waits behind
//         (740: 738 held the newest finished song back for votes still in flight; the room now refuses a vote that lands after its
//         song ended, so the summary of a finished song is final when it goes).
//   THE STRETCH: from just above the summary below (the room's start, 0, when the table holds it and there is none; else the window's
//         oldest song) up to just below what comes next — the next summary, or the song playing; with nothing after, its last song.
//         So two summaries never overlap and leave no gap the bot did not mean; `fit` cuts just below the first song it leaves out
//         and never splits one position.
//   THE COUNT (his words: "the bot says 3 songs in histroy batch and once it reaches 5000 itself just posts that every time"): the
//         history size while the table holds the window; else the songs at or below the stretch's end, the table holding the room's
//         start. Never more than the size.
//   NO CORRECTION (740, the owner's: "the bot can correct holes in the timeline, but yes noting to correct after"): a stretch already
//         summarised is never sent again because what this tab reads of it changed — a play or a vote reaching the room after its
//         stretch was summarised stays out. THE COUNT RE-SEND stays, and is not a correction: where the newest summary's count is no
//         longer the count the rule gives (the history size raised), that stretch again — its rows as this tab holds them, the bot's
//         own — with the count it gives now, so a device opening afterwards stops reading at the right place.
//   PACING (his words: "maybe 10 seconds appart"): one summary in flight — from its send until its echo is read back as a mark (or
//         given up: not read back 30 s after it was sent, its songs are owed again) — and at least 10 s between two sends; after a
//         failure the spacing doubles, to at most five minutes. A server push-back is the transport's hold (736): the send simply
//         answers later. The runner's gate does not carry these sends (736's decision: the history channel is another room).
//   THE SERIAL: the server's time in whole milliseconds, above every serial song history holds and every one this side sent.
//
// ── LIFECYCLE (the room's two hook sites, beside REP's) ─────────────────────────────────────────────────────────────────────────────
// `enter` on every room entry and rank change: starts on the bot's tab, stops elsewhere, keeps running across a rank change in the same
// room. `leave` at the one leave step (`features/room.js` `leave`): timers and listeners let go, the lock released, a send in flight
// left to land unmarked — its songs are owed at the next visit. Nothing of it runs in the lobby (ruling 18).
const HistoryBot = (() => {
  const TICK_MS = 15000;        // a look every 15 s (REP's beat), besides song history's notice and the bot's own echo
  const SOON_MS = 1000;         // after a write or an echo: look again within a second, at most once a second
  const SPACING_MS = 10000;     // at least this long between two summaries (his "maybe 10 seconds appart")
  const FAIL_MAX_MS = 300000;   // after failures in a row the spacing doubles, to at most this
  const ECHO_READ_MS = 5000;    // a summary sent and not read back this long after: the channel read back once
  const ECHO_MS = 30000;        // ...and not read back this long after: its songs are owed again
  const REARM_MS = 300000;      // a table not full: song history's reading run again at most this often

  let _s = null, _gen = 0, _caughtUpHeard = false;
  const _log = (m) => HistoryPorts.log("info", m);
  const _warn = (m) => HistoryPorts.log("warn", m);
  const _short = (id) => (typeof id === "string" && id.length > 14) ? id.slice(0, 12) + "…" : String(id);
  function _onCaughtUp() { if (_s) _soon(_s); }
  function _onHistory() { if (_s) _soon(_s); }
  // ITS OWN ECHO: a summary from this account on the room's song history channel — read back through song history's reader, which
  // takes it as a mark (nothing to page while the channel's timeline holds it), then a look.
  function _onRaw(raw) {
    const s = _s;
    if (!s || s.writer !== true || !raw) return;
    if (raw.room_id === (s.channels && s.channels.history_owner) && raw.sender === s.me && raw.ddjpType === HistorySummary.TYPE) _readBack(s);
  }
  function _readBack(s) {
    if (!s || s.reading || _s !== s) return;
    s.reading = true;
    Promise.resolve(HistoryPorts.readBack()).catch(() => null).then(() => { s.reading = false; if (_s === s) _soon(s); });
  }
  function _soon(s) { _later(s, SOON_MS); }
  function _later(s, ms) {
    if (!s || s.soon || _s !== s) return;
    s.soon = setTimeout(() => { s.soon = null; _step(); }, Math.max(SOON_MS, ms || 0));
  }
  function _spacing(s) { return Math.min(FAIL_MAX_MS, SPACING_MS * Math.pow(2, Math.min(Math.max(0, s.fails - 1), 5))); }   // 10 s, then 20, 40 … after failures
  function _notReady(s, why) { if (s.waiting === why) return; s.waiting = why; _log("not ready — " + why); }

  // ── THE LOOK ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function _step() { try { _stepNow(); } catch (e) { _warn("a look failed — " + ((e && e.message) || e)); } }
  function _stepNow() {
    const s = _s;
    if (!s || s.writer !== true || s.sending) return;
    const now = HistoryPorts.serverNow();
    if (now === null) return;                 // no server time yet: nothing judged by it
    if (!HistoryPorts.mayAuthor()) return;    // still catching up
    if (HistoryPorts.busy()) return;          // song history is being read: it checks before anything is posted
    const cov = HistoryPorts.coverage();
    if (!cov || cov.full !== true) {   // IT CHECKS ITS GAPS FIRST: song history's own reading, run again — at most every REARM_MS
      _notReady(s, "song history holds neither the room's start nor its window yet — its holes are read back first");
      if (s.rearmAt === null || now - s.rearmAt >= REARM_MS) { s.rearmAt = now; HistoryPorts.rearm(); }
      return;
    }
    const N = (HistoryPorts.settings() || {}).historySummaryEvery;
    if (!Number.isSafeInteger(N) || N < 1) { _notReady(s, "the room's songs per summary cannot be read"); return; }
    if (s.waiting !== null) { s.waiting = null; _log("ready — song history holds " + (cov.windowFrom !== null ? "the room's newest " + cov.entries + " songs" : "the room from its start") + "; a summary every " + N + " finished songs"); }
    let marks = HistoryPorts.marks();
    if (s.flight) {   // ONE IN FLIGHT: marked only once read back
      const f = s.flight;
      if (marks.some((m) => m.n === f.n)) { s.flight = null; _log("summary n=" + f.n + " read back — marked (l=" + f.from + ".." + f.to + ")"); }
      else if (!f.ok) return;                 // its send has not answered
      else {
        const age = now - f.at;
        if (age < ECHO_MS) { if (age >= ECHO_READ_MS && !f.read) { f.read = true; _readBack(s); } _later(s, Math.min(ECHO_MS - age, ECHO_READ_MS)); return; }
        if (!f.reread) { f.reread = true; _readBack(s); return; }
        s.flight = null;
        _warn("summary n=" + f.n + " was sent and is not on the channel " + Math.round(ECHO_MS / 1000) + " s later — its songs are owed again");
      }
    }
    const gap = (s.lastAt === null) ? Infinity : now - s.lastAt, wait = _spacing(s);
    if (gap < wait) { _later(s, wait - gap); return; }
    const work = _owed(cov, marks, N);
    if (!work) return;
    _send(s, work, now, marks, cov);
  }

  // ── WHAT IS OWED, OLDEST FIRST ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Rows in the room's order; `marks` the summaries song history took. Answers the oldest due { kind, from, to, rows?, why, countAt }.
  function _owed(cov, marks, N) {
    const all = (HistoryPorts.rows() || []).filter((r) => r && typeof r.pi === "string" && typeof r.l === "number").slice().reverse();
    const playing = HistoryPorts.playingPi();
    const at = playing ? all.findIndex((r) => r.pi === playing) : -1;
    const ended = (at >= 0) ? all.slice(0, at) : all;
    const cand = ended;   // every finished song, up to the one that just ended (740: none waits behind)
    const size = cov.cap;
    const countAt = (to) => (cov.windowFrom !== null ? size : Math.min(size, all.filter((r) => r.l <= to).length));
    const ms = marks.slice().sort((a, b) => a.from - b.from);
    const spans = [];
    for (const m of ms) { const last = spans[spans.length - 1]; if (last && m.from <= last[1] + 1) last[1] = Math.max(last[1], m.to); else spans.push([m.from, m.to]); }
    let j = 0;
    const marked = (l) => { while (j < spans.length && spans[j][1] < l) j++; return j < spans.length && spans[j][0] <= l; };
    const items = [];
    // NEW: the runs of finished songs no summary holds
    const runs = [];
    let cur = null;
    for (const r of cand) { if (marked(r.l)) { cur = null; continue; } if (!cur) { cur = []; runs.push(cur); } cur.push(r); }
    for (const run of runs) {
      const first = run[0], last = run[run.length - 1];
      let prevTo = null, nextFrom = null;
      for (const m of ms) { if (m.to < first.l && (prevTo === null || m.to > prevTo)) prevTo = m.to; if (m.from > last.l && (nextFrom === null || m.from < nextFrom)) nextFrom = m.from; }
      const from = (prevTo !== null) ? prevTo + 1 : (cov.fromStart ? 0 : (cov.windowFrom !== null ? cov.windowFrom : first.l));
      const after = all[all.indexOf(last) + 1];
      let to = Math.min(nextFrom !== null ? nextFrom - 1 : Infinity, after ? after.l - 1 : Infinity);
      if (!isFinite(to)) to = last.l;
      if (to < last.l || from > first.l) continue;   // two songs at one position: never split, never claimed
      const hole = nextFrom !== null;
      if (!hole && run.length < N) continue;          // the newest stretch: once it holds N songs
      items.push({ kind: "new", from: from, to: to, rows: run, countAt: countAt, why: hole ? "a stretch no summary holds" : "every " + N + " songs" });
    }
    // THE COUNT RE-SEND: the newest summary's count, where it says FEWER songs than the table holds up to its end: a count the bot stopped at an
    // older, smaller history size, since raised. (One that says more — the size lowered — a device caps at its own size already; and
    // a room passing the size for the first time keeps its exact count, the rule's "the size" being for what comes next.)
    let newest = null;
    for (const m of ms) if (!newest || m.to > newest.to || (m.to === newest.to && m.n > newest.n)) newest = m;
    const below = newest ? all.filter((r) => r.l <= newest.to).length : 0;
    if (newest && below > newest.count && countAt(newest.to) !== newest.count) {
      items.push({ kind: "count", from: newest.from, to: newest.to, countAt: countAt, why: "the count is now " + countAt(newest.to) + " (n=" + newest.n + " said " + newest.count + ")" });
    }
    if (!items.length) return null;
    items.sort((a, b) => a.from - b.from);
    return items[0];
  }

  // ── ONE SUMMARY OUT ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function _send(s, work, now, marks, cov) {
    const rows = (work.kind === "new") ? work.rows : (HistoryPorts.readingOf(work.from, work.to) || []);
    if (!rows.length) return;
    const top = marks.reduce((x, m) => Math.max(x, m.n), 0);
    const n = Math.max(now, top + 1, s.lastN + 1);
    const f = HistorySummary.fit({ n: n, from: work.from, to: work.to, rows: rows, size: cov.cap,
      countAt: (k) => work.countAt(k < rows.length ? rows[k].l - 1 : work.to) });
    if (!f.body) { _warn("summary n=" + n + " not sent — not even its oldest song fits the budget (l=" + work.from + ")"); return; }
    const b = f.body, bytes = HistorySummary.sentBytes(HistorySummary.TYPE, b);
    s.sending = true;
    s.flight = { n: n, from: b.from, to: b.to, kind: work.kind, ok: false, at: now, read: false, reread: false };
    Promise.resolve(HistoryPorts.sendSide(s.channels, HistorySummary.TYPE, b)).then((res) => {
      s.sending = false;
      if (_s !== s) return;   // left meanwhile: nothing marked; its songs are owed at the next visit
      const t = HistoryPorts.serverNow(), at = (t !== null && t > now) ? t : now;
      s.lastAt = at;
      if (!res || res.ok !== true) { _failed(s, n, (res && res.reason) || "refused"); return; }
      s.fails = 0; s.lastN = n; s.sent++; if (work.kind !== "new") s.resent++;
      s.flight.ok = true; s.flight.at = at;
      _log("summary n=" + n + " sent — l=" + b.from + ".." + b.to + ", " + f.kept + " song(s), the room's count " + b.count + ", " + bytes + " bytes (" + work.why + ")" +
        (f.rest.length ? "; " + f.rest.length + " more go in the next (the budget)" : ""));
      _later(s, ECHO_READ_MS);
    }, (e) => { s.sending = false; if (_s !== s) return; const t = HistoryPorts.serverNow(); s.lastAt = (t !== null && t > now) ? t : now; _failed(s, n, (e && e.message) || String(e)); });
  }
  function _failed(s, n, why) {
    s.flight = null; s.fails++;
    _warn("summary n=" + n + " not sent — " + why + "; its songs are owed, tried again in " + Math.round(_spacing(s) / 1000) + " s");
    _later(s, _spacing(s));
  }

  // ── LIFECYCLE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function enter(ctx) {
    const c = ctx || {};
    const bot = HistoryPorts.actingAsBot();
    if (!bot || typeof c.spaceId !== "string" || !c.channels || !c.channels.history_owner) {
      if (_s) _stop(!bot ? "this tab is not the room's bot here" : "this room has no song history channel");
      return;
    }
    if (_s && _s.spaceId === c.spaceId) { _s.channels = c.channels; return; }   // a rank change in the same room: keep running
    if (_s) _stop("another room");
    _start(c.spaceId, c.channels);
  }
  function leave(why) { if (_s) _stop(why || "the tab left the room"); }
  function _start(spaceId, channels) {
    const s = { gen: ++_gen, spaceId: spaceId, channels: channels, me: HistoryPorts.myId(), writer: null, release: null, tick: null, soon: null,
      sending: false, flight: null, lastAt: null, lastN: 0, fails: 0, reading: false, sent: 0, resent: 0, waiting: "", rearmAt: null };
    _s = s;
    HistoryPorts.onRaw(_onRaw);
    HistoryPorts.onHistoryChange(_onHistory);
    if (!_caughtUpHeard) { _caughtUpHeard = true; HistoryPorts.onCaughtUp(_onCaughtUp); }   // the session keeps its listeners: once a page
    s.tick = setInterval(() => { if (_s === s) _step(); }, TICK_MS);
    Promise.resolve(HistoryPorts.writerLock(spaceId, () => new Promise((release) => { s.release = release; }))).then((got) => {
      if (_s !== s) { if (s.release) s.release(); return; }
      if (got === false) { s.writer = false; _detach(s); _log("another tab of this account sends this room's history summaries — this tab sends none"); return; }
      if (got !== true) _log("this browser has no single-writer lock (no Web Locks) — this tab sends this room's history summaries");
      s.writer = true;
      _log("started for " + _short(spaceId) + " — it sends the room's song history summaries on its song history channel");
      _step();
    }).catch((e) => { _warn("could not start — " + ((e && e.message) || e)); });
  }
  function _detach(s) {
    HistoryPorts.offRaw(_onRaw);
    HistoryPorts.offHistoryChange(_onHistory);
    if (s.tick) { clearInterval(s.tick); s.tick = null; }
    if (s.soon) { clearTimeout(s.soon); s.soon = null; }
  }
  function _stop(why) {
    const s = _s;
    if (!s) return;
    _s = null;
    _detach(s);
    if (s.release) { try { s.release(); } catch (e) {} }
    _log("stopped — " + why + "; " + s.sent + " summar" + (s.sent === 1 ? "y" : "ies") + " sent this visit (" + s.resent + " re-sent with a new count)" +
      (s.flight ? "; summary n=" + s.flight.n + " not read back is owed at the next visit" : ""));
  }

  // For the guard: the running session's state, as a plain copy.
  function _stateForTest() {
    const s = _s;
    if (!s) return null;
    return { gen: s.gen, spaceId: s.spaceId, writer: s.writer, sending: s.sending, flight: s.flight ? Object.assign({}, s.flight) : null, lastAt: s.lastAt,
      lastN: s.lastN, fails: s.fails, sent: s.sent, resent: s.resent, timers: { tick: !!s.tick, soon: !!s.soon } };
  }
  function _stepForTest() { _step(); }

  return { enter, leave, TICK_MS, SOON_MS, SPACING_MS, ECHO_MS, ECHO_READ_MS, FAIL_MAX_MS, _stateForTest, _stepForTest };
})();
