// tests/run-all.js
// One command to run every architecture guard. Exits non-zero if any fail —
// wire this into a pre-commit hook or CI so violations can't land.
//
//   node tests/run-all.js

const { spawnSync } = require("child_process");
const path = require("path");

const guards = [
  "check-boundaries.js",
  "check-storage.js",
  "check-idb.js",
  "check-durability.js",
  "check-store.js",
  "check-windowedlist.js",
  "check-statederiver-purity.js",
  "check-convergence.js",
  "check-html-safety.js",
  "check-log-hygiene.js",
  "check-no-media.js",
  "check-content-policy.js",
  "check-robustness.js",
  "check-upgrade.js",
  "check-creation.js",
  "check-resume.js",
  "check-redaction.js",
  "check-chat-history.js",
  "check-channels.js",
  "check-authority.js",
  "check-dj-loop.js",
  "check-feature-flow.js",
];

console.log("DDJP architecture guards\n========================");

let failed = 0;
for (const g of guards) {
  const r = spawnSync(process.execPath, [path.join(__dirname, g)], { encoding: "utf8" });
  process.stdout.write(r.stdout || "");
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) failed++;
}

console.log("========================");
if (failed) {
  console.log("✗ " + failed + " guard(s) FAILED — see above.");
  process.exit(1);
}
console.log("✓ All guards passed.");
process.exit(0);
