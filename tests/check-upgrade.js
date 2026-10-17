// tests/check-upgrade.js
// SUBJECT: features/roomupgrade.js, features/actions.js, ui/roster.js
// WALL: the room-upgrade gate logic. Verifies the pure status computation —
// current batch, next batch, the 2h cooldown, mid-flight resume, the cap at
// batch 3, and that a forged (non-Owner) upgrade event is ignored.

const assert = require("assert");
const { loadInContext } = require("./_load");

const RU = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/roomupgrade.js"], { Date }).RoomUpgrade;
// PART A drives the ARITHMETIC for a three-batch plan, handed in. Which plan a room HAS — and
// when that is read — is PART B's question, and the reason this is a parameter rather than
// whatever the module happened to read at load.
const TOP = 3;
const compute = (events, now) => RU._computeStatus(events, now, undefined, TOP);

const H = 60 * 60 * 1000;
const B_PENDING = [];   // PART B's asynchronous verdicts, judged before the PASS line
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
s = RU._computeStatus([], 1000, 3, TOP);            // floor says all batch-3 channels exist
eq(s.currentBatch, 3, "floor 3 (channels present) -> currentBatch 3");
eq(s.nextBatch, null, "floor 3 -> no next batch");
eq(s.canUpgradeNow, false, "fully-built room never offers a redundant upgrade");
s = RU._computeStatus([], 1000, 2, TOP);            // batch-2 channels present, batch-3 not
eq(s.currentBatch, 2, "floor 2 -> currentBatch 2");
eq(s.nextBatch, 3, "floor 2 -> next batch 3 still offered");
// A done marker beyond the floor still wins (floor is only a minimum).
s = RU._computeStatus([{ kind: "done", n: 3, ts: 1, rank: OWNER }], 1000 + COOL, 2, TOP);
eq(s.currentBatch, 3, "explicit done 3 beats a lower channel floor");

// 8) No upgrade path. A plan built entirely at creation has nothing to offer, and neither does an
// UNREADABLE top batch — there is no fallback number to guess with (the module used to hold `3`).
s = RU._computeStatus([], 1000, 1, 1);
eq(s.hasPath, false, "one-batch plan -> no upgrade path");
eq(s.nextBatch, null, "one-batch plan -> no next batch");
eq(s.canUpgradeNow, false, "one-batch plan -> nothing to upgrade");
s = RU._computeStatus([{ kind: "start", n: 2, ts: 1, rank: OWNER }], 1000, 1, 1);
eq(s.inProgress, null, "one-batch plan -> a stray start marker is not a resumable batch");
eq(s.canUpgradeNow, false, "one-batch plan -> and offers no Resume either");
for (const bad of [undefined, null, 0, NaN, "3"]) {
  s = RU._computeStatus([], 1000, 1, bad);
  eq(s.hasPath, false, "unreadable top batch (" + String(bad) + ") -> no path, not a guess");
  eq(s.maxBatch, null, "unreadable top batch (" + String(bad) + ") -> reported as unknown, not as a number");
  eq(s.canUpgradeNow, false, "unreadable top batch (" + String(bad) + ") -> not offered");
}
eq(RU._computeStatus([], 1000, 1, TOP).hasPath, true, "control: a three-batch plan HAS a path");
// And through `status()` itself. THIS sandbox never loaded the transport, so it is the one place the
// module's own "cannot ask" branch is reached — and it must answer *no path*, not a remembered number.
eq(RU.status().hasPath, false, "status() with no transport loaded -> no path (no literal fallback)");
eq(RU.status().maxBatch, null, "status() with no transport loaded -> top batch unknown, not a number");

// ── PART B — A ROOM WITH NO UPGRADE PATH IS OFFERED NOTHING, IN EVERY ENGINE ────────────────────
// REPORTED FROM A LIVE BOT ROOM: the header offered "Upgrade (1/3)" in a room type that is built in
// one piece. The transport already answered correctly for the bound engine (top batch 1); this module
// had read that answer ONCE, at load, while bootstrap had the shared engine bound, and kept it.
//
// Everything above drives `_computeStatus` with the top batch handed in, so none of it can see WHEN
// the number is read — which is exactly how this shipped. So this part loads the REAL modules in
// PAGE ORDER (bootstrap binding included, which is the moment the defect lived in), binds each ready
// engine the way `Room.join` does, and asks the three things a person meets: the descriptor, the
// panel, and the click. The rule is DERIVED from each engine's own plan, never from a mode id — a
// room offers an upgrade exactly when its plan holds a batch beyond creation.
//
// OWNER RULING (recorded in `consensus/bot-backend.md` §9): with no upgrade path the slot shows
// NOTHING — not "All ranks unlocked", not a disabled button.
{
  const fs = require("fs");
  const path = require("path");
  const vm = require("vm");
  const ROOT = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const order = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1]);
  const boot = order.indexOf("core/bind-bootstrap.js");
  if (boot < 0) fail("B: could not find core/bind-bootstrap.js in index.html's script order — refusing rather than loading a world with nothing bound");
  // Everything the page loads up to and including bootstrap (no network, no vendored SDK), then the
  // two features this part judges, in the page's own relative order.
  const files = order.slice(0, boot + 1).filter((f) => !/^https?:|^lib\//.test(f))
    .concat(order.filter((f) => f === "features/roomupgrade.js" || f === "features/actions.js"));
  if (files.filter((f) => f.startsWith("features/")).length !== 2) fail("B: roomupgrade.js and actions.js must both be in index.html's script list", files);

  // The panel, EXTRACTED FROM ui/roster.js AND EXECUTED — the ruling is about what renders, and a
  // regex proving a branch is spelled proves nothing about whether it runs.
  const roster = fs.readFileSync(path.join(ROOT, "ui/roster.js"), "utf8");
  const a = roster.indexOf("function renderUpgradePanel()");
  const b = roster.indexOf("async function runUpgrade()");
  if (a < 0 || b < 0 || b < a) fail("B: extraction refused — could not bound renderUpgradePanel in ui/roster.js (renamed or reordered?)");
  const panelSrc = roster.slice(a, b);

  let withPath = 0, withoutPath = 0;
  const seen = loadInContext(files, { Room: { getChannels: () => ({}), getCurrent: () => null }, Date });
  const modes = vm.runInContext("Backends.modes().filter((m) => Backends.isReady(m))", seen);
  if (!modes.length) fail("B: no ready engine registered — nothing to judge");

  for (const mode of modes) {
    let channels = {};
    const Room = {
      getChannels: () => channels,
      getCurrent: () => ({ spaceId: "!space:hs" }),
      getMyId: () => "@owner:hs",
      getMyAuthorityLevel: () => 100,       // the human owner, which is who the header is for
      getMyRank: () => 99,
    };
    const ctx = loadInContext(files, { Room, Date });   // a fresh client per engine
    const run = (s) => vm.runInContext(s, ctx);
    if (run("Backends.active()") === null) fail("B: bootstrap bound nothing at load — this part would not reproduce the page");
    run("Backends.bind(" + JSON.stringify(mode) + ")");
    // A freshly created room of this type: exactly its creation channels, from the transport's own
    // reading of the bound plan.
    const plan = run("MatrixBridge.channelTaxonomy()");
    for (const c of plan) if (c.batch === 1) channels[c.key] = "!" + c.key + ":hs";
    const top = Math.max.apply(null, plan.map((c) => c.batch));
    const hasPath = top > 1;
    if (hasPath) withPath++; else withoutPath++;

    const d = ctx.Actions.describe("room.upgrade", { retryAt: 0 });
    const st = ctx.RoomUpgrade.status();
    const slot = { children: [], appendChild(n) { this.children.push(n); } };
    const H = {
      el: (tag, attrs) => ({ tag, cls: (attrs && attrs.class) || "", text: (attrs && attrs.text) || "" }),
      clear: (s) => { s.children.length = 0; },
      clearCountdown: () => {}, startCountdown: () => {},
    };
    const render = vm.runInContext("(function (refs, H) {" + panelSrc + "; function runUpgrade() {}; return renderUpgradePanel; })", ctx)({ upgradeSlot: slot }, H);
    render();

    if (hasPath) {
      eq(d.enabled, true, "B[" + mode + "]: a room whose plan has later batches must offer its owner the upgrade");
      eq(st.maxBatch, top, "B[" + mode + "]: status reads the BOUND engine's top batch, not the one bound at load");
      eq(st.canUpgradeNow, true, "B[" + mode + "]: a fresh room of this type may upgrade");
      eq(slot.children.filter((n) => n.tag === "button" && /upgrade-btn/.test(n.cls)).length, 1,
        "B[" + mode + "]: the header renders the upgrade button");
    } else {
      eq(d.enabled, false, "B[" + mode + "]: a room built in one piece must NOT offer an upgrade");
      if (typeof d.reason !== "string" || !d.reason) fail("B[" + mode + "]: the refusal must carry the backend's sentence, not a bare false", d);
      eq(st.canUpgradeNow, false, "B[" + mode + "]: status must not report an upgrade available");
      eq(st.nextBatch, null, "B[" + mode + "]: and must name no next batch");
      eq(slot.children.length, 0, "B[" + mode + "]: the header slot renders NOTHING (owner ruling) — got " + JSON.stringify(slot.children));
      // The click path goes through the same answer, so the offer and the act cannot disagree.
      let refused = null;
      ctx.Actions.perform("room.upgrade", {}).then(
        () => fail("B[" + mode + "]: perform ran an upgrade in a room with no upgrade path"),
        (e) => { refused = e && e.message; });
      B_PENDING.push(() => eq(refused, d.reason, "B[" + mode + "]: perform refuses with the descriptor's own reason"));
    }
  }
  // ONE CLIENT, SEVERAL ROOMS. A client enters a room of one type, backs out to the lobby, and
  // enters another — in both orders. Each fresh client above can only prove the FIRST reading is
  // right; a module that remembers its first answer passes every one of them. This walks one
  // client through every ready engine and back, and the answer must follow the room it is in.
  {
    let channels = {};
    const Room = { getChannels: () => channels, getCurrent: () => ({ spaceId: "!space:hs" }),
                   getMyId: () => "@owner:hs", getMyAuthorityLevel: () => 100, getMyRank: () => 99 };
    const ctx = loadInContext(files, { Room, Date });
    const run = (s) => vm.runInContext(s, ctx);
    const walk = modes.concat(modes.slice().reverse(), modes);
    let walked = 0;
    for (const mode of walk) {
      run("Backends.bind(" + JSON.stringify(mode) + ")");
      const plan = run("MatrixBridge.channelTaxonomy()");
      channels = {};
      for (const c of plan) if (c.batch === 1) channels[c.key] = "!" + c.key + ":hs";
      const hasPath = Math.max.apply(null, plan.map((c) => c.batch)) > 1;
      eq(ctx.Actions.describe("room.upgrade", { retryAt: 0 }).enabled, hasPath,
        "B-walk[" + walked + ":" + mode + "]: after entering other rooms first, the offer still follows THIS room's plan");
      eq(ctx.RoomUpgrade.status().hasPath, hasPath,
        "B-walk[" + walked + ":" + mode + "]: and so does status — nothing is carried from the last room");
      walked++;
    }
    if (modes.length > 1 && walked < 2 * modes.length) fail("B-walk: the walk visited too few rooms to cross an engine boundary", walked);
  }

  // PREMISE: both directions must have been exercised, or a green here says nothing.
  if (withPath < 1) fail("B: no engine with an upgrade path was judged — the offering direction is untested");
  if (withoutPath < 1) fail("B: no engine without an upgrade path was judged — the reported case is untested");
}

// The perform rejections settle on the microtask queue; judge them, THEN announce. The PASS line is
// below every part in TIME, not just in the file (FAILURE-SIGNATURES, the thirty-ninth).
Promise.resolve().then(() => Promise.resolve()).then(() => {
  for (const f of B_PENDING) f();
  console.log("[upgrade] PASS — batch, cooldown, resume, cap, owner-gating, and channel-floor reconciliation all correct; " +
    "and in every ready engine, driven through the real modules in page order, a room is offered an upgrade exactly when " +
    "its own plan holds a batch beyond creation — the header renders nothing and the click is refused otherwise (owner ruling)");
  process.exit(0);
});
