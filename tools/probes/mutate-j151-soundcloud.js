// tools/probes/mutate-j151-soundcloud.js
// SUBJECT: J151 — SoundCloud, the second song service (`ddjp_709`): its row in the song table (`core/songs.js`), its player
// file (`ui/soundcloud.js`), its hosts and its line in the page (`index.html`), the plug hiding every other player as a box
// switches (`ui/songplayer.js`), the refusals' words through both add boxes (`features/userqueue.js`, `features/playlists.js`)
// and the light ♪ box keyed on a song row's service (`ui/playlists.js`, `index.html`) — `check-player-plug`,
// `check-song-services`, `check-sc-placeholder`, `check-room-compat`. One row per thing the package built, each naming the
// failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j29-songs.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
// RE-ANCHORED AT `ddjp_710` (one fresh frame per song): SP3, SP11–SP13 on the rewritten lines; SP14 on what now keeps one wait
// for the script (every load removes the frame before, its wait with it); SP2's and SP6's names as their checks now read them;
// SP10 (the next song the widget's own `load`) gone — the owner's rule reverses it, and its inverse is a row of
// `mutate-j151-sc-frames.js`.
//
//   node tools/probes/mutate-j151-soundcloud.js            every row
//   node tools/probes/mutate-j151-soundcloud.js SC1 SP4    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PAGE = "index.html";
const SONGS = "core/songs.js";
const SCP = "ui/soundcloud.js";
const PLUG = "ui/songplayer.js";
const PL = "ui/playlists.js";
const UQ = "features/userqueue.js";
const FPL = "features/playlists.js";
const PP = "check-player-plug", SS = "check-song-services", PH = "check-sc-placeholder", RC = "check-room-compat";
const V = ((fs.readFileSync(path.join(ROOT, PAGE), "utf8").match(/<script src="ui\/songplayer\.js\?v=(\d+)"/) || [])[1]) || "?";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: SoundCloud's row, its hosts and its line (the four things) ──
  ["SC1", [[SONGS, "      player: \"ui/soundcloud.js\",", "      player: null,"]],
    PP, "A4 — SOUNDCLOUD IS A ROW OF THE TABLE", "RED"],   // the row names no player file
  ["SC2", [[SONGS, "script: [\"https://w.soundcloud.com\", \"https://soundcloud.com\"] },", "script: [\"https://w.soundcloud.com\"] },"]],
    PP, "A4 — ITS HOSTS", "RED"],   // the title's host dropped from the row
  ["SC3", [[PAGE, " https://www.youtube-nocookie.com https://w.soundcloud.com;", " https://www.youtube-nocookie.com;"]],
    PP, "A1 — EVERY HOST A ROW NAMES IS ALLOWED BY THE PAGE", "RED"],   // the widget's frame not allowed by the page
  ["SC4", [[PAGE, "<script src=\"ui/youtube.js?v=" + V + "\"></script>\n<script src=\"ui/soundcloud.js?v=" + V + "\"></script>",
                   "<script src=\"ui/soundcloud.js?v=" + V + "\"></script>\n<script src=\"ui/youtube.js?v=" + V + "\"></script>"]],
    PP, "A4 — ITS LINE in the page, right after YouTube's", "RED"],   // its line before YouTube's
  // ── JOB 1: the link forms and the refusals (decisions 3 and 5) ──
  ["SC5", [[SONGS, "const SC_HOSTS = [\"soundcloud.com\", \"www.soundcloud.com\", \"m.soundcloud.com\"];", "const SC_HOSTS = [\"soundcloud.com\", \"m.soundcloud.com\"];"]],
    SS, "F1 — SOUNDCLOUD'S FULL, `www.` AND `m.` LINKS", "RED"],   // `www.` links not read
  ["SC6", [[SONGS, "        if (SC_HOSTS.indexOf(u.hostname) < 0) return null;", "        if (SC_HOSTS.indexOf(u.hostname) < 0 || u.search) return null;"]],
    SS, "F1 — SOUNDCLOUD'S FULL, `www.` AND `m.` LINKS", "RED"],   // `?si=` not ignored
  ["SC7", [[SONGS, "Short SoundCloud links can't be read \\u2014 open it and copy the full link", "Short SoundCloud links can't be read"]],
    SS, "F2 — REFUSED BY NAME, WITH THE WORDS ON SCREEN", "RED"],   // the short link's words changed
  ["SC8", [[SONGS, " === \"sets\") return { code: \"playlist-link\",", " === \"sets-gone\") return { code: \"playlist-link\","]],
    SS, "F2 — REFUSED BY NAME, WITH THE WORDS ON SCREEN", "RED"],   // a set refused as "not a song link"
  ["SC9", [[SONGS, "  const KEY_MAX = 64;", "  const KEY_MAX = 65;"]],
    SS, "F3 — THE LONGEST KEY IS THE ROOM'S", "RED"],   // the limit no longer the room's
  ["SC10", [[UQ, "    if (!id) { const why = Songs.readLink(url); return { ok: false, code: why.code || \"bad-link\", reason: why.reason || \"not a song link\" }; }",
                 "    if (!id) { return { ok: false, code: \"bad-link\", reason: \"not a song link\" }; }"]],
    SS, "F4 — MY QUEUE'S ADD BOX REFUSES EACH", "RED"],   // My queue's box loses the words
  ["SC11", [[FPL, "      return { ok: false, code: why.code || \"bad-link\", reason: why.reason || \"not a song link\" };",
                  "      void why; return { ok: false, code: \"bad-link\", reason: \"not a song link\" };"]],
    SS, "F4 — A PLAYLIST'S ADD BOX REFUSES EACH", "RED"],   // a playlist's box loses the words
  ["SC12", [[SONGS, "  const SC_ID = /^[a-z0-9_-]+\\/[a-z0-9_-]+$/;", "  const SC_ID = /^[A-Za-z0-9_-]+\\/[A-Za-z0-9_-]+$/;"]],
    RC, "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // the form of a SoundCloud song's name moved, unacknowledged
  // ── JOB 2: SoundCloud's player file ──
  ["SP1", [[SCP, "show_artwork: true, visual: true,", "show_artwork: true, visual: false,"]],
    PP, "B2 — SOUNDCLOUD'S WIDGET AND ITS LOOK", "RED"],   // the big-artwork player off (decision 1)
  ["SP2", [[SCP, "      el.setAttribute(\"allow\", \"autoplay\");\n", ""]],
    PP, "B2 — SOUNDCLOUD'S OWN ELEMENT: an iframe, allowed to autoplay", "RED"],   // the frame may not autoplay
  ["SP3", [[SCP, "      on(\"PLAY\", () => {\n", "      on(\"PLAY\", () => {\n        if (typeof cb.state === \"function\") cb.state(\"playing\");\n"]],
    PP, "B6 — SoundCloud's player does not report PLAYING until its copy is refreshed", "RED"],   // playing before the copy holds the song
  ["SP4", [[SCP, "      time() { return copy.ms / 1000; },", "      time() { return copy.ms; },"]],
    PP, "B7 — SoundCloud's readings answer AT ONCE, from its copy, in seconds", "RED"],   // a reading in the widget's unit
  ["SP5", [[SCP, "      startPoll();\n", ""]],
    PP, "B8 — HOW FRESH", "RED"],   // the copy's poll never started
  ["SP6", [[SCP, "cb.failed(\"unavailable\", \"SoundCloud gave no code\")", "cb.failed(\"player-failed\", \"SoundCloud gave no code\")"]],
    PP, "B6 — SoundCloud reports its error — which has NO CODE — as the app's reason `unavailable`", "RED"],   // its error not the app's `unavailable`
  ["SP7", [[SCP, "      mute() { copy.muted = true; _applyVolume(); },", "      mute() { copy.muted = true; },"]],
    PP, "B5 — SoundCloud's MUTE is volume 0", "RED"],   // mute reaches no widget
  ["SP8", [[SCP, "        copy.lengthMs = playableMs(sound, dur);", "        copy.lengthMs = dur;"]],
    PP, "B7 — A SNIPPET'S LENGTH IS WHAT SOUNDCLOUD SAYS IT CAN PLAY", "RED"],   // the snippet's length not read (decision 4)
  ["SP9", [[SCP, "Math.round(startSec * 1000) : null;", "Math.round(startSec) : null;"]],
    PP, "C — joined late, it starts at the room's point, in milliseconds", "RED"],   // the room's point in seconds, not ms
  ["SP11", [[SCP, "          if (w && copy.ready) w.play();", "          if (w && copy.ready) (w.start || w.play)();"]],
    PP, "B — SOUNDCLOUD'S FILE ASKS ITS WIDGET FOR NOTHING THE WIDGET'S DOCS DO NOT LIST", "RED"],   // an undocumented call
  ["SP12", [[SCP, "      try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}\n", ""]],
    PP, "B10 — and its events are unbound and its iframe taken out of the box", "RED"],   // destroyed, its frame left behind
  ["SP13", [[SCP, "      shown() { return visible; },", "      shown() { return true; },"]],
    PP, "C — THE ROOM'S FIRST SONG IS SOUNDCLOUD'S", "RED"],   // says it shows while its frame is still hidden: the first song unseen
  ["SP14", [[SCP, "      gen++;\n      if (retry) { clearTimeout(retry); retry = null; }\n", "      gen++;\n"]],   // re-anchored at `ddjp_714` (`stop()` clears it too)
    PP, "B2 — BEFORE SOUNDCLOUD'S SCRIPT IS UP, ITS SONGS WAIT ONCE", "RED"],   // a wait for each song asked before the script came
  // ── decision 9: each box switches by itself (the plug's change) ──
  ["PG1", [[PLUG, "          if (s === p.service) continue;\n", "          if (s === p.service || s !== showing) continue;\n"]],   // re-anchored at `ddjp_714` (the loop grew the mute)
    PP, "C — THE ROOM'S FIRST SONG IS SOUNDCLOUD'S", "RED"],   // 708's plug: a first SoundCloud song beside YouTube's empty player
  ["PG2", [[PLUG, "try { if (s === showing) { handles[s].stop(); _exp(s).play = false; } handles[s].show(false); } catch (e) {}", "try { handles[s].show(false); } catch (e) {}"]],
    PP, "E1 — THE ROOM'S BOX GOES YOUTUBE → SOUNDCLOUD → YOUTUBE", "RED"],   // the player that showed is hidden but not stopped
  ["PG3", [[PLUG, "      const heard = () => showing === null || showing === short;", "      const heard = () => true;"]],
    PP, "C — THE BOX HEARS ONLY THE PLAYER IT SHOWS", "RED"],   // a stepped-aside player's late end and error reach the room
  // ── JOB 3: the light ♪ box (decision 2) ──
  ["PH1", [[PAGE, ".song-row .thumb-slot[data-service=\"sc\"] { background: #e9e9ee; }", ".song-row .thumb-slot[data-service=\"sc\"] { background: #f0f0f0; }"]],
    PH, "A — EVERY SOUNDCLOUD SONG'S SLOT IS THE LIGHT ♪ BOX", "RED"],   // another grey
  ["PH2", [[PAGE, "[data-service=\"sc\"]::before { color: #4a4a55; font-size: 16px; }", "[data-service=\"sc\"]::before { color: #4a4a55; }"]],
    PH, "A — EVERY SOUNDCLOUD SONG'S SLOT IS THE LIGHT ♪ BOX", "RED"],   // the ♪ at the dark box's 14 px
  ["PH3", [[PL, " if (svc) slot.dataset.service = svc; } catch (e) {}", " void svc; } catch (e) {}"]],
    PH, "A — EVERY SOUNDCLOUD SONG'S SLOT IS THE LIGHT ♪ BOX", "RED"],   // the slot no longer names its service
  ["PH4", [[PAGE, ".song-row .thumb-slot[data-service=\"sc\"] { background: #e9e9ee; }", ".song-row .thumb-slot[data-service] { background: #e9e9ee; }"]],
    PH, "A — A YOUTUBE SONG'S SLOT IS UNCHANGED", "RED"],   // every service's slot made light
  ["PH5", [[PL, "    slot.onclick = _openFromSlot;", "    if (!/^sc:/.test(songKey)) slot.onclick = _openFromSlot;"]],
    PH, "B — A SOUNDCLOUD SLOT IS STILL THE PREVIEW BUTTON", "RED"],   // a SoundCloud song cannot be previewed
  // ── CONTROLS: nothing that matters changes ──
  ["SG1", [[SCP, "  const POLL_MS = 250;                                   // the copy's poll", "  const POLL_MS = 250;   // the copy's poll (a comment, nothing else)"]],
    PP, "", "GREEN"],
  ["SG2", [[PAGE, "It is still the preview button. */", "It stays the preview button. */"]],
    PH, "", "GREEN"],   // the placeholder rule's comment reworded: the sheet's rules are read, not its comments
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
      const h = J.open("mutate-j151-soundcloud:" + id, file);   // journalled BEFORE the write
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
