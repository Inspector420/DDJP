// features/rep-rules.js — J84: REP's RULES, the one pure piece both sides use (the owner's ruling 21c).
//
// Depends on: NOTHING. No global, no clock, no transport, no storage: every input is an argument and every answer a
// return value, so the bot side and every device's reader cannot count differently — they call the same functions.
// `check-rep-boundary` runs this file in an empty sandbox to keep it so, and `check-rep-rules` drives every rule here.
//
// ── WHAT REP IS (the owner's rulings 20–33, J84; `main/04-features.md` §Reputation) ─────────────────────────────────────
// Six numbers per person — votes given (VG), votes received (VR), saves given (SG), saves received (SR), plus self-votes
// and self-saves (sv, ss) — kept by the room's bot (four are shown), published in its own SIDE messages (`ddjp.side.rep.*`, never folded, never sealed), and counted forward by
// every device from the summary's cut. REP, shown on the People tab, is VG + VR.
//
// ── WHY IT IS BELIEVED, NOT DERIVED, AND NOT IN A CHECKPOINT (J19's reasoning, moved here when J84 retired
//    `features/reputation.js`) ────────────────────────────────────────────────────────────────────────────────────────
// (b) IN THE CHECKPOINT, ASSERTED BY THE BOT — closed, and DRIVEN rather than argued. `CheckpointFormat.fingerprint`
// commits exactly six fields (`n`, `prev`, `seed`, `floorL`, `thin`, `covers`), read out of the function itself. A
// seventh moves every fingerprint — measured both ways, as a field inside the seed and as an extra argument to the
// hash — so every checkpoint in every room becomes unverifiable and no room holds a floor until it seals two fresh
// ones. And the worse half is not the cost: putting an UNVERIFIABLE number inside the artefact everyone verifies makes
// it look like verified truth, which contradicts the recorded decision that reputation is BELIEVED rather than derived
// (J17), silently, because the number would sit beside fields that really are checkable.
//
// (c) IN THE CHECKPOINT, DERIVED BY EVERYONE — closed, and it is **contradictory**, not hard. DERIVED means every
// client computes the same answer from what it holds, and this number's entire purpose is to outlive history that
// clients have forgotten. DRIVEN: the same tally rule over a full log and over a log missing its oldest half gives
// `{a:2,b:1}` and `{a:1}` — two honest clients, no disagreement about any event, different answers. **A quantity whose
// purpose is to survive forgetting cannot be derived from what survives forgetting.** The seed cannot rescue it either:
// carrying the running total forward through the seed means banking a number at seal time that nobody recomputes,
// which is (b) wearing (c)'s name. So REP is shape (a): believed from the bot, published on its own type.
//
// THE FAILURE J19 WAS BUILT AROUND, AND HOW REP ANSWERS IT. The failure is not a wrong number — it is a right number
// that looks like a different kind of number: a bot that started yesterday, restarted, or was away for a week produces
// a tally of the same shape as a complete one, and a bot that was never absent cannot prove it was never absent. J19
// answered with a coverage label on every number. REP answers it structurally instead: the bot fills in what it
// missed within its window (ruling 20), never publishes a table it has no base for (ruling 32, Q4), and a device shows
// NO number rather than a partial one. The coverage label itself is superseded for the UI (ruling 32, Q6): no
// "counted since" anywhere on screen; the summary keeps `since` for the bot's own bookkeeping.
//
// ── THE RULES IN THIS FILE ──────────────────────────────────────────────────────────────────────────────────────────
//   WHAT COUNTS     a vote or save counts when it names a PLAYING in song history (the reducer's own acceptance rule
//                   for a reaction: one naming a play that never became a playing is refused), that playing is at or
//                   after the cut, the reacting person passes the reducer's eligibility, and it is the FIRST
//                   (person, playing, kind) — the fold's own dedup, which makes that key the receipt (the design's
//                   C11). `ddjp.count.set` never counts (C16). One per person per PLAYING, never per song (C15).
//   THE CUT         a summary is cut at the play that started the then-current song. Everything on earlier playings is
//                   in the summary; everything on that playing and later is counted forward. A late reaction on an
//                   earlier playing is ignored by everyone, the bot included — at worst a rare late vote is missed,
//                   never one counted twice.
//   THE SPLIT       six numbers per person, kept apart (ruling 26): vg vr sg sr (on other people's playings), sv ss
//                   (on one's own). `shown` applies the room's CURRENT settings, so a settings change shows at once,
//                   for past and future alike. A self-vote with the setting on counts as given AND received (+2 REP).
//   THE MESSAGES    the summary and the addition, their encoding, validation and the size budget (ruling 28); which
//                   message a reader believes (top-level, the owner-level channel, a sender at 99 or above). The fields
//                   a body may not carry are the transport's list, handed in (ruling 46) and never kept here.
const RepRules = (() => {
  const VERSION = 1;
  const TYPES = Object.freeze({ summary: "ddjp.side.rep.summary", addition: "ddjp.side.rep.add" });
  // A reaction's kind, from its type. Only these two count; `ddjp.count.set` is deliberately absent.
  const KIND = Object.freeze({ "ddjp.dj.vote": "v", "ddjp.dj.save": "s" });
  // CODE CONSTANTS (the owner's rulings 24, 25, 28; J84). Not settings: they bound every device's cost,
  // and a value on one bot device would change everyone's load with nobody able to see it.
  const LIMITS = Object.freeze({
    budgetBytes: 60000,       // a message's content, as sent, under Matrix's 65,536-byte event limit with room for the envelope
    spacingMs: 5000,          // at least this long between any two REP messages (ruling 25)
    freshAfterPeople: 20,     // after this many PEOPLE added since the summary, a fresh summary instead (ruling 25; Q3)
    refreshFactor: 1.5,       // an unchanged summary is still sent once the last is this many intervals old (C12)
    lookbackFactor: 2,        // devices look back this many summary intervals for the latest summary (ruling 24)
    minIntervalMs: 30 * 60 * 1000,   // REP's least summary interval: a room set shorter is read as this (the owner, ddjp_644)
    heldUnknown: 500,         // reactions naming a playing song history has not shown yet, held at most
  });
  // Fields the transport stamps or a relayed act carries. A REP body never uses one (C23): `sendEvent` overwrites `t`.
  // THE LIST IS THE TRANSPORT'S, NOT THIS FILE'S (the owner's ruling 46, J103): `readSummary` and `readAddition` are handed
  // it (`RepPorts.sideReserved`, the transport's `sideReserved`, beside the refusal a side message is SENT by) and keep no
  // copy, so what may be sent and what a reader believes cannot drift apart. Handed none, they refuse.
  // What the transport stamps on EVERY message it sends (`sendEvent`: the type, the position, the wire and hash versions) —
  // a reader takes exactly these off before validating (J84-3); any other reserved field is still refused.
  const STAMPED = Object.freeze(["t", "l", "dv", "hv"]);
  // TRUST (J84-3; code, never a setting): believed only as a top-level event on the owner-level channel from a
  // sender at this level or above — the bot at 99, the owner above it.
  const TRUST = Object.freeze({ channel: "events_owner", minLevel: 99 });

  const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const _isInt = (n) => typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  const _isUser = (u) => typeof u === "string" && u.length >= 3 && u.length <= 255 && u.charAt(0) === "@" && u.indexOf(":") > 1;
  const _isId = (s) => typeof s === "string" && s.length > 0 && s.length <= 300;

  // ── WHAT COUNTS ───────────────────────────────────────────────────────────────────────────────────────────────────
  function kindOf(type) { return (typeof type === "string" && _own(KIND, type)) ? KIND[type] : null; }

  // Playings are ordered as song history orders them: by position, then by id — the reducer's own key.
  function compareAt(aL, aPi, bL, bPi) {
    if (aL !== bL) return aL < bL ? -1 : 1;
    return String(aPi) < String(bPi) ? -1 : (String(aPi) > String(bPi) ? 1 : 0);
  }
  // Is this playing at or after the cut? With no cut, everything is (a room counted from its start).
  function atOrAfterCut(playing, cut) {
    if (!cut) return true;
    if (!playing || typeof playing.l !== "number" || typeof cut.pos !== "number") return false;
    return compareAt(playing.l, playing.pi, cut.pos, cut.pi) >= 0;
  }

  // The receipt: the natural key of one reaction, the fold's own dedup (C11).
  function receiptOf(voter, pi, kind) { return voter + "\u0000" + pi + "\u0000" + kind; }

  // Judge one reaction. `reaction` { type, voter, pi }; `playing` song history's row for `pi`, or null; `cut` the active
  // cut, or null; `eligible` the reducer's eligibility answer for this voter (true unless asked and refused).
  function judge(reaction, playing, cut, eligible) {
    const r = reaction || {};
    const kind = kindOf(r.type);
    if (!kind) return { counts: false, why: "not a reaction" };
    if (!_isUser(r.voter)) return { counts: false, why: "no person" };
    if (!_isId(r.pi)) return { counts: false, why: "names no playing" };
    if (!playing || playing.pi !== r.pi) return { counts: false, why: "not a playing" };
    if (!atOrAfterCut(playing, cut)) return { counts: false, why: "before the cut" };
    if (eligible === false) return { counts: false, why: "not eligible" };
    return { counts: true, why: null, kind: kind, self: !!playing.dj && playing.dj === r.voter, dj: playing.dj || null };
  }

  // ── THE ACCUMULATOR: per playing at or after the cut ──────────────────────────────────────────────────────────────
  // `byPi[pi]` = { dj, l, v: {voter: 1}, s: {saver: 1} }. Both sides keep one; the receipts ARE its voter sets.
  function newAccumulator() { return { byPi: Object.create(null), held: [] }; }
  // Add a reaction. Returns { added, why }. A second reaction with the same receipt changes nothing.
  function add(acc, reaction, playing, cut, eligible) {
    const v = judge(reaction, playing, cut, eligible);
    if (!v.counts) return { added: false, why: v.why };
    const pi = reaction.pi;
    if (!acc.byPi[pi]) acc.byPi[pi] = { dj: playing.dj || null, l: playing.l, v: Object.create(null), s: Object.create(null) };
    const set = acc.byPi[pi][v.kind];
    if (set[reaction.voter]) return { added: false, why: "already counted" };
    set[reaction.voter] = 1;
    return { added: true, why: null, self: v.self };
  }
  function has(acc, voter, pi, kind) { const p = acc && acc.byPi[pi]; return !!(p && p[kind] && p[kind][voter]); }

  // The six-number split each person earns from what an accumulator holds.
  function zero() { return [0, 0, 0, 0, 0, 0]; }
  function plus(a, b) { const o = zero(); for (let i = 0; i < 6; i++) o[i] = (a && a[i] || 0) + (b && b[i] || 0); return o; }
  function contributions(acc) {
    const out = Object.create(null);
    const bump = (u, i) => { if (!out[u]) out[u] = zero(); out[u][i]++; };
    for (const pi of Object.keys(acc ? acc.byPi : {})) {
      const p = acc.byPi[pi];
      for (const k of ["v", "s"]) {
        for (const u of Object.keys(p[k])) {
          const given = k === "v" ? 0 : 2, received = k === "v" ? 1 : 3, self = k === "v" ? 4 : 5;
          if (p.dj && u === p.dj) bump(u, self);
          else { bump(u, given); if (p.dj) bump(p.dj, received); }
        }
      }
    }
    return out;
  }
  // The same sums, each person credited only for playings at or after THEIR OWN cut (`cutOf(user)` → a cut; null or
  // undefined for someone with no known cut, who is credited nothing): a table rebuilt from messages cut at different
  // songs (J84-4). The voter's half and the DJ's half of one reaction are judged apart.
  function contributionsFrom(acc, cutOf) {
    const out = Object.create(null);
    const bump = (u, i, p, pi) => {
      const c = (typeof cutOf === "function") ? cutOf(u) : null;
      if (!c || !atOrAfterCut({ pi: pi, l: p.l }, c)) return;
      if (!out[u]) out[u] = zero();
      out[u][i]++;
    };
    for (const pi of Object.keys(acc ? acc.byPi : {})) {
      const p = acc.byPi[pi];
      for (const k of ["v", "s"]) {
        for (const u of Object.keys(p[k])) {
          const given = k === "v" ? 0 : 2, received = k === "v" ? 1 : 3, self = k === "v" ? 4 : 5;
          if (p.dj && u === p.dj) bump(u, self, p, pi);
          else { bump(u, given, p, pi); if (p.dj) bump(p.dj, received, p, pi); }
        }
      }
    }
    return out;
  }

  // ── WHAT IS SHOWN: the split under the room's CURRENT settings (ruling 26) ────────────────────────────────────────
  function shown(split, settings) {
    const s = settings || {};
    const x = split || zero();
    const sv = s.repSelfVotes === true ? (x[4] || 0) : 0;
    const ss = s.repSelfSaves === true ? (x[5] || 0) : 0;
    const VG = (x[0] || 0) + sv, VR = (x[1] || 0) + sv, SG = (x[2] || 0) + ss, SR = (x[3] || 0) + ss;
    return { VG: VG, VR: VR, SG: SG, SR: SR, REP: VG + VR };
  }

  // ── THE MESSAGES ──────────────────────────────────────────────────────────────────────────────────────────────────
  // A row on the wire: [user, vg, vr, sg, sr, sv, ss] with trailing zeros dropped.
  function encodeRow(user, split) {
    const n = (split || zero()).slice(0, 6).map((v) => (_isInt(v) ? v : 0));
    while (n.length && n[n.length - 1] === 0) n.pop();
    return [user].concat(n);
  }
  function decodeRow(row) {
    if (!Array.isArray(row) || row.length < 1 || row.length > 7 || !_isUser(row[0])) return null;
    const split = zero();
    for (let i = 1; i < row.length; i++) { if (!_isInt(row[i])) return null; split[i - 1] = row[i]; }
    return { user: row[0], split: split };
  }
  function _cutOk(c) { return !!c && typeof c === "object" && _isId(c.pi) && _isInt(c.pos); }
  function _noReserved(b, reserved) { for (const k of reserved) if (_own(b, k)) return false; return true; }
  function _rows(rows) {
    if (!Array.isArray(rows)) return null;
    const out = [], seen = Object.create(null);
    for (const r of rows) { const d = decodeRow(r); if (!d || seen[d.user]) return null; seen[d.user] = 1; out.push(d); }
    return out;
  }

  function summary(o) {
    return { v: VERSION, n: o.n, cut: { pi: o.cut.pi, pos: o.cut.pos }, since: (typeof o.since === "number") ? o.since : null,
      rows: (o.rows || []).map((r) => encodeRow(r.user, r.split)), more: o.more || 0 };
  }
  function addition(o) {
    return { v: VERSION, of: o.of, n: o.n, k: o.k, rows: (o.rows || []).map((r) => encodeRow(r.user, r.split)) };
  }
  // Validate a summary body against `reserved`, the transport's list of fields a side message may not carry (ruling 46).
  // Returns { ok, why, value: { n, cut, since, rows: [{user, split}], more } }.
  function readSummary(body, reserved) {
    const b = body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, why: "not an object" };
    if (!Array.isArray(reserved)) return { ok: false, why: "no reserved-field list" };   // never read unchecked
    if (b.v !== VERSION) return { ok: false, why: "unknown version" };
    if (!_noReserved(b, reserved)) return { ok: false, why: "a reserved field" };
    if (!_isInt(b.n)) return { ok: false, why: "no serial" };
    if (!_cutOk(b.cut)) return { ok: false, why: "no cut" };
    if (!(b.since === null || _isInt(b.since))) return { ok: false, why: "bad since" };
    if (!_isInt(b.more)) return { ok: false, why: "bad more" };
    const rows = _rows(b.rows);
    if (!rows) return { ok: false, why: "bad rows" };
    return { ok: true, why: null, value: { n: b.n, cut: { pi: b.cut.pi, pos: b.cut.pos }, since: b.since, rows: rows, more: b.more } };
  }
  function readAddition(body, reserved) {
    const b = body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, why: "not an object" };
    if (!Array.isArray(reserved)) return { ok: false, why: "no reserved-field list" };   // never read unchecked
    if (b.v !== VERSION) return { ok: false, why: "unknown version" };
    if (!_noReserved(b, reserved)) return { ok: false, why: "a reserved field" };
    if (!_isId(b.of) || !_isInt(b.n) || !_isInt(b.k) || b.k < 1) return { ok: false, why: "names no summary" };
    const rows = _rows(b.rows);
    if (!rows) return { ok: false, why: "bad rows" };
    return { ok: true, why: null, value: { of: b.of, n: b.n, k: b.k, rows: rows } };
  }

  // A message as it arrived, without what the transport stamped on it (`STAMPED`), for `readSummary` / `readAddition`.
  function unstamp(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const o = {};
    for (const k of Object.keys(body)) if (STAMPED.indexOf(k) < 0) o[k] = body[k];
    return o;
  }
  // Is a REP message, as a reader received it, one to believe (`TRUST`)? `m` { channel: the key of the channel it arrived
  // on, or null; id: its event id; level: its sender's level }. A relay batch's member is named `<carrier>#<k>` and never
  // stands as its own event; a Matrix event id never holds a "#".
  function trust(m) {
    const x = m || {};
    if (x.channel !== TRUST.channel) return { ok: false, why: "not the owner-level channel" };
    if (typeof x.id !== "string" || !x.id || x.id.indexOf("#") >= 0) return { ok: false, why: "not a top-level event (a batch member)" };
    if (typeof x.level !== "number" || !(x.level >= TRUST.minLevel)) return { ok: false, why: "its sender is below level " + TRUST.minLevel };
    return { ok: true, why: null };
  }
  // Of two summaries, which is newer: the higher serial, then the later position (ruling: newest wins).
  function newer(a, b) {
    if (!a) return b || null; if (!b) return a;
    if (a.n !== b.n) return a.n > b.n ? a : b;
    return (a.l || 0) >= (b.l || 0) ? a : b;
  }
  // Who a summary and its additions publish, each person's split AS OF the summary's cut. An addition that names
  // another summary is not applied; within one summary a later addition's row for a person replaces an earlier one.
  // `sum` is `readSummary(body, reserved).value` with the event's own `id` and position `l` attached by whoever read it.
  function published(sum, additions) {
    const out = Object.create(null);
    if (!sum) return out;
    for (const r of sum.rows) out[r.user] = r.split.slice();
    const mine = (additions || []).filter((a) => a && a.of === sum.id && a.n === sum.n).sort((x, y) => x.k - y.k);
    for (const a of mine) for (const r of a.rows) out[r.user] = r.split.slice();
    return out;
  }

  // ── THE SIZE BUDGET (ruling 28) ───────────────────────────────────────────────────────────────────────────────────
  // UTF-8 bytes of a string, computed rather than encoded, so this file needs no global.
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
  // Rows highest REP first (by the CURRENT settings), then by id: the order a summary carries and cuts from.
  function byRep(rows, settings) {
    return rows.slice().sort((a, b) => {
      const d = shown(b.split, settings).REP - shown(a.split, settings).REP;
      return d !== 0 ? d : (a.user < b.user ? -1 : (a.user > b.user ? 1 : 0));
    });
  }
  // Fit a summary under the budget: keep the highest-REP rows that fit, and say how many were left out.
  function fitSummary(o, settings) {
    const ordered = byRep(o.rows || [], settings);
    const make = (k) => summary(Object.assign({}, o, { rows: ordered.slice(0, k), more: ordered.length - k }));
    if (sentBytes(TYPES.summary, make(ordered.length)) <= LIMITS.budgetBytes) return { body: make(ordered.length), kept: ordered.length, more: 0 };
    let lo = 0, hi = ordered.length;   // the largest k that fits
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sentBytes(TYPES.summary, make(mid)) <= LIMITS.budgetBytes) lo = mid; else hi = mid - 1; }
    const body = make(lo);
    return { body: body, kept: lo, more: ordered.length - lo, lowestKept: lo ? shown(ordered[lo - 1].split, settings).REP : null };
  }

  // ── THE SUMMARY INTERVAL REP USES (the owner, `ddjp_644`) ─────────────────────────────────────────────────────────────
  // The room's `repSummaryMs`, read as at least `LIMITS.minIntervalMs`. ONE reading for both sides — the bot's cadence and a
  // device's two-interval look-back — so they cannot read the setting apart: the bot never sends faster, and a device looks
  // back over the same number. The fold is not changed: a room set at 10 min still folds to 10 in every build, because
  // `SETTING_RANGES.repSummaryMs` keeps its 10-minute floor (a changed range would make old and new builds fold one settings
  // event two ways). No usable value, `null`, as before.
  function intervalOf(settings) {
    const v = settings ? settings.repSummaryMs : null;
    if (!(typeof v === "number" && isFinite(v) && v > 0)) return null;
    return Math.max(v, LIMITS.minIntervalMs);
  }

  return {
    VERSION, TYPES, KIND, LIMITS, STAMPED, TRUST, intervalOf,
    kindOf, compareAt, atOrAfterCut, receiptOf, judge,
    newAccumulator, add, has, zero, plus, contributions, contributionsFrom,
    shown, encodeRow, decodeRow, summary, addition, readSummary, readAddition, unstamp, trust, newer, published,
    utf8Bytes, sentBytes, fitSummary,
  };
})();
