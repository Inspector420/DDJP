// tools/probes/mutate-j102-small.js
// SUBJECT: J102 — three small defects (`ddjp_599`): the Logs tab's level tints (`index.html`, the rows built by
// `ui/panels.js` `_appendLogRow`; held by `check-log-filter` L); `sw-register.js`'s two log lines (`Logger` read as the
// top-level name it is, not as `window.Logger`; held by `check-sw-register`); and the rotation replay taking every advance
// (`backends/backend1/streammanager.js` `AFFECTS_ROTATION`, from `_ADVANCE_TYPES`; held by `check-idle-sweep` D4). One row
// per site, each naming the failure it must cause in its guard, and the controls. Each row plants its edit(s), confirms
// every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is
// restored after every row, and checked restored.
//   node tools/probes/mutate-j102-small.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const IX = "index.html", PN = "ui/panels.js", SW = "sw-register.js", SM = "backends/backend1/streammanager.js";
const LF = "check-log-filter", SR = "check-sw-register", IS = "check-idle-sweep";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE LOGS TAB'S TINTS ──
  // TN1 — the warning's rule goes again, as at the `ddjp_490` close.
  ["TN1", [[IX, "    .log-line.lvl-warn { color: #d9a441; }\n", ""]], LF, "FAIL — L: A WARNING AND AN ERROR ARE TINTED", "RED"],
  // TN2 — the tints sit before the fresh and old rules, which then win: nothing shows.
  ["TN2", [[IX, "    .log-line.lvl-warn { color: #d9a441; }\n    .log-line.lvl-error { color: #e06c6c; }\n", ""],
    [IX, "    .log-line { white-space: pre-wrap;", "    .log-line.lvl-warn { color: #d9a441; }\n    .log-line.lvl-error { color: #e06c6c; }\n    .log-line { white-space: pre-wrap;"]],
    LF, "FAIL — L: and the tints come after the fresh and old rules", "RED"],
  // TN3 — an earlier session's warning is no longer told apart.
  ["TN3", [[IX, "    .log-line.old.lvl-warn, .log-line.old.lvl-error { opacity: .6; }", "    .log-line.old.lvl-warn, .log-line.old.lvl-error { }"]],
    LF, "FAIL — L: an earlier session's warning or error is dimmed", "RED"],
  // TN4 — the join no longer carries the level: the guard reads the class the panel builds, not a name it assumes.
  ["TN4", [[PN, "\" lvl-\" + _lineLevel(text), text: text }));", "\" lvl-info\", text: text }));"]],
    LF, "FAIL — L PREMISE — each row the panel builds carries", "RED"],
  // ── THE SERVICE WORKER'S LOG LINES ──
  // SW1 — the refusal asks `window.Logger` again, which a top-level `const` never is.
  ["SW1", [[SW, "        if (typeof Logger !== 'undefined' && Logger && Logger.warn) {", "        if (window.Logger && Logger.warn) {"]],
    SR, "FAIL — B: A REFUSED REGISTRATION IS LOGGED", "RED"],
  // SW2 — the kill switch's note, the same.
  ["SW2", [[SW, "      if (typeof Logger !== 'undefined' && Logger && Logger.info) Logger.info(", "      if (window.Logger && Logger.info) Logger.info("]],
    SR, "FAIL — C: THE KILL SWITCH IS LOGGED", "RED"],
  // ── THE ROTATION REPLAY ──
  // RT1 — the replay takes the play alone again: a skip that plays a DJ's last song is not seen as their leaving.
  ["RT1", [[SM, "  for (const t of _ADVANCE_TYPES) AFFECTS_ROTATION[t] = 1;\n", "  AFFECTS_ROTATION[\"ddjp.dj.play\"] = 1;\n"]],
    IS, "FAIL — D4: RUNNING OUT AT A SKIP IS LEAVING (ddjp.dj.skip)", "RED"],
  // RT2 — the replay reads the one list: an advance missing from it is missing from the replay (here the room's skip).
  ["RT2", [[SM, "  const _ADVANCE_TYPES = [\"ddjp.dj.play\", \"ddjp.dj.skip\", \"ddjp.media.skip\"];", "  const _ADVANCE_TYPES = [\"ddjp.dj.play\", \"ddjp.dj.skip\"];"]],
    IS, "FAIL — D4: RUNNING OUT AT A SKIP IS LEAVING (ddjp.media.skip)", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[IX, "    .log-line.lvl-warn { color: #d9a441; }\n", "    .log-line.lvl-warn { color: #d9a441; }\n\n"]], LF, "", "GREEN"],
  ["N2", [[SW, "        if (typeof Logger !== 'undefined' && Logger && Logger.warn) {", "        if (typeof Logger !== 'undefined' && Logger && Logger.warn) {\n"]], SR, "", "GREEN"],
  ["N3", [[SM, "  for (const t of _ADVANCE_TYPES) AFFECTS_ROTATION[t] = 1;\n", "\n  for (const t of _ADVANCE_TYPES) AFFECTS_ROTATION[t] = 1;\n"]], IS, "", "GREEN"],
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
