// tools/probes/mutate-j153-i.js
// SUBJECT: J153's Region Blocks, at `ddjp_729` — THE GLOBE'S POP-UP AS THE OWNER REDESIGNED IT AFTER THE ITEM'S CLOSE: opened as
// the song preview is (its overlay and card, `_backdrop`, `_columnArea`, `PV_EDGE`), centred on the globe's column, never taller
// than 480 px, the lists giving up height down to three lines and then the card scrolling, placed again on a resize and a layout
// switch; its lines for every shape of answer, the words naming the song's service and the source from the song table, every
// country of the table listed once A to Z by the table's fold, "Outside YouTube" pinned and counted; the map (`core/worldmap.js`)
// green, red and grey with the people's countries outlined, its legend and its tip; each way it closes; the redraw in place;
// `Countries.blockedView`'s `blocked`; `MetadataService.heldGeo` handing back only a source the table names; the map's data.
// One row per thing the build does, each naming the failure it must cause; the controls change nothing that matters and must
// stay green.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j153-f.js`, unchanged.
//
//   node tools/probes/mutate-j153-i.js            every row
//   node tools/probes/mutate-j153-i.js I1 I5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PL = "ui/playlists.js";
const CT = "core/countries.js";
const MD = "features/metadata.js";
const SH = "ui/shell.js";
const SC = "ui/screens.js";
const IX = "index.html";
const WM = "core/worldmap.js";
const GI = "check-geo-icon";
const WMG = "check-world-map";
const PC = "check-preview-controls";

const ROWS = [
  // ── the one verdict's `blocked`, and the source handed back ──
  ["I1", [[CT, "    out.blocked = _all.map((c) => c.code).filter(leftOut);\n", ""]],
    GI, "A: `blocked` — EVERY COUNTRY THE ANSWER LEAVES OUT", "RED"],   // the map and the Blocked list have nothing to read
  ["I2", [[MD, "      if (_sources.some((x) => x.short === sh && x.id === rec.geo.source)) geo.source = rec.geo.source;", "      geo.source = rec.geo.source;"]],
    GI, "K: AND NOTHING ELSE DOES", "RED"],   // whatever the store holds is named as a source
  ["I3", [[MD, "      if (_sources.some((x) => x.short === sh && x.id === rec.geo.source)) geo.source = rec.geo.source;\n", ""]],
    GI, "K: A SOURCE IN THE SONG TABLE COMES BACK", "RED"],   // the source never named
  // ── the lines ──
  ["I4", [[PL, "everyone ? \"Blocked for everyone here\" : (n ? ", "(n ? "]],
    GI, "D: CAN'T PLAY OUTSIDE ITS SERVICE, no country limit", "RED"],   // nobody here can play it, said as nobody blocked
  ["I5", [[PL, "    if (everyone) blocked.push(H.el(\"div\", { class: \"pin\", text: \"Outside \" + svc }));\n", ""]],
    GI, "D: CAN'T PLAY OUTSIDE ITS SERVICE, no country limit", "RED"],   // the reason it is red, missing from the list
  ["I6", [[PL, "text: word + \" · \" + rows.length }", "text: word + \" · \" + rows.filter((r) => r.className !== \"pin\").length }"]],
    GI, "D: CAN'T PLAY OUTSIDE ITS SERVICE, no country limit", "RED"],   // pinned and not counted
  ["I7", [[PL, "    for (const r of _geoSorted()) {", "    for (const r of _geoSorted().slice(1)) {"]],
    GI, "D: EVERY COUNTRY OF THE TABLE LISTED, EACH ONCE", "RED"],   // a country listed nowhere
  ["I8", [[PL, "key: Countries.fold(_geoCountryName(c)) }));", "key: _geoCountryName(c) }));"]],
    GI, "D: A TO Z BY NAME as the table folds names", "RED"],   // "Åland Islands" after "Zimbabwe"
  ["I9", [[PL, "blocked.push(H.el(\"div\", { class: \"here\", text: label", "blocked.push(H.el(\"div\", { text: label"]],
    GI, "D: Blocked, A to Z — a country where people here are says who", "RED"],   // not the brighter red
  ["I10", [[PL, "src = s ? s.name : \"\";", "src = s ? s.id : \"\";"]],
    GI, "D: \"Region Blocks · checked 3 days ago (ProxyNova)\"", "RED"],   // the provider's id, not the table's name
  ["I11", [[PL, "    if (!ago) return \"\";\n", ""]],
    GI, "D: NO TIME SAVED", "RED"],   // "checked" with no time
  ["I12", [[PL, "(v.embeddable === true ? \"Allowed outside \" + svc : ", "(v.embeddable !== false ? \"Allowed outside \" + svc : "]],
    GI, "D: GREY — blocked somewhere, nobody here, the source not saying", "RED"],   // "not known" said as allowed
  ["I13", [[PL, "const r = Songs.services().find((y) => y.short === sh); return r ? r.name : \"\";", "const r = Songs.services().find((y) => y.short === sh); return r ? r.short : \"\";"]],
    GI, "D: \"Allowed outside YouTube\", not red", "RED"],   // the service's short code, not its name
  ["I14", [[PL, "return v.people.length ? \"Blocked for someone here\" : \"Not allowed outside \" + _geoService(vid);", "return v.people.length ? \"Blocked for someone here\" : \"Not allowed outside it\";"]],
    GI, "C: NOT ALLOWED OUTSIDE YOUTUBE", "RED"],   // the icon's words not his, not from the table
  // ── where it opens ──
  ["I15", [[PL, "const w = Math.max(0, Math.round(a.width - 2 * PV_EDGE))", "const w = Math.max(0, Math.round(a.width - PV_EDGE))"]],
    GI, "E: CENTRED ON ITS COLUMN, 14 PX IN", "RED"],
  ["I16", [[PL, "  const RB_MAX_H = 480;", "  const RB_MAX_H = 520;"]],
    GI, "E: CENTRED ON ITS COLUMN, 14 PX IN", "RED"],   // taller than the owner's
  ["I17", [[PL, "    if (m.el.scrollHeight > m.el.clientHeight + 1) m.el.classList.add(\"rb-scrolls\");\n", ""]],
    GI, "E: TOO SHORT EVEN WITH THE LISTS AT THREE LINES", "RED"],   // a short tab cuts the card off
  ["I18", [[PL, "    window.addEventListener(\"resize\", _geoMenu.onResize);\n", ""]],
    GI, "E: PLACED AGAIN ON A RESIZE", "RED"],
  ["I19", [[SH, "    if (PlaylistPanels.regionBlocksOpen()) PlaylistPanels._geoPlace();", "    if (false) PlaylistPanels._geoPlace();"]],
    GI, "E: PLACED AGAIN ON A LAYOUT SWITCH", "RED"],
  ["I20", [[PL, "    return (r && r.width > 40 && r.height > 40)", "    return (r)"]],
    GI, "E: A COLUMN WITH NO BOX", "RED"],   // the shared area: a hidden column's empty box
  ["I21", [[PL, "{ class: \"preview-card rb-card\", role: \"dialog\"", "{ class: \"rb-card\", role: \"dialog\""]],
    GI, "E: THE PREVIEW'S OWN OVERLAY AND CARD", "RED"],   // not the preview's card
  ["I22", [[IX, ".rb-lists { flex: 1 1 auto; min-height: 84px;", ".rb-lists { flex: 1 1 auto; min-height: 0;"]],
    GI, "E: ONLY THE LISTS GIVE UP HEIGHT, DOWN TO THREE LINES", "RED"],   // lists squeezed to nothing
  ["I23", [[IX, ".rb-map svg { display: block; width: 100%; height: auto; max-height: 146px; }", ".rb-map svg { display: block; width: 100%; height: auto; }"]],
    GI, "E: THE REST STAYS ITS SIZE", "RED"],   // the map grows with a wide card and takes the lists' room
  ["I24", [[PL, "  const PV_EDGE = 14;", "  const PV_EDGE = 16;"]],
    GI, "E: CENTRED ON ITS COLUMN, 14 PX IN", "RED"],   // the shared edge moved: both cards with it
  // ── each way it closes ──
  ["I25", [[PL, "\"aria-label\": \"Close\", onclick: _geoClose });", "\"aria-label\": \"Close\" });"]],
    GI, "G: ITS ✕ CLOSES IT", "RED"],
  ["I26", [[PL, "overlay: _backdrop(el, _geoClose),", "overlay: _backdrop(el, () => {}),"]],
    GI, "G: A CLICK THAT BEGAN ON THE OVERLAY CLOSES IT", "RED"],
  ["I27", [[PL, "      const outside = !!e && e.target === overlay && pressedOutside;", "      const outside = !!e && e.target === overlay;"]],
    GI, "G: a press inside the card, let go over the overlay, leaves it open", "RED"],   // the shared rule, for Region Blocks too
  ["I28", [[PL, "      if (!_geoMenu || !e || e.key !== \"Escape\") return;", "      if (true) return;"]],
    GI, "G: ESCAPE CLOSES IT", "RED"],
  ["I29", [[PL, "    if (m.onKey) document.removeEventListener(\"keydown\", m.onKey);\n", ""]],
    GI, "G: CLOSED, IT LETS GO", "RED"],   // every close leaves a listener behind
  ["I30", [[SC, "    if (PlaylistPanels.regionBlocksOpen()) PlaylistPanels._geoClose();", "    if (false) PlaylistPanels._geoClose();"]],
    GI, "G: A CHANGE OF SCREEN CLOSES IT", "RED"],   // left over the room list
  ["I31", [[PL, "      if (icon.isConnected === false) { _geoClose(); return; }", "      if (false) { _geoClose(); return; }"]],
    GI, "G: AND IT CLOSES WHEN ITS GLOBE LEAVES THE PAGE", "RED"],
  // ── the map, its legend, its tip ──
  ["I32", [[PL, "      s.tone = !s.code ? \"none\" : (bad[s.code] ? \"bad\" : \"ok\");", "      s.tone = !s.code ? \"none\" : \"ok\";"]],
    GI, "H: GREEN WHERE ALLOWED, RED WHERE BLOCKED", "RED"],   // a map all green
  ["I33", [[PL, "      if (s.here) rings.push(p); else svg.appendChild(p);", "      svg.appendChild(p);"]],
    GI, "H: THE COUNTRIES OF PEOPLE HERE OUTLINED", "RED"],   // the outline drawn under its neighbours
  ["I34", [[PL, "[\"none\", \"No data\"], ", ""]],
    GI, "H: THE LEGEND", "RED"],
  ["I35", [[IX, ".rb-key.ok { background: var(--rb-ok); }", ".rb-key.ok { background: #2f9e5b; }"]],
    GI, "H: EACH COLOUR SAID ONCE", "RED"],   // a second copy of the map's green
  ["I36", [[PL, "      if (s.here) kids.push(H.el(\"div\", { class: \"who\", text: \"Blocked for \" + whoIn[s.code].join(\", \") }));\n", ""]],
    GI, "T: POINTING AT A COUNTRY", "RED"],   // the tip never says who
  ["I37", [[PL, "s.tone === \"none\" ? \"No data for this country\"", "s.tone === \"none\" ? \"No data\""]],
    GI, "T: a shape with no country in the table", "RED"],
  ["I38", [[PL, "      if (!s) { hide(); return; }", "      if (!s) return;"]],
    GI, "T: OFF A COUNTRY", "RED"],   // a tip left naming the last country over the sea
  ["I39", [[PL, "    svg.addEventListener(\"click\", show);\n", ""]],
    GI, "T: A TAP SHOWS IT TOO", "RED"],   // a phone never sees a name
  ["I40", [[PL, "    map.addEventListener(\"mouseleave\", hide);\n", ""]],
    GI, "T: LEAVING THE MAP", "RED"],
  // ── redrawn in place ──
  ["I41", [[PL, "    _geoFill(_geoMenu.el, vid);\n    _geoPlace();\n  }", "    _geoPlace();\n  }"]],
    GI, "I: and its open pop-up, where it stands", "RED"],   // an open card left on the old answer
  // ── the map's data ──
  ["I42", [[WM, "    [\"FJ\", \"M950,", "    [\"AQ\", \"M950,"]],
    WMG, "B: NO ANTARCTICA", "RED"],
  ["I43", [[WM, "    [\"FJ\", \"M950,", "    [\"TZ\", \"M950,"]],
    WMG, "B: NO CODE TWICE", "RED"],   // Tanzania's code on Fiji's shape too
  ["I44", [[WM, "    [\"FJ\", \"M950,", "    [\"ZZ\", \"M950,"]],
    WMG, "B: EVERY CODE IS THE COUNTRY TABLE'S", "RED"],
  ["I45", [[WM, "    [\"FJ\", \"M950,", "    [\"FJ\", \"M950.5,"]],
    WMG, "C: EVERY SHAPE A PATH OF WHOLE NUMBERS", "RED"],
  ["I46", [[WM, "  const W = 960, H = 423;", "  const W = 960, H = 424;"]],
    WMG, "A: THE FRAME IS 960 × 423", "RED"],
  // ── the preview, sharing the area ──
  ["I47", [[PL, "    const area = _columnArea(_previewColumn);", "    const area = _columnArea(null);"]],
    PC, "THE WHOLE CARD FITS THE COLUMN, 14 px inside it", "RED"],   // the preview no longer over its row's column
  // ── CONTROLS: nothing that matters changes ──
  ["IG1", [[PL, "  // The open card's song has a new answer, or REP's countries moved: its lines redrawn where it stands.",
                "  // The open card's song has a new answer, or REP's countries moved: its lines are redrawn where it stands."]],
    GI, "", "GREEN"],   // a comment reworded
  ["IG2", [[WM, "// Pure data: no dependencies, no I/O, no clock. Loaded with the page, as the country table is.",
                "// Pure data: no dependencies, no I/O and no clock. Loaded with the page, as the country table is."]],
    WMG, "", "GREEN"],   // a comment reworded
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
      const h = J.open("mutate-j153-i:" + id, file);   // journalled BEFORE the write
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
