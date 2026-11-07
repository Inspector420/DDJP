// tests/check-reset-proof.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: A ROOM ENTRY CLEARS WHAT THIS DEVICE PROVED, SO IT PROVES AFRESH (`ddjp_566`; the owner's ruling on the `ddjp_565`
//   finding: it is a defect). `trimToFloor` records the fingerprint of the floor it trimmed under (`_heldBaseH`) as proved by
//   its licence, and two readers trust that memory: `canProve` answers `trimmed-under` from it, and `_floorProves` — the
//   forgetting licence — passes on it before asking for the boundary or a rebuild. `reset()` cleared the base the memory belongs
//   to (`_heldBase`) and not the memory, so after re-entering the same room in one page session BOTH readers answered from a
//   proof made in the previous visit. Measured on `ddjp_565`: re-entered, holding nothing below the floor and not its boundary,
//   the device was told it could stand on the old floor and TRIMMED under it with no fresh proof.
//   PART A — after a room entry, `canProve` does not claim the old floor from the old memory.
//   PART B — re-entered holding only events above the floor, the floor does not license forgetting and nothing is trimmed.
//   PART C — the device proves afresh: holding the room again it proves the floor by rebuild, and its own new trim restores
//            `trimmed-under` — a fresh memory, not a forbidden one.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0, _finished = false;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[reset-proof] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
process.on("exit", () => { if (!_finished) { console.log("[reset-proof] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js"];
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return i < 0 ? null : MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
ok(ARRIVED, "PREMISE — the bridge's `_onCheckpointArrived` could not be taken from the shipped file");
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
function live(sb) { try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); } catch (e) {}
  if (!sb.Session.mayAuthor() && sb.Session._setPhaseForTest) sb.Session._setPhaseForTest(sb.Session.LIVE); }
function device(myRank) {
  const sb = loadInContext(FILES, { Logger: quiet }); sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {} live(sb);
  const SM = sb.StreamManager, Fl = sb.Floor;
  Fl.attach({ myRank: () => myRank, settings: () => SM.getState().settings, log: () => (SM.proofLog ? SM.proofLog() : SM.getLog()),
    trimmed: () => SM._trimState() !== null, canProve: (f) => SM.canProve(f) });
  Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { SM.trimToFloor(); } catch (e) {} } });   // the bridge's trim subscriber
  const arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", ARRIVED + "\nreturn _onCheckpointArrived;")(
    Fl, sb.TrustPolicy, sb.Continuity, SM, quiet, () => SM.getState().settings);
  return { sb, SM, Fl, arrive };
}
function roomEvents(n) {
  const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(),
    { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })];
  let prev = null, ts = T0;
  for (let l = 2; l <= n; l++) {
    const id = "$e" + String(l).padStart(5, "0");
    if (l <= 4 || l % 20 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
    else if (l % 5 === 0) { ts += 4 * MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
    else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); }
  }
  return E;
}
async function sealsAt(E, cuts) {
  const S = device(BOT), out = []; let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings, myRank: () => BOT,
    myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { out.push(JSON.parse(JSON.stringify(cp))); } });
  let lo = 1;
  for (const hi of cuts) { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) S.SM.ingest(F.toRaw(e)); lo = hi + 1; clock += 4 * 60 * MIN; await S.sb.Checkpoint.seal(); }
  return out;
}
const arriveCp = (d, cp) => d.arrive({ content: cp, senderRank: BOT, sender: "@bot:hs", ts: T0 + cp.floorL * MIN });
const feed = (d, E, lo, hi) => { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) d.SM.ingest(F.toRaw(e)); };
// ROOM ENTRY, as `features/room.js` `_initModules` pairs it: `StreamManager.reset()`, then the bridge's `resetCheckpoints` -> `Floor.reset()`.
const enter = (d) => { d.SM.reset(); d.Fl.reset(); };

(async () => {
  const E = roomEvents(80); const cps = await sealsAt(E, [17, 66]); const X = cps[1];
  const first = () => { const d = device(BOT); feed(d, E, 1, 20); arriveCp(d, cps[0]); feed(d, E, 21, 70); arriveCp(d, cps[1]); return d; };
  // ── PREMISE: the memory exists before the room is left ───────────────────────────────────────────────────────────────
  { const d = first();
    ok(d.SM._trimState() === 66 && d.SM.canProve(X).reason === "trimmed-under", "PREMISE — the first visit trimmed under the floor at 66 and remembers " +
      "it proved it (or nothing below is about that memory)", { trim: d.SM._trimState(), canProve: d.SM.canProve(X) });
  }
  // ── PART A — after a room entry the old memory answers nothing ───────────────────────────────────────────────────────
  { const d = first(); enter(d);
    const r = d.SM.canProve(X);
    ok(d.SM._trimState() === null && d.SM.getLog().length === 0, "A PREMISE — the room entry cleared the log and the trim boundary", { trim: d.SM._trimState(), held: d.SM.getLog().length });
    ok(r.reason !== "trimmed-under", "A: after a room entry `canProve` still claims the floor this device trimmed under in the PREVIOUS visit — a proof " +
      "from memory that predates the reset; the device must prove it afresh", r);
    ok(r.ok !== true, "A: holding nothing, the device must not be told it can prove the floor at all", r);
  }
  // ── PART B — re-entered holding only events above the floor: no licence, no trim ─────────────────────────────────────
  { const d = first(); enter(d);
    arriveCp(d, X); feed(d, E, 67, 70);                                     // the same room again, the floor before anything below it
    const bid = String(X.covers).split("..")[1];
    ok(d.Fl.current() && d.Fl.current().floorL === 66 && !d.SM.getLog().some((e) => e.eventId === bid),
      "B PREMISE — re-entered on the floor at 66, its boundary NOT held", { floor: d.Fl.current() && d.Fl.current().floorL });
    ok(d.SM.forgettingLicensed() === false, "B: re-entered holding neither the floor's boundary nor anything that rebuilds it, the floor still " +
      "LICENSES FORGETTING — the licence read the previous visit's proof (`_floorProves` trusts the same memory as `canProve`)", d.SM.forgettingLicensed());
    ok(d.SM._trimState() === null, "B: and the device trimmed under it with no fresh proof", { trim: d.SM._trimState() });
  }
  // ── PART C — it proves afresh ────────────────────────────────────────────────────────────────────────────────────────
  { const d = first(); enter(d);
    feed(d, E, 1, 20);
    const r1 = d.SM.canProve(cps[0]);                                       // asked BEFORE its arrival trims, so no memory of this visit answers
    arriveCp(d, cps[0]);
    ok(r1.ok === true && !r1.reason, "C: holding the room from its start again, the device proves the first floor by REBUILD (no memory token)", r1);
    feed(d, E, 21, 70); arriveCp(d, X);
    ok(d.SM._trimState() === 66 && d.SM.canProve(X).reason === "trimmed-under", "C: and after its own licensed trim in THIS visit it remembers that " +
      "proof — clearing the memory on entry must not stop a fresh one being made", { trim: d.SM._trimState(), canProve: d.SM.canProve(X) });
  }
})().then(done, (e) => { failed++; console.log("[reset-proof] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[reset-proof] " + failed + " failure(s)"); process.exit(1); }
  console.log("[reset-proof] PASS — a room entry clears what this device proved: re-entering the same room in one page session, `canProve` no " +
    "longer claims the floor it trimmed under last visit, and that floor no longer licenses forgetting without its boundary or a rebuild; " +
    "the device proves afresh — by rebuild when it holds the room again, and by its own new trim (" + asserts + " assertions)");
  process.exit(0);
}
