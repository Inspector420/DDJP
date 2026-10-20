// tools/probes/mutate-j89-shared-room.js
// SUBJECT: J89, fixes from the owner's live run on `?v=537`. (1) A rewire of the running room (a rank change, a late channel,
// an upgrade) no longer closes song history's table (`backends/backend1/history.js`): every song after it, by any advance,
// enters history at once. (2) `StreamManager.isLegal` answers `null` — unknown — for an event the fold was not given (never
// ingested, trimmed below a floor, or held below the fold's cut), so REP counts what it can place (`features/rep-reader.js`),
// and says once per song why a reaction did not count. (3) The reader's look-back waits for the room's own settings.
// (39) The chat strip's everyone tier is "All", and the main tier is marked by a small ✓. One row per rule, each naming the
// failure it must cause, and the control. Each row plants its edit(s), confirms every one LANDED, runs the guard and reads
// the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j89-shared-room.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", SM = "backends/backend1/streammanager.js", RD = "features/rep-reader.js", CT = "ui/chat.js";
const SR = "check-shared-room", RR = "check-rep-reader", CT_G = "check-chat-tiers";
const ATTACH = "  function attach(env) { _env = Object.assign({}, _env, env || {}); if (env && env.awaitOpen && _openedEpoch !== _epoch) _opened = false; }\n";
const OPENED = "  function markOpened() { _opened = true; _openedEpoch = _epoch; }\n";
const UNKNOWN = "    return (heldIds && heldIds[id]) ? false : null;\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // SH1 — THE LIVE DEFECT BACK: a re-attach closes the table again, and only the opening opens it.
  ["SH1", [[HI, ATTACH, "  function attach(env) { _env = Object.assign({}, _env, env || {}); if (env && env.awaitOpen) _opened = false; }\n"]],
    SR, "FAIL — A: AND AFTER A RANK CHANGE, EACH STILL ENTERS SONG HISTORY AT ONCE", "RED"],
  // SH2 — THE OPEN STEP NOT REMEMBERED FOR ITS ROOM: the next re-attach closes the table the same way.
  ["SH2", [[HI, OPENED, "  function markOpened() { _opened = true; }\n"]],
    SR, "FAIL — A: AND AFTER A RANK CHANGE, EACH STILL ENTERS SONG HISTORY AT ONCE", "RED"],
  // SH3 — A ROOM CHANGE NO LONGER CLOSES IT: a new room's rows could be written before its origin is known (ddjp_564).
  // (Re-anchored at J97: the reset now also clears the room's checks on the line after.)
  ["SH3", [[HI, " if (_env.awaitOpen) _opened = false;\n    _verified", "\n    _verified"]],
    SR, "FAIL — A: a room change closes the table until its open step", "RED"],
  // SH4 — "NOT HELD" READ AS "REFUSED" AGAIN: the trimmed self-vote is not counted.
  ["SH4", [[SM, UNKNOWN, "    return false;\n"]],
    SR, "FAIL — B: NEVER HELD", "RED"],
  // SH5 — "HELD" MEANING "IN THE LOG" RATHER THAN "GIVEN TO THE FOLD": a vote held below the fold's cut reads as refused.
  ["SH5", [[SM, "    for (const e of (Array.isArray(_full.given) ? _full.given : [])) {", "    for (const e of ordered) {"]],
    SR, "FAIL — B: HELD BELOW THE FOLD'S CUT", "RED"],
  // SH6 — THE READER TAKES UNKNOWN AS REFUSED: the read-back from the cut counts nothing it paged or the trim dropped.
  ["SH6", [[RD, "RepPorts.isLegal(e.eventId) !== false);", "RepPorts.isLegal(e.eventId) === true);"]],
    SR, "FAIL — C: THE SELF-VOTE ON THE CUT'S OWN SONG, TRIMMED BY THE SEAL, IS COUNTED", "RED"],
  // SH7 — THE LOOK-BACK BEFORE THE ROOM'S SETTINGS ARE KNOWN (the default interval, "2 h" in a room set to 10 min).
  ["SH7", [[RD, "    if (!RepPorts.mayAuthor()) { _soon(r); return; }\n", ""]],
    RR, "FAIL — K: STILL CATCHING UP, IT DOES NOT LOOK BACK", "RED"],
  // SH8 — A REACTION THAT CANNOT BE PLACED, SILENT AGAIN.
  ["SH8", [[RD, "    _say(r, e.content.p, \"its song is not in song history yet; it waits\", e);\n", ""]],
    SR, "FAIL — D: A REACTION THAT CANNOT BE PLACED SAYS WHY, ONCE PER SONG", "RED"],
  // SH9 — SAID FOR EVERY REACTION, NOT ONCE PER SONG.
  ["SH9", [[RD, "    if (r.said[k]) return;\n", ""]],
    SR, "FAIL — D: A REACTION THAT CANNOT BE PLACED SAYS WHY, ONCE PER SONG", "RED"],
  // SH10 — THE EVERYONE TIER BACK TO "Everyone" (ruling 39). The guard's first click, on "All", is where it shows.
  ["SH10", [[CT, "      uncategorized: \"All\",", "      uncategorized: \"Everyone\","]],
    CT_G, "FAIL — A: APPLIED — a 'All' button to click", "RED"],
  // SH11 — " (main)" BACK IN THE NAME (ruling 39).
  ["SH11", [[CT, "        label: _chatTierName(t.tier),\n", "        label: _chatTierName(t.tier) + (t.main ? \" (main)\" : \"\"),\n"]],
    CT_G, "FAIL — G: in the resolver's order and with its main marking", "RED"],
  // SH12 — THE ✓ NOT DRAWN (ruling 39).
  ["SH12", [[CT, "t.main ? [H.el(\"span\", { class: \"chat-tier-main\", text: \"\\u2713\", \"aria-label\": \"main\" })] : null);", "null);"]],
    CT_G, "FAIL — G: in the resolver's order and with its main marking", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[HI, OPENED, OPENED + "\n"]], SR, "", "GREEN"],
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
