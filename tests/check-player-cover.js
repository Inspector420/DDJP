// tests/check-player-cover.js
// SUBJECT: ui/player.js, ui/roster.js, ui/shell.js, core/chatprefs.js, index.html
// WALL: the player's view controls (owner rulings, ddjp_450 — main/04-features.md §The player's
// view controls). ONE cover over the player — the click-shield that already existed — with three
// reasons, strongest first: nothing playing (its screen with words — see-through and darker since `ddjp_678`, PART G), the
// video HIDDEN (the same screen,
// saying so, while the sound plays on), YouTube's overlay BLOCKED (transparent: the video is seen and
// the mouse cannot reach it). Two toggles on the Now-playing line drive it, remembered per device.
// And the controls row never makes the page scroll sideways: the slider shrinks, the Leave label
// shortens, and only as a last resort does the volume group drop to a second line.
// And (`ddjp_678`, the owner's: "also the nothing playing or video hidden or bot hidden playback window in hte player should be
// transparant as well but darker then the surrounding frame") PART G: the cover with words is see-through — the chat box's
// darkness over a frame with no black of its own — and, because what it covers would show through it, the video under it is
// not drawn: the frame's `cover-words`, set where `_renderCover` draws the cover, takes the iframe to opacity 0 (never
// display:none, never moved, resized or rebuilt). The blocked-overlay cover stays transparent with the video seen.
//
// Driven, not read: the REAL cover functions are extracted from ui/player.js and run over a shield
// double; the REAL `ChatPrefs` holds the toggles; the REAL `_fitJoinLabel` is run against a row whose
// width is computed from what is in it. Doubles only for the DOM.
//
// THIS GUARD CANNOT TELL YOU THE PLAYER LOOKS RIGHT, THAT THE MOUSE REALLY NEVER REACHES THE IFRAME,
// OR THAT A REAL PHONE'S ROW FITS. Those are a browser's, and a person's at a screen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");

let asserts = 0;
function fail(msg, got) {
  console.log("[player-cover] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const grab = (rel, name) => { const x = P.extractNamed(rel, name); ok(x.ok, "APPLIED — `" + name + "` is extractable from " + rel, x.stage); return x.source; };

// ── The real preferences, over an in-memory store ─────────────────────────────────────────────
let _saved = null;
const Store = { prefs: { load: () => _saved, save: (o) => { _saved = JSON.parse(JSON.stringify(o)); } } };
const Logger = { warn() {}, info() {}, error() {}, debug() {} };
function prefs() {
  const { ChatPrefs } = loadInContext(["core/chatprefs.js"], { URL, Store, Logger });
  ChatPrefs.load();
  return ChatPrefs;
}

// ── A DOM just rich enough: classes as a set, style, attributes, children ────────────────────
function node(tag) {
  const cls = new Set();
  return { tag, style: {}, attrs: {}, children: [], text: "",
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { const v = (on === undefined) ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    get className() { return [...cls].join(" "); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; } };
}
const el = (tag, a) => { const n = node(tag); if (a && a.class) for (const c of a.class.split(/\s+/)) n.classList.add(c); if (a && a.text) n.text = a.text; return n; };

// The cover's functions, the REAL ones, in one context with a shield and the two toggles.
const PLAYER = "ui/player.js";
const SONGS = loadInContext(["core/songs.js"], {}).Songs;   // the real song module (J29, step 1)
const coverSrc = ["_coverFor", "_prefOn", "_renderCoverToggles", "_renderCover", "_showPlayerShield",
                  "togglePlayerHidden", "toggleOverlayBlocked", "applyCover"].map((n) => grab(PLAYER, n)).join("\n");
const labelDecl = (code(PLAYER).match(/const COVER_HIDDEN_LABEL = [^\n]+;/) || [""])[0];
ok(labelDecl, "APPLIED — the hidden-video label is declared once in ui/player.js");
function cover(CP) {
  // CHANGED ON PURPOSE (`ddjp_678`, PART G): the frame is in the world too, holding the player (since J29's step 2 the box
  // #player, in which the plug makes the service's player) and the cover, as ui/shell.js builds it.
  const refs = { playerShield: node("div"), coverBlockBtn: node("button"), coverHideBtn: node("button"), playerFrame: node("div"), player: node("div") };
  refs.playerFrame.appendChild(refs.player); refs.playerFrame.appendChild(refs.playerShield);
  const ctx = { refs, ChatPrefs: CP, H: { el, clear: (n) => { n.children = []; } }, console };
  vm.createContext(ctx);
  vm.runInContext("let _idleLabel = null;\n" + labelDecl + "\n" + coverSrc +
    "\n;globalThis.__c = { _coverFor, _showPlayerShield, togglePlayerHidden, toggleOverlayBlocked, applyCover };", ctx);
  const sh = refs.playerShield;
  return Object.assign(ctx.__c, { refs,
    state: () => ({ shown: sh.style.display === "block", dark: sh.classList.contains("waiting"),
                    note: sh.children.map((c) => c.text).join("") }) });
}

// ═══ PART A — the decision, at explicit values: three reasons, strongest first ═══════════════════
{
  _saved = null;
  const c = cover(prefs());
  const D = c._coverFor;
  const r = (idle, hid, blk) => JSON.stringify(D(idle, hid, blk));
  for (const hid of [false, true]) for (const blk of [false, true]) {
    ok(r("Nothing playing", hid, blk) === JSON.stringify({ show: true, label: "Nothing playing" }),
      "A: NOTHING PLAYING WINS — its own dark screen, whatever the toggles (hidden=" + hid + ", blocked=" + blk + ")", r("Nothing playing", hid, blk));
  }
  const hidden = D(null, true, false);
  ok(hidden.show === true && hidden.label === "Player hidden",
    "A: HIDDEN, while a song plays — a dark screen that says just \"Player hidden\" (the owner's ruling at ddjp_619: " +
    "the \"— the sound keeps playing\" tail went; \"player\", not \"video\", since `ddjp_707`)", hidden);
  const hint = (code(PLAYER).match(/"Hide the player: the sound keeps playing"/) || [])[0];
  ok(!!hint, "A: and the 👁 button's hint is unchanged — it still says the sound keeps playing");
  ok(JSON.stringify(D(null, true, true)) === JSON.stringify(hidden), "A: hidden beats blocked — you see nothing, not a transparent cover", D(null, true, true));
  ok(JSON.stringify(D(null, false, true)) === JSON.stringify({ show: true, label: null }),
    "A: BLOCKED — shown and TRANSPARENT: the video is seen, the mouse cannot reach it", D(null, false, true));
  ok(JSON.stringify(D(null, false, false)) === JSON.stringify({ show: false, label: null }),
    "A: neither, while a song plays — no cover at all, YouTube's controls are yours", D(null, false, false));
  // The shield's ORIGINAL transparent idle job is kept, and hiding still covers it.
  ok(JSON.stringify(D("", false, false)) === JSON.stringify({ show: true, label: null }), "A: the transparent idle shield is unchanged", D("", false, false));
  ok(JSON.stringify(D("", true, false)) === JSON.stringify(hidden), "A: and hiding darkens it too", D("", true, false));
}

// ═══ PART B — through the real functions: a song starts, the toggles flip, the cover follows ═════
{
  _saved = null;
  const CP = prefs();
  const c = cover(CP);
  c._showPlayerShield(false);                       // a song starts, the way _driveNowPlaying says so
  ok(!c.state().shown, "B: a song playing, both toggles off — no cover", c.state());
  c.toggleOverlayBlocked();
  ok(CP.overlayBlocked() === true && c.state().shown && !c.state().dark && !c.state().note,
    "B: 🖱 on — the cover is shown, transparent, with no note", c.state());
  ok(c.refs.coverBlockBtn.classList.contains("active") && c.refs.coverBlockBtn.attrs["aria-pressed"] === "true",
    "B: and the 🖱 toggle is lit", c.refs.coverBlockBtn.className);
  c.togglePlayerHidden();
  ok(CP.playerHidden() === true && c.state().dark && /hidden/i.test(c.state().note), "B: 👁 on — dark, and it says the video is hidden", c.state());
  ok(c.refs.coverHideBtn.classList.contains("active"), "B: and the 👁 toggle is lit", c.refs.coverHideBtn.className);
  c._showPlayerShield(true, "Nothing playing");     // the song ends
  ok(c.state().dark && c.state().note === "Nothing playing", "B: when the room has nothing playing, its own screen shows", c.state());
  c._showPlayerShield(false);                       // the next song starts
  ok(c.state().dark && /hidden/i.test(c.state().note), "B: and the next song starts HIDDEN — the choice holds across songs", c.state());
  c.togglePlayerHidden(); c.toggleOverlayBlocked();
  ok(!c.state().shown && !c.refs.coverHideBtn.classList.contains("active") && !c.refs.coverBlockBtn.classList.contains("active"),
    "B: both off again — no cover, and neither toggle lit", c.state());
}

// ═══ PART C — remembered per device, off by default, and junk refused on load ═══════════════════
{
  _saved = null;
  let CP = prefs();
  ok(CP.playerHidden() === false && CP.overlayBlocked() === false, "C: both are OFF by default");
  let fired = 0; CP.onChange(() => { fired++; });
  CP.setPlayerHidden(true); CP.setOverlayBlocked(true);
  ok(fired === 0, "C: setting them fires NO chat-display signal — they are the player's, applied directly (the fifty-seventh signature)", fired);
  CP = prefs();
  ok(CP.playerHidden() === true && CP.overlayBlocked() === true, "C: a reload keeps both", { h: CP.playerHidden(), b: CP.overlayBlocked() });
  _saved = Object.assign({}, _saved, { playerHidden: "yes", overlayBlocked: 1 });
  CP = prefs();
  ok(CP.playerHidden() === false && CP.overlayBlocked() === false, "C: a stored value that is not a boolean reads as off", { h: CP.playerHidden(), b: CP.overlayBlocked() });
}

// ═══ PART D — the controls row never scrolls sideways; the label shortens first, wrap is the last resort ═
{
  const R = "ui/roster.js";
  const fit = grab(R, "_fitJoinLabel");
  const ladders = (code(R).match(/const _JOIN_LADDER = [^\n]+;\n\s*const _LEAVE_LADDER = [^\n]+;/) || [""])[0];
  ok(ladders, "APPLIED — the two label ladders are read from ui/roster.js");
  // A row whose width is what is in it: the Leave label (7 px a character, plus padding), the lock,
  // and — unless the row has wrapped — the volume group beside them.
  const LOCK = 40, VOL = 230;
  function run(width) {
    let w = width;
    const row = node("div");
    const btn = node("button");
    btn.closest = () => row;
    Object.defineProperty(btn, "textContent", { get() { return this.text; }, set(v) { this.text = String(v); } });
    Object.defineProperty(row, "clientWidth", { get: () => w });
    Object.defineProperty(row, "scrollWidth", { get: () => {
      const need = (16 + 7 * btn.text.length) + LOCK + (row.classList.contains("pc-wrap") ? 0 : VOL);
      return Math.max(w, need);
    } });
    const ctx = { refs: { joinBtn: btn }, window: { addEventListener() {} }, console };
    vm.createContext(ctx);
    vm.runInContext("let _joinResizeWired = true;\n" + ladders + "\n" + fit + "\n;globalThis.__fit = _fitJoinLabel;", ctx);
    ctx.__fit(true);
    return { label: btn.text, wrapped: row.classList.contains("pc-wrap"), over: row.scrollWidth > row.clientWidth + 1, row,
             widen: (x) => { w = x; }, fit: () => ctx.__fit(true) };
  }
  const wide = run(600);
  ok(wide.label === "Leave the DJ queue" && !wide.wrapped && !wide.over, "D: a wide row keeps the longest label on one line", wide);
  const mid = run(400);
  ok(!mid.wrapped && !mid.over && mid.label !== "Leave the DJ queue", "D: a tighter row SHORTENS the label first, still one line", mid);
  // 280px: even "LQ" needs 16 + 14 + 40 + 230 = 300 here, so one line CANNOT hold the row.
  const phone = run(280);
  ok(phone.wrapped, "D: A ROW THAT CANNOT FIT EVEN AT THE SHORTEST LABEL WRAPS — the volume group drops to a second line", phone);
  ok(!phone.over, "D: and NOTHING OVERFLOWS — the page never scrolls sideways", phone);
  ok(phone.label === "Leave the DJ queue", "D: and with the line to itself the label is re-fitted, back to its longest", phone.label);
  // Widen the same row and fit again: the wrap is not left behind.
  phone.widen(600);
  phone.fit();
  ok(!phone.row.classList.contains("pc-wrap"), "D: widened again, the row goes back to one line — the wrap is re-decided every fit", phone.row.className);
}

// ═══ PART E — where things sit, and the CSS it depends on (TEXTUAL, and says so) ════════════════
{
  const shell = code("ui/shell.js"), css = code("index.html");
  const np = (shell.match(/el\("div", \{ class: "np-row" \}, \[[^\n]*\]\)/) || [""])[0];
  ok(/refs\.npLabel/.test(np) && /np-tools/.test(np), "E: the Now-playing line holds the label and the toggles", np);
  const tools = (shell.match(/el\("div", \{ class: "np-tools" \}, \[[^\]]*\]\)/) || [""])[0];
  ok(tools.indexOf("refs.coverBlockBtn") >= 0 && tools.indexOf("refs.coverBlockBtn") < tools.indexOf("refs.coverHideBtn"),
    "E: 🖱 then 👁, at the line's right end (owner ruling)", tools);
  ok(/refs\.joinGroup = el\("div", \{ class: "join-group" \}, \[refs\.joinBtn, refs\.leaveLockBtn\]\)/.test(shell),
    "E: the Leave lock stays BESIDE Leave (owner ruling)");
  ok(/if \(_leaveLocked\) return;/.test(shell), "E: and it still gates Leave");
  // The main player's own rule, at the start of its line: the preview's `.preview-controls .volume-slider` (J134) sits above it.
  const slider = ((css.match(/\n\s*(\.volume-slider \{[^}]*\})/) || [])[1]) || "";
  const minW = parseInt((slider.match(/min-width:\s*(\d+)px/) || [])[1], 10);
  ok(/flex:\s*0 1 100px/.test(slider) && minW >= 48 && minW <= 64, "E: the slider is the one part that shrinks — 100px down to a usable minimum", slider);
  ok(/\.playback-controls\.pc-wrap \{[^}]*flex-wrap:\s*wrap/.test(css), "E: the last-resort wrap is declared for the row");
  ok(/\.np-tool\.active \{/.test(css), "E: a lit toggle is styled");
  // WRAPPED, NO DIAGONAL STEP (owner rulings, ddjp_462). When the row drops to two lines, BOTH lines start
  // at the left edge: line 1 is Leave with its lock right after it, at their natural widths; line 2 is the
  // volume group from the left edge, its slider filling, ☆ ▲ at the end. It used to keep its one-line
  // `margin-left: auto`, so line 2 sat right while line 1 sat left. DECLARED — only a phone shows it.
  const W = (sel) => (css.match(new RegExp("\\.playback-controls\\.pc-wrap " + sel.replace(/[.]/g, "\\.") + " \\{[^}]*\\}")) || [""])[0];
  ok(/flex:\s*0 0 100%/.test(W(".join-group")), "E: wrapped, Leave and its lock take line 1 to themselves", W(".join-group"));
  // A real `order` property only — the first version matched the "order:" inside "border:" and went red on
  // a tree that reordered nothing.
  const ORDER = /(^|[;{\s])order\s*:/;
  const lockRules = (css.match(/[^}]*leave-lock-btn[^{]*\{[^}]*\}/g) || []).map((r) => r.slice(r.lastIndexOf("{")));
  ok(lockRules.length > 0, "E: PREMISE — the lock's rules were found, so the next row is judging something", lockRules.length);
  ok(!ORDER.test(W(".join-group")) && !lockRules.some((r) => ORDER.test(r)),
    "E: and the lock stays RIGHT AFTER Leave (owner ruling) — nothing reorders it", lockRules);
  ok(!/flex:\s*1/.test((css.match(/\.playback-controls\.pc-wrap \.join-btn \{[^}]*\}/) || [""])[0]), "E: Leave keeps its natural width — it does not stretch across the line");
  ok(/margin-left:\s*0/.test(W(".volume-group")) && /flex:\s*1 1 100%/.test(W(".volume-group")), "E: line 2 starts at the LEFT edge and uses the line", W(".volume-group"));
  ok(/flex:\s*1 1 auto/.test(W(".volume-slider")), "E: its slider fills the space", W(".volume-slider"));
  ok(/margin-left:\s*auto/.test(W(".np-actions")), "E: and the reactions sit at the far end", W(".np-actions"));
}

// ═══ PART F — the bot's tab with its playback off says so, not "Nothing playing" (J112, the owner's answer at ddjp_620) ═
// The bot's tab, with "Watch videos on this device" off, does not load the room's song (`_botViewOff`, the one place the bot
// differs). Its cover kept whatever it last said — "Nothing playing", from before the room had a song — while the room
// played. Driven through the REAL `_driveNowPlaying` with the REAL `_loadReason` and cover functions; only the player, the
// progress bar and the labels around it are doubles.
{
  const BOT_OFF = "Playback is off on this tab (the bot's)";
  // THE PLUG, AS SHIPPED (J29, step 2): the drive asks it whether a service's player plays the room's song, and reads what the
  // room's box player shows — a real box player over the real YouTube player file and a stand-in YT player.
  const PW = require("./_player-world.js");
  // Since `ddjp_714` the push is the room's own decisions (`_followRoom`, where the cover is decided) and then the plug's check
  // (`_checkPlayer`), which this guard does not judge: a no-op here (`check-player-check` drives it).
  const driveSrc = ["_driveNowPlaying", "_followRoom", "_loadReason"].map((n) => grab(PLAYER, n)).join("\n");
  const labels = (code(PLAYER).match(/const COVER_[A-Z_]+_LABEL = [^\n]+;/g) || []).join("\n");
  function tab(viewOff) {
    _saved = null;
    const CP = prefs();
    const refs = { playerShield: node("div"), coverBlockBtn: node("button"), coverHideBtn: node("button"), npLabel: null, progressFill: null };
    const loads = [], warns = [];
    const { bp, w } = PW.boxPlayer({ getVideoData: () => ({}) });
    const scope = { refs, ChatPrefs: CP, H: { el, clear: (n) => { n.children = []; } }, console, Songs: SONGS, SongPlayer: w.SongPlayer,
      Logger: { warn: (m) => warns.push(m), info() {} }, _notPlayablePi: undefined,
      player: bp, _botViewOff: () => viewOff, _currentSong: null, _endedPi: null, _lastPlayPi: null,
      _loadsByPi: Object.create(null), _plog() {}, clearPlayer() {}, clearProgress() {}, renderNowPlaying() {}, updateSongTitle() {},
      startProgress() {}, _checkPlayer() {}, getPlayerTime: () => null, _readPlayerDuration: () => 0, _setNpLabel() {}, _npTimeText: () => "",
      loadSong: (vid) => { loads.push(vid); }, Playback: { elapsedSec: () => 0 } };
    const api = new Function("scope", "with (scope) {\nlet _idleLabel = null;\n" + labels + "\n" + coverSrc + "\n" + driveSrc +
      "\nreturn { _driveNowPlaying };\n}")(scope);
    const sh = refs.playerShield;
    return { drive: api._driveNowPlaying, loads, warns,
      state: () => ({ shown: sh.style.display === "block", dark: sh.classList.contains("waiting"), note: sh.children.map((c) => c.text).join("") }) };
  }
  const np = { song: { songKey: "yt:ABCDEFGHIJK" }, pi: "$p1", dj: "@dj:hs", startedAt: 1, elapsed: 3, duration: 200 };   // the room's song, by KEY
  // The control: an ordinary tab. Before the room has a song the cover says "Nothing playing"; once a song plays it goes.
  const t = tab(false);
  t.drive(null);
  ok(t.state().dark && t.state().note === "Nothing playing", "F CONTROL — before the room has a song, the cover says \"Nothing playing\"", t.state());
  t.drive(np);
  ok(t.loads.length === 1 && !t.state().shown, "F CONTROL — on an ordinary tab the song loads and the cover goes, so the bot's row below is " +
    "a reading of its playback being off", { loads: t.loads, cover: t.state() });
  // The bot's tab, playback off.
  const b = tab(true);
  b.drive(null);
  b.drive(np);
  b.drive(np);                                                  // the room's next tick, the same song
  ok(b.loads.length === 0, "F PREMISE — with playback off the bot's tab does not load the song", b.loads);
  ok(b.state().shown && b.state().dark && b.state().note === BOT_OFF, "F: while the room plays, the bot's tab with its playback off " +
    "says \"" + BOT_OFF + "\" — it said \"Nothing playing\", which is false while the room plays", b.state());
  b.drive(null);
  ok(b.state().note === "Nothing playing", "F: and when the room really has nothing playing, the bot's tab says so", b.state());
  // ADDED AT J29 (step 1; the owner's decision 2): a room made before song keys names its song by a bare id, and this build
  // reads no bare id a second way. The player loads nothing for it and says so ONCE PER PLAY — the drive runs on every tick.
  const o = tab(false);
  const bare = { song: { songKey: "ABCDEFGHIJK" }, pi: "$old1", dj: "@dj:hs", startedAt: 1, elapsed: 3, duration: 200 };
  o.drive(bare); o.drive(bare);                                 // two ticks of one play
  o.drive(Object.assign({}, bare, { pi: "$old2" }));            // the next play, the same bare id
  const said = o.warns.filter((m) => /^Player: not loading "ABCDEFGHIJK" pi=\$old[12] — no song player plays it: a song is named by its service and its id/.test(m));
  ok(o.loads.length === 0 && said.length === 2 && o.warns.length === 2,
    "F: A SONG A ROOM MADE BEFORE KEYS NAMES BY A BARE ID IS NOT LOADED, and the log says so once per play — the owner's answer " +
    "is a new room, so the player claims nothing and the log names why", { loads: o.loads, warns: o.warns });
  o.drive(np);
  ok(o.loads.length === 1 && o.loads[0] === np.song.songKey, "F CONTROL — the same tab then loads a song the room names by key, so the " +
    "row above is a reading of the bare id", o.loads);
}

// ═══ PART G — the cover with words is see-through, and the video under it is not drawn (`ddjp_678`, the owner's) ═════════════
// "also the nothing playing or video hidden or bot hidden playback window in hte player should be transparant as well but darker
// then the surrounding frame". Driven: the REAL cover functions over a frame holding the player and the cover. Read: the page's
// own sheet, through tests/_screen-world.js's cascade (declared values; Chromium's pixels are in the report).
{
  const SW = require("./_screen-world.js");
  const css = code("index.html");
  const cas = SW.makeCascade(SW.readSheet(css));
  const SHEET = SW.readSheet(css);
  // DRIVEN — which states put `cover-words` on the frame, and that the player inside it is never touched.
  _saved = null;
  const CP = prefs();
  const c = cover(CP);
  const fr = c.refs.playerFrame, pl = c.refs.player;
  const words = () => fr.classList.contains("cover-words");
  const seen = {};
  c._showPlayerShield(true, "Nothing playing"); seen.nothing = words();
  c._showPlayerShield(true, "Waiting for the next song\u2026"); seen.waiting = words();
  c._showPlayerShield(false); seen.playing = words();
  c.togglePlayerHidden(); seen.hidden = words();
  c.togglePlayerHidden(); c.toggleOverlayBlocked(); seen.blocked = words();
  c.toggleOverlayBlocked(); c._showPlayerShield(true, "Playback is off on this tab (the bot's)"); seen.botOff = words();
  c._showPlayerShield(false); seen.after = words();
  ok(seen.nothing && seen.waiting && seen.hidden && seen.botOff,
    "G: WHILE THE COVER SHOWS WORDS, THE FRAME CARRIES `cover-words` — Nothing playing, Waiting for the next song…, Player hidden, Playback is off on this tab (the bot's)", seen);
  // Its premise in the row: only a frame that does carry the class at all can show it absent where it must be.
  ok(seen.nothing && !seen.playing && !seen.blocked && !seen.after, "G: AND NOT OTHERWISE — a song playing with no cover, and the blocked-overlay cover (no words)", seen);
  ok(fr.children[0] === pl && fr.children.length === 2 && Object.keys(pl.style).length === 0 && Object.keys(pl.attrs).length === 0,
    "G: THE PLAYER ITSELF IS NEVER TOUCHED — the same element, in its place, no style or attribute written (the shell's rule: never moved, resized or rebuilt)",
    { first: fr.children[0] === pl, style: pl.style, attrs: pl.attrs });
  // DECLARED — what the sheet does with it.
  const doc = SW.makeDocument();
  const mkN = (tag, cls, id, parent) => { const n = SW.mk(tag, doc); if (cls) n.className = cls; if (id) n.id = id; if (parent) parent.appendChild(n); return n; };
  const decl = (n, prop) => { const d = cas.declared(n, prop); return d ? d.val : null; };
  const ruleOf = (n, prop) => { const d = cas.declared(n, prop); const r = d ? SHEET.find((x) => x.sel === d.sel && x.decls[prop]) : null; return r ? r.decls : null; };
  const chat = mkN("div", "chat-messages", "chat-messages", doc.body);
  const REF = { val: decl(chat, "background"), rule: ruleOf(chat, "background") };
  ok(REF.val === "rgba(12,12,16,0.45)" && !!REF.rule, "G PREMISE — the chat box's own darkness, rgba(12,12,16,0.45), from its own rule", REF.val);
  // The frame as the page holds it since J29's step 2: the box #player, the service's own element (an iframe) inside it.
  const frameOf = (cls) => { const f = mkN("div", cls, null, doc.body); const box = mkN("div", null, "player", f); const ifr = mkN("iframe", null, null, box); const sh = mkN("div", "player-shield", null, f); return { f, box, ifr, sh }; };
  const plain = frameOf("player-frame");
  const fbg = decl(plain.f, "background");
  ok(fbg === null || fbg === "transparent", "G: THE FRAME HAS NO BLACK OF ITS OWN — the room background shows through it (it was #000)", fbg);
  const coverW = frameOf("player-frame cover-words"); coverW.sh.className = "player-shield waiting";
  ok(decl(coverW.sh, "background") === REF.val && ruleOf(coverW.sh, "background") === REF.rule,
    "G: THE COVER WITH WORDS TAKES THE CHAT BOX'S DARKNESS, FROM THE CHAT BOX'S OWN RULE — see-through, darker than the player's card around it (it was #0e0e10)",
    { val: decl(coverW.sh, "background"), same: ruleOf(coverW.sh, "background") === REF.rule });
  ok(decl(coverW.box, "opacity") === "0" && decl(coverW.box, "display") !== "none" && decl(coverW.box, "visibility") !== "hidden" &&
     decl(coverW.ifr, "display") !== "none",
    "G: AND UNDER IT THE VIDEO IS NOT DRAWN — the frame's `cover-words` takes the player's box to opacity 0, and so whatever the " +
    "service's player put in it: never display:none, so the sound plays on under \"Player hidden\"",
    { opacity: decl(coverW.box, "opacity"), display: decl(coverW.box, "display") });
  const shown = frameOf("player-frame"); shown.sh.className = "player-shield";
  ok(decl(shown.box, "opacity") === null && decl(shown.ifr, "opacity") === null && decl(shown.sh, "background") === "transparent",
    "G CONTROL: with no words the video is drawn — and the blocked-overlay cover is transparent over it, as now", { opacity: decl(shown.box, "opacity"), shield: decl(shown.sh, "background") });
  ok(!/:has\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "G: set by a class where the cover is drawn, never by a `:has()` selector");
}

console.log("[player-cover] PASS — the player's view controls (" + asserts + " assertions). ONE cover over the player with " +
  "three reasons, strongest first — nothing playing, the player hidden (dark, saying \"Player hidden\"), YouTube's overlay " +
  "blocked (transparent) — driven through the real functions as songs start and end, so a hidden choice holds across songs. " +
  "Both toggles are remembered per device, off by default, lit when on, refuse junk on load, and fire no chat-display " +
  "signal. The controls row is fitted against a row whose width is what is in it: the label shortens first, and only a row " +
  "that cannot fit at the shortest label wraps — then nothing overflows, the label is re-fitted, and a wider row goes back " +
  "to one line. The Leave lock stays beside Leave and still gates it. And the bot's tab with its playback off says \"Playback " +
  "is off on this tab (the bot's)\" while the room plays, driven through the real `_driveNowPlaying`, where it said \"Nothing " +
  "playing\". A cover with words is see-through — the chat box's darkness, from its rule, over a frame with no black of its own — " +
  "and the video under it is not drawn (the frame's `cover-words`, opacity 0, never display:none), the player itself never touched; " +
  "the blocked cover stays transparent over the video. THIS GUARD CANNOT SEE A REAL PLAYER OR A REAL PHONE");
process.exit(0);
