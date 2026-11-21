// tools/probes/mutate-j153-h.js
// SUBJECT: J153's (d), its second half, at `ddjp_727` — STRIKES WITH THE FIX TIME, DOWN-DETECTION, AUTO FALLBACK AND THE
// FAVOURITE: the lookup path's down sources (three failures in a row, never "no answer", skipped ten minutes by its own
// clock, said each way, handed on part-way in `fetchMany`, named by `geoStatus`; Invidious' servers answering without a list
// are no answer); the device's order (`Songs.regionOrder`: the favourite first, the rest with auto fallback on, the favourite
// alone with it off, one not ready counting as none) in both lookups; the two device settings (`ChatPrefs`) and their rows on
// "Where songs are blocked"; the bot's strikes (`features/rep-geo.js`: the warning saying so, the timer from its delivery, the
// strike when the DJ is next with the minimums met then, said once it has happened, the next song warned again, warnings off,
// the words) and their port; the two room settings (defaults, fold, row, read live, the surface) and their rows, names and
// delegation group. One row per thing the build does, each naming the failure it must cause; the controls change nothing that
// matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-g.js`, unchanged.
//
//   node tools/probes/mutate-j153-h.js            every row
//   node tools/probes/mutate-j153-h.js H1 H5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MD = "features/metadata.js";
const SO = "core/songs.js";
const CP = "core/chatprefs.js";
const ST = "ui/settings.js";
const SD = "backends/backend1/statederiver.js";
const DI = "backends/backend1/dials.js";
const CH = "ui/chat.js";
const RP = "features/rep-ports.js";
const RG = "features/rep-geo.js";
const GS = "check-geo-sources";
const GD = "check-geo-device";
const GEO = "check-rep-geo";
const RPG = "check-rep-ports";
const ROWS_ = "check-settings-rows";
const BD = "check-rep-boundary";
const RC = "check-room-compat";

const ROWS = [
  ["H1", [[MD, "\"failed\") + \")\"); _failed(p); }", "\"failed\") + \")\"); }"]],
    GS, "G: the third failure in a row makes ProxyNova down", "RED"],   // a refusal on one song's lookup counts nothing
  ["H2", [[MD, "        if (geo) _answered(p);                       // it came back: answering, whatever it said\n", ""]],
    GS, "G: two failures, an answer, two failures: the answer started the count over", "RED"],   // an answer does not start the count over
  ["H3", [[MD, "        if (_isDown(p)) { tried.push(_geoName(p) + \" down\"); return next(); }   // skipped, uncounted\n", ""]],
    GS, "G: while it is down it is skipped", "RED"],   // a source down is still asked, one song at a time
  ["H4", [[MD, "      h.until = _clock() + DOWN_MS;", "      h.until = _clock() + DOWN_MS * 2;"]],
    GS, "G: ten minutes on, it is asked again", "RED"],   // down for twenty minutes, not ten
  ["H5", [[MD, "    if (_clock() < h.until) return true;", "    if (_clock() <= h.until) return true;"]],
    GS, "G: ten minutes on, it is asked again", "RED"],   // the window's end one moment late
  ["H6", [[MD, "    h.until = 0; h.fails = 0;", "    h.until = 0;"]],
    GS, "G: asked again, it needs three new failures in a row", "RED"],   // asked again, the old count still standing: down at the first failure
  ["H7", [[MD, "      _say(\"warn\", _geoName(p) + \" is down \u2014 \"", "      void (\"warn\", _geoName(p) + \" is down \u2014 \""]],
    GS, "G: the third failure in a row makes ProxyNova down, said once in the log", "RED"],   // down without a word in the log
  ["H8", [[MD, "    _say(\"info\", _geoName(p) + \" is asked again: its \"", "    void (\"info\", _geoName(p) + \" is asked again: its \""]],
    GS, "G: ten minutes on, it is asked again, said once", "RED"],   // back without a word in the log
  ["H9", [[MD, "    return { on: _geoOn(), keyless: keyless, down: down };", "    return { on: _geoOn(), keyless: keyless, down: [] };"]],
    GS, "G: while it is down, `geoStatus` names it", "RED"],   // the bot cannot tell which source is down
  ["H10", [[MD, "          if (_isDown(p)) { wentDown = true; return; }\n", ""]],
    GS, "G: in `fetchMany`, ProxyNova's groups stop at the third refusal", "RED"],   // a source down, before its first group or part-way, is asked anyway
  ["H12", [[MD, "          }, () => { refused++; _failed(p); });", "          }, () => { refused++; });"]],
    GS, "G: in `fetchMany`, ProxyNova's groups stop at the third refusal", "RED"],   // the bot's refusals never count toward down
  ["H13", [[MD, "          if (i >= src.servers.length) return came ? Promise.resolve({}) : Promise.reject(new Error(\"network error\"));", "          if (i >= src.servers.length) return Promise.reject(new Error(\"network error\"));"]],
    GS, "I: every server answering without a list", "RED"],   // Invidious' "no answer" counted as a failure
  ["H14", [[SO, "    const fallback = o.fallback !== false;", "    const fallback = true;"]],
    GS, "H: auto fallback off: the favourite alone", "RED"],   // auto fallback off asks the others anyway
  ["H15", [[SO, "    const fav = (chosen && ready(chosen)) ? chosen : (mine.find(ready) || null);", "    const fav = chosen ? chosen : (mine.find(ready) || null);"]],
    GS, "H: YouTube chosen with no key counts as none chosen", "RED"],   // a favourite that is not ready is put first anyway
  ["H16", [[MD, "    const table = plan.ids.map((id) => byId[id]).filter(Boolean);", "    const table = all.filter((p) => p && p.short === short);"]],
    GS, "H: the favourite (Invidious) is asked first", "RED"],   // the table's order, the favourite ignored
  ["H17", [[MD, "    const chain = geo ? _geoChain(Songs.serviceOf(songKey)) : providersFor(field);", "    const chain = providersFor(field);"]],
    GS, "H: the favourite (Invidious) is asked first", "RED"],   // a screen's lookup ignores the device's order
  ["H18", [[MD, "        left = want.filter((k) => Songs.serviceOf(k) === sh); i = 0; chain = _geoChain(sh);", "        left = want.filter((k) => Songs.serviceOf(k) === sh); i = 0; chain = providersFor(\"geo\");"]],
    GS, "H: `fetchMany` asks the favourite first too", "RED"],   // the bot's whole-queue check ignores the device's order
  ["H19", [[CP, "  function geoChoices(short)  { return { favourite: geoFavourite(short), fallback: geoFallback(), keyHeld: !!apiKey(short) }; }", "  function geoChoices(short)  { return { favourite: geoFavourite(short), fallback: geoFallback(), keyHeld: false }; }"]],
    GS, "B: with a key, YouTube is asked first", "RED"],   // a key held, the order still starts at ProxyNova
  ["H20", [[CP, "    _state.geoFavourites = _cleanFavourites(_state.geoFavourites);\n", ""]],
    GD, "E: a stored favourites map of the wrong shape is rebuilt on load", "RED"],   // a stored junk map breaks choosing a favourite
  ["H21", [[CP, "    if (!_isSourceOf(short, id)) return false;\n    _st().geoFavourites[short] = id;", "    _st().geoFavourites[short] = id;"]],
    GD, "E: a favourite that is not a source the table gives that service is refused", "RED"],   // any string kept as a favourite
  ["H22", [[ST, "      sec.appendChild(H.el(\"div\", { class: \"pref-title pref-alarm-head\", text: \"Favourite source\" + (shorts.length > 1 && svc ? \" for \" + svc : \"\") }));", "      sec.appendChild(H.el(\"div\", { class: \"pref-title pref-alarm-head\", text: \"Source\" + (shorts.length > 1 && svc ? \" for \" + svc : \"\") }));"]],
    GD, "E: the card has \"Favourite source\"", "RED"],   // the choice unnamed
  ["H23", [[ST, "\" needs your own key on this device: until one is set, \"", "\" is chosen; \""]],
    GD, "E: a chosen source that is not ready stays chosen, and the card says why", "RED"],   // the card silent about why another is asked first
  ["H24", [[ST, "    fbox.onchange = () => { try { ChatPrefs.setGeoFallback(!!fbox.checked); } catch (e) {} renderChatSettings(); };", "    fbox.onchange = () => { try { ChatPrefs.setGeoFallback(true); } catch (e) {} renderChatSettings(); };"]],
    GD, "E: unticked, it saves", "RED"],   // the switch saves nothing
  ["H25", [[ST, "        downWords = \" A source that fails \" + M.DOWN_AFTER + \" times in a row is down, and is left alone for \" + Math.round(M.DOWN_MS / 60000) + \" minutes.\";", "        downWords = \" A source that fails three times in a row is down, and is left alone for 10 minutes.\";"]],
    GD, "E: its note says what it does and what down means", "RED"],
  ["H30", [[RG, "          if (!ok) { delete s.warned[id]; return; }", "          if (!ok) { delete s.warned[id]; }"]],
    GEO, "T: a warning that did not arrive starts no timer", "RED"],   // an undelivered warning starts the clock
  ["H31", [[RG, "    if (typeof t !== \"number\" || now - t < w.fixMs) return Promise.resolve();", "    if (typeof t !== \"number\") return Promise.resolve();"]],
    GEO, "T: a moment before the full fix time, nothing is struck", "RED"],   // struck before the fix time is over
  ["H32", [[RG, "    const head = queued[0];", "    const head = queued[queued.length - 1];"]],
    GEO, "T: a DJ who is not next to play is not struck", "RED"],   // a DJ struck who is not next
  ["H33", [[RG, "    const k = head.songKeys[0], id = head.dj + \"\\n\" + k;", "    const k = head.songKeys[head.songKeys.length - 1], id = head.dj + \"\\n\" + k;"]],
    GEO, "T: the full fix time over, the DJ next to play, the bot sends the moderator's strike of that song", "RED"],   // a song struck that is not the one about to play
  ["H34", [[RG, "    if (!(c && c.ranked.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.guests, c.vips))) return Promise.resolve();\n    const codes = c.codes.ranked.join(\", \");", "    if (!c) return Promise.resolve();\n    const codes = c.codes.ranked.join(\", \");"]],
    GEO, "T: the ranked person it is blocked for has left", "RED"],   // struck on a minimum no longer met
  ["H35", [[RG, "    if (st && st !== \"failed\") return Promise.resolve();             // sent: waiting to see it go\n", ""]],
    GEO, "T: sent once, not again at the next look", "RED"],   // a strike sent at every look
  ["H36", [[RG, "      if (np && np.dj === dj && np.songKey === k) { _log(\"the strike of \" + k + \" lost the race: it started first\"); continue; }\n", ""]],
    GEO, "T: a strike the song's start beat says no line", "RED"],   // a lost race announced as a removal
  ["H37", [[RG, "\" was removed from the queue: it is blocked for \"", "\" is gone: it is blocked for \""]],
    GEO, "T: once the song is gone and not playing, one line says so", "RED"],   // the strike's line in other words
  ["H38", [[RG, "      s.rewarn[dj] = true;\n", ""]],
    GEO, "T: after the strike, the DJ's next song is warned again", "RED"],   // the next song struck on its old timer, no new warning
  ["H39", [[RG, "        if (said === \"strike\" && !(again && at === 0)) return;", "        if (said === \"strike\") return;"]],
    GEO, "T: after the strike, the DJ's next song is warned again", "RED"],   // the next song not warned again
  ["H40", [[RG, "        if (strikes) delete s.strikes[id];                  // its timer starts at THIS warning's delivery, or not at all\n", ""]],
    GEO, "T: so it is not struck at once on the old timer", "RED"],   // the old timer kept until the new warning lands
  ["H41", [[RG, "        if (!w.warn && !strikes) return;                    // warnings off: only the songs it will strike\n", ""]],
    GEO, "T: warnings off \u2014 the song it will strike is still warned, and the one blocked only for an unranked person is not", "RED"],   // warnings off, every song warned
  ["H42", [[RG, "    if (w.warn || w.strike) done.push(_warnings(s, w, queued, here));", "    if (w.warn) done.push(_warnings(s, w, queued, here));"]],
    GEO, "T: warnings off \u2014 the song it will strike is still warned", "RED"],   // a strike with no warning before it
  ["H43", [[RG, "        if (said && !strikes) return;                       // warned already, and nothing new to say", "        if (said) return;"]],
    GEO, "T: strikes turned on later \u2014 the song is warned again", "RED"],   // struck on a warning that never said so
  ["H44", [[RG, "\"The bot will remove it when you\u2019re next to play unless you change it within \"", "\"The bot will remove it unless you change it within \""]],
    GEO, "T: the warning says the bot will remove it when the DJ is next to play", "RED"],   // the warning's words
  ["H45", [[RG, "const m = Math.max(1, Math.floor(ms / 60000));", "const m = Math.max(1, Math.ceil(ms / 60000));"]],
    GEO, "T: a fix time of 90000 ms reads", "RED"],   // a minute promised that is not there
  ["H46", [[RG, "\"; if it starts before then, the bot will skip it.\"", "\".\""]],
    GEO, "T: with the skip on too, the warning says the skip applies if it starts first", "RED"],   // the skip left out of the warning
  ["H47", [[RG, "        if (st !== \"failed\" && now - st.at > SETTLE_MS) {", "        if (false) {"]],
    GEO, "T: still queued after `SETTLE_MS`: it did not take", "RED"],   // a strike that did not take waited on for ever
  ["H48", [[RG, "      s.striking[id] = \"failed\";\n      _log(\"the strike of \" + k + \" from \"", "      _log(\"the strike of \" + k + \" from \""]],
    GEO, "T: a strike that did not go out is said in the log, tried again at the next look", "RED"],   // a strike that did not go out never tried again
  ["H49", [[RG, "      strike: s.botBlockedStrike === true,", "      strike: s.botBlockedStrike !== false,"]],
    GEO, "F: both of the bot's settings off: nothing looked up, and no line", "RED"],   // strikes on by an absent switch: a bot asked for nothing looks songs up
  ["H50", [[RG, "    if (!w.warn && !w.skip && !w.strike) { _say(s, null); return Promise.resolve(\"nothing-asked\"); }", "    if (!w.warn && !w.skip) { _say(s, null); return Promise.resolve(\"nothing-asked\"); }"]],
    GEO, "T: warnings off \u2014 the song it will strike is still warned", "RED"],   // strikes alone look at nothing
  ["H51", [[RG, "    return RepPorts.strike(head.dj, k).then((sent) => {", "    return Promise.resolve(Queue.strike(head.dj, k)).then((sent) => {"]],
    BD, "B: `features/rep-geo.js` names no app global", "RED"],   // the piece reaching the queue past the ports
  ["H55", [[RP, "    try { p = QU().strike(userId, songKey); } catch (e) { return Promise.resolve(false); }\n    return Promise.resolve(p).then((r) => !!(r && typeof r === \"object\" && r.ok !== false), () => false);", "    try { p = QU().strike(userId, songKey); } catch (e) { return Promise.resolve(false); }\n    return Promise.resolve(p).then((r) => !!r, () => false);"]],
    RPG, "B: and false for a refusal, a throw, a failed send and nothing sent", "RED"],   // a refusal read as a strike
  ["H56", [[RP, "    try { p = QU().strike(userId, songKey); }", "    try { p = QU().strike(songKey, userId); }"]],
    RPG, "B: strike sends the moderator's strike of that DJ's song", "RED"],   // the strike's arguments swapped
  ["H60", [[SD, "      botBlockedStrike: false,\n", "      botBlockedStrike: true,\n"]],
    GEO, "S: strikes off and a fix time of ten minutes by default", "RED"],   // strikes on in every room
  ["H61", [[SD, "    if (typeof s.botBlockedStrike === \"boolean\") settings.botBlockedStrike = s.botBlockedStrike;\n", ""]],
    GEO, "S: the strike's switch folds on the booleans' strict check", "RED"],   // the owner's switch never folds
  ["H62", [[SD, "    if (_inRange(\"botBlockedFixMs\", s.botBlockedFixMs)) settings.botBlockedFixMs = s.botBlockedFixMs;\n", ""]],
    GEO, "S: the fix time folds inside its row", "RED"],   // the owner's fix time never folds
  ["H63", [[SD, "    botBlockedFixMs:      { min: 60000, max: 24 * 60 * 60 * 1000, scale: 60000 },", "    botBlockedFixMs:      { min: 1000, max: 24 * 60 * 60 * 1000, scale: 60000 },"]],
    GEO, "S: the fix time folds inside its row", "RED"],   // a fix time under a minute taken
  ["H64", [[DI, "                \"botBlockedStrike\", \"botBlockedFixMs\",\n", ""]],
    GEO, "S: every one is read LIVE", "RED"],   // the two in neither list
  ["H65", [[SD, "      botBlockedFixMs: 600000,   // 10 minutes\n", ""]],
    RC, "THIS CHANGE BREAKS EXISTING ROOMS", "RED"],   // a key gone from the surface
  ["H66", [[ST, "        onOff(\"botBlockedStrike\", null,", "        if (false) onOff(\"botBlockedStrike\", null,"]],
    ROWS_, "I: a consensus room with a bot shows EVERY setting", "RED"],   // the strike's switch never drawn
  ["H67", [[ST, "        if (s.botBlockedStrike === true) {\n          under(() => {\n            _renderNumberSettingRow(\"botBlockedFixMs\"", "        if (true) {\n          under(() => {\n            _renderNumberSettingRow(\"botBlockedFixMs\""]],
    ROWS_, "its fix time and its minimums are hidden", "RED"],   // the fix time drawn with strikes off
  ["H68", [[ST, "        if (s.botBlockedSkip === true || s.botBlockedStrike === true) {", "        if (s.botBlockedSkip === true) {"]],
    ROWS_, "I: its strike alone on \u2014 its fix time and its minimums are drawn", "RED"],   // the strikes' minimums hidden
  ["H69", [[ST, "\"botBlockedStrike\",\n      \"botBlockedFixMs\", \"botBlockedRoads\"]],", "\"botBlockedRoads\"]],"]],
    ROWS_, "I: and listed under \"Blocked songs\" in the delegation list's groups", "RED"],   // filed under "Other"
  ["H70", [[CH, "botBlockedStrike: \"Bot strikes blocked songs\",", "botBlockedStrike: \"Strikes blocked songs\","]],
    ROWS_, "I: the bot's blocked-song settings are named in the one name table", "RED"],   // a name that does not say whose
  ["HH1", [[MD, "  // ---- A SOURCE THAT IS DOWN (J153 (d); the supervisor's numbers at", "  // ---- A SOURCE THAT GOES DOWN (J153 (d); the supervisor's numbers at"]],
    GS, "", "GREEN"],   // a comment reworded
  ["HH2", [[RG, "  // \u2500\u2500 THE STRIKE, WHEN THE DJ IS NEXT TO PLAY \u2500\u2500", "  // \u2500\u2500 THE STRIKE, WHEN THE DJ IS UP NEXT \u2500\u2500"]],
    GEO, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-h:" + id, file);   // journalled BEFORE the write
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
