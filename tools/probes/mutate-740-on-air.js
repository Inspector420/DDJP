// tools/probes/mutate-740-on-air.js
// SUBJECT: package 740 — a vote, a save and the owner's count change count only for the song ON AIR where they land (the owner's;
// `consensus/consensus-models.md` §Counts + owner adjustment): the reducer's one predicate and its two refusals
// (`backends/backend1/statederiver.js`), the write side's question (`backends/backend1/streammanager.js` `reactionOnAir`,
// `features/reactions.js`), the bot room's silent drop (`backends/backend2/authority.js`), REP's paged path (`features/rep-rules.js`
// `onAirAmong`, the `_verdict` wires of `features/rep-reader.js` and `features/rep-bot.js`); and the history bot that corrects nothing
// after the fact and waits no song (`features/history-bot.js`). Held by `check-reaction-on-air`, `check-counts`, `check-history-tallies`
// and `check-history-bot` (its parts named per row: `HB_PARTS`). One row per way it could go wrong, each naming the failure it must
// cause (`check-break-verdict` asks the one rule). Retired 738 rows that targeted the corrections are in `mutate-history-bot`, with notes.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-history-bot`: every edit is recorded on disk before it is made and
// cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND when its result
// is read, or the row is VOID. Restored after every row and checked restored by hash. Run only in a fresh copy (HANDOVER §4).
//
//   node tools/probes/mutate-740-on-air.js            every row
//   node tools/probes/mutate-740-on-air.js OA1 OA9    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js", SM = "backends/backend1/streammanager.js", RX = "features/reactions.js";
const AU = "backends/backend2/authority.js", RR = "features/rep-rules.js", RD = "features/rep-reader.js", RB = "features/rep-bot.js";
const HB = "features/history-bot.js";
const OA = "check-reaction-on-air", CNT = "check-counts", TAL = "check-history-tallies", BOT = "check-history-bot";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", parts (check-history-bot's HB_PARTS)].
const ROWS = [
  // ── the room's rule ──
  ["OA1", [[SD, "        if (!reactionOnAir(nowPlaying, pi)) { _rej(ev, \"not-on-air\"); continue; }\n", ""]],
    OA, "A: A SONG THAT HAS ENDED", "RED"],                                     // a late vote or save counts again
  ["OA2", [[SD, "        if (!reactionOnAir(nowPlaying, vid)) { _rej(ev, \"not-on-air\"); continue; }\n", ""]],
    OA, "A: A SONG THAT HAS ENDED", "RED"],                                     // the owner's change on a past song lands
  ["OA3", [[SD, "        if (!piToVid[vid]) { _rej(ev, \"unknown-play-instance\"); continue; }\n", ""]],
    OA, "A: a playing the room never saw start", "RED"],                      // a count change naming no playing reads `not-on-air`
  ["OA4", [[SD, "    return typeof pi === \"string\" && pi !== \"\" && !!nowPlaying && nowPlaying.pi === pi;", "    return typeof pi === \"string\" && pi !== \"\";"]],
    OA, "A: A SONG THAT HAS ENDED", "RED"],                                     // the predicate loosened: any playing
  ["OA5", [[SD, "        if (!reactionOnAir(nowPlaying, pi)) { _rej(ev, \"not-on-air\"); continue; }\n", ""]],
    CNT, "740: a vote, a save and the owner's count change on a song that has ENDED count for nothing", "RED"],
  ["OA6", [[SD, "        if (!reactionOnAir(nowPlaying, pi)) { _rej(ev, \"not-on-air\"); continue; }\n", ""]],
    TAL, "G (740): A VOTE, A SAVE OR THE OWNER'S COUNT CHANGE LANDING AFTER THE SONG ENDED NEVER REACHES ITS ROW", "RED"],   // a late vote in the row's tally
  ["OA7", [[SD, "    \"not-on-air\":                   \"that song had already ended\",\n", ""]],
    OA, "A: `not-on-air` reads", "RED"],                                        // the refusal with no words
  // ── one rule, both sides ──
  ["OA8", [[SM, "    try { return StateDeriver.reactionOnAir((getState() || {}).nowPlaying || null, pi) === true; } catch (e) { return false; }", "    return typeof pi === \"string\";"]],
    OA, "B: `StreamManager.reactionOnAir(pi)` IS the reducer's predicate", "RED"],   // a second, looser rule at the interface
  ["OA9", [[RX, "    try { return typeof StreamManager.reactionOnAir === \"function\" && StreamManager.reactionOnAir(pi) === true; } catch (e) { return false; }", "    return true;"]],
    OA, "C: A SAVE CAPTURED ON A SONG THAT HAS SINCE ENDED IS NOT SENT", "RED"],      // the write side sends what the fold refuses
  // ── the bot room's judge ──
  ["OA10", [[AU, "    if (code === \"not-on-air\" && intent && (intent.t === \"ddjp.dj.vote\" || intent.t === \"ddjp.dj.save\")) return { ok: false, reason: \"that song had already ended\", code: code, silent: true };\n", ""]],
    OA, "F: A VOTE OR SAVE FOR A SONG NO LONGER ON AIR IS DROPPED IN SILENCE", "RED"],   // a refusal message sent for it
  // ── REP ──
  ["OA11", [[RR, "    if (onAir === false) return { counts: false, why: \"not on air where it landed\" };\n", ""]],
    OA, "D: PAGED, AS REP COUNTS IT", "RED"],                                   // a paged late vote counted
  ["OA12", [[RR, "    if (compareAt(r.l, r.id, next.l, next.pi) >= 0) return false;  // a later song had started: this one had ended\n", ""]],
    OA, "D: and they PROVE the ended-song cases", "RED"],                      // the rows never refuse a late one
  ["OA13", [[RD, "    let a = RepRules.onAirAmong(r.order || [], x);", "    let a = null;"]],
    OA, "D: THE READER'S `_verdict`", "RED"],                                   // the reader asks nothing of the rows
  ["OA14", [[RB, "    let a = RepRules.onAirAmong(s.order || [], x);", "    let a = null;"]],
    OA, "D: THE BOT SIDE'S `_verdict`", "RED"],                                 // the bot side asks nothing of the rows
  ["OA15", [[RD, "    if (legal !== null) return { eligible: legal !== false, onAir: null };", "    if (legal !== null) return { eligible: true, onAir: null };"]],
    OA, "D: THE READER'S `_verdict`", "RED"],                                   // a held refusal counted by the reader
  // ── the history bot ──
  ["OA16", [[HB, "    const cand = ended;   // every finished song, up to the one that just ended (740: none waits behind)", "    const cand = ended.slice(0, -1);"]],
    BOT, "A: EACH GOES UP TO THE SONG THAT JUST ENDED", "RED", "A"],           // 738's one-song wait back
  ["OA17", [[HB, "    if (newest && below > newest.count && countAt(newest.to) !== newest.count) {", "    if (newest) {"]],
    BOT, "E3: NO CORRECTION — no stretch is sent twice", "RED", "E"],         // a stretch already summarised sent again
  ["OA18", [[HB, "    for (const r of cand) { if (marked(r.l)) { cur = null; continue; }", "    for (const r of cand) { if (marked(r.l) || (ms.length && r.l < ms[ms.length - 1].to)) { cur = null; continue; }"]],
    BOT, "F: and, first, the songs below its old window that it read back", "RED", "F"],   // a hole below a summary is never filled
];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark, parts] of ROWS) {
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
      const h = J.open("mutate-740-on-air:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const env = Object.assign({}, process.env, parts ? { HB_PARTS: parts } : {});
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 900000, env: env });
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
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + (parts ? " [" + parts + "]" : "") + "  (" + expect + ")"); }
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
