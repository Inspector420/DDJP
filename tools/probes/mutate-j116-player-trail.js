// tools/probes/mutate-j116-player-trail.js
// SUBJECT: the two diagnostic lines a new song's path to playing is read by (`ui/player.js`, `ddjp_627`: the owner's "black for
// about 5 seconds on almost every new song"), and the protection the investigation found against a seek during a load
// (`features/playback.js`: no push in a song's first 15 s carries its elapsed time). It has no job of its own; it is filed with
// J116, the live-check job the owner's reports arrive with, as the genesis line is. Each row undoes one piece and must turn
// `check-player-trail` red NAMING it; the control changes a branch no guard reaches and must leave it green.
//   PT1 — the PLAYING line at every PLAYING, an unpause too.   PT2 — the state handler does not note the load's states.
//   PT3 — the load's ask is not recorded.                    PT4 — the seek's caller gives no reason.
//   PT5 — the seek line takes the seek's place (the player is not seeked).   PT6 — the load is asked something new.
//   PT7 — the room's tick pushes its elapsed time inside the first 15 s, so the 10 s check can seek during a load.
//   PTc — the control: the wording for a seek with no reason, which no caller makes.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j116-player-trail.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const PL = "ui/player.js", PB = "features/playback.js", G = "check-player-trail";
const PLUG = "ui/songplayer.js";   // the 10 s check and its seek line are the plug's since `ddjp_714` (re-anchored then)
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["PT1", [[PL, "if (!_loadAsk || _loadAsk.done) return;", "if (!_loadAsk) return;"]], G, "FAIL — A2: an unpause later is not a load", "RED"],
  ["PT2", [[PL, "    try { _noteLoadState(word, t); } catch (x) {}   // the load's own line at its first \"playing\" (diagnostic only)\n", ""]],
    G, "FAIL — A1: the first \"playing\" after a load says", "RED"],
  ["PT3", [[PL, "    _loadAsk = { pi: w.pi || null, vid: w.songKey, at: Date.now(), start: Math.max(0, elapsed), states: [], done: false };   // diagnostic only\n", ""]],
    G, "FAIL — A1: the first \"playing\" after a load says", "RED"],
  ["PT4", [[PLUG, "\"the player at \" + _f1(t) + \" s, the room at \" + _f1(at) + \" s: more than \" + DRIFT_S + \" s apart (sought to \" + _f1(at) + \" s\" +", "\"sought\" +"]],
    G, "FAIL — A3: a seek says where to, why, and how long after its load", "RED"],
  ["PT5", [[PLUG, "                try { h.seek(at); } catch (x) {}\n", ""]],
    G, "FAIL — A4: and the player is asked exactly what it was before", "RED"],
  ["PT6", [[PL, "    player.load(w.songKey, Math.max(0, elapsed));", "    player.load(w.songKey, Math.round(Math.max(0, elapsed)));"]],
    G, "FAIL — A PREMISE — the new play is loaded once, with exactly the arguments", "RED"],
  ["PT7", [[PB, "if (_nowMs() - np.startedAt < GRACE_MS) return;", "if (false) return;"]],
    G, "FAIL — B1: in the song's first 15 s nothing the room pushes carries its elapsed time", "RED"],
  ["PTc", [[PLUG, "how long after its load, as the trail always said", "how long after its load, as the trail has always said"]], G, "", "GREEN"],
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
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
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
