// tests/check-player-cover.js
// SUBJECT: ui/player.js, ui/roster.js, ui/shell.js, core/chatprefs.js, index.html
// WALL: the player's view controls (owner rulings, ddjp_450 — main/04-features.md §The player's
// view controls). ONE cover over the player — the click-shield that already existed — with three
// reasons, strongest first: nothing playing (its dark screen), the video HIDDEN (the same dark screen,
// saying so, while the sound plays on), YouTube's overlay BLOCKED (transparent: the video is seen and
// the mouse cannot reach it). Two toggles on the Now-playing line drive it, remembered per device.
// And the controls row never makes the page scroll sideways: the slider shrinks, the Leave label
// shortens, and only as a last resort does the volume group drop to a second line.
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
const coverSrc = ["_coverFor", "_prefOn", "_renderCoverToggles", "_renderCover", "_showPlayerShield",
                  "toggleVideoHidden", "toggleOverlayBlocked", "applyCover"].map((n) => grab(PLAYER, n)).join("\n");
const labelDecl = (code(PLAYER).match(/const COVER_HIDDEN_LABEL = [^\n]+;/) || [""])[0];
ok(labelDecl, "APPLIED — the hidden-video label is declared once in ui/player.js");
function cover(CP) {
  const refs = { playerShield: node("div"), coverBlockBtn: node("button"), coverHideBtn: node("button") };
  const ctx = { refs, ChatPrefs: CP, H: { el, clear: (n) => { n.children = []; } }, console };
  vm.createContext(ctx);
  vm.runInContext("let _idleLabel = null;\n" + labelDecl + "\n" + coverSrc +
    "\n;globalThis.__c = { _coverFor, _showPlayerShield, toggleVideoHidden, toggleOverlayBlocked, applyCover };", ctx);
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
  ok(hidden.show === true && typeof hidden.label === "string" && /hidden/i.test(hidden.label) && /sound/i.test(hidden.label),
    "A: HIDDEN, while a song plays — a dark screen that says the video is hidden and the sound plays on", hidden);
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
  c.toggleVideoHidden();
  ok(CP.videoHidden() === true && c.state().dark && /hidden/i.test(c.state().note), "B: 👁 on — dark, and it says the video is hidden", c.state());
  ok(c.refs.coverHideBtn.classList.contains("active"), "B: and the 👁 toggle is lit", c.refs.coverHideBtn.className);
  c._showPlayerShield(true, "Nothing playing");     // the song ends
  ok(c.state().dark && c.state().note === "Nothing playing", "B: when the room has nothing playing, its own screen shows", c.state());
  c._showPlayerShield(false);                       // the next song starts
  ok(c.state().dark && /hidden/i.test(c.state().note), "B: and the next song starts HIDDEN — the choice holds across songs", c.state());
  c.toggleVideoHidden(); c.toggleOverlayBlocked();
  ok(!c.state().shown && !c.refs.coverHideBtn.classList.contains("active") && !c.refs.coverBlockBtn.classList.contains("active"),
    "B: both off again — no cover, and neither toggle lit", c.state());
}

// ═══ PART C — remembered per device, off by default, and junk refused on load ═══════════════════
{
  _saved = null;
  let CP = prefs();
  ok(CP.videoHidden() === false && CP.overlayBlocked() === false, "C: both are OFF by default");
  let fired = 0; CP.onChange(() => { fired++; });
  CP.setVideoHidden(true); CP.setOverlayBlocked(true);
  ok(fired === 0, "C: setting them fires NO chat-display signal — they are the player's, applied directly (the fifty-seventh signature)", fired);
  CP = prefs();
  ok(CP.videoHidden() === true && CP.overlayBlocked() === true, "C: a reload keeps both", { h: CP.videoHidden(), b: CP.overlayBlocked() });
  _saved = Object.assign({}, _saved, { videoHidden: "yes", overlayBlocked: 1 });
  CP = prefs();
  ok(CP.videoHidden() === false && CP.overlayBlocked() === false, "C: a stored value that is not a boolean reads as off", { h: CP.videoHidden(), b: CP.overlayBlocked() });
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
  const slider = (css.match(/\.volume-slider \{[^}]*\}/) || [""])[0];
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

console.log("[player-cover] PASS — the player's view controls (" + asserts + " assertions). ONE cover over the player with " +
  "three reasons, strongest first — nothing playing, the video hidden (dark, saying the sound plays on), YouTube's overlay " +
  "blocked (transparent) — driven through the real functions as songs start and end, so a hidden choice holds across songs. " +
  "Both toggles are remembered per device, off by default, lit when on, refuse junk on load, and fire no chat-display " +
  "signal. The controls row is fitted against a row whose width is what is in it: the label shortens first, and only a row " +
  "that cannot fit at the shortest label wraps — then nothing overflows, the label is re-fitted, and a wider row goes back " +
  "to one line. The Leave lock stays beside Leave and still gates it. THIS GUARD CANNOT SEE A REAL PLAYER OR A REAL PHONE");
process.exit(0);
