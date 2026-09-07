// tests/check-runner-verdict.js
// WALL: THE RUNNER'S VERDICT. A guard cannot both fail and pass.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
// NOTHING TESTED `run-all.js` AT ALL, and that is how the defect below shipped. `check-runner-
// coverage.js` asks the runner WHICH guards it will run — a real and different question — and no
// guard asked how it DECIDES. So the suite's colour was the one claim in this tree with no wall
// behind it, and a false green here is a false claim about all 129 guards at once.
//
// THE DEFECT, DRIVEN ON A SHIPPED PACKAGE: the verdict was *exit 0, and `\bPASS\b` appears
// somewhere in stdout*. A guard printing `[x] FAIL …` then `[x] PASS …` and exiting 0 satisfied
// both halves, and `run-all` printed `✓ All guards passed` with a FAIL line on screen. That shape
// is not exotic — it is exactly what a guard produces when a new PART is appended below its own
// `if (failed) process.exit(1)` gate, which happened during J17's build and read as three green
// mutation rows against a tree whose folds had been deleted.
//
// ── WHAT IS DRIVEN, AND WHAT IS NOT SIMULATED ────────────────────────────────────────────────
// `verdictOf` is REQUIRED from `run-all.js` rather than re-implemented here, so this drives the
// function the loop actually calls; a copy would prove a copy correct. And the fixtures are
// SPAWNED as real child processes, so what the verdict sees is a real exit code and real stdout
// rather than a string this file wrote to please itself.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { verdictOf } = require(path.join(__dirname, "run-all.js"));
const { CASES } = require(path.join(__dirname, "_fixture-verdicts.js"));

let asserts = 0;
function fail(msg, got) {
  console.log("[runner-verdict] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

ok(typeof verdictOf === "function",
  "APPLIED — `run-all.js` must export `verdictOf`, or this guard is testing nothing. A runner "
  + "whose verdict is inline cannot be driven, which is the condition that let the defect ship",
  typeof verdictOf);

// Spawn each fixture and hand its REAL exit code and stdout to the REAL verdict.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddjp-verdict-"));
function run(name) {
  const file = path.join(dir, name + ".js");
  fs.writeFileSync(file, CASES[name].join("\n") + "\n");
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", verdict: verdictOf(r.status, r.stdout) };
}

// ── THE ROW THAT CATCHES THE DEFECT ──────────────────────────────────────────────────────────
{
  const r = run("fail-then-pass");
  ok(r.status === 0,
    "APPLIED — the fixture must EXIT 0, or the verdict below is refusing on the exit code and "
    + "says nothing about the announcement", r.status);
  ok(/^\[fixture\] FAIL/m.test(r.stdout) && /^\[fixture\] PASS/m.test(r.stdout),
    "APPLIED — and it must announce BOTH, or there is no contradiction to catch", r.stdout);
  ok(r.verdict.ok === false,
    "A GUARD THAT ANNOUNCES A FAILURE AND EXITS 0 IS NOT GREEN. This is the defect that shipped in "
    + "`ddjp_274`: both halves of the old rule were satisfied — exit 0, and a PASS line present — "
    + "so the suite reported every guard green while one of them said FAIL on screen", r.verdict);
  ok(/cannot both fail and pass/.test(r.verdict.why || ""),
    "and it says which contradiction it found, rather than reporting the generic silence case",
    r.verdict.why);
}

// ── THE CONTROLS. A rule shown only to refuse certifies nothing. ─────────────────────────────
{
  const r = run("clean-pass");
  ok(r.verdict.ok === true,
    "control: a guard that announces PASS and exits 0 IS green — without this the row above could "
    + "be satisfied by a verdict that refuses everything", r.verdict);
}
{
  // THE FALSE-POSITIVE CONTROL, and it is the reason the rule is anchored rather than a substring.
  // MEASURED on a green run of this suite: the word FAIL appears on exactly one line, inside a PASS
  // narrative describing the failure that guard prevents. A substring rule would refuse a green
  // suite; the announcement form appears zero times.
  const r = run("pass-mentioning-failure");
  ok(/FAIL/.test(r.stdout),
    "APPLIED — the fixture must contain the word FAIL, or it is not testing the distinction",
    r.stdout);
  ok(r.verdict.ok === true,
    "control: the word FAIL inside a PASS narrative is NOT a failure announcement. Guards describe "
    + "the failures they prevent, so a substring rule would refuse honest guards — the rule reads "
    + "the ANNOUNCEMENT FORM at line start, and both halves are anchored the same way", r.verdict);
}
{
  const r = run("silent");
  ok(r.status === 0 && r.stdout.trim() === "",
    "APPLIED — the silent fixture must exit 0 saying nothing", { status: r.status, out: r.stdout });
  ok(r.verdict.ok === false && /announced no PASS/.test(r.verdict.why || ""),
    "the OLDER rule still holds: a guard that runs nothing and exits 0 is not green. A fix for the "
    + "new defect must not quietly undo the one already caught", r.verdict);
}
{
  const r = run("honest-fail");
  ok(r.verdict.ok === false && /exited 1/.test(r.verdict.why || ""),
    "a guard that fails properly is refused on its exit code, and the reason names that rather "
    + "than the announcement — the three refusals are distinguishable", r.verdict);
}
{
  const r = run("inadmissible");
  ok(r.verdict.ok === false,
    "an ADMISSIBILITY GATE refusing is not a pass. A guard whose premise failed declined to "
    + "answer, and an unanswered guard must not read as a green one", r.verdict);
}

// ── AND THE SUITE THIS RUNNER JUDGES STILL PASSES THE STRICTER RULE ──────────────────────────
// Anchoring both halves is only safe if every guard already announces in that form. Asserted here
// against the real membership rather than assumed, so a guard added later with a different
// announcement fails HERE — with a reason — rather than being silently counted green.
{
  const { coverage } = require(path.join(__dirname, "run-all.js"));
  const members = coverage().run;
  ok(members.length > 100,
    "APPLIED — the coverage list must be populated, or the sweep below checks nothing",
    members.length);
  const odd = [];
  for (const g of members) {
    if (g === "check-runner-verdict.js") continue;   // this file; it is running
    const src = fs.readFileSync(path.join(__dirname, g), "utf8");
    if (!/\[[a-z0-9-]+\] PASS/.test(src)) odd.push(g);
  }
  ok(odd.length === 0,
    "every guard announces its pass in the `[name] PASS` form the verdict parses. A guard that "
    + "announced differently would be judged by a rule it does not follow", odd);
}

fs.rmSync(dir, { recursive: true, force: true });

console.log("[runner-verdict] PASS — the runner's verdict cannot call a guard green while that "
  + "guard announces a failure (" + asserts + " assertions). NOTHING TESTED `run-all.js` AT ALL "
  + "before this, which is how the defect shipped: the verdict was `exit 0 and \\bPASS\\b appears "
  + "somewhere`, and a guard printing `[x] FAIL …` then `[x] PASS …` satisfied both halves — the "
  + "suite announced every guard green with a FAIL line on screen. That shape is what a guard "
  + "produces when a new PART is appended below its own `process.exit(1)` gate. `verdictOf` is "
  + "REQUIRED from `run-all.js` rather than restated, so this drives the function the loop calls, "
  + "and the fixtures are SPAWNED so the verdict judges a real exit code and real stdout. Both "
  + "halves of the rule are ANCHORED to the announcement form, measured: the word FAIL appears in "
  + "a green run only inside a PASS narrative, so a substring rule would refuse honest guards — "
  + "the false-positive control is what keeps the rule honest rather than merely strict. The "
  + "older SILENCE IS NOT SUCCESS rule is driven too, so fixing this defect cannot undo that one");
