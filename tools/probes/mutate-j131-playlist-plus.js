// tools/probes/mutate-j131-playlist-plus.js
// SUBJECT: J131's correction (`ddjp_668`) — a playlist row on a phone (the owner's rule, `main/04-features.md` §Playlists):
// `ui/playlists.js` (`_playlistTrackRow` builds the ＋ and its separator on every row, classed `pl-add`) and `index.html` (the
// rule hiding `.pl-add` while the list is NOT `pl-locked` — the moves' switch the other way round). Unlocked a row reads
// ▲ ▼ | ⏫ ⏬ | ✕, locked ＋ | ✕; the class alone flips it, on the same rows; History's ＋, My queue's rows and the room queue's
// rows (left as they are, the supervisor's proposal the owner accepted) as they were. Held by `check-list-look` L,
// `check-playlist-moves` C and `check-control-styling` (J131's classes).
// One row per way it could go wrong, each naming the failure it must cause.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j131-history-row`: every edit is recorded on disk before it
// is made and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, or the row is VOID. Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j131-playlist-plus.js            every row
//   node tools/probes/mutate-j131-playlist-plus.js PP3 PP6    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PL = "ui/playlists.js", IX = "index.html", PN = "ui/panels.js";
const LL = "check-list-look", PM = "check-playlist-moves", CS = "check-control-styling";
// ui/playlists.js
const PLUS = `    acts.push(H.el("button", { class: "mini ico pl-add", text: "＋", title: "Add to my queue",`;
const SEP = `    acts.push(H.el("span", { class: "q-sep pl-add", "aria-hidden": "true" }));\n`;
const HELPER = `return H.el("button", { class: "mini ico", text: "＋", title: "Add to a playlist",`;
// index.html
const RULE = `    .pl-detail-body:not(.pl-locked) .pl-add { display: none; }\n`;
const RQ = `    .roomq-locked .rq-ctl, .roomq-locked .rq-reset { display: none; }`;
const UQ = `    .uq-locked .uq-remove, .uq-locked .uq-remove-sep { display: none; }`;
// ui/panels.js
const HIST = `        actions: [PlaylistPanels._addToPlaylistBtn(h.songKey)],`;
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── UNLOCKED, NO ＋ ──
  ["PP1", [[IX, RULE, ""]],
    LL, "L: UNLOCKED, A PLAYLIST ROW SHOWS NO ＋ AND NO SEPARATOR BEFORE ▲", "RED"],   // the rule gone: 667's row back
  ["PP2", [[PL, PLUS, PLUS.replace(`"mini ico pl-add"`, `"mini ico"`)]],
    LL, "L: UNLOCKED, A PLAYLIST ROW SHOWS NO ＋ AND NO SEPARATOR BEFORE ▲", "RED"],   // the ＋ not classed: only its separator goes
  ["PP3", [[PL, SEP, SEP.replace(`"q-sep pl-add"`, `"q-sep"`)]],
    LL, "L: THE FIRST THING SHOWN IS ▲, NOT A SEPARATOR", "RED"],   // the ＋ goes, its separator stays: a leading divider
  ["PP4", [[IX, RULE, RULE.replace(`display: none;`, `visibility: hidden;`)]],
    LL, "L: AND THEY TAKE NO ROOM", "RED"],   // invisible but laid out: the title exactly as narrow
  ["PP5", [[IX, RULE, RULE.replace(`display: none;`, `visibility: hidden;`)]],
    CS, "J131: EVERY CLASS THE JOB ADDS IS USED IN ui/ AND DECLARED", "RED"],   // the same, seen from the classes' rule: no `display`
  // ── LOCKED, AS BEFORE ──
  ["PP6", [[IX, RULE, `    .pl-add { display: none; }\n`]],
    LL, "L: LOCKED, EXACTLY AS BEFORE", "RED"],   // hidden whatever the lock: no ＋ at all
  ["PP7", [[IX, RULE, `    .pl-locked .pl-add { display: none; }\n`]],
    LL, "L: LOCKED, EXACTLY AS BEFORE", "RED"],   // the switch the wrong way round: the ＋ only while unlocked
  ["PP8", [[IX, RULE, `    .pl-locked .pl-add { display: none; }\n`]],
    PM, "C: LOCKED, ＋ IS SHOWN AND USABLE", "RED"],   // the same, seen from the moves' guard
  ["PP9", [[IX, RULE, ""]],
    PM, "C: UNLOCKED, THE MOVES ARE SHOWN and ✕ usable — and ＋ hidden", "RED"],   // the rule gone, seen from the moves' guard
  // ── THE ONE SWITCH: the class alone, on the rows as they are (no second mechanism) ──
  ["PP10", [[PL, `    const acts = [];\n` + PLUS, `    const acts = [];\n    if (H.plLocked()) ` + PLUS.slice(4)],
            [PL, SEP, `    if (H.plLocked()) ` + SEP.slice(4)]],
    LL, "L: A LOCK AND AN UNLOCK FLIP IT BY THE CLASS ALONE", "RED"],   // the ＋ built only while locked: a row rebuilt to flip it
  ["PP11", [[PL, SEP, SEP + `    if (!H.plLocked()) { acts[0].style.display = "none"; acts[1].style.display = "none"; }\n`]],
    LL, "L: A LOCK AND AN UNLOCK FLIP IT BY THE CLASS ALONE", "RED"],   // hidden by an inline style decided at the build
  // ── THE OTHER LISTS, AS THEY WERE ──
  ["PP12", [[PL, HELPER, HELPER.replace(`"mini ico"`, `"mini ico pl-add"`)]],
    LL, "L: NO OTHER LIST CARRIES THE ＋'S CLASS", "RED"],   // History's ＋ (the shared helper) given the playlist row's class
  ["PP13", [[PN, HIST, `        actions: [],`]],
    LL, "L: HISTORY'S ＋ (ADD TO A PLAYLIST) IS AS IT WAS", "RED"],   // History's ＋ dropped with the playlist's
  ["PP14", [[IX, UQ, `    .uq-remove, .uq-remove-sep { display: none; }`]],
    LL, "L: MY QUEUE'S ROWS ARE AS THEY WERE", "RED"],   // My queue's ✕ gone unlocked too
  ["PP15", [[IX, RQ, `    .rq-ctl, .roomq-locked .rq-reset { display: none; }`]],
    LL, "L: THE ROOM QUEUE'S ROWS ARE AS THEY WERE", "RED"],   // the room queue's controls gone unlocked: its rows not left as they are
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
      const h = J.open("mutate-j131-playlist-plus:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 400000 });
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
