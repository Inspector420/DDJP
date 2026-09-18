// run-index0-mutations.js — drive the F2 rows by mutating a COPY of the tree.
//
// 09-roadmap.md §8: a mutation whose expected result is "nothing changes" cannot detect its own
// failure to apply, and the four recorded ways it fails are — anchor matched nothing, anchor
// matched the wrong occurrence (a comment rather than the call), anchor moved the boundary being
// tested, and somebody else put the file back underneath the run. So:
//
//   · ASSERT THE EDIT APPLIED  — every anchor is required to match an EXACT expected count, and
//     the file is re-read from disk afterwards and the mutated text confirmed present.
//   · ASSERT IT STILL APPLIES WHEN THE RESULT IS READ — re-verified after the probe returns, so a
//     tree that changed underneath the measurement is caught rather than reported.
//   · MUTATE A COPY — the working tree is never written to, so a green control cannot be a control
//     that was quietly restored, and two runs cannot erase each other.
//
// Anchors are the CALL SITES, not the list declarations. Flipping a declaration would change what
// the lists CONTAIN, which is a different experiment: the question here is what the COMPARISON does
// at index 0, so the lists must stay exactly as they ship.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SRC = process.env.DDJP_TREE || path.resolve(__dirname, "..", "..");
const WORK = "/tmp/f2-mutations";

// ── the mutations, one row each ────────────────────────────────────────────────────────────────
const MUTATIONS = [
  { name: "A/A2  streammanager _ADVANCE_TYPES (BOTH sites)",
    row: "streammanager.js:147 + :240",
    file: "backends/backend1/streammanager.js",
    edits: [
      { from: "_ADVANCE_TYPES.indexOf(protocolType) >= 0", to: "_ADVANCE_TYPES.indexOf(protocolType) > 0", n: 1 },
      { from: "_ADVANCE_TYPES.indexOf(entry.type) >= 0", to: "_ADVANCE_TYPES.indexOf(entry.type) > 0", n: 1 },
    ] },
  { name: "A     streammanager :240 alone",
    row: "streammanager.js:240",
    file: "backends/backend1/streammanager.js",
    edits: [{ from: "_ADVANCE_TYPES.indexOf(entry.type) >= 0", to: "_ADVANCE_TYPES.indexOf(entry.type) > 0", n: 1 }] },
  { name: "A2    streammanager :147 alone",
    row: "streammanager.js:147",
    file: "backends/backend1/streammanager.js",
    edits: [{ from: "_ADVANCE_TYPES.indexOf(protocolType) >= 0", to: "_ADVANCE_TYPES.indexOf(protocolType) > 0", n: 1 }] },
  { name: "B     vouch :582 _criticalPositions (turn filter)",
    row: "vouch.js:582",
    file: "backends/backend1/vouch.js",
    edits: [{ from: "if (!b || NON_CRITICAL_TYPES.indexOf(b.t) >= 0) continue;",
             to: "if (!b || NON_CRITICAL_TYPES.indexOf(b.t) > 0) continue;", n: 1 }] },
  { name: "B     checkpoint :451 _countable (seal cadence)",
    row: "checkpoint.js:451",
    file: "backends/backend1/checkpoint.js",
    edits: [{ from: "if (t && Vouch.NON_CRITICAL_TYPES.indexOf(t) >= 0) continue;",
             to: "if (t && Vouch.NON_CRITICAL_TYPES.indexOf(t) > 0) continue;", n: 1 }] },
  { name: "B     vouch :306 eligible  [CONTROL: a row the suite KILLED]",
    row: "vouch.js:306",
    file: "backends/backend1/vouch.js",
    edits: [{ from: "if (NON_CRITICAL_TYPES.indexOf(b.t) >= 0) return false;",
             to: "if (NON_CRITICAL_TYPES.indexOf(b.t) > 0) return false;", n: 1 }] },
  { name: "B     vouch :613 carries   [CONTROL: a row the suite KILLED]",
    row: "vouch.js:613",
    file: "backends/backend1/vouch.js",
    edits: [{ from: "return NON_CRITICAL_TYPES.indexOf(type) < 0;",
             to: "return NON_CRITICAL_TYPES.indexOf(type) <= 0;", n: 1 }] },
  { name: "C     vouch :104 ENVELOPE_KEYS",
    row: "vouch.js:104",
    file: "backends/backend1/vouch.js",
    edits: [{ from: "if (ENVELOPE_KEYS.indexOf(k) >= 0) continue;",
             to: "if (ENVELOPE_KEYS.indexOf(k) > 0) continue;", n: 1 }] },
];

// THE DOCS SHIP WITH THE TREE, AS A SIBLING. `check-roadmap-gate` reads `09-roadmap.md` and treats
// its ABSENCE as a broken tree rather than a pass — correctly. The two archives extract as siblings
// (`ddjp_NNN/` and `docs_NNN/`), so a copy of the tree alone fails that guard for a reason that has
// nothing to do with any mutation. Copying the sibling too is what makes a RED attributable.
function findDocsSibling() {
  const parent = path.dirname(SRC);
  let hit = null;
  try {
    for (const d of fs.readdirSync(parent)) {
      if (/^docs[_-]?\d*$/.test(d) && fs.existsSync(path.join(parent, d, "main", "09-roadmap.md"))) {
        hit = path.join(parent, d);
        break;
      }
    }
  } catch (e) { /* fall through */ }
  return hit;
}
const DOCS = findDocsSibling();
if (!DOCS) {
  console.log("NO DOCS SIBLING FOUND beside " + SRC + " — check-roadmap-gate would fail in every " +
    "copy, in the control as much as in the mutants, and a uniformly red baseline hides which " +
    "reds belong to a mutation. Refusing to run.");
  process.exit(1);
}

function copyTree(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("cp", ["-a", SRC + "/.", dest]);
  // the sibling, at the same relative position the archives produce
  const docsDest = path.join(path.dirname(dest), path.basename(DOCS));
  if (!fs.existsSync(docsDest)) execFileSync("cp", ["-a", DOCS, docsDest]);
}

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { const j = hay.indexOf(needle, i); if (j < 0) break; n++; i = j + needle.length; }
  return n;
}

// Apply, and REFUSE unless the anchor matched exactly the expected number of times.
function applyEdits(tree, m) {
  const p = path.join(tree, m.file);
  let src = fs.readFileSync(p, "utf8");
  for (const e of m.edits) {
    const found = occurrences(src, e.from);
    if (found !== e.n) {
      throw new Error("ANCHOR MISMATCH in " + m.file + ": expected " + e.n + " occurrence(s) of\n    " +
        e.from + "\n  found " + found + ". A sed that matches nothing reports success; this does not.");
    }
    src = src.split(e.from).join(e.to);
  }
  fs.writeFileSync(p, src);
  // Read back from disk: the write is not the proof, the file is.
  const after = fs.readFileSync(p, "utf8");
  for (const e of m.edits) {
    if (occurrences(after, e.to) !== e.n) throw new Error("EDIT DID NOT LAND in " + m.file);
    if (occurrences(after, e.from) !== 0) throw new Error("ORIGINAL STILL PRESENT in " + m.file);
  }
  return true;
}

function stillApplies(tree, m) {
  const after = fs.readFileSync(path.join(tree, m.file), "utf8");
  for (const e of m.edits) {
    if (occurrences(after, e.to) !== e.n || occurrences(after, e.from) !== 0) return false;
  }
  return true;
}

function runProbe(tree) {
  const r = execFileSync(process.execPath,
    [path.join(tree, "tests", "_probe-index0-membership.js")],
    { env: Object.assign({}, process.env, { DDJP_TREE: tree }), encoding: "utf8" });
  return JSON.parse(r);
}

function runSuite(tree) {
  try {
    const out = execFileSync(process.execPath, [path.join(tree, "tests", "run-all.js")],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { green: /All guards passed/.test(out), failed: [] };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    const failed = Array.from(new Set((out.match(/^\[([a-z0-9-]+)\] FAIL/gm) || [])
      .map((s) => s.replace(/^\[|\] FAIL$/g, ""))));
    return { green: false, failed: failed };
  }
}

// ── control first ──────────────────────────────────────────────────────────────────────────────
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const control = path.join(WORK, "control");
copyTree(control);
console.log("=== CONTROL (unmutated copy) ===");
const controlProbe = runProbe(control);
console.log(JSON.stringify(controlProbe, null, 1));
const controlSuite = runSuite(control);
console.log("control suite: " + (controlSuite.green ? "GREEN" : "RED " + controlSuite.failed.join(",")));
if (!controlSuite.green) {
  console.log("\nThe control is not green. Every comparison below would be against a broken baseline.");
  process.exit(1);
}

// ── each mutation ──────────────────────────────────────────────────────────────────────────────
const results = [];
for (const m of MUTATIONS) {
  const tree = path.join(WORK, "mut-" + m.row.replace(/[^a-z0-9]+/gi, "_"));
  copyTree(tree);
  let applied = false, err = null;
  try { applied = applyEdits(tree, m); } catch (e) { err = e.message; }
  if (!applied) {
    console.log("\n=== " + m.name + " ===\n  NOT RUN — " + err);
    results.push({ name: m.name, row: m.row, error: err });
    continue;
  }
  let probe = null, probeErr = null;
  try { probe = runProbe(tree); } catch (e) { probeErr = ((e.stdout || "") + (e.message || "")).slice(0, 500); }
  const suite = runSuite(tree);
  // THE SECOND HALF: still mutated now that the results are in hand?
  const intact = stillApplies(tree, m);
  console.log("\n=== " + m.name + " ===");
  console.log("  row: " + m.row);
  console.log("  mutation applied: yes   |   still applies after reading: " + (intact ? "yes" : "NO — RESULT VOID"));
  console.log("  suite: " + (suite.green ? "GREEN (survivor — nothing noticed)" : "RED: " + suite.failed.join(", ")));
  console.log("  probe: " + (probeErr ? "INADMISSIBLE/ERROR " + probeErr : JSON.stringify(probe, null, 1)));
  results.push({ name: m.name, row: m.row, intact: intact, suiteGreen: suite.green,
                 suiteFailed: suite.failed, probe: probe, probeErr: probeErr });
}

fs.writeFileSync(path.join(WORK, "results.json"),
  JSON.stringify({ control: controlProbe, results: results }, null, 1));
console.log("\n\nresults written to " + path.join(WORK, "results.json"));
