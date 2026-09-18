// tools/probes/probe-bot-owner-ui.js
// QUESTION: which controls does the app OFFER an account at the bot's level that it would also
// offer a human owner — and of those, which can the account actually carry out?
//
// The bot sits on the ladder's top rung (99). `atLeast(level, "owner")` is true at 99 AND 100, so
// every owner-gated act reads as permitted for it. The homeserver does not agree: `_powerLevels`
// pins `m.space.child`/`m.space.parent` at 100, so the one account the app calls "owner" at 99 is
// refused the write.
//
// Run: node tools/probes/probe-bot-owner-ui.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const BOT_LEVEL = 99;      // the ladder's top rung — what BotRuntime.botLevel() returns
const HUMAN_OWNER = 100;   // the space creator, per _powerLevels(100, creatorId, true)

function treeAt(level) {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  const state = { settings: settings, rotation: [], queue: [], playing: null, ranks: {} };

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/actions.js",
    "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getState: () => state, getLog: () => [], isLegal: () => true, on() {} },
    Room: {
      getMyAuthorityLevel: () => level,
      getMyRank: () => 99,
      getMyId: () => (level === BOT_LEVEL ? "@bot:hs" : "@owner:hs"),
      getCurrent: () => ({ spaceId: "!s:hs", channels: {} }),
    },
    MatrixBridge: {
      getUserId: () => (level === BOT_LEVEL ? "@bot:hs" : "@owner:hs"),
      getMyPowerLevel: () => level,
      spaceChildLevel: () => 100,
      getUserEffectiveRank: () => level,
      getRoster: () => [], onRawEvent() {}, offRawEvent() {},
    },
    ServerClock: { serverNow: () => 1000000 },
    Queue: { remove: () => Promise.resolve() }, RoomUpgrade: {},
    Chat: { send: () => Promise.resolve({ ok: true }) }, Reactions: {}, Skip: {},
  });
  // `features/room.js` DEFINES `Room`, replacing the stub passed in above — so the authority
  // level has to be re-pointed AFTER the load, on every tree. Doing it on only one of them made
  // the human-owner column read 0 and refuse everything, which printed as the fix working
  // backwards.
  sb.Room.getMyAuthorityLevel = () => level;
  sb.Room.getMyId = () => (level === BOT_LEVEL ? "@bot:hs" : "@owner:hs");
  sb.Room.getCurrent = () => ({ spaceId: "!s:hs", channels: {} });
  return sb;
}

const bot = treeAt(BOT_LEVEL);
// RUNNING AS THE BOT is what the display rule keys on. Holding level 99 is not the same thing — a
// human owner may hold it — so the probe has to start the runtime to see what the bot sees.
const _started = (() => { try { return bot.BotRuntime.start({ roomId: "!r:hs" }); }
  catch (e) { return { ok: false, reason: "threw: " + e.message }; } })();
console.log("\n  BotRuntime.start ->", JSON.stringify(_started), " actingAsBot:", bot.BotRuntime.actingAsBot());
process.on("exit", () => { try { bot.BotRuntime.stop(); } catch (e) {} });
const own = treeAt(HUMAN_OWNER);
const ranks = bot.Ranks;
const acts = bot.Actions.ACTIONS.slice().sort();

console.log("\nWhat the app OFFERS, at the bot's level (99) and a human owner's (100):\n");
console.log("  act                gate        bot(99)   owner(100)");
console.log("  " + "-".repeat(56));

const ownerGated = [];
const sameForBoth = [];
for (const a of acts) {
  const g = ranks.gateFor ? ranks.gateFor(a) : (ranks.GATES || {})[a];
  const b = bot.Actions.describe(a, { userId: "@x:hs", targetRank: 0, retryAt: 0 });
  const o = own.Actions.describe(a, { userId: "@x:hs", targetRank: 0, retryAt: 0 });
  const mark = (d) => (d.enabled ? "OFFERED" : "  --   ");
  console.log("  " + a.padEnd(18) + String(g || "-").padEnd(12)
    + mark(b).padEnd(10) + mark(o));
  if (g === "owner") ownerGated.push(a);
  if (b.enabled === o.enabled) sameForBoth.push(a);
}

console.log("\n  owner-gated acts: " + JSON.stringify(ownerGated));
console.log("  identical for bot and human owner: " + sameForBoth.length + " of " + acts.length);

// ── THE ONE ACT WITH A SECOND, STRICTER ENFORCER ────────────────────────────────────────────
// `room.upgrade` is refused by `RoomUpgrade._mayUpgrade` when the level is below the space-child
// requirement. That check is the ENFORCEMENT and it is right. The question is whether the DISPLAY
// asks the same question.
console.log("\n---");
console.log("Enforcement vs display for room.upgrade:\n");
for (const [label, lvl, ctx] of [["bot", BOT_LEVEL, bot], ["human owner", HUMAN_OWNER, own]]) {
  const offered = ctx.Actions.describe("room.upgrade", { retryAt: 0 }).enabled;
  // What RoomUpgrade._mayUpgrade would conclude, recomputed from its two inputs.
  const permittedByRank = ctx.Capabilities.atLeast(lvl, "owner");
  const meetsSpaceWrite = lvl >= 100;
  const canActuallyDo = permittedByRank && meetsSpaceWrite;
  console.log("  " + label.padEnd(13) + "level " + lvl
    + " | display offers: " + (offered ? "YES" : "no ")
    + " | can actually perform: " + (canActuallyDo ? "YES" : "no "));
  if (offered && !canActuallyDo) {
    console.log("                -> OFFERED AN ACT IT CANNOT CARRY OUT.");
  }
}
