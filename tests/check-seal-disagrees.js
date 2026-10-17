// tests/check-seal-disagrees.js
// SUBJECT: backends/backend1/checkpoint.js, backends/backend1/streammanager.js
// WALL: A DEVICE THAT DISAGREES DOES NOT SEAL ON ITS FLOOR (step 5b, `ddjp_554`, the owner's ruling). The J73 state comparison
//   is a diagnostic only: it no longer gates forgetting, but a device whose own check of its floor says "mismatched" follows
//   that floor, as the consensus decides, and does not seal on it. Driven with the real modules: a device holding the room
//   from its start receives a DISHONEST owner-tier floor; `Checkpoint.maySeal`, wired to `disagreesWithFloor` as the bridge
//   wires it, must refuse with `my-view-disagrees`. Control: an honest floor is not refused for that reason.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[seal-disagrees] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js"];
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const T0 = 1.7e12, MIN = 60000;
function device(dishonest) {
  const sb = loadInContext(FILES, { Logger: quiet }); sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {}
  try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); if (sb.Session.sawEvent) sb.Session.sawEvent(); } catch (e) {}
  if (!sb.Session.mayAuthor() && typeof sb.Session._setPhaseForTest === "function") sb.Session._setPhaseForTest(sb.Session.LIVE);
  const S = Object.assign(sb.StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const log = [F.reducerEvent("$s", 1, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S })];
  for (let l = 2; l <= 30; l++) log.push(F.reducerEvent("$e" + String(l).padStart(3, "0"), l, T0 + l * MIN, "@d" + (l % 3) + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const upto = sb.StreamManager.getLog().filter((e) => e.l <= 20);
  const seed = sb.StateDeriver.buildSeed(upto, undefined);
  if (dishonest) seed.settings = Object.assign({}, seed.settings, { repeatCooldownMs: 1234567 });
  const cp = F.real(sb.Floor, { n: 1, prev: null, seed: seed, h: "h1", covers: upto[0].eventId + ".." + upto[upto.length - 1].eventId, floorL: 20, thin: false, by: "@o:hs" });
  sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, cp), tier: 0 });
  sb.StreamManager.trimToFloor();                                         // the refold (line 910) runs the diagnostic comparison
  let clock = T0 + 40 * MIN;
  sb.Checkpoint.attach({ now: () => clock, log: () => sb.StreamManager.getLog(), held: () => [], settings: () => sb.StreamManager.getState().settings,
    myRank: () => 99, myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => sb.Floor.anchorTs(), floorPos: () => sb.Floor.position(), send: async () => {},
    disagrees: () => sb.StreamManager.disagreesWithFloor() });            // as the bridge wires it
  return sb;
}
const bad = device(true), good = device(false);
ok(bad.StreamManager.seedValidation().status === "mismatched" && bad.StreamManager.disagreesWithFloor() === true,
  "PREMISE — the device's own (diagnostic) check of the dishonest floor says mismatched", bad.StreamManager.seedValidation());
ok(bad.Floor.current() && bad.Floor.current().floorL === 20, "the dishonest floor is FOLLOWED, as the consensus decides");
ok(bad.StreamManager.getLog().length === 30, "and nothing is forgotten under it — it cannot prove itself", bad.StreamManager.getLog().length);
const g1 = bad.Checkpoint.maySeal(T0 + 40 * MIN);
ok(g1 && g1.ok === false && g1.reason === "my-view-disagrees", "disagrees → no seal: maySeal refuses on this device's own mismatched check", g1);
const g2 = good.Checkpoint.maySeal(T0 + 40 * MIN);
ok(good.StreamManager.disagreesWithFloor() === false && !(g2 && g2.reason === "my-view-disagrees"), "CONTROL: an honest floor is not refused for disagreeing", g2);
// THE BANKED CASE SEALS (`ddjp_556`): the floor arrives first and the events below it later (banked), so this device's own
// genesis comparison says "mismatched" on INCOMPLETE data — that is "can't tell", not disagreement, and it must not block sealing.
{ const sb = loadInContext(FILES, { Logger: quiet }); sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {}
  try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); if (sb.Session.sawEvent) sb.Session.sawEvent(); } catch (e) {}
  if (!sb.Session.mayAuthor() && typeof sb.Session._setPhaseForTest === "function") sb.Session._setPhaseForTest(sb.Session.LIVE);
  const S = Object.assign(sb.StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const log = [F.reducerEvent("$s", 1, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S })];
  for (let l = 2; l <= 30; l++) log.push(F.reducerEvent("$e" + String(l).padStart(3, "0"), l, T0 + l * MIN, "@d" + (l % 3) + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
  const scratch = loadInContext(FILES, { Logger: quiet }); scratch.StreamManager.reset(); for (const e of log) scratch.StreamManager.ingest(F.toRaw(e));
  const upto = scratch.StreamManager.getLog().filter((e) => e.l <= 20);
  const cp = F.real(sb.Floor, { n: 1, prev: null, seed: sb.StateDeriver.buildSeed(upto, undefined), h: "h1", covers: upto[0].eventId + ".." + upto[upto.length - 1].eventId, floorL: 20, thin: false, by: "@o:hs" });
  sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, cp), tier: 0 });      // the floor FIRST
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));                     // then the events: those at or below l=20 are banked
  // and the SECOND floor (l=28), whose boundary IS held: its genesis comparison runs on a held log missing l=1–20 (the bot at 15:05:09)
  const upto2 = scratch.StreamManager.getLog().filter((e) => e.l <= 28);
  const cp2 = F.real(sb.Floor, { n: 2, prev: "h1", seed: sb.StateDeriver.buildSeed(upto2.filter((e) => e.l > 20), cp.seed), h: "h2",
    covers: upto2[0].eventId + ".." + upto2[upto2.length - 1].eventId, floorL: 28, thin: false, by: "@o:hs" });
  sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, cp2), tier: 0 });
  sb.StreamManager.trimToFloor();
  sb.Checkpoint.attach({ now: () => T0 + 40 * MIN, log: () => sb.StreamManager.getLog(), held: () => [], settings: () => sb.StreamManager.getState().settings,
    myRank: () => 99, myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => sb.Floor.anchorTs(), floorPos: () => sb.Floor.position(), send: async () => {}, disagrees: () => sb.StreamManager.disagreesWithFloor() });
  const v = sb.StreamManager.seedValidation();
  ok(v.status === "mismatched", "BANKED PREMISE — the banked device's own (diagnostic) check says mismatched, on incomplete data", v);
  const g4 = sb.Checkpoint.maySeal(T0 + 40 * MIN);
  ok(sb.StreamManager.disagreesWithFloor() === false && !(g4 && /my-view-disagrees/.test(g4.reason || "")),
    "the banked case seals: a check on incomplete data is \"can't tell\", which does not block sealing", { disagrees: sb.StreamManager.disagreesWithFloor(), gate: g4 }); }
// FAILS CLOSED (`ddjp_555`): a device that cannot tell whether it disagrees does not seal.
{ const sb = device(false);
  sb.Checkpoint.attach(Object.assign({}, { now: () => T0 + 40 * MIN, log: () => sb.StreamManager.getLog(), held: () => [], settings: () => sb.StreamManager.getState().settings,
    myRank: () => 99, myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => sb.Floor.anchorTs(), floorPos: () => sb.Floor.position(), send: async () => {} },
    { disagrees: () => { throw new Error("cannot tell"); } }));
  const g3 = sb.Checkpoint.maySeal(T0 + 40 * MIN);
  ok(g3 && g3.ok === false && g3.reason === "my-view-disagrees-unknown", "the seal check FAILS CLOSED: a check that throws refuses with my-view-disagrees-unknown", g3); }
if (failed) { console.log("[seal-disagrees] " + failed + " failure(s)"); process.exit(1); }
console.log("[seal-disagrees] PASS — a device whose own check of its floor says mismatched follows the floor, forgets nothing under it, and does not seal on it (" + asserts + " assertions)");
