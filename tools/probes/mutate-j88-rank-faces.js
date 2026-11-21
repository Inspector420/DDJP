// tools/probes/mutate-j88-rank-faces.js
// SUBJECT: J88, the People tab and rank colours (the owner's rulings 36 and 37, from the live run on `?v=536`). (37) The
// human owner (100, above the ladder) is orange, the bot (99, the top rung) pink, every other rank its own colour; the
// split is made once (`ui/base.js` `_rankFace`) and every coloured name reads it. (36) The People row has no rank label;
// `<n> REP` sits on the right where the tag was, and nothing when no number is held; an inactive row is dimmed, but never
// through its name. One row per rule, each naming the failure it must cause, and the control. Each row plants its
// edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule (`_verdict.js`);
// everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j88-rank-faces.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const BA = "ui/base.js", RO = "ui/roster.js", CH = "ui/chat.js", PL = "ui/player.js", IX = "index.html";
const RF = "check-rank-faces", PT = "check-people-tab", WH = "check-who-is-here", AL = "check-authority-level";
const COLOR = "  function rankColor(level) { return _rankFace(level).color; }\n";
const NAME = "  function rankName(level) { return _rankFace(level).name; }\n";
const OWNER_BRANCH = "    if (typeof level === \"number\" && level > _BOT_LEVEL) return { name: \"Owner\", color: _OWNER_COLOR };\n";
const BOT_BRANCH = "    if (level === _BOT_LEVEL) return { name: \"Bot\", color: _BOT_COLOR };\n";
const REP_PUSH = "      if (b && b.text) kids.push(H.el(\"span\", { class: \"person-rep\", text: b.text }));\n";
const ROW = "      const row = H.el(\"div\", { class: \"person\" + (it.active ? \"\" : \" inactive\") }, kids);\n";
// RE-AIMED AT J89 (the owner's ruling 38): an inactive row is greyed as a whole again, as before J88, the name included;
// J88's rows below planted against the opposite rule (the name never dimmed) and now plant against this one.
const INACTIVE = "    .roster-box .person.inactive { opacity: 0.55; }";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // RF1 — THE LIVE DEFECT BACK: the colour looked up by rung again, so the owner's 100, in no list, falls back to grey.
  ["RF1", [[BA, COLOR, "  function rankColor(level) { const r = RANKS.find(x => x.level === level); return r ? r.color : \"#9CA3AF\"; }\n"]],
    RF, "FAIL — A: THE HUMAN OWNER (100, above the ladder) IS ORANGE", "RED"],
  // RF2 — THE BOT PAINTED THE OWNER'S ORANGE in the one split.
  ["RF2", [[BA, BOT_BRANCH, "    if (level === _BOT_LEVEL) return { name: \"Bot\", color: _OWNER_COLOR };\n"]],
    RF, "FAIL — A: THE BOT (99, the top rung) IS PINK", "RED"],
  // RF3 — THE TOP RUNG'S TABLE ENTRY BACK TO ORANGE: a second answer for 99, read by the rank-select table.
  ["RF3", [[BA, "    \"owner\":         { color: _BOT_COLOR },", "    \"owner\":         { color: _OWNER_COLOR },"]],
    RF, "FAIL — A: the RANKS table's top rung is the bot's pink", "RED"],
  // RF4 — A MIDDLE RANK LOSES ITS COLOUR: staff falls back to grey.
  ["RF4", [[BA, "    \"staff\":         { color: \"#3B82F6\" },  // deep blue\n", ""]],
    RF, "FAIL — A: EVERY OTHER RANK KEEPS ITS COLOUR — level 60", "RED"],
  // RF5 — THE BOT'S PINK TAKEN BY A RANK'S COLOUR: two ranks one colour.
  ["RF5", [[BA, "  const _BOT_COLOR     = \"#EC4899\";", "  const _BOT_COLOR     = \"#7C3AED\";"]],
    RF, "FAIL — A: COLOURS TELL RANKS APART", "RED"],
  // RF6 — THE NAME SPLITS ON ITS OWN AGAIN, as before J88: it reads right, and is the second place the colour then misses.
  ["RF6", [[BA, NAME, "  function rankName(level) {\n    if (typeof level === \"number\" && level > _BOT_LEVEL) return \"Owner\";\n    if (level === _BOT_LEVEL) return \"Bot\";\n    const r = RANKS.find((x) => x.level === level);\n    return r ? r.name : (\"L\" + level);\n  }\n"]],
    RF, "FAIL — B: `rankName` and `rankColor` both read it", "RED"],
  // RF7 — THE COLOUR SPLITS ON ITS OWN, over the one split.
  ["RF7", [[BA, COLOR, "  function rankColor(level) { if (level === _BOT_LEVEL) return _BOT_COLOR; return _rankFace(level).color; }\n"]],
    RF, "FAIL — B: and neither splits levels of its own", "RED"],
  // RF8 — A CALLER KEEPS A RANK COLOUR OF ITS OWN: chat paints the top levels itself.
  ["RF8", [[CH, "    const color = H.rankColor(level);\n", "    const color = level >= 99 ? \"#E8890C\" : H.rankColor(level);\n"]],
    RF, "FAIL — C: NO ui/ FILE KEEPS A RANK COLOUR OF ITS OWN", "RED"],
  // RF9 — A CALLER STOPS COLOURING BY RANK: the player's name in one colour for everyone.
  ["RF9", [[PL, "    const color = H.rankColor(H._rosterLevel(djId));\n", "    const color = \"#ffffff\";\n"]],
    RF, "FAIL — C: THE PLAYER COLOURS A NAME BY RANK", "RED"],
  // RF10 — AVATAR INITIALS NOT BY RANK.
  ["RF10", [[BA, "    const color = rankColor(_rosterLevel(userId));\n", "    const color = \"#9CA3AF\";\n"]],
    RF, "FAIL — D: AVATAR INITIALS TOO", "RED"],
  // RF11 — THE RANK LABEL BACK ON THE PEOPLE ROW.
  ["RF11", [[RO, ROW, ROW + "      row.appendChild(H.el(\"span\", { class: \"rank-tag\", text: H.rankName(member.level) }));\n"]],
    RF, "FAIL — D: NO RANK LABEL ON ANY ROW", "RED"],
  // RF12 — the same, read by the People list's own guard.
  ["RF12", [[RO, ROW, ROW + "      row.appendChild(H.el(\"span\", { class: \"rank-tag\", text: H.rankName(member.level) }));\n"]],
    WH, "FAIL — I: NO RANK PICKER IN PEOPLE", "RED"],
  // RF13 — REP BACK BEFORE THE NAME (ruling 27's place).
  ["RF13", [[RO, REP_PUSH, "      if (b && b.text) kids.splice(1, 0, H.el(\"span\", { class: \"person-rep\", text: b.text }));\n"]],
    RF, "FAIL — D: `<n> REP` IS ON THE RIGHT", "RED"],
  // RF14 — the same, read by the People tab's guard.
  ["RF14", [[RO, REP_PUSH, "      if (b && b.text) kids.splice(1, 0, H.el(\"span\", { class: \"person-rep\", text: b.text }));\n"]],
    PT, "FAIL — B: `<n> REP` IN ITS OWN ELEMENT, ON THE RIGHT", "RED"],
  // RF15 — A PLACEHOLDER WHERE NO NUMBER IS HELD.
  ["RF15", [[RO, REP_PUSH, "      kids.push(H.el(\"span\", { class: \"person-rep\", text: (b && b.text) || \"0 REP\" }));\n"]],
    RF, "FAIL — D: NOTHING THERE WHEN THIS DEVICE HOLDS NO NUMBER", "RED"],
  // RF16 — AN INACTIVE ROW NOT GREYED AT ALL (rulings 34, 38).
  ["RF16", [[IX, INACTIVE, "    .roster-box .person.inactive { }"]],
    RF, "FAIL — E: AN INACTIVE ROW IS GREYED AS A WHOLE, AS BEFORE J88", "RED"],
  // RF17 — THE NAME LIFTED OUT OF THE GREY (J88's look, which ruling 38 replaces).
  ["RF17", [[IX, INACTIVE, INACTIVE + "\n    .roster-box .person.inactive .who { opacity: 1; }"]],
    RF, "FAIL — E: AND THE NAME WITH IT", "RED"],
  // RF18 — GREYED, BUT NOT AS BEFORE J88 (a lighter grey).
  ["RF18", [[IX, INACTIVE, "    .roster-box .person.inactive { opacity: 0.8; }"]],
    RF, "FAIL — E: AN INACTIVE ROW IS GREYED AS A WHOLE, AS BEFORE J88", "RED"],
  // RF19 — not greyed, read by the People tab's guard (the number greys with the row).
  ["RF19", [[IX, INACTIVE, "    .roster-box .person.inactive { }"]],
    PT, "FAIL — C: an inactive row is greyed as a whole", "RED"],
  // RF20 — REP NOT PUSHED RIGHT.
  ["RF20", [[IX, "white-space: nowrap; flex-shrink: 0; margin-left: auto; }", "white-space: nowrap; flex-shrink: 0; }"]],
    RF, "FAIL — E: REP IS PUSHED TO THE RIGHT", "RED"],
  // RF21 — J88'S LOOK PLANTED BACK: the dim on the row's parts other than the name, and a darker background.
  ["RF21", [[IX, INACTIVE, "    .roster-box .person.inactive { background: #151515; border-color: #222; }\n    .roster-box .person.inactive > :not(.who) { opacity: 0.55; }"]],
    RF, "FAIL — E: AN INACTIVE ROW IS GREYED AS A WHOLE, AS BEFORE J88", "RED"],
  // RF22 — THE SPLIT AT THE WRONG RUNG: the bot read as the owner (`>=`), held by the label's guard too.
  ["RF22", [[BA, OWNER_BRANCH, OWNER_BRANCH.replace("level > _BOT_LEVEL", "level >= _BOT_LEVEL")]],
    AL, "FAIL — E: ABOVE the top rung is the human owner", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[BA, COLOR, COLOR + "\n"]], RF, "", "GREEN"],
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
