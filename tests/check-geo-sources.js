// tests/check-geo-sources.js
// SUBJECT: features/metadata.js, core/chatprefs.js, core/songs.js
//
// WALL: WHERE A SONG IS BLOCKED, ASKED OF THE OWNER'S THREE SOURCES IN HIS ORDER, COUNTED, AND NEVER LEAKING THE KEY
// (J153 (c), the owner's: "if youtube api use first, then make bowth proxy nova and indivious work with fallback"; "ready
// to later prioritize api usages … per 24h calls"). Driven on the REAL `features/metadata.js` — the providers it builds from
// the REAL song table (`core/songs.js`, YouTube's `regions`: each source's address, reader, order, limit and servers),
// their fetch bodies, its one lookup path — over the REAL device preferences (`core/chatprefs.js`, on a Store.prefs
// double) and the REAL country table. The one stand-in is the network: a recording `fetch` whose answers are built from
// each source's own documentation (cited at the sources in `core/songs.js`), because the workspace reaches none of the
// three. THIS GUARD CANNOT TELL YOU A SOURCE ANSWERS A BROWSER TODAY: that is his sitting's (L5).
//
//   A  EACH PARSER (the table's `read`) over its documented answers, then through the boundary (`sanitize`): YouTube's allowed list, blocked list,
//      no restriction, empty allowed (blocked everywhere), embeddable false, another video's item, an error body, junk;
//      ProxyNova's list with `EU` and `ZZ`, another id, no list, junk; Invidious' full list (no restriction), a short list,
//      an error, junk.
//   B  THE ORDER: the providers are the table's sources, in the table's order — YouTube, ProxyNova, Invidious; with no key
//      YouTube skips itself (uncounted, unasked); with a key it is asked first, and its address carries the key; a song not
//      YouTube's asks nobody and counts nothing.
//   C  THE FALL-THROUGH on a refusal (HTTP 403), a network error, a timeout's word, and junk; Invidious' servers in turn.
//   D  COUNTING: each call and each song, by source and by the list that asked, in this device's preferences; ProxyNova
//      skipped once this device asked it 900 songs in the last day (a day-old count does not count), and the line says so.
//   E  THE KEY NEVER REACHES A LOG LINE: an error whose text carries the address and the key logs only "network error",
//      and no line names an address; the key's field refuses what is not a key in its service's form, and any key for a
//      service with none.
//   F  MANY SONGS AT ONCE (J153 (d), the bot's whole-queue check, `fetchMany`): a source that takes several ids asked about
//      them together, in groups of at most its `many` (YouTube 50, ProxyNova 10), one call naming every id with plain commas,
//      counted as one call and its songs under the list; its daily limit trims a group; a song it does not answer falls
//      through, one at a time where the next takes one; a fresh saved answer is not asked; the switch off or a list that
//      does not look up asks nothing; every source refusing reads as none reached.
//   G  A SOURCE THAT IS DOWN (J153 (d), his "check if the service is down and self switch if it is"; the supervisor's numbers):
//      three refusals, errors or timeouts in a row — and only those: "no answer" is the source answering, and a call that
//      comes back starts the count over — and the source is skipped, uncounted, for ten minutes, by the lookup path's OWN
//      clock (a caller's time far ahead changes nothing: the callers hand in different clocks), then asked again; one log line
//      each way, naming it; `geoStatus` names it while it is down; in `fetchMany` a source that goes down part-way hands the
//      rest of its songs to the next; YouTube refusing (a 403: a bad key, its quota) goes down the same way.
//   H  THE DEVICE'S ORDER (J153 (d), his "auto fallback and lets you pick a favorite"): `Songs.regionOrder`, the one rule —
//      the favourite first, then the rest in the table's order while auto fallback is on; the favourite alone while it is
//      off; a chosen source that is not ready (YouTube with no key) counts as none chosen; none chosen, the table's first
//      ready — and the lookup path asking in it, one song and many, a favourite that is down skipped with fallback on and
//      nothing asked with it off.
//   I  INVIDIOUS' SERVERS: a server that answers without a list is the source answering with no answer for that song, so
//      it never makes Invidious down; only every server failing is a failure.
"use strict";
const { loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[geo-sources] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 400) : "")); }
}
const J = (x) => JSON.stringify(x);
const KEY = "AIza" + "B".repeat(35);
const YT = "yt:dQw4w9WgXcQ", ID = "dQw4w9WgXcQ", SC = "sc:artist/track";
const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR, NOW = 20000 * DAY;

// The network: `answers(url)` returns { status, body } or "network" (rejects) for each request; every URL is recorded.
function world(answers, prefsInit) {
  let prefs = prefsInit ? JSON.parse(JSON.stringify(prefsInit)) : null;
  const recs = {}, lines = [], urls = [];
  function fetch(url, opts) {
    urls.push({ url: String(url), opts: opts || {} });
    const a = answers(String(url));
    if (a === "network") return Promise.reject(new TypeError("Failed to fetch " + url));
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  }
  const w = loadInContext(["core/countries.js", "core/chatprefs.js", "features/metadata.js"], {
    Store: {
      meta: { load(k) { return Promise.resolve(recs[k] ? JSON.parse(J(recs[k])) : null); },
              persist(k, r) { recs[k] = JSON.parse(J(r)); return Promise.resolve(true); } },
      prefs: { load() { return prefs; }, save(v) { prefs = JSON.parse(J(v)); } },
    },
    Logger: { info(m) { lines.push(String(m)); }, debug(m) { lines.push(String(m)); }, warn(m) { lines.push(String(m)); }, error(m) { lines.push(String(m)); } },
    fetch, setTimeout, clearTimeout, AbortController,
  });
  return { M: w.MetadataService, P: w.ChatPrefs, C: w.Countries, S: w.Songs, recs, lines, urls };
}
// The device's key, per service: a tree without these accessors reads null and fails by name rather than throwing.
const AK = (P, s) => (P && typeof P.apiKey === "function") ? P.apiKey(s) : null;
const SAK = (P, s, k) => (P && typeof P.setApiKey === "function") ? P.setApiKey(s, k) : null;
const host = (u) => { try { return new URL(u).host; } catch (e) { return "?"; } };
// Documented answers (see YouTube's `regions` in core/songs.js for each source's page).
const ytBody = (rr, embeddable, id) => ({ kind: "youtube#videoListResponse", items: [{ kind: "youtube#video", id: id || ID,
  contentDetails: rr === undefined ? {} : { regionRestriction: rr }, status: embeddable === undefined ? {} : { embeddable: embeddable } }] });
const pnBody = (blocked, id) => [{ id: id || ID, blocked: blocked, title: "A song" }];
const ivBody = (allowed) => ({ title: "A song", videoId: ID, allowedRegions: allowed });
const idOfUrl = (u) => { try { return new URL(u).searchParams.get("id"); } catch (e) { return null; } };

(async () => {
  const W0 = world(() => "network");
  const M = W0.M, CODES = W0.C.codes();
  const SRC = {};
  for (const x of (W0.S && W0.S.regionSources ? W0.S.regionSources() : [])) SRC[x.id] = x;
  ok(["youtube", "proxynova", "invidious"].every((k) => SRC[k] && typeof SRC[k].read === "function" && typeof SRC[k].url === "function"),
    "PREMISE — the song table gives the three sources, each with its address and its reader", Object.keys(SRC));
  const NOREAD = () => null;
  const ytRead = (SRC.youtube || {}).read || NOREAD, pnRead = (SRC.proxynova || {}).read || NOREAD, ivRead = (SRC.invidious || {}).read || NOREAD;

  // ── A — EACH PARSER, THEN THE BOUNDARY ────────────────────────────────────────────────────────────────────────────────
  const thru = (parsed) => parsed ? M.sanitize(parsed).geo : null;
  ok(J(thru(ytRead(ytBody({ blocked: ["DE", "FR"] }, true), ID))) === J({ blocked: ["DE", "FR"], embeddable: true, checkedAt: 0 }),
    "A: YouTube's blocked list, embeddable true", thru(ytRead(ytBody({ blocked: ["DE", "FR"] }, true), ID)));
  ok(J(thru(ytRead(ytBody({ allowed: ["US"] }, true), ID))) === J({ allowed: ["US"], embeddable: true, checkedAt: 0 }),
    "A: YouTube's allowed list", thru(ytRead(ytBody({ allowed: ["US"] }, true), ID)));
  ok(J(thru(ytRead(ytBody({ allowed: [] }, true), ID))) === J({ allowed: [], embeddable: true, checkedAt: 0 }),
    "A: YouTube's EMPTY allowed list is blocked everywhere, kept as such (not no restriction)");
  ok(J(thru(ytRead(ytBody(undefined, false), ID))) === J({ blocked: [], embeddable: false, checkedAt: 0 }),
    "A: YouTube with no regionRestriction is no restriction; embeddable false is kept", thru(ytRead(ytBody(undefined, false), ID)));
  ok(J(thru(ytRead({ items: [{ id: ID, contentDetails: {} }] }, ID))) === J({ blocked: [], embeddable: null, checkedAt: 0 }),
    "A: YouTube with no status says nothing of embedding: null");
  ok(ytRead(ytBody({ blocked: ["DE"] }, true, "otherVideo1"), ID) === null, "A: YouTube's item for ANOTHER video is no answer");
  ok(ytRead({ kind: "youtube#videoListResponse", items: [] }, ID) === null, "A: YouTube with no item (a removed video) is no answer");
  ok(ytRead({ error: { code: 403, message: "The request is missing a valid API key.", errors: [{ reason: "forbidden" }] } }, ID) === null,
    "A: YouTube's error body is no answer");
  ok(ytRead({ items: [{ id: ID }] }, ID) === null, "A: YouTube's item without the part asked for (contentDetails) is no answer");
  for (const junk of [null, "x", 7, [], { items: "x" }]) ok(ytRead(junk, ID) === null, "A: YouTube junk " + J(junk) + " is no answer");
  ok(J(thru(pnRead(pnBody(["DE", "EU", "ZZ", "FR"]), ID))) === J({ blocked: ["DE", "FR"], embeddable: null, checkedAt: 0 }),
    "A: ProxyNova's blocked list — EU and ZZ (no country) dropped at the boundary; embeddable null", thru(pnRead(pnBody(["DE", "EU", "ZZ", "FR"]), ID)));
  const most = CODES.filter((c) => c !== "JP");
  ok(J(thru(pnRead(pnBody(most), ID))) === J({ allowed: ["JP"], embeddable: null, checkedAt: 0 }),
    "A: ProxyNova's long blocked list is kept as the short allowed rest");
  ok(pnRead(pnBody(["DE"], "otherVideo1"), ID) === null, "A: ProxyNova's entry for ANOTHER video is no answer");
  ok(pnRead([{ id: ID, title: "x" }], ID) === null, "A: ProxyNova's entry with no list is no answer");
  for (const junk of [null, "x", { id: ID, blocked: ["DE"] }, {}]) ok(pnRead(junk, ID) === null, "A: ProxyNova junk " + J(junk) + " is no answer");
  ok(J(thru(ivRead(ivBody(CODES)))) === J({ blocked: [], embeddable: null, checkedAt: 0 }),
    "A: Invidious' full allowed list is no restriction", thru(ivRead(ivBody(CODES))));
  ok(J(thru(ivRead(ivBody(["FR", "DE"])))) === J({ allowed: ["DE", "FR"], embeddable: null, checkedAt: 0 }),
    "A: Invidious' short allowed list");
  for (const junk of [null, { error: "Video unavailable" }, { allowedRegions: "FR" }, []]) ok(ivRead(junk) === null, "A: Invidious " + J(junk) + " is no answer");

  // ── B — THE ORDER ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const chain = M.providersFor("geo").map((p) => p.id);
  ok(J(chain) === J(["youtube", "proxynova", "invidious"]), "B: the sources in the owner's order: YouTube, ProxyNova, Invidious", chain);
  ok(chain.length > 0 && W0.S && typeof W0.S.regionSources === "function" && J(chain) === J(W0.S.regionSources().map((x) => x.id)) &&
    J(M.providersFor("geo").map((p) => p.name)) === J(W0.S.regionSources().map((x) => x.name)),
    "B: the lookup's providers are the song table's sources, in the table's order, by its ids and names (the lookup names none)", chain);
  {
    const W = world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) } : "network");
    const g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(W.urls.length === 1 && host(W.urls[0].url) === "api.proxynova.com", "B: with NO key the first request is ProxyNova's (YouTube skips itself)", W.urls.map((x) => host(x.url)));
    ok(W.urls.length === 1 && W.urls[0].url.indexOf(ID) > 0 && !/key=/.test(W.urls[0].url), "B: ProxyNova is asked for this song, and no key is sent", W.urls[0] && W.urls[0].url);
    ok(g.geo && g.geo.source === "proxynova" && J(g.geo.blocked) === J(["DE"]), "B: ProxyNova's answer is kept, its source stamped", g.geo);
    ok(!W.P.geoCountRows().some((r) => r.source === "youtube"), "B: YouTube with no key is not counted", W.P.geoCountRows());
    ok(!!W.urls[0] && W.urls[0].opts.referrerPolicy === "no-referrer" && W.urls[0].opts.credentials === "omit", "B: the third party gets no referrer and no cookies", W.urls[0] && W.urls[0].opts);
  }
  {
    const W = world((u) => host(u) === "www.googleapis.com" ? { status: 200, body: ytBody({ blocked: ["FR"] }, true) } : "network");
    ok(SAK(W.P, "yt", "  " + KEY + " ") === true, "B PREMISE — a key, pasted with spaces around it, is kept");
    const g = await W.M.ensure(YT, ["geo"], NOW, { list: "room" });
    ok(W.urls.length === 1 && host(W.urls[0].url) === "www.googleapis.com", "B: with a key, YouTube is asked first", W.urls.map((x) => host(x.url)));
    const u = W.urls.length ? new URL(W.urls[0].url) : null;
    ok(u && u.pathname === "/youtube/v3/videos" && u.searchParams.get("part") === "contentDetails,status" && u.searchParams.get("id") === ID && u.searchParams.get("key") === KEY,
      "B: YouTube's request is videos.list for this song, both parts, with the key", W.urls[0] && W.urls[0].url.replace(KEY, "<key>"));
    ok(!!W.urls[0] && !W.urls[0].opts.referrerPolicy, "B: YouTube's request keeps the browser's ordinary referrer (a key restricted to the app's address needs it)", W.urls[0] && W.urls[0].opts);
    ok(g.geo && g.geo.source === "youtube" && g.geo.embeddable === true, "B: YouTube's answer is kept with embeddable", g.geo);
  }
  {
    const W = world(() => ({ status: 200, body: pnBody(["DE"]) }));
    SAK(W.P, "yt", KEY);
    const g = await W.M.ensure(SC, ["geo"], NOW, { list: "playlist" });
    ok(W.urls.length === 0 && !g.geo && W.P.geoCountRows().length === 0 && W.lines.length === 0,
      "B: a song not YouTube's asks no source, counts nothing and logs no first line", { urls: W.urls.length, rows: W.P.geoCountRows(), lines: W.lines });
  }

  // ── C — THE FALL-THROUGH ──────────────────────────────────────────────────────────────────────────────────────────────
  {
    const W = world((u) => host(u) === "www.googleapis.com" ? { status: 403, body: { error: { code: 403 } } }
      : host(u) === "api.proxynova.com" ? { status: 200, body: { junk: true } }
      : host(u) === "invidious.nerdvpn.de" ? { status: 503, body: {} }
      : host(u) === "yt.chocolatemoo53.com" ? "network"
      : host(u) === "invidious.tiekoetter.com" ? { status: 200, body: ivBody(["FR"]) } : "network");
    SAK(W.P, "yt", KEY);
    const g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(J(W.urls.map((x) => host(x.url))) === J(["www.googleapis.com", "api.proxynova.com", "invidious.nerdvpn.de", "yt.chocolatemoo53.com", "invidious.tiekoetter.com"]),
      "C: a refusal (403), junk, and Invidious' servers in turn (503, a network error, an answer)", W.urls.map((x) => host(x.url)));
    ok(g.geo && g.geo.source === "invidious" && J(g.geo.allowed) === J(["FR"]), "C: the answer that came is kept", g.geo);
    ok(W.lines.length === 1 && /YouTube refused \(HTTP 403\), ProxyNova gave no answer, Invidious answered/.test(W.lines[0]),
      "C: the first lookup's line names each source tried, in order, and how it answered", W.lines);
  }
  {
    const W = world(() => "network");
    const g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(!g.geo, "C: no source answering leaves no answer (nothing is guessed)", g);
    ok(W.lines.length === 1 && /ProxyNova refused \(network error\), Invidious refused \(network error\)/.test(W.lines[0]), "C: and the line says each refused", W.lines);
    ok(!(YT in W.recs) || !W.recs[YT].geo, "C: and nothing is saved as an answer");
  }

  // ── D — COUNTING, AND PROXYNOVA'S DAILY STOP ──────────────────────────────────────────────────────────────────────────
  {
    const W = world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) } : "network");
    await W.M.ensure(YT, ["geo"], NOW, { list: "room" });
    await W.M.ensure("yt:aaaaaaaaaaa", ["geo"], NOW, { list: "mine" });
    await W.M.ensure("yt:bbbbbbbbbbb", ["geo"], NOW, { list: "mine" });
    await W.M.ensure("yt:ccccccccccc", ["geo"], NOW, { list: "playlist" });
    const rows = W.P.geoCountRows().filter((r) => r.source === "proxynova");
    const by = (l) => rows.filter((r) => r.list === l).reduce((n, r) => n + r.calls, 0);
    ok(by("room") === 1 && by("mine") === 2 && by("playlist") === 1, "D: each call counted by the list that asked", rows);
    ok(rows.every((r) => r.ids === r.calls && r.hour === Math.floor(NOW / HOUR)), "D: each counts its one song, in this hour", rows);
  }
  async function atCount(seedIds, hoursAgo) {
    const hour = Math.floor(NOW / HOUR) - hoursAgo;
    const W = world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) }
      : host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["FR"]) } : "network",
      { geoCounts: [{ s: "proxynova", l: "room", h: hour, c: 1, i: seedIds }] });
    const g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    return { W, g, first: W.urls.length ? host(W.urls[0].url) : null };
  }
  {
    const a = await atCount(899, 0);
    ok(a.first === "api.proxynova.com", "D CONTROL — at 899 songs today ProxyNova is still asked", a.first);
    const b = await atCount(900, 0);
    ok(b.first === "invidious.nerdvpn.de" && b.g.geo && b.g.geo.source === "invidious", "D: at 900 songs today ProxyNova is skipped and the next source asked", b.first);
    ok(b.W.lines.length === 1 && /ProxyNova at its daily limit, Invidious answered/.test(b.W.lines[0]), "D: the line says ProxyNova is at its daily limit", b.W.lines);
    const c = await atCount(900, 23);
    ok(c.first === "invidious.nerdvpn.de", "D: songs asked 23 hours ago still count toward the day", c.first);
    const d = await atCount(900, 25);
    ok(d.first === "api.proxynova.com", "D: songs asked more than a day ago no longer count", d.first);
    ok((SRC.proxynova || {}).dailyIds === 900, "D: the stop is 900, under ProxyNova's 1,000 per address (YouTube's row)", (SRC.proxynova || {}).dailyIds);
  }

  // ── E — THE KEY NEVER REACHES A LOG LINE ──────────────────────────────────────────────────────────────────────────────
  {
    const W = world(() => "network");   // the stand-in's error text carries the whole address, key included
    SAK(W.P, "yt", KEY);
    await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(W.urls.length >= 1 && W.urls[0].url.indexOf(KEY) > 0, "E PREMISE — the request carried the key (so its error text did too)");
    ok(W.lines.length === 1 && /YouTube refused \(network error\)/.test(W.lines[0]), "E: an error whose text holds the address logs only \"network error\"", W.lines);
    ok(!W.lines.some((l) => l.indexOf(KEY) >= 0 || /https?:\/\/|googleapis|key=/.test(l)), "E: no log line names an address or the key", W.lines);
  }
  {
    const W = world(() => "network");
    for (const bad of ["AIza", "AIza" + "B".repeat(34), "AIza" + "B".repeat(36), "XIza" + "B".repeat(35), "AIza" + "B".repeat(34) + "!", 42]) {
      ok(SAK(W.P, "yt", bad) === false && AK(W.P, "yt") === "", "E: the key's field refuses " + J(bad) + " and keeps nothing");
    }
    ok(SAK(W.P, "sc", KEY) === false && AK(W.P, "sc") === "", "E: a service with no key's form in the table takes no key");
    ok(SAK(W.P, 42, KEY) === false && AK(W.P, "yt") === "", "E: a key for no service is refused");
    ok(SAK(W.P, "yt", KEY) === true && AK(W.P, "yt") === KEY && AK(W.P, "sc") === "", "E CONTROL — a key in Google's form is kept, for its service alone");
    ok(SAK(W.P, "yt", "") === true && AK(W.P, "yt") === "", "E: an empty field clears the key");
  }

  // ── F — MANY SONGS AT ONCE: THE BOT'S WHOLE-QUEUE CHECK (J153 (d)) ────────────────────────────────────────────────────
  // `fetchMany`, the one lookup path for a list of songs: a source whose row says how many one call may name (`many`) is asked
  // about them together — YouTube up to 50, ProxyNova up to 10 — in groups no bigger, each group one call naming every id,
  // counted as one call and its songs under the list that asked; its daily limit trims a group; a song it does not answer
  // falls through to the next source (Invidious, one at a time); a saved answer is not asked again; nothing is asked with the
  // switch off or with a list that does not look songs up; and every source refusing reads as no source reached.
  {
    const idn = (n) => ("v" + String(n).padStart(3, "0")).padEnd(11, "q");
    const keysOf = (n) => Array.from({ length: n }, (_, i) => "yt:" + idn(i));
    const idsIn = (u) => { try { return (new URL(u).searchParams.get("id") || "").split(","); } catch (e) { return []; } };
    const ytMany = (u, blocked) => ({ status: 200, body: { kind: "youtube#videoListResponse", items: idsIn(u).map((id) => ({ kind: "youtube#video", id: id,
      contentDetails: { regionRestriction: { blocked: blocked } }, status: { embeddable: true } })) } });
    const pnMany = (u, blocked, skip) => ({ status: 200, body: idsIn(u).filter((id) => (skip || []).indexOf(id) < 0).map((id) => ({ id: id, blocked: blocked, title: "A song" })) });
    // F1 — with a key, YouTube first: three songs in ONE call, its address naming every id with plain commas.
    {
      const W = world((u) => host(u) === "www.googleapis.com" ? ytMany(u, ["DE"]) : "network");
      SAK(W.P, "yt", KEY);
      const r = await W.M.fetchMany(keysOf(3), NOW, { list: "room" });
      ok(W.urls.length === 1 && J(idsIn(W.urls[0].url)) === J([idn(0), idn(1), idn(2)]) && W.urls[0].url.indexOf(idn(0) + "," + idn(1)) > 0,
        "F: with a key, three songs are ONE call to YouTube, its address naming each id, joined by plain commas", W.urls.map((x) => x.url.replace(KEY, "KEY")));
      ok(r && r.on === true && r.asked === 3 && r.reached === 1 && keysOf(3).every((k) => r.answers[k] && J(r.answers[k].blocked) === J(["DE"])),
        "F: and each song's answer is read out of the one body, by its id", r);
      ok(keysOf(3).every((k) => W.recs[k] && W.recs[k].geo && W.recs[k].geo.source === "youtube" && W.recs[k].geo.checkedAt === NOW),
        "F: each answer is saved beside its song, stamped with the source that gave it and the caller's time", keysOf(3).map((k) => W.recs[k]));
      const rows = W.P.geoCountRows().filter((x) => x.source === "youtube");
      ok(rows.length === 1 && rows[0].list === "room" && rows[0].calls === 1 && rows[0].ids === 3,
        "F: counted as ONE call naming three songs, under the room queue's list", rows);
    }
    // F2 — no key: ProxyNova, ten to a call; 23 songs are three calls (10, 10, 3), each counted.
    {
      const W = world((u) => host(u) === "api.proxynova.com" ? pnMany(u, ["FR"]) : "network");
      const r = await W.M.fetchMany(keysOf(23), NOW, { list: "room" });
      const sizes = W.urls.map((x) => idsIn(x.url).length);
      ok(J(sizes) === J([10, 10, 3]) && W.urls.every((x) => host(x.url) === "api.proxynova.com"),
        "F: with no key YouTube skips itself, and ProxyNova is asked ten songs to a call — 23 songs, three calls", sizes);
      ok(r.asked === 23 && r.reached === 3 && Object.keys(r.answers).length === 23, "F: and every song is answered", { asked: r.asked, reached: r.reached, n: Object.keys(r.answers).length });
      const rows = W.P.geoCountRows().filter((x) => x.source === "proxynova");
      ok(rows.reduce((n, x) => n + x.calls, 0) === 3 && rows.reduce((n, x) => n + x.ids, 0) === 23 && rows.every((x) => x.list === "room"),
        "F: counted as three calls and 23 songs, under the room queue's list", rows);
      ok((SRC.youtube || {}).many === 50 && (SRC.proxynova || {}).many === 10 && !(SRC.invidious || {}).many,
        "F: the table says how many one call may name: YouTube 50, ProxyNova 10, Invidious one", [(SRC.youtube || {}).many, (SRC.proxynova || {}).many, (SRC.invidious || {}).many]);
    }
    // F3 — a song ProxyNova does not answer falls through to Invidious, one call for that song alone.
    {
      const W = world((u) => host(u) === "api.proxynova.com" ? pnMany(u, ["FR"], [idn(1)])
        : host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["GB"]) } : "network");
      const r = await W.M.fetchMany(keysOf(3), NOW, { list: "room" });
      const iv = W.urls.filter((x) => host(x.url) === "invidious.nerdvpn.de");
      ok(iv.length === 1 && iv[0].url.indexOf("/api/v1/videos/" + idn(1)) > 0 && r.answers["yt:" + idn(1)] && r.answers["yt:" + idn(1)].source === "invidious" &&
         r.answers["yt:" + idn(0)].source === "proxynova",
        "F: the one song ProxyNova did not answer is asked of Invidious alone; the rest keep ProxyNova's answers", { iv: iv.map((x) => x.url), r: r.answers });
    }
    // F4 — ProxyNova's daily limit trims a group: 895 songs today leaves five, and the rest fall through.
    {
      const W = world((u) => host(u) === "api.proxynova.com" ? pnMany(u, ["FR"])
        : host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["GB"]) } : "network",
        { geoCounts: [{ s: "proxynova", l: "room", h: Math.floor(NOW / HOUR), c: 1, i: 895 }] });
      const r = await W.M.fetchMany(keysOf(8), NOW, { list: "room" });
      const pn = W.urls.filter((x) => host(x.url) === "api.proxynova.com"), iv = W.urls.filter((x) => host(x.url) === "invidious.nerdvpn.de");
      ok(pn.length === 1 && idsIn(pn[0].url).length === 5 && iv.length === 3 && Object.keys(r.answers).length === 8,
        "F: with five songs left of ProxyNova's day, one call names five, and the other three go to Invidious", { pn: pn.map((x) => idsIn(x.url).length), iv: iv.length });
    }
    // F5 — a saved answer still fresh is handed back and never asked; the switch off or a list that does not look up asks nothing.
    {
      const W = world((u) => host(u) === "api.proxynova.com" ? pnMany(u, ["FR"]) : "network");
      W.recs["yt:" + idn(0)] = { geo: { blocked: ["DE"], embeddable: null, checkedAt: NOW - DAY, source: "proxynova" } };
      const r = await W.M.fetchMany(keysOf(2), NOW, { list: "room" });
      ok(W.urls.length === 1 && J(idsIn(W.urls[0].url)) === J([idn(1)]) && r.asked === 1 && J(r.answers["yt:" + idn(0)].blocked) === J(["DE"]),
        "F: a saved answer still fresh is handed back and not asked again; only the other song is", { urls: W.urls.map((x) => x.url), r });
      const W2 = world(() => "network");
      W2.P.setGeoLookup(false);
      const off = await W2.M.fetchMany(keysOf(2), NOW, { list: "room" });
      ok(W2.urls.length === 0 && off.on === false && off.asked === 0, "F: with the device's switch off, nothing is asked", off);
      const W3 = world(() => "network");
      const nol = await W3.M.fetchMany(keysOf(2), NOW, { list: "history" });
      ok(W3.urls.length === 0 && nol.on === false && nol.asked === 0, "F: with the switch on, a list that does not look songs up asks nothing", nol);
      const yes = await W3.M.fetchMany(keysOf(2), NOW, { list: "room" });
      ok(W3.urls.length > 0 && yes.on === true, "F CONTROL — the same device, asked for the room queue, asks", yes);
    }
    // F6 — every source refusing: songs asked, no source reached (what the bot's "no source is answering" reads).
    {
      const W = world(() => "network");
      const r = await W.M.fetchMany(keysOf(2), NOW, { list: "room" });
      ok(r.on === true && r.asked === 2 && r.reached === 0 && Object.keys(r.answers).length === 0,
        "F: when every source refuses, the songs were asked and no source was reached", r);
      const C = world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: [] } : "network");
      const rc = await C.M.fetchMany(keysOf(2), NOW, { list: "room" });
      ok(rc.reached === 1 && rc.asked === 2, "F CONTROL — a source that answers with nothing for these songs WAS reached: not down", rc);
    }
    // F7 — one song's address is what it always was (the screens' one call per song is unchanged by the list form).
    {
      const S = SRC.proxynova || {};
      ok(typeof S.url === "function" && S.url(ID) === "https://api.proxynova.com/youtube_restrictions?id=" + ID &&
         S.url([ID, "x-y_z"]) === "https://api.proxynova.com/youtube_restrictions?id=" + ID + ",x-y_z",
        "F: one id's address is unchanged, and a list's names each id, joined by plain commas", [S.url && S.url(ID)]);
    }
  }

  // ── G — A SOURCE THAT IS DOWN (J153 (d)) ──────────────────────────────────────────────────────────────────────────────
  const T = { now: 5 * DAY };
  const clocked = (W) => { if (W.M && typeof W.M._setClockForTest === "function") W.M._setClockForTest(() => T.now); return W; };
  const song = (n) => "yt:" + ("g" + String(n).padStart(3, "0")).padEnd(11, "z");
  const hostsOf = (W) => W.urls.map((x) => host(x.url));
  const pnAsked = (W) => W.urls.filter((x) => host(x.url) === "api.proxynova.com").length;
  ok(W0.M && W0.M.DOWN_AFTER === 3 && W0.M.DOWN_MS === 10 * 60 * 1000 && typeof W0.M._setClockForTest === "function",
    "G PREMISE — the lookup path says what down is (3 failures in a row, 10 minutes) and its clock can be set for the guard",
    W0.M && [W0.M.DOWN_AFTER, W0.M.DOWN_MS, typeof W0.M._setClockForTest]);
  {
    // G1 — ProxyNova refusing three songs in a row: the third makes it down; the fourth song does not ask it, nor count it.
    T.now = 5 * DAY;
    const W = clocked(world((u) => host(u) === "api.proxynova.com" ? "network" : host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["FR"]) } : "network"));
    for (let n = 0; n < 2; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 2 && !W.lines.some((l) => /is down/.test(l)), "G: two failures in a row: ProxyNova is still asked, and nothing says down", { pn: pnAsked(W), lines: W.lines });
    await W.M.ensure(song(2), ["geo"], NOW, { list: "mine" });
    const downLines = W.lines.filter((l) => /ProxyNova is down — 3 failures in a row; not asked for 10 minutes/.test(l));
    ok(pnAsked(W) === 3 && downLines.length === 1, "G: the third failure in a row makes ProxyNova down, said once in the log, naming it", W.lines);
    ok(J(W.M.geoStatus().down) === J(["ProxyNova"]), "G: while it is down, `geoStatus` names it", W.M.geoStatus());
    const before = W.P.geoCountRows().filter((r) => r.source === "proxynova").reduce((n, r) => n + r.calls, 0);
    const g = await W.M.ensure(song(3), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 3 && g.geo && g.geo.source === "invidious", "G: while it is down it is skipped, and the next source answers", { pn: pnAsked(W), g: g.geo });
    ok(W.P.geoCountRows().filter((r) => r.source === "proxynova").reduce((n, r) => n + r.calls, 0) === before, "G: a skipped source is not counted");
    // G7 — the caller's time far ahead changes nothing: the window is the lookup path's own clock.
    await W.M.ensure(song(4), ["geo"], NOW + 365 * DAY, { list: "mine" });
    ok(pnAsked(W) === 3, "G: a caller's time a year ahead does not end the window (the lookup path's own clock, never the caller's)", pnAsked(W));
    T.now += 10 * 60 * 1000 - 1;
    await W.M.ensure(song(5), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 3, "G: a moment before ten minutes it is still down", pnAsked(W));
    T.now += 1;
    await W.M.ensure(song(6), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 4 && W.lines.filter((l) => /ProxyNova is asked again/.test(l)).length === 1, "G: ten minutes on, it is asked again, said once", { pn: pnAsked(W), lines: W.lines });
    ok(J(W.M.geoStatus().down) === J([]), "G: and `geoStatus` no longer names it", W.M.geoStatus());
    await W.M.ensure(song(7), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 5, "G: asked again, it needs three new failures in a row to be down again (one more is not enough)", pnAsked(W));
  }
  {
    // G2 — "no answer" five times is never down; G3 — an answer between failures starts the count over.
    T.now = 5 * DAY;
    const W = clocked(world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: [] } : "network"));
    for (let n = 0; n < 5; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W) === 5 && W.M.geoStatus().down.indexOf("ProxyNova") < 0, "G: a source answering with no answer five times in a row is never down", { pn: pnAsked(W), down: W.M.geoStatus().down });
    let k = 0;
    const seq = ["network", "network", "answer", "network", "network", "network"];
    const W2 = clocked(world((u) => host(u) !== "api.proxynova.com" ? "network" : (seq[k++] === "answer" ? { status: 200, body: pnBody(["DE"], idOfUrl(u)) } : "network")));
    for (let n = 0; n < 5; n++) await W2.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(pnAsked(W2) === 5 && W2.M.geoStatus().down.indexOf("ProxyNova") < 0, "G: two failures, an answer, two failures: the answer started the count over, so not down", { pn: pnAsked(W2), down: W2.M.geoStatus().down });
    await W2.M.ensure(song(5), ["geo"], NOW, { list: "mine" });
    ok(W2.M.geoStatus().down.indexOf("ProxyNova") >= 0, "G CONTROL — the third failure in a row after the answer makes it down", W2.M.geoStatus().down);
  }
  {
    // G5 — `fetchMany`: ProxyNova refusing every group goes down after three, and the rest of its songs go to Invidious.
    T.now = 5 * DAY;
    const W = clocked(world((u) => host(u) === "api.proxynova.com" ? "network" : host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["FR"]) } : "network"));
    const keys = Array.from({ length: 45 }, (_, n) => song(n));
    const r = await W.M.fetchMany(keys, NOW, { list: "room" });
    ok(pnAsked(W) === 3, "G: in `fetchMany`, ProxyNova's groups stop at the third refusal (five groups were due)", pnAsked(W));
    ok(Object.keys(r.answers).length === 45 && keys.every((key) => r.answers[key].source === "invidious"), "G: and every song still gets Invidious' answer", Object.keys(r.answers).length);
    const rows = W.P.geoCountRows().filter((x) => x.source === "proxynova");
    ok(rows.reduce((n, x) => n + x.calls, 0) === 3, "G: only the three calls made are counted", rows);
    await W.M.fetchMany([song(90), song(91)], NOW, { list: "room" });
    ok(pnAsked(W) === 3 && W.urls.filter((x) => host(x.url) === "invidious.nerdvpn.de").length === 47, "G: and a later `fetchMany` skips it while it is down",
      { pn: pnAsked(W), iv: W.urls.filter((x) => host(x.url) === "invidious.nerdvpn.de").length });
  }
  {
    // G8 — YouTube refusing (a 403: a bad key, its quota) goes down the same way, and ProxyNova is asked.
    T.now = 5 * DAY;
    const W = clocked(world((u) => host(u) === "www.googleapis.com" ? { status: 403, body: { error: { code: 403 } } } : host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"], idOfUrl(u)) } : "network"));
    SAK(W.P, "yt", KEY);
    for (let n = 0; n < 4; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    const yts = W.urls.filter((x) => host(x.url) === "www.googleapis.com").length;
    ok(yts === 3 && pnAsked(W) === 4 && W.lines.some((l) => /YouTube is down/.test(l)), "G: YouTube refusing three times is down, and ProxyNova answers instead", { yts, pn: pnAsked(W), lines: W.lines });
  }

  // ── H — THE DEVICE'S ORDER: THE FAVOURITE AND AUTO FALLBACK (J153 (d)) ─────────────────────────────────────────────────
  {
    const RO = (o) => (W0.S && typeof W0.S.regionOrder === "function") ? W0.S.regionOrder("yt", o) : null;
    ok(!!RO({}), "H PREMISE — the song table gives the one order (`Songs.regionOrder`)");
    const ids = (o) => (RO(o) || {}).ids;
    ok(J(ids({})) === J(["proxynova", "youtube", "invidious"]), "H: none chosen, no key: the first ready (ProxyNova) first, then the rest in the table's order", ids({}));
    ok(J(ids({ keyHeld: true })) === J(["youtube", "proxynova", "invidious"]), "H: none chosen, a key held: the table's order", ids({ keyHeld: true }));
    ok(J(ids({ favourite: "invidious" })) === J(["invidious", "youtube", "proxynova"]), "H: a favourite first, then the rest in the table's order", ids({ favourite: "invidious" }));
    ok(J(ids({ favourite: "invidious", fallback: false })) === J(["invidious"]), "H: auto fallback off: the favourite alone", ids({ favourite: "invidious", fallback: false }));
    ok(J(ids({ favourite: "youtube" })) === J(["proxynova", "youtube", "invidious"]) && RO({ favourite: "youtube" }).chosen === "youtube" && RO({ favourite: "youtube" }).chosenReady === false,
      "H: YouTube chosen with no key counts as none chosen — the order applies — and says it was chosen and is not ready", RO({ favourite: "youtube" }));
    ok(J(ids({ fallback: false })) === J(["proxynova"]) && J(ids({ fallback: false, keyHeld: true })) === J(["youtube"]), "H: fallback off and none chosen: the first ready alone", [ids({ fallback: false }), ids({ fallback: false, keyHeld: true })]);
    ok(J(ids({ favourite: "nosuch" })) === J(ids({})) && J((W0.S.regionOrder("sc", {}) || {}).ids) === J([]), "H: an unknown favourite is none; a service with no sources has no order");
    const fav = (f, fb) => ({ geoFavourites: f ? { yt: f } : {}, geoFallback: fb });
    // One song, a favourite, fallback on: asked first; failing, the rest follow (YouTube skipping itself with no key).
    T.now = 5 * DAY;
    let W = clocked(world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) } : "network", fav("invidious", true)));
    let g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(J(hostsOf(W)) === J(["invidious.nerdvpn.de", "yt.chocolatemoo53.com", "invidious.tiekoetter.com", "api.proxynova.com"]) && g.geo && g.geo.source === "proxynova",
      "H: the favourite (Invidious) is asked first; failing, the rest in the table's order (ProxyNova answers)", hostsOf(W));
    // Fallback off: the favourite alone, and nothing else when it fails.
    W = clocked(world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) } : "network", fav("invidious", false)));
    g = await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(hostsOf(W).every((h) => h !== "api.proxynova.com") && hostsOf(W).length === 3 && !g.geo, "H: auto fallback off: only the favourite is asked, and nothing when it fails", hostsOf(W));
    // Fallback off, none chosen, no key: ProxyNova alone.
    W = clocked(world(() => "network", fav(null, false)));
    await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(J(hostsOf(W)) === J(["api.proxynova.com"]), "H: auto fallback off and none chosen: the first ready source alone (ProxyNova with no key)", hostsOf(W));
    // YouTube chosen without a key: the order applies.
    W = clocked(world((u) => host(u) === "api.proxynova.com" ? { status: 200, body: pnBody(["DE"]) } : "network", fav("youtube", true)));
    await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(J(hostsOf(W)) === J(["api.proxynova.com"]), "H: YouTube chosen with no key counts as none chosen: ProxyNova is asked", hostsOf(W));
    // A favourite with the key held: ProxyNova first, then YouTube, then Invidious.
    W = clocked(world(() => "network", fav("proxynova", true)));
    SAK(W.P, "yt", KEY);
    await W.M.ensure(YT, ["geo"], NOW, { list: "mine" });
    ok(J(hostsOf(W).slice(0, 2)) === J(["api.proxynova.com", "www.googleapis.com"]), "H: ProxyNova chosen with a key held: ProxyNova first, then YouTube", hostsOf(W));
    // A favourite that is down: skipped with fallback on; nothing asked with it off.
    W = clocked(world((u) => host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["FR"]) } : "network", fav(null, true)));
    for (let n = 0; n < 3; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(J(W.M.geoStatus().down) === J(["ProxyNova"]), "H PREMISE — ProxyNova, the first ready, is down", W.M.geoStatus().down);
    const n0 = W.urls.length;
    g = await W.M.ensure(song(9), ["geo"], NOW, { list: "mine" });
    ok(J(hostsOf(W).slice(n0)) === J(["invidious.nerdvpn.de"]) && g.geo && g.geo.source === "invidious", "H: with fallback on, the favourite down is skipped and the next answers", hostsOf(W).slice(n0));
    W.P.setGeoFallback(false);
    const n1 = W.urls.length;
    g = await W.M.ensure(song(10), ["geo"], NOW, { list: "mine" });
    ok(W.urls.length === n1 && !g.geo, "H: with fallback off, the favourite down means nothing is asked", hostsOf(W).slice(n1));
    // Many songs: the favourite first too.
    W = clocked(world((u) => host(u) === "invidious.nerdvpn.de" ? { status: 200, body: ivBody(["FR"]) } : "network", fav("invidious", true)));
    const r = await W.M.fetchMany([song(1), song(2)], NOW, { list: "room" });
    ok(hostsOf(W).every((h) => h === "invidious.nerdvpn.de") && hostsOf(W).length === 2 && r.answers[song(1)] && r.answers[song(1)].source === "invidious",
      "H: `fetchMany` asks the favourite first too (Invidious, one song a call)", hostsOf(W));
  }

  // ── I — INVIDIOUS' SERVERS: AN ANSWER WITHOUT A LIST IS NO ANSWER, NOT A FAILURE ───────────────────────────────────────
  {
    T.now = 5 * DAY;
    const fav = { geoFavourites: { yt: "invidious" }, geoFallback: false };
    let W = clocked(world((u) => /invidious|chocolatemoo/.test(host(u)) ? { status: 200, body: { error: "Video unavailable" } } : "network", fav));
    for (let n = 0; n < 4; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(W.urls.length === 12 && J(W.M.geoStatus().down) === J([]), "I: every server answering without a list, four songs running: Invidious is not down (each song asked of all three servers)", { n: W.urls.length, down: W.M.geoStatus().down });
    W = clocked(world(() => "network", fav));
    for (let n = 0; n < 3; n++) await W.M.ensure(song(n), ["geo"], NOW, { list: "mine" });
    ok(J(W.M.geoStatus().down) === J(["Invidious"]), "I CONTROL — every server failing, three songs running: Invidious is down", W.M.geoStatus().down);
  }

  if (failed) { console.log("[geo-sources] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[geo-sources] PASS — where a song is blocked is asked of the owner's three sources in his order (" + asserts + " assertions). " +
    "THE PARSERS (the song table's) read each source's documented answers (YouTube's allowed/blocked/none/empty-allowed/embeddable, ProxyNova's list with " +
    "EU and ZZ, Invidious' allowedRegions) and refuse another video's, an error and junk. THE ORDER, the table's: YouTube with a key, else ProxyNova, " +
    "then Invidious' servers in turn; a song not YouTube's asks nobody. THE FALL-THROUGH on a 403, junk, a 503 and a network error, named " +
    "in the first lookup's one line. COUNTED by source and list per hour; ProxyNova stops at 900 songs a day. THE KEY reaches no log line, " +
    "and its field takes only Google's form, for YouTube alone. MANY AT ONCE (the bot's whole queue): groups of up to 50 for YouTube and 10 for " +
    "ProxyNova, one call each, counted, trimmed by the daily limit, the unanswered falling through. DOWN (J153 (d)): three failures in a row, " +
    "never no answer, skipped ten minutes by the lookup path's own clock, said each way, handing the rest on part-way. THE DEVICE'S ORDER: the " +
    "favourite first, the rest with auto fallback on, the favourite alone with it off, one not ready counting as none. INVIDIOUS' servers " +
    "answering without a list are no answer, not a failure. THIS GUARD CANNOT TELL YOU A SOURCE ANSWERS A BROWSER TODAY: the network here is a stand-in " +
    "built from each source's documentation (his sitting, L5)");
  process.exit(0);
})().catch((e) => { console.log("[geo-sources] FAIL — the guard threw: " + (e && e.stack || e)); process.exit(1); });
