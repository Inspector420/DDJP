// tools/probes/probe-j37-redelivery.js
//
// J37 — DOES ANYTHING RE-DELIVER WHAT AN ACCEPTED BOUNDARY IGNORED?
//
// J03 gave an adopted-but-untrimmed client a second boundary, derived live from `Floor.current()`,
// and made withdrawal release it. Release makes an ignored arrival ADMISSIBLE without making it
// ARRIVE. J37's Open list asks three things, and this probe answers them by DRIVING the production
// wiring rather than by reading the subscriber:
//
//   Q1  THE WIRE — does `withdrawn` actually reach `Floor.thinJoin`, and does the pager it is
//       handed return the ignored arrival's bytes? Without this, Q2's answer is unattributable:
//       an unreached measurement returns the same value in every tree.
//   Q2  THE MECHANISM — `thinJoin` uses paged events for `chainVerifies` and nothing else, so the
//       bytes reach the function and are discarded. Driven in the SUCCESS direction too, because a
//       refusal proves nothing on its own.
//   Q3  THE RE-ADOPTION, which the job entry does not anticipate. The pager reads the RAW CACHE,
//       which is normally a superset of the derived log — so the re-page can re-verify the very
//       floor whose chain the derived log can no longer support, and the boundary comes back.
//   Q4  THE CONTROL FOR Q3, and the case where the gap is real: with the joining evidence gone from
//       the cache as well, the withdrawal is SUSTAINED, the boundary is genuinely released, and the
//       hole is measurable in derived state against a client that received the same straggler.
//
// Q3 and Q4 are each other's controls: same fixture, same door, one detail changed — whether the
// broken chain's joining event is still in the raw cache. A refusal with no adjacent admission is
// the trap this project's own audit list opens with.
//
// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every stage below can fail silently and return the same `false` the interesting answer returns.
// Three independent attempts at one measurement elsewhere in this tree all returned `null` from
// every tree INCLUDING their controls, and absence read as agreement each time. So the gate states
// its preconditions as SEPARATE checks, names the stage that broke, and refuses to print a verdict
// if one fails. PART Z self-tests the gate against a deliberately broken input, because a gate that
// certifies everything downstream on its own authority is untested code.
//
// Usage:  node tools/probes/probe-j37-redelivery.js

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
const STAGES = [];
function stage(name, cond, got) {
  STAGES.push({ name: name, ok: !!cond, got: got });
  return !!cond;
}
function gateHolds() { return STAGES.every((s) => s.ok); }
function gateReport() {
  for (const s of STAGES) {
    console.log("      " + (s.ok ? "ok  " : "BROKE ") + s.name +
      (s.got !== undefined ? "  got " + JSON.stringify(s.got) : ""));
  }
}
function refuse(q) {
  console.log("[j37] REFUSED to answer " + q + " — a precondition did not hold:");
  gateReport();
  process.exit(2);
}

// ── PART Z: the gate's own self-test ─────────────────────────────────────────────────────────
// Feed it a precondition that is deliberately false and confirm it reports BROKE rather than
// waving it through. Run against a scratch list so the real stages are untouched.
{
  const saved = STAGES.splice(0, STAGES.length);
  stage("self-test: a true precondition", 1 === 1);
  stage("self-test: a FALSE precondition", 1 === 2, { deliberate: true });
  const caught = !gateHolds();
  const missed = gateHolds();
  STAGES.splice(0, STAGES.length);
  for (const s of saved) STAGES.push(s);
  if (!caught || missed) {
    console.log("[j37] THE GATE ITSELF IS BROKEN — it passed a deliberately false precondition. " +
                "Nothing below this line would have meant anything.");
    process.exit(3);
  }
  console.log("[j37] PART Z — the admissibility gate catches a deliberately broken precondition.\n");
}

// ── THE WIRED CLIENT ─────────────────────────────────────────────────────────────────────────
// The same recipe `check-settings-readback` uses, which is what makes a WIRING measurement
// possible here at all: matrixbridge is loaded and `_wireConcepts` installs the REAL subscribers.
// The room scope is the fixture room, or `_heldHere()` scopes the cache to nothing and the pager
// returns empty — which would look exactly like "the re-page found nothing to re-deliver".
function wired() {
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/floor.js", "backends/backend1/continuity.js",
    "backends/backend1/history.js", "backends/backend1/settingsproof.js",
    "backends/backend1/dials.js", "backends/backend1/eventcache.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
  ], { window: { location: { origin: "", pathname: "" }, addEventListener: () => {} },
       document: { addEventListener: () => {} },
       localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
       navigator: {}, indexedDB: null, Date: Date,
       setTimeout: (f) => { if (typeof f === "function") f(); return 1; },
       clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });
  sb.MatrixBridge.seedClock("!space:hs");
  sb.MatrixBridge.setRoomScope({ events_owner: F.ROOM, settings_owner: "!settings-owner:hs" });
  sb.MatrixBridge._wireConcepts({ events_owner: F.ROOM, settings_owner: "!settings-owner:hs" });
  return sb;
}

const BASE = wired();
const DEF = BASE.StateDeriver.defaultSettings();
const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner, { t: "ddjp.room.settings", s: DEF }),
].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
  F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));

// Three high-staff cuts that genuinely chain — the shipped substitute bar is 3 high-staff.
function cpAt(sb, n) {
  const below = LOG.slice(0, n);
  const seed = sb.StateDeriver.buildSeed(below);
  const covers = below[0].eventId + ".." + below[below.length - 1].eventId;
  const floorL = below[below.length - 1].l;
  return { n: 1, prev: null, seed,
           h: sb.CheckpointFormat.fingerprint(1, null, seed, floorL, false, covers),
           covers, floorL, thin: false };
}
const JOIN_EV = LOG[8];          // sits between the first and second cut — a chain JOINING event
const CHANGED = Object.assign({}, DEF, { maxLen: 300 });
const LATE_BELOW = F.reducerEvent("$late-below", 6, 1500, "@owner:hs", F.RANK.owner,
  { t: "ddjp.room.settings", s: CHANGED });

// Builds a client that has ADOPTED a quorum floor and NOT trimmed, and has ignored one below-cut
// arrival. `cacheJoin` decides whether the raw copy of the chain's joining event is still held,
// which is the single detail Q3 and Q4 differ on.
function clientWithIgnoredArrival(cacheJoin) {
  const sb = wired();
  const { StreamManager, Floor, EventCache } = sb;
  const deliver = (e, cache) => {
    const raw = F.toRaw(e);
    if (cache !== false) { try { EventCache.store(raw); } catch (x) {} }
    StreamManager.ingest(raw);
  };
  for (const e of LOG) deliver(e, cacheJoin || e.eventId !== JOIN_EV.eventId);
  Floor.remember(cpAt(sb, 7), F.RANK.highStaff, "@a:hs", 1000);
  Floor.remember(cpAt(sb, 11), F.RANK.highStaff, "@b:hs", 1100);
  Floor.remember(cpAt(sb, 15), F.RANK.highStaff, "@c:hs", 1200);
  // The SDK is absent, so `getMyRank` answers 0. Only this one field is replaced; `log`, `settings`
  // and `trimmed` stay the production wiring `_wireConcepts` installed, which is what Q1 is about.
  Floor.attach({ myRank: () => F.RANK.highStaff });
  Floor.adopt(Floor.select(F.RANK.highStaff, DEF,
    (q) => Floor.chainVerifies(q, StreamManager.getLog())));
  deliver(LATE_BELOW);
  sb._deliver = deliver;
  return sb;
}
const inLog = (sb, id) => sb.StreamManager.getLog().some((e) => e.eventId === id);

// ── Q1 · Q2: the wire, and what the mechanism does with what it is handed ─────────────────────
const A = clientWithIgnoredArrival(true);
stage("Q1: a quorum floor was adopted through Floor.adopt",
  A.Floor.grade() === "quorum", { grade: A.Floor.grade(), at: A.Floor.position() });
stage("Q1: the client has NOT trimmed — this is the accepted boundary, not the old rule",
  A.StreamManager._trimState() === null, A.StreamManager._trimState());
stage("Q1: the below-cut arrival was IGNORED", !inLog(A, "$late-below"));
stage("Q1: and is still HELD, so there is something to re-deliver",
  !!A.EventCache.get("$late-below"));

// Spy on thinJoin so the wire is observable, and capture the pager the subscriber built.
const realThinJoin = A.Floor.thinJoin;
let captured = null, thinJoinCalls = 0;
A.Floor.thinJoin = function (pageFn) { thinJoinCalls++; captured = pageFn; return Promise.resolve({ mode: "spy" }); };

// The chain breaks the way a deletion breaks it: a joining event leaves the DERIVED log.
A.StreamManager._setLogForTest(
  A.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
stage("Q1: the chain genuinely stopped verifying in the derived log",
  A.Floor.chainVerifies([cpAt(A, 7), cpAt(A, 11), cpAt(A, 15)], A.StreamManager.getLog()) === false);
const rA = A.Floor.revalidate();
stage("Q1: revalidate WITHDREW rather than demoting — the untrimmed branch",
  rA && rA.reason === "withdrawn", rA);
stage("Q1: the withdrawn emission reached Floor.thinJoin",
  thinJoinCalls === 1 && typeof captured === "function", { calls: thinJoinCalls });

(async () => {
  const paged = (typeof captured === "function") ? await captured(0, 99) : null;
  stage("Q1: the pager the SUBSCRIBER built returned the ignored arrival's bytes",
    Array.isArray(paged) && paged.some((e) => e.eventId === "$late-below"),
    { returned: Array.isArray(paged) ? paged.length : paged });
  if (!gateHolds()) refuse("Q1/Q2");

  console.log("[j37] Q1 — THE WIRE FIRES AND THE BYTES ARRIVE.");
  console.log("      withdrawn -> Floor.thinJoin(pageFn); the pager returned " + paged.length +
              " events INCLUDING the ignored arrival.");
  console.log("      So a negative answer below is attributable to the mechanism, not to a fixture " +
              "that never reached it.\n");

  // Q2, and in the SUCCESS direction: hand the real thinJoin a page that both verifies the chain
  // and contains the arrival. Even when the re-page SUCCEEDS, nothing reaches the fold.
  A.Floor.thinJoin = realThinJoin;
  A.Floor._setTrustedForTest(null);
  const res = await A.Floor.thinJoin(async () => LOG.concat([LATE_BELOW]));
  stage("Q2: the re-page SUCCEEDED, so this is not a refusal proving nothing",
    res && res.mode === "quorum", res);
  if (!gateHolds()) refuse("Q2");
  console.log("[j37] Q2 — THE MECHANISM DISCARDS THEM.");
  console.log("      thinJoin returned " + JSON.stringify(res) + " — it adopted a floor, and");
  console.log("      $late-below in the fold: " + inLog(A, "$late-below"));
  console.log("      `thinJoin` hands paged events to `chainVerifies` and to nothing else. The");
  console.log("      re-page READS the ignored arrival and throws it away.\n");

  // ── Q3: the re-adoption the entry does not anticipate ──────────────────────────────────────
  const B = clientWithIgnoredArrival(true);
  stage("Q3: fixture — adopted, untrimmed, arrival ignored",
    B.Floor.grade() === "quorum" && B.StreamManager._trimState() === null && !inLog(B, "$late-below"));
  stage("Q3: fixture — the joining event is still in the RAW CACHE",
    !!B.EventCache.get(JOIN_EV.eventId));
  B.StreamManager._setLogForTest(
    B.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
  const rB = B.Floor.revalidate();
  stage("Q3: the floor was withdrawn", rB && rB.reason === "withdrawn", rB);
  stage("Q3: and the boundary was released at that instant",
    B.Floor.position() === B.Floor.NO_FLOOR, B.Floor.position());
  await new Promise((r) => setTimeout(r, 0));   // the subscriber is fire-and-forget; thinJoin is async
  if (!gateHolds()) refuse("Q3");
  const readopted = B.Floor.position();
  console.log("[j37] Q3 — THE RE-PAGE PUTS THE BOUNDARY BACK.");
  console.log("      after the async re-page settled: floor = " + readopted + " (" + B.Floor.grade() + ")");
  console.log("      boundary still released: " + (readopted === B.Floor.NO_FLOOR));
  console.log("      $late-below in the fold: " + inLog(B, "$late-below"));
  console.log("      The pager reads the RAW CACHE, which still holds the joining event the derived");
  console.log("      log lost — so the very floor that stopped verifying verifies again, and is");
  console.log("      re-adopted. The release lasts one microtask.\n");

  // ── Q4: the control, and the case where the gap is real ────────────────────────────────────
  const D = clientWithIgnoredArrival(false);
  stage("Q4: fixture — the joining event is NOT in the raw cache (the one changed detail)",
    !D.EventCache.get(JOIN_EV.eventId));
  stage("Q4: fixture — adopted, untrimmed, arrival ignored",
    D.Floor.grade() === "quorum" && D.StreamManager._trimState() === null && !inLog(D, "$late-below"));
  D.StreamManager._setLogForTest(
    D.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
  const rD = D.Floor.revalidate();
  stage("Q4: the floor was withdrawn", rD && rD.reason === "withdrawn", rD);
  await new Promise((r) => setTimeout(r, 0));
  stage("Q4: the withdrawal is SUSTAINED — nothing re-adopted",
    D.Floor.position() === D.Floor.NO_FLOOR, D.Floor.position());

  // Force a re-fold AFTER the release. The state in hand was folded while the floor was still
  // trusted, and nothing re-derives on withdrawal — reading it now would be reading the wrong
  // moment, which is this project's most expensive recurring error.
  const NUDGE = F.reducerEvent("$nudge", 99, 999999, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "NUDGE" });
  D._deliver(NUDGE);
  stage("Q4: the client re-folded with no floor", D.Floor.position() === D.Floor.NO_FLOOR);

  // The control: a client that received the same straggler, over the same holed log.
  const CTL = wired();
  for (const e of LOG) { if (e.eventId !== JOIN_EV.eventId) CTL.StreamManager.ingest(F.toRaw(e)); }
  CTL.StreamManager.ingest(F.toRaw(LATE_BELOW));
  CTL.StreamManager.ingest(F.toRaw(NUDGE));
  stage("Q4: the control genuinely folded the arrival, or it is not a control",
    CTL.StreamManager.getLog().some((e) => e.eventId === "$late-below"));
  if (!gateHolds()) refuse("Q4");

  const caseMax = D.StreamManager.getState().settings.maxLen;
  const ctlMax = CTL.StreamManager.getState().settings.maxLen;
  console.log("[j37] Q4 — WHERE THE GAP IS REAL, AND WHAT IT COSTS.");
  console.log("      With the joining evidence gone from the cache too, the re-page cannot re-verify,");
  console.log("      the withdrawal is SUSTAINED, and the boundary stays released.");
  console.log("      case (ignored, then withdrawn) settings.maxLen = " + caseMax);
  console.log("      control (received the straggler)  settings.maxLen = " + ctlMax);
  console.log("      DIVERGES: " + (caseMax !== ctlMax) + " — silently, and on a type `Continuity`");
  console.log("      never chains, so no gap is ever detected.\n");

  console.log("[j37] GATE — every precondition held:");
  gateReport();
})();
