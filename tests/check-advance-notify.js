// tests/check-advance-notify.js
//
// EVERY EVENT THAT MOVES THE ROOM MUST REACH EVERY MODULE THAT REACTS TO THE ROOM MOVING.
//
// There are three ways the song changes: an ordinary play, a manual skip, and `ddjp.media.skip` —
// the availability escape, which the ROOM derives when enough of it is blocked. The first two were
// on every subscription list. The third was on almost none.
//
// ── WHY THIS GUARD WAS REWRITTEN ─────────────────────────────────────────────────────────────
// The previous version HAND-LISTED the two modules somebody had noticed: Playback and Queue. It
// drove them properly, by execution, and it was green — and it could not have gone red for the
// three FURTHER modules that had the same omission, because it never looked at them. A guard about
// a general omission that can only see the instances already found is a guard that certifies the
// fix it watched being made.
//
// This is the project's own lesson, and it had already been applied one file away:
// check-advance-floor-bound DERIVES its call sites by scanning the source, and its note says that
// is what "makes a future third caller covered". The same hand wrote both and carried the lesson to
// one of them.
//
// ── THE SHAPE THAT HOLDS ─────────────────────────────────────────────────────────────────────
//   PART A  DERIVE the candidates. Scan the tree for every module that names any advance type.
//           Nothing is listed from memory, so a module added tomorrow is in scope tomorrow.
//   PART B  Every candidate must have a RECIPE here, or this guard FAILS. A scan that silently
//           skips what it cannot load reports on whatever happened to be easy.
//   PART C  Decide membership by EXECUTION. Stub-load each candidate, wire it to a recording
//           stream, and ask what it ACTUALLY subscribed to. Naming a type in a comment, a reducer
//           branch or a chain-types constant is not subscribing to it.
//   PART D  THE RULE: a module that subscribes to ANY advance type must subscribe to ALL THREE.
//   PART E  And the handler must DO something — subscribed-but-inert is the same failure wearing a
//           subscription.
//
// A regex over the source would prove a string is present somewhere in a file, which is a different
// claim and has already let one thing through in this codebase's history. So the LIST is textual
// (that is what a candidate scan is) and the VERDICT never is.

const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[advance-notify] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// The three events that change which song is playing. Stated HERE as the guard's own claim —
// deliberately not imported from a module, because a guard that reads its expectation out of the
// thing it is checking cannot fail when that thing is wrong.
const ADVANCE_TYPES = ["ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip"];

// ── PART A — DERIVE THE CANDIDATES ───────────────────────────────────────────────────────────
const SCAN_DIRS = ["features", "ui", "core", "backends/backend1"];
function candidates() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir)); } catch (e) { continue; }
    for (const n of names.sort()) {
      if (!n.endsWith(".js")) continue;
      const rel = dir + "/" + n;
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (ADVANCE_TYPES.some((t) => src.indexOf('"' + t + '"') >= 0)) out.push(rel);
    }
  }
  return out;
}

function recordingStream(state) {
  const subs = Object.create(null);
  return {
    types: () => Object.keys(subs),
    fire: (t, entry) => { for (const fn of (subs[t] || []).slice()) fn(entry || { type: t, content: {}, ts: 1000 }); },
    api: {
      getState: () => state,
      getLog: () => [],
      on: (t, fn) => { (subs[t] || (subs[t] = [])).push(fn); },
      off: (t, fn) => { if (subs[t]) subs[t] = subs[t].filter((f) => f !== fn); },
      projectHistory: () => [],
      isLegal: () => true,
      settingRanges: () => ({}),
      defaultSettings: () => ({}),
    },
  };
}

const NP = { dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
             settings: { maxLen: 600, minLen: 10, vouchJitter: 1000, presendMs: 300 } };
const STATE = { nowPlaying: NP, rotation: [{ user: "@a:hs", pending: [] }],
                settings: NP.settings, counts: {}, history: [],
                advance: { pi: "$p1", gateLenSec: null, earliestAt: 0, ceilingAt: 600000 } };

const LOG = { debug() {}, info() {}, warn() {}, error() {} };
const TIMERS = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };

// ── PART B — THE RECIPES ─────────────────────────────────────────────────────────────────────
// One per candidate. `subscribes: false` means "this file NAMES advance types but wires no
// subscription" — a reducer branch, a chain-types constant, a diagnostic list. Stated with a
// reason rather than omitted, because "not in the list" and "considered and excluded" look
// identical from outside and only one of them is a decision.
const RECIPES = {
  "features/playback.js": {
    files: ["features/playback.js"],
    extras: (s) => Object.assign({ Date, Math, StreamManager: s.api,
      MatrixBridge: { async sendEvent() {}, mayAdvance: () => ({ ok: true }) },
      Capabilities: { staggerMs: () => 0, rankNameOf: () => "uncategorized" },
      Logger: LOG }, TIMERS),
    init: (sb) => sb.Playback.initWiring("!ev:hs"),
    applied: (sb, s) => { let n = 0; sb.Playback.onStateChange(() => { n++; }); const b = n; s.fire("ddjp.media.skip"); return n > b; },
  },
  "features/queue.js": {
    files: ["features/queue.js"],
    extras: (s) => Object.assign({ Date, Math, StreamManager: s.api,
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
      PlaylistDoc: { watchUrl: (v) => "https://www.youtube.com/watch?v=" + v },
      Logger: LOG }, TIMERS),
    init: (sb) => sb.Queue.init("!ev:hs"),
    applied: (sb, s) => { let n = 0; sb.Queue.onStateChange(() => { n++; }); const b = n; s.fire("ddjp.media.skip"); return n > b; },
  },
  "features/mediablocked.js": {
    files: ["features/mediablocked.js"],
    extras: (s) => Object.assign({ Date, Math, StreamManager: s.api,
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
      Capabilities: { staggerMs: () => 0, atLeast: () => true, rankNameOf: () => "guest" },
      Logger: LOG }, TIMERS),
    init: (sb) => { if (sb.MediaBlocked.setMyRank) sb.MediaBlocked.setMyRank(20); sb.MediaBlocked.init("!ev:hs"); },
  },
  "features/medialength.js": {
    files: ["features/medialength.js"],
    extras: (s) => Object.assign({ Date, Math, StreamManager: s.api,
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() { return {}; } },
      Capabilities: { staggerMs: () => 0, atLeast: () => true, rankNameOf: () => "guest" },
      ServerClock: { serverNow: () => 1000 },
      Logger: LOG }, TIMERS),
    init: (sb) => { if (sb.MediaLength.setMyRank) sb.MediaLength.setMyRank(20); sb.MediaLength.init("!ev:hs"); },
  },
  "features/skip.js": {
    files: ["features/skip.js"],
    extras: (s) => Object.assign({ Date, Math, StreamManager: s.api,
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
      Capabilities: { can: () => ({ permitted: true, reason: null }) },
      Room: { getMyRank: () => 100 },
      Logger: LOG }, TIMERS),
    // Skip subscribes TRANSIENTLY, inside _waitForAdvance rather than in init(), and gets there
    // only AFTER an await. Driving skip() synchronously returns before any subscription exists —
    // which this guard's first run reported as "subscribed to none", a plausible answer that was
    // wrong for a reason that had nothing to do with the module. So the recipe is async and lets
    // the microtask queue drain. skip()'s own promise is deliberately NOT awaited: it resolves on
    // a timer that the stubbed clock never fires.
    init: async (sb) => {
      sb.Skip.init("!ev:hs");
      sb.Skip.skip();
      await new Promise((r) => setImmediate(r));
    },
  },
  "features/userqueue.js": {
    files: ["core/logger.js", "core/storageio.js", "core/store.js", "core/playlistdoc.js",
            "features/userqueue.js"],
    extras: (s) => Object.assign({ Date, URL, Math, StreamManager: s.api,
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {}, mayAuthor: () => ({ ok: true }) },
      Queue: { submitSong: async () => {}, undeclare: async () => {}, reorder: async () => {},
               myPending: () => [], getRotation: () => STATE.rotation, getNowPlaying: () => NP },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      indexedDB: null }, TIMERS),
    init: (sb) => sb.UserQueue.init("!space:hs"),
  },

  // ── NAMED NON-SUBSCRIBERS ──────────────────────────────────────────────────────────────────
  "backends/backend1/statederiver.js": { subscribes: false,
    why: "the reducer BRANCHES on the three types; it is the fold itself and subscribes to nothing" },
  "backends/backend1/streammanager.js": { subscribes: false,
    why: "_ADVANCE_TYPES decides which events get an ORDER diagnostic; it is the publisher, not a subscriber" },
  "backends/backend1/continuity.js": { subscribes: false,
    why: "CHAIN_TYPES is a rule about which events structurally NEED their parent — a different question that happens to share an answer today" },
  "backends/backend1/history.js": { subscribes: false,
    why: "_looksLikeSegment asks whether a log starts mid-room; it reads events handed to it and subscribes to nothing" },
  "features/reputation.js": { subscribes: false,
    why: "J19's fold reads `ddjp.dj.play` to attribute a playing to the DJ who played it — a " +
         "lookup while walking a log that has already been ingested, not a subscription. It " +
         "reacts to nothing and is called by the bot when it publishes. This entry is the " +
         "derivation working: a new module naming an advance type is a module nobody has checked " +
         "until somebody says which kind it is" },
  "features/room.js": { subscribes: false,
    why: "J13's FEED_KINDS names the three advance types as DISPLAY PHRASING for the event feed — " +
         "a lookup table keyed by type, read while folding a log that has already been ingested. " +
         "It subscribes to nothing and reacts to nothing: the feed re-folds on Queue.onStateChange, " +
         "which is the re-derive announcement rather than a per-type subscription. This entry is " +
         "the guard's derivation working — a new module naming an advance type is a module nobody " +
         "has checked until somebody says which kind it is" },
  "backends/backend1/matrixbridge.js": { subscribes: "verified-elsewhere",
    why: "subscribes in _wireConcepts (history refresh) and wireCheckpoints (_onSpineForSeal); both already take all three, and driving them needs the whole consensus stack, which check-wiring and check-history-wired already stand up" },
};

// ── PART B — EVERY CANDIDATE HAS A RECIPE, AND EVERY RECIPE A CANDIDATE ──────────────────────
const found = candidates();
for (const rel of found) {
  ok(!!RECIPES[rel],
    "the scan found " + rel + " naming an advance type, and this guard has no recipe for it. That "
    + "is the GUARD's failure, not the module's: a candidate with no recipe is a module nobody "
    + "checked. Add a recipe that drives it, or a `subscribes: false` entry saying why it is not a "
    + "subscriber", found);
}
for (const rel in RECIPES) {
  ok(found.indexOf(rel) >= 0,
    "this guard carries a recipe for " + rel + ", which no longer names any advance type. A recipe "
    + "for a file that is not a candidate is coverage on paper only", found);
}

// ── PARTS C, D, E — EXECUTE, THEN JUDGE ──────────────────────────────────────────────────────
async function run() {
const report = [];
for (const rel of found) {
  const r = RECIPES[rel];
  if (!r) continue;
  if (r.subscribes === false || r.subscribes === "verified-elsewhere") {
    report.push("  · " + rel + " — not a subscriber here (" + r.why + ")");
    continue;
  }
  const s = recordingStream(STATE);
  let sb = null;
  try {
    sb = loadInContext(r.files, r.extras(s));
    await r.init(sb);
  } catch (e) {
    ok(false, rel + " could not be driven headlessly: " + (e && e.message)
      + ". A candidate that cannot be exercised is a candidate that is not being checked", rel);
    continue;
  }

  const got = ADVANCE_TYPES.filter((t) => s.types().indexOf(t) >= 0);

  // ── DRIVEN AND SILENT IS A FAILURE, NOT A CATEGORY ─────────────────────────────────────────
  // This used to `continue` with a note reading "names advance types but subscribed to none when
  // driven", and that soft branch swallowed a real omission on this guard's very first run:
  // skip.js subscribes after an await, the recipe was synchronous, and the guard reported a
  // module it had failed to exercise as one that simply does not subscribe. A plausible answer
  // that is wrong — the exact shape this whole guard is about.
  //
  // A file reaches this loop only because a recipe here CLAIMS it is a subscriber. If driving it
  // produces nothing, either the module stopped subscribing or the recipe stopped exercising it.
  // Both need a person. Neither is a line of prose in a passing run.
  if (!got.length) {
    ok(false, rel + " was driven and subscribed to NO advance type. Its recipe here asserts it is "
      + "a subscriber, so this is either a module that stopped listening or a recipe that stopped "
      + "reaching the code that listens — and the second is how a guard reports a module it never "
      + "actually exercised. If it genuinely is not a subscriber, say so with a `subscribes: false` "
      + "entry and a reason", { subscribed: [] });
    report.push("  · " + rel + " — DRIVEN, SUBSCRIBED TO NOTHING");
    continue;
  }

  const missing = ADVANCE_TYPES.filter((t) => s.types().indexOf(t) < 0);
  ok(missing.length === 0,
    rel + " subscribes to " + JSON.stringify(got) + " but NOT to " + JSON.stringify(missing) + ". "
    + "All three change which song is playing, so a module that reacts to one and not the others "
    + "reacts to some advances and silently ignores the rest — which looks exactly like the room "
    + "not advancing, and leaves no trace in the log",
    { subscribed: got, missing: missing });

  if (!missing.length && typeof r.applied === "function") {
    let did = false;
    try { did = !!(await r.applied(sb, s)); } catch (e) { did = false; }
    ok(did, rel + ": APPLIED — firing an availability skip must actually drive the module, not "
      + "merely find a subscriber registered", rel);
  }
  report.push("  · " + rel + (missing.length ? " — MISSING " + JSON.stringify(missing) : " — all three"));
}

console.log("[advance-notify] candidates derived by scanning " + SCAN_DIRS.join(", ") + ":");
for (const line of report) console.log(line);

if (failures) process.exit(1);
console.log("[advance-notify] PASS — the module list is DERIVED by scanning rather than listed from "
  + "memory, so a module added tomorrow is in scope tomorrow; every candidate the scan finds must "
  + "have a recipe here or this guard fails, so nothing is silently skipped; membership is decided "
  + "by EXECUTION, because naming a type in a reducer branch or a chain-types constant is not "
  + "subscribing to it; and the rule asserted is that a module reacting to ANY of the three events "
  + "that change which song is playing reacts to ALL of them. The previous version hand-listed the "
  + "two modules somebody had already noticed, and was green while three more had the same omission");
}

run();
