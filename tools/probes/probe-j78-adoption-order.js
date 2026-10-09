// tools/probes/probe-j78-adoption-order.js
// SUBJECT: J78 item 3, STUDY ONLY — why the owner's device never forgets. MEASUREMENT through the REAL paths: checkpoints are
// produced by the real `Checkpoint.seal()` on a sealer device that holds the room (as the bot's did), and delivered to the
// owner's device through the bridge's own `_onCheckpointArrived` (from the shipped file: Floor.remember → adopt/select), in
// the owner's live order: n=1 (floorL 17) FIRST; events l=1–17 AFTER it; live events; then n=2 at floorL 66.
//   node tools/probes/probe-j78-adoption-order.js
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js"];
const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
function device(name) {
  const logs = [];
  const L = { info: (m) => logs.push(String(m)), warn: (m) => logs.push("WARN " + String(m)), debug: (m) => logs.push("dbg " + String(m)), error: (m) => logs.push("ERR " + String(m)) };
  const sb = loadInContext(FILES, { Logger: L });
  // core/logger.js replaces an injected Logger (`ddjp_555`): capture on the sandbox's own, and say whether capture works.
  if (sb.Logger) { const _cap = (p) => (m) => logs.push(p + String(m)); sb.Logger.info = _cap(""); sb.Logger.warn = _cap("WARN "); sb.Logger.debug = _cap("dbg "); sb.Logger.error = _cap("ERR "); }
  sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {}
  return { name, sb, logs, SM: sb.StreamManager, Fl: sb.Floor };
}
// the room's events (the same on every device)
const S0 = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings();
const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: Object.assign({}, S0, { checkpointEvery: 5, checkpointCooldownMs: 0 }) })];
let prev = null;
for (let l = 2; l <= 70; l++) { const id = "$e" + l;
  if (l <= 4) E.push(F.reducerEvent(id, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
  else if (l % 5 === 0) { E.push(F.reducerEvent(id, l, T0 + l * 4 * MIN, "@d2:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
  else E.push(F.reducerEvent(id, l, T0 + l * MIN, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); }
(async () => {
  // ── the SEALER (holds the room, as the bot did): real seals at floorL 17 and 66 ──
  const S = device("sealer"), sealed = [];
  // the sealer is LIVE, as a device is after opening the room: through the session's real lifecycle, the seam only if that does not reach it
  try { S.sb.Session.enterRoom("!r:hs"); S.sb.Session.replayFinished(); if (S.sb.Session.sawEvent) S.sb.Session.sawEvent(); } catch (e) {}
  if (!S.sb.Session.mayAuthor() && typeof S.sb.Session._setPhaseForTest === "function") S.sb.Session._setPhaseForTest(S.sb.Session.LIVE);
  console.log("sealer session phase: " + S.sb.Session.phase());
  let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings,
    myRank: () => BOT, myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null,
    thin: () => false, floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { sealed.push(JSON.parse(JSON.stringify(cp))); } });
  for (const e of E.filter((x) => x.l <= 17)) S.SM.ingest(F.toRaw(e));
  clock = T0 + 18 * MIN * 4; const r1 = await S.sb.Checkpoint.seal();
  for (const e of E.filter((x) => x.l > 17 && x.l <= 66)) S.SM.ingest(F.toRaw(e));
  clock = T0 + 67 * MIN * 4; const r2 = await S.sb.Checkpoint.seal();
  console.log("sealer: seal 1 " + (r1.ok ? "ok n=" + r1.checkpoint.n + " floorL=" + r1.checkpoint.floorL : "REFUSED " + r1.reason) +
    " | seal 2 " + (r2.ok ? "ok n=" + r2.checkpoint.n + " floorL=" + r2.checkpoint.floorL : "REFUSED " + r2.reason));
  if (sealed.length < 2) { console.log("MEASURED (the sealer did not produce two seals)"); return; }
  // ── the OWNER'S DEVICE: the live arrival order through the bridge's own handler ──
  const D = device("owner");
  const arrived = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", ARRIVED + "\nreturn _onCheckpointArrived;")(
    D.Fl, D.sb.TrustPolicy, D.sb.Continuity, D.SM, { info() {}, warn: (m) => D.logs.push("WARN " + m), debug() {}, error() {} }, () => D.SM.getState().settings);
  D.Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { D.SM.trimToFloor(); } catch (e) {} } });
  const say = (label) => { const v = D.SM.seedValidation ? D.SM.seedValidation() : {}; const f = D.Fl.current && D.Fl.current();
    console.log(label.padEnd(36) + " | floor " + (f ? "n=" + f.n + " L=" + f.floorL : "none") + " | licence " + (v.status || "?") + (v.reason ? " (" + v.reason + ")" : "") + " | held " + D.SM.getLog().length); };
  arrived({ content: sealed[0], senderRank: BOT, sender: "@bot:hs", ts: T0 + 18 * MIN });  say("1. n=1 (floorL 17) arrives FIRST");
  for (const e of E.filter((x) => x.l <= 17)) D.SM.ingest(F.toRaw(e));                     say("2. events l=1–17 arrive after it");
  for (const e of E.filter((x) => x.l > 17)) D.SM.ingest(F.toRaw(e));                      say("3. live events l=18–70");
  arrived({ content: sealed[1], senderRank: BOT, sender: "@bot:hs", ts: T0 + 67 * MIN });  say("4. n=2 (floorL 66) arrives");
  // control: the same device, events first
  const C = device("control");
  const arrivedC = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", ARRIVED + "\nreturn _onCheckpointArrived;")(
    C.Fl, C.sb.TrustPolicy, C.sb.Continuity, C.SM, { info() {}, warn() {}, debug() {}, error() {} }, () => C.SM.getState().settings);
  C.Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { C.SM.trimToFloor(); } catch (e) {} } });
  for (const e of E) C.SM.ingest(F.toRaw(e)); arrivedC({ content: sealed[0], senderRank: BOT, sender: "@bot:hs", ts: T0 }); arrivedC({ content: sealed[1], senderRank: BOT, sender: "@bot:hs", ts: T0 });
  { const v = C.SM.seedValidation(), f = C.Fl.current(); console.log("CONTROL events first, then n=1, n=2".padEnd(36) + " | floor " + (f ? "n=" + f.n + " L=" + f.floorL : "none") + " | licence " + v.status + (v.reason ? " (" + v.reason + ")" : "") + " | held " + C.SM.getLog().length); }
  // WHAT-IF (no shipped change): the move-on check on the owner's device at n=2 — does its held log fold from n=1's seed?
  try { console.log("the move-on check on the owner's device at n=2: " + JSON.stringify(D.SM.reproduces(D.Fl.current()))); } catch (e) { console.log("the move-on check threw: " + e.message); }
  // An explicit trim on each device after n=2 (the real bridge has trim triggers besides adoption that this probe does not wire).
  const dOwner = D.SM.trimToFloor(), dCtl = C.SM.trimToFloor();
  console.log("explicit trim after n=2: owner's device dropped " + dOwner + " (licence " + D.SM.seedLicensesForget() + "), held " + D.SM.getLog().length +
    " | control dropped " + dCtl + " (licence " + C.SM.seedLicensesForget() + "), held " + C.SM.getLog().length);
  console.log("the owner's device banked below the accepted boundary: " + (D.SM._trimState ? JSON.stringify(D.SM._trimState()) : "?"));
  console.log("--- the owner's device, relevant lines:");
  for (const l of D.logs.filter((x) => /banked below|diverges|DISAGREES|not licensed|REFUSING|refus|remember/i.test(x)).slice(0, 10)) console.log("  " + l.slice(0, 220));
  console.log("capture premise: " + (logs.some((m) => /StreamManager|Floor|Checkpoint/.test(m)) ? "ok — module lines captured (" + logs.length + ")" : "BROKEN — nothing captured"));
  console.log("MEASURED");
})().catch((e) => console.log("probe threw: " + (e && e.stack || e)));
