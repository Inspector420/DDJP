// tools/probes/mutate-j152-clock-end.js
// SUBJECT: J152 at `ddjp_711` — songs end by the room's clock: the agreed length's one rule and its pure tie, the wait and the
// clock end (`backends/backend1/statederiver.js`), the fold's order (`backends/backend1/streammanager.js`), every screen's clock
// end, wake-up, armed end, early-or-normal answer and length retry (`features/playback.js`), the bot's end
// (`backends/backend2/runner.js`), and the device's one reload and 10 s check (`ui/player.js`) — `check-agreed-length`,
// `check-clock-end`, `check-playback-end`, `check-end-of-song`, `check-bot-songs`, `check-player-trail`, `check-sc-frames`. The
// owner's words: "then maybe the room cna be in perfect sync using clock time only and declared lenghts only to know what to do
// in a pure form with the player unable to alter logic". One row per thing the job does, each naming the failure it must
// cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j151-soundcloud.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j152-clock-end.js            every row
//   node tools/probes/mutate-j152-clock-end.js LR1 CE2    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js";
const SM = "backends/backend1/streammanager.js";
const PB = "features/playback.js";
const RN = "backends/backend2/runner.js";
const PL = "ui/player.js";
const AL = "check-agreed-length", CE = "check-clock-end", PE = "check-playback-end", ES = "check-end-of-song", BS = "check-bot-songs",
  PT = "check-player-trail", SF = "check-sc-frames";
const ARM_CLEAR = "  function _armEnd(atOnce) {\n    if (_endTimer) { try { clearTimeout(_endTimer); } catch (e) {} _endTimer = null; }\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── The agreed length: one rule, the pure tie (decision 2) ──
  ["LR1", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4", "    return null;"]],
    AL, "A — 4 EVERY RANK TIED: THE STRONGEST RANK'S LONGEST TIED LENGTH", "RED"],   // 710's: a pure tie agrees nothing
  ["LR2", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4", "    return clamp(Math.min.apply(null, strongestTied));"]],
    AL, "A — 4 EVERY RANK TIED: THE STRONGEST RANK'S LONGEST TIED LENGTH", "RED"],   // the shortest tied length: a song cut short
  ["LR3", [[SD, "      if (strongestTied === null) strongestTied = ", "      strongestTied = "]],
    AL, "A — 4 EVERY RANK TIED: THE STRONGEST RANK'S LONGEST TIED LENGTH", "RED"],   // the weakest rank's tie settles it
  ["LR4", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4", "    return Math.max.apply(null, strongestTied);"]],
    AL, "A — 5 A PURE TIE IS CLAMPED TOO", "RED"],   // a pure tie escapes [minLen, maxLen]
  ["LR5", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4",
                "    return clamp(valid.filter((e) => e.tier === tiers[0])[0].sec);"]],
    AL, "in every one of the", "RED"],   // THE SHUFFLED ORDER: the first-listed declaration settles a pure tie
  ["LR6", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4", "    return null;"]],
    AL, "B — THE SAME MESSAGES IN ANY ORDER, ONE AGREED LENGTH", "RED"],   // through the door and the fold too
  ["SO1", [[SM, "    return events.slice().sort((a, b) => {", "    return events.slice(); (() => (a, b) => {"]],
    AL, "B — THE SAME VERDICT ON EVERY ADVANCE, EVERYWHERE", "RED"],   // THE SHUFFLED ORDER: the fold in arrival order forks the room
  // ── The wait: one number, read by the screens and the bot through `endsAt`, at 0 and at 3 s (decision 1) ──
  ["WT1", [[SD, "        endsAt: gateLen ? started + gateLen * 1000 + END_WAIT_MS : null,", "        endsAt: gateLen ? started + gateLen * 1000 : null,"]],
    CE, "A — AT A WAIT OF 3 s THE FOLD'S CLOCK END IS THE AGREED LENGTH PLUS IT", "RED"],   // the wait left out of the end
  ["WT2", [[PB, "    const endsAt = (adv && typeof adv.endsAt === \"number\") ? adv.endsAt : null;", "    const endsAt = (adv && typeof adv.endsAt === \"number\") ? adv.endsAt + 3000 : null;"]],
    CE, "A — AT A WAIT OF 0 s A SCREEN SENDS NOTHING A MILLISECOND BEFORE THE CLOCK END, AND THE ADVANCE AT IT", "RED"],   // a screen adds a wait of its own
  ["WT3", [[RN, "    if (typeof a.endsAt === \"number\") return { p: np.pi, key: np.pi, at: a.endsAt };",
                "    if (typeof a.gateLenSec === \"number\" && a.gateLenSec > 0) return { p: np.pi, key: np.pi, at: np.startedAt + a.gateLenSec * 1000 };"]],
    BS, "A2: WITH THE ROOM'S ONE WAIT AT 3 s THE RUNNER ENDS THE SONG AT THE AGREED LENGTH PLUS IT", "RED"],   // 710's runner: its own end, no wait
  ["WT4", [[RN, "    if (typeof a.endsAt === \"number\") return { p: np.pi, key: np.pi, at: a.endsAt };",
                "    if (typeof a.gateLenSec === \"number\" && a.gateLenSec > 0) return { p: np.pi, key: np.pi, at: np.startedAt + a.gateLenSec * 1000 };"]],
    CE, "A — THE SCREENS AND THE BOT READ THE ONE END", "RED"],   // the same, seen in the source
  // ── The clock end, and no private length (decision 2, the safety net replaced) ──
  ["CE1", [[PB, "    if (endsAt !== null && _nowMs() >= endsAt) {",
                "    if (knownDuration[np.song.songKey] && _nowMs() - np.startedAt >= knownDuration[np.song.songKey] * 1000) { _maybeAdvance(np.pi, false); return; }\n    if (endsAt !== null && _nowMs() >= endsAt) {"]],
    CE, "E — WITH NO AGREED LENGTH, THIS DEVICE'S OWN 200 s ENDS NOTHING", "RED"],   // 710's safety net back
  ["CE2", [[PB, "    if (endsAt !== null && _nowMs() >= endsAt) {",
                "    if (knownDuration[np.song.songKey] && _nowMs() - np.startedAt >= knownDuration[np.song.songKey] * 1000) { _maybeAdvance(np.pi, false); return; }\n    if (endsAt !== null && _nowMs() >= endsAt) {"]],
    PE, "a device's own measured length must end no song", "RED"],   // the same, in the playback-end guard
  ["CE3", [[PB, "    if (endsAt !== null && _nowMs() >= endsAt) {", "    if (false) {"]],
    CE, "A — AT A WAIT OF 0 s A SCREEN SENDS NOTHING A MILLISECOND BEFORE THE CLOCK END, AND THE ADVANCE AT IT", "RED"],   // no clock end
  // ── A player's end is a wake-up, never the decision (decision 3) ──
  ["WK1", [[PB, "    _tick();       // THE WAKE-UP: the clock decides\n", "    _maybeAdvance(np.pi, true);\n    _tick();       // THE WAKE-UP: the clock decides\n"]],
    CE, "B — AN EARLY END (150 s of 200) IS RELOADED ONCE", "RED"],   // 710's: the player's end advances the room
  ["WK2", [[PB, "    _tick();       // THE WAKE-UP: the clock decides\n", ""]],
    CE, "B — THE WAKE-UP", "RED"],   // an end after the clock end sends nothing with the tick held back
  ["WK3", [[PB, "    StreamManager.on(\"*\", arm); _subs.push([\"*\", arm]);\n", ""]],
    CE, "C PREMISE — Playback hears every arriving message", "RED"],   // nothing arms the end: a background tab waits
  ["WK4", [[PB, "    if (wait <= 0) { if (atOnce !== false) _tick(); return; }", "    if (wait <= 0) return;"]],
    CE, "C — A MESSAGE AFTER THE CLOCK END RUNS THE CLOCK CHECK AT ONCE", "RED"],   // a due end waits for the tick
  ["WK5", [[PB, ARM_CLEAR, "  function _armEnd(atOnce) {\n"]],
    CE, "C — A CHANGED AGREED LENGTH RE-ARMS IT", "RED"],   // the old timer left beside the new one
  // ── Early or normal; one reload, then the hold (decision 4) ──
  ["EN1", [[PB, "    const margin = Math.max(grace, EARLY_MARGIN_MS);", "    const margin = grace;"]],
    CE, "D — AT THE ROOM'S DEFAULT graceMs (1 s) THE MARGIN IS 2 s", "RED"],   // the 2 s floor gone
  ["EN2", [[PB, "    const margin = Math.max(grace, EARLY_MARGIN_MS);", "    const margin = EARLY_MARGIN_MS;"]],
    CE, "D — WITH graceMs AT 5 s THE MARGIN IS 5 s", "RED"],   // the room's graceMs ignored
  ["EN3", [[PB, "    if (_isEarly(np, s.advance) && _reloadedPi !== np.pi) {", "    if (_isEarly(np, s.advance)) {"]],
    CE, "B — AN EARLY END (150 s of 200) IS RELOADED ONCE, A SECOND EARLY END IN THE SAME PLAY HOLDS", "RED"],   // reloaded for ever
  ["EN4", [[PB, "    if (_isEarly(np, s.advance) && _reloadedPi !== np.pi) {", "    if (_isEarly(np, s.advance)) {"]],
    PT, "C2: A SECOND EARLY END IN THE SAME PLAY HOLDS", "RED"],   // the same, through the room's player
  ["EN5", [[PB, "      _endedPi = np.pi;\n", ""]],
    ES, "A: the push made at the moment of ENDED says so", "RED"],   // a normal end not held
  ["EN6", [[PL, "      if (verdict === \"reload\") _reloadAtRoomPoint(endedId, endedPi);\n", "      if (false) _reloadAtRoomPoint(endedId, endedPi);\n"]],
    PT, "C1: AN EARLY END IS LOADED ONCE MORE AT THE ROOM'S POINT", "RED"],   // 710's: an early end sits silent
  ["EN7", [[PL, "      if (verdict === \"reload\") _reloadAtRoomPoint(endedId, endedPi);\n", "      if (false) _reloadAtRoomPoint(endedId, endedPi);\n"]],
    SF, "E — A SOUNDCLOUD SONG THAT FINISHES EARLY (50 s into 200) IS LOADED ONCE MORE, IN THE SAME FRAME", "RED"],   // SoundCloud's too (its frame reused, `ddjp_714`)
  ["EN8", [[PL, "    loadSong(np.song.songKey, np.startedAt, () => Playback.elapsedSec(np), np.pi || null, \"ended-early\");",
                "    loadSong(np.song.songKey, np.startedAt, () => 0, np.pi || null, \"ended-early\");"]],
    PT, "C1: AN EARLY END IS LOADED ONCE MORE AT THE ROOM'S POINT", "RED"],   // reloaded from the start, not the room's point
  ["EN9", [["ui/songplayer.js", "            if (!(cap > 0) || at <= cap - 1) {", "            if (true) {"]],   // the cap, the plug's check's since `ddjp_714`
    PT, "C3: THE 10 s CHECK NEVER SEEKS PAST THE PLAYER'S OWN LENGTH LESS 1 s", "RED"],   // the parked seek every 2 s back
  // ── The length, declared again while the room has none ──
  ["LN1", [[PB, "    if (!adv || typeof adv.gateLenSec !== \"number\") _retryLength(np);\n", ""]],
    CE, "E — WHILE THE ROOM HAS NO LENGTH THE DEVICE DECLARES ITS OWN AGAIN", "RED"],   // a refused reading never retried
  ["LN2", [[PB, " && now - _lenRetry.at < LEN_RETRY_MS) return;", " && false) return;"]],
    CE, "E — WHILE THE ROOM HAS NO LENGTH THE DEVICE DECLARES ITS OWN AGAIN, at most every 5 s", "RED"],   // retried on every tick
  // ── CONTROLS: nothing that matters changes ──
  ["CG1", [[PB, "    _tick();       // THE WAKE-UP: the clock decides", "    _tick();       // THE WAKE-UP: the clock, not the player, decides"]],
    CE, "", "GREEN"],   // a comment reworded
  ["CG2", [[SD, "    return clamp(Math.max.apply(null, strongestTied));   // every tier tied: rule 4",
                "    return clamp(Math.max.apply(null, strongestTied));   // rule 4: every tier tied"]],
    AL, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j152-clock-end:" + id, file);   // journalled BEFORE the write
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
