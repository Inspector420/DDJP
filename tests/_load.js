// tests/_load.js
// Loads DDJP's IIFE-global modules into an isolated sandbox so the guards can
// exercise the REAL code (not a copy). Each call returns a fresh, independent
// context — two calls = two independent "clients".
//
// The project's modules are plain browser globals declared with
//   const X = (() => { ... })();
// loaded by <script> order in index.html. We reproduce that by concatenating
// the requested files into one script and running them in one shared scope,
// then exposing the known module names on the sandbox's globalThis.
//
// ONE INSTANCE PER LOAD, AND THAT REACHES ACROSS PARTS. A guard file that calls this once and
// then runs several parts is sharing every module between them — so a part that installs an env
// (`Checkpoint.attach`, `Floor.attach`, ...) leaves it installed for every part after it. Seen in
// check-legality: PART F attached an `isLegal` closing over ITS OWN accepted set, and PART G's
// `_countable` then answered 0 for both of its logs. That reads as a finding about the seal
// cadence and is really one part leaking into the next — the same absence-reads-as-a-finding
// failure `_fixtures.js` documents, arriving from a direction a fixture builder cannot help with.
// Re-attach what you depend on at the top of your part rather than inheriting whatever ran
// before it, or call this a second time for an independent context.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

const KNOWN_GLOBALS = [
  "Logger", "StorageIO", "IDB", "Store", "Ranks", "EventCache", "StateDeriver", "Capabilities", "PlaylistDoc", "ConsensusHash", "TrustPolicy", "VouchVerify", "CompactRecord", "VouchPolicy", "Recovery",
  "StreamManager", "CheckpointEngine", "MatrixBridge", "Playlists", "Session", "Scheduler", "Floor", "Vouch", "Checkpoint", "History", "SettingsProof", "Continuity", "CheckpointFormat", "Dials",
  "RoomUpgrade", "Queue", "Actions", "UserQueue", "Skip", "Reactions", "MediaLength", "MediaBlocked", "ServerClock", "Playback", "Room", "Media", "WindowedList", "Chat", "ChatBuffer", "ChatPrefs", "MetadataService",
  "BotSettings", "Reputation", "BotRuntime",
  // ── `Interface` WAS MISSING, AND THE LINTER FOUND IT (v280-shaped) ─────────────────────────
  // `ui/interface.js:47` declares `const Interface = (() => {…})()` and it was never in this list.
  // `check-reputation` PART F checks that every FEATURE module has an entry — `ui/` is outside
  // that sweep, so nothing caught it. A missing entry here fails quietly, which is exactly the
  // note below, and it is the same shape as v280's `refs.settingsBody`: a name nothing resolved.
  "Interface",
];
// ── THIS LIST IS HAND-WRITTEN, AND A MISSING NAME FAILS QUIETLY ──────────────────────────────
// A module absent from here loads and runs, and its global is simply never exposed — so the
// sandbox comes back without it and the caller reads `undefined.something`. That is a confusing
// failure a long way from its cause: J18's `BotSettings` produced `Cannot read properties of
// undefined (reading 'decide')` in a guard whose module list was correct. The exposer swallows a
// ReferenceError per name on purpose (most callers load a subset), which is what makes the
// omission silent. **Adding a feature module means adding it here**, and `check-lint` asserts this
// list is EXHAUSTIVE — a module declaring a top-level global the list does not name turns it red,
// so the next one is caught at the wall rather than at a confusing TypeError.
//
// THIS NAMED `check-load-globals.js` UNTIL v323, AND THAT FILE HAS NEVER EXISTED. The wrong half
// was not the missing guard but the sentence: it told a reader the omission was caught, so nobody
// checked by hand and nobody went looking for the guard either. A promise of a wall is worse than
// no wall, because it is the reason the manual check stops happening.

// relFiles: e.g. ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"]
// extras:   globals to inject (Date, Math, localStorage, console, ...)
function loadInContext(relFiles, extras = {}) {
  const sandbox = Object.assign({ console }, extras);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // DEDUPE, preserving first-listed order. index.html loads each module exactly
  // once; concatenating one twice would re-execute a `const X = (() => ...)()`
  // declaration and throw "Identifier already declared", which is a harness
  // artefact rather than a real finding.
  const seen = Object.create(null);
  relFiles = (relFiles || []).filter((r) => (seen[r] ? false : (seen[r] = true)));

  const sources = relFiles.map((rel) =>
    fs.readFileSync(path.join(ROOT, rel), "utf8")
  );

  // Expose whichever module globals ended up defined, ignoring the rest.
  const exposer =
    "\n;\n" +
    KNOWN_GLOBALS.map(
      (n) => `try { globalThis.${n} = ${n}; } catch (e) {}`
    ).join("\n");

  const script = sources.join("\n;\n") + exposer;
  vm.runInContext(script, sandbox, { filename: relFiles.join("+") });
  return sandbox;
}

module.exports = { loadInContext, ROOT };
