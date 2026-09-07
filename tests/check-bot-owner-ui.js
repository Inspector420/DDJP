// tests/check-bot-owner-ui.js
// WALL: THE BOT IS NEVER OFFERED AN OWNER ACT, AND A NEW OWNER ACT CANNOT QUIETLY APPEAR FOR IT.
//
// The bot holds the ladder's top rung, so `Capabilities.atLeast(level, "owner")` is true for it and
// every owner control reads as permitted. Measured before the fix: all 19 catalogue actions
// resolved IDENTICALLY for the bot and for a human owner — `room.upgrade` among them, an act J52
// settled the bot never takes and `RoomUpgrade._mayUpgrade` already refuses. A control that is
// offered and then refused is the "button that did nothing" defect this project has already shipped
// once.
//
// PART A — the denial is DERIVED from `Ranks.GATES`, so a new owner row is refused the day it lands.
// PART B — every owner-gated act carries a REASON somebody can read.
// PART C — acting as the bot, no owner act is offered.
// PART D — NOT acting as the bot, every one of them still is. Without this the fix could be
//          "nothing is ever offered" and PART C would not notice.
// PART E — the ENFORCEMENT is untouched. The display was wrong; the gates were not.

const path = require("path");
const { loadInContext } = require("./_load.js");

let A = 0;
let failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[bot-owner-ui] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const STARTED = [];

// A client at `level`, optionally RUNNING as the room's bot. Built from the reducer's own defaults
// rather than a hand-made settings object, for the reason `check-idle-sweep` states: a partial blob
// exercises a shape production cannot produce.
function client(level, runAsBot) {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  const state = { settings: settings, rotation: [], queue: [], playing: null, ranks: {} };
  const me = runAsBot ? "@bot:hs" : "@owner:hs";

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/actions.js",
    "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getState: () => state, getLog: () => [], isLegal: () => true, on() {} },
    MatrixBridge: {
      getUserId: () => me, getMyRank: () => 99, getMyPowerLevel: () => level,
      getRoster: () => [], onRawEvent() {}, offRawEvent() {},
      spaceChildLevel: () => 100,
      getUserEffectiveRank: () => level,
    },
    ServerClock: { serverNow: () => 1000000 },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
  });
  // The authority the UI reads. `getUserEffectiveRank` maxes over the space and every channel, so
  // it is the one source that separates a bot at 99 from a human owner at 100.
  sb.Room.getMyAuthorityLevel = () => level;
  sb.Room.getMyId = () => me;
  sb.Room.getCurrent = () => ({ spaceId: "!s:hs", channels: {} });

  if (runAsBot) {
    sb.BotRuntime.start({ roomId: "!r:hs" });
    STARTED.push({ stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} } });
  }
  return sb;
}

// ── THE OWNER ACTS, DERIVED RATHER THAN LISTED ───────────────────────────────────────────────
// A literal list here would go stale the next time a row is added at `"owner"` — which is exactly
// the failure this file exists to prevent, so restating it would reproduce it.
const probe = client(99, false);
const OWNER_ACTS = Object.keys(probe.Ranks.GATES)
  .filter((a) => probe.Ranks.GATES[a] === "owner")
  .sort();
const CATALOGUE = probe.Actions.ACTIONS.slice();

ok(OWNER_ACTS.length > 0,
  "A: APPLIED — the gate table yields at least one owner act, so the derivation reached something. "
  + "An empty list would make every part below vacuously true", OWNER_ACTS);

// ── PART A — THE DENIAL IS DERIVED, NOT ENUMERATED ───────────────────────────────────────────
// The property: an owner-gated act that NOBODY has classified is already refused. That is the
// difference between a rule and a rule with something running it — the table supplies the wording
// and the GATE supplies the denial.
//
// DRIVEN IN TWO LINKS, because the obvious one-liner proves nothing. `ranks.js` exports
// `GATES: Object.assign(Object.create(null), GATES)` — a COPY — so assigning a row to
// `Ranks.GATES` here never reaches `gateFor`, which closes over the real table. A first version of
// this part did exactly that and passed against a `mayOffer` that had not been consulted at all.
//
//   A1: `Capabilities.gateFor` relays the shipped table — checked against a row that is really in it.
//   A2: `mayOffer` refuses whatever `gateFor` calls an owner act, including one it has never
//       heard of. The lookup is wrapped rather than the answer assumed, so this drives
//       `mayOffer`'s real branch on an input its real collaborator can produce.
{
  const bot = client(99, true);

  ok(bot.Capabilities.gateFor("room.upgrade") === "owner",
    "A1: APPLIED — `gateFor` answers from the shipped gate table, so wrapping it below stands in "
    + "for a row being added to that table", bot.Capabilities.gateFor("room.upgrade"));

  const invented = "room.selfdestruct";
  ok(bot.Capabilities.gateFor(invented) === null || bot.Capabilities.gateFor(invented) === undefined,
    "A1: APPLIED — and the invented act is genuinely unknown to it beforehand",
    bot.Capabilities.gateFor(invented));
  ok(!(bot.BotRuntime.BOT_MAY_NOT || {})[invented],
    "A1: APPLIED — and nobody has written a reason for it, which is the whole point");

  // The sandbox's `Ranks` and the lexical `Ranks` that `botruntime.js` closes over are the SAME
  // object, so replacing the method is visible to it. Restored below.
  const realGateFor = bot.Capabilities.gateFor;
  bot.Capabilities.gateFor = (a) => (a === invented ? "owner" : realGateFor(a));
  try {
    const d = bot.BotRuntime.mayOffer(invented);
    ok(d.may === false,
      "A2: an owner-gated act nobody has classified is refused for the bot the moment it exists. "
      + "The default is not-offered, so a new owner control cannot quietly appear on the bot's "
      + "screen between being written and being noticed", d);
    ok(typeof d.why === "string" && d.why.length > 0,
      "A2: and it still carries a sentence, so the person reading the bot's screen is not shown a "
      + "dead control with no account of itself", d);

    // AND THE CONTROL: the same unclassified act, at the same moment, is NOT refused for a human
    // owner. Without this, A2 would pass against a `mayOffer` that refused everything.
    const human = client(100, false);
    const realHumanGate = human.Capabilities.gateFor;
    human.Capabilities.gateFor = (a) => (a === invented ? "owner" : realHumanGate(a));
    try {
      ok(human.BotRuntime.mayOffer(invented).may === true,
        "A2 CONTROL: the same unclassified owner act is still offered to a human owner — so A2 is "
        + "the bot rule doing work rather than a blanket refusal",
        human.BotRuntime.mayOffer(invented));
    } finally { human.Capabilities.gateFor = realHumanGate; }
  } finally { bot.Capabilities.gateFor = realGateFor; }
}

// ── PART B — EVERY OWNER ACT HAS A REASON WRITTEN FOR IT ─────────────────────────────────────
// The fallback in PART A keeps a person from seeing nothing, but a generic sentence for an act
// somebody DID ship is a worse answer than a specific one. This is what turns red when a row is
// added to `GATES` and not to `BOT_MAY_NOT`.
{
  const bot = client(99, true);
  const table = bot.BotRuntime.BOT_MAY_NOT || {};
  for (const act of OWNER_ACTS) {
    const why = table[act];
    ok(typeof why === "string" && why.length > 20,
      "B: `" + act + "` is gated on owner and needs its own sentence in `BOT_MAY_NOT` — a person "
      + "reading the bot's screen has to be able to tell 'this account may not' from 'this is "
      + "broken'", { act: act, why: why || null });
  }
  // AND THE TABLE NAMES NOTHING THAT IS NOT AN OWNER ACT, so a row whose act was renamed or
  // un-gated is noticed rather than sitting there explaining a control nobody sees.
  for (const act of Object.keys(table)) {
    ok(OWNER_ACTS.indexOf(act) >= 0,
      "B: `" + act + "` has a reason written for it but is not owner-gated — a stale row explains "
      + "a denial that no longer happens", { act: act, ownerActs: OWNER_ACTS });
  }
}

// ── PART C — ACTING AS THE BOT, NO OWNER ACT IS OFFERED ──────────────────────────────────────
{
  const bot = client(99, true);
  const table = bot.BotRuntime.BOT_MAY_NOT || {};
  ok(bot.BotRuntime.actingAsBot() === true, "C: APPLIED — this client is running as the bot");
  for (const act of OWNER_ACTS) {
    if (CATALOGUE.indexOf(act) < 0) continue;   // not every gate row has a UI action
    const d = bot.Actions.describe(act, { userId: "@x:hs", targetRank: 0, retryAt: 0 });
    ok(d.enabled === false,
      "C: the bot is not offered `" + act + "` — it holds the top rung, so `Capabilities` says "
      + "permitted and only this rule can say otherwise", d);
    // THE ACT'S OWN SENTENCE REACHES THE SCREEN, not merely SOME sentence. PART B proves the table
    // holds a reason for every owner act; without this line nothing proved `mayOffer` READS it.
    // Gutting the lookup to `undefined` — so every act falls back to the generic sentence — left
    // this file green until this assertion existed, which is the reasons-exist-with-no-caller
    // shape arriving inside the guard written to prevent it.
    ok(d.reason === table[act],
      "C: and the reason shown for `" + act + "` is that act's OWN row, so the table is read "
      + "rather than merely present", { shown: d.reason, row: table[act] });
  }
  // THE UPGRADE BUTTON SPECIFICALLY, because it is the one a person reported and the one whose
  // enforcement already refused while the display still offered it.
  const up = bot.Actions.describe("room.upgrade", { retryAt: 0 });
  ok(up.enabled === false,
    "C: `room.upgrade` is not offered to the bot. Before this it WAS — and `_mayUpgrade` refused "
    + "it on the way through, which is a button that does nothing", up);
}

// ── PART D — A HUMAN OWNER STILL GETS EVERYTHING ─────────────────────────────────────────────
// Without this, "no owner act is ever offered to anybody" would satisfy PART C completely.
{
  const owner = client(100, false);
  ok(owner.BotRuntime.actingAsBot() === false,
    "D: APPLIED — this client is NOT running as the bot");
  for (const act of OWNER_ACTS) {
    if (CATALOGUE.indexOf(act) < 0) continue;
    const d = owner.Actions.describe(act, { userId: "@x:hs", targetRank: 0, retryAt: 0 });
    ok(d.enabled === true,
      "D CONTROL: the human owner IS still offered `" + act + "` — so PART C is the bot rule doing "
      + "work rather than a catalogue that stopped offering owner acts to everyone", d);
  }
}

// ── PART D2 — AND AN OWNER-RANK ACCOUNT THAT IS NOT RUNNING THE BOT IS UNAFFECTED ─────────────
// The rule keys on RUNNING AS THE BOT, not on holding 99. A human owner in a room where some other
// account is the bot must be untouched, and 99 is a level a human can hold.
{
  const human99 = client(99, false);
  const d = human99.Actions.describe("room.settings", { retryAt: 0 });
  ok(d.enabled === true,
    "D2: an account at the bot's LEVEL that is not RUNNING as the bot keeps every owner control — "
    + "the rule keys on the runtime, not on the number, so it cannot catch a human owner", d);
}

// ── PART E — THE ENFORCEMENT IS UNTOUCHED ────────────────────────────────────────────────────
// The display was wrong and the gates were right. A "fix" that relaxed a gate to match the screen
// would be the inversion this must not become.
{
  const bot = client(99, true);
  // `Capabilities` still answers from the reducer's table, unchanged and bot-blind.
  ok(bot.Capabilities.atLeast(99, "owner") === true,
    "E: `Capabilities.atLeast(99, 'owner')` is still TRUE — the rulebook is unchanged, and it has "
    + "to be, because `check-capabilities` proves it agrees with what the REDUCER enforces");
  const raw = bot.Capabilities.can("room.settings", { settings: {}, rotation: [] },
    { myId: "@bot:hs", myRank: 99, now: 0, target: {} });
  ok(raw.permitted === true,
    "E: and `Capabilities.can` still permits the bot's owner acts. The denial is added at the "
    + "DISPLAY seam only, so nothing the bot legitimately does — the AFK sweep's `Queue.remove`, a "
    + "requested settings write through `authorSettings` — passes through it", raw);
}

// ── PART F — THE SENTENCE A PERSON READS COMES FROM THE DESCRIPTOR ───────────────────────────
// SOURCE-LEVEL, AND THAT IS A PARTIAL RATHER THAN A WALL. Nothing in this suite renders the UI, so
// this cannot prove what the bot's screen SAYS — only that the panel asks the descriptor instead of
// asserting a sentence of its own. Both labelling defects this project has shipped were wrong words
// on a correct mechanism, and both reached the owner because no guard reads rendered text. This
// closes the silent-revert half; a person still has to read the screen.
//
// The specific lie: "Only the owner can change these" is FALSE on the bot's screen. The bot IS at
// owner rank — that is the whole reason it was offered the control — and the real reason it may not
// edit them is that it changes settings only when asked.
{
  const src = require("fs").readFileSync(path.join(__dirname, "..", "ui", "interface.js"), "utf8");
  const SENTENCE = "Only the owner can change these.";

  // NO CHARACTER WINDOW, AND THE FIRST VERSION OF THIS PART HAD ONE. It anchored on the string
  // "Room settings" and read the next 1200 characters — but that string occurs THREE times in this
  // file, the first of them 108,000 characters from the code being checked, so the part failed
  // against a fix that was correctly in place. A guard bounded by character distance is a mistake
  // this project has already made once and caught once; the fix both times is to assert the
  // relationship rather than the proximity.
  const occurrences = src.split(SENTENCE).length - 1;
  ok(occurrences === 1,
    "F: APPLIED — the sentence appears exactly once, so guarding this one occurrence guards all of "
    + "them", occurrences);
  ok(new RegExp("settingsDesc\\.reason\\s*\\|\\|\\s*\"" + SENTENCE.replace(/\./g, "\\.") + "\"").test(src),
    "F: the not-owner message is the DESCRIPTOR'S reason, with the old sentence surviving only as "
    + "the fallback. A sentence written in the panel cannot know why the account in front of it "
    + "was refused, and on the bot's screen the obvious one is false: the bot IS at owner rank, "
    + "which is exactly why it was offered the control");
}

for (const t of STARTED) { try { t.stop(); } catch (e) {} }

if (failed) process.exit(1);
console.log("[bot-owner-ui] PASS — the bot is offered no owner act, and the refusal is DERIVED from "
  + "`Ranks.GATES` rather than listed: an act invented and gated at `owner` in the middle of this "
  + "file is already refused, so a new owner control cannot appear on the bot's screen between "
  + "being written and being remembered. Every owner act carries a sentence a person can read, and "
  + "a sentence for an act that is no longer owner-gated turns this red too. Driven both ways — the "
  + "human owner still gets all of them, and so does a human at the bot's own level who is not "
  + "running the bot, so the rule keys on the runtime rather than on the number 99. The ENFORCEMENT "
  + "is asserted unchanged: `Capabilities` still permits what the reducer permits, because the "
  + "display was the wrong half (" + A + " assertions)");
