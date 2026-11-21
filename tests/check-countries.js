// tests/check-countries.js
// SUBJECT: core/countries.js
//
// WALL: ONE TABLE OF COUNTRIES, AND ONE READING OF A TYPED COUNTRY (J153 (b), the owner's plan, `main/01-project.md` item 9).
// `!setcountry` reads what a person types through `Countries.read`, and REP's messages carry only the codes this table
// holds, so a row wrong here is a country wrong on every screen, and two readings would let one typed word mean two
// countries. Loaded in an EMPTY sandbox, as the page loads it: no app global, no `Intl` reached for.
//
//   A  PURE: the file loads in a sandbox holding nothing, and names no `Intl`, no locale-dependent call and no clock — a
//      browser's own country names differ between browsers, so a parse built on them would differ too.
//   B  THE TABLE: every code is two capital letters, every number a whole number from 1 to 999, and codes, numbers and
//      folded names (aliases included) are each unique across the table; no name or alias folds to a two-letter code (a
//      code always wins, so such a name could never be typed); rows run A to Z; Kosovo (`XK`, not ISO 3166-1) is absent.
//      Known rows, as controls: France 250, the two Congos, the United Kingdom, the United States.
//   C  AMBIGUOUS NAMES ARE REFUSED BY THEIR OWN REASON, NEVER GUESSED: each is no country's name or alias, names at least two
//      countries that exist, and reads as "ambiguous" with them. A name that is one country's exact short name is that
//      country: "Congo" is the Republic of the Congo; "DR Congo", "DRC" and "Congo-Kinshasa" are the other.
//   D  EACH FORM: a name in any case, accents and punctuation folded, "St" as "Saint", "&" as "and", a leading "The"
//      dropped; a code in either case; a number with or without its leading zeros; "UK" read as a name, since it is no code;
//      junk, an empty string and a non-string read "unknown" and never throw; `parse` is `read`'s country or null.
//   E  THE WHOLE TABLE ROUND-TRIPS: every row's name, each alias, its code and its number (bare and three digits) read back
//      to that row.
//   F  WHERE A SONG MAY PLAY, AS COUNTRIES (`regionList`, J153 (c)): the one rule both song-metadata boundaries call. Codes
//      are checked against this table (`EU`, `ZZ`, lower case and junk dropped, repeats once); the SHORTER form is kept, both
//      ways — a long blocked list becomes the allowed rest and a long allowed list the blocked rest; an EMPTY allowed list
//      stays allowed-nowhere, never no-restriction; every list of the whole table becomes no restriction; exactly one list
//      (both, neither, or a list that is no array reads null); the answer runs A to Z, the same for any input order.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const FILE = "core/countries.js";

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[countries] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// ── A — PURE ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const exists = fs.existsSync(path.join(ROOT, FILE));
ok(exists, "A: `" + FILE + "` exists — the one home of the country table");
if (!exists) { console.log("[countries] 1 failure(s) of " + asserts + " assertions"); process.exit(1); }
const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");
let C = null;
try { const ctx = vm.createContext({}); vm.runInContext(src + "\n;this.C = Countries;", ctx, { filename: FILE }); C = ctx.C; } catch (e) { C = null; }
ok(!!C && ["read", "parse", "byCode", "codes", "rows", "ambiguous", "fold"].every((f) => typeof C[f] === "function"),
  "A: it loads in a sandbox holding no app global, and answers `read`, `parse`, `byCode`, `codes`, `rows`, `ambiguous`, `fold`");
if (!C) { console.log("[countries] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
const code = src.replace(/\/\/[^\n]*/g, "");   // the code, its comments off (the header names Intl to say why it is not used)
ok(!/\bIntl\b|toLocale|localeCompare|Date\b|Math\.random/.test(code), "A: it names no `Intl`, no locale-dependent call, no clock");
ok(/Intl\.DisplayNames/.test(src), "A: APPLIED — the scan reads this file (its header names `Intl.DisplayNames`, and the scan is of the code alone)");

// ── B — THE TABLE ───────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = C.rows();
ok(Array.isArray(rows) && rows.length > 200, "B PREMISE — the table holds the world's countries, not a sample", rows && rows.length);
const badCode = rows.filter((r) => !/^[A-Z]{2}$/.test(r.code)).map((r) => r.code);
ok(badCode.length === 0, "B: every code is two capital letters", badCode);
const badNum = rows.filter((r) => !(Number.isSafeInteger(r.num) && r.num >= 1 && r.num <= 999)).map((r) => r.code);
ok(badNum.length === 0, "B: every number is a whole number from 1 to 999", badNum);
const dupOf = (list) => list.filter((x, i) => list.indexOf(x) !== i);
ok(dupOf(rows.map((r) => r.code)).length === 0, "B: the codes are unique", dupOf(rows.map((r) => r.code)));
ok(dupOf(rows.map((r) => r.num)).length === 0, "B: the numbers are unique", dupOf(rows.map((r) => r.num)));
const owner = Object.create(null), clash = [], asCode = [];
for (const r of rows) {
  for (const n of [r.name].concat(r.aliases)) {
    const k = C.fold(n);
    if (!k) clash.push(r.code + ": \"" + n + "\" folds to nothing");
    else if (owner[k] && owner[k] !== r.code) clash.push(k + ": " + owner[k] + " and " + r.code);
    owner[k] = r.code;
    if (/^[a-z]{2}$/.test(k) && C.byCode(k)) asCode.push(r.code + ": \"" + n + "\" is the code " + k.toUpperCase());
  }
}
ok(clash.length === 0, "B: names and aliases, folded, are unique across the table — one typed name, one country", clash);
ok(asCode.length === 0, "B: no name or alias folds to a two-letter code, which would win over it", asCode);
ok(rows.every((r, i) => i === 0 || rows[i - 1].code < r.code), "B: the rows run A to Z by code");
ok(!C.byCode("XK") && !C.parse("Kosovo"), "B: Kosovo (`XK`) is absent — it is not in ISO 3166-1");
const fr = C.byCode("FR"), cd = C.byCode("CD"), cg = C.byCode("CG"), gb = C.byCode("GB"), us = C.byCode("US");
ok(fr && fr.num === 250 && fr.name === "France" && cd && cd.num === 180 && cg && cg.num === 178 && cg.name === "Congo" &&
   gb && gb.num === 826 && gb.name === "United Kingdom" && us && us.num === 840 && us.name === "United States",
  "B CONTROL — known rows: France 250, DR Congo 180, Congo 178, the United Kingdom 826, the United States 840", { fr, cd, cg, gb, us });
ok(JSON.stringify(C.codes()) === JSON.stringify(rows.map((r) => r.code)), "B: `codes` is the table's codes, A to Z");

// ── C — AMBIGUOUS NAMES ─────────────────────────────────────────────────────────────────────────────────────────────────
const amb = C.ambiguous();
ok(Array.isArray(amb) && amb.length >= 1 && amb.some((a) => a.name === "Korea"), "C PREMISE — the list of ambiguous names holds \"Korea\"", amb);
for (const a of amb) {
  const k = C.fold(a.name);
  ok(!owner[k], "C: \"" + a.name + "\" is no country's name or alias — or the table would answer it", owner[k]);
  ok(Array.isArray(a.could) && a.could.length >= 2 && a.could.every((c) => !!C.byCode(c)), "C: \"" + a.name + "\" names at least two countries that exist", a.could);
  for (const typed of [a.name, a.name.toLowerCase(), a.name.toUpperCase()]) {
    const r = C.read(typed);
    ok(r && r.ok === false && r.why === "ambiguous" && JSON.stringify(r.could) === JSON.stringify(a.could) && C.parse(typed) === null,
      "C: \"" + typed + "\" reads as ambiguous, naming " + a.could.join(" and ") + " — never a guess", r);
  }
}
ok(C.read("Korea").why === "ambiguous" && C.read("South Korea").country.code === "KR" && C.read("North Korea").country.code === "KP",
  "C: \"Korea\" is ambiguous; \"South Korea\" and \"North Korea\" are each one country");
ok(C.parse("Congo") && C.parse("Congo").code === "CG" && ["DR Congo", "DRC", "Congo-Kinshasa", "drc"].every((t) => C.parse(t) && C.parse(t).code === "CD"),
  "C: \"Congo\" is the Republic of the Congo, ISO's own short name; \"DR Congo\", \"DRC\" and \"Congo-Kinshasa\" are the other");

// ── D — EACH FORM ───────────────────────────────────────────────────────────────────────────────────────────────────────
const is = (typed, want) => { const r = C.read(typed); ok(r && r.ok === true && r.country.code === want && C.parse(typed).code === want, "D: \"" + typed + "\" is " + want, r); };
for (const t of ["france", "France", "FRANCE", "  France  "]) is(t, "FR");      // a name, in any case
for (const t of ["fr", "FR", "Fr"]) is(t, "FR");                                 // a code, in either case
for (const t of ["250", "4", "04", "004"]) is(t, t === "250" ? "FR" : "AF");     // a number, its leading zeros or not
is("cote divoire", "CI"); is("Côte d’Ivoire", "CI"); is("COTE D'IVOIRE", "CI");   // accents and punctuation folded
is("St. Lucia", "LC"); is("Saint Kitts & Nevis", "KN"); is("st kitts and nevis", "KN"); // "St" as "Saint", "&" as "and"
is("The Gambia", "GM"); is("gambia", "GM");                                      // a leading "The" dropped
is("UK", "GB"); is("uk", "GB");                                                  // no code, so a name: an alias
is("Turkey", "TR"); is("Türkiye", "TR"); is("Iran, Islamic Republic of", "IR"); is("Iran", "IR");   // aliases and ISO's own form
for (const t of ["xx", "999", "0", "none", "", "   ", "!!", "Atlantis"]) {
  const r = C.read(t);
  ok(r && r.ok === false && r.why === "unknown" && C.parse(t) === null, "D: \"" + t + "\" reads unknown", r);
}
let threw = null;
try { for (const t of [null, undefined, 42, {}, []]) { const r = C.read(t); if (!r || r.ok !== false || r.why !== "unknown") threw = "answered " + JSON.stringify(r); if (C.parse(t) !== null || C.byCode(t) !== null) threw = "a non-string read as a country"; } } catch (e) { threw = e.message; }
ok(threw === null, "D: a non-string reads unknown and never throws", threw);
ok(C.byCode("fr") === C.byCode("FR") && C.byCode("FRA") === null && C.byCode("ZZ") === null, "D: `byCode` takes two letters in either case, and nothing else");

// ── E — THE WHOLE TABLE ROUND-TRIPS ─────────────────────────────────────────────────────────────────────────────────────
const lost = [];
for (const r of rows) {
  for (const t of [r.name, r.code, r.code.toLowerCase(), String(r.num), String(r.num).padStart(3, "0")].concat(r.aliases)) {
    const got = C.parse(t);
    if (!got || got.code !== r.code) lost.push(t + " -> " + (got ? got.code : "nothing") + " (want " + r.code + ")");
  }
}
ok(lost.length === 0, "E: every row's name, alias, code (either case) and number (bare and three digits) reads back to that row", lost.slice(0, 12));

// ── F — WHERE A SONG MAY PLAY, AS COUNTRIES (J153 (c)) ──────────────────────────────────────────────────────────────────
const RL = (typeof C.regionList === "function") ? C.regionList : null;
ok(!!RL, "F PREMISE — `regionList` exists: the one rule both song-metadata boundaries call (J153 (c))");
if (RL) {
  const all = C.codes(), N = all.length;
  const J = (x) => JSON.stringify(x);
  // the codes, checked against the table: EU and ZZ (ProxyNova answers both), lower case, junk and repeats
  ok(J(RL({ blocked: ["DE", "EU", "ZZ", "fr", "FR", "FR", 7, null, "FRANCE"] })) === J({ blocked: ["DE", "FR"] }),
    "F: a blocked list keeps only the table's codes, each once (EU, ZZ, lower case, junk and repeats dropped)",
    RL({ blocked: ["DE", "EU", "ZZ", "fr", "FR", "FR", 7, null, "FRANCE"] }));
  // the shorter form, both ways
  const most = all.filter((c) => c !== "DE" && c !== "FR");
  ok(J(RL({ blocked: most })) === J({ allowed: ["DE", "FR"] }), "F: a blocked list longer than the rest is kept as the allowed rest", RL({ blocked: most }));
  ok(J(RL({ allowed: most })) === J({ blocked: ["DE", "FR"] }), "F: an allowed list longer than the rest is kept as the blocked rest", RL({ allowed: most }));
  ok(J(RL({ allowed: ["FR", "DE"] })) === J({ allowed: ["DE", "FR"] }), "F: a short allowed list stays allowed, A to Z", RL({ allowed: ["FR", "DE"] }));
  // allowed nowhere is not no restriction
  ok(J(RL({ allowed: [] })) === J({ allowed: [] }), "F: an EMPTY allowed list stays allowed-nowhere (YouTube's own meaning), never no restriction", RL({ allowed: [] }));
  ok(J(RL({ allowed: ["EU", "ZZ"] })) === J({ allowed: [] }), "F: an allowed list of no country is allowed nowhere", RL({ allowed: ["EU", "ZZ"] }));
  ok(J(RL({ blocked: [] })) === J({ blocked: [] }), "F: an empty blocked list is no restriction", RL({ blocked: [] }));
  ok(J(RL({ allowed: all })) === J({ blocked: [] }), "F: allowed in every country is no restriction", RL({ allowed: all }));
  ok(J(RL({ blocked: all })) === J({ allowed: [] }), "F: blocked in every country is allowed nowhere", RL({ blocked: all }));
  // exactly one list
  for (const bad of [{ allowed: ["DE"], blocked: ["FR"] }, {}, { blocked: "DE" }, { allowed: null }, null, "DE", 7]) {
    ok(RL(bad) === null, "F: exactly one list, an array — " + J(bad) + " reads null", RL(bad));
  }
  // deterministic: any order, the same answer
  const shuffled = most.slice().reverse();
  ok(J(RL({ blocked: shuffled })) === J(RL({ blocked: most })), "F: the answer does not depend on the order the codes came in");
  // (No tie row: the table holds an odd number of countries, so no list can tie with its rest; a row for it could not fail.)
  ok(N > 200, "F PREMISE — the complement is taken over the whole table", N);
}

if (failed) { console.log("[countries] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[countries] PASS — one table of countries, and one reading of a typed country (J153 (b); " + asserts + " assertions, over " +
  rows.length + " rows). PURE: loaded in an empty sandbox, no Intl, no locale call, no clock. THE TABLE: codes, numbers and folded " +
  "names each unique, no name a code, A to Z, Kosovo absent, known rows as controls. AMBIGUOUS NAMES (\"Korea\") are refused by their " +
  "own reason, never guessed, and \"Congo\" is ISO's own Congo. EACH FORM reads: a name in any case with accents and punctuation " +
  "folded, a code either case, a number with or without its zeros; junk reads unknown and nothing throws. THE WHOLE TABLE " +
  "round-trips. WHERE A SONG MAY PLAY (regionList): codes checked against the table, the shorter form kept both ways, an empty " +
  "allowed list kept as allowed-nowhere, exactly one list. THIS GUARD CANNOT TELL YOU THE ROWS MATCH ISO TODAY — they were taken from the ISO list at J153 and are held here as written");
