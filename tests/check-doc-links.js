#!/usr/bin/env node
// tests/check-doc-links.js — DOES A MARKDOWN LINK IN THE DOCS RESOLVE TO A FILE?
// SUBJECT: docs/
//
// ── WHY THIS IS NOT `check-doc-xrefs` ───────────────────────────────────────────────────────
// That guard asks whether a TOKEN cited from the tree (`v292`, a probe name, a roadmap entry)
// still has a home somewhere in the docs. It says nothing about link SYNTAX, and it says so
// itself: its own §1.4 case is the reverse reminder that a markdown link checker reports GREEN
// when the address sits outside the parentheses. **Nothing resolved what was INSIDE them.**
//
// Found at `ddjp_399` by planting a citation to a file that does not exist inside a section
// newly added to `HANDOFF.md` and watching `check-doc-xrefs` stay green. The mutation was
// confirmed to reach disk first (md5 before and after), because a probe that never applied and
// a probe that applied and found nothing print the same thing — the forty-second signature.
//
// It was not a hypothetical. The same scan found ONE real break in the shipped tree:
// `HANDOFF.md` cited `[roles.md](../roles.md)`, one directory too high, in the paragraph
// sending a reader to the ten-file split rationale. A reader following it landed nowhere, and
// the state index is the worst place in the doc tree for that — the front door's whole design
// is that everything else is reached through one of four indexes, so an index whose pointers
// rot takes the tree's reachability with it. `check-front-door` resolves `START-HERE.md`'s
// pointers and only those; the other three indexes had nothing.
//
// ── WHAT IT DOES NOT COVER, NAMED SO IT IS NOT ASSUMED ──────────────────────────────────────
//   · ANCHORS. `file.md#section` is checked for the FILE and the fragment is dropped. Resolving
//     a fragment means deciding what a heading slugifies to, and this tree writes headings in
//     caps, with backticks and with `§` references that are not headings at all. A half-true
//     anchor check would fire on correct links, and the eleventh signature records what happens
//     to a guard that cries wolf.
//   · `§N` ADDRESSES IN PROSE. Outside the parentheses, so outside every link parser. That is
//     `check-doc-xrefs`'s §1.4 case and it stays there.
//   · LINKS INTO THE CODE TREE (`](../ddjp_399/...)`) resolve like any other relative path; if
//     one is ever written against a renumbered package it fails here, which is correct.
//
// ── THE ADMISSIBILITY CHECK IS NOT A FLOOR ON THE TREE ───────────────────────────────────────
// A count of links is something a legitimate job can reduce — a drain pass deletes citations by
// design — so a `links >= N` floor would fail honest work and teach the next session to re-tune
// it. That is the forty-seventh signature, which shipped its own diagnosis a hundred and fifty
// lines above the defect. What the floor would be standing in for is *the extractor still
// works*, so this drives the extractor at a FIXTURE with a known answer instead. Independent of
// tree size, and strictly stronger.

"use strict";
const fs = require("fs");
const path = require("path");
const DOCTREE = require("./_docs");

let failed = false;
let checked = 0;
const fail = (msg) => { failed = true; console.log("  \u2717 " + msg); };

// A link whose target is a local markdown file. The fragment is captured so it can be dropped
// deliberately rather than by accident — see the coverage note above.
const LINK = /\]\(([^)\s#]+\.md)(#[^)]*)?\)/g;

// CODE SPANS AND FENCED BLOCKS ARE STRIPPED FIRST, AND THAT IS A CORRECTION RATHER THAN A
// LOOSENING. In markdown `` `[roles.md](../roles.md)` `` renders as literal text: it is not a
// link, nothing resolves it, and a reader cannot follow it. This tree QUOTES stale and broken
// things constantly — it is how its records work — so a scanner that matched inside backticks
// would fire on every such record. It did, on its first real exercise: the paragraph in
// `HANDOFF.md` recording the `../roles.md` break quoted the break, and this guard flagged the
// quotation. Matching it was the defect; the prose was right.
//
// The replacement is driven rather than assumed — PART A's fixture asserts a backticked link and
// a fenced one are BOTH invisible while a bare one is still seen, so this cannot quietly become
// a way to hide a real citation by wrapping it.
function strip(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")   // fenced blocks
    .replace(/``[^`]*``/g, "")        // double-tick spans (used for literal backticks)
    .replace(/`[^`\n]*`/g, "");       // inline spans, within a line
}

function linksIn(text) {
  const out = [];
  for (const m of strip(text).matchAll(LINK)) out.push(m[1]);
  return out;
}

// ── PART A: the extractor is live, driven at a fixture ───────────────────────────────────────
// Denominated in nothing the tree can move. If this part is green the walk below is reading.
{
  const fixture = [
    "See [`PILLARS.md`](PILLARS.md) and [the spine](SPINE.md#the-six-layers).",
    "A [bare word](notmarkdown.txt) is not a doc link, and neither is <https://example.com/a.md>.",
    "A quoted one `[roles.md](../roles.md)` is literal text and must NOT be extracted.",
    "```",
    "[fenced](NEVER-RESOLVED.md)",
    "```",
    "A [nested one](consensus/trust-cascade.md) resolves through a subdirectory.",
  ].join("\n");
  const got = linksIn(fixture);
  const want = ["PILLARS.md", "SPINE.md", "consensus/trust-cascade.md"];
  checked++;
  if (got.join("|") !== want.join("|")) {
    fail("PART A — the link extractor does not read a fixture with a known answer. " +
      "wanted [" + want.join(", ") + "] and got [" + got.join(", ") + "]");
  }
  // And it must reject a target it should never resolve, or PART B's zero means nothing.
  checked++;
  if (linksIn("[x](missing.md)").length !== 1) {
    fail("PART A — the extractor does not see a link it is required to judge");
  }
}

// ── PART B: every link in the doc tree resolves ──────────────────────────────────────────────
const roots = DOCTREE.docRoots ? DOCTREE.docRoots() : [];
if (!roots.length) {
  // Signature 26: a dependency-backed guard FAILS when its dependency is absent. The docs ship
  // as a sibling of the code tree; their absence is a broken package, never a reason to pass.
  console.log("[doc-links] FAIL \u2014 no doc tree found. The docs ship alongside the code as " +
    "`docs_NNN/`; extract both archives next to each other.");
  process.exit(1);
}

function walkMd(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const root = roots[0];
const files = walkMd(root, []);
let links = 0;

for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const target of linksIn(text)) {
    links++;
    checked++;
    if (!fs.existsSync(path.resolve(path.dirname(f), target))) {
      fail(path.relative(root, f) + " links to `" + target + "`, which resolves to nothing");
    }
  }
}

// PART A already proved the extractor reads. This only proves the WALK reached files at all —
// an empty doc tree is a broken package, not a pass, and it is a different failure from a
// dead extractor.
checked++;
if (!files.length) fail("PART B — the doc tree holds no markdown files at all");

// THE GATE IS ON THE LAST LINE, BELOW EVERY PART. Two guards in this suite have printed FAIL
// and exited 0 because a part was appended beneath their exit check. This file is entirely
// synchronous, so last in the source is last in time — add an `async` part and that stops
// being true (the thirty-ninth signature).
if (failed) {
  console.log("[doc-links] FAIL \u2014 a markdown link in the docs points at no file.");
  process.exit(1);
}

console.log("[doc-links] PASS \u2014 every relative markdown link in the doc tree resolves to a " +
  "file that exists (" + links + " links across " + files.length + " documents, " + checked +
  " assertions). THE NUMBERS ARE AN OUTCOME AND ARE NOT PINNED: a drain pass legitimately " +
  "deletes citations, so a floor denominated in them would fail honest work and teach the next " +
  "session to re-tune it (the forty-seventh signature). What stands in for *the extractor still " +
  "works* is PART A, which drives it at a fixture with a known answer and is independent of the " +
  "tree's size. THIS GUARD RESOLVES THE FILE AND DELIBERATELY NOT THE ANCHOR \u2014 `#fragment` " +
  "is dropped, because slugifying this tree's headings (caps, backticks, `\u00a7` addresses that " +
  "are not headings) would fire on correct links, and a guard that cries wolf gets disabled. " +
  "IT ALSO SKIPS CODE SPANS AND FENCED BLOCKS, which it learned on its first real exercise: the " +
  "paragraph recording the `../roles.md` break QUOTED the break, and this guard flagged the " +
  "quotation. A backticked link renders as literal text and cannot be followed, so matching it " +
  "was the defect. Driven both ways in PART A and against the tree \u2014 the same target reddens " +
  "unquoted and passes backticked \u2014 so the exclusion cannot become a way to hide a real one. " +
  "It exists because `check-doc-xrefs` asks whether a cited TOKEN still has a home and never " +
  "resolved what sits inside the parentheses: a citation to a file that does not exist was " +
  "planted in `HANDOFF.md`, confirmed to reach disk, and left that guard GREEN. The same scan " +
  "found a real one \u2014 `HANDOFF.md` cited `../roles.md`, one directory too high, in the " +
  "paragraph sending a reader to the split rationale. `check-front-door` resolves " +
  "`START-HERE.md`'s pointers; the other three indexes had nothing until this file.");
process.exit(0);
