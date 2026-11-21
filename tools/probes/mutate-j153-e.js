// tools/probes/mutate-j153-e.js
// SUBJECT: J153's (c), its data, at `ddjp_724` — WHERE A SONG IS BLOCKED: the country table's one rule for a list of where a
// song may play (`Countries.regionList`: the table's codes, the shorter form, an empty allowed list kept, exactly one list),
// called by both boundaries (the cache's `MetadataService.sanitize`, the file's `PlaylistDoc` import); the lookup path's stamps
// (`checkedAt`, `source`), its switch, its lists, its expiry from the device's setting, its first-lookup line and the short
// failure word; the three sources in the owner's order — YouTube's row of the song table (`core/songs.js` `regions`), built
// into providers by the lookup, which names no service (E51–E59, the supervisor's (A)) — their parsers, the key provider
// skipping itself, ProxyNova's daily stop, the counting by source and list, Invidious' servers in turn, the third parties'
// missing referrer, the key's form per service; the device's three
// settings and their card in the local Settings panel; only the songs on screen looked up, through the pump, for the list each
// row names; YouTube's data branch (101/150 by the loaded song's saved answer); the log's scrub of a key. One row per thing the
// build does, each naming the failure it must cause; the controls change nothing that matters and must stay green.
// E30 is a PAIR: load's clean-up of a stored expiry and the reader's check each hold the rule alone, so dropping one leaves the
// other (measured in the build); the row drops both. E55 is the same PAIR for a stored key: load's clean-up and the reader's
// check; load's clean-up alone also rebuilds a key map of the wrong shape (E56).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, the runner of `mutate-j151-room-services.js`, unchanged.
//
//   node tools/probes/mutate-j153-e.js            every row
//   node tools/probes/mutate-j153-e.js E1 E5      named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");

const ROWS = [
  ["E1", [["core/countries.js", "    return blocked.length <= allowed.length ? { blocked: blocked } : { allowed: allowed };", "    return hasB ? { blocked: blocked } : { allowed: allowed };"]],
    "check-countries", "F: a blocked list longer than the rest is kept as the allowed rest", "RED"],
  ["E2", [["core/countries.js", "    const named = Object.create(null);", "    if (hasA && r.allowed.length === 0) return { blocked: [] };\n    const named = Object.create(null);"]],
    "check-countries", "F: an EMPTY allowed list stays allowed-nowhere", "RED"],
  ["E3", [["core/countries.js", "    if (hasA === hasB) return null;", "    if (!hasA && !hasB) return null;"]],
    "check-countries", "F: exactly one list", "RED"],
  ["E4", [["features/metadata.js", "        list.checkedAt = (typeof raw.geo.checkedAt === \"number\" && isFinite(raw.geo.checkedAt)) ? raw.geo.checkedAt : 0;\n        out.geo = list;", "        list.checkedAt = (typeof raw.geo.checkedAt === \"number\" && isFinite(raw.geo.checkedAt)) ? raw.geo.checkedAt : 0;\n        if (typeof raw.geo.source === \"string\") list.source = raw.geo.source;\n        out.geo = list;"]],
    "check-metadata-service", "never reads a source from an answer", "RED"],
  ["E5", [["features/metadata.js", "        list.embeddable = (e === true || e === false) ? e : null;\n        list.checkedAt = (typeof raw.geo.checkedAt === \"number\"", "        list.embeddable = null;\n        list.checkedAt = (typeof raw.geo.checkedAt === \"number\""]],
    "check-metadata-service", "embeddable false is kept", "RED"],
  ["E6", [["features/metadata.js", "if (geo) { clean.geo.checkedAt = nowMs; clean.geo.source = String(p.id);", "if (geo) { clean.geo.source = String(p.id);"]],
    "check-metadata-service", "checkedAt is the lookup's own time", "RED"],
  ["E7", [["features/metadata.js", "if (geo) { clean.geo.checkedAt = nowMs; clean.geo.source = String(p.id);", "if (geo) { clean.geo.checkedAt = nowMs;"]],
    "check-metadata-service", "source is the provider that answered", "RED"],
  ["E8", [["features/metadata.js", "    if (want.indexOf(\"geo\") >= 0 && !(list && typeof nowMs === \"number\" && _geoOn())) want = want.filter((f) => f !== \"geo\");", "    if (want.indexOf(\"geo\") >= 0 && !(list && typeof nowMs === \"number\")) want = want.filter((f) => f !== \"geo\");"]],
    "check-metadata-service", "the device's switch OFF: nothing is looked up", "RED"],
  ["E9", [["features/metadata.js", "    if (want.indexOf(\"geo\") >= 0 && !(list && typeof nowMs === \"number\" && _geoOn())) want = want.filter((f) => f !== \"geo\");", "    if (want.indexOf(\"geo\") >= 0 && !(typeof nowMs === \"number\" && _geoOn())) want = want.filter((f) => f !== \"geo\");"]],
    "check-metadata-service", "no lookup for undefined", "RED"],
  ["E10", [["features/metadata.js", "    const ttl = _geoTtlMs();\n    return get(songKey).then((cached) => {", "    const ttl = 90 * DAY_MS;\n    return get(songKey).then((cached) => {"]],   // re-anchored at J153 (d), `ddjp_726`: `fetchMany` reads the expiry too; this is `ensure`'s
    "check-metadata-service", "at 365 days, a 100-day-old answer is kept", "RED"],
  ["E11", [["features/metadata.js", "      if (!(typeof ttlMs === \"number\" && ttlMs > 0)) return false;", "      if (!(typeof ttlMs === \"number\" && ttlMs > 0)) ttlMs = 90 * DAY_MS;"]],
    "check-metadata-service", "geo with NO TTL handed in -> stale", "RED"],
  ["E12", [["features/metadata.js", "    if (_firstGeoSaid || !tried.length) return;", "    if (!tried.length) return;"]],
    "check-metadata-service", "no second first-lookup line", "RED"],
  ["E13", [["features/metadata.js", "((e && /^(HTTP \\S{1,8}|timed out|network error)$/.test(e.message)) ? e.message : \"failed\")", "((e && e.message) || \"failed\")"]],
    "check-metadata-service", "an error's own text — an address, a key — never does", "RED"],
  ["E14", [["features/metadata.js", "      throw new Error((e && e.name === \"AbortError\") ? \"timed out\" : (own || \"network error\"));", "      throw e;"]],
    "check-geo-sources", "E: an error whose text holds the address logs only", "RED"],
  ["E15", [["features/metadata.js", "  for (let i = _sources.length - 1; i >= 0; i--) registerProvider(_regionProvider(_sources[i]));", "  for (let i = 0; i < _sources.length; i++) registerProvider(_regionProvider(_sources[i]));"]],
    "check-geo-sources", "B: the sources in the owner's order", "RED"],
  // E16's expected text MOVED at J153 (d)'s second half (`ddjp_727`, the supervisor's approval): the device's order now puts the
  // first READY source first (`Songs.regionOrder`), so with no key ProxyNova leads whatever `ready` says, and B's world never
  // reaches YouTube. The mutation still means "YouTube asked with no key"; C's line, every source refusing in turn, shows it.
  ["E16", [["features/metadata.js", "      ready: (songKey) => !!idOf(songKey) && (!src.key || !!_apiKey(src.short)),", "      ready: (songKey) => !!idOf(songKey),"]],
    "check-geo-sources", "C: and the line says each refused", "RED"],
  ["E17", [["features/metadata.js", "      id: src.id, name: src.name, fields: [\"geo\"], dailyIds: src.dailyIds,", "      id: src.id, name: src.name, fields: [\"geo\"],"]],
    "check-geo-sources", "D: at 900 songs today ProxyNova is skipped", "RED"],
  ["E18", [["features/metadata.js", "        _count(p, list, 1, nowMs);\n", ""]],
    "check-geo-sources", "D: each call counted by the list that asked", "RED"],
  ["E19", [["features/metadata.js", "r.hour > hour - span && r.hour <= hour", "r.hour > hour - 1000 && r.hour <= hour"]],
    "check-geo-sources", "D: songs asked more than a day ago no longer count", "RED"],
  ["E20", [["core/songs.js", "            id: \"proxynova\", name: \"ProxyNova\", referrer: \"no-referrer\", dailyIds: 900,", "            id: \"proxynova\", name: \"ProxyNova\", dailyIds: 900,"]],
    "check-geo-sources", "B: the third party gets no referrer and no cookies", "RED"],
  ["E21", [["features/metadata.js", ".then((j) => src.read(j, id) || nextServer(), () => nextServer());", ".then((j) => src.read(j, id) || {}, () => { throw new Error(\"network error\"); });"]],
    "check-geo-sources", "C: a refusal (403), junk, and Invidious' servers in turn", "RED"],
  ["E22", [["core/songs.js", "const list = (rr && Array.isArray(rr.allowed)) ? { allowed: rr.allowed }", "const list = (rr && Array.isArray(rr.allowed) && rr.allowed.length) ? { allowed: rr.allowed }"]],
    "check-geo-sources", "A: YouTube's EMPTY allowed list is blocked everywhere", "RED"],
  ["E23", [["core/songs.js", "for (const x of body.items) if (x && typeof x === \"object\" && x.id === id) { it = x; break; }", "for (const x of body.items) if (x && typeof x === \"object\") { it = x; break; }"]],
    "check-geo-sources", "A: YouTube's item for ANOTHER video is no answer", "RED"],
  ["E24", [["core/songs.js", "if (x && typeof x === \"object\" && x.id === id) return Array.isArray(x.blocked)", "if (x && typeof x === \"object\") return Array.isArray(x.blocked)"]],
    "check-geo-sources", "A: ProxyNova's entry for ANOTHER video is no answer", "RED"],
  ["E25", [["core/chatprefs.js", "    if (!_isApiKey(short, t)) return false;\n", ""]],
    "check-geo-sources", "E: the key's field refuses", "RED"],
  ["E26", [["core/chatprefs.js", "  function setGeoRecheckDays(d) { if (GEO_RECHECK_DAYS.indexOf(d) < 0) return false;", "  function setGeoRecheckDays(d) { if (typeof d !== \"number\") return false;"]],
    "check-geo-device", "A: the expiry refuses 45", "RED"],
  ["E27", [["core/chatprefs.js", "      geoLookup: true,", "      geoLookup: false,"]],
    "check-geo-device", "A: by default on, 90 days, no key", "RED"],
  ["E28", [["core/chatprefs.js", "    st.geoCounts = st.geoCounts.filter((r) => r.h > hour - GEO_COUNT_HOURS);\n", ""]],
    "check-geo-device", "A: counts older than a day are dropped", "RED"],
  ["E29", [["core/chatprefs.js", "    if (st.geoCounts.length > GEO_COUNT_CAP) st.geoCounts = st.geoCounts.slice(-GEO_COUNT_CAP);\n", ""]],
    "check-geo-device", "A: the counts are capped", "RED"],
  ["E30", [["core/chatprefs.js", "    _state.geoRecheckDays = (GEO_RECHECK_DAYS.indexOf(_state.geoRecheckDays) >= 0) ? _state.geoRecheckDays : GEO_RECHECK_DFLT;\n", ""], ["core/chatprefs.js", "  function geoRecheckDays()   { const d = _st().geoRecheckDays; return (GEO_RECHECK_DAYS.indexOf(d) >= 0) ? d : GEO_RECHECK_DFLT; }", "  function geoRecheckDays()   { return _st().geoRecheckDays; }"]],
    "check-geo-device", "A: stored junk reads as the defaults", "RED"],
  ["E31", [["ui/settings.js", "    sec.appendChild(H.el(\"label\", { class: \"pref-master-row\" }, [box, H.el(\"span\", { class: \"pref-title\", text: \"Look up where songs are blocked\" })]));\n", ""]],
    "check-geo-device", "B: the switch, labelled, ticked by default", "RED"],
  ["E32", [["ui/settings.js", "H.el(\"span\", { text: \"A key is set\" })", "H.el(\"span\", { text: \"A key is set: \" + held })"]],
    "check-geo-device", "B: once kept, the key is drawn NOWHERE on the card", "RED"],
  ["E33", [["ui/settings.js", "text: \"Each lookup tells the service it asks this device's address and which song.\" + ", "text: \"\" + "]],
    "check-geo-device", "B: a note says plainly that a lookup tells the service", "RED"],
  ["E34", [["ui/settings.js", "    wrap.appendChild(_geoSection());   // where songs are blocked: this device's lookups (J153 (c))\n", ""]],
    "check-geo-device", "D: the panel draws \"Where songs are blocked\"", "RED"],
  ["E35", [["ui/settings.js", "          _geoSaid = (kept || !String(v).trim()) ? null : { service: k.short, text: w.refused };", "          _geoSaid = null;"]],
    "check-geo-device", "B: and the card says why, after its redraw", "RED"],
  ["E36", [["ui/playlists.js", "    const list = (node.dataset && node.dataset.list) ? node.dataset.list : null;", "    const list = null;"]],
    "check-geo-device", "C: a room queue row's song is looked up", "RED"],
  ["E37", [["ui/playlists.js", "    if (mode === \"fetch\" && typeof opts.list === \"string\" && opts.list) thumb.dataset.list = opts.list;\n", ""]],
    "check-geo-device", "C: a room queue row is fetch, naming its list", "RED"],
  ["E38", [["ui/queue.js", "          list: \"room\",                          // and where it is blocked (J153 (c): the lists that look songs up)\n", ""]],
    "check-geo-device", "C: a room queue row is fetch, naming its list \"room\"", "RED"],
  ["E39", [["ui/panels.js", "        thumbMode: \"cacheOnly\",                       // display-if-known; no ambient fetch", "        thumbMode: \"fetch\", list: \"room\","]],
    "check-geo-device", "C: a History row is cacheOnly", "RED"],
  ["E40", [["ui/playlists.js", "      ? Promise.resolve(MetadataService.ensure(vid, [\"title\", \"geo\"], Date.now(), { list: list }))", "      ? Promise.resolve(MetadataService.ensure(vid, [\"title\"], Date.now(), { list: list }))"]],
    "check-geo-device", "C: a My queue row's song is looked up", "RED"],
  ["E41", [["ui/youtube.js", "    if (!r || !_DATA_CODES[code] || !geo || typeof geo !== \"object\") return r;", "    return r;"]],
    "check-blocked-wire", "the song's saved answer blocked somewhere, embeddable", "RED"],
  ["E42", [["ui/youtube.js", "    if (geo.embeddable === false) return _DATA_REASON.other;\n", ""]],
    "check-blocked-wire", "blocked somewhere but cannot be embedded", "RED"],
  ["E43", [["ui/youtube.js", "(Array.isArray(geo.blocked) && geo.blocked.length > 0)", "Array.isArray(geo.blocked)"]],
    "check-blocked-wire", "blocked nowhere, embeddable (the fourth case", "RED"],
  ["E44", [["ui/youtube.js", "      load(id, startSec) { current = id || null; p.loadVideoById", "      load(id, startSec) { p.loadVideoById"]],
    "check-blocked-wire", "F CONTROL — the same answer, for the loaded song, is read", "RED"],
  ["E45", [["features/metadata.js", "    try { rec = Store.meta.peek(songKey); } catch (e) { rec = null; }", "    try { rec = null; } catch (e) { rec = null; }"]],
    "check-blocked-wire", "the song's saved answer blocked somewhere, embeddable", "RED"],
  ["E46", [["core/logger.js", "    [/\\bAIza[0-9A-Za-z_-]{35}/g, R],                                      // a Google API key: a person's YouTube key (J153 (c))\n", ""]],
    "check-log-scrub", "A: a Google API key, bare", "RED"],
  ["E47", [["core/logger.js", "    [/([?&]key=)[^&#\\s\"')]+/g, \"$1\" + R],                               // a key in an address (`?key=…`, `&key=…`)\n", ""]],
    "check-log-scrub", "A: a key= in an address, first", "RED"],
  ["E48", [["core/logger.js", "    for (const [re, to] of _secretPatterns) out = out.replace(re, to);", "    for (const [re] of _secretPatterns) out = out.replace(re, R);"]],
    "check-log-scrub", "A: the text around a key is kept", "RED"],
  ["E49", [["core/playlistdoc.js", "      const list = (typeof Countries !== \"undefined\" && Countries.regionList) ? Countries.regionList(raw.geo) : null;", "      const list = Array.isArray(raw.geo.blocked) ? { blocked: raw.geo.blocked.filter((c) => typeof c === \"string\" && /^[A-Z]{2}$/.test(c)) } : null;"]],
    "check-playlists", "the file's boundary and the cache's give one answer", "RED"],
  ["E50", [["core/playlistdoc.js", "      const list = (typeof Countries !== \"undefined\" && Countries.regionList) ? Countries.regionList(raw.geo) : null;", "      const list = Array.isArray(raw.geo.blocked) ? { blocked: raw.geo.blocked.filter((c) => typeof c === \"string\" && /^[A-Z]{2}$/.test(c)) } : null;"]],
    "check-playlist-import", "geo in the new shape reads", "RED"],
  // E51 RE-ANCHORED at J153 (d)'s second half (`ddjp_727`, the supervisor's approval): the one rule "a song asks only its own
  // service's sources" is held at three points since then — its home, `Songs.regionOrder`'s filter, and two copies, `_geoChain`'s
  // per-service map and each provider's `idOf`. Any one removed alone stays green on B (measured: `idOf`'s green, the map's
  // green, `regionOrder`'s red only at H's own assertion), so the row removes all three. Folding the copies is owed (HANDOFF).
  ["E51", [["features/metadata.js", "return (Songs.serviceOf(songKey) === src.short) ? Songs.idOf(songKey) : null;", "return Songs.idOf(songKey);"],
           ["core/songs.js", "    const mine = regionSources().filter((x) => x.short === short);", "    const mine = regionSources();"],
           ["features/metadata.js", "    for (const p of all) if (p && p.short === short) byId[p.id] = p;", "    for (const p of all) if (p) byId[p.id] = p;"]],
    "check-geo-sources", "B: a song not YouTube's asks no source", "RED"],
  ["E52", [["core/songs.js", "referrer: \"no-referrer\", dailyIds: 900,", "referrer: \"no-referrer\","]],
    "check-geo-sources", "D: at 900 songs today ProxyNova is skipped", "RED"],
  ["E53", [["features/metadata.js", "if (!src.servers) return _getJson(src.url(id, key), src.referrer)", "if (!src.servers) return _getJson(src.url(id, key))"]],
    "check-geo-sources", "B: the third party gets no referrer and no cookies", "RED"],
  ["E54", [["core/songs.js", "          rule: /^AIza[0-9A-Za-z_-]{35}$/,", "          rule: /^AIza[0-9A-Za-z_-]{30,40}$/,"]],
    "check-geo-sources", "E: the key's field refuses", "RED"],
  ["E55", [["core/chatprefs.js", "    _state.apiKeys = _cleanApiKeys(_state.apiKeys);\n", ""], ["core/chatprefs.js", "return (Object.prototype.hasOwnProperty.call(_st().apiKeys, short) && _isApiKey(short, k)) ? k : \"\"; }", "return (typeof k === \"string\") ? k : \"\"; }"]],
    "check-geo-device", "A: stored junk reads as the defaults", "RED"],
  ["E56", [["core/chatprefs.js", "    _state.apiKeys = _cleanApiKeys(_state.apiKeys);\n", ""]],
    "check-geo-device", "A: a stored key map of the wrong shape is rebuilt on load", "RED"],
  ["E57", [["ui/settings.js", "words: Songs.apiKeyOf(r.short) })).filter((k) => k.words);", "words: Songs.apiKeyOf(r.short) || Songs.apiKeyOf(\"yt\") })).filter((k) => k.words);"]],
    "check-geo-device", "B: a key's field for each service the table gives a key's form, and none for another", "RED"],
  ["E58", [["ui/settings.js", "const order = sources.map(", "const order = sources.slice().reverse().map("]],
    "check-geo-device", "B: the note names the sources in their order", "RED"],
  ["E59", [["features/metadata.js", "  const GEO_TIMEOUT_MS = 8000;\n", "  const GEO_TIMEOUT_MS = 8000;\n  const _SOURCE_NAMES = [\"YouTube\"];\n"]],
    "check-song-words", "A — NO CODE NAME, WORD, REASON TOKEN OR STORED KEY OUTSIDE YOUTUBE'S PLAYER FILE", "RED"],
  ["G1", [["features/metadata.js", "  const MAX_TITLE  = 300;                          // cap untrusted title length", "  const MAX_TITLE  = 300;                          // cap an untrusted title's length"]],
    "check-metadata-service", "", "GREEN"],
  ["G2", [["ui/youtube.js", "  // This session's saved answer for the song this player last loaded, or null.", "  // This session's saved answer for the song the player last loaded, or null."]],
    "check-blocked-wire", "", "GREEN"],
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
      const h = J.open("mutate-j153-e:" + id, file);   // journalled BEFORE the write
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
