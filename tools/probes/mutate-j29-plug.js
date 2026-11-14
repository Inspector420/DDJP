// tools/probes/mutate-j29-plug.js
// SUBJECT: J29's step 2 — every song service's player behind one plug (`ddjp_706`): the plug (`ui/songplayer.js`), YouTube's
// player file (`ui/youtube.js`), the table's hosts and player files (`core/songs.js`) against the page's allowed hosts
// (`index.html`), the page and `app.js` naming no service, the room player through the plug (`ui/player.js`), and J49's row on
// `_confirmReading` (`features/playback.js`) — `check-player-plug`, `check-duration-provider`, `check-length-freshness`. One
// row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must
// stay green. The supervisor's list for this step: a host missing, a host left over, a row with no player, a service named
// elsewhere; the plug's shape; the same calls in the same order; a second service in the room's player; J49's pairing.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j29-songs.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j29-plug.js            every row
//   node tools/probes/mutate-j29-plug.js PL1 PL7    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PAGE = "index.html";
const APP = "app.js";
const SONGS = "core/songs.js";
const PLUG = "ui/songplayer.js";
const YTP = "ui/youtube.js";
const PLAYER = "ui/player.js";
const PB = "features/playback.js";
const PP = "check-player-plug";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── (A) the three things a service is, held together ──
  // PL1, PL2 and PL15 re-anchored at `ddjp_709`: the page allows SoundCloud's hosts after YouTube's, and the plug hides every
  // other player as a box switches (the same failure each names, on the lines as they now read).
  ["PL1", [[PAGE, " https://s.ytimg.com https://w.soundcloud.com", " https://w.soundcloud.com"]],
    PP, "A1 — EVERY HOST A ROW NAMES IS ALLOWED BY THE PAGE", "RED"],   // a host missing
  ["PL2", [[PAGE, "    frame-src https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com;", "    frame-src https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com https://w.gone.example;"]],
    PP, "A1 — AND THE PAGE ALLOWS NO HOST BEYOND THE TABLE'S AND THE APP'S OWN", "RED"],   // a host left over
  ["PL3", [[SONGS, "      player: \"ui/youtube.js\",", "      player: null,"]],
    PP, "A2 — EVERY ROW NAMES A PLAYER FILE THE PLUG LOADS", "RED"],   // a row with no player
  ["PL4", [[PAGE, "<script src=\"ui/youtube.js?v=", "<!-- gone --><script src=\"ui/no-player.js?v="]],
    PP, "A2 — THE PAGE LISTS EVERY ROW'S PLAYER FILE", "RED"],   // re-anchored at `ddjp_707`: the page lists the player (it was the plug's write)
  // PL5, PL8 and PG1 re-anchored at `ddjp_712`: `_onPlayerReady` names the box player it hears (`bp`), so a rebuilt one's is ignored.
  ["PL5", [[PLAYER, "  function _onPlayerReady(bp) {", "  function _ytPlayerOf() { return typeof YT !== \"undefined\" ? YT.Player : null; }\n  function _onPlayerReady(bp) {"]],
    PP, "A3 — NO FILE BUT YOUTUBE'S PLAYER KNOWS YOUTUBE'S PLAYER", "RED"],   // YouTube's player known outside its file
  ["PL6", [[APP, "// Wires the encryption gate, session restore, and the", "// Wires the YouTube callback, the encryption gate, session restore, and the"]],
    PP, "A3 — `app.js` NAMES NO SERVICE", "RED"],   // app.js names YouTube again
  ["PL7", [[PAGE, "<script src=\"ui/songplayer.js?v=", "<script src=\"https://www.youtube.com/iframe_api\"></script>\n<script src=\"ui/songplayer.js?v="]],
    PP, "A3 — THE PAGE NAMES NO SERVICE OUTSIDE ITS ALLOWED HOSTS", "RED"],   // the page asks for YouTube's script itself
  ["PL8", [[PLAYER, "  function _onPlayerReady(bp) {", "  const _NOCOOKIE = \"https://www.youtube-nocookie.com\";\n  function _onPlayerReady(bp) {"]],
    PP, "A3 — A ROW'S HOSTS ARE SPELLED ONLY IN THE TABLE AND ITS OWN PLAYER FILE", "RED"],   // a row's host spelled elsewhere
  ["PL9", [[PLUG, "  const WORDS = [", "  const FIRST = \"yt\";\n  const WORDS = ["]],
    PP, "A3 — THE PLUG NAMES NO SERVICE", "RED"],   // the plug names a service
  // ── (B) the plug's shape ──
  ["PL10", [[PLUG, "      h.load(p.id, startSec);", "      h.load(key, startSec);"]],
    PP, "B3 — A KEY IS LOADED AS THE SERVICE'S OWN ID", "RED"],   // the key handed to the service
  ["PL11", [[YTP, "    150: \"embed-denied\",", "    150: \"unavailable\","]],
    PP, "B6 — A FAILURE IS THE APP'S REASON", "RED"],   // YouTube's mapping changed in the move
  ["PL12", [[YTP, "\"2\": \"paused\"", "\"2\": \"playing\""]],
    PP, "B6 — YouTube's numbered states arrive as the PLUG'S WORDS", "RED"],   // a state misnamed
  ["PL13", [[PLUG, "    bp.time = function () { return _read((h) => h.time(), null); };", "    let _t = null;\n    bp.time = function () { if (_t === null) _t = _read((h) => h.time(), null); return _t; };"]],
    PP, "B8 — HOW FRESH", "RED"],   // a reading kept, not fresh
  // PL14 and PL15 re-anchored at `ddjp_714`: this device's volume goes with the player the box shows (given as it shows), and
  // the loop that steps the others aside mutes them too.
  ["PL14", [[PLUG, "      if (held0[p.service] || e0.level !== dev.level || e0.muted !== dev.muted) { try { _toLive(p.service); } catch (e) {} }\n", ""]],
    PP, "B5 — THIS DEVICE'S VOLUME goes with the player the box shows", "RED"],   // the next service's song starts at another sound
  ["PL15", [[PLUG, "try { if (s === showing) { handles[s].stop(); _exp(s).play = false; } handles[s].show(false); } catch (e) {}", "try { if (s === showing) { handles[s].stop(); _exp(s).play = false; } } catch (e) {}"]],
    PP, "B3 — and the one showing is the one seen", "RED"],   // two services' players seen at once
  // ── (C) a second service in the room's player ──
  ["PL16", [[PLAYER, "    MediaBlocked.notifyPlayerFailed(reason, erroredId);", "    MediaBlocked.notifyPlayerFailed(short === SongPlayer.registered()[0] ? reason : null, erroredId);"]],
    PP, "C — A FAILURE REACHES MediaBlocked AS A REASON", "RED"],   // only the first service's failures count
  // ── (D) the same calls, in the same order (decision 5) ──
  ["PL17", [[YTP, "      seek(sec) { p.seekTo(sec, true); },", "      seek(sec) { p.seekTo(sec); },"]],
    PP, "D — YOUTUBE'S PLAYERS ARE HANDED THE SAME COMMANDS, IN THE SAME ORDER", "RED"],   // a command changed
  // ── PL18 retired at `ddjp_714`: it swapped two READINGS (the length and the song at "playing"), and PART D compares YouTube's
  //    commands and events since the plug's check, which reads the player at every push, event and 2 s (the supervisor's point
  //    8: the changed calls said exactly — two commands more, readings measured, not compared). A command's order is PL17's. ──
  // ── the length provider through the plug, and J49's row ──
  ["PL19", [[PLUG, "        if (!k) return null;", "        if (!k) return { songKey: null, seconds: 0 };"]],
    "check-duration-provider", "THE PROVIDER CONTRACT CHANGED", "RED"],   // a reading with a falsy id
  ["PL20", [[PB, "if (!expectedSongKey || r.songKey !== expectedSongKey) {", "if (r.songKey !== expectedSongKey) {"]],
    "check-length-freshness", "E (null with null) — A READING THAT NAMES NO SONG IS NOT DECLARED", "RED"],   // J49's clause dropped
  // ── CONTROLS: nothing that matters changes ──
  ["PG1", [[PLAYER, "  function _onPlayerReady(bp) {", "  // YouTube's player (`YT.Player`) is ui/youtube.js's: a comment naming it is no knowledge of it\n  function _onPlayerReady(bp) {"]],
    PP, "", "GREEN"],   // part A reads the language, not the text
  ["PG2", [[PLUG, "    bp.time = function () { return _read((h) => h.time(), null); };", "    bp.time = function () { const v = _read((h) => h.time(), null); return v; };"]],
    PP, "", "GREEN"],
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
      const h = J.open("mutate-j29-plug:" + id, file);   // journalled BEFORE the write
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
