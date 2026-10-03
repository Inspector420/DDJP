// tests/check-subject-census.js
// SUBJECT: tests/_subjects.js, tools/context-for.js
//
// WALL: the two consumers of `_subjects.js` must agree on HOW MANY GUARDS DECLARE A SUBJECT.
//
// ── THE DEFECT THIS PINS, WHICH SHIPPED AND WAS FOUND BY READING ─────────────────────────────
// `check-guard-subject.js` and `tools/context-for.js` each held their own reader of the same
// `// SUBJECT:` comment. They did not agree:
//
//     carry a `// SUBJECT:` line   : 88      <- check-guard-subject called these DECLARED
//     context-for.js counted       : 87
//     the invisible one            : check-rule-homes.js -> docs/main/09-roadmap.md
//
// `context-for` filtered subject tokens to `.js` and then counted the survivors, so a guard whose
// subject is a DOCUMENT was not merely unmatchable — it was missing from the denominator. Had the
// coverage line been computed from that table it would have printed `87 declared, 87 undeclared`
// against a tree holding 88 and 86: wrong in both halves, and wrong in the direction that reads as
// complete. The reader is shared now; this guard is what stops the two drifting apart again.
//
// ── WHY A COVERAGE LINE NEEDS PINNING AT ALL ─────────────────────────────────────────────────
// The line exists to say *the guard list above is a FLOOR*. A floor stated by a number that has
// quietly gone wrong is worse than no floor, because the reader now has a figure to trust. This is
// the third failure signature — a number describing the tree, written where nothing recomputes it —
// except the number IS recomputed, from a place that could narrow without anybody noticing. So the
// property checked is not the VALUE (which moves every time Job A fills a row, and a literal here
// would be the dead copy of signature 36); it is that two independently-run programs answer the
// same question identically.
//
// ── THE METHOD: SPAWN, DO NOT RE-IMPLEMENT ───────────────────────────────────────────────────
// Both numbers are read out of the REAL programs' output, the way `check-runner-verdict` drives
// spawned fixture programs rather than hand-written strings. A guard that required `_subjects.js`
// and recomputed the census would prove a third copy correct and would have been GREEN throughout
// the defect above, because the defect was never in the shared reader — it was in what one caller
// did with it afterwards.
//
// DRIVEN BOTH WAYS. Reinstating the `.js` filter as the counting rule in `context-for.js` moves it
// to 87 against `check-guard-subject`'s 88 and this guard goes red on PART B, naming both numbers.
// The control is that it passes with the filter removed, which is the shipped tree.
//
// WHAT IT DELIBERATELY DOES NOT CHECK: whether either number is CORRECT. Nothing here can know
// that — `check-guard-subject`'s own accounting (`declared + excluded === guards on disk`) is what
// makes the count true of the tree, and it is asserted there rather than copied here.

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[subject-census] FAIL — " + msg); failed++; } }

function run(rel, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel), ...args], { encoding: "utf8", cwd: ROOT });
  return (r.stdout || "") + (r.stderr || "");
}

// ── PART A — BOTH PROGRAMS MUST ANSWER AT ALL ────────────────────────────────────────────────
// A FILTERED CHECK MUST ASSERT IT FILTERED TO SOMETHING. If either output stops matching — a
// reworded PASS line, a renamed flag, a crash — the comparison below has nothing to compare and
// would be satisfied by two `undefined`s. That is the vacuous pass this suite has shipped three
// times, so the extraction is checked before the numbers are.
const gsOut = run("tests/check-guard-subject.js", []);
const cfOut = run("tools/context-for.js", ["--coverage"]);

const gsM = gsOut.match(/\((\d+) declared, (\d+) awaiting one/);
const cfM = cfOut.match(/(\d+) of (\d+) guards declare a subject \(\d+%\); (\d+) declare nothing/);

// TWO CAUSES, AND A MESSAGE NAMING ONLY ONE SENDS THE READER TO THE WRONG FILE. There is no count
// to read either when check-guard-subject's wording moved OR when it FAILED — and the common way
// it fails is a code-only extraction, where `check-rule-homes.js` declares a `.md` subject that
// resolves through the docs sibling. Reported as "its wording moved", that is a stale instruction:
// the reader goes and reads a PASS line that is fine. So the two are separated here rather than
// collapsed, which is the twenty-third signature — a message cannot name a decision it was not told
// about, so this one is told.
const gsFailed = /^\[guard-subject\] FAIL/m.test(gsOut);
ok(!!gsM, gsFailed
   ? "check-guard-subject.js itself FAILED, so it printed no count for this guard to compare " +
     "against. Fix that guard first — this one has not found a divergence, it has been denied an " +
     "input. The usual cause is a code-only extraction: the docs ship WITH the tree, and " +
     "`ddjp_NNN/` and `docs_NNN/` must be unpacked as siblings."
   : "could not read a declared-count out of check-guard-subject.js's output, and that guard did " +
     "not announce a failure — so its PASS line was reworded. The count this guard compares comes " +
     "from that line; move this guard with it rather than silently comparing nothing. Got: " +
     JSON.stringify(gsOut.slice(0, 200)));
ok(!!cfM, "could not read a coverage line out of `node tools/context-for.js --coverage`. That flag " +
   "exists so this property can be driven without hard-coding a roadmap entry; if it was removed, " +
   "the coverage line lost its only net. Got: " + JSON.stringify(cfOut.slice(0, 200)));

if (gsM && cfM) {
  const gsDeclared = Number(gsM[1]);
  const gsAwaiting = Number(gsM[2]);
  const cfDeclared = Number(cfM[1]);
  const cfGuards = Number(cfM[2]);
  const cfUndeclared = Number(cfM[3]);

  // ── PART B — THE ONE PROPERTY ──────────────────────────────────────────────────────────────
  ok(gsDeclared === cfDeclared,
     "the two consumers of `tests/_subjects.js` disagree about how many guards declare a subject: " +
     "check-guard-subject says " + gsDeclared + ", context-for says " + cfDeclared + ". One of them " +
     "has narrowed the question — the shipped defect was `context-for` counting only subjects " +
     "matching `/\\.js$/`, which excludes a guard whose subject is a document or a directory " +
     "population. A `.js` filter is a MATCHING rule and must never be the COUNTING rule; count " +
     "from `census()`.");

  // ── PART C — THE TOTAL, WHICH IS THE HALF A READER ACTUALLY ACTS ON ────────────────────────
  // `88 of 174` and `86 declare nothing` are two statements about the same tree. If the numerator
  // agreed and the denominator drifted, the percentage would still read plausibly.
  ok(gsDeclared + gsAwaiting === cfGuards,
     "the guard total disagrees: check-guard-subject accounts for " + gsDeclared + " + " + gsAwaiting +
     " = " + (gsDeclared + gsAwaiting) + " guards, context-for reports a population of " + cfGuards +
     ". The filename patterns diverged once already — `/^check-.*\\.js$/` in the tool against " +
     "`/^check-[a-z0-9-]+\\.js$/` in the suite, the same 174 files then and a different set the " +
     "day somebody adds `check-Foo.js`.");
  ok(cfDeclared + cfUndeclared === cfGuards,
     "context-for's own coverage line does not add up: " + cfDeclared + " + " + cfUndeclared +
     " != " + cfGuards + ". The line is one sentence about one census and cannot disagree with itself.");

  // ── PART D — CONTROLS, SO A COLLAPSED CENSUS CANNOT SATISFY THE EQUALITIES ABOVE ───────────
  // Every assertion in B and C is satisfied by 0 === 0. A reader that stopped matching SUBJECT
  // lines entirely would report zero declared from BOTH consumers, agree perfectly, and pass.
  ok(cfGuards > 50, "the census reports " + cfGuards + " guards, which is too few to be this suite — " +
     "a filename filter matching nothing reports a vacuous pass (08-build-and-deploy.md §Writing a guard)");
  ok(cfDeclared > 0, "the census reports zero guards declaring a subject. `check-guard-subject.js` " +
     "declares its own, so zero means the shared reader is broken rather than that the tree is unlabelled.");
}

// ── THE RESIDUE MUST PRINT, AND IT IS DRIVEN BOTH WAYS (J56 close-out) ────────────────────────
// J56 sampled this map and did not verify it: 31 rows resolved, 13 wrong, in both directions and in
// every era. That caution belongs where a session MEETS the list, not only in the roadmap entry —
// J56 is closed, and a property recorded only inside a closed entry evaporates (J38's lesson, the
// same one that put the forty-eighth signature in the catalogue rather than the roadmap).
//
// BOTH WAYS, because a presence check alone passes on a line that says the opposite. The positive
// row requires the caution in the REAL tool's output; the negative row requires the matcher to
// REFUSE output with the caution stripped, so a future edit that deletes it cannot leave this green.
{
  const hasResidue = (s) => /SAMPLED, NOT VERIFIED/.test(s) &&
                            /neither COMPLETE/.test(s) && /nor EXCLUSIVE/.test(s);
  ok(hasResidue(cfOut),
     "`node tools/context-for.js --coverage` no longer prints the J56 residue. The subject map is " +
     "sampled rather than verified and the tool that hands a session a guard list is where that has " +
     "to be said; without it the list reads as complete and exclusive, which it is not.");
  const stripped = cfOut.split("\n").filter((l) => !/SAMPLED, NOT VERIFIED|COMPLETE|EXCLUSIVE/.test(l)).join("\n");
  ok(!hasResidue(stripped),
     "CONTROL — the residue matcher passes on output with the caution removed, so the row above " +
     "proves nothing. A check that cannot fail is the shape this file exists to prevent.");
}

// THE GATE IS AT THE SINGLE EXIT, BELOW EVERY PART, AND THERE IS NO ASYNC SECTION ABOVE IT.
// `spawnSync` is used rather than `spawn` precisely so this stays true: three guards in this suite
// have printed FAIL and exited 0, one of them because the gate was last in the FILE and not last in
// TIME. If this file ever grows an awaited part, the gate moves into that chain — it does not stay here.
if (failed) { console.log("[subject-census] " + failed + " failure(s)"); process.exit(1); }
console.log("[subject-census] PASS — the two consumers of `tests/_subjects.js` agree on the subject " +
  "census (" + (gsM ? gsM[1] : "?") + " declared of " + (cfM ? cfM[2] : "?") + "), read from the REAL " +
  "programs' output rather than recomputed here, because the defect this pins was never in the shared " +
  "reader — it was in what one caller did with it afterwards. `context-for` filtered subject tokens to " +
  "`.js` and then COUNTED the survivors, so a guard whose subject is a document sat outside the " +
  "denominator and a coverage line would have read 87/87 against a tree of 88/86: wrong in both halves, " +
  "in the direction that reads as complete. The VALUE is deliberately not pinned — it moves every time a " +
  "row is filled, and a literal here would be the dead copy that rots because nothing consults it. " +
  "THIS GUARD CANNOT TELL YOU EITHER NUMBER IS CORRECT; `check-guard-subject`'s own accounting is what " +
  "makes the count true of the tree, and the controls here only stop a collapsed census satisfying the " +
  "equalities with zeroes");
process.exit(0);
