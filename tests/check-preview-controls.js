// tests/check-preview-controls.js
// SUBJECT: ui/playlists.js, ui/player.js, ui/shell.js, core/chatprefs.js, index.html
// WALL: the song preview's own controls, and the main player's remembered sound (J134, the owner's: "also in the song preview
// i want to have the mute, sound slider, refresh, hd button and mosue block" / "and a timeline above all those you can click
// in and move where the video is playing proportionally" / "then i want that under manu to count as total height before its
// centered vertically, i also want all these buttons to remember position and state separate fromt he main player" / "they
// can bowth be set diffrently and survive reload tab." On HD: "skip it". Asked whether the main player should remember its
// volume and mute: "yes").
//
// Under the preview's video, inside its card, two lines: the TIMELINE and the BUTTONS, drawn as the main player draws them. A
// click or a drag on the bar moves the video there, also with the block on; the block is a see-through cover over the video
// only; no HD. The card's height counts both lines: the largest video that fits WITH them, then the card centred. The
// preview's volume, mute and block are remembered on this device apart from the main player's, which remembers its own volume
// and mute (full and unmuted before anything is saved). The controls belong to one open: closing stops their loop, poll and
// drag, and a reopen gets new ones. (J134; it read: the times at the bar's ends, YouTube's own bar kept, and the preview at the
// main player's level with the block off before anything was saved — each changed by J135, below.)
// THE THIRD ROUND (`ddjp_702`, the owner's: "the button to lock the mouse from the song can be removed we only neeed the fueature for
// teh player / and we dont need to lock the user in, if the user clicks outside the preview player frame we can close the video"): no
// 🖱 and no cover; a click outside the card closes it and does nothing else (PART O).
// THE SECOND ROUND (J135, the owner's; his words in `main/04-features.md` §Preview / mini-player): the top line the bar alone,
// the full width; under it ❚❚/▶ play/pause (new, following the player's own state), 🔊, the slider at the main player's 100 px,
// the two times together, ↻ and 🖱 (🖱 and its cover went at `ddjp_702`); YouTube's own bar OFF; before anything is chosen 🖱 ON and the volume at half, a device that
// ran 679 included; a drag the browser cancels ends with no seek (PART X); the card held to its video's width; and the main
// player's poll never saves a silence the browser started on a page nobody touched (PART M).
//
// DRIVEN: the REAL preview — `_openPreview`, `_closePreview`, `_positionPreview` and every `_pv…` function, extracted from
// ui/playlists.js with its constants, and the REAL `el` and `fmt` from ui/base.js — over the screen world's DOM double
// (`tests/_screen-world.js`) and a YouTube player double this guard moves; the REAL `core/chatprefs.js` keeps what is
// remembered, over a store this guard carries across a "reload" (a new world on the same saved blob). The main player's
// slider and 🔊 are the REAL `buildMainDom` in the screen world; its adoption of a change made inside YouTube's frame is the
// REAL `_pollPlayerVolume` and `rememberVolumeState` from ui/player.js. MODELLED: the card's box — its padding and border from
// the sheet, each line's top margin from the sheet, each line's height as Chromium measured it (the timeline 20 px, the
// buttons 32 px). Which nodes the cover covers is the sheet's own (`cascade.shown`). THIS GUARD CANNOT SEE A REAL LAYOUT OR
// A REAL YOUTUBE PLAYER — Chromium measured the card at 360, 390 and 1400 px (J134's entry).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, loadInContext } = require("./_load");
const P = require("./_probe-j14-card.js");
const S = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[preview-controls] FAIL — " + msg); if (got !== undefined) console.log("      got " + JSON.stringify(got)); }
  return !!c;
}
function part(name, f) { try { f(); } catch (e) { ok(false, name + " — the part threw: " + (e && e.message || e)); } }
const near = (a, b, tol) => typeof a === "number" && isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1 : tol);
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// ── THE SOURCES ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const PL = "ui/playlists.js";
const plSrc = fs.readFileSync(path.join(ROOT, PL), "utf8");
function grab(rel, name, need) {
  const x = P.extractNamed(rel, name);
  if (need) ok(x.ok, "APPLIED — `" + name + "` is extractable from " + rel, x.stage);
  return x.ok ? x.source : "";
}
// CHANGED ON PURPOSE (`ddjp_712`): ↻ is a hold button (`holdButton`, its one number and its hover words, from ui/base.js), and
// its tap, its point, its rebuild and the making of the preview's player are named functions (`_pvReload`, `_pvPoint`,
// `_pvRebuild`, `_pvMake`) — run here as shipped.
const baseSrc = fs.readFileSync(path.join(ROOT, "ui/base.js"), "utf8");
const BASE = ["el", "fmt", "holdButton"].map((n) => grab("ui/base.js", n, true)).join("\n") + "\n" +
  (baseSrc.match(/^\s*const (HOLD_MS|RELOAD_TITLE) = [^;\n]*;/gm) || []).join("\n");
const CORE = ["_openPreview", "_closePreview", "_positionPreview", "_previewRecordMeta"].map((n) => grab(PL, n, true)).join("\n");
// `_pvSetBlocked` left with the preview's 🖱 (`ddjp_702`; `check-preview-close` holds that it is gone).
const J134 = ["_pvRemembered", "_pvApplyVolume", "_pvRemember", "_pvPollVolume", "_pvDraw", "_pvTick", "_pvTimeAt", "_pvBuild",
  "_pvTeardown", "_pvPoint", "_pvReload", "_pvRebuild", "_pvMake"].map((n) => grab(PL, n, true)).join("\n");
const J135 = ["_pvPlayState", "_pvDrawPlay", "_pvPlayPress"].map((n) => grab(PL, n, true)).join("\n");   // play/pause (J135)
const OLD = grab(PL, "_applyVolumeToPreview", false);   // the tree before J134 had it; this one does not
const CONSTS = (plSrc.match(/^\s*const PV_[^;\n]*;/gm) || []).join("\n");
// THE SONG PLAYERS, AS SHIPPED (J29, step 2): the preview is made through the plug (`ui/songplayer.js`), and the YouTube player
// file (`ui/youtube.js`) makes YouTube's player over this guard's double — both run whole in the preview's context.
// The song players' plug and YouTube's player (J29, step 2) — refused by name in a tree without them.
const PLUG_FILES = ["ui/songplayer.js", "ui/youtube.js"];
const PLUG_ABSENT = PLUG_FILES.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
if (PLUG_ABSENT.length) {
  console.log("[preview-controls] FAIL — PREMISE — the song players' plug is not in this tree (J29, step 2): missing " + PLUG_ABSENT.join(", "));
  process.exit(1);
}
const PLUG = PLUG_FILES.map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")).join("\n");

// ── THE SHEET, AND THE CARD'S BOX ───────────────────────────────────────────────────────────────────────────────────────
const CAS = S.makeCascade(S.readSheet(HTML));
const LINE_H = { "preview-timeline": 20, "preview-controls": 32 };   // MEASURED in Chromium (J134's entry)
const pxv = (v) => parseFloat(v) || 0;
const declPx = (n, prop) => { const d = CAS.declared(n, prop); return d ? pxv(String(d.val).split(/\s+/)[0]) : 0; };
const rect = (left, top, w, h) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top });
const ZERO = rect(0, 0, 0, 0);

// ── THE WORLD ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// o.store: the saved prefs blob, carried across a reload ({ blob }). o.mainLevel: the main player's level. o.column: the
// column's box, or null. o.vw / o.vh: the window. o.noYT: no YouTube API (the open refuses).
function world(o) {
  o = Object.assign({ store: { blob: null }, mainLevel: 100, column: rect(8, 68.69, 344, 691.63), vw: 360, vh: 780 }, o || {});
  const doc = S.makeDocument();
  const docL = {}, winL = {};
  doc.addEventListener = (t, f) => { (docL[t] = docL[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { const l = docL[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  const has = (n, c) => !!(n && n.classList && n.classList.contains(c));
  function cardBox(card) {
    const frame = card.querySelector(".preview-frame");
    const fw = pxv(frame && frame.style.width), fh = pxv(frame && frame.style.height);
    const edge = declPx(card, "padding") + declPx(card, "border");
    let h = 2 * edge + fh;
    for (const c of card.children) for (const k in LINE_H) if (has(c, k)) h += declPx(c, "margin-top") + LINE_H[k];
    return { box: rect(pxv(card.style.left), pxv(card.style.top), fw + 2 * edge, h), edge, fw, fh };
  }
  function layout(n) {
    if (n === col) return o.column || ZERO;
    if (has(n, "preview-card")) return cardBox(n).box;
    const card = n.closest && n.closest(".preview-card");
    if (!card) return ZERO;
    const c = cardBox(card);
    if (has(n, "preview-frame")) return rect(c.box.left + c.edge, c.box.top + c.edge, c.fw, c.fh);
    if (has(n, "preview-bar")) return rect(c.box.left + c.edge + 42, c.box.top + c.edge + c.fh + 10, Math.max(0, c.fw - 84), 20);   // between two 34 px times, 8 px gaps
    return ZERO;
  }
  doc.createElement = (t) => { const n = S.mk(t, doc); n.getBoundingClientRect = () => layout(n); return n; };
  const col = doc.createElement("div");
  // FRAMES, TIMERS AND A CLOCK, all this guard's to run.
  const frames = new Map(), cancelled = [], intervals = new Map(), timeouts = [];
  let seq = 0;
  const clock = { now: 1.9e12 };
  class ClockDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } }
  // THE YOUTUBE DOUBLE: records every call; its time, length, volume and mute are this guard's to move.
  const players = [];
  class YTPlayer {
    constructor(id, opts) { this.id = id; this.opts = opts; this.calls = []; this.t = 0; this.d = 0; this.vol = 100; this.muted = false; this.destroyed = false; this.state = -1; players.push(this); }
    getPlayerState() { return this.state; }
    setVolume(v) { this.calls.push(["setVolume", v]); this.vol = v; } mute() { this.calls.push(["mute"]); this.muted = true; } unMute() { this.calls.push(["unMute"]); this.muted = false; }
    getVolume() { return this.vol; } isMuted() { return this.muted; } getCurrentTime() { return this.t; } getDuration() { return this.d; }
    seekTo(t, a) { this.calls.push(["seekTo", t, a]); } loadVideoById(x) { this.calls.push(["loadVideoById", x]); } playVideo() { this.calls.push(["playVideo"]); this.state = 1; }
    pauseVideo() { this.calls.push(["pauseVideo"]); this.state = 2; } destroy() { this.destroyed = true; this.calls.push(["destroy"]); } getVideoData() { return { title: "A song" }; }
  }
  const YT = o.noYT ? undefined : { Player: YTPlayer, PlayerState: { PLAYING: 1 } };
  // THE REAL PREFS, over the carried store.
  const Store = { prefs: { load: () => (o.store.blob ? JSON.parse(JSON.stringify(o.store.blob)) : null), save: (b) => { o.store.blob = JSON.parse(JSON.stringify(b)); } } };
  const { ChatPrefs } = loadInContext(["core/chatprefs.js"], { URL, Store, Logger: { warn() {}, info() {}, error() {}, debug() {} } });
  ChatPrefs.load();
  const volumeState = { level: o.mainLevel, muted: false };
  const win = { get innerWidth() { return o.vw; }, get innerHeight() { return o.vh; }, YT,
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); }, removeEventListener(t, f) { const l = winL[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } };
  const ctx = {
    document: doc, window: win, YT, ChatPrefs, volumeState, console, Math, JSON, Promise, Date: ClockDate,
    // The song module, real (J29): the plug hands YouTube's player YouTube's own id of the preview's key.
    Songs: loadInContext(["core/songs.js"], {}).Songs, Logger: { warn() {}, info() {}, error() {}, debug() {} },
    Player: { instance: () => null, isReady: () => false, _driveNowPlaying() {}, lastNp: () => null, _applyMetaToRows() {} },
    getComputedStyle: (n) => { const p = declPx(n, "padding") + "px", b = declPx(n, "border") + "px";
      return { paddingLeft: p, paddingRight: p, paddingTop: p, paddingBottom: p, borderLeftWidth: b, borderRightWidth: b, borderTopWidth: b, borderBottomWidth: b, getPropertyValue: () => "" }; },
    requestAnimationFrame: (fn) => { const id = ++seq; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { cancelled.push(id); frames.delete(id); },
    setInterval: (fn, ms) => { const id = ++seq; intervals.set(id, { fn, ms }); return id; }, clearInterval: (id) => { intervals.delete(id); },
    setTimeout: (fn, ms) => { const id = ++seq; timeouts.push({ id, fn, ms }); return id; }, clearTimeout: (id) => { const i = timeouts.findIndex((t) => t.id === id); if (i >= 0) timeouts.splice(i, 1); },
  };
  vm.createContext(ctx);
  vm.runInContext(PLUG, ctx);
  vm.runInContext(BASE + "\nconst H = { el, fmt, holdButton, RELOAD_TITLE: () => RELOAD_TITLE };\n" +
    "let _previewActive = false, _previewPlayer = null, _previewOverlay = null, _previewKeyHandler = null;\n" +
    "let _previewColumn = null, _previewResizeHandler = null;\nlet _pv = null;\n" + CONSTS + "\n" + J134 + "\n" + J135 + "\n" + OLD + "\n" + CORE +
    "\n;globalThis.__x = { open: _openPreview, close: _closePreview, pv: () => _pv, active: () => _previewActive };", ctx);
  const x = ctx.__x;
  const q = (sel) => doc.body.querySelector(sel);
  const w = {
    o, doc, docL, winL, players, ChatPrefs, volumeState, frames, cancelled, intervals, timeouts, clock, x,
    // A song is named by its KEY (J29); the preview's YouTube player is handed YouTube's id, "eeeeeeeeeee", through the plug.
    open(vid) { x.open(vid || "yt:eeeeeeeeeee", col); return w; },
    player: () => players[players.length - 1] || null,
    ready() { const p = w.player(); if (p && p.opts && p.opts.events && p.opts.events.onReady) p.opts.events.onReady({ target: p }); return w; },
    frame() { const fs2 = Array.from(frames.entries()); frames.clear(); for (const [, fn] of fs2) fn(clock.now); return w; },
    poll() { for (const [, t] of Array.from(intervals.entries())) t.fn(); return w; },
    runTimeouts() { const t = timeouts.splice(0); for (const k of t) k.fn(); return w; },
    resize() { (winL.resize || []).slice().forEach((f) => f()); return w; },
    q, card: () => q(".preview-card"), frameEl: () => q(".preview-frame"), bar: () => q(".preview-bar"), times: () => q(".pv-times"), play: () => q(".preview-controls .pv-play"),
    // CHANGED ON PURPOSE (`ddjp_680`, J135): the two times are one text, "0:42 / 3:15", beside the buttons; these read its halves.
    cur: () => ({ textContent: ((q(".pv-times") || {}).textContent || "").split(" / ")[0] }), dur: () => ({ textContent: ((q(".pv-times") || {}).textContent || "").split(" / ")[1] || "" }),
    knob: () => q(".preview-knob"), fill: () => q(".preview-fill"), shield: () => q(".preview-shield"),
    mute: () => q(".preview-controls .mute-btn"), vol: () => q(".preview-controls .volume-slider"), reload: () => q(".preview-controls .pv-reload"), block: () => q(".preview-controls .pv-block"),
    at(f) { const b = w.bar().getBoundingClientRect(); return b.left + b.width * f; },
    down(f) { const b = w.bar(); const e = { clientX: w.at(f), preventDefault() {} }; if (typeof b.onpointerdown === "function") b.onpointerdown(e); else b.dispatchEvent(Object.assign({ type: "pointerdown" }, e)); return w; },
    move(f) { (docL.pointermove || []).slice().forEach((h) => h({ clientX: w.at(f) })); return w; },
    up(f) { (docL.pointerup || []).slice().forEach((h) => h({ clientX: w.at(f) })); return w; },
    click(f) { return w.down(f).up(f); },
    calls: (name) => (w.player() ? w.player().calls.filter((c) => c[0] === name) : []),
    // THE ADMISSIBILITY GATE: a reading is admitted only of an open preview whose card, frame and lines are there and whose boxes
    // are numbers.
    measure() {
      const why = [];
      const card = w.card(), frame = w.frameEl();
      if (!x.active()) why.push("the preview is not open");
      if (!card || !frame) why.push("no card or no frame");
      const col0 = o.column, a = (col0 && col0.width > 40 && col0.height > 40) ? col0 : rect(0, 0, o.vw, o.vh);   // as the code chooses its area
      const c = card ? card.getBoundingClientRect() : ZERO, f = frame ? frame.getBoundingClientRect() : ZERO;
      if (![c.left, c.top, c.width, c.height, f.width, f.height].every((v) => typeof v === "number" && isFinite(v)) || !(f.width > 0)) why.push("a box is not a number");
      return { admitted: !why.length, why, c, f, a };
    },
  };
  return w;
}
const show = (r) => r && r.c ? { card: [r.c.left, r.c.top, r.c.width, r.c.height], frame: [r.f.width, r.f.height], area: [r.a.left, r.a.top, r.a.width, r.a.height], why: r.why } : r;
const names = (kids) => Array.from(kids || []).filter((k) => k.nodeType === 1).map((k) => k.className);

// ═══ PART Z — THE GATE, BOTH WAYS ══════════════════════════════════════════════════════════════════════════════════════
part("Z", () => {
  const w = world();
  ok(!w.measure().admitted, "Z: THE GATE REFUSES A PREVIEW THAT IS NOT OPEN", show(w.measure()));
  w.open();
  ok(w.measure().admitted, "Z: AND ADMITS THE SAME PREVIEW OPEN", show(w.measure()));
  const n = world({ noYT: true }); n.open();
  ok(!n.measure().admitted, "Z: and refuses one that could not open (no YouTube API yet)", show(n.measure()));
});

// ═══ PART A — two lines under the video, inside the card; the buttons as the main player draws them; no HD ════════════
part("A", () => {
  const w = world().open();
  ok(w.measure().admitted, "A PREMISE — the preview opened and was read");
  const card = w.card();
  // Each part by its first class.
  ok(JSON.stringify(names(card.children).map((c) => c.split(" ")[0])) === JSON.stringify(["preview-x", "preview-frame", "preview-timeline", "preview-controls"]),
    "A: UNDER THE VIDEO, INSIDE ITS CARD, TWO LINES — the timeline, then the buttons", names(card.children));
  const tl = w.q(".preview-timeline");
  // CHANGED ON PURPOSE (`ddjp_680`, J135; the sketch he approved): the times left the bar's ends for the buttons' line.
  ok(tl && JSON.stringify(names(tl.children)) === JSON.stringify(["preview-bar"]),
    "A: THE TIMELINE IS THE BAR ALONE, THE FULL WIDTH — no times at its ends (J135)", tl && names(tl.children));
  ok(w.bar() && w.bar().querySelector(".preview-track .preview-fill") && w.bar().querySelector(".preview-knob"), "A: the bar has its track, its fill and a knob");
  const ctl = w.q(".preview-controls"), kids = ctl ? Array.from(ctl.children) : [];
  const main = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
  const mainCls = (ref) => ((main.match(new RegExp("refs\\." + ref + " = el\\(\"[a-z]+\", \\{ class: \"([^\"]+)\"")) || [])[1]) || null;
  // CHANGED ON PURPOSE (`ddjp_680`, J135): ❚❚/▶ first, then 🔊, the slider, the two times together, ↻. The new play button
  // takes the buttons' own shape (`reset-btn`); the main player has no play button to copy. CHANGED ON PURPOSE AGAIN (`ddjp_702`, the
  // owner's: "the button to lock the mouse from the song can be removed we only neeed the fueature for teh player"): 🖱 is gone.
  const want = [["reset-btn", mainCls("resetBtn"), "❚❚"], ["mute-btn", mainCls("muteBtn"), "🔊"], ["volume-slider", mainCls("volumeSlider"), ""], null,
    ["reset-btn", mainCls("resetBtn"), "↻"]];
  ok(kids.length === 5 && want.every((x, i) => x === null || (x[1] === x[0] && kids[i] && x[0].split(" ").every((c) => kids[i].classList.contains(c)) && kids[i].textContent === x[2])) &&
     kids[0].classList.contains("pv-play") && kids[3] && kids[3].classList.contains("pv-times") && kids[3].tag === "span",
    "A: THE LINE UNDER THE BAR — ❚❚/▶, 🔊, the slider, the times together, ↻ — each button in the main player's own classes; no 🖱",
    { got: kids.map((k) => [k.className, k.textContent]), main: want.map((x) => x && x[1]) });
  ok(kids[2] && kids[2].getAttribute("type") === "range" && kids[2].getAttribute("min") === "0" && kids[2].getAttribute("max") === "100", "A: the slider is a 0–100 range, as the main player's");
  const sliderRule = (S.readSheet(HTML).filter((r) => r.sel === ".preview-controls .volume-slider")[0] || { decls: {} }).decls;
  const val = (k) => (sliderRule[k] || {}).val;
  ok(val("flex") === "0 1 100px" && val("width") === "100px" && val("min-width") === "0",
    "A: THE SLIDER AT THE MAIN PLAYER'S 100 PX, SHORTER ONLY AS THE LINE NEEDS — it stretched to fill the line (\"the vlume preview on slider is way to big\") (DECLARED)", { flex: val("flex"), width: val("width"), min: val("min-width") });
  const all = card.querySelectorAll("*");
  ok(!Array.from(all).some((n) => /\bhd\b/i.test(n.className) || /^\s*HD\s*$/.test(n.textContent || "")), "A: NO HD BUTTON (the owner: \"skip it\")");
  // CHANGED ON PURPOSE AGAIN (`ddjp_681`, J136, the owner's: "when i lunlock the mouse for preview, i cant change the quality as if
  // you specified things to not work, but when i move our timeline slider i still see the overlay so it looks like mitigations do
  // more hard then good.", then "1 yes"): it held "YouTube's own bar is off" (J135, "we dont need youtube's bar"), and before that
  // "YouTube's own bar stays" (J134). The mouse reaches YouTube's bar — quality, captions, fullscreen — always since `ddjp_702` (no
  // 🖱, no cover); the overlay YouTube shows while a jump loads is left as it is.
  ok(w.player() && w.player().opts.playerVars && w.player().opts.playerVars.controls === 1,
    "A: YOUTUBE'S OWN BAR IS BACK — the player is made with its controls, so its quality, captions and fullscreen can be reached (J136)", w.player() && w.player().opts.playerVars);
  // Since J29's step 2 the frame holds the preview's player box (`#preview-player`), and the service's player makes its own
  // element inside it — YouTube's `#yt-preview-player`, as before.
  const boxes = w.frameEl() ? Array.from(w.frameEl().children).filter((n) => n.nodeType === 1) : [];
  ok(boxes.length === 1 && boxes[0].id === "preview-player" &&
     Array.from(boxes[0].children).filter((n) => n.nodeType === 1).every((n) => n.id === "yt-preview-player") &&
     !w.shield() && !w.frameEl().contains(tl) && !w.frameEl().contains(ctl),
    "A: THE VIDEO'S FRAME HOLDS THE VIDEO ALONE — its player's box and what the service's player made in it, no cover over it (`ddjp_702`), and the two lines are outside it",
    boxes.map((b) => [b.id, Array.from(b.children).map((c) => c.id)]));
});

// ═══ PART B — the times, before and after YouTube gives the length; one loop, drawn only when something moved ══════════
part("B", () => {
  const w = world().open().ready();
  if (!ok(w.times() && w.bar(), "B PREMISE — the times and the bar are drawn")) return;
  w.frame();
  ok(w.cur().textContent === "0:00" && w.dur().textContent === "–:––", "B: BEFORE THE LENGTH — \"0:00\" and \"–:––\"", [w.cur().textContent, w.dur().textContent]);
  ok(!w.bar().classList.contains("pv-ready"), "B: and the bar is not ready (no pointer)");
  w.click(0.5);
  ok(w.calls("seekTo").length === 0 && !(w.docL.pointerup || []).length, "B: A CLICK ON THE BAR BEFORE THE LENGTH MOVES NOTHING — no seek, no drag begun", w.calls("seekTo"));
  w.player().d = 195; w.frame();
  ok(w.dur().textContent === "3:15" && w.bar().classList.contains("pv-ready"), "B: THE LENGTH ARRIVES — \"3:15\", and the bar is ready", w.dur().textContent);
  w.player().t = 42; w.frame();
  ok(w.cur().textContent === "0:42" && w.knob().style.left === "21.5%" && w.fill().style.width === "21.5%", "B: THE TIME PLAYED AND THE KNOB FOLLOW THE PLAYER — \"0:42\", 21.5% along",
    [w.cur().textContent, w.knob().style.left, w.fill().style.width]);
  ok(w.times().textContent === "0:42 / 3:15", "B: THE TWO TIMES TOGETHER, \"0:42 / 3:15\" (J135)", w.times().textContent);
  const node = w.times().firstChild, left = w.knob().style.left;
  w.player().t = 42.01; w.frame();
  ok(w.times().firstChild === node && w.knob().style.left === left, "B: A FRAME WITHIN THE SAME SECOND AND THE SAME PLACE WRITES NOTHING");
  ok(w.frames.size === 1, "B: ONE LOOP — each frame asks for exactly one more", w.frames.size);
});

// ═══ PART C — a click or a drag moves the video there; the drag is not fought ════════════════════════════════════════
part("C", () => {
  const w = world().open().ready();
  w.player().d = 195; w.player().t = 42; w.frame();
  if (!ok(w.bar() && w.bar().classList.contains("pv-ready"), "C PREMISE — the length is known and the bar is ready")) return;
  w.click(0.25);
  ok(JSON.stringify(w.calls("seekTo")) === JSON.stringify([["seekTo", 48.75, true]]), "C: A CLICK A QUARTER ALONG MOVES THE VIDEO A QUARTER IN — one seek, to 48.75 of 195 s", w.calls("seekTo"));
  w.frame();
  ok(w.knob().style.left === "25%" && w.cur().textContent === "0:48", "C: THE KNOB WAITS AT THE TARGET while the player still reports where it was", [w.knob().style.left, w.cur().textContent]);
  w.player().t = 48.9; w.frame();
  ok(w.knob().style.left === "25.1%", "C: and follows the player again once it gets there", w.knob().style.left);
  w.player().t = 42; w.click(0.25); w.clock.now += 2100; w.frame();
  ok(w.knob().style.left === "21.5%", "C: A SEEK THE PLAYER NEVER REACHES HOLDS THE KNOB 2 S AT MOST, then the player's time is shown", w.knob().style.left);
  const seeks = w.calls("seekTo").length;
  w.down(0.25); w.frame(); w.move(0.5); w.frame();
  ok(w.calls("seekTo").length === seeks, "C: DURING A DRAG NOTHING SEEKS", w.calls("seekTo").length - seeks);
  ok(w.knob().style.left === "50%" && w.cur().textContent === "1:37", "C: THE KNOB AND THE TIME FOLLOW THE POINTER, and the loop does not pull them back to the player's 0:42", [w.knob().style.left, w.cur().textContent]);
  w.move(0.75); w.frame(); w.up(0.75);
  ok(JSON.stringify(w.calls("seekTo").slice(seeks)) === JSON.stringify([["seekTo", 146.25, true]]), "C: RELEASED, THE VIDEO MOVES THERE — one seek", w.calls("seekTo").slice(seeks));
  ok(!(w.docL.pointermove || []).length && !(w.docL.pointerup || []).length, "C: and the drag's listeners are gone");
  // CHANGED ON PURPOSE (`ddjp_702`): 🖱 and its cover are gone, so the rows that put the cover up and seeked under it went with them.
});

// ═══ PART D — the buttons act on the preview's player and are remembered apart from the main player's ════════════════
const carried = { blob: null };
part("D", () => {
  const w = world({ store: carried }).open().ready();
  const p = w.player();
  if (!ok(w.mute() && w.vol() && w.reload() && !w.block(), "D PREMISE — the three buttons are drawn, and no 🖱 (`ddjp_702`)")) return;
  w.mute().click();
  ok(p.muted === true && w.mute().textContent === "🔇" && w.ChatPrefs.previewMuted() === true, "D: 🔊 MUTES THE PREVIEW and is remembered", { muted: p.muted, text: w.mute().textContent });
  ok(w.ChatPrefs.playerMuted() === false && w.volumeState.muted === false, "D: the main player's mute is untouched");
  w.vol().value = "30"; w.vol().oninput();
  ok(p.vol === 30 && p.muted === false && w.ChatPrefs.previewVolume() === 30 && w.vol().value === "30", "D: THE SLIDER SETS THE PREVIEW'S VOLUME (moving it unmutes, as the main player's does) and is remembered", { vol: p.vol, muted: p.muted, saved: w.ChatPrefs.previewVolume() });
  ok(w.ChatPrefs.playerVolume() === 100 && w.volumeState.level === 100, "D: the main player's volume is untouched", w.ChatPrefs.playerVolume());
  p.vol = 55; w.poll();
  ok(w.vol().value === "55" && w.ChatPrefs.previewVolume() === 55, "D: A CHANGE MADE INSIDE YOUTUBE'S FRAME IS ADOPTED AND REMEMBERED, as the main player's is", { slider: w.vol().value, saved: w.ChatPrefs.previewVolume() });
  // ADDED AT J29 (step 1): the preview's player is CONSTRUCTED with YouTube's own id too, never the song's key.
  ok(p.opts && p.opts.videoId === "eeeeeeeeeee", "D: THE PREVIEW'S PLAYER IS BUILT WITH YOUTUBE'S OWN ID, never the room's `yt:` key", p.opts && p.opts.videoId);
  p.t = 77; w.reload().click();
  ok(JSON.stringify(w.calls("loadVideoById")) === JSON.stringify([["loadVideoById", { videoId: "eeeeeeeeeee", startSeconds: 77 }]]), "D: ↻ RELOADS THE SONG FROM WHERE IT WAS", w.calls("loadVideoById"));
  const sets = w.calls("setVolume").length; w.runTimeouts();
  ok(w.calls("setVolume").length === sets + 1 && p.vol === 55, "D: and puts the preview's volume back on it after the load", w.calls("setVolume").slice(sets));
  // CHANGED ON PURPOSE (`ddjp_702`): 🖱's rows (lit at open, pressed off, remembered) went with it.
  w.mute().click();   // leave it muted, at 55, for the reload below
  ok(w.ChatPrefs.previewMuted() === true, "D PREMISE — left muted at 55 for the reload");
});

// ═══ PART E — through a reload, and before anything is saved ══════════════════════════════════════════════════════════
part("E", () => {
  const r = world({ store: carried, mainLevel: 100 }).open().ready();
  const p = r.player();
  if (!ok(carried.blob && r.vol() && r.mute(), "E PREMISE — something was saved above, and the reopened preview has its buttons")) return;
  ok(p && p.vol === 55 && p.muted === true, "E: THROUGH A RELOAD THE PREVIEW KEEPS ITS VOLUME AND MUTE — 55, muted, though the main player is at 100", p && { vol: p.vol, muted: p.muted });
  ok(r.vol().value === "55" && r.mute().textContent === "🔇", "E: and its slider and 🔊 say so", [r.vol().value, r.mute().textContent]);
  ok(r.ChatPrefs.playerVolume() === 100 && r.ChatPrefs.playerMuted() === false, "E: the main player's remembered sound is its own — still full and unmuted");
  // CHANGED ON PURPOSE (`ddjp_680`, J135, the owner's: "by default the locking the mouse out of the song should be on for
  // preview"; "defaut colume should be half"): before anything is saved it opened at the main player's level, the block off. (The
  // block's half went at `ddjp_702`.)
  const f = world().open().ready();
  ok(JSON.stringify(f.player().calls.filter((c) => c[0] === "setVolume" || c[0] === "mute" || c[0] === "unMute")) === JSON.stringify([["setVolume", 50], ["unMute"]]) &&
    f.vol().value === "50",
    "E: BEFORE ANYTHING IS SAVED — at HALF volume, unmuted (J135)", f.player().calls);
  const m = world({ mainLevel: 40 }).open().ready();
  ok(m.player().vol === 50 && m.vol().value === "50", "E: whatever the main player is at (40) — the preview's default is its own half now", m.player().vol);
  const s679 = world({ store: { blob: { previewVolume: null, previewMuted: false, previewBlocked: false, playerVolume: 100, playerMuted: false } } }).open().ready();
  ok(s679.player().vol === 50 && s679.player().muted === false,
    "E: A DEVICE THAT RAN 679 AND NEVER TOUCHED THE PREVIEW GETS THE SAME (J135)", { vol: s679.player().vol });
  const z = world({ mainLevel: 0 }).open().ready();
  ok(z.player().vol === 50, "E: and at half when the main player is at 0 (it was full)", z.player().vol);
});

// ═══ PART F — the controls belong to one open ═════════════════════════════════════════════════════════════════════════
part("F", () => {
  const w = world().open().ready();
  const p1 = w.player(); p1.d = 195; w.frame();
  const old = { mute: w.mute(), reload: w.reload(), pv: w.x.pv() };
  if (!ok(old.pv && w.bar() && w.frames.size === 1 && w.intervals.size === 1, "F PREMISE — open: its controls, one loop queued and one poll", { frames: w.frames.size, polls: w.intervals.size })) return;
  w.down(0.3);
  if (!ok((w.docL.pointerup || []).length === 1, "F PREMISE — a drag in progress")) return;
  w.x.close();
  ok(p1.destroyed && w.frames.size === 0 && w.intervals.size === 0, "F: CLOSED — the player gone, its loop and its poll stopped", { frames: w.frames.size, polls: w.intervals.size });
  ok(!(w.docL.pointermove || []).length && !(w.docL.pointerup || []).length, "F: and a drag left in progress is dropped, its listeners gone");
  const n1 = p1.calls.length;
  if (old.pv && old.pv.onUp) { old.pv.drag = true; old.pv.onUp({ clientX: 100 }); }
  old.reload.click();
  ok(p1.calls.length === n1, "F: NOTHING OF A CLOSED PREVIEW REACHES ITS PLAYER — a stale release seeks nothing, a stale ↻ loads nothing", p1.calls.slice(n1));
  w.open().ready();
  const p2 = w.player();
  ok(p2 !== p1 && w.mute() !== old.mute && w.x.pv() !== old.pv, "F: REOPENED, IT GETS NEW CONTROLS for its new player");
  const n2 = p2.calls.length;
  old.mute.click();
  ok(p2.calls.length === n2 && p2.muted === false, "F: and the old card's 🔊 does nothing to the new player", p2.calls.slice(n2));
  ok(w.frames.size === 1 && w.intervals.size === 1, "F: one loop and one poll again, not two", { frames: w.frames.size, polls: w.intervals.size });
});

// ═══ PART G — the card counts both lines: the largest video that fits with them, then the card centred ════════════════
part("G", () => {
  const check = (label, o, expect) => {
    const w = world(o).open();
    const r = w.measure();
    ok(r.admitted, "G PREMISE — " + label + ": the preview opened and was read", show(r));
    const lines = ["preview-timeline", "preview-controls"].every((k) => Array.from(w.card().children).some((c) => c.classList.contains(k)));
    ok(lines && near(r.c.height, r.f.height + 96), "G: " + label + " — THE CARD'S HEIGHT INCLUDES BOTH LINES (the video, 12 px padding and 1 px border each side, 10 + 20 and 8 + 32 for the lines)", show(r));
    ok(near(r.f.width * 9 / 16, r.f.height), "G: " + label + " — the video is 16:9", show(r));
    ok(r.c.left >= r.a.left + 14 - 1 && r.c.right <= r.a.left + r.a.width - 14 + 1 && r.c.top >= r.a.top + 14 - 1 && r.c.bottom <= r.a.top + r.a.height - 14 + 1,
      "G: " + label + " — THE WHOLE CARD FITS THE COLUMN, 14 px inside it", show(r));
    ok(near(r.c.left + r.c.width / 2, r.a.left + r.a.width / 2) && near(r.c.top + r.c.height / 2, r.a.top + r.a.height / 2), "G: " + label + " — AND IS CENTRED IN IT, lines and all", show(r));
    ok(expect(r), "G: " + label + " — THE LARGEST VIDEO THAT FITS", show(r));
    return w;
  };
  // Width-limited, as Chromium measured them: the phone at 360 (frame 290 × 163) and the wide layout at 1400 (370 × 208).
  const ph = check("phone at 360 px", {}, (r) => near(r.f.width, 290) && near(r.f.height, 163));
  ok(ph.card().getBoundingClientRect().right <= 360, "G: NOTHING SCROLLS SIDEWAYS AT 360 PX — the card ends inside the window", ph.card().getBoundingClientRect().right);
  // THE CARD IS AS WIDE AS ITS VIDEO (J135): left to size itself it took its widest line's natural width, the buttons' line wider
  // than a phone's video — so the lines are never wider than the video (MEASURED in Chromium: at 360 the slider gives way, 61 px).
  ok(ph.card().style.width === (pxv(ph.frameEl().style.width) + 26) + "px", "G: THE CARD IS SET TO ITS VIDEO'S WIDTH PLUS ITS PADDING AND BORDER, so no line is wider than the video (J135)",
    { card: ph.card().style.width, frame: ph.frameEl().style.width });
  check("wide at 1400 px", { column: rect(12, 115, 424.13, 719), vw: 1400, vh: 900 }, (r) => near(r.f.width, 370) && near(r.f.height, 208));
  // Height-limited: a short column. The video is as tall as the column less the margins and the card's 96 px.
  const sc = check("a short column", { column: rect(0, 0, 400, 260), vw: 400, vh: 260 }, (r) => near(r.f.height, 260 - 28 - 96));
  ok(sc.card().style.width === (pxv(sc.frameEl().style.width) + 26) + "px" && pxv(sc.frameEl().style.width) < 400 - 28 - 26,
    "G: AND WHERE THE HEIGHT DECIDES (a short column), THE CARD IS STILL ITS NARROWER VIDEO'S WIDTH (J135)", { card: sc.card().style.width, frame: sc.frameEl().style.width });
  // No column to float over: the window.
  check("no column (the window)", { column: rect(0, 0, 0, 0), vw: 390, vh: 780 }, (r) => near(r.f.width, 390 - 28 - 26));
  // Placed again when the window changes.
  const w = world().open();
  w.o.column = rect(8, 68.69, 374, 691.63); w.resize();
  const r = w.measure();
  ok(r.admitted && near(r.f.width, 320) && near(r.c.left + r.c.width / 2, 8 + 374 / 2), "G: RESIZED, THE CARD IS SIZED AND CENTRED AGAIN (390 px: 320 × 180)", show(r));
});

// ═══ PART P — play/pause, following the player's own state (J135; "we dont have a play pause button") ══════════════════════
part("P", () => {
  const w = world().open();   // YouTube not ready yet
  if (!ok(w.play(), "P PREMISE — the play/pause button is drawn, first on the line")) return;
  ok(w.play().textContent === "❚❚" && w.play().disabled === true,
    "P: WHILE YOUTUBE IS LOADING — ❚❚, GREYED: the preview starts by itself, and there is nothing to pause yet", { text: w.play().textContent, disabled: w.play().disabled });
  w.ready(); w.frame();
  const p = w.player();
  ok(p.state === 1 && w.play().textContent === "❚❚" && w.play().disabled === false, "P: PLAYING — ❚❚, and it can be pressed", { state: p.state, text: w.play().textContent });
  w.play().click(); w.frame();
  ok(p.calls[p.calls.length - 1][0] === "pauseVideo" && w.play().textContent === "▶", "P: PRESSED, THE PREVIEW PAUSES — and shows ▶", p.calls.slice(-1));
  w.play().click(); w.frame();
  ok(p.calls[p.calls.length - 1][0] === "playVideo" && w.play().textContent === "❚❚", "P: PRESSED AGAIN, IT PLAYS — ❚❚", p.calls.slice(-1));
  p.state = 3; w.frame();
  ok(w.play().textContent === "❚❚", "P: buffering (after a seek, say) counts as playing — ❚❚");
  p.state = 2; w.frame();
  ok(w.play().textContent === "▶", "P: IT FOLLOWS THE PLAYER'S OWN STATE — paused some other way, ▶ (read each frame)");
  for (const st of [5, -1]) { p.state = st; w.frame(); ok(w.play().textContent === "▶", "P: cued or not started (" + st + "): ▶"); }
  p.state = 0; w.frame();
  ok(w.play().textContent === "▶" && /from the start/.test(w.play().getAttribute("title") || ""), "P: ENDED — ▶, \"Play again from the start\"", w.play().getAttribute("title"));
  const n = p.calls.length; w.play().click();
  ok(JSON.stringify(p.calls.slice(n)) === JSON.stringify([["seekTo", 0, true], ["playVideo"]]), "P: ▶ AT THE END PLAYS FROM THE START", p.calls.slice(n));
  ok(!JSON.stringify(w.o.store.blob || {}).match(/play/i), "P: NOT REMEMBERED — nothing of it is in what this device saves", Object.keys(w.o.store.blob || {}));
  const old = w.play(); w.x.close();
  const m = p.calls.length; old.disabled = false; old.click();
  ok(p.calls.length === m, "P: a closed preview's button reaches nothing", p.calls.slice(m));
});

// ═══ PART X — a drag the browser cancels (J135; fixed from 679) ═══════════════════════════════════════════════════════════
// A pointer the browser takes back (a touch taken for a scroll, say) sends `pointercancel` and no `pointerup`. At 679 the drag
// stayed on, the timeline froze, and the next tap anywhere moved the song (one on the slider's left end seeked to 3.4 s,
// MEASURED in Chromium). It ends with no seek now, its listeners gone, and the timeline runs again.
part("X", () => {
  const w = world().open().ready();
  w.player().d = 195; w.player().t = 42; w.frame();
  if (!ok(w.bar() && w.bar().classList.contains("pv-ready") && w.times(), "X PREMISE — the length is known, the bar is ready and the times are drawn")) return;
  w.down(0.3); w.move(0.6); w.frame();
  if (!ok((w.docL.pointerup || []).length === 1 && w.knob().style.left === "60%", "X PREMISE — a drag in progress, the knob with the pointer", w.knob().style.left)) return;
  (w.docL.pointercancel || []).slice().forEach((h) => h({ type: "pointercancel" }));
  ok(w.calls("seekTo").length === 0, "X: A DRAG THE BROWSER CANCELS ENDS WITH NO SEEK", w.calls("seekTo"));
  ok(!(w.docL.pointermove || []).length && !(w.docL.pointerup || []).length && !(w.docL.pointercancel || []).length, "X: and its listeners are gone",
    { move: (w.docL.pointermove || []).length, up: (w.docL.pointerup || []).length, cancel: (w.docL.pointercancel || []).length });
  w.player().t = 100; w.frame();
  ok(w.times().textContent === "1:40 / 3:15" && w.knob().style.left === "51.3%", "X: AND THE TIMELINE RUNS AGAIN — the player's own time and place", [w.times().textContent, w.knob().style.left]);
  (w.docL.pointerup || []).slice().forEach((h) => h({ clientX: w.at(0.02) }));   // the next tap, elsewhere on the page
  ok(w.calls("seekTo").length === 0, "X: AND THE NEXT TAP ANYWHERE MOVES NOTHING", w.calls("seekTo"));
  w.down(0.5); w.up(0.5);
  ok(JSON.stringify(w.calls("seekTo")) === JSON.stringify([["seekTo", 97.5, true]]), "X CONTROL — a drag after it works as before: one seek, where it was let go", w.calls("seekTo"));
});

// ═══ PART O — a click outside the card closes it; nothing else (`ddjp_702`, JOB 8) ═══════════════════════════════════════
// The owner's: "and we dont need to lock the user in, if the user clicks outside the preview player frame we can close the video".
// The double's events: a press is told to the backdrop with its target (as it bubbles there in a browser); a click is the double's own,
// which bubbles from its target unless stopped. A drag of the timeline released outside the card ends, in a browser, as a click whose
// target is the press's and the release's common ancestor — the backdrop — so it is told the same way here.
part("O", () => {
  const w = world().open().ready();
  const overlay = w.q(".preview-overlay");
  if (!ok(!!overlay && w.x.active(), "O PREMISE — the preview is open, its backdrop over the page")) return;
  const press = (target) => overlay.dispatchEvent({ type: "pointerdown", target });
  let behind = 0;
  w.doc.body.addEventListener("click", () => { behind++; });
  // A click inside the card: nothing.
  press(w.card()); w.card().click();
  ok(w.x.active(), "O: A CLICK INSIDE THE CARD KEEPS IT OPEN", w.x.active());
  // A drag of the timeline released outside the card: nothing.
  w.down(0.5); press(w.bar()); w.up(0.5); overlay.click();
  ok(w.x.active(), "O: A DRAG OF THE TIMELINE RELEASED OUTSIDE THE CARD DOES NOT CLOSE IT — the press began inside", w.x.active());
  // A click outside: closed, and it reaches nothing behind. A browser fixes an event's path when it is dispatched, so a backdrop
  // taken away mid-click would still pass it on to what is under it unless it is STOPPED there; the double's click stops at a node
  // that was taken away, so the click is told here as a browser would deliver it, and what the backdrop did with it is read.
  const b0 = behind;
  press(overlay);
  const ev = { type: "click", target: overlay, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  overlay.dispatchEvent(ev);
  ok(!w.x.active() && !w.q(".preview-overlay"), "O: A CLICK OUTSIDE THE CARD CLOSES IT — the backdrop gone", { active: w.x.active() });
  ok(ev.stopped && ev.prevented && behind === b0, "O: AND THAT CLICK DOES NOTHING ELSE — stopped at the backdrop, its default prevented, reaching nothing behind",
    { stopped: ev.stopped, prevented: ev.prevented, behind: behind - b0 });
  // ✕ and Esc still close it.
  w.open().ready();
  const x = w.q(".preview-x"); if (x) x.click();
  ok(!w.x.active(), "O: ✕ STILL CLOSES IT", w.x.active());
  w.open().ready();
  (w.docL.keydown || []).slice().forEach((h) => h({ key: "Escape" }));
  ok(!w.x.active(), "O: Esc STILL CLOSES IT", w.x.active());
  // No 🖱 and no cover in the preview; the main player keeps its 🖱.
  w.open().ready();
  ok(!w.block() && !w.shield() && !w.q(".pv-blocked"), "O: THE PREVIEW HAS NO 🖱 AND NO COVER", { block: !!w.block(), cover: !!w.shield() });
  ok(!/\bpreview-shield\b|\bpv-blocked\b|\bpv-block\b/.test(HTML), "O: and the sheet has no rule for either");
  const shellSrc = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
  ok(/refs\.coverBlockBtn = el\("button", \{ class: "reset-btn np-tool", text: "\\uD83D\\uDDB1" \}\)/.test(shellSrc), "O: THE MAIN PLAYER KEEPS ITS 🖱 (TEXTUAL)");
  w.x.close();
});

// ═══ PART M — the main player remembers its volume and mute ═══════════════════════════════════════════════════════════
// The REAL `buildMainDom` (the screen world) seeds the main slider and 🔊 from the REAL ChatPrefs, and saves through
// `Player.rememberVolumeState` when either is used; a "reload" is a new world on the same saved blob.
function mainWorld(store) {
  const Store = { prefs: { load: () => (store.blob ? JSON.parse(JSON.stringify(store.blob)) : null), save: (b) => { store.blob = JSON.parse(JSON.stringify(b)); } } };
  const { ChatPrefs } = loadInContext(["core/chatprefs.js"], { URL, Store, Logger: { warn() {}, info() {}, error() {}, debug() {} } });
  ChatPrefs.load();
  const NOW = 1.9e12;
  const features = {
    Room: { rankLadder: () => [], getMyId: () => "@me:hs", getRoster: () => [], recentEvents: () => ({ rows: [], truncated: false, refused: 0 }), FEED_KINDS: {}, scanDDJPRooms: () => [], historyAudit() {} },
    Queue: { getNowPlaying: () => null, getRotation: () => [], lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000, recentHistory: () => [], historyReach: () => ({ entries: 0, complete: true }), getState: () => ({ counts: {} }) },
    UserQueue: { items: () => [], count: () => 0, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
    Actions: { describe: () => ({ enabled: false, reason: "Not permitted" }), perform: () => Promise.resolve({ ok: true }) },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, closeDM() {}, dmAnswering: () => false },
    Playlists: { list: () => [], create: () => Promise.resolve({ ok: true }), get: (id) => Promise.resolve({ id, name: "Mine", tracks: [] }) },
    RoomUpgrade: { isRunning: () => false, status: () => null },
    ServerClock: { serverNow: () => NOW },
    Metadata: { get: () => null, cached: () => null },
  };
  const w = S.world({ features, globals: { ChatPrefs } });
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  return { w, ChatPrefs, slider: w.refs.volumeSlider, mute: w.refs.muteBtn };
}
part("M", () => {
  const store = { blob: null };
  const a = mainWorld(store);
  if (!ok(a.slider && a.mute, "M PREMISE — the main player's slider and 🔊 are built")) return;
  if (!ok(typeof a.ChatPrefs.playerVolume === "function" && typeof a.ChatPrefs.playerMuted === "function", "M PREMISE — ChatPrefs keeps the main player's sound (its reader and setter, by name)")) return;
  ok(a.slider.value === "100" && a.mute.textContent === "🔊", "M: BEFORE ANYTHING IS SAVED THE MAIN PLAYER IS FULL AND UNMUTED, as before", [a.slider.value, a.mute.textContent]);
  a.slider.value = "40"; a.slider.oninput();
  ok(a.ChatPrefs.playerVolume() === 40 && a.ChatPrefs.playerMuted() === false, "M: ITS SLIDER IS SAVED AS IT IS MOVED", [a.ChatPrefs.playerVolume(), a.ChatPrefs.playerMuted()]);
  a.mute.click();
  ok(a.ChatPrefs.playerVolume() === 40 && a.ChatPrefs.playerMuted() === true, "M: AND ITS 🔊 AS IT IS PRESSED", [a.ChatPrefs.playerVolume(), a.ChatPrefs.playerMuted()]);
  ok(a.ChatPrefs.previewVolume() === null && a.ChatPrefs.previewMuted() === false, "M: and the preview's remembered sound is not touched by them");
  const b = mainWorld(store);
  ok(b.slider.value === "40" && b.mute.textContent === "🔇", "M: THROUGH A RELOAD THE MAIN PLAYER KEEPS ITS VOLUME AND MUTE — the slider at 40, 🔇", [b.slider.value, b.mute.textContent]);
  // A change made inside YouTube's frame: the REAL `_pollPlayerVolume` adopts it (through the REAL `_adoptVolume`) and the REAL
  // `rememberVolumeState` saves it. What the app last gave the player is the box's record since `ddjp_714`: seeded here as the
  // room's `applyVolumeState` gives it (a volume, then unmuted) — the double's own reading is left as each case sets it.
  const poll = grab("ui/player.js", "_pollPlayerVolume", true), remember = grab("ui/player.js", "rememberVolumeState", true);
  const adopt = grab("ui/player.js", "_adoptVolume", true);
  if (poll && remember && adopt) {
    const yt = { vol: 40, muted: false, getVolume() { return this.vol; }, isMuted() { return this.muted; }, setVolume() {}, mute() {}, unMute() {} };
    const acted = grab("ui/player.js", "_personHasActed", true);   // J135
    const polled = (nav) => {
      // the room's box player through the plug, over the YouTube double (J29, step 2)
      const player = require("./_player-world.js").boxPlayer(yt).bp;
      const ctx = { player, volumeState: { level: 40, muted: false }, ChatPrefs: b.ChatPrefs, Math, navigator: nav,
        seed(n) { this.volumeState.level = n; player.setVolume(n); player.unmute(); } };
      ctx.seed(40);
      vm.createContext(ctx);
      vm.runInContext("function _syncVolumeUI() {}\n" + remember + "\n" + acted + "\n" + adopt + "\n" + poll + "\n;globalThis.__p = _pollPlayerVolume;", ctx);
      return ctx;
    };
    const c1 = polled({ userActivation: { hasBeenActive: true } });
    yt.vol = 65; c1.__p();
    ok(b.ChatPrefs.playerVolume() === 65 && b.ChatPrefs.playerMuted() === false, "M: A CHANGE MADE INSIDE YOUTUBE'S FRAME IS ADOPTED AND REMEMBERED — a person has used the page", [b.ChatPrefs.playerVolume(), b.ChatPrefs.playerMuted()]);
    // THE BROWSER'S SILENCE IS NOT THE PERSON'S MUTE (J135): a reload where nothing is touched can start the player silent; the poll
    // shows it (🔇 is the truth) and never saves it, so the next reload still starts at 🔊.
    yt.vol = 65; yt.muted = true;
    const c2 = polled({ userActivation: { hasBeenActive: false } });
    c2.seed(65); c2.__p();
    ok(c2.volumeState.muted === true && b.ChatPrefs.playerMuted() === false, "M: A SILENCE THE BROWSER STARTED, ON A PAGE NOBODY HAS TOUCHED, IS SHOWN AND NEVER SAVED AS THE PERSON'S MUTE (J135)",
      { shown: c2.volumeState.muted, saved: b.ChatPrefs.playerMuted() });
    const c3 = polled(undefined);
    c3.seed(65); c3.__p();
    ok(b.ChatPrefs.playerMuted() === false, "M: and with no activation to read (an older browser), nothing adopted is saved", b.ChatPrefs.playerMuted());
    yt.muted = false;
  }
});

if (failed) { console.log("[preview-controls] " + failed + " failure(s) of " + asserts); process.exit(1); }
console.log("[preview-controls] PASS — the song preview's own controls, and the main player's remembered sound (" + asserts + " assertions; J134, J135, J136). " +
  "SECOND ROUND (J135): the bar alone on the top line; ❚❚/▶ (greyed while YouTube loads, then the player's own state; at the end from " +
  "the start; not remembered), 🔊, the slider at 100 px, the times together, ↻ (🖱 and its cover gone since `ddjp_702`); YouTube's own bar back since J136, always reached; half volume before " +
  "anything is chosen, on a device that ran 679 too; a cancelled drag seeks nothing and the timeline runs again; the card as wide " +
  "as its video; a silence the browser started is never saved as the person's mute. AND (J134): " +
  "the real preview, under its video, inside its card: the times \"0:00 / –:––\" until YouTube gives the length, then the time played " +
  "and the length; the buttons in the main player's own classes; no HD. " +
  "A click a quarter along seeks a quarter in, the knob waiting at the target (2 s at most); a drag seeks once, on release, and the loop does " +
  "not pull the knob back. The buttons act on the " +
  "preview's player alone and are remembered apart from the main player's (a change inside YouTube's frame too), through a reload. Closing stops the loop, the poll and a drag, and a reopen gets " +
  "new controls. A click outside the card closes it and reaches nothing behind; a click inside, or a drag of the timeline released " +
  "outside, does not; ✕ and Esc still do (`ddjp_702`). The card counts both lines: the largest 16:9 video that fits with them, the card centred and 14 px inside the column, at 360 " +
  "and 1400 px, in a short column, over the window, and again on resize. The main player's volume and mute are saved as they are used and " +
  "survive a reload. THIS GUARD CANNOT SEE A REAL LAYOUT OR A REAL YOUTUBE PLAYER — Chromium measured them");
process.exit(0);
