// tools/probes/mutate-j19-reputation.js
// J19 — break the honest label, the coverage that makes it honest, and shape (a)'s promise.
//
// SEPARATE FROM `mutate-j17-settings.js` AND `mutate-j17-lattice.js`, WHICH MEASURE A DIFFERENT
// THING. Those two ask what ADDING a key costs, and use an injected vehicle key to ask it. This
// one asks whether the five keys that actually landed are load-bearing. Both questions are live
// and neither answers the other.
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
// ROW IDS ARE PER-FILE. `mutate-j15-dm.js` and `mutate-j16-active.js` both have rows in the M1x
// range about other claims; cite these as `mutate-j19-reputation M4`, never as a bare `M4`. The journal
// markers (`J19M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j19-reputation.js M1 M2 M3
// `J19_SUITE=tests/check-reputation.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS THAT MATTER MOST ────────────────────────────────────────────────────────────────
// M3 is the one this job exists to prevent: the feed narrates events the reducer REFUSED. Nothing
// breaks, the list looks fuller, and the panel names acts nobody performed.
// M7 and M8 are the Done-when correction: collapse the two empties into one and the panel tells
// somebody their history was banked when it never existed, or that nothing has happened in a room
// whose entire history it destroyed. Both are true-of-nothing sentences that read as fact.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.J19_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J19_SUITE;

const F = {
  rp: path.join(ROOT, "features/reputation.js"),
  cf: path.join(ROOT, "backends/backend1/checkpointformat.js"),
  vc: path.join(ROOT, "backends/backend1/vouch.js"),
  ix: path.join(ROOT, "index.html"),
  ld: path.join(ROOT, "tests/_load.js"),
};

const ROWS = [
  // ── THE DONE-WHEN: COVERAGE AND THE LABEL ─────────────────────────────────────────────────
  { id: "M1", file: "rp", part: "C",
    why: "THE LABEL FALLS BACK TO A BARE COUNT instead of refusing — a fold with no coverage " +
         "renders a number, which is exactly how a partial count becomes a lifetime one",
    find: "    if (!fold || !fold.coverage || typeof fold.coverage.partial !== \"boolean\") return null;",
    repl: "    if (!fold) return null;   /*J19M1*/",
    marker: "J19M1", expect: 1 },

  { id: "M2", file: "rp", part: "C",
    why: "`complete` becomes true when the log reaches the room's start — a bot that was never " +
         "absent claiming it can prove it was never absent",
    find: "      complete: false,",
    repl: "      complete: !c.partial,   /*J19M2*/",
    marker: "J19M2", expect: 1 },

  { id: "M3", file: "rp", part: "C",
    why: "both branches say the same sentence, so the partial flag becomes decorative and a " +
         "person cannot tell a late-joining bot's number from a complete one",
    find: '      note: c.partial\n        ? "This counts only what the bot has seen. It joined after this room started, or has " +\n          "missed time since, so the real total is higher — there is no way to tell by how much."\n        : "This counts everything in the history this client still holds. If anything has been " +\n          "forgotten, or the bot was away, the real total is higher.",',
    repl: '      note: "This counts everything in the history this client still holds. If anything has been forgotten, or the bot was away, the real total is higher.",   /*J19M3*/',
    marker: "J19M3", expect: 1 },

  { id: "M4", file: "rp", part: "B",
    why: "history missing from the MIDDLE stops making a tally partial — a log that begins at " +
         "position 1 with a hole in it reports itself as complete-as-far-as-held",
    find: "        partial: (unattributed > 0) ||",
    repl: "        partial: (false) ||   /*J19M4*/",
    marker: "J19M4", expect: 1 },

  { id: "M5", file: "rp", part: "B",
    why: "a log starting ABOVE the room's beginning stops being partial — the late-joining bot " +
         "case the Done-when is built around",
    find: "            ? firstL > o.roomStartsAt",
    repl: "            ? false   /*J19M5*/",
    marker: "J19M5", expect: 1 },

  { id: "M6", file: "rp", part: "B",
    why: "the fold returns a TALLY WITHOUT COVERAGE — the one shape the module is built to make " +
         "impossible, so a caller can hold the number alone",
    // THE FIRST VERSION OF THIS ROW ADDED A DECORATIVE FIELD (`coverageDetached: true`) and came
    // back green — correctly, because it detached nothing. **The mutation was the fault, not the
    // guard**, which is the rule this runner states: suspect the mutation and the fixture first.
    // It did expose a real weakness in the check it targeted (a regex looking for the substring
    // "coverage" was satisfied by any field whose NAME contained it), and that was fixed too — but
    // the green was the row's own doing. This version actually removes the coverage.
    find: "      // COVERAGE TRAVELS WITH THE TALLY. There is no shape here that is just a number.\n      coverage: {",
    repl: "      _cov: {   /*J19M6*/",
    marker: "J19M6", expect: 1 },

  // ── THE ARITHMETIC ────────────────────────────────────────────────────────────────────────
  { id: "M7", file: "rp", part: "A",
    why: "reactions are counted toward the person who REACTED rather than the DJ who received " +
         "them — reputation becomes a measure of how much you vote",
    find: "      const dj = pi ? djOf[pi] : null;",
    repl: "      const dj = e.sender || null;   /*J19M7*/",
    marker: "J19M7", expect: 1 },

  { id: "M8", file: "rp", part: "A",
    why: "a REFUSED reaction earns reputation — anyone can inflate a score with votes the room " +
         "throws away",
    find: "      if (!ok) { refused++; continue; }",
    repl: "      if (!ok) { refused++; }   /*J19M8*/",
    marker: "J19M8", expect: 1 },

  { id: "M9", file: "rp", part: "A",
    why: "an unattributable reaction is dropped SILENTLY rather than counted — the tally loses " +
         "the evidence that it is partial, which is what M4 then depends on",
    find: "        unattributed++;",
    repl: "        /*J19M9*/",
    marker: "J19M9", expect: 1 },

  { id: "M10", file: "rp", part: "B",
    why: "the window is measured over COUNTED events rather than everything held, so a room with " +
         "no votes reports no window and an empty tally looks unbounded",
    find: "      if (l !== null) { if (firstL === null || l < firstL) firstL = l; if (lastL === null || l > lastL) lastL = l; }",
    repl: "      if (l !== null && EARNS[e.type]) { if (firstL === null || l < firstL) firstL = l; if (lastL === null || l > lastL) lastL = l; }   /*J19M10*/",
    marker: "J19M10", expect: 1 },

  // ── SHAPE (a): CHECKPOINTS UNTOUCHED ──────────────────────────────────────────────────────
  { id: "M11", file: "cf", part: "D/E",
    why: "SHAPE (b) ARRIVES BY THE BACK DOOR — a seventh field in the fingerprint. Every " +
         "checkpoint in every room becomes unverifiable, and an unverifiable number sits inside " +
         "the artefact everyone verifies",
    find: "      covers: (typeof covers === \"string\") ? covers : null,\n    });\n  }",
    repl: "      covers: (typeof covers === \"string\") ? covers : null, rep: null,   /*J19M11*/\n    });\n  }",
    marker: "J19M11", expect: 1 },

  { id: "M12", file: "vc", part: "wiring",
    why: "the snapshot becomes vouch-critical — witness work spent protecting an assertion, which " +
         "makes it LOOK protected, and snapshots start moving the seal cadence",
    find: '    "ddjp.rep.snapshot",\n  ];',
    repl: "  ];   /*J19M12*/",
    marker: "J19M12", expect: 1 },

  // ── REGISTRATION — the v276 shape ─────────────────────────────────────────────────────────
  { id: "M13", file: "ix", part: "F",
    why: "the module loses its <script> tag — every guard still drives it in a sandbox and it is " +
         "UNDEFINED in the browser. This is what shipped in v276 and no guard caught it",
    find: '<script src="features/reputation.js?v=263"></script>',
    repl: "<!--J19M13-->",
    marker: "J19M13", expect: 1 },

  { id: "M14", file: "ld", part: "F",
    why: "the module loses its KNOWN_GLOBALS entry — the harness exposes nothing and a caller " +
         "reads `undefined.something` a long way from the cause",
    find: '  "BotSettings", "Reputation",',
    repl: '  "BotSettings",   /*J19M14*/',
    marker: "J19M14", expect: 1 },
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
    console.log("[mutate-j19] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j19] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j19] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j19] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j19-reputation:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore();

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
  console.log("\n[mutate-j19] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
