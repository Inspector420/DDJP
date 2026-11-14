// tools/probes/mutate-j104-rep.js
// SUBJECT: J104 — REP's small cleanup (`ddjp_599`): the saves switch's name (`ui/chat.js` `_settingDisplayName`, held by
// `check-rep-rules` S from what each switch moves); the ports file's hook list (`features/rep-ports.js`, held by
// `check-rep-boundary` D against the hooks `Rep` lists); its guard claim, made true (`check-rep-ports` H: every function a
// port reaches exists on the real modules, under both engines); and the two ports nothing called, removed (`check-rep-ports`
// A: every port is called by a REP piece). One row per site, each naming the failure it must cause in its guard, and the
// controls. Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the
// suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j104-rep.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const CH = "ui/chat.js", RP = "features/rep-ports.js", MB = "backends/backend1/matrixbridge.js";
const RU = "check-rep-rules", PO = "check-rep-ports", BD = "check-rep-boundary";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE SWITCHES' NAMES ──
  // NM1 — the saves switch claims REP again, which it does not move.
  ["NM1", [[CH, "repSelfSaves: \"Self-saves count\",", "repSelfSaves: \"Self-saves count in REP\","]],
    RU, "FAIL — S: THE SWITCH'S NAME SAYS WHAT IT DOES — `repSelfSaves`", "RED"],
  // NM2 — the votes switch stops saying REP, which it does move: the row reads both directions.
  ["NM2", [[CH, "repSelfVotes: \"Self-votes count in REP\",", "repSelfVotes: \"Self-votes count\","]],
    RU, "FAIL — S: THE SWITCH'S NAME SAYS WHAT IT DOES — `repSelfVotes`", "RED"],
  // ── THE HOOK LIST ──
  // HK1 — the header's "H1–H5" again: a fifth hook nobody has.
  ["HK1", [[RP, "the hook sites H1–H4 (listed", "the hook sites H1–H5 (listed"]],   // re-anchored at J107: the header no longer cites the design
    BD, "FAIL — D: EVERY HOOK REP'S FILES NAME IS ONE `Rep` HAS", "RED"],
  // ── THE PORTS ──
  // PT1 — a port nothing calls is kept again (song history's coverage, as before J104).
  ["PT1", [[RP, "  function nowPlaying() {\n", "  function historyCoverage() { try { return _has(MB(), \"historyCoverage\") ? MB().historyCoverage() : null; } catch (e) { return null; } }\n  function nowPlaying() {\n"],
    [RP, "    \"playings\", \"nowPlaying\", \"pageReactions\",", "    \"playings\", \"historyCoverage\", \"nowPlaying\", \"pageReactions\","],
    [RP, "    playings, nowPlaying, pageReactions,", "    playings, historyCoverage, nowPlaying, pageReactions,"]],
    PO, "FAIL — A: EVERY PORT IS CALLED BY A REP PIECE", "RED"],
  // PT2 — the real transport no longer has the function a port reaches (as a rename would leave it): the port's stand-in
  // in B still has it, so only H can see the port now answers its empty answer for ever.
  ["PT2", [[MB, "    deliveryState, deferralExpired, roomHistory, historyCoverage,", "    deliveryState, deferralExpired, historyCoverage,"]],
    PO, "FAIL — H: EVERY FUNCTION A PORT REACHES EXISTS ON THE REAL MODULE", "RED"],
  // PT3 — a port asks for a function no module has.
  ["PT3", [[RP, "_has(RM(), \"presenceView\") ? RM().presenceView(now)", "_has(RM(), \"presenceViewOf\") ? RM().presenceViewOf(now)"]],
    PO, "FAIL — H: EVERY FUNCTION A PORT REACHES EXISTS ON THE REAL MODULE", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[CH, "      repSummaryMs: \"REP summary every\",", "\n      repSummaryMs: \"REP summary every\","]], RU, "", "GREEN"],
  ["N2", [[RP, "  function nowPlaying() {\n", "\n  function nowPlaying() {\n"]], PO, "", "GREEN"],
  ["N3", [[RP, "  function nowPlaying() {\n", "\n  function nowPlaying() {\n"]], BD, "", "GREEN"],
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
