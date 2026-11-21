// core/historysummary.js — THE SONG HISTORY CHANNEL'S SUMMARY: its format, the one pure piece both sides use (the owner's design,
// `consensus/history-rules.md` §12; his words in `main/01-project.md` item 7).
//
// Depends on: NOTHING. No global, no clock, no transport, no storage: every input is an argument and every answer a return value
// — REP's rules piece is the model (`features/rep-rules.js`). `check-history-summary` loads this file in an empty sandbox and
// fails if it names an app global, a clock or a timer, so the bot that writes a summary and every device that reads one cannot
// read the format apart.
//
// WHY IT IS IN core/. A device reads summaries inside song history's own opening (`MatrixBridge.backfillHistory`, before verify
// and the fill), in the backend, and the backend may not depend on the app; the bot (738) writes them from the feature layer.
// Both may reach core/, and core/ reaches neither.
//
// ── WHAT A SUMMARY IS ────────────────────────────────────────────────────────────────────────────────────────────────────────
// One side message (`TYPE`, the `ddjp.side.*` class: never folded, never sealed) on the room's song history channel, written by
// the room's bot. It is song history's account of one STRETCH of the room, downstream of everything (his words 5: "no affect on
// room state, just histroy"): never the fold, the seed, the floor, the log or the cache.
//   { v, n, from, to, count, djs, rows }
//   v       the format's version (`VERSION`); a reader refuses any other
//   n       the bot's serial: a later summary has a higher one, and for one play the newest summary naming it wins
//   from,to the stretch of positions it covers: EVERY play at a position from `from` to `to` is one of its rows, and every one of
//           them has ended (a play still going is never in a summary)
//   count   how many songs the room has had from its start up to `to`, counted up to the history size and then always the history
//           size (his words 1, item 7) — a device that reads back until its rows meet the newest count has the room's start, or
//           its window, and reads nothing further
//   djs     the DJ table: each DJ's user id once; a row names its DJ by index
//   rows    in the room's order (position, then play id by code unit — History's own), no play twice, each an array:
//           [pi, l, songKey, dj, at, endedAt, votes, saves, ended, why]
//             pi       the play (its event id; a bot room's relay member `$carrier#k`)
//             l        its position
//             songKey  its song (`yt:`/`sc:` + id), or null
//             dj       index into `djs`, or null
//             at       when it started (server time), or null
//             endedAt  when it ended (server time; worked out in song history, §11), or null where unknown
//             votes, saves  its final tallies
//             ended    how it ended: 0 a plain advance, 1 a skip ("dj"), 2 the room's skip of a song that could not play ("media"),
//                      null unknown
//             why      the skip's token (`repeat`, `region`), or null
//           the trailing slots that hold their defaults (null, 0, 0, null, null) are left off.
//
// ── THE RULES IN THIS FILE ───────────────────────────────────────────────────────────────────────────────────────────────────
//   ENCODE   `summary(o)` — a body from History-shaped rows; `fit(o)` — the oldest rows that fit under the byte budget, the stretch
//            cut just below the first row left out, and the rest handed back for the next message (the bot, 738).
//   DECODE   `read(body, reserved)` — validated against the transport's list of fields a side message may not carry (handed in,
//            as REP's readers are: never a copy here), every refusal by name; rows come back in History's own row shape.
//   TRUST    `trust({ channel, id, level })` — believed only as REP believes its messages: a top-level event, on the song
//            history channel, from a sender at the owner level (99) or above. Anything else is ignored.
//   NEWER    `newer(a, b)` — the higher serial, then the later position.
const HistorySummary = (() => {
  const VERSION = 1;
  const TYPE = "ddjp.side.history.summary";
  // CODE CONSTANTS, not settings. `budgetBytes` IS REP'S NUMBER (`RepRules.LIMITS.budgetBytes`): core/ may not reach features/, so
  // it is written here and `check-history-summary` compares the two — a message's content, as sent, under Matrix's 65,536-byte
  // event limit with room for the envelope. `maxRows` and `maxCount` are the history size's ceiling (`History.MAX`).
  const LIMITS = Object.freeze({ budgetBytes: 60000, maxRows: 5000, maxCount: 5000, maxKey: 200, maxId: 300, maxWhy: 32 });
  // What the transport stamps on every message it sends (`sendEvent`): a reader takes exactly these off before validating.
  const STAMPED = Object.freeze(["t", "l", "dv", "hv"]);
  const TRUST = Object.freeze({ channel: "history_owner", minLevel: 99 });
  const ENDED = Object.freeze([false, "dj", "media"]);   // `ended` 0, 1, 2 -> the row's `cutShortBy`
  const DEFAULTS = [null, 0, 0, null, null];             // slots 5..9, left off when trailing

  const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const _isInt = (n) => typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  const _isUser = (u) => typeof u === "string" && u.length >= 3 && u.length <= 255 && u.charAt(0) === "@" && u.indexOf(":") > 1;
  const _isId = (s) => typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxId;
  const _isKey = (s) => s === null || (typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxKey);
  const _isWhy = (s) => s === null || (typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxWhy && /^[a-z][a-z0-9_-]*$/.test(s));
  const _stamp = (v) => v === null || (_isInt(v) && v > 0);
  // The room's order: position, then the play id compared by code unit (History's `_roomOrder`, the engine's).
  function _cmp(a, b) { if (a.l !== b.l) return a.l - b.l; const x = String(a.pi), y = String(b.pi); return x < y ? -1 : (x > y ? 1 : 0); }

  // ── ENCODE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // One History row -> its wire array, against a DJ table being built.
  function _row(r, djs) {
    let dj = null;
    if (typeof r.dj === "string" && r.dj) { dj = djs.indexOf(r.dj); if (dj < 0) { djs.push(r.dj); dj = djs.length - 1; } }
    const c = r.counts || {};
    const ended = ENDED.indexOf(r.cutShortBy);
    const out = [r.pi, r.l, (typeof r.songKey === "string" && r.songKey) ? r.songKey : null, dj,
      (_isInt(r.at) && r.at > 0) ? r.at : null, (_isInt(r.endedAt) && r.endedAt > 0) ? r.endedAt : null,
      _isInt(c.votes) ? c.votes : 0, _isInt(c.saves) ? c.saves : 0, ended >= 0 ? ended : null,
      (typeof r.endedBy === "string" && r.endedBy) ? r.endedBy : null];
    while (out.length > 5 && out[out.length - 1] === DEFAULTS[out.length - 6]) out.pop();
    return out;
  }
  // `o` { n, from, to, count, rows: History rows ({ pi, l, songKey, dj, at, endedAt, counts, cutShortBy, endedBy }) }.
  function summary(o) {
    const rows = (o.rows || []).slice().sort(_cmp);
    const djs = [];
    const enc = rows.map((r) => _row(r, djs));
    return { v: VERSION, n: o.n, from: o.from, to: o.to, count: o.count, djs: djs, rows: enc };
  }
  // UTF-8 bytes of a string, computed rather than encoded, so this file needs no global (REP's own way).
  function utf8Bytes(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  // The content as the transport sends it: the body with the fields it stamps, as a JSON string inside an `m.text`.
  function sentBytes(type, body) {
    const stamped = Object.assign({}, body, { t: type, l: Number.MAX_SAFE_INTEGER, dv: 2, hv: 99 });
    return utf8Bytes(JSON.stringify({ msgtype: "m.text", body: JSON.stringify(stamped) }));
  }
  // FIT UNDER THE BUDGET (the bot's backfill and its count re-send, bundled): the OLDEST rows that fit, and the stretch cut just below the
  // first row left out — so "every play from `from` to `to` is a row" stays true of what is sent — with the rest handed back
  // (`rest`, oldest first; the next message starts at `next`). Rows sharing a position go together or not at all. `o.countAt(k)`,
  // optional, says the room's count up to the cut when k rows are kept; without it: `o.count` less the rows left out, unless the
  // count is the history size (`o.size`, else `LIMITS.maxCount`), which stays the history size. Answers
  // { body, kept, rest, next } — `body` null when not even the oldest row fits.
  function fit(o) {
    const rows = (o.rows || []).slice().sort(_cmp);
    const cap = _isInt(o.size) && o.size > 0 ? o.size : LIMITS.maxCount;
    const countAt = (typeof o.countAt === "function") ? o.countAt : ((k) => (o.count >= cap ? o.count : Math.max(k, o.count - (rows.length - k))));
    const make = (k) => summary({ n: o.n, from: o.from, to: k < rows.length ? rows[k].l - 1 : o.to, count: countAt(k), rows: rows.slice(0, k) });
    const ok = (k) => sentBytes(TYPE, make(k)) <= LIMITS.budgetBytes;
    if (ok(rows.length)) return { body: make(rows.length), kept: rows.length, rest: [], next: null };
    const cut = (k) => { while (k > 0 && k < rows.length && rows[k - 1].l === rows[k].l) k--; return k; };   // never split one position
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ok(cut(mid))) lo = mid; else hi = mid - 1; }
    const k = cut(lo);
    if (k === 0) return { body: null, kept: 0, rest: rows, next: rows.length ? rows[0].l : null };
    return { body: make(k), kept: k, rest: rows.slice(k), next: rows[k].l };
  }

  // ── DECODE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function _noReserved(b, reserved) { for (const k of reserved) if (_own(b, k)) return false; return true; }
  // One wire row -> History's row shape, or null.
  function _decodeRow(a, djs) {
    if (!Array.isArray(a) || a.length < 5 || a.length > 10) return null;
    const x = a.concat(DEFAULTS.slice(a.length - 5));
    const [pi, l, songKey, dj, at, endedAt, votes, saves, ended, why] = x;
    if (!_isId(pi) || !_isInt(l) || !_isKey(songKey) || !_stamp(at) || !_stamp(endedAt)) return null;
    if (!(dj === null || (_isInt(dj) && dj < djs.length))) return null;
    if (!_isInt(votes) || !_isInt(saves) || !(ended === null || (_isInt(ended) && ended < ENDED.length)) || !_isWhy(why)) return null;
    const r = { pi: pi, l: l, songKey: songKey, dj: dj === null ? null : djs[dj], at: at, counts: { votes: votes, saves: saves } };
    if (endedAt !== null) r.endedAt = endedAt;
    if (ended !== null) r.cutShortBy = ENDED[ended];
    if (why !== null) r.endedBy = why;
    return r;
  }
  // Validate a summary body against `reserved`, the transport's list of fields a side message may not carry. Returns { ok, why,
  // value: { n, from, to, count, rows } } — the rows in History's own shape.
  function read(body, reserved) {
    const b = body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, why: "not an object" };
    if (!Array.isArray(reserved)) return { ok: false, why: "no reserved-field list" };   // never read unchecked
    if (b.v !== VERSION) return { ok: false, why: "unknown version" };
    if (!_noReserved(b, reserved)) return { ok: false, why: "a reserved field" };
    if (!_isInt(b.n)) return { ok: false, why: "no serial" };
    if (!_isInt(b.from) || !_isInt(b.to) || b.to < b.from) return { ok: false, why: "bad stretch" };
    if (!_isInt(b.count) || b.count > LIMITS.maxCount) return { ok: false, why: "bad count" };
    if (!Array.isArray(b.djs) || b.djs.length > LIMITS.maxRows || !b.djs.every(_isUser) || new Set(b.djs).size !== b.djs.length) return { ok: false, why: "bad DJ table" };
    if (!Array.isArray(b.rows) || b.rows.length > LIMITS.maxRows) return { ok: false, why: "bad rows" };
    const rows = [], pis = new Set();
    for (const a of b.rows) {
      const r = _decodeRow(a, b.djs);
      if (!r) return { ok: false, why: "a bad row" };
      if (r.l < b.from || r.l > b.to) return { ok: false, why: "a row outside the stretch" };
      if (pis.has(r.pi)) return { ok: false, why: "a play twice" };
      if (rows.length && _cmp(rows[rows.length - 1], r) >= 0) return { ok: false, why: "rows out of order" };
      pis.add(r.pi); rows.push(r);
    }
    if (rows.length > b.count) return { ok: false, why: "more rows than songs" };
    return { ok: true, why: null, value: { n: b.n, from: b.from, to: b.to, count: b.count, rows: rows } };
  }
  // A message as it arrived, without what the transport stamped on it (`STAMPED`), for `read`.
  function unstamp(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const o = {};
    for (const k of Object.keys(body)) if (STAMPED.indexOf(k) < 0) o[k] = body[k];
    return o;
  }

  // ── TRUST AND THE NEWEST ──────────────────────────────────────────────────────────────────────────────────────────────────
  // `m` { channel: the key of the channel it was read on, id: its event id, level: its sender's level in that channel }. A relay
  // batch's member is named `<carrier>#<k>` and never stands as its own event; a Matrix event id never holds a "#".
  function trust(m) {
    const x = m || {};
    if (x.channel !== TRUST.channel) return { ok: false, why: "not the song history channel" };
    if (typeof x.id !== "string" || !x.id || x.id.indexOf("#") >= 0) return { ok: false, why: "not a top-level event (a batch member)" };
    if (typeof x.level !== "number" || !(x.level >= TRUST.minLevel)) return { ok: false, why: "its sender is below level " + TRUST.minLevel };
    return { ok: true, why: null };
  }
  // Of two summaries, which is newer: the higher serial, then the later position (`l`, the message's own, attached by its reader).
  function newer(a, b) {
    if (!a) return b || null; if (!b) return a;
    if (a.n !== b.n) return a.n > b.n ? a : b;
    return (a.l || 0) >= (b.l || 0) ? a : b;
  }

  return { VERSION, TYPE, LIMITS, STAMPED, TRUST, summary, fit, read, unstamp, trust, newer, utf8Bytes, sentBytes };
})();
