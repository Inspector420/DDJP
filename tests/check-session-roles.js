// tests/check-session-roles.js
// SUBJECT: docs/START-HERE.md, docs/session-roles/, docs/README.md
// WALL: THE FRONT DOOR NAMES EACH SESSION ROLE AND ITS PAGE; EVERY PAGE HAS THE SAME SECTIONS; NO PAGE IS AN INDEX OR
// REQUIRED READING.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────────────
// The owner's session roles (`HANDOVER.md` §4, the session roles): a session role is how a session uses the base (the
// front door, its four indexes, the rules) for one job, and it changes how it works, never what is true. The front door
// asks "Which session role are you?" and points each role at one short page in `session-roles/`. Four things keep that
// true, and each fails silently when it goes:
//   · a role the front door names with no page behind it, or a page nothing names: a session is sent nowhere, or never
//     sent to what was written for it;
//   · pages whose sections drift apart: the shape every page uses is the planner's, agreed with him, and a reader moving
//     between roles expects the same seven questions in the same place;
//   · a page that declares itself an index: the four-index ruling (`check-front-door`) walks back to several half-doors
//     one defensible file at a time;
//   · a page on README's reading order: required reading is paid by every session, and a role's page is read only by
//     that role.
//
// ── WHAT IS A RULING HERE, AND WHAT IS READ ──────────────────────────────────────────────────────────────────────────
// The four roles and their pages are a RULING (his), held here the way `check-front-door` holds the four indexes: a
// fifth role is an argument with him, not a page to add. The seven sections are the shape he approved on the planner's
// page, held here too. Everything else is read from the docs: the choice from the front door, the pages from the folder
// (both directions), the reading order from README's numbered blockquote (the shape `check-doc-budget` reads).
//
// ── DRIVEN RED BEFORE IT WAS BELIEVED ────────────────────────────────────────────────────────────────────────────────
// On `ddjp_731`'s docs (no choice, no pages) it fails at A and B. Each row of `tools/probes/mutate-session-roles.js` names
// the failure it must cause; two controls (a blank line in the choice, a reworded sentence in a page) stay green.
//
// ── WHAT THIS CANNOT DO ──────────────────────────────────────────────────────────────────────────────────────────────
// It is structural. It cannot tell whether a page points into the rules or restates them, or whether a word of it is
// true: that is read by a person, at the version bump, like any prose here.
"use strict";
const fs = require("fs");
const path = require("path");
const { docPaths, docRoots, searchedFor } = require("./_docs.js");   // one resolver, never a literal docs_NNN

let asserts = 0;
const failures = [];
function ok(c, msg, got) {
  asserts++;
  if (!c) failures.push(msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
function readDoc(rel) {
  const p = docPaths(rel).find((c) => fs.existsSync(c)) || null;
  ok(!!p, "APPLIED — `" + rel + "` must be readable in the docs tree; it is a SUBJECT of this guard, so its absence is " +
    "a broken package and not a reason to pass. " + searchedFor(rel));
  return p ? fs.readFileSync(p, "utf8") : "";
}

// ── THE RULINGS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const FOLDER = "session-roles";
const ROLES = [
  ["Planner", FOLDER + "/planner.md"],
  ["Supervisor", FOLDER + "/supervisor.md"],
  ["Worker", FOLDER + "/worker.md"],
  ["Milestone closer", FOLDER + "/closer.md"],
];
const NO_ROLE = "No session role";
const SECTIONS = [
  "What you are for",
  "What you are given",
  "How to use the base",
  "What you hand back",
  "When to stop and ask",
  "How to talk to the owner",
  "Keeping going through restarts",
];
const QUESTION = "## Which session role are you?";
const MARKER = /^\*\*Front door:\*\*/m;   // `check-front-door`'s declaration of an index, the same pattern

const front = readDoc("START-HERE.md");
const readme = readDoc("README.md");

// ═══ PART A — THE FRONT DOOR'S CHOICE NAMES EACH ROLE AND ITS PAGE, AND THE FOLDER MATCHES IT ═════════════════════════
const at = front.indexOf("\n" + QUESTION + "\n");
ok(at >= 0, "A: the front door has no `" + QUESTION + "` section. It is the one place a session learns its role's page");
const rest = at >= 0 ? front.slice(at + QUESTION.length + 2) : "";
const end = rest.search(/^(## |---)/m);
const section = end >= 0 ? rest.slice(0, end) : rest;
const LINKED = [...section.matchAll(/^- \*\*\[([^\]]+)\]\(([^)\s]+)\)\*\*/gm)].map((m) => [m[1], m[2]]);
ok(at < 0 || LINKED.length > 0,
  "APPLIED — the bullet matcher found no `- **[Role](page)**` line in the choice; everything below would be a reading " +
  "of an empty list", section.slice(0, 300));
ok(JSON.stringify(LINKED) === JSON.stringify(ROLES),
  "A: the front door's choice must name exactly the four session roles, in order, each linked to its own page " +
  "(a ruling: a fifth role is an argument with the owner, not a line to add)", { choice: LINKED, ruling: ROLES });
ok(new RegExp("^- \\*\\*" + NO_ROLE + "\\*\\* —", "m").test(section),
  "A: the choice must end with `" + NO_ROLE + "`, linking nothing: a session with no role orients with the base");
for (const [name, rel] of LINKED) {
  ok(docPaths(rel).some((p) => fs.existsSync(p)),
    "A: the page the front door names for `" + name + "` does not exist: `" + rel + "`", rel);
}
const ROOT_DOCS = docRoots().filter((r) => fs.existsSync(path.join(r, "START-HERE.md")));
const dir = ROOT_DOCS.length ? path.join(ROOT_DOCS[0], FOLDER) : null;
const ON_DISK = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
ok(ON_DISK.length > 0, "A: the folder `" + FOLDER + "/` holds no page", dir);
for (const f of ON_DISK) {
  ok(LINKED.some(([, rel]) => rel === FOLDER + "/" + f),
    "A: a page in `" + FOLDER + "/` is not on the front door's choice: `" + f + "`. Nothing sends a session to it", f);
}

// ═══ PART B — EVERY PAGE HAS THE SEVEN SECTIONS, IN ORDER, NONE EMPTY ═════════════════════════════════════════════════
const PAGES = ON_DISK.map((f) => ({ rel: FOLDER + "/" + f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
ok(ROLES.every(([, rel]) => PAGES.some((p) => p.rel === rel)),
  "B: a ruled role has no page to read", { onDisk: ON_DISK, ruling: ROLES.map((r) => r[1]) });
// Fenced blocks are taken out first, so a `## ` line inside an example is not read as a section.
const unfenced = (t) => t.replace(/^```[\s\S]*?^```/gm, "");
for (const p of PAGES) {
  const t = unfenced(p.text);
  const heads = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  ok(JSON.stringify(heads) === JSON.stringify(SECTIONS),
    "B: `" + p.rel + "`'s sections must be the seven, in order: " + SECTIONS.join(" · "), heads);
  const bodies = t.split(/^## .+$/m).slice(1);
  const empty = bodies.map((b, i) => [heads[i], b.replace(/^#{3,}.*$/gm, "").trim()]).filter(([, b]) => b === "");
  ok(empty.length === 0, "B: `" + p.rel + "` has an empty section", empty.map((e) => e[0]));
}

// ═══ PART C — NO PAGE IS AN INDEX, AND EACH POINTS BACK TO THE FRONT DOOR ════════════════════════════════════════════
ok(MARKER.test("**Front door:** [`START-HERE.md`](START-HERE.md)") && !MARKER.test("a **Front door:** in passing"),
  "APPLIED — control: the marker matcher must accept the index declaration and refuse the words in passing");
for (const p of PAGES) {
  ok(!MARKER.test(p.text),
    "C: `" + p.rel + "` declares itself an index (`**Front door:**`). A role's page is no index: the four are a ruling",
    p.rel);
  ok(/\]\(\.\.\/START-HERE\.md\)/.test(p.text),
    "C: `" + p.rel + "` does not link back to the front door. A session landing there must be sent to the base", p.rel);
}

// ═══ PART D — NO PAGE IS ON README'S READING ORDER ════════════════════════════════════════════════════════════════════
const ORDER = readme.split("\n").filter((l) => /^>\s*\d+\.\s/.test(l))
  .map((l) => (l.match(/\]\(([^)#\s]+\.md)\)/) || [])[1]).filter(Boolean);
ok(ORDER.length >= 2 && ORDER.indexOf("PILLARS.md") >= 0,
  "APPLIED — README's numbered reading order must parse, and must hold `PILLARS.md`, which it certainly names", ORDER);
const onOrder = ORDER.filter((r) => r.replace(/^\.\//, "").startsWith(FOLDER + "/"));
ok(onOrder.length === 0,
  "D: a session-role page is on README's reading order. Required reading is paid by every session; a role's page is " +
  "read only by that role", onOrder);

// ── the gate, below every part; there is no async section ───────────────────────────────────────────────────────────
if (failures.length) {
  console.log("[session-roles] FAIL — " + failures.length + " problem(s) with the session roles:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("[session-roles] PASS — the front door's \"Which session role are you?\" names the four roles, each linked to " +
  "its own page, and ends with \"" + NO_ROLE + "\"; every page in `" + FOLDER + "/` is on that choice; every page has the " +
  "seven sections in order, none empty; no page declares itself an index, each links back to the front door, and none " +
  "is on README's reading order. STRUCTURAL ONLY: whether a page points into the rules or restates them is read by a " +
  "person (" + asserts + " assertions).");
process.exit(0);
