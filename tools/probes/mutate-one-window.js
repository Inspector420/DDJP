// tools/probes/mutate-one-window.js
// One window — break the room-truth window, the fail-closed read, and the full removal of the
// device-local knob. Every row reopens the collision by a different route.
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
// markers (`OWM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-one-window.js M1 M2 M3
// `OW_SUITE=tests/check-who-is-here.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.OW_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.OW_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
  cp: path.join(ROOT, "core/chatprefs.js"),
};

const ROWS = [
  // ── THE COLLISION, REINTRODUCED ───────────────────────────────────────────────────────────
  { id: "M1", file: "rm", part: "window",
    why: "`recentlyActive` TAKES A WINDOW AGAIN — a parameter is a route to disagree through, and " +
         "the caller that supplies one is choosing a rule the bot does not act on",
    // ── TWO INERT VERSIONS, THEN A SITE THAT NOTICES — AND IT IS NOT DOMINATED ─────────────
    // The first version only ADDED a parameter and never read it. The second read `arguments[1]`
    // and still passed, because no fixture supplied a second argument — inert twice over, and I
    // was about to record it as dominated on the reasoning that the property is enforced by the
    // signature rather than by a check.
    //
    // **THAT REASONING WAS WRONG AND THE FIX PROVED IT.** Once the guard asserted the shipped
    // ARITY (`recentlyActive.length === 1`) and drove a caller passing a window anyway, this row
    // went RED — reading `arguments[1]` does not change the declared arity, but the accompanying
    // row that passes a window and expects the room's answer catches the read. **A row that will
    // not discriminate is a row whose subject you have not identified**, and the subject here was
    // never "can a parameter exist" — it was "can a passed value reach the fold".
    find: "    return foldActivity(log, nowTs, windowMs, sources,",
    repl: "    return foldActivity(log, nowTs, (arguments[1] || windowMs), sources,   /*OWM1*/",
    marker: "OWM1", expect: 1 },

  { id: "M2", file: "rm", part: "window",
    why: "the window stops being read from the room, so every client folds whatever it was handed " +
         "— the two-lists state this change removed",
    // RE-ANCHORED: the line these rows targeted was rewritten when the reader began indexing the
    // EXPORTED table (`api.ACTIVITY_WINDOW_KEY`) so the key could be moved at call time. Both went
    // VOID with ANCHOR MATCHED NOTHING — which is the guard rail working: a stale anchor refuses
    // rather than mutating whichever line looks closest.
    find: "      windowMs = (typeof s[wk] === \"number\" && isFinite(s[wk])) ? s[wk] : 0;",
    repl: "      windowMs = 900000;   /*OWM2*/",
    marker: "OWM2", expect: 1 },

  { id: "M3", file: "rm", part: "window",
    // ── DOMINATED BY THE SOURCES' OWN FAIL-CLOSED, and that is a fact rather than a gap ─────
    // The catch path IS reached — driven, a throwing `getState` gives `people: 0`, `sources:
    // {spine:false,chat:false}`, `window: 0`. But the SOURCES fail closed in the same catch, and
    // `foldActivity` counts nothing when `spine` is false WHATEVER the window is. So a default
    // window in that catch cannot change the answer: it is unreachable behind a stricter refusal.
    // Two facts, and this is the second one — the path is reached and produces the same list.
    //
    // WHAT WOULD NOTICE: the sources' fail-closed row in PART H. If that ever relaxed, this
    // default would become live in the same edit, which is why the row is kept rather than deleted.
    expectGreen: true,
    why: "an unreadable window FALLS BACK to a default instead of failing closed — DOMINATED: the " +
         "sources fail closed in the same catch, so nothing is counted whatever the window says",
    find: "    } catch (e) { sources = null; windowMs = 0; }",
    repl: "    } catch (e) { sources = null; windowMs = 900000; }   /*OWM3*/",
    marker: "OWM3", expect: 1 },

  { id: "M4", file: "rm", part: "window",
    why: "the window key is RESTATED rather than read from the table, so a rename leaves the fold " +
         "reading a key that no longer exists and listing nobody",
    // TWO EARLIER VERSIONS OF THIS ROW WERE INERT AND BOTH WERE MINE. The first restated the key
    // as the SAME literal (same answer, nothing to see); the second assigned an unused shadow
    // variable and touched nothing at all. **A row you cannot make discriminate is a row whose
    // subject you have not identified.** The subject is that the reader INDEXES THE EXPORTED TABLE
    // at call time — so the mutation must make it stop indexing, and the guard drives it by MOVING
    // the table entry, which a hardcoded read cannot follow.
    find: "      const wk = api.ACTIVITY_WINDOW_KEY;",
    repl: '      const wk = "botAfkMs";   /*OWM4*/',
    marker: "OWM4", expect: 1 },

  { id: "M5", file: "rm", part: "window",
    why: "the window key points at a setting the reducer does not define, so every room folds a " +
         "window of zero and lists nobody — silently",
    find: '  let ACTIVITY_WINDOW_KEY = "botAfkMs";',
    repl: '  let ACTIVITY_WINDOW_KEY = "activityWindowMs";   /*OWM5*/',
    marker: "OWM5", expect: 1 },

  // ── THE PANEL ─────────────────────────────────────────────────────────────────────────────
  { id: "M6", file: "ui", part: "window",
    why: "THE PANEL SUPPLIES A WINDOW AGAIN — the surface showing the basis for a removal choosing " +
         "its own rule, which is where the false statement comes from",
    find: "    try { fold = Room.recentlyActive(now); }",
    repl: "    try { fold = Room.recentlyActive(now, 60 * 60000); }   /*OWM6*/",
    marker: "OWM6", expect: 1 },

  // ── THE HALF-REMOVAL ──────────────────────────────────────────────────────────────────────
  { id: "M7", file: "cp", part: "removal",
    why: "the device-local accessor comes BACK — dead code that still reads plausible, which is " +
         "this tree's recorded shape for a half-removal",
    find: "  function dmClear() { _st().dms = []; _save(); _emit(); }",
    repl: "  function activityWindowMs() { return 900000; }   /*OWM7*/\n  function dmClear() { _st().dms = []; _save(); _emit(); }",
    marker: "OWM7", expect: 1 },

  { id: "M8", file: "cp", part: "removal",
    why: "a fresh device carries the preference again, so the default survives the removal and a " +
         "stored blob can still express a second window",
    find: "      dms: [],           // the DM conversation INDEX (J15)",
    repl: "      activityWindowMs: 900000,   /*OWM8*/\n      dms: [],           // the DM conversation INDEX (J15)",
    marker: "OWM8", expect: 1 },
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
    console.log("[mutate-ow] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-ow] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-ow] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-ow] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-one-window:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-one-window:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-ow] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
