// tests/_player-world.js
// THE SONG PLAYERS IN A SANDBOX — a harness, not a guard (no `check-` prefix, so `run-all` does not run it). Added at J29's
// step 2 (`ddjp_706`) so every guard that drives a player drives the SAME production path: the real plug
// (`ui/songplayer.js`) and the real YouTube player (`ui/youtube.js`), over a stand-in `YT` that records every call it is
// handed, in order. What a guard used to hand the room player as "the YouTube player" it now hands as the stand-in's player
// object, and the room player holds a real box player built over it — so the plug, YouTube's door from a key to its own id,
// its state words and its error table all run as they run in a browser.
//
// WHAT IS REAL: `core/songs.js`, `ui/songplayer.js`, `ui/youtube.js`. WHAT IS A DOUBLE: `YT.Player` (the guard's `player`
// object, or an empty one) and a document just big enough for a box and the element a player makes in it.
//
//   world(o)          o.player(el, cfg) → the object `new YT.Player` returns (default: an empty object); o.extras laid over
//                     the sandbox; o.available: false keeps `YT` away (the script not up yet). Returns
//                     { sb, SongPlayer, YouTubePlayer, Songs, YT, calls, made, doc, box(id), ready(i), state(i, n), error(i, c) }
//   boxPlayer(p, o)   a room box player (or, with o.song, a preview's) over the stand-in object `p`, made ready unless
//                     o.ready === false; o.on — the box player's callbacks. Returns { bp, w }
//   extract(rel, name) the source of a named function in an app file, brace-matched (comments and strings respected)
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

function makeDoc() {
  const byId = Object.create(null);
  function el(tag) {
    const n = { tagName: String(tag).toUpperCase(), children: [], style: {}, parentNode: null, _id: "",
      get id() { return this._id; }, set id(v) { this._id = v; if (v) byId[v] = this; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      replaceChild(a, b) { this.children = this.children.map((x) => (x === b ? a : x)); a.parentNode = this; b.parentNode = null; return b; },
      // Attributes (`ddjp_709`: SoundCloud's player file opens its widget's iframe by its `src`, and says `allow="autoplay"`).
      _attrs: {},
      setAttribute(k, v) { this._attrs = Object.assign({}, this._attrs, { [k]: String(v) }); if (k === "id") this.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      removeAttribute(k) { const a = Object.assign({}, this._attrs); delete a[k]; this._attrs = a; } };
    return n;
  }
  const body = el("body");
  return { body, head: el("head"), currentScript: null, createElement: el, getElementById: (id) => byId[id] || null };
}

// A recording stand-in for `YT.Player`: the object a guard supplies, each of its methods recorded as it is called.
function world(o) {
  o = o || {};
  // REFUSED BY NAME, not a bare ENOENT: a tree without the plug is a tree from before J29's step 2.
  for (const rel of ["ui/songplayer.js", "ui/youtube.js"]) {
    if (!fs.existsSync(path.join(ROOT, rel))) throw new Error("the song players' plug is not in this tree: " + rel + " is missing (J29, step 2)");
  }
  const calls = [];
  const made = [];
  const doc = makeDoc();
  function Player(el, cfg) {
    const base = (typeof o.player === "function") ? (o.player(el, cfg) || {}) : {};
    const name = typeof el === "string" ? el : (el && el.id);
    const plain = JSON.parse(JSON.stringify(cfg || {}));   // the options as data (its handlers are functions)
    calls.push("new " + name + " " + JSON.stringify(plain));
    const rec = Object.create(base);
    for (const k of Object.keys(base)) {
      if (typeof base[k] !== "function") continue;
      rec[k] = function () {
        calls.push(name + "." + k + "(" + JSON.stringify(Array.prototype.slice.call(arguments)).slice(1, -1) + ")");
        return base[k].apply(base, arguments);
      };
    }
    made.push({ el: name, cfg: cfg, plain: plain, p: rec, base: base });
    return rec;
  }
  const YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  const win = {};
  if (o.available !== false) win.YT = YT;
  const quiet = { info() {}, warn() {}, debug() {}, error() {} };
  const sb = loadInContext(["ui/songplayer.js", "ui/youtube.js"], Object.assign({
    window: win, document: doc, Logger: quiet, setTimeout: () => 0, clearTimeout: () => {},
  }, o.extras || {}));
  if (o.available !== false) sb.YT = YT;   // the script's global, as YouTube's script defines it
  const fire = (i, name, arg) => {
    const m = made[i];
    if (!m || !m.cfg || !m.cfg.events || typeof m.cfg.events[name] !== "function") throw new Error("no " + name + " on player " + i);
    m.cfg.events[name](arg);
  };
  return {
    sb, SongPlayer: sb.SongPlayer, YouTubePlayer: sb.YouTubePlayer, Songs: sb.Songs, YT, calls, made, doc,
    box(id) { const b = doc.createElement("div"); b.id = id || "player"; doc.body.appendChild(b); return b; },
    ready(i) { fire(i || 0, "onReady", { target: made[i || 0].p }); },
    state(i, n) { fire(i || 0, "onStateChange", { data: n, target: made[i || 0].p }); },
    error(i, code) { fire(i || 0, "onError", { data: code, target: made[i || 0].p }); },
  };
}

// The room's box player over a stand-in player object `p` (what a guard used to hand the room player directly).
function boxPlayer(p, o) {
  o = o || {};
  const w = world({ player: () => p, extras: o.extras, available: o.available });
  const box = w.box(o.boxId || (o.song ? "preview-player" : "player"));
  const bp = w.SongPlayer.make(box, o.song ? { song: o.song, preview: true, startMuted: false } : { startMuted: true }, o.on || {});
  if (o.ready !== false && w.made.length) w.ready(0);
  return { bp, w };
}

// The source of `function name(...) {...}` in an app file, brace-matched with comments and strings skipped.
function extract(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const at = src.indexOf("function " + name + "(");
  if (at < 0 || src.indexOf("function " + name + "(", at + 1) >= 0) return { ok: false, stage: "`" + name + "` is not declared exactly once in " + rel };
  const open = src.indexOf("{", src.indexOf(")", at));
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return { ok: true, source: src.slice(at, i + 1) }; }
  }
  return { ok: false, stage: "`" + name + "` could not be brace-matched in " + rel };
}

module.exports = { world, boxPlayer, extract, makeDoc };
