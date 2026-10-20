#!/usr/bin/env node
// journal/mutate-j50-dup-first.js — J50's mutation, and the DIRECTION is the point.
//
// Injects a SECOND `#### J17` heading BEFORE the real entry, which is what actually happened to
// J17, J38, J39 and J40. Injecting it AFTER exercises the branch dedup discards — the guard is
// then being asked about the entry that was already being thrown away, which is the state under
// test with the roles reversed, and it comes back clean. That inadmissible form is driven here too,
// as the control, so the direction is measured rather than asserted.
//
//   node journal/mutate-j50-dup-first.js <roadmap.md> first|second <out.md>
const fs = require("fs");
const [, , src, where, out] = process.argv;
const s = fs.readFileSync(src, "utf8");
const REAL = "#### J17 — Bot skeleton — **DONE.**";
const i = s.indexOf(REAL);
if (i < 0) { console.error("APPLIED-CHECK FAILED: real J17 heading not found"); process.exit(2); }
const DUP = "#### J17 — Bot skeleton — the schema (v262)\n\n**Kind.** `derivation`.\n\n---\n\n";
const mutated = (where === "first")
  ? s.slice(0, i) + DUP + s.slice(i)
  : (() => { const j = s.indexOf("\n#### J18", i); if (j < 0) throw new Error("no J18 anchor");
             return s.slice(0, j + 1) + DUP + s.slice(j + 1); })();
if (mutated === s) { console.error("APPLIED-CHECK FAILED: mutation changed nothing"); process.exit(2); }
const added = (mutated.match(/^#### J17\b/gm) || []).length;
if (added !== 2) { console.error("APPLIED-CHECK FAILED: expected 2 J17 headings, got " + added); process.exit(2); }
fs.writeFileSync(out, mutated);
console.log("APPLIED: duplicate J17 injected " + where.toUpperCase() + " — 2 headings present");
