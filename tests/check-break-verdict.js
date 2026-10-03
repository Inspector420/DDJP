// tests/check-break-verdict.js
// SUBJECT: tools/probes/_verdict.js, tests/run-all.js
// WALL: A BREAK FILE JUDGES "RED" BY THE SUITE'S OWN RULE (J73, the `ddjp_521` audit).
//
// Nine break files each carried a copy of "exited non-zero and named the failure"; one guard printed its
// failure and exited 0 (a promise never settled), and the copy read GREEN (`mutate-j73-windows` W12). The
// suite's `verdictOf` (tests/run-all.js) already refuses an announced FAIL with exit 0, and silence — so
// break files ask it, through `tools/probes/_verdict.js`, and add only the named failure.
//   PART A — every break file asks the one rule, except the older ones named below, and none judges alone.
//   PART B — the older list only shrinks: a listed file that now asks the rule must leave the list.
//   PART C — the rule: failed-as-named, an announced failure that exited 0, silence, wrong failure, a pass.
//   PART D — it IS the suite's function, not a copy of it.
// THE OLDER BREAK FILES, recorded rather than converted at `ddjp_522`: written before this rule, judged in
// several shapes (a whole-suite run per row read from its summary; a guard that throws read as red); three
// must not be run at all (j11-redact, j12-tiers, j13-feed hang). Converting them means re-running them.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[break-verdict] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const OLDER = [   "mutate-activity-source.js",   "mutate-blocked-reason.js",   "mutate-br-botruntime.js",   "mutate-controls.js",   "mutate-dm-gaps.js",   "mutate-j11-redact.js",   "mutate-j12-tiers.js",   "mutate-j13-feed.js",   "mutate-j14-card.js",   "mutate-j15-dm.js",   "mutate-j16-active.js",   "mutate-j17-lattice.js",   "mutate-j17-schema.js",   "mutate-j17-settings.js",   "mutate-j18-request.js",   "mutate-j19-reputation.js",   "mutate-j25-savefile.js",   "mutate-j25-settings-coupling.js",   "mutate-j26-export.js",   "mutate-j27-import.js",   "mutate-j28-override.js",   "mutate-j28-running.js",   "mutate-j37-redelivery.js",   "mutate-j39-boundaries.js",   "mutate-j41-wire.js",   "mutate-j46-fold.js",   "mutate-j48-endon.js",   "mutate-j49-confirm.js",   "mutate-min-dj-rank.js",   "mutate-nav-surfaces.js",   "mutate-one-window.js",   "mutate-settings-readback.js",   "mutate-ui-crash.js",   "mutate-v288.js",   "mutate-visual-reuse.js",  ];
const dir = path.join(ROOT, "tools", "probes");
const files = fs.readdirSync(dir).filter((f) => /^mutate-.*\.js$/.test(f)).sort();
const asks = (src) => /require\(path\.join\(__dirname, "_verdict\.js"\)\)/.test(src) && /redAsNamed\(/.test(src);
const judgesAlone = (src) => /code !== 0 && (named|out\.indexOf\(expect\))/.test(src);
// ── PART A ──────────────────────────────────────────────────────────────────────────────────
{
  const current = files.filter((f) => OLDER.indexOf(f) < 0);
  ok(current.length >= 9, "A PREMISE — the scan finds the break files written under the rule (at least nine)", current);
  const off = current.filter((f) => !asks(fs.readFileSync(path.join(dir, f), "utf8")));
  ok(off.length === 0, "A: every break file not on the older list judges red through _verdict.js", off);
  const alone = current.filter((f) => judgesAlone(fs.readFileSync(path.join(dir, f), "utf8")));
  ok(alone.length === 0, "A: and none still judges red with its own copy of the rule", alone);
}
// ── PART B ──────────────────────────────────────────────────────────────────────────────────
{
  const gone = OLDER.filter((f) => files.indexOf(f) < 0);
  ok(gone.length === 0, "B: every file on the older list still exists (remove the ones that do not)", gone);
  const converted = OLDER.filter((f) => files.indexOf(f) >= 0 && asks(fs.readFileSync(path.join(dir, f), "utf8")));
  ok(converted.length === 0, "B: a listed file that now asks the rule must leave the older list", converted);
}
// ── PART C ──────────────────────────────────────────────────────────────────────────────────
{
  const V = require(path.join(dir, "_verdict.js"));
  const m = (s, o, e) => V.redAsNamed(s, o, e).mark;
  ok(m(1, "[x] FAIL — A: the thing\n", "FAIL — A") === "RED", "C: exited non-zero, named — RED");
  ok(m(0, "[x] FAIL — A: the thing\n", "FAIL — A") === "RED", "C: announced its failure and exited 0 (the W12 case) — RED, not GREEN");
  ok(m(0, "", "FAIL — A") === "WRONG", "C: said nothing and exited 0 — not a pass, and not the named failure");
  ok(m(1, "[x] FAIL — B: another\n", "FAIL — A") === "WRONG", "C: failed, but not as named — WRONG");
  ok(m(0, "[x] PASS — all held\n", "FAIL — A") === "GREEN", "C: a pass — GREEN");
  ok(V.staysGreen(0, "[x] PASS — all held\n") === true && V.staysGreen(0, "") === false && V.staysGreen(0, "[x] FAIL — A\n") === false,
    "C: a no-change row stays green only when the suite would call it a pass");
}
// ── PART D ──────────────────────────────────────────────────────────────────────────────────
{
  const V = require(path.join(dir, "_verdict.js")), RA = require(path.join(ROOT, "tests", "run-all.js"));
  ok(typeof RA.verdictOf === "function" && V.verdictOf === RA.verdictOf, "D: the break files' rule IS run-all.js's verdictOf, not a copy");
}
if (failed) { console.log("[break-verdict] " + failed + " failure(s)"); process.exit(1); }
console.log("[break-verdict] PASS — every break file judges red by the suite's own rule (run-all.js verdictOf, through " +
  "tools/probes/_verdict.js) plus the named failure — an announced failure that exits 0 and silence are not passes — and " +
  "the " + OLDER.length + " older break files are a list that can only shrink (" + asserts + " assertions)");
