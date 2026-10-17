// tools/probes/mutate-controls.js
// Control styling — reproduce each shipped defect as it actually was, and break the guard's own
// correctness in the three ways it was nearly wrong.
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
// range about other claims; cite these as `mutate-j-botruntime M4`, never as a bare `M4`. The journal
// markers (`CTM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-controls.js M1 M2 M3
// `CT_SUITE=tests/check-who-is-here.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.CT_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.CT_SUITE;

const F = {
  ui: path.join(ROOT, "ui/interface.js"),
  ix: path.join(ROOT, "index.html"),
  gd: path.join(ROOT, "tests/check-control-styling.js"),
};

const ROWS = [
  // ── THE THREE SHIPPED DEFECTS, EACH REPRODUCED AS IT ACTUALLY WAS ─────────────────────────
  { id: "M1", file: "ix", part: "styling",
    why: "THE ROOM ROW GOES BACK TO A NATIVE WHITE BUTTON — the wrapper themed, the child not. " +
         "This is the v270 restructure's defect, and the guard must see it",
    find: "    .room-item-main { flex: 1; text-align: left; background: none; border: none; color: inherit;",
    repl: "    .zz-removed-main { flex: 1;   /*CTM1*/",
    marker: "CTM1", expect: 1 },

  { id: "M2", file: "ix", part: "styling",
    why: "THE DELEGATION DROPDOWNS AS SHIPPED — neither borrowing `rank-select` nor declared " +
         "anywhere, which is exactly the state that put eighteen native dropdowns on the panel",
    find: "    .delegation-rank { max-width: 140px; }",
    repl: "    /*CTM2*/",
    find2: 'const sel = el("select", { class: "rank-select delegation-rank" });',
    repl2: 'const sel = el("select", { class: "delegation-rank" });   /*CTM2b*/',
    file2: "ui",
    marker: "CTM2", expect: 1 },

  { id: "M3", file: "ui", part: "styling",
    why: "the DM field stops borrowing `.chat-input` — the v269 defect, to show the guard covers " +
         "all three instances rather than the one it was written after",
    find: 'const input = el("input", { class: "dm-input chat-input", type: "text", placeholder: "Message…" });',
    repl: 'const input = el("input", { class: "zz-nothing", type: "text", placeholder: "Message…" });   /*CTM3*/',
    marker: "CTM3", expect: 1 },

  // ── THE WIDENING (v274) ───────────────────────────────────────────────────────────────────
  { id: "M4", file: "ui", part: "styling",
    why: "THE DELEGATION ROW AS SHIPPED — a `div` classed `setting-row`, declared nowhere, laying " +
         "out a select that IS themed. The guard passed on exactly this, because it only looked " +
         "at interactive elements",
    find: 'const wrap = el("div", { class: "set-row setting-delegation" });',
    repl: 'const wrap = el("div", { class: "setting-row zz-undeclared" });   /*CTM4*/',
    marker: "CTM4", expect: 1 },

  { id: "M5", file: "ui", part: "styling",
    why: "the delegation LABEL loses its declared class — the second of the three that shipped " +
         "undeclared, to show the widening covers the row's parts and not just its container",
    find: 'wrap.appendChild(el("div", { class: "set-label", text: label }));',
    repl: 'wrap.appendChild(el("div", { class: "setting-label", text: label }));   /*CTM5*/',
    marker: "CTM5", expect: 1 },

  { id: "M6", file: "ui", part: "styling",
    why: "the per-entry row reverts to `delegation-row` alone, which carries a declared rule now " +
         "but no LAYOUT — the third class, and the one that makes the wall a wall",
    find: 'const row = el("div", { class: "dim-row delegation-row" });',
    repl: 'const row = el("div", { class: "zz-delegation-row" });   /*CTM6*/',
    marker: "CTM6", expect: 1 },

  // ── WHY THERE ARE NO GUARD-SELF-MUTATION ROWS HERE ────────────────────────────────────────
  // Four were written and all four came back GREEN, and the reason is structural rather than a
  // fixture problem: **a mutation that LOOSENS a guard is green by construction when the tree is
  // clean.** Keying ancestor coverage by tag alone, grepping the sheet instead of parsing
  // selectors, reading attributes per line, dropping the exhausted-exemption check — every one
  // makes the guard accept MORE, and a guard that accepts more still passes a tree with nothing
  // wrong in it. Pairing each loosening with the defect it should have caught would produce a
  // green row too, and green would then mean *the loosening worked*, which inverts what a row
  // reports and is worse than not having it.
  //
  // The guard's strictness is proven two other ways instead, both of which discriminate:
  //   · M1/M2/M3 above reproduce the three SHIPPED defects as they actually were — if the guard
  //     loosens, those rows stop going red, which is a red-to-green regression a later pass sees.
  //   · the guard carries its OWN control block, driving a synthetic undeclared class through the
  //     same classification and asserting it is refused, plus a declared one asserting it is not.

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
    console.log("[mutate-ct] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-ct] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-ct] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-ct] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-controls:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-controls:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-ct] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
