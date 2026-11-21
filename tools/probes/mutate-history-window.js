// tools/probes/mutate-history-window.js
// SUBJECT: song history's window and the two owed song-history fixes (the owner's; `consensus/history-rules.md` §9, §10, §11) —
// `backends/backend1/history.js` (the window: `windowFrom`, nothing below it claimed, no hole below it, verify newest first with a
// bounded walk — no deeper than the newest window, nor than where an earlier open's checks resume — and no second read of a
// checked stretch, the fills read from the top down, marks below the window dropped, the
// audit compared on the window; the skip's reason written onto the row by play), `backends/backend1/matrixbridge.js` (the
// chain with no read, the bounded walk `_olderFloors`, the open's line, the audit from the anchoring save point, the owed
// backfill paid when the tab is settled), `backends/backend1/streammanager.js` (a move-on whose hand-off waited owes the
// backfill), `backends/backend1/statederiver.js` (`state.endedBy`, by play, bounded, in no seed). Held by `check-history-window`,
// `check-bot-room-history` and `check-history-skip` F. One row per way it could go wrong, each naming the failure it must cause;
// a row marked GREEN is a measured, dominated line, with why beside it (`check-break-verdict` asks the one rule for both).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j131-history-skip`: every edit is recorded on disk before it is
// made and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND
// when its result is read, or the row is VOID. Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-history-window.js            every row
//   node tools/probes/mutate-history-window.js WF RR5     named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", SM = "backends/backend1/streammanager.js", SD = "backends/backend1/statederiver.js";
const HW = "check-history-window", BR = "check-bot-room-history", HS = "check-history-skip";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["WF", [[HI, "    return (sp[n - 1][0] <= lo) ? lo : null;\n", "    return null;\n"]],
    HW, "A: A FIRST OPEN READS NO FURTHER BELOW THE WINDOW", "RED"],   // the window is never held: every reader reads to the room's start, as 734 did
    // re-anchored at 737: `windowFrom` reads the newest unbroken span of events and the bot's summaries together (`_spans()`, §12) — the same mutation, the same named failure
  ["WH", [[HI, "    if (windowFrom() !== null) return out;   // the window is held: nothing below its oldest song is a hole (\u00a710)\n", ""]],
    HW, "C: A SONG PAST THE WINDOW RE-OPENS NO HOLE BELOW IT", "RED"],   // the stretch below the window is a hole again at every song
  ["WS", [[HI, "      if (_verifiedSpan((w !== null) ? w : 0, c0.l)) break;          // checked on an earlier open: nothing to read\n", ""]],
    HW, "B: A SECOND OPEN PAGES NOTHING", "RED"],   // a later open walks below the floors it remembers though verify checked that stretch
  ["WN", [[HI, "      let need = Math.max(1, _max() - _rowsAbove(c0.l));\n", "      let need = c0.l + 1;\n"]],
    HW, "A: A FIRST OPEN READS NO FURTHER BELOW THE WINDOW", "RED"],   // the walk reads the whole room below the oldest floor at once
    // re-anchored at `ddjp_736`: `MAX` there reads the room's window now, `_max()` (the owner's `historySize`, §12) — the same mutation, the same named failure
  ["WK1", [[HI, "      if (top !== null) need = Math.min(need, c0.l - top + 1);\n", ""]],
    HW, "H: BACK AFTER A LONG ABSENCE, IT READS THE STRETCH IT MISSED AND NO MORE", "RED"],   // the supervisor's finding at 735: a return sizes its walk from the window it held and reads down to that window's floor
  ["WK2", [[HI, "      let need = Math.max(1, _max() - _rowsAbove(c0.l));\n      if (w !== null) need = Math.min(need, c0.l - w + 1);\n", "      let need = (w !== null) ? (c0.l - w + 1) : Math.max(1, _max() - _rowsAbove(c0.l));\n"]],
    HW, "H: BACK AFTER AN ABSENCE PAST THE WHOLE WINDOW, NOTHING IS READ BELOW THE SAVE POINT ANCHORING THE NEW WINDOW", "RED"],   // the walk is not bounded by the newest window: back after an absence past the whole window it reads down to where its old checks resume, below the new window's anchoring save point
    // re-anchored at `ddjp_736`: `MAX` there reads the room's window now, `_max()` (the owner's `historySize`, §12) — the same mutation, the same named failure
  ["WO", [[MB, "      const from = Math.max(0, c0.l - span);\n", "      const from = 0;\n"]],
    HW, "A: A FIRST OPEN READS NO FURTHER BELOW THE WINDOW", "RED"],   // the bridge's walk pages from the room's start, as `_resolvedChain` did
  ["WV", [[HI, "        if (w !== null && ch[i].l < w) break;                       // wholly below the window's oldest song: never read\n", ""]],
    HW, "", "GREEN"],   // MEASURED: verify's walk never brings a stretch wholly below the window into the chain (it reads only the songs still needed and the last stretch's length), so this line is dominated by the walk's bound today; it stays as the rule at the loop
  ["WC", [[HI, "    const w = windowFrom();\n    if (w !== null) { if (hi < w) return; if (lo < w) lo = w; }\n", "    const w = null;\n"]],
    HW, "", "GREEN"],   // MEASURED: alone, dominated - once the window is held no writer reaches below it but the rebuild, which skips that stretch (WR); WCR shows the clamp holding when the skip is gone
  ["WR", [[HI, "      if (w !== null && b && (b.l < w || (a.h === \"start\" && !reachesFirst))) continue;\n", ""]],
    HW, "E: A SECOND OPEN ASKS NOTHING BELOW THE WINDOW", "RED"],   // a shared room's reopened rebuild re-folds its whole held cache; the rows it folds below the window, evicted at once, read as changes and drop the window's lowest verify mark, so verify reads that stretch again
  ["WCR", [[HI, "    const w = windowFrom();\n    if (w !== null) { if (hi < w) return; if (lo < w) lo = w; }\n", "    const w = null;\n"], [HI, "      if (w !== null && b && (b.l < w || (a.h === \"start\" && !reachesFirst))) continue;\n", ""]],
    HW, "B: AND HOLDS THE SAME NEWEST 5000 SONGS, the window held", "RED"],   // both: a reopened bot room's rebuild claims the room's start from one held event (the clamp alone stops that, WR alone fails only the shared room)
  ["WP", [[HI, "    for (const k of Object.keys(_verified)) if (_verified[k] && typeof _verified[k].hi === \"number\" && _verified[k].hi < l) delete _verified[k];\n", ""]],
    HW, "C: THE TABLE KEEPS NO VERIFY MARK WHOLLY BELOW THE WINDOW", "RED"],   // marks for stretches the window passed are carried forever
  ["WG1", [[HI, "        if (hi - a + 1 <= Math.max(1, _max() - _rowsAbove(hi))) {", "        if (true) {"]],
    HW, "G: NO READ DEEPER THAN ONE STRETCH BELOW THE ANCHORING SAVE POINT", "RED"],   // a deep hole is read whole, from its bottom
    // re-anchored at `ddjp_736`: `MAX` there reads the room's window now, `_max()` (the owner's `historySize`, §12) — the same mutation, the same named failure
  ["WG2", [[HI, "      while (hi >= fromL && !_full() && hi - fromL + 1 > Math.max(1, _max() - _rowsAbove(hi))) {", "      while (false) {"]],
    HW, "G: AND READS FROM THE TOP DOWN", "RED"],   // a backfill into an empty table reads from the room's start at once
    // re-anchored at `ddjp_736`: `MAX` there reads the room's window now, `_max()` (the owner's `historySize`, §12) — the same mutation, the same named failure
  ["WB", [[MB, "      if (cov && cov.full) {\n", "      if (false) {\n"]],
    HW, "B: AND SAYS IT HOLDS THE WINDOW", "RED"],   // the open does not say it holds the window
  ["WA", [[MB, "    if (w !== null) {\n      let ch = _acceptedChain();\n", "    if (false) {\n      let ch = _acceptedChain();\n"]],
    HW, "D: THE AUDIT UNDER THE WINDOW", "RED"],   // the audit reads from the room's start and reports every song below the window missing
  ["WT", [[HI, "    const win = (opts && typeof opts.from === \"number\") ? opts.from : null;\n", "    const win = null;\n"]],
    HW, "D: THE AUDIT UNDER THE WINDOW", "RED"],   // the audit's truth folds its first stretch from nothing and compares rows below the window
  ["OW1", [[SM, "        if (_h && _h.deferred === \"not-settled\" && opts.prove && typeof MatrixBridge !== \"undefined\" && MatrixBridge.oweHistoryBackfill) MatrixBridge.oweHistoryBackfill();\n", ""]],
    BR, "A: SETTLED AGAIN, THE TWO SONGS ARE IN SONG HISTORY AT ONCE", "RED"],   // a move-on that wrote nothing owes nothing: 734's defect
  ["OW2", [[MB, "    if (_backfillOwed && !_historyOwed) { _backfillOwed = false; rearmHistoryBackfill(); } }", "    }"]],
    BR, "A: SETTLED AGAIN, THE TWO SONGS ARE IN SONG HISTORY AT ONCE", "RED"],   // owed and never paid
  ["OW3", [[MB, "  function oweHistoryBackfill() { _backfillOwed = true; _oweHistory(); }", "  function oweHistoryBackfill() { rearmHistoryBackfill(); }"]],
    BR, "A: WHILE AWAY, SONG HISTORY WRITES NOTHING AND THE OWED READ WAITS", "RED"],   // paid at once, before the tab is settled
  ["OW4", [[MB, "    _backfillOwed = false;  // ...nor a backfill owed to it (\u00a79)\n", ""]],
    BR, "", "GREEN"],   // MEASURED: a backfill owed to a room left would be paid at the next room's first owed refresh - a backfill of that room, harmless; the reset keeps the room's debt the room's
  ["RR1", [[SD, "      endedBy[pi] = (typeof reason === \"string\" && reason) ? reason : null;\n", "      endedBy[pi] = null;\n"]],
    HS, "F: A FOLD FROM A SAVE POINT RECORDS THE SAVE POINT'S SONG'S REASON BY PLAY", "RED"],   // the fold keeps no reason by play
  ["RR2", [[SD, "(isSkip && isSkipReason(c.k)) ? c.k : null);", "null);"]],
    HS, "F: THE FOLD RECORDS, BY PLAY, THE TOKEN THE SKIP THAT ENDED EACH SONG NAMED", "RED"],   // the advance hands no reason
  ["RR3", [[SD, "      tick: tick,\n", "      tick: tick,\n      endedBy: Object.assign({}, endedBy),\n"]],
    HS, "F: THE REASON IS IN NO SAVE POINT", "RED"],   // sealed into every save point: every checkpoint re-fingerprinted
  ["RR4", [[SD, "delete cutShortBy[k]; delete endedBy[k]; _endedCount--;", "delete cutShortBy[k]; _endedCount--;"]],
    HS, "F: THE REASON RECORD IS BOUNDED WITH THE KINDS", "RED"],   // unbounded
  ["RR5", [[HI, "      const v = (reasons && Object.prototype.hasOwnProperty.call(reasons, e.pi)) ? reasons[e.pi] : (e.endedBy !== undefined ? e.endedBy : _hadWhy[e.pi]);", "      const v = (e.endedBy !== undefined ? e.endedBy : _hadWhy[e.pi]);"]],
    HS, "F: FROM A SAVE POINT, D'S ROW TAKES THE REASON", "RED"],   // History never writes a fold's reason onto a row it holds: 734's defect
  ["RR6", [[HI, "      if (v === null && e.endedBy !== undefined) { const c = Object.assign({}, e); delete c.endedBy; _entries[i] = c; }\n", "      if (false) { /* a null reason clears nothing */ }\n"]],
    HS, "F: A LATER FOLD THAT SETTLES THE RACE THE OTHER WAY CLEARS THE REASON", "RED"],   // a race settled the other way keeps the reason
  ["RR7", [[HI, "    for (const e of _entries) if (e && e.pi && e.endedBy !== undefined) _hadWhy[e.pi] = e.endedBy;\n", ""]],
    HS, "F: A REWRITE THAT CANNOT SEE THE ENDING KEEPS IT", "RED"],   // a rewrite drops it
  ["RR8", [[HI, "    if (verified) _mergeIn([], null, true, endedAll, reasonsAll);", "    if (verified) _mergeIn([], null, true, endedAll, null);"]],
    HS, "F: VERIFY PUTS THE REASON ON D", "RED"],   // verify, newest first, loses a reason seen in the stretch after the save point
  ["RR9", [[HI, "      if (r.reasons) Object.assign(reasons, r.reasons);   // and its reason with it (\u00a711)\n", ""]],
    HS, "F: THE FLOOR-ANCHORED TRUTH CARRIES IT", "RED"],   // the audit's truth carries no reason
  ["RR10", [[HI, "_mergeIn(rows.filter((r) => r.src !== \"floor\"), null, true, sr.ended, sr.reasons); _mergeIn(rows.filter((r) => r.src === \"floor\"), null, false, sr.ended, sr.reasons);", "_mergeIn(rows.filter((r) => r.src !== \"floor\"), null, true, sr.ended, null); _mergeIn(rows.filter((r) => r.src === \"floor\"), null, false, sr.ended, null);"]],
    HS, "F: THE CACHE REBUILD CARRIES IT TOO", "RED"],   // the cache rebuild carries no reason
  ["RR11", [[HI, "    _mergeIn(folded, _finals, true, both && both.state ? both.state.cutShortBy : null, both && both.state ? both.state.endedBy : null);", "    _mergeIn(folded, _finals, true, both && both.state ? both.state.cutShortBy : null, null);"]],
    HS, "F: FROM A SAVE POINT, D'S ROW TAKES THE REASON", "RED"],   // a fold hands History no reason
  ["RR12", [[HI, "      const v = (reasons && Object.prototype.hasOwnProperty.call(reasons, e.pi)) ? reasons[e.pi] : (e.endedBy !== undefined ? e.endedBy : _hadWhy[e.pi]);", "      const v = (e.endedBy !== undefined ? e.endedBy : _hadWhy[e.pi]);"]],
    BR, "B: AND ITS ROW KEEPS THE SKIP'S REASON ACROSS THE SAVE POINT", "RED"],   // end to end in a bot room: the repeat skip at a save point loses its reason, and the cooldown counts the try
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
      const h = J.open("mutate-history-window:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
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
