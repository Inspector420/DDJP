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

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

const KNOWN_GLOBALS = [
  "Logger", "StorageIO", "IDB", "Store", "EventCache", "StateDeriver",
  "StreamManager", "BlockManager", "MatrixBridge",
  "RoomUpgrade", "Queue", "UserQueue", "Skip", "Playback", "Room", "Media", "WindowedList", "Chat",
];

// relFiles: e.g. ["core/logger.js", "core/statederiver.js"]
// extras:   globals to inject (Date, Math, localStorage, console, ...)
function loadInContext(relFiles, extras = {}) {
  const sandbox = Object.assign({ console }, extras);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

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
