// tools/probes/mutate-j146-fixes-698.js
// SUBJECT: J146 — fixes from 697, the People invite on top, menus that follow the window (`ddjp_698`): a paced send's one-minute
// answer limit (`backends/backend1/matrixbridge.js` `_answerLimited` in `_paced` and `sendMembership`, the join step's read-back,
// the rank loop's words; `features/room.js` the card's words), held by `check-matrix-status` A and `check-rank-change` B; the calm
// minute from the wait's end (`features/matrixstatus.js` `lineFrom`), `check-matrix-status` O; the waits Chromium alone saw
// (`ui/roster.js` the card's rank line and the upgrade bar, `ui/base.js` `slowCountdown`, `app.js`), `check-matrix-status` V; the
// one shared way a top-bar menu stays with its button (`ui/base.js` `stickToButton`, `placeMenus`; `ui/roster.js`, `ui/shell.js`),
// `check-matrix-status` F and `check-view-menu`; People's invite on top (`ui/shell.js`, `index.html`), `check-people-invite`. One
// row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay
// green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j146-fixes-698.js            every row
//   node tools/probes/mutate-j146-fixes-698.js A1 F3      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const MS = "features/matrixstatus.js";
const ROOM = "features/room.js";
const RO = "ui/roster.js";
const SH = "ui/shell.js";
const BA = "ui/base.js";
const APP = "app.js";
const PAGE = "index.html";
const G = "check-matrix-status";
const RC = "check-rank-change";
const VM = "check-view-menu";
const PI = "check-people-invite";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: a paced send that never answers does not hold the rest ──
  ["A1", [[MB, "      try { const r = await _answerLimited(fn(), \"a paced send (\" + kind + \")\"); _sendPace.landed(kind); return r; }", "      try { const r = await fn(); _sendPace.landed(kind); return r; }"]],
    G, "A: AND THE CHAIN MOVES ON", "RED"],   // the chain held for good by one send
  ["A2", [[MB, "      const r = await _answerLimited(kind === \"leave\" ? client.leave(roomId) : client.joinRoom(roomId), \"the \" + kind + \" of \" + _short(roomId));", "      const r = await (kind === \"leave\" ? client.leave(roomId) : client.joinRoom(roomId));"]],
    G, "A: AT THE DOOR", "RED"],   // the door held for good by one join or leave
  ["A3", [[MB, "          if (e && e.noAnswer) {\n", "          if (false) {\n"]],
    G, "is not sent its leave again", "RED"],   // a leave with no answer sent again blindly
  ["A4", [[MB, "            if (leaving ? (now !== \"join\" && now !== \"invite\") : now === \"join\") {", "            if (false) {"]],
    G, "A: ONE THIS CLIENT ALREADY SHOWS LEFT IS READ BACK AS LEFT", "RED"],   // what this client already shows not read back
  ["A5", [[MB, "        Logger.warn(\"MatrixBridge: no answer from Matrix within a minute to \" + what + \" — what waited behind it goes on; a late answer is read back, never sent again\");\n", ""]],
    G, "A: and it is logged", "RED"],   // a limit reached in silence
  ["A6", [[ROOM, "(f.label || f.key || \"a step\") + (f.error === \"No answer from Matrix\" ? \" (No answer from Matrix)\" : \"\")", "(f.label || f.key || \"a step\")"]],
    RC, "A REQUEST STILL IN FLIGHT AT THE MINUTE", "RED"],   // the card names the step but not why
  ["A7", [[MB, "      if (r.cut) { s.error = run.stopped ? \"in flight when stopped\" : NO_ANSWER; return; }", "      if (r.cut) { s.error = \"in flight at the limit\"; return; }"]],
    RC, "and the log says it had no answer from Matrix", "RED"],   // the rank change's own words, not the paced sends'
  // ── JOB 2: the calm minute counts from the wait's end ──
  ["S1", [[MS, "    const ago = now - Math.max(k.pushedAt, k.until || 0);", "    const ago = now - k.pushedAt;"]],
    G, "O: A WAIT OVER A MINUTE IS FOLLOWED BY A CALM MINUTE", "RED"],   // 697's rule: a long wait goes straight to OK
  // ── JOB 4: the waits Chromium alone saw ──
  ["V1", [[RO, "          waitLine(H.slowWait ? H.slowWait(\"ranks\") : null);\n        }", "        }"]],
    G, "V: THE CARD'S RANK LINE SAYS ITS WAIT", "RED"],   // the card's change freezes without saying why
  ["V2", [[RO, "      const waitLine = (sw) => { if (!sw) return; noteSlot.appendChild(sw); if (noteSlot.classList) noteSlot.classList.add(\"uc-rank-waits\"); };", "      const waitLine = (sw) => { if (!sw) return; noteSlot.appendChild(sw); };"]],
    G, "V: THE CARD'S RANK LINE SAYS ITS WAIT", "RED"],   // squeezed beside the bar, not on its own line
  ["V3", [[RO, "            H.slowCountdown(\"upgrade-ratelimit\", lbl, waitUntil);", "            H.startCountdown(\"upgrade-ratelimit\", lbl, waitUntil, label || \"Retrying in \", \"\");"]],
    G, "V: THE UPGRADE BAR'S WAIT", "RED"],   // 696's words, grey
  ["V4", [[RO, "        H.clearCountdown(\"upgrade-ratelimit\");\n        if (lbl.classList) lbl.classList.remove(\"slow-wait\");", "        H.clearCountdown(\"upgrade-ratelimit\");"]],
    G, "V: and gone, its orange too, when the progress moves on", "RED"],   // progress drawn in the wait's orange
  ["V5", [[BA, "\"Waiting \" + n + \" s \\u2014 Matrix asked us to slow down.\" : \"Trying again\\u2026\";", "\"Waiting \" + n + \" s \\u2014 Matrix asked us to slow down.\" : \"now\";"]],
    G, "V: and \"Trying again…\" when its wait is over", "RED"],   // a countdown ending in "now"
  ["V6", [[APP, "          Interface.slowCountdown(\"create-ratelimit\", step, waitUntil);", "          Interface.startCountdown(\"create-ratelimit\", step, waitUntil, label || \"Retrying in \", \"\");"]],
    G, "V: app.js's create step calls it", "RED"],   // making a room's wait in 696's words
  // ── JOB 6 (and JOB 4's menu inside the window): the one shared way a top-bar menu stays with its button ──
  ["F1", [[RO, "    _menu.stick = H.stickToButton(el, rec.slot);", "    _menu.stick = null;"]],   // re-anchored at `ddjp_699`: the one menu left takes no side
    G, "F: THE WINDOW NARROWS", "RED"],   // your picture's menu left where it opened (697)
  ["F2", [[BA, "    window.addEventListener(\"resize\", place);   // live while the window is dragged\n", ""]],
    G, "F: THE WINDOW NARROWS", "RED"],   // not placed again on resize
  ["F3", [[BA, "    if (live && typeof requestAnimationFrame === \"function\") frame = requestAnimationFrame(watch);   // and whatever else moves the button\n", ""]],
    G, "F: THE HEADER'S CONTENT MOVES THE PICTURE", "RED"],   // the owner's case: the button moved, the menu stayed
  // ── F3b retired at ddjp_699: ⊞ is gone; the same mutation is F3, on your picture's menu (`check-matrix-status` F).
  ["F4", [[BA, "      const left = Math.max(MENU_EDGE, Math.min(from, vw - MENU_EDGE - w));", "      const left = Math.min(from, vw - MENU_EDGE - w);"]],
    G, "F: KEPT 8 PX INSIDE THE WINDOW'S LEFT EDGE", "RED"],   // off the left of a phone's room list
  ["F5", [[BA, "      const left = Math.max(MENU_EDGE, Math.min(from, vw - MENU_EDGE - w));", "      const left = Math.max(MENU_EDGE, from);"]],
    G, "F: AND 8 PX INSIDE ITS RIGHT EDGE", "RED"],   // off the right
  ["F6", [[BA, "      if (window.removeEventListener) window.removeEventListener(\"resize\", place);\n", ""]],
    G, "F: CLOSED, IT IS LET GO", "RED"],   // a closed menu's listener left on the window
  // ── F7 retired at ddjp_699: ⊞ and its menu left the top bar (the layout is picked in your picture's menu).
  ["F8", [[BA, "  function placeMenus() { for (const s of Array.from(_sticks)) s.place(); }", "  function placeMenus() {}"]],
    VM, "G: THE HEADER'S FIT MOVES YOUR PICTURE", "RED"],   // the fit's hook reaching no menu (re-aimed at `ddjp_699`: your picture's menu)
  // ── JOB 5: People's invite on top, in the DM search row's look ──
  ["P1", [[SH, "      refs.activeBox,\n      el(\"div\", { class: \"invite-row\" }, [inviteInput, inviteBtn]),\n      refs.rosterBox\n", "      refs.activeBox,\n      refs.rosterBox,\n      el(\"div\", { class: \"invite-row\" }, [inviteInput, inviteBtn])\n"]],
    PI, "THE INVITE IS ABOVE THE PEOPLE", "RED"],   // back at the bottom (697)
  ["P4", [[SH, "      refs.activeBox,\n      el(\"div\", { class: \"invite-row\" }, [inviteInput, inviteBtn]),\n      refs.rosterBox\n", "      el(\"div\", { class: \"invite-row\" }, [inviteInput, inviteBtn]),\n      refs.activeBox,\n      refs.rosterBox\n"]],
    PI, "THE INVITE IS ABOVE THE PEOPLE", "RED"],   // above the heading: not the DM tab's shape
  ["P2", [[PAGE, "    .invite-row .invite-input { height: 28px; padding: 6px 8px; font-size: 12px; }\n", ""]],
    PI, "THE SAME TYPE AS THE DM SEARCH", "RED"],   // the old 30 px box in 13 px type
  ["P3", [[PAGE, "    .invite-row .invite-btn { height: 28px; font-size: 12px; }\n", ""]],
    PI, "the button as high as the box", "RED"],   // a 30 px button beside a 28 px box
  // ── Controls ──
  ["G1", [[BA, "  const MENU_GAP = 6;    // px between the button's bottom and the menu", "  const MENU_GAP = 6;    // px between the button's bottom and the menu (a control's edit)"]],
    G, "", "GREEN"],   // a comment
  ["G2", [[MB, "  const PACED_ANSWER_MS = 60000;", "  const PACED_ANSWER_MS = 60 * 1000;"]],
    G, "", "GREEN"],   // the same minute, written as a product
  ["G3", [[PAGE, "    .invite-row .invite-btn { height: 28px; font-size: 12px; }", "    .invite-row .invite-btn { font-size: 12px; height: 28px; }"]],
    PI, "", "GREEN"],   // the same rule, its declarations in another order
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
      const h = J.open("mutate-j146-fixes-698:" + id, file);   // journalled BEFORE the write
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
