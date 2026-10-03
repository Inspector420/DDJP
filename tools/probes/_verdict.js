// tools/probes/_verdict.js
// ONE RULE FOR "RED" IN A BREAK FILE (J73, the `ddjp_521` audit). Each break file judged its rows with its
// own copy of "exited non-zero and named the failure" — nine copies of one rule — and a guard that printed
// its failure but exited 0 (a promise that never settled) read GREEN (`mutate-j73-windows` W12). The suite
// never had that gap: `tests/run-all.js` `verdictOf` refuses an announced FAIL with exit 0, and silence.
// So a break file now asks THAT function, and adds only what a break row needs on top: the named failure.
// `tests/check-break-verdict.js` fails if a break file stops asking it.
"use strict";
const path = require("path");
const { verdictOf } = require(path.join(__dirname, "..", "..", "tests", "run-all.js"));
// A row expecting red: a failure by the suite's own rule AND the failure it names.
//   RED   — failed, as named.   WRONG — failed, but not as named.   GREEN — the suite would call it a pass.
function redAsNamed(status, out, expect) {
  const v = verdictOf(status, out);
  if (v.ok) return { mark: "GREEN", why: null };
  return { mark: String(out).indexOf(expect) >= 0 ? "RED" : "WRONG", why: v.why };
}
// A row expecting no change (a measured, unreachable line): the suite's own rule must call it a pass.
function staysGreen(status, out) { return verdictOf(status, out).ok; }
module.exports = { redAsNamed, staysGreen, verdictOf };
