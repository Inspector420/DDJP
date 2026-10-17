// tools/probes/probe-rewarn-after-return.js
// QUESTION: somebody is warned, comes back, then goes quiet AGAIN. Are they warned a second time
// before being removed, or does the first warning still count against them?
//
// PART D of `check-idle-sweep.js` drives the person coming back and STAYING back. It never drives
// them going idle a second time, so the line that clears the pending mark is never load-bearing
// in the guard: deleting `delete _pending[who]` from the not-overdue branch leaves the whole
// suite green.
//
// Run: node tools/probes/probe-rewarn-after-return.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const MIN = 60000;
const T = 10000000;
const act = (id, who, ts, type) => ({ eventId: id, sender: who, ts: ts, type: type });

function room() {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  settings.queueIdleMs = 15 * MIN;
  settings.botPingMs = 10 * MIN;

  let log = [act("$1", "@p:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@p:hs", pending: [] }];
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
      getLog: () => log, getState: () => ({ settings: settings, rotation: rot }),
      isLegal: () => true, on() {},
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
      getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
    },
    ServerClock: { serverNow: () => NOW },
    Chat: { send: (t) => { sent.chat.push(t); return Promise.resolve({ ok: true }); } },
    Queue: { remove: (u) => { sent.removed.push(u); return Promise.resolve(); } },
  });
  sb.BotRuntime.start({ roomId: "!r:hs" });
  return {
    RT: sb.BotRuntime, sent: sent,
    at: (ms) => { NOW = T + ms; },
    comeBack: (ms) => { log = log.concat([act("$back", "@p:hs", T + ms, "ddjp.dj.skip")]); },
    stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} },
  };
}

const r = room();
const timeline = [];

// 1. They are idle. First sweep warns.
let s = r.RT.sweepIdle();
timeline.push(["T+0     first sweep", "warned=" + JSON.stringify(s.warned) + " removed=" + JSON.stringify(s.removed)]);

// 2. They come back one minute later. The warning worked.
r.comeBack(1 * MIN);
r.at(2 * MIN);
s = r.RT.sweepIdle();
timeline.push(["T+2min  they acted   ", "warned=" + JSON.stringify(s.warned) + " removed=" + JSON.stringify(s.removed)]);

// 3. They then go quiet again and drift past the idle window with NO new sweep in between.
r.at(30 * MIN);
s = r.RT.sweepIdle();
timeline.push(["T+30min quiet again  ", "warned=" + JSON.stringify(s.warned) + " removed=" + JSON.stringify(s.removed)]);

r.stop();

console.log("\nWarned -> came back -> went quiet again. What happens on the next sweep?\n");
for (const [k, v] of timeline) console.log("  " + k + "  " + v);
console.log("\n  total warnings sent to chat: " + r.sent.chat.length);
console.log("  removals that reached Queue: " + JSON.stringify(r.sent.removed));
console.log("\n  EXPECTED (two-stage): the third sweep WARNS afresh and removes nobody,");
console.log("  because the earlier warning was answered and is spent.");
console.log(r.sent.removed.length === 0
  ? "\n  -> two-stage held: they were warned again, not removed."
  : "\n  -> REMOVED WITHOUT A FRESH WARNING. The answered warning was still counted against them.");
