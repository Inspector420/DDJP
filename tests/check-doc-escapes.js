// tests/check-doc-escapes.js
// SUBJECT: docs/START-HERE.md, docs/README.md, and the reading order README declares
//
// ── THE DEFECT THIS EXISTS FOR, WHICH SHIPPED ───────────────────────────────────────────────
// `roles.md` line 573 carried a literal two-character `\n` followed by `|`, where a real newline
// and `|` belonged. The effect is invisible and total: the §6 Confusables row about the queue
// sub-tab strip versus the chat tier strip **stopped being a row**. It was swallowed into the last
// cell of the row above it, so a reader looking for that confusable pair found nothing, and a
// reader reading the row above got somebody else's paragraph welded to the end of theirs.
//
// Nothing caught it. `check-doc-links` passed — the links inside the mangled text still resolve.
// `check-doc-xrefs` passed — the citations still point at real sections. `check-doc-sections`
// passed — the heading structure is untouched, because a table row is not a heading. The whole
// suite was green with a documented rule effectively deleted from the reading path.
//
// It survived at least one full orientation pass by a session that SAW the `\n` in its own grep
// output and moved on, which is the ordinary way this kind of thing survives: it looks like an
// artefact of the tool you are using rather than a fact about the file.
//
// ── WHY THIS CLASS IS WORTH A GUARD OF ITS OWN ──────────────────────────────────────────────
// It is the documentation form of this project's core signature: **the defect returns something
// plausible rather than raising an error.** A literal `\n` renders as the characters `\n`, which
// most readers skim past as an escaping quirk. Nothing is missing from the page; something is in
// the wrong place, which is harder to see than an absence.
//
// The cause is mechanical and will recur: these files are edited by programs as often as by people,
// and a string written through a language that escapes newlines produces exactly this when the
// escaping is applied once too many times. Every edit this session made to the doc tree went
// through Python or Node string literals.
//
// ── WHAT IS AND IS NOT AN OFFENCE ───────────────────────────────────────────────────────────
// A literal `\n`, `\t` or `\r` OUTSIDE a code span is the offence. Inside backticks or a fenced
// block it is legitimate — the documents discuss regexes and source code constantly, and
// `/^#{1,6}\s+/` or a quoted `"a\nb"` is a correct thing to write about. So code is stripped before
// looking, and the guard reports the line and the surrounding text rather than just a count,
// because the fix depends on which escape landed where.

const fs = require("fs");
const { docPaths, searchedFor } = require("./_docs.js");

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[doc-escapes] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got, null, 1) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[doc-escapes] FAIL — REFUSED: " + msg);
  console.log("[doc-escapes] 1 failure(s)");
  process.exit(1);
}
function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

const FRONT_REL = "START-HERE.md";
const front = readDoc(FRONT_REL);
if (front === null) refuse(FRONT_REL + " does not resolve. Looked in: " + searchedFor(FRONT_REL));

const rulesRow = front.match(/\|\s*\*\*rules\*\*\s*\|[^|]*?\]\(([^)#\s]+\.md)\)/i);
if (!rulesRow) refuse("the front door's index table has no row labelled **rules** with a link in it.");
const RULES_REL = rulesRow[1];
const rules = readDoc(RULES_REL);
if (rules === null) refuse("the rules index `" + RULES_REL + "` does not resolve.");

const ORDER = [...new Set(
  rules.split("\n").filter((l) => /^>\s*\d+\.\s/.test(l))
       .map((l) => (l.match(/\]\(([^)#\s]+\.md)\)/) || [])[1]).filter(Boolean)
)];
if (ORDER.length < 2) refuse("`" + RULES_REL + "` declares no numbered reading order this guard can find.");

const REQUIRED = [...new Set([FRONT_REL, RULES_REL, ...ORDER])];

// Strip fenced blocks and inline code, keeping line count intact so reported line numbers are the
// file's own. A blanked span is replaced by spaces rather than removed.
function blankCode(text) {
  let s = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
  s = s.replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, " "));
  return s;
}

const ESCAPE = /\\[nrt]/g;
const hits = [];
for (const rel of REQUIRED) {
  const t = readDoc(rel);
  if (t === null) refuse("the reading order names `" + rel + "`, which does not resolve.");
  const lines = blankCode(t).split("\n");
  const raw = t.split("\n");
  lines.forEach((l, i) => {
    ESCAPE.lastIndex = 0;
    if (!ESCAPE.test(l)) return;
    hits.push({ rel, line: i + 1, text: raw[i].trim().slice(0, 90) });
  });
}

ok(hits.length === 0,
  hits.length + " LITERAL ESCAPE SEQUENCE(S) IN PROSE ON THE READING PATH. A `\\n` written as two " +
  "characters where a newline belongs does not look broken — it renders as `\\n`, which reads as an " +
  "artefact of whatever tool you are looking through.\n" +
  "      WHAT IT COSTS: at `roles.md` 573 this welded a §6 Confusables row into the last cell of the " +
  "row above it, deleting a documented rule from the page while every link, citation and heading " +
  "check stayed green.\n" +
  "      If the escape is being DISCUSSED rather than mistakenly emitted, put it in backticks — " +
  "this guard blanks code spans before looking.\n" +
  hits.slice(0, 5).map((h) => "        " + h.rel + ":" + h.line + "  " + h.text).join("\n"),
  hits.slice(0, 5).map((h) => h.rel + ":" + h.line));

if (failed) { console.log("[doc-escapes] " + failed + " failure(s)"); process.exit(1); }

console.log("[doc-escapes] PASS — no literal `\\n`, `\\t` or `\\r` appears in prose across the " +
  REQUIRED.length + " documents on the reading path (code spans and fenced blocks are blanked first, " +
  "since these files discuss regexes and source constantly and an escape inside backticks is a " +
  "correct thing to write). THE DEFECT THIS EXISTS FOR SHIPPED AND WAS INVISIBLE: a `\\n|` in " +
  "`roles.md` swallowed a Confusables row into the row above it, and links, citations, headings and " +
  "section lengths all passed, because nothing was missing — something was in the wrong place. These " +
  "documents are edited by programs as often as by people, and a newline escaped once too many times " +
  "produces exactly this.");
process.exit(0);
