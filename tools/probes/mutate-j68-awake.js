// tools/probes/mutate-j68-awake.js
// SUBJECT: J68 (`ddjp_635`) — KEEP THE RUNNER AWAKE, the owner's four decisions at `ddjp_634`. 1: no tab pauses because it is
// hidden; "behind" is whether the server kept answering, plus the tab's own clock for a real sleep (`session.js` `_life`,
// `SLEEP_MS`; the bridge's sync listener: `serverAnswered` on every answer, `connectionBack` only after a failure). 2: the bot
// keeps time from arriving messages — the runner arms its next due moment from every message and server answer (`_armDue`),
// and the runtime runs a due sweep on both (`_tickIfDue`). 3: the bot's wake-up alarm (`BotRuntime.alarmNow`, the sleep it
// holds; `ui/chat.js` the sound, banner and title; `ui/settings.js` the card; `core/chatprefs.js` the mode and volume). 4: a
// sweep refusal said once per reason, and again when the sweep runs.
// Held by `check-session-awake`, `check-session-resume`, `check-bot-songs` J, `check-bot-awake` and `check-bot-alarm`.
// Not rows, because no guard can tell them gone: the runner's refusal to re-arm itself at zero (`_armDue(true)`: by
// construction the tick acts whenever the next moment is zero), and `ChatPrefs.load`'s normalising of the alarm's two values
// (the accessors normalise what they read). Both stay as defences.
// One row per site, each naming the failure it must cause in its guard, and a control per guard. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j68-awake.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SE = "backends/backend1/session.js", MB = "backends/backend1/matrixbridge.js", RU = "backends/backend2/runner.js";
const BR = "features/botruntime.js", CH = "ui/chat.js", SET = "ui/settings.js", CP = "core/chatprefs.js";
const SA = "check-session-awake", SR = "check-session-resume", BS = "check-bot-songs", BA = "check-bot-awake", AL = "check-bot-alarm";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── WK: BEHIND IS NOT HIDDEN (decision 1) ──
  // WK1 — the page's visibility suspends a tab again.
  ["WK1", [[MB, "    Session.start();\n    _sessionWired = true;",
    "    try { document.addEventListener(\"visibilitychange\", () => { if (document.hidden) Session.connectionLost(); }); } catch (e) {}\n    Session.start();\n    _sessionWired = true;"]],
    SA, "FAIL — A: HIDING A TAB DOES NOT SUSPEND IT", "RED"],
  // WK2 — the old test's figure: a sleep is 20 s without a sign of life, so a hidden tab's throttled beat reads as one.
  ["WK2", [[SE, "  const SLEEP_MS = 90000;", "  const SLEEP_MS = 20000;"]], SA, "FAIL — B: A HIDDEN TAB WHOSE BEATS COME A MINUTE APART", "RED"],
  // WK3 — below Chrome's once-a-minute wake: a hidden tab whose connection is down reads its beats as sleeps.
  ["WK3", [[SE, "  const SLEEP_MS = 90000;", "  const SLEEP_MS = 50000;"]], SA, "FAIL — E: NOR FOR A HIDDEN TAB WHOSE CONNECTION IS DOWN", "RED"],
  // WK4 — above any real sleep: ten silent minutes are not one.
  ["WK4", [[SE, "  const SLEEP_MS = 90000;", "  const SLEEP_MS = 20 * 60000;"]], SA, "FAIL — C: A REAL SLEEP STILL SUSPENDS", "RED"],
  // WK5 — a server answer is not a sign of life.
  ["WK5", [[MB, "          Session.serverAnswered();\n", ""]], SA, "FAIL — D: A SLOWED TAB SETTLES ON A SERVER ANSWER", "RED"],
  // WK6 — the settle runs only on a beat.
  ["WK6", [[SE, "    if (_phase === CATCHING_UP) {\n      const head = _safeHead();", "    if (_phase === CATCHING_UP && from === \"beat\") {\n      const head = _safeHead();"]],
    SA, "FAIL — D: A SLOWED TAB SETTLES ON A SERVER ANSWER", "RED"],
  // WK7 — `ddjp_634`'s shape: the connection "back" on every answer, resetting the clock — an answer hides a sleep.
  ["WK7", [[MB, "          if (prev === \"ERROR\" || prev === \"RECONNECTING\" || prev === \"CATCHUP\") Session.connectionBack();", "          Session.connectionBack();"],
           [SE, "  function connectionBack() {\n    _sticky = null;", "  function connectionBack() {\n    _sticky = null; _lastLifeAt = _env.now();"]],
    SA, "FAIL — E: A SLEEP WHOSE FIRST SIGN OF LIFE IS AN ANSWER IS A SLEEP TOO", "RED"],
  // WK8 — a sleep while already suspended is not told.
  ["WK8", [[SE, "    if (slept) {\n      for (const fn of _sleptListeners.slice())", "    if (slept && _phase !== SUSPENDED) {\n      for (const fn of _sleptListeners.slice())"]],
    SA, "FAIL — E: A SLEEP IS TOLD WHILE THE TAB ALREADY WAITS ON ITS CONNECTION", "RED"],
  // WK9 — an answer does not end the browser's offline wait.
  ["WK9", [[SE, "      if (_sticky && from === \"answer\") _sticky = null;\n", ""]], SA, "FAIL — F: AN ANSWER WHILE THE BROWSER SAYS OFFLINE ENDS THAT WAIT", "RED"],
  // WK10 — a sign of life that is itself a sleep releases a sleep's suspension.
  ["WK10", [[SE, "      if (_sticky || slept) return;", "      if (_sticky) return;"]], SR, "FAIL — B: a sign of life that is itself a sleep keeps it suspended", "RED"],
  // WK11 — coming back online resets the clock again, and hides a sleep.
  ["WK11", [[SE, "          _sticky = null;\n          if (_phase === SUSPENDED) _to(CATCHING_UP, \"online\");", "          _sticky = null; _lastLifeAt = _env.now();\n          if (_phase === SUSPENDED) _to(CATCHING_UP, \"online\");"]],
    SR, "FAIL — D: AND COMING BACK DOES NOT HIDE A SLEEP", "RED"],
  // ── WR: THE RUNNER KEEPS TIME FROM WHAT ARRIVES (decision 2) ──
  // WR1 — an arriving message arms nothing.
  ["WR1", [[RU, "    _armDue();   // and arms the next due moment from here (J68)\n", ""]], BS, "FAIL — J: THE SONG'S END IS ARMED FROM THE ARRIVAL", "RED"],
  // WR2 — the runner does not hear the server's answers.
  ["WR2", [[RU, "    try { if (typeof _rawBridge.onServerAnswer === \"function\") _rawBridge.onServerAnswer(_onAnswer); } catch (e) {}\n", ""]],
    BS, "FAIL — J: THE RUNNER HEARS THE SERVER'S ANSWERS", "RED"],
  // WR3 — an answer runs the tick but arms nothing.
  ["WR3", [[RU, "    if (_mayAuthor()) _openSoon();\n    _armDue();\n  }", "    if (_mayAuthor()) _openSoon();\n  }"]], BS, "FAIL — J: A SERVER ANSWER ARMS IT TOO", "RED"],
  // WR4 — the retry window is not part of the next moment: the echo arms the song's end, long past.
  ["WR4", [[RU, "      wait = Math.max(wait, (echoed ? _advSent.echoAt : _advSent.at) + w - Date.now());\n", ""]],
    BS, "FAIL — J: A REFUSED ADVANCE'S RETRY IS ARMED FROM ITS ECHO", "RED"],
  // WR5 — stopping leaves the armed timer.
  ["WR5", [[RU, "    if (_dueTimer !== null) { clearTimeout(_dueTimer); _dueTimer = null; }\n    if (_beat)", "    if (_beat)"]],
    BS, "FAIL — J: stopping lets go of the answers and of the armed timer", "RED"],
  // WR6 — stopping keeps hearing the answers.
  ["WR6", [[RU, "    try { const b = _rawBridge || MatrixBridge; if (typeof b.offServerAnswer === \"function\") b.offServerAnswer(_onAnswer); } catch (e) {}\n", ""]],
    BS, "FAIL — J: stopping lets go of the answers and of the armed timer", "RED"],
  // ── WS: THE BOT'S SWEEP RUNS WHEN DUE, AND SAYS A REFUSAL ONCE (decisions 2 and 4) ──
  // WS1 — an arriving message runs no due pass.
  ["WS1", [[BR, "    _tickIfDue();   // J68: a due pass runs on whatever arrives\n", ""]], BA, "FAIL — A: AN ARRIVING MESSAGE RUNS THE SWEEP WHEN IT IS DUE", "RED"],
  // WS2 — every arrival runs a pass, due or not.
  ["WS2", [[BR, "    if (now - _lastTickAt < SWEEP_EVERY_MS) return;\n", ""]], BA, "FAIL — A: and not again before the next pass is due", "RED"],
  // WS3 — the runtime does not hear the server's answers.
  ["WS3", [[BR, "    try { if (typeof MatrixBridge.onServerAnswer === \"function\") MatrixBridge.onServerAnswer(_onServerAnswer); } catch (e) {}\n", ""]],
    BA, "FAIL — A: THE BOT HEARS THE SERVER'S ANSWERS", "RED"],
  // WS4 — stopping keeps hearing them.
  ["WS4", [[BR, "    try { if (typeof MatrixBridge.offServerAnswer === \"function\") MatrixBridge.offServerAnswer(_onServerAnswer); } catch (e) {}\n", ""]],
    BA, "FAIL — A: stopping lets go of the answers", "RED"],
  // WS5 — `ddjp_634`'s shape: a refusal said on every pass.
  ["WS5", [[BR, "      if (r.reason !== _sweepRefusedSaid) { Logger.warn", "      if (true) { Logger.warn"]], BA, "FAIL — B: A REFUSAL IS SAID ONCE PER REASON", "RED"],
  // WS6 — the return to running is not said.
  ["WS6", [[BR, "      Logger.info(\"BotRuntime: idle sweep is running again (it was refused — \" + _sweepRefusedSaid + \")\");\n", ""]],
    BA, "FAIL — B: WHEN THE SWEEP RUNS AGAIN IT SAYS SO, ONCE", "RED"],
  // WS7 — a run does not forget the refusal it ended: "running again" every pass, and the same refusal never said again.
  ["WS7", [[BR, "\")\");\n      _sweepRefusedSaid = null;\n    }", "\")\");\n    }"]], BA, "FAIL — B: WHEN THE SWEEP RUNS AGAIN IT SAYS SO, ONCE", "RED"],
  // ── WA: THE WAKE-UP ALARM (decision 3) ──
  // WA1 — "always on" sounds before it is armed.
  ["WA1", [[BR, "    if (o.mode === \"always\") return { sound: armed,", "    if (o.mode === \"always\") return { sound: true,"]], AL, "FAIL — A: EVERY COMBINATION", "RED"],
  // WA2 — a sleep rings while the tab is in view.
  ["WA2", [[BR, "    const woke = o.slept === true && o.inView !== true;", "    const woke = o.slept === true;"]], AL, "FAIL — A: EVERY COMBINATION", "RED"],
  // WA3 — the decision does not ask whether this tab is the bot.
  ["WA3", [[BR, "    if (o.bot !== true || o.mode === \"off\") return none;", "    if (o.mode === \"off\") return none;"]], AL, "FAIL — A: EVERY COMBINATION", "RED"],
  // WA4 — a sleep heard while not the bot is held, and rings at the next start.
  ["WA4", [[BR, "  function _onSlept(x) {\n    if (!actingAsBot()) return;\n", "  function _onSlept(x) {\n"]], AL, "FAIL — B: and the next start holds no sleep", "RED"],
  // WA5 — stopping keeps the sleep.
  ["WA5", [[BR, "    _alarmSlept = false; _alarmSay();   // the page's alarm", "    _alarmSay();   // the page's alarm"]], AL, "FAIL — B: and the next start holds no sleep", "RED"],
  // WA6 — the source does not loop.
  ["WA6", [[CH, "    src.loop = true;\n", "    src.loop = false;\n"]], AL, "FAIL — C: A SLEEP DETECTED WHILE HIDDEN RINGS", "RED"],
  // WA7 — being seen does not wake it: hidden again, the old sleep rings again.
  ["WA7", [[CH, "    if (slept && inView) { try { BotRuntime.alarmWoken(); } catch (e) {} slept = false; }\n", ""]], AL, "FAIL — C: hidden again with no new sleep, it stays quiet", "RED"],
  // WA8 — the banner never goes.
  ["WA8", [[CH, "    _alarmBanner(!!d.banner);", "    _alarmBanner(true);"]], AL, "FAIL — E: the click creates the audio context and resumes it, and the banner goes", "RED"],
  // WA9 — no title when sound cannot play.
  ["WA9", [[CH, "    if (d.flash || (d.sound && !sounding)) _alarmFlashOn(); else _alarmFlashOff();", "    _alarmFlashOff();"]], AL, "FAIL — F: WITH NO SOUND TO PLAY, THE TAB TITLE FLASHES INSTEAD", "RED"],
  // WA10 — the page does not ask whether this tab is the bot.
  ["WA10", [[CH, "    try { bot = typeof BotRuntime !== \"undefined\" && !!BotRuntime.actingAsBot && BotRuntime.actingAsBot() === true; } catch (e) { bot = false; }\n    const inView",
    "    bot = true;\n    const inView"]], AL, "FAIL — G: A TAB THAT IS NOT THE BOT SHOWS AND PLAYS NOTHING", "RED"],
  // WA11 — the arming click creates and resumes nothing.
  ["WA11", [[CH, "      _alarmHook(_audio());\n      alarmUpdate();", "      _alarmHook(_audioCtx);\n      alarmUpdate();"]], AL, "FAIL — E: the click creates the audio context and resumes it", "RED"],
  // WA12 — "off" shows the default's note, not its warning.
  ["WA12", [[SET, "text: _ALARM_NOTES[mode] || _ALARM_NOTES.asleep", "text: _ALARM_NOTES.asleep"]], AL, "FAIL — H: CHOSEN, \"OFF\" SAYS WHY THE ALARM EXISTS", "RED"],
  // WA13 — releasing the slider plays no sample.
  ["WA13", [[SET, "      try { ChatPanels.previewAlarm(); } catch (e) {}\n", ""]], AL, "FAIL — H: RELEASED, IT SAVES THE VOLUME AND PLAYS A SAMPLE", "RED"],
  // WA14 — the volume can be turned down to nothing.
  ["WA14", [[CP, "  const ALARM_RANGE = { min: 10,", "  const ALARM_RANGE = { min: 0,"]], AL, "FAIL — I: THE VOLUME CLAMPS TO 10–100", "RED"],
  // WA15 — any mode is taken.
  ["WA15", [[CP, "  function setBotAlarm(m) { if (ALARM_MODES.indexOf(m) < 0) return; _st()", "  function setBotAlarm(m) { _st()"]], AL, "FAIL — I: a mode that is not one of the three is refused", "RED"],
  // WA16 — the volume is not saved when it moves.
  ["WA16", [[CP, ", ct: st.chatTier, av: st.botAlarmVolume });", ", ct: st.chatTier });"]], AL, "FAIL — I: both survive a reload", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[SE, "  function _life(from) {", "  function _life(from)  {"]], SA, "", "GREEN"],
  ["N2", [[SE, "  function connectionBack() {", "  function connectionBack()  {"]], SR, "", "GREEN"],
  ["N3", [[RU, "  function _nextDueIn() {", "  function _nextDueIn()  {"]], BS, "", "GREEN"],
  ["N4", [[BR, "  function _tickIfDue() {", "  function _tickIfDue()  {"]], BA, "", "GREEN"],
  ["N5", [[CH, "  function _alarmSoundOff() {", "  function _alarmSoundOff()  {"]], AL, "", "GREEN"],
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
