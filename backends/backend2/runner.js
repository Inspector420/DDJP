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
  let _timer = null;
  let _beat = null;
  let _spaceId = null;
  let _seen = 0;
  let _stood = 0;
  let _failed = 0;
  let _announced = false;
  let _lastSeal = 0;
  let _held = [];            // intents seen while this client could not write
  let _dropped = 0;
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
  function stats() { return { seen: _seen, stood: _stood, failed: _failed, held: _held.length, dropped: _dropped, pending: B2Authority.pending() }; }

  // ── STARTING ────────────────────────────────────────────────────────────────────────────────
  // `session` already owns *only a fully caught-up client may write anything*, and the runner is a
  // client that happens to hold authority, so it follows the same rule rather than a new one. The
  // caller starts this once the fold is live; from that point the runner consumes intents and
  // ignores everything said while it was gone — which is why there is no cursor here, no bookmark,
  // and no way to process an intent twice after a crash.
  function start(opts) {
    const o = opts || {};
    _ch = o.channels || null;
    _spaceId = o.spaceId || null;
    if (!_ch || !_ch.events_uncategorized || !_ch.events_owner) {
      return { ok: false, reason: "a runner needs both the intents and the log channels" };
    }
    // THE ROOM MUST BE A BOT-RUN ROOM, and this is checked before the rung. An earlier version
    // proved only "I hold the top rung", which is TRUE OF A BOT IN A SHARED ROOM TOO — backend1
    // rooms have an `events_owner` channel and a bot at 99 as well. Starting there would relay
    // intents into a room whose clients fold every channel, so every act would land twice: once as
    // the person authored it and once as the runner repeated it. Nothing calls `start` yet, which
    // is exactly why this is the moment to close it.
    const mode = (typeof Backends !== "undefined" && Backends.active) ? Backends.active() : null;
    if (mode !== MODE) {
      return { ok: false, reason: "this client is not running the bot-run engine", mode: mode };
    }
    // And the ROOM's own declaration agrees, when the space is known. The engine that is bound is a
    // fact about this client; the create-content marker is a fact about the room, and it is the one
    // that cannot be changed after creation.
    if (_spaceId) {
      let declared = null;
      try { declared = Backends.resolveMode(MatrixBridge.getCreateContent(_spaceId)); } catch (e) { declared = null; }
      if (declared !== MODE) {
        return { ok: false, reason: "this room does not declare the bot-run engine", declared: declared };
      }
    }
    if (!isRunner(_ch.events_owner)) {
      return { ok: false, reason: "not the runner in this room", level: MatrixBridge.getMyPowerLevel(_ch.events_owner) };
    }
    if (_on) return { ok: true, already: true };

    _on = true;
    _seen = 0; _stood = 0; _failed = 0; _announced = false; _held = []; _dropped = 0;
    _lastSeal = 0;
    B2Authority.reset();
    B2Authority.attach(function (type, payload) { return _write(type, payload); },
                       { windowMs: (o.windowMs || 1000) });
    MatrixBridge.onRawEvent(_onRaw);
    _say("listening for intents on " + _ch.events_uncategorized);
    _timer = setInterval(function () { B2Authority.flush(); }, B2Authority.windowMs());
    // A minute-scale line saying what the runner has actually handled. Without it, "the room is
    // quiet" and "the runner is deaf" read identically in a log — which is exactly the pair that
    // cost five deploys to tell apart.
    _beat = setInterval(function () {
      _say("seen " + _seen + ", relayed " + _stood + ", failed " + _failed +
           ", waiting " + B2Authority.pending() + ", held " + _held.length +
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
    if (_mayAuthor()) _goLive();
    else { try { MatrixBridge.onAuthorReady(_goLive); } catch (e) { _loudWrite(e); } }
    return { ok: true };
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

  function stop() {
    if (!_on) return { ok: true, already: true };
    _on = false;
    MatrixBridge.offRawEvent(_onRaw);
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_beat) { clearInterval(_beat); _beat = null; }
    B2Authority.flush();
    return { ok: true };
  }

  // "I am here, and I am listening from this point." It marks the boundary rather than recovering
  // what is behind it: intents sent while the runner was gone are never evaluated, they sit unread,
  // and that is the end of it. Safe because state derives from the log alone — an intent nobody saw
  // simply never became state, and every client agrees about that because they read one ordered room.
  function announce() {
    return _write("ddjp.bot.here", { at: Date.now() });
  }

  // ── THE LOOP ────────────────────────────────────────────────────────────────────────────────
  function _onRaw(raw) {
    if (!_on || !raw || raw.type !== "m.room.message") return;
    if (raw.room_id !== _ch.events_uncategorized) return;   // only intents; the log is our own output

    // ── NOT LIVE: HOLD IT, DO NOT DROP IT ───────────────────────────────────────────────────
    // A relay minted while behind carries a position under the room's head and is refused at every
    // door as backdated, so the runner must not write now. It used to RETURN here, which threw the
    // intent away: the person's act simply never happened and they had to do it again. Reported
    // from a live room as "everything works with massive delays" and "sometimes you have to try
    // several times" — which is what a dropped act looks like from the outside.
    //
    // A browser tab spends a lot of its life not-live: backgrounded, throttled, catching up after.
    // In a shared room that costs one client its own writes. In a BOT room the runner's liveness is
    // the whole room's liveness, so dropping here stalls everybody. Holding costs nothing and the
    // act still carries its own `at`, so it ages honestly when it finally lands.
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
    const verdict = B2Authority.evaluate(
      Object.assign({}, intent, { actor: raw.sender }), state, rank);
    if (!verdict.ok) {
      // Not published — §4a — but SAID, locally, so a room where nothing stands is distinguishable
      // from a room where nothing arrived.
      _say("refused " + intent.t + " from " + raw.sender + " — " + (verdict.reason || "no reason"));
      return;
    }

    _stood++;
    _say("relaying " + intent.t + " from " + raw.sender + " at rank " + rank);
    B2Authority.submit(B2Authority.stamp(
      intent, raw.sender, rank, raw.event_id,
      (typeof raw.origin_server_ts === "number") ? raw.origin_server_ts : null));
  }

  // ── SEALING, ON THE RUNNER'S OWN BEAT ───────────────────────────────────────────────────────
  // `B2Checkpoint.seal` existed from the day the floor was written and NOTHING CALLED IT, so a bot
  // room replayed its whole log on every join, forever, and got slower every day. backend1 seals
  // from a cadence tick that cannot work here — it resolves a `checkpoints_` channel a bot room does
  // not have — which is why the console said `nowhere-to-post` once a minute rather than sealing.
  //
  // THE CADENCE IS THE ROOM'S OWN, not a number invented here: `checkpointEvery` and
  // `checkpointCooldownMs` are settings both engines already read, so a bot room seals on the same
  // rhythm a shared room does. Only the runner seals (§6), so this lives here and nowhere else.
  function _maybeSeal() {
    if (!_on || !_mayAuthor()) return;
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return; }
    if (!st) return;
    const set = st.settings || {};
    const every = (typeof set.checkpointEvery === "number" && set.checkpointEvery > 0) ? set.checkpointEvery : 40;
    const cool = (typeof set.checkpointCooldownMs === "number") ? set.checkpointCooldownMs : 1200000;

    let log = [];
    try { log = StreamManager.getLog() || []; } catch (e) { return; }
    const floor = B2Checkpoint.floor();
    const since = floor ? log.filter(function (e) { return (e.l || 0) > (floor.floorL || 0); }).length : log.length;
    if (since < every) return;
    const now = Date.now();
    if (_lastSeal && (now - _lastSeal) < cool) return;

    const head = log.length ? log[log.length - 1] : null;
    const out = B2Checkpoint.seal(st, {
      isRunner: true,
      floorL: head ? (head.l || null) : null,
      covers: head ? (head.eventId || null) : null,
    });
    if (!out || !out.ok) { _say("seal refused — " + ((out && out.reason) || "unknown")); return; }
    _lastSeal = now;
    _say("sealing checkpoint n=" + out.cp.n + " over " + since + " event(s)");
    _write(B2Checkpoint.TYPE, out.cp);
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
  function _write(type, payload) {
    if (!_ch || !_ch.events_owner) return null;
    let out = null;
    try { out = MatrixBridge.sendEvent(_ch.events_owner, type, payload || {}); }
    catch (e) { _failed++; _loudWrite(e); return null; }
    if (out && typeof out.catch === "function") {
      return out.catch(function (e) { _failed++; _loudWrite(e); return null; });
    }
    return out;
  }
  function _say(m) { try { Logger.info("backend2: runner " + m); } catch (e) {} }
  function _loudWrite(e) {
    try { Logger.error("backend2: runner write failed — " + ((e && e.message) || e)); } catch (x) {}
  }

  return { start, stop, announce, isRunner, runnerLevel, running, stats, _onRaw,
    _maybeSeal /* exposed for the guard */ };
})();
