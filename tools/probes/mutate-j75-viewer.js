// tools/probes/mutate-j75-viewer.js
// SUBJECT: J75 — the People tab from each viewer's own view. Each row undoes ONE ruled behaviour, confirms the edit LANDED,
// runs `check-viewer-chat` and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
// Not a row: the room-switch reset (`_vc.tiers = ...; _vc.gen++`). Tier ids are room ids, so a new room's tiers never match
// the old room's, and dropping lost tiers already empties the record (an in-flight read for a dropped tier is ignored too)
// — the reset changes no answer, so no guard can tell it is gone. It stays as a defence.
//   node tools/probes/mutate-j75-viewer.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", PN = "ui/panels.js", VC = "check-viewer-chat";
const ROWS = [
  ["V1", RM, "    for (const id of Object.keys(_vc.tiers)) if (!(id in want)) delete _vc.tiers[id];         // losing access drops its records\n", "", VC, "FAIL — D:", "RED"],
  ["V3", RM, "      if (t.coveredFrom === null || t.coveredFrom > since) _vcRead(id, since);               // opening, a tier gained, a wider window\n", "      if (t.coveredFrom === null) _vcRead(id, since);\n", VC, "FAIL — F: a wider window", "RED"],
  ["V4", RM, "      for (const u of Object.keys(t.people)) if (t.people[u] < now - longest) delete t.people[u];   // self-cleaning\n", "", VC, "FAIL — H:", "RED"],
  ["V5", RM, "      if (t.coveredFrom === null || t.coveredFrom > since) unknown.push(t.name);             // \"can't fully tell\" for this tier\n", "", VC, "FAIL — A: on opening", "RED"],
  ["V6", RM, "    if (!chatCounts) return Object.assign({}, f, { source: \"own\", chatSeen: false, unknownTiers: [] });\n", "", VC, "FAIL — E: with chat not counted", "RED"],
  ["V7", RM, "if (typeof ts === \"number\" && !(t.people[raw.sender] >= ts)) t.people[raw.sender] = ts;", "if (typeof ts === \"number\") t.people[raw.sender] = { ts: ts, body: raw.content && raw.content.body };", VC, "FAIL — B:", "RED"],
  ["V8", PN, "unobservable: f.chatSeen ? (\"counts chat you can see\"", "unobservable: f.chatSeen ? (\"chat isn't counted here\"", VC, "FAIL — A: and the label reads", "RED"],
];
let planted = null;
function restore() { if (planted) { fs.writeFileSync(planted.file, planted.original); planted = null; } }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect, want] of ROWS) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the line is unreachable, as recorded"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected no change; the 'unreachable' claim is wrong"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
