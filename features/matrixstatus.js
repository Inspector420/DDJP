// features/matrixstatus.js — THE STATUS PIECE: where things stand with Matrix, for your picture's ring and its menu (`ddjp_697`)
//
// The owner's plan, part 3 ("Rate limits"; `main/05-matrix.md` §Slow-downs you can see). One small module with NO UI: it holds
// the state and answers `state()` and `onChange(fn)`; NOTHING ELSE HOLDS THIS STATE. The transport tells it what happened — the
// one send pacer's `onPace` (a push-back, a landing, how many sends are held) and the SDK's own sync state (`onSyncState`) —
// and the room tells it when a rank may have moved (`Room.onRankChange`). The UI reads only this (`ui/base.js` `statusRing`,
// `statusMenu`); nothing here touches the page, and nothing here is sent to learn anything.
//
// THE ONE TABLE OF KINDS (`KINDS`) is the only place their keys and labels live: every send site in the transport names one of
// these keys (`// kind: <key>`, `check-matrix-status` PART K), and every line in the menu is one of these rows.
//
// THE ORANGE RULE, per kind (the supervisor's answer to his "we dont want it to be green instantly and go back to orange
// consistantly, but we also dont want it orang eif all is good"): "Waiting N s" while the server's `retry_after` runs; then
// "Slowed N s ago" until a minute has passed since the later of that kind's last push-back and the end of its wait (`ddjp_698`,
// 697's decision 6 reversed: a wait over a minute is still followed by a calm minute); then "OK". A new push-back starts it again.
// AT MOST ONE TIMER: it ticks the countdown once a second while a line is orange, and stops when none is.
//
// "Matrix" FROM THE SDK'S OWN SYNC STATE ONLY (his "only if we have a clear way to say the state that is accurate and dosent
// spam"): SYNCING / PREPARED / CATCHUP → "Online"; ERROR / STOPPED → "Offline" (orange — red is only My Rank, his correction);
// RECONNECTING keeps the last answer, so a hiccup never flips it. "My Rank" from `Room.rankStanding(me).ring` — "Out of specs"
// (red) where the ring rings today, else "In specs" (green; `ddjp_702`) — and only while a room is open.
const MatrixStatus = (() => {
  // ── THE ONE TABLE OF KINDS ──────────────────────────────────────────────────────────────────────────────────────────────
  // `sends`: what goes out under it — said here once, for the docs and the report; the transport's `// kind:` tags name the key.
  // THE MENU'S ORDER IS THIS TABLE'S (`ddjp_702`, the owner's: "lets put room actions & chat above user rank & invites and for this
  // one lets ranme it Actions & Chat", then "makybe in status change  user Rank & invite to User Ranking & Invite" — plural, to
  // match "Upgrades", the supervisor's default). Keys and rules unchanged: only labels and order moved.
  const KINDS = Object.freeze([
    Object.freeze({ key: "connection", label: "Matrix" }),
    Object.freeze({ key: "myRank", label: "My Rank", room: true }),
    Object.freeze({ key: "actions", label: "Actions & Chat", sends: "chat and DM messages, deletions, every room event: queue, votes, skips, settings, checkpoints, the bot's sends" }),
    Object.freeze({ key: "ranks", label: "User Ranking & Invites", sends: "rank changes and their repair, invites to a room, the reconcile's channel invites, the presence chat's admits (and its removals)" }),
    Object.freeze({ key: "membership", label: "Room Joining & Leaving", sends: "joins, leaves, declines; a moderator's kicks and bans" }),
    Object.freeze({ key: "build", label: "Room Build & Upgrades", sends: "making a room, upgrade batches, Repair's channels, adding a channel to its Space" }),
  ]);
  const SEND_KINDS = KINDS.filter((k) => k.sends).map((k) => k.key);
  const SLOWED_MS = 60000;   // the one minute: "Slowed" until this long after a kind's last push-back or the end of its wait, the later
  const TICK_MS = 1000;      // the countdown's tick, while a line is orange

  // What each send kind last saw: when the server last pushed back, until when its `retry_after` runs, how many are held.
  const _kinds = Object.create(null);
  for (const k of SEND_KINDS) _kinds[k] = { pushedAt: null, until: 0, held: 0 };
  let _conn = null;          // "Online" | "Offline" | null (no answer from the SDK yet)
  const _listeners = [];
  let _now = () => Date.now();
  let _later = (fn, ms) => setTimeout(fn, ms), _unlater = (h) => clearTimeout(h);
  let _timer = null;
  let _wired = false;

  // ── THE MAPPINGS, PURE (a guard drives each) ────────────────────────────────────────────────────────────────────────────
  // The SDK's sync state → the "Matrix" line. RECONNECTING, and anything this does not name, keeps `last`.
  function connectionFrom(syncState, last) {
    if (syncState === "SYNCING" || syncState === "PREPARED" || syncState === "CATCHUP") return "Online";
    if (syncState === "ERROR" || syncState === "STOPPED") return "Offline";
    return (last === "Online" || last === "Offline") ? last : null;
  }
  // One send kind's line at `now`: the orange rule. The calm minute counts from the later of the push-back and its wait's end.
  function lineFrom(k, now) {
    if (!k || typeof k.pushedAt !== "number") return { state: "OK", tone: "ok", text: "OK" };
    if (k.until > now) { const n = Math.ceil((k.until - now) / 1000); return { state: "Waiting", tone: "warn", secs: n, text: "Waiting " + n + " s" }; }
    const ago = now - Math.max(k.pushedAt, k.until || 0);
    if (ago < SLOWED_MS) { const n = Math.max(0, Math.floor(ago / 1000)); return { state: "Slowed", tone: "warn", secs: n, text: "Slowed " + n + " s ago" }; }
    return { state: "OK", tone: "ok", text: "OK" };
  }
  // The ring from the lines: red only for My Rank out of spec; orange for any other line not OK (Offline included); both, the
  // diagonal; else green.
  function ringFrom(lines) {
    let red = false, orange = false;
    for (const l of lines) {
      if (l.key === "myRank") { if (l.tone === "bad") red = true; }
      else if (l.tone !== "ok") orange = true;
    }
    return red && orange ? "both" : red ? "red" : orange ? "orange" : "green";
  }

  // ── THE STATE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  function _myRankLine() {
    try {
      if (typeof Room === "undefined" || !Room.rankStanding || !Room.getMyId) return null;
      const me = Room.getMyId();
      const st = me ? Room.rankStanding(me) : null;
      if (!st) return null;   // no room open: no line
      // ITS TWO WORDS (`ddjp_702`, the owner's: "lets change my rank from OK to In specs and out of spec to out of specs in red"):
      // "In specs", green; "Out of specs", red. Where the ring rings is unchanged.
      return st.ring ? { state: "Out of specs", tone: "bad", text: "Out of specs" } : { state: "In specs", tone: "ok", text: "In specs" };
    } catch (e) { return null; }
  }
  // `{ lines: [{ key, label, state, tone, text, secs? }], ring, chat }`. `opts.rank === false` leaves My Rank out (the room
  // list's menu); without a room open it is out anyway. `chat`: the held messages' note, or null.
  function state(opts) {
    _wire();
    const now = _now();
    if (_conn === null) _conn = connectionFrom(_syncNow(), null);
    const lines = [];
    for (const def of KINDS) {
      let l = null;
      if (def.key === "connection") {
        const c = _conn || "Online";   // before the SDK's first answer: nothing to say is wrong (decision 6)
        l = c === "Online" ? { state: "Online", tone: "ok", text: "Online" } : { state: "Offline", tone: "warn", text: "Offline" };
      } else if (def.key === "myRank") {
        if (opts && opts.rank === false) continue;
        l = _myRankLine();
        if (!l) continue;
      } else {
        l = lineFrom(_kinds[def.key], now);
      }
      lines.push(Object.assign({ key: def.key, label: def.label }, l));
    }
    const a = _kinds.actions, held = a ? a.held : 0;
    const chat = held > 0
      ? { held: held, secs: Math.max(1, Math.ceil(Math.max(0, a.until - now) / 1000)) }
      : null;
    return { lines: lines, ring: ringFrom(lines), chat: chat };
  }
  // A wait, said where it happens (JOB 4): how long a send of `kind` waits on the server now, in whole seconds; 0 when none.
  function waitingSecs(kind) {
    const k = _kinds[kind];
    if (!k) return 0;
    const left = k.until - _now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }
  function onChange(fn) { _wire(); if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }
  function offChange(fn) { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }
  function _fire() {
    _tick();
    for (const fn of _listeners.slice()) { try { fn(); } catch (e) {} }
  }
  // THE ONE TIMER: armed while any send line is orange, gone when none is.
  function _anyOrange() {
    const now = _now();
    for (const k of SEND_KINDS) if (lineFrom(_kinds[k], now).tone !== "ok") return true;
    return false;
  }
  function _tick() {
    if (_anyOrange()) {
      if (_timer === null) _timer = _later(() => { _timer = null; _fire(); }, TICK_MS);
    } else if (_timer !== null) { try { _unlater(_timer); } catch (e) {} _timer = null; }
  }

  // ── WHAT THE TRANSPORT AND THE ROOM TELL ────────────────────────────────────────────────────────────────────────────────
  function _onPace(e) {
    const k = e && _kinds[e.kind];
    if (!k) return;
    const at = (typeof e.at === "number") ? e.at : _now();
    if (e.what === "pushed") {
      k.pushedAt = at;
      const ra = (typeof e.retryAfterMs === "number" && e.retryAfterMs > 0) ? e.retryAfterMs : 0;
      k.until = Math.max(k.until, at + ra);
      _fire();
    } else if (e.what === "held") {
      const n = (typeof e.n === "number" && e.n >= 0) ? e.n : 0;
      if (n !== k.held) { k.held = n; _fire(); }
    }
    // "landed" changes no line: the minute is the rule, not the next answer.
  }
  function _onSync(syncState) {
    const c = connectionFrom(syncState, _conn);
    if (c !== _conn) { _conn = c; _fire(); }
  }
  function _syncNow() {
    try { return (typeof MatrixBridge !== "undefined" && MatrixBridge.syncState) ? MatrixBridge.syncState() : null; } catch (e) { return null; }
  }
  function _wire() {
    if (_wired) return;
    if (typeof MatrixBridge === "undefined" || typeof MatrixBridge.onPace !== "function") return;
    _wired = true;
    MatrixBridge.onPace(_onPace);
    if (typeof MatrixBridge.onSyncState === "function") MatrixBridge.onSyncState(_onSync);
    try { if (typeof Room !== "undefined" && Room.onRankChange) Room.onRankChange(() => _fire()); } catch (e) {}
  }
  _wire();

  return {
    KINDS, state, onChange, offChange, waitingSecs,
    connectionFrom, lineFrom, ringFrom, SLOWED_MS,
    // Guard seams: the clock and its one timer; what the transport would tell.
    _setClockForTest: function (now, later, unlater) { if (now) _now = now; if (later) _later = later; if (unlater) _unlater = unlater; } /* exposed for the guard */,
    _tellForTest: function (e) { _onPace(e); } /* exposed for the guard */,
    _syncForTest: function (s) { _onSync(s); } /* exposed for the guard */,
    _resetForTest: function () { for (const k of SEND_KINDS) _kinds[k] = { pushedAt: null, until: 0, held: 0 }; _conn = null; if (_timer !== null) { try { _unlater(_timer); } catch (e) {} } _timer = null; } /* exposed for the guard */,
    _timerForTest: function () { return _timer !== null; } /* exposed for the guard */,
  };
})();
