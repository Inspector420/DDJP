// tests/check-bump-args.js
// SUBJECT: tools/bump-version.js
// WALL: ASKING THE BUMP TOOL FOR HELP DOES NOT BUMP (J73 job 1b).
//
// `tools/bump-version.js` ignored its arguments, so `node tools/bump-version.js --help` bumped every
// `?v=` tag and wrote `.last-bump` — it happened in J73 job 1's packaging, and the auditor drove it
// again (479 -> 480). A session asking how to use the tool must not change the deploy version. So
// the tool now prints its usage for `--help` / `-h` and refuses anything else, bumping nothing.
// Each case runs a COPY of the tool against a COPY of index.html in a temporary directory; the real
// tree is never touched. A no-argument control run must bump, or the copy proves nothing.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bump-args] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bump-args-"));
  fs.mkdirSync(path.join(d, "tools"));
  fs.copyFileSync(path.join(ROOT, "tools", "bump-version.js"), path.join(d, "tools", "bump-version.js"));
  fs.copyFileSync(path.join(ROOT, "index.html"), path.join(d, "index.html"));
  return d;
}
function run(args) {
  const d = sandbox();
  const before = fs.readFileSync(path.join(d, "index.html"), "utf8");
  const r = spawnSync("node", [path.join(d, "tools", "bump-version.js")].concat(args), { encoding: "utf8", timeout: 30000 });
  const after = fs.readFileSync(path.join(d, "index.html"), "utf8");
  const stamp = fs.existsSync(path.join(d, ".last-bump"));
  fs.rmSync(d, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), changed: after !== before, stamp: stamp };
}
for (const a of [["--help"], ["-h"]]) {
  const r = run(a);
  ok(r.code === 0 && !r.changed && !r.stamp, a[0] + " prints usage and exits 0 WITHOUT bumping or writing .last-bump", r);
  ok(/USAGE/.test(r.out), a[0] + " prints the usage", r.out.slice(0, 200));
}
for (const a of [["--bogus"], ["480"], ["--help", "--force"]]) {
  const r = run(a);
  ok(r.code !== 0 && !r.changed && !r.stamp, JSON.stringify(a) + " is refused: non-zero exit, nothing bumped, no .last-bump", r);
  ok(/unknown argument/.test(r.out), JSON.stringify(a) + " names the argument it refused", r.out.slice(0, 200));
}
const ctl = run([]);
ok(ctl.code === 0 && ctl.changed && ctl.stamp, "CONTROL: with no arguments the copy DOES bump and stamp — the sandbox works", ctl);
if (failed) { console.log("[bump-args] " + failed + " failure(s)"); process.exit(1); }
console.log("[bump-args] PASS — asking the bump tool for help does not bump: --help and -h print the usage and change " +
  "nothing, any other argument is refused with nothing bumped and no .last-bump, and with no arguments a copy of the " +
  "tool still bumps (" + asserts + " assertions)");
