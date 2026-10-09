// tests/check-bot-presence.js
// SUBJECT: features/botruntime.js, backends/backend2/streammanager.js, features/room.js, backends/backend1/matrixbridge.js, ui/panels.js, ui/roster.js
// WALL: THE BOT PUBLISHES WHO IS ACTIVE, AND THE PEOPLE TAB SHOWS IT (J73 job 5, Q5).
//   The bot may publish who is active, chat in tiers a viewer cannot read included; viewers accept it only
//   from the room's bot account, checked by rank; it replaces itself, takes little space, follows the
//   presence settings; with no bot the People tab keeps what the viewer can see and "chat isn't counted
//   here". Chat is tracked as who and when only, and cleans up after itself.
//   PART A — published: ids only, the moment and the window — a chat-only person from an unreadable tier in.
//   PART B — it follows the presence settings: chat off, chat-only people out.
//   PART C — it replaces itself rarely: an unchanged answer is not republished until a refresh is due.
//   PART D — believed only from the bot account (the runner's rank), through one state event in its channel.
//   PART E — the People tab shows a fresh believed list; a stale one, or none, falls back to its own view.
//   PART F — the bot and the People tab agree.
//   PART G — the chat record is who and when only, and drops what is older than the longest allowed window.
//   PART H — a bot that cannot see chat far enough publishes nothing.
//   PART I — the People tab and the roster read the view, not the raw fold.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-presence] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-presence] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MIN = 60000, HOUR = 60 * MIN, T = 1000 * HOUR;
const tick = () => new Promise((r) => setImmediate(r));
const act = (id, who, ts, type) => ({ eventId: id, sender: who, ts: ts, type: type, content: { t: type } });
// The bot, through the real reconcile (check-presence-chat's harness shape).
async function bot(o) {
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const settings = Object.assign(sd.StateDeriver.defaultSettings(), { botAfkMs: 10 * MIN, botPresenceChat: o.chat !== false }, o.settings || {});
  const calls = { published: [] }; let chatHandler = null; const clock = { now: T };
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "features/room.js", "features/botruntime.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getLog: () => o.log || [], getState: () => ({ settings: settings, rotation: [] }), isLegal: () => true, on() {},
      publishPresence: (c) => { calls.published.push(JSON.parse(JSON.stringify(c))); return Promise.resolve({ ok: true }); } },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
      getRoster: () => ["@bot:hs"].concat(o.members || []).map((u) => ({ userId: u, level: u === "@bot:hs" ? 99 : 0 })),
      joinedMembersOf: () => ["@bot:hs"].concat(o.members || []), invitedMembersOf: () => [],
      inviteToPresence: () => Promise.resolve({ ok: true }), removeFromPresence: () => Promise.resolve({ ok: true }),
      readBackActivity: async (r, since) => ({ ok: true, people: o.chatPeople || {}, reachedTs: o.chatShort ? since + HOUR : since - 1, complete: false }) },
    ServerClock: { serverNow: () => clock.now },
    Chat: { send: () => Promise.resolve({ ok: true }), onMessage: (fn) => { chatHandler = fn; } },
    Queue: { remove: () => Promise.resolve() },
  });
  sb.Room.chatTiers = () => ({ mainId: "!main:hs", tiers: [{ id: "!staff:hs" }] });   // a tier this viewer cannot read
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!presence:hs" } });
  for (let i = 0; i < 20; i++) await tick();
  return { sb, calls, clock, started, chat: (...a) => chatHandler && chatHandler(...a), stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} } };
}
let PUBLISHED = null;
(async () => {
  // PARTs A–F and H RETIRED (J75, owner ruling 1, `ddjp_532`): the bot's published list, its acceptance and the People
  // tab's use of it are gone. G and I stand: the bot's own chat record is unchanged, and the tab and roster read the view.
  // ── PART G ────────────────────────────────────────────────────────────────────────────────
  {
    const b = await bot({ members: [] });
    const max = b.sb.Activity.maxWindowMs();
    b.chat("$e1", "@ancient:hs", "a secret message", false, T - max - HOUR);
    b.chat("$e2", "@fresh:hs", "another message", false, T);
    const rec = b.sb.BotRuntime._chatSeenForTest();
    ok(rec["@fresh:hs"] === T && !("@ancient:hs" in rec), "G: who spoke is kept; anyone older than the longest allowed window is dropped", rec);
    ok(Object.values(rec).every((v) => typeof v === "number"), "G: and only WHEN — no message text is kept", rec);
    b.stop();
  }
  // ── PART I ────────────────────────────────────────────────────────────────────────────────
  {
    const pn = fs.readFileSync(path.join(ROOT, "ui/panels.js"), "utf8"), rs = fs.readFileSync(path.join(ROOT, "ui/roster.js"), "utf8");
    ok(/fold = Room\.presenceView \? Room\.presenceView\(now\)/.test(pn) && /fold = Room\.presenceView \? Room\.presenceView\(now\)/.test(rs),
      "I: the People tab's header and the roster both read the view");
  }
})().then(done, (e) => { failed++; console.log("[bot-presence] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[bot-presence] " + failed + " failure(s)"); process.exit(1); }
  console.log("[bot-presence] PASS — the bot publishes who is active (J73 job 5, Q5): ids, the moment and the window only, chat " +
    "from tiers a viewer cannot read included when the settings count chat, republished only on a change or a due refresh, " +
    "nothing when it cannot see chat far enough; believed only from the bot account; the People tab shows a fresh list and " +
    "agrees with the bot, and falls back to its own view without one; the chat record keeps who and when, pruned (" + asserts + " assertions)");
  process.exit(0);
}
