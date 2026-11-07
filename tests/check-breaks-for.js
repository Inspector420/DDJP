// tests/check-breaks-for.js
// SUBJECT: tools/breaks-for.js
// WALL: the break-file selector picks a file for a change that file quotes, and nothing for a change nothing names.
//
// SMALL ON PURPOSE (J109). The selector over-selects by design and the milestone close runs every break file, so the one
// failure worth a guard is the quiet one: a selector that stops picking what it should, or starts picking everything.
// Both directions, on the tree as it is — no fixture tree, and no break file pinned by name:
//   KNOWN      the first maintained break file whose text quotes an app module that exists; told that module changed,
//              the selector must run that file, and say it was because the file mentions it.
//   UNRELATED  a path no break file mentions, in a folder no guard's subject names; it must select nothing.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PROBES = path.join(ROOT, "tools", "probes");
const B = require(path.join(ROOT, "tools", "breaks-for.js"));

let failed = 0;
function ok(c, msg, got) {
  if (c) return;
  failed++;
  console.log("[breaks-for] FAIL — " + msg + (got === undefined ? "" : "\n      got " + JSON.stringify(got).slice(0, 600)));
}
const changed = (p) => [{ path: p, status: "changed", old: null }];

// ── KNOWN: one change, one file, read from the tree ─────────────────────────────────────────────────────────────────
const maintained = B.breakFiles().maintained;
let known = null;
for (const f of maintained) {
  const m = fs.readFileSync(path.join(PROBES, f), "utf8").match(/"((?:features|backends|core|ui)\/[\w/.-]+\.js)"/);
  if (m && fs.existsSync(path.join(ROOT, m[1]))) { known = { file: f, module: m[1] }; break; }
}
ok(known !== null, "APPLIED — some maintained break file quotes an app module that exists, or there is nothing to test " +
  "the selector against", maintained.length);
if (known) {
  const r = B.select(changed(known.module));
  const pick = r.run.find((x) => x.file === known.file);
  ok(pick && pick.why.some((w) => w.indexOf("it mentions") === 0 && w.indexOf(known.module) >= 0),
    "a change to " + known.module + " selects " + known.file + ", which quotes it, and says that is why — a selector " +
    "that misses this runs too little between milestones and nothing reports it", pick || r.run.map((x) => x.file));
}

// ── UNRELATED: one change nothing names selects nothing ─────────────────────────────────────────────────────────────
const NOBODY = "journal/no-break-file-names-this.txt";
const quoting = maintained.filter((f) => fs.readFileSync(path.join(PROBES, f), "utf8").indexOf("no-break-file-names-this") >= 0);
ok(quoting.length === 0, "APPLIED — no maintained break file mentions the unrelated path, or it is not unrelated", quoting);
{
  const r = B.select(changed(NOBODY));
  ok(r.run.length === 0 && r.historical.length === 0,
    "a change nothing names selects nothing — a selector that picks every file for any change has stopped selecting, and " +
    "reads as careful", r.run.map((x) => x.file + ": " + x.why.join("; ")));
}

if (failed) { console.log("[breaks-for] " + failed + " FAILED"); process.exit(1); }
console.log("[breaks-for] PASS — the break-file selector picks " + (known ? known.file + " for a change to " + known.module +
  ", which it quotes," : "a file for a change it quotes") + " and nothing for a change nothing names. It reads the tree " +
  "each time (rows, `SUBJECT:` lines, the shared helpers) and keeps no list; it over-selects when unsure, which this " +
  "guard does not police, because the milestone close runs every break file.");
