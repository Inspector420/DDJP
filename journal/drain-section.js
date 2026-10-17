#!/usr/bin/env node
// journal/drain-section.js — replace ONE `#### vNNN — …` release-narrative section in §6 Phase 1.
//
// THE BOUNDING RULE, AND IT TOOK TWO CORRECTIONS TO GET RIGHT.
//   1. `^#### v\d+ ` alone also matches the SUB-heading `#### v280 IS OUTSIDE ANY LINTER'S REACH`
//      at the top of v280's own section. Bounding on it cuts v280 short and orphans the rest —
//      the pass-1 failure shape (a span cut that swallowed ten prose entries) arriving again.
//   2. The em-dash form `^#### v\d+ — ` matches 19 sections FILE-WIDE, not 17. The extra two are
//      both `#### v266` and both sit inside J17's entry, which carries a Kind and three Touches
//      and is a different unit under the four-clause keep-list. So the range 883–2322 (the
//      v267–v283 block) is part of the bound, not a convenience.
//   3. Those two v266 headings SHARE a version number, so anything keyed on vNNN alone collides
//      there. This tool keys on byte offset within the asserted block and never on vNNN alone.
//
// The block holds 0 `**Kind.**` and 0 `**Open`, so two of the keep-list's four clauses are
// vacuous here: what survives is THE DECISION AND ITS REASON and THE GUARD'S NAME.
//
//   node journal/drain-section.js <roadmap.md> <vNNN> <replacement.md> <out.md>
const fs = require("fs");
const [, , src, ver, repl, out] = process.argv;
if (!src || !ver || !repl || !out) {
  console.error("usage: drain-section.js <roadmap.md> <vNNN> <replacement.md> <out.md>"); process.exit(2);
}
const s = fs.readFileSync(src, "utf8");
const lines = s.split("\n");

// ── The block, asserted rather than assumed ──────────────────────────────────────────────────
const isRelease = (t) => /^#### v\d+ — /.test(t);
const blockStart = lines.findIndex((t) => t.startsWith("#### v283 — "));
const j17 = lines.findIndex((t) => t.startsWith("#### J17 — "));
if (blockStart < 0 || j17 < 0) { console.error("APPLIED-CHECK FAILED: block anchors not found"); process.exit(2); }
const inBlock = [];
for (let i = blockStart; i < j17; i++) if (isRelease(lines[i])) inBlock.push(i);
if (inBlock.length !== 17) {
  console.error("APPLIED-CHECK FAILED: expected 17 release sections in the block, got " + inBlock.length);
  process.exit(2);
}
const fileWide = lines.filter(isRelease).length;
if (fileWide !== 19) {
  console.error("APPLIED-CHECK FAILED: expected 19 file-wide release headings (17 + two #### v266 "
    + "inside J17), got " + fileWide);
  process.exit(2);
}

// ── The one section ──────────────────────────────────────────────────────────────────────────
const hits = inBlock.filter((i) => lines[i].startsWith("#### " + ver + " — "));
if (hits.length !== 1) {
  console.error("APPLIED-CHECK FAILED: " + ver + " matches " + hits.length + " headings in the block "
    + "(expected exactly 1)"); process.exit(2);
}
const a = hits[0];
const nxt = inBlock.find((i) => i > a);
const b = (nxt === undefined) ? j17 : nxt;      // exclusive

const wasLines = lines.slice(a, b);
const replacement = fs.readFileSync(repl, "utf8").replace(/\n+$/, "\n");
const replLines = replacement.split("\n"); if (replLines[replLines.length - 1] === "") replLines.pop();

if (!replLines[0].startsWith("#### " + ver + " — ")) {
  console.error("APPLIED-CHECK FAILED: replacement does not open with the " + ver + " heading — the "
    + "heading is KEPT (Open 2), because dropping it can strand a citation"); process.exit(2);
}
const mutated = lines.slice(0, a).concat(replLines, lines.slice(b)).join("\n");
if (mutated === s) { console.error("APPLIED-CHECK FAILED: drain changed nothing"); process.exit(2); }

// Post-write invariants: the block must still hold 17, the file 19, and no Touches may survive.
const ml = mutated.split("\n");
const mBlockStart = ml.findIndex((t) => t.startsWith("#### v283 — "));
const mJ17 = ml.findIndex((t) => t.startsWith("#### J17 — "));
let mIn = 0; for (let i = mBlockStart; i < mJ17; i++) if (isRelease(ml[i])) mIn++;
if (mIn !== 17) { console.error("APPLIED-CHECK FAILED: block now holds " + mIn + " sections"); process.exit(2); }
if (ml.filter(isRelease).length !== 19) { console.error("APPLIED-CHECK FAILED: file-wide count moved"); process.exit(2); }
if (replacement.indexOf("**Touches") >= 0) {
  console.error("APPLIED-CHECK FAILED: replacement still carries a Touches block (drop list)"); process.exit(2);
}
fs.writeFileSync(out, mutated);
console.log("APPLIED: " + ver + "  " + wasLines.length + " -> " + replLines.length + " lines  (-"
  + (wasLines.length - replLines.length) + ")   file " + (lines.length - 1) + " -> " + (ml.length - 1));
