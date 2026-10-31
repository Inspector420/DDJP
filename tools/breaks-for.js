// tools/breaks-for.js — WHICH BREAK FILES A PACKAGE MUST RUN, and why each one.
//
//   node tools/breaks-for.js --against ../../pristine_605   a folder holding the previous package's ddjp_N/ and docs_N/
//   node tools/breaks-for.js features/room.js docs/HANDOFF.md   changed paths as given (docs as `docs/<path>`)
//   node tools/breaks-for.js --all                          a milestone close: every maintained break file
//
// DELIBERATELY DUMB. Plain text matching over the tree as it is, every time: no state, no list of its own, nothing
// transitive. When it cannot tell, it SELECTS — a file run that did not need to be costs minutes, a file skipped that
// did costs a defect, and the milestone close runs everything anyway. It refuses when it cannot read a break file or the --against folder.
//
// A MAINTAINED break file (`tools/probes/mutate-jNN-*.js`, NN of 67 or more) runs when:
//   1. it is new or changed itself, its text mentions a changed file's path, or it names a changed guard;
//   2. a guard it names has a `// SUBJECT:` declaration naming a changed file, or a folder holding one;
//   3. a shared helper changed — `tests/_*.js`, `tools/probes/_*.js`, `tests/run-all.js` — and then they all run;
//   4. a guard it names declares no subject, or a subject that is not all paths: then it runs every time.
// A HISTORICAL break file (every other `tools/probes/mutate-*.js`) runs only if this package changed it, and then only
// the rows whose text changed (against the previous package; without one, every row is listed).
//
// "Names a guard" is any `check-…` token in the file's text that is a file in `tests/`, comments included — more than
// the rows strictly run, which is the safe direction. A SUBJECT declaration is read by `tests/_subjects.js` (the one
// reader) plus the lines that continue it: a first line ending in a comma goes on to the next comment line.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PROBES = path.join(ROOT, "tools", "probes");
const TESTS = path.join(ROOT, "tests");
const HELPER = (p) => /^tests\/_[^/]*\.js$/.test(p) || /^tools\/probes\/_[^/]*\.js$/.test(p) || p === "tests/run-all.js";

function breakFiles() {
  const all = fs.readdirSync(PROBES).filter((f) => /^mutate-.*\.js$/.test(f)).sort();
  const num = (f) => { const m = f.match(/^mutate-j(\d+)-/); return m ? Number(m[1]) : -1; };
  return { maintained: all.filter((f) => num(f) >= 67), historical: all.filter((f) => num(f) < 67) };
}

// A guard's whole SUBJECT declaration as text, or null when it declares none.
function subjectOf(guard) {
  const { readSubject } = require(path.join(TESTS, "_subjects.js"));
  const s = readSubject(guard + ".js");
  if (!s.declared) return null;
  let text = s.raw.trim();
  const lines = fs.readFileSync(path.join(TESTS, guard + ".js"), "utf8").split("\n");
  let i = lines.findIndex((l) => /^\s*\/\/\s*SUBJECT:/.test(l));
  while (/,$/.test(text) && i + 1 < lines.length && /^\s*\/\/\s*\S/.test(lines[i + 1])) {
    i++; text += " " + lines[i].replace(/^\s*\/\/\s*/, "").trim();
  }
  return text;
}

// One SUBJECT entry against one changed path: the file itself, or a folder holding it.
function covers(entry, p) {
  if (entry === p) return true;
  const dir = entry.endsWith("/") ? entry : entry + "/";
  return p.startsWith(dir) && !/\.[a-z]+$/.test(entry);
}

// Normalise a path as given: `./x`, `ddjp_N/x` and `docs_N/x` (or `../docs_N/x`) to the tree's own spelling.
function norm(p) {
  p = p.replace(/\\/g, "/").replace(/^\.\//, "");
  p = p.replace(/^(\.\.\/)?docs_\d+\//, "docs/").replace(/^ddjp_\d+\//, "");
  return p;
}

// Every file that differs between two folders, by bytes; `prefix` spells the result as the tree does.
function differ(a, b, prefix, out) {
  const walk = (d, rel, acc) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { return acc; }
    for (const n of names) {
      if (n === "node_modules" || n === ".git") continue;
      const full = path.join(d, n), r = rel ? rel + "/" + n : n;
      if (fs.statSync(full).isDirectory()) walk(full, r, acc); else acc.add(r);
    }
    return acc;
  };
  const files = walk(b, "", walk(a, "", new Set()));
  for (const r of [...files].sort()) {
    const fa = path.join(a, r), fb = path.join(b, r);
    const ea = fs.existsSync(fa), eb = fs.existsSync(fb);
    if (!ea || !eb || !fs.readFileSync(fa).equals(fs.readFileSync(fb))) out.push({ path: prefix + r, status: !ea ? "new" : !eb ? "deleted" : "changed", old: ea ? fa : null });
  }
  return out;
}

function changedAgainst(dir) {
  const sub = (re) => fs.readdirSync(dir).filter((d) => re.test(d)).map((d) => path.join(dir, d));
  const app = sub(/^ddjp_\d+$/), docs = sub(/^docs_\d+$/);
  if (app.length !== 1 || docs.length !== 1) throw new Error("--against needs a folder holding exactly one ddjp_N/ and one docs_N/: " + dir);
  const here = require(path.join(TESTS, "_docs.js")).docRoots()[0];
  const out = differ(app[0], ROOT, "", []);
  if (here) differ(docs[0], here, "docs/", out);
  return out;
}

// A historical file's rows by their keys (`id: "…"`, else `name: "…"`), each row's text being its own object: from the
// `{` that opens it to the `}` that closes it, quotes and `//` comments respected. Text between rows (comments, the runner) is no row's.
function rowsOf(text) {
  const byId = /\bid:\s*"([^"]+)"/.test(text);
  const re = byId ? /\bid:\s*"([^"]+)"/g : /\bname:\s*"([^"]+)"/g;
  const rows = new Map();
  let m, n = 0;
  while ((m = re.exec(text))) {
    const open = text.lastIndexOf("{", m.index);
    let d = 0, q = null, k = open;
    for (; k < text.length; k++) {
      const c = text[k];
      if (q) { if (c === "\\") k++; else if (c === q) q = null; continue; }
      if (c === "/" && text[k + 1] === "/") { k = text.indexOf("\n", k); if (k < 0) k = text.length; continue; }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") d++;
      else if (c === "}" && --d === 0) break;
    }
    n++;
    rows.set(m[1], { label: byId ? m[1] : "row " + n + " (" + (m[1].length > 40 ? m[1].slice(0, 40) + "…" : m[1]) + ")", text: text.slice(open, k + 1) });
  }
  return rows;
}

// THE SELECTION. `changed` is [{ path, status, old }]; returns { run, historical, quiet, refused }.
function select(changed, opts) {
  const { maintained, historical } = breakFiles();
  const paths = changed.map((c) => c.path);
  const guards = new Set(fs.readdirSync(TESTS).filter((f) => /^check-[a-z0-9-]+\.js$/.test(f)).map((f) => f.slice(0, -3)));
  const changedGuards = paths.filter((p) => /^tests\/check-[a-z0-9-]+\.js$/.test(p)).map((p) => p.slice(6, -3));
  const helpers = paths.filter(HELPER);
  const used = new Set();
  const run = [], refused = [];
  for (const f of maintained) {
    let text;
    try { text = fs.readFileSync(path.join(PROBES, f), "utf8"); } catch (e) { refused.push(f + ": " + e.message); continue; }
    const why = [];
    const list = (ps) => ps.slice(0, 3).join(", ") + (ps.length > 3 ? " and " + (ps.length - 3) + " more" : "");
    const self = changed.find((c) => c.path === "tools/probes/" + f);
    if (self) { why.push(self.status === "new" ? "it is new" : "it changed"); used.add(self.path); }
    if (opts && opts.all) why.push("a milestone close runs every maintained break file");
    if (helpers.length) { why.push("a shared helper changed: " + list(helpers)); helpers.forEach((h) => used.add(h)); }
    const named = [...new Set(text.match(/check-[a-z0-9-]+/g) || [])].filter((g) => guards.has(g) || changedGuards.indexOf(g) >= 0);
    const namedChanged = named.filter((g) => changedGuards.indexOf(g) >= 0);
    if (namedChanged.length) { why.push("it names " + namedChanged.join(", ") + ", which changed"); namedChanged.forEach((g) => used.add("tests/" + g + ".js")); }
    const mentioned = paths.filter((p) => p !== "tools/probes/" + f && namedChanged.indexOf(p.replace(/^tests\/(.*)\.js$/, "$1")) < 0 && text.includes(p));
    if (mentioned.length) { why.push("it mentions " + list(mentioned)); mentioned.forEach((p) => used.add(p)); }
    for (const g of named) {
      if (!guards.has(g)) continue;   // deleted in this package: named above as changed, no subject left to read
      const subj = subjectOf(g);
      if (subj === null) { why.push("it names " + g + ", which declares no subject: runs every time"); continue; }
      const entries = subj.split(/[,\s]+/).filter(Boolean);
      if (entries.some((e) => !/[./]/.test(e))) { why.push("it names " + g + ", whose subject is not all paths: runs every time"); continue; }
      const hit = paths.filter((p) => entries.some((e) => covers(e, p)));
      if (hit.length) { why.push("it names " + g + ", whose subject covers " + list(hit)); hit.forEach((p) => used.add(p)); }
    }
    if (why.length) run.push({ file: f, why: [...new Set(why)] });
  }
  const hist = [];
  for (const f of historical) {
    const c = changed.find((x) => x.path === "tools/probes/" + f);
    if (!c) continue;
    used.add(c.path);
    if (c.status === "deleted") { hist.push({ file: f, rows: [], note: "deleted" }); continue; }
    let now;
    try { now = fs.readFileSync(path.join(PROBES, f), "utf8"); } catch (e) { refused.push(f + ": " + e.message); continue; }
    if (!c.old) { hist.push({ file: f, rows: null, note: c.status === "new" ? "new: every row" : "no previous version given: every row" }); continue; }
    const before = rowsOf(fs.readFileSync(c.old, "utf8")), after = rowsOf(now);
    const rows = [...after].filter(([k, r]) => !before.has(k) || before.get(k).text !== r.text).map(([, r]) => r.label);
    hist.push({ file: f, rows, note: rows.length ? "the rows whose text changed" : "edited outside its rows: no row to run" });
  }
  const quiet = paths.filter((p) => !used.has(p));
  return { run, historical: hist, quiet, refused, notRun: maintained.length - run.length };
}

module.exports = { select, breakFiles, subjectOf, changedAgainst, norm };

if (require.main === module) {
  const args = process.argv.slice(2);
  let changed, source;
  try {
    if (args[0] === "--against" && args[1]) { changed = changedAgainst(path.resolve(args[1])); source = "against " + args[1]; }
    else if (args[0] === "--all") { changed = []; source = "a milestone close"; }
    else if (args.length && !args[0].startsWith("--")) { changed = args.map((p) => ({ path: norm(p), status: "changed", old: null })); source = "as given"; }
    else { console.log("usage: node tools/breaks-for.js --against <dir> | <changed paths…> | --all"); process.exit(2); }
  } catch (e) { console.log("REFUSED — " + e.message); process.exit(2); }
  const r = select(changed, { all: args[0] === "--all" });
  if (r.refused.length) { console.log("REFUSED — cannot read a break file, so the list would be partial:\n  " + r.refused.join("\n  ")); process.exit(2); }
  console.log("BREAK FILES FOR " + changed.length + " CHANGED FILE(S), " + source + ":\n");
  for (const x of r.run) console.log("RUN  " + x.file.replace(/\.js$/, "") + "\n       " + x.why.join("\n       "));
  for (const h of r.historical) console.log("RUN  " + h.file.replace(/\.js$/, "") + " (historical) — " + h.note + (h.rows && h.rows.length ? ": " + h.rows.join(", ") : ""));
  console.log("\nNOT RUN: " + (r.notRun ? r.notRun + " maintained break file(s). None mentions a changed path or names a " +
    "changed guard, no guard they name has a subject covering a changed file, and no shared helper changed." : "none."));
  if (r.quiet.length) console.log("Changed, selecting nothing: " + r.quiet.join(", "));
}
