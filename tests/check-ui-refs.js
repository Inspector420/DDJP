// tests/check-ui-refs.js
// WALL: EVERY `refs.X` THE UI READS IS A REF THE UI ASSIGNS.
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
const UI_FILES = ["ui/interface.js"];

// `(?<![\w.])` matters: without it `ChatPrefs.load` matches as `refs.load`, because `ChatPrefs`
// ENDS IN `refs`. The first version of this scan reported 34 false orphans for exactly that
// reason — a reminder that a scan is a measurement and needs its own control.
const READ = /(?<![\w.])refs\.([A-Za-z_]\w*)/g;
const WRITE = /(?<![\w.])refs\.([A-Za-z_]\w*)\s*=[^=]/g;

for (const rel of UI_FILES) {
  // COMMENTS ARE STRIPPED, AND THIS GUARD CAUGHT ITSELF NEEDING IT ON ITS FIRST RUN: the comment
  // written above the FIXED line names `refs.settingsBody` while explaining that it must not be
  // used, and the scan reported it as a live orphan. **A scan that matches commentary is testing
  // prose, not code** — the project's own rule that a guard asserts against code and never against
  // a file's description of itself, arriving from the direction where the description is a warning
  // about the very thing being scanned for.
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const reads = new Set([...src.matchAll(READ)].map((m) => m[1]));
  const writes = new Set([...src.matchAll(WRITE)].map((m) => m[1]));

  ok(reads.size > 50,
    "APPLIED — the scan must find a substantial number of refs in " + rel + ", or an empty " +
    "orphan list below means the regex missed rather than that the file is clean", reads.size);
  ok(writes.size > 50,
    "APPLIED — and a substantial number of assignments, or every read looks like an orphan",
    writes.size);
  // THE CONTROL FOR THE `ChatPrefs` COLLISION. If the lookbehind ever regresses, these appear as
  // reads and the guard turns into noise — so the scan asserts it is NOT seeing them.
  for (const decoy of ["load", "onChange", "layout", "classifyOpts"]) {
    ok(!reads.has(decoy),
      "control: `" + decoy + "` is a `ChatPrefs.` member, not a ref. Seeing it here means the " +
      "scan is matching the tail of `ChatPrefs.` and every result is suspect", [...reads].slice(0, 5));
  }

  const orphans = [...reads].filter((r) => !writes.has(r)).sort();
  ok(orphans.length === 0,
    "EVERY `refs.X` READ IN " + rel + " NAMES A REF THAT IS ASSIGNED. An orphan is not a style " +
    "problem — it is `undefined.appendChild` the moment that line runs, and because the UI's " +
    "render calls are chained without a try, one orphan takes out every call after it in the " +
    "same function. `refs.settingsBody` was exactly this: one read, zero assignments, seven " +
    "downstream calls skipped, and three separate bug reports from one line", orphans);
}

console.log("[ui-refs] PASS — every `refs.X` the UI reads is a ref the UI assigns (" + asserts +
  " assertions). THIS GUARD EXISTS BECAUSE A BROWSER FOUND WHAT 133 GUARDS COULD NOT: " +
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
