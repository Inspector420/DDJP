// tests/check-geo-device.js
// SUBJECT: core/chatprefs.js, ui/settings.js, ui/playlists.js, ui/queue.js, core/songs.js
//
// WALL: WHERE SONGS ARE BLOCKED IS THIS DEVICE'S TO LOOK UP — ITS THREE SETTINGS, ITS CARD, AND ONLY THE SONGS ON ITS SCREEN
// (J153 (c), the owner's: "only songs that are being looked at in the UI do a query"; "valid 30 60 90 or 365 days as a
// local setting … default 90"; on by default, his "works out of the box").
//
//   A  THE SETTINGS (`core/chatprefs.js`, real, over a localStorage double, through the real Store): on, 90 days and no key
//      by default; the expiry only 30/60/90/365 (anything else refused, the choice kept); each survives a reload; a stored
//      junk value reads as the default; the key is kept per song service, in the form the song table gives that service
//      (`core/songs.js`), and none for a service with no form; the lookups' counts are rebuilt row by row on load (junk
//      rows dropped) and capped.
//   B  THE CARD (`ui/settings.js`' own functions, extracted by name and run over the REAL song table): "Where songs are
//      blocked", with a note that a lookup tells the service this device's address and which song, and the sources in the
//      table's order; a key's field for each service the table gives a key's form, and none for another; the switch, ticked,
//      saving; the key's field a password field that refuses what is not a key and says why, keeps a key, then never shows
//      it (only "A key is set" and Remove); the key's note advising a restriction to the app's address and naming what the
//      app cannot hide; the four expiry choices in order, 90 chosen, a pick saved.
//   C  ONLY THE SONGS ON SCREEN (`tests/_screen-world.js`: the real ui/ code builds the room queue, My queue, History and a
//      playlist; then the real `_thumbProcess` runs over each drawn row against the real `MetadataService`, its real
//      providers over a recording network): the room queue's waiting songs, My queue and a playlist's songs are fetch rows
//      naming their list, and each one's song is looked up and counted under that list; the song playing and History are
//      cacheOnly, name no list, and look nothing up; with the device's switch off, a fetch row looks nothing up.
//   D  THE CARD IS IN THE PANEL: the real `renderChatSettings`, drawing the whole local Settings sub-tab with the real
//      preferences, puts "Where songs are blocked" after "Sounds" — a card nothing draws would pass B alone — and the panel's
//      lock, shut by default, covers its controls.
//   E  THE FAVOURITE AND AUTO FALLBACK (J153 (d), the owner's "auto fallback and lets you pick a favorite"; on every device's
//      card, the supervisor's): the two settings (`core/chatprefs.js`, real) — no favourite and fallback on by default, a
//      favourite only a source the song table gives that service, "" clearing it, both surviving a reload, junk reading as
//      the defaults, and the one reading of them (`geoChoices`); and their rows on the card, run from ui/settings.js over the
//      real song table and the real lookup path's numbers: the service's sources in the table's order, the one asked first
//      chosen (the order's first ready when none is chosen: ProxyNova with no key, YouTube with one), a pick saved, a chosen
//      source that is not ready kept but said why, and the fallback switch, ticked, saving, its note saying what each state
//      does and what down means (the lookup path's own numbers, never the card's).
//
// What a browser draws is not here: the card's look is the panel's own classes, borrowed (`pref-section`, `pref-note`,
// `pref-master-row`, `pref-add-row`, `set-choices`).
"use strict";
const vm = require("vm");
const { loadInContext } = require("./_load");
const CW = require("./_chat-world.js");
const XI = require("./_probe-j14-card.js");
const S = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[geo-device] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 400) : "")); }
}
const J = (x) => JSON.stringify(x);
const KEY = "AIza" + "Q".repeat(35);
function lsDouble(init) {
  return { _v: Object.assign({}, init || {}), getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
    setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
}
// The device's key, per service: a tree without these accessors reads null and fails by name rather than throwing.
const AK = (P, s) => (P && typeof P.apiKey === "function") ? P.apiKey(s) : null;
const SAK = (P, s, k) => (P && typeof P.setApiKey === "function") ? P.setApiKey(s, k) : null;
const prefsOver = (ls) => loadInContext(["core/logger.js", "core/storageio.js", "core/store.js", "core/chatprefs.js"], { localStorage: ls }).ChatPrefs;

(async () => {
  // ═══ A — THE SETTINGS ═══
  {
    const ls = lsDouble();
    const P = prefsOver(ls);
    ok(P.geoLookup() === true && P.geoRecheckDays() === 90 && AK(P, "yt") === "", "A: by default on, 90 days, no key",
      { on: P.geoLookup(), days: P.geoRecheckDays(), key: AK(P, "yt") });
    ok(J(P.GEO_RECHECK_DAYS) === J([30, 60, 90, 365]), "A: the expiry's choices are the owner's four", P.GEO_RECHECK_DAYS);
    for (const bad of [0, 29, 31, 45, 91, 364, 366, "90", null]) ok(P.setGeoRecheckDays(bad) === false && P.geoRecheckDays() === 90, "A: the expiry refuses " + J(bad) + " and keeps its choice");
    ok(P.setGeoRecheckDays(365) === true && P.geoRecheckDays() === 365, "A CONTROL — 365 is taken");
    P.setGeoLookup(false);
    ok(SAK(P, "yt", KEY) === true, "A PREMISE — a key is kept");
    const P2 = prefsOver(ls);
    ok(P2.geoLookup() === false && P2.geoRecheckDays() === 365 && AK(P2, "yt") === KEY, "A: each survives a reload (the same device's storage)",
      { on: P2.geoLookup(), days: P2.geoRecheckDays(), key: AK(P2, "yt") === KEY });
    const raw = Object.keys(ls._v).map((k) => ls._v[k]).join("");
    ok(raw.indexOf(KEY) >= 0, "A PREMISE — the key is in this device's preferences, and only there (the subject of `main/07-security.md`'s note)");
  }
  {
    // junk in storage reads as the defaults, and the counts are rebuilt row by row
    const ls = lsDouble();
    const P0 = prefsOver(ls);
    P0.setGeoLookup(true);   // write once, to learn the key the preferences are stored under
    const k = Object.keys(ls._v).find((x) => /pref/i.test(x)) || Object.keys(ls._v)[0];
    const stored = JSON.parse(ls._v[k]);
    stored.geoLookup = "no"; stored.geoRecheckDays = 45; stored.apiKeys = { yt: "not-a-key", sc: KEY, zz: KEY };
    stored.geoCounts = [{ s: "proxynova", l: "room", h: 5, c: 2, i: 2, extra: "x" }, { s: 7, l: "room", h: 5 }, "junk", { s: "youtube", l: "mine", h: 1.5 }];
    ls._v[k] = JSON.stringify(stored);
    const P = prefsOver(ls);
    ok(P.geoLookup() === true && P.geoRecheckDays() === 90 && AK(P, "yt") === "" && AK(P, "sc") === "" && AK(P, "zz") === "",
      "A: stored junk reads as the defaults (anything but a real false is on; a key not in its service's form, or for a service with none, is no key)",
      { on: P.geoLookup(), days: P.geoRecheckDays(), keys: [AK(P, "yt"), AK(P, "sc"), AK(P, "zz")] });
    ok(J(P.geoCountRows()) === J([{ source: "proxynova", list: "room", hour: 5, calls: 2, ids: 2 }]), "A: the counts are rebuilt row by row: unknown keys and junk rows dropped", P.geoCountRows());
    {
      const ls2 = lsDouble();
      const Q0 = prefsOver(ls2);
      Q0.setGeoLookup(true);
      const k2 = Object.keys(ls2._v).find((x) => /pref/i.test(x)) || Object.keys(ls2._v)[0];
      const st2 = JSON.parse(ls2._v[k2]);
      st2.apiKeys = "junk";
      ls2._v[k2] = JSON.stringify(st2);
      const Q = prefsOver(ls2);
      let kept = false;
      try { kept = SAK(Q, "yt", KEY) === true && AK(Q, "yt") === KEY; } catch (e) { kept = "threw: " + e.message; }
      ok(kept === true, "A: a stored key map of the wrong shape is rebuilt on load, so a key can still be kept", kept);
    }
    for (let h = 0; h < 400; h++) P.geoCountAdd("proxynova", "room", 1, 1000 + h);
    ok(P.geoCountRows().length <= 25 && P.geoCountRows().every((r) => r.hour > 1399 - 25), "A: counts older than a day are dropped as each is added", P.geoCountRows().length);
    for (const src of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"]) for (const l of ["room", "mine", "playlist"]) for (let h = 0; h < 10; h++) P.geoCountAdd(src, l, 1, 2000 + h);
    ok(P.geoCountRows().length <= 300, "A: the counts are capped (the synchronous localStorage tier must never grow)", P.geoCountRows().length);
  }

  // ═══ B — THE CARD ═══
  {
    const NAMES = ["_prefCard", "_geoSection", "_GEO_RECHECK_CHOICES", "_choiceList"];
    const X = NAMES.map((n) => XI.extractNamed("ui/settings.js", n));
    ok(X.every((x) => x.ok), "B PREMISE — the card's functions are each declared once in ui/settings.js", X.map((x, i) => NAMES[i] + ": " + (x.stage || "ok")));
    const flat = (n) => [n].concat(...(n.children || []).map(flat));
    const P = prefsOver(lsDouble());
    const seen = { redraws: 0 };
    const SONGS = loadInContext([], {}).Songs;
    const ctx = { H: { el: CW.el }, ChatPrefs: P, Songs: SONGS, renderChatSettings: () => { seen.redraws++; } };
    vm.createContext(ctx);
    if (X.every((x) => x.ok)) vm.runInContext("let _geoSaid = \"\";\n" + X.map((x) => x.source).join("\n") + "\n;this.section = _geoSection;", ctx);
    const card = () => { const sec = ctx.section ? ctx.section() : null; return { sec, all: sec ? flat(sec) : [] }; };
    const textOf = (c) => c.all.map((n) => n._text || "").join(" | ");
    let c = card();
    const t = textOf(c);
    ok(/Where songs are blocked/.test(t), "B: the card is headed \"Where songs are blocked\"", t.slice(0, 120));
    ok(/this device's address and which song/.test(t), "B: a note says plainly that a lookup tells the service this device's address and which song", t);
    ok(/YouTube[^|]*then ProxyNova; then Invidious/.test(t), "B: the note names the sources in their order", t);
    ok(/Applies to this device only/.test(t), "B: the card says it is this device's");
    const box = c.all.find((n) => n.tag === "input" && n.attrs.type === "checkbox");
    ok(box && box.checked === true && /Look up where songs are blocked/.test((box.parent && box.parent.textContent) || ""), "B: the switch, labelled, ticked by default", box && box.parent && box.parent.textContent);
    if (box) { box.checked = false; box.onchange(); }
    ok(P.geoLookup() === false && seen.redraws === 1, "B: unticked, it saves and the panel redraws", { on: P.geoLookup(), redraws: seen.redraws });
    P.setGeoLookup(true);
    // the key
    c = card();
    let input = c.all.find((n) => n.tag === "input" && n.dataset && n.dataset.kind === "apiKey");
    const keyOf = (sh) => (typeof SONGS.apiKeyOf === "function") ? SONGS.apiKeyOf(sh) : null;
    const keyed = SONGS.services().filter((r) => keyOf(r.short)).map((r) => r.short);
    ok(J(keyed) === J(["yt"]) && SONGS.services().some((r) => !keyOf(r.short)),
      "B PREMISE — the table gives YouTube a key's form and another service none", keyed);
    ok(J(c.all.filter((n) => n.tag === "input" && n.dataset && n.dataset.kind === "apiKey").map((n) => n.dataset.service)) === J(keyed),
      "B: a key's field for each service the table gives a key's form, and none for another",
      c.all.filter((n) => n.tag === "input" && n.dataset && n.dataset.kind === "apiKey").map((n) => n.dataset.service));
    ok(input && input.attrs.type === "password" && input.attrs.autocomplete === "off", "B: the key's field is a password field, not remembered by the browser", input && input.attrs);
    let save = c.all.find((n) => n.tag === "button" && n._text === "Save");
    ok(!!save, "B PREMISE — the key's Save button");
    if (input && save) { input.value = "not a key"; save.onclick(); }
    ok(AK(P, "yt") === "", "B: what is not a key is refused and nothing is kept");
    c = card();
    ok(/isn’t a YouTube key: a key starts with AIza and is 39 characters long/.test(textOf(c)), "B: and the card says why, after its redraw", textOf(c).slice(0, 300));
    ok(!/isn’t a YouTube key/.test(textOf(card())), "B: said once, then gone");
    c = card();
    input = c.all.find((n) => n.tag === "input" && n.dataset && n.dataset.kind === "apiKey");
    save = c.all.find((n) => n.tag === "button" && n._text === "Save");
    if (input && save) { input.value = "  " + KEY + "  "; save.onclick(); }
    ok(AK(P, "yt") === KEY, "B: a key in Google's form is kept (spaces around it trimmed)");
    c = card();
    const keyShown = c.all.some((n) => (n._text || "").indexOf(KEY) >= 0 || (n.value || "").indexOf(KEY) >= 0 || J(n.attrs || {}).indexOf(KEY) >= 0);
    ok(!keyShown, "B: once kept, the key is drawn NOWHERE on the card");
    ok(/A key is set/.test(textOf(c)) && !c.all.some((n) => n.dataset && n.dataset.kind === "apiKey"), "B: the card says a key is set, with no field holding it", textOf(c).slice(0, 300));
    ok(/restrict it to this app's address \(HTTP referrer\)/.test(textOf(c)) && /developer console can still show a failed request's address, key included/.test(textOf(c)) &&
      /never sent to the room and never written in the log/.test(textOf(c)),
      "B: the key's note advises restricting it to the app's address, and names what the app cannot hide", textOf(c));
    const rm = c.all.find((n) => n.tag === "button" && n.attrs.title === "Remove");
    if (rm) rm.onclick();
    ok(AK(P, "yt") === "", "B: Remove clears the key");
    // the expiry
    c = card();
    const radios = c.all.filter((n) => n.tag === "input" && n.attrs.type === "radio" && n.name === "set-geoRecheck");
    const label = (r) => (r.parent && r.parent.textContent) || "";
    ok(J(radios.map(label)) === J(["30 days", "60 days", "90 days", "365 days"]), "B: the four expiry choices, in order", radios.map(label));
    ok(radios.length === 4 && radios[2].checked === true && radios.filter((r) => r.checked).length === 1, "B: 90 days chosen by default", radios.map((r) => !!r.checked));
    ok(/Recheck blocked countries after/.test(textOf(c)), "B: headed \"Recheck blocked countries after\"");
    if (radios.length === 4) { radios[3].checked = true; radios[3].onchange(); }
    ok(P.geoRecheckDays() === 365, "B: a pick is saved", P.geoRecheckDays());
  }

  // ═══ C — ONLY THE SONGS ON SCREEN ═══
  {
    const NOW = 1.9e12;
    const YT1 = "yt:AAAAAAAAAAA", YT2 = "yt:BBBBBBBBBBB", YT3 = "yt:CCCCCCCCCCC", YT4 = "yt:DDDDDDDDDDD", YT5 = "yt:EEEEEEEEEEE";
    const st = {
      playing: { dj: "@dj:hs", song: { songKey: YT1 }, pi: "p0" },
      rotation: [{ user: "@ann:hs", pending: [{ songKey: YT2 }] }],
      mine: [{ songKey: YT3 }],
      history: [{ songKey: YT4, dj: "@ann:hs", at: NOW - 60000, pi: "h1", cutShortBy: false }],
      playlist: { id: "pl_mix", name: "Mix", tracks: [{ songKey: YT5 }] },
    };
    const features = {
      Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }], getMyId: () => "@me:hs",
        getRoster: () => [{ userId: "@dj:hs", level: 10 }, { userId: "@ann:hs", level: 10 }], recentEvents: () => ({ rows: [] }), FEED_KINDS: {} },
      Queue: { getNowPlaying: () => st.playing, getRotation: () => st.rotation, lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
        recentHistory: () => st.history, historyReach: () => ({ entries: 1, complete: true }), getState: () => ({ counts: {} }) },
      UserQueue: { items: () => st.mine.slice(), count: () => st.mine.length, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
      Reactions: { hasSaved: () => false, hasVoted: () => false },
      Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
      Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible: () => {} },
      ChatPrefs: { layout: () => "wide", setLayout: () => {}, playerHidden: () => false, overlayBlocked: () => false, previewVolume: () => null, previewMuted: () => null },
      Playlists: { list: () => [{ id: st.playlist.id, name: st.playlist.name }], get: () => Promise.resolve(JSON.parse(J(st.playlist))), addTrackByUrl: () => Promise.resolve({ ok: true }) },
      ServerClock: { serverNow: () => NOW },
      Store: { meta: { peek: (k) => ({ title: "Title of " + k, durationSec: 200 }), load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null), has: () => Promise.resolve(false) } },
    };
    const w = S.world({ features, domShaped: true, globals: { URL, MetadataService: { thumbUrl: (k) => "https://i.ytimg.com/vi/" + k.slice(3) + "/mqdefault.jpg", get: () => Promise.resolve(null) },
      SC: { Widget: function () { return { bind() {}, unbind() {} }; } }, YT: { Player: function () { return {}; } } } });
    w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
    const qa = (sel, root) => Array.from((root || w.main).querySelectorAll(sel));
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const qb = w.refs.queueBody;
    const places = [];
    w.refs.tabRoom && w.refs.tabRoom.click();
    for (let i = 0; i < 4; i++) await tick();
    const np = qa(".rq-list .song-row.playing", qb)[0];
    if (np) places.push(["the song playing", np, "cacheOnly", null]);
    for (const r of qa(".rq-list .song-row", qb)) if (r !== np && !/\brq-np-empty\b/.test(r.className)) places.push(["a room queue row", r, "fetch", "room"]);
    w.refs.tabMine.click();
    for (const r of qa(".song-row", qb)) places.push(["a My queue row", r, "fetch", "mine"]);
    w.refs.tabHistory.click();
    for (const r of qa(".hist-list .song-row", qb)) places.push(["a History row", r, "cacheOnly", null]);
    w.refs.tabPlaylists.click();
    const nm = qa(".pl-name", qb).find((b) => b.textContent === "Mix");
    if (nm) nm.click();
    for (let i = 0; i < 6; i++) await tick();
    for (const r of qa(".song-row", qb)) places.push(["a playlist's song", r, "fetch", "playlist"]);
    const thumbOf = (row) => qa("img.thumb", row)[0] || null;
    const kinds = Array.from(new Set(places.map(([p]) => p)));
    ok(J(kinds) === J(["the song playing", "a room queue row", "a My queue row", "a History row", "a playlist's song"]),
      "C PREMISE — the real ui/ code drew every list a song shows in", kinds);
    for (const [place, row, mode, list] of places) {
      const img = thumbOf(row);
      const got = img ? { mode: img.dataset.thumbMode, list: img.dataset.list === undefined ? null : img.dataset.list } : null;
      ok(got && got.mode === mode && got.list === list, "C: " + place + " is " + mode + (list ? ", naming its list \"" + list + "\"" : ", naming no list"), got);
    }
    // The real `_thumbProcess`, run over each drawn row, against the real MetadataService and its real providers.
    const X = XI.extractNamed("ui/playlists.js", "_thumbProcess");
    ok(X.ok, "C PREMISE — `_thumbProcess` is declared once in ui/playlists.js", X.stage);
    function lookupWorld() {
      let prefs = null;
      const urls = [];
      const fetch = (url) => { urls.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: String(url).split("id=")[1], blocked: ["DE"] }]) }); };
      const M = loadInContext(["core/countries.js", "core/chatprefs.js", "features/metadata.js"], {
        Store: { meta: { load: () => Promise.resolve(null), persist: () => Promise.resolve(true) }, prefs: { load: () => prefs, save: (v) => { prefs = JSON.parse(J(v)); } } },
        Logger: { info() {}, debug() {}, warn() {}, error() {} }, fetch, setTimeout, clearTimeout, AbortController,
      });
      return { MS: M.MetadataService, P: M.ChatPrefs, urls };
    }
    async function process(lw, row) {
      const img = thumbOf(row);
      const vid = img && img.dataset.vid;
      const ctx = { MetadataService: lw.MS, Store: { images: { load: () => Promise.resolve(null) } }, Date, Promise,
        _thumbNode: () => img, _thumbShowBlob() {}, _thumbShowUrl() {}, _thumbDecorateMeta() {} };
      vm.createContext(ctx);
      vm.runInContext(X.source + "\n;this.run = _thumbProcess;", ctx);
      await ctx.run(vid);
      for (let i = 0; i < 6; i++) await tick();
      return vid;
    }
    if (X.ok) {
      for (const [place, row, mode, list] of places) {
        const lw = lookupWorld();
        const vid = await process(lw, row);
        const rows = lw.P.geoCountRows();
        if (mode === "fetch") {
          ok(lw.urls.length === 1 && lw.urls[0].indexOf(vid.slice(3)) > 0 && rows.length === 1 && rows[0].list === list,
            "C: " + place + "'s song is looked up, and counted under \"" + list + "\"", { urls: lw.urls, rows });
        } else {
          ok(lw.urls.length === 0 && rows.length === 0, "C: " + place + " looks nothing up (drawn from saved answers only)", { urls: lw.urls, rows });
        }
      }
      // the device's switch off: a fetch row looks nothing up
      const fetchRow = places.find(([, , m]) => m === "fetch");
      const lw = lookupWorld();
      lw.P.setGeoLookup(false);
      if (fetchRow) await process(lw, fetchRow[1]);
      ok(fetchRow && lw.urls.length === 0 && lw.P.geoCountRows().length === 0, "C: with the device's switch OFF, a fetch row looks nothing up", { urls: lw.urls });
    }
  }

  // ═══ D — THE CARD IS IN THE PANEL ═══
  {
    const P = prefsOver(lsDouble());
    const features = {
      Room: { rankLadder: () => [], getMyId: () => "@me:hs", getRoster: () => [], recentEvents: () => ({ rows: [] }), FEED_KINDS: {} },
      Queue: { getNowPlaying: () => null, getRotation: () => [], lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000, recentHistory: () => [],
        historyReach: () => ({ entries: 0, complete: true }), getState: () => ({ counts: {} }) },
      UserQueue: { items: () => [], count: () => 0, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
      Reactions: { hasSaved: () => false, hasVoted: () => false },
      Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
      Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible: () => {} },
      ChatPrefs: P,
      Playlists: { list: () => [], get: () => Promise.resolve(null) },
      ServerClock: { serverNow: () => 1 },
      Store: { meta: { peek: () => null, load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null), has: () => Promise.resolve(false) } },
    };
    const w = S.world({ features, domShaped: true, globals: { URL, MetadataService: { thumbUrl: () => null, get: () => Promise.resolve(null) }, YT: { Player: function () { return {}; } } } });
    w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
    let threw = null;
    try { w.sb.Settings.renderChatSettings(); } catch (e) { threw = e.message; }
    const box = w.refs.chatSettingsBox;
    const heads = box ? Array.from(box.querySelectorAll(".set-card-head")).map((n) => n.textContent) : [];
    ok(!threw && heads.length >= 3, "D PREMISE — the real local Settings panel drew its cards", { threw, heads });
    const at = heads.indexOf("Where songs are blocked");
    ok(at >= 0 && at === heads.indexOf("Sounds") + 1, "D: the panel draws \"Where songs are blocked\", after \"Sounds\"", heads);
    const card = at >= 0 ? box.querySelectorAll(".set-card-head")[at].parentNode : null;
    const controls = card ? Array.from(card.querySelectorAll("input, button")) : [];
    ok(controls.length >= 4 && controls.every((n) => n.disabled === true), "D: the panel's lock, shut by default, covers the card's controls",
      controls.map((n) => (n.tagName || n.tag) + ":" + !!n.disabled));
  }

  // ═══ E — THE FAVOURITE AND AUTO FALLBACK (J153 (d)) ═══
  {
    const ls = lsDouble();
    const P = prefsOver(ls);
    const has = ["geoFavourite", "setGeoFavourite", "geoFallback", "setGeoFallback", "geoChoices"].every((f) => typeof P[f] === "function");
    ok(has, "E PREMISE — the preferences carry the favourite, auto fallback and their one reading");
    if (has) {
      ok(P.geoFavourite("yt") === "" && P.geoFallback() === true, "E: by default no favourite is chosen and auto fallback is on",
        { fav: P.geoFavourite("yt"), fb: P.geoFallback() });
      for (const [sh, id] of [["yt", "nosuch"], ["sc", "proxynova"], ["zz", "youtube"], ["yt", 7], [7, "youtube"]]) {
        ok(P.setGeoFavourite(sh, id) === false && P.geoFavourite("yt") === "", "E: a favourite that is not a source the table gives that service is refused: " + J([sh, id]));
      }
      ok(P.setGeoFavourite("yt", "invidious") === true && P.geoFavourite("yt") === "invidious", "E CONTROL — one of YouTube's sources is kept as its favourite");
      P.setGeoFallback(false);
      const P2 = prefsOver(ls);
      ok(P2.geoFavourite("yt") === "invidious" && P2.geoFallback() === false, "E: both survive a reload", { fav: P2.geoFavourite("yt"), fb: P2.geoFallback() });
      ok(J(P2.geoChoices("yt")) === J({ favourite: "invidious", fallback: false, keyHeld: false }), "E: the one reading of them, as the order takes it", P2.geoChoices("yt"));
      SAK(P2, "yt", KEY);
      ok(P2.geoChoices("yt").keyHeld === true, "E: the reading says when the service's key is held", P2.geoChoices("yt"));
      ok(P2.setGeoFavourite("yt", "") === true && P2.geoFavourite("yt") === "", "E: an empty choice clears the favourite");
      const k = Object.keys(ls._v).find((x) => /pref/i.test(x)) || Object.keys(ls._v)[0];
      const stored = JSON.parse(ls._v[k]);
      stored.geoFavourites = { yt: "bogus", sc: "proxynova", zz: "youtube" }; stored.geoFallback = "no";
      ls._v[k] = JSON.stringify(stored);
      const P3 = prefsOver(ls);
      ok(P3.geoFavourite("yt") === "" && P3.geoFavourite("sc") === "" && P3.geoFallback() === true,
        "E: stored junk reads as the defaults (a favourite not the service's own is none; anything but a real false is on)", { yt: P3.geoFavourite("yt"), sc: P3.geoFavourite("sc"), fb: P3.geoFallback() });
      stored.geoFavourites = "junk"; ls._v[k] = JSON.stringify(stored);
      const P4 = prefsOver(ls);
      let kept = false;
      try { kept = P4.setGeoFavourite("yt", "proxynova") === true && P4.geoFavourite("yt") === "proxynova"; } catch (e) { kept = "threw: " + e.message; }
      ok(kept === true, "E: a stored favourites map of the wrong shape is rebuilt on load, so a favourite can still be chosen", kept);
    }
    // THE ROWS ON THE CARD
    const NAMES = ["_prefCard", "_geoSection", "_GEO_RECHECK_CHOICES", "_choiceList"];
    const X = NAMES.map((n) => XI.extractNamed("ui/settings.js", n));
    const flat = (n) => [n].concat(...(n.children || []).map(flat));
    const Q = prefsOver(lsDouble());
    const seen = { redraws: 0 };
    const LW = loadInContext(["core/countries.js", "core/chatprefs.js", "features/metadata.js"], {
      Store: { meta: { load: () => Promise.resolve(null), persist: () => Promise.resolve(true) }, prefs: { load: () => null, save() {} } },
      Logger: { info() {}, debug() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
    const ctx = { H: { el: CW.el }, ChatPrefs: Q, Songs: LW.Songs, MetadataService: LW.MetadataService, renderChatSettings: () => { seen.redraws++; } };
    vm.createContext(ctx);
    if (X.every((x) => x.ok)) vm.runInContext("let _geoSaid = \"\";\n" + X.map((x) => x.source).join("\n") + "\n;this.section = _geoSection;", ctx);
    const card = () => { const sec = ctx.section ? ctx.section() : null; return { sec, all: sec ? flat(sec) : [] }; };
    const textOf = (c) => c.all.map((n) => n._text || "").join(" | ");
    const favs = (c) => c.all.filter((n) => n.tag === "input" && n.attrs.type === "radio" && n.name === "set-geoFavourite-yt");
    const label = (r) => (r.parent && r.parent.textContent) || "";
    const chosen = (c) => favs(c).filter((r) => r.checked).map(label);
    let c = card();
    ok(/Favourite source/.test(textOf(c)), "E: the card has \"Favourite source\"", textOf(c).slice(0, 200));
    ok(J(favs(c).map(label)) === J(LW.Songs.regionSources().filter((x) => x.short === "yt").map((x) => x.name)) && favs(c).length === 3,
      "E: its choices are YouTube's sources, in the song table's order", favs(c).map(label));
    ok(J(chosen(c)) === J(["ProxyNova"]), "E: with no key and none chosen, the order's first ready source is shown as asked first: ProxyNova", chosen(c));
    ok(/Asked first\./.test(textOf(c)), "E: and its note says it is asked first", textOf(c));
    SAK(Q, "yt", KEY);
    ok(J(chosen(card())) === J(["YouTube"]), "E: with a key and none chosen, YouTube is asked first", chosen(card()));
    SAK(Q, "yt", "");
    c = card();
    const yt = favs(c).find((r) => label(r) === "YouTube");
    if (yt) { yt.checked = true; yt.onchange(); }
    ok(Q.geoFavourite("yt") === "youtube" && seen.redraws === 1, "E: a pick is saved, and the panel redraws", { fav: Q.geoFavourite("yt"), redraws: seen.redraws });
    c = card();
    ok(J(chosen(c)) === J(["YouTube"]) && /YouTube needs your own key on this device: until one is set, ProxyNova is asked first\./.test(textOf(c)),
      "E: a chosen source that is not ready stays chosen, and the card says why another is asked first", { chosen: chosen(c), text: textOf(c) });
    const fbox = () => card().all.find((n) => n.tag === "input" && n.attrs.type === "checkbox" && /Auto fallback/.test((n.parent && n.parent.textContent) || ""));
    let fb = fbox();
    ok(fb && fb.checked === true, "E: the \"Auto fallback\" switch, ticked by default", fb && fb.checked);
    c = card();
    ok(/When the favourite gives no answer or is down, the others are asked in turn\. A source that fails 3 times in a row is down, and is left alone for 10 minutes\./.test(textOf(c)),
      "E: its note says what it does and what down means, in the lookup path's own numbers", textOf(c));
    if (fb) { fb.checked = false; fb.onchange(); }
    ok(Q.geoFallback() === false && seen.redraws === 2, "E: unticked, it saves and the panel redraws", { fb: Q.geoFallback(), redraws: seen.redraws });
    ok(/Only the favourite is asked\. When it gives no answer or is down, nothing is looked up\./.test(textOf(card())), "E: off, the note says only the favourite is asked", textOf(card()));
    ok(LW.MetadataService && LW.MetadataService.DOWN_AFTER === 3 && LW.MetadataService.DOWN_MS === 600000,
      "E PREMISE — the note's numbers are the lookup path's (3 failures, 10 minutes)", LW.MetadataService && [LW.MetadataService.DOWN_AFTER, LW.MetadataService.DOWN_MS]);
  }

  if (failed) { console.log("[geo-device] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[geo-device] PASS — where songs are blocked is this device's to look up (" + asserts + " assertions). THE SETTINGS: on, 90 days " +
    "and no key by default; the expiry only the owner's 30/60/90/365; each survives a reload; junk reads as the default; the counts " +
    "rebuilt row by row, a day kept, capped; a key per service, in the table's form. THE CARD, run from ui/settings.js over the song " +
    "table: a lookup's cost said plainly (this device's address and the song) and the table's sources in order; the switch; a key's " +
    "field only for a service the table gives one; a password field that refuses what is not a key and says why, and once a " +
    "key is kept shows only that one is set; the referrer advice; the four expiry choices. ONLY THE SONGS ON SCREEN: the real lists " +
    "drawn, the real _thumbProcess run over each row against the real lookup path — the room queue's waiting songs, My queue and a " +
    "playlist look up and count under their own list; the song playing and History look nothing up; the switch off looks nothing up. " +
    "THE CARD IS IN THE PANEL, after Sounds, under the panel's lock. THE FAVOURITE AND AUTO FALLBACK (J153 (d)): kept per service, only the " +
    "table's sources, surviving a reload; on the card in the table's order, the order's first ready shown when none is chosen, a chosen " +
    "source that is not ready said why, the fallback switch and what down means, in the lookup path's numbers");
  process.exit(0);
})().catch((e) => { console.log("[geo-device] FAIL — the guard threw: " + (e && e.stack || e)); process.exit(1); });
