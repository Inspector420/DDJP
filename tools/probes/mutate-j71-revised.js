// tools/probes/mutate-j71-revised.js
// SUBJECT: J71 item 1 (the owner's approval; `ddjp_632`) — THE REVISED LINE. `backends/backend1/streammanager.js` remembers the
// verdicts its ORDER line printed (`_noteSaid`), only for events still held, and after each re-derive reads each again from
// that fold (`_reviseSaid`, in `_refold`): a change is said once, naming the arrival that made it (or the re-derive, when no
// arrival did) and what is playing now; while the tab is loading the room, nothing per change and one summary when it goes
// live (`_sayRevisedWhileLoading`, on Session's change bus). A log line only. Held by `tests/check-revised-verdict.js`.
// RV18 and RV19 (`ddjp_633`) are the two gaps the supervisor planted in `ddjp_632` with the whole suite green. RV20 (`ddjp_634`):
// the seeded fold a tab follows before its trim says what it was given, so a real change above the cut is said there.
// One row per site, each naming the failure it must cause in its guard, and the control. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored.
//   node tools/probes/mutate-j71-revised.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SM = "backends/backend1/streammanager.js";
const RV = "check-revised-verdict";
const J71 = "FAIL — A: J71 — A LATE JOIN TURNS l=98 ACCEPTED INTO REFUSED";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // RV1 — the ORDER line's verdict is not remembered: nothing can be said to have changed.
  ["RV1", [[SM, "      _noteSaid(entry);   // what this line prints is remembered", "      // (not remembered)   // what this line prints is remembered"]], RV, J71, "RED"],
  // RV2 — the fold does not ask: no re-derive reads the printed verdicts again.
  ["RV2", [[SM, "    _reviseSaid(cause, _npBefore);\n    return _full;", "    return _full;"]], RV, J71, "RED"],
  // RV3 — the arrival is not handed to the fold: the line cannot name the join that changed it.
  ["RV3", [[SM, "    _refold({ arrival: entry });", "    _refold();"]], RV, J71, "RED"],
  // RV4 — what is playing now is not said.
  ["RV4", [[SM, '(moved ? " | now playing " + _playingWords(npNow) : "")', '""']], RV, J71, "RED"],
  // RV5 — a change is not marked said: the next re-derive says it again.
  ["RV5", [[SM, "        s.v = v;\n      }\n    } catch (e) { /* a line that cannot be said", "      }\n    } catch (e) { /* a line that cannot be said"]], RV, "FAIL — A: A CHANGE IS SAID ONCE", "RED"],
  // RV6 — a verdict that did not change is said anyway: every re-derive revises everything.
  ["RV6", [[SM, "        if (!v || v === s.v) continue;", "        if (!v) continue;"]], RV, "FAIL — B: CONTROL — in position order", "RED"],
  // RV7 — the line writes into the fold: it puts the printed verdict back (the twenty-third signature's hazard).
  ["RV7", [[SM, "        s.v = v;\n      }\n    } catch (e) { /* a line that cannot be said", "        if (legalIds) legalIds[id] = (s.v === \"ACCEPTED\");\n        s.v = v;\n      }\n    } catch (e) { /* a line that cannot be said"]],
    RV, "FAIL — A: A LOG LINE ONLY", "RED"],
  // RV8 — a line that cannot be said escapes into the ingest (both catches gone).
  ["RV8", [[SM, "          try {\n            Logger.info(\"StreamManager: REVISED \" + s.type", "          {\n            Logger.info(\"StreamManager: REVISED \" + s.type"],
           [SM, "          } catch (e) {}\n        }\n        s.v = v;", "          }\n        }\n        s.v = v;"],
           [SM, "    } catch (e) { /* a line that cannot be said is not a reason to lose the fold */ }", "    } finally { /* planted: nothing caught */ }"]],
    RV, "FAIL — A: A REVISED LINE THAT CANNOT BE SAID CHANGES NOTHING", "RED"],
  // RV9 — loading is not told from live: every change is said while the tab replays.
  ["RV9", [[SM, "      return p !== Session.LIVE && p !== Session.COLD;", "      return false;"]], RV, "FAIL — C: WHILE THE TAB IS LOADING THE ROOM, NO LINE PER CHANGE", "RED"],
  // RV10 — nobody listens for going live: the summary is never said.
  ["RV10", [[SM, "          _watchLive();\n", ""]], RV, "FAIL — C: AT GOING LIVE, ONE SUMMARY LINE", "RED"],
  // RV11 — the summary is not taken back once said: the next going live says it again.
  ["RV11", [[SM, "      const all = Array.from(_revisedLoading.values()).filter((x) => x.was !== x.now);\n      _revisedLoading.clear();", "      const all = Array.from(_revisedLoading.values()).filter((x) => x.was !== x.now);"]],
    RV, "FAIL — C: GOING LIVE AGAIN WITH NOTHING NEW SAYS NOTHING", "RED"],
  // RV12 — a verdict that changed and changed back is counted as a change.
  ["RV12", [[SM, "Array.from(_revisedLoading.values()).filter((x) => x.was !== x.now)", "Array.from(_revisedLoading.values())"]],
    RV, "FAIL — C: A VERDICT THAT CHANGED AND CHANGED BACK WHILE LOADING IS NOT IN THE SUMMARY", "RED"],
  // RV13 — every event's verdict is remembered, not only what the ORDER line printed.
  ["RV13", [[SM, "    // Re-derive. Prefer the trusted-checkpoint seed", "    _noteSaid(entry);\n    // Re-derive. Prefer the trusted-checkpoint seed"],
            [SM, "    _refold({ arrival: entry });", "    _refold({ arrival: entry }); _noteSaid(entry);"]],
    RV, "FAIL — D: ONLY THE VERDICTS THE ORDER LINE PRINTED ARE REMEMBERED", "RED"],
  // RV14 — an event no longer held is not forgotten.
  ["RV14", [[SM, "        if (!held.has(id)) { _said.delete(id); _revisedLoading.delete(id); continue; }", "        if (!held.has(id)) continue;"]],
    RV, "FAIL — D: A DROP FORGETS", "RED"],
  // RV15 — a room change keeps what the last room printed.
  ["RV15", [[SM, "    _said.clear(); _revisedLoading.clear();\n", "    _revisedLoading.clear();\n"]], RV, "FAIL — D: A ROOM CHANGE FORGETS EVERYTHING", "RED"],
  // RV16 — a room change keeps the summary a loading tab owed the last room.
  ["RV16", [[SM, "    _said.clear(); _revisedLoading.clear();\n", "    _said.clear();\n"]], RV, "FAIL — D: A ROOM LEFT BEFORE GOING LIVE OWES NO SUMMARY", "RED"],
  // RV17 — a re-derive that is not an arrival does not say what it was.
  ["RV17", [[SM, '    _refold({ why: "adopting the save point at l=" + fl.floorL });', "    _refold();"]], RV, "FAIL — D: A RE-DERIVE THAT IS NOT AN ARRIVAL SAYS WHAT IT WAS", "RED"],
  // RV18 — "NOT GIVEN" READ AS A REFUSAL (the supervisor's first plant): a tab following a save point before its trim holds
  // the plays at or below the cut, its fold is not given them, and every one printed ACCEPTED gets a false REVISED line.
  ["RV18", [[SM, "    if (took === null) return null;   // not given", "    if (took === null) return \"REFUSED (not given)\";   // not given"]],
    RV, "FAIL — E: A VERDICT THE FOLD WAS NOT GIVEN IS NOT A CHANGE", "RED"],
  // RV19 — THE SUMMARY NOT SORTED BY POSITION (the second plant): it names the changes in the order they were found.
  ["RV19", [[SM, "      all.sort((x, y) => (x.l - y.l) || (x.id < y.id ? -1 : 1));\n", ""]],
    RV, "FAIL — C: THE SUMMARY NAMES THE LOWEST POSITIONS, IN ORDER, AND COUNTS THE REST", "RED"],
  // RV20 — THE SEEDED FOLD SAYS NOTHING OF WHAT IT WAS GIVEN: following a save point, a real change above the cut reads "cannot say".
  ["RV20", [[SM, "        if (seededOut && typeof seededOut === \"object\") seededOut.given = _givenSeeded;\n", ""]], RV, "FAIL — E: AND ABOVE THE CUT A REAL CHANGE IS SAID", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a red above is a reading of a live run.
  ["N1", [[SM, "  function _reviseSaid(cause, npBefore) {\n", "\n  function _reviseSaid(cause, npBefore) {\n"]], RV, "", "GREEN"],
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
