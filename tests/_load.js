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
  // ── J59 SPLIT `matrixbridge.js` INTO TRANSPORT + ACCOUNT PLUMBING ─────────────────────────
  // `backends/backend1/matrixaccount.js` declares `MatrixAccount`. Its entry goes here and in
  // `index.html` in the SAME change as the file itself — a module missing from this list loads,
  // runs, and is simply never exposed, so the caller reads `undefined.something` a long way from
  // the cause. `check-lint` asserts this list is exhaustive.
  "MatrixAccount",
  // ── `Interface` WAS MISSING, AND THE LINTER FOUND IT (v280-shaped) ─────────────────────────
  // `ui/interface.js:47` declares `const Interface = (() => {…})()` and it was never in this list.
  // `check-reputation` PART F checks that every FEATURE module has an entry — `ui/` is outside
  // that sweep, so nothing caught it. A missing entry here fails quietly, which is exactly the
  // note below, and it is the same shape as v280's `refs.settingsBody`: a name nothing resolved.
  "Interface",
  // ── THE ui/ SPLIT ADDS ONE NAME PER FILE, AND THE OMISSION IS THE SAME SILENT ONE ──────────
  // `ui/base.js` declares `UIBase`, `ui/player.js` declares `Player`. Both go in HERE and in
  // `index.html` in the same change as the file itself. `check-lint` asserts this list is
  // exhaustive, so a further ui/ file that forgets its entry turns the wall red rather than
  // arriving as `undefined.something` a long way from the cause.
  "UIBase", "Player", "Panels", "QueuePanels", "PlaylistPanels", "Roster", "ChatPanels", "Settings", "Screens", "Shell",
  // ── THE BACKEND SEAM (J23) ────────────────────────────────────────────────────────────────
  // `Backends` is the registry/resolver/binder. The four interface names above it
  // (`StreamManager`, `MatrixBridge`, `MatrixAccount`, `Capabilities`) are declared in
  // `core/backends.js` now as SHELLS and filled by the binder, so their entries already here
  // keep meaning what they meant — the name a guard asks for still answers with the running
  // engine's module.
  //
  // THE `B1` NAMES ARE THE ENGINE ITSELF, and they are here for a second reason: `check-lint`
  // derives eslint's globals from this list, and `matrixaccount.js` reaches its own transport by
  // name (`B1MatrixBridge`) because that call runs at LOAD, before anything is bound. Without an
  // entry each of those reads as `no-undef`.
  "Backends", "B1StreamManager", "B1MatrixBridge", "B1MatrixAccount", "B1Capabilities",
  // backend2 (J24). `B2StreamManager` is the bot-run engine's door; the rest are still stubs. The
  // exhaustiveness check in `check-lint` scans every backend directory, so a second engine's
  // module globals belong here for the same reason backend1's do.
  "B2StreamManager", "B2Authority", "B2Checkpoint", "B2MatrixBridge", "B2Runner",
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

// A `Backends` stand-in for any sandbox — this loader's, and the hand-rolled ones probes build.
// EXPORTED ON PURPOSE: `_probe-j48-endon.js` assembles its own context and loads
// `backends/backend1/capabilities.js` into it, which registers at load like every backend module
// now does. A second copy of this object living in the probe would be a second definition of what
// the seam does in a test, free to drift from this one. One door.
function makeBackendsStub() {
  const registered = {};
  let mode = null;
  return {
    registered,
    register(modeId, impl) { mode = mode || modeId; if (impl) Object.assign(registered, impl); },
    active: () => mode,
    resolveMode: (c) => (c && typeof c.ddjp_mode === "string" && c.ddjp_mode) ? c.ddjp_mode : null,
    has: (m) => m === mode,
    isReady: () => true,
    bind: (m) => m,
    bindBootstrap: () => mode,
  };
}

// relFiles: e.g. ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"]
// extras:   globals to inject (Date, Math, localStorage, console, ...)
function loadInContext(relFiles, extras = {}) {
  const sandbox = Object.assign({ console }, extras);
  sandbox.globalThis = sandbox;

  // ── THE SEAM, HARNESS SIDE (J23) ───────────────────────────────────────────────────────────
  // Every backend module now ends with `Backends.register(...)`, which runs at LOAD — so without
  // a `Backends` in scope the concatenation throws before a single assertion runs.
  //
  // THIS IS A STAND-IN AND NOT `core/backends.js`, FOR A REASON WORTH KEEPING. The real file
  // declares the four interface names as `const` shells. Dropped into this sandbox those consts
  // would SHADOW the fakes 47 guards inject through `extras` — a feature would read the empty
  // shell instead of the double the guard built, and since backend1 reaches the interface through
  // guarded reads (`typeof StreamManager !== "undefined" && StreamManager.normalise`) it would
  // not throw. It would quietly take the fallback branch and the guard above would report a
  // finding about a path that never ran. Driven, not reasoned: prepending the real file turned 73
  // assertions red across 14 guards in exactly that shape.
  //
  // So the stand-in captures registrations and nothing else. A guard that loads the REAL module
  // gets the real module under its interface name (below); a guard that loads none keeps its
  // injected fake, which is the behaviour every caller was written against. The real registry is
  // driven directly by `check-backends.js`, which is where that belongs.
  // A caller may hand in the REAL `Backends` (from `core/backends.js`, built in its own context)
  // when it wants to drive the actual registry rather than this stand-in — `check-backends.js`
  // does exactly that. Its own object then owns the four shells, so the interface-name exposure
  // below is skipped and whatever fakes the caller injected stay in place.
  const _stub = makeBackendsStub();
  const _usingStub = !sandbox.Backends;
  if (_usingStub) sandbox.Backends = _stub;

  // `matrixaccount.js` fills `B1MatrixBridge._setAccountHost(...)` at load, by its engine-scoped
  // name, because that call cannot wait for a bind. One guard (`check-chat-crypto`) loads the
  // account module WITHOUT the transport and hands in a double instead, so point the engine name
  // at it. When the real `matrixbridge.js` is loaded its own `const` shadows this, which is right:
  // the real module wins whenever it is present.
  if (extras && extras.MatrixBridge && !sandbox.B1MatrixBridge) sandbox.B1MatrixBridge = extras.MatrixBridge;

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

  // A real backend module that registered itself answers under its INTERFACE name, which is what
  // every guard asks for and what the bound page would give them. Only slots that actually
  // registered are overwritten, so a guard that injected a fake and never loaded the real module
  // keeps its fake.
  if (_usingStub) {
    for (const slot of ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities"]) {
      if (_stub.registered[slot]) sandbox[slot] = _stub.registered[slot];
    }
  }
  return sandbox;
}

module.exports = { loadInContext, makeBackendsStub, ROOT };
