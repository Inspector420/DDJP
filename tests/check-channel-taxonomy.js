// tests/check-channel-taxonomy.js
// WALL: the channel taxonomy is the SINGLE source of truth for rank <-> channel
// facts, and the wire ROOM NAMES / map KEYS it produces are LIVE Matrix state —
// existing rooms already have channels with these exact names. They must never
// change. This guard pins the whole set as a golden list and proves the derived
// helpers (name/key builders, key-from-name, events-key-for-level) agree with it,
// so a future refactor of transport/matrixbridge.js can't silently rename a
// channel, drop a rank, or reintroduce a duplicate rank map / "highstaff" alias.
//
// Loaded headlessly with the same lightweight stubs check-channels uses — the
// module only needs EventCache / StreamManager / Logger to define itself; the
// Matrix SDK client stays null and is never touched here.

const { loadInContext } = require("./_load");

const sb = loadInContext(["transport/matrixbridge.js"], {
  EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} },
});
const MB = sb.MatrixBridge;

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.log("  ✗ " + msg); } }
function fail(msg, extra) {
  console.log("[channel-taxonomy] FAIL — " + msg);
  if (extra !== undefined) console.log("      " + extra);
  process.exit(1);
}

if (!MB || typeof MB.channelTaxonomy !== "function")
  fail("MatrixBridge.channelTaxonomy not found — did the taxonomy move or change shape?");

// ── The golden taxonomy. These exact strings/levels/batches are the contract.
// Changing any of them is changing live Matrix room names — if that is ever
// truly intended, this list is the one deliberate place to do it.
const GOLDEN = [
  { kind: "events",      slug: "uncategorized", key: "events_uncategorized",     level: 0,   batch: 1 },
  { kind: "events",      slug: "guest",         key: "events_guest",             level: 10,  batch: 1 },
  { kind: "events",      slug: "owner",         key: "events_owner",             level: 100, batch: 1 },
  { kind: "checkpoints", slug: "guest",         key: "checkpoints_guest",        level: 10,  batch: 1 },
  { kind: "checkpoints", slug: "owner",         key: "checkpoints_owner",        level: 100, batch: 1 },
  { kind: "chat",        slug: "uncategorized", key: "chat_uncategorized",       level: 0,   batch: 1 },
  { kind: "chat",        slug: "guest",         key: "chat_guest",               level: 10,  batch: 1 },
  { kind: "settings",    slug: "owner",         key: "settings_owner",           level: 100, batch: 1 },
  { kind: "events",      slug: "player",        key: "events_player",            level: 20,  batch: 2 },
  { kind: "checkpoints", slug: "player",        key: "checkpoints_player",       level: 20,  batch: 2 },
  { kind: "events",      slug: "vip",           key: "events_vip",               level: 40,  batch: 2 },
  { kind: "checkpoints", slug: "vip",           key: "checkpoints_vip",          level: 40,  batch: 2 },
  { kind: "events",      slug: "staff",         key: "events_staff",             level: 60,  batch: 3 },
  { kind: "checkpoints", slug: "staff",         key: "checkpoints_staff",        level: 60,  batch: 3 },
  { kind: "events",      slug: "high-staff",    key: "events_high_staff",        level: 80,  batch: 3 },
  { kind: "checkpoints", slug: "high-staff",    key: "checkpoints_high_staff",   level: 80,  batch: 3 },
  { kind: "chat",        slug: "staff",         key: "chat_staff",               level: 60,  batch: 3 },
];

const tax = MB.channelTaxonomy();

// 1) The table matches the golden list EXACTLY, in order (pins names/keys/levels).
ok(Array.isArray(tax) && tax.length === GOLDEN.length,
  "taxonomy has exactly " + GOLDEN.length + " channels (got " + (tax && tax.length) + ")");
for (let i = 0; i < GOLDEN.length; i++) {
  const g = GOLDEN[i], r = tax[i] || {};
  ok(r.kind === g.kind && r.slug === g.slug && r.key === g.key && r.level === g.level && r.batch === g.batch,
    "row " + i + " matches golden " + JSON.stringify(g) + " (got " + JSON.stringify(r) + ")");
}

// 2) The string builders agree with the table — the literal `key` can't drift
//    from the canonical name/key transforms, and name<->key round-trips.
for (const g of GOLDEN) {
  ok(MB.channelName(g.kind, g.slug) === g.kind + "-" + g.slug,
    "channelName(" + g.kind + "," + g.slug + ") = wire name");
  ok(MB.channelKey(g.kind, g.slug) === g.key,
    "channelKey(" + g.kind + "," + g.slug + ") === " + g.key);
  ok(MB.channelKeyFromName(MB.channelName(g.kind, g.slug)) === g.key,
    "channelKeyFromName(name) round-trips to " + g.key);
}

// 3) events-key-for-level resolves every rank to its events channel key.
const EVENTS_BY_LEVEL = { 0: "events_uncategorized", 10: "events_guest", 20: "events_player",
  40: "events_vip", 60: "events_staff", 80: "events_high_staff", 100: "events_owner" };
for (const lvl in EVENTS_BY_LEVEL) {
  ok(MB.eventsKeyForLevel(Number(lvl)) === EVENTS_BY_LEVEL[lvl],
    "eventsKeyForLevel(" + lvl + ") === " + EVENTS_BY_LEVEL[lvl]);
}
ok(MB.eventsKeyForLevel(999) === null, "eventsKeyForLevel(unknown) === null");

// 4) No duplicate / aliased slug. The canonical high-staff slug is "high-staff"
//    and nothing else (the old defensive "highstaff" alias must stay gone).
const slugs = tax.map(r => r.slug);
ok(slugs.indexOf("highstaff") < 0, "no 'highstaff' alias slug in the taxonomy");
ok(slugs.indexOf("high-staff") >= 0, "canonical 'high-staff' slug present");

// 5) Batch composition is the documented ladder (8 / 4 / 5).
const byBatch = b => tax.filter(r => r.batch === b).length;
ok(byBatch(1) === 8, "batch 1 has 8 channels (got " + byBatch(1) + ")");
ok(byBatch(2) === 4, "batch 2 has 4 channels (got " + byBatch(2) + ")");
ok(byBatch(3) === 5, "batch 3 has 5 channels (got " + byBatch(3) + ")");

if (failed) { console.log("[channel-taxonomy] " + failed + " failure(s)"); process.exit(1); }
console.log("[channel-taxonomy] PASS — single channel table; wire names/keys/levels/batches pinned, builders agree, no duplicate rank map");
process.exit(0);
