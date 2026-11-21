// tools/docs-for.js — WHICH DOCUMENTATION DESCRIBES THE THING YOU JUST CHANGED.
//
// usage:  node tools/docs-for.js features/room.js ui/queue.js
//         node tools/docs-for.js --new features/newthing.js      (is it worth documenting at all?)
//
// ── THE PROBLEM THIS SOLVES, WHICH IS NOT "REMEMBER TO UPDATE THE DOCS" ─────────────────────
// `tools/context-for.js` answers *which files does this job touch*. This answers the reverse, and
// the reverse is the one nobody can do from memory: *which paragraphs, in which files, describe
// what I just changed*.
//
// It matters because **a description of a thing is not in the diff that changed it**. Delete a
// function and the diff shows the deletion; it does not show the four paragraphs in three
// documents that still explain how it works. Those paragraphs do not become wrong loudly. They sit
// there being confidently, readably false, and the suite stays green because prose is not
// executable. Every stale claim found in this tree arrived this way: `ui/interface.js` described
// as the place two players are constructed after it ceased to exist; a bot module whose header
// said a room type did not exist for eleven versions after it shipped; a jobs index titled with a
// package forty-four behind.
//
// The rule this serves is already written in `START-HERE.md`: *descriptive prose and the indexes
// are audited at the version bump, against the change list, not from memory.* That rule had no
// instrument. Without one, "audit the prose" means re-reading the doc tree, which nobody does, so
// the rule quietly became optional.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────
// It does not decide whether a paragraph is WRONG — nothing here can read a sentence and check it
// against the tree. It bounds the search: instead of *the documentation*, you get a short list of
// sections to look at, which is a job that finishes.
//
// It also does not tell you to write anything new. See `--new` below: most changes should produce
// NO new documentation, and the default answer to *should I document this* is no.
//
// ── A FILE IS ALSO NAMED BY ITS GLOBAL (J107) ───────────────────────────────────────────────
// Most prose names a module by the global it declares — `EventCache`, `Floor.proves` — not by its
// file, and this matched files only, so those sections never came up. The globals are read from the
// file itself (any capitalised top-level `const`/`let`/`var` in an app file — tests/, tools/ and journal/ are not read), and an engine's `B1`/`B2` name also brings the seam's name it is bound to (`B1StreamManager` → `StreamManager`,
// a shell in `core/backends.js`). A name with a capital inside it (`EventCache`) is matched as a word; a plain
// word (`Floor`, `Room`) only as code — in backticks, or as `Floor.member` — so "the floor moved" is
// not a hit. The matcher is checked on every run against lines it must and must not match, and a
// failed check stops the run: an instrument that cannot find what it is for says so rather than
// reporting a short list. `tests/check-docs-for.js` drives it on a doc tree of its own and the real one.
//
//   node tools/docs-for.js --docs <dir> <file>      (read that doc tree instead; for the guard)

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// The doc tree, by the same rule every guard uses — never a literal `docs_NNN`.
function docRoots() {
  const out = [];
  const add = (p) => { if (p && out.indexOf(p) < 0 && fs.existsSync(p)) out.push(p); };
  add(path.join(ROOT, "docs"));
  add(path.join(ROOT, "..", "docs"));
  try {
    for (const d of fs.readdirSync(path.join(ROOT, "..")).sort()) {
      if (/^docs[_-]?\d*$/.test(d)) add(path.join(ROOT, "..", d));
    }
  } catch (e) { /* no parent to scan */ }
  return out;
}

function allDocs(root) {
  const out = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith(".md")) out.push(r);
    }
  })("");
  return out.sort();
}

// The section a line sits in: nearest heading at or above it.
function sectionOf(lines, i) {
  for (let k = i; k >= 0; k--) if (/^#{1,6} /.test(lines[k])) return { line: k + 1, head: lines[k] };
  return { line: 1, head: "(before any heading)" };
}

const args = process.argv.slice(2);
const asNew = args.includes("--new");
const docsAt = args.indexOf("--docs") >= 0 ? args[args.indexOf("--docs") + 1] : null;
const targets = args.filter((a, i) => !a.startsWith("--") && !(docsAt && i === args.indexOf("--docs") + 1));

// ── THE GLOBALS A FILE DECLARES, AND HOW A LINE NAMES ONE ───────────────────────────────────
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function seamNames() {
  try { return [...fs.readFileSync(path.join(ROOT, "core", "backends.js"), "utf8").matchAll(/^const ([A-Z]\w*)\s*=\s*\{\};/gm)].map((m) => m[1]); }
  catch (e) { return []; }
}
function globalsOf(abs) {
  // ONLY THE APP DECLARES A MODULE'S GLOBAL (J107, at the milestone close). A guard's or tool's top-level name is an alias of
  // a module it loads (`check-who-is-here`: `const Room = C0.Room;`), so prose naming it is about that module: matching it
  // listed some eighty sections about `features/room.js` as describing one guard.
  if (/^(tests|tools|journal)\//.test(path.relative(ROOT, abs).split(path.sep).join("/"))) return [];
  let src = "";
  try { src = fs.readFileSync(abs, "utf8"); } catch (e) { return []; }
  const out = [];
  // Any capitalised top-level name: `UIBase` and `IDB` are globals. (Until the directory rule above, J107, the guards' `F` and `C`
  // were read here too, and a word rule kept them out — and `UIBase` and `IDB` with them.)
  for (const m of src.matchAll(/^(?:const|let|var) ([A-Z][A-Za-z0-9_$]*)\s*=/gm)) {
    if (!out.some((g) => g.name === m[1])) out.push({ name: m[1], via: null });
    const bare = /^B[12]([A-Z]\w*)$/.exec(m[1]);
    if (bare && seamNames().indexOf(bare[1]) >= 0 && !out.some((g) => g.name === bare[1])) out.push({ name: bare[1], via: "the seam" });
  }
  return out;
}
// A capital inside the name makes it a word nobody writes by accident; a plain word is matched only as code.
function namesGlobal(line, name) {
  if (/[a-z][A-Z]/.test(name)) return new RegExp("(?<![\\w$])" + esc(name) + "(?![\\w$])").test(line);
  return new RegExp("`" + esc(name) + "[`.(]|(?<![\\w$.])" + esc(name) + "\\.[A-Za-z_$]").test(line);
}
// THE CONTROL, ON EVERY RUN: lines the matcher must find, and lines it must not.
{
  const must = [["`EventCache.retireBanked` drops banked raws", "EventCache"], ["the cache (EventCache) keeps them", "EventCache"],
    ["`Floor.proves` rebuilds the seed", "Floor"], ["a floor read as `Floor`", "Floor"], ["Floor.current() is null", "Floor"]];
  const mustNot = [["the floor moved", "Floor"], ["Floor plans are unrelated", "Floor"], ["EventCaches plural is not it", "EventCache"],
    ["myEventCache.x is another name", "EventCache"]];
  const bad = must.filter(([l, n]) => !namesGlobal(l, n)).map(([l]) => "missed: " + l)
    .concat(mustNot.filter(([l, n]) => namesGlobal(l, n)).map(([l]) => "false hit: " + l));
  if (bad.length) { console.error("docs-for: INSTRUMENT FAILED — the global matcher's control: " + bad.join("; ")); process.exit(1); }
}

if (!targets.length) {
  console.log("usage: node tools/docs-for.js <file> [more files...]");
  console.log("       node tools/docs-for.js --new <file>     (should this be documented at all?)");
  console.log("");
  console.log("Answers WHICH DOC SECTIONS DESCRIBE a file you changed — the reverse of");
  console.log("`context-for.js`, and the half nobody can do from memory. A description of a thing");
  console.log("is not in the diff that changed it.");
  process.exit(2);
}

const roots = docsAt ? [path.resolve(docsAt)] : docRoots();
if (!roots.length) {
  console.error("docs-for: no doc tree found as a sibling or inside the tree.");
  process.exit(1);
}
const DOCS = roots[0];
const docs = allDocs(DOCS);

// The ways this tree names a source file in prose: the full path, the bare basename, and (since J107) a global the file
// declares — `EventCache`, `Floor.proves` — which is how most paragraphs actually refer to a module. The basename ALONE is
// ambiguous — `chat.js` exists in two directories — so hits are reported with which form matched, and the reader judges.
for (const rel of targets) {
  const abs = path.join(ROOT, rel);
  const exists = fs.existsSync(abs);
  const base = path.basename(rel);
  const stem = base.replace(/\.js$/, "");
  const globals = globalsOf(abs);

  const hits = [];
  for (const d of docs) {
    const text = fs.readFileSync(path.join(DOCS, d), "utf8");
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      const full = l.includes(rel);
      const bare = !full && new RegExp("\\b" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.js\\b").test(l);
      const g = (full || bare) ? null : globals.find((x) => namesGlobal(l, x.name));
      if (!full && !bare && !g) return;
      const s = sectionOf(lines, i);
      hits.push({ doc: d, line: i + 1, how: full ? "path" : bare ? "name only" : "global " + g.name + (g.via ? ", via " + g.via : ""), sec: s });
    });
  }

  // Collapse to one row per section — a section naming a file nine times is still one place to read.
  const bySec = new Map();
  for (const h of hits) {
    const k = h.doc + "#" + h.sec.line;
    if (!bySec.has(k)) bySec.set(k, { doc: h.doc, sec: h.sec, n: 0, how: h.how });
    const v = bySec.get(k);
    v.n++;
    if (h.how === "path" || (h.how === "name only" && v.how !== "path")) v.how = h.how;
  }
  const secs = [...bySec.values()].sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : a.sec.line - b.sec.line));

  console.log("");
  console.log("═".repeat(78));
  console.log(rel + (exists ? "" : "   [NOT IN THE TREE — deleted, renamed, or mistyped]"));
  console.log("═".repeat(78));

  if (!exists) {
    console.log("");
    console.log("  THIS FILE DOES NOT EXIST, and the sections below still describe it. That is the");
    console.log("  exact shape of every stale claim found in this tree: the deletion was in the diff,");
    console.log("  the paragraphs describing it were not, and nothing turned red.");
  }

  if (!secs.length) {
    console.log("");
    if (asNew) {
      console.log("  NOTHING IN THE DOC TREE NAMES IT, and that is the ORDINARY answer for new code.");
      console.log("");
      console.log("  Documentation here is earned, not owed. Write something only if ONE of these is");
      console.log("  true — and if none is, writing nothing is the correct output:");
      console.log("");
      console.log("    * A reasonable change to it would look fine and be WRONG, and no guard");
      console.log("      catches that. Then write the smallest note that prevents it, and say");
      console.log("      plainly that nothing goes red. If a guard DOES catch it, the guard is the");
      console.log("      warning — prose repeating it is a second copy that drifts.");
      console.log("    * It changes a RULE somebody else has to follow, or a boundary somebody else");
      console.log("      calls. Then it belongs in the file that owns that rule, not in a new one.");
      console.log("    * Its NAME misleads, or it is easily confused with something adjacent.");
      console.log("      `roles.md` owns both of those lists.");
      console.log("");
      console.log("  NOT reasons: it was hard to write; it took a long time; you are proud of it;");
      console.log("  it is new. A module that does what its name says, behind a boundary somebody");
      console.log("  else already documented, needs NO entry anywhere.");
      console.log("");
      console.log("  Match the size of the thing. The shortest entries in `roles.md` §9 are ONE");
      console.log("  SENTENCE, and they are not the weak ones.");
    } else {
      console.log("  Nothing in the doc tree names this file.");
      console.log("");
      console.log("  If you CHANGED it, there is nothing to correct and nothing to do here.");
      console.log("  If you DELETED it, nothing is stranded — that is the clean case.");
      console.log("  If you find that surprising for a file this important, that is worth a look:");
      console.log("  it may be described by the name of something it sits behind rather than its own.");
    }
    continue;
  }

  console.log("");
  console.log("  " + secs.length + " SECTION(S) DESCRIBE IT. Read each and ask only: is this still true?");
  console.log("  Correct it WHERE IT LIVES. Do not add a correction elsewhere — a second paragraph");
  console.log("  about one thing is how this tree got two answers to the same question.");
  console.log("");
  for (const s of secs) {
    const h = s.sec.head.replace(/^#{1,6} /, "").slice(0, 58);
    console.log("    " + (s.doc + ":" + s.sec.line).padEnd(34) + " [" + s.how + (s.n > 1 ? " x" + s.n : "") + "]");
    console.log("        " + h);
  }
  console.log("");
  console.log("  Hits marked [name only] matched the BARE FILENAME, not the path. Two files in this");
  console.log("  tree can share a basename, so check the paragraph is about yours before editing it.");
  if (globals.length) {
    console.log("  Hits marked [global …] name what the file DECLARES, or the seam it is bound to (" + globals.map((x) => x.name).join(", ") + "), and not the file.");
    console.log("  One marked \"via the seam\" names the shell an engine is bound to, so it may be about the other engine.");
  }
}

console.log("");
console.log("─".repeat(78));
console.log("A DATED RECORD IS NOT WRONG AND MUST NOT BE 'CORRECTED'. A record describes the tree");
console.log("AS IT WAS. Editing one to match today destroys the record and falsifies a measurement");
console.log("nobody re-ran. Correct LIVE claims; remove a record that no longer earns its place,");
console.log("after moving what is still needed to its home (START-HERE.md §History is temporary).");
console.log("");
console.log("Then: node tests/run-all.js   —   nothing above is checkable by the suite, which is");
console.log("exactly why it needs a person and a bounded list rather than a rule and a memory.");
