// tools/probes/mutate-j110-history.js
// SUBJECT: J110 (`ddjp_607`) — history is temporary. `check-history-budget` refuses history in the tree (a change log,
// `ARCHIVE.md`, a milestone folder, a finished roadmap entry); it was a ceiling on its size until the ceiling reached 0
// (`ddjp_616`), and a rule since (`ddjp_617`). Filing or building a job must never trip it, and finishing one must. With
// no history in the tree, the rule that finds each kind is driven at the guard's fixture. `check-doc-budget` and
// `check-doc-dated` no longer tell a session to move a record into `ARCHIVE.md`. Each RED row grows history, or breaks
// what the guard stands on, and must turn it red NAMING that; each GREEN row is filing or building, measured to leave it
// alone; each control changes nothing.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j110-history.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
// The doc tree is found the way the guards find it, never by a literal `docs_NNN`; a row's file is relative to this tree.
const DOCROOT = require(path.join(ROOT, "tests", "_docs.js")).docRoots().filter((d) => fs.existsSync(path.join(d, "main", "09-roadmap.md")))[0];
if (!DOCROOT) { console.log("ABORT — no doc tree with main/09-roadmap.md beside this one"); process.exit(2); }
const D = (rel) => path.relative(ROOT, path.join(DOCROOT, rel));
const HB = "check-history-budget", HBT = "tests/check-history-budget.js";
const FOUND = "FAIL — THE TREE HOLDS HISTORY";
const KINDS = "FAIL — the rules that find history must each find their own kind";
const ROADMAP = D("main/09-roadmap.md");
// J99's heading, an open entry (re-anchored at `ddjp_631`, when it was built: "built, one live check owed" is still open).
const J99 = "#### J99 — A second account signed in on the same page inherits the first one's session log — built (`ddjp_631`, `?v=564`), one live check owed";
// An open entry's heading (re-anchored at J111's last batch, `ddjp_612`: the row used J109's, a finished entry, now deleted;
// and again at `ddjp_621`, when J104 closed: J114's, open).
const OPEN = "#### J114 — Two ideas from the owner's bot-room test:";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", options].
const ROWS = [
  // HB1 — the rule that finds ARCHIVE.md stops: the guard's fixture tree must catch it. (It planted a section into
  // ARCHIVE.md until that went, `ddjp_615`.)
  ["HB1", [[HBT, 'if (fs.existsSync(path.join(docsRoot, "ARCHIVE.md"))) out.push(', 'if (fs.existsSync(path.join(docsRoot, "ARCHIVZ.md"))) out.push(']], HB, KINDS, "RED"],
  // HB2 — the rule that finds a change log stops matching one: the fixture must catch it. (It planted into a change log
  // until they went, `ddjp_614`.)
  ["HB2", [[HBT, "filter((f) => /^changes-.*\\.md$/.test(f))", "filter((f) => /^changez-.*\\.md$/.test(f))"]], HB, KINDS, "RED"],
  // HB3 — the rule that finds a milestone folder stops: the fixture must catch it. (It grew a named record until the last
  // went, `ddjp_616`; the list of records went with the ceiling, `ddjp_617`.)
  ["HB3", [[HBT, 'const ms = path.join(docsRoot, "milestones");', 'const ms = path.join(docsRoot, "milestonez");']], HB, KINDS, "RED"],
  // HB4 — an open job is marked DONE and kept: its entry is history, and is named.
  ["HB4", [[ROADMAP, J99, J99.replace("— built (`ddjp_631`, `?v=564`), one live check owed", "— DONE (a later package)")]], HB, FOUND + ": the roadmap's finished entry J99", "RED"],
  // HB5 retired (`ddjp_617`): it broke the check that a record's `from` line is still there, which went with the list of
  // records when the ceiling became a rule.
  // HB6 — the guard stops reading the entries the census reads (it misses the prose-shaped ones).
  ["HB6", [[HBT, "const JOB_RE = /^(?:#### (J\\d+)\\b|\\*\\*(J\\d+) — )/gm;", "const JOB_RE = /^(?:#### (J\\d+)\\b)/gm;"]], HB, "FAIL — APPLIED — this guard reads the roadmap's entries exactly as the census does", "RED"],
  // HB7 — FILING a job, placed before another entry: measured to make no history.
  ["HB7", [[ROADMAP, OPEN, "#### J9998 — a job a break row files\n\n**Kind.** `ui`. Open.\n\n" + OPEN]], HB, "", "GREEN", { equivalent: true }],
  // HB8 — BUILDING a job, its entry edited while open: measured to make no history.
  ["HB8", [[ROADMAP, J99, J99 + "\n\nA paragraph a build added."]], HB, "", "GREEN", { equivalent: true }],
  // DB1 — the reading path over budget: the advice is to remove, not to move into a record. Far over, so the row does not
  // depend on how much headroom the path has (it would go green if the path shrank by the planted amount).
  ["DB1", [[D("START-HERE.md"), "## The steps\n", "## The steps\n\n" + "x".repeat(100000) + "\n"]], "check-doc-budget", "what no longer earns its place (START-HERE.md §History is temporary). Moving it into a record", "RED"],
  // DD1 — dated marks over the cap: the same advice. Far over, for the same reason.
  ["DD1", [[D("START-HERE.md"), "## The steps\n", "## The steps\n\n" + "`ddjp_1` ".repeat(200) + "\n"]], "check-doc-dated", "Remove what no longer earns its place (START-HERE.md §History is temporary); do not", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[HBT, "ok(found.length === 0,", "ok(found.length === 0 ,"]], HB, "", "GREEN"],
  ["N2", [["tests/check-doc-budget.js", "const CEILING = ", "const CEILING =  "]], "check-doc-budget", "", "GREEN"],
  ["N3", [["tests/check-doc-dated.js", "ok(total <= CEILING,", "ok(total <= CEILING,   "]], "check-doc-dated", "", "GREEN"],
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
