// tools/probes/mutate-j39-boundaries.js
// J39 PASS 1 — flip every boundary comparison in `backends/backend1/floor.js`.
//
// ── THE CLASS, AND WHY IT EARNED A SWEEP ────────────────────────────────────────────────────
// Six boundary defects, every one found by hand and usually after it broke something visible:
// `trimToFloor`'s `>` vs `>=`; two DM cap sites; three activity-window clamps; two tier caps; and
// the seal counter, where a count compared against a shrinking log went permanently negative.
// **Two of the six were found by a BROWSER rather than by the suite, and one ran for two days.**
//
// ── ENUMERATION FIRST: 849 SITES, SO THIS IS A FIRST PASS ──────────────────────────────────
// Mechanically counted over the 47 tagged production files (lib/ excluded — vendored, unreachable):
//     relational (< > <= >=)   651
//     Math.min / Math.max       57
//     .slice(                  100
//     for-loop bounds           41
//                              ---
//                              849
// A full suite run is 43s, so 849 mutations is **ten hours of runtime alone**. Even the durable
// path (floor, checkpoint, statederiver, streammanager, vouch, consensushash, history,
// checkpointformat) is 184 sites and 2.2 hours. **Declared a first pass rather than quietly doing
// a subset.**
//
// ── PASS 1 IS CLOSED. THE SHAPE, WHICH IS THE ESTIMATE FOR THE OTHER 831 ──────────────────
//     RED (a guard already catches it)          4
//     INERT (the flip cannot change an answer)   4   B01, B02, B09, B10
//     LIVE + newly guarded, no code change       3   B03, B07, B11
//     ------------------------------------------- 11 mutated of 18 sites
// **A THIRD OF THE FLIPS COULD NOT CHANGE AN ANSWER**, and one of those read as the sweep's most
// alarming survivor. **Three were real and all three were closed with a guard and NO code change** —
// every comparison in this file is correct as written; what was missing was anything noticing.
//
// PASS 1 IS `floor.js` — 18 sites on 16 lines. Chosen because the floor boundary is where the
// class has bitten hardest (`trimToFloor`, the seal counter's mark) and because it is ONE
// subsystem: a red here has one candidate cause.
//
// PASS 2, NAMED RATHER THAN IMPLIED:
//     checkpoint.js 19 · statederiver.js 60 · streammanager.js 17 · vouch.js 22 ·
//     consensushash.js 22 · history.js 16 · checkpointformat.js — the rest of the durable path.
// PASS 3: ui/interface.js 118 · matrixbridge.js 79 · userqueue.js 37 · room.js 25 · chatprefs.js 17
//     and the remainder — where a wrong boundary mis-renders rather than corrupting state.
//
// ── ANCHORS ARE THE HAZARD AND EVERY ONE IS QUALIFIED ──────────────────────────────────────
// `_trimmedBelow` appears at eighteen sites; `BARS[0]` appeared at seven. **An anchor naming an
// identifier that appears at many sites is not an anchor** — it applies cleanly and reports a
// plausible number about the wrong subject, which is worse than a VOID because a VOID announces
// itself. Every `find` below is a WHOLE LINE, and the runner refuses any that matches twice.
//
// ── WHAT THIS CANNOT REACH ─────────────────────────────────────────────────────────────────
// Comparisons inside `lib/` (the vendored SDK bundle) and anything exercised only in a browser.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const TARGET = path.join(ROOT, "backends/backend1/floor.js");
const JOURNAL = path.join(__dirname, ".mutation-journal.json");

// Whole-line anchors, each with the flip applied to ONE operator on that line.
const ROWS = [
  // INERT. At `length === CAP` the flip decides whether `slice(-CAP)` FIRES — and firing keeps
  // all CAP entries, which is the array it already had. Driven at 4/5/6 against CAP=5: the only
  // differing case produces an identical result. **No guard names `SEEN_CAP`, and none is owed:
  // there is nothing a guard could catch.**
  { id: "B01", line: "    if (_seen.length > SEEN_CAP) _seen = _seen.slice(-SEEN_CAP);",
    flip: [">", ">="], inert: true,
    why: "INERT — at length === CAP the flip only decides whether an identity slice runs" },
  // ── B02 IS INERT AND IS RECORDED AS SUCH, NOT RE-RUN ─────────────────────────────────────
  // It read as pass 1's most alarming survivor. **Driven: the branch executes only when
  // `l !== floorL`, so `l >= floorL` and `l > floorL` are THE SAME PREDICATE there** — every
  // position from 0..10 against floorL=5, zero differing answers. No guard could catch it because
  // nothing changes. **A textually-applied, semantically-inert mutation is a VOID this probe
  // failed to classify**: it checked that the TEXT changed, not that an ANSWER could.
  // `check-floor-boundary` carries a control asserting the two predicates still agree, so if the
  // branch's guard condition ever changes this becomes live and is noticed.
  { id: "B02", line: "      if (l !== floorL) return l > floorL;",
    flip: [">", ">="], inert: true,
    why: "INERT — the branch runs only when l !== floorL, so the flip cannot change an answer" },
  { id: "B03", line: "      return String(e.eventId) > bid;",
    flip: [">", ">="], why: "the tie-break at an equal floor position; >= would admit the boundary event itself" },
  { id: "B04", line: "    if (list.length < 2) return false;",
    flip: ["<", "<="], why: "the minimum list size for a quorum span" },
  { id: "B05", line: "      if (from <= 0 || to < 0 || to < from - 1) return false;   // the joining segment is not held",
    flip: ["<= 0", "< 0"], why: "the empty-span legality boundary" },
  { id: "B06", line: "        if (t > myTier) continue;                                   // below me: does not bind me",
    flip: [">", ">="], why: "the tier cap — one of the two the class already bit" },
  { id: "B07", line: "    if (_trusted && _pos(f) <= _pos(_trusted)) return false;        // not an improvement",
    flip: ["<=", "<"], why: "LIVE — whether a floor at the SAME position replaces the trusted one. GUARDED by check-floor-equal-position" },
  { id: "B08", line: "      if (TrustPolicy.tierOf(e.r) > myTier) continue;",
    flip: [">", ">="], why: "the second tier cap" },
  // INERT. A tie assigns the same value it already holds: `lo = e.floorL` where `e.floorL === lo`.
  // The flip changes whether an assignment HAPPENS, not what it produces.
  { id: "B09", line: "      if (lo === null || e.floorL < lo) lo = e.floorL;",
    flip: ["<", "<="], inert: true, why: "INERT — a tie re-assigns the value already held" },
  { id: "B10", line: "      if (hi === null || e.floorL > hi) hi = e.floorL;",
    flip: [">", ">="], inert: true, why: "INERT — same as B09, the other watermark" },
  { id: "B11", line: "      if (_pos(f) < _pos(_trusted)) return _weakened(\"replaced-by-older\");",
    flip: ["<", "<="], why: "LIVE — an equal-position floor called replaced-by-older or not. GUARDED by check-floor-equal-position" },
];

function read() { return fs.readFileSync(TARGET, "utf8"); }
function write(s) { fs.writeFileSync(TARGET, s); }

function journal(state) { fs.writeFileSync(JOURNAL, JSON.stringify(state, null, 2)); }
function clearJournal() { try { fs.unlinkSync(JOURNAL); } catch (e) {} }

function suiteVerdict() {
  try {
    const out = execFileSync("node", [path.join(ROOT, "tests/run-all.js")],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { green: /All guards passed/.test(out), reds: redsOf(out) };
  } catch (e) {
    const out = ((e.stdout || "") + (e.stderr || "")).toString();
    return { green: false, reds: redsOf(out) };
  }
}
function redsOf(out) {
  return (out.match(/^\[[a-z0-9-]+\] FAIL/gm) || []).map((m) => m.replace(/^\[|\] FAIL$/g, ""));
}

const only = process.argv.slice(2).filter((a) => /^B\d+$/.test(a));
const rows = only.length ? ROWS.filter((r) => only.indexOf(r.id) >= 0) : ROWS;
const results = [];

for (const row of rows) {
  const before = read();
  const hits = before.split("\n").filter((l) => l === row.line).length;
  // AN ANCHOR MATCHING TWICE IS VOID — it announces itself rather than reporting a plausible
  // number about whichever site came first.
  if (hits !== 1) {
    console.log(row.id + "  VOID  — anchor matched " + hits + " times: " + row.line.trim().slice(0, 50));
    results.push({ id: row.id, verdict: "VOID", hits: hits });
    continue;
  }
  // A ROW DECLARED INERT IS NOT RUN. Re-running it would report SURVIVED every time and read as
  // an unguarded boundary, which is what it did once.
  if (row.inert) {
    console.log(row.id + "  INERT — " + row.why);
    results.push({ id: row.id, verdict: "INERT", why: row.why });
    continue;
  }
  const mutated = row.line.replace(row.flip[0], row.flip[1]);
  if (mutated === row.line) {
    console.log(row.id + "  VOID  — the flip changed nothing");
    results.push({ id: row.id, verdict: "VOID", reason: "flip-inert" });
    continue;
  }
  journal({ target: "backends/backend1/floor.js", row: row.id, original: before });
  write(before.split("\n").map((l) => (l === row.line ? mutated : l)).join("\n"));

  // APPLIED-CHECKED BEFORE THE RUN.
  const nowText = read();
  if (nowText.indexOf(mutated) < 0) {
    write(before); clearJournal();
    console.log(row.id + "  VOID  — the mutation did not land");
    results.push({ id: row.id, verdict: "VOID", reason: "not-applied" });
    continue;
  }

  const v = suiteVerdict();

  // APPLIED-CHECKED AGAIN AFTER THE RESULT IS READ, before restoring.
  const stillThere = read().indexOf(mutated) >= 0;
  write(before);
  clearJournal();
  if (read() !== before) throw new Error(row.id + ": restore failed — the tree is dirty");

  if (!stillThere) {
    console.log(row.id + "  VOID  — the mutation vanished during the run");
    results.push({ id: row.id, verdict: "VOID", reason: "vanished" });
    continue;
  }
  const verdict = v.green ? "SURVIVED" : "RED";
  console.log(row.id + "  " + verdict.padEnd(9) + row.why +
    (v.green ? "" : "   [" + v.reds.join(", ") + "]"));
  results.push({ id: row.id, verdict: verdict, reds: v.reds, why: row.why, line: row.line.trim() });
}

const red = results.filter((r) => r.verdict === "RED").length;
const surv = results.filter((r) => r.verdict === "SURVIVED").length;
const vd = results.filter((r) => r.verdict === "VOID").length;
console.log("\n[j39-pass1] " + results.length + " rows: " + red + " RED, " + surv +
  " SURVIVED, " + vd + " VOID.");
if (surv) {
  console.log("SURVIVORS — each is either UNGUARDED or has NO CONSUMER, and those are different findings:");
  for (const r of results.filter((x) => x.verdict === "SURVIVED")) {
    console.log("  " + r.id + "  " + r.why + "\n        " + r.line);
  }
}
