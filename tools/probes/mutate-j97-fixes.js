// tools/probes/mutate-j97-fixes.js
// SUBJECT: J97, from the owner's live run on `?v=545`. (1) The bot's own tab, hidden: song history writes nothing while a tab is
// not settled, and the refresh a song change asked for then is now owed and paid when it settles; REP looks again at once, and
// gives up a held reaction only while caught up (`backends/backend1/matrixbridge.js`, `features/rep-ports.js`, `rep-reader.js`,
// `rep-bot.js`). (2) The stored song table is restored once a visit; a mark over two songs at one position does not count; the
// checks go with the room (`matrixbridge.js`, `history.js`). (3) The Logs tab reads the earlier session from the account's own
// store, once the account is known, and saves nothing before (`ui/panels.js`, `core/store.js`). One row per rule, each naming
// the failure it must cause, and the control. Each row plants its edit(s), confirms every one LANDED, runs the guard and reads
// the outcome by the suite's own rule (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j97-fixes.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", HI = "backends/backend1/history.js";
const RP = "features/rep-ports.js", RR = "features/rep-reader.js", RB = "features/rep-bot.js";
const PA = "ui/panels.js", ST = "core/store.js";
const SR = "check-shared-room", SPR = "check-save-point-race", LR = "check-log-reload", PO = "check-rep-ports";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── 1. THE BOT'S OWN TAB, AWAY AND BACK ──
  // AW1 — A REFRESH DEFERRED WHILE NOT SETTLED IS NOT OWED: the song waits for the next song change (live: until the reload).
  ["AW1", [[MB, "      if (r && r.deferred === \"not-settled\") _oweHistory();\n", ""]], SR,
    "FAIL — G: SHOWN AGAIN, THE SONG ENTERS THE BOT TAB'S SONG HISTORY AT ONCE", "RED"],
  // AW2 — OWED, NEVER PAID: nothing listens for the tab settling.
  ["AW2", [[MB, "    onAuthorReady(_payHistory);   // the session's own \"live again\" (`ev.to === LIVE`), once a page\n", ""]], SR,
    "FAIL — G: SHOWN AGAIN, THE SONG ENTERS THE BOT TAB'S SONG HISTORY AT ONCE", "RED"],
  // AW3 — THE DEBT KEPT PAST A ROOM CHANGE: measured green. A refresh paid in the next room folds that room's own held log, so
  // nothing wrong is written; the reset is kept because per-room state that survives a room change is its own bug class here.
  ["AW3", [[MB, "    _historyOwed = false;   // a refresh owed to the room just left is not paid on the next one's (J97)\n", ""]], SR, "", "GREEN"],
  // AW4 — THE PORT HANDS NOTHING ON: REP is never told the tab is caught up again.
  ["AW4", [[RP, "  function onCaughtUp(fn) { try { if (_has(MB(), \"onAuthorReady\")) MB().onAuthorReady(fn); } catch (e) {} }", "  function onCaughtUp(fn) {}"]], PO,
    "FAIL — B: onCaughtUp hands its listener to the transport's `onAuthorReady`", "RED"],
  // AW5 — THE READER DOES NOT LISTEN: its held votes wait for its 15-second tick.
  ["AW5", [[RR, "    if (!_caughtUpHeard) { _caughtUpHeard = true; RepPorts.onCaughtUp(_onCaughtUp); }       // the session's list keeps it too\n", ""]], SR,
    "FAIL — G: AND WITHIN ONE REP LOOK THE BOT TAB'S NUMBERS MOVE", "RED"],
  // AW6 — THE BOT SIDE DOES NOT LISTEN: the same, for the bot's own count.
  ["AW6", [[RB, "    if (!_caughtUpHeard) { _caughtUpHeard = true; RepPorts.onCaughtUp(_onCaughtUp); }   // and the session its own\n", ""]], SR,
    "FAIL — G: and the bot side counted them too", "RED"],
  // AW7 — THE READER GIVES A HELD VOTE UP WHILE NOT CAUGHT UP ("its song never reached song history").
  ["AW7", [[RR, "      if (settled && I !== null && now !== null && typeof h.ts", "      if (I !== null && now !== null && typeof h.ts"]], SR,
    "FAIL — G: AWAY LONGER THAN TWICE THE SUMMARY INTERVAL, THE VOTES STILL COUNT", "RED"],
  // AW8 — THE BOT SIDE GIVES ONE UP WHILE NOT CAUGHT UP: its table loses the vote, and so does its next summary.
  ["AW8", [[RB, "      if (settled && I !== null && typeof h.ts", "      if (I !== null && typeof h.ts"]], SR,
    "FAIL — G: AWAY LONGER THAN TWICE THE SUMMARY INTERVAL, THE VOTES STILL COUNT", "RED"],
  // ── 2. THE STORED SONG TABLE ──
  // RS1 — EVERY BACKFILL RUN RESTORES IT: the second run puts back the row the first one's check removed (live: 1 extra).
  ["RS1", [[MB, "          const first = _historyRestoredFor !== sid;\n", "          const first = true;\n"]], SPR,
    "FAIL — G: A SECOND BACKFILL IN ONE VISIT DOES NOT PUT BACK THE ROW THE FIRST ONE'S CHECK REMOVED", "RED"],
  // RS2 — THE VISIT NOT MARKED AS RESTORED: the same.
  ["RS2", [[MB, "          if (first) _historyRestoredFor = sid;\n", ""]], SPR,
    "FAIL — G: A SECOND BACKFILL IN ONE VISIT DOES NOT PUT BACK THE ROW THE FIRST ONE'S CHECK REMOVED", "RED"],
  // RS3 — THE MARK KEPT PAST A ROOM CHANGE: a later visit never reads the table.
  ["RS3", [[MB, "    _historyRestoredFor = null;   // ...and so does the restore: the next visit reads the table again (J97)\n", ""]], SPR,
    "FAIL — G: A LATER VISIT RESTORES THE TABLE AGAIN, AND CHECKS IT", "RED"],
  // RS4 — HISTORY'S CHECKS KEPT PAST A ROOM CHANGE: the first visit's marks vouch for what the next visit restores.
  ["RS4", [[HI, "\n    _verified = Object.create(null); _origin = null; _lastRestore = null; _touchedBeforeRestore = []; _restoredOnce = false; }", " }"]], SPR,
    "FAIL — G: A LATER VISIT RESTORES THE TABLE AGAIN, AND CHECKS IT", "RED"],
  // DM1 — A MARK OVER TWO SONGS AT ONE POSITION COUNTS: a table already stored that way is never checked again.
  ["DM1", [[HI, "      if (_twoAtOne(v.lo, v.hi)) { doubled++; continue; }\n", ""]], SPR,
    "FAIL — H: A TABLE STORED THAT WAY IS CHECKED AGAIN, AND THE AUDIT THEN SHOWS 0 MISSING, 0 EXTRA", "RED"],
  // DM2 — SET ASIDE, NOT SAID: the open's line is what the owner reads.
  ["DM2", [[MB, "              if (rr.doubled > 0) Logger.info(\"MatrixBridge: history — \" + rr.doubled + \" stored segment check(s) hold two songs at one \" +\n                \"position; those segments are checked against the room again, once\");   // J97: a table a second restore wrote\n", ""]], SPR,
    "FAIL — H: THE OPEN SAYS A CHECK OVER TWO SONGS AT ONE POSITION IS SET ASIDE", "RED"],
  // ── 3. THE LOGS TAB'S EARLIER SESSION ──
  // LG1 — READ WHEN THE FILE LOADS, BEFORE SIGN-IN: the shared store's old lines on every reload (live: `DDJP v512`, nine builds).
  ["LG1", [[PA, "  if (Store.account && Store.account.onUser) Store.account.onUser((u) => {", "  ((f) => f(\"before sign-in\"))((u) => {"]], LR,
    "FAIL — A: A RELOAD SHOWS THE SESSION BEFORE IT", "RED"],
  // LG2 — SAVED BEFORE THE ACCOUNT'S LOG IS READ: a page closing then leaves this session in place of the one before it.
  ["LG2", [[PA, "    if (!_logRead) { _logSaveOwed = true; return; }   // not before the account's earlier session is in hand (J97)\n", ""]], LR,
    "FAIL — C: A SAVE DUE WHILE THE ACCOUNT'S LOG WAS BEING READ LOST NOTHING", "RED"],
  // LG3 — SIGN-IN TELLS NOBODY: the earlier session is never read.
  ["LG3", [[ST, "      for (const fn of _userListeners.slice()) { try { fn(userId); } catch (e) {} }\n", ""]], LR,
    "FAIL — A: A RELOAD SHOWS THE SESSION BEFORE IT", "RED"],
  // LG4 — A LISTENER THAT COMES AFTER SIGN-IN IS NOT TOLD: measured green. The Logs tab subscribes when its file loads, before
  // any sign-in (index.html loads it before app.js starts one); the call is kept for a reader that loads later.
  ["LG4", [[ST, "      if (_user) { try { fn(_user); } catch (e) {} }\n", ""]], LR, "", "GREEN"],
  // LG5 — A SECOND SIGN-IN OF THE SAME ACCOUNT READS AGAIN: measured green. Each boot path in app.js signs in once, and switching
  // account reloads the page; the line keeps a second call from reading this session's own save back as the earlier one.
  ["LG5", [[PA, "    if (u === _logUser) return;   // one account a page: a second call for it reads nothing again\n", ""]], LR, "", "GREEN"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[MB, "  let _historyOwed = false, _historyOwedWired = false;\n", "  let _historyOwed = false, _historyOwedWired = false;\n\n"]], SR, "", "GREEN"],
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
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green" + (id === "N1" ? " — the control" : "")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — measured green went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
