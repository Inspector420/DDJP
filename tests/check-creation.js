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
const _sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], { Logger });
const MB = _sb.MatrixBridge, Ranks = _sb.Ranks;
const plan = (have) => MB.creationPlan(have);

// The 6 batch-1 channel keys, in the order createDDJPSpace builds them.
// (Guest moved to batch 2; checkpoints-uncategorized added — a fresh room is
// uncategorized-only.)
const SPEC_KEYS = [
  "events_uncategorized", "events_owner",
  "checkpoints_uncategorized", "checkpoints_owner",
  "chat_uncategorized",
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

// 0) Sanity: the spec is exactly the 6 known batch-1 channels, in order.
let p = plan({});
eq(p.total, 6, "total channels");
eq(keysOf(p).join("|"), SPEC_KEYS.join("|"), "empty plan must list all 6 in spec order");

// 1) Nothing built yet -> build all 6, not complete.
p = plan({});
eq(p.done, 0, "empty -> done 0");
eq(p.complete, false, "empty -> not complete");
eq(p.todo.length, 6, "empty -> 6 to build");

// 2) Everything built -> nothing to do, complete.
const full = {};
for (const k of SPEC_KEYS) full[k] = "!room_" + k + ":hs";
p = plan(full);
eq(p.done, 6, "full -> done 6");
eq(p.complete, true, "full -> complete");
eq(p.todo.length, 0, "full -> nothing to build");

// 3) Partial (a prior attempt got the first two channels) -> resume the
//    remaining 4, in spec order, starting at checkpoints_uncategorized.
p = plan({ events_uncategorized: "!a:hs", events_owner: "!b:hs" });
eq(p.done, 2, "partial(2) -> done 2");
eq(p.complete, false, "partial(2) -> not complete");
eq(p.todo.length, 4, "partial(2) -> 4 left");
eq(p.todo[0].key, "checkpoints_uncategorized", "partial(2) -> first remaining is checkpoints_uncategorized");
eq(keysOf(p).join("|"),
  ["checkpoints_uncategorized", "checkpoints_owner", "chat_uncategorized", "settings_owner"].join("|"),
  "remaining channels must stay in spec order");

// 4) Sparse / out-of-spec-order existing set -> spec order preserved, only the
//    genuinely-missing ones returned. (A stray batch-2 key like chat_guest is
//    not a batch-1 channel, so it neither counts as done nor appears in todo.)
p = plan({ checkpoints_owner: "!x:hs", chat_guest: "!y:hs" });
eq(p.done, 1, "sparse -> done 1 (checkpoints_owner; chat_guest is batch 2, ignored)");
eq(keysOf(p).join("|"),
  ["events_uncategorized", "events_owner", "checkpoints_uncategorized", "chat_uncategorized", "settings_owner"].join("|"),
  "sparse existing set must subtract by key, preserve order");

// 5) Each todo item carries what the create loop needs (kind/slug/key/level),
//    and kind drives the creator (chat -> encrypted, else open).
const settings = plan({}).todo.find(it => it.key === "settings_owner");
eq(settings.kind, "settings", "settings-owner kind");
// DERIVED, NOT RESTATED: the owner rung moved 100 -> 99 and a hand-written 100 here would
// have pinned the old ladder against the new channel table. Ask Ranks.
eq(settings.level, Ranks.levelOf("owner"), "settings-owner level == the owner rung");
const chatU = plan({}).todo.find(it => it.key === "chat_uncategorized");
eq(chatU.kind, "chat", "chat-uncategorized kind");
eq(chatU.level, 0, "chat-uncategorized level");

// 6) Totality — bad input never throws and is treated as "nothing exists yet".
for (const bad of [null, undefined, "nope", 42, true]) {
  const r = plan(bad);
  eq(r.done, 0, "bad input (" + JSON.stringify(bad) + ") -> done 0");
  eq(r.todo.length, 6, "bad input (" + JSON.stringify(bad) + ") -> 6 to build");
}
// Irrelevant keys are ignored (don't count as built channels).
p = plan({ not_a_channel: "!z:hs", spaceId: "!s:hs" });
eq(p.done, 0, "irrelevant keys -> count nothing");
eq(p.todo.length, 6, "irrelevant keys -> still 6 to build");

console.log("[creation] PASS — resume planner: full build, partial resume, spec order, totality on bad input");
process.exit(0);
