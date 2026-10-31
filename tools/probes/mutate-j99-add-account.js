// tools/probes/mutate-j99-add-account.js
// SUBJECT: J99 — a second account signed in on the same page inherited the first one's session log. The owner's decision
// (`ddjp_631`): ADD ACCOUNT RELOADS THE PAGE, as switching and logging out do. `app.js` `_changeAccount` is the one path for
// switching and adding (the room left, the account chosen, the page reloaded); `backends/backend1/matrixaccount.js`
// `switchAccount(null)` stops the client and asks the next load for the login screen, once (`_markAdding`, `_takeAdding` in
// `restoreSession`), keeping every account as it is. Held by `tests/check-log-reload.js` F and `tests/check-room-leave.js` C,
// and since `ddjp_632` by `check-log-reload` G: the two gaps the supervisor planted in `ddjp_631` with the suite green (AA11, AA12).
// One row per site, each naming the failure it must cause in its guard, and the control. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored.
//   node tools/probes/mutate-j99-add-account.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const APP = "app.js", MA = "backends/backend1/matrixaccount.js";
const LR = "check-log-reload", RL = "check-room-leave";
const ADD = '      onAdd: () => _changeAccount(null, "adding an account"),\n';
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // AA1 — Add account back to the login screen in this page (the tree before J99): the first account's lines saved as the second's.
  ["AA1", [[APP, ADD, '      onAdd: () => Interface.showScreen("screen-login"),\n']], LR, "FAIL — F: J99 — A SECOND ACCOUNT ADDED FROM MANAGE ACCOUNTS STORES NONE OF THE FIRST'S LINES", "RED"],
  // AA2 — a copy of the reload, not the path: nothing left, no client stopped, and the next load restores the first account.
  ["AA2", [[APP, ADD, "      onAdd: () => location.reload(),\n"]], LR, "FAIL — F: ADD ACCOUNT GOES THROUGH THE RELOAD", "RED"],
  ["AA2b", [[APP, ADD, "      onAdd: () => location.reload(),\n"]], LR, "FAIL — F: AND THE NEXT LOAD IS THE LOGIN SCREEN FOR THE NEW ACCOUNT", "RED"],
  // AA3 — the path leaves no room first.
  ["AA3", [[APP, "    try { Room.leave(why); } catch (e) {}\n    if (MatrixAccount.switchAccount(uid)) location.reload();",
    "    if (MatrixAccount.switchAccount(uid)) location.reload();"]], LR, "FAIL — F: ADD ACCOUNT GOES THROUGH THE RELOAD", "RED"],
  ["AA3b", [[APP, "    try { Room.leave(why); } catch (e) {}\n    if (MatrixAccount.switchAccount(uid)) location.reload();",
    "    if (MatrixAccount.switchAccount(uid)) location.reload();"]], RL, "FAIL — C: adding an account leaves the room", "RED"],
  // AA4 — the switch refuses "no account": Add account does nothing at all.
  ["AA4", [[MA, "    if (!adding && (!userId || userId === _getActive())) return false;\n", "    if (!userId || userId === _getActive()) return false;\n"]],
    LR, "FAIL — F: ADD ACCOUNT GOES THROUGH THE RELOAD", "RED"],
  // AA5 — the switch stops no client (switching's own line).
  ["AA5", [[MA, "    try { if (_c() && _c().stopClient) _c().stopClient(); } catch (e) {}\n    clearDMScope();   // the person changed", "    clearDMScope();   // the person changed"]],
    LR, "FAIL — F: ADD ACCOUNT GOES THROUGH THE RELOAD", "RED"],
  // AA6 — the next load is not asked for the login screen: the active account cleared instead, so a reload never comes back.
  ["AA6", [[MA, "    else if (!_markAdding()) _setActive(null);\n", "    else _setActive(null);\n"]], LR, "FAIL — F: A RELOAD AT THAT LOGIN SCREEN COMES BACK TO THE FIRST ACCOUNT", "RED"],
  // AA7 — the boot path ignores the ask: the next load restores the first account.
  ["AA7", [[MA, '    if (_takeAdding()) { Logger.info("MatrixBridge: adding an account — no session restored; the login screen"); return false; }\n', ""]],
    LR, "FAIL — F: AND THE NEXT LOAD IS THE LOGIN SCREEN FOR THE NEW ACCOUNT", "RED"],
  // AA8 — the ask is never taken back: every load is the login screen.
  ["AA8", [[MA, "    try { set = !!(st && st.getItem(ADDING_KEY)); if (set) st.removeItem(ADDING_KEY); } catch (e) { set = false; }",
    "    try { set = !!(st && st.getItem(ADDING_KEY)); } catch (e) { set = false; }"]], LR, "FAIL — F: J99 — A SECOND ACCOUNT ADDED FROM MANAGE ACCOUNTS STORES NONE OF THE FIRST'S LINES", "RED"],
  // AA9 — the second account's sign-in leaves the first unlisted (a registry replaced, not added to).
  ["AA9", [[MA, "    return [{ userId: acct.userId, homeserver: acct.homeserver, deviceId: acct.deviceId }].concat(rest);",
    "    return [{ userId: acct.userId, homeserver: acct.homeserver, deviceId: acct.deviceId }];"]], LR, "FAIL — F: bob signed in, Manage accounts lists both", "RED"],
  // AA10 — switching no longer points at the account chosen: the same path, and the next load is the old account's.
  ["AA10", [[MA, "    if (!adding) _setActive(userId);\n", "    if (!adding) { /* not pointed at the account chosen */ }\n"]], LR, "FAIL — F: switched, the next load is alice's lobby", "RED"],
  // AA11 — THE MARK IN THE BROWSER'S STORAGE, NOT THE TAB'S (the supervisor's first plant, `ddjp_631`): another tab of the same
  // browser opens on the login screen at its next load (a bot tab's daily reload included) and takes the mark from the tab that
  // asked. The suite stayed green with it; `check-log-reload` G names both halves.
  ["AA11", [[MA, '(typeof sessionStorage !== "undefined") ? sessionStorage : null', '(typeof localStorage !== "undefined") ? localStorage : null']],
    LR, "FAIL — G: THE MARK IS THIS TAB'S ONLY", "RED"],
  ["AA11b", [[MA, '(typeof sessionStorage !== "undefined") ? sessionStorage : null', '(typeof localStorage !== "undefined") ? localStorage : null']],
    LR, "FAIL — G: AND THE TAB THAT ASKED STILL OPENS ON THE LOGIN SCREEN", "RED"],
  // AA12 — NO FALLBACK FOR A TAB WITH NO STORAGE OF ITS OWN (the supervisor's second plant): the mark cannot be kept, the active
  // account is not cleared, and Add account reloads straight back into the first account.
  ["AA12", [[MA, "    else if (!_markAdding()) _setActive(null);\n", "    else _markAdding();\n"]], LR, "FAIL — G: A TAB WITH NO STORAGE OF ITS OWN", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run.
  ["N1", [[APP, "  function _changeAccount(uid, why) {\n", "\n  function _changeAccount(uid, why) {\n"]], LR, "", "GREEN"],
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
