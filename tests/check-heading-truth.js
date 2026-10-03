// tests/check-heading-truth.js
// SUBJECT: docs/START-HERE.md, docs/README.md, and the reading order README declares
//
// ── THE FAILURE THIS EXISTS FOR, WHICH IS THIS PROJECT'S MOST EXPENSIVE ONE ─────────────────
// A heading that outlived its body. It cannot be checked directly — no instrument here can read a
// paragraph and decide whether its heading still describes it. What CAN be checked is the shape of
// heading that is GUARANTEED to rot, and there is one: a heading that states a version or a
// package ordinal.
//
// Such a heading is dated by construction. It is true of exactly one package and false from the
// next one on, and nothing makes it false in a way anybody notices — the text does not change, the
// suite stays green, and a reader takes it as current because a heading is the part of a document
// people trust most, being the part they read first and sometimes the only part they read.
//
// Found on the reading path when this guard was written:
//   · `INVENTORY.md` was titled *"what is on the shelf at `ddjp_356`"* while the tree had reached
//     `ddjp_400`. The jobs index, announcing a package forty-four behind, in its own title.
//   · `roles.md` had two, `FAILURE-SIGNATURES.md` three, `INVENTORY.md` five more.
// All were fixed the same way and NOTHING WAS LOST: the version moved out of the heading and into
// a dated note directly under it. The fact survives; the claim of currency does not.
//
// ── THE ONE EXEMPTION, AND WHY IT IS DERIVED RATHER THAN NAMED ──────────────────────────────
// The STATE index is the exception. Its whole job is to say what is true of THIS package, so its
// title names the version deliberately and is re-headed every package by its own rule — and that
// heading is independently verified: `journal/verify-s9-resolved.js` check Q reads every `?v=` tag
// from `index.html` and compares it against the state index's first line.
//
// That check had been dead since `ddjp_397` — it read `ui/interface.js`, which the split deleted,
// so the file threw on load and, living in `journal/` rather than `tests/`, reported NOTHING rather
// than red. It was repaired at `ddjp_401` and immediately caught what it was written for: a tree at
// `?v=394` under a heading saying `?v=367`.
//
// The exemption is READ FROM THE FRONT DOOR's index table — the row labelled `state` — rather than
// written here as a filename. A guard carrying its own copy of which file is exempt would keep
// exempting the wrong one after a rename, and this project's recurring defect is a restatement
// drifting from what it restates.

const fs = require("fs");
const path = require("path");
const { docPaths, searchedFor } = require("./_docs.js");

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[heading-truth] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[heading-truth] FAIL — REFUSED: " + msg);
  console.log("[heading-truth] 1 failure(s)");
  process.exit(1);
}
function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

const FRONT_REL = "START-HERE.md";
const front = readDoc(FRONT_REL);
if (front === null) refuse(FRONT_REL + " does not resolve. Looked in: " + searchedFor(FRONT_REL));

function indexRow(label) {
  const m = front.match(new RegExp("\\|\\s*\\*\\*" + label + "\\*\\*\\s*\\|[^|]*?\\]\\(([^)#\\s]+\\.md)\\)", "i"));
  return m ? m[1] : null;
}

const RULES_REL = indexRow("rules");
if (!RULES_REL) refuse("the front door's index table has no row labelled **rules** with a link in it.");

// The exemption, derived. If the front door stops naming a state index, NOTHING is exempt — which
// is the safe direction: the guard gets stricter, not quieter.
const STATE_REL = indexRow("state");

const rules = readDoc(RULES_REL);
if (rules === null) refuse("the rules index `" + RULES_REL + "` does not resolve.");

const ORDER = [...new Set(
  rules.split("\n").filter((l) => /^>\s*\d+\.\s/.test(l))
       .map((l) => (l.match(/\]\(([^)#\s]+\.md)\)/) || [])[1]).filter(Boolean)
)];
if (ORDER.length < 2) refuse("`" + RULES_REL + "` declares no numbered reading order this guard can find.");

// A version, a package ordinal, or a doc-tree ordinal — the three things that date a heading here.
const DATED = /\?v=\d+|\bv\d{3}\b|\bddjp[_-]\d+\b|\bdocs[_-]\d+\b/;

const REQUIRED = [...new Set([FRONT_REL, RULES_REL, ...ORDER])];
const offenders = [];
let headings = 0;
for (const rel of REQUIRED) {
  const t = readDoc(rel);
  if (t === null) refuse("the reading order names `" + rel + "`, which does not resolve.");
  const exempt = rel === STATE_REL;
  t.split("\n").forEach((l, i) => {
    if (!/^#{1,6} /.test(l)) return;
    headings++;
    // The state index is exempt for its TITLE only. A dated heading deeper inside it is the same
    // defect as anywhere else — the re-heading rule covers the file's own heading, not every
    // section in it.
    if (exempt && /^# /.test(l)) return;
    if (DATED.test(l)) offenders.push({ rel, line: i + 1, head: l.slice(0, 70) });
  });
}

ok(offenders.length === 0,
  offenders.length + " HEADING(S) ON THE READING PATH NAME A VERSION OR PACKAGE. Such a heading is " +
  "DATED BY CONSTRUCTION: true of one package, false from the next, and false in a way nothing turns " +
  "red — the text does not change and the suite stays green while a reader takes it as current.\n" +
  "      FIX: move the version OUT of the heading and into a dated note directly under it. Nothing " +
  "is lost — the fact survives, only the claim of currency goes.\n" +
  offenders.slice(0, 6).map((o) => "        " + o.rel + ":" + o.line + "  " + o.head).join("\n"),
  offenders.slice(0, 6).map((o) => o.rel + ":" + o.line));

ok(STATE_REL !== null,
  "the front door's index table names no **state** index. Nothing is exempt from this guard as a " +
  "result, which is the safe direction — but the state index is the one document whose title SHOULD " +
  "name the version, so a missing row is more likely a broken table than a real change",
  STATE_REL);

// ── THE STATE INDEX'S TITLE IS EXEMPT ONLY BECAUSE IT IS CHECKED, SO CHECK IT ──────────────
// The exemption above lets the state index name a version and a package in its title. That is only
// defensible if something verifies both halves. `journal/verify-s9-resolved.js` check Q does the
// `?v=` half — but it is NOT IN THE SUITE and will not run itself.
//
// The package half had nothing, and went wrong immediately: at `ddjp_411` the heading said
// `ddjp_400`, the directories said `399`, and the archive filename said `411`. THREE NUMBERS FOR
// ONE PACKAGE, in the file whose whole job is what-is-true-now, with every guard green.
//
// The cause is worth writing down because it is a design fault, not carelessness: the end-of-
// session checklist lives in `tools/bump-version.js`, and a DOCS-ONLY package correctly does not
// bump — so the sessions most likely to change documentation are exactly the ones that never see
// the reminder to re-head it.
//
// So the ordinal is no longer treated as underivable. It IS derivable: it is the name of the
// directories the tree ships in. This asserts the state index agrees with them.
const dirName = path.basename(path.resolve(__dirname, ".."));
const dirOrd = (dirName.match(/^ddjp[_-](\d+)$/) || [])[1];
if (STATE_REL && dirOrd) {
  const st = readDoc(STATE_REL) || "";
  const title = st.split("\n").find((l) => /^# /.test(l)) || "";
  const said = (title.match(/ddjp[_-](\d+)/) || [])[1];
  ok(said === dirOrd,
    "THE STATE INDEX NAMES A DIFFERENT PACKAGE THAN THE TREE IT SHIPS IN. `" + STATE_REL +
    "` says `ddjp_" + (said || "?") + "`; the directory is `" + dirName + "`.\n" +
    "      The DIRECTORY IS RIGHT — it is the one place the ordinal is recorded. Re-head the state " +
    "index from the tree.\n" +
    "      This is the check that was missing when the heading said `ddjp_400`, the directories said " +
    "`399` and the archive said `411`, all at once and all green.",
    { heading: said, directory: dirOrd });
}

if (failed) { console.log("[heading-truth] " + failed + " failure(s)"); process.exit(1); }

console.log("[heading-truth] PASS — none of the " + headings + " headings across " + REQUIRED.length +
  " documents on the reading path names a version or package, except the TITLE of the state index " +
  "(`" + STATE_REL + "`), which is exempt because its own rule is to be re-headed every package and " +
  "`journal/verify-s9-resolved.js` check Q verifies it against `index.html`'s tags. THE EXEMPTION IS " +
  "READ FROM THE FRONT DOOR'S TABLE, not named here, so a rename moves it. This is a PROXY for the " +
  "defect that cannot be instrumented — a heading outliving its body — and it catches the one shape " +
  "of heading that is guaranteed to rot rather than merely likely to.");
process.exit(0);
