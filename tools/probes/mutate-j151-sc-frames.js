// tools/probes/mutate-j151-sc-frames.js
// SUBJECT: J151 at `ddjp_714` — THE ROOM'S SOUNDCLOUD PLAYER IS MADE ONCE AND REUSED, a preview's is fresh, the room's goes when
// the room is left: SoundCloud's player file (`ui/soundcloud.js`), the plug's release (`ui/songplayer.js`) and the room's leave
// (`ui/player.js`, `ui/shell.js`) — `check-sc-frames`, `check-player-plug`. The owner's words (`ddjp_714`): "in PC when the tab
// is not visible, soundcloud waits for you to come back to play and on phone it even asks for a tap. can we bypass it? its
// really stoping the experience". Until `ddjp_714` this file held `ddjp_710`'s rows (one fresh frame per song, the plug's
// safety net); that rule is replaced — the rows below are the reuse rule's, and the safety net is the plug's check, whose rows
// are `mutate-j151-player-check.js`. One row per thing the fix does, each naming the failure it must cause; the controls
// change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j151-soundcloud.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j151-sc-frames.js            every row
//   node tools/probes/mutate-j151-sc-frames.js SF1 SF5    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SCP = "ui/soundcloud.js";
const PLUG = "ui/songplayer.js";
const SHELL = "ui/shell.js";
const PP = "check-player-plug", SF = "check-sc-frames";
const INTO = "      const into = reuse && w && el && !waiting;   // the room's frame, already made: the same frame takes it\n";
const STOP_KEEP = "        if (!reuse) _remove();\n        else { try { if (w && copy.ready) w.pause(); } catch (e) {} }\n";
const ROWS = [
  // ── One frame in the room, reused (the supervisor's A1, A3) ──
  ["SF1", [[SCP, INTO, "      const into = false;\n"]],
    SF, "A — ONE FRAME IN THE ROOM ACROSS SOUNDCLOUD → SOUNDCLOUD → YOUTUBE → SOUNDCLOUD", "RED"],   // 710's: a fresh frame per song
  ["SF2", [[SCP, INTO, "      const into = false;\n"]],
    PP, "B3 — THE NEXT SOUNDCLOUD SONG GOES INTO THE SAME FRAME", "RED"],   // the same, at the plug's shape
  ["SF3", [[SCP, INTO, "      const into = false;\n"]],
    SF, "E — A SOUNDCLOUD SONG THAT FINISHES EARLY (50 s into 200) IS LOADED ONCE MORE, IN THE SAME FRAME", "RED"],   // an early end's reload in a fresh frame
  ["SF4", [[SCP, "      try { w.load(link, Object.assign({}, LOOK, { callback })); _waitReady(id); }", "      try { w.load(link, { callback }); _waitReady(id); }"]],
    SF, "A — ONE FRAME IN THE ROOM ACROSS SOUNDCLOUD → SOUNDCLOUD → YOUTUBE → SOUNDCLOUD", "RED"],   // the next track loaded without the look or `auto_play`
  ["SF5", [[SCP, "        if (!reuse && mine === gen) _remove();", "        if (mine === gen) _remove();"]],
    SF, "B — ITS SONG ENDS AND THE ROOM HOLDS IT: the frame stays", "RED"],   // 710's: the room's frame removed at its FINISH
  ["SF6", [[SCP, "        if (!reuse && mine === gen) _remove();", "        if (mine === gen) _remove();"]],
    PP, "B6 — ITS SONG OVER, ITS FRAME STAYS", "RED"],   // the same, at the plug's shape
  ["SF7", [[SCP, STOP_KEEP, "        _remove();\n"]],
    PP, "B4 — STOPPED IS PAUSED, THE FRAME KEPT", "RED"],   // 710's: stopped is gone
  ["SF8", [[SCP, STOP_KEEP, "        _remove();\n"]],
    SF, "B — NOTHING PLAYING (`clearPlayer`): the frame paused, and kept", "RED"],   // the same, through the whole UI
  ["SF9", [[SCP, "LOOK = { auto_play: true, hide_related: true,", "LOOK = { auto_play: true,"]],
    PP, "B2 — SOUNDCLOUD'S WIDGET AND ITS LOOK", "RED"],   // `hide_related` gone (A5)
  // ── The track before acts on nothing while the next loads into the frame ──
  ["SF10", [[SCP, "(name === \"READY\" || !reloading)", "true"]],
    PP, "B10 — AN EVENT OF THE TRACK BEFORE, ARRIVING WHILE THE NEXT LOADS INTO THE FRAME, ACTS ON NOTHING", "RED"],   // an old track's end reported
  ["SF11", [[SCP, "        if (--n !== 0 || mine !== gen || reloading) return;", "        if (--n !== 0 || mine !== gen) return;"]],
    PP, "B7 — A LATE ANSWER OF THE TRACK BEFORE IS NOT READ", "RED"],   // an old track's answer names the next song too soon
  ["SF12", [[SCP, "        if (halted) { try { w.pause(); } catch (e) {} return; }   // stopped by the box before it started: never heard\n", ""]],
    SF, "B — A RELATED TRACK PLAYED BY THE WIDGET ITSELF AFTER THE FINISH IS PAUSED AT ONCE", "RED"],   // heard as playing before the check pauses it
  // ── Removed for real on leaving the room (A2) ──
  ["SF13", [[SCP, "      release() { halted = true; _remove();", "      release() { halted = true;"]],
    SF, "C — THE ROOM IS LEFT (`_bgLeaveRoom`, after READY): SoundCloud's frame goes out of the page", "RED"],   // the frame left in the page
  ["SF14", [[SHELL, "    try { if (Player.releasePlayer) Player.releasePlayer(); } catch (e) {}\n", ""]],
    SF, "C — THE ROOM IS LEFT (`_bgLeaveRoom`, before READY): SoundCloud's frame goes out of the page", "RED"],   // the leave never lets it go
  ["SF15", [[PLUG, "        try { if (typeof h.release === \"function\") h.release(); else h.stop(); } catch (e) {}", "        try { h.stop(); } catch (e) {}"]],
    SF, "C — THE ROOM IS LEFT (`_bgLeaveRoom`, after READY): SoundCloud's frame goes out of the page", "RED"],   // the box only stops it
  // ── The preview stays fresh (A4) ──
  ["SF16", [[SCP, "    const reuse = !o.preview;", "    const reuse = true;"]],
    SF, "D — THE PREVIEW'S SONG ENDS: its frame gone", "RED"],   // a preview's frame kept like the room's
  ["SF17", [[SCP, "          else if (!w && !waiting && o.preview && lastId && !destroyed) _load(lastId, copy.ms / 1000);\n", ""]],
    SF, "D — PLAYED AGAIN AFTER ITS END: a FRESH frame for the same song", "RED"],   // the preview's ▶ after its end does nothing
  ["SF18", [[SCP, "      destroy() { destroyed = true; _remove(); },", "      destroy() { destroyed = true; },"]],
    SF, "F — ↻ HELD REBUILDS IT FRESH", "RED"],   // destroyed, the frame and its events stay bound; read at ↻ held (`ddjp_715`: a preview's close removes its frame by its stop first, and api.js hears no second READY, so D no longer sees it)
  // ── CONTROLS: nothing that matters changes ──
  ["FG1", [[SCP, "    // THE FRAME GOES, FOR REAL:", "    // THE FRAME GOES, AND STAYS GONE:"]],
    PP, "", "GREEN"],   // a comment reworded
  ["FG2", [[PLUG, "    // LEAVING (`ddjp_714`): the check stands down", "    // LEAVING THE ROOM (`ddjp_714`): the check stands down"]],
    SF, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j151-sc-frames:" + id, file);   // journalled BEFORE the write
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
