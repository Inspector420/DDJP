// tools/probes/mutate-j145-matrix-status.js
// SUBJECT: J145 — Matrix slow-downs: the app paces itself, and your picture says where things stand (the owner's plan, part 3,
// `ddjp_697`): the status piece (`features/matrixstatus.js` — its one table, the orange rule, the connection mapping, the ring), the
// transport's one pacer and its send sites (`backends/backend1/matrixbridge.js` `_sendPace`, `_paced`, `_eventOut`, `sendMembership`,
// every `// kind:` tag), your picture's ring and menu (`ui/roster.js` `ownPicture`; `ui/screens.js` the room list's header), the
// chat's orange note (`ui/chat.js` `_noteSlow`) and a wait said in place (`ui/base.js` `slowWait`; `ui/screens.js` the leave line),
// all held by `check-matrix-status`. One row per way it could go wrong, each naming the failure it must cause; the controls change
// nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j145-matrix-status.js            every row
//   node tools/probes/mutate-j145-matrix-status.js K1 O2      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MS = "features/matrixstatus.js";
const MB = "backends/backend1/matrixbridge.js";
const RO = "ui/roster.js";
const SC = "ui/screens.js";
const CH = "ui/chat.js";
const BA = "ui/base.js";
const PAGE = "index.html";
const G = "check-matrix-status";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── T: the one table ──
  ["T1", [[MS, "Object.freeze({ key: \"actions\", label: \"Actions & Chat\",", "Object.freeze({ key: \"actions\", label: \"Chat\","]],   // re-anchored at `ddjp_702`: the owner's new label
    G, "T: THE ONE TABLE", "RED"],   // a label not the owner's
  ["T2", [[RO, "\"aria-label\": \"You and Matrix\"", "\"aria-label\": \"User Ranking & Invites\""]],   // a label of today's (`ddjp_702`)
    G, "T: NO OTHER FILE SPELLS A KIND'S LABEL", "RED"],   // a second home for a label
  // ── K: every send site names a kind; the structure paced, events not ──
  ["K1", [[MB, "    await _paced(\"ranks\", () => client.invite(spaceId, userId));   // kind: ranks — an invite to the room, paced (`ddjp_697`)", "    await _paced(\"ranks\", () => client.invite(spaceId, userId));"]],
    G, "K: EVERY SEND SITE NAMES ITS KIND", "RED"],   // a send with no kind
  ["K2", [[MB, "// kind: membership — a moderator's kick, paced", "// kind: kicks — a moderator's kick, paced"]],
    G, "K: and every kind named is one from the table", "RED"],   // a kind the table does not have
  ["K3", [[MB, "    const room = await _paced(\"build\", () => client.createRoom(markedOptions(opts, spaceId, key)));", "    const room = await client.createRoom(markedOptions(opts, spaceId, key));"]],
    G, "K: THE ROOM'S STRUCTURE IS PACED", "RED"],   // a channel made at once, past the pacer
  ["K4", [[MB, "    await _eventOut(() => client.sendMessage(roomId, { msgtype: \"m.text\", body: text }), \"actions\");", "    await _paced(\"actions\", () => client.sendMessage(roomId, { msgtype: \"m.text\", body: text }));"]],
    G, "K: EVERY ROOM EVENT AND CHAT IS NOT PACED", "RED"],   // a chat message spaced like a structure send
  ["K5", [[MB, "    await _paced(\"ranks\", () => client.invite(spaceId, userId));   // kind: ranks", "    await _paced(\"build\", () => client.invite(spaceId, userId));   // kind: ranks"]],
    G, "K: every kind a pacer call names is in the table, and is the kind its line's tag names", "RED"],   // told under one kind, tagged another
  ["K6", [[MB, "    if (gap > 0) await _paceCounted((ms) => turn.sleep(ms, \"pace\"))(gap);\n", ""]],
    G, "K: and the two that pace themselves do", "RED"],   // joins and leaves not paced at the door
  // ── O: the orange rule ──
  ["O1", [[MS, "const SLOWED_MS = 60000;", "const SLOWED_MS = 30000;"]],
    G, "O: still Slowed 59 s after the wait's end", "RED"],   // green after half a minute (expected text re-worded at `ddjp_698`)
  ["O2", [[MS, "    if (ago < SLOWED_MS) {", "    if (false) {"]],
    G, "O: THEN \"Slowed N s ago\"", "RED"],   // green the moment the wait ends
  ["O3", [[MS, "    } else if (e.what === \"held\") {", "    } else if (e.what === \"landed\") { k.pushedAt = null; k.until = 0; _fire(); } else if (e.what === \"held\") {"]],
    G, "O: a send that lands does not turn it green early", "RED"],   // green on the next answer, orange again on the next push-back
  ["O4", [[MS, "    } else if (_timer !== null) { try { _unlater(_timer); } catch (e) {} _timer = null; }", "    }"]],
    G, "and the timer stops", "RED"],   // the timer left ticking with nothing orange
  ["O5", [[MS, "      if (_timer === null) _timer = _later(", "      _timer = _later("]],
    G, "still ONE timer", "RED"],   // a second timer on every change
  // ── C: the connection mapping ──
  ["C1", [[MS, "    if (syncState === \"ERROR\" || syncState === \"STOPPED\") return \"Offline\";", "    if (syncState === \"ERROR\" || syncState === \"STOPPED\" || syncState === \"RECONNECTING\") return \"Offline\";"]],
    G, "C: RECONNECTING NEVER FLIPS IT", "RED"],   // a hiccup flips it
  ["C2", [[MS, "{ state: \"Offline\", tone: \"warn\", text: \"Offline\" }", "{ state: \"Offline\", tone: \"bad\", text: \"Offline\" }"]],
    G, "C: ERROR — Offline, ORANGE", "RED"],   // Offline red, which his correction reverses
  // ── R: the ring's four states ──
  ["R1", [[MS, "      if (l.key === \"myRank\") { if (l.tone === \"bad\") red = true; }\n      else if (l.tone !== \"ok\") orange = true;", "      if (l.tone === \"bad\" || (l.key === \"connection\" && l.tone !== \"ok\")) red = true;\n      else if (l.tone !== \"ok\") orange = true;"]],
    G, "R: ORANGE — any line not OK, Offline included", "RED"],   // Offline rings red
  ["R2", [[MS, "    return red && orange ? \"both\" : red ? \"red\"", "    return red ? \"red\""]],
    G, "R: BOTH", "RED"],   // no diagonal: red hides the slow-down
  ["R3", [[PAGE, ".st-ring.st-both { background: linear-gradient(135deg,", ".st-ring.st-both { background: linear-gradient(90deg,"]],
    G, "R: THE SHEET DRAWS THE FOUR", "RED"],   // halves side by side, not on the diagonal
  ["R4", [[MS, "      if (!st) return null;   // no room open: no line", "      if (!st) return { state: \"OK\", tone: \"ok\", text: \"OK\" };"]],
    G, "R: NO ROOM OPEN — no My Rank line", "RED"],   // My Rank said outside a room
  // ── P: paced and not, through the real bridge ──
  ["P1", [[MB, "          if (!_is429(e)) throw e;\n          _sendPace.pushedBack(kind, _retryAfterMs(e));", "          throw e;\n          _sendPace.pushedBack(kind, _retryAfterMs(e));"]],
    G, "P: THE STATUS PIECE HEARS IT", "RED"],   // a pushed-back message dropped, unreported
  ["P2", [[MB, "          _sendPace.pushedBack(kind, _retryAfterMs(e));\n          await _paceSleep(", "          await _paceSleep("]],
    G, "P: THE STATUS PIECE HEARS IT", "RED"],   // retried, but nobody told
  ["P3", [[MB, "    if (!_evq.length && !_evDraining && _sendPace.waitingFor(k) <= 0) return _evTry(fn, k);", "    if (!_evq.length && !_evDraining) return _evTry(fn, k);"]],
    G, "P: WHILE IT WAITS, THE NEXT IS KEPT", "RED"],   // sent into the server's wait
  ["P4", [[MB, "      const gap = _sendPace.wait();\n      if (gap > 0) await _paceSleep(gap);\n", ""]],
    G, "P: THE ROOM'S STRUCTURE IS PACED — two invites", "RED"],   // `_paced` not waiting its turn
  // ── U: the UI reads only the module ──
  ["U1", [[RO, "    const ring = _ownState(rec).ring;", "    const ring = \"green\";"]],
    G, "U: YOUR PICTURE'S RING IS THE MODULE'S", "RED"],   // a ring decided in the UI
  ["U2", [[RO, "  const OWN_RINGS = [\"green\", \"orange\", \"red\", \"both\"];", "  const OWN_RINGS = [\"green\", \"orange\", \"red\", \"both\"]; const syncState = null; void syncState;"]],
    G, "U: NO ui/ FILE NAMES THE TRANSPORT'S STATUS", "RED"],   // the UI reaching for the transport's status
  // U3 re-anchored at `ddjp_699`: the menu's top row ends in the ⧉ that copies your ID (same intent: words he did not ask for).
  ["U3", [[RO, "    const parts = [H.el(\"div\", { class: \"st-head\" }, [pic, who, copy])];", "    const parts = [H.el(\"div\", { class: \"st-head\" }, [pic, who, copy]), H.el(\"div\", { text: \"Your status\" })];"]],   // re-anchored at `ddjp_702`
    G, "U: no other text", "RED"],   // words in the menu he did not ask for
  ["U4", [[SC, "    Roster.ownPicture(pic, { rank: false });", "    Roster.ownPicture(pic, { rank: true });"]],
    G, "U: THE ROOM LIST'S HEADER", "RED"],   // My Rank asked on the room list
  ["U5", [[RO, "      for (const r of _ownSlots) _paintOwn(r);\n      _drawMenuLines();\n", "      for (const r of _ownSlots) _paintOwn(r);\n"]],
    G, "U: and an open menu follows the module", "RED"],   // an open menu frozen
  // ── N: the chat note ──
  ["N1", [[CH, "      n.classList.toggle(\"slow\", !st.once && !!st.slow);   // orange, for this note only (`ddjp_697`)\n", ""]],
    G, "N: THE STRIP'S OWN NOTE, ORANGE", "RED"],   // the note grey like the others
  ["N2", [[CH, "    if (text === st.slow) return;\n    st.slow = text;", "    if (!text || text === st.slow) return;\n    st.slow = text;"]],
    G, "N: GONE WHEN SENT", "RED"],   // the note stays after the message went
  // ── W: a wait said where it happens ──
  ["W1", [[BA, "Matrix asked us to slow down.\" : \"\";", "rate limited.\" : \"\";"]],
    G, "W: THE WORDS", "RED"],   // not his words
  ["W2", [[SC, "        return [line(runningWords(job)), H.el(\"div\", { class: \"room-leave-track\" }, [fill])].concat(sw ? [sw] : []);", "        return [line(runningWords(job)), H.el(\"div\", { class: \"room-leave-track\" }, [fill])];"]],
    G, "W: A LEAVE'S LINE SAYS IT", "RED"],   // a leave that freezes without saying why
  // ── Controls: nothing that matters changes ──
  ["G1", [[PAGE, ".st-menu { position: fixed; z-index: 1000; width: 280px;", ".st-menu { position: fixed; z-index: 1000; width: 288px;"]],
    G, "", "GREEN"],   // the menu a little wider
  ["G2", [[MS, "  const TICK_MS = 1000;      // the countdown's tick, while a line is orange", "  const TICK_MS = 1000;      // the countdown's tick, while a line is orange (a control's edit)"]],
    G, "", "GREEN"],   // a comment
  ["G3", [[MB, "  const PACE_MAX_MS = 4000;   // the ceiling a run of push-backs widens it to", "  const PACE_MAX_MS = 5000;   // the ceiling a run of push-backs widens it to"]],
    G, "", "GREEN"],   // the ceiling a little higher: nothing here measures it
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
      const h = J.open("mutate-j145-matrix-status:" + id, file);   // journalled BEFORE the write
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
