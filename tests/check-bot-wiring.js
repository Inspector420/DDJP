// tests/check-bot-wiring.js
// WALL: THE OWNER BOT IS ACTUALLY REACHED, AND STOPS BEING REACHED WHEN IT SHOULD.
//
// `BotRuntime` shipped at J17 correct and called by nobody. `BotSettings` (J18) and `Reputation`
// (J19) are its dependents and were reached the same amount: never. Three modules loaded by
// index.html, driven by every guard, and dead in every running client — which is this tree's
// most-recorded shape and the exact reason `check-wiring` exists. This is that guard's rule
// applied to the bot: a runtime with no call site is indistinguishable from a missing feature.
//
// PART A — the runtime is STARTED from `features/room.js`, not from a second entry site.
// PART B — the gate is the ROOM's level, never the caller's claim.
// PART C — a room switch STOPS a runtime before it starts one.
// PART D — a rank change re-evaluates, in BOTH directions.
// PART E — two accounts at the bot's level are DETECTED and named.
// PART F — the settings writer handed to the bot is the one the panel uses, not a second path.

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { loadInContext } = require("./_load.js");

function rd(p) { return fs.readFileSync(path.join(__dirname, "..", p), "utf8"); }

function fail(m, g) { console.log("[bot-wiring] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

let A = 0;
const asserted = () => { A++; };

const room = rd("features/room.js");
const bridge = rd("backends/backend1/matrixbridge.js");
const html = rd("index.html");

// ── PART A — STARTED, AND FROM ONE DOOR ──────────────────────────────────────────────────────
// The structural half. `_initModules` is the single function both room-entry paths (create and
// join) pass through; a start placed at the two call sites instead is the shape J15 found — a
// rule enforced at one door out of two, correct everywhere its author looked.
{
  ok(room.indexOf("BotRuntime.start(") >= 0,
    "A: features/room.js must CALL BotRuntime.start — before this guard the only mention of the "
    + "runtime anywhere outside its own file was a comment in matrixbridge.js saying nothing "
    + "called it"); asserted();

  // The call lives inside `_evaluateBot`, and `_evaluateBot` is called from `_initModules`.
  const evalIdx = room.indexOf("function _evaluateBot");
  ok(evalIdx > 0, "A: `_evaluateBot` must exist as the one place the runtime is started"); asserted();

  const initIdx = room.indexOf("function _initModules");
  ok(initIdx > 0, "A: `_initModules` must exist — it is the shared door"); asserted();
  const initBody = room.slice(initIdx);
  const initEnd = initBody.indexOf("\n  }\n");
  ok(initBody.slice(0, initEnd).indexOf("_evaluateBot()") >= 0,
    "A: `_initModules` must call `_evaluateBot()`. Both room-entry paths run it, so one call here "
    + "covers create AND join; a call at each entry site instead would be two copies free to "
    + "diverge, which is what J15 measured"); asserted();

  // And exactly one start site, so the "one door" claim is a measurement rather than a hope.
  const starts = (room.match(/BotRuntime\.start\(/g) || []).length;
  ok(starts === 1,
    "A: exactly ONE `BotRuntime.start(` call site in room.js — a second is a second door and the "
    + "gate would have to be repeated at it", starts); asserted();

  // The runtime must already be loaded when room.js runs. Both are in index.html; order matters
  // only in that a missing tag means the global is absent and `_evaluateBot`'s typeof guard
  // silently makes the bot permanently off — which is the botsettings.js defect exactly.
  ok(html.indexOf("features/botruntime.js") >= 0,
    "A: botruntime.js must be in the app's load order — a module the page never loads is a module "
    + "that does not exist at runtime, and `_evaluateBot` would take its typeof-undefined path "
    + "forever with nothing reporting it"); asserted();
}

// ── PART B — THE LEVEL IS THE ROOM'S, NOT THE CALLER'S ───────────────────────────────────────
// `BotRuntime.start` deliberately takes no level argument. This asserts room.js does not smuggle
// one in, which would turn the gate into a check of this file's claim about itself.
{
  const evalIdx = room.indexOf("function _evaluateBot");
  const body = room.slice(evalIdx, evalIdx + 2000);
  ok(!/BotRuntime\.start\(\{[^}]*level\s*:/.test(body),
    "B: room.js must NOT pass a `level` into start(). The runtime reads it from the room itself; "
    + "a caller that could supply one could supply the bot's, and the gate would then be checking "
    + "the caller rather than the room"); asserted();

  // Driven, not only read: the gate refuses a level it was handed but the room does not hold.
  const s = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/capabilities.js",
  ], { Date });
  const top = Math.max.apply(null, s.Capabilities.LADDER.map((r) => r.level));
  ok(top === 99,
    "B: the ladder's top rung is the bot's level, derived — if this changes, the bot level moves "
    + "with it and nothing here restates 99", top); asserted();
}

// ── PART C — A ROOM SWITCH STOPS BEFORE IT STARTS ────────────────────────────────────────────
// `_initModules` runs on every entry INCLUDING a switch. The raw fan-out the runtime subscribes
// to is not scoped to a room, so a runtime left over from the previous room would go on acting on
// requests from a room the user has left, at a level they may not hold in this one.
{
  const evalIdx = room.indexOf("function _evaluateBot");
  const body = room.slice(evalIdx, evalIdx + 1200);
  const stopIdx = body.indexOf("BotRuntime.stop()");
  const startIdx = body.indexOf("BotRuntime.start(");
  ok(stopIdx > 0, "C: `_evaluateBot` must stop any existing runtime"); asserted();
  ok(stopIdx < startIdx,
    "C: the stop must come BEFORE the start, textually and therefore at runtime. A runtime from "
    + "the previous room watching this one is not a leak of memory but of AUTHORITY"); asserted();

  // Unconditional, because `stop()` answers `not-running` harmlessly. NOT DRIVEN, and said so
  // rather than counted as covered: `current` is never set back to null in room.js and both
  // callers reach `_evaluateBot` with it set, so the early return cannot fire and moving the stop
  // across it changes nothing observable. Driven at v322 (M16) and correctly stayed green. What
  // IS load-bearing is the order against the START, which M17 turns red.
  ok(!/if\s*\([^)]*running[^)]*\)\s*\{?\s*try\s*\{\s*BotRuntime\.stop/.test(body),
    "C: the stop must be UNCONDITIONAL — stop() answers `not-running` harmlessly, so guarding it "
    + "adds a condition that can be wrong and removes nothing"); asserted();
}

// ── PART D — A RANK CHANGE RE-EVALUATES, BOTH WAYS ───────────────────────────────────────────
// Bot mode is a reading of this account's level, so a level change is exactly when it can start
// or stop being true. Deferring to the next room entry leaves a DEMOTED account authoring
// settings at an authority it no longer holds, for as long as it stays in the room.
{
  const rewire = room.indexOf("function _rewireWriteChannel");
  ok(rewire > 0, "D: `_rewireWriteChannel` is the rank-change handler and must exist"); asserted();
  const body = room.slice(rewire, rewire + 2600);
  ok(body.indexOf("_evaluateBot()") >= 0,
    "D: the rank-change handler must re-evaluate the bot, beside the events-channel and "
    + "checkpoint rewires that are already there for the same reason — a promotion or demotion "
    + "must switch it IMMEDIATELY, not at the next room entry"); asserted();

  // Both directions land, because _evaluateBot stops before it starts (PART C). This asserts the
  // handler does not call `start` directly, which would be the one-way version of the same wire.
  ok(body.indexOf("BotRuntime.start(") < 0,
    "D: the rank handler must go through `_evaluateBot`, not call start() itself — a direct start "
    + "here would promote correctly and never demote, and a demoted bot is the dangerous half"); asserted();
}

// ── PART E — TWO BOTS ARE DETECTED AND NAMED ─────────────────────────────────────────────────
// Power levels are settable from any Matrix client, so this app cannot PREVENT a second account
// reaching the bot's level — the gap J52 already names for the upgrade gate. Detection is what is
// available, and it turns a silent lost update into something a person can act on.
{
  ok(bridge.indexOf("function accountsAtLevel") >= 0,
    "E: the transport must be able to answer who sits at a given level. Before this it could read "
    + "only its OWN level, so 'is there a second bot' was not a question the app could ask"); asserted();

  // AND `_warnIfSecondBot` MUST ACTUALLY CALL IT. Third instance of the existence-vs-use hole in
  // this one guard (after PART G's `_mayUpgrade` and this part's `_warnIfSecondBot` call site),
  // found by driving M12: replacing the transport read with a hardcoded empty result kept it
  // green — a detector reporting "no second bot" for a room it never looked at, which is the
  // plausible-value shape the function's own null-vs-empty contract exists to prevent.
  const warnIdx = room.indexOf("function _warnIfSecondBot");
  ok(warnIdx > 0, "E: `_warnIfSecondBot` must exist"); asserted();
  const warnBody = room.slice(warnIdx, warnIdx + 1800);
  ok(/MatrixBridge\.accountsAtLevel\(/.test(warnBody),
    "E: `_warnIfSecondBot` must READ the room's real power levels through "
    + "`MatrixBridge.accountsAtLevel`. Anything else is a detector answering from a value it made "
    + "up, and it would report every room healthy"); asserted();
  ok(/seen\.defaultIsLevel/.test(warnBody) && /seen\.who\.length\s*>\s*1/.test(warnBody),
    "E: it must handle BOTH reported shapes — a room whose default is the bot's level (where no "
    + "list is honest) and two named accounts. Handling only the second reports a room where "
    + "everyone is eligible as healthy"); asserted();
  ok(room.indexOf("function _warnIfSecondBot") >= 0,
    "E: room.js must define the second-bot check"); asserted();

  // AND IT MUST BE CALLED ON THE START PATH — the same existence-vs-use hole PART G had, found
  // by driving M11 after G's was already fixed. Removing the CALL and leaving the function
  // defined kept this green. Worth naming rather than quietly patching: the pattern was
  // identified, one instance was fixed, and the sweep for the rest was not done — which is this
  // project's most-recorded shape, arriving inside the guard written to enforce it.
  const evalIdx2 = room.indexOf("function _evaluateBot");
  const evalBody = room.slice(evalIdx2, evalIdx2 + 3000);
  ok(/_warnIfSecondBot\(\s*r\.level\s*\)/.test(evalBody),
    "E: `_evaluateBot` must CALL `_warnIfSecondBot(r.level)` when a bot starts. A detection that "
    + "runs nowhere is indistinguishable from no detection, and two bots overwriting each other's "
    + "settings would go back to being silent"); asserted();

  // At the LEVEL THE BOT ACTUALLY STARTED AT, not a re-read. Re-reading could disagree with the
  // level the runtime gated on if the room changed underneath, and the pair that matters is
  // "who else holds the level THIS bot is running at".
  ok(evalBody.indexOf("_warnIfSecondBot(botLevel") < 0 && evalBody.indexOf("_warnIfSecondBot()") < 0,
    "E: the check must be passed the started level, not call for its own"); asserted();

  // DRIVEN against the real function, with a fake client, at three shapes.
  const s = loadInContext(["core/logger.js"], { Date });
  // Rebuild the two functions in isolation by extracting them from the source, so this drives the
  // SHIPPED text rather than a copy of it. Extraction over reimplementation: a reimplementation
  // agrees with itself forever.
  const fnSrc = bridge.slice(bridge.indexOf("function allPowerLevels"),
                             bridge.indexOf("function _powerLevels"));
  ok(fnSrc.indexOf("function accountsAtLevel") > 0,
    "E: both functions must sit together — they read the same state event and a copy of the walk "
    + "elsewhere would be free to disagree about what a missing entry means"); asserted();

  let levels = null;
  const sandbox = {
    console,
    client: { getRoom: () => ({ currentState: { getStateEvents: () => ({ getContent: () => levels }) } }) },
  };
  require("vm").createContext(sandbox);
  require("vm").runInContext(fnSrc + "\n;globalThis.accountsAtLevel = accountsAtLevel;", sandbox);
  const at = sandbox.accountsAtLevel;

  levels = { users: { "@a:hs": 99, "@b:hs": 50 }, users_default: 0 };
  let r = at("!r:hs", 99);
  // CONTENTS, NOT `deepStrictEqual`. The array is constructed inside the vm context, so its
  // prototype is that context's Array.prototype and a strict deep-equal fails on the prototype
  // while the contents match exactly. That is a harness artefact, and asserting through it would
  // have been a guard failing for a reason with nothing to do with its subject.
  ok(r.who.length === 1 && r.who[0] === "@a:hs",
    "E: one account at the bot's level is one name", r.who); asserted();
  assert.strictEqual(r.defaultIsLevel, false); asserted();

  levels = { users: { "@a:hs": 99, "@bot2:hs": 99, "@c:hs": 50 }, users_default: 0 };
  r = at("!r:hs", 99);
  ok(r.who.length === 2 && r.who[0] === "@a:hs" && r.who[1] === "@bot2:hs",
    "E: two accounts at the bot's level must BOTH be named — a count alone cannot tell an owner "
    + "which account to demote, and the array is sorted so the report is stable", r.who); asserted();

  // THE CASE A COUNT WOULD GET WRONG. `users_default` is the level of everyone NOT named in the
  // map — an unbounded set. A room whose default IS the bot level is a room where every member is
  // eligible, and the honest answer is that this cannot enumerate them.
  levels = { users: { "@a:hs": 99 }, users_default: 99 };
  r = at("!r:hs", 99);
  ok(r.defaultIsLevel === true,
    "E: a room whose DEFAULT is the bot level must be reported as such rather than answered with "
    + "a list of one. Folding the default into `who` would name one account while every member "
    + "held the same power; omitting the flag would report the room as healthy", r); asserted();

  // Unreadable state is null, not {} — an empty map is a real answer meaning "nobody is named",
  // and a caller that could not tell them apart would report a room it failed to read as a room
  // with no bot. This is F-shaped: a plausible value where an error belongs.
  levels = null;
  const before = at("!r:hs", 99);
  ok(before === null,
    "E: unreadable power levels must answer null, never an empty result. Returning {} here is "
    + "the whole failure signature this tree keeps finding — a plausible value instead of a "
    + "refusal, indistinguishable from the healthy case", before); asserted();
}

// ── PART F — ONE SETTINGS WRITER, AND SILENCE IS NOT SUCCESS ─────────────────────────────────
// The blob is LAST-WRITE-WINS over the whole object, so it must carry EVERY key each time. The
// panel's writer merges onto the current blob for exactly that reason. A bot with its own writer
// is the second copy that eventually posts a partial blob and silently drops every key it forgot
// — which room.js records as how the advanced dials became unwritable, with no error anywhere.
//
// AND THE FAILURE DIRECTION, WHICH THE FIRST VERSION OF THIS GUARD MISSED. `setSettings` is total
// and returns rather than throwing; `authorIfPermitted` reads "did not throw" as "wrote". Handing
// over the bare function made every silent failure arrive as `ok: true` and counted as ACTED.
{
  const evalIdx = room.indexOf("function _evaluateBot");
  const body = room.slice(evalIdx, evalIdx + 3000);
  ok(/authorSettings:\s*async/.test(body) && body.indexOf("await setSettings(") >= 0,
    "F: the bot must author through `setSettings` — the same function the panel writes through. "
    + "A second writer would be free to post a partial blob, and last-write-wins turns that into "
    + "silent key loss rather than an error"); asserted();
  ok(/if\s*\(!r\s*\|\|\s*!r\.ok\)/.test(body) && /throw new Error/.test(body),
    "F: the bot's wrapper must TURN A FALSE INTO A THROW. `authorIfPermitted` has no other way to "
    + "learn a write did not land, and without this a failed send is reported as acted"); asserted();

  ok(body.indexOf("ddjp.room.settings") < 0,
    "F: `_evaluateBot` must not name the settings event type — naming it here would be a second "
    + "send site for the one event whose whole contract is that it is written in one place"); asserted();

  // DRIVEN: setSettings must report on every path, not return undefined. Read the shipped text —
  // a reimplementation would agree with itself forever.
  const setIdx = room.indexOf("async function setSettings");
  ok(setIdx > 0, "F: setSettings must exist"); asserted();
  const setBody = room.slice(setIdx, room.indexOf("\n  }\n", setIdx));
  // ANYWHERE, NOT ONLY AT LINE START. The first version anchored with `^\s*return;\s*$` and a
  // driven mutation walked straight through it: the real failure paths here are inline —
  // `{ Logger.warn(...); return; }` — which is the shape every one of them actually had. A guard
  // matching the tidy formatting of a defect rather than the defect is a guard that reports the
  // wrong subject, and this one was written to catch exactly this bug.
  const bareReturns = (setBody.match(/\breturn\s*;/g) || []).length;
  ok(bareReturns === 0,
    "F: setSettings must have NO bare `return;` anywhere — undefined is what success used to "
    + "return too, so a caller could not tell a write that happened from one that never left. "
    + "Driven at v322: a writer that silently does nothing makes authorIfPermitted answer ok:true "
    + "and BotRuntime count it as ACTED", bareReturns); asserted();
  ok(setBody.indexOf("return { ok: true") >= 0,
    "F: setSettings must report success explicitly"); asserted();
}

// ── PART G — THE UPGRADE GATE REFUSES THE BOT'S LEVEL (J52) ──────────────────────────────────
// `Capabilities.atLeast(rank, "owner")` is true at the bot's level AND the human owner's, because
// the ladder saturates. But `_powerLevels` pins `m.space.child` at a HIGHER number, and every
// upgrade batch reaches a space-child write — so the app said permitted and the server said 403.
//
// LATENT UNTIL THIS PACKAGE, WHICH IS WHY IT IS GUARDED HERE. Nothing called `BotRuntime.start()`,
// so no account had ever run at the bot's level and nobody could reach the path. Wiring the bot
// made it live. A fix shipped in the same package as the thing that made it reachable, with no
// guard, is a fix the next session can undo without anything going red.
{
  const up = rd("features/roomupgrade.js");
  ok(up.indexOf("function _mayUpgrade") >= 0,
    "G: roomupgrade.js must define `_mayUpgrade`"); asserted();

  // AND IT MUST BE CALLED FROM `upgrade`, WHICH THE FIRST DRAFT OF THIS PART DID NOT CHECK.
  // Driven: reverting the call site to `Capabilities.atLeast(..., "owner")` while leaving the
  // function defined kept this GREEN. Existence is not use — a predicate with no call site is
  // indistinguishable from a missing feature at runtime, which is `check-wiring`'s whole subject
  // and was sitting inside a guard written to enforce it.
  const upIdx = up.indexOf("async function upgrade(");
  ok(upIdx > 0, "G: `upgrade` must exist"); asserted();
  const upBody = up.slice(upIdx, upIdx + 1400);
  ok(/_mayUpgrade\(/.test(upBody),
    "G: `upgrade` must gate through `_mayUpgrade`. Leaving the function defined and gating on "
    + "`atLeast(..., \"owner\")` at the call site admits the bot's level again"); asserted();

  // ── AND IT MUST BE FED A POWER LEVEL, NOT A CHANNEL TIER ────────────────────────────────
  // THIS PART SHIPPED THE BUG IT WAS WRITTEN TO PREVENT. It drove the ARITHMETIC — `atLeast`
  // admits the bot's level, the bot's level is below the space-child requirement — and never
  // drove the INPUT. The call site passed `Room.getMyRank()`, which answers a CHANNEL TIER: a
  // human owner at power level 100 answers **99** there, because 99 is what the owner channel
  // proves and a bot can write to it too. So the gate compared 99 against 100 and refused every
  // owner, while this stayed green proving the comparison was right about numbers nobody supplies.
  ok(!/_mayUpgrade\(\s*Room\.getMyRank\(\)\s*\)/.test(upBody),
    "G: `_mayUpgrade` must NOT be fed `Room.getMyRank()` — that is the highest events channel this "
    + "client can write to, and a human owner at 100 answers 99 from it. Comparing a channel tier "
    + "against a power-level requirement refuses the owner and passes nobody"); asserted();
  ok(/_mayUpgrade\(\s*_myPowerLevel\(\)\s*\)/.test(upBody),
    "G: it must be fed the level read from `m.room.power_levels` — the only source that separates "
    + "99 from 100, and the same one the homeserver enforces the space-child write against"); asserted();
  ok(/getMyPowerLevel\(/.test(up),
    "G: and that reader must go through the transport's power-level call, not a second walk"); asserted();

  // DRIVEN, both sides of the boundary, against the shipped gate text.
  {
    const gi = up.indexOf("function _mayUpgrade");
    const gsrc = up.slice(gi, up.indexOf("function _myPowerLevel"));
    const sandbox = { Capabilities: { atLeast: (lv, n) => lv >= 99 && n === "owner" },
                      MatrixBridge: { spaceChildLevel: () => 100 } };
    require("vm").createContext(sandbox);
    require("vm").runInContext(gsrc + "\n;globalThis.g = _mayUpgrade;", sandbox);
    const g = sandbox.g;
    ok(g(100).ok === true,
      "G: a HUMAN OWNER at 100 must pass. This is the assertion whose absence shipped a button "
      + "that refused everybody", g(100)); asserted();
    ok(g(99).ok === false && g(99).reason === "below-space-write",
      "G: the bot's level must still be refused, by name — the J52 defect", g(99)); asserted();
    ok(g(null).ok === false && g(null).reason === "unreadable-rank",
      "G: an unread level refuses rather than being compared as 0", g(null)); asserted();
  }
  ok(!/atLeast\([^)]*"owner"\)/.test(upBody),
    "G: `upgrade` must not ALSO gate on the saturating predicate directly — that is the admission "
    + "J52 is about, and a second gate beside the right one is the copy that outlives it"); asserted();

  ok(up.indexOf("spaceChildLevel()") >= 0,
    "G: the gate must READ the space-child requirement from the transport. A literal here would "
    + "be the SECOND copy of that number, and two copies of it is what J52 was"); asserted();
  ok(!/rank\s*<\s*100|>=\s*100/.test(up),
    "G: no bare 100 in the upgrade gate — the requirement is derived, so a room whose space rows "
    + "move takes the gate with it"); asserted();

  // ONE SOURCE, asserted in the transport too: the constant the gate reads must be the same one
  // `_powerLevels` writes. Two names for it would satisfy the rule above and still drift.
  ok(bridge.indexOf("const SPACE_CHILD_LEVEL") >= 0,
    "G: the transport must declare the space-child level once"); asserted();
  const plIdx = bridge.indexOf("function _powerLevels");
  const plBody = bridge.slice(plIdx, plIdx + 1600);
  ok(plBody.indexOf('pl.events["m.space.child"] = SPACE_CHILD_LEVEL') >= 0,
    "G: `_powerLevels` must WRITE the same constant the gate reads. If it kept a literal while the "
    + "gate read a constant, the two would be free to disagree — which is the defect, not the fix"); asserted();

  // DRIVEN: the gate's own arithmetic, at the bot's level and the owner's.
  const s = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
                           "backends/backend1/capabilities.js"], { Date });
  const botLevel = Math.max.apply(null, s.Capabilities.LADDER.map((r) => r.level));
  ok(s.Capabilities.atLeast(botLevel, "owner") === true,
    "G: SETUP — the saturation this gate exists for must still be true. If `atLeast` stopped "
    + "admitting the bot's level, this whole part is testing a condition that cannot arise and "
    + "should be re-read rather than left green", botLevel); asserted();
  ok(botLevel < 100,
    "G: SETUP — the bot's level must be below the space-child requirement, or there is no gap to "
    + "gate. This is the measurement J52 rests on", botLevel); asserted();
}

// ── PART H — THE BOT'S SILENCE IS ENFORCED, NOT ASSUMED ─────────────────────────────────────
// **THIS PART FAILS TODAY, DELIBERATELY.** It guards a rule the design states and nothing
// implements, written RED so the next session starts from a failing assertion rather than a
// paragraph — the difference between a decision that is recorded and one that is enforced.
//
// `consensus/bot-model.md` §3 says the bot has no eyes and that silence is the correct report, and
// marked it **[built, by omission]** on the premise that *"a headless bot has no embed"*.
// **THE BOT IS NOT HEADLESS.** It is a normal client of the whole app whose account holds the
// ladder's top rung — that is §1 — so it has an embed, a player, and every module a person has.
//
// FALSIFIED IN THE FIRST LIVE BOT SESSION, three ways in one run: it PLAYED the song
// (`Playback: SONG … vid=7ypRZivutRE`), DECLARED a length (`LEN declaring 241s` — the exact report
// §3 says never fires), and AUTHORED an advance (`ADVANCE pi=genesis — SENDING the next play`),
// refused as backdated only because it lost the race.
//
// **OMISSION IS NOT ENFORCEMENT.** It claims nobody wrote the code; the code was there and nobody
// removed it. A rule with no gate is not built.
{
  const pbSrc = rd("features/playback.js");
  const code = pbSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const uiSrc = rd("ui/interface.js");
  const uiCode = uiSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const prefSrc = rd("core/chatprefs.js");

  // ── THIS PART ASSERTED THE OPPOSITE UNTIL THE OWNER REVERSED THE DESIGN ────────────────────
  // It used to require `playback.js` to refuse the advance and the length report for the bot. The
  // owner's decision: THE BOT IS THE OWNER. It should do what the owner would and act first or
  // second when it acts — its 0ms stagger at the top rung is the POINT, not the problem — and a
  // room whose owner has left still has an authority in it. The old rules made the bot a lesser
  // client at exactly the moment it is meant to be the most reliable one.
  //
  // THE DIFFERENCE MOVED UP A LAYER, and shrank to one thing: with its view off the bot does not
  // LOAD the media. Everything the deleted rules bought then falls out with no rule to enforce —
  // no player, so no measured duration, so no length declared and no wall-clock advance; no
  // player, so no `onError`, so no `ddjp.play.blocked`.
  //
  // A GUARD REWRITTEN TO MATCH THE CODE IS HOW A REGRESSION GETS LAUNDERED, so this says plainly
  // what changed and why, and it still refuses the ORIGINAL defect — a bot streaming every song
  // all day — by requiring the load gate rather than the authoring gates.
  ok(!/BotRuntime/.test(code),
    "H: `features/playback.js` holds NO bot rule. The bot is the owner, so playback must not "
    + "special-case it — a reference here means somebody has re-added a rule the owner removed");
  asserted();

  const loadIdx = uiCode.indexOf("loadVideo(np.song.videoId");
  ok(loadIdx > 0, "H: APPLIED — the media load site was located"); asserted();
  ok(/_botViewOff\(\)/.test(uiCode.slice(Math.max(0, loadIdx - 600), loadIdx)),
    "H: the media load is GATED on the bot's view being off. This is the one difference between "
    + "the bot and any other owner, and it is what stops a bot streaming every song all day");
  asserted();

  // THE DECISION ITSELF IS NOT CHECKED HERE, AND THAT IS DELIBERATE. It moved to
  // `BotRuntime.viewOff`, where `check-bot-view` DRIVES it on all four combinations of (am I the
  // bot) x (is the view on). This part checks WIRING — that the load site asks — because a source
  // regex is the wrong instrument for a decision: the version of this that lived here matched the
  // defensive `typeof` lines rather than the logic, so deleting either real check left it green.
  ok(/BotRuntime\.viewOff/.test(uiCode),
    "H: the panel asks the RUNTIME for the decision rather than re-deriving bot-ness and the pref "
    + "itself — a second copy of it is free to disagree with the first"); asserted();

  ok(/botView:\s*false/.test(prefSrc),
    "H: and the setting is OFF by default. On is the costly direction — a bot that quietly streams "
    + "is a provider bill nobody is enjoying"); asserted();

  // AND THE TICK MUST SURVIVE. The bot still has to see the room to sweep for idle DJs.
  const tickIdx = code.indexOf("function _tick()");
  ok(tickIdx > 0 && !/^\s*if \(_amTheBot\(\)\) return;/m.test(code.slice(tickIdx, tickIdx + 300)),
    "H: the tick itself must NOT be gated — the bot needs to see the room to sweep for idle DJs, "
    + "and stopping it would disable the AFK rule the bot exists for"); asserted();
}

console.log("[bot-wiring] PASS — the owner bot is REACHED: started from the one door both room-entry "
  + "paths share (`_initModules`), re-evaluated by the rank hook so a promotion or demotion lands "
  + "immediately rather than at the next room entry, and stopped before it is started so a runtime "
  + "cannot survive a room switch and act on a room the user has left. The gate stays the ROOM's "
  + "reading: no level is passed in, and the bot's level is the ladder's top rung derived rather "
  + "than a literal. Two accounts at that level are DETECTED and both named — driven at one, at "
  + "two, at a room whose DEFAULT is the bot level (which no count could report honestly), and at "
  + "unreadable state, where null is required because an empty result would be a plausible value "
  + "standing in for a refusal. Settings are authored through the panel's own writer, so the "
  + "last-write-wins blob keeps exactly one author (" + A + " assertions)");
