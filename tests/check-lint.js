// tests/check-lint.js
// WALL: THE TREE LINTS CLEAN, AND THE LINTER ACTUALLY RAN.
//
// ── WHY THIS EXISTS: A CLASS THE SUITE STRUCTURALLY CANNOT SEE ──────────────────────────────
// **Two of the last twenty releases were killed by defects every standard JavaScript
// configuration reports as errors by default**, and both shipped with 139 guards green:
//
//   v280  `no-undef`             — `refs.settingsBody`, one undefined ref. Seven downstream calls
//                                  in `enterMainScreen` skipped. Three separate bug reports.
//   v288  `no-use-before-define` — a `const` read twelve lines above its declaration, throwing on
//                                  every render from first room open.
//
// Both killed an entire render chain. Both were found by a browser, not by this suite. **This is
// the second time the suite's method has decided what could be found** — kick and ban were absent
// for the project's life because `check-capabilities` needed a fold to compare against. The linter
// is an INSTRUMENT that closes a class the suite cannot reach, alongside the browser, and belongs
// in the same category rather than on a chore list.
//
// ── `node --check` WAS THE FREE CANDIDATE AND IT IS NOT ADEQUATE ───────────────────────────
// Driven, both defects reproduced in isolation: **both parse cleanly.** `node --check` over every
// shipped file costs nothing, needs no dependency, and would have caught NEITHER. The candidate is
// closed by measurement rather than dismissed by preference.
//
// ── NOT INSTALLED IS A FAILURE, NOT A SKIP ─────────────────────────────────────────────────
// This tree ships no `node_modules` — the app needs no npm install to run, and `package.json`'s own
// description says devDependencies exist for audit tooling. So the linter is a real dependency, and
// **a guard that silently skips when it is missing reports green on a fresh extraction while
// checking nothing** — this project's most-recorded failure. Absence IS the failure, and the
// message names the one command that fixes it.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

let asserts = 0;
function fail(msg, got) {
  console.log("[lint] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + (typeof got === "string" ? got : JSON.stringify(got)));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "node_modules", ".bin", "eslint");

// ── THE DEPENDENCY, AND THE DISTINCTION THAT MATTERS ────────────────────────────────────────
// "eslint is not installed" and "the tree lints clean" must never look alike.
ok(fs.existsSync(BIN),
  "ESLINT IS NOT INSTALLED, so nothing was linted. This is a FAILURE and not a skip: a guard that " +
  "passed here would report green on a fresh extraction while checking nothing, which is this " +
  "project's most-recorded shape. Fix with ONE COMMAND:\n" +
  "      npm install --no-save eslint@8\n" +
  "      (or `npm install` — it is a devDependency in package.json)",
  BIN);

const { build, EXTERNAL_GLOBALS, EXEMPTIONS } = require(path.join(ROOT, "tools", "lint-config.js"));
const { knownGlobals } = require(path.join(ROOT, "tools", "lint-globals.js"));

// ── THE CONFIG IS DERIVED AND GENERATED, SO IT CANNOT DRIFT ────────────────────────────────
const globals = knownGlobals();
ok(globals.length > 40,
  "APPLIED — the globals must be read from `tests/_load.js`'s KNOWN_GLOBALS, or `no-undef` " +
  "reports 1649 findings that are all the same non-fact and the run is unreadable", globals.length);
ok(globals.indexOf("Interface") >= 0,
  "APPLIED — `Interface` must be in that list. The linter FOUND it missing: `ui/interface.js` " +
  "declares it and `check-reputation` PART F only sweeps FEATURE modules, so nothing caught it. " +
  "That is a v280-shaped gap — a name nothing resolved", globals.slice(-3));
const cfg = build();
ok(cfg.extends === "eslint:recommended",
  "APPLIED — the DEFAULT recommended set, not a narrowed one. Tuning a rule set until it goes " +
  "quiet is the wolf-crying failure inverted", cfg.extends);

// ── THE EXEMPTION LIST IS EXHAUSTIVE, AND EACH ENTRY CARRIES ITS REASON ────────────────────
// `check-control-styling`'s discipline, unchanged. A relaxed rule that nobody wrote a reason for
// is how a list of one becomes a list of twenty.
ok(Object.keys(EXEMPTIONS).length === 2,
  "EXACTLY TWO EXEMPTIONS EXIST — one relaxed rule and one PARKED finding — and the list is " +
  "asserted exhaustive so a new one cannot join " +
  "silently", Object.keys(EXEMPTIONS));
for (const k of Object.keys(EXEMPTIONS)) {
  ok(EXEMPTIONS[k].length > 120,
    "and `" + k + "` carries a REASON rather than a name — the difference between a decision and " +
    "a switch somebody flipped", EXEMPTIONS[k]);
}
ok(cfg.rules["no-empty"][1].allowEmptyCatch === true,
  "APPLIED — the exemption is actually applied in the config it describes", cfg.rules["no-empty"]);
ok(cfg.rules["no-redeclare"] && cfg.rules["no-unused-vars"],
  "and `no-redeclare` / `no-unused-vars` are CONFIGURED, not disabled — they are two halves of " +
  "one property with `no-undef`, and disabling half is the asymmetry that lets a defect through",
  Object.keys(cfg.rules));
for (const n of Object.keys(EXTERNAL_GLOBALS)) {
  ok(EXTERNAL_GLOBALS[n].length > 30,
    "and every non-module global names WHAT IT IS — `" + n + "`", EXTERNAL_GLOBALS[n]);
}

// ── THE RUN. Lint only; never `--fix`. ─────────────────────────────────────────────────────
// Guards extract functions from `ui/interface.js` by name and brace-match from them, and several
// read source as text. A reformat makes those REFUSE rather than fail — and a refusal reads like a
// pass to anyone not watching. No rule here requires touching an extracted region.
const rcPath = path.join(os.tmpdir(), "ddjp-eslintrc-" + process.pid + ".json");
fs.writeFileSync(rcPath, JSON.stringify(cfg));
const TARGETS = ["core/**/*.js", "features/**/*.js", "backends/**/*.js", "ui/**/*.js", "app.js"];
let out = "";
try {
  out = execFileSync(BIN, ["--no-eslintrc", "-c", rcPath, "--format", "json"].concat(TARGETS),
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  out = (e.stdout || "").toString();
  if (!out) fail("eslint could not be run at all — " + (e.message || "unknown"), BIN);
}
let report;
try { report = JSON.parse(out); } catch (e) { fail("eslint produced no readable report", out.slice(0, 300)); }

ok(Array.isArray(report) && report.length > 30,
  "APPLIED — the run must have covered the tree's files, or a clean result means the glob missed " +
  "rather than that the code is clean", report ? report.length : 0);

const problems = [];
for (const f of report) {
  for (const m of f.messages) {
    problems.push(path.relative(ROOT, f.filePath) + ":" + m.line + "  " + m.ruleId + " — " + m.message);
  }
}
ok(problems.length === 0,
  "THE TREE LINTS CLEAN under the default recommended set. Every finding here is a defect of the " +
  "kind that killed two of the last twenty releases with the suite green",
  problems.slice(0, 12).join("\n      "));

try { fs.unlinkSync(rcPath); } catch (e) { /* the temp file is not load-bearing */ }

// ── KNOWN_GLOBALS IS EXHAUSTIVE, AND NOTHING WAS CHECKING THAT ──────────────────────────────
// `tests/_load.js` tells the next person "adding a feature module means adding it here, and
// `check-load-globals.js` fails on a module that declares a top-level global this list does not
// name, so the next one is caught at the wall." **`check-load-globals.js` does not exist and never
// has.** The comment is the more expensive half: it tells a reader the omission is caught, so they
// do not check by hand — and the exposer swallows a ReferenceError per name on purpose, which is
// exactly what makes the omission silent. J18's `BotSettings` produced "Cannot read properties of
// undefined" in a guard whose module list was correct, which is the failure this was meant to stop
// recurring.
//
// This is the wall the harness names. It lives here because this file already DERIVES its config
// from KNOWN_GLOBALS, so the list is loaded either way and a second reader would be a second copy.
{
  const loadSrc = fs.readFileSync(path.join(ROOT, "tests", "_load.js"), "utf8");
  const m = loadSrc.match(/const KNOWN_GLOBALS = \[([\s\S]*?)\n\];/);
  ok(!!m, "GLOBALS: KNOWN_GLOBALS must be readable from tests/_load.js");
  const known = new Set([...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]));
  ok(known.size > 20, "GLOBALS: APPLIED — the list must be a real set", known.size);

  const walk = (d, out) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = d + "/" + e.name;
      if (e.isDirectory()) walk(rel, out);
      else if (e.name.endsWith(".js")) out.push(rel);
    }
    return out;
  };
  const mods = ["core", "backends/backend1", "features", "ui"].reduce((a, d) => walk(d, a), []);
  ok(mods.length > 20, "GLOBALS: APPLIED — the module scan must reach the tree", mods.length);

  const missing = [];
  for (const rel of mods) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    // The module pattern this tree uses everywhere: `const Name = (() => { ... })();`
    const d = src.match(/^const ([A-Z][A-Za-z]*) = \(\(\) =>/m);
    if (d && !known.has(d[1])) missing.push(d[1] + " (" + rel + ")");
  }
  ok(missing.length === 0,
    "GLOBALS: every module global must be named in KNOWN_GLOBALS. A module missing from it is " +
    "loaded by guards and silently absent from the sandbox — the exposer swallows the " +
    "ReferenceError, so the failure lands as a TypeError somewhere else entirely", missing);
}

console.log("[lint] PASS — the tree lints clean and the linter actually ran (" + asserts +
  " assertions). **TWO OF THE LAST TWENTY RELEASES SHIPPED A DEFAULT LINT ERROR WITH THE SUITE " +
  "GREEN**: v280's `no-undef` and v288's `no-use-before-define`, each killing an entire render " +
  "chain and each found by a browser. `node --check` was the free candidate and is CLOSED BY " +
  "MEASUREMENT — both defects parse cleanly, so it would have caught neither. The globals are " +
  "DERIVED from `tests/_load.js`'s KNOWN_GLOBALS, which turned 1914 findings into 387 and " +
  "declined a second hand-written list; the config is GENERATED so it cannot drift. The linter " +
  "found `Interface` missing from that list — a real gap `check-reputation` PART F could not see. " +
  "Exactly ONE rule is relaxed, with its reason beside it and the list asserted exhaustive. AND " +
  "NOT INSTALLED IS A FAILURE, NOT A SKIP: a guard that passed on a missing dependency would " +
  "report green on a fresh extraction while checking nothing. AND KNOWN_GLOBALS IS NOW " +
  "ASSERTED EXHAUSTIVE HERE: `tests/_load.js` promised a `check-load-globals.js` that has never " +
  "existed, which is worse than no promise — it tells a reader the omission is caught and so they " +
  "do not check by hand");
