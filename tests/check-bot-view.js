// tests/check-bot-view.js
// WALL: THE BOT IS THE OWNER, EXCEPT IT DOES NOT LOAD THE MEDIA WHEN ITS VIEW IS OFF.
//
// This file used to be the opposite rule. `playback.js` refused the bot's advance and its length
// report, added after a live session caught it doing both. The owner reversed that: the bot is
// meant to do what the owner would and to act FIRST when it acts — its 0ms stagger at the top rung
// is the point, not the problem — and a room whose owner has left still has an authority in it.
//
// THE DIFFERENCE SHRANK TO ONE THING. With its view off the bot does not LOAD the media, and
// everything the old rules bought falls out with nothing to enforce:
//   · no player -> no measured duration -> no `ddjp.play.len`, and no wall-clock advance
//   · no player -> no `onError`        -> no `ddjp.play.blocked`
// The second is not cosmetic. Blocked reports feed the auto-skip roads (`blockedGuestPlus` ->
// `roadMet` -> `skipWarranted`), so a DELIBERATE non-watcher reporting "blocked" would help vote
// off a song everyone else can see fine.
//
// DRIVEN, NOT DESCRIBED. A first version of this checked `interface.js` with a regex; it matched
// the defensive `typeof` lines rather than the decision, so deleting either real check left the
// suite green. The decision now lives in `BotRuntime.viewOff` and is asserted on all four
// combinations of (am I the bot) x (is the view on).

const path = require("path");
const { loadInContext } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[bot-view] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const STARTED = [];

function client(runAsBot, viewOn) {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  const state = { settings: settings, rotation: [], queue: [], nowPlaying: null, ranks: {} };
  let prefBotView = !!viewOn;

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getState: () => state, getLog: () => [], isLegal: () => true, on() {} },
    MatrixBridge: {
      getUserId: () => (runAsBot ? "@bot:hs" : "@owner:hs"), getMyRank: () => 99,
      getMyPowerLevel: () => 99, getUserEffectiveRank: () => 99, spaceChildLevel: () => 100,
      getRoster: () => [], onRawEvent() {}, offRawEvent() {},
    },
    ServerClock: { serverNow: () => 1000000 },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
    // The real pref module's SHAPE, with the value under this test's control.
    ChatPrefs: { botView: () => prefBotView },
  });
  if (runAsBot) {
    const r = sb.BotRuntime.start({ roomId: "!r:hs" });
    ok(r && r.ok === true, "APPLIED — the runtime started for the bot case", r);
    STARTED.push({ stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} } });
  }
  return sb;
}

// ── PART A — ALL FOUR COMBINATIONS ───────────────────────────────────────────────────────────
// Only ONE of the four withholds the media, and naming the other three is the whole point: a rule
// that fired on bot-ness alone would darken a human owner who merely holds the same level, and one
// that fired on the setting alone would darken everybody.
{
  const CASES = [
    [true,  false, true,  "the bot, view OFF — the one case that withholds the media"],
    [true,  true,  false, "the bot, view ON — a full owner: it watches, measures and advances"],
    [false, false, false, "NOT the bot, view off — a human owner is never darkened by this setting"],
    [false, true,  false, "NOT the bot, view on — unchanged"],
  ];
  for (const [isBot, viewOn, expect, why] of CASES) {
    const c = client(isBot, viewOn);
    ok(c.BotRuntime.actingAsBot() === isBot,
      "A: APPLIED — actingAsBot reflects the case (" + why + ")", c.BotRuntime.actingAsBot());
    ok(c.BotRuntime.viewOff() === expect,
      "A: " + why, { viewOff: c.BotRuntime.viewOff(), expected: expect });
  }
}

// ── PART B — THE DEFAULT IS OFF ──────────────────────────────────────────────────────────────
// Read from the real prefs module rather than restated, because a default written in two places
// is the second source this tree keeps finding. ON is the costly direction: a bot that quietly
// streams every song all day is a provider bill nobody is enjoying.
{
  const c = loadInContext(["core/logger.js", "core/store.js", "core/chatprefs.js"], {
    Date, Math, JSON, window: {}, document: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  ok(c.ChatPrefs.botView() === false,
    "B: a fresh device does NOT watch. The bot streaming is opt-in, because on is the direction "
    + "that costs money", c.ChatPrefs.botView());
  c.ChatPrefs.setBotView(true);
  ok(c.ChatPrefs.botView() === true,
    "B CONTROL: and the setting can actually be turned on — otherwise A's ON rows would pass "
    + "against a pref that is hardwired off", c.ChatPrefs.botView());
}

// ── PART C — THE DECISION IS REACHED FROM THE LOAD SITE ──────────────────────────────────────
// PART A proves the answer is right; this proves something ASKS. Seven times this project has had
// a rule with no caller, three of them in code written the same day to fix the previous one.
{
  const ui = require("fs").readFileSync(path.join(__dirname, "..", "ui", "interface.js"), "utf8");
  const code = ui.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const loadIdx = code.indexOf("loadVideo(np.song.videoId");
  ok(loadIdx > 0, "C: APPLIED — the media load site was located", loadIdx);
  ok(/_botViewOff\(\)/.test(code.slice(Math.max(0, loadIdx - 600), loadIdx)),
    "C: the load is gated. Without a caller the rule in `BotRuntime.viewOff` would be a correct "
    + "answer nobody asks for, and the bot would stream every song exactly as before");
  ok(/BotRuntime\.viewOff/.test(code),
    "C: and the panel asks the RUNTIME rather than re-deriving bot-ness and the pref itself — a "
    + "second copy of this decision is free to disagree with the first");
}

// ── PART D — PLAYBACK HOLDS NO BOT RULE ──────────────────────────────────────────────────────
// The reversal, asserted. A reference here means somebody re-added a rule the owner removed.
{
  const pb = require("fs").readFileSync(path.join(__dirname, "..", "features", "playback.js"), "utf8");
  const code = pb.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  ok(!/BotRuntime/.test(code),
    "D: `features/playback.js` special-cases the bot NOWHERE. The bot is the owner: it advances, "
    + "it reports lengths, and at the top rung it acts first — which is the point rather than the "
    + "problem");
}

for (const t of STARTED) { try { t.stop(); } catch (e) {} }

if (failed) process.exit(1);
console.log("[bot-view] PASS — the bot is the owner, and the single difference is that it does not "
  + "LOAD the media while its device-local view is off. Driven on all four combinations of "
  + "(am I the bot) x (is the view on), so the rule cannot fire on bot-ness alone and darken a "
  + "human owner at the same level, nor on the setting alone and darken everybody. The default is "
  + "read from the real prefs module rather than restated, with a control proving it can be turned "
  + "on. The load site is asserted to ASK, because a correct answer nobody calls is this project's "
  + "most-repeated shape. And `playback.js` holds no bot rule at all: everything the deleted rules "
  + "bought falls out of having no player — no duration so no length report and no wall-clock "
  + "advance, and no `onError` so no `ddjp.play.blocked`, which matters because blocked reports "
  + "feed the auto-skip roads (" + A + " assertions)");
