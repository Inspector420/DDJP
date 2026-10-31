// tools/probes/mutate-j83-leave.js
// SUBJECT: J83 — a room runs only while the tab is in it (the owner's ruling 18, E1–E9). One row per stop the ONE leave step
// makes and per way out that calls it, the tab's memory of its room, the reopen and DMs at login, the pile-ups J83 ended, and
// the control. Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the
// suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j83-leave.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // L1 — the leave no longer stops playback: the tick (and its advance and stagger timers) runs on in the lobby.
  ["L1", [["features/room.js", "      [\"Playback\", () => { if (typeof Playback !== \"undefined\") { Playback.stop(); Playback.destroy(); } }],\n", ""]], "check-room-leave", "FAIL — A: NO TIMER ARMED WHILE THE ROOM RAN IS STILL LIVE AFTER THE LEAVE", "RED"],
  // L2 — the leave no longer stops the bot runtime: the bot runs on in the lobby.
  ["L2", [["features/room.js", "    try { if (typeof BotRuntime !== \"undefined\" && BotRuntime.stop) BotRuntime.stop(\"the tab left the room\"); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — A: the bot runtime and the runner are stopped", "RED"],
  // L2b — the bot runtime is stopped AFTER the lobby's engine is bound: its raw listener, subscribed through the bot engine's wrapper, is never removed.
  ["L2b", [["features/room.js", "    try { if (typeof BotRuntime !== \"undefined\" && BotRuntime.stop) BotRuntime.stop(\"the tab left the room\"); } catch (e) {}\n", ""], ["features/room.js", "    try { if (typeof Backends !== \"undefined\" && Backends.bindBootstrap) Backends.bindBootstrap(); } catch (e) {}\n", "    try { if (typeof Backends !== \"undefined\" && Backends.bindBootstrap) Backends.bindBootstrap(); } catch (e) {}\n    try { if (typeof BotRuntime !== \"undefined\" && BotRuntime.stop) BotRuntime.stop(\"the tab left the room\"); } catch (e) {}\n"]], "check-room-leave", "FAIL — A: and the raw listeners are what the lobby had", "RED"],
  // L3 — the leave makes no engine reset: the runner and the room's fold run on.
  ["L3", [["features/room.js", "    try { rs = StreamManager.reset(\"the tab left the room (\" + reason + \")\"); }\n    catch (e) { Logger.warn(\"Room: the engine did not reset cleanly — \" + ((e && e.message) || e)); }\n", ""]], "check-room-leave", "FAIL — A: the bot runtime and the runner are stopped", "RED"],
  // L4 — the transport's half no longer takes the phase to COLD.
  ["L4", [["backends/backend1/matrixbridge.js", "    try { if (typeof Session !== \"undefined\" && Session.leaveRoom) Session.leaveRoom(); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — A: the phase is COLD", "RED"],
  // L4b — COLD is not sticky any more: a lost connection or a late beat walks the lobby back toward LIVE.
  ["L4b", [["backends/backend1/session.js", "    if (_phase === COLD && next !== REPLAYING) return false;\n", ""]], "check-room-leave", "FAIL — A: and STAYS COLD", "RED"],
  // L5 — the leave no longer clears the running room.
  ["L5", [["features/room.js", "    current = null;\n    _wiredFor = null;\n", "    _wiredFor = null;\n"]], "check-room-leave", "FAIL — A: no room runs on this tab", "RED"],
  // L6 — the leave no longer unsubscribes room chat.
  // RE-ANCHORED AT ddjp_621: the step also clears `_chatWired`, so a room left with its chat late-wired wires it again next time.
  ["L6", [["features/room.js", "      [\"Chat\", () => { _chatWired = false; if (typeof Chat !== \"undefined\" && Chat.destroy) Chat.destroy(); }],   // room chat only; DMs are the account's\n", ""]], "check-room-leave", "FAIL — A: room chat no longer arrives", "RED"],
  // L7 — the answers still awaited are not cancelled: each waits out its deadline and is answered `none`.
  ["L7", [["backends/backend1/matrixbridge.js", "    out.answers = cancelAnswers(\"the room was left\");\n", "    out.answers = 0;\n"]], "check-room-leave", "FAIL — A: an answer still awaited is settled `cancelled`", "RED"],
  // L8 — the back button no longer stops the player.
  ["L8", [["ui/shell.js", "    try { if (Player.clearVideo) Player.clearVideo(); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — C: and the player stops", "RED"],
  // L9 — the leave no longer bumps the backfill's generation: a backfill in flight writes into the next room's table.
  ["L9", [["backends/backend1/matrixbridge.js", "    _backfillGen++;\n", ""]], "check-room-leave", "FAIL — B: a backfill whose room was left writes nothing", "RED"],
  // L9b — History's backfill no longer checks its epoch after the page it waited for.
  ["L9b", [["backends/backend1/history.js", "    if (ep !== _epoch) return { ok: false, reason: \"reset\" };\n", ""]], "check-room-leave", "FAIL — B: History's own backfill, mid-page at a reset, adds nothing", "RED"],
  // L10 — the leave no longer clears the tab's room: a tab left for the lobby reopens the room after a reload.
  ["L10", [["features/room.js", "    if (!o.reloading) _forgetRoom();\n", ""]], "check-room-reload", "FAIL — R2: a leave to the lobby clears it", "RED"],
  // L10b — the switch no longer writes the tab's room: nothing reopens after a reload.
  ["L10b", [["features/room.js", "    _rememberRoom(current.spaceId);\n", ""]], "check-room-reload", "FAIL — R1: the switch writes the tab's room", "RED"],
  // L11a — the room screen's back button does not leave the room.
  ["L11a", [["ui/shell.js", "    backBtn.onclick = () => { Room.leave(\"back to the lobby\"); _bgLeaveRoom();", "    backBtn.onclick = () => { _bgLeaveRoom();"]], "check-room-leave", "FAIL — C: the room screen's back button leaves the room", "RED"],
  // L11b — the loading card's back does not cancel the opening.
  ["L11b", [["ui/screens.js", "      Room.cancelOpening(\"back on the loading card\");\n", ""]], "check-room-leave", "FAIL — C: the loading card's back cancels the opening", "RED"],
  // L11c — the lobby's Log out does not leave the room first.
  ["L11c", [["app.js", "    try { Room.leave(\"logging out\"); } catch (e) {}\n    try { await MatrixAccount.logout(); }", "    try { await MatrixAccount.logout(); }"]], "check-room-leave", "FAIL — C: Log out in the lobby leaves the room BEFORE logging out", "RED"],
  // L11d — the encryption gate's Log out does not leave first.
  ["L11d", [["app.js", "        onLogout: async () => { try { Room.leave(\"logging out\"); } catch (e) {} ", "        onLogout: async () => { "]], "check-room-leave", "FAIL — C: the encryption gate's Log out leaves first too", "RED"],
  // L11e — switching account does not leave first.
  // L11e RE-ANCHORED AT J99 (`ddjp_631`): switching and adding an account share `app.js`'s one `_changeAccount`.
  ["L11e", [["app.js", "    try { Room.leave(why); } catch (e) {}\n    if (MatrixAccount.switchAccount(uid)) location.reload();", "    if (MatrixAccount.switchAccount(uid)) location.reload();"]], "check-room-leave", "FAIL — C: switching account leaves the room", "RED"],
  // L11f — the secure-chat reconnect does not leave before the kill switch.
  ["L11f", [["ui/shell.js", "      try { Room.leave(\"reconnecting secure chat\", { reloading: true }); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — C: the secure-chat reconnect leaves before the kill switch", "RED"],
  // L11g — the page closing does not leave.
  ["L11g", [["app.js", "  try { window.addEventListener(\"pagehide\", () => { try { Room.leave(\"the page is closing\", { reloading: true }); } catch (e) {} }); } catch (e) {}", "  try { window.addEventListener(\"pagehide\", () => { }); } catch (e) {}"]], "check-room-leave", "FAIL — C: the page closing leaves the room", "RED"],
  // L11k — a page restored from the browser's page cache does not reload: it shows a room that no longer runs.
  ["L11k", [["app.js", "  try { window.addEventListener(\"pageshow\", (ev) => { if (ev && ev.persisted) { try { location.reload(); } catch (e) {} } }); } catch (e) {}", "  try { window.addEventListener(\"pageshow\", (ev) => { }); } catch (e) {}"]], "check-room-leave", "FAIL — C: a page restored from the browser's page cache reloads", "RED"],
  // L11h — the bot's daily reload does not leave first.
  ["L11h", [["features/botruntime.js", "    try { if (typeof Room !== \"undefined\" && Room.leave) Room.leave(\"the daily reload\", { reloading: true }); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — C: the bot's daily reload leaves the room first", "RED"],
  // L11i — a removal elsewhere is not heard: the room runs on.
  ["L11i", [["features/room.js", "    if (_removedFromRunningRoom()) leave(\"you are no longer in this room\", { removed: true });\n", ""]], "check-room-leave", "FAIL — C: removed from the room elsewhere", "RED"],
  // L11j — opening a room does not leave the running one first.
  ["L11j", [["features/room.js", "    leave(\"opening another room\");\n", ""]], "check-room-leave", "FAIL — D: opening a room LEAVES the running one first", "RED"],
  // L12 — the leave stops DMs too (an account process stopped by mistake): it lets go of the conversations it holds open.
  ["L12", [["features/room.js", "    try { if (typeof Backends !== \"undefined\" && Backends.bindBootstrap) Backends.bindBootstrap(); } catch (e) {}\n", "    try { if (typeof Backends !== \"undefined\" && Backends.bindBootstrap) Backends.bindBootstrap(); } catch (e) {}\n    try { MatrixAccount.setDMScope([]); } catch (e) {}\n"]], "check-room-leave", "FAIL — A: a DM still does", "RED"],
  // L13 — the boot path does not reopen the tab's room.
  ["L13", [["app.js", "      try { if (Interface.reopenAfterReload) Interface.reopenAfterReload(); } catch (e) { Logger.warn(\"Reopen failed: \" + (e && e.message)); }\n", ""]], "check-room-reload", "FAIL — R3: a restored session binds DMs (E3), shows the lobby, THEN asks to reopen", "RED"],
  // L14 — DMs are not bound at login (E3).
  ["L14", [["app.js", "    try { if (typeof Chat !== \"undefined\" && Chat.dmInit) Chat.dmInit(); } catch (e) { Logger.warn(\"DMs not bound — \" + (e && e.message)); }\n", ""]], "check-room-reload", "FAIL — R3: a restored session binds DMs (E3)", "RED"],
  // L15 — the personal queue subscribes a live-listener on every entry again.
  ["L15", [["features/userqueue.js", "    if (!_authorReadyWired) {\n", "    if (true) {\n"]], "check-room-leave", "FAIL — E: the live-listeners (`onAuthorReady`", "RED"],
  // L16 — the history feed is subscribed on every `wireCheckpoints` again.
  ["L16", [["backends/backend1/matrixbridge.js", "        if (!_historyFeedWired) {\n", "        if (true) {\n"]], "check-room-leave", "FAIL — E: the history feed is subscribed once per page", "RED"],
  // L17 — the server clock leaves its page listener behind.
  ["L17", [["features/serverclock.js", "      try { if (typeof document !== \"undefined\" && document.removeEventListener) document.removeEventListener(\"visibilitychange\", _onShown); } catch (e) {}\n", ""]], "check-room-leave", "FAIL — E: the server clock's page listener comes off", "RED"],
  // L18 — a send held for live is not let go at the leave.
  ["L18", [["features/queue.js", "    for (const w of Array.from(_waits)) { try { w.cancel(); } catch (e) {} }\n", ""]], "check-room-leave", "FAIL — A: a song held for this client to go live is let go", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; both guards must stay green, so a green above is a reading of a live run.
  ["N1", [["features/room.js", "  function leave(why, opts) {\n", "  function leave(why, opts) {\n\n"]], "check-room-leave", "", "GREEN"],
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
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
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
