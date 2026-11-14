// tools/probes/mutate-j151-reuse-fix.js
// SUBJECT: J151 at `ddjp_715` — THE ROOM'S REUSED SOUNDCLOUD PLAYER HEARS ITS NEXT SONG: SoundCloud's player file
// (`ui/soundcloud.js`: the load's callback and number, the 5 s fresh frame once per song, "cued", a seek before ready), the
// plug's check (`ui/songplayer.js`: "cued" started RETRY_MS after the load; a load not yet played never the person's volume),
// the room's player (`ui/player.js`: the length declared on "cued"; the tab's hidden and shown lines) and the stand-in made
// faithful to SoundCloud's own `api.js` (`tests/_sc-player.js`) — `check-sc-frames` G, `check-player-check` H and I. The
// owner's words (`ddjp_714`, his log at `?v=631`): "then it plays, it often randomly reloads to the start, and i dont see
// declared lengh in matrix...". One row per thing the fix does, each naming the failure it must cause; the controls change
// nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j151-sc-frames.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j151-reuse-fix.js            every row
//   node tools/probes/mutate-j151-reuse-fix.js RF1 RF5    named rows
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
const PLAYER = "ui/player.js";
const STAND = "tests/_sc-player.js";
const SF = "check-sc-frames", PC = "check-player-check";
const HEARD = "G — THE NEXT SONG INTO THE SAME FRAME IS HEARD";
const ROWS = [
  // ── The next track up, told by the load's own callback, the latest load's alone ──
  ["RF1", [[SCP, "Object.assign({}, LOOK, { callback })", "Object.assign({}, LOOK)"]],
    SF, HEARD, "RED"],   // 714's: no callback — its READY never reaches the handle
  ["RF2", [[SCP, "if (mine === loadSeq && g === gen && w && reloading) _ready();", "if (g === gen && w && reloading) _ready();"]],
    SF, "G — AN EARLIER TRACK'S READY NEVER NAMES THE NEXT SONG", "RED"],   // an earlier load's callback names the next song with its length
  // ── No ready in 5 s: a fresh frame, once per song, the room's player only ──
  ["RF3", [[SCP, "    function _waitReady(id) {\n      if (!reuse) return;\n", "    function _waitReady(id) {\n      return;\n"]],
    SF, "G — NO READY 5 s AFTER ITS LOAD", "RED"],   // no fallback
  ["RF4", [[SCP, " || loading !== id || freshFor === id) return;", " || loading !== id) return;"]],
    SF, "G — ONCE FOR THE SONG, NEVER A LOOP", "RED"],   // a fresh frame every 5 s
  ["RF5", [[SCP, "    function _waitReady(id) {\n      if (!reuse) return;\n", "    function _waitReady(id) {\n"]],
    SF, "G — A PREVIEW STAYS AS IT IS", "RED"],   // a preview's frame replaced too
  // ── "cued": reported, started by the check RETRY_MS after the load, its length declared ──
  ["RF6", [[SCP, "if (reuse && copy.id && copy.state === \"buffering\" && !heardPlay) { copy.state = \"cued\"; _report(\"cued\"); }", ""]],
    SF, HEARD, "RED"],   // never "cued": no length before it plays
  ["RF7", [[PLUG, "        if (wp && e.play === true && st === \"cued\") {", "        if (false) {"]],
    SF, "G — NOT STARTED BY ITSELF, IT IS STARTED", "RED"],   // a song up and never started is left waiting
  ["RF8", [[PLUG, "      gave[p.service + \":start\"] = Date.now();", ""]],
    SF, "G — NOT STARTED BY ITSELF, IT IS STARTED", "RED"],   // pushed at once, before it could start by itself
  ["RF9", [[PLAYER, "      if (d && k) Playback.setDuration(k, d);\n    }\n    if (word === \"playing\") {", "    }\n    if (word === \"playing\") {"]],
    SF, HEARD, "RED"],   // "cued" declares no length
  // ── A seek asked before ready is the start point ──
  ["RF10", [[SCP, "        else if (loading) { wantStartMs = ms > 0 ? ms : null; startAsked = ms; startAt = Date.now(); }", "        else { copy.ms = ms; }"]],
    SF, "G — A SEEK ASKED BEFORE READY IS THE START POINT", "RED"],   // 714's: written into the copy as if done, and dropped
  // ── YouTube's own mute at a load is not the person's ──
  ["RF11", [[PLUG, "        if (loaded[s] && !loaded[s].played) continue;   // a load not yet played: the player's own doing, never the person's\n", ""]],
    PC, "H — YOUTUBE'S OWN MUTE AT A LOAD IS NOT THE PERSON'S CHOICE", "RED"],   // 714's: "volume from yt — 100, muted"
  // ── The tab hidden and shown, in the log ──
  ["RF12", [[PLAYER, "{ _hiddenAt = Date.now(); Logger.info(\"Player: tab hidden\"); }", "{ _hiddenAt = Date.now(); }"]],
    PC, "I — THE TAB HIDDEN AND SHOWN, IN THE LOG", "RED"],   // hidden, unsaid
  ["RF13", [[PLAYER, "    if (!_tabWatched) return;   // the room left: says nothing\n", ""]],
    PC, "I — THE TAB HIDDEN AND SHOWN, IN THE LOG", "RED"],   // said after the room was left (the harness's remove does nothing)
  // ── The stand-in follows api.js ──
  ["RF14", [[STAND, "      m.st.readyOnce.splice(0).forEach((fn) => fn());", "      m.st.readyOnce.forEach((fn) => fn());"]],
    SF, "G PREMISE — THE STAND-IN FOLLOWS SOUNDCLOUD'S api.js", "RED"],   // 714's belief: a READY handler heard at every READY
  ["RF15", [[STAND, "      asked.forEach((a) => { if (a.callback) a.callback(); });", ""]],
    SF, "G PREMISE — THE STAND-IN FOLLOWS SOUNDCLOUD'S api.js", "RED"],   // the load's callback never run
  // ── CONTROLS: nothing that matters changes ──
  ["RG1", [[SCP, "    // ITS TRACK IS UP — a fresh frame's READY", "    // ITS TRACK IS UP: a fresh frame's READY"]],
    SF, "", "GREEN"],   // a comment reworded
  ["RG2", [[PLUG, "        // ITS SONG UP AND NEVER STARTED (\"cued\"", "        // ITS SONG UP, NEVER STARTED (\"cued\""]],
    PC, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j151-reuse-fix:" + id, file);   // journalled BEFORE the write
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
