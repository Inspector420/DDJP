// tools/probes/mutate-j153-d.js
// SUBJECT: J153's (b), at `ddjp_723` — COUNTRIES: the country table (`core/countries.js`) and its one reading of a typed
// country — a name in any case with accents folded, a code either case, a number with or without its zeros, an ambiguous name
// refused by its own reason; REP's `cc` on summaries and additions, written for the people a message names, read only against
// the codes handed in, the latest message saying each person's; `!setcountry` on the bot side, by the room's two rank bars
// asked through Capabilities, its replies, the countries kept beside the table and saved, carried by summaries and additions
// (an unranked person's only while the room's switch is on), kept by Start fresh, exported, and written over person by person
// by a Replace; the ports to the table and the store's own slot; REP's boundary holding the tenth module and the reducer's six
// keys; the three settings folding, offered as decided, and drawn. One row per thing the build does, each naming the failure
// it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j151-room-services.js`, unchanged.
//
//   node tools/probes/mutate-j153-d.js            every row
//   node tools/probes/mutate-j153-d.js D1 D5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");

const ROWS = [
  ["D1", [["core/countries.js", "    if (k && _ambiguous[k]) return { ok: false, why: \"ambiguous\", could: _ambiguous[k].slice() };", "    if (k && _ambiguous[k]) return { ok: true, country: _byCode[_ambiguous[k][0]] };"]],
    "check-countries", "reads as ambiguous", "RED"],   // an ambiguous name guessed
  ["D2", [["core/countries.js", ".normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\")", ""]],
    "check-countries", "D: \"cote divoire\" is CI", "RED"],   // accents no longer folded
  ["D3", [["core/countries.js", "      const c = _byNum[Number(t)];", "      const c = _byNum[t];"]],
    "check-countries", "D: \"004\" is AF", "RED"],   // a number's leading zeros count
  ["D4", [["core/countries.js", "    if (/^[A-Za-z]{2}$/.test(t) && _byCode[t.toUpperCase()]) return { ok: true, country: _byCode[t.toUpperCase()] };", "    if (/^[A-Za-z]{2}$/.test(t) && _byCode[t]) return { ok: true, country: _byCode[t] };"]],
    "check-countries", "D: \"fr\" is FR", "RED"],   // a code only in capitals
  ["D5", [["core/countries.js", "\"DR Congo\", \"DRC\", \"Congo-Kinshasa\"]],", "\"DR Congo\", \"DRC\", \"Congo-Kinshasa\", \"Congo\"]],"]],
    "check-countries", "B: names and aliases, folded, are unique", "RED"],   // one name, two countries
  ["D6", [["features/rep-rules.js", "    const cc = _ccOf(o.cc, rows);\n    if (cc) body.cc = cc;\n    return body;\n  }\n  function addition(o) {", "    return body;\n  }\n  function addition(o) {"]],
    "check-rep-rules", "K: a summary's `cc` holds the people it names", "RED"],   // a summary carries no countries
  ["D7", [["features/rep-rules.js", "    for (const r of rows) if (_own(cc, r[0]) && typeof cc[r[0]] === \"string\") { out[r[0]] = cc[r[0]]; n++; }", "    for (const u of Object.keys(cc)) if (typeof cc[u] === \"string\") { out[u] = cc[u]; n++; }"]],
    "check-rep-rules", "K: a summary's `cc` holds the people it names who have a country, and nobody else", "RED"],   // countries for people the message does not name
  ["D8", [["features/rep-rules.js", "if (named[u] && typeof cc[u] === \"string\" && codes.indexOf(cc[u]) >= 0) out[u] = cc[u];", "if (named[u] && typeof cc[u] === \"string\") out[u] = cc[u];"]],
    "check-rep-rules", "K: a code not in the table, a lower-case one", "RED"],   // a code read unchecked
  ["D9", [["features/rep-rules.js", "if (named[u] && typeof cc[u] === \"string\" && codes.indexOf(cc[u]) >= 0) out[u] = cc[u];", "if (typeof cc[u] === \"string\" && codes.indexOf(cc[u]) >= 0) out[u] = cc[u];"]],
    "check-rep-rules", "K: a code not in the table, a lower-case one", "RED"],   // a country read for someone the message does not name
  ["D10", [["features/rep-rules.js", "if (c) out[r.user] = c; else delete out[r.user];", "if (c) out[r.user] = c;"]],
    "check-rep-rules", "K: the latest message naming a person says their country", "RED"],   // a later message never clears a country
  ["D11", [["features/rep-bot.js", "    if (!RepPorts.rankAtLeast(RepPorts.levelOf(s.spaceId, s.channels, sender), bar)) {", "    if (false) {"]],
    "check-rep-bot", "U: ONE'S OWN NEEDS THE ROOM'S BAR", "RED"],   // no rank bar at all
  ["D12", [["features/rep-bot.js", "    const bar = others ? set.repCountryOthersRank : set.repCountryOwnRank;", "    const bar = set.repCountryOwnRank;"]],
    "check-rep-bot", "U: SOMEONE ELSE'S NEEDS THE OTHER BAR", "RED"],   // someone else's judged by the own bar
  ["D13", [["features/rep-bot.js", "    const others = target !== sender, set = RepPorts.settings() || {};", "    const others = !!at, set = RepPorts.settings() || {};"]],
    "check-rep-bot", "U: the @user form naming oneself is one's own", "RED"],   // naming oneself read as someone else
  ["D14", [["features/rep-bot.js", "    if (m && !RepPorts.mayCommand(RepPorts.levelOf(s.spaceId, s.channels, sender))) { ignored(\"not the owner\"); return; }", "    if (!RepPorts.mayCommand(RepPorts.levelOf(s.spaceId, s.channels, sender))) { ignored(\"not the owner\"); return; }"]],
    "check-rep-bot", "U: !setcountry france — a guest sets their own", "RED"],   // !setcountry the owner's alone, as !rep
  ["D15", [["features/rep-bot.js", "      if (r && r.why === \"ambiguous\") return {", "      if (false) return {"]],
    "check-rep-bot", "U: AN AMBIGUOUS NAME is answered with its own reason", "RED"],   // an ambiguous name answered as unknown
  ["D16", [["features/rep-bot.js", "    if (!s.table) return { reply: \"No reputation table yet.\" };\n", ""]],
    "check-rep-bot", "U: with no table, as !rep", "RED"],   // a country kept with no table
  ["D17", [["features/rep-bot.js", "    s.countries[target] = r.country.code;\n    _saveCountries(s);", "    s.countries[target] = r.country.code;"]],
    "check-rep-bot", "U: and it is SAVED, in its own slot beside the table", "RED"],   // a country set and never saved
  ["D18", [["features/rep-bot.js", "rows: rows, cc: _ccOut(s, active) }", "rows: rows }"]],
    "check-rep-bot", "U: THE SUMMARY CARRIES THE COUNTRIES OF THE PEOPLE IT NAMES", "RED"],   // summaries carry no countries
  ["D19", [["features/rep-bot.js", ",\n      cc: _ccOut(s, fresh) });", " });"]],
    "check-rep-bot", "U: AN ADDITION CARRIES THE COUNTRY OF THE PERSON IT ADDS", "RED"],   // additions carry no countries
  ["D20", [["features/rep-bot.js", "      if (!all && !RepPorts.rankAtLeast(", "      if (false && !RepPorts.rankAtLeast("]],
    "check-rep-bot", "OFF — the unranked person is still named, their country left out", "RED"],   // the unranked switch does nothing
  ["D21", [["features/rep-bot.js", "    t.since = file ? file.since : now;", "    t.since = file ? file.since : now;\n    if (fresh) s.countries = Object.create(null);"]],
    "check-rep-bot", "U: START FRESH KEEPS THEM", "RED"],   // Start fresh wipes the countries
  ["D22", [["features/rep-bot.js", "for (const u of Object.keys(file.countries)) s.countries[u] = file.countries[u];", "s.countries = Object.assign(Object.create(null), file.countries);"]],
    "check-rep-bot", "U: A REPLACE WRITES THE FILE'S COUNTRIES OVER THE KEPT ONES", "RED"],   // a Replace replaces the countries whole
  ["D23", [["features/rep-bot.js", "rows: rows, countries: _plainCountries(s.countries) };", "rows: rows };"]],
    "check-rep-bot", "U: EXPORT CARRIES THE COUNTRIES", "RED"],   // Export leaves the countries behind
  ["D24", [["features/rep-bot.js", "label: \"Answer commands\" }),", "label: \"Answer the owner's !rep commands\" }),"]],
    "check-rep-bot", "U: ONE SWITCH COVERS BOTH COMMANDS", "RED"],   // the switch's label untrue again
  ["D25", [["features/rep-bot.js", "    for (const u of Object.keys(cc)) if (USER_RE.test(u) && codes.indexOf(cc[u]) >= 0) out[u] = cc[u];", "    for (const u of Object.keys(cc)) out[u] = cc[u];"]],
    "check-rep-bot", "U: A NEW SESSION LOADS THE COUNTRIES KEPT", "RED"],   // a stored bad entry kept
  ["D26", [["features/rep-ports.js", "CAP().atLeast(level, name) === true", "!!CAP().atLeast(level, name)"]],
    "check-rep-ports", "B: and only a strict true is a yes", "RED"],   // a truthy answer read as a yes
  ["D27", [["features/rep-ports.js", "const v = CT().codes(); return Array.isArray(v) ? v.slice() : null; }", "const v = CT().codes(); return Array.isArray(v) ? v : null; }"]],
    "check-rep-ports", "B: countryCodes passes the table's codes through, as a copy", "RED"],   // the table's own list handed out
  ["D28", [["core/store.js", "IDB.set(\"kv\", IDB.keyFor({ room: spaceId }, \"rep\", \"countries\"), cc)", "IDB.set(\"kv\", IDB.keyFor({ room: spaceId }, \"rep\", \"table\"), cc)"]],
    "check-rep-ports", "F: and load back from their own key", "RED"],   // the countries saved over the table's slot
  ["D29", [["features/rep-bot.js", "    const r = RepPorts.country(rest);", "    const r = Countries.read(rest);"]],
    "check-rep-boundary", "B: `features/rep-bot.js` names no app global", "RED"],   // the bot side reaching the table past the ports
  ["D30", [["features/rep-rules.js", "    if (!Array.isArray(codes) || !cc ||", "    codes = codes || Countries.codes();\n    if (!Array.isArray(codes) || !cc ||"]],
    "check-rep-boundary", "A: `rep-rules.js` names no app global", "RED"],   // the rules reaching for the table
  ["D31", [["backends/backend1/statederiver.js", "      repCountryOthersRank: \"high-staff\",", "      repCountryOthersRank: \"high-staff\", repCountryExtra: 1,"]],
    "check-rep-boundary", "E: the reducer holds REP's settings keys", "RED"],   // a seventh REP key in the reducer
  ["D32", [["backends/backend1/statederiver.js", "    if (_inValues(\"repCountryOwnRank\", s.repCountryOwnRank)) settings.repCountryOwnRank = s.repCountryOwnRank;\n", ""]],
    "check-setting-endpoints", "A2: `repCountryOwnRank` must ACCEPT", "RED"],   // the own bar never folds
  ["D33", [["backends/backend1/statederiver.js", "    if (typeof s.repUnrankedCountries === \"boolean\") settings.repUnrankedCountries = s.repUnrankedCountries;\n", ""]],
    "check-setting-endpoints", "D: `repUnrankedCountries` FOLDS", "RED"],   // the unranked switch never folds
  ["D34", [["backends/backend1/statederiver.js", "    repCountryOthersRank: { values: Ranks.NAMES.filter((n) => n === \"staff\" || n === \"high-staff\" || n === \"owner\"), scale: 1 },", "    repCountryOthersRank: { values: Ranks.NAMES.slice(), scale: 1 },"]],
    "check-rep-bot", "U: THE CHOICES", "RED"],   // someone else's offered from any rank
  ["D35", [["ui/settings.js", "        onOff(\"repUnrankedCountries\", null,", "        if (false) onOff(\"repUnrankedCountries\", null,"]],
    "check-settings-rows", "I: a consensus room with a bot shows EVERY setting", "RED"],   // the switch's row not drawn
  ["D36", [["ui/settings.js", "        _renderRankBarRow(\"repCountryOthersRank\",", "        if (false) _renderRankBarRow(\"repCountryOthersRank\","]],
    "check-settings-rows", "I: a consensus room with a bot shows EVERY setting", "RED"],   // the other bar's row not drawn
  ["DG1", [["core/countries.js", "  // The country with this two-letter code, or null.", "  // The country with a two-letter code, or null."]],
    "check-countries", "", "GREEN"],   // a comment reworded
  ["DG2", [["features/rep-bot.js", "  // `!setcountry` (J153 (b)): { reply } — the words to send — or { ignore: why }. Kept only once permitted and read.", "  // `!setcountry` (J153 (b)): { reply }, the words to send, or { ignore: why }. Kept only once permitted and read."]],
    "check-rep-bot", "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-d:" + id, file);   // journalled BEFORE the write
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
