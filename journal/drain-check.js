#!/usr/bin/env node
// journal/drain-check.js — ANCHOR SURVIVAL, not anchor existence.
//
// The entry-list diff is a rail for entry IDENTITY and is structurally blind to a cut inside a
// span (driven: `journal/mutate-v275-delete.js`). This is the other half — it asks, of every name
// a cut removes from the file, whether anything ELSE still cites it.
//
// THE FAILURE IT EXISTS FOR. `#### v275`'s only two occurrences in the roadmap were its heading
// and its `**Touches (v275).**` line. `Touches` is on the drain's drop list. So draining the
// Touches and dropping the heading would have made `v275` vanish from the file and turned
// `FAILURE-SIGNATURES.md:298` ("recorded in the v275 entry") into a stale citation — a citation
// broken not by either rule alone but by the two INTERACTING. Checking that an anchor exists
// before a cut does not catch that; checking that it SURVIVES the cut does.
//
//   node journal/drain-check.js <before.md> <after.md> [<tree-root> ...]
//
// Reports every token whose count falls to zero in <after.md>, and whether it is cited outside
// the file. A token that vanishes and is cited elsewhere is STRANDED and the cut is refused.
const fs = require("fs");
const path = require("path");

const [, , before, after, ...roots] = process.argv;
if (!before || !after) { console.error("usage: drain-check.js <before.md> <after.md> [roots...]"); process.exit(2); }
const B = fs.readFileSync(before, "utf8");
const A = fs.readFileSync(after, "utf8");

// Token classes worth protecting: names other files cite. Deliberately NOT file:line locators —
// this pass writes none, and the existing ones are being corrected to names.
// TWO CLASSES, AND ONLY ONE CAN BE STRANDED BY A DOC CUT.
//
// PROTECTED — names whose HOME is the doc/evidence layer. If one vanishes from the roadmap and
// something still cites it, that citation now points at nothing: this is the v275 shape.
const PROTECTED = [
  /\bv\d{3}\b/g,                       // release markers, e.g. v275 — HOME IS THIS FILE
  /\bJ\d{2}\b/g,                       // job ids — HOME IS THIS FILE
];
// INFORMATIONAL — backticked code identifiers. Their home is the TREE, so the roadmap losing a
// mention strands nothing; `joinRoom` does not stop existing because a narrative stopped naming
// it. Reported so the written defence can say whether a DECISION went with the mention, never
// used to refuse a cut — that judgement is prose, and no instrument here can make it.
// Guard, probe and mutation names are NOT protected: their home is the tree, so prose ceasing to
// name `check-origin-fold` does not stop it existing. They are reported because the keep-list says
// KEEP THE GUARD'S NAME, so one dropping out is a defence question — never a stranded citation.
const INFO = [
  /`([A-Za-z_][A-Za-z0-9_.]{2,})`/g,
  /\bcheck-[a-z0-9-]+/g,
  /\bprobe-[a-z0-9-]+/g,
  /\bmutate-[a-z0-9-]+/g,
];

function tokens(src, pats) {
  const out = new Map();
  for (const re of pats) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(src)) !== null) {
      const t = m[1] || m[0];
      out.set(t, (out.get(t) || 0) + 1);
    }
  }
  return out;
}

const tb = tokens(B, PROTECTED), ta = tokens(A, PROTECTED);
const vanished = [...tb.keys()].filter((t) => !ta.has(t));
const ib = tokens(B, INFO), ia = tokens(A, INFO);
const lostIdents = [...ib.keys()].filter((t) => !ia.has(t));

// Where else is it cited? Walk the given roots, skipping the file under edit and node_modules.
const files = [];
for (const r of roots) {
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|js|html)$/.test(e.name) && path.resolve(p) !== path.resolve(before)
               && path.resolve(p) !== path.resolve(after)) files.push(p);
    }
  })(r);
}
const corpus = files.map((f) => ({ f, s: fs.readFileSync(f, "utf8") }));

let stranded = 0, freed = 0;
console.log("[drain-check] " + vanished.length + " token(s) fall to zero in the drained file; "
  + corpus.length + " other files scanned for citations");
for (const t of vanished.sort()) {
  const cites = corpus.filter((c) => c.s.indexOf(t) >= 0).map((c) => c.f);
  if (cites.length) {
    stranded++;
    console.log("  STRANDED  " + t + "  — still cited by: " + cites.slice(0, 4).join(", ")
      + (cites.length > 4 ? " (+" + (cites.length - 4) + ")" : ""));
  } else {
    freed++;
    if (process.argv.indexOf("--verbose") >= 0) console.log("  freed     " + t);
  }
}
if (lostIdents.length) {
  console.log("[drain-check] INFO — " + lostIdents.length + " backticked identifier(s) no longer "
    + "mentioned; their home is the tree, so nothing is stranded. The written defence must say "
    + "whether a DECISION went with any of them:");
  console.log("      " + lostIdents.sort().join(", "));
}
console.log("[drain-check] " + (stranded ? "REFUSE" : "OK") + " — stranded: " + stranded
  + ", identifiers no longer mentioned: " + lostIdents.length);
process.exit(stranded ? 1 : 0);
