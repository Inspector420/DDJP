// tests/check-doc-sections.js
// SUBJECT: docs/START-HERE.md, docs/README.md, and the reading order README declares
//
// ── WHAT THIS GUARDS, AND WHY IT IS NOT A STYLE RULE ────────────────────────────────────────
// This project's most expensive recurring failure is a heading that outlived its body. It is
// written up in `FAILURE-SIGNATURES.md`, it is what `HANDOFF.md` had to be rebuilt to fix, and it
// is the reason `roles.md` §5 spent several packages telling readers a file was "now being split
// into ten" after the split had finished and left eleven.
//
// Every previous answer to it was EMPHASIS — more bold, more capitals, a louder heading — and the
// measurements say emphasis lost. When this guard was written the doc tree was 22% bolded words;
// `roles.md` and `HANDOFF.md` were 57% and 59%. The single loudest file in the tree, 32 of whose
// 33 headings shouted, was the one whose headings had stopped being true. When everything is
// emphasised nothing is, and the reader skips exactly the same way.
//
// ── THE ACTUAL MECHANISM, WHICH IS LENGTH ───────────────────────────────────────────────────
// A heading can only outlive its body if the two are never seen together. Measured on the reading
// path before this guard: 107 sections, median 19 lines, and a single section of 1,032 —
// `FAILURE-SIGNATURES.md` carried its entire catalogue of signatures under three headings, and
// `roles.md` §9 held 54 separate rulings under one. Nobody can hold 1,032 lines against a heading.
// They read the heading, form a belief, and never reach the paragraph that contradicts it.
//
// So the fix is not louder headings. It is SHORTER SECTIONS — enough that a heading and the end of
// what it governs are visible at once. Restructuring to satisfy this removed NOTHING: the catalogue
// entries and rulings were already bolded leads, and promoting them to headings made the same text
// navigable. The reading path went from 107 sections to 295, median 19 to 12, max 1,032 to 55, and
// the path got SMALLER, because `**...**` costs more than `### `.
//
// ── THE RATCHET, AS WITH THE BUDGET ─────────────────────────────────────────────────────────
// Both ceilings may only ever go DOWN, the mirror of `?v=` only ever going up. Raising either is
// always available and always the wrong first move: a section that has grown past the cap should
// be SPLIT, which is nearly always possible and nearly always an improvement, rather than have the
// cap moved to accommodate it. See `check-doc-budget.js`, which holds the same rule for size.
//
// ── WHY TWO NUMBERS ─────────────────────────────────────────────────────────────────────────
// MAX_LINES alone would let the distribution rot underneath a stable worst case: fifty sections
// could grow from 12 lines to 40 without the maximum moving at all. SOFT_OVER caps how many
// sections exceed a comfortable length, so the guard notices the middle of the distribution
// drifting and not merely its tail.
//
// The file list is DERIVED, never listed — front door, its **rules** index row, that index's
// numbered reading order — for the reason `check-doc-budget.js` gives at length: a restated set
// drifts from the set it restates, and this project's recurring defect is exactly that.

const fs = require("fs");
const path = require("path");
const { docPaths, searchedFor } = require("./_docs.js");

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[doc-sections] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[doc-sections] FAIL — REFUSED: " + msg);
  console.log("[doc-sections] 1 failure(s)");
  process.exit(1);
}
function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

// ── THE CEILINGS ────────────────────────────────────────────────────────────────────────────
// Both set to the path's exact measurement on the day the restructuring landed. Exact, not
// rounded: headroom is an invitation.
const MAX_LINES = 55;   // no single section on the path may be longer than this
const SOFT      = 20;   // "comfortable" — a heading and its body visible together
const SOFT_OVER = 63;   // and at most this many sections may exceed SOFT

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
  refuse("`" + RULES_REL + "` declares no numbered reading order this guard can find (`> N. [..](X.md)`). " +
         "Measuring a partial path reports a comfortable number and guards nothing.");
}

const REQUIRED = [...new Set([FRONT_REL, RULES_REL, ...ORDER])];
const sections = [];
for (const rel of REQUIRED) {
  const t = readDoc(rel);
  if (t === null) refuse("the reading order names `" + rel + "`, which does not resolve.");
  const L = t.split("\n");
  const idx = L.map((l, i) => (/^#{1,6} /.test(l) ? i : -1)).filter((i) => i >= 0);
  ok(idx.length > 0, "`" + rel + "` is on the reading path and has NO headings at all. A document " +
     "with no headings is one unsplittable section, which is the shape this guard exists to end", rel);
  for (let k = 0; k < idx.length; k++) {
    const end = k + 1 < idx.length ? idx[k + 1] : L.length;
    sections.push({ rel, line: idx[k] + 1, lines: end - idx[k], head: L[idx[k]].slice(0, 62) });
  }
}

const worst = [...sections].sort((a, b) => b.lines - a.lines);
const over = sections.filter((s) => s.lines > MAX_LINES);
const soft = sections.filter((s) => s.lines > SOFT);

ok(over.length === 0,
  over.length + " SECTION(S) ON THE READING PATH EXCEED " + MAX_LINES + " LINES. A heading whose " +
  "body cannot be seen with it is a heading that will outlive its body — this project's most " +
  "expensive recurring defect.\n" +
  "      SPLIT IT, DO NOT RAISE THE CAP. Promoting the bolded leads already inside a long section " +
  "to headings removes nothing and usually makes the file SMALLER.\n" +
  over.slice(0, 5).map((s) => "        " + String(s.lines).padStart(4) + "  " + s.rel + ":" + s.line + "  " + s.head).join("\n"),
  over.slice(0, 5).map((s) => s.rel + ":" + s.line + " (" + s.lines + ")"));

ok(soft.length <= SOFT_OVER,
  "the number of sections longer than " + SOFT + " lines has grown to " + soft.length + ", above the " +
  "cap of " + SOFT_OVER + ". The worst case can stay flat while the MIDDLE of the distribution rots, " +
  "which is what this second number is for. Split something; the cap only goes down.",
  { over: soft.length, cap: SOFT_OVER });

// ── AND THE THIRD NUMBER: HEADINGS THAT SHOUT ──────────────────────────────────────────────
// Length was the mechanism; emphasis was the FAILED ANSWER to it. 128 of the path's 295 headings
// were written in capitals, and the file with the highest proportion of them — 32 of 33 — was the
// one whose headings had stopped being true. Capitals do not make a heading read; they make every
// heading look equally urgent, so the reader picks by position instead of by content, which is
// the behaviour the capitals were added to prevent.
//
// All 146 were converted to sentence case and NOTHING was lost: the words are identical. Acronyms
// and anything inside backticks keep their case, because those are names rather than emphasis.
// The cap is 0 and it cannot be met by accident, so it is stated as a cap rather than a ban only
// for symmetry with the two above — it still may only go down.
const SHOUT_CAP = 0;
const shouty = sections.filter((s) => {
  const bare = s.head.replace(/`[^`]*`/g, "").replace(/^#{1,6} /, "");
  return (bare.match(/\b[A-Z]{3,}\b/g) || []).length >= 2;
});
ok(shouty.length <= SHOUT_CAP,
  shouty.length + " HEADING(S) ON THE READING PATH ARE WRITTEN IN CAPITALS. Emphasis was this " +
  "project's failed answer to headings outliving their bodies — when every heading shouts, the " +
  "reader picks by position rather than content, which is the behaviour the capitals were meant " +
  "to prevent.\n      Write it in sentence case. Acronyms and backticked names keep their case; " +
  "nothing else needs to.\n" +
  shouty.slice(0, 4).map((s) => "        " + s.rel + ":" + s.line + "  " + s.head).join("\n"),
  shouty.slice(0, 4).map((s) => s.rel + ":" + s.line));

if (failed) { console.log("[doc-sections] " + failed + " failure(s)"); process.exit(1); }

const med = worst[Math.floor(worst.length / 2)].lines;
console.log("[doc-sections] PASS — " + sections.length + " sections across " + REQUIRED.length +
  " documents on the reading path; longest " + worst[0].lines + " lines (cap " + MAX_LINES + "), median " +
  med + ", " + soft.length + " over " + SOFT + " (cap " + SOFT_OVER + "). THE MECHANISM IS LENGTH, NOT " +
  "EMPHASIS: a heading can only outlive its body if the two are never seen together, and every " +
  "previous answer to that here was a louder heading. Before this landed the path held 107 sections " +
  "with a median of 19 and ONE OF 1,032 LINES. BOTH CAPS ONLY EVER GO DOWN — split the section, " +
  "never raise the number. Longest now: " + worst[0].rel + ":" + worst[0].line + ".");
process.exit(0);
