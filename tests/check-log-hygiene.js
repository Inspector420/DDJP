// tests/check-log-hygiene.js
// WALL: no secrets in logs. Fails the build if a Logger.* OR console.* call is
// passed a known secret *variable* (token, password, recovery/secret-storage key).
// String literals are ignored — `Logger.warn("wrong password")` is fine; what's
// caught is interpolating an actual secret value, e.g. `console.log("tok " + accessToken)`.
//
// This pairs with the redaction in core/logger.js (defence in depth): the logger
// scrubs known secret SHAPES at runtime in BOTH the in-app log panel and the F12
// console (it wraps console.*), while this guard stops a secret VARIABLE from being
// handed to a log call in the first place. Together: a normal "here's my logs" share
// — panel or console — can't contain a token or key.
//
// Note: it does not police matrix-js-sdk's own console logging at the source, but
// the runtime console wrapper redacts the SDK's string output too.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const violations = [];

// Files that may call Logger.* — the layered modules plus the externalized bootstrap.
function listJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}
const FILES = [
  ...listJs("core"), ...listJs("features"), ...listJs("ui"), ...listJs("transport"),
  ...(fs.existsSync(path.join(ROOT, "app.js")) ? ["app.js"] : []),
];

// Secret identifiers that must never be passed to a log call.
const SECRET_IDS = [
  "_ssKey", "_loginPassword", "_pendingNewKey",
  "accessToken", "access_token", "refreshToken", "refresh_token",
  "recoveryKey", "encodedPrivateKey", "privateKey", "pickleKey",
  "password", // bare variable; literal "password" survives string-stripping below
];

// Remove string-literal contents so a secret word inside a message string isn't
// mistaken for a variable reference.
function stripStrings(line) {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const LOGGER_CALL = /\b(?:Logger\.(?:debug|info|warn|error)|console\.(?:log|info|warn|error|debug))\s*\(/;

for (const rel of FILES) {
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!LOGGER_CALL.test(line)) return;
    const code = stripStrings(line);
    for (const id of SECRET_IDS) {
      if (new RegExp("\\b" + id + "\\b").test(code)) {
        violations.push([rel, i + 1, id]);
      }
    }
  });
}

if (violations.length) {
  console.log("[log-hygiene] FAIL — " + violations.length + " log call(s) may leak a secret:");
  for (const [file, ln, id] of violations) {
    console.log("  ✗ " + file + ":" + ln + " — passes `" + id + "` to a Logger call (log the event, not the value)");
  }
  process.exit(1);
}

console.log("[log-hygiene] PASS — no token/key/password variable reaches a log call (" + FILES.length + " files scanned)");
process.exit(0);
