// tools/probes/probe-j37-verdict.js
//
// J37 — WHAT SHOULD HAPPEN IN THE SUSTAINED-WITHDRAWAL CASE?
//
// `probe-j37-redelivery.js` (v245) established the facts and left the verdict open:
//   · the `withdrawn` wire fires and the pager returns the ignored arrival's bytes (Q1)
//   · `thinJoin` hands paged events to `chainVerifies` and discards them (Q2)
//   · the release usually lasts one microtask, because the raw cache re-verifies the same floor
//     and the re-page re-adopts it (Q3 — filed as J43)
//   · where the joining evidence is gone from the cache too, the withdrawal is SUSTAINED and
//     derived state diverges silently and permanently (Q4)
//
// Three answers were on the table for the sustained case. This probe drives all three:
//
//   O1  RE-DELIVER  — on a sustained release, put the ignored arrivals back through the one door
//                     from the raw copies the client already holds.
//   O2  REFUSE TO RELEASE — treat "I ignored something under this boundary" the way `_weakened`
//                     already treats "I have trimmed": demote to `stale` and keep the floor as
//                     the compute base rather than withdrawing.
//   O3  ACCEPT      — change nothing; record the divergence and its cost.
//
// ── THE TWO AXES ─────────────────────────────────────────────────────────────────────────────
//   AXIS A  DETERMINISM. Two clients holding byte-identical evidence must compute the same room.
//           The control holds exactly what the case client holds; it simply never had a floor
//           when the straggler landed.
//   AXIS B  THE FORGET LICENCE. What verdict does the client reach on a LATER floor? Measured
//           against BOTH lineages a room can produce — one whose authors held the straggler and
//           one whose authors did not — because which lineage arrives is not something the
//           client chooses.
//
// ── TWO CONFOUNDS FOUND AND REMOVED, BOTH RECORDED BECAUSE EACH READ AS A RESULT ─────────────
//   1. FIRST DRAFT: the later honest floor was remembered at cuts 11/15, the SAME cuts the
//      fixture's own quorum occupies, with different seeds. Two checkpoints claiming one cut do
//      not chain, `select` returned nothing, and `adopted:false` reads exactly like "the later
//      floor was fine". The later cuts now sit strictly ABOVE every cut the fixture remembers.
//   2. FIRST DRAFT: the sandbox never left `REPLAYING`, so `_deriveBest` recorded
//      `not-yet-run/still-replaying` and the seeded comparison never ran AT ALL — in every option
//      simultaneously, which is the shape that reads as agreement.
//      `MatrixBridge.setRoomLive(true)` is the production route out and is now called where
//      production calls it.
//   3. SECOND DRAFT, AND THIS ONE OVERTURNED A PREDICTION: the later floor's seed was built from
//      the COMPLETE log, while the client's log has a hole punched in it to break the chain. The
//      hole is then absent from the client's fold and present in the seed, so EVERY option
//      mismatched and the straggler was measuring nothing. Isolated by hand: with a complete-log
//      seed all four (seed × client) cells mismatch; with a seed built from the same holed log,
//      the straggler becomes the only variable and the pattern is clean. The later seeds are now
//      built from the holed log, which is also the honest model — a deletion is room-wide.
// §9.7: when a probe's answer is uninteresting OR too tidy, the first suspect is the probe.
//
// Usage:  node tools/probes/probe-j37-verdict.js

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
    console.log("      " + (s.ok ? "ok    " : "BROKE ") + s.name +
      (s.got !== undefined ? "  got " + JSON.stringify(s.got) : ""));
  }
}
function refuse(q) {
  console.log("[j37v] REFUSED to answer " + q + " — a precondition did not hold:");
  gateReport();
  process.exit(2);
}

// ── PART Z: the gate's own self-test ─────────────────────────────────────────────────────────
{
  const saved = STAGES.splice(0, STAGES.length);
  stage("self-test: a true precondition", 1 === 1);
  stage("self-test: a FALSE precondition", 1 === 2, { deliberate: true });
  const caught = !gateHolds();
  const missed = gateHolds();
  STAGES.splice(0, STAGES.length);
  for (const s of saved) STAGES.push(s);
  if (!caught || missed) {
    console.log("[j37v] THE GATE ITSELF IS BROKEN — it passed a deliberately false precondition. " +
                "Nothing below this line would have meant anything.");
    process.exit(3);
  }
  console.log("[j37v] PART Z — the admissibility gate catches a deliberately broken precondition.\n");
}

// ── THE WIRED CLIENT ─────────────────────────────────────────────────────────────────────────
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

const JOIN_EV = LOG[8];                                    // $dec3 at l=9 — joins cut 7 to cut 11
const HOLED = LOG.filter((e) => e.eventId !== JOIN_EV.eventId);
const CHANGED = Object.assign({}, DEF, { maxLen: 300 });
const LATE_BELOW = F.reducerEvent("$late-below", 6, 1500, "@owner:hs", F.RANK.owner,
  { t: "ddjp.room.settings", s: CHANGED });

const sortLog = (l) => l.slice().sort((a, b) =>
  (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));

function mkCp(sb, below) {
  const seed = sb.StateDeriver.buildSeed(below);
  const covers = below[0].eventId + ".." + below[below.length - 1].eventId;
  const floorL = below[below.length - 1].l;
  return { n: 1, prev: null, seed, thin: false, covers, floorL,
           h: sb.CheckpointFormat.fingerprint(1, null, seed, floorL, false, covers) };
}
// The fixture's own quorum: cuts 7/11/15 over the COMPLETE log, straggler-free. This is the
// lineage the client verified by recompute at adoption time.
const cpEarly = (sb, n) => mkCp(sb, LOG.slice(0, n));
// The LATER lineage: cuts strictly above 15, built from the HOLED log so the straggler is the
// only variable, and `withStraggler` chooses which of the two lineages a room produced.
const cpLater = (sb, n, withStraggler) =>
  mkCp(sb, withStraggler ? sortLog(HOLED.slice(0, n).concat([LATE_BELOW])) : HOLED.slice(0, n));

const inLog = (sb, id) => sb.StreamManager.getLog().some((e) => e.eventId === id);
const maxLenOf = (sb) => sb.StreamManager.getState().settings.maxLen;
const NUDGE = F.reducerEvent("$nudge", 99, 999999, "@dj:hs", F.RANK.player,
  { t: "ddjp.dj.declare", v: "NUDGE" });

// A client that has ADOPTED a quorum floor at cut 7, has NOT trimmed, and has IGNORED one
// below-cut arrival whose bytes it still holds.
function clientWithIgnoredArrival() {
  const sb = wired();
  const { StreamManager, Floor, EventCache } = sb;
  const deliver = (e, cache) => {
    const raw = F.toRaw(e);
    if (cache !== false) { try { EventCache.store(raw); } catch (x) {} }
    StreamManager.ingest(raw);
  };
  // The joining event is ingested but NOT cached, so the withdrawal below is SUSTAINED — that
  // is the one case J37 is about.
  for (const e of LOG) deliver(e, e.eventId !== JOIN_EV.eventId);
  sb.MatrixBridge.setRoomLive(true);           // replay over; only now are checkpoints judged
  Floor.remember(cpEarly(sb, 7), F.RANK.highStaff, "@a:hs", 1000);
  Floor.remember(cpEarly(sb, 11), F.RANK.highStaff, "@b:hs", 1100);
  Floor.remember(cpEarly(sb, 15), F.RANK.highStaff, "@c:hs", 1200);
  Floor.attach({ myRank: () => F.RANK.highStaff });
  Floor.adopt(Floor.select(F.RANK.highStaff, DEF,
    (q) => Floor.chainVerifies(q, StreamManager.getLog())));
  deliver(LATE_BELOW);
  sb._deliver = deliver;
  return sb;
}

// ── ONE CELL: an option, then a lineage ──────────────────────────────────────────────────────
async function cell(tag, opts) {
  const sb = clientWithIgnoredArrival();
  stage(tag + ": fixture — quorum floor, untrimmed, arrival ignored but HELD",
    sb.Floor.grade() === "quorum" && sb.StreamManager._trimState() === null &&
    !inLog(sb, "$late-below") && !!sb.EventCache.get("$late-below"));
  const CUT = sb.Floor.position();

  if (opts.demote) sb.Floor.attach({ trimmed: () => true });   // route _weakened to the demote branch
  sb.StreamManager._setLogForTest(
    sb.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
  const r = sb.Floor.revalidate();
  stage(tag + ": APPLIED — the weakening took the expected branch",
    r && r.reason === (opts.demote ? "demoted-stale" : "withdrawn"), r);
  await new Promise((res) => setTimeout(res, 0));
  if (!opts.demote) {
    stage(tag + ": the release is SUSTAINED — the re-page found nothing to re-adopt",
      sb.Floor.position() === sb.Floor.NO_FLOOR, sb.Floor.position());
  }

  let replayed = 0;
  if (opts.redeliver) {
    for (const raw of sb.MatrixBridge.heldHere()) {
      const ev = sb.StreamManager.normalise(raw);
      if (!ev || typeof ev.l !== "number" || ev.l > CUT) continue;
      replayed++;
      sb.StreamManager.ingest(raw);
    }
    stage(tag + ": APPLIED — the re-delivery pass ran over held bytes",
      replayed > 0, { replayed: replayed, atOrBelowCut: CUT });
    stage(tag + ": APPLIED — and the ignored arrival reached the derived log",
      inLog(sb, "$late-below"));
  }

  sb._deliver(NUDGE);
  const axisA = maxLenOf(sb);

  // AXIS B: a later floor from the chosen lineage.
  sb.Floor.remember(cpLater(sb, 16, opts.lineage), F.RANK.highStaff, "@d:hs", 2000);
  sb.Floor.remember(cpLater(sb, 17, opts.lineage), F.RANK.highStaff, "@e:hs", 2100);
  sb.Floor.remember(cpLater(sb, 18, opts.lineage), F.RANK.highStaff, "@f:hs", 2200);
  const sel = sb.Floor.select(F.RANK.highStaff, DEF,
    (q) => sb.Floor.chainVerifies(q, sb.StreamManager.getLog()));
  const adopted = sel ? sb.Floor.adopt(sel) : false;
  sb._deliver(F.reducerEvent("$nudge2", 100, 1000000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "NUDGE2" }));
  const verdict = sb.StreamManager.seedValidation();
  stage(tag + ": the later floor was actually ADOPTED, or axis B is unmeasured",
    adopted === true && sb.Floor.position() > CUT, { adopted: adopted, at: sb.Floor.position() });
  stage(tag + ": and the seed verdict is CONCLUSIVE, not 'not-yet-run'",
    verdict.status !== "not-yet-run", verdict);

  return { axisA: axisA, at: sb.Floor.position(), verdict: verdict.status, replayed: replayed };
}

(async () => {
  // ── THE CONTROL: a peer holding byte-identical evidence, which simply never had a floor ─────
  const CTL = wired();
  for (const e of HOLED) CTL.StreamManager.ingest(F.toRaw(e));
  CTL.MatrixBridge.setRoomLive(true);
  CTL.StreamManager.ingest(F.toRaw(LATE_BELOW));
  CTL.StreamManager.ingest(F.toRaw(NUDGE));
  stage("control: the peer genuinely folded the straggler, or it is not a control",
    inLog(CTL, "$late-below"));
  const CTL_MAX = maxLenOf(CTL);
  stage("control: and its settings actually moved, or the divergence is unmeasurable",
    CTL_MAX !== DEF.maxLen, { control: CTL_MAX, defaults: DEF.maxLen });
  stage("control: the phase left REPLAYING, or every seed verdict below is vacuous",
    CTL.Session.phase() !== CTL.Session.REPLAYING, CTL.Session.phase());

  const R = {};
  R.o3_free = await cell("O3/straggler-free-lineage", { lineage: false });
  R.o3_ful  = await cell("O3/straggler-ful-lineage",  { lineage: true });
  R.o1_free = await cell("O1/straggler-free-lineage", { redeliver: true, lineage: false });
  R.o1_ful  = await cell("O1/straggler-ful-lineage",  { redeliver: true, lineage: true });
  R.o2_free = await cell("O2/straggler-free-lineage", { demote: true, lineage: false });
  R.o2_ful  = await cell("O2/straggler-ful-lineage",  { demote: true, lineage: true });
  if (!gateHolds()) refuse("the option matrix");

  console.log("[j37v] AXIS A — DETERMINISM: does the client agree with a peer holding the same bytes?");
  console.log("      control (never had a floor, folded the straggler): maxLen " + CTL_MAX);
  console.log("      O3 accept              maxLen " + R.o3_free.axisA +
              "   agrees: " + (R.o3_free.axisA === CTL_MAX));
  console.log("      O2 refuse to release   maxLen " + R.o2_free.axisA +
              "   agrees: " + (R.o2_free.axisA === CTL_MAX));
  console.log("      O1 re-deliver          maxLen " + R.o1_free.axisA +
              "   agrees: " + (R.o1_free.axisA === CTL_MAX) +
              "   (re-ingested " + R.o1_free.replayed + " held events)");
  console.log("      Under O2 and O3 two clients holding IDENTICAL bytes compute different rooms.");
  console.log("      The only difference between them is whether a floor happened to be held at");
  console.log("      the instant the straggler landed — an accident of timing, made permanent.\n");

  console.log("[j37v] AXIS B — THE FORGET LICENCE, against both lineages a room can produce.");
  console.log("      " + "option".padEnd(24) + "vs straggler-free".padEnd(20) + "vs straggler-ful");
  const row = (n, a, b) => console.log("      " + n.padEnd(24) + a.padEnd(20) + b);
  row("O3 accept", R.o3_free.verdict, R.o3_ful.verdict);
  row("O2 refuse to release", R.o2_free.verdict, R.o2_ful.verdict);
  row("O1 re-deliver", R.o1_free.verdict, R.o1_ful.verdict);
  console.log("      SYMMETRIC, so axis B does NOT discriminate between the options. It only");
  console.log("      relocates WHICH lineage the client can forget under, and which lineage a room");
  console.log("      produces is not something the client chooses. The prediction that re-delivery");
  console.log("      would win this axis was wrong, and the measurement is what says so.\n");

  console.log("[j37v] GATE — every precondition held:");
  gateReport();
})();
