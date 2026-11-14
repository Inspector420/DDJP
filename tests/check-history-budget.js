// tests/check-history-budget.js
// SUBJECT: docs/main/09-roadmap.md
//
// ── WHAT THIS HOLDS ─────────────────────────────────────────────────────────────────────────────────────────────────
// The tree holds NO HISTORY. History is temporary (`START-HERE.md` §History is temporary): a session that touches a record
// removes what no longer earns its place, and writes no new history unless something needs it. This guard was a ceiling
// on history's size that could only go down; at step 2 of the clean-up (`ddjp_616`) it reached 0, and a ceiling that
// can only be 0 is a rule, so it became one (the owner's decision, `ddjp_617`). A record something genuinely needs is
// the owner's decision, made by changing this guard.
//
// ── WHAT IS HISTORY, AND NOTHING ELSE ───────────────────────────────────────────────────────────────────────────────
//   · a change log, `journal/changes-*.md`
//   · `ARCHIVE.md`
//   · a milestone folder, `milestones/`
//   · a FINISHED roadmap entry: one the census (`journal/entry-list.js`) calls DONE. A finished job's entry is drained and
//     deleted in the package that finishes it (`HANDOVER.md` §5 rule 6), so the suite never meets one.
// An OPEN entry is never history, so filing a job or building one never trips this; finishing one does, until its entry
// is drained and deleted. That is asserted below on the real roadmap, both ways. A record in a new kind of place (a new
// notes file) is not found here: that is caught only by reading, as before.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, docRoots } = require("./_docs.js");

let failed = 0;
function ok(c, msg, got) {
  if (c) return;
  failed++;
  console.log("[history-budget] FAIL — " + msg + (got === undefined ? "" : "\n      got " + JSON.stringify(got).slice(0, 500)));
}

const DOCS = docRoots().find((d) => fs.existsSync(path.join(d, "main", "09-roadmap.md")));
ok(!!DOCS, "APPLIED — a doc tree with main/09-roadmap.md sits beside this one, or nothing below reads anything", docRoots());
if (!DOCS) { console.log("[history-budget] " + failed + " FAILED"); process.exit(1); }
const ROADMAP = path.join(DOCS, "main", "09-roadmap.md");

// ── THE ROADMAP'S FINISHED ENTRIES, read the census's way ───────────────────────────────────────────────────────────
// Status is the census's heading rule; the extent is the census's (to the next entry or §7). The result is checked
// against the census's own output on the real file, so the two cannot drift apart unseen.
const JOB_RE = /^(?:#### (J\d+)\b|\*\*(J\d+) — )/gm;
function entries(src) {
  const end = src.indexOf("\n## 7. Decisions already made");
  const at = [];
  let m;
  JOB_RE.lastIndex = 0;
  while ((m = JOB_RE.exec(src)) !== null) if (end < 0 || m.index < end) at.push({ id: m[1] || m[2], i: m.index });
  return at.map((e, k) => {
    const body = src.slice(e.i, k + 1 < at.length ? at[k + 1].i : (end < 0 ? src.length : end));
    return { id: e.id, done: /^(?:#### |\*\*)J\d+ —[^\n]*\b(?:DONE|done)\b/.test(body) };
  });
}
const finished = (src) => entries(src).filter((e) => e.done).map((e) => e.id);

const roadmap = fs.readFileSync(ROADMAP, "utf8");
const mine = entries(roadmap);
const census = spawnSync("node", [path.join(ROOT, "journal", "entry-list.js"), ROADMAP], { encoding: "utf8" });
const theirs = (census.stdout || "").trim().split("\n").filter(Boolean).map((l) => { const c = l.split("\t"); return { id: c[0], done: c[3] === "DONE" }; });
ok(census.status === 0 && theirs.length === mine.length && theirs.every((t, k) => t.id === mine[k].id && t.done === mine[k].done),
  "APPLIED — this guard reads the roadmap's entries exactly as the census does (same entries, same order, same status); " +
  "otherwise it is looking for some other set of finished entries", { census: theirs.length, here: mine.length, stderr: census.stderr });
ok(mine.some((e) => !e.done), "APPLIED — the roadmap holds an open entry for the filing control below", mine.length);

// FILING AND BUILDING NEVER TRIP THIS; FINISHING DOES. Driven on the real roadmap, in memory, both ways.
{
  const end = roadmap.indexOf("\n## 7. Decisions already made");
  const filed = "\n\n#### J9999 — a job filed by this guard's control\n\n**Kind.** `ui`. Open.\n";
  const withOpen = roadmap.slice(0, end) + filed + roadmap.slice(end);
  const open = mine.find((e) => !e.done);
  const built = roadmap.replace(new RegExp("^(#### " + open.id + "\\b[^\\n]*\\n)", "m"), "$1\nA paragraph a build added.\n");
  const withDone = roadmap.slice(0, end) + filed.replace("— a job filed", "— DONE: a job filed") + roadmap.slice(end);
  const base = finished(roadmap).join(",");
  ok(finished(withOpen).join(",") === base && finished(built).join(",") === base,
    "filing a job, or building one, must not make history — only finishing one may", { base, filed: finished(withOpen), built: finished(built) });
  ok(finished(withDone).includes("J9999"), "a finished entry must be found as history until it is drained and deleted", finished(withDone));
}

// ── THE OTHER KINDS ─────────────────────────────────────────────────────────────────────────────────────────────────
// One function finds them, run on the real tree and on a fixture tree (below), so each rule is driven though the real
// tree holds none: a rule nothing exercises is not held.
function find(appRoot, docsRoot) {
  const out = [];
  const journal = path.join(appRoot, "journal");
  if (fs.existsSync(journal)) for (const f of fs.readdirSync(journal).filter((f) => /^changes-.*\.md$/.test(f)).sort()) out.push({ what: "journal/" + f });
  if (fs.existsSync(path.join(docsRoot, "ARCHIVE.md"))) out.push({ what: "ARCHIVE.md" });
  const ms = path.join(docsRoot, "milestones");
  if (fs.existsSync(ms)) out.push({ what: "milestones/ (" + fs.readdirSync(ms).sort().join(", ") + ")" });
  return out;
}
// EACH KIND, DRIVEN AT A FIXTURE TREE: a change log, ARCHIVE.md and a milestone folder must each be found by name; a
// live doc and a journal file that is not a change log must not.
{
  const os = require("os");
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), "history-budget-"));
  const put = (rel, text) => { const p = path.join(fx, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put("app/journal/changes-ddjp_1.md", "x"); put("app/journal/entry-list.js", "y");
  put("docs/ARCHIVE.md", "x"); put("docs/milestones/m1/a.md", "x"); put("docs/LIVE.md", "y");
  const got = find(path.join(fx, "app"), path.join(fx, "docs")).map((p) => p.what);
  const want = ["journal/changes-ddjp_1.md", "ARCHIVE.md", "milestones/ (m1)"];
  ok(JSON.stringify(got) === JSON.stringify(want),
    "the rules that find history must each find their own kind, and nothing else: a change log, ARCHIVE.md and a " +
    "milestone folder, never a live doc or another journal file", { got, want });
  fs.rmSync(fx, { recursive: true, force: true });
}

const found = find(ROOT, DOCS).map((p) => p.what).concat(finished(roadmap).map((id) => "the roadmap's finished entry " + id));
ok(found.length === 0,
  "THE TREE HOLDS HISTORY: " + found.join("; ") + ".\n      History is temporary: move what is still needed to its " +
  "home, then remove the rest (START-HERE.md §History is temporary). A finished job's entry is drained and deleted in " +
  "the package that finishes it, not kept as DONE. A record something genuinely needs is the owner's decision, made by " +
  "changing this guard.", found);

if (failed) { console.log("[history-budget] " + failed + " FAILED"); process.exit(1); }
console.log("[history-budget] PASS — the tree holds no history: no change log, no ARCHIVE.md, no milestone folder, and " +
  "none of the roadmap's " + mine.length + " entries finished, read the census's way and checked against it. Each kind " +
  "is found at a fixture tree, and filing or building a job leaves the roadmap clean while finishing one does not, both " +
  "driven on the real roadmap.");
