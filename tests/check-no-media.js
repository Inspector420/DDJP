// tests/check-no-media.js
// WALL: no media over Matrix. DDJP carries compact text protocol only — never
// files, images, audio, or video through Matrix channels. This is a hard
// constraint, not a limitation to revisit. Playback is browser embeds; nothing
// streams through a homeserver.
//
// Fails if any module references a media-upload or media-message primitive.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

function readStripped(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    })
    .join("\n");
}

const FORBIDDEN = [
  ["uploadContent", "uploads media to a homeserver — DDJP carries text only"],
  ['"m.image"', "image message type — no media over Matrix"],
  ['"m.file"', "file message type — no media over Matrix"],
  ['"m.video"', "video message type — no media over Matrix"],
  ['"m.audio"', "audio message type — no media over Matrix"],
  ['"m.sticker"', "sticker message type — no media over Matrix"],
];

const FILES = [...listJs("core"), ...listJs("transport"), ...listJs("features"), ...listJs("ui")];
if (FILES.length === 0) {
  console.log("[no-media] could not find the source layout — run from your repo root.");
  process.exit(2);
}

// A line bearing this sentinel is an explicitly-blessed account-level exception
// (profile avatars — never protocol/song data; see 06_fundamentals.md). It
// exempts ONLY the annotated line, and ONLY the upload primitive — the media
// message-type tokens below are never exempt, anywhere.
const NO_MEDIA_OK = "no-media-ok:";
const EXEMPTABLE = new Set(["uploadContent"]);

for (const rel of FILES) {
  const src = readStripped(rel);
  const srcLines = src.split("\n");
  for (const [token, why] of FORBIDDEN) {
    if (!src.includes(token)) continue;
    // Re-scan line-by-line so an exemptable primitive can be cleared per-line by
    // the sentinel, while any unannotated use (or any media message type) fails.
    let flagged = false;
    for (const line of srcLines) {
      if (!line.includes(token)) continue;
      if (EXEMPTABLE.has(token) && line.includes(NO_MEDIA_OK)) continue; // blessed avatar line
      flagged = true;
      break;
    }
    if (flagged) violations.push([rel, token + " — " + why]);
  }
}

if (violations.length) {
  console.log("[no-media] FAIL — " + violations.length + " media-over-Matrix reference(s):");
  for (const [file, why] of violations) console.log("  ✗ " + file + "\n      " + why);
  process.exit(1);
}

console.log("[no-media] PASS — no media primitives; the protocol stays text-only");
process.exit(0);
