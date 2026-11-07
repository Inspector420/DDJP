// tools/probes/mutate-j81-invites.js
// SUBJECT: J81 — invites: the channel mark, the one classifier, the ONE join step for the room that runs on this tab, the DM
// panel answered per invite, the lobby. One row per site of the build, each naming the failure it must cause in its guard, and
// the control. Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's
// own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j81-invites.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", MA = "backends/backend1/matrixaccount.js", RM = "features/room.js", CH = "features/chat.js";
const SH = "ui/shell.js";
const CM = "check-channel-mark", IK = "check-invite-kinds", JS = "check-join-step", DI = "check-dm-invites", RC = "check-runner-room-change";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // M1 — one builder creates its channel itself, skipping the one marking function: an unmarked channel.
  ["M1", [[MB, "    return _createMarkedChannel({ name, preset: \"private_chat\", room_version: ROOM_VERSION, initial_state }, spaceId, key);\n",
    "    const room = await client.createRoom({ name, preset: \"private_chat\", room_version: ROOM_VERSION, initial_state }); return room.room_id;\n"]],
    CM, "FAIL — M1 (backend1): EVERY channel carries its kind", "RED"],
  // M2 — no `m.space.parent`: the channel no longer names its room (8a: both ways, always).
  ["M2", [[MB, "      { type: \"m.space.parent\", state_key: spaceId, content: { via: _viaFor(spaceId), canonical: true } },\n", ""]],
    CM, "FAIL — M2 (backend1): every channel names its room from its own side", "RED"],
  // M3 — the classifier skips the creator check: a listed room made by someone else is verified.
  ["M3", [[MA, "      if (!cr.sender || cr.sender !== j.creator) { out.why = \"made by someone other than the room's creator\"; return out; }\n", ""]],
    IK, "FAIL — K4: listed by your room but made by someone else", "RED"],
  // M4 — the classifier skips the listing check: a stranger's look-alike naming your room is verified.
  ["M4", [[MA, "      if (!j.lists.has(room.roomId)) { out.why = \"your room does not list it\"; return out; }\n", ""]],
    IK, "FAIL — K3: a stranger's room claiming your room is not verified", "RED"],
  // M5 — an unverified DDJP-looking invite falls through to the DM panel (ruling 17: a DDJP invite never shows there).
  ["M5", [[CH, "      if (!v || v.verdict !== \"other\") continue;\n", "      if (!v || (v.verdict !== \"other\" && v.verified)) continue;\n"]],
    IK, "FAIL — P: EVERY INVITE IN EXACTLY ONE PLACE", "RED"],
  // M6 — the two-member DM guess comes back (8e): an invite with the inviter and this account in it is a DM, whatever it is.
  ["M6", [[MA, "    if (!marked && !listedBy.length) {\n", "    if ((!marked && !listedBy.length) || out.people.joined + out.people.invited === 2) {\n"]],
    IK, "FAIL — K2: a channel whose mark names a room you are in", "RED"],
  // M7 — the step takes invites for a room that is not running on this tab (8b, ruling 14). RE-ANCHORED AT J84-1 (the
  // reason): a room-list change now asks for its pass through the burst's one request (`_joinSoon`); the mutant is the same.
  ["M7", [[RM, "    _joinSoon(\"an invite or membership changed\");\n  }\n",
    "    _joinSoon(\"an invite or membership changed\");\n    try { for (const v of (MatrixAccount.invites() || [])) if (v.verdict === \"channel\" && v.verified) MatrixBridge.joinRoomChannels(v.room, \"mutant\", { wanted: () => true }); } catch (e) {}\n  }\n"]],
    JS, "FAIL — W5: A's staff-chat invite WAITS while B runs", "RED"],
  // M8 — a line per channel instead of ONE line per pass (8c).
  ["M8", [[MB, "    for (const x of results) parts.push(x);\n", "    for (const x of results) { parts.push(x); line(x); }\n"]],
    JS, "FAIL — W1: the opening wrote ONE join-step line", "RED"],
  // M9 — no coalescing: every trigger starts its own pass, side by side.
  ["M9", [[MB, "    if (st) {   // COALESCED", "    if (false) {   // COALESCED"]],
    JS, "FAIL — S1: FOUR triggers while one pass ran", "RED"],
  // M10 — the lobby's Accept joins the room's channels too (D4: accepting is not opening).
  ["M10", [[RM, "    await MatrixBridge.joinSpace(spaceId);\n    Logger.info(\"Room: accepted the invitation to \"",
    "    await MatrixBridge.joinSpace(spaceId);\n    MatrixBridge.joinRoomChannels(spaceId, \"accepted\", { opening: true, wanted: () => true });\n    Logger.info(\"Room: accepted the invitation to \""]],
    JS, "FAIL — W1: LOBBY ACCEPT JOINS THE ROOM ONLY", "RED"],
  // M11 — the DM panel answers per PERSON again (ddjp_433): one click joins every invite that person sent (D9).
  ["M11", [[CH, "    return _once(roomId, async () => {\n      let res = null;\n",
    "    return _once(roomId, async () => {\n      for (const o of dmInvites()) if (o.from === inv.from && o.roomId !== roomId) { try { await MatrixAccount.acceptDMInvite(o.roomId); } catch (e) {} }\n      let res = null;\n"]],
    DI, "FAIL — D1: ONE CLICK JOINS ONE ROOM", "RED"],
  // M12 — the second click is skipped: one click joins a group room (D5).
  ["M12", [[CH, "    if (inv.needsConfirm && !(opts && opts.confirmed)) return Promise.resolve({ ok: false, reason: \"confirm\", warn: inv.warn, people: inv.people });\n", ""]],
    DI, "FAIL — D3: ONE CLICK DOES NOT JOIN A GROUP", "RED"],
  // M13 — the inviter is read AFTER the join, where the join's own member event answers: the conversation is filed under this account.
  ["M13", [[MA, "    const from = v.from, direct = v.direct;\n    await _c().joinRoom(roomId);\n",
    "    const direct = v.direct;\n    await _c().joinRoom(roomId);\n    let from = null; try { const r0 = _c().getRoom(roomId); const mine = r0 && r0.currentState.getStateEvents(\"m.room.member\", B1MatrixBridge.getUserId()); from = (mine && mine.getSender) ? mine.getSender() : null; } catch (e) { from = null; }\n"]],
    DI, "FAIL — D2: recorded in `m.direct` under the INVITER", "RED"],
  // M14 — the lobby lists any Matrix space as a room invitation (8f; ruling 17 sends another app's space to the DM panel).
  ["M14", [[MA, "    if (cc.type === \"m.space\" && _modeOf(cc)) {", "    if (cc.type === \"m.space\") {"]],
    IK, "FAIL — K12: ANOTHER APP'S SPACE is not a DDJP room", "RED"],
  // M15 — the old-room refusal is gone: a room whose channels carry no mark is opened (ruling 7).
  ["M15", [[RM, "      if (!m || !m.room || !m.kind) {\n        throw new Error(\"This room was made before its channels carried their room's mark",
    "      if (false) {\n        throw new Error(\"This room was made before its channels carried their room's mark"]],
    JS, "FAIL — S7: a room whose channels carry no mark is REFUSED BY NAME", "RED"],
  // M16 — PARITY: the invite scope no longer moves at the one switch the runner moves at (8b). RE-AIMED AT J83: under ruling 18
  // the back button clearing the scope is RIGHT (the leave does it), so the break is the back button clearing the scope APART from
  // the leave — the invite scope gone while the room and its runner run on.
  ["M16", [[SH, '    backBtn.onclick = () => { Room.leave("back to the lobby"); _bgLeaveRoom();',
    '    backBtn.onclick = () => { Room._setCurrentForTest(null); _bgLeaveRoom();']],
    RC, "FAIL — P-i: and the runner stops with it", "RED"],
  // M16b — PARITY: "running" read from a second source (the opening flag) beside `current`.
  ["M16b", [[RM, "  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }\n",
    "  function runningRoom() { return _opening || ((current && current.spaceId) ? current.spaceId : null); }\n"]],
    RC, "FAIL — P-i: `runningRoom` reads `current` alone", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[MA, "  function invites() {\n", "  function invites() {\n\n"]], IK, "", "GREEN"],
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
