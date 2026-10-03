// tests/check-guard-subject.js
// SUBJECT: tests/check-guard-subject.js
//
// WALL: every guard says WHAT IT IS ABOUT, or is excluded with a written reason.
//
// ── WHY THIS IS A DECISION GUARD AND NOT A DERIVED ONE ───────────────────────────────────────
// The question a session asks is "which guards will judge the file I am changing?", and today it
// is UNANSWERABLE. Measured on this tree before writing a line:
//
//     172 guards · 77 load MORE THAN SIX modules · 25 load none · 13 load exactly one
//
// So `loadInContext` is a DEPENDENCY list, not a subject, and a grep for a filename across
// `tests/` returns mostly sandbox loads. That is the thirty-fourth failure signature — a
// touch-count is not a coverage number — and it is why the naive answer here (derive the subject)
// does not work.
//
// IT WAS TRIED, AND THE MEASUREMENT IS THE REASON THIS FILE EXISTS. A single-load heuristic
// proposed `core/logger.js` as the subject of `check-savefile`, `check-import`,
// `check-override-origin` and `check-override-running`. All four are wrong — each makes one small
// secondary `loadInContext(["core/logger.js"])` call, and the heuristic caught that instead of the
// subject. Fifty-three subjects would have been written into this tree from that reading, and a
// wrong SUBJECT line is worse than none: it sends a session to the wrong guard CONFIDENTLY, which
// is a stale INSTRUCTION rather than a stale fact (`main/05-matrix.md` §Known federation notes —
// *a fact reads as wrong the moment somebody checks it; an instruction gets followed*).
//
// ── SO IT DEMANDS A DECISION, WHICH IS THIS SUITE'S OWN PATTERN ──────────────────────────────
// `08-build-and-deploy.md` §Writing a guard, *Decide, do not merely gate*: a derived rule that
// asserts one correct answer will be wrong somewhere; a guard that demands a DECISION cannot be
// wrong that way and still catches the real failure — a new case inheriting an answer nobody
// chose. Same shape as `check-runner-coverage`: every guard on disk is either RUN or EXCLUDED
// WITH A REASON, and an omission cannot pass as a choice.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY CANNOT:
//   · every `tests/check-*.js` carries a `// SUBJECT:` line, or is in EXCLUDED below with a reason
//   · every path a SUBJECT line names EXISTS — so a typo or a renamed module fails here rather
//     than sending a reader to a file that is not there
//   · every EXCLUDED key is a file that still exists — so the list cannot rot into a set of
//     exemptions for guards nobody has any more, which is how a dead copy survives (signature 36)
//   · it CANNOT check that a declared subject is the RIGHT one. Nothing can. That is a reading
//     job, and this guard's whole purpose is to make it a job somebody has to do rather than one
//     they can skip. Stated here so the next reader does not mistake a green for a confirmation.
//
// ── THE EXCLUSION LIST IS SEEDED FULL, AND IT ONLY EVER SHRINKS ──────────────────────────────
// Seeding it with a guessed subject per guard is the failure two paragraphs up. Seeding it EMPTY
// turns the suite red on arrival, which is not shippable. So every guard that exists today is
// excluded with one honest reason, and the ratchet is STRUCTURAL rather than a number: a guard
// added tomorrow is NOT in this list, so it must declare a subject or fail. Nothing has to
// remember the rule, and nothing counts anything.
//
// Filling these in is ordinary work — read the guard, name what it is about, delete its line here.
// The list shrinking IS the progress measure, and it is the list rather than a count of it.

const fs = require("fs");
const path = require("path");
const { docPaths } = require("./_docs.js");
// THE PARSE LIVES IN ONE PLACE. This guard and `tools/context-for.js` both read `// SUBJECT:`
// lines, held their own regex for it, and DISAGREED — the tool's reader filtered tokens to `.js`
// and then counted the survivors, so `check-rule-homes.js` (subject: a document) was missing from
// its denominator and its coverage would have read 87/87 against this tree's 88/86. The reader is
// now `_subjects.js` and the POLICY below is unchanged: which token shapes are admissible, where a
// path resolves, and the EXCLUDED ratchet are this guard's answers and stay here.
const { guardFiles, readSubject } = require("./_subjects.js");

const DIR = __dirname;
const ROOT = path.resolve(__dirname, "..");

// ── WHAT SHAPE A SUBJECT MAY BE ──────────────────────────────────────────────────────────────
// ONE DEFINITION, AND THERE WERE TWO. The token filter accepted `.js|.md|.html` while the
// directory-population check asked whether a directory held `.js|.html` — so a population of
// documents counted as EMPTY and was refused as a vacuous filter. Same file, two answers to one
// question, and nothing compared them. That is the drift `_subjects.js` was extracted to end, one
// level in: the PARSE is shared now, and this is the POLICY finally saying itself once.
//
// `.sh` AND `.json` ADMITTED BY OWNER RULING. `check-vendor-build`'s subject is
// `tools/build-vendor.sh` — a shell script carrying three shipped defects — plus the lockfile and
// `package.json` it pins versions against. Under the old set it could name NONE of them, so the one
// guard whose subject is a script could never declare one. That is the MECHANISM failing rather
// than the guard, which is what the three earlier widenings each established: when a true subject
// is unwriteable, widen the mechanism rather than trimming the truth or seeding a plausible list.
//
// Both new shapes resolve through the plain code-tree branch below, exactly as `.js` and `.html`
// do — no new resolution rule, only a wider set.
const SUBJECT_EXTS = ".js, .md, .html, .sh, .json";
const SUBJECT_FILE_RE = /\.(js|md|html|sh|json)$/;

// WHAT MAKES A DIRECTORY A REAL POPULATION — asked of every candidate path, in either tree, and
// stated once. `SUBJECT_FILE_RE` governs this and the token filter both; they disagreed once.
const populated = (d) => fs.existsSync(d) && fs.statSync(d).isDirectory() &&
                         fs.readdirSync(d).some((f) => SUBJECT_FILE_RE.test(f));

// ── EXCLUDED: guards that have not yet declared a subject ────────────────────────────────────
// ONE reason, because there is one reason. Delete a line when you have read that guard and put a
// `// SUBJECT:` line in it. Do not add to this list to make a red go away — a new guard failing
// here is this guard working.
const NO_SUBJECT_YET =
  "subject not yet declared — read the guard and add a `// SUBJECT:` line, then delete this row";

// FROZEN AS A LITERAL, AND THE FIRST VERSION OF THIS WAS NOT — WHICH IS WHY THE LIST IS HERE.
// It was built by reading `tests/` at RUN TIME, so it seeded itself with whatever was on disk,
// including a guard added five seconds earlier. The ratchet did not exist, and the comment above
// it claimed it did. DRIVEN: a new `check-zz-new.js` carrying no SUBJECT line went GREEN.
// That is the second failure signature — a message naming an action it does not take — inside a
// guard written to prevent exactly that, and it survived reading and was caught only by mutation.
// A literal list is the whole mechanism: a guard added tomorrow is NOT in these keys, so it has
// to declare a subject or fail. The keys are checked to exist below, so this cannot rot silently.

const EXCLUDED = {
};

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[guard-subject] FAIL — " + msg); failed++; } }

const guards = guardFiles();
ok(guards.length > 50, "the guard sweep found " + guards.length + " files, which is too few to be the suite — " +
   "a filter that matches nothing reports a vacuous pass (08-build-and-deploy.md §Writing a guard)");

let declared = 0, excluded = 0, comparedPaths = 0;

for (const g of guards) {
  const decl = readSubject(g);
  // TWO SUBJECT LINES IS TWO ANSWERS TO ONE QUESTION. The reader takes the FIRST and ignores the
  // rest, so a second line — a correction someone added below the original, or a paste — is
  // SILENTLY INERT. Found while trying to drive this guard red: the mutation was appended under an
  // existing line, the guard read past it, and the run reported a clean pass on a subject that was
  // never evaluated. A probe that does not apply reports the same green as a probe that passed.
  if (decl.lines.length > 1) ok(false, g + " carries " + decl.lines.length + " `// SUBJECT:` lines. Only the FIRST " +
     "is read, so the others are inert and a reader may act on the wrong one — keep one line, " +
     "listing every path it needs.");
  const isExcluded = Object.prototype.hasOwnProperty.call(EXCLUDED, g);

  if (!decl.declared) {
    ok(isExcluded, g + " declares no `// SUBJECT:` line and is not excluded. A guard nobody can " +
       "attribute is a guard a session cannot find: name what it is about in a comment in its " +
       "first 60 lines, or exclude it here with a reason.");
    if (isExcluded) {
      excluded++;
      ok(typeof EXCLUDED[g] === "string" && EXCLUDED[g].length > 10,
         g + " is excluded with no usable reason — an exclusion without one is an omission wearing " +
         "a decision's clothes (check-runner-coverage's rule, applied here)");
    }
    continue;
  }

  declared++;
  ok(!isExcluded, g + " BOTH declares a subject and sits in EXCLUDED. Two answers to one question " +
     "is the drift P7 is about — delete its row from EXCLUDED.");

  // A GUARD'S SUBJECT CAN BE A DOCUMENT. `check-rule-homes` guards §6 of the roadmap, and the
  // first version of this rule accepted only `.js` — so the first doc-subject guard written after
  // it failed here, correctly reporting a SUBJECT line naming no path. The rule was too narrow, not
  // the guard. A `.md` subject resolves through the shared doc-tree resolver, never a literal path,
  // because the docs are a SIBLING tree whose directory name carries the package number.
  // THREE THINGS THE FIRST VERSION COULD NOT EXPRESS, ALL FOUND BY USING IT ON 88 GUARDS.
  //
  // 1. A DIRECTORY POPULATION. `check-html-safety`, `check-no-media`, `check-log-hygiene`,
  //    `check-storage` and `check-ui-no-permission` scan EVERY file under a directory; so do the
  //    module-accounting guards (`check-local-evidence`, `check-room-scope`, `check-rank-injection`)
  //    which assert that every module either complies or is listed with a written reason. Their
  //    subject IS the population. Hand-listing the members would rot silently the first time a file
  //    was added — the `KNOWN_GLOBALS` shape — so a trailing `/` declares the directory itself, and
  //    it is checked to exist AND be non-empty. `check-local-evidence` is the trap in that group: it
  //    reads `continuity.js` as its worked example, so it LOOKS single-subject, and naming that file
  //    would point a reader at one row of a whole-population check.
  //
  // 2. `.html`. The filter was `/\.(js|md)$/`, so `check-version-banner`'s declared
  //    `app.js, index.html` silently verified only half of what it said. Thirteen guards read
  //    `index.html` as text, so this was going to recur.
  //
  // 3. A `.md` THAT LIVES IN THE CODE TREE. `check-vendor-build`'s subject is
  //    `tools/VENDOR_PROVENANCE.md`, which ships with the CODE — but `.md` resolved only through
  //    `docPaths()`, which searches the docs sibling. It could not declare a subject at all.
  // THE ADMISSIBILITY RULE IS THIS GUARD'S, NOT THE READER'S. `_subjects.js` hands over every
  // token the line holds; which shapes count as a subject is policy and is decided here.
  const paths = decl.tokens.filter((s) => SUBJECT_FILE_RE.test(s) || /\/$/.test(s));
  ok(paths.length > 0, g + " has a SUBJECT line naming no subject-shaped path (" + SUBJECT_EXTS +
     ") and no directory: " + JSON.stringify(decl.raw));
  for (const p of paths) {
    comparedPaths++;
    let found;
    if (/\/$/.test(p)) {
      // EITHER TREE, exactly as `.md` does below. A `.md` has resolved in both since
      // `check-vendor-build` needed one that ships with the CODE; a directory is the same question
      // about the same two trees, and leaving it half-answered meant `check-doc-xrefs` — the guard
      // that polices doc citations — was the one guard unable to say what it is about. Its subject
      // is the doc tree as a population and `docs/main/` was refused as nonexistent.
      //
      // `populated()` is ONE rule applied to every candidate in both trees: a directory subject must
      // exist AND hold something, because an empty directory is a population of nothing — the
      // vacuous-filter failure wearing a subject line. It is a single function rather than a
      // repeated condition because THIS FILE HAS ALREADY GROWN A SECOND ANSWER ONCE: the token
      // filter accepted `.js|.md|.html` while this check asked for `.js|.html`, so a population of
      // documents counted as empty and nothing compared the two.
      found = [path.join(ROOT, p), ...docPaths(p.replace(/^docs\//, ""))].some(populated);
    } else if (/\.md$/.test(p)) {
      // Either tree: the docs sibling for a doc, or the code tree for a `.md` that ships with it.
      found = fs.existsSync(path.join(ROOT, p)) ||
              docPaths(p.replace(/^docs\//, "")).some((c) => fs.existsSync(c));
    } else found = fs.existsSync(path.join(ROOT, p));
    ok(found,
       g + " names `" + p + "` as its subject and that file does not exist. A subject line pointing " +
       "at a moved or renamed module is exactly the stale instruction this guard exists to stop.");
  }
}

// The exclusion list may not outlive its subjects. A row for a guard that has been deleted is a
// dead copy — inert, authoritative-looking, and the copy most likely to be wrong, because the
// thing that would have corrected it is use (signature 36).
for (const k of Object.keys(EXCLUDED)) {
  ok(fs.existsSync(path.join(DIR, k)), "EXCLUDED names `" + k + "`, which is not a file. Delete the row.");
}

// A FILTERED CHECK MUST ASSERT IT FILTERED TO SOMETHING. Without this, a regex that stopped
// matching SUBJECT lines would report every guard as excluded and pass in silence.
ok(declared + excluded === guards.length,
   "every guard must be accounted for: " + declared + " declared + " + excluded + " excluded != " +
   guards.length + " on disk");
ok(declared >= 1, "no guard declares a subject at all — this guard declares its own, so zero means " +
   "the SUBJECT reader is broken rather than that the tree is unlabelled");

// THE GATE IS AT THE SINGLE EXIT, BELOW EVERY PART, AND THERE IS NO ASYNC SECTION ABOVE IT.
// Two guards in this suite have printed FAIL and exited 0 because a part was appended under the
// gate, and a third because the gate was last in the FILE and not last in TIME. If this file ever
// grows an async part, the gate moves into that chain — it does not stay here.
if (failed) { console.log("[guard-subject] " + failed + " failure(s)"); process.exit(1); }
console.log("[guard-subject] PASS — every guard either declares what it is ABOUT or is excluded with a " +
  "written reason (" + declared + " declared, " + excluded + " awaiting one, " + comparedPaths +
  " subject path(s) confirmed to exist). THIS GUARD CANNOT TELL YOU A DECLARED SUBJECT IS THE RIGHT " +
  "ONE — nothing can; it makes the omission impossible and the path checkable. The exclusion list is " +
  "seeded from the tree and only ever SHRINKS: a guard added tomorrow is not in it, so it must " +
  "declare or fail. Derivation was tried first and refused — a load list is a dependency list (77 of " +
  "172 guards load more than six modules), and the single-load heuristic named `core/logger.js` as " +
  "the subject of four guards it is not");
process.exit(0);
