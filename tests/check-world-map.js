// tests/check-world-map.js
// SUBJECT: core/worldmap.js
//
// WALL: REGION BLOCKS' MAP IS THE WORLD'S COUNTRIES, NAMED BY THE COUNTRY TABLE (J153, `ddjp_729`; the owner's words in
// `main/01-project.md` item 9: "a map of earth with countries in green or red ... it also says what country it is as you put
// your mouse over them"). `core/worldmap.js` holds Natural Earth's 1:110m shapes, projected once and kept as SVG paths in whole
// units, each named by the country table's code (`core/countries.js`) — the map paints a country by that code, so a code that
// is not the table's, or one shape claiming another's code, paints the wrong country with nothing saying so.
//
//   A  THE FRAME: 960 × 423, as the approved design page drew it; at least 170 shapes, a copy each time asked.
//   B  EVERY SHAPE'S CODE IS THE TABLE'S, OR EMPTY WITH A NAME: no code twice; no Antarctica (the map is shorter without it); the
//      three Natural Earth draws with no code the table knows — Northern Cyprus, Somaliland and Kosovo — empty, each with its name.
//   C  EVERY SHAPE IS A PATH OF WHOLE NUMBERS INSIDE THE FRAME: moves, lines and closes only; no decimals (the data is whole
//      units, so no map library runs and the file stays small).
//   D  THE HEADER SAYS WHERE IT CAME FROM (TEXTUAL, and it says so): the source, its version, the projection, and how to make
//      it again — read as words; whether those words are true is the report's measurement, not this guard's.
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[world-map] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 500) : "")); }
  return !!c;
}
const FILE = "core/worldmap.js";
// A tree without the map refuses by name: nothing below could be read.
if (!fs.existsSync(path.join(ROOT, FILE))) {
  console.log("[world-map] FAIL — PREMISE — `" + FILE + "` is not in this tree: Region Blocks' map has no shapes");
  process.exit(1);
}
const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");
const { WorldMap, Countries } = loadInContext(["core/countries.js", FILE], {});
ok(!!WorldMap && typeof WorldMap.paths === "function", "PREMISE — `WorldMap.paths` loads from " + FILE);
const shapes = WorldMap && WorldMap.paths ? WorldMap.paths() : [];
const table = Countries ? Countries.codes() : [];
ok(table.length > 200, "PREMISE — the country table loads (" + table.length + " codes)", table.length);

// ═══ A — THE FRAME ═══
ok(WorldMap && WorldMap.W === 960 && WorldMap.H === 423, "A: THE FRAME IS 960 × 423, as the design page drew it", WorldMap && [WorldMap.W, WorldMap.H]);
ok(shapes.length >= 170, "A: AT LEAST 170 SHAPES — the world's countries at this scale", shapes.length);
if (shapes.length) { shapes[0].code = "ZZ"; ok(WorldMap.paths()[0].code !== "ZZ", "A: a copy each time asked — a caller's change does not reach the next"); }

// ═══ B — THE CODES ═══
const again = WorldMap ? WorldMap.paths() : [];
const known = {}; for (const c of table) known[c] = true;
const notTable = again.filter((s) => s.code && !known[s.code]).map((s) => s.code);
ok(notTable.length === 0, "B: EVERY CODE IS THE COUNTRY TABLE'S (or empty)", notTable);
const seen = {}, twice = [];
for (const s of again) { if (!s.code) continue; if (seen[s.code]) twice.push(s.code); seen[s.code] = true; }
ok(twice.length === 0, "B: NO CODE TWICE — one shape per country, so none paints another's", twice);
ok(!seen.AQ, "B: NO ANTARCTICA — left out, so the map is shorter", !!seen.AQ);
const empty = again.filter((s) => !s.code);
ok(JSON.stringify(empty.map((s) => s.name).sort()) === JSON.stringify(["Kosovo", "N. Cyprus", "Somaliland"]) && empty.every((s) => typeof s.name === "string" && s.name),
  "B: THE THREE WITH NO CODE THE TABLE KNOWS (Northern Cyprus, Somaliland, Kosovo) are empty, each with its own name for the tip", empty.map((s) => s.name));
ok(again.filter((s) => s.code).every((s) => s.name === null), "B: a shape with a code carries no name of its own — the table names it", again.filter((s) => s.code && s.name).length);
ok(!!seen.FR && !seen.GF, "B: FRENCH GUIANA IS PART OF FRANCE'S SHAPE at this scale (the docs say so): France drawn, no shape of its own", [!!seen.FR, !!seen.GF]);

// ═══ C — WHOLE NUMBERS INSIDE THE FRAME ═══
const badShape = [], outside = [];
for (const s of again) {
  if (typeof s.d !== "string" || !/^(?:[MLZ]|-?\d+|,)+$/.test(s.d) || !/^M/.test(s.d)) { badShape.push(s.code || s.name); continue; }
  for (const m of s.d.matchAll(/(-?\d+),(-?\d+)/g)) {
    const x = Number(m[1]), y = Number(m[2]);
    if (x < 0 || x > WorldMap.W || y < 0 || y > WorldMap.H) { outside.push([s.code || s.name, x, y]); break; }
  }
}
ok(again.length > 0 && badShape.length === 0, "C: EVERY SHAPE A PATH OF WHOLE NUMBERS — moves, lines and closes only, no decimals", badShape.slice(0, 5));
ok(outside.length === 0, "C: EVERY POINT INSIDE THE FRAME", outside.slice(0, 5));
// CONTROL: the matcher reads a known shape — France's path has points, and a made-up decimal would be refused.
const fr = again.find((s) => s.code === "FR");
ok(fr && (fr.d.match(/(-?\d+),(-?\d+)/g) || []).length > 10 && !/^(?:[MLZ]|-?\d+|,)+$/.test("M1.5,2L3,4Z"), "C: CONTROL — the reading finds France's points, and would refuse a decimal");

// ═══ D — THE HEADER (TEXTUAL) ═══
const header = src.slice(0, src.indexOf("const WorldMap"));
const said = { "Natural Earth": /Natural Earth/, "1:110m": /1:110m/, "world-atlas 2.0.2": /world-atlas[^\n]*\n?[^\n]*2\.0\.2/, "countries-110m.json": /countries-110m\.json/,
  "geoNaturalEarth1": /geoNaturalEarth1/, "how to make it again": /HOW TO MAKE IT AGAIN/, "French Guiana": /French Guiana/ };
const missing = Object.keys(said).filter((k) => !said[k].test(header));
ok(missing.length === 0, "D: THE HEADER SAYS WHERE IT CAME FROM — the source, its version, the projection, French Guiana, and how to make it again (TEXTUAL)", missing);

if (failed) { console.log("[world-map] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[world-map] PASS — Region Blocks' map is the world's countries named by the country table (`ddjp_729`; " + asserts + " assertions): " +
  "960 × 423, " + again.length + " shapes, a copy each time; every code the table's or empty, none twice, no Antarctica, the three with no code " +
  "named; whole numbers inside the frame; the header names its source, version and projection (textual)");
