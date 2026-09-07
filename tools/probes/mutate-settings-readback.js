// tools/probes/mutate-settings-readback.js
//
// CONFIRM BY MUTATION. Break each thing J35 built and check that the assertion written for it goes
// red — and that the row is reported by THAT assertion rather than by an earlier one.
// `check-settings-readback`'s `ok` COLLECTS rather than exits, so one red names every part that
// fired instead of only the first, which is what makes attribution possible without clearing the
// failures ahead of each row.
//
// ── A RESTORE THAT LIVES ONLY IN THE RUNNING PROCESS IS NOT A RESTORE ────────────────────────
// The J07 harness was killed by a wall-clock timeout mid-row and left a mutated line standing in
// the reducer; nothing about it looked wrong, and what caught it was a control refusing to run on a
// red tree rather than anyone reading the file. So this writes a JOURNAL to disk before the first
// edit and recovers from it on the next run, before doing anything else.
//
// ── AND ASSERT THE EDIT APPLIED, TWICE ──────────────────────────────────────────────────────
// Before the run: the anchor must match EXACTLY ONCE, or the mutation is aimed at nothing (or at a
// comment, which is the textual-guard failure wearing a mutation's clothes). After reading the
// result: the mutation must STILL BE PRESENT, because a before-only check is worthless if a second
// hand is on the tree — a green row from a file somebody restored underneath you is void, not a
// survivor.
//
// Usage:  node tools/probes/mutate-settings-readback.js [--rows=1-4] [--list]

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, "tools", "probes", ".mutate-settings-readback.journal.json");

const BRIDGE = "backends/backend1/matrixbridge.js";
const PROOF = "backends/backend1/settingsproof.js";

// Each row: the file, an anchor that must appear exactly once, its replacement, and the assertion
// prefix that OUGHT to report it. The last field is the claim being tested, not a hope.
const ROWS = [
  { name: "the subscriber stops asking for a deeper read",
    file: BRIDGE, from: "          _deepenSettingsRead();", to: "          /* mutated */;",
    expect: ["C:"] },
  { name: "needsDeeperRead always answers no",
    file: PROOF, from: "    if (_reachedGenesis) return false;\n    const v = verdict();",
    to: "    if (_reachedGenesis) return false;\n    if (true) return false;\n    const v = verdict();",
    expect: ["C:"] },
  { name: "needsDeeperRead answers yes for a CONCLUSIVE mismatch",
    file: PROOF, from: "    if (v.status !== \"unverifiable\") return false;",
    to: "    if (v.status !== \"unverifiable\" && v.status !== \"mismatched\") return false;",
    expect: ["B:"] },
  { name: "needsDeeperRead ignores having already reached genesis",
    file: PROOF, from: "    if (_reachedGenesis) return false;\n    const v = verdict();",
    to: "    const v = verdict();",
    expect: ["B:"] },
  { name: "the caller asks about a LATER position than the cut",
    file: BRIDGE, from: "        atL: at,\n        floorL: at,",
    to: "        atL: Number.MAX_SAFE_INTEGER,\n        floorL: at,",
    expect: ["C:"] },
  { name: "the read-back stops asking to genesis",
    file: BRIDGE, from: ".then(() => SettingsProof.readBack(0))",
    to: ".then(() => SettingsProof.readBack(Floor.position()))",
    expect: ["C:"] },
  { name: "the read-back trims BEFORE it re-proves",
    file: BRIDGE,
    from: "          const v = _proveFloorSettings();",
    to: "          if (typeof StreamManager !== \"undefined\" && StreamManager.trimToFloor) StreamManager.trimToFloor();\n          const v = _proveFloorSettings();",
    expect: ["C:"] },
  { name: "the pager answers a could-not-read with an empty array again",
    file: BRIDGE, from: "        if (!room) return null;",
    to: "        if (!room) return [];",
    expect: ["D:"] },
  { name: "the inline prove is deleted, leaving only the deep path",
    file: BRIDGE, from: "          _proveFloorSettings();   // reads the floor itself",
    to: "          /* mutated */;   // reads the floor itself",
    expect: ["C:"] },
  { name: "a mismatch acquires a retryable reason (confirms row 3's domination)",
    file: PROOF, from: "      return _record(\"mismatched\", \"named-event-was-superseded\",",
    to: "      return _record(\"mismatched\", \"cannot-establish-which-event-governed\",",
    expect: ["B:"] },
  { name: "a room change no longer clears the in-flight latch",
    file: BRIDGE, from: "    _deepeningSettings = false;\n    try { if (typeof Vouch",
    to: "    /* mutated */;\n    try { if (typeof Vouch",
    expect: ["E:"] },
  { name: "the continuation acts even after the room changed",
    file: BRIDGE, from: "          if (_currentSpaceId !== forSpace) return;",
    to: "          if (false) return;",
    expect: ["E:"] },
  { name: "the PAGER stops asking which room it is answering for",
    file: BRIDGE, from: "        if (_currentSpaceId !== forSpace) return null;   // this answer belongs to the room we left",
    to: "        if (false) return null;",
    expect: ["E:"] },
];

// ── RECOVER FIRST ─────────────────────────────────────────────────────────────────────────────
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
    const out = execFileSync(process.execPath, [path.join(ROOT, "tests", "check-settings-readback.js")],
      { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    return { red: false, out: out };
  } catch (e) {
    return { red: true, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// ── AND THE PAIRS ────────────────────────────────────────────────────────────────────────────
// A one-at-a-time pass is structurally blind to a pair that restores each other's symptom, so the
// combinations that could plausibly do that are driven together. Named by row number so the pair is
// re-runnable against exactly the edits it was written for.
const PAIRS = [
  { name: "both room checks removed at once (12+13)", rows: [12, 13], expect: ["E:"] },
  { name: "the ask and the answer both silenced (1+2)", rows: [1, 2], expect: ["C:"] },
  { name: "the caller's position and the read-back's depth both moved (5+6)", rows: [5, 6], expect: ["C:"] },
];

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
    return;
  }
  const slice = (process.argv.find((a) => a.indexOf("--rows=") === 0) || "").split("=")[1];
  let lo = 1, hi = ROWS.length;
  if (slice) { const m = slice.split("-"); lo = parseInt(m[0], 10); hi = parseInt(m[1] || m[0], 10); }

  // THE CONTROL, AND IT REFUSES TO RUN ON A RED TREE. This is the check that caught the J07
  // harness's leftover line — not reading. If the suite is already red, a survivor below means
  // nothing and a red below is unattributable.
  const control = runGuard();
  if (control.red) {
    console.log("CONTROL IS RED — refusing to mutate. The tree is not clean:\n" + control.out);
    process.exit(3);
  }
  console.log("Control: green.\n");

  let survivors = 0, misattributed = 0;
  for (let i = lo; i <= hi && i <= ROWS.length; i++) {
    const r = ROWS[i - 1];
    const rel = r.file;
    const abs = path.join(ROOT, rel);
    const before = fs.readFileSync(abs, "utf8");
    const hits = before.split(r.from).length - 1;
    if (hits !== 1) {
      console.log("row " + i + ": ANCHOR MATCHED " + hits + " TIMES — not run. A mutation aimed at " +
                  "nothing reports green, and green would read as a survivor. (" + r.name + ")");
      process.exit(4);
    }
    journal(i, r.name, [rel]);
    fs.writeFileSync(abs, before.split(r.from).join(r.to));

    const res = runGuard();

    // STILL APPLIED? Read the file again now that the result is in hand. Compared against the
    // replacement's own presence rather than the anchor's absence, because a row that INSERTS around
    // its anchor legitimately leaves it in place — the first version of this flagged that as VOID.
    const now = fs.readFileSync(abs, "utf8");
    const stillThere = now !== before && now.indexOf(r.to) >= 0;
    fs.writeFileSync(abs, before);
    unjournal();

    if (!stillThere) {
      console.log("row " + i + ": VOID — the mutation was not present when the result was read. " +
                  "Something else wrote to the tree; the reading is discarded, not kept. (" + r.name + ")");
      process.exit(5);
    }

    if (!res.red) { survivors++; console.log("row " + i + ": SURVIVOR — " + r.name); continue; }
    const reported = r.expect.filter((p) => res.out.indexOf("· " + p) >= 0);
    const which = (res.out.match(/· [A-Z]:/g) || []).map((s) => s.slice(2)).filter((v, j, a) => a.indexOf(v) === j);
    if (!reported.length) {
      misattributed++;
      console.log("row " + i + ": RED, but not by " + r.expect.join("/") + " — reported by " +
                  which.join(" ") + " (" + r.name + ")");
    } else {
      console.log("row " + i + ": red at " + reported.join("/") + " — " + r.name +
                  (which.length > 1 ? "   [also: " + which.join(" ") + "]" : ""));
    }
  }
  console.log("");
  let pairSurv = 0;
  for (const p of PAIRS) {
    const files = p.rows.map((n) => ROWS[n - 1].file).filter((v, i, a) => a.indexOf(v) === i);
    journal("pair", p.name, files);
    const originals = {};
    for (const f of files) originals[f] = fs.readFileSync(path.join(ROOT, f), "utf8");
    const applied = applyRows(p.rows);
    if (!applied.ok) {
      for (const f in originals) fs.writeFileSync(path.join(ROOT, f), originals[f]);
      unjournal();
      console.log("pair " + p.rows.join("+") + ": NOT RUN — " + applied.why);
      process.exit(4);
    }
    const res = runGuard();
    const stillThere = p.rows.every((n) => {
      const r = ROWS[n - 1];
      return fs.readFileSync(path.join(ROOT, r.file), "utf8").indexOf(r.to) >= 0;
    });
    for (const f in originals) fs.writeFileSync(path.join(ROOT, f), originals[f]);
    unjournal();
    if (!stillThere) {
      console.log("pair " + p.rows.join("+") + ": VOID — not present when the result was read");
      process.exit(5);
    }
    const reported = p.expect.filter((x) => res.out.indexOf("· " + x) >= 0);
    if (!res.red || !reported.length) {
      pairSurv++;
      console.log("pair " + p.rows.join("+") + ": SURVIVOR/misattributed — " + p.name);
    } else {
      console.log("pair " + p.rows.join("+") + ": red at " + reported.join("/") + " — " + p.name);
    }
  }
  console.log("\n" + (hi - lo + 1) + " row(s): " + survivors + " survivor(s), " +
              misattributed + " misattributed; " + PAIRS.length + " pair(s): " +
              pairSurv + " survivor(s).");
  if (survivors > 2 || misattributed || pairSurv) process.exit(1);
}

main();
