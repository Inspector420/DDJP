// tools/probes/mutate-j82-room-files.js
// SUBJECT: J82 — room files removed in both room types (the owner's rulings 1, 2, 7 and 9). Each row plants its edit(s), confirms
// every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored
// after every row, and checked restored.
//   F1–F15  each brings back ONE piece of what J82 removed — a control, a verb, the reading side — and `check-no-room-files` names it.
//   H1–H4   the re-measured and re-aimed holds: `floorChain` (B.2, now `check-catchup-reentry` H), the refold before the licence
//           (`check-adopt-refold`, re-aimed to an ordinary floor), the no-drop trim's retire (`check-cache-held` C, re-aimed) and
//           the licence keyed to its floor (`check-forget-licence-floor`, re-aimed).
//   O3      moved from `mutate-j28-origin` (retired: O1 and O2's subject, history's non-start origin, went): the walk to the room's
//           first floor, re-aimed at a room never restored (`check-catchup-reentry` H).
//   K1, K6, K7  the owner's three breaks that held nothing at `ddjp_575`, each held now.
//   N1      the control.
//   node tools/probes/mutate-j82-room-files.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", AC = "features/actions.js", BK = "core/backends.js", CAP = "backends/backend1/capabilities.js";
const B1S = "backends/backend1/streammanager.js", CF = "backends/backend1/checkpointformat.js", SD = "backends/backend1/statederiver.js";
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js";
const B2S = "backends/backend2/streammanager.js", B2C = "backends/backend2/checkpoint.js", RN = "backends/backend2/runner.js";
const G = "check-no-room-files", CR = "check-catchup-reentry", RL = "check-room-leave", JS = "check-join-step";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── WHAT J82 REMOVED, BROUGHT BACK ONE PIECE AT A TIME ──
  ["F1", [["index.html", "  <div id=\"room-list\"></div>\n", "  <div id=\"room-list\"></div>\n  <div id=\"export-section\" style=\"display:none;\"></div>\n"]],
    G, "FAIL — A: the lobby has no `#export-section`", "RED"],
  ["F2", [[RM, "    create, pendingCreate,", "    create, createFromFile: create, pendingCreate,"]],
    G, "FAIL — B (shared room): `Room.createFromFile` does not exist", "RED"],
  ["F3", [[AC, "    \"room.settings\": { verb: \"room.settings\", run: (a) => Room.setSettings(a.partial) },\n",
    "    \"room.settings\": { verb: \"room.settings\", run: (a) => Room.setSettings(a.partial) },\n    \"room.restore\":  { verb: \"room.restore\",  run: () => null },\n"]],
    G, "FAIL — B (shared room): `room.restore` is not an action", "RED"],
  // F4 RE-ANCHORED AT J84-1 (the reason): `bot.command` joined the target-free verbs, so the list's end moved; the mutant is the same.
  ["F4", [[CAP, "\"room.settings\", \"room.invite\", \"bot.command\"];", "\"room.settings\", \"room.invite\", \"bot.command\", \"room.restore\"];"]],
    G, "FAIL — B (shared room): nor a capability verb", "RED"],
  ["F5", [[BK, "resolveMode, planFor, describe, active, modes,", "resolveMode, planFor, describe, forFileMode: () => null, active, modes,"]],
    G, "FAIL — B (shared room): the seam maps no file mode to an engine", "RED"],
  ["F6", [[B1S, "    defaultSettings, blockedReasons,\n", "    defaultSettings, blockedReasons, importFile: () => null,\n"]],
    G, "FAIL — B (shared room): the bound engine has no `StreamManager.importFile`", "RED"],
  ["F7", [[CF, "  return { TYPE, fingerprint, verify, cutOf, coversOf, laterInLog };", "  return { TYPE, fingerprint, verify, cutOf, coversOf, laterInLog, FILE_VERSION: 1 };"]],
    G, "FAIL — B: the format has no `FILE_VERSION`", "RED"],
  ["F8", [[B2C, "  return { TYPE, reset, observe, verify, seal, floor,", "  return { TYPE, reset, observe, verify, seal, restore: () => null, floor,"]],
    G, "FAIL — B: `B2Checkpoint.restore` is gone", "RED"],
  ["F9", [[RN, "    _maybeSeal /* exposed for the guard */, sealDue };", "    _maybeSeal /* exposed for the guard */, sealDue, restoreAdopted: () => null };"]],
    G, "FAIL — B: the runner has no `restoreAdopted`", "RED"],
  ["F10", [[HI, "    if (!o || typeof o.l !== \"number\" || o.start !== true) return;\n", "    if (!o || typeof o.l !== \"number\") return;\n"]],
    G, "FAIL — B: song history records no origin but the room's start", "RED"],
  // THE READING SIDE (ruling 9, B1).
  ["F11", [[SD, "        if (!s || typeof s !== \"object\") { _rej(ev, \"settings-not-an-object\"); continue; }\n",
    "        if (!s || typeof s !== \"object\") { _rej(ev, \"settings-not-an-object\"); continue; }\n        if (c.restore === true) { _rej(ev, \"not-permitted\"); continue; }\n"]],
    G, "FAIL — C1: a settings event carrying `restore: true` is applied like any other", "RED"],
  ["F12", [[B1S, "    if (_trimmedBelow !== null) {\n", "    if (_trimmedBelow !== null || (f && !f.prev && f.thin === true)) {\n"]],
    G, "FAIL — C2: its seed is checked against the room's own fold from the start", "RED"],
  ["F13", [[B2C, "    if (_held.some((h) => (id !== null && h.id === id) || (h.cp && h.cp.h === cp.h))) {\n",
    "    if (!cp.prev && cp.thin === true && !(meta && meta.owner === true)) return { adopted: false, why: \"only the room's owner restores\" };\n" +
    "    if (_held.some((h) => (id !== null && h.id === id) || (h.cp && h.cp.h === cp.h))) {\n"]],
    G, "FAIL — C3: a save point with the old origin pair, carried by the bot, is adopted by its count", "RED"],
  ["F14", [[CF, "    }, cp.h);\n", "    }, cp.h) || (cp.era !== undefined && ConsensusHash.verify({ n: cp.n, prev: cp.prev || null, seed: cp.seed, " +
    "floorL: cp.floorL, thin: cp.thin === true, covers: cp.covers, era: cp.era }, cp.h));\n"]],
    G, "FAIL — C4: a restart-1 save point (its `era` committed) does not verify", "RED"],
  ["F15", [[B2C, "floorL: floorL, thin: false, covers: covers, h: h } };", "floorL: floorL, thin: false, covers: covers, h: h, era: 0 } };"]],
    G, "FAIL — D: the bot's save point is sealed with the six committed fields", "RED"],
  // ── THE RE-MEASURED AND RE-AIMED HOLDS ──
  ["H1", [[B2S, "    floorChain,               // J79: the chain song history reads\n", ""], [B2S, "  function floorChain() {", "  function _floorChainUnused() {"]],
    CR, "FAIL — H: the TRIMMED device — truth = device", "RED"],
  ["H2", [[B1S, "    if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; _refold(); }\n", "    if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; }\n"]],
    "check-adopt-refold", "FAIL — adopting a floor did not re-derive from it", "RED"],
  ["H3", [[B1S, "    if (kept.length === before) { _raiseBoundary(t.floorL, _bid); _retireCached(); return 0; }",
    "    if (kept.length === before) { _raiseBoundary(t.floorL, _bid); return 0; }"]],
    "check-cache-held", "FAIL — C: a licensed trim that dropped nothing from the held log", "RED"],
  ["H4", [[B1S, "      if (!sig || v.sig !== sig) return false;\n", "      if (!sig) return false;\n"]],
    "check-forget-licence-floor", "FAIL — the forget licence earned for one floor", "RED"],
  ["O3", [[MB, "    let ev = []; try { ev = await pageRange(0, c[0].l); } catch (e) { ev = []; }\n", "    let ev = [];\n"]],
    CR, "FAIL — H: so the joining device found the room's first floor by paging", "RED"],
  // ── THE OWNER'S BREAKS THAT HELD NOTHING AT `ddjp_575` ──
  ["K1", [[MB, "        if (!v || v.verdict !== \"channel\" || !v.verified || v.room !== spaceId) {\n", "        if (!v || v.verdict !== \"channel\" || !v.verified) {\n"]],
    JS, "FAIL — S5b: A's opening pass does NOT join room B's channel", "RED"],
  ["K6", [[RM, "[\"UserQueue\", () => { if (typeof UserQueue !== \"undefined\" && UserQueue.destroy) UserQueue.destroy(); }],", "[\"UserQueue\", () => {}],"]],
    RL, "FAIL — B: the personal queue's settle timer is CLEARED by the leave", "RED"],
  ["K7", [[RM, "[\"Skip\", () => { if (typeof Skip !== \"undefined\" && Skip.destroy) Skip.destroy(); }],", "[\"Skip\", () => {}],"]],
    RL, "FAIL — B: the leave ENDS the skip's watch", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[CF, "const CheckpointFormat = (() => {\n", "const CheckpointFormat = (() => {\n\n"]], G, "", "GREEN"],
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
