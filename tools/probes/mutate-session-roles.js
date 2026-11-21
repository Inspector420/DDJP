// tools/probes/mutate-session-roles.js
// SUBJECT: the session roles (`ddjp_732`, the owner's: `HANDOVER.md` §4, the session roles) — the front door's "Which
// session role are you?" naming each role and its page, the pages in `session-roles/` with the same seven sections, none
// an index and none on README's reading order. Held by `check-session-roles`. One row per way it could go wrong, each
// naming the failure it must cause; the controls change nothing that matters and must stay green. And (`ddjp_733`) the
// supervisor's page giving the SDK build its destination, `npm run build:vendor -- lib`, held by `check-vendor-build` B
// since the reviewer's guide that carried it was removed: SR17, with SR18 its control.
//
// Every row edits text in the doc tree, found the way the guards find it (`tests/_docs.js`), never by a literal
// `docs_NNN`; no row plants or deletes a file, so the journal covers every edit.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-j.js`, unchanged: each file must hold
// exactly its mutated bytes when the guard starts AND when its result is read, and is restored and checked by hash.
//
//   node tools/probes/mutate-session-roles.js            every row
//   node tools/probes/mutate-session-roles.js SR1 SR5    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const DOCROOT = require(path.join(ROOT, "tests", "_docs.js")).docRoots()
  .filter((d) => fs.existsSync(path.join(d, "START-HERE.md")))[0];
if (!DOCROOT) { console.log("ABORT — no doc tree with START-HERE.md beside this one"); process.exit(2); }
const D = (rel) => path.relative(ROOT, path.join(DOCROOT, rel));
const SH = D("START-HERE.md");
const RM = D("README.md");
const PL = D("session-roles/planner.md");
const SU = D("session-roles/supervisor.md");
const WK = D("session-roles/worker.md");
const CL = D("session-roles/closer.md");
const G = "check-session-roles";
const VB = "check-vendor-build";

const ROWS = [
  // ── A: the front door's choice ──
  ["SR1", [[SH, "- **[Planner](session-roles/planner.md)**", "- **[Planner](session-roles/planer.md)**"]],
    G, "A: the page the front door names for `Planner` does not exist", "RED"],   // a role sent to a page that is not there
  ["SR2", [[SH, "- **[Worker](session-roles/worker.md)** — building from one statement.\n", ""]],
    G, "A: a page in `session-roles/` is not on the front door's choice: `worker.md`", "RED"],   // a page nothing names
  ["SR3", [[SH, "- **[Supervisor](session-roles/supervisor.md)**", "- **[Supervisor](session-roles/worker.md)**"],
    [SH, "- **[Worker](session-roles/worker.md)**", "- **[Worker](session-roles/supervisor.md)**"]],
    G, "A: the front door's choice must name exactly the four session roles", "RED"],   // two roles sent to each other's page
  ["SR4", [[SH, "- **No session role** —", "- **[Reviewer](session-roles/worker.md)** — reviewing.\n- **No session role** —"]],
    G, "A: the front door's choice must name exactly the four session roles", "RED"],   // a fifth role, added beside the ruling
  ["SR5", [[SH, "- **No session role** — orient with the base below.\n", ""]],
    G, "A: the choice must end with `No session role`", "RED"],   // no way in for a session with no role
  ["SR6", [[SH, "- **No session role** —", "- **[No session role](README.md)** —"]],
    G, "A: the choice must end with `No session role`", "RED"],   // "no role" sent to a page of its own
  ["SR7", [[SH, "## Which session role are you?\n", "## Which seat are you?\n"]],
    G, "A: the front door has no `## Which session role are you?` section", "RED"],   // the question renamed away
  // ── B: the seven sections ──
  ["SR8", [[WK, "## When to stop and ask\n", "### When to stop and ask\n"]],
    G, "B: `session-roles/worker.md`'s sections must be the seven, in order", "RED"],   // a section folded into the one above
  ["SR9", [[CL, "## What you are for\n", "## TMP\n"], [CL, "## What you are given\n", "## What you are for\n"],
    [CL, "## TMP\n", "## What you are given\n"]],
    G, "B: `session-roles/closer.md`'s sections must be the seven, in order", "RED"],   // two sections swapped
  ["SR10", [[SU, "\n## Keeping going through restarts\n", "\n## Notes\n\nA page's own extra section.\n\n## Keeping going through restarts\n"]],
    G, "B: `session-roles/supervisor.md`'s sections must be the seven, in order", "RED"],   // an eighth section
  ["SR11", [[PL, "## How to talk to the owner\n\nAs the supervisor's own task: as the supervisor's page says. As a worker's task: through the supervisor, never directly.\n",
    "## How to talk to the owner\n\n"]],
    G, "B: `session-roles/planner.md` has an empty section", "RED"],   // a heading with nothing under it
  // ── C: no index, and a way back ──
  ["SR12", [[WK, "# Session role: Worker\n\n", "# Session role: Worker\n\n**Front door:** [`START-HERE.md`](../START-HERE.md).\n\n"]],
    G, "C: `session-roles/worker.md` declares itself an index", "RED"],   // a fifth index, one defensible file at a time
  ["SR13", [[CL, "Reached from [`START-HERE.md`](../START-HERE.md) §Which", "Reached from `START-HERE.md` §Which"]],
    G, "C: `session-roles/closer.md` does not link back to the front door", "RED"],   // a page that strands its reader
  // ── D: not required reading ──
  ["SR14", [[RM, "> 7. **[`INVENTORY.md`](INVENTORY.md)**",
    "> 7. **[`session-roles/worker.md`](session-roles/worker.md)** — the worker's page.\n> 8. **[`INVENTORY.md`](INVENTORY.md)**"]],
    G, "D: a session-role page is on README's reading order", "RED"],   // a role's page made every session's reading
  // ── controls: nothing that matters changes ──
  ["SR15", [[SH, "- **[Worker](session-roles/worker.md)** — building from one statement.\n",
    "- **[Worker](session-roles/worker.md)** — building from one statement.\n\n"]],
    G, "", "GREEN"],   // a blank line inside the choice
  ["SR16", [[WK, "You build from one statement:", "You build from a single statement:"]],
    G, "", "GREEN"],   // a sentence reworded inside a page
  // ── the supervisor's page gives the SDK build its destination (`ddjp_733`) ──
  ["SR17", [[SU, "`npm run build:vendor -- lib`", "`npm run build:vendor`"]],
    VB, "B: the supervisor's page gives the destination explicitly", "RED"],   // the bare command: `lib/` stays empty
  ["SR18", [[SU, "the bundle goes elsewhere", "the bundle is built elsewhere"]],
    VB, "", "GREEN"],   // the words around the command reworded, the command kept
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
// The journal file is the run's own; one this run created and left empty is removed at the end, so a copy the file ran
// in comes back byte for byte (HANDOVER §4). A journal still holding entries is never removed.
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark] of ROWS) {
  if (want.length && want.indexOf(id) < 0) continue;
  // PLANNED IN MEMORY FIRST: every anchor must occur exactly once in the bytes it will be applied to, or nothing is written.
  const files = new Map();
  let voided = null;
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    if (!files.has(file)) { const o = fs.readFileSync(file, "utf8"); files.set(file, { rel, original: o, mutated: o }); }
    const f = files.get(file);
    const n = f.mutated.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel + ": " + JSON.stringify(oldS.slice(0, 60)); break; }
    const next = f.mutated.replace(oldS, () => newS);
    if (next === f.mutated) { voided = "the edit changed nothing in " + rel; break; }
    f.mutated = next;
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  const handles = [];
  let out = "", code = 0, landed = true, held = true;
  try {
    for (const [file, f] of files) {
      const h = J.open("mutate-session-roles:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
      out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
      held = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);   // still there as the result is read
    }
  } finally { for (const h of handles) h.restore(); }
  const restored = [...files].every(([file, f]) => sha(fs.readFileSync(file, "utf8")) === sha(f.original));
  if (!restored) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (!landed) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
  if (!held) { console.log("VOID  " + id + " — an edit was gone by the time the result was read"); bad++; continue; }
  if (wantMark === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else {
      bad++;
      const first = (out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160);
      console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (first ? " — got " + first : "") + (v.why ? " (" + v.why + ")" : ""));
    }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected green: " + ((out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160))); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
