// backends/backend2/runner.js — the loop that drives the runner (J24).
//
// `authority.js` decides and queues; nothing drove it. This is what drives it: read intents from
// `events-uncategorized`, evaluate each, stamp what stands, and write it to `events-owner` where
// every client folds it.
//
// ── THE GATE, AND WHY IT IS NOT "OWNER-TIER" ──────────────────────────────────────────────────
// Exactly one client in the room may run this. If two did, both would republish the same intents
// and the room would see every act twice.
//
// The gate is the ladder's TOP RUNG EXACTLY, and this file does not invent that rule: it is the one
// `features/botruntime.js` already uses, derived from `Ranks.levelOf("owner")` rather than written
// as a literal, so there is one home for it and not two. Reusing it matters more than usual here,
// because the reason behind it was measured rather than reasoned:
//
//   `Ranks.LADDER` tops out at 99, so `nameOf` SATURATES — every level at or above 99 answers
//   "owner", and `atLeast(100, "owner")` is true. A rank CHECK therefore admits the human owner's
//   own tab as well as the bot. That puts two authorities on the settings channel, and settings are
//   LAST-WRITE-WINS OVER A WHOLE BLOB: two concurrent writers do not merge, they overwrite, and the
//   loser's change vanishes with nothing anywhere reporting it.
//
// **This is why the human owner must sit at 100 and the bot at exactly 99.** It does not conflict
// with two writers being permitted on `events-owner` — the log is ordered, so a tie there is broken
// by position and every client breaks it the same way (`checkpoint.js`). Settings have no such
// ordering, which is exactly why the gate is narrow.
//
// AND THE LEVEL COMES FROM THE SERVER. `getMyPowerLevel` returns what `m.room.power_levels` says.
// Authority here is proved by what Matrix says and never by a client's claim about itself.
//
// ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────────────────────────
// It publishes no refusals. A client works out for itself what it may ask for, and the runner
// reaches the same verdict from the same two inputs — that is `authority.js`'s whole contract, and
// a refusal path here would quietly become the second one. An intent that does not stand is simply
// not republished, and the asking client's screen does not change, which is what it would have
// shown anyway had the act been impossible.

const B2Runner = (() => {
  // The engine this runner belongs to. Named here because a backend may name itself — the rule that
  // nothing may name a concrete engine applies ABOVE the seam, not inside one.
  const MODE = "backend2";

  let _on = false;
  let _ch = null;
  // `_rawBridge` — the `MatrixBridge` shell `_onRaw` was subscribed through. The shell's identity never changes across binds
  // (`Backends._fill`), and at the reset that stops the runner it is still bound to the bot engine, so `stop`'s unsubscribe
  // reaches the bridge `start` subscribed to (reworded at the `ddjp_572` audit, D10).
  let _rawBridge = null;
  let _timer = null;
  let _oneShot = null;   // the one opening scheduled for when the spacing ends (J76)
  let _gate = null;      // THE GATE'S TIMER (J76): the only caller of B2Authority.tick, every POLICY.gate.intervalMs
  let _beat = null;
  let _spaceId = null;
  let _seen = 0;
  let _stood = 0;
  let _failed = 0;
  let _announced = false;
  let _lastSeal = 0;
  let _lastSealL = null;     // the head position this runner last sealed at — a position, never a tally
  let _sealedN = null;       // the `n` it last sent, so a seal in flight is recognised until it is adopted
  let _held = [];            // intents seen while this client could not write
  let _dropped = 0;
  let _liveHookArmed = false;
  // EVERY REQUEST ENDS IN EXACTLY ONE OUTCOME (J65), and these count them: passed on, merged into
  // another, refused (answered "no"), too old (dropped unanswered, the asking app has given up), or
  // accepted and handled without a relay. `seen` = their sum + what is still waiting or held.
  let _refused = 0, _expired = 0, _absorbed = 0;
  // The newest SERVER stamp seen, and the LOCAL time it was seen: an act's age is that stamp minus
  // the act's own, plus local time since — a stamp-minus-stamp and a clock-minus-clock, never crossed.
  let _lastServerTs = null, _lastServerLocal = 0;  // the LIVE hook is subscribed once per page; it acts only while running
  // Bounded, like everything else this engine accumulates. A runner that is away for a very long
  // time keeps the most recent acts rather than the whole backlog, and SAYS how many it let go.
  const MAX_HELD_INTENTS = 200;

  // The ladder's top rung, derived. Not a literal here and not a second copy of the rule.
  function runnerLevel() {
    try { return Ranks.levelOf("owner"); } catch (e) { return null; }
  }

  // EXACTLY the rung — not `atLeast`, which saturates and would admit the human owner at 100.
  function isRunner(roomId) {
    const want = runnerLevel();
    if (want === null) return false;
    const got = MatrixBridge.getMyPowerLevel(roomId);
    return got === want;
  }

  function running() { return _on; }
  // Which room this runner belongs to — the one it last started in, and still names after it stops. Read-only (J80).
  function room() { return _ch ? { log: _ch.events_owner || null, intents: _ch.events_uncategorized || null, spaceId: _spaceId } : null; }

  // ── THE BOT RUNS EXACTLY WHILE THE TAB IS IN ITS ROOM (J80; the owner's ruling 18, `ddjp_574`, built in J83) ──────────────────
  // A room's processes run only while the tab is IN that room; the lobby runs none of them (ruling 18, which superseded ruling
  // 10's "a room keeps running on a tab that shows the lobby"). The runner follows the same switch: it is stopped by the engine
  // reset the ONE leave step makes (`features/room.js` `leave` -> `B2StreamManager.reset`), first and with this room's engine
  // still bound, on every way out — back to the lobby, a logout, a reload, a removal, and opening another room — so if what
  // ends a room's processing ever moves, the runner moves with it: `check-runner-room-change` P and `check-room-leave` hold the
  // two together. No bot-only lifecycle rule (ruling 12): the bot's tab leaves and stops exactly as any tab does.
  //
  // Before J80, `stop` had no caller outside the guards: live (`?v=524`) the bot's tab opened a shared room and the runner went
  // on reading the BOUND engine — the shared room's — and writing into its old room's log ("runner starting the first song",
  // then a seal of the shared room's state, which a young bot room would have opened from).
  //
  // THE SELF-CHECK, ON EVERY BEAT (the tick, the gate and its one-shot, the minute beat, an arriving message, a return to LIVE,
  // an act handed in): the bound engine is the bot engine and the fold scope it serves is this runner's log — or the tab has
  // left this room by a path that skipped the reset, and the runner stops and says so rather than write into a room the tab is
  // not in. Unreadable is not in its room.
  function _inItsRoom() {
    if (!_on) return false;
    let mode = null, log = null;
    try { mode = (typeof Backends !== "undefined" && Backends.active) ? Backends.active() : null; } catch (e) { mode = null; }
    try { const f = (typeof StreamManager !== "undefined" && StreamManager.foldScope) ? StreamManager.foldScope() : null; log = f ? f.log : null; }
    catch (e) { log = null; }
    if (mode === MODE && _ch && log && log === _ch.events_owner) return true;
    stop("this tab is no longer in its room");
    return false;
  }
  // ── THE BOT RUNS THE SONGS (J66) ───────────────────────────────────────────────────────────
  // The bot is the room's single authority, so it ends each song itself: at the FULL agreed
  // length (not the gate's earlier edge, which would cut every song's last second), for the first
  // song when someone is queued and nothing plays, and at the `maxLen` ceiling when no length was
  // agreed. Apps keep a BACKUP advance, sent only when a song is well overdue (the transport's
  // `advanceBackupMs`), so a sleeping bot cannot freeze the room. Timed on SERVER time — the newest
  // stamp seen plus local time since — checked on the runner's beat and on every arriving message.
  // No margin past the end (J72, owner): the room already accepts an advance up to its grace before
  // the end, and players switch only when the message reaches them — so "at the end" cannot cut a
  // song. The margin only made every change late.
  const ADVANCE_RETRY_MS = 5000;
  const LEN_DISAGREE_SEC = 2;
  let _advSent = null;            // { key, at, id, echoAt } — one advance in flight per song
  let _lenPassed = Object.create(null);
  let _ownSeq = 0;
  function _serverNow() {
    if (_offset !== null) return Date.now() + _offset;
    return (_lastServerTs === null) ? null : _lastServerTs + (Date.now() - _lastServerLocal);
  }
  function _advanceDue(st, now) {
    const np = st && st.nowPlaying;
    if (!np || !np.pi) {
      const someone = ((st && st.rotation) || []).some((r) => r && Array.isArray(r.pending) && r.pending.length > 0);
      return someone ? { p: null, key: "genesis", at: now } : null;
    }
    const a = (st.advance && st.advance.pi === np.pi) ? st.advance : null;
    if (!a || typeof np.startedAt !== "number") return null;
    if (typeof a.gateLenSec === "number" && a.gateLenSec > 0) {
      return { p: np.pi, key: np.pi, at: np.startedAt + a.gateLenSec * 1000 };
    }
    if (typeof a.ceilingAt === "number") return { p: np.pi, key: np.pi, at: a.ceilingAt };
    return null;
  }
  function _advanceTick() {
    if (!_on || !_announced || !_mayAuthor()) return;
    const now = _serverNow();
    if (now === null) return;
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return; }
    const due = _advanceDue(st, now);
    if (!due || now < due.at) return;
    // RETRY ONLY WHEN THE FIRST ONE IS KNOWN TO HAVE FAILED (J72). It retried 5 s after sending,
    // and the bot's tab often sees its own messages back later than that — so the retry arrived
    // after the first had moved the room, and read "refused" in the feed. Now: once its advance
    // has come back and the room still has not moved, it was refused (too early) — retry after
    // ADVANCE_RETRY_MS; if it never comes back, retry after the answer window.
    if (_advSent && _advSent.key === due.key) {
      const echoed = _advSent.echoAt !== null;
      const since = Date.now() - (echoed ? _advSent.echoAt : _advSent.at);
      const wait = echoed ? ADVANCE_RETRY_MS : ((B2Authority.POLICY && B2Authority.POLICY.answerWindowMs) || 20000);
      if (since < wait) return;
    }
    const mine = { key: due.key, at: Date.now(), id: null, echoAt: null };
    _advSent = mine;
    _say(due.p ? "ending the song " + due.p : "starting the first song");
    let me = null;
    try { me = MatrixBridge.getUserId(); } catch (e) { me = null; }
    const r = B2Authority.submit(B2Authority.stamp({ t: "ddjp.dj.play", p: due.p }, me, Ranks.levelOf("owner"), null, null));
    _openSoon();   // J76: what was just submitted goes at its first trigger
    if (r && r.promise && typeof r.promise.then === "function") {
      r.promise.then(function (res) {
        if (!res || !(res.eventId || res.carrier)) return;
        mine.id = res.eventId || res.carrier;                   // `carrier#k` when the play travelled in a batch (J76)
        mine.carrier = res.carrier || res.eventId;              // the message that carried it: what its echo is (J77)
        const e = _echoLocal.get(res.carrier || res.eventId);
        if (e && mine.echoAt === null) mine.echoAt = e.at;
      }, function () {});
    }
  }

  // THE BOT'S OWN ACTS GO STRAIGHT IN (J66). An idle removal or repeat skip used to go out as an
  // intent and come back to be relayed — two messages for one act. The transport hands the
  // runner's own sends to this instead: same judging, same holding while not live, one message.
  // The id it returns stands in for the intent's, so the relay's `src` still answers the asker.
  function takesOwn() { return _on === true && _inItsRoom(); }   // an act handed in is a beat too (J80)
  function submitOwn(type, content) {
    const id = "$own-" + (++_ownSeq) + "-" + Date.now();
    let me = null;
    try { me = MatrixBridge.getUserId(); } catch (e) { me = null; }
    const body = Object.assign({}, content, { t: type, l: 0, dv: 2 });
    const now = _serverNow();
    _intake({ type: "m.room.message", event_id: id, room_id: _ch.events_uncategorized, sender: me,
              ts: (now === null) ? Date.now() : now, content: { body: JSON.stringify(body) },
              ddjpType: type, ddjpBody: body, own: true });
    return { eventId: id, l: 0 };
  }

  // ── THE NEXT SAVE POINT, ON TOP OF THE ONE THIS ROOM OPENED FROM (J67) ──────────────────────
  // A room opened from a save point no longer holds its start, so the seed is built from that save
  // point's seed (`StreamManager.floorSeed()`, null when the room was loaded whole) — built from an
  // empty start it would lose the queue. Checked before anyone is told to trust it: folding nothing
  // onto it must give back what the held log folds to from the same base (PILLARS §3).
  function _buildSealSeed(log) {
    let base;
    try { base = (StreamManager.floorSeed && StreamManager.floorSeed()) || undefined; } catch (e) { base = undefined; }
    let seed = null;
    try { seed = StateDeriver.buildSeed(log, base); } catch (e) { seed = null; }
    if (!seed) return null;
    try {
      const again = StateDeriver.derive([], seed);
      const whole = StateDeriver.derive(log, base);
      const q = (x) => JSON.stringify((x.rotation || []).map((r) => [r.user, (r.pending || []).map((p) => p.videoId)]));
      const np = (x) => (x.nowPlaying ? x.nowPlaying.pi : null);
      const same = q(again) === q(whole) && np(again) === np(whole) &&
                   JSON.stringify(again.settings || {}) === JSON.stringify(whole.settings || {});
      return same ? seed : null;
    } catch (e) { return null; }
  }

  function stats() {
    return { seen: _seen, stood: _stood, failed: _failed, held: _held.length, dropped: _dropped,
             pending: B2Authority.pending(), merged: B2Authority.merged(), refused: _refused,
             expired: _expired, absorbed: _absorbed };
  }
  function _noteServerTs(raw) {
    if (raw && typeof raw.ts === "number" && (_lastServerTs === null || raw.ts > _lastServerTs)) {
      _lastServerTs = raw.ts; _lastServerLocal = Date.now();
    }
  }
  function _ageOf(raw) {
    const now = _serverNow();
    if (!raw || typeof raw.ts !== "number" || now === null) return 0;
    return now - raw.ts;
  }

  // ── THE ROOM'S CLOCK, FROM THE BOT'S OWN ROUND TRIPS (J72) ─────────────────────────────────
  // "Newest stamp seen + local time since" lags by however long messages take to ARRIVE — about a
  // second on the owner's run, which made every song change late. The bot can do better: it sends
  // messages and sees them come back stamped, so offset = stamp − midpoint(sent, returned), kept
  // from the tightest round trip (NTP's rule). Round trips over RT_MAX_MS are ignored, which also
  // keeps out an echo the transport admitted with this device's clock after its 4-second wait.
  const RT_MAX_MS = 3500;
  const _sentLocal = new Map();   // own event id -> local send time
  const _echoLocal = new Map();   // own event id -> { ts, at } — an echo that beat its send's reply
  let _offset = null, _offsetRt = Infinity, _offsetAt = 0;
  function _sample(t0, t1, stamp) {
    const rt = t1 - t0;
    if (!(rt >= 0 && rt <= RT_MAX_MS) || typeof stamp !== "number") return;
    if (rt <= _offsetRt || (Date.now() - _offsetAt) > 300000) {
      _offset = stamp - (t0 + t1) / 2; _offsetRt = rt; _offsetAt = Date.now();
    }
  }
  function _noteOwnEcho(raw) {
    if (!raw || !raw.event_id || typeof raw.ts !== "number") return;
    let me = null;
    try { me = MatrixBridge.getUserId(); } catch (e) { me = null; }
    if (!me || raw.sender !== me) return;
    const now = Date.now();
    if (_sentLocal.has(raw.event_id)) { _sample(_sentLocal.get(raw.event_id), now, raw.ts); _sentLocal.delete(raw.event_id); }
    else _echoLocal.set(raw.event_id, { ts: raw.ts, at: now });
    // The advance's echo is its CARRIER coming back — its own message, or the batch that held it (J76). Matched on the
    // carrier's id, which the gate reports at send time, so it needs no knowledge of how members are named (J77).
    if (_advSent && _advSent.echoAt === null && (raw.event_id === _advSent.carrier || raw.event_id === _advSent.id)) _advSent.echoAt = now;
    while (_echoLocal.size > 50) _echoLocal.delete(_echoLocal.keys().next().value);
    while (_sentLocal.size > 50) _sentLocal.delete(_sentLocal.keys().next().value);
  }

  // ── STARTING ────────────────────────────────────────────────────────────────────────────────
  // `session` already owns *only a fully caught-up client may write anything*, and the runner is a
  // client that happens to hold authority, so it follows the same rule rather than a new one. The
  // caller starts this once the fold is live; from that point the runner consumes intents and
  // ignores everything said while it was gone — which is why there is no cursor here, no bookmark,
  // and no way to process an intent twice after a crash.
  //
  // ── EVERY GUARD FIRST, AND NOTHING CHANGES UNTIL ALL OF THEM PASS (J80) ──────────────────────────────────────────────────
  // This assigned `_ch` and `_spaceId` before its guards, so entering a bot room where this account is NOT the runner said
  // "runner not started" and left a running runner pointed at that room — writing into its log. Now the room it is asked to
  // run is held in locals until every guard has passed. A refusal while running STOPS the runner: whatever runs belongs to a
  // room this tab is no longer in. Already running for THIS log is "already"; for ANOTHER log it stops, then starts afresh —
  // announced in the new room, the gate reset, the old room's held intents dropped — never re-pointed.
  function start(opts) {
    const o = opts || {};
    const ch = o.channels || null;
    const spaceId = o.spaceId || null;
    const refuse = (r) => { if (_on) stop("the room this tab entered refused it: " + r.reason); return r; };
    if (!ch || !ch.events_uncategorized || !ch.events_owner) {
      return refuse({ ok: false, reason: "a runner needs both the intents and the log channels" });
    }
    // THE ROOM MUST BE A BOT-RUN ROOM, and this is checked before the rung. An earlier version
    // proved only "I hold the top rung", which is TRUE OF A BOT IN A SHARED ROOM TOO — backend1
    // rooms have an `events_owner` channel and a bot at 99 as well. Starting there would relay
    // intents into a room whose clients fold every channel, so every act would land twice: once as
    // the person authored it and once as the runner repeated it. Nothing calls `start` yet, which
    // is exactly why this is the moment to close it.
    const mode = (typeof Backends !== "undefined" && Backends.active) ? Backends.active() : null;
    if (mode !== MODE) {
      return refuse({ ok: false, reason: "this client is not running the bot-run engine", mode: mode });
    }
    // And the ROOM's own declaration agrees, when the space is known. The engine that is bound is a
    // fact about this client; the create-content marker is a fact about the room, and it is the one
    // that cannot be changed after creation.
    if (spaceId) {
      let declared = null;
      try { declared = Backends.resolveMode(MatrixBridge.getCreateContent(spaceId)); } catch (e) { declared = null; }
      if (declared !== MODE) {
        return refuse({ ok: false, reason: "this room does not declare the bot-run engine", declared: declared });
      }
    }
    if (!isRunner(ch.events_owner)) {
      return refuse({ ok: false, reason: "not the runner in this room", level: MatrixBridge.getMyPowerLevel(ch.events_owner) });
    }
    // A SEND TABLE THAT FAILS ITS OWN CHECK DOES NOT RUN (J65): a missing row or a wait longer than
    // the answer window would make the runner miss answers it promised.
    const bad = B2Authority.validatePolicy ? B2Authority.validatePolicy() : [];
    if (bad.length) return refuse({ ok: false, reason: "the send table fails its check: " + bad.join("; ") });
    if (_on && _ch && _ch.events_owner === ch.events_owner) return { ok: true, already: true };
    if (_on) stop("the tab entered another bot room");

    _ch = ch;
    _spaceId = spaceId;
    _on = true;
    _seen = 0; _stood = 0; _failed = 0; _announced = false; _held = []; _dropped = 0;
    _refused = 0; _expired = 0; _absorbed = 0; _lastServerTs = null; _lastServerLocal = 0;
    _advSent = null; _lenPassed = Object.create(null);
    _offset = null; _offsetRt = Infinity; _offsetAt = 0; _sentLocal.clear(); _echoLocal.clear();
    _lastSeal = 0; _lastSealL = null; _sealedN = null;
    B2Authority.reset();
    B2Authority.attach(function (type, payload) { return _write(type, payload); },
                       { windowMs: (o.windowMs || 1000) });
    _rawBridge = MatrixBridge;
    _rawBridge.onRawEvent(_onRaw);
    _say("listening for intents on " + _ch.events_uncategorized);
    // The schedule's clock side, on a short beat. It is ALSO run on every message that arrives
    // (`_onRaw`), because a background tab slows this timer but still receives messages (J65).
    _timer = setInterval(function () {
      if (!_inItsRoom()) return;
      try { _advanceTick(); } catch (e) { _loudWrite(e); }
    }, 250);
    _gate = setInterval(function () {
      if (!_inItsRoom()) return;
      _openSoon();
    }, B2Authority.POLICY.gate.intervalMs);
    // A minute-scale line saying what the runner has actually handled. Without it, "the room is
    // quiet" and "the runner is deaf" read identically in a log — which is exactly the pair that
    // cost five deploys to tell apart.
    _beat = setInterval(function () {
      if (!_inItsRoom()) return;
      _say("seen " + _seen + ", relayed " + _stood + ", merged " + B2Authority.merged() +
           ", refused " + _refused + ", too old " + _expired + ", handled " + _absorbed +
           ", failed " + _failed + ", waiting " + B2Authority.pending() + ", held " + _held.length +
           (_dropped ? ", dropped " + _dropped : "") + ", may-write=" + _mayAuthor());
      _drainHeld();
      _maybeSeal();
    }, 60000);

    // ── NOTHING IS WRITTEN UNTIL THIS CLIENT IS CAUGHT UP ────────────────────────────────────
    // `start` runs from `setRoomScope`, which happens BEFORE the room is replayed. The Lamport clock
    // has not seen the room's history at that point, so `sendEvent` mints from a clock still at
    // zero. v382 announced there and the event came back
    // `REFUSED AT THE DOOR ddjp.bot.here — backdated: claims l=1 (head is l=8)`: written, delivered,
    // and rejected by every door including its own. Every relay would have been backdated the same
    // way, for as long as the runner had been running.
    //
    // The rule already existed and this file was not following it — `session` owns *only a fully
    // caught-up client may write anything*, and `onAuthorReady` is the hook for it. The design said
    // so too ("replay → rebuild → LIVE → announce") and the implementation announced first.
    //
    // ── AND EVERY LATER RETURN TO LIVE RELEASES WHAT WAS HELD (J64) ──────────────────────────
    // `onAuthorReady` fires on EVERY transition to LIVE, and this used to hand it `_goLive`, which
    // returns at once after the first announcement — and was only subscribed at all when the
    // runner started behind. So after the first time, nothing but the next intent or the
    // once-a-minute beat released a held intent: bot-501 waited until 20:47:49 and 21:07:26 for it.
    // §11c says held intents are "relayed the moment it can write"; now they are.
    if (!_liveHookArmed) {
      try { MatrixBridge.onAuthorReady(_onLive); _liveHookArmed = true; } catch (e) { _loudWrite(e); }
    }
    if (_mayAuthor()) _goLive();
    return { ok: true };
  }
  function _onLive() {
    if (!_on || !_inItsRoom()) return;
    if (!_announced) _goLive();
    else _drainHeld();
  }

  // `mayAuthor()` ANSWERS WITH AN OBJECT, NOT A BOOLEAN: `{ ok, reason, state }`, refusing with
  // `{ ok: false, reason: "not-live" }`. This read `=== true`, which an object never is — so it was
  // ALWAYS false and `_onRaw` returned early on every intent. The announcement still landed, because
  // that goes through the `onAuthorReady` hook rather than through here, so the runner looked alive
  // in the log and **would never have relayed anything at all**.
  //
  // `features/queue.js` reads the same call correctly (`if (fit && fit.ok === false)`), which is what
  // this now matches. A boolean and an object both look true enough at a glance; only the contract
  // says which.
  function _mayAuthor() {
    try {
      if (typeof MatrixBridge.mayAuthor !== "function") return true;
      const fit = MatrixBridge.mayAuthor();
      return !(fit && fit.ok === false);
    } catch (e) { return false; }
  }
  function _goLive() {
    if (!_on || _announced) return;
    _announced = true;
    announce();
    _drainHeld();
    _say("caught up — announced and now relaying");
  }

  // ── STOPPING (J80): WHAT WAS PROMISED GOES FIRST, TO ITS OWN ROOM, AND THEN NOTHING RUNS ────────────────────────────────
  // Called by the room's leave (`B2StreamManager.reset`, J83: every way out of the room, and opening another), by a refused or
  // re-aimed `start`, and by the self-check. At the leave it runs while the room's engine is still bound and before anything of
  // the room is reset, so the gate's closing opening (`flush`) sends what the bot had already accepted to the room it was
  // accepted for, at that room's positions. The runner's held intents are not promised — they were never judged — so they are
  // DROPPED here and counted (J83), not carried to whatever the tab opens next.
  function stop(why) {
    if (!_on) return { ok: true, already: true };
    _on = false;
    try { (_rawBridge || MatrixBridge).offRawEvent(_onRaw); } catch (e) {}
    _rawBridge = null;
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_gate) { clearInterval(_gate); _gate = null; }
    if (_oneShot) { clearTimeout(_oneShot); _oneShot = null; }
    if (_beat) { clearInterval(_beat); _beat = null; }
    let out = null;
    try { out = B2Authority.flush(); } catch (e) { _loudWrite(e); }
    const sent = (out && out.sent) || 0;
    const dropped = _held.length;
    _held = [];
    // SAID, for the owner's live check (J80): after it, no "starting the first song" and no "sealing".
    _say("stopped — " + (why || "asked to stop") + (sent ? "; first sent " + sent + " promised act(s) to " + (_ch && _ch.events_owner) : "") +
      (dropped ? "; " + dropped + " held intent(s) dropped" : ""));
    return { ok: true, sent: sent, dropped: dropped };
  }

  // "I am here, and I am listening from this point." It marks the boundary rather than recovering
  // what is behind it: intents sent while the runner was gone are never evaluated, they sit unread,
  // and that is the end of it. Safe because state derives from the log alone — an intent nobody saw
  // simply never became state, and every client agrees about that because they read one ordered room.
  // NO `at`. It carried this device's `Date.now()`, and the bot door turns `at` into the event's
  // time — a local clock standing in for a server stamp (P2). The message's own server stamp says
  // when the bot arrived, which is the only thing the marker exists to say.
  function announce() {
    return B2Authority.submitRaw("ddjp.bot.here", {});   // through the gate, in order (J76)
  }

  // ── THE LOOP ────────────────────────────────────────────────────────────────────────────────
  function _onRaw(raw) {
    if (!_on || !raw || !_inItsRoom()) return;
    _noteServerTs(raw);
    _noteOwnEcho(raw);
    // ANY ARRIVING MESSAGE RUNS THE SCHEDULE'S CLOCK (J65) — the timer may be asleep, sync is not. The advance FIRST, so
    // a song change it submits can leave at this very trigger (J76).
    try { _advanceTick(); } catch (e) { _loudWrite(e); }
    // A background tab slows timers but still receives messages: any arriving message may open a DUE gate (J76).
    if (_mayAuthor()) _openSoon();
    if (raw.type !== "m.room.message") return;
    if (raw.room_id !== _ch.events_uncategorized) return;   // only intents; the log is our own output
    _intake(raw);
  }
  // An intent, from the room or from the bot itself (`submitOwn`): held while not live, judged once.
  function _intake(raw) {
    // ── NOT LIVE: HOLD IT, DO NOT DROP IT ───────────────────────────────────────────────────
    // A relay minted while behind carries a position under the room's head and is refused at every
    // door as backdated, so the runner must not write now. It used to RETURN here, which threw the
    // intent away: the person's act simply never happened and they had to do it again. Reported
    // from a live room as "everything works with massive delays" and "sometimes you have to try
    // several times" — which is what a dropped act looks like from the outside.
    //
    // A browser tab spends a lot of its life not-live: backgrounded, throttled, catching up after.
    // In a shared room that costs one client its own writes. In a BOT room the runner's liveness is
    // the whole room's liveness, so dropping here stalls everybody. Holding costs nothing. (This
    // said the act "carries its own `at`, so it ages honestly" — it never did: see `_consider`.)
    if (!_mayAuthor()) {
      _held.push(raw);
      while (_held.length > MAX_HELD_INTENTS) { _held.shift(); _dropped++; }
      return;
    }
    _drainHeld();
    _consider(raw);
  }

  // Everything held while this client could not write, in arrival order, evaluated NOW rather than
  // as it was then — the rung and the room's state are read at the moment of the decision, which is
  // the same rule §5a states for an intent that arrives live.
  function _drainHeld() {
    if (!_held.length || !_mayAuthor()) return;
    const batch = _held;
    _held = [];
    _say("catching up on " + batch.length + " held intent(s)");
    for (const r of batch) _consider(r);
  }

  function _consider(raw) {
    let intent = null;
    try { intent = JSON.parse(raw.content.body); } catch (e) { return; }
    if (!intent || typeof intent.t !== "string") return;
    _seen++;
    // SAY WHAT WAS SEEN. Five live bugs in a row ended with the runner silent about the one thing
    // it exists to do: the log said "announced and now relaying" while nothing was relayed, and the
    // only way to tell was to read the room's raw contents by hand. An engine that publishes no
    // refusals (§4a) must at least be legible to the person running it.
    _say("saw " + intent.t + " from " + raw.sender);

    // The rung is read from Matrix at the moment of evaluation, per the owner's instruction that
    // the runner always checks current values. A demotion therefore takes effect on intents already
    // in flight — backend1 cannot do that, because the channel a message landed in freezes the rung
    // at SEND time. The stamped `rank` below is the frozen record of what was read here.
    const rank = MatrixBridge.getUserEffectiveRank(_spaceId, _ch, raw.sender);
    const state = StreamManager.getState();
    // TOO OLD TO ANSWER (J65). The asking app gives up at the answer window plus its margin, so an
    // act older than the window is dropped unanswered: acting on it now would make an app's honest
    // "that didn't work" false a moment later. Held acts released after a long sleep land here.
    const window = (B2Authority.POLICY && B2Authority.POLICY.answerWindowMs) || 20000;
    if (_ageOf(raw) > window) {
      _expired++;
      _say("too old to answer " + intent.t + " from " + raw.sender + " — dropped");
      return;
    }
    // The held log and the save point's seed, so the judge can ask the reducer (J73 job 2, Q3).
    const verdict = B2Authority.evaluate(
      Object.assign({}, intent, { actor: raw.sender }), state, rank,
      (typeof StreamManager.getLog === "function")                // no log offered: judged on rank alone, as before
        ? { log: StreamManager.getLog(), seed: (typeof StreamManager.floorSeed === "function") ? (StreamManager.floorSeed() || undefined) : undefined }
        : undefined);
    if (!verdict.ok) {
      // ANSWERED, NOT SILENT (J65). §4a published no refusals; the asking app could only guess, and
      // a refused join wedged the queue. The refusal travels grouped, attributed to the person.
      _refused++;
      _say("refused " + intent.t + " from " + raw.sender + " — " + (verdict.reason || "no reason"));
      if (!verdict.silent && (!B2Authority.classify(intent.t) || !B2Authority.classify(intent.t).bot)) {   // J76: an early play is ignored
        B2Authority.submit(B2Authority.refusal(intent, raw.sender, rank, raw.event_id, verdict.reason));
        _openSoon();   // J76: what was just submitted goes at its first trigger
      }
      return;
    }

    _stood++;
    // ACCEPTED AND HANDLED ELSEWHERE: a settings request is answered by the bot's own handler,
    // which reads it where the person wrote it. Writing a copy to the log helps nobody (J64).
    if (!B2Authority.relays(intent.t)) {
      _absorbed++;
      _say("accepted " + intent.t + " from " + raw.sender + " — handled by the bot, not relayed");
      return;
    }
    // ONE LENGTH PER SONG (J66). The room takes the first report, and later only a HIGHER rank's
    // disagreement can move it (the cascade's own rule), so every other report is a message that
    // changes nothing. Measured at J65: twelve of fifteen messages in a busy song were lengths.
    if (intent.t === "ddjp.play.len" && typeof intent.pi === "string") {
      const prev = _lenPassed[intent.pi];
      const sec = Number(intent.sec);
      if (prev && !(rank > prev.rank && Math.abs(sec - prev.sec) >= LEN_DISAGREE_SEC)) {
        _absorbed++;
        _say("length for " + intent.pi + " from " + raw.sender + " changes nothing — not passed on");
        return;
      }
      _lenPassed[intent.pi] = { rank: rank, sec: sec };
      const keys = Object.keys(_lenPassed);
      if (keys.length > 40) delete _lenPassed[keys[0]];
    }
    _say("relaying " + intent.t + " from " + raw.sender + " at rank " + rank);
    // `at` IS NULL, BY THE OWNER'S RULING (J64): a relayed act folds at the moment the BOT relayed
    // it. This read `raw.origin_server_ts`, a field the fan-out raw does not carry (it carries `ts`),
    // so it was always null — and the room has run on relay time since the first live session. That
    // is now the decision rather than an accident: `ServerClock` learns its offset from incoming
    // stamps on the assumption that an event arrived when it was stamped, which the relay time
    // satisfies and the person's own time would not (a drained backlog would drag every playhead).
    const r = B2Authority.submit(B2Authority.stamp(intent, raw.sender, rank, raw.event_id, null));
    _openSoon();   // J76: what was just submitted goes at its first trigger
    // Over the per-person limit: dropped in SILENCE (owner, J76 Q1). The refusal that used to be sent here hit the
    // same limit it reported, so it was never sent; silence is now the stated rule.
    if (r && r.tooFast) { _stood--; _refused++; }
  }

  // ── SEALING, ON THE RUNNER'S OWN BEAT ───────────────────────────────────────────────────────
  // `B2Checkpoint.seal` existed from the day the floor was written and NOTHING CALLED IT, so a bot
  // room replayed its whole log on every join, forever, and got slower every day. backend1 seals
  // from a cadence tick that cannot work here — it resolves a `checkpoints_` channel a bot room does
  // not have — which is why the console said `nowhere-to-post` once a minute rather than sealing.
  //
  // ── WHEN A SEAL IS DUE: THE SHARED ROOM'S RULE, NOT A SECOND ONE (J61) ─────────────────────
  // This used to say a bot room "seals on the same rhythm a shared room does" while the code needed
  // the count AND the cooldown, where backend1's seal gate needs EITHER — so a quiet bot room never
  // sealed however long it ran. Found by J39's backend2 sweep: every comparison in this decision
  // survived, because the only check was a regex proving the two setting names were spelled.
  // Ruled by the owner at ddjp_416, each half the shared room's own:
  //   · NOTHING CHANGED, NO SEAL. Zero countable events above the anchor refuses before either
  //     trigger is asked — a bare OR would re-seal an identical state every cooldown.
  //   · EITHER TRIGGER: `checkpointEvery` countable events, OR `checkpointCooldownMs` of history.
  //   · THE CLOCK IS THE SERVER'S: the newest logged event's stamp minus the floor's own stamp, so
  //     it survives a reload and a room where nothing is logged does not age. `Date.now()` answers
  //     ONE question only — has the seal I just sent come back yet (below).
  //   · WHAT COUNTS is `Checkpoint._countable`, the shared room's list from its one home.
  // `sealDue` is pure and exported; `_maybeSeal` is its one production caller; the guard drives both.
  //
  // THE ANCHOR IS A POSITION: the later of the floor's `floorL` and the head this runner last sealed.
  // A trim moves a tally and never a position (the seventeenth signature). Without the second half
  // the count trigger would fire on every beat between sending a seal and seeing it come back.
  //
  // A SEAL IN FLIGHT HOLDS THE CLOCK TRIGGER. Until the checkpoint is adopted the floor has not moved,
  // so the history since it still reads as overdue. The shared room covers the same moment with a
  // local re-entrancy window; with one sealer and no rank ladder, the window here is the room's own
  // cooldown — a seal that never comes back is retried after one. Local minus local, as P2 allows.
  function sealDue(o) {
    const log = Array.isArray(o.log) ? o.log : [];
    const floorL = (o.floor && typeof o.floor.floorL === "number") ? o.floor.floorL : -Infinity;
    const sealedL = (typeof o.lastSealL === "number") ? o.lastSealL : -Infinity;
    const anchor = Math.max(floorL, sealedL);
    const above = log.filter(function (e) { return e && typeof e.l === "number" && e.l > anchor; });
    const changed = (typeof o.countable === "function") ? o.countable(above) : above.length;
    if (changed === 0) return { due: false, reason: "nothing-changed", newEvents: 0 };
    if (changed >= o.every) return { due: true, reason: "count", newEvents: changed };
    let newest = null;
    for (const e of log) if (e && typeof e.ts === "number" && (newest === null || e.ts > newest)) newest = e.ts;
    const sinceFloor = (typeof o.floorAt === "number" && typeof newest === "number") ? newest - o.floorAt : Infinity;
    if (sinceFloor < o.cooldownMs) return { due: false, reason: "not-due", newEvents: changed, sinceFloor: sinceFloor };
    if (o.inflight) return { due: false, reason: "in-flight", newEvents: changed, sinceFloor: sinceFloor };
    return { due: true, reason: "time", newEvents: changed, sinceFloor: sinceFloor };
  }

  // WHAT COUNTS, from its one home. Legality is applied HERE, through the same predicate the shared
  // room hands `Checkpoint` (`StreamManager.isLegal`), because in a bot room backend1's checkpoint
  // engine is deliberately not attached — so its own legality half would be absent and every refused
  // act would count. Without `Checkpoint`, everything above the anchor counts, as its own fallback does.
  function _countable(list) {
    let legal = null;
    try { legal = (typeof StreamManager !== "undefined" && StreamManager.isLegal) ? StreamManager.isLegal : null; } catch (e) { legal = null; }
    const kept = (typeof legal === "function")
      ? list.filter(function (e) { const id = e && (e.eventId || e.event_id); return !(id && !legal(id)); })
      : list;
    try {
      if (typeof Checkpoint !== "undefined" && typeof Checkpoint._countable === "function") return Checkpoint._countable(kept);
    } catch (e) {}
    return kept.length;
  }

  function _maybeSeal() {
    if (!_on || !_mayAuthor()) return null;
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return null; }
    if (!st) return null;
    const set = st.settings || {};
    const every = (typeof set.checkpointEvery === "number" && set.checkpointEvery > 0) ? set.checkpointEvery : 40;
    const cool = (typeof set.checkpointCooldownMs === "number") ? set.checkpointCooldownMs : 1200000;

    let log = [];
    try { log = StreamManager.getLog() || []; } catch (e) { return null; }
    const floor = B2Checkpoint.floor();
    const now = Date.now();
    const verdict = sealDue({
      log: log, floor: floor, floorAt: B2Checkpoint.floorAt(), lastSealL: _lastSealL,
      inflight: _sealedN !== null && (!floor || floor.n < _sealedN) && (now - _lastSeal) < cool,
      every: every, cooldownMs: cool, countable: _countable,
    });
    if (!verdict.due) return verdict;

    const head = log.length ? log[log.length - 1] : null;
    // ── THE ROOM'S REAL STARTING STATE, CHECKED BEFORE IT IS POSTED (J64) ────────────────────
    // This sealed `getState()` — the DISPLAY state (rotation, totals, history). Nothing can resume
    // from that: the reducer folds from its own seed (`members` with their order, the tick, the live
    // declarations, the live tally), and song history folded from the display state found no songs.
    // So the seed is the reducer's own — the same function a shared room's checkpoint uses — and it
    // is checked before anyone is told to trust it, by the project's own standard (PILLARS §3:
    // `derive(seed, after) ≡ derive(everything)`): folding nothing onto it must give back what the
    // whole log folds to — queue, now-playing and settings. The runner holds the whole log, so the
    // check is exact rather than sampled, and it compares the seed with the fold of the SAME log it
    // was built from rather than with a second source.
    const seed = _buildSealSeed(log);
    if (!seed) { _say("seal refused — the starting state does not reproduce this room"); return verdict; }
    const out = B2Checkpoint.seal(seed, {
      isRunner: true,
      floorL: head ? (head.l || null) : null,
      covers: head ? (head.eventId || null) : null,
    });
    if (!out || !out.ok) { _say("seal refused — " + ((out && out.reason) || "unknown")); return verdict; }
    _lastSeal = now;
    _lastSealL = (head && typeof head.l === "number") ? head.l : null;
    _sealedN = out.cp.n;
    _say("sealing checkpoint n=" + out.cp.n + " (" + verdict.reason + ") over " + verdict.newEvents + " countable event(s)");
    B2Authority.submitRaw(B2Checkpoint.TYPE, out.cp);   // through the gate, in order (J76)
    return verdict;
  }

  // The one place this file writes. Everything the runner emits goes to the log, which only it and
  // the owner may write to — that is what makes "only the runner may author this" enforceable by
  // the homeserver rather than by agreement.
  // ── THE ONE PLACE THIS FILE WRITES ───────────────────────────────────────────────────────────
  // `sendEvent(roomId, type, content)` BUILDS THE PROTOCOL ENVELOPE ITSELF — it stamps `t`, `l` from
  // the room clock, and `dv`, then wraps the result as the Matrix message body. This called it as
  // `sendEvent(room, "m.room.message", { body: JSON.stringify(...) })`, pre-wrapping the body and
  // passing a Matrix type where a DDJP type belongs. The result was an event whose `t` was
  // `"m.room.message"`, which is not a `ddjp.` type, so every client's door dropped it on the floor.
  //
  // FOUND IN A LIVE ROOM: the runner started, announced, and nothing was ever ingested — and it
  // would have been true of every relay too, so no intent could ever have stood. Nothing in the
  // harnesses caught it because they all used a fake `sendEvent` that took whatever it was given.
  //
  // `l` IS NOT STAMPED HERE ANY MORE EITHER. `sendEvent` takes it from the room's own Lamport clock,
  // which is the same source every other writer uses; a second counter in this file would have been
  // a second opinion about the room's ordering.
  // EVERY CALL TO THE GATE (J76). An urgent act held ONLY by the spacing gets one opening scheduled for exactly when the
  // spacing ends — so a visible tab's worst case is gate.intervalMs, not the interval plus a timer period. Hidden tabs
  // throttle this timeout like any other; that stays with J68.
  function _openSoon() {
    let r = null;
    try { r = B2Authority.openIfDue(); } catch (e) { _loudWrite(e); return; }
    if (r && r.reason === "between-openings" && r.urgent === true && !_oneShot && typeof setTimeout === "function") {
      _oneShot = setTimeout(function () { _oneShot = null; if (_on && _inItsRoom()) _openSoon(); }, Math.max(0, r.waitMs || 0));
    }
  }
  function _write(type, payload) {
    if (!_ch || !_ch.events_owner) return null;
    let out = null;
    const t0 = Date.now();
    try { out = MatrixBridge.sendEvent(_ch.events_owner, type, payload || {}); }
    catch (e) { _failed++; _loudWrite(e); return null; }
    if (out && typeof out.then === "function") {
      return out.then(function (res) {
        // A round-trip sample for the clock (J72), whichever arrives first: the reply or the echo.
        if (res && res.eventId) {
          const e = _echoLocal.get(res.eventId);
          if (e) { _sample(t0, e.at, e.ts); _echoLocal.delete(res.eventId); }
          else _sentLocal.set(res.eventId, t0);
        }
        return res;
      }).catch(function (e) { _failed++; _loudWrite(e); return null; });
    }
    return out;
  }
  function _say(m) { try { Logger.info("backend2: runner " + m); } catch (e) {} }
  function _loudWrite(e) {
    try { Logger.error("backend2: runner write failed — " + ((e && e.message) || e)); } catch (x) {}
  }

  return { start, stop, announce, isRunner, runnerLevel, running, room, stats, _onRaw, takesOwn, submitOwn, _advanceTick, _serverNow, _buildSealSeed,
    _maybeSeal /* exposed for the guard */, sealDue };
})();
