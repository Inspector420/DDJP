// tools/homes-for.js — DO THIS ENTRY'S RULES LIVE ANYWHERE ELSE? Run it on a finished job's entry before deleting it.
//
// usage:  node tools/homes-for.js J78            (its bold claim sentences)
//         node tools/homes-for.js --all J78      (every sentence of eight words or more)
//
// A finished job's entry is drained, then deleted (`HANDOVER.md` §5 rule 6): its lasting rules go to their homes first.
// This lists each rule of the entry that has no home yet, so the drain is a list that finishes. It was the guard
// `check-rule-homes` until `ddjp_617` (the owner's decision). As a guard it judged only finished entries kept in the
// tree, and the suite refuses those (`check-history-budget`); once an entry is deleted there is nothing left to read. The
// check is useful at one moment, before the deletion, so it is a tool run then, like `docs-for` and `breaks-for`.
// `tests/check-homes-for.js` keeps its matcher and its extractor honest.
//
// ── WHY CLAIMS, NOT IDENTIFIERS ─────────────────────────────────────────────────────────────────────────────────────
// Twenty-four closed entries were once compressed on a probe that asked whether each backticked identifier resolved
// elsewhere. All scored 100%, because an entry names files and functions that still exist. The RULE an entry set is
// prose, and prose does not resolve: a second pass found 57 bold claims across 19 of them that existed nowhere else,
// standing rules among them, and the suite was green through all of it. So this reads claims.
//
// ── READ ITS OUTPUT AS SENTENCES TO READ, NEVER AS A COUNT OF RULES TO MOVE ─────────────────────────────────────────
// A claim resolves by a five-word run. Five, because shorter runs match common phrasing and longer ones miss a rule that
// was reworded on the way to its home: the question is whether a reader meets the rule. So a rule homed in other words
// is listed as missing (across twenty entries about 105 were listed and 9 needed a home). And a rule the tree now
// contradicts has no home: drop it and say so. This cannot tell you a rule found the RIGHT home, only that its words are
// somewhere a reader will meet them.
//
// ── WHAT IS NOT A HOME ──────────────────────────────────────────────────────────────────────────────────────────────
// The entry itself, this file, and a break file (`tools/probes/mutate-*.js`): a break file copies text in order to plant
// it, and this file's own examples once let four rules "resolve" through their quotation here. Everything else is: the
// docs, the rest of the roadmap, and the comments under core/, features/, ui/, backends/, tests/ and tools/, since this
// project puts its reasoning in module headers.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENTRY_RE = /^(?:#### (J\d+)\b|\*\*(J\d+) — )/gm;

// One entry's text, by the census's extent (`journal/entry-list.js`): from its first line to the next entry or §7.
function entryText(roadmap, id) {
  const end = roadmap.indexOf("\n## 7. Decisions already made");
  const at = [];
  let m;
  ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(roadmap)) !== null) if (end < 0 || m.index < end) at.push({ id: m[1] || m[2], i: m.index });
  const k = at.findIndex((e) => e.id === id);
  if (k < 0) return null;
  return { start: at[k].i, text: roadmap.slice(at[k].i, k + 1 < at.length ? at[k + 1].i : (end < 0 ? roadmap.length : end)) };
}

// PAIR THE DELIMITERS; DO NOT LENGTH-SCAN FOR THEM. The extractor was once `/\*\*([^*]{30,140})\*\*/g`, which pairs
// nothing: a bold span shorter than 30 characters failed the match, the scan resumed at its CLOSING `**` as an opener, and
// the bold sentence after it was consumed as a delimiter and never examined. Every field label in the roadmap is under
// thirty characters, and `**Rehomed.**` is eight, so marking an entry moved what could be seen in the rest of it. Split on
// the delimiter, take the odd segments, filter by length afterwards.
function claimsIn(body) {
  const out = [];
  const parts = body.split("**");
  for (let i = 1; i < parts.length; i += 2) {
    const c = parts[i].replace(/`/g, "").trim();
    if (c.length < 30 || c.length > 140) continue;
    if (/\b(DONE|done)\s*\(v\d+/.test(c) || c.split(/\s+/).length < 6) continue;
    out.push(c);
  }
  return out;
}
function sentencesIn(body) {
  const out = [];
  for (const line of body.split("\n")) for (const s of line.split(/(?<=[.;:])\s+(?=[A-Z(*`])/)) if (s.split(/\s+/).length >= 8) out.push(s.trim());
  return out;
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// A matcher over a corpus: does any five-word run of the claim appear in it? A claim under six words resolves.
function matcher(corpus) {
  const hay = norm(corpus);
  return function resolves(claim) {
    const w = norm(claim).split(" ");
    if (w.length < 6) return true;
    for (let i = 0; i + 5 <= w.length; i++) if (hay.includes(w.slice(i, i + 5).join(" "))) return true;
    return false;
  };
}

// Everywhere else a rule could live, for one entry of the roadmap.
function corpusFor(docsRoot, roadmapRel, entry) {
  let text = "";
  const self = __filename;
  const walk = (d, test) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === "node_modules") continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p, test);
      else if (test(p, f.name)) text += fs.readFileSync(p, "utf8") + "\n";
    }
  };
  walk(docsRoot, (p, n) => n.endsWith(".md") && path.relative(docsRoot, p) !== roadmapRel);
  const rm = fs.readFileSync(path.join(docsRoot, roadmapRel), "utf8");
  text += rm.slice(0, entry.start) + "\n" + rm.slice(entry.start + entry.text.length) + "\n";
  for (const d of ["core", "features", "ui", "backends", "tests", "tools"]) {
    walk(path.join(ROOT, d), (p, n) => n.endsWith(".js") && p !== self && !/^mutate-/.test(n));
  }
  return text;
}

function docsRoot() {
  return require(path.join(ROOT, "tests", "_docs.js")).docRoots().find((d) => fs.existsSync(path.join(d, "main", "09-roadmap.md")));
}

module.exports = { entryText, claimsIn, sentencesIn, norm, matcher, corpusFor, docsRoot };

if (require.main === module) {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const ids = args.filter((a) => /^J\d+$/.test(a));
  if (!ids.length) { console.log("usage: node tools/homes-for.js [--all] Jnn [Jnn ...]"); process.exit(2); }
  const DOCS = docsRoot();
  if (!DOCS) { console.log("no doc tree with main/09-roadmap.md beside this one"); process.exit(2); }
  const ROADMAP_REL = path.join("main", "09-roadmap.md");
  const roadmap = fs.readFileSync(path.join(DOCS, ROADMAP_REL), "utf8");
  let homeless = 0;
  for (const id of ids) {
    const e = entryText(roadmap, id);
    if (!e) { console.log(id + ": no such entry in the roadmap"); process.exitCode = 2; continue; }
    const resolves = matcher(corpusFor(DOCS, ROADMAP_REL, e));
    const items = all ? sentencesIn(e.text) : claimsIn(e.text);
    const missing = items.filter((c) => !resolves(c));
    homeless += missing.length;
    console.log(id + ": " + items.length + (all ? " sentences" : " claims") + ", " + (items.length - missing.length) +
      " with a five-word run elsewhere; " + (missing.length ? missing.length + " with none — read each, and give it a home, or drop it and say why:" : "every one has a home."));
    for (const c of missing) console.log("    " + c.replace(/\s+/g, " ").slice(0, 200));
  }
  if (homeless && !process.exitCode) process.exitCode = 1;
}
