// tools/probes/mutate-j117-rep-safety.js
// SUBJECT: J117 — REP table safety (the owner's `ddjp_623`; answers `ddjp_624`; `ddjp_627`; `ddjp_629`): a rebuild is the
// owner's, never automatic (`features/rep-bot.js` `_noTable`, `rebuild`, `_fromOwn`, `_fromRoom`, `_installBuilt`) — the
// backup first, a table of its own, a preview, a confirm, a fresh summary; with no summary of its own, the room's own votes
// and saves over the days chosen, partial and said so; Start fresh offered table or not; Replace refuses a file with 0 people
// and still takes another room's; the card (`card`) and the panel that draws it (`ui/settings.js` `_repRow`), no button
// missing; and (the owner's decision, `ddjp_630`) a first table only for a room that never had one, its own messages read
// back to the room's start (`_neverHad`), a read that cannot reach it building nothing and saying so; and the card redraws
// itself (`ddjp_630`): the bot side says when its card would read differently (`_announce`, `RepPorts.cardChanged`,
// `Room.botCardChanged`) and the panel redraws that card alone, while open (`ui/settings.js` `refreshRepCard`, wired in
// `ui/screens.js`, asked again when the gear panel opens, `ui/queue.js` `_renderGear`). Held by `tests/check-rep-bot.js`
// (D, K, N, O, Q, S, T), `tests/check-bot-card.js` (B, C, E, F), `tests/check-rep-ports.js` (B) and
// `tests/check-shared-room.js` (F). One row per site, each naming the failure it must cause in its guard, and the controls.
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j117-rep-safety.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RB = "features/rep-bot.js", US = "ui/settings.js";
const RP = "features/rep-ports.js", RM = "features/room.js", QU = "ui/queue.js", SC = "ui/screens.js";   // the card redraws itself (ddjp_630)
const BT = "check-rep-bot", BK = "check-bot-card", SR = "check-shared-room", PO = "check-rep-ports";
const LOST = "      if (plan) {   // the room had a table: lost (J117)\n        s.noBase = true; s.early = []; s.fill = null;\n";
const PICK = "      return (plan ? _fromOwn(s, plan, now, W) : _fromRoom(s, now, W)).then((b) => {";
const CONFIRM = "        return Promise.resolve(ui.confirm(lines, { other: false })).then((yes) => {";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── 2: NO AUTOMATIC REBUILD WHEN THE TABLE IS LOST ──
  // AU1 — the lost table rebuilt at readiness again, from its own messages, on its own.
  ["AU1", [[RB, LOST, "      if (plan) { _fromOwn(s, plan, now, W).then((b) => { if (_s === s && b.ok) s.table = b.table; _done(s); }); return; }\n      if (false) {\n        s.noBase = true; s.early = []; s.fill = null;\n"]],
    BT, "FAIL — K: A LOST TABLE IS NOT REBUILT ON ITS OWN", "RED"],
  // AU2 — its own summaries not looked at: a lost table in a young room is counted again from its start, on its own.
  ["AU2", [[RB, "      if (plan) {   // the room had a table: lost (J117)", "      if (false) {   // the room had a table: lost (J117)"]],
    BT, "FAIL — K: A LOST TABLE IS NOT REBUILT ON ITS OWN", "RED"],
  // AU3 — the same, in a shared room end to end.
  ["AU3", [[RB, "      if (plan) {   // the room had a table: lost (J117)", "      if (false) {   // the room had a table: lost (J117)"]],
    SR, "FAIL — F: A LOST TABLE IS NOT REBUILT ON ITS OWN", "RED"],
  // ── 2b: A LOST TABLE IS NEVER REBUILT ON ITS OWN, HOWEVER LONG AGO IT WAS LOST (the owner's decision, `ddjp_630`) ──
  // NH1 — the room held whole counted from its start without asking whether it ever had a table (`ddjp_629`'s way).
  ["NH1", [[RB, "        _neverHad(s, list, () => {\n          s.table = _newTable(s.spaceId);", "        ((go) => go())(() => {\n          s.table = _newTable(s.spaceId);"]],
    BT, "FAIL — D: A ROOM HELD WHOLE WHOSE ONLY SUMMARIES OF ITS OWN ARE OLDER THAN THE WINDOW BUILDS NOTHING ON ITS OWN", "RED"],
  // NH2 — the read back to the room's start hands no stop: it reads on past the first summary of its own.
  ["NH2", [[RB, "RepPorts.readOwnerChannelBack(s.channels, 0, (m) => _ownSummary(s, m))", "RepPorts.readOwnerChannelBack(s.channels, 0)"]],
    BT, "FAIL — D: it read its own messages back once more, to the room's start, with a stop of its own", "RED"],
  // NH3 — the stop takes anyone's summary for its own.
  ["NH3", [[RB, "  const _ownSummary = (s, m) => !!m && m.sender === s.me && m.type", "  const _ownSummary = (s, m) => !!m && m.type"]],
    BT, "FAIL — D: THE READ STOPS AT THE FIRST SUMMARY OF ITS OWN", "RED"],
  // NH4 — the summary of its own it found not looked at: the log no longer says what it found.
  ["NH4", [[RB, "      if (own.length) {\n", "      if (false) {\n"]], BT, "FAIL — D: AND THE LOG SAYS HOW FAR IT READ AND WHAT IT FOUND", "RED"],
  // NH5 — a read short of the room's start taken as the start: a room it cannot read back is built on its own.
  ["NH5", [[RB, "      if (read && all.complete === true) {\n", "      if (read) {\n"]], BT, "FAIL — D: A READ THAT CANNOT REACH THE ROOM'S START BUILDS NOTHING", "RED"],
  // NH6 — a read that failed taken as "nothing found".
  ["NH6", [[RB, "      if (read && all.complete === true) {\n", "      if (!read || all.complete === true) {\n"]], BT, "FAIL — D: A READ THAT FAILS BUILDS NOTHING EITHER", "RED"],
  // NH7 — "cannot tell" tried again at the next look: the read back to the start runs at every look.
  ["NH7", [[RB, "      s.noBase = true; s.unsure = true; s.early = []; s.fill = null;\n", "      s.noBase = true; s.unsure = true; s.early = []; s.fill = \"retry\";\n"]],
    BT, "FAIL — D: READ ONCE PER OPENING", "RED"],
  // NH8 — the card does not say why there is no table.
  ["NH8", [[RB, "const note = s.noBase ? (s.unsure ?", "const note = s.noBase ? (false ?"]], BT, "FAIL — D: AND SAYS SO, IN THE LOG AND ON THE CARD", "RED"],
  // NH9 — the window's read reaching the room's start not trusted: a younger room is read again.
  ["NH9", [[RB, "    const fromWindow = !!list && list.complete === true;\n", "    const fromWindow = false;\n"]],
    BT, "FAIL — D: A ROOM YOUNGER THAN THE WINDOW IS READ TO ITS START BY THE WINDOW'S READ", "RED"],
  // ── 1: THE REBUILD — BACKUP FIRST, A TABLE OF ITS OWN, PREVIEW, CONFIRM, A FRESH SUMMARY ──
  // RB1 — no backup before it reads.
  ["RB1", [[RB, "    ui.download(_fileName(s, now, \"backup\"), backup);   // ALWAYS FIRST, before anything is read\n", ""]],
    BT, "FAIL — S: THE BACKUP DOWNLOADS FIRST", "RED"],
  // RB2 — built into the live table, not one of its own.
  ["RB2", [[RB, "    const t = _newTable(s.spaceId);\n    t.cut = { pi: C.pi, pos: C.pos };", "    const t = s.table || _newTable(s.spaceId);\n    t.cut = { pi: C.pi, pos: C.pos };"]],
    BT, "FAIL — S: WHILE IT COUNTS, THE LIVE TABLE IS UNTOUCHED", "RED"],
  // RB3 — installed before the confirm.
  ["RB3", [[RB, CONFIRM, "        _installBuilt(s, b, days);\n" + CONFIRM]], BT, "FAIL — S: AND WHILE ITS PREVIEW WAITS, STILL UNTOUCHED", "RED"],
  // RB4 — no preview: confirmed without asking.
  ["RB4", [[RB, CONFIRM, CONFIRM.replace("ui.confirm(lines, { other: false })", "true")]], BT, "FAIL — S: THE PREVIEW SAYS WHAT IT FOUND", "RED"],
  // RB5 — the preview without its dates.
  ["RB5", [[RB, "\"Read back \" + days + \" day(s): \" + _day(now - W) + \" to \" + _day(now) + \".\",", "\"Read back \" + days + \" day(s).\","]],
    BT, "FAIL — S: THE PREVIEW SAYS WHAT IT FOUND", "RED"],
  // RB6 — a cancel taken as a yes.
  ["RB6", [[RB, "          if (yes !== true) { _log(\"rebuild cancelled — nothing changed\"); return { ok: false, why: \"cancelled\" }; }\n", ""]],
    BT, "FAIL — S: CANCELLED AT THE PREVIEW, NOTHING CHANGES", "RED"],
  // RB7 — no fresh summary after a confirmed rebuild.
  ["RB7", [[RB, "    s.freshNow = \"after the rebuild\";\n", ""]], BT, "FAIL — S: AND A FRESH SUMMARY GOES AT ONCE", "RED"],
  // RB8 — confirmed, what this tab holds older than the days read is counted onto it after all.
  ["RB8", [[RB, "    for (const e of (RepPorts.heldLog() || [])) if (!(e && typeof e.ts === \"number\" && e.ts < b.notBefore)) _count(s, e);",
    "    for (const e of (RepPorts.heldLog() || [])) _count(s, e);"]], BT, "FAIL — Q PREMISE — the two held votes inside the window counted", "RED"],
  // RB9 — any days at all.
  ["RB9", [[RB, "    if (!(typeof days === \"number\" && Math.floor(days) === days && days >= WINDOW.min && days <= WINDOW.max)) return Promise.resolve({ ok: false, why: \"1 to 365 days\" });",
    "    if (false) return Promise.resolve({ ok: false, why: \"1 to 365 days\" });"]], BT, "FAIL — S: DAYS OUTSIDE 1 TO 365, OR NOT WHOLE, ARE REFUSED", "RED"],
  // RB10 — run while the tab is still catching up.
  ["RB10", [[RB, "    if (!s.ready) return Promise.resolve({ ok: false, why: \"still catching up — try again in a moment\" });\n", ""]],
    BT, "FAIL — S: STILL CATCHING UP, IT IS REFUSED", "RED"],
  // RB11 — a rebuild that found nobody installs an empty table.
  ["RB11", [[RB, "        if (!people) {", "        if (false) {"]], BT, "FAIL — S: A REBUILD THAT FINDS NOBODY IS REFUSED", "RED"],
  // ── 3: A ROOM THAT NEVER HAD A BOT — ITS OWN VOTES AND SAVES OVER THE DAYS CHOSEN ──
  // RM1 — with no summary of its own, nothing to rebuild from.
  ["RM1", [[RB, PICK, PICK.replace("_fromRoom(s, now, W)", "Promise.resolve({ ok: false, why: \"no summary of its own\" })")]],
    BT, "FAIL — S: WITH NO SUMMARY OF ITS OWN, REBUILD COUNTS THE ROOM'S OWN VOTES AND SAVES", "RED"],
  // RM2 — a partial count takes the room's start as its `since`.
  ["RM2", [[RB, "      t.since = all ? null : now - W;\n", "      t.since = null;\n"]], BT, "FAIL — S: confirmed, the partial table is the owner's choice", "RED"],
  // RM3 — a partial count previewed without saying so.
  ["RM3", [[RB, ": \"PARTIAL: votes and saves older than \" + days + \" day(s) are not in it.\",", ": null,"]],
    BT, "FAIL — S: WITH NO SUMMARY OF ITS OWN, REBUILD COUNTS THE ROOM'S OWN VOTES AND SAVES", "RED"],
  // ── 4: START FRESH STAYS, TABLE OR NOT ──
  ["SF1", [[RB, "    rows.push({ kind: \"button\", key: \"startFresh\",", "    if (s.noBase) rows.push({ kind: \"button\", key: \"startFresh\","]],
    BT, "FAIL — O: THE CARD — the window, commands on or off, the cooldown, the room limit, export, Replace, Rebuild and Start fresh", "RED"],
  // ── 5: REPLACE FROM ANOTHER ROOM STAYS ALLOWED (`ddjp_627`) ──
  ["OR1", [[RB, "        file = v.value;\n", "        file = v.value;\n        if (file.room !== s.spaceId) return { ok: false, why: \"another room\" };\n"]],
    BT, "FAIL — N: A FILE OF ANOTHER ROOM, FLAGGED AND CONFIRMED, IS INSTALLED", "RED"],
  // ── 6: REPLACE REFUSES A FILE WITH 0 PEOPLE (the owner, `ddjp_629`) ──
  ["ZP1", [[RB, "        if (file.people === 0) {", "        if (false) {"]], BT, "FAIL — N: A FILE WITH 0 PEOPLE IS REFUSED", "RED"],
  ["ZP2", [[RB, "\"That file holds 0 people — nothing changed. For an empty table, use Start fresh.\"", "\"That file holds 0 people — nothing changed.\""]],
    BT, "FAIL — N: A FILE WITH 0 PEOPLE IS REFUSED", "RED"],
  // ── THE CARD WITH NO TABLE, AND THE PANEL THAT DRAWS IT (no button missing) ──
  ["CD1", [[RB, "\"No reputation table — nothing is published. Import a file with Replace…, Rebuild, or Start fresh.\"",
    "\"No table and no summary within the window — nothing is published.\""]], BT, "FAIL — N: WITH NO BASE (Q4) THE CARD SAYS THERE IS NO TABLE", "RED"],
  // CD2 — Rebuild greyed while the tab catches up: drawn once, it stays grey with no reason shown.
  ["CD2", [[RB, "action: \"Rebuild…\", enabled: s.fill === null,", "action: \"Rebuild…\", enabled: s.ready === true && s.fill === null,"]],
    BT, "FAIL — S: STILL CATCHING UP, IT IS REFUSED, AND SAYS SO", "RED"],
  ["PN1", [[US, "        const go = H.el(\"button\", { class: \"mini\", text: r.action || r.label });", "        const go = H.el(\"button\", { class: \"mini\", text: \"Look\" });"]],
    BK, "FAIL — B: the buttons, one disabled where the bot side says so, and Rebuild with its days and its action", "RED"],
  ["PN2", [[US, "        if (r.enabled === false) go.disabled = true;\n", ""]], BK, "FAIL — B: and a span's action disabled where the bot side says so", "RED"],
  ["PN3", [[US, "        go.onclick = () => flow(r.run(ui, Number(inp.value)));", "        go.onclick = () => after(r.run(ui, Number(inp.value)));"]],
    BK, "FAIL — C: REBUILD HANDS ITS DAYS", "RED"],
  ["PN4", [[US, "        go.onclick = () => flow(r.run(ui, Number(inp.value)));", "        go.onclick = () => flow(r.run(ui, inp.value));"]],
    BK, "FAIL — C: REBUILD HANDS ITS DAYS", "RED"],
  // PN5 — the panel stops drawing a span: Rebuild's button is missing from the card the owner sees.
  ["PN5", [[US, "    if (r.kind === \"number\" || r.kind === \"days\") {", "    if (r.kind === \"number\") {"]], BT, "FAIL — O: NO BUTTON MISSING", "RED"],
  // PN6, PN7 — the real card loses Rebuild, or offers Start fresh only with no table: drawn, a button is missing.
  ["PN6", [[RB, "    rows.push({ kind: \"days\", key: \"rebuild\",", "    if (false) rows.push({ kind: \"days\", key: \"rebuild\","]], BK, "FAIL — E: NO BUTTON MISSING, with a table", "RED"],
  ["PN7", [[RB, "    rows.push({ kind: \"button\", key: \"startFresh\",", "    if (s.noBase) rows.push({ kind: \"button\", key: \"startFresh\","]], BK, "FAIL — E: NO BUTTON MISSING, with a table", "RED"],
  // ── THE CARD REDRAWS ITSELF (found in building at `ddjp_629`; built `ddjp_630`) ──
  // CR1 — the bot side never says: the card reads "Starting…" until a lock click, as before.
  ["CR1", [[RB, "    RepPorts.cardChanged();\n", ""]], BK, "FAIL — F: THE CARD MOVES FROM \"Starting…\" TO ITS TABLE WITHOUT A LOCK CLICK", "RED"],
  // CR2 — it says on every look, changed or not.
  ["CR2", [[RB, "    if (sig === _cardSaid) return;\n", ""]], BK, "FAIL — F: A LOOK THAT CHANGES NOTHING SAYS NOTHING", "RED"],
  ["CR2b", [[RB, "    if (sig === _cardSaid) return;\n", ""]], BT, "FAIL — T: A LOOK THAT CHANGES NOTHING SAYS NOTHING", "RED"],
  // CR3 — a look does not end by asking.
  ["CR3", [[RB, "  function _step() { try { _stepNow(); } finally { _announce(); } }", "  function _step() { _stepNow(); }"]],
    BK, "FAIL — F: THE CARD MOVES FROM \"Starting…\" TO ITS TABLE WITHOUT A LOCK CLICK", "RED"],
  // CR4 — drawing does not note what was drawn: a change the panel already drew is said again.
  ["CR4", [[RB, "  function card() { const c = _cardOf(_s); _cardSaid = _cardSig(c); return c; }", "  function card() { const c = _cardOf(_s); return c; }"]],
    BT, "FAIL — T: DRAWN, IT IS NOT SAID AGAIN", "RED"],
  // CR5–CR8 — the changes made outside a look, not said until the next one.
  ["CR5", [[RB, "rebuild, or start fresh\");\n        _announce();\n        return;\n      }\n      if (RepPorts.holdsWholeRoom() === true) {",
    "rebuild, or start fresh\");\n        return;\n      }\n      if (RepPorts.holdsWholeRoom() === true) {"]], BT, "FAIL — T: NO TABLE IS SAID AT ONCE", "RED"],
  ["CR6", [[RB, "rebuild, or start fresh\");\n        _announce();\n      });", "rebuild, or start fresh\");\n      });"]], BT, "FAIL — T: NO TABLE IS SAID AT ONCE", "RED"],
  ["CR7", [[RB, "rebuild, or start fresh\");\n        _announce();\n        return;\n      }\n      if (read && all.complete === true) {",
    "rebuild, or start fresh\");\n        return;\n      }\n      if (read && all.complete === true) {"]], BT, "FAIL — T: NO TABLE IS SAID AT ONCE", "RED"],
  ["CR8", [[RB, "rebuild, or start fresh\");\n      _announce();\n    });", "rebuild, or start fresh\");\n    });"]], BT, "FAIL — T: NO TABLE IS SAID AT ONCE", "RED"],
  ["CR9", [[RB, "this tab only reads\");\n        _announce();\n        return null;", "this tab only reads\");\n        return null;"]], BT, "FAIL — T: ANOTHER TAB WRITING, IT SAYS SO", "RED"],
  ["CR10", [[RB, "unsent dropped\");\n    _announce();\n  }", "unsent dropped\");\n  }"]], BT, "FAIL — T: STOPPED, IT SAYS SO", "RED"],
  // CR11 — the port says nothing; CR12 — the feature layer's signal reaches nobody.
  ["CR11", [[RP, "  function cardChanged() { try { if (_has(RM(), \"botCardChanged\")) RM().botCardChanged(); } catch (e) {} }", "  function cardChanged() {}"]],
    PO, "FAIL — B: cardChanged raises the feature layer's generic \"the bot card changed\"", "RED"],
  ["CR12", [[RM, "  function botCardChanged() { for (const fn of _botCardListeners.slice()) { try { fn(); } catch (e) {} } }", "  function botCardChanged() {}"]],
    BK, "FAIL — F: \"THE BOT CARD CHANGED\" REACHES EVERY LISTENER", "RED"],
  // CR13 — the panel never subscribes (ui/screens.js).
  ["CR13", [[SC, "    if (Room.onBotCardChange) Room.onBotCardChange(Settings.refreshRepCard);\n", ""]], BK, "FAIL — F: THE PANEL LISTENS", "RED"],
  // CR14 — the whole panel redrawn instead of the REP section.
  ["CR14", [[US, "    _repDraw(c, at.msg ? at.msg.textContent : \"\");\n", "    renderChatSettings(); return;\n"]], BK, "FAIL — F: THE CARD MOVES FROM \"Starting…\" TO ITS TABLE WITHOUT A LOCK CLICK", "RED"],
  // CR15 — the panel redraws what has not changed.
  ["CR15", [[US, "    if (_repSig(c) === at.sig) { at.owed = false; return; }\n", ""]], BK, "FAIL — F: A REDRAW RAISES NOTHING", "RED"],
  // CR16 — drawn while the panel is closed.
  ["CR16", [[US, "    if (!at || !at.box || !_repOpen()) return;\n", "    if (!at || !at.box) return;\n"]], BK, "FAIL — F: NOT WHILE THE PANEL IS CLOSED", "RED"],
  // CR17 — the gear panel opens on a card that moved while it was closed.
  ["CR17", [[QU, "    if (g === \"settings\" && typeof Settings !== \"undefined\" && Settings.refreshRepCard) Settings.refreshRepCard();\n", ""]],
    BK, "FAIL — F: AND WHEN THE PANEL OPENS, THE CARD IS DRAWN AS IT STANDS", "RED"],
  // CR18 — a flow does not hold the card: its preview is thrown away by a redraw.
  ["CR18", [[US, "    if (at.flows > 0) { at.owed = true; return; }\n", ""]], BK, "FAIL — F: A FLOW HOLDS THE CARD STILL", "RED"],
  // CR19 — the change heard during a flow is never drawn.
  ["CR19", [[US, "        if (at && at === _rep && at.owed && !at.flows) refreshRepCard();\n", ""]], BK, "FAIL — F: AND THE CHANGE IS DRAWN WHEN IT SETTLES", "RED"],
  // CR20 — the redrawn card unlocked while the panel is locked.
  ["CR20", [[US, "    if (H.prefsLocked()) QueuePanels._disableAllControls(at.box);\n", ""]], BK, "FAIL — F: LOCKED, THE REDRAWN CARD STAYS LOCKED", "RED"],
  // CR21 — what the card last said lost on a redraw.
  ["CR21", [[US, "    _repDraw(c, at.msg ? at.msg.textContent : \"\");\n", "    _repDraw(c, \"\");\n"]], BK, "FAIL — F: a redraw keeps what the card last said", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[RB, "  function _installBuilt(s, b, days) {\n", "\n  function _installBuilt(s, b, days) {\n"]], BT, "", "GREEN"],
  ["N2", [[US, "    const flow = (p) => {", "    const flow = (p) =>  {"]], BK, "", "GREEN"],
  ["N3", [[RB, "  function _fromRoom(s, now, W) {\n", "\n  function _fromRoom(s, now, W) {\n"]], SR, "", "GREEN"],
  ["N4", [[RB, "  function _neverHad(s, list, build) {\n", "\n  function _neverHad(s, list, build) {\n"]], BT, "", "GREEN"],
  ["N5", [[US, "  function refreshRepCard() {\n", "\n  function refreshRepCard() {\n"]], BK, "", "GREEN"],
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
