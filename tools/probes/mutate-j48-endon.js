#!/usr/bin/env node
// tools/probes/mutate-j48-endon.js
// THE MUTATION PASS FOR J48. Journalled, self-restoring, and self-tested.
//
// A guard that has never failed is a guard nobody has checked, and the guard you just wrote is the
// likeliest place in the tree for a decorative assertion. So every claim the new part of
// `check-playback-end.js` makes is broken here deliberately, and the row records which assertion
// reported it.
//
// ── THE TWO RULES THIS FILE IS BUILT AROUND ──────────────────────────────────────────────────
// 1. ASSERT THE EDIT APPLIED — `sed` and `replace` both report success on matching nothing, and a
//    mutation whose expected result is "nothing changes" cannot detect its own failure to apply.
//    Every row counts its anchor's occurrences before writing.
// 2. ASSERT IT STILL APPLIES WHEN THE RESULT IS READ — before-only is sufficient when one hand
//    holds the tree and worthless when two do. A second session sweeping the same tree restores
//    the file mid-run and both sweeps then read clean source and report survivors for mutations
//    neither tree ever held. Each row therefore re-reads the file after running the guard and
//    VOIDS itself if the bytes moved underneath it.
//
// THE JOURNAL IS THE SHARED ONE (`tools/probes/_journal.js`), not a private copy. The first draft
// of this file rolled its own, which is a second copy of a rule that already has a home — P7, and
// the thing this project breaks most often. `_journal.open()` also gives both halves of rule 1 and
// 2 for free: `apply()` REFUSES an anchor that matches nothing or matches more than once, and
// `stillApplied()` is the read-time half. A dirty journal from a killed run is recovered before a
// single byte is read, so an interrupted sweep tells the next reader rather than leaving a mutated
// tree that looks clean.

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const journal = require("./_journal.js");

const ROOT = path.resolve(__dirname, "..", "..");

const abs = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(abs(rel), "utf8");
const write = (rel, s) => fs.writeFileSync(abs(rel), s);
const count = (hay, needle) => hay.split(needle).length - 1;

function runGuard(rel) {
  const r = cp.spawnSync("node", [rel], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────────
// `expect: "red"` means the named guard MUST fail. `asks` is the guard this row's verdict is
// scoped to — a row proves nothing about any guard it did not run.
const ROWS = [
  {
    id: "M1",
    what: "drop `videoId &&` from Playback.shouldEndOn — the clause J48 is about",
    file: "features/playback.js",
    from: "return !!(np && np.song && videoId && np.song.videoId === videoId);",
    to:   "return !!(np && np.song && np.song.videoId === videoId);",
    asks: ["tests/check-playback-end.js"],
    expect: "red",
    wholeSuite: true,
    why: "the pin itself. It must go red, and the whole-suite run beside it is what shows the new " +
         "part is the thing that notices rather than one of several",
  },
  {
    id: "M2",
    what: "drop the identical clause from MediaBlocked.shouldReportBlocked — the sibling J41 closed",
    file: "features/mediablocked.js",
    from: "return !!(np && np.song && videoId && np.song.videoId === videoId);",
    to:   "return !!(np && np.song && np.song.videoId === videoId);",
    asks: ["tests/check-blocked-wire.js"],
    expect: "red",
    why: "the inherited pin, re-measured on a tree this session owns rather than trusted from the " +
         "handoff. It also proves the two clauses are guarded SEPARATELY: if this row went red at " +
         "check-playback-end, one guard would be covering both and the family sweep would be wrong",
  },
  {
    id: "M3",
    what: "stop the UI normalising an unconfirmable ENDED reading to null",
    file: "ui/interface.js",
    from: "let endedId = null;",
    to:   "let endedId;",
    asks: ["tests/check-playback-end.js"],
    expect: "red",
    why: "WHICH absence the clause has to defend is decided in ui/interface.js, not in playback.js. " +
         "If this could change silently, the pin would still pass while defending a pairing the wire " +
         "no longer produces — the reachability half, pinned rather than assumed",
  },
  {
    id: "M4",
    what: "make the reducer's seed path refuse a song whose id is not a string",
    file: "backends/backend1/statederiver.js",
    from: "song: n.song ? { videoId: n.song.videoId, videoUrl: n.song.videoUrl != null ? n.song.videoUrl : null } : null,",
    to:   "song: (n.song && typeof n.song.videoId === \"string\") ? { videoId: n.song.videoId, videoUrl: n.song.videoUrl != null ? n.song.videoUrl : null } : null,",
    asks: ["tests/check-playback-end.js"],
    expect: "red",
    why: "the premise. This is the OTHER answer to J48 — closing the family at the reducer instead " +
         "of pinning each consumer — and the row exists so that anyone who takes it is TOLD that the " +
         "guard has stopped testing anything, rather than left with a row that passes vacuously. " +
         "A green here would mean the part survives its own subject becoming unreachable",
  },
  {
    id: "M5",
    what: "make Playback's emit a no-op, so nothing can ever author an advance",
    file: "features/playback.js",
    from: "    if (!eventsChannel) return;\n    await MatrixBridge.sendEvent(eventsChannel, \"ddjp.dj.play\", { p: prev || null });",
    to:   "    if (!eventsChannel) return;\n    if (true) return;\n    await MatrixBridge.sendEvent(eventsChannel, \"ddjp.dj.play\", { p: prev || null });",
    asks: ["tests/check-playback-end.js"],
    expect: "red",
    why: "the control's own control. Every refusal the new part measures is worthless if nothing " +
         "could have advanced anyway, so a tree where the emit is dead must be REFUSED at the " +
         "control rather than read as three clean refusals",
    attribution: "ITS RED IS NOT SELF-ATTRIBUTING, AND THIS FILE CANNOT FIX THAT FOR YOU. `ok` " +
      "here exits on the first failure, so this row lands on part 4's wall-clock assertion — " +
      "which also covers a dead emit — and everything after it is unrun. Attributed the way §8 " +
      "Proving says to: part 4's row was flipped to agree with the broken code, the guard re-run, " +
      "and the CONTROL assertion then fired on its own (`5: the CONTROL authored no advance...`). " +
      "A future reader seeing this row red at part 4 has not yet measured what it claims.",
  },
];

// ── THE RUNNER'S OWN TEST ────────────────────────────────────────────────────────────────────
// A runner that silently fails to apply its edits reports a clean sweep, which is the most
// confident wrong answer available here. So before touching anything real it mutates a scratch
// copy in both directions and checks it can tell applied from not-applied.
function selfTest() {
  const problems = [];
  const tmp = path.join(__dirname, ".j48-selftest.tmp");
  try {
    fs.writeFileSync(tmp, "alpha beta gamma\n");
    const src = fs.readFileSync(tmp, "utf8");
    if (count(src, "beta") !== 1) problems.push("the occurrence counter cannot count a known anchor");
    if (count(src, "nosuchthing") !== 0) problems.push("the occurrence counter finds an anchor that is absent");
    const mutated = src.replace("beta", "delta");
    if (mutated === src) problems.push("a replacement that must change the text did not");
    const noop = src.replace("nosuchthing", "delta");
    if (noop !== src) problems.push("a replacement matching nothing reported a change");
    fs.writeFileSync(tmp, mutated);
    if (fs.readFileSync(tmp, "utf8") === src) problems.push("the write did not reach the disk");
    fs.writeFileSync(tmp, src);
    if (fs.readFileSync(tmp, "utf8") !== src) problems.push("the restore did not reach the disk");
  } catch (e) {
    problems.push("the self-test itself threw: " + e.message);
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  return problems;
}

// ── RUN ──────────────────────────────────────────────────────────────────────────────────────
const stProblems = selfTest();
if (stProblems.length) {
  console.log("[mutate-j48] REFUSED — the runner cannot tell an applied edit from a skipped one:");
  for (const p of stProblems) console.log("      " + p);
  process.exit(1);
}
console.log("[mutate-j48] runner self-test OK — it can count an anchor, apply an edit, notice a " +
            "replacement that matched nothing, and restore the bytes exactly.\n");

// ── recover anything a previous run left behind, BEFORE reading a single byte ────────────────
{
  const rep = journal.recover();
  if (rep.restored.length) {
    console.log("journal: restored " + rep.restored.length + " file(s) left dirty by a previous run:");
    for (const r of rep.restored) console.log("      " + r.file);
  } else if (rep.clean) {
    console.log("journal: clean — no previous run left the tree mutated.\n");
  }
  for (const s2 of rep.skipped) console.log("journal: LEFT ALONE — " + s2.file + ": " + s2.why);
}

const results = [];
let voided = 0;

for (const row of ROWS) {
  const before = read(row.file);
  const hits = count(before, row.from);
  if (hits !== 1) {
    console.log(row.id + "  REFUSED — the anchor appears " + hits + " times in " + row.file +
      " (expected exactly 1). Nothing was written; this row is a fact about the anchor, not about " +
      "the guard.");
    results.push({ id: row.id, verdict: "refused-anchor", hits: hits });
    continue;
  }

  // `apply` throws on an anchor matching nothing or matching more than once — rule 1, in the one
  // place that owns it rather than restated here.
  const h = journal.open("mutate-j48-endon:" + row.id, abs(row.file));
  const mutated = before.replace(row.from, row.to);
  if (mutated === before) {
    console.log(row.id + "  REFUSED — the replacement changed nothing despite a matching anchor.");
    results.push({ id: row.id, verdict: "refused-noop" });
    h.restore();
    continue;
  }
  h.apply(row.from, row.to, 1);

  const onDisk = read(row.file);
  const applied = onDisk === mutated;
  const guardRuns = row.asks.map((g) => ({ guard: g, run: runGuard(g) }));
  let suite = null;
  if (row.wholeSuite) suite = runGuard("tests/run-all.js");

  // THE SECOND HALF: do the bytes still hold the mutation now that the result has been read?
  const stillMutated = h.stillApplied(row.to.slice(0, 60));
  h.restore();
  const restored = read(row.file) === before;

  if (!applied || !stillMutated) {
    voided++;
    console.log(row.id + "  VOID — the file did not hold the mutation for the whole of the run " +
      "(applied=" + applied + ", still-applied-after=" + stillMutated + "). Under collision a " +
      "green mutation is void rather than a survivor; this row is discarded, not kept for comparison.");
    results.push({ id: row.id, verdict: "void" });
    continue;
  }
  if (!restored) {
    console.log(row.id + "  ⚠ THE RESTORE DID NOT VERIFY — " + row.file + " is NOT back to its " +
      "original bytes. Stop and restore from the package before trusting anything else.");
    results.push({ id: row.id, verdict: "restore-failed" });
    continue;
  }

  const reds = guardRuns.filter((g) => g.run.code !== 0);
  const verdict = (reds.length === guardRuns.length) ? "red" : "GREEN — SURVIVED";
  const ok = (verdict === "red") === (row.expect === "red");

  console.log(row.id + "  " + (ok ? "✓" : "✗ UNEXPECTED") + "  " + row.what);
  for (const g of guardRuns) {
    const first = (g.run.out.split("\n").find((l) => /FAIL|Error|✗/.test(l)) || "").trim();
    console.log("      " + g.guard + " -> " + (g.run.code === 0 ? "green" : "RED") +
      (first ? "\n         " + first.slice(0, 260) : ""));
  }
  if (suite) {
    const names = (suite.out.match(/\[[a-z0-9-]+\] FAIL/g) || []).map((s) => s.replace(" FAIL", ""));
    console.log("      whole suite -> " + (suite.code === 0 ? "GREEN (nothing notices)" :
      "RED at " + (names.length ? names.join(", ") : "an unnamed guard")));
    results.push({ id: row.id, verdict, suiteReds: names });
  } else {
    results.push({ id: row.id, verdict });
  }
  console.log("      why: " + row.why);
  if (row.attribution) console.log("      attribution: " + row.attribution);
  console.log("");
}

const applied = results.filter((r) => r.verdict === "red" || r.verdict === "GREEN — SURVIVED").length;
const red = results.filter((r) => r.verdict === "red").length;
console.log("[mutate-j48] " + red + " red / " + applied + " applied" +
  (voided ? ", " + voided + " VOID" : "") + ".");
console.log("Each verdict is scoped to the guards its row ASKED (`asks` above); a row proves " +
  "nothing about a guard it did not run.");
process.exit(red === applied && voided === 0 ? 0 : 1);
