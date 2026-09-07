// tools/probes/probe-bot-settings-end-to-end.js
// QUESTION: does a live staff request actually put a `ddjp.room.settings` EVENT ON THE WIRE?
//
// The previous probe stubbed `authorSettings`, so it proved the chain as far as the closure and
// nothing past it. Everything downstream — `Room.setSettings`, its owner gate, the channel
// lookup, `MatrixBridge.sendEvent` — was unverified. The owner reports the bot still does not post
// settings, so this drives the WHOLE path and captures what reaches the transport.
//
// Run: node tools/probes/probe-bot-settings-end-to-end.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const STAFF = 60, BOT = 99;

const sd = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
], { Date, Math, JSON });

const settings = sd.StateDeriver.defaultSettings();
settings.maxLen = 600;
settings.botDelegation = { maxLen: "staff", bg: "staff" };   // the reported room

const CHANNELS = {
  events_owner: "!eo:hs", events_staff: "!es:hs",
  settings_owner: "!so:hs", chat_uncategorized: "!cu:hs",
};

const sent = [];        // everything that reaches the transport
const logs = [];
let listener = null;

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "features/room.js", "features/botsettings.js",
  "features/botruntime.js",
], {
  Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {}, document: { body: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  ChatPrefs: { chatTier: () => null, onChange() {}, botView: () => false },
  Chat: { setRoom() {}, setReadableTiers() {}, init() {}, dmInit() {},
          send: () => Promise.resolve({ ok: true }) },
  Queue: { remove: () => Promise.resolve() },
  ServerClock: { serverNow: () => 1000000 },
  StreamManager: {
    getState: () => ({ settings: settings, rotation: [] }),
    getLog: () => [], isLegal: () => true, on() {},
    settingRanges: () => {
      const src = sd.StateDeriver.SETTING_RANGES || {}, o = {};
      for (const k in src) {
        const r = src[k] || {}, c = {};
        for (const f in r) c[f] = (typeof r[f] === "function") ? r[f]() : r[f];
        o[k] = c;
      }
      return o;
    },
  },
  MatrixBridge: {
    getUserId: () => "@bot:hs",
    // THE GATE `setSettings` ACTUALLY ASKS. Channel-tier rank, which is 99 for the bot.
    getMyRank: () => BOT,
    getMyPowerLevel: () => BOT, getUserEffectiveRank: () => BOT, getRoster: () => [],
    rankLadder: () => sd.Ranks.LADDER,
    onRawEvent: (fn) => { listener = fn; }, offRawEvent: () => { listener = null; },
    eventsKeyForLevel: (l) => "events_" + (l >= 99 ? "owner" : "staff"),
    channelTaxonomy: () => [], presenceChatKey: () => "presence_chat",
    amJoined: () => false, spaceChildLevel: () => 100,
    // THE WIRE. Nothing past here is stubbed away.
    sendEvent: (ch, type, content) => { sent.push({ ch, type, content }); return Promise.resolve(); },
    setSpaceJoinRule: () => Promise.resolve(),
  },
});

const realWarn = sb.Logger.warn, realErr = sb.Logger.error;
sb.Logger.warn = (m) => { logs.push("WARN " + m); if (realWarn) realWarn(m); };
sb.Logger.error = (m) => { logs.push("ERROR " + m); if (realErr) realErr(m); };

sb.Room._setCurrentForTest({ spaceId: "!space:hs", channels: CHANNELS });
sb.Room.rankLadder = () => sd.Ranks.LADDER;

const started = sb.BotRuntime.start({
  roomId: "!space:hs",
  channels: CHANNELS,
  // THE REAL CLOSURE, the same wrapper `_evaluateBot` builds — not a recorder.
  authorSettings: async (partial) => {
    const r = await sb.Room.setSettings(partial);
    if (!r || !r.ok) throw new Error("settings write did not land" + (r && r.reason ? " (" + r.reason + ")" : ""));
    return r;
  },
});

console.log("\nBotRuntime.start ->", JSON.stringify(started));
console.log("maxLen before:", settings.maxLen);

// The envelope the transport really builds, including the fields it stamps from the parsed body.
const payload = { k: "maxLen", v: 601, t: "ddjp.bot.request", l: 20, dv: 2, hv: 1 };
listener({
  event_id: "$req", type: "m.room.message", sender: "@inspectorp:hs", room_id: CHANNELS.events_staff,
  ts: 1, content: { msgtype: "m.text", body: JSON.stringify(payload) },
  l: 20, ddjpType: "ddjp.bot.request", ddjpBody: payload, senderRank: STAFF,
}, null, null);

setTimeout(() => {
  console.log("\n--- what reached the TRANSPORT ---");
  if (!sent.length) console.log("   (nothing)");
  for (const e of sent) {
    console.log("   channel=" + e.ch + "  type=" + e.type
      + "  maxLen=" + (e.content && e.content.s ? e.content.s.maxLen : "?"));
  }
  console.log("\n--- what the bot logged ---");
  console.log(logs.length ? logs.map((l) => "   " + l).join("\n") : "   (nothing)");
  console.log("\n   bot status:", JSON.stringify(sb.BotRuntime.status()));
  const ok = sent.some((e) => e.type === "ddjp.room.settings"
    && e.content && e.content.s && e.content.s.maxLen === 601);
  console.log("\n   " + (ok
    ? "A ddjp.room.settings event carrying maxLen=601 REACHED THE WIRE."
    : "NO settings event reached the wire."));
  try { sb.BotRuntime.stop(); } catch (e) {}
}, 30);
