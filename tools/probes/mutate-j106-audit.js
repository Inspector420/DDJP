// tools/probes/mutate-j106-audit.js
// SUBJECT: J106 (`ddjp_603`) — three guards the owner's audit of `ddjp_601` found missing or reading the wrong thing:
//   · a bot room's transport hands REP the same reserved-field list as a shared room's (`backends/backend2/transport.js`
//     inherits `sideReserved`; held by `tests/check-rep-ports.js` H);
//   · a rebuild says what it left unread past the page limit and how many held events it left out as too old
//     (`features/rep-bot.js` `_unread`; held by `tests/check-rep-bot.js` Q);
//   · the Logs tab's tints are judged by the rule a browser applies, not the first rule naming the line (`index.html`;
//     held by `tests/check-log-filter.js` L).
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j106-audit.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const TR = "backends/backend2/transport.js", RB = "features/rep-bot.js", IX = "index.html", LFT = "tests/check-log-filter.js";
const PO = "check-rep-ports", BO = "check-rep-bot", LF = "check-log-filter";
const CKP = "  getCheckpointChannelId: function (channels) {\n    return (channels && channels.events_owner) || null;\n  },\n";
const CAP = "    if (g.capped) _log(what + \" stopped at l=\"", OLD = "    if (g.heldOld > 0) _log(what + \" left out \"";
const TINT = "    .log-line.lvl-error { color: #e06c6c; }\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── A BOT ROOM'S RESERVED-FIELD LIST ──
  // SR1 — the owner's plant: backend2 answers no list, and REP in a bot room would refuse every summary and addition.
  ["SR1", [[TR, CKP, CKP + "  sideReserved: function () { return null; },\n"]],
    PO, "FAIL — H: A BOT ROOM'S TRANSPORT HANDS REP THE SAME RESERVED-FIELD LIST", "RED"],
  // SR2 — a list, but not the one: backend2 leaves a field out.
  ["SR2", [[TR, CKP, CKP + "  sideReserved: function () { return B1MatrixBridge.sideReserved().slice(1); },\n"]],
    PO, "FAIL — H: A BOT ROOM'S TRANSPORT HANDS REP THE SAME RESERVED-FIELD LIST", "RED"],
  // ── WHAT A REBUILD LEFT UNREAD ──
  // UR1 — the page limit's line goes silent (its text still built, so nothing else, not even lint, notices).
  ["UR1", [[RB, CAP, "    if (g.capped) String(what + \" stopped at l=\""]], BO, "FAIL — Q: A REBUILD STOPPED BY THE PAGE LIMIT SAYS WHERE", "RED"],
  // UR2 — the held-but-too-old line goes silent, the same way.
  ["UR2", [[RB, OLD, "    if (g.heldOld > 0) String(what + \" left out \""]], BO, "FAIL — Q: A REBUILD THAT LEAVES OUT HELD EVENTS SAYS HOW MANY", "RED"],
  // ── THE RULE THAT APPLIES ──
  // LF1 — the owner's plant: a second fresh rule after the tints. A browser shows every fresh warning green.
  ["LF1", [[IX, TINT, TINT + "    .log-line.fresh { color: #6c7; }\n"]], LF, "FAIL — L: A WARNING AND AN ERROR ARE TINTED", "RED"],
  // LF2 — the guard's reading turned back to the first rule of equal weight: its own self-test says so.
  ["LF2", [[LFT, "return a.order >= b.order; };", "return a.order < b.order; };"]], LF, "FAIL — L PREMISE — the reading follows the cascade", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[TR, CKP, CKP + "\n"]], PO, "", "GREEN"],
  ["N2", [[RB, CAP, "\n" + CAP]], BO, "", "GREEN"],
  ["N3", [[IX, TINT, TINT + "\n"]], LF, "", "GREEN"],
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
