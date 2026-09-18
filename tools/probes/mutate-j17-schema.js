// tools/probes/mutate-j17-schema.js
// J17 (build) — break each of the five keys' folds, and the delegation table's self-exclusion.
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
// range about other claims; cite these as `mutate-j17-schema M4`, never as a bare `M4`. The journal
// markers (`J17M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j17-schema.js M1 M2 M3
// `J17_SUITE=tests/check-setting-endpoints.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.J17_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J17_SUITE;

const F = {
  sd: path.join(ROOT, "backends/backend1/statederiver.js"),
  sm: path.join(ROOT, "backends/backend1/streammanager.js"),
  ui: path.join(ROOT, "ui/interface.js"),
};

const ROWS = [
  // ── EACH KEY'S FOLD, ONE ROW PER KEY ──────────────────────────────────────────────────────
  // Five keys landed in one edit, so five separate rows are what stop "the schema folds" from
  // resting on whichever key the fixture happened to exercise. Each expects a CHANGE.
  { id: "M1", file: "sd", part: "fold",
    why: "`botPresenceSpine` stops folding — a room that turns Spine presence OFF silently keeps " +
         "it on, and the owner's setting is a control that does nothing",
    find: '    if (typeof s.botPresenceSpine === "boolean") settings.botPresenceSpine = s.botPresenceSpine;',
    repl: "    /*J17M1*/",
    marker: "J17M1", expect: 1 },

  { id: "M2", file: "sd", part: "fold",
    why: "`botPresenceChat` stops folding — the opt-in that keeps the bot out of encrypted chat " +
         "cannot be opted INTO, which is the safe direction and still a broken control",
    find: '    if (typeof s.botPresenceChat === "boolean") settings.botPresenceChat = s.botPresenceChat;',
    repl: "    /*J17M2*/",
    marker: "J17M2", expect: 1 },

  { id: "M3", file: "sd", part: "fold",
    why: "`botAfkMs` stops folding",
    find: '    if (_inRange("botAfkMs", s.botAfkMs)) settings.botAfkMs = s.botAfkMs;',
    repl: "    /*J17M3*/",
    marker: "J17M3", expect: 1 },

  { id: "M4", file: "sd", part: "fold",
    why: "`botPingMs` stops folding",
    find: '    if (_inRange("botPingMs", s.botPingMs)) settings.botPingMs = s.botPingMs;',
    repl: "    /*J17M4*/",
    marker: "J17M4", expect: 1 },

  { id: "M5", file: "sd", part: "fold",
    why: "`botDelegation` stops folding — the table can never be set at all",
    find: "    const dg = _delegationMap(s.botDelegation);\n    if (dg) settings.botDelegation = dg;",
    repl: "    /*J17M5*/",
    marker: "J17M5", expect: 1 },

  // ── THE ROW MOST WORTH A RED ──────────────────────────────────────────────────────────────
  // A rank that may edit the delegation table grants itself every other setting in one write.
  { id: "M6", file: "sd", part: "self-exclusion",
    why: "THE DELEGATION TABLE CAN NAME ITSELF — a rank granted `botDelegation` can then grant " +
         "itself every other setting in a single subsequent write. Nothing throws; the table " +
         "simply becomes a key to itself",
    find: '    botDelegation:        { keys: () => Object.keys(defaultSettings()).filter((k) => k !== "botDelegation"),',
    repl: '    botDelegation:        { keys: () => Object.keys(defaultSettings()),   /*J17M6*/',
    marker: "J17M6", expect: 1 },

  { id: "M7", file: "sd", part: "self-exclusion",
    why: "the domain is a frozen ARRAY rather than a function, so it snapshots the key set at " +
         "module-construction time and a key added later is silently never delegable",
    find: "    botDelegation:        { keys: () => Object.keys(defaultSettings()).filter((k) => k !== \"botDelegation\"),",
    repl: '    botDelegation:        { keys: ["maxLen"],   /*J17M7*/',
    marker: "J17M7", expect: 1 },

  { id: "M8", file: "sd", part: "self-exclusion",
    why: "the delegation write stops being WHOLE-OR-NOTHING — a table with one bad row applies " +
         "the rest of itself, so a typo silently delegates a subset nobody asked for",
    find: "      if (!_isValidMap(\"botDelegation\", v)) return null;",
    repl: "      if (!v || typeof v !== \"object\") return null;   /*J17M8*/",
    marker: "J17M8", expect: 1 },

  { id: "M9", file: "sd", part: "self-exclusion",
    why: "the value vocabulary stops being checked, so a delegation row can name a rank that " +
         "does not exist and the panel would render a blank selector for it",
    find: "      if (typeof v[k] !== \"string\" || r.values.indexOf(v[k]) < 0) return false;",
    repl: "      if (typeof v[k] !== \"string\") return false;   /*J17M9*/",
    marker: "J17M9", expect: 1 },

  // ── THE KIND, AND THE ORDER THAT READS IT ─────────────────────────────────────────────────
  { id: "M10", file: "sd", part: "kind",
    why: "`_isMapOf` is asked AFTER `_isValueSet`, so a map entry answers `values` and is " +
         "validated as a scalar — the shape-reading order is load-bearing, not tidiness",
    find: '    if (_isMapOf(r)) return "map";\n    if (_isNumericRange(r)) return "range";\n    if (_isValueSet(r)) return "values";',
    repl: '    if (_isNumericRange(r)) return "range";\n    if (_isValueSet(r)) return "values";\n    if (_isMapOf(r)) return "map";   /*J17M10*/',
    marker: "J17M10", expect: 1 },

  // ── THE BOUNDARY THE PANEL READS THROUGH ──────────────────────────────────────────────────
  { id: "M11", file: "sm", part: "seam",
    why: "the seam hands the panel the reducer's own FUNCTION instead of resolving it — code " +
         "crosses the boundary rule F exists to keep data-only, and rule F is textual so it " +
         "would not notice",
    find: "          if (typeof r[f] === \"function\") { try { copy[f] = r[f]().slice(); } catch (e) { copy[f] = []; } }",
    repl: "          if (typeof r[f] === \"function\") { copy[f] = r[f]; }   /*J17M11*/",
    marker: "J17M11", expect: 1 },
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
    console.log("[mutate-j17s] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j17s] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j17s] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j17s] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j17-schema:" + row.id, file);
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
  console.log("\n[mutate-j17s] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
