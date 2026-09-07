// tests/check-boundaries.js
// WALL: layer + backend boundaries. Fails the build if a module reaches across
// the lines the architecture draws. This is the cheapest, highest-value guard —
// an AI (or a tired human) literally cannot land a cross-layer coupling without
// this turning red.
//
// Layers (dependencies point DOWNWARD only):
//   ui  ->  features  ->  [backend interface]  ->  core (shared infra)
//                              |
//                    backends/<active>/  (the SWAPPABLE consensus + transport)
//
// The backend is the swappable part. Exactly one backends/<name>/ folder is
// populated at a time (the others are empty stubs). A backend exposes TWO
// globals as its interface — `StreamManager` (derived-state seam) and
// `MatrixBridge` (transport/intents/platform) — and keeps everything else
// (StateDeriver, EventCache, ConsensusHash, VouchVerify, CheckpointEngine, the
// Matrix SDK, the Lamport clock) as INTERNALS. See backends/README.md.
//
// Rules enforced (all pass on the real codebase):
//   A. The Matrix SDK (`matrixcs`) appears ONLY inside the backend.
//   B. Lamport-clock internals (`tickOutbound`/`updateInbound`) ONLY inside the backend.
//   C. core/ (shared infra) never depends on a feature or the backend (no upward dep).
//   D. ui/ talks to feature modules only — never the backend (interface OR internals).
//   E. No SDK event listeners on a handed-out client outside the backend.
//   F. features/ touch the backend ONLY through the interface (StreamManager +
//      MatrixBridge) — never a backend INTERNAL. This is what keeps the backend
//      swappable: the app can't grow a dependency on one backend's guts.
//   G. The backend never depends on the app (features/ui) — so it drops into any
//      app unchanged.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

// The populated backend folder(s) — auto-discovered so a swap needs no guard edit.
function backendDirs() {
  const base = path.join(ROOT, "backends");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((d) => {
      const p = path.join(base, d);
      return fs.statSync(p).isDirectory() && fs.readdirSync(p).some((f) => f.endsWith(".js"));
    })
    .map((d) => "backends/" + d);
}

// Strip whole-line comments so a rule isn't tripped by prose like
// "// Depends on: StreamManager, MatrixBridge". Inline https:// is left alone.
function readStripped(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
      return line;
    })
    .join("\n");
}

// Like readStripped, but ALSO blanks out quoted string literals — so a Matrix SDK
// event name like client.on("Room.timeline", …) is not mistaken for a call to the
// app's `Room` feature (rule G).
function readStrippedNoStr(rel) {
  return readStripped(rel).replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

const CORE = listJs("core");
const FEATURES = listJs("features");
const UI = listJs("ui");
const BACKEND = backendDirs().flatMap(listJs);
const APP_AND_SHARED = [...CORE, ...FEATURES, ...UI]; // everything that is NOT the backend

if (APP_AND_SHARED.length === 0 || BACKEND.length === 0) {
  console.log(
    "[boundaries] could not find core/ features/ ui/ + backends/<name>/ under " +
      ROOT + " — run from repo root (node tests/check-boundaries.js)."
  );
  process.exit(2);
}

// Rule A — SDK only in the backend
for (const rel of APP_AND_SHARED) {
  if (/\bmatrixcs\b/.test(readStripped(rel)))
    violations.push([rel, "references the Matrix SDK (matrixcs) — SDK access belongs only inside the backend (backends/<name>/matrixbridge.js)"]);
}

// Rule B — clock internals only in the backend
for (const rel of APP_AND_SHARED) {
  if (/\btickOutbound\b|\bupdateInbound\b/.test(readStripped(rel)))
    violations.push([rel, "manages the Lamport clock — clock logic belongs only inside the backend"]);
}

// Rule C — core/ (shared infra) must not depend on features/ or the backend
const CORE_FORBIDDEN = [
  "Room", "Queue", "Skip", "Playback", "Chat", "Reactions", "MediaLength", "MediaBlocked", "ServerClock", "UserQueue", "Playlists", "RoomUpgrade", "Media", "MetadataService", "Interface",
  "MatrixBridge", "StreamManager", "StateDeriver", "EventCache", "ConsensusHash", "VouchVerify", "CheckpointEngine", "Recovery",
];
for (const rel of CORE) {
  const s = readStripped(rel);
  for (const id of CORE_FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses " + id + " — core/ is shared infra and must not depend on features/ or the backend (dependencies point downward only)"]);
  }
}

// Rule D — ui/ goes through feature modules only (never the backend, interface or internal)
const UI_FORBIDDEN = ["StreamManager", "MatrixBridge", "Capabilities", "EventCache", "StateDeriver", "ConsensusHash", "VouchVerify", "CheckpointEngine", "Recovery"];
for (const rel of UI) {
  const s = readStripped(rel);
  for (const id of UI_FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses " + id + " directly — ui/ must go through feature modules (Room/Queue/Skip/Playback/Chat)"]);
  }
}

// Rule E — no SDK event listeners on a handed-out client outside the backend.
for (const rel of APP_AND_SHARED) {
  const s = readStripped(rel);
  if (/getClient\(\)\s*\.\s*on\s*\(/.test(s)) {
    violations.push([rel, "attaches a listener to getClient() — SDK event subscriptions belong inside the backend behind an emitter (e.g. onRoomsChanged)"]);
    continue;
  }
  const bound = [...s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*getClient\(\)/g)].map((m) => m[1]);
  for (const v of bound) {
    if (new RegExp("\\b" + v + "\\s*\\.\\s*on\\s*\\(").test(s)) {
      violations.push([rel, "binds getClient() to `" + v + "` and attaches `" + v + ".on(...)` — SDK event subscriptions belong inside the backend"]);
      break;
    }
  }
}

// Rule F — features/ use ONLY the backend interface (StreamManager + MatrixBridge),
// never a backend internal. This is the swappability wall: the app can depend on
// the contract, never on one backend's guts.
// THE LIST WENT STALE, AND A STALE WALL IS A GAP THAT READS AS A WALL. It named VouchVerify,
// CheckpointEngine and Recovery — none of which are modules any more — while omitting Session,
// Continuity, Floor, Vouch, Checkpoint, Scheduler, SettingsProof, TrustPolicy, Dials and
// CheckpointFormat, every one of which is as internal as StateDeriver. So a feature could have
// called Continuity.mayAdvance() directly and this guard would have said nothing, which is
// precisely the reach the swappability wall exists to prevent: a backend without Continuity (a
// lite or bot model) could not satisfy that call, and the app is supposed to depend on the
// contract rather than on one backend's parts. The retired names are kept so a future module
// cannot quietly reclaim one of them.
const BACKEND_INTERNALS = [
  "Ranks", "StateDeriver", "EventCache", "ConsensusHash", "CheckpointFormat", "Dials", "TrustPolicy",
  "Session", "Scheduler", "Vouch", "Floor", "Checkpoint", "Continuity", "History", "SettingsProof",
  "VouchVerify", "CheckpointEngine", "Recovery",   // retired — listed so the names stay reserved
];
for (const rel of FEATURES) {
  const s = readStripped(rel);
  for (const id of BACKEND_INTERNALS) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses backend internal " + id + " — features/ may touch the backend ONLY through its interface (StreamManager + MatrixBridge), so the backend stays swappable"]);
  }
}

// Rule G — the backend must not depend on the app (features/ui), so it drops into
// any app unchanged. (String literals are blanked first so the SDK event names
// "Room.timeline" / "Room.localEchoUpdated" / "Room.myMembership" don't false-fire.)
const APP_GLOBALS = ["Room", "Queue", "Skip", "Playback", "Reactions", "MediaLength", "MediaBlocked", "ServerClock", "UserQueue", "Playlists", "RoomUpgrade", "Media", "MetadataService", "Interface", "ChatBuffer"];
for (const rel of BACKEND) {
  const s = readStrippedNoStr(rel);
  for (const id of APP_GLOBALS) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses app module " + id + " — the backend must not depend on features/ or ui/ (it has to drop into any app unchanged)"]);
  }
}

// Rule H — features/ and ui/ must never compare a rank against a NUMBER. The number
// is a Matrix power level, an implementation detail of the transport; above it a rank
// is a NAME. Before the ladder was consolidated the threshold 40 lived in skip.js and
// mediablocked.js, 60 in room.js and 100 in roomupgrade.js — so "who may skip" could
// be changed in one place and silently disagree in another. The only legal way to ask
// a rank question outside the backend is Capabilities.can(verb, ...) or
// Capabilities.atLeast(rank, "name"), both of which read the single GATES table.
// Only the ACTUAL ladder levels count as a threshold. Comparing against 0 or 1 is a
// sanity check ("is this a non-negative number?"), and unrelated things have levels
// too (volume, panel dim), so matching any number would cry wolf and get the rule
// disabled — which is worse than not having it.
const LADDER_LEVELS = "(?:100|80|60|40|20|10)";
const RANK_NUMBER = new RegExp("\\w*(?:[Rr]ank|Level)\\w*\\s*(?:\\(\\s*\\))?\\s*[<>]=?\\s*" + LADDER_LEVELS + "\\b");
const RANK_NUMBER_REV = new RegExp("\\b" + LADDER_LEVELS + "\\s*[<>]=?\\s*\\w*(?:[Rr]ank|Level)\\w*\\s*(?:\\(\\s*\\))?");
for (const rel of [...FEATURES, ...UI]) {
  const s = readStripped(rel);
  for (const line of s.split("\n")) {
    if (RANK_NUMBER.test(line) || RANK_NUMBER_REV.test(line)) {
      violations.push([rel, "compares a rank against a number (" + line.trim().slice(0, 70) + ") — outside the backend a rank is a NAME; ask Capabilities.can(...) or Capabilities.atLeast(rank, \"name\") so the threshold lives only in Ranks.GATES"]);
    }
  }
}

// ── NO BRANCH MAY BE GATED ON A MODULE THAT NO LONGER EXISTS ─────────────────────────────────
// Found in the final audit, and it had already cost the room its entire vouching path: a `typeof
// VouchPolicy === "undefined"` guard survived the merge into `Vouch`, so it was permanently TRUE
// and `_proactiveWitness` returned on its first line. No bundles, no protection, no error, nothing
// in the log — while every unit guard around it still passed.
//
// This is the worst kind of dead branch because it READS AS CARE. A `typeof` check looks like
// defensive programming, and after a rename it silently becomes "never run this".
//
// Structural, and deliberately a whole-tree sweep rather than a list: the point is to catch the
// NEXT merge, not this one.
{
  const GONE = ["VouchPolicy", "CheckpointEngine", "CompactRecord", "VouchVerify", "Recovery"];
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === "node_modules" || f.name === "lib" || f.name.startsWith(".")) continue;
      const p2 = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== "tests") walk(p2); }
      else if (f.name.endsWith(".js")) files.push(p2);
    }
  })(ROOT);

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const g of GONE) {
      const re = new RegExp("typeof\\s+" + g + "\\b");
      if (re.test(src)) violations.push(
        "no live branch may be gated on `" + g + "`, which no longer exists — the guard is "
        + "permanently true and everything inside it permanently unreachable (" + path.relative(ROOT, f) + ")");
      const call = new RegExp("(?<![\\w.])" + g + "\\.[a-zA-Z_]");
      const live = src.split("\n").filter((l) => call.test(l) && !/^\s*(\/\/|\*)/.test(l));
      if (live.length) violations.push(
        "no live call to `" + g + "` may remain (" + path.relative(ROOT, f) + "): " + live[0].trim().slice(0, 80));
    }
  }
}

if (violations.length) {
  console.log("[boundaries] FAIL — " + violations.length + " cross-layer violation(s):");
  for (const [file, why] of violations) console.log("  ✗ " + file + "\n      " + why);
  process.exit(1);
}


console.log(
  "[boundaries] PASS — SDK/clock in the backend only; core has no upward deps; ui goes through features; " +
  "features use only the backend interface; the backend is app-independent (" +
  (APP_AND_SHARED.length + BACKEND.length) + " files scanned; backend: " + backendDirs().join(", ") + ")"
);
process.exit(0);
