// tools/probes/mutate-j131-history-row.js
// SUBJECT: J131's correction (`ddjp_667`) — History's row on a phone (the owner's design, `main/04-features.md` §Room History):
// `ui/panels.js` (`renderHistory` builds the counts' spot, left of the ＋, on every row; `_histAge`, the age's short words,
// History's only; `_fitHistory`, the line's fit in the owner's order — the age's short form with "ago", its shortest, then the
// name's end — run at the render, by the list's ResizeObserver and at every age tick; "Sys Skip"), `index.html` (the spot's
// one width and its two lines; the line one row of boxes, only the name allowed to shrink, the separator the age's own), and
// `ui/playlists.js` (`songRow`, every list's rows, untouched). Held by `check-list-look` F (and B, the room's word).
// And (`ddjp_669`) `_fmtAgo`'s whole first minute, "just now" below 60 seconds and "1 min ago" from 60, with History's short
// forms following it: held by `check-list-look` "F first minute", rows HR27–HR34. And (`ddjp_670`) the F tick's 20 s row, no
// longer skipped, holding the first minute across a tick: rows HR35–HR36. And (`ddjp_677`, the owner's request at `ddjp_674`)
// the spot on one line — ▲ in its left half, ★ in its right, each centred, both on every row with 0 for none and 99 over 99
// (`ui/panels.js` `shownCounts`; History only: the fold keeps the real number, Now Playing, `ui/chat.js` `_npCount`, shows it),
// History's record holding the counts as shown, the spot as wide as "▲ 99 ★ 99" needs: rows HR37–HR50; HR4–HR8 re-anchored.
// One row per way it could go wrong, each naming the failure it must cause.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j131-history-skip`: every edit is recorded on disk before
// it is made and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, or the row is VOID. Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j131-history-row.js            every row
//   node tools/probes/mutate-j131-history-row.js HR3 HR20   named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PN = "ui/panels.js", IX = "index.html", PL = "ui/playlists.js", CH = "ui/chat.js";
const LL = "check-list-look";
const BS = String.fromCharCode(92);   // a backslash: the app writes ▲ and ★ as escapes, and the anchors must match its bytes
// ui/panels.js
const INSERT = `      row.insertBefore(spot, row.querySelector(".uq-actions"));\n`;
// RE-ANCHORED at `ddjp_677`: both counts are built into the spot on every row, from `shownCounts` (0 for none, 99 over 99).
// RE-ANCHORED at `ddjp_678` (J133): each count carries `hist-zero` on a 0 (`zero(…)`), so VOTES and SAVES take the new lines;
// HR41 still breaks what it broke.
const VOTES = `        H.el("span", { class: "hist-votes" + zero(shown[0]), text: "` + BS + `u25B2 " + shown[0] }),\n`;
const SAVES = `        H.el("span", { class: "hist-saves" + zero(shown[1]), text: "` + BS + `u2605 " + shown[1] }),\n`;
const SHOWN = `    const one = (n) => Math.min(HIST_COUNT_MAX, (typeof n === "number" && n > 0) ? n : 0);`;
const RECORD = `cutShortWord(h), shownCounts(c)];`;
const NPCOUNT = `      ? { n: c.saves || 0, adjusted: !!c.savesAdjusted }\n      : { n: c.votes || 0, adjusted: !!c.votesAdjusted };`;
const STEP3 = `    if (sub) sub.classList.toggle("hist-name-cut", step >= HIST_FIT_STEPS);`;
const FORM = `_histAge(_fmtAgo(Number(age.dataset.ts), now), Math.min(step, 2))`;
const MONTH = `month: "mo", months: "mo"`;
const JUSTNOW = `    if (long === "just now") return "now";\n`;
const LEVEL0 = `    for (const r of rows) _histFitRow(r, 0, now);\n`;
const OVER = `    return !!last && last.getBoundingClientRect().right - sub.getBoundingClientRect().right > 0.01;`;
const TICK = `      () => _fitHistory(refs.queueBody), HISTORY_AGE_TICK_MS);`;
const OBSERVE = `      _histFit.ro.observe(histList);\n`;
const WORD = `media: "Sys Skip" };`;
const REFRESH = `n.textContent = agoFromServer(Number(n.dataset.ts));`;
// RE-ANCHORED at `ddjp_669`: the first minute is "just now" now, so the line reads `s < 60` where it read `s < 45`.
const FMTNOW = `    if (s < 60) return "just now";`;
const MINS = `    const m = Math.floor(s / 60);`;
// index.html
// RE-ANCHORED at `ddjp_677`: the spot's one line, its two halves and its width (where it held two lines at 3.3em).
const SPOT = `.song-row .hist-counts { flex: none; width: 5.8em;`;
const SPOTRULE = `align-self: center; display: grid; grid-template-columns: 1fr 1fr; justify-items: center; align-items: center;`;
const VROW = `    .song-row .hist-counts .hist-votes { grid-column: 1; }\n`;
const SROW = `    .song-row .hist-counts .hist-saves { grid-column: 2; }\n`;
const SEP = `    .song-row .hist-ago::before { content: " · "; }`;
const CUT = `    .hist-list .song-row .sr-sub.hist-name-cut .sr-who {`;
const LINE = `    .hist-list .song-row .sr-sub { display: flex; white-space: pre; }`;
// ui/playlists.js
const ACTS = `    if (opts.actions && opts.actions.length) for (const a of opts.actions) acts.push(a);\n    row.appendChild(H.el("span", { class: "uq-actions" }, acts));\n`;
// A tick that keeps each row's form but checks no fit: each age rewritten in the form its words already have.
const KEEP_ONLY = `      () => { for (const a of Array.from(refs.queueBody.querySelectorAll(".hist-list .hist-ago"))) { const t = a.textContent; ` +
  `const f = (t === "just now" || /^[0-9]+ [a-z]+ ago$/.test(t)) ? 0 : (/ ago$/.test(t) ? 1 : 2); ` +
  `a.textContent = _histAge(_fmtAgo(Number(a.dataset.ts), _serverNow()), f); } }, HISTORY_AGE_TICK_MS);`;
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE COUNTS' SPOT ──
  ["HR1", [[PN, INSERT, ""]],
    LL, "F: EVERY ROW HAS THE COUNTS' SPOT", "RED"],   // no spot: the counts nowhere
  ["HR2", [[PN, INSERT, `      if (c && (c.votes || c.saves)) row.insertBefore(spot, row.querySelector(".uq-actions"));\n`]],
    LL, "F: A ROW WITH NO COUNTS KEEPS ITS SPOT", "RED"],   // the spot only where there are counts: rows no longer line up
  ["HR3", [[PN, INSERT, `      row.appendChild(spot);\n`]],
    LL, "F: EVERY ROW HAS THE COUNTS' SPOT, ONE, BETWEEN THE LINE AND THE ＋", "RED"],   // right of the ＋
  // HR4–HR8 RE-ANCHORED ON PURPOSE at `ddjp_677` (the spot on one line, the owner's at `ddjp_674`): HR4 leaves ▲ in the line
  // from beside the spot's insertion; HR5 the spot squeezable; HR6 the supervisor's sketch's width (5.4em), too narrow for
  // "▲ 99 ★ 99" — it was 2.5em against "★ 999"; HR7 ★ put in ▲'s half (stacked under it, as the old two lines), where it took
  // the ★ alone up a line; HR8 ▲ and ★ swapped, halves where it was lines. Each still breaks what it broke.
  ["HR4", [[PN, INSERT, INSERT + `      if (sub) sub.appendChild(H.el("span", { class: "hist-votes", text: "` + BS + `u25B2 " + shown[0] }));\n`]],
    LL, "F: AND THE COUNTS ARE NO LONGER IN THE GREY LINE", "RED"],   // ▲ left in the line as well
  ["HR5", [[IX, SPOT, `.song-row .hist-counts { flex: 0 1 auto; width: 5.8em;`]],
    LL, "F: THE SPOT IS ONE WIDTH ON EVERY ROW, A FIXED LENGTH, AND NEVER SHRINKS", "RED"],   // the line can squeeze it
  ["HR6", [[IX, SPOT, `.song-row .hist-counts { flex: none; width: 5.4em;`]],
    LL, "F: WIDE ENOUGH FOR \"▲ 99\" AND \"★ 99\" SIDE BY SIDE", "RED"],   // the sketch's 59 px: "★ 99" at the spot's edge
  ["HR7", [[IX, SROW, `    .song-row .hist-counts .hist-saves { grid-column: 1; }\n`]],
    LL, "F: ONE LINE — ▲ IN THE SPOT'S LEFT HALF, ★ ALWAYS IN ITS RIGHT HALF", "RED"],   // ★ under ▲: stacked again
  ["HR8", [[IX, VROW, `    .song-row .hist-counts .hist-votes { grid-column: 2; }\n`], [IX, SROW, `    .song-row .hist-counts .hist-saves { grid-column: 1; }\n`]],
    LL, "F: ONE LINE — ▲ IN THE SPOT'S LEFT HALF, ★ ALWAYS IN ITS RIGHT HALF", "RED"],   // ▲ and ★ swapped
  // ── THE ORDER ──
  ["HR9", [[PN, STEP3, `    if (sub) sub.classList.toggle("hist-name-cut", step >= 1);`]],
    LL, "F: THE OWNER'S ROW GIVES WAY IN HIS ORDER", "RED"],   // the name cut first, before the age shortens
  ["HR10", [[PN, FORM, `_histAge(_fmtAgo(Number(age.dataset.ts), now), step ? 2 : 0)`]],
    LL, "F: THE OWNER'S ROW GIVES WAY IN HIS ORDER", "RED"],   // straight to "3d": the form with "ago" skipped
  ["HR11", [[PN, MONTH, `month: "m", months: "m"`]],
    LL, "F: EVERY ROW, EVERY UNIT", "RED"],   // "1m" for a month, the word minutes already have
  ["HR12", [[PN, JUSTNOW, ""]],
    LL, "F: EVERY ROW, EVERY UNIT", "RED"],   // "just now" never becomes "now"
  ["HR13", [[PN, LEVEL0, `    for (const r of rows) _histFitRow(r, 1, now);\n`]],
    LL, "F: WITH ROOM, THE FULL WORDS", "RED"],   // short words with room to spare
  ["HR14", [[PN, LEVEL0, ""]],
    LL, "F: WHEN ROOM COMES BACK", "RED"],   // a row only ever climbs: the long words never return
  ["HR15", [[IX, SEP, `    .song-row .sr-who::after { content: " · "; }`]],
    LL, "F: THE \" · \" AFTER THE NAME IS DRAWN BY THE AGE", "RED"],   // 666's separator: cut away with the name's end
  ["HR16", [[IX, CUT, `    .hist-list .song-row .sr-sub.hist-name-cut > * {`]],
    LL, "F: \"skipped\" AND \"Sys Skip\" ARE NEVER CUT", "RED"],   // at the last step every box may shrink, the word too
  ["HR17", [[IX, LINE, `    .hist-list .song-row .sr-sub { white-space: pre; }`]],
    LL, "F: THE NAME, AND ONLY THE NAME, MAY GIVE UP ITS END", "RED"],   // not a flex line: the name cannot give way, the line's end is cut
  ["HR18", [[PN, OVER, `    return !!last && last.getBoundingClientRect().right - sub.getBoundingClientRect().right > -20;`]],
    LL, "F: ONLY AS FAR AS NEEDED", "RED"],   // shortened with room left
  ["HR19", [[PN, OBSERVE, ""]],
    LL, "F PREMISE — a change of width reaches History's fit through its observer", "RED"],   // a wider window, a phone turned: nothing re-fits
  // ── THE TICK ──
  ["HR20", [[PN, TICK, `      () => _refreshAges(refs.queueBody, "hist-ago"), HISTORY_AGE_TICK_MS);`]],
    LL, "F: A TICK KEEPS EACH ROW'S FORM", "RED"],   // 666's tick: the long words over every short one
  ["HR21", [[PN, TICK, KEEP_ONLY]],
    LL, "F: AND IT CHECKS THE FIT AGAIN", "RED"],   // each form kept, but an age grown longer overflows
  // ── THE ROOM'S WORD, THE DM LIST, THE OTHER LISTS ──
  ["HR22", [[PN, WORD, `media: "Sys Skipped" };`]],
    LL, "B: \"SKIPPED\" (\"SYS SKIP\" FOR THE ROOM'S SKIP) IS ITS OWN ELEMENT", "RED"],   // the old word back
  ["HR23", [[PL, ACTS, ACTS.replace("    row.appendChild(H.el(\"span\", { class: \"uq-actions\" }", "    row.appendChild(H.el(\"span\", { class: \"hist-counts\" }));\n    row.appendChild(H.el(\"span\", { class: \"uq-actions\" }")]],
    LL, "F: THE ROOM QUEUE'S ROWS ARE AS THEY WERE", "RED"],   // the spot built in `songRow`, on every list
  ["HR24", [[IX, LINE, `    .song-row .sr-sub { display: flex; white-space: pre; }`]],
    LL, "F: THE ROOM QUEUE'S ROWS ARE AS THEY WERE", "RED"],   // History's line rule on every list
  ["HR25", [[PN, FMTNOW, `    if (s < 60) return "now";`]],
    LL, "F: `_fmtAgo`'S LONG WORDS ARE AS THEY WERE", "RED"],   // a short word in the formatter every screen reads
  ["HR26", [[PN, REFRESH, `n.textContent = _histAge(agoFromServer(Number(n.dataset.ts)), 2);`]],
    LL, "F: AND ITS OWN TICK (`_refreshAges`) STILL WRITES THE LONG WORDS", "RED"],   // the DM list's times shortened
  // ── THE FIRST MINUTE (`ddjp_669`) ──
  ["HR27", [[PN, FMTNOW, `    if (s < 45) return "just now";`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // 668's line back: "0 mins ago" from 45 to 59 seconds
  ["HR28", [[PN, FMTNOW, `    if (s < 45) return "just now";`]],
    LL, "F: AND HISTORY'S SHORT FORMS FOLLOW", "RED"],   // the same, seen on History: "0min ago", "0min" at 59 seconds
  ["HR29", [[PN, FMTNOW, `    if (s < 59) return "just now";`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // a second short: "0 mins ago" at 59
  ["HR30", [[PN, FMTNOW, `    if (s <= 60) return "just now";`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // a second over: "just now" at 60, where it says "1 min ago"
  ["HR31", [[PN, FMTNOW, `    if (s < 30) return "just now";`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // "0 mins ago" from 30 seconds: 44 too
  ["HR32", [[PN, FMTNOW, `    if (s < 45) return "just now";`], [PN, MINS, `    const m = Math.max(1, Math.floor(s / 60));`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // no "0" but not the decision: "1 min ago" from 45 seconds
  ["HR33", [[PN, JUSTNOW, ""]],
    LL, "F: AND HISTORY'S SHORT FORMS FOLLOW", "RED"],   // the long words right, History's short form not: "just now" kept whole
  ["HR34", [[PN, FMTNOW, `    if (s < 45) return "just now";`], [PN, JUSTNOW, JUSTNOW + `    if (/^0 mins? ago$/.test(long)) return "now";\n`]],
    LL, "F: THE WHOLE FIRST MINUTE READS \"just now\"", "RED"],   // fixed in History alone, not in the one formatter: every other screen still says "0 mins ago"
  // ── THE TICK'S 20 S ROW, BACK ON (`ddjp_670`): skipped until then (`i === 3`), it now holds the first minute across a tick ──
  ["HR35", [[PN, FMTNOW, `    if (s < 45) return "just now";`]],
    LL, "F: A TICK KEEPS EACH ROW'S FORM", "RED"],   // 668's line back: the 20 s row reads "0 mins ago" ("0min") at 50 s, after the tick
  ["HR36", [[PN, FMTNOW, `    if (s < 50) return "just now";`]],
    LL, "F: A TICK KEEPS EACH ROW'S FORM", "RED"],   // just short of the tick's 50 s: "just now" before it, "0 mins ago" after
  // ── THE SPOT ON ONE LINE (`ddjp_677`, the owner's request at `ddjp_674`) ──
  ["HR37", [[IX, SPOTRULE, `align-self: stretch; display: grid; grid-template-rows: 1fr 1fr; align-items: center;`], [IX, VROW, `    .song-row .hist-counts .hist-votes { grid-row: 1; }\n`], [IX, SROW, `    .song-row .hist-counts .hist-saves { grid-row: 2; }\n`]],
    LL, "F: ONE LINE — ▲ IN THE SPOT'S LEFT HALF, ★ ALWAYS IN ITS RIGHT HALF", "RED"],   // 676's two lines back
  ["HR38", [[IX, SPOTRULE, SPOTRULE.replace("justify-items: center; ", "")]],
    LL, "F: EACH CENTRED IN ITS HALF", "RED"],   // each at the start of its half, not centred (the owner: "centered")
  ["HR39", [[IX, SPOTRULE, SPOTRULE.replace("align-self: center;", "align-self: flex-start;")]],
    LL, "F: EACH CENTRED IN ITS HALF, AND THE LINE IN THE MIDDLE OF THE ROW'S HEIGHT", "RED"],   // the line at the row's top
  ["HR40", [[IX, SPOT, `.song-row .hist-counts { flex: none; width: 7em;`]],
    LL, "F: AND NO WIDER THAN THAT NEEDS", "RED"],   // room the title gives up for nothing
  // ── 0 WHERE THERE ARE NONE ──
  ["HR41", [[PN, VOTES + SAVES, VOTES + SAVES + `      ].filter((n, i) => shown[i] > 0), [\n`]],
    LL, "F: A ROW WITH NO COUNTS KEEPS ITS SPOT AND SAYS 0, BOTH", "RED"],   // a zero dropped again: only where not zero
  // ── 99 OVER 99, HISTORY ONLY ──
  ["HR42", [[PN, SHOWN, `    const one = (n) => ((typeof n === "number" && n > 0) ? n : 0);`]],
    LL, "F: OVER 99 THE DISPLAY READS 99", "RED"],   // no cap: "▲ 150"
  ["HR43", [[PN, SHOWN, `    const one = (n) => ((typeof n === "number" && n > HIST_COUNT_MAX) ? HIST_COUNT_MAX + "+" : (typeof n === "number" && n > 0) ? n : 0);`]],
    LL, "F: OVER 99 THE DISPLAY READS 99, WITH NO \"+\"", "RED"],   // "99+": the owner's "it should show 00 not +"
  ["HR44", [[PN, SHOWN, `    const one = (n) => Math.min(HIST_COUNT_MAX - 1, (typeof n === "number" && n > 0) ? n : 0);`]],
    LL, "F: OVER 99 THE DISPLAY READS 99", "RED"],   // capped a step short: 99 itself reads 98
  ["HR45", [[PN, "      const shown = shownCounts(c);\n", "      const shown = shownCounts(c);\n      if (c) { c.votes = shown[0]; c.saves = shown[1]; }\n"]],
    LL, "F: AND THE COUNTS KEPT AND FOLDED STAY REAL", "RED"],   // the cap written into the fold's and the row's own counts
  ["HR46", [[CH, NPCOUNT, NPCOUNT.replace("{ n: c.saves || 0,", "{ n: Math.min(99, c.saves || 0),").replace("{ n: c.votes || 0,", "{ n: Math.min(99, c.votes || 0),")]],
    LL, "F: NOW PLAYING SHOWS THE REAL NUMBER", "RED"],   // the cap reaching Now Playing (the room queue's row and the Player's)
  // ── THE RECORD, AS SHOWN ──
  ["HR47", [[PN, RECORD, `cutShortWord(h), c ? [c.votes || 0, c.saves || 0] : null];`]],
    LL, "F: THE RECORD HOLDS THE COUNTS AS SHOWN", "RED"],   // 676's record: the real counts, so 120 → 121 redraws
  ["HR48", [[PN, RECORD, `cutShortWord(h), c ? shownCounts(c) : null];`]],
    LL, "F: THE RECORD HOLDS THE COUNTS AS SHOWN", "RED"],   // as shown, but none and 0 told apart: a redraw for nothing drawn
  ["HR49", [[PN, RECORD, `cutShortWord(h), null];`]],
    LL, "F CONTROL: and a count that changes what is drawn (98 → 99) redraws it", "RED"],   // no counts in the record: a change drawn, never redrawn
  // ── THE CLASS, DECLARED (`check-control-styling`) ──
  ["HR50", [[IX, SPOTRULE, SPOTRULE.replace("grid-template-columns: 1fr 1fr;", "grid-auto-flow: column;")]],
    "check-control-styling", "J131: EVERY CLASS THE JOB ADDS IS USED IN ui/ AND DECLARED IN THE SHEET", "RED"],   // the halves said no other way
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
      const h = J.open("mutate-j131-history-row:" + id, file);   // journalled BEFORE the write
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
