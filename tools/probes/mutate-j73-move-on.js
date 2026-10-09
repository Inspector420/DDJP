// tools/probes/mutate-j73-move-on.js
// SUBJECT: J73 job 7 — bot rooms move on at every new save point, only to one that reproduces what is
// held; activity, songs and added times taken first; EventCache banks against the adopted save point.
// Each row puts ONE fix site back, confirms the edit LANDED, runs `check-bot-move-on` and reads the
// outcome; restored after every row and on any exit (mutate-j67-j72.js's shape). M3 is the audit's
// warning (a proof over np, rot and settings only); M4 is this job's own first draft (a comparison by
// key order, which refused every honest save point). Not a row: `History.noteAdds` in `adoptFloor` —
// `History.ingest` of the same dropped events records the added times too, so no guard can kill it.
//   node tools/probes/mutate-j73-move-on.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const B1 = "backends/backend1/streammanager.js", B2 = "backends/backend2/streammanager.js", EC = "backends/backend1/eventcache.js";
const MO = "check-bot-move-on";
const ROWS = [
  ["M1", B2, "    if (_opened) { try { _moveOn(); } catch (e) {} }\n", "", MO, "FAIL — A: after opening", "RED"],
  ["M2", B2, "adoptFloor(args, { take: \"all\", prove: true });", "adoptFloor(args, { take: \"all\" });", MO, "FAIL — B: a save point whose seed differs in rotation", "RED"],   // re-anchored at ddjp_571 (J79 restart): the call's arguments are built first by _foldArgs, so the options now sit on the call's own line
  ["M3", B1, "  const REPRODUCE_FIELDS = [\"nowPlaying\", \"rotation\", \"settings\", \"counts\", \"advance\"];\n",
             "  const REPRODUCE_FIELDS = [\"nowPlaying\", \"rotation\", \"settings\"];\n", MO, "FAIL — B: a save point whose seed differs in counts", "RED"],
  // M4 re-anchored (J73 job 7b): the file's two canonical encoders became one, `_canonAny`.
  ["M4", B1, "      if (_canonAny(_field(held, k)) !== _canonAny(_field(seeded, k))) return",
             "      if (JSON.stringify(_field(held, k)) !== JSON.stringify(_field(seeded, k))) return", MO, "FAIL — A: after opening", "RED"],
  ["M5", B1, "      // and the SONGS: what is dropped is folded into history first, from the base it folds from (J73 job 7)\n      if (typeof History !== \"undefined\" && History.ingest && _drop.length) { try { History.ingest(_drop, _heldBase, Object.assign({ src: \"trim\" }, _droppedReach(_prevCut, fl.floorL) || {})); } catch (e) {} }\n", "", MO, "FAIL — C: every song", "RED"],   // re-anchored at J78: the dropped stretch now declares its reach
  ["M6", B1, "      Activity.take(_drop, _legal);\n", "", MO, "FAIL — C: @o's activity", "RED"],
  ["M7", EC, "        const t = ((typeof Floor !== \"undefined\" && Floor.current) ? Floor.current() : null) || _adoptedCut();\n",
             "        const t = (typeof Floor !== \"undefined\" && Floor.current) ? Floor.current() : null;\n", MO, "FAIL — D: EventCache", "RED"],
  ["M8", EC, "const licensed = _fromAdopted || !!(", "const licensed = !!(", MO, "FAIL — D: EventCache", "RED"],   // re-anchored at ddjp_554: the cache licence line was rewritten (step 5b)
  ["M9", B2, "      _opened = true;\n      return Object.assign({ cp: h.id", "      return Object.assign({ cp: h.id", MO, "FAIL — A: after opening", "RED"],
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
