// tools/probes/mutate-j115-fixes.js
// SUBJECT: J115 (`ddjp_619`) — the seven defects the `ddjp_618` close found, each fixed with a guard that was red before
// the fix, and the "Video hidden" cover (J112). Each row puts one fix back the way it was and must turn its guard red
// NAMING it; each control changes nothing and must leave its guard green.
//   PC — the presence chat is a chat: neither stored nor folded (`check-chat-at-rest`), and what is on disk goes.
//   GT — a shared room's plan keeps the table's `gates` (`check-shared-room-gates`).
//   UW — a detected hole's witness pass is urgent (`check-urgent-witness`).
//   BE — the bot reads join times once the room is replayed (`check-bot-entry-replay`).
//   LL — the seed-mismatch line says what it decides (`check-seed-validation` L).
//   CP — the chat sounds, volumes and tier save (`check-chat-prefs`).
//   RM — nothing sent is not a removal (`check-idle-sweep` D2b).
//   VH — the cover reads "Video hidden" (`check-player-cover` A).
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j115-fixes.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", EC = "backends/backend1/eventcache.js", SM = "backends/backend1/streammanager.js";
const ROOM = "features/room.js", BOT = "features/botruntime.js", CPF = "core/chatprefs.js", PLAYER = "ui/player.js";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // PC1 — the presence chat is not a chat again: its messages reach the store and the fold.
  ["PC1", [[MB, "    const pKey = _presenceChatKey();\n    return !!(n && pKey && channelKeyFromName(n) === pKey);", "    return false;"]],
    "check-chat-at-rest", "FAIL — A: a presence-chat message (plain text) is NOT written to the event cache", "RED"],
  // PC2 — the sweep is never run: what earlier builds stored stays on disk.
  ["PC2", [[MB, "    await EventCache.ensureLoaded();\n    _sweepHeldChat();\n", "    await EventCache.ensureLoaded();\n"]],
    "check-chat-at-rest", "FAIL — C: `replayRoom` runs `_sweepHeldChat()` right after loading the cache", "RED"],
  // PC3 — the cache's drop matches no room: the sweep runs and removes nothing.
  ["PC3", [[EC, "      if (!raw || !rooms.has(raw.room_id)) continue;\n      _mem.delete(key); dropped++;", "      continue;\n      _mem.delete(key); dropped++;"]],
    "check-chat-at-rest", "FAIL — C: the sweep drops the three raws held from the two chat rooms", "RED"],
  // GT1 — the plan backend1 registers drops `gates` again: every shared room's chats at `redact: 100`.
  ["GT1", [[MB, "      c.gates ? { gates: Object.assign({}, c.gates) } : {}));", "      {}));"]],
    "check-shared-room-gates", "FAIL — A: the registered plan's `chat_uncategorized` carries `redact` at the staff rung", "RED"],
  // UW1 — the witness pass is never marked urgent: a hole waits its rank slot.
  ["UW1", [[MB, "      urgent: urgent,                                    // a detected hole: jitter only, no rank wait\n", ""]],
    "check-urgent-witness", "FAIL — B: a detected hole's pass is planned URGENT", "RED"],
  // UW2 — a hole arriving while a routine pass waits is folded into it (the coalescing the cancel exists for).
  ["UW2", [[MB, "      if (!urgent || _proactivePlannedUrgent) return;   // the pending pass covers this one", "      return;"]],
    "check-urgent-witness", "FAIL — C: a hole detected while a routine pass waits its slot is planned urgent", "RED"],
  // BE1 — the room never has the bot read join times after the replay.
  ["BE1", [[ROOM, "typeof BotRuntime.reseed === \"function\") BotRuntime.reseed(); }", "false) BotRuntime.reseed(); }"]],
    "check-bot-entry-replay", "FAIL — A: after the opening, each DJ's join time is when their replayed join was sent", "RED"],
  // BE2 — the room does not tell the bot the replay is pending: it claims a replay of an empty queue at entry.
  ["BE2", [[ROOM, "        replayPending: !_replayed,\n", ""]],
    "check-bot-entry-replay", "FAIL — A: at the room's entry, before the replay, the bot says it will read join times", "RED"],
  // LL1 — the mismatch line claims the forgetting licence again.
  ["LL1", [[SM, "\"mismatched, and while this tab holds the room from its start it does not seal on that save point\"",
    "\"mismatched; forgetting is not licensed at this cut\""]],
    "check-seed-validation", "FAIL — L: the line no longer claims the mismatch stops forgetting", "RED"],
  // CP1 — the save compares only the markers again: a sound, a volume or a tier is lost on reload. RE-ANCHORED AT J68
  // (`ddjp_635`), with the reason: the comparison also holds the bot's alarm volume now (the owner's decision 3).
  ["CP1", [[CPF, ", ms: st.mentionSound, mv: st.mentionVolume, ds: st.dmSound,\n      dv: st.dmVolume, ct: st.chatTier, av: st.botAlarmVolume });", " });"]],
    "check-chat-prefs", "FAIL — J115: the mention sound switched off survives a reload", "RED"],
  // RM1 — an answer of nothing sent reads as a removal again.
  ["RM1", [[BOT, "!!(r && typeof r === \"object\" && r.ok !== false)", "!(r && r.ok === false)"]],
    "check-idle-sweep", "FAIL — D2b: and an answer of NOTHING SENT comes back out of the report", "RED"],
  // VH1 — the cover gets its tail back.
  ["VH1", [[PLAYER, "  const COVER_HIDDEN_LABEL = \"Video hidden\";", "  const COVER_HIDDEN_LABEL = \"Video hidden \\u2014 the sound keeps playing\";"]],
    "check-player-cover", "FAIL — A: HIDDEN, while a song plays", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[MB, "  let _heldChatSwept = false;", "  let _heldChatSwept =  false;"]], "check-chat-at-rest", "", "GREEN"],
  ["N2", [[MB, "  let _proactivePlannedUrgent = false;", "  let _proactivePlannedUrgent =  false;"]], "check-urgent-witness", "", "GREEN"],
  ["N3", [[ROOM, "    _replayed = true;\n", "    _replayed =  true;\n"]], "check-bot-entry-replay", "", "GREEN"],
  ["N4", [[MB, "  function channelTaxonomy() {", "  function channelTaxonomy()  {"]], "check-shared-room-gates", "", "GREEN"],
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
