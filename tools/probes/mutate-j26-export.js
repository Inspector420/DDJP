// tools/probes/mutate-j26-export.js
//
// Break each rule check-export.js claims to lock, and watch it go red. A guard that has never
// failed is a guard nobody has checked, and the likeliest place for a decorative assertion is the
// guard written minutes ago (paths.md §9.12).
//
// EVERY MUTATION HERE IS EXPECTED TO PRODUCE A CHANGE, which is the direction that announces its
// own failure to apply. `_journal.open().apply()` additionally refuses an anchor that matches
// nothing or matches more often than stated — `sed` and `replace` both report success on matching
// nothing — and `stillApplied()` is checked AFTER the guard has read the file, because a
// before-only assertion is worthless when two hands hold the tree.
//
// RED BY CRASH IS NOT RED ENOUGH. Each row records the assertion message that fired, so a
// mutation that kills the guard by throwing somewhere before its own assertion is visible as such
// rather than counted as a kill.
//
// AND ONE RED LINE NAMES THE FIRST ASSERTION TO FIRE, NOT THE ONLY ONE THAT WOULD HAVE. This guard
// uses assert.ok, so it stops at the first failure. Where a row's reported assertion belongs to an
// earlier PART than the rule under test, that is ordering rather than attribution and is noted.
//
// Run: node tools/probes/mutate-j26-export.js   (from the tree root)

const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const journal = require("./_journal.js");

const FLOOR = path.join(ROOT, "backends/backend1/floor.js");
const STREAM = path.join(ROOT, "backends/backend1/streammanager.js");
const ROOMJS = path.join(ROOT, "features/room.js");
const UI = path.join(ROOT, "ui/interface.js");

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

function runGuard() {
  try {
    execFileSync("node", [path.join(ROOT, "tests/check-export.js")], { cwd: ROOT, stdio: "pipe" });
    return { red: false, msg: null };
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    let msg = null;
    // The assertion TEXT is what attributes a red, so it is extracted rather than reported as
    // "something failed". assert.ok(false, m) throws an AssertionError whose message is m.
    const named = out.match(/AssertionError[^:]*:\s*([\s\S]{10,400}?)(?:\n\s*at\s|\n\s*\{)/);
    if (named) msg = named[1].trim();
    else if (/AssertionError/.test(out)) msg = "(assertion fired, message not captured)";
    else msg = "CRASH: " + out.split("\n").filter(Boolean).slice(-1)[0];
    return { red: true, msg: msg, crash: !/AssertionError/.test(out) };
  }
}

const rows = [];
function mutate(id, file, find, replaceWith, expect, marker, what) {
  const h = journal.open("mutate-j26-export:" + id, file);
  let applied = 0;
  try {
    applied = h.apply(find, replaceWith, expect);
    const res = runGuard();
    // THE SECOND HALF OF "assert the edit applied": is it STILL applied now that the guard has
    // read the file? Before-only is sufficient when one hand holds the tree and worthless when two
    // do — a concurrent sweep restoring the file underneath produces a green for a mutation the
    // tree never held, and under collision a green mutation is VOID rather than a survivor.
    const still = h.stillApplied(marker);
    rows.push({ id, what, applied, still, red: res.red, crash: !!res.crash, msg: res.msg });
  } finally {
    h.restore();
  }
}

console.log("\nJ26 — mutation pass over check-export.js\n" + "=".repeat(78));

// M1 — the copy rule. Hand out the live array instead of copies.
mutate("M1", FLOOR,
  "return _seen.map((e) => Object.assign({}, e));",
  "return _seen;   /*MUT_M1*/",
  1, "MUT_M1",
  "Floor.heldCheckpoints hands out its LIVE array — a renderer could reorder the search space");

// M2 — rank leaves as a NUMBER rather than a name.
mutate("M2", STREAM,
  "rank: (typeof Ranks !== \"undefined\" && Ranks.nameOf) ? Ranks.nameOf(e.r) : null,",
  "rank: e.r,   /*MUT_M2*/",
  1, "MUT_M2",
  "the power LEVEL leaves the backend, making the picker's grouping a numeric rank comparison");

// M3 — the P2 mutation: fill an absent server stamp from the device clock.
mutate("M3", STREAM,
  "at: (typeof e.ts === \"number\") ? e.ts : null,",
  "at: (typeof e.ts === \"number\") ? e.ts : Date.now(),   /*MUT_M3*/",
  1, "MUT_M3",
  "an undated checkpoint acquires a DEVICE clock where the room expects a server stamp");

// M4 — `importable` always says yes: the control lies about what was just saved.
//
// THE ANCHOR MOVED AT J27, and the reason is worth keeping rather than tidying away. This read
// `importable: ownerAuthored || chain.length >= 2,` — the condition J26 shipped — and J27 measured
// that it answers the EXPORTER's question rather than the importer's, so the line changed and this
// anchor matched NOTHING. The journal refused rather than reporting a green, which is the refusal
// doing its job. The mutation's INTENT is unchanged and still worth locking: a flag that always
// says yes lies to the person about what they just saved.
mutate("M4", STREAM,
  "        importable: ownerAuthored,",
  "        importable: true,   /*MUT_M4*/",
  1, "MUT_M4",
  "the flag claims every file can be imported, including the ones no room can be created from");

// M5 — the file carries only the pick, never the chain material.
mutate("M5", STREAM,
  ".filter((e) => typeof e.floorL === \"number\" && e.floorL <= pick.floorL)",
  ".filter((e) => e.h === pick.h)   /*MUT_M5*/",
  1, "MUT_M5",
  "a peer file ships without the predecessors that make it readable");

// M6 — the wiring. The renderer exists and nothing calls it: this tree's signature failure.
mutate("M6", UI,
  "    renderExportSection(); // what this client holds from the room it last opened (J26)",
  "    /*MUT_M6 renderExportSection();*/",
  1, "MUT_M6",
  "the lobby stops calling the renderer — a correct module reached by nothing (P1)");

// M7 — the relative-time mutation: the label becomes a crossed clock comparison.
mutate("M7", UI,
  "    try { return new Date(at).toLocaleString(); } catch (e) { return \"time unknown\"; }",
  "    try { return Math.round((Date.now() - at) / 60000) + \" min ago\"; } catch (e) { return \"time unknown\"; }   /*MUT_M7*/",
  1, "MUT_M7",
  "the stamp is rendered as an 'ago', subtracting a device clock from a server stamp");

// M8 — the feature layer stops saying which room the held checkpoints belong to.
mutate("M8", ROOMJS,
  "return { room: current ? { name: current.name, spaceId: current.spaceId } : null, held: held };",
  "return { held: held };   /*MUT_M8*/",
  1, "MUT_M8",
  "the room identity is dropped, so the lobby offers one room's state under another room's name");

// ── report ────────────────────────────────────────────────────────────────────────────────────
console.log("");
let kills = 0, survivors = 0, crashes = 0, voids = 0;
for (const r of rows) {
  if (!r.still) { voids++; console.log("  " + r.id + " · VOID — the mutation was not still applied "
    + "when the guard read the file. Discarded, not kept for comparison."); continue; }
  if (r.red && !r.crash) kills++;
  if (r.red && r.crash) { crashes++; }
  if (!r.red) survivors++;
  console.log("  " + r.id + " · " + r.what);
  console.log("        applied " + r.applied + "× · " +
    (r.red ? (r.crash ? "RED BY CRASH — not red enough" : "RED") : "SURVIVED — the rule is NOT enforced"));
  if (r.msg) console.log("        ↳ " + r.msg.replace(/\s+/g, " ").slice(0, 190));
}

console.log("\n" + "=".repeat(78));
console.log(rows.length + " mutations · " + kills + " red · " + survivors + " survivors · "
  + crashes + " red-by-crash · " + voids + " void");
if (survivors) {
  console.log("A SURVIVOR IS NOT AUTOMATICALLY A GAP. Suspect the FIXTURE first — and then ask "
    + "whether the rule is enforced somewhere you were not looking (the J25 M1 lesson).");
}
// Final proof the tree is back as it was.
const rep2 = journal.recover();
console.log(rep2.clean && !rep2.restored.length
  ? "journal: clean at exit — every mutation restored."
  : "journal: NOT CLEAN at exit — " + JSON.stringify(rep2));
