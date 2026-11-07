// tests/check-scope-matcher.js
// SUBJECT: tools/context-for.js
//
// ── THE FAILURE THIS EXISTS FOR, WHICH HAPPENED TWICE ───────────────────────────────────────
// `tools/context-for.js` turns a job id into the list of files that job touches. It finds them by
// matching backticked paths in the entry's `Touches` field. If the matcher cannot see a file, the
// declaration naming it is silently dropped — the tool prints a shorter list, with no warning,
// and reads as a complete answer. A scoping tool that under-reports is worse than none, because
// the session trusts it and stops looking.
//
// It has now been too narrow twice, the same way both times:
//   · `index.html` — no directory prefix and the wrong extension, so it matched nothing. An entry
//     that correctly declared it had that declaration dropped, and `index.html` is where the
//     `<script>` list and the `?v=` tags live. Widened at ddjp_386.
//   · `app.js`, `sw.js`, `sw-register.js` — root-level `.js`. The ddjp_386 widening admitted
//     root-level `.html` and stopped one case short. FOUR `Touches` fields name `app.js`, one of
//     them an OPEN entry, and every one was dropped. `app.js` is the bootstrap: it owns the
//     YouTube hook, the encryption gate and the login/restore wiring.
//
// Twice is a pattern, and the pattern is that the matcher's idea of the tree is written by hand
// while the tree changes underneath it.
//
// ── WHAT THIS ASSERTS, AND WHY THE TAG SET IS THE RIGHT POPULATION ──────────────────────────
// Every file carrying a `?v=` tag in `index.html` is, by definition, app code the browser
// downloads — the exact set `08-build-and-deploy.md` §What `?v=` tracks calls the app. A job that
// changes one of them is a job whose most important file the scoping tool must be able to name.
// So: EVERY TAGGED FILE MUST BE MATCHABLE. The population is derived from `index.html` rather than
// listed here, for the same reason the matcher now derives its directories from the tree.
//
// This does NOT assert the matcher is otherwise correct, and deliberately does not test that bare
// prose names are excluded — that judgement lives in `context-for.js` beside the measurement that
// produced it (52 of 57 newly-matched tokens were prose), and duplicating it here would create the
// second copy this guard exists to prevent.
//
// ── WHY IT IMPORTS THE PATTERN INSTEAD OF HOLDING ONE ───────────────────────────────────────
// A guard carrying its own copy of the regex would pass against a drifted tool forever. It
// requires `tools/context-for.js` and reads `SRC_RE` off it, so it is testing the pattern the tool
// actually uses. That is why the tool gained a `require.main === module` line.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let failed = 0;
function ok(cond, msg, got) {
  if (!cond) {
    console.log("[scope-matcher] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
    failed++;
  }
}
function refuse(msg) {
  console.log("[scope-matcher] FAIL — REFUSED: " + msg);
  console.log("[scope-matcher] 1 failure(s)");
  process.exit(1);
}

// ── THE MATCHER, FROM THE TOOL ITSELF ───────────────────────────────────────────────────────
let SRC_RE, TREE_DIRS;
try {
  ({ SRC_RE, TREE_DIRS } = require("../tools/context-for.js"));
} catch (e) {
  refuse("could not require `tools/context-for.js` to read its matcher: " + (e && e.message) +
         ". This guard tests the tool's REAL pattern rather than a copy, so it cannot fall back " +
         "to one.");
}
if (!(SRC_RE instanceof RegExp)) {
  refuse("`tools/context-for.js` no longer exports `SRC_RE` as a RegExp. Without it this guard " +
         "would have to carry its own copy of the pattern, which is the drift it exists to catch.");
}

// ── THE POPULATION: EVERY CACHE-BUSTED FILE ─────────────────────────────────────────────────
const idxPath = path.join(ROOT, "index.html");
if (!fs.existsSync(idxPath)) refuse("index.html is not at the tree root; the tag set cannot be derived.");
const idx = fs.readFileSync(idxPath, "utf8");

const tagged = [...new Set(
  [...idx.matchAll(/src="([^"]+?)\?v=\d+"/g)].map((m) => m[1])
)].sort();

ok(tagged.length > 10,
  "fewer tagged files than expected were found in index.html — the tag-shape match may have " +
  "drifted from the document. A population of almost nothing passes trivially and guards nothing",
  tagged.length);
if (tagged.length <= 10) { console.log("[scope-matcher] " + failed + " failure(s)"); process.exit(1); }

// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────
// Each path is presented exactly as an entry would write it: inside backticks.
function matches(rel) {
  SRC_RE.lastIndex = 0;
  const hits = [...("`" + rel + "`").matchAll(SRC_RE)].map((m) => m[1]);
  return hits.includes(rel);
}

const blind = tagged.filter((t) => !matches(t));
ok(blind.length === 0,
  "THE SCOPING TOOL CANNOT SEE " + blind.length + " CACHE-BUSTED FILE(S). A `Touches` field naming " +
  "one of these has that declaration SILENTLY DROPPED — the tool prints a shorter list and reads " +
  "as complete, which is how `app.js` went unscopable while four entries declared it.\n" +
  "      Widen the matcher in `tools/context-for.js`; do not narrow this guard.",
  blind);

// Root-level files are the case that has now been missed twice, so it is asserted by NAME as well
// as by population — a tag set that stopped containing them would otherwise make this pass by
// having nothing left to check.
const rootTagged = tagged.filter((t) => !t.includes("/"));
ok(rootTagged.length > 0,
  "no ROOT-LEVEL tagged file was found in index.html. That is the exact case this guard was " +
  "written for (`app.js`, `sw-register.js`), so its disappearance is more likely a drifted match " +
  "than a real change to the tree — check the tag-shape pattern above before believing it",
  tagged.slice(0, 5));

ok(Array.isArray(TREE_DIRS) && TREE_DIRS.length > 3 && !TREE_DIRS.includes("node_modules"),
  "the tool's directory list is no longer being read from the tree (or has swept in node_modules). " +
  "A hand-written list is what made the matcher blind twice", TREE_DIRS);

if (failed) { console.log("[scope-matcher] " + failed + " failure(s)"); process.exit(1); }

console.log("[scope-matcher] PASS — all " + tagged.length + " cache-busted files in index.html are " +
  "matchable by `tools/context-for.js`, including " + rootTagged.length + " at the ROOT (" +
  rootTagged.join(", ") + ") — the case the matcher was blind to twice, most recently because the " +
  "ddjp_386 widening admitted root-level `.html` and stopped one case short of root-level `.js`. " +
  "THE PATTERN IS IMPORTED FROM THE TOOL, NOT COPIED, so this cannot agree with a drifted matcher; " +
  "the population is DERIVED from the tag set, not listed. Directories the tool admits (" +
  TREE_DIRS.length + ", read from the tree): " + TREE_DIRS.join(", ") + ".");
process.exit(0);
