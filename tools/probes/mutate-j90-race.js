// tools/probes/mutate-j90-race.js
// SUBJECT: J90, fixes from the owner's live run on `?v=538`. (1) Song history no longer keeps the LOSER of a same-position
// race (`backends/backend1/history.js`): a row the live refresh wrote that the next fold over the same stretch does not
// produce leaves, and the bridge says so (`backends/backend1/matrixbridge.js`). (3) REP's read-back line says what it counted
// NOW and what was already counted since the cut (`features/rep-reader.js`). (4) The bot side's fill-back and rebuild count
// what they page (unknown to the fold is not refused), and the reader's "the room's fold refused it" line — both untested
// before (`features/rep-bot.js`, `features/rep-reader.js`). One row per rule, each naming the failure it must cause, and the
// control. Each row plants its edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own
// rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j90-race.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", RD = "features/rep-reader.js", RB = "features/rep-bot.js";
const SR = "check-shared-room";
const PRUNE = "    if (opts && opts.src === \"refresh\" && both && both.state && typeof lo === \"number\" && typeof hi === \"number\") {\n";
const PICK = "      for (const r of _entries) if (r && r.src === \"refresh\" && typeof r.l === \"number\" && r.l >= lo && r.l <= hi && !keep.has(r.pi)) removed.push(r);\n";
const SAY = "\" left song history: the room's fold no longer has its play\" +\n";
const READ = "      \" newly counted, \" + Math.max(0, _countedSinceCut(r) - n) + \" already counted since the cut)\");\n";
const FILL = "    const res = RepRules.add(t.fwd, r, playing, t.cut, RepPorts.isLegal(e.eventId) !== false);\n";
const REBUILD = "          const res = RepRules.add(pre, { type: e.type, voter: e.sender, pi: pi }, playing, low, RepPorts.isLegal(e.eventId) !== false);\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // RC1 — THE LIVE DEFECT BACK: nothing leaves; the race's loser stays beside its winner ("1 extra $7FS82… — from refresh").
  ["RC1", [[HI, PRUNE, "    if (false) {\n"]],
    SR, "FAIL — E: SONG HISTORY MATCHES THE FOLD, WHICHEVER PLAY ARRIVED FIRST (no floor yet)", "RED"],
  // RC2 — ANY PATH'S ROW: a row verify or the trim wrote, that the live fold happens not to produce, would go too.
  ["RC2", [[HI, PICK, PICK.replace("r.src === \"refresh\" && ", "")]],
    SR, "FAIL — E: ONLY A ROW REFRESH WROTE, INSIDE THE STRETCH IT FOLDED, LEAVES", "RED"],
  // RC3 — BELOW THE STRETCH: a row under the fold's cut, which the fold cannot speak for, would go.
  ["RC3", [[HI, PICK, PICK.replace("r.l >= lo && ", "")]],
    SR, "FAIL — E: ONLY A ROW REFRESH WROTE, INSIDE THE STRETCH IT FOLDED, LEAVES", "RED"],
  // RC4 — ABOVE THE STRETCH.
  ["RC4", [[HI, PICK, PICK.replace(" && r.l <= hi", "")]],
    SR, "FAIL — E: ONLY A ROW REFRESH WROTE, INSIDE THE STRETCH IT FOLDED, LEAVES", "RED"],
  // RC5 — EVERY WRITER PRUNES: a backfill's page is not the held log, and would remove what it did not read.
  ["RC5", [[HI, PRUNE, PRUNE.replace("opts.src === \"refresh\" && ", "")]],
    SR, "FAIL — E: and only the live refresh removes", "RED"],
  // RC6 — A FOLD THAT DID NOT RUN PRUNES: its empty answer would empty the stretch.
  ["RC6", [[HI, PRUNE, PRUNE.replace("both && both.state && ", "")]],
    SR, "FAIL — E: and a fold that did not run removes nothing", "RED"],
  // RC7 — SILENT: the row leaves and nothing says so (a swap leaves the count, and its line, as they were).
  ["RC7", [[MB, SAY, "\"\" +\n"]],
    SR, "FAIL — E: AND IT IS SAID, ONCE, ON THE TAB THAT HAD SHOWN IT (no floor yet)", "RED"],
  // RC8 — THE REASON NOT NAMED: "another play at l=… comes first in the room's order".
  // RC8 RE-ANCHORED AT J91: the same-position reason now follows the save point's (ruling 41) on the line below it.
  ["RC8", [[MB, "          : (x.samePos ? ", "          : (false ? "]],
    SR, "FAIL — E: AND IT IS SAID, ONCE, ON THE TAB THAT HAD SHOWN IT (no floor yet)", "RED"],
  // RW1 — THE OLD WORDING BACK: one number, "counted forward", that read as a failure.
  ["RW1", [[RD, READ, "      \" vote(s) and save(s) counted forward)\");\n"]],
    SR, "FAIL — C: THE SELF-VOTE ON THE CUT'S OWN SONG, TRIMMED BY THE SEAL, IS COUNTED", "RED"],
  // RW2 — "ALREADY" COUNTING WHAT WAS JUST COUNTED: the self-vote read back would show as both new and already counted.
  ["RW2", [[RD, READ, READ.replace("Math.max(0, _countedSinceCut(r) - n)", "_countedSinceCut(r)")]],
    SR, "FAIL — C: THE SELF-VOTE ON THE CUT'S OWN SONG, TRIMMED BY THE SEAL, IS COUNTED", "RED"],
  // RW3 — SAVES LEFT OUT of what was already counted.
  ["RW3", [[RD, " + Object.keys(p.s || {}).length;", ";"]],
    SR, "FAIL — C: A READ-BACK THAT FINDS NOTHING NEW SAYS WHAT WAS ALREADY COUNTED SINCE THE CUT", "RED"],
  // RB1 — THE BOT'S FILL-BACK TAKES "UNKNOWN" AS REFUSED (the supervisor's J89 check: this stayed green).
  ["RB1", [[RB, FILL, FILL.replace("!== false", "=== true")]],
    SR, "FAIL — F: THE FILL-BACK COUNTS A VOTE IT PAGED FROM THE ROOM", "RED"],
  // RB2 — THE BOT'S REBUILD TAKES "UNKNOWN" AS REFUSED, for a person whose row is older than the newest summary.
  ["RB2", [[RB, REBUILD, REBUILD.replace("!== false", "=== true")]],
    SR, "FAIL — F: THE REBUILD COUNTS, FOR A PERSON WITH AN OLDER ROW", "RED"],
  // RB3 — A REACTION THE FOLD REFUSED, SILENT (the supervisor's J89 check: this line had no test).
  ["RB3", [[RD, "    else if (res.why === \"not eligible\") _say(r, pi, \"the room's fold refused it\", e);\n", ""]],
    SR, "FAIL — D: A REACTION THE ROOM'S FOLD REFUSED SAYS SO, ONCE PER SONG", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[HI, PRUNE, PRUNE + "\n"]], SR, "", "GREEN"],
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
