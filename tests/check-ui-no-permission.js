// tests/check-ui-no-permission.js
// WALL: the UI must never DECIDE a permission. All "may this user do X" logic lives
// in the capability system (Capabilities.can) and is reached only through the Actions
// adapter (Actions.describe / Actions.perform). The UI is a renderer: it reads
// descriptors and dispatches actions. This guard fails the build if a rank comparison,
// a feature permission predicate, or a direct capability/backend call reappears in ui/.
//
// DISPLAY uses of rank are allowed — showing a rank name/colour, passing a level to a
// formatter — because those decide nothing. Only COMPARISONS and permission calls are
// forbidden.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

// Strip whole-line comments so prose like "// Staff+ may..." doesn't fire.
function readStripped(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").map((line) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
    // also drop trailing // comments (best-effort; keeps http:// intact)
    return line.replace(/([^:])\/\/.*$/, "$1");
  });
}

const UI = listJs("ui");
const violations = [];

// Forbidden patterns — each is a way the UI would be DECIDING a permission.
const RULES = [
  { re: /getMyRank\s*\([^)]*\)\s*(===|!==|==|!=|<=|>=|<|>)/, msg: "compares getMyRank() — rank decisions belong to the capability system (Actions.describe), not the UI" },
  { re: /(<=|>=|<|>|===|!==|==|!=)\s*(OWNER|HIGH_STAFF|STAFF|VIP|PLAYER|GUEST)\b/, msg: "compares against a rank threshold constant — use Actions.describe(...).enabled" },
  { re: /\b(OWNER|HIGH_STAFF|STAFF|VIP|PLAYER|GUEST)\s*(<=|>=|<|>)/, msg: "compares a rank threshold constant — use Actions.describe(...).enabled" },
  { re: /\.canSkip\s*\(|\.canAssignRank\s*\(/, msg: "calls a feature permission predicate — the rule now comes from Actions.describe(...).enabled" },
  { re: /\bCapabilities\s*\./, msg: "calls Capabilities directly — the UI must go through the Actions adapter" },
];

for (const rel of UI) {
  const lines = readStripped(rel);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) violations.push([rel + ":" + (i + 1), rule.msg, line.trim().slice(0, 90)]);
    }
  });
}

if (violations.length) {
  console.log("[ui-no-permission] FAIL — " + violations.length + " permission decision(s) in the UI:");
  for (const [where, why, snippet] of violations) console.log("  \u2717 " + where + "\n      " + why + "\n      > " + snippet);
  process.exit(1);
}

console.log("[ui-no-permission] PASS — the UI decides no permissions; all gating flows through Actions.describe / Actions.perform (" + UI.length + " ui files scanned)");
process.exit(0);
