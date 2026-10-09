// tools/probes/mutate-j76-gate.js
// SUBJECT: J76 — the bot's security gate. Each row undoes ONE site, confirms the edit LANDED, runs the named guard and
// reads the outcome by the suite's own rule (`_verdict.js`); restored after every row and on any exit.
//   node tools/probes/mutate-j76-gate.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const AU = "backends/backend2/authority.js", RU = "backends/backend2/runner.js";
const BG = "check-bot-gate", BA = "check-bot-answers", JR = "check-judge-reducer", BS = "check-bot-songs";
const ROWS = [
  ["G1", AU, "    if (stamped.actor) {\n      const recent", "    if (stamped.actor && !isUrgent(stamped.t)) {\n      const recent", BG, "FAIL — D: urgent acts meet the per-person limit", "RED"],
  ["G2", AU, "        _q.splice(k, 1);\n", "", BG, "FAIL — E: latest-per-actor", "RED"],
  ["G3", AU, "if (r && r.sent > 0) _lastOpenAt = now;", "_lastOpenAt = now;", BG, "FAIL — C: an empty opening", "RED"],
  ["G4", AU, "    if (gap < POLICY.gate.intervalMs) return {", "    if (false) return {", BG, "FAIL — C: within the interval", "RED"],
  ["G5", AU, "    _q.push({ raw: { type: type, payload: payload || {} }, due: _now(), actor: null });\n", "    if (_send) _emit(type, payload || {}, _now());\n", BG, "FAIL — A: everything", "RED"],
  ["G6", AU, "    if (urgent && POLICY.gate.bypass === true && _bypassUsed < POLICY.gate.bypassPerOpening) { _bypassUsed++; _open(now, false); }\n", "", BG, "FAIL — F: on, an urgent act opens it early", "RED"],
  ["G7", AU, "eventId: batch ? nameOf(k) : id", "eventId: id", BG, "FAIL — I: and batch members learn carrier#k", "RED"],   // re-anchored at J77: naming has one home
  ["G8", AU, "(all || messages < POLICY.gate.messagesPerOpening)", "(all || messages < 1)", BG, "FAIL — G: gate.messagesPerOpening and maxPerMessage are read", "RED"],
  ["G9", AU, "    if (!(typeof G.intervalMs === \"number\" && G.intervalMs > 0 && G.intervalMs <= POLICY.answerWindowMs / 4)) out.push(\"gate.intervalMs must be positive and a small fraction of the answer window\");\n", "", BG, "FAIL — H: it refuses an interval of 0", "RED"],
  ["G10", RU, "    }, B2Authority.POLICY.gate.intervalMs);\n", "    }, 500);\n", BG, "FAIL — G: the runner's gate timer reads", "RED"],
  ["G11", AU, "    const groupDue = all || earliest <= now || grouped >= POLICY.maxPerMessage;\n", "    const groupDue = all || grouped >= POLICY.maxPerMessage;\n", BA, "FAIL — C: and cost ONE bot message", "RED"],
  ["G12", AU, "silent: true } : v;", "silent: false } : v;", JR, "FAIL — C: a play judged before its gate is IGNORED", "RED"],
  // G14–G16 (J76, at the audit): the batch-carrier half of the echo match, and the one-shot opening.
  ["G14", RU, "(raw.event_id === _advSent.carrier || raw.event_id === _advSent.id)", "(raw.event_id === _advSent.id)", BS, "FAIL — D3: and is retried", "RED"],   // re-anchored at J77: the carrier match
  ["G15", RU, "      _oneShot = setTimeout(function () { _oneShot = null; if (_on) _openSoon(); }, Math.max(0, r.waitMs || 0));\n", "", BG, "FAIL — K: every gate call", "RED"],
  ["G16", AU, "waitMs: POLICY.gate.intervalMs - gap,", "waitMs: POLICY.gate.intervalMs,", BG, "FAIL — K: held by the spacing", "RED"],
  ["G13", AU, ", dropped: dropped, promise: promise };", ", dropped: dropped };", BS, "FAIL — D:", "RED"],
];
let planted = null;
function restore() { if (planted) { fs.writeFileSync(planted.file, planted.original); planted = null; } }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect, want] of ROWS) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the line is unreachable, as recorded"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected no change; the 'unreachable' claim is wrong"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
