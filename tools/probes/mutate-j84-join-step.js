// tools/probes/mutate-j84-join-step.js
// SUBJECT: J84-1, the owed join-step item (the owner's quick live check at `?v=528`: six join-step passes in five seconds
// right after opening, each "an invite or membership changed", nothing joined). A burst of room-list changes arms ONE
// request (`features/room.js` `_joinSoon`); a trigger that only checks for work — that request, and the "the room is open"
// catch-up — runs its pass only when the same pass, run dry, would join something (`matrixbridge.js` `joinRoomChannels`,
// `_joinPassOnce(…, dry)`). One row per site, each naming the failure it must cause in `check-join-step`, and the control.
// Each row plants its edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j84-join-step.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", RM = "features/room.js";
const JS = "check-join-step";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // JS1 — THE FINDING BACK: a room-list change runs its pass at once, unchecked, as before J84-1.
  ["JS1", [[RM, "    _joinSoon(\"an invite or membership changed\");\n  }\n", "    _runJoinStep(\"an invite or membership changed\");\n  }\n"]],
    JS, "FAIL — J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING", "RED"],
  // JS2 — no coalescing: every room-list change arms its own request.
  ["JS2", [[RM, "    if (_joinSoonTimer) return;\n", ""]],
    JS, "FAIL — J2: SIX ROOM-LIST CHANGES IN A BURST ARM ONE REQUEST", "RED"],
  // JS3 — the request goes unchecked: the burst's one pass runs whether or not it would join anything.
  ["JS3", [[RM, "_runJoinStep(why, { ifWouldJoin: true }); }, JOIN_COALESCE_MS);", "_runJoinStep(why); }, JOIN_COALESCE_MS);"]],
    JS, "FAIL — J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING", "RED"],
  // JS4 — the catch-up at the room's opening goes unchecked: a "the room is open" pass with nothing to join.
  ["JS4", [[RM, "    _runJoinStep(\"the room is open\", { ifWouldJoin: true });\n", "    _runJoinStep(\"the room is open\");\n"]],
    JS, "FAIL — J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING", "RED"],
  // JS5 — the bridge ignores the question: every pass runs.
  ["JS5", [[MB, "        if (ifWouldJoin && !opening) {\n", "        if (false) {\n"]],
    JS, "FAIL — J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING", "RED"],
  // JS6 — the dry pass speaks: a line for every check.
  ["JS6", [[MB, "    const line = (tail) => { if (!dry) Logger.info(", "    const line = (tail) => { if (true) Logger.info("]],
    JS, "FAIL — J1: AN OPENING, THEN SIX BURSTS OF ROOM-LIST CHANGES THAT BRING NOTHING", "RED"],
  // JS7 — the dry pass ACTS: it joins, silently, and the pass that would have said so is skipped.
  ["JS7", [[MB, "      if (!dry) return _joinChannelOf(id, spaceId, wanted, invited);\n", "      return _joinChannelOf(id, spaceId, wanted, invited);\n"]],
    JS, "FAIL — J2: when it fires, ONE pass takes the work the burst brought, and its line says so", "RED"],
  // JS8 — a coalesced pass is skipped when ANY request checked for work (a change that names itself skipped with it).
  ["JS8", [[MB, "      if (!o.ifWouldJoin) st.more.ifWouldJoin = false;\n", "      if (o.ifWouldJoin) st.more.ifWouldJoin = true;\n"],
    [MB, "promise: p, resolve: res, ifWouldJoin: true };", "promise: p, resolve: res, ifWouldJoin: false };"]],
    JS, "FAIL — J3: A RANK THAT ARRIVES WITH A ROOM-LIST CHANGE WHILE A PASS RUNS", "RED"],
  // JS9 — a coalesced pass is never checked: a room-list change during a pass that brings nothing still adds one.
  ["JS9", [[MB, "promise: p, resolve: res, ifWouldJoin: true };", "promise: p, resolve: res, ifWouldJoin: false };"]],
    JS, "FAIL — J3: ROOM-LIST CHANGES WHILE A PASS RUNS, BRINGING NOTHING, ADD NO PASS", "RED"],
  // JS10 — a channel that gave up counts as nothing to join: it is never tried again by a room-list change.
  ["JS10", [[MB, "      if (!_joinInFlight.has(id)) would++;\n", "      if (!_joinInFlight.has(id) && !_joinWaiting.has(id)) would++;\n"]],
    JS, "FAIL — J4: A CHANNEL THAT GAVE UP", "RED"],
  // JS11 — the leave forgets the pending request: it fires in the lobby.
  ["JS11", [[RM, "    _joinSoonCancel();   // a room-list change's pending join request goes with the room (J84-1)\n", ""]],
    JS, "FAIL — J5: THE LEAVE CANCELS IT", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[RM, "  const JOIN_COALESCE_MS = 250;\n", "  const JOIN_COALESCE_MS = 250;\n\n"]], JS, "", "GREEN"],
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
