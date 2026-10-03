// tools/probes/mutate-j37-redelivery.js
//
// J37 — IS `check-accepted-boundary` PART C A TRIPWIRE, OR DOES IT ONLY LOOK LIKE ONE?
//
// PART C carries the gap assertion this job was filed against, and says of itself:
//   "If this ever goes red, re-delivery was built and this assertion is the thing to re-decide."
// That is a prediction about the guard's own reach, and this file tests it. Row 1 BUILDS
// re-delivery, in the production `withdrawn` subscriber, and asks whether PART C notices.
//
// Rows 2 and 3 are the controls, and they are the reason a green row 1 can be read at all: they
// break the rules PART C and PART A DO cover, so "PART C stayed green" cannot be dismissed as a
// guard that never runs. A refusal is evidence only if something adjacent was admitted.
//
// ── A RESTORE THAT LIVES ONLY IN THE RUNNING PROCESS IS NOT A RESTORE ────────────────────────
// A journal is written to disk before the first edit and recovered on the next run. The J07 harness
// was killed mid-row by a wall-clock timeout and left a competent, on-topic, mutated line standing
// in the reducer; reading did not catch it and would not have.
//
// ── ASSERT THE EDIT APPLIED, AND ASSERT IT STILL APPLIES ─────────────────────────────────────
// Before: the anchor must match EXACTLY ONCE, or the mutation is aimed at nothing — and a mutation
// aimed at nothing reports green, which reads as a survivor. After: the replacement must still be
// present when the result is read, because under a second hand on the tree a green row is VOID
// rather than a survivor.
//
// Usage:  node tools/probes/mutate-j37-redelivery.js [--rows=1-3] [--pairs] [--list]

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, "tools", "probes", ".mutate-j37-redelivery.journal.json");

const BRIDGE = "backends/backend1/matrixbridge.js";
const STREAM = "backends/backend1/streammanager.js";

const ROWS = [
  // ROW 1 — THE JOB ITSELF, BUILT. Replay what we still hold through the ONE door, on withdrawal.
  // Dedup keeps everything already folded out; the released boundary admits what was ignored. This
  // is the smallest honest implementation of J37, and PART C predicts it will go red.
  { name: "re-delivery BUILT in the production `withdrawn` subscriber",
    file: BRIDGE,
    from: "          if (ev.kind !== \"demoted\" && ev.kind !== \"withdrawn\") return;\n" +
          "          try { Floor.thinJoin(_localPager()); } catch (e) {}",
    to:   "          if (ev.kind !== \"demoted\" && ev.kind !== \"withdrawn\") return;\n" +
          "          try { for (const raw of _heldHere()) StreamManager.ingest(raw); } catch (e) {}\n" +
          "          try { Floor.thinJoin(_localPager()); } catch (e) {}",
    // Predicted `C:` when this harness was written, because that is where J37's entry said the gap
    // was pinned. It was not: row 1 survived, and all 116 guards stayed green. The claim now lives
    // in PART G, which loads the bridge and drives the real emission, so the prediction is `G:`.
    // Recorded rather than quietly corrected — the moved letter IS the finding.
    expect: ["G:"] },

  // ROW 2 — THE CONTROL FOR PART C's OTHER HALF. Belief made unretractable: the boundary is cached
  // on first read instead of derived from `Floor.current()`, so withdrawal no longer releases it.
  { name: "the accepted boundary made STICKY — belief is no longer retractable",
    file: STREAM,
    from: "  function _acceptedBoundary() {\n    const t = _trustedFloor();\n    if (!t || typeof t.floorL !== \"number\") return null;",
    to:   "  let _stickyAccepted = null;\n  function _acceptedBoundary() {\n    if (_stickyAccepted) return _stickyAccepted;\n    const t = _trustedFloor();\n    if (!t || typeof t.floorL !== \"number\") return null;\n    _stickyAccepted = { l: t.floorL, id: (typeof t.covers === \"string\") ? String(t.covers).split(\"..\")[1] : null };\n    return _stickyAccepted;",
    expect: ["C:"] },

  // ROW 3 — THE CONTROL FOR PART A. The accepted branch deleted outright: only the trimmed boundary
  // remains, which is the pre-J03 tree.
  { name: "the ACCEPTED branch deleted from the ingest gate (the pre-J03 tree)",
    file: STREAM,
    from: "    const acc = _acceptedBoundary();\n    if (acc && at(acc.l, acc.id)) return { kind: \"accepted\", at: acc.l };",
    to:   "    /* mutated: accepted branch removed */",
    expect: ["A:"] },
];

const PAIRS = [
  { name: "re-delivery built AND the boundary made sticky (1+2)", rows: [1, 2], expect: ["C:"] },
];

function recover() {
  if (!fs.existsSync(JOURNAL)) return;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(JOURNAL, "utf8")); } catch (e) {
    console.log("JOURNAL UNREADABLE — refusing to run. Restore the tree by hand: " + JOURNAL);
    process.exit(3);
  }
  console.log("RECOVERING from a journal left by a previous run (" +
              Object.keys(j.files || {}).length + " file(s)) — row " + j.row + ": " + j.name);
  for (const rel in j.files) fs.writeFileSync(path.join(ROOT, rel), j.files[rel]);
  fs.unlinkSync(JOURNAL);
  console.log("Recovered. Continuing.\n");
}
function journal(row, name, files) {
  const snap = {};
  for (const rel of files) snap[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  fs.writeFileSync(JOURNAL, JSON.stringify({ row: row, name: name, files: snap }));
}
function unjournal() { if (fs.existsSync(JOURNAL)) fs.unlinkSync(JOURNAL); }

function runGuard() {
  try {
    const out = execFileSync(process.execPath,
      [path.join(ROOT, "tests", "check-accepted-boundary.js")],
      { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    return { red: false, out: out };
  } catch (e) { return { red: true, out: (e.stdout || "") + (e.stderr || "") }; }
}
// THE WHOLE-SUITE READING, which is the number that matters for a survivor: a row that no guard
// anywhere notices is a different finding from one the wrong guard notices.
function runSuite() {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tests", "run-all.js")],
      { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    return { red: false, out: out };
  } catch (e) { return { red: true, out: (e.stdout || "") + (e.stderr || "") }; }
}
function redGuards(out) {
  return (out.match(/^\[([a-z0-9-]+)\] FAIL/gm) || []).map((s) => s.slice(1, s.indexOf("]")));
}

function applyRows(rows) {
  const touched = {};
  for (const n of rows) {
    const r = ROWS[n - 1];
    const abs = path.join(ROOT, r.file);
    const cur = fs.readFileSync(abs, "utf8");
    const hits = cur.split(r.from).length - 1;
    if (hits !== 1) return { ok: false, why: "row " + n + " anchor matched " + hits + " times" };
    fs.writeFileSync(abs, cur.split(r.from).join(r.to));
    touched[r.file] = 1;
  }
  return { ok: true, files: Object.keys(touched) };
}

function main() {
  recover();
  if (process.argv.includes("--list")) {
    ROWS.forEach((r, i) => console.log((i + 1) + ". " + r.name));
    PAIRS.forEach((p) => console.log("pair: " + p.name));
    return;
  }
  const wantPairs = process.argv.includes("--pairs");
  const slice = (process.argv.find((a) => a.indexOf("--rows=") === 0) || "").split("=")[1];
  let lo = 1, hi = ROWS.length;
  if (slice) { const m = slice.split("-"); lo = parseInt(m[0], 10); hi = parseInt(m[1] || m[0], 10); }

  // THE CONTROL, AND IT REFUSES TO RUN ON A RED TREE. This is what caught a previous harness's
  // leftover line — machinery built for something else, refusing.
  const control = runGuard();
  if (control.red) {
    console.log("CONTROL IS RED — refusing to mutate. The tree is not clean:\n" + control.out);
    process.exit(3);
  }
  console.log("Control: check-accepted-boundary green.\n");

  const results = [];
  const list = wantPairs ? [] : [];
  for (let i = lo; i <= hi && i <= ROWS.length; i++) list.push({ kind: "row", n: i });
  if (wantPairs) for (let p = 0; p < PAIRS.length; p++) list.push({ kind: "pair", n: p });

  for (const item of list) {
    const isPair = item.kind === "pair";
    const spec = isPair ? PAIRS[item.n] : ROWS[item.n - 1];
    const rows = isPair ? spec.rows : [item.n];
    const label = (isPair ? "pair" : "row " + item.n) + ": " + spec.name;

    const files = [];
    for (const n of rows) if (files.indexOf(ROWS[n - 1].file) < 0) files.push(ROWS[n - 1].file);
    const before = {};
    for (const rel of files) before[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");

    // APPLIED, before the run.
    let bad = null;
    for (const n of rows) {
      const r = ROWS[n - 1];
      const cur = fs.readFileSync(path.join(ROOT, r.file), "utf8");
      const hits = cur.split(r.from).length - 1;
      if (hits !== 1) bad = "row " + n + " anchor matched " + hits + " times";
    }
    if (bad) {
      console.log(label + "\n  ANCHOR DID NOT MATCH ONCE (" + bad + ") — not run. A mutation aimed " +
                  "at nothing reports green, and green would read as a survivor.");
      process.exit(4);
    }

    journal(isPair ? "pair-" + item.n : item.n, spec.name, files);
    applyRows(rows);

    const guard = runGuard();
    const suite = guard.red ? null : runSuite();

    // STILL APPLIED, after the result is in hand.
    let stillThere = true;
    for (const n of rows) {
      const r = ROWS[n - 1];
      const now = fs.readFileSync(path.join(ROOT, r.file), "utf8");
      if (now.indexOf(r.to) < 0) stillThere = false;
    }
    for (const rel of files) fs.writeFileSync(path.join(ROOT, rel), before[rel]);
    unjournal();

    if (!stillThere) {
      console.log(label + "\n  VOID — the mutation was not present when the result was read. " +
                  "Something else wrote to the tree; the reading is discarded, not kept.");
      process.exit(5);
    }

    if (guard.red) {
      const which = (guard.out.match(/[A-Z]:/g) || []).filter((v, j, a) => a.indexOf(v) === j);
      const hit = spec.expect.some((p) => guard.out.indexOf(p) >= 0);
      console.log(label + "\n  RED in check-accepted-boundary — reported by " + which.join(" ") +
                  (hit ? "  (as predicted: " + spec.expect.join(" ") + ")"
                       : "  ⚠ NOT the predicted assertion " + spec.expect.join(" ")));
      results.push({ label: label, outcome: "red", by: which.join(" ") });
    } else {
      const reds = suite ? redGuards(suite.out) : [];
      console.log(label + "\n  SURVIVOR in check-accepted-boundary (predicted " +
                  spec.expect.join(" ") + ").\n  whole suite: " +
                  (reds.length ? reds.length + " red — " + reds.join(", ") : "FULLY GREEN"));
      results.push({ label: label, outcome: "survivor", suite: reds });
    }
  }

  console.log("\n── summary ──");
  for (const r of results) {
    console.log("  " + (r.outcome === "red" ? "red      " : "SURVIVOR ") + r.label +
      (r.outcome === "survivor" ? "  [suite: " + (r.suite.length ? r.suite.join(",") : "green") + "]" : ""));
  }
}

main();
