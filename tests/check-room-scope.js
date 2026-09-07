// tests/check-room-scope.js
//
// EVERY BACKEND MODULE IS ACCOUNTED FOR ON A ROOM CHANGE, OR THE BUILD FAILS.
//
// One DDJP room is several Matrix channels and a client can leave one room and enter another
// without reloading, so anything a module remembers is per-room until something clears it. When a
// module is missed the failure is SILENT and shaped like data rather than like an error: the
// previous room's checkpoints, floor or settings quietly colour the next one, and every downstream
// answer is room-shaped and wrong. `CONCEPTS.md` §3.11 lists this as a named pattern precisely
// because it has bitten before.
//
// THE HAZARD IS NOT THAT A MODULE IS UNCLEARED TODAY. It is that the clearing is done in THREE
// hand-maintained places, none of which knows about the other two:
//
//     seedClock          (matrixbridge)  Session, Scheduler, the cadence tick
//     resetCheckpoints   (matrixbridge)  Floor, Checkpoint, Continuity, History, SettingsProof,
//                                        Vouch's tombstones, and its own locals
//     features/room.js                   StreamManager.reset()
//
// So a module added with per-room state is isolated only if somebody remembered a line in the right
// one of three files, and nothing anywhere says which. Driven at v321: renaming the single
// `StreamManager.reset()` call in `features/room.js` left ALL guards green. An entire room-cleanup
// coordinator can be deleted without the suite noticing.
//
// SO THIS GUARD IS AN ACCOUNTING RULE RATHER THAN A DEFECT DETECTOR, and it is `check-spine` PART
// A's shape applied to room scope: every backend module is either REACHED by a room-entry path or
// DECLARED as holding nothing per-room, with the reason recorded. A new module fails here until
// someone says which it is. The declaration list is asserted exhausted in both directions, because
// a list of one silently becoming a list of twenty is how a guard stops meaning anything.
//
// WHY THE LIST IS HERE AND NOT A MARKER IN THE MODULES. A marker would be a second copy of a fact
// the tree already carries: whether a module holds state is readable from the module, and whether
// it is reached is readable from the coordinators. What is NOT readable anywhere is the JUDGEMENT
// that a given piece of state is not per-room — `_loadPromise` is a hydration latch, `_defaults` is
// a memo — and a judgement with a reason beside it is exactly what this list is for.
//
// WHAT THIS DOES NOT CHECK, MEASURED RATHER THAN ASSUMED, AND STATED SO IT IS NOT READ AS MORE
// THAN IT IS:
//
//   · That a reset actually clears everything the module holds. That is per-module and belongs with
//     each module's own guard.
//   · That a clearing CALL still resolves. The scan asks whether the module is NAMED in a
//     room-entry path, and renaming the method leaves the name in place — driven: changing
//     `StreamManager.reset()` to `StreamManager.resetXX()` in `_initModules` leaves this GREEN. A
//     text scan cannot resolve a call, and pretending otherwise is the trap
//     `08-build-and-deploy.md` records for textual guards.
//
// WHAT IT DOES CATCH is the failure that actually happens: a module ADDED with per-room state that
// nobody wired into any of the three coordinators. Driven — a new `newthing.js` holding a per-room
// cache turns this red naming `newthing (NewThing)`, where before it would have shipped silently and
// coloured the next room with the last one's data.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BE = path.join(ROOT, "backends/backend1");
const strip = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// ── THE POPULATION, DERIVED ──────────────────────────────────────────────────────────────────
// Read off disk rather than listed, so a new module is in scope the moment it exists.
const MODULES = fs.readdirSync(BE)
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.replace(/\.js$/, ""))
  .sort();

// Module basename -> the global it exposes. Derived rather than guessed from the filename, because
// the two differ (`statederiver` -> `StateDeriver`) and a guess that happened to be wrong would
// silently look for a name nothing uses and report every module unreached.
//
// THE TREE USES TWO IDIOMS AND BOTH ARE READ. Most modules end with an explicit
// `module.exports = { Name }`; `streammanager` and `matrixbridge` do not, and declare only
// `const Name = (() => {` at the top. An earlier version of this read one idiom and reported every
// module unreached; a later one read the other and still missed those two. It failed loudly both
// times only because "could not read its global name" was made a FAILURE rather than a skip — a
// lookup that returns nothing must never be allowed to read as "nothing to check", which is the
// silent-pass shape this suite exists to refuse.
function globalOf(mod) {
  const src = fs.readFileSync(path.join(BE, mod + ".js"), "utf8");
  const exp = src.match(/module\.exports\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (exp) return exp[1];
  const iife = src.match(/(?:^|\n)\s*(?:const|var|let|window\.)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(/);
  return iife ? iife[1] : null;
}

// ── THE ROOM-ENTRY PATHS, ALSO DERIVED ───────────────────────────────────────────────────────
// The three coordinators, read as source. Comments are stripped first: this file is dense with
// prose naming modules it does not call, and a scan that counted those would report every module
// reached and prove nothing — the exact trap `08-build-and-deploy.md` records for textual guards.
const MB = strip(fs.readFileSync(path.join(BE, "matrixbridge.js"), "utf8"));
const ROOM = strip(fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8"));

function bodyOf(src, fnName) {
  const i = src.indexOf("function " + fnName + "(");
  if (i < 0) return "";
  // Brace-match from the signature so the extent is the function's, not a fixed line count that
  // would silently shorten as the function grows.
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return src.slice(open);
}

const seedClock = bodyOf(MB, "seedClock");
const resetCheckpoints = bodyOf(MB, "resetCheckpoints");
// THE THIRD COORDINATOR IS A FUNCTION, NOT A FILE. An earlier version scanned the whole of
// `features/room.js` and reported `capabilities` as both declared-stateless and cleared — because
// the file calls `Capabilities.atLeast()` for a permission check hundreds of lines from anything to
// do with room entry. A proxy that treats "named anywhere in a feature file" as "cleared on room
// entry" is wrong in both directions, so the scan is narrowed to the function that actually runs on
// entry.
const initModules = bodyOf(ROOM, "_initModules");

assert.ok(seedClock.length > 0 && resetCheckpoints.length > 0 && initModules.length > 0,
  "[room-scope] FAIL — a room-entry coordinator could not be located, so every module below would " +
  "report unreached for a reason that has nothing to do with room scope. This is a broken guard, " +
  "NOT a broken tree. seedClock=" + seedClock.length + " resetCheckpoints=" + resetCheckpoints.length +
  " _initModules=" + initModules.length);

const ENTRY_PATHS = seedClock + "\n" + resetCheckpoints + "\n" + initModules;

// ── THE DECLARATION LIST ─────────────────────────────────────────────────────────────────────
// A module here is asserted to hold nothing that belongs to one room. Each carries the reason,
// because the reason is the part a reader cannot recompute.
const NO_ROOM_STATE = {
  ranks: "pure ladder and stagger arithmetic; no state at all",
  consensushash: "pure canonicalisation and hashing; no state at all",
  statederiver: "the reducer is pure — same input, same output, asserted by check-statederiver-purity",
  capabilities: "pure gate lookups over a rank and a settings blob",
  trustpolicy: "pure predicates over a grade; one seam so no two callers disagree",
  checkpointformat: "pure format read/write; the version constants are per-build, not per-room",
  vouch: "the per-room part is the tombstone map, and `resetCheckpoints` clears it via " +
         "`forgetTombstones()` rather than a `reset()` — named here because a scan for `Vouch.reset` " +
         "would report it unreached and be wrong",
  dials: "`_defaults` memoises the reducer's defaults, which are a property of the build",
  eventcache: "`_loadPromise` is a hydration latch. The cache itself is deliberately GLOBAL and " +
              "scoped by filter rather than cleared — CONCEPTS.md §3.11 records why: one DDJP room " +
              "is several channels, so filtering on one is too narrow and no filter far too broad",
};

// ── ACCOUNTING ───────────────────────────────────────────────────────────────────────────────
const unreached = [];
for (const mod of MODULES) {
  if (NO_ROOM_STATE[mod]) continue;
  const g = globalOf(mod);
  if (!g) { unreached.push(mod + " (could not read its global name)"); continue; }
  // matrixbridge is the file the coordinators live in; it clears its own locals inline.
  if (mod === "matrixbridge") continue;
  if (!new RegExp("\\b" + g + "\\s*\\.").test(ENTRY_PATHS)) unreached.push(mod + " (" + g + ")");
}

assert.ok(unreached.length === 0,
  "[room-scope] FAIL — a backend module is not reached by ANY room-entry path and does not declare " +
  "that it holds nothing per-room. On a room change its state survives into the next room, and the " +
  "failure is silent because stale state is room-shaped rather than an error.\n" +
  "      unreached: " + JSON.stringify(unreached) + "\n" +
  "      Either clear it from one of the three coordinators — seedClock, resetCheckpoints, or " +
  "features/room.js — or add it to NO_ROOM_STATE with the reason it holds nothing per-room.");

// ── AND THE DECLARATION LIST STAYS HONEST ────────────────────────────────────────────────────
// A declaration for a module that no longer exists is a list rotting quietly; a module that both
// declares no room state AND is cleared anyway means one of the two statements is wrong.
const ghosts = Object.keys(NO_ROOM_STATE).filter((m) => !MODULES.includes(m));
assert.ok(ghosts.length === 0,
  "[room-scope] FAIL — NO_ROOM_STATE declares a module that does not exist, so the reason beside " +
  "it is describing nothing. " + JSON.stringify(ghosts));

const contradictory = Object.keys(NO_ROOM_STATE).filter((m) => {
  const g = globalOf(m);
  // Vouch is the deliberate exception: it declares here AND is cleared, because the per-room half
  // is the tombstone map and the reason above says so.
  if (m === "vouch") return false;
  return g && new RegExp("\\b" + g + "\\s*\\.").test(ENTRY_PATHS);
});
assert.ok(contradictory.length === 0,
  "[room-scope] FAIL — a module declares it holds nothing per-room and is ALSO cleared on room " +
  "entry. One of those is wrong, and leaving both in place means neither is trusted. " +
  JSON.stringify(contradictory));

console.log(
  "[room-scope] PASS — every backend module is accounted for on a room change: reached by one of " +
  "the three room-entry coordinators (seedClock, resetCheckpoints, features/room.js), or declaring " +
  "with a reason that it holds nothing belonging to one room. The population is read off disk and " +
  "each module's global is read from its own IIFE rather than guessed from its filename, so a new " +
  "module is in scope the moment it exists and fails here until it is classified. The coordinators " +
  "are brace-matched and comment-stripped, because this file names modules in prose it does not " +
  "call and a scan counting those would report everything reached. The declaration list is asserted " +
  "honest in both directions. Two limits, both measured rather than assumed: it does not check that " +
  "a reset clears everything a module holds (per-module, and each module's own guard's job), and " +
  "it cannot check that a clearing CALL still resolves — renaming the method leaves the module " +
  "named and this green, driven. What it catches is the failure that actually happens: a module " +
  "added with per-room state that nobody wired into any coordinator (" + MODULES.length + " modules, " +
  Object.keys(NO_ROOM_STATE).length + " declared stateless)");
