// tools/probes/mutate-history-reader.js
// SUBJECT: package 737 — the song history channel's second part: the summary format (`core/historysummary.js`), devices reading the
// bot's summaries first (`backends/backend1/matrixbridge.js` `_readSummaries`, `backends/backend1/history.js` `takeSummaries` and what
// reads summary marks), a room of an older format not a DDJP room (the owner's option 3, `features/room.js` `isDDJPRoom`,
// `otherRooms`; the bridge's `roomAttention` and repair), a room of a newer format refused with words to reload, and the replay rule
// reading the start held (`Room.playedWithin`) (`consensus/history-rules.md` §12; `main/05-matrix.md` §Rooms you can trust). Held by
// `check-history-summary`, `check-history-reader` and `check-history-channel` C. One row per way it could go wrong, each naming the
// failure it must cause (`check-break-verdict` asks the one rule).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-history-channel`: every edit is recorded on disk before it is made
// and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND when its
// result is read, or the row is VOID. Restored after every row and checked restored by hash. Run only in a fresh copy (HANDOVER §4).
//
//   node tools/probes/mutate-history-reader.js            every row
//   node tools/probes/mutate-history-reader.js FS1 RD4    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const HSF = "core/historysummary.js", HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js", RM = "features/room.js";
const SU = "check-history-summary", RD = "check-history-reader", HC = "check-history-channel";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── the format piece ──
  ["FS1", [[HSF, "    if (b.v !== VERSION) return { ok: false, why: \"unknown version\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"unknown version\"", "RED"],   // a summary of another version read as this one's
  ["FS2", [[HSF, "    if (!_noReserved(b, reserved)) return { ok: false, why: \"a reserved field\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"a reserved field\"", "RED"],   // a body carrying a field the transport stamps or a relayed act carries
  ["FS3", [[HSF, "      if (r.l < b.from || r.l > b.to) return { ok: false, why: \"a row outside the stretch\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"a row outside the stretch\"", "RED"],   // a row the summary's stretch does not cover
  ["FS4", [[HSF, "      if (pis.has(r.pi)) return { ok: false, why: \"a play twice\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"a play twice\"", "RED"],
  ["FS5", [[HSF, "      if (rows.length && _cmp(rows[rows.length - 1], r) >= 0) return { ok: false, why: \"rows out of order\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"rows out of order\"", "RED"],
  ["FS6", [[HSF, "    if (rows.length > b.count) return { ok: false, why: \"more rows than songs\" };\n", ""]],
    SU, "C: REFUSED BY NAME — \"more rows than songs\"", "RED"],   // a count that cannot be true believed
  ["FS7", [[HSF, "budgetBytes: 60000,", "budgetBytes: 65000,"]],
    SU, "D: THE BUDGET IS REP'S NUMBER", "RED"],   // a second number drifted from REP's
  ["FS8", [[HSF, "    const cut = (k) => { while (k > 0 && k < rows.length && rows[k - 1].l === rows[k].l) k--; return k; };", "    const cut = (k) => k;"]],
    SU, "D: `fit` NEVER SPLITS ONE POSITION", "RED"],   // one position's plays split between two messages
  ["FS9", [[HSF, "to: k < rows.length ? rows[k].l - 1 : o.to,", "to: o.to,"]],
    SU, "D: the stretch is cut just below the first row left out", "RED"],   // a cut message claims the rows it left out
  ["FS10", [[HSF, "!(x.level >= TRUST.minLevel)", "!(x.level >= 0)"]],
    SU, "E: IGNORED — a sender below the owner level", "RED"],   // anyone in the channel believed
  ["FS11", [[HSF, " || x.id.indexOf(\"#\") >= 0) return { ok: false, why: \"not a top-level event", ") return { ok: false, why: \"not a top-level event"]],
    SU, "E: IGNORED — a sender below the owner level, another channel, a relay batch's member", "RED"],   // a batch member stands as its carrier
  ["FS12", [[HSF, "  const VERSION = 1;\n", "  const VERSION = 1;\n  const _clock = () => Date.now();\n"]],
    SU, "A: `core/historysummary.js` names no app global", "RED"],   // the piece reads a clock
  ["FS13", [[HSF, "    if (ended !== null) r.cutShortBy = ENDED[ended];\n", ""]],
    SU, "B: THE ROWS COME BACK AS HANDED", "RED"],   // how a song ended lost on reading
  // ── the reader ──
  ["RD1", [[MB, "      try { await _readSummaries(); } catch (e) {", "      try { void 0; } catch (e) {"]],
    RD, "A: THE HISTORY CHANNEL IS READ FIRST", "RED"],   // song history read the 736 way, the channel never read
  ["RD2", [[HI, "      if (_insideSums(lo, hi)) { summarised++; return \"summarised\"; }\n", ""]],
    RD, "A: VERIFY READS NONE OF THEIR STRETCHES", "RED"],   // verify re-reads what the bot's summaries hold
  ["RD3", [[MB, "      if (need !== null && rows >= need) { metCount = true; return true; }\n", ""]],
    RD, "C: ONE REQUEST, THE READ STOPPED AT THE NEWEST SUMMARY'S COUNT", "RED"],   // the read goes on past the room's start
  ["RD4", [[MB, "      if (top !== null && v.n <= top) { metHeld = true; return true; }\n", ""]],
    RD, "D: A RELOAD STOPS AT THE SUMMARY ALREADY HELD", "RED"],   // a reload reads the whole channel again
  ["RD5", [[MB, "        const t = HS.trust({ channel: \"history_owner\", id: m.id, level: m.senderLevel });", "        const t = { ok: true, why: null };"]],
    RD, "F: A SUMMARY FROM A SENDER BELOW THE OWNER LEVEL IS IGNORED", "RED"],   // a staff account's summary believed
  ["RD6", [[MB, "      if (_summaryIgnored.has(m.id)) return;\n", ""]],
    RD, "F: …AND SAID ONCE", "RED"],   // the same ignored message said at every read
  ["RD7", [[HI, "          if (_isBot(e) && (!_isBot(cur) || (e.sum || 0) > (cur.sum || 0))) out[i] = e;", "          if (false) out[i] = e;"]],
    RD, "H: NEVER AGAIN", "RED"],   // a later derivation replaces the bot's row
  ["RD8", [[HI, "      const newerHolds = (l) => marks.some((m) => m.n > s.n && l >= m.from && l <= m.to);", "      const newerHolds = (l) => false;"]],
    RD, "G: A PLAY THE CORRECTION LEAVES OUT LEAVES SONG HISTORY", "RED"],   // an older summary's row taken where a correction is the account
  ["RD9", [[HI, "    if (!bot || !mine || _differSaid.has(bot.pi)) return false;", "    if (!bot || !mine) return false;"]],
    RD, "H: NEVER AGAIN", "RED"],   // a disagreement said again at every derivation
  ["RD10", [[HI, "    if (leave.size) _entries = _entries.filter((e) => !(e && leave.has(e.pi) && !incoming.has(e.pi)));\n", ""]],
    RD, "H: A ROW OF THIS DEVICE IN A SUMMARY'S STRETCH THAT THE SUMMARY DOES NOT NAME LEAVES", "RED"],   // the device's other row stays
  ["RD11", [[HI, "    if (_sums.length && incoming && incoming.length) incoming = incoming.filter((r) => {", "    if (false && incoming && incoming.length) incoming = incoming.filter((r) => {"]],
    RD, "G: …and no later fold of this device puts it back", "RED"],   // a refresh puts back the row the bot's account left out
  ["RD12", [[HI, "    const complete = n === 1 && _ranges[0][0] <= 0;\n    const sp = _spans(), m = sp.length, top = _newestSum();", "    const complete = _fromStart();\n    const sp = _spans(), m = sp.length, top = _newestSum();"]],
    RD, "E (bot room, young): THE FOLD IS TOLD `complete` ALONE", "RED"],   // the fold told complete from summaries (the permissive direction)
  ["RD13", [[HI, "    return n >= Math.min(s.count, _max());", "    return false;"]],
    RD, "C: `full` and `fromStart`", "RED"],   // the summary's count never ends the read back: a young room is read to its start
  ["RD14", [[HI, "      if (b && _sums.some((m) => m.to >= Math.max(0, a.l + 1) && m.from <= b.l)) continue;\n", ""]],
    RD, "B: FROM THE NEAREST SAVE POINT AT OR BELOW IT", "RED"],   // the rebuild's claim from a few held events hides the hole: read deeper
  ["RD15", [[HI, "      if (_sums.length) { const u = _newestUnheld((w !== null) ? w : 0, c0.l); if (u !== null) need = Math.min(need, c0.l - u + 1); }\n", ""]],
    RD, "B: FROM THE NEAREST SAVE POINT AT OR BELOW IT", "RED"],   // verify's walk reads as deep as without summaries
  ["RD16", [[HI, "             sums: _sums.map((x) => Object.assign({}, x)) };", "             sums: [] };"]],
    RD, "I: …ONCE", "RED"],   // the serials taken not stored: every reload reads to the cap again
  ["RD17", [[MB, "      if (cov && cov.summaries && !cov.complete && cov.eventsFrom === 1 && typeof History.confirmStart === \"function\") {", "      if (false) {"]],
    RD, "E CONTROL (shared room)", "RED"],   // a shared room read to its start told short where a summary holds position 0
  ["RD18", [[RM, "    const complete = !!(cov && (cov.complete || cov.fromStart));", "    const complete = !!(cov && cov.complete);"]],
    RD, "J: A YOUNG ROOM HELD FROM ITS START BY THE BOT'S COUNT ANSWERS", "RED"],   // the replay rule cannot tell in a young room the bot holds
  ["RD19", [[HI, "      if (_insideSums((w !== null) ? w : 0, c0.l)) break;            // the bot's summaries hold it (§12): nothing to read\n", ""]],
    RD, "B: FROM THE NEAREST SAVE POINT AT OR BELOW IT", "RED"],   // verify walks below a stretch the summaries hold
  // ── a room of an older format is not a DDJP room (option 3) ──
  ["OR1", [[RM, "    return !_olderFormat(createContent);\n  }", "    return true;\n  }"]],
    HC, "C: AN OLDER ROOM IS NOT A DDJP ROOM", "RED"],   // an older room listed as a DDJP room
  ["OR2", [[RM, "      if (_ddjpFields(c) && !_olderVersion(id, c)) continue;", "      if (_ddjpFields(c)) continue;"]],
    HC, "C: COUNTED IN THE CLOSED \"OTHER MATRIX ROOMS (NOT DDJP)\" LINE", "RED"],   // in neither list (736's owed shape)
  ["OR3", [[RM, "    return !!(sc && typeof sc === \"object\" && _olderSpace(sid, sc));", "    return false;"]],
    HC, "C: COUNTED IN THE CLOSED \"OTHER MATRIX ROOMS (NOT DDJP)\" LINE", "RED"],   // its channels left out: the Space left without them
  ["OR4", [[RM, "    if (!_olderSaid.has(id)) {", "    if (true) {"]],
    HC, "C: ONE LOG LINE A ROOM", "RED"],   // a line at every drawing of the list
  ["OR5", [[RM, "    if (!Backends.resolveMode(_cc) || _olderFormat(_cc)) throw new Error(NOT_DDJP_OPENING_WORDS);", "    if (!Backends.resolveMode(_cc)) throw new Error(NOT_DDJP_OPENING_WORDS);"]],
    HC, "C: ITS OPENING ANSWERS AS FOR ANY SPACE THAT IS NOT DDJP'S", "RED"],   // an older room opened half-working
  ["OR6", [[MB, "    if (f0 !== null && f0 < ROOM_FORMAT) return no(\"not-ddjp\");", "    if (false) return no(\"not-ddjp\");"]],
    HC, "C: REPAIR MAKES NOTHING FOR IT — the bridge refuses (`not-ddjp`)", "RED"],
  ["OR7", [[MB, "    if (fmt !== null && fmt < ROOM_FORMAT) return null;\n", ""]],
    HC, "C: and the bridge reads nothing of it", "RED"],   // an older room read as missing this build's channels
  // ── a room of a newer format: reload the page ──
  ["NW1", [[RM, "      if (typeof _fmt === \"number\" && _fmt > MatrixBridge.ROOM_FORMAT) throw new Error(NEWER_OPENING_WORDS); }", "      void _fmt; }"]],
    HC, "C: ITS OPENING IS REFUSED — \"This room was made by a newer version", "RED"],   // a stale tab opens a newer room
  ["NW2", [[RM, "      if (a && a.newer) { out.push(Object.assign(base, { kind: \"refused\", words: NEWER_WORDS })); continue; }\n", ""]],
    HC, "C: A NEWER ROOM IS IN \"NEEDS ATTENTION\" AT ONCE", "RED"],   // nothing on the list says to reload
  ["NW3", [[MB, "    if (fmt !== null && fmt > ROOM_FORMAT) return { mode: mode, readable: true, unreadable: 0, started: 1, missing: [], wrong: [], newer: true, format: fmt };\n", ""]],
    HC, "C: A NEWER ROOM IS IN \"NEEDS ATTENTION\" AT ONCE", "RED"],   // the bridge reads a newer room as this build's
  ["NW4", [[MB, "    if (a.newer) return no(\"newer-room\");", "    if (false) return no(\"newer-room\");"]],
    HC, "C: REPAIR MAKES NOTHING FOR IT (`newer-room`)", "RED"],
  ["NW5", [[RM, "    if (/newer version of DDJP/.test(m)) return NEWER_WORDS;\n", ""]],
    HC, "C: and the refusal says the same words on the list", "RED"],   // the opening's refusal said in other words
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
      const h = J.open("mutate-history-reader:" + id, file);   // journalled BEFORE the write
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
