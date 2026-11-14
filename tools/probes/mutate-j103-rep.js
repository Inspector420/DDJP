// tools/probes/mutate-j103-rep.js
// SUBJECT: J103 — REP's three fixes (the owner's rulings 44–46, `ddjp_598`): a rebuild counts as far back as it looked
// (`features/rep-bot.js` `rebuild`, `_fromOwn`, `_unread` — since J117 the owner's Rebuild, over the days chosen); a shared room's send answers
// the summary's event id and the bot side records it (`backends/backend1/matrixbridge.js` `sendSide`, `rep-bot.js`
// `_sendSummary`); one list of a side message's reserved fields, the transport's, handed to REP's readers
// (`matrixbridge.js` `sideReserved` and the refusal beside it, `sideRefusal`; `features/rep-ports.js` `sideReserved`;
// `features/rep-rules.js` `readSummary` / `readAddition`; the reader and the bot side). One row per site, each naming
// the failure it must cause in its guard, and the controls. Each row plants its edit(s), confirms every one LANDED,
// runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after
// every row, and checked restored.
//   node tools/probes/mutate-j103-rep.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RB = "features/rep-bot.js", RR = "features/rep-rules.js", RP = "features/rep-ports.js", RD = "features/rep-reader.js";
const MB = "backends/backend1/matrixbridge.js";
const BT = "check-rep-bot", RU = "check-rep-rules", PO = "check-rep-ports", BD = "check-rep-boundary", SM = "check-side-messages", RE = "check-rep-reader";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── RULING 44: A REBUILD COUNTS AS FAR BACK AS IT LOOKED ──
  // LF1 — the rebuild is handed the window again, not the days looked back over. RE-AIMED AT J117 (the reason): the rebuild
  // is the owner's Rebuild over the days chosen; the row hands its count the window instead.
  ["LF1", [[RB, "(plan ? _fromOwn(s, plan, now, W)", "(plan ? _fromOwn(s, plan, now, s.windowMs)"]],
    BT, "FAIL — Q: A REBUILD COUNTS OVER THE DAYS CHOSEN", "RED"],
  // LF2, LF3 WENT WITH J117 (the reason): they broke Look further back's days kept for its search, and its retry — Look
  // further back went (the owner's answer 3, `ddjp_624`), and a Rebuild that cannot read is never tried again on its own.
  // LF4 — the rebuild no longer says what it did not read. RE-ANCHORED AT J117 (the reason): what it says is kept for the preview too.
  ["LF4", [[RB, "      _unread(\"the rebuild\", low.pos, g, W, unread);\n", ""]],
    BT, "FAIL — Q: A REBUILD THAT LEAVES A STRETCH UNREAD SAYS SO", "RED"],
  // LF5 — the stretch older than the days looked back is left out in silence again.
  ["LF5", [[RB, "    else if (g.byTime && g.reachedFrom > fromL) _log(", "    else if (false) _log("]],
    BT, "FAIL — Q: A REBUILD THAT LEAVES A STRETCH UNREAD SAYS SO", "RED"],
  // ── RULING 45: THE SUMMARY'S ID FROM THE SEND ──
  // ID1 — the bot side ignores the id the send answered: it waits on the echo again.
  ["ID1", [[RB, "      t.last = { n: n, at: now, id: (typeof res.eventId === \"string\" && res.eventId) ? res.eventId : null, named: kept,",
    "      t.last = { n: n, at: now, id: null, named: kept,"]], BT, "FAIL — Q: THE SUMMARY'S ID IS TAKEN FROM THE SEND'S ANSWER", "RED"],
  // ID2 — a shared room's send drops the id the homeserver gave.
  ["ID2", [[MB, "    try { const sent = await sendEvent(owner, type, body); return { ok: true, eventId: (sent && typeof sent.eventId === \"string\" && sent.eventId) ? sent.eventId : null }; }",
    "    try { await sendEvent(owner, type, body); return { ok: true }; }"]], SM, "FAIL — F: and answers the event id the homeserver gave it", "RED"],
  // ── RULING 46: ONE LIST OF A SIDE MESSAGE'S RESERVED FIELDS ──
  // RL1 — REP's rules keep a copy of the list again.
  ["RL1", [[RR, "  const STAMPED = Object.freeze([\"t\", \"l\", \"dv\", \"hv\"]);\n",
    "  const STAMPED = Object.freeze([\"t\", \"l\", \"dv\", \"hv\"]);\n  const RESERVED = Object.freeze([\"t\", \"l\", \"dv\", \"hv\", \"p\", \"pHash\", \"w\", \"og\", \"actor\", \"rank\", \"src\", \"at\", \"also\", \"evs\"]);\n"]],
    BD, "FAIL — G: NO REP FILE KEEPS ITS OWN COPY", "RED"],
  // RL2 — the rules read a list of their own instead of the one handed in.
  ["RL2", [[RR, "  function _noReserved(b, reserved) { for (const k of reserved) if (_own(b, k)) return false; return true; }",
    "  function _noReserved(b, reserved) { for (const k of [\"t\", \"l\", \"actor\"]) if (_own(b, k)) return false; return true; }"]],
    RU, "FAIL — F: every field in the transport's list is refused", "RED"],
  // RL3 — handed no list, a summary is read unchecked.
  ["RL3", [[RR, "  function readSummary(body, reserved) {\n    const b = body;\n    if (!b || typeof b !== \"object\" || Array.isArray(b)) return { ok: false, why: \"not an object\" };\n    if (!Array.isArray(reserved)) return { ok: false, why: \"no reserved-field list\" };",
    "  function readSummary(body, reserved) {\n    const b = body;\n    if (!b || typeof b !== \"object\" || Array.isArray(b)) return { ok: false, why: \"not an object\" };\n    if (!Array.isArray(reserved)) reserved = [];"]],
    RU, "FAIL — F: HANDED NO LIST, A SUMMARY OR AN ADDITION IS REFUSED", "RED"],
  // RL4 — the reader hands its rules no list: every summary refused, no device shows a number.
  ["RL4", [[RD, "    const reserved = RepPorts.sideReserved();", "    const reserved = null;"]],
    RE, "FAIL — A: and caught up, it looks back and shows the bot's numbers", "RED"],
  // RL5 — the bot side's rebuild hands its rules no list: its own summaries read as refused.
  ["RL5", [[RB, "    const reserved = RepPorts.sideReserved();", "    const reserved = null;"]],
    BT, "FAIL — K: THE SAME NUMBERS AS BEFORE", "RED"],
  // RL6 — the port hands on nothing.
  ["RL6", [[RP, "const v = MB().sideReserved(); return Array.isArray(v) ? v.slice() : null; }", "const v = MB().sideReserved(); return null; }"]],
    PO, "FAIL — B: sideReserved passes the transport's list through", "RED"],
  // RL7 — the transport hands out its own list, not a copy.
  ["RL7", [[MB, "  function sideReserved() { return SIDE_RESERVED.slice(); }", "  function sideReserved() { return SIDE_RESERVED; }"]],
    SM, "FAIL — F: and it hands out a copy", "RED"],
  // RL8 — the refusal and the list handed out come apart: one field is refused no more.
  ["RL8", [[MB, "    for (const k of SIDE_RESERVED) if (Object.prototype.hasOwnProperty.call(body, k)) return \"reserved field \" + k;",
    "    for (const k of SIDE_RESERVED.filter((x) => x !== \"evs\")) if (Object.prototype.hasOwnProperty.call(body, k)) return \"reserved field \" + k;"]],
    SM, "FAIL — F: THE ONE LIST", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[RB, "  function _unread(what, fromL, g, W, said) {\n", "\n  function _unread(what, fromL, g, W, said) {\n"]], BT, "", "GREEN"],
  ["N2", [[RR, "  function _noReserved(b, reserved) {", "\n  function _noReserved(b, reserved) {"]], RU, "", "GREEN"],
  ["N3", [[MB, "  function sideReserved() { return SIDE_RESERVED.slice(); }", "\n  function sideReserved() { return SIDE_RESERVED.slice(); }"]], SM, "", "GREEN"],
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
