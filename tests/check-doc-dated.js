// tests/check-doc-dated.js
// SUBJECT: docs/START-HERE.md, docs/README.md, and the reading order README declares
//
// ── WHAT THIS CAPS, AND WHY SIZE ALONE DOES NOT CATCH IT ────────────────────────────────────
// `check-doc-budget.js` caps how BIG the required reading path is. That stops the path growing,
// and it does not stop the path CHANGING CHARACTER at a constant size: a session can delete a
// paragraph of live rule and add a paragraph of session narrative, and the budget will not move.
// Since narrative is what sessions naturally produce and rules are what they naturally consume,
// the drift is one-directional and would happen without anyone choosing it.
//
// So this counts the marks that identify DATED RECORD — `?v=NNN`, `ddjp_NNN`, `docs_NNN`, `vNNN` —
// and caps them.
//
// ── WHY A DATE IS THE RIGHT PROXY ───────────────────────────────────────────────────────────
// A document either describes the tree AS IT IS, or it records something that happened. The first
// rots and must be small. The second cannot rot — it was true of the package it names and stays
// true of it forever — and is therefore free, as long as nobody is REQUIRED to read it.
//
// The mistake this tree made was mixing them in the same paragraphs, so a reader could not tell a
// live claim from a record, and neither could any instrument. Measured before the drains: 49% of
// the required path, 210,183 bytes of 427,233, sat in paragraphs carrying one of these marks.
// Four of the five defects found in the orientation pass that produced this guard were stale
// PROSE, not broken code.
//
// A version number is a near-perfect tell, and better than a keyword list because nobody writes one
// by accident. That is also why it is a CAP and not a ban: some dated marks genuinely belong on the
// path — a rule that exists because of a specific incident is more convincing with the incident
// named, and the state index must name the package it describes.
//
// ── THE RATCHET ─────────────────────────────────────────────────────────────────────────────
// Down only, like `check-doc-budget.js` and `check-doc-sections.js`. Raising it is always available
// and always the wrong first move: the record belongs in `ARCHIVE.md`, which nobody is required to
// read, and moving it there costs nothing and loses nothing.
//
// The file list is DERIVED — front door, its **rules** row, that index's numbered reading order.
// Never restated; see `check-doc-budget.js` for what restating a set costs in this tree.

const fs = require("fs");
const { docPaths, searchedFor } = require("./_docs.js");

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[doc-dated] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[doc-dated] FAIL — REFUSED: " + msg);
  console.log("[doc-dated] 1 failure(s)");
  process.exit(1);
}
function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

// ── THE CEILING ─────────────────────────────────────────────────────────────────────────────
// The path's exact count on the day the drains landed. Exact, not rounded.
const CEILING = 89;

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
if (ORDER.length < 2) {
  refuse("`" + RULES_REL + "` declares no numbered reading order this guard can find. Counting a " +
         "partial path reports a comfortable number and guards nothing.");
}

const DATED = /\?v=\d+|\bv\d{3}\b|\bddjp[_-]\d+\b|\bdocs[_-]\d+\b/g;
const REQUIRED = [...new Set([FRONT_REL, RULES_REL, ...ORDER])];

const per = [];
let total = 0;
for (const rel of REQUIRED) {
  const t = readDoc(rel);
  if (t === null) refuse("the reading order names `" + rel + "`, which does not resolve.");
  DATED.lastIndex = 0;
  const n = (t.match(DATED) || []).length;
  per.push({ rel, n });
  total += n;
}
per.sort((a, b) => b.n - a.n);

ok(total <= CEILING,
  "DATED RECORD ON THE READING PATH HAS GROWN to " + total + " marks, above the cap of " + CEILING +
  ".\n      A `?v=`, `ddjp_` or `vNNN` in prose marks something that HAPPENED rather than something " +
  "that IS. Records are free — but only off the path, where nobody is required to read them.\n" +
  "      MOVE IT TO `ARCHIVE.md`, do not raise the cap. The cap only goes down.\n" +
  per.slice(0, 4).map((p) => "        " + String(p.n).padStart(4) + "  " + p.rel).join("\n"),
  { marks: total, cap: CEILING });

if (failed) { console.log("[doc-dated] " + failed + " failure(s)"); process.exit(1); }

console.log("[doc-dated] PASS — " + total + " dated marks (`?v=`, `ddjp_`, `docs_`, `vNNN`) across " +
  REQUIRED.length + " documents on the required reading path, against a cap of " + CEILING + ". THIS IS " +
  "WHAT THE SIZE BUDGET CANNOT SEE: a session can swap live rule for session narrative at a constant " +
  "byte count, and narrative is what sessions produce while rules are what they consume, so the drift " +
  "runs one way unless something counts it. Before the drains, 49% of this path — 210,183 bytes of " +
  "427,233 — sat in paragraphs carrying one of these marks. THE CAP ONLY GOES DOWN: a record belongs " +
  "in `ARCHIVE.md`, which costs nothing because nobody is told to read it. Densest now: " +
  per.slice(0, 3).map((p) => p.rel + " " + p.n).join(", ") + ".");
process.exit(0);
