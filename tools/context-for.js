// tools/context-for.js
//
// CONTEXT-FOR — what does a session need to read for ONE job, and nothing else?
//
// THE PROBLEM THIS EXISTS FOR. This tree DERIVES every fact and HAND-MAINTAINS its navigation.
// Guard counts are a command, the cascade list is scanned, the channel table is the count — and
// then a session is told to read seven documents (45,000 words, before it has seen its job or a
// line of code) and go looking. Retrieval is the one place the project's own rule was never
// applied. This is that rule, one level up.
//
//   node tools/context-for.js J34
//
// IT REFUSES RATHER THAN GUESSES, AND THAT IS THE WHOLE DESIGN. An entry that names no files
// gets a REFUSAL naming the stage, not an empty manifest. Measured before this was written: only
// 1 of 14 open entries carries a `Touches` field and 6 of 14 name any file path at all — so a
// tool built to "print what it finds" would have printed a plausible near-empty answer for
// thirteen of fourteen jobs. That is this codebase's signature failure (a plausible value rather
// than an error) manufactured fresh, in the instrument built to prevent it.
//
// So the missing input is REPORTED AS THE DEFECT rather than absorbed. `08-build-and-deploy.md`
// §Writing a guard: a probe states its preconditions as separate checks, runs them before the
// comparison, and refuses to print anything if one fails — naming which. Four stages here, and
// `null` at the end of any of them looks the same, which is exactly why each says its own name.
//
// WHAT IT DOES NOT DO. It does not decide what a job means, it does not rank files, and it does
// not tell you the job is small. It answers one question — WHICH FILES, WHICH GUARDS, WHICH DOC
// SECTIONS — from what the tree already states, and says plainly where the tree states nothing.
//
// Depends on: tests/_docs.js (the shared doc-tree resolver — three guards answered "where are the
// docs" separately once and one answered it with a literal `docs_343`, so the packaging convention
// broke the build the first time somebody obeyed it. There is one resolver now. This is its
// fourth caller and it does not get a fifth answer.)

const fs = require("fs");
const path = require("path");
const { ROOT, docPaths, searchedFor } = require("../tests/_docs.js");
// ONE READER OF `// SUBJECT:` LINES, AND THIS FILE USED TO HOLD THE SECOND. Its copy filtered
// tokens to `.js` and counted what survived, which is why the coverage this tool now prints could
// not have been computed from its own table: `check-rule-homes.js` declares a document and was
// absent from the denominator, so the honest-looking answer was 87/87 against a tree of 88/86.
const { census, readSubject, guardFiles } = require("../tests/_subjects.js");

// ── WHY `.html` AND A ROOT-LEVEL FILE ARE ADMITTED (widened at ddjp_386) ─────────────────────
// This pattern required a known directory prefix AND a `.js` extension, so `index.html` was
// DOUBLY invisible: no prefix, wrong extension. An entry whose `**Touches**` correctly declared
// `index.html` had that declaration silently dropped, and NO entry in the tree could scope the
// file. That is not a latent gap — `index.html` is where the `<script>` list and the `?v=` tag
// live, and a job that changes them is a job whose most important file the scoping tool refused
// to mention. `features/botsettings.js` shipped missing from that script list, driven happily by
// every sandbox and undefined in the browser, and no guard caught it.
//
// `check-guard-subject` was already widened to admit `.html` and verify it — one rule, in one
// place, and this tool should match rather than hold a narrower copy of the same judgement. The
// rule it now shares: a path is admissible if it resolves in the tree. Widen the mechanism, never
// trim the truth — an entry that names `index.html` is RIGHT, and the instrument was wrong.
const SRC_RE = /`((?:(?:app|core|ui|features|backends|tests|tools)\/[\w./-]+\.(?:js|html)|[\w.-]+\.html))`/g;
const DOC_RE = /`?((?:[A-Z-]+|\d\d-[a-z-]+|[a-z-]+)\.md)`?(?:\)|`)?[^\n]{0,40}?(§\s*[\w.]+|Part\s+\d+)?/g;

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every stage names itself. A refusal says WHICH precondition failed, because "no manifest" has
// four different causes and only one of them is the caller's fault.
function refuse(stage, detail, hint) {
  console.error("REFUSED at stage: " + stage);
  console.error("  " + detail);
  if (hint) console.error("\n  " + hint);
  process.exit(2);
}

function roadmap() {
  const tries = docPaths("main/09-roadmap.md");
  for (const p of tries) if (fs.existsSync(p)) return { path: p, text: fs.readFileSync(p, "utf8") };
  refuse("doc-tree", "09-roadmap.md is not in any of the places the tree puts it.",
    "The docs ship WITH the tree — extract `ddjp_NNN/` and `docs_NNN/` as siblings.\n  Looked in: " + searchedFor("main/09-roadmap.md"));
}

// The entry block: from the heading that names the id to the next entry or the next section.
// Both `### Phase`-style headings and `**JNN — ...**` prose entries are matched, because §6 holds
// both shapes and a parser that knew only one would silently return nothing for the other.
function entryBlock(text, id) {
  // THE ENTRY SHAPE IS `journal/entry-list.js`'S, NOT A SECOND DEFINITION OF IT (P7).
  // Written loosely first — `\\*\\*J39\\b` — and it matched `**J39's finding:`, a CROSS-REFERENCE
  // in §5, so the tool scoped the wrong block and reported a declared `Touches` as inferred.
  // That is the thirtieth signature: an anchor naming an identifier that appears at several
  // sites is not an anchor, and the wrong match APPLIES CLEANLY and reports a plausible answer.
  // AND THE BLOCK IS BOUNDED BY THE SECTION EDGE TOO. Without `\\n## ` the LAST entry in §6 ran to
  // end of file and swallowed §7-§10 — so a `**Touches**` match landed on §8's session protocol,
  // which says *read the modules named in the job's **Touches** field*. An over-long block reads
  // the right marker in the wrong place, which is the same failure one level up.
  const re = new RegExp("(^|\\n)(#### " + id + "\\b|\\*\\*" + id + " \u2014 )[\\s\\S]*?(?=\\n#### J\\d+\\b|\\n\\*\\*J\\d+ \u2014 |\\n## |$)");
  const m = text.match(re);
  return m ? m[0] : null;
}

// ── GUARD SUBJECTS ───────────────────────────────────────────────────────────────────────────
// Read from the DECLARED `// SUBJECT:` line, never inferred. Inference was tried and measured:
// a load list is a DEPENDENCY list — 77 of 172 guards load more than six modules and 25 load
// none — so "what it loads" answers a neighbouring question and returns a plausible number.
// Driven on this tree, the single-load heuristic proposed `core/logger.js` as the subject of
// `check-savefile`, `check-import` and both override guards. All four are wrong.
//
// So: declared subjects are AUTHORITATIVE, and the `--suggest` basis below is offered as a
// SUGGESTION with its provenance printed, never written into the tree by this tool.
// THE `.js` FILTER HERE IS A MATCHING RULE AND MUST NEVER BE A COUNTING RULE. This tool matches
// declared subjects against an entry's source files, which are `.js` — so narrowing to `.js` is
// correct FOR MATCHING. It was also, previously, where the coverage number came from, and that is
// the defect: a guard whose subject is a document or a directory population is unmatchable here and
// is still DECLARED. Counting is `census()`'s job, below. `check-subject-census.js` fails if the
// two ever answer differently again.
function declaredSubjects() {
  const out = {};
  for (const f of guardFiles()) {
    const decl = readSubject(f);
    if (!decl.declared) continue;
    const paths = decl.tokens.filter((s) => /\.js$/.test(s));
    if (paths.length) out[f] = paths;
  }
  return out;
}

// ── THE TOOL STATES ITS OWN COVERAGE, ON EVERY RUN ───────────────────────────────────────────
// Asked about `backends/backend1/streammanager.js` this tool printed a list of 13 guards and said
// nothing about the guards that have declared nothing at all. The number was right and the answer
// read as complete, which is this codebase's core signature — a plausible value rather than an
// error — inside the instrument built to refuse plausible values. It got worse with every row
// filled, because filling rows looks like progress while the silence stays the same size.
//
// So the list is announced as a FLOOR and the size of the unknown is printed beside it. The
// denominator is `census()`'s and is not recounted here: three answers to one question is the
// drift this tool's own `_docs.js` dependency exists to have removed once already.
function coverageLine() {
  const c = census();
  const pct = Math.round((c.declared / c.guards) * 100);
  return [
    "SUBJECT MAP COVERAGE — " + c.declared + " of " + c.guards + " guards declare a subject (" +
      pct + "%); " + c.undeclared + " declare nothing.",
    "  So any guard list above is a FLOOR, not the set: a guard among those " + c.undeclared +
      " may judge these files and CANNOT appear here.",
    "  Shrink it: node tests/check-guard-subject.js   (its EXCLUDED literal is the worklist)",
    "",
    "  THIS MAP HAS BEEN SAMPLED, NOT VERIFIED (J56, measured at `ddjp_384`): 31 rows resolved",
    "  across four stratified samples, 13 WRONG — in BOTH directions and in all four declaration",
    "  eras. So any list above is neither COMPLETE (a subject can be missing) nor EXCLUSIVE (a",
    "  name can be a vehicle). About one row in three, and NO era carries it more than another.",
    "  The figures are a dated measurement of that sample, not a count of the tree — re-deriving",
    "  them means re-reading rows, which is what J56 did and what nothing here recomputes.",
    "  NO WRONG SUBJECT LINE HAS BEEN OBSERVED COSTING ANYTHING: all 19 corrected were latent",
    "  mis-instructions, and BOTH directions waste a READING rather than shipping a defect. That",
    "  is why this line is a caution about how to use the list and not a defect report.",
  ].join("\n");
}

// UNCONFIRMED, and it says so at every print site. A `readFileSync` path is a file the guard
// genuinely opens — a stronger signal than a load list and still not a subject: a guard may
// extract from one file and be ABOUT another (`check-who-is-here` extracts the panel out of
// `ui/interface.js` and is about `Room.foldActivity`).
function suggestedSubjects() {
  const dir = path.join(ROOT, "tests");
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!/^check-.*\.js$/.test(f)) continue;
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    const code = t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const hits = new Set();
    const rx = /(?:readFileSync\([^)]*?|ROOT\s*,\s*)["']((?:app|core|ui|features|backends)\/[^"']+\.js)["']/g;
    let m; while ((m = rx.exec(code))) hits.add(m[1]);
    if (hits.size) out[f] = [...hits].sort();
  }
  return out;
}

function main() {
  // ASKABLE ON ITS OWN, AND THAT IS WHAT MAKES IT PINNABLE. `check-subject-census.js` drives this
  // path rather than a job id, because a guard hard-coding `J34` would break the day that entry
  // closes — a guard that fails for a reason unrelated to its subject gets disabled, which is the
  // `check-control-styling` lesson (a check that cries wolf is worse than no check). The line here
  // is the SAME `coverageLine()` the report below prints; a second formatter would be a second
  // answer, and this file has already shipped one of those.
  if (process.argv.includes("--coverage")) {
    console.log(coverageLine());
    process.exit(0);
  }
  const id = (process.argv[2] || "").toUpperCase();
  if (!/^J\d+$/.test(id)) {
    console.error("usage: node tools/context-for.js J34 [--suggest]\n" +
                  "       node tools/context-for.js --coverage    (subject-map coverage alone)");
    process.exit(1);
  }
  const suggest = process.argv.includes("--suggest");
  const rm = roadmap();

  const block = entryBlock(rm.text, id);
  if (!block) {
    refuse("entry", "no entry for " + id + " in " + path.relative(ROOT, rm.path) + ".",
      "Job ids come from the roadmap, never from memory:\n  node journal/entry-list.js <docs>/main/09-roadmap.md");
  }

  // ── THIS REPORTED EVERY ENTRY AS `open`, INCLUDING ONES CLOSED FOR TWELVE PACKAGES ────────
  // It read `block.split("\n")[0]`, and `entryBlock`'s regex opens with `(^|\n)` — so for every
  // entry except one at byte 0 the block STARTS with a newline and line 0 is the empty string.
  // `/\bDONE\b/.test("")` is false, always. The `status === "DONE"` note below has never printed.
  //
  // The core signature: it returned a PLAUSIBLE value rather than raising, and `open` is exactly
  // the answer nobody questions. Found at J59 by flipping one entry to DONE and noticing that the
  // two readers of the same file disagreed — `entry-list` said DONE and this said open — which is
  // why the catalogue's rule is to read the VERDICT rather than the line, from ONE reader.
  //
  // The heading is now found rather than assumed, and the test is `journal/entry-list.js`'s own
  // rule rather than a second spelling of it (P7, which this file already states above).
  const headLine = block.split("\n").find((l) => l.trim() !== "") || "";
  const status = /^(?:#### |\*\*)J\d+ \u2014[^\n]*\b(?:DONE|done)\b/.test(headLine) ? "DONE" : "open";
  const kindM = block.match(/\*\*Kind\.?\*\*\s*`?([\w+-]+)`?/);

  // ── THE DECLARED FIELD IS AUTHORITATIVE; PROSE IS A FALLBACK, AND IT SAYS SO ───────────────
  // FOUND BY DRIVING THIS TOOL AGAINST ITS OWN INPUT. Scraping every path in the entry block
  // reported `FILES (2)` for J21 — an entry whose `**Touches**` says UNDETERMINED — because two
  // paths are MENTIONED in its prose. That is a plausible value standing where a refusal belongs,
  // inside the tool written to refuse. A path an entry happens to name is not a path the job
  // changes.
  const tou = block.match(/\*\*Touches\*\*([\s\S]*?)(?:\n\n|$)/);
  const declaredScope = !!tou;
  const scopeText = tou ? tou[1] : block;
  // An entry that has DECIDED it touches nothing, or that its scope is not yet knowable, is
  // answering the question — and the answer is not a file list. Refused by NAME so the reason
  // travels: "blocked on a decision" and "no entry" are different states and must not collapse.
  const undet = declaredScope && /\bUNDETERMINED\b/.test(tou[1]);
  const none = declaredScope && /\bNOTHING IN THE TREE\b/.test(tou[1]);
  const files = [...new Set([...scopeText.matchAll(SRC_RE)].map((m) => m[1]))].sort();
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  const real = files.filter((f) => fs.existsSync(path.join(ROOT, f)));

  // ── THE STAGE THAT ACTUALLY FIRES TODAY ────────────────────────────────────────────────────
  // 13 of 14 open entries have no `Touches` field. That is a defect in the ENTRY, and saying so
  // is the point: an empty manifest would read as "this job touches nothing".
  if (undet) {
    refuse("touches-undetermined", id + " declares its scope as UNDETERMINED.",
      "The entry states this deliberately — the job is not designed yet, usually because it is\n" +
      "  blocked on a decision. It is NOT missing a field, and the paths its prose mentions are\n" +
      "  not its scope. Read the entry itself; there is nothing here to scope.");
  }
  if (none) {
    refuse("touches-none", id + " declares that it touches NOTHING IN THE TREE, by decision.",
      "That is the entry's answer rather than an omission — a measurement, an out-of-tree tool,\n" +
      "  or a ruling. There are no files to read.");
  }
  if (declaredScope && !real.length && /\bdoc tree only\b|\bdocs only\b/i.test(tou[1])) {
    refuse("touches-docs-only", id + " declares that it touches the DOC TREE ONLY.",
      "No app JS, so it can never reach the Phase 6 gate and never bumps `?v=`. That is the\n" +
      "  entry's answer, not a missing field — there is no code to scope. Read the entry.");
  }
  if (!real.length) {
    refuse("touches", id + " names no source file that exists on disk.",
      "This is a gap in the ENTRY, not in this tool. An entry with no `Touches` cannot be\n" +
      "  scoped, so a session would have to read the tree to find out what it is about —\n" +
      "  which is the cost this tool exists to remove. Add a **Touches** field to " + id +
      "\n  in " + path.relative(ROOT, rm.path) + " and run again." +
      (missing.length ? "\n  (It names " + missing.length + " path(s) that do not exist: " + missing.join(", ") + ")" : ""));
  }

  const declared = declaredSubjects();
  const sugg = suggest ? suggestedSubjects() : {};
  const pick = (table) => Object.keys(table).filter((g) => table[g].some((s) => real.includes(s))).sort();
  const gDecl = pick(declared);
  const gSugg = pick(sugg).filter((g) => !gDecl.includes(g));

  const docs = [...new Set([...block.matchAll(DOC_RE)]
    .map((m) => m[1] + (m[2] ? " " + m[2].replace(/\s+/g, " ").trim() : "")))]
    .filter((d) => /\.md/.test(d)).sort();

  const out = [];
  out.push("CONTEXT FOR " + id + "   [" + status + (kindM ? " · kind " + kindM[1] : "") + "]");
  out.push("derived from " + path.relative(ROOT, rm.path) + " — re-run rather than quoting this.");
  if (status === "DONE") out.push("\n  NOTE: this entry is DONE. Its reasoning may have been drained to the doc that owns it.");

  out.push("\nFILES (" + real.length + ")" + (declaredScope ? "   [declared in **Touches**]" : "   [INFERRED from prose — the entry declares no **Touches**; unconfirmed]"));
  for (const f of real) out.push("  " + f);
  if (missing.length) out.push("  ! named but absent: " + missing.join(", "));

  out.push("\nGUARDS THAT DECLARE THESE AS THEIR SUBJECT (" + gDecl.length + ")");
  if (gDecl.length) for (const g of gDecl) out.push("  " + g + "   -> " + declared[g].join(", "));
  else out.push("  none declare these files. That is NOT the same as no guard judging them —\n" +
                "  Re-run with --suggest for an UNCONFIRMED reading, or grep tests/ for the property.");
  // ON EVERY RUN, AND IN BOTH BRANCHES. A coverage note printed only when the list is empty is
  // worse than none: the silence would then fall exactly where a number was shown and believed.
  out.push(coverageLine());

  if (suggest && gSugg.length) {
    out.push("\nSUGGESTED, UNCONFIRMED (" + gSugg.length + ") — basis: the guard OPENS this file");
    out.push("  A file a guard reads is not necessarily its subject. Confirm before relying on it.");
    for (const g of gSugg) out.push("  " + g + "   -> " + sugg[g].join(", "));
  }

  out.push("\nDOC SECTIONS THIS ENTRY CITES (" + docs.length + ")");
  if (docs.length) for (const d of docs) out.push("  " + d);
  else out.push("  none cited. The rules governing these files still have owners — roles.md §2");

  out.push("\nREAD FIRST, WHATEVER THE JOB");
  out.push("  PILLARS.md · SPINE.md · FAILURE-SIGNATURES.md   (goals, shape, how defects here hide)");
  out.push("  then the files above, top to bottom, before touching them.");
  out.push("\nBEFORE YOU BELIEVE ANY OF IT: node tests/run-all.js");
  console.log(out.join("\n"));
}

main();
