#!/usr/bin/env node
// journal/mutate-j50-phase-heading.js — the SIBLING row's mutation.
// Reproduces the heading rename that reintroduced the bug: give a prose entry a `derivation` Kind
// while it sits under a non-phase `###` section. Before J50 the entry inherited Phase 6 and was
// silently excluded; after J50 an unattributable phase no longer excludes.
//   node journal/mutate-j50-phase-heading.js <roadmap.md> <out.md>
const fs = require("fs");
const [, , src, out] = process.argv;
const s = fs.readFileSync(src, "utf8");
const A = "**J31 —";
const i = s.indexOf(A);
if (i < 0) { console.error("APPLIED-CHECK FAILED: J31 anchor not found"); process.exit(2); }
const j = s.indexOf("**Kind.**", i);
const k = s.indexOf("`", j + 9);
const e = s.indexOf("`", k + 1);
const was = s.slice(k, e + 1);
const mutated = s.slice(0, k) + "`derivation`" + s.slice(e + 1);
if (mutated === s) { console.error("APPLIED-CHECK FAILED: nothing changed"); process.exit(2); }
if (!/\*\*Kind\.\*\* `derivation`/.test(mutated.slice(i, i + 400))) {
  console.error("APPLIED-CHECK FAILED: J31 does not now declare derivation"); process.exit(2);
}
fs.writeFileSync(out, mutated);
console.log("APPLIED: J31's Kind " + was + " -> `derivation` (it sits under a non-phase ### section)");
