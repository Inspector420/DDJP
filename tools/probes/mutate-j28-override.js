// tools/probes/mutate-j28-override.js
//
// Confirms every assertion in `tests/check-override-origin.js` is LOAD-BEARING, by breaking the
// thing each one is about and watching it go red. A guard that stays green when its subject is
// broken reports safety that is not there — and this project's own rule is that the guard you
// wrote minutes ago is the likeliest place for a decorative assertion (five found that way, every
// one fresh). This guard is a GUARD OVER A GAP, which makes the risk worse rather than better:
// several of its assertions describe behaviour that is currently WRONG, and an assertion that
// merely restates a wrong answer without being able to notice it changing is a note, not a pin.
//
// TWO RULES FROM 09-roadmap.md §8, BOTH APPLIED HERE:
//   · ASSERT THE EDIT APPLIED, and assert it STILL applies when the result is read. `_journal.open`
//     refuses an anchor matching nothing or matching more times than expected, and `stillApplied`
//     is re-checked after the guard runs. Before-only is worthless when two hands hold the tree.
//   · PREFER THE DIRECTION WHERE THE EXPECTED RESULT IS A CHANGE. A mutation expected to leave the
//     output alone cannot detect its own failure to apply. Every row below expects a RED.
//
// AND RED BY CRASH IS NOT RED ENOUGH. A mutation that kills the guard by throwing before the
// assertion written for it is one swallowed exception away from killing nothing, so each row
// records whether the failure came from an `AssertionError` (the assertion fired) or from
// something else (the guard died on the way there), and the latter is reported as a WEAK red.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const journal = require(path.join(__dirname, "_journal.js"));

const ROOT = path.join(__dirname, "..", "..");
const SM = path.join(ROOT, "backends", "backend1", "streammanager.js");
const CP = path.join(ROOT, "backends", "backend1", "checkpoint.js");
const FL = path.join(ROOT, "backends", "backend1", "floor.js");
const GUARD = path.join(ROOT, "tests", "check-override-origin.js");

// ── RECOVERY FIRST ───────────────────────────────────────────────────────────────────────────
// A previous run that died mid-mutation leaves the tree dirty, and a dirty tree read as a
// measurement is the failure this journal exists for.
const rec = journal.recover();
if (rec.restored.length) {
  console.log("[journal] RECOVERED a dirty tree from a previous run:");
  for (const r of rec.restored) console.log("          restored " + r.file + " (left by " + r.probe + ")");
} else if (rec.skipped.length) {
  for (const s of rec.skipped) console.log("[journal] SKIPPED " + s.file + " — " + s.why);
} else {
  console.log("[journal] clean — no previous run left anything mutated");
}

function runGuard(elsewhere) {
  const target = elsewhere ? path.join(ROOT, "tests", elsewhere) : GUARD;
  try {
    execFileSync(process.execPath, [target], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { red: false, kind: null, msg: null };
  } catch (e) {
    const out = String((e.stderr || "") + (e.stdout || ""));
    // TWO REPORTING CONVENTIONS IN THIS SUITE, AND ONLY ONE WAS RECOGNISED. Most guards throw
    // through `assert.ok`; several — `check-seed-validation` among them — print
    // `[name] FAIL — <the assertion>` and exit non-zero instead, which is arguably the better
    // report because it names the assertion without a stack. Testing only for `AssertionError`
    // classified those as RED-BY-CRASH (weak): a clean, named, attributable red demoted to "the
    // guard died before reaching an assertion". Found at v254 when three rerouted rows landed on
    // a guard that uses the second convention. A runner that cannot read half the suite's
    // failures reports weakness that is not there, which is the same species of wrong as
    // reporting strength that is not there.
    const namedFail = /^\[[a-z0-9-]+\] FAIL — /m.test(out);
    const assertion = /AssertionError/.test(out) || namedFail;
    // THE MESSAGE, NOT THE STACK FRAME. The first version of this captured the line after the
    // AssertionError header, which in Node is `at ok (...check-override-origin.js:32:10)` — the
    // same string for every failure, because every assertion goes through one `ok`. That reported
    // ten identical reds and told me nothing about WHICH assertion fired, which is exactly the
    // attribution 08-build-and-deploy.md §Writing a guard says a mutation pass is measuring.
    const m = out.match(/AssertionError \[ERR_ASSERTION\]:\s*([^\n]+)/);
    const named = out.match(/^\[[a-z0-9-]+\] FAIL — (.*)$/m);
    const first = (out.split("\n").find((l) => /Error/.test(l)) || "").trim();
    return { red: true, kind: assertion ? "assertion" : "crash",
             msg: (named ? named[1] : (m ? m[1] : first)).trim().slice(0, 110) };
  }
}

const results = [];
// `elsewhere` reroutes a row to the guard that OWNS its rule now. J46 (v254) rewrote
// `check-override-origin`, and five rows here stopped targeting assertions in it — not because
// the rules stopped mattering, but because the fixture that caught them incidentally (an imported
// room whose seed could never validate) now validates. A per-guard runner that kept reporting
// those as SURVIVED would be announcing lost coverage that is not lost, and one that silently
// dropped them would be hiding coverage that might be. Rerouting is the third option and the only
// honest one: the rule is still asserted to be guarded, by a named guard, and the claim is DRIVEN
// rather than written in a comment — if `check-seed-validation` ever stops catching M1, this says so.
function mutation(id, file, what, find, replaceWith, expect, elsewhere) {
  const h = journal.open("mutate-j28-override:" + id, file);
  let applied = 0;
  try {
    applied = h.apply(find, replaceWith, expect == null ? 1 : expect);
  } catch (e) {
    h.restore();
    results.push({ id, what, verdict: "ANCHOR FAILED", detail: e.message });
    console.log("  " + id + "  ANCHOR FAILED — " + e.message);
    return;
  }
  const marker = replaceWith.slice(0, Math.min(40, replaceWith.length));
  const r = runGuard(elsewhere);
  const still = h.stillApplied(marker);
  h.restore();

  // A green mutation is VOID rather than a survivor if the edit was not still in place when the
  // guard read the tree — 09-roadmap.md §8: a poisoned row kept for comparison is worse than none.
  const verdict = !still ? "VOID (the edit was gone by read time)"
    : r.red ? (r.kind === "assertion" ? "RED" : "RED-BY-CRASH (weak)")
    : "SURVIVED";
  results.push({ id, what, verdict, applied, detail: r.msg, elsewhere: elsewhere || null });
  console.log("  " + id + "  " + verdict + "  (" + applied + " site) — " + what
    + (elsewhere ? "   [owned by " + elsewhere + " since v254]" : ""));
  if (r.red && r.msg) console.log("        reported by: " + r.msg);
}

console.log("");
console.log("mutate-j28-override — is check-override-origin load-bearing? (rescoped v254)");
console.log("============================================================");
console.log("");

// ── M1 — PART A's verdict. If the check stopped recording `mismatched` and recorded the
// retryable value instead, the collision would read as survivable and J28's whole settlement
// would be built on it. This is the single most consequential string in the finding.
mutation("M1", SM, "the pre-forget check records `not-yet-run` instead of `mismatched`",
  `_recordValidation("mismatched", "diverges-from-genesis", sig);`,
  `_recordValidation("not-yet-run", "diverges-from-genesis", sig); /*M1*/`,
  1, "check-seed-validation.js");

// ── M2 — PART A's CONTROL. The control asserts an ordinary room reaches `validated`. If it could
// never reach it, every `mismatched` below would attribute to the harness rather than the import
// — which is precisely the null-in-every-tree failure the probe's gate exists for. Breaking the
// validated branch must turn the control red, or the control is decorative.
mutation("M2", SM, "an ordinary room can no longer reach `validated` (the control's subject)",
  `_recordValidation("validated", null, sig);`,
  `_recordValidation("not-yet-run", "m2", sig); /*M2*/`);

// ── M3 — PART A's conclusiveness. `mismatched` is conclusive only because the throttle key is set
// on a conclusion. Leave it unset and the check re-runs for ever — which is a different (and
// survivable) world, and the assertion that five honest events do not move it must notice.
mutation("M3", SM, "a conclusion no longer sets the throttle key, so nothing is conclusive",
  `if (status === "validated" || status === "mismatched") _lastValidatedCp = sig || null;`,
  `if (status === "validated") _lastValidatedCp = sig || null; /*M3*/`,
  1, "check-seed-validation.js");

// ── M4 — PART A's licence assertion. `seedLicensesForget` is the predicate the whole chain hangs
// on. If it answered true regardless of the verdict, the collision would have no consequence and
// the entry's premise would be wrong in the opposite direction.
mutation("M4", SM, "the licence ignores the verdict and answers true regardless",
  `if (seedValidation().status !== "validated") return false;`,
  `if (false) return false; /*M4*/`,
  1, "check-seed-validation.js");

// ── M5 — PART C, the GAP itself. This is the assertion that changed the job, so it is the one
// that most needs to be able to fail. Make `_deriveBest` apply the seed whenever it holds one —
// which is roughly what a fix would do — and the room WOULD derive the file's state, so the
// gap assertion must go red. A pin that cannot notice its subject being fixed is a note.
mutation("M5", SM, "the seed is applied to live state whenever one is held (roughly: the fix)",
  `    const genesis = _remember(StateDeriver.deriveBoth(ordered));`,
  `    const _s0 = _trustedSeed();\n    if (_s0) return _remember(StateDeriver.deriveBoth(_eventsAfterCheckpoint(ordered) || [], _s0)); /*M5*/\n    const genesis = _remember(StateDeriver.deriveBoth(ordered));`);


// ── M6 — PART C's trim assertion. The gap is circular only because the client has not trimmed.
// If `trimToFloor` dropped the licence requirement it would trim, switch to the seeded fold, and
// the room would show the file's state — so the `_trimState() === null` assertion must notice.
mutation("M6", SM, "trimToFloor stops requiring the seed licence",
  `    if (!seedLicensesForget()) return 0;`,
  `    if (false) return 0; /*M6*/`,
  1, "check-forget-live.js");

// ── M7 — PART D. The override outranks an incumbent because ADOPTION compares position. Compare
// the private seal counter instead — the mistake the code documents itself against — and an n=1
// override loses to an n=3 incumbent, so the adoption assertion must fire.
mutation("M7", FL, "adoption compares the private seal counter `n` instead of position",
  `    if (_trusted && _pos(f) <= _pos(_trusted)) return false;        // not an improvement`,
  `    if (_trusted && (f.n || 0) <= (_trusted.n || 0)) return false; /*M7*/`);

// ── M8 — PART E. The owner-only finding rests on `chainVerifies` refusing a foreign log. Make it
// answer true unconditionally and the constraint evaporates — the assertion must catch it. Note
// this mutation is expected to break the CONTROLS too; what matters is that the file goes red and
// names one of them, since attributing WHICH assertion needs the ones ahead of it cleared.
mutation("M8", FL, "chainVerifies accepts any chain against any log",
  `  function chainVerifies(cps, log) {`,
  `  function chainVerifies(cps, log) { if (true) return true; /*M8*/`);

// ── M9 — PART F. The two refusals differing is the whole of the finding, so collapse them: rename
// the running room's `not-due` to `nothing-changed` and the `gNew.reason !== gRun.reason`
// assertion must fire. This is the row that proves PART F is about the DIFFERENCE rather than
// about both refusing, which is what it would have measured if written carelessly.
//
// THE FIRST VERSION OF THIS ROW WAS A PLACEBO AND IS RECORDED RATHER THAN QUIETLY REPLACED. It
// annotated the `nothing-changed` return with a comment and changed no behaviour, so it survived
// and could not tell its own failure to express the rule from a genuinely unguarded line — the
// exact variety 09-roadmap.md §8 lists. Its replacement's first anchor then matched NOTHING,
// because the `not-due` return wraps across two lines; the journal's refusal reported it, which
// is the machinery working and the reason removing refusals to move faster is how this goes
// unnoticed.
mutation("M9", CP, "the `not-due` refusal is renamed, collapsing the pair of reasons",
  `return { ok: false, reason: "not-due", sinceFloor: sinceFloor, newEvents: changed,`,
  `return { ok: false, reason: "nothing-changed", sinceFloor: sinceFloor, newEvents: changed, /*M9*/`);

// ── M10 — PART C's own CONTROL. The control asserts the file's seed really carries a rotation, so
// "the room does not show it" is a statement about the room. Empty the seed's members and the
// control must fire FIRST — if it does not, the gap assertion could pass against an empty file
// and prove nothing, which is the control-that-varies-the-wrong-axis failure.
mutation("M10", CP, "buildImport strips the seed's members, so the file carries no rotation",
  `    const s = Object.assign({}, seed, { settings: merged, settingsFrom: a.settingsFrom });`,
  `    const s = Object.assign({}, seed, { settings: merged, settingsFrom: a.settingsFrom, members: {} }); /*M10*/`,
  1, "check-origin-fold.js");

// ── SUMMARY ──────────────────────────────────────────────────────────────────────────────────
console.log("");
const reds = results.filter((r) => r.verdict === "RED").length;
const weak = results.filter((r) => /RED-BY-CRASH/.test(r.verdict)).length;
const survived = results.filter((r) => r.verdict === "SURVIVED");
const voids = results.filter((r) => /VOID/.test(r.verdict));
const badAnchor = results.filter((r) => r.verdict === "ANCHOR FAILED");
console.log("SUMMARY: " + results.length + " mutations — " + reds + " red, " + weak
  + " red-by-crash, " + survived.length + " survived, " + voids.length + " void, "
  + badAnchor.length + " anchor failures");
if (survived.length) {
  console.log("");
  console.log("SURVIVORS — suspect the FIXTURE before the assertion (08-build-and-deploy.md):");
  for (const s of survived) console.log("  " + s.id + " — " + s.what);
}
const j = JSON.parse(fs.readFileSync(journal.JOURNAL, "utf8"));
console.log("[journal] " + (j.entries.length === 0 ? "clean at exit — every mutation restored"
  : "DIRTY AT EXIT: " + j.entries.length + " entries, the next run will restore them"));
