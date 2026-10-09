// tests/_fixture-verdicts.js
// FIXTURE GUARDS for `check-runner-verdict.js`. Not named `check-*.js` on purpose: `run-all.js`
// discovers its members by that pattern, so a fixture named that way would join the real suite and
// fail it. This file is a LIBRARY of tiny programs the verdict guard spawns as child processes.
//
// They are spawned rather than simulated because the thing under test is a verdict about a REAL
// process's exit code and stdout. A hand-written string would test the regexes; a spawned process
// tests what the runner will actually be handed.

const CASES = {
  // THE ONE THAT SHIPPED GREEN AND SHOULD NOT HAVE. A guard whose failure gate sits above one of
  // its parts prints this exact shape: a FAIL announcement, then its PASS summary, then exit 0.
  "fail-then-pass": [
    'console.log("[fixture] FAIL — a part of me failed");',
    'console.log("[fixture] PASS — and I summarise as though it had not");',
    "process.exit(0);",
  ],
  // Controls, so the rule is shown to admit as well as refuse.
  "clean-pass": [
    'console.log("[fixture] PASS — everything held");',
    "process.exit(0);",
  ],
  // Silence: the older defect this runner already caught, kept so a fix for the new one cannot
  // quietly undo the old one.
  "silent": ["process.exit(0);"],
  // A guard that fails properly.
  "honest-fail": [
    'console.log("[fixture] FAIL — something broke");',
    "process.exit(1);",
  ],
  // An admissibility gate refusing. Not a pass: it declined to answer, and an unanswered guard
  // must not read as a green one.
  "inadmissible": [
    'console.log("[fixture] INADMISSIBLE PART C — the reading never reached its subject");',
    "process.exit(0);",
  ],
  // THE FALSE-POSITIVE CONTROL. The word FAIL inside a PASS narrative is legitimate and common —
  // measured: one real guard does it today. A substring rule would refuse this, so this case is
  // what keeps the anchored form honest rather than merely strict.
  "pass-mentioning-failure": [
    'console.log("[fixture] PASS — THE FAILURE THIS GUARD PREVENTS IS SILENT, and a naive rule " +',
    '  "would read the word FAIL here and refuse a green guard");',
    "process.exit(0);",
  ],
};

module.exports = { CASES };
