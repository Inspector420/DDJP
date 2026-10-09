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
    // ACCEPTED, NOT RELAYED (J66): one length system in a bot room. The countdown already prefers
    // the room's agreed length (`advance.displayLenSec`, from `ddjp.play.len`), so this display-only
    // report changes nothing anyone reads here — one message per app per song saved. (This row
    // briefly appeared twice; a later key silently replaces an earlier one, and lint caught it.)
    "ddjp.media.len":     { open: true, relay: false, why: "a length declaration is a report; display-only, so the agreed play.len is what the room shows" },
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
    //
    // ACCEPTED, NEVER RELAYED (J64). The bot's own handler (`features/botruntime.js`) reads the
    // request where the person wrote it, and nothing folds or subscribes to it anywhere else. A
    // relayed copy was a wasted message — and a dangerous one: it arrives in the log FROM THE BOT,
    // at the bot's channel rung, so any handler that ever read it would grant anybody's request.
    "ddjp.bot.request":   { open: true, relay: false, why: "a request to the runner, answered by authoring the settings blob" },

    // THE RUNNER'S OWN ANNOUNCEMENT. Classified rather than left out: an unclassified type is
    // refused too, but for the wrong reason, and "we never listed it" is the kind of accident that
    // reads as a decision. A client sending one would be claiming to be the runner.
    "ddjp.bot.here":      { bot: true, why: "the runner's arrival marker; a client sending one claims to be the runner" },
    // THE RUNNER'S "NO" (J65). Only the runner answers; a client sending one would be answering for it.
    "ddjp.bot.refused":   { bot: true, why: "the runner's refusal of an act; a client sending one answers for the runner" },

    // Reputation snapshots are believed rather than derived in BOTH room types, so crossing the
    // seam changes nothing about their status (J24's save-file answer says so explicitly).
    "ddjp.rep.snapshot":  { open: true, why: "reputation is believed rather than derived in both modes" },
  };

  function classify(type) { return JUDGE[type] || null; }
  // Whether an accepted act is written to the log. Everything is, except what a row says otherwise.
  function relays(type) { const j = JUDGE[type]; return !(j && j.relay === false); }
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

  // ── THE JUDGE ASKS THE REDUCER TOO (J73 job 2, Q3) ─────────────────────────────────────────
  // `_permit` asks about RANK. That relayed a VIP's skip naming a song that had just ended, which the
  // reducer then refused (`advance-locked`) — a refused act in the bot's log, counted by its
  // background read (`tools/probes/probe-j73-refused-relay.js`). So, given the held log, the judge
  // folds it PLUS what the bot has already committed to send (submitted, not yet echoed) and judges
  // the candidate against THAT: rank on the state those acts will make, legality by the reducer.
  // Committed acts are folded so an act depending on one still echoing (a declare after a join) is
  // not falsely refused — a race that refused it even before this, on rank. A refusal about TIMING
  // ("too-early") lets the act through: the relay lands later than it is judged, and the reducer
  // decides then. `check-judge-reducer` holds all three.
  const COMMITTED_MS = 30000;
  let _committed = [];                       // [{ ev, at }] submitted, not yet seen in the held log
  function _noteCommitted(stamped) {
    _committed.push({ ev: stamped, at: _now() });
    if (_committed.length > 200) _committed = _committed.slice(-200);
  }
  function _committedFor(log) {
    const now = _now(), seen = new Set();
    for (const e of log) { const s = e && e.content && e.content.src; if (s) seen.add(s); }
    _committed = _committed.filter((c) => now - c.at < COMMITTED_MS && !(c.ev.src && seen.has(c.ev.src)));
    return _committed.map((c) => c.ev);
  }
  function _asEvent(ev, tag, l, ts) {
    const id = "~judge~" + tag;
    return { eventId: id, event_id: id, l: l, ts: ts, type: ev.t, content: ev, sender: ev.actor || null, senderRank: ev.rank };
  }
  function evaluate(intent, state, rank, ctx) {
    if (!ctx || !Array.isArray(ctx.log) || typeof StateDeriver === "undefined" || !intent || !intent.t) {
      return _permit(intent, state, rank);
    }
    const log = ctx.log;
    let head = 0, ts = 0;
    for (const e of log) {
      if (e && typeof e.l === "number" && e.l > head) head = e.l;
      if (e && typeof e.ts === "number" && e.ts > ts) ts = e.ts;
    }
    const pending = _committedFor(log).map((ev, i) => _asEvent(ev, "c" + i, head + 1 + i, ts));
    // ONE VOTE, ONE SAVE, PER PERSON PER PLAY — A BACKSTOP (owner's re-test, `ddjp_535`): the owner's app sent three votes for
    // one play and each was relayed. A vote or save the same person has already cast for that exact play — in the held log
    // or committed and not yet echoed — is dropped in SILENCE (`check-vote-dedupe`).
    if ((intent.t === "ddjp.dj.vote" || intent.t === "ddjp.dj.save") && intent.actor && intent.p) {
      const same = (e) => e && (e.type === intent.t || (e.content && e.content.t === intent.t)) && e.content && e.content.p === intent.p && e.sender === intent.actor;
      const dup = log.some(same) || _committedFor(log).some((ev) => ev && ev.t === intent.t && ev.p === intent.p && ev.actor === intent.actor);
      if (dup) return { ok: false, reason: "already cast for this play", code: "duplicate", silent: true };
    }
    let judged = state;
    if (pending.length) { try { judged = StateDeriver.derive(log.concat(pending), ctx.seed); } catch (e) { judged = state; } }
    const v = _permit(intent, judged, rank);
    if (!v.ok || !relays(intent.t)) return v;
    const cand = _asEvent(stamp(intent, intent.actor, rank, null, null), "candidate", head + 1 + pending.length, ts);
    let refusals = null;
    try { refusals = StateDeriver.deriveRefusals(log.concat(pending, [cand]), ctx.seed); } catch (e) { return v; }
    let r = null;
    if (Array.isArray(refusals)) r = refusals.find((x) => x && (x.eventId === cand.eventId || x.id === cand.eventId)) || null;
    else if (refusals && typeof refusals === "object") r = refusals[cand.eventId] || null;
    if (!r) return v;
    const code = String((r && r.code) || r);
    // A play that is MERELY EARLY is ignored in silence (J76): honest apps send one only `advanceBackupMs` overdue, and the
    // bot's own plays never come through here (the runner submits them directly). Any other timing-only refusal still
    // passes: the relay lands later than it is judged.
    if (code === "too-early") return (intent && intent.t === "ddjp.dj.play") ? { ok: false, reason: "a play before its time", code: code, silent: true } : v;
    let text = null;
    try { text = StateDeriver.refusalText ? StateDeriver.refusalText(code, r.detail) : null; } catch (e) { text = null; }
    return { ok: false, verb: v.verb, reason: text || code, code: code };
  }

  function _permit(intent, state, rank) {
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

  // ── THE SEND SCHEDULE, AS ONE TABLE (J65) ────────────────────────────────────────────────
  // Every number that decides WHEN the runner writes lives here and nowhere else, so what is instant
  // and what waits, how long, and what may merge can be tuned without touching the logic below. Code
  // settings, never room settings: a new settings key breaks every existing room.
  //
  //   lane "instant"  sent at once, and it takes everything waiting with it (we are sending anyway)
  //   lane "grouped"  waits up to `waitMs`; the group goes out at the FIRST of: an instant act, the
  //                   earliest deadline in it, ten acts, the runner stopping
  //   merge           only where the result cannot change: "latest-per-actor" keeps one act per person
  //                   (a newer order replaces an older one); "once-per-actor-target" keeps the first of
  //                   one person's acts on one playing (a second vote counts once anyway). A merged act
  //                   is still ANSWERED: its id travels in the survivor's `also`.
  //
  // THE CASCADE TYPES ARE INSTANT AS A CORRECTNESS REQUIREMENT (§5c): the ladder works by suppression
  // and a wait on top of the relay round trip would make every rung fire before seeing the one above.
  const POLICY = {
    answerWindowMs: 20000,     // the runner answers inside this, or drops the act as too old
    appMarginMs: 2000,         // an app gives up this long after the window
    maxPerMessage: 20,         // members share a message's position and sort by id AS TEXT; readers give batches of more than
                               // ten two-digit ids (J77), so up to 20 is valid. Raised to 20 by the owner (J77, `ddjp_534`) under
                               // the pre-release rule: no older app version is supported in an open tab
    budget: { messages: 8, perMs: 4000 },   // grouped sends wait beyond this; instant ones never do
    // A FLOOR BETWEEN INSTANT SENDS, built and OFF (owner, J72): 0 sends each at once, as before.
    // Set above 0 and an instant act arriving sooner waits its turn, in order, nothing dropped —
    // for if a homeserver ever rate-limits the bot. It would delay "next song" and skips.
    // THE SECURITY GATE (J76). It opens every intervalMs; whatever is due goes out at the next opening, together and
    // IN ACCEPTED ORDER; nothing is ever sent between openings. At most messagesPerOpening messages an opening (~2 a
    // second). Bypass (off) would let an urgent act open it early — still taking everything ahead of it.
    gate: { intervalMs: 500, messagesPerOpening: 1, bypass: false, bypassPerOpening: 1 },
    // ONE PERSON'S GROUPED ACTS, as a RATE: more than `acts` inside `perMs` is refused as too fast.
    // It was a count per group, which could never fire — a group leaves at ten (found driving it).
    // Merged acts do not count; instant acts are never capped (the cascade must not be throttled).
    perActor: { acts: 12, perMs: 10000 },
    types: {
      "ddjp.dj.play":       { lane: "instant" },
      "ddjp.dj.skip":       { lane: "instant" },
      "ddjp.media.skip":    { lane: "instant" },
      "ddjp.media.len":     { lane: "grouped", waitMs: 1000 },   // J76 Q2: groups normally
      "ddjp.play.len":      { lane: "grouped", waitMs: 1000 },   // J76 Q2: groups normally
      "ddjp.play.blocked":  { lane: "grouped", waitMs: 1000 },   // J76 Q2: groups normally
      "ddjp.dj.join":       { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.leave":      { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.declare":    { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.undeclare":  { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.order":      { lane: "grouped", waitMs: 1000, merge: "latest-per-actor" },
      "ddjp.dj.move":       { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.remove":     { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.strike":     { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.reset":      { lane: "grouped", waitMs: 1000 },
      "ddjp.room.settings": { lane: "grouped", waitMs: 1000 },
      "ddjp.count.set":     { lane: "grouped", waitMs: 1000 },
      "ddjp.dj.vote":       { lane: "grouped", waitMs: 5000, merge: "once-per-actor-target" },
      "ddjp.dj.save":       { lane: "grouped", waitMs: 5000, merge: "once-per-actor-target" },
      "ddjp.rep.snapshot":  { lane: "grouped", waitMs: 10000, merge: "latest-per-actor" },
      "ddjp.bot.refused":   { lane: "grouped", waitMs: 1000 },
    },
  };
  const URGENT = Object.keys(POLICY.types).filter((t) => POLICY.types[t].lane === "instant");
  function isUrgent(type) { return URGENT.indexOf(type) >= 0; }
  function policyOf(type) { return POLICY.types[type] || null; }

  // THE TABLE CHECKS ITSELF, and the runner refuses to start on a table that fails (J65). Every act
  // the runner can relay needs a row — a missing one would otherwise inherit a guessed default — and
  // every wait must sit well inside the answer window, or a grouped act could miss its own deadline.
  function validatePolicy() {
    const out = [];
    for (const t of Object.keys(JUDGE)) {
      const j = JUDGE[t];
      if (j.bot || j.relay === false) continue;
      if (!POLICY.types[t]) out.push(t + ": relayed but has no send row");
    }
    for (const t of Object.keys(POLICY.types)) {
      const r = POLICY.types[t];
      if (r.lane === "instant" && r.waitMs) out.push(t + ": an instant row may not wait");
      if (r.lane === "grouped" && !(typeof r.waitMs === "number" && r.waitMs > 0 && r.waitMs <= POLICY.answerWindowMs / 2)) {
        out.push(t + ": a grouped wait must be positive and at most half the answer window");
      }
      if (r.lane !== "instant" && r.lane !== "grouped") out.push(t + ": unknown lane " + r.lane);
    }
    if (!(POLICY.maxPerMessage >= 1 && POLICY.maxPerMessage <= 20)) out.push("maxPerMessage must be 1..20");   // J77: readers sort up to 20
    if (!(POLICY.budget.messages >= 2 && POLICY.budget.perMs > 0)) out.push("budget must allow at least two messages");
    if (!(POLICY.perActor.acts >= 1 && POLICY.perActor.perMs > 0)) out.push("perActor must allow at least one act");
    const G = POLICY.gate || {};
    if (!(typeof G.intervalMs === "number" && G.intervalMs > 0 && G.intervalMs <= POLICY.answerWindowMs / 4)) out.push("gate.intervalMs must be positive and a small fraction of the answer window");
    if (!(Number.isInteger(G.messagesPerOpening) && G.messagesPerOpening >= 1 && G.messagesPerOpening <= POLICY.budget.messages)) out.push("gate.messagesPerOpening must be 1..budget.messages");
    if (typeof G.bypass !== "boolean") out.push("gate.bypass must be true or false");
    if (!(Number.isInteger(G.bypassPerOpening) && G.bypassPerOpening >= 0 && G.bypassPerOpening <= G.messagesPerOpening)) out.push("gate.bypassPerOpening must be 0..messagesPerOpening");
    if (!(Number.isInteger(POLICY.perActor.acts) && POLICY.perActor.acts <= 1000)) out.push("perActor.acts must be a whole number");
    if (!(Number.isInteger(POLICY.maxPerMessage))) out.push("maxPerMessage must be a whole number");
    return out;
  }

  // A ceiling on what may wait. Backend1 bounds everything it accumulates, and an unbounded queue
  // here would be the one place in the engine that grows forever.
  const MAX_PENDING = 500;
  let _q = [];                 // THE ONE ORDERED QUEUE (J76): [{ ev | raw, due, actor }] in ACCEPTED order
  let _sentAt = [];            // local times of recent sends, for the budget (local minus local)
  let _send = null;            // injected: (type, payload) => Promise, so this file needs no transport
  let _now = () => Date.now(); // injectable LOCAL clock: only durations between local readings
  let _windowMs = 1000;        // kept for callers that ask; the schedule reads POLICY
  let _merged = 0;
  let _actorAt = new Map();    // actor -> local times of their recent grouped acts (the rate cap)
  let _lastOpenAt = -Infinity;   // the last opening, so openings stay at least gate.intervalMs apart (J76)
  let _bypassUsed = 0;         // urgent acts that opened the gate early since the last regular opening (bypass off)

  function attach(sendFn, opts) {
    _send = (typeof sendFn === "function") ? sendFn : null;
    if (opts && typeof opts.windowMs === "number") _windowMs = opts.windowMs;
    if (opts && typeof opts.now === "function") _now = opts.now;
    return true;
  }
  function windowMs() { return _windowMs; }
  function pending() { return _q.length; }
  // Committed but NOT yet sent: the grouped buffer AND the urgent queue (J73, the daily reload's quiet moment).
  function unsent() { return _q.length; }
  function merged() { return _merged; }
  // `_committed` too (J73 job 2): acts committed in one room must not be folded into the next room's
  // judgements. `B2Runner.start` calls this on room entry; `check-judge-reducer` PART E holds it.
  function reset() { _q = []; _sentAt = []; _merged = 0; _actorAt = new Map(); _bypassUsed = 0; _lastOpenAt = -Infinity; _committed = []; }



  // Build what the runner writes: the decision, plus who asked and when they asked it.
  //
  // ── THE AUTHOR'S `l` IS REMOVED HERE, AND THAT IS THE FIX FOR THE LOST SONGS (J64) ─────────
  // This said "no `l` here — `sendEvent` stamps it" and copied the intent wholesale, author's `l`
  // included. True for an instant relay, whose envelope `sendEvent` builds and overwrites. FALSE for
  // a grouped one: `sendEvent` stamps only the carrying `ddjp.batch`, so each member kept the
  // AUTHOR'S position — and `backends/backend2/streammanager.js` prefers a member's own `l` over its
  // carrier's. Any instant relay sent while the group waited carried a higher position, so the
  // group's members arrived "claiming the past" and every door refused them as backdated. Bot-501
  // lost two songs that way (l=33 behind 35–37, l=58 behind 60–64). Two files each believed the
  // other dropped the field. Now nothing in a relay carries a position but the message it rides in:
  // the runner is the only writer, so its own clock orders everything it writes.
  function stamp(intent, actor, rank, srcEventId, at) {
    const out = Object.assign({}, intent);
    delete out.l;
    out.actor = actor;
    out.rank = rank;
    out.src = srcEventId || null;
    // `at` is null by the owner's ruling (J64): a relayed act folds at the relay's own time.
    out.at = (typeof at === "number") ? at : null;
    return out;
  }

  // THE ANSWER "NO" (J65). Bot mode used to publish no refusals: an act that did not stand simply
  // vanished, and the asking app could only guess. Now every request is answered once — the result
  // appearing is "yes", this is "no" — so an app never waits on silence. Inert in the fold (the
  // reducer has no branch for it), grouped like any act, attributed to the person it answers.
  function refusal(intent, actor, rank, srcEventId, reason) {
    return { t: "ddjp.bot.refused", of: (intent && intent.t) || null, reason: String(reason || "refused"),
             actor: actor, rank: rank, src: srcEventId || null, at: null };
  }

  function _budgetLeft(now) {
    _sentAt = _sentAt.filter((t) => now - t < POLICY.budget.perMs);
    return POLICY.budget.messages - _sentAt.length;
  }
  function _emit(type, payload, now) {
    _sentAt.push(now);
    return _send(type, payload);
  }

  // Merge a grouped act into what is waiting, when its row allows. Answers `true` when absorbed.
  // MERGING NEVER REORDERS (J76). `latest-per-actor`: the earlier act is dropped and the NEW one keeps its own place in
  // accepted order — keeping the earlier place could put a merged order ahead of a declare accepted between the two.
  // `once-per-actor-target`: the first is kept and the duplicate dropped. The dropped act leaves the judge's committed
  // list too, so nothing folds an act that will never be sent.
  function _mergeInto(stamped) {
    const rule = (policyOf(stamped.t) || {}).merge;
    if (!rule) return false;
    for (let k = 0; k < _q.length; k++) {
      const item = _q[k], e = item.ev;
      if (!e || e.t !== stamped.t || e.actor !== stamped.actor) continue;
      if (rule === "once-per-actor-target" && e.p !== stamped.p) continue;
      if (rule === "latest-per-actor") {
        const also = (e.also || []).concat(e.src ? [e.src] : []);
        _q.splice(k, 1);
        _committed = _committed.filter((c) => c.ev !== e);
        _merged++;
        return { replaced: Object.assign({}, stamped, { also: also.concat(stamped.also || []) }) };
      }
      e.also = (e.also || []).concat(stamped.src ? [stamped.src] : []);
      _merged++;
      return { dropped: true };
    }
    return false;
  }


  // Accepted -> out, on the schedule above. Answers what happened, so the caller can count it.
  // ACCEPT, NEVER SEND (J76). Every act — urgent ones included — meets the per-person limit first; an act over it is
  // dropped in SILENCE (owner, Q1: the "too many acts at once" refusal could never be sent, so it is gone). Accepted
  // acts join the ONE queue in accepted order; only the gate's openings send. "Urgent" is due at the next opening.
  function submit(stamped) {
    if (!stamped || !stamped.t) return { sent: false, reason: "nothing to send" };
    const now = _now();
    if (stamped.actor) {
      const recent = (_actorAt.get(stamped.actor) || []).filter((t) => now - t < POLICY.perActor.perMs);
      if (recent.length >= POLICY.perActor.acts) { _actorAt.set(stamped.actor, recent); return { sent: false, tooFast: true }; }
      recent.push(now);
      _actorAt.set(stamped.actor, recent);
    }
    const m = _mergeInto(stamped);
    if (m && m.dropped) return { sent: false, batched: true, merged: true };
    const ev = (m && m.replaced) ? m.replaced : stamped;
    _noteCommitted(ev);                   // the judge folds it until it echoes (J73 job 2)
    const urgent = isUrgent(ev.t);
    const row = policyOf(ev.t);
    const wait = urgent ? 0 : ((row && typeof row.waitMs === "number") ? row.waitMs : 1000);
    let dropped = 0;
    // THE SUBMITTER LEARNS ITS ID AT SEND TIME (J76): the gate resolves this with the id the act really got — the
    // carrier's own, or `carrier#k` as the k-th member of a batch, exactly as every reader names it.
    let resolve = null;
    const promise = new Promise((res) => { resolve = res; });
    _q.push({ ev: ev, due: now + wait, actor: ev.actor || null, resolve: resolve });
    while (_q.length > MAX_PENDING) { _q.shift(); dropped++; }
    if (urgent && POLICY.gate.bypass === true && _bypassUsed < POLICY.gate.bypassPerOpening) { _bypassUsed++; _open(now, false); }
    return { sent: false, batched: !urgent, queued: true, merged: !!(m && m.replaced), dropped: dropped, promise: promise };
  }
  // The runner's own writes (`ddjp.bot.here`, the seal) take their place in the same queue: the gate is the only door
  // out of `events_owner` (J76). Due at once, so they go at the next opening with everything accepted before them.
  function submitRaw(type, payload) {
    if (!type) return { queued: false };
    _q.push({ raw: { type: type, payload: payload || {} }, due: _now(), actor: null });
    return { queued: true };
  }


  // THE CLOCK SIDE OF THE SCHEDULE. Called by the runner's timer AND on every message that arrives,
  // because a background tab slows timers but still receives messages.
  // ONE OPENING OF THE GATE (J76). The runner calls this every POLICY.gate.intervalMs and at no other time. Everything
  // accepted up to the LAST due item goes, in accepted order — an urgent item takes everything ahead of it — in at most
  // messagesPerOpening messages, each within the budget (kept as a second check, owner Q3). Nothing due, nothing sent.
  // An opening COUNTS when it sends: `_lastOpenAt` marks the last opening that sent anything, so sends stay at least
  // gate.intervalMs apart (the cap) and a due act leaves at its first trigger once that much has passed (J76).
  function tick() { _bypassUsed = 0; const now = _now(); const r = _open(now, false); if (r && r.sent > 0) _lastOpenAt = now; return r; }
  // THE RUNNER'S DOOR TO THE GATE. Its timer AND every arriving message call this; it opens only when gate.intervalMs
  // has passed since the last opening. A background tab slows timers but still receives messages, so an arriving message
  // may be what opens a due gate — never more often than the interval, so the cap and "never between openings" hold.
  // Refused within the spacing, it says how long remains and whether an URGENT act is waiting, so the runner can schedule
  // one opening for exactly when the spacing ends (the one-shot, J76 at the audit).
  function openIfDue() {
    const now = _now(), gap = now - _lastOpenAt;
    if (gap < POLICY.gate.intervalMs) return { sent: 0, reason: "between-openings", waitMs: POLICY.gate.intervalMs - gap,
      urgent: _q.some((x) => !x.raw && isUrgent(x.ev.t)) };
    return tick();
  }
  function _open(now, all) {
    if (!_q.length) return { sent: 0 };
    if (!_send) return { sent: 0, reason: "nothing attached to send through" };
    // DUE BY THE EXISTING TIMING SYSTEM, unchanged (owner: "the existing timing system stays exactly as it is"): the
    // waiting group is due when its EARLIEST member is due, or at once when it is full (`maxPerMessage`); an urgent act
    // and the runner's own writes are due at once. The opening sends everything up to the last due item, in order.
    let earliest = Infinity, grouped = 0;
    for (const x of _q) if (!x.raw && !isUrgent(x.ev.t)) { grouped++; if (x.due < earliest) earliest = x.due; }
    const groupDue = all || earliest <= now || grouped >= POLICY.maxPerMessage;
    let last = -1;
    for (let i = 0; i < _q.length; i++) if (all || _q[i].raw || isUrgent(_q[i].ev.t) || groupDue) last = i;
    if (last < 0) return { sent: 0, waiting: _q.length };
    let sent = 0, messages = 0;
    while (last >= 0 && (all || messages < POLICY.gate.messagesPerOpening)) {
      if (!all && _budgetLeft(now) < 1) return { sent: sent, waiting: _q.length, reason: "budget" };
      const items = [];
      if (_q[0].raw) items.push(_q[0]);
      else for (let i = 0; i <= last && items.length < POLICY.maxPerMessage && !_q[i].raw; i++) items.push(_q[i]);
      _q = _q.slice(items.length); last -= items.length;
      const requeue = function () { _q = items.concat(_q); };
      let out = null;
      try {
        if (items[0].raw) out = _emit(items[0].raw.type, items[0].raw.payload, now);
        else if (items.length === 1 && isUrgent(items[0].ev.t)) out = _emit(items[0].ev.t, items[0].ev, now);
        else out = _emit("ddjp.batch", { evs: items.map((x) => x.ev) }, now);
      } catch (e) { requeue(); return { sent: sent, failed: _q.length }; }
      const batch = !items[0].raw && !(items.length === 1 && isUrgent(items[0].ev.t));
      const named = function (res) {
        const id = (res && typeof res === "object") ? res.eventId : (typeof res === "string" ? res : null);
        if (!id) return;
        // The id every reader gives it (J77: `B2StreamManager.memberId`, the one home of member naming).
        const nameOf = (k) => (typeof B2StreamManager !== "undefined" && B2StreamManager.memberId) ? B2StreamManager.memberId(id, k, items.length) : null;
        items.forEach(function (x, k) { if (x.resolve) x.resolve({ eventId: batch ? nameOf(k) : id, carrier: id, member: batch ? k : null }); });
      };
      const thenable = !!(out && typeof out.then === "function"), catchable = !!(out && typeof out.catch === "function");
      if (catchable) out.catch(requeue);                    // a rejection puts the acts back, as before
      if (thenable) out.then(named, function () {});
      else if (!catchable) named(out);                      // a synchronous result names them at once
      sent += items.length; messages++;
    }
    return { sent: sent, waiting: _q.length };
  }


  // THE BUFFER IS NOT CLEARED UNTIL THE SEND HAS BEEN ACCEPTED. A rejection puts the acts back AT THE
  // FRONT, ahead of anything queued since. At most ten per message (POLICY.maxPerMessage).

  // Everything waiting, now — for the runner stopping, and for callers that must not wait.
  // THE CLOSING OPENING: the runner calls this once, when it stops, so nothing accepted is lost — everything queued
  // goes, in accepted order. The one opening outside the gate's timer (recorded in J76).
  function flush() { return _open(_now(), true); }
  const MAX_PER_MESSAGE = POLICY.maxPerMessage;

  return {
    classify, judged, evaluate, stamp, submit, submitRaw, flush, tick, openIfDue, attach, reset, relays, refusal,
    isUrgent, pending, unsent, merged, windowMs, URGENT, MAX_PER_MESSAGE, POLICY, policyOf, validatePolicy,
  };
})();
