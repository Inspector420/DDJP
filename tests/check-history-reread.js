// tests/check-history-reread.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js
// WALL: ROWS DROPPED UNDER A REPLACED FLOOR ARE RE-READ (owner's live test on `ddjp_554`: "dropped 7/9/8/4/2 row(s) … they will
//   be re-read from the room", yet the owner ended with 20 songs and the bot with 27). `reconcileFloor` clipped coverage at the
//   top SURVIVING row, so a dropped row below it stayed claimed as covered: the gap filler never paged it, and coverage still
//   read complete — "back to the room's beginning". Driven with the real History and a pager over the whole room (a server):
//   a device that has FORGOTTEN the dropped row's events gets it back from the server, and coverage tells the truth.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[history-reread] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/history.js"];
(async () => {
  const sb = loadInContext(FILES, {}); const H = sb.History; H.reset();
  const S = sb.StateDeriver.defaultSettings(), P = F.RANK.player, O = F.RANK.owner, T0 = 1.7e12, MIN = 60000;
  // A room: three DJs, plays at l=5, 10, 15 (each ends at the next play), a last play at l=20.
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S })];
  for (let l = 2; l <= 4; l++) E.push(F.reducerEvent("$j" + l, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
  let prev = null; for (const l of [5, 10, 15, 20]) { E.push(F.reducerEvent("$p" + l, l, T0 + l * 4 * MIN, "@d" + ((l / 5) % 3 + 2) + ":hs", O, { t: "ddjp.dj.play", p: prev })); prev = "$p" + l; }
  const all = E.map((e) => Object.assign({}, e));
  const truth = (sb.StateDeriver.derive(all).history || []).map((r) => r.pi).sort();
  ok(truth.length >= 2, "PREMISE — the room has finished songs", truth);
  // The device's table, as a stored snapshot after a burst: three rows; the middle one (l=10) stamped under an OLD floor.
  H.restore({ v: 2, rows: [{ pi: "$p5", l: 5, floorSig: "new" }, { pi: "$p10", l: 10, floorSig: "old" }, { pi: "$p15", l: 15, floorSig: "new" }], ranges: [[0, 20]], adds: {} });
  // The device HOLDS the recent events (l >= 16, as a trimmed device does) and has FORGOTTEN those below: only the server can
  // give the dropped row back.
  const held = all.filter((e) => e.l >= 16);
  const SEED15 = sb.StateDeriver.buildSeed(all.filter((e) => e.l <= 15), undefined);   // the floor it stands on (cut 15)
  H.attach({ log: () => held, heldFrom: () => 16, seed: () => SEED15,
    pageRange: async (a, b) => { const out = all.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
  const rc = H.reconcileFloor("new", 7);          // the floor moved to one whose cut is l=7: the old-stamped l=10 row is dropped
  ok(rc.dropped === 1, "PREMISE — the old-stamped row above the cut was dropped", rc);
  H.refresh();                                   // the held log covers its own span, as the bridge's refresh does
  const cov1 = H.coverage();
  ok(cov1.ranges && cov1.ranges.length >= 2 && cov1.ranges.some((r) => r[0] <= 10 && r[1] >= 10) === false,
    "the dropped row's position is NOT claimed as covered — a hole is open for the re-read", cov1.ranges);
  await H.fillGaps();
  const have = (H.recent(5000) || []).map((r) => r.pi);
  ok(have.indexOf("$p10") >= 0, "the dropped row is RE-READ from the server", have);
  const cov2 = H.coverage();
  ok(cov2.complete === true && cov2.ranges.length === 1, "and coverage then truly reaches the room's beginning, with no hole", cov2.ranges);
  const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  ok(/they will be re-read from the room[\s\S]{0,400}History\.refresh\(\)[\s\S]{0,200}History\.fillGaps/.test(MB), "the bridge's floor handler re-reads after a drop: the held log, then the server's gap");
  // B — REFUSED UNDER THE OLD FLOOR, ACCEPTED UNDER THE NEW (`ddjp_557`): the stored table (derived under the replaced floor) has
  //     NO row at l=65; the room, derived whole, accepts that play. Clipped to the cut, the gap filler re-reads it — once.
  { const sb2 = loadInContext(FILES, {}); const H2 = sb2.History; H2.reset();
    const E2 = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S })];
    for (const l of [2, 3, 4]) E2.push(F.reducerEvent("$j" + l, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
    E2.push(F.reducerEvent("$j80", 80, T0 + 80 * MIN, "@d5:hs", P, { t: "ddjp.dj.join", v: "vid00000080" }));
    let pv = null; for (const l of [5, 65, 70, 90]) { E2.push(F.reducerEvent("$q" + l, l, T0 + l * 4 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: pv })); pv = "$q" + l; }
    const all2 = E2.slice().sort((a, b) => a.l - b.l);
    const truth2 = (sb2.StateDeriver.derive(all2).history || []).map((r) => r.pi).sort();
    ok(truth2.indexOf("$q65") >= 0, "B PREMISE — the room, derived whole, ACCEPTS the play at l=65", truth2);
    const SEED79 = sb2.StateDeriver.buildSeed(all2.filter((e) => e.l <= 79), undefined);
    const held2 = all2.filter((e) => e.l >= 80);
    H2.attach({ log: () => held2, heldFrom: () => 80, seed: () => SEED79,
      pageRange: async (a, b) => { const out = all2.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
    H2.restore({ v: 2, rows: [{ pi: "$q5", l: 5, floorSig: "old" }, { pi: "$q70", l: 70, floorSig: "old" }], ranges: [[0, 95]], adds: {} });   // no $q65: refused under the old floor
    H2.reconcileFloor("new", 60); H2.refresh();
    ok(JSON.stringify(H2.coverage().ranges.filter((r) => r[0] <= 60)) === JSON.stringify([[0, 60]]), "B: coverage is clipped TO THE CUT — every position above it is re-read", H2.coverage().ranges);
    await H2.fillGaps();
    const have2 = (H2.recent(5000) || []).map((r) => r.pi);
    ok(have2.indexOf("$q65") >= 0, "B: the play refused under the replaced floor and accepted under the new one ends in history", have2);
    ok(have2.length === new Set(have2).size, "B: and the re-read is IDEMPOTENT — surviving rows re-read give no duplicates", have2);
    // C — A RESTORE AFTER THE DROP does not close the hole again: the bridge reconciles the restored table against the floor.
    H2.restore({ v: 2, rows: [{ pi: "$q5", l: 5, floorSig: "old" }, { pi: "$ghost", l: 72, floorSig: "old" }], ranges: [[0, 95]], adds: {} });
    H2.reconcileFloor("new", 60);                   // what the bridge now does right after History.restore
    ok((H2.recent(5000) || []).every((r) => r.pi !== "$ghost") && JSON.stringify(H2.coverage().ranges.filter((r) => r[0] <= 60)) === JSON.stringify([[0, 60]]),
      "C: a restored stale table is reconciled — its stale rows above the cut drop and its coverage is clipped, so it cannot close the hole", H2.coverage().ranges);
    ok(/History\.restore\(snap\);[\s\S]{0,900}History\.reconcileFloor\(/.test(MB), "C: the bridge reconciles a restored table right after History.restore"); }
  // D — THE BURST AT OPEN RUNS THE BACKFILL ONCE (`ddjp_557`): six re-arms (one per trim) share one scheduled run.
  { const i = MB.indexOf("  let _rearmTimer = null;"), j = MB.indexOf("\n  }\n", MB.indexOf("  function rearmHistoryBackfill() {")) + 4;
    let runs = 0; const timers = [];
    const api = new Function("backfillHistory", "setTimeout", "timers", MB.slice(i, j) + "\n_rearmLater = (fn) => { timers.push(fn); return timers.length; };\nreturn { rearm: rearmHistoryBackfill };")(() => { runs++; }, () => 0, timers);
    for (let k = 0; k < 6; k++) api.rearm();
    ok(timers.length === 1 && runs === 0, "D: six re-arms in a burst schedule ONE backfill run", { scheduled: timers.length, runs });
    timers.splice(0).forEach((fn) => fn());
    ok(runs === 1, "D: and it runs once — \"restored … / backfill ok\" said once, not six times", runs);
    api.rearm(); ok(timers.length === 1, "D: a later re-arm schedules a fresh run"); }
  if (failed) { console.log("[history-reread] " + failed + " failure(s)"); process.exit(1); }
  console.log("[history-reread] PASS — rows dropped under a replaced floor are re-read from the server, and coverage reports complete only when they are (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[history-reread] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
