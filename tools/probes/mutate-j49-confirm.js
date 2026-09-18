// tools/probes/mutate-j49-confirm.js
// JOURNALLED, SELF-RESTORING. Mutates the tree on disk, runs the suite, restores.
//
// WHAT THIS RUNNER IS FOR, AND IT IS NOT THE USUAL THING. Every other mutation runner in this
// tree exists to show a guard goes RED. This one exists to establish that a clause is DOMINATED,
// which means its headline rows are expected to stay GREEN — and `09-roadmap.md` §8 says exactly
// what that costs: **a mutation whose expected result is "nothing changes" cannot detect its own
// failure to apply.** A green row here is indistinguishable from a probe that never ran.
//
// So every row carries three separate defences, and none of them is optional:
//   · the anchor is applied through `_journal.open().apply()`, which REFUSES a replacement
//     matching nothing or matching more than once;
//   · `stillApplied()` is checked BEFORE the suite runs and AGAIN after its result is read, so a
//     row that was undone underneath the reader comes back VOID rather than green;
//   · every green row is PAIRED with a control in the direction where the expected result is a
//     CHANGE (M3/M4), because a mutation expected to make something appear announces its own
//     failure and one expected to leave the output alone does not.
//
//   M1  drop `!expectedVideoId ||`            expect GREEN  (the domination, on disk this time)
//   M2  drop the `no-reading` guard above it  expect GREEN  (the door that actually enforces)
//   M3  break the equality beside it          expect RED    (the runner can see this file at all)
//   M4  make the provider return {videoId:null} instead of null
//                                             expect RED at check-length-freshness
//                                             — THE DOMINATION'S PREMISE, mutated
//
// M4 is the row that matters. It simulates the J29 adapter, and if the suite notices it, then the
// guard `09-roadmap.md` names — `check-length-freshness` — is genuinely the one that would notice
// first when the redundancy ends, rather than a name written down and never tested.
//
// Run: node tools/probes/mutate-j49-confirm.js

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const J = require(path.resolve(__dirname, "_journal.js"));

const ROOT = path.resolve(__dirname, "../..");
const PB = path.join(ROOT, "features/playback.js");
const UI = path.join(ROOT, "ui/interface.js");
const PROBE = "mutate-j49-confirm";

// ── recover anything a previous run left behind, BEFORE reading a single byte ────────────────
const rec = J.recover();
if (rec.restored.length) {
  console.log("!! journal was dirty — restored " + rec.restored.length + " file(s) from a previous run:");
  rec.restored.forEach((r) => console.log("     " + r.file + " (" + r.probe + ")"));
  console.log("   Any measurement taken before this point in a previous run is VOID.");
}
if (rec.skipped.length) rec.skipped.forEach((s) => console.log("!! skipped " + s.file + ": " + s.why));

function suite() {
  try {
    const out = execSync("node tests/run-all.js 2>&1", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { green: /All guards passed/.test(out), out };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    return { green: false, out };
  }
}
function redGuards(out) {
  const names = new Set();
  out.split("\n").forEach((l) => {
    const m = /^\[([a-z0-9-]+)\] FAIL/.exec(l);
    if (m) names.add(m[1]);
  });
  return [...names];
}

const ROWS = [
  {
    id: "M1", file: PB, expect: "green",
    what: "drop `!expectedVideoId ||` from _confirmReading",
    find: "if (!expectedVideoId || r.videoId !== expectedVideoId) {",
    to:   "if (r.videoId !== expectedVideoId) {",
    marker: "if (r.videoId !== expectedVideoId) {",
    why: "THE DOMINATION. Green is the finding here, not a failure — and it is only a finding " +
         "because the applied-checks either side of the suite say the tree really held it.",
  },
  {
    id: "M2", file: PB, expect: "green",
    what: "drop the `no-reading` guard that refuses a non-object above the clause",
    find: 'if (!r || typeof r !== "object") return { ok: false, why: "no-reading" };',
    to:   "",
    marker: "provider-threw",       // the line above survives; the removed one is what we check for
    absent: 'why: "no-reading"',
    why: "The door that ACTUALLY enforces the case the clause reads as covering. Dropping it is " +
         "also green, which is the other half of the domination: with today's provider a null " +
         "reading is refused by BOTH and needed by NEITHER.",
  },
  {
    id: "M3", file: PB, expect: "red",
    what: "invert the equality beside the clause",
    find: "if (!expectedVideoId || r.videoId !== expectedVideoId) {",
    to:   "if (!expectedVideoId || r.videoId === expectedVideoId) {",
    marker: "r.videoId === expectedVideoId",
    why: "THE CONTROL FOR M1 AND M2. Without it, a green M1 is indistinguishable from a suite " +
         "that cannot see this function at all.",
  },
  {
    id: "M4", file: UI, expect: "red",
    what: "make the shipped provider return {videoId:null} instead of null — the J29 shape",
    find: "        if (!vd || !vd.video_id) return null;",
    to:   "        if (!vd || !vd.video_id) return { videoId: null, seconds: 0 };",
    marker: "{ videoId: null, seconds: 0 }",
    why: "THE PREMISE, MUTATED. This is the condition J49 names as ending the redundancy. If the " +
         "suite stays green here, then no guard would notice the redundancy ending and J49's " +
         "named guard is a name rather than a net.",
  },
];

// M5 is a TWO-FILE row and does not fit the loop, so it is run separately below.

const results = [];
for (const row of ROWS) {
  const h = J.open(PROBE, row.file);
  let applied = 0, appliedBefore = false, appliedAfter = false, res = null, err = null;
  try {
    applied = h.apply(row.find, row.to, 1);
    appliedBefore = row.absent
      ? (fs.readFileSync(row.file, "utf8").indexOf(row.absent) === -1)
      : h.stillApplied(row.marker);
    if (!appliedBefore) throw new Error("the edit did not survive its own write");
    res = suite();
    appliedAfter = row.absent
      ? (fs.readFileSync(row.file, "utf8").indexOf(row.absent) === -1)
      : h.stillApplied(row.marker);
  } catch (e) { err = e.message; }
  h.restore();

  const void_ = !!err || !appliedBefore || !appliedAfter;
  const verdict = void_ ? "VOID" : (res.green ? "green" : "red");
  const matched = !void_ && ((row.expect === "green") === !!res.green);
  results.push({ id: row.id, expect: row.expect, verdict, matched, applied,
                 appliedBefore, appliedAfter, err,
                 reds: res && !res.green ? redGuards(res.out) : [] });

  console.log("");
  console.log(row.id + " — " + row.what);
  console.log("   " + row.why);
  console.log("   applied: " + applied + " occurrence(s) | still applied before read: " +
              appliedBefore + " | after read: " + appliedAfter);
  console.log("   expected " + row.expect + ", got " + verdict + (matched ? "  ✓" : "  ✗"));
  if (err) console.log("   error: " + err);
  if (verdict === "red") console.log("   red guards: " + JSON.stringify(redGuards(res.out)));
}

// ── M5 — BOTH AT ONCE: the J29 provider shape AND the clause deleted as redundant ────────────
// The combination is the harm, and it is the one a future session can actually reach: J29 lands,
// somebody reads `!expectedVideoId ||` as dominated (it WAS, correctly, at the time it was
// measured) and deletes it. This row asks the only question that matters — does anything in the
// tree object? The probe's R4 has already measured what happens if nothing does: a `ddjp.play.len`
// is authored for a song the room cannot name, and the reducer accepts one per person per playing,
// so it can never be withdrawn.
console.log("");
console.log("M5 — the J29 provider shape AND the clause deleted, together");
console.log("   The combination that produces the harm. Expected red if ANYTHING in the suite");
console.log("   stands between a returning J29 adapter and an unwithdrawable declaration.");
{
  const hPB = J.open(PROBE + "-m5", PB);
  const hUI = J.open(PROBE + "-m5", UI);
  let ok = true, res = null, err = null;
  try {
    hPB.apply("if (!expectedVideoId || r.videoId !== expectedVideoId) {",
              "if (r.videoId !== expectedVideoId) {", 1);
    hUI.apply("        if (!vd || !vd.video_id) return null;",
              "        if (!vd || !vd.video_id) return { videoId: null, seconds: 0 };", 1);
    const before = hPB.stillApplied("if (r.videoId !== expectedVideoId) {") &&
                   hUI.stillApplied("{ videoId: null, seconds: 0 }");
    if (!before) throw new Error("one of the two edits did not survive its own write");
    res = suite();
    const after = hPB.stillApplied("if (r.videoId !== expectedVideoId) {") &&
                  hUI.stillApplied("{ videoId: null, seconds: 0 }");
    if (!after) throw new Error("an edit was undone underneath the read — VOID");
    console.log("   both applied, still applied before and after the read: true");
    console.log("   expected red, got " + (res.green ? "green  ✗" : "red  ✓"));
    if (!res.green) console.log("   red guards: " + JSON.stringify(redGuards(res.out)));
    else {
      console.log("   NOTHING IN THE SUITE OBJECTS. The named guard does not notice the");
      console.log("   redundancy ending, and no other guard does either.");
    }
  } catch (e) { err = e.message; ok = false; }
  hPB.restore(); hUI.restore();
  if (err) console.log("   error: " + err);
  results.push({ id: "M5", expect: "red", verdict: err ? "VOID" : (res.green ? "green" : "red"),
                 matched: !err && !res.green, reds: res && !res.green ? redGuards(res.out) : [] });
}

// ── the runner's own self-test ───────────────────────────────────────────────────────────────
// A runner that reports "applied" without applying is the failure this whole file is written
// against, so it is shown catching one: an anchor that cannot match must THROW rather than
// return a comfortable zero.
console.log("");
console.log("RUNNER SELF-TEST — an anchor that matches nothing must throw, not report green");
{
  const h = J.open(PROBE + "-selftest", PB);
  let threw = null;
  try { h.apply("THIS STRING IS NOT IN THE FILE", "x", 1); } catch (e) { threw = e.message; }
  h.restore();
  const clean = fs.readFileSync(PB, "utf8").indexOf("THIS STRING IS NOT IN THE FILE") === -1;
  console.log("   threw: " + (threw ? "yes — " + threw.slice(0, 70) : "NO — THE RUNNER IS BROKEN"));
  console.log("   file restored clean: " + clean);
  if (!threw) process.exitCode = 1;
}

console.log("");
const okRows = results.filter((r) => r.matched).length;
console.log("SUMMARY: " + okRows + " of " + results.length + " rows matched expectation, " +
            results.filter((r) => r.verdict === "VOID").length + " void");
results.forEach((r) => console.log("   " + r.id + "  expect " + r.expect.padEnd(5) +
  " got " + r.verdict.padEnd(5) + (r.reds.length ? "  reds: " + r.reds.join(",") : "")));

// Final proof the tree is back as it was.
const dirty = J.recover();
console.log("");
console.log("journal after run: " + (dirty.clean ? "clean" : "DIRTY — " + JSON.stringify(dirty)));
