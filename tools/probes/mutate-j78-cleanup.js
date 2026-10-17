// tools/probes/mutate-j78-cleanup.js
// SUBJECT: the forgetting clean-up (`ddjp_566`) — the raw cache holds what the engine holds (HANDOVER item 3), a room entry clears
// the proof memory (`_heldBaseH`), and the bridge's `canProve` wire is guarded. Each row undoes ONE site, confirms the edit LANDED,
// runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-cleanup.js
// Rows marked GREEN are MEASURED, not hoped: each names a line that is dominated today, and the row says by what.
//   C5 — `reset()` clearing the sweep debt is dominated: a room entry also clears `_roomsSeen` and the floor, so a stale sweep has no
//        room to judge and no licensed floor to judge it by (`check-cache-held` E stays green). Kept because it is the one line that
//        says so; it becomes live the day either of those is cleared later than this one.
//   C6 — announcing a bank under an ACCEPTED boundary too is dominated by the cache's licence gate: the sweep runs and `_plan`
//        withholds an unlicensed floor (`check-cache-held` F stays green). The `kind === "trimmed"` test saves the sweep, not the raws.
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const ROWS = [
  ["C1", "backends/backend1/streammanager.js", "    if (kept.length === before) { _raiseBoundary(t.floorL, _bid); _retireCached(); return 0; }\n", "    if (kept.length === before) { _raiseBoundary(t.floorL, _bid); return 0; }\n", "check-cache-held", "FAIL — C:", "RED"],
  ["C2", "backends/backend1/streammanager.js", "      if (_bank.kind === \"trimmed\") _bankedLate();   // below what this device FORGOT: the raw cache's copy may go too (ddjp_566)\n", "      // the door no longer announces a late arrival (break row C2)\n", "check-cache-held", "FAIL — A:", "RED"],
  ["C3", "backends/backend1/matrixbridge.js", "        try { if (StreamManager.settleBanked) StreamManager.settleBanked(); } catch (x) {}\n", "        /* the coalesced sweep is never paid (break row C3) */\n", "check-cache-held", "FAIL — A:", "RED"],
  ["C4", "backends/backend1/eventcache.js", "!neverForget[it.key] && !proofKept[it.key]);   // internal: what is banked now", "!neverForget[it.key]);   // internal: what is banked now", "check-cache-held", "FAIL — D:", "RED"],
  ["C5", "backends/backend1/streammanager.js", "    _bankedOwed = false;      // and a sweep the last room owed is not paid on this one's behalf\n", "    // the debt survives a room entry (break row C5)\n", "check-cache-held", "", "GREEN"],
  ["C6", "backends/backend1/streammanager.js", "      if (_bank.kind === \"trimmed\") _bankedLate();   // below what this device FORGOT: the raw cache's copy may go too (ddjp_566)\n", "      if (true) _bankedLate();   // announced under an accepted boundary too (break row C6)\n", "check-cache-held", "", "GREEN"],
  ["R1", "backends/backend1/streammanager.js", "    _heldBaseH = null;\n    // AND THE STEP-A LINE'S MEMORY", "    // AND THE STEP-A LINE'S MEMORY", "check-reset-proof", "FAIL — A:", "RED"],   // re-anchored at ddjp_569: J79's rider now sits between
  ["W1", "backends/backend1/matrixbridge.js", "        canProve: (f) => { try { return StreamManager.canProve(f); } catch (e) { return { ok: false, needsFetch: true }; } },   // retreat by proof (ddjp_550)\n", "        // canProve: removed, the line kept (break row W1)\n", "check-floor-wire", "FAIL — A:", "RED"],
  ["W2", "backends/backend1/matrixbridge.js", "canProve: (f) => { try { return StreamManager.canProve(f); }", "canProve: (f) => { try { return { ok: true }; }", "check-floor-wire", "FAIL — C:", "RED"],
  ["W3", "backends/backend1/matrixbridge.js", "catch (e) { return { ok: false, needsFetch: true }; } },   // retreat by proof (ddjp_550)", "catch (e) { return { ok: true }; } },   // retreat by proof (ddjp_550)", "check-floor-wire", "FAIL — D:", "RED"]
];
let planted = null;
function restore() { if (planted) { fs.writeFileSync(planted.file, planted.original); planted = null; } }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect, want] of ROWS) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the line is unreachable, as recorded"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected no change; the 'unreachable' claim is wrong"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
