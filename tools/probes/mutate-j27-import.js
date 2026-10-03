// tools/probes/mutate-j27-import.js
//
// Break each rule check-import.js claims to lock, and watch it go red. A guard that has never
// failed is a guard nobody has checked, and the likeliest place for a decorative assertion is the
// guard written minutes ago (paths.md §9.12).
//
// EVERY MUTATION HERE IS EXPECTED TO PRODUCE A CHANGE, which is the direction that announces its
// own failure to apply. `_journal.open().apply()` refuses an anchor matching nothing or matching
// more often than stated, and `stillApplied()` is checked AFTER the guard has read the file,
// because before-only is sufficient when one hand holds the tree and worthless when two do — under
// collision a green mutation is VOID, not a survivor.
//
// RED BY CRASH IS NOT RED ENOUGH: each row records the assertion text that fired, so a mutation
// that kills a guard by throwing before its own assertion is visible as such.
//
// M2 IS AIMED AT A DIFFERENT GUARD ON PURPOSE. J27 corrected `importable`, which is
// check-export's claim rather than check-import's, so the row runs the guard that owns the rule.
// A mutation pass that only ever runs the guard written this session cannot see a rule it moved.
//
// Run: node tools/probes/mutate-j27-import.js   (from the tree root)

const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const journal = require("./_journal.js");

const STREAM = path.join(ROOT, "backends/backend1/streammanager.js");
const CP = path.join(ROOT, "backends/backend1/checkpoint.js");
const ROOMJS = path.join(ROOT, "features/room.js");
const APP = path.join(ROOT, "app.js");

// ── recover anything a previous run left behind, BEFORE reading a single byte ─────────────────
{
  const rep = journal.recover();
  if (rep.restored.length) {
    console.log("journal: restored " + rep.restored.length + " file(s) left dirty by a previous run:");
    for (const r of rep.restored) console.log("   " + r.file + "  (" + r.probe + ")");
  } else if (rep.clean) {
    console.log("journal: clean — no previous run left the tree mutated.");
  }
  for (const s of rep.skipped) console.log("journal: LEFT ALONE — " + s.file + ": " + s.why);
}

function runGuard(rel) {
  try {
    execFileSync("node", [path.join(ROOT, rel)], { cwd: ROOT, stdio: "pipe" });
    return { red: false, msg: null };
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    let msg = null;
    const named = out.match(/AssertionError[^:]*:\s*([\s\S]{10,400}?)(?:\n\s*at\s|\n\s*\{)/);
    if (named) msg = named[1].trim();
    else if (/AssertionError/.test(out)) msg = "(assertion fired, message not captured)";
    else msg = "CRASH: " + out.split("\n").filter(Boolean).slice(-1)[0];
    return { red: true, msg: msg, crash: !/AssertionError/.test(out) };
  }
}

const rows = [];
function mutate(id, file, find, replaceWith, expect, marker, what, guard) {
  const g = guard || "tests/check-import.js";
  const h = journal.open("mutate-j27-import:" + id, file);
  let applied = 0;
  try {
    applied = h.apply(find, replaceWith, expect);
    const res = runGuard(g);
    const still = h.stillApplied(marker);
    rows.push({ id, what, guard: g, applied, still, red: res.red, crash: !!res.crash, msg: res.msg });
  } finally {
    h.restore();
  }
}

console.log("\nJ27 — mutation pass over check-import.js (and check-export.js for M2)\n" + "=".repeat(78));

// M1 — the import-specific refusal is dropped, so a peer file is told `chain-refused`: true, and
// unactionable. This is the row that locks the ORDERING rule, not merely a string.
mutate("M1", STREAM,
  "        if (!declaredOwner && (read.reason === \"chain-too-short\" || read.reason === \"chain-refused\")) {",
  "        if (false) {   /*MUT_M1*/",
  1, "MUT_M1",
  "a peer file is refused with the chain answer an operator cannot act on");

// M2 — `importable` back to what J26 shipped: the exporter's question, asked of the importer.
mutate("M2", STREAM,
  "        importable: ownerAuthored,",
  "        importable: ownerAuthored || chain.length >= 2,   /*MUT_M2*/",
  1, "MUT_M2",
  "the control promises a peer file can start a room, which J27 measured it cannot",
  "tests/check-export.js");

// M3 — the settings pointer is not re-anchored: the imported room names an event in a room it
// cannot read, so its rules can never be proved.
mutate("M3", CP,
  "    const s = Object.assign({}, seed, { settings: merged, settingsFrom: a.settingsFrom });",
  "    const s = Object.assign({}, seed, { settings: merged });   /*MUT_M3*/",
  1, "MUT_M3",
  "settingsFrom keeps the exporting room's pointer, naming an event nobody here can read");

// M4 — the defaults merge is dropped, so a file predating a settings key seals a partial blob and
// the room answers `unverifiable` for ever. The fixture for this had to be built deliberately: a
// seed folded by this build is already complete, so the mutation is invisible without one.
mutate("M4", CP,
  "    const merged = Object.assign(StateDeriver.defaultSettings(), seed.settings || {});",
  "    const merged = Object.assign({}, seed.settings || {});   /*MUT_M4*/",
  1, "MUT_M4",
  "an older file seals an INCOMPLETE settings blob, which is unverifiable for the room's life");

// M5 — the imported checkpoint keeps the file's counter and predecessor, importing a chain that
// does not continue here.
mutate("M5", CP,
  "    const n = 1, prev = null, thin = true;",
  "    const n = seed.__n || 1, prev = null, thin = false;   /*MUT_M5*/",
  1, "MUT_M5",
  "`thin` is published as false, so the author's statement about HOW it computed is wrong");

// M6 — the publish half is disconnected: buildImport still returns a correct object and nothing
// sends it. THE MODULE-VERSUS-WIRING MUTATION (P1), which is the one this tree keeps paying for.
mutate("M6", CP,
  "      await _env.send(TYPE, built.cp);",
  "      /*MUT_M6 await _env.send(TYPE, built.cp);*/",
  1, "MUT_M6",
  "nothing is sent — a correct builder reached by no wire, this project's signature failure");

// M7 — the feature layer creates the room BEFORE reading the file, so an unreadable file leaves
// twenty-one rate-limited rooms behind. ITS FIRST VERSION WAS A PLACEBO and is recorded rather
// than quietly replaced: it annotated the create call without moving it, so it changed nothing and
// SURVIVED — a mutation whose expected result is "nothing changes" cannot detect its own failure
// to express the rule. The anchor now actually reorders.
mutate("M7", ROOMJS,
  "  async function createFromFile(name, file) {\n    const read = StreamManager.importFile",
  "  async function createFromFile(name, file) {\n    const early = await create(name); void early;   /*MUT_M7*/\n    const read = StreamManager.importFile",
  1, "MUT_M7",
  "the room is built BEFORE the file is read, so a refusal leaves a real half-purpose room");

// M8 — the create screen stops listening: the seam exists and no person can reach it.
mutate("M8", APP,
  "  if (importBtn) importBtn.addEventListener(\"click\", async () => {",
  "  if (false) importBtn.addEventListener(\"click\", async () => {   /*MUT_M8*/",
  1, "MUT_M8",
  "the button is never subscribed, so the whole import path is unreachable by a person");

// M9 — the subject of a multi-snapshot file becomes the OLDEST cut, restoring the room to an
// earlier moment with nothing saying so.
mutate("M9", STREAM,
  "      const subject = placeable.slice().sort((a, b) => a.floorL - b.floorL).pop();",
  "      const subject = placeable.slice().sort((a, b) => a.floorL - b.floorL).shift();   /*MUT_M9*/",
  1, "MUT_M9",
  "the file's OLDEST cut is seeded instead of its newest");

// M10 — the UI starts deciding about the file, which is the drift rule H and P7 both cover, in the
// one layer nothing in this suite executes.
mutate("M10", APP,
  "    let parsed;",
  "    let parsed; const keyset = 1; void keyset;   /*MUT_M10*/",
  1, "MUT_M10",
  "app.js acquires a verdict about the file's keyset — a second home, above the seam");

// ── report ────────────────────────────────────────────────────────────────────────────────────
console.log("");
let kills = 0, survivors = 0, crashes = 0, voids = 0;
for (const r of rows) {
  if (!r.still) {
    voids++;
    console.log("  " + r.id + " · VOID — not still applied when the guard read the file. Discarded.");
    continue;
  }
  if (r.red && !r.crash) kills++;
  if (r.red && r.crash) crashes++;
  if (!r.red) survivors++;
  console.log("  " + r.id + " · " + r.what);
  console.log("        [" + r.guard.replace("tests/check-", "").replace(".js", "") + "] applied "
    + r.applied + "× · "
    + (r.red ? (r.crash ? "RED BY CRASH — not red enough" : "RED") : "SURVIVED — NOT enforced"));
  if (r.msg) console.log("        ↳ " + r.msg.replace(/\s+/g, " ").slice(0, 190));
}

console.log("\n" + "=".repeat(78));
console.log(rows.length + " mutations · " + kills + " red · " + survivors + " survivors · "
  + crashes + " red-by-crash · " + voids + " void");
if (survivors) {
  console.log("A SURVIVOR IS NOT AUTOMATICALLY A GAP. Suspect the FIXTURE first, and then ask "
    + "whether the rule is enforced somewhere you were not looking.");
}

// Final proof the tree is back as it was — the journal's own restore, re-read from disk.
const { execFileSync: ex2 } = require("child_process");
try {
  ex2("node", [path.join(ROOT, "tests/run-all.js")], { cwd: ROOT, stdio: "pipe" });
  console.log("tree restored: the full suite is green again after the pass.");
} catch (e) {
  console.log("!! THE TREE IS NOT CLEAN — the suite is red after the pass. Do not trust any row "
    + "above; restore from the package and re-run.");
}
