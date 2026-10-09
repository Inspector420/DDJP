// tests/check-trim-every-floor.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: STEP A — A DECENTRALIZED DEVICE FORGETS AT EVERY FLOOR, NOT ONLY THE FIRST (owner's ruling at the `ddjp_544` audit).
//   Live, the bot's device trimmed once and never again: after its first trim no verdict was ever recorded for a new floor
//   (`_deriveBest`'s trimmed branch records one only for origin rooms), so `seedLicensesForget`'s fingerprint check refused
//   every later trim. Now a trimmed device's NEW floor is judged by the bot rooms' move-on check, `reproduces(f)`, tied to
//   its fingerprint. Driven with real seals (`Checkpoint.seal` on a live sealer device), delivered through the bridge's own
//   `_onCheckpointArrived`, and a trim on adoption as the bridge does.
//   PART A — n=1, n=2, n=3 each licensed and trimmed.     PART B — a dishonest floor: refused, nothing trimmed or retired.
//   PART C — a missing boundary never passes.             PART D — a device that never trimmed keeps the genesis check.
//   PART E — bot rooms unchanged.                         PART F — regression: a quorum floor fails — rollback, stale and the
//   history heal behave exactly as before.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[trim-every-floor] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js", "backends/backend1/vouch.js", "backends/backend1/eventcache.js"];
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const SET = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(),
  { checkpointEvery: 5, checkpointCooldownMs: 0 });
const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: SET })];
{ let prev = null;
  for (let l = 2; l <= 100; l++) { const id = "$e" + l;
    if (l <= 4) E.push(F.reducerEvent(id, l, T0 + l * MIN, "@d" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
    else if (l % 5 === 0) { E.push(F.reducerEvent(id, l, T0 + l * 4 * MIN, "@d2:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
    else E.push(F.reducerEvent(id, l, T0 + l * MIN, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); } }
function device(opts) {
  const logs = (opts && opts.logs) || null;
  const L = logs ? { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), debug() {}, error() {} } : quiet;
  const sb = loadInContext(FILES, { Logger: L });
  // core/logger.js defines the sandbox's own Logger, which shadows an injected one: capture on THAT one (step 5b's log limit).
  if (logs && sb.Logger) { for (const lv of ["info", "warn", "debug", "error"]) sb.Logger[lv] = (m) => logs.push(String(m)); }   // every level (ddjp_555: the trim line is debug)
  sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {}
  try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); if (sb.Session.sawEvent) sb.Session.sawEvent(); } catch (e) {}
  if (!sb.Session.mayAuthor() && typeof sb.Session._setPhaseForTest === "function") sb.Session._setPhaseForTest(sb.Session.LIVE);
  const d = { sb, SM: sb.StreamManager, Fl: sb.Floor, trims: [] };
  if (!opts || opts.trimOnAdopt !== false) d.Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { d.trims.push(d.SM.trimToFloor()); } catch (e) { d.trims.push("threw"); } } });
  d.arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", ARRIVED + "\nreturn _onCheckpointArrived;")(
    d.Fl, sb.TrustPolicy, sb.Continuity, d.SM, quiet, () => d.SM.getState().settings);
  d.feed = (lo, hi) => { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) d.SM.ingest(F.toRaw(e)); };
  return d;
}
// The real seals: a live sealer device that holds the room (as the bot's did).
async function seals() {
  const S = device({ trimOnAdopt: false }), out = []; let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings, myRank: () => BOT,
    myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { out.push(JSON.parse(JSON.stringify(cp))); } });
  for (const [hi, lo] of [[17, 1], [66, 18], [89, 67]]) { S.feed(lo, hi); clock = T0 + (hi + 1) * 4 * MIN; await S.sb.Checkpoint.seal(); }
  return { cps: out, CF: S.sb.CheckpointFormat };
}
const deliver = (d, cp, rank) => d.arrive({ content: cp, senderRank: typeof rank === "number" ? rank : BOT, sender: "@bot:hs", ts: T0 + cp.floorL * MIN });
const refinger = (CF, cp, change) => { const c = JSON.parse(JSON.stringify(cp)); change(c); c.h = CF.fingerprint(c.n, c.prev, c.seed, c.floorL, c.thin, c.covers); return c; };
(async () => {
  const { cps, CF } = await seals();
  ok(cps.length === 3 && cps.map((c) => c.floorL).join() === "17,66,89", "PREMISE — the real sealer produced n=1, n=2, n=3 at 17, 66, 89", cps.map((c) => c.floorL));
  // ── A ──
  { const logs = []; const d = device({ logs: logs }); d.feed(1, 17); deliver(d, cps[0]);
    const t1 = d.trims.slice(-1)[0], v1 = d.SM.seedValidation(); d.feed(18, 66); deliver(d, cps[1]);
    const v2 = d.SM.seedValidation(), t2 = d.trims.slice(-1)[0]; d.feed(67, 89); deliver(d, cps[2]);
    const v3 = d.SM.seedValidation(), t3 = d.trims.slice(-1)[0];
    ok(t1 > 0 && t2 > 0 && t3 > 0, "A: n=1, n=2 and n=3 are each licensed and trimmed — the device forgets at every floor", [t1, t2, t3]);
    // THE CAPTURE PREMISE (`ddjp_555`): core/logger.js replaces an injected Logger, so the rows below would pass vacuously if
    // capture were broken — this proves it is not: a line the STREAM MANAGER itself writes on a trim is in the capture.
    ok(logs.some((m) => /derived log trimmed to floor/.test(m)), "A PREMISE — log capture works: the stream manager's own trim line is captured", logs.length);
    // CHANGED AT STEP 5b (`ddjp_554`): forgetting follows acceptance of a floor that proves itself; Step A records no verdict, it logs —
    // and at most ONCE PER FLOOR (the log limit), however many folds the floor sees.
    ok(v2.reason !== "reproduces-from-held-base" && v3.reason !== "reproduces-from-held-base", "A: Step A records no verdict any more — forgetting follows the floor's own proof", { v2, v3 });
    for (const n of [2, 3]) { const said = logs.filter((m) => m.indexOf("move-on check — floor n=" + n + " ") >= 0).length;
      ok(said <= 1, "A: the log limit — Step A's line for floor n=" + n + " is said at most once", said); }
    ok(v1.status === "validated" && v1.reason === null, "A: the floor it first trimmed under keeps its genesis verdict — real evidence is never overwritten", v1); }
  // ── B ── a dishonest n=2 (a real seal, its seed altered, its fingerprint recomputed)
  { const d = device(); d.feed(1, 17); deliver(d, cps[0]); d.feed(18, 66);
    const held = d.SM.getLog().length;
    // DISHONEST: the seed claims settings the events never set (a field the move-on check compares).
    const bad = refinger(CF, cps[1], (c) => { c.seed.settings = Object.assign({}, c.seed.settings, { repeatCooldownMs: 1234567 }); });
    deliver(d, bad);
    const v = d.SM.seedValidation(), plan = d.sb.EventCache.dryRunEviction ? d.sb.EventCache.dryRunEviction() : null;
    // CHANGED AT STEP 5b: the dishonest owner-tier floor is FOLLOWED, as the consensus decides — but it cannot prove itself, so
    // nothing is forgotten under it (the rows below).
    ok(d.Fl.current().h === bad.h && d.SM.forgettingLicensed() === false, "B: a dishonest owner-tier floor is followed, but it does not prove itself — no licence", { floor: d.Fl.current().h === bad.h, licensed: d.SM.forgettingLicensed() });
    ok(d.trims.slice(-1)[0] === 0 && d.SM.getLog().length === held, "B: and nothing is trimmed", { trim: d.trims.slice(-1)[0], held: d.SM.getLog().length, was: held });
    ok(plan && plan.floorL === null, "B: and the raw cache retires nothing under it — its cut is withheld", plan && { floorL: plan.floorL, withheld: plan.floorWithheld, reason: plan.floorReason }); }
  // ── C ── a missing boundary never passes
  { const d = device(); d.feed(1, 17); deliver(d, cps[0]); d.feed(18, 66);
    const ghost = refinger(CF, cps[1], (c) => { c.covers = c.covers.split("..")[0] + "..$ghost"; });
    deliver(d, ghost);
    const v = d.SM.seedValidation();
    // CHANGED AT STEP 5b: the boundary event is a gate condition of its own — not held, no licence, nothing trimmed.
    ok(d.trims.slice(-1)[0] === 0 && d.SM.forgettingLicensed() === false,
      "C: a floor whose boundary this device does not hold licenses nothing — never a pass, nothing trimmed", { v, trim: d.trims.slice(-1)[0] }); }
  // ── D ── a device that never trimmed keeps the genesis check
  // A device holding the room from the start, wired as the bridge is (the refold happens in the trim, line 910).
  { const d = device(); d.feed(1, 70); deliver(d, cps[1]);
    const v = d.SM.seedValidation();
    ok(v.status === "validated" && v.reason === null, "D: a device that never trimmed validates by the genesis comparison, as before", v);
    const d2 = device(); d2.feed(1, 70);
    deliver(d2, refinger(CF, cps[1], (c) => { c.seed.settings = Object.assign({}, c.seed.settings, { repeatCooldownMs: 1234567 }); }));
    const v2 = d2.SM.seedValidation();
    ok(v2.status === "mismatched" && v2.reason === "diverges-from-genesis", "D: and a dishonest floor there is still diverges-from-genesis", v2); }
  // ── E ── bot rooms unchanged: a room opened from a save point never takes the new path
  { const sb = loadInContext(FILES.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), { Logger: quiet });
    const D = sb.B2StreamManager, B1 = sb.B1StreamManager; D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
    let l = 0; const rel = (body, actor, rank) => { l++; return { event_id: "$b" + l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
      content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor: actor, rank: rank, src: "$i" + l, at: null })) } }; };
    const Pl = sb.Ranks.levelOf("player"), Ow = sb.Ranks.levelOf("owner");
    [rel({ t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }, "@o:hs", Ow), rel({ t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d1:hs", Pl), rel({ t: "ddjp.dj.play", p: null }, "@bot:hs", Ow)].forEach((r) => D.ingest(r));
    const log = B1.getLog(), last = log[log.length - 1];
    const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
    l++; D.ingest({ event_id: "$cp", type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN, content: { body: JSON.stringify(Object.assign({}, c, { l: l })) } });
    D.openFromSavePoint();
    for (let k = 0; k < 4; k++) D.ingest(rel({ t: "ddjp.dj.vote", p: B1.getState().nowPlaying && B1.getState().nowPlaying.pi, dv: 1 }, "@v" + k + ":hs", Pl));
    const SRC = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/streammanager.js"), "utf8");
    ok(B1.seedValidation().reason !== "reproduces-from-held-base" && /else if \(_trimmedBelow !== null && !_adopted\) _recordMoveOnVerdict\(f\);/.test(SRC),
      "E: a bot room (an adopted save point) never takes the new path — its licence is the door's, unchanged", B1.seedValidation()); }
  // ── F ── regression: a quorum floor fails; rollback, stale and the history heal are exactly as before
  { const settings = () => SET;
    // trimmed device: trims under n=1, then a QUORUM floor n=2 that later stops being selected → stale, no more forgetting
    const d = device(); d.feed(1, 17); deliver(d, cps[0]); d.feed(18, 66);
    d.Fl.attach({ myRank: () => BOT, settings: settings, log: () => d.SM.getLog(), trimmed: () => true });
    d.Fl.adopt({ floor: Object.assign({ u: "@hs1:hs" }, cps[1]), tier: 1 });
    const g0 = d.Fl.grade(); const r = d.Fl.revalidate();
    ok(g0 === "quorum" && r.moved === true && d.Fl.grade() === "stale" && d.sb.TrustPolicy.earnsForget(d.Fl.grade()) === false,
      "F: a trimmed device whose quorum floor fails goes stale and stops forgetting — as before", { g0, r, now: d.Fl.grade() });
    ok(d.SM.trimToFloor() === 0, "F: and trims nothing under the stale floor");
    // a device holding everything: the same failure retreats to the older floor (rollback)
    const h = device({ trimOnAdopt: false }); h.feed(1, 66); deliver(h, cps[0]);
    h.Fl.attach({ myRank: () => BOT, settings: settings, log: () => h.SM.getLog(), trimmed: () => false });
    h.Fl.adopt({ floor: Object.assign({ u: "@hs1:hs" }, cps[1]), tier: 1 });
    const r2 = h.Fl.revalidate();
    ok(r2.moved === true && /retreated|withdrawn/.test(r2.reason) && (!h.Fl.current() || h.Fl.current().floorL === 17),
      "F: a device holding the data rolls back (retreats to the older floor) and continues — as before", { r2, now: h.Fl.current() && h.Fl.current().floorL });
    // the history heal: rows settled under the replaced floor, above the cut, are dropped to be re-read
    const H = h.sb.History; H.reset();
    H.restore({ v: 2, rows: [{ pi: "$a", l: 10, floorSig: "old" }, { pi: "$b", l: 40, floorSig: "old" }, { pi: "$c", l: 45, floorSig: "new" }], ranges: [[1, 50]], adds: {} });
    const rc = H.reconcileFloor("new", 17);
    ok(rc.dropped === 1, "F: the history heal drops only the row above the cut settled under the replaced floor — as before", rc); }
  // G — step 5b's gate conditions where each one alone decides (`ddjp_554`).
  // G1: a floor that PROVES itself but whose grade does not allow forgetting ("stale") is never forgotten under.
  { const d = device({ trimOnAdopt: false }); d.feed(1, 70); deliver(d, cps[0]); d.SM.trimToFloor();
    const held = d.SM.getLog().length;
    d.Fl._setTrustedForTest(Object.assign({}, cps[1], { grade: "stale" }));
    ok(d.sb.Floor.proves(cps[1], d.SM.proofLog(), { byPosition: true }).ok === true, "G1 PREMISE — the honest floor proves itself");
    ok(d.SM.trimToFloor() === 0 && d.SM.getLog().length === held, "G1: a floor whose grade does not allow forgetting is never forgotten under, even proved", { held, now: d.SM.getLog().length }); }
  // G2: THE LOG LIMIT — a followed floor that is never trimmed under sees a fold per event; Step A says its line once.
  { const logs = []; const d = device({ logs: logs }); d.feed(1, 17); deliver(d, cps[0]); d.feed(18, 66);
    const bad = refinger(CF, cps[1], (c) => { c.seed.settings = Object.assign({}, c.seed.settings, { repeatCooldownMs: 1234567 }); });
    deliver(d, bad); d.feed(67, 80);
    ok(logs.some((m) => /derived log trimmed to floor/.test(m)), "G2 PREMISE — log capture works here too (the n=1 trim line is captured)", logs.length);
    const said = logs.filter((m) => m.indexOf("move-on check — floor n=2 ") >= 0).length;
    ok(said === 1, "G2: the log limit — over 14 more folds against the same floor, Step A's line is said exactly once", said); }
  if (failed) { console.log("[trim-every-floor] " + failed + " failure(s)"); process.exit(1); }
  console.log("[trim-every-floor] PASS — a trimmed device forgets at every floor by the move-on check; dishonest floors and missing boundaries never pass; the genesis check, bot rooms, rollback, stale and the history heal are unchanged (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[trim-every-floor] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
