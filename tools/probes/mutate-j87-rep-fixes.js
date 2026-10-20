// tools/probes/mutate-j87-rep-fixes.js
// SUBJECT: J87, REP fixes from the owner's first live run in a bot room (`?v=535`). (1) Every number REP sends is a whole
// number: `features/rep-ports.js` `serverNow` floors the half-millisecond clock; `features/rep-bot.js` floors a stored or
// imported `since` and drops a stored last summary whose serial was not whole. (2) In REP the bot is a normal user: the
// bot side publishes itself like anyone, the reader reports it like anyone, and the chat read-back counts this client's
// own messages. One row per rule, each naming the failure it must cause, and the control. Each row plants its edit(s),
// confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is
// restored after every row, and checked restored.
//   node tools/probes/mutate-j87-rep-fixes.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RP = "features/rep-ports.js", RB = "features/rep-bot.js", RD = "features/rep-reader.js", MB = "backends/backend1/matrixbridge.js";
const BT = "check-rep-bot", PO = "check-rep-ports", RR = "check-rep-reader", R1 = "check-read-back-one";
const FLOOR = "      return (typeof t === \"number\" && isFinite(t)) ? Math.floor(t) : null;\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // WF1 — THE LIVE DEFECT BACK: the port hands on the half-millisecond clock, so a summary's serial is not whole.
  ["WF1", [[RP, FLOOR, "      return (typeof t === \"number\" && isFinite(t)) ? t : null;\n"]],
    BT, "FAIL — P: EVERY SUMMARY AND ADDITION IT SENDS PASSES REPRULES' OWN READERS", "RED"],
  // WF2 — the same, read at the port itself.
  ["WF2", [[RP, FLOOR, "      return (typeof t === \"number\" && isFinite(t)) ? t : null;\n"]],
    PO, "FAIL — B: SERVER TIME IN WHOLE MILLISECONDS", "RED"],
  // WF3 — A STORED `since` FROM THE OLD CLOCK KEPT AS IT IS: every summary would carry it, and readers refuse it.
  ["WF3", [[RB, "      out.since = (typeof t.since === \"number\" && isFinite(t.since)) ? Math.floor(t.since) : null;", "      out.since = (typeof t.since === \"number\") ? t.since : null;"]],
    BT, "FAIL — P: A TABLE STORED ON `?v=535`", "RED"],
  // WF4 — A STORED LAST SUMMARY NO DEVICE COULD READ KEPT: the next message is an addition under it, which readers refuse.
  ["WF4", [[RB, "      if (t.last && typeof t.last.n === \"number\" && Math.floor(t.last.n) === t.last.n && typeof t.last.at === \"number\") {",
    "      if (t.last && typeof t.last.n === \"number\" && typeof t.last.at === \"number\") {"]],
    BT, "FAIL — P: A TABLE STORED ON `?v=535`", "RED"],
  // WF5 — AN IMPORTED FILE'S `since` FROM THE OLD CLOCK KEPT: the summary after the Replace carries it.
  ["WF5", [[RB, "      since: (typeof o.since === \"number\" && isFinite(o.since)) ? Math.floor(o.since) : null, rows: rows,", "      since: (typeof o.since === \"number\") ? o.since : null, rows: rows,"]],
    BT, "FAIL — P: A FILE EXPORTED ON `?v=535`", "RED"],
  // WF6 — THE BOT LEAVES ITSELF OUT AGAIN of the active list it publishes.
  ["WF6", [[RB, "    for (const p of view.people) if (p && typeof p.userId === \"string\" && active.indexOf(p.userId) < 0) active.push(p.userId);",
    "    for (const p of view.people) if (p && typeof p.userId === \"string\" && p.userId !== s.me && active.indexOf(p.userId) < 0) active.push(p.userId);"]],
    BT, "FAIL — P: ACTIVE IN ITS OWN VIEW, IT IS PUBLISHED", "RED"],
  // WF7 — the same, read by every device: the bot has no number anywhere.
  ["WF7", [[RB, "    for (const p of view.people) if (p && typeof p.userId === \"string\" && active.indexOf(p.userId) < 0) active.push(p.userId);",
    "    for (const p of view.people) if (p && typeof p.userId === \"string\" && p.userId !== s.me && active.indexOf(p.userId) < 0) active.push(p.userId);"]],
    RR, "FAIL — J: ACTIVE IN ITS OWN VIEW, THE BOT IS IN ITS OWN SUMMARY", "RED"],
  // WF8 — THE READER SKIPS THE SUMMARY'S SENDER AGAIN: the bot, active with no row, is not reported.
  ["WF8", [[RD, "      if (typeof u !== \"string\" || pub[u] || r.noRow[u]) continue;", "      if (typeof u !== \"string\" || u === r.sum.sender || pub[u] || r.noRow[u]) continue;"]],
    RR, "FAIL — E: and so is the bot, active here with no row of its own", "RED"],
  // WF9 — THE CHAT READ-BACK SKIPS THIS CLIENT'S OWN MESSAGES AGAIN: the bot's own chat out of the bot's own view.
  ["WF9", [[MB, "      if ((ty !== \"m.room.message\" && ty !== \"m.room.encrypted\") || !who || typeof ts !== \"number\") continue;\n        if (!(who in out.people)",
    "      if ((ty !== \"m.room.message\" && ty !== \"m.room.encrypted\") || !who || who === getUserId() || typeof ts !== \"number\") continue;\n        if (!(who in out.people)"]],
    R1, "FAIL — C: `readBackActivity` answers { ok, people, reachedTs, complete }", "RED"],
  // WF10 — A SPECIAL CASE FOR THE BOT IN COUNTING: its own votes and saves left out.
  ["WF10", [[RB, "    if (!e || !RepRules.kindOf(e.type)) return false;\n    const r = { type: e.type, voter: e.sender, pi: e.content && e.content.p };",
    "    if (!e || !RepRules.kindOf(e.type) || e.sender === s.me) return false;\n    const r = { type: e.type, voter: e.sender, pi: e.content && e.content.p };"]],
    BT, "FAIL — P: THE BOT'S VOTES AND SAVES COUNT LIKE ANYONE'S", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[RP, FLOOR, FLOOR + "\n"]], BT, "", "GREEN"],
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
