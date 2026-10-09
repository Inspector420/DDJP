// tools/probes/mutate-j78-fetchback.js
// SUBJECT: J78 — the three fixes from the owner's bot-room test. Each row undoes ONE site, confirms the edit LANDED, runs
// the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
//   node tools/probes/mutate-j78-fetchback.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js", HI = "backends/backend1/history.js", PB = "features/playback.js", PL = "ui/player.js", MB = "backends/backend1/matrixbridge.js";
const HF = "check-history-floor-reach", EB = "check-ended-by-play", CJ = "check-channel-join", HL = "check-history-live-reach", VD = "check-vote-dedupe", VL = "check-vote-latch";
const AU = "backends/backend2/authority.js", RX = "features/reactions.js", BR = "features/botruntime.js", SP = "backends/backend1/settingsproof.js";
const RR = "check-repeat-rule", RC = "check-repeat-cooldown", PO = "check-player-load-once", AF = "check-answer-after-floor", UR = "check-upgrade-reconcile";
const FD = "check-forgetting-differential";
const FL = "backends/backend1/floor.js";
const ROWS = [
  // R1–R6 (ddjp_550, plan steps 3–4): retreat by proof and the fetch-back. R1 and R3 re-anchored at ddjp_551 (restoreBelow keeps a quorum proof).
  ["R1", SM, "      if (pr.ok) {\n        restoreBelow(c, all(), sel.tier > 0); Floor.standOn(c, sel.tier);", "      if (true) {\n        restoreBelow(c, all(), sel.tier > 0); Floor.standOn(c, sel.tier);", FD, "FAIL — S4c:", "RED"],
  ["R2", SM, "    if (_heldBaseH && f.h === _heldBaseH) return { ok: true, reason: \"trimmed-under\" };\n", "    return { ok: true, reason: \"assumed\" };\n", FD, "FAIL — S4b:", "RED"],
  ["R3", SM, "      if (pr.ok) {\n        restoreBelow(c, all(), sel.tier > 0); Floor.standOn(c, sel.tier);", "      if (pr.ok && out.tried > 999) {\n        restoreBelow(c, all(), sel.tier > 0); Floor.standOn(c, sel.tier);", FD, "FAIL — S4d: fetching stops at the first floor", "RED"],
  ["R4", FL, "    _emit(\"needs-fetch\", { reason: why });   // forgetting stops now; the fetch-back looks for a floor that proves itself\n", "", FD, "FAIL — S4b:", "RED"],
  ["R5", FL, "    return (fingerprint(f.n, f.prev || null, seed, f.floorL, f.thin, f.covers, f.era, f.root) === f.h) ? { ok: true } : { ok: false, reason: \"does-not-rebuild\" };", "    return { ok: true };", FD, "FAIL — S4c:", "RED"],   // re-anchored at ddjp_571 (J79 restart): the fingerprint now also takes the restart (era, root)
  ["R6", FL, "        _tried.add(f.h); continue;                                          // holds the data, but does not rebuild: skip it\n", "        return _weakened(\"replaced-by-older\");\n", FD, "FAIL — S4c:", "RED"],
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
