// tools/seam-for.js
// MEASURE A CLUSTER'S SEAM BEFORE MOVING IT — the step that has now caught two defects
// the banner map hid, so it lives here rather than in a session's scratch directory.
//
//   node tools/seam-for.js "LOGS PANEL" "ROOM HISTORY" "THE EVENT FEED"
//
// It reports, in BOTH directions, every module-level declaration that crosses the
// boundary, and flags the two shapes that are HALT conditions rather than work:
// a scalar rebound on both sides, and a cluster that would write another's state.
//
// ── WHY IT EXISTS: ZERO refs IS NOT ZERO COUPLING ────────────────────────────────────────────
// `OFFLOAD-BRIEF.md` §2 measured `BACKGROUND ENGINE` as 145 lines, 0 `refs.` uses and 0
// primitives, and said in the same breath that zero uses is not zero coupling because module
// state had NOT been measured. It was right: `_bgLeaveRoom` writes six of another cluster's
// variables and calls `_thumbReset`. That is what this tool measures.
//
// ── AND IT FOUND THE SECOND ONE ON ITS SECOND USE ────────────────────────────────────────────
// Cutting `THE EVENT FEED` by its banner span takes four roster declarations with it, because
// the banner map is not a partition of the file (`roles.md` §5). The boundary detection here
// handles BOTH banner shapes — the `──/══/──` block and the single decorated `══ NAME (J13) ═══`
// line — because keying on one cut the other wrong on the first run, silently.
//
// ── A LIMIT, MEASURED AT ddjp_393: IT COUNTS IDENTIFIERS INSIDE STRING LITERALS ─────────────
// Comments are stripped before counting; STRINGS are not. A word like `clear` appearing in help
// prose inflates the occurrence count, and a rewrite expectation taken from that number will be
// one too high and read as drift. The count is a FLOOR on real references, never an exact figure
// — compare it against what the rewrite actually touches and reconcile the difference rather than
// retuning the expectation to match.
//
// ── AND IT WAS VOID ON THE FILE THE NEXT JOB NAMED IT FOR, MEASURED AT ddjp_398 ─────────────
// `J59`'s **Touches** names this tool for `backends/backend1/matrixbridge.js`. Run against that
// file it printed `VOID — no banner matching ... Present: ` with an EMPTY list, because the banner
// regex keys on `══` and that file has ZERO of them: its sections are `── NAME ──` and `--- name
// ---`. It refused loudly rather than measuring a seam of nothing, which is the tool working — but
// it measured nothing, and a tool named in a job entry that cannot read the job's file is a gap
// between the plan and the instrument.
//
// WIDENING THE BANNER REGEX TO `──` WOULD HAVE BEEN WRONG AND SILENTLY SO. In `ui/` the two shapes
// are a hierarchy: `══` is a section, `──` a sub-heading. In `matrixbridge.js` they are the same
// shape, so admitting `──` turns all 80 of that file's headings — most of them INSIDE function
// bodies — into region boundaries, and the tool starts returning confident wrong spans instead of
// an honest refusal. The banner mode stays `ui/`-shaped on purpose.
//
// SO THERE IS A SECOND MODE, AND IT IS THE ONE `roles.md` §5's OWN CUT RULE ASKS FOR:
//
//   DECL=1 UI=backends/backend1/matrixbridge.js node tools/seam-for.js login logout _loadSession
//   DECL=@/tmp/plumbing.txt UI=backends/backend1/matrixbridge.js node tools/seam-for.js
//
// It takes DECLARATION names and derives each one's span from where its own declarations end —
// *a region is bounded by where its own declarations end; the banner is a reading aid* — which is
// the rule the ui/ split paid three packages to learn and which the banner mode only approximates.
// Both modes report the same seam and apply the same two HALT rules.
//
// WHAT IT DOES NOT DO: it names no destination. Which cluster owns a stranded declaration is a
// reading, and `roles.md` §5's ownership map is where that answer is recorded.

const fs = require('fs');

// NO DEFAULT SINCE ddjp_397. `ui/interface.js` ceased to exist when the split completed, and a
// default pointing at a missing file makes every measurement VOID while reading like an answer.
// The caller names the file: `UI=ui/shell.js node tools/seam-for.js "LAYOUT"`.
const UI = process.env.UI;
if (!UI) { console.error('VOID - set UI=<file>, e.g. UI=ui/shell.js'); process.exit(2); }
const WANT = process.argv.slice(2);
if (!WANT.length && !(process.env.DECL || '').startsWith('@')) {
  console.error('usage: seam.js "SECTION NAME" ...   |   DECL=1 seam.js declName ...   |   DECL=@list.txt seam.js');
  process.exit(2);
}

const raw = fs.readFileSync(UI, 'utf8').split('\n');
const code = raw.map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, '$1'));

// ── banner blocks: the separator line above `══ NAME` through the line before the
//    next separator. Asserted by text, never by a stored number.
const banners = [];
for (let i = 0; i < raw.length; i++) {
  const m = raw[i].match(/^\s*\/\/\s*══\s*(.+?)\s*═*\s*$/);
  if (m) banners.push({ name: m[1].trim(), at: i + 1 });
}
// A banner comes in TWO shapes in this file and a rule keyed on one cuts the other
// wrong: `── / ══ NAME / description / ──` for most, and a single decorated
// `══ NAME (J13) ═══…` line for the J13 and J16 panels. The block start is the rule
// line when there is one and the `══` line when there is not, computed rather than
// assumed — asserting one shape is how a correct cut becomes a silent off-by-one.
const isRule = (ln) => /^\s*\/\/\s*[─-]{3,}\s*$/.test(raw[ln - 1] || '');
const blockStart = (at) => (isRule(at - 1) ? at - 1 : at);
for (const b of banners) b.blockStart = blockStart(b.at);
const regionOf = (name) => {
  const idx = banners.findIndex((b) => b.name === name || b.name.startsWith(name));
  if (idx < 0) return null;
  const start = banners[idx].blockStart;
  const end = idx + 1 < banners.length ? banners[idx + 1].blockStart - 1 : raw.length;
  return { name: banners[idx].name, start, end };
};

// ── DECLARATION MODE ────────────────────────────────────────────────────────────────────────
// A "region" is one top-level declaration's own span: its line through the line before the next
// top-level declaration. Named declarations are given on the command line, or in a file with
// DECL=@path (one name per line, `#` comments ignored) because a real cut names dozens.
const DECL = process.env.DECL;
function declRegions(names) {
  const at = [];
  for (let i = 0; i < code.length; i++) {
    let m = code[i].match(/^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) { at.push({ name: m[1], ln: i + 1 }); continue; }
    m = code[i].match(/^  (let|const|var)\s+(.+)$/);
    if (!m || /^\s*[{[]/.test(m[2])) continue;
    for (const part of m[2].split(/,(?![^(]*\))/)) {
      const n = part.trim().match(/^([A-Za-z_$][\w$]*)\s*(=|$)/);
      if (n) at.push({ name: n[1], ln: i + 1 });
    }
  }
  const span = new Map();
  for (let i = 0; i < at.length; i++) {
    let j = i + 1; while (j < at.length && at[j].ln === at[i].ln) j++;
    span.set(at[i].name, { start: at[i].ln, end: j < at.length ? at[j].ln - 1 : raw.length });
  }
  const miss = names.filter((n) => !span.has(n));
  if (miss.length) { console.error(`VOID — not top-level declarations in ${UI}: ${miss.join(', ')}`); process.exit(3); }
  return names.map((n) => ({ name: n, start: span.get(n).start, end: span.get(n).end }));
}

const regions = [];
if (DECL) {
  let names = WANT;
  if (DECL.startsWith('@')) {
    names = fs.readFileSync(DECL.slice(1), 'utf8').split('\n')
      .map((x) => x.replace(/#.*$/, '').trim()).filter(Boolean);
  }
  if (!names.length) { console.error('VOID — DECL mode with no declaration names'); process.exit(2); }
  for (const r of declRegions(names)) regions.push(r);
} else
for (const w of WANT) {
  const r = regionOf(w);
  if (!r) { console.error(`VOID — no banner matching ${JSON.stringify(w)}. Present: ${banners.map((b) => b.name).join(' | ')}`); process.exit(3); }
  // the block must OPEN on either a rule or the banner itself, and must CONTAIN the name
  const head = raw[r.start - 1] || '';
  if (!/^\s*\/\/\s*([─-]{3,}|══)/.test(head)) {
    console.error(`VOID — line ${r.start} opens no banner block for ${r.name}: ${JSON.stringify(head)}`);
    process.exit(3);
  }
  if (!raw.slice(r.start - 1, r.start + 2).some((l) => l.includes('══'))) {
    console.error(`VOID — no ══ banner within the opening lines of ${r.name}`);
    process.exit(3);
  }
  regions.push(r);
}
regions.sort((a, b) => a.start - b.start);
const inMove = (ln) => regions.some((r) => ln >= r.start && ln <= r.end);
let moved = 0; for (const r of regions) moved += r.end - r.start + 1;

// ── module-level declarations (indent exactly 2) ────────────────────────────
const decl = new Map();
for (let i = 0; i < code.length; i++) {
  let m = code[i].match(/^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (m) { decl.set(m[1], { ln: i + 1, kind: 'fn' }); continue; }
  m = code[i].match(/^  (let|const|var)\s+(.+)$/);
  if (!m || /^\s*[{[]/.test(m[2])) continue;
  for (const part of m[2].split(/,(?![^(]*\))/)) {
    const n = part.trim().match(/^([A-Za-z_$][\w$]*)\s*(=\s*(.*))?$/);
    if (!n) continue;
    decl.set(n[1], { ln: i + 1, kind: m[1], obj: /^[{[]/.test((n[3] || '').trim()) });
  }
}
const esc = (s) => s.replace(/\$/g, '\\$');

const rows = [];
for (const [n, d] of decl) {
  const rx = new RegExp('(?<![\\w$.])' + esc(n) + '(?![\\w$])');
  const as = new RegExp('(?<![\\w$.])' + esc(n) + '\\s*(?:=(?!=)|\\+\\+|--|\\+=|-=|\\|=)');
  let rIn = 0, rOut = 0, aIn = 0, aOut = 0, occIn = 0, occOut = 0;
  const g = new RegExp('(?<![\\w$.])' + esc(n) + '(?![\\w$])', 'g');
  for (let i = 0; i < code.length; i++) {
    if (!rx.test(code[i])) continue;
    const here = inMove(i + 1), isDecl = (i + 1 === d.ln);
    const occ = (code[i].match(g) || []).length;
    if (here) { rIn++; occIn += occ; } else { rOut++; occOut += occ; }
    if (!isDecl && as.test(code[i])) { if (here) aIn++; else aOut++; }
  }
  if (rIn > 0 && rOut > 0) rows.push({ n, ...d, rIn, rOut, aIn, aOut, occIn, occOut, declIn: inMove(d.ln) });
}

const P = (s, n) => String(s).padEnd(n);
console.log(`CLUSTER: ${regions.map((r) => r.name).join(' + ')}`);
for (const r of regions) console.log(`  ${P(r.name, 42)} lines ${r.start}..${r.end}  (${r.end - r.start + 1})`);
console.log(`  TOTAL ${moved} lines\n`);

const outFns = rows.filter((r) => r.kind === 'fn' && r.declIn);
const inFns = rows.filter((r) => r.kind === 'fn' && !r.declIn);
console.log(`MOVES OUT, still referenced in ${UI} (${outFns.length})  — rewrite to <Global>.name, and CHECK EACH: a published export row and a real call site are both "one occurrence" until you look`);
for (const r of outFns) console.log(`  ${P(r.n, 26)} ${r.occOut} occurrence(s) left behind`);
console.log(`\nSTAYS, called from the moved code (${inFns.length})  — this is the ACCESSOR surface the moved half must reach down for`);
for (const r of inFns) console.log(`  ${P(r.n, 26)} ${r.occIn} occurrence(s) moving out`);

const vars = rows.filter((r) => r.kind !== 'fn');
console.log(`\nVARIABLES CROSSING (${vars.length})`);
const halts = [];
for (const r of vars.sort((a, b) => (b.aIn + b.aOut) - (a.aIn + a.aOut))) {
  let verdict;
  if (r.aIn > 0 && r.aOut > 0) { verdict = 'HALT — rebound on BOTH sides'; halts.push(r.n); }
  else if (r.obj) verdict = 'object -> alias both sides';
  else if (r.aIn > 0) verdict = 'rebound in the cluster -> moves with it, accessor for readers';
  else if (r.aOut > 0) verdict = 'rebound outside -> stays, publish a READER not the value';
  else verdict = 'const, read-only -> moves if only the cluster reads it';
  console.log(`  ${P(r.n, 24)} ${P(r.kind + (r.obj ? ' obj' : ''), 10)} r:${r.rIn}/${r.rOut} a:${r.aIn}/${r.aOut}  ${verdict}`);
}
console.log(`\nHALT candidates: ${halts.length ? halts.join(', ') : 'none'}`);
