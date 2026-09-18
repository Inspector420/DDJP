// tools/probes/probe-bot-request-live.js
// QUESTION: when a staff member sends `ddjp.bot.request` WHILE the bot is running, does the
// setting actually change — and what happens to a request that was already in the log?
//
// Reported from a live room: an owner delegated `maxLen` to staff, staff sent two requests, and
// nothing changed. Three requests sit in the log at l=20, l=21, l=22 and the settings never moved.
//
// Run: node tools/probes/probe-bot-request-live.js
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));

const OWNER = 99, STAFF = 60;

function room() {
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  settings.maxLen = 600;
  settings.botDelegation = { maxLen: "staff", bg: "staff" };   // exactly the reported room

  const written = [];
  let listener = null;

  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botsettings.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getState: () => ({ settings: settings, rotation: [] }),
      getLog: () => [], isLegal: () => true, on() {},
      settingRanges: () => {
        const src = sd.StateDeriver.SETTING_RANGES || {}; const o = {};
        for (const k in src) {
          const r = src[k] || {}, c = {};
          for (const f in r) c[f] = (typeof r[f] === "function") ? r[f]() : r[f];
          o[k] = c;
        }
        return o;
      },
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => OWNER, getMyPowerLevel: () => OWNER,
      getUserEffectiveRank: () => OWNER, getRoster: () => [],
      // THE SUBSCRIPTION THE BOT USES. Only the LIVE timeline path fires this in production.
      onRawEvent: (fn) => { listener = fn; }, offRawEvent: () => { listener = null; },
      eventsKeyForLevel: (l) => "events-" + l, sendEvent: () => Promise.resolve(),
      spaceChildLevel: () => 100,
    },
    ServerClock: { serverNow: () => 1000000 },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
    ChatPrefs: { botView: () => false },
    // `botLevel()` reads the ladder through Room. The real one comes from the rank table; the
    // probe supplies the same shape so the bot can start at all.
    Room: { rankLadder: () => sd.Ranks.LADDER, getMyAuthorityLevel: () => OWNER,
            getMyId: () => "@bot:hs", getCurrent: () => ({ spaceId: "!s:hs", channels: {} }) },
  });

  const r = sb.BotRuntime.start({
    roomId: "!r:hs",
    channels: { events_staff: "!es:hs", events_owner: "!eo:hs" },
    // The real closure Room hands the bot: writes settings, throws when the write did not land.
    authorSettings: async (partial) => {
      written.push(partial);
      Object.assign(settings, partial);
      return { ok: true };
    },
  });
  // BUILD `raw` THE WAY `matrixbridge.js` BUILDS IT, from a Matrix envelope — including the
  // `ddjpType`/`ddjpBody` it stamps from the parsed body. Firing a hand-made object with the
  // field names the READER wants is what made the first version of this probe report a working
  // feature over a broken one.
  const asTransportWould = (env) => {
    const content = env.content || {};
    let parsedType = null, parsedBody = null;
    if (env.type === "m.room.message" && content.body) {
      try {
        const parsed = JSON.parse(content.body);
        if (typeof parsed.t === "string") parsedType = parsed.t;
        if (parsed && typeof parsed === "object") parsedBody = parsed;
      } catch (e) {}
    }
    return { event_id: "$e", type: env.type, sender: env.sender, room_id: "!es:hs",
             ts: 1, content: content, l: (parsedBody && parsedBody.l) || 0,
             ddjpType: parsedType, ddjpBody: parsedBody, senderRank: env.senderRank };
  };
  return { sb, r, written, fire: (env) => { if (listener) listener(asTransportWould(env), null, null); },
           hasListener: () => !!listener, settings: settings };
}

const t = room();
console.log("\nBotRuntime.start ->", JSON.stringify(t.r));
console.log("a raw-event listener was registered:", t.hasListener());
console.log("maxLen before:", t.settings.maxLen, " delegation:", JSON.stringify(t.settings.botDelegation));

// A LIVE request from staff, shaped THE WAY THE TRANSPORT ACTUALLY BUILDS IT.
//
// THE FIRST VERSION OF THIS PROBE PASSED `type: "ddjp.bot.request"` AND REPORTED THE FEATURE
// WORKING. That is not a shape the transport can produce. DDJP events go on the wire as
// `m.room.message` with the ddjp type inside the JSON body as `t` — `matrixbridge.js` parses it
// into a local `parsedType` and builds `raw` with `type: event.getType()`, so every subscriber
// sees `m.room.message`. Supplying the shape the reader expects rather than the one its caller
// emits is the exact defect class this project catalogues, committed in the probe written to
// verify the feature.
t.fire({
  type: "m.room.message",                  // what event.getType() returns
  sender: "@inspectorp:hs",
  senderRank: STAFF,                       // stamped by the transport from CHANNEL ORIGIN
  content: { msgtype: "m.text",
             body: JSON.stringify({ k: "maxLen", v: 601, t: "ddjp.bot.request", l: 20, dv: 2, hv: 1 }) },
});

setTimeout(() => {
  console.log("\nafter a LIVE staff request { k: maxLen, v: 601 }:");
  console.log("   writes reaching authorSettings:", JSON.stringify(t.written));
  console.log("   maxLen now:", t.settings.maxLen);
  console.log("   bot status:", JSON.stringify(t.sb.BotRuntime.status()));

  // AND THE CASE THE ROOM ACTUALLY HIT: no senderRank, which is what a request reaches the
  // handler with if it did not arrive stamped from a channel.
  const before = t.settings.maxLen;
  t.fire({ type: "m.room.message", sender: "@inspectorp:hs",
           content: { msgtype: "m.text",
                      body: JSON.stringify({ k: "maxLen", v: 777, t: "ddjp.bot.request" }) } });
  setTimeout(() => {
    console.log("\nafter a request with NO senderRank stamped:");
    console.log("   maxLen:", t.settings.maxLen, before === t.settings.maxLen ? "(unchanged)" : "(CHANGED)");
    console.log("   status:", JSON.stringify(t.sb.BotRuntime.status()));
    try { t.sb.BotRuntime.stop(); } catch (e) {}
  }, 20);
}, 20);
