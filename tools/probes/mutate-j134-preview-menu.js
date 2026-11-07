// tools/probes/mutate-j134-preview-menu.js
// SUBJECT: J134 — the owner's three requests since `ddjp_678` (`ddjp_679`): the song preview's own controls (`ui/playlists.js`
// `_openPreview`, `_positionPreview` and the `_pv…` functions; the sheet's `.preview-…` rules) and what is remembered of them
// (`core/chatprefs.js`' `preview…`) — `check-preview-controls` A–G; the main player's remembered sound (`ui/shell.js`
// `buildMainDom`, `ui/player.js` `rememberVolumeState` and `_pollYtVolume`; `core/chatprefs.js`' `player…`) —
// `check-preview-controls` M and `check-chat-prefs` J134; the player's line with no words when nothing plays (`ui/player.js`
// `renderNowPlaying`) — `check-np-time` E; and the view menu reaching right and staying on screen (`ui/shell.js`
// `_placeLayoutMenu`, `_fitHeader`, `_buildLayoutSelector`; the sheet's `.layout-menu`) — `check-view-menu`. One row per way it
// could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j134-preview-menu.js            every row
//   node tools/probes/mutate-j134-preview-menu.js PV1 MN3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HTML = "index.html", PL = "ui/playlists.js", PLAYER = "ui/player.js", SHELL = "ui/shell.js", QUEUE = "ui/queue.js", PREFS = "core/chatprefs.js";
const PVC = "check-preview-controls", CPR = "check-chat-prefs", NP = "check-np-time", MENU = "check-view-menu";
// The preview (`ui/playlists.js`).
const CARD = `    const card = H.el("div", { class: "preview-card" }, [closeBtn, pv.frame, pv.timeline, pv.controls]);`;
const FRAME = `    pv.frame = H.el("div", { class: "preview-frame" }, [mount, pv.shield]);`;
const CONTROLS = `    pv.controls = H.el("div", { class: "preview-controls" }, [pv.playBtn, pv.muteBtn, pv.vol, pv.times, pv.reloadBtn, pv.blockBtn]);`;   // J135's line
const MUTE_CLS = `{ class: "mute-btn pv-mute", text:`;
const NO_LEN = `  const PV_NO_LENGTH = "\\u2013:\\u2013\\u2013";`;
const BAR_GATE = "      if (!(pv.len > 0) || pv !== _pv) return;   // no length yet: the bar moves nothing";
const DRAW_T = "    if (ts !== pv.shownT || ds !== pv.shownD) {   // the two times are one text now (J135), written when either whole second changes";
const DRAW_P = `    if (pct !== pv.shownP) { pv.shownP = pct; pv.fill.style.width = pct + "%"; pv.knob.style.left = pct + "%"; }`;
const LOOP = "    pv.raf = requestAnimationFrame(_pvTick);\n    _pvDrawPlay(pv);\n    if (pv.drag) return;";   // J135 draws play/pause each frame
const TIME_AT = "    return f * pv.len;";
const PENDING = "      pv.pending = { t: pv.dragT, at: Date.now() };";
const HOLD = "|| Date.now() - pv.pending.at > PV_SEEK_HOLD_MS) pv.pending = null;";
const ON_MOVE = "    pv.onMove = (e) => { if (!pv.drag) return; pv.dragT = _pvTimeAt(pv, e.clientX); _pvDraw(pv, pv.dragT, pv.len); };";
const UP_REMOVE = `      document.removeEventListener("pointermove", pv.onMove);\n      document.removeEventListener("pointerup", pv.onUp);\n      document.removeEventListener("pointercancel", pv.onCancel);\n      if (e && typeof e.clientX`;   // J135 adds pointercancel
const BLOCKED = ".preview-frame.pv-blocked .preview-shield { display: block; }";
const SHIELD = ".preview-shield { position: absolute; inset: 0; z-index: 2; display: none; background: transparent; }";
const MUTE_ON = "    pv.muteBtn.onclick = () => { pv.muted = !pv.muted; _pvApplyVolume(pv); _pvRemember(pv); };";
const REMEMBER = "if (pv.levelChosen) ChatPrefs.setPreviewVolume(pv.level);";
const ADOPT = "    if (Math.abs(lvl - pv.pushed.level) > 1 || !!muted !== pv.pushed.muted) {";
const FROM = "startSeconds: Math.max(0, t) }";
const REAPPLY = "      setTimeout(() => { if (pv === _pv) _pvApplyVolume(pv); }, PV_RELOAD_VOLUME_MS);\n";
const BLOCK_ON = "try { ChatPrefs.setPreviewBlocked(pv.blocked); } catch (e) {} };";
const SET_BLOCK = "    _pvSetBlocked(pv, pv.blocked);";
const REM_LEVEL = `level: (typeof v === "number") ? v : PV_DEFAULT_VOLUME,`;   // J135: half before a level is chosen
const CANCEL = `    if (pv.raf !== null && typeof cancelAnimationFrame === "function") { try { cancelAnimationFrame(pv.raf); } catch (e) {} }\n`;
const CLEAR = "    if (pv.poll) clearInterval(pv.poll);\n";
const TEARDOWN = "    _pvTeardown();   // this open's controls";
const STALE = "      if (pv !== _pv || !pv.player) return;";
const ADD_H = "    const addH = Math.max(0, card.getBoundingClientRect().height - frame.getBoundingClientRect().height);";
const ADD_W = "    const addW = px(st.paddingLeft) + px(st.paddingRight) + px(st.borderLeftWidth) + px(st.borderRightWidth);";
const CENTRE = "    const cr = card.getBoundingClientRect();";
const RESIZE = `    window.addEventListener("resize", _previewResizeHandler);\n`;
// The main player's sound (`ui/shell.js`, `ui/player.js`) and the store (`core/chatprefs.js`).
const SEED = "      const lvl = ChatPrefs.playerVolume(), muted = ChatPrefs.playerMuted();";
const SLIDER_SAVE = "      Player.applyVolumeState();\n      Player.rememberVolumeState();\n    };";
const ADOPT_MAIN = "      if (_personHasActed()) rememberVolumeState();";   // J135: once a person has used the page
const MAIN_SAVE = "ChatPrefs.setPlayerVolume(volumeState.level); ChatPrefs.setPlayerMuted(volumeState.muted);";
const MOVED = "      pv: st.playerVolume, pm: st.playerMuted, qv: st.previewVolume, qm: st.previewMuted, qb: st.previewBlockChoice });";
const LOAD_QV = "    _state.previewVolume = (_state.previewVolume === null || _state.previewVolume === undefined) ? null : _clampToRange(_state.previewVolume, PLAYER_VOLUME_RANGE);";
const LOAD_PV = "    _state.playerVolume = _clampToRange(_state.playerVolume, PLAYER_VOLUME_RANGE);   // J134\n";
const LOAD_PM = "    _state.playerMuted = (_state.playerMuted === true);\n";
const GET_PV = "  function playerVolume()  { return _clampToRange(_st().playerVolume, PLAYER_VOLUME_RANGE); }";
const SET_PV = "  function setPlayerVolume(v) { _st().playerVolume = _clampToRange(v, PLAYER_VOLUME_RANGE); _saveIfMoved(); }";
// The player's line (`ui/player.js`, `ui/queue.js`).
const EMPTY = `      if (refs.npLabel) refs.npLabel.textContent = "";`;
const NOTHING_IF = "    if ((np && np.pi && np.pi === _endedPi) || !np || !np.song) {";
const WAITING = `      _showPlayerShield(true, "Waiting for the next song…");`;
const RQ_HEAD = `text: playing ? "Now Playing" : "Nothing playing" }`;
// The view menu (`ui/shell.js`, `index.html`).
const LEFT = "    const left = Math.max(LAYOUT_MENU_EDGE, Math.min(b.left, vw - LAYOUT_MENU_EDGE - w));";
const EDGE = "  const LAYOUT_MENU_EDGE = 8;";
const GAP = "  const LAYOUT_MENU_GAP = 6;";
const TOP = `    menu.style.top = Math.round(b.bottom + LAYOUT_MENU_GAP) + "px";`;
const ON_RESIZE = `      window.addEventListener("resize", _placeLayoutMenu);   // open while the window changes: placed again, inside (J134)\n`;
const ON_FIT = "    _placeLayoutMenu();   // the fit can move the ⊞ button (a name shrunk or grown back): an open menu follows it (J134)\n";
const ON_OPEN = "      _placeLayoutMenu();   // where the button is now (J134)\n";
const CLOSED = `    if (!menu || !btn || menu.style.display === "none") return;`;
const PICK = `    if (refs.layoutMenu) refs.layoutMenu.style.display = "none";\n  }`;
const MENU_POS = ".layout-menu { position: fixed;";
const MENU_MIN = "min-width: min(220px, calc(100vw - 16px));";
const MENU_Z = "max-width: calc(100vw - 16px); z-index: 50;";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── PART A: THE PREVIEW'S TWO LINES AND ITS BUTTONS (`check-preview-controls` A) ──
  ["PV1", [[PL, CARD, CARD.replace("pv.frame, pv.timeline, pv.controls", "pv.frame, pv.controls")]],
    PVC, "A: UNDER THE VIDEO, INSIDE ITS CARD, TWO LINES", "RED"],   // the timeline left out
  ["PV2", [[PL, CARD, CARD.replace("pv.timeline, pv.controls", "pv.controls, pv.timeline")]],
    PVC, "A: UNDER THE VIDEO, INSIDE ITS CARD, TWO LINES", "RED"],   // the buttons above the timeline
  ["PV3", [[PL, CONTROLS, CONTROLS.replace("pv.blockBtn]", `pv.blockBtn, H.el("button", { class: "reset-btn pv-hd", text: "HD" })]`)]],
    PVC, "A: NO HD BUTTON", "RED"],   // an HD button after all
  ["PV4", [[PL, MUTE_CLS, `{ class: "pv-mute", text:`]],
    PVC, "A: THE LINE UNDER THE BAR", "RED"],   // 🔊 without the main player's class (J135's row of the line says it, the same claim)
  // PV5 (YouTube's own bar hidden) RETIRED at J135: the owner's "we dont need youtube's bar" made it the build. J136 put the bar
  // back ("1 yes"), and the row that hides it again is `mutate-j135-settings-preview` PC4, re-aimed there.
  ["PV6", [[PL, FRAME, FRAME.replace("[mount, pv.shield]", "[mount]")], [PL, CARD, CARD.replace("pv.controls]", "pv.controls, pv.shield]")]],
    PVC, "A: THE COVER IS INSIDE THE VIDEO'S FRAME, AND THE TWO LINES ARE NOT", "RED"],   // the cover over the whole card
  // ── PART B: THE TIMES, AND ONE LOOP THAT DRAWS ONLY WHAT MOVED (`check-preview-controls` B) ──
  ["TM1", [[PL, NO_LEN, `  const PV_NO_LENGTH = "0:00";`]],
    PVC, "B: BEFORE THE LENGTH", "RED"],   // the length reads 0:00 before YouTube gives it
  ["TM2", [[PL, BAR_GATE, "      if (pv !== _pv) return;"]],
    PVC, "B: A CLICK ON THE BAR BEFORE THE LENGTH MOVES NOTHING", "RED"],   // a seek to 0 of nothing
  ["TM3", [[PL, DRAW_T, "    if (true) {"]],
    PVC, "B: A FRAME WITHIN THE SAME SECOND AND THE SAME PLACE WRITES NOTHING", "RED"],   // the time written every frame
  ["TM4", [[PL, LOOP, "    pv.raf = requestAnimationFrame(_pvTick); requestAnimationFrame(_pvTick);\n    _pvDrawPlay(pv);\n    if (pv.drag) return;"]],
    PVC, "B: ONE LOOP", "RED"],   // two frames asked for each frame: the loop doubles
  // ── PART C: SEEKING, THE DRAG, AND THE BLOCK (`check-preview-controls` C) ──
  ["SK1", [[PL, TIME_AT, "    return f * pv.len * 0.9;"]],
    PVC, "C: A CLICK A QUARTER ALONG MOVES THE VIDEO A QUARTER IN", "RED"],   // not proportional
  ["SK2", [[PL, PENDING, "      pv.pending = null;"]],
    PVC, "C: THE KNOB WAITS AT THE TARGET", "RED"],   // the knob jumps back to where the song was
  ["SK3", [[PL, HOLD, ") pv.pending = null;"]],
    PVC, "C: A SEEK THE PLAYER NEVER REACHES HOLDS THE KNOB 2 S AT MOST", "RED"],   // held for ever
  ["SK4", [[PL, ON_MOVE, ON_MOVE.replace("_pvDraw(pv, pv.dragT, pv.len); };", "_pvDraw(pv, pv.dragT, pv.len); try { pv.player.seekTo(pv.dragT, true); } catch (e2) {} };")]],
    PVC, "C: DURING A DRAG NOTHING SEEKS", "RED"],   // a seek at every step of the drag
  ["SK5", [[PL, LOOP, "    pv.raf = requestAnimationFrame(_pvTick);\n    _pvDrawPlay(pv);"]],
    PVC, "C: THE KNOB AND THE TIME FOLLOW THE POINTER", "RED"],   // the loop fights the drag
  ["SK6", [[PL, UP_REMOVE, "      if (e && typeof e.clientX"]],
    PVC, "C: and the drag's listeners are gone", "RED"],   // a released drag keeps listening
  ["BK1", [[PL, BAR_GATE, "      if (!(pv.len > 0) || pv !== _pv || pv.blocked) return;"]],
    PVC, "C: WITH THE BLOCK ON, THE TIMELINE STILL MOVES THE VIDEO", "RED"],   // the block stops the timeline too
  ["BK2", [[HTML, BLOCKED, ".preview-frame.pv-blocked .preview-shield { display: none; }"]],
    PVC, "C: THE BLOCK PUTS THE SEE-THROUGH COVER OVER THE VIDEO", "RED"],   // the cover never shown
  ["BK3", [[HTML, SHIELD, SHIELD.replace("background: transparent;", "background: rgba(0,0,0,0.6);")]],
    PVC, "C: see-through, over the whole video", "RED"],   // a dark cover: the video hidden
  // ── PART D: THE BUTTONS ACT ON THE PREVIEW ALONE, AND ARE REMEMBERED (`check-preview-controls` D) ──
  ["BT1", [[PL, MUTE_ON, MUTE_ON.replace(" _pvRemember(pv); };", " };")]],
    PVC, "D: 🔊 MUTES THE PREVIEW and is remembered", "RED"],   // mute not remembered
  ["BT2", [[PL, REMEMBER, "if (pv.levelChosen) ChatPrefs.setPlayerVolume(pv.level);"]],
    PVC, "D: the main player's volume is untouched", "RED"],   // the preview's slider saved as the main player's
  ["BT3", [[PL, ADOPT, "    if (false) {"]],
    PVC, "D: A CHANGE MADE INSIDE YOUTUBE'S FRAME IS ADOPTED AND REMEMBERED", "RED"],   // a change inside the frame ignored
  ["BT4", [[PL, FROM, "startSeconds: 0 }"]],
    PVC, "D: ↻ RELOADS THE SONG FROM WHERE IT WAS", "RED"],   // refresh from the start
  ["BT5", [[PL, REAPPLY, ""]],
    PVC, "D: and puts the preview's volume back on it after the load", "RED"],   // the load's own volume left
  ["BT6", [[PL, BLOCK_ON, "};"]],
    PVC, "D: 🖱 PRESSED, OFF — the cover gone, and that choice remembered", "RED"],   // the block not remembered (on by default since J135: the first press turns it off)
  // ── PART E: THROUGH A RELOAD, AND BEFORE ANYTHING IS SAVED (`check-preview-controls` E, `check-chat-prefs` J134) ──
  ["RM1", [[PL, SET_BLOCK, "    _pvSetBlocked(pv, false);"]],
    PVC, "E: AND ITS MOUSE BLOCK", "RED"],   // the remembered block not put back
  ["RM2", [[PL, REM_LEVEL, "level: PV_DEFAULT_VOLUME,"]],
    PVC, "E: THROUGH A RELOAD THE PREVIEW KEEPS ITS VOLUME AND MUTE", "RED"],   // the main player's level every time
  // RM3 (full, whatever the main player is at) RETIRED at J135: the preview no longer opens at the main player's level, the
  // owner's "defaut colume should be half"; the default is `mutate-j135-settings-preview` PC11.
  ["RM4", [[PREFS, LOAD_QV, "    _state.previewVolume = null;"]],
    CPR, "J134: THE PREVIEW'S VOLUME SURVIVES A RELOAD, APART FROM THE MAIN PLAYER'S", "RED"],   // dropped on load
  ["RM5", [[PREFS, MOVED, "      pv: st.playerVolume, pm: st.playerMuted });"]],
    CPR, "J134: THE PREVIEW'S VOLUME SURVIVES A RELOAD, APART FROM THE MAIN PLAYER'S", "RED"],   // the preview's keys not in the comparison: never saved
  ["RM6", [[PREFS, SET_PV, SET_PV.replace("_saveIfMoved(); }", "_save(); _emit(); }")]],
    CPR, "J134: NONE OF THEM FIRES onChange", "RED"],   // a slider's step rebuilds every chat row
  ["RM7", [[PREFS, LOAD_PV, ""], [PREFS, GET_PV, "  function playerVolume()  { return _st().playerVolume; }"]],
    CPR, "J134: A STORED playerVolume OF \"abc\" READS AS 100", "RED"],   // unbounded on load and on read
  // ── PART F: THE CONTROLS BELONG TO ONE OPEN (`check-preview-controls` F) ──
  ["TD1", [[PL, CANCEL, ""]],
    PVC, "F: CLOSED — the player gone, its loop and its poll stopped", "RED"],   // the frame loop left queued
  ["TD2", [[PL, CLEAR, ""]],
    PVC, "F: CLOSED — the player gone, its loop and its poll stopped", "RED"],   // the volume poll left running
  ["TD3", [[PL, TEARDOWN, "    void 0;   // this open's controls"]],
    PVC, "F: and a drag left in progress is dropped", "RED"],   // nothing torn down at close
  ["TD4", [[PL, STALE, "      if (!pv.player) return;"]],
    PVC, "F: NOTHING OF A CLOSED PREVIEW REACHES ITS PLAYER", "RED"],   // a closed card's ↻ still loads
  // ── PART G: THE CARD COUNTS BOTH LINES (`check-preview-controls` G) ──
  ["SZ1", [[PL, ADD_H, "    const addH = 26;"]],
    PVC, "G: a short column — THE WHOLE CARD FITS THE COLUMN", "RED"],   // the lines not counted: the card runs out of a short column
  ["SZ2", [[PL, ADD_W, "    const addW = 46;"]],
    PVC, "G: phone at 360 px — THE LARGEST VIDEO THAT FITS", "RED"],   // too much taken off the width: the video smaller than fits
  ["SZ3", [[PL, CENTRE, "    const cr = frame.getBoundingClientRect();"]],
    PVC, "G: phone at 360 px — AND IS CENTRED IN IT, lines and all", "RED"],   // centred from the video alone
  ["SZ4", [[PL, RESIZE, ""]],
    PVC, "G: RESIZED, THE CARD IS SIZED AND CENTRED AGAIN", "RED"],   // not placed again on resize
  // ── PART M: THE MAIN PLAYER REMEMBERS ITS SOUND (`check-preview-controls` M) ──
  ["MS1", [[SHELL, SEED, "      const lvl = undefined, muted = undefined;"]],
    PVC, "M: THROUGH A RELOAD THE MAIN PLAYER KEEPS ITS VOLUME AND MUTE", "RED"],   // not seeded from what was saved
  ["MS2", [[SHELL, SLIDER_SAVE, "      Player.applyVolumeState();\n    };"]],
    PVC, "M: ITS SLIDER IS SAVED AS IT IS MOVED", "RED"],   // the slider not saved (the 🔊 would save its level for it: read before)
  ["MS5", [[SHELL, "Player.applyVolumeState(); Player.rememberVolumeState(); };", "Player.applyVolumeState(); };"]],
    PVC, "M: AND ITS 🔊 AS IT IS PRESSED", "RED"],   // the 🔊 not saved
  ["MS3", [[PLAYER, ADOPT_MAIN, "      void 0;"]],
    PVC, "M: A CHANGE MADE INSIDE YOUTUBE'S FRAME IS ADOPTED AND REMEMBERED", "RED"],   // adopted but not saved
  ["MS4", [[PLAYER, MAIN_SAVE, "ChatPrefs.setPreviewVolume(volumeState.level); ChatPrefs.setPreviewMuted(volumeState.muted);"]],
    PVC, "M: and the preview's remembered sound is not touched by them", "RED"],   // saved as the preview's
  // ── PART B (the brief's): THE PLAYER'S LINE WITH NO WORDS (`check-np-time` E) ──
  ["LN1", [[PLAYER, EMPTY, `      if (refs.npLabel) refs.npLabel.textContent = "Nothing playing";`]],
    NP, "E: NOTHING PLAYING, THE LINE HOLDS NO WORDS", "RED"],   // the old words back
  ["LN2", [[PLAYER, NOTHING_IF, "    if (!np || !np.song) {"]],
    NP, "E: BETWEEN SONGS (the song this player finished) THE LINE HOLDS NO WORDS", "RED"],   // a finished song keeps its DJ and time
  ["LN3", [[PLAYER, WAITING, `      _showPlayerShield(true, "");`]],
    NP, "E: THE COVER'S OWN WORDS STAY", "RED"],   // the cover's words taken too
  ["LN4", [[QUEUE, RQ_HEAD, `text: playing ? "Now Playing" : "" }`]],
    NP, "E: AND THE ROOM QUEUE'S \"Nothing playing\" HEADING STAYS", "RED"],   // the room queue's heading taken too
  // ── PART C (the brief's): THE VIEW MENU (`check-view-menu`) ──
  ["MN1", [[SHELL, LEFT, "    const left = b.right - w;"]],
    MENU, "A: A SHORT NAME AT 360 PX — THE MENU'S LEFT EDGE IS THE BUTTON'S LEFT EDGE", "RED"],   // leftward from the button's right edge again
  ["MN2", [[SHELL, LEFT, "    const left = Math.max(LAYOUT_MENU_EDGE, b.left);"]],
    MENU, "B: \"Friday night\" at 360 px — FROM THE BUTTON IT WOULD PASS THE RIGHT EDGE, SO IT ENDS 8 PX INSIDE IT", "RED"],   // no right-edge limit
  ["MN3", [[SHELL, LEFT, "    const left = Math.min(b.left, vw - LAYOUT_MENU_EDGE - w);"]],
    MENU, "C: A BUTTON AT THE WINDOW'S LEFT EDGE — THE MENU STAYS 8 PX INSIDE IT", "RED"],   // no left-edge limit
  ["MN4", [[SHELL, EDGE, "  const LAYOUT_MENU_EDGE = 0;"]],
    MENU, "SO IT ENDS 8 PX INSIDE IT", "RED"],   // flush with the edge
  ["MN5", [[SHELL, TOP, `    menu.style.top = Math.round(b.top + LAYOUT_MENU_GAP) + "px";`]],
    MENU, "A: 6 px under the button", "RED"],   // over the button
  ["MN6", [[SHELL, ON_RESIZE, ""]],
    MENU, "D: NARROWED WHILE OPEN, IT STAYS INSIDE (OR CLOSES)", "RED"],   // not placed again on resize
  ["MN7", [[SHELL, ON_FIT, ""]],
    MENU, "D: AND WHEN THE HEADER'S FIT MOVES THE BUTTON AFTER THE RESIZE, THE OPEN MENU FOLLOWS IT", "RED"],   // left where the resize put it
  ["MN8", [[SHELL, ON_OPEN, ""]],
    MENU, "A: A SHORT NAME AT 360 PX — THE MENU'S LEFT EDGE IS THE BUTTON'S LEFT EDGE", "RED"],   // never placed on open
  ["MN9", [[SHELL, CLOSED, "    if (!menu || !btn) return;"]],
    MENU, "D: a CLOSED menu is left alone by a resize and a fit", "RED"],   // a closed menu written to
  ["MN10", [[HTML, MENU_POS, ".layout-menu { position: absolute;"]],
    MENU, "F: THE MENU IS FIXED TO THE WINDOW", "RED"],   // inside the header's selector again
  ["MN11", [[HTML, MENU_MIN, "min-width: 220px;"]],
    MENU, "C: A WINDOW NARROWER THAN THE MENU — IT NARROWS TO THE WINDOW LESS 16 PX AND PASSES NEITHER EDGE", "RED"],   // a minimum wider than the window
  ["MN12", [[SHELL, PICK, "  }"]],
    MENU, "E: CHOOSING AN OPTION APPLIES IT AND CLOSES THE MENU", "RED"],   // a choice leaves it open
  // ── THE CONTROLS: edits that change nothing a person sees; each guard must stay green ──
  ["G1", [[PL, DRAW_P, `    if (pct !== pv.shownP) { pv.shownP = pct; pv.knob.style.left = pct + "%"; pv.fill.style.width = pct + "%"; }`]],
    PVC, "", "GREEN"],   // the knob and the fill written in the other order
  ["G2", [[SHELL, GAP, "  const LAYOUT_MENU_GAP = 3 + 3;"]],
    MENU, "", "GREEN"],   // the same 6 px, written as a sum
  ["G3", [[HTML, MENU_Z, "max-width: calc(100vw - 16px); z-index: 60;"]],
    MENU, "", "GREEN"],   // stacked a little higher
  ["G4", [[PREFS, LOAD_PM, ""]],
    CPR, "", "GREEN"],   // the load's own normalising of the main mute dropped: the reader holds it (MEASURED)
  ["G5", [[PLAYER, EMPTY, "      if (refs.npLabel) refs.npLabel.replaceChildren();"]],
    NP, "", "GREEN"],   // the same emptying, another way
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
      const h = J.open("mutate-j134-preview-menu:" + id, file);   // journalled BEFORE the write
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
