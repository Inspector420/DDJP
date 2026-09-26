#!/usr/bin/env node
// tests/check-derived-counts.js — DOES A NUMBER IN A LIVE INDEX STILL MATCH THE TREE?
// SUBJECT: docs/, docs/README.md, docs/HANDOFF.md, docs/INVENTORY.md, docs/START-HERE.md
//
// J40's Open, settled: **yes to a guard, but not a prose judge.**
//
// The rule this enforces is ALREADY WRITTEN, twice, and well: `START-HERE.md` §3 says derive every
// number you lean on, and `README.md` §Conventions says counts of the tree do not go in prose and
// that the list is the count. Nothing was missing from the wording. What was missing is anything
// that NOTICES — `4,308` was written into four sites and survived a whole package, in the very
// report that filed signatures about that exact shape. Adding more prose is the one remedy already
// known not to work here.
//
// WHY THIS IS NOT THE GUARD J40 ARGUED AGAINST. That objection is correct and is dodged rather than
// answered: a textual guard would have to tell a LIVE claim from a DATED one, which is the same
// judgement the sweep is, so it would be trivially weak or wrong about `README.md`. **So this guard
// never makes that judgement.** It does two things instead, both mechanical:
//
//   1. It reads only LIVE INDEX docs and never `main/09-roadmap.md`. Journal docs are dated by
//      construction (`roles.md`) and KEEP their mentions — excluding them is the existing kind rule
//      applied, not an exemption invented to make a guard pass. That single line removes the entire
//      judgement problem.
//   2. It checks only claims whose value the tree RECOMPUTES, against an explicit table. A pattern
//      that matches nothing is not a failure: the claim simply is not written today.
//
// THE COUNTS COME FROM ONE PARSER, NOT A SECOND COPY. The open-entry figure is taken by SPAWNING
// `journal/entry-list.js` rather than re-implementing its regex here. A second reader of one source
// is the fifty-third signature, and this tree has already paid for it once — `context-for.js` and
// `entry-list.js` disagreed about every entry's status for an unknown number of packages.
//
// WHAT IT DELIBERATELY DOES NOT COVER. Prose counts in general, code comments, and `?v=` mentions
// in live docs — the last because historical versions are cited constantly and legitimately, and
// telling those apart is the judgement this guard exists to avoid. The sweep in J40 is still the
// sweep; this only stops the recurring, derivable ones from rotting unnoticed.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const DOCTREE = require("./_docs");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
const fail = (m, d) => { console.log("[derived-counts] FAIL — " + m + (d ? "\n      " + d : "")); failed++; };

// ── DERIVE, from the tree, once ───────────────────────────────────────────────────────────────
// A "module" is a .js file directly in the layer directory — defined here so the guard is not a
// second reader guessing at the word. Subdirectories are not layers.
const layer = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => /\.js$/.test(f)).length;

const guardCount = fs.readdirSync(path.join(ROOT, "tests"))
  .filter((f) => /^check-.*\.js$/.test(f)).length;

const roadmap = DOCTREE.docPaths("main/09-roadmap.md").find((p) => fs.existsSync(p));
if (!roadmap) fail("cannot resolve main/09-roadmap.md — " + DOCTREE.searchedFor("main/09-roadmap.md"));

let openEntries = null, totalEntries = null;
if (roadmap) {
  const out = execFileSync("node", [path.join(ROOT, "journal", "entry-list.js"), roadmap],
    { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  totalEntries = out.length;
  openEntries = out.filter((l) => l.split("\t")[3] === "open").length;
}

// ── THE TABLE. Each row is a claim the tree recomputes. Extend by adding a row. ────────────────
const CLAIMS = [
  { re: /all (\d+) open entries/gi,            derived: () => openEntries,   what: "open entries" },
  { re: /(\d+) open entries/gi,                derived: () => openEntries,   what: "open entries" },
  { re: /(\d+) of (\d+) guards declare/gi,     derived: () => guardCount,    what: "guard count",
    pick: (m) => m[2] },
  { re: /(\d+) guards? (?:declare|pass|are green)/gi, derived: () => guardCount, what: "guard count" },
  // LAYER MODULE COUNTS. Added at `ddjp_399` after an incoming session found three of four wrong in
  // README.md and `ui/ 2 modules` in roles.md against a real 11 — in the paragraph arguing module
  // counts are SAFE to write down because adding a module is a deliberate act. That argument is
  // still right and the number was still wrong; the two are separable, and a guard is what makes
  // the number safe rather than the reasoning. It had already rotted once (features 15 vs 18) and
  // the correction reached roles.md but not README.md, so this is also why README.md no longer
  // carries the counts at all: roles.md is the HOME and one fact does not get two copies.
  { re: /ui\/\s+(\d+) modules/gi,       derived: () => layer("ui"),       what: "ui/ modules" },
  { re: /features\/\s+(\d+) modules/gi, derived: () => layer("features"), what: "features/ modules" },
  { re: /core\/\s+(\d+) modules/gi,     derived: () => layer("core"),     what: "core/ modules" },
];

// LIVE INDEXES ONLY. `main/09-roadmap.md` is journal-kind and is not in this list by rule.
const LIVE = ["README.md", "HANDOFF.md", "INVENTORY.md", "START-HERE.md", "roles.md", "PILLARS.md"];

let filesRead = 0, claimsChecked = 0;
for (const rel of LIVE) {
  const p = DOCTREE.docPaths(rel).find((x) => fs.existsSync(x));
  if (!p) continue;
  filesRead++;
  const text = fs.readFileSync(p, "utf8");
  for (const c of CLAIMS) {
    const want = c.derived();
    if (want === null || want === undefined) continue;
    c.re.lastIndex = 0;
    let m;
    while ((m = c.re.exec(text)) !== null) {
      claimsChecked++;
      const got = Number(c.pick ? c.pick(m) : m[1]);
      if (got !== want) {
        fail(`${rel} says "${m[0].trim()}" but the tree derives ${want} ${c.what}. ` +
             `A number in prose is a DEAD COPY — delete it and name the command, or correct it here ` +
             `if it is genuinely load-bearing (README.md §Conventions).`);
      }
    }
  }
}

// ── THE APPLIED CONTROL. A green that read nothing is not a green. ────────────────────────────
if (filesRead === 0) fail("APPLIED — no live index doc was read, so every check above is vacuous", DOCTREE.searchedFor("README.md"));
if (guardCount < 50) fail("APPLIED — derived guard count is implausible (" + guardCount + "), so the derivation is broken rather than the docs");
if (roadmap && (totalEntries === null || totalEntries < 10)) fail("APPLIED — entry-list returned an implausible census (" + totalEntries + ")");

if (failed) process.exit(1);
console.log(`[derived-counts] PASS — every derivable count written into a LIVE index matches the ` +
  `tree (${filesRead} indexes read, ${claimsChecked} claim(s) found and checked; ${guardCount} guards, ` +
  `${openEntries} open of ${totalEntries}). This guard does NOT judge prose and is not the sweep J40 ` +
  `describes: it reads no journal doc, because those are dated by construction and keep their ` +
  `mentions, and it checks only claims the tree recomputes against an explicit table. A pattern ` +
  `matching nothing means the claim is not written today, which is the preferred state — the rule ` +
  `is still "delete the number and name the command", and this only catches the ones that come back. ` +
  `The open-entry figure is SPAWNED from journal/entry-list.js rather than re-parsed here, so there ` +
  `is one reader of the roadmap and not a second to drift from it.`);
