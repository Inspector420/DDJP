// tools/probes/probe-warn-unsent.js
// QUESTION: if the warning never reaches the person, does the sweep still remove them?
//
// `check-idle-sweep.js` stubs `Chat.send` as always returning `{ ok: true }` (its `tree()` helper,
// line 67, and PART D's own context). Production `Chat.send` refuses in five distinct ways —
// `no-room`, `empty`, `no-crypto`, `send-failed`, `forbidden` — and the chat tiers are E2E
// encrypted, so `no-crypto` is an ordinary state for a client whose crypto has not come up.
//
// Run: node tools/probes/probe-warn-unsent.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const MIN = 60000;
const T = 10000000;
const act = (id, who, ts, type) => ({ eventId: id, sender: who, ts: ts, type: type });

// Build the same room the guard builds, but let the caller decide what Chat.send answers.
function room(chatSendResult) {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  settings.queueIdleMs = 15 * MIN;
  settings.botPingMs = 10 * MIN;

  let log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@idle:hs", pending: [] }];
  const sent = { chat: [], removed: [] };
  let NOW = T;

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getLog: () => log,
      getState: () => ({ settings: settings, rotation: rot }),
      isLegal: () => true, on() {},
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
      getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
    },
    ServerClock: { serverNow: () => NOW },
    // THE ONE DIFFERENCE FROM THE GUARD.
    Chat: { send: (t) => { sent.chat.push(t); return Promise.resolve(chatSendResult); } },
    Queue: { remove: (u) => { sent.removed.push(u); return Promise.resolve(); } },
  });
  sb.BotRuntime.start({ roomId: "!r:hs" });
  return {
    RT: sb.BotRuntime, sent: sent,
    advance: (ms) => { NOW = T + ms; },
    stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} },
  };
}

function run(label, result) {
  const r = room(result);
  const first = r.RT.sweepIdle();
  r.advance(11 * MIN);                 // past botPingMs
  const second = r.RT.sweepIdle();
  r.stop();
  console.log("  " + label);
  console.log("    reported warned : " + JSON.stringify(first.warned));
  console.log("    Chat.send answer: " + JSON.stringify(result));
  console.log("    REMOVED         : " + JSON.stringify(second.removed));
  console.log("    reached Queue   : " + JSON.stringify(r.sent.removed));
  return second.removed.length;
}

console.log("\nDoes a warning that was never delivered still lead to a removal?\n");
const okCase = run("Chat.send -> { ok: true }   (what the guard supplies)", { ok: true });
console.log("");
const noCrypto = run("Chat.send -> { ok: false, reason: 'no-crypto' }   (production, E2E not up)",
  { ok: false, reason: "no-crypto" });
console.log("");
const noRoom = run("Chat.send -> { ok: false, reason: 'no-room' }   (production, chat not init'd)",
  { ok: false, reason: "no-room" });

console.log("\n---");
console.log("removed when the warning LANDED    : " + okCase);
console.log("removed when the warning NEVER SENT: " + noCrypto + " (no-crypto), " + noRoom + " (no-room)");
console.log(noCrypto === okCase && noRoom === okCase
  ? "\nSAME OUTCOME. The sweep does not distinguish a delivered warning from an undelivered one."
  : "\nDIFFERENT. The send result changes the outcome.");
