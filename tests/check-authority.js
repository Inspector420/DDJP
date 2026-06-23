// tests/check-authority.js
// WALL: the promote/demote authority rule. Loads the real Room module and drives
// its pure canAssignRank(actorRank, targetRank, newLevel) through the cases that
// matter: only Staff+ may assign, only strictly below yourself, never an equal or
// a superior, and never granting at/above your own level.

const assert = require("assert");
const { loadInContext } = require("./_load");

const noop = () => {};
const stub = {};
const Logger = { info: noop, warn: noop, debug: noop, error: noop };

const sb = loadInContext(["features/room.js"], {
  MatrixBridge: stub, StreamManager: stub, Playback: stub, Queue: stub,
  Skip: stub, Chat: stub, RoomUpgrade: stub, UserQueue: stub, StorageIO: stub, Logger
});
const { Room } = sb;
const can = Room.canAssignRank;

let failed = 0;
function check(desc, got, want) {
  if (got !== want) { console.log("  ✗ " + desc + " — got " + got + ", want " + want); failed++; }
}

const OWNER = 100, HIGH = 80, STAFF = 60, VIP = 40, PLAYER = 20, GUEST = 10, UNCAT = 0;

// Owner can set anyone below to any level below 100.
check("owner promotes player -> staff", can(OWNER, PLAYER, STAFF), true);
check("owner demotes high-staff -> guest", can(OWNER, HIGH, GUEST), true);
check("owner can NOT mint another owner", can(OWNER, PLAYER, OWNER), false);

// Staff can manage strictly-below people, to strictly-below levels.
check("staff promotes player -> vip", can(STAFF, PLAYER, VIP), true);
check("staff demotes vip -> guest", can(STAFF, VIP, GUEST), true);
check("staff can NOT set someone to staff (== self)", can(STAFF, PLAYER, STAFF), false);
check("staff can NOT touch another staff (rank matched)", can(STAFF, STAFF, GUEST), false);
check("staff can NOT touch high-staff (outranked)", can(STAFF, HIGH, GUEST), false);

// Below staff: no authority at all.
check("vip can NOT assign", can(VIP, GUEST, PLAYER), false);
check("player can NOT assign", can(PLAYER, GUEST, GUEST), false);
check("uncategorized can NOT assign", can(UNCAT, UNCAT, GUEST), false);

// Bad input.
check("negative level rejected", can(OWNER, PLAYER, -5), false);
check("non-number level rejected", can(OWNER, PLAYER, "staff"), false);

if (failed > 0) {
  console.log("[authority] FAIL — " + failed + " case(s) wrong");
  process.exit(1);
}
console.log("[authority] PASS — only Staff+ assign, strictly below self, never equals/superiors");
process.exit(0);
