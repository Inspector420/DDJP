// tests/check-storage.js
// WALL: the storage boundary — the exact mirror of the SDK boundary in
// check-boundaries. Storage engines are private; everything above the storage
// layer must go through the `Store` facade and never touch an engine or the raw
// browser stores. Fails the build if any module in features/ or ui/ references
// `localStorage`, `indexedDB`, `StorageIO`, `IDB`, or `EventCache` directly.
//
// Why these five: `localStorage`/`indexedDB` are the raw browser engines;
// `StorageIO` and `IDB` are the private engine wrappers `Store` owns; `EventCache`
// is the raw-event engine (lives in transport today, migrates behind Store.events
// later) — no feature or UI module should ever reach any of them. (Spec: 09 §1;
// CLAUDE.md "Storage boundary".)
//
// Scope is features/ + ui/ ONLY — core/ legitimately contains the engines and
// the facade, and transport/ still holds the session handle + EventCache until
// those move behind Store in a later increment. To extend: add an identifier to
// FORBIDDEN below.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

// Strip whole-line comments so a rule isn't tripped by prose like
// "// Depends on: ... Store ..." or a historical mention in a header.
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

const SCOPED = [...listJs("features"), ...listJs("ui")];

if (SCOPED.length === 0) {
  console.log("[storage] could not find features/ or ui/ under " + ROOT + " — run from repo root.");
  process.exit(2);
}

// Word-bounded so `IDB` doesn't match identifiers like `copyIdBtn`, and so a
// substring inside another word never trips the rule.
const FORBIDDEN = [
  ["localStorage", "the raw localStorage engine"],
  ["indexedDB", "the raw IndexedDB engine"],
  ["StorageIO", "the private localStorage engine"],
  ["IDB", "the private IndexedDB engine"],
  ["EventCache", "the raw-event engine"],
];

for (const rel of SCOPED) {
  const s = readStripped(rel);
  for (const [id, what] of FORBIDDEN) {
    if (new RegExp("\\b" + id + "\\b").test(s))
      violations.push([rel, "references " + id + " (" + what + ") — features/ and ui/ must go through the Store facade, never an engine"]);
  }
}

// Chat ephemerality: chat is RAM-only and reloaded from Matrix; decrypted text
// must never be persisted (preserves the E2E/ephemeral property and makes
// cleared-on-boot automatic). So the chat feature must not reach storage AT ALL
// — not even the Store facade. This is stricter than the engine ban above: it
// also forbids `Store`, so no chat domain can quietly start caching plaintext.
const chatRel = "features/chat.js";
if (fs.existsSync(path.join(ROOT, chatRel))) {
  const s = readStripped(chatRel);
  if (/\bStore\b/.test(s))
    violations.push([chatRel, "references Store — chat must stay ephemeral (RAM + Matrix only); decrypted text is never persisted"]);
}

if (violations.length) {
  console.log("[storage] FAIL — " + violations.length + " storage-boundary violation(s):");
  for (const [file, why] of violations) console.log("  ✗ " + file + "\n      " + why);
  process.exit(1);
}

console.log("[storage] PASS — features/ and ui/ reach storage only through the Store facade (" + SCOPED.length + " files scanned)");
process.exit(0);
