// tools/probes/mutate-j29-words.js
// SUBJECT: J29's step 3 — names and words (`ddjp_707`): the app says "song" and its names do too (`check-song-words`), a
// song's own fields are part of the room surface (`check-room-compat`), the page lists each player file (`check-player-plug`
// A2), and the last of the old data is gone — My queue's `{ stack }`, the store's localStorage read-through, a song history row
// and the hide-the-player preference saved under the old names (`check-song-services` D6–D8, `check-store` B). One row per
// way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j29-songs.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j29-words.js            every row
//   node tools/probes/mutate-j29-words.js SW1 SW7    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PAGE = "index.html";
const QUEUE = "features/queue.js";
const QUI = "ui/queue.js";
const CP = "core/chatprefs.js";
const SHELL = "ui/shell.js";
const SD = "backends/backend1/statederiver.js";
const UQ = "features/userqueue.js";
const STORE = "core/store.js";
const HIST = "backends/backend1/history.js";
const SW = "check-song-words";
const A = "A — NO CODE NAME, WORD, REASON TOKEN OR STORED KEY OUTSIDE YOUTUBE'S PLAYER FILE SAYS";
// The page's version, read from this copy's own page, so the rows that write a player line carry the plug's `?v=` at every bump
// (`ddjp_708`: they were written with `?v=624` itself, and the next bump would have voided PF4 and changed PF2's failure).
const V = ((fs.readFileSync(path.join(ROOT, PAGE), "utf8").match(/<script src="ui\/songplayer\.js\?v=(\d+)"/) || [])[1]) || "?";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── (a) the app says "song", and its names do too ──
  ["SW1", [[QUEUE, "\"ddjp.dj.join\", { v: songKey, u: Songs.linkOf(songKey) });", "\"ddjp.dj.join\", { v: songKey, u: Songs.linkOf(songKey), videoId: songKey });"]],
    SW, A, "RED"],   // a code name says video again, in a feature
  ["SW2", [[QUI, "placeholder: \"Paste a song link…\"", "placeholder: \"Paste a YouTube link…\""]],
    SW, A, "RED"],   // a word a person reads says YouTube again, on a screen
  ["SW3", [[CP, "      playerHidden: false,", "      playerHidden: false,\n      videoHidden: false,"]],
    SW, A, "RED"],   // a stored key says video again
  ["SW4", [[SD, "    \"no-song-key\":                  \"it named no song\",", "    \"no-video-id\":                  \"it named no song\","]],
    SW, A, "RED"],   // a reason token says video again
  ["SW5", [[SHELL, "{ class: \"song-title\" }", "{ class: \"video-title\" }"], [PAGE, "    .song-title { flex:", "    .video-title { flex:"]],
    SW, "B — THE PAGE'S IDS, CLASSES AND WORDS SAY NEITHER", "RED"],   // a class of the page says video again
  ["SW6", [[CP, "  function playerHidden()    { return _st().playerHidden === true; }", "  function playerHidden()    { return _st().playerHidden === true; }\n  const _ytHidden = playerHidden;"]],
    SW, A, "RED"],   // YouTube by abbreviation, in a name
  // ── (b) a song's own fields are part of the room surface ──
  ["SF1", [[SD, "        song: nowPlaying.song ? { songKey: nowPlaying.song.songKey, songLink: nowPlaying.song.songLink != null ? nowPlaying.song.songLink : null } : null,",
            "        song: nowPlaying.song ? { songKey: nowPlaying.song.songKey, songUrl: nowPlaying.song.songLink != null ? nowPlaying.song.songLink : null } : null,"]],
    "check-room-compat", "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // a now-playing song's field renamed, unacknowledged
  ["SF2", [[SD, "pending: members[u].pending.map((s) => ({ songKey: s.songKey, songLink: s.songLink != null ? s.songLink : null })),",
            "pending: members[u].pending.map((s) => ({ songKey: s.songKey, songLink: s.songLink != null ? s.songLink : null, at: 0 })),"]],
    "check-room-compat", "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // a pending song's field added, unacknowledged
  // ── (c) the page lists each player file ──
  ["PF1", [[PAGE, "<script src=\"ui/youtube.js?v=", "<script src=\"ui/youtube-gone.js?v="]],
    "check-player-plug", "A2 — THE PAGE LISTS EVERY ROW'S PLAYER FILE", "RED"],   // a row's line missing
  // PF2 and PF4 re-anchored at `ddjp_709`: `tests/_sc-player.js` is no player file now (SoundCloud's widget's stand-in), so a
  // player line no row names is SoundCloud's own file once its row names another; and SoundCloud's line follows YouTube's.
  ["PF2", [["core/songs.js", "      player: \"ui/soundcloud.js\",", "      player: \"ui/soundcloud-gone.js\","]],
    "check-player-plug", "A2 — AND NO PLAYER FILE NO ROW NAMES", "RED"],   // a player line no row names, left over
  ["PF3", [[PAGE, "<script src=\"ui/songplayer.js?v=", "<script src=\"ui/base.js?v=1\"></script>\n<script src=\"ui/songplayer.js?v="]],
    "check-player-plug", "A3 — the page loads the table and the plug FIRST", "RED"],   // the plug no longer where the page asked first
  ["PF4", [[PAGE, "<script src=\"ui/songplayer.js?v=", "<script src=\"ui/youtube.js?v=" + V + "\"></script>\n<script src=\"ui/songplayer.js?v="],
           [PAGE, "\n<script src=\"ui/youtube.js?v=" + V + "\"></script>\n<script src=\"ui/soundcloud.js?v=", "\n<script src=\"ui/soundcloud.js?v="]],
    "check-player-plug", "A2 — THE LINES FOLLOW THE PLUG'S, IN THE TABLE'S ORDER", "RED"],   // the player's line before the plug's
  // ── (d) the last of the old data ──
  ["OD1", [[UQ, "      } else if (saved) {\n        try { Store.noteOldSongs(\"My queue\"); } catch (e) {}\n      }",
            "      } else if (saved && Array.isArray(saved.stack)) {\n        intent = _songsOnly(saved.stack).map(s => ({ eid: _eid(), songKey: s.songKey, url: s.url, title: s.title || Songs.shownAs(s.songKey) }));\n        active = !!saved.active; _notify();\n      }"]],
    "check-song-services", "D6 — A MY QUEUE SAVED AS `{ stack }` IS NOT READ", "RED"],   // the `{ stack }` reading back (without the log line)
  ["OD2", [[STORE, "        return IDB.get(\"kv\", IDB.keyFor({ room: spaceId }, \"queue\", \"stack\")).then((v) => (v != null ? v : null)).catch(() => null);",
            "        return IDB.get(\"kv\", IDB.keyFor({ room: spaceId }, \"queue\", \"stack\")).then((v) => (v != null ? v : _fallbackLoad(\"uq_\" + spaceId))).catch(() => null);"]],
    "check-store", "B: WITH INDEXEDDB UP, MY QUEUE'S OLD localStorage LIST IS NOT READ THROUGH", "RED"],   // the read-through back
  ["OD3", [[HIST, "    const _kept = _rows.filter((r) => Object.prototype.hasOwnProperty.call(r, \"songKey\"));", "    const _kept = _rows;"]],
    "check-song-services", "D7 — A SONG HISTORY ROW SAVED UNDER THE OLD FIELD NAME IS SKIPPED", "RED"],   // an old history row kept, half-read
  ["OD4", [[CP, "    _state.playerHidden = (_state.playerHidden === true);", "    _state.playerHidden = (_state.playerHidden === true || _state[\"video\" + \"Hidden\"] === true);"]],
    "check-song-services", "D8 — AN OLD `videoHidden` IS NOT READ", "RED"],   // the old preference carried over
  // ── CONTROLS: nothing that matters changes ──
  ["SG1", [[QUI, "placeholder: \"Paste a song link…\" });", "placeholder: \"Paste a song link…\" });   // it said \"Paste a YouTube link…\" before `ddjp_707`"]],
    SW, "", "GREEN"],   // a comment naming YouTube is no name and no word
  ["SG2", [[CP, "  function playerHidden()    { return _st().playerHidden === true; }", "  function playerHidden()    { return (_st().playerHidden === true); }"]],
    SW, "", "GREEN"],
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
      const h = J.open("mutate-j29-words:" + id, file);   // journalled BEFORE the write
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
