// tests/check-boundaries.js
// SUBJECT: core/, features/, ui/, backends/backend1/
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
// The backend is the swappable part. Two engines are populated — backend1 (shared
// consensus) and backend2 (bot-run) — and `core/backends.js` binds ONE per room. The
// interface is FOUR globals — `StreamManager` (derived-state seam), `MatrixBridge`
// (transport/intents/platform), `MatrixAccount` and `Capabilities` — and everything else
// (StateDeriver, EventCache, ConsensusHash, Vouch, Checkpoint, Floor, the
// Matrix SDK, the Lamport clock) as INTERNALS. See backends/README.md.
//
// Rules enforced (all pass on the real codebase), each over the source as the language reads it — comments dropped, and for
// rule G strings' text blanked, by one reader (`lexJs`) that PART 0 drives on fixtures every run (`ddjp_693`):
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

// ── COMMENTS AND STRINGS, READ AS THE LANGUAGE READS THEM (`ddjp_693`) ─────────────────────────────────────────────
// So a rule isn't tripped by prose like "// Depends on: StreamManager, MatrixBridge", every comment is dropped, and for rule
// G every string's text too — so a Matrix SDK event name like client.on("Room.timeline", …) is not mistaken for a call to
// the app's `Room` feature.
// IT USED TO BE TWO REGEXES, AND AN APOSTROPHE BROKE THEM (found at `ddjp_692`, fixed at 693). Only WHOLE-LINE comments
// were dropped, and strings were blanked by pairing quote marks across the whole file (`"[^"]*"`, then `'[^']*'`) — so an
// apostrophe in a trailing comment ("the bot's level") opened a "string" that ran to the next quote mark, lines away. Code
// inside it was blanked, so a real violation there was HIDDEN; and every pairing after it shifted, so a string's or a
// comment's text came out as code — a FALSE FAILURE (at 692 it exposed an old comment naming `RoomUpgrade._running`).
// NOW ONE LEFT-TO-RIGHT PASS tells code, comments (`//…`, `/*…*/`, wherever they sit), strings ('…' and "…", which end at
// their line), template literals (their text is a string, their `${…}` is code) and regular expressions apart, the way a
// parser does; a newline is kept wherever one was, so a line stays a line. `code` keeps string text (rules A–F, H, as
// before); `bare` blanks it (rule G). PART 0 below drives the reader on fixtures before any rule reads a file.
// A `/` begins a regular expression where a value cannot end — after an operator, an opener, a comma, a keyword such as
// `return` — and divides anywhere else; a wrong guess is contained to its line, because a string ends at its line.
const _REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
function lexJs(src) {
  let code = "", bare = "", i = 0, depth = 0, prev = "", prev2 = "", word = "", lastWord = "";
  const n = src.length, tpl = [];
  const emit = (c) => { code += c; bare += c; };
  const sig = (c) => { prev2 = prev; prev = c; };
  const regexHere = () => {
    if (prev === "") return true;
    if ((prev === "+" || prev === "-") && prev2 === prev) return false;   // `a++ / b`
    if (/[(,=:[!&|?{};+\-*%<>~^]/.test(prev)) return true;
    if (/[A-Za-z0-9_$]/.test(prev)) return _REGEX_AFTER_WORD.has(lastWord);
    return false;   // after ) ] } or a literal: a division
  };
  const template = (j) => {   // template text from j; back at the closing backtick, or at the `${` of an expression
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") { code += src.slice(j, j + 2); if (src[j + 1] === "\n") bare += "\n"; j += 2; continue; }
      if (ch === "`") { emit("`"); sig("a"); lastWord = ""; return j + 1; }
      if (ch === "$" && src[j + 1] === "{") { emit("${"); tpl.push(depth); sig("{"); return j + 2; }
      code += ch; if (ch === "\n") bare += "\n";
      j++;
    }
    return j;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (/[A-Za-z0-9_$]/.test(c)) { word += c; emit(c); sig(c); i++; continue; }
    if (word) { lastWord = word; word = ""; }
    if (c === "}" && tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); emit("}"); i = template(i + 1); continue; }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") emit("\n"); i++; } i += 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += (src[j] === "\\") ? 2 : 1;
      const end = (j < n && src[j] === c) ? j + 1 : j;   // a string ends at its quote, or (unclosed) at its line
      code += src.slice(i, end); bare += c + c;
      i = end; sig("a"); lastWord = ""; continue;
    }
    if (c === "`") { emit("`"); i = template(i + 1); continue; }
    if (c === "/" && regexHere()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n") {
        const ch = src[j];
        if (ch === "\\") { j += 2; continue; }
        if (cls) { if (ch === "]") cls = false; j++; continue; }
        if (ch === "[") { cls = true; j++; continue; }
        if (ch === "/") break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/.test(src[j])) j++;
      code += src.slice(i, j); bare += "/ /";
      i = j; sig("a"); lastWord = ""; continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    emit(c);
    if (!/\s/.test(c)) { sig(c); lastWord = ""; }
    i++;
  }
  return { code, bare };
}
function readStripped(rel) { return lexJs(fs.readFileSync(path.join(ROOT, rel), "utf8")).code; }
function readStrippedNoStr(rel) { return lexJs(fs.readFileSync(path.join(ROOT, rel), "utf8")).bare; }

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
  "MatrixBridge", "MatrixAccount", "StreamManager", "StateDeriver", "EventCache", "ConsensusHash", "VouchVerify", "CheckpointEngine", "Recovery",
];
for (const rel of CORE) {
  const s = readStripped(rel);
  for (const id of CORE_FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\s*\\.").test(s))
      violations.push([rel, "uses " + id + " — core/ is shared infra and must not depend on features/ or the backend (dependencies point downward only)"]);
  }
}

// Rule D — ui/ goes through feature modules only (never the backend, interface or internal)
// `MatrixAccount` JOINED THIS LIST AT J59, IN THE SAME CHANGE AS THE FILE. The split moved login,
// SSO, account switching, DM scope, avatars and recovery keys out of `matrixbridge.js` — so the
// moment the new global existed, every name on this wall covered one module less than the wall
// claims to. This guard's own header already records that shape: a stale list is a GAP THAT READS
// AS A WALL. Widening a population does not widen a grammar, and a LIST is a grammar (49th).
// `Backends` JOINED THIS LIST AT J23, IN THE SAME CHANGE AS `core/backends.js`. The seam's whole
// claim is that ui/ never names an engine (backend-selection.md §3): the UI reads capability
// descriptors and calls `perform(action)`, and whichever engine is bound serves them. A ui/ file
// that could call `Backends.bind` or `Backends.resolveMode` would be deciding which consensus
// model a room runs from the render layer. The header above already records why a list widened
// late is worse than one widened with the file — every name on this wall covered one module less
// than the wall claimed for as long as `MatrixAccount` existed without an entry.
const UI_FORBIDDEN = ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities", "Backends", "EventCache", "StateDeriver", "ConsensusHash", "VouchVerify", "CheckpointEngine", "Recovery"];
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

// Rule F — features/ use ONLY the backend interface (StreamManager + MatrixBridge + MatrixAccount),
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
      violations.push([rel, "uses backend internal " + id + " — features/ may touch the backend ONLY through its interface (StreamManager + MatrixBridge + MatrixAccount), so the backend stays swappable"]);
  }
}

// Rule G — the backend must not depend on the app (features/ui), so it drops into
// any app unchanged. (String literals are blanked first so the SDK event names
// "Room.timeline" / "Room.localEchoUpdated" / "Room.myMembership" don't false-fire.)
const APP_GLOBALS = ["Room", "Queue", "Skip", "Playback", "Reactions", "MediaLength", "MediaBlocked", "ServerClock", "UserQueue", "Playlists", "RoomUpgrade", "Media", "MetadataService", "Interface", "ChatBuffer"];

// ── PART 0 — THE READER, ASKED ON TEXT WHOSE ANSWER IS KNOWN (`ddjp_693`) ────────────────────────────────────────────
// A rule is only as good as the text it is handed, so the reader is driven here on every run, through the very
// expressions rules F and G apply: a violation planted AFTER a comment with an apostrophe is still code (the old reader
// hid it); a clean file whose comments carry apostrophes — with strings of both kinds holding names and the other quote,
// a template and a regular expression — shows rule G nothing (the old reader shifted and cried a violation); a template's
// `${…}` is code; a regex holding quotes and slashes ends where it ends; a name in a trailing comment is not code (rule F).
// Lines are kept, so rule H's per-line reading is unchanged. A wrong answer here fails the guard by name.
const READER_WRONG = [];
{
  const g = (text) => APP_GLOBALS.find((id) => new RegExp("\\b" + id + "\\s*\\.").test(lexJs(text).bare)) || null;
  const f = (text) => BACKEND_INTERNALS.find((id) => new RegExp("\\b" + id + "\\s*\\.").test(lexJs(text).code)) || null;
  const hidden = "const a = 1; // the bot's level\nRoom.getCurrent();\nconst b = 2; // isn't it\n";
  const clean = "x(); // it's here\nclient.on('Room.timeline', h); // that's it\nconst s = \"a 'quoted' Room.word\";\n" +
    "const t = `tpl ${ 'Room.inner' } and Room.textInTemplate`;\nconst r = /Room\\.x'/;\n/* a block that isn't\n   Room.inBlock */\ny(); // don't\n";
  if (g(hidden) !== "Room") READER_WRONG.push("a call planted after a comment with an apostrophe must read as code (rule G sees `Room.`): got " + g(hidden));
  if (g(clean) !== null) READER_WRONG.push("a clean file with apostrophes in its comments must show rule G nothing: it read `" + g(clean) + ".` as code");
  if (lexJs(clean).code.split("\n").length !== clean.split("\n").length) READER_WRONG.push("the reader must keep every line (rule H reads line by line)");
  if (g("const t = `a ${Room.x} b`;\n") !== "Room") READER_WRONG.push("a template's `${…}` is code: rule G must see `Room.` there");
  if (g("const re = /a'b\\/\\/c\"/; Room.after();\n") !== "Room") READER_WRONG.push("a regular expression holding quotes and slashes ends where it ends: the call after it is code");
  if (f("foo(); // StateDeriver.fold is the reducer's\n") !== null) READER_WRONG.push("a name in a trailing comment is not code (rule F)");
  if (f("StateDeriver.fold(x); // it's the reducer's\n") !== "StateDeriver") READER_WRONG.push("CONTROL — the same name as code before such a comment is seen (rule F)");
}
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

if (READER_WRONG.length) {
  for (const w of READER_WRONG) console.log("[boundaries] FAIL — PART 0, the reader: " + w);
  process.exit(1);
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
