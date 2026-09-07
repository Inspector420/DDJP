// tests/check-channels.js
// WALL: the channel model. Statically reads backends/backend1/matrixbridge.js and checks
// the set of channels it builds (at creation + across all upgrade batches):
//   - events exist down to uncategorized
//   - checkpoints exist for every rank, uncategorized included
//   - checkpoints and events are fully paired (one checkpoint per events rank)
//   - chat has exactly three tiers: uncategorized, guest, staff
//   - chat channels are E2E encrypted
// This is a text scan (like the boundary/html guards), not an execution, because
// the transport needs a live Matrix SDK to run.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");

function fail(msg, extra) {
  console.log("[channels] FAIL — " + msg);
  if (extra !== undefined) console.log("      " + extra);
  process.exit(1);
}

// Collect (kind, slug) from both literal shapes used in the file:
//   creation arrays:  key: "events_uncategorized"
//   upgrade items:    kind: "events", slug: "player"
const set = new Set();
let m;
const keyRe = /key:\s*"(events|checkpoints|chat)_([a-z_]+)"/g;
while ((m = keyRe.exec(src))) set.add(m[1] + ":" + m[2].replace(/_/g, "-"));
const kindRe = /kind:\s*"(events|checkpoints|chat)"\s*,\s*slug:\s*"([a-z-]+)"/g;
while ((m = kindRe.exec(src))) set.add(m[1] + ":" + m[2]);

const slugsOf = (kind) => [...set].filter(s => s.startsWith(kind + ":")).map(s => s.split(":")[1]).sort();
const events = slugsOf("events");
const checkpoints = slugsOf("checkpoints");
const chat = slugsOf("chat");
// ── THE HAND-WRITTEN LADDER IS GONE (v284) ──────────────────────────────────────────────────
// `const RANK = { … owner: 100 }` stood here and **nothing read it** — zero references in the file.
// It was the third copied-rule instance and the worst kind: dead code that still looked
// authoritative, AND it had drifted. `owner` moved to 99 when the bot rung was introduced, so this
// copy disagreed with `Ranks.NAMES` and nothing noticed, because nothing consulted it.
//
// Not replaced with a live read of `Ranks`: the numbers below are CHANNEL power levels, which this
// file states directly at each `member(...)` call as the level that channel requires. A second
// mapping from rank NAMES to numbers is what drifted; the calls do not need one.

// events must reach uncategorized
if (!events.includes("uncategorized")) fail("events channels must reach uncategorized", "events=" + events);

// checkpoints now exist for EVERY rank, uncategorized included — the old
// "no uncategorized checkpoint" gap is closed so the ledger can cover the
// busiest (uncategorized) tier too.
if (!checkpoints.includes("uncategorized")) fail("uncategorized MUST have a checkpoint channel now");

// every checkpoint rank is paired with an events channel of the same rank, and
// vice versa — the Spine is fully symmetric (one checkpoint per events rank).
for (const s of checkpoints) {
  if (!events.includes(s)) fail("checkpoint without a paired events channel: " + s, "events=" + events);
}
for (const s of events) {
  if (!checkpoints.includes(s)) fail("events rank without a paired checkpoint channel: " + s, "checkpoints=" + checkpoints);
}

// chat: exactly uncategorized, guest, staff
const chatExpected = ["guest", "staff", "uncategorized"];
if (JSON.stringify(chat) !== JSON.stringify(chatExpected)) {
  fail("chat tiers must be exactly uncategorized/guest/staff", "got chat=" + JSON.stringify(chat));
}

// chat must be encrypted (the chat channel creator sets megolm)
if (src.indexOf("m.megolm.v1.aes-sha2") < 0 || src.indexOf("m.room.encryption") < 0) {
  fail("chat channels must be E2E encrypted (m.room.encryption / megolm not found)");
}

// --- membership rule: events/checkpoints/settings = read-by-all; chat = rank-gated ---
const { loadInContext } = require("./_load");
const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], {
  EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} }
});
const dm = sb.MatrixBridge.desiredMembership;
function member(key, level, want, why) {
  if (dm(key, level) !== want) fail("membership wrong: " + why, key + " @ level " + level + " -> " + dm(key, level));
}
// read-by-all: even uncategorized stays a member of every events/checkpoints/settings channel
member("events_owner", 0, true, "uncategorized must still READ owner events (consensus needs all)");
member("checkpoints_owner", 10, true, "guest must read owner checkpoints");
member("checkpoints_uncategorized", 0, true, "everyone reads the uncategorized checkpoint");
member("settings_owner", 0, true, "everyone reads owner settings");
member("settings_staff", 0, true, "everyone reads staff settings (read-by-all, write-gated)");
member("settings_high_staff", 0, true, "everyone reads high-staff settings (read-by-all, write-gated)");
member("events_high_staff", 20, true, "player must read high-staff events");
// chat is rank-gated
member("chat_uncategorized", 0, true, "everyone is in uncategorized chat");
member("chat_guest", 0, false, "uncategorized is NOT in guest chat");
member("chat_guest", 10, true, "guest is in guest chat");
member("chat_staff", 40, false, "VIP is NOT in staff chat");
member("chat_staff", 60, true, "staff is in staff chat");

console.log("[channels] PASS — events↓uncategorized, checkpoints every rank incl. uncategorized (fully paired), chat = {uncategorized,guest,staff} encrypted; membership read-by-all (events/checkpoints/settings) + chat rank-gated");
process.exit(0);
