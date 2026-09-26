// tools/probes/mutate-activity-source.js
// Who counts as active — break the room-decides-what / device-decides-how-far-back separation.
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
// markers (`ASM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-activity-source.js M1 M2 M3
// `AS_SUITE=tests/check-who-is-here.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.AS_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.AS_SUITE;

const F = {
  ui: path.join(ROOT, "ui/interface.js"),
  rm: path.join(ROOT, "features/room.js"),
  gd: path.join(ROOT, "tests/check-who-is-here.js"),
};

const ROWS = [
  { id: "M1", file: "rm", part: "sources",
    why: "THE COLLISION, REINTRODUCED — the fold ignores the room's rule and counts everything, " +
         "so the People panel and a bot's channel membership answer a different question with " +
         "nothing reporting the difference",
    find: "      if (!wantSpine) continue;",
    repl: "      /*ASM1*/",
    marker: "ASM1", expect: 1 },

  { id: "M2", file: "rm", part: "sources",
    why: "absent sources FAIL OPEN — a panel with no room rule to read lists people under a " +
         "definition nobody set",
    find: '    const src = (sources && typeof sources === "object") ? sources : { spine: false, chat: false };',
    repl: '    const src = (sources && typeof sources === "object") ? sources : { spine: true, chat: false };   /*ASM2*/',
    marker: "ASM2", expect: 1 },

  { id: "M3", file: "rm", part: "sources",
    why: "the fold stops reporting what it CANNOT observe, so a room counting chat gets a list " +
         "that is silently a subset and implies agreement with the bot",
    find: "             unobservable: wantChat ? [\"chat\"] : [] };",
    repl: "             unobservable: [] };   /*ASM3*/",
    marker: "ASM3", expect: 1 },

  { id: "M4", file: "rm", part: "sources",
    why: "REFUSED acts count again — a person is listed as around on the strength of an act the " +
         "room threw away",
    find: "      if (legal(e.eventId) === false) { refused++; continue; }",
    repl: "      /*ASM4*/",
    marker: "ASM4", expect: 1 },

  { id: "M5", file: "rm", part: "sources",
    why: "the sources are CACHED rather than read fresh, so the panel goes on applying a " +
         "definition the owner has since changed",
    find: "      sources = { spine: s[ACTIVITY_SOURCES.spine] === true, chat: s[ACTIVITY_SOURCES.chat] === true };",
    repl: "      sources = _cachedSources || (_cachedSources = { spine: s[ACTIVITY_SOURCES.spine] === true, chat: s[ACTIVITY_SOURCES.chat] === true });   /*ASM5*/",
    marker: "ASM5", expect: 1 },

  { id: "M6", file: "rm", part: "sources",
    why: "the setting KEYS are restated rather than read from ACTIVITY_SOURCES, so a rename " +
         "leaves the fold reading a key that no longer exists and counting nobody",
    find: "      sources = { spine: s[ACTIVITY_SOURCES.spine] === true, chat: s[ACTIVITY_SOURCES.chat] === true };",
    repl: '      sources = { spine: s.botPresenceSpine === true, chat: s.botPresenceChat === true };   /*ASM6*/',
    marker: "ASM6", expect: 1 },

  { id: "M7", file: "ui", part: "label",
    why: "the panel stops saying it cannot see chat, so a room counting chat shows a subset that " +
         "reads as the whole answer",
    find: "    if (lab.unobservable) {",
    repl: "    if (false) {   /*ASM7*/",
    marker: "ASM7", expect: 1 },

  { id: "M8", file: "ui", part: "label",
    why: "the panel stops naming the ROOM as the source of the rule, so one definition is " +
         "presented as the only one — the state this job found",
    find: '        : "Counts queue actions, votes and saves, as this room defines being around. Actions the " +',
    repl: '        : "Counts queue actions, votes and saves. Actions the " +   /*ASM8*/',
    marker: "ASM8", expect: 1 },
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
    console.log("[mutate-as] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-as] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-as] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-as] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-activity-source:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-activity-source:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-as] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
