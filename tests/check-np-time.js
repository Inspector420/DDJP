// tests/check-np-time.js
// SUBJECT: ui/player.js
// WALL: the time on the now-playing line is the PLAYER'S OWN position, written by the same per-frame
// loop that moves the progress bar — so the two cannot disagree and the time moves every second, not
// in the 2-second steps of the room's playback tick (owner report, ddjp_454). The room's elapsed is a
// FALLBACK for the moment before the player reports a time. And the line starts with the DJ: no
// "Now playing —" (owner ruling).
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

function node(tag) {
  return { tag, children: [], style: {}, dataset: {}, _t: "", writes: 0,
    get textContent() { return this._t; }, set textContent(v) { this._t = String(v); this.writes++; },
    replaceChildren(...k) { this.children = k; }, appendChild(c) { this.children.push(c); return c; } };
}
function world(o) {
  const st = { t: o.t, d: o.d, preview: !!o.preview };
  const refs = { npLabel: node("div"), progressFill: node("div"), progressBar: node("div") };
  const ctx = {
    refs,
    H: { el: (tag, a) => { const n = node(tag); if (a && a.text) n._t = a.text; return n; },
         rankColor: () => "#fff", _rosterLevel: () => 0, shortName: (u) => u, avatarEl: () => node("img") },
    Media: { getAvatarUrl: () => null },
    PlaylistPanels: { previewActive: () => st.preview },
    document: { createTextNode: (t) => { const n = node("#text"); n._t = String(t); return n; } },
    requestAnimationFrame: () => 1, console, Math, isFinite, Number, String,
  };
  vm.createContext(ctx);
  vm.runInContext(fmtSrc + "\n;H.fmt = fmt;\nlet _progRaf = null, playerReady = true;\n" +
    "const player = { getCurrentTime: () => __st.t, getDuration: () => __st.d };\n" + src +
    "\n;globalThis.__x = { _progTick, _setNpLabel, _npTimeText };", Object.assign(ctx, { __st: st }));
  const text = () => refs.npLabel.children.map((c) => c._t || "").join("");
  return Object.assign(ctx.__x, { st, refs, text, fmt: ctx.fmt });
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

console.log("[np-time] PASS — the now-playing time is the player's own (" + asserts + " assertions): the real frame loop writes " +
  "the same position the bar shows, moves every second instead of in the room's 2-second steps, writes nothing within a second, " +
  "keeps the room's time while the player reports none, and never writes a preview's time into the room's line. The line starts " +
  "with the DJ. THIS GUARD CANNOT SEE A REAL PLAYER'S TIMING");
process.exit(0);
