// tools/probes/mutate-j93-move-on-base.js
// SUBJECT: J93. The move-on check on a tab whose held base is short — the owner's `?v=540` reopen: trimmed at a save point at
// l=8, following save points to l=91 without their boundaries, the events between set aside — folds this tab's own events from
// the save point its last fold stood on, says why not from the held base, and claims no cause it cannot see
// (`backends/backend1/streammanager.js`: the set-aside record, `_foldFloor`, `reproduces(f, from)`, `_recordMoveOnVerdict`).
// One row per rule, each naming the failure it must cause, and the control. Each row plants its edit(s), confirms every one
// LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row,
// and checked restored.
//   node tools/probes/mutate-j93-move-on-base.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const MB = "check-move-on-base", SP = "check-save-point-race";
const A = "FAIL — A: THE CHECK FOLDS FROM THE SAVE POINT THIS TAB'S FOLD STOOD ON";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // MB1 — NOTHING RECORDED WHERE AN ARRIVAL IS SET ASIDE: the check cannot know its held base is short, and warns again.
  ["MB1", [[SM, "      if (!_adopted) _noteSetAside(raw.event_id, protocolL);   // what a fold from the held base now lacks (J93)\n", ""]], MB, A, "RED"],
  // MB2 — THE CHECK IGNORES THE RECORD: the owner's line, from l=8.
  // RE-ANCHORED AT J94: the check asks `_shortBase`, the one home ruling 43 gave every reader of a short base.
  ["MB2", [[SM, "    const _sb = _shortBase(f), short = _sb ? _sb.short : null, from = _sb ? _sb.from : null;\n", "    const _sb = null, short = null, from = null;\n"]], MB, A, "RED"],
  // MB3 — THE FOLD DOES NOT SAY WHAT IT STOOD ON: no other base to fold from.
  ["MB3", [[SM, "      if (!_adopted) _foldFloor = f;   // what this fold stands on, for the next floor's check (J93)\n", ""]], MB, A, "RED"],
  // MB4 — A BASE THAT DOES NOT BANK THE STRETCH ALLOWED: measured green. The record is made under the floor the fold stands on,
  // so in every drive that floor's cut is at or above the stretch; the bound keeps a later retreat from naming a base that is short too.
  ["MB4", [[SM, " || ff.floorL < short.hi || ", " || "]], MB, "", "GREEN"],   // re-anchored at J94: the bound is `_shortBase`'s
  // MB5 — THE BASE CHOSEN, AND THEN NOT USED: `reproduces` folds from the held base anyway.
  ["MB5", [[SM, "      held = from ? StateDeriver.derive(_aboveCut(upTo, from), from.seed) : StateDeriver.derive(upTo, _heldBase);\n",
                "      held = StateDeriver.derive(upTo, _heldBase);\n"]], MB, A, "RED"],
  // MB6 — FROM THE FOLD'S SAVE POINT, OVER EVERYTHING HELD: measured green. What such a tab holds at or below that save point's cut
  // is save points and settings its seed already carries; folding them again changes nothing the check compares.
  ["MB6", [[SM, "StateDeriver.derive(_aboveCut(upTo, from), from.seed)", "StateDeriver.derive(upTo, from.seed)"]], MB, "", "GREEN"],
  // MB7 — A TRIM DOES NOT MOVE THE BASE THE RECORD IS MEASURED AGAINST: the banked stretch stays "set aside" for every later floor.
  ["MB7", [[SM, "    _moveHeldBase(t);                   // and what was set aside at or below its cut is banked by it (J93)\n", ""]], MB,
    "FAIL — E: A TRIM BANKS WHAT WAS SET ASIDE AT OR BELOW ITS CUT", "RED"],
  // MB8 — THE ROOM-START FETCH-BACK LEAVES THE OLD BASE: measured green. No guard reaches `restoreFromStart` after such a reopen
  // (it is not exported; `fetchBack` reaches it only when no save point proves itself); the line keeps the base's description true.
  ["MB8", [[SM, "    _moveHeldBase(null);                 // the held base is the room's start (J93)\n", ""]], MB, "", "GREEN"],
  // MB9 — A FETCH-BACK TO A LATER SAVE POINT LEAVES THE OLD BASE.
  ["MB9", [[SM, "    _moveHeldBase(f);                    // the held base is this floor now (J93: what it banks is no longer set aside above it)\n", ""]], MB,
    "FAIL — E: A FETCH-BACK TO A LATER SAVE POINT BANKS", "RED"],
  // MB10 — A NEW ROOM INHERITS THE LAST ROOM'S RECORD.
  ["MB10", [[SM, "    _setAside.clear(); _heldBaseCut = null; _foldFloor = null; _priorFoldFloor = null;   // and nothing set aside above a held base (J93)\n", ""]], MB,   // re-anchored at J94
    "FAIL — E: A NEW ROOM STARTS WITH NOTHING SET ASIDE", "RED"],
  // MB11 — WHAT IS HELD AGAIN STILL COUNTED AS SET ASIDE: measured green. Only a fetch-back re-admits a set-aside event, and the
  // one that can (`restoreFromStart`) is MB8's; the filter keeps the line from naming events the tab holds.
  ["MB11", [[SM, "      if (held.has(id) || (f && !_atOrBeforeBoundary(f, { l: l, eventId: id }))) continue;\n",
                 "      if (f && !_atOrBeforeBoundary(f, { l: l, eventId: id })) continue;\n"]], MB, "", "GREEN"],
  // MB12 — THE LINE STOPS SAYING WHY IT DID NOT USE THE HELD BASE.
  ["MB12", [[SM, "\", the one this tab's fold stood on — not from \" +\n      heldBase + \", which is short: \" + short.n + \" event(s) from l=\" + short.lo + \" to l=\" + short.hi + \" were set aside as already banked under a save \" +\n      \"point this tab follows but could not trim to\"",
                 "\"\""]], MB, A, "RED"],
  // MB13 — A CAUSE CLAIMED AGAIN: J92's sentence where the check cannot tell why.
  ["MB13", [[SM, ": \"This check does not say why.\")", ": \"Something at or below l=\" + f.floorL + \" reached this tab after the save point was sealed.\")"]], MB,
    "FAIL — C: A SAVE POINT THAT DOES NOT REPRODUCE STILL WARNS, NAMES ITS BASE", "RED"],
  // MB14 — THE WARNING STOPS NAMING ITS BASE.
  ["MB14", [[SM, "\"events up to it, folded from \" + (from ? base + \" (the one this tab's fold stood on)\" : heldBase) + \", give \"", "\"events up to it give \""]], MB,
    "FAIL — C: A SAVE POINT THAT DOES NOT REPRODUCE STILL WARNS, NAMES ITS BASE", "RED"],
  // MB15 — "BOTH ARE PLAYS AT ITS OWN POSITION" NEVER SAID: the sealer's own race (`check-save-point-race` A3) loses what the check knows.
  ["MB15", [[SM, "((at(r.seeded) && at(r.held)) ?", "(false ?"]], SP, "FAIL — A3: THE MOVE-ON CHECK SAYS IT IN PLAIN WORDS", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[SM, "  let _foldFloor = null;        // the save point the trimmed path's last fold stood on\n", "  let _foldFloor = null;        // the save point the trimmed path's last fold stood on\n\n"]], MB, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green" + (id === "N1" ? " — the control" : "")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — measured green went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
