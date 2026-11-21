// tools/probes/mutate-j153-g.js
// SUBJECT: J153's (d), its first half, at `ddjp_726` — THE BOT AND BLOCKED SONGS: the reducer's one road rule (`roadTableMet`,
// read by `skipVerdict` and through the ports by the bot) and the bot's three room settings (defaults, fold, read live); the
// lookup path's `fetchMany` (a source's `many`, one call per group naming every id, counted, trimmed by the daily limit, the
// unanswered falling through, a fresh answer kept, nothing with the switch off) and the song table's `many`; REP's new ports and
// `Rep.roomNote` (H6); `RepRules.geoCount`; `features/rep-geo.js` (the bot's tab only, people present with a country, ranked
// only for the skip, once per song per DJ, the words, the skip at a song's start only with its token and line, nothing without
// data and never silent, the lookups and their retry, only a caught-up tab); the rows under "The bot" and the muted line at the
// top of Room settings. One row per thing the build does, each naming the failure it must cause; the controls change nothing
// that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-c.js`, unchanged.
//
//   node tools/probes/mutate-j153-g.js            every row
//   node tools/probes/mutate-j153-g.js G1 G5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js";
const SM = "backends/backend1/streammanager.js";
const DI = "backends/backend1/dials.js";
const MD = "features/metadata.js";
const SO = "core/songs.js";
const RP = "features/rep-ports.js";
const RR = "features/rep-rules.js";
const RG = "features/rep-geo.js";
const ST = "ui/settings.js";
const GEO = "check-rep-geo";
const GS = "check-geo-sources";
const RPG = "check-rep-ports";
const ROWS_ = "check-settings-rows";

const ROWS = [
  // ── the reducer: the one road rule, and the bot's three settings ──
  ["G1", [[SD, "    for (const r of roads) if (guests >= (r.guestPlus || 0) && vips >= (r.vipPlus || 0)) return true;",
               "    for (const r of roads) if (guests > (r.guestPlus || 0) && vips >= (r.vipPlus || 0)) return true;"]],
    RPG, "H: the real engine's `roadTableMet` answers the reducer's road rule", "RED"],   // a road met only above its count
  ["G2", [[SD, "      botBlockedWarn: true,\n", "      botBlockedWarn: false,\n"]],
    GEO, "S: the owner's defaults", "RED"],   // warnings off in a new room
  ["G3", [[SD, "    if (typeof s.botBlockedWarn === \"boolean\") settings.botBlockedWarn = s.botBlockedWarn;\n", ""]],
    "check-setting-endpoints", "D: `botBlockedWarn` FOLDS", "RED"],   // a switch the owner moves and nothing reads
  ["G4", [[SD, "    if (botRoads) settings.botBlockedRoads = botRoads;\n", ""]],
    GEO, "S: the bot's minimums fold through the one road-list check", "RED"],   // the bot's table never changes
  ["G5", [[SD, "    botBlockedRoads:      Object.assign({}, ROAD_LIST),\n", ""]],
    GEO, "S: the bot's minimums fold through the one road-list check", "RED"],   // no bounds: every table refused
  ["G6", [[DI, "                \"botBlockedWarn\", \"botBlockedSkip\", \"botBlockedRoads\",\n", "                \"botBlockedWarn\", \"botBlockedRoads\",\n"]],
    GEO, "S: every one is read LIVE", "RED"],   // the skip switch in neither list
    // re-anchored at `ddjp_736`: the list goes on with song history's two (§12) on the next line — the same mutation, the same named failure
  ["G7", [[SM, "    serviceAllowed, roadTableMet,\n", "    serviceAllowed,\n"]],
    RPG, "H: EVERY FUNCTION A PORT REACHES EXISTS ON THE REAL MODULE", "RED"],   // the port answers "not met" for ever
  // ── the lookup path: many songs at once ──
  ["G8", [[MD, "        const size = (typeof p.many === \"number\" && p.many > 1 && typeof p.fetchMany === \"function\") ? p.many : 1;",
               "        const size = 1;"]],
    GS, "F: with a key, three songs are ONE call to YouTube", "RED"],   // one call per song
  ["G9", [[MD, "        for (let j = 0; j < ready.length && j < room; j += size) groups.push(ready.slice(j, Math.min(j + size, room)));",
               "        for (let j = 0; j < ready.length; j += size) groups.push(ready.slice(j, j + size));"]],
    GS, "F: with five songs left of ProxyNova's day", "RED"],   // past the daily stop
  ["G10", [[MD, "          _count(p, list, g.length, nowMs);", "          _count(p, list, 1, nowMs);"]],
    GS, "F: counted as ONE call naming three songs", "RED"],   // a group counted as one song
  ["G11", [[MD, "        if (on && !isFresh(\"geo\", entry, nowMs, ttl) && !_inflight[k + \"|geo\"]) want.push(k);",
                "        if (on && !_inflight[k + \"|geo\"]) want.push(k);"]],
    GS, "F: a saved answer still fresh is handed back and not asked again", "RED"],   // every song asked every time
  ["G12", [[MD, "    const on = !!(list && typeof nowMs === \"number\" && _geoOn());\n    const ttl = _geoTtlMs();\n    const out = { answers: {}, on: on, asked: 0, reached: 0 };",
                "    const on = !!(typeof nowMs === \"number\" && _geoOn());\n    const ttl = _geoTtlMs();\n    const out = { answers: {}, on: on, asked: 0, reached: 0 };"]],
    GS, "F: with the switch on, a list that does not look songs up asks nothing", "RED"],   // any list may ask
  ["G13", [[MD, "            out.reached++;\n", ""]],
    GS, "F CONTROL — a source that answers with nothing for these songs WAS reached", "RED"],   // an answering source reads as down
  ["G14", [[MD, "keep(k, clean, p); answered++; left = left.filter((x) => x !== k); }", "keep(k, clean, p); answered++; }"]],
    GS, "F: the one song ProxyNova did not answer is asked of Invidious alone", "RED"],   // answered songs asked again
  ["G15", [[MD, "          songKeys.forEach((k, n) => { out[k] = src.read(j, ids[n]) || {}; });", "          songKeys.forEach((k, n) => { out[k] = src.read(j, ids[0]) || {}; });"]],
    GS, "F: the one song ProxyNova did not answer is asked of Invidious alone", "RED"],   // every song read as the first
  ["G16", [[SO, "          many: (typeof x.many === \"number\") ? x.many : null, url: x.url, read: x.read });", "          many: null, url: x.url, read: x.read });"]],
    GS, "F: with a key, three songs are ONE call to YouTube", "RED"],   // the table's `many` never reaches the path
  ["G17", [[SO, "  function _idParam(id) { return [].concat(id).map((x) => encodeURIComponent(x)).join(\",\"); }",
                "  function _idParam(id) { return encodeURIComponent([].concat(id).join(\",\")); }"]],
    GS, "F: one id's address is unchanged, and a list's names each id, joined by plain commas", "RED"],   // commas encoded
  // ── REP's ports and the app's entry ──
  ["G18", [[RP, "        startedAt: (typeof np.startedAt === \"number\" && isFinite(np.startedAt)) ? np.startedAt : null };",
                "        startedAt: null };"]],
    RPG, "B: nowPlaying reads the reducer's current playing", "RED"],   // no start: the skip can never be decided
  ["G19", [[RP, "      return rot.filter((m) => m && typeof m.user === \"string\").map((m) => ({ dj: m.user,", "      return rot.filter((m) => !!m).map((m) => ({ dj: m.user,"]],
    RPG, "B: queuedSongs reads the rotation's declared songs", "RED"],   // an entry with no DJ is warned about
  ["G20", [[RP, "    return MS().fetchMany(songKeys, now, ask);", "    return MS().fetchMany(songKeys, now);"]],
    RPG, "B: geoMany hands the songs, the time and the list that asked", "RED"],   // no list: nothing is ever asked
  ["G21", [[RP, "SM().roadTableMet(roads, guests, vips) === true : false;", "!!SM().roadTableMet(roads, guests, vips) : false;"]],
    RPG, "B: and only a strict true is met", "RED"],   // a truthy answer reads as met
  ["G22", [[RP, "    return Promise.resolve().then(() => SK().skip(token));", "    return Promise.resolve().then(() => SK().skip());"]],
    RPG, "B: skip sends the skip the repeat sweep sends, with its token", "RED"],   // untagged: counted as a play
  ["G23", [[RP, "    const g = _p(() => RepGeo);", "    const g = _p(() => RepBot);"]],
    RPG, "G: `enter` and `leave` reach the blocked songs' piece, and `Rep.roomNote` (H6) hands back its line alone", "RED"],
  ["G24", [[RP, "  const PIECES = () => [_p(() => RepReader), _p(() => RepBot), _p(() => RepGeo)];", "  const PIECES = () => [_p(() => RepReader), _p(() => RepBot)];"]],
    GEO, "A: on the bot's tab `Rep.enter` starts it", "RED"],   // never started
  // ── the rules' count ──
  ["G25", [[RR, "      if (b === \"guest\" || b === \"vip\") { ranked.push(", "      if (b === \"guest\") { ranked.push("]],
    GEO, "B: `RepRules.geoCount` counts distinct people", "RED"],   // a VIP is nobody
  ["G26", [[RR, "typeof p.code !== \"string\" || seen[p.user]) continue;", "typeof p.code !== \"string\") continue;"]],
    GEO, "B: `RepRules.geoCount` counts distinct people", "RED"],   // a person counted twice
  // ── the piece ──
  ["G27", [[RG, "    const here = _present(s, now, cc);", "    const here = { cc: cc, bands: _present(s, now, cc).bands };"]],
    GEO, "B: the warning counts the two present people in France", "RED"],   // people away counted
  ["G28", [[RG, "        const people = w.unranked ? c.all : c.ranked;", "        const people = c.all;"]],
    GEO, "B: with \"Include unranked people's countries\" off", "RED"],   // the room's switch ignored
  ["G29", [[RG, "    if (!(c.ranked.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.guests, c.vips))) return Promise.resolve();",
                "    if (!(c.all.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.all.length, c.vips))) return Promise.resolve();"]],
    GEO, "E: blocked only for an unranked person: no skip", "RED"],   // unranked accounts skip songs
  // G30, G32, G40, G42, G50, G52, G53 RE-ANCHORED, and G6, G54 given their guards' new words, at J153 (d)'s second half (`ddjp_727`,
  // the supervisor's approval): strikes rewrote the warning loop (G30, G32) and the nothing-asked line (G42), `s.down` became
  // `s.noAnswer` (G40), the minimums show under the skip or the strike (G50), the delegation line holds five keys (G53), the
  // messages name no count (G6, G54); G52's anchor carried `?v=641`, so it went VOID at every bump — version-free now. Each
  // mutation keeps its meaning.
  ["G30", [[RG, "        if (said && !strikes) return;                       // warned already, and nothing new to say\n", ""]],
    GEO, "C: two looks, one warning", "RED"],   // a warning every look
  ["G31", [[RG, "    for (const id of Object.keys(s.warned)) if (!live[id]) delete s.warned[id];\n", ""]],
    GEO, "C: the song leaving the queue and coming back is warned about again", "RED"],
  ["G32", [[RG, "          if (!ok) { delete s.warned[id]; return; }", "          if (!ok) { return; }"]],
    GEO, "C: a warning that did not arrive is tried again", "RED"],
  ["G33", [[RG, "    const late = !(typeof np.startedAt === \"number\") || now - np.startedAt > DECIDE_MS;", "    const late = false;"]],
    GEO, "E: a song first seen after the window plays", "RED"],   // a song skipped mid-play
  ["G34", [[RG, "    if (s.decided === np.pi) return Promise.resolve();\n", ""]],
    GEO, "E: inside the window with its answer, the song is skipped once", "RED"],
  ["G35", [[RG, "    return RepPorts.skip(\"region\").then((r) => {", "    return RepPorts.skip(\"repeat\").then((r) => {"]],
    GEO, "E: inside the window with its answer, the song is skipped once, tagged `region`", "RED"],
  ["G36", [[RG, "      if (!r || !r.ok) {\n        // A LOST RACE", "      if (!r) {\n        // A LOST RACE"]],
    GEO, "E: a skip that does not take posts no line", "RED"],
  ["G37", [[RG, "    if (!RepPorts.mayAuthor()) return Promise.resolve(\"not-live\");\n", ""]],
    GEO, "H: not caught up: nothing asked, warned or skipped", "RED"],
  ["G38", [[RG, "    if (st.on !== true) { _say(s, \"off\"); return Promise.resolve(\"off\"); }", "    if (st.on !== true) { _say(s, \"off\"); }"]],
    GEO, "F: lookups off on this device: nothing asked, no warning, no skip", "RED"],
  ["G39", [[RG, "    if (note === s.note) return;\n", ""]],
    GEO, "F: the log says it once, not once per look", "RED"],
  ["G40", [[RG, "        if (r.asked > 0) s.noAnswer = !(r.reached > 0);\n", ""]],
    GEO, "F: no source answering: the line says so", "RED"],
  ["G41", [[RG, "((st.keyless && st.keyless.length) ? \"keyless\" : null)", "null"]],
    GEO, "F: no key for YouTube: the nudge is the line", "RED"],
  ["G42", [[RG, "    if (!w.warn && !w.skip && !w.strike) { _say(s, null); return Promise.resolve(\"nothing-asked\"); }\n", ""]],
    GEO, "F: both of the bot's settings off: nothing looked up, and no line", "RED"],
  ["G43", [[RG, "!s.answers[k] && !(typeof s.tried[k] === \"number\" && now - s.tried[k] < RETRY_MS)", "!s.answers[k]"]],
    GEO, "G: a song with an answer is not asked again", "RED"],   // an unanswered song asked every look
  ["G44", [[RG, "  const ASK = Object.freeze({ list: \"room\" });", "  const ASK = Object.freeze({ list: \"mine\" });"]],
    GEO, "G: the song playing and every queued song", "RED"],   // counted as My queue's
  ["G45", [[RG, "    return Promise.resolve().then(() => RepPorts.sendChat(mainId, text))", "    return Promise.resolve().then(() => RepPorts.sendChat(\"!elsewhere\", text))"]],
    GEO, "E: the line goes to the room's main chat", "RED"],
  ["G46", [[RG, "\"The bot will skip it when it starts.\"", "\"The bot will skip it.\""]],
    GEO, "D: skips on and its minimums met by ranked people", "RED"],
  ["G47", [[RG, "(w.unranked ? \"\" : \" Unranked people\u2019s countries aren\u2019t counted.\")", "\"\""]],
    GEO, "D: unranked people's countries left out", "RED"],
  ["G48", [[RG, "    if (!RepPorts.actingAsBot() || typeof c.spaceId !== \"string\" || !c.channels) {", "    if (typeof c.spaceId !== \"string\" || !c.channels) {"]],
    GEO, "A: on a tab that is not the room's bot", "RED"],   // every tab warns and skips
  // ── Room settings: the rows under "The bot" and the muted line ──
  ["G49", [[ST, "      if (botHere) {\n        _box().appendChild(H.el(\"div\", { class: \"set-group-label\", text: \"The bot\" }));",
                "      if (true) {\n        _box().appendChild(H.el(\"div\", { class: \"set-group-label\", text: \"The bot\" }));"]],
    ROWS_, "I: with no bot, every setting in BOT_ONLY and NEEDS_BOT is hidden", "RED"],   // offered where nothing acts on them   // offered where nothing acts on them
  ["G50", [[ST, "        if (s.botBlockedSkip === true || s.botBlockedStrike === true) {", "        if (true) {"]],
    ROWS_, "its minimums are hidden", "RED"],   // a table drawn under a switch that is off
  ["G51", [[ST, "    { const geoNote = _repRoomNote(); if (geoNote) refs.settingsBox.appendChild(H.el(\"p\", { class: \"muted\", text: geoNote })); }\n", ""]],
    "check-rep-boundary", "and `Rep.roomNote` once, in its helper Room settings asks at its top", "RED"],   // the bot silent on screen
  ["G52", [["index.html", "features/rep-geo.js?v=", "features/rep-gone.js?v="]],
    "check-wiring", "R: EVERY feature module has a `<script>` tag in index.html", "RED"],   // runs in every sandbox, undefined in a browser
  ["G53", [[ST, ", \"botBlockedWarn\", \"botBlockedSkip\", \"botBlockedStrike\",\n      \"botBlockedFixMs\", \"botBlockedRoads\"]],", "]],"]],
    ROWS_, "I: and listed under \"Blocked songs\" in the delegation list's groups", "RED"],   // filed under "Other"
  ["G54", [["ui/chat.js", "botBlockedSkip: \"Bot skips blocked songs\",", "botBlockedSkip: \"Skip blocked songs\","]],
    ROWS_, "I: the bot's blocked-song settings are named in the one name table", "RED"],   // a name that does not say whose
  // ── CONTROLS: nothing that matters changes ──
  ["GG1", [[RG, "  // H6: the one muted line for Room settings on this tab, or null.", "  // H6: the one muted line for Room settings on this tab (or null)."]],
    GEO, "", "GREEN"],   // a comment reworded
  ["GG2", [[MD, "  // ---- MANY SONGS AT ONCE: THE BOT'S WHOLE-QUEUE CHECK", "  // ---- MANY SONGS IN ONE GO: THE BOT'S WHOLE-QUEUE CHECK"]],
    GS, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-g:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
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
