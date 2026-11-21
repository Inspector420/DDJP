// tools/probes/mutate-j129-rank-change.js
// SUBJECT: J129 — rank changes that finish, show their progress, and repair (the owner's): `backends/backend1/matrixbridge.js`
// (`assignRank`: every step read back, a rate limit waited out as the server says, a refusal named, one minute, the outcome
// reported; the presence chat the bot's, its level a step only for an account in it; "in that room" read from membership,
// since the SDK keeps a room this account left, `ddjp_652`), `features/room.js` (one change at a time on a tab, its state and
// progress, the outcome said as it ended, the leave's stop, the join step only on this account's own move),
// `features/actions.js` (every picker waits) and `ui/roster.js` (the card unlocked between changes, its progress line and Try
// again, a burst one repaint, the picker kept while it is used; a pick that starts no change puts its box back, `ddjp_666`).
// Held by `check-rank-change` A–G, `check-assign-rank-retry` E and `check-user-card` K and N (the card opening on a
// DOM-shaped tree, `ddjp_653`). And (`ddjp_670`) `Room.assignRank` asks for the room before the rung, so with no room open it
// answers "no-room": `check-rank-change` G, rows RK46–RK48.
// One row per way it could go wrong, each naming the failure it must cause.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes
// are back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE:
// each file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not
// there at either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed.
// Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j129-rank-change.js            every row
//   node tools/probes/mutate-j129-rank-change.js RK3 RK9    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", ROOM = "features/room.js", ACT = "features/actions.js", UI = "ui/roster.js";
const PROBE = "tests/_probe-j14-card.js", DOMSHAPE = "tests/_domshape.js";
const RC = "check-rank-change", AR = "check-assign-rank-retry", UC = "check-user-card";
// `features/room.js` `assignRank`'s first two refusals in their order since `ddjp_670` (the room, then the rung), and 669's.
const NOROOM_LINE = "    if (!current) return { ok: false, reason: \"no-room\" };\n";
const RUNG_LINE = "    { const g = rankAssignable(level); if (!g.ok) { Logger.warn(\"Room: level \" + level + \" cannot be assigned yet — upgrade the room first\"); return { ok: false, reason: \"upgrade-first\", missing: g.missing }; } }\n";
const NOROOM_ORDER = NOROOM_LINE + RUNG_LINE, NOROOM_669 = RUNG_LINE + NOROOM_LINE;
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["RK1", [[MB, "    if (kind === \"in\") return /already (in|joined|invited|a member)/i.test(t);", "    if (kind === \"in\") return false;"]],
    RC, "C shared room: \"ALREADY IN\" COUNTS once read back", "RED"],   // an "already in" answer taken as a failure
  ["RK2", [[MB, "    if (kind === \"out\") return /not (in|a member of) (the|this) room|is not in the room|not joined/i.test(t);", "    if (kind === \"out\") return false;"]],
    RC, "C shared room: \"NOT IN THE ROOM\" COUNTS once read back", "RED"],   // a "not in the room" answer taken as a failure
  ["RK3", [[MB, "      if (s.done) continue;\n      await attempt(s);\n", "      await attempt(s);\n"]],
    RC, "C shared room: nothing already in place is sent", "RED"],   // what is in place sent anyway
  ["RK4", [[MB, "    if (s.kind === \"in\") return ms === \"join\" || ms === \"invite\";", "    if (s.kind === \"in\") return true;"]],
    RC, "A shared room: the staff-chat invite answered 429 twice was sent again", "RED"],   // an invite taken as in place unread
  // RK5, RK28 AND RK29 RE-ANCHORED AT ddjp_692: the send now tells the pacer it landed, Try again's send names a repair's flag
  // beside it, and the card's out-of-step slot is drawn after the progress line — the rows' subjects unchanged.
  ["RK5", [[MB, "{ _sendPace.landed(\"ranks\"); s.accepted = true; s.acceptedAt = polls; s.error = null; return; }", "{ _sendPace.landed(\"ranks\"); s.accepted = true; s.done = true; s.acceptedAt = polls; s.error = null; return; }"]],   // re-anchored at `ddjp_697`: the pacer's calls name their kind
    AR, "E: an invite accepted but never shown is not taken as landed", "RED"],   // a send accepted counted as landed
  ["RK6", [[MB, "await until(_rankSleep(ra !== null ? ra : RANK_BACKOFF_MS[Math.min(s.tries - 1, RANK_BACKOFF_MS.length - 1)]));", "await until(_rankSleep(RANK_BACKOFF_MS[Math.min(s.tries - 1, RANK_BACKOFF_MS.length - 1)]));"]],
    RC, "A shared room: each 429 waited as the server said", "RED"],   // the server's retry_after ignored
  ["RK7", [[MB, "      if (_rankRefused(e)) { s.refused = true; return; }   // named, not sent again\n", ""]],
    RC, "B shared room: A REFUSAL (403) is named", "RED"],   // a refusal sent again for the minute
  ["RK8", [[MB, "      run.wake = wake;\n", ""]],
    RC, "B shared room: A REQUEST STILL IN FLIGHT AT THE MINUTE", "RED"],   // the limit cannot end a request in flight
  ["RK9", [[MB, "    const cutTimer = _rankLater(() => { run.cut = true; if (run.wake) run.wake(); }, RANK_LIMIT_MS);", "    const cutTimer = _rankLater(() => { run.cut = true; if (run.wake) run.wake(); }, RANK_LIMIT_MS * 10);"]],
    RC, "B shared room: it stopped AT the minute", "RED"],   // not one minute
  ["RK10", [[MB, "    if (!missing.length) {\n      const pk = _presenceChatKey()", "    if (true) {\n      const pk = _presenceChatKey()"]],
    RC, "B shared room: NO \"all channels reconciled\" line", "RED"],   // "reconciled" on a partial
  ["RK11", [[MB, "      if (want === null) { if (key === _presenceChatKey() && _presenceManager(level)) steps.push({ kind: \"in\", roomId: channels[key], key: key }); continue; }", "      if (want === null) { steps.push({ kind: \"in\", roomId: channels[key], key: key }); continue; }"]],
    RC, "A shared room: the presence chat stays the bot's", "RED"],   // the presence chat taken from the bot
  ["RK12", [[MB, "      if (n !== shown) { shown = n; try { if (typeof o.onProgress === \"function\") o.onProgress(n, total); } catch (e) {} }", "      if (n !== shown) { shown = n; }"]],
    RC, "A shared room: the progress counts steps confirmed of steps", "RED"],   // no progress reported
  ["RK13", [[ROOM, "    if (_rankJob && _rankJob.state === \"running\") {", "    if (false) {"]],
    RC, "D shared room: A SECOND CHANGE IS REFUSED BY NAME", "RED"],   // a second change runs beside the first
  ["RK14", [[ROOM, "    if (r && r.ok) {\n      job.state = \"done\";", "    if (r) {\n      job.state = \"done\";"]],
    RC, "B shared room: the room says it did not finish, never that it is done", "RED"],   // the room says done on a partial
  // RK15 RE-ANCHORED AT ddjp_695: the stop also asks whether the transport's run is this room's (a lobby Repair's is not) — its
  // subject unchanged.
  ["RK15", [[ROOM, "      [\"Rank change\", () => { const had = !!_rankJob; _rankJob = null; _myLevelSeen = null; const mine = had || _upLeft || !_upStep; _upLeft = false; if (mine && typeof MatrixBridge.stopRankChange === \"function\") MatrixBridge.stopRankChange(); if (had) _rankJobTold(); }],\n", ""]],
    RC, "E shared room: LEAVING THE ROOM STOPS THE CHANGE", "RED"],   // the leave leaves a change running
  ["RK16", [[ROOM, "    if (typeof now !== \"number\" || now === was) return;", "    if (typeof now !== \"number\") return;"]],
    RC, "E shared room: ANYBODY ELSE'S CHANGE RUNS NO JOIN STEP", "RED"],   // a join step on everybody's change
  ["RK17", [[ROOM, "_runJoinStep(\"this account's rank changed (\" + (typeof was === \"number\" ? was : \"unread\") + \" \\u2192 \" + now + \")\");", "_runJoinStep(\"this account's rank changed\");"]],
    RC, "E shared room: THIS ACCOUNT'S OWN MOVE runs one, saying from what to what", "RED"],   // the move not named
  ["RK18", [[ROOM, "    try { _myLevelSeen = { room: current.spaceId, level: getMyAuthorityLevel() }; } catch (e) { _myLevelSeen = null; }   // J129: the level a move is measured from\n", ""]],
    RC, "E shared room: ANYBODY ELSE'S CHANGE RUNS NO JOIN STEP", "RED"],   // no level read at entry, so the first change reads as a move
  // RK19 RE-ANCHORED AT ddjp_690: J140 gave the row's availability a second half (one bot per room, handed the target); the row
  // still drops only the running change's half, so the pickers go live while a change runs and the bot rule stays.
  // RK19 RE-ANCHORED AT ddjp_694: the line reads the upgrade's bot step beside the running change (`_upgrading`); the row drops
  // both, as it dropped the change's alone — its subject unchanged.
  ["RK19", [[ACT, "                       avail: (s, t) => { const j = _rankRunning() || _upgrading(); return !j && !_botTaken(t); },", "                       avail: (s, t) => !_botTaken(t),"]],
    RC, "D shared room: every rank picker WAITS", "RED"],   // the pickers live while a change runs
  // RK20 RE-ANCHORED AT ddjp_666: the pick's answer is read into `res` now, so its box can go back.
  ["RK20", [[UI, "          const sent = Actions.perform(\"rank.assign\", { userId: m.userId, targetRank: m.level, newLevel: lvl });\n          let res;", "          unlocked = false;\n          const sent = Actions.perform(\"rank.assign\", { userId: m.userId, targetRank: m.level, newLevel: lvl });\n          let res;"]],
    RC, "F shared room: A RANK CHOSEN DOES NOT LOCK THE CARD", "RED"],   // ddjp_477's re-lock on a pick
  ["RK21", [[UI, "          sel.onblur = () => { pickerOpen = false; if (unlocked) for (const b of gatedNow) if (b._live) b.disabled = false; };", "          sel.onblur = () => { pickerOpen = false; if (unlocked) { unlocked = false; paint(); } };"]],
    UC, "K: CLICKED AWAY FROM THE PICKER — the card STAYS UNLOCKED", "RED"],   // ddjp_477's re-lock on leaving the picker
  ["RK22", [[UI, "    if (_cardRank.burstTimer) return;\n", ""]],
    RC, "F shared room: A BURST ASKS FOR ONE REPAINT", "RED"],   // a repaint per event
  ["RK23", [[UI, "    if (_rankRunningNow()) { if (typeof _cardRank.note === \"function\") { try { _cardRank.note(); } catch (e) {} } return; }\n", ""]],
    RC, "F shared room: WHILE IT RUNS, A BURST REDRAWS ONLY THE PROGRESS LINE", "RED"],   // a change's burst repaints the card
  ["RK24", [[UI, "      if (sig !== rankSig || !rankSlot.children.length) {", "      if (true) {"]],
    RC, "F shared room: A REPAINT DURING THE BURST KEEPS THE FOCUSED PICKER OPEN", "RED"],   // the picker rebuilt on every repaint
  ["RK25", [[UI, "        if (GATED[spec.action] && pickerOpen) btn.disabled = true;   // and while it is open, a repaint keeps them held\n", ""]],
    RC, "F shared room: and Remove and Ban stay held while it is open, through the repaint", "RED"],   // a repaint frees Remove and Ban under an open picker
  ["RK26", [[UI, "    if (turned) { if (typeof _openCardRepaint === \"function\") { try { _openCardRepaint(); } catch (e) {} } return; }", "    if (turned) return;"]],
    RC, "F shared room: while it runs, its own picker WAITS", "RED"],   // the start and end draw nothing
  ["RK27", [[UI, "      if (j.state === \"running\") {", "      if (j.state === \"running\" && mine) {"]],
    RC, "F shared room: ANOTHER PERSON'S CARD WAITS", "RED"],   // another person's card says nothing
  ["RK28", [[UI, "          : { userId: m.userId, targetRank: m.level, newLevel: j.level });", "          : { userId: m.userId, targetRank: m.level, newLevel: m.level });"]],
    RC, "F shared room: TRY AGAIN — the same change again — repairs it", "RED"],   // Try again is not the same change
  ["RK29", [[UI, "      note();\n      stand();\n      for (const x of specs) {", "      H.clear(noteSlot);\n      stand();\n      for (const x of specs) {"]],
    RC, "F shared room: the result line stays until the next change", "RED"],   // a repaint drops the result
  // RK30 and RK31 RE-ANCHORED AT ddjp_652 (the owner's correction): the line reads membership (`amJoined`) now.
  ["RK30", [[MB, "      if (key === _presenceChatKey() && !amJoined(channels[key])) continue;\n", ""]],
    RC, "B shared room: NOT IN THE PRESENCE CHAT, the change is done", "RED"],   // every change by an account outside the bot's room fails
  ["RK31", [[MB, "      if (key === _presenceChatKey() && !amJoined(channels[key])) continue;\n", "      if (!amJoined(channels[key])) continue;\n"]],
    RC, "B shared room: CONTROL — any other room this account is not in is NAMED", "RED"],   // every unreachable room skipped silently, as at 650
  // ── "IN THAT ROOM" IS MEMBERSHIP, NOT WHETHER THE SDK HAS THE ROOM (the owner's correction, ddjp_652): 651's reading at each site ──
  ["RK32", [[MB, "      if (key === _presenceChatKey() && !amJoined(channels[key])) continue;\n", "      if (key === _presenceChatKey() && !(client && client.getRoom(channels[key]))) continue;\n"]],
    RC, "B shared room: A STAFF ACCOUNT REMOVED FROM PRESENT completes its change", "RED"],   // the presence chat's level a step for a removed account
  ["RK33", [[MB, "      if (!amJoined(s.roomId)) { s.error = \"this account is not in that room\"; return; }", "      if (!client.getRoom(s.roomId)) { s.error = \"this account is not in that room\"; return; }"]],
    RC, "B shared room: AND ANY OTHER CHANNEL THIS ACCOUNT LEFT is named at once", "RED"],   // a left room tried, and refused by the server
  ["RK34", [[MB, "      const live = steps.filter((s) => !s.done && !s.refused && amJoined(s.roomId));", "      const live = steps.filter((s) => !s.done && !s.refused && client.getRoom(s.roomId));"]],
    RC, "B shared room: AND ANY OTHER CHANNEL THIS ACCOUNT LEFT is named at once", "RED"],   // a left room waited on to the minute
  ["RK35", [[MB, "    const unreachable = missing.some((s) => !s.refused && !amJoined(s.roomId));", "    const unreachable = missing.some((s) => !s.refused && !client.getRoom(s.roomId));"]],
    RC, "B shared room: AND ANY OTHER CHANNEL THIS ACCOUNT LEFT is named at once", "RED"],   // a left room's end named "refused"
  ["RK36", [[MB, "    if (!amJoined(s.roomId)) return false;\n", ""]],
    RC, "B shared room: A LEFT ROOM'S STATE, AS OF LEAVING, IS NOT A READ-BACK", "RED"],   // a left room's old state counted as confirmed
  // ── THE CARD OPENS IN THE BROWSER (the owner's report at ddjp_652; fixed at ddjp_653): a select's `children` is an
  //    HTMLCollection, read through `Array.from`; `.map` on it threw in Chromium and the card never opened ──
  ["RK37", [[UI, "const shapeOf = (n) => JSON.stringify([n.disabled === true, n.title || \"\", Array.from(n.children || []).map((c) =>", "const shapeOf = (n) => JSON.stringify([n.disabled === true, n.title || \"\", (n.children || []).map((c) =>"]],
    UC, "PART N: THE CARD MUST OPEN AND WORK ON A DOM-SHAPED TREE", "RED"],   // 651's .map on children, back
  ["RK38", [[UI, "const shapeOf = (n) => JSON.stringify([n.disabled === true, n.title || \"\", Array.from(n.children || []).map((c) =>", "const shapeOf = (n) => JSON.stringify([n.disabled === true, n.title || \"\", (n.children || []).map((c) =>"]],
    RC, "F shared room: PREMISE — the card is open and unlocked", "RED"],   // the same, read by the whole flow's part
  ["RK39", [[PROBE, "      get children() { return o.domShaped ? collectionOf(this._kids) : this._kids; },", "      get children() { return this._kids; },"]],
    UC, "N PROBE: with domShaped, children is an HTMLCollection", "RED"],   // the harness's DOM shape undone: the guard's own premise
  // ── A PICK THAT STARTS NO CHANGE PUTS ITS BOX BACK (found at the milestone review after ddjp_659; fixed at ddjp_666, the
  //    owner's choice): locked, refused for any reason, or a send that throws, the box goes back to the option it was drawn
  //    with; left alone it showed the refused rank, and picking it again fired no change ──
  ["RK40", [[UI, "          if (!(res && res.ok === true)) back();\n", ""]],
    RC, "G shared room denied: AFTER THE REFUSAL, THE BOX SHOWS THEIR REAL RANK", "RED"],   // a refusal leaves the refused rank on the box
  ["RK41", [[UI, "          if (!(res && res.ok === true)) back();\n", "          if (res && res.ok === false && REFUSED[res.reason]) back();\n"]],
    RC, "G shared room self: AFTER THE REFUSAL, THE BOX SHOWS THEIR REAL RANK", "RED"],   // only a refusal that says something goes back
  ["RK42", [[UI, "          catch (e) { back(); result.textContent = e.message || \"Couldn't change that rank.\"; return; }", "          catch (e) { result.textContent = e.message || \"Couldn't change that rank.\"; return; }"]],
    RC, "G shared room thrown: AFTER A SEND THAT THROWS, THE BOX SHOWS THEIR REAL RANK", "RED"],   // a send that throws leaves the rank on the box
  ["RK43", [[UI, "          if (!unlocked) { back(); return; }", "          if (!unlocked) return;"]],
    RC, "G shared room locked: A CHANGE ON THE LOCKED PICKER SENDS NOTHING AND THE BOX GOES BACK", "RED"],   // the locked card's exit leaves it
  ["RK44", [[PROBE, "    if (o.domShaped && tag === \"select\") {", "    if (false) {"]],
    RC, "PROBE: the double's select is a browser's", "RED"],   // the harness's select undone: value a plain property again
  ["RK45", [[DOMSHAPE, "  if (!o || optDisabled(o) || o._selected) return false;", "  if (!o || optDisabled(o)) return false;"]],
    RC, "PROBE: the double's select is a browser's", "RED"],   // a re-pick of the chosen option fires a change, as Chromium does not
  // ── "no-room" IN ITS PLACE (`ddjp_670`): with no room open the room is asked for first, so the answer is "no-room" ──
  ["RK46", [[ROOM, NOROOM_ORDER, NOROOM_669]],
    RC, "G shared room no-room: WITH NO ROOM OPEN, THE ROOM ANSWERS \"no-room\"", "RED"],   // 669's order: the rung's check first, "upgrade-first" for every rung
  ["RK47", [[ROOM, NOROOM_ORDER, RUNG_LINE]],
    RC, "G bot room no-room: WITH NO ROOM OPEN, THE ROOM ANSWERS \"no-room\"", "RED"],   // the room's check gone: the same wrong answer, in both room types
  ["RK48", [[ROOM, NOROOM_ORDER, NOROOM_ORDER.replace("reason: \"no-room\" }", "reason: \"upgrade-first\" }")]],
    RC, "G shared room no-room: WITH NO ROOM OPEN, THE ROOM ANSWERS \"no-room\"", "RED"],   // asked first, but answering the old words
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
      const h = J.open("mutate-j129-rank-change:" + id, file);   // journalled BEFORE the write
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
