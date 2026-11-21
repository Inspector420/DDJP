// tools/probes/mutate-j153-a.js
// SUBJECT: J153's package (a), first half, at `ddjp_720` — THE ROOM'S "CAN'T PLAY" REASONS AND ITS SERVICE RULE, AND EVERY
// REPORTER OF THEM: the owner's two reasons, both counting; a report with no reason refused by its own code; an unknown reason
// refused; the service rule failing closed in the reducer and through the interface; YouTube's 100/101/150 as `not-allowed`
// and 2, 5, 153 and any unknown code as nothing; SoundCloud's error as nothing, with its sound's fields logged once per song;
// `MediaBlocked` sending nothing without a reason; the `region` skip token, not a play; the two room surfaces that announce
// the break — `check-blocked-reason`, `check-declarations`, `check-song-services`, `check-blocked-wire`, `check-player-plug`,
// `check-repeat-cooldown`, `check-room-compat`; and a blocked report staying critical (vouched), `check-declarations` (f). The owner's words: "unknow services should not not be allowed as valid events
// at all, like they dont exsist"; "if we cant see and its not the players fault we dont send anything". One row per thing the
// build does, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j151-room-services.js`, unchanged: every edit is
// recorded before it is made and restored after its row, each file must hold exactly its mutated bytes when the guard starts
// AND when its result is read, and every file is checked restored by hash.
//
//   node tools/probes/mutate-j153-a.js            every row
//   node tools/probes/mutate-j153-a.js A1 A5      named rows
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
const MBL = "features/mediablocked.js";
const VO = "backends/backend1/vouch.js";
const ROOM = "features/room.js";
const YT = "ui/youtube.js";
const SC = "ui/soundcloud.js";
const BR = "check-blocked-reason", DE = "check-declarations", SS = "check-song-services", BW = "check-blocked-wire",
      PP = "check-player-plug", RC = "check-repeat-cooldown", CO = "check-room-compat";

const ROWS = [
  // ── A: the reasons — two, both counting; none refused by its own code; unknown refused ──
  ["A1", [[SD, '          if (cc.k === undefined || cc.k === null) { _rej(ev, "no-block-reason"); continue; }\n', ""]],
    BR, "B: an absent reason must be refused with ITS OWN code", "RED"],   // absent refused as "unknown"
  ["A2", [[SD, '          if (cc.k === undefined || cc.k === null) { _rej(ev, "no-block-reason"); continue; }\n          if (!isBlockedReason(cc.k)) {',
              '          const hasK = cc.k !== undefined && cc.k !== null;\n          if (hasK && !isBlockedReason(cc.k)) {'],
          [SD, "          decl.blocked[who] = { tier: dTier, k: cc.k };", "          decl.blocked[who] = { tier: dTier, k: hasK ? cc.k : null };"]],
    DE, "(f) a report with NO reason", "RED"],   // the untyped report back (719's rule): accepted and protected
  ["A3", [[SD, '    "not-allowed":    { counts: true },', '    "not-allowed":    { counts: true },\n    "network":        { counts: false },']],
    BR, "A: the vocabulary must be the owner's two reasons", "RED"],   // a non-counting reason back
  ["A4", [[SD, '    "not-allowed":    { counts: true },', '    "not-allowed":    { counts: false },']],
    BR, "A: the vocabulary must be the owner's two reasons", "RED"],   // one of the two stops counting
  ["A5", [[VO, '    "ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.media.len",', '    "ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.media.len", "ddjp.play.blocked",']],
    DE, "(f) a blocked report with the reason", "RED"],   // a blocked report made non-critical: never vouched
  // ── B: the service rule fails closed, in the reducer and through the interface ──
  ["B1", [[SD, "    if (!svc) return false;\n", "    if (!svc) return true;\n"]],
    SS, "B6 — AT THE FOLD, A JOIN NAMING A BARE ID", "RED"],   // a song naming no known service allowed (719's rule)
  ["B2", [[SM, "try { return StateDeriver.serviceAllowed(songKey, (getState() || {}).settings || {}); } catch (e) { return false; }",
              "try { return StateDeriver.serviceAllowed(songKey, (getState() || {}).settings || {}); } catch (e) { return true; }"]],
    SS, "`StreamManager.serviceAllowed` answers FALSE when the reducer throws", "RED"],   // the fail-closed catch
  // ── C: each player's failures as the app's reasons, and nothing without one ──
  ["C1", [[YT, '    150: "not-allowed",\n', '    150: "not-allowed",\n    153: "not-allowed",\n']],
    BW, "B: YouTube's error 153", "RED"],   // 153 reported
  ["C2", [[YT, '    const r = _REASON_FOR_CODE[code] || null;', '    const r = _REASON_FOR_CODE[code] || "not-allowed";']],
    BR, "A: an unrecognised player error must map to NO token", "RED"],   // an unknown code guessed as the song's fault
  ["C3", [[YT, '    100: "not-allowed",\n', ""]],
    PP, "B6 — A FAILURE IS THE APP'S REASON", "RED"],   // a removed song no longer reported
  ["C4", [[SC, '        if (typeof cb.failed === "function") cb.failed(null, "SoundCloud gave no code");', '        if (typeof cb.failed === "function") cb.failed("not-allowed", "SoundCloud gave no code");']],
    PP, "B6 — SoundCloud reports its error", "RED"],   // SoundCloud's error counted
  ["C5", [[SC, "        _errorFields();\n", ""]],
    PP, "B6 — ITS SOUND'S FIELDS ARE LOGGED ONCE PER SONG", "RED"],   // no field line
  ["C6", [[SC, "      if (song === _errLoggedFor) return;\n", ""]],
    PP, "B6 — ITS SOUND'S FIELDS ARE LOGGED ONCE PER SONG", "RED"],   // a line per error, not per song
  ["C7", [[MBL, "    if (k === null) return;                       // no reason the room counts: nothing to report\n", ""]],
    BR, "A: `reportCannotSee(pi, null)` and an unknown reason must schedule and send NOTHING", "RED"],   // a report with no reason scheduled
  ["C8", [[MBL, '        " — not reported: not a reason the room counts");\n      return;\n', '        " — not reported: not a reason the room counts");\n']],
    BR, "A: a player failure with no reason logs that it was NOT reported", "RED"],   // the line, then on into the report path
  // ── D: the region token, not a play ──
  ["D1", [[SD, "    const SKIP_REASONS = { repeat: true, region: true };", "    const SKIP_REASONS = { repeat: true };"]],
    RC, "C: a skip carrying `k: region`", "RED"],   // region unknown to the fold
  ["D2", [[ROOM, '      if (r.endedBy === "repeat" || r.endedBy === "region") continue;', '      if (r.endedBy === "repeat") continue;']],
    RC, "E: a playing ended by a REGION skip", "RED"],   // a region skip counted as a play
  // ── E: the break is announced ──
  ["E1", [[SD, '    "blocked-for-me": { counts: true },', '    "blocked-for-me": { counts: true },\n    "region-blocked": { counts: true },']],
    CO, "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // the vocabulary moves silently
  ["E2", [[SD, "    if (!svc) return false;\n", "    if (!svc) return true;\n"]],
    CO, "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // the service rule moves silently
  // ── CONTROLS: nothing that matters changes ──
  ["AG1", [[SD, '    "no-block-reason":              "it didn\'t say why the song can\'t play",', '    "no-block-reason":              "it did not say why the song can\'t play",']],
    BR, "", "GREEN"],   // the refusal's words reworded
  ["AG2", [[SC, "    let _errLoggedFor;             // the song whose error was logged (undefined: none yet)", "    let _errLoggedFor;             // the song whose error line was logged (undefined: none yet)"]],
    PP, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-a:" + id, file);   // journalled BEFORE the write
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
