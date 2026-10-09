// tools/probes/probe-j78-floor-first.js
// SUBJECT: J78 item 3, STUDY ONLY — why the owner's device never forgets (decentralized test, `ddjp_539`). MEASUREMENT: the real
// backend1 modules, two arrival orders. (1) The owner's: a floor first, the events below it later, then live events, then a
// later seal. (2) Control: the events first, then the floors. Reports the licence (seedValidation) and what a trim drops.
//   node tools/probes/probe-j78-floor-first.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const P = F.RANK.player, O = F.RANK.owner, T0 = 1.7e12, MIN = 60000;
function events(S) {
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
  let prev = null;
  for (let l = 2; l <= 70; l++) {
    const k = l % 5, id = "$e" + l;
    if (l <= 4) E.push(F.reducerEvent(id, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
    else if (k === 0) { E.push(F.reducerEvent(id, l, T0 + l * 4 * MIN, "@d2:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
    else E.push(F.reducerEvent(id, l, T0 + l * MIN, "@v" + k + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" }));
  }
  return E;
}
function floorAt(sb, E, n, L, prevH) {
  const upto = E.filter((e) => e.l <= L), last = upto[upto.length - 1];
  return { n: n, h: "h" + n, floorL: L, grade: "verified", covers: upto[0].eventId + ".." + last.eventId,
    seed: sb.StateDeriver.buildSeed(sb.StreamManager.orderEvents ? sb.StreamManager.orderEvents(upto) : upto, undefined), prev: prevH || null, thin: false };
}
for (const order of ["floor first (the owner's)", "events first (control)"]) {
  const sb = loadInContext(FILES, {}), SM = sb.StreamManager; sb.Floor.reset(); SM.reset();
  const E = events(sb.StateDeriver);
  const f17 = floorAt(sb, E, 1, 17), f66 = floorAt(sb, E, 2, 66, "h1");
  if (order.startsWith("floor")) {
    sb.Floor._setTrustedForTest(f17);
    for (const e of E.filter((x) => x.l <= 17)) SM.ingest(F.toRaw(e));          // the events below the floor arrive AFTER it
    for (const e of E.filter((x) => x.l > 17)) SM.ingest(F.toRaw(e));
  } else {
    for (const e of E) SM.ingest(F.toRaw(e));
    sb.Floor._setTrustedForTest(f17);
  }
  const v17 = SM.seedValidation(), d17 = SM.trimToFloor();
  sb.Floor._setTrustedForTest(f66);
  const v66 = SM.seedValidation(), d66 = SM.trimToFloor();
  console.log(order.padEnd(28) + " | floor 17: " + v17.status + (v17.reason ? " (" + v17.reason + ")" : "") + ", trim dropped " + d17 +
    " | floor 66: " + v66.status + (v66.reason ? " (" + v66.reason + ")" : "") + ", trim dropped " + d66 + " | held " + SM.getLog().length);
}
console.log("MEASURED");
