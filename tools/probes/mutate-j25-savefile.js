// tools/probes/mutate-j25-savefile.js
//
// J25 — IS check-savefile.js LOAD-BEARING, OR DECORATIVE? Written immediately after that guard,
// which `docs/paths.md` §9.12 names as the likeliest place in the tree for a decorative assertion:
// five have been found that way across two sessions and every one was in a guard written minutes
// earlier, because you read the intent back out of an assertion you just wrote.
//
// METHOD. Break one line of the SUBJECT (backends/backend1/checkpointformat.js), re-run the guard,
// and require it to go red. A mutation that leaves it green means the rule is not enforced however
// correct the code is.
//
// THE TWO HALVES OF "ASSERT THE EDIT APPLIED" (09-roadmap.md §8). Every row asserts its anchor
// matched BEFORE running the guard, and asserts the mutation is STILL on disk at the moment the
// result is read. Before-only is sufficient when one hand holds the tree and worthless when two
// do, and a mutation that was undone underneath itself reports green for a tree that never held it.
//
// AND RED BY CRASH IS NOT RED ENOUGH. A mutation that kills the guard by throwing before its own
// assertion runs is one swallowed exception away from killing nothing, so each row records WHICH
// line reported it and flags a row that died by exception instead of by assertion.
//
// EVERY MUTATION HERE IS JOURNALLED to tools/probes/.mutation-journal.json before it is applied and
// cleared after the tree is restored. A run killed mid-mutation leaves the journal dirty and the
// NEXT run restores from it rather than reading a mutated tree and calling it a measurement.
//
// Run: node tools/probes/mutate-j25-savefile.js   (from the tree root)

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const J = require(path.join(__dirname, "_journal.js"));

const SUBJECT = path.join(ROOT, "backends", "backend1", "checkpointformat.js");
const GUARD = path.join(ROOT, "tests", "check-savefile.js");

// ── recover anything a previous run left behind, before reading a single byte ────────────────
{
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[j25-savefile] RECOVERED a dirty tree from a previous run:");
    for (const r of rec.restored) console.log("      restored " + path.relative(ROOT, r.file) + " (left by " + r.probe + ")");
  }
  for (const s of rec.skipped) console.log("[j25-savefile] NOT restored: " + s.file + " — " + s.why);
  if (!rec.restored.length && !rec.skipped.length) console.log("[j25-savefile] journal clean on entry");
}

function runGuard() {
  try {
    const out = execFileSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" });
    return { red: false, out: out, crashed: false };
  } catch (err) {
    const out = String(err.stdout || "") + String(err.stderr || "");
    // A guard that PRINTS a FAIL line failed by assertion. One that only produced a stack trace
    // died before its assertions ran, which is a weaker red and is reported as such.
    const byAssertion = /\[savefile\] FAIL — /.test(out);
    return { red: true, out: out, crashed: !byAssertion };
  }
}

// The control has to come first: if the guard is not green on an unmutated tree, every red below
// is attributable to the tree rather than to the mutation.
const control = runGuard();
if (control.red) {
  console.log("[j25-savefile] CONTROL FAILED — the guard is not green on an unmutated tree, so no " +
    "row below is readable. Nothing was mutated.");
  console.log(control.out.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}
const assertionCount = (control.out.match(/\((\d+) assertions\)/) || [])[1] || "?";
console.log("[j25-savefile] control: guard GREEN on the unmutated tree (" + assertionCount + " assertions)\n");

const ROWS = [
  {
    id: "M1",
    what: "the envelope is moved INSIDE the payload commitment",
    why: "if filePrint covered the version and mode, a future envelope field would retroactively " +
         "unverify every older file — the exact ROW 1 mechanism the envelope exists to sit outside of",
    // THIS ROW TOOK THREE ATTEMPTS AND THE FIRST TWO ARE THE INSTRUCTIVE PART.
    //   (1) It added a CONSTANT to filePrint (`_mode: payload.__mode || "full"`), which moved every
    //       file's hash by the same amount and so expressed nothing. It survived — and in doing so
    //       correctly reported that the assertion it was aimed at was decorative: that assertion
    //       re-hashed the PAYLOAD after mutating the ENVELOPE, which cannot fail by signature.
    //       The assertion was rewritten to compare two FILES differing only in `mode`.
    //   (2) It then wrote `mode` into the payload in saveFile alone. That survived too, and the
    //       reason is a property of the code rather than of the guard: `filePrint` hashes an
    //       EXPLICIT FIELD LIST, not the payload wholesale, so a stray key cannot reach the
    //       commitment from that direction at all. Reading that survivor as "decorative" would
    //       have been exactly backwards — the rule is enforced STRUCTURALLY, and the allowlist is
    //       the thing doing it.
    // So the mutation has to break the allowlist too. Both sites, or it expresses nothing.
    edits: [
      { find: "      author: o.author ? { rank: String(o.author.rank) } : null,\n    };",
        with: "      author: o.author ? { rank: String(o.author.rank) } : null,\n      mode: (o.mode === \"bot\") ? \"bot\" : \"full\",\n    };",
        marker: "      mode: (o.mode === \"bot\") ? \"bot\" : \"full\",\n    };" },
      { find: "      author: (payload && payload.author) ? payload.author : null,",
        with: "      author: (payload && payload.author) ? payload.author : null,\n      mode: (payload && payload.mode) || null,",
        marker: "      mode: (payload && payload.mode) || null," },
    ],
    expect: "PART B",
  },
  {
    id: "M2",
    what: "an unknown format version is read best-effort instead of refused",
    why: "a partial read of a foreign file is the path-nothing-exercises that §Legacy deletes as a category",
    find: "if (!Number.isSafeInteger(file.ddjp) || file.ddjp !== FILE_VERSION) {",
    with: "if (false) {",
    marker: "if (false) {",
    expect: "PART C",
  },
  {
    id: "M3",
    what: "chainVerifies' below-two refusal is not consulted for a peer file",
    why: "a lone peer snapshot is self-consistent and untrustable; admitting it is a file that can " +
         "be read and never trusted",
    find: "    if (p.snapshots.length < 2) {",
    with: "    if (false) {",
    marker: "    if (false) {",
    expect: "PART D",
  },
  {
    id: "M4",
    what: "the file's OWN author claim selects the verification path",
    why: "rank read from a body is P6's exact prohibition, and a file has no channel origin to " +
         "read it from instead",
    find: "    const callerOwner = e.ownerAuthored === true;",
    with: "    const callerOwner = declaredOwner || e.ownerAuthored === true;",
    marker: "declaredOwner || e.ownerAuthored === true",
    expect: "PART D",
  },
  {
    id: "M5",
    what: "the optional history section is left out of the commitment",
    why: "an optional section must be spanned by the fingerprint when present, or a tail can be " +
         "swapped in transit without moving anything",
    find: "      hist: (payload && Array.isArray(payload.hist)) ? payload.hist : null,",
    with: "      hist: null,",
    marker: "      hist: null,",
    expect: "PART F",
  },
  {
    id: "M6",
    what: "the keyset diagnosis is asked AFTER the chain check instead of before",
    why: "THE ORDERING IS THE RULE. Both refuse the same file; only one of them is actionable, and " +
         "reporting the generic one tells the operator to re-export a file no re-export can fix",
    find: "    if (extra.length) {",
    with: "    if (false && extra.length) {",
    marker: "    if (false && extra.length) {",
    expect: "PART G",
  },
  {
    id: "M7",
    what: "an older-keyset file is refused for EVERY provenance, owner included",
    why: "the owner path adopts on authority with no recompute, so the key addition never reaches " +
         "it; refusing it strands exactly the file J28's override path is for",
    find: "      if (!callerOwner) {",
    with: "      if (true) {",
    marker: "      if (true) {",
    expect: "PART G",
  },
];

let survivors = 0, crashes = 0;

for (const r of ROWS) {
  const h = J.open("mutate-j25-savefile:" + r.id, SUBJECT);
  let hits;
  const edits = r.edits || [{ find: r.find, with: r.with, marker: r.marker }];
  try {
    hits = 0;
    // Each edit asserts its own anchor. A row needing more than one site says so: where a rule is
    // enforced STRUCTURALLY rather than by a branch, a single-site mutation cannot express it and
    // surviving would read as "decorative" when it actually means "cannot be broken from here".
    for (const ed of edits) hits += h.apply(ed.find, ed.with, 1);
  } catch (err) {
    h.restore();
    console.log("  " + r.id + " · " + r.what + "\n        → VOID — " + err.message +
      "\n        (a mutation that never applied is indistinguishable from one the code survived)");
    survivors++;
    continue;
  }

  const res = runGuard();
  // The second half of "assert the edit applied": is EVERY site still applied as the result is read?
  const stillThere = edits.every((ed) => h.stillApplied(ed.marker));
  h.restore();

  if (!stillThere) {
    survivors++;
    console.log("  " + r.id + " · " + r.what + "\n        → VOID — the mutation was not on disk " +
      "when the result was read; under collision a green mutation is VOID, not a survivor");
    continue;
  }

  const reported = (res.out.match(/\[savefile\] FAIL — (PART [A-Z0-9]+)/) || [])[1] || null;
  if (!res.red) {
    survivors++;
    console.log("  " + r.id + " · " + r.what + "\n        → SURVIVED (guard stayed GREEN) — " +
      r.why + "\n        THE ASSERTION FOR THIS IS DECORATIVE.");
  } else if (res.crashed) {
    crashes++;
    console.log("  " + r.id + " · " + r.what + "\n        → RED BY CRASH, not by assertion — one " +
      "swallowed exception away from killing nothing (" + r.why + ")");
  } else {
    console.log("  " + r.id + " · " + r.what + "\n        → RED at " + reported +
      (reported === r.expect ? " (expected " + r.expect + ")" : "  ⚠ EXPECTED " + r.expect +
        " — one red line names the FIRST assertion to fire, not the only one that would have; " +
        "attributing this means clearing the earlier failure and re-running") +
      "\n        anchor applied " + hits + "×, still applied at read time");
  }
}

// Final honesty check: the tree must be byte-identical to where it started.
{
  const rec = J.recover();
  const dirty = rec.restored.length > 0;
  console.log("\n[j25-savefile] " +
    (survivors === 0 && crashes === 0
      ? "every mutation was caught by an assertion written for it — no decorative rows"
      : survivors + " survivor/void row(s), " + crashes + " red-by-crash row(s); read those before " +
        "trusting the guard") +
    (dirty ? " · JOURNAL WAS DIRTY AT EXIT and has been restored" : " · tree restored, journal clean"));
}
