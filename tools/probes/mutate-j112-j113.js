// tools/probes/mutate-j112-j113.js
// SUBJECT: J112's four remaining items and J113 (`ddjp_620`), and the reseed row the owner's planted bug passed. Each row
// puts one fix back the way it was and must turn its guard red NAMING it; each control changes nothing and must leave its
// guard green.
//   RS — the bot's re-read after the replay starts from nothing (`check-bot-entry-replay` C).
//   SA — a bot room is not asked to seal, and its pager stays (`check-bot-room-seal`).
//   BG — the background link box takes its row's width (`check-settings-apply` O).
//   BV — the bot's tab with its playback off says so (`check-player-cover` F).
//   PL — the presence labels say what they show (`check-settings-rows` I, `check-settings-apply` P).
//   CS — a live chat stays at its end as an image loads (`check-chat-view` Z2).
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j112-j113.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", SK = "backends/backend2/skeleton.js", TR = "backends/backend2/transport.js";
const BOT = "features/botruntime.js", SET = "ui/settings.js", HTML = "index.html", PLAYER = "ui/player.js", CHAT = "ui/chat.js";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // RS1 — the owner's planted bug: the re-read keeps what a live event stamped during the replay.
  ["RS1", [[BOT, "    for (const u in _entries) delete _entries[u];\n    const known = _seedAndSay();", "    const known = _seedAndSay();"]],
    "check-bot-entry-replay", "FAIL — C: once the room is replayed, dj4", "RED"],
  // SA1 — the cadence tick armed in a bot room again.
  ["SA1", [[MB, "      if (_enginePeerSeals()) _startSealTick(); else _stopSealTick();", "      _startSealTick();"]],
    "check-bot-room-seal", "FAIL — A: no seal cadence tick is armed in a bot room", "RED"],
  // SA2 — only the tick stopped: a play still asks the seal (what stopping the tick alone was measured to leave).
  ["SA2", [[MB, "    if (!_enginePeerSeals()) return;\n", ""]],
    "check-bot-room-seal", "FAIL — A: a bot room writes no `nowhere-to-post` line", "RED"],
  // SA3 — the bot engine stops declaring it.
  ["SA3", [[SK, "     peerSeals: false,\n", ""]],
    "check-bot-room-seal", "FAIL — A: a bot room writes no `nowhere-to-post` line", "RED"],
  // SA4 — the trap J113 names: `wireCheckpoints` made a no-op in a bot room takes the pager with it.
  ["SA4", [[TR, "  seedClock: function (roomId) {\n", "  wireCheckpoints: function () {},\n  seedClock: function (roomId) {\n"]],
    "check-bot-room-seal", "FAIL — C: the bot room's own history backfill says ok", "RED"],
  // SA5 — the gate fails closed: an unreadable registry would stop a shared room sealing.
  ["SA5", [[MB, "      return !(d && d.peerSeals === false);\n    } catch (e) { return true; }", "      return !(d && d.peerSeals === false);\n    } catch (e) { return false; }"]],
    "check-bot-room-seal", "FAIL — D: and with no registry, or one that throws, it fails OPEN", "RED"],
  // BG1 — the link row back in the number boxes' group.
  ["BG1", [[SET, "class: \"set-num set-link\"", "class: \"set-num\""]],
    "check-settings-apply", "FAIL — O: the background link box GROWS", "RED"],
  // BG2 — the rule that lets it grow, gone.
  ["BG2", [[HTML, "    .set-num.set-link .uq-input { flex: 1 1 auto; }   /* a link takes the width its row has, not a number box's 92px */\n", ""]],
    "check-settings-apply", "FAIL — O: the background link box GROWS", "RED"],
  // BV1 — the bot's tab with its playback off keeps whatever its cover last said.
  ["BV1", [[PLAYER, "        if (_idleLabel !== COVER_BOT_OFF_LABEL) _showPlayerShield(true, COVER_BOT_OFF_LABEL);\n", ""]],
    "check-player-cover", "FAIL — F: while the room plays, the bot's tab with its playback off", "RED"],
  // PL1 — Room presence's removal says nothing of where from again.
  ["PL1", [[CHAT, "      botPresenceRemove: \"Room presence: remove from the presence chat when away\",", "      botPresenceRemove: \"Room presence: remove when away\","]],
    "check-settings-rows", "FAIL — I: every away setting carries its name", "RED"],
  // PL2 — Room presence's explanation says People cannot count chat again. RE-ANCHORED AT ddjp_621: the chat switch is a
  // tick in the actions list now (the owner's change), so the sentence lives under that list's More.
  ["PL2", [[SET, "queue list. People counts the chat you can see. Chat is never stored", "queue list. Chat is never stored, so the People list can\\u2019t count it itself. Chat is never stored"]],
    "check-settings-apply", "FAIL — P: it says People counts the chat you can see", "RED"],
  // PL3 and PL4 RETIRED AT ddjp_621: the reach note and the line naming a chat the tab could not fully tell for are gone —
  // the owner removed all the small text under People's header (check 14). Nothing is left for them to put back;
  // `mutate-j116-live-findings` row PH1 puts a line back under the header instead.
  // CS1 — a scroll from growth below a live chat reads as scrolling up again (the order Chromium was seen to use).
  ["CS1", [[CHAT, "      else if (st.live && box.scrollTop >= st.seen) toEnd();                 // grew below a live chat, not scrolled up (J112)\n", ""]],
    "check-chat-view", "FAIL — Z2: and when the growth's scroll arrives BEFORE the image's load", "RED"],
  // CS3 — a tolerance on "did not move up": a slow scroll up is snapped back to the end and never leaves live.
  ["CS3", [[CHAT, "      else if (st.live && box.scrollTop >= st.seen) toEnd(); ", "      else if (st.live && box.scrollTop >= st.seen - 1) toEnd(); "]],
    "check-chat-view", "FAIL — Z2: and scrolling up half a pixel at a time leaves live too", "RED"],
  // CS2 — the image's load no longer keeps a live chat at its end.
  ["CS2", [[CHAT, "      if (!st.live || !shown() || !e || !e.target || e.target.tagName !== \"IMG\") return;", "      return;"]],
    "check-chat-view", "FAIL — Z2: and growth that sends no scroll", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[MB, "  function _enginePeerSeals() {", "  function _enginePeerSeals()  {"]], "check-bot-room-seal", "", "GREEN"],
  ["N2", [[SET, "class: \"set-num set-link\" }, [input, clearBtn]));", "class: \"set-num set-link\" },  [input, clearBtn]));"]], "check-settings-apply", "", "GREEN"],
  ["N3", [[CHAT, "const toEnd = () => { box.scrollTop = box.scrollHeight; st.seen = box.scrollTop; };", "const toEnd = () => { box.scrollTop = box.scrollHeight;  st.seen = box.scrollTop; };"]], "check-chat-view", "", "GREEN"],
  ["N4", [[PLAYER, "  const COVER_BOT_OFF_LABEL = \"Playback is off on this tab (the bot's)\";", "  const COVER_BOT_OFF_LABEL =  \"Playback is off on this tab (the bot's)\";"]], "check-player-cover", "", "GREEN"],
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
