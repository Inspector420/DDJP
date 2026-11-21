// tools/probes/mutate-j136-dm-width.js
// SUBJECT: J136 — the owner's two requests since `ddjp_680` (`ddjp_681`): the room's DM panel as wide as the Chat tab's box and
// People's rows (the sheet's `.dm > .dm-box`, its side padding gone and its top kept; the lobby's framed Messages box untouched) —
// `check-dm-convo` PART W; and YouTube's own bar back in the preview (`ui/playlists.js` `controls: 1`) — held by
// `check-preview-controls` A and broken by `mutate-j135-settings-preview` PC4, re-aimed at J136 (it held `controls: 0`), so it is
// not repeated here. One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that
// matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j136-dm-width.js            every row
//   node tools/probes/mutate-j136-dm-width.js DW1 DW3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HTML = "index.html";
const DMC = "check-dm-convo";
// The room's DM panel (`index.html`).
const SIDE = "    .dm > .dm-box { padding: 8px 0; }";
const BOX = "    .dm-box { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; }";
const CONVO = "    .dm-box.dm-convo { overflow: hidden; }";
const SEARCH = "    .dm-search { width: 100%; box-sizing: border-box; margin: 0 0 6px;";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["DW1", [[HTML, SIDE, "    .dm > .dm-box { padding: 8px; }"]],
    DMC, "W: THE DM LIST'S HEADING, SEARCH BOX AND ROWS SIT AS FAR IN AS THE CHAT TAB'S BOX AND PEOPLE'S ROWS", "RED"],   // 680's 8 px back on each side
  ["DW2", [[HTML, SIDE + "\n", ""]],
    DMC, "W: THE DM LIST'S HEADING, SEARCH BOX AND ROWS SIT AS FAR IN AS THE CHAT TAB'S BOX AND PEOPLE'S ROWS", "RED"],   // the rule gone: `.dm-box`'s 8 px again
  ["DW3", [[HTML, SIDE, "    .dm > .dm-box { padding: 0; }"]],
    DMC, "W: THE BOX LOSES ITS SIDE PADDING AND KEEPS ITS TOP 8 PX", "RED"],   // the top padding gone too: "Direct messages" 8 px nearer the tabs
  ["DW4", [[HTML, SIDE, "    .dm-box.dm-box { padding: 8px 0; }"]],
    DMC, "W: THE LOBBY'S MESSAGES BOX KEEPS ITS 8 PX ON EVERY SIDE", "RED"],   // widened to every DM box: the lobby's rows touch its frame
  ["DW5", [[HTML, CONVO, "    .dm-box.dm-convo { overflow: hidden; padding: 8px; }"]],
    DMC, "W: AN OPEN CONVERSATION'S HEAD, MESSAGES BOX AND COMPOSER SIT AS FAR IN AS THE CHAT TAB'S BOX AND COMPOSER", "RED"],   // the list wide, an open conversation narrow again
  ["DW6", [[HTML, SEARCH, SEARCH.replace("margin: 0 0 6px;", "margin: 0 8px 6px;")]],
    DMC, "W: THE DM LIST'S HEADING, SEARCH BOX AND ROWS SIT AS FAR IN AS THE CHAT TAB'S BOX AND PEOPLE'S ROWS", "RED"],   // the search box alone narrower
  ["DW7", [[HTML, BOX, BOX.replace("padding: 8px; }", "padding: 8px; margin: 0 4px; }")]],
    DMC, "W: THE DM LIST'S HEADING, SEARCH BOX AND ROWS SIT AS FAR IN AS THE CHAT TAB'S BOX AND PEOPLE'S ROWS", "RED"],   // the box itself pushed in by a margin
  // ── THE GATE, BROKEN ON PURPOSE: a panel that draws nothing to measure must be refused, never read as "as wide" ──
  ["DW8", [["ui/chat.js", "    for (const r of shown) list.appendChild(_dmRowEl(r, box));", "    for (const r of shown) void r;"]],
    DMC, "W PREMISE — the real main screen drew the Chat tab's box and composer, People's rows, and the DM list", "RED"],   // no conversations drawn
  ["DW9", [["ui/chat.js", `    box.appendChild(H.el("div", { class: "dm-head" }, [back, H.el("span", { class: "dm-title", text: H.shortName(who) })]));`, "    void back;"]],
    DMC, "F: APPLIED — the back button renders", "RED"],   // an open conversation with no head: PART F's premise says it first, the same
  // claim (the conversation's head drawn); every part opens the same conversation before W, so W's own premise cannot be reached alone
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[HTML, SIDE, "    .dm > .dm-box { padding: 8px 0px; }"]], DMC, "", "GREEN"],   // the same padding, written with a unit
  ["G2", [[HTML, SIDE, "    .dm > .dm-box { padding-top: 8px; padding-bottom: 8px; padding-left: 0; padding-right: 0; }"]], DMC, "", "GREEN"],   // the same, as longhands
  ["G3", [[HTML, SIDE, "    .dm > .dm-box { padding: 8px 0 8px 0; }"]], DMC, "", "GREEN"],   // the same, four values
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
      const h = J.open("mutate-j136-dm-width:" + id, file);   // journalled BEFORE the write
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
