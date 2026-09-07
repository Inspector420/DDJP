// tests/check-roadmap-gate.js
// THE PHASE 6 GATE, DERIVED — and refusing what it cannot read.
//
// 09-roadmap.md §2 sets the ordering rule: a `derivation` or `event-shape` job must land before
// the save-file format freezes. §5 used to restate the resulting list by hand, that copy went
// stale, and J10 — `derivation` by its own entry — fell off it entirely. §9 entry N recorded the
// fix: stop restating the list, DERIVE it from the `Kind` fields.
//
// The derivation then inherited the weakness one level down. Six entries carried no `Kind` at all
// (J29–J33 and J35), because the Phase 7 jobs are written as prose paragraphs rather than `####`
// headings and nobody had cause to notice. A scan run by eye reads straight past an entry with no
// Kind, so J35 — `derivation`, and on the gate — was invisible to the mechanism built to stop
// exactly that. **A derivation that silently ignores malformed input is a source scan with the
// same weakness as the textual guard J38 exists to replace.**
//
// So this asserts three things, and the first is the one that matters:
//   A. EVERY job entry declares a Kind. An entry without one FAILS; it is never skipped.
//   B. Every Kind token is one the gate criterion can actually classify. An unclassifiable Kind
//      is as invisible as a missing one — J36 carried `ui-copy` + `boundaries`, neither of which
//      §2 defines, so no scan could have placed it on either side of the gate.
//   C. The scan reached BOTH entry shapes. The `####` heading shape and the `**Jnn — …**` prose
//      shape are both real, and a scan that finds only the first misses all of Phase 7 while
//      looking entirely healthy — which is how five of the six missing Kinds stayed missing.
//
// It then PRINTS the gate, so §5's convenience list can be checked against a command rather than
// against somebody's memory.
//
// Reads docs/main/09-roadmap.md. The docs ship with the tree (02-architecture.md's handoff shape
// keeps `docs/` and strips `lib/` and the unused backends), so their ABSENCE is a broken tree and
// is reported as a failure rather than passed over — the same rule this file is about.

const fs = require("fs");
const path = require("path");

// WHERE THE ROADMAP LIVES DEPENDS ON HOW THE TREE WAS UNPACKED, and this guard passed for weeks
// against a layout that the shipped archives do not produce. The handoff ships TWO archives that
// extract as SIBLINGS — `ddjp_NNN/` and `docs_NNN/` — so `../docs/` exists in a working checkout
// and does not exist in a fresh extraction. Caught only by running the suite from an extracted
// copy rather than from the tree it was built in.
//
// So: look in both shapes, and fail naming every place looked at. Absence is still a failure —
// the docs ship with the tree — but "I looked in one place" is not the same claim as "it is not
// here".
const CANDIDATES = [
  path.join(__dirname, "..", "docs", "main", "09-roadmap.md"),          // docs inside the tree
  path.join(__dirname, "..", "..", "docs", "main", "09-roadmap.md"),    // sibling `docs/`
];
try {                                                                    // sibling `docs_NNN/`
  const up = path.join(__dirname, "..", "..");
  for (const d of fs.readdirSync(up)) {
    if (/^docs[_-]?\d*$/.test(d)) CANDIDATES.push(path.join(up, d, "main", "09-roadmap.md"));
  }
} catch (e) { /* no parent to scan; the candidates above still stand */ }
const PRESENT = CANDIDATES.filter((c) => fs.existsSync(c));
const ROADMAP = PRESENT[0] || CANDIDATES[0];

// ── AND IF TWO CANDIDATES DISAGREE, REFUSE RATHER THAN PICK ──────────────────────────────────
// Found at v248, by nearly reporting a clean gate off the wrong file. A session that unpacks the
// incoming handoff (`docs_247/`) and works in a new one (`docs_248/`) has BOTH as siblings, and
// `find` took the first — so the guard validated the docs the session had not edited and printed a
// gate that was true of neither tree. It reads exactly like the edit not having landed, which is
// the failure this file exists to prevent, arriving through the file's own resolver.
//
// Identical copies are harmless and stay silent. DIFFERING copies are refused, naming both: there
// is no honest way to choose, and choosing quietly is how the wrong one gets read.
if (PRESENT.length > 1) {
  const first = fs.readFileSync(PRESENT[0], "utf8");
  const differing = PRESENT.filter((c) => fs.readFileSync(c, "utf8") !== first);
  if (differing.length) {
    console.log("[roadmap-gate] FAIL — two roadmaps are reachable and they DIFFER, so any gate " +
      "printed here would be true of one tree and quoted about another. Unpack one pair at a time:");
    for (const c of PRESENT) console.log("      " + c);
    process.exit(1);
  }
}
console.log("[roadmap-gate] reading " + path.relative(path.join(__dirname, "..", ".."), ROADMAP));

let failed = 0;
function ok(cond, msg, detail) {
  if (cond) return;
  failed++;
  console.log("[roadmap-gate] FAIL — " + msg);
  if (detail !== undefined) console.log("      " + JSON.stringify(detail));
}

if (!fs.existsSync(ROADMAP)) {
  console.log("[roadmap-gate] FAIL — 09-roadmap.md is not in any of the places the handoff puts " +
    "it. The docs ship with the tree, so a missing roadmap is a broken tree and not a reason to " +
    "pass. Looked in:");
  for (const c of CANDIDATES) console.log("      " + c);
  process.exit(1);
}
const src = fs.readFileSync(ROADMAP, "utf8");

// ── §2's vocabulary, and the gate criterion, both read from the rule rather than restated ─────
// `decision` is a real Kind that resolves later (J05, J39, J32 all use it); it is not on the gate
// until the decision turns into one of the others, which is what those entries say.
const KINDS = ["derivation", "event-shape", "ui", "transport", "new-module", "decision"];
const ON_GATE = ["derivation", "event-shape"];

// ── find every job entry, in BOTH shapes ──────────────────────────────────────────────────────
// Phases 0–6 use `#### J06 — …`; Phase 7 uses `**J29 — …**` inline. A scan keyed on the heading
// alone is the failure this guard exists to make impossible, so both are found and counted
// separately, and part C asserts both were reached.
const JOB_RE = /^(?:#### (J\d+)\b|\*\*(J\d+) — )/gm;
const starts = [];
let m;
while ((m = JOB_RE.exec(src)) !== null) {
  starts.push({ id: m[1] || m[2], at: m.index, shape: m[1] ? "heading" : "prose" });
}
// §6 is the job list; anything after §7 is prose ABOUT jobs and must not be scanned as one.
const endOfJobs = src.indexOf("\n## 7. Decisions already made");
// Which phase each job sits in. A job INSIDE Phase 6 cannot gate Phase 6 — §2's rule is that a
// `derivation` job must land BEFORE the format freezes, and J25/J27/J28 are the freezing. Listing
// them as outstanding gate items is how a correct tool starts being ignored.
//
// EXCLUDE PHASE 6, NOT `phase >= 6`. The first draft of this guard wrote the second, which reads
// as the same thing and is not: Phase 7 is headed "no dependencies, any time" and TWO of its
// entries are on the gate anyway (J35 and J37 both declare `derivation`). So the tidy-looking
// bound silently dropped the very job this guard was written for. It was caught by reading the
// printed list against what was expected — which is why part D now checks it mechanically.
const phaseAt = (idx) => {
  let n = 0;
  const re = /^### Phase (\d+)/gm;
  let p;
  while ((p = re.exec(src)) !== null && p.index < idx) n = Number(p[1]);
  return n;
};

// ── AN UNATTRIBUTABLE PHASE MUST MAKE A JOB MORE VISIBLE, NEVER LESS (J50) ────────────────────
// `phaseAt` walks BACK to the nearest `### Phase N` heading, so it always returns a number and
// never says *I could not tell*. That is the whole hazard: the number it invents is then fed to
// `j.phase !== 6`, and a wrong 6 SILENTLY REMOVES a job from the gate.
//
// MEASURED, not inferred: this file has no `### Phase 2`, no `### Phase 3` and no `### Phase 7`
// heading at all. Thirteen entries sit under `### Remaining prose-shaped entries` and inherit
// Phase 6 from the heading above it; three more sit under one of J17's own subsections and
// inherit Phase 1. The guard's header says the `phase >= 6` bound was replaced BECAUSE Phase 7
// entries can be on the gate — and the heading that made Phase 7 findable has since been renamed
// away, so the bound it was replaced with silently does the same thing.
//
// SO: A PHASE IS ATTRIBUTED ONLY WHEN A `### Phase N` HEADING DIRECTLY GOVERNS THE ENTRY — no
// intervening non-phase `###` section that introduces entries of its own. Where it does not, the
// entry is NOT excluded and the section is PRINTED. Over-listing on the gate is loud and gets
// argued with; under-listing is silent, and silent is the failure this file exists to prevent.
// Fixing the headings is a doc job and belongs to the §6 drain; this refuses to hide it meanwhile.
const sectionHeads = [];
{
  const re = /^### (.*)$/gm;
  let h;
  while ((h = re.exec(src)) !== null) {
    if (endOfJobs > 0 && h.index > endOfJobs) break;
    sectionHeads.push({ at: h.index, text: h[1], isPhase: /^Phase \d+/.test(h[1]) });
  }
}
// The nearest `### ` heading above an entry. If it is a phase heading the phase is attributed;
// if it is anything else, the entry lives in a section the phase walk reads straight past.
const phaseAttributed = (idx) => {
  let last = null;
  for (const h of sectionHeads) { if (h.at < idx) last = h; else break; }
  return !!(last && last.isPhase);
};
const orphanSections = () => {
  const out = [];
  for (let i = 0; i < sectionHeads.length; i++) {
    const h = sectionHeads[i];
    if (h.isPhase) continue;
    const to = (i + 1 < sectionHeads.length) ? sectionHeads[i + 1].at
                                             : (endOfJobs > 0 ? endOfJobs : src.length);
    const ids = starts.filter((s) => s.at > h.at && s.at < to).map((s) => s.id);
    if (ids.length) out.push({ line: lineAt(h.at), text: h.text, ids: ids });
  }
  return out;
};
// Byte offset -> 1-based line, so a refusal can name WHERE rather than only WHAT. Counting
// newlines in the prefix is O(n) per call and this file is read once; a precomputed table
// would be faster and is another thing to keep in step with `src`.
const lineAt = (idx) => src.slice(0, idx).split("\n").length;

const jobs = [];
for (let i = 0; i < starts.length; i++) {
  const s = starts[i];
  if (endOfJobs > 0 && s.at > endOfJobs) continue;
  const to = (i + 1 < starts.length) ? starts[i + 1].at : (endOfJobs > 0 ? endOfJobs : src.length);
  const body = src.slice(s.at, to);
  const done = /^(?:#### |\*\*)J\d+ —[^\n]*\b(?:DONE|done)\b/.test(body);
  // ── THE DECLARATION IS THE FIRST SENTENCE, AND ONLY THAT ────────────────────────────────
  // Reading every backticked word in the paragraph is the same mistake one level down: J18
  // declares `new-module` and then says "deliberately NOT `derivation`", and a token scan put it
  // on the gate off the back of the negation. J39 does the same with "a row that becomes a
  // `derivation` fix". The Kind is what the field DECLARES — up to the first sentence end —
  // and everything after that is commentary about it.
  //
  // PRECISELY: the boundary is THE FIRST PERIOD FOLLOWED BY WHITESPACE, which is a stand-in for
  // "first sentence" and not the same thing. It is stated here because it is load-bearing and
  // invisible from the doc side: a Kind line containing `e.g.` or a decimal would truncate the
  // declaration at that period and silently read fewer tokens than it declares. No entry does
  // that today. Anyone writing a Kind should know the sentence boundary decides what is read —
  // and anyone MUTATING one should move the token past the period rather than deleting the
  // period, which relocates the boundary instead of testing past it.
  const k = body.indexOf("**Kind.**");
  let tokens = null;
  if (k >= 0) {
    const rest = body.slice(k + "**Kind.**".length);
    const para = rest.indexOf("\n\n") < 0 ? rest : rest.slice(0, rest.indexOf("\n\n"));
    const stop = para.search(/\.(?:\s|$)/);
    const decl = (stop >= 0) ? para.slice(0, stop) : para;
    tokens = (decl.match(/`([a-z-]+)`/g) || []).map((t) => t.replace(/`/g, ""));
  }
  jobs.push({ id: s.id, shape: s.shape, done: done, tokens: tokens, phase: phaseAt(s.at),
              at: s.at, line: lineAt(s.at),
              flat: body.replace(/\*/g, "").replace(/\s+/g, " ") });
}

// ── TWO ENTRIES SHARING AN ID ARE REFUSED, NAMING BOTH LINES (J50) ───────────────────────────
// This was `if (!byId.has(j.id)) byId.set(j.id, j)` — keep the first, discard the rest, SAY
// NOTHING. That is the same shape as the sibling-resolver above, which already refuses two
// disagreeing roadmaps rather than picking one, and for the same reason: there is no honest way
// to choose, and choosing quietly is how the wrong one gets read.
//
// IT CONCEALED A LIVE DEFECT FOR RELEASES. `09-roadmap.md` carried two `#### J17` headings — the
// runtime declaring `new-module` (off the gate) and the schema declaring `derivation` +
// `new-module` (on it). The discarded one said in its own prose that the gate prints J17 as
// outstanding. The gate printed `(none)`. Six starts across four ids were being discarded, and
// the real `#### J38`, `#### J39` and `#### J40` job entries were never read at all, because an
// audit-findings block earlier in §6 used the same heading shape and registered those ids first —
// so the gate reported `decision` for J38, whose entry declares `transport`.
//
// A WARNING IS NOT SUFFICIENT. Silence about WHICH entry was read is the whole defect, and a
// line nobody has to act on restores it in a quieter form.
const byId = new Map();
const duplicates = [];
for (const j of jobs) {
  const first = byId.get(j.id);
  if (first) duplicates.push({ id: j.id, first: first.line, again: j.line });
  else byId.set(j.id, j);
}
if (duplicates.length) {
  console.log("[roadmap-gate] FAIL — two or more entries share a job id. The derivation would " +
    "keep the FIRST and read past the rest, so a `Kind` on the later one is invisible to the gate " +
    "— which is exactly how J17's `derivation` half went unprinted. Merge them, or rename the " +
    "heading that is not a job entry so it stops claiming the id:");
  for (const d of duplicates) {
    console.log("      " + d.id + "  first at " + path.basename(ROADMAP) + ":" + d.first +
      "  again at " + path.basename(ROADMAP) + ":" + d.again);
  }
  process.exit(1);
}
const entries = Array.from(byId.values());

// ── A. every entry declares a Kind ────────────────────────────────────────────────────────────
const noKind = entries.filter((j) => j.tokens === null).map((j) => j.id);
ok(noKind.length === 0,
  "A: every job entry must declare a **Kind.** — an entry without one is invisible to the gate " +
  "derivation, which is how J35 (`derivation`, on the gate) went unscheduled. It is not skipped; " +
  "it is refused", noKind);

// ── B. every token is classifiable ────────────────────────────────────────────────────────────
const unknown = [];
for (const j of entries) {
  for (const t of (j.tokens || [])) if (KINDS.indexOf(t) < 0) unknown.push(j.id + ":" + t);
}
ok(unknown.length === 0,
  "B: every Kind token must be one §2 defines (" + KINDS.join(" · ") + "). A token the criterion " +
  "cannot classify leaves the job on neither side of the gate, which is the same hole as no Kind " +
  "at all", unknown);
// And a Kind field that parsed to NOTHING is malformed rather than empty-and-fine.
const emptyKind = entries.filter((j) => j.tokens !== null && j.tokens.length === 0).map((j) => j.id);
ok(emptyKind.length === 0,
  "B: a **Kind.** field that names no token in backticks is malformed — it reads as present and " +
  "classifies as nothing", emptyKind);

// ── C. the scan is not vacuous, and reached both shapes ───────────────────────────────────────
const headings = entries.filter((j) => j.shape === "heading").length;
const prose = entries.filter((j) => j.shape === "prose").length;
ok(entries.length >= 30,
  "C: the scan found implausibly few job entries — a regex that matches nothing reports a clean " +
  "gate", { found: entries.length });
ok(headings >= 20 && prose >= 5,
  "C: the scan must reach BOTH entry shapes. Phase 7 is written as prose paragraphs, so a scan " +
  "keyed on `####` alone misses that whole phase while looking healthy — which is how five of " +
  "the six missing Kinds survived", { headings: headings, prose: prose });

// ── D. THE PROSE CLAIM AND THE DERIVATION MUST AGREE ──────────────────────────────────────────
// Several entries state their gate side in words as well as in a Kind — "So it is on the Phase 6
// gate", "it is not on the Phase 6 gate". Those are two independent statements of one fact, which
// makes them checkable against each other, and a job is exactly where two statements of one fact
// drift. This also covers the guard's OWN arithmetic: the first draft excluded `phase >= 6` and
// dropped J35 and J37 from the derived list while both say in words that they are on the gate.
// Nothing failed; the list was simply short. This part is what makes that impossible.
const gateIds = new Set();
const claimMismatch = [];

// ── THE GATE, DERIVED AND PRINTED ─────────────────────────────────────────────────────────────
const inPhase6 = (j) => j.phase === 6 && phaseAttributed(j.at);
const gate = entries.filter((j) => !j.done && !inPhase6(j) &&
  (j.tokens || []).some((t) => ON_GATE.indexOf(t) >= 0));
const conditional = gate.filter((j) => j.tokens.length > 1);
for (const j of gate) gateIds.add(j.id);
for (const j of entries) {
  if (j.done) continue;
  const saysOn = /So it is on the Phase 6 gate/.test(j.flat);
  const saysOff = /is not on the Phase 6 gate|not on the Phase 6 gate/.test(j.flat);
  if (saysOn && !gateIds.has(j.id)) claimMismatch.push(j.id + ": says ON, derivation says off");
  if (saysOff && gateIds.has(j.id)) claimMismatch.push(j.id + ": says OFF, derivation says on");
}
ok(claimMismatch.length === 0,
  "D: an entry that states its gate side in words must agree with the side its Kind derives to. " +
  "Two statements of one fact are exactly where drift lives — and this is also the guard's own " +
  "arithmetic under test, since a wrong bound here shortens the list silently", claimMismatch);

// ── THE FULL INVENTORY, BEHIND A FLAG — ONE DERIVATION, TWO OUTPUTS ──────────────────────────
// J25's entry condition is "list every `derivation` and `event-shape` job above it and mark each
// done or ruled out in writing". That list is the SAME derivation this file already runs, differing
// only in that it keeps the closed entries instead of filtering them out. Writing it as a second
// scanner would be the copy §9 entry N deleted, one level down — so it is a flag here rather than a
// tool of its own, and the doc's inventory is regenerated by:
//
//     node tests/check-roadmap-gate.js --inventory
//
// `done` is read from the entry HEADING, which is what makes a ruling-out recordable at all: J37
// (v246) and J10 (v248) are both closed by a heading that says so, and neither prints below.
if (process.argv.indexOf("--inventory") >= 0) {
  const above = entries.filter((j) => !inPhase6(j) &&
    (j.tokens || []).some((t) => ON_GATE.indexOf(t) >= 0));
  console.log("[roadmap-gate] EVERY gate-criterion job above Phase 6 (`derivation` | `event-shape`):");
  for (const j of above.sort((a, b) => (a.phase - b.phase) || (a.id < b.id ? -1 : 1))) {
    console.log("      " + j.id + "  phase " + j.phase + "  [" + j.tokens.join("+") + "]  " +
      (j.done ? "CLOSED (heading says so)" : "OUTSTANDING"));
  }
  console.log("      — " + above.filter((j) => j.done).length + " closed · " +
    above.filter((j) => !j.done).length + " outstanding");
}

const orphans = orphanSections();
if (orphans.length) {
  console.log("[roadmap-gate] entries whose phase could NOT be attributed to a `### Phase N` " +
    "heading — they are NOT excluded from the gate, and the headings want fixing:");
  for (const o of orphans) {
    console.log("      " + path.basename(ROADMAP) + ":" + o.line + "  \"### " + o.text + "\"  -> " +
      o.ids.join(" "));
  }
}
console.log("[roadmap-gate] the Phase 6 gate, derived from the Kind fields:");
console.log("      outstanding: " + (gate.map((j) => j.id).join(" · ") || "(none)"));
if (conditional.length) {
  console.log("      conditional (their entry names more than one Kind): " +
    conditional.map((j) => j.id + " [" + j.tokens.join("+") + "]").join(" · "));
}

if (failed) process.exit(1);
console.log("[roadmap-gate] PASS — the Phase 6 gate is DERIVED from §6's Kind fields rather than " +
  "restated, and the derivation refuses what it cannot read: every one of the " + entries.length +
  " job entries declares a Kind (" + headings + " heading-shaped, " + prose + " prose-shaped, and " +
  "a scan that reached only the first would miss all of Phase 7), every token is one §2 defines, " +
  "and a Kind that parses to nothing is malformed rather than absent-and-fine. §9 entry N replaced " +
  "a hand-written list with this derivation; six entries then carried no Kind at all and the " +
  "derivation read past them, which is how J35 stayed off a gate its own Kind puts it on");
