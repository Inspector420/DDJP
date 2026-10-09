// tools/probes/mutate-j73-activity.js
// SUBJECT: J73 job 2 — activity taken before anything is dropped, into one module, counting only
// accepted acts; the bot's judge asks the reducer; a floor names its boundary or is never remembered.
//
// Each row puts ONE fix site back the way it was, confirms the edit LANDED (anchor exactly once, bytes
// changed), runs the named guard and reads the outcome; restored after every row and on any exit
// (mutate-j67-j72.js's shape). A row whose anchor is gone reports VOID, never GREEN. Row J12 is the
// mistake this job's first draft made — legality read from the fold the trim had already reseeded —
// kept so it cannot return silently.
//   node tools/probes/mutate-j73-activity.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const B1 = "backends/backend1/streammanager.js", B2 = "backends/backend2/streammanager.js";
const AC = "backends/backend1/activity.js", AU = "backends/backend2/authority.js", RN = "backends/backend2/runner.js";
const FL = "backends/backend1/floor.js";
const AT = "check-activity-taken", JR = "check-judge-reducer", PB = "check-protect-boundary";
// J1–J3 and J12 RE-ANCHORED (J73 job 6): the trim's legality verdict is now computed once as `_legal`
// and shared with `History.noteAdds`, so the line they mutated was split. Same mutations, same guards.
const ROWS = [
  ["J1", B1, "      Activity.take(_drop, _legal, { complete: _fromStart });\n", "", AT, "FAIL — A: after the trim presence", "RED"],
  ["J2", B1, "      Activity.take(_drop, _legal, { complete: _fromStart });\n",
             "      Activity.take(_drop, null, { complete: _fromStart });\n", AT, "FAIL — B: a REFUSED", "RED"],
  ["J3", B1, "      Activity.take(_drop, _legal, { complete: _fromStart });\n",
             "      Activity.take(_drop, _legal, { complete: false });\n", AT, "FAIL — A: what was taken reaches", "RED"],
  ["J4", B1, "    if (opts && opts.take && typeof Activity !== \"undefined\") {\n", "    if (false) {\n", AT, "FAIL — C: a person whose only act", "RED"],
  ["J5", B2, "      const r = B1StreamManager.adoptFloor(args, { take: \"all\" });\n      _opened = true;", "      const r = B1StreamManager.adoptFloor(args);\n      _opened = true;", AT, "FAIL — C: the bot door's openFromSavePoint", "RED"],   // re-anchored at ddjp_569 (J79): the restore's branch adopts with the same option; again at ddjp_571: the arguments are built first by _foldArgs, so the anchor is the call and the line after it
  ["J6", AC, "      for (const g of Object.keys(row)) if (row[g] < now - max) { delete row[g]; n++; }\n",
             "      for (const g of Object.keys(row)) if (false) { delete row[g]; n++; }\n", AT, "FAIL — D", "RED"],
  ["J7", AU, "    if (!v.ok || !relays(intent.t)) return v;\n", "    return v;\n", JR, "FAIL — A", "RED"],
  ["J8", AU, "    if (pending.length) { try { judged = StateDeriver.derive(log.concat(pending), ctx.seed); } catch (e) { judged = state; } }\n",
             "", JR, "FAIL — B: once", "RED"],
  ["J9", AU, "    if (code === \"too-early\") return (intent && intent.t === \"ddjp.dj.play\") ? { ok: false, reason: \"a play before its time\", code: code, silent: true } : v;\n", "", JR, "FAIL — C", "RED"],   // re-anchored at J76: an early play is now ignored in silence
  ["J10", RN, "        ? { log: StreamManager.getLog(), seed: (typeof StreamManager.floorSeed === \"function\") ? (StreamManager.floorSeed() || undefined) : undefined }\n",
              "        ? undefined\n", JR, "FAIL — D", "RED"],
  ["J11", FL, "      if (!_id) return false; }\n", "      }\n", PB, "FAIL — H", "RED"],
  ["J13", AU, " _bypassUsed = 0; _lastOpenAt = -Infinity; _committed = []; }", " _bypassUsed = 0; _lastOpenAt = -Infinity; }", JR, "FAIL — E", "RED"],   // re-anchored at J76: reset is the queue's now
  ["J12", B1, "      const _legal = _heldAccepted();\n",
              "      const _legal = isLegal;\n", AT, "FAIL — B CONTROL", "RED"],
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
