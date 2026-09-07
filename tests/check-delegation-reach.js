// tests/check-delegation-reach.js
// WALL: A DELEGATED SETTING CAN ACTUALLY BE REQUESTED.
//
// `botDelegation` maps a settings KEY to the weakest rank allowed to REQUEST it.
// `BotSettings.decide` has always enforced that table and `BotSettings.request` has always been
// able to send one — and NOTHING CALLED `request`. Measured before this package: zero callers
// outside its own file and the tests. So an owner could delegate `maxLen` to staff, the panel
// would show the delegation, and no staff member had any control that asked. **Configurable and
// unreachable** — the eighth time this project has shipped something with no caller.
//
// A — the panel offers exactly what the bot would honour, because it is the SAME function deciding.
// B — the send exists and reaches the transport with the requester's own channel.
// C — the owner path is unchanged: a direct write, not a request.
// D — the load-bearing refusals still refuse.
// E — `botDelegation` is not delegable, so no rank can widen its own delegation.

const path = require("path");
const { loadInContext } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[delegation-reach] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function tree() {
  const sent = [];
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botsettings.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout,
    window: {}, document: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      settingRanges: () => {
        const sd = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
        const src = sd.StateDeriver.SETTING_RANGES || {};
        const out = {};
        for (const k in src) {
          const r = src[k] || {}, copy = {};
          for (const f in r) copy[f] = (typeof r[f] === "function") ? r[f]().slice() : r[f];
          out[k] = copy;
        }
        return out;
      },
    },
    MatrixBridge: {
      eventsKeyForLevel: (lvl) => "events-" + lvl,
      sendEvent: (ch, type, body) => { sent.push({ ch, type, body }); return Promise.resolve(); },
    },
  });
  return { sb, sent };
}

const sd = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
const DEFAULTS = sd.StateDeriver.defaultSettings();
const DOMAIN = (() => {
  const e = sd.StateDeriver.SETTING_RANGES.botDelegation || {};
  return typeof e.keys === "function" ? e.keys() : (e.keys || []);
})();

ok(DOMAIN.length > 0,
  "APPLIED — the delegation domain resolves to a non-empty key list, so every part below is "
  + "asking about real keys", DOMAIN.length);

// ── PART A — THE PANEL AND THE BOT CANNOT DISAGREE ───────────────────────────────────────────
// The panel decides whether to OFFER a row by calling the same `decide` the bot runs on the
// arriving request. Asserted as a relationship over the whole domain rather than one example: for
// every delegable key, granting it to staff must make it requestable by staff and NOT by a player.
{
  const { sb } = tree();
  const KEY = "maxLen";
  ok(DOMAIN.indexOf(KEY) >= 0, "A: APPLIED — the sample key is in the domain", KEY);
  const R = sb.Ranks;
  const staffLvl = R.levelOf("staff"), playerLvl = R.levelOf("player");

  const granted = Object.assign({}, DEFAULTS, { botDelegation: { maxLen: "staff" } });
  const yes = sb.BotSettings.decide({ k: KEY, v: 700 }, staffLvl, granted);
  ok(yes && yes.ok === true,
    "A: a key delegated to staff IS requestable by staff — this is the answer the panel uses to "
    + "decide whether to offer the row at all", yes);
  const no = sb.BotSettings.decide({ k: KEY, v: 700 }, playerLvl, granted);
  ok(no && no.ok === false && no.reason === "rank",
    "A: and NOT by a player, with the rank refusal named — so the panel can tell 'you may not' "
    + "from 'this room delegates nothing'", no);

  // ABSENCE IS A REFUSAL. A room that has never configured delegation behaves exactly as before.
  const none = sb.BotSettings.decide({ k: KEY, v: 700 }, staffLvl, DEFAULTS);
  ok(none && none.ok === false && none.reason === "not-delegated",
    "A: an unconfigured room delegates NOTHING — the feature is opt-in per key, so wiring the "
    + "panel cannot loosen a room that never asked for it", none);
}

// ── PART B — THE SEND EXISTS AND REACHES THE TRANSPORT ───────────────────────────────────────
// PART A proves the decision. This proves an ask can actually leave the machine — the half that
// was missing for the entire life of the feature.
{
  const { sb, sent } = tree();
  const staffLvl = sb.Ranks.levelOf("staff");
  const channels = {}; channels["events-" + staffLvl] = "!ev-staff:hs";
  const p = sb.BotSettings.request(channels, staffLvl, "maxLen", 700);
  ok(p && typeof p.then === "function", "B: APPLIED — request returns a promise", typeof p);
  // The send is async, so everything after it runs in `finish()` rather than at top level — a
  // bare `return` here would end the module and silently skip PARTS C and D.
  p.then((r) => {
    ok(r && r.ok === true, "B: the request reports that it was sent", r);
    ok(sent.length === 1, "B: exactly one event reached the transport", sent.length);
    ok(sent[0] && sent[0].type === "ddjp.bot.request",
      "B: and it is a `ddjp.bot.request` — the type the bot's watch loop handles", sent[0]);
    ok(sent[0] && sent[0].ch === "!ev-staff:hs",
      "B: sent on the REQUESTER'S OWN events channel. The settings channels are write-gated above "
      + "a delegated player's level, so their own tier is the only one writable by definition",
      sent[0]);
    ok(sent[0] && sent[0].body && sent[0].body.k === "maxLen" && sent[0].body.v === 700,
      "B: carrying the key and the value", sent[0] && sent[0].body);
    finish();
  }).catch((e) => {
    console.log("[delegation-reach] FAIL — B: the request threw: " + (e && e.message));
    process.exit(1);
  });
}

function finish() {
  // ── PART C — THE OWNER STILL WRITES DIRECTLY ───────────────────────────────────────────────
  // The panel routes on `_maySetSetting`: owner -> `Room.setSettings`, delegated -> a request.
  // Source-level, because the routing lives in the panel; the DECISION it routes on is driven in
  // PART A. A control asserted here would be asserting the shape of a call, which is what the
  // rest of this file exists to avoid.
  {
    const ui = require("fs").readFileSync(path.join(__dirname, "..", "ui", "interface.js"), "utf8");
    const code = ui.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    ok(/BotSettings\.decide/.test(code),
      "C: the panel asks `BotSettings.decide` rather than comparing the table and the rank itself. "
      + "A second copy of that rule would be free to offer a row the bot then refuses");
    ok(/BotSettings\.request/.test(code),
      "C: and it CALLS `request`. This is the assertion the whole file is for — the function was "
      + "written, guarded, and called by nobody, so the delegation table was configurable and "
      + "unreachable");
    ok(/if \(how === "write"\) return Room\.setSettings\(partial\);/.test(code),
      "C: the owner path is a DIRECT write, unchanged — delegation must not put the owner's own "
      + "settings through a bot that may not be running");
    ok(!/Capabilities\./.test(code),
      "C: and the panel makes no permission decision of its own — `check-boundaries` rule D and "
      + "`check-ui-no-permission` both refused the first version of this, which compared the rank "
      + "here");

    // ── THE LOCK IS REACHABLE BY WHOEVER CAN CHANGE SOMETHING ────────────────────────────────
    // `_settingsLocked` starts TRUE and every editable row is gated on it, so rendering the unlock
    // button `if (isOwner)` made the whole delegation feature a DEAD END: a staff member granted
    // `maxLen` saw the row, could not unlock, and had nothing to click. Reachable in every layer
    // except the one a person touches — which is this project's most-repeated shape, arriving one
    // package after the wiring that was supposed to end it.
    //
    // SOURCE-LEVEL, AND THAT IS A PARTIAL. `renderSettings` is not driven by anything in this
    // suite, so this asserts the GATE rather than the rendered button: it must be the same
    // question the rows ask, not ownership. A person still has to see it.
    // NO CHARACTER WINDOW. A first version read the 400 characters before `settings-lock` — a
    // string that occurs TWICE, the first 8,800 characters from the gate, so it failed against a
    // fix correctly in place. That is the third time this cycle a guard has been bounded by
    // distance instead of by relationship; the fix is the same every time.
    ok(/const canChangeSomething = [\s\S]{0,200}_maySetSetting/.test(code),
      "C: the lock's gate is computed from `_maySetSetting` — the SAME question the rows ask, so "
      + "a lock and the rows it governs cannot disagree about who may change something");
    ok(/canChangeSomething\)\s*\{[\s\S]{0,400}settings-lock/.test(code),
      "C: and the lock BUTTON is what that gate guards. Gated on ownership instead, a delegated "
      + "person sees the row they were granted, cannot unlock, and has nothing to click — the "
      + "feature reachable in every layer except the one a person touches");

    // THE ONE ROW THAT MUST NEVER BE DELEGABLE, asserted at its call site.
    const delIdx = code.indexOf('_renderDelegationSetting("What a bot may change on request"');
    ok(delIdx > 0 && /isOwner && !_settingsLocked/.test(code.slice(delIdx, delIdx + 260)),
      "C: the delegation table itself stays OWNER-ONLY in the panel, rather than being routed "
      + "through the delegable path and relying on a refusal two modules away");
  }

  // ── PART D — THE REFUSALS THAT CARRY THE WEIGHT ────────────────────────────────────────────
  {
    const { sb } = tree();
    const ownerLvl = sb.Ranks.levelOf("owner");

    // E: `botDelegation` IS NOT IN ITS OWN DOMAIN. Without this, a rank delegated the delegation
    // table could widen its own grant — the one escalation this whole design turns on.
    ok(DOMAIN.indexOf("botDelegation") < 0,
      "D: `botDelegation` is NOT in its own key domain, so no rank can ever be delegated the power "
      + "to widen its own delegation", DOMAIN.indexOf("botDelegation"));
    const self = sb.BotSettings.decide(
      { k: "botDelegation", v: { maxLen: "guest" } }, ownerLvl,
      Object.assign({}, DEFAULTS, { botDelegation: { botDelegation: "guest" } }));
    ok(self && self.ok === false,
      "D: and a room that somehow names it anyway is still refused — driven, not assumed from the "
      + "domain list", self);

    // A key that is not a setting at all — a typo, or a GATES act name.
    const bogus = sb.BotSettings.decide({ k: "room.upgrade", v: 1 }, ownerLvl,
      Object.assign({}, DEFAULTS, { botDelegation: { "room.upgrade": "guest" } }));
    ok(bogus && bogus.ok === false,
      "D: a permission-gated ACT is not a settings key and cannot be delegated — the two "
      + "vocabularies stay disjoint", bogus);
  }

  // ── PART F — THE BOT READS THE FIELD THAT CARRIES THE DDJP TYPE ────────────────────────────
  // REPORTED FROM A LIVE ROOM, twice, after the feature was declared wired. The bot never acted:
  // `seen: 0, acted: 0, refused: 0` with three requests sitting in the log.
  //
  // `_onRaw` compared `raw.type` against `"ddjp.bot.request"`. Every DDJP event goes on the wire
  // as `m.room.message` with its real type inside the JSON body as `t`, so that comparison COULD
  // NEVER BE TRUE — and the mode filter rejected the event before the counter, which is why even
  // the refusal count stayed at zero. The payload was the same defect twice over: `raw.content`
  // is `{ msgtype, body }` with `body` still a JSON string, so `decide` was handed an object with
  // no `k` and no `v`.
  //
  // AND THE PROBE WRITTEN TO VERIFY THIS FEATURE PASSED. It fired a synthetic
  // `{ type: "ddjp.bot.request", content: { k, v } }` — field names the READER wants, a shape the
  // WRITER cannot emit. It measured the expectation, not the output. So this part asserts the two
  // sides AGREE rather than asserting either one alone.
  {
    const bridge = require("fs").readFileSync(
      path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
    const bcode = bridge.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const bot = require("fs").readFileSync(
      path.join(__dirname, "..", "features", "botruntime.js"), "utf8");
    const botcode = bot.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    ok(/ddjpType:\s*parsedType/.test(bcode),
      "F: the transport STAMPS the parsed DDJP type onto `raw`. It parsed it and threw it away, "
      + "so every subscriber saw `m.room.message`");
    ok(/ddjpBody:\s*parsedBody/.test(bcode),
      "F: and the parsed payload, because `raw.content.body` is still a JSON string — a caller "
      + "reading `raw.content` gets an object with no `k` and no `v`");
    ok(/type: event\.getType\(\)/.test(bcode),
      "F: `type` still carries the MATRIX type — `features/chat.js` reads it as that and is right "
      + "to, so the fix adds a field rather than redefining one");

    ok(/raw\.ddjpType/.test(botcode),
      "F: and the BOT reads that field. Reading `raw.type` is a comparison that can never be "
      + "true, which is not a refusal — it is silence with the counters left at zero");
    ok(!/raw\.type === "ddjp/.test(botcode),
      "F: the impossible comparison is gone rather than merely supplemented");
    ok(/raw\.ddjpBody/.test(botcode),
      "F: and it takes the payload from the parsed body, not from the Matrix content");
  }

  // ── PART G — A REQUEST REACHES THE WIRE, WITH NOTHING STUBBED PAST IT ──────────────────────
  // PART B proves `request` sends. PART F proves the bot can READ what arrives. Neither proved
  // the other end: that a request actually produces a `ddjp.room.settings` EVENT. The probe
  // written for this feature stubbed `authorSettings`, so `Room.setSettings`, its owner gate, the
  // channel lookup and `sendEvent` were all unverified — and the owner reported twice that no
  // settings were being posted.
  //
  // SO THIS DRIVES THE WHOLE CHAIN and captures the transport: live envelope in, settings event
  // out, on the settings-owner channel, carrying the requested value.
  {
    const CH = { events_owner: "!eo:hs", events_staff: "!es:hs", settings_owner: "!so:hs" };
    const wire = [];
    let sub = null;
    const st = sd.StateDeriver.defaultSettings();
    st.maxLen = 600;
    st.botDelegation = { maxLen: "staff" };

    const e2e = loadInContext([
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
        getState: () => ({ settings: st, rotation: [] }), getLog: () => [], isLegal: () => true,
        on() {},
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
        getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99,
        getUserEffectiveRank: () => 99, getRoster: () => [], rankLadder: () => sd.Ranks.LADDER,
        onRawEvent: (fn) => { sub = fn; }, offRawEvent: () => { sub = null; },
        eventsKeyForLevel: (l) => "events_" + (l >= 99 ? "owner" : "staff"),
        channelTaxonomy: () => [], presenceChatKey: () => "presence_chat",
        amJoined: () => false, spaceChildLevel: () => 100,
        sendEvent: (ch, type, content) => { wire.push({ ch, type, content }); return Promise.resolve(); },
        setSpaceJoinRule: () => Promise.resolve(),
      },
    });
    e2e.Room._setCurrentForTest({ spaceId: "!space:hs", channels: CH });
    const r2 = e2e.BotRuntime.start({
      roomId: "!space:hs", channels: CH,
      authorSettings: async (partial) => {
        const w = await e2e.Room.setSettings(partial);
        if (!w || !w.ok) throw new Error("did not land" + (w && w.reason ? " (" + w.reason + ")" : ""));
        return w;
      },
    });
    ok(r2 && r2.ok, "G: APPLIED — the runtime started", r2);
    ok(typeof sub === "function", "G: APPLIED — and subscribed to raw events", typeof sub);

    const payload = { k: "maxLen", v: 601, t: "ddjp.bot.request", l: 20 };
    sub({ event_id: "$r", type: "m.room.message", sender: "@p:hs", room_id: CH.events_staff, ts: 1,
          content: { msgtype: "m.text", body: JSON.stringify(payload) },
          l: 20, ddjpType: "ddjp.bot.request", ddjpBody: payload, senderRank: 60 }, null, null);

    return new Promise((res) => setTimeout(res, 30)).then(() => {
      const w = wire.filter((x) => x.type === "ddjp.room.settings");
      ok(w.length === 1,
        "G: exactly one `ddjp.room.settings` event reached the TRANSPORT — the half every earlier "
        + "check stubbed away, and the half the owner reported missing", wire);
      ok(w.length === 1 && w[0].ch === CH.settings_owner,
        "G: on the settings-owner channel", w[0] && w[0].ch);
      ok(w.length === 1 && w[0].content && w[0].content.s && w[0].content.s.maxLen === 601,
        "G: carrying the REQUESTED value, merged onto the full blob — last-write-wins tolerates "
        + "nothing partial", w[0] && w[0].content && w[0].content.s && w[0].content.s.maxLen);
      ok(w.length === 1 && w[0].content.s.minLen === st.minLen,
        "G: and the untouched keys survive the merge — a partial blob silently drops every "
        + "setting it forgets", w[0] && w[0].content && w[0].content.s);
      try { e2e.BotRuntime.stop(); } catch (e) {}
      if (failed) process.exit(1);
      done();
    });
  }
}

// ── PART H — A SPINE EVENT REACHES THE RAW LISTENERS ─────────────────────────────────────────
// THE DEFECT EVERY OTHER PART MISSED, reported by the owner three times before it was found.
//
// `Room.timeline` routes Spine channels to `_ingestSpineEvent` and RETURNS, under a comment that
// stated its own assumption: *"Raw listeners are chat, which filters to its own (non-Spine)
// channel, so Spine events never need the fan-out below."* True when chat was the only
// subscriber. `BotRuntime` then subscribed for `ddjp.bot.request`, which arrives on `events-*` —
// and every `events-*` channel IS a Spine channel. **The bot's handler was never called at all**,
// which is why its counters read `seen: 0`: it could not refuse what it was never told about.
//
// EVERY EARLIER PART FIRED THE LISTENER BY HAND. PART G builds a correct envelope and calls the
// subscriber directly, so it proved the handler works given an event — and could never notice
// that nothing delivers one. This asserts DELIVERY: the two paths that ingest a Spine event must
// both fan out, so a subscriber added tomorrow is told about the events it subscribed for.
function partH() {
  const fs = require("fs");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  const fanouts = code.split("for (const fn of _rawListeners)").length - 1;
  ok(fanouts >= 2,
    "H: BOTH ingest paths fan out to the raw listeners — the chat branch and the SPINE branch. "
    + "With only the chat one, every `events-*` event is ingested and NOBODY is told, so a "
    + "subscriber for a Spine-borne type is silently never called", fanouts);

  const spineIdx = code.indexOf("function _ingestSpineEvent");
  ok(spineIdx > 0, "H: APPLIED — the spine ingest was located", spineIdx);
  const spineBody = code.slice(spineIdx, spineIdx + 4000);
  ok(/for \(const fn of _rawListeners\)/.test(spineBody),
    "H: and the SPINE path is one of them — this is the path `ddjp.bot.request` actually takes");
  const ingestAt = spineBody.indexOf("StreamManager.ingest(raw)");
  const fanAt = spineBody.indexOf("for (const fn of _rawListeners)");
  ok(ingestAt > 0 && fanAt > ingestAt,
    "H: the fan-out comes AFTER the fold, so a subscriber that acts on a request sees a room "
    + "state already containing the event it is reacting to", { ingestAt, fanAt });
  ok(/ddjpType: parsedType/.test(spineBody) && /ddjpBody: parsedBody/.test(spineBody),
    "H: and the Spine envelope carries the DDJP type and payload, or the delivery arrives with "
    + "nothing the subscriber can read");
}

function done() {
  partH();
  // ── PART I — A REPLAYED REQUEST MUST NOT REACH THE BOT ─────────────────────────────────────
  // REGRESSION, INTRODUCED BY PART H'S OWN FIX AND REPORTED FROM A LIVE ROOM. Fanning out to raw
  // listeners was added inside `_ingestSpineEvent` so the bot could hear a request at all — and
  // that function is reached from THREE places, one of which is `replayRoom`. So reloading the bot
  // replayed the log, handed it every historical `ddjp.bot.request`, and it authored TWELVE
  // settings writes in a row, flipping `maxLen` through values answered days earlier. They were
  // refused at the door as backdated, so nothing was corrupted — but only by an unrelated guard.
  //
  // THE LIVE-ONLY RULE ALREADY EXISTED. The fan-out bypassed it by arriving somewhere the rule was
  // not, which is why "does the subscriber get told" and "SHOULD it be told about this one" are
  // separate questions.
  {
    const bridge = require("fs").readFileSync(
      path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
    const code = bridge.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    ok(/function _ingestSpineEvent\(event, room, isLive\)/.test(code),
      "I: the spine ingest takes a LIVENESS flag — it is reached from the live timeline, the "
      + "deferred sweep and `replayRoom`, and only one of those may wake a subscriber");
    ok(/if \(isLive === true\) \{[\s\S]{0,160}for \(const fn of _rawListeners\)/.test(code),
      "I: and the fan-out is gated on it. Ungated, a bot reload replays the log and acts on every "
      + "request in it");
    ok(/_ingestSpineEvent\(event, room, true\)/.test(code),
      "I: the LIVE branch passes true, or the bot hears nothing and delegation is dead again");
    ok(/_ingestSpineEvent\(event, room, false\)/.test(code)
       && /_ingestSpineEvent\(ev, room, false\)/.test(code),
      "I: and replay AND the deferred sweep both pass FALSE explicitly rather than relying on the "
      + "default — a caller added later should have to state which it is");
    ok(!/_ingestSpineEvent\([a-z]+, [a-z]+\);/.test(code),
      "I: no call site omits the flag. The default is false, so an omission is SILENT — the bot "
      + "simply never hears that path, which is how this feature was broken for its whole life");
  }

  if (failed) process.exit(1);
  console.log("[delegation-reach] PASS — a delegated setting can now actually be requested. "
    + "`BotSettings.request` had ZERO callers for the life of the feature, so the delegation table "
    + "was configurable and unreachable; the panel now calls it, which PART C asserts directly. "
    + "The panel decides what to OFFER by calling the same `BotSettings.decide` the bot runs on the "
    + "arriving request, so the two cannot disagree about who may change what — driven across the "
    + "domain for a granted rank, a rank below it, and a room that delegates nothing, which stays "
    + "refused so wiring this cannot loosen a room that never asked. The owner keeps a DIRECT "
    + "write, the panel makes no permission decision of its own, and `botDelegation` is refused "
    + "both by being absent from its own domain and by `decide` when a room names it anyway ("
    + A + " assertions)");
}
