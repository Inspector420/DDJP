#!/usr/bin/env node
// tools/probes/mutate-j41-wire.js — does anything NOTICE when the blocked-report wire breaks?
//
// `paths.md` §9.12: the guard you just wrote is the likeliest place in the tree for a decorative
// assertion, and every one found that way was minutes old. `check-blocked-wire.js` is minutes old.
//
// TWO HALVES, and the second is the one that gets skipped:
//   · ASSERT THE EDIT APPLIED before reading the result. String replace reports success on
//     matching nothing, and a mutation whose expected result is "nothing changes" cannot detect
//     its own failure to apply.
//   · ASSERT IT STILL APPLIES WHEN THE RESULT IS READ. Before-only is sufficient with one hand on
//     the tree and worthless with two. Under collision a green mutation is VOID, not a survivor.
//
// JOURNALLED TO DISK, so a run that dies mid-mutation is restored by the next one rather than
// leaving a mutated tree to be read as a measurement.
//
// EVERY ROW NAMES THE ASSERTION THAT SHOULD REPORT IT. `check-blocked-wire`'s `ok` collects rather
// than exits precisely so that attribution is readable without clearing earlier failures by hand —
// one red line naming the first assertion to fire is a claim about ORDERING, not about coverage.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const JOURNAL = path.join(ROOT, "tools", "probes", ".mutate-j41-wire.journal.json");

// ── RECOVERY FIRST ───────────────────────────────────────────────────────────────────────────
if (fs.existsSync(JOURNAL)) {
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  for (const [rel, original] of Object.entries(j.files || {})) {
    fs.writeFileSync(path.join(ROOT, rel), original);
  }
  fs.unlinkSync(JOURNAL);
  console.log("[recovery] a previous run of " + (j.probe || "this probe") + " left the tree dirty ("
    + Object.keys(j.files || {}).length + " file(s)); restored byte-identically before starting.\n");
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function write(rel, s) { fs.writeFileSync(path.join(ROOT, rel), s); }

function runGuard(name) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tests", name)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!/\bPASS\b/.test(out)) return { red: true, how: "NO-PASS-LINE", parts: [], line: "(silent exit 0)" };
    return { red: false, how: "green", parts: [], line: "" };
  } catch (e) {
    const all = String(e.stdout || "") + String(e.stderr || "");
    const parts = [...new Set((all.match(/FAIL — ([A-Z]):/g) || [])
      .map((m) => m.replace("FAIL — ", "").replace(":", "")))];
    const named = all.match(/^\[[\w-]+\] FAIL — .*/m);
    if (named) return { red: true, how: "named-fail", parts, line: named[0].slice(0, 170) };
    const msg = all.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]*)/);
    if (msg) return { red: true, how: "assertion", parts, line: msg[1].slice(0, 170) };
    return { red: true, how: "RED-BY-CRASH (weak)", parts, line: all.split("\n")[0].slice(0, 170) };
  }
}

// ── THE MUTATIONS ────────────────────────────────────────────────────────────────────────────
// `expectPart` is the assertion prefix inside check-blocked-wire that SHOULD report it. `elsewhere`
// names another guard that also covers the rule, so a claim that moved keeps being tested.
const G = "check-blocked-wire.js";
const MUTATIONS = [
  { id: "M1", file: "ui/interface.js",
    find: "        onError: (e) => {",
    repl: "        onErrorDISABLED: (e) => {",
    expect: G, expectPart: "A",
    why: "THE WHOLE OF J41. This restores the tree exactly as it shipped for most of its life — a "
       + "main player with no onError — and the two existing guards on this feature must both stay "
       + "GREEN through it, which is what made the gap invisible",
    elsewhere: "check-blocked-reports.js",
    elsewhereExpectGreen: true },

  { id: "M2", file: "ui/interface.js",
    find: "          MediaBlocked.notifyPlayerError(e && e.data, erroredId);",
    repl: "          MediaBlocked.reportCannotSee(\"embed-denied\", e && e.data);",
    expect: G, expectPart: "C",
    why: "the UI deciding. A reason token spelled in ui/interface.js is a second home for the "
       + "code→token map, one edit away from disagreeing with the reducer's vocabulary" },

  { id: "M3", file: "ui/interface.js",
    find: "          MediaBlocked.notifyPlayerError(e && e.data, erroredId);",
    repl: "          MediaBlocked.notifyPlayerError(e, erroredId);",
    expect: G, expectPart: "B",
    why: "forwarding the EVENT rather than the code. Every error then maps to no token, so every "
       + "report is untyped, counts toward nothing, and the escape can never fire — the shipped "
       + "failure again, one layer in, and with a wire that looks entirely present" },

  { id: "M4", file: "features/mediablocked.js",
    find: "    return !!(np && np.song && videoId && np.song.videoId === videoId);",
    repl: "    return !!(np && np.song);",
    expect: G, expectPart: "D",
    why: "declaring on an unconfirmed reading. An error fired during a swap, or one where "
       + "getVideoData() answered nothing, is then declared against whatever the room happens to be "
       + "playing — and a declaration is judged once and can never be withdrawn" },

  { id: "M5", file: "features/mediablocked.js",
    find: "    reportCannotSee(np.pi, errorCode);",
    repl: "    reportCannotSee(np.pi);",
    expect: G, expectPart: "B",
    why: "dropping the code on the way through. The report still fires, so every symptom of a "
       + "working wire is present, and every declaration is untyped and advances no road" },

  { id: "M6", file: "features/mediablocked.js",
    find: "    const k = _REASON_FOR_CODE[code];\n    if (!k) return null;",
    repl: "    const k = _REASON_FOR_CODE[code] || \"unavailable\";   // MUTATED: guess\n    if (!k) return null;",
    expect: G, expectPart: "B",
    why: "guessing a COUNTING reason from an unknown failure — the one direction that can force a "
       + "skip the room never earned",
    elsewhere: "check-blocked-reason.js" },

  { id: "M7", file: "tests/_probe-j41-wire.js",
    find: "  if (expectSend && r.blocked.length === 0) {",
    repl: "  if (false && expectSend && r.blocked.length === 0) {   // MUTATED",
    expect: G, expectPart: "Z",
    why: "the admissibility gate. Without it an unreached measurement returns exactly what a "
       + "correct refusal returns, and every part of the guard is certified on the gate's own "
       + "authority" },

  { id: "M8", file: "tests/_probe-j41-wire.js",
    find: "const MAIN_PLAYER_ANCHOR = 'new YT.Player(\"yt-player\"';",
    repl: "const MAIN_PLAYER_ANCHOR = 'new YT.Player(';   // MUTATED: no longer names the main player",
    expect: G, expectPart: "A",
    why: "the anchor that keeps this measurement pointed at the MAIN player. The file holds a "
       + "second one — the preview mini-player, whose own comment says it must never touch a "
       + "consensus path — and without the element id a handler added there would satisfy the "
       + "whole guard" },

  { id: "M9", file: "features/mediablocked.js",
    find: "    return !!(np && np.song && videoId && np.song.videoId === videoId);",
    repl: "    return !!(np && np.song && np.song.videoId === videoId);",
    expect: G, expectPart: "D",
    why: "THE REDUNDANCY ROW. `videoId &&` looks dominated by the equality beside it — a null id "
       + "cannot equal a string. It is load-bearing only when np.song carries no videoId either, "
       + "where undefined === undefined answers TRUE. Run to find out which, rather than to assert "
       + "it: a redundancy is a statement about the routes that exist" },
];

// ── SELF-TEST OF THE RUNNER ──────────────────────────────────────────────────────────────────
// The runner decides what counts as red, so give it a mutation whose answer is known before any
// real row runs. If this does not go red, every row below is uninterpretable.
(function runnerSelfTest() {
  const rel = "features/mediablocked.js";
  const original = read(rel);
  const marker = "  function notifyPlayerError(errorCode, videoId) {";
  if (original.indexOf(marker) < 0) throw new Error("RUNNER SELF-TEST: anchor missing");
  fs.writeFileSync(JOURNAL, JSON.stringify({ probe: "mutate-j41-wire (self-test)", files: { [rel]: original } }));
  write(rel, original.replace(marker, marker + "\n    return;   // self-test: the wire does nothing"));
  const r = runGuard(G);
  write(rel, original);
  fs.unlinkSync(JOURNAL);
  if (!r.red) throw new Error("RUNNER SELF-TEST FAILED: a guard whose subject was broken read GREEN "
    + "— every row below would be meaningless");
  console.log("[runner] self-test PASS — a deliberately severed wire is detected as red (" + r.how
    + ", parts " + (r.parts.join(",") || "none named") + ")\n");
})();

// ── the control ──────────────────────────────────────────────────────────────────────────────
const control = runGuard(G);
if (control.red) {
  console.log("CONTROL IS ALREADY RED — every reading below would be unattributable. Stopping.");
  process.exit(1);
}
console.log("control: " + G + " GREEN\n");

// ── THE PASS ─────────────────────────────────────────────────────────────────────────────────
const results = [];
for (const m of MUTATIONS) {
  const original = read(m.file);
  const count = original.split(m.find).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, applied: false,
      note: "ANCHOR MATCHED " + count + " TIMES — not applied. A mutation that never reached the "
          + "code reports the same thing in every tree", why: m.why });
    continue;
  }
  fs.writeFileSync(JOURNAL, JSON.stringify({ probe: "mutate-j41-wire", files: { [m.file]: original } }));
  write(m.file, original.replace(m.find, m.repl));

  const after = read(m.file);
  const appliedNow = after.indexOf(m.repl) >= 0;
  let r = { red: null, how: "not-run", parts: [], line: "" };
  if (appliedNow) r = runGuard(m.expect);
  const stillApplied = read(m.file).indexOf(m.repl) >= 0;

  let elsewhereResult = null;
  if (m.elsewhere && appliedNow && stillApplied) elsewhereResult = runGuard(m.elsewhere);

  write(m.file, original);
  fs.unlinkSync(JOURNAL);

  results.push({ id: m.id, applied: appliedNow, stillApplied, red: r.red, how: r.how,
    parts: r.parts, line: r.line, why: m.why, expect: m.expect, expectPart: m.expectPart,
    elsewhere: m.elsewhere || null,
    elsewhereRed: elsewhereResult ? elsewhereResult.red : null,
    elsewhereExpectGreen: !!m.elsewhereExpectGreen });
}

// ── REPORT — COMPUTED FROM THE MEASUREMENT, NEVER PRE-WRITTEN ────────────────────────────────
console.log("=== mutate-j41-wire ===\n");
let red = 0, survived = 0, unapplied = 0, misattributed = 0;
for (const r of results) {
  if (!r.applied) { unapplied++; console.log(r.id + "  NOT APPLIED — " + r.note + "\n"); continue; }
  if (!r.stillApplied) {
    console.log(r.id + "  VOID — the mutation was undone beneath the run. Under collision a green "
      + "result is void rather than a survivor; discard and re-run from scratch.\n");
    continue;
  }
  if (r.red) red++; else survived++;
  const hit = r.red && r.parts.indexOf(r.expectPart) >= 0;
  console.log(r.id + "  " + (r.red ? "RED" : "SURVIVED") + "  [" + r.expect + "]"
    + (r.red ? " via " + r.how + ", parts " + (r.parts.join(",") || "(none named)") : ""));
  console.log("     rule: " + r.why);
  if (r.red && !hit) {
    misattributed++;
    console.log("     ATTRIBUTION: expected PART " + r.expectPart + " to report this and it did not. "
      + "A red is only evidence about the assertion that fired.");
  }
  if (r.red && r.line) console.log("     caught by: " + r.line);
  if (r.elsewhere) {
    const exp = r.elsewhereExpectGreen ? "green (that guard is BLIND to this by design)" : "also red";
    console.log("     elsewhere (" + r.elsewhere + "): "
      + (r.elsewhereRed === null ? "not run"
        : (r.elsewhereRed ? "also RED" : "green — this rule has ONE holder"))
      + "   [expected: " + exp + "]");
  }
  console.log("");
}
console.log(red + " red / " + (red + survived) + " applied"
  + (unapplied ? ("  (" + unapplied + " never applied — see above)") : "")
  + (misattributed ? ("  (" + misattributed + " reported by an assertion other than the expected one)") : ""));
if (survived) {
  console.log("\nSURVIVORS ARE NOT AUTOMATICALLY FINDINGS, AND NOT AUTOMATICALLY FINE. When a "
    + "mutation survives, suspect the FIXTURE before the assertion — the surviving mutation is "
    + "usually pointing at a case the fixture cannot express. And a survivor that is a genuine "
    + "redundancy must name the guard that would notice FIRST if the redundancy ended; if no guard "
    + "would, it is a note rather than a pin.");
}
