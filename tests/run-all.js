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
  "check-image-cache.js",
  "check-metadata-service.js",
  "check-thumbnail-provider.js",
  "check-durability.js",
  "check-store.js",
  "check-windowedlist.js",
  "check-statederiver-purity.js",
  "check-convergence.js",
  "check-room-history.js",
  "check-html-safety.js",
  "check-log-hygiene.js",
  "check-no-media.js",
  "check-content-policy.js",
  "check-robustness.js",
  "check-upgrade.js",
  "check-creation.js",
  "check-resume.js",
  "check-redaction.js",
  "check-account-isolation.js",
  "check-chat-history.js",
  "check-chat-buffer.js",
  "check-chat-prefs.js",
  "check-channels.js",
  "check-channel-taxonomy.js",
  "check-authority.js",
  "check-dj-loop.js",
  "check-playback-end.js",
  "check-feature-flow.js",
  "check-reconcile-order.js",
  "check-reactions.js",
  "check-chat-crypto.js",
  "check-playlists.js",
  "check-playlist-import.js",
  "check-playlists-feature.js",
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
