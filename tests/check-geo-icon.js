// tests/check-geo-icon.js
// SUBJECT: ui/playlists.js, core/countries.js, core/worldmap.js, ui/base.js, ui/queue.js, ui/screens.js, ui/shell.js, index.html
//
// WALL: A SONG BLOCKED SOMEWHERE SHOWS A GLOBE, AND REGION BLOCKS SAYS FOR WHOM AND WHERE (J153 (c); the owner's words in
// `main/01-project.md` item 9: "if a song is blocked. no matter where you loook my queue, room queue, playlists (but not history)
// / we see a tiny icon and when we click it we have a pop up menu", grey for nobody here and red for someone. REGION BLOCKS is his
// redesign of that pop-up after the item's close, `ddjp_729`: "centered on the main tab its clicked on, like the preview player",
// "a map of earth with countries in green or red ... it also says what country it is as you put your mouse over them", the
// people blocked above, "a left side allowed and right side disallowed, always all listed and same size window every time but
// with scrolling text for it", "replace where this song can play with Region Blocks", "Allowed outside Youtube vs Not allowed
// outside youtube in red", "Outside Youtube at the top always if its blocked", and "lower, taller then the preview sdong
// player but not too tall" — built as his approved design page drew it).
//
//   A  THE ONE VERDICT (`Countries.blockedView`, the REAL module): no globe with no answer, or one leaving no country out
//      that can play outside its service; grey for a country left out and nobody REP names in it; red for someone REP names
//      in a country left out, or a song that cannot play outside its service; an allowed list's meaning (an empty one leaves
//      out every country); a code that is no country is nobody's; the people A to Z; junk reads as no answer; and `blocked`,
//      every country the answer leaves out, which Region Blocks' map and lists read.
//   B  WHICH LISTS DRAW IT (the REAL ui/ code, `tests/_screen-world.js`): the room queue — its song playing included — My
//      queue, a playlist, and History (`ddjp_736`, the owner's words in `main/01-project.md` item 7: "when you know the region
//      block status of the song somewhere in the app, it does appear in history with the menu pop up planet button as nomral
//      but seeing a song there dosent make you fetch the availability" — reversing his "but not history"). The song playing's
//      globe and History's are drawn from the saved answer with NO LOOKUP of their own: their rows, run through the real
//      thumbnail pipeline, ask `MetadataService.ensure` nothing — and a History row whose answer is not held draws none, and
//      asks nothing either, though a lookup would find its song blocked.
//   C  THE GLOBE AS DRAWN: the SVG in `currentColor`; grey #888 and red #ff6b6b from the sheet; a button to a keyboard with
//      its words ("Not allowed outside YouTube" for a red one with nobody here, `ddjp_729`); nothing on a row with no globe;
//      the sheet's tap area placed against the row (DECLARED: the double cannot apply a pseudo-element's rule), and what it
//      reaches, derived from the sheet: inside the row's gap before the globe and the globe's own gap after it (`ddjp_730`).
//   R  THE ROW'S GREY LINE (`ddjp_730`, the owner: the globe "where time is at the start of the row", and "Space after planet
//      only"): in every list that draws the globe, for a song with the globe and a length, the globe only, the length only and
//      neither, the line READ as a browser reads it — "🌐 3:20 · name", "🌐 name", "3:20 · name", "name" — the globe
//      first with its 5 px gap after it, the " · " before the name only after a length. The `::before` words are judged here with
//      sibling selectors, which the harness's cascade does not apply; the matcher is tested both ways on a tree of its own. And
//      History's line, which it writes itself (`ddjp_736`): the globe's spot first, as on every row, then the name, " · " and the
//      age — "🌐 name · age" with the answer held, "name · age" without — never a length.
//   D  REGION BLOCKS' LINES, for each shape of answer, the words exactly as the page: "Region Blocks · checked … (source)", the
//      song's title, ✕; the headline ("Blocked for everyone here", "Blocked for N people here", "Not blocked for anyone here");
//      the people box or "Nobody here is in a blocked country."; the line about playing outside the service (three); the two
//      lists "Allowed · N" and "Blocked · N", every country of the table listed exactly once, A to Z by the table's fold, the
//      people's countries saying who, and "Outside YouTube" pinned first in Blocked, and counted, when it cannot play there.
//   E  WHERE IT OPENS (the preview's own way, `_backdrop` and `_columnArea`): the overlay over the whole app, the preview's card
//      centred on the globe's column, 14 px in from its edges, never taller than 480 px and exactly that where there is room;
//      the window where the column has no box; the card scrolling only when even the lists at three lines do not fit (the
//      rule, driven; the floors, DECLARED); placed again on a resize and on a layout switch.
//   F  NAMES AS EVERY NAME IN THE APP: the short name, in its rank's colour (`H.rankColor(H._rosterLevel(…))`), opening
//      that person's card — Region Blocks closing first.
//   G  ONE AT A TIME, AND EACH WAY IT CLOSES: a second opens in place of the first; the globe again closes it; the ✕; Escape,
//      the focus back on the globe; a click that began on the overlay, and not one that began inside the card; its globe
//      leaving the page; a change of screen; its listeners let go.
//   H  THE MAP AND ITS LEGEND (`core/worldmap.js`, real): every shape drawn, green, red or grey by the verdict, the people's
//      countries outlined and drawn last; the four legend keys; each colour said once (DECLARED).
//   T  THE TIP: pointing at a country (a tap too) shows its name, "Allowed", "Blocked" or "No data for this country", and who
//      here it is blocked for; off a country, or leaving the map, it goes.
//   W  THE WORDS FROM THE TABLE: rename the service and the source in the song table and every line that names them follows.
//   I  REDRAWN IN PLACE: a lookup's answer reaching the real `_thumbProcess` redraws the row's globe and an open Region
//      Blocks, and REP's countries moving (`geoChanged`, wired to the feature layer's "the people view changed") redraws the
//      globes and an open Region Blocks; no song row is built or removed; the same countries again draw nothing.
//   K  THE SOURCE'S NAME IS ONLY EVER THE TABLE'S (the REAL `MetadataService.heldGeo`): a saved answer's source comes back when
//      it is one of the song's service's region sources, and not otherwise.
//
// WHAT ONLY A BROWSER SHOWS is not here: the look, real heights and widths, the scroll's feel, the hover's feel, a phone
// (measured in Chromium for the report, `ddjp_729`). The owner's sitting (`LIVE-CHECKS.md` checks 176 and 13aa).
"use strict";
const path = require("path");
const { loadInContext } = require("./_load");
const S = require("./_screen-world.js");
const fs = require("fs");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[geo-icon] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 500) : "")); }
  return !!c;
}
const J = (x) => JSON.stringify(x);
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[geo-icon] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });

// Region Blocks' map (`core/worldmap.js`, `ddjp_729`): a tree without it is refused by name, and the parts run on without a map.
const HAS_MAP = fs.existsSync(path.join(__dirname, "..", "core", "worldmap.js"));
const core = loadInContext(["core/songs.js", "core/countries.js"].concat(HAS_MAP ? ["core/worldmap.js"] : []), {});
const Countries = core.Countries, Songs = core.Songs, WorldMap = HAS_MAP ? core.WorldMap : null;
ok(HAS_MAP && !!WorldMap, "PREMISE — `core/worldmap.js` loads: Region Blocks' map has shapes to draw");
const BV = (g, cc) => (Countries && typeof Countries.blockedView === "function") ? Countries.blockedView(g, cc) : null;

const MARIE = "@marie:hs", JONAS = "@jonas:hs", ANN = "@ann:hs", DJ = "@dj:hs", ME = "@me:hs";
const LADDER = [{ name: "owner", level: 99 }, { name: "high-staff", level: 80 }, { name: "staff", level: 60 }, { name: "vip", level: 40 },
  { name: "player", level: 20 }, { name: "guest", level: 10 }, { name: "uncategorized", level: 0 }];
const ROSTER = [{ userId: MARIE, level: 20 }, { userId: JONAS, level: 40 }, { userId: ANN, level: 10 }, { userId: DJ, level: 10 }];
const YT1 = "yt:AAAAAAAAAAA", YT2 = "yt:BBBBBBBBBBB", YT3 = "yt:CCCCCCCCCCC", YT4 = "yt:DDDDDDDDDDD", YT5 = "yt:EEEEEEEEEEE";
const ROOM = { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" };
const tick = () => new Promise((r) => setImmediate(r));
const cls = (n) => String((n && n.className) || "");
const has = (n, c) => cls(n).split(/\s+/).indexOf(c) >= 0;
const textOf = (n) => (n ? String(n.textContent || "") : "");

// ── A WORLD: the real ui/ code drawing the lists, over a saved-answer map and REP's countries it can change ──
function makeWorld(o) {
  o = o || {};
  const geo = Object.assign({}, o.geo || {});
  const st = { cc: Object.assign({}, o.cc || {}), ensures: [], answers: Object.assign({}, o.answers || {}), pv: [], win: {} };
  const lists = {
    playing: { dj: DJ, song: { songKey: o.np || YT1 }, pi: "p0" },
    rotation: [{ user: ANN, pending: [{ songKey: o.waiting || YT2 }] }],
    mine: [{ songKey: YT3 }],
    history: [{ songKey: YT4, dj: ANN, at: 1.9e12 - 60000, pi: "h1", cutShortBy: false }],
    playlist: { id: "pl_mix", name: "Mix", tracks: [{ songKey: YT5 }] },
  };
  const features = {
    Room: { rankLadder: () => LADDER, getMyId: () => ME, getRoster: () => ROSTER, recentEvents: () => ({ rows: [] }), FEED_KINDS: {},
      onPeopleViewChange: (fn) => st.pv.push(fn) },
    Queue: { getNowPlaying: () => lists.playing, getRotation: () => lists.rotation, lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
      recentHistory: () => lists.history, historyReach: () => ({ entries: 1, complete: true }), getState: () => ({ counts: {} }) },
    UserQueue: { items: () => lists.mine.slice(), count: () => lists.mine.length, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
    Reactions: { hasSaved: () => false, hasVoted: () => false },
    Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible: () => {} },
    ChatPrefs: { layout: () => "wide", setLayout: () => {}, playerHidden: () => false, overlayBlocked: () => false, previewVolume: () => null, previewMuted: () => null },
    Playlists: { list: () => [{ id: lists.playlist.id, name: lists.playlist.name }], get: () => Promise.resolve(JSON.parse(J(lists.playlist))), addTrackByUrl: () => Promise.resolve({ ok: true }) },
    ServerClock: { serverNow: () => 1.9e12 },
    // `o.noLen`: no length held for any song (PART R's rows without a length, `ddjp_730`).
    Store: { meta: { peek: (k) => (o.noLen ? { title: "Title of " + k } : { title: "Title of " + k, durationSec: 200 }), load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null), has: () => Promise.resolve(false) } },
    Rep: { countries: () => Object.assign({}, st.cc) },
  };
  // The saved answers, as `MetadataService.heldGeo` hands them; a lookup (`ensure`) records who asked and may save an answer.
  const MS = {
    thumbUrl: (k) => "https://i.ytimg.com/vi/" + k.slice(3) + "/mqdefault.jpg",
    get: () => Promise.resolve(null),
    heldGeo: (k) => (geo[k] ? JSON.parse(J(geo[k])) : null),
    ensure: (k, fields, now, ask) => { st.ensures.push([k, fields, ask]); if (st.answers[k]) geo[k] = st.answers[k]; return Promise.resolve({ title: "Title of " + k, durationSec: 200, geo: geo[k] || null }); },
    ensureThumb: () => Promise.resolve(null),
  };
  // A recording IntersectionObserver, so a test can bring a row into view and the REAL pipeline runs from there.
  const ios = [];
  function IO(cb, opts) { const x = { cb, opts, els: [], observe(el) { x.els.push(el); }, unobserve() {}, disconnect() {} }; ios.push(x); return x; }
  const w = S.world({ features, domShaped: true, clock: o.clock ? 1.9e12 : undefined,
    globals: { URL, MetadataService: MS, Countries, Songs: o.songs || Songs, WorldMap, IntersectionObserver: IO,
      // the window's listeners, recorded, so a resize can be driven (Region Blocks is placed again on one, as the preview is)
      addEventListener: (t, fn) => { (st.win[t] = st.win[t] || []).push(fn); },
      removeEventListener: (t, fn) => { const l = st.win[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      SC: { Widget: function () { return { bind() {}, unbind() {} }; } }, YT: { Player: function () { return {}; } } } });
  // The document double keeps every listener and lets none go; here one let go is gone, so Region Blocks' own can be counted.
  w.doc.removeEventListener = (t, fn) => { const l = w.doc.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  w.H.buildMainDom(w.main, ROOM);
  w.geo = geo; w.st = st; w.lists = lists; w.ios = ios;
  w.qb = w.refs.queueBody;
  w.qa = (sel, root) => Array.from((root || w.main).querySelectorAll(sel));
  w.body = () => Array.from(w.doc.body.children || []).filter((n) => n.nodeType === 1);
  w.cards = () => w.body().filter((n) => has(n, "preview-overlay") && n.querySelector(".rb-card"));   // Region Blocks open: its overlay
  w.card = () => { const o = w.cards()[0]; return o ? o.querySelector(".rb-card") : null; };
  w.room = async () => { w.refs.tabRoom.click(); for (let i = 0; i < 4; i++) await tick(); };
  w.decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
  w.inView = async (row) => {
    const img = w.qa("img.thumb", row)[0];
    const io = ios.find((x) => x.els.indexOf(img) >= 0);
    if (!io) return false;
    io.cb([{ target: img, isIntersecting: true }]);
    if (o.clock) await w.advance(400); else for (let i = 0; i < 8; i++) await tick();
    for (let i = 0; i < 8; i++) await tick();
    return true;
  };
  return w;
}
const geoOf = (row) => (row && row.querySelector) ? row.querySelector(".sr-geo") : null;
const npRow = (w) => w.qa(".rq-list .song-row.playing", w.qb)[0] || null;
const waitingRows = (w) => w.qa(".rq-list .song-row", w.qb).filter((r) => !has(r, "playing") && !has(r, "rq-np-empty"));

// Each part runs on its own: a part that throws says so by name, and the parts after it still run.
async function part(id, fn) {
  try { await fn(); } catch (e) { ok(false, id + ": threw — " + ((e && e.message) || e)); }
}

(async () => {
  // ═══ A — THE ONE VERDICT ═══
  await part("A", async () => {
    ok(typeof (Countries && Countries.blockedView) === "function", "A PREMISE — `Countries.blockedView` is the one verdict, on the real module");
    const T = (g, cc) => { const v = BV(g, cc); return v ? v.tone : "no verdict"; };
    ok(T(null, { [MARIE]: "FR" }) === null && T(undefined, {}) === null && T("junk", {}) === null && T({}, {}) === null,
      "A: NO ANSWER, NO GLOBE — none, junk, or an answer with neither list", [T(null, {}), T("junk", {}), T({}, {})]);
    ok(T({ blocked: [], embeddable: true }, { [MARIE]: "FR" }) === null && T({ blocked: [], embeddable: null }, { [MARIE]: "FR" }) === null,
      "A: NO COUNTRY LEFT OUT and it can play on other sites (or nobody said): no globe");
    ok(T({ blocked: [], embeddable: false }, {}) === "red", "A: CAN'T PLAY ON OTHER SITES: red, even for nobody here (the read-through's adopted default)");
    ok(T({ blocked: ["DE", "FR", "IT"], embeddable: true }, {}) === "grey" && T({ blocked: ["DE", "FR", "IT"] }, { [ANN]: "US" }) === "grey",
      "A: BLOCKED SOMEWHERE, FOR NOBODY REP NAMES: grey — with no countries, and with one elsewhere");
    const red = BV({ blocked: ["DE", "FR", "IT"], embeddable: true }, { [MARIE]: "FR", [JONAS]: "DE", [ANN]: "US" });
    ok(red && red.tone === "red" && J(red.people) === J([{ user: JONAS, code: "DE" }, { user: MARIE, code: "FR" }]) && red.kind === "blocked" &&
       J(red.codes) === J(["DE", "FR", "IT"]) && red.limited === true && red.embeddable === true,
      "A: BLOCKED FOR SOMEONE REP NAMES: red, and the people it leaves out, A to Z by person", red);
    const allowed = BV({ allowed: ["CA", "US"] }, { [MARIE]: "FR", [ANN]: "US" });
    ok(allowed && allowed.tone === "red" && J(allowed.people) === J([{ user: MARIE, code: "FR" }]) && allowed.kind === "allowed" && allowed.embeddable === null,
      "A: AN ALLOWED LIST leaves out every other country: France is out, the United States in", allowed);
    ok(T({ allowed: ["CA", "US"] }, { [ANN]: "US" }) === "grey", "A: and someone in an allowed country is not blocked: grey");
    const none = BV({ allowed: [] }, {});
    ok(none && none.tone === "grey" && none.limited === true && J(none.codes) === "[]" && T({ allowed: [] }, { [ANN]: "US" }) === "red",
      "A: AN EMPTY ALLOWED LIST leaves out every country (YouTube's meaning): grey for nobody, red for anyone with a country", none);
    ok(T({ blocked: ["FR"] }, { [MARIE]: "ZZ" }) === "grey" && T({ blocked: ["FR"] }, { [MARIE]: "fr" }) === "grey" && T({ blocked: ["FR"] }, { [MARIE]: 7 }) === "grey" &&
       T({ allowed: ["US"] }, { [MARIE]: "ZZ" }) === "grey" && T({ allowed: ["US"] }, { [MARIE]: "us" }) === "grey",
      "A: A COUNTRY THAT IS NO COUNTRY is nobody's here: `ZZ`, lower case, a number — under an allowed list too, which leaves out every country it does not name");
    ok(J((BV({ blocked: ["IT", "ZZ", "FR", "DE"] }, {}) || {}).codes) === J(["DE", "FR", "IT"]), "A: the answer's own codes, the table's only, A to Z");
    const all = Countries.codes(), bl = (g) => (BV(g, {}) || {}).blocked;
    ok(J(bl({ blocked: ["IT", "FR", "DE"] })) === J(["DE", "FR", "IT"]) && J(bl({ allowed: ["US"] })) === J(all.filter((c) => c !== "US")) &&
       J(bl({ blocked: [], embeddable: false })) === "[]" && J(bl({ allowed: [] })) === J(all) && J(bl(null)) === "[]",
      "A: `blocked` — EVERY COUNTRY THE ANSWER LEAVES OUT, A to Z by code: a blocked list's own, an allowed list's complement, none with no limit, " +
      "every one for allowed nowhere (Region Blocks' map and its Blocked list read it, `ddjp_729`)", [bl({ blocked: ["IT", "FR", "DE"] }), (bl({ allowed: ["US"] }) || []).length]);
  });

  // ═══ B, C — WHICH LISTS DRAW IT, AND THE GLOBE AS DRAWN ═══
  const BLOCK_FR = { blocked: ["FR"], embeddable: true, checkedAt: 1, source: "proxynova" };
  await part("B", async () => {
    const all = {}; for (const k of [YT1, YT2, YT3, YT4, YT5]) all[k] = BLOCK_FR;
    const w = makeWorld({ geo: all, cc: { [MARIE]: "FR" }, clock: true });
    await w.room();
    const places = [];
    if (npRow(w)) places.push(["the song playing", npRow(w)]);
    for (const r of waitingRows(w)) places.push(["a room queue row", r]);
    w.refs.tabMine.click();
    for (const r of w.qa(".song-row", w.qb)) places.push(["a My queue row", r]);
    w.refs.tabPlaylists.click();
    const nm = w.qa(".pl-name", w.qb).find((b) => b.textContent === "Mix");
    if (nm) nm.click();
    for (let i = 0; i < 6; i++) await tick();
    for (const r of w.qa(".song-row", w.qb)) places.push(["a playlist's song", r]);
    ok(J(places.map((p) => p[0])) === J(["the song playing", "a room queue row", "a My queue row", "a playlist's song"]),
      "B PREMISE — the real ui/ code drew every list that shows a globe", places.map((p) => p[0]));
    for (const [place, row] of places) {
      const g = geoOf(row);
      ok(g && has(g, "geo-on") && has(g, "geo-red") && g.querySelectorAll(".geo-ico").length === 1 && g.dataset.geo === "1",
        "B: " + place + " draws its globe (red: someone REP names is in France)", g && { cls: cls(g), kids: (g.children || []).length });
    }
    // HISTORY TOO, SINCE `ddjp_736` (the owner's, reversing his "but not history"): its row draws the globe from the answer held.
    w.refs.tabHistory.click();
    const hist = w.qa(".hist-list .song-row", w.qb);
    ok(hist.length === 1, "B PREMISE — History drew its row, for a song blocked in France too", hist.length);
    for (const r of hist) {
      const g = geoOf(r);
      ok(g && has(g, "geo-on") && has(g, "geo-red") && g.dataset.geo === "1" && r.querySelectorAll(".geo-ico").length === 1,
        "B: HISTORY DRAWS THE GLOBE WHEN THE ANSWER IS HELD (the owner's, `ddjp_736`) — red: someone REP names is in France; one globe",
        g && { cls: cls(g), globes: r.querySelectorAll(".geo-ico").length });
    }
    // ...and seeing it there asks for nothing: History's row, run through the REAL pipeline, asks `ensure` nothing.
    const hb = w.st.ensures.length;
    const hReached = hist[0] ? await w.inView(hist[0]) : false;
    ok(hReached && hist[0].querySelector("img.thumb").dataset.thumbMode === "cacheOnly", "B PREMISE — History's row came into view through the real thumbnail observer");
    ok(w.st.ensures.length === hb && has(geoOf(hist[0]), "geo-red"),
      "B: SEEING A SONG IN HISTORY ASKS NO LOOKUP — in view, the real pipeline asked `ensure` nothing; its globe is the saved answer's", w.st.ensures.slice(hb));
    // The option itself, on the real `songRow`: a row built without `geo` draws none, with it one — History's call asks.
    const bare = w.sb.PlaylistPanels.songRow(YT4, { thumbMode: "cacheOnly" }), asked = w.sb.PlaylistPanels.songRow(YT4, { thumbMode: "cacheOnly", geo: true });
    ok(cls(geoOf(bare)) === "sr-geo" && (geoOf(bare).children || []).length === 0 && geoOf(bare).dataset.geo === undefined && has(geoOf(asked), "geo-red"),
      "B: `songRow` DRAWS THE GLOBE ONLY WHEN ASKED (`geo: true`) — History's call asks, since `ddjp_736`", [cls(geoOf(bare)), cls(geoOf(asked))]);
    // The song playing: drawn from the saved answer, and its row run through the REAL pipeline asks for no lookup.
    await w.room();
    const np = npRow(w);
    const before = w.st.ensures.length;
    const reached = await w.inView(np);
    ok(reached && np && np.querySelector("img.thumb").dataset.thumbMode === "cacheOnly", "B PREMISE — the song playing's row came into view through the real thumbnail observer");
    ok(w.st.ensures.length === before && has(geoOf(np), "geo-red"),
      "B: THE SONG PLAYING HAS NO LOOKUP OF ITS OWN — in view, the real pipeline asked `ensure` nothing, and its globe is drawn from the saved answer", w.st.ensures.slice(before));
    const wr = waitingRows(w)[0];
    await w.inView(wr);
    ok(w.st.ensures.length === before + 1 && J(w.st.ensures[before]) === J([YT2, ["title", "geo"], { list: "room" }]),
      "B: CONTROL — a waiting row in view does look its song up, for the room queue", w.st.ensures.slice(before));
    // NOT HELD, NOT DRAWN, NOT ASKED: History's song has no saved answer here, though a lookup would save France's block for it —
    // so a lookup asked by History's row would draw a globe. In view, the real pipeline asks nothing and the row draws none.
    const wu = makeWorld({ geo: {}, answers: { [YT4]: BLOCK_FR }, cc: { [MARIE]: "FR" }, clock: true });
    await wu.room();
    wu.refs.tabHistory.click();
    const hu = wu.qa(".hist-list .song-row", wu.qb)[0];
    const ub = wu.st.ensures.length;
    const uReached = hu ? await wu.inView(hu) : false;
    ok(uReached && wu.st.ensures.length === ub && cls(geoOf(hu)) === "sr-geo" && hu.querySelectorAll(".geo-ico").length === 0,
      "B: A HISTORY ROW WHOSE ANSWER IS NOT HELD DRAWS NO GLOBE, AND IN VIEW ASKS `ensure` NOTHING", { asked: wu.st.ensures.slice(ub), geo: cls(geoOf(hu)) });
  });
  // C — the globe as drawn
  await part("C", async () => {
    const w = makeWorld({ geo: { [YT1]: { blocked: [], embeddable: false }, [YT2]: { blocked: ["DE", "FR"], embeddable: true } }, cc: { [ANN]: "US" } });
    await w.room();
    const red = geoOf(npRow(w)), grey = geoOf(waitingRows(w)[0]);
    const svg = red && red.querySelector(".geo-ico");
    const kids = svg ? Array.from(svg.children || []).filter((n) => n.nodeType === 1) : [];
    const a = (n, k) => (n ? n.getAttribute(k) : null);
    ok(svg && svg.tag === "svg" && a(svg, "viewBox") === "0 0 16 16" && a(svg, "stroke") === "currentColor" && a(svg, "fill") === "none" &&
       a(svg, "stroke-width") === "1.5" && a(svg, "aria-hidden") === "true" && a(svg, "focusable") === "false",
      "C: THE MOCK'S GLOBE — an inline SVG in currentColor, hidden from a screen reader", svg && svg.attrs);
    ok(J(kids.map((n) => n.tag)) === J(["circle", "ellipse", "path"]) && a(kids[0], "r") === "6.75" && a(kids[1], "rx") === "2.9" && a(kids[1], "ry") === "6.75" &&
       a(kids[2], "d") === "M1.25 8h13.5", "C: its three strokes, as drawn: the rim, the meridian, the equator", kids.map((n) => n.attrs));
    // CHANGED ON PURPOSE (`ddjp_729`, the owner's words: "play on other sites should be called, Allowed outside Youtube vs Not allowed
    // outside youtube"): the service's name from its row in the song table (`W`, below, renames it).
    ok(red && has(red, "geo-red") && a(red, "title") === "Not allowed outside YouTube" && a(red, "aria-label") === "Not allowed outside YouTube",
      "C: NOT ALLOWED OUTSIDE YOUTUBE — red, and it says so in his words", red && red.attrs);
    ok(grey && has(grey, "geo-grey") && a(grey, "title") === "Blocked in some countries — nobody here", "C: GREY — \"Blocked in some countries — nobody here\"", grey && grey.attrs);
    for (const g of [red, grey]) ok(g && a(g, "role") === "button" && a(g, "tabindex") === "0" && a(g, "aria-haspopup") === "dialog" && a(g, "aria-expanded") === "false",
      "C: a button to a keyboard: role, tab stop, the pop-up it opens, shut", g && g.attrs);
    ok(w.decl(grey, "color") === "#888" && w.decl(red, "color") === "#ff6b6b", "C: THE TWO TONES, from the sheet: #888 (the sub line's grey) and #ff6b6b (the app's red)", [w.decl(grey, "color"), w.decl(red, "color")]);
    ok(w.decl(svg, "width") === "11px" && w.decl(svg, "height") === "11px" && w.decl(red, "line-height") === "0" && w.decl(red, "display") === "inline-block",
      "C: 11 px on the 11 px line, the line's height not grown (line-height 0)", [w.decl(svg, "width"), w.decl(red, "line-height")]);
    // The focus ring and the tap area are under a state pseudo-class and a pseudo-element, which the double never applies:
    // read their rules as declared.
    const rules = S.readSheet(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));
    const rule = (sel) => rules.find((r) => r.sel === sel);
    const tap = rule(".song-row .sr-geo.geo-on::after");
    const ring = rule(".song-row .sr-geo.geo-on:focus-visible");
    // CHANGED ON PURPOSE (`ddjp_730`): the globe is first on its line now, so its area reaches 8 px left of it and 5 px right of it, its
    // own gap, still 24 px wide. With the length first it reached 13 px left, over the length, and ended at the globe's edge.
    ok(tap && tap.decls.position && tap.decls.position.val === "absolute" && tap.decls.content && tap.decls.width && tap.decls.width.val === "24px" &&
       tap.decls["margin-left"] && tap.decls["margin-left"].val === "-8px" && tap.decls.top && tap.decls.bottom,
      "C: THE TAP AREA (DECLARED) — absolutely placed, so nothing grows; from 8 px left of the globe to the end of its 5 px gap", tap && tap.decls);
    // What it reaches, worked out from the sheet rather than restated: left, inside the row's own gap (short of the row's number and
    // its picture, which opens the preview); right, inside the globe's own gap (short of the length or the name, which opens a card).
    const pxOf = (v) => (v == null ? NaN : parseFloat(String(v)));
    const rowGap = pxOf(((rule(".song-row") || { decls: {} }).decls.gap || {}).val), globeW = pxOf(w.decl(svg, "width"));
    const reachL = tap ? -pxOf((tap.decls["margin-left"] || {}).val) : NaN, reachR = tap ? pxOf((tap.decls["margin-left"] || {}).val) + pxOf((tap.decls.width || {}).val) - globeW : NaN;
    const gapAfter = pxOf(w.decl(red, "margin-right"));
    ok(rowGap === 10 && globeW === 11 && reachL >= 0 && reachL < rowGap && reachR >= 0 && reachR <= gapAfter,
      "C: THE TAP AREA STAYS IN THE GAPS — 8 px left of the globe, inside the row's 10 px gap (never the row's number or picture), and 5 px right, " +
      "inside the globe's own gap (never the length or the name)", { rowGap, globeW, reachL, reachR, gapAfter });
    // AND WHERE A CRAMPED ROW BRINGS THE AREA AGAINST THE ROW'S CONTROLS, THE CONTROLS WIN (`ddjp_730`): measured in Chromium, a
    // narrow column with every control shown (a phone 360 px wide, the room queue unlocked) put 5 px of the area over the first
    // control, where 729's put 27. The controls are painted above it, so a press there is the control's (DECLARED: no stacking here).
    const actsEl = npRow(w) ? npRow(w).querySelector(".uq-actions") : null;
    ok(!!actsEl && /^(relative|absolute)$/.test(w.decl(actsEl, "position") || "") && parseInt(w.decl(actsEl, "z-index"), 10) >= 1 && !!tap && !tap.decls["z-index"],
      "C: THE ROW'S CONTROLS ARE PAINTED ABOVE THE TAP AREA — positioned, z-index 1, the area none: in a cramped row a press on a control is the control's",
      actsEl && { position: w.decl(actsEl, "position"), z: w.decl(actsEl, "z-index") });
    ok(rule(".song-row") && /relative/.test((rule(".song-row").decls.position || {}).val || ""),
      "C: and placed against the row — `.song-row` is the positioned box, so the sub line's overflow does not clip it");
    ok(ring && ring.decls.outline && /#5865F2/i.test(ring.decls.outline.val), "C: the keyboard's focus ring, as drawn (DECLARED)", ring && ring.decls);
    // No globe: no answer, and an answer with no limit that can play on other sites.
    const w2 = makeWorld({ geo: { [YT2]: { blocked: [], embeddable: true } }, cc: { [MARIE]: "FR" } });
    await w2.room();
    for (const [what, row] of [["no answer", npRow(w2)], ["no country limit", waitingRows(w2)[0]]]) {
      const g = geoOf(row);
      ok(g && cls(g) === "sr-geo" && (g.children || []).length === 0 && g.getAttribute("role") === null && g.getAttribute("title") === null,
        "C: NO GLOBE with " + what + " — the spot empty, no button", g && { cls: cls(g), attrs: g.attrs });
    }
  });

  // ═══ D … K — REGION BLOCKS ═══
  const DAY = 86400000, NOW = 1.9e12;
  function popWorld(g, cc, more) { return makeWorld(Object.assign({ geo: { [YT2]: g }, cc: cc || {}, clock: true }, more || {})); }
  async function openOn(w) {
    await w.room();
    const g = geoOf(waitingRows(w)[0]);
    if (g) g.click();
    return { g, c: w.card(), n: w.cards().length };
  }
  // ═══ R — THE ROW'S GREY LINE (`ddjp_730`) ═══
  // The owner: "the little planet icon should probably be where time is at the start of the row and its also toutching the name of
  // the user in room queue"; of a dot after the globe, "im not sure i like to see a dot separator instead of space", and he chose
  // "Space after planet only". So the globe comes first with its 5 px gap after it, then the length, " · " and the name, the dot
  // the length's as before. READ AS A BROWSER READS IT: each piece in order, the globe's gap from the sheet, and the words a
  // `::before` puts in front of a piece — judged here, with sibling selectors, which the harness's cascade does not apply.
  await part("R", async () => {
    const elKids = (n) => (n ? Array.from(n.children || []).filter((k) => k.nodeType === 1) : []);
    const rules = S.readSheet(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));
    // A SELECTOR WITH SIBLINGS, matched right to left; each compound by the harness's own matcher (`S.matches`).
    const parseSel = (sel) => {
      const out = []; let comb = null;
      for (const t of sel.trim().replace(/\s*([>~+])\s*/g, " $1 ").split(/\s+(?![^(]*\))/)) {
        if (t === ">" || t === "~" || t === "+") comb = t; else { out.push({ comb: out.length ? (comb || " ") : null, c: t }); comb = null; }
      }
      return out;
    };
    const up = (n) => { const q = n ? (n.parent || n.parentNode) : null; return (q && q.nodeType === 1) ? q : null; };
    const prev = (n) => { const q = up(n); if (!q) return null; const k = Array.from(q.children || []).filter((c) => c.nodeType === 1); const i = k.indexOf(n); return i > 0 ? k[i - 1] : null; };
    const hit = (n, seq, i) => {
      if (!n || !S.matches(n, seq[i].c)) return false;
      if (i === 0) return true;
      const cb = seq[i].comb;
      if (cb === ">") return hit(up(n), seq, i - 1);
      if (cb === "+") return hit(prev(n), seq, i - 1);
      if (cb === "~") { for (let x = prev(n); x; x = prev(x)) if (hit(x, seq, i - 1)) return true; return false; }
      for (let x = up(n); x; x = up(x)) if (hit(x, seq, i - 1)) return true;
      return false;
    };
    const WORDS = rules.filter((r) => /::before$/.test(r.sel) && r.decls.content && /^"[^"]*"$/.test(r.decls.content.val))
      .map((r) => ({ sel: r.sel, seq: parseSel(r.sel.replace(/::before$/, "")), text: r.decls.content.val.slice(1, -1) }));
    const beforeOf = (n) => WORDS.filter((x) => hit(n, x.seq, x.seq.length - 1)).map((x) => x.text);
    // THE MATCHER, TESTED BOTH WAYS on a tree of its own, before any line is read.
    const t0 = makeWorld({});
    const X = t0.H.el("span", { class: "x" }), Y = t0.H.el("span", { class: "y" }), Z = t0.H.el("span", { class: "z" });
    t0.H.el("div", { class: "a" }, [X, Y, Z]);
    const m = (n, sel) => { const q = parseSel(sel); return hit(n, q, q.length - 1); };
    const probe = [m(Z, ".x ~ .z"), m(Z, ".x + .z"), m(Y, ".x + .y"), m(X, ".z ~ .x"), m(Z, ".a > .z"), m(Z, ".a .z"), m(Z, ".b ~ .z"), m(Z, ".a .x:not(:empty) ~ .z"), m(Z, ".a .x:empty ~ .z")];
    ok(J(probe) === J([true, false, true, false, true, true, false, false, true]) && WORDS.length > 0,
      "R PREMISE — the sibling matcher answers both ways (~, +, >, a descendant, :empty, :not) and the sheet has `::before` words to judge", probe);
    // EVERY MARGIN THE SHEET GIVES THE GLOBE is in a rule the line's reader applies — none behind a sibling selector, which it cannot.
    const geoMargins = rules.filter((r) => /sr-geo/.test(r.sel) && !/::/.test(r.sel) && Object.keys(r.decls).some((k) => /^margin/.test(k)));
    ok(geoMargins.length > 0 && geoMargins.every((r) => !!r.seq), "R PREMISE — every margin the sheet gives the globe is in a rule the reader applies",
      geoMargins.map((r) => r.sel));
    const GLOBE = "🌐";
    const px = (v) => (v ? parseFloat(String(v)) : 0);
    const lineOf = (w, row) => {
      const sub = row ? row.querySelector(".sr-sub") : null;
      if (!sub) return null;
      let line = "";
      for (const c of elKids(sub)) {
        const lead = px(w.decl(c, "margin-left")) > 0 ? " " : "", tail = px(w.decl(c, "margin-right")) > 0 ? " " : "";
        const own = has(c, "sr-geo") ? ((has(c, "geo-on") && c.querySelector(".geo-ico")) ? GLOBE : "") : textOf(c);
        line += lead + beforeOf(c).join("") + own + tail;
      }
      return line.replace(/\s+$/, "");
    };
    const order = (row) => { const sub = row ? row.querySelector(".sr-sub") : null; return sub ? elKids(sub).map((c) => cls(c).split(/\s+/)[0]) : null; };
    const CASES = [["the globe and a length", true, true], ["the globe only", true, false], ["a length only", false, true], ["neither", false, false]];
    for (const [what, withGeo, withLen] of CASES) {
      const geoAll = {}; if (withGeo) for (const k of [YT1, YT2, YT3, YT5]) geoAll[k] = BLOCK_FR;
      const w = makeWorld({ geo: geoAll, cc: { [MARIE]: "FR" }, noLen: !withLen });
      await w.room();
      const places = [["the song playing", npRow(w), w.H.shortName(DJ)], ["a room queue row", waitingRows(w)[0], w.H.shortName(ANN)]];
      w.refs.tabMine.click();
      places.push(["a My queue row", w.qa(".song-row", w.qb)[0], null]);
      w.refs.tabPlaylists.click();
      const nm = w.qa(".pl-name", w.qb).find((b) => b.textContent === "Mix");
      if (nm) nm.click();
      for (let i = 0; i < 6; i++) await tick();
      places.push(["a playlist's song", w.qa(".pl-detail-body .song-row", w.qb)[0], null]);
      ok(places.every((p) => !!p[1]), "R PREMISE — every list that draws the globe drew its row, for " + what, places.map((p) => [p[0], !!p[1]]));
      const want = (name) => {
        let line = withGeo ? GLOBE : "";
        if (withLen) line += (line ? " " : "") + "3:20";
        if (name) line += (withLen ? " · " : (line ? " " : "")) + name;
        return line;
      };
      for (const [place, row, name] of places) {
        ok(J(order(row)) === J(["sr-geo", "sr-dur"].concat(name ? ["sr-when"] : [])),
          "R: THE GLOBE COMES FIRST ON THE LINE — its spot, then the length, then the name (" + place + ", " + what + ")", order(row));
        ok(lineOf(w, row) === want(name),
          "R: THE LINE READS \"" + want(name) + "\" (" + place + ", " + what + ") — the globe first with its gap, the \" · \" only after a length",
          { got: lineOf(w, row), want: want(name) });
        if (name && !withGeo && !withLen) {
          const who = row.querySelector(".sr-when");
          ok(beforeOf(who).length === 0 && cls(row.querySelector(".sr-geo")) === "sr-geo", "R: A LONE NAME HAS NOTHING BEFORE IT — no dot, no gap (" + place + ")", beforeOf(who));
        }
      }
      if (withGeo) {
        const g = places[0][1] ? places[0][1].querySelector(".sr-geo") : null;
        ok(w.decl(g, "margin-right") === "5px" && !px(w.decl(g, "margin-left")) && px(w.decl(g, "margin-right")) >= 3 && px(w.decl(g, "margin-right")) <= 8,
          "R: THE GLOBE'S GAP — 5 px after it (the gap it had to the length), none before it: it is first on its line (" + what + ")",
          { right: w.decl(g, "margin-right"), left: w.decl(g, "margin-left") });
      }
    }
    // HISTORY'S LINE (`ddjp_736`): it writes its own line — the name, then the age, whose `::before` is the " · " — and keeps the
    // globe's spot first on it, as every row: "🌐 name · age" with the answer held, "name · age" without; never a length, so
    // `songRow`'s length and its dot do not reach it.
    for (const [what, held] of [["the answer held", true], ["no answer held", false]]) {
      const wh = makeWorld({ geo: held ? { [YT4]: BLOCK_FR } : {}, cc: { [MARIE]: "FR" } });
      await wh.room();
      wh.refs.tabHistory.click();
      const hrow = wh.qa(".hist-list .song-row", wh.qb)[0];
      const hwho = hrow ? hrow.querySelector(".sr-who") : null, hage = hrow ? hrow.querySelector(".hist-ago") : null;
      const want = hrow ? (held ? GLOBE + " " : "") + textOf(hwho) + " · " + textOf(hage) : null;
      ok(!!hrow && J(order(hrow)) === J(["sr-geo", "sr-who", "hist-ago"]) && has(geoOf(hrow), "geo-on") === held && J(beforeOf(hage)) === J([" · "]) &&
         beforeOf(hwho).length === 0 && lineOf(wh, hrow) === want && /^ann$/.test(textOf(hwho)) && /\bago$/.test(textOf(hage)),
        "R: HISTORY'S LINE IS \"" + (held ? "🌐 " : "") + "name · age\" (" + what + ") — the globe's spot first, the \" · \" the age's own, no length on it (CONTROL: the matcher's descendant rule)",
        { order: order(hrow), line: lineOf(wh, hrow), want: want });
    }
  });

  const kids = (n) => (n ? Array.from(n.children || []).filter((k) => k.nodeType === 1) : []);
  const read = (c) => {
    if (!c) return null;
    const box = (i) => kids(c.querySelectorAll(".rb-box")[i]);
    const head = c.querySelector(".rb-head"), sites = c.querySelector(".rb-sites");
    return {
      kicker: textOf(c.querySelector(".rb-kicker")), bold: textOf(c.querySelector(".rb-kicker b")), song: textOf(c.querySelector(".rb-song")),
      head: textOf(head), headRed: has(head, "rb-bad"),
      people: Array.from(c.querySelectorAll(".rb-person")).map((p) => kids(p).map(textOf).join(" ")).concat(Array.from(c.querySelectorAll(".rb-none")).map(textOf)),
      sites: textOf(sites), sitesRed: has(sites, "rb-bad"),
      heads: Array.from(c.querySelectorAll(".rb-col-h")).map(textOf),
      allowed: box(0).map(textOf), blocked: box(1).map(textOf), blockedCls: box(1).map(cls),
      order: kids(c).map((k) => cls(k).split(/\s+/)[0]),
    };
  };
  const TABLE = Countries.codes();
  const NAMEOF = (c) => Countries.byCode(c).name;
  const AZ = TABLE.slice().sort((a, b) => { const x = Countries.fold(NAMEOF(a)), y = Countries.fold(NAMEOF(b)); return x < y ? -1 : (x > y ? 1 : 0); });
  const label = (c) => NAMEOF(c) + " (" + c + ")";
  const codeOf = (t) => { const m = /\(([A-Z]{2})\)/.exec(t); return m ? m[1] : null; };

  await part("D", async () => {
    // The design page's first card: blocked in three countries, two people here in two of them, checked three days ago.
    const w = popWorld({ blocked: ["IT", "FR", "DE"], embeddable: true, checkedAt: NOW - 3 * DAY, source: "proxynova" }, { [MARIE]: "FR", [JONAS]: "DE", [ANN]: "US" });
    const { g, c, n } = await openOn(w);
    ok(n === 1 && c && c.getAttribute("role") === "dialog" && c.getAttribute("aria-label") === "Region Blocks",
      "D PREMISE — clicking the globe opens Region Blocks: one card, a dialog named \"Region Blocks\"", { n, cls: cls(c) });
    ok(g && g.getAttribute("aria-expanded") === "true" && has(g, "geo-open"), "D: the globe says it is open", g && g.attrs);
    const r = read(c) || {};
    ok(J(r.order) === J(["rb-top", "rb-head", "rb-people", "rb-map", "rb-legend", "rb-sites", "rb-lists"]),
      "D: TOP TO BOTTOM, as the page: the top line, the headline, the people, the map, the legend, the line about other sites, the lists", r.order);
    ok(r.kicker === "Region Blocks · checked 3 days ago (ProxyNova)" && r.bold === "Region Blocks",
      "D: \"Region Blocks · checked 3 days ago (ProxyNova)\" — the app's own \"… ago\", the source's name from the song table", [r.kicker, r.bold]);
    ok(r.song === "Title of " + YT2, "D: the song's title, as its row shows it", r.song);
    const x = c && c.querySelector(".rb-top > .preview-x");
    ok(x && x.textContent === "✕" && x.getAttribute("aria-label") === "Close", "D: then ✕ — the preview's own button (`.preview-x`)", x && x.attrs);
    ok(r.head === "Blocked for 2 people here" && r.headRed, "D: BLOCKED FOR PEOPLE HERE — \"Blocked for 2 people here\", red", [r.head, r.headRed]);
    ok(J(r.people) === J(["jonas · Germany (DE)", "marie · France (FR)"]), "D: the people box, one line each: name · Country (CC)", r.people);
    ok(r.sites === "Allowed outside YouTube" && !r.sitesRed, "D: \"Allowed outside YouTube\", not red", [r.sites, r.sitesRed]);
    ok(J(r.heads) === J(["Allowed · " + (TABLE.length - 3), "Blocked · 3"]), "D: THE TWO LISTS' HEADINGS — \"Allowed · N\" and \"Blocked · N\"", r.heads);
    ok(J(r.blocked) === J(["France (FR) · marie", "Germany (DE) · jonas", "Italy (IT)"]) && J(r.blockedCls) === J(["here", "here", ""]),
      "D: Blocked, A to Z — a country where people here are says who, in the brighter red (`here`)", [r.blocked, r.blockedCls]);
    const listed = (r.allowed || []).concat(r.blocked || []).map(codeOf);
    const seen = {}; let twice = [];
    for (const k of listed) { if (seen[k]) twice.push(k); seen[k] = true; }
    ok(listed.length === TABLE.length && twice.length === 0 && TABLE.every((k) => seen[k]),
      "D: EVERY COUNTRY OF THE TABLE LISTED, EACH ONCE, across the two lists", { listed: listed.length, table: TABLE.length, twice });
    ok(J(r.allowed) === J(AZ.filter((k) => ["IT", "FR", "DE"].indexOf(k) < 0).map(label)),
      "D: A TO Z BY NAME as the table folds names (`Countries.fold`): \"Åland Islands\" after \"Afghanistan\"", (r.allowed || []).slice(0, 4));
    // The other shapes.
    const cases = [
      ["CAN'T PLAY OUTSIDE ITS SERVICE, no country limit, nobody here (the page's \"embedding off\")", { blocked: [], embeddable: false, checkedAt: NOW - 5 * DAY, source: "youtube" }, {},
        { kicker: "Region Blocks · checked 5 days ago (YouTube)", head: "Blocked for everyone here", headRed: true, people: ["Nobody here is in a blocked country."],
          sites: "Not allowed outside YouTube, so it can’t play in this app", sitesRed: true, heads: ["Allowed · " + TABLE.length, "Blocked · 1"], blocked: ["Outside YouTube"], blockedCls: ["pin"] }],
      ["CAN'T PLAY OUTSIDE IT AND BLOCKED FOR SOMEONE (the page's phone card)", { blocked: ["DE"], embeddable: false, checkedAt: NOW - 60000, source: "youtube" }, { [MARIE]: "DE" },
        { kicker: "Region Blocks · checked 1 min ago (YouTube)", head: "Blocked for everyone here", headRed: true, people: ["marie · Germany (DE)"],
          heads: ["Allowed · " + (TABLE.length - 1), "Blocked · 2"], blocked: ["Outside YouTube", "Germany (DE) · marie"], blockedCls: ["pin", "here"] }],
      ["GREY — blocked somewhere, nobody here, the source not saying about other sites", { blocked: ["FR"], checkedAt: NOW - 41 * DAY, source: "proxynova" }, { [ANN]: "US" },
        { kicker: "Region Blocks · checked 1 month ago (ProxyNova)", head: "Not blocked for anyone here", headRed: false, people: ["Nobody here is in a blocked country."],
          sites: "Outside YouTube: not known (this source doesn’t say)", sitesRed: false, heads: ["Allowed · " + (TABLE.length - 1), "Blocked · 1"], blocked: ["France (FR)"] }],
      ["AN ALLOWED LIST — the lists swap sizes", { allowed: ["US", "CA"], embeddable: true, checkedAt: NOW - 12 * DAY, source: "youtube" }, { [MARIE]: "FR" },
        { head: "Blocked for 1 person here", headRed: true, people: ["marie · France (FR)"], heads: ["Allowed · 2", "Blocked · " + (TABLE.length - 2)], allowed: ["Canada (CA)", "United States (US)"] }],
      ["ALLOWED NOWHERE (an empty allowed list), nobody here", { allowed: [], checkedAt: NOW - 2 * DAY }, {},
        { kicker: "Region Blocks · checked 2 days ago", head: "Not blocked for anyone here", headRed: false, heads: ["Allowed · 0", "Blocked · " + TABLE.length], allowed: [] }],
      ["NO TIME SAVED — no \"checked\", and no source either", { blocked: ["FR"], source: "proxynova" }, {}, { kicker: "Region Blocks" }],
    ];
    for (const [what, geo, cc, want] of cases) {
      const w2 = popWorld(geo, cc);
      const o2 = await openOn(w2);
      const got = read(o2.c) || {};
      const bad = Object.keys(want).filter((k) => J(got[k]) !== J(want[k]));
      ok(o2.n === 1 && bad.length === 0, "D: " + what, bad.map((k) => [k, got[k]]));
    }
  });

  await part("E", async () => {
    const w = popWorld({ blocked: ["FR"], embeddable: true }, { [MARIE]: "FR" });
    await w.room();
    const g = geoOf(waitingRows(w)[0]);
    const col = g && g.closest(".column");
    ok(!!col, "E PREMISE — the globe's row is in a column (the tab it was clicked in)");
    let rect = { left: 12, top: 60, width: 385, height: 776 };
    if (col) col.getBoundingClientRect = () => Object.assign({ x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height }, rect);
    const before = (w.st.win.resize || []).slice();   // the page's own resize listeners, there before it opened
    g.click();
    const c = w.card(), ov = w.cards()[0];
    const box = () => (c ? [c.style.width, c.style.height, c.style.left, c.style.top] : null);
    ok(ov && has(ov, "preview-overlay") && ov.parent === w.doc.body && c && c.parent === ov && has(c, "preview-card") && has(c, "rb-card"),
      "E: THE PREVIEW'S OWN OVERLAY AND CARD — `.preview-overlay` on the page's body, `.preview-card` on it (borrowed, not declared again)", { ov: cls(ov), c: cls(c) });
    ok(J(box()) === J(["357px", "480px", "26px", "208px"]),
      "E: CENTRED ON ITS COLUMN, 14 PX IN — as wide as that leaves (357 of 385) and 480 px tall where the column has room", box());
    rect = { left: 12, top: 60, width: 385, height: 400 };
    w.sb.PlaylistPanels._geoPlace();
    ok(J(box()) === J(["357px", "372px", "26px", "74px"]), "E: A SHORTER COLUMN — the card 14 px in from its top and foot (372 of 400), still centred", box());
    // The whole card scrolls only when even the lists at their three lines do not fit (the sheet's floors, below).
    c.scrollHeight = 520; c.clientHeight = 372;
    w.sb.PlaylistPanels._geoPlace();
    ok(has(c, "rb-scrolls"), "E: TOO SHORT EVEN WITH THE LISTS AT THREE LINES — the whole card scrolls (`rb-scrolls`)", cls(c));
    c.scrollHeight = 372;
    w.sb.PlaylistPanels._geoPlace();
    ok(!has(c, "rb-scrolls"), "E: and where it fits, it does not", cls(c));
    // Placed again on a resize, as the preview is.
    rect = { left: 8, top: 8, width: 374, height: 768 };
    const rs = (w.st.win.resize || []).filter((fn) => before.indexOf(fn) < 0);
    for (const fn of rs) fn({ type: "resize" });
    ok(rs.length === 1 && J(box()) === J(["346px", "480px", "22px", "152px"]), "E: PLACED AGAIN ON A RESIZE — a phone's one column: 346 wide, 480 tall, centred", { listeners: rs.length, box: box() });
    // And on a layout switch (ui/shell.js `_applyLayout`, beside the preview's).
    rect = { left: 600, top: 40, width: 560, height: 820 };
    w.sb.Shell._setLayout("compact");
    ok(J(box()) === J(["532px", "480px", "614px", "210px"]), "E: PLACED AGAIN ON A LAYOUT SWITCH, as the preview is", box());
    // A column with no box (hidden): the window, as the preview falls back (`_columnArea`).
    rect = { left: 0, top: 0, width: 0, height: 0 };
    w.sb.PlaylistPanels._geoPlace();
    ok(J(box()) === J(["1372px", "480px", "14px", "210px"]), "E: A COLUMN WITH NO BOX — the window instead (1400 × 900 here), as the preview does", box());
    // The sheet's half of the rule (DECLARED: the double lays nothing out; Chromium measured it for the report).
    const rules = S.readSheet(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));
    const d = (sel, prop) => { const r = rules.find((x) => x.sel === sel); return r && r.decls[prop] ? r.decls[prop].val : null; };
    ok(d(".rb-lists", "min-height") === "84px" && d(".rb-lists", "flex") === "1 1 auto" && d(".rb-box div", "line-height") === "20px" &&
       d(".rb-box", "flex") === "1 1 auto" && d(".rb-box", "min-height") === "0" && d(".rb-box", "overflow-y") === "auto",
      "E: ONLY THE LISTS GIVE UP HEIGHT, DOWN TO THREE LINES (DECLARED) — `.rb-lists` grows and shrinks, floored at 84 px (its heading, 4 px and three 20-px lines); each list scrolls in its box",
      [d(".rb-lists", "min-height"), d(".rb-box div", "line-height")]);
    ok(d(".rb-people", "height") === "66px" && d(".rb-people", "overflow-y") === "auto" && d(".rb-card", "overflow") === "hidden" &&
       d(".rb-card.rb-scrolls", "overflow-y") === "auto" && d(".rb-map svg", "max-height") === "146px",
      "E: THE REST STAYS ITS SIZE (DECLARED) — the people box three lines and scrolling, the card's own scroll only with `rb-scrolls`, the map never taller than in the approved 357-px card (146 px)",
      [d(".rb-people", "height"), d(".rb-map svg", "max-height")]);
    ok(d(".preview-overlay", "background") === "rgba(0,0,0,0.4)" && d(".preview-overlay", "position") === "fixed",
      "E: THE OVERLAY DIMS THE APP BEHIND IT, as the preview's (DECLARED)", d(".preview-overlay", "background"));
  });

  await part("F", async () => {
    const w = popWorld({ blocked: ["IT", "FR", "DE"], embeddable: true }, { [MARIE]: "FR", [JONAS]: "DE", [ANN]: "US" });
    const { g, c } = await openOn(w);
    const who = c ? Array.from(c.querySelectorAll(".rb-person > span:first-child")) : [];
    ok(who.length === 2 && who[0].textContent === w.H.shortName(JONAS) && who[0].style.color === w.H.rankColor(w.H._rosterLevel(JONAS)) &&
       who[1].style.color === w.H.rankColor(w.H._rosterLevel(MARIE)) && who[0].style.color !== who[1].style.color,
      "F: NAMES AS EVERY NAME IN THE APP — the short name, in its rank's colour (two ranks, two colours)", who.map((n) => [n.textContent, n.style.color]));
    ok(who.length === 2 && who.every((n) => has(n, "uc-trigger") && n.getAttribute("role") === "button"), "F: each opens that person's card (the one trigger)");
    if (who[0]) { try { who[0].click(); } catch (e) {} }
    ok(w.cards().length === 0 && g.getAttribute("aria-expanded") === "false" && w.body().some((n) => /\buc-/.test(cls(n))),
      "F: CLICKING A NAME CLOSES THE POP-UP FIRST, then opens the card", w.body().map(cls));
    ok(w.body().filter((n) => /\buc-overlay\b/.test(cls(n))).length === 1, "F: the card (`.uc-overlay`), once", w.body().map(cls));
  });

  await part("G", async () => {
    const w = makeWorld({ geo: { [YT1]: { blocked: ["FR"] }, [YT2]: { blocked: ["DE"] } }, cc: {}, clock: true });
    await w.room();
    const a = geoOf(npRow(w)), b = geoOf(waitingRows(w)[0]);
    a.click();
    const first = w.card();
    ok(w.cards().length === 1 && first && /Title of yt:AAA/.test(textOf(first.querySelector(".rb-song"))), "G PREMISE — the song playing's globe opens its Region Blocks", w.cards().length);
    // The overlay takes every press, so a second globe is reached by the keyboard.
    if (typeof b.onkeydown === "function") b.onkeydown({ key: "Enter", preventDefault() {} });
    ok(w.cards().length === 1 && w.card() !== first && /Title of yt:BBB/.test(textOf(w.card().querySelector(".rb-song"))) &&
       a.getAttribute("aria-expanded") === "false" && b.getAttribute("aria-expanded") === "true",
      "G: ONE AT A TIME — the second opens in place of the first", w.cards().length);
    ok(w.cards().length === 1 && b.getAttribute("aria-expanded") === "true" && /Title of yt:BBB/.test(textOf((w.card() || w.main).querySelector(".rb-song"))),
      "G: Enter on the globe opens it (a keyboard's button)", w.cards().length);
    b.click();
    ok(w.cards().length === 0 && b.getAttribute("aria-expanded") === "false", "G: the globe again closes it", w.cards().length);
    b.click();
    w.card().querySelector(".preview-x").click();
    ok(w.cards().length === 0 && b.getAttribute("aria-expanded") === "false", "G: ITS ✕ CLOSES IT, as the preview's does", w.cards().length);
    // A click that began on the overlay closes it; one that began inside the card and was let go over the overlay does not.
    const press = (ov, target) => { for (const fn of (ov._listeners.pointerdown || [])) fn({ type: "pointerdown", target }); };
    b.click();
    let ov = w.cards()[0];
    press(ov, w.card()); ov.click();
    ok(w.cards().length === 1, "G: a press inside the card, let go over the overlay, leaves it open (the preview's rule)", w.cards().length);
    press(ov, ov); ov.click();
    ok(w.cards().length === 0, "G: A CLICK THAT BEGAN ON THE OVERLAY CLOSES IT, as the preview's does", w.cards().length);
    const keys0 = (w.doc.listeners.keydown || []).slice(), sizes0 = (w.st.win.resize || []).slice();   // the page's own, before it opens
    b.click(); w.doc.activeElement = w.main;
    for (const fn of (w.doc.listeners.keydown || []).slice()) fn({ type: "keydown", key: "Escape" });
    ok(w.cards().length === 0 && w.doc.activeElement === b, "G: ESCAPE CLOSES IT and puts the focus back on the globe", w.cards().length);
    const left = (w.doc.listeners.keydown || []).filter((fn) => keys0.indexOf(fn) < 0).length + (w.st.win.resize || []).filter((fn) => sizes0.indexOf(fn) < 0).length;
    ok(left === 0 && (w.doc.listeners.keydown || []).length === keys0.length, "G: CLOSED, IT LETS GO — no keydown or resize listener of its left behind", left);
    // A change of screen (ui/screens.js `showScreen`, beside the preview's).
    b.click();
    w.sb.Screens.showScreen("screen-rooms");
    ok(w.cards().length === 0, "G: A CHANGE OF SCREEN CLOSES IT, as it closes the preview", w.cards().length);
    // The globe leaves the page (its list rebuilt): closed at the next frame.
    w.sb.Screens.showScreen("screen-main");
    b.click();
    ok(w.cards().length === 1, "G PREMISE — open again", w.cards().length);
    b.closest(".song-row").remove();
    for (let i = 0; i < 3; i++) w.frame();
    ok(w.cards().length === 0, "G: AND IT CLOSES WHEN ITS GLOBE LEAVES THE PAGE — never left over a list that moved", w.cards().length);
  });

  const pathsOf = (c) => (c ? Array.from(c.querySelectorAll(".rb-map svg path")) : []);
  await part("H", async () => {
    const shapes = WorldMap ? WorldMap.paths() : [];
    const w = popWorld({ blocked: ["IT", "FR", "DE"], embeddable: true }, { [MARIE]: "FR", [JONAS]: "DE", [ANN]: "US" });
    const { c } = await openOn(w);
    const svg = c && c.querySelector(".rb-map svg");
    const ps = pathsOf(c);
    ok(svg && svg.getAttribute("viewBox") === "0 0 960 423" && ps.length === shapes.length && shapes.length >= 170,
      "H PREMISE — THE MAP: every shape of `core/worldmap.js` drawn, in its 960 × 423 frame", { viewBox: svg && svg.getAttribute("viewBox"), drawn: ps.length, shapes: shapes.length });
    const byI = (p) => shapes[Number(p.getAttribute("data-i"))] || {};
    const wrong = ps.filter((p) => {
      const s = byI(p), want = !s.code ? "none" : (["IT", "FR", "DE"].indexOf(s.code) >= 0 ? "bad" : "ok");
      return !has(p, want) || p.getAttribute("d") !== s.d;
    }).map((p) => [byI(p).code, cls(p)]);
    ok(wrong.length === 0, "H: GREEN WHERE ALLOWED, RED WHERE BLOCKED, GREY WHERE A SHAPE HAS NO COUNTRY (\"No data\")", wrong.slice(0, 5));
    const here = ps.filter((p) => has(p, "here")).map((p) => byI(p).code).sort();
    ok(J(here) === J(["DE", "FR"]) && ps.slice(-2).every((p) => has(p, "here")),
      "H: THE COUNTRIES OF PEOPLE HERE OUTLINED (`here`), drawn last so the outline shows", { here, last: ps.slice(-2).map(cls) });
    const keys = c ? Array.from(c.querySelectorAll(".rb-legend > span")) : [];
    ok(J(keys.map(textOf)) === J(["Allowed", "Blocked", "No data", "Someone here"]) &&
       J(keys.map((k) => cls(k.querySelector("i")))) === J(["rb-key ok", "rb-key bad", "rb-key none", "rb-key here"]),
      "H: THE LEGEND — Allowed, Blocked, No data, Someone here, each with its key", keys.map(textOf));
    const rules = S.readSheet(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"));
    const d = (sel, prop) => { const r = rules.find((x) => x.sel === sel); return r && r.decls[prop] ? r.decls[prop].val : null; };
    ok(d(".rb-map path.ok", "fill") === "var(--rb-ok)" && d(".rb-key.ok", "background") === "var(--rb-ok)" &&
       d(".rb-map path.bad", "fill") === "var(--rb-bad)" && d(".rb-key.bad", "background") === "var(--rb-bad)" &&
       d(".rb-map path.none", "fill") === "var(--rb-none)" && d(".rb-key.none", "background") === "var(--rb-none)" &&
       d(".rb-card", "--rb-ok") === "#2f9e5b" && d(".rb-card", "--rb-bad") === "#d6363c" && d(".rb-card", "--rb-none") === "#3a3d44",
      "H: EACH COLOUR SAID ONCE (DECLARED) — the map's fills and the legend's keys read the card's own variables, the page's colours",
      [d(".rb-map path.ok", "fill"), d(".rb-key.ok", "background"), d(".rb-card", "--rb-ok")]);
  });

  await part("T", async () => {
    const shapes = WorldMap ? WorldMap.paths() : [];
    const w = popWorld({ blocked: ["IT", "FR", "DE"], embeddable: true }, { [MARIE]: "FR", [JONAS]: "DE", [ANN]: "US" });
    const { c } = await openOn(w);
    const svg = c && c.querySelector(".rb-map svg"), map = c && c.querySelector(".rb-map"), tip = c && c.querySelector(".rb-tip");
    const pathFor = (pred) => pathsOf(c).find((p) => pred(shapes[Number(p.getAttribute("data-i"))] || {}));
    const fire = (node, type, target) => { for (const fn of ((node && node._listeners[type]) || []).slice()) fn({ type, target, clientX: 100, clientY: 40 }); };
    const tipText = () => kids(tip).map(textOf);
    fire(svg, "mousemove", pathFor((s) => s.code === "FR"));
    ok(tip && tip.style.display === "block" && J(tipText()) === J(["France", "Blocked", "Blocked for marie"]),
      "T: POINTING AT A COUNTRY — its name, \"Blocked\", and who here it is blocked for", tipText());
    fire(svg, "mousemove", pathFor((s) => s.code === "US"));
    ok(J(tipText()) === J(["United States", "Allowed"]) && cls(kids(tip)[1]) === "ok", "T: an allowed one — its name and \"Allowed\"", tipText());
    const nd = pathFor((s) => !s.code);
    fire(svg, "mousemove", nd);
    ok(nd && J(tipText()) === J([shapes[Number(nd.getAttribute("data-i"))].name, "No data for this country"]), "T: a shape with no country in the table — its name and \"No data for this country\"", tipText());
    fire(svg, "mousemove", svg);
    ok(tip.style.display === "none", "T: OFF A COUNTRY (the sea), the tip goes", tip.style.display);
    fire(svg, "click", pathFor((s) => s.code === "DE"));
    ok(tip.style.display === "block" && J(tipText()) === J(["Germany", "Blocked", "Blocked for jonas"]), "T: A TAP SHOWS IT TOO (a phone)", tipText());
    fire(map, "mouseleave", map);
    ok(tip.style.display === "none", "T: LEAVING THE MAP, the tip goes", tip.style.display);
  });

  await part("W", async () => {
    // The song table renamed: YouTube's row says "Tube", ProxyNova's source says "Proxy Nine". Every line naming either follows.
    const renamed = Object.assign({}, Songs, {
      services: () => Songs.services().map((r) => (r.short === "yt" ? Object.assign({}, r, { name: "Tube" }) : r)),
      regionSources: () => Songs.regionSources().map((x) => (x.id === "proxynova" ? Object.assign({}, x, { name: "Proxy Nine" }) : x)),
    });
    const w = popWorld({ blocked: ["DE"], embeddable: false, checkedAt: NOW - 3 * DAY, source: "proxynova" }, {}, { songs: renamed });
    const { g, c } = await openOn(w);
    const r = read(c) || {};
    ok(r.kicker === "Region Blocks · checked 3 days ago (Proxy Nine)" && r.sites === "Not allowed outside Tube, so it can’t play in this app" && r.blocked[0] === "Outside Tube" &&
       g.getAttribute("title") === "Not allowed outside Tube",
      "W: THE WORDS FROM THE TABLE — the service's name and the source's are their rows' (the icon's words too)", [r.kicker, r.sites, r.blocked && r.blocked[0], g.getAttribute("title")]);
    const w2 = popWorld({ blocked: ["FR"], embeddable: true }, {}, { songs: renamed });
    const o2 = await openOn(w2);
    ok((read(o2.c) || {}).sites === "Allowed outside Tube", "W: \"Allowed outside …\" too", read(o2.c));
    const w3 = popWorld({ blocked: ["FR"] }, {}, { songs: renamed });
    const o3 = await openOn(w3);
    ok((read(o3.c) || {}).sites === "Outside Tube: not known (this source doesn’t say)", "W: and \"Outside …: not known\"", read(o3.c));
  });

  await part("I", async () => {
    // A lookup's answer, through the REAL pipeline: the waiting row's song had a grey answer (Germany), Region Blocks open; the
    // lookup saves a new one (France, where Marie is): the globe turns red and the card follows, where they stand.
    const w = makeWorld({ np: YT1, waiting: YT2, geo: { [YT2]: { blocked: ["DE"] } }, cc: { [MARIE]: "FR" }, answers: { [YT2]: { blocked: ["FR"], embeddable: true } }, clock: true });
    await w.room();
    const wr = waitingRows(w)[0];
    ok(wr && has(geoOf(wr), "geo-grey"), "I PREMISE — the waiting row's globe grey: nobody REP names is in Germany", wr && cls(geoOf(wr)));
    geoOf(wr).click();
    const card = w.card();
    ok(w.cards().length === 1 && (read(card) || {}).head === "Not blocked for anyone here", "I PREMISE — Region Blocks open", read(card));
    const watch = w.watch(w.qb);
    await w.inView(wr);
    const seen = watch.take();
    ok(w.st.ensures.length === 1 && has(geoOf(wr), "geo-red") && geoOf(wr).querySelectorAll(".geo-ico").length === 1,
      "I: A LOOKUP'S ANSWER REDRAWS THE ROW'S GLOBE — red now, one globe still", { ensures: w.st.ensures.length, wr: cls(geoOf(wr)) });
    ok(w.cards().length === 1 && w.card() === card && (read(card) || {}).head === "Blocked for 1 person here", "I: and its open pop-up, where it stands", read(card));
    ok(seen.rowsBuilt === 0 && seen.rowsRemoved === 0 && seen.paneRebuilds === 0, "I: IN PLACE — no song row built or removed, the pane not rebuilt", seen);
    // REP's countries move: grey -> red, and the open card with them.
    const w2 = makeWorld({ geo: { [YT1]: { blocked: ["FR"] }, [YT2]: { blocked: ["DE"] } }, cc: {}, clock: true });
    await w2.room();
    const g1 = geoOf(npRow(w2)), g2 = geoOf(waitingRows(w2)[0]);
    ok(has(g1, "geo-grey") && has(g2, "geo-grey"), "I PREMISE — both grey: nobody REP names is in France or Germany");
    g2.click();
    const card2 = w2.card();
    ok(w2.cards().length === 1 && (read(card2) || {}).head === "Not blocked for anyone here", "I PREMISE — Region Blocks open, nobody blocked", read(card2));
    const watch2 = w2.watch(w2.qb);
    w2.st.cc = { [JONAS]: "DE" };
    w2.sb.PlaylistPanels.geoChanged();
    const seen2 = watch2.take();
    ok(has(g1, "geo-grey") && has(g2, "geo-red") && g2.getAttribute("title") === "Blocked for someone here",
      "I: REP'S COUNTRIES MOVED — Jonas is in Germany: that globe turns red where it stands, the other stays grey", [cls(g1), cls(g2)]);
    ok(w2.cards().length === 1 && w2.card() === card2 && (read(card2) || {}).head === "Blocked for 1 person here" && g2.getAttribute("aria-expanded") === "true",
      "I: and the open pop-up redrawn where it stands, still open", read(card2));
    ok(seen2.rowsBuilt === 0 && seen2.rowsRemoved === 0 && seen2.paneRebuilds === 0, "I: in place: no row built or removed", seen2);
    g1.setAttribute("title", "marker");
    w2.sb.PlaylistPanels.geoChanged();
    ok(g1.getAttribute("title") === "marker", "I: THE SAME COUNTRIES AGAIN DRAW NOTHING — a vote moving REP's numbers raises the same signal", g1.getAttribute("title"));
    // The wiring: the main screen's subscriptions hand `geoChanged` to the feature layer's "the people view changed".
    const w3 = makeWorld({});
    let threw = null;
    try { w3.sb.Screens.enterMainScreen(ROOM); } catch (e) { threw = e.message; }
    ok(w3.st.pv.indexOf(w3.sb.PlaylistPanels.geoChanged) >= 0,
      "I: WIRED — entering the room hands `PlaylistPanels.geoChanged` to `Room.onPeopleViewChange`, the signal REP raises when countries move", { threw, n: w3.st.pv.length });
  });

  await part("K", async () => {
    // The REAL `MetadataService.heldGeo`, over a store holding saved answers with sources of every kind.
    const recs = {
      [YT2]: { geo: { blocked: ["FR"], embeddable: true, checkedAt: 5, source: "proxynova" } },
      [YT3]: { geo: { blocked: ["FR"], checkedAt: 5, source: "made-up" } },
      [YT4]: { geo: { blocked: ["FR"], checkedAt: 5 } },
      [YT5]: { geo: { blocked: ["FR"], checkedAt: 5, source: 7 } },
    };
    const { MetadataService: M } = loadInContext(["core/countries.js", "features/metadata.js"], {
      Store: { meta: { peek: (k) => recs[k] || null, load() { return Promise.resolve(null); }, persist() { return Promise.resolve(true); } } },
    });
    const src = (k) => { const g = M.heldGeo(k); return g ? (g.source === undefined ? "none" : g.source) : "no answer"; };
    ok(src(YT2) === "proxynova", "K: A SOURCE IN THE SONG TABLE COMES BACK with the saved answer (for \"checked … (ProxyNova)\")", src(YT2));
    ok(src(YT3) === "none" && src(YT4) === "none" && src(YT5) === "none",
      "K: AND NOTHING ELSE DOES — a source no row names, none, or not a word: no source", [src(YT3), src(YT4), src(YT5)]);
    ok(J(M.heldGeo(YT2)) === J({ blocked: ["FR"], embeddable: true, checkedAt: 5, source: "proxynova" }), "K: the rest of the answer as the boundary keeps it", M.heldGeo(YT2));
  });

  _finished = true;
  if (failed) { console.log("[geo-icon] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[geo-icon] PASS — a song blocked somewhere shows a globe, and Region Blocks says for whom and where (J153 (c), `ddjp_729`; " + asserts +
    " assertions). ONE VERDICT (`Countries.blockedView`, real): no globe with no answer or none left out; grey for nobody REP names; red for " +
    "someone, or a song that cannot play outside its service; `blocked`, every country left out. WHERE: the room queue, its song playing " +
    "included, My queue, a playlist and History (`ddjp_736`, the owner's reversal) — the song playing's and History's drawn from the saved answer, " +
    "the real pipeline asking them nothing, and a History row with no answer held drawing none and asking nothing. " +
    "THE GREY LINE (`ddjp_730`): the globe first with its 5 px gap, then the length, \" · \" and the name, the dot only after a length, in every " +
    "list and case; History's line \"🌐 name · age\" with the answer held, \"name · age\" without; the tap area inside the gaps. " +
    "REGION BLOCKS, as the design page: its lines for every shape, every country listed once A to Z, \"Outside YouTube\" pinned and counted; " +
    "the preview's overlay and card, centred on the globe's column, 14 px in, at most 480 px tall, the card scrolling only when the lists at " +
    "three lines do not fit, placed again on a resize and a layout switch; names in their rank's colour opening the card; one open, closed " +
    "by ✕, Escape (focus back), a click begun on the overlay, its globe leaving and a change of screen; the map's colours, outlines and " +
    "legend; the tip; the words from the song table; REDRAWN IN PLACE on a lookup's answer and on REP's countries moving; the source's name " +
    "only ever the table's. NOT HERE: real layout, the hover's feel, a phone (Chromium, for the report)");
})().catch((e) => { console.log("[geo-icon] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
