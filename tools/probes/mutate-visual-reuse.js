// tools/probes/mutate-visual-reuse.js
// Three visual corrections — break each borrow: the button shape, the shared marquee, the
// composer's classes. Every row is about a REUSE being undone, not about an appearance.
//
// EVERY ROW EXPECTS A CHANGE unless it is explicitly marked `expectGreen`. A mutation whose
// expected result is "nothing changes" cannot detect its own failure to apply
// (`09-roadmap.md` §8), so each row breaks something and expects the suite to notice; a row that
// stays GREEN without being marked is a finding about the GUARD, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes
// are back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the
// next reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the
// suite's result has been read — before-only is sufficient when one hand holds the tree and
// worthless when two do. Under collision a green row is VOID, not a survivor.
//
// ROW IDS ARE PER-FILE. Other break files have rows with
// the same ids about other claims; cite these as `mutate-visual-reuse M4`, never as a bare `M4`. The journal
// markers (`VISM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-visual-reuse.js M3 M4 M9
// `VIS_SUITE=tests/check-visual-reuse.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────────────
// Each row's own note says what it breaks and which guard PART should report it.
//
// RETIRED ROWS (J107, `ddjp_604`). Their last runs were recorded at the `ddjp_597` and `ddjp_604` milestone closes, whose
// records went with step 2 of the clean-up (`ddjp_613`); each retired row keeps its note below.
//   ── M1 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M2 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M5 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M6 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M7 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M8 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M10 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M11 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.VIS_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.VIS_SUITE;

const F = {
  ix: path.join(ROOT, "index.html"),
};

const ROWS = [
  // ── ITEM 1: the back button ───────────────────────────────────────────────────────────────
  { id: "M3", file: "ix", part: "A",
    why: "a FOURTH button style is added instead of borrowing — the thing the ask ruled out, and " +
         "it would pass any check that only looked at the rendered box",
    find: "    /* `.back-btn.collapsed` is GONE.",
    repl: "    .back-btn.collapsed { width: 32px; padding: 6px 0; text-align: center; }\n    /* `.back-btn.collapsed` is GONE.   /*VISM3*/",
    marker: "VISM3", expect: 1 },

  { id: "M4", file: "ix", part: "A",
    why: "the precedent loses its height, so it stops being the thing that makes a square and the " +
         "borrow inherits the original defect",
    find: ".copy-btn.icon-only { padding: 0; width: 26px; height: 26px;",
    repl: ".copy-btn.icon-only { padding: 0; width: 26px;   /*VISM4*/",
    marker: "VISM4", expect: 1 },

  // ── ITEM 2: one marquee ───────────────────────────────────────────────────────────────────
  { id: "M9", file: "ix", part: "B",
    why: "the title box stops clipping, so the text widens the box instead of overflowing it and " +
         "nothing ever scrolls",
    find: ".room-title { overflow: hidden; white-space: nowrap; min-width: 0; }",
    repl: ".room-title { min-width: 0; }   /*VISM9*/",
    marker: "VISM9", expect: 1 },

  // ── ITEM 3: the DM composer ───────────────────────────────────────────────────────────────
  { id: "M12", file: "ix", part: "C",
    why: "`.dm-input` re-declares the borrowed appearance, so two rules describe one field and " +
         "drift the next time either is touched",
    find: "    .dm-input { flex: 1; min-width: 0; }",
    repl: "    .dm-input { flex: 1; min-width: 0; background: #333; border: 1px solid #555; color: #fff; padding: 8px; font-size: 13px; }   /*VISM12*/",
    marker: "VISM12", expect: 1 },

  { id: "M13", file: "ix", part: "C",
    why: "`.dm-sender` takes its colour back, so two rules decide what a name looks like and they " +
         "disagree — #9CA3AF against #5865F2",
    find: "    .dm-sender { flex-shrink: 0; }",
    repl: "    .dm-sender { color: #9CA3AF; flex-shrink: 0; }   /*VISM13*/",
    marker: "VISM13", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    // ── THE VERDICT IS THE EXIT CODE PLUS THE ABSENCE OF A FAILURE LINE ───────────────────────
    // `/PASS/.test(out)` alone is a TEXT MATCH, and it was true of output that also contained
    // `FAIL` — which is exactly what happened when a guard's failure gate sat above one of its
    // parts: the guard printed a FAIL line, exited 0, and three mutation rows read GREEN against a
    // tree whose fold they had deleted. `execFileSync` already throws on a non-zero exit, so
    // reaching this line means exit 0; the added test is that nothing announced a failure anyway.
    // A verdict that can be satisfied by a substring is not a verdict.
    const announcedFailure = /^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE)/m.test(out);
    return { green: !announcedFailure && (/All guards passed/.test(out) || /PASS/.test(out)), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE) .*/m);
  return m ? m[0].slice(0, 180) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-vis] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-vis] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // A lettered suffix (M19b) is accepted, as in the harness this one was copied from; this file has
  // no lettered rows.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-vis] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-vis] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-visual-reuse:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (`find2`/`file2`; no row in this file has one).
      // Its own journal handle is opened so a restore puts both back, and `h2` is restored
      // alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-visual-reuse:" + row.id + ":2", F[row.file2]);
        applied += h2.apply(row.find2, row.repl2, row.expect);
      } else if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore(); if (h2) h2.restore();

    if (!still) {
      console.log(row.id + "  VOID  — the mutation was gone by the time the result was read " +
        "(somebody else wrote to the tree); a green here would be a claim about a tree that " +
        "never held it");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    let verdict = r.green ? "GREEN" : "RED";
    if (row.expectGreen) verdict = r.green ? "DOMINATED" : "RED (redundancy ENDED — read it)";
    console.log(row.id + "  " + verdict + " [" + applied + " site, targets PART " + row.part + "] " +
      row.why + (/^RED/.test(verdict) ? "\n        -> " + firstFail(r.out) : ""));
    results.push({ id: row.id, verdict, part: row.part });
  }

  const red = results.filter((r) => /^RED/.test(r.verdict)).length;
  const green = results.filter((r) => r.verdict === "GREEN").length;
  const dom = results.filter((r) => r.verdict === "DOMINATED").length;
  const voidd = results.filter((r) => r.verdict === "VOID").length;
  console.log("\n[mutate-vis] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
