// tools/probes/mutate-j137-runner-rank.js
// SUBJECT: J137 — the bot room's runner follows this account's rank while the tab is in the room
// (`backends/backend2/transport.js` `_runnerFollowsRank`, on the shared transport's `onRankChange`), held by
// `check-runner-rank`. Live, `?v=605`: the Bot rank given while the bot's tab was in the room played no song until a reload.
// One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must
// stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j137-runner-rank.js            every row
//   node tools/probes/mutate-j137-runner-rank.js RR1 RR3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const TR = "backends/backend2/transport.js";
const RUN = "backends/backend2/runner.js";
const G = "check-runner-rank";
const HOOK = "B1MatrixBridge.onRankChange(_runnerFollowsRank);";
const STILL = "    if (still) return;";
const GATE = "    try { still = B2Runner.isRunner(log) === true; } catch (e) { still = false; }";
const MODE = '  if (mode !== "backend2") return;\n  const log = _channels.events_owner;';
const LIVE = "    if (_mayAuthor()) _goLive();\n    return { ok: true };";
const LEVEL = "    try { level = B1MatrixBridge.getMyPowerLevel(log); } catch (e) { level = null; }";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["RR1", [[TR, HOOK, "void _runnerFollowsRank;"]],
    G, "A: AT THE LOG CHANNEL'S STEP THE RUNNER STARTS — without a reopen", "RED"],   // the engine no longer hears a rank change: 605's runner
  ["RR2", [[TR, STILL, "    return;"]],
    G, "C (log last): STOPPED AT THE LOG CHANNEL'S STEP, and stays stopped", "RED"],   // the stop half gone: a lowered bot runs on
  ["RR3", [[TR, MODE, '  if (mode !== "backend2") return;\n  { const k = B1MatrixBridge.getUserEffectiveRank(null, _channels, B1MatrixBridge.getUserId()); ' +
      'if (k === _runnerFollowsRank.k) return; _runnerFollowsRank.k = k; }\n  const log = _channels.events_owner;']],
    G, "A: AT THE LOG CHANNEL'S STEP THE RUNNER STARTS — without a reopen", "RED"],   // asked once per change of the room-level rank
    // (`features/room.js`'s own dedupe): the max moves at the first channel's step, the log channel's comes later and is skipped
  ["RR4", [[TR, GATE, "    try { still = B2Runner.isRunner(_spaceId) === true; } catch (e) { still = false; }"]],
    G, "C (log last): RUNNING UNTIL THE LOG CHANNEL'S STEP LANDS", "RED"],   // the stop reads the SPACE's level: stops at the first step
  ["RR5", [[RUN, LIVE, "    _goLive();\n    return { ok: true };"]],
    G, "D: BUT IT WRITES NOTHING UNTIL THE TAB IS LIVE — no announcement while loading", "RED"],   // started while loading, it announces at once
  ["RR6", [[TR, HOOK, "B1MatrixBridge.onRankChange(function () { if (Math.random() < 2) return; _runnerFollowsRank(); });"]],
    G, "A: AT THE LOG CHANNEL'S STEP THE RUNNER STARTS — without a reopen", "RED"],   // subscribed, and never acting: a hook that applies nothing
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[TR, MODE, "  const log = _channels.events_owner;"]], G, "", "GREEN"],   // the engine check gone: `start`'s own refusal holds a shared room and the lobby
  ["G2", [[TR, LEVEL, "    try { level = MatrixBridge.getMyPowerLevel(log); } catch (e) { level = null; }"]], G, "", "GREEN"],   // the same reader, through the bound shell
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
// The journal file is the run's own; one this run created and left empty is removed at the end, so a copy the file ran
// in comes back byte for byte (HANDOVER §4). A journal still holding entries is never removed.
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark] of ROWS) {
  if (want.length && want.indexOf(id) < 0) continue;
  // PLANNED IN MEMORY FIRST: every anchor must occur exactly once in the bytes it will be applied to, or nothing is written.
  const files = new Map();
  let voided = null;
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    if (!files.has(file)) { const o = fs.readFileSync(file, "utf8"); files.set(file, { rel, original: o, mutated: o }); }
    const f = files.get(file);
    const n = f.mutated.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel + ": " + JSON.stringify(oldS.slice(0, 60)); break; }
    const next = f.mutated.replace(oldS, () => newS);
    if (next === f.mutated) { voided = "the edit changed nothing in " + rel; break; }
    f.mutated = next;
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  const handles = [];
  let out = "", code = 0, landed = true, held = true;
  try {
    for (const [file, f] of files) {
      const h = J.open("mutate-j137-runner-rank:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
      out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
      held = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);   // still there as the result is read
    }
  } finally { for (const h of handles) h.restore(); }
  const restored = [...files].every(([file, f]) => sha(fs.readFileSync(file, "utf8")) === sha(f.original));
  if (!restored) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (!landed) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
  if (!held) { console.log("VOID  " + id + " — an edit was gone by the time the result was read"); bad++; continue; }
  if (wantMark === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else {
      bad++;
      const first = (out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160);
      console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (first ? " — got " + first : "") + (v.why ? " (" + v.why + ")" : ""));
    }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected green: " + ((out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160))); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
