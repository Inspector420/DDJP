// tests/check-html-safety.js
// WALL: HTML-injection protection. Network-derived strings (Matrix IDs, display
// names, message bodies, event fields) must never flow into innerHTML — they go
// in via textContent / createTextNode only. This guard fails on any *dynamic*
// innerHTML assignment in the DOM layers (features/, ui/). A constant string
// literal is allowed (developer-controlled); anything with a variable, a `+`,
// or a template `${}` is rejected.
//
// Reading `.innerHTML` (e.g. the textContent-escape trick in chat.js) is fine —
// only assignment is dangerous, so only assignment is checked.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

function lines(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    });
}

// A right-hand side that is exactly one quoted string literal (no interpolation).
function isConstantStringLiteral(rhs) {
  const s = rhs.trim().replace(/;\s*$/, "").trim();
  return /^(["'])(?:\\.|(?!\1).)*\1$/.test(s);
}

const FILES = [...listJs("features"), ...listJs("ui")];
if (FILES.length === 0) {
  console.log("[html-safety] could not find features/ or ui/ — run from your repo root.");
  process.exit(2);
}

for (const rel of FILES) {
  lines(rel).forEach((line, i) => {
    // match `.innerHTML =` or `.innerHTML +=` (assignment, not comparison)
    const m = line.match(/\.innerHTML\s*\+?=\s*(?!=)(.*)$/);
    if (!m) return;
    if (!isConstantStringLiteral(m[1])) {
      violations.push([rel + ":" + (i + 1), "dynamic innerHTML assignment — use textContent/createTextNode for any network-derived string: " + line.trim()]);
    }
  });
}

if (violations.length) {
  console.log("[html-safety] FAIL — " + violations.length + " unsafe innerHTML assignment(s):");
  for (const [where, why] of violations) console.log("  ✗ " + where + "\n      " + why);
  process.exit(1);
}

console.log("[html-safety] PASS — no dynamic innerHTML assignments in the DOM layers");
process.exit(0);
