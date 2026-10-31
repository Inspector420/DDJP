// tools/probes/mutate-ui-crash.js
// The browser crash — break the refs-integrity scan and the tier-picker filter.
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
// the same ids about other claims; cite these as `mutate-ui-crash M4`, never as a bare `M4`. The journal
// markers (`UIM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-ui-crash.js M3 M4 M5
// `UI_SUITE=tests/check-ui-refs.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────────────
// Each row's own note says what it breaks and which guard PART should report it.
//
// RETIRED ROWS (J107, `ddjp_604`). Their last runs were recorded at the `ddjp_597` and `ddjp_604` milestone closes, whose
// records went with step 2 of the clean-up (`ddjp_613`); each retired row keeps its note below.
//   ── M1 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)
//   ── M2 retired: edits `ui/interface.js`, removed at J58 (`ddjp_397`)

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.UI_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.UI_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  gd: path.join(ROOT, "tests/check-ui-refs.js"),
};

const ROWS = [
  // ── THE SCAN'S OWN CORRECTNESS ────────────────────────────────────────────────────────────
  { id: "M3", file: "gd", part: "refs",
    why: "the scan stops stripping comments, so the fixed line's own explanatory comment reports " +
         "as a live orphan — a guard testing prose rather than code",
    find: "  const src = fs.readFileSync(path.join(ROOT, rel), \"utf8\")\n    .split(\"\\n\").map((l) => l.replace(/\\/\\/.*$/, \"\")).join(\"\\n\");",
    repl: "  const src = fs.readFileSync(path.join(ROOT, rel), \"utf8\");   /*UIM3*/",
    marker: "UIM3", expect: 1 },

  { id: "M4", file: "gd", part: "refs",
    why: "the lookbehind is dropped, so `ChatPrefs.load` matches as `refs.load` and the guard " +
         "reports 34 false orphans — the control rows are what catch it",
    find: "const READ = /(?<![\\w.])refs\\.([A-Za-z_]\\w*)/g;",
    repl: "const READ = /refs\\.([A-Za-z_]\\w*)/g;   /*UIM4*/",
    marker: "UIM4", expect: 1 },

  // ── THE TIER PICKER ───────────────────────────────────────────────────────────────────────
  { id: "M5", file: "rm", part: "tiers",
    why: "THE CONFIRMED BROWSER DEFECT, REINTRODUCED — the tier picker stops filtering by whether " +
         "the room unlocked the rank, so a batch-1 room offers Uncategorized, Guest and Staff. " +
         "The identical defect the rank picker had at v272",
    find: "      if (!isRankUnlocked(ch, levelOfTier[tier])) continue;",
    repl: "      /*UIM5*/",
    marker: "UIM5", expect: 1 },

  { id: "M6", file: "rm", part: "tiers",
    why: "an unreadable taxonomy FAILS OPEN — every tier is offered when the level table cannot " +
         "be read, which is the confirmed defect arriving by a different route",
    find: "      if (!levelOfTier || typeof levelOfTier[tier] !== \"number\") continue;",
    repl: "      if (!levelOfTier) { tiers.push({ tier: tier, id: ch[key], main: tier === mainTier }); continue; }   /*UIM6*/",
    marker: "UIM6", expect: 1 },

  { id: "M7", file: "rm", part: "tiers",
    why: "the tier levels are RESTATED here instead of read from the channel taxonomy, so a tier " +
         "added to that table is filtered against a stale copy",
    find: "        if (r && r.kind === \"chat\" && typeof r.level === \"number\") levelOfTier[r.slug] = r.level;",
    repl: "        if (r) {}\n      }\n      levelOfTier = { uncategorized: 0, guest: 10, staff: 60 };\n      if (false) {   /*UIM7*/",
    marker: "UIM7", expect: 1 },
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
    console.log("[mutate-ui] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-ui] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // A lettered suffix (M19b) is accepted, as in the harness this one was copied from; this file has
  // no lettered rows.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-ui] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-ui] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-ui-crash:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (`find2`/`file2`; no row in this file has one).
      // Its own journal handle is opened so a restore puts both back, and `h2` is restored
      // alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-ui-crash:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-ui] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
