// tests/check-room-scope.js
// SUBJECT: backends/
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
//
// ── BOTH ENGINES SINCE J80, AND WHY THE BOT ENGINE'S COORDINATOR IS ITS RESET ─────────────────────
// This scanned `backends/backend1/` only, so the bot engine's modules were never held to the rule —
// and the bot's runner was exactly the module it describes: started on a bot room's entry, stopped
// nowhere, it went on running in the next room the tab opened (live, `?v=524`: it started a song and
// sealed a save point in its old room from the shared room's state). The population is now every
// engine directory under `backends/`, and a premise row asserts it covers every backend file
// `index.html` loads, so a narrowed scan is red rather than quietly green.
//
// An engine other than the shared one has ONE more coordinator: its own `reset`, which the ONE leave
// step (`features/room.js` `leave`, J83 — before J83 `_initModules`) calls as `StreamManager.reset()`
// whenever that engine is the one being LEFT — for the lobby, a shared room, another bot room, or the
// same one again. It counts for that engine's
// modules only (a shared-room module reached only there would outlive a shared room left behind).
// The bot engine's `setRoomScope` is deliberately NOT a coordinator: it runs only when a bot room is
// ENTERED, never when one is left for a shared room, so a module reached only there is the J80 bug.
// A module whose per-room state another module owns is declared HELD_BY that owner, which must be
// reached itself and must name it in the functions that clear it.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKENDS = path.join(ROOT, "backends");
const strip = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// ── THE POPULATION, DERIVED ──────────────────────────────────────────────────────────────────
// Read off disk rather than listed, so a new module is in scope the moment it exists — in EVERY
// engine directory (J80). A module is named by its path under `backends/` (`backend1/ranks`),
// because two engines share basenames (`streammanager`, `checkpoint`) and a basename no longer
// names one module.
const ENGINE_DIRS = fs.readdirSync(BACKENDS)
  .filter((d) => fs.statSync(path.join(BACKENDS, d)).isDirectory())
  .sort();
const MODULES = [];
for (const d of ENGINE_DIRS) {
  for (const f of fs.readdirSync(path.join(BACKENDS, d))) if (f.endsWith(".js")) MODULES.push(d + "/" + f.replace(/\.js$/, ""));
}
MODULES.sort();
const dirOf = (mod) => mod.split("/")[0];

// ── PREMISE: EVERY BACKEND FILE THE APP LOADS IS IN THE POPULATION ───────────────────────────
// Read from `index.html` — what the browser actually loads — rather than from the same directory
// walk, so a scan narrowed to one engine (the shape this guard had until J80) is red here by name
// instead of green for want of anything to look at.
const LOADED = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/src="backends\/[^"?]+\.js/g) || [])
  .map((m) => m.slice('src="backends/'.length).replace(/\.js$/, ""));
const notScanned = LOADED.filter((m) => !MODULES.includes(m));
assert.ok(LOADED.length > 0 && notScanned.length === 0,
  "[room-scope] FAIL — the population does not cover every backend file `index.html` loads, so a module the " +
  "app runs is never accounted for on a room change. loaded=" + LOADED.length + " not scanned: " + JSON.stringify(notScanned));
assert.ok(LOADED.some((m) => dirOf(m) === "backend2"),
  "[room-scope] FAIL — PREMISE: `index.html` loads no bot-engine module, so the bot engine's half of this guard " +
  "reads nothing. This is a broken premise, NOT a clean tree.");

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
  const src = fs.readFileSync(path.join(BACKENDS, mod + ".js"), "utf8");
  // ── THE NAME A MODULE IS REACHED BY, WHICH IS NOT ALWAYS THE NAME IT DECLARES (J23) ────────
  // The four interface modules declare engine-scoped names (`B1StreamManager`) and register
  // themselves under an interface name (`StreamManager`), which is what the coordinators below
  // actually call. Read the registration, because that is where the tree records the mapping —
  // the same reason the two idioms below are read rather than guessed from the filename.
  //
  // WITHOUT THIS the scan looks for `B1StreamManager` in `_initModules`, finds `StreamManager`,
  // and reports the module that holds the MOST per-room state as unreached. That is a true
  // failure of this guard's premise and not of the tree: `StreamManager.reset()` is still the
  // first line of the room-entry path. Comments are stripped first, for the reason the header
  // gives about prose naming things it does not call.
  const reg = strip(src).match(
    /Backends\.register\s*\([^)]*?\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (reg) return reg[1];
  const exp = src.match(/module\.exports\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (exp) return exp[1];
  const iife = src.match(/(?:^|\n)\s*(?:const|var|let|window\.)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(/);
  return iife ? iife[1] : null;
}

// ── THE ROOM-ENTRY PATHS, ALSO DERIVED ───────────────────────────────────────────────────────
// The three coordinators, read as source. Comments are stripped first: this file is dense with
// prose naming modules it does not call, and a scan that counted those would report every module
// reached and prove nothing — the exact trap `08-build-and-deploy.md` records for textual guards.
const MB = strip(fs.readFileSync(path.join(BACKENDS, "backend1/matrixbridge.js"), "utf8"));
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
// ── AND THE ONE LEAVE STEP (J83, the owner's ruling 18) ──────────────────────────────────────
// The resets that ran at the top of `_initModules` (the outgoing engine's `StreamManager.reset()`,
// `ServerClock`, `resetCheckpoints`) moved into `features/room.js` `leave`, which the switch runs
// before every entry and every way out of a room runs too; and the transport's half of leaving is
// `MatrixBridge.leaveRoom` (Session, Scheduler, the timers it owns). Both are coordinators now —
// read as functions, for the reason `_initModules` is.
const roomLeave = bodyOf(ROOM, "leave");
const bridgeLeave = bodyOf(MB, "leaveRoom");

assert.ok(seedClock.length > 0 && resetCheckpoints.length > 0 && initModules.length > 0 && roomLeave.length > 0 && bridgeLeave.length > 0,
  "[room-scope] FAIL — a room-change coordinator could not be located, so every module below would " +
  "report unreached for a reason that has nothing to do with room scope. This is a broken guard, " +
  "NOT a broken tree. seedClock=" + seedClock.length + " resetCheckpoints=" + resetCheckpoints.length +
  " _initModules=" + initModules.length + " leave=" + roomLeave.length + " leaveRoom=" + bridgeLeave.length);

const ENTRY_PATHS = seedClock + "\n" + resetCheckpoints + "\n" + initModules + "\n" + roomLeave + "\n" + bridgeLeave;

// ── AN ENGINE'S OWN RESET, FOR THAT ENGINE'S MODULES (J80) ───────────────────────────────────
// The shared engine's directory is the one the three coordinators above live in; every other
// engine directory that has a `streammanager.js` with a `reset` gets it as a fourth coordinator for
// its own modules. Located or the guard refuses: a coordinator that could not be found would report
// the whole engine unreached for a reason that has nothing to do with room scope.
const SHARED_DIR = "backend1";
const ENGINE_RESET = {};
for (const d of ENGINE_DIRS) {
  if (d === SHARED_DIR) continue;
  const f = path.join(BACKENDS, d, "streammanager.js");
  if (!fs.existsSync(f)) continue;
  ENGINE_RESET[d] = bodyOf(strip(fs.readFileSync(f, "utf8")), "reset");
  assert.ok(ENGINE_RESET[d].length > 0,
    "[room-scope] FAIL — `backends/" + d + "/streammanager.js` has no `reset` this guard could locate, so every module " +
    "of that engine would report unreached. This is a broken guard, NOT a broken tree.");
}
const pathsFor = (mod) => ENTRY_PATHS + (ENGINE_RESET[dirOf(mod)] ? "\n" + ENGINE_RESET[dirOf(mod)] : "");

// ── THE DECLARATION LIST ─────────────────────────────────────────────────────────────────────
// A module here is asserted to hold nothing that belongs to one room. Each carries the reason,
// because the reason is the part a reader cannot recompute.
const NO_ROOM_STATE = {
  "backend1/ranks": "pure ladder and stagger arithmetic; no state at all",
  "backend1/consensushash": "pure canonicalisation and hashing; no state at all",
  "backend1/statederiver": "the reducer is pure — same input, same output, asserted by check-statederiver-purity",
  "backend1/capabilities": "pure gate lookups over a rank and a settings blob",
  "backend1/trustpolicy": "pure predicates over a grade; one seam so no two callers disagree",
  "backend1/checkpointformat": "pure format read/write; the version constants are per-build, not per-room",
  "backend1/vouch": "the per-room part is the tombstone map, and `resetCheckpoints` clears it via " +
         "`forgetTombstones()` rather than a `reset()` — named here because a scan for `Vouch.reset` " +
         "would report it unreached and be wrong",
  "backend1/dials": "`_defaults` memoises the reducer's defaults, which are a property of the build",
  "backend1/matrixaccount": "app plumbing (J59) — it holds nothing per-ROOM. Its state is per-ACCOUNT (the " +
                 "session blob, the registry, the pending recovery key) or per-USER (the avatar " +
                 "cache), and `_dmScope` deliberately SURVIVES a room change: a DM is with a person, " +
                 "not inside a room, so `clearRoomScope` leaves it alone on purpose. It is cleared " +
                 "on logout and on an account switch, which is where the person stops being us",
  "backend1/eventcache": "`_loadPromise` is a hydration latch. The cache itself is deliberately GLOBAL and " +
              "scoped by filter rather than cleared — CONCEPTS.md §3.11 records why: one DDJP room " +
              "is several channels, so filtering on one is too narrow and no filter far too broad",
  "backend2/skeleton": "the bot engine's registration, its channel plan and its description — constants and a " +
                       "`Backends.register` call; it holds no state at all, and its two slots are backend1's modules",
};

// ── HELD BY ANOTHER MODULE (J80) ─────────────────────────────────────────────────────────────
// A module whose per-room state belongs to another module's lifetime: the OWNER must be reached by a
// room-entry path, and the owner's named functions must name this module, so the claim is checked
// against the source rather than taken from this line.
const HELD_BY = {
  "backend2/authority": { by: "backend2/runner", in: ["stop", "start"],
    why: "the runner's gate: the runner attaches it, and it is the only thing that submits to it. `B2Runner.stop` — " +
         "called by the bot engine's reset on every leave (J83) — sends what it holds (`flush`), and `B2Runner.start` " +
         "clears all of it (`reset`) before attaching it again; nothing reads it while no runner runs" },
};

// ── ACCOUNTING ───────────────────────────────────────────────────────────────────────────────
const reached = (mod) => { const g = globalOf(mod); return !!g && new RegExp("\\b" + g + "\\s*\\.").test(pathsFor(mod)); };
const unreached = [];
for (const mod of MODULES) {
  if (NO_ROOM_STATE[mod]) continue;
  const g = globalOf(mod);
  if (!g) { unreached.push(mod + " (could not read its global name)"); continue; }
  // matrixbridge is the file the coordinators live in; it clears its own locals inline.
  if (mod === "backend1/matrixbridge") continue;
  const held = HELD_BY[mod];
  if (held) {
    const owner = strip(fs.readFileSync(path.join(BACKENDS, held.by + ".js"), "utf8"));
    const named = held.in.every((fn) => new RegExp("\\b" + g + "\\s*\\.").test(bodyOf(owner, fn)));
    if (!reached(held.by) || !named) unreached.push(mod + " (" + g + ", held by " + held.by + ": " +
      (!reached(held.by) ? "the owner is not reached by a room-entry path" : "the owner's " + held.in.join("/") + " do not all name it") + ")");
    continue;
  }
  if (!reached(mod)) unreached.push(mod + " (" + g + ")");
}

assert.ok(unreached.length === 0,
  "[room-scope] FAIL — a backend module is not reached by ANY room-entry path and does not declare " +
  "that it holds nothing per-room. On a room change its state survives into the next room, and the " +
  "failure is silent because stale state is room-shaped rather than an error.\n" +
  "      unreached: " + JSON.stringify(unreached) + "\n" +
  "      Either clear it from one of the three coordinators — seedClock, resetCheckpoints, or " +
  "features/room.js (or, for an engine other than the shared one, that engine's own `reset`) — or add it to " +
  "NO_ROOM_STATE with the reason it holds nothing per-room.");

// ── AND THE DECLARATION LIST STAYS HONEST ────────────────────────────────────────────────────
// A declaration for a module that no longer exists is a list rotting quietly; a module that both
// declares no room state AND is cleared anyway means one of the two statements is wrong.
const ghosts = Object.keys(NO_ROOM_STATE).concat(Object.keys(HELD_BY)).filter((m) => !MODULES.includes(m));
assert.ok(ghosts.length === 0,
  "[room-scope] FAIL — NO_ROOM_STATE declares a module that does not exist, so the reason beside " +
  "it is describing nothing. " + JSON.stringify(ghosts));

const contradictory = Object.keys(NO_ROOM_STATE).filter((m) => {
  const g = globalOf(m);
  // Vouch is the deliberate exception: it declares here AND is cleared, because the per-room half
  // is the tombstone map and the reason above says so.
  if (m === "backend1/vouch") return false;
  return g && new RegExp("\\b" + g + "\\s*\\.").test(pathsFor(m));
});
assert.ok(contradictory.length === 0,
  "[room-scope] FAIL — a module declares it holds nothing per-room and is ALSO cleared on room " +
  "entry. One of those is wrong, and leaving both in place means neither is trusted. " +
  JSON.stringify(contradictory));

console.log(
  "[room-scope] PASS — every backend module is accounted for on a room change: reached by one of " +
  "the room-change coordinators (seedClock, resetCheckpoints, leaveRoom; features/room.js `_initModules` and, since J83, `leave`), or declaring " +
  "with a reason that it holds nothing belonging to one room. The population is read off disk and " +
  "each module's global is read from its own IIFE rather than guessed from its filename, so a new " +
  "module is in scope the moment it exists and fails here until it is classified. The coordinators " +
  "are brace-matched and comment-stripped, because this file names modules in prose it does not " +
  "call and a scan counting those would report everything reached. The declaration list is asserted " +
  "honest in both directions. Two limits, both measured rather than assumed: it does not check that " +
  "a reset clears everything a module holds (per-module, and each module's own guard's job), and " +
  "it cannot check that a clearing CALL still resolves — renaming the method leaves the module " +
  "named and this green, driven. What it catches is the failure that actually happens: a module " +
  "added with per-room state that nobody wired into any coordinator. Both engines are in it since J80 " +
  "— the bot engine's modules are reached by its own reset, which runs whenever a bot room is left, and " +
  "never by its room-entry hook alone; the population covers every backend file index.html loads (" +
  MODULES.length + " modules in " + ENGINE_DIRS.length + " engine directories, " +
  Object.keys(NO_ROOM_STATE).length + " declared stateless, " + Object.keys(HELD_BY).length + " held by an owner)");
