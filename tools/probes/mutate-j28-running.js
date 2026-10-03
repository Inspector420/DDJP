// tools/probes/mutate-j28-running.js — does anything NOTICE when J28's rules break?
//
// A guard that has never failed is a guard nobody has checked, and this file was written minutes
// after the guard it targets — which `paths.md` §9.12 names as the likeliest place in the whole
// tree for a decorative assertion. Five have been found that way and every one was in a guard
// written moments earlier.
//
// TWO HALVES, and the second is the one that gets skipped:
//   · ASSERT THE EDIT APPLIED before reading the result. `sed` and string replace both report
//     success on matching nothing, and a mutation whose expected result is "nothing changes"
//     cannot detect its own failure to apply.
//   · ASSERT IT STILL APPLIES WHEN THE RESULT IS READ. Before-only is sufficient with one hand on
//     the tree and worthless with two. Under collision a green mutation is VOID, not a survivor.
//
// JOURNALLED TO DISK. The tree is restored from the journal on the next run if this one dies
// mid-mutation, and that path is self-tested: leave the tree mutated with a journal present and
// the next run restores it byte-identically and names the probe that left it.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, "tools", "probes", ".mutate-j28-running.journal.json");

// ── RECOVERY FIRST ───────────────────────────────────────────────────────────────────────────
if (fs.existsSync(JOURNAL)) {
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  for (const [rel, original] of Object.entries(j.files || {})) {
    fs.writeFileSync(path.join(ROOT, rel), original);
  }
  fs.unlinkSync(JOURNAL);
  console.log("[recovery] a previous run of " + (j.probe || "this probe") + " left the tree dirty ("
    + Object.keys(j.files || {}).length + " file(s)); restored byte-identically before starting.");
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function write(rel, s) { fs.writeFileSync(path.join(ROOT, rel), s); }

function runGuard(name) {
  try {
    const out = execFileSync("node", [path.join(ROOT, "tests", name)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // A guard that exits 0 with no PASS line has announced nothing, which the runner treats as a
    // failure and so does this.
    if (!/\bPASS\b/.test(out)) return { red: true, how: "NO-PASS-LINE", line: "(silent exit 0)" };
    return { red: false, how: "green", line: "" };
  } catch (e) {
    const all = String(e.stdout || "") + String(e.stderr || "");
    // 95 of the guard files report `[name] FAIL — <assertion>` and exit non-zero rather than
    // throwing an AssertionError. Testing only for AssertionError demoted three clean, named,
    // attributable reds to RED-BY-CRASH — the latent bug the previous session found in its own
    // runner. Both shapes are recognised here.
    const named = all.match(/^\[[\w-]+\] FAIL — .*/m);
    if (named) return { red: true, how: "named-fail", line: named[0].slice(0, 190) };
    const assertion = all.match(/AssertionError[^\n]*\n?/);
    if (assertion) {
      // ATTRIBUTE TO THE ASSERTION, NOT TO THE FRAME. Capturing the line after the AssertionError
      // header gives `at ok (...)`, which is identical for every failure in the file — the exact
      // attribution bug the previous session wrote a comment criticising and then committed.
      const msg = all.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]*)/);
      return { red: true, how: "assertion", line: (msg ? msg[1] : assertion[0]).slice(0, 190) };
    }
    return { red: true, how: "RED-BY-CRASH (weak)", line: all.split("\n")[0].slice(0, 190) };
  }
}

// ── THE MUTATIONS ────────────────────────────────────────────────────────────────────────────
// `expect` is the guard that OWNS the rule. `elsewhere` names a guard that also covers it, so a
// claim that moved keeps being tested rather than becoming a comment.
const MUTATIONS = [
  { id: "M1", file: "backends/backend1/checkpoint.js",
    find: "if (!amOwner) return { ok: false, reason: \"not-owner\" };",
    repl: "if (false) return { ok: false, reason: \"not-owner\" };",
    expect: "check-import.js",
    why: "the owner gate that replaces J27's wiring promise — a non-owner must not publish an "
       + "origin-declaring checkpoint" },

  { id: "M2", file: "backends/backend1/checkpoint.js",
    find: "const amOwner = (typeof _env.amOwner === \"function\") ? !!_env.amOwner() : false;",
    repl: "const amOwner = (typeof _env.amOwner === \"function\") ? !!_env.amOwner() : true;",
    expect: "check-import.js",
    why: "FAIL-CLOSED on an env that cannot answer. Defaulting to permitted is the direction that "
       + "reads as harmless and lets an unknown client publish" },

  { id: "M3", file: "backends/backend1/streammanager.js",
    find: "return _remember(StateDeriver.deriveBoth(_aboveCut(ordered, f), f.seed));",
    repl: "return _remember(StateDeriver.deriveBoth(ordered, f.seed));",
    expect: "check-override-running.js",
    why: "J46's M8, re-run on the route that makes it load-bearing. This survived every guard at "
       + "v254 and must not survive now" },

  { id: "M4", file: "backends/backend1/streammanager.js",
    find: "if (_isOriginFloor(f)) _originDeclared = true;",
    repl: "_originDeclared = _isOriginFloor(f);",
    expect: "check-override-running.js",
    elsewhere: "check-origin-fold.js",
    why: "UN-LATCHING the origin. The room's next ordinary checkpoint clears it and the room falls "
       + "back to the pre-override state one cadence later, looking entirely healthy" },

  { id: "M5", file: "features/room.js",
    find: "if (MatrixBridge.mayAuthor && !MatrixBridge.mayAuthor()) {",
    repl: "if (false) {",
    expect: "check-override-running.js",
    elsewhere: "check-wiring.js",
    why: "the caught-up question. A client still replaying anchors the room's new origin at a "
       + "position the room has already moved past" },

  { id: "M6", file: "features/room.js",
    find: "    const read = StreamManager.importFile ? StreamManager.importFile(file)\n"
        + "                                          : { ok: false, reason: \"no-backend-support\" };\n"
        + "    if (!read.ok) {\n"
        + "      Logger.warn(\"Room: override refused before changing anything — \" + read.reason +",
    repl: "    const read = StreamManager.importFile ? StreamManager.importFile(file)\n"
        + "                                          : { ok: false, reason: \"no-backend-support\" };\n"
        + "    if (!read.ok && false) {\n"
        + "      Logger.warn(\"Room: override refused before changing anything — \" + read.reason +",
    expect: "check-override-running.js",
    why: "read-before-write. A refusal computable from the file alone must not leave a live room's "
       + "rules changed with nothing to explain why",
    note: "TARGETS THE GUARD'S ORDERING ASSERTION, which is textual. Recorded honestly: this "
        + "mutation leaves the `importFile` call in place and only defeats the refusal, so a "
        + "source-ordering check cannot see it. Kept to MEASURE that limit rather than to claim "
        + "coverage it does not have" },

  { id: "M7", file: "tests/check-wiring.js",
    find: "const strip = (s) => s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, \" \").replace(/(^|[^:])\\/\\/[^\\n]*/g, \"$1\");",
    repl: "const strip = (s) => s;",
    expect: "check-wiring.js",
    why: "the comment strip. Without it a gate NAMED in a doc comment resolves its neighbouring "
       + "function as gated — two false verdicts from one paragraph of English, which is how this "
       + "was found" },
];

// ── SELF-TEST OF THE RUNNER ──────────────────────────────────────────────────────────────────
// The runner decides what counts as red, so it is given a mutation whose answer is known before
// any real row runs: break a guard's own subject in a way that MUST go red. If this does not turn
// red the runner is broken and every row below is uninterpretable.
(function runnerSelfTest() {
  const rel = "backends/backend1/checkpoint.js";
  const original = read(rel);
  const marker = "function buildImport(seed, anchor) {";
  if (original.indexOf(marker) < 0) throw new Error("RUNNER SELF-TEST: anchor missing");
  fs.writeFileSync(JOURNAL, JSON.stringify({ probe: "mutate-j28-running (self-test)",
    files: { [rel]: original } }));
  write(rel, original.replace(marker, marker + "\n    return { ok: false, reason: \"self-test\" };"));
  const r = runGuard("check-import.js");
  write(rel, original);
  fs.unlinkSync(JOURNAL);
  if (!r.red) throw new Error("RUNNER SELF-TEST FAILED: a guard whose subject was broken read GREEN "
    + "— every row below would be meaningless");
  console.log("[runner] self-test PASS — a deliberately broken subject is detected as red (" + r.how + ")\n");
})();

// ── THE PASS ─────────────────────────────────────────────────────────────────────────────────
const results = [];
for (const m of MUTATIONS) {
  const original = read(m.file);
  const count = original.split(m.find).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, applied: false, red: null,
      note: "ANCHOR MATCHED " + count + " TIMES — not applied. A mutation that never reached the "
          + "code reports the same thing in every tree" });
    continue;
  }
  fs.writeFileSync(JOURNAL, JSON.stringify({ probe: "mutate-j28-running",
    files: { [m.file]: original } }));
  write(m.file, original.replace(m.find, m.repl));

  // ASSERT IT APPLIED, before reading anything.
  const after = read(m.file);
  const appliedNow = after.indexOf(m.repl) >= 0 && after.indexOf(m.find) < 0;
  let r = { red: null, how: "not-run", line: "" };
  if (appliedNow) r = runGuard(m.expect);
  // ASSERT IT STILL APPLIES, now that the result has been read. Between the two reads is where a
  // second hand on the tree restores the file and turns a poisoned row into a survivor.
  const stillApplied = read(m.file).indexOf(m.repl) >= 0;

  let elsewhereResult = null;
  if (m.elsewhere && appliedNow && stillApplied) elsewhereResult = runGuard(m.elsewhere);

  write(m.file, original);
  fs.unlinkSync(JOURNAL);

  results.push({ id: m.id, applied: appliedNow, stillApplied, red: r.red, how: r.how,
    line: r.line, why: m.why, expect: m.expect, note: m.note || null,
    elsewhere: m.elsewhere || null,
    elsewhereRed: elsewhereResult ? elsewhereResult.red : null });
}

// ── REPORT — CONCLUSIONS COMPUTED FROM THE MEASUREMENT, NEVER PRE-WRITTEN ────────────────────
// The previous session's probe kept printing a finding it had written in advance over a reading
// that showed the opposite. Every line below is derived from `results`.
console.log("=== mutate-j28-running ===\n");
let red = 0, survived = 0, unapplied = 0;
for (const r of results) {
  if (!r.applied) { unapplied++; console.log(r.id + "  NOT APPLIED — " + r.note + "\n"); continue; }
  if (!r.stillApplied) {
    console.log(r.id + "  VOID — the mutation was undone beneath the run. Under collision a green "
      + "result is void rather than a survivor; discard and re-run from scratch.\n");
    continue;
  }
  if (r.red) red++; else survived++;
  console.log(r.id + "  " + (r.red ? "RED" : "SURVIVED") + "  [" + r.expect + "]"
    + (r.red ? " via " + r.how : ""));
  console.log("     rule: " + r.why);
  if (r.red && r.line) console.log("     caught by: " + r.line);
  if (r.elsewhere) {
    console.log("     elsewhere (" + r.elsewhere + "): "
      + (r.elsewhereRed === null ? "not run" : (r.elsewhereRed ? "also RED" : "green — this rule "
        + "has ONE holder, so that guard is not a second net")));
  }
  if (r.note) console.log("     note: " + r.note);
  console.log("");
}
console.log(red + " red / " + (red + survived) + " applied"
  + (unapplied ? ("  (" + unapplied + " never applied — see above)") : ""));
if (survived) {
  console.log("\nSURVIVORS ARE NOT AUTOMATICALLY FINDINGS, and they are not automatically fine "
    + "either. When a mutation survives, suspect the FIXTURE before the assertion: the surviving "
    + "mutation is usually pointing at a case the fixture cannot express.");
}
