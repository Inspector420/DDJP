// tests/check-channel-taxonomy.js
// WALL: the channel taxonomy is the SINGLE source of truth for rank <-> channel
// facts, and the wire ROOM NAMES / map KEYS it produces are LIVE Matrix state —
// existing rooms already have channels with these exact names. They must never
// change. This guard pins the whole set as a golden list and proves the derived
// helpers (name/key builders, key-from-name, events-key-for-level) agree with it,
// so a future refactor of backends/backend1/matrixbridge.js can't silently rename a
// channel, drop a rank, or reintroduce a duplicate rank map / "highstaff" alias.
//
// Loaded headlessly with the same lightweight stubs check-channels uses — the
// module only needs EventCache / StreamManager / Logger to define itself; the
// Matrix SDK client stays null and is never touched here.

const { loadInContext } = require("./_load");

const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], {
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
// OWNER ROWS ARE 99, NOT 100. The ladder's owner rung moved so a second owner-tier account
// (the bot, at 99) reads as `owner` while Matrix's 100-reserved powers — `state_default`,
// `redact` — stay with the human creator at 100. `eventsKeyForLevel` is an EXACT-match
// lookup keyed by ladder level, so 100 now answers null by design: its one caller passes
// ladder levels, never a power level read back from Matrix.
// Changing any of them is changing live Matrix room names — if that is ever
// truly intended, this list is the one deliberate place to do it.
const GOLDEN = [
  // Batch 1 — creation (uncategorized-only; guest moved to batch 2)
  { kind: "events",      slug: "uncategorized", key: "events_uncategorized",      level: 0,   batch: 1 },
  { kind: "events",      slug: "owner",         key: "events_owner",              level: 99,  batch: 1 },
  { kind: "checkpoints", slug: "uncategorized", key: "checkpoints_uncategorized", level: 0,   batch: 1 },
  { kind: "checkpoints", slug: "owner",         key: "checkpoints_owner",         level: 99,  batch: 1 },
  { kind: "chat",        slug: "uncategorized", key: "chat_uncategorized",        level: 0,   batch: 1 },
  { kind: "settings",    slug: "owner",         key: "settings_owner",            level: 99,  batch: 1 },
  // Batch 2 — upgrade 1 (guest + player + VIP)
  { kind: "events",      slug: "guest",         key: "events_guest",              level: 10,  batch: 2 },
  { kind: "checkpoints", slug: "guest",         key: "checkpoints_guest",         level: 10,  batch: 2 },
  { kind: "chat",        slug: "guest",         key: "chat_guest",                level: 10,  batch: 2 },
  { kind: "events",      slug: "player",        key: "events_player",             level: 20,  batch: 2 },
  { kind: "checkpoints", slug: "player",        key: "checkpoints_player",        level: 20,  batch: 2 },
  { kind: "events",      slug: "vip",           key: "events_vip",                level: 40,  batch: 2 },
  { kind: "checkpoints", slug: "vip",           key: "checkpoints_vip",           level: 40,  batch: 2 },
  // Batch 3 — upgrade 2 (staff + high-staff, incl. the two reserved settings tiers)
  { kind: "events",      slug: "staff",         key: "events_staff",              level: 60,  batch: 3 },
  { kind: "checkpoints", slug: "staff",         key: "checkpoints_staff",         level: 60,  batch: 3 },
  { kind: "events",      slug: "high-staff",    key: "events_high_staff",         level: 80,  batch: 3 },
  { kind: "checkpoints", slug: "high-staff",    key: "checkpoints_high_staff",    level: 80,  batch: 3 },
  { kind: "chat",        slug: "staff",         key: "chat_staff",                level: 60,  batch: 3 },
  // Batch 4 — upgrade 3: the presence chat (v322). THE FIRST ROW WHOSE MEMBERSHIP IS NOT RANK.
  // Every other channel is open to the space and write-gated at a level; this one is invite-only
  // and the owner bot decides who is in it. `level: 0` is the WRITE gate and is deliberately the
  // floor — anybody the bot has let in may talk, and a rank gate on top would be a second answer
  // to a question membership already settles.
  //
  // ITS OWN BATCH, ALONE. Appending it to batch 3 would mean a room that completed "upgrade 2"
  // has this channel in some builds and not others, and `status()` floors against channels that
  // EXIST — so those rooms would report batch 3 incomplete and be offered an upgrade that re-runs
  // it. A new batch is additive: rooms at 3 stay at 3 and are offered a 4.
  { kind: "presence",    slug: "chat",          key: "presence_chat",             level: 0,   batch: 3 },
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
  40: "events_vip", 60: "events_staff", 80: "events_high_staff", 99: "events_owner" };
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

// 5) Batch composition is the documented ladder (6 / 7 / 7 channels).
//    Rooms per burst incl. the Space in batch 1 = 7 / 7 / 7, each under the ≤10
//    creation rate-limit ceiling.
const byBatch = b => tax.filter(r => r.batch === b).length;
ok(byBatch(1) === 6, "batch 1 has 6 channels (got " + byBatch(1) + ")");
ok(byBatch(2) === 7, "batch 2 has 7 channels (got " + byBatch(2) + ")");
// BATCH 3 LOST `settings_staff` AND `settings_high_staff`. They were reserved for nothing — built
// for a per-tier settings WRITE that J18 then implemented without them, because delegation is bot
// policy: a lower rank sends `ddjp.bot.request` on its own events channel and the bot authors the
// change. The reducer honoured ONLY `settings_owner` before and after, so removing them changes
// no derived state — it removes two rate-limited room creations per build.
ok(byBatch(3) === 6, "batch 3 has 6 channels (got " + byBatch(3) + ")");

if (failed) { console.log("[channel-taxonomy] " + failed + " failure(s)"); process.exit(1); }
// ── THE LEVELS MUST AGREE WITH Ranks, NOT MERELY LOOK PLAUSIBLE ──────────────────────────────
// This file's header calls the taxonomy the single source of truth for rank <-> channel, and for
// the MAPPING it is. The `level` on each row is a different matter: those numbers are written by
// hand and duplicate Ranks.LADDER, so "one rule, one place" was quietly false here. They happen to
// agree today — checked, all 20 rows — but nothing made them, and a new rank or a changed level
// would need someone to remember two files.
//
// Derived rather than listed, so the agreement is enforced instead of observed.
{
  // sb.Ranks, not a bare `Ranks` — and NO try/catch around the lookup. The first version of this
  // had both mistakes: the bare name was undefined, the catch swallowed the ReferenceError, `want`
  // was undefined for every row, and the whole check passed while examining nothing. Mutating a
  // level did not turn it red. A guard whose own error handling can hide its subject is the shape
  // this file exists to prevent, one level up.
  const rows = (MB && MB.channelTaxonomy) ? MB.channelTaxonomy() : [];
  const mismatched = [];
  let compared = 0;
  for (const row of rows) {
    if (!row || !row.slug || typeof row.level !== "number") continue;
    const want = sb.Ranks.levelOf(row.slug);
    if (typeof want !== "number") continue;       // a slug that is not a rank name (e.g. a reserved channel)
    compared++;
    if (want !== row.level) mismatched.push({ key: row.key, table: row.level, ranks: want });
  }
  // A FILTERED CHECK MUST PROVE IT FILTERED TO SOMETHING. Without this, any change that empties
  // the loop — a renamed slug, a moved export, a typo — reads as a pass.
  ok(compared >= 10,
    "the level cross-check actually examined rows rather than skipping them all", { compared });
  ok(mismatched.length === 0,
    "every channel's level matches the rank of the same name in Ranks.LADDER. The table names a "
    + "rank AND restates its number; when those two disagree the channel is created with power "
    + "levels that do not match the ladder the reducer judges by", mismatched);
}

console.log("[channel-taxonomy] PASS — single channel table; wire names/keys/levels/batches pinned, builders agree, no duplicate rank map");
process.exit(0);
