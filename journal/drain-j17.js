#!/usr/bin/env node
// journal/drain-j17.js — J17 is a DIFFERENT UNIT from the v267–v283 narrative block.
//
// That block held 0 `**Kind.**` and 0 `**Open`, so two of the drain rule's four clauses were
// vacuous there and the surviving rule was *the decision and its reason* + *the guard's name*.
// **Do not carry the two-clause rule across.** J17 carries a Kind, live Opens and six Touches
// blocks, so the FULL four-clause keep-list applies:
//
//   1. the `Kind` field VERBATIM — `check-roadmap-gate` reads it and it is the only machine check
//      on this tree, so it is asserted byte-for-byte below rather than trusted to a careful edit;
//   2. any `Open` that still constrains future work;
//   3. the decision and its reason;
//   4. the guard's name.
//
// Dropped: `Touches`, row counts, mutation tables, the account of how the session got there.
//
// THE TWO `#### v266` HEADINGS INSIDE THE ENTRY ARE KEPT. They are release-entry anchors of the
// same kind as v267–v283, and `journal/drain-section.js` asserts a file-wide count of 19 that
// includes them — dropping them would silently break the bounding rule for any later narrative
// pass. Same reasoning as Open (2): a heading is an anchor, and an anchor you are counting on may
// itself be on a drop list.
//
//   node journal/drain-j17.js <roadmap.md> <replacement.md> <out.md>
const fs = require("fs");
const [, , src, repl, out] = process.argv;
if (!src || !repl || !out) { console.error("usage: drain-j17.js <roadmap.md> <replacement.md> <out.md>"); process.exit(2); }
const s = fs.readFileSync(src, "utf8");
const lines = s.split("\n");

const a = lines.findIndex((t) => t.startsWith("#### J17 — "));
const b = lines.findIndex((t) => t.startsWith("#### J18 — "));
if (a < 0 || b < 0 || b <= a) { console.error("APPLIED-CHECK FAILED: J17/J18 anchors not found"); process.exit(2); }
if (lines.filter((t) => t.startsWith("#### J17 — ")).length !== 1) {
  console.error("APPLIED-CHECK FAILED: J17 is not a single entry — the duplicate-id state J50 refuses"); process.exit(2);
}

const was = lines.slice(a, b);
const KIND = was.find((t) => t.startsWith("**Kind.**"));
if (!KIND) { console.error("APPLIED-CHECK FAILED: no `**Kind.**` line in the current J17"); process.exit(2); }

const replacement = fs.readFileSync(repl, "utf8").replace(/\n+$/, "\n");
const rl = replacement.split("\n"); if (rl[rl.length - 1] === "") rl.pop();

// ── Clause 1, asserted rather than trusted ─────────────────────────────────────────────────
if (!rl[0].startsWith("#### J17 — ")) { console.error("APPLIED-CHECK FAILED: replacement does not open with the J17 heading"); process.exit(2); }
if (rl.indexOf(KIND) < 0) {
  console.error("APPLIED-CHECK FAILED: the `**Kind.**` line is not reproduced VERBATIM. The gate\n" +
    "reads this field and it is the only machine check on the doc tree.\n  want: " + KIND);
  process.exit(2);
}
// ── The two v266 anchors ───────────────────────────────────────────────────────────────────
for (const h of was.filter((t) => /^#### v266 — /.test(t))) {
  if (rl.indexOf(h) < 0) { console.error("APPLIED-CHECK FAILED: a `#### v266` heading was dropped: " + h); process.exit(2); }
}
// ── Drop list ──────────────────────────────────────────────────────────────────────────────
if (/\*\*Touches/.test(replacement)) { console.error("APPLIED-CHECK FAILED: replacement still carries a Touches block"); process.exit(2); }

const mutated = lines.slice(0, a).concat(rl, lines.slice(b)).join("\n");
if (mutated === s) { console.error("APPLIED-CHECK FAILED: drain changed nothing"); process.exit(2); }
const ml = mutated.split("\n");
if (ml.filter((t) => /^#### v\d+ — /.test(t)).length !== 19) {
  console.error("APPLIED-CHECK FAILED: file-wide release-heading count moved off 19 — the bounding\n" +
    "rule drain-section.js asserts would now refuse"); process.exit(2);
}
if (ml.filter((t) => t.startsWith("#### J17 — ")).length !== 1) { console.error("APPLIED-CHECK FAILED: J17 no longer unique"); process.exit(2); }
fs.writeFileSync(out, mutated);
console.log("APPLIED: J17  " + was.length + " -> " + rl.length + " lines  (-" + (was.length - rl.length) +
  ")   Kind verbatim, both v266 anchors kept, file " + (lines.length - 1) + " -> " + (ml.length - 1));
