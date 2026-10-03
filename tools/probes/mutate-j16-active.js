// tools/probes/mutate-j16-active.js
// J16 — break each thing `check-who-is-here` claims to pin, and watch it go red.
//
// EVERY ROW EXPECTS A CHANGE. A mutation whose expected result is "nothing changes" cannot detect
// its own failure to apply (`09-roadmap.md` §8), so each row breaks something and expects the
// suite to notice; a row that stays GREEN is a finding about the guard, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes are
// back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the next
// reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the suite's
// result has been read — before-only is sufficient when one hand holds the tree and worthless when
// two do. Under collision a green row is VOID, not a survivor.
//
// ROW IDS ARE PER-FILE AND TWO FILES COLLIDE. `mutate-j15-dm.js` also has an M14 and an M15, and
// they are different rows about different claims: ITS M15 is the RED `closeOnRun` row, THIS file's
// M15 is the `expectGreen` setter-clamp row, and this file has NO M14 at all (the keep-one lattice
// M16-M18 replaced an earlier row of that number). Always qualify by file when citing one
// elsewhere — `mutate-j16-active M15`, never a bare `M15`. The journal MARKERS are already
// disambiguated (`J16M15` vs `J15M15`), so a mis-cited row cannot silently apply the wrong edit;
// what it can do is send a reader to the wrong probe.
//
// ROW-SELECTABLE, because the full suite is ~35s per row and a batch has to fit a time budget:
//   node tools/probes/mutate-j16-active.js M1 M2 M3
// `J16_SUITE=tests/check-who-is-here.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS THAT MATTER MOST ────────────────────────────────────────────────────────────────
// M5 is the one this job exists to prevent: the label states the REQUESTED window instead of the
// EFFECTIVE one, so a freshly-loaded or freshly-trimmed room says "in the last hour" over a log
// holding four minutes. The tree still works, the list is still right, and the panel lies. M6 is
// its sibling — the caveat that names both numbers, deleted.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.J16_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J16_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
  cp: path.join(ROOT, "core/chatprefs.js"),
};

// Each row: which file, the anchor, the replacement, a marker proving it is still applied, and the
// PART it targets. `expect` is the occurrence count the anchor must match — `apply` refuses a
// replacement matching nothing or matching more often than stated.
const ROWS = [
  // ── THE ACTIVITY-WINDOW CLAMP LATTICE IS RETIRED (v272) ────────────────────────────────────
  // Removed rows: .
  // They were the keep-one lattice over `activityWindowMs`'s three clamp sites — `load()` (a
  // stored blob), the reader and the setter — and they found a real result: the sites were not
  // redundant, because a value that never passed through the setter arrives from the STORE.
  //
  // **v272 removed the device-local window entirely**, so there is no clamp left to drop. The
  // People panel shows the basis for a bot REMOVING somebody, and a window this client could
  // choose could say a person is present while the bot is about to remove them — so the window
  // became room truth (`botAfkMs`) and the knob went with all three of its clamps.
  //
  // RETIRED RATHER THAN LEFT: a row mutating code that no longer exists VOIDs on every run and
  // reads as a broken probe rather than as a rule that stopped applying — the same reasoning that
  // deleted J11's pre-v11 `redacts` row. `mutate-one-window` M7/M8 replace them by asserting the
  // removal is COMPLETE (no export, no source mention, no default on a fresh device), which is the
  // property that matters once there is nothing to clamp.
  // ── the fold ───────────────────────────────────────────────────────────────────────────────
  { id: "M1", file: "rm", part: "A",
    why: "the fold stops filtering by the window — everybody who ever acted is 'active'",
    find: "      .filter((r) => r.lastTs >= since)\n",
    repl: "      .filter((r) => true)   /*J16M1*/\n",
    marker: "J16M1", expect: 1 },

  { id: "M2", file: "rm", part: "A",
    why: "a person's stamp becomes their FIRST act rather than their latest",
    find: "      if (ts > row.lastTs) row.lastTs = ts;",
    repl: "      if (row.lastTs === 0) row.lastTs = ts;   /*J16M2*/",
    marker: "J16M2", expect: 1 },

  { id: "M3", file: "rm", part: "B/D",
    why: "the effective window ignores the reach — the fold answers the window it was asked for",
    find: "    const effectiveWindowMs = Math.min(want, reach);",
    repl: "    const effectiveWindowMs = want;   /*J16M3*/",
    marker: "J16M3", expect: 1 },

  { id: "M4", file: "rm", part: "B/D",
    why: "`bounded` becomes a constant rather than a reading of the log",
    find: "    const bounded = want > reach;",
    repl: "    const bounded = false;   /*J16M4*/",
    marker: "J16M4", expect: 1 },

  // ── the label ──────────────────────────────────────────────────────────────────────────────
  // THE ROW THIS JOB IS ABOUT. Nothing breaks; the panel simply claims a reach it does not have.
  { id: "M5", file: "ui", part: "F",
    why: "the label states the REQUESTED window instead of the EFFECTIVE one — the panel says " +
         "'in the last hour' over a log holding four minutes, and nothing else changes",
    find: "    const span = _spanText(f.effectiveWindowMs);",
    repl: "    const span = _spanText(f.requestedWindowMs);   /*J16M5*/",
    marker: "J16M5", expect: 1 },

  { id: "M6", file: "ui", part: "F",
    why: "the caveat naming both numbers is dropped, so a bounded claim reads as an unbounded one",
    find: "      reachNote: f.bounded",
    repl: "      reachNote: false   /*J16M6*/",
    marker: "J16M6", expect: 1 },

  { id: "M7", file: "ui", part: "F",
    why: "the sources sentence stops saying chat is not counted, and implies all four",
    find: '      sources: "Counts queue actions, votes and saves. Chat is not counted',
    repl: '      sources: "Counts everything people do in the room. Also chatting',
    marker: "Counts everything people do", expect: 1 },

  { id: "M8", file: "ui", part: "F",
    why: "the empty list says nobody is HERE — a presence claim this system cannot make",
    find: '      window: n === 0 ? ("Nobody has done anything in the last " + span)',
    repl: '      window: n === 0 ? ("Nobody is here right now" + (span ? "" : ""))   /*J16M8*/',
    marker: "J16M8", expect: 1 },

  // ── the panel ──────────────────────────────────────────────────────────────────────────────
  { id: "M9", file: "ui", part: "E",
    why: "the panel re-filters by recency itself — a second copy of a rule that lives in the feature (P7)",
    find: "    for (const p of (fold.people || [])) {",
    repl: "    for (const p of (fold.people || []).filter((p) => p.lastTs >= (fold.since || 0))) {   /*J16M9*/",
    marker: "J16M9", expect: 1 },

  { id: "M10", file: "ui", part: "E",
    why: "the panel measures against the DEVICE clock rather than a server stamp (P2)",
    find: '    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;',
    repl: "    const now = Date.now();   /*J16M10*/",
    marker: "J16M10", expect: 1 },

  { id: "M11", file: "ui", part: "E",
    why: "the panel re-sorts the list, so the fold's ordering claim stops being the one shown",
    find: "    for (const p of (fold.people || [])) {",
    repl: "    for (const p of (fold.people || []).slice().sort((a, b) => a.userId < b.userId ? -1 : 1)) {   /*J16M11*/",
    marker: "J16M11", expect: 1 },

  // ── the number ─────────────────────────────────────────────────────────────────────────────
  // ── THE THREE CLAMP SITES, AND WHICH ONE IS THE ENFORCEMENT ────────────────────────────────
  // (HISTORICAL — the key is gone as of v272.) `activityWindowMs` was clamped in three places: `load()` (a stored blob), the setter (the
  // panel's control), and the reader. A first pass ran only two single-site drops, both came back
  // green, and that was recorded as a symmetric mutually-dominating PAIR. **That reading was
  // wrong, and single-site rows cannot produce the right one** — they say each site is
  // individually droppable and nothing about which one is carrying the rule.
  //
  // THE KEEP-ONE LATTICE IS WHAT IDENTIFIES IT (M16-M18), and it is not symmetric:
  //
  //     keep the READER only  (drop load + setter)  -> GREEN   the reader alone suffices
  //     keep LOAD only        (drop reader + setter)-> RED     load alone does not
  //     keep the SETTER only  (drop reader + load)  -> RED     the setter alone does not
  //
  // So **the reader is the enforcement and the two WRITERS are dominated by it**, holding only
  // jointly. Every single-site row below reports honestly — M12 green means load+setter together
  // suffice, which is true — but "each is dominated" and "the two shadow each other" are different
  // claims, and only the lattice separates them. THE CONDITION THAT WOULD END THE REDUNDANCY IS
  // NOT a third writer: it is REMOVING THE READER'S CLAMP, one edit away, which M17 measures
  // directly. `roles.md` §9 carries the corrected entry.
  // ── M12 IS GONE, AND ITS ABSENCE IS THE RECORD ─────────────────────────────────────────────
  // It dropped the clamp from `ChatPrefs.activityWindowMs`'s READER, and it was the row that
  // proved the clamp lived in more than one place. **v272 removed the device-local window
  // entirely** — the People panel shows the basis for a bot removing somebody, so a window this
  // client could choose could say a person is present while the bot removes them. There is no
  // reader left to drop a clamp from.
  // A row mutating code that no longer exists would VOID on every run and read as a broken probe
  // rather than as a rule that stopped applying; `mutate-one-window` M7/M8 replace it by asserting
  // the removal is COMPLETE rather than that the clamp holds.
  //
  // RETIRED WITH IT: M13, M15, M16, M17, M18 — the rest of the keep-one lattice over the same
  // three clamp sites. They found a real result (the reader is the enforcement, the two writers
  // dominated by it, holding only jointly) and that result is recorded in `roles.md` §9. There is
  // no clamp left for them to drop, and a row mutating code that no longer exists VOIDs on every
  // run and reads as a broken probe rather than as a rule that stopped applying.

  // THE ROW THE FIRST PASS DID NOT HAVE. M12's justification asserted the setter's part in the
  // domination while no row drove it — an unmeasured claim inside a probe, which is the shape
  // J49's rule is about. It has a row now rather than a note.
  // ── THE KEEP-ONE LATTICE ───────────────────────────────────────────────────────────────────
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    return { green: /All guards passed/.test(out) || /PASS/.test(out), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE) .*/m);
  return m ? m[0].slice(0, 170) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-j16] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j16] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  const want = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j16] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j16] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j16-active:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A row may need TWO edits when the thing under test is WHICH OF SEVERAL SITES ENFORCES a
      // rule — see the keep-one lattice, M16-M18, where each row keeps one clamp and drops the
      // other two. Both edits go through the same journal handle, so a run killed between them
      // restores both.
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

    // An EXPECTED-GREEN row is a recorded redundancy, and it is reported as its own verdict rather
    // than folded into the survivor count — a documented domination and an unnoticed break are
    // opposite findings and must not share a tally. Its green is only meaningful beside the
    // control named in its comment; a RED here is the redundancy ENDING and wants reading.
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
  console.log("\n[mutate-j16] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
