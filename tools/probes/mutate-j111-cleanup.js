// tools/probes/mutate-j111-cleanup.js
// SUBJECT: J111 (`ddjp_608`) — the three guards that leaned on finished roadmap entries stand without them.
// `check-roadmap-gate` C drives its scan at a fixture of both entry shapes and checks the live scan against the census
// (it held two floors on entry counts). `check-rule-homes` judged both entry shapes and drove its gate at a fixture (it
// held four floors on closed entries); it left the suite at `ddjp_617`, and its matcher is the drain tool
// `tools/homes-for.js`, held by `check-homes-for`: it pairs its delimiters, resolves by a five-word run, and does not read
// the entry being drained as that entry's home.
// `check-doc-xrefs` A reads POINTERS to entries ("its entry", "roadmap" and an id) and lets a bare job number stand as a
// label (it required every `Jnn`/`vNNN` token in code to exist somewhere in the docs); since the last batch (`ddjp_612`) it
// exempts no pointer and reads one across a comment's line break. Each RED row breaks one of those and
// must turn its guard red NAMING it; each GREEN row is measured to leave it alone; each control changes nothing.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j111-cleanup.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
// The doc tree is found the way the guards find it, never by a literal `docs_NNN`; a row's file is relative to this tree.
const DOCROOT = require(path.join(ROOT, "tests", "_docs.js")).docRoots().filter((d) => fs.existsSync(path.join(d, "main", "09-roadmap.md")))[0];
if (!DOCROOT) { console.log("ABORT — no doc tree with main/09-roadmap.md beside this one"); process.exit(2); }
const ROADMAP = path.relative(ROOT, path.join(DOCROOT, "main", "09-roadmap.md"));
const RG = "check-roadmap-gate", HF = "check-homes-for", HFT = "tools/homes-for.js", DX = "check-doc-xrefs";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", options].
const ROWS = [
  // RG1 — the scan stops reading prose-shaped entries: the fixture of both shapes must catch it.
  ["RG1", [["tests/check-roadmap-gate.js", "const JOB_RE = /^(?:#### (J\\d+)\\b|\\*\\*(J\\d+) — )/gm;", "const JOB_RE = /^(?:#### (J\\d+)\\b)/gm;"]],
    RG, "FAIL — C: the scan must read BOTH entry shapes", "RED"],
  // RG2 — the census stops reading prose-shaped entries: the scan and the census disagree, and C says so.
  ["RG2", [["journal/entry-list.js", "const RE = /^(?:#### (J\\d+)\\b|\\*\\*(J\\d+) — )/gm;", "const RE = /^(?:#### (J\\d+)\\b)/gm;"]],
    RG, "FAIL — C: the scan must read the entries the census reads", "RED"],
  // RH1–RH7 retired (`ddjp_617`): `check-rule-homes` left the suite (the owner's decision). Its matcher is the drain tool
  // `tools/homes-for.js` now, held by `check-homes-for`, and these rows break what that self-test holds.
  // HF1 — the matcher resolves everything: the claim from words no file contains must be refused, and is not.
  ["HF1", [[HFT, "  return function resolves(claim) {\n", "  return function resolves(claim) {\n    return true;\n"]],
    HF, "FAIL — a claim from the corpus must resolve and one from words no file contains must not", "RED"],
  // HF2 — the extractor takes the wrong segments: the prose between two bold spans is read as a claim, and the bold
  // sentence after it is not (the delimiter desync).
  ["HF2", [[HFT, "for (let i = 1; i < parts.length; i += 2) {", "for (let i = 2; i < parts.length; i += 2) {"]],
    HF, "FAIL — the bold sentence after a short label must be the one claim", "RED"],
  // HF3 — the entry being drained is read as its own home: every rule in it would resolve.
  ["HF3", [[HFT, 'text += rm.slice(0, entry.start) + "\\n" + rm.slice(entry.start + entry.text.length) + "\\n";', 'text += rm + "\\n";']],
    HF, "FAIL — both entry shapes must be found, each bounded at the next entry or §7, and the corpus must leave out the entry", "RED"],
  // XA1 — the collector stops reading the "roadmap Jnn" shape: the fixture of every pointer shape must catch it.
  // (Re-anchored at J111's last batch, `ddjp_612`: the shapes are built from one GAP now.)
  ["XA1", [["tests/check-doc-xrefs.js", '  new RegExp(String.raw`\\broadmap` + "`?,?" + GAP + "(?:entry" + GAP + String.raw`)?(J\\d{1,3})\\b`, "g"),\n', ""]],
    DX, "FAIL — PART A control: the collector must read every pointer shape and no bare label", "RED"],
  // XA2 — a pointer to a deleted entry put back in an application file: nothing is exempt, so it is refused by name.
  // (Re-aimed at J111's last batch, `ddjp_612`: it read the held list, which went with its last pointer. The planted text
  // is split in this source, so the probe file is not itself a dangling pointer.)
  ["XA2", [["backends/backend1/settingsproof.js", "J35 asked whether", "J35" + "'s entry asked whether"]],
    DX, "points at a roadmap entry that does not exist", "RED"],
  // XA3 — a pointer may wrap: with the GAP back to one literal space, the fixture's wrapped pointers are not read
  // (`rep-reader.js` pointed at a deleted entry, J84, across a comment's line break, and this guard read nothing there).
  ["XA3", [["tests/check-doc-xrefs.js", 'const GAP = String.raw`(?:\\s|\\/\\/|\\*)+`;', 'const GAP = " ";']],
    DX, "FAIL — PART A control: the collector must read every pointer shape and no bare label", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [["tests/check-roadmap-gate.js", "const ON_GATE = ", "const ON_GATE =  "]], RG, "", "GREEN"],
  ["N2", [[HFT, "function sentencesIn(body) {", "function sentencesIn(body) {   "]], HF, "", "GREEN"],
  ["N3", [["tests/check-doc-xrefs.js", "const danglingA = pointed.filter(", "const danglingA =  pointed.filter("]], DX, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want, opts] of ROWS) {
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
    let v = redAsNamed(code, out, expect);
    if (v.mark === "RED" && opts && opts.noPass && /^\[[\w-]+\] PASS/m.test(out)) v = { mark: "WRONG", why: "it printed PASS after its failure" };
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — " + (opts && opts.equivalent ? "an equivalent edit, measured (see its comment)" : "the control")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
