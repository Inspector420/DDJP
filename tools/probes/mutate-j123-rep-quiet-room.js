// tools/probes/mutate-j123-rep-quiet-room.js
// SUBJECT: J123 (`ddjp_643`) — the owner's one rule at `ddjp_642`, on `ddjp_640`'s REP: the bot re-sends an unchanged summary at
// 1.5 intervals (C12) ONLY IF SOMETHING HAPPENED IN THE ROOM SINCE ITS LAST SUMMARY — the room's log at a newer position than
// when that summary went, REP's own summaries and additions aside, the highest position seen kept across a move-on's drop and
// stored with the summary across a reload; a summary from an older build (no position kept) re-sends as at 640.
// (C12's line taken out is J84's BS3, re-anchored on purpose at `ddjp_643`.) Held by `check-rep-bot` E and `check-shared-room` C
// (each changed on purpose, the owner's rule).
// One row per site, each naming the failure it must cause in its guard, and a control per guard. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j123-rep-quiet-room.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RB = "features/rep-bot.js";
const BT = "check-rep-bot", SR = "check-shared-room";
const ALWAYS = "    if (age >= RepRules.LIMITS.refreshFactor * I && _happened(s, last)) return";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // Q1 — the rule gone: the re-send at 1.5 intervals whatever happened (640's C12).
  ["Q1", [[RB, ALWAYS, "    if (age >= RepRules.LIMITS.refreshFactor * I) return"]], BT, "FAIL — E: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND", "RED"],
  ["Q1b", [[RB, ALWAYS, "    if (age >= RepRules.LIMITS.refreshFactor * I) return"]], SR, "FAIL — C: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND", "RED"],
  // Q2 — never anything happened: the re-send never goes.
  ["Q2", [[RB, "  function _happened(s, last) { return typeof last.headL !== \"number\" || _headNow(s) > last.headL; }", "  function _happened(s, last) { return false; }"]],
    BT, "FAIL — E: SOMETHING HAPPENED, REP UNCHANGED → THE RE-SEND GOES", "RED"],
  ["Q2b", [[RB, "  function _happened(s, last) { return typeof last.headL !== \"number\" || _headNow(s) > last.headL; }", "  function _happened(s, last) { return false; }"]],
    SR, "FAIL — C: SOMETHING HAPPENED, REP UNCHANGED → THE RE-SEND GOES", "RED"],
  // Q3 — REP's own messages counted as something happening: every re-send makes the next.
  ["Q3", [[RB, "      if (!e || typeof e.l !== \"number\" || e.type === RepRules.TYPES.summary || e.type === RepRules.TYPES.addition) continue;", "      if (!e || typeof e.l !== \"number\") continue;"]],
    BT, "FAIL — E: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND", "RED"],
  ["Q3b", [[RB, "      if (!e || typeof e.l !== \"number\" || e.type === RepRules.TYPES.summary || e.type === RepRules.TYPES.addition) continue;", "      if (!e || typeof e.l !== \"number\") continue;"]],
    SR, "FAIL — C: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND", "RED"],
  // Q4 — only what is held now: an act a bot room's move-on dropped is forgotten.
  ["Q4", [[RB, "    let n = (typeof s.headSeen === \"number\") ? s.headSeen : -1;", "    let n = -1;"]], BT, "FAIL — E: IN A BOT ROOM'S SHAPE", "RED"],
  // Q5 — not sampled at every look: an act dropped before the 1.5 point was never seen.
  ["Q5", [[RB, "    _headNow(s);   // every look: what the room's log holds now (the owner's rule, `ddjp_642`)\n", ""]], BT, "FAIL — E: IN A BOT ROOM'S SHAPE", "RED"],
  // Q6 — the position not kept with the summary: every summary reads as an older build's, and re-sends.
  ["Q6", [[RB, "        headL: headL };", "        };"]], BT, "FAIL — E: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND", "RED"],
  // Q7 — not stored across a reload.
  ["Q7", [[RB, "          headL: (typeof t.last.headL === \"number\") ? t.last.headL : null };", "          headL: null };"]], BT, "FAIL — E: RELOADED, A QUIET ROOM STAYS QUIET", "RED"],
  // Q8 — an older build's table read as "nothing happened": its first re-send never goes.
  ["Q8", [[RB, "  function _happened(s, last) { return typeof last.headL !== \"number\" || _headNow(s) > last.headL; }", "  function _happened(s, last) { return typeof last.headL === \"number\" && _headNow(s) > last.headL; }"]],
    BT, "FAIL — E: A TABLE FROM AN OLDER BUILD", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["C1", [[RB, "  function _headNow(s) {", "  function _headNow(s)  {"]], BT, "", "GREEN"],
  ["C2", [[RB, "  function _happened(s, last) {", "  function _happened(s, last)  {"]], SR, "", "GREEN"],
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
