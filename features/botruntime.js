// features/botruntime.js — the bot runtime.
//
// Depends on: MatrixBridge, BotSettings, Room, StreamManager, Logger (Chat, Queue, Skip, ServerClock,
// Capabilities and ChatPrefs where present).
//
// ── WHAT THIS IS, AND WHY IT IS ITS OWN JOB ─────────────────────────────────────────────────
// J17 designed the bot, J18 built delegated settings, J19 built a reputation tally (retired at J84: REP is its
// own entity now, the owner's ruling 21, and nothing of it lives in this file), and this is their caller. **UNTIL v322 IT HAD NONE**: this file existed, `index.html` loaded it, guards drove
// it, and the only mention of `BotRuntime` anywhere else in the tree was a comment in
// matrixbridge.js saying nothing called `start()`. Three modules, loaded and dead in every running
// client — which is why `check-bot-wiring` is structural rather than behavioural.
//
// It is REACHED NOW, from `features/room.js` `_evaluateBot`, at the one door both room-entry paths
// share, plus the rank hook so a promotion or demotion lands immediately. `botsettings.js` is still a pure
// library with no timer and no subscription of its own — that part of the original note stands, and it is what
// keeps its policy drivable without a room.
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
// ── THE ONE CONSEQUENCE OF THE 99 DECISION THAT COSTS SOMETHING ─────────────────────────────
// 99 *is* owner-tier — driven — so an owner-present room adopts owner floors on authority with no
// recompute. A bot that seals as the owner therefore makes every other client STOP VERIFYING. That
// is intended, and it is `consensus/trust-cascade.md` §9's normal operating mode; it is recorded
// here because "intended" and "noticed" are different things, and a reader meeting the gate above
// should meet its price at the same time. Running a bot changes who is checking the room's floors.
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
// **WHAT NEEDED A KEY WAS NOT BUILT HERE, AND STILL IS NOT: publishing reputation on a cadence.** "How often"
// had no settings key, and inventing a local default is exactly the second source this rule forbids. J84 paid that
// cost knowingly — `repSummaryMs` is a room setting (the owner's ruling 23) — and put REP in its own pieces
// (`features/rep-*.js`, ruling 21), so this runtime still publishes nothing and names nothing of REP. The bot side
// of REP asks one question of it, `actingAsBot()`, through REP's ports.
//
// ── ONE BEHAVIOUR, ONE SEAM, AND THE SECOND IS STILL NOT NEEDED ─────────────────────────────
// THE PREMISE OF THIS BLOCK CHANGED AND THE CONCLUSION SURVIVED IT, WHICH IS WHY IT IS REWRITTEN
// RATHER THAN DELETED. It read: *bot mode will differ in a bot-run room, and that room type does
// not exist*. **The room type EXISTS** — `backends/backend2/`, J24, DONE at v392, and it runs
// rooms. So the original reason for one row is gone.
//
// The row count did not move, on a better reason that was measured rather than assumed.
// `consensus/bot-backend.md` §5d and §8 swept this module against bot mode and marked it
// **[checked]**: this file is the AFK and presence half, it is SHARED and carries over
// UNCHANGED, and the levels it reads come from `getRoster`, which reads power levels from the
// Space and channels — which bot mode does not change. The authority half is a different
// program and lives in the engine (`backends/backend2/authority.js`, `runner.js`).
//
// So `MODES` still has exactly one entry, and the runtime still dispatches through it. What is
// no longer true is *a second row is unbuildable because its room type is imaginary*. What is
// true is *a second row is unnecessary because this half does not vary by room type*.
//
// ── THE ROW IS NAMED `consensus` AND THAT NAME IS NARROWER THAN WHAT IT COVERS ──────────────
// READ THIS BEFORE CONCLUDING A ROOM TYPE IS UNSUPPORTED. `consensus` means four different
// things in this tree, and the one here is the narrowest-LOOKING and the least room-specific:
//
//   1. P1, the PRINCIPLE — every client derives the same answer from the same events.
//      `ConsensusHash` is what proves it. True of BOTH engines.
//   2. `docs/consensus/` — the directory the rule documents live in.
//   3. "consensus engine" in `core/backends.js` — means ANY registered engine, bot-run included.
//   4. THIS ROW.
//
// The trap is that this row reads as *consensus rooms, as opposed to bot-run rooms*, and no
// such distinction exists anywhere else: the seam registers `"backend1"` and `"backend2"`,
// never `"consensus"`, and since v392 this row covers BOTH room types. A reader who takes the
// name at face value goes looking for a second row that is deliberately absent, and concludes a
// room type is unsupported when it is in fact handled by this same code.
//
// KEPT, NOT RENAMED — a rename is pinned by `check-bot-runtime` PART E and is a decision rather
// than a tidy-up. The cost is paid in explanation instead: this block, PART E's text, and
// `roles.md` §6 *Confusable pairs*, which owns the full four-way split.
const BotRuntime = (() => {

  // ── THE MODES TABLE — ONE ENTRY, SHAPED SO A SECOND IS ADDABLE ────────────────────────────
  // A table rather than a branch, because a table with one row is honest about being a table while
  // an `if` with one arm is a branch pretending to be a decision. Adding a mode means adding a row
  // and a reason; it does not mean finding every place a condition was assumed.
  //
  // STILL ONE ROW, AND SEE THE BLOCK ABOVE FOR WHY THAT REASON CHANGED: not because the second
  // room type is imaginary — it exists and runs rooms — but because this module is shared across
  // both and was checked against bot mode without needing to vary.
  const MODES = {
    consensus: {
      // The bot is a peer with owner-tier power that acts on requests; it authors nothing on its
      // own initiative. This holds in a bot-run room too: there the AUTHORITY is a separate
      // program in the engine, and this half is unchanged beside it.
      why: "the bot is a peer holding owner-tier power; this half is shared across both room types, unchanged",
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
  // that question — so measured across the catalogue at J52, **all 19 rows it had then resolved
  // identically for the bot and for a human owner** (the owner-tier gates aside, which read the
  // authority level). The display could not tell them apart.
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

  // ── THE BOT'S WAKE-UP ALARM: THE DECISION, AND THE SLEEP IT RINGS FOR (J68; the owner's decision 3, `ddjp_634`) ────────
  // A hidden bot that falls asleep — the computer slept, or the browser froze its tab — pauses the room until somebody comes
  // back, and the alarm is how it asks. Its sound, banner and title live in `ui/chat.js`; HERE is the question "should it ring
  // now?", pure and exported as `viewOff` is, so a guard drives every combination (`check-bot-alarm` PART A), and the sleep.
  //
  // `alarmNow({ mode, bot, slept, inView, armed })` answers `{ sound, flash, banner }`. Not the bot, or "off": nothing. The
  // banner asks for a click until one has armed it. "When the bot falls asleep" (the default, and what anything else reads as)
  // rings for a sleep while the tab is not in view — the sound when armed, the title when not. "Always on" sounds from arming
  // whatever the view, and flashes the title for a sleep it cannot sound. TOTAL: nothing given rings nothing.
  function alarmNow(s) {
    const o = s || {};
    const none = { sound: false, flash: false, banner: false };
    if (o.bot !== true || o.mode === "off") return none;
    const armed = o.armed === true;
    const woke = o.slept === true && o.inView !== true;
    if (o.mode === "always") return { sound: armed, flash: !armed && woke, banner: !armed };
    return { sound: woke && armed, flash: woke && !armed, banner: !armed };
  }
  // THE SLEEP, as Session tells it through the bridge: held only while this tab is the bot, cleared when the page has seen the
  // tab in view (`alarmWoken`) and when it stops being the bot. The page hears every change (`onAlarmChange`).
  let _alarmSlept = false;
  let _sleptWired = false;
  const _alarmListeners = [];
  function onAlarmChange(fn) { if (typeof fn === "function" && _alarmListeners.indexOf(fn) < 0) _alarmListeners.push(fn); }
  function _alarmSay() { for (const fn of _alarmListeners.slice()) { try { fn(); } catch (e) {} } }
  function alarmSlept() { return _alarmSlept === true && actingAsBot(); }
  function alarmWoken() { if (!_alarmSlept) return; _alarmSlept = false; _alarmSay(); }
  function _onSlept(x) {
    if (!actingAsBot()) return;
    _alarmSlept = true;
    const gap = (x && typeof x.gapMs === "number" && isFinite(x.gapMs)) ? Math.round(x.gapMs / 1000) + " s" : "a while";
    try { Logger.warn("BotRuntime: this tab slept — nothing from its heartbeat or the server for " + gap); } catch (e) {}
    _alarmSay();
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
  // Delegated settings requests that arrived while this client could not author (J79) — see
  // `_handleRequest`. Per room: cleared on `stop()`.
  let _heldRequests = [];
  const MAX_HELD_REQUESTS = 50;
  // Fifteen seconds — the same as the shortest legal `botPingMs`, so a minimum window is sampled once; slow
  // enough to cost nothing — the pass is a walk of the rotation, which is bounded by how many
  // people can hold a deck.
  // ── HOW OFTEN THE BOT LOOKS, WHICH IS ALSO HOW LATE IT CAN BE ────────────────────────────
  // REPORTED FROM A ROOM: actions landing thirty seconds to two minutes after they were due. That
  // is not a fault, it is this number twice. Every sweep decision rounds UP to the next tick, and
  // the AFK path has TWO stages — warn, wait out the grace, remove — each of which rounds up
  // independently. At a sixty-second period that is up to two minutes past nominal, which is
  // exactly the range reported.
  //
  // FIFTEEN SECONDS makes the same worst case thirty. The thresholds themselves are unaffected:
  // they are elapsed-time comparisons against server stamps, so a finer period does not shorten
  // anybody's grace, it only stops the answer waiting to be spoken.
  //
  // THE COST IS PER TICK AND IT WAS MEASURED, not guessed. The expensive read is
  // `Room.recentlyActive`, which folds the whole log: 1.74ms against a 4,000-event log. Four times
  // a minute is under a hundredth of a second per minute. A tick that finds nothing to do makes no
  // homeserver calls at all.
  //
  // AND THE INTERVAL ALONE DOES NOT HELP A BACKGROUNDED TAB: Chrome wakes a hidden tab's chained timers once a minute, and
  // Energy Saver may freeze them. So since J68 (the owner's decision 2, `ddjp_634`) a pass that is DUE also runs on every
  // arriving message and every server answer (`_tickIfDue`): due work runs on arrival, and the server answers at least every
  // 30 s. No second timer — PART C of `check-bot-runtime` holds this module to the one — so a hidden bot sweeps at most one
  // answer late.
  const SWEEP_EVERY_MS = 15000;
  let _lastTickAt = 0;   // local time the last pass began
  function _tickIfDue() {
    if (!_running) return;
    const now = Date.now();
    if (now - _lastTickAt < SWEEP_EVERY_MS) return;
    _lastTickAt = now;
    // After the event that brought it has been handed round, not inside that hand-out: a pass may send, and may reload.
    Promise.resolve().then(() => { if (_running) { try { tick(); } catch (e) {} } });
  }
  function _onServerAnswer() { _tickIfDue(); }

  // ── START — the level is READ, never passed in ────────────────────────────────────────────
  // Deliberately takes no level argument. A caller that could supply one could supply 99, and the
  // gate would be checking the caller's claim rather than the room's state — which is the one thing
  // this project never does. The room id and channels come from the caller; the AUTHORITY does not.
  let _authorReadyWired = false;
  function _onAuthorReady() {
    if (!_running) return;
    try { sweepRepeat(); } catch (e) {}
    try { _drainHeldRequests(); } catch (e) {}
  }
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
    // ── AND CHAT, WHICH THE SPINE CANNOT CARRY: THE ONE RECORD (J84-2; the owner's ruling 30a) ────────────────────────
    // Until J84-2 the bot kept its own copy of who spoke and when (`_chatSeen`, fed by `Chat.onMessage`, with its own
    // read-back and its own "watching since"), beside the People tab's. Now both of its verdicts read the People tab's
    // record through `Room.presenceView` — one record, one read-back window (ruling 30b), one rule for "can it answer" —
    // and it is touched here, at the start, so the record watches from the moment the bot does and its read-back begins
    // at once. The record belongs to the room and is dropped by the leave; a rank change in the same room keeps it, as it
    // kept `_chatSeen`, because it is true of this room.
    try {
      let t0 = 0;
      try { t0 = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0; } catch (e) { t0 = 0; }
      if (t0 && typeof Room !== "undefined" && Room.presenceView) _noteView(Room.presenceView(t0));
    } catch (e) {}

    try { MatrixBridge.onRawEvent(handler); }
    catch (e) { return { ok: false, reason: "no-transport", detail: e && e.message }; }
    // EVERY SERVER ANSWER RUNS A DUE PASS TOO (J68), so a quiet room still sweeps on time with the interval held back.
    try { if (typeof MatrixBridge.onServerAnswer === "function") MatrixBridge.onServerAnswer(_onServerAnswer); } catch (e) {}
    // AND THE SLEEP THE WAKE-UP ALARM RINGS FOR (J68), heard once per page and held only while this tab is the bot.
    try {
      if (!_sleptWired && typeof MatrixBridge.onSlept === "function") { MatrixBridge.onSlept(_onSlept); _sleptWired = true; }
    } catch (e) {}

    // ── AND THE MOMENT THIS CLIENT IS ALLOWED TO ACT AT ALL ───────────────────────────────────
    // The gap the event hook and the tick between them leave open: the bot is started during
    // wiring, BEFORE replay, so `mayAuthor()` is false for every event of the replay — including
    // the advance that put the song on air. If the room then goes quiet, nothing folds and the
    // first chance to act is the next tick, up to `SWEEP_EVERY_MS` later. That is precisely the case of
    // joining a room where a repeat is ALREADY playing.
    //
    // `onAuthorReady` is the interface's own "work parked because you were not caught up is
    // released now" hook, and it is the shape `BEHAVIOUR.md` §The four announcers describes for
    // exactly this. `UserQueue` already uses it for the same reason. It fires on the transition to
    // LIVE, so it cannot fire while the bot still must not author.
    //
    // NOT A THIRD CADENCE: it is an edge, not a clock, and it hands the same sweep the same
    // question. `_repeatActedPi` stops it doubling with the event hook when both arrive together.
    // ONCE PER PAGE (J83): a fresh listener per start piled up one per room entry and rank change, each sweeping whatever room
    // was running when the client next went live. One stable listener, which acts only while the runtime runs.
    try {
      if (!_authorReadyWired && typeof MatrixBridge.onAuthorReady === "function") {
        MatrixBridge.onAuthorReady(_onAuthorReady);
        _authorReadyWired = true;
      }
    } catch (e) { /* no phase machine: the event hook and the tick still cover it */ }

    _running = { mode: o.mode || DEFAULT_MODE, roomId: roomId, level: level,
                 channels: o.channels || null, authorSettings: o.authorSettings || null,
                 handler: handler, seen: 0, acted: 0, refused: 0, noType: 0, notHandled: 0 };
    _lastTickAt = Date.now();   // the first pass is due one cadence after the start, by the interval or by what arrives (J68)
    _alarmSay();                // the page's alarm: this tab is the bot now
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
      _sweepTimer = setInterval(tick, SWEEP_EVERY_MS);
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
    // ON ROOM ENTRY THE ROOM IS NOT REPLAYED YET (J115). The bot starts before the channels are, so it
    // hears the room's live requests from the moment the room is entered — and a seed here read an empty
    // log, after which the first live event stamped the whole rotation as arriving then. The room says so
    // (`replayPending`) and calls `reseed` once the replay is done; a restart on a rank change seeds here.
    if (o.replayPending === true) {
      Logger.info("BotRuntime: join times are read once the room is replayed");
    } else {
      _seedAndSay();
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
  const REPEAT_DECIDE_MS = 10000;
  let _repeatFirst = null;   // { pi, decidable } — the first look at the current playing
  // WAS THIS COPY ADDED BEFORE THE CURRENT COOLDOWN TOOK EFFECT? By room position: the copy's add (the latest add of this
  // video by this DJ before the play — the held log first, then song history's record) against the settings change that
  // set the current `repeatCooldownMs` (the start of the final run of settings carrying it). A trimmed log only bounds
  // the change from above, so an add below that bound cannot be told. `tests/check-repeat-rule.js` drives every case.
  function _addedBeforeChange(np) {
    // Both positions come through the interface: the copy's add from song history (via the bridge), and since when the
    // current cooldown has held (via StreamManager, from the backend's settings record). This only compares them.
    let playL = null;
    try { const play = (StreamManager.getLog() || []).find((e) => e && e.eventId === np.pi); playL = play ? play.l : null; } catch (e) { playL = null; }
    let addL = null;
    try { addL = (typeof MatrixBridge.historyAddedAtL === "function") ? MatrixBridge.historyAddedAtL(np.dj, np.song.videoId, playL === null ? undefined : playL) : null; } catch (e) { addL = null; }
    let since = null;
    try { since = (typeof StreamManager.settingSince === "function") ? StreamManager.settingSince("repeatCooldownMs") : null; } catch (e) { since = null; }
    if (typeof addL !== "number") return { before: null, addL: null, since: since, why: "add-unknown" };
    if (!since || typeof since.l !== "number") return { before: null, addL: addL, since: since, why: "since-unknown" };
    if (since.exact) return { before: addL < since.l, addL: addL, since: since, why: "by-position" };
    if (addL >= since.l) return { before: false, addL: addL, since: since, why: "after-the-bound" };
    return { before: null, addL: addL, since: since, why: "change-may-be-earlier" };
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
      // `mayAuthor` ANSWERS AN OBJECT, NEVER A BOOLEAN — `{ ok: true }` or `{ ok: false, reason }`.
      // `!!` on it is therefore ALWAYS TRUE, and a check written that way reads as a gate while
      // gating nothing. Shipped that way earlier in this package and caught only by noticing that
      // adding the check changed no guard's verdict. This is the tree's own signature: a plausible
      // value rather than a crash. `serverclock.js` reads the same call correctly — `v && v.ok`.
    try {
      if (typeof MatrixBridge.mayAuthor === "function") {
        const v = MatrixBridge.mayAuthor();
        may = !!(v && v.ok);
      }
    } catch (e) { may = false; }
    if (!may) return { ok: false, reason: "not-live", skipped: null, verdict: null };

    let v = null;
    try { v = Room.playedWithin(np.song.videoId, undefined, { dj: np.dj, beforeTs: np.startedAt }); } catch (e) { v = null; }
    if (!v) return { ok: false, reason: "no-reader", skipped: null, verdict: null };
    // ── DECIDED WHEN THE SONG STARTS, OR NOT AT ALL (J67, owner) ─────────────────────────────
    // A song already playing is never skipped because the bot's knowledge arrived late — it came
    // online mid-song, or song history was still filling in. The first look at a playing decides:
    // within REPEAT_DECIDE_MS of its start, AND with history able to answer; otherwise it plays out.
    if (!_repeatFirst || _repeatFirst.pi !== np.pi) {
      let late = false;
      try {
        const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
        late = !!(now && typeof np.startedAt === "number" && now - np.startedAt > REPEAT_DECIDE_MS);
      } catch (e) { late = false; }
      _repeatFirst = { pi: np.pi, decidable: !late && v.known === true };
    }
    if (v.blocked && !_repeatFirst.decidable) {
      return { ok: true, reason: "let-play", skipped: null, verdict: v };
    }
    // THE OWNER'S REPEAT RULE (`ddjp_536`, J73) — supersedes Q10's added-versus-earlier-play test: a copy added BEFORE the
    // current `repeatCooldownMs` took effect plays; one added after is skipped when history shows a play inside the
    // cooldown; when the order cannot be told, it plays (the rule's own "cannot tell → plays"). By ROOM POSITION only.
    if (v.blocked) {
      const o = _addedBeforeChange(np);
      if (o.before === true) return { ok: true, reason: "added-before-change", skipped: null, verdict: v, order: o };
      if (o.before === null) return { ok: true, reason: "cannot-tell-order", skipped: null, verdict: v, order: o };
    }
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
  // ONCE PER STATE, NOT ONCE PER TICK. This runs every tick and on every event, and a line per run is how a log
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
  // ── A JOIN STILL ON ITS WAY IS NOT IDLENESS (J70) ─────────────────────────────────────────────
  // The sweep judges from the folded room, and in a bot room a join folds only after the runner
  // relays it — seconds later, longer after a sleep. Bot-501, 09:50: the bot woke, passed on the
  // owner's two held joins at :35, and its sweep removed the owner at :36, four seconds before the
  // joins folded at :40. The bot sees the join the moment it ARRIVES, so a join or declare seen in
  // the last JOIN_IN_FLIGHT_MS holds the decision: that person just acted. Server stamps both sides.
  const JOIN_IN_FLIGHT_MS = 30000;
  const _joinSeenAt = Object.create(null);   // user -> server ts of their latest join/declare raw
  // ── AND THE SAME FOR THE PRESENCE CHAT ────────────────────────────────────────────────────
  // Kept SEPARATE rather than shared, because the two windows are separate settings and can fire
  // apart. One map would let a queue warning silently start a presence countdown that was never
  // announced — the clocks are independent even when one message covers both.
  let _presRefusedSaid = null;   // the last presence-refusal reason logged (said once until it changes)
  let _sweepRefusedSaid = null;  // the same for the idle sweep (J68; the owner's decision 4, `ddjp_634`)
  let _presPending = Object.create(null);  // userId -> ts we warned them about the PRESENCE CHAT
  // ── WHOSE WARNING A PRESENCE MARK IS, AND WHEN SOMEBODY WAS LAST THANKED (ddjp_495) ───────
  // A presence mark is either the presence half's OWN warning or a queue warning it ADOPTED
  // (see ONE PERSON, ONE MESSAGE below). A thank-you answers the warning that was actually sent,
  // so only the half that sent it thanks for it, and nobody is thanked twice for one return. The
  // old rule asked whether the queue still held a mark — but the tick runs the queue FIRST, and
  // the queue clears its mark as it thanks, so the presence half always found none and thanked a
  // second time. Driven: `check-idle-sweep` PART W10.
  let _presAdopted = Object.create(null);  // userId -> true when that presence mark is the queue's
  let _thankedAt = Object.create(null);    // userId -> ts they were last thanked, by either half

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

  // ── NEITHER SWEEP MAY ACT ON A PICTURE IT CANNOT TRUST ───────────────────────────────────
  // Both of these author: a chat warning, a queue removal, a channel drop. `sweepRepeat` asks
  // whether it may before it acts; these two never did, and nothing below them does either —
  // `sendEvent` has no such check. So a client still CATCHING UP after a reconnect, or SUSPENDED
  // and just woken, could warn and remove people from a stale reading. That is the rule `Session`
  // exists to hold: only a LIVE client authors anything.
  //
  // AND AN UNLEARNED CLOCK IS THE SAME REFUSAL. Both sweeps compare server stamps against
  // `serverNow()`, and until `ServerClock` has taken a sample that answer is the raw device clock —
  // which is exactly the case right after a refresh in a quiet room. A machine two minutes out
  // would then warn and remove on times two minutes out, with nothing saying so.
  //
  // IT IS A REFUSAL, NOT AN ESTIMATE, which is the same shape as `playedWithin`'s `known: false`
  // and `idleFor`'s. A sweep that declines costs a pass; a sweep that guesses costs somebody their
  // place in the rotation.
  function _mayJudge() {
    let live = true;
    // Same object-not-boolean trap as `sweepRepeat` — see the note there.
    try {
      if (typeof MatrixBridge.mayAuthor === "function") {
        const v = MatrixBridge.mayAuthor();
        live = !!(v && v.ok);
      }
    } catch (e) { live = false; }
    if (!live) return "not-live";
    let learned = true;
    try {
      if (typeof ServerClock !== "undefined" && typeof ServerClock.hasOffset === "function") {
        learned = !!ServerClock.hasOffset();
      }
    } catch (e) { learned = false; }
    if (!learned) return "no-clock";
    return null;
  }

  // ── THE DAILY RELOAD (J73 job 8, owner) ──────────────────────────────────────────────────────
  // The Matrix library keeps every event it is given (~1.5–1.6 MB per 1,000; a busy bot tab ~145–176 MB a
  // week, unbounded — measured at J73), and the library is left alone. So the bot tab reloads itself,
  // AT MOST ONCE A DAY, and only at a QUIET MOMENT: no song changing, nothing committed but unsent, no AFK
  // warning outstanding. A reload is cheap now (the bot room opens from its newest save point; song history
  // comes from the device and fills only the gap). ITS COST, as corrected at the `ddjp_524` audit: requests
  // sent during the reload are NOT replayed when the bot returns — `bot-backend.md` §13: retries cover the
  // gap. The runner hears intents only through the live feed, so an act with a retry gets through and one
  // without is lost, and with J69 open the user is not told. `tests/check-bot-reload.js` holds each condition.
  const RELOAD_AFTER_MS = 24 * 60 * 60 * 1000;
  const QUIET = Object.freeze({ settledMs: 30000, beforeChangeMs: 60000 });
  let _pageStartedAt = null, _reloading = false;
  let _reloadPage = () => { try { if (typeof location !== "undefined" && location.reload) location.reload(); } catch (e) {} };
  function quietMoment(now) {
    if (typeof now !== "number" || !now) return { quiet: false, reason: "no-clock" };
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { st = null; }
    if (!st) return { quiet: false, reason: "no-state" };
    const np = st.nowPlaying;
    if (np) {
      const adv = st.advance || {};
      if (typeof np.startedAt !== "number" || now - np.startedAt < QUIET.settledMs) return { quiet: false, reason: "song-just-changed" };
      if (typeof adv.earliestAt !== "number" || now >= adv.earliestAt - QUIET.beforeChangeMs) return { quiet: false, reason: "song-about-to-change" };
    }
    let unsent = 0;
    try { unsent = (typeof StreamManager.unsentCount === "function") ? StreamManager.unsentCount() : 0; } catch (e) { unsent = 1; }
    if (unsent > 0) return { quiet: false, reason: "unsent-acts" };
    if (Object.keys(_pending).length > 0) return { quiet: false, reason: "queue-warning-outstanding" };
    if (Object.keys(_presPending).length > 0) return { quiet: false, reason: "presence-warning-outstanding" };
    return { quiet: true, reason: null };
  }
  function maybeDailyReload(now) {
    if (_reloading) return { reloaded: false, reason: "already-reloading" };
    if (typeof now !== "number" || !now) return { reloaded: false, reason: "no-clock" };
    if (_pageStartedAt === null) { _pageStartedAt = now; return { reloaded: false, reason: "not-a-day" }; }
    if (now - _pageStartedAt < RELOAD_AFTER_MS) return { reloaded: false, reason: "not-a-day" };
    const q = quietMoment(now);
    if (!q.quiet) return { reloaded: false, reason: q.reason };
    _reloading = true;
    try { Logger.info("BotRuntime: a quiet moment after a day up — reloading the tab to let the library start fresh"); } catch (e) {}
    // LEAVE, RELOAD, REOPEN (J83, the owner's E5). The room is left first — the bot's promised acts sent to their room, its
    // history saved, every timer stopped — and the tab keeps its memory of the room, so the reload opens it again (E1).
    // Before J83 this saved history and reloaded into the lobby, where nothing reopened the bot room.
    // Song history is stored first, whole (`persistHistoryNow`), as before J83 — the leave then flushes only a save still
    // pending — and the leave runs while the room's engine is bound.
    try { if (typeof MatrixBridge !== "undefined" && MatrixBridge.persistHistoryNow) MatrixBridge.persistHistoryNow(); } catch (e) {}
    try { if (typeof Room !== "undefined" && Room.leave) Room.leave("the daily reload", { reloading: true }); } catch (e) {}
    _reloadPage();
    return { reloaded: true, reason: null };
  }
  function _setReloadForTest(fn) { _reloadPage = fn; _reloading = false; _pageStartedAt = null; }

  // ── ONE PASS OF THE BOT'S WATCH, WITH A NAME (ddjp_495) ────────────────────────────────────
  // This was an anonymous callback handed to the timer, so the ORDER of the two passes and the
  // announcement that follows them could be driven by nothing — and a return thanked twice lived
  // exactly in that order. Named and exported for the reason `sweepRepeat` is: production
  // reaches it only through the timer. Answers a promise that settles once the pass has REPORTED,
  // so a caller can read what was said.
  function tick() {
    _lastTickAt = Date.now();   // J68: a pass the interval runs is one a message or an answer need not run again
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
    let _rl = null;
    try { _rl = maybeDailyReload((typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0); } catch (e) {}
    if (_rl && _rl.reloaded) return Promise.resolve(null);   // the room was left for the reload: nothing more of this tick runs
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
    return Promise.all([
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
  }

  // One pass. Returns a REPORT rather than acting silently, so a caller — and a guard — can see
  // what it decided and why. TOTAL: every path returns, none throws, because this runs on a timer
  // and a throw would end the sweep for the life of the page.
  function sweepIdle() {
    const env = _sweepEnv();
    if (!env) return { ok: false, reason: "no-state", warned: [], removed: [], skipped: [], settled: Promise.resolve([]) };
    const blocked = _mayJudge();
    if (blocked) return { ok: false, reason: blocked, warned: [], removed: [], skipped: [], settled: Promise.resolve([]) };
    const { st, now } = env;
    const pingMs = st.settings.botPingMs;
    if (typeof pingMs !== "number" || !isFinite(pingMs)) {
      return { ok: false, reason: "no-ping-window", warned: [], removed: [], skipped: [], settled: Promise.resolve([]) };
    }
    // ── THE QUEUE'S SWITCHES (ddjp_495), read fresh every pass like every dial here ──────────
    // REMOVAL is on only when the room says so (`=== true`): an unreadable switch removes nobody.
    // A MESSAGE is off only when the room says so (`=== false`): an unreadable one goes on saying
    // what it always said. Both are the gentler reading of a value the reducer always supplies.
    const sw = st.settings;
    if (sw.botQueueRemove !== true) {
      // Nobody is removed, so no warning has an outcome coming. Standing marks are dropped in
      // silence: "you're back" would be false — they have not come back — and a warning with no
      // removal behind it is simply over.
      for (const u in _pending) delete _pending[u];
      return { ok: true, reason: null, off: true, warned: [], removed: [], skipped: [],
               looked: st.rotation.length, pending: 0, settled: Promise.resolve([]) };
    }
    const warnOn = sw.botQueueWarn !== false, thanksOn = sw.botQueueThanks !== false;
    // `settling` holds the sends this pass started. The report is returned synchronously and
    // corrected as each one answers; the tick waits on `settled` before saying anything.
    const warned = [], removed = [], skipped = [], settling = [];
    let view;   // the one "who is active" view (`Room.presenceView`), read once per pass when chat counts for the queue
    for (const entry of st.rotation) {
      const who = entry && entry.user;
      if (typeof who !== "string" || !who) continue;
      // NEVER ITSELF. The bot never warns or removes its own account from the queue: it is the
      // one doing the sweeping (J87 makes it a normal user in REP and the view, not in its own moderation).
      if (who === _myId()) continue;
      const justJoined = _joinSeenAt[who];
      if (typeof justJoined === "number" && Math.abs(now - justJoined) < JOIN_IN_FLIGHT_MS) {
        delete _pending[who];        // they just acted: any warning is answered
        continue;
      }
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
        if (view === undefined) { try { view = _noteView(Room.presenceView(now)); } catch (e) { view = null; } }   // once per pass (J84-2)
        if (_chatActiveWithin(view, who, now, w)) { delete _pending[who]; continue; }
        if (!_chatCanAnswer(view, now, w)) { skipped.push(who); delete _pending[who]; continue; }
      }

      if (!idle.overdue) {
        // ── THEY CAME BACK, AND IF THEY WERE WARNED THEY GET TOLD ─────────────────────────────
        // A warning is a public message naming somebody in the room's main chat. Cancelling it in
        // silence leaves that message as the last word about them, so anybody reading later sees
        // an accusation and no outcome. **Only when a warning was actually sent** — somebody who
        // was never warned has nothing to be cleared of, and greeting them would be the bot
        // talking about people who did nothing.
        if (typeof _pending[who] === "number" && thanksOn) { _unwarn(who, "queue", now); }
        delete _pending[who];
        continue;
      }

      const warnedAt = _pending[who];
      // ── WARNING OFF: REMOVED AT THE IDLE TIME ITSELF, WITH NOTHING POSTED FIRST ──────────────
      // The owner's ruling (ddjp_399, widened ddjp_495). No mark is set, because no message
      // started a clock: a refused removal is simply retried by the next pass on the same
      // evidence, and there is no warning to re-post.
      if (!warnOn) {
        removed.push(who);
        settling.push(_remove(who).then((okd) => {
          if (okd) { delete _pending[who]; return; }
          const k = removed.indexOf(who); if (k >= 0) removed.splice(k, 1);
        }));
        continue;
      }
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


  function reconcilePresence() {
    const blockedP = _mayJudge();
    if (blockedP) {
      return { ok: false, reason: blockedP, added: [], removed: [], warned: [], refused: [],
               inChannelCount: 0, pending: 0, awaiting: 0, settled: Promise.resolve([]),
               active: 0, inChannel: 0, chatBlind: false };
    }
    if (!_running) return { ok: false, reason: "not-running", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    const ch = _running.channels && _running.channels.presence_chat;
    if (!ch) return { ok: false, reason: "no-presence-channel", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    if (typeof Room === "undefined" || typeof Room.presenceView !== "function") {
      return { ok: false, reason: "no-reader", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };
    }
    let now = 0;
    try { now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0; }
    catch (e) { now = 0; }
    if (!now) return { ok: false, reason: "no-clock", added: [], removed: [], warned: [], refused: [],
               settled: Promise.resolve([]) };

    // WHO THE ROOM SAYS IS AROUND — THE ONE FUNCTION (J84-2; ruling 30a): the spine fold and the chat record together, as
    // every device's People tab reads them. Chat people are already in it when the room counts chat.
    let fold = null;
    try { fold = _noteView(Room.presenceView(now)); } catch (e) { fold = null; }
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
    // be, to manage it. Since J87 it is a normal user in REP and in the room's view, so it may well
    // read as active or idle there; either way a bare comparison could have it remove itself and then
    // be unable to let anyone back in. This is moderation of its own seat, not who is active.
    const me = _myId();
    const want = Object.create(null);
    for (const p of fold.people) { if (p && p.userId && p.userId !== me) want[p.userId] = true; }

    // ── CHAT WIDENS `want`, IT NEVER NARROWS IT ─────────────────────────────────────────────
    // The view already holds the people the chat record saw inside `botAfkMs` (additive only: chat can keep somebody in
    // the channel, never take them out of it). What is left to decide here is BLINDNESS: the room counts chat and the
    // record has not watched every tier for a full window, so it cannot rule chat out — and removing on an answer it
    // cannot give is the failure this guards. The rule is the queue sweep's (`_chatCanAnswer`), over this presence's window.
    let chatBlind = false;
    try {
      const s2 = StreamManager.getState().settings;
      if (s2 && s2.botPresenceChat === true && !_chatCanAnswer(fold, now, s2.botAfkMs)) chatBlind = true;
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
    // The grace and the switches, read the way this function reads every other setting — through
    // its own `StreamManager.getState()` call rather than a variable borrowed from another scope.
    // The grace is the presence chat's OWN (`botPresencePingMs`, ddjp_495); `botPingMs` is the
    // queue's. The switches read as the queue's do: removal only on `=== true`, a message off
    // only on `=== false`, and an unreadable blob removes nobody.
    let pingMs = null, removeOn = false, warnOn = true, thanksOn = true;
    try {
      const sw = StreamManager.getState().settings;
      const g = sw.botPresencePingMs;
      if (typeof g === "number" && isFinite(g)) pingMs = g;
      removeOn = sw.botPresenceRemove === true;
      warnOn = sw.botPresenceWarn !== false;
      thanksOn = sw.botPresenceThanks !== false;
    } catch (e) { pingMs = null; removeOn = false; }

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
    // ── AND WHO IS STILL IN THE ROOM AT ALL (owner ruling, ddjp_496) ──────────────────────────
    // `want` comes from the room's HISTORY, so somebody staff just removed still reads as around
    // until their last act ages past the away time — and was invited straight back into the
    // presence chat on the next pass. The owner chose this over a bot-kept list: invite only
    // people the room's member list still holds. The list is JOINED members only, so an
    // invited-but-not-joined person is not a member; a ban is covered by the same rule.
    // Unreadable is NOT everyone: `inRoom` stays null and nobody is invited this pass, the same
    // direction as the owner rule's null above. Read once, from the same list.
    let inRoom = null;
    try {
      const roster = MatrixBridge.getRoster ? MatrixBridge.getRoster(_running.roomId) : null;
      if (Array.isArray(roster)) {
        inRoom = Object.create(null);
        for (const r of roster) { if (r && r.userId) inRoom[r.userId] = true; }
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
    const notInRoom = [];
    for (const u in want) {
      if (offered[u]) continue;
      if (!inRoom || !inRoom[u]) { notInRoom.push(u); continue; }   // removed from the room, or cannot tell
      added.push(u); _addPresence(ch, u);
    }
    for (const u in have) {
      if (want[u]) {
        // ── THEY CAME BACK, AND THEY GET TOLD ─────────────────────────────────────────────
        // This cleared the mark SILENTLY, which is the asymmetry the audit found: the queue half
        // sends a public "you're back" for the reason its own comment gives — a warning is a
        // public message naming somebody, and cancelling it in silence leaves that message as the
        // last word about them. Being warned about the presence chat is no less public.
        //
        // ONE MESSAGE STILL, and it is the half that WARNED who thanks. An ADOPTED mark is the
        // queue's warning, and the queue thanks for it — earlier in this same tick, which is why
        // asking whether the queue still held a mark always answered no and thanked twice. And a
        // person already thanked since this mark was set has been told once; that is enough.
        const at0 = _presPending[u];
        if (typeof at0 === "number" && !_presAdopted[u] && thanksOn
            && !(typeof _thankedAt[u] === "number" && _thankedAt[u] >= at0)) _unwarn(u, "presence", now);
        delete _presPending[u]; delete _presAdopted[u];
        continue;
      }
      // Cannot see far enough back in chat to say they have been quiet: keep them.
      if (chatBlind) continue;
      // Nor far enough back in the ROOM: the held log is shorter than the window — a room opened
      // from the bot's save point, before its background read covers the window (J67). The owner's
      // rule: no warning and no removal until it is confirmed. Adding the active is still fine.
      if (fold.bounded === true) continue;
      // Unreadable roster, or a level above the bot's: leave them where they are.
      if (ownerIds === null || ownerIds[u]) continue;
      // REMOVAL OFF (ddjp_495): nobody leaves the presence chat for being away. People still reads
      // `botAfkMs`, so the room goes on saying who is away; only the bot's action stops. Marks drop
      // in silence, for the reason the queue half gives.
      if (!removeOn) { delete _presPending[u]; delete _presAdopted[u]; continue; }

      // ── WARN, WAIT, THEN REMOVE — THE THREE STATES THE QUEUE ALREADY HAD ──────────────────
      // This half used to remove the instant somebody fell out of `want`: no warning, no grace,
      // no chance to react. The queue gave ten minutes and a public message; the presence chat
      // took you out mid-sentence. AFK is one idea, so it gets one shape.
      //
      if (warnOn) {
        // THE GRACE IS THE PRESENCE CHAT'S OWN since ddjp_495. It was `botPingMs`, reused rather than
        // a key added — and the owner's design split it, in the package that added the switches, so
        // the key cost was paid once. Nothing below ever assumed the two windows were equal.
        //
        // WARNING OFF skips all three states: removed on the pass that finds them away, nothing
        // posted, no mark — so a refused kick is retried by the next pass without any message.
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
          if (typeof q === "number" && (now - q) < pingMs) { _presPending[u] = q; _presAdopted[u] = true; continue; }
          // Otherwise this is the only thing happening to them, so it gets its own message.
          // MARKED SYNCHRONOUSLY AND CLEARED ON NON-DELIVERY — the same shape the queue half uses,
          // rather than marking inside the send. Two reasons: the report is returned synchronously
          // and callers render from it, and a mark set only on the async path means the very next
          // pass reads the person as never warned and warns them again.
          _presPending[u] = now; delete _presAdopted[u];
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
      }
      // OPTIMISTIC IN THE REPORT, CORRECTED BY THE OUTCOME. The report is returned synchronously
      // (callers render from it), so the name goes in now and comes back OUT if the kick was
      // refused — before the tick announces, which is what `settled` is for.
      removed.push(u);
      pending.push(_dropPresence(ch, u).then((res) => {
        // THE MARK SURVIVES A REFUSED KICK, for the reason the queue half records: cleared here,
        // a failure would make the next pass read them as never warned and start the whole cycle
        // again — a fresh public warning and a fresh grace, once per grace, forever.
        if (res && res.ok) { delete _presPending[u]; delete _presAdopted[u]; return; }
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
             chatBlind: chatBlind, off: !removeOn, notInRoom: notInRoom.sort() };
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
  // rank, and `presence-chat` because entering the space joins every child. The observation is
  // held in memory, never authored and never shared — in the room's one record since J84-2.
  //
  // TWO CLIENTS WILL DISAGREE ABOUT WHO IS AROUND, AND THAT IS ACCEPTED. A person who cannot read
  // the staff tier cannot see somebody being active in it. The people panel already declares that
  // limit; the bot simply has a better view than most, and the DECISION is the bot's to make.
  // ── WHAT THE ROOM'S RECORD HAS HEARD, AND WHETHER IT CAN ANSWER (J84-2; the owner's ruling 30a) ──────────────────────
  // The bot's own copy of this record — `_chatSeen`, `_chatSince`, `_noteChat`, `_readChatBack`, `_pruneChat` — retired at
  // J84-2: both verdicts read `Room.presenceView`'s record (`chatLast`, `chatKnownFrom`), the People tab's, over each
  // presence's own window. The rules it held hold there now: a tier is known from the moment it is watched, a read-back
  // reaching further makes it known further, and an observation shorter than the window cannot rule chat out — the same
  // rule the Spine answer uses for a short log reach. A missing view answers neither question: chat is unanswerable.
  let _chatTiersSeen = 0;   // how many chat tiers the last view the bot read watched — for the capability report (`_capabilities`) alone
  function _noteView(v) { try { _chatTiersSeen = (v && typeof v.chatTierCount === "number") ? v.chatTierCount : 0; } catch (e) {} return v; }
  function _chatCanAnswer(view, now, windowMs) {
    if (!view || typeof view.chatKnownFrom !== "number" || typeof windowMs !== "number" || !(windowMs > 0)) return false;
    return view.chatKnownFrom <= now - windowMs;
  }

  // Inclusive at the window's edge, as the People tab's merge and the spine fold are: one boundary for one rule.
  function _chatActiveWithin(view, who, now, windowMs) {
    const last = view && view.chatLast ? view.chatLast[who] : undefined;
    return typeof last === "number" && last >= now - windowMs && last <= now;
  }

  function _myId() {
    try { return MatrixBridge.getUserId(); } catch (e) { return null; }
  }

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

  // ── THE TWO REPORTERS ──────────────────────────────────────────────────────────────────────
  // Split out of the tick because they are the same job twice and were drifting apart inside it.
  // Both are called ONLY after the pass has settled, so every name they print is something that
  // happened rather than something that was tried.
  function _reportSweep(r) {
    if (!r) return;
    // SAID ONCE PER REASON, AND AGAIN WHEN THE SWEEP RUNS (J68; the owner's decision 4, `ddjp_634`): a hidden bot said
    // `refused — not-live` about every 15 s (filed at J98). A new reason is said; the return to running is said once, naming
    // the refusal it ended; and a refusal after that is said again.
    if (r.ok === false) {
      if (r.reason !== _sweepRefusedSaid) { Logger.warn("BotRuntime: idle sweep refused — " + r.reason); _sweepRefusedSaid = r.reason; }
      return;
    }
    if (_sweepRefusedSaid) {
      Logger.info("BotRuntime: idle sweep is running again (it was refused — " + _sweepRefusedSaid + ")");
      _sweepRefusedSaid = null;
    }
    // OFF IS NOT QUIET. A room that removes nobody is not a room where nobody was overdue.
    if (r.off) { Logger.debug("BotRuntime: idle sweep — off: this room does not remove idle DJs"); return; }
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
    // SAID ONCE, AND AGAIN ONLY IF IT CHANGES (owner's test, `ddjp_539`): it was repeated every 15 s.
    if (r.ok === false) { if (r.reason !== _presRefusedSaid) { Logger.warn("BotRuntime: presence reconcile refused — " + r.reason); _presRefusedSaid = r.reason; } return; }
    _presRefusedSaid = null;
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
    Logger.debug("BotRuntime: presence — ran" + (r.off ? " (removal is off in this room)" : "") + ", "
      + (r.inChannelCount || 0) + " in the channel, "
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

  // A WARNING THAT DID NOT LAND MUST NOT START THE CLOCK IT WOULD OTHERWISE START. `sweepIdle`
  // marks the pending warning synchronously, before this runs — so without the clears below an
  // undelivered warning matures into a removal `botPingMs` later and the person is removed having
  // never been told. That is the exact case the two stages exist to prevent, arriving through the
  // one path the stages do not check.
  //
  // IT IS AN ORDINARY STATE, NOT AN EDGE. `Chat.sendTo` refuses five ways (`no-room`, `empty`,
  // `too-long`, `no-crypto`, `send-failed`) and every chat tier is E2E encrypted, so it
  // pre-empts with `no-crypto` whenever crypto is not up. `matrixaccount.js` retries that in place
  // (Tier 1) before the UI escalates to a banner and a reload, and NOBODY IS WATCHING A BOT'S
  // BANNER.
  //
  // ON A REFUSAL THE PENDING MARK IS CLEARED, so the next sweep warns again instead of removing:
  // a bot that cannot reach chat warns forever and removes nobody. Never act on somebody you
  // could not tell.
  //
  // `r && r.ok === false` is `ui/shell.js`'s own reading of this return, not a second one: a
  // result that says it failed is a failure, and a caller that answers nothing is not claiming
  // one. A throw is the same answer as an explicit refusal.
  // `graceMs` IS PASSED, NOT RE-READ. `sweepIdle` already resolved and validated `botPingMs` before
  // it decided to warn at all — reading the settings again here would be a second copy free to
  // disagree with the one the removal is actually timed against.
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
  function _unwarn(who, kind, now) {
    if (typeof Chat === "undefined" || typeof Chat.sendTo !== "function") return;
    let mainId = null;
    try {
      const t = (typeof Room !== "undefined" && Room.chatTiers) ? Room.chatTiers() : null;
      mainId = t ? t.mainId : null;
    } catch (e) { mainId = null; }
    if (!mainId) return;
    // STAMPED AT THE SEND, so the presence half — which runs after the queue in the same tick —
    // can see this return has been answered. An attempt, not a delivery: a thank-you that fails
    // costs the room nothing, and one that went out twice was the defect.
    if (typeof now === "number") _thankedAt[who] = now;
    try {
      Promise.resolve(Chat.sendTo(mainId,
        // "Place kept" is a claim about the QUEUE, so only the queue's thank-you makes it: a person
        // back after a presence-only warning may hold no place at all (found planning ddjp_495).
        who + (kind === "presence" ? " — thanks, you're back." : " — thanks, you're back. Place kept.")
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
    // EACH NOTICE BEHIND ITS OWN SWITCH (ddjp_495). A removal the room chose not to announce
    // still happened; it is left out of the line, so a person removed from both with one notice
    // off is named for the other alone. Off only on `=== false`, like every message here.
    let qSay = true, pSay = true;
    try {
      const sw = StreamManager.getState().settings;
      qSay = sw.botQueueAnnounce !== false; pSay = sw.botPresenceAnnounce !== false;
    } catch (e) { /* unreadable: say what was always said */ }
    const q = (qSay && Array.isArray(queueRemoved)) ? queueRemoved : [];
    const pr = (pSay && Array.isArray(presenceRemoved)) ? presenceRemoved : [];
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
  // resolves the sent event's `{ eventId, l }` when it went out; a throw is a send that failed, and
  // undefined means nothing was sent at all (no events channel), so it is not a removal either (J115:
  // it was read as one, and the mark was dropped for a removal that never went out). TRUE means the
  // event was sent, which is the most this layer can know — the fold decides legality, and if it
  // refuses the event the person stays in the rotation and the next sweep removes them again
  // WITHOUT re-warning, because the mark is still set.
  function _remove(who) {
    if (typeof Queue === "undefined" || typeof Queue.remove !== "function") return Promise.resolve(false);
    let p = null;
    // Called inside the try, not inside `Promise.resolve(...)`: an argument is evaluated before
    // the call that wraps it, so a synchronous throw would escape. Same reasoning as `_warn`.
    try { p = Queue.remove(who); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then((r) => !!(r && typeof r === "object" && r.ok !== false), () => false);
  }

  // `why` is said only when the ROOM ends (J83: the leave passes it, and the line is the owner's live check); a stop before a
  // re-start on a rank change says nothing, as before. What was held and is dropped is counted either way.
  function stop(why) {
    if (!_running) return { ok: false, reason: "not-running" };
    const dropped = { requests: _heldRequests.length, warnings: Object.keys(_pending).length + Object.keys(_presPending).length };
    try { MatrixBridge.offRawEvent(_running.handler); } catch (e) {}
    try { if (typeof MatrixBridge.offServerAnswer === "function") MatrixBridge.offServerAnswer(_onServerAnswer); } catch (e) {}
    _sweepRefusedSaid = null;
    // THE TIMER AND THE WARNED SET BOTH DIE HERE. A surviving interval would go on sweeping a room
    // this client has left — and `_evaluateBot` stops before it starts on every room entry, so a
    // leaked timer would accumulate one per room visited. The warned set is per-room state for the
    // same reason: carrying it across would let somebody be removed in room B on the strength of a
    // warning they received in room A.
    if (_sweepTimer !== null && typeof clearInterval === "function") {
      try { clearInterval(_sweepTimer); } catch (e) {}
    }
    _sweepTimer = null;
    _heldRequests = [];   // a request held for LIVE belongs to the room it was asked in (J79)
    _pending = Object.create(null);
    _presPending = Object.create(null);
    _presAdopted = Object.create(null);
    _thankedAt = Object.create(null);
    _repeatActedPi = null;
    // ── THE CHAT RECORD IS NOT THE BOT'S TO STOP (J84-2) ───────────────────────────────────────
    // It is the room's one record (`Room.presenceView`), kept while the tab is in the room and dropped by the leave. A
    // stop on a rank change in the same room leaves it watching: the tab never stopped listening, so it stays true of
    // this room. (The bot's own copy, `_chatSince` and `_chatSeen`, restarted its watch at every stop until it retired.)
    for (const u in _entries) delete _entries[u];
    _lastRotation = null;
    _running = null;
    _alarmSlept = false; _alarmSay();   // the page's alarm: this tab is not the bot now, and holds no sleep
    if (why) {
      try {
        Logger.info("BotRuntime: stopped — " + why + (dropped.requests || dropped.warnings ? " (" + dropped.requests +
          " held settings request(s) and " + dropped.warnings + " outstanding warning(s) dropped)" : ""));
      } catch (e) {}
    }
    return { ok: true, dropped: dropped };
  }

  // A reading, not a flag. Returns a fresh object so a caller cannot hold a reference into the
  // runtime's own state and watch it change under them.
  // ── WHAT THESE COUNTERS ACTUALLY COUNT, BECAUSE THE NAMES SUGGEST OTHERWISE ──────────────
  // MISREAD IN A LIVE ROOM, by two people at once, and the misreading looked exactly like a defect:
  // `seen: 0` on a running bot was taken as "no event ever reached it", and the wiring was about to
  // be torn apart looking for the break.
  //
  //   `seen`        events THIS MODE HANDLES. Consensus mode handles ONE type, `ddjp.bot.request`,
  //                 so `seen: 0` is the ordinary state of a healthy bot nobody has asked anything.
  //                 It is NOT "events received".
  //   `noType`      events with no DDJP type — membership, chat, state. THIS is the one that shows
  //                 the handler is being fed at all.
  //   `notHandled`  DDJP events this mode does not handle. Zero of these AND a live room means no
  //                 protocol events have happened since the bot started.
  //
  // The three together read as a sentence: `noType` up and the other two at zero is a wired bot in
  // a quiet room, which is indistinguishable from a broken one if you only read `seen`.
  //
  // NOT RENAMED, deliberately: the names are in `check-bot-runtime` and in a shipped debugging
  // surface people already use, and renaming a field to fix a comment is how a shipped name and a
  // documented one drift apart. The meaning is written where the field is read instead.
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
      // NOT CREATED YET IS NOT MISSING (owner's decentralized test, `ddjp_542`): the room's upgrade reach is the highest
      // batch among the channels this bot has; a row from a later batch does not exist yet, and only an absent row at or
      // below it is a channel that exists but is not joined.
      const reach = tax.reduce((m, r) => (r && typeof r.batch === "number" && ch[r.key] && r.batch > m) ? r.batch : m, 0);
      const count = (kind) => {
        const rows = tax.filter((r) => r && r.kind === kind && typeof r.key === "string");
        const absent = rows.filter((r) => !ch[r.key]);
        const notYet = absent.filter((r) => reach > 0 && typeof r.batch === "number" && r.batch > reach);
        const missing = absent.filter((r) => notYet.indexOf(r) < 0).map((r) => r.slug || r.key);
        return { have: rows.length - absent.length, want: rows.length - notYet.length, missing: missing,
                 notYet: notYet.map((r) => r.slug || r.key), reach: reach };
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

    // THE ROOM'S RECORD WATCHES AT LEAST ONE TIER — the honest answer to "is this bot observing chat" (J84-2), as the last
    // view the bot read reported it (`_noteView`), never from whether a module exists, and without reading a new one.
    cap.chatFeed = _chatTiersSeen > 0;
    try { cap.chatTiers = (typeof Chat !== "undefined" && Chat.readableTiers)
                            ? Chat.readableTiers().length : null; }
    catch (e) { cap.chatTiers = null; }
    cap.timer = _sweepTimer !== null;
    return cap;
  }

  // The capability report as one line. Written at `start()`, beside the line that used to claim
  // everything was fine on its own.
  function _reportCapabilities(cap) {
    const bit = (c) => (c ? c.have + "/" + c.want + (c.missing.length ? " (not joined: " + c.missing.join(", ") + ")" : "") +
      ((c.notYet && c.notYet.length) ? " · not created yet: " + c.notYet.join(", ") + " (room at upgrade batch " + c.reach + ")" : "") : "unreadable");
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
  // bot" needed devtools. This writes the same facts into the log, where
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

  function _seedAndSay() {
    try {
      const known = _seedEntries();
      Logger.info("BotRuntime: replayed the queue — " + known + " member(s) with a known join time"
        + ". Anyone missing joined before the log reaches, and reads as "
        + "cannot-say rather than as idle");
      return known;
    } catch (e) {
      Logger.warn("BotRuntime: queue replay failed — " + ((e && e.message) || e)
        + "; join times are unknown, so nobody will be credited for joining");
      return null;
    }
  }
  // ONCE THE ROOM IS REPLAYED (J115): `features/room.js` calls this when the opening's replay is done, before the room
  // goes live. Every entry time is read again from the replayed queue — what a live event stamped during the replay is in
  // that queue too — and the baseline the live watch compares against becomes the rotation as it now stands.
  function reseed() {
    if (!_running) return { ok: false, reason: "not-running" };
    for (const u in _entries) delete _entries[u];
    const known = _seedAndSay();
    return { ok: known !== null, known: known };
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
  function _onRaw(raw, event, room) {
    if (!_running || !raw) return;
    _tickIfDue();   // J68: a due pass runs on whatever arrives
    // BEFORE THE TYPE GATES, and that placement is load-bearing. Consensus mode handles only
    // `ddjp.bot.request`, so every join, leave and play returns two lines below — and those are
    // exactly the events that move the rotation. Watching after the gates would see nothing.
    _watchRotation(raw);
    // ── THE REPLAY COOLDOWN REACTS TO THE EVENT, NOT TO THE NEXT TICK ─────────────────────────
    // REPORTED FROM A ROOM: a repeat played for a long time before the bot cut it. It rode the
    // sweep tick alone, so the delay was however much of a MINUTE was left — an eternity for a
    // rule whose whole point is that the song should not be playing.
    //
    // SAFE HERE BECAUSE THE FOLD HAS ALREADY RUN. `_ingestSpineEvent` calls `StreamManager.ingest`
    // BEFORE it fans out to the raw listeners, so `getState().nowPlaying` is already the new song
    // by the time this line runs. Checked rather than assumed — the reverse order would make this
    // act on the previous playing, one song late, forever.
    //
    // ABOVE THE TYPE GATES, for the same reason `_watchRotation` is: consensus mode handles only
    // `ddjp.bot.request`, so every play and skip returns two lines below. It also means no advance
    // type is NAMED here, which is deliberate — `ddjp.media.skip` has been left off six
    // subscription lists across four sessions, and a rule that reacts to "something was folded"
    // cannot be the seventh.
    //
    // CHEAP ON THE PATHS THAT DO NOTHING, which matters now that this runs on every event: the
    // acted-on check and `mayAuthor` both answer before the play-log is read, so a replay burst
    // and an ordinary vote each cost two comparisons. Measured at 0.14ms for the full read against
    // a 5000-row history, so even the path that DOES read is not worth avoiding per event.
    //
    // THE TICK REMAINS THE BACKSTOP AND IS NOT REDUNDANT: a quiet room folds nothing, so a repeat
    // left on air by the last advance would sit there with no event to react to. Fast path and
    // slow path, one sweep, and `_repeatActedPi` stops them acting twice.
    try { sweepRepeat(); } catch (e) {}
    const type = raw.ddjpType || null;   // stamped by the transport from the parsed body
    if (!type) { _running.noType++; return; }
    if ((type === "ddjp.dj.join" || type === "ddjp.dj.declare") && raw.sender && typeof raw.ts === "number") {
      if (!(raw.sender in _joinSeenAt) || raw.ts > _joinSeenAt[raw.sender]) _joinSeenAt[raw.sender] = raw.ts;
    }

    if (_running.mode && MODES[_running.mode].handles.indexOf(type) < 0) { _running.notHandled++; return; }
    _running.seen++;
    if (type === "ddjp.bot.request") { _handleRequest(raw); return; }
  }

  // THE DELEGATION POLICY IS NOT RESTATED HERE. `BotSettings.decide` owns it, and this runtime's
  // only job is to hand it the request, the requester's rank and the room's CURRENT settings —
  // read fresh, never cached, because a cached table would go on applying a delegation the owner
  // has since revoked.
  // ── A SETTINGS REQUEST WAITS FOR LIVE (J79; kept at J82) ──────────────────────────────────────
  // The bot's answer to a delegated request is a WHOLE settings blob built from what it holds
  // (`Room.setSettings` merges the change onto the room's current settings) — so a bot answering
  // before it has caught up would post its OLD settings back over a change it has not folded yet
  // (J79's case was the owner's restore, which J82 removed; an owner's settings change is the same
  // shape). A tab waking from a suspension receives its backlog as live events, possibly before
  // the change's, so the request is HELD until this client may author and judged then, against the
  // room as it stands. The re-check half of the cascade needs nothing more: `setSettings` already
  // reads the room's settings at the moment it sends.
  function _mayAnswer() {
    try {
      if (typeof MatrixBridge.mayAuthor !== "function") return true;
      const v = MatrixBridge.mayAuthor();
      return !(v && v.ok === false);
    } catch (e) { return false; }
  }
  function _drainHeldRequests() {
    if (!_running || !_heldRequests.length || !_mayAnswer()) return 0;
    const batch = _heldRequests; _heldRequests = [];
    for (const raw of batch) { try { _handleRequest(raw); } catch (e) {} }
    return batch.length;
  }
  function _handleRequest(raw) {
    if (!_mayAnswer()) {
      _heldRequests.push(raw);
      // A DROPPED REQUEST IS SAID (`ddjp_570`): beyond the cap the oldest goes, and a person who asked
      // for a setting would otherwise hear nothing at all.
      while (_heldRequests.length > MAX_HELD_REQUESTS) {
        const gone = _heldRequests.shift();
        _running.droppedHeld = (_running.droppedHeld || 0) + 1;
        Logger.warn("BotRuntime: a settings request from " + ((gone && gone.sender) || "?") + " was DROPPED unanswered — more than " +
          MAX_HELD_REQUESTS + " waited while this tab caught up (" + _running.droppedHeld + " dropped so far)");
      }
      _running.heldForLive = (_running.heldForLive || 0) + 1;
      return;
    }
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
      // ONE REQUEST CARRIES MANY SETTINGS (ddjp_446), so the line names what was WRITTEN and what
      // was DROPPED rather than one key — a batch reported by its first key would read as the
      // whole of it.
      const granted = (v && v.permitted) ? Object.keys(v.permitted) : [];
      const dropped = (v && Array.isArray(v.refused)) ? v.refused.map((r) => r.key + " (" + r.reason + ")") : [];
      if (v && v.ok) {
        _running.acted++;
        Logger.info("BotRuntime: request GRANTED — " + granted.map((k) => "`" + k + "`").join(", ") +
          " from " + who + " (level " + senderLevel + ")" + (dropped.length ? "; dropped " + dropped.join(", ") : ""));
      } else {
        _running.refused++;
        Logger.info("BotRuntime: request REFUSED — from " + who + " (level " + senderLevel + ") — " +
          ((v && v.reason) || "no verdict") + (dropped.length ? ": " + dropped.join(", ") : ""));
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

  // IS A BOT IN THIS ROOM — the settings panel shows the bot's settings only when one is, because
  // without a bot they change nothing. A bot is an account at the ladder's top rung (`botLevel`),
  // in either room type. Asked here so `ui/` compares no rank to anything.
  function botInRoom() {
    const top = botLevel();
    if (typeof top !== "number") return false;
    let roster = [];
    try { roster = Room.getRoster() || []; } catch (e) { return false; }
    return roster.some((m) => m && m.level === top);
  }

  return {
    quietMoment, maybeDailyReload, _setReloadForTest,
    MODES, DEFAULT_MODE, botLevel, botInRoom, eligible, start, reseed, stop, status, report, enteredAt, sweepIdle,
           // EXPORTED FOR THE SAME REASON ITS TWO SIBLINGS ARE: production reaches it through the
           // tick, which has no name to extract, so an unexported sweep is one no guard can ever
           // drive. The first draft left it unexported and then WROTE THAT LIMITATION INTO THE
           // GUARD as though it were inherent, which is a gap being documented instead of closed.
           sweepRepeat,
           reconcilePresence, tick, SWEEP_EVERY_MS, actingAsBot, mayOffer, BOT_MAY_NOT, viewOff,
           alarmNow, alarmSlept, alarmWoken, onAlarmChange };
})();
