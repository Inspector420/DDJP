#!/usr/bin/env node
// journal/mutate-v275-delete.js — THE CONTROL THAT BOUNDS THE PASS-2 DRAIN.
//
// Deletes the ENTIRE `#### v275 — …` release-narrative section from §6's Phase 1. The point is
// what does NOT change: `journal/entry-list.js` comes back byte-identical and
// `check-roadmap-gate` passes, because neither rail can see a cut inside a span that contains no
// job-entry start token. entry-list is a rail for entry IDENTITY, not for content.
//
// Run it before trusting either rail on a narrative cut. If this mutation ever turns entry-list
// red, the section boundaries have moved and the drain's bounding rule is wrong.
//
//   node journal/mutate-v275-delete.js <roadmap.md> <out.md>
const fs = require("fs");
const [, , src, out] = process.argv;
if (!src || !out) { console.error("usage: mutate-v275-delete.js <roadmap.md> <out.md>"); process.exit(2); }
const s = fs.readFileSync(src, "utf8");

const START = "#### v275 — ";
const i = s.indexOf(START);
if (i < 0) { console.error("APPLIED-CHECK FAILED: no `#### v275 — ` heading"); process.exit(2); }

// The section ends at the next release heading. Bound on the EM-DASH form: `^#### v\d+ ` alone
// also matches the sub-heading `#### v280 IS OUTSIDE ANY LINTER'S REACH`, which would mis-bound.
const RE = /^#### v\d+ — /gm;
RE.lastIndex = i + START.length;
const m = RE.exec(s);
if (!m) { console.error("APPLIED-CHECK FAILED: no following release heading to bound on"); process.exit(2); }
const j = m.index;

const cut = s.slice(i, j);
const cutLines = cut.split("\n").length - 1;
if (cutLines !== 111) {
  console.error("APPLIED-CHECK FAILED: expected a 111-line v275 section, got " + cutLines);
  process.exit(2);
}
const mutated = s.slice(0, i) + s.slice(j);
if (mutated === s) { console.error("APPLIED-CHECK FAILED: mutation changed nothing"); process.exit(2); }
if (mutated.indexOf("#### v275 — ") >= 0) {
  console.error("APPLIED-CHECK FAILED: a v275 heading survives the cut"); process.exit(2);
}
fs.writeFileSync(out, mutated);
console.log("APPLIED: `#### v275` deleted whole — " + cutLines + " lines removed, " +
  (s.split("\n").length - 1) + " -> " + (mutated.split("\n").length - 1));
