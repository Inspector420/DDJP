// tools/probes/mutate-j153-f.js
// SUBJECT: J153's (c), its second half, at `ddjp_725` — THE GLOBE ON A SONG ROW AND ITS POP-UP, AND EVERY DEVICE READING PEOPLE'S
// COUNTRIES: the reader's `cc` (codes handed in through the ports, the newest message naming a person winning, offered as soon
// as a summary is held, said only when it moved) and `Rep.countries` (H5, a copy, the reader's alone); `Countries.blockedView`,
// the one verdict; the globe in the room queue (its song playing too), My queue and a playlist, never History; its tones, words,
// keyboard and tap area; names as every name; one open at a time, Escape putting the focus back; the redraw in place on a
// lookup's answer and on REP's countries moving, and its wiring; `MediaBlocked`'s line for every person's first report per
// playing. (The pop-up's own lines, boxes and closing, and `H.stickToButton`'s two options, went at `ddjp_729`: retired below.) One row per thing the build does, each naming the failure it must cause; the controls change nothing that matters
// and must stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-c.js`, unchanged.
//
// RETIRED AT `ddjp_729` (Region Blocks replaced the pop-up these rows broke; its own rows are `mutate-j153-i.js`):
//   ── F23 retired: the old pop-up's headline line (`.st-name`), gone with it
//   ── F24 retired: the old pop-up's country names in one line, gone with it (Region Blocks lists every country)
//   ── F25 retired: the old pop-up's people box (`.geo-people`), gone with it
//   ── F26 retired: edits `index.html`'s `.geo-menu .geo-people` rule, gone with the old pop-up
//   ── F27 retired: the old pop-up's count line, gone with it
//   ── F28 retired: the old pop-up's other-sites line at its foot, gone with it
//   ── F32 retired: the old pop-up's press-outside listener; Region Blocks closes as the preview does (`_backdrop`)
//   ── F34 retired: the old pop-up's `H.stickToButton` call (`onGone`), gone with it
//   ── F35 retired: the old pop-up's `H.stickToButton` call (`above`), gone with it
//   ── F36 retired: edits `H.stickToButton`'s `above` option, removed with the old pop-up, its only caller
//   ── F37 retired: edits `H.stickToButton`'s `onGone` option, removed likewise
//   ── F38 retired: edits `H.stickToButton`'s `onGone` option, removed likewise
//   ── F39 retired: edits `H.stickToButton`'s `above` option, removed likewise
//
//   node tools/probes/mutate-j153-f.js            every row
//   node tools/probes/mutate-j153-f.js F1 F5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const RR = "features/rep-reader.js";
const RP = "features/rep-ports.js";
const CT = "core/countries.js";
const PL = "ui/playlists.js";
const QU = "ui/queue.js";
const SC = "ui/screens.js";
const IX = "index.html";
const MBL = "features/mediablocked.js";
const RDR = "check-rep-reader";
const RPG = "check-rep-ports";
const GI = "check-geo-icon";

const ROWS = [
  // ── every device reads people's countries ──
  ["F1", [[RR, "      const v = RepRules.readSummary(body, reserved, codes);", "      const v = RepRules.readSummary(body, reserved);"]],
    RDR, "L: OFFERED AS SOON AS A SUMMARY IS HELD", "RED"],   // the summary's `cc` read with no codes: nobody has one
  ["F2", [[RR, "    if (!r.cc) r.cc = RepRules.publishedCountries(r.sum, r.adds);", "    if (!r.cc) r.cc = RepRules.publishedCountries(r.sum, []);"]],
    RDR, "L: THE NEWEST MESSAGE NAMING A PERSON SAYS THEIR COUNTRY", "RED"],   // the additions never read: the summary's word stands
  ["F3", [[RR, "    if (sig === r.ccSig) return;\n", ""]],
    RDR, "L: AN ADDITION THAT MOVES NO COUNTRY RAISES NOTHING", "RED"],   // said on every message, moved or not
  ["F4", [[RR, "people with a country\");\n    RepPorts.peopleChanged();", "people with a country\");"]],
    RDR, "L: and says so", "RED"],   // moved, and nothing told: the globes never redraw
  ["F5", [[RR, "    if (!r || !r.sum) return {};", "    if (!r || !r.sum || !r.ready) return {};"]],
    RDR, "L: OFFERED AS SOON AS A SUMMARY IS HELD", "RED"],   // countries wait for the forward count
  ["F6", [[RP, "    try { const c = r.countries(); return (c && typeof c === \"object\") ? Object.assign({}, c) : {}; } catch (e) { return {}; }",
                "    try { const c = r.countries(); return (c && typeof c === \"object\") ? c : {}; } catch (e) { return {}; }"]],
    RPG, "G: `Rep.countries` (H5) hands back a copy", "RED"],   // the reader's own object handed out
  ["F7", [[RP, "  function countries() {\n    const r = _p(() => RepReader);", "  function countries() {\n    const r = _p(() => RepBot);"]],
    RPG, "never the bot side's", "RED"],   // the bot's own table, not what the room was told
  ["F8", [[RP, "    try { const c = r.countries(); return (c && typeof c === \"object\") ? Object.assign({}, c) : {}; } catch (e) { return {}; }",
                "    const c = r.countries(); return (c && typeof c === \"object\") ? Object.assign({}, c) : {};"]],
    RPG, "G: threw", "RED"],   // a reader that throws breaks every song row
  ["F9", [[PL, "    try { return (typeof Rep !== \"undefined\" && Rep.countries) ? (Rep.countries() || {}) : {}; } catch (e) { return {}; }",
                "    try { return (typeof RepReader !== \"undefined\" && RepReader.countries) ? (RepReader.countries() || {}) : {}; } catch (e) { return {}; }"]],
    "check-rep-boundary", "D: outside REP's files no code names a REP global except at a hook site", "RED"],   // past REP's one door
  // ── the one verdict ──
  ["F10", [[CT, "    out.tone = (out.people.length || out.embeddable === false) ? \"red\" : (out.limited ? \"grey\" : null);",
                "    out.tone = out.people.length ? \"red\" : (out.limited ? \"grey\" : null);"]],
    GI, "A: CAN'T PLAY ON OTHER SITES: red", "RED"],   // the read-through's adopted default dropped
  ["F11", [[CT, "(kind === \"allowed\" ? listed[code] !== true : false)", "(kind === \"allowed\" ? listed[code] === true : false)"]],
    GI, "A: AN ALLOWED LIST", "RED"],   // an allowed list read as a blocked one
  ["F12", [[CT, "    out.limited = kind === \"blocked\" ? out.codes.length > 0 : out.codes.length < _all.length;",
                "    out.limited = out.codes.length > 0;"]],
    GI, "A: AN EMPTY ALLOWED LIST", "RED"],   // allowed nowhere read as no limit
  ["F13", [[CT, "        if (typeof code === \"string\" && _byCode[code] && leftOut(code)) out.people.push({ user: u, code: code });",
                "        if (typeof code === \"string\" && leftOut(code)) out.people.push({ user: u, code: code });"]],
    GI, "A: A COUNTRY THAT IS NO COUNTRY", "RED"],   // a code no country counts as someone's under an allowed list
  // ── where the globe is drawn ──
  ["F14", [[PL, "    if (opts.geo === true) { geoEl.dataset.geo = \"1\"; _geoDraw(geoEl, songKey); }", "    if (true) { geoEl.dataset.geo = \"1\"; _geoDraw(geoEl, songKey); }"]],
    GI, "B: `songRow` DRAWS THE GLOBE ONLY WHEN ASKED", "RED"],   // every list, History's call included
  ["F15", [[QU, "        geo: true,                               // its globe from the saved answer, with no lookup of its own (J153 (c))\n", ""]],
    GI, "B: the song playing draws its globe", "RED"],
  ["F16", [[QU, "          geo: true,                             // and its globe (J153 (c))\n", ""]],
    GI, "B: a room queue row draws its globe", "RED"],
  ["F17", [[QU, "          geo: true,                             // and its globe drawn (J153 (c))\n", ""]],
    GI, "B: a My queue row draws its globe", "RED"],
  ["F18", [[PL, "list: \"playlist\", geo: true, actions: acts", "list: \"playlist\", actions: acts"]],
    GI, "B: a playlist's song draws its globe", "RED"],
  // ── the globe as drawn ──
  ["F19", [[IX, "    .song-row .sr-geo.geo-grey { color: #888; }", "    .song-row .sr-geo.geo-grey { color: #999; }"]],
    GI, "C: THE TWO TONES", "RED"],
  ["F20", [[IX, "    .song-row .sr-geo.geo-on::after { content: \"\"; position: absolute;", "    .song-row .sr-geo.geo-on::after { content: \"\"; position: relative;"]],
    GI, "C: THE TAP AREA (DECLARED)", "RED"],   // a tap area in the flow would grow the line
  ["F21", [[PL, "    if (v.tone === \"grey\") return \"Blocked in some countries \u2014 nobody here\";", "    if (v.tone === \"grey\") return \"Blocked somewhere\";"]],
    GI, "C: GREY", "RED"],   // not the approved words
  ["F22", [[PL, "    el.onkeydown = (e) => { if (e && (e.key === \"Enter\" || e.key === \" \")) { e.preventDefault(); el.onclick(e); } };", "    el.onkeydown = null;"]],
    GI, "G: Enter on the globe opens it", "RED"],   // no keyboard
  // ── the pop-up's lines, its boxes, its names ──
  ["F29", [[PL, "        name.style.color = H.rankColor(H._rosterLevel(p.user));\n", ""]],
    GI, "F: NAMES AS EVERY NAME IN THE APP", "RED"],
  ["F30", [[PL, "          name.onclick = () => { _geoClose(); if (typeof card === \"function\") card(); };", "          name.onclick = () => { if (typeof card === \"function\") card(); };"]],
    GI, "F: CLICKING A NAME CLOSES THE POP-UP FIRST", "RED"],   // the card opens under a pop-up left open
  // ── one at a time, and closing ──
  ["F31", [[PL, "  function _geoOpen(icon, vid) {\n    _geoClose();", "  function _geoOpen(icon, vid) {"]],
    GI, "G: ONE AT A TIME", "RED"],
  ["F33", [[PL, "      _geoClose();\n      try { icon.focus(); } catch (x) {}", "      _geoClose();"]],
    GI, "G: ESCAPE CLOSES IT and puts the focus back", "RED"],
  // ── redrawn in place ──
  ["F40", [[PL, "      const g = rowEl.querySelector(\".sr-geo\"); if (g) _geoDraw(g, vid);\n", ""]],
    GI, "I: A LOOKUP'S ANSWER REDRAWS THE ROW'S GLOBE", "RED"],
  ["F41", [[PL, "    _geoRefill(vid);\n  }\n  // The per-row work", "  }\n  // The per-row work"]],
    GI, "I: and its open pop-up, where it stands", "RED"],
  ["F42", [[PL, "    if (sig === _geoSig) return;\n", ""]],
    GI, "I: THE SAME COUNTRIES AGAIN DRAW NOTHING", "RED"],
  ["F43", [[PL, "    if (_geoMenu) _geoRefill(_geoMenu.vid);\n  }", "  }"]],
    GI, "I: and the open pop-up redrawn where it stands, still open", "RED"],
  ["F44", [[SC, "    if (Room.onPeopleViewChange) Room.onPeopleViewChange(PlaylistPanels.geoChanged);\n", ""]],
    GI, "I: WIRED", "RED"],   // REP's countries move and no globe hears it
  // ── every person's report in the log ──
  ["F45", [[MBL, "      Logger && Logger.info && Logger.info(\n        \"MediaBlocked: report from \"", "      Logger && Logger.debug && Logger.debug(\n        \"MediaBlocked: report from \""]],
    "check-blocked-reports", "E: a person's first report for a playing is said once", "RED"],   // not at info: off the Copy log
  ["F46", [[MBL, "((typeof k === \"string\" && k) ? k : \"no reason\")", "((typeof k === \"string\" && k) ? k : \"\")"]],
    "check-blocked-reports", "E: each person's first report per playing", "RED"],   // a report naming no reason says nothing of it
  // ── CONTROLS: nothing that matters changes ──
  ["FG1", [[PL, "  // Draw (or clear) one row's globe from what this session holds now.", "  // Draw or clear one row's globe, from what this session holds now."]],
    GI, "", "GREEN"],   // a comment reworded
  ["FG2", [[RR, "  // What the summary and its additions say, as `RepRules.publishedCountries` reads them; a plain copy each time asked.",
                "  // What the summary and its additions say, as `RepRules.publishedCountries` reads them: a plain copy, each time asked."]],
    RDR, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-f:" + id, file);   // journalled BEFORE the write
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
