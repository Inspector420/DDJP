// tests/check-sc-placeholder.js
// SUBJECT: index.html, ui/playlists.js, ui/queue.js, ui/panels.js
//
// WALL: A SOUNDCLOUD SONG'S PICTURE IS THE APP'S OWN LIGHT ♪ BOX (`ddjp_709`, J151; the supervisor's decision 2). The owner's
// words: "Pictures in lists make a music note witha  slight grey white background so its easy to see its a soundlcoud song, we
// make our own little placeholder image for souncloud songs". SoundCloud's row has no picture (`Songs.pictureOf` is null), so
// in every place a song's picture shows, a SoundCloud song's slot is drawn by the page's CSS from the song's service — the
// slot's own size, `#e9e9ee`, a `♪` in `#4a4a55` at 16 px — with no image file, and stays the preview button. YouTube's slot,
// its picture and its dark box while one loads, is unchanged.
//
//   PART A — EVERY PLACE: the room queue's Now Playing row and a waiting row, My queue's rows, History's rows and a playlist's
//            songs, built by the real ui/ code (`tests/_screen-world.js`) with a SoundCloud song and a YouTube song in each.
//            A SoundCloud slot: `data-service="sc"`, the light box at the slot's size (the sheet's cascade), its `::before` the
//            ♪ in the dark grey at 16 px (the sheet's rules for the slot's `::before`, matched and ranked here as a browser
//            ranks them), no picture address on its image. A YouTube slot: `data-service="yt"`, the dark box, the grey ♪ at 14
//            px, its picture address as before.
//   PART B — THE SLOT STAYS THE PREVIEW BUTTON: a SoundCloud slot is a button labelled "Preview this song", and a click opens
//            the preview of that song (the preview's own player is `check-player-plug`'s, PART E).
//   PART C — THE PLACES ARE DERIVED: every song row in ui/ is `PlaylistPanels.songRow` (the one place a picture slot with a
//            song is made), and its callers are the places PART A drives — a new caller is a new place, and this guard says so.
//   PART D — NO IMAGE FILE: the placeholder's rules name no `url(`, and the tree carries no image file (his rule).
//
// What a browser draws — the computed background and ♪ and the slot's measured size at 1280 and 390 px — is in the `ddjp_709`
// report (its browser checks); this guard holds what the page declares and what the code builds.
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("./_screen-world.js");
const ROOT = path.join(__dirname, "..");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[sc-placeholder] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SHEET = S.readSheet(HTML);
const NOW = 1.9e12;
const SC1 = "sc:artist-one/track-one", SC2 = "sc:artist-two/track-two", SC3 = "sc:artist-three/track-three";
const YT1 = "yt:AAAAAAAAAAA", YT2 = "yt:BBBBBBBBBBB", YT3 = "yt:CCCCCCCCCCC";

// The main screen, built as a room's entry builds it, its lists holding a SoundCloud song and a YouTube song each.
function screen() {
  const st = {
    playing: { dj: "@dj:hs", song: { songKey: SC1 }, pi: "p0" },
    rotation: [{ user: "@ann:hs", pending: [{ songKey: SC2 }] }, { user: "@bob:hs", pending: [{ songKey: YT2 }] }],
    mine: [{ songKey: SC3 }, { songKey: YT3 }],
    history: [{ songKey: SC2, dj: "@ann:hs", at: NOW - 60000, pi: "h1", cutShortBy: false }, { songKey: YT1, dj: "@bob:hs", at: NOW - 360000, pi: "h2", cutShortBy: false }],
    playlist: { id: "pl_mix", name: "Mix", tracks: [{ songKey: SC1 }, { songKey: YT1 }] },
  };
  const features = {
    Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }], getMyId: () => "@me:hs",
      getRoster: () => [{ userId: "@dj:hs", level: 10 }, { userId: "@ann:hs", level: 10 }, { userId: "@bob:hs", level: 10 }], recentEvents: () => ({ rows: [] }), FEED_KINDS: {} },
    Queue: { getNowPlaying: () => st.playing, getRotation: () => st.rotation, lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
      recentHistory: () => st.history, historyReach: () => ({ entries: 2, complete: true }), getState: () => ({ counts: {} }) },
    UserQueue: { items: () => st.mine.slice(), count: () => st.mine.length, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
    Reactions: { hasSaved: () => false, hasVoted: () => false },
    Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible: () => {} },
    ChatPrefs: { layout: () => "wide", setLayout: () => {}, playerHidden: () => false, overlayBlocked: () => false, previewVolume: () => null, previewMuted: () => null },
    Playlists: { list: () => [{ id: st.playlist.id, name: st.playlist.name }], get: (id) => Promise.resolve(JSON.parse(JSON.stringify(st.playlist))),
      addTrackByUrl: () => Promise.resolve({ ok: true }) },
    ServerClock: { serverNow: () => NOW },
    Store: { meta: { peek: (k) => ({ title: "Title of " + k, durationSec: 200 }), load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null), has: () => Promise.resolve(false) } },
  };
  // The picture address a row is handed is the song table's (`MetadataService.thumbUrl` is `Songs.pictureOf`).
  const w = S.world({ features, domShaped: true, globals: { URL, MetadataService: { thumbUrl: (k) => (k.indexOf("yt:") === 0 ? "https://i.ytimg.com/vi/" + k.slice(3) + "/mqdefault.jpg" : null),
    get: () => Promise.resolve(null) }, SC: { Widget: function () { return { bind() {}, unbind() {}, play() {}, pause() {}, seekTo() {}, setVolume() {}, load() {},
    getPosition() {}, getDuration() {}, getCurrentSound() {}, getVolume() {} }; } }, YT: { Player: function () { return {}; } } } });
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  w.st = st;
  w.q = (sel, root) => (root || w.main).querySelector(sel);
  w.qa = (sel, root) => Array.from((root || w.main).querySelectorAll(sel));
  w.decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
  return w;
}
// THE SLOT'S `::before`, AS A BROWSER RANKS IT: every rule of the sheet ending in `::before` whose selector (without it) matches
// the slot, the highest specificity winning, a later rule a tie (the cascade reads no pseudo-element, so this part does).
function beforeOf(n) {
  const out = {};
  const hits = SHEET.filter((r) => /::before$/.test(r.sel) && S.matches(n, r.sel.replace(/::before$/, "")))
    .sort((a, b) => (a.spec > b.spec ? 1 : a.spec < b.spec ? -1 : 0) || a.order - b.order);
  for (const r of hits) for (const k of Object.keys(r.decls)) out[k] = r.decls[k].val;
  return { content: out.content || null, color: out.color || null, fontSize: out["font-size"] || null, rules: hits.map((r) => r.sel) };
}
const svcOf = (slot) => (slot ? slot.getAttribute("data-service") : null);
const keyOf = (row) => (row ? row.getAttribute("data-vid") : null);

(async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const w = screen();
  const qb = w.refs.queueBody;
  const places = [];   // [place, row]
  w.refs.tabRoom.click();
  const np = w.q(".rq-list .song-row.playing", qb);
  places.push(["the room queue's Now Playing row", np]);
  for (const r of w.qa(".rq-list .song-row", qb)) if (r !== np && !/\brq-np-empty\b/.test(r.className)) places.push(["a room queue row", r]);
  w.refs.tabMine.click();
  for (const r of w.qa(".song-row", qb)) places.push(["a My queue row", r]);
  w.refs.tabHistory.click();
  for (const r of w.qa(".hist-list .song-row", qb)) places.push(["a History row", r]);
  w.refs.tabPlaylists.click();
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Mix");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();
  for (const r of w.qa(".song-row", qb)) places.push(["a playlist's song", r]);
  const sc = places.filter(([, r]) => /^sc:/.test(keyOf(r) || "")), yt = places.filter(([, r]) => /^yt:/.test(keyOf(r) || ""));
  const where = (list) => Array.from(new Set(list.map(([p]) => p)));
  const WANT = ["the room queue's Now Playing row", "a room queue row", "a My queue row", "a History row", "a playlist's song"];
  ok(JSON.stringify(where(sc)) === JSON.stringify(WANT), "A PREMISE — a SoundCloud song's row was drawn in every place a song's picture shows", where(sc));
  ok(JSON.stringify(where(yt)) === JSON.stringify(WANT.slice(1)) || JSON.stringify(where(yt)) === JSON.stringify(WANT),
    "A PREMISE — and a YouTube song's row beside it (Now Playing holds one song, SoundCloud's)", where(yt));

  // ═══ PART A — the light box in every place; YouTube's unchanged ═══
  const slotOf = (row) => w.q(".thumb-slot", row);
  const scBad = [], ytBad = [];
  for (const [place, row] of sc) {
    const s = slotOf(row), b = s ? beforeOf(s) : {}, img = s ? w.q("img.thumb", s) : null;
    const got = { place, key: keyOf(row), service: svcOf(s), bg: w.decl(s, "background"), w: w.decl(s, "width"), h: w.decl(s, "height"), minH: w.decl(s, "min-height"),
      radius: w.decl(s, "border-radius"), before: b, url: img ? img.getAttribute("data-url") : "(no image)", src: img ? img.getAttribute("src") : null };
    if (got.service !== "sc" || got.bg !== "#e9e9ee" || got.w !== "53px" || got.h !== "30px" || got.minH !== "30px" || got.radius !== "3px" ||
      got.before.content !== '"\\266A"' || got.before.color !== "#4a4a55" || got.before.fontSize !== "16px" || got.url !== null || got.src !== null) scBad.push(got);
  }
  ok(sc.length >= 5 && scBad.length === 0,
    "A — EVERY SOUNDCLOUD SONG'S SLOT IS THE LIGHT ♪ BOX (decision 2): `data-service=\"sc\"`, the slot's size (53 × 30, its corners), background " +
    "#e9e9ee, its ♪ in #4a4a55 at 16 px — and no picture address on its image", scBad);
  for (const [place, row] of yt) {
    const s = slotOf(row), b = s ? beforeOf(s) : {}, img = s ? w.q("img.thumb", s) : null;
    const got = { place, key: keyOf(row), service: svcOf(s), bg: w.decl(s, "background"), w: w.decl(s, "width"), h: w.decl(s, "height"), before: b,
      url: img ? img.getAttribute("data-url") : "(no image)" };
    if (got.service !== "yt" || got.bg !== "#26262c" || got.w !== "53px" || got.h !== "30px" || got.before.content !== '"\\266A"' ||
      got.before.color !== "#51515b" || got.before.fontSize !== "14px" || !/^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\//.test(got.url || "")) ytBad.push(got);
  }
  ok(yt.length >= 4 && ytBad.length === 0,
    "A — A YOUTUBE SONG'S SLOT IS UNCHANGED: the dark box #26262c while its picture loads, the grey ♪ #51515b at 14 px, the slot's size, its picture address", ytBad);
  // The rules themselves: one for the box, one for its ♪, each keyed on the slot's service, after the slot's own.
  const boxRule = SHEET.find((r) => r.sel === '.song-row .thumb-slot[data-service="sc"]');
  const noteRule = SHEET.find((r) => r.sel === '.song-row .thumb-slot[data-service="sc"]::before');
  const base = SHEET.find((r) => r.sel === ".song-row .thumb-slot");
  ok(!!boxRule && !!noteRule && !!base && Object.keys(boxRule.decls).join() === "background" && Object.keys(noteRule.decls).sort().join() === "color,font-size" &&
    boxRule.order > base.order,
    "A — DRAWN BY THE PAGE'S CSS, KEYED ON THE SONG'S SERVICE: one rule gives the slot its background, one its ♪'s colour and size; the size is the slot's own rule's",
    { box: boxRule && boxRule.decls, note: noteRule && noteRule.decls });

  // ═══ PART B — the slot stays the preview button ═══
  const bBad = sc.filter(([, row]) => { const s = slotOf(row); return !s || s.getAttribute("role") !== "button" || s.getAttribute("aria-label") !== "Preview this song" ||
    s.getAttribute("tabindex") !== "0" || typeof s.onclick !== "function" || /\brq-np-empty\b/.test(row.className); }).map(([p, row]) => p + " " + keyOf(row));
  ok(bBad.length === 0, "B — A SOUNDCLOUD SLOT IS STILL THE PREVIEW BUTTON: a button, labelled \"Preview this song\", reachable by the keyboard", bBad);
  // A click opens the preview of that song: the card on the page, and the preview's box handed that song's key.
  const made = [];
  w.sb.SongPlayer.make = ((orig) => function (box, opts, on) { made.push(opts && opts.song); return orig.apply(this, arguments); })(w.sb.SongPlayer.make);
  const s1 = slotOf(sc[sc.length - 1][1]);
  try { s1.onclick(); } catch (e) { made.push("threw " + (e && e.message)); }
  for (let i = 0; i < 3; i++) await tick();
  const card = (w.doc.body._kids || []).find((x) => /\bpreview-overlay\b/.test(x.className || ""));
  ok(!!card && made.length === 1 && made[0] === keyOf(sc[sc.length - 1][1]),
    "B — and a click on it opens the preview of that SoundCloud song (its box handed the song's key)", { card: !!card, made });

  // ═══ PART C — the places are derived: every song row in ui/ is `songRow` ═══
  const uiFiles = fs.readdirSync(path.join(ROOT, "ui")).filter((f) => f.endsWith(".js")).sort();
  const callers = [], slots = [];
  for (const f of uiFiles) {
    const src = fs.readFileSync(path.join(ROOT, "ui", f), "utf8").split("\n");
    src.forEach((l, i) => {
      if (/\bsongRow\(/.test(l) && !/function songRow\(/.test(l) && !/^\s*\/\//.test(l)) callers.push("ui/" + f + ":" + (i + 1));
      if (/class: "thumb-slot"/.test(l)) slots.push("ui/" + f + ":" + (i + 1));
    });
  }
  ok(callers.length === 5, "C — EVERY PLACE A SONG'S PICTURE SHOWS IS A CALL OF `songRow`, and there are five — History, a playlist's songs, Now Playing, " +
    "the room queue's rows, My queue's rows — each driven in PART A (a sixth caller is a new place: drive it here)", callers);
  ok(slots.length === 2 && slots.some((x) => /^ui\/playlists\.js:/.test(x)) && slots.some((x) => /^ui\/queue\.js:/.test(x)),
    "C — and a picture slot is made in two places only: `songRow`'s, and the empty play row's, which holds no song", slots);

  // ═══ PART D — no image file ═══
  ok(!/url\(/.test(JSON.stringify(boxRule || {}) + JSON.stringify(noteRule || {})), "D — THE PLACEHOLDER NAMES NO IMAGE: its rules hold no `url(`");
  const images = [];
  const walk = (rel) => {
    for (const n of fs.readdirSync(path.join(ROOT, rel))) {
      if (n === "node_modules" || n === ".git") continue;
      const r = rel ? rel + "/" + n : n;
      if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i.test(n)) images.push(r);
    }
  };
  walk("");
  ok(images.length === 0, "D — AND THE TREE CARRIES NO IMAGE FILE (his rule: no images in the zip)", images);

  if (failed) { console.log("[sc-placeholder] " + failed + " failure(s)"); process.exit(1); }
  console.log("[sc-placeholder] PASS — a SoundCloud song's picture is the app's own light ♪ box (" + asserts + " assertions): in " + sc.length +
    " SoundCloud slots across " + where(sc).length + " places (" + where(sc).join(", ") + ") the slot is `data-service=\"sc\"`, 53 × 30, #e9e9ee, its ♪ " +
    "#4a4a55 at 16 px, no picture address, still the preview button (a click opens its preview); " + yt.length + " YouTube slots unchanged (#26262c, " +
    "♪ #51515b at 14 px, their picture address); the places derived (5 callers of `songRow`); no image file in the tree");
})().catch((e) => { console.log("[sc-placeholder] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
