// tests/_subjects.js
//
// THE ONE READER OF `// SUBJECT:` DECLARATIONS. Parse only — no policy.
//
// ── WHY THIS EXISTS: THE TWO COPIES DISAGREED, AND THE DISAGREEMENT WAS INVISIBLE ─────────────
// `check-guard-subject.js` and `tools/context-for.js` each carried their own reader of the same
// comment line. They did not agree, and nothing compared them:
//
//     carry a `// SUBJECT:` line  : 88     <- check-guard-subject called these DECLARED
//     context-for.js saw          : 87
//     the invisible one           : check-rule-homes.js -> docs/main/09-roadmap.md
//
// `context-for` filtered subject tokens with `/\.js$/` and then counted the survivors, so a guard
// whose subject is a document was not merely unmatchable — it was ABSENT FROM THE DENOMINATOR. A
// coverage line computed from that table would have reported `87 declared, 87 undeclared` against
// a tree holding 88 and 86: wrong in both halves, and wrong in the direction that reads as
// complete. That is the core signature — a plausible value rather than an error — manufactured
// inside the instrument built to refuse plausible values.
//
// The gap was about to widen. `check-guard-subject` was widened after `ddjp_359` was packaged to
// accept `.md`, `.html` and trailing-`/` directory populations; eight directory-population guards
// are still awaiting a subject, and every one of them would have been invisible to the same filter.
//
// ── THE PRECEDENT, AND IT IS THE SAME ONE ────────────────────────────────────────────────────
// `tests/_docs.js` exists because three guards answered "where are the docs" separately and one
// answered it with a literal `docs_343`, so the packaging convention broke the build the first time
// somebody obeyed it. There is one resolver now. A third copy of the SUBJECT regex is that drift
// again, so the regex moves here and the two callers stop holding their own.
//
// ── WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────
// OWNS — how you READ a declaration out of a guard file:
//   · which files in `tests/` are guards
//   · where a declaration may sit (the first HEAD_LINES lines)
//   · how many declaration lines a file carries, and which one is authoritative (the first)
//   · how the declared text splits into tokens
//
// DOES NOT OWN — what a declaration MEANS, which is policy and stays with its consumer:
//   · which token shapes are admissible (`.js` / `.md` / `.html` / trailing `/`)
//   · whether a named path must exist, and in which tree it is resolved
//   · the `EXCLUDED` ratchet, and what an exclusion must carry to count as one
//   · whether a second declaration line is an error
//
// The split is the point. Two consumers asking DIFFERENT questions of the same text is correct;
// two consumers disagreeing about what the text SAYS is the defect above. Only the second is
// removed here — `check-guard-subject` keeps its admissibility rule and `context-for` keeps its
// `.js` matching filter, because those are two questions and they are allowed different answers.
//
// A CONSUMER THAT COUNTS MUST COUNT FROM `census()`, NOT FROM ITS OWN FILTERED TABLE. That is the
// defect restated as a rule, and `check-subject-census.js` pins it by driving both consumers and
// comparing what they report.

const fs = require("fs");
const path = require("path");

const DIR = __dirname;

// A DECLARATION MUST SIT NEAR THE TOP, AND 60 IS THE SHIPPED RULE RATHER THAN A NEW CHOICE.
// Both readers used 60 already; it is named once here so a change moves both at the same moment.
const HEAD_LINES = 60;

// THE STRICT PATTERN, WHICH IS `run-all.js`'S AND `check-guard-subject.js`'S. `context-for` used
// `/^check-.*\.js$/`, a looser rule selecting the same 174 files today and a DIFFERENT set the day
// somebody adds `check-Foo.js` — counted by the tool, never run by the suite, and not required to
// declare anything. Measured at the moment of writing: strict 174, loose 174, difference 0. The
// looser one is dropped rather than kept, because agreeing today is not the property wanted.
const GUARD_RE = /^check-[a-z0-9-]+\.js$/;

const SUBJECT_LINE_RE = /^\s*\/\/\s*SUBJECT:.+$/gm;
const SUBJECT_FIRST_RE = /^\s*\/\/\s*SUBJECT:\s*(.+)$/m;

// Every `check-*.js` in `tests/`, sorted. One definition, three callers.
function guardFiles() {
  return fs.readdirSync(DIR).filter((f) => GUARD_RE.test(f)).sort();
}

// Read one guard's declaration. Returns the SHAPE of what is written, never a judgement about it.
//
//   lines    every `// SUBJECT:` line in the head — a consumer decides whether >1 is an error
//   raw      the text after the FIRST line's colon, or null. The first is authoritative because
//            that is what both readers already did: a correction appended underneath is silently
//            inert, which is why `check-guard-subject` refuses the second line rather than
//            reading it. This module reports the count and leaves the refusal there.
//   tokens   `raw` split on commas and whitespace, unfiltered. Filtering is the consumer's rule.
//   declared whether a declaration is present AT ALL — the predicate the census counts, and the
//            one the old `.js` filter silently replaced with a narrower question.
function readSubject(file) {
  const head = fs.readFileSync(path.join(DIR, file), "utf8").split("\n").slice(0, HEAD_LINES).join("\n");
  const lines = head.match(SUBJECT_LINE_RE) || [];
  const m = head.match(SUBJECT_FIRST_RE);
  const raw = m ? m[1] : null;
  return {
    file,
    lines,
    raw,
    tokens: raw ? raw.split(/[,\s]+/).filter(Boolean) : [],
    declared: !!m,
  };
}

// THE DENOMINATOR, AND THERE IS ONLY THIS ONE. `check-guard-subject` asserts
// `declared + excluded === guards`, which is what makes `undeclared` here and its `excluded`
// the same number by construction rather than by two counts agreeing.
function census() {
  const guards = guardFiles();
  const declared = guards.filter((g) => readSubject(g).declared).length;
  return { guards: guards.length, declared, undeclared: guards.length - declared };
}

module.exports = { HEAD_LINES, GUARD_RE, guardFiles, readSubject, census };
