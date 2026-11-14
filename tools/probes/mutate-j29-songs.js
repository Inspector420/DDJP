// tools/probes/mutate-j29-songs.js
// SUBJECT: J29's steps 1 and 2 — a song named by its service and its id (`ddjp_705`), in ONE FORM EVERYWHERE (`ddjp_706`): the
// services table and every reading of a key (`core/songs.js`), the sends that refuse a bare id (`features/queue.js`,
// `features/medialength.js`), My queue's and a playlist's add boxes, which take a link and refuse a bare id by name
// (`features/userqueue.js`, `features/playlists.js`), the canonical link rebuilt from the key (`backends/backend1/vouch.js`), what
// was saved before keys skipped, once said (`core/store.js`, `core/playlistdoc.js`, `features/userqueue.js`), the places a person
// reads a song before its title (`features/botruntime.js`, `ui/player.js`, `ui/playlists.js`), the players handed the service's
// own id by the plug (`ui/songplayer.js`) and a bare-id song not loaded (`ui/player.js`), the room surface's `songName`, and the
// selector that runs this file (`tools/breaks-for.js`) — `check-song-services`, `check-player-cover`, `check-preview-controls`,
// `check-vouch`, `check-room-compat`, `check-breaks-for`. One row per way it could go wrong, each naming the failure it must
// cause; the controls change nothing that matters and must stay green. (SG10–SG16 held what step 1 carried over from before
// keys; step 2 dropped that, so they were replaced by the rows that hold the drop.)
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j29-songs.js            every row
//   node tools/probes/mutate-j29-songs.js SG1 SG7    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SONGS = "core/songs.js";
const UQ = "features/userqueue.js";
const META = "features/metadata.js";
const QUEUE = "features/queue.js";
const ML = "features/medialength.js";
const VOUCH = "backends/backend1/vouch.js";
const STORE = "core/store.js";
const PLD = "core/playlistdoc.js";
const BOT = "features/botruntime.js";
const PLAYER = "ui/player.js";
const PLUI = "ui/playlists.js";
const PLFEAT = "features/playlists.js";
const PLUG = "ui/songplayer.js";
const SS = "check-song-services";
const A = "A — NOTHING OUTSIDE `core/songs.js` KNOWS A SONG SERVICE";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── (a) nothing outside the module knows a service ──
  ["SG1", [[UQ, "  function _extractSongKey(url) { return Songs.fromLink(url); }", "  function _extractSongKey(url) { return /^[A-Za-z0-9_-]{11}$/.test(url) ? null : Songs.fromLink(url); }"]],
    SS, A, "RED"],   // YouTube's id rule spelled in a features file
  ["SG2", [[META, "    return validId(songKey) ? Songs.pictureOf(songKey) : null;", "    return validId(songKey) ? \"https://i.ytimg.com/vi/\" + Songs.idOf(songKey) + \"/hqdefault.jpg\" : null;"]],
    SS, A, "RED"],   // the picture host spelled in a features file
  ["SG3", [[VOUCH, "      a.u = Songs.linkOf(a.v);", "      a.u = \"https://www.youtube.com/watch?v=\" + Songs.idOf(a.v);"]],
    SS, A, "RED"],   // a link host spelled in the engine
  // ── (b) every event that carries a song carries a key ──
  ["SG4", [[QUEUE, "\"ddjp.dj.join\", { v: songKey, u: Songs.linkOf(songKey) });", "\"ddjp.dj.join\", { v: Songs.idOf(songKey), u: Songs.linkOf(songKey) });"]],
    SS, "B — EVERY EVENT THAT CARRIES A SONG CARRIES A KEY", "RED"],   // the join sends the bare id
  ["SG5", [[QUEUE, "      if (Songs.isKey(v)) continue;", "      continue;"]],
    SS, "B6 — a bare id handed to the join, the strike, the undeclare or the order is REFUSED BY NAME", "RED"],   // the send door gone
  // SG6 (MediaLength refused a length for a room's bare id) went at `ddjp_712` with the door it broke: old rooms are not
  // supported (the owner's decision 2), and `check-song-services` B6 now holds that the door is gone (`mutate-j152-reload`).
  ["SG7", [[UQ, "  function _extractSongKey(url) { return Songs.fromLink(url); }", "  function _extractSongKey(url) { return Songs.idOf(Songs.fromLink(url)); }"]],
    SS, "B1 — My queue reads", "RED"],   // My queue reads a link as the bare id
  // ── (c) the round trip against the old parser ──
  ["SG8", [[SONGS, "        if (u.hostname.indexOf(\"youtu.be\") >= 0) return _ytClean(u.pathname.slice(1).split(\"/\")[0]);", "        if (u.hostname.indexOf(\"youtu.be\") >= 0) return null;"]],
    SS, "C — the module reads", "RED"],   // a link form the old parser read, lost
  ["SG9", [[SONGS, "  function _ytLink(id) { return \"https://www.youtube.com/watch?v=\" + id; }", "  function _ytLink(id) { return \"https://youtube.com/watch?v=\" + id; }"]],
    SS, "C — key → link is the canonical link the app wrote before keys", "RED"],   // a canonical link the app never wrote
  // ── one form everywhere: what was saved before keys is skipped, once said (J29, step 2) ──
  ["SG10", [[PLD, "    const tracks = rec.tracks.filter((t) => t && typeof t === \"object\" && validId(t.songKey));", "    const tracks = rec.tracks.filter((t) => t && typeof t === \"object\");"]],
    SS, "D1 — A PLAYLIST STORED BEFORE KEYS reads with none of its songs", "RED"],   // a bare-id song shown half-read
  ["SG11", [[STORE, "    if (_oldSaid) return;", "    if (false) return;"]],
    SS, "D1 — the log line is not said again for a second old record", "RED"],   // the line said for every record
  ["SG12", [[UQ, "    const kept = list.filter((e) => e && Songs.isKey(e.songKey));", "    const kept = list.filter((e) => e);"]],
    SS, "D5 — A MY QUEUE LIST SAVED BEFORE keeps its songs named by key under `songKey` and skips the rest", "RED"],   // My queue keeps bare ids (D5's words since `ddjp_707`)
  ["SG13", [[PLD, "        const out = { songKey: t.songKey };", "        const out = { songKey: Songs.idOf(t.songKey), source: \"youtube\" };"]],
    SS, "D2 — a library export writes keys too", "RED"],   // re-anchored at `ddjp_712`: the single-playlist export is gone, the library's is the file   // an export written in the old form
  ["SG14", [[PLFEAT, "    const songKey = Songs.fromLink(raw);", "    const songKey = Songs.fromLink(raw) || Songs.key(\"yt\", raw);"]],
    SS, "D4 — A PLAYLIST'S ADD BOX REFUSES A BARE ID", "RED"],   // a bare id read as YouTube's in a playlist's box
  ["SG15", [[UQ, "  function _extractSongKey(url) { return Songs.fromLink(url); }", "  function _extractSongKey(url) { return Songs.fromLink(url) || Songs.key(\"yt\", url); }"]],
    SS, "D5 — MY QUEUE'S ADD BOX REFUSES A BARE ID", "RED"],   // a bare id read as YouTube's in My queue's box
  ["SG16", [[SONGS, "    linkOf, pictureOf, titleLookupOf, shownAs,\n  };", "    linkOf, pictureOf, titleLookupOf, shownAs,\n    keyOf: (v) => (parts(v) ? v : key(\"yt\", v)),\n  };"]],
    SS, "C — the module keeps no door from the old forms", "RED"],   // a door from a bare id back
  // ── a person never reads `yt:` ──
  ["SG17", [[BOT, "\"Skipped \" + Songs.shownAs(songKey) + \" — it played \"", "\"Skipped \" + songKey + \" — it played \""]],
    SS, "E1", "RED"],   // the bot's line names the key
  ["SG18", [[PLAYER, "    refs.songTitleText.textContent = realTitle || Songs.shownAs(_currentSong.songKey);", "    refs.songTitleText.textContent = realTitle || _currentSong.songKey;"]],
    SS, "E2 — the now-playing title reads YouTube's id", "RED"],   // the player's title names the key
  ["SG19", [[PLUI, "    const shown = heldTitle || Songs.shownAs(songKey);", "    const shown = heldTitle || songKey;"]],
    SS, "E3", "RED"],   // a playlist row names the key
  // ── each player handed its service's own id, by the plug (J29, step 2; the two doors of step 1 moved into it) ──
  ["SG20", [[PLUG, "      h.load(p.id, startSec);", "      h.load(key, startSec);"]],
    SS, "E4 — the main player is handed YouTube's own id, never `yt:`", "RED"],   // the main player handed the key
  ["SG21", [[PLUG, "      if (p && _make(p.service, p.id)) showing = p.service;", "      if (p && _make(p.service, o.song)) showing = p.service;"]],
    "check-preview-controls", "D: THE PREVIEW'S PLAYER IS BUILT WITH YOUTUBE'S OWN ID", "RED"],   // the preview handed the key
  ["SG22", [[PLAYER, "    if (_why && !SongPlayer.plays(np.song.songKey)) {", "    if (false) {"]],
    "check-player-cover", "F: A SONG A ROOM MADE BEFORE KEYS NAMES BY A BARE ID IS NOT LOADED", "RED"],   // a bare-id song loaded
  ["SG23", [[PLAYER, "      if (_notPlayablePi !== np.pi) {", "      if (true) {"]],
    "check-player-cover", "F: A SONG A ROOM MADE BEFORE KEYS NAMES BY A BARE ID IS NOT LOADED", "RED"],   // said on every tick
  // ── the engine: the link rebuilt from the key ──
  ["SG24", [[VOUCH, "      a.u = Songs.linkOf(a.v);", "      a.u = Songs.linkOf(Songs.idOf(a.v));"]],
    "check-vouch", "A: rebuild(compact(x)) must equal the action payload byte for byte", "RED"],   // the link rebuilt from the bare id: gone
  // ── the room surface learns the form of a song's name ──
  ["SG25", [[SONGS, "      short: \"yt\",", "      short: \"yo\","]],
    "check-room-compat", "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // a song's name changes form, unacknowledged
  // ── the selector runs this file when what it breaks changes ──
  ["SG26", [["tools/breaks-for.js", "  const maintained = all.filter(asks);", "  const maintained = all.filter((f) => { const m = f.match(/^mutate-j(\\d+)-/); return asks(f) && !!m && Number(m[1]) >= 67; });"]],
    "check-breaks-for", "WHICH — A BREAK FILE THAT JUDGES THROUGH `_verdict.js` IS MAINTAINED", "RED"],   // maintained by number again
  // ── CONTROLS: nothing that matters changes ──
  ["G1", [[META, "    return validId(songKey) ? Songs.pictureOf(songKey) : null;", "    // was \"https://i.ytimg.com/vi/<id>/hqdefault.jpg\" before keys — a comment is no spelling\n    return validId(songKey) ? Songs.pictureOf(songKey) : null;"]],
    SS, "", "GREEN"],   // a host in a comment: part A reads the language, not the text
  ["G2", [[QUEUE, "      if (Songs.isKey(v)) continue;", "      if (Songs.isKey(v) === true) continue;"]],
    SS, "", "GREEN"],
  ["G3", [[SONGS, "  function isKey(k) { return parts(k) !== null; }", "  function isKey(k) { return !!parts(k); }"]],
    SS, "", "GREEN"],
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
      const h = J.open("mutate-j29-songs:" + id, file);   // journalled BEFORE the write
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
