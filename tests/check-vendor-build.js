// tests/check-vendor-build.js
// WALL: THE ONE INSTRUCTION A REVIEWER RUNS BEFORE READING ANY CODE STAYS CORRECT.
//
// `tools/build-vendor.sh` carries three fixes and NOTHING IN THIS SUITE COVERED IT — found by
// auditing the package rather than by a guard, which is the same gap in miniature: the suite is
// headless and passes whether or not the page can boot, so the script that makes it bootable was
// the one file no assertion touched.
//
// THE THREE, EACH A REAL DEFECT THAT SHIPPED:
//   A. `$1` defaulted to `./vendor-out`, so a bare `npm run build:vendor` completed cleanly and
//      left `lib/` empty — a green suite and a page that silently will not start. The v323 note
//      written to close that gap reproduced it.
//   B. `$1` was resolved AFTER the `cd` into a temp dir, so `build-vendor.sh lib` built into
//      `$WORK/lib`, printed "built into lib" with two correct SHA-256 sums, and deleted the lot on
//      the exit trap. Success reported, right destination named, nothing produced.
//   C. the install was a bare `npm install` in an empty temp project, so `matrix-js-sdk`'s twelve
//      CARET-RANGED dependencies floated and the recorded sums stopped reproducing. A
//      supply-chain check that fails for a benign reason cannot separate "upstream published a
//      patch" from "this tarball was tampered with".
//
// SOURCE-LEVEL AND HONEST ABOUT IT. This cannot run the build — that needs a network. It asserts
// the three properties a reader depends on, so a revert turns the suite red instead of turning a
// reviewer's afternoon into a mystery.

const fs = require("fs");
const path = require("path");
const DOCS = require("./_docs");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[vendor-build] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const ROOT = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(ROOT, "tools", "build-vendor.sh"), "utf8");
// Comments stripped: an assertion that matches the paragraph explaining a rule, rather than the
// rule, is this project's most-recorded guard failure.
const sh = raw.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const prov = fs.readFileSync(path.join(ROOT, "tools", "VENDOR_PROVENANCE.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

// ── A — THE OUTPUT DIRECTORY IS RESOLVED BEFORE THE `cd` ─────────────────────────────────────
{
  const cdIdx = sh.indexOf('cd "$WORK"');
  const outIdx = sh.indexOf('OUT_DIR=');
  ok(outIdx > 0 && cdIdx > 0, "A: APPLIED — both the assignment and the cd were located",
    { outIdx, cdIdx });
  ok(outIdx < cdIdx,
    "A: `OUT_DIR` is resolved BEFORE the script changes directory. Resolved after, a relative "
    + "argument lands inside the temp working dir and is deleted by the exit trap — the build "
    + "reports success, names the right destination, and produces nothing", { outIdx, cdIdx });
  ok(/case "\$OUT_DIR" in[\s\S]{0,120}\$\(pwd\)\/\$OUT_DIR/.test(sh),
    "A: and a RELATIVE argument is made absolute against the invocation directory, so the "
    + "documented `npm run build:vendor -- lib` works rather than silently producing nothing");
}

// ── B — THE DOCUMENTED COMMAND NAMES A DESTINATION ───────────────────────────────────────────
// Both places a reader is sent must give the argument. The default is `vendor-out`, which is NOT
// where `index.html` looks, so a command without it leaves the page unable to start.
{
  const wanted = "npm run build:vendor -- lib";
  // RESOLVED, NOT NAMED. This read `docs_343` as a literal, so it threw ENOENT on the first
  // package that renumbered — which every package does, because a package name tracks the tree.
  // The shared resolver is `tests/_docs.js`; see its header for why three guards had three answers.
  const reviewerPaths = DOCS.docPaths("REVIEWER-HANDOFF.md");
  ok(reviewerPaths.length > 0,
    "B: the doc tree must be reachable — the docs ship with the tree, so absence is a broken " +
    "package rather than a reason to pass. Looked in: " + DOCS.searchedFor("REVIEWER-HANDOFF.md").join(", "));
  const reviewer = reviewerPaths.length ? fs.readFileSync(reviewerPaths[0], "utf8") : "";
  ok(reviewer.indexOf(wanted) >= 0,
    "B: the audit recipe gives the destination explicitly. Without it the build writes to "
    + "`vendor-out/` and `lib/` stays empty, which is a green suite over a page that will not boot");
  ok(prov.indexOf(wanted) >= 0,
    "B: and so does the provenance file, which is where the copy step used to live alone — the "
    + "instruction existed and the reader was sent somewhere else");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(/src="lib\/matrix-sdk\.bundle\.js"/.test(html),
    "B: APPLIED — `index.html` really does load from `lib/`, which is what makes the destination "
    + "load-bearing rather than a preference");
}

// ── C — THE BUILD IS PINNED BY THE SHIPPED LOCKFILE ──────────────────────────────────────────
{
  ok(/npm ci\b/.test(sh),
    "C: the install is `npm ci` against the shipped lockfile. A bare `npm install` in an empty "
    + "temp project lets `matrix-js-sdk`'s caret-ranged dependencies float, and the bundle inlines "
    + "all of them — so the recorded SHA-256 stops reproducing while both DIRECT versions are "
    + "still pinned exactly");
  ok(/cp "\$REPO_ROOT\/package\.json" "\$REPO_ROOT\/package-lock\.json"/.test(sh),
    "C: and the lockfile is actually carried into the temp build — `npm ci` without one is an "
    + "error, not a floating install, but the copy is what makes the pin reach the bundler");

  // THE PIN ASSERTION HAS TEETH ONLY IF THE VERSIONS REALLY AGREE. Checked against BOTH files,
  // because the script compares itself to `package.json` and the lockfile is what `npm ci` obeys.
  const PAIRS = [["matrix-js-sdk", "MATRIX_JS_SDK_VERSION"],
                 ["@matrix-org/matrix-sdk-crypto-wasm", "CRYPTO_WASM_VERSION"]];
  for (const [dep, varName] of PAIRS) {
    const m = sh.match(new RegExp(varName + '="([^"]+)"'));
    ok(!!m, "C: APPLIED — " + varName + " is declared in the script", m && m[1]);
    if (!m) continue;
    const inPkg = (pkg.devDependencies || {})[dep];
    const inLock = (lock.packages || {})["node_modules/" + dep];
    ok(m[1] === inPkg,
      "C: `" + dep + "` agrees between the script and package.json — the script refuses to build "
      + "when they diverge, and that refusal is worthless if they were already apart",
      { script: m[1], packageJson: inPkg });
    ok(inLock && inLock.version === m[1],
      "C: and the LOCKFILE pins the same version — `npm ci` obeys the lockfile, so a lockfile "
      + "naming something else would build a bundle whose provenance rows are wrong",
      { script: m[1], lockfile: inLock && inLock.version });
    ok(prov.indexOf(m[1]) >= 0,
      "C: and `VENDOR_PROVENANCE.md` records that version, so the sums in it belong to the build "
      + "this script performs", m[1]);
  }
}

// ── D — THE SUMS ARE STILL PRESENT TO COMPARE AGAINST ────────────────────────────────────────
// The whole point of C is that a mismatch becomes a real signal. That needs something to compare
// to, and the WASM sum is the one this session verified reproduces byte-for-byte.
{
  const sums = prov.match(/\b[0-9a-f]{64}\b/g) || [];
  ok(sums.length >= 2,
    "D: the provenance file still records a SHA-256 for both artefacts. Without them the "
    + "reproducibility fix has nothing to prove itself against", sums.length);
  ok(/sha256sum/.test(sh),
    "D: and the script still prints sums for the reader to compare — the check is only performed "
    + "by a person, so removing the print removes the check");
}

if (failed) process.exit(1);
console.log("[vendor-build] PASS — the instruction a reviewer runs before reading any code stays "
  + "correct. `OUT_DIR` is resolved BEFORE the `cd`, so a relative argument is not built into the "
  + "temp dir and deleted by the exit trap — which once printed success with two correct sums and "
  + "produced nothing. Both places a reader is sent name the destination explicitly, because the "
  + "default is not where `index.html` loads from and a bare invocation leaves a green suite over "
  + "a page that will not start. The build runs `npm ci` against the shipped lockfile, so the "
  + "twelve caret-ranged transitive dependencies the bundle inlines cannot float and the recorded "
  + "sums keep reproducing; the two pinned versions are asserted to agree across the script, "
  + "package.json, the lockfile AND the provenance rows, so the script's own refusal has something "
  + "true to refuse from. This file exists because the audit found `build-vendor.sh` was the one "
  + "changed file no guard touched (" + A + " assertions)");
