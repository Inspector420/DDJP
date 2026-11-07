// tools/probes/mutate-j127-advanced.js
// SUBJECT: J127 — room settings' "Show advanced options" (the owner's): `ui/settings.js` (the list `_ADVANCED`, the toggle
// under the title, `adv`, the card rule in `_section`, Bot permissions' `advanced` argument), `core/chatprefs.js`
// (`advancedShown`, per device and per account, off by default, no `onChange`), and the outline's rules in `index.html`.
// Held by `check-settings-rows` I and J, `check-settings-apply` R, and `check-chat-prefs`. And the owner's open correction
// in the same package: the state index's room-surface id is the full twelve characters, one id (`check-room-compat`, the
// state index `HANDOFF.md`). And (`ddjp_670`) a bad value, shown again, is the value that was typed with its red line, until it
// is fixed or locked away (`_markInvalid`, `_showTyped`): `check-settings-apply` R5, rows AV28–AV34. And (`ddjp_677`, the owner's
// request at `ddjp_674`, and his choice at its correction, "i mean B for bowth settings pannels") locked — and always for someone
// who gets no lock — both settings panels' cards take the chat box's darkness from the chat box's own rule, nothing dimmed
// (`_lockedLook` on the room's box; the sheet's one background rule naming `.prefs-locked` cards): `check-settings-apply` R6 and
// `check-settings-rows` J8, rows AV35–AV49 (AV40 re-aimed, AV37 and AV41–AV43 renamed with the rows they hit, at the correction). One row per way it could go wrong, each naming the failure it must cause; the
// controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes
// are back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE:
// each file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not
// there at either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed.
// Restored after every row and checked restored by hash.
//
// THE LATTICE ROWS (AV19a–c). `advancedShown` reads off for anything but a real `true` at TWO sites, `load()` and the
// reader. Each alone suffices — dropping either leaves the guard green (MEASURED, not a survivor) — and dropping both goes
// red: so neither site is decoration, and neither may be deleted on the strength of the other's green.
//
//   node tools/probes/mutate-j127-advanced.js            every row
//   node tools/probes/mutate-j127-advanced.js AV3 AV9    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const UI = "ui/settings.js", CP = "core/chatprefs.js", HTML = "index.html";
const ROWS_G = "check-settings-rows", APPLY_G = "check-settings-apply", PREFS_G = "check-chat-prefs";
const LIST_END = `"vouchTable", "receiptsPerMessage", "checkpointTable", "checkpointRankOffsetMs", "selfWitnessCheckpoint", "repSummaryMs"];`;
const ONCHANGE = `advBox.onchange = () => { try { ChatPrefs.setAdvancedShown(!!advBox.checked); } catch (e) { /* unreadable: stays off */ } renderSettings(); };`;
const onchangeWith = (extra) => ONCHANGE.replace("renderSettings(); };", extra + " renderSettings(); };");
const SETTER = `function setAdvancedShown(v)  { _st().advancedShown = !!v; _save(); }`;
// THE OWNER'S OPEN CORRECTION, IN THE SAME PACKAGE: the state index's room-surface id is the full twelve characters every
// derivation prints, one id (`check-room-compat`). The doc tree is found the way the guards find it, never by `docs_NNN`.
const DOCROOT = require(path.join(ROOT, "tests", "_docs.js")).docRoots().filter((d) => fs.existsSync(path.join(d, "HANDOFF.md")))[0];
if (!DOCROOT) { console.log("ABORT — no doc tree with HANDOFF.md beside this one"); process.exit(2); }
const HANDOFF = path.relative(ROOT, path.join(DOCROOT, "HANDOFF.md"));
const RC_G = "check-room-compat";
// RE-ANCHORED AT `ddjp_663` (J131's correction): the state index opens 🔴 now, and the room surface moved (`check-room-compat`'s
// `nowPlayingShape`), so RC1, RC2 and N5 take the new line and id; each still asks what it asked of the old one.
// RE-ANCHORED AT `ddjp_664` (a diagnosis-only package, the app unchanged): the state index opens 🟢, same id, so RC1 and RC2
// take the new line, and N5's harmless edit moves to a phrase that line has; each still asks what it asked of the old one.
// RE-ANCHORED AT `ddjp_665` (J128's correction; the app changed, no room breaks): the line drops "the app is unchanged", same
// id, so RC1, RC2 and N5 take the new line; each still asks what it asked of the old one.
const STATE_LINE = "🟢 **No room breaks.** Rooms made before `ddjp_663`'s build are not supported. Surface `bd51f6a90f6b`.";
// The look's one call in `renderSettings` (`ddjp_677`).
// The chat box's darkness, the one rule the locked cards of both panels share (`ddjp_677`'s correction; `index.html`).
// RE-ANCHORED at `ddjp_678` (J133): the rule names the lists, the player's cover and a locked skip rule's box too, on a
// second line, so TINT is both lines; AV46 and AV47 take the first line's new ending. Each still breaks what it broke.
const TINT = "    .chat-messages, .chat-input, .dm-search, .invite-input, .chat-tint, .prefs-body.prefs-locked .pref-section, .prefs-body.prefs-locked .set-sec, .prefs-body.prefs-locked > .set-row,\n" +
  "      .song-row, .pl-row, .dm-row, .logs-box, .player-shield.waiting, .prefs-body.prefs-locked .set-rule, .prefs-body.prefs-locked .set-deps .set-row { background: rgba(12,12,16,0.45); }";
const LOOK_CALL = "    _lockedLook(refs.settingsBox, H.settingsLocked() || !canChangeSomething);\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE LIST ──
  ["AV1", [[UI, LIST_END, `"vouchTable", "receiptsPerMessage", "checkpointTable", "checkpointRankOffsetMs", "selfWitnessCheckpoint"];`]],
    ROWS_G, "I: THE PANEL'S ADVANCED LIST IS THE OWNER'S TWELVE", "RED"],                                   // one of the twelve dropped
  ["AV2", [[UI, LIST_END, `"vouchTable", "receiptsPerMessage", "checkpointTable", "checkpointRankOffsetMs", "selfWitnessCheckpoint", "repSummaryMs", "minLen"];`]],
    ROWS_G, "I: THE PANEL'S ADVANCED LIST IS THE OWNER'S TWELVE", "RED"],                                   // a shown setting added
  // ── OFF HIDES ──
  ["AV3", [[UI, "      if (!_advOn) return;\n", "      if (!_advOn && false) return;\n"]],
    ROWS_G, "I: OFF, a consensusBot room shows every setting it shows ON EXCEPT the owner's twelve", "RED"], // off draws them anyway
  // AV4 MEASURED, AND WHY: a call site left unwrapped inside a card whose OTHER rows are all advanced is invisible — the
  // card's own rule sees only advanced rows drawn and takes the card away whole (off), or outlines it whole (on). The two
  // mechanisms overlap there, so a missing wrap shows only in a card that mixes: AV4b, the Reputation card.
  ["AV4", [[UI, `adv("presendMs", () =>`, `((k, b) => b())("presendMs", () =>`]], ROWS_G, "", "GREEN"],
  ["AV4b", [[UI, `adv("repSummaryMs", () =>`, `((k, b) => b())("repSummaryMs", () =>`]],
    ROWS_G, "I: OFF, a consensusBot room shows every setting it shows ON EXCEPT the owner's twelve", "RED"], // one call site unwrapped
  // ── CARDS ──
  ["AV5", [[UI, "      if (!_advOn) refs.settingsBox.removeChild(card);", "      if (!_advOn) void card;"]],
    ROWS_G, "J: OFF (consensusBot), every card whose rows are all advanced is gone", "RED"],              // an empty card left behind
  ["AV6", [[UI, `else { card.className += " set-adv"; _unoutline(body); }`, `else { card.className += " set-adv"; }`]],
    ROWS_G, "J: A CARD WHOSE ROWS ARE ALL ADVANCED is outlined as a card, with no second line inside it", "RED"], // a double line
  ["AV7", [[UI, `else { card.className += " set-adv"; _unoutline(body); }`, `else { _unoutline(body); }`]],
    ROWS_G, "J: ON (consensusBot), EVERY ADVANCED ROW IS DRAWN WITHIN AN OUTLINE", "RED"],                // the card never outlined
  ["AV8", [[UI, `{ class: "set-sec-body set-adv" }`, `{ class: "set-adv" }`]],
    ROWS_G, "J: in a card that mixes, the outline is a BOX that borrows the card body", "RED"],          // the box stops borrowing
  // AV8b: a box that stops borrowing the body loses its outline rule too, so R's colour row reddens FIRST. Re-tested
  // alone at J127 with that row cleared, R's borderless-row assertion reddens on the same edit: both rows hold it.
  ["AV8b", [[UI, `{ class: "set-sec-body set-adv" }`, `{ class: "set-adv" }`]],
    APPLY_G, "R: THE OUTLINE IS THE TOGGLE'S COLOUR", "RED"],                                              // …and its rows gain a border
  // ── THE TOGGLE ──
  ["AV9", [[UI, "    advBox.checked = _advOn;\n", "    advBox.checked = _advOn; advBox.disabled = H.settingsLocked();\n"]],
    ROWS_G, "J: LOCKED, NOT THE OWNER — the toggle is live", "RED"],                                     // locked away
  ["AV10", [[UI, ONCHANGE, onchangeWith(`Actions.perform("room.settings", { partial: {} });`)]],
    ROWS_G, "FLIPPING IT SENDS NOTHING", "RED"],                                                          // it sends
  ["AV11", [[UI, ONCHANGE, onchangeWith("H.setSettingsLocked(true);")]],
    ROWS_G, "FLIPPING IT SENDS NOTHING: no settings write, no bot request, and the lock untouched", "RED"], // it relocks
  ["AV12", [[UI, ONCHANGE, onchangeWith("_discardStaged();")]],
    APPLY_G, "R: TURNING IT OFF DISCARDS NOTHING", "RED"],                                                // it discards what is staged
  ["AV13", [[UI, ONCHANGE, onchangeWith("_applyStaged();")]],
    APPLY_G, "R: TURNING IT OFF DISCARDS NOTHING", "RED"],                                                // it applies what is staged
  ["AV14", [[UI, ONCHANGE, onchangeWith("for (const k in _invalid) delete _invalid[k];")]],
    APPLY_G, "R: A HIDDEN BAD VALUE KEEPS APPLY BLOCKED", "RED"],                                         // it forgives a bad value (the owner's)
  ["AV15", [[UI, `H.el("div", { class: "set-adv-toggle" }, [`, `H.el("div", { class: "set-adv-toggle", "data-key": "advanced" }, [`]],
    ROWS_G, "I: a consensus room with a bot shows EVERY setting", "RED"],                                 // a data-key reads as a key
  ["AV16", [[UI, "    advBox.checked = _advOn;\n", "    advBox.checked = _advOn; advBox.setAttribute(\"aria-expanded\", \"false\");\n"]],
    ROWS_G, "J: it is NOT a collapsible header", "RED"],                                                 // it claims to expand
  ["AV17", [[UI, `_rowMore(advRow, ":advanced", null);`, `advRow.appendChild(H.el("div", { class: "pref-note", text: advRow._moreDesc }));`]],
    ROWS_G, "J: the explanation is NOT on screen before More", "RED"],                                   // always on screen (the owner: behind More)
  ["AV18", [[UI, "function _advancedOn() { try { return ChatPrefs.advancedShown() === true; } catch (e) { return false; } }",
                 "function _advancedOn() { try { return ChatPrefs.advancedShown() === true; } catch (e) { return true; } }"]],
    ROWS_G, "J: UNREADABLE READS AS OFF", "RED"],                                                        // unreadable reads on
  // ── BOT PERMISSIONS ──
  ["AV19", [[UI, "    const unlisted = (k) => skip.has(k) || (!!advanced && advanced.shown !== true && advKeys.indexOf(k) >= 0);",
                 "    const unlisted = (k) => skip.has(k);"]],
    ROWS_G, "J: OFF (consensusBot), BOT PERMISSIONS LISTS EXACTLY WHAT IT LISTS ON, LESS THE TWELVE", "RED"], // the list ignores the toggle
  ["AV20", [[UI, `cur[k] && !skip.has(k));`, `cur[k] && !unlisted(k));`]],
    ROWS_G, "THE “SHARED” LINE STILL COUNTS A HIDDEN ADVANCED SETTING", "RED"],                   // the line hides one (the owner's)
  ["AV21", [[UI, `(advKeys.indexOf(k) >= 0 ? " set-adv" : "")`, `(advKeys.indexOf(k) >= 0 ? "" : "")`]],
    ROWS_G, "each advanced row in the list is outlined, and no other", "RED"],                           // shown, but not outlined
  // ── THE STORED CHOICE ──
  ["AV22", [[CP, "      advancedShown: false,\n", "      advancedShown: true,\n"]],
    PREFS_G, "J127: advanced options are OFF by default", "RED"],                                        // on by default
  ["AV23", [[CP, SETTER, `function setAdvancedShown(v)  { _st().advancedShown = !!v; }`]],
    PREFS_G, "J127: turning them on is stored through Store.prefs.save", "RED"],                         // never saved
  ["AV24", [[CP, SETTER, `function setAdvancedShown(v)  { _st().advancedShown = !!v; _save(); _emit(); }`]],
    PREFS_G, "J127: FLIPPING IT FIRES NO onChange", "RED"],                                               // rebuilds every chat row
  ["AV25a", [[CP, "  function advancedShown()    { return _st().advancedShown === true; }", "  function advancedShown()    { return !!_st().advancedShown; }"]],
    PREFS_G, "", "GREEN"],                                                                                  // lattice: the reader alone loosened
  ["AV25b", [[CP, "    _state.advancedShown = (_state.advancedShown === true);", "    _state.advancedShown = _state.advancedShown;"]],
    PREFS_G, "", "GREEN"],                                                                                  // lattice: load() alone loosened
  ["AV25c", [[CP, "  function advancedShown()    { return _st().advancedShown === true; }", "  function advancedShown()    { return !!_st().advancedShown; }"],
             [CP, "    _state.advancedShown = (_state.advancedShown === true);", "    _state.advancedShown = _state.advancedShown;"]],
    PREFS_G, "is not a real true, and reads as off", "RED"],                                              // lattice: both — a stored "true" reads on
  // ── THE OUTLINE'S COLOUR (DECLARED) ──
  ["AV26", [[HTML, ".set-sec-body.set-adv { border: 1px solid #5865F2;", ".set-sec-body.set-adv { border: 1px solid #5865F3;"]],
    APPLY_G, "R: THE OUTLINE IS THE TOGGLE'S COLOUR", "RED"],                                              // the box another colour
  ["AV27", [[HTML, ".set-sec.set-adv { border-color: #5865F2; }", ".set-sec.set-adv-gone { border-color: #5865F2; }"]],
    APPLY_G, "R: THE OUTLINE IS THE TOGGLE'S COLOUR", "RED"],                                              // the card's rule lost
  // ── A BAD VALUE, SHOWN AGAIN (`ddjp_670`): the value that was typed, with its red line, until fixed or locked away ──
  ["AV28", [[UI, "    _showTyped(key, input, err);   // a bad value typed here, drawn again with its red line (`ddjp_670`)\n", ""]],
    APPLY_G, "R5: SHOWN AGAIN, THE NUMBER ROW SHOWS THE VALUE THAT WAS TYPED", "RED"],                   // 669's number row: the room's value, no line
  ["AV29", [[UI, "      _showTyped(slot, input, err);   // a bad value typed here, drawn again with its red line (`ddjp_670`)\n", ""]],
    APPLY_G, "R5: AND SO DOES THE TABLE'S CELL", "RED"],                                                  // 669's table cell
  ["AV30", [[UI, "    err.textContent = t.err;\n    err.style.display = \"block\";\n", "    err.textContent = t.err;\n"]],
    APPLY_G, "R5: SHOWN AGAIN, THE NUMBER ROW SHOWS THE VALUE THAT WAS TYPED", "RED"],                   // the value back, its red line not
  ["AV31", [[UI, "    input.value = t.raw;\n", ""]],
    APPLY_G, "R5: SHOWN AGAIN, THE NUMBER ROW SHOWS THE VALUE THAT WAS TYPED", "RED"],                   // the red line back over the room's value
  ["AV32", [[UI, "    if (typed) _typed[slot] = typed; else delete _typed[slot];\n", "    delete _typed[slot];\n"]],
    APPLY_G, "R5: SHOWN AGAIN, THE NUMBER ROW SHOWS THE VALUE THAT WAS TYPED", "RED"],                   // nothing kept to draw again
  ["AV33", [[UI, "    delete _invalid[slot || key];\n    delete _typed[slot || key];\n", "    delete _invalid[slot || key];\n"]],
    APPLY_G, "R5: FIXED, IT IS GONE", "RED"],                                                             // fixed, yet the old bad value comes back
  ["AV34", [[UI, " for (const k in _typed) delete _typed[k]; }", " }"]],
    APPLY_G, "R5: LOCKED AWAY, it is gone", "RED"],                                                       // locked away, yet it comes back
  // ── THE ROOM-SURFACE ID IN THE STATE INDEX (the owner's correction) ──
  ["RC1", [[HANDOFF, STATE_LINE, STATE_LINE.replace("`bd51f6a90f6b`", "`bd51f6a90f`")]],
    RC_G, "carries no room-surface id in backticks", "RED"],                                              // the ten-character form back
  ["RC2", [[HANDOFF, STATE_LINE, STATE_LINE.replace("`bd51f6a90f6b`", "`bd51f6a90f6c`")]],
    RC_G, "it names room surface `bd51f6a90f6c` and the surface is now `bd51f6a90f6b`", "RED"],             // a wrong id, full length
  ["RC3", [["tests/check-room-compat.js", `const SURFACE_ID = crypto.createHash("sha256").update(stable(now)).digest("hex").slice(0, 12);`,
                                           `const SURFACE_ID = crypto.createHash("sha256").update(stable(now)).digest("hex").slice(0, 10);`]],
    RC_G, "the state-index marker reader is wrong about its own fixture", "RED"],                         // the guard's own length back to ten: its self-test, first
  // ── THE CONTROLS: an edit beside each subject that changes nothing; the guard must stay green ──
  ["N5", [[HANDOFF, STATE_LINE, STATE_LINE.replace("are not supported.", "are not supported here.")]], RC_G, "", "GREEN"],
  ["N1", [[UI, "      if (!_advOn) return;\n", "      if (!_advOn) { return; }\n"]], ROWS_G, "", "GREEN"],
  ["N2", [[UI, ONCHANGE, onchangeWith("void 0;")]], APPLY_G, "", "GREEN"],
  ["N3", [[CP, SETTER, `function setAdvancedShown(v)  { _st().advancedShown = Boolean(v); _save(); }`]], PREFS_G, "", "GREEN"],
  ["N4", [[HTML, ".set-sec-body.set-adv { border: 1px solid #5865F2;", ".set-sec-body.set-adv { border: 1px  solid #5865F2;"]], APPLY_G, "", "GREEN"],
  // ── AV35–AV43: LOCKED, THE ROOM SETTINGS LOOK AS THIS DEVICE'S DO (`ddjp_677`) ──
  ["AV35", [[UI, LOOK_CALL, ""]],
    APPLY_G, "R6: LOCKED, THE ROOM SETTINGS' BOX TAKES THIS DEVICE'S SETTINGS' CLASSES", "RED"],   // 676's look: the room's cards solid while locked
  ["AV36", [[UI, LOOK_CALL, "    _lockedLook(refs.settingsBox, H.settingsLocked());\n"]],
    APPLY_G, "R6: SOMEONE WHO GETS NO LOCK IS ALWAYS DRAWN AS LOCKED", "RED"],   // a viewer drawn solid when the lock is open
  // AV37 hits the first unlocked row (a lone row, solid unlocked); the target row, unlocked solid, is red too with it cleared (the report).
  ["AV37", [[UI, LOOK_CALL, "    _lockedLook(refs.settingsBox, true);\n"]],
    APPLY_G, "R6: A LONE ROW TAKES THE DARKNESS TOO, AND IS SOLID UNLOCKED", "RED"],   // dark whether locked or not
  ["AV38", [[UI, "    box.className = own.concat([\"prefs-body\"], locked ? [\"prefs-locked\"] : []).join(\" \");", "    box.className = [\"prefs-body\"].concat(locked ? [\"prefs-locked\"] : []).join(\" \");"]],
    APPLY_G, "R6: LOCKED, THE ROOM SETTINGS' BOX TAKES THIS DEVICE'S SETTINGS' CLASSES", "RED"],   // the box's own `settings-box` lost
  ["AV39", [[UI, ".filter((c) => c && c !== \"prefs-body\" && c !== \"prefs-locked\");", ".filter((c) => c);"]],
    APPLY_G, "R6: UNLOCKED, SOLID, AS TODAY", "RED"],   // the classes added on top of the last render's: the dark never leaves
  // AV40 RE-AIMED at the correction: the 0.55 rule it doubled is gone; it gives the room's cards a darkness and number of their own.
  ["AV40", [[HTML, TINT, TINT + "\n    .prefs-body.prefs-locked .set-sec { background: rgba(12,12,16,0.6); }"]],
    APPLY_G, "R6: THE ROOM SETTINGS, LOCKED — EACH CARD'S BLACK IS THE CHAT BOX'S DARKNESS, FROM THE SAME RULE AS THIS DEVICE'S", "RED"],
  ["AV41", [[UI, "      refs.settingsBar.appendChild(H.el(\"div\", { class: \"settings-bar\" }, [lockBtn, applyBtn, status]));", "      refs.settingsBar.appendChild(H.el(\"div\", { class: \"settings-bar\" + (H.settingsLocked() ? \" prefs-locked\" : \"\") }, [lockBtn, applyBtn, status]));"]],
    APPLY_G, "R6: EVERYTHING UNDER THE BAR TAKES THE LOOK", "RED"],   // the bar given the locked look too
  ["AV42", [[UI, "    btn.setAttribute(\"aria-expanded\", open ? \"true\" : \"false\");\n", "    btn.setAttribute(\"aria-expanded\", open ? \"true\" : \"false\");\n    btn.disabled = H.settingsLocked();\n"]],
    APPLY_G, "R6: WHILE LOCKED, AS BEFORE", "RED"],   // More dead while locked
  ["AV43", [[UI, LOOK_CALL, ""]],
    ROWS_G, "J: LOCKED, OR FOR SOMEONE WHO GETS NO LOCK, THE BOX TAKES THIS DEVICE'S SETTINGS' LOCKED CLASS", "RED"],   // in every room type
  // ── AV44–AV49 (the correction, option B): one darkness for both panels, the chat box's, and nothing dimmed ──
  ["AV44", [[HTML, TINT, TINT + "\n    .prefs-body.prefs-locked .set-sec { background: rgba(12,12,16,0.45); }"]],
    APPLY_G, "R6: THE ROOM SETTINGS, LOCKED — EACH CARD'S BLACK IS THE CHAT BOX'S DARKNESS, FROM THE SAME RULE AS THIS DEVICE'S", "RED"],   // the same look, a second copy
  ["AV45", [[HTML, TINT, TINT + "\n    .prefs-body.prefs-locked { opacity: 0.55; }"]],
    APPLY_G, "R6: AND ITS WORDS, CHECKBOXES AND BUTTONS ARE NOT DIMMED", "RED"],   // this device's old dim back: the words at 0.55
  ["AV46", [[HTML, TINT, TINT.replace(".prefs-body.prefs-locked > .set-row,", ".prefs-body.prefs-locked > .set-row, .prefs-body.prefs-locked .set-sec-body > .set-row,")]],
    APPLY_G, "R6: A ROW INSIDE A CARD STAYS SEE-THROUGH", "RED"],   // the darkness laid on the rows as well: a row darker than its card
  ["AV47", [[HTML, TINT, TINT.replace(", .prefs-body.prefs-locked > .set-row,", ",")]],
    APPLY_G, "R6: A LONE ROW TAKES THE DARKNESS TOO", "RED"],   // a row standing alone left solid
  ["AV48", [[HTML, TINT, TINT.replace(" .prefs-body.prefs-locked .pref-section,", "")]],
    APPLY_G, "R6: THIS DEVICE'S SETTINGS, LOCKED — EACH CARD'S BLACK IS THE CHAT BOX'S DARKNESS", "RED"],   // this device's cards left solid: the two panels apart
  ["AV49", [[HTML, TINT, TINT.replace("{ background: rgba(12,12,16,0.45); }", "{ background: rgba(12,12,16,0.45); border: 1px solid rgba(255,255,255,0.06); }")]],
    APPLY_G, "R6: LOCKED, A CARD KEEPS ITS FRAME AND AN ADVANCED CARD ITS OUTLINE", "RED"],   // the chat box's frame taken with its darkness

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
      const h = J.open("mutate-j127-advanced:" + id, file);   // journalled BEFORE the write
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
