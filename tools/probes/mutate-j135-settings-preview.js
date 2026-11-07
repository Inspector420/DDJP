// tools/probes/mutate-j135-settings-preview.js
// SUBJECT: J135 — the owner's five requests since `ddjp_679` (`ddjp_680`): room settings the same locked or unlocked in this
// device's settings' style (`ui/settings.js` `_choiceList` and the row builders; the sheet's disabled radio, the controls' greying
// and the rows under a switch) — `check-settings-apply` L, M and S; the Feed's head without the refused count (`ui/panels.js`
// `renderFeedPanel`) — `check-feed-tab` B, `check-owner-screens` B; the preview's second round (`ui/playlists.js`: the bar alone,
// play/pause, the times together, YouTube's bar off, the defaults, the card's width; `core/chatprefs.js`' `previewBlockChoice`)
// — `check-preview-controls` A–G, P, and `check-chat-prefs` J135; People's heading (the sheet's `.active-top`, `.active-box`) —
// `check-who-is-here` F; and the two fixes from 679 (`ui/playlists.js` `pointercancel`; `ui/player.js` `_personHasActed`) —
// `check-preview-controls` X and M. One row per way it could go wrong, each naming the failure it must cause; the controls
// change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j135-settings-preview.js            every row
//   node tools/probes/mutate-j135-settings-preview.js ST1 PC4    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HTML = "index.html", SET = "ui/settings.js", PL = "ui/playlists.js", PANELS = "ui/panels.js", PLAYER = "ui/player.js", PREFS = "core/chatprefs.js";
const APPLY = "check-settings-apply", FEED = "check-feed-tab", SCREENS = "check-owner-screens", PVC = "check-preview-controls", CPR = "check-chat-prefs", WHO = "check-who-is-here";
// Room settings (`ui/settings.js`, `index.html`).
const CHOICE = "  function _choiceList(key, options, current, onPick, editable) {\n";
const RADIO_OFF = "      r.disabled = !editable;\n";
const NUM_DIS = `    const input = H.el("input", { type: "number", class: "uq-input", value: String(cur) });\n    input.disabled = !editable;\n`;
const NUM_HEAD = "    const line = _rowHead(row, key, label, hint);\n    const input = H.el(\"input\", { type: \"number\", class: \"uq-input\", value: String(cur) });";
const DEL_DIS = "          del.disabled = !editable;\n";
const BG_DIS = `    input.disabled = !editable;\n    input.setAttribute("aria-label", "Background image link");`;
const DELEG_WORDS = `      : (owner ? "Nothing is shared. Only you can change these settings."`;
const MORE_BTN = `    const btn = H.el("button", { class: "set-more", type: "button", text: open ? "Less" : "More" });\n`;
const EDITABLE = "    const _editableFor = (key) => _maySetSetting(key) !== null && !H.settingsLocked();";
const NO_RULES = `        if (!draft.length) box.appendChild(H.el("div", { class: "set-value", text: "No skip rules" }));\n`;
const STAGE_GATE = "    if (H.settingsLocked() || _maySetSetting(key) === null) return false;\n    if (_staged.room !== _roomId()) _discardStaged();";
const RADIO_CSS = `    .settings-box .set-choices input[type="radio"]:disabled { appearance: none; -webkit-appearance: none; width: 13px; height: 13px;`;
const RADIO_ON = `    .settings-box .set-choices input[type="radio"]:disabled:checked { border-color: #5865F2;`;
const GREY = "    .set-num .uq-input:disabled, .delegation-row .rank-select:disabled { opacity: 0.55; cursor: default; }";
const DEPS = ", .prefs-body.prefs-locked .set-deps .set-row { background: rgba(12,12,16,0.45); }";
// The Feed (`ui/panels.js`).
const FEED_HEAD = `    if (f && f.truncated) parts.push("showing the newest " + FEED_TAB_LIMIT);\n`;
const FEED_JOIN = `    const head = parts.join(" \\u00b7 ");`;
// The preview (`ui/playlists.js`, `index.html`, `core/chatprefs.js`).
const TIMELINE = `    pv.timeline = H.el("div", { class: "preview-timeline" }, [pv.bar]);`;
const CONTROLS = `[pv.playBtn, pv.muteBtn, pv.vol, pv.times, pv.reloadBtn, pv.blockBtn]`;
const SLIDER_CSS = "    .preview-controls .volume-slider { flex: 0 1 100px; width: 100px; min-width: 0; }";
const VARS = "playerVars: { autoplay: 1, controls: 1, mute: 0, playsinline: 1, rel: 0 },";   // YouTube's bar back since J136
const PLAYING = `    const playing = (st === "playing" || st === "loading");`;
const LOADING_DIS = `    pv.playBtn.disabled = (st === "loading");`;
const FIRST_DIS = "    pv.playBtn.disabled = true;   // until the player is ready (`_pvDrawPlay`)";
const RESTART = `      else { if (st === "ended") pv.player.seekTo(0, true); pv.player.playVideo(); }`;
const BUFFERING = `    return (st === 1 || st === 3) ? "playing" : (st === 0 ? "ended" : "paused");`;
const EACH_FRAME = "    pv.raf = requestAnimationFrame(_pvTick);\n    _pvDrawPlay(pv);\n    if (pv.drag) return;";
const PLAY_TITLE = `pv.playBtn.setAttribute("title", playing ? "Pause" :`;
const BLOCK_READ = "  function previewBlocked() { return _st().previewBlockChoice !== false; }";
const HALF = "  const PV_DEFAULT_VOLUME = 50;";
const MIGRATE = "      _state.previewBlockChoice = (_state.previewBlocked === true) ? true : null;";
const DROP_OLD = "    delete _state.previewBlocked;\n";
const MOVED = "qb: st.previewBlockChoice });";
const CARD_W = `    card.style.width = (Math.round(fw) + addW) + "px";\n`;
const CARD_PROBE = `    card.style.width = Math.round(availW + addW) + "px";\n`;
const CANCEL_ADD = `      document.addEventListener("pointercancel", pv.onCancel);\n`;
const CANCEL_END = `      document.removeEventListener("pointercancel", pv.onCancel);\n    };\n    pv.bar.onpointerdown`;
const CANCEL_DRAG = "    pv.onCancel = () => {\n      if (!pv.drag) return;\n      pv.drag = false;\n";
// The main player (`ui/player.js`).
const GATE = "      if (_personHasActed()) rememberVolumeState();";
const ACTED = "    try { return !!(typeof navigator !== \"undefined\" && navigator.userActivation && navigator.userActivation.hasBeenActive); }";
// People (`index.html`).
const PEOPLE_FONT = ".active-top .active-head, .active-top .active-count { font-size: 14px; font-weight: 600;";
const PEOPLE_LINE = "    .active-top { display: flex; align-items: baseline; gap: 8px; height: 30px; box-sizing: border-box; padding: 7px 0; }";
const PEOPLE_FOOT = "    .active-box { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0 0; }";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── PART A: ROOM SETTINGS THE SAME LOCKED OR UNLOCKED (`check-settings-apply` L, M, S) ──
  ["ST1", [[SET, CHOICE, CHOICE + `    if (!editable) { const hit = options.find(([val]) => val === current); return H.el("div", { class: "set-value", text: hit ? hit[1] : "\\u2014" }); }\n`]],
    APPLY, "M: LOCKED, THE SAME CHOICE ROWS DRAW THEIR RADIO LISTS", "RED"],   // ddjp_483's words back in place of the list
  ["ST2", [[SET, RADIO_OFF, ""]],
    APPLY, "M: LOCKED, AND EVERY RADIO IS DISABLED", "RED"],   // a locked choice can still be changed
  ["ST3", [[SET, NUM_HEAD, NUM_HEAD.replace("    const input = H.el", `    if (!editable) { line.appendChild(H.el("div", { class: "set-value", text: String(cur) })); _rowMore(row, key, more); _box().appendChild(row); return; }\n    const input = H.el`)]],
    APPLY, "THE PANEL DRAWS EXACTLY THE CONTROLS IT DRAWS UNLOCKED", "RED"],   // a locked number a line of words again: the row moves on unlock
  ["ST4", [[SET, NUM_DIS, NUM_DIS.replace("    input.disabled = !editable;\n", "")]],
    APPLY, "LOCKED, EVERY CONTROL OF A SETTING IS DISABLED", "RED"],   // a locked number box can be typed into
  ["ST5", [[SET, DEL_DIS, ""]],
    APPLY, "LOCKED, EVERY CONTROL OF A SETTING IS DISABLED", "RED"],   // a locked skip rule's Remove works: caught by S's sweep of every control, the same claim
  ["ST6", [[SET, BG_DIS, `    input.setAttribute("aria-label", "Background image link");`]],
    APPLY, "L: LOCKED, NO BACKGROUND SET", "RED"],   // the background's box takes typing while locked
  ["ST7", [[SET, DELEG_WORDS, DELEG_WORDS.replace("(owner ?", "(editable ?")]],
    APPLY, "S: THE DELEGATION LINE IS THE OWNER'S OWN, LOCKED AS UNLOCKED", "RED"],   // the owner's line changes with the lock: the row moves
  ["ST8", [[SET, MORE_BTN, MORE_BTN + "    btn.disabled = H.settingsLocked();\n"]],
    APPLY, "R6: WHILE LOCKED, AS BEFORE — More opens", "RED"],   // More greyed with the rest: R6 says it first, the same claim
  ["ST9", [[SET, EDITABLE, "    const _editableFor = (key) => !H.settingsLocked();"]],
    APPLY, "M: NOT YOURS TO CHANGE, AND EVERY RADIO IS DISABLED", "RED"],   // unlocked, every row live for anyone: M's radios say it first, the same claim
  ["ST9b", [[SET, NUM_DIS, NUM_DIS.replace("    input.disabled = !editable;\n", "    input.disabled = H.settingsLocked();\n")]],
    APPLY, "S: SOMEONE WITH NO RIGHTS SEES THE SAME CONTROLS AS THE OWNER, EVERY ONE DISABLED, EVEN UNLOCKED", "RED"],   // the target alone: radios right, a number box live for someone with no right
  ["ST10", [[HTML, RADIO_CSS, RADIO_CSS.replace(" appearance: none; -webkit-appearance: none;", "")]],
    APPLY, "S: A DISABLED RADIO IN ROOM SETTINGS IS DRAWN BY THE SHEET", "RED"],   // the browser's grey again: the choice unreadable
  ["ST11", [[HTML, RADIO_ON, RADIO_ON.replace("border-color: #5865F2;", "border-color: #6b6b72;")]],
    APPLY, "S: AND THE CHOSEN ONE IN THE ACCENT", "RED"],   // the chosen ring as grey as the rest
  ["ST12", [[HTML, RADIO_CSS, `    .chat-settings-box .set-choices input[type="radio"]:disabled { appearance: none; }\n` + RADIO_CSS]],
    APPLY, "S: THIS DEVICE'S SETTINGS KEEP THEIR LOOK", "RED"],   // this device's radios redrawn too
  ["ST13", [[HTML, GREY, GREY.replace(".set-num .uq-input:disabled", ".settings-box .uq-input:disabled")]],
    APPLY, "R6: ONE RULE FOR BOTH PANELS, THE CHAT BOX'S", "RED"],   // the greying named on the panel: a panel dimmed; R6 says it first, the same claim
  ["ST13b", [[HTML, GREY, "   "]],
    APPLY, "S: THE GREYING FADES THE CONTROLS ONLY", "RED"],   // the target alone: a locked number box and the delegation choice not greyed at all
  ["ST14", [[HTML, DEPS, " { background: rgba(12,12,16,0.45); }"]],
    APPLY, "S: IN A ROOM WITH A BOT, THE ROWS UNDER A SWITCH TAKE THE CHAT BOX'S DARKNESS WHILE LOCKED", "RED"],   // the two solid rows back
  ["ST15", [[SET, NO_RULES, ""]],
    APPLY, "L: LOCKED, NO SKIP RULES", "RED"],   // an empty list says nothing
  ["ST16", [[SET, STAGE_GATE, STAGE_GATE.replace("H.settingsLocked() || ", "")]],
    APPLY, "S: AND UNDERNEATH, A GREYED CONTROL STAGES NOTHING", "RED"],   // the stage gate ignores the lock (green at first: the fixture's redraw wiped the stage)
  // ── PART B: THE FEED'S HEAD (`check-feed-tab` B, `check-owner-screens` B) ──
  ["FD1", [[PANELS, FEED_HEAD, FEED_HEAD + `    if (f && f.refused > 0) parts.push(f.refused + (f.refused === 1 ? " refused act" : " refused acts") + ", shown in red");\n`]],
    FEED, "B: AND THE HEAD NO LONGER COUNTS IT", "RED"],   // the refused count back in the head
  ["FD2", [[PANELS, FEED_HEAD, FEED_HEAD + `    if (f && f.refused > 0) parts.push(f.refused + (f.refused === 1 ? " refused act" : " refused acts") + ", shown in red");\n`]],
    SCREENS, "B: A REFUSED ACT WITH NOTHING LEFT OUT LEAVES THE HEAD EMPTY", "RED"],   // the same, on the owner's screen
  ["FD3", [[PANELS, FEED_HEAD, ""]],
    SCREENS, "B: WHAT IS LEFT OUT IS STILL SAID", "RED"],   // the newest N no longer said either
  // ── PART C: THE PREVIEW'S SECOND ROUND (`check-preview-controls` A–G, P; `check-chat-prefs` J135) ──
  ["PC1", [[PL, TIMELINE, TIMELINE.replace("[pv.bar]", `[pv.bar, H.el("span", { class: "preview-time pv-dur", text: PV_NO_LENGTH })]`)]],
    PVC, "A: THE TIMELINE IS THE BAR ALONE, THE FULL WIDTH", "RED"],   // the times back at the bar's end
  ["PC2", [[PL, CONTROLS, "[pv.playBtn, pv.times, pv.muteBtn, pv.vol, pv.reloadBtn, pv.blockBtn]"]],
    PVC, "A: THE LINE UNDER THE BAR", "RED"],   // the times out of place
  ["PC3", [[HTML, SLIDER_CSS, "    .preview-controls .volume-slider { flex: 1 1 100px; width: auto; min-width: 56px; }"]],
    PVC, "A: THE SLIDER AT THE MAIN PLAYER'S 100 PX", "RED"],   // the slider stretched to fill the line again
  // PC4 CHANGED ON PURPOSE at J136 (`ddjp_681`): it put YouTube's bar back and had to fail at "YouTube's own bar is off" (J135, "we
  // dont need youtube's bar"). The owner put the bar back ("1 yes": with 🖱 off he could not change the quality), so it now takes
  // the bar away again and must fail at the row that holds it back. It is J136's break row for that part (`mutate-j136-dm-width`).
  ["PC4", [[PL, VARS, VARS.replace("controls: 1", "controls: 0")]],
    PVC, "A: YOUTUBE'S OWN BAR IS BACK", "RED"],   // YouTube's bar gone again: with 🖱 off, no quality, captions or fullscreen
  ["PC5", [[PL, PLAYING, "    const playing = true;"]],
    PVC, "P: PRESSED, THE PREVIEW PAUSES — and shows ▶", "RED"],   // ❚❚ for ever
  ["PC6", [[PL, LOADING_DIS, "    pv.playBtn.disabled = false;"], [PL, FIRST_DIS, "    pv.playBtn.disabled = false;"]],
    PVC, "P: WHILE YOUTUBE IS LOADING — ❚❚, GREYED", "RED"],   // a press with nothing to pause
  ["PC7", [[PL, RESTART, "      else { pv.player.playVideo(); }"]],
    PVC, "P: ▶ AT THE END PLAYS FROM THE START", "RED"],   // ▶ at the end plays nothing
  ["PC8", [[PL, BUFFERING, BUFFERING.replace("(st === 1 || st === 3)", "(st === 1)")]],
    PVC, "P: buffering (after a seek, say) counts as playing", "RED"],   // ▶ flickers in at every seek
  ["PC9", [[PL, EACH_FRAME, "    pv.raf = requestAnimationFrame(_pvTick);\n    if (pv.drag) return;"]],
    PVC, "P: IT FOLLOWS THE PLAYER'S OWN STATE", "RED"],   // drawn only on a press: paused another way, it still says ❚❚
  ["PC10", [[PREFS, BLOCK_READ, "  function previewBlocked() { return _st().previewBlockChoice === true; }"]],
    PVC, "D: 🖱 IS LIT BEFORE ANYTHING IS CHOSEN", "RED"],   // the block off by default again
  ["PC11", [[PL, HALF, "  const PV_DEFAULT_VOLUME = 100;"]],
    PVC, "E: BEFORE ANYTHING IS SAVED — at HALF volume", "RED"],   // full, not half
  ["PC12", [[PREFS, MIGRATE, "      _state.previewBlockChoice = (_state.previewBlocked === true);"]],
    PVC, "E: A DEVICE THAT RAN 679 AND NEVER TOUCHED THE PREVIEW GETS THE SAME", "RED"],   // 679's unchosen false taken as a choice
  ["PC13", [[PL, CARD_W, ""]],
    PVC, "G: AND WHERE THE HEIGHT DECIDES (a short column), THE CARD IS STILL ITS NARROWER VIDEO'S WIDTH", "RED"],   // the card left at the probe's width: wider than its video
  ["PC13b", [[PL, CARD_W, ""], [PL, CARD_PROBE, ""]],
    PVC, "G: THE CARD IS SET TO ITS VIDEO'S WIDTH", "RED"],   // the card left to its widest line: a line wider than a phone's video
  ["CP1", [[PREFS, BLOCK_READ, "  function previewBlocked() { return _st().previewBlockChoice === true; }"]],
    CPR, "J135: a new device: on", "RED"],   // the default read as off
  ["CP2", [[PREFS, MIGRATE, "      _state.previewBlockChoice = (_state.previewBlocked === true);"]],
    CPR, "J135: A 679 DEVICE THAT NEVER PRESSED 🖱 GETS THE NEW DEFAULT", "RED"],   // 679's false a choice
  ["CP3", [[PREFS, DROP_OLD, ""]],
    CPR, "J135: THE OLD KEY IS GONE FROM WHAT IS SAVED", "RED"],   // the old key carried along for ever
  ["CP4", [[PREFS, MOVED, "qb: st.previewBlocked });"]],
    CPR, "J135: AND A CHOICE OF OFF MADE NOW SURVIVES A RELOAD", "RED"],   // a choice not in the comparison: never saved
  // ── PART E: THE TWO FIXES FROM 679 (`check-preview-controls` X and M) ──
  ["X1", [[PL, CANCEL_ADD, ""]],
    PVC, "X: and its listeners are gone", "RED"],   // 679's own: no `pointercancel`, the drag stays on
  ["X2", [[PL, CANCEL_END, CANCEL_END.replace("    };\n    pv.bar.onpointerdown", "      try { pv.player.seekTo(pv.dragT, true); } catch (e) {}\n    };\n    pv.bar.onpointerdown")]],
    PVC, "X: A DRAG THE BROWSER CANCELS ENDS WITH NO SEEK", "RED"],   // a cancelled drag seeks where it was left
  ["X3", [[PL, CANCEL_DRAG, "    pv.onCancel = () => {\n      if (!pv.drag) return;\n"]],
    PVC, "X: AND THE TIMELINE RUNS AGAIN", "RED"],   // the drag left on: the timeline frozen
  ["MS1", [[PLAYER, GATE, "      rememberVolumeState();"]],
    PVC, "M: A SILENCE THE BROWSER STARTED, ON A PAGE NOBODY HAS TOUCHED, IS SHOWN AND NEVER SAVED", "RED"],   // the browser's silence saved as the person's mute
  ["MS2", [[PLAYER, ACTED, "    try { return !(typeof navigator !== \"undefined\" && navigator.userActivation && !navigator.userActivation.hasBeenActive); }"]],
    PVC, "M: and with no activation to read (an older browser), nothing adopted is saved", "RED"],   // no API read as a person having acted
  // ── PART D: PEOPLE'S HEADING (`check-who-is-here` F) ──
  ["PD1", [[HTML, PEOPLE_FONT, PEOPLE_FONT.replace("font-size: 14px; font-weight: 600;", "font-size: 16px; font-weight: 700;")]],
    WHO, "IN THE DMs HEADING'S SIZE AND WEIGHT", "RED"],   // 16 px at 700 again
  ["PD2", [[HTML, PEOPLE_LINE, "    .active-top { display: flex; align-items: baseline; gap: 8px; }"]],
    WHO, "F: PEOPLE'S HEADING LINE IS THE DMs HEADING'S HEIGHT", "RED"],   // the words back 16 px under the tabs
  ["PD3", [[HTML, PEOPLE_FOOT, PEOPLE_FOOT.replace("margin: 8px 0 0 0;", "margin: 8px 0 10px 0;")]],
    WHO, "F: PEOPLE'S HEADING LINE IS THE DMs HEADING'S HEIGHT", "RED"],   // 10 px added under it: the first person 25 px below the words
  // ── THE CONTROLS: edits that change nothing a person sees; each guard must stay green ──
  ["G1", [[SET, RADIO_OFF, "      r.disabled = editable !== true;\n"]],
    APPLY, "", "GREEN"],   // the same disabled radios, written another way
  ["G2", [[HTML, RADIO_CSS, RADIO_CSS.replace("width: 13px; height: 13px;", "height: 13px; width: 13px;")]],
    APPLY, "", "GREEN"],   // the radio's size declared in the other order
  ["G3", [[PANELS, FEED_JOIN, `    const head = parts.join(" · ");`]],
    SCREENS, "", "GREEN"],   // the join written as the character itself
  ["G4", [[PL, PLAY_TITLE, `pv.playBtn.setAttribute("title", playing ? "Pause the song" :`]],
    PVC, "", "GREEN"],   // the pause button's hint reworded
  ["G5", [[PREFS, BLOCK_READ, "  function previewBlocked() { const c = _st().previewBlockChoice; return c !== false; }"]],
    CPR, "", "GREEN"],   // the same reading, written another way
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
      const h = J.open("mutate-j135-settings-preview:" + id, file);   // journalled BEFORE the write
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
