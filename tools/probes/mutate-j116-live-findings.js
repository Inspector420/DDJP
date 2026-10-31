// tools/probes/mutate-j116-live-findings.js
// SUBJECT: J116 (`ddjp_621`) — what the owner's live checks on `?v=557` found. Each row puts one fix back the way it was and
// must turn its guard red NAMING it; each control changes nothing and must leave its guard green.
//   LC — a new member's first open of a fresh room gets its chat without a reload (`check-late-chat` A–E).
//   CT — chat is one of the actions that count, on both presence cards, stored as its own boolean (`check-settings-apply` P, Q).
//   PH — People's header is one line (`check-who-is-here` F4).
//   SL — a tab says in its log when it stops or starts being live, once per change (`check-session-log`).
//   RW — REP's rebuild and fill-back say a reaction read twice as that, and what the rebuild moved (`check-rep-bot` R).
// Not rows: `leaveRoom`'s `_markPending.clear()`, and the leave's `_chatWired = false`. A channel of a room just left that is
// announced again is not a channel of the room running here, so the room does not map it; and the next opening sets
// `_chatWired` from its own wiring before anything reads it. Neither changes an answer, so no guard can tell either is
// gone. Both stay as defences.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j116-live-findings.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", SE = "backends/backend1/session.js", RM = "features/room.js", RB = "features/rep-bot.js";
const SHELL = "ui/shell.js", CHAT = "ui/chat.js", SCR = "ui/screens.js", SET = "ui/settings.js", PANELS = "ui/panels.js";
const LC = "check-late-chat", SA = "check-settings-apply", WH = "check-who-is-here", SL = "check-session-log", BT = "check-rep-bot";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── LC: THE LATE CHAT ──
  // LC1 — the creation record arriving no longer announces the channel again.
  ["LC1", [[MB, "      if (t === \"m.room.create\") { _markReadable(stateEvent.getRoomId ? stateEvent.getRoomId() : null); return; }\n", ""]],
    LC, "FAIL — A: once its mark is readable", "RED"],
  // LC2 — the room arriving whole no longer announces it again.
  ["LC2", [[MB, "  function _onRoomArrived(room) { try { _markReadable(room && room.roomId); } catch (e) {} }", "  function _onRoomArrived(room) {}"]],
    LC, "FAIL — D: when the sync hands over the room", "RED"],
  // LC3 — the live client no longer hears the room arriving.
  ["LC3", [[MB, "    client.on(\"Room\", _onRoomArrived);\n", ""]], LC, "FAIL — D: and the live client subscribes both", "RED"],
  // LC4 — a join whose mark is unreadable is not held for its mark: dropped for good, as in the owner's log.
  ["LC4", [[MB, "    if (channelMarkOf(id)) _markPending.delete(id); else _markPending.add(id);", "    _markPending.delete(id);"]],
    LC, "FAIL — A: once its mark is readable", "RED"],
  // LC5 — a late chat is mapped and said to be wired, but nothing subscribes to its messages.
  ["LC5", [[RM, "      try { Chat.init(cc); _chatWired = true;", "      try { _chatWired = true;"]],
    LC, "FAIL — A: a message in the room's chat reaches chat's listeners", "RED"],
  // LC6 — the UI is not told the chat tiers changed.
  ["LC6", [[RM, "    for (const fn of _chatTiersListeners.slice()) { try { fn(); } catch (e) {} }\n", ""]],
    LC, "FAIL — A: and the room tells the UI", "RED"],
  // LC7 — the main screen no longer re-resolves the chat panel on that signal.
  ["LC7", [[SCR, "    if (Room.onChatTiersChanged) Room.onChatTiersChanged(() => ChatPanels.syncChatTier());\n", ""]],
    LC, "FAIL — C: the main screen re-resolves the chat panel", "RED"],
  // LC8 — Enter with no chat says nothing again.
  ["LC8", [[SHELL, "        if (res.reason === \"no-room\") ChatPanels._noteChatConnecting();\n", ""]], LC, "FAIL — C: and says on screen", "RED"],
  // LC9 — the note never goes once the chat is there.
  ["LC9", [[CHAT, "    if (m.activeId && refs.chatNote && refs.chatNote.textContent === CHAT_CONNECTING_NOTE) _setChatNote(\"\");", "    if (false) _setChatNote(\"\");"]],
    LC, "FAIL — C: and it goes once the chat is there", "RED"],
  // LC10 — the join step's line no longer says how long a slow join took.
  ["LC10", [[MB, "return s >= 2 ? \" in \" + Math.round(s) + \" s\" : \"\"; };", "return \"\"; };"]], LC, "FAIL — A: the opening's join-step line says how long", "RED"],
  // LC11 — the late wiring after the tiers instead of before (the ddjp_621 audit's plant; `ddjp_622`): `Chat.init` replaces
  // the readable set, so a chat tier mapped at the opening is dropped from it. Every row above stayed green on it.
  ["LC11", [[RM, "    if (!_chatWired) {\n      const cc = current.channels.chat_uncategorized || current.channels.chat_guest || roomId;\n      try { Chat.init(cc); _chatWired = true; Logger.info(\"Room: chat wired — \" + key + \" was joined after the room opened\"); }\n      catch (e) { Logger.warn(\"Room: \" + key + \" is mapped but chat could not be wired — \" + ((e && e.message) || e)); }\n    }\n    try { applyChatTiers(); }\n    catch (e) { Logger.warn(\"Room: \" + key + \" is mapped but the tier strip was not re-resolved — \"\n      + ((e && e.message) || e)); }\n",
    "    try { applyChatTiers(); }\n    catch (e) { Logger.warn(\"Room: \" + key + \" is mapped but the tier strip was not re-resolved — \"\n      + ((e && e.message) || e)); }\n    if (!_chatWired) {\n      const cc = current.channels.chat_uncategorized || current.channels.chat_guest || roomId;\n      try { Chat.init(cc); _chatWired = true; Logger.info(\"Room: chat wired — \" + key + \" was joined after the room opened\"); }\n      catch (e) { Logger.warn(\"Room: \" + key + \" is mapped but chat could not be wired — \" + ((e && e.message) || e)); }\n    }\n"]],
    LC, "FAIL — E: after the late wiring the staff chat is still in Chat's readable set", "RED"],
  // ── CT: CHAT, A TICK IN THE ACTIONS LIST ──
  // CT1 — DJ presence's list without its chat tick.
  ["CT1", [[SET, "          { key: \"botQueueChat\", value: s.botQueueChat, editable: _editableFor(\"botQueueChat\") });", "          null);"]],
    SA, "FAIL — Q: DJ presence's actions list has a tick", "RED"],
  // CT2 — the merge done the other way: chat stored as a group IN the actions map, not as its own boolean.
  ["CT2", [[SET, "      cb.onchange = () => _stageSetting(chat.key, { [chat.key]: !!cb.checked });", "      cb.onchange = () => _stageSetting(key, { [key]: Object.assign({}, cur, { chat: !!cb.checked }) });"]],
    // PART J flips the same tick first and reads its write, so it is J that names it (Q's own row reads the same).
    SA, "FAIL — J: and Apply sends both in ONE write", "RED"],
  // CT3 — the tick shows ticked whatever the room stores.
  ["CT3", [[SET, "      cb.checked = chat.value === true;", "      cb.checked = true;"]], SA, "FAIL — Q: DJ presence: a room with chat off shows the tick unticked", "RED"],
  // CT4 — locked, the tick can still be changed.
  ["CT4", [[SET, "      cb.disabled = !chat.editable;", "      cb.disabled = false;"]], SA, "FAIL — Q: DJ presence: locked, the tick cannot be changed", "RED"],
  // CT5 — DJ presence's More no longer says chat is never stored.
  ["CT5", [[SET, " never count. Chat is never stored: the bot only notices that a message arrived, never what it said.\",", " never count.\","]],
    SA, "FAIL — P: DJ presence's actions list says chat is never stored", "RED"],
  // ── PH: PEOPLE'S HEADER, ONE LINE ──
  // PH1 — a line back under the header.
  ["PH1", [[PANELS, "      H.el(\"span\", { class: \"muted active-window\", text: lab.window }),\n    ]));\n",
    "      H.el(\"span\", { class: \"muted active-window\", text: lab.window }),\n    ]));\n    refs.activeBox.appendChild(H.el(\"p\", { class: \"muted active-sources\", text: \"Counts queue, votes and saves\" }));\n"]],
    WH, "FAIL — F: THE HEADER IS THE COUNT AND THE WINDOW", "RED"],
  // PH2 — the label builds a line again that nothing draws.
  ["PH2", [[PANELS, "      window: \"in the last \" + span,\n", "      window: \"in the last \" + span,\n      sources: \"Counts queue, votes and saves\",\n"]],
    WH, "FAIL — F: and the label carries only those", "RED"],
  // ── SL: SESSION SAYS WHY ──
  // SL1 — no line at all.
  ["SL1", [[SE, "    _say(from, next, reason || \"\");\n", ""]], SL, "FAIL — A: entering a room says it is replaying", "RED"],
  // SL2 — a sleep's silence not said in seconds. RE-ANCHORED AT J68 (`ddjp_635`), with the reason: the heartbeat's "came N s after
  // the one before" became the sleep's "nothing from its heartbeat or the server for N s" (the owner's decision 1, `ddjp_634`).
  ["SL2", [[SE, "      case \"slept\":           return \"nothing from its heartbeat or the server for \" + _secs(_lateGapMs) + \" (the", "      case \"slept\":           return \"nothing from its heartbeat or the server for a while\" + \" (the"]],
    SL, "FAIL — A: a sleep says it is suspended because nothing came from its heartbeat or the server for 960 s", "RED"],
  // SL3 — becoming live again no longer says for how long it was not.
  ["SL3", [[SE, "    if (next === LIVE && _notLiveSince) tail = \"; not live for \" + _span(now - _notLiveSince);\n", ""]], SL, "FAIL — C:", "RED"],
  // SL4 — the time not live measured from the last change, not from leaving live.
  ["SL4", [[SE, "    if (from === LIVE) _notLiveSince = now;", "    if (_notLiveSince || from === LIVE) _notLiveSince = now;"]], SL, "FAIL — C:", "RED"],
  // SL5 — the sign of life that ended a sleep not named: an answer said as the heartbeat. RE-ANCHORED AT J68 (`ddjp_635`), with
  // the reason: a sleep's suspension waits for a sign of life that is not itself a sleep, so the "still late" run it named is gone.
  ["SL5", [[SE, "(_lifeFrom === \"answer\" ? \"the server answered again, \" : \"the heartbeat ran again, \")", "\"the heartbeat ran again, \""]],
    SL, "FAIL — A: the next sign — an answer — says it is catching up because the server answered again", "RED"],
  // ── RW: REP'S REBUILD, IN WORDS THAT DO NOT READ AS A DOUBLE COUNT ──
  // RW1 — a reaction read twice is read twice again: its second reading said as "already counted".
  ["RW1", [[RB, "if (seen.has(id)) { twice++; continue; } seen.add(id);", "if (seen.has(id)) { twice++; } seen.add(id);"]],
    BT, "FAIL — R: THE LINE SAYS THE REACTIONS READ TWICE WERE TAKEN ONCE", "RED"],
  // RW2 — the rebuild says it moved one person per reaction read.
  ["RW2", [[RB, "      const moved = Object.keys(add).filter((u) => add[u].some((x) => x > 0)).length;", "      const moved = pre1.votes + pre1.saves;"]],
    BT, "FAIL — R: and that the four on songs before the cut moved ONE person's numbers", "RED"],
  // RW3 — the summary's reason back to "after the fill-back (N counted)".
  // RW3 RE-ANCHORED AT J117 (the reason): a confirmed Rebuild's summary goes as `freshNow`, at once, as a Replace's does.
  ["RW3", [[RB, "    s.freshNow = \"after the rebuild\";", "    s.freshNow = \"after the fill-back (\" + (b.votes + b.saves) + \" counted)\";"]],
    BT, "FAIL — R: the summary after it says why it went", "RED"],
  // RW4 — the fill-back no longer says what came in twice.
  ["RW4", [[RB, "      st.twice = once.twice;\n", ""]], BT, "FAIL — R: and its line says what came in twice", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[MB, "  function _onRoomArrived(room) {", "  function _onRoomArrived(room)  {"]], LC, "", "GREEN"],
  ["N2", [[SE, "  function _say(from, next, reason) {", "  function _say(from, next, reason)  {"]], SL, "", "GREEN"],
  ["N3", [[RB, "    const seen = new Set(), out = [];", "    const seen = new Set(),  out = [];"]], BT, "", "GREEN"],
  ["N4", [[SET, "      cb.checked = chat.value === true;", "      cb.checked = (chat.value === true);"]], SA, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
