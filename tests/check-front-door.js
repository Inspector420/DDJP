// tests/check-front-door.js
// SUBJECT: docs/START-HERE.md, docs/MODULES.md, backends/backend1/
// WALL: THERE IS ONE FRONT DOOR, ITS POINTERS RESOLVE, AND THE CODE INDEX MATCHES THE TREE.
//
// ── WHY THIS EXISTS: ELEVEN HALF-DOORS AND A CODE INDEX NOBODY GUARDED ───────────────────────
// A package handed to a session with no context presented a doc tree in which several files each
// told a newcomer where to begin, each one true and none complete — so which file a session
// happened to open decided what it knew, and the workflow was supplied by hand every time.
// `docs/START-HERE.md` is the single page a session is told to open. This guard is what stops it
// silently becoming the twelfth half-door.
//
// The second half is worse and is the reason this is one guard rather than two. `MODULES.md` is
// the first thing anyone reads about the codebase and **nothing named it** — no guard, no tool,
// no accounting. It could rot in either direction in silence: a module described here that no
// longer exists sends a reader to a file that is not there, and a module in the tree that is
// missing from here is a module a session does not know exists. The second is the dangerous one,
// because absence has no symptom. That is this tree's characteristic shape — a correct thing
// reached by nothing — arriving in the docs instead of in the code.
//
// ── THE SHAPE IS `check-ui-files`', AND DELIBERATELY ─────────────────────────────────────────
// That guard reads a DECISION out of a document and drives it against disk in both directions.
// So does this one. The decision here is the four-index table in `START-HERE.md`; the tree here is
// `backends/backend1/` and the doc tree. Nothing in this file restates either side.
//
// ── WHAT IS PINNED AND WHAT IS NOT, WHICH IS THE ONE PLACE THE TWO GUARDS DIFFER ─────────────
// `check-ui-files` pins its count at ten because ten is a RULING. Here:
//   · the INDEX count IS pinned, at four, for the same reason — four is a ruling, and a fifth
//     index is an argument to have with the table rather than a file to add beside it. A guard
//     that merely checked "every index is reachable" would be satisfied by nine of them, which
//     is the state this page was written to end.
//   · the MODULE count is NOT pinned, because it is an OUTCOME. Adding a backend module is
//     ordinary work; leaving it out of the index is not. Pinning a number here would fail honest
//     work and teach the next session to re-tune the threshold — the forty-seventh signature,
//     which is a floor denominated in the quantity a job legitimately moves.
//
// ── HOW A FILE DECLARES ITSELF AN INDEX ──────────────────────────────────────────────────────
// By carrying a line beginning `**Front door:**` that links back to the page. That marker, and
// NOT any link to `START-HERE.md`, is the declaration — so a doc may cite the front door in
// passing without claiming to be one of its indexes, and PART C stays narrow enough to mean
// something. The set of markers and the set of table rows are compared, which is what makes a new
// index impossible to add without the front door learning about it: write the marker into a fifth
// file and this goes red until the table names it, and name a fifth file in the table and this
// goes red until it declares.
//
// ── DRIVEN RED SIX WAYS BEFORE IT WAS BELIEVED, AND THE ROWS ARE RECORDED ────────────────────
// Applied-checked on disk before each result was read and again after, because a probe that never
// applied prints the same green as one that passed. Each row is a direction, not a repeat:
//
//   A1  a module planted in `backends/backend1/` that the index does not name        -> RED
//   A2  a module paragraph added to the index with no file behind it                 -> RED
//   B1  a backticked path added to the front door that resolves nowhere              -> RED
//   B2  a fifth row added to the four-index table                                    -> RED
//   B3  a row whose link TEXT and TARGET name different files                        -> RED
//   C1  a fifth document given the `**Front door:**` marker                          -> RED
//   C2  the marker broken on one of the four                                         -> RED
//   N1  CONTROL — a blank line inserted above the table                              -> GREEN
//
// N1 is the row that makes the others mean something: a guard that reddens on formatting is a
// guard whose first two false reds teach the next person to skim it.
//
// AND THE FIRST ATTEMPT AT A1 CAME BACK **VOID**, WHICH IS WORTH MORE THAN THE ROW. The harness
// asserted that the edit had reached disk by watching `MODULES.md` — while the mutation planted a
// file in `backends/backend1/`. The watched file never moved, so the row reported VOID and its
// result was not read. Banked as a green it would have condemned this half of PART A as
// non-discriminating: the forty-second signature, inside the harness written to respect it. The
// applied-check has to be denominated in the file the edit actually touches.
//
// ── WHAT THIS GUARD CANNOT DO, STATED SO A GREEN IS NOT MISREAD ──────────────────────────────
// It is structural. It proves the pointers RESOLVE and the index MATCHES the tree. It proves
// nothing about whether a word of either is true: a module's paragraph can describe behaviour the
// code stopped having, and no instrument in this tree can see that. `START-HERE.md` says so in
// its own text, and that sentence is load-bearing rather than modest.

const fs = require("fs");
const path = require("path");

let asserts = 0;
const failures = [];
function fail(msg, got) {
  failures.push(msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const { docPaths, docRoots, searchedFor } = require("./_docs.js");   // one resolver, never a literal docs_NNN

// ── the two documents this guard reads, resolved through the shared resolver ─────────────────
// The docs ship WITH the tree, so absence is a broken package rather than a reason to pass — the
// same rule `check-roadmap-gate` and `check-doc-xrefs` state, and the twenty-sixth signature.
function readDoc(rel) {
  const p = docPaths(rel).find((c) => fs.existsSync(c)) || null;
  ok(!!p, "APPLIED — `" + rel + "` must be readable in the docs tree; it is a SUBJECT of this " +
    "guard, so its absence is a broken package and not a reason to pass. " + searchedFor(rel),
    docPaths(rel));
  return p ? fs.readFileSync(p, "utf8") : "";
}
const FRONT_REL = "START-HERE.md";
const MODULES_REL = "MODULES.md";
const front = readDoc(FRONT_REL);
const modules = readDoc(MODULES_REL);

// ═══ PART A — THE CODE INDEX MATCHES THE TREE, BOTH WAYS ═════════════════════════════════════
// `MODULES.md` walks the backend module by module, each as a `**`name`**` paragraph. The tree is
// `backends/backend1/*.js`. Neither side is restated here; both are read.
// BACKEND DIRS ARE DERIVED, NOT NAMED. This was pinned to `backends/backend1` until J23. The
// moment a second engine had a `.js` in it, that pin was a wall covering one engine less than it
// claimed — and this is the guard whose whole job is that a module a session does not know about
// cannot exist. Same derivation `check-boundaries` and `check-lint` use.
const BACKEND_REL = "backends/";
const BACKEND_DIRS = fs.readdirSync(path.join(ROOT, "backends"), { withFileTypes: true })
  .filter((e) => e.isDirectory() &&
    fs.readdirSync(path.join(ROOT, "backends", e.name)).some((f) => f.endsWith(".js")))
  .map((e) => "backends/" + e.name);
const DIR_OF = {};
const ON_DISK = BACKEND_DIRS.flatMap((d) =>
  fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".js"))
    .map((f) => { const m = f.replace(/\.js$/, ""); DIR_OF[m] = d; return m; })
).sort();
ok(ON_DISK.length > 10,
  "APPLIED — `" + BACKEND_REL + "` scanned to " + ON_DISK.length + " modules across " +
  BACKEND_DIRS.length + " engine(s). Below a plausible floor means the population is not being " +
  "read, and every assertion under it is free", ON_DISK);
ok(BACKEND_DIRS.length >= 2,
  "APPLIED — control: the scan must reach more than one engine, or J23's seam is being checked " +
  "against the same single folder the pin used to name and the widening above is inert", BACKEND_DIRS);

const NAMED = [...modules.matchAll(/^\*\*`([a-z0-9_]+)`\*\*/gm)].map((m) => m[1]).sort();
ok(NAMED.length > 10,
  "APPLIED — the walkthrough parsed to " + NAMED.length + " module names. A matcher that stopped " +
  "recognising the paragraph form reports an EMPTY index, which satisfies 'every name resolves' " +
  "for free and turns the other direction into a flood — so the floor is asserted before either",
  NAMED);
// AND THE MATCHER IS CONTROLLED AGAINST SOMETHING KNOWN PRESENT, because a negative from a
// textual matcher is evidence about the QUERY until it has matched something that is there. The
// reducer is the one module the whole backend is described against; if the form stops matching
// it, the parse above is a reading of the matcher rather than of the file.
ok(NAMED.indexOf("statederiver") >= 0,
  "APPLIED — control: the paragraph matcher must find `statederiver`, which the walkthrough " +
  "certainly names. If it does not, this part is reporting on its own regex", NAMED);

ok(new Set(NAMED).size === NAMED.length,
  "a module is walked through TWICE in the code index. Two paragraphs for one module is two " +
  "accounts of one thing, and a reader has no way to tell which is current", NAMED);

// EXCEPTIONS carry their reason, and are asserted to still exist — an exemption keyed by a path
// is a claim about where something lives, and a split is exactly when that claim goes stale
// (fifty-second signature). Empty today: nothing in `backends/backend1/` has earned one.
const EXCEPTIONS = {
  // "example.js": "why this module is deliberately not in the walkthrough",
};
for (const f of ON_DISK) {
  ok(NAMED.indexOf(f) >= 0 || EXCEPTIONS[f + ".js"],
    "`" + DIR_OF[f] + "/" + f + ".js` exists and the code index does not name it. That is the " +
    "silent direction: a reader meets the index, forms a picture of the backend, and this module " +
    "is not in it — so nothing sends anyone to a file they do not know is there. Add its " +
    "paragraph, or except it here with a written reason", { module: f, named: NAMED });
}
for (const n of NAMED) {
  ok(ON_DISK.indexOf(n) >= 0,
    "the code index walks through `" + n + "` and `" + BACKEND_REL + "/" + n + ".js` does not " +
    "exist. A reader following it finds nothing, and a description of a module that is gone is " +
    "the most authoritative-looking thing in the tree", { named: n, onDisk: ON_DISK });
}
for (const k of Object.keys(EXCEPTIONS)) {
  ok(fs.existsSync(path.join(BACKEND, k)),
    "`" + BACKEND_REL + "/" + k + "` is excepted here and no longer exists. Delete the row: an " +
    "exception that outlives its file is how a list of two becomes a list of twenty", k);
}

// ═══ PART B — THE FRONT DOOR'S POINTERS RESOLVE ══════════════════════════════════════════════
// Every file the page names must exist. This is the TOTAL property — the same shape as
// `check-ui-refs`' "every ref read is a ref assigned" — because the failure it stops is a front
// door confidently sending a session at a file that moved, which is a stale INSTRUCTION rather
// than a stale fact, and an instruction gets followed.
//
// TWO FORMS ARE READ AND A THIRD IS NOT, DECLARED SO A GREEN IS NOT MISREAD AS TOTAL:
//   · markdown link targets            [...](README.md)
//   · a backticked token that is a bare path   `tools/context-for.js`
//   · NOT a path inside a shell command with a glob in it (`../docs_*/main/…`). The page carries
//     none today; if one is added, it is outside what this part sees and the page should name the
//     file in prose as well.
const LINKS = [...front.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
const TICKS = [...front.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const FILE_SHAPE = /^[A-Za-z0-9_.\/-]+\.(md|js|html)$/;
const NAMES = [...new Set([...LINKS, ...TICKS].filter((t) => FILE_SHAPE.test(t)))].sort();
ok(NAMES.length >= 5,
  "APPLIED — the front door parsed to " + NAMES.length + " file references. A page that names " +
  "nothing resolvable is either not the front door or this scan has stopped seeing its forms, " +
  "and 'every pointer resolves' would be a reading of an empty set", NAMES);
// CONTROL on the shape test itself, both directions, before any resolution is trusted.
ok(FILE_SHAPE.test("MODULES.md") && FILE_SHAPE.test("tools/context-for.js"),
  "APPLIED — control: the path-shape test must ACCEPT a real doc path and a real code path");
ok(!FILE_SHAPE.test("?v=") && !FILE_SHAPE.test("../docs_*/main/09-roadmap.md"),
  "APPLIED — control: the path-shape test must REJECT a non-path and a glob, or the resolution " +
  "below fails on things that were never claims about a file");

// A `.md` resolves in the docs tree; anything else in the code tree. Same split every other
// subject-checking guard in this suite uses.
for (const n of NAMES) {
  const found = /\.md$/.test(n)
    ? (fs.existsSync(path.join(ROOT, n)) || docPaths(n).some((c) => fs.existsSync(c)))
    : fs.existsSync(path.join(ROOT, n));
  ok(found,
    "the front door names `" + n + "` and it does not exist. The page is the ONE file a session " +
    "is told to open, so a pointer that resolves nowhere is the first thing a session meets and " +
    "the last thing it can check against anything else", n);
}

// ── THE FOUR-INDEX TABLE, READ FROM THE PAGE AND PINNED AT FOUR ──────────────────────────────
// The table is the decision. A row is `| **role** | [`file.md`](file.md) | … |`.
const ROW = /^\|\s*\*\*([a-z]+)\*\*\s*\|\s*\[`([^`]+)`\]\(([^)]+)\)\s*\|/gm;
const ROWS = [...front.matchAll(ROW)].map((m) => ({ role: m[1], label: m[2], href: m[3] }));
ok(ROWS.length === 4,
  "the four-index table holds " + ROWS.length + " rows. FOUR IS A RULING and not an outcome: the " +
  "failure this page exists to end is a tree with several files each telling a newcomer where to " +
  "begin, and a fifth index walks straight back to it one defensible file at a time. If the count " +
  "has genuinely been re-decided, this number moves WITH the table and the record says why",
  ROWS);
const ROLES = ["rules", "code", "jobs", "state"];
ok(JSON.stringify(ROWS.map((r) => r.role)) === JSON.stringify(ROLES),
  "the table's roles must be exactly " + ROLES.join(" · ") + ", in that order. The roles are the " +
  "vocabulary the rest of the page uses — it names the ROLE and never the filename, so that a " +
  "rename is one edit — and a role the prose refers to that the table does not define leaves " +
  "every mention of it pointing at nothing", ROWS.map((r) => r.role));
for (const r of ROWS) {
  ok(r.label === r.href,
    "the `" + r.role + "` row's link text and target disagree (`" + r.label + "` vs `" + r.href +
    "`). Two statements of one fact in one cell is exactly where drift lives, and the visible " +
    "half is the one nobody checks", r);
}

// ═══ PART C — THE INDEX SET IS EXACTLY THE SET THAT DECLARES ITSELF ONE ══════════════════════
// Driven both ways. A file declares itself an index by carrying a `**Front door:**` line; the
// table declares which files are indexes. Either set growing without the other is the failure.
const MARKER = /^\*\*Front door:\*\*/m;
// CONTROL on the marker, against a line known to be present in the front door itself — a negative
// from a textual matcher is evidence about the query until the query has matched something known
// to be there, and this one is asked of every document in the tree.
ok(/^\*\*This page states rules and points at indexes\./m.test(front),
  "APPLIED — control: the line-anchored matcher must find a bold line this guard knows the front " +
  "door carries. If it cannot, every `no marker here` below is a reading of the regex");
ok(!MARKER.test(front),
  "the front door carries a `**Front door:**` marker of its own. The marker means *this file is " +
  "an index reached from the front door*; on the page itself it would make the page one of its " +
  "own indexes, and PART C would then require the table to name it", FRONT_REL);

function docMdFiles() {
  const out = [];
  for (const root of docRoots()) {
    (function rec(d) {
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) rec(p);
        else if (e.name.endsWith(".md")) out.push({ rel: path.relative(root, p).split(path.sep).join("/"), abs: p });
      }
    })(root);
  }
  return out;
}
// THE POPULATION IS THE DOC TREE, NOT THE CODE TREE, AND THAT IS A CHOICE. A `README.md` shipping
// beside code is documentation OF that directory rather than an index of the doc tree, and
// widening to it would make every one of them a candidate index for a marker none of them carries.
const DOC_MD = docMdFiles();
ok(DOC_MD.length >= 20,
  "APPLIED — the doc tree walked to " + DOC_MD.length + " files. Below a plausible floor the " +
  "backward direction is a search of nothing, which passes forever", DOC_MD.length);

const DECLARED = [...new Set(DOC_MD.filter((f) => MARKER.test(fs.readFileSync(f.abs, "utf8")))
  .map((f) => f.rel))].sort();
const TABLED = ROWS.map((r) => r.href).sort();
const declaredNotTabled = DECLARED.filter((f) => TABLED.indexOf(f) < 0);
ok(declaredNotTabled.length === 0,
  "a document declares itself an index and the front door's table does not name it. This is the " +
  "direction that recreates the original defect: a second page telling a newcomer where to begin, " +
  "reachable, plausible, and not on the one list a session is told to read. Put it on the table " +
  "and argue the role, or take the marker out", declaredNotTabled);
const tabledNotDeclared = TABLED.filter((f) => DECLARED.indexOf(f) < 0);
ok(tabledNotDeclared.length === 0,
  "the front door names an index that does not declare itself one. The back-pointer is what a " +
  "reader who arrived at that file directly actually sees — without it they have that index and " +
  "none of the working rules, which is the state the front door was written to end",
  tabledNotDeclared);

// ── the gate, below every part, and there is no async section above it ───────────────────────
if (failures.length) {
  console.log("[front-door] FAIL — " + failures.length + " problem(s) with the front door or the code index:");
  for (const f of failures) console.log("  \u2717 " + f);
  process.exit(1);
}

console.log("[front-door] PASS — there is ONE front door and its pointers hold, and the code index " +
  "matches the tree in both directions: every module `" + MODULES_REL + "` walks through has a " +
  "file in `" + BACKEND_REL + "/` and every module file is walked through (" + NAMED.length +
  " on each side, and the count is deliberately NOT pinned — it is an outcome, and a floor " +
  "denominated in something a job legitimately moves fails honest work and teaches the next " +
  "session to re-tune it). Every file `" + FRONT_REL + "` names resolves (" + NAMES.length +
  " references, links and bare backticked paths; a path inside a globbed shell command is outside " +
  "what this reads and is declared rather than assumed). The four-index table is PINNED AT FOUR " +
  "because four is a ruling: the defect this page ended was several files each telling a newcomer " +
  "where to begin, all true and none complete, and a fifth walks back to it one defensible file " +
  "at a time. The table and the `**Front door:**` declarations are COMPARED rather than each " +
  "asserted non-empty — a new index cannot appear without the front door learning about it, and " +
  "the front door cannot name one that does not point back. THIS GUARD IS STRUCTURAL: it proves " +
  "the pointers resolve and the index matches, and NOTHING here can see a paragraph that " +
  "describes behaviour the code stopped having (" + asserts + " assertions)");
process.exit(0);
