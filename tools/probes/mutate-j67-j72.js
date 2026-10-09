// tools/probes/mutate-j67-j72.js
// SUBJECT: the J67 (open from the bot's save point, background reads) and J72 (song timing) changes.
//
// THE BREAKS THIS SESSION NAMED, AS A FILE (audit ddjp_512, finding 9). Each row plants one break,
// confirms the edit LANDED (the anchor occurs exactly once and the file's bytes changed), runs the
// named guard, and expects it RED on the named part. The file is restored after every row and on
// any exit, Ctrl-C included — a killed probe that leaves its break planted is a known hazard here.
//
//   node tools/probes/mutate-j67-j72.js            every row
//   node tools/probes/mutate-j67-j72.js S1 N1      just those rows
//
// A row whose anchor is gone reports VOID, never GREEN: the code moved, and the row must follow it.
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const B1 = "backends/backend1/streammanager.js", B2 = "backends/backend2/streammanager.js";
const MB = "backends/backend1/matrixbridge.js", RN = "backends/backend2/runner.js";
const AU = "backends/backend2/authority.js", BR = "features/botruntime.js", RM = "features/room.js";
const SD = "backends/backend1/statederiver.js";
const ROWS = [
  // ── J67 ─────────────────────────────────────────────────────────────────────────────────────
  ["S1", B1, '    if (e && e.type === "ddjp.room.settings") return _settingsCovered(f, e);\n', "", "check-bot-open", "FAIL — A"],
  ["S2", B1, "    if (f === _adopted) return ordered.filter((e) => !_coveredBy(f, e));\n", "", "check-bot-open", "FAIL"],
  ["S3", B1, "    const _bank = _bankedArrival(protocolL, raw.event_id, _adoptedSettings);",
             "    const _bank = _bankedArrival(protocolL, raw.event_id);", "check-bot-open", "FAIL — E"],
  ["S5", B1, "    const kept = eventLog.filter((e) => !_coveredBy(fl, e));", "    const kept = eventLog.slice();", "check-bot-open", "FAIL — A"],
  ["O1", B1, "    if (_adopted) return _adopted.seed || null;\n", "", "check-bot-open", "FAIL — O"],
  ["T1", RN, "    try { base = (StreamManager.floorSeed && StreamManager.floorSeed()) || undefined; } catch (e) { base = undefined; }",
             "    base = undefined;", "check-bot-open", "FAIL — F"],
  ["Y1", B2, "    if (!_fold.log || roomId !== _fold.log || !Array.isArray(events)) return false;",
             "    if (!Array.isArray(events)) return false;", "check-bot-open", "FAIL — I"],
  ["M1", B2, '      if (!b || b.t !== "ddjp.checkpoint" || !_usableSavePoint(b)) continue;',
             '      if (!b || b.t !== "ddjp.checkpoint" || !StateDeriver.isSeed(b.seed)) continue;', "check-bot-open", "FAIL — M"],
  // J1 MOVED WITH ITS RULE (J73 job 2): "an act carrying its own time is credited with it" left the bot
  // door's own store for the one activity module, unchanged. Same mutation, same guard, new home.
  ["J1", "backends/backend1/activity.js", '        _note(a.actor, _groupOf(a.t, a), (typeof a.at === "number" && isFinite(a.at)) ? a.at : raw.ts);',
         "        _note(a.actor, _groupOf(a.t, a), raw.ts);", "check-bot-open", "FAIL — J"],
  ["Y4", MB, "      reachedStart = (guard < 200) && !stoppedAtSavePoint;", "      reachedStart = (guard < 200);", "check-bot-open", "FAIL — I"],
  ["N1", MB, "        if (added === 0) { StreamManager.noteActivity([], { complete: true }); break; }\n        if (added < 0) break;",
             "        if (added <= 0) { StreamManager.noteActivity([], { complete: true }); break; }", "check-bot-open", "FAIL — N"],
  ["U3", RM, "        const r = StreamManager.openFromSavePoint();", '        const r = { ok: false, reason: "mutated" };', "check-bot-open", "FAIL — H"],
  ["AB1", SD, "    botAfkMs:             { min: 60000, max: 24 * 60 * 60 * 1000, scale: 60000 },",
              "    botAfkMs:             { min: 60000, max: 48 * 60 * 60 * 1000, scale: 60000 },", "check-bot-open", "FAIL — K"],
  ["V1", BR, "      _repeatFirst = { pi: np.pi, decidable: !late && v.known === true };",
             "      _repeatFirst = { pi: np.pi, decidable: v.known === true };", "check-repeat-cooldown", "FAIL — H2"],
  // X1 MOVED WITH THE RULE IT GUARDS (J73 Q10): the owner replaced J67's held-log rule with the
  // added-and-played comparison; the gate that lets an accepted song play is now that comparison.
  ["X1", BR, "      if (o.before === true) return { ok: true, reason: \"added-before-change\"", "      if (false) return { ok: true, reason: \"added-before-change\"", "check-repeat-cooldown", "FAIL — H3"],   // re-anchored at ddjp_536: the owner's rule replaced Q10's acceptance
  ["Z1", BR, "      if (fold.bounded === true) continue;\n", "", "check-idle-sweep", "FAIL — H"],
  ["AA1", RM, '          if (groups[g] === true && typeof row[g] === "number" && (last === null || row[g] > last)) last = row[g];',
              "          void g;", "check-idle-sweep", "FAIL — J67"],
  ["AA3", RM, '    if (older && typeof older === "object" && wantSpine) {', "    if (false) {", "check-idle-sweep", "FAIL — J67"],
  ["AC1", BR, '          if (typeof ts === "number" && (!_chatSeen[u] || ts > _chatSeen[u])) _chatSeen[u] = ts;', "          void ts;", "check-idle-sweep", "FAIL — Q2"],
  ["AC4", BR, "      let covered = tiers.length > 0;", "      let covered = true;", "check-idle-sweep", "FAIL — Q2"],
  // ── J72 ─────────────────────────────────────────────────────────────────────────────────────
  ["R1", RN, "      return { p: np.pi, key: np.pi, at: np.startedAt + a.gateLenSec * 1000 };",
             "      return { p: np.pi, key: np.pi, at: np.startedAt + a.gateLenSec * 1000 + 250 };", "check-bot-songs", "FAIL — A"],
  ["R2", RN, "      const wait = echoed ? ADVANCE_RETRY_MS : ((B2Authority.POLICY && B2Authority.POLICY.answerWindowMs) || 20000);",
             "      const wait = ADVANCE_RETRY_MS;", "check-bot-songs", "FAIL — D"],
  ["R3", RN, "    if (_advSent && _advSent.echoAt === null && (raw.event_id === _advSent.carrier || raw.event_id === _advSent.id)) _advSent.echoAt = now;\n", "", "check-bot-songs", "FAIL — D"],   // re-anchored at J77: the echo matched on its carrier
  ["R4", RN, "    if (_offset !== null) return Date.now() + _offset;\n", "", "check-bot-songs", "FAIL — K"],
  ["R7", RN, '    if (!(rt >= 0 && rt <= RT_MAX_MS) || typeof stamp !== "number") return;',
             '    if (!(rt >= 0 && rt <= RT_MAX_MS * 1000) || typeof stamp !== "number") return;', "check-bot-songs", "FAIL — K2"],
  ["R5", AU, "    if (gap < POLICY.gate.intervalMs) return {", "    if (false) return {", "check-bot-songs", "FAIL — L"],   // re-anchored at J76: the instantMinGapMs floor became the gate's spacing
  ["R6", AU, "if (r && r.sent > 0) _lastOpenAt = now;", "", "check-bot-songs", "FAIL — L"],   // re-anchored at J76: the drain became the record of a sending opening
];

let planted = null;   // { file, original } while a row is live
function restore() {
  if (!planted) return;
  fs.writeFileSync(planted.file, planted.original);
  planted = null;
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);

const only = process.argv.slice(2);
let red = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect] of ROWS) {
  if (only.length && only.indexOf(id) < 0) continue;
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  const v = redAsNamed(code, out, expect);
  if (v.mark === "RED") { red++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
  else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
}
console.log((bad ? "FAIL" : "PASS") + " — " + red + " red as named, " + bad + " not");
process.exit(bad ? 1 : 0);
