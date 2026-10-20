// tools/probes/mutate-min-dj-rank.js
// CONFIRM BY MUTATION — J07's bar, each site alone AND the pair that a one-at-a-time pass is blind
// to. Run from the repo root: `node tools/probes/mutate-min-dj-rank.js`.
//
// ── THE THREE RULES THIS HARNESS IS BUILT TO OBEY ─────────────────────────────────────────────
// 1. ASSERT THE EDIT APPLIED. `sed` and string replace both report success on matching nothing, and
//    a mutation whose expected result is "nothing changes" cannot detect its own failure to apply.
//    Every anchor here must match EXACTLY ONCE before the write, or the row is refused.
// 2. ASSERT IT STILL APPLIES WHEN THE RESULT IS READ. Before-only is sufficient when one hand holds
//    the tree and worthless when two do: a second session restoring the file mid-run makes the
//    guards read unmutated source and report green for a mutation that no longer exists. So the
//    mutated text is re-checked after the suite has run and before the result is believed. A row
//    whose mutation vanished underneath it is VOID, not a survivor.
// 3. PAIRS. `09-roadmap.md` J39: one-at-a-time mutation is structurally blind to defences that come
//    in pairs. Here the reducer's gate and the rulebook's answer are one property in two places —
//    flip BOTH and `can() ≡ reducer` still holds, so every equivalence assertion in the suite stays
//    green while the bar has stopped existing. That row is the whole reason this file runs pairs.
//
// Each row names the guard PART expected to report it. `check-min-dj-rank`'s `ok` COLLECTS rather
// than exits, so a red there names every part that fired rather than only the first — which is what
// makes attribution readable without clearing earlier failures by hand.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const P = (rel) => path.join(ROOT, rel);

const SD = "backends/backend1/statederiver.js";
const CAP = "backends/backend1/capabilities.js";
const SM = "backends/backend1/streammanager.js";
const DIALS = "backends/backend1/dials.js";

// A mutation is a list of edits, so a row can hold two sites at once.
const ROWS = [
  {
    name: "the REDUCER's join gate stops reading the bar",
    expect: "min-dj-rank A/B/C/D (and capabilities, which drives one pair)",
    edits: [[SD,
      "if (!user || !Ranks.atLeast(rank, settings.minDjRank)) { _rej(ev); continue; }",
      "if (!user) { _rej(ev); continue; }"]],
  },
  {
    name: "the RULEBOOK stops reading the bar (can('dj.join') always OK)",
    expect: "min-dj-rank E",
    edits: [[CAP,
      "        const bar = _minDjRank(state);",
      "        const bar = \"uncategorized\";"]],
  },
  {
    name: "BOTH copies together — the pair a one-at-a-time pass cannot see",
    expect: "min-dj-rank A/B/C/D — and NOT E, because the two agree with each other while both wrong",
    edits: [
      [SD,
        "if (!user || !Ranks.atLeast(rank, settings.minDjRank)) { _rej(ev); continue; }",
        "if (!user) { _rej(ev); continue; }"],
      [CAP,
        "        const bar = _minDjRank(state);",
        "        const bar = \"uncategorized\";"],
    ],
  },
  {
    name: "the merge stops applying the bar (a settings write never lands)",
    expect: "min-dj-rank Z (the admissibility gate refuses before any result is printed)",
    edits: [[SD,
      "    if (_inValues(\"minDjRank\", s.minDjRank)) settings.minDjRank = s.minDjRank;",
      "    if (false) settings.minDjRank = s.minDjRank;"]],
  },
  {
    name: "the membership test admits ANY string (an undeclared bar lands)",
    expect: "setting-endpoints A2, min-dj-rank F",
    edits: [[SD,
      "    return typeof v === \"string\" && r.values.indexOf(v) >= 0;",
      "    return typeof v === \"string\";"]],
  },
  {
    name: "`_inRange` judges a MEMBERSHIP entry numerically instead of refusing to",
    // EXPECTED TO SURVIVE, and recorded rather than deleted. Driven: every one of the ten `_inRange`
    // call sites passes a numeric key literal, so a membership key never reaches it — and if one did,
    // `r.min`/`r.max` are `undefined` and both comparisons against `undefined` are false, so the
    // answer is already "refused". The kind check STATES the rule; the `undefined` comparison
    // ENFORCES it. J39's classification for this row is UNREACHABLE (per caller), not unguarded, and
    // roles.md §9 is where it is recorded. A row expected to survive is still worth running: it is
    // what turns "probably redundant" into a measurement, and it would go red the day somebody hands
    // `_inRange` a membership key.
    expectSurvives: true,
    expect: "NOTHING — unreachable through all ten callers; kept as a statement of the rule "
      + "(roles.md §9), with the `undefined` comparison doing the actual refusing",
    edits: [[SD,
      "    if (!r || !_isNumericRange(r)) return false;",
      "    if (!r) return false;"]],
  },
  {
    name: "the interface hands out the LIVE table instead of a copy",
    expect: "min-dj-rank F",
    edits: [[SM,
      "        for (const f in r) copy[f] = Array.isArray(r[f]) ? r[f].slice() : r[f];",
      "        for (const f in r) copy[f] = r[f];"]],
  },
  {
    name: "the bar is classified FROZEN instead of LIVE",
    expect: "min-dj-rank F",
    edits: [[DIALS,
      "                \"selfWitnessCheckpoint\", \"minDjRank\"];",
      "                \"selfWitnessCheckpoint\"];"]],
  },
  {
    name: "the seed drops the bar (settings sealed without it)",
    expect: "min-dj-rank G",
    edits: [[SD,
      "      settings: Object.assign({}, settings),",
      "      settings: (() => { const c = Object.assign({}, settings); delete c.minDjRank; return c; })(),"]],
  },
  {
    name: "the reducer's default bar is removed entirely",
    expect: "settings-passthrough / settings-rows / min-dj-rank F — the key stops existing",
    edits: [[SD, "      minDjRank: \"uncategorized\",", ""]],
  },
];

// ── A JOURNAL, BECAUSE THIS HARNESS WAS KILLED MID-ROW ONCE AND LEFT ONE MUTATION STANDING ────
// The in-process restore is a `finally` in spirit: it cannot run if the process is killed (a command
// timeout, a Ctrl-C, an OOM). The first run of this file was killed by a wall-clock timeout with the
// membership predicate still mutated, and the tree then sat with a one-line change nobody had
// authored — which is precisely the "an edit appeared in the tree nobody could attribute" shape the
// handoff carries as unresolved. It was caught by the CONTROL below refusing to run on a red tree,
// which is the mechanism working; it would NOT have been caught by reading.
//
// So every original is written to a journal on disk BEFORE the first edit, and a run that finds a
// journal already there restores from it and says so. Belt and braces: the control still refuses a
// red tree, because a journal cannot know about damage it did not cause.
const JOURNAL = path.join(ROOT, ".mutate-journal.json");

function journalWrite(map) {
  const obj = {};
  for (const [rel, src] of map) obj[rel] = src;
  fs.writeFileSync(JOURNAL, JSON.stringify(obj));
}
function journalClear() { try { fs.unlinkSync(JOURNAL); } catch (e) {} }
function journalRecover() {
  if (!fs.existsSync(JOURNAL)) return false;
  const obj = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  const names = Object.keys(obj);
  for (const rel of names) fs.writeFileSync(P(rel), obj[rel]);
  journalClear();
  console.log("[mutate] RECOVERED — a previous run did not finish. Restored from the journal: "
    + names.join(", ") + ". Re-running from scratch, because a row read against a tree somebody "
    + "else was mid-write on is VOID rather than a result.");
  return true;
}

// ── apply / restore, with the anchor asserted ─────────────────────────────────────────────────
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { const j = hay.indexOf(needle, i); if (j < 0) break; n++; i = j + needle.length; }
  return n;
}

function applyRow(row) {
  const originals = new Map();
  for (const [rel, from, to] of row.edits) {
    const file = P(rel);
    const src = fs.readFileSync(file, "utf8");
    if (!originals.has(rel)) { originals.set(rel, src); journalWrite(originals); }
    const hits = occurrences(src, from);
    if (hits !== 1) {
      // Restore whatever we already wrote before refusing, so a bad row cannot leave the tree dirty.
      for (const [r, s] of originals) fs.writeFileSync(P(r), s);
      journalClear();
      return { ok: false, why: "anchor matched " + hits + " times in " + rel + " (need exactly 1)" };
    }
    fs.writeFileSync(file, src.replace(from, to));
  }
  return { ok: true, originals };
}

function stillApplied(row) {
  for (const [rel, from] of row.edits) {
    const src = fs.readFileSync(P(rel), "utf8");
    if (occurrences(src, from) !== 0) return false;   // the original text is back — somebody restored it
  }
  return true;
}

function runSuite() {
  try {
    const out = execFileSync(process.execPath, [P("tests/run-all.js")],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { red: false, out };
  } catch (e) {
    return { red: true, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const reds = (out) => Array.from(new Set(
  (out.match(/^\[[a-z0-9-]+\] FAIL/gm) || []).map((s) => s.slice(1, s.indexOf("]")))
)).concat(/AssertionError/.test(out) ? ["(an assert threw — see the log)"] : []);

// ── the control: the tree is green BEFORE anything is mutated ──────────────────────────────────
// Without this a red row proves nothing: it could have been red already.
journalRecover();
console.log("[mutate] control — running the suite on the unmutated tree...");
{
  const c = runSuite();
  if (c.red) {
    console.log("[mutate] REFUSING TO RUN — the tree is already red:\n        " + reds(c.out).join(", "));
    process.exit(1);
  }
  console.log("[mutate] control GREEN.\n");
}

// ── ROW RANGE, so the pass can run in foreground batches ──────────────────────────────────────
// Each row pays a full suite run (~50s), so ten rows plus the control is ten minutes — longer than
// one shell invocation survives here, and a pass killed halfway is what left a mutation standing the
// first time. `--rows=4-6` runs a slice; the journal makes a killed slice recoverable either way.
// The control still runs for every slice, because a slice that starts on a dirty tree is void.
const _arg = (process.argv.find((a) => a.startsWith("--rows=")) || "").slice(7);
const _m = /^(\d+)-(\d+)$/.exec(_arg);
const FROM = _m ? Math.max(1, parseInt(_m[1], 10)) : 1;
const TO = _m ? Math.min(ROWS.length, parseInt(_m[2], 10)) : ROWS.length;

let survivors = 0, void_ = 0, ran = 0;
ROWS.forEach((row, i) => {
  if (i + 1 < FROM || i + 1 > TO) return;
  ran++;
  const tag = "[" + (i + 1) + "/" + ROWS.length + "]";
  const applied = applyRow(row);
  if (!applied.ok) {
    console.log(tag + " REFUSED — " + row.name + "\n        " + applied.why);
    void_++;
    return;
  }
  const r = runSuite();
  const held = stillApplied(row);
  for (const [rel, src] of applied.originals) fs.writeFileSync(P(rel), src);
  journalClear();

  if (!held) {
    console.log(tag + " VOID — " + row.name
      + "\n        the mutation was gone when the result was read. Under collision a green mutation "
      + "is VOID, not a survivor. Re-run from scratch.");
    void_++;
    return;
  }
  // A row may declare that it EXPECTS to survive — an unreachable line kept deliberately. Then a
  // survival is the recorded result and a RED is the surprise, because it would mean somebody made
  // the line reachable. Inverting the verdict for such a row is the only honest way to run it: a
  // survivor counted as a failure would push the next reader to delete a line §9 says to keep.
  if (row.expectSurvives) {
    if (r.red) {
      console.log(tag + " RED, AND THAT IS THE SURPRISE — " + row.name
        + "\n        reported by: " + reds(r.out).join(", ")
        + "\n        this row is recorded as UNREACHABLE; a red means it is now reachable, so the "
        + "reasoning in its comment needs re-deriving rather than trusting.");
      survivors++;   // counted as an anomaly, so the run does not exit 0
    } else {
      console.log(tag + " SURVIVED AS EXPECTED — " + row.name
        + "\n        " + row.expect);
    }
  } else if (r.red) {
    console.log(tag + " RED  — " + row.name
      + "\n        reported by: " + reds(r.out).join(", ")
      + "\n        expected   : " + row.expect);
  } else {
    console.log(tag + " SURVIVED — " + row.name
      + "\n        expected " + row.expect + " to report it, and NOTHING did.");
    survivors++;
  }
});

// Restore-verified: the tree must be green again, or the harness left damage behind.
console.log("\n[mutate] restoring and re-checking...");
const final = runSuite();
console.log("[mutate] tree after restore: " + (final.red ? "RED — THE HARNESS LEFT DAMAGE" : "green"));
console.log("[mutate] rows " + FROM + "-" + TO + ": " + (ran - survivors - void_) + " red, "
  + survivors + " survived, " + void_ + " void/refused, of " + ran + " run");
if (final.red || survivors || void_) process.exit(1);
