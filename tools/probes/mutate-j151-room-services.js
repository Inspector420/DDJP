// tools/probes/mutate-j151-room-services.js
// SUBJECT: J151 at `ddjp_716` and `ddjp_717` — A ROOM ALLOWS THE SONG SERVICES ITS OWNER TURNS ON, AND EVERY SEND IS ANSWERED: the setting
// (`songServices`, its keys from `core/songs.js`), the reducer's rule in both engines, the one predicate through the interface,
// My queue's add door, window, ring and (`ddjp_717`) its silent drop where 716 swapped, every refusal code a join, a declare, an order and an undeclare can get,
// both engines' answers carrying that code, the settings row, the screen kept on while a song plays, the ＋ inside a playlist
// saying a refusal and no wait while the page is hidden (`ddjp_717`) — `check-room-services`,
// `check-bot-answers` F and G, `check-queue-redraw` M and N, `check-settings-apply` T, `check-player-check` J. The owner's words
// (`ddjp_716`): "id say not turned on in room settings and missing means not allowed except for youtube"; "A refusal gets
// released, never stuck". One row per thing the build does, each naming the failure it must cause; the controls change
// nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j151-reuse-fix.js` (whose runner this is, unchanged): every
// edit is recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard
// starts AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j151-room-services.js            every row
//   node tools/probes/mutate-j151-room-services.js RS1 RS5    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js";
const SM = "backends/backend1/streammanager.js";
const MB = "backends/backend1/matrixbridge.js";
const AU = "backends/backend2/authority.js";
const RU = "backends/backend2/runner.js";
const SONGS = "core/songs.js";
const ROOM = "features/room.js";
const UQ = "features/userqueue.js";
const FPL = "features/playlists.js";
const QUI = "ui/queue.js";
const PLUI = "ui/playlists.js";
const SET = "ui/settings.js";
const PLAYER = "ui/player.js";
const HTML = "index.html";
const RS = "check-room-services", BA = "check-bot-answers", QR = "check-queue-redraw", SA = "check-settings-apply", PC = "check-player-check";
const ROWS = [
  // ── A: the setting, its keys derived from the song table, YouTube never in it ──
  ["RS1", [[SD, "return Songs.services().filter((x) => !x.always).map((x) => x.short);", "return Songs.services().map((x) => x.short);"]],
    RS, "A — THE SETTING", "RED"],   // YouTube given a setting
  ["RS2", [[SD, "      songServices: {},\n", "      songServices: { sc: true },\n"]],
    RS, "A — THE SETTING", "RED"],   // on by default
  ["RS3", [[SD, "songServices:         { keys: () => _optionalServices(), flags: true, scale: 1 },", "songServices:         { keys: () => _optionalServices(), scale: 1 },"]],
    RS, "A — THE SETTING", "RED"],   // not a flag map
  ["RS4", [[SONGS, "      always: true,\n", ""]],
    RS, "B — YOUTUBE IS NEVER REFUSED FOR IT", "RED"],   // YouTube a service a room must turn on
  // ── B: the room's rule, at log position, in both engines ──
  ["RS5", [[SD, "carries no service. Never re-judged by a later change.\n        { const _s = songOf(c); if (_s && !serviceAllowed(_s.songKey, settings)) { _rej(ev, \"service-not-allowed\"); continue; } }\n", "carries no service. Never re-judged by a later change.\n"]],
    RS, "B — A JOIN OR A DECLARE OF A SERVICE THE ROOM DOES NOT ALLOW THERE IS REFUSED", "RED"],   // a join not judged
  ["RS6", [[SD, "        // The same song-service rule as join (`ddjp_716`), at this position.\n        { const _s = songOf(c); if (_s && !serviceAllowed(_s.songKey, settings)) { _rej(ev, \"service-not-allowed\"); continue; } }\n", "        // The same song-service rule as join (`ddjp_716`), at this position.\n"]],
    RS, "B — A JOIN OR A DECLARE OF A SERVICE THE ROOM DOES NOT ALLOW THERE IS REFUSED", "RED"],   // a declare not judged
  ["RS7", [[SD, "    return !!(on && typeof on === \"object\" && on[svc.short] === true);", "    return !(on && typeof on === \"object\" && on[svc.short] === false);"]],
    RS, "B — A JOIN OR A DECLARE OF A SERVICE THE ROOM DOES NOT ALLOW THERE IS REFUSED", "RED"],   // missing read as allowed
  ["RS8", [[SD, "    \"service-not-allowed\":          \"songs from that service aren't allowed in this room\",\n", ""]],
    RS, "B — its words", "RED"],   // no words
  ["RS9", [[SD, "    const ss = _flagMap(\"songServices\", s.songServices);\n    if (ss) settings.songServices = ss;\n", ""]],
    RS, "B — TURNED ON, A LATER JOIN IS ADMITTED", "RED"],   // the setting never taken from its event
  // ── C: one predicate, through the interface ──
  // RE-ANCHORED AT J153 (`ddjp_720`): the catch answers `false` now (fail closed); the row still answers yes to everything.
  ["RS10", [[SM, "    try { return StateDeriver.serviceAllowed(songKey, (getState() || {}).settings || {}); } catch (e) { return false; }", "    return true;"]],
    RS, "C — ONE PREDICATE", "RED"],   // the interface answers yes to everything
  ["RS11", [[ROOM, "    try { return typeof StreamManager.serviceAllowed !== \"function\" || StreamManager.serviceAllowed(songKey) !== false; } catch (e) { return true; }", "    return true;"]],
    RS, "C — ONE PREDICATE", "RED"],   // Room does not pass it through
  // ── D: the add door ──
  ["RS12", [[UQ, "    const off = _serviceRefusal(id);\n    if (off) return off;\n", ""]],
    RS, "D — A PASTED SOUNDCLOUD LINK IS REFUSED", "RED"],   // taken into My queue
  ["RS13", [[UQ, " songs aren't allowed in this room.\", service", " songs are not allowed\", service"]],
    RS, "D — A PASTED SOUNDCLOUD LINK IS REFUSED", "RED"],   // the agreed words changed
  ["RS14", [[PLUI, "\" left out: not allowed in this room.\";", "\" skipped.\";"]],
    RS, "D — +ALL SAYS WHAT WAS LEFT OUT", "RED"],   // +All's note not naming the service
  ["RS15", [[FPL, "      return { ok: false, code: why.code || \"bad-link\", reason: why.reason || \"not a song link\" };\n    }\n    return addTrack(id, songKey);", "      return { ok: false, code: why.code || \"bad-link\", reason: why.reason || \"not a song link\" };\n    }\n    if (/^sc:/.test(songKey)) return { ok: false, code: \"service-not-allowed\", reason: \"no\" };\n    return addTrack(id, songKey);"]],
    RS, "D — A PLAYLIST ITSELF TAKES A SOUNDCLOUD SONG", "RED"],   // a playlist refusing it
  // ── E: My queue's window, ring and take-back ──
  ["RS16", [[UQ, "      if (_serviceOk(e.songKey)) out.push(e);\n      else if (onBarred) onBarred(e);\n", "      out.push(e);\n"]],
    RS, "E — THE DROP", "RED"],   // an undeclared song the room does not allow counted in the window and declared
  ["RS17", [[UQ, "      return \"not-allowed\";\n    }", "      return null;\n    }"]],
    RS, "E — THE DROP", "RED"],   // one further down not read "not-allowed" (no ring)
  ["RS18", [[UQ, "    _say(\"dropped \" + gone.map((e) => e.songKey).join(\", \") + \" \\u2014 not allowed in this room now, never sent\");\n", ""]],
    RS, "E — THE DROP", "RED"],   // dropped unsaid
  ["RS19", [[QUI, "            slot.classList.add(\"not-allowed\");\n", ""]],
    QR, "M: THE SONG NOT ALLOWED IS RINGED IN ITS PLACE", "RED"],   // no ring
  ["RS20", [[QUI, "unless the owner turns \" + name + \" on first.\");", "unless the owner turns it on first.\");"]],
    QR, "M: its words, on its picture", "RED"],   // its words not naming the service
  ["RS21", [[HTML, ".thumb-slot.not-allowed { outline: 2px solid #ff6b6b; outline-offset: -2px; }", ".thumb-slot.not-allowed { border: 2px solid #ff6b6b; }"]],
    QR, "M: THE RING IS AN OUTLINE", "RED"],   // a border: the row grows
  // ── F: every refusal, each code a join, a declare, an order and an undeclare can get ──
  ["RS22", [[UQ, "    if (songOnly && !_serviceOk(v)) _dropRefused(v, code);", "    if (false) _dropRefused(v, code);"]],
    RS, "F — service-not-allowed: the refused song is dropped", "RED"],   // held, not dropped
  ["RS23", [[UQ, "    if (status === \"no\" && active && (amInRotation() || songOnly)) _kick();", "    if (status === \"no\" && active && amInRotation()) _kick();"]],
    RS, "F — service-not-allowed on a first join", "RED"],   // the next allowed song waits for some later event
  ["RS24", [[UQ, "    if (code === \"queue-full\" || code === \"queue-unchanged\") return", "    if (code === \"queue-unchanged\") return"]],
    RS, "F — queue-full gone by the answer", "RED"],   // queue-full held though the room changed
  ["RS25", [[UQ, "    if (code === \"queue-full\" || code === \"queue-unchanged\") return", "    if (code === \"queue-full\") return"]],
    RS, "F — queue-unchanged gone by the answer", "RED"],   // queue-unchanged held though the room changed
  ["RS26", [[UQ, "    if (code === \"queue-full\" || code === \"queue-unchanged\") return _effectiveDeclaredCount() + inFlight.length >= CAP;", "    if (code === \"queue-full\" || code === \"queue-unchanged\") return true;"]],
    RS, "F — queue-full while it still holds", "RED"],   // held for ever, though the buffer has room again
  ["RS27", [[UQ, "    const again = holds === false && _retried[v] !== code;", "    const again = holds === false;"]],
    RS, "F — queue-full gone by the answer", "RED"],   // sent again and again
  ["RS28", [[UQ, "    if (status === \"no\" && active && (amInRotation() || songOnly)) _kick();", "    if (status === \"no\" && active) _kick();"]],
    RS, "F — rank-below-min-dj outside the queue", "RED"],   // the list run down into the same refusal
  ["RS29", [[UQ, "      if (a.status === \"none\" && attempt < 2) {", "      if (a.status === \"none\" && attempt < 1) {"]],
    RS, "F — no answer at all", "RED"],   // no answer never sent again
  ["RS30", [[UQ, "if (h.sig !== sig && _causeHolds(h.code, v) !== true) delete _held[v];", "if (false) delete _held[v];"]],
    RS, "F — no-sender: released", "RED"],   // held for ever
  ["RS31", [[UQ, "if (h.sig !== sig && _causeHolds(h.code, v) !== true) delete _held[v];", "if (false) delete _held[v];"]],
    RS, "F — not-a-member: released", "RED"],
  ["RS32", [[UQ, "if (h.sig !== sig && _causeHolds(h.code, v) !== true) delete _held[v];", "if (false) delete _held[v];"]],
    RS, "F — uncoded: released", "RED"],
  ["RS33", [[UQ, "                                 () => { _pull(_pendingRemovals, id); _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))", "                                 () => { _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))"]],
    RS, "F — undeclare no-sender", "RED"],   // a refused undeclare left waiting
  ["RS34", [[UQ, "                                 () => { _pull(_pendingRemovals, id); _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))", "                                 () => { _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))"]],
    RS, "F — undeclare not-a-member", "RED"],
  ["RS35", [[UQ, "                                 () => { _pull(_pendingRemovals, id); _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))", "                                 () => { _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))"]],
    RS, "F — undeclare no-song-key", "RED"],
  ["RS36", [[UQ, "                                 () => { _pull(_pendingRemovals, id); _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))", "                                 () => { _notify(); }, () => _pendingRemovals.indexOf(id) >= 0))"]],
    RS, "F — undeclare not-in-my-queue", "RED"],
  ["RS37", [[UQ, "_follow(r, 1, () => Queue.reorder(order), () => {}, () => true)", "_follow(r, 1, () => Queue.reorder(order), () => { Queue.reorder(order); }, () => true)"]],
    RS, "F — order no-sender", "RED"],   // a refused order sent again by itself
  ["RS38", [[UQ, "_follow(r, 1, () => Queue.reorder(order), () => {}, () => true)", "_follow(r, 1, () => Queue.reorder(order), () => { Queue.reorder(order); }, () => true)"]],
    RS, "F — order not-a-member", "RED"],
  ["RS39", [[UQ, "_follow(r, 1, () => Queue.reorder(order), () => {}, () => true)", "_follow(r, 1, () => Queue.reorder(order), () => { Queue.reorder(order); }, () => true)"]],
    RS, "F — order empty-selection", "RED"],
  ["RS40", [[UQ, "_follow(r, 1, () => Queue.reorder(order), () => {}, () => true)", "_follow(r, 1, () => Queue.reorder(order), () => { Queue.reorder(order); }, () => true)"]],
    RS, "F — order selection-unchanged", "RED"],
  ["RS41", [[UQ, "_follow(r, 1, () => Queue.reorder(order), () => {}, () => true)", "_follow(r, 1, () => ({ ok: true }), () => {}, () => true)"]],
    RS, "F — order with no answer", "RED"],   // an order with no answer never sent again
  // ── F: the code carried in both engines' answers ──
  ["RS42", [[UQ, "      giveUp(a.reason || a.status, a.status, a.code || null);", "      giveUp(a.reason || a.status, a.status, null);"]],
    RS, "F — service-not-allowed: the refused song is dropped", "RED"],   // the app reads the words, not the code
  ["RS43", [[MB, "    const code = r && typeof r.code === \"string\" ? r.code : null;", "    const code = null;"]],
    BA, "G: refused, it is the no", "RED"],   // a shared room's answer without its code
  ["RS44", [[MB, "reason: String(c.reason || \"refused\"), code: typeof c.code === \"string\" ? c.code : null });", "reason: String(c.reason || \"refused\"), code: null });"]],
    BA, "G: and the bot's refusal is the no", "RED"],   // a bot room's answer without its code
  ["RS45", [[AU, "             code: typeof code === \"string\" ? code : null,\n", ""]],
    BA, "F: AND ITS CODE", "RED"],   // the bot's refusal carries none
  ["RS46", [[RU, "raw.event_id, verdict.reason, verdict.code));", "raw.event_id, verdict.reason));"]],
    BA, "F: AND ITS CODE", "RED"],   // the runner does not pass it
  // ── G: the screen kept on while a song plays ──
  ["RS47", [[PLAYER, "    if (np.song) { startProgress(); _showPlayerShield(false); _wake(true); }", "    if (np.song) { startProgress(); _showPlayerShield(false); }"]],
    PC, "J — THE SCREEN KEPT ON WHILE A SONG PLAYS", "RED"],   // never taken
  ["RS48", [[PLAYER, "      _endedPi = np.pi;\n      _wake(false);\n", "      _endedPi = np.pi;\n"]],
    PC, "J — THE SCREEN KEPT ON WHILE A SONG PLAYS", "RED"],   // kept through the hold at a song's end
  ["RS49", [[PLAYER, "    if (!hidden && _wakeWanted) _wake(true);", ""]],
    PC, "J — THE SCREEN KEPT ON WHILE A SONG PLAYS", "RED"],   // not taken again when shown
  ["RS50", [[PLAYER, "    _watchTab(false);\n    _wake(false);\n", "    _watchTab(false);\n"]],
    PC, "J — THE SCREEN KEPT ON WHILE A SONG PLAYS", "RED"],   // kept after the room is left
  ["RS51", [[PLAYER, "        Logger.info(\"Player: screen kept on while the song plays (wake lock taken)\");\n", ""]],
    PC, "J — THE SCREEN KEPT ON WHILE A SONG PLAYS", "RED"],   // taken unsaid
  // ── H: the settings row ──
  ["RS52", [[SET, "      _renderSongServiceRows(s, _editableFor(\"songServices\"));\n", ""]],
    SA, "T: ONE ROW PER SONG SERVICE BEYOND YOUTUBE", "RED"],   // no row
  ["RS53", [[SET, "cur[short] === true ? \"on\" : \"off\"", "cur[short] === false ? \"off\" : \"on\""]],
    SA, "T: \"SoundCloud songs\", Off and On", "RED"],   // On in a room that never set it
  ["RS54", [[SONGS, "      allowInfo: \"Off by default. Browsers", "      allowInfo: \"Off unless turned on. Browsers"]],
    SA, "T: ITS ⓘ SAYS THE OWNER'S WORDS", "RED"],   // his words changed
  ["RS55", [[SET, "{ [short]: v === \"on\" }", "{ [short]: v === \"off\" }"]],
    SA, "T: AND APPLY SENDS THE WHOLE MAP", "RED"],   // On sends off
  ["RS56", [[SET, "      _renderSongServiceRows(s, _editableFor(\"songServices\"));\n", ""],
            [SET, "    });\n\n    _section(\"songs\", \"Songs\",", "      _renderSongServiceRows(s, _editableFor(\"songServices\"));\n    });\n\n    _section(\"songs\", \"Songs\","]],
    SA, "T: ONE ROW PER SONG SERVICE BEYOND YOUTUBE", "RED"],   // drawn after the repeats row, not under Who can DJ
  // ── `ddjp_717`: no swap, a declared song never ringed, the drop many in one step, the ＋'s line, no wait while hidden ──
  ["RS57", [[UQ, "      if (pool[e.songKey] > 0) { pool[e.songKey]--; out.push(e); continue; }", "      if (pool[e.songKey] > 0 && _serviceOk(e.songKey)) { pool[e.songKey]--; out.push(e); continue; }"]],
    RS, "E — NO SWAP", "RED"],   // 716's swap: a declared song the room no longer allows taken back
  ["RS58", [[UQ, "    if (i < 0 || i >= intent.length) return null;\n    const due = [];", "    if (i < 0 || i >= intent.length) return null;\n    if (!_serviceOk(intent[i].songKey)) return \"not-allowed\";\n    const due = [];"]],
    RS, "E — A DECLARED SONG IS NEVER RINGED", "RED"],   // 716's ring on every song the room does not allow, declared or not
  ["RS59", [[UQ, "    _walk((e) => gone.push(e));", "    _walk((e) => { if (!gone.length) gone.push(e); });"]],
    RS, "E — THE DROP", "RED"],   // one song a step, not as many as it takes
  ["RS60", [[PLUI, "if (say) say(\"Couldn't add: \" + r.reason); }", "}"]],
    QR, "N: A REFUSED ＋ SAYS WHY ON THIS PLAYLIST'S LINE", "RED"],   // the refusal to the log only (716's)
  ["RS61", [[PLUI, "        else if (r && r.ok && say) say(\"\"); } }));", "        } }));"]],
    QR, "N: and an add that lands clears it", "RED"],   // an old refusal left on the line
  ["RS62", [[UQ, "    if (_hidden()) {\n", "    if (false) {\n"]],
    RS, "G — NO BACKGROUND DIFFERENCE: hidden", "RED"],   // a hidden page waits for the settle timer
  // ── CONTROLS: nothing that matters changes ──
  ["RSG1", [[UQ, "  // THE WINDOW (`ddjp_717`): the first CAP songs of my list holding no refusal", "  // THE WINDOW (`ddjp_717`) — the first CAP songs of my list holding no refusal"]],
    RS, "", "GREEN"],   // a comment reworded
  ["RSG2", [[SET, "  function _renderSongServiceRows(s, editable) {", "  function _renderSongServiceRows(s, editable) {   // one row per service a room turns on"]],
    SA, "", "GREEN"],   // a comment added
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
      const h = J.open("mutate-j151-room-services:" + id, file);   // journalled BEFORE the write
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
