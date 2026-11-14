// tools/probes/mutate-j91-save-point.js
// SUBJECT: J91, the owner's ruling 41 (J90 item 2, options B + C). (B) Song history and the history audit follow the save
// point: a closed stretch whose fold does not reach the song its closing save point records is folded again without the
// same-position plays that save point did not count (`backends/backend1/history.js` `_settle`, through `_segmentRows`, the
// live refresh of a whole log, the backfill and the gap fill), and the bridge re-folds history when a save point is adopted
// (`backends/backend1/matrixbridge.js`). History orders events as the engine does (position, then the id by code unit), and
// `ingest` sorts what it is handed (the trim hands over arrival order). (C) The log says it in plain words: the audit names
// the case, a row that leaves says why, and the reopen line says when the tab is only still loading
// (`backends/backend1/streammanager.js`). One row per rule, each naming the failure it must cause, and the control. Each
// row plants its edit(s), confirms every one LANDED, runs the guard and reads the outcome by the suite's own rule
// (`_verdict.js`); everything is restored after every row, and checked restored.
//   node tools/probes/mutate-j91-save-point.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", SM = "backends/backend1/streammanager.js";
const SP = "check-save-point-race";
const PAGER = "out.sort((a, b) => (a.l - b.l) || (String(a.eventId) < String(b.eventId) ? -1 : (String(a.eventId) > String(b.eventId) ? 1 : 0)));   // the engine's order, ids by code unit (J91: by locale, \"$mt8E…\" came before \"$Nab…\")\n    out.reachedFrom = _reachedFrom;";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // SP1 — THE CLOSED STRETCH NOT SETTLED: verify, the cache and the audit's truth hold both plays again (the later device's J90 history).
  ["SP1", [[HI, "    const _st = _settle(seg, aSeed, bSeed);   // ruling 41: the stretch as its closing save point counted it\n    seg = _st.seg;\n", "    const _st = { seg: seg, dropped: [] };\n"]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SP2 — THE LIVE REFRESH OF A WHOLE LOG NOT SETTLED: the tab that heard both plays keeps the room-order one.
  ["SP2", [[HI, "    if (settle) o.settle = settle;\n", ""]],
    SP, "FAIL — A2: BACK LIVE, THE REFRESH FOLLOWS THE SAVE POINT", "RED"],   // RE-AIMED AT J92: at adoption the engine's hand-off settles (A); the refresh's own settle is A2's
  // SP3 — AND THE SETTLE NOT APPLIED to what ingest folds.
  ["SP3", [[HI, "      if (_st.dropped.length) { const gone = new Set(_st.dropped.map((d) => d.pi)); list = list.filter((e) => !gone.has(_idOf(e))); }\n", ""]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SP4 — RETIRED AT J92 with the code it broke: the bridge's refresh at adoption was replaced by the engine's hand-off
  // (`StreamManager._settleHistory`), whose own rows are in `mutate-j92-stored-order` (SE1–SE3).
  // SP5 — A STRETCH THE SAVE POINT AGREES WITH IS RE-DECIDED ANYWAY (the head check gone).
  ["SP5", [[HI, "    if (head === undefined || head === want) return out;\n", "    if (head === undefined) return out;\n"]],
    SP, "FAIL — B: AND NOTHING IS RE-DECIDED OR SAID", "RED"],
  // SP6 — NOT THE FEWEST PLAYS LEFT OUT: dropping both plays of the race reaches no song the save point records.
  ["SP6", [[HI, "    for (let k = 1; k <= cand.length; k++) {\n", "    for (let k = 2; k <= cand.length; k++) {\n"]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SP7 — NO PLAY MAY BE LEFT OUT (the cost bound at zero).
  ["SP7", [[HI, "  const SETTLE_MAX = 8; ", "  const SETTLE_MAX = 0; "]],
    SP, "FAIL — A: THE THREE SONG HISTORIES ARE EQUAL", "RED"],
  // SP8 — THE COST BOUND RAISED: a bound on how many folds one stretch may cost, not a rule; nothing a guard sees changes.
  ["SP8", [[HI, "  const SETTLE_MAX = 8; ", "  const SETTLE_MAX = 64; "]], SP, "", "GREEN"],
  // SP9 — THE LIVE REFRESH'S ANSWER NOT ASKED AGAIN when its stretch grew (the memo keyed without the stretch).
  ["SP9", [[HI, "closed.length, closed.length ? _idOf(closed[0]) : \"\", closed.length ? _idOf(closed[closed.length - 1]) : \"\",", ""]],
    SP, "FAIL — D: A STRETCH THAT CHANGED IS SETTLED AGAIN", "RED"],
  // SP10 — THE WHOLE LOG SETTLED, not only the stretch the save point closes.
  ["SP10", [[HI, "typeof at === \"number\" ? list.filter((e) => e && typeof e.l === \"number\" && e.l <= at) : list, seed", "list, seed"]],
    SP, "FAIL — D: A SAVE POINT BELOW THE RACE DOES NOT SETTLE IT", "RED"],
  // SP11 — INGEST FOLDS IN ARRIVAL ORDER again: the trim re-writes the race's loser.
  ["SP11", [[HI, "events.slice().sort(_roomOrder)", "events.slice()"]],
    SP, "FAIL — B: A SAVE POINT THAT AGREES", "RED"],
  // SP12 — HISTORY ORDERS IDS BY LOCALE again: verify, the cache and the audit read a case-different race the other way.
  ["SP12", [[HI, "    return x < y ? -1 : (x > y ? 1 : 0);\n  }\n  function ingest(", "    return x.localeCompare(y);\n  }\n  function ingest("]],
    SP, "FAIL — E: AND THE AUDIT'S RAW FOLD AGREES", "RED"],   // RE-AIMED AT J92: the history now comes out right even by locale (the settle corrects it), and the audit then calls it a late arrival
  // SP13 — THE PAGER BY LOCALE again: every fold re-sorts what the pager hands it, so nothing a guard sees changes; kept so the
  // pager hands out the room's order.
  ["SP13", [[MB, PAGER, PAGER.replace("(String(a.eventId) < String(b.eventId) ? -1 : (String(a.eventId) > String(b.eventId) ? 1 : 0))", "String(a.eventId).localeCompare(String(b.eventId))")]], SP, "", "GREEN"],
  // SP14 — A BACKFILL NOT SETTLED by the save point that closes its stretch.
  ["SP14", [[HI, "src: \"backfill\",\n        settle: sg.next ? { at: sg.next.l, seed: sg.next.seed } : undefined });", "src: \"backfill\" });"]],
    SP, "FAIL — D: A BACKFILL FOLLOWS THE SAVE POINT", "RED"],
  // SP15 — A GAP FILL NOT SETTLED.
  ["SP15", [[HI, "src: \"gaps\", settle: (i + 1 < cuts.length) ? { at: cuts[i + 1].l, seed: cuts[i + 1].seed } : undefined });", "src: \"gaps\" });"]],
    SP, "FAIL — D: AND SO DOES A GAP FILL", "RED"],
  // SP16 — A GAP FILL THAT DOES NOT READ PAST THE HOLE never sees the save point sitting just above it.
  ["SP16", [[HI, "pageRange(from, b + 1)", "pageRange(from, b)"]],
    SP, "FAIL — D: AND SO DOES A GAP FILL", "RED"],
  // SP17 — THE AUDIT DOES NOT NAME THE CASE.
  ["SP17", [[MB, "    for (const c of rep.settled || []) for (const d of c.dropped)", "    for (const c of []) for (const d of c.dropped)"]],
    SP, "FAIL — A: THE AUDIT NAMES THE CASE IN PLAIN WORDS", "RED"],
  // SP18 — A ROW THAT LEAVES DOES NOT SAY THE SAVE POINT DECIDED IT.
  ["SP18", [[MB, "        (typeof x.settledAt === \"number\" ? ", "        (false ? "]],
    SP, "FAIL — A2: BACK LIVE, THE REFRESH FOLLOWS THE SAVE POINT AND ITS LINE NAMES IT", "RED"],   // RE-AIMED AT J92: at adoption the engine's hand-off removes the row now (A); the refresh's line is A2's
  // SP19 — THE TAB STILL LOADING WARNS as if it disagreed.
  ["SP19", [[SM, "_loading = typeof Session !== \"undefined\" && !!Session.phase && Session.phase() !== Session.LIVE;", "_loading = false;"]],
    SP, "FAIL — C: WHILE THE TAB IS STILL LOADING, THE LINE SAYS SO", "RED"],
  // SP20 — WHAT THE SAVE POINT RECORDED NOT NAMED.
  ["SP20", [[SM, "\" (that save point recorded \" + (_rec || \"nothing\") + \" as playing). Following the save point.", "\". Following the save point."]],
    SP, "FAIL — C: LIVE, IT NAMES BOTH ANSWERS AND WHAT THE SAVE POINT RECORDED", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[HI, "    if (settle) o.settle = settle;\n", "    if (settle) o.settle = settle;\n\n"]], SP, "", "GREEN"],
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
