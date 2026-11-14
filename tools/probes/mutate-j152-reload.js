// tools/probes/mutate-j152-reload.js
// SUBJECT: J152 at `ddjp_712` — ↻: a tap reloads the song, holding it rebuilds the whole player — the button's tap and hold
// (`ui/base.js` `holdButton`), the room's reload at the room's point and its rebuild (`ui/player.js`), the room's ↻
// (`ui/shell.js`), the preview's ↻ and its rebuild (`ui/playlists.js`) and the ring (`index.html`) — `check-reload-button`,
// `check-preview-controls`; and the owner's decision 2 (old versions are not supported): `Songs.shownAs`' and
// `features/medialength.js`' bare ids and `core/playlistdoc.js`' single-playlist file gone — `check-song-services`,
// `check-playlist-import`. The owner's words: "a simple click just reloads the song", "completly pusing it does the action upon
// the circle closing even if you dont lift click but waits for a lift to be pressed again", "lets do 1 second". One row per thing
// the job does, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j152-clock-end.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j152-reload.js            every row
//   node tools/probes/mutate-j152-reload.js RT1 PV2    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const BA = "ui/base.js";
const PL = "ui/player.js";
const SH = "ui/shell.js";
const PV = "ui/playlists.js";
const HT = "index.html";
const SO = "core/songs.js";
const ML = "features/medialength.js";
const PD = "core/playlistdoc.js";
const RB = "check-reload-button", PC = "check-preview-controls", SS = "check-song-services", PI = "check-playlist-import";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── The tap (D 1): at the room's point, on the lift ──
  ["RT1", [[PL, "    loadSong(np.song.songKey, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, \"reload-by-hand\");",
                "    player.load(np.song.songKey, 0);"]],
    RB, "A — A TAP LOADS THE SONG ONCE, AT THE ROOM'S POINT", "RED"],   // 711's tap: from 0, and a jump by the 10 s check
  ["RT2", [[BA, "      const tap = !press.fired;", "      const tap = !press.fired && Date.now() - press.at < 300;"]],
    RB, "B — LET GO BEFORE THE RING CLOSES, IT IS A TAP", "RED"],   // only a quick press a tap: let go at 0.5 s, nothing
  // ── The hold (D 2–4): fires at 1 s while held; the lift does nothing; the next press fresh ──
  ["RH1", [[BA, "        run(onHold);   // the ring closed: at once, while still held", "        /* waits for the lift */"],
           [BA, "      if (tap) run(onTap);   // let go before the ring closed; after it closed, the lift does nothing", "      if (tap) run(onTap); else run(onHold);"]],
    RB, "C — AT 1 s, STILL HELD, THE WHOLE PLAYER IS REBUILT", "RED"],   // the hold acts on the lift instead
  ["RH2", [[BA, "      if (tap) run(onTap);   // let go before the ring closed; after it closed, the lift does nothing", "      run(onTap);"]],
    RB, "C — AND THE LIFT DOES NOTHING", "RED"],   // the lift after a hold reloads too
  ["RH3", [[BA, "      const tap = !press.fired;\n      end();\n      if (tap) run(onTap);", "      const tap = !press.fired;\n      if (tap) { end(); run(onTap); }\n      if (tap) run(onTap);"]],
    RB, "D — THE NEXT PRESS STARTS FRESH", "RED"],   // a fired press never cleared: the next press is refused
  ["RH4", [[BA, "  const HOLD_MS = 1000;", "  const HOLD_MS = 2000;"]],
    RB, "THE HOLD IS ONE NAMED NUMBER, 1000 ms", "RED"],   // his "lets do 1 second"
  ["RH5", [[BA, "      btn.classList.remove(\"hold-done\");\n", ""]],
    RB, "C — the lift clears the ring and the tint", "RED"],   // the tint left on after the lift
  // ── The other ways in (D 5–7) ──
  ["RW1", [[BA, "    btn.addEventListener(\"pointercancel\", cancelled);       // the browser took the press (a scroll): nothing\n", ""]],
    RB, "F — A PRESS THE BROWSER CANCELS", "RED"],
  ["RW2", [[BA, "    btn.addEventListener(\"click\", (e) => { if (!press && !(e && e.detail > 0)) run(onTap); });     // Enter or Space: a tap\n", ""]],
    RB, "F — ENTER OR SPACE IS A TAP", "RED"],
  ["RW3", [[BA, "if (!press && !(e && e.detail > 0)) run(onTap);", "if (!press) run(onTap);"]],
    RB, "F — A POINTER'S TAP IS ONE RELOAD", "RED"],   // a pointer's own click a second tap
  ["RW4", [[BA, "    btn.addEventListener(\"contextmenu\", (e) => { if (e && e.preventDefault) e.preventDefault(); });   // no long-press menu",
                "    btn.addEventListener(\"contextmenu\", () => {});"]],
    RB, "F — THE LONG-PRESS MENU IS REFUSED", "RED"],
  ["RW5", [[BA, "      if (press || (e && typeof e.button === \"number\" && e.button !== 0)) return;", "      if (press) return;"]],
    RB, "F — ANOTHER BUTTON THAN THE MAIN ONE DOES NOTHING", "RED"],
  ["RW6", [[PL, "  function rebuildPlayer() {\n    const old = player;", "  function rebuildPlayer() {\n    if (!_currentSong) return;\n    const old = player;"]],
    RB, "F — AND A HOLD STILL REBUILDS THE EMPTY PLAYER", "RED"],   // nothing playing: no rebuild
  // ── The rebuild (D 3, 8): destroyed, emptied, made again, driven again, old events ignored, one line ──
  ["RB1", [[PL, "    try { if (old) old.destroy(); } catch (e) {}\n", ""]],
    RB, "C — AT 1 s, STILL HELD, THE WHOLE PLAYER IS REBUILT", "RED"],   // the old player not destroyed
  ["RB2", [[PL, "    try { if (refs.player) refs.player.replaceChildren(); } catch (e) {}\n", ""]],
    RB, "C — THE BOX WAS EMPTIED", "RED"],
  ["RB3", [[PL, "    if (_lastNp) _driveNowPlaying(_lastNp);\n    else updateSongTitle();", "    updateSongTitle();"]],
    RB, "C — THE NEW PLAYER LOADS THE ROOM'S SONG AT THE ROOM'S POINT", "RED"],   // the room's push not driven again
  ["RB4", [[PL, "    if (bp && player && bp !== player) return;   // from a player rebuilt away (`rebuildPlayer`)\n    const t = bp || player;", "    const t = bp || player;"]],
    RB, "E — AN END AND AN ERROR FROM A PLAYER REBUILT AWAY REACH NOTHING", "RED"],   // an old player's end heard
  ["RB5", [[PL, "    if (bp && player && bp !== player) return;   // from a player rebuilt away (`rebuildPlayer`)\n    let erroredId = null;", "    let erroredId = null;"]],
    RB, "E — AN END AND AN ERROR FROM A PLAYER REBUILT AWAY REACH NOTHING", "RED"],   // an old player's error heard
  ["RB6", [[PL, "    Logger.info(\"Player: rebuilt by hand\");", "    Logger.info(\"Player: rebuilt\");"]],
    RB, "C — one log line", "RED"],
  ["RB7", [[SH, "    H.holdButton(refs.resetBtn, () => Player.reloadCurrentSong(), () => Player.rebuildPlayer());", "    refs.resetBtn.onclick = () => { Player.reloadCurrentSong(); };"]],
    RB, "A PREMISE — the room's ↻ is drawn and is a hold button", "RED"],   // 711's ↻: a click only
  // ── The preview's ↻ (D 1, 3) ──
  ["PV1", [[PV, "    if (_pvPlayState(pv) === \"ended\" || (d > 0 && t >= d - 1)) return 0;\n", ""]],
    RB, "G — AFTER ITS END, A TAP PLAYS IT FROM 0", "RED"],
  ["PV2", [[PV, "          try { if (at > 0) bp.load(pv.songKey, at); else bp.play(); } catch (e) {}", "          try { bp.play(); } catch (e) {}"]],
    RB, "G — THE NEW PREVIEW PLAYER OPENS AT THE POINT THE OLD ONE WAS AT", "RED"],
  ["PV3", [[PV, "          if (pv !== _pv || pv.player !== bp) return;", "          if (pv !== _pv) return;"]],
    RB, "G — THE OLD PREVIEW PLAYER'S READY, ARRIVING LATE, DOES NOTHING", "RED"],
  ["PV4", [[PV, "    try { if (old) old.destroy(); } catch (e) {}\n", ""]],
    RB, "G — A HOLD REBUILDS THE PREVIEW'S OWN PLAYER", "RED"],
  ["PV5", [[PV, "    H.holdButton(pv.reloadBtn, () => _pvReload(pv), () => _pvRebuild(pv));", "    pv.reloadBtn.onclick = () => _pvReload(pv);"]],
    RB, "G PREMISE — the preview is open and its ↻ is a hold button", "RED"],
  ["PV6", [[PV, "    try { pv.player.load(pv.songKey, _pvPoint(pv)); } catch (e) { return; }", "    try { pv.player.load(pv.songKey, 0); } catch (e) { return; }"]],
    PC, "D: ↻ RELOADS THE SONG FROM WHERE IT WAS", "RED"],   // the preview's tap from 0 always
  // ── The ring and the words (D 2, 6, 9) ──
  ["RG1", [[HT, "background: conic-gradient(#5865F2 calc(var(--hold, 0) * 360deg), transparent 0);", "background: conic-gradient(#3a3 calc(var(--hold, 0) * 360deg), transparent 0);"]],
    RB, "H — in the app's blue", "RED"],
  ["RG2", [[HT, "inset: -4px; border-radius: 7px;", "inset: -2px; border-radius: 7px;"]],
    RB, "H — THE RING: out of the flow, 2 px thick, 2 px outside the button", "RED"],
  ["RG3", [[HT, ".hold-btn { position: relative; touch-action: manipulation;", ".hold-btn { position: relative; touch-action: none;"]],
    RB, "H — the button: the ring's frame, no selection, no long-press callout, a scroll still the browser's", "RED"],   // a scroll could not take the press
  ["RG4", [[BA, "  const RELOAD_TITLE = \"Tap: reload the song \\u00b7 Hold: rebuild the player\";", "  const RELOAD_TITLE = \"Reload this song\";"]],
    RB, "H — the room's ↻ says on hover", "RED"],
  // ── Decision 2: the old versions' leftovers gone ──
  ["DS1", [[SO, "    return p ? p.id : \"\";", "    return p ? p.id : ((typeof k === \"string\") ? k : \"\");"]],
    SS, "B — WHAT A PERSON READS FOR A SONG", "RED"],   // a room's bare id shown as it is again
  ["DS2", [[ML, "    // emit one report (reducer-inert)\n", "    if (!Songs.isKey(songKey)) return;\n    // emit one report (reducer-inert)\n"]],
    SS, "B6 — NO DOOR FOR A ROOM'S BARE ID ANY MORE", "RED"],   // MediaLength's door put back
  ["DS3", [[PD, "    serializeLibrary, validateLibrary,", "    serializeLibrary, validateLibrary, validateImport: () => ({ ok: true }),"]],
    PI, "THE SINGLE-PLAYLIST FILE'S READER AND WRITER ARE GONE", "RED"],
  ["DS4", [[PD, "    if (obj.app !== LIBRARY_APP)              return bad(\"not a ddjp file\");", "    if (obj.app !== LIBRARY_APP && obj.ddjp !== \"playlist\") return bad(\"not a ddjp file\");"]],
    PI, "A SINGLE-PLAYLIST FILE IS REFUSED", "RED"],   // the old file let past the first door
  // ── CONTROLS: nothing that matters changes ──
  ["CG1", [[BA, "        run(onHold);   // the ring closed: at once, while still held", "        run(onHold);   // at once, the ring closed, still held"]],
    RB, "", "GREEN"],   // a comment reworded
  ["CG2", [[PV, "  // ↻ TAPPED: the song loaded again at that point,", "  // ↻ TAPPED: at that point, the song loaded again,"]],
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
      const h = J.open("mutate-j152-reload:" + id, file);   // journalled BEFORE the write
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
