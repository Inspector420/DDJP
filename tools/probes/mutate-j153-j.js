// tools/probes/mutate-j153-j.js
// SUBJECT: J153 at `ddjp_730` — THE OWNER'S THREE FIXES FROM TESTING `ddjp_729`. (1) The globe first on the row's grey line, its
// 5 px gap after it, the " · " before the name only after a length ("Space after planet only"), the tap area inside the gaps and
// under the row's controls, and
// History's line as it was. (2) A song saved into a playlist from outside it showing at once in that playlist when it is open —
// its list only redrawn, the typed link and the place kept — and the library's count read again; nothing touched otherwise.
// (3) My queue's row ✕ shown and working while its lock is locked, the separator before it kept, "✕ Clear" still behind the lock.
// Rows J15–J18 carry the ground of `mutate-j118-owner-screens` MQ1 and MQ2, retired at `ddjp_730`, on the new rule. One row per
// thing the build does, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-f.js`, unchanged.
//
//   node tools/probes/mutate-j153-j.js            every row
//   node tools/probes/mutate-j153-j.js J1 J5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PL = "ui/playlists.js";
const PN = "ui/panels.js";
const QU = "ui/queue.js";
const SH = "ui/shell.js";
const IX = "index.html";
const GI = "check-geo-icon";
const PM = "check-playlist-moves";
const OS = "check-owner-screens";
const GLOBE = "\uD83C\uDF10";

const ROWS = [
  // ── (1) the row's grey line ──
  ["J1", [[PL, "    const subKids = [geoEl, durEl];", "    const subKids = [durEl, geoEl];"]],
    GI, "R: THE GLOBE COMES FIRST ON THE LINE", "RED"],   // 729's order: the globe after the length
  ["J2", [[IX, "    .song-row .sr-geo.geo-on { display: inline-block; margin-right: 5px;", "    .song-row .sr-geo.geo-on { display: inline-block; margin-left: 5px;"]],
    GI, "R: THE GLOBE'S GAP", "RED"],   // the gap before it, as when it came after the length
  ["J3", [[IX, "    .song-row .sr-geo.geo-on { display: inline-block; margin-right: 5px; ", "    .song-row .sr-geo.geo-on { display: inline-block; "]],
    GI, "R: THE LINE READS \"" + GLOBE + " ann\" (a room queue row, the globe only)", "RED"],   // his screenshot: the globe touching the name
  ["J4", [[IX, "    .song-row .sr-dur:not(:empty) ~ .sr-when::before { content: \" · \"; }\n",
    "    .song-row .sr-dur:not(:empty) ~ .sr-when::before { content: \" · \"; }\n    .song-row .sr-geo.geo-on ~ .sr-when::before { content: \" · \"; }\n"]],
    GI, "R: THE LINE READS \"" + GLOBE + " ann\" (a room queue row, the globe only)", "RED"],   // a dot after the globe: the owner's "Space after planet only"
  ["J5", [[IX, "    .song-row .sr-dur:not(:empty) ~ .sr-when::before { content: \" · \"; }\n", ""]],
    GI, "R: THE LINE READS \"3:20 · ann\" (a room queue row, a length only)", "RED"],   // the length's dot gone
  ["J6", [[IX, "    .song-row .sr-dur:not(:empty) ~ .sr-when::before {", "    .song-row .sr-dur ~ .sr-when::before {"]],
    GI, "R: A LONE NAME HAS NOTHING BEFORE IT", "RED"],   // the dot whether or not there is a length
  ["J7", [[IX, "width: 24px; margin-left: -8px; }", "width: 24px; margin-left: -13px; }"]],
    GI, "C: THE TAP AREA STAYS IN THE GAPS", "RED"],   // 729's reach: over the row's number now the globe is first
  ["J8", [[IX, "width: 24px; margin-left: -8px; }", "width: 30px; margin-left: -8px; }"]],
    GI, "C: THE TAP AREA STAYS IN THE GAPS", "RED"],   // past the globe's own gap, over the length or the name
  ["J22", [[IX, "    .song-row .uq-actions { margin-left: auto; position: relative; z-index: 1; }", "    .song-row .uq-actions { margin-left: auto; }"]],
    GI, "C: THE ROW'S CONTROLS ARE PAINTED ABOVE THE TAP AREA", "RED"],   // a cramped row's first control under the globe's area
  ["J9", [[PN, "        H.clear(sub);\n", ""]],
    GI, "R: HISTORY'S LINE IS \"🌐 name · age\" (the answer held)", "RED"],   // History keeping songRow's line under its own
    // renamed at `ddjp_736`: History now keeps the globe's spot first on its line (the owner's reversal of "but not history"), so
    // the row R names is the line's new shape — the same mutation, the failure it names reworded to the guard's new words
  // ── (2) a song saved from outside, into a playlist open ──
  ["J10", [[PL, "      if (added) _plSaved(pid);   // the playlist, open in the Playlists tab, shows it at once (`ddjp_730`)\n", ""]],
    PM, "D: A SONG SAVED INTO THE PLAYLIST OPEN SHOWS IN IT AT ONCE", "RED"],   // 729: seen only after leaving and coming back
  ["J11", [[PL, "    if (_plView === pid && _plOpen && _plOpen.id === pid) _plOpen.reread().catch(() => {});", "    if (_plView === pid) QueuePanels.renderQueuePanel();"]],
    PM, "D: ONLY ITS LIST IS REDRAWN", "RED"],   // the whole panel redrawn: the typed link lost
  ["J12", [[PL, "    if (_plView === pid && _plOpen && _plOpen.id === pid) _plOpen.reread().catch(() => {});", "    if (_plView !== \"list\") QueuePanels.renderQueuePanel();"]],
    PM, "D CONTROL: A SONG SAVED INTO ANOTHER PLAYLIST TOUCHES NOTHING", "RED"],   // any save redraws whatever playlist is open
  ["J13", [[PL, "    if (_plView === pid && _plOpen && _plOpen.id === pid) _plOpen.reread().catch(() => {});",
    "    if (_plView === pid && _plOpen && _plOpen.id === pid) { QueuePanels._resetStackScroll(); _plOpen.reread().catch(() => {}); }"]],
    PM, "D: AND THE LIST KEEPS ITS PLACE", "RED"],   // redrawn back at the top
  ["J14", [[PL, "    if (_plView === \"list\") { QueuePanels.renderQueuePanel(); return; }\n", "    if (_plView === \"list\") return;\n"]],
    PM, "D: ON THE LIBRARY, THE PLAYLIST'S COUNT IS READ AGAIN", "RED"],   // the library's count stale until the next visit
  ["J19", [[PL, "    if (H.queueTab() !== \"playlists\") return;\n", ""]],
    PM, "D CONTROL: WITH ANOTHER TAB OPEN, A SAVE DRAWS NOTHING IN THE PANE", "RED"],   // a save redraws the tab open, whichever it is
  // ── (3) My queue's row ✕, not behind the lock (MQ1 and MQ2's ground, `ddjp_730`) ──
  ["J15", [[QU, "        const removeBtn = mv(\"\\u2715\", \"Remove\", () => UserQueue.removeAt(i), true);\n",
    "        const removeBtn = mv(\"\\u2715\", \"Remove\", () => UserQueue.removeAt(i), true);\n        if (H.uqLocked()) removeBtn.style.display = \"none\";\n"]],
    OS, "D: LOCKED, EACH ROW'S \u2715 SHOWS", "RED"],   // hidden while locked, as since ddjp_635 (MQ1's ground)
  ["J16", [[QU, "() => UserQueue.removeAt(i), true);", "() => { if (H.uqLocked()) return; UserQueue.removeAt(i); }, true);"]],
    OS, "D: LOCKED, A ROW'S \u2715 REMOVES ITS SONG", "RED"],   // shown but inert while locked
  ["J17", [[QU, "        if (moves.length) acts.push(sep());", "        if (moves.length && !H.uqLocked()) acts.push(sep());"]],
    OS, "D: LOCKED, EACH ROW'S \u2715 SHOWS, and the separator before it", "RED"],   // the separator gone while locked (MQ2's ground)
  ["J18", [[SH, "    clearBtn.disabled = _uqLocked;", "    clearBtn.disabled = false;"]],
    OS, "D: LOCKED, CLEAR IS THERE AND CANNOT BE USED", "RED"],   // "✕ Clear" out from behind the lock with the ✕
  // ── controls: nothing that matters changes ──
  ["J20", [[PL, "the sheet's gap after it, then the length", "its gap after it, then the length"]],
    GI, "", "GREEN"],   // a comment reworded, on the line beside J1's
  ["J21", [[PL, "  // again, as a change to the library redraws it. Another playlist open, or another tab, is not touched.\n",
    "  // again, as a change to the library redraws it. Nothing else is touched.\n"]],
    PM, "", "GREEN"],   // a comment reworded, above J19's line
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
      const h = J.open("mutate-j153-j:" + id, file);   // journalled BEFORE the write
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
