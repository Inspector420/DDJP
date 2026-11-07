// tools/probes/mutate-j101-join.js
// SUBJECT: J101's second half (`ddjp_599`) — an opening never waits for the join step's retries (`ddjp_539`), held again by
// `tests/check-join-step.js` S2b after J81 retired `check-channel-join` (`ddjp_574`). The sites: the opening's one call of
// the join step (`features/room.js`, not awaited) and the opening's bounded wait for the children to sync in
// (`backends/backend1/matrixbridge.js` `waitForSpaceChildren`, which counts an invited channel as synced in). J101's first
// half (the seed check's `log-does-not-reach-genesis` case, which could not run and went at `ddjp_600`) is `mutate-j101-seed`'s. Each
// row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j101-join.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", MB = "backends/backend1/matrixbridge.js";
const JS = "check-join-step";
const OPEN = "    MatrixBridge.joinRoomChannels(spaceId, \"opening\", { opening: true, wanted: () => _opening === spaceId || runningRoom() === spaceId });";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // JO1 — J101's own mutation: the opening awaits the join step, so it waits out every retry's backoff.
  ["JO1", [[RM, OPEN, OPEN.replace("    MatrixBridge.", "    await MatrixBridge.")]],
    JS, "FAIL — S2b: AN OPENING NEVER WAITS FOR A RETRY", "RED"],
  // JO2 — the same wait by another road: the children's wait counts only a JOINED channel, so a channel whose join is
  // retrying holds the opening until the wait's cap.
  ["JO2", [[MB, "              if (rid && (client.getRoom(rid) || _joinWaiting.has(rid))) resolved++;",
    "              if (rid && (_joinedNow(rid) || _joinWaiting.has(rid))) resolved++;"]],
    JS, "FAIL — S2b: AN OPENING NEVER WAITS FOR A RETRY", "RED"],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[RM, OPEN, "\n" + OPEN]], JS, "", "GREEN"],
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
