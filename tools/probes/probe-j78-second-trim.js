// tools/probes/probe-j78-second-trim.js
// SUBJECT: J78 item 3, STUDY ONLY — a decentralized device forgets once per session (the bot's live log on `?v=501`: n=2 trimmed
// 61, then n=3 sealed and ingested, no trim, no verdict). MEASUREMENT through the real path: one LIVE device holding the room
// from the start (as the bot did) seals with the real `Checkpoint.seal()`, adopts its own seal (as seal() does), and trims on
// adoption (as the bridge's Floor.onChange handler does). Order: events → n=1 → trim; live events → n=2 → trim; → n=3 → trim.
// Before each trim it prints every input to `trimToFloor`'s two refusals (line 911: the grade; line 918: the licence).
//   node tools/probes/probe-j78-second-trim.js
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js"];
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
const logs = [];
const L = { info: (m) => logs.push(String(m)), warn: (m) => logs.push("WARN " + m), debug: (m) => logs.push("dbg " + m), error: (m) => logs.push("ERR " + m) };
const sb = loadInContext(FILES, { Logger: L }); if (sb.Logger) { const _cap = (p) => (m) => logs.push(p + String(m)); sb.Logger.info = _cap(""); sb.Logger.warn = _cap("WARN "); sb.Logger.debug = _cap("dbg "); sb.Logger.error = _cap("ERR "); }   // ddjp_555: core/logger.js replaces an injected Logger
const SM = sb.StreamManager, Fl = sb.Floor, CP = sb.Checkpoint;
Fl.reset(); SM.reset(); try { CP.reset(); } catch (e) {}
try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); if (sb.Session.sawEvent) sb.Session.sawEvent(); } catch (e) {}
if (!sb.Session.mayAuthor() && typeof sb.Session._setPhaseForTest === "function") sb.Session._setPhaseForTest(sb.Session.LIVE);   // live, as the bot was
console.log("session phase: " + sb.Session.phase());
const S0 = Object.assign(sb.StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })];
let prev = null;
for (let l = 2; l <= 100; l++) { const id = "$e" + l;
  if (l <= 4) E.push(F.reducerEvent(id, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
  else if (l % 5 === 0) { E.push(F.reducerEvent(id, l, T0 + l * 4 * MIN, "@d2:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
  else E.push(F.reducerEvent(id, l, T0 + l * MIN, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); }
let clock = T0;
CP.attach({ now: () => clock, log: () => SM.getLog(), held: () => [], settings: () => SM.getState().settings, myRank: () => BOT, myUserId: () => "@bot:hs",
  myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => { try { return SM._trimState() !== null; } catch (e) { return false; } },
  floorTs: () => { try { return Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return Fl.position(); } catch (e) { return null; } },
  send: async () => {} });
const trims = [];
Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { trims.push(SM.trimToFloor()); } catch (e) { trims.push("threw " + e.message); } } });
const inputs = () => { const t = Fl.current(), v = SM.seedValidation(), sig = (() => { try { return Fl.sigOf(t); } catch (e) { return "?"; } })();
  return "grade " + (t && t.grade) + " (earnsForget " + (t ? sb.TrustPolicy.earnsForget(t.grade) : "?") + ") | verdict " + v.status + (v.reason ? " (" + v.reason + ")" : "") +
    " | verdict sig " + (v.sig === sig ? "= floor's" : (v.sig ? "≠ floor's" : "none")) + " | licence " + SM.seedLicensesForget() +
    " | trimmed-below " + (() => { try { const s = SM._trimState(); return s ? JSON.stringify(s) : "null"; } catch (e) { return "?"; } })(); };
(async () => {
  for (const [upto, n] of [[17, 1], [66, 2], [89, 3]]) {
    for (const e of E.filter((x) => x.l <= upto && !SM.getLog().some((h) => h.eventId === x.eventId) && x.l > (n === 1 ? 0 : (n === 2 ? 17 : 66)))) SM.ingest(F.toRaw(e));
    clock = T0 + (upto + 1) * MIN * 4;
    const before = trims.length;
    const r = await CP.seal();
    const t = trims.length > before ? trims[trims.length - 1] : "(no trim call)";
    console.log("n=" + n + " seal " + (r.ok ? "ok floorL=" + r.checkpoint.floorL : "REFUSED " + r.reason) + " → trim on adoption: " + t + " | held " + SM.getLog().length);
    console.log("      after: " + inputs());
    // WHAT-IF (no shipped change): would the move-on check bot rooms use — reproduces(f), the held events folded from the
    // previous trusted floor's seed against this floor's seed — accept this floor?
    try { const rp = SM.reproduces ? SM.reproduces(Fl.current()) : null; console.log("      the move-on check on this floor: " + (rp ? JSON.stringify(rp) : "not exported")); } catch (e) { console.log("      the move-on check threw: " + e.message); }
    const again = SM.trimToFloor();
    console.log("      an explicit trim now: " + again + " | " + inputs());
  }
  console.log("--- lines:");
  for (const l of logs.filter((x) => /trimmed to floor|diverges|not licensed|does-not-reach|origin|REFUSING/i.test(x)).slice(0, 8)) console.log("  " + l.slice(0, 200));
  console.log("capture premise: " + (logs.some((m) => /StreamManager|Floor|Checkpoint/.test(m)) ? "ok — module lines captured (" + logs.length + ")" : "BROKEN — nothing captured"));
  console.log("MEASURED");
})().catch((e) => console.log("probe threw: " + (e && e.stack || e)));
