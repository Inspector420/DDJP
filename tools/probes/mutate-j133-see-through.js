// tools/probes/mutate-j133-see-through.js
// SUBJECT: J133 — the owner's six requests since `ddjp_677` (`ddjp_678`): the lists see-through, as dark as the chat box, locked
// or not (`index.html`'s chat-box rule naming `.song-row`, `.pl-row`, `.dm-row`, `.logs-box`; DM rows in DMs only, their hover a
// see-through wash) — `check-list-look` S; a skip rule's box inside a card, while locked, darker still (the same rule naming
// `.prefs-body.prefs-locked .set-rule`) — `check-settings-apply` R7; History's 0 in the line's grey (`ui/panels.js`'s
// `hist-zero`, coloured by the line's own rule) — `check-list-look` F; the player's cover with words see-through over a frame
// with no black of its own, the video under it not drawn (`ui/player.js` `_renderCover`'s `cover-words`, the iframe at
// opacity 0) — `check-player-cover` G; My queue's two notes gone (`ui/queue.js` `renderMyQueue`) — `check-queue-redraw` C; and
// the player's DJ name opening the card (`ui/player.js` `_setNpLabel`, `Roster._wireCardTrigger`) — `check-np-time` D. One
// row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay
// green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j133-see-through.js            every row
//   node tools/probes/mutate-j133-see-through.js ST1 PC3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HTML = "index.html", PANELS = "ui/panels.js", PLAYER = "ui/player.js", QUEUE = "ui/queue.js";
const LOOK = "check-list-look", APPLY = "check-settings-apply", COVER = "check-player-cover", REDRAW = "check-queue-redraw", NP = "check-np-time";
// The chat box's darkness, the one rule (`index.html`): its first line, and the line `ddjp_678` added to it.
const TINT1 = "    .chat-messages, .chat-input, .dm-search, .invite-input, .chat-tint, .prefs-body.prefs-locked .pref-section, .prefs-body.prefs-locked .set-sec, .prefs-body.prefs-locked > .set-row,\n";
const TINT2 = "      .song-row, .pl-row, .dm-row, .logs-box, .player-shield.waiting, .prefs-body.prefs-locked .set-rule, .prefs-body.prefs-locked .set-deps .set-row { background: rgba(12,12,16,0.45); }";
const TINT = TINT1 + TINT2;
const FRAME = "    .chat-messages, .chat-input, .dm-search, .invite-input, .chat-tint { border: 1px solid rgba(255,255,255,0.06); }";
const DMHOVER = "    .dm-row:hover { background: rgba(255, 255, 255, 0.04); }";
const COLUMN_BG = "background: rgba(22,22,26, var(--panel-dim, 0.75));";
const PL_ROW = "    .pl-row { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; border: 1px solid #2a2a2a;";
const LOGS = "    .logs-box { flex: 1; min-height: 120px; overflow-y: auto; border: 1px solid #2a2a2a;";
const HEAD = "    .set-card-head { font-size: 11px; font-weight: 700;";
const GREY = "    .song-row .sr-sub, .song-row .hist-counts .hist-zero { color: #888; }";
const ZERO = `      const zero = (n) => (n === 0 ? " hist-zero" : "");`;
const VOTES = `        H.el("span", { class: "hist-votes" + zero(shown[0]), text: "\\u25B2 " + shown[0] }),`;
const RECORD = "h.at, cutShortWord(h), shownCounts(c)];";
const FRAME_CLS = `    if (refs.playerFrame) refs.playerFrame.classList.toggle("cover-words", !!c.label);`;
const HIDE_IFR = "    .player-frame.cover-words > iframe, .player-frame.cover-words > #yt-player { opacity: 0; }";
const FRAME_RULE = "    .player-frame { width: 100%; aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden; position: relative; }";
const ADDED = `        note.textContent = "";\n      } else {`;
const REFUSED = `        note.textContent = "Couldn't add: " + r.reason;`;
const WIRE = "      Roster._wireCardTrigger(nameEl, djId);";
const REBUILD = "    if (!refs.npAvatar || refs.npAvatar.dataset.avatarFor !== djId) {";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── PART 1: THE LISTS, SEE-THROUGH, AS DARK AS THE CHAT BOX (`check-list-look` S) ──
  ["ST1", [[HTML, TINT2, TINT2.replace("      .song-row, ", "      ")]],
    LOOK, "S: EVERY ROW TAKES THE CHAT BOX'S DARKNESS, FROM THE CHAT BOX'S OWN RULE", "RED"],   // the song rows left out: no background at all
  ["ST2", [[HTML, PL_ROW, PL_ROW.replace("border: 1px solid #2a2a2a;", "background: #1a1a1a; border: 1px solid #2a2a2a;")]],
    LOOK, "S: EVERY ROW TAKES THE CHAT BOX'S DARKNESS, FROM THE CHAT BOX'S OWN RULE", "RED"],   // the library's rows solid again: their own rule is later
  ["ST3", [[HTML, LOGS, LOGS.replace("border: 1px solid #2a2a2a;", "background: #000; border: 1px solid #2a2a2a;")]],
    LOOK, "S: AND NONE OF THEM KEEPS A BACKGROUND OF ITS OWN IN THE SHEET", "RED"],   // the Logs box black again
  ["ST4", [[HTML, TINT2, TINT2.replace(".dm-row,", ".room-item,")]],
    LOOK, "S: DM ROWS CHANGE IN DMs ONLY", "RED"],   // the darkness laid on `.room-item`: the room list changes too
  ["ST5", [[HTML, DMHOVER, "    .dm-row:hover { background: #26262b; }"]],
    LOOK, "S: AND A DM ROW'S HOVER IS SEE-THROUGH TOO", "RED"],   // the old solid hover back
  ["ST6", [[HTML, FRAME, FRAME.replace(".chat-tint {", ".chat-tint, .song-row {")]],
    LOOK, "S: EACH KEEPS ITS FRAME", "RED"],   // the rows take the chat box's frame with its darkness
  ["ST7", [[HTML, TINT2, TINT2.replace(".song-row, ", ".song-row, .song-row .thumb-slot, ")]],
    LOOK, "S: TEXT, BUTTONS AND PICTURES AS THEY ARE", "RED"],   // the picture's square darkened too
  ["ST8", [[HTML, COLUMN_BG, "background: rgba(22,22,26,0.75);"]],
    LOOK, "S: THEY SIT ON THE PANEL AND FOLLOW ITS DIMNESS", "RED"],   // the panel no longer the slider's: nothing follows it
  // ── PART 2: A SKIP RULE'S BOX, LOCKED, DARKER STILL (`check-settings-apply` R7) ──
  ["SR1", [[HTML, TINT2, TINT2.replace(", .prefs-body.prefs-locked .set-rule,", ",")]],
    APPLY, "R7: LOCKED, A SKIP RULE'S BOX TAKES THE CHAT BOX'S DARKNESS ON TOP OF ITS CARD'S", "RED"],   // left solid while locked
  ["SR2", [[HTML, TINT2, TINT2.replace(".prefs-body.prefs-locked .set-rule,", ".prefs-body .set-rule,")]],
    APPLY, "R7: UNLOCKED, SOLID, AS TODAY", "RED"],   // dark whether locked or not
  ["SR3", [[HTML, FRAME, FRAME.replace(".chat-tint {", ".chat-tint, .prefs-body.prefs-locked .set-rule {")]],
    APPLY, "R7: AND IT KEEPS ITS FRAME", "RED"],   // the chat box's frame taken with its darkness
  ["SR4", [[HTML, HEAD, "    .set-card-head { background: #1a1a1a; font-size: 11px; font-weight: 700;"]],
    APPLY, "R7: AND NO OTHER BOX INSIDE A CARD IS LEFT SOLID WHILE LOCKED", "RED"],   // another box inside a card, solid (a card's heading)
  // ── PART 3: HISTORY'S 0 IN THE LINE'S GREY (`check-list-look` F) ──
  ["HZ1", [[PANELS, ZERO, `      const zero = (n) => "";`]],
    LOOK, "F: A COUNT OF 0 IS IN THE LINE'S GREY", "RED"],   // never grey: blue and gold as before
  ["HZ2", [[HTML, GREY, "    .song-row .sr-sub { color: #888; }\n    .song-row .hist-counts .hist-zero { color: #888; }"]],
    LOOK, "F: A COUNT OF 0 IS IN THE LINE'S GREY", "RED"],   // the grey a copy of the line's, free to drift
  ["HZ3", [[PANELS, VOTES, `        (() => { const v = H.el("span", { class: "hist-votes", text: "\\u25B2 " + shown[0] }); if (shown[0] === 0) v.style.color = "#888"; return v; })(),`]],
    LOOK, "F: A COUNT OF 0 IS IN THE LINE'S GREY", "RED"],   // grey by an inline colour, not the sheet
  ["HZ4", [[PANELS, ZERO, `      const zero = (n) => " hist-zero";`]],
    LOOK, "F: ABOVE 0, BLUE AND GOLD AS NOW", "RED"],   // every count grey — it fires at PART B first (B reads the counts' colours
  //                                                    off the buttons); with B's two rows cleared in a scratch copy, its target is red alone (the report)
  ["HZ5", [[PANELS, RECORD, "h.at, cutShortWord(h), shownCounts(c).map((n) => Math.max(1, n))];"]],
    LOOK, "F: AND 0 → 1 REDRAWS THE ROW", "RED"],   // the record no longer tells 0 from 1: the grey stays after a vote
  // ── PART 4: THE PLAYER'S COVER (`check-player-cover` G) ──
  ["PC1", [[PLAYER, FRAME_CLS + "\n", ""]],
    COVER, "G: WHILE THE COVER SHOWS WORDS, THE FRAME CARRIES `cover-words`", "RED"],   // the class never set: the video shows through the cover
  ["PC2", [[PLAYER, FRAME_CLS, FRAME_CLS.replace("!!c.label", "!!c.show")]],
    COVER, "G: AND NOT OTHERWISE", "RED"],   // the blocked cover hides the video too
  ["PC3", [[HTML, HIDE_IFR, HIDE_IFR.replace("{ opacity: 0; }", "{ display: none !important; }")]],
    COVER, "G: AND UNDER IT THE VIDEO IS NOT DRAWN", "RED"],   // hidden by display:none
  ["PC4", [[HTML, FRAME_RULE, FRAME_RULE.replace("border-radius: 6px;", "background: #000; border-radius: 6px;")]],
    COVER, "G: THE FRAME HAS NO BLACK OF ITS OWN", "RED"],   // the frame's black back
  ["PC5", [[HTML, TINT2, TINT2.replace(" .player-shield.waiting,", "")]],
    COVER, "G: THE COVER WITH WORDS TAKES THE CHAT BOX'S DARKNESS", "RED"],   // the cover with words transparent: the room, undarkened
  ["PC6", [[PLAYER, FRAME_CLS, FRAME_CLS + `\n    if (refs.player) refs.player.style.opacity = c.label ? "0" : "";`]],
    COVER, "G: THE PLAYER ITSELF IS NEVER TOUCHED", "RED"],   // the iframe written to from the cover's code
  ["PC7", [[HTML, HIDE_IFR, "    .player-frame:has(.player-shield.waiting) > iframe { opacity: 0; }"]],
    COVER, "G: AND UNDER IT THE VIDEO IS NOT DRAWN", "RED"],   // set by `:has()`, not the class
  // ── PART 5: MY QUEUE'S NOTES (`check-queue-redraw` C) ──
  ["MQ1", [[QUEUE, ADDED, `        note.textContent = UserQueue.isActive() ? "Added." : "";\n      } else {`]],
    REDRAW, "C: AND THE NEXT ADD CLEARS IT, saying nothing in its place (in the rotation)", "RED"],   // "Added." back for an add in the rotation
  ["MQ2", [[QUEUE, REFUSED, `        note.textContent = "";`]],
    REDRAW, "C: A REFUSAL STILL SAYS WHY", "RED"],   // a refusal silent
  ["MQ3", [[QUEUE, ADDED, `\n      } else {`]],
    REDRAW, "C: AND THE NEXT ADD CLEARS IT", "RED"],   // an add leaves the last refusal under the line
  // ── PART 6: THE PLAYER'S DJ NAME OPENS THE CARD (`check-np-time` D) ──
  ["NP1", [[PLAYER, WIRE + "\n", ""]],
    NP, "D: THE DJ'S NAME IS A CARD TRIGGER", "RED"],   // not wired
  ["NP2", [[PLAYER, WIRE, "      Roster._wireCardTrigger(nameEl, (refs.npAvatar && refs.npAvatar.dataset.avatarFor) || djId);"]],
    NP, "D: THE NEXT DJ'S NAME OPENS THEIR CARD, not the last one's", "RED"],   // wired to the DJ before
  ["NP3", [[PLAYER, WIRE + "\n", ""], [PLAYER, "      refs.npAvatar = H.avatarEl(djId, 22);\n", "      refs.npAvatar = H.avatarEl(djId, 22);\n      Roster._wireCardTrigger(refs.npAvatar, djId);\n"]],
    NP, "D: THE DJ'S NAME IS A CARD TRIGGER", "RED"],   // the avatar wired instead of the name
  ["NP4", [[PLAYER, REBUILD, "    if (true) {"]],
    NP, "D: A TICK KEEPS IT", "RED"],   // the name rebuilt on every tick
  // ── THE CONTROLS: edits that change nothing a person sees; each guard must stay green ──
  ["N1", [[HTML, TINT2, TINT2.replace("{ background: rgba(12,12,16,0.45); }", "{ background: rgba(12,12,16,0.45);  }")]], LOOK, "", "GREEN"],
  ["N2", [[PLAYER, FRAME_CLS, FRAME_CLS.replace("!!c.label", "Boolean(c.label)")]], COVER, "", "GREEN"],
  ["N3", [[QUEUE, ADDED, `        note.textContent = '';\n      } else {`]], REDRAW, "", "GREEN"],
  ["N4", [[HTML, TINT2, TINT2.replace(".prefs-body.prefs-locked .set-rule,", ".prefs-body.prefs-locked .set-rule, .prefs-body.prefs-locked .set-rule.set-value,")]], APPLY, "", "GREEN"],
  ["N5", [[PLAYER, WIRE, "      Roster._wireCardTrigger(nameEl, djId, H._rosterLevel(djId));"]], NP, "", "GREEN"],
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
      const h = J.open("mutate-j133-see-through:" + id, file);   // journalled BEFORE the write
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
