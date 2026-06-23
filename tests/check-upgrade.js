// tests/check-upgrade.js
// WALL: the room-upgrade gate logic. Verifies the pure status computation —
// current batch, next batch, the 2h cooldown, mid-flight resume, the cap at
// batch 3, and that a forged (non-Owner) upgrade event is ignored.

const assert = require("assert");
const { loadInContext } = require("./_load");

const RU = loadInContext(["features/roomupgrade.js"], { Date }).RoomUpgrade;
const compute = (events, now) => RU._computeStatus(events, now);

const H = 60 * 60 * 1000;
const COOL = 2 * H;
const OWNER = 100;

function fail(msg, got) {
  console.log("[upgrade] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(actual, expected, msg) {
  if (actual !== expected) fail(msg + " (expected " + expected + ", got " + actual + ")");
}

// 1) No events: batch 1 exists, next is 2, available immediately (no cooldown seed).
let s = compute([], 1000);
eq(s.currentBatch, 1, "no events -> currentBatch");
eq(s.nextBatch, 2, "no events -> nextBatch");
eq(s.inProgress, null, "no events -> not in progress");
eq(s.canUpgradeNow, true, "no events -> upgradeable");

// 2) Batch 1 done at t0: cooldown runs from t0 + 2h.
const t0 = 10000;
const done1 = [{ kind: "done", n: 1, ts: t0, rank: OWNER }];
eq(compute(done1, t0 + H).canUpgradeNow, false, "1h after batch 1 -> still locked");
eq(compute(done1, t0 + COOL + 1).canUpgradeNow, true, "2h after batch 1 -> unlocked");
eq(compute(done1, t0 + COOL + 1).nextAvailableAt, t0 + COOL, "nextAvailableAt = t0 + 2h");

// 3) Mid-flight batch 2 (start, no done): resume is offered regardless of cooldown.
const midflight = [
  { kind: "done",  n: 1, ts: t0, rank: OWNER },
  { kind: "start", n: 2, ts: t0 + 100, rank: OWNER },
];
s = compute(midflight, t0 + 60000);   // well within the 2h window
eq(s.inProgress, 2, "start without done -> in progress");
eq(s.canUpgradeNow, true, "in-progress batch -> resumable even during cooldown");

// 4) Batches 1 and 2 done: current 2, next 3, cooldown from batch 2's done.
const t2 = t0 + COOL + 5;
const done2 = [
  { kind: "done", n: 1, ts: t0, rank: OWNER },
  { kind: "done", n: 2, ts: t2, rank: OWNER },
];
s = compute(done2, t2 + H);
eq(s.currentBatch, 2, "two done -> currentBatch");
eq(s.nextBatch, 3, "two done -> nextBatch");
eq(s.nextAvailableAt, t2 + COOL, "cooldown runs from latest done");
eq(s.canUpgradeNow, false, "1h after batch 2 -> locked");

// 5) Fully upgraded: no next batch, nothing to do.
const done3 = done2.concat([{ kind: "done", n: 3, ts: t2 + COOL + 5, rank: OWNER }]);
s = compute(done3, t2 + COOL + COOL + 999999);
eq(s.currentBatch, 3, "three done -> currentBatch");
eq(s.nextBatch, null, "fully upgraded -> no next batch");
eq(s.canUpgradeNow, false, "fully upgraded -> not upgradeable");

// 6) Forged low-rank upgrade event is ignored.
const forged = [{ kind: "done", n: 2, ts: t0, rank: 20 }];   // Player tried to claim batch 2
s = compute(forged, t0 + COOL + 1);
eq(s.currentBatch, 1, "non-Owner upgrade event ignored -> batch stays 1");

// 7) Channel-existence floor: a room whose channels are fully built reads as
// upgraded even with NO done markers (e.g. a marker send failed, or pre-pagination
// it didn't replay). status() passes this floor in as _computeStatus's 3rd arg.
s = compute([], 1000);                         // no markers, no floor -> batch 1
eq(s.currentBatch, 1, "no markers, no floor -> batch 1");
s = RU._computeStatus([], 1000, 3);            // floor says all batch-3 channels exist
eq(s.currentBatch, 3, "floor 3 (channels present) -> currentBatch 3");
eq(s.nextBatch, null, "floor 3 -> no next batch");
eq(s.canUpgradeNow, false, "fully-built room never offers a redundant upgrade");
s = RU._computeStatus([], 1000, 2);            // batch-2 channels present, batch-3 not
eq(s.currentBatch, 2, "floor 2 -> currentBatch 2");
eq(s.nextBatch, 3, "floor 2 -> next batch 3 still offered");
// A done marker beyond the floor still wins (floor is only a minimum).
s = RU._computeStatus([{ kind: "done", n: 3, ts: 1, rank: OWNER }], 1000 + COOL, 2);
eq(s.currentBatch, 3, "explicit done 3 beats a lower channel floor");

console.log("[upgrade] PASS — batch, cooldown, resume, cap, owner-gating, and channel-floor reconciliation all correct");
process.exit(0);
