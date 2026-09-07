// tests/check-idle-sweep.js
// WALL: IDLENESS IS MEASURED FROM DELIBERATE ACTS, AND ACTING ON IT IS TWO STAGES.
//
// `botAfkMs` and `botPingMs` shipped as settings at v283 with NOTHING computing the number they
// bound; `queueIdleMs` joined them at v322. This guards the thing that finally reads them.
//
// PART A — a client's OWN events never count as its owner being present.
// PART B — `idleFor` distinguishes idle / active / unknown, and never collapses them.
// PART C — the sweep WARNS before it removes, and re-checks in between.
// PART D — coming back cancels the removal.
// PART E — the sweep never removes on absence of evidence, and never removes itself.
// PART F — the room's rule is read fresh, and a stricter map changes the answer.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");

let A = 0;
let failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[idle-sweep] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const MIN = 60000;
const T = 10000000;

// ── A ROOM, BUILT FROM THE REDUCER'S OWN DEFAULTS ────────────────────────────────────────────
// Never a hand-built settings object: `applySettingsEvent` merges every event onto
// `defaultSettings()`, so a live client's blob always carries every key. A partial one here would
// exercise a shape production cannot produce — which is exactly what went wrong in
// `check-who-is-here` when these keys landed.
// The shipped channel table, read rather than restated — a copy here would be a second source for
// the one fact `check-channel-taxonomy` pins.
const TIER_OVERRIDE = { value: null };

const REAL_TAX = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"],
  { EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} } })
  .MatrixBridge.channelTaxonomy();

// Give a sandbox the room state `chatTiers()` needs, so the warning can resolve the room's MAIN
// chat. Every tree that starts a runtime and asserts on warning CONTENT needs this — without it
// the warning refuses as a non-delivery and the failure looks like a code fault.
function withRoom(sb) {
  try {
    sb.Room._setCurrentForTest({ spaceId: "!s:hs",
      channels: { chat_uncategorized: "!chat:hs", events_uncategorized: "!ev:hs",
                  chat_guest: "!chatg:hs", events_guest: "!evg:hs",
                  presence_chat: "!pres:hs" } });
  } catch (e) {}
  return sb;
}

// ── CHAT IS OFF BY DEFAULT IN THIS HARNESS, AND THAT IS AN ISOLATION, NOT A PREFERENCE ────────
// The ROOM default is ON. But the bot only knows chat it has SEEN, and a bot that just started has
// seen none — so with chat on, a freshly built harness is chat-blind and every part measures the
// blindness instead of the rule it is named for. Parts that test the chat path turn it on and set
// the observation window explicitly; everything else isolates the Spine answer.
function tree(over, log, rotation) {
  over = Object.assign({ botQueueChat: false, botPresenceChat: false }, over || {});
  // `chatSince` / `chatSeen` are HARNESS knobs, not settings: they stand for what the bot has
  // observed, which in production comes from `Chat.onMessage` and the moment it subscribed.
  const chatSince = over.chatSince; delete over.chatSince;
  const chatSeen = over.chatSeen;   delete over.chatSeen;
  let chatFeed = null;      // the listener the runtime hands to `Chat.onMessage`
  let startingUp = true;    // true only while `start()` runs, so the clock can stamp the past
  const sd = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  ], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  for (const k in (over || {})) settings[k] = over[k];

  const sent = { chat: [], removed: [], invited: [], dropped: [] };
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getLog: () => log || [],
      getState: () => ({ settings: settings, rotation: rotation || [] }),
      isLegal: (id) => id !== "$refused",
      on() {},
      // A STAND-IN, ON PURPOSE. This harness feeds `StreamManager` from a fixture, so the real
      // replay is not reachable from here — it credits each rotation member with their first join
      // in the fixture log, which is what the real one computes for these fixtures. Enough to
      // drive the BOT's wiring: does the sweep read it, and does it blend with the Spine answer.
      // The real implementation is driven against a real `StreamManager` in PART D4.
      rotationEntries: () => {
        const out = {};
        for (const m of (rotation || [])) {
          if (!m || typeof m.user !== "string") continue;
          for (const e of (log || [])) {
            if (e && e.sender === m.user && e.type === "ddjp.dj.join") { out[m.user] = e.ts; break; }
          }
        }
        return out;
      },
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
      getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
      joinedMembersOf: () => (MEMBERS === null ? null : MEMBERS.slice()),
      // The roster is how the bot tells the OWNER (above its own level) from everyone else.
      getRoster: () => (ROSTER === null ? null : ROSTER.slice()),
      inviteToPresence: (r, u) => { sent.invited.push(u); return Promise.resolve({ ok: true }); },
      removeFromPresence: (r, u) => { sent.dropped.push(u); return Promise.resolve({ ok: true }); },
      // THE REAL CHANNEL TABLE, not an empty stub. `Room.chatTiers()` builds the tier list from
      // it, and the warning now names the room's MAIN chat rather than following whichever tab is
      // open — so an empty taxonomy resolves no tiers, the warning refuses as a non-delivery, and
      // every assertion about warning CONTENT fails for a harness reason rather than a code one.
      channelTaxonomy: () => REAL_TAX,
      eventsKeyForLevel: (lvl) => (lvl >= 99 ? "events_owner" : "events_uncategorized"),
      presenceChatKey: () => "presence_chat",
      amJoined: () => false,
    },
    // The device-local tier override. `chatTiers()` reads it, so this is the lever a stray click
    // on the bot's machine actually pulls — PART L drives it rather than a Chat method.
    ChatPrefs: { chatTier: () => TIER_OVERRIDE.value, onChange() {} },
    // The clock reads `chatSince` while `start()` runs, so the runtime stamps its observation
    // start there and reads T for every sweep afterwards — which is how "the bot has been watching
    // for an hour" is expressed without reaching into anything private.
    ServerClock: { serverNow: () => (startingUp ? (chatSince || T) : T) },
    Chat: { send: (t) => { sent.chat.push(t); return Promise.resolve({ ok: true }); },
            sendTo: (ch, t) => { sent.chat.push(t); sent.chatTo = ch; return Promise.resolve({ ok: true }); },
            // THE REAL SUBSCRIPTION. The runtime records chat through this and nowhere else, so
            // driving it here exercises the production path rather than a private field.
            onMessage: (fn) => { chatFeed = fn; } },
    Queue: { remove: (u) => { sent.removed.push(u); return Promise.resolve(); } },
  });
  // STARTED, because `sweepIdle` correctly refuses when the runtime is not running — a sweep that
  // acted while the bot was off would act in rooms where this client is nobody. Driving the real
  // `start` also means the fixture exercises the gate rather than reaching past it.
  // THE ROOM NEEDS A MAIN CHAT TIER, because the warning now names its destination instead of
  // following whichever tab is open. `chatTiers()` is the REAL resolver here — given no room state
  // it answers "no tiers", the warning correctly refuses as a non-delivery, and every assertion
  // about warning content would fail for a harness reason rather than a code one.
  try {
    sb.Room._setCurrentForTest({ spaceId: "!s:hs",
      channels: { chat_uncategorized: "!chat:hs", events_uncategorized: "!ev:hs",
                  chat_guest: "!chatg:hs", events_guest: "!evg:hs",
                  presence_chat: "!pres:hs" } });
  } catch (e) {}
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!pres:hs" } });
  startingUp = false;
  // REPLAYED THROUGH `Chat.onMessage`, the same call production makes — the runtime has no other
  // way in, so this drives the real path rather than a private field.
  if (chatFeed && chatSeen) {
    for (const u in chatSeen) { try { chatFeed("$c" + u, u, "hi", false, chatSeen[u]); } catch (e) {} }
  }
  // `chatFeed` is exposed so a part can drive a chat message AFTER construction — the pre-seeded
  // `chatSeen` option only replays at build time, and the room-change part needs to speak, stop,
  // and start again.
  const out = { sb: sb, sent: sent, settings: settings, started: started, feedChat: (id, who, ts) => {
                 if (typeof chatFeed === "function") chatFeed(id, who, "hi", false, ts);
                 return typeof chatFeed === "function";
               },
           stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} } };
  STARTED.push(out);
  return out;
}

const STARTED = [];
// The channel table, read from the transport rather than restated — a literal list here would go
// stale the next time a channel is added, which is exactly what a presence row IS.
function P3_TAX() {
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/matrixbridge.js"],
    { Date, Math, JSON, window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  return (sb.MatrixBridge && sb.MatrixBridge.channelTaxonomy) ? sb.MatrixBridge.channelTaxonomy() : null;
}
let MEMBERS = [];   // what the presence channel currently holds; null = unreadable
let ROSTER = [];    // space members with levels; null = unreadable roster
const act = (id, who, ts, type, content) => ({ eventId: id, sender: who, ts: ts, type: type,
  content: content || {} });
// A SUBMIT, not a bare join. `ddjp.dj.join` carrying a video is `Queue.submitSong` — what the
// reconcile loop fires unprompted as a buffer tops up, and therefore NOT counted as activity. A
// fixture that used the bare form would be exercising a path the classifier already credits, and
// would pass with the join-time reading removed entirely. That happened: two mutations survived.
const submit = (id, who, ts, vid) => act(id, who, ts, "ddjp.dj.join", { v: vid || "vid", u: "http://x/" + (vid || "v") });

// ── PART A — A CLIENT'S OWN EVENTS ARE NOT ITS OWNER BEING PRESENT ───────────────────────────
// THE ROW THE WHOLE FEATURE RESTS ON. When a song ends the DJ's client authors the next
// `ddjp.dj.play` with nobody touching anything. Counting it means a person who queued five songs
// and walked away looks active until their buffer empties — so the rule could never fire for
// exactly the person it exists for.
{
  const auto = [
    act("$1", "@gone:hs", T - 50 * MIN, "ddjp.dj.join"),     // the last thing they DID
    act("$2", "@gone:hs", T - 2 * MIN, "ddjp.dj.play"),      // their client, since
    act("$3", "@gone:hs", T - 1 * MIN, "ddjp.play.len"),     // their client
    act("$4", "@gone:hs", T, "ddjp.play.blocked"),           // their player
  ];
  // ── `ddjp.dj.order` BELONGS IN THAT LIST, AND DID NOT ──────────────────────────────────────
  // MEASURED: its only sender is `userqueue.js`'s reconcile pass. The UI's move buttons edit a
  // LOCAL list and kick the loop, exactly as adding a song does, so no click ever reaches the
  // wire — and the loop pins the order whenever it differs from the natural arrangement, which
  // happens as songs cycle. So an idle person emitted one and read as ACTIVE: the same false
  // positive the `declare` exclusion was added to remove, alive through a different type.
  //
  // Placed in the AUTO fixture rather than given its own, so it is judged by the same rows that
  // already prove the classification does work — a separate fixture could pass while the fold
  // reached nothing.
  auto.push(act("$5", "@gone:hs", T, "ddjp.dj.order"));
  const t = tree({ queueIdleMs: 15 * MIN }, auto, [{ user: "@gone:hs", pending: [] }]);
  const idle = t.sb.Room.idleFor("@gone:hs", T);
  ok(idle && idle.known === true, "A: APPLIED — there IS a qualifying act to measure from", idle);
  ok(idle.idleMs === 50 * MIN,
    "A: idleness is measured from the last DELIBERATE act, not the last event. Three client-authored "
    + "events sit between, the most recent at `now` — if any counted this would read 0", idle);
  ok(idle.overdue === true,
    "A: so somebody whose client is still emitting IS overdue. This is the whole feature: the "
    + "auto-advance would otherwise hold their deck open forever", idle);
  ok(idle.lastTs === T - 50 * MIN,
    "A: and `ddjp.dj.order` AT `now` does not move the reading. It is the reconcile loop pinning "
    + "the buffer order, not a person — the move buttons edit a local list and kick that loop, so "
    + "the click never reaches the wire and the type cannot carry it", idle);

  // THE CONTROL. Same log, same times, but the recent events are DELIBERATE — so the reading must
  // flip. Without this, PART A would pass on a fold that counted nothing at all.
  const manual = [
    act("$1", "@here:hs", T - 50 * MIN, "ddjp.dj.join"),
    act("$2", "@here:hs", T - 1 * MIN, "ddjp.dj.skip"),
  ];
  const t2 = tree({ queueIdleMs: 15 * MIN }, manual, [{ user: "@here:hs", pending: [] }]);
  const idle2 = t2.sb.Room.idleFor("@here:hs", T);
  ok(idle2.idleMs === 1 * MIN && idle2.overdue === false,
    "A CONTROL: a deliberate act at the same moment DOES count, so the exclusion above is the "
    + "classification doing work rather than the fold reaching nothing", idle2);
}

// ── PART B — THREE ANSWERS, NEVER COLLAPSED ──────────────────────────────────────────────────
// `null`, `{known:false}` and a number are three different facts. A caller that could not tell
// "idle for an hour" from "I do not know" is a caller that removes people for the second reason.
{
  const t = tree({ queueIdleMs: 15 * MIN }, [act("$1", "@a:hs", T - 40 * MIN, "ddjp.dj.join")], []);
  ok(t.sb.Room.idleFor("", T) === null, "B: no user is null, not a number");
  ok(t.sb.Room.idleFor("@a:hs", 0) === null, "B: no clock is null — an idle span needs a reference");

  // ── NO QUALIFYING ACT HELD IS TWO ANSWERS, AND THIS PART USED TO GIVE ONE ──────────────────
  // It required `known:false` for anybody with no held act, and `sweepIdle` skips anyone unknown.
  // So a person who had done NOTHING was skipped forever — which is precisely the person the AFK
  // rule exists for. Reported from a live room: both windows set to two minutes, nothing after
  // three. It became reachable the moment buffer top-ups stopped counting, because before that a
  // playlist kept somebody permanently "active" and after it they had no qualifying acts at all.
  // **Both states look identical from outside: nothing happens.**
  //
  // THE PROTECTION THIS PART WAS WRITTEN FOR STILL HOLDS, and it is asserted directly below rather
  // than as a side effect: a client that cannot see back a full window must NOT report anybody
  // overdue, or a trim would empty the rotation. The separator is `reachMs`, which this part
  // already required and nothing read.

  // (a) THE REACH COVERS THE WINDOW: seeing a full window and finding nothing IS a measurement.
  const quiet = t.sb.Room.idleFor("@nobody:hs", T);
  ok(quiet && quiet.known === true && quiet.overdue === true,
    "B: with the log reaching back at least a full window and NO act in it, the person is idle "
    + "for at least that window — a measurement, not a guess, and the AFK case itself", quiet);
  ok(quiet && quiet.bounded === true && quiet.idleMs === quiet.reachMs,
    "B: reported as a LOWER BOUND — they may have been idle longer than this client can see, and "
    + "the only question the sweep asks is `overdue`, which the bound answers on its own", quiet);

  // (b) THE REACH DOES NOT COVER THE WINDOW: genuinely unknowable, and it must stay that way.
  const shortReach = tree({ queueIdleMs: 15 * MIN },
    [act("$recent", "@someone:hs", T - 30000, "ddjp.dj.join")], []);
  const cannotTell = shortReach.sb.Room.idleFor("@nobody:hs", T);
  ok(cannotTell && cannotTell.known === false && cannotTell.idleMs === null,
    "B: but a client that can only see back 30 SECONDS of a 15-minute window does not know, and "
    + "says so with no number", cannotTell);
  ok(cannotTell.overdue === false,
    "B: and never reports overdue on that reach. Treating a short reach as maximal idleness would "
    + "empty the rotation after every trim — the plausible-value shape, on the most destructive "
    + "path. THIS is the assertion the old `known:false` rule was protecting", cannotTell);
  ok(typeof cannotTell.reachMs === "number" && typeof quiet.reachMs === "number",
    "B: both answers carry the reach, which is the field that separates them", 
    { quiet: quiet.reachMs, cannotTell: cannotTell.reachMs });

  // A REFUSED act is not evidence anybody was here in a sense the room recognises.
  const t2 = tree({ queueIdleMs: 15 * MIN },
    [act("$1", "@a:hs", T - 40 * MIN, "ddjp.dj.join"), act("$refused", "@a:hs", T, "ddjp.dj.skip")], []);
  const r = t2.sb.Room.idleFor("@a:hs", T);
  ok(r.idleMs === 40 * MIN,
    "B: an act the room REFUSED counts for nobody — otherwise a deck could be held by doing "
    + "things the room rejects", r);
}

// ── PART C — WARN, THEN RE-CHECK, THEN REMOVE ────────────────────────────────────────────────
{
  const log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@idle:hs", pending: [] }];
  const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
  const RT = t.sb.BotRuntime;

  const first = RT.sweepIdle();
  ok(first.ok === true && first.warned.length === 1 && first.warned[0] === "@idle:hs",
    "C: the first pass WARNS", first);
  ok(first.removed.length === 0,
    "C: and removes NOBODY. Removing on the first sighting would take a deck from somebody who "
    + "stepped away for a minute", first);
  ok(t.sent.chat.length === 1 && t.sent.chat[0].indexOf("@idle:hs") >= 0,
    "C: the warning goes to CHAT — outside the log, so it costs the room no events and nothing to "
    + "forget. It also leaves no permanent trace, which is the accepted trade", t.sent.chat);
  ok(t.sent.removed.length === 0, "C: APPLIED — nothing removed yet", t.sent.removed);

  // A SECOND PASS BEFORE THE ANSWER WINDOW HAS PASSED must not remove.
  const second = RT.sweepIdle();
  ok(second.removed.length === 0 && second.warned.length === 0,
    "C: a pass inside the answer window neither re-warns nor removes — the sweep runs every "
    + "minute and `botPingMs` is the wait, so re-warning would spam", second);
}

// ── PART D — COMING BACK CANCELS IT ──────────────────────────────────────────────────────────
// The warning is exactly the kind of thing that makes somebody come back. A sweep that removed on
// a timer it set earlier would ignore the answer it asked for.
{
  let log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@idle:hs", pending: [] }];
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  // Chat OFF: see the note on `tree` — a just-started bot is chat-blind, and every part here
  // measures the Spine rule. The chat path has its own part, which turns it on deliberately.
  settings.botQueueChat = false; settings.botPresenceChat = false;
  settings.queueIdleMs = 15 * MIN; settings.botPingMs = 10 * MIN;
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
    StreamManager: { getLog: () => log, getState: () => ({ settings, rotation: rot }),

                     isLegal: () => true, on() {} },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
                    getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
                    // The real table, for the reason the main tree gives: the warning names the
                    // room's MAIN chat, and an empty taxonomy resolves no tier to name.
                    channelTaxonomy: () => REAL_TAX,
                    eventsKeyForLevel: (l) => (l >= 99 ? "events_owner" : "events_uncategorized"),
                    presenceChatKey: () => "presence_chat", amJoined: () => false },
    ServerClock: { serverNow: () => NOW },
    Chat: { send: (x) => { sent.chat.push(x); return Promise.resolve({ ok: true }); },
            sendTo: (ch, x) => { sent.chat.push(x); sent.chatTo = ch; return Promise.resolve({ ok: true }); } },
    Queue: { remove: (u) => { sent.removed.push(u); return Promise.resolve(); } },
  });
  const RT = sb.BotRuntime;
  withRoom(sb);
  RT.start({ roomId: "!r:hs" });
  STARTED.push({ stop: () => { try { RT.stop(); } catch (e) {} } });

  ok(RT.sweepIdle().warned.length === 1, "D: APPLIED — warned on the first pass");
  // They come back: a deliberate act lands.
  log = log.concat([act("$2", "@idle:hs", NOW + 1000, "ddjp.dj.skip")]);
  NOW = T + 11 * MIN;   // well past botPingMs
  const after = RT.sweepIdle();
  ok(after.removed.length === 0 && sent.removed.length === 0,
    "D: acting after the warning CANCELS the removal, even though the answer window has passed. "
    + "The second check re-reads idleness rather than trusting the earlier decision", after);

  // AND THE CONTROL: without the act, the same clock DOES remove.
  log = [act("$1", "@idle2:hs", T - 40 * MIN, "ddjp.dj.join")];
  rot.length = 0; rot.push({ user: "@idle2:hs", pending: [] });
  NOW = T;
  RT.sweepIdle();                       // warn
  NOW = T + 11 * MIN;
  const gone = RT.sweepIdle();
  ok(gone.removed.length === 1 && gone.removed[0] === "@idle2:hs",
    "D CONTROL: still idle after the answer window IS removed — so PART D's cancellation is the "
    + "re-check doing work rather than a sweep that never removes anything", gone);
  ok(sent.removed.indexOf("@idle2:hs") >= 0,
    "D CONTROL: and the remove reached the queue", sent.removed);
}

// ── PART E — NEVER ON ABSENCE, NEVER ITSELF ──────────────────────────────────────────────────
{
  // Somebody in the rotation with NO acts in the log at all — the shape a trim produces.
  const t = tree({ queueIdleMs: 15 * MIN }, [act("$1", "@other:hs", T, "ddjp.dj.join")],
                 [{ user: "@trimmed:hs", pending: [] }]);
  const r = t.sb.BotRuntime.sweepIdle();
  ok(r.warned.length === 0 && r.removed.length === 0,
    "E: somebody whose evidence is not held is neither warned nor removed. After a trim that is "
    + "EVERYBODY, and a sweep that acted on absence would empty the rotation", r);
  ok(r.skipped.indexOf("@trimmed:hs") >= 0,
    "E: and they are reported as SKIPPED rather than silently passed over — the honest answer is "
    + "distinguishable from 'they are fine'", r);

  // THE BOT ITSELF is always present and never does anything a person would.
  //
  // THE FIXTURE GIVES IT A STALE ACT ON PURPOSE, and the first version of this test did not —
  // which made it VACUOUS. With no acts at all the bot is `known:false` and skipped by the absence
  // rule above, so removing the self-check entirely left this green. Driven (M5): the bot needs an
  // act old enough to be OVERDUE, so that the only thing standing between it and a remove is the
  // self-check itself.
  const t2 = tree({ queueIdleMs: 15 * MIN },
    [act("$b", "@bot:hs", T - 40 * MIN, "ddjp.dj.join")],
    [{ user: "@bot:hs", pending: [] }]);
  ok(t2.sb.Room.idleFor("@bot:hs", T).overdue === true,
    "E: APPLIED — the bot must be measurably OVERDUE, or the assertion below passes on the "
    + "absence rule and says nothing about the self-check", t2.sb.Room.idleFor("@bot:hs", T));
  const r2 = t2.sb.BotRuntime.sweepIdle();
  ok(r2.warned.indexOf("@bot:hs") < 0 && r2.removed.indexOf("@bot:hs") < 0,
    "E: the bot never sweeps itself. It is always in the room and never does anything a person "
    + "would, so it would be the first thing it removed", r2);
  ok(r2.skipped.indexOf("@bot:hs") < 0,
    "E: and it is not reported as skipped either — it was never a candidate, which is a different "
    + "fact from being unmeasurable", r2);
}

// ── PART F — THE ROOM'S RULE, READ FRESH ─────────────────────────────────────────────────────
{
  const log = [
    act("$1", "@voter:hs", T - 40 * MIN, "ddjp.dj.join"),
    act("$2", "@voter:hs", T - 1 * MIN, "ddjp.dj.vote"),
  ];
  // ── THE MAP IS SET EXPLICITLY, NOT INHERITED FROM THE DEFAULT ─────────────────────────────
  // This read "with the DEFAULT queue map a vote does not count", which was true while that map
  // held three of the six groups — and became false the day the default widened to all six. A
  // mechanism proved by a default is proved by whatever the default happens to be; the filter is
  // the subject, so the filter is what this sets.
  const strict = tree({ queueIdleMs: 15 * MIN, activityQueue: { rotation: true } },
    log, [{ user: "@voter:hs", pending: [] }]);
  const a = strict.sb.Room.idleFor("@voter:hs", T);
  ok(a.idleMs === 40 * MIN,
    "F: with `vote` OFF in the queue map, a recent vote does not keep a deck — the map is doing "
    + "work rather than every act counting", a);

  // AND THE DEFAULT IS NOW ALL SIX, for both sets. The queue set carried three while presence
  // carried all six, so an untouched room judged the two by different rules and the NARROWER one
  // governed the harsher consequence — losing a held turn rather than being dropped from a channel
  // you can rejoin.
  {
    const wide = tree({ queueIdleMs: 15 * MIN }, log, [{ user: "@voter:hs", pending: [] }]);
    const w = wide.sb.Room.idleFor("@voter:hs", T);
    ok(w.idleMs === 1 * MIN,
      "F: and with the DEFAULT map a vote DOES count — every group counts unless an owner turns "
      + "one off, and the wider default removes fewer people", w);
  }

  // A room that counts votes gets the other answer from the same log.
  const loose = tree({ queueIdleMs: 15 * MIN,
                       activityQueue: { moderation: true, rotation: true, skip: true, vote: true } },
                     log, [{ user: "@voter:hs", pending: [] }]);
  const b = loose.sb.Room.idleFor("@voter:hs", T);
  ok(b.idleMs === 1 * MIN && b.overdue === false,
    "F: and a room that counts votes reads the SAME log differently. The rule is the room's, not "
    + "this module's", b);

  // FAIL CLOSED on an unreadable rule, like every other reader here.
  const broken = tree({ queueIdleMs: 15 * MIN, activityQueue: "nonsense" }, log, []);
  ok(broken.sb.Room.idleFor("@voter:hs", T) === null,
    "F: an unreadable map answers null rather than falling back to a rule nobody set. A default "
    + "here would be reachable only when the room is broken, which is the hardest place to notice");

  // And the QUEUE map is the one read — not the presence map, which is deliberately more generous.
  const src = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8");
  const i = src.indexOf("function idleFor");
  const body = src.slice(i, i + 2600);
  ok(body.indexOf("settings.activityQueue") >= 0 && body.indexOf("activityPresence") < 0,
    "F: `idleFor` reads `activityQueue`, never `activityPresence`. They are two keys because a "
    + "deck held while gone blocks other people and a chat seat does not — reading the generous "
    + "one here would hold decks by the lenient rule");
}

// ── PART G — STOPPING CLEARS BOTH PIECES OF PER-ROOM STATE ───────────────────────────────────
// `_evaluateBot` stops before it starts on EVERY room entry, so anything the runtime keeps across
// a stop is state carried into a room it does not belong to.
{
  const log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@idle:hs", pending: [] }];
  const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
  const RT = t.sb.BotRuntime;

  ok(RT.sweepIdle().warned.length === 1, "G: APPLIED — warned once in the first room");

  // A ROOM CHANGE: stop, then start again, exactly as `_evaluateBot` does.
  RT.stop();
  RT.start({ roomId: "!other:hs" });

  // THE WARNED SET MUST NOT SURVIVE. If it did, this pass would see somebody already warned and —
  // once the answer window passed — remove them on the strength of a warning delivered to a room
  // they have left, where they never saw it. Driven in the v322 audit: removing the reset left the
  // whole suite green.
  const after = RT.sweepIdle();
  ok(after.warned.length === 1 && after.removed.length === 0,
    "G: after a stop the runtime WARNS AFRESH rather than continuing a countdown from the previous "
    + "room. A surviving warned-set would remove somebody on the strength of a warning they were "
    + "never shown", after);

  // AND THE TIMER. A surviving interval sweeps a room this client has left, and since the bot is
  // re-evaluated on every room entry they would accumulate one per room visited. Asserted through
  // the runtime's own report rather than by reaching into module state.
  const before = RT.status();
  ok(before.running === true, "G: APPLIED — running after the restart", before);
  RT.stop();
  ok(RT.status().running === false, "G: and stop reports it stopped", RT.status());
  ok(RT.sweepIdle().ok === false,
    "G: a stopped runtime SWEEPS NOTHING — the timer is cleared, and even called directly the "
    + "sweep refuses, so a leaked tick could not act either", RT.sweepIdle());
}

// ── PART G — STOP RELEASES THE TIMER, DRIVEN AGAINST A FAKE CLOCK ────────────────────────────
// A leaked interval goes on sweeping a room this client has left, and `_evaluateBot` stops before
// it starts on every room entry — so one leaks per room visited.
//
// DRIVEN THIS WAY BECAUSE THE OBVIOUS TEST FAILS BADLY. Removing the `clearInterval` makes this
// FILE HANG: the live interval keeps node alive and the guard times out, which reads as a stuck
// build rather than a defect, and a suite runner without its own timeout would hang with it. A
// guard that hangs reports nothing. So the timers are FAKE and the assertion is on the bookkeeping.
{
  const created = [], cleared = [];
  let nextId = 1;
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  // Chat OFF: see the note on `tree` — a just-started bot is chat-blind, and every part here
  // measures the Spine rule. The chat path has its own part, which turns it on deliberately.
  settings.botQueueChat = false; settings.botPresenceChat = false;
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const id = nextId++; created.push({ id, ms }); return id; },
    clearInterval: (id) => { cleared.push(id); },
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getLog: () => [], getState: () => ({ settings, rotation: [] }),
                     isLegal: () => true, on() {} },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
                    getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
                    // The real table, for the reason the main tree gives: the warning names the
                    // room's MAIN chat, and an empty taxonomy resolves no tier to name.
                    channelTaxonomy: () => REAL_TAX,
                    eventsKeyForLevel: (l) => (l >= 99 ? "events_owner" : "events_uncategorized"),
                    presenceChatKey: () => "presence_chat", amJoined: () => false },
    ServerClock: { serverNow: () => T },
    Chat: { send: () => Promise.resolve({ ok: true }), sendTo: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
  });
  const RT = sb.BotRuntime;

  ok(RT.start({ roomId: "!r1:hs" }).ok === true, "G: APPLIED — the runtime starts");
  ok(created.length === 1, "G: starting creates exactly ONE sweep interval", created);
  ok(created[0].ms === RT.SWEEP_EVERY_MS,
    "G: at the module's own constant, so the cadence is not a second number", created[0]);

  RT.stop();
  ok(cleared.length === 1 && cleared[0] === created[0].id,
    "G: STOPPING CLEARS THE ONE IT MADE, by the id it was given. Without this a runtime left over "
    + "from the previous room keeps sweeping it — and since the bot is re-evaluated on every room "
    + "entry, one interval leaks per room visited", { created, cleared });

  // A ROOM SWITCH: stop-then-start must not accumulate.
  RT.start({ roomId: "!r2:hs" });
  RT.stop();
  ok(created.length === 2 && cleared.length === 2,
    "G: and two start/stop cycles leave two created and two cleared — never one cleared and two "
    + "running", { created: created.length, cleared: cleared.length });

  // AND THE SWEEP IS INERT ONCE STOPPED, which is the property the bookkeeping stands for.
  const after = RT.sweepIdle();
  ok(after.ok === false,
    "G: a sweep after stop does nothing. The timer bookkeeping above is evidence; this is the "
    + "behaviour it is evidence FOR", after);
}

// ── PART H — PRESENCE MEMBERSHIP IS RECONCILED, NOT REACTED TO ───────────────────────────────
// Nobody emits an event when somebody becomes present or stops being, so membership cannot be
// maintained by reacting to arrivals. It is maintained by COMPARING current state against current
// membership — which is also why reconnect needs no catch-up path at all.
{
  const active = [act("$1", "@a:hs", T - 1 * MIN, "ddjp.dj.join"),
                  act("$2", "@b:hs", T - 2 * MIN, "ddjp.dj.vote")];

  // FROM EMPTY: both active people are added.
  MEMBERS = [];
  const t = tree({ botAfkMs: 60 * MIN }, active, []);
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.ok === true && r.added.length === 2 && r.removed.length === 0,
    "H: people the room derives as around are ADDED to the channel", r);
  ok(t.sent.invited.length === 2, "H: and the invites reach the transport", t.sent.invited);

  // SOMEBODY IN THE CHANNEL WHO IS NO LONGER AROUND is removed. Same fold, different membership.
  MEMBERS = ["@a:hs", "@b:hs", "@stale:hs", "@bot:hs"];
  const t2 = tree({ botAfkMs: 60 * MIN }, active, []);
  const r2 = t2.sb.BotRuntime.reconcilePresence();
  // REMOVAL IS TWO STAGES NOW — the first pass warns. What this row measures is that the pass
  // SEES them and leaves the still-active alone; the grace is measured in `check-presence-chat`.
  ok(r2.added.length === 0 && r2.warned.length === 1 && r2.warned[0] === "@stale:hs",
    "H: somebody in the channel the room no longer counts as around is picked out, and the two "
    + "who are still around are left alone rather than re-invited", r2);

  // THE RECONNECT CASE, AND IT NEEDS NOTHING SPECIAL. A bot that was away while everything changed
  // sees only the CURRENT fold against the CURRENT membership — an hour of drift is one pass.
  MEMBERS = ["@gone1:hs", "@gone2:hs", "@bot:hs"];
  const t3 = tree({ botAfkMs: 60 * MIN }, active, []);
  const r3 = t3.sb.BotRuntime.reconcilePresence();
  ok(r3.added.length === 2 && r3.warned.length === 2,
    "H: after a disconnect the bot fixes the whole difference in ONE pass — no queue, no catch-up "
    + "and no replay, because the comparison is against the present either way. This is the half "
    + "that must NOT be live-only, and it is a different rule from the request handler rather than "
    + "an exception to it", r3);

  // THE BOT IS NEVER A CANDIDATE, in either direction. It must stay in the channel to manage it,
  // and it is never "active" by the room's rule — so a bare comparison would have it remove itself
  // and then be unable to let anybody back in.
  ok(r3.removed.indexOf("@bot:hs") < 0 && r2.removed.indexOf("@bot:hs") < 0,
    "H: the bot never removes itself, though it is in the channel and not active", r3.removed);
  ok(r.added.indexOf("@bot:hs") < 0, "H: and never invites itself either", r.added);

  // UNREADABLE MEMBERSHIP IS A REFUSAL, NOT AN EMPTY CHANNEL. This is the one that would hurt:
  // read as empty, an unsynced channel makes every active person look missing and the bot invites
  // the entire room at once.
  MEMBERS = null;
  const t4 = tree({ botAfkMs: 60 * MIN }, active, []);
  const r4 = t4.sb.BotRuntime.reconcilePresence();
  ok(r4.ok === false && r4.reason === "membership-unreadable" && r4.added.length === 0,
    "H: membership that cannot be read REFUSES rather than reading as nobody. An empty array is a "
    + "real answer and `null` is not, and a reconciler that confused them would invite everybody "
    + "into the channel on a bad sync", r4);
  ok(t4.sent.invited.length === 0, "H: and nothing reached the transport", t4.sent.invited);
  MEMBERS = [];

  // NO CHANNEL — a room that has not run upgrade 3 — is a clean refusal, not a crash.
  const t5 = tree({ botAfkMs: 60 * MIN }, active, []);
  t5.sb.BotRuntime.stop();
  t5.sb.BotRuntime.start({ roomId: "!r:hs", channels: {} });
  const r5 = t5.sb.BotRuntime.reconcilePresence();
  ok(r5.ok === false && r5.reason === "no-presence-channel",
    "H: a room without the channel refuses cleanly — every room built before this upgrade is one, "
    + "and the bot must go on doing its other work in them", r5);
}

// ── PART I — RANK ASSIGNMENT DOES NOT TOUCH THE PRESENCE CHANNEL ─────────────────────────────
// `assignRank` reconciles membership for EVERY channel and is described as a per-user repair that
// re-applies full correct state. `_desiredMembership` answers `true` by default — belong
// everywhere unless a rank says otherwise — which is right for every channel whose membership rank
// decides, and wrong for the one whose membership the BOT decides.
//
// Left to fall through, every promotion, demotion or repair anywhere in the room would silently
// re-invite people the bot had just removed for being away. The bot would remove them again on its
// next pass and the two would fight forever with nothing reporting it. Driven (P5): removing the
// exclusion left the whole suite green.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const from = src.indexOf("function _presenceChatKey");
  const to = src.indexOf("// --- Assign rank ---");
  ok(from > 0 && to > from, "I: APPLIED — the membership policy must be locatable to be driven");
  const fnSrc = src.slice(from, to);

  // The channel table, read from the transport so the key is the tree's rather than this file's.
  const rows = P3_TAX();
  ok(rows && rows.length, "I: APPLIED — the channel taxonomy must be readable", rows && rows.length);
  const presence = rows.filter((r) => r.kind === "presence")[0];
  ok(!!presence, "I: APPLIED — there must be a presence row to exclude", rows.map((r) => r.kind));

  const sandbox = { console, CHANNELS: rows, _rankFromKey: (k) => 0 };
  require("vm").createContext(sandbox);
  require("vm").runInContext(fnSrc + "\n;globalThis._dm = _desiredMembership;", sandbox);
  const dm = sandbox._dm;

  ok(dm(presence.key, 99) === null,
    "I: the presence channel answers NULL — not my decision — at every rank, so `assignRank` skips "
    + "it entirely", dm(presence.key, 99));
  ok(dm(presence.key, 0) === null,
    "I: including at the bottom rung. A `false` here would be the same collision from the other "
    + "side: `assignRank` would KICK somebody the bot correctly admitted", dm(presence.key, 0));

  // THE CONTROL: ordinary channels still answer true/false, so the exclusion is a carve-out rather
  // than a policy that stopped deciding anything.
  const events = rows.filter((r) => r.kind === "events")[0];
  ok(dm(events.key, 99) === true,
    "I CONTROL: an events channel still answers true, so the null above is the presence carve-out "
    + "doing work rather than the whole policy going quiet", dm(events.key, 99));

  // AND THE CALLER MUST NOT COERCE IT. `if (want)` alone treats null as false and kicks — the
  // three-way answer only helps if the caller reads three ways.
  const assignFrom = src.indexOf("async function assignRank");
  const assignBody = src.slice(assignFrom, assignFrom + 2200);
  ok(/want === null/.test(assignBody) && /continue/.test(assignBody),
    "I: the caller must test for null EXPLICITLY and skip. Coercing it to false would kick the "
    + "very people the bot admitted, which is the failure this carve-out exists to prevent");
}

// ── PART J — AN UNDELIVERED WARNING DOES NOT START THE REMOVAL CLOCK ─────────────────────────
// The two stages exist so nobody is removed without being told. `sweepIdle` marks the pending
// warning synchronously, so whether the person was ACTUALLY told depends on a `Chat.send` this
// file stubbed as always succeeding — every other PART supplies `{ ok: true }`. Production
// refuses five ways, and because the chat tiers are encrypted `no-crypto` is ordinary for a bot
// whose crypto has not come up, with nobody watching its banner.
//
// DRIVEN THROUGH THE REAL ASYNC PATH: `_warn` clears the mark in a promise callback, so the
// assertion has to await a turn of the microtask queue or it reads the state before the clear.
{
  // BOTH BRANCHES OF THE RULE, because it has two and a guard that drives one is the shape this
  // file's own PART D fell into: `_warn` refuses early when there is no `Chat.send` to call at
  // all, and refuses late when the send comes back saying it failed. Driving only the late one
  // left `NO_SEND` mutable to a bare `return` with this part still green.
  const NO_SEND = Symbol("no Chat.send at all");
  const THROWS = Symbol("Chat.send threw");
  const REJECTS = Symbol("Chat.send rejected");
  const REFUSALS = [
    [{ ok: false, reason: "no-crypto" }, "crypto is not up — the encrypted tier pre-empts the send"],
    [{ ok: false, reason: "no-room" }, "no chat channel was wired for this room"],
    [NO_SEND, "chat is not wired at all — there is no `Chat.send` to call"],
    [THROWS, "Chat.send threw rather than answering — the transport failed outright"],
    [REJECTS, "Chat.send REJECTED — the shape production's async send actually produces"],
    [null, "Chat.send answered nothing at all"],
    [{}, "Chat.send answered an object that does not say whether it worked"],
  ];
  (async () => {
    for (const [result, why] of REFUSALS) {
      const log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
      const rot = [{ user: "@idle:hs", pending: [] }];
      const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
      // Re-point chat at a refusing send, the way production answers when it cannot deliver.
      // `sendTo` IS THE ONE THE WARNING CALLS NOW. Re-pointing `send` would leave the refusal
      // unreachable and this part green over a delivery it never tested.
      if (result === NO_SEND) t.sb.Chat = {};
      else if (result === THROWS) t.sb.Chat.sendTo = () => { throw new Error("transport down"); };
      else if (result === REJECTS) t.sb.Chat.sendTo = () => Promise.reject(new Error("transport down"));
      else t.sb.Chat.sendTo = (ch, x) => { t.sent.chat.push(x); return Promise.resolve(result); };

      const first = t.sb.BotRuntime.sweepIdle();
      ok(first.warned.length === 1, "J: APPLIED — the sweep attempted a warning (" + why + ")", first);
      // ── AND THE REPORT IS CORRECTED WHEN IT DID NOT LAND ────────────────────────────────
      // The mark clearing was always right; the REPORT was not. `warned` is pushed
      // synchronously because callers render from it, so an undelivered warning was still
      // announced as a warning that happened — the same intention-as-outcome shape that made a
      // refused kick print as a removal every minute. Asserted after `settled`, below.
      await Promise.resolve(first.settled);
      // GATED ON THE SAME RULE THE CODE APPLIES, not on "this row is in the refusals list". Two
      // of the rows above are DELIVERIES: an answer of `null`, and an object that does not say it
      // failed, are both read as "it went out" — the reading the row below this one asserts. So a
      // blanket `warned.length === 0` here would demand the report drop a warning that did land,
      // and it did exactly that on first run. The list is named REFUSALS and two of its rows are
      // not refusals; the list is about what `Chat.send` ANSWERED, not about what it means.
      const meansFailed = (result === NO_SEND || result === THROWS || result === REJECTS
                           || (result && result.ok === false));
      ok(first.warned.length === (meansFailed ? 0 : 1),
        "J: the report follows delivery (" + why + ") — an undelivered warning comes back OUT, "
        + "because nothing may announce a warning the room never saw, and a delivered one stays "
        + "in", { warned: first.warned, meansFailed: meansFailed });
      // A REAL TICK, NOT TWO MICROTASKS. `_warn`'s `.then` resolves a promise created inside
      // the sandbox realm around one created out here, and cross-realm adoption does not
      // settle within `await Promise.resolve()`. Draining with microtasks alone left the mark
      // in place and this part red against a fix that works — the guard measuring its own
      // impatience rather than the code.
      await new Promise((r) => setImmediate(r));

      // The answer window passes. Nothing was delivered, so nothing may mature.
      t.sb.ServerClock.serverNow = () => T + 11 * MIN;
      const second = t.sb.BotRuntime.sweepIdle();

      if (result === THROWS || result === REJECTS) {
        ok(second.removed.length === 0 && t.sent.removed.length === 0,
          "J: a send that failed OUTRIGHT is the same answer as one that came back failed — the "
          + "person was "
          + "not told either way, so nothing may mature (" + why + ")",
          { reported: second.removed, applied: t.sent.removed });
      } else if (result === NO_SEND) {
        ok(second.removed.length === 0 && t.sent.removed.length === 0,
          "J: with no chat wired the warning DEFINITELY did not land, so nothing may mature — "
          + "this is the early refusal, and it is a different branch from a send that came back "
          + "failed (" + why + ")", { reported: second.removed, applied: t.sent.removed });
        ok(t.sent.chat.length === 0,
          "J: APPLIED — and nothing reached chat, so the case is the one it claims to be", t.sent.chat);
      } else if (result && typeof result === "object" && !("ok" in result)) {
        // PINS THE READING AGAINST `ui/interface.js`, which asks `res && res.ok === false`. A
        // result that does not SAY it failed is not claiming to have failed, so the clock runs
        // on. Tightening this to `r.ok !== true` would clear the mark here, and a bot whose chat
        // answered this shape would warn forever and never remove — so the two readings are a
        // real behavioural fork, and this is the case that tells them apart.
        ok(second.removed.length === 1,
          "J: an answer that does not say it failed is not a refusal — the same reading "
          + "`ui/interface.js` applies to this return, rather than a second stricter one ("
          + why + ")", second);
      } else if (result === null) {
        // A caller that answers nothing is not CLAIMING a failure — `ui/interface.js` reads this
        // return as `res && res.ok === false`, and this guard must not invent a stricter contract
        // than the one the tree already has. The clock legitimately runs on.
        ok(second.removed.length === 1,
          "J: a send that answers nothing is not a refusal — matching `ui/interface.js`'s own "
          + "`res && res.ok === false` reading, so the removal proceeds (" + why + ")", second);
      } else {
        ok(second.removed.length === 0 && t.sent.removed.length === 0,
          "J: an undelivered warning does NOT mature into a removal — the person would have been "
          + "removed having never been told, which is what the two stages exist to prevent ("
          + why + ")", { reported: second.removed, applied: t.sent.removed });
        ok(second.warned.length === 1,
          "J: and the next sweep WARNS AGAIN rather than going quiet — the loop is "
          + "self-correcting, so a bot that cannot reach chat warns forever and removes nobody, "
          + "which is the safe direction (" + why + ")", second);
      }
    }

    // THE CONTROL, and PART J is worthless without it: the same clock and the same room, with a
    // send that LANDS, still removes. Otherwise this part would pass on a sweep that never
    // removes anybody for any reason.
    {
      const log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
      const rot = [{ user: "@idle:hs", pending: [] }];
      const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
      t.sb.BotRuntime.sweepIdle();
      await new Promise((r) => setImmediate(r));
      t.sb.ServerClock.serverNow = () => T + 11 * MIN;
      const gone = t.sb.BotRuntime.sweepIdle();
      ok(gone.removed.length === 1 && t.sent.removed.length === 1,
        "J CONTROL: a warning that DID land still matures into a removal — so J is the delivery "
        + "result doing work, not a sweep that stopped removing", gone);
    }
    // ══ PART D2 — A REMOVAL THAT FAILS DOES NOT RESTART THE WARNING ══════════════════════════
    // THE LOOP THIS CLOSES, and it was live. The pending mark was deleted the moment the removal
    // was DECIDED, before the send was attempted, and `_remove` swallowed every failure. So a
    // removal that did not land left the person in the rotation with no mark — the next pass read
    // them as never warned, posted a fresh public accusation, and started a fresh full grace
    // period. One accusation per grace, indefinitely, about somebody already decided against.
    //
    // The old comment called that self-correcting. It corrects in the wrong UNIT: what repeats is
    // not the removal but the whole cycle, and the repetition is visible to the entire room.
    //
    // DRIVEN THROUGH A FAILING `Queue.remove`, which is the production seam — `_remove` reads the
    // resolved value, and a refusal object means the event never went out.
    {
      const log = [act("$1", "@stuck:hs", T - 40 * MIN, "ddjp.dj.join")];
      const rot = [{ user: "@stuck:hs", pending: [] }];
      const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
      let removeWorks = false;
      // Flipped mid-test rather than stubbed two ways, so both passes go through one code path.
      t.sb.Queue.remove = (u) => {
        if (!removeWorks) return Promise.resolve({ ok: false, reason: "cannot-write" });
        t.sent.removed.push(u); return Promise.resolve();
      };
      const first = t.sb.BotRuntime.sweepIdle();
      ok(first.warned.length === 1,
        "D2: APPLIED — warned on the first pass, or nothing below measures a removal", first);
      await new Promise((r) => setImmediate(r));
      const warnCount = t.sent.chat.length;

      t.sb.ServerClock.serverNow = () => T + 11 * MIN;      // past botPingMs
      const failed = t.sb.BotRuntime.sweepIdle();
      ok(failed.removed.length === 1, "D2: the removal is ATTEMPTED once the grace passes", failed);
      await Promise.resolve(failed.settled);
      ok(failed.removed.length === 0,
        "D2: and a REFUSED removal comes back OUT of the report before anything reads it — the "
        + "same correction the presence half already made, which the idle half had no settle for",
        failed.removed);
      ok(t.sent.removed.length === 0, "D2: nothing reached the queue", t.sent.removed);

      // THE PROPERTY.
      t.sb.ServerClock.serverNow = () => T + 12 * MIN;
      const retry = t.sb.BotRuntime.sweepIdle();
      ok(retry.warned.length === 0,
        "D2: THE SECOND PASS DOES NOT RE-WARN. This is the loop: with the mark deleted before the "
        + "send, a failed removal made the next pass read them as never warned — a fresh public "
        + "accusation and a fresh full grace period, once per grace, indefinitely", retry);
      ok(t.sent.chat.length === warnCount,
        "D2: and the room hears nothing new — the repetition was visible to everyone", t.sent.chat);
      ok(retry.removed.length === 1,
        "D2: it RETRIES the removal instead, on the same evidence and the same branch. Retrying is "
        + "not a second policy competing with the sweep; it IS the sweep", retry);
      await Promise.resolve(retry.settled);

      removeWorks = true;
      t.sb.ServerClock.serverNow = () => T + 13 * MIN;
      const done = t.sb.BotRuntime.sweepIdle();
      await Promise.resolve(done.settled);
      ok(done.removed.length === 1 && t.sent.removed.indexOf("@stuck:hs") >= 0,
        "D2: a removal that lands is reported AND reaches the queue", { done, sent: t.sent.removed });
      ok(t.sent.chat.length === warnCount,
        "D2 CONTROL: across all four passes exactly ONE warning was ever sent — which is what makes "
        + "the rows above a reading of the mark surviving, rather than of a sweep that never warns",
        t.sent.chat.length);
    }
    // ══ PART D3 — JOINING THE QUEUE COUNTS, AND SURVIVES A RESTART ═══════════════════════════
    // THE ORIGINAL REPORT: a staff member joined and was warned twenty seconds later. Pressing
    // Join sends nothing of its own — the app sets a local flag and kicks its reconcile loop,
    // which submits songs, and a submit is a join carrying a video, correctly NOT counted because
    // the same loop fires it unprompted. So the one thing they definitely DID was invisible.
    //
    // The bot derives it instead, from the rotation changing. Derived from the QUEUE and not
    // self-reported, so a modified client cannot claim it: nobody is in the rotation without the
    // events that put them there.
    {
      const log = [
        submit("$old", "@dj:hs", T - 90 * MIN, "vA"),    // joined long ago, nothing since
        submit("$j1", "@fresh:hs", T - 1 * MIN, "vB"),   // just joined, via a SUBMIT
      ];
      const rot = [{ user: "@dj:hs", pending: [] }, { user: "@fresh:hs", pending: [] }];
      const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
      // The replay runs at `start()`, which `tree` already did.
      ok(t.sb.BotRuntime.enteredAt("@fresh:hs") !== null,
        "D3: APPLIED — the queue replay recovered a join time WITHOUT the bot having watched it "
        + "happen. This is the restart case: a browser tab that reloads must arrive at the same "
        + "answer it had before", t.sb.BotRuntime.enteredAt("@fresh:hs"));
      const r = t.sb.BotRuntime.sweepIdle();
      ok(r.warned.indexOf("@fresh:hs") < 0,
        "D3: somebody who just joined is NOT warned. The whole reported bug: they pressed Join, "
        + "the app submitted songs on their behalf, and every event that reached the room was one "
        + "the classifier correctly ignores", r);
      ok(r.warned.indexOf("@dj:hs") >= 0,
        "D3 CONTROL: and somebody who joined ninety minutes ago and did nothing since IS warned — "
        + "so the row above is the join time doing work, not a sweep that stopped warning", r);
      await new Promise((res) => setImmediate(res));

      // ── AND THE ROOM'S OWN SWITCH STILL GOVERNS IT ───────────────────────────────────────
      // Entering is a `rotation` act, so a room that has switched that group off must not have it
      // counted through a side door the settings panel does not show. The bot reads a fact the
      // room never published, which makes it exactly the kind of reading that could quietly
      // ignore the room's answer.
      const off = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN,
                         activityQueue: { rotation: false, moderation: true, skip: true,
                                          vote: true, save: true, settings: true } }, log, rot);
      const r2 = off.sb.BotRuntime.sweepIdle();
      ok(r2.warned.indexOf("@fresh:hs") >= 0,
        "D3: with `activityQueue.rotation` OFF the join no longer counts, and the person who just "
        + "joined IS warned. The bot must not credit an act the room has said does not count",
        r2);
      await new Promise((res) => setImmediate(res));
    }

    // ══ PART D4 — THE REAL REPLAY, AGAINST A REAL StreamManager ══════════════════════════════
    // PART D3 drives the bot's WIRING through a stand-in. This drives the implementation itself,
    // because a stand-in that agrees with a broken original proves nothing. It lives in the
    // backend rather than the bot for a reason `check-boundaries` enforced on the first attempt:
    // `features/` may reach the backend only through `StreamManager` and `MatrixBridge`, and a
    // feature that folds for itself is a second reducer with its own copy of the fall-out rules.
    {
      const sm = loadInContext([
        "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
        "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
        "backends/backend1/streammanager.js",
      ], { Date, Math, JSON, setTimeout, clearTimeout, localStorage:
           { getItem: () => null, setItem() {}, removeItem() {} } });
      const S = sm.StreamManager;
      const ev = (id, l, ts, type, sender, content) => ({
        eventId: id, l: l, ts: ts, type: type, sender: sender,
        senderRank: "uncategorized", content: content || {},
      });
      // A submit BRINGS THEM IN; the next submit does not. That is the whole distinction the type
      // cannot carry, and the reason this exists.
      S._setLogForTest([
        ev("$1", 1, T - 40 * MIN, "ddjp.dj.join", "@a:hs", { v: "v1", u: "http://x/1" }),
        ev("$2", 2, T - 39 * MIN, "ddjp.dj.join", "@a:hs", { v: "v2", u: "http://x/2" }),
        ev("$3", 3, T - 5 * MIN, "ddjp.dj.join", "@b:hs", { v: "v3", u: "http://x/3" }),
      ]);
      const e1 = S.rotationEntries();
      ok(e1["@a:hs"] === T - 40 * MIN,
        "D4: the entry is the join that BROUGHT THEM IN, not the most recent one. `@a:hs` submitted "
        + "twice; only the first changed the rotation, and crediting the second would reset their "
        + "clock every time the reconcile loop topped up a buffer — which is the auto-advance "
        + "exemption defeated through a different door", e1);
      ok(e1["@b:hs"] === T - 5 * MIN,
        "D4: and somebody who joined recently is dated recently", e1);

      // LEAVING FORGETS IT, so a return is dated fresh rather than carrying a stale time that
      // would read as idle the moment they arrive.
      S._setLogForTest([
        ev("$1", 1, T - 40 * MIN, "ddjp.dj.join", "@a:hs", { v: "v1", u: "http://x/1" }),
        ev("$2", 2, T - 30 * MIN, "ddjp.dj.leave", "@a:hs", {}),
        ev("$3", 3, T - 2 * MIN, "ddjp.dj.join", "@a:hs", { v: "v9", u: "http://x/9" }),
      ]);
      const e2 = S.rotationEntries();
      ok(e2["@a:hs"] === T - 2 * MIN,
        "D4: leaving and returning is dated by the RETURN. Carrying the old time would warn "
        + "somebody the moment they came back", e2);

      // GONE MEANS GONE — no entry for somebody not currently in the rotation.
      S._setLogForTest([
        ev("$1", 1, T - 40 * MIN, "ddjp.dj.join", "@a:hs", { v: "v1", u: "http://x/1" }),
        ev("$2", 2, T - 30 * MIN, "ddjp.dj.leave", "@a:hs", {}),
      ]);
      ok(S.rotationEntries()["@a:hs"] === undefined,
        "D4: somebody who left holds no entry at all — absent reads as cannot-say downstream, "
        + "which is the safe direction", S.rotationEntries());
      ok(Object.keys(S.rotationEntries()).length === 0,
        "D4 CONTROL: and the map is EMPTY rather than merely missing that key, so the rows above "
        + "are the replay tracking departures rather than never recording anything");
      S._setLogForTest([]);
      ok(Object.keys(S.rotationEntries()).length === 0, "D4: total on an empty log");
    }
    // ══ PART D5 — ONE PERSON, ONE MESSAGE; AND THE PRESENCE MARK BEHAVES LIKE THE QUEUE'S ═════
    // Somebody crossing both thresholds is having ONE thing happen to them. Two messages in the
    // same minute about the same silence reads as a broken bot and doubles the traffic in the room
    // the bot exists to keep tidy — so the presence half ADOPTS a standing queue warning instead
    // of answering it with a second one.
    {
      const log = [act("$1", "@both:hs", T - 90 * MIN, "ddjp.dj.join")];
      const rot = [{ user: "@both:hs", pending: [] }];
      const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN, botAfkMs: 15 * MIN,
                       botPresenceChat: false }, log, rot);
      MEMBERS = ["@bot:hs", "@both:hs"];
      const q = t.sb.BotRuntime.sweepIdle();
      ok(q.warned.indexOf("@both:hs") >= 0,
        "D5: APPLIED — the QUEUE warned them, or the adoption below has nothing to adopt", q);
      await new Promise((res) => setImmediate(res));
      const before = t.sent.chat.length;
      const pres = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(pres && pres.settled);
      ok(t.sent.chat.length === before,
        "D5: and the presence pass sends NO second message — the standing queue warning already "
        + "told them they are AFK, and the deadline they were given is the one that applies",
        { before: before, after: t.sent.chat.length, pres: pres });
    }

    // ── AN UNDELIVERED PRESENCE WARNING DOES NOT START A CLOCK ────────────────────────────────
    // The mark is what makes a removal follow. Set it for a message that never arrived and the
    // person is removed without ever having been told — the one outcome this whole rule must never
    // produce, and the reason the queue half clears its mark on every non-delivery path.
    {
      const log = [act("$1", "@quiet:hs", T - 90 * MIN, "ddjp.dj.join")];
      const t = tree({ botAfkMs: 15 * MIN, botPingMs: 10 * MIN, botPresenceChat: false }, log, []);
      MEMBERS = ["@bot:hs", "@quiet:hs"];
      t.sb.Chat.sendTo = () => Promise.resolve({ ok: false, reason: "no" });
      const r1 = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(r1 && r1.settled);
      ok(r1.warned.indexOf("@quiet:hs") < 0,
        "D5: an undelivered presence warning comes back OUT of the report", r1);
      // The clock must not have started: even long past the grace, the next pass WARNS rather
      // than removes.
      t.sb.ServerClock.serverNow = () => T + 60 * MIN;
      t.sb.Chat.sendTo = (ch, x) => { t.sent.chat.push(x); return Promise.resolve({ ok: true }); };
      const r2 = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(r2 && r2.settled);
      ok(r2.removed.length === 0 && r2.warned.indexOf("@quiet:hs") >= 0,
        "D5: and the next pass WARNS rather than removing — the failed message started no clock, "
        + "so nobody is removed for a warning the room never saw", r2);
    }
    // ── A REFUSED PRESENCE KICK DOES NOT RESTART THE WARNING CYCLE ───────────────────────────
    // The same loop the queue half closed at v342, in the other half. Clear the mark before the
    // kick is known to have landed and a failure leaves the person in the channel with no mark —
    // so the next pass reads them as never warned and posts a fresh public warning and a fresh
    // full grace, once per grace, indefinitely, about somebody already decided against.
    {
      const log = [act("$1", "@stuckp:hs", T - 90 * MIN, "ddjp.dj.join")];
      const t = tree({ botAfkMs: 15 * MIN, botPingMs: 10 * MIN, botPresenceChat: false }, log, []);
      MEMBERS = ["@bot:hs", "@stuckp:hs"];
      const w = t.sb.BotRuntime.reconcilePresence();          // warns
      await Promise.resolve(w && w.settled);
      const warnCount = t.sent.chat.length;
      ok(w.warned.indexOf("@stuckp:hs") >= 0, "D5: APPLIED — warned before the failing kick", w);

      // The kick now fails. `_dropPresence` reads the transport's answer, so refusing there is the
      // production seam rather than a stubbed internal.
      t.sb.MatrixBridge.removeFromPresence = () => Promise.resolve({ ok: false, reason: "cannot" });
      t.sb.ServerClock.serverNow = () => T + 11 * MIN;
      const f = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(f && f.settled);
      ok(f.removed.length === 0,
        "D5: a refused kick comes back OUT of the report", f);
      ok(t.sent.chat.length === warnCount,
        "D5: and NO fresh warning is posted — the mark survived the failure, so the next pass "
        + "retries the removal instead of restarting the whole cycle", t.sent.chat);

      t.sb.ServerClock.serverNow = () => T + 12 * MIN;
      const again = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(again && again.settled);
      ok(again.warned.length === 0,
        "D5: still no re-warning on the pass after that — this is the loop, and it is closed on "
        + "both halves now", again);
    }
    // ── THE PRESENCE HALF SAYS "YOU'RE BACK" TOO ─────────────────────────────────────────────
    // Found by auditing the two halves against each other rather than by a failure. The queue
    // sends a public thank-you for the reason its own comment gives: a warning is a public message
    // naming somebody, and cancelling it in silence leaves that accusation as the last word. The
    // presence half cleared its mark and said nothing.
    {
      const log = [act("$1", "@back:hs", T - 90 * MIN, "ddjp.dj.join")];
      const t = tree({ botAfkMs: 15 * MIN, botPingMs: 10 * MIN, botPresenceChat: false }, log, []);
      MEMBERS = ["@bot:hs", "@back:hs"];
      const w = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(w && w.settled);
      ok(w.warned.indexOf("@back:hs") >= 0, "S: APPLIED — warned, so there is a warning to cancel", w);
      const afterWarn = t.sent.chat.length;
      // They act. The room now counts them as around, so the reconcile sees them in `want`.
      log.push(act("$2", "@back:hs", T + 1 * MIN, "ddjp.dj.skip"));
      t.sb.ServerClock.serverNow = () => T + 2 * MIN;
      const b = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(b && b.settled);
      ok(t.sent.chat.length > afterWarn,
        "S: coming back is ANNOUNCED, not just recorded — otherwise the public warning stands as "
        + "the last thing the room was told about them", { before: afterWarn, after: t.sent.chat });
    }

    // ── NOT GUARDED, AND SAID SO ─────────────────────────────────────────────────────────────
    // `stop()` now clears `_chatSeen`, so an observation cannot follow the bot into another room.
    // A part was written for it and REMOVED rather than kept: the fixture reached a state where
    // the person was neither warned nor skipped and the reason was not established, so the
    // assertion would have been recording a behaviour nobody understood. A guard whose green is
    // unexplained is worse than none — it converts an open question into a settled one.
    //
    // What the change rests on instead: the clear is unconditional and the field is private, so
    // the only way it survives a stop is by deleting that line. Somebody adding a part here should
    // start by finding out why a fresh `start()` in a second room leaves the sweep silent.

    // ── A REFUSED KICK IS REPORTED, NOT SWALLOWED ────────────────────────────────────────────
    // REPORTED FROM A LIVE ROOM. Somebody was warned, the grace passed, and nothing happened —
    // while the log said `membership already correct`. The kick was being refused, the name was
    // spliced back out of `removed`, and with all three lists empty the pass reported the quiet
    // case. **A refusal is an outcome; reporting it as an absence is the same inversion as
    // reporting an intention as an outcome, pointing the other way.**
    {
      const log = [act("$1", "@nokick:hs", T - 90 * MIN, "ddjp.dj.join")];
      const t = tree({ botAfkMs: 15 * MIN, botPingMs: 10 * MIN, botPresenceChat: false }, log, []);
      MEMBERS = ["@bot:hs", "@nokick:hs"];
      const w = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(w && w.settled);
      ok(w.warned.indexOf("@nokick:hs") >= 0, "R: APPLIED — warned, so a removal is due later", w);

      // The homeserver refuses, the way it does when this client cannot kick in that channel.
      t.sb.MatrixBridge.removeFromPresence = () =>
        Promise.resolve({ ok: false, reason: "remove-failed", detail: "M_FORBIDDEN" });
      t.sb.ServerClock.serverNow = () => T + 11 * MIN;
      const r = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(r && r.settled);
      ok(r.removed.length === 0,
        "R: the refused name is not reported as removed", r);
      ok(r.refused.length === 1 && /nokick/.test(r.refused[0]),
        "R: AND THE REFUSAL IS REPORTED IN ITS OWN RIGHT. Without this the pass has three empty "
        + "lists and says the membership is already correct — false exactly when somebody is "
        + "trying to find out why nobody was removed", r.refused);
      ok(/M_FORBIDDEN/.test(r.refused[0]),
        "R: carrying the homeserver's own reason, because `the kick failed` and `the kick failed "
        + "because this client is not a moderator there` send a reader to two different places",
        r.refused);
      // AND THE MARK SURVIVES, so the next pass retries without re-warning.
      const again = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(again && again.settled);
      ok(again.warned.length === 0 && again.refused.length === 1,
        "R: it retries silently rather than restarting the warning cycle — a room the bot cannot "
        + "kick in would otherwise produce one public accusation per grace period, forever", again);

      // ── AND IT REACHES THE LOG, WHICH IS THE ONLY PLACE A PERSON LOOKS ────────────────────
      // The rows above check the REPORT. The report is read by the tick and by nothing else, so a
      // refusal recorded and never printed is the same silence the live room saw. Driven through
      // the real `Logger`, because the reporter is what turns a report into a sentence.
      const said = [];
      const off = t.sb.Logger.on((e) => said.push("[" + e.level + "] " + e.message));
      const third = t.sb.BotRuntime.reconcilePresence();
      await Promise.resolve(third && third.settled);
      try { if (typeof off === "function") off(); } catch (e) {}
      const line = said.filter((l) => /presence removal REFUSED/.test(l))[0] || "";
      ok(line !== "",
        "R: the refusal is PRINTED, not merely recorded. A report nothing renders is the silence "
        + "that was reported from the live room", said);
      ok(/nokick/.test(line) && /M_FORBIDDEN/.test(line),
        "R: naming who and why, so the reader knows it is a room permission and not a bot bug",
        line);
      // ── NOT ASSERTED HERE, AND THE REASON IS THE ASSERTION THAT WAS DELETED ───────────────
      // `_reportPresence` also SUPPRESSES its quiet `membership already correct` line on a pass
      // where everything due was refused — three empty lists look identical whether nothing was
      // due or every removal was rejected. A row was written for it and removed: this part drives
      // `reconcilePresence()` directly, the reporter runs only from the tick, so the assertion
      // passed because the line was never produced at all. **A green that means "nothing
      // happened" is the shape this whole file exists to catch**, and leaving one in would have
      // been worse than the gap. Reaching it needs the tick captured, as `check-bot-runtime`
      // PART J does.
    }
    finish();
  })();
}

// ── PART L — THE WARNING LANDS IN THE ROOM'S MAIN CHAT, NOT THE OPEN TAB ─────────────────────
// `Chat.send` follows the ACTIVE tier, and the active tier comes from `ChatPrefs.chatTier()` — a
// DEVICE-LOCAL, PERSISTENT preference. So the warning used to go wherever the bot's client was
// last pointed: one click on a tab on the bot's machine redirected every warning after it,
// silently and for good.
//
// AND SINCE `presence` BECAME A SELECTABLE TIER the destination could be the presence chat — the
// one channel holding only ACTIVE people. A warning to an idle person would land where they are
// least likely to see it, and may have just been removed from.
{
  const log = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@idle:hs", pending: [] }];
  const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);

  const tiers = t.sb.Room.chatTiers();
  ok(tiers && tiers.mainId,
    "L: APPLIED — the room resolves a MAIN chat channel, or the rest of this part has no subject",
    tiers && { mainTier: tiers.mainTier, mainId: tiers.mainId });

  // POINT THE ACTIVE TIER SOMEWHERE ELSE — the state a stray click on the bot's machine leaves
  // behind. Driven through the device-local preference that really decides it, rather than by
  // calling a Chat method the stub does not carry: `ChatPrefs.chatTier()` is what `chatTiers()`
  // reads for the override, so this is the same lever a person pulls.
  TIER_OVERRIDE.value = "guest";
  const moved = t.sb.Room.chatTiers();
  ok(moved.activeId !== moved.mainId,
    "L: APPLIED — the active tier is now something other than main, or the assertion below could "
    + "pass by coincidence", { active: moved.activeId, main: moved.mainId });

  t.sb.BotRuntime.sweepIdle();
  ok(t.sent.chatTo === tiers.mainId,
    "L: the warning is sent to the room's MAIN chat channel, named explicitly — not to whatever "
    + "the client last had open. A device-local tab preference must not decide where a room-wide "
    + "warning goes", { sentTo: t.sent.chatTo, mainId: tiers.mainId, active: tiers.activeId });
  ok(t.sent.chatTo !== moved.activeId,
    "L CONTROL: and specifically NOT the active tier, so the line above is the main-tier lookup "
    + "doing work rather than the two happening to coincide",
    { sentTo: t.sent.chatTo, active: moved.activeId });
  TIER_OVERRIDE.value = null;   // leave the shared lever as it was found

  // ── AND AN UNRESOLVABLE MAIN CHAT IS A NON-DELIVERY, NOT A FALLBACK ────────────────────────
  // The tempting shape is "if main cannot be found, send to the active tier anyway" — which is
  // exactly the behaviour this part replaces, reintroduced as an error path. A warning that
  // cannot reach the room's main chat did not land, so the pending mark clears and the next sweep
  // tries again, the same rule an outright refusal follows.
  {
    const log2 = [act("$1", "@idle:hs", T - 40 * MIN, "ddjp.dj.join")];
    const rot2 = [{ user: "@idle:hs", pending: [] }];
    const t2 = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log2, rot2);
    // A room with no chat channel at all: `chatTiers()` resolves no main.
    t2.sb.Room._setCurrentForTest({ spaceId: "!s:hs",
      channels: { events_uncategorized: "!ev:hs", presence_chat: "!pres:hs" } });
    ok(!t2.sb.Room.chatTiers().mainId,
      "L: APPLIED — this room resolves NO main chat", t2.sb.Room.chatTiers().mainId);

    const first2 = t2.sb.BotRuntime.sweepIdle();
    ok(first2.warned.length === 1, "L: APPLIED — the sweep still attempted a warning", first2);
    ok(t2.sent.chat.length === 0,
      "L: and nothing was sent anywhere — no falling back to the active tier", t2.sent.chat);

    t2.sb.ServerClock.serverNow = () => T + 11 * MIN;
    const second2 = t2.sb.BotRuntime.sweepIdle();
    ok(second2.removed.length === 0 && t2.sent.removed.length === 0,
      "L: an unreachable main chat does NOT mature into a removal — the person would be removed "
      + "having never been told, which is the case the two stages exist to prevent",
      { reported: second2.removed, applied: t2.sent.removed });
  }
}

// ── PART M — WHO THE BOT MUST NEVER REMOVE ───────────────────────────────────────────────────
// Four rules, and they are not symmetric — which is the point of driving all four rather than
// asserting the two that feel alike:
//
//   the bot, from the QUEUE      -> never   (it is never "active" by the room's rule, so a bare
//                                            comparison would have it remove itself every sweep)
//   the bot, from PRESENCE       -> never   (same, and having dropped itself it could not let
//                                            anybody back in — the channel would freeze)
//   the OWNER, from the QUEUE    -> YES     (a held turn nobody is returning for stalls the room
//                                            whoever it belongs to)
//   the OWNER, from PRESENCE     -> never   (presence is not a turn; it is how the owner sees what
//                                            the room is doing, including while dealing with
//                                            whatever made them look absent)
{
  const OWNER = "@owner:hs", BOT = "@bot:hs", PLAYER = "@p:hs";

  // ── QUEUE: the bot skips itself, and does NOT skip the owner ────────────────────────────────
  {
    const log = [act("$1", BOT, T - 40 * MIN, "ddjp.dj.join"),
                 act("$2", OWNER, T - 40 * MIN, "ddjp.dj.join")];
    const rot = [{ user: BOT, pending: [] }, { user: OWNER, pending: [] }];
    const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);
    const first = t.sb.BotRuntime.sweepIdle();
    ok(first.warned.indexOf(BOT) < 0,
      "M: the bot does not warn ITSELF. It is never active by the room's rule, so a bare "
      + "comparison would have it sweep itself every single pass", first.warned);
    ok(first.warned.indexOf(OWNER) >= 0,
      "M: but it DOES warn the owner — a held turn nobody is coming back for stalls the room "
      + "whoever it belongs to", first.warned);

    t.sb.ServerClock.serverNow = () => T + 11 * MIN;
    const second = t.sb.BotRuntime.sweepIdle();
    ok(second.removed.indexOf(BOT) < 0,
      "M: and never removes itself from the queue", second.removed);
    ok(second.removed.indexOf(OWNER) >= 0,
      "M: and DOES remove the absent owner from the queue", second.removed);
  }

  // ── PRESENCE: neither the bot nor the owner is ever dropped ─────────────────────────────────
  // Nobody is active, so a rule-free reconcile would drop everyone present.
  {
    // THE BOT HAS AUTHORED A COUNTED ACT, which is the realistic state and the only one where the
    // self-exclusion is observable: the AFK sweep's own `ddjp.dj.remove` is `moderation`, and
    // `moderation` counts towards presence. So the bot's own housekeeping makes it look active,
    // and without the filter it would invite itself to the channel it manages — one call per
    // sweep, forever.
    const botActed = [act("$bot", BOT, T - 1 * MIN, "ddjp.dj.remove")];
    const t = tree({ botAfkMs: 15 * MIN }, botActed, []);
    MEMBERS = [BOT, OWNER, PLAYER];
    ROSTER = [{ userId: OWNER, level: 100 }, { userId: BOT, level: 99 },
              { userId: PLAYER, level: 20 }];
    const r = t.sb.BotRuntime.reconcilePresence();
    ok(r.ok === true, "M: APPLIED — the reconcile ran", r);
    ok(r.warned.indexOf(PLAYER) >= 0,
      "M CONTROL: an ordinary inactive member IS picked out — warned on this pass, removed after "
      + "the grace. So the two exemptions below are rules doing work rather than a reconcile that "
      + "touches nobody", { warned: r.warned, removed: r.removed });
    ok(r.removed.indexOf(BOT) < 0,
      "M: the bot never drops itself from presence. Having done so once it could not invite "
      + "anybody back, and the channel would stay frozen", r.removed);
    ok(r.removed.indexOf(OWNER) < 0,
      "M: and never drops the OWNER, however long they have been quiet. Presence is not a turn — "
      + "it is how the owner sees what the room is doing", r.removed);
    ok(r.added.indexOf(BOT) < 0,
      "M: and never INVITES itself either. Excluding the bot from what the channel HOLDS but not "
      + "from what the room WANTS would have it invite itself forever, one call per sweep",
      r.added);
  }

  // ── AN ACCOUNT AT EXACTLY THE BOT'S LEVEL IS NOT THE OWNER ──────────────────────────────────
  // The owner is ABOVE the ladder's top rung; the top rung itself is a rank a person can hold.
  // So the test is strictly greater-than, and `>=` would quietly exempt every high-staff account
  // sitting at the bot's own level — a rule that stops removing anyone is indistinguishable from
  // a rule that was never applied.
  {
    const PEER = "@peer:hs";
    const t = tree({ botAfkMs: 15 * MIN }, [], []);
    MEMBERS = [OWNER, PEER];
    ROSTER = [{ userId: OWNER, level: 100 }, { userId: PEER, level: 99 }];
    const r = t.sb.BotRuntime.reconcilePresence();
    ok(r.ok === true, "M: APPLIED — the reconcile ran", r);
    // ── AT THE BOT'S OWN LEVEL IS ALSO UNREMOVABLE, AND THE REASON IS THE HOMESERVER ─────────
    // This asserted the opposite — that only a level ABOVE the bot is exempt — on the reasoning
    // that the top rung is a rank a person can hold. True about RANK, wrong about what a kick can
    // DO: Matrix refuses a kick unless the kicker OUTRANKS the target, so a peer at the bot's own
    // level cannot be removed by it at all. Attempting it produced a request that always failed,
    // and with the announcement ungated, one "was removed from the presence chat" every 60
    // seconds about somebody who never left. Reported from a live room, about the owner.
    ok(r.removed.indexOf(PEER) < 0,
      "M: an account at the bot's OWN level is NOT dropped either — the homeserver refuses that "
      + "kick, so trying it can only loop", { removed: r.removed, botLevel: t.sb.BotRuntime.botLevel() });
    ok(r.removed.indexOf(OWNER) < 0,
      "M: while the account above it is still kept", r.removed);
  }

  // ── AND AN UNREADABLE ROSTER DROPS NOBODY ───────────────────────────────────────────────────
  // A "never remove X" rule that cannot identify X must remove nobody, not everybody.
  {
    const t = tree({ botAfkMs: 15 * MIN }, [], []);
    MEMBERS = [OWNER, PLAYER];
    ROSTER = null;
    const r = t.sb.BotRuntime.reconcilePresence();
    ok(r.ok === true && r.removed.length === 0,
      "M: an unreadable roster removes NOBODY. The owner cannot be identified, so the safe "
      + "direction is to keep everyone rather than risk dropping the one account that can fix the "
      + "room", r);
  }
  MEMBERS = []; ROSTER = [];   // leave the shared levers as they were found
}

// ── PART N — A BUFFER TOP-UP DOES NOT KEEP SOMEBODY IN THE QUEUE ─────────────────────────────
// REPORTED FROM A LIVE ROOM: an owner sitting still kept "joining the queue" and never went idle.
// `Queue.submitSong` emits `ddjp.dj.join` WITH a video, and `userqueue.js` calls it on its own as
// a playlist cycles. `activityGroupOf` now reads the BODY to tell that from a bare join — and
// `check-setting-endpoints` proves the rule. This proves the FOLD USES IT, which is a different
// question and the one that has cost this project three separate defects.
{
  const log = [
    // A bare join long ago: deliberate, and far outside the window.
    act("$j", "@dj:hs", T - 40 * MIN, "ddjp.dj.join"),
    // A buffer top-up seconds ago. Same TYPE, and it must not count.
    Object.assign(act("$s", "@dj:hs", T - 5000, "ddjp.dj.join"),
                  { content: { t: "ddjp.dj.join", v: "abc123", u: "https://y/abc123" } }),
  ];
  const rot = [{ user: "@dj:hs", pending: [] }];
  const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log, rot);

  const idle = t.sb.Room.idleFor("@dj:hs", T);
  ok(idle && idle.known === true,
    "N: APPLIED — the person's idleness is readable", idle);
  ok(idle && idle.overdue === true,
    "N: a join carrying a VIDEO does not reset the idle clock. It is the client topping the "
    + "buffer up from a playlist, so counting it keeps a person alive in the queue forever while "
    + "they touch nothing — which is the exact failure `ddjp.dj.play` is excluded to prevent",
    idle);

  // THE CONTROL: the same log with the recent event as a BARE join is NOT overdue, so the line
  // above is the body being read rather than the fold ignoring recent events entirely.
  const log2 = [
    act("$j", "@dj:hs", T - 40 * MIN, "ddjp.dj.join"),
    act("$b", "@dj:hs", T - 5000, "ddjp.dj.join"),
  ];
  const t2 = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log2, rot);
  const idle2 = t2.sb.Room.idleFor("@dj:hs", T);
  ok(idle2 && idle2.overdue === false,
    "N CONTROL: a BARE join seconds ago DOES reset it — one author, a person pressing join",
    idle2);
}

// ── PART Q — CHAT KEEPS A QUEUE PLACE, AND AN UNSEEN WINDOW REMOVES NOBODY ───────────────────
// Chat NEVER reaches the Spine, so `idleFor` cannot answer this and the bot's own observation
// does. Two questions, and skipping either is a wrongful removal:
//   1. HAS this person chatted inside the window?              -> active, keep them
//   2. Has the bot been WATCHING long enough to say they have not? -> if not, it cannot conclude
//
// The second is the `reachMs` rule applied to an observation instead of a log. A bot that started
// thirty seconds ago knows nothing about the last ten minutes, and treating that as silence would
// remove people for the bot's own downtime.
{
  const log = [act("$j", "@talker:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@talker:hs", pending: [] }];

  // The bot has been watching for an hour: it can answer.
  const seen = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN, botQueueChat: true,
                      chatSince: T - 60 * MIN }, log, rot);
  ok(seen.sb.BotRuntime.sweepIdle().warned.length === 1,
    "Q: APPLIED — with no chat from them, the Spine answer stands and they are warned");

  const chatty = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN, botQueueChat: true,
                        chatSince: T - 60 * MIN, chatSeen: { "@talker:hs": T - 1 * MIN } }, log, rot);
  const r = chatty.sb.BotRuntime.sweepIdle();
  ok(r.warned.length === 0 && r.removed.length === 0,
    "Q: somebody who spoke a minute ago keeps their place, though the SPINE says they have been "
    + "idle forty minutes — chat is the half the log cannot carry", r);

  // OFF, and the same room: the setting is what makes the difference.
  const off = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN, botQueueChat: false,
                     chatSince: T - 60 * MIN, chatSeen: { "@talker:hs": T - 1 * MIN } }, log, rot);
  ok(off.sb.BotRuntime.sweepIdle().warned.length === 1,
    "Q CONTROL: with the room's chat switch OFF the same chat is ignored — so the line above is "
    + "the setting doing work, not chat being counted unconditionally");

  // THE BLIND WINDOW: watching for 30 seconds, judging a 15-minute one.
  const blind = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN, botQueueChat: true,
                       chatSince: T - 30000 }, log, rot);
  const b = blind.sb.BotRuntime.sweepIdle();
  ok(b.warned.length === 0 && b.removed.length === 0,
    "Q: a bot watching for 30 SECONDS does not warn on a 15-minute window — it cannot rule out "
    + "that they spoke before it started, and removing on an answer it cannot give is the failure "
    + "this guards", b);
  ok((b.skipped || []).indexOf("@talker:hs") >= 0,
    "Q: and says so by SKIPPING them, the same word the Spine answer uses when its reach is too "
    + "short — one vocabulary for one situation", b.skipped);
}

// ── PART R — A REFUSED KICK IS NOT A REMOVAL ─────────────────────────────────────────────────
// `removeFromPresence` answers `{ ok: false, reason: "remove-failed" }` when the homeserver
// declines — which it does whenever the target is not outranked. `_dropPresence` discarded that,
// so the name stayed in `removed`, the announcement went out, the person stayed in the channel,
// and the next pass tried again: **one removal notice a minute, forever, about somebody who never
// left.** Reported from a live room, about the owner.
//
// ASSERTED ON THE SOURCE, DELIBERATELY. A first version drove the promise and asserted inside a
// `.then()` — which runs AFTER the file's verdict, so deleting the correction left the guard
// green. Worse, it used a top-level `return` to sequence itself, which in CommonJS returns from
// the MODULE and silently skipped every part below it. Two ways of not running, in one fixture.
{
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "features", "botruntime.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  // ── THESE WERE REGEXES ON EXACT SPELLING AND ARE NOW DRIVEN ────────────────────────────────
  // They were written against `.then((r) => !!(r && r.ok !== false))` and went red when the helper
  // started carrying the REASON as well as the verdict — a change that made the property stronger.
  // A regex proves a shape is typed; it cannot tell a refusal that is read from one that is
  // discarded. The rows below run a refused kick through the real path instead.
  ok(/removed\.splice/.test(code),
    "R: the report is CORRECTED by the outcome — a name that failed to leave comes back out of "
    + "`removed` before anything reads it. TEXTUAL, and the driven version is below");
  // AND THE OWNER EXEMPTION FAILS CLOSED. An unreadable bot level used to leave `ownerIds` an
  // EMPTY object, which protects nobody — the opposite of what a "never remove the owner" rule
  // must do when it cannot tell who the owner is.
  ok(/if \(typeof botLvl !== "number"\) \{\s*ownerIds = null;/.test(code),
    "R: an unreadable bot level makes every drop unsafe, rather than making everyone droppable");
  ok(/settled: Promise\.all\(pending\)/.test(code),
    "R: the pass exposes when those settled, so the tick can wait");
  // ── AND THE ANNOUNCEMENT WAITS — NOW FOR BOTH PASSES, NOT ONE ─────────────────────────────
  // This was written against `Promise.resolve(r && r.settled).then(...)`, which waited only for
  // the PRESENCE kicks. The idle sweep had nothing to wait for, because it reported its warnings
  // and removals synchronously — an undelivered warning and a refused queue removal were both
  // announced as having happened. Both passes settle now, so the wait is over both, and this
  // asserts the stronger property rather than the old spelling.
  ok(/Promise\.all\(\[[\s\S]{0,400}settled[\s\S]{0,240}settled[\s\S]{0,400}_announceRemovals/.test(code),
    "R: and the ANNOUNCEMENT waits for BOTH passes to settle. Announcing first reports refusals "
    + "as removals, which is the spam that was reported — and the idle sweep had the same hole "
    + "with no settle at all");
  ok(/settled: Promise\.all\(settling\)/.test(code),
    "R: the IDLE pass exposes its own settle too. Without it a warning that never sent, and a "
    + "queue removal the fold refused, were both reported as done");
}

// ── PART P — A REMOVAL IS ANNOUNCED, AND BOTH LOSSES ARE ONE LINE ────────────────────────────
// A removal is something the room did TO somebody without being asked, so the room can see it
// happen — the same reason the warning is public rather than a DM.
//
// **COMPOSED FROM BOTH SWEEPS**, which is why it lives at the tick and not inside either one. A
// person can lose their queue place and their presence seat in the same pass, and two lines about
// the same person in the same second read as two events.
{
  const fn = (function () {
    const src = require("fs").readFileSync(
      path.join(__dirname, "..", "features", "botruntime.js"), "utf8");
    const a = src.indexOf("function _announceRemovals");
    let d = 0, i = src.indexOf("{", a);
    for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) break; } }
    return src.slice(a, i + 1);
  })();

  const vm = require("vm");
  function run(q, pr, mainId) {
    const said = [];
    const ctx = {
      Chat: { sendTo: (ch, t) => { said.push({ ch: ch, text: t }); return Promise.resolve({ ok: true }); } },
      Room: { chatTiers: () => ({ mainId: mainId === undefined ? "!main:hs" : mainId }) },
      Promise: Promise, Array: Array, Object: Object, console: console,
    };
    vm.createContext(ctx);
    vm.runInContext(fn + ";globalThis.__a = _announceRemovals;", ctx);
    const returned = ctx.__a(q, pr);
    return { said: said, returned: returned };
  }

  const none = run([], []);
  ok(none.said.length === 0,
    "P: a pass that removed nobody says nothing — a healthy quiet room stays quiet", none.said);

  const qOnly = run(["@a:hs"], []);
  ok(qOnly.said.length === 1 && /removed from the queue —/.test(qOnly.said[0].text),
    "P: a queue-only removal names the queue", qOnly.said);
  ok(!/presence/.test(qOnly.said[0].text),
    "P: and does NOT mention the presence chat they still have", qOnly.said);

  const pOnly = run([], ["@b:hs"]);
  ok(pOnly.said.length === 1 && /removed from the presence chat —/.test(pOnly.said[0].text),
    "P: a presence-only removal names the presence chat", pOnly.said);

  // THE CASE THE COMPOSITION EXISTS FOR.
  const both = run(["@c:hs"], ["@c:hs"]);
  ok(both.said.length === 1,
    "P: losing BOTH in one pass is ONE line, not two — two lines about the same person in the "
    + "same second read as two events", both.said);
  ok(/the queue and the presence chat/.test(both.said[0].text),
    "P: and it names both", both.said);

  // Several people, one line each, in a stable order.
  const many = run(["@b:hs", "@a:hs"], ["@a:hs"]);
  ok(many.said.length === 2,
    "P: one line per PERSON, however many lists they appear in", many.said);
  ok(/@a:hs/.test(many.said[0].text) && /@b:hs/.test(many.said[1].text),
    "P: in a stable order, so two clients narrating the same sweep say the same thing in the same "
    + "sequence", many.said.map((x) => x.text));
  ok(/the queue and the presence chat/.test(many.said[0].text)
     && /removed from the queue —/.test(many.said[1].text),
    "P: each naming what THAT person actually lost", many.said.map((x) => x.text));

  // Same destination rule as the warning.
  ok(many.said.every((x) => x.ch === "!main:hs"),
    "P: sent to the room's MAIN chat, like the warning — not to whichever tab is open", many.said);
  const noMain = run(["@a:hs"], [], null);
  ok(noMain.said.length === 0,
    "P: and with no main chat resolvable it says nothing rather than falling back to the active "
    + "tier", noMain.said);
}

// ── PART O — SOMEBODY WHO WAS NEVER WARNED IS NOT THANKED ────────────────────────────────────
// The acknowledgement exists because a warning is a PUBLIC message naming somebody, and cancelling
// it in silence leaves that as the last word about them. That reasoning applies only to a person
// who was actually warned: greeting somebody who did nothing is the bot talking about people for
// no reason, once per sweep, forever.
{
  const log = [act("$j", "@active:hs", T - 10000, "ddjp.dj.join")];
  const t = tree({ queueIdleMs: 15 * MIN, botPingMs: 10 * MIN }, log,
    [{ user: "@active:hs", pending: [] }]);

  const r = t.sb.BotRuntime.sweepIdle();
  ok(r.ok === true && r.warned.length === 0,
    "O: APPLIED — an active person is not warned", r);
  ok(t.sent.chat.length === 0,
    "O: and nothing at all is said about them. The cancellation is gated on a warning having been "
    + "SENT, not on the person merely being fine", t.sent.chat);

  // AND A SECOND PASS, still active, still silent — so this is the gate holding rather than the
  // first pass happening to be quiet.
  t.sb.BotRuntime.sweepIdle();
  ok(t.sent.chat.length === 0,
    "O CONTROL: still nothing on a second pass", t.sent.chat);
}

// ── PART K — AN ANSWERED WARNING IS SPENT, AND A SECOND ABSENCE EARNS A SECOND ONE ───────────
// PART D drives somebody coming back and STAYING back, so the line that clears the pending mark
// is never load-bearing there: deleting it leaves PART D — and the whole suite — green. What it
// costs is a person who answered a warning, went quiet again days later, and is then removed on
// the strength of the warning they already answered, with no new one sent.
{
  let log = [act("$1", "@p:hs", T - 40 * MIN, "ddjp.dj.join")];
  const rot = [{ user: "@p:hs", pending: [] }];
  let NOW = T;
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  // Chat OFF: see the note on `tree` — a just-started bot is chat-blind, and every part here
  // measures the Spine rule. The chat path has its own part, which turns it on deliberately.
  settings.botQueueChat = false; settings.botPresenceChat = false;
  settings.queueIdleMs = 15 * MIN; settings.botPingMs = 10 * MIN;
  const sent = { chat: [], removed: [] };
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getLog: () => log, getState: () => ({ settings, rotation: rot }),
                     isLegal: () => true, on() {} },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
                    getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
                    // The real table, for the reason the main tree gives: the warning names the
                    // room's MAIN chat, and an empty taxonomy resolves no tier to name.
                    channelTaxonomy: () => REAL_TAX,
                    eventsKeyForLevel: (l) => (l >= 99 ? "events_owner" : "events_uncategorized"),
                    presenceChatKey: () => "presence_chat", amJoined: () => false },
    ServerClock: { serverNow: () => NOW },
    Chat: { send: (x) => { sent.chat.push(x); return Promise.resolve({ ok: true }); },
            sendTo: (ch, x) => { sent.chat.push(x); sent.chatTo = ch; return Promise.resolve({ ok: true }); } },
    Queue: { remove: (u) => { sent.removed.push(u); return Promise.resolve(); } },
  });
  const RT = sb.BotRuntime;
  withRoom(sb);
  RT.start({ roomId: "!r:hs" });
  STARTED.push({ stop: () => { try { RT.stop(); } catch (e) {} } });

  ok(RT.sweepIdle().warned.length === 1, "K: APPLIED — warned while idle");

  // They answer it.
  log = log.concat([act("$back", "@p:hs", T + 1 * MIN, "ddjp.dj.skip")]);
  NOW = T + 2 * MIN;
  ok(RT.sweepIdle().removed.length === 0, "K: APPLIED — the act cancelled the removal");

  // They go quiet again and drift well past BOTH windows before the next sweep.
  NOW = T + 30 * MIN;
  const third = RT.sweepIdle();
  ok(third.removed.length === 0 && sent.removed.length === 0,
    "K: a warning that was ANSWERED is spent — going quiet again must earn a NEW warning, not "
    + "mature the old one. Otherwise somebody who came back when asked is removed later without "
    + "being told, on the strength of a warning they already answered", third);
  // COUNTS WARNINGS, NOT RAW SENDS. The bot also posts a cancellation when somebody it warned comes
  // back, so the chat total is warnings + acknowledgements and a bare `chat.length` conflates two
  // different messages. Filtering by what the warning SAYS keeps the assertion about the thing it
  // is named for.
  const warnings = sent.chat.filter((m) => /AFK check/.test(m));
  const thanks = sent.chat.filter((m) => /you're back/.test(m));
  // ── THE WARNING NAMES BOTH NUMBERS ────────────────────────────────────────────────────────
  // How long they have been quiet says WHY this is happening; how long they have says what to do
  // about it. A warning carrying only the first asks somebody to hurry without saying how much.
  // SHORT, AND STILL CARRYING THE ONE NUMBER THAT CHANGES WHAT THEY DO. How long they have BEEN
  // quiet is the bot's justification, not the reader's problem; how long they have LEFT is the
  // whole message.
  ok(/AFK check/.test(warnings[0] || ""),
    "K: the warning names itself in a few words rather than explaining the queue's rule",
    warnings[0]);
  ok(/in the next \d+ (second|minute)s? to keep your place/.test(warnings[0] || ""),
    "K: and carries the deadline, taken from the same `botPingMs` the removal is timed against — "
    + "passed in rather than re-read, so it cannot disagree with the clock", warnings[0]);

  ok(thanks.length === 1,
    "K: coming back after a warning is ACKNOWLEDGED — a warning is a public message naming "
    + "somebody, and cancelling it in silence leaves that as the last word about them",
    sent.chat);
  ok(third.warned.length === 1 && warnings.length === 2,
    "K: and the second absence produces a SECOND warning, so the two stages restart rather than "
    + "resuming mid-way", { warned: third.warned, chats: sent.chat.length });
}

// EVERY RUNTIME STOPPED. `start` sets an interval, and a live interval keeps the process alive —
// a guard that hangs is a guard that reports nothing, which is worse than one that fails.
function finish() {
for (const t of STARTED) { try { t.stop(); } catch (e) {} }
// THE REAL GATE. Every path — synchronous parts and the awaited ones — arrives here, so this is
// the only point at which `failed` reflects the whole run. See the note at the foot of the file.
if (failed) process.exit(1);

// MOVED TO THE LAST LINE. Two guards in this suite have now printed FAIL and exited 0 because a
// part was appended BELOW their exit check — `check-setting-endpoints` and
// `check-presence-chat`, both found by mutating a rule and watching a "passing" guard stay
// green. Nothing was stranded here yet; that is luck, not structure.
console.log("[idle-sweep] PASS — idleness is measured from acts a PERSON took and acted on in two "
  + "stages. The events a client authors by itself — the auto-advance, the length report, the "
  + "player error — count for nobody, driven at a DJ whose client is still emitting at `now` and "
  + "who is correctly overdue, with a control at the same timestamps where a deliberate act flips "
  + "the reading. `idleFor` keeps three answers apart that a caller must not confuse: a number, "
  + "`known:false` for evidence the log no longer holds, and null for cannot-answer — and "
  + "`known:false` is never overdue, because treating absence as maximal idleness would empty the "
  + "rotation after every trim. The sweep WARNS to chat, waits `botPingMs`, and RE-READS idleness "
  + "before removing, so coming back cancels it — driven both ways, since a sweep that never "
  + "removed would pass the cancellation half alone. It skips people it cannot measure and never "
  + "sweeps itself. The rule is the ROOM's: the default queue map ignores a vote and a room that "
  + "counts them reads the same log differently, an unreadable map fails closed, and the QUEUE map "
  + "is the one read rather than the more generous presence one. A warning that was never "
  + "DELIVERED does not mature into a removal and is re-sent instead, driven through the real "
  + "async result rather than the always-succeeding stub every other part supplies; and a warning "
  + "that was ANSWERED is spent, so a second absence earns a second warning rather than resuming "
  + "a stage the person already answered (" + A + " assertions)");
}


// ── THE GATE MOVED INSIDE `finish()`, AND THE LAST LINE WAS NOT LATE ENOUGH ──────────────────
// It sat here, at the end of the source, on the reasoning that nothing can be appended underneath
// it. True — and insufficient, because this file grew an ASYNC section. The synchronous tail runs
// BEFORE the awaited parts resolve, so `failed` was read while the async assertions had not yet
// been made: the guard printed `FAIL`, then printed `PASS`, then exited 0.
//
// Caught by mutating the pending-mark rule and watching this file report a clean exit while its
// own output said otherwise. `run-all` reads the OUTPUT and so caught it anyway, which is exactly
// why it went unnoticed — the suite was right and the guard was lying underneath it.
//
// `finish()` is the one place every path ends, sync and async alike, so the gate belongs there.

// ── PART Z — THE CHAT OBSERVATION BELONGS TO ONE ROOM ────────────────────────────────────────
// `stop()` carried a paragraph ending "Cleared explicitly." with NO clearing line under it, and
// the handoff recorded the fix as shipped. The map is `const`, which is very likely why: the
// assignment would have thrown, so it was deleted and the comment stayed. A message naming an act
// it does not take is worse than no message — a reader infers the mechanism and stops looking.
//
// THE FIX IS NOT "CLEAR ON STOP", AND THE ROWS BELOW ARE WHY. `stop()` also runs on a RANK
// CHANGE in the same room, where the observations are about this room and are TRUE. And the chat
// listener has no `offMessage` — `features/chat.js` says so — so it keeps recording while stopped
// and in every later room, which clearing on stop could never have covered. Two changes, and each
// row here fails without one of them.
//
// EVERY READING HERE KEEPS THE PERSON: the wrong ones report a truth about the wrong room rather
// than removing anybody. What is under test is whether the bot's answer is HONEST.
//
// The rows are named rather than counted, and that is not pedantry here — this part said "three
// rows" and then grew a fourth plus a control while the sentence stayed, in the same session that
// removed a wrong figure from `botruntime.js`. The cases are: same room, different room, chat
// during the stop in a different room, chat during the stop in the SAME room, and the control.
{
  const MIN = 60000;
  function chatTree(sameRoom, recordWhileStopped, chatBeforeStop) {
    let NOW = 1000000, onMsg = null;
    const ROT = [{ user: "@alice:hs", pending: [{ videoId: "AAAAAAAAAAA" }] }];
    const sb = loadInContext([
      "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "features/botruntime.js",
    ], {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      StreamManager: { getLog: () => [], isLegal: () => true, on() {},
        getState: () => ({ settings: { botQueueChat: true, queueIdleMs: 15 * MIN, botPingMs: 10 * MIN },
                           rotation: ROT, nowPlaying: null }) },
      MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99,
        getRoster: () => [], onRawEvent() {}, offRawEvent() {}, joinedMembersOf: () => [],
        invitedMembersOf: () => [], mayAuthor: () => true },
      ServerClock: { serverNow: () => NOW },
      Room: { rankLadder: () => [{ name: "owner", level: 99 }], chatTiers: () => ({ mainId: "!m" }),
              idleFor: () => ({ known: true, overdue: true, idleMs: 99 * MIN, windowMs: 15 * MIN,
                                reachMs: 99 * MIN }) },
      Skip: { skip: () => Promise.resolve({ ok: true }) },
      Chat: { onMessage: (fn) => { onMsg = fn; }, sendTo: () => Promise.resolve({ ok: true }),
              readableTiers: () => ["a"] },
      Queue: { remove: () => Promise.resolve() },
    });
    sb.BotRuntime.start({ roomId: "!roomA", channels: { presence_chat: "!p" } });
    NOW += 30 * MIN;                       // watched long enough to be entitled to conclude
    if (chatBeforeStop !== false) onMsg("$1", "@alice:hs", "hi", false, NOW);
    sb.BotRuntime.stop();
    if (recordWhileStopped) onMsg("$2", "@alice:hs", "again", false, NOW + 1000);
    NOW += 2 * MIN;
    sb.BotRuntime.start({ roomId: sameRoom ? "!roomA" : "!roomB", channels: { presence_chat: "!p" } });
    // STILL INSIDE THE NEW RUN'S BLIND WINDOW, WHICH IS THE ONLY PLACE THIS SHOWS. Watch a full
    // window instead and every stamp from before the restart has aged out on its own, so every row
    // reads alike and the test distinguishes nothing. Measured: the first draft did exactly that
    // and passed against the unfixed tree.
    NOW += 2 * MIN;
    const r = sb.BotRuntime.sweepIdle();
    return r.skipped.indexOf("@alice:hs") < 0 && r.warned.indexOf("@alice:hs") < 0;
  }

  ok(chatTree(true, false) === true,
    "Z: a rank change in the SAME room keeps the observation — she really did chat here, and "
    + "answering `cannot conclude` would replace a true answer with a vague one. `stop()` runs on "
    + "a rank change, so clearing there would have thrown this away");
  ok(chatTree(false, false) === false,
    "Z: a DIFFERENT room does not inherit it. This is the defect: somebody who chatted in room A "
    + "was credited with being around in room B, where they may never have spoken");
  ok(chatTree(false, true) === false,
    "Z: and a different room does not inherit it even when chat lands DURING the stop");

  // ── THE ROW THAT ISOLATES THE SECOND CHANGE, AND ITS ABSENCE LET A MUTATION SURVIVE ────────
  // Removing the `!_running` guard left this file GREEN, because every row above changes room and
  // the room-change clear wiped the stray record anyway. To see that guard at all the room must
  // STAY THE SAME — so the clear does not fire — and the only chat must arrive while the bot is
  // stopped. Two changes, and a fixture that exercises both at once tests neither.
  ok(chatTree(true, true, false) === false,
    "Z: chat arriving WHILE THE BOT IS STOPPED is not recorded, even in the same room. `Chat` has "
    + "no `offMessage` — its own comment says so — so the listener stays subscribed for the life "
    + "of the tab and would otherwise go on recording with nothing reading it. It also gives the "
    + "map an invariant it lacked: everything in it falls inside the window `_chatSince` claims "
    + "to have watched");

  // AND THE CONTROL FOR THAT ROW: the same shape with the chat arriving while the bot IS running
  // reads active, so the row above is the guard doing work rather than a fixture that records
  // nothing.
  ok(chatTree(true, false, true) === true,
    "Z CONTROL: the same room, the same person, chatting while the bot is RUNNING — reads active");
}

if (failed) process.exit(1);   // a synchronous failure, for a run that never reaches `finish()`