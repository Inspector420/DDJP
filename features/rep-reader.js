// features/rep-reader.js — J84-3: REP's READER, on every device (the owner's rulings 21b, 24, 26, 30d, 32 and 34;
// DESIGN-J84-REP.md §4.3, §4.5). Runs on every tab in a room, the bot's included: what a person's number is, read from the
// bot's messages and counted forward from them.
//
// Depends on: RepRules (what counts, the split, the messages, trust) and RepPorts (everything else). Nothing else:
// `check-rep-boundary` holds that this file names no app global. Every time it judges by is the server's.
//
// ── WHAT IT DOES ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   1. LOOKS BACK twice the room's summary interval (ruling 24) on the owner-level channel for the newest summary and its
//      additions, and listens for new ones. BELIEVED only as a top-level event on that channel from a sender at 99 or
//      above (`RepRules.trust`): never another channel, never a relay batch's member. Of two summaries the newer wins
//      (the higher serial, then the later position); an addition counts only under its own summary.
//   2. COUNTS FORWARD from the summary's cut with its own per-playing accumulator — the bot side's rules, receipts and
//      cut (`RepRules.add`) — over EVERYONE, so a person an addition names later already has their counts. What this tab
//      holds is counted from the held log; what lies between the cut and the start of the held log (a save point, a trim)
//      is paged from the server. A reaction naming a playing song history has not shown yet is held until it does.
//   3. IS READY only once it holds a summary AND has read everything from its cut — the held log once the tab is caught
//      up, and the paged stretch to the cut. Never a partial number (§4.5).
//   4. SHOWS, for a person the summary or an addition names: their row + their forward counts, through `RepRules.shown`
//      under the room's CURRENT settings — so a settings change shows at once. Anyone else shows nothing: not a 0, which
//      would be a claim (Q5, Q6; no coverage text anywhere). Active with no row from the bot: a log line says why, once.
//   5. SAYS SO AT ONCE (the owner's ruling 35): whenever what it shows may have moved — it became ready, a vote or save
//      counted, an addition, a held reaction placed, a settings change — it raises the feature layer's generic "the people
//      view changed" (`RepPorts.peopleChanged`), and the People tab redraws, once per burst.
// A newer summary moves the cut: the playings before it leave the accumulator (the summary closes them, as on the bot).
const RepReader = (() => {
  const TICK_MS = 15000;          // the look-back retried, held reactions retried, who is active with no row noted
  const SOON_MS = 1000;           // after a reaction while still reading: look again within a second
  const ADDS_CAP = 500;           // additions kept (each under 20 people; a fresh summary replaces them)
  const SEEN_CAP = 5000;          // REP messages already judged, by event id (a read-back and its live echo are one)

  let _r = null, _gen = 0;

  const _log = (msg) => RepPorts.log("info", msg);
  const _warn = (msg) => RepPorts.log("warn", msg);
  function _now() { const t = RepPorts.serverNow(); return (typeof t === "number" && isFinite(t) && t > 0) ? t : null; }
  function _interval() {
    const s = RepPorts.settings() || {};
    return (typeof s.repSummaryMs === "number" && isFinite(s.repSummaryMs) && s.repSummaryMs > 0) ? s.repSummaryMs : null;
  }
  function _dur(ms) { if (!(ms >= 0)) return "?"; if (ms < 7200000) return Math.round(ms / 60000) + " min"; return Math.round(ms / 3600000) + " h"; }

  // ── THE PLAYINGS: song history's rows, by play instance (as the bot side reads them) ────────────────────────────────
  function _refreshPlays(r) {
    const map = Object.create(null);
    for (const p of (RepPorts.playings() || [])) if (p && typeof p.pi === "string" && typeof p.l === "number") map[p.pi] = p;
    r.plays = map;
    r.playsAt = _now();
  }
  function _playing(r, pi) {
    if (typeof pi !== "string") return null;
    let p = r.plays[pi];
    if (!p) { const n = _now(); if (r.playsAt === null || n === null || n - r.playsAt >= 1000) { _refreshPlays(r); p = r.plays[pi]; } }
    return p || null;
  }

  // ── COUNTING FORWARD FROM THE CUT ──────────────────────────────────────────────────────────────────────────────────
  // One reaction as the fold reads it ({ eventId, type, sender, content.p, l, ts }; a bot room's relayed act member by
  // member), counted by the same rule the bot side counts with.
  function _count(r, e) {
    if (!r.sum || !e || !RepRules.kindOf(e.type)) return false;
    const pi = e.content && e.content.p;
    const playing = _playing(r, pi);
    if (!playing) { _hold(r, e); return false; }
    const res = RepRules.add(r.acc, { type: e.type, voter: e.sender, pi: pi }, playing, r.sum.cut, RepPorts.isLegal(e.eventId) !== false);
    if (res.added) r.fwd = null;
    return res.added;
  }
  function _hold(r, e) {
    const h = r.acc.held;
    if (typeof (e.content && e.content.p) !== "string" || typeof e.eventId !== "string") return;
    if (h.some((x) => x.id === e.eventId)) return;
    h.push({ id: e.eventId, type: e.type, sender: e.sender, p: e.content.p, l: e.l, ts: e.ts });
    if (h.length > RepRules.LIMITS.heldUnknown) h.splice(0, h.length - RepRules.LIMITS.heldUnknown);
  }
  function _retryHeld(r, now) {
    const I = _interval(), keep = [];
    let n = 0;
    for (const h of r.acc.held) {
      const e = { eventId: h.id, type: h.type, sender: h.sender, content: { p: h.p }, l: h.l, ts: h.ts };
      if (_playing(r, h.p)) { if (_count(r, e)) n++; continue; }
      if (I !== null && now !== null && typeof h.ts === "number" && h.ts < now - RepRules.LIMITS.lookbackFactor * I) continue;
      keep.push(h);
    }
    r.acc.held = keep;
    if (n) _changed(r);
  }
  // What this tab shows may have moved: say so, through the port, once it shows anything at all.
  function _changed(r) { if (r && r.ready && _r === r) RepPorts.peopleChanged(); }
  function _countAll(r, list) { let n = 0; for (const e of (list || [])) if (_count(r, e)) n++; return n; }

  // ── A REP MESSAGE: TRUST, THEN THE NEWEST ───────────────────────────────────────────────────────────────────────────
  function _channelKey(r, roomId) {
    const ch = r.channels || {};
    for (const k of Object.keys(ch)) if (ch[k] === roomId) return k;
    return null;
  }
  // `m` { id, channel (its key), sender, ts, l, type, body (as it arrived, the transport's stamps included) }.
  function _take(r, m, how) {
    const kind = m.type === RepRules.TYPES.summary ? "summary" : (m.type === RepRules.TYPES.addition ? "addition" : null);
    if (!kind || typeof m.id !== "string") return false;
    if (r.seen[m.id]) return false;
    r.seen[m.id] = 1;
    if (++r.seenN > SEEN_CAP) { r.seen = Object.create(null); r.seenN = 0; }
    const t = RepRules.trust({ channel: m.channel, id: m.id, level: RepPorts.levelOf(r.spaceId, r.channels, m.sender) });
    if (!t.ok) { _log("ignored a REP " + kind + " from " + (m.channel || "another channel") + " / " + m.sender + " — " + t.why); return false; }
    const body = RepRules.unstamp(m.body);
    if (kind === "summary") {
      const v = RepRules.readSummary(body);
      if (!v.ok) { _log("ignored a REP summary from " + m.sender + " — " + v.why); return false; }
      const cand = Object.assign({}, v.value, { id: m.id, l: (typeof m.l === "number") ? m.l : 0, ts: m.ts, sender: m.sender });
      if (r.sum && RepRules.newer(r.sum, cand) !== cand) return false;   // the newest wins: this one is older
      _adopt(r, cand, how);
      return true;
    }
    const v = RepRules.readAddition(body);
    if (!v.ok) { _log("ignored a REP addition from " + m.sender + " — " + v.why); return false; }
    const a = Object.assign({}, v.value, { id: m.id });
    if (r.sum && a.n < r.sum.n) return false;   // under an older summary
    r.adds.push(a);
    if (r.adds.length > ADDS_CAP) r.adds.splice(0, r.adds.length - ADDS_CAP);
    if (r.sum && a.of === r.sum.id && a.n === r.sum.n) {
      r.pub = null;
      _log("addition " + a.k + " to n=" + a.n + " from " + m.sender + " — " + a.rows.length + " people");
      _changed(r);
    }
    return true;
  }
  function _adopt(r, sum, how) {
    r.sum = sum;
    r.adds = r.adds.filter((a) => a.n >= sum.n);
    r.pub = null; r.fwd = null; r.noRow = Object.create(null);
    // The summary closes everything before its cut, as on the bot: those playings leave the accumulator.
    for (const pi of Object.keys(r.acc.byPi)) {
      const p = r.acc.byPi[pi];
      if (RepRules.compareAt(p.l, pi, sum.cut.pos, sum.cut.pi) < 0) delete r.acc.byPi[pi];
    }
    r.ready = false; r.waitSaid = false; r.shortSaid = false;
    const added = RepRules.published(sum, r.adds);
    _log("summary n=" + sum.n + " from " + sum.sender + " (cut l=" + sum.cut.pos + ", " + sum.rows.length + " people" +
      (sum.more ? ", " + sum.more + " left out: size limit" : "") + ", +" + (Object.keys(added).length - sum.rows.length) +
      " added; " + how + ") — counting forward from the cut");
    _readFromCut(r);
  }

  // ── READY: EVERYTHING FROM THE CUT, READ ────────────────────────────────────────────────────────────────────────────
  function _readFromCut(r) {
    if (_r !== r || !r.sum || r.ready || r.reading) return;
    const sum = r.sum;
    if (!RepPorts.mayAuthor()) {   // the held log is still filling: a number now would be a partial one
      if (!r.waitSaid) { r.waitSaid = true; _log("reading back from the cut — none shown yet (this tab is still catching up)"); }
      return;
    }
    const from = RepPorts.heldFrom();
    if (from === undefined) {
      if (!r.waitSaid) { r.waitSaid = true; _log("reading back from the cut — none shown (this tab cannot say where its log starts)"); }
      return;
    }
    const held = _countAll(r, RepPorts.heldLog());
    if (from === null || from <= sum.cut.pos) { _ready(r, "the held log reaches the cut", held); return; }
    r.reading = true;
    Promise.resolve(RepPorts.pageReactions(sum.cut.pos, from - 1, null)).then((got) => {
      r.reading = false;
      if (_r !== r) return;
      if (r.sum !== sum) { _readFromCut(r); return; }   // a newer summary came meanwhile: read for it
      const list = Array.isArray(got) ? got : [];
      const paged = _countAll(r, list);
      if (typeof list.reachedFrom === "number" && list.reachedFrom <= sum.cut.pos) {
        _ready(r, "read back from the cut, l=" + sum.cut.pos + " to l=" + (from - 1) + " (" + list.length + " event(s) paged)", held + paged);
        return;
      }
      if (!r.shortSaid) {
        r.shortSaid = true;
        _log("reading back from the cut stopped short" + (typeof list.reachedFrom === "number" ? " at l=" + list.reachedFrom : "") +
          " — none shown yet; tried again");
      }
    }, (e) => { r.reading = false; _warn("reading back from the cut failed — " + ((e && e.message) || e) + "; tried again"); });
  }
  function _ready(r, how, n) {
    r.ready = true; r.fwd = null;
    _log("showing REP from summary n=" + r.sum.n + " — " + Object.keys(_published(r)).length + " people (" + how + "; " + n +
      " vote(s) and save(s) counted forward)");
    _noteNoRow(r);
    _changed(r);
  }
  function _published(r) { if (!r.pub) r.pub = RepRules.published(r.sum, r.adds); return r.pub; }
  function _forward(r) { if (!r.fwd) r.fwd = RepRules.contributions(r.acc); return r.fwd; }

  // Active in THIS DEVICE'S view with no row from the bot (30d): shown active with no number, and said once per person per
  // summary. The bot is never in its own summary.
  function _noteNoRow(r) {
    if (!r.ready || !r.sum) return;
    const view = RepPorts.whoIsActive(_now());
    if (!view || !Array.isArray(view.people)) return;
    const pub = _published(r);
    for (const p of view.people) {
      const u = p && p.userId;
      if (typeof u !== "string" || u === r.sum.sender || pub[u] || r.noRow[u]) continue;
      r.noRow[u] = 1;
      _log(u + " is active here and has no row from the bot (not in the bot's view when it last published" +
        (r.sum.more ? ", or one of the " + r.sum.more + " it left out at the size limit" : "") + ")");
    }
  }

  // ── THE LOOK-BACK (ruling 24) ──────────────────────────────────────────────────────────────────────────────────────
  function _lookBack(r) {
    const now = _now(), I = _interval();
    if (now === null || I === null) return;   // no clock or no interval yet: the next tick
    const span = RepRules.LIMITS.lookbackFactor * I;
    r.looking = true;
    Promise.resolve(RepPorts.readOwnerChannelBack(r.channels, now - span)).then((list) => {
      r.looking = false;
      if (_r !== r) return;
      if (!list || list.ok !== true) {
        if (!r.lookSaid) { r.lookSaid = true; _log("could not read the owner-level channel back yet — tried again"); }
        return;
      }
      r.looked = true;
      for (const m of list) {
        if (!m) continue;
        _take(r, { id: m.id, channel: RepRules.TRUST.channel, sender: m.sender, ts: m.ts, l: m.l, type: m.type, body: m.body }, "read back");
      }
      if (!r.sum) _log("no summary from the bot in the last " + _dur(span) + " — none shown");
    }, (e) => { r.looking = false; _warn("reading the owner-level channel back failed — " + ((e && e.message) || e)); });
  }

  // ── LISTENERS AND THE STEP ─────────────────────────────────────────────────────────────────────────────────────────
  function _onReaction(e) {
    const r = _r;
    if (!r || !r.sum) return;   // no cut yet: the held log has it, counted when a summary comes
    if (_count(r, e)) _changed(r);
    if (!r.ready) _soon(r);   // still reading: this tab may have caught up since the last look
  }
  function _onRaw(raw) {
    const r = _r;
    if (!r || !raw) return;
    const t = raw.ddjpType;
    if (t !== RepRules.TYPES.summary && t !== RepRules.TYPES.addition) return;
    _take(r, { id: raw.event_id, channel: _channelKey(r, raw.room_id), sender: raw.sender, ts: raw.ts, l: raw.l, type: t, body: raw.ddjpBody }, "live");
  }
  // The room's settings changed: a self-vote or self-save switch moves numbers at once, with no new summary.
  function _onSettings() { _changed(_r); }
  let _settingsHeard = false;
  function _soon(r) {
    if (!r || r.soonTimer || _r !== r) return;
    r.soonTimer = setTimeout(() => { r.soonTimer = null; if (_r === r) _step(r); }, SOON_MS);
  }
  function _step(r) {
    if (_r !== r) return;
    if (!r.looked && !r.looking) _lookBack(r);
    if (r.sum && !r.ready) _readFromCut(r);
    if (r.sum && r.acc.held.length) _retryHeld(r, _now());
    if (r.ready) _noteNoRow(r);
  }

  // ── WHAT THE PEOPLE TAB SHOWS (H3, through `Rep.badge`) ─────────────────────────────────────────────────────────────
  function badge(userId) {
    const r = _r;
    if (!r || !r.ready || !r.sum || typeof userId !== "string") return null;
    const row = _published(r)[userId];
    if (!row) return null;   // not published by the bot (unknown, or left out at the size limit): nothing, never a 0
    const rep = RepRules.shown(RepRules.plus(row, _forward(r)[userId]), RepPorts.settings() || {}).REP;
    return { rep: rep, text: rep + " REP" };
  }

  // ── LIFECYCLE (H1 and H2, through `Rep`) ───────────────────────────────────────────────────────────────────────────
  function enter(ctx) {
    const c = ctx || {};
    if (typeof c.spaceId !== "string" || !c.channels || !c.channels.events_owner) { if (_r) _stop("no room with an owner-level channel"); return; }
    if (_r && _r.spaceId === c.spaceId) { _r.channels = c.channels; return; }   // a rank change in the same room: keep reading
    if (_r) _stop("another room");
    _start(c.spaceId, c.channels);
  }
  function leave(why) { if (_r) _stop(why || "the tab left the room"); }
  function _start(spaceId, channels) {
    const r = { gen: ++_gen, spaceId: spaceId, channels: channels, sum: null, adds: [], acc: RepRules.newAccumulator(),
      plays: Object.create(null), playsAt: null, pub: null, fwd: null, ready: false, reading: false, looked: false,
      looking: false, lookSaid: false, waitSaid: false, shortSaid: false, noRow: Object.create(null),
      seen: Object.create(null), seenN: 0, tick: null, soonTimer: null };
    _r = r;
    RepPorts.onReactions(_onReaction);
    RepPorts.onRaw(_onRaw);
    if (!_settingsHeard) { _settingsHeard = true; RepPorts.onSettingsChange(_onSettings); }   // the room's list keeps it: once a page
    r.tick = setInterval(() => { if (_r === r) _step(r); }, TICK_MS);
    _step(r);
  }
  function _stop(why) {
    const r = _r;
    if (!r) return;
    _r = null;
    RepPorts.offReactions(_onReaction);
    RepPorts.offRaw(_onRaw);
    if (r.tick) { clearInterval(r.tick); r.tick = null; }
    if (r.soonTimer) { clearTimeout(r.soonTimer); r.soonTimer = null; }
    _log("reader stopped — " + why);
  }

  // For the guard: the reader's state, as a plain copy (never the live objects).
  function _stateForTest() {
    const r = _r;
    if (!r) return null;
    return { gen: r.gen, spaceId: r.spaceId, ready: r.ready, looked: r.looked, reading: r.reading,
      sum: r.sum ? { id: r.sum.id, n: r.sum.n, cut: r.sum.cut, people: r.sum.rows.length, more: r.sum.more, sender: r.sum.sender } : null,
      adds: r.adds.length, held: r.acc.held.length, playings: Object.keys(r.acc.byPi).length,
      timers: { tick: !!r.tick, soon: !!r.soonTimer } };
  }
  function _stepForTest() { if (_r) _step(_r); }

  return { enter, leave, badge, TICK_MS, SOON_MS, _stateForTest, _stepForTest };
})();
