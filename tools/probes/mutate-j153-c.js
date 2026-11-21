// tools/probes/mutate-j153-c.js
// SUBJECT: J153's 722, at `ddjp_722` — THE ROOM'S NEW RULE FOR SKIPPING A SONG PEOPLE CAN'T PLAY: one function
// (`skipVerdict`) read by the reducer's re-validation of a `ddjp.media.skip` and by the advance view; the room may skip when
// "Skip songs blocked for some people" is on and its own table is met, or when no ranked person has reported a length and
// `skipRoads` is met, and never before `minGate`; its moment `skipAt`; a ranked length closing the dead-song route with its own
// refusal code; the switch and its table frozen at a song's start, folded through the one road-list check, and drawn under
// their switch in the panel; `MediaBlocked`'s quiet person reporting after a ranked length, and its escape waiting for `skipAt`;
// StreamManager's TOO EARLY line reading `skipAt` for a room skip. One row per thing the build does, each naming the failure
// it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j151-room-services.js`, unchanged.
//
//   node tools/probes/mutate-j153-c.js            every row
//   node tools/probes/mutate-j153-c.js C1 C5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js";
const SM = "backends/backend1/streammanager.js";
const MBL = "features/mediablocked.js";
const SET = "ui/settings.js";
const AG = "check-advance-gate";
const BS = "check-blocked-skip";

const ROWS = [
  // ── the rule, in its one function ──
  ["C1", [[SD, "    const forSome = s.skipBlockedForSome === true && met(s.skipBlockedForSomeRoads);", "    const forSome = false;"]],
    AG, "g1: switch on, its table met", "RED"],   // the switch does nothing
  ["C2", [[SD, "    const forSome = s.skipBlockedForSome === true && met(s.skipBlockedForSomeRoads);", "    const forSome = s.skipBlockedForSome === true && met(s.skipRoads);"]],
    AG, "g4: a stricter own table that is not met", "RED"],   // its own table not read: skipRoads stands in
  ["C3", [[SD, "      for (const u in d.len) { if (d.len[u].tier <= gTier) { rankedLen = true; break; } }", "      for (const u in d.len) { rankedLen = true; break; }"]],
    AG, "g2: an unranked account's length does not hold", "RED"],   // any length holds the skip again (721's hole)
  ["C4", [[SD, "    const forAll = roadsMet && !rankedLen;", "    const forAll = roadsMet;"]],
    AG, "g1: switch off — a ranked person's length holds", "RED"],   // a ranked length no longer closes the dead-song route
  ["C5", [[SD, "      at: (startedAt || 0) + minGate,", "      at: (startedAt || 0),"]],
    AG, "g1: switch on — still never before `minGate`", "RED"],   // the waiver drops minGate too
  ["C6", [[SD, "          if (!sv.warranted && sv.heldByLength) {", "          if (false) {"]],
    AG, "with its own code", "RED"],   // a held skip refused as `no-road-met`, a false cause
  ["C7", [[SD, "          if (!sv.warranted) {", "          if (false) {"]],
    AG, "g4 control: the same table with the switch off does nothing", "RED"],   // the reducer stops reading the verdict
  ["C8", [[SD, "        skipWarranted: sv.warranted,", "        skipWarranted: sv.warranted || sv.heldByLength,"]],
    AG, "g6: the view says the room will act exactly when the rule does", "RED"],   // the view drifts from the reducer
  ["C9", [[SD, "      const sv = skipVerdict(live, set, started);", "      const sv = skipVerdict(live, Object.assign({}, set, { skipBlockedForSome: false }), started);"]],
    "check-tier-inclusive", "B2: through the blocked-for-some table, the view and the reducer reach the SAME verdict", "RED"],   // the view ignores the second table
  ["C10", [[SD, "      const sv = skipVerdict(live, set, started);", "      const sv = skipVerdict(live, Object.assign({}, set, { skipBlockedForSome: false }), started);"]],
    "check-blocked-reason", "C2: through the blocked-for-some table, the view and the reducer reach the SAME verdict", "RED"],   // the same, on the reason axis
  ["C11", [[SD, "          const setR = nowPlaying.settings || settings;\n          const roads = Array.isArray(setR.skipRoads) ? setR.skipRoads : [];\n          const someRoads",
                "          const setR = settings;\n          const roads = Array.isArray(setR.skipRoads) ? setR.skipRoads : [];\n          const someRoads"]],
    AG, "g5: the switch turned on after the song started", "RED"],   // read live, not frozen at the song's start
  // ── the settings: fold, one road-list check, the range row ──
  ["C12", [[SD, "    if (typeof s.skipBlockedForSome === \"boolean\") settings.skipBlockedForSome = s.skipBlockedForSome;\n", ""]],
    "check-setting-endpoints", "D: `skipBlockedForSome` FOLDS", "RED"],   // the switch never folds
  ["C13", [[SD, "    const someRoads = _roadList(\"skipBlockedForSomeRoads\", s.skipBlockedForSomeRoads);",
                "    const someRoads = Array.isArray(s.skipBlockedForSomeRoads) ? s.skipBlockedForSomeRoads : null;"]],
    "check-setting-endpoints", "L: `skipBlockedForSomeRoads` with maxItems+1 is REFUSED whole", "RED"],   // a copy instead of the one check
  ["C14", [[SD, "    skipBlockedForSomeRoads: Object.assign({}, ROAD_LIST),\n", ""]],
    AG, "g4: a stricter own table that is not met", "RED"],   // no range row: its own table never folds, so the default stands in
  // ── the escape and the late report ──
  ["C15", [[MBL, "    if (typeof adv.skipAt === \"number\") wait = Math.max(wait, adv.skipAt - _nowMs());",
                 "    if (typeof adv.earliestAt === \"number\") wait = Math.max(wait, adv.earliestAt - _nowMs());"]],
    BS, "F4 — AT advance.skipAt THE ESCAPE GOES, ONCE", "RED"],   // the escape waits for the play's gate
  ["C16", [[MBL, "      StreamManager.on(\"ddjp.play.len\", _onLength);\n", ""]],
    BS, "H1 — after a ranked length for this playing, 1 report(s) must go", "RED"],   // the quiet person never reports
  // ── what the transport says, and what the panel draws ──
  ["C17", [[SM, "        const opensAt = adv ? (roomSkip ? adv.skipAt : adv.earliestAt) : null;", "        const opensAt = adv ? adv.earliestAt : null;"]],
    "check-refusal-reasons", "D2: a room skip refused before `minGate` is explained by ITS moment", "RED"],   // blames a length
  ["C18", [[SET, "      if (s.skipBlockedForSome === true) {", "      if (true) {"]],
    "check-settings-rows", "I: blocked-for-some off (its default)", "RED"],   // its table drawn while the switch is off
  // ── CONTROLS: nothing that matters changes ──
  ["CG1", [[SD, "      heldByLength: roadsMet && rankedLen && !forSome,   // the dead-song route met, and closed by a ranked length",
                "      heldByLength: roadsMet && rankedLen && !forSome,   // the dead-song route met, closed by a ranked length"]],
    AG, "", "GREEN"],   // a comment reworded
  ["CG2", [[MBL, "  // re-check in `_reportNow` decides; a pending report or one already recorded is left alone (`_maybeScheduleReport`).",
                 "  // re-check in `_reportNow` decides; a pending or already recorded report is left alone (`_maybeScheduleReport`)."]],
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
      const h = J.open("mutate-j153-c:" + id, file);   // journalled BEFORE the write
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
