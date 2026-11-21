// tools/probes/mutate-j108-reanchor.js
// SUBJECT: J108 (`ddjp_605`) — `check-doc-xrefs` PART D's premise, tested directly. Its live read is worth something only if
// the walk reached the guard and tool trees, and `walk` answers nothing for a directory it cannot read. A floor on the
// number of citations reached stood in for that, denominated in what honest work removes (FAILURE-SIGNATURES' forty-
// seventh); J108 deleted it and checks the walk against an independent listing instead. Each row breaks the walk and
// must turn the guard red NAMING THE PREMISE; the control changes nothing.
// AND `check-bot-runtime` PART D's unrelated event, which re-anchoring found had never reached the line it names: it was
// fired with no `ddjpType`, so it left at the no-type line and stayed green with the mode's handled list deleted
// (`mutate-br-botruntime` M16, re-anchored). It is now shaped as the transport emits it, with an APPLIED line that fails
// if the fixture drifts back. And `check-dm-gaps` A's unreadable invite list, whose throw — the defect it is about — ended
// the file with a stack trace and no FAIL line (`mutate-dm-gaps` M4, re-anchored): it is caught now and reported by name.
// (J108's other half — the VOID rows J107 retired, re-anchored — lives in the historical files themselves.)
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j108-reanchor.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const DX = "check-doc-xrefs", XT = "tests/check-doc-xrefs.js";
const TOOLS = '  .concat(walk(path.join(APP, "tools"), /\\.js$/))';
const TESTS = 'const GUARD_FILES = walk(path.join(APP, "tests"), /\\.js$/)';
const BR = "check-bot-runtime", BT = "tests/check-bot-runtime.js", RTF = "features/botruntime.js";
const HANDLED = "    if (_running.mode && MODES[_running.mode].handles.indexOf(type) < 0) { _running.notHandled++; return; }";
const DG = "check-dm-gaps", CH = "features/chat.js", DGT = "tests/check-dm-gaps.js";
const INV = "    try { all = (MatrixAccount.invites && MatrixAccount.invites()) || []; } catch (e) { return []; }";
const CATCH = '      try { got = blind.Chat.dmInvites(); } catch (e) { got = "threw: " + e.message; }';
const STAMP = '           ddjpType: "ddjp.dj.vote", ddjpBody: vote }, {}, {});';
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", options].
const ROWS = [
  // XD1 — the walk stops reaching tools/ (the probe tree, where most row citations sit): fewer files, still some.
  ["XD1", [[XT, TOOLS, "  .concat([])"]], DX, "FAIL — PART D PREMISE — the walk reaches every .js file", "RED"],
  // XD2 — the walk aims at a directory that is not there: it answers nothing, and the live read would find nothing.
  ["XD2", [[XT, TESTS, 'const GUARD_FILES = walk(path.join(APP, "testz"), /\\.js$/)']], DX, "FAIL — PART D PREMISE — the walk reaches every .js file", "RED"],
  // ── THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[XT, TESTS, TESTS + "   // a comment"]], DX, "", "GREEN"],
  // BR1 — the mode's handled list is deleted, so every event is `seen` (M16's edit): PART D must name it.
  ["BR1", [[RTF, HANDLED, "    /* handled list removed */"]], BR, "FAIL — D: an event the mode does not handle is not even SEEN", "RED"],
  // BR2 — the fixture drifts back to the shape that never reached that line: its APPLIED line must name it.
  ["BR2", [[BT, STAMP, "           ddjpBody: vote }, {}, {});"]], BR, "FAIL — D: APPLIED — the unrelated event carries its DDJP type", "RED"],
  // N2 — the control for the two rows above.
  ["N2", [[BT, STAMP, STAMP + "   // a comment"]], BR, "", "GREEN"],
  // DG1 — the invite read loses its catch (M4's edit): the throw must come back as PART A's FAIL, not a stack trace.
  ["DG1", [[CH, INV, "    all = (MatrixAccount.invites && MatrixAccount.invites()) || [];"]], DG, "FAIL — A: a transport that cannot report invites reports NONE rather than throwing", "RED"],
  // N3 — the control for DG1.
  ["N3", [[DGT, CATCH, CATCH + "   // a comment"]], DG, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want, opts] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    let v = redAsNamed(code, out, expect);
    if (v.mark === "RED" && opts && opts.noPass && /^\[[\w-]+\] PASS/m.test(out)) v = { mark: "WRONG", why: "it printed PASS after its failure" };
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — " + (opts && opts.equivalent ? "an equivalent edit, measured (see its comment)" : "the control")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
