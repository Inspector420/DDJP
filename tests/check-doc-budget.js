// tests/check-doc-budget.js
// SUBJECT: docs/START-HERE.md, docs/README.md, and the reading order README declares
//
// ── WHAT THIS GUARDS, AND WHY IT IS A CEILING RATHER THAN A STYLE RULE ──────────────────────
// Every session is told to read a fixed set of documents BEFORE it scopes anything: the front
// door, the rules index, and the numbered reading order the index declares. That set is the only
// documentation that costs something every single time. The remaining three quarters of the doc
// tree is reached only when a job needs it and is therefore free.
//
// Measured when this guard was written: the doc tree was 1,820,829 bytes across 41 files, and the
// required path was 433,052 of it — 24%. So the number worth holding is not the size of the tree.
// It is the size of the path.
//
// ── THE FAILURE THIS EXISTS FOR ─────────────────────────────────────────────────────────────
// Prose only grows. Every session adds and none subtracts, because adding is always locally
// justified — a finding, a correction, a warning worth leaving — and subtracting needs an argument
// nobody is being paid to make. There is no moment at which a session is confronted with the cost
// of what it added, so the cost is paid by every session after it, forever, in budget spent before
// any work starts.
//
// A ceiling creates that moment. It does not say the prose is bad; it says the path is full, and
// an addition is now a TRADE rather than a gift. That is the entire mechanism.
//
// ── THE RATCHET: THIS NUMBER MAY ONLY EVER GO DOWN ──────────────────────────────────────────
// Deliberately the mirror of `?v=`, which may only ever go UP (`reference/HOW_TO_VERSION.md` §2).
// Raising this ceiling is always available and is always the wrong first move, so the rule is
// written where it will be read at the moment somebody wants to raise it: RAISING IT IS NOT A
// FIX. If the path genuinely has to grow, the honest sequence is cut something else first and
// leave the ceiling where it stands.
//
// The number is stored HERE, as a literal, and that is correct rather than a restatement: a budget
// is a DECISION, not a derived fact, and a decision has to be written down somewhere. What must
// never be restated is the FILE LIST, which is why this guard reads it out of the front door
// instead of carrying its own copy — see below.
//
// ── WHY THE FILE LIST IS DERIVED AND NOT LISTED ─────────────────────────────────────────────
// `main/08-build-and-deploy.md` §What `?v=` tracks records what happens when a rule restates a set
// instead of deriving it: the hand-written "nothing under core/ backends/ features/ ui/" test was a
// restatement of the tag set, and it had already drifted — it missed `app.js` and `sw-register.js`,
// both tagged. A budget guard carrying its own list of the seven rules would drift the first time
// the reading order changed, and would then be measuring a path nobody reads.
//
// So the chain is walked, every time:
//   1. the front door is `START-HERE.md`             (the same constant `check-front-door` uses)
//   2. its four-index table names the RULES index    (the row whose label is `rules`)
//   3. that index declares a NUMBERED reading order  (the blockquote of `N. [`X.md`](X.md)`)
//   4. the required path is 1 + 2 + 3, de-duplicated
// If any link in that chain cannot be resolved, this guard REFUSES rather than measuring a partial
// path and reporting a comfortable number. A budget that silently measures four files instead of
// nine passes forever and guards nothing.

const fs = require("fs");
const path = require("path");
const { docPaths, searchedFor } = require("./_docs.js");   // one resolver, never a literal docs_NNN

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[doc-budget] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[doc-budget] FAIL — REFUSED: " + msg);
  console.log("[doc-budget] 1 failure(s)");
  process.exit(1);
}

function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}
function sizeOf(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.statSync(p).size;
  return null;
}

// ── THE CEILING ─────────────────────────────────────────────────────────────────────────────
// Set to the path's exact measured size on the day the guard was written. Exact, not rounded up:
// headroom is an invitation, and a ceiling with room to grow is a ceiling that will be grown into
// without anyone deciding to. The first addition after this line was written is meant to fail.
// RATCHETED DOWN TWICE. At `ddjp_400`: 433,052 -> 374,307, when `HANDOFF.md` was rebuilt from the
// tree as pure current state (68,031 -> 9,496 bytes). At `ddjp_401`: -> 328219, when
// `README.md` §What is live-verified gave up its version-by-version RECORD (47,724 bytes) and kept
// the RULE, pointing at `HANDOFF.md` for current status and `ARCHIVE.md` for the evidence.
// NOTHING WAS DELETED EITHER TIME. The ceiling follows the path DOWN and never back up, so space
// freed by a drain cannot be quietly refilled by the next session that wants to add a paragraph.
// At `ddjp_401` again: -> 314063, when `roles.md` §5 gave up the PROCEDURE of the `ui/` split, a
// refactor finished at `ddjp_397`. Its cut rule and ownership map stayed, being live.
const CEILING = 311243;

// ── 1. THE FRONT DOOR ───────────────────────────────────────────────────────────────────────
const FRONT_REL = "START-HERE.md";
const front = readDoc(FRONT_REL);
if (front === null) {
  refuse(FRONT_REL + " is not in any of the places the tree puts it. Looked in: " + searchedFor(FRONT_REL));
}

// ── 2. THE RULES INDEX, READ OUT OF THE FRONT DOOR'S INDEX TABLE ────────────────────────────
// The row shape is `| **rules** | [`README.md`](README.md) | … |`. Matched on the LABEL rather
// than on the filename, so renaming the index moves this guard with it.
const rulesRow = front.match(/\|\s*\*\*rules\*\*\s*\|[^|]*?\]\(([^)#\s]+\.md)\)/i);
if (!rulesRow) {
  refuse("the front door's index table has no row labelled **rules** with a link in it. This guard " +
         "reads the required path OUT of that table rather than carrying its own copy, so it cannot " +
         "measure anything until the table names an index.");
}
const RULES_REL = rulesRow[1];

const rules = readDoc(RULES_REL);
if (rules === null) {
  refuse("the front door names `" + RULES_REL + "` as the rules index and it does not resolve. " +
         "Looked in: " + searchedFor(RULES_REL));
}

// ── 3. THE READING ORDER, READ OUT OF THE RULES INDEX ───────────────────────────────────────
// Numbered items carrying a markdown link, inside the reading-order blockquote. The `>` prefix is
// what distinguishes the ORDER from the prose further down that also links the same files in
// passing — a match on links alone would sweep up `paths.md` and report a path nobody is told to
// read in full.
const orderLines = rules.split("\n").filter((l) => /^>\s*\d+\.\s/.test(l));
const ORDER = [...new Set(
  orderLines.map((l) => (l.match(/\]\(([^)#\s]+\.md)\)/) || [])[1]).filter(Boolean)
)];

ok(ORDER.length >= 2,
  "`" + RULES_REL + "` declares no numbered reading order that this guard can find. It looks for " +
  "lines shaped `> N. [..](X.md)`. If the order moved out of a blockquote, this guard is measuring " +
  "the wrong thing and must be taught the new shape rather than left passing", ORDER);
if (ORDER.length < 2) { console.log("[doc-budget] " + failed + " failure(s)"); process.exit(1); }

// ── 4. MEASURE ──────────────────────────────────────────────────────────────────────────────
const REQUIRED = [...new Set([FRONT_REL, RULES_REL, ...ORDER])];
const missing = REQUIRED.filter((r) => sizeOf(r) === null);
if (missing.length) {
  refuse("the reading order names " + missing.length + " document(s) that do not resolve: " +
         missing.join(", ") + ". A budget measured over a partial path reports a comfortable " +
         "number and guards nothing.");
}

const sizes = REQUIRED.map((r) => ({ rel: r, bytes: sizeOf(r) })).sort((a, b) => b.bytes - a.bytes);
const TOTAL = sizes.reduce((n, s) => n + s.bytes, 0);
const headroom = CEILING - TOTAL;

ok(TOTAL <= CEILING,
  "THE REQUIRED READING PATH IS OVER BUDGET by " + (TOTAL - CEILING).toLocaleString() + " bytes.\n" +
  "      " + REQUIRED.length + " documents, " + TOTAL.toLocaleString() + " bytes, ceiling " +
  CEILING.toLocaleString() + ".\n" +
  "      RAISING THE CEILING IS NOT A FIX — it may only ever go down, the mirror of `?v=` only\n" +
  "      ever going up. Cut something on the path instead. The largest are:\n" +
  sizes.slice(0, 4).map((s) => "        " + String(s.bytes).padStart(7) + "  " + s.rel).join("\n") + "\n" +
  "      Roughly half of this path is DATED RECORD — paragraphs carrying a `v###`, `ddjp_###` or\n" +
  "      `J##` — and dated record is the cheapest thing to move off the path, because a document\n" +
  "      nobody is told to read costs nothing and loses nothing.",
  { bytes: TOTAL, ceiling: CEILING });

if (failed) { console.log("[doc-budget] " + failed + " failure(s)"); process.exit(1); }

console.log("[doc-budget] PASS — the required reading path is " + TOTAL.toLocaleString() +
  " bytes across " + REQUIRED.length + " documents, against a ceiling of " + CEILING.toLocaleString() +
  " (" + (headroom >= 0 ? headroom.toLocaleString() + " to spare" : "OVER") + "). THE FILE LIST IS " +
  "DERIVED, NOT LISTED: front door -> its **rules** index row -> that index's numbered reading " +
  "order, so changing the order moves this guard with it rather than leaving it measuring a path " +
  "nobody reads. THE CEILING MAY ONLY GO DOWN — it is the mirror of `?v=`, which may only go up, " +
  "and raising it is always available and always the wrong first move. Largest on the path: " +
  sizes.slice(0, 3).map((s) => s.rel + " " + s.bytes.toLocaleString()).join(", ") + ".");
process.exit(0);
