// tests/check-bot-runtime.js
// WALL: THE BOT RUNTIME ADMITS THE BOT AND NOBODY ELSE, AND HOLDS NO CONFIGURATION OF ITS OWN.
//
// J17 designed the bot, J18 built delegated settings, J19 built the reputation tally, and none of
// them ran: both feature modules are pure libraries with no timer and no subscription. This is the
// caller, and it is a job on its own so that a failure has one candidate cause rather than two.
//
// ── THE GATE IS `=== 99`, AND A RANK CHECK IS THE OBVIOUS WRONG ANSWER ──────────────────────
// `Ranks.LADDER` tops out at 99, so `nameOf` SATURATES: 99, 100 and 101 all answer "owner" and
// `atLeast(level,"owner")` is true for all three. **A rank check therefore admits the human owner's
// own tab**, which is convenient for testing and puts TWO AUTHORITIES on the settings channel —
// the lost-update failure J17 measured, with settings being last-write-wins over a whole blob, so
// concurrent writers overwrite rather than merge and the loser's change vanishes silently.
//
// PART A drives the saturation itself, so the reason the exact check exists stays attached to the
// evidence for it rather than becoming a preference somebody later relaxes.
//
// ── WHAT EACH PART PINS ──────────────────────────────────────────────────────────────────────
//   PART A — the ladder saturates, and the gate is exact: 99 in, 100 and 101 out, with the
//     human-owner case carrying its own reason.
//   PART B — the level is READ FROM THE TRANSPORT, never passed in. `start` takes no level, and
//     an unreadable level refuses with a distinct reason rather than collapsing into "too low".
//   PART C — NO CONFIGURATION OF ITS OWN: no timer, no interval, no local default for anything
//     `defaultSettings()` could carry, and the delegation policy read fresh on every request.
//   PART D — it actually RUNS: subscribes, routes a request to `BotSettings`, counts verdicts,
//     and unsubscribes by identity on stop.
//   PART E — ONE MODE, and the seam is a table rather than a branch. No second mode is pre-built.
//   PART F — the two libraries are still inert, so the runtime is the only thing that acts.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[bot-runtime] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

// The runtime with a RECORDING transport. Subscriptions and levels are observable; nothing real
// is contacted.
// ── PART J — THE TIMER ACTUALLY CALLS BOTH SWEEPS ────────────────────────────────────────────
// THE DEFECT CLASS THAT COST THREE OWNER REPORTS, CHECKED HERE BEFORE IT COSTS ANY MORE.
// `ddjp.bot.request` handling was proven by every guard and worked in none, because all of them
// CALLED the handler while nothing DELIVERED to it. `sweepIdle` and `reconcilePresence` are in the
// same position: `check-idle-sweep` drives 77 assertions through `RT.sweepIdle()` by hand, and
// `check-presence-chat` drives `reconcilePresence()` the same way. Both prove the function is
// right. Neither can notice the interval body dropping the call.
//
// MEASURED BEFORE THIS PART EXISTED: deleting `sweepIdle()` from the interval left the ENTIRE
// suite green, and so did deleting `reconcilePresence()`. The AFK sweep would have gone silently
// dead under 77 passing assertions.
//
// SO THIS DRIVES THE SCHEDULER, NOT THE FUNCTIONS. The interval callback is captured at `start()`
// and invoked, and both sweeps are observed through the collaborators they must reach.
function partJ() {
  const calls = { idleFor: 0, recentlyActive: 0 };
  let tick = null, period = null;
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botsettings.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, Promise,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // CAPTURE THE SCHEDULE INSTEAD OF RUNNING IT. A real interval would make this a timing test.
    setInterval: (fn, ms) => { tick = fn; period = ms; return 1; },
    clearInterval: () => { tick = null; },
    // A ROTATION WITH SOMEBODY IN IT. `sweepIdle` walks the rotation, so an empty one reaches
    // `idleFor` never and the observation below would read zero for the wrong reason — a harness
    // proving nothing while looking like a failure.
    StreamManager: {
      getState: () => ({ settings: { queueIdleMs: 60000, botPingMs: 30000 },
                         rotation: [{ user: "@dj:hs", pending: [] }] }),
      getLog: () => [], on() {},
    },
    ServerClock: { serverNow: () => 1000 },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
    MatrixBridge: {
      getMyPowerLevel: () => 99, getUserId: () => "@bot:hs", getRoster: () => [],
      onRawEvent() {}, offRawEvent() {}, sendEvent: async () => {},
      eventsKeyForLevel: (l) => "events_L" + l,
    },
  });
  sb.Room = {
    rankLadder: () => sb.Capabilities.LADDER,
    // THE TWO OBSERVATION POINTS. `sweepIdle` cannot decide anything without `idleFor`, and
    // `reconcilePresence` refuses with `no-reader` unless `recentlyActive` is a function — so a
    // call to either is proof that sweep ran.
    idleFor: () => { calls.idleFor++; return { known: false }; },
    recentlyActive: () => { calls.recentlyActive++; return []; },
  };

  const r = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!p:hs" } });
  ok(r && r.ok, "J: APPLIED — the runtime started", r);
  ok(typeof tick === "function",
    "J: APPLIED — `start` scheduled an interval, and this captured it rather than waiting on a "
    + "real clock", typeof tick);
  ok(period === sb.BotRuntime.SWEEP_EVERY_MS,
    "J: at the runtime's own declared period, not a number written here", { period });

  ok(calls.idleFor === 0 && calls.recentlyActive === 0,
    "J: APPLIED — neither sweep has run before the first tick, so what follows is the tick's "
    + "doing", calls);

  tick();

  ok(calls.idleFor > 0,
    "J: THE TICK CALLS `sweepIdle`. Every other assertion about the AFK sweep invokes it by hand, "
    + "so dropping this call leaves 77 of them green over a sweep that never runs — which is "
    + "exactly how `ddjp.bot.request` was proven working and worked never", calls);
  ok(calls.recentlyActive > 0,
    "J: and `reconcilePresence`. Same hazard, same blind spot: the presence guard drives it "
    + "directly too", calls);

  // ── AND THE TICK READS THE REPORT INSTEAD OF DISCARDING IT ──────────────────────────────────
  // Both sweeps RETURN a report so a caller can see what they decided, and the tick used to throw
  // both away. So every refusal was silent: an owner set both windows to two minutes, saw nothing
  // for three, and had no line anywhere to tell "nobody was overdue" from "the sweep refused" from
  // "it never ran". Silence is the state this project has now shipped four times.
  {
    const src = require("fs").readFileSync(
      path.join(__dirname, "..", "features", "botruntime.js"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    // ── THESE ARE TEXTUAL AND NOW SAY SO ────────────────────────────────────────────────────
    // They were written against the exact spelling `const r = sweepIdle()`, and a rewrite that
    // kept every property intact — both reports bound, both read, both announced — turned this
    // part RED for renaming a variable. A regex proves a name is present; it cannot tell a
    // report that is READ from one that is bound and dropped. So the spelling checks are kept
    // DELIBERATELY LOOSE (the call is bound to something, whatever it is called) and the
    // property itself is driven below.
    ok(/=\s*sweepIdle\(\)/.test(code) && /=\s*reconcilePresence\(\)/.test(code),
      "J: the tick BINDS both reports rather than calling and dropping them — a returned reason "
      + "nobody reads is the same as no reason at all");
    ok(/Logger\.warn\("BotRuntime: idle sweep refused/.test(code),
      "J: a REFUSED idle sweep says why. `no-state`, `no-ping-window` and an unreadable clock all "
      + "look identical from outside — nothing happens");
    // ── AND THE TICK ANNOUNCES REMOVALS, WITH BOTH REPORTS IN HAND ─────────────────────────
    // `_announceRemovals` composes ONE line per person from both sweeps, so it can only run where
    // both reports exist — the tick. A correct composer that nothing calls is the shape this
    // project has shipped nine times.
    ok(/_announceRemovals\([a-zA-Z]+ && [a-zA-Z]+\.removed,\s*[a-zA-Z]+ && [a-zA-Z]+\.removed\)/.test(code),
      "J: the tick calls `_announceRemovals` with BOTH reports — the idle sweep's removals and "
      + "the presence reconcile's. Called from inside either sweep it could only ever see half, "
      + "and somebody losing both would get two lines in the same second");
    ok(/let idleReport = null/.test(code),
      "J: and the idle report is held in a TICK-scoped binding, not on the module — a module-level "
      + "holder would survive a `stop()` and let a dead pass's removals be announced by the next");
    ok(/Logger\.warn\("BotRuntime: presence reconcile refused/.test(code),
      "J: and a refused presence reconcile does too — `no-presence-channel` is the EXPECTED answer "
      + "in a room built before the channel moved into batch 3, and an owner watching for presence "
      + "activity must be told that rather than left to infer it");
    // ── NOTHING IS REPORTED BEFORE THE PASS SETTLES ────────────────────────────────────────
    // The property the regexes above cannot reach. A warning may not be delivered and a kick may
    // be refused, and both answer asynchronously — so a line written where the attempt is made
    // turns an intention into an outcome. That is how one refused kick printed as a removal
    // notice every minute for sixteen minutes about somebody who never left the channel.
    ok(/Promise\.all\(\[[\s\S]{0,400}settled[\s\S]{0,200}settled/.test(code),
      "J: the tick waits for BOTH passes to settle before reporting anything");
    ok(!/sweepIdle\(\)[\s\S]{0,600}Logger\.info\("BotRuntime: idle sweep —/.test(code),
      "J: and no report line sits between the call and the settle — a line there is the "
      + "intention-as-outcome bug this part exists to keep out");
  }

  try { sb.BotRuntime.stop(); } catch (e) {}
}

// ══ PART K — THE BOT SAYS WHAT IT CAN DO BEFORE IT SAYS IT IS ON ═════════════════════════════
// `start()` checked the bot's RANK and nothing else, then logged `bot mode on`. That line reads
// as "everything is fine" and was emitted by a bot that might have no presence channel, be unable
// to see chat, and be unable to read the roster. Two of those disable a whole half of the job in
// TOTAL SILENCE — an unreadable roster makes every presence drop unsafe, so removals stop
// entirely and the log looks healthy while a feature is dead.
//
// DRIVEN, NOT READ. Each row builds a room missing exactly one thing and asserts the line names
// it. A regex over the source would prove the strings are spelled and nothing about whether the
// walk reaches them.
function partK() {
  const TAX = [
    { kind: "events", slug: "uncategorized", key: "events_uncategorized", level: 0 },
    { kind: "events", slug: "owner", key: "events_owner", level: 99 },
    { kind: "chat", slug: "uncategorized", key: "chat_uncategorized", level: 0 },
    { kind: "chat", slug: "staff", key: "chat_staff", level: 60 },
    { kind: "presence", slug: "chat", key: "presence_chat", level: 0 },
  ];
  const FULL = {}; for (const r of TAX) FULL[r.key] = "!" + r.key;
  function boot(o) {
    const lines = [];
    const sb = loadInContext([
      "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "features/botsettings.js", "features/botruntime.js",
    ], {
      Date, Math, JSON, setTimeout, clearTimeout, Promise,
      setInterval: o.noTimer ? undefined : (() => 1), clearInterval: () => {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      Room: { rankLadder: () => null },
      StreamManager: { getState: () => ({ settings: {}, rotation: [] }), getLog: () => [], on() {} },
      Chat: o.noChat ? undefined : { onMessage() {}, readableTiers: () => ["a", "b"] },
      ServerClock: { serverNow: () => 1000 },
      MatrixBridge: {
        onRawEvent() {}, offRawEvent() {}, sendEvent: async () => {},
        eventsKeyForLevel: (l) => "events_L" + l,
        channelTaxonomy: () => (o.noTax ? null : TAX),
        amJoined: () => o.joined !== false,
        getMyPowerLevel: (id) => (id === "!presence_chat" && "presPower" in o) ? o.presPower : 99,
        kickLevelOf: () => ("kickAt" in o) ? o.kickAt : 60,
        getRoster: () => (o.roster === null ? null : [{ userId: "@a:hs", level: 99 }]),
      },
    });
    sb.Room.rankLadder = () => sb.Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level }));
    sb.Logger.on((e) => lines.push("[" + e.level + "] " + e.message));
    sb.BotRuntime.start({ roomId: "!r:hs", channels: o.channels === undefined ? FULL : o.channels });
    try { sb.BotRuntime.stop(); } catch (e) {}
    return lines.join("\n");
  }

  const healthy = boot({});
  ok(/capabilities —/.test(healthy),
    "K: APPLIED — a capability line is written at start, or nothing below is measuring anything");
  ok(/events 2\/2/.test(healthy) && /chat 2\/2/.test(healthy),
    "K: a healthy room reports every channel present, COUNTED FROM THE TABLE rather than from a "
    + "list in the runtime — a row added to `channelTaxonomy` is checked the day it is added",
    healthy);
  ok(!/DISABLED/.test(healthy),
    "K: and nothing is reported disabled, which is the control the rows below need", healthy);
  ok(healthy.indexOf("capabilities —") < healthy.indexOf("bot mode on"),
    "K: THE QUALIFICATION COMES BEFORE THE CLAIM. `bot mode on` reads as everything-is-fine, and "
    + "somebody scanning a log stops at the first line that answers their question", healthy);

  // ── THE ONE THAT WAS SILENT ────────────────────────────────────────────────────────────────
  const noRoster = boot({ roster: null });
  ok(/roster UNREADABLE/.test(noRoster) && /DISABLED[\s\S]*presence removals/.test(noRoster),
    "K: an UNREADABLE ROSTER says so AND names what it turns off. `ownerIds` goes null, every "
    + "drop becomes unsafe, and the whole presence half stops — correctly, since the bot cannot "
    + "tell who the owner is, but it did it permanently and without a word", noRoster);

  const noPres = (() => { const c = Object.assign({}, FULL); delete c.presence_chat; return boot({ channels: c }); })();
  ok(/presence channel MISSING/.test(noPres) && /DISABLED[\s\S]*presence entirely/.test(noPres),
    "K: a room with no presence channel is told, rather than left to infer it from a refusal "
    + "once a minute — the expected answer in a room built before that channel moved to batch 3",
    noPres);

  const notJoined = boot({ joined: false });
  ok(/presence channel not joined/.test(notJoined) && /DISABLED/.test(notJoined),
    "K: and a channel that EXISTS but this client has not joined is a different fact from one "
    + "that is absent — both stop presence, and conflating them sends somebody to rebuild a room "
    + "that is fine", notJoined);

  const noStaff = (() => { const c = Object.assign({}, FULL); delete c.chat_staff; return boot({ channels: c }); })();
  ok(/chat 1\/2 \(missing staff\)/.test(noStaff) && /invisible to the bot/.test(noStaff),
    "K: a missing chat tier is NAMED. Anything said in it cannot count as activity, and the "
    + "person saying it would be warned for silence they did not keep", noStaff);

  const noChat = boot({ noChat: true });
  ok(/chat feed NOT observing/.test(noChat),
    "K: a bot with no chat subscription says so", noChat);
  ok(!/DISABLED[\s\S]*chat/.test(noChat) && /removals are FEWER rather than wrong/.test(noChat),
    "K: and it is reported as a NARROWING, not a disabled feature — chat blindness makes the bot "
    + "refuse to conclude anyone is silent, which removes fewer people rather than the wrong ones",
    noChat);

  // ── THE ONE THAT HID A 403 FOR THREE SESSIONS ──────────────────────────────────────────────
  // `presence channel joined` is a NEIGHBOURING question. The bot held 99 on the SPACE and 0 in
  // the presence chat, passed the joined check, and could not remove anybody — `[403] You cannot
  // kick user` once a minute, while the startup line said everything was fine. Power is per room,
  // so it has to be asked per room.
  const noPower = boot({ presPower: 0 });
  ok(/CANNOT KICK \(0 of 60 needed\)/.test(noPower),
    "K: a bot that has JOINED the presence channel but cannot KICK there says so, with both "
    + "numbers. `joined` alone is what read as fine while every removal was refused", noPower);
  ok(/DISABLED[\s\S]*presence REMOVALS/.test(noPower),
    "K: and it names what that turns off — removals, not presence entirely, because invites still "
    + "work at a lower power", noPower);
  ok(/re-assign this account's rank/.test(noPower),
    "K: AND THE FIX, because this is a room permission and nothing the bot can do by retrying — it "
    + "retried once a minute for three sessions", noPower);
  const canKick = boot({ presPower: 99 });
  ok(/can kick \(99 of 60\)/.test(canKick) && !/DISABLED/.test(canKick),
    "K CONTROL: and a bot that CAN kick says so and disables nothing — so the rows above are the "
    + "power read doing work rather than a line that always warns", canKick);

  const noTimer = boot({ noTimer: true });
  ok(/sweep timer OFF/.test(noTimer) && /DISABLED[\s\S]*idle sweep/.test(noTimer),
    "K: no timer means no sweeps at all, and that is the difference between a quiet room and a "
    + "dead one", noTimer);

  // ── TOTAL: AN UNREADABLE TABLE IS NOT AN EMPTY ONE ─────────────────────────────────────────
  const noTax = boot({ noTax: true });
  ok(/channel table UNREADABLE/.test(noTax) && !/chat 0\/0/.test(noTax),
    "K: an unreadable channel table reports that it could not look, rather than reporting zero "
    + "channels — `I could not see` and `there is nothing there` are different facts and the "
    + "second one would be a guess", noTax);
  const noChannels = boot({ channels: null });
  ok(/was given nothing to work with/.test(noChannels),
    "K: and a start() handed no channel map at all says so — it accepted whatever it was given "
    + "and verified none of it", noChannels);
}

function makeRT(opts) {
  const o = opts || {};
  const subs = [], unsubs = [], authored = [];
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
    "features/botsettings.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, Promise,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // `Room.rankLadder()` is the legal route from `features/` to the ladder. Built from the REAL
    // `Capabilities.LADDER` inside this sandbox rather than from a literal here, so that moving
    // the ladder moves what the runtime reads — which is the whole property PART A now checks.
    Room: { rankLadder: () => null },       // replaced below, once the sandbox exists
    MatrixBridge: {
      // The seam under test: what the SERVER says my level is.
      getMyPowerLevel: (roomId) => {
        if (o.levelThrows) throw new Error("no sync");
        return Object.prototype.hasOwnProperty.call(o, "level") ? o.level : 99;
      },
      onRawEvent: (fn) => { if (o.subThrows) throw new Error("no transport"); subs.push(fn); },
      offRawEvent: (fn) => { unsubs.push(fn); },
      sendEvent: async () => {},
      eventsKeyForLevel: (lvl) => "events_L" + lvl,
    },
  });
  // Wire the real ladder through the legal route. `o.ladder` lets a row drive a MOVED ladder
  // without editing a file, which is what turns "the constant agrees" into a driven claim.
  sb.Room.rankLadder = () => (o.ladder !== undefined
    ? o.ladder
    : sb.Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level })));
  return { RT: sb.BotRuntime, BS: sb.BotSettings, SM: sb.StreamManager, SD: sb.StateDeriver,
           Ranks: sb.Ranks, Capabilities: sb.Capabilities, subs, unsubs, authored };
}
const M = makeRT();
const RT = M.RT;

// ═══ PART A — THE LADDER SATURATES, SO THE GATE IS EXACT ═════════════════════════════════════
{
  const R = M.Ranks;
  // ── THE PREMISE IS SATURATION, NOT THE NUMBER 99 ──────────────────────────────────────────
  // These rows restated the rung as a literal too, so moving the ladder fired the PREMISE row and
  // a reader was told "the top rung must be 99" — which is not a fact about this guard's subject,
  // it is this guard holding a second copy of the ladder. Every row below is now written against
  // `TOP`, read from the ladder, so what they assert is the SHAPE (saturation) rather than the
  // value, and moving the rung leaves them green because nothing here disagrees with anything.
  const TOP = R.levelOf("owner");
  ok(typeof TOP === "number" && TOP === Math.max.apply(null, R.LADDER.map((x) => x.level)),
    "A: APPLIED — `owner` must be the ladder's TOP rung, or the saturation below is about a " +
    "ladder with something above it and means something else", { top: TOP, ladder: R.LADDER });
  ok(R.nameOf(TOP) === "owner" && R.nameOf(TOP + 1) === "owner" && R.nameOf(TOP + 2) === "owner",
    "A: `nameOf` SATURATES — every level at or above the top rung answers `owner`, so a name " +
    "comparison cannot tell the bot from the human owner",
    [R.nameOf(TOP), R.nameOf(TOP + 1), R.nameOf(TOP + 2)]);
  ok(R.atLeast(TOP + 1, "owner") === true && R.atLeast(TOP + 2, "owner") === true,
    "A: and so does `atLeast` — THE OBVIOUS RANK CHECK ADMITS THE HUMAN OWNER'S OWN TAB. That is " +
    "the fork this gate had to choose, and it is why the choice is an equality rather than a name",
    { above1: R.atLeast(TOP + 1, "owner"), above2: R.atLeast(TOP + 2, "owner") });
  ok(R.atLeast(TOP - 1, "owner") === false,
    "A control: while a level below the rung is refused, so `atLeast` discriminates somewhere and " +
    "the problem above is saturation rather than a broken comparison", R.atLeast(TOP - 1, "owner"));

  // ── THE AGREEMENT, NOT THE NUMBER ─────────────────────────────────────────────────────────
  // This row read `RT.BOT_LEVEL === 99` with a message saying "must be the ladder's top rung" —
  // **the message described an agreement and the code checked a literal.** Driven: moving the
  // rung to 97 and clearing the guard's own literals the way anyone clearing a red would, while
  // leaving the runtime's constant at 99, still went red — but on the SATURATION CONTROL below,
  // so the reader was sent to `atLeast` and never to the constant that had stopped agreeing.
  // A guard that reports the wrong subject spends attention in the wrong file.
  ok(RT.botLevel() === R.levelOf("owner"),
    "A: THE RUNTIME'S BOT LEVEL AGREES WITH THE LADDER'S TOP RUNG — compared against " +
    "`Ranks.levelOf(\"owner\")` rather than against a number, so moving the rung fails HERE, " +
    "naming the disagreement, instead of surfacing two rows later as a saturation puzzle",
    { runtime: RT.botLevel(), ladder: R.levelOf("owner") });
  ok(RT.botLevel() === Math.max.apply(null, R.LADDER.map((x) => x.level)),
    "A: and it is the TOP rung specifically, derived rather than named — a ladder that grew a " +
    "rung above owner would move this without an edit here", RT.botLevel());
  ok(RT.eligible(TOP).ok === true,
    "A: the top rung IS ADMITTED — the bot", RT.eligible(TOP));
  ok(RT.eligible(TOP + 1).ok === false && RT.eligible(TOP + 1).reason === "not-the-bot",
    "A: 100 IS REFUSED, AND WITH ITS OWN REASON. A human owner is not too weak, they are the " +
    "wrong account — and a generic refusal would send them hunting a permission problem. The " +
    "convenience of testing from the owner's tab is given up on purpose: admitting it puts two " +
    "authorities on a last-write-wins settings blob, which is silent data loss", RT.eligible(TOP + 1));
  ok(RT.eligible(TOP + 2).ok === false,
    "A: and so is anything above it — the gate is an equality, not a ceiling", RT.eligible(TOP + 2));
  ok(RT.eligible(TOP - 1).ok === false && RT.eligible(TOP - 1).reason === "too-low",
    "A: while a level below it is refused as TOO LOW, so the two directions are distinguishable " +
    "and a reader is told which side of the gate they are on", RT.eligible(TOP - 1));
  // AND THE AGREEMENT IS DRIVEN AGAINST A LADDER THAT MOVES, not just read off a static one.
  // A source that agrees today says nothing about a source that changes — the category this tree
  // has now recorded four times, and this is the first inside a guard's own assertion.
  {
    const moved = makeRT({ ladder: [{ name: "owner", level: 97 }, { name: "staff", level: 60 }] });
    ok(moved.RT.botLevel() === 97,
      "A: MOVING THE LADDER MOVES THE RUNTIME'S BOT LEVEL, with no edit in the runtime — which is " +
      "the property a literal could never have had", moved.RT.botLevel());
    ok(moved.RT.eligible(97).ok === true && moved.RT.eligible(99).ok === false,
      "A: and the gate follows it — 97 admitted, 99 now refused. A restated constant would have " +
      "admitted 99 against a ladder that no longer has it", 
      { at97: moved.RT.eligible(97), at99: moved.RT.eligible(99) });
    const blind = makeRT({ ladder: [] });
    ok(blind.RT.botLevel() === null && blind.RT.eligible(99).reason === "no-ladder",
      "A: and an UNREADABLE ladder refuses with its own reason rather than falling back to a " +
      "default — a fallback here would be the second source this change exists to remove",
      blind.RT.eligible(99));
  }

  ok(RT.eligible(0).reason === "too-low",
    "A: 0 is a REAL LEVEL and is refused as too low rather than as unreadable", RT.eligible(0));
  for (const bad of [null, undefined, "99", NaN, {}, Infinity]) {
    const v = RT.eligible(bad);
    ok(v.ok === false && v.reason === "unreadable",
      "A: an UNREADABLE level is its own refusal, not `too-low` — 0 and null are different facts, " +
      "and a gate that confused them would refuse correctly today for the wrong reason and admit " +
      "wrongly the day a default changed", { sent: bad, got: v });
  }
}

// ═══ PART B — THE LEVEL IS READ FROM THE TRANSPORT, NEVER PASSED IN ══════════════════════════
{
  const src = fs.readFileSync(path.join(ROOT, "features/botruntime.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  const startFn = src.match(/function start\(opts\)[\s\S]*?\n  \}/);
  ok(!!startFn, "B: APPLIED — `start` must be findable", "not found");
  ok(/MatrixBridge\.getMyPowerLevel\(/.test(startFn[0]),
    "B: `start` READS the level from the transport", "does not read it");
  ok(!/o\.level|opts\.level/.test(startFn[0]),
    "B: AND TAKES NO LEVEL ARGUMENT. A caller that could supply one could supply 99, and the gate " +
    "would be checking the CALLER'S CLAIM rather than the room's state — the one thing this " +
    "project never does. Authority is proved by what Matrix says, and a client asking about " +
    "itself is the same rule", "start accepts a level");

  // And the seam it reads is the SERVER's state, not a local guess.
  const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const fn = mb.match(/function getMyPowerLevel\(roomId\)[\s\S]*?\n  \}/);
  ok(!!fn, "B: APPLIED — `getMyPowerLevel` must be findable", "not found");
  ok(/m\.room\.power_levels/.test(fn[0]),
    "B: and it reads `m.room.power_levels` — the homeserver's own state, the same source every " +
    "other authority decision in the tree reads", "reads something else");
  ok(/return null/.test(fn[0]),
    "B: answering NULL when it cannot read, rather than a plausible zero that the gate would " +
    "then refuse for the wrong reason", "no null path");

  // Driven end to end.
  // THE FIXTURE LEVELS ARE DERIVED TOO. They named 99 and 100, which is the same second copy of
  // the ladder one layer down: moving the rung left PART B red on "a room where the server says 99
  // starts" — a message about a number, again pointing away from the subject.
  const TOP_B = M.Ranks.levelOf("owner");
  const bot = makeRT({ level: TOP_B });
  const r1 = bot.RT.start({ roomId: "!r:hs" });
  ok(r1.ok === true && r1.level === TOP_B,
    "B: a room where the server reports the top rung starts", r1);
  bot.RT.stop();

  const human = makeRT({ level: TOP_B + 1 });
  const r2 = human.RT.start({ roomId: "!r:hs" });
  ok(r2.ok === false && r2.reason === "not-the-bot",
    "B: a room one level ABOVE it REFUSES, end to end through the real gate", r2);
  ok(human.subs.length === 0,
    "B: AND NOTHING IS SUBSCRIBED. A refused start must not leave a listener behind — a runtime " +
    "that watched while refusing to act would be the worst of both", human.subs);

  const blind = makeRT({ levelThrows: true });
  const r3 = blind.RT.start({ roomId: "!r:hs" });
  ok(r3.ok === false && r3.reason === "unreadable",
    "B: a transport that THROWS refuses rather than defaulting — the failure direction is closed, " +
    "because a runtime that started on an unreadable level would be self-asserting authority",
    r3);
  ok(blind.subs.length === 0, "B: and subscribes nothing", blind.subs);

  const noRoom = makeRT({ level: TOP_B });
  ok(noRoom.RT.start({}).ok === false, "B: and no room means no start", noRoom.RT.start({}));
}

// ═══ PART C — NO CONFIGURATION OF ITS OWN ════════════════════════════════════════════════════
// The rule is NEGATIVE, so it is checked negatively: the runtime must contain no second source
// for anything the room already decides.
{
  const src = fs.readFileSync(path.join(ROOT, "features/botruntime.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  // ── THE CLAIM NARROWED, NOT DROPPED (v322) ──────────────────────────────────────────────
  // This read "NO TIMER AND NO INTERVAL", on the reasoning that watching is a SUBSCRIPTION and a
  // poll would have needed a cadence key. The first half is still exactly true and the conclusion
  // was drawn one step too wide.
  //
  // The AFK sweep is not watching. **Nobody emits an event when somebody stops doing things**, so
  // idleness cannot arrive by subscription — it can only be noticed by looking. That is a
  // different question from the one the watch loop answers, and it needs the opposite mechanism.
  //
  // WHAT THIS PART WAS ACTUALLY PROTECTING SURVIVES INTACT: no second source for anything the room
  // decides. The sweep's interval is how often the bot LOOKS, never how long anybody is GIVEN —
  // `queueIdleMs` and `botPingMs` decide that and are read fresh inside every pass. So the
  // assertion moves from "no timer" to the thing that mattered: the cadence is a CONSTANT and not
  // a settings key, and it is not a second answer to a question the room already settles.
  const timers = (src.match(/setInterval|setTimeout/g) || []).length;
  ok(timers <= 2,
    "C: at most the ONE sweep timer (set and cleared). A second cadence in this runtime is a poll " +
    "competing with the subscription that already covers requests", timers);
  ok(/const SWEEP_EVERY_MS\s*=\s*\d+/.test(src),
    "C: the sweep cadence must be a CONSTANT in this file. As a setting it would be a dial an " +
    "owner could set longer than the windows it samples, silently making `queueIdleMs` and " +
    "`botPingMs` mean nothing — a third answer to a question two keys already settle");
  ok(!/setInterval[\s\S]{0,200}settings\./.test(src),
    "C: and the cadence must not be read from the room's settings");

  // No local default for any key the room already carries.
  const keys = Object.keys(M.SD.defaultSettings());
  ok(keys.length > 20, "C: APPLIED — the settings vocabulary must be readable", keys.length);
  // ── AN ASSIGNMENT, NOT A COMPARISON ─────────────────────────────────────────────────────────
  // `[:=]` matched `botQueueChat === true`, which is a READ — and reading the room's settings is
  // exactly what this module is supposed to do. The rule is about a SECOND SOURCE: a key given a
  // value here would compete with the room's, and the local one would win in the code while the
  // room's won in the docs.
  //
  // So the pattern is a colon (an object literal) or a single `=` NOT followed by another. A
  // comparison is the shape of a module obeying this rule, and flagging it taught the reader to
  // route around the guard rather than to satisfy it.
  const restated = keys.filter((k) => new RegExp("\\b" + k + "\\s*(?::|=(?!=))").test(src));
  ok(restated.length === 0,
    "C: and NO SETTINGS KEY IS ASSIGNED A VALUE HERE. The moment there are two sources they " +
    "disagree and nobody notices, because the local one wins in the code and the room's one wins " +
    "in the docs", restated);

  // The delegation policy is not restated either — it is one call.
  ok(!/botDelegation/.test(src),
    "C: the delegation table is never named here — `BotSettings.decide` owns that policy and this " +
    "runtime only hands it a request", "names botDelegation");
  ok(/BotSettings\.authorIfPermitted/.test(src),
    "C: APPLIED — it must actually call the policy, or the row above is true of a runtime that " +
    "does nothing", "does not call it");

  // Settings are read FRESH on every request.
  const handler = src.match(/function _handleRequest\(raw\)[\s\S]*?\n  \}/);
  ok(!!handler, "C: APPLIED — the request handler must be findable", "not found");
  ok(/getState\(\)\.settings/.test(handler[0]),
    "C: settings are read FRESH inside the handler, not captured at start — a cached table would " +
    "go on applying a delegation the owner has since revoked", handler[0].slice(0, 120));

  // THE GAP, NAMED RATHER THAN PAPERED OVER: reputation snapshots need a cadence key that does
  // not exist, so the runtime does not publish. Asserted, so a later edit that adds a schedule
  // without adding the key fails here.
  ok(!/Reputation\./.test(src),
    "C: THE RUNTIME DOES NOT PUBLISH REPUTATION SNAPSHOTS, and that is the rule working rather " +
    "than an omission. `Reputation.publish` exists; *how often* has no settings key, and inventing " +
    "a local default is exactly the second source this part forbids. J17's schema was enumerated " +
    "once because adding a key later moves every checkpoint fingerprint — so the gap is NAMED and " +
    "a later job pays that cost knowingly", "the runtime calls Reputation");
}

// ═══ PART D — IT ACTUALLY RUNS ═══════════════════════════════════════════════════════════════
{
  const bot = makeRT({ level: M.Ranks.levelOf("owner") });
  const authored = [];
  const D = bot.SD.defaultSettings();
  const settings = Object.assign({}, D, { botDelegation: { maxLen: "staff" } });
  // The runtime reads settings through StreamManager; point that at our blob.
  bot.SM.getState = () => ({ settings: settings });

  const started = bot.RT.start({ roomId: "!r:hs", authorSettings: async (p) => { authored.push(p); } });
  ok(started.ok === true, "D: APPLIED — the runtime must start", started);
  ok(bot.subs.length === 1,
    "D: it SUBSCRIBES — one listener, so it is watching rather than merely willing to", bot.subs.length);
  const fire = bot.subs[0];

  // ── SHAPED THE WAY THE TRANSPORT EMITS IT, NOT THE WAY THE READER WANTS IT ─────────────────
  // This built `{ type: "ddjp.bot.request", content: { k, v } }`, which the transport CANNOT
  // produce: every DDJP event goes on the wire as `m.room.message` with its real type inside the
  // JSON body as `t`, and `matrixbridge.js` stamps that onto `raw` as `ddjpType`/`ddjpBody`.
  //
  // So this guard was green over a bot that could never handle a request, and an owner reported
  // it twice from a live room — `seen: 0, acted: 0, refused: 0` with three requests in the log.
  // A fixture that supplies the field names the subject expects is the defect class this project
  // catalogues, and it was in the guard for the very feature it was written to prove.
  const req = (k, v, rank) => {
    const payload = { k: k, v: v, t: "ddjp.bot.request", l: 1 };
    return { type: "m.room.message", room_id: "!r:hs", event_id: "$q" + k,
             sender: "@x:hs", senderRank: rank, ts: 1,
             content: { msgtype: "m.text", body: JSON.stringify(payload) },
             ddjpType: "ddjp.bot.request", ddjpBody: payload };
  };

  // A PERMITTED request is acted on.
  fire(req("maxLen", 600, 60), {}, {});
  return settle().then(() => {
    ok(authored.length === 1 && authored[0].maxLen === 600,
      "D: A PERMITTED REQUEST IS AUTHORED — the runtime is the caller the pure modules were " +
      "waiting for, and this is the whole deliverable", authored);
    ok(bot.RT.status().acted === 1,
      "D: and the verdict is counted", bot.RT.status());

    // A REFUSED request is not.
    fire(req("maxLen", 600, 20), {}, {});
    return settle();
  }).then(() => {
    ok(authored.length === 1,
      "D: A REFUSED REQUEST AUTHORS NOTHING — the runtime does not re-decide, it hands the " +
      "request to the policy and the policy's refusal is the end of it", authored);
    ok(bot.RT.status().refused === 1,
      "D: counted as a refusal rather than lost", bot.RT.status());

    // An unrelated event is ignored without comment.
    const before = bot.RT.status().seen;
    fire({ type: "ddjp.dj.vote", room_id: "!r:hs", event_id: "$v", sender: "@a:hs", content: {}, ts: 1 }, {}, {});
    ok(bot.RT.status().seen === before,
      "D: an event the mode does not handle is not even SEEN — the raw fan-out carries the whole " +
      "room, so the handler must be cheap and silent about the vast majority of it",
      { before, after: bot.RT.status().seen });

    // STOP UNSUBSCRIBES BY IDENTITY.
    const s = bot.RT.stop();
    ok(s.ok === true && bot.unsubs.length === 1 && bot.unsubs[0] === bot.subs[0],
      "D: stop removes THE SAME handler it added, by identity — passing null to an `off()` that " +
      "ignores it is the leak `features/chat.js` already had to fix once", 
      { removed: bot.unsubs.length, same: bot.unsubs[0] === bot.subs[0] });
    ok(bot.RT.status().running === false,
      "D: and the runtime reports itself stopped", bot.RT.status());

    // Events after stop do nothing.
    fire(req("maxLen", 700, 60), {}, {});
    return settle();
  }).then(() => {
    ok(authored.length === 1,
      "D: and an event arriving AFTER stop authors nothing — the handler may still be held by a " +
      "transport that ignored the removal, so the runtime refuses on its own state too",
      authored.length);

    // ── SETTINGS ARE READ FRESH, DRIVEN AGAINST A BLOB THAT MOVES ──────────────────────────
    // `mutate-br-botruntime` M11 (settings captured at start) survived the SOURCE check in PART C,
    // which only proved the handler names `getState().settings`. That says nothing about whether
    // it reads it again — a cache would name it once and keep the answer. So the blob is CHANGED
    // between two requests, which is the only way to tell reading from having read.
    // BOTH REQUESTS LAND IN ONE RUN. The first version stopped and restarted between them, so a
    // per-run cache was recreated and the mutation survived — the FIXTURE, not the assertion, and
    // the second time in this pass that the fixture was the fault. The subscription is kept live
    // and only the blob moves.
    const fresh = makeRT({ level: M.Ranks.levelOf("owner") });
    const seen2 = [];
    let live = Object.assign({}, D, { botDelegation: { maxLen: "staff" } });
    fresh.SM.getState = () => ({ settings: live });
    fresh.RT.start({ roomId: "!r:hs", authorSettings: async (p) => { seen2.push(p); } });
    const fire2 = fresh.subs[0];
    fire2(req("maxLen", 610, 60), {}, {});
    return settle().then(() => {
      ok(seen2.length === 1,
        "D: APPLIED — the first request in this run must be acted on, or the revocation below is " +
        "a refusal of something that was never permitted", seen2);
      live = Object.assign({}, D, { botDelegation: {} });   // the owner revokes, mid-run
      fire2(req("maxLen", 800, 60), {}, {});
      return settle();
    }).then(() => {
      ok(seen2.length === 1,
        "D: SETTINGS ARE READ FRESH ON EVERY REQUEST. The owner revoked the delegation between " +
        "two requests IN THE SAME RUN and the second was refused — a table captured at start " +
        "would go on applying a delegation that no longer exists, and a source check naming " +
        "`getState()` cannot tell reading from having read", seen2);
      fresh.RT.stop();
      return Promise.resolve();
    }).then(() => {
      // ── THE REQUESTER'S RANK IS THE CHANNEL ORIGIN, DRIVEN AGAINST A LYING PAYLOAD ────────
      // M13 (rank taken from the payload) survived because no fixture ever put a DIFFERENT rank
      // in the payload from the one the transport stamped. With both the same, reading either
      // gives the same answer.
      const liar = makeRT({ level: M.Ranks.levelOf("owner") });
      const got = [];
      liar.SM.getState = () => ({ settings: settings });
      liar.RT.start({ roomId: "!r:hs", authorSettings: async (p) => { got.push(p); } });
      const fire3 = liar.subs[0];
      fire3({ type: "m.room.message", ddjpType: "ddjp.bot.request", room_id: "!r:hs", event_id: "$liar", sender: "@x:hs",
              senderRank: 20, ddjpBody: { k: "maxLen", v: 900, rank: 99 },
              content: { msgtype: "m.text", body: JSON.stringify({ k: "maxLen", v: 900, rank: 99 }) },
              ts: 1 }, {}, {});
      return settle().then(() => {
        ok(got.length === 0,
          "D: THE REQUESTER'S RANK COMES FROM THE CHANNEL ORIGIN THE TRANSPORT STAMPED, never a " +
          "field in the payload. Driven with a payload CLAIMING 99 while the transport stamped " +
          "20: the request is refused. A fixture where both agree cannot tell which one was " +
          "read, which is how this survived a mutation", got);
        liar.RT.stop();
        const honest = makeRT({ level: M.Ranks.levelOf("owner") });
        const got2 = [];
        honest.SM.getState = () => ({ settings: settings });
        honest.RT.start({ roomId: "!r:hs", authorSettings: async (p) => { got2.push(p); } });
        honest.subs[0]({ type: "m.room.message", ddjpType: "ddjp.bot.request", room_id: "!r:hs", event_id: "$ok", sender: "@x:hs",
                         senderRank: 60, ddjpBody: { k: "maxLen", v: 900 },
                         content: { msgtype: "m.text", body: JSON.stringify({ k: "maxLen", v: 900 }) },
                         ts: 1 }, {}, {});
        return settle().then(() => {
          ok(got2.length === 1,
            "D control: while a request whose STAMPED rank is sufficient is acted on — so the " +
            "refusal above is about which field was read rather than about a runtime that " +
            "refuses everything", got2);
          honest.RT.stop();
          more();
        });
      });
    });
  }).then(() => {});
}

function more() {
  {
    const again = makeRT({ level: M.Ranks.levelOf("owner") });
    again.RT.start({ roomId: "!r:hs" });
    const twice = again.RT.start({ roomId: "!r:hs" });
    ok(twice.ok === false && twice.reason === "already-running",
      "D: starting twice is refused rather than doubling the subscription — two listeners would " +
      "act on every request twice", twice);
    ok(again.subs.length === 1, "D: and only one listener exists", again.subs.length);
    again.RT.stop();
    partE();
  }
}

function settle() { return new Promise((r) => setTimeout(r, 0)); }

// ═══ PART E / PART F ═════════════════════════════════════════════════════════════════════════
function partE() {
  // ONE MODE, AND THE SEAM IS A TABLE.
  const modes = Object.keys(RT.MODES);
  ok(modes.length === 1 && modes[0] === "consensus",
    "E: EXACTLY ONE MODE EXISTS. `consensus/backend-selection.md` forbids building a seam before " +
    "a second engine exists, because it recreates the dead branch this project deleted — and the " +
    "centralized bot-run room does not exist", modes);
  ok(RT.DEFAULT_MODE === "consensus", "E: and it is the default", RT.DEFAULT_MODE);
  ok(typeof RT.MODES.consensus.why === "string" && RT.MODES.consensus.why.length > 20,
    "E: the one row carries its REASON, so adding a second means adding a reason rather than " +
    "finding every place a condition was assumed", RT.MODES.consensus.why);
  ok(Array.isArray(RT.MODES.consensus.handles) && RT.MODES.consensus.handles.length > 0,
    "E: and what it handles, which is what the watch loop dispatches on", RT.MODES.consensus.handles);

  const src = fs.readFileSync(path.join(ROOT, "features/botruntime.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(!/centraliz|centralis/i.test(src),
    "E: and NO SECOND MODE IS PRE-BUILT — no row, no branch, and no configuration selecting " +
    "between them. A seam is addable; it is not added", "names a second mode");
  const unknown = makeRT({ level: M.Ranks.levelOf("owner") }).RT.start({ roomId: "!r:hs", mode: "centralized" });
  ok(unknown.ok === false && unknown.reason === "no-such-mode",
    "E: asking for a mode that does not exist is REFUSED rather than falling back to the one that " +
    "does — a silent fallback would make a typo look like a working second mode", unknown);

  // ═══ PART F — THE LIBRARIES ARE STILL INERT ═══════════════════════════════════════════════
  // The whole premise of this job is that nothing ran. If a feature module grows a timer or a
  // subscription of its own, the runtime stops being the only thing that acts and a failure has
  // two candidate causes again.
  for (const f of ["features/botsettings.js", "features/reputation.js"]) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8")
      .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
    ok(!/setInterval|setTimeout|onRawEvent|\.onChange\(/.test(s),
      "F: `" + f + "` holds NO timer and NO subscription — it is a library, and the runtime is " +
      "the only thing that acts. That is what keeps a failure to one candidate cause", f);
  }

  partJ();   // the scheduler check runs; a part defined and never called is the defect this file audits
  partK();   // and the capability walk, for the same reason

console.log("[bot-runtime] PASS — the bot runtime admits the bot and nobody else, and holds no " +
    "configuration of its own (" + asserts + " assertions). THE GATE IS `=== 99` AND THE OBVIOUS " +
    "RANK CHECK IS THE WRONG ANSWER: `Ranks.LADDER` tops out at 99 so `nameOf` and `atLeast` " +
    "SATURATE — 99, 100 and 101 all answer `owner`, and a rank check therefore admits the human " +
    "owner's own tab. That is convenient for testing and it puts TWO AUTHORITIES on a " +
    "last-write-wins settings blob, which is the lost-update failure J17 measured, so the " +
    "convenience is given up on purpose and 100 is refused with its own reason. THE LEVEL IS READ " +
    "FROM `m.room.power_levels` BY THE TRANSPORT and `start` takes no level argument, because a " +
    "caller that could supply one could supply 99 — authority is proved by what Matrix says, and " +
    "a client asking about itself is the same rule. An unreadable level is its own refusal, not " +
    "`too-low`. THE RUNTIME HOLDS NO CONFIGURATION: no timer, no interval, no settings key " +
    "assigned a value, and the delegation table read fresh on every request. It does NOT publish " +
    "reputation snapshots, and that is the rule working rather than an omission — *how often* has " +
    "no settings key and inventing one locally is the second source this forbids. ONE MODE EXISTS " +
    "and the seam is a table with a reason rather than a branch; an unknown mode is refused rather " +
    "than falling back. And both feature modules are still INERT, which is what keeps the runtime " +
    "the only thing that acts");
}
