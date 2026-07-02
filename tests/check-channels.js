// tests/check-channels.js
// WALL: the channel model. Statically reads transport/matrixbridge.js and checks
// the set of channels it builds (at creation + across all upgrade batches):
//   - events exist down to uncategorized
//   - checkpoints exist for guest and up, never uncategorized
//   - every checkpoint rank is paired with an events channel of the same rank
//   - chat has exactly three tiers: uncategorized, guest, staff
//   - chat channels are E2E encrypted
// This is a text scan (like the boundary/html guards), not an execution, because
// the transport needs a live Matrix SDK to run.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "transport", "matrixbridge.js"), "utf8");

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
const RANK = { uncategorized: 0, guest: 10, player: 20, vip: 40, staff: 60, "high-staff": 80, owner: 100 };

// events must reach uncategorized
if (!events.includes("uncategorized")) fail("events channels must reach uncategorized", "events=" + events);

// checkpoints: guest minimum, never uncategorized
if (checkpoints.includes("uncategorized")) fail("uncategorized must NOT have a checkpoint channel");
for (const s of checkpoints) {
  if ((RANK[s] || 0) < RANK.guest) fail("checkpoint below guest is not allowed: " + s);
}

// every checkpoint rank is paired with an events channel of the same rank
for (const s of checkpoints) {
  if (!events.includes(s)) fail("checkpoint without a paired events channel: " + s, "events=" + events);
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
const sb = loadInContext(["transport/matrixbridge.js"], {
  EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} }
});
const dm = sb.MatrixBridge.desiredMembership;
function member(key, level, want, why) {
  if (dm(key, level) !== want) fail("membership wrong: " + why, key + " @ level " + level + " -> " + dm(key, level));
}
// read-by-all: even uncategorized stays a member of every events/checkpoints/settings channel
member("events_owner", 0, true, "uncategorized must still READ owner events (consensus needs all)");
member("checkpoints_owner", 10, true, "guest must read owner checkpoints");
member("settings_owner", 0, true, "everyone reads settings");
member("events_high_staff", 20, true, "player must read high-staff events");
// chat is rank-gated
member("chat_uncategorized", 0, true, "everyone is in uncategorized chat");
member("chat_guest", 0, false, "uncategorized is NOT in guest chat");
member("chat_guest", 10, true, "guest is in guest chat");
member("chat_staff", 40, false, "VIP is NOT in staff chat");
member("chat_staff", 60, true, "staff is in staff chat");

console.log("[channels] PASS — events↓uncategorized, checkpoints guest+ (paired), chat = {uncategorized,guest,staff} encrypted; membership read-by-all + chat rank-gated");
process.exit(0);
