// tools/probes/probe-j73-trim-tie.js
// SUBJECT: backends/backend1/streammanager.js trimToFloor — the tie recorded in
// tests/check-floor-boundary.js's header ("recorded rather than fixed"): trimToFloor keeps
// `l > floorL` while Floor.afterBoundary keeps a same-position event whose id sorts after the
// boundary. QUESTION (J73, ruling 1): does that disagreement ever leave a trimmed client deriving a
// different room from a reader holding everything?
//
// Real modules only (the reference-reader pattern of check-reconnect-moved-floor). A MEASUREMENT,
// not a gate: it prints what it found and exits 0 unless a premise or control fails.
//   node tools/probes/probe-j73-trim-tie.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  ], {});
}
let bad = 0;
function premise(c, msg, d) { if (!c) { bad++; console.log("PREMISE FAILED — " + msg + (d ? " :: " + JSON.stringify(d) : "")); } }

const O = F.RANK.owner, P = F.RANK.player;
const join = (id, l, ts, who, v) => F.reducerEvent(id, l, ts, who, P, { t: "ddjp.dj.join", v: v });
function logWith(siblingL) {
  const S = tree().StateDeriver;
  return [
    F.reducerEvent("$a1", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() }),
    join("$b", 2, 2000, "@a:hs", "vidA0000001"),
    join("$c", 3, 3000, "@b:hs", "vidB0000001"),
    join("$m", 5, 5000, "@d:hs", "vidD0000001"),          // the BOUNDARY event, at the floor
    join("$z", siblingL, 5001, "@c:hs", "vidC0000001"),   // the sibling: same position, id after "$m"
    join("$q", 7, 7000, "@e:hs", "vidE0000001"),
  ];
}
const ROOM = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const roomOf = (st) => { const o = {}; for (const k of ROOM) o[k] = st[k]; return o; };
const who = (st) => (st.rotation || []).map((r) => r.user).join(",");

function run(label, siblingL, grade) {
  const LOG = logWith(siblingL);
  const REF = tree(); REF.Floor.reset(); REF.StreamManager.reset();
  LOG.forEach((e) => REF.StreamManager.ingest(F.toRaw(e)));
  const ref = REF.StreamManager.getState();

  const D = tree(); D.Floor.reset(); D.StreamManager.reset();
  LOG.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
  // The seed covers everything up to AND INCLUDING the boundary, in the fold's own (l, id) order —
  // what Checkpoint.seal() builds (its segment is Floor.afterBoundary, so the boundary is its last).
  const ordered = D.StreamManager.getLog();
  const upTo = ordered.slice(0, ordered.findIndex((e) => e.eventId === "$m") + 1);
  const seed = D.StateDeriver.buildSeed(upTo, undefined);
  D.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: 5, grade: grade, covers: "$a1..$m",
                               seed: seed, prev: null, thin: false });
  const heldBefore = D.StreamManager.getLog().length;
  const dropped = D.StreamManager.trimToFloor();
  const got = D.StreamManager.getState();
  const same = JSON.stringify(roomOf(got)) === JSON.stringify(roomOf(ref));
  const v = D.StreamManager.seedValidation();
  console.log(label.padEnd(44) + " sibling l=" + siblingL + " grade=" + grade +
    " | licence " + v.status + (v.reason ? "/" + v.reason : "") +
    " | held " + heldBefore + " -> dropped " + dropped + " | trimmedBelow=" + D.StreamManager._trimState() +
    " | reference rotation [" + who(ref) + "] trimmed [" + who(got) + "] => " + (same ? "SAME" : "DIFFERENT"));
  return { same, dropped, ref, got, v };
}

const tie = run("TIE: sibling at the floor's position", 5, "verified");
premise(tie.dropped > 0, "the tie case must actually trim, or it measures nothing", { dropped: tie.dropped });
premise(tie.v.status === "validated", "the licence must have been granted, or the trim is not the production path", tie.v);
const ctlAbove = run("CONTROL A: sibling one position above", 6, "verified");
premise(ctlAbove.dropped > 0 && ctlAbove.same, "control A must trim AND match, or SAME/DIFFERENT is not a reading", ctlAbove);
const ctlNoTrim = run("CONTROL B: same tie, floor that earns no trim", 5, "stale");
premise(ctlNoTrim.dropped === 0 && ctlNoTrim.same, "control B must not trim AND must match: the floor alone is not the cause", ctlNoTrim);

console.log(bad ? "VOID — " + bad + " premise(s) failed; do not read the rows above"
  : "MEASURED — tie case is " + (tie.same ? "SAME as reading everything" : "DIFFERENT from reading everything") +
    "; both controls behave, so the difference (if any) is the trim's position-only rule");
process.exit(bad ? 1 : 0);
