// features/rep-bot.js — J84-2: REP's BOT SIDE, live (the owner's rulings 21a, 25, 28, 30c and 32; DESIGN-J84-REP.md §3.1,
// §4.2, §4.4). Runs only on the room's bot tab, and only while it holds the room's single-writer lock.
//
// Depends on: RepRules (what counts, the split, the messages, the budget) and RepPorts (everything else). Nothing else:
// `check-rep-boundary` holds that this file names no app global. Timers are the language's own; every time it judges by
// is the server's (`RepPorts.serverNow`), never the device's clock.
//
// ── WHAT IT KEEPS: THE TABLE (`Store.rep`, per room; saved one second after every change) ─────────────────────────────
//   base      everyone ever counted, each person's six numbers as of the last summary's cut
//   cut       that summary's cut — the play that started the then-current song ({ pi, pos }); null = the room's start
//   fwd       for each playing at or after the cut: its DJ and position, and who voted and saved on it — THE RECEIPTS,
//             keyed by the natural key (voter, playing, kind), the fold's own dedup (the design's C11). Plus the
//             reactions naming a playing song history has not shown yet, held (at most 500) until it does.
//   last      the last summary: its serial, when it went, its event id once heard back, who it named, who it left out
//             (the size limit), the lowest REP it kept, and the additions under it
//   since     how far back the record reaches; null = the room's start
// A table exists only with a BASE (J84-4, the design's §3.2). With no table, in this order: (1) REBUILT from the bot's own
// summaries and additions within the window, each person from their own message's cut; (2) with none, counted from the
// room's start when this tab holds the room whole (`RepPorts.holdsWholeRoom`) or the fill-back reaches the start within
// the window (a room younger than the window) — exact; (3) otherwise nothing is published (the owner's Q4: never a partial
// table as the truth) and the log says so; an import or "Start fresh" (J84-5) are the ways in from there.
//
// ── THE FILL-BACK AND THE WINDOW (ruling 20; the design's §3.2–§3.5) ────────────────────────────────────────────────────
// Once the tab is caught up the bot fills back from its cut — every countable reaction lies above it — within the WINDOW
// (a bot-only local setting, `Store.rep` prefs `windowDays`, 1–365, default 7; it gets its control with the Bot card,
// J84-5): the held log, and the stretch between the cut and the start of the held log paged from the server (`events`
// channels only; a bot room pages what it folds). The receipts make every overlap harmless. A gap longer than the window
// is filled only for its last window: the log says how many days were not, and `since` moves to the window's edge. A
// summary goes at once after a fill-back that counted anything. Nothing is sent while a fill-back runs; one that could
// not read is tried again at the next look.
//
// ── WHAT IT SENDS (both through `RepPorts.sendSide`: alone on the owner-level channel; a bot room's runner gates it) ─────
//   A SUMMARY (`RepRules.TYPES.summary`) of everyone active in THE BOT'S VIEW (ruling 30c: `RepPorts.whoIsActive`, the one
//     "who is active" function), each with their split as of the new cut, highest REP first, fitted under the budget
//     (ruling 28; the rest counted in `more`). It is due once the last is one interval old (`repSummaryMs`) and something
//     changed — sent at the next song change, so its cut is the play that starts the new song, or at once with nothing
//     playing (its cut is then the last song's play). An unchanged summary still goes, at once, once the last is 1.5
//     intervals old (the design's C12), so no device's look-back (two intervals) is ever left without one. The first
//     summary goes at the first song change, or at once with nothing playing.
//   AN ADDITION (`RepRules.TYPES.addition`) for the people who became active since the summary and are not in it, each
//     with their split as of that summary's cut — sent once the summary's own event id has been heard back, batched,
//     at least 5 s after any REP message (ruling 25). When the people added under one summary would pass 20 (ruling 25's
//     N; Q3: people), a fresh summary goes instead.
//   THE LEFT-OUT RULE (ruling 28): while the last summary is capped, someone newly active gets an addition only if their
//     REP is above the lowest REP it kept; everyone else joins the left-out set until the next summary, and a left-out
//     person active again is not new.
// A message is committed to the table only once the transport accepts it. A reaction counted while a summary is in
// flight on a playing before its cut is dropped with that playing's receipts: devices read the summary as closing it.
//
// ── COMMANDS, FILES AND THE BOT CARD (J84-5; the design's §5.1–§5.3, H4) ──────────────────────────────────────────────
// COMMANDS: `!rep @user:server`, and the top tens `!rep @topv` / `@topvr` / `@topvg` / `@tops` / `@topsr` / `@topsg`
//   (votes both ways, received, given; saves the same), answered from the bot's full table under the room's CURRENT
//   settings. Only the room's owner (`bot.command`, above the ladder — the bot itself and every delegated rank are refused),
//   only in the room's chat tiers (never a DM, ruling 17), the reply in the tier the command came from, at most 512
//   characters ("top N of M" when a list is cut to fit). The cooldown per person and the room-wide limit are the bot's own
//   settings; anything over them is ignored, not answered, with one log line. Only live commands: one older than the bot
//   side's start, or two minutes, is history and never answered. No coverage text in a reply (Q6).
// FILES: an export (`ddjp-rep-table`, the full table, base plus forward); the REPLACE flow — a backup of the current table
//   downloads first, every time; a file is picked and previewed (its people, its date, its room — another room named and
//   flagged — and that votes since are not added); confirmed, the table is REPLACED, never merged, cut at the current song's
//   play, and a fresh summary goes at once; cancelled or abandoned at any step, nothing changes. With no base (Q4) two more:
//   START FRESH (the same flow with an empty table, the backup still first) and LOOK FURTHER BACK (the no-table search once
//   more with a longer window, 1–365 days).
// THE BOT'S OWN SETTINGS (`PREFS`, §5.1: bot-only local, `Store.rep` prefs, per room — never room settings): the window,
//   commands on or off, the cooldown, the room limit. All on the Bot card (H4: `card()`, through `Rep.botCard`), which the
//   panel renders from plain rows and three primitives it lends — download a JSON, pick a JSON, confirm — and nothing else.
//
// ── LIFECYCLE (H1 and H2, through `Rep`) ───────────────────────────────────────────────────────────────────────────────
// `enter` on every room entry and rank change: starts on the bot's tab, stops elsewhere, keeps running across a rank
// change in the same room. `leave` at the one leave step: the table is saved (started, not awaited), nothing is sent,
// what was due and unsent is dropped and counted, the lock is released. Nothing of REP runs in the lobby (ruling 18).
const RepBot = (() => {
  const TABLE_V = 1;
  const TICK_MS = 15000;          // the design's "every 15 s": who became active, a song change, a summary falling due
  const SOON_MS = 1000;           // after a reaction or any message: look again within a second, at most once a second
  const SAVE_MS = 1000;           // the table is saved one second after a change
  const EARLY_CAP = 20000;        // reactions heard before the table loaded, kept for it (the held log answers the rest)
  const DAY = 86400000;
  // THE BOT'S OWN SETTINGS (§5.1, Q8's ranges): bot-only local, per room — they bound what this one device does, nothing more.
  const PREFS = Object.freeze({
    windowDays: Object.freeze({ dflt: 7, min: 1, max: 365, label: "Fill-back window", unit: "days" }),
    commands: Object.freeze({ dflt: true, label: "Answer the owner's !rep commands" }),
    cooldownS: Object.freeze({ dflt: 60, min: 0, max: 3600, label: "Command cooldown per person", unit: "seconds" }),
    roomLimit: Object.freeze({ dflt: 6, min: 1, max: 60, label: "Replies a minute, room-wide", unit: "a minute" }),
  });
  const WINDOW = Object.freeze({ days: 7, min: 1, max: 365 });   // the window (ruling 20): a bot-only local setting, in days
  const REPLY_MAX = 512;          // a reply's characters at most (`Chat.sendTo`'s cap)
  const LIVE_MS = 120000;         // a command older than this — or than the bot side's start — is history: never answered
  const TOPS = Object.freeze({    // the top lists (§5.2): what each sorts by, in the reply's words
    "@topv": Object.freeze({ by: "REP", words: "votes" }), "@topvr": Object.freeze({ by: "VR", words: "votes received" }),
    "@topvg": Object.freeze({ by: "VG", words: "votes given" }), "@tops": Object.freeze({ by: "S", words: "saves" }),
    "@topsr": Object.freeze({ by: "SR", words: "saves received" }), "@topsg": Object.freeze({ by: "SG", words: "saves given" }),
  });
  const TOP = Number.MAX_SAFE_INTEGER;

  let _s = null, _gen = 0;
  let _chatHeard = false;
  // Caught up again (J97): song history has just taken what it owed — held reactions are placed, and a summary due goes, at once.
  let _caughtUpHeard = false;
  function _onCaughtUp() { if (_s) _soon(_s); }

  const _log = (msg) => RepPorts.log("info", msg);
  const _warn = (msg) => RepPorts.log("warn", msg);
  function _now() { const t = RepPorts.serverNow(); return (typeof t === "number" && isFinite(t) && t > 0) ? t : null; }
  function _interval() {
    const s = RepPorts.settings() || {};
    return (typeof s.repSummaryMs === "number" && isFinite(s.repSummaryMs) && s.repSummaryMs > 0) ? s.repSummaryMs : null;
  }
  // The window this bot uses here: its stored prefs' `windowDays` when it reads, else the default (a week).
  function _windowMs(prefs) {
    const d = prefs && prefs.windowDays;
    return (typeof d === "number" && isFinite(d) && d >= WINDOW.min && d <= WINDOW.max) ? Math.round(d * DAY) : WINDOW.days * DAY;
  }
  // The bot's own settings as stored, each checked against its range; anything else its default.
  function _prefOk(key, v) {
    const d = PREFS[key];
    if (!d) return false;
    if (typeof d.dflt === "boolean") return typeof v === "boolean";
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= d.min && v <= d.max;
  }
  function _prefsOf(pf) { const out = {}; for (const k of Object.keys(PREFS)) out[k] = (pf && _prefOk(k, pf[k])) ? pf[k] : PREFS[k].dflt; return out; }
  function _short(id) { return (typeof id === "string" && id.length > 14) ? id.slice(0, 12) + "…" : String(id); }
  function _dur(ms) { if (!(ms >= 0)) return "?"; if (ms < 120000) return Math.round(ms / 1000) + " s"; if (ms < 7200000) return Math.round(ms / 60000) + " min"; return Math.round(ms / 3600000) + " h"; }

  // ── THE TABLE ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function _newTable(spaceId) {
    return { v: TABLE_V, room: spaceId, since: null, base: Object.create(null), cut: null,
      fwd: { byPi: Object.create(null), held: [] }, last: null, lastMsgAt: null, counted: 0, heard: null };
  }
  function _split(a) {
    const out = RepRules.zero();
    if (!Array.isArray(a)) return null;
    for (let i = 0; i < 6; i++) { const v = a[i] === undefined ? 0 : a[i]; if (typeof v !== "number" || !isFinite(v) || v < 0 || Math.floor(v) !== v) return null; out[i] = v; }
    return out;
  }
  const _users = (a) => (Array.isArray(a) ? a.filter((u) => typeof u === "string" && u.charAt(0) === "@") : []);
  // A stored table, checked and rebuilt into this module's own shapes; anything that does not read is no table at all.
  function _revive(t, spaceId) {
    try {
      if (!t || typeof t !== "object" || t.v !== TABLE_V || t.room !== spaceId || !t.base || typeof t.base !== "object" ||
          !t.fwd || typeof t.fwd !== "object" || !t.fwd.byPi || typeof t.fwd.byPi !== "object") return null;
      const out = _newTable(spaceId);
      // WHOLE NUMBERS ONLY GO OUT (J87). A table stored by `?v=533`–`535` may hold a `since` stamped from the half-millisecond
      // clock; it is floored here, so no summary carries it. A last summary whose serial was not whole was never read by any
      // device (every reader refused it), so it is not kept: the next message is a summary they can take, never an
      // addition under one they never saw.
      out.since = (typeof t.since === "number" && isFinite(t.since)) ? Math.floor(t.since) : null;
      for (const u of Object.keys(t.base)) { const sp = _split(t.base[u]); if (sp && u.charAt(0) === "@") out.base[u] = sp; }
      if (t.cut && typeof t.cut.pi === "string" && typeof t.cut.pos === "number") out.cut = { pi: t.cut.pi, pos: t.cut.pos };
      for (const pi of Object.keys(t.fwd.byPi)) {
        const p = t.fwd.byPi[pi];
        if (!p || typeof p.l !== "number") continue;
        const e = { dj: typeof p.dj === "string" ? p.dj : null, l: p.l, v: Object.create(null), s: Object.create(null) };
        for (const k of ["v", "s"]) for (const u of Object.keys((p[k] && typeof p[k] === "object") ? p[k] : {})) if (u.charAt(0) === "@") e[k][u] = 1;
        out.fwd.byPi[pi] = e;
      }
      out.fwd.held = Array.isArray(t.fwd.held) ? t.fwd.held.filter((h) => h && typeof h.p === "string").slice(-RepRules.LIMITS.heldUnknown) : [];
      if (t.last && typeof t.last.n === "number" && Math.floor(t.last.n) === t.last.n && typeof t.last.at === "number") {
        const a = t.last.adds || {};
        out.last = { n: t.last.n, at: t.last.at, id: typeof t.last.id === "string" ? t.last.id : null, named: _users(t.last.named),
          leftOut: _users(t.last.leftOut), more: (typeof t.last.more === "number") ? t.last.more : 0,
          lowestKept: (typeof t.last.lowestKept === "number") ? t.last.lowestKept : null,
          activeSig: (typeof t.last.activeSig === "string") ? t.last.activeSig : "",
          adds: { k: (typeof a.k === "number") ? a.k : 0, people: _users(a.people) } };
      }
      out.lastMsgAt = (typeof t.lastMsgAt === "number") ? t.lastMsgAt : null;
      out.counted = (typeof t.counted === "number") ? t.counted : 0;
      out.heard = (t.heard && typeof t.heard.l === "number") ? { l: t.heard.l, ts: t.heard.ts || 0 } : null;
      if (!out.last && t.last && typeof t.last.n === "number" && Math.floor(t.last.n) !== t.last.n) out.unreadLast = t.last.n;
      return out;
    } catch (e) { return null; }
  }
  // The table as it is stored: plain objects all the way down.
  function _plain(t) { return JSON.parse(JSON.stringify(t)); }
  function _dirty(s) {
    if (!s || s.saveTimer || _s !== s) return;
    s.saveTimer = setTimeout(() => { s.saveTimer = null; if (_s === s && s.table) RepPorts.storeSave(s.spaceId, _plain(s.table)); }, SAVE_MS);
  }

  // ── THE PLAYINGS: song history's rows, by play instance ─────────────────────────────────────────────────────────────
  function _refreshPlays(s) {
    const map = Object.create(null);
    for (const r of (RepPorts.playings() || [])) if (r && typeof r.pi === "string" && typeof r.l === "number") map[r.pi] = r;
    s.plays = map;
    s.playsAt = _now();
  }
  function _playing(s, pi) {
    if (typeof pi !== "string") return null;
    let p = s.plays[pi];
    if (!p) { const n = _now(); if (s.playsAt === null || n === null || n - s.playsAt >= 1000) { _refreshPlays(s); p = s.plays[pi]; } }
    return p || null;
  }

  // ── COUNTING, WITH RECEIPTS ────────────────────────────────────────────────────────────────────────────────────────
  // One reaction as the fold reads it: a folded entry ({ eventId, type, sender, content.p, l, ts }); in a bot room the
  // relayed act, member by member, with the actor as sender. Counted when `RepRules` says so — a playing in song history,
  // at or after the cut, a reaction the room accepted, the first of its (voter, playing, kind).
  function _count(s, e, st) {
    const t = s.table;
    if (!e || !RepRules.kindOf(e.type)) return false;
    const r = { type: e.type, voter: e.sender, pi: e.content && e.content.p };
    const playing = _playing(s, r.pi);
    if (!playing) { _hold(s, e); return false; }
    const res = RepRules.add(t.fwd, r, playing, t.cut, RepPorts.isLegal(e.eventId) !== false);
    if (st) { if (res.added) st[RepRules.kindOf(e.type) === "v" ? "votes" : "saves"]++; else if (res.why === "already counted") st.dup++; }
    if (!res.added) return false;
    t.counted++;
    if (typeof e.l === "number" && (!t.heard || e.l > t.heard.l)) t.heard = { l: e.l, ts: (typeof e.ts === "number") ? e.ts : 0 };
    return true;
  }
  function _hold(s, e) {
    const h = s.table.fwd.held;
    if (typeof (e.content && e.content.p) !== "string") return;
    if (h.some((x) => x.id === e.eventId)) return;
    h.push({ id: e.eventId, type: e.type, sender: e.sender, p: e.content.p, l: e.l, ts: e.ts });
    if (h.length > RepRules.LIMITS.heldUnknown) h.splice(0, h.length - RepRules.LIMITS.heldUnknown);
  }
  // Given up only while this tab is caught up (J97): song history writes nothing while it is not, so a missing song proves nothing.
  function _retryHeld(s, now, I) {
    const t = s.table, keep = [], settled = RepPorts.mayAuthor();
    let n = 0;
    for (const h of t.fwd.held) {
      const e = { eventId: h.id, type: h.type, sender: h.sender, content: { p: h.p }, l: h.l, ts: h.ts };
      if (_playing(s, h.p)) { if (_count(s, e)) n++; continue; }
      if (settled && I !== null && typeof h.ts === "number" && h.ts < now - RepRules.LIMITS.lookbackFactor * I) continue;   // too old to wait for
      keep.push(h);
    }
    t.fwd.held = keep;
    return n;
  }

  // ── LISTENERS ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function _onReaction(e) {
    const s = _s;
    if (!s || s.writer === false) return;
    if (!s.table) { if (!s.noBase && s.early.length < EARLY_CAP) s.early.push(e); return; }
    if (_count(s, e)) { _dirty(s); _soon(s); }
  }
  // Any message: a reason to look again (someone may have become active), and the echo of our own summary, which is how
  // its event id — the additions' `of` — is learned, in both room types.
  function _onRaw(raw) {
    const s = _s;
    if (!s || s.writer !== true) return;
    try {
      const t = s.table;
      if (t && t.last && !t.last.id && raw && raw.room_id === (s.channels && s.channels.events_owner) && raw.sender === s.me &&
          raw.ddjpType === RepRules.TYPES.summary && raw.ddjpBody && raw.ddjpBody.n === t.last.n && typeof raw.event_id === "string") {
        t.last.id = raw.event_id;
        _dirty(s);
      }
    } catch (e) {}
    _soon(s);
  }
  function _soon(s) {
    if (!s || s.soonTimer || _s !== s) return;
    s.soonTimer = setTimeout(() => { s.soonTimer = null; _step(); }, SOON_MS);
  }

  // ── THE STEP: ready, base, held, then the one message that is due ───────────────────────────────────────────────────
  function _step() {
    const s = _s;
    if (!s || s.writer !== true || !s.loaded || s.sending) return;
    const now = _now();
    if (now === null) return;
    if (!s.ready) {
      if (!RepPorts.mayAuthor()) return;   // still catching up: a count now would be a partial one
      s.ready = true;
      _onReady(s);
    }
    if (s.fill === "retry") _onReady(s);   // a fill-back that could not read: once more, at this look
    if (s.fill) return;                     // nothing is sent while the table is being filled or rebuilt
    const t = s.table;
    if (!t) return;
    const I = _interval();
    if (_retryHeld(s, now, I)) _dirty(s);
    if (I === null) return;
    const view = RepPorts.whoIsActive(now);
    if (!view || !Array.isArray(view.people)) return;   // no view, no claim about who is active
    const active = [];
    // THE BOT IS A NORMAL USER IN REP (J87, the owner's ruling): active in its own view, it is published like anyone — its
    // votes and saves count, given and received, and every device shows its number.
    for (const p of view.people) if (p && typeof p.userId === "string" && active.indexOf(p.userId) < 0) active.push(p.userId);
    active.sort();
    const why = _summaryDue(s, now, I, active);
    const fresh = why ? [] : _newcomers(s, active);
    s.unsent = (why ? 1 : 0) + (fresh.length ? 1 : 0);
    if (!why && !fresh.length) return;
    const gap = (t.lastMsgAt === null) ? Infinity : now - t.lastMsgAt;
    if (gap < RepRules.LIMITS.spacingMs) {   // ruling 25: at least 5 s between any two REP messages; whoever comes in between waits with them
      if (!s.soonTimer) s.soonTimer = setTimeout(() => { s.soonTimer = null; _step(); }, Math.max(SOON_MS, RepRules.LIMITS.spacingMs - gap));
      return;
    }
    if (why) _sendSummary(s, now, active, why);
    else _sendAddition(s, now, fresh);
  }
  // ── READY: FILL BACK, OR FIND A BASE (J84-4) ───────────────────────────────────────────────────────────────────────
  function _onReady(s) {
    const now = _now();
    if (now === null) { s.fill = "retry"; return; }
    s.fill = "running";
    if (s.table) _fillBack(s, now);
    else _noTable(s, now);
  }
  function _retry(s, what) {
    if (_s !== s) return;
    s.fill = "retry";
    if (!s.retrySaid) { s.retrySaid = true; _log(what + " — tried again at the next look"); }
  }
  function _done(s) { if (_s !== s) return; s.fill = null; s.retrySaid = false; _dirty(s); _step(); }   // and look at once: a summary may be due
  // What this tab holds and the stretch below it, from `fromL`, never older than `notBefore`. Resolves
  // { ok, events, paged, reachedFrom, byTime, capped } — `ok: false` when the server could not be read.
  function _gather(s, fromL, notBefore, wholeKnown) {
    const held = (RepPorts.heldLog() || []).filter((e) => !(e && typeof e.ts === "number" && e.ts < notBefore));
    const hf = RepPorts.heldFrom();
    // Where the held log begins: from its start (nothing to page), from a position, or — the engine cannot say — anywhere.
    const toL = (hf === null && wholeKnown !== false) ? null : (typeof hf === "number" ? hf - 1 : TOP);
    if (toL === null || toL < fromL) return Promise.resolve({ ok: true, events: held, paged: 0, reachedFrom: fromL, byTime: false, capped: false });
    return Promise.resolve(RepPorts.pageReactions(fromL, toL, notBefore)).then((page) => {
      if (!Array.isArray(page) || typeof page.reachedFrom !== "number") return { ok: false };
      const byTime = page.stoppedByTime === true;
      return { ok: true, events: page.concat(held), paged: page.length, reachedFrom: page.reachedFrom, byTime: byTime,
        capped: !byTime && page.reachedFrom > fromL };
    }, () => ({ ok: false }));
  }
  function _stats() { return { votes: 0, saves: 0, dup: 0 }; }
  function _said(st) { return st.votes + " vote(s) and " + st.saves + " save(s) counted, " + st.dup + " already counted"; }
  // A gap longer than the window (§3.2): only its last window was filled. Said, and `since` moves to the window's edge.
  function _beyond(s, now, W) {
    const t = s.table, edge = now - W;
    const from = (t.heard && typeof t.heard.ts === "number" && t.heard.ts > 0) ? t.heard.ts : (t.last ? t.last.at : null);
    if (typeof from !== "number" || from >= edge) return;
    const days = Math.ceil((edge - from) / DAY);
    if (t.since === null || t.since < edge) t.since = edge;
    _log(days + " day(s) beyond the window were not filled");
  }

  // THE FILL-BACK, WITH A TABLE: from its cut to now, within the window — what the receipts already hold changes nothing.
  function _fillBack(s, now) {
    const t = s.table, W = s.windowMs, fromL = t.cut ? t.cut.pos : 0;
    _gather(s, fromL, now - W).then((g) => {
      if (_s !== s) return;
      if (!g.ok) { _retry(s, "the fill-back could not read the room back"); return; }
      _beyond(s, now, W);   // judged by what it had heard before this fill-back, not by what the fill-back counts
      const st = _stats();
      for (const e of g.events.concat(s.early)) _count(s, e, st);
      s.early = [];
      if (g.capped) _log("the fill-back stopped at l=" + g.reachedFrom + " (the page limit) — l=" + fromL + " to l=" + (g.reachedFrom - 1) + " not filled");
      _log("filling back from l=" + fromL + " (the last " + Math.round(W / DAY) + " day(s)) — " + g.paged + " event(s) paged, " + _said(st));
      if (st.votes + st.saves) s.afterFill = st.votes + st.saves;
      _done(s);
    });
  }

  // NO TABLE: rebuild from its own messages, else count the room from its start, else publish nothing (Q4).
  function _noTable(s, now, once) {
    const W = (typeof once === "number") ? once : s.windowMs;   // "look further back": a longer window, this once
    Promise.resolve(RepPorts.readOwnerChannelBack(s.channels, now - W)).then((list) => {
      if (_s !== s) return;
      if (list && list.ok === false) { _retry(s, "could not read its own messages back"); return; }
      const plan = _rebuildPlan(s, Array.isArray(list) ? list : []);
      if (plan) { _rebuild(s, plan, now); return; }
      if (RepPorts.holdsWholeRoom() === true) {
        s.table = _newTable(s.spaceId);
        const st = _stats();
        for (const e of RepPorts.heldLog().concat(s.early)) _count(s, e, st);
        s.early = [];
        _log("no table — counting this room from its start, which this tab holds (" + (st.votes + st.saves) + " vote(s) and save(s) counted)");
        _done(s);
        return;
      }
      _gather(s, 0, now - W, false).then((g) => {
        if (_s !== s) return;
        if (!g.ok) { _retry(s, "the fill-back could not read the room back"); return; }
        if (g.reachedFrom <= 0 && !g.byTime && !g.capped) {   // the whole room, within the window: a room younger than it
          s.table = _newTable(s.spaceId);
          const st = _stats();
          for (const e of g.events.concat(s.early)) _count(s, e, st);
          s.early = [];
          _log("no table and no summary — the room is younger than the window: counted from its start (" + g.paged +
            " event(s) paged, " + _said(st) + ")");
          _done(s);
          return;
        }
        s.noBase = true; s.early = []; s.fill = null;
        _log("no table and no summary within the window (" + Math.round(W / DAY) + " days) — import a reputation file, or start fresh");
      });
    });
  }

  // THE REBUILD PLAN (§3.2): the bot's OWN summaries and additions within the window. Each person's numbers are those of
  // the newest message naming them, as of that message's summary's cut. Null when there is no summary of its own.
  function _rebuildPlan(s, list) {
    const sums = [], adds = [];
    for (const m of list) {
      if (!m || m.sender !== s.me || typeof m.id !== "string") continue;
      const body = RepRules.unstamp(m.body);
      if (m.type === RepRules.TYPES.summary) { const v = RepRules.readSummary(body); if (v.ok) sums.push(Object.assign({}, v.value, { id: m.id, l: m.l, ts: m.ts })); }
      else if (m.type === RepRules.TYPES.addition) { const v = RepRules.readAddition(body); if (v.ok) adds.push(Object.assign({}, v.value, { id: m.id, l: m.l, ts: m.ts })); }
    }
    if (!sums.length) return null;
    sums.sort((a, b) => (RepRules.newer(a, b) === a ? 1 : -1));   // oldest first
    const who = Object.create(null);
    let used = 0;
    for (const S of sums) {
      for (const r of S.rows) who[r.user] = { split: r.split.slice(), cut: S.cut };
      const mine = adds.filter((a) => a.of === S.id && a.n === S.n).sort((x, y) => x.k - y.k);
      used += mine.length;
      for (const a of mine) for (const r of a.rows) who[r.user] = { split: r.split.slice(), cut: S.cut };
    }
    const last = sums[sums.length - 1];
    const lastAdds = adds.filter((a) => a.of === last.id && a.n === last.n);
    return { sums: sums, last: last, lastAdds: lastAdds, who: who, used: used };
  }
  // THE REBUILD: the newest summary's cut becomes the table's; each person's base is their row, plus what they earned on
  // playings from THEIR OWN cut up to it (`RepRules.contributionsFrom`) — counted only as the bot counted it then, a
  // reaction on a playing being kept only when it came before the summary that closed that playing; everything from the
  // newest cut on is counted forward as usual.
  function _rebuild(s, plan, now) {
    const W = s.windowMs, C = plan.last.cut;
    let low = C;
    for (const u of Object.keys(plan.who)) { const c = plan.who[u].cut; if (RepRules.compareAt(c.pos, c.pi, low.pos, low.pi) < 0) low = c; }
    const t = _newTable(s.spaceId);
    t.cut = { pi: C.pi, pos: C.pos };
    t.since = (typeof plan.last.since === "number") ? plan.last.since : null;
    for (const u of Object.keys(plan.who)) t.base[u] = plan.who[u].split.slice();
    s.table = t;
    const pre = RepRules.newAccumulator();
    _gather(s, low.pos, now - W).then((g) => {
      if (_s !== s) return;
      if (!g.ok) { s.table = null; _retry(s, "the rebuild could not read the room back"); return; }
      const st = _stats();
      let early = 0;
      for (const e of g.events.concat(s.early)) {
        if (!e || !RepRules.kindOf(e.type)) continue;
        const pi = e.content && e.content.p, playing = _playing(s, pi);
        if (playing && RepRules.compareAt(playing.l, playing.pi, C.pos, C.pi) < 0) {
          // Before the newest cut: the summary that closed this playing (the first cut after it) decides whether the bot
          // had counted it — a reaction that came after that summary was a late one, never counted.
          const closer = plan.sums.find((S) => RepRules.compareAt(playing.l, playing.pi, S.cut.pos, S.cut.pi) < 0);
          if (closer && typeof e.l === "number" && typeof closer.l === "number" && e.l >= closer.l) continue;
          const res = RepRules.add(pre, { type: e.type, voter: e.sender, pi: pi }, playing, low, RepPorts.isLegal(e.eventId) !== false);
          if (res.added) { early++; st[RepRules.kindOf(e.type) === "v" ? "votes" : "saves"]++; } else if (res.why === "already counted") st.dup++;
          continue;
        }
        _count(s, e, st);
      }
      s.early = [];
      const add = RepRules.contributionsFrom(pre, (u) => (plan.who[u] ? plan.who[u].cut : null));
      for (const u of Object.keys(add)) t.base[u] = RepRules.plus(t.base[u], add[u]);
      const L = plan.last, set = RepPorts.settings() || {};
      const lastPeople = [];
      for (const a of plan.lastAdds) for (const r of a.rows) if (lastPeople.indexOf(r.user) < 0) lastPeople.push(r.user);
      t.last = { n: L.n, at: (typeof L.ts === "number") ? L.ts : now, id: L.id, named: L.rows.map((r) => r.user), leftOut: [], more: L.more,
        lowestKept: L.more > 0 && L.rows.length ? Math.min.apply(null, L.rows.map((r) => RepRules.shown(r.split, set).REP)) : null,
        activeSig: "", adds: { k: plan.lastAdds.reduce((m, a) => Math.max(m, a.k), 0), people: lastPeople } };
      t.lastMsgAt = Math.max(t.last.at, plan.lastAdds.reduce((m, a) => Math.max(m, typeof a.ts === "number" ? a.ts : 0), 0));
      _log("rebuilt the table from its own messages within the window — " + Object.keys(plan.who).length + " people from " +
        plan.sums.length + " summary(ies) and " + plan.used + " addition(s); cut l=" + C.pos + "; filling back from l=" + low.pos +
        " — " + g.paged + " event(s) paged, " + _said(st) + " (" + early + " before the cut, each for its own people)");
      if (st.votes + st.saves) s.afterFill = st.votes + st.saves;
      _done(s);
    });
  }
  const _sig = (active) => active.join("\u0000");
  function _summaryDue(s, now, I, active) {
    const t = s.table, last = t.last;
    if (s.freshNow) return s.freshNow;   // after a Replace or Start fresh: at once (§5.3)
    if (!last) return _atSongChange(s, "the first summary");
    const age = now - last.at;
    if (age >= RepRules.LIMITS.refreshFactor * I) return "a refresh (the last is " + _dur(age) + " old)";   // C12: at once
    if (s.afterFill) return "after the fill-back (" + s.afterFill + " counted)";   // §4.2: at once
    if (s.wantFresh) return "a fresh summary (more than " + RepRules.LIMITS.freshAfterPeople + " people added)";
    if (age >= I && (t.counted > 0 || _sig(active) !== last.activeSig)) return _atSongChange(s, "the interval");
    return null;
  }
  // Due at the next song change: the playing current when it fell due is remembered, and it goes once another starts —
  // or at once when nothing is playing.
  function _atSongChange(s, why) {
    const np = RepPorts.nowPlaying();
    if (!np) return why + ", nothing playing";
    if (s.awaitFrom === undefined) { s.awaitFrom = np.pi; return null; }
    return (np.pi !== s.awaitFrom) ? why + ", at the song change" : null;
  }
  function _newcomers(s, active) {
    const t = s.table, last = t.last;
    if (!last) return [];
    const known = new Set(last.named.concat(last.adds.people, last.leftOut));
    let fresh = active.filter((u) => !known.has(u));
    if (!fresh.length) return [];
    if (last.more > 0 && typeof last.lowestKept === "number") {   // THE LEFT-OUT RULE (ruling 28)
      const set = RepPorts.settings() || {}, keep = [], out = [];
      for (const u of fresh) (RepRules.shown(t.base[u] || RepRules.zero(), set).REP > last.lowestKept ? keep : out).push(u);
      if (out.length) { last.leftOut = last.leftOut.concat(out); _dirty(s); }
      fresh = keep;
    }
    if (fresh.length && last.adds.people.length + fresh.length > RepRules.LIMITS.freshAfterPeople) {   // ruling 25's N, people (Q3)
      s.wantFresh = true;
      _soon(s);
      return [];
    }
    if (fresh.length && !last.id) return [];   // its summary's id not heard back yet: they wait together
    return fresh;
  }
  // The cut a summary takes now: the play that started the current song, or, with nothing playing, the last song's play.
  function _cutNow(s) {
    const np = RepPorts.nowPlaying();
    let p = null;
    if (np) p = _playing(s, np.pi);
    else { const rows = RepPorts.playings(1) || []; p = (rows[0] && typeof rows[0].l === "number") ? rows[0] : null; }
    if (!p) return null;
    const cut = { pi: p.pi, pos: p.l };
    const old = s.table.cut;
    if (old && RepRules.compareAt(cut.pos, cut.pi, old.pos, old.pi) < 0) return { pi: old.pi, pos: old.pos };   // never backwards
    return cut;
  }
  // The playings before the cut fold into the base, their receipts dropped; those at or after it stay forward.
  function _foldTo(t, cut) {
    const before = { byPi: Object.create(null), held: [] }, after = Object.create(null);
    for (const pi of Object.keys(t.fwd.byPi)) {
      const p = t.fwd.byPi[pi];
      if (RepRules.compareAt(p.l, pi, cut.pos, cut.pi) < 0) before.byPi[pi] = p; else after[pi] = p;
    }
    const base = Object.create(null);
    for (const u of Object.keys(t.base)) base[u] = t.base[u].slice();
    const add = RepRules.contributions(before);
    for (const u of Object.keys(add)) base[u] = RepRules.plus(base[u], add[u]);
    return { base: base, closed: Object.keys(before.byPi), after: after };
  }
  function _sendSummary(s, now, active, why) {
    const t = s.table;
    const cut = _cutNow(s);
    if (!cut) return;   // the playing is not in song history yet: the next look
    const f = _foldTo(t, cut);
    const n = Math.max(now, t.last ? t.last.n + 1 : 0);
    const rows = active.map((u) => ({ user: u, split: f.base[u] || RepRules.zero() }));
    const fit = RepRules.fitSummary({ n: n, cut: cut, since: t.since, rows: rows }, RepPorts.settings() || {});
    const kept = fit.body.rows.map((r) => r[0]);
    const bytes = RepRules.sentBytes(RepRules.TYPES.summary, fit.body);
    s.sending = true;
    Promise.resolve(RepPorts.sendSide(s.channels, RepRules.TYPES.summary, fit.body)).then((res) => {
      s.sending = false;
      if (_s !== s) return;   // stopped meanwhile: nothing is committed; the next session's summary covers it
      if (!res || res.ok !== true) { _warn("summary n=" + n + " not sent — " + ((res && res.reason) || "refused") + "; tried again at the next look"); return; }
      // COMMITTED: the base as published; forward, the playings at or after the cut as they are NOW (a reaction counted
      // meanwhile on a closed playing goes with it — devices read this summary as closing it).
      t.base = f.base;
      for (const pi of f.closed) delete t.fwd.byPi[pi];
      t.cut = cut;
      t.last = { n: n, at: now, id: null, named: kept, leftOut: active.filter((u) => kept.indexOf(u) < 0), more: fit.more,
        lowestKept: (typeof fit.lowestKept === "number") ? fit.lowestKept : null, activeSig: _sig(active), adds: { k: 0, people: [] } };
      t.lastMsgAt = now; t.counted = 0;
      s.awaitFrom = undefined; s.wantFresh = false; s.afterFill = 0; s.freshNow = null; s.unsent = 0;
      _log("summary n=" + n + " cut l=" + cut.pos + " — " + kept.length + " people" + (fit.more ? " (" + fit.more + " left out: size limit)" : "") +
        ", " + bytes + " bytes (" + why + ")");
      _dirty(s); _soon(s);
    }, (e) => { s.sending = false; _warn("summary n=" + n + " not sent — " + ((e && e.message) || e)); });
  }
  function _sendAddition(s, now, fresh) {
    const t = s.table, last = t.last;
    const k = last.adds.k + 1;
    const body = RepRules.addition({ of: last.id, n: last.n, k: k, rows: fresh.map((u) => ({ user: u, split: t.base[u] || RepRules.zero() })) });
    s.sending = true;
    Promise.resolve(RepPorts.sendSide(s.channels, RepRules.TYPES.addition, body)).then((res) => {
      s.sending = false;
      if (_s !== s) return;
      if (!res || res.ok !== true) { _warn("addition to n=" + last.n + " not sent — " + ((res && res.reason) || "refused")); return; }
      if (t.last !== last) return;   // a newer summary went meanwhile, and names them itself
      last.adds.k = k;
      last.adds.people = last.adds.people.concat(fresh);
      t.lastMsgAt = now; s.unsent = 0;
      _log("addition to n=" + last.n + " — " + fresh.length + " people (" + last.adds.people.length + " since the summary)");
      _dirty(s); _soon(s);
    }, (e) => { s.sending = false; _warn("addition to n=" + last.n + " not sent — " + ((e && e.message) || e)); });
  }

  // ── THE TOTALS: everyone's six numbers now — base plus what was counted since the cut ─────────────────────────────────
  function _totals(t) {
    const out = Object.create(null), fwd = RepRules.contributions(t.fwd);
    for (const u of Object.keys(t.base)) out[u] = RepRules.plus(t.base[u], fwd[u]);
    for (const u of Object.keys(fwd)) if (!out[u]) out[u] = RepRules.plus(null, fwd[u]);
    return out;
  }

  // ── COMMANDS (§5.2) ─────────────────────────────────────────────────────────────────────────────────────────────────
  // `Chat.onMessage`'s listener: (id, sender, body, failed, ts, roomId). Only a live `!rep …` in one of the room's chat tiers.
  function _onChat(eventId, sender, body, failed, ts, roomId) {
    const s = _s;
    if (!s || s.writer !== true || failed || typeof body !== "string") return;
    const m = /^\s*!rep(?:\s+(\S+))?\s*$/i.exec(body);
    if (!m) return;
    const now = _now();
    if (now === null || typeof ts !== "number" || s.startedAt === null || ts < s.startedAt || ts < now - LIVE_MS) return;   // history
    if (typeof eventId === "string") { if (s.cmdSeen[eventId]) return; s.cmdSeen[eventId] = 1; }
    const what = "!rep" + (m[1] ? " " + m[1] : "");
    const ignored = (why) => _log("command " + what + " from " + sender + " ignored — " + why);
    if (s.prefs.commands !== true) { ignored("commands are off on this device"); return; }
    const tiers = RepPorts.chatTiers();
    const tier = (tiers && Array.isArray(tiers.tiers) ? tiers.tiers : []).find((x) => x && x.id === roomId);
    if (!tier) { ignored("a DM"); return; }   // never a DM, nor any channel that is not one of the room's chat tiers (ruling 17)
    if (!RepPorts.mayCommand(RepPorts.levelOf(s.spaceId, s.channels, sender))) { ignored("not the owner"); return; }
    const cool = s.prefs.cooldownS * 1000, prev = s.cmdLast[sender];
    if (cool > 0 && typeof prev === "number" && now - prev < cool) { ignored("cooldown"); return; }
    s.replies = s.replies.filter((x) => x > now - 60000);
    if (s.replies.length >= s.prefs.roomLimit) { ignored("room limit"); return; }
    const text = _answer(s, m[1] || "");
    if (!text) { ignored("not a command it knows (!rep @user:server, or @topv @topvr @topvg @tops @topsr @topsg)"); return; }
    s.cmdLast[sender] = now; s.replies.push(now);
    Promise.resolve(RepPorts.sendChat(roomId, text)).then((res) => {
      if (res && res.ok === true) _log("command " + what + " from " + sender + " → replied in " + tier.tier);
      else _warn("command " + what + " from " + sender + " — the reply was not sent (" + ((res && res.reason) || "refused") + ")");
    }, (e) => { _warn("command " + what + " — the reply was not sent (" + ((e && e.message) || e) + ")"); });
  }
  // The reply, from the bot's full table under the room's CURRENT settings — or null for a command it does not know.
  function _answer(s, arg) {
    const top = TOPS[arg.toLowerCase()];
    const user = /^@[^\s:]+:\S+$/.test(arg) ? arg : null;
    if (!top && !user) return null;
    if (!s.table) return "No reputation table yet.";
    const set = RepPorts.settings() || {}, all = _totals(s.table);
    if (user) {
      if (!all[user]) return user + " is not in the reputation table.";
      const x = RepRules.shown(all[user], set);
      return user + " VG=" + x.VG + " VR=" + x.VR + " SG=" + x.SG + " SR=" + x.SR;
    }
    const val = (x) => (top.by === "S" ? x.SG + x.SR : x[top.by]);
    const ranked = Object.keys(all).map((u) => ({ u: u, v: val(RepRules.shown(all[u], set)) })).filter((r) => r.v > 0)
      .sort((a, b) => (b.v - a.v) || (a.u < b.u ? -1 : (a.u > b.u ? 1 : 0))).slice(0, 10);
    if (!ranked.length) return "Top by " + top.words + ": nobody yet.";
    const line = (k) => "Top " + (k < ranked.length ? k + " of " + ranked.length : ranked.length) + " by " + top.words + ": " +
      ranked.slice(0, k).map((r, i) => (i + 1) + ". " + r.u + " " + r.v).join(" · ");
    let k = ranked.length;
    while (k > 1 && line(k).length > REPLY_MAX) k--;
    return line(k).slice(0, REPLY_MAX);
  }

  // ── FILES (§5.3) ────────────────────────────────────────────────────────────────────────────────────────────────────
  const FORMAT = "ddjp-rep-table";
  function _day(ms) { try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return "?"; } }
  function _exportOf(s, now) {
    const rows = Object.create(null), t = s.table;
    if (t) { const all = _totals(t); for (const u of Object.keys(all).sort()) rows[u] = all[u]; }
    return { format: FORMAT, v: 1, room: s.spaceId, roomName: RepPorts.roomName() || null, exportedAt: now,
      since: t ? t.since : null, people: Object.keys(rows).length, rows: rows };
  }
  function _fileName(s, now, what) {
    const name = String(RepPorts.roomName() || s.spaceId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "room";
    return "ddjp-rep-" + name + "-" + _day(now) + (what ? "-" + what : "") + ".json";
  }
  // A file someone picked: checked whole, or refused with the reason. Never trusted for more than it says.
  function _readFile(o) {
    if (!o || typeof o !== "object" || Array.isArray(o) || o.format !== FORMAT) return { ok: false, why: "not a reputation file" };
    if (o.v !== 1) return { ok: false, why: "a version of the file this app does not read" };
    if (typeof o.room !== "string" || !o.room) return { ok: false, why: "it names no room" };
    if (typeof o.exportedAt !== "number" || !isFinite(o.exportedAt)) return { ok: false, why: "it has no export date" };
    if (!o.rows || typeof o.rows !== "object" || Array.isArray(o.rows)) return { ok: false, why: "it has no rows" };
    const rows = Object.create(null);
    for (const u of Object.keys(o.rows)) {
      const d = RepRules.decodeRow([u].concat(Array.isArray(o.rows[u]) ? o.rows[u] : [null]));
      if (!d) return { ok: false, why: "a row that does not read (" + u + ")" };
      rows[u] = d.split;
    }
    // WHOLE NUMBERS (J87): a file exported by `?v=533`–`535` may carry half-millisecond stamps; the table it becomes sends
    // its `since` in every summary, and readers take whole numbers only.
    return { ok: true, value: { room: o.room, roomName: typeof o.roomName === "string" ? o.roomName : null, exportedAt: Math.floor(o.exportedAt),
      since: (typeof o.since === "number" && isFinite(o.since)) ? Math.floor(o.since) : null, rows: rows, people: Object.keys(rows).length } };
  }
  function exportTable(ui) {
    const s = _s, now = _now();
    if (!s || s.writer !== true || !s.table || now === null || !ui || typeof ui.download !== "function") return { ok: false, why: "no table to export" };
    const data = _exportOf(s, now);
    ui.download(_fileName(s, now), data);
    _log("table exported (" + data.people + " people)");
    return { ok: true };
  }
  // THE REPLACE FLOW, and Start fresh (`fresh`): the backup first, every time; then the file and its preview; then, only
  // once confirmed, the table replaced. `ui` lends { download(name, data), pick() → data | null, confirm(lines) → bool }.
  // The preview NAMES the people — REP high first under the room's current settings, at most PREVIEW_NAMES of them — and
  // the room, so the owner can tell the file apart before confirming (§5.3).
  const PREVIEW_NAMES = 8;
  function _peopleLine(file) {
    const set = RepPorts.settings() || {};
    const ranked = Object.keys(file.rows).map((u) => ({ u: u, v: RepRules.shown(file.rows[u], set).REP }))
      .sort((a, b) => (b.v - a.v) || (a.u < b.u ? -1 : (a.u > b.u ? 1 : 0)));
    if (!ranked.length) return "0 people";
    return file.people + " people: " + ranked.slice(0, PREVIEW_NAMES).map((r) => r.u + " (" + r.v + " REP)").join(", ") +
      (ranked.length > PREVIEW_NAMES ? " and " + (ranked.length - PREVIEW_NAMES) + " more" : "");
  }
  function replaceTable(ui, fresh) {
    const s = _s, now = _now();
    if (!s || s.writer !== true || !s.loaded || now === null || !ui) return Promise.resolve({ ok: false, why: "the bot side is not running here" });
    if (s.fill === "running") return Promise.resolve({ ok: false, why: "a fill-back is running — try again in a moment" });
    const backup = _exportOf(s, now);
    ui.download(_fileName(s, now, "backup"), backup);   // ALWAYS FIRST, before anything else
    _log("backup downloaded (" + backup.people + " people) before " + (fresh ? "starting fresh" : "a replace"));
    const picked = fresh ? Promise.resolve(null) : Promise.resolve(ui.pick());
    return picked.then((raw) => {
      let file = null;
      if (!fresh) {
        if (raw === null || raw === undefined) { _log("replace cancelled — nothing changed"); return { ok: false, why: "cancelled" }; }
        const v = _readFile(raw);
        if (!v.ok) { _log("replace refused — " + v.why + "; nothing changed"); return { ok: false, why: v.why }; }
        file = v.value;
      }
      const other = file && file.room !== s.spaceId;
      const lines = fresh
        ? ["Start fresh: an empty reputation table for this room.", "Every number starts again from now; nothing before is kept."]
        : [_peopleLine(file), "Exported " + _day(file.exportedAt),
           other ? "ANOTHER ROOM: " + (file.roomName ? file.roomName + " (" + file.room + ")" : file.room) : "This room: " + (RepPorts.roomName() || file.roomName || file.room),
           "Votes and saves since " + _day(file.exportedAt) + " are not added."];
      return Promise.resolve(ui.confirm(lines, { other: !!other })).then((yes) => {
        if (yes !== true) { _log((fresh ? "start fresh" : "replace") + " cancelled — nothing changed"); return { ok: false, why: "cancelled" }; }
        if (_s !== s || s.writer !== true) return { ok: false, why: "the room was left — nothing changed" };
        if (s.fill === "running") return { ok: false, why: "a fill-back is running — nothing changed" };
        _install(s, file, fresh);
        return { ok: true };
      });
    });
  }
  // REPLACED, NEVER MERGED: the file's rows (or none) are the base; the cut is the current song's play; what this tab
  // holds at or after it is counted forward, as a fill-back would; a fresh summary goes at once.
  function _install(s, file, fresh) {
    const now = _now(), old = s.table;
    const t = _newTable(s.spaceId);
    if (file) for (const u of Object.keys(file.rows)) t.base[u] = file.rows[u].slice();
    t.since = file ? file.since : now;
    t.last = old ? old.last : null;            // its serial carries on: devices take the newer summary
    t.lastMsgAt = old ? old.lastMsgAt : null;
    s.table = t;
    t.cut = _cutNow(s);
    for (const e of (RepPorts.heldLog() || [])) _count(s, e);
    t.counted = 0;
    s.noBase = false; s.early = [];
    s.freshNow = fresh ? "after Start fresh" : "after a Replace";
    _log(fresh ? "started fresh — an empty table; backup downloaded first"
      : "table replaced from a file (" + file.people + " people, room " + _short(file.room) + ", " + _day(file.exportedAt) + ") — backup downloaded first");
    _dirty(s); _step();
  }
  // LOOK FURTHER BACK (Q4): with no base, the no-table search once more over a longer window. The window itself is unchanged.
  function lookFurther(days) {
    const s = _s, now = _now();
    if (!s || s.writer !== true || !s.noBase || now === null) return { ok: false, why: "only with no table and no summary" };
    if (!(typeof days === "number" && Math.floor(days) === days && days >= WINDOW.min && days <= WINDOW.max)) return { ok: false, why: "1 to 365 days" };
    s.noBase = false; s.fill = "running";
    _log("looking further back — " + days + " day(s), this once");
    _noTable(s, now, days * DAY);
    return { ok: true };
  }
  // ONE OF THE BOT'S OWN SETTINGS, from the Bot card: checked, kept, saved for this room.
  function setPref(key, value) {
    const s = _s;
    if (!s || s.writer !== true) return { ok: false, why: "the bot side is not running here" };
    if (!_prefOk(key, value)) return { ok: false, why: PREFS[key] ? "out of range" : "no such setting" };
    s.prefs[key] = value;
    if (key === "windowDays") s.windowMs = value * DAY;
    try { RepPorts.prefsSave(s.spaceId, Object.assign({}, s.prefs)); } catch (e) {}
    _log(PREFS[key].label + " set to " + value + (PREFS[key].unit ? " " + PREFS[key].unit : ""));
    return { ok: true };
  }

  // ── THE BOT CARD (H4, through `Rep.botCard`): plain rows the panel renders, and nothing it decides ─────────────────
  function card() {
    const s = _s;
    if (!s) return null;
    const head = "Reputation (REP)";
    if (s.writer === false) return { heading: head, note: "Another tab of this account writes REP for this room — this tab only reads.", rows: [] };
    if (s.writer !== true || !s.loaded) return { heading: head, note: "Starting…", rows: [] };
    const p = s.prefs, rows = [];
    const num = (key) => ({ kind: "number", key: key, label: PREFS[key].label, unit: PREFS[key].unit, value: p[key], min: PREFS[key].min, max: PREFS[key].max,
      set: (v) => setPref(key, v) });
    rows.push(num("windowDays"));
    rows.push({ kind: "toggle", key: "commands", label: PREFS.commands.label, value: p.commands, set: (v) => setPref("commands", v) });
    rows.push(num("cooldownS"));
    rows.push(num("roomLimit"));
    rows.push({ kind: "button", key: "export", label: "Export reputation table", enabled: !!s.table, run: (ui) => exportTable(ui) });
    rows.push({ kind: "button", key: "replace", label: "Replace reputation table…", enabled: s.fill === null, run: (ui) => replaceTable(ui, false) });
    if (s.noBase) {
      rows.push({ kind: "button", key: "startFresh", label: "Start fresh", enabled: true, run: (ui) => replaceTable(ui, true) });
      rows.push({ kind: "days", key: "lookFurther", label: "Look further back", unit: "days", value: Math.min(WINDOW.max, p.windowDays * 4),
        min: WINDOW.min, max: WINDOW.max, run: (ui, days) => lookFurther(days) });
    }
    const note = s.noBase ? "No table and no summary within the window — nothing is published. Replace from a file, start fresh, or look further back."
      : (s.fill ? "Filling in what it missed…" : (s.table ? "A table of " + Object.keys(s.table.base).length + " people." : "Looking for a base…"));
    return { heading: head, note: note, rows: rows };
  }

  // ── LIFECYCLE ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function enter(ctx) {
    const c = ctx || {};
    const bot = RepPorts.actingAsBot();
    if (!bot || typeof c.spaceId !== "string" || !c.channels || !c.channels.events_owner) {
      if (_s) _stop("this tab is not the room's bot here");
      return;
    }
    if (_s && _s.spaceId === c.spaceId) { _s.channels = c.channels; return; }   // a rank change in the same room: keep running
    if (_s) _stop("another room");
    _start(c.spaceId, c.channels);
  }
  function leave(why) { if (_s) _stop(why || "the tab left the room"); }
  function _start(spaceId, channels) {
    const s = { gen: ++_gen, spaceId: spaceId, channels: channels, me: RepPorts.myId(), writer: null, release: null, table: null,
      loaded: false, ready: false, noBase: false, early: [], plays: Object.create(null), playsAt: null, sending: false,
      awaitFrom: undefined, wantFresh: false, afterFill: 0, unsent: 0, tick: null, soonTimer: null, saveTimer: null,
      fill: null, retrySaid: false, windowMs: WINDOW.days * DAY,
      prefs: _prefsOf(null), startedAt: _now(), cmdLast: Object.create(null), cmdSeen: Object.create(null), replies: [], freshNow: null };
    _s = s;
    RepPorts.onReactions(_onReaction);
    RepPorts.onRaw(_onRaw);
    if (!_chatHeard) { _chatHeard = true; RepPorts.onChat(_onChat); }   // chat keeps its listeners: once a page
    if (!_caughtUpHeard) { _caughtUpHeard = true; RepPorts.onCaughtUp(_onCaughtUp); }   // and the session its own
    s.tick = setInterval(() => { if (_s === s) _step(); }, TICK_MS);
    Promise.resolve(RepPorts.writerLock(spaceId, () => new Promise((release) => { s.release = release; }))).then((got) => {
      if (_s !== s) { if (s.release) s.release(); return null; }
      if (got === false) {
        s.writer = false;
        _detach(s);
        _log("another tab of this account writes REP for this room — this tab only reads");
        return null;
      }
      if (got !== true) _log("this browser has no single-writer lock (no Web Locks) — this tab writes REP for this room");
      s.writer = true;
      const prefs = Promise.resolve().then(() => RepPorts.prefsLoad(spaceId)).catch(() => null);
      return Promise.all([Promise.resolve(RepPorts.storeLoad(spaceId)), prefs]).then(([stored, pf]) => {
        if (_s !== s) return;
        s.table = _revive(stored, spaceId);
        s.windowMs = _windowMs(pf);
        s.prefs = _prefsOf(pf);
        s.loaded = true;
        const t = s.table, now = _now();
        _log("bot side started for " + _short(spaceId) + " — " + (t
          ? "table of " + Object.keys(t.base).length + " people, cut l=" + (t.cut ? t.cut.pos : "the start") +
            (t.last ? ", last summary n=" + t.last.n + " (age " + _dur(now !== null ? now - t.last.at : -1) + ")" : ", no summary yet")
          : "no table") + "; window " + Math.round(s.windowMs / DAY) + " day(s)");
        if (t && typeof t.unreadLast === "number") {
          _log("the stored last summary (n=" + t.unreadLast + ") had no whole serial, so no device could read it — not kept; a new " +
            "summary goes out");
          delete t.unreadLast;
        }
        _step();
      });
    }).catch((e) => { _warn("the bot side could not start — " + ((e && e.message) || e)); });
  }
  function _detach(s) {
    RepPorts.offReactions(_onReaction);
    RepPorts.offRaw(_onRaw);
    if (s.tick) { clearInterval(s.tick); s.tick = null; }
    if (s.soonTimer) { clearTimeout(s.soonTimer); s.soonTimer = null; }
    if (s.saveTimer) { clearTimeout(s.saveTimer); s.saveTimer = null; }
  }
  function _stop(why) {
    const s = _s;
    if (!s) return;
    _s = null;
    _detach(s);
    const dropped = (s.sending ? 1 : 0) + (s.unsent || 0);
    let people = 0;
    if (s.writer === true && s.table) {
      people = Object.keys(s.table.base).length;
      try { RepPorts.storeSave(s.spaceId, _plain(s.table)); } catch (e) {}   // started, not awaited
    }
    if (s.release) { try { s.release(); } catch (e) {} }
    _log("stopped — " + why + "; " + (s.writer === true && s.table ? "table saved (" + people + " people)" : "no table to save") +
      ", " + dropped + " unsent dropped");
  }

  // For the guard: the running session's table and state, as a plain copy (never the live objects).
  function _stateForTest() {
    const s = _s;
    if (!s) return null;
    return { gen: s.gen, spaceId: s.spaceId, writer: s.writer, loaded: s.loaded, ready: s.ready, noBase: s.noBase, sending: s.sending,
      fill: s.fill, windowMs: s.windowMs, afterFill: s.afterFill, prefs: Object.assign({}, s.prefs), freshNow: s.freshNow,
      table: s.table ? _plain(s.table) : null, timers: { tick: !!s.tick, soon: !!s.soonTimer, save: !!s.saveTimer } };
  }
  function _stepForTest() { _step(); }

  return { enter, leave, card, exportTable, replaceTable, lookFurther, setPref, TICK_MS, SOON_MS, SAVE_MS, TABLE_V, WINDOW, PREFS, TOPS,
    _stateForTest, _stepForTest };
})();
