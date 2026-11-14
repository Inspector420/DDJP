// tools/probes/mutate-j150-tidy.js
// SUBJECT: J150 — the owner's tidying (`ddjp_702`): your rank's pill and the room's segment in your picture's menu, the top bar without
// either (`ui/roster.js`, `ui/shell.js`; `check-picture-menu`); the status lines' order and words (`features/matrixstatus.js`;
// `check-matrix-status`); the Gear panel's tabs and the queue tabs' order (`check-tab-rows`); ⓘ in Room settings (`ui/settings.js`;
// `check-settings-info`); People's count on its tab (`ui/panels.js`, `ui/screens.js`; `check-people-count`); the phone's Join / Leave
// (`ui/roster.js`; `check-phone-join`); the preview without 🖱, closed by a click outside (`ui/playlists.js`; `check-preview-controls`).
// One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay
// green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j150-tidy.js            every row
//   node tools/probes/mutate-j150-tidy.js PM1 PJ3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const RO = "ui/roster.js", SH = "ui/shell.js", ST = "ui/settings.js", PA = "ui/panels.js", SC = "ui/screens.js", PL = "ui/playlists.js";
const MS = "features/matrixstatus.js", HTML = "index.html";
const PM = "check-picture-menu", MX = "check-matrix-status", TR = "check-tab-rows", SI = "check-settings-info", PT = "check-people-count";
const PJ = "check-phone-join", PV = "check-preview-controls";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: the picture menu and the top bar ──
  ["PM1", [[RO, "    try { level = Room.getMyAuthorityLevel ? Room.getMyAuthorityLevel() : Room.getMyRank(); } catch (e) { level = 0; }", "    try { level = Room.getMyRank(); } catch (e) { level = 0; }"]],
    PM, "P: THE RANK'S OWN NAME, OF THE AUTHORITY LEVEL", "RED"],
  ["PM2", [[RO, "  const RANK_FILL = 0.16, RANK_EDGE = 0.55;", "  const RANK_FILL = 0.55, RANK_EDGE = 0.55;"]],
    PM, "P: IN THE RANK'S CHAT COLOUR", "RED"],
  ["PM3", [[RO, "      _drawMenuRank();   // a rank change tells the status piece too: the pill follows it\n", ""]],
    PM, "P: A RANK CHANGE WHILE IT IS OPEN", "RED"],
  ["PM4", [[RO, "    const seg = rec.room ? _roomSegment() : null;", "    const seg = null;"]],
    PM, "O: YOUR ROW, THE ROOM'S SEGMENT", "RED"],
  ["PM5", [[RO, "\"⧉\", () => cur.spaceId || \"\", \"copy-btn icon-only st-copy st-room-copy\"", "\"⧉\", () => Room.getMyId() || \"\", \"copy-btn icon-only st-copy st-room-copy\""]],
    PM, "R: CLICKED, IT COPIES THE ROOM'S ID", "RED"],
  ["PM6", [[RO, "    const room = !!(opts && opts.room === true);", "    const room = true;"]],
    PM, "L: ON THE ROOM LIST", "RED"],
  ["PM7", [[SH, "    const myIdentity = el(\"div\", { class: \"my-identity\" }, [refs.myAvatarSlot, refs.avatarNote]);", "    const myIdentity = el(\"div\", { class: \"my-identity\" }, [refs.myAvatarSlot, refs.avatarNote, el(\"span\", { class: \"rank-badge\", text: \"Owner\" })]);"]],
    PM, "T: NO RANK PILL IN THE TOP BAR", "RED"],
  ["PM8", [[SH, "    const titleGroup = el(\"div\", { class: \"title-group\" }, [refs.roomTitle]);", "    const titleGroup = el(\"div\", { class: \"title-group\" }, [refs.roomTitle, copyButton(\"\\u29C9\", () => room.spaceId || \"\", \"copy-btn copy-id-btn icon-only\", \"Copy room ID\")]);"]],
    PM, "T: NO COPY BUTTON IN IT", "RED"],
  ["PM9", [[HTML, "border: 1px solid transparent; border-radius: 999px; font-size: 10.5px;", "border: 1px solid transparent; border-radius: 3px; font-size: 10.5px;"]],
    PM, "P: A PILL", "RED"],
  // ── JOB 2: the status lines' order and words ──
  ["MS1", [[MS, "key: \"actions\", label: \"Actions & Chat\",", "key: \"actions\", label: \"Room Actions & Chat\","]],
    MX, "T: THE ONE TABLE", "RED"],
  ["MS2", [[MS, ": { state: \"In specs\", tone: \"ok\", text: \"In specs\" };", ": { state: \"OK\", tone: \"ok\", text: \"OK\" };"]],
    MX, "R: in a room, in step", "RED"],
  ["MS3", [[MS, "st.ring ? { state: \"Out of specs\", tone: \"bad\", text: \"Out of specs\" }", "st.ring ? { state: \"Out of spec\", tone: \"bad\", text: \"Out of spec\" }"]],
    MX, "R: where the ring rings today", "RED"],
  // ── JOBS 3 and 5: the Gear panel's tabs; the queue tabs' order ──
  ["TR1", [[SH, "    refs.subtabLogs = el(\"button\", { class: \"tab subtab\", text: \"Logs\" });", "    refs.subtabLogs = el(\"button\", { class: \"subtab\", text: \"Logs\" });"]],
    TR, "G: LOGS, FEED AND SETTINGS WEAR THE MAIN TABS' OWN RULE", "RED"],
  ["TR2", [[HTML, "    .gear-panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }", "    .gear-panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }\n    .gear-panel .subtab { font-size: 12px; padding: 4px 12px; }"]],
    TR, "G: THE SAME SIZE, PADDING AND LOOK", "RED"],
  ["TR3", [[SH, "        copyButton(\"Copy log\", () => Panels._logText(), \"copy-btn logs-copy\",", "        copyButton(\"Copy log\", () => Panels._logText(), \"copy-btn logs-copy tab\","]],
    TR, "G: THE LOG TOOLS STAY SMALL", "RED"],
  ["QT1", [[SH, "[refs.tabRoom, refs.tabHistory, refs.tabMine, refs.tabPlaylists]", "[refs.tabRoom, refs.tabMine, refs.tabHistory, refs.tabPlaylists]"]],
    TR, "Q: WIDE", "RED"],
  // ── JOB 4: ⓘ in Room settings ──
  ["SI1", [[ST, "{ class: \"set-more set-info\", type: \"button\", text: \"i\",", "{ class: \"set-more set-info\", type: \"button\", text: open ? \"Less\" : \"More\","]],
    SI, "I: EACH IS AN ⓘ", "RED"],
  ["SI2", [[ST, "    if (title && holder) {", "    if (false) {"]],
    SI, "P: EVERY ⓘ COMES RIGHT AFTER ITS ROW'S TITLE", "RED"],
  ["SI3", [[ST, "      if (text) after(row, text, holder);               // the explanation under the title", "      if (text) row.appendChild(text);"]],
    SI, "UNDER THE TITLE", "RED"],
  ["SI4", [[ST, "    btn.onclick = (e) => { if (e && e.preventDefault) e.preventDefault(); _moreOpen[key] = !_moreOpen[key]; renderSettings(); };", "    btn.onclick = (e) => { _moreOpen[key] = !_moreOpen[key]; renderSettings(); };"]],
    SI, "T: in a check row's label", "RED"],
  ["SI5", [[HTML, "width: 16px; height: 16px; padding: 0; border: 1px solid currentColor; border-radius: 50%;", "width: 16px; height: 16px; padding: 0; border: 1px solid currentColor; border-radius: 4px;"]],
    SI, "L: ABOUT 16 PX, ROUND", "RED"],
  // ── JOB 6: People's count ──
  ["PT1", [[PA, "(count > PEOPLE_TAB_CAP ? PEOPLE_TAB_CAP + \"+\" : String(Math.floor(count)))", "String(Math.floor(count))"]],
    PT, "W: THEN \"People (99+)\"", "RED"],
  ["PT2", [[SC, "    else Panels.labelPeopleTab();\n", ""]],
    PT, "E: SOMETHING REACHES THE FOLD WITH CHAT SHOWN", "RED"],
  ["PT3", [[PA, "    _whileVisible(\"people\", _peopleTabLive, _peopleTick, PEOPLE_REFRESH_MS);", "    _whileVisible(\"people\", _peopleVisible, _peopleTick, PEOPLE_REFRESH_MS);"]],
    PT, "K: TIME PASSES WITH CHAT SHOWN", "RED"],
  ["PT4", [[PA, "    try { return !!(refs.tabPeople && typeof Room !== \"undefined\" && Room.getCurrent && Room.getCurrent()); } catch (e) { return false; }", "    try { return !!refs.tabPeople; } catch (e) { return false; }"]],
    PT, "K: NO ROOM OPEN", "RED"],
  // ── JOB 7: the phone's Join / Leave ──
  ["PJ1", [[RO, "    if (H.layoutMode && H.layoutMode() === \"phone\") _placePhoneJoin(active); else _fitJoinLabel(active);", "    _fitJoinLabel(active);"]],
    PJ, "U: AT 390 PX, UNDER", "RED"],
  ["PJ2", [[RO, "    btn.textContent = _LEAVE_LADDER[0];\n    if (lock) lock.style.display = \"\";\n", ""]],
    PJ, "J: AT 450 PX", "RED"],
  ["PJ3", [[RO, "    row.classList.add(\"pc-measure\");\n", ""]],
    PJ, "U: AT 390 PX, UNDER", "RED"],
  ["PJ4", [[RO, "    row.classList.remove(\"pc-wrap\", \"pc-under\");   // measured on one line, whatever the last placing was", "    row.classList.remove(\"pc-wrap\");"]],
    PJ, "J: A SECOND AND THIRD PLACING", "RED"],
  ["PJ5", [[RO, "    if (lock) lock.style.display = lockShown;\n", ""]],
    PJ, "P: AND JOIN → LEAVE RELOCKS THE LOCK", "RED"],
  ["PJ6", [[HTML, "    .playback-controls.pc-under .join-group { order: 2; flex: 0 0 100%; justify-content: center; }", "    .playback-controls.pc-under .join-group { order: 2; flex: 0 0 100%; justify-content: center; }\n    .playback-controls.pc-under .volume-slider { flex: 1 1 auto; width: auto; }"]],
    PJ, "C: THE SLIDER HAS NO RULE OF ITS OWN UNDER", "RED"],
  ["PJ7", [[HTML, "    .playback-controls.pc-under .join-group { order: 2; flex: 0 0 100%; justify-content: center; }", "    .playback-controls.pc-under .join-group { order: 2; flex: 0 0 100%; justify-content: flex-start; }"]],
    PJ, "C: THE BUTTON AND ITS LOCK CENTRED", "RED"],
  ["PJ8", [[RO, "    if (row && row.classList) row.classList.remove(\"pc-under\");   // a phone's placing (`_placePhoneJoin`) is not this layout's\n", ""]],
    PJ, "K: switched to wide", "RED"],
  // ── JOB 8: the preview ──
  ["PV1", [[PL, "      if (!outside) return;", "      if (true) return;"]],
    PV, "O: A CLICK OUTSIDE THE CARD CLOSES IT", "RED"],
  ["PV2", [[PL, "      const outside = !!e && e.target === overlay && pressedOutside;", "      const outside = !!e && e.target === overlay;"]],
    PV, "O: A DRAG OF THE TIMELINE RELEASED OUTSIDE", "RED"],
  ["PV3", [[PL, "      if (e.stopPropagation) e.stopPropagation();\n      _closePreview();", "      _closePreview();"]],
    PV, "O: AND THAT CLICK DOES NOTHING ELSE", "RED"],
  ["PV4", [[PL, "[pv.playBtn, pv.muteBtn, pv.vol, pv.times, pv.reloadBtn]);", "[pv.playBtn, pv.muteBtn, pv.vol, pv.times, pv.reloadBtn, H.el(\"button\", { class: \"reset-btn np-tool pv-block\", text: \"\\uD83D\\uDDB1\" })]);"]],
    PV, "A: THE LINE UNDER THE BAR", "RED"],
  // ── CONTROLS: nothing that matters changes ──
  ["G1", [[RO, "  // YOUR RANK AS A PILL (`ddjp_702`;", "  // YOUR RANK, AS A PILL (`ddjp_702`;"]],
    PM, "", "GREEN"],
  ["G2", [[HTML, "    .st-rank-line { margin-top: 4px; line-height: 0; }", "    .st-rank-line { margin-top: 4px;  line-height: 0; }"]],
    PM, "", "GREEN"],
  ["G3", [[ST, "title: open ? \"Hide what this is\" : \"What this is\" });", "title: open ? \"Hide what this setting is\" : \"What this setting is\" });"]],
    SI, "", "GREEN"],
  ["G4", [[PA, "  const PEOPLE_TAB_CAP = 99;", "  const PEOPLE_TAB_CAP = 99;   // the tab's cap"]],
    PT, "", "GREEN"],
  ["G5", [[RO, "    const lockShown = lock ? lock.style.display : null;", "    const lockShown = lock ? lock.style.display : null;   // put back after the measure"]],
    PJ, "", "GREEN"],
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
      const h = J.open("mutate-j150-tidy:" + id, file);   // journalled BEFORE the write
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
