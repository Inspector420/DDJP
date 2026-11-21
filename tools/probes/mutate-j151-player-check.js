// tools/probes/mutate-j151-player-check.js
// SUBJECT: J151 at `ddjp_714` — THE PLUG'S CHECK: every player kept to what the room says, always (`ui/songplayer.js` `check`,
// the room's want and timer in `ui/player.js`, SoundCloud's readings in `ui/soundcloud.js`) — `check-player-check`,
// `check-player-plug`, `check-player-load-once`, `check-player-trail`. The owner's words: "ok just make sure we handle what its
// doing always like we mute it when needed, we unmute when needed and we also send the right songs at right time always". One row
// per thing the check does (the supervisor's B3–B8), each naming the failure it must cause; the controls change nothing that
// matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j151-soundcloud.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j151-player-check.js            every row
//   node tools/probes/mutate-j151-player-check.js PC1 PC9    named rows
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
const PC = "check-player-check", PP = "check-player-plug", LO = "check-player-load-once", PT = "check-player-trail";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── Not shown, or held: paused, and its sound 0 (B3) ──
  ["PC1", [[PLUG, "if (st === \"playing\" || st === \"buffering\") { try { h.pause(); } catch (x) {} e.play = false;", "if (st === \"playing\" || st === \"buffering\") { e.play = false;"]],
    PC, "B — YOUTUBE'S HIDDEN PLAYER STARTS PLAYING behind SoundCloud's", "RED"],   // said, never paused
  ["PC2", [[PLUG, "e.play = false; _say(s, \"play\", \"playing while \" + why); }", "e.play = false; }"]],
    PC, "B — YOUTUBE'S HIDDEN PLAYER STARTS PLAYING behind SoundCloud's", "RED"],   // paused, its line gone
  ["PC3", [[PLUG, "const shown = _shown(s), silent = !shown || !!w.held;", "const shown = _shown(s), silent = !shown;"]],
    PC, "B — A HELD PLAYER (its song over, the room holding it) THAT STARTS", "RED"],   // a held player left to play
  ["PC4", [[PLUG, "          if (!held0[s]) { try { _toSilent(s); } catch (x) {} }", "          if (w.held) { /* its sound left as it is */ }\n          else if (!held0[s]) { try { _toSilent(s); } catch (x) {} }"]],
    PC, "B — A HELD PLAYER (its song over, the room holding it) THAT STARTS", "RED"],   // a held player's sound left on
  ["PC5", [[PLUG, "          if (!held0[s]) { try { _toSilent(s); } catch (x) {} }", "          if (w.held) { /* its sound left as it is */ }\n          else if (!held0[s]) { try { _toSilent(s); } catch (x) {} }"]],
    PP, "D — YOUTUBE'S PLAYERS ARE HANDED THE SAME COMMANDS, IN THE SAME ORDER", "RED"],   // and D sees the held end's mute() go
  ["PC6", [[SCP, "if (!paused && copy.state !== \"playing\" && copy.state !== \"buffering\") { copy.state = \"playing\"; _report(\"playing\"); }", "if (false) {}"]],
    PC, "B — SOUNDCLOUD'S HIDDEN WIDGET STARTS PLAYING behind YouTube's", "RED"],   // the widget's own play never read
  ["PC7", [[PLAYER, "    _checkTimer = setInterval(() => { if (player) _checkPlayer(_lastNp); }, CHECK_MS);", "    _checkTimer = null;"]],
    PC, "B — YOUTUBE'S HIDDEN PLAYER STARTS PLAYING behind SoundCloud's", "RED"],   // no check every 2 s: a silent player never caught
  ["PC8", [[PLUG, "bp.check(undefined, undefined, { short, word: w }); };", "void 0; };"]],
    PP, "C — A HIDDEN PLAYER THAT PLAYS IS PAUSED AT ONCE BY THE CHECK", "RED"],   // no check on a player's event
  ["PC9", [[PLUG, "      if (said[k]) return;\n", ""]],
    PP, "C — A HIDDEN PLAYER THAT PLAYS IS PAUSED AT ONCE BY THE CHECK AND LOGGED ONCE", "RED"],   // a line for every check
  ["PC10", [[PLUG, "          else _right(s, \"play\");\n          let m = null;", "          let m = null;"]],
    PP, "C — and a second play, after a check found it paused, is logged again", "RED"],   // said once, never again
  // ── The wrong song, or none (B3) ──
  ["PC11", [[SCP, "sound.id !== copy.soundId && copy.id) {", "false && copy.id) {"]],
    PC, "C — THE WIDGET LOADS ANOTHER TRACK BY ITSELF", "RED"],   // another track taken for the room's song
  ["PC12", [[PLUG, "              try { asked = a.load(w.song, \"it shows \" + shows); } catch (x) {}", "              asked = false;"]],
    PC, "F — YOUTUBE'S PLAYER SHOWS ANOTHER VIDEO", "RED"],   // the wrong song never loaded again
  ["PC13", [[PLUG, "const coming = !!(pend && pend.id === wp.id && wp.service === s && Date.now() - pend.at < LOAD_WAIT_MS);", "const coming = false;"]],
    LO, "a new play loads EXACTLY once until it plays", "RED"],   // a load on its way loaded again
  // ── Playing, as asked (B3) ──
  ["PC14", [[PLUG, "if (_mayGive(s, \"pause\")) { try { h.play(); } catch (x) {}", "if (_mayGive(s, \"pause\")) {"]],
    PC, "E — YOUTUBE'S SHOWN PLAYER PAUSES BY ITSELF", "RED"],   // said, never played
  ["PC15", [[PLUG, "      _exp(p.service).play = true;\n      // A song loaded", "      // A song loaded"]],
    PC, "E — SOUNDCLOUD'S SHOWN WIDGET PAUSES BY ITSELF", "RED"],   // a loaded song not counted as asked to play
  // ── The room's point (B3) ──
  ["PC16", [[PLUG, "                try { h.seek(at); } catch (x) {}\n", ""]],
    PC, "G — A DRIFT OVER 10 s", "RED"],   // said, never sought
  ["PC17", [[PLUG, "            if (!(cap > 0) || at <= cap - 1) {", "            if (true) {"]],
    PC, "G — NEVER PAST THE PLAYER'S LENGTH LESS 1 s", "RED"],   // the parked seek past the end, back
  ["PC18", [[PLAYER, "    const at = (np.elapsed !== undefined && np.duration) ? () => np.elapsed + Math.max(0, Date.now() - t0) / 1000 : null;",
                     "    const at = (np.elapsed !== undefined && np.duration) ? () => np.elapsed : null;"]],
    PC, "A — QUIET WHEN ALL IS RIGHT", "RED"],   // the room's point frozen at the push: a playing player drifts away from it
  // ── This device's volume, and the person's in a frame (B4) ──
  ["PC19", [[PLUG, "else if (m === false) { try { h.mute(); } catch (x) {} e.muted = true;", "else if (m === false) { e.muted = true;"]],
    PC, "D — THE VOLUME TURNED UP INSIDE A HIDDEN FRAME", "RED"],   // a hidden frame's sound left on
  ["PC20", [[SCP, "if (typeof vol === \"number\" && vs === volSeq && copy.applied !== null && Math.abs(vol - copy.applied) > 1) {", "if (false) {"]],
    PC, "D — THE VOLUME SET INSIDE SOUNDCLOUD'S SHOWN PLAYER IS THE PERSON'S", "RED"],   // 710's owed line: SoundCloud's own volume never read back
  ["PC21", [[PLUG, "        if (typeof lv !== \"number\" || typeof e.level !== \"number\" || _held() || held0[s]) continue;",
                   "        if (typeof lv !== \"number\" || typeof e.level !== \"number\") continue;"]],
    PC, "D — THE VOLUME TURNED UP INSIDE A HELD FRAME", "RED"],   // a held frame's own volume taken for the person's
  ["PC22", [[PLUG, "        try { if (typeof Logger !== \"undefined\") Logger.info(\"Player: volume from \" + s", "        try { if (typeof Logger === \"undefined\") Logger.info(\"Player: volume from \" + s"]],
    PC, "D — AND INSIDE YOUTUBE'S SHOWN PLAYER", "RED"],   // taken, its line gone
  // ── Nothing is logged when all is right; the push runs the check even if drawing throws ──
  ["PC23", [[PLUG, "    function _right(s, kind) { said[s + \":\" + kind] = false; }", "    function _right(s, kind) { said[s + \":\" + kind] = false; if (kind === \"volume\") _say(s, \"ok\", \"all right\"); }"]],
    PC, "A — QUIET WHEN ALL IS RIGHT", "RED"],   // a line while all is right
  ["PC24", [[PLAYER, "    try { _followRoom(np); }\n    finally { _checkPlayer(np); }", "    _followRoom(np);\n    _checkPlayer(np);"]],
    PT, "A3: a seek says where to, why, and how long after its load", "RED"],   // a fault drawing the line skips the check
  ["PC25", [[PLUG, "      if (last) last = Object.assign({}, last, { song: key, held: false });\n", ""]],
    PC, "A — QUIET WHEN ALL IS RIGHT", "RED"],   // a load's own events checked against the song before's held want (seen in Chromium)
  // ── CONTROLS: nothing that matters changes ──
  ["PG1", [[PLUG, "    // ── ONE CORRECTION: its command, and its one line ──", "    // ── ONE CORRECTION: its command and its line ──"]],
    PC, "", "GREEN"],   // a comment reworded
  ["PG2", [[PLAYER, "  // EVERY 2 s WHILE IN THE ROOM (`ddjp_714`)", "  // EVERY TWO SECONDS WHILE IN THE ROOM (`ddjp_714`)"]],
    PP, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j151-player-check:" + id, file);   // journalled BEFORE the write
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
