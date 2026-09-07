// tools/probes/probe-idle-never-acted.js
// QUESTION: somebody joins the queue, plays songs from a playlist, and does NOTHING deliberate.
// Are they ever warned?
//
// REPORTED FROM A LIVE ROOM: both AFK windows set to 2 minutes, and after 3 minutes there was no
// ping and no bot action at all.
//
// `idleFor` answers `known: false` when it finds NO qualifying act for that person anywhere in the
// log, and `sweepIdle` skips anyone whose idleness is unknown. But "did nothing" is exactly the
// state the AFK rule exists to catch — and once buffer top-ups stopped counting, a person with a
// playlist has no qualifying acts at all.
//
// `idleFor` already returns `reachMs` — how far back this client can see — which is the field that
// separates "I cannot tell" from "I can see far enough and there is nothing". NOTHING READS IT.
//
// Run: node tools/probes/probe-idle-never-acted.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const MIN = 60000;
const T = 10000000;
const ev = (id, who, ts, type, content) => ({
  eventId: id, sender: who, ts: ts, type: type,
  content: content || { t: type },
});

function room(log) {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  settings.queueIdleMs = 2 * MIN;      // the owner's setting
  settings.botPingMs = 2 * MIN;
  const state = { settings: settings, rotation: [{ user: "@dj:hs", pending: [] }] };

  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ChatPrefs: { chatTier: () => null, onChange() {} },
    Chat: { setRoom() {}, setReadableTiers() {}, init() {}, dmInit() {} },
    StreamManager: {
      getState: () => state, getLog: () => log, isLegal: () => true, on() {},
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
      channelTaxonomy: () => [], eventsKeyForLevel: () => "events_uncategorized",
      presenceChatKey: () => "presence_chat", amJoined: () => false,
    },
  });
}

console.log("\nqueueIdleMs = 2 minutes. Now is T. What does `idleFor` say about @dj:hs?\n");

const CASES = [
  ["joined 40 min ago, nothing since (a real deliberate act)",
   [ev("$j", "@dj:hs", T - 40 * MIN, "ddjp.dj.join", { t: "ddjp.dj.join" })]],

  ["a playlist cycling: only auto acts, ever",
   [ev("$p1", "@dj:hs", T - 30 * MIN, "ddjp.dj.play", { t: "ddjp.dj.play" }),
    ev("$s1", "@dj:hs", T - 30 * MIN, "ddjp.dj.join", { t: "ddjp.dj.join", v: "abc" }),
    ev("$l1", "@dj:hs", T - 29 * MIN, "ddjp.play.len", { t: "ddjp.play.len" }),
    ev("$p2", "@dj:hs", T - 20 * MIN, "ddjp.dj.play", { t: "ddjp.dj.play" }),
    ev("$s2", "@dj:hs", T - 20 * MIN, "ddjp.dj.join", { t: "ddjp.dj.join", v: "def" }),
    ev("$l2", "@dj:hs", T - 19 * MIN, "ddjp.play.len", { t: "ddjp.play.len" })]],

  ["nothing from them at all, but the log reaches back 40 min",
   [ev("$o", "@other:hs", T - 40 * MIN, "ddjp.dj.join", { t: "ddjp.dj.join" })]],

  ["genuinely unknowable: the log only reaches back 30 SECONDS",
   [ev("$o", "@other:hs", T - 30000, "ddjp.dj.join", { t: "ddjp.dj.join" })]],
];

for (const [label, log] of CASES) {
  const sb = room(log);
  const r = sb.Room.idleFor("@dj:hs", T);
  const verdict = !r ? "null"
    : (r.known === true
        ? ("known, idle " + Math.round(r.idleMs / 1000) + "s, overdue=" + r.overdue)
        : ("KNOWN=FALSE  -> sweepIdle SKIPS them   (reach " + Math.round(r.reachMs / 1000) + "s)"));
  console.log("  " + label);
  console.log("      " + verdict + "\n");
}

console.log("`reachMs` is the field that tells the last two apart, and nothing reads it.");
