// tools/probes/mutate-j94-short-base.js
// SUBJECT: J94, the owner's ruling 43. Where a tab's held base is short — it follows a save point it could not trim to and has
// set events aside below it (the `?v=540` reopen) — what it keeps of what it forgets counts from that save point: the trim's
// record of who was active (with the set-aside events back from the raw cache), song history's hand-offs, the rotation's entry
// times (`backends/backend1/streammanager.js`: `_shortBase`, `_setAsideFromCache`, `_judgedPast`, `_handHistory`, the trim's
// take, `rotationEntries`; `backends/backend1/matrixbridge.js`: the raw cache's reader, wired beside its retire). One row per rule, each naming the failure it must cause, and the control. Each row plants its
// edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored.
//   node tools/probes/mutate-j94-short-base.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const MBR = "backends/backend1/matrixbridge.js";
const SB = "check-short-base-readers";
const E = "FAIL — E: THE ENTRY TIMES WHILE THE BASE IS SHORT", IN = "FAIL — A: THE ACTS INSIDE THE SET-ASIDE STRETCH ARE TAKEN";
const VOTES = "FAIL — A: THE VOTES ON THE PLAY THE TRIM DROPPED COUNT", H = "FAIL — H: SONG HISTORY IS THE TAB'S THAT HELD EVERY EVENT";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // SB1 — NO SHORT BASE EVER FOUND: every reader counts from the held base again.
  ["SB1", [[SM, "    const short = _setAsideUpTo(t || null);\n    if (!short) return null;\n", "    return null;\n"]], SB, E, "RED"],
  // SB2 — THE FLOOR BEFORE NOT REMEMBERED: at the trim the fold already stands on the floor being adopted, so nothing to read past.
  ["SB2", [[SM, "      if (!_adopted && _foldFloor && _sigOf(_foldFloor) !== _sigOf(f)) _priorFoldFloor = _foldFloor;   // and the one before (J94)\n", ""]], SB, IN, "RED"],
  // SB3 — THE SET-ASIDE EVENTS NOT BROUGHT BACK from the raw cache.
  ["SB3", [[SM, "const _sb = _shortBase(t), _aside = _sb ? _setAsideFromCache(t) : [];", "const _sb = _shortBase(t), _aside = [];"]], SB, IN, "RED"],
  // SB4 — THE TRIM JUDGES BY THE HELD BASE: the votes on the dropped play count for nobody (J93's finding).
  ["SB4", [[SM, "      const _legal = _sb ? _judgedPast(_sb, _aside) : _heldAccepted();\n", "      const _legal = _heldAccepted();\n"]], SB, VOTES, "RED"],
  // SB5 — ABOVE THE FOLLOWED SAVE POINT, JUDGED FROM THE HELD BASE.
  ["SB5", [[SM, "    const hi = _acceptedBy(above, sb.from.seed);\n", "    const hi = _acceptedBy(above, _heldBase);\n"]], SB, VOTES, "RED"],
  // SB6 — BELOW IT, JUDGED WITHOUT THE SET-ASIDE EVENTS: they are unknown to that fold, so refused.
  ["SB6", [[SM, "_heldBase);\n    return (id) => (mine.has(id) ? hi(id) : lo(id));", "_heldBase) && (() => false);\n    return (id) => (mine.has(id) ? hi(id) : lo(id));"]], SB, IN, "RED"],
  // SB7 — THE SET-ASIDE EVENTS JUDGED BUT NOT TAKEN.
  ["SB7", [[SM, "      const _taken = _aside.length ? _drop.concat(_aside) : _drop;\n", "      const _taken = _drop;\n"]], SB, IN, "RED"],
  // SB8 — SONG HISTORY'S HAND-OFF AT THE TRIM COUNTS FROM THE HELD BASE: the plays of the set-aside stretch lose their tallies.
  ["SB8", [[SM, "_handHistory(_drop, t, \"trim\", _sb, _aside);", "_handHistory(_drop, t, \"trim\", null, null);"]], SB, H, "RED"],
  // SB9 — THE SET-ASIDE STRETCH NEVER HANDED TO HISTORY.
  ["SB9", [[SM, "    if (aside && aside.length && aside.length === sb.short.n) {\n", "    if (false) {\n"]], SB, H, "RED"],
  // SB10 — ABOVE THE FOLLOWED SAVE POINT, HISTORY FOLDS FROM THE HELD BASE. RE-MEASURED AT J96: green. The dropped play's final
  // tally reaches its row by the live refresh too (which folds from the save point the fold stands on), and since J96 a hand-off
  // that has no tally for a row no longer takes the row's away; before J96 that hand-off's tally-less row replaced it (red, H).
  ["SB10", [[SM, "    return above.length ? History.ingest(above, sb.from.seed,", "    return above.length ? History.ingest(above, _heldBase,"]], SB, "", "GREEN"],
  // SB11 — THE ADOPTION HAND-OFF PAST A SHORT BASE TAKEN BACK: measured green. The trim's hand-off, which follows it in the same
  // call, carries the same stretch from the same save point; the adoption's matters to a tab that may not forget (no licence).
  ["SB11", [[SM, "r = _handHistory(below, t, \"settle\", _shortBase(t), null);", "r = _handHistory(below, t, \"settle\", null, null);"]], SB, "", "GREEN"],
  // SB12 — THE ENTRY TIMES COUNT FROM THE HELD BASE: a member who joined inside the set-aside stretch has none.
  ["SB12", [[SM, "    const _sb = _shortBase(null), _base = _sb ? _sb.from.seed : _heldBase;\n", "    const _sb = null, _base = _heldBase;\n"]], SB, E, "RED"],
  // SB13 — FROM THE SAVE POINT, OVER EVERYTHING HELD: measured green (`mutate-j93-move-on-base` MB6's reason: what such a tab
  // holds at or below that cut is save points and settings its seed already carries).
  ["SB13", [[SM, "    const log = _sb ? _aboveCut(orderEvents(eventLog), _sb.from) : orderEvents(eventLog);\n", "    const log = orderEvents(eventLog);\n"]], SB, "", "GREEN"],
  // SB14 — A SET-ASIDE EVENT THAT IS HELD BROUGHT BACK TWICE: measured green. A set-aside event is held again only after a
  // fetch-back re-admits it (`mutate-j93-move-on-base` MB11); the filter keeps it from being taken twice then.
  ["SB14", [[SM, "      if (held.has(id) || !_atOrBeforeBoundary(t, { l: l, eventId: id })) continue;\n      let e = null;\n", "      if (!_atOrBeforeBoundary(t, { l: l, eventId: id })) continue;\n      let e = null;\n"]], SB, "", "GREEN"],
  // SB15 — THE BRIDGE DOES NOT WIRE THE RAW CACHE'S READER: the engine finds nothing to bring back.
  ["SB15", [[MBR, "    try { if (StreamManager.setRawReader) StreamManager.setRawReader(", "    try { if (false) StreamManager.setRawReader("]], SB, IN, "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[SM, "  let _priorFoldFloor = null;", "  let _priorFoldFloor = null; "]], SB, "", "GREEN"],
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
