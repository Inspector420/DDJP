// A titled `──` sub-heading immediately followed by a `══` BANNER is a heading whose body left.
// That is the exact shape of the one found at ddjp_394: `── THE DM PANEL (J15) ──` sitting above
// `══ MODALS` two packages after ui/chat.js took the body. Nothing in this tree reads prose, so a
// heading naming a section that is not there is invisible to every guard.
//
// TWO EARLIER VERSIONS OF THIS SWEEP OVER-SELECTED AND REPORTING EITHER WOULD HAVE BEEN WRONG.
// The first looked for a DECLARATION beneath each heading (32 of 99 flagged, nearly all healthy —
// most titled headings sit over prose INSIDE a function body). The second looked for any code
// beneath (19 flagged, all of them headings inside long comment blocks). The signal is not
// "nothing follows"; it is "the next thing is a BANNER", which means the section ended where its
// own title began.
const fs = require('fs');
const path = require('path');
// ── THE POPULATION WAS `ui/` ONLY, AND J59 IS WHY THAT IS NOW WRONG ─────────────────────────
// This scanned one hard-coded directory. `J59` cut `backends/backend1/matrixbridge.js` in two and
// this tool RAN CLEAN over it — because it never looked at it. A probe that never applied reads
// exactly like a probe that applied and found nothing (42nd signature), and a population keyed by
// a directory path is a claim about where something lives that a split is precisely what staleens
// (52nd signature). The directories are listed here rather than walked from the repo root because
// `node_modules`, `lib/` and `tools/probes/` hold code nobody banners; adding one is a line.
const DIRS = ['ui', 'backends/backend1', 'features', 'core'];
const HEAD = /^\s*\/\/\s*[\u2500-]{2,}\s*(.+?)\s*[\u2500-]{2,}\s*$/;
const BANNER = /^\s*\/\/\s*\u2550\u2550/;
const RULE = /^\s*\/\/\s*[\u2500-]{3,}\s*$/;

// ── AND THE SHAPE IS NOT THE SAME IN BOTH FAMILIES ──────────────────────────────────────────
// In `ui/` a section banner is `══` and a sub-heading is `──`, so "heading followed by banner"
// is the orphan. In `backends/` there are no `══` banners at all — heading and banner are the
// SAME `──` shape — so keying on `══` there matches nothing and passes by construction, which is
// how this tool read green over the one file it was named in the roadmap to check.
// The property underneath is the same in both: a titled heading whose section ENDED WHERE ITS
// OWN TITLE BEGAN, i.e. whose next real line is another heading or a banner rather than a body.
const files = [];
for (const d of DIRS) {
  const abs = path.join(process.cwd(), d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.js')).sort()) files.push([d, f]);
}
let flagged = 0, checked = 0;
for (const [d, f] of files) {
  const lines = fs.readFileSync(path.join(process.cwd(), d, f), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEAD);
    if (!m || !/[A-Z]{3}/.test(m[1])) continue;
    checked++;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (RULE.test(lines[j]) || lines[j].trim() === '//') continue;
      const nextIsHeading = HEAD.test(lines[j]) && /[A-Z]{3}/.test((lines[j].match(HEAD) || [, ''])[1]);
      if (BANNER.test(lines[j]) || nextIsHeading) {
        flagged++;
        console.log(`  ORPHAN  ${d}/${f}:${i + 1}  "${m[1].slice(0, 54)}" is followed straight by ${BANNER.test(lines[j]) ? 'a banner' : 'another heading'}`);
      }
      break;
    }
  }
}
console.log(`\n${checked} titled sub-headings scanned across ${files.length} files in ${DIRS.join(', ')}; ${flagged} orphaned`);
if (flagged) process.exit(1);
