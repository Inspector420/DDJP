// tools/probes/mutate-j153-b.js
// SUBJECT: J153's package (a), second half, at `ddjp_721` — `MediaBlocked`'S TIMING: a person's report (and its retry) stays
// quiet once the room already acts on the reports it has; the escape is re-armed only by a new playing, goes at
// `advance.earliestAt` (since `ddjp_722`, `advance.skipAt`) or its rank slot, whichever is later, re-checks the moment when it fires, waits for its answer and
// then `Playback.ADVANCE_RESEND_MS` (read from its one home) before another — `check-blocked-skip` PARTs F and G. The
// owner's words: "we want to be efficient with traffic". One row per thing the build does, each naming the failure it must
// cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j151-room-services.js`, unchanged.
//
//   node tools/probes/mutate-j153-b.js            every row
//   node tools/probes/mutate-j153-b.js T1 T5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MBL = "features/mediablocked.js";
const PB = "features/playback.js";
const BS = "check-blocked-skip";

const ROWS = [
  // ── the loop fix: only a new playing re-arms ──
  ["T1", [[MBL, "    if (_armedPi !== undefined && pi === _armedPi) return;   // the same playing: a refused advance changes nothing here\n", ""]],
    BS, "F1 — A REFUSED media.skip's ECHO RE-ARMED THE ESCAPE", "RED"],   // every echo re-arms (720's loop)
  // ── the moment ──
  // T2 RE-ANCHORED AT ddjp_722 (J153): the escape's moment is `advance.skipAt` now, the play's gate staying `earliestAt`.
  ["T2", [[MBL, "    if (typeof adv.skipAt === \"number\") wait = Math.max(wait, adv.skipAt - _nowMs());\n", ""]],
    BS, "F4 — THE ESCAPE WENT BEFORE advance.skipAt", "RED"],   // sent before the room's moment
  // ── T3 retired at ddjp_722 (J153): it removed the fire-time re-arm and named F4's "a gate that moved while the escape
  // waited". The room's rule no longer lets a length move a room skip's moment (a ranked one closes the route, an unranked
  // one holds only the play), so F4 was changed on purpose and that half of it is gone; `mutate-j153-c` C15 and C16 hold
  // what replaced it. The line stays for a moment that is not reached yet when the timer fires (a clock offset learned
  // meanwhile), which no row drives.
  // ── the resend's wait ──
  ["T4", [[MBL, "      if (_skipAsked.answeredAt === null) return null;          // its answer re-arms\n", "      if (_skipAsked.answeredAt === null) return 0;\n"]],
    BS, "F3 — A SECOND ESCAPE WENT BEFORE THE FIRST ONE'S ANSWER", "RED"],   // a second escape before the answer
  ["T5", [[MBL, "      wait = Math.max(wait, _skipAsked.answeredAt + r - Date.now());\n", ""]],
    BS, "F2 — AFTER A REFUSAL THE NEXT ESCAPE WAITS ADVANCE_RESEND_MS", "RED"],   // resent at once after a refusal
  ["T6", [[PB, "    ADVANCE_RESEND_MS,\n", ""]],
    BS, "F2 PREMISE — the real Playback exposes no ADVANCE_RESEND_MS", "RED"],   // the number not read from its one home
  // ── the quiet re-check ──
  ["T7", [[MBL, "    if (_roomWillAct(pi)) {                       // the room already acts on the reports it has: mine changes nothing",
               "    if (false) {                       // the room already acts on the reports it has: mine changes nothing"]],
    BS, "G1 — A REPORT WAS SENT AFTER THE ROOM'S ADVANCE", "RED"],   // the report's re-check gone
  ["T8", [[MBL, "|| iReportedBlocked(pi) || _roomWillAct(pi)) return;", "|| iReportedBlocked(pi)) return;"]],
    BS, "G2 — THE RETRY WENT ALTHOUGH THE ROOM NOW ACTS", "RED"],   // the retry's re-check gone
  // ── CONTROLS: nothing that matters changes ──
  ["TG1", [[MBL, "  let _armedPi;                 // the playing this module last armed for (undefined: not armed since init)",
                "  let _armedPi;                 // the playing this module last armed for (undefined: none since init)"]],
    BS, "", "GREEN"],   // a comment reworded
  ["TG2", [[MBL, "  let _skipAsked = null;        // { pi, answeredAt } for the last escape sent", "  let _skipAsked = null;        // { pi, answeredAt }: the last escape sent"]],
    BS, "", "GREEN"],   // a comment reworded
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
// The journal file is the run's own; one this run created and left empty is removed at the end, so a copy the file ran
// in comes back byte for byte (HANDOVER §4). A journal still holding entries is never removed.
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark] of ROWS) {
  if (want.length && want.indexOf(id) < 0) continue;
  // PLANNED IN MEMORY FIRST: every anchor must occur exactly once in the bytes it will be applied to, or nothing is written.
  const files = new Map();
  let voided = null;
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    if (!files.has(file)) { const o = fs.readFileSync(file, "utf8"); files.set(file, { rel, original: o, mutated: o }); }
    const f = files.get(file);
    const n = f.mutated.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel + ": " + JSON.stringify(oldS.slice(0, 60)); break; }
    const next = f.mutated.replace(oldS, () => newS);
    if (next === f.mutated) { voided = "the edit changed nothing in " + rel; break; }
    f.mutated = next;
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  const handles = [];
  let out = "", code = 0, landed = true, held = true;
  try {
    for (const [file, f] of files) {
      const h = J.open("mutate-j153-b:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
      out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
      held = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);   // still there as the result is read
    }
  } finally { for (const h of handles) h.restore(); }
  const restored = [...files].every(([file, f]) => sha(fs.readFileSync(file, "utf8")) === sha(f.original));
  if (!restored) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (!landed) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
  if (!held) { console.log("VOID  " + id + " — an edit was gone by the time the result was read"); bad++; continue; }
  if (wantMark === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else {
      bad++;
      const first = (out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160);
      console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (first ? " — got " + first : "") + (v.why ? " (" + v.why + ")" : ""));
    }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected green: " + ((out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160))); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
