// tests/check-ui-refs.js
// SUBJECT: ui/
// WALL: EVERY `refs.X` THE UI READS IS A REF THE UI ASSIGNS — ACROSS THE WHOLE ui/ LAYER.
//
// ── WIDENED FROM ONE FILE TO THE POPULATION AT ddjp_386, IN THE SAME CHANGE AS THE SPLIT ─────
// This guard used to prove the property INSIDE `ui/interface.js`. That file is becoming ten
// (roles.md §5) and `refs` now lives in `ui/base.js`, so a per-file scan would have stopped
// being total the moment the first cluster left — and it would have stopped QUIETLY, because a
// smaller file has fewer reads AND fewer assignments and the two shrink together.
//
// It did not go quiet, and that is worth recording because it decided the shape of this edit.
// The first cluster out (`ui/player.js`) assigns `refs.npAvatar` in `renderNowPlaying` and
// `ui/interface.js` still READS it, so the per-file form went RED on the first run of the
// extraction. The orphan was real under the old rule and legal under the new one: the assignment
// did not disappear, it moved next door. **The subject of this guard is the LAYER, not a file.**
//
// AND THE FLOOR BELOW IS DELIBERATELY DENOMINATED IN THE POPULATION, NOT IN A FILE. A count of
// refs in `ui/interface.js` is a number this job exists to REDUCE — every cluster that moves
// makes it smaller, so a floor on it would eventually fail honest work and teach the next session
// to re-tune it rather than to look (the forty-seventh signature). The total across `ui/` does
// not move when a cluster relocates: the same reads and the same assignments, in different files.
//
// ── WHY THIS EXISTS: THE FIRST BROWSER RUN, AND ONE LINE KILLED SEVEN ───────────────────────
// `_renderDelegationSetting` ended with `refs.settingsBody.appendChild(wrap)`. **`settingsBody`
// is not a stale reference — it is a name that had never existed anywhere in `ui/interface.js`**,
// one character of divergence from the `settingsBox` every one of its twenty-one sibling appends
// uses. It threw `Cannot read properties of undefined (reading 'appendChild')`.
//
// THE CONSEQUENCE IS THE FINDING, NOT THE CRASH. `renderSettings()` sits in the tail of
// `enterMainScreen`, nothing between it and the end is inside a `try`, so **everything after it
// never ran**: `renderLogs`, `ChatPrefs.load`, `_setLayout`, `_applyDisplayDims`,
// `renderChatSettings`, `_renderGear`. That produced what the owner reported as three separate
// bugs and one screenshot of a room with every panel drawn on top of every other:
//   · `_setLayout` never ran        -> nothing was ever told WHICH PANEL TO SHOW
//   · `_applyDisplayDims` never ran -> the player box never got dimensions
//   · `ChatPrefs.load` never ran    -> EVERY device-local preference silently unloaded, all session
// The tab bar was correct throughout, which is the tell: the panels were rendered and never
// arranged.
//
// ── AND THE REASON NO GUARD SAW IT IS NOT THE ONE IT LOOKS LIKE ─────────────────────────────
// The obvious suspicion is the harness's fake `el()`. **Driven, and it is wrong**: reading
// `.appendChild` off `undefined` throws identically in the harness and in a browser. The fake DOM
// did not hide this.
//
// What hid it is that **nothing ever CALLS these functions.** Of the 40 `render*`/`_render*`
// declarations in `ui/interface.js`, five are extracted and executed by a guard and **thirty-five
// are executed by nothing at all** — including `renderSettings` and `_renderDelegationSetting`,
// the newest panel code in the file. The five executing guards each extract only the declarations
// they were written for; no guard has ever asked what is left over.
//
// Executing all forty is a large job and is not this one. THIS guard takes the cheap total
// property instead: a `refs.X` read that names something never assigned is a crash the moment that
// line runs, whoever runs it — and it is a whole-file check, so it covers the thirty-five nothing
// else reaches. It would have caught this bug before the browser did.

// ── WHY THIS EXISTS EVEN THOUGH THE PROJECT NOW HAS A LINTER (v280 / measured at v293) ──────
// Somebody will ask. **No standard lint rule catches v280's defect, and that is measured rather
// than assumed.** `refs.settingsBody` is a PROPERTY ACCESS on a declared object — `no-undef` looks
// at identifiers, not at properties, so `refs.anything` resolves for any name at all. Driven:
// reintroducing the exact defect leaves `eslint:recommended` green.
//
// So this scan is NECESSARY rather than merely convenient, and the linter and this guard cover
// disjoint classes: the linter finds names that do not resolve, this finds refs that are never
// assigned. Neither subsumes the other.

const fs = require("fs");
const path = require("path");

let asserts = 0;
function fail(msg, got) {
  console.log("[ui-refs] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");

// THE POPULATION IS READ FROM THE DIRECTORY, NEVER LISTED. A hand-written list is a second copy
// of the ten-file decision, free to drift from it, and it would drift in the direction that
// matters: a ui/ file added tomorrow would simply not be scanned, which is a guard reporting
// green about work it never looked at. `check-ui-files` pins the list itself.
const UI_DIR = path.join(ROOT, "ui");
const UI_FILES = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort().map((f) => "ui/" + f);

// `(?<![\w.])` matters: without it `ChatPrefs.load` matches as `refs.load`, because `ChatPrefs`
// ENDS IN `refs`. The first version of this scan reported 34 false orphans for exactly that
// reason — a reminder that a scan is a measurement and needs its own control.
const READ = /(?<![\w.])refs\.([A-Za-z_]\w*)/g;
const WRITE = /(?<![\w.])refs\.([A-Za-z_]\w*)\s*=[^=]/g;

// ── ONE UNION OVER THE POPULATION ────────────────────────────────────────────────────────────
// Reads and assignments are gathered across every ui/ file and the orphan check is run ONCE over
// the union. Per-file would now be wrong in both directions: it reports a legal cross-file
// assignment as an orphan, and it cannot see a read whose only assignment is next door.
const reads = new Set();
const writes = new Set();
const perFile = [];
for (const rel of UI_FILES) {
  // COMMENTS ARE STRIPPED, AND THIS GUARD CAUGHT ITSELF NEEDING IT ON ITS FIRST RUN: the comment
  // written above the FIXED line names `refs.settingsBody` while explaining that it must not be
  // used, and the scan reported it as a live orphan. **A scan that matches commentary is testing
  // prose, not code** — the project's own rule that a guard asserts against code and never against
  // a file's description of itself, arriving from the direction where the description is a warning
  // about the very thing being scanned for.
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const fReads = [...src.matchAll(READ)].map((m) => m[1]);
  const fWrites = [...src.matchAll(WRITE)].map((m) => m[1]);
  for (const r of fReads) reads.add(r);
  for (const w of fWrites) writes.add(w);
  perFile.push({ rel: rel, reads: new Set(fReads), writes: new Set(fWrites) });
}

// ── THE POPULATION MUST BE THE ONE THIS GUARD THINKS IT IS ───────────────────────────────────
// A directory that scanned to nothing satisfies every assertion below for free, and an empty
// orphan list is exactly what a clean tree looks like. So the scan is asserted live first.
ok(UI_FILES.length >= 3,
  "APPLIED — ui/ must hold the split files. Found: " + UI_FILES.join(", "), UI_FILES);
ok(UI_FILES.includes("ui/base.js"),
  "APPLIED — `refs` lives in ui/base.js since ddjp_386 and that file must be in the population, " +
  "or this scan is missing the declaration home of the thing it checks", UI_FILES);
ok(reads.size > 50,
  "APPLIED — the scan must find a substantial number of refs across ui/, or an empty orphan list " +
  "below means the regex missed rather than that the layer is clean", reads.size);
ok(writes.size > 50,
  "APPLIED — and a substantial number of assignments, or every read looks like an orphan",
  writes.size);
// Every scanned file must have been READ, not merely listed: a file that contributed neither a
// read nor an assignment is either genuinely refs-free or was not read at all, and those two
// need telling apart. ui/base.js DECLARES refs and legitimately uses no `refs.X`, so it is named
// rather than left to satisfy the rule by accident.
// The files that legitimately hold no `refs.X`, each NAMED with its reason rather than allowed
// to satisfy the rule by accident. `ui/chatbuffer.js` is the RAM message buffer — it builds no
// DOM at all, which is why it is the one ui/ file that never touches the table.
const REFS_FREE = {
  "ui/base.js": "declares `refs` and hands it to everything else; it reads no member of it",
  "ui/chatbuffer.js": "the RAM message buffer — sorted insert and eviction, and no DOM",
};
for (const f of perFile) {
  if (REFS_FREE[f.rel]) {
    ok(f.reads.size === 0 && f.writes.size === 0,
      "APPLIED — " + f.rel + " is listed as refs-free (" + REFS_FREE[f.rel] + ") and now touches " +
      "the table. A stale exemption is how a population guard stops covering a file that grew " +
      "into its subject: remove the row rather than keeping a permission nobody re-checks",
      { reads: [...f.reads], writes: [...f.writes] });
  }
  if (f.rel === "ui/base.js") {
    ok(/const refs = \{\}/.test(fs.readFileSync(path.join(ROOT, f.rel), "utf8")),
      "APPLIED — ui/base.js must actually declare `refs`. If the declaration moved again, this " +
      "guard is scanning a population whose shared table lives somewhere it has not been told about");
  }
  if (REFS_FREE[f.rel]) continue;
  ok(f.reads.size > 0 || f.writes.size > 0,
    "APPLIED — " + f.rel + " contributed no refs at all. Either it genuinely touches none, in " +
    "which case say so here, or it was not read and the union above is short by a whole file",
    f.rel);
}
// THE CONTROL FOR THE `ChatPrefs` COLLISION. If the lookbehind ever regresses, these appear as
// reads and the guard turns into noise — so the scan asserts it is NOT seeing them.
for (const decoy of ["load", "onChange", "layout", "classifyOpts"]) {
  ok(!reads.has(decoy),
    "control: `" + decoy + "` is a `ChatPrefs.` member, not a ref. Seeing it here means the " +
    "scan is matching the tail of `ChatPrefs.` and every result is suspect", [...reads].slice(0, 5));
}

// ── THE TOTAL PROPERTY, OVER THE LAYER ───────────────────────────────────────────────────────
const orphans = [...reads].filter((r) => !writes.has(r)).sort();
ok(orphans.length === 0,
  "EVERY `refs.X` READ ANYWHERE IN ui/ NAMES A REF THAT IS ASSIGNED SOMEWHERE IN ui/. An orphan " +
  "is not a style problem — it is `undefined.appendChild` the moment that line runs, and because " +
  "the UI's render calls are chained without a try, one orphan takes out every call after it in " +
  "the same function. `refs.settingsBody` was exactly this: one read, zero assignments, seven " +
  "downstream calls skipped, and three separate bug reports from one line", orphans);

// ── WHAT THE WIDENING BOUGHT, REPORTED RATHER THAN GATED ─────────────────────────────────────
// The refs whose read and assignment are in DIFFERENT files. These are the cases a per-file scan
// would call orphans, so the list is printed: it is how a reader sees that this guard is a union
// and not a per-file loop wearing one. It is deliberately NOT asserted non-empty — a later
// cluster could legitimately land both halves of every ref in one file, and a floor here would
// fail honest work exactly the way the one in the header warns about.
const crossFile = [...reads].filter((r) => {
  const rIn = perFile.filter((f) => f.reads.has(r)).map((f) => f.rel);
  const wIn = perFile.filter((f) => f.writes.has(r)).map((f) => f.rel);
  return wIn.length > 0 && rIn.some((x) => !wIn.includes(x));
}).sort();

console.log("[ui-refs] PASS — every `refs.X` read anywhere in ui/ names a ref assigned somewhere " +
  "in ui/, over " + UI_FILES.length + " files and " + reads.size + " distinct refs (" + asserts +
  " assertions). WIDENED FROM ONE FILE TO THE POPULATION at ddjp_386, in the same change as the " +
  "first cluster left, because a per-file scan stops being TOTAL the moment `refs` is shared and " +
  "stops quietly — reads and assignments shrink together. " +
  (crossFile.length
    ? "Refs whose read and assignment are now in different files, which a per-file scan would " +
      "report as orphans: " + crossFile.join(", ") + ". "
    : "No ref currently spans two files, so this run would also have passed per-file — the union " +
      "is still the property, and that is a fact about today's file boundaries rather than a " +
      "reason to narrow the scan. ") +
  "THIS GUARD EXISTS BECAUSE A BROWSER FOUND WHAT 133 GUARDS COULD NOT: " +
  "`refs.settingsBody` appeared ONCE in `ui/interface.js`, was never assigned, and threw — " +
  "skipping `renderLogs`, `ChatPrefs.load`, `_setLayout`, `_applyDisplayDims`, " +
  "`renderChatSettings` and `_renderGear`, which is three reported bugs and one unusable room " +
  "from a single character. THE FAKE `el()` DID NOT HIDE IT — reading a property off `undefined` " +
  "throws in the harness too, driven. What hid it is that NOTHING CALLS THESE FUNCTIONS: five of " +
  "forty `render*` declarations are executed by any guard and thirty-five are executed by none, " +
  "including the newest panel code. Executing all forty is a larger job; this takes the cheap " +
  "TOTAL property instead, which covers the thirty-five nothing else reaches. The scan carries " +
  "its own control, because `ChatPrefs` ends in `refs` and a careless pattern reports 34 false " +
  "orphans");
