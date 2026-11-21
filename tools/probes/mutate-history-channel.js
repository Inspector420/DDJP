// tools/probes/mutate-history-channel.js
// SUBJECT: package `ddjp_736` — the song history channel and its own route, the room's format (`ddjp_format`), `sendSide`
// naming its channel in both engines and the push-back hold on it, song history's two settings and the window following the room's
// history size, when each song ended (worked out downstream in `History`, never by the fold), and the globe in History
// (`consensus/history-rules.md` §10 and §12; `main/04-features.md` §Region Blocks). Files: `backends/backend1/matrixbridge.js`,
// `backends/backend2/skeleton.js`, `backends/backend2/transport.js`, `features/room.js`, `backends/backend1/statederiver.js`,
// `backends/backend1/dials.js`, `backends/backend1/history.js`, `ui/settings.js`, `ui/panels.js`. Held by `check-history-channel`,
// `check-history-size`, `check-history-ending`, `check-room-compat`, `check-settings-rows` and `check-geo-icon`. One row per way it
// could go wrong, each naming the failure it must cause; a row marked GREEN is a measured, dominated line, with why beside it
// (`check-break-verdict` asks the one rule for both).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-history-window`: every edit is recorded on disk before it is made
// and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND when its
// result is read, or the row is VOID. Restored after every row and checked restored by hash. Run only in a fresh copy (HANDOVER §4).
//
//   node tools/probes/mutate-history-channel.js            every row
//   node tools/probes/mutate-history-channel.js HC1 HS5    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js", SK = "backends/backend2/skeleton.js", TR = "backends/backend2/transport.js", RM = "features/room.js";
const SD = "backends/backend1/statederiver.js", DI = "backends/backend1/dials.js", HI = "backends/backend1/history.js", ST = "ui/settings.js", PN = "ui/panels.js";
const HC = "check-history-channel", HZ = "check-history-size", HE = "check-history-ending", RC = "check-room-compat", SR = "check-settings-rows", GI = "check-geo-icon";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── the channel's own route: the raw listeners only ──
  ["HC1", [[MB, "      if (!_hist) updateInbound(parsedL);", "      updateInbound(parsedL);"]],
    HC, "A: A MESSAGE ON THE HISTORY CHANNEL REACHES THE RAW LISTENERS ONLY", "RED"],   // a summary moves the room's clock
  ["HC2", [[MB, "      if (_hist) {\n        if (inScope(room.roomId)) for (const fn of _rawListeners) { try { fn(raw, event, room); } catch (e) {} }\n        return;\n      }\n", ""]],
    HC, "A: A MESSAGE ON THE HISTORY CHANNEL REACHES THE RAW LISTENERS ONLY", "RED"],   // the second door caches and folds it (735's way)
  ["HC3", [[MB, "        if (inScope(room.roomId)) for (const fn of _rawListeners) { try { fn(raw, event, room); } catch (e) {} }\n", "        for (const fn of _rawListeners) { try { fn(raw, event, room); } catch (e) {} }\n"]],
    HC, "A: OUT OF SCOPE IT REACHES NOBODY", "RED"],   // a history channel of a room this tab is not in reaches the listeners
  ["HC4", [[MB, "try { return _channels().some((c) => c && c.kind === \"history\" && c.key === k); }", "try { return _channels().some((c) => c && c.key === k); }"]],
    HC, "A: THE PREDICATE IS THE PLAN'S", "RED"],   // any channel of the plan read as the history channel
  // ── the channel in both plans, the room's format ──
  ["HC5", [[MB, "    { kind: \"history\",     slug: \"owner\",         key: \"history_owner\",           level: 99,  batch: 1 },\n", ""]],
    HC, "B (backend1): THE PLAN HAS THE SONG HISTORY CHANNEL", "RED"],   // the shared room has none
  ["HC6", [[SK, "key: \"history_owner\",        level: 99,", "key: \"history_owner\",        level: 60,"]],
    HC, "B (backend2): THE PLAN HAS THE SONG HISTORY CHANNEL", "RED"],   // the bot room's written at staff
  ["HC7", [[MB, "ddjp_mode: _mode, ddjp_format: ROOM_FORMAT },", "ddjp_mode: _mode },"]],
    HC, "B (backend1): THE ROOM CARRIES ITS FORMAT", "RED"],   // a new room carries no format: the next format would open it
  ["HC8", [[MB, "  const ROOM_FORMAT = 2;", "  const ROOM_FORMAT = 1;"]],
    RC, "ROOM_FORMAT 1 is not the newest format recorded here", "RED"],   // the surface moved, the format did not
  // ── a room made before it: HC9–HC12 retired at 737 ──
  //   ── HC9 retired: edits the opening's older-format refusal, removed at 737 (the owner's option 3: an older room is not a DDJP room)
  //   ── HC10 retired: edits `roomAttention`'s `old` answer, removed at 737 (an older room answers null; the newer one is `newer`)
  //   ── HC11 retired: edits the repair's `old-room` refusal, removed at 737 (now `not-ddjp`, before `roomAttention`)
  //   ── HC12 retired: edits "Needs attention"'s older-format row, removed at 737 (the room is counted with the other Matrix rooms)
  //   What replaces them is held by `check-history-channel` C, its break rows in `mutate-history-reader` (OR1–OR8, NW1–NW5).
  // ── `sendSide` naming its channel, and the hold ──
  ["HC13", [[MB, "    if (typeof key === \"string\" && key && key !== \"events_owner\") return _sendSideOn(channels, key, type, body);\n", ""]],
    HC, "D (backend1): WITH THE HISTORY CHANNEL'S KEY, ONE MESSAGE THERE", "RED"],   // the key ignored: sent on the owner channel (735)
  ["HC14", [[MB, "    if (!row || row.kind !== \"history\") return", "    if (!row) return"]],
    HC, "D (backend1): A KEY OF NO HISTORY ROW IS REFUSED BY NAME", "RED"],   // any channel of the plan takes a side message
  ["HC15", [[MB, "    if (typeof lv !== \"number\" || lv < row.level) return", "    if (false) return"]],
    HC, "D (backend1): AN ACCOUNT BELOW THE ROW'S LEVEL", "RED"],   // a staff account tries the owner-level channel
  ["HC16", [[TR, "    if (typeof key === \"string\" && key && key !== \"events_owner\") return B1MatrixBridge.sendSide(channels, type, body, key);\n", ""]],
    HC, "D (backend2): WITH THE HISTORY CHANNEL'S KEY, ONE MESSAGE THERE", "RED"],   // the bot room's key ignored: into the runner's gate
  ["HC17", [[MB, "    try { const sent = await sendEvent(target, type, body);", "    try { const sent = await client.sendMessage(target, { msgtype: \"m.text\", body: JSON.stringify(Object.assign({}, body, { t: type })) }).then((r) => ({ eventId: r && r.event_id }));"]],
    HC, "E (backend1): WHILE THE SERVER'S retry_after RUNS, A KEYED SIDE MESSAGE IS KEPT", "RED"],   // around the hold (the supervisor's Q3 condition)
  // ── song history's two settings and the window ──
  ["HS1", [[SD, "    historySize:          { min: 500, max: 5000,      scale: 1 },", "    historySize:          { min: 100, max: 5000,      scale: 1 },"]],
    HZ, "A: THE RANGES", "RED"],   // a window too small for the replay rule
  ["HS2", [[SD, "    if (_inRange(\"historySize\", s.historySize)) settings.historySize = s.historySize;\n", ""]],
    HZ, "A: HISTORY SIZE — 500 and 5000 accepted", "RED"],   // the owner's value never lands
  ["HS3", [[DI, "                \"historySize\", \"historySummaryEvery\"];", "                ];"]],
    HZ, "B: BOTH LIVE", "RED"],   // no dial reads them
  ["HS4", [[HI, "    return (Number.isSafeInteger(v) && v >= 1 && v <= MAX) ? v : MAX;", "    return MAX;"]],
    HZ, "C: LOWERED, THE OLDEST GO AT ONCE", "RED"],   // the window fixed at 5000 (735)
  ["HS5", [[HI, "    if (lo !== null && !_full()) {", "    if (false) {"]],
    HZ, "D: THE OWNER RAISES IT", "RED"],   // a check straddling the old window's bottom: filled 150 songs too deep, its oldest song missing
  ["HS6", [[MB, "      const r = History.resize();", "      const r = null;"]],
    HZ, "D: THE OWNER LOWERS IT", "RED"],   // a lowered window waits for the next write
  ["HS7", [[MB, "      if (k > was) rearmHistoryBackfill();\n", ""]],
    HZ, "D: THE OWNER RAISES IT", "RED"],   // read back only at the next open
  ["HS8", [[MB, "        (r && r.dropped ? \"; \" + r.dropped + \" older song(s) let go\" : \"\") + (k > was ? \"; the songs below are read back\" : \"\"));\n      _persistHistory();\n",
                "        (r && r.dropped ? \"; \" + r.dropped + \" older song(s) let go\" : \"\") + (k > was ? \"; the songs below are read back\" : \"\"));\n"]],
    HZ, "D: AND STORES THE TABLE AT ONCE", "RED"],   // a reload before the next write restores the larger table
  ["HS9", [[MB, "          size: () => { try { const st = StreamManager.getState(); return (st && st.settings) ? st.settings.historySize : null; } catch (e) { return null; } },", "          size: () => null,"]],
    HZ, "D: THE OWNER LOWERS IT", "RED"],   // the bridge never hands the room's value to song history
  ["HS10", [[ST, "    \"historySize\", \"historySummaryEvery\"];", "    \"historySummaryEvery\"];"]],
    SR, "I: THE PANEL'S ADVANCED LIST IS THE OWNER'S LIST", "RED"],   // the history size shown with the toggle off
  ["HS11", [[ST, "      if (botHere) {\n        adv(\"historySummaryEvery\"", "      if (true) {\n        adv(\"historySummaryEvery\""]],
    SR, "I: with no bot, every setting in BOT_ONLY and NEEDS_BOT is hidden", "RED"],   // songs per summary offered where no bot sends one
  // ── when each song ended, downstream ──
  ["HE1", [[HI, "      if (!_ADVANCES[t] || !acc.has(_idOf(e))) continue;", "      if (!_ADVANCES[t]) continue;"]],
    HE, "E1: EACH SONG'S END IS THE ADVANCE THE FOLD ACCEPTED THAT NAMES IT", "RED"],   // a refused advance ends a song
  ["HE2", [[HI, "    _endsOnto(_endsIn(list, both && both.accepted));", "    void 0;"]],
    HE, "E1: EACH SONG'S END IS THE ADVANCE THE FOLD ACCEPTED THAT NAMES IT", "RED"],   // a fold hands song history no end
  ["HE3", [[HI, "      const v = _seenEnds.has(e.pi) ? _seenEnds.get(e.pi) : _hadAt[e.pi];", "      const v = _hadAt[e.pi];"]],
    HE, "E2: THE STRETCH ABOVE FIRST", "RED"],   // a newest-first open loses the save point's song's end
  ["HE4", [[HI, "    for (const e of _entries) if (e && e.pi && typeof e.endedAt === \"number\") _hadAt[e.pi] = e.endedAt;\n", ""]],
    HE, "E3: AND A TABLE RESTORED FROM STORAGE KEEPS THEM THROUGH THE SAME REWRITE", "RED"],   // a rewrite drops a stored end
  ["HE5", [[HI, "    for (const [pi, row] of rows) if (Object.prototype.hasOwnProperty.call(ends, pi)) rows.set(pi, Object.assign({}, row, { endedAt: ends[pi] }));\n", ""]],
    HE, "E3: THE FLOOR-ANCHORED DERIVATION", "RED"],   // verify's truth carries no end
  ["HE6", [[HI, "ends: _endsIn(seg, acc), ended:", "ends: null, ended:"]],
    HE, "E3: THE FLOOR-ANCHORED DERIVATION", "RED"],   // a closed stretch reports no end
  // ── the globe in History ──
  ["HG1", [[PN, "        geo: true,\n        sub: _fmtAgo(h.at, now)", "        sub: _fmtAgo(h.at, now)"]],
    GI, "B: HISTORY DRAWS THE GLOBE WHEN THE ANSWER IS HELD", "RED"],   // the owner's "but not history", which his newer words reverse
  ["HG2", [[PN, "        thumbMode: \"cacheOnly\",                       // display-if-known; no ambient fetch\n        geo: true,", "        thumbMode: \"fetch\", list: \"room\",\n        geo: true,"]],
    GI, "B: SEEING A SONG IN HISTORY ASKS NO LOOKUP", "RED"],   // seeing a song in History fetches its availability
  ["HG3", [[PN, "        if (geoSpot) sub.appendChild(geoSpot);\n", ""]],
    GI, "B: HISTORY DRAWS THE GLOBE WHEN THE ANSWER IS HELD", "RED"],   // History's own line drops the globe's spot
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
      const h = J.open("mutate-history-channel:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
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
