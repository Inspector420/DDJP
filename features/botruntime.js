// features/botruntime.js — the bot runtime.
//
// Depends on: MatrixBridge, BotSettings, Logger. Reads Room only through what it is handed.
//
// ── WHAT THIS IS, AND WHY IT IS ITS OWN JOB ─────────────────────────────────────────────────
// J17 designed the bot, J18 built delegated settings, J19 built the reputation tally, and this is
// their caller. **UNTIL v322 IT HAD NONE**: this file existed, `index.html` loaded it, guards drove
// it, and the only mention of `BotRuntime` anywhere else in the tree was a comment in
// matrixbridge.js saying nothing called `start()`. Three modules, loaded and dead in every running
// client — which is why `check-bot-wiring` is structural rather than behavioural.
//
// It is REACHED NOW, from `features/room.js` `_evaluateBot`, at the one door both room-entry paths
// share, plus the rank hook so a promotion or demotion lands immediately. `botsettings.js` and
// `reputation.js` are still pure libraries with no timer and no subscription of their own — that
// part of the original note stands, and it is what keeps their policy drivable without a room.
//
// It is deliberately ONE job with ONE deliverable, because building the runtime and a feature on
// it together would give any failure two candidate causes.
//
// ── THE ENTRY GATE: EXACTLY 99, NOT "OWNER-TIER" ────────────────────────────────────────────
// DRIVEN before choosing, because a rank check reads as obviously right and is not:
//
//     nameOf(98) = "high-staff"   atLeast(98,"owner") = false
//     nameOf(99) = "owner"        atLeast(99,"owner") = true
//     nameOf(100) = "owner"       atLeast(100,"owner") = true      <-- the human owner
//     nameOf(101) = "owner"       atLeast(101,"owner") = true
//
// `Ranks.LADDER` tops out at 99, so `nameOf` saturates: **every level at or above 99 answers
// "owner"**, and a rank check admits the human's own tab as well as the bot. That is convenient
// for testing and it is the wrong trade, because it puts **two authorities on the settings
// channel** — the human writing settings from the panel and the bot writing them from a delegated
// request, both legitimately, with no ordering between them. That is the lost-update failure J17
// measured, now with both hands on the wheel: settings are LAST-WRITE-WINS over a whole blob, so
// two concurrent writers do not merge, they overwrite, and the loser's change vanishes with
// nothing anywhere reporting it.
//
// **So the gate is `=== 99` exactly**, and a human owner at 100 is refused with a reason that says
// which number it saw. The convenience is real and is given up on purpose; the alternative buys
// testing comfort with a silent data-loss mode.
//
// AND THE LEVEL COMES FROM THE TRANSPORT READING IT BACK. `MatrixBridge.getMyPowerLevel(roomId)`
// returns what `m.room.power_levels` says on the server. Authority in this project is proved by
// what Matrix says and never by a claim about itself — **a client asking about itself is the same
// rule**, and a runtime that trusted a local "I am the bot" flag would be the one place in the
// tree where authority was self-asserted.
//
// ── THE RUNTIME HOLDS NO CONFIGURATION OF ITS OWN ───────────────────────────────────────────
// J17 decided it and J18 built it: the bot reads ROOM SETTINGS and acts on them. The rule here is
// therefore NEGATIVE — no constants, no local defaults, no second source. The moment there are
// two, they disagree and nobody notices, because the local one wins in the code and the room's one
// wins in the docs.
//
// **NOTHING THIS RUNTIME DOES NEEDS A KEY IT DOES NOT HAVE**, which is why it can be built without
// adding one. Watching is event-driven — a subscription, not a poll — so there is no interval to
// configure, and the delegation policy it applies is `botDelegation`, read fresh from settings on
// every request.
//
// **WHAT WOULD HAVE NEEDED A KEY, AND IS THEREFORE NOT BUILT: publishing reputation snapshots on
// a cadence.** `Reputation.publish` exists and this runtime does not call it, because "how often"
// has no settings key and inventing a local default is exactly the second source this rule
// forbids. J17's schema was enumerated once precisely because adding a key later is expensive —
// it moves every checkpoint fingerprint and reopens the dead-checkpoint window — so the honest
// answer is to name the gap rather than paper over it. A later job that wants scheduled snapshots
// adds the key and pays that cost knowingly.
//
// ── ONE BEHAVIOUR, ONE SEAM, AND THE SECOND IS NOT PRE-BUILT ────────────────────────────────
// Bot mode will differ in a centralized bot-run room, and **that room type does not exist**.
// `consensus/backend-selection.md` is explicit that a seam must not be built before a second
// engine exists, or it recreates the dead branch that was deleted. So `MODES` has exactly one
// entry and the runtime dispatches through it — addable, not added. There is no second mode, no
// `if (centralized)`, and no configuration selecting between them.
const BotRuntime = (() => {

  // ── THE MODES TABLE — ONE ENTRY, SHAPED SO A SECOND IS ADDABLE ────────────────────────────
  // A table rather than a branch, because a table with one row is honest about being a table while
  // an `if` with one arm is a branch pretending to be a decision. Adding a mode means adding a row
  // and a reason; it does not mean finding every place a condition was assumed.
  //
  // NOT PRE-BUILT: there is no "centralized" row here, because the room type it would serve does
  // not exist and a row for it would be a dead branch of exactly the kind this project deleted.
  const MODES = {
    consensus: {
      // The only room type that exists. The bot is a peer with owner-tier power that acts on
      // requests; it authors nothing on its own initiative.
      why: "the only room type that exists — the bot is a peer holding owner-tier power",
      handles: ["ddjp.bot.request"],
    },
  };
  const DEFAULT_MODE = "consensus";

  // ── THE GATE — PURE, SO THE FORK CAN BE DRIVEN AT EXPLICIT VALUES ─────────────────────────
  // `level` is the number the transport read back. TOTAL: every path answers, none throws, and a
  // level that could not be read is refused with its own reason rather than collapsing into "too
  // low" — 0 is a real level and null is "I could not tell", and a gate that confused them would
  // refuse correctly today for the wrong reason.
  // ── THE BOT'S LEVEL IS THE LADDER'S TOP RUNG, DERIVED — NOT A LITERAL 99 ──────────────────
  // This was `const BOT_LEVEL = 99`, which RESTATED the ladder. Two sources for one number, and
  // the rule this project applies everywhere else says they disagree eventually and nobody
  // notices. DRIVEN: moving the rung to 97 and leaving this at 99 left the guard red — but on a
  // CONTROL about saturation, so a reader was sent to look at `atLeast` rather than at the
  // constant that had stopped agreeing. **A guard that reports the wrong subject is worse than
  // one that reports nothing**, because it spends the reader's attention in the wrong file.
  //
  // `Room.rankLadder()` is the legal route from `features/` — a defensive copy of
  // `Capabilities.LADDER`, so no backend internal is named here (`check-boundaries` rule F).
  // THERE IS NO FALLBACK: an unreadable ladder answers null and the gate refuses, because a
  // default here would be the second source this change exists to remove.
  function botLevel() {
    let ladder = null;
    try { ladder = Room.rankLadder(); } catch (e) { return null; }
    if (!Array.isArray(ladder) || !ladder.length) return null;
    let top = null;
    for (const r of ladder) {
      if (!r || typeof r.level !== "number" || !isFinite(r.level)) continue;
      if (top === null || r.level > top) top = r.level;
    }
    return top;
  }

  // ── WHAT THE BOT MAY BE OFFERED (J52, extended) ───────────────────────────────────────────
  // THE BOT SITS ON THE LADDER'S TOP RUNG, SO EVERY OWNER CONTROL READS AS PERMITTED FOR IT.
  // `Capabilities.atLeast(level, "owner")` is true at 99 and at 100, and the whole UI asks exactly
  // that question — so measured across the catalogue, **all 19 actions resolve identically for the
  // bot and for a human owner**. The display cannot tell them apart at all.
  //
  // THE ENFORCEMENT IS NOT WRONG AND IS NOT WEAKENED HERE. `RoomUpgrade._mayUpgrade` already
  // refuses the bot by comparing its level against `spaceChildLevel()`; `Room.setSettings` already
  // gates its own write. This is a DISPLAY rule and it is deliberately one-directional: it can
  // only ever hide a control, never admit one. The bot's own act paths do not pass through here —
  // the AFK sweep calls `Queue.remove` directly and a request writes through the `authorSettings`
  // closure — so nothing the bot legitimately does depends on this answer.
  //
  // FAIL-CLOSED, AND THAT IS THE POINT RATHER THAN A DETAIL. The default for an owner-gated act is
  // NOT OFFERED. A new row added to `Ranks.GATES` at `"owner"` is therefore hidden from the bot the
  // day it is written, before anybody remembers this file exists — which is the difference between
  // a rule and a rule with something running it. `check-bot-owner-ui` then turns red until the act
  // has a REASON below, so the omission surfaces as a build failure rather than as a silent denial
  // a person cannot account for.
  //
  // THE REASONS ARE LOAD-BEARING, NOT DECORATION. A disabled control with no explanation is the
  // shape that produced two labelling defects this project has already shipped — a rank called
  // "Owner" that appoints a bot, and a header calling the human owner "Bot". Somebody reading the
  // bot's screen has to be able to tell "this account may not do that" from "this is broken".
  const BOT_MAY_NOT = {
    "room.upgrade":
      "The bot never upgrades the room. `room.upgrade` is a permission-gated act rather than a "
      + "settings key, so it cannot even be requested of the bot — and the homeserver requires a "
      + "higher level than the bot holds, so the act would fail partway through.",
    "room.settings":
      "The bot changes settings only when asked, through `ddjp.bot.request`. Editing them here "
      + "would be the bot acting on its own initiative, which is the one thing its design rules out.",
    "member.ban":
      "The bot never bans. Its only removal is the AFK sweep's kick, because being away is not "
      + "misconduct and a ban would turn a reversible reading into a permanent one on a schedule.",
    // NO UI CONTROL EXISTS FOR THIS ONE TODAY, AND IT IS CLASSIFIED ANYWAY. `capabilities.js` has
    // no verb for `count.set` and says so deliberately — a note that also records it has been
    // re-investigated three times as a suspected gap. The row is here because the decision is
    // cheap to write now and the control is exactly the kind that gets added by somebody who never
    // reads this file. `check-bot-owner-ui` PART B is what required it: the owner acts are derived
    // from `Ranks.GATES`, so this was the one row the shipped code had and the table did not.
    "count.set":
      "The bot never sets the vote or save baseline. It is a permission-gated act rather than a "
      + "settings key, so it cannot be requested of the bot — and an absolute count written by "
      + "anything other than a person is a number the room cannot account for.",
  };

  // Is THIS client currently running as the room's bot? `_running` is set by `start()` and cleared
  // by `stop()`, and `_evaluateBot` stops before it starts on every room entry — so this is false
  // for a human owner in every room, including one where some other account is the bot.
  function actingAsBot() { return !!_running; }

  // May this client be OFFERED `act`? TOTAL, and answers for any input.
  //
  // NOT ACTING AS THE BOT -> every act is offered exactly as before. This function is incapable of
  // changing what a human owner sees, which is what keeps it from becoming a second permission
  // system competing with `Capabilities`.
  // THE GATE COMES THROUGH `Capabilities`, NOT FROM `Ranks`. `features/` may not name a backend
  // internal (check-boundaries rule F, which caught this file doing exactly that), so the rank
  // vocabulary is re-exported on the capabilities seam and this reads it there. One table in the
  // reducer with a second CALLER — never a second copy, and never a numeric threshold held here.
  function mayOffer(act) {
    if (!actingAsBot()) return { may: true, why: null };
    let gate = null;
    try { gate = (typeof Capabilities !== "undefined" && Capabilities.gateFor) ? Capabilities.gateFor(act) : null; }
    catch (e) { gate = null; }
    if (gate !== "owner") return { may: true, why: null };
    const why = BOT_MAY_NOT[String(act)];
    // An owner-gated act with no reason written is still REFUSED — the guard is what makes the
    // missing reason visible, and a denial without one is safer than an offer without one.
    return { may: false, why: why || "This account is the room's bot and may not take owner acts." };
  }

  // ── SHOULD THIS CLIENT LOAD THE MEDIA? ────────────────────────────────────────────────────
  // TRUE only when this client is RUNNING as the room's bot and its device-local view is off.
  // That is the one and only difference between the bot and any other owner: `playback.js` holds
  // no bot rule at all, and everything the deleted rules used to buy falls out of there being no
  // player — no measured duration, so no length declared and no wall-clock advance; no `onError`,
  // so no `ddjp.play.blocked`. That last one is not cosmetic: blocked reports feed the auto-skip
  // roads, so a deliberate non-watcher reporting "blocked" would help vote off a song everyone
  // else can see fine.
  //
  // IT LIVES HERE RATHER THAN IN THE PANEL SO IT CAN BE DRIVEN. As a private helper inside
  // `interface.js` the only thing a guard could do was regex the source — and it did, and the
  // regex matched the defensive `typeof` lines rather than the decision, so deleting either real
  // check left the suite green. A function with four inputs and four answers can be asserted
  // instead of described.
  //
  // BOTH HALVES, ASKED LIVE. Bot-ness alone would darken a human owner who merely holds the same
  // level; the setting alone would darken everybody. TOTAL — anything unreadable answers false,
  // so an unknown state LOADS the video and behaves like every other client rather than silently
  // going dark.
  function viewOff() {
    if (!actingAsBot()) return false;
    try {
      if (typeof ChatPrefs === "undefined" || typeof ChatPrefs.botView !== "function") return false;
      return ChatPrefs.botView() !== true;
    } catch (e) { return false; }
  }

  function eligible(level) {
    // Read first, so a ladder that cannot be read refuses before anything is compared against it.
    const BOT_LEVEL = botLevel();
    if (BOT_LEVEL === null) {
      return { ok: false, reason: "no-ladder", detail: "the rank ladder could not be read, so " +
               "there is no bot level to compare against" };
    }
    if (level === null || level === undefined) {
      return { ok: false, reason: "unreadable", detail: "the power level could not be read from the room" };
    }
    if (typeof level !== "number" || !isFinite(level)) {
      return { ok: false, reason: "unreadable", detail: "the power level is not a number" };
    }
    if (level === BOT_LEVEL) return { ok: true, reason: null, detail: null, level: level };
    // The human owner's case gets its OWN reason, because "you are too powerful" is a sentence
    // nobody expects and a generic refusal would send them looking for a permission problem.
    if (level > BOT_LEVEL) {
      return { ok: false, reason: "not-the-bot",
               detail: "level " + level + " is above the bot's " + BOT_LEVEL + " — bot mode is for " +
                       "the bot account only, so a room never has two authorities writing settings" };
    }
    return { ok: false, reason: "too-low",
             detail: "level " + level + " is below the bot's " + BOT_LEVEL };
  }

  let _running = null;     // { mode, roomId, level, off } while running; null otherwise
  let _sweepTimer = null;
  // A minute. Fast enough that the shortest legal `botPingMs` is sampled several times over, slow
  // enough to cost nothing — the pass is a walk of the rotation, which is bounded by how many
  // people can hold a deck.
  const SWEEP_EVERY_MS = 60000;

  // ── START — the level is READ, never passed in ────────────────────────────────────────────
  // Deliberately takes no level argument. A caller that could supply one could supply 99, and the
  // gate would be checking the caller's claim rather than the room's state — which is the one thing
  // this project never does. The room id and channels come from the caller; the AUTHORITY does not.
  function start(opts) {
    const o = opts || {};
    if (_running) return { ok: false, reason: "already-running", detail: "bot mode is already on" };
    const roomId = o.roomId;
    if (!roomId) return { ok: false, reason: "no-room", detail: "no room to run in" };

    let level = null;
    try { level = MatrixBridge.getMyPowerLevel(roomId); }
    catch (e) { level = null; }
    const gate = eligible(level);
    if (!gate.ok) {
      Logger.warn("BotRuntime: refused (" + gate.reason + ") — " + gate.detail);
      return gate;
    }

    const mode = MODES[o.mode || DEFAULT_MODE];
    if (!mode) return { ok: false, reason: "no-such-mode", detail: "unknown mode " + o.mode };

    // WATCHING IS A SUBSCRIPTION, NOT A POLL — which is why this runtime needs no interval and
    // therefore no cadence key. The handler is kept so it can be removed by identity: passing null
    // to an off() that ignores it is the leak `features/chat.js` already had to fix once.
    const handler = (raw, event, room) => _onRaw(raw, event, room);
    // ── AND CHAT, WHICH THE SPINE CANNOT CARRY ────────────────────────────────────────────────
    // Additive: `Chat.onMessage` is a LIST, so this does not displace the panel's renderer. It was
    // a single slot until this needed a second subscriber, which would have stopped chat rendering
    // with no error anywhere.
    //
    // `_chatSince` STARTS THE CLOCK ON THE OBSERVATION, not on the bot. Everything before this
    // moment is unseen, and the sweeps refuse to conclude from an observation shorter than the
    // window they are judging.
    // ── THE OBSERVATIONS BELONG TO A ROOM, AND THIS IS WHERE THAT IS DECIDED ─────────────────
    // Cleared on a CHANGE of room rather than on every stop, because `stop()` also runs on a rank
    // change in the same room. Measured both ways: with a fresh observation, keeping the map
    // answers "active" — which is TRUE in the same room and FALSE in a different one. Nobody is
    // wrongly removed either way (both paths keep the person), so what this decides is whether the
    // bot's report is honest, which is the whole of the defect.
    //
    // COMPARED AGAINST THE ROOM THE OBSERVATIONS ARE ABOUT, not against `_running`, which is null
    // here by definition — `stop()` runs before every `start()`.
    if (_chatRoom !== roomId) {
      _chatSeen = Object.create(null);
      _chatRoom = roomId;
    }
    try {
      if (typeof Chat !== "undefined" && typeof Chat.onMessage === "function") {
        // ADDITIVE AND IDEMPOTENT: `onMessage` dedupes by identity and `_noteChat` is one stable
        // reference, so a restart re-subscribes to nothing. Verified rather than assumed.
        Chat.onMessage(_noteChat);
        let t0 = 0;
        try { t0 = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0; }
        catch (e) { t0 = 0; }
        _chatSince = t0;
      }
    } catch (e) { _chatSince = 0; }

    try { MatrixBridge.onRawEvent(handler); }
    catch (e) { return { ok: false, reason: "no-transport", detail: e && e.message }; }

    _running = { mode: o.mode || DEFAULT_MODE, roomId: roomId, level: level,
                 channels: o.channels || null, authorSettings: o.authorSettings || null,
                 handler: handler, seen: 0, acted: 0, refused: 0, noType: 0, notHandled: 0 };
    // ── THE SWEEP TICK ────────────────────────────────────────────────────────────────────
    // The watch loop above needs no timer — it is a subscription. This does: nobody EMITS an
    // event when somebody stops doing things, so idleness can only be noticed by looking.
    //
    // THE INTERVAL IS NOT A SETTING, and that is deliberate. It is how often the bot LOOKS, not
    // how long anybody is given — `queueIdleMs` and `botPingMs` decide that, and both are read
    // fresh inside every pass. A third dial here would be a second answer to a question those two
    // already settle, and an owner could set it longer than the windows it samples and silently
    // make them mean nothing.
    // TYPEOF-GUARDED, and the runtime starts either way. A host with no timers still watches for
    // requests — the subscription needs none — so failing the whole start here would trade the
    // half that works for the half that does not. `sweepIdle` stays callable directly, which is
    // also how it is driven.
    if (typeof setInterval === "function") {
        // ONE TICK DRIVES BOTH. A second interval for membership would be a second cadence
      // answering a question the first already samples often enough, and two timers in one module
      // is the shape `check-bot-runtime` PART C refuses.
      _sweepTimer = setInterval(() => {
        // ── BOTH PASSES RUN, THEN BOTH REPORT, AND NOTHING IS SAID UNTIL THEY SETTLE ─────────
        // Every line this tick writes describes something that was ATTEMPTED. A warning may not
        // be delivered and a kick may be refused, and both answer asynchronously — so reporting
        // where the attempt is made turns an intention into an outcome. That is how one refused
        // kick printed as a removal notice every minute for sixteen minutes about a person who
        // never left the channel.
        //
        // DECLARED IN THE TICK, not on the module: the two reports only need to meet each other
        // for the length of one pass, and a module-level holder would survive a `stop()` and let
        // a dead pass's removals be announced by the next one.
        let idleReport = null, presReport = null;
        try { idleReport = sweepIdle(); } catch (e) { idleReport = null; }
        try { presReport = reconcilePresence(); } catch (e) { presReport = null; }
        // ── AND THE REPLAY COOLDOWN, ON THE SAME TICK ────────────────────────────────────────
        // A third interval would be a third cadence, which is the shape PART C refuses. It rides
        // here for the same reason the presence pass does — one tick that samples often enough.
        //
        // AND ITS VERDICT IS SPOKEN, unlike the first draft which discarded the return — the v334
        // defect word for word. It is spoken INSIDE the sweep rather than here, because unlike the
        // two passes above none of its quiet verdicts has an outcome still pending: they are
        // refusals to act, known at the moment they are decided. That also puts the line where a
        // guard driving the sweep can see it, which the tick's callback can never be.
        try { sweepRepeat(); } catch (e) {}
        // A rejected `settled` must not skip the reporting — the reports still describe what was
        // tried, and silence here is the failure this whole tick was rewritten to remove.
        Promise.all([
          Promise.resolve(idleReport && idleReport.settled).catch(() => null),
          Promise.resolve(presReport && presReport.settled).catch(() => null),
        ]).then(() => {
          try { _reportSweep(idleReport); } catch (e) {}
          try { _reportPresence(presReport); } catch (e) {}
          // BOTH REPORTS IN HAND, so one announcement can name both losses for the same person —
          // and both are now corrected, so it announces only what actually happened.
          try {
            _announceRemovals(idleReport && idleReport.removed, presReport && presReport.removed);
          } catch (e) {}
        }).catch(() => {});
      }, SWEEP_EVERY_MS);
    } else {
      Logger.warn("BotRuntime: no timer available — request handling is live, the idle sweep is not");
    }
    // ── AND WHAT IT CAN ACTUALLY DO, BEFORE THE LINE THAT CLAIMS IT IS ON ───────────────────
    // `bot mode on` reads as "everything is fine" and only ever meant "my rank is right". The
    // capability walk goes FIRST so the qualification arrives before the claim rather than after
    // it — somebody scanning the log stops at the first line that answers their question.
    // REPLAYED BEFORE THE FIRST SWEEP, so the first pass judges people on what they actually did
    // rather than on an empty memory. A restart that forgot every entry time would warn the whole
    // rotation a minute later — the reported bug, returning on every reload.
    try {
      const known = _seedEntries();
      Logger.info("BotRuntime: replayed the queue — " + known + " member(s) with a known join time"
        + ". Anyone missing joined before the log reaches, and reads as "
        + "cannot-say rather than as idle");
    } catch (e) {
      Logger.warn("BotRuntime: queue replay failed — " + ((e && e.message) || e)
        + "; join times are unknown, so nobody will be credited for joining");
    }
    try { _reportCapabilities(_capabilities()); } catch (e) {
      Logger.warn("BotRuntime: capability check failed — " + ((e && e.message) || e)
        + "; the line below says the bot started, not that it can do anything");
    }
    Logger.info("BotRuntime: bot mode on (" + _running.mode + ", level " + level + ")");
    return { ok: true, reason: null, detail: null, level: level, mode: _running.mode };
  }

  // ── THE AFK SWEEP (v322) ──────────────────────────────────────────────────────────────────
  // `botAfkMs` and `botPingMs` have been settings since v283 with nothing computing the number
  // they bound, and `queueIdleMs` joined them at v322. This is what reads them.
  //
  // WHY IT LIVES IN THE BOT AND NOT IN `features/queue.js`: removing a DJ is a moderation act, and
  // every client folding the same log would reach the same "this person is idle" conclusion at the
  // same moment. If every client acted on it, a room of ten would author ten removes for one
  // person. One actor is the whole point of having a bot — and the bot is the one client that is
  // always there to notice.
  //
  // TWO STAGES, because removing somebody who stepped away for a minute is worse than waiting.
  // First a warning in chat; then, `botPingMs` later, the remove IF they are still idle. The
  // second check is not a formality: the warning is exactly the kind of thing that makes somebody
  // come back, and a sweep that removed on a timer it set earlier would ignore the answer it asked
  // for.
  //
  // THE WARNING GOES TO CHAT, WHICH IS OUTSIDE THE LOG. It costs the room no events, no checkpoint
  // weight and nothing to forget. It also leaves NO permanent trace — the remove is in the log and
  // the warning is not — so nobody can later prove somebody was warned. Accepted: the alternative
  // is a durable event for a transient nudge.
  //
  // AND THE WARNING GOES TO THE PERSISTENT CHAT, NOT THE PRESENCE CHAT. The person being warned is
  // by definition idle, so they may already have been dropped from a presence-gated room — a
  // warning there would be invisible to its only audience.
  // ── THE REPLAY COOLDOWN — SKIP A SONG THAT PLAYED TOO RECENTLY ────────────────────────────
  // WHY THE BOT AND NOT THE REDUCER: "has this played recently" is answered from the play-log,
  // whose reach is bounded by what each client still holds. Two honest clients legitimately
  // disagree, so a fold that judged an advance on it would fork the room. The bot decides from its
  // own bounded reading and expresses the decision as an ORDINARY AUTHORED SKIP every client folds
  // identically — the same shape as the AFK removal above, and the same reason.
  //
  // WHY ONE ACTOR: every client folding the same log would reach the same verdict at the same
  // moment, and a room of ten would author ten skips for one song. The advance lock would drop
  // nine, so it is a cost rather than a correctness problem — but it is a cost with no upside.
  //
  // RE-READ AT FIRE TIME, AND ACT ONCE PER PLAYING. `_repeatActedPi` names the playing already
  // acted on, so a tick that fires while a skip is still in flight does not send a second one.
  // Keyed by `pi` rather than by videoId, because a videoId would silence the rule for a song the
  // room legitimately reaches again later.
  //
  // IT NEVER SKIPS ON IGNORANCE. `Room.playedWithin` answers `known: false` when this bot's
  // play-log does not reach back a full cooldown, and that is not a skip. A bot that treated a
  // short reach as "definitely a repeat" would empty the rotation after a trim — the same trap
  // `idleFor`'s `known: false` exists to refuse, arriving through a different door.
  // ── BOUNDED BY CONSTRUCTION, WHICH IS WHY IT IS NOT A MAP ────────────────────────────────
  // This was a map keyed by play instance, and the audit's first answer to its growth was to clear
  // it on `stop()`. That is necessary and NOT sufficient: a bot is meant to run for hours inside
  // ONE room, so a map that empties only on a room change still grows all session — which is
  // exactly what the first live bot run is told to watch `status()` for.
  //
  // A CAP OR A TTL WOULD BOUND IT, AND BOTH ARE THE WRONG SHAPE. Each needs a number nobody has a
  // value for, and each leaves a rule that is correct until that number is wrong. The question
  // this memory answers is *have I already acted on the playing that is on air RIGHT NOW*, and
  // there is only ever one of those. A `pi` is a Matrix event id, so a playing that has ended
  // never returns and every other entry a map would hold is already dead.
  //
  // So it is ONE VALUE: no cap, no eviction, no clock, nothing to tune. Still cleared on `stop()`,
  // because a value that outlived its room would answer for a playing of a different one.
  //
  // WHAT THE SINGLE VALUE COSTS, stated because it is a real difference rather than a free win: if
  // a late arrival re-folds the head so it leaves this playing and comes back to it, the mark is
  // gone and the sweep acts again. That costs one skip the advance lock drops — and it is arguably
  // the right answer anyway, since a room genuinely playing that song again is genuinely playing a
  // repeat. The mark stops a second send while one is in flight; it is not a verdict kept forever.
  let _repeatActedPi = null;   // the ONE playing this sweep has already acted on

  // ── REPORTED WHERE IT IS DECIDED, WHICH FOR THESE VERDICTS IS HERE ────────────────────────
  // The AFK passes hand their reports to the tick because their outcomes are ASYNC — a warning may
  // not be delivered and a kick may be refused, so reporting at the decision would turn an
  // intention into an outcome. None of the verdicts below has anything pending: they are refusals
  // to act. So they are spoken here, which is also what makes them reachable by a guard driving
  // the sweep — the tick has no name to extract.
  // Held by `check-repeat-cooldown` PART H: the tag on the skip, one act per playing, the memory
  // keyed by playing rather than by video, the announcement's TARGET, and the three refusals
  // (not caught up, cannot tell, no skip feature). Not covered: the timer that reaches this.
  function sweepRepeat() {
    const out = _sweepRepeat();
    try { _reportRepeat(out); } catch (e) {}
    return out;
  }
  function _sweepRepeat() {
    if (!_running) return { ok: false, reason: "not-running", skipped: null, verdict: null };
    let np = null;
    try { np = StreamManager.getState().nowPlaying; } catch (e) { np = null; }
    if (!np || !np.pi || !np.song || !np.song.videoId) {
      return { ok: false, reason: "nothing-playing", skipped: null, verdict: null };
    }
    if (_repeatActedPi === np.pi) return { ok: true, reason: "already-acted", skipped: null, verdict: null };

    // ONLY A CAUGHT-UP CLIENT AUTHORS. Asked through the interface, because a feature may not
    // reach `Session` — and a bot folding a backlog is live the whole time and just as wrong.
    let may = true;
    try { if (typeof MatrixBridge.mayAuthor === "function") may = !!MatrixBridge.mayAuthor(); }
    catch (e) { may = false; }
    if (!may) return { ok: false, reason: "not-live", skipped: null, verdict: null };

    let v = null;
    try { v = Room.playedWithin(np.song.videoId); } catch (e) { v = null; }
    if (!v) return { ok: false, reason: "no-reader", skipped: null, verdict: null };
    if (!v.blocked) {
      return { ok: true, reason: v.known ? "allowed" : "cannot-tell", skipped: null, verdict: v };
    }

    // WITHOUT `Skip` THERE IS NOTHING TO DO, and saying so beats throwing inside a tick that
    // swallows. A host that loaded the runtime and not the skip feature is a wiring fault, which
    // is this tree's own signature failure and therefore the one worth naming rather than catching.
    if (typeof Skip === "undefined" || typeof Skip.skip !== "function") {
      return { ok: false, reason: "no-skip-feature", skipped: null, verdict: v };
    }
    _repeatActedPi = np.pi;
    const who = np.song.videoId;
    const agoMin = Math.max(1, Math.round((v.agoMs || 0) / 60000));
    Logger.info("BotRuntime: repeat — " + who + " played " + agoMin + " minute(s) ago and the room's "
      + "cooldown is " + Math.round(v.cooldownMs / 60000) + " minute(s); skipping");
    // THE TAG IS THE WHOLE POINT OF SENDING IT THIS WAY. Without `k: "repeat"` the skip pushes a
    // fresh play into the history and restarts the very clock it is enforcing.
    Promise.resolve(Skip.skip("repeat")).then((r) => {
      if (!r || !r.ok) {
        // A LOST RACE IS NOT A FAILURE, and the mark stays either way: the playing has moved on,
        // so there is nothing left to skip. It is reported because a silent skip is the shape
        // that hid a refused kick for three sessions.
        Logger.info("BotRuntime: the repeat skip of " + who + " did not take — "
          + ((r && r.reason) || "no reason given") + "; the playing has moved on either way");
        return;
      }
      _announceRepeat(who, agoMin);
    }, () => {});
    return { ok: true, reason: "skipping", skipped: who, verdict: v };
  }

  // ANNOUNCED, for the reason the AFK removal is: the room did something nobody asked for, so the
  // room should be able to see it happen. Reports an outcome, so it is not gated on delivery —
  // only the AFK WARNING is, because that one authorises a later act.
  //
  // `sendTo(mainId)`, NEVER `send`. Found by auditing this against `_warn`, whose own banner
  // explains exactly this at length. MEASURED, and both figures in the first draft of this
  // sentence were dead copies of somebody else's code: it said `_warn` was "a hundred lines
  // above" and carried "fifteen lines", where the banner is thirteen and the distance moves with
  // every edit to either function. Point at the name; never at the size or the distance, which is
  // the same rule the guards follow when they refuse to bound a match by character distance.
  // `Chat.send` follows the ACTIVE tier, and
  // the active tier is a device-local, persistent preference — so somebody clicking a tab once on
  // the bot's machine would silently redirect every announcement after it, possibly into the
  // presence chat, which holds only the people who are around. The first draft of this function
  // resolved `mainId` and then called `send` anyway, so the resolution was decoration. The room's
  // main tier is resolved fresh at send time so an owner changing `chat` moves this with it.
  function _announceRepeat(videoId, agoMin) {
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") return;
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    // NO FALLBACK TO THE ACTIVE TIER, for the same reason `_warn` has none: falling back to
    // wherever the tab points is the behaviour being replaced, not a graceful degradation of it.
    if (!mainId) return;
    try {
      Chat.sendTo(mainId, "Skipped " + videoId + " — it played " + agoMin + " minute(s) ago, and "
        + "this room does not replay a song that soon.");
    } catch (e) { /* an unreachable chat costs a line and changes nothing that already happened */ }
  }

  // ── WHAT THE REPEAT SWEEP SAYS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────
  // The interesting verdict is the QUIET one. A room with the cooldown set, whose bot cannot see
  // back a full window, does nothing forever and looks identical to a room where every song is
  // fresh — and the owner set the dial expecting an effect. So `cannot-tell` is reported.
  //
  // ONCE PER STATE, NOT ONCE PER TICK. This runs every sweep, and a line a minute is how a log
  // stops being readable — the same reason the presence pass reports at `debug` rather than at
  // `info`. The last reason is held so only a CHANGE is printed, which is also what makes the
  // recovery visible: the line saying it can answer again is the one somebody is waiting for.
  let _lastRepeatReason = null;
  function _reportRepeat(r) {
    if (!r) return;
    const why = r.reason || null;
    if (why === _lastRepeatReason) return;
    _lastRepeatReason = why;
    if (why === "cannot-tell") {
      Logger.warn("BotRuntime: the replay cooldown is set and this bot cannot enforce it yet — its "
        + "play history does not reach back a full window, so it refuses to guess. It will start "
        + "acting once the history covers the window, and says so when it does");
      return;
    }
    if (why === "no-skip-feature") {
      Logger.warn("BotRuntime: the replay cooldown is set and the skip feature is not wired, so "
        + "nothing can act on it");
      return;
    }
    if (why === "allowed") {
      Logger.debug("BotRuntime: replay cooldown — this playing is inside no cooldown");
    }
  }

  let _pending = Object.create(null);      // userId -> ts we warned them about the QUEUE
  // ── AND THE SAME FOR THE PRESENCE CHAT ────────────────────────────────────────────────────
  // Kept SEPARATE rather than shared, because the two windows are separate settings and can fire
  // apart. One map would let a queue warning silently start a presence countdown that was never
  // announced — the clocks are independent even when one message covers both.
  let _presPending = Object.create(null);  // userId -> ts we warned them about the PRESENCE CHAT

  function _sweepEnv() {
    if (!_running) return null;
    if (typeof Room === "undefined" || typeof Room.idleFor !== "function") return null;
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return null; }
    if (!st || !Array.isArray(st.rotation) || !st.settings) return null;
    // SERVER TIME, never `Date.now()`. Every `ts` in the log is the homeserver's stamp, so the
    // reference an idle span is measured against has to be one too (P2). With no offset learned
    // yet `serverNow` degrades to the local clock, which is this client's best available answer.
    let now = 0;
    try { now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0; }
    catch (e) { now = 0; }
    if (!now) return null;
    return { st: st, now: now };
  }

  // One pass. Returns a REPORT rather than acting silently, so a caller — and a guard — can see
  // what it decided and why. TOTAL: every path returns, none throws, because this runs on a timer
  // and a throw would end the sweep for the life of the page.
  function sweepIdle() {
    const env = _sweepEnv();
    if (!env) return { ok: false, reason: "no-state", warned: [], removed: [], skipped: [], settled: Promise.resolve([]) };
    const { st, now } = env;
    const pingMs = st.settings.botPingMs;
    if (typeof pingMs !== "number" || !isFinite(pingMs)) {
      return { ok: false, reason: "no-ping-window", warned: [], removed: [], skipped: [], settled: Promise.resolve([]) };
    }
    // `settling` holds the sends this pass started. The report is returned synchronously and
    // corrected as each one answers; the tick waits on `settled` before saying anything.
    const warned = [], removed = [], skipped = [], settling = [];
    for (const entry of st.rotation) {
      const who = entry && entry.user;
      if (typeof who !== "string" || !who) continue;
      // NEVER ITSELF. The bot is always in the room and never does anything a person would, so it
      // would be the first thing it removed.
      if (who === _myId()) continue;
      let idle = null;
      try { idle = Room.idleFor(who, now); } catch (e) { idle = null; }
      // ── ENTERING THE ROTATION IS AN ACT, AND THE SPINE ANSWER CANNOT SEE IT ─────────────────
      // `idleFor` classifies by TYPE, and the join that carries a video is deliberately excluded
      // because the reconcile loop fires it unprompted. So the one thing a person definitely DID —
      // press Join — is invisible to it. `_entries` holds when they entered, derived from the
      // rotation changing rather than from anything self-reported.
      //
      // BLENDED HERE RATHER THAN INSIDE `idleFor`, because this is the BOT's knowledge and not the
      // room's: `Room.idleFor` must keep answering identically for every client, and only the bot
      // replays the queue. Putting it there would make one client's reading depend on how long it
      // had been watching — the divergence the first attempt at this was reverted for.
      //
      // Gated on the room's own `rotation` flag, like every other act. Entering is a rotation act;
      // a room that switched that group off must not have it counted through a side door.
      const ent = enteredAt(who);
      if (ent !== null && st.settings.activityQueue && st.settings.activityQueue.rotation === true) {
        const sinceJoin = Math.max(0, now - ent);
        // THE MOST RECENT ACT WINS. If the Spine already holds something newer this changes
        // nothing; if it holds nothing, or only older acts, joining is the answer.
        if (!idle || idle.known !== true || sinceJoin < idle.idleMs) {
          const w = (idle && typeof idle.windowMs === "number")
            ? idle.windowMs : st.settings.queueIdleMs;
          idle = { known: true, idleMs: sinceJoin, overdue: sinceJoin >= w, windowMs: w,
                   lastTs: ent, reachMs: (idle && typeof idle.reachMs === "number") ? idle.reachMs : 0 };
        }
      }
      // `null` is "I could not answer" and `known: false` is "no evidence held" — the log's reach
      // is bounded, so somebody's acts may simply have been trimmed. NEITHER is grounds to remove:
      // acting on absence would empty the rotation after every trim.
      if (!idle || idle.known !== true) { skipped.push(who); delete _pending[who]; continue; }

      // ── CHAT, IF THE ROOM COUNTS IT ─────────────────────────────────────────────────────────
      // The Spine cannot answer this — chat never reaches it — so the bot's own observation does.
      // Two questions, and skipping either one is a wrongful removal:
      //   1. HAS this person chatted inside the window?  -> they are active, keep them.
      //   2. Has the bot been WATCHING long enough to say they have not?  -> if not, it cannot
      //      conclude they are idle, so it must not remove them for it.
      // The second is the same rule the Spine answer uses for a short log reach, applied to a
      // short observation. A bot that started thirty seconds ago knows nothing about the last ten
      // minutes, and treating that as silence would remove people for the bot's own downtime.
      if (st.settings.botQueueChat === true) {
        const w = idle.windowMs;
        if (_chatActiveWithin(who, now, w)) { delete _pending[who]; continue; }
        if (!_chatCanAnswer(now, w)) { skipped.push(who); delete _pending[who]; continue; }
      }

      if (!idle.overdue) {
        // ── THEY CAME BACK, AND IF THEY WERE WARNED THEY GET TOLD ─────────────────────────────
        // A warning is a public message naming somebody in the room's main chat. Cancelling it in
        // silence leaves that message as the last word about them, so anybody reading later sees
        // an accusation and no outcome. **Only when a warning was actually sent** — somebody who
        // was never warned has nothing to be cleared of, and greeting them would be the bot
        // talking about people who did nothing.
        if (typeof _pending[who] === "number") { _unwarn(who); }
        delete _pending[who];
        continue;
      }

      const warnedAt = _pending[who];
      if (typeof warnedAt !== "number") {
        _pending[who] = now;
        // OPTIMISTIC IN THE REPORT, CORRECTED BY THE OUTCOME — the same shape
        // `reconcilePresence` already uses, so both halves of this module report the same way.
        // The report is returned synchronously because callers render from it; the name comes
        // back out if the warning was not delivered, before the tick says anything.
        warned.push(who);
        settling.push(Promise.resolve(_warn(who, idle, pingMs)).then((okd) => {
          if (!okd) { const k = warned.indexOf(who); if (k >= 0) warned.splice(k, 1); }
        }));
        continue;
      }
      // STILL IDLE AND THE ANSWER WINDOW HAS PASSED. `idle.overdue` was re-read above, so somebody
      // who acted after the warning has already been cleared and never reaches here.
      if (now - warnedAt >= pingMs) {
        // ── THE MARK SURVIVES UNTIL THE REMOVAL LANDS ────────────────────────────────────────
        // Deleting it here was the loop: a send that failed left the person in the rotation with
        // no mark, so the next sweep read them as never warned and started the whole cycle over —
        // a fresh public accusation and a fresh grace period, once per grace, forever.
        //
        // Kept, the failure costs nothing. The next sweep finds the mark, finds the grace already
        // elapsed, and removes again WITHOUT re-warning. Retrying is not a second policy
        // competing with the sweep; it IS the sweep, reaching the same branch on the same
        // evidence.
        removed.push(who);
        settling.push(_remove(who).then((okd) => {
          if (okd) { delete _pending[who]; return; }
          const k = removed.indexOf(who); if (k >= 0) removed.splice(k, 1);
        }));
      }
    }
    // ── WHAT THE PASS ACTUALLY LOOKED AT ────────────────────────────────────────────────────
    // Without these the quiet branch could only say "nobody overdue", which is a claim this
    // function never makes. All three lists are empty in FOUR different situations — an empty
    // rotation, everybody active, everybody cleared, and everybody sitting mid-grace waiting out
    // `botPingMs`. The last one is the whole removal window, so for the entire time a removal is
    // counting down the log said nobody was overdue. Reported instead of asserted.
    let stillPending = 0;
    for (const entry of st.rotation) {
      const u = entry && entry.user;
      if (typeof u === "string" && typeof _pending[u] === "number") stillPending++;
    }
    return { ok: true, reason: null, warned: warned, removed: removed, skipped: skipped,
             looked: st.rotation.length, pending: stillPending,
             // AWAITED BY THE TICK BEFORE IT REPORTS, so an undelivered warning and a refused
             // removal are never announced as having happened. `reconcilePresence` returns the
             // same field for the same reason; one shape, both halves.
             settled: Promise.all(settling) };
  }

  // ── PRESENCE-CHANNEL MEMBERSHIP: A RECONCILIATION, NOT A REACTION (v322) ──────────────────
  // THE DISTINCTION THIS RESTS ON, because getting it wrong in either direction is easy:
  //
  //   · The REQUEST handler is LIVE-ONLY. An old `ddjp.bot.request` must never be executed on
  //     reconnect — replaying a three-day-old settings change on top of whatever is current is
  //     worse than losing it. That rule is structural: the handler hangs off the live fan-out and
  //     `replayRoom` does not go through it, so no flag enforces it and none can be forgotten.
  //
  //   · THIS is the opposite job and needs the opposite behaviour. Nobody emits an event when
  //     somebody becomes present or stops being, so membership cannot be maintained by reacting.
  //     It is maintained by COMPARING: who does the room derive as around NOW, against who is in
  //     the channel NOW, and fixing the difference.
  //
  // One ignores history; the other repairs the present. They do not conflict, and the failure is
  // conflating them — replaying old requests and calling it recovery, or refusing to reconcile
  // and calling it live-only. **This is also why reconnect needs nothing special.** The comparison
  // is against current state either way, so a bot that was offline for an hour fixes an hour of
  // drift on its next pass with no catch-up path, no queue and no replay.
  //
  // THE DECISION IS THE ROOM'S. `Room.recentlyActive` folds the log under `activityPresence` and
  // `botAfkMs`; this only asks it. A second notion of presence here would be the collision the
  // people panel already warns about, with the bot on the other side of it.
  function reconcilePresence() {
    if (!_running) return { ok: false, reason: "not-running", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    const ch = _running.channels && _running.channels.presence_chat;
    if (!ch) return { ok: false, reason: "no-presence-channel", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    if (typeof Room === "undefined" || typeof Room.recentlyActive !== "function") {
      return { ok: false, reason: "no-reader", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    }
    let now = 0;
    try { now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0; }
    catch (e) { now = 0; }
    if (!now) return { ok: false, reason: "no-clock", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };

    // WHO THE ROOM SAYS IS AROUND.
    let fold = null;
    try { fold = Room.recentlyActive(now); } catch (e) { fold = null; }
    if (!fold || !Array.isArray(fold.people)) {
      return { ok: false, reason: "no-fold", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    }

    // WHO IS ACTUALLY IN THE CHANNEL. `null` is "could not read", NOT "nobody" — and the
    // difference is the whole safety of this function. Read as empty, an unsynced channel would
    // make every active person look missing and this would invite the entire room at once.
    let members = null;
    try { members = MatrixBridge.joinedMembersOf(ch); } catch (e) { members = null; }
    if (members === null) {
      return { ok: false, reason: "membership-unreadable", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    }

    // THE BOT IS NEVER A CANDIDATE, in either direction. It is always in the channel — it has to
    // be, to manage it — and it is never "active" by the room's rule, so a bare comparison would
    // have it remove itself and then be unable to let anyone back in.
    const me = _myId();
    const want = Object.create(null);
    for (const p of fold.people) { if (p && p.userId && p.userId !== me) want[p.userId] = true; }

    // ── CHAT WIDENS `want`, IT NEVER NARROWS IT ─────────────────────────────────────────────
    // `fold.unobservable` already declares that the room counts chat and this fold cannot see it.
    // The bot CAN see it, so it adds the people the fold had to leave out. Additive only: chat can
    // keep somebody in the channel, never take them out of it, so a bot with a short observation
    // is a bot that removes fewer people rather than the wrong ones.
    //
    // AND IT REFUSES THE WHOLE PASS when the room counts chat and the observation is too short to
    // rule anything out — removing on an answer it cannot give is the failure this guards.
    let chatBlind = false;
    try {
      const s2 = StreamManager.getState().settings;
      if (s2 && s2.botPresenceChat === true) {
        const w = s2.botAfkMs;
        if (_chatCanAnswer(now, w)) {
          for (const u in _chatSeen) {
            if (u !== me && _chatActiveWithin(u, now, w)) want[u] = true;
          }
        } else {
          chatBlind = true;
        }
      }
    } catch (e) { chatBlind = true; }
    // BLINDNESS STOPS REMOVALS, NOT INVITES. Not being able to see chat means not being able to
    // rule out that somebody is active — which is only ever a reason to KEEP them. Refusing the
    // whole pass was the first version and it was too strong: it also withheld invites, which chat
    // has nothing to do with, and a freshly started bot would have added nobody for a full
    // `botAfkMs`. Additive knowledge, additive effect.
    const have = Object.create(null);
    for (const u of members) { if (u !== me) have[u] = true; }

    // ── ALREADY ASKED IS NOT THE SAME QUESTION AS ALREADY IN, AND ONLY ONE OF THEM IS `have` ──
    // `have` is JOINED members and must stay that way: it is what the removal half below reads,
    // and somebody who was invited and never joined is not in the channel. Counting them as in it
    // would warn them in public and then try to kick a person who was never there.
    //
    // But the ADD half asks a different question — "does this person still need asking?" — and a
    // pending invite already answers it. Reading `have` for that question is what made the bot
    // re-invite the same person once a minute for as long as the invite sat unanswered, which is
    // one duplicate invite state event per pass against a rate-limited homeserver.
    //
    // FALLS BACK TO `have` WHEN THE INVITED SET CANNOT BE READ. An unreadable answer means "I do
    // not know who has been asked", and the safe direction there is to ask again: a duplicate
    // invite is noise, while withholding one leaves somebody outside a channel they are entitled
    // to with nothing saying why — the defect this whole feature exists to prevent.
    let invitedList = null;
    try {
      if (typeof MatrixBridge.invitedMembersOf === "function") invitedList = MatrixBridge.invitedMembersOf(ch);
    } catch (e) { invitedList = null; }
    const offered = Object.create(null);
    for (const u in have) offered[u] = true;
    if (Array.isArray(invitedList)) for (const u of invitedList) { if (u !== me) offered[u] = true; }
    // The grace, read the way this function reads every other setting — through its own
    // `StreamManager.getState()` call rather than a variable borrowed from another scope.
    let pingMs = null;
    try {
      const g = StreamManager.getState().settings.botPingMs;
      if (typeof g === "number" && isFinite(g)) pingMs = g;
    } catch (e) { pingMs = null; }

    // ── THE OWNER IS NEVER DROPPED FROM THE PRESENCE CHAT ──────────────────────────────────────
    // The bot holds the ladder's top rung; the room's owner sits ABOVE it, which is the same
    // comparison `eligible()` uses to refuse bot mode for them ("level 100 is above the bot's
    // 99"). So the owner is identifiable without a second notion of ownership.
    //
    // WHY ONLY HERE. The QUEUE sweep still removes an absent owner — a held turn that nobody is
    // coming back for stalls the room whoever it belongs to, and the owner asked for exactly that.
    // Presence is not a turn: it is a channel the owner may need to be in to see what the room is
    // doing, including while dealing with whatever made them look absent. Removing the one account
    // that can fix the room from the channel that shows its state is a bad trade at any idle
    // threshold.
    //
    // FAILS TOWARDS KEEPING PEOPLE. An unreadable roster means no owner can be identified, and the
    // safe direction for a "never remove X" rule is to remove NOBODY rather than risk removing the
    // owner. That matches the pass above, which refuses outright when membership is unreadable
    // instead of treating unreadable as empty.
    let ownerIds = null;                       // null = could not read, treat every drop as unsafe
    try {
      const roster = MatrixBridge.getRoster ? MatrixBridge.getRoster(_running.roomId) : null;
      if (Array.isArray(roster)) {
        const botLvl = botLevel();
        // FAIL CLOSED ON AN UNREADABLE BOT LEVEL. This used to leave `ownerIds` an EMPTY object,
        // which protects NOBODY — the opposite of what a "never remove the owner" rule must do
        // when it cannot tell who the owner is. Null means every drop is unsafe.
        if (typeof botLvl !== "number") {
          ownerIds = null;
        } else {
          ownerIds = Object.create(null);
          for (const r of roster) {
            if (!r || !r.userId || typeof r.level !== "number") continue;
            // `>=`, NOT `>`. A kick is refused by the homeserver unless the kicker OUTRANKS the
            // target, so anyone at or above the bot's level cannot be removed by it at all.
            // Trying anyway is a request that always fails — and with the announcement ungated
            // that produced one "was removed from the presence chat" every 60 seconds, forever,
            // for somebody who never left. Reported from a live room, about the OWNER.
            if (r.level >= botLvl) ownerIds[r.userId] = true;
          }
        }
      }
    } catch (e) { ownerIds = null; }

    const added = [], removed = [], pending = [], toWarn = [], refused = [];
    for (const u in want) { if (!offered[u]) { added.push(u); _addPresence(ch, u); } }
    for (const u in have) {
      if (want[u]) {
        // ── THEY CAME BACK, AND THEY GET TOLD ─────────────────────────────────────────────
        // This cleared the mark SILENTLY, which is the asymmetry the audit found: the queue half
        // sends a public "you're back" for the reason its own comment gives — a warning is a
        // public message naming somebody, and cancelling it in silence leaves that message as the
        // last word about them. Being warned about the presence chat is no less public.
        //
        // ONE MESSAGE STILL. If the QUEUE also has a standing mark it will send its own
        // thank-you this pass, so this stays quiet rather than making two — the same rule the
        // warning side follows, in the other direction.
        if (typeof _presPending[u] === "number" && typeof _pending[u] !== "number") _unwarn(u);
        delete _presPending[u];
        continue;
      }
      // Cannot see far enough back in chat to say they have been quiet: keep them.
      if (chatBlind) continue;
      // Unreadable roster, or a level above the bot's: leave them where they are.
      if (ownerIds === null || ownerIds[u]) continue;

      // ── WARN, WAIT, THEN REMOVE — THE THREE STATES THE QUEUE ALREADY HAD ──────────────────
      // This half used to remove the instant somebody fell out of `want`: no warning, no grace,
      // no chance to react. The queue gave ten minutes and a public message; the presence chat
      // took you out mid-sentence. AFK is one idea, so it gets one shape.
      //
      // `botPingMs` IS REUSED RATHER THAN A NEW KEY ADDED. A separate presence grace would be a
      // new settings key, and a new key re-fingerprints every checkpoint in every room — a real
      // cost for a number nobody has said should differ. Nothing below assumes the two windows
      // are equal; split the grace later if ten minutes turns out wrong for one side.
      if (pingMs === null) continue;   // no grace to give: leave them rather than remove now
      const at = _presPending[u];
      if (typeof at !== "number") {
        // ── ONE PERSON, ONE MESSAGE ──────────────────────────────────────────────────────
        // If the queue already warned them and that warning is still standing, they have been
        // told they are AFK — a second message in the same minute about the same silence reads
        // as a broken bot and doubles the traffic in the room the bot exists to keep tidy. The
        // presence clock adopts the QUEUE's timestamp rather than starting fresh, so the deadline
        // they were actually given is the one that applies.
        const q = _pending[u];
        if (typeof q === "number" && (now - q) < pingMs) { _presPending[u] = q; continue; }
        // Otherwise this is the only thing happening to them, so it gets its own message.
        // MARKED SYNCHRONOUSLY AND CLEARED ON NON-DELIVERY — the same shape the queue half uses,
        // rather than marking inside the send. Two reasons: the report is returned synchronously
        // and callers render from it, and a mark set only on the async path means the very next
        // pass reads the person as never warned and warns them again.
        _presPending[u] = now;
        toWarn.push(u);
        pending.push(Promise.resolve(_warnPresence(u, pingMs)).then((okd) => {
          if (okd) return;
          // An undelivered warning must not start a removal clock.
          delete _presPending[u];
          const k = toWarn.indexOf(u); if (k >= 0) toWarn.splice(k, 1);
        }));
        continue;
      }
      if (now - at < pingMs) continue;          // still inside the grace they were given
      // OPTIMISTIC IN THE REPORT, CORRECTED BY THE OUTCOME. The report is returned synchronously
      // (callers render from it), so the name goes in now and comes back OUT if the kick was
      // refused — before the tick announces, which is what `settled` is for.
      removed.push(u);
      pending.push(_dropPresence(ch, u).then((res) => {
        // THE MARK SURVIVES A REFUSED KICK, for the reason the queue half records: cleared here,
        // a failure would make the next pass read them as never warned and start the whole cycle
        // again — a fresh public warning and a fresh grace, once per grace, forever.
        if (res && res.ok) { delete _presPending[u]; return; }
        const k = removed.indexOf(u); if (k >= 0) removed.splice(k, 1);
        // KEPT SO THE PASS CAN REPORT IT. Without this the refusal leaves no trace anywhere: the
        // name is out of `removed`, the other two lists are empty, and the pass reports that the
        // membership is already correct.
        const why = u + " (" + ((res && res.reason) || "refused")
          + ((res && res.detail) ? ": " + res.detail : "") + ")";
        refused.push(why);
        // ── SAID HERE, NOT LEFT TO THE REPORTER ─────────────────────────────────────────────
        // The reporter runs from the tick. A refusal discovered on a pass driven from anywhere
        // else — a guard, a console, a future caller — would be recorded and never printed, which
        // is the same silence the live room saw. This is already inside the settle, so it is an
        // OUTCOME and not an intention.
        Logger.warn("BotRuntime: presence removal REFUSED — " + why
          + ". The mark is kept, so this retries every pass without re-warning; it will keep "
          + "failing until this client can kick in that channel");
      }));
    }
    added.sort(); removed.sort(); toWarn.sort();
    // ── WHAT THE PASS ACTUALLY LOOKED AT ────────────────────────────────────────────────────
    // Without these the quiet branch could only say `membership already correct`, which is a claim
    // this function never makes. Empty lists mean one of several things and the interesting one is
    // that somebody is warned and sitting out their grace — so for the whole countdown to a
    // removal the log asserted the membership was fine. The idle sweep was fixed for exactly this
    // and reports `looked at N in rotation, M already warned and waiting`; this half never got it.
    let stillPending = 0;
    for (const u in have) { if (typeof _presPending[u] === "number") stillPending++; }
    // ── ASKED AND NOT ANSWERED IS ITS OWN STATE, AND IT DID NOT USED TO EXIST ─────────────────
    // Before the add loop read `offered`, somebody sitting on an unanswered invite was re-invited
    // on every pass and so at least appeared in `added` — noisy, but visible. They are correctly
    // silent now, which means they land in NO list: not added, not in the channel, not warned.
    // That is the shape that hid a refused kick for three sessions, so it is counted here rather
    // than left to be inferred from somebody's absence from a channel.
    let awaiting = 0;
    for (const u in want) { if (!have[u] && offered[u]) awaiting++; }
    return { ok: true, reason: null, added: added, removed: removed, warned: toWarn,
             refused: refused, inChannelCount: Object.keys(have).length, pending: stillPending,
             awaiting: awaiting,
             // Carried so a caller can tell "nothing to do" from "nobody is around" — the second
             // is a real state and the first is the steady one, and they look identical in the
             // two empty arrays above.
             // AWAITED BY THE TICK BEFORE IT ANNOUNCES, so a refused kick is never reported as a
             // removal. The report itself stays synchronous; only the announcement waits.
             settled: Promise.all(pending),
             active: Object.keys(want).length, inChannel: Object.keys(have).length,
             // Carried so a caller can tell "nobody was due to go" from "removals were withheld".
             chatBlind: chatBlind };
  }

  function _addPresence(ch, who) {
    try { Promise.resolve(MatrixBridge.inviteToPresence(ch, who)).catch(() => {}); } catch (e) {}
  }
  // ── A REMOVAL THAT DID NOT LAND IS NOT A REMOVAL ────────────────────────────────────────────
  // This discarded the result, so a kick the homeserver REFUSED was still counted and still
  // announced — and the person stayed, so the next pass tried again. One "was removed from the
  // presence chat" per minute, forever, about somebody who never left. The same doctrine the AFK
  // warning already follows: never report an act you could not perform.
  //
  // Returns a promise of the outcome so the caller can drop them from `removed` when it failed.
  // ── THE REFUSAL IS AN OUTCOME, NOT AN ABSENCE ─────────────────────────────────────────────
  // This returned a bare boolean and threw the reason away. The consequence was worse than a
  // missing detail: a refused kick is spliced back out of the report, so all three lists come back
  // empty and the pass logs `membership already correct` — a sentence that is FALSE exactly when
  // somebody most needs it to be true. Reported from a live room: warned, grace expired, nothing
  // happened, and the log said everything was fine.
  //
  // The homeserver's own words are carried through, because "the kick failed" and "the kick failed
  // BECAUSE this client is not a moderator in that room" send a reader to two different places.
  function _dropPresence(ch, who) {
    try {
      return Promise.resolve(MatrixBridge.removeFromPresence(ch, who))
        .then((r) => {
          if (r && r.ok !== false) return { ok: true, reason: null };
          return { ok: false, reason: ((r && r.reason) || "refused"),
                   detail: (r && r.detail) || null };
        })
        .catch((e) => ({ ok: false, reason: "threw", detail: (e && e.message) || null }));
    } catch (e) { return Promise.resolve({ ok: false, reason: "threw", detail: (e && e.message) || null }); }
  }

  // ── WHAT THE BOT HAS SEEN IN CHAT ───────────────────────────────────────────────────────────
  // Chat NEVER reaches the Spine — deliberately, and that is not changing. So a room that counts
  // chat towards being around cannot be answered from the log, and `foldActivity` says so by
  // reporting `unobservable: ["chat"]` rather than answering wrongly.
  //
  // THE BOT CAN ANSWER IT, because it is a member of every chat tier: the three rank tiers by
  // rank, and `presence-chat` because entering the space joins every child. This is its OWN
  // observation, held in memory, never authored and never shared.
  //
  // TWO CLIENTS WILL DISAGREE ABOUT WHO IS AROUND, AND THAT IS ACCEPTED. A person who cannot read
  // the staff tier cannot see somebody being active in it. The people panel already declares that
  // limit; the bot simply has a better view than most, and the DECISION is the bot's to make.
  // ── WHAT THE BOT HAS HEARD, AND HOW LONG IT HAS BEEN LISTENING ───────────────────────────
  // `let`, not `const`, and that is not style: the clear below is a real assignment, and the
  // reason this map went uncleared for several versions is almost certainly that a `const` makes
  // one throw. `stop()` carried a paragraph ending "Cleared explicitly." with no clearing line
  // under it, and the handoff recorded the fix as shipped. The comment is now where the work is.
  //
  // SCOPED TO A ROOM, cleared when the room changes rather than on every `stop()` — see `start()`.
  // `stop()` also runs on a RANK CHANGE in the same room, where the observations are about this
  // room, are true, and throwing them away would replace a correct answer with a vague one.
  let _chatSeen = Object.create(null);
  let _chatRoom = null;    // which room the observations in `_chatSeen` are ABOUT
  let _chatSince = 0;

  // Held by `check-idle-sweep` PART Z, which drives the same-room and cross-room cases apart —
  // and isolates THIS guard with a same-room fixture where the only chat arrives during the stop,
  // because a cross-room fixture has the room-change clear masking it.
  function _noteChat(eventId, sender, body, failed, ts) {
    // ── NOT RUNNING, NOT LISTENING ──────────────────────────────────────────────────────────
    // `Chat.onMessage` has no counterpart: `features/chat.js` has NO `offMessage`, and says so in
    // its own comment. So this listener, once subscribed, is subscribed for the life of the tab —
    // it goes on recording while the bot is stopped, and in every later room, with nothing reading
    // any of it. Clearing the map alone would therefore not have fixed the leak: the map refills
    // from the next room's chat between `stop()` and `start()`.
    //
    // This is the door. It also gives the map an invariant it did not have: everything in it fell
    // inside the window `_chatSince` claims to have been watching, so the two can no longer
    // disagree about what was observed.
    if (!_running) return;
    if (typeof sender !== "string" || !sender) return;
    const t = (typeof ts === "number" && isFinite(ts) && ts > 0) ? ts : 0;
    if (!t) return;
    if (!_chatSeen[sender] || t > _chatSeen[sender]) _chatSeen[sender] = t;
  }

  // ── AND HOW FAR BACK THAT OBSERVATION REACHES ───────────────────────────────────────────────
  // The bot only sees chat sent while it is RUNNING. A bot that started thirty seconds ago knows
  // nothing about the last ten minutes, and treating "I have seen no chat from them" as "they have
  // not chatted" would remove somebody for the bot's own downtime.
  //
  // Same rule the Spine answer uses: an observation shorter than the window cannot rule anything
  // out. Until the bot has been watching for a full window, chat is UNANSWERABLE rather than
  // negative — so the sweep refuses to remove on that basis, exactly as it refuses when the log's
  // reach is too short.
  function _chatCanAnswer(now, windowMs) {
    if (!_chatSince || !windowMs) return false;
    return (now - _chatSince) >= windowMs;
  }

  function _chatActiveWithin(who, now, windowMs) {
    const last = _chatSeen[who];
    return typeof last === "number" && (now - last) < windowMs;
  }

  function _myId() {
    try { return MatrixBridge.getUserId(); } catch (e) { return null; }
  }

  // A WARNING THAT DID NOT LAND MUST NOT START THE CLOCK IT WOULD OTHERWISE START. `sweepIdle`
  // marks the pending warning synchronously, before this runs — so without the clears below an
  // undelivered warning matures into a removal `botPingMs` later and the person is removed having
  // never been told. That is the exact case the two stages exist to prevent, arriving through the
  // one path the stages do not check.
  //
  // IT IS AN ORDINARY STATE, NOT AN EDGE. `Chat.send` refuses five ways (`no-room`, `empty`,
  // `no-crypto`, `send-failed`, `forbidden`) and every chat tier is E2E encrypted, so it
  // pre-empts with `no-crypto` whenever crypto is not up — which `matrixbridge.js` calls the
  // common transient case. Its recovery is a banner and a reload, and NOBODY IS WATCHING A BOT'S
  // BANNER.
  //
  // ON A REFUSAL THE PENDING MARK IS CLEARED, so the next sweep warns again instead of removing.
  // Same doctrine as `_remove` below — the failure is not retried, the loop is self-correcting —
  // and it settles the open direction the same way: a bot that cannot reach chat warns forever
  // and removes nobody. Never act on somebody you could not tell.
  //
  // `r && r.ok === false` is `ui/interface.js`'s own reading of this return, not a second one: a
  // result that says it failed is a failure, and a caller that answers nothing is not claiming
  // one. A throw is the same answer as an explicit refusal.
  // ── HOW LONG A SPAN IS, IN WORDS ────────────────────────────────────────────────────────────
  // Whole minutes, FLOORED, never ceiled: telling somebody they have three minutes when they have
  // three and a half is harmless; telling them four when they have three and a half is a promise
  // the sweep will break. Under a minute answers in seconds rather than "0 minutes", because a
  // deadline of zero reads as already passed.
  function _humanSpan(ms) {
    const n = (typeof ms === "number" && isFinite(ms) && ms > 0) ? ms : 0;
    if (n < 60000) return Math.max(1, Math.floor(n / 1000)) + " seconds";
    const m = Math.floor(n / 60000);
    return m + (m === 1 ? " minute" : " minutes");
  }

  // `graceMs` IS PASSED, NOT RE-READ. `sweepIdle` already resolved and validated `botPingMs` before
  // it decided to warn at all — reading the settings again here would be a second copy free to
  // disagree with the one the removal is actually timed against.
  // ── THE TWO REPORTERS ──────────────────────────────────────────────────────────────────────
  // Split out of the tick because they are the same job twice and were drifting apart inside it.
  // Both are called ONLY after the pass has settled, so every name they print is something that
  // happened rather than something that was tried.
  function _reportSweep(r) {
    if (!r) return;
    if (r.ok === false) { Logger.warn("BotRuntime: idle sweep refused — " + r.reason); return; }
    if (r.warned.length || r.removed.length || (r.skipped && r.skipped.length)) {
      // NAMES, NOT COUNTS. `warned 1, removed 0` cannot answer the question anybody asks about a
      // sweep, which is always WHO — and a count is exactly as consistent with a wrongful removal
      // as with a correct one.
      Logger.info("BotRuntime: idle sweep — warned [" + _names(r.warned)
        + "], removed [" + _names(r.removed)
        + "], skipped-unknowable [" + _names(r.skipped) + "]");
      return;
    }
    // ── THE QUIET PASS, DESCRIBED RATHER THAN CHARACTERISED ─────────────────────────────────
    // This said "ran, nobody overdue", which the function never checked. Three empty lists mean
    // one of FOUR things, and the interesting one is the fourth: somebody warned and sitting out
    // their grace period is in no list at all. So for the entire countdown to a removal the log
    // asserted nobody was overdue — the reason a removal that never came looked like a dead timer.
    //
    // `debug`, so a healthy room stays quiet at `info and above`, and still in the record and the
    // copy-out either way.
    Logger.debug("BotRuntime: idle sweep — ran, looked at " + (r.looked || 0)
      + " in rotation, " + (r.pending || 0) + " already warned and waiting");
  }
  function _reportPresence(r) {
    if (!r) return;
    // `no-presence-channel` is the expected answer in a room built before the channel moved into
    // batch 3, and somebody watching for presence activity needs telling rather than left to
    // infer it from silence.
    if (r.ok === false) { Logger.warn("BotRuntime: presence reconcile refused — " + r.reason); return; }
    if (r.added.length || r.removed.length || (r.warned && r.warned.length)) {
      Logger.info("BotRuntime: presence — added [" + _names(r.added)
        + "], warned [" + _names(r.warned || []) + "], removed [" + _names(r.removed) + "]");
      return;
    }
    // THE QUIET LINE IS FALSE WHEN EVERYTHING DUE WAS REFUSED. Empty lists look identical whether
    // nothing was due or every removal was rejected, and the refusal has already said so in its
    // own words at the point it settled.
    if (r.refused && r.refused.length) return;
    // DESCRIBED RATHER THAN CHARACTERISED, for the reason the idle sweep records: somebody warned
    // and waiting out their grace is in no list at all, so `membership already correct` was
    // printed on every pass of the countdown to their removal.
    Logger.debug("BotRuntime: presence — ran, " + (r.inChannelCount || 0) + " in the channel, "
      + (r.pending || 0) + " already warned and waiting, "
      + (r.awaiting || 0) + " invited and not yet in");
  }

  // Returns a promise for whether the warning was DELIVERED. See the note at the tail.
  // ── THE PRESENCE-ONLY WARNING ─────────────────────────────────────────────────────────────
  // Sent only when the queue is NOT already warning this person — see the piggyback note in
  // `reconcilePresence`. It names the presence chat specifically, because "you will be removed" is
  // not enough when there are two different things to be removed from and only one applies here.
  //
  // IT ONLY SENDS. The caller marks before calling and un-marks if this answers false, which is
  // exactly how the queue half works — an undelivered warning must never start a removal clock,
  // and keeping the mark in one place keeps the report synchronous for callers that render it.
  function _warnPresence(who, graceMs) {
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") return Promise.resolve(false);
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    // NO FALLBACK TO THE ACTIVE TIER, for the reason `_warn` records at length: the active tier is
    // a device-local preference, and since `presence` became selectable it could be the presence
    // chat itself — a warning about being removed from a channel, delivered into that channel.
    if (!mainId) return Promise.resolve(false);
    let p = null;
    // Called inside the try, not inside `Promise.resolve(...)`: an argument is evaluated before
    // the call that wraps it, so a synchronous throw would escape.
    try {
      p = Chat.sendTo(mainId, who + " — AFK check. Do something in the next "
        + _humanSpan(graceMs) + " to stay in the presence chat.");
    } catch (e) { return Promise.resolve(false); }
    // ANSWERS ONLY. The caller sets and clears the mark, so both halves of this module keep one
    // shape and the report stays synchronous.
    return Promise.resolve(p).then((r) => !(r && r.ok === false), () => false);
  }

  function _warn(who, idle, graceMs) {
    // No chat wired at all is a DEFINITE non-delivery, not an unknown one.
    // ── THE WARNING GOES TO THE ROOM'S MAIN CHAT, NOT TO WHATEVER TAB IS OPEN ────────────────
    // `Chat.send` follows the ACTIVE tier, and the active tier is a DEVICE-LOCAL, PERSISTENT
    // preference. So this used to land wherever the bot's client was last pointed: someone
    // clicking a tab once on the bot's machine redirected every warning after it, silently and
    // permanently. Since `presence` became selectable it could be the presence chat — the one
    // channel that holds only ACTIVE people, so a warning to an idle person would land where they
    // are least likely to see it and may have just been removed from.
    //
    // THE MAIN TIER IS THE ROOM'S ANSWER, resolved at send time from `Room.chatTiers()` rather
    // than captured at start, so an owner changing the `chat` setting moves the warning with it.
    // It is the tier the room itself calls main — not a channel named here, which would be a
    // second answer to a question the settings blob already answers.
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") { delete _pending[who]; return Promise.resolve(false); }
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    // NO FALLBACK TO THE ACTIVE TIER. Unable to resolve the main chat is a DEFINITE
    // non-delivery, and the pending mark clears so the next sweep tries again — falling back to
    // wherever the tab points is the exact behaviour this replaces.
    if (!mainId) { delete _pending[who]; return Promise.resolve(false); }
    // ── WHAT THE MESSAGE HAS TO CARRY ─────────────────────────────────────────────────────────
    // Both numbers, because they answer different questions and one without the other is a
    // half-warning: how long they have been quiet (why this is happening) and HOW LONG THEY HAVE
    // (what to do about it). A warning that names no deadline asks somebody to hurry without
    // saying how much.
    //
    // Rounded to whole minutes and floored, never ceiled: telling somebody they have three minutes
    // when they have three and a half is harmless, telling them four when they have three and a
    // half is a promise the sweep will break. Under a minute says seconds rather than "0 minutes".
    const grace = _humanSpan(graceMs);
    // THE CALL IS MADE INSIDE THE TRY, NOT INSIDE `Promise.resolve(...)`. An argument is evaluated
    // BEFORE the call that wraps it, so `Promise.resolve(Chat.send(x))` does not catch a
    // SYNCHRONOUS throw from `Chat.send` — it escapes `_warn`, and `_warn` is called from
    // `sweepIdle` outside any try, which would break the TOTAL contract `sweepIdle` documents
    // above. LATENT RATHER THAN LIVE: production `Chat.send` is an `async function`, so it
    // rejects and never throws synchronously. Held because the contract is written down and a
    // collaborator that stops being async should not silently end a pass mid-rotation.
    let p = null;
    try {
      // SHORT, AND IT STILL CARRIES THE DEADLINE. The long form explained the queue's whole rule
      // to somebody who mostly needs to know they have a few minutes. `mins` is dropped rather
      // than shortened: how long they have BEEN quiet is the bot's justification, not the reader's
      // problem, and the one number that changes what they do is how long they have LEFT.
      p = Chat.sendTo(mainId,
        who + " — AFK check. Do something in the next " + grace + " to keep your place."
      );
    } catch (e) { delete _pending[who]; return Promise.resolve(false); }
    // ── AND IT ANSWERS, so the caller's report can be corrected ────────────────────────────
    // The mark clearing on non-delivery was already right: an undelivered warning must not start
    // a removal clock. What was missing is that `sweepIdle` had already pushed this person into
    // its `warned` list SYNCHRONOUSLY, so a warning that never arrived was still reported as a
    // warning that happened. Returning the outcome lets the caller take the name back out.
    return Promise.resolve(p).then((r) => {
      const okd = !(r && r.ok === false);
      if (!okd) delete _pending[who];
      return okd;
    }, () => { delete _pending[who]; return false; });
  }

  // ── THE CANCELLATION MESSAGE ────────────────────────────────────────────────────────────────
  // Same destination and the same delivery rules as the warning, and deliberately NOT gated on
  // delivery: if this one fails to send, nothing downstream depends on it. The warning's send
  // result decides whether a removal may follow; this one decides nothing, so a failure is dropped
  // rather than retried, and the person keeps their place either way.
  function _unwarn(who) {
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") return;
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    if (!mainId) return;
    try {
      Promise.resolve(Chat.sendTo(mainId,
        who + " — thanks, you're back. Place kept."
      )).catch(() => {});
    } catch (e) { /* a failed thank-you costs the room nothing */ }
  }

  // ── WHAT THE ROOM IS TOLD WHEN SOMEBODY IS REMOVED ──────────────────────────────────────────
  // COMPOSED FROM BOTH SWEEPS AT ONCE, which is why it lives at the tick rather than inside
  // either one. A person can lose their queue place and their presence seat in the same pass, and
  // two separate lines about the same person in the same second reads as two events. One line.
  //
  // The bot's own removals are announced; nothing else is. A removal is a thing the room did TO
  // somebody without being asked, and the room should be able to see it happen — the same reason
  // the warning is public rather than a DM.
  function _announceRemovals(queueRemoved, presenceRemoved) {
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") return [];
    const q = Array.isArray(queueRemoved) ? queueRemoved : [];
    const pr = Array.isArray(presenceRemoved) ? presenceRemoved : [];
    if (!q.length && !pr.length) return [];
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    if (!mainId) return [];

    // ONE ENTRY PER PERSON, in a stable order so two clients narrating the same sweep say the same
    // thing in the same sequence.
    const seen = Object.create(null);
    for (const u of q) { if (u) (seen[u] = seen[u] || {}).queue = true; }
    for (const u of pr) { if (u) (seen[u] = seen[u] || {}).presence = true; }

    const said = [];
    for (const who of Object.keys(seen).sort()) {
      const f = seen[who];
      const what = (f.queue && f.presence) ? "the queue and the presence chat"
                 : (f.queue ? "the queue" : "the presence chat");
      const line = who + " was removed from " + what + " — away too long.";
      said.push(line);
      // NOT GATED ON DELIVERY, unlike the warning. The warning's send result decides whether a
      // removal may follow; this one reports something that ALREADY happened, so a failed send
      // costs the room a line and changes nothing.
      try { Promise.resolve(Chat.sendTo(mainId, line)).catch(() => {}); } catch (e) {}
    }
    return said;
  }

  // ── THE REMOVAL REPORTS WHETHER IT LANDED ────────────────────────────────────────────────
  // This was fire-and-forget, and the comment argued the loop was self-correcting: a remove that
  // did not land leaves the person in the rotation, the next sweep sees them, and it warns again.
  //
  // IT IS SELF-CORRECTING IN THE WRONG UNIT. What repeats is not the removal but the WHOLE CYCLE
  // — because the pending mark was deleted before this was called, the next sweep finds no mark,
  // treats them as never warned, and posts a fresh public warning and a fresh full grace period.
  // A failing send therefore produces one accusation per grace period, indefinitely, about
  // somebody the bot has already decided to remove. That is not a correction, it is a loop.
  //
  // So it answers. `Queue.remove` returns a refusal object when this client may not write and
  // resolves undefined when the event went out; a throw is a send that failed. TRUE means the
  // event was sent, which is the most this layer can know — the fold decides legality, and if it
  // refuses the event the person stays in the rotation and the next sweep removes them again
  // WITHOUT re-warning, because the mark is still set.
  function _remove(who) {
    if (typeof Queue === "undefined" || typeof Queue.remove !== "function") return Promise.resolve(false);
    let p = null;
    // Called inside the try, not inside `Promise.resolve(...)`: an argument is evaluated before
    // the call that wraps it, so a synchronous throw would escape. Same reasoning as `_warn`.
    try { p = Queue.remove(who); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then((r) => !(r && r.ok === false), () => false);
  }

  function stop() {
    if (!_running) return { ok: false, reason: "not-running" };
    try { MatrixBridge.offRawEvent(_running.handler); } catch (e) {}
    // THE TIMER AND THE WARNED SET BOTH DIE HERE. A surviving interval would go on sweeping a room
    // this client has left — and `_evaluateBot` stops before it starts on every room entry, so a
    // leaked timer would accumulate one per room visited. The warned set is per-room state for the
    // same reason: carrying it across would let somebody be removed in room B on the strength of a
    // warning they received in room A.
    if (_sweepTimer !== null && typeof clearInterval === "function") {
      try { clearInterval(_sweepTimer); } catch (e) {}
    }
    _sweepTimer = null;
    _pending = Object.create(null);
    _presPending = Object.create(null);
    _repeatActedPi = null;
    // ── THE OBSERVATION CLOCK STOPS; THE OBSERVATIONS THEMSELVES DO NOT DIE HERE ──────────────
    // `_chatSince` is the start of a CONTINUOUS observation, and a stop breaks continuity — so it
    // resets, and the next run refuses to conclude anything until it has watched a full window
    // again. That costs a rank change one blind window, which fails in the keep-everybody
    // direction. Preserving it across a short stop would need a rule for how short is short
    // enough, which is a number nobody could defend.
    //
    // `_chatSeen` IS NOT CLEARED HERE, DELIBERATELY, and this is where a previous version said it
    // was while doing nothing. It is cleared in `start()` when the ROOM changes: `stop()` also
    // runs on a rank change in the same room, where the observations are about this room and are
    // true. And `_noteChat` now refuses to record while stopped, which is the half that clearing
    // here could never have covered — the chat listener has no `offMessage` and stays subscribed.
    _chatSince = 0;
    for (const u in _entries) delete _entries[u];
    _lastRotation = null;
    _running = null;
    return { ok: true };
  }

  // A reading, not a flag. Returns a fresh object so a caller cannot hold a reference into the
  // runtime's own state and watch it change under them.
  function status() {
    if (!_running) return { running: false, mode: null, level: null, seen: 0, acted: 0, refused: 0,
                            noType: 0, notHandled: 0 };
    return { running: true, mode: _running.mode, level: _running.level,
             seen: _running.seen, acted: _running.acted, refused: _running.refused,
             noType: _running.noType, notHandled: _running.notHandled };
  }

  // ── COMPACT VALUES, SO A WHOLE SETTINGS BLOB FITS ON A LINE ───────────────────────────────
  // A CAP, because `added` on a first presence reconcile is everybody the room considers around
  // and a line per member would be the flood the counters in `_onRaw` exist to avoid. Six names
  // identify a pattern; the remainder is a number, and the exact membership is a Matrix question
  // rather than a log one.
  function _names(list, cap) {
    const a = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!a.length) return "none";
    const n = (typeof cap === "number" && cap > 0) ? cap : 6;
    return a.slice(0, n).join(", ") + (a.length > n ? " (+" + (a.length - n) + " more)" : "");
  }
  function _brief(v) {
    if (v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return "[" + v.length + " rows]";
    if (typeof v === "object") {
      const ks = Object.keys(v);
      if (!ks.length) return "{}";
      if (ks.length > 8) return "{" + ks.length + " keys}";
      return "{" + ks.map((k) => k + ":" + _brief(v[k])).join(",") + "}";
    }
    return String(v);
  }
  // ── EVERY SETTING, NOT A CURATED SET, AND THAT IS THE POINT ───────────────────────────────
  // The obvious version of this prints the bot's own dials — `botAfkMs`, `botPingMs`,
  // `queueIdleMs` and the rest. That list is a SECOND COPY of "which settings the bot reads",
  // maintained by hand here and by the code everywhere else, and it would go stale in the
  // direction that hurts: a dial added tomorrow governs the bot and is silently absent from the
  // one line somebody is reading to find out why the bot did something. Printing the whole blob
  // cannot drift, and it costs one line of a report that is only produced on demand.
  //
  // It also answers questions the curated list could not. Whether somebody may join the rotation
  // at all is `minDjRank`; which chat the bot announces into is `chat`. Both decide bot-visible
  // behaviour and neither carries a `bot` prefix.
  function _settingsLine() {
    let s = null;
    try { s = StreamManager.getState().settings; } catch (e) { s = null; }
    if (!s || typeof s !== "object") {
      // NOT "defaults". A bot that cannot read the room's settings is acting on whatever the
      // reducer last handed it, and naming a value it might not hold would be worse than silence.
      return "settings UNREADABLE — nothing here can say which rules the bot is applying";
    }
    return Object.keys(s).sort().map((k) => k + "=" + _brief(s[k])).join(" ");
  }

  // ── WHAT THIS CLIENT CAN ACTUALLY DO, WALKED ONCE AT START ────────────────────────────────
  // `start()` checked the bot's RANK and nothing else, then logged `bot mode on`. That line reads
  // as "everything is fine" and was emitted by a bot that might have no presence channel, be
  // unable to see chat, and be unable to read the roster. Each of those disables a different
  // part of the job and two of them do it in total silence.
  //
  // THE ROSTER IS THE ONE THAT MATTERS MOST. An unreadable roster makes `ownerIds` null, which
  // makes every presence removal unsafe, which turns the entire presence half off — correctly,
  // since the bot cannot tell who the owner is, but permanently and without a word. The log then
  // looks healthy while a feature is dead.
  //
  // THE CHANNELS ARE DERIVED FROM THE TABLE BY KIND, never listed here. A row added to
  // `channelTaxonomy()` is checked on the day it is added, and no channel key is spelled in this
  // file — the same rule the tier resolver follows, for the same reason: a hand list goes stale
  // toward silence, and silence is what this function exists to remove.
  //
  // TOTAL. Every read is wrapped, and an unreadable answer is reported as unreadable rather than
  // as absent — "I could not look" and "it is not there" are different facts and the second one
  // would be a guess.
  // FIELD NAMES AVOID THE SETTINGS VOCABULARY. `chat` is a room setting naming the MAIN tier;
  // using the same word here for "how many chat channels exist" is the confusable-pair shape
  // this tree keeps a written list of, and `check-bot-runtime` PART C caught it on the first run.
  function _capabilities() {
    const cap = { events: null, chatChannels: null, presenceChannel: null,
                  presencePower: null, presenceKickAt: null, presenceJoined: null,
                  roster: null, chatFeed: false, chatTiers: null, timer: false, notes: [] };
    const ch = (_running && _running.channels) || null;
    let tax = null;
    try { tax = MatrixBridge.channelTaxonomy ? MatrixBridge.channelTaxonomy() : null; }
    catch (e) { tax = null; }

    if (!Array.isArray(tax)) {
      cap.notes.push("channel table UNREADABLE — cannot say which channels are missing");
    } else if (!ch) {
      cap.notes.push("no channel map was handed to start() — the bot was given nothing to work with");
    } else {
      const count = (kind) => {
        const rows = tax.filter((r) => r && r.kind === kind && typeof r.key === "string");
        const missing = rows.filter((r) => !ch[r.key]).map((r) => r.slug || r.key);
        return { have: rows.length - missing.length, want: rows.length, missing: missing };
      };
      cap.events = count("events");
      cap.chatChannels = count("chat");
      const pRow = tax.filter((r) => r && r.kind === "presence")[0] || null;
      const pId = (pRow && pRow.key) ? ch[pRow.key] : null;
      cap.presenceChannel = !!pId;
      if (pId) {
        try { cap.presenceJoined = MatrixBridge.amJoined ? !!MatrixBridge.amJoined(pId) : null; }
        catch (e) { cap.presenceJoined = null; }
        // ── AND WHETHER IT CAN ACTUALLY KICK THERE, WHICH IS THE QUESTION ────────────────────
        // Joining was the neighbouring question. The bot held 99 on the SPACE and 0 in this
        // channel, passed the joined check, and could not remove anybody — `[403] You cannot kick
        // user` once a minute for three sessions, while the startup line said it was fine.
        // Power is PER ROOM, so it is asked per room.
        try { cap.presencePower = MatrixBridge.getMyPowerLevel ? MatrixBridge.getMyPowerLevel(pId) : null; }
        catch (e) { cap.presencePower = null; }
        try { cap.presenceKickAt = MatrixBridge.kickLevelOf ? MatrixBridge.kickLevelOf(pId) : null; }
        catch (e) { cap.presenceKickAt = null; }
      }
    }

    // THE ROSTER, ASKED THE WAY `reconcilePresence` ASKS IT, so this reports the answer that
    // function will actually get rather than a second opinion about it.
    try {
      const roster = MatrixBridge.getRoster ? MatrixBridge.getRoster(_running && _running.roomId) : null;
      cap.roster = Array.isArray(roster) ? roster.length : null;
    } catch (e) { cap.roster = null; }

    // `_chatSince` is set only when `Chat.onMessage` accepted the subscription, so it is the
    // honest answer to "is this bot observing chat" — not whether the module exists.
    cap.chatFeed = !!_chatSince;
    try { cap.chatTiers = (typeof Chat !== "undefined" && Chat.readableTiers)
                            ? Chat.readableTiers().length : null; }
    catch (e) { cap.chatTiers = null; }
    cap.timer = _sweepTimer !== null;
    return cap;
  }

  // The capability report as one line. Written at `start()`, beside the line that used to claim
  // everything was fine on its own.
  function _reportCapabilities(cap) {
    const bit = (c) => (c ? c.have + "/" + c.want + (c.missing.length ? " (missing " + c.missing.join(", ") + ")" : "") : "unreadable");
    const parts = [];
    parts.push("events " + bit(cap.events));
    parts.push("chat " + bit(cap.chatChannels));
    // THE POWER IS PART OF THE SENTENCE, not a separate line. "joined" alone is what read as fine
    // while every removal was refused, so the two facts travel together or the first one lies.
    let pres = (cap.presenceChannel === null) ? "unreadable"
      : !cap.presenceChannel ? "MISSING" : (cap.presenceJoined ? "joined" : "not joined");
    if (cap.presenceChannel) {
      if (cap.presencePower === null || cap.presenceKickAt === null) {
        pres += ", power UNREADABLE";
      } else if (cap.presencePower >= cap.presenceKickAt) {
        pres += ", can kick (" + cap.presencePower + " of " + cap.presenceKickAt + ")";
      } else {
        pres += ", CANNOT KICK (" + cap.presencePower + " of " + cap.presenceKickAt + " needed)";
      }
    }
    parts.push("presence channel " + pres);
    parts.push("roster " + (cap.roster === null ? "UNREADABLE" : cap.roster + " rows"));
    parts.push("chat feed " + (cap.chatFeed ? "observing" : "NOT observing")
      + (cap.chatTiers === null ? "" : " (" + cap.chatTiers + " tier(s) readable)"));
    parts.push("sweep timer " + (cap.timer ? "on" : "OFF"));
    Logger.info("BotRuntime: capabilities — " + parts.join(" · "));

    // ── AND WHAT IS TURNED OFF BY WHAT IS MISSING, SAID OUT LOUD ────────────────────────────
    // The list above is facts; this is the consequence, which is the part somebody watching
    // actually needs. Each line names the capability AND the job it disables, because "roster
    // unreadable" only means something to a reader who already knows what the roster is for.
    const off = [];
    if (cap.roster === null) {
      off.push("presence removals (cannot identify the owner, so every drop is unsafe)");
    }
    if (cap.presenceChannel === false) off.push("presence entirely (no channel in this room)");
    else if (cap.presenceJoined === false) off.push("presence entirely (this client has not joined it)");
    else if (cap.presencePower !== null && cap.presenceKickAt !== null
             && cap.presencePower < cap.presenceKickAt) {
      // NAMED WITH THE FIX, because this one is a room permission and nothing the bot can do about
      // it by trying again — it retried once a minute for three sessions.
      off.push("presence REMOVALS (power " + cap.presencePower + " in that channel, "
        + cap.presenceKickAt + " needed to kick — re-assign this account's rank so it is written "
        + "into every channel, or grant it there directly)");
    }
    if (!cap.timer) off.push("the idle sweep and the presence pass (no timer)");
    if (!cap.chatFeed) {
      // NOT a disabled feature — a narrowed one, and worth separating from the list above.
      Logger.info("BotRuntime: not observing chat — nobody will be judged silent on chat "
        + "evidence, so removals are FEWER rather than wrong");
    }
    if (cap.chatChannels && cap.chatChannels.missing.length) {
      Logger.warn("BotRuntime: chat tiers missing from this room (" + cap.chatChannels.missing.join(", ")
        + ") — anything said in them is invisible to the bot");
    }
    for (const note of cap.notes) Logger.warn("BotRuntime: " + note);
    if (off.length) {
      Logger.warn("BotRuntime: DISABLED — " + off.join("; "));
    }
    return cap;
  }

  // ── THE STATUS LINE — `status()` PUT WHERE A PERSON CAN READ IT ───────────────────────────
  // `status()` returns an object and nothing renders it, so answering "is this client even the
  // bot" needed devtools — which is the same gap the docs already record for bot-ness generally
  // ("the only signal today is a console line"). This writes the same facts into the log, where
  // the rest of the evidence already is and where the copy-out will carry it.
  //
  // It REPORTS AND DECIDES NOTHING, and takes no argument: a caller that could pass a level or a
  // room could describe a bot this client is not. Everything printed is read from `_running` at
  // call time, so a stale line cannot be produced by a stale caller.
  function report() {
    const s = status();
    if (!s.running) {
      Logger.info("BotRuntime: NOT running on this client — nothing here acts as the bot");
      return s;
    }
    Logger.info("BotRuntime: running (" + s.mode + ", level " + s.level + ") — " +
      "handled " + s.seen + ", granted " + s.acted + ", refused " + s.refused + "; " +
      "skipped " + s.notHandled + " (not this mode's type), " + s.noType + " (no ddjp type)");
    // A SECOND LINE RATHER THAN A LONGER ONE. The counters describe this CLIENT and the settings
    // describe the ROOM, and they fail independently — a bot with sane counters under wrong
    // settings and a bot with wrong counters under sane settings are different faults. On one
    // line the settings would push the counters off the readable part of the panel.
    Logger.info("BotRuntime: room settings — " + _settingsLine());
    // ── RE-TAKEN, NOT REMEMBERED ────────────────────────────────────────────────────────────
    // The startup capability line is a reading of one moment. A channel that became unreadable
    // afterwards would not update it, so it would sit in the log as a confident sentence that is
    // no longer true — which is this tree's own third failure signature. Pressing the button asks
    // again.
    try { _reportCapabilities(_capabilities()); } catch (e) {
      Logger.warn("BotRuntime: capability re-check failed — " + ((e && e.message) || e));
    }
    // AND THE TWO CLOCKS, because "why has nobody been removed" is answered by these and by
    // nothing else in the log: how many people the bot can date a join for, and how many are
    // mid-grace right now on each side.
    let q = 0, pz = 0;
    for (const u in _pending) { if (typeof _pending[u] === "number") q++; }
    for (const u in _presPending) { if (typeof _presPending[u] === "number") pz++; }
    Logger.info("BotRuntime: clocks — " + Object.keys(_entries).length + " known join time(s); "
      + q + " warned about the queue, " + pz + " about the presence chat");
    return s;
  }

  // ── THE WATCH LOOP ────────────────────────────────────────────────────────────────────────
  // Every arriving event is offered to the mode's handled list. Anything else is ignored without
  // comment: the raw fan-out carries every routed event in the client's scope, so this handler
  // sees the whole room and must be cheap and silent about the vast majority of it.
  // ── THE DDJP TYPE, NOT THE MATRIX TYPE ─────────────────────────────────────────────────────
  // This read `raw.type`, which is what `event.getType()` returned — and every DDJP event goes on
  // the wire as `m.room.message` with its real type inside the JSON body as `t`. So
  // `raw.type === "ddjp.bot.request"` COULD NEVER BE TRUE, and the mode filter above it rejected
  // every event before the counter, leaving `seen: 0, acted: 0, refused: 0` in a room where three
  // requests were sitting in the log.
  //
  // REPORTED BY THE OWNER, TWICE, AND MY FIRST DIAGNOSIS WAS WRONG. I explained it as the
  // live-only rule correctly ignoring replayed requests — true of those three, and not the cause.
  // The probe I wrote to confirm the feature passed a synthetic `{ type: "ddjp.bot.request" }`,
  // which is a shape the transport cannot produce, so it measured the reader's expectation rather
  // than the writer's output. Driven with a real `m.room.message` envelope, it reproduces the
  // room exactly.
  // ── THE THREE SILENT RETURNS, COUNTED RATHER THAN LOGGED ──────────────────────────────────
  // This function runs on EVERY raw event, so a log line here would fire once per event and empty
  // the 2000-line panel during a replay — the one window in which the interesting lines are
  // produced. Counters cost nothing and answer the question a line would have.
  //
  // AND THE QUESTION IS A REAL ONE THAT HAS ALREADY COST A SESSION. When the transport was not yet
  // stamping `ddjpType`, this returned at the second line for every event and `status()` read
  // `seen: 0, acted: 0, refused: 0` while three requests sat in the log. That reads as "nothing
  // arrived" and the truth was "everything arrived and none of it was recognised" — two different
  // faults in two different files, and nothing on the surface separated them. `noType` high with
  // `seen` at zero is now that defect's signature rather than an indistinguishable zero.
  //
  // `notHandled` is the ordinary case and is expected to be large: one mode handles one type, so
  // every play, vote and settings event in the room lands here. It is counted because a mode
  // table that stopped matching would look exactly like a room with no requests in it.
  // ── WHO ENTERED THE ROTATION, AND WHEN — DERIVED, NEVER ANNOUNCED ─────────────────────────
  // Pressing Join sends nothing. `joinRoomQueue()` sets a local flag and kicks the reconcile loop,
  // which submits songs — and a submit is a join carrying a video, which is correctly NOT activity
  // because the same loop fires it unprompted as a buffer tops up. So joining produced no counted
  // act, and somebody was warned twenty seconds after joining. Measured in a live room.
  //
  // THREE OTHER ANSWERS WERE TRIED AND REFUSED, and the reasons are worth keeping:
  //   • record it in the reducer and carry it on the rotation — five guards caught real divergence,
  //     because the checkpoint seed lists its member fields by name. Two clients would derive
  //     different rotations and disagree about who is idle. Fixable only by re-seeding every room.
  //   • have Join send a bare `ddjp.dj.join {}`, as Leave already sends `ddjp.dj.leave` — a
  //     SELF-REPORTED join is a CLAIM, not evidence. A modified client sends one with every song
  //     and never goes idle.
  //   • watch the rotation live only — free and un-gameable, but the bot is a browser tab and every
  //     restart forgets everyone.
  //
  // SO IT IS DERIVED FROM THE QUEUE, which cannot be faked: nobody is in the rotation without the
  // events that put them there, and those are the same events the room already agrees on. Held
  // HERE rather than in derived state, because it is one client's bookkeeping and not room truth —
  // which is exactly why it cannot cause the divergence the first answer did.
  const _entries = Object.create(null);   // userId -> ts they entered the rotation
  let _lastRotation = null;               // Set of users, or null before the first reading

  function _rotationSet(rot) {
    const out = new Set();
    if (Array.isArray(rot)) for (const m of rot) { if (m && typeof m.user === "string") out.add(m.user); }
    return out;
  }
  // One comparison against the previous reading. An arrival is an entry; a departure forgets its
  // entry, so somebody who leaves and comes back gets a NEW one rather than an old stale time.
  function _applyRotation(now, ts) {
    if (_lastRotation !== null) {
      // A `null` ts records the arrival without dating it — `_entries` stays absent, which reads
      // as "cannot say" downstream rather than as a join that never happened.
      if (ts !== null) { for (const u of now) { if (!_lastRotation.has(u)) _entries[u] = ts; } }
      for (const u of _lastRotation) { if (!now.has(u)) delete _entries[u]; }
    }
    _lastRotation = now;
  }

  // ── THE REPLAY, ONCE AT START ─────────────────────────────────────────────────────────────
  // Folds with `StateDeriver` ITSELF rather than a second copy of the membership rules — that was
  // the objection to this approach and the measurement removes it: re-deriving only at the events
  // that can move the rotation costs 563ms on a 960-event log and 17ms on a 60-event one, once.
  //
  // TOTAL, AND SILENT ON FAILURE BY DESIGN. A fold that throws is skipped rather than aborting the
  // replay: one unreadable event should cost one event's worth of precision, not every entry time
  // in the room. What it cannot recover stays absent, and absent means "cannot say".
  function _seedEntries() {
    // THROUGH THE INTERFACE, NOT THE REDUCER. The first version folded with `StateDeriver` here
    // and `check-boundaries` caught it: `features/` may reach the backend only through
    // `StreamManager` and `MatrixBridge`. The rule is right — a feature that folds for itself is a
    // second reducer, and this one would have had its own copy of the fall-out rules to drift.
    // The replay lives in `StreamManager` beside the fold it uses.
    let map = null;
    try { map = StreamManager.rotationEntries(); } catch (e) { map = null; }
    let n = 0;
    if (map && typeof map === "object") {
      for (const u in map) { if (typeof map[u] === "number") { _entries[u] = map[u]; n++; } }
    }
    // The rotation as it stands NOW becomes the baseline the live watch compares against, so the
    // first arrival after start reads as an arrival rather than as the whole room joining at once.
    try { _lastRotation = _rotationSet(StreamManager.getState().rotation); }
    catch (e) { _lastRotation = new Set(); }
    return n;
  }

  // ── AND LIVE, PER EVENT ───────────────────────────────────────────────────────────────────
  // Stamped with the EVENT's timestamp, not the moment the bot noticed — the homeserver's clock is
  // the one every other part of this rule already uses, and noticing can lag a fold.
  function _watchRotation(raw) {
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return; }
    if (!st) return;
    // NO FALLBACK CLOCK. An event carrying no usable timestamp cannot date an entry, and stamping
    // it with "now" would credit somebody for joining at the moment the bot happened to look —
    // reading as freshly active when they may have joined an hour ago. The membership reading is
    // still taken, so a DEPARTURE is still noticed; only the entry time is withheld.
    const ts = (raw && typeof raw.ts === "number" && isFinite(raw.ts)) ? raw.ts : null;
    _applyRotation(_rotationSet(st.rotation), ts);
  }

  // What the bot knows about one person's entry, or null.
  //
  // EXPORTED FOR THE GUARDS AND NOTHING ELSE, said plainly because this tree keeps a list of
  // functions that were exported, never called, and taken for working. `check-idle-sweep` PART D3
  // reads it to prove the replay recovered a join the bot never watched happen — the restart case,
  // which cannot be asserted through the sweep alone because a sweep that ignored join times
  // entirely would still pass on somebody who had also done something else.
  //
  // Production reaches the same value through `sweepIdle`, which calls it directly.
  function enteredAt(who) {
    const t = _entries[who];
    return (typeof t === "number") ? t : null;
  }

  function _onRaw(raw, event, room) {
    if (!_running || !raw) return;
    // BEFORE THE TYPE GATES, and that placement is load-bearing. Consensus mode handles only
    // `ddjp.bot.request`, so every join, leave and play returns two lines below — and those are
    // exactly the events that move the rotation. Watching after the gates would see nothing.
    _watchRotation(raw);
    const type = raw.ddjpType || null;   // stamped by the transport from the parsed body
    if (!type) { _running.noType++; return; }
    if (_running.mode && MODES[_running.mode].handles.indexOf(type) < 0) { _running.notHandled++; return; }
    _running.seen++;
    if (type === "ddjp.bot.request") { _handleRequest(raw); return; }
  }

  // THE DELEGATION POLICY IS NOT RESTATED HERE. `BotSettings.decide` owns it, and this runtime's
  // only job is to hand it the request, the requester's rank and the room's CURRENT settings —
  // read fresh, never cached, because a cached table would go on applying a delegation the owner
  // has since revoked.
  function _handleRequest(raw) {
    let settings = null;
    try { settings = StreamManager.getState().settings; } catch (e) { settings = null; }
    if (!settings) { _running.refused++; return; }
    // THE REQUESTER'S RANK IS THE CHANNEL ORIGIN THE TRANSPORT STAMPED, never a field in the
    // payload. Same rule as the gate above and as every other authority decision in the tree.
    const senderLevel = (typeof raw.senderRank === "number") ? raw.senderRank : -1;
    // THE PARSED PAYLOAD, NOT THE MATRIX CONTENT. `raw.content` is `{ msgtype, body }` where
    // `body` is still a JSON STRING — so this used to hand `decide` an object with no `k` and no
    // `v`, which is the second half of the same defect. `ddjpBody` is that string already parsed,
    // stamped once by the transport rather than re-parsed here.
    const body = raw.ddjpBody || {};
    const p = BotSettings.authorIfPermitted(body, senderLevel, settings, _running.authorSettings);
    // ── THE REQUEST IS REPORTED FROM HERE, BECAUSE THIS IS THE LAYER THAT KNOWS WHO ASKED ─────
    // `BotSettings.authorIfPermitted` already logs a refusal reason, and that half was never
    // missing. What it cannot say is WHO — it is handed a `senderLevel` and deliberately not a
    // user id, because a policy module that knew the requester could start deciding by identity
    // instead of by rank. So the two halves are logged by the two layers that hold them.
    //
    // THE VERDICT IS RESTATED HERE ANYWAY, and that is not a second copy of a rule — it is one
    // value printed twice, by a module that did not compute it. Without it, filtering the panel to
    // `BotRuntime` shows a refusal with no reason and the reason sits under `BotSettings`, so the
    // one view somebody opens to watch the bot would be the view that cannot answer the question.
    //
    // AND THE SUCCESS CASE IS THE ONE THAT WAS GENUINELY SILENT. A granted request incremented
    // `acted` and said nothing, so "the bot authored the change" and "nothing happened at all"
    // produced identical logs — and the settings panel re-renders from derived state either way,
    // which is the same silent-refusal shape CONCEPTS.md Part 6 §14 records for the owner's own
    // edits. One line per request, and a request is a person clicking, so the volume is nothing.
    Promise.resolve(p).then((v) => {
      if (!_running) return;
      const who = raw.sender || "?";
      const key = (body && typeof body.k === "string") ? body.k : "?";
      if (v && v.ok) {
        _running.acted++;
        Logger.info("BotRuntime: request GRANTED — `" + key + "` from " + who +
          " (level " + senderLevel + ")");
      } else {
        _running.refused++;
        Logger.info("BotRuntime: request REFUSED — `" + key + "` from " + who +
          " (level " + senderLevel + ") — " + ((v && v.reason) || "no verdict"));
      }
    }, (e) => {
      if (!_running) return;
      _running.refused++;
      // A REJECTED PROMISE IS ITS OWN OUTCOME, and it used to join the refusals silently. It is
      // not a policy refusal: `authorIfPermitted` catches its own write failure and RESOLVES with
      // `author-failed`, so reaching here means something above policy threw — and reporting that
      // as an ordinary refusal would send somebody hunting a delegation table that is fine.
      Logger.error("BotRuntime: request THREW — " + ((e && e.message) || e));
    });
  }

  return { MODES, DEFAULT_MODE, botLevel, eligible, start, stop, status, report, enteredAt, sweepIdle,
           // EXPORTED FOR THE SAME REASON ITS TWO SIBLINGS ARE: production reaches it through the
           // tick, which has no name to extract, so an unexported sweep is one no guard can ever
           // drive. The first draft left it unexported and then WROTE THAT LIMITATION INTO THE
           // GUARD as though it were inherent, which is a gap being documented instead of closed.
           sweepRepeat,
           reconcilePresence, SWEEP_EVERY_MS, actingAsBot, mayOffer, BOT_MAY_NOT, viewOff };
})();
