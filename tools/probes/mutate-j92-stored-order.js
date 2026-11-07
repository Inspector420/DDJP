// tools/probes/mutate-j92-stored-order.js
// SUBJECT: J92. (Ruling 42) a song table stored before `?v=540` — its "verified" marks made by the locale order — is checked
// against the room again, once (`backends/backend1/history.js` `KEY_V` v3; `restore` counts the older marks; the bridge says so).
// (Item 3) the sealer's own case of ruling 41: a play at the save point's position reaching the sealer while the seal is sent —
// the engine hands the closed stretch to History at adoption (`StreamManager._settleHistory`), the trim hands it over settled,
// History prunes a stretch its save point re-decided, and the move-on check says what happened in plain words
// (`backends/backend1/streammanager.js`). One row per rule, each naming the failure it must cause, and the control. Each row
// plants its edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`);
// everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j92-stored-order.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", SM = "backends/backend1/streammanager.js";
const SP = "check-save-point-race";
const PRUNE = "    if (opts && (opts.src === \"trim\" || opts.src === \"settle\") && _st && _st.dropped.length && both && both.state && typeof lo === \"number\" && typeof hi === \"number\") {\n";
const PICK = "      for (const r of _entries) if (r && (r.src === \"refresh\" || r.src === \"trim\" || r.src === \"settle\") && typeof r.l === \"number\" && r.l >= lo && r.l <= hi && !keep.has(r.pi)) removed.push(r);\n";
// RE-ANCHORED AT J94 (ruling 43): the shared trim and the adoption hand-off both go through `_handHistory`, which holds the settle.
const TRIM_SHARED = "_handHistory(_drop, t, \"trim\", _sb, _aside); } catch (e) {} }";
const HAND = "    if (!sb) return History.ingest(events, _heldBase, Object.assign({ src: src, settle: { at: t.floorL, seed: t.seed } }";
const TRIM_BOT = "History.ingest(_drop, _heldBase, Object.assign({ src: \"trim\", settle: { at: fl.floorL, seed: fl.seed } }, _droppedReach(_prevCut, fl.floorL) || {})); } catch (e) {} }";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ST1 — THE OLD RULE'S MARKS COUNT AGAIN: the table stored before `?v=540` is never read again (live: 1 missing, 1 extra).
  ["ST1", [[HI, "  const KEY_V = \"v3|\";\n", "  const KEY_V = \"v2|\";\n"]],
    SP, "FAIL — F: THE OPEN SAYS A CHECK MADE BY THE OLD ORDER IS SET ASIDE", "RED"],
  // ST2 — THE OLDER MARKS KEPT: verify asks for the new rule's key, so it re-checks anyway — but the old marks ride along in
  // every table stored from then on.
  ["ST2", [[HI, "      if (!v || typeof v.hi !== \"number\" || k.indexOf(KEY_V) !== 0) continue;\n", "      if (!v || typeof v.hi !== \"number\") continue;\n"]],
    SP, "FAIL — F: ONCE", "RED"],
  // ST3 — THE OPEN DOES NOT SAY IT.
  ["ST3", [[MB, "              if (rr.olderMarks > 0) Logger.info(", "              if (false) Logger.info("]],
    SP, "FAIL — F: THE OPEN SAYS A CHECK MADE BY THE OLD ORDER IS SET ASIDE", "RED"],
  // ST4 — EVERY MARK COUNTED AS OLDER: a table stored after the check would say it again at every open.
  ["ST4", [[HI, "      if (v && typeof v.hi === \"number\" && k.indexOf(KEY_V) !== 0) older++;\n", "      if (v && typeof v.hi === \"number\") older++;\n"]],
    SP, "FAIL — F: ONCE", "RED"],
  // SE1 — NO HAND-OFF AT ADOPTION: a tab that held both plays keeps the room-order one (J91's bridge refresh, which did this, is gone).
  // (Re-anchored at `ddjp_632`: the refold now says why, for J71's REVISED line; the row still removes only the hand-off.)
  ["SE1", [[SM, "if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; _refold({ why: \"following the save point at l=\" + t.floorL }); _settleHistory(t); }", "if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; _refold({ why: \"following the save point at l=\" + t.floorL }); }"]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SE2 — THE HAND-OFF NOT SETTLED by the save point it follows.
  // RE-ANCHORED AT J94: the adoption hand-off's settle is `_handHistory`'s, which the shared trim shares — so this row now
  // unsettles both; A still names the adoption's.
  ["SE2", [[SM, HAND, HAND.replace(", settle: { at: t.floorL, seed: t.seed }", "")]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SE3 — A RE-DECIDED STRETCH NOT PRUNED: the room-order play stays beside the save point's.
  ["SE3", [[HI, PRUNE, "    if (false) {\n"]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SE4 — PRUNED WITHOUT A RE-DECISION.
  ["SE4", [[HI, PRUNE, PRUNE.replace("_st && _st.dropped.length && ", "")]],
    SP, "FAIL — D: a stretch its save point agrees with removes nothing", "RED"],
  // SE5 — ANY PATH'S ROW PRUNED.
  ["SE5", [[HI, PICK, PICK.replace("(r.src === \"refresh\" || r.src === \"trim\" || r.src === \"settle\")", "true")]],
    SP, "FAIL — D: A STRETCH ITS SAVE POINT RE-DECIDED", "RED"],
  // SE6 — BELOW THE STRETCH.
  ["SE6", [[HI, PICK, PICK.replace("r.l >= lo && ", "")]],
    SP, "FAIL — D: A STRETCH ITS SAVE POINT RE-DECIDED", "RED"],
  // SE7 — ABOVE IT.
  ["SE7", [[HI, PICK, PICK.replace(" && r.l <= hi", "")]],
    SP, "FAIL — D: A STRETCH ITS SAVE POINT RE-DECIDED", "RED"],
  // SE8 — THE HAND-OFF WRITES WHILE THE TAB IS STILL CATCHING UP.
  ["SE8", [[HI, "    if (opts && (opts.src === \"trim\" || opts.src === \"settle\") && typeof _env.settled === \"function\") {", "    if (opts && opts.src === \"trim\" && typeof _env.settled === \"function\") {"]],
    SP, "FAIL — A2: PREMISE — catching up, the tab follows the save point but writes nothing", "RED"],
  // SE9 — THE TRIMS' SETTLE: measured green. Driven, a tab whose held stretch holds such a play does not prove the save point
  // ("does-not-rebuild") and does not trim it; kept so a trim can never re-write what the adoption hand-off settled (live, the
  // owner's tab trimmed after the move-on warning, and the log that would show why did not arrive).
  // RE-AIMED AT J94: the shared trim's settle is now the adoption hand-off's line (`_handHistory`, SE2); this row keeps the bot trim's.
  ["SE9", [[SM, TRIM_BOT, TRIM_BOT.replace(", settle: { at: fl.floorL, seed: fl.seed }", "")]], SP, "", "GREEN"],
  // SE10 — THE MOVE-ON CHECK BACK TO "does not reproduce from the held base (nowPlaying)".
  ["SE10", [[SM, "    else if (r.field === \"nowPlaying\") {\n", "    else if (false) {\n"]],
    SP, "FAIL — A3: THE MOVE-ON CHECK SAYS IT IN PLAIN WORDS", "RED"],
  // SE11 — THE HAND-OFF SILENT about the row that left.
  ["SE11", [[SM, "    for (const x of (r && Array.isArray(r.removed)) ? r.removed : []) Logger.info(\"StreamManager: song history follows save point n=", "    for (const x of []) Logger.info(\"StreamManager: song history follows save point n="]],
    SP, "FAIL — A: THE BOT'S TAB SAYS WHICH ROW LEFT AND WHY", "RED"],
  // SE12 — THE SHARED TRIM'S HAND-OFF ALONE: measured green. The save point's adoption hands the same stretch over first, in the
  // same call; the trim's own hand-off is for a trim that lands after an adoption whose hand-off waited for a settled device.
  ["SE12", [[SM, "      if (typeof History !== \"undefined\" && History.ingest && _drop.length) { try { " + TRIM_SHARED + "\n", ""]], SP, "", "GREEN"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[HI, "  const KEY_V = \"v3|\";\n", "  const KEY_V = \"v3|\";\n\n"]], SP, "", "GREEN"],
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
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
