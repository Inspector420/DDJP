// tools/probes/mutate-history-bot.js
// SUBJECT: package 738 — the song history channel's last part: the room's bot writes its summaries and fills their holes (`features/history-bot.js`
// through `features/history-ports.js`; its echo read back by the bridge's reader, `backends/backend1/matrixbridge.js` `_readSummaries`; a
// count below the size believed only from summaries reaching the room's start, `backends/backend1/history.js`; its single-writer lock,
// `core/store.js`; its two hook sites, `features/room.js`). Its corrections went at 740 (their rows retired below, with notes)
// (`consensus/history-rules.md` §12). Held by `check-history-bot` (its parts named per row: `HB_PARTS`) and `check-history-bot-boundary`.
// One row per way it could go wrong, each naming the failure it must cause (`check-break-verdict` asks the one rule).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-history-reader`: every edit is recorded on disk before it is made and
// cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND when its result
// is read, or the row is VOID. Restored after every row and checked restored by hash. Run only in a fresh copy (HANDOVER §4).
//
//   node tools/probes/mutate-history-bot.js            every row
//   node tools/probes/mutate-history-bot.js HB1 BD3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HB = "features/history-bot.js", HP = "features/history-ports.js", HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js";
const RM = "features/room.js", ST = "core/store.js", AC = "features/actions.js";
const BOT = "check-history-bot", BND = "check-history-bot-boundary";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", parts (check-history-bot's HB_PARTS)].
const ROWS = [
  // ── when a summary goes, and what it covers ──
  ["HB1", [[HB, "      if (!hole && run.length < N) continue;          // the newest stretch: once it holds N songs\n", ""]],
    BOT, "A: EACH GOES UP TO THE SONG THAT JUST ENDED", "RED", "A"],   // a summary at every song
    // re-anchored at `ddjp_740`: part A's line names no wait since 740 (the owner's) — the same edit, the same named failure
  // ── HB2 retired: edited 738's one-song wait (`ended.slice(0, -1)`), removed at 740 (the owner's: nothing is corrected after, so no
  //    song waits); the opposite edit, the wait put back, is `mutate-740-on-air` OA16
  ["HB3", [[HB, "    const from = (prevTo !== null) ? prevTo + 1 :", "    const from = (prevTo !== null) ? prevTo :"]],
    BOT, "A: THE STRETCHES MEET", "RED", "A"],   // two summaries overlapping by a position
  ["HB4", [[HB, "      let to = Math.min(nextFrom !== null ? nextFrom - 1 : Infinity, after ? after.l - 1 : Infinity);", "      let to = last.l;"]],
    BOT, "A: each stretch ends just below the song playing when it went", "RED", "A"],   // a stretch claims less than what comes next leaves
    // re-anchored at `ddjp_740`: no song is held back since 740 — the same edit, the same named failure
  ["HB5", [[HB, "    const countAt = (to) => (cov.windowFrom !== null ? size : Math.min(size, all.filter((r) => r.l <= to).length));",
      "    const countAt = (to) => Math.min(size, all.filter((r) => r.l <= to).length);"]],
    BOT, "F: THE COUNT CAPPED", "RED", "F"],   // past the window the count drifts below the size (the owner's "just posts that every time")
  ["HB18", [[HB, "      if (s.rearmAt === null || now - s.rearmAt >= REARM_MS) { s.rearmAt = now; HistoryPorts.rearm(); }", "      void REARM_MS;"]],
    BOT, "A PREMISE — four summaries", "RED", "A"],   // a room born on the bot's tab never holds its start: the bot never posts
  // ── who writes ──
  ["HB7", [[HB, "    if (!bot || typeof c.spaceId !== \"string\" || !c.channels || !c.channels.history_owner) {", "    if (typeof c.spaceId !== \"string\" || !c.channels || !c.channels.history_owner) {"]],
    BOT, "B: THE OWNER'S TAB", "RED", "B"],   // any tab writes
  ["HB8", [[HB, "    if (!bot || typeof c.spaceId !== \"string\" || !c.channels || !c.channels.history_owner) {", "    if (!bot || typeof c.spaceId !== \"string\" || !c.channels) {"]],
    BOT, "B: a bot tab in a room with no song history channel", "RED", "B"],   // it runs, and fails at every send, in a room with no channel
  // ── marks only from the echo; owed; pacing ──
  ["HB6", [[HB, "      if (marks.some((m) => m.n === f.n)) { s.flight = null;", "      if (true) { s.flight = null;"]],
    BOT, "C2: a read-back cannot find what sync has not delivered", "RED", "C"],   // a send believed: the next look sends it again
  ["HB26", [[HB, "raw.ddjpType === HistorySummary.TYPE) _readBack(s);", "raw.ddjpType === HistorySummary.TYPE) void 0;"]],
    BOT, "C2: THE LATE ECHO ARRIVES", "RED", "C"],   // its own echo heard and not read back: no mark until a deadline
  ["HB9", [[HB, "  const SPACING_MS = 10000;", "  const SPACING_MS = 0;"]],
    BOT, "C1: AGAIN NO SOONER THAN THE SPACING (10 s)", "RED", "C"],   // a refused send hammered
  ["HB10", [[HB, "Math.min(Math.max(0, s.fails - 1), 5)", "0"]],
    BOT, "C1: AFTER A SECOND REFUSAL THE SPACING DOUBLES", "RED", "C"],
  ["HB11", [[HB, "    if (!s || s.writer !== true || s.sending) return;", "    if (!s || s.writer !== true) return;"],
            [HB, "      else if (!f.ok) return;                 // its send has not answered", "      else if (false) return;"]],
    BOT, "C2: ONE IN FLIGHT — its send has not answered", "RED", "C"],   // two summaries out at once
  ["HB19", [[HB, "    if (HistoryPorts.busy()) return;          // song history is being read: it checks before anything is posted\n", ""]],
    BOT, "K: WHILE SONG HISTORY IS BEING READ, A SUMMARY DUE IS NOT SENT", "RED", "K"],   // a stretch sent mid-check, a correction a moment later
  ["HB12", [[HB, "    items.sort((a, b) => a.from - b.from);", "    items.sort((a, b) => b.from - a.from);"]],
    BOT, "F: and, first, the songs below its old window", "RED", "F"],   // newest first
  // ── corrections: none since 740 (the owner's: "the bot can correct holes in the timeline, but yes noting to correct after") ──
  // ── HB13 retired: edited `_contra` (this tab's own reading kept beside a bot row), removed at 740 with the corrections
  // ── HB14 retired: edited `_foldSays` (a fold's tally laid on that reading), removed at 740 with the corrections
  // ── HB15 retired: edited the bot's corrections loop (`HistoryPorts.contradictions`), removed at 740 with the port; that no stretch is
  //    sent twice is held by `mutate-740-on-air` OA17
  ["HB27", [[MB, "for (const r of v.rows) plays.add(r.pi); rows = plays.size;", "rows += v.rows.length;"]],
    BOT, "F: A DEVICE OPENING THEN TAKES EVERY SUMMARISED SONG OF ITS WINDOW FROM THE CHANNEL", "RED", "F"],   // a stretch named twice counted twice: the read stops short
    // re-anchored at `ddjp_740`: its holder was part E's device reading a correction, gone at 740; part F's device opens right after
    // the count re-send and the re-send below the old window, which name plays twice — the same edit, failing for the same reason
  // ── the history size ──
  ["HB16", [[HI, "    if (s.count < _max() && !(_sums.length && _sums[0].from <= 0)) return false;\n", ""]],
    BOT, "F: and fills to the new window", "RED", "F"],   // 737's reading: a count stopped at the old size taken for the room's start
  ["HB17", [[HB, "    if (newest && below > newest.count && countAt(newest.to) !== newest.count) {", "    if (false) {"]],
    BOT, "F: THE BOT SENDS ITS NEWEST STRETCH AGAIN WITH THE NEW COUNT", "RED", "F"],
    // re-anchored at `ddjp_740`: the condition lost `!fixed.has(…)` with the corrections — the same edit (never re-sent), the same named failure
  // ── the leave ──
  ["HB20", [[RM, "    try { if (typeof HistoryBot !== \"undefined\" && HistoryBot.leave) HistoryBot.leave(\"the tab left the room (\" + reason + \")\"); } catch (e) {}\n", ""]],
    BOT, "I: THE REAL `Room.leave` STOPS IT", "RED", "I"],   // it runs on in the lobby
  ["HB21", [[HB, "    if (s.tick) { clearInterval(s.tick); s.tick = null; }\n", ""]],
    BOT, "I: its beat and its ear are gone", "RED", "I"],   // its beat outlives the room
  ["HB22", [[HB, "      if (_s !== s) return;   // left meanwhile: nothing marked; its songs are owed at the next visit", "      if (false) return;"]],
    BOT, "I: the send in flight lands, and nothing follows it", "RED", "I"],   // an answer after the leave acted on
  // ── one writer ──
  ["HB23", [[ST, "\"ddjp:\" + ns + \":history-writer:\" + spaceId", "\"ddjp:\" + ns + \":rep-writer:\" + spaceId"]],
    BOT, "J: THE BOT'S UNDER ITS OWN", "RED", "J"],   // the bot and REP share one lock: one of them never writes
  ["HB24", [[HB, "      if (got === false) { s.writer = false;", "      if (false) { s.writer = false;"]],
    BOT, "J: A SECOND TAB OF THE BOT, REFUSED THE LOCK, SENDS NOTHING", "RED", "J"],
  ["HB25", [[ST, "{ ifAvailable: true }", "{ ifAvailable: false }"]],
    BOT, "J: REP'S LOCK IS ASKED UNDER REP'S NAME, BYTE FOR BYTE", "RED", "J"],   // the generalised step changed how REP's lock is asked
  // ── the boundary ──
  ["BD1", [[HB, "    const now = HistoryPorts.serverNow();\n", "    const now = HistoryPorts.serverNow(); void StreamManager;\n"]],
    BND, "A: `history-bot.js` names no app global but the format and its door", "RED"],
  ["BD2", [[HB, "    const now = HistoryPorts.serverNow();\n", "    const now = Date.now();\n"]],
    BND, "A: and no clock", "RED"],   // the device's clock judging the spacing and the serial
  ["BD3", [[HP, "  function playingPi() {", "  const _fmt = () => HistorySummary;\n  function playingPi() {"]],
    BND, "B: `history-ports.js` names only the modules it declares", "RED"],   // the door deciding with the format
  ["BD4", [[HB, "me: HistoryPorts.myId(),", "me: null,"]],
    BND, "B: EVERY PORT IS CALLED BY THE BOT", "RED"],   // a port nothing uses
  ["BD5", [[HP, "MB().sendSide(channels, type, body, \"history_owner\")", "MB().sendSide(channels, type, body)"]],
    BND, "B: EVERY PORT REACHES THE ONE FUNCTION IT NAMES", "RED"],   // a summary sent on the owner channel
  ["BD6", [[RM, "    _evaluateBotRuntime();\n    _historyBotEnter();\n", "    _evaluateBotRuntime();\n"]],
    BND, "C: `enter` sits in its one helper", "RED"],   // never started
  ["BD7", [[AC, "const Actions = (() => {", "const Actions = (() => { const _hb = () => HistoryBot;"]],
    BND, "C: outside its two files no code names the bot side or its door", "RED"],   // a second way in
  ["BD8", [[HP, "MB().historyIdle() !== true", "MB().historyIdleX() !== true"]],
    BND, "E: every function the door reaches on the bridge and the engine exists", "RED"],   // a port pointing at nothing, answering "idle" for ever
  ["BD9", [[HI, "const History = (() => {", "const History = (() => { const _hb = typeof HistoryBot;"]],
    BND, "D: the bot runtime, the seam and the engines name nothing of it", "RED"],   // the bot reached from inside an engine
];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark, parts] of ROWS) {
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
      const h = J.open("mutate-history-bot:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const env = Object.assign({}, process.env, parts ? { HB_PARTS: parts } : {});
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 900000, env: env });
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
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + (parts ? " [" + parts + "]" : "") + "  (" + expect + ")"); }
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
