// backends/backend2/authority.js — the bot's authority half (J24 slice 4).
//
// The room's runner. It reads intents from `events-uncategorized`, decides whether each may stand,
// and republishes what it accepts into `events-owner` with the actor, their rung, the intent it
// came from and the moment they acted. Clients fold only what it writes.
//
// ── THE RULE THIS FILE EXISTS TO NOT BREAK ────────────────────────────────────────────────────
// Bot mode publishes NO REFUSALS. That is safe only because the decision is DETERMINISTIC: a
// client works out for itself what it may ask for, from room settings and its own power level, and
// the bot reaches the same verdict from the same two inputs. The moment the bot judges a user by
// its own copy of the rules, the two can differ — and a user is then refused for a reason their
// client cannot show them, silently, precisely because nothing is published.
//
// So `evaluate` below contains **no rank comparison and no settings lookup of its own**. It asks
// `Capabilities.can`, which is the same function the client asks. `check-backends` PART H asserts
// that textually, because the failure is invisible at runtime by construction.
//
// **This does not mean the bot has no powers.** As the runner it does things no user does: relay,
// seal, remove, announce. Those are not user permissions and are not subject to the rule above —
// the tree already models that split in `BotRuntime.mayOffer`, which asks what THE BOT may do.
//
// ── WHY THERE IS A CLASSIFICATION TABLE AT ALL ────────────────────────────────────────────────
// The app's gate vocabulary is verbs (`dj.move`, `room.settings`) and the wire carries event types
// (`ddjp.dj.move`). The mapping is ALMOST mechanical — strip `ddjp.` — and the exceptions are what
// make a derived rule dangerous: `ddjp.dj.vote` is gated as `react.vote`, `ddjp.dj.save` is not
// rank-gated at all, and the reports that feed the skip roads are gated by nothing because anyone
// may say what they can see.
//
// A silent default would be the worst of both: an unclassified type either sails through ungated or
// is refused with no way for the sender to learn why. So every type the app can send is classified
// HERE, explicitly, and PART H drives the table against a scan of `features/` — a new event type
// that nobody classified turns the wall red instead of shipping.

const B2Authority = (() => {

  // ── HOW EACH EVENT TYPE IS JUDGED ───────────────────────────────────────────────────────────
  //   { verb }        ask `Capabilities.can(verb, state, ctx)` — the shared rules, one home
  //   { open, why }   anyone may author it; no rank question exists to ask
  //   { bot, why }    only the runner may author it
  // `why` is the part a reader cannot recompute, which is the same reason `check-room-scope`'s
  // declaration list carries one.
  const JUDGE = {
    "ddjp.dj.join":       { verb: "dj.join" },
    "ddjp.dj.leave":      { verb: "dj.leave" },
    "ddjp.dj.declare":    { verb: "dj.declare" },
    "ddjp.dj.undeclare":  { verb: "dj.undeclare" },
    "ddjp.dj.order":      { verb: "dj.order" },
    "ddjp.dj.move":       { verb: "dj.move" },
    "ddjp.dj.remove":     { verb: "dj.remove" },
    "ddjp.dj.strike":     { verb: "dj.strike" },
    "ddjp.dj.reset":      { verb: "dj.reset" },
    "ddjp.dj.skip":       { verb: "dj.skip" },
    "ddjp.room.settings": { verb: "room.settings" },
    "ddjp.count.set":     { verb: "count.set" },

    // NOT `dj.vote` — the catalog gates this act as `react.vote`, and a mechanical strip of the
    // `ddjp.` prefix would have asked for a verb the gates table does not define.
    "ddjp.dj.vote":       { verb: "react.vote" },

    // A save is personal bookkeeping about a playing, gated by nothing in the catalog either.
    "ddjp.dj.save":       { open: true, why: "a personal save carries no rank question" },

    // THE REPORTS THE SKIP ROADS ARE DERIVED FROM. Anyone may say what they can see, and the
    // rank-staggered ladder decides who speaks FIRST rather than who may speak at all — that
    // cascade lives above the seam in `features/medialength.js` and the bot only relays its
    // outcome (`bot-backend.md` §5c). Gating these by rank would silently disable the countdown
    // and the availability escape for everyone below the bar.
    "ddjp.media.len":     { open: true, why: "a length declaration is a report, ranked by cascade order not by permission" },
    "ddjp.play.len":      { open: true, why: "same cascade, the consensus-side half" },
    "ddjp.play.blocked":  { open: true, why: "'I cannot see this' is a report; refusing it hides the availability escape" },
    "ddjp.media.skip":    { open: true, why: "the derived availability escape, re-validated by the reducer rather than gated here" },

    // THE ADVANCE IS PROPOSED BY CLIENTS, NOT AUTHORED BY THE RUNNER.
    //
    // This read `bot: true` — "the advance is the runner's" — and shipped. It is wrong twice over.
    // `features/playback.js` says in its own header that ANY PRESENT CLIENT MAY EMIT `ddjp.dj.play`,
    // and `mayAdvance` gates it on being caught up rather than on rank. And the runner never
    // authored one either: nothing in this engine generates an advance. So every client's proposal
    // was refused, nothing replaced it, and **a bot room could never start a song** — the queue
    // filled and the player sat still.
    //
    // It is `open` for the same reason it is open in a shared room: whoever's cascade slot comes
    // first proposes, the runner accepts, and duplicates are the reducer's problem exactly as they
    // always were. The runner's own client runs `playback.js` too, so it proposes like anybody else.
    "ddjp.dj.play":       { open: true, why: "any present client may propose an advance; the cascade orders them and the reducer settles duplicates" },

    // Upgrades do not exist in a bot room — it is built in one burst (`bot-backend.md` §2).
    "ddjp.room.upgrade.start": { bot: true, why: "a bot room has no upgrade path; built in one batch" },
    "ddjp.room.upgrade.done":  { bot: true, why: "as above" },

    // Delegated settings are a REQUEST to the runner, not an authored fact. The runner answers by
    // authoring `ddjp.room.settings`, and the panel already refuses to offer a row the bot would
    // decline, so the rank question was asked before this arrived.
    "ddjp.bot.request":   { open: true, why: "a request to the runner, answered by authoring the settings blob" },

    // THE RUNNER'S OWN ANNOUNCEMENT. Classified rather than left out: an unclassified type is
    // refused too, but for the wrong reason, and "we never listed it" is the kind of accident that
    // reads as a decision. A client sending one would be claiming to be the runner.
    "ddjp.bot.here":      { bot: true, why: "the runner's arrival marker; a client sending one claims to be the runner" },

    // Reputation snapshots are believed rather than derived in BOTH room types, so crossing the
    // seam changes nothing about their status (J24's save-file answer says so explicitly).
    "ddjp.rep.snapshot":  { open: true, why: "reputation is believed rather than derived in both modes" },
  };

  function classify(type) { return JUDGE[type] || null; }
  function judged() { return Object.keys(JUDGE); }

  // ── THE DECISION ────────────────────────────────────────────────────────────────────────────
  // `rank` is handed in, read from Matrix power levels by the transport — this file never works
  // one out. `state` is the folded room. Neither is compared here: the verdict comes from
  // `Capabilities.can`, the client's own function.
  // ── THE TARGET, TRANSLATED FROM THE WIRE ────────────────────────────────────────────────────
  // `Capabilities.can` reads `ctx.target.userId` and `ctx.target.videoId`. THE WIRE CARRIES NEITHER
  // NAME: a targeted act sends `{ x: userId }` and, for a strike, `{ x: userId, v: videoId }`.
  //
  // This passed `intent.target`, a field no event has ever carried, so `t` was always `{}` and
  // `rotationEntry(state, undefined)` found nobody. **Every targeted act was refused as "Not in the
  // rotation"** — reported from a live room for both strike and remove, against a person who was
  // plainly in it. The refusal even reads correctly, which is what made it convincing.
  //
  // `features/actions.js` builds this object for the client from the same two values, so both sides
  // now ask the shared function the same question. The field names come from `queue.js`'s own send
  // calls rather than from memory.
  function _targetOf(intent) {
    if (!intent || typeof intent !== "object") return {};
    return {
      userId: intent.x || null,
      videoId: intent.v || null,
      after: (intent.after !== undefined) ? intent.after : null,
      pi: intent.p || null,
    };
  }

  function evaluate(intent, state, rank) {
    if (!intent || typeof intent !== "object" || !intent.t) {
      return { ok: false, reason: "not a protocol event" };
    }
    const spec = classify(intent.t);
    if (!spec) {
      return { ok: false, reason: "unclassified event type " + intent.t };
    }
    if (spec.bot) return { ok: false, reason: "only the runner may author " + intent.t };
    if (spec.open) return { ok: true, verb: null };

    const verdict = Capabilities.can(spec.verb, state || {}, {
      myId: intent.actor || null,
      myRank: rank,
      target: _targetOf(intent),
    });
    // `can` ANSWERS `{ permitted, reason }` — NOT `{ ok }`. This read `verdict.ok`, which is always
    // `undefined`, so **every gated intent was refused** while the shared function was saying yes.
    // And the tell was inverted: a genuine refusal carries a reason and showed one, while a
    // PERMITTED act came back `{ permitted: true, reason: null }` and fell through to the fallback
    // text — so the log read "refused by dj.join" for an act the room allowed.
    //
    // `features/actions.js` reads it correctly (`cap.permitted`, `cap.reason`), which is the same
    // function this asks. There was a working reading of the contract in the tree and this invented
    // a second one — the third time in this engine that a boundary's SHAPE was guessed rather than
    // read: `sendEvent`'s arguments, `mayAuthor`'s object, and now this.
    const ok = verdict && verdict.permitted === true;
    return {
      ok: !!ok,
      verb: spec.verb,
      reason: ok ? null : ((verdict && verdict.reason) || ("refused by " + spec.verb)),
    };
  }

  // ── THE SEND QUEUE ──────────────────────────────────────────────────────────────────────────
  // Batching exists so the runner cannot spam Matrix. It must never apply to the cascade.
  //
  // THE CASCADE IS WHY THIS LIST IS A CORRECTNESS REQUIREMENT AND NOT A PREFERENCE. The ladder
  // works by SUPPRESSION: a lower rung sees the higher rung's answer land and cancels its own
  // pending slot. In a bot room that answer arrives after a relay round trip, so the round trip is
  // already subtracted from every gap. Add a window on top and every rung fires before seeing the
  // one above it, and the whole room declares at once — the exact opposite of what the ladder is
  // for. The advance is here for a plainer reason: delaying it makes every client's playback late.
  const URGENT = [
    "ddjp.dj.play", "ddjp.media.skip", "ddjp.dj.skip",
    "ddjp.media.len", "ddjp.play.len", "ddjp.play.blocked",
  ];
  function isUrgent(type) { return URGENT.indexOf(type) >= 0; }

  // A ceiling on what may wait. Backend1 bounds everything it accumulates — the log trims to the
  // floor, the cache is bounded by it — and an unbounded queue here would be the one place in the
  // engine that grows forever.
  const MAX_PENDING = 500;
                  // the runner mints positions; one writer, so a counter is enough
  let _buf = [];
  let _send = null;            // injected: (body) => Promise, so this file needs no transport
  let _windowMs = 1000;

  function attach(sendFn, opts) {
    _send = (typeof sendFn === "function") ? sendFn : null;
    if (opts && typeof opts.windowMs === "number") _windowMs = opts.windowMs;
    return true;
  }
  function windowMs() { return _windowMs; }
  function pending() { return _buf.length; }
  function reset() { _buf = []; }

  // Build what the runner writes: the decision, plus who asked and when they asked it.
  // NO `l` HERE. `sendEvent` stamps it from the room's Lamport clock, the same source every other
  // writer uses — a counter in this file would be a second opinion about the room's ordering.
  function stamp(intent, actor, rank, srcEventId, at) {
    const out = Object.assign({}, intent);
    out.actor = actor;
    out.rank = rank;
    out.src = srcEventId || null;
    // THE MOMENT THE PERSON ACTED, carried explicitly. Matrix's own timestamp on the relayed event
    // is when the RUNNER spoke, so without this a batch window would shift playback, AFK timing and
    // the countdown by exactly the window.
    out.at = (typeof at === "number") ? at : null;
    return out;
  }

  // Accepted -> out. Urgent types go immediately, one message each. Everything else buffers and
  // leaves as ONE message: a single API call rather than N, and crash-atomic, because a Matrix
  // event either landed or it did not — there is no half-applied batch to reconcile.
  function submit(stamped) {
    if (!stamped || !stamped.t) return { sent: false, reason: "nothing to send" };
    if (isUrgent(stamped.t)) {
      if (_send) _send(stamped.t, stamped);
      return { sent: true, batched: false };
    }
    // BOUNDED. Nothing else trims this, and a runner whose sends keep failing would otherwise grow
    // one array until the tab dies — with the oldest acts, the ones a person has been waiting on
    // longest, being exactly what a crash would lose. Dropping the oldest is stated rather than
    // silent: the count comes back so a caller can see the room is behind.
    let dropped = 0;
    _buf.push(stamped);
    while (_buf.length > MAX_PENDING) { _buf.shift(); dropped++; }
    return { sent: false, batched: true, dropped: dropped };
  }

  // THE BUFFER IS NOT CLEARED UNTIL THE SEND HAS BEEN ACCEPTED. An earlier version emptied it
  // first and then sent, which loses the whole batch silently if the send throws or rejects — and
  // a batch is several people's acts, so the room would simply never see them and nobody would
  // learn why. `sendEvent` may answer synchronously or with a promise, so both are handled and a
  // rejection puts the events back AT THE FRONT, keeping them ahead of anything queued since.
  function flush() {
    if (!_buf.length) return { sent: 0 };
    if (!_send) return { sent: 0, reason: "nothing attached to send through" };
    const evs = _buf;
    _buf = [];
    const requeue = function () { _buf = evs.concat(_buf); };
    let out = null;
    try { out = _send("ddjp.batch", { evs: evs }); }
    catch (e) { requeue(); return { sent: 0, failed: evs.length }; }
    if (out && typeof out.catch === "function") out.catch(requeue);
    return { sent: evs.length };
  }

  return {
    classify, judged, evaluate, stamp, submit, flush, attach, reset,
    isUrgent, pending, windowMs, URGENT,
  };
})();
