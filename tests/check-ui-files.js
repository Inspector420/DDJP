// tests/check-ui-files.js
// SUBJECT: ui/, index.html, tests/_load.js, docs/roles.md
// WALL: THE ui/ FILE LIST IS THE DECISION'S LIST, AND EVERY FILE ON IT IS WIRED THREE WAYS.
//
// ── WHY THIS EXISTS: THE SPLIT MULTIPLIES ONE KNOWN FAILURE BY THE NUMBER OF NEW FILES ───────
// `features/botsettings.js` once shipped missing from `index.html`'s script list. It was driven
// happily by every sandbox — the harness loads modules by path, not through the page — and it was
// `undefined` in the browser. No guard caught it. The same omission is available once per file
// this split creates, and the split creates nine of them.
//
// Three wirings, and a file needs ALL THREE or it is not reachable from a running client:
//   · it EXISTS, and the ten-file decision in roles.md §5 names it (or it is an exception, below)
//   · it has a `<script>` tag in `index.html`               — or it is undefined in the browser
//   · its global is in `tests/_load.js`'s KNOWN_GLOBALS      — or every guard reads `undefined.x`
//
// ── THE LIST IS DERIVED FROM THE DECISION, NEVER RESTATED HERE ────────────────────────────────
// A hand-written list of ten files in this guard would be a second copy of the decision, free to
// drift from it — and it would drift in the direction that matters, because the copy nobody
// consults is the one that goes stale. roles.md §5 is the decision; this reads it. If the table
// and this guard disagree, the table is what a person edits and this is what fails.
//
// ── AND IT PINS THE COUNT AT TEN, WHICH IS THE POINT ─────────────────────────────────────────
// Ten is a ruling, not an outcome. The clusters are grouped by shared `refs` entries and DOM
// ownership; splitting `THUMBNAIL PIPELINE` out of `ui/playlists.js` or `MISCLICK LOCKS` out of
// `ui/shell.js` is LOCALLY DEFENSIBLE and walks the count to twenty-three. A guard that merely
// checked "every ui/ file is wired" would be satisfied by twenty-three wired files. This one
// fails on a count that has drifted, so the argument has to be had with the decision rather than
// won one defensible file at a time.
//
// ── WHAT THIS GUARD DOES NOT DO ──────────────────────────────────────────────────────────────
// It is structural, deliberately. It proves a file is REACHABLE from a running client; it proves
// nothing about whether anything in it is correct, and nothing about whether the page renders.
// No headless check in this tree loads `index.html`. The browser is still the instrument.

const fs = require("fs");
const path = require("path");

let asserts = 0;
const failures = [];
function fail(msg, got) {
  failures.push(msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const { docPaths, searchedFor } = require("./_docs.js");   // one resolver, never a literal docs_NNN

// ── the population, read from disk ──────────────────────────────────────────────────────────
const UI_DIR = path.join(ROOT, "ui");
const ON_DISK = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort();
ok(ON_DISK.length > 0, "APPLIED — ui/ scanned to nothing, so every assertion below is free", ON_DISK);

// ── the decision, read from roles.md §5 ─────────────────────────────────────────────────────
const ROLES_REL = "roles.md";
const rolesPath = docPaths(ROLES_REL).find((p) => fs.existsSync(p)) || null;
ok(!!rolesPath,
  "APPLIED — " + ROLES_REL + " must be readable in the docs tree; the DECISION is the subject of " +
  "this guard, so its absence is a broken package rather than a reason to pass. " +
  searchedFor(ROLES_REL), docPaths(ROLES_REL));
const roles = rolesPath ? fs.readFileSync(rolesPath, "utf8") : "";

// The table rows, not a prose mention: a row is `| \`ui/x.js\` | contents | ~lines |`.
const DECIDED = [...roles.matchAll(/^\|\s*`ui\/([\w.-]+\.js)`\s*\|/gm)].map((m) => m[1]).sort();
ok(DECIDED.length === 10,
  "APPLIED — roles.md §5's table must hold exactly TEN rows, and it holds " + DECIDED.length + ". " +
  "Ten is the ruling: the clusters are grouped by shared `refs` entries and DOM ownership, and " +
  "peeling a defensible subsystem off one of them walks the count to twenty-three. If the count " +
  "has genuinely been re-decided, this number moves WITH the table and the entry says why — a " +
  "count that drifts silently is the decision being lost one reasonable edit at a time", DECIDED);

ok(!DECIDED.includes("interface.js"),
  "roles.md \u00a75's table must NOT hold a row for `ui/interface.js`. It is the RESIDUE, not one " +
  "of the ten, and it ceases to exist when the last cluster leaves. A row for it would make the " +
  "count eleven and would say the decision changed — asserted here rather than discovered during " +
  "the final cut", DECIDED);

ok(new Set(DECIDED).size === DECIDED.length,
  "APPLIED — a file may hold at most ONE row. Two rows for one file is two contents columns for " +
  "one destination, and a later reader has no way to tell which is the decision", DECIDED);

// ── THE MEMBERSHIP COLUMN, PINNED AGAINST THE LIVE SECTIONS ─────────────────────────────────
// Every `══` banner that exists anywhere in ui/ must be named by EXACTLY ONE row's contents.
// Unassigned is the bug this catches: `THE USER CARD`, `THE DM PANEL`, `THE TIER STRIP` and
// `DELETING A MESSAGE` sat in roles.md's section list and in no file's contents column at all,
// and the question of where they go was answerable only by whoever typed first. Double-assigned
// is the other half — two files claiming one section is two destinations for one extraction
// anchor, which is how a guard ends up pointed at a file its subject is not in.
//
// THE FLOOR IS DENOMINATED IN THE POPULATION, NOT IN ui/interface.js. A count of banners in that
// one file is a number this job exists to REDUCE — every cluster that leaves makes it smaller, so
// a floor on it would eventually fail honest work. The total across ui/ does not move when a
// cluster relocates: the same sections, in different files.
const uiJs = fs.readdirSync(path.join(ROOT, "ui")).filter((f) => f.endsWith(".js")).sort();
const NORM = (t) => t.replace(/\s*\(J\d+\)\s*$/, "").replace(/\s+/g, " ").trim().toUpperCase();
const SECTIONS = [];
for (const f of uiJs) {
  const src = fs.readFileSync(path.join(ROOT, "ui", f), "utf8");
  for (const m of src.matchAll(/^\s*\/\/\s*══\s*(.+?)\s*═*\s*$/gm)) SECTIONS.push({ name: NORM(m[1]), file: f });
}
ok(SECTIONS.length >= 20,
  "APPLIED — the scan must find the ui/ section banners across the population, or every " +
  "assignment check below is a check on an empty list", SECTIONS.length);

// contents cell = the SECOND column of a row, and only the backticked UPPER-CASE tokens in it
// are section names; `refs` and `_bgLeaveRoom` are named declarations, not sections.
const ROW = /^\|\s*`ui\/([\w.-]+\.js)`\s*\|([^|]*)\|/gm;
const claims = new Map();          // section -> [files claiming it]
for (const m of roles.matchAll(ROW)) {
  for (const t of m[2].matchAll(/`([^`]+)`/g)) {
    const name = NORM(t[1]);
    if (!/^[A-Z][A-Z0-9 ,'\/-]*$/.test(name)) continue;   // skip `refs`, `_bgLeaveRoom`
    if (!claims.has(name)) claims.set(name, []);
    claims.get(name).push(m[1]);
  }
}
ok(claims.size >= 20,
  "APPLIED — the contents columns must name sections, or 'assigned to exactly one row' is " +
  "satisfied by a table that assigns nothing", claims.size);

const unassigned = [...new Set(SECTIONS.map((x) => x.name))]
  .filter((n) => ![...claims.keys()].some((c) => c === n || n.startsWith(c) || c.startsWith(n)))
  .sort();
ok(unassigned.length === 0,
  "EVERY SECTION IN ui/ IS ASSIGNED TO EXACTLY ONE FILE BY roles.md §5. These are assigned to " +
  "none, so where they go is decided by whoever types first — which is how four sections " +
  "(`THE USER CARD`, `THE DM PANEL`, `THE TIER STRIP`, `DELETING A MESSAGE`) reached cluster 5 " +
  "with no declared destination and four guard anchors with nowhere to point", unassigned);

const doubled = [...claims.entries()].filter(([, fs2]) => new Set(fs2).size > 1)
  .map(([n, fs2]) => n + " -> " + [...new Set(fs2)].join(" & ")).sort();
ok(doubled.length === 0,
  "AND TO EXACTLY ONE. A section claimed by two files is two destinations for one extraction " +
  "anchor, and the cut that happens second silently wins", doubled);

// ── files on disk that the decision does not name ───────────────────────────────────────────
// Each exception carries its reason. A bare allowance would let the next unplanned file in.
const EXCEPTIONS = {
  // `interface.js` HAD an exception here — "the file BEING split", wired like any other ui/ file
  // until the last cluster left. It left at ddjp_397 and the file no longer exists, so the
  // exception is REMOVED rather than kept: an exemption for something that is not there is the
  // 52nd signature waiting to happen, and this list is short enough that a dead row in it is a
  // claim a reader would believe.
  "chatbuffer.js":
    "predates the split and is not part of it: the RAM message buffer, already its own module " +
    "with its own global, and roles.md §5 describes it separately from the ten.",
};
for (const f of ON_DISK) {
  ok(DECIDED.includes(f) || EXCEPTIONS[f],
    "`ui/" + f + "` exists and the ten-file decision does not name it. A new ui/ file is either " +
    "part of the decision — add the row to roles.md §5 and argue the grouping — or an exception " +
    "with a written reason in this guard. What it must not be is present and unaccounted for: " +
    "that is how a ten-file split becomes twenty-three, one locally defensible file at a time", f);
}
// and the exception list stays honest in the other direction
for (const f of Object.keys(EXCEPTIONS)) {
  ok(ON_DISK.includes(f),
    "`ui/" + f + "` is excepted here and no longer exists. Delete the row: an exception that " +
    "outlives its file is how a list of two becomes a list of twenty", f);
}

// ── the decision's files that have not been extracted yet ───────────────────────────────────
// REPORTED, NOT FAILED. The split is one cluster per package by ruling, so most of the ten are
// legitimately absent. What is asserted is that whatever DOES exist is wired.
const PENDING = DECIDED.filter((f) => !ON_DISK.includes(f));

// ── wiring 1 — a `<script>` tag in index.html ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// THE CONTROL FOR THE TAG MATCHER NAMED `ui/interface.js`, which ceased to exist at ddjp_397.
// Its job is to prove the regex below recognises a real tag before every per-file assertion is
// trusted — so it has to name a file that is THERE. `ui/base.js` is the one that cannot leave:
// it holds `refs` and every other ui/ file binds it at load.
ok(/<script src="ui\/base\.js\?v=\d+"><\/script>/.test(html),
  "APPLIED — index.html must carry a ui/ script tag in the form this guard matches, or every " +
  "tag assertion below passes by failing to recognise any tag at all");
for (const f of ON_DISK) {
  ok(new RegExp('<script src="ui/' + f.replace(/\./g, "\\.") + '\\?v=\\d+"></script>').test(html),
    "`ui/" + f + "` has no `<script>` tag in index.html. It is driven happily by every guard in " +
    "this suite — the harness loads by path, not through the page — and it is `undefined` in a " +
    "browser. `features/botsettings.js` shipped exactly this way and no guard caught it", f);
}

// ── wiring 2 — a KNOWN_GLOBALS entry for the global each file declares ──────────────────────
// The global is DERIVED from the file's own declaration rather than mapped here, because a
// filename-to-global table is the second copy this guard exists to avoid.
const loadSrc = fs.readFileSync(path.join(ROOT, "tests", "_load.js"), "utf8");
const { knownGlobals } = require("../tools/lint-globals.js");
const GLOBALS = knownGlobals();
ok(GLOBALS.length > 20,
  "APPLIED — KNOWN_GLOBALS parsed to " + GLOBALS.length + " names; below 20 means the reader " +
  "missed the list and every membership test below is meaningless", GLOBALS.length);
ok(loadSrc.indexOf("const KNOWN_GLOBALS = [") >= 0,
  "APPLIED — KNOWN_GLOBALS must be where the shared reader expects it");

for (const f of ON_DISK) {
  const src = fs.readFileSync(path.join(UI_DIR, f), "utf8");
  // EVERY global the file declares, not just the first. `exec` stopped at the first match, which
  // is fine while each ui/ file declares exactly one — and the LAST cut breaks that: `ui/base.js`
  // takes the `EXPORTS` section, so it will declare `UIBase` AND `Interface`. With `exec`, the
  // second would go unchecked and a missing KNOWN_GLOBALS entry for it would be invisible — the
  // `features/botsettings.js` shape, arriving through a guard that looked like it covered this.
  // Widened BEFORE the cut that needs it rather than after it goes wrong.
  const all = [...src.matchAll(/^const ([A-Za-z_]\w*) = \(\(\) =>/gm)].map((x) => x[1]);
  const m = all.length ? [null, all[0]] : null;
  ok(!!m,
    "`ui/" + f + "` declares no top-level `const X = (() => {…})()` global. Every ui/ file is a " +
    "script-tag global — that is how the page loads them — so one without a declaration cannot " +
    "be reached from another file or exposed to the harness", f);
  if (!m) continue;
  for (const g of all.slice(1)) {
    ok(GLOBALS.includes(g),
      "`ui/" + f + "` declares a SECOND global `" + g + "` that KNOWN_GLOBALS does not name. A " +
      "file may declare more than one — ui/base.js will — but every one of them needs its entry, " +
      "or it is `undefined` in the browser exactly like the first would be", GLOBALS);
  }
  ok(GLOBALS.includes(m[1]),
    "`ui/" + f + "` declares `" + m[1] + "` and KNOWN_GLOBALS does not name it. The exposer " +
    "swallows a ReferenceError per name on purpose, so the omission is SILENT: the sandbox comes " +
    "back without it and the caller reads `undefined.something` a long way from the cause. This " +
    "is J18's `BotSettings` in a guard whose own module list was correct", { file: f, global: m[1] });
}

// ── wiring 3 — the interim primitive seam is fully published ─────────────────────────────────
// ui/base.js carries a `host` object that ui/interface.js fills and the extracted clusters read.
// A key read but never published is the characteristic defect of this tree: a correct module
// reached by nothing, passing every unit guard. So the two sides are COMPARED rather than each
// asserted to be non-empty — a guard whose message says two things must agree has to compare them.
{
  const baseSrc = fs.existsSync(path.join(UI_DIR, "base.js"))
    ? fs.readFileSync(path.join(UI_DIR, "base.js"), "utf8") : "";
  if (baseSrc) {
    // WHO PUBLISHES IS NOT ONE FILE ANY MORE. This named `ui/interface.js` as the sole publisher,
    // which was true while the residue existed — at ddjp_397 it ceased to, and the check crashed
    // on a missing file rather than reporting anything. The question was always "does ANYTHING
    // publish", and it is asked of the population: `ui/base.js` publishes the primitives it now
    // owns and `ui/shell.js` publishes its own state accessors.
    const publishers = ON_DISK.filter((f) =>
      /UIBase\.publish\(\{|\n  publish\(\{/.test(fs.readFileSync(path.join(UI_DIR, f), "utf8")));
    ok(publishers.length > 0,
      "ui/base.js offers a `host` seam and NOTHING in ui/ publishes into it. The extracted clusters " +
      "read primitives from there, so an unpublished host is every one of them reading `undefined`",
      publishers);
    const published = new Set();
    for (const f of ON_DISK) {
      const src = fs.readFileSync(path.join(UI_DIR, f), "utf8");
      for (const pub of src.matchAll(/(?:UIBase\.)?publish\(\{([\s\S]*?)\}\);/g))
      for (const mm of pub[1].matchAll(/(?:^|[\s,{])([A-Za-z_]\w*)\s*(?:,|:|$)/gm)) published.add(mm[1]);
    }
    ok(published.size > 0,
      "APPLIED — no published host keys were parsed, so the comparison below exempts everything",
      [...published]);
    const read = new Set();
    for (const f of ON_DISK) {
      const src = fs.readFileSync(path.join(UI_DIR, f), "utf8")
        .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      if (!/const H = UIBase\.host/.test(src)) continue;
      for (const mm of src.matchAll(/(?<![\w$.])H\.([A-Za-z_]\w*)/g)) read.add(mm[1]);
    }
    ok(read.size > 0,
      "APPLIED — no host READS were found in any ui/ file. Either no cluster uses the seam yet, " +
      "in which case the seam is dead and should go, or this scan missed them and the totality " +
      "below is a comparison of two empty sets", [...read]);
    const unpublished = [...read].filter((k) => !published.has(k)).sort();
    ok(unpublished.length === 0,
      "a ui/ file reads `UIBase.host` keys that nothing publishes: " + unpublished.join(", ") +
      ". That is `undefined` at the moment the line runs, and it is the shape this tree produces " +
      "most often — a correct module reached by nothing, green in every unit guard", unpublished);
  }
}

// ── the gate, below every part ──────────────────────────────────────────────────────────────
if (failures.length) {
  console.log("[ui-files] FAIL — " + failures.length + " wiring/decision problem(s) in ui/:");
  for (const f of failures) console.log("  \u2717 " + f);
  process.exit(1);
}

console.log("[ui-files] PASS — the ui/ file list AND ITS MEMBERSHIP are the decision's, every "
  + "section in ui/ is assigned to exactly one file, and every file on it is " +
  "reachable from a running client: " + ON_DISK.length + " files on disk, all named by roles.md §5's " +
  "ten-row table or excepted with a reason (" + Object.keys(EXCEPTIONS).join(", ") + "), all with a " +
  "`<script>` tag in index.html, and each declaring a global that KNOWN_GLOBALS names — derived " +
  "from the file's own declaration, never mapped here. The count is PINNED AT TEN because ten is a " +
  "ruling and not an outcome: peeling THUMBNAIL PIPELINE off ui/playlists.js or MISCLICK LOCKS off " +
  "ui/shell.js is locally defensible and walks it to twenty-three, so the argument has to be had " +
  "with the table rather than won one file at a time. " +
  (PENDING.length
    ? PENDING.length + " of the ten are not extracted yet (" + PENDING.join(", ") + ") — one " +
      "cluster per package by ruling, so that is the plan running rather than a gap. "
    : "All ten exist. ") +
  "The interim `UIBase.host` seam is compared rather than described: every key an extracted " +
  "cluster reads is a key something publishes. THIS GUARD IS STRUCTURAL AND PROVES NOTHING " +
  "RENDERS — nothing headless here loads index.html, and ten of ten original defects came from a " +
  "person at a screen (" + asserts + " assertions)");
process.exit(0);
