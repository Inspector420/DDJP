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
//   WHICH      (`ddjp_705`) maintained means what `check-break-verdict` holds a current file to — it judges its rows
//              through `_verdict.js`'s `redAsNamed` — never a job number in its name: J29's step 1 added a file numbered
//              below J67, which the number read as historical, run only when edited.
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

// ── WHICH: maintained by what a file does ──────────────────────────────────────────────────────────────────────────
{
  const asks = (src) => /require\(path\.join\(__dirname, "_verdict\.js"\)\)/.test(src) && /redAsNamed\(/.test(src);
  const all = fs.readdirSync(PROBES).filter((f) => /^mutate-.*\.js$/.test(f));
  const judged = all.filter((f) => asks(fs.readFileSync(path.join(PROBES, f), "utf8")));
  const { historical } = B.breakFiles();
  ok(judged.length > 0 && judged.length < all.length, "WHICH APPLIED — the tree holds break files of both kinds", { judged: judged.length, all: all.length });
  const lost = judged.filter((f) => maintained.indexOf(f) < 0);
  const extra = maintained.filter((f) => judged.indexOf(f) < 0);
  ok(lost.length === 0 && extra.length === 0 && historical.every((f) => judged.indexOf(f) < 0) &&
    maintained.length + historical.length === all.length,
    "WHICH — A BREAK FILE THAT JUDGES THROUGH `_verdict.js` IS MAINTAINED, and only such a file: a maintained file read as " +
    "historical runs only when it is itself edited, so the module it breaks can change with nothing run", { lost, extra });
}

if (failed) { console.log("[breaks-for] " + failed + " FAILED"); process.exit(1); }
console.log("[breaks-for] PASS — the break-file selector picks " + (known ? known.file + " for a change to " + known.module +
  ", which it quotes," : "a file for a change it quotes") + " and nothing for a change nothing names, and calls a break file maintained by what it does (it judges through " +
  "`_verdict.js`), never by its number. It reads the tree " +
  "each time (rows, `SUBJECT:` lines, the shared helpers) and keeps no list; it over-selects when unsure, which this " +
  "guard does not police, because the milestone close runs every break file.");
