// tools/probes/mutate-j131-history-skip.js
// SUBJECT: J131's correction (`ddjp_663`) — History marks the song a skip CUT SHORT, and says which kind (the owner's
// decisions, `main/04-features.md` §Room History): `backends/backend1/statederiver.js` (the fold records, by play, how each
// playing it saw end was ended — "dj", "media" or not cut short — above the next-song resolution, bounded, in no seed; the
// now-playing's start mark gone from the seed), `backends/backend1/history.js` (written onto the row on every path, kept
// through a rewrite that cannot see the ending, corrected by a fold that can), `ui/panels.js` (the one table of words,
// "skipped" and "Sys Skip", the teal, and History's record stating them). Held by `check-history-skip`, `check-list-look` B,
// `check-queue-redraw` A (a past row cut short is drawn) and `check-room-compat` (the seed's now-playing is a surface).
// One row per way it could go wrong, each naming the failure it must cause.
// RE-ANCHORED ON PURPOSE at `ddjp_667` (History's row on a phone, `check-list-look` F): the room's word is "Sys Skip" (WORDS,
// and HS10's and HS11's failures, which name it), and the word is put on the line by its own statement now (SHOWN; HS12) —
// the counts left the line for a spot of their own. What each row breaks, and the failure it names, are as they were.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j131-moves-look`: every edit is recorded on disk before it
// is made and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, or the row is VOID. Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j131-history-skip.js            every row
//   node tools/probes/mutate-j131-history-skip.js HS3 HS12   named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js", HI = "backends/backend1/history.js", PN = "ui/panels.js";
const HS = "check-history-skip", LL = "check-list-look", QR_ = "check-queue-redraw", RC = "check-room-compat";
const REC = `        if (nowPlaying && nowPlaying.pi) _noteEnded(nowPlaying.pi, manualSkip ? "dj" : (isSkip ? "media" : false));\n`;
const KIND = `manualSkip ? "dj" : (isSkip ? "media" : false)`;
const PUSH = `        pushHistory(nowPlaying);   // a song actually started → it played (Room History)\n`;
const HEAD = `        if (!head) { nowPlaying = null; continue; }\n`;
const WORDS = `const CUT_SHORT_WORDS = { dj: "skipped", media: "Sys Skip" };`;
const SHOWN = `sub.appendChild(H.el("span", { class: "hist-skip", text: cut })); }`;
const VERIFY = `_mergeIn(produced.filter((r) => r.src !== "floor"), null, true, sr.ended); _mergeIn(produced.filter((r) => r.src === "floor"), null, false, sr.ended);`;
const REBUILD = `_mergeIn(rows.filter((r) => r.src !== "floor"), null, true, sr.ended); _mergeIn(rows.filter((r) => r.src === "floor"), null, false, sr.ended);`;
const PICK = `const v = (ended && Object.prototype.hasOwnProperty.call(ended, e.pi)) ? ended[e.pi] : (e.cutShortBy !== undefined ? e.cutShortBy : _hadEnd[e.pi]);`;
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE RIGHT SONG: the fold ──
  ["HS1", [[SD, REC, ""], [SD, PUSH, PUSH + `        _noteEnded(nowPlaying.pi, ${KIND});\n`]],
    HS, "A: A PERSON'S SKIP MARKS THE SONG IT CUT SHORT", "RED"],   // recorded on the song the skip STARTED: 662's defect, by play
  ["HS2", [[SD, REC, ""], [SD, HEAD, HEAD + REC]],
    HS, "A: THE LAST SONG BEFORE AN EMPTY ROOM IS MARKED", "RED"],   // below the next-song resolution: the empty room is missed
  ["HS3", [[SD, "pi: np.pi });   // how it ENDS: `cutShortBy`", "pi: np.pi, skipped: true });"]],
    HS, "A: NO ROW CARRIES THE MARK OF HOW IT STARTED", "RED"],   // the start mark copied back onto the row
  ["HS4", [[SD, "      if (_endedCount > HISTORY_MAX) {", "      if (false && _endedCount > HISTORY_MAX) {"]],
    HS, "B: THE RECORD IS BOUNDED AS THE FOLD'S HISTORY IS", "RED"],   // unbounded
  ["HS5", [[SD, "      tick: tick,\n", "      tick: tick,\n      cutShortBy: Object.assign({}, cutShortBy),\n"]],
    HS, "B: THE RECORD IS OUTSIDE THE SAVE POINT", "RED"],   // sealed into every save point
  ["HS6", [[SD, "        dj: nowPlaying.dj, pi: nowPlaying.pi, startedAt: nowPlaying.startedAt,\n", "        dj: nowPlaying.dj, pi: nowPlaying.pi, startedAt: nowPlaying.startedAt, skipped: false,\n"]],
    RC, "nowPlayingShape: +skipped", "RED"],   // a field back in the seed's now-playing: every save point re-fingerprinted, announced
  // ── WHICH KIND: "Sys Skip" for the room's skip, "skipped" for a person's and the bot's ──
  ["HS7", [[SD, KIND, `isSkip ? "dj" : false`]],
    HS, "A: THE ROOM'S SKIP OF A SONG THAT COULD NOT PLAY MARKS THAT SONG (B) AS ITS OWN KIND", "RED"],   // the room's skip is a person's
  ["HS8", [[SD, KIND, `manualSkip ? "media" : (isSkip ? "media" : false)`]],
    HS, "A: A PERSON'S SKIP MARKS THE SONG IT CUT SHORT", "RED"],   // a person's skip is the room's
  ["HS9", [[SD, KIND, `manualSkip ? (isSkipReason(c.k) ? "media" : "dj") : (isSkip ? "media" : false)`]],
    HS, "A: THE BOT'S REPEAT SKIP MARKS THE SONG IT ENDED (D)", "RED"],   // the bot's repeat skip labelled apart
  ["HS10", [[PN, WORDS, `const CUT_SHORT_WORDS = { dj: "skipped", media: "skipped" };`]],
    HS, "E: THE ROOM'S SKIP SHOWS \"Sys Skip\" (B)", "RED"],   // the word gone
  ["HS11", [[PN, WORDS, `const CUT_SHORT_WORDS = { dj: "skipped", media: "skipped" };`]],
    LL, "B: \"SKIPPED\" (\"SYS SKIP\" FOR THE ROOM'S SKIP) IS ITS OWN ELEMENT", "RED"],   // the same, on the look's own fixture
  ["HS12", [[PN, SHOWN, `const s = H.el("span", { class: "hist-skip", text: cut }); if (cut !== "skipped") s.style.color = "#888"; sub.appendChild(s); }`]],
    LL, "B: \"SKIPPED\" IS THE MODERATION COLOUR", "RED"],   // "Sys Skip" not teal
  ["HS13", [[PN, "      const cut = cutShortWord(h);", "      const cut = h.skipped ? \"skipped\" : \"\";"]],
    HS, "E: EVERY ROW SHOWS EXACTLY ITS OWN WORD", "RED"],   // the screen reads the start mark
  // HS14 RE-ANCHORED ON PURPOSE at `ddjp_677`: the record's line ends in the counts as shown (`shownCounts`); what it breaks is as it was.
  ["HS14", [[PN, "h.at, cutShortWord(h), shownCounts(c)];", "h.at, !!h.cutShortBy, shownCounts(c)];"]],
    HS, "E: HISTORY'S RECORD STATES EACH ROW'S WORD AS DISPLAYED", "RED"],   // the record states a flag, not the words
  ["HS15", [[PN, WORDS, `const CUT_SHORT_WORDS = { dj: "skipped" };`]],
    QR_, "a past row cut short: the change is drawn", "RED"],   // the room's skip drawn as nothing: a past row's change not redrawn
  // ── THE ROW, ON EVERY PATH: History ──
  ["HS16", [[HI, "_mergeIn(folded, _finals, true, both && both.state ? both.state.cutShortBy : null);", "_mergeIn(folded, _finals, true, null);"]],
    HS, "D: A FOLD MARKS EACH ROW BY HOW ITS SONG ENDED", "RED"],   // a fold's record never reaches History
  ["HS17", [[HI, ": (e.cutShortBy !== undefined ? e.cutShortBy : _hadEnd[e.pi]);", ": e.cutShortBy;"]],
    HS, "D: A REWRITE THAT CANNOT SEE THE ENDING KEEPS THE MARK", "RED"],   // a rewrite drops it
  ["HS18", [[HI, PICK, `const v = (e.cutShortBy !== undefined) ? e.cutShortBy : ((ended && Object.prototype.hasOwnProperty.call(ended, e.pi)) ? ended[e.pi] : _hadEnd[e.pi]);`]],
    HS, "D: A LATER FOLD THAT SETTLES THE RACE THE OTHER WAY CORRECTS THE MARK HISTORY HELD", "RED"],   // a held mark outranks a fresh one
  ["HS19", [[HI, VERIFY, `_mergeIn(produced.filter((r) => r.src !== "floor"), null, true); _mergeIn(produced.filter((r) => r.src === "floor"), null, false);`]],
    HS, "D: VERIFY MARKS EVERY ROW", "RED"],   // verify writes no mark
  ["HS20", [[HI, "ended: st.cutShortBy || null };", "ended: null };"]],
    HS, "D: THE FLOOR-ANCHORED TRUTH MARKS B ACROSS ITS SAVE POINT", "RED"],   // a stretch reports no endings
  ["HS21", [[HI, "      if (r.ended) Object.assign(ended, r.ended);   // a song is seen to end in the stretch after the save point it spans\n", ""]],
    HS, "D: THE FLOOR-ANCHORED TRUTH MARKS B ACROSS ITS SAVE POINT", "RED"],   // the truth drops the endings
  ["HS22", [[HI, REBUILD, `_mergeIn(rows.filter((r) => r.src !== "floor"), null, true); _mergeIn(rows.filter((r) => r.src === "floor"), null, false);`]],
    HS, "D: THE CACHE REBUILD MARKS EVERY ROW", "RED"],   // the cache rebuild writes no mark
  // ── ORDER-INDEPENDENT ──
  ["HS23", [[HI, "let list = Array.isArray(events) ? events.slice().sort(_roomOrder) : [];", "let list = Array.isArray(events) ? events.slice() : [];"]],
    HS, "C: HISTORY FED IN ANY ORDER MARKS THE SAME ROWS", "RED"],   // History folds in arrival order
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
      const h = J.open("mutate-j131-history-skip:" + id, file);   // journalled BEFORE the write
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
