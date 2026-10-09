// tools/probes/mutate-j73-eventcache.js
// SUBJECT: J73 — EventCache lets go of what is banked as soon as it is (owner's order after job 8).
// Each row puts ONE site back, confirms the edit LANDED, runs `check-eventcache-retire` and reads the outcome by
// the suite's own rule (`_verdict.js`); restored after every row and on any exit (mutate-j67-j72.js's shape).
// Not a row: `retireBanked`'s early return on a withheld floor — with no floor `mayRetire` already refuses
// every item, so the line changes no answer and no guard can tell it is gone.
//   node tools/probes/mutate-j73-eventcache.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const EC = "backends/backend1/eventcache.js", B1 = "backends/backend1/streammanager.js", ER = "check-eventcache-retire";
const ROWS = [
  ["E1", B1, "    _heldBaseH = t.h || null;           // and that floor was proved here (its licence): it needs no fetch to stand on\n    _retireCached();                    // and the raw cache lets go of what is now banked (J73)\n",
             "    _heldBaseH = t.h || null;           // and that floor was proved here (its licence): it needs no fetch to stand on\n", ER, "FAIL — A: every banked raw is gone", "RED"],   // re-anchored at ddjp_550: `_heldBaseH` now sits between the two lines
  ["E2", B1, "    _heldBase = fl.seed;                // the held log now folds from this save point's seed (J73 job 2)\n    _retireCached();                    // and the raw cache lets go of what is now banked (J73)\n",
             "    _heldBase = fl.seed;                // the held log now folds from this save point's seed (J73 job 2)\n", ER, "FAIL — B:", "RED"],
  ["E3", EC, "      if (!it.raw || !rooms.has(it.raw.room_id)) continue;\n", "      if (!it.raw) continue;\n", ER, "FAIL — C", "RED"],
  ["E4", EC, "      if (_idbOk()) { try { IDB.del(STORE, it.key).catch(() => {}); } catch (e) {} }\n    }\n    return { dropped: dropped, floorL: plan.floorL };",
             "    }\n    return { dropped: dropped, floorL: plan.floorL };", ER, "FAIL — A: and IndexedDB holds exactly", "RED"],
  ["E5", EC, "          try { it.retire = Vouch.mayRetire(", "          try { it.retire = false && Vouch.mayRetire(", ER, "FAIL — A: every banked raw is gone", "RED"],
  ["E7", "backends/backend1/matrixbridge.js", "      _wireCacheRetire();   // the raw cache lets go of what each forgetting banks (J73)\n", "", ER, "FAIL — G", "RED"],
  ["E8", "backends/backend1/matrixbridge.js", "      try { if (typeof EventCache !== \"undefined\" && EventCache.retireBanked) EventCache.retireBanked(new Set((e && e.rooms) || [])); } catch (x) {}\n", "", ER, "FAIL — A: every banked raw is gone", "RED"],
  ["E9", EC, "    const rooms = new Set((roomIds && typeof roomIds[Symbol.iterator] === \"function\" && typeof roomIds !== \"string\") ? roomIds : []);\n",
             "    const rooms = (roomIds instanceof Set) ? roomIds : new Set(Array.isArray(roomIds) ? roomIds : []);\n", ER, "FAIL — A: every banked raw is gone", "RED"],
  ["E6", B1, "    if (raw.room_id) _roomsSeen.add(raw.room_id);   // this room's raws are the cache's to retire (J73)\n", "", ER, "FAIL — A: every banked raw is gone", "RED"],
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
