// tests/check-creation.js
// WALL: the room-creation resume logic. Verifies the PURE planner that decides
// which batch-1 channels still need building given what already exists. This is
// the dedup brain that makes createDDJPSpace idempotent & resumable (the analog
// of check-upgrade's _computeStatus / highestPresentBatch). The live SDK create
// loop in createDDJPSpace stays review-only, exactly like createUpgradeBatch.

const { loadInContext } = require("./_load");

// matrixbridge.js is an IIFE of pure function defs — it touches the SDK only
// inside functions that we never call here, so it loads standalone. A no-op
// Logger stub covers any incidental reference.
const noop = () => {};
const Logger = { info: noop, warn: noop, error: noop, debug: noop };
const MB = loadInContext(["transport/matrixbridge.js"], { Logger }).MatrixBridge;
const plan = (have) => MB.creationPlan(have);

// The 8 batch-1 channel keys, in the order createDDJPSpace builds them.
const SPEC_KEYS = [
  "events_uncategorized", "events_guest", "events_owner",
  "checkpoints_guest", "checkpoints_owner",
  "chat_uncategorized", "chat_guest",
  "settings_owner",
];

function fail(msg, got) {
  console.log("[creation] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(actual, expected, msg) {
  if (actual !== expected) fail(msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}
function keysOf(p) { return p.todo.map(it => it.key); }

// 0) Sanity: the spec is exactly the 8 known batch-1 channels, in order.
let p = plan({});
eq(p.total, 8, "total channels");
eq(keysOf(p).join("|"), SPEC_KEYS.join("|"), "empty plan must list all 8 in spec order");

// 1) Nothing built yet -> build all 8, not complete.
p = plan({});
eq(p.done, 0, "empty -> done 0");
eq(p.complete, false, "empty -> not complete");
eq(p.todo.length, 8, "empty -> 8 to build");

// 2) Everything built -> nothing to do, complete.
const full = {};
for (const k of SPEC_KEYS) full[k] = "!room_" + k + ":hs";
p = plan(full);
eq(p.done, 8, "full -> done 8");
eq(p.complete, true, "full -> complete");
eq(p.todo.length, 0, "full -> nothing to build");

// 3) Partial (a prior attempt got the first two events channels) -> resume the
//    remaining 6, in spec order, starting at events_owner.
p = plan({ events_uncategorized: "!a:hs", events_guest: "!b:hs" });
eq(p.done, 2, "partial(2) -> done 2");
eq(p.complete, false, "partial(2) -> not complete");
eq(p.todo.length, 6, "partial(2) -> 6 left");
eq(p.todo[0].key, "events_owner", "partial(2) -> first remaining is events_owner");
eq(keysOf(p).join("|"),
  ["events_owner", "checkpoints_guest", "checkpoints_owner", "chat_uncategorized", "chat_guest", "settings_owner"].join("|"),
  "remaining channels must stay in spec order");

// 4) Sparse / out-of-spec-order existing set -> spec order preserved, only the
//    genuinely-missing ones returned.
p = plan({ checkpoints_owner: "!x:hs", chat_guest: "!y:hs" });
eq(p.done, 2, "sparse -> done 2");
eq(keysOf(p).join("|"),
  ["events_uncategorized", "events_guest", "events_owner", "checkpoints_guest", "chat_uncategorized", "settings_owner"].join("|"),
  "sparse existing set must subtract by key, preserve order");

// 5) Each todo item carries what the create loop needs (kind/slug/key/level),
//    and kind drives the creator (chat -> encrypted, else open).
const settings = plan({}).todo.find(it => it.key === "settings_owner");
eq(settings.kind, "settings", "settings-owner kind");
eq(settings.level, 100, "settings-owner level");
const chatU = plan({}).todo.find(it => it.key === "chat_uncategorized");
eq(chatU.kind, "chat", "chat-uncategorized kind");
eq(chatU.level, 0, "chat-uncategorized level");

// 6) Totality — bad input never throws and is treated as "nothing exists yet".
for (const bad of [null, undefined, "nope", 42, true]) {
  const r = plan(bad);
  eq(r.done, 0, "bad input (" + JSON.stringify(bad) + ") -> done 0");
  eq(r.todo.length, 8, "bad input (" + JSON.stringify(bad) + ") -> 8 to build");
}
// Irrelevant keys are ignored (don't count as built channels).
p = plan({ not_a_channel: "!z:hs", spaceId: "!s:hs" });
eq(p.done, 0, "irrelevant keys -> count nothing");
eq(p.todo.length, 8, "irrelevant keys -> still 8 to build");

console.log("[creation] PASS — resume planner: full build, partial resume, spec order, totality on bad input");
process.exit(0);
