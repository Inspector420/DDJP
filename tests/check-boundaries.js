// tests/check-boundaries.js
// WALL: layer boundaries. Fails the build if a module reaches across the lines
// the architecture draws. This is the cheapest, highest-value guard — an AI
// (or a tired human) literally cannot land a cross-layer import without this
// turning red.
//
// Rules enforced (all currently pass on the real codebase):
//   A. The Matrix SDK (`matrixcs`) appears ONLY in transport/ (and lib/).
//   B. Lamport-clock internals (`tickOutbound`/`updateInbound`) ONLY in transport/.
//   C. core/ never uses a feature or transport module (no upward dependency).
//   D. ui/ talks to feature modules only — never StreamManager/MatrixBridge/
//      EventCache/StateDeriver directly.
//
// To extend: add a forbidden identifier to the relevant list below.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(dir, f));
}

// Strip whole-line comments so a rule isn't tripped by prose like
// "// Depends on: StreamManager, MatrixBridge". Inline https:// is left alone.
function readStripped(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
        return "";
      return line;
    })
    .join("\n");
}

const CORE = listJs("core");
const FEATURES = listJs("features");
const UI = listJs("ui");
const ABOVE_TRANSPORT = [...CORE, ...FEATURES, ...UI];

if (ABOVE_TRANSPORT.length === 0) {
  console.log(
    "[boundaries] could not find core/ features/ ui/ under " +
      ROOT +
      " — run this from your repo root (node tests/check-boundaries.js)."
  );
  process.exit(2);
}

// Rule A — SDK only in transport/
for (const rel of ABOVE_TRANSPORT) {
  if (/\bmatrixcs\b/.test(readStripped(rel)))
    violations.push([rel, "references the Matrix SDK (matrixcs) — SDK access belongs only in transport/matrixbridge.js"]);
}

// Rule B — clock internals only in transport/
for (const rel of ABOVE_TRANSPORT) {
  if (/\btickOutbound\b|\bupdateInbound\b/.test(readStripped(rel)))
    violations.push([rel, "manages the Lamport clock — clock logic belongs only in MatrixBridge"]);
}

// Rule C — core/ must not depend on features/ or transport/
const CORE_FORBIDDEN = ["MatrixBridge", "Room", "Queue", "Skip", "Playback", "Chat", "Interface"];
for (const rel of CORE) {
  const s = readStripped(rel);
  for (const id of CORE_FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses " + id + " — core/ must not depend on features/ or transport/ (dependencies point downward only)"]);
  }
}

// Rule D — ui/ goes through feature modules only
const UI_FORBIDDEN = ["StreamManager", "MatrixBridge", "EventCache", "StateDeriver"];
for (const rel of UI) {
  const s = readStripped(rel);
  for (const id of UI_FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses " + id + " directly — ui/ must go through feature modules (Room/Queue/Skip/Playback/Chat)"]);
  }
}

// Rule E — no SDK event listeners on a handed-out client outside transport/.
// getClient() hands back the raw matrix-js-sdk client; attaching `.on(...)` to
// it is an SDK escape hatch the import-based rules above don't catch. Room-list
// / membership / timeline listeners belong behind a MatrixBridge emitter. Catch
// BOTH the inline form `getClient().on(` and the assigned form
// `const c = getClient(); c.on(` (the latter is exactly the leak this rule was
// added to kill, so it must be caught).
for (const rel of ABOVE_TRANSPORT) {
  const s = readStripped(rel);
  if (/getClient\(\)\s*\.\s*on\s*\(/.test(s)) {
    violations.push([rel, "attaches a listener to getClient() — SDK event subscriptions belong in transport/ behind a MatrixBridge emitter (e.g. onRoomsChanged)"]);
    continue;
  }
  // A local bound to getClient() that then calls `.on(...)`.
  const bound = [...s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*getClient\(\)/g)].map((m) => m[1]);
  for (const v of bound) {
    if (new RegExp("\\b" + v + "\\s*\\.\\s*on\\s*\\(").test(s)) {
      violations.push([rel, "binds getClient() to `" + v + "` and attaches `" + v + ".on(...)` — SDK event subscriptions belong in transport/ behind a MatrixBridge emitter"]);
      break;
    }
  }
}

if (violations.length) {
  console.log("[boundaries] FAIL — " + violations.length + " cross-layer violation(s):");
  for (const [file, why] of violations) console.log("  ✗ " + file + "\n      " + why);
  process.exit(1);
}

console.log("[boundaries] PASS — SDK, clock, core, and UI boundaries all intact (" + ABOVE_TRANSPORT.length + " files scanned)");
process.exit(0);
