// tests/check-state-wiring.js
// SUBJECT: ui/screens.js, ui/panels.js, ui/chat.js, features/room.js
// WALL: how the app hears that something changed, kept SIMPLE (owner audit, ddjp_472).
//   1. The app's change subscriptions are made ONCE. They were made on every room entry, and every
//      registry kept each new handler, so after N rooms every change redrew everything N times.
//   2. A rank change restarts the room's writers (queue, skip, playback, reactions, …) only when YOUR
//      rank or write channel changed — it ran for anyone's promotion. Listeners hear every change.
//   3. Panels whose words go stale as time passes (the Feed, People, the DM list, History) share ONE
//      helper, `_whileVisible`: while on screen, tick; the first tick that finds it hidden stops.
//      The Feed, the DM list and History rewrite their ages IN PLACE; People redraws.
//   4. One "people changed" function for both signals; People redraws on a queue change only while it is
//      on screen; a rank change repaints chat so names take their new colour.
// Parts 2 and 3 are DRIVEN (the real functions over doubles); 1 and 4 are SOURCE-LEVEL, and say so.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");

let asserts = 0;
function fail(msg, got) {
  console.log("[state-wiring] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const grab = (rel, name) => { const x = P.extractNamed(rel, name); ok(x.ok, "APPLIED — `" + name + "` is extractable from " + rel, x.stage); return x.source; };

// ═══ PART A — subscriptions are made ONCE, not on every room entry (source-level) ═════════════════
{
  const s = src("ui/screens.js");
  const enter = grab("ui/screens.js", "enterMainScreen");
  const once = grab("ui/screens.js", "_wireMainOnce");
  const subs = /\b(Queue\.onStateChange|Room\.onRankChange|Room\.onMembersChange|UserQueue\.onChange|Reactions\.onChange|Media\.onAvatarChange|RoomUpgrade\.onStatusChange|Room\.onSettingsChange)\(/g;
  ok(!(enter.match(subs) || []).length, "A: ENTERING A ROOM MAKES NO SUBSCRIPTION — none of them is in `enterMainScreen`", enter.match(subs));
  ok((once.match(subs) || []).length === 8, "A: all eight live in `_wireMainOnce`", (once.match(subs) || []).length);
  ok(/if \(_mainWired\) return;[\s\S]{0,80}_mainWired = true;/.test(once), "A: which runs ONCE — the same guard the room list and chat settings use", once.slice(0, 200));
  ok(/_wireMainOnce\(\);/.test(enter), "A: and `enterMainScreen` calls it", null);
  ok(/let _mainWired = false;/.test(s), "A: its flag starts false, once per page", null);
}

// ═══ PART B — a rank change restarts the writers only when YOUR rank or channel changed (driven) ═════
{
  const fn = grab("features/room.js", "_rewireWriteChannel");
  const inits = { n: 0 }, heard = [];
  let myRank = 20, write = "!ev20";
  const ctx = {
    console, Logger: { info() {}, warn() {} },
    current: { channels: { events_player: "!ev20" } },
    MatrixBridge: { getWriteChannelId: () => write, getMyRank: () => myRank, wireCheckpoints: () => { inits.n++; } },
    Queue: { init: () => { inits.n++; } }, Skip: { init() {} }, Playback: { init() {}, setMyRank() {} },
    Reactions: { init() {} }, MediaLength: { init() {} }, MediaBlocked: { init() {}, setMyRank() {} },
    _evaluateBot: () => {}, _rankChangeListeners: [(r) => heard.push(r)],
  };
  vm.createContext(ctx);
  vm.runInContext("let _wiredFor = null;\n" + fn + "\n;globalThis.__r = _rewireWriteChannel;", ctx);
  ctx.__r();
  const first = inits.n;
  ok(first >= 1 && heard.length === 1, "B: APPLIED — the first change wires the room and tells its listeners", { inits: first, heard });
  ctx.__r();   // SOMEONE ELSE's rank changed: mine and my write channel are the same
  ok(inits.n === first && heard.length === 2, "B: SOMEONE ELSE'S RANK CHANGED — nothing is restarted, but the listeners still hear it (People redraws)", { inits: inits.n, heard: heard.length });
  myRank = 60; write = "!ev60";
  ctx.__r();   // MY rank changed
  ok(inits.n > first && heard.length === 3, "B: MY rank changed — the writers are restarted for the new channel", { inits: inits.n });
  // AN UPGRADE ADDS CHANNELS (ddjp_473): `mergeChannels` asks for the rewire, and the writers must be
  // rewired even though MY rank and write channel are the same — backups may now belong on a NEW
  // checkpoints channel. The first version of the skip missed this; this is the case that caught it.
  const merge = grab("features/room.js", "mergeChannels");
  const ctx2 = Object.assign({}, ctx, {
    Store: { config: { saveRoom() {} } },
    MatrixBridge: Object.assign({}, ctx.MatrixBridge, { replayRoom: () => Promise.resolve() }),
  });
  vm.createContext(ctx2);
  vm.runInContext("let _wiredFor = null;\n" + fn + "\n" + merge + "\n;globalThis.__r = _rewireWriteChannel; globalThis.__m = mergeChannels;", ctx2);
  ctx2.__r(); const beforeMerge = inits.n; ctx2.__r();
  ok(inits.n === beforeMerge, "B: PREMISE — nothing changed, so a second rewire restarts nothing", inits.n - beforeMerge);
  ctx2.__m({ checkpoints_staff: "!cp_staff" });
  ok(inits.n > beforeMerge, "B: AN UPGRADE ADDED CHANNELS — the writers ARE rewired, though my rank and channel are the same (backups may move)", { before: beforeMerge, after: inits.n });
  const rm = src("features/room.js");
  ok(/_wiredFor = null;/.test(rm.slice(rm.indexOf("async function join(spaceId)"), rm.indexOf("async function join(spaceId)") + 4000)),
    "B: entering a room forgets the last wiring, so a new room is always wired (source-level)");
}

// ═══ PART C — ONE helper keeps a visible panel current (driven) ═══════════════════════════════════
{
  const helper = grab("ui/panels.js", "_whileVisible");
  const timers = [];
  const ctx = { console, setInterval: (f, ms) => { const t = { f, ms, cleared: false }; timers.push(t); return t; }, clearInterval: (t) => { if (t) t.cleared = true; } };
  vm.createContext(ctx);
  vm.runInContext("const _ticking = Object.create(null);\n" + helper + "\n;globalThis.__w = _whileVisible;", ctx);
  let shown = true, ticks = 0;
  ctx.__w("x", () => shown, () => { ticks++; }, 1000);
  ctx.__w("x", () => shown, () => { ticks++; }, 1000);
  ok(timers.length === 1 && timers[0].ms === 1000, "C: ON SCREEN — one timer, however often it is asked", timers.length);
  timers[0].f();
  ok(ticks === 1, "C: each tick runs the panel's own tick", ticks);
  shown = false; timers[0].f();
  ok(timers[0].cleared && ticks === 1, "C: HIDDEN — the next tick stops it, without ticking", { cleared: timers[0].cleared, ticks });
  shown = true; ctx.__w("x", () => shown, () => {}, 1000);
  ok(timers.length === 2, "C: shown again, a fresh one starts", timers.length);
  shown = false; ctx.__w("x", () => shown, () => {}, 1000);
  ok(timers[1].cleared, "C: and asking while hidden stops it at once", timers[1].cleared);
  const panels = src("ui/panels.js"), chat = src("ui/chat.js");
  const uses = (panels + chat).match(/_whileVisible\("([a-z-]+)"/g) || [];
  const keys = uses.map((u) => u.match(/"([a-z-]+)"/)[1]).sort();
  ok(JSON.stringify([...new Set(keys)]) === JSON.stringify(["dm-list", "feed", "history", "people"]),
    "C: the Feed, People, the DM list and History all use it — one mechanism", keys);
  ok(!/setInterval\(/.test(panels.replace(helper, "")), "C: and no panel keeps a timer of its own any more", (panels.replace(helper, "").match(/[^\n]*setInterval\([^\n]*/) || [""])[0]);
  ok(/class: "dm-when"[^\n]*/.test(chat) && /dm-when[\s\S]{0,200}dataset\.ts|dataset\.ts[\s\S]{0,200}dm-when/.test(chat),
    "C: a DM row's age carries its stamp, so it is rewritten IN PLACE — the list is never rebuilt under someone typing (source-level)");
  ok(/hist-ago/.test(panels), "C: History's age has its own element, rewritten in place too (source-level)");
}

// ═══ PART D — the small wiring rules (source-level) ═══════════════════════════════════════════════
{
  const once = grab("ui/screens.js", "_wireMainOnce");
  ok(/Room\.onMembersChange\(_peopleChanged\)/.test(once) && /Room\.onRankChange\([\s\S]{0,200}_peopleChanged\(\)/.test(once),
    "D: ONE people-changed function serves both signals", null);
  const pc = grab("ui/screens.js", "_peopleChanged"), pr = grab("ui/screens.js", "_peopleRedraw");
  ok(/_peopleRedraw\(\)/.test(pc) && /Roster\.refreshUserCard\(\)/.test(pc) && /H\.rightTab\(\) === "people"/.test(pr),
    "D: it redraws People only while People is on screen — and an open user card always", pc + " / " + pr);
  const qs = (once.match(/Queue\.onStateChange\(\(\) => \{[^\n]*/) || [""])[0];
  ok(!/Roster\.renderRoster\(\)/.test(qs), "D: a queue change no longer rebuilds a hidden People list", qs.slice(0, 200));
  ok(/Room\.onRankChange\([\s\S]{0,400}ChatPanels\._repaintChat\(/.test(once), "D: a rank change repaints chat, so names take their new colour", null);
}

console.log("[state-wiring] PASS — how the app hears that something changed, kept simple (" + asserts + " assertions): its " +
  "subscriptions are made once, not per room entry; a rank change restarts the room's writers only when your own rank or write " +
  "channel changed, while every listener still hears it; one helper keeps the Feed, People, the DM list and History current " +
  "while on screen and stops when hidden, the ages rewritten in place; one people-changed function; People redrawn on a queue " +
  "change only while visible; chat repainted on a rank change. Parts A and D are source-level");
process.exit(0);
