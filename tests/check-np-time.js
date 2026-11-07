// tests/check-np-time.js
// SUBJECT: ui/player.js, ui/roster.js, ui/queue.js, index.html
// WALL: the time on the now-playing line is the PLAYER'S OWN position, written by the same per-frame
// loop that moves the progress bar — so the two cannot disagree and the time moves every second, not
// in the 2-second steps of the room's playback tick (owner report, ddjp_454). The room's elapsed is a
// FALLBACK for the moment before the player reports a time. And the line starts with the DJ: no
// "Now playing —" (owner ruling). And (`ddjp_678`, the owner's: "in the player cant click ont he name as a player card
// trigger") PART D: the DJ's name on the line opens that person's user card, through the one trigger the room queue's
// names use (`Roster._wireCardTrigger`, the REAL one, extracted from ui/roster.js), wired when the name is built — only
// when the DJ changes — so a tick keeps it. And (J134, the owner's: "we dont need the nithing playing in the frame of the
// player since the video screen says it too") PART E: with no song, and between songs, the line holds no words.
//
// Driven: the REAL `_progTick`, `_setNpLabel`, `_npTimeText`, `_npWriteTime`, `_readPlayerDuration`
// and `getPlayerTime` are extracted from ui/player.js and run over a YouTube player double whose
// time this guard moves; the REAL `fmt` from ui/base.js formats it. THIS GUARD CANNOT SEE A REAL
// PLAYER'S TIMING — whether YouTube reports smoothly while buffering is a browser's.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");

let asserts = 0;
function fail(msg, got) {
  console.log("[np-time] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const grab = (rel, name) => { const x = P.extractNamed(rel, name); ok(x.ok, "APPLIED — `" + name + "` is extractable from " + rel, x.stage); return x.source; };

const src = ["getPlayerTime", "_readPlayerDuration", "_npTimeText", "_npWriteTime", "_setNpLabel", "_progTick"]
  .map((n) => grab("ui/player.js", n)).join("\n");
const fmtSrc = grab("ui/base.js", "fmt");
const triggerSrc = grab("ui/roster.js", "_wireCardTrigger");

// CHANGED ON PURPOSE (`ddjp_678`, PART D): a node also takes attributes and classes, which the card trigger sets on the name.
function node(tag) {
  const cls = new Set();
  return { tag, children: [], style: {}, dataset: {}, _t: "", writes: 0, attrs: {},
    classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, get className() { return [...cls].join(" "); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    get textContent() { return this._t; }, set textContent(v) { this._t = String(v); this.writes++; },
    replaceChildren(...k) { this.children = k; }, appendChild(c) { this.children.push(c); return c; } };
}
function world(o) {
  const st = { t: o.t, d: o.d, preview: !!o.preview };
  const refs = { npLabel: node("div"), progressFill: node("div"), progressBar: node("div") };
  // CHANGED ON PURPOSE (`ddjp_678`, PART D): the label wires the DJ's name to their card, so the world has the REAL trigger,
  // and the cards it opened are recorded.
  const opened = [];
  const ctx = {
    refs, opened,
    H: { el: (tag, a) => { const n = node(tag); if (a && a.text) n._t = a.text; return n; },
         rankColor: () => "#fff", _rosterLevel: () => 0, shortName: (u) => u, avatarEl: () => node("img") },
    Media: { getAvatarUrl: () => null },
    PlaylistPanels: { previewActive: () => st.preview },
    document: { createTextNode: (t) => { const n = node("#text"); n._t = String(t); return n; } },
    requestAnimationFrame: () => 1, console, Math, isFinite, Number, String,
  };
  vm.createContext(ctx);
  vm.runInContext(fmtSrc + "\n;H.fmt = fmt;\nlet _progRaf = null, playerReady = true;\n" +
    "function openUserCard(m) { opened.push(m); }\n" + triggerSrc + "\nconst Roster = { _wireCardTrigger };\n" +
    "const player = { getCurrentTime: () => __st.t, getDuration: () => __st.d };\n" + src +
    "\n;globalThis.__x = { _progTick, _setNpLabel, _npTimeText };", Object.assign(ctx, { __st: st }));
  const text = () => refs.npLabel.children.map((c) => c._t || "").join("");
  return Object.assign(ctx.__x, { st, refs, text, opened, fmt: ctx.fmt });
}

// ═══ PART A — the loop writes the player's own time, every second it changes ═════════════════════════
{
  const w = world({ t: 12.4, d: 300 });
  w._setNpLabel("@dj:hs", w._npTimeText(10, 300));          // what the room's tick first says
  ok(!/Now playing/.test(w.text()), "A: THE LINE STARTS WITH THE DJ — no \"Now playing —\" (owner ruling)", w.text());
  ok(/@dj:hs/.test(w.text()) && /0:10/.test(w.text()), "A: APPLIED — the DJ and the room's first time are shown", w.text());
  w._progTick();
  ok(/0:12 \/ 5:00/.test(w.text()), "A: THE FRAME LOOP WRITES THE PLAYER'S OWN TIME — the same number the bar shows", w.text());
  w.st.t = 13.2; w._progTick();
  ok(/0:13 \/ 5:00/.test(w.text()), "A: and it moves the next second WITHOUT waiting for the room's 2-second tick", w.text());
  const mid = w.refs.npLabel.children[w.refs.npLabel.children.length - 1];
  const before = mid.writes;
  w.st.t = 13.7; w._progTick(); w._progTick(); w._progTick();
  ok(mid.writes === before, "A: frames within the same second write NOTHING — sixty frames a second are not sixty DOM writes", { before, after: mid.writes });
  const fill = parseFloat(w.refs.progressFill.style.width);
  ok(Math.abs(fill - (13.7 / 300) * 100) < 0.01, "A: CONTROL — and the bar is driven from the same read", w.refs.progressFill.style.width);
}

// ═══ PART B — no usable read, no write; a preview never writes the room's line ══════════════════════
{
  const w = world({ t: null, d: 0 });
  w._setNpLabel("@dj:hs", w._npTimeText(40, 200));
  w._progTick();
  ok(/0:40 \/ 3:20/.test(w.text()), "B: WHILE THE PLAYER REPORTS NOTHING (loading), the room's time stays — a fallback, not a blank", w.text());
  const p = world({ t: 99, d: 300, preview: true });
  p._setNpLabel("@dj:hs", p._npTimeText(5, 300));
  p._progTick();
  ok(/0:05/.test(p.text()) && !/1:39/.test(p.text()), "B: during a playlist PREVIEW the player is somebody else's song — its time never reaches the room's line", p.text());
}

// ═══ PART C — the room's tick defers to the player (TEXTUAL, and says so) ════════════════════════════
{
  const code = fs.readFileSync(path.join(ROOT, "ui/player.js"), "utf8");
  const drive = code.slice(code.indexOf("function _driveNowPlaying("), code.indexOf("function _driveNowPlaying(") + 6000);
  const call = (drive.match(/_setNpLabel\(np\.dj,[^\n]*\n?[^\n]*/) || [""])[0];
  ok(/getPlayerTime\(\)/.test(drive.slice(0, drive.indexOf(call) + call.length)) && /live \?/.test(call),
    "C: the room's tick writes the PLAYER's time when it has one, its own only as the fallback", call);
}

// ═══ PART D — the DJ's name opens their card (`ddjp_678`; the owner: "in the player cant click ont he name as a player card trigger") ═
// As the room queue's names do (J14): role button, a tab stop, the trigger's class (the sheet's pointer), a click or Enter
// opening the card for the DJ. The name is built only when the DJ changes, so it is wired there — and a tick keeps it.
{
  const w = world({ t: 12, d: 300 });
  w._setNpLabel("@dj:hs", w._npTimeText(10, 300));
  const nameOf = () => w.refs.npLabel.children.find((c) => c.tag === "span" && c._t && c._t !== "") || null;
  const n = nameOf();
  ok(n && n._t === "@dj:hs", "D PREMISE — the line holds the DJ's name, as its own element", n && n._t);
  ok(n && n.attrs.role === "button" && n.attrs.tabindex === "0" && n.classList.contains("uc-trigger") && typeof n.onclick === "function",
    "D: THE DJ'S NAME IS A CARD TRIGGER — a button to a screen reader, a tab stop, the trigger's class, a click to act on", n && { attrs: n.attrs, cls: n.className });
  if (n && n.onclick) n.onclick();
  ok(w.opened.length === 1 && w.opened[0].userId === "@dj:hs", "D: A CLICK ON IT OPENS THAT DJ'S CARD", w.opened);
  let stopped = 0;
  if (n && n.onkeydown) n.onkeydown({ key: "Enter", preventDefault() { stopped++; } });
  ok(w.opened.length === 2 && w.opened[1].userId === "@dj:hs" && stopped === 1, "D: AND SO DOES ENTER, as on every name", w.opened);
  w._setNpLabel("@dj:hs", w._npTimeText(11, 300));   // the room's next tick, the same DJ
  ok(nameOf() === n && n.attrs.role === "button", "D: A TICK KEEPS IT — the same name, still wired (the label is rebuilt only when the DJ changes)", nameOf() === n);
  w._setNpLabel("@bob:hs", w._npTimeText(0, 200));   // the next DJ
  const m = nameOf();
  if (m && m.onclick) m.onclick();
  ok(m && m !== n && m._t === "@bob:hs" && m.attrs.role === "button" && w.opened.length === 3 && w.opened[2].userId === "@bob:hs",
    "D: THE NEXT DJ'S NAME OPENS THEIR CARD, not the last one's", { name: m && m._t, opened: w.opened.map((o) => o.userId) });
  const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(/\.uc-trigger \{[^}]*cursor:\s*pointer/.test(css), "D: and the trigger's class is drawn with a pointer, by the sheet (DECLARED)");
}

// ═══ PART E — no song, no words (J134; the owner: "we dont need the nithing playing in the frame of the player since the video
// screen says it too") ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The REAL `renderNowPlaying` with the REAL `_setNpLabel`, over a label whose `textContent` behaves as the DOM's (writing it
// drops the children). Nothing playing, and between songs (the song this player finished, `_endedPi`), the line holds no
// words; a song playing still gives the DJ and the time. The cover's own words and the room queue's heading are not the
// line's and stay (TEXTUAL). The 32 px height is held by 🖱 and 👁 (player-cover E) and was MEASURED in Chromium.
{
  const renderSrc = grab("ui/player.js", "renderNowPlaying");
  const setSrc = grab("ui/player.js", "_setNpLabel");
  function domNode(tag) {
    const n = node(tag);
    Object.defineProperty(n, "textContent", { get() { return this.children.length ? this.children.map((c) => c._t || "").join("") : this._t; },
      set(v) { this._t = String(v); this.children = []; this.writes++; } });
    return n;
  }
  const st = { np: null };
  const refs = { npLabel: domNode("div") };
  const ctx = {
    refs, console, Math, Date, String,
    H: { el: (tag, a) => { const n = node(tag); if (a && a.text) n._t = a.text; return n; }, fmt: (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"),
         rankColor: () => "#fff", _rosterLevel: () => 0, shortName: (u) => u, avatarEl: () => node("img") },
    Roster: { _wireCardTrigger() {} }, Media: { getAvatarUrl: () => null },
    Queue: { getNowPlaying: () => st.np },
    ChatPanels: { _syncNpButtons() {} },
    Actions: { describe: () => ({ enabled: true }) },
    document: { createTextNode: (t) => { const n = node("#text"); n._t = String(t); return n; } },
  };
  vm.createContext(ctx);
  vm.runInContext("let _endedPi = null, _currentSong = null;\nfunction clearProgress() {}\nfunction updateVideoTitle() {}\n" + setSrc + "\n" + renderSrc +
    "\n;globalThis.__e = { renderNowPlaying, setEnded: (pi) => { _endedPi = pi; } };", ctx);
  const line = () => refs.npLabel.textContent;
  const song = { pi: "pi-1", dj: "@dj:hs", song: { videoId: "aaaaaaaaaaa" }, startedAt: Date.now() - 42000 };
  st.np = song; ctx.__e.renderNowPlaying();
  ok(/@dj:hs/.test(line()) && /0:4\d/.test(line()), "E PREMISE — CONTROL: a song playing gives the DJ and the time", line());
  st.np = null; ctx.__e.renderNowPlaying();
  ok(line() === "" && refs.npLabel.children.length === 0, "E: NOTHING PLAYING, THE LINE HOLDS NO WORDS — the cover says it", line());
  st.np = { pi: "pi-2", dj: "@dj:hs", song: null }; ctx.__e.renderNowPlaying();
  ok(line() === "", "E: and a play with no song is nothing playing too", line());
  st.np = song; ctx.__e.renderNowPlaying();
  ok(/@dj:hs/.test(line()), "E: APPLIED — the next render with a song gives the DJ back (the label is rebuilt, not left blank)", line());
  ctx.__e.setEnded("pi-1"); ctx.__e.renderNowPlaying();
  ok(line() === "" && refs.npLabel.children.length === 0, "E: BETWEEN SONGS (the song this player finished) THE LINE HOLDS NO WORDS — it said \"Nothing playing\" while the cover said \"Waiting for the next song…\"", line());
  const player = fs.readFileSync(path.join(ROOT, "ui/player.js"), "utf8"), queue = fs.readFileSync(path.join(ROOT, "ui/queue.js"), "utf8");
  ok(/_showPlayerShield\(true, "Nothing playing"\)/.test(player) && /_showPlayerShield\(true, "Waiting for the next song…"\)/.test(player),
    "E: THE COVER'S OWN WORDS STAY — \"Nothing playing\" and \"Waiting for the next song…\" (TEXTUAL)");
  ok(/text: playing \? "Now Playing" : "Nothing playing"/.test(queue), "E: AND THE ROOM QUEUE'S \"Nothing playing\" HEADING STAYS — it is not the player's (TEXTUAL)");
}

console.log("[np-time] PASS — the now-playing time is the player's own (" + asserts + " assertions): the real frame loop writes " +
  "the same position the bar shows, moves every second instead of in the room's 2-second steps, writes nothing within a second, " +
  "keeps the room's time while the player reports none, and never writes a preview's time into the room's line. The line starts " +
  "with the DJ, and the DJ's name opens their card — a click or Enter, through the one trigger every name uses, kept across ticks and " +
  "moved to the next DJ. With no song, and between songs, the line holds no words (J134): the cover says it, and the cover's words " +
  "and the room queue's heading stay. THIS GUARD CANNOT SEE A REAL PLAYER'S TIMING");
process.exit(0);
