// tools/probes/mutate-j128-chat-button.js
// SUBJECT: J128 — the chat button (the owner's decisions): `features/room.js` (membership asked of every chat, the membership
// trigger, a re-join re-resolved, the lost view cleared, Go to Present, a room opened again opening afresh, Present's
// `pastMessages: false`), `core/chatprefs.js` (`goToPresent`: on by default, per device and account, no `onChange`),
// `backends/backend1/matrixbridge.js` (`recentChatMessages`' window: readable only, bounded, what is missing in one request),
// `ui/chat.js` (the button and menu, the typing lock, the note strip and the deletion's note on it, Present's empty opening),
// `ui/shell.js` (the lock asked first by the send, the strip's holder) and `index.html` (the strip's and the button's rules).
// The owner's two corrections at ddjp_649: the twenty whatever else is fetching (`_olderFetch`, `_noteOlder`, the ride loop;
// CB21–CB23 re-anchored, CB66–CB68) and Present's floor by a server stamp (`newestStampIn`, `Room.chatFloor`, the panel's
// door; CB69–CB76), held by `check-chat-picker` H and I. And at ddjp_650: every chat shows what it opened with and what is said
// after, nothing older (the panel's anchor, `Room.chatOpenedAt`; CB79–CB84, CB72–CB74 re-anchored), held by PART J; CB78
// measures the owner's plant on the chat's own noted request (green: redundant today, and the line says so). And at ddjp_665:
// a chat opens on exactly its last twenty, in order — each read of the window from a fixed copy, `held` from that copy, a failed
// ridden fetch not taken for the chat's start (CB85–CB87, CB90), and the panel's line the oldest message the read returned
// (CB88, CB89; CB79–CB81 re-anchored, CB80 now the line taken over everything held), held by PART K.
// And at ddjp_670 (two parts of the job the owner chose): the button and the menu redrawn only when what they show changes
// (`_renderChatPicker`'s record; CB91–CB94, CB40 re-anchored), held by PART L; and no send target when the last readable chat
// goes (`Room.applyChatTiers`, `chatGone`, `Chat.setRoom(null)` and `send`'s re-check in `features/chat.js`, the panel's
// `_applySendState`, `sendChat`'s re-check; CB95–CB104, CB48 re-anchored; CB95–CB98 a lattice), held by PART M. And at ddjp_671
// (the owner, S1: "make send turn grey yes"): a disabled Send in the Skip button's grey, one rule (`index.html`'s
// `.skip-btn:disabled, .chat-input-row > button:disabled`), by either cause; enabled as it was; the box's tint kept — CB105–CB111,
// held by PART M's sheet rows.
// Held by `check-chat-picker` A–M, `check-chat-tiers` C, E and G, `check-chat-view` J and `check-late-chat` C. One row per
// way it could go wrong, each naming the failure it must cause. CB28–CB31 are not here: they broke "a deleted message leaves
// no mark", which the owner withdrew (the mark stays, `check-chat-redaction` D and `check-chat-view` G hold it).
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes
// are back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE:
// each file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not
// there at either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed.
// Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j128-chat-button.js            every row
//   node tools/probes/mutate-j128-chat-button.js CB3 CB9    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const ROOM = "features/room.js", CP = "core/chatprefs.js", MB = "backends/backend1/matrixbridge.js", UI = "ui/chat.js",
  SHELL = "ui/shell.js", HTML = "index.html", CHAT = "features/chat.js";
const PICK = "check-chat-picker", TIERS = "check-chat-tiers", VIEW = "check-chat-view", LATE = "check-late-chat";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── WHICH CHATS: MEMBERSHIP, ASKED OF EVERY CHAT ──
  ["CB1", [[ROOM, "      if (!_joinedChat(ch[key])) continue;   // J128: a chat this account is not in is not offered\n", ""]],
    PICK, "A: A DEMOTION'S KICK TAKES STAFF AWAY AT ONCE", "RED"],                                         // membership asked of presence alone again
  ["CB2", [[ROOM, "      if (!_joinedChat(ch[key])) continue;   // J128: a chat this account is not in is not offered\n", ""]],
    TIERS, "C: A CHAT THIS ACCOUNT IS NOT JOINED TO IS NOT OFFERED", "RED"],                                 // the same, read by the resolver's own guard
  ["CB3", [[ROOM, "MatrixBridge.amJoined(roomId)); }\n    catch (e) { return false; }", "MatrixBridge.amJoined(roomId)); }\n    catch (e) { return true; }"]],
    TIERS, "C: and an unreadable membership offers nothing", "RED"],                                         // fails open
  // ── THE MEMBERSHIP TRIGGER, AND WHAT IT TELLS ──
  ["CB4", [[ROOM, "    MatrixBridge.onRoomsChanged(_onMembershipChats);\n", ""]],
    PICK, "A: and Chat no longer receives from the staff chat", "RED"],                                     // no trigger: offered only when asked
  ["CB5", [[ROOM, "showing \" + (r.activeTier || \"none\"));\n    for (const fn of _chatTiersListeners.slice()) { try { fn(); } catch (e) {} }", "showing \" + (r.activeTier || \"none\"));"]],
    PICK, "A: and the panel is told", "RED"],                                                                // re-resolved, the panel never told
  ["CB6", [[ROOM, "    if (after === before) return;\n", ""]],
    PICK, "A CONTROL: a membership change that leaves the chats as they were tells the panel nothing", "RED"],   // tells on every event
  ["CB7", [[ROOM, "{ _onMembershipChats(); return; }", "return;"]],
    PICK, "A: A RE-ADD BRINGS PRESENT BACK", "RED"],                                                          // the already-mapped silence again
  // ── THE VIEW: LOST, GO TO PRESENT, AN OPENING ──
  ["CB8", [[ROOM, "      try { ChatPrefs.setChatTier(null); moved = true; } catch (e) {}", "      moved = false;"]],
    PICK, "A: the view follows the room again — the lost pick is cleared", "RED"],                           // the lost pick left to return
  ["CB9", [[ROOM, "    if (go && now.presence && !was.presence) {", "    if (false && go && now.presence && !was.presence) {"]],
    PICK, "B: THE ROOM OPENS WITH PRESENT READABLE, AND THE VIEW IS PRESENT", "RED"],                         // no Go to Present
  ["CB10", [[ROOM, "    if (go && now.presence && !was.presence) {", "    if (now.presence && !was.presence) {"]],
    PICK, "B: OFF, the room opens on its main chat though Present is readable", "RED"],                       // the device's answer ignored
  ["CB11", [[ROOM, "    if (go && now.presence && !was.presence) {", "    if (go && now.presence) {"]],
    PICK, "B: A PICK HOLDS", "RED"],                                                                          // goes to Present on every resolution
  ["CB12", [[ROOM, "_chatWired = false; _chatSeen = null; if (typeof Chat", "_chatWired = false; if (typeof Chat"]],
    PICK, "B: AND THE SAME ROOM OPENED AGAIN, Present readable, opens on Present", "RED"],                    // leaving remembers what was readable
  ["CB13", [[ROOM, "level: null, pastMessages: false });", "level: null });"]],
    PICK, "C: PRESENT ASKS FOR NOTHING", "RED"],                                                              // Present backfilled like the rest
  // ── GO TO PRESENT, STORED ──
  ["CB14", [[CP, "      goToPresent: true,\n", "      goToPresent: false,\n"]],
    PICK, "B: Go to Present is ON by default", "RED"],
  ["CB15", [[CP, "_state.goToPresent = (_state.goToPresent !== false);", "_state.goToPresent = (_state.goToPresent === true || _state.goToPresent === undefined);"]],
    PICK, "is not a real false, and reads as on", "RED"],                                                     // a stored junk value reads off
  ["CB16", [[CP, "function setGoToPresent(v)  { _st().goToPresent = !!v; _save(); }", "function setGoToPresent(v)  { _st().goToPresent = !!v; }"]],
    PICK, "B: turning it off is stored", "RED"],
  ["CB17", [[CP, "function setGoToPresent(v)  { _st().goToPresent = !!v; _save(); }", "function setGoToPresent(v)  { _st().goToPresent = !!v; _save(); _emit(); }"]],
    PICK, "B: flipping it fires no onChange", "RED"],
  // ── PAST MESSAGES: THE WINDOW ──
  ["CB18", [[MB, "const win = (opts && typeof opts.window === \"number\" && opts.window > 0) ? Math.floor(opts.window) : 0;", "const win = 0;"]],
    PICK, "C: sparse history — BOTH PEOPLE GET TWENTY READABLE", "RED"],                                      // the window ignored: 647's fetch
  ["CB19", [[MB, "        if (failed && readableOnly) continue;\n", ""]],
    PICK, "undecryptable messages are not counted and not returned", "RED"],
  ["CB20", [[MB, "      const from = win ? Math.max(0, tl.length - win) : 0;", "      const from = 0;"]],
    PICK, "C: THE WINDOW BOUNDS THE LOOK", "RED"],                                                            // looks past the window
  // Re-anchored at ddjp_649: the window's request is noted (`_noteOlder`) and asked inside the ride loop.
  ["CB21", [[MB, "        try { await _noteOlder(roomId, client.scrollback(room, win - held)); }", "        try { await _noteOlder(roomId, client.scrollback(room, win)); }"]],
    PICK, "the short timeline asks for exactly what is missing of the window", "RED"],
  ["CB22", [[MB, "        if (out.length >= want || held >= win) break;", "        if (held >= win) break;"]],
    PICK, "C: dense — twenty readable already held in the window: NOTHING is missing, no request", "RED"],
  // Re-aimed at ddjp_649: "at most one request of its own" is now a loop's guard; without it a short answer is asked again.
  ["CB23", [[MB, "        if (asked) break;                            // at most ONE request of its own (the owner's)\n", ""]],
    PICK, "H: AT MOST ONE REQUEST OF ITS OWN", "RED"],                                                       // pages instead of one request
  ["CB24", [[UI, "Chat.backfillRecent(CHAT_BACKFILL, channelId, { window: CHAT_HISTORY_WINDOW })", "Chat.backfillRecent(CHAT_BACKFILL, channelId)"]],
    PICK, "C: each asks for twenty, in the owner's window of 200 events", "RED"],
  ["CB25", [[UI, "      if (t.pastMessages === false) { v.backfilled = true;", "      if (false) { v.backfilled = true;"]],
    PICK, "C: PRESENT ASKS FOR NOTHING", "RED"],                                                              // the panel ignores the answer
  // ── A DELETION: ITS NOTE FADES, ITS MARK STAYS (the owner's correction to J128) ──
  ["CB26", [[UI, "      _noteChatOnce(CHAT_DELETE_NOTE);\n      return;", "      _noteChatStay(CHAT_DELETE_NOTE);\n      return;"]],
    PICK, "G: at 4 s the note fades", "RED"],                                                                 // the deletion's note stays up
  ["CB27", [[UI, "    if (record.redacted) {\n      const t = document.createElement(\"span\");", "    if (false) {\n      const t = document.createElement(\"span\");"]],
    PICK, "G: THE MESSAGE KEEPS ITS \"Message deleted\" MARK", "RED"],                                        // the mark taken away
  // ── THE BUTTON AND THE MENU ──
  ["CB32", [[UI, "letter: String(_chatTierName(t.tier) || \"?\").charAt(0).toUpperCase(),", "letter: String(_chatTierName(t.tier) || \"?\"),"]],
    PICK, "D: it shows ONE LETTER", "RED"],
  ["CB33", [[UI, "    const others = rows.filter((x) => !x.active);", "    const others = rows;"]],
    PICK, "D CONTROL: traffic in the chat ON SCREEN puts no dot on the button", "RED"],
  ["CB34", [[UI, "const dot = others.some((x) => x.mentioned) ? \"mentioned\" : (others.some((x) => x.unread) ? \"unread\" : null);",
    "const dot = others.some((x) => x.unread) ? \"unread\" : (others.some((x) => x.mentioned) ? \"mentioned\" : null);"]],
    PICK, "D: A MENTION OF YOU THERE MAKES IT PURPLE", "RED"],                                                // orange over purple
  ["CB35", [[UI, "(t.mentioned ? \" mentioned\" : (t.unread ? \" unread\" : \"\")),\n          type: \"button\", role: \"menuitem\"",
    "(t.mentioned ? \" mentioned\" : \"\") + (t.unread ? \" unread\" : \"\"),\n          type: \"button\", role: \"menuitem\""]],
    VIEW, "J: ITS MENU ITEM CARRIES THE PURPLE DOT", "RED"],                                                  // both dots on one item
  ["CB36", [[UI, "          t.main ? [H.el(\"span\", { class: \"chat-tier-main\", text: \"\\u2713\", \"aria-label\": \"main\" })] : null);\n        item.dataset.tier",
    "          [H.el(\"span\", { class: \"chat-tier-main\", text: \"\\u2713\", \"aria-label\": \"main\" })]);\n        item.dataset.tier"]],
    PICK, "D: THE MAIN CHAT CARRIES THE ✓", "RED"],
  ["CB37", [[UI, "class: \"chat-pick-item\" + (t.active ? \" active\" : \"\")", "class: \"chat-pick-item\""]],
    PICK, "D: and the CURRENT chat is marked", "RED"],
  ["CB38", [[UI, "    if (refs.chatInput) refs.chatInput.placeholder = cur ?", "    if (false) refs.chatInput.placeholder = cur ?"]],
    PICK, "D: THE TEXT BOX'S HINT NAMES THE CHAT IN FULL", "RED"],
  ["CB39", [[UI, "      goBox.checked = go;", "      goBox.checked = true;"]],
    TIERS, "G: and unticked when it says off", "RED"],
  // CB40 RE-ANCHORED AT ddjp_670: the box's change also takes its tick into the drawn record (PART L); the store is still what goes.
  ["CB40", [[UI, "      goBox.onchange = () => { try { ChatPrefs.setGoToPresent(!!goBox.checked); } catch (e) {} host._drawn = record(!!goBox.checked); };",
    "      goBox.onchange = () => { host._drawn = record(!!goBox.checked); };"]],
    PICK, "D: and unticking it is what the device remembers", "RED"],
  ["CB41", [[UI, "        item.onclick = () => { host._open = false; _selectChatTier(t.tier); };", "        item.onclick = () => { _selectChatTier(t.tier); };"]],
    PICK, "the menu closes", "RED"],                                                                          // a pick leaves the menu open
  // ── THE TYPING LOCK ──
  ["CB42", [[UI, "    if (m.started && was && m.activeId !== was && _draftHeld()) _setChatLock(m, true);", "    if (false) _setChatLock(m, true);"]],
    PICK, "E: THE CHAT CHANGED UNDER UNSENT TEXT, SO IT LOCKS", "RED"],
  ["CB43", [[UI, "    if (m.started && was && m.activeId !== was && _draftHeld()) _setChatLock(m, true);", "    if (m.started && was && m.activeId !== was) _setChatLock(m, true);"]],
    PICK, "E: AN EMPTY BOX: the move happens and nothing locks", "RED"],
  ["CB44", [[UI, "    if (m.started && was && m.activeId !== was && _draftHeld()) _setChatLock(m, true);", "    if (m.started && m.activeId !== was && _draftHeld()) _setChatLock(m, true);"]],
    PICK, "E: A CHAT ARRIVING WHERE THERE WAS NONE LOCKS NOTHING", "RED"],
  ["CB45", [[UI, "    if (m.locked) _setChatLock(m, false);\n", ""]],
    PICK, "E: PICKING A CHAT ENDS IT", "RED"],
  ["CB46", [[UI, "    host._open = false;\n    _renderChatPicker();\n  }", "    host._open = false;\n    if (refs.chatBox && refs.chatBox._chat) _setChatLock(refs.chatBox._chat, false);\n    _renderChatPicker();\n  }"]],
    PICK, "E: and so does closing it from outside", "RED"],                                                   // closing without a pick unlocks
  ["CB47", [[UI, "  function _chatLocked() { const b = refs.chatBox; return !!(b && b._chat && b._chat.locked); }",
    "  function _chatLocked() { const b = refs.chatBox; return !!(b && b._chat && b._chat.locked) && _draftHeld(); }"]],
    PICK, "E: EMPTYING THE BOX KEEPS IT", "RED"],
  // CB48 RE-ANCHORED AT ddjp_670: Send's grey is set in one place now, for the lock and for no chat to send to (PART M); the
  // lock's half goes, as the line did.
  ["CB48", [[UI, "    try { if (refs.chatSend) refs.chatSend.disabled = gone || _chatLocked(); } catch (e) {}\n", "    try { if (refs.chatSend) refs.chatSend.disabled = gone; } catch (e) {}\n"]],
    PICK, "Send is GREYED", "RED"],
  ["CB49", [[UI, "    if (on) { try { if (refs.chatInput && typeof refs.chatInput.blur === \"function\") refs.chatInput.blur(); } catch (e) {} }\n", ""]],
    PICK, "the box LOSES FOCUS", "RED"],
  ["CB50", [[UI, "(lab.dot ? \" \" + lab.dot : \"\") + (locked ? \" locked\" : \"\")", "(lab.dot ? \" \" + lab.dot : \"\")"]],
    PICK, "the chat button carries the RED OUTLINE", "RED"],
  ["CB51", [[SHELL, "      if (ChatPanels.chatLocked && ChatPanels.chatLocked()) return;\n", ""]],
    PICK, "E: ENTER DOES NOTHING, EVEN AFTER CLICKING BACK INTO THE BOX", "RED"],
  ["CB52", [[HTML, ".chat-input-row .chat-pick-btn.locked { outline: 2px solid #ff6b6b;", ".chat-input-row .chat-pick-btn.locked { outline: 2px solid #5865F2;"]],
    PICK, "the over-limit counter's red", "RED"],                                                             // the outline's colour
  // ── THE NOTE STRIP ──
  ["CB53", [[UI, "    st.t1 = setTimeout(() => {\n      st.fading = true; _noteDraw();", "    st.t1 = (() => 0)(() => {\n      st.fading = true; _noteDraw();"]],
    PICK, "F: AT 4 S IT FADES", "RED"],                                                                       // a one-off never fades
  ["CB54", [[UI, "const NOTE_ONCE_MS = 4000, NOTE_FADE_MS = 500;", "const NOTE_ONCE_MS = 3000, NOTE_FADE_MS = 500;"]],
    PICK, "F: and is still there at 3.999 s", "RED"],
  ["CB55", [[UI, "const NOTE_ONCE_MS = 4000, NOTE_FADE_MS = 500;", "const NOTE_ONCE_MS = 4000, NOTE_FADE_MS = 100;"]],
    PICK, "F: over half a second", "RED"],
  ["CB56", [[UI, "    st.once = text || \"\"; st.fading = false;\n    _noteDraw();", "    st.once = text || \"\"; st.fading = false; st.stay = \"\";\n    _noteDraw();"]],
    PICK, "F: then it is gone, and the note that is still true shows again", "RED"],                         // a one-off wipes a true note
  ["CB57", [[UI, "    if (!fromSend && !st.long) return;\n", ""]],
    PICK, "F: the box's own counter never raises", "RED"],
  ["CB58", [[UI, "    if (cap && n <= cap) { if (st.long) _noteChatStay(\"\"); return; }", "    if (false) { if (st.long) _noteChatStay(\"\"); return; }"]],
    PICK, "F: and it goes when the text fits", "RED"],
  ["CB59", [[UI, "    if (m.activeId && st && st.stay === CHAT_CONNECTING_NOTE) _noteChatStay(\"\");", "    if (false) _noteChatStay(\"\");"]],
    LATE, "C: and it goes once the chat is there", "RED"],
  ["CB60", [[UI, "  function _noteChatSent() { _noteChatStay(\"\"); }", "  function _noteChatSent() {}"]],
    PICK, "F: or when a message is sent", "RED"],
  ["CB61", [[HTML, ".chat-note-bar { position: relative; height: 0;", ".chat-note-bar { position: relative; height: 18px;"]],
    PICK, "F: THE STRIP TAKES NO LAYOUT SPACE", "RED"],
  ["CB62", [[HTML, "text-align: center; pointer-events: none; opacity: 1;", "text-align: center; opacity: 1;"]],
    PICK, "F: the strip floats over the chat, takes no clicks", "RED"],
  ["CB63", [[HTML, "left: 8px; right: 8px; bottom: 34px; z-index: 2; display: none;", "left: 8px; right: 8px; bottom: 12px; z-index: 2; display: none;"]],
    PICK, "F: AND IT SITS ABOVE \"Back to live\", NEVER OVER IT", "RED"],
  ["CB64", [[HTML, "height: 0; margin-top: -8px; pointer-events: none; }", "height: 0; pointer-events: none; }"]],
    PICK, "F: the holder cancels the column's gap", "RED"],
  ["CB65", [[SHELL, "      el(\"div\", { class: \"chat-note-bar\" }, [refs.chatNote]),\n", "      refs.chatNote,\n"]],
    PICK, "F: the shell puts the strip's holder right after the box", "RED"],
  // ── THE TWENTY, WHATEVER ELSE IS FETCHING THAT CHAT (the owner's correction to J128, ddjp_649) ──
  ["CB66", [[MB, "        const riding = _olderFetch[roomId];", "        const riding = null;"]],
    PICK, "H: PEOPLE FIRST (THE SCREEN'S ORDER)", "RED"],                                                    // never rides: 648's 12
  ["CB67", [[MB, "      try { await _noteOlder(roomId, client.scrollback(room, 100)); } catch (e) { out.reachedTs = oldestTs(); return out; }",
    "      try { await client.scrollback(room, 100); } catch (e) { out.reachedTs = oldestTs(); return out; }"]],
    PICK, "H: PEOPLE FIRST (THE SCREEN'S ORDER)", "RED"],                                                    // the read-back's page not noted
  ["CB68", [[MB, "    p.then(done, done);\n    return p;", "    return p;"]],
    PICK, "H: PEOPLE FIRST (THE SCREEN'S ORDER)", "RED"],                                                    // a settled fetch never cleared
  // ── PRESENT'S FLOOR: NOTHING SAID BEFORE THIS TAB FIRST HAD IT (the owner's correction to J128, ddjp_649) ──
  ["CB69", [[UI, "    if (typeof floor === \"number\" && !((Number(ts) || 0) > floor)) return;\n", ""]],
    PICK, "I: A MESSAGE STAMPED BEFORE THE FLOOR", "RED"],                                                   // the panel's door gone
  ["CB70", [[UI, "    if (typeof floor === \"number\" && !((Number(ts) || 0) > floor)) return;", "    if (typeof floor === \"number\" && (Number(ts) || 0) < floor) return;"]],
    PICK, "I: AND PRESENT SHOWS ONLY WHAT CAME AFTER", "RED"],                                               // the newest held lets through
  ["CB71", [[ROOM, "        try { s = MatrixBridge.newestStampIn ? MatrixBridge.newestStampIn(t.id) : null; } catch (e) { s = null; }",
    "        try { s = Date.now(); } catch (e) { s = null; }"]],
    PICK, "I: one stamped after it is live", "RED"],                                                         // the device clock as the floor
  // CB72–CB74 re-anchored at ddjp_650: the opening is recorded for every chat (`_chatSeen.opened`), Present's marked `noPast`.
  ["CB72", [[ROOM, "      if (typeof _chatSeen.opened[t.id] !== \"number\") {",
    "      if (typeof _chatSeen.opened[t.id] !== \"number\" || !was[t.tier]) {"]],
    PICK, "I: THROUGH A KICK AND A RE-ADD THE FLOOR STAYS", "RED"],                                         // re-taken at every re-add
  ["CB73", [[ROOM, "    if (!Object.prototype.hasOwnProperty.call(_chatSeen.noPast, channelId)) return null;\n", ""]],
    PICK, "I: the other chats have none", "RED"],                                                           // every chat floored
  ["CB74", [[ROOM, "    return typeof f === \"number\" ? f : Infinity;", "    return typeof f === \"number\" ? f : null;"]],
    PICK, "I: A STAMP THAT CANNOT BE READ SHOWS NOTHING", "RED"],                                            // fails open
  ["CB75", [[MB, "        if (!ev || ev.status) continue;", "        if (!ev) continue;"]],
    PICK, "I: THE STAMP IS THE SERVER'S", "RED"],                                                            // a local echo's device clock
  ["CB76", [[MB, "      const ts = mine && !mine.status ? _tsOfItem(mine) : null;", "      const ts = null;"]],
    PICK, "I: and with nothing held, this account's own join is the stamp", "RED"],                         // the join not read
  // MEASURED, NOT A ROW THAT CAN GO RED: an own request that brought nothing older stops the loop at once. It is a backstop —
  // the at-most-one guard above stops it on the next pass — so with it gone every row stays green. Without BOTH, a request at
  // the chat's start (the SDK answers at once, bringing nothing) would be asked forever: CB23 first hung that way.
  ["CB77", [[MB, "        if (room.timeline.length <= held) break;     // it brought nothing older (the start, or a failure): read no further\n", ""]],
    PICK, null, "GREEN"],
  // MEASURED, NOT A ROW THAT CAN GO RED (the owner's plant at ddjp_650, and the line now says so): the chat's own request
  // noted in `_olderFetch`. The only read that can start while it is out is `_pageBackTo`, which the SDK hands the same
  // promise; the one windowed read of a chat is the panel's. Dropped, every row stays green.
  ["CB78", [[MB, "        try { await _noteOlder(roomId, client.scrollback(room, win - held)); }", "        try { await client.scrollback(room, win - held); }"]],
    PICK, null, "GREEN"],
  // ── EVERY CHAT: WHAT IT OPENED WITH AND WHAT IS SAID AFTER, NOTHING OLDER (the owner's correction, ddjp_650) ──
  // CB79–CB81 re-anchored at ddjp_665: the line's block lost a level of nesting when the "more than twenty drawn" branch went.
  ["CB79", [[UI, "      v.anchor = first || ALL_HELD;   // no server stamp of any kind to measure by: what arrives is shown",
    "      v.anchor = ALL_HELD;"]],
    PICK, "J: THREE MESSAGES OLDER THAN ALL TWENTY ARE NOT SHOWN", "RED"],                                  // 649's anchor
  ["CB80", [[UI, "      for (const k of buf.ids()) { if (opened[k]) { const r = buf.get(k); first = { ts: r.ts, key: k }; break; } }",
    "      for (const k of buf.ids()) { if (buf.get(k)) { const r = buf.get(k); first = { ts: r.ts, key: k }; break; } }"]],
    PICK, "J: A LATE DECRYPT OLDER THAN THE TWENTY IS NOT DRAWN", "RED"],                                   // any record held as the line
  ["CB81", [[UI, "        if (typeof s === \"number\") first = { ts: s, key: \"\\uffff\" };   // the stamp itself is before: nothing at it shows\n", ""]],
    PICK, "J: OPENED WITH NOTHING", "RED"],                                                                  // an empty opening shows everything
  ["CB82", [[UI, "first = { ts: s, key: \"\\uffff\" };", "first = { ts: s, key: \"\" };"]],
    PICK, "J: OPENED WITH NOTHING", "RED"],                                                                  // the opening's own stamp let through
  ["CB83", [[ROOM, "      if (typeof _chatSeen.opened[t.id] !== \"number\") {", "      if (_chatSeen.noPast[t.id] && typeof _chatSeen.opened[t.id] !== \"number\") {"]],
    PICK, "J: THE ROOM RECORDS EVERY CHAT'S OPENING", "RED"],                                                // Present's alone, as at 649
  ["CB84", [[ROOM, "      if (t.pastMessages === false) _chatSeen.noPast[t.id] = true;\n", ""]],
    PICK, "I: AT THE OPENING PRESENT'S FLOOR IS THE NEWEST SERVER STAMP", "RED"],                            // Present not marked
  // ── EXACTLY ITS LAST TWENTY, IN ORDER, WHILE THE PEOPLE LIST PAGES IT (the owner's correction to J128, ddjp_665) ──
  ["CB85", [[MB, "      const tl = room.timeline.slice();   // A FIXED COPY", "      const tl = room.timeline;   // A FIXED COPY"]],
    PICK, "K1: A TAB HOLDING 150 EVENTS, THE NEWEST STILL DECRYPTING", "RED"],                               // the live array walked by index (664)
  ["CB86", [[MB, "        const held = read.held;", "        const held = room.timeline.length;"]],
    PICK, "K1: A TAB HOLDING 150 EVENTS, THE NEWEST STILL DECRYPTING", "RED"],                               // `held` read after the walk (664)
  ["CB87", [[MB, "          if (!failed && room.timeline.length <= held) break;", "          if (room.timeline.length <= held) break;"]],
    PICK, "K2: A RIDDEN FETCH THAT FAILED IS NOT THE CHAT'S START", "RED"],                                  // a failed ride taken for the start (664)
  ["CB88", [[UI, "      for (const k of buf.ids()) { if (opened[k]) {", "      for (const k of buf.ids()) { if (!buf.get(k).failed) {"]],
    PICK, "K3b: WITH NO PAGE AT ALL", "RED"],                                                                // the oldest READABLE held as the line (664)
  ["CB89", [[UI, "      let first = null;\n      for (const k of buf.ids()) { if (opened[k]) {",
    "      const drawn = ChatBuffer.view(buf, [], { tail: Number.MAX_SAFE_INTEGER, showLong: false }).items;\n" +
    "      let first = drawn.length > CHAT_BACKFILL ? { ts: drawn[drawn.length - CHAT_BACKFILL].ts, key: drawn[drawn.length - CHAT_BACKFILL].key } : null;\n" +
    "      if (!first) for (const k of buf.ids()) { if (opened[k]) {"]],
    PICK, "K4: A MESSAGE SAID WHILE THE CHAT OPENS GOES UNDER THE TWENTY", "RED"],                           // 664's "more than twenty drawn" back
  ["CB90", [[MB, "      out = (await readTail(false)).out;", "      out = await readTail(false);"]],
    PICK, "C threw", "RED"],                                                                                 // a DM's read given the window read's shape
  // ── THE BUTTON AND MENU, REDRAWN ONLY WHEN WHAT THEY SHOW CHANGES (`ddjp_670`; PART L) ──
  ["CB91", [[UI, "    if (host._drawn === record(go) && host.firstChild && !host._focusTier) {", "    if (false) {"]],
    PICK, "L: A LIVE MESSAGE KEEPS THE SAME BUTTON", "RED"],                                                   // 669: rebuilt for every live message
  ["CB92", [[UI, "    const record = (g) => JSON.stringify([cur ? [cur.letter, cur.label] : null, lab.dot, locked, open,",
    "    const record = (g) => JSON.stringify([cur ? [cur.letter, cur.label] : null, locked, open,"]],
    PICK, "D: A NEW MESSAGE IN ANOTHER CHAT PUTS AN ORANGE DOT ON THE BUTTON", "RED"],                       // the record blind to the dot: closed, it never shows
  ["CB93", [[UI, " } catch (e) {} host._drawn = record(!!goBox.checked); };", " } catch (e) {} };"]],
    PICK, "L: AND UNTICKING \"Go to Present\" IS NOT UNDONE OR REBUILT BY THE NEXT MESSAGE", "RED"],          // the box's own tick not taken: the next message rebuilds it
  ["CB94", [[UI, "    const record = (g) => JSON.stringify([cur ? [cur.letter, cur.label] : null, lab.dot, locked, open,",
    "    const record = (g) => JSON.stringify([null, lab.dot, locked, open,"]],
    PICK, "L CONTROL: THE VIEW MOVING ALONE", "RED"],                                                        // blind to the letter: a view moved keeps the old one
  // ── NO SEND TARGET WHEN THE LAST READABLE CHAT GOES (`ddjp_670`; PART M) ──
  // THE LATTICE (CB95–CB98): the room clears Chat's target, and `Chat.send` re-checks that its target is readable. Each alone
  // suffices — dropping either leaves the guard green (MEASURED, not a survivor) — and dropping both goes red.
  ["CB95", [[ROOM, "    try { Chat.setRoom(r.activeId || null); } catch (e) {}", "    if (r.activeId) { try { Chat.setRoom(r.activeId); } catch (e) {} }"]],
    PICK, "", "GREEN"],                                                                                        // lattice: 669's decision alone; the send's re-check holds
  ["CB96", [[CHAT, "    if (!currentChatId || _readable.indexOf(currentChatId) < 0) { Logger.warn(\"Chat: no chat to send to\"); return { ok: false, reason: \"no-room\" }; }\n", ""]],
    PICK, "", "GREEN"],                                                                                        // lattice: the re-check alone; the decision holds
  ["CB97", [[ROOM, "    try { Chat.setRoom(r.activeId || null); } catch (e) {}", "    if (r.activeId) { try { Chat.setRoom(r.activeId); } catch (e) {} }"],
            [CHAT, "    if (!currentChatId || _readable.indexOf(currentChatId) < 0) { Logger.warn(\"Chat: no chat to send to\"); return { ok: false, reason: \"no-room\" }; }\n", ""]],
    PICK, "M: THERE IS NO SEND TARGET", "RED"],                                                               // lattice: both — the room just left is still the target
  ["CB98", [[CHAT, "    if (!chatId) { if (currentChatId) Logger.debug(\"Chat: no chat to send to\"); currentChatId = null; return; }\n", "    if (!chatId) return;\n"],
            [CHAT, "    if (!currentChatId || _readable.indexOf(currentChatId) < 0) { Logger.warn(\"Chat: no chat to send to\"); return { ok: false, reason: \"no-room\" }; }\n", ""]],
    PICK, "M: THERE IS NO SEND TARGET", "RED"],                                                               // `setRoom(null)` a no-op again, and no re-check
  ["CB99", [[UI, "  function _chatGone() { try { return !!(Room.chatTiers() || {}).chatGone; } catch (e) { return false; } }", "  function _chatGone() { return false; }"]],
    PICK, "M: THE SEND BOX CANNOT BE TYPED INTO", "RED"],                                                    // the panel never told: the box typeable
  ["CB100", [[UI, "        refs.chatInput.disabled = gone;\n", "        refs.chatInput.disabled = false;\n"]],
    PICK, "M: THE SEND BOX CANNOT BE TYPED INTO", "RED"],                                                    // Send greyed, the box still typeable
  ["CB101", [[SHELL, "      if (ChatPanels.chatGone && ChatPanels.chatGone()) return;\n", ""]],
    PICK, "M: AND IT SAYS NOTHING NEW", "RED"],                                                               // the send not asked: Enter says "still connecting", untrue
  ["CB102", [[ROOM, "    const gone = !active && !!(_chatSeen && _chatSeen.room === current.spaceId && _chatSeen.offered);", "    const gone = !active;"]],
    PICK, "M: AT THE OPENING WITH NO CHAT YET", "RED"],                                                      // "gone" before any chat was offered: the opening's box locked
  ["CB103", [[UI, "    _applySendState();   // the last readable chat gone, or one back (`ddjp_670`)\n", ""]],
    PICK, "M: THE SEND BOX CANNOT BE TYPED INTO", "RED"],                                                    // a membership change not applied to the box
  ["CB104", [[ROOM, "      _chatSeen.offered = true;   // this running room has offered a chat (`chatGone`)\n", ""]],
    PICK, "M: THE SEND BOX CANNOT BE TYPED INTO", "RED"],                                                    // never "offered": the last chat's loss reads as "not yet"
  // ── A DISABLED SEND IS GREY (`ddjp_671`; the owner, S1: "make send turn grey yes") ──
  ["CB105", [[HTML, "    .skip-btn:disabled, .chat-input-row > button:disabled {", "    .skip-btn:disabled {"]],
    PICK, "M: WITH NO CHAT TO SEND TO, SEND IS GREY", "RED"],                                                 // 670: no rule for a disabled Send — it looks enabled
  ["CB106", [[HTML, "    .skip-btn:disabled, .chat-input-row > button:disabled {", "    .skip-btn:disabled, .chat-input-row > button:disabled, .chat-input-row > button:enabled {"]],
    PICK, "M: ENABLED, SEND IS AS IT WAS", "RED"],                                                           // grey whatever its state
  ["CB107", [[HTML, "    .skip-btn:disabled, .chat-input-row > button:disabled {", "    .skip-btn:disabled, button:disabled {"]],
    PICK, "M: WITH NO CHAT TO SEND TO, SEND IS GREY", "RED"],                                                 // a rule the row's blue outranks: still blue
  ["CB108", [[UI, "    try { if (refs.chatSend) refs.chatSend.disabled = gone || _chatLocked(); } catch (e) {}\n", "    try { if (refs.chatSend) refs.chatSend.disabled = gone; } catch (e) {}\n"]],
    PICK, "M: THE TYPING LOCK GREYS IT THE SAME WAY", "RED"],                                                // the lock no longer disables Send: blue (CB48's edit, read as the look)
  ["CB109", [[HTML, "/* disabled: Skip's grey (`.skip-btn:disabled`) */\n", "/* disabled: Skip's grey (`.skip-btn:disabled`) */\n    .chat-input-row > button:disabled { background: #444; }\n"]],
    PICK, "M: WITH NO CHAT TO SEND TO, SEND IS GREY", "RED"],                                                 // a second grey of its own, not Skip's
  ["CB110", [[HTML, "    .skip-btn:disabled, .chat-input-row > button:disabled {", "    .skip-btn:disabled, .chat-input-row > button:disabled, .chat-input-row .chat-pick .chat-pick-btn {"]],
    PICK, "M CONTROL: the chat button beside it", "RED"],                                                     // the grey reaching the chat button too
  ["CB111", [[HTML, "/* disabled: Skip's grey (`.skip-btn:disabled`) */\n", "/* disabled: Skip's grey (`.skip-btn:disabled`) */\n    .chat-input:disabled { background: #333; }\n"]],
    PICK, "M: and the send box keeps the chat's tint, disabled", "RED"],                                       // the disabled box loses the chat's tint
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
      const h = J.open("mutate-j128-chat-button:" + id, file);   // journalled BEFORE the write
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
