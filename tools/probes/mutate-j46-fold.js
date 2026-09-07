// tools/probes/mutate-j46-fold.js
//
// J46's mutation pass. Every row breaks ONE line of the fix and asserts that a NAMED guard goes
// red at a NAMED assertion. A guard that stays green when the code is broken is worse than no
// guard, because it reports safety that is not there — and the guard most likely to contain a
// decorative assertion is the one written minutes ago, which is all of them here.
//
// ── WHAT THIS RUNNER DOES THAT A `sed` LOOP DOES NOT ────────────────────────────────────────
//
//   · THE JOURNAL IS ON DISK, written before the edit and cleared after the restore. If a run
//     dies mid-mutation the next run finds the journal, restores the file from the recorded
//     original, and NAMES the probe that left it dirty. A tree left mutated is the worst outcome
//     available: every later reading is taken from code nobody meant to ship.
//   · THE ANCHOR IS COUNTED, both before and after. `replace` reports success on matching
//     nothing, so a mutation that never applied is indistinguishable from one that applied and
//     changed no behaviour — the difference between "the rule is unguarded" and "my probe did not
//     run". Counting after the guard has run as well is what catches the collision case: a second
//     hand on the tree restoring the file mid-row, which no amount of care taken beforehand can
//     see. Under collision a green row is VOID rather than a survivor.
//   · ATTRIBUTION IS BY ASSERTION TEXT, not by exit code. `ok` exits on the first failure, so a
//     red proves only that SOMETHING failed — and the previous session's runner captured the line
//     after the AssertionError header, which in Node is the `at ok (...)` stack frame and is the
//     same string for every failure in the suite. It reported ten identical reds and said nothing
//     about which assertion fired, which is the whole thing a mutation pass measures.
//   · A RED BY CRASH IS NOT RED ENOUGH. A mutation that kills a guard by throwing before its own
//     assertion runs is one swallowed exception away from killing nothing, so a row whose output
//     carries no AssertionError is reported as `red-by-crash` and does not count as a pass.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, ".mutation-journal.json");

// ── THE JOURNAL ─────────────────────────────────────────────────────────────────────────────
function recover() {
  if (!fs.existsSync(JOURNAL)) return;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(JOURNAL, "utf8")); }
  catch (e) {
    console.log("!! a journal exists and is unreadable (" + e.message + "). The tree may be "
      + "dirty and this run cannot tell — restore by hand before trusting anything.");
    process.exit(1);
  }
  console.log("!! RECOVERING — a previous run left " + j.file + " mutated by " + j.probe
    + " (row " + j.row + "). Restoring it before doing anything else.");
  fs.writeFileSync(path.join(ROOT, j.file), j.original, "utf8");
  fs.unlinkSync(JOURNAL);
}
function journal(file, row, original) {
  fs.writeFileSync(JOURNAL, JSON.stringify({
    probe: "mutate-j46-fold", file: file, row: row, at: new Date().toISOString(),
    original: original,
  }), "utf8");
}
function clearJournal() { if (fs.existsSync(JOURNAL)) fs.unlinkSync(JOURNAL); }

// ── RUNNING ONE GUARD AND READING WHICH ASSERTION FIRED ─────────────────────────────────────
function runGuard(guard) {
  try {
    execFileSync(process.execPath, [path.join("tests", guard)],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { green: true, message: null };
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    // ── THE MESSAGE IS ON THE HEADER LINE, NOT AFTER IT ──────────────────────────────────────
    // The first version of this read "the line after the AssertionError header", which is exactly
    // the defect the previous session's runner had and which the comment at the top of this file
    // describes. Node prints `AssertionError [ERR_ASSERTION]: <message>` on ONE line and the stack
    // beneath it, so taking the next line yields `at ok (...)` — identical for every failure in
    // the suite, because every assertion goes through one `ok`. It reported twelve rows as
    // RED-ELSEWHERE with the same string, which is at least visible; the previous version reported
    // them as reds and told nobody anything.
    //
    // Written down rather than quietly corrected: I had the description of this bug in front of me
    // and wrote it anyway, which says the description was not the thing that would have prevented
    // it. Running the pass and reading the output was.
    const m = out.match(/AssertionError[^:]*:\s*([\s\S]*?)(?:\n\s+at\s|\n\s*$)/);
    // AND THE SUITE HAS A SECOND FAILURE CONVENTION, which this runner would also have misread.
    // 95 of the guard files report `[name] FAIL — <assertion>` and exit non-zero rather than
    // throwing. Every row here happens to target a guard that throws, so the bug never fired —
    // which is exactly the kind of latent misclassification that shows up the first time somebody
    // reroutes a row. A clean named red must not be reported as `red-by-crash`.
    const named = out.match(/^\[[a-z0-9-]+\] FAIL — (.*)$/m);
    const first = named ? named[1].trim()
                        : (m ? m[1].trim().replace(/\s+/g, " ") : null);
    return { green: false, message: first,
             crash: !/AssertionError/.test(out) && !named,
             raw: out.slice(0, 400) };
  }
}

const ROWS = [];
function row(id, spec) { ROWS.push(Object.assign({ id: id }, spec)); }

// ── THE MUTATIONS ───────────────────────────────────────────────────────────────────────────
// Each names the rule it breaks, the guard that must notice, and a fragment of the assertion text
// that must be the one to fire. Where a direction exists in which the expected result is a CHANGE
// rather than an absence, it is preferred — a mutation expected to leave output alone is
// indistinguishable from one that never ran.

const SM = "backends/backend1/streammanager.js";
const FL = "backends/backend1/floor.js";

row("M1", {
  what: "the marker stops reading `thin` — the pair becomes a single-field test on `prev`",
  file: SM,
  from: "return (f.prev === null || f.prev === undefined) && f.thin === true;",
  to:   "return (f.prev === null || f.prev === undefined);",
  guard: "check-origin-fold.js",
  expect: "an ordinary room's FIRST seal declares NO origin",
});

row("M2", {
  what: "the marker stops reading `prev` — the pair becomes a single-field test on `thin`",
  file: SM,
  from: "return (f.prev === null || f.prev === undefined) && f.thin === true;",
  to:   "return f.thin === true;",
  guard: "check-origin-fold.js",
  expect: "a THIN peer's own seal declares NO origin either",
});

row("M3", {
  what: "the marker becomes the pair measurement REFUTED — `n === 1 && prev === null`",
  file: SM,
  from: "return (f.prev === null || f.prev === undefined) && f.thin === true;",
  to:   "return f.n === 1 && (f.prev === null || f.prev === undefined);",
  guard: "check-origin-fold.js",
  expect: "an ordinary room's FIRST seal declares NO origin",
});

row("M4", {
  what: "`thin` is dropped at adoption again — the marker exists on the wire and not where it "
    + "has to be read. This is the defect the tree actually had",
  file: FL,
  from: "      floorL: (typeof f.floorL === \"number\") ? f.floorL : null,\n      thin: f.thin === true,",
  to:   "      floorL: (typeof f.floorL === \"number\") ? f.floorL : null,",
  guard: "check-origin-fold.js",
  expect: "an IMPORT declares an origin",
});

row("M5", {
  what: "`thin` is carried but hard-coded true at adoption — every floor reads as an origin",
  file: FL,
  from: "      thin: f.thin === true,\n      by: f.by || f.u || null, grade: grade,",
  to:   "      thin: true,\n      by: f.by || f.u || null, grade: grade,",
  guard: "check-origin-fold.js",
  expect: "an ordinary room's FIRST seal declares NO origin",
});

row("M6", {
  what: "the origin never enters the fold — `_deriveBest` keys on the trim alone, which is the "
    + "behaviour J46 replaced",
  file: SM,
  from: "if (_trimmedBelow !== null || _originDeclared) {",
  to:   "if (_trimmedBelow !== null) {",
  guard: "check-origin-fold.js",
  expect: "a created-from-file room DERIVES WHAT THE FILE SAYS",
});

row("M7", {
  what: "the origin stops latching — it is re-read from the current floor every time, so the "
    + "room empties when it seals its own second checkpoint",
  file: SM,
  from: "    if (_isOriginFloor(f)) _originDeclared = true;",
  to:   "    _originDeclared = _isOriginFloor(f);",
  guard: "check-origin-fold.js",
  expect: "THE LATCH",
});

// ── A ROW EXPECTED TO SURVIVE, AND WHY THAT IS NOT A LOOPHOLE ───────────────────────────────
// `redundant` says: this line states a real rule that something else currently enforces, so its
// survival is the measurement rather than a failure. It is only honest with the other half —
// ── M8's REDUNDANCY ENDED, AND THIS ROW COULD NOT SEE IT ────────────────────────────────────
// This row was written to detect exactly that: "A `redundant` row that goes RED is reported too:
// the redundancy has ended and the comment describing it is now wrong." It did not fire when the
// redundancy ended, and the reason is structural rather than an oversight in the reasoning —
// `runGuard(r.guard)` asks ONE guard, and this row's was `check-origin-fold.js`, which drives the
// created-from-file route and contains no override. So the row kept measuring the three
// absorptions under the one guard where they still hold, and reported `REDUNDANT` truthfully about
// that guard while the tree had grown a route where the clause is load-bearing.
//
// J28 is that route: an override's below-cut events are a real room's plays and declares rather
// than two idempotent settings posts. Re-pointed at the guard that covers it, and it goes RED.
//
// THE LESSON IS ABOUT THIS RUNNER, NOT ABOUT THE CLAUSE. A `redundant` verdict is scoped to the
// guards the row asks, and nothing made that scope visible at the point where the verdict is read.
// Anyone adding a `redundant` row should name the guard that would notice first if the redundancy
// ended — and if no guard would, the row is a note rather than a pin.
row("M8", {
  what: "the fold stops respecting the cut — the whole log is folded over the seed, so events "
    + "the seed already banked are counted twice",
  file: SM,
  from: "      return _remember(StateDeriver.deriveBoth(_aboveCut(ordered, f), f.seed));",
  to:   "      return _remember(StateDeriver.deriveBoth(ordered, f.seed));",
  guard: "check-override-running.js",
  expect: "APPLIED",
});

row("M9", {
  what: "the origin verdict borrows the ordinary path's word — `validated` with no reason, a "
    + "verdict naming a comparison that did not happen",
  file: SM,
  from: "    _recordValidation(\"validated\", \"origin-seed\", sig);",
  to:   "    _recordValidation(\"validated\", null, sig);",
  guard: "check-origin-fold.js",
  expect: "the pre-forget verdict is now `validated / origin-seed`",
});

row("M10", {
  what: "the origin verdict is recorded on EVERY ingest rather than once per signature",
  file: SM,
  from: "    if (!sig || sig === _lastValidatedCp) return;",
  to:   "    if (!sig) return;",
  guard: "check-override-origin.js",
  expect: "it did not RE-RUN",
});

row("M11", {
  what: "the origin survives a room change — a new room inherits the last one's seed",
  file: SM,
  from: "    _originDeclared = false;",
  to:   "    /* _originDeclared left set */",
  guard: "check-origin-fold.js",
  expect: "the room change clears the ORIGIN too",
});

row("M12", {
  what: "THE INVARIANT ITSELF — `_weakened` withdraws a trimmed client's floor, leaving it "
    + "trimmed and floorless, which is the state an honest seal writes the marker from",
  file: FL,
  from: "    if (!trimmed) { _withdraw(); return { moved: true, reason: \"withdrawn\", why: why }; }",
  to:   "    { _withdraw(); return { moved: true, reason: \"withdrawn\", why: why }; }",
  guard: "check-origin-fold.js",
  expect: "a TRIMMED one is DEMOTED to `stale` and KEEPS its floor",
});

row("M13", {
  what: "a floorless client with a declared origin fabricates a genesis room instead of refusing",
  file: SM,
  from: "        return _refuseUnpaired(ordered, null);",
  to:   "        return _remember(StateDeriver.deriveBoth(ordered));",
  guard: "check-origin-fold.js",
  expect: "the fold REFUSES and records why",
});

// ── THE RUN ─────────────────────────────────────────────────────────────────────────────────
function main() {
  recover();
  console.log("mutate-j46-fold — " + ROWS.length + " mutations");
  console.log("=================================" + "=".repeat(String(ROWS.length).length));
  console.log("");

  const results = [];
  for (const r of ROWS) {
    const abs = path.join(ROOT, r.file);
    const original = fs.readFileSync(abs, "utf8");

    // ASSERT THE ANCHOR MATCHES EXACTLY ONCE, BEFORE ANYTHING ELSE. Zero means the mutation never
    // applied; more than one means it is ambiguous and may have hit a comment rather than the
    // call — the textual-guard failure wearing a mutation's clothes.
    const occurrences = original.split(r.from).length - 1;
    if (occurrences !== 1) {
      results.push({ id: r.id, verdict: "VOID", note: "the anchor matched " + occurrences
        + " times, not 1 — the mutation cannot be attributed" });
      console.log("  " + r.id + "  VOID — anchor matched " + occurrences + " times");
      continue;
    }

    journal(r.file, r.id, original);
    fs.writeFileSync(abs, original.split(r.from).join(r.to), "utf8");

    const applied = fs.readFileSync(abs, "utf8");
    const stillMutated = () => fs.readFileSync(abs, "utf8") === applied;
    if (applied === original) {
      fs.writeFileSync(abs, original, "utf8"); clearJournal();
      results.push({ id: r.id, verdict: "VOID", note: "the write changed nothing" });
      console.log("  " + r.id + "  VOID — the write changed nothing");
      continue;
    }

    const res = runGuard(r.guard);

    // AND ASSERT IT STILL APPLIES NOW THE RESULT IS IN HAND. Before-only is sufficient when one
    // hand holds the tree and worthless when two do: two sweeps at once restore each other's
    // files and both read clean source, so both report survivors for mutations neither tree held.
    const heldThrough = stillMutated();
    fs.writeFileSync(abs, original, "utf8");
    clearJournal();

    if (!heldThrough) {
      results.push({ id: r.id, verdict: "VOID", note: "the file changed under the run — another "
        + "hand is on the tree, so this reading is contaminated rather than green" });
      console.log("  " + r.id + "  VOID — the file changed underneath the guard");
      continue;
    }

    let verdict, note;
    if (r.redundant) {
      verdict = res.green ? "REDUNDANT" : "REDUNDANCY-ENDED";
      note = res.green
        ? ("expected to survive — " + r.redundant + "   [" + r.evidence + "]")
        : ("this row was recorded as redundant and is now GUARDED: " + (res.message || "")
           + " — the comment describing it as redundant has become wrong");
    } else if (res.green) {
      verdict = "SURVIVOR"; note = r.guard + " stayed GREEN";
    } else if (res.crash) {
      verdict = "RED-BY-CRASH";
      note = r.guard + " died without reaching an assertion: " + (res.raw || "").slice(0, 120);
    } else if (r.expect && (!res.message || res.message.indexOf(r.expect) < 0)) {
      verdict = "RED-ELSEWHERE";
      note = "expected «" + r.expect + "», fired «" + (res.message || "?").slice(0, 110) + "»";
    } else {
      verdict = "RED"; note = r.guard + " -> " + (res.message || "").slice(0, 130);
    }
    results.push({ id: r.id, verdict: verdict, note: note });
    console.log("  " + r.id + "  " + verdict + " — " + r.what);
    console.log("       " + note);
  }

  console.log("");
  const bad = results.filter((x) => x.verdict !== "RED" && x.verdict !== "REDUNDANT");
  const red = results.filter((x) => x.verdict === "RED").length;
  const redundant = results.filter((x) => x.verdict === "REDUNDANT");
  console.log("SUMMARY: " + red + " red / " + results.length + " rows"
    + (redundant.length ? "   (" + redundant.length + " recorded redundant: "
        + redundant.map((x) => x.id).join(", ") + ")" : "")
    + (bad.length ? "   NOT CLEAN: " + bad.map((b) => b.id + "=" + b.verdict).join(", ")
                  : "   no survivors, no voids, no red-by-crash, no misattributions"));
  if (fs.existsSync(JOURNAL)) {
    console.log("!! the journal still exists at the end of a clean run — that is a bug in this "
      + "runner, not a finding about the tree.");
  }
  process.exit(bad.length ? 1 : 0);
}

main();
