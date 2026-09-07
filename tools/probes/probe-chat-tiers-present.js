// tools/probes/probe-chat-tiers-present.js
// QUESTION: which tiers does the strip offer, in what order, and does the presence channel appear
// only when this client can actually read it?
//
// `presence-chat` is an encrypted chat channel like the other three; only its MEMBERSHIP rule
// differs — the bot adds and removes people by the room's activity rule rather than by rank. So
// for this one tier "the channel exists" and "I can read it" are different questions, and offering
// a tier that opens an empty view is the defect the rank filter was added to fix.
//
// Run: node tools/probes/probe-chat-tiers-present.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

function room(opts) {
  const o = opts || {};
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();

  // Every channel a fully-upgraded room has, minus anything the case removes.
  const bridge = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"],
    { EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} } });
  const tax = bridge.MatrixBridge.channelTaxonomy();
  const channels = {};
  for (const c of tax) {
    if (o.without && o.without.indexOf(c.key) >= 0) continue;
    channels[c.key] = "!" + c.key + ":hs";
  }

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getState: () => ({ settings: settings }), getLog: () => [], isLegal: () => true, on() {} },
    ChatPrefs: { chatTier: () => null, onChange() {} },
    Chat: { setReadableTiers() {}, setRoom() {} },
    MatrixBridge: {
      channelTaxonomy: () => tax,
      eventsKeyForLevel: (lvl) => bridge.MatrixBridge.eventsKeyForLevel(lvl),
      presenceChatKey: () => bridge.MatrixBridge.presenceChatKey(),
      // THE ONE VARIABLE: am I in the presence room?
      amJoined: (id) => (id === channels[bridge.MatrixBridge.presenceChatKey()]
        ? o.joinedPresence !== false : true),
      getUserId: () => "@me:hs", getMyRank: () => 99, getMyPowerLevel: () => 99,
      getUserEffectiveRank: () => 99, onRawEvent() {}, offRawEvent() {},
    },
  });
  sb.Room._setCurrentForTest({ spaceId: "!s:hs", channels: channels });
  return { sb, channels };
}

const show = (label, res) => {
  const t = (res.tiers || []).map((x) => x.tier + (x.main ? "*" : ""));
  console.log("  " + label.padEnd(46) + JSON.stringify(t));
};

console.log("\nWhich tiers are offered, and in what order?  (* = the room's main tier)\n");
show("everything, and I am IN the presence channel", room({}).sb.Room.chatTiers());
show("everything, but I am NOT in it", room({ joinedPresence: false }).sb.Room.chatTiers());
show("presence channel does not exist at all",
  room({ without: ["presence_chat"] }).sb.Room.chatTiers());
show("no staff chat yet (batch 3 not run)",
  room({ without: ["chat_staff", "presence_chat"] }).sb.Room.chatTiers());

console.log("\n  Order is by the ladder level the channel table gives, with presence pinned last —");
console.log("  its level 0 is a WRITE gate, not a rank, so sorting it as the widest audience");
console.log("  would put it first.");
