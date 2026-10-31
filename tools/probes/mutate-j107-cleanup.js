// tools/probes/mutate-j107-cleanup.js
// SUBJECT: J107 (`ddjp_604`) — the cleanup after J106:
//   · a bot room forgets nothing through the shared room's door: `trimToFloor` and `forgettingLicensed` refuse an adopted
//     save point outright, where they asked the J73 seed comparison (`backends/backend1/streammanager.js`; held by
//     `tests/check-bot-move-on.js` F);
//   · three guards print PASS only past their final gate (`tests/check-setting-endpoints.js`, `check-presence-chat.js`,
//     `check-doc-xrefs.js`): a failing run shows FAIL and no PASS. Their rows here are judged "red as named AND no PASS",
//     so moving a PASS back above its gate turns its row WRONG;
//   · `tools/docs-for.js` finds a section naming a module by its global, not only its file (held by `tests/check-docs-for.js`);
//   · `check-forgetting-differential` reports only scenario runs as baselines (S12's own record is kept apart);
//   · two claims the guard text now makes, driven: `check-ui-render`'s caller scan sees a member call, and a planted
//     pointer to a roadmap entry that does not exist turns `check-doc-xrefs` red naming `tests/check-doc-links.js`;
//   · `check-dm-gaps` asserts the room `findDMRoom` returns after an accept, where it asserted nothing (`=== null || true`).
// Each row plants its edit(s), confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j107-cleanup.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const MO = "check-bot-move-on", SE = "check-setting-endpoints", PC = "check-presence-chat", DX = "check-doc-xrefs";
const DF = "check-docs-for", FD = "check-forgetting-differential", TOOL = "tools/docs-for.js", FDT = "tests/check-forgetting-differential.js";
// The roadmap `check-doc-xrefs` reads: the first doc root (`tests/_docs.js`) that has one, as its PRESENT[0] — not a
// literal `docs_NNN`. A row's file is relative to this tree, so the path is too.
const DOCROOT = require(path.join(ROOT, "tests", "_docs.js")).docRoots().filter((d) => fs.existsSync(path.join(d, "main", "09-roadmap.md")))[0];
if (!DOCROOT) { console.log("ABORT — no doc tree with main/09-roadmap.md beside this one"); process.exit(2); }
const PLAIN = 'return new RegExp("`" + esc(name) + "[`.(]|(?<![\\\\w$.])" + esc(name) + "\\\\.[A-Za-z_$]").test(line);';
const TRIM = "    if (_adopted || !_provesForForgetting(t)) return 0;";
const LIC = "    if (_adopted) return false;   // a bot room: nothing through this door";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN", options].
// `{ noPass: true }`: red as named is not enough — the guard must also print no PASS line.
const NOPASS = { noPass: true };
// A citation of a row no probe defines, built so this file's own source carries no such citation (`check-doc-xrefs` D reads it).
const BADCITE = "// see `mutate-" + "j107-cleanup` M" + "999\n";
const ROWS = [
  // ── THE SHARED ROOM'S DOOR IN A BOT ROOM ──
  // AD1 — the trim asks the J73 comparison again: told "validated", it forgets below the adopted save point.
  ["AD1", [[SM, TRIM, "    if (!(_adopted ? seedLicensesForget() : _provesForForgetting(t))) return 0;"]],
    MO, "FAIL — F: THE TRIM DOOR FORGETS NOTHING IN A BOT ROOM", "RED"],
  // AD2 — the raw cache's question asks it again.
  ["AD2", [[SM, LIC, "    if (_adopted) return seedLicensesForget();   // a bot room: nothing through this door"]],
    MO, "FAIL — F: THE RAW CACHE'S DOOR IS SHUT IN A BOT ROOM", "RED"],
  // AD3 — MEASURED, NOT PINNED: the trim's `_adopted` refusal dropped, leaving the shared licence alone. That licence also says
  // no for an adopted save point today (its boundary event went at the adoption, so `_floorProves` refuses), so
  // `check-bot-move-on` F cannot see the difference. The refusal is kept as the guarantee that does not depend on that
  // (J107). Its own label below says so: an equivalent edit, not a control.
  ["AD3", [[SM, TRIM, "    if (!_provesForForgetting(t)) return 0;"]], MO, "", "GREEN", { equivalent: true }],
  // ── PASS ONLY PAST THE GATE: a real defect each guard catches; it must fail as named and print no PASS ──
  // PG1 — a setting's lowest value refused (the J39 sweep's `>=` to `>`).
  ["PG1", [["backends/backend1/statederiver.js", "return Number.isSafeInteger(v) && v >= r.min && v <= r.max;",
    "return Number.isSafeInteger(v) && v > r.min && v <= r.max;"]], SE, "FAIL — A: `maxLen` at its lowest reachable value", "RED", NOPASS],
  // PG2 — the bot counted among the channel's members it manages: it warns itself like anyone.
  ["PG2", [["features/botruntime.js", "for (const u of members) { if (u !== me) have[u] = true; }", "for (const u of members) { have[u] = true; }"]],
    PC, "FAIL — A: and it still reports what it compared", "RED", NOPASS],
  // PG3 — a guard cites a break row no probe defines.
  ["PG3", [["tests/check-bot-move-on.js", "// ── PART F — the shared room's door forgets nothing in a bot room (J107) ",
    BADCITE + "// ── PART F — the shared room's door forgets nothing in a bot room (J107) "]],
    DX, "FAIL — a guard cites a mutation row its probe does not define", "RED", NOPASS],
  // ── DOCS-FOR READS GLOBALS ──
  // DF1 — the file's globals are not read: only its path and filename are matched, as before J107.
  ["DF1", [[TOOL, "  const globals = globalsOf(abs);", "  const globals = [];"]], DF, "FAIL — A: A SECTION NAMING THE MODULE ONLY BY ITS GLOBAL IS FOUND", "RED"],
  // DF2 — a plain-word global matched as a bare word: "Floor plans" is a hit, the tool's own control stops it.
  ["DF2", [[TOOL, PLAIN, 'return new RegExp("(?<![\\\\w$])" + esc(name) + "(?![\\\\w$])").test(line);']], DF, "FAIL — A: the tool's own control on its matcher passed", "RED"],
  // DF3 — an engine's `B1` name no longer brings the seam's name.
  ["DF3", [[TOOL, "if (bare && seamNames().indexOf(bare[1]) >= 0", "if (bare && seamNames().indexOf(bare[1]) > 99"]], DF, "FAIL — C: an engine's `B1StreamManager` brings the seam's", "RED"],
  // DF4 — a guard's names read as globals again: `check-who-is-here`'s `const Room = C0.Room;` lists sections about features/room.js.
  ["DF4", [[TOOL, "/^(tests|tools|journal)", "/^(planted-none)"]], DF, "FAIL — B: a guard's alias of a module it loads (`Room`)", "RED"],
  // DF5 — the word rule back (`[A-Z][a-z0-9]…`): `UIBase` and `IDB` stop being globals, and the sections naming them are lost.
  ["DF5", [[TOOL, "([A-Z][A-Za-z0-9_$]*)\\s*=/gm", "([A-Z][a-z0-9][A-Za-z0-9_$]*)\\s*=/gm"]], DF, "FAIL — A: A GLOBAL THAT STARTS WITH TWO CAPITALS IS A GLOBAL", "RED"],
  // ── ONLY SCENARIOS ARE BASELINES ──
  // SD1 — S12's own record back among the scenario results.
  ["SD1", [[FDT, "  const s12 = {};\n", "  const s12 = results;\n"]], FD, "FAIL — last: every result reported as a baseline is a scenario run", "RED"],
  // ── WHAT THE CORRECTED GUARD TEXT SAYS ──
  // UI1 — a dispatched renderer called from another ui/ file as a member call (`check-ui-render`: the bare-name scan sees it).
  ["UI1", [["ui/shell.js", "  function _applyLayout() {\n", "  function _applyLayout() {\n    Panels.renderHistory();\n"]],
    "check-ui-render", "renderHistory() appends into refs.queueBody without clearing it, and is called from [_applyLayout]", "RED"],
  // XR1 — a guard's comment points at a roadmap entry that does not exist: PART A names the pointer and its file.
  // RE-AIMED AT J111. It removed every doc mention of `v292` and expected PART A to name `tests/check-doc-links.js`, which
  // cites the token; PART A now reads POINTERS to entries (a bare token is a label and needs nothing), so the row plants one
  // (split in this source, so the probe file is not itself a dangling pointer).
  ["XR1", [["tests/check-doc-links.js", "That guard asks whether a POINTER from the tree", "That guard (see J" + "999's entry) asks whether a POINTER from the tree"]],
    DX, '[["J999","tests/check-doc-links.js"]]', "RED"],
  // ── A LOOKUP ASSERTED BY ITS ANSWER ──
  // DM1 — `findDMRoom` answers null for everyone: the accepted room is recorded and still invisible — v288's duplicate-room defect, seen from the lookup's side.
  ["DM1", [["backends/backend1/matrixaccount.js", "    return pickDMRoom(dmRoomsWith(userId));", "    return null;   // planted"]],
    "check-dm-gaps", "FAIL — A: AND `findDMRoom` NOW ANSWERS THAT ROOM", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[SM, TRIM, "\n" + TRIM]], MO, "", "GREEN"],
  ["N2", [["backends/backend1/statederiver.js", "return Number.isSafeInteger(v) && v >= r.min && v <= r.max;",
    "return Number.isSafeInteger(v) && v >= r.min && v <= r.max;\n"]], SE, "", "GREEN"],
  ["N3", [["features/botruntime.js", "for (const u of members) { if (u !== me) have[u] = true; }", "for (const u of members) { if (u !== me) have[u] = true; }\n"]], PC, "", "GREEN"],
  ["N4", [["tests/check-bot-move-on.js", "// ── PART F — the shared room's door forgets nothing in a bot room (J107) ",
    "//\n// ── PART F — the shared room's door forgets nothing in a bot room (J107) "]], DX, "", "GREEN"],
  ["N5", [[TOOL, "  const globals = globalsOf(abs);", "  const globals = globalsOf(abs);\n"]], DF, "", "GREEN"],
  ["N6", [["backends/backend1/matrixaccount.js", "    return pickDMRoom(dmRoomsWith(userId));", "    return pickDMRoom(dmRoomsWith(userId));\n"]], "check-dm-gaps", "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want, opts] of ROWS) {
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
    let v = redAsNamed(code, out, expect);
    if (v.mark === "RED" && opts && opts.noPass && /^\[[\w-]+\] PASS/m.test(out)) v = { mark: "WRONG", why: "it printed PASS after its failure" };
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — " + (opts && opts.equivalent ? "an equivalent edit, measured (see its comment)" : "the control")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
