#!/usr/bin/env node
// tools/probes/mutate-blocked-reason.js
// CONFIRM J06's GUARD BY MUTATION, one mutation at a time.
//
// Every rule this codebase has about mutation harnesses is here because one of them was broken by
// somebody who had already counted correctly:
//
//   · ASSERT THE EDIT APPLIED. `sed` and `replace` both report success on matching nothing, and a
//     mutation whose expected result is "nothing changes" cannot detect its own failure to apply.
//     So the anchor count is asserted BEFORE the run.
//   · ASSERT IT STILL APPLIES WHEN THE RESULT IS READ. Before-only is sufficient when one hand
//     holds the tree and worthless when two do — a second session restoring the file mid-run makes
//     the guards read unmutated source and report green for a mutation that no longer exists.
//     Under collision a green mutation is VOID, not a survivor.
//   · RED BY CRASH IS NOT RED ENOUGH, and one red line names the FIRST assertion to fire rather
//     than the only one that would have. So this prints which assertion reported it, and
//     `check-blocked-reason`'s `ok` COLLECTS rather than exits precisely so that attribution is
//     readable without clearing earlier failures by hand.
//
// Usage: node tools/probes/mutate-blocked-reason.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const rel = (p) => path.join(ROOT, p);

// Each mutation: the file, an anchor that must appear EXACTLY `count` times, its replacement, and
// what it is meant to break. The `expect` field is the assertion prefix that SHOULD report it.
const MUTATIONS = [
  {
    name: "the REDUCER's copy stops filtering on the reason",
    file: "backends/backend1/statederiver.js",
    from: '              if (!blockedReasonCounts(b.k)) continue;   // my end, or untyped — not the room\'s problem',
    to:   '              /* MUTATED: reducer copy no longer filters */',
    breaks: "the two copies of the tally disagree — the view refuses, the reducer accepts",
    expect: "C:",
  },
  {
    name: "the VIEW's copy stops filtering on the reason",
    file: "backends/backend1/statederiver.js",
    from: '        if (!blockedReasonCounts(b.k)) continue;   // untyped or local-only: reported, not counted',
    to:   '        /* MUTATED: view copy no longer filters */',
    breaks: "the view warrants an escape the reducer refuses — a room told to act and refused, forever",
    expect: "B:",
  },
  {
    name: "BOTH copies stop filtering (the pair a one-at-a-time pass is blind to)",
    file: "backends/backend1/statederiver.js",
    from: null,   // applied as the two above, together
    pair: [0, 1],
    breaks: "the reason means nothing at all, while the two copies agree with each other perfectly",
    expect: "B:",
  },
  {
    name: "an UNTYPED declaration counts",
    file: "backends/backend1/statederiver.js",
    from: '    const r = (typeof k === "string") ? BLOCKED_REASONS[k] : null;\n    return !!(r && r.counts);',
    to:   '    const r = (typeof k === "string") ? BLOCKED_REASONS[k] : null;\n    return r ? !!r.counts : true;   // MUTATED: untyped counts',
    breaks: "an older client can force a skip, and the change cannot land mid-flight",
    expect: "B:",
  },
  {
    name: "an UNKNOWN token is accepted and ignored instead of refused",
    file: "backends/backend1/statederiver.js",
    from: '          if (hasK && !isBlockedReason(cc.k)) { _rej(ev); continue; }',
    to:   '          /* MUTATED: unknown tokens admitted */',
    breaks: "an arbitrary string reaches liveDecl and so a checkpoint seed the fingerprint commits",
    expect: "B:",
  },
  {
    name: "the SEED drops the reason and keeps only the tier",
    file: "backends/backend1/statederiver.js",
    from: '        for (const u in decl.blocked) B[u] = { tier: decl.blocked[u].tier, k: decl.blocked[u].k };',
    to:   '        for (const u in decl.blocked) B[u] = { tier: decl.blocked[u].tier };   // MUTATED',
    breaks: "a client that forgot behind a checkpoint counts reporters a genesis fold discards",
    expect: "D:",
  },
  {
    name: "the interface hands out the LIVE table instead of a copy",
    file: "backends/backend1/streammanager.js",
    from: '      const out = {};\n      const src = StateDeriver.BLOCKED_REASONS || {};\n      for (const k in src) out[k] = { counts: !!src[k].counts };\n      return out;',
    to:   '      return StateDeriver.BLOCKED_REASONS || {};   // MUTATED: the live table',
    breaks: "a caller can rewrite what counts toward a skip for everything downstream",
    expect: "A:",
  },
  {
    name: "the reporter's map names a token the reducer does not know",
    file: "features/mediablocked.js",
    from: '    100: "unavailable",',
    to:   '    100: "gone-for-good",   // MUTATED: not in the vocabulary',
    breaks: "the reporter emits a token the fold refuses, losing the whole declaration",
    expect: "A:",
  },
  {
    name: "an unrecognised player error guesses a counting reason",
    file: "features/mediablocked.js",
    from: '    const k = _REASON_FOR_CODE[code];\n    if (!k) return null;',
    to:   '    const k = _REASON_FOR_CODE[code] || "unavailable";   // MUTATED: guess\n    if (!k) return null;',
    breaks: "any unknown failure reads as the song being dead, forcing skips the room did not earn",
    expect: "A:",
  },
  {
    name: "the admissibility gate stops refusing an unreached measurement",
    file: "tests/_probe-blocked-reason.js",
    from: '  if (expectAccepted && r.accepted !== r.requested) {',
    to:   '  if (false && expectAccepted && r.accepted !== r.requested) {   // MUTATED',
    breaks: "the gate certifies everything downstream on its own authority",
    expect: "Z:",
  },
];

function read(f) { return fs.readFileSync(rel(f), "utf8"); }
function write(f, s) { fs.writeFileSync(rel(f), s); }

function runGuard() {
  try {
    const out = execFileSync(process.execPath, [rel("tests/check-blocked-reason.js")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { red: false, out: out };
  } catch (e) {
    return { red: true, out: (e.stdout || "") + (e.stderr || "") };
  }
}
function firstAssertions(out) {
  return (out.match(/FAIL — ([A-Z]):/g) || []).map((m) => m.replace(/FAIL — /, "").replace(/:/, ""));
}

// ── the control: green before anything is touched ─────────────────────────────────────────────
const control = runGuard();
if (control.red) {
  console.log("CONTROL IS ALREADY RED — every reading below would be unattributable. Stopping.");
  console.log(control.out);
  process.exit(1);
}
console.log("control: check-blocked-reason GREEN\n");

let bad = 0;
for (let i = 0; i < MUTATIONS.length; i++) {
  const m = MUTATIONS[i];
  const steps = m.pair ? m.pair.map((j) => MUTATIONS[j]) : [m];
  const originals = new Map();

  // ── ASSERT EVERY ANCHOR APPLIES, BEFORE running anything ────────────────────────────────
  let applied = true;
  for (const s of steps) {
    if (!originals.has(s.file)) originals.set(s.file, read(s.file));
    const cur = read(s.file);
    const n = cur.split(s.from).length - 1;
    if (n !== 1) {
      console.log("SKIPPED (anchor matched " + n + " times, expected exactly 1): " + m.name);
      console.log("  anchor: " + JSON.stringify(s.from.slice(0, 70)));
      applied = false;
      bad++;
      break;
    }
    write(s.file, cur.split(s.from).join(s.to));
  }

  if (applied) {
    // ── AND ASSERT IT STILL APPLIES AT THE MOMENT THE RESULT IS READ ──────────────────────
    const res = runGuard();
    let stillThere = true;
    for (const s of steps) if (read(s.file).indexOf(s.to) < 0) stillThere = false;

    const fired = firstAssertions(res.out);
    if (!stillThere) {
      console.log("VOID (the mutation was gone by the time the result was read — something else " +
        "wrote to the tree; discard, do not treat as a survivor): " + m.name);
      bad++;
    } else if (!res.red) {
      console.log("SURVIVED  " + m.name);
      console.log("           would have broken: " + m.breaks);
      bad++;
    } else {
      const hit = fired.indexOf(m.expect.replace(":", "")) >= 0;
      console.log((hit ? "RED  " : "RED* ") + " " + m.name);
      console.log("        parts reporting: " + (fired.join(", ") || "(none named)") +
        (hit ? "" : "   <-- expected " + m.expect + " among them"));
      if (!hit) bad++;
    }
  }

  for (const [f, s] of originals) write(f, s);
}

// ── restored, and proved restored ─────────────────────────────────────────────────────────────
const after = runGuard();
console.log("\nrestored: check-blocked-reason " + (after.red ? "RED (RESTORE FAILED)" : "GREEN"));
if (after.red) { console.log(after.out); process.exit(1); }
console.log(bad === 0
  ? "\nEvery mutation was caught, by the assertion written for it."
  : "\n" + bad + " mutation(s) need reading — see above.");
process.exit(bad === 0 ? 0 : 1);
