// tests/check-list-look.js
// SUBJECT: ui/queue.js, ui/panels.js, ui/chat.js, ui/playlists.js, ui/screens.js, ui/shell.js, index.html
// WALL: J131 PART B — ONE LOOK FOR THE QUEUE PANE'S LISTS (the owner's direction at `ddjp_654`, shown at the pause and agreed).
//
//   PART A — the room queue is one list, as My queue's and a playlist's: a line above it keeps Reset, the "Now Playing" tag
//            and the lock; under it ONE block of rows — Now Playing first (▶ where the number goes, the DJ on its sub line in
//            the DJ's colour, the blue edge, ★ and ▲), then each waiting DJ's song numbered from 2 — the rows together, at
//            My queue's rows' size. The box around Now Playing is gone. With nothing playing the first row is the empty one,
//            the playing row's size, and the line says "Nothing playing".
//   PART B — History is one list too, at the same size; its sub line says "skipped" (or "Sys Skip") in the moderation teal
//            (the colour room events of moderation take in chat, PART C of J131), and its ▲ and ★ counts take the colours the
//            ▲ and ★ buttons give their own counts — read off those buttons in the same world, not listed here.
//   PART C — the phone layout fits the screen: the frame and its columns are border-box, by the page's first rule, which
//            sizes every box so. CORRECTED AT `ddjp_656`: J131 added a phone rule for an overflow of 34 px that only the
//            instrument saw — see PART P — and that rule is gone again.
//   PART P — THE INSTRUMENT (`ddjp_656`): the stylesheet is read as a browser reads the page. The reader matched `<style>`
//            across the raw file, began inside the head's comment that mentions it, and lost the first rule,
//            `* { box-sizing: border-box; }` — so every box read content-box, every row 14 px taller than a browser draws it,
//            and this guard passed while the room queue's and History's rows were 44 px on screen and My queue's 58 (the
//            owner's screenshots). Asked first, in its own part: a plain element is border-box, and the rule saying so is `*`.
//            And (the milestone close after `ddjp_658`) a comment is skipped only where one can begin: a `<!--` inside a style
//            rule drops no rule, and a `<style>` written inside a script is no style block — the reader's first fix got both
//            wrong.
//   PART R — no other reader in `tests/` or `tools/` cuts the stylesheet out of index.html on its own (derived; the sweep
//            itself proved on a fixture first).
//   PART F — History's row on every screen (`ddjp_667`, the owner's design for a phone): the ▲ and ★ counts in a spot of their
//            own left of the ＋, one width on every row — since `ddjp_677` (the owner at `ddjp_674`) on one line, ▲ in the spot's
//            left half and ★ in its right, each centred in its half, both on every row with 0 where there are none, over 99
//            reading 99 (History only: the fold keeps the real number, and Now Playing shows it), and History's record of what
//            it drew holding the counts as shown, so 120 → 121 redraws nothing; the
//            line — name · age · skipped (or Sys Skip) — giving way only as far as needed, the age's short form with "ago",
//            then its shortest, then the name's end, "skipped" and "Sys Skip" never cut, the long words back when room comes
//            back, each age tick keeping each row's form; the DM list's times and the other lists as they were. And
//            (`ddjp_678`, the owner's) a count of 0 in the line's grey, by the line's own colour rule through `hist-zero`, blue
//            and gold above 0, a 0 → 1 redrawing the row. Its widths
//            are a model read off the page's own sheet (said there), the pixels measured in Chromium. And (`ddjp_669`) the whole
//            first minute reads "just now", never "0 mins ago": the formatter at 44, 45, 59 and 60 seconds, and History's short
//            forms there ("now"; at 60 "1min ago", "1min").
//   AND THREE PARTS OF THE JOB THE OWNER CHOSE AT `ddjp_670` (his words: "one job"; the rules, `main/04-features.md`):
//   PART T — six typing boxes in the chat's tint (W1, W2, W3): the chat's send box (the DM's, which shares its class), the DM
//            list's search, People's invite box, My queue's link box, the library's new-playlist name and a playlist's link
//            box take the chat's see-through dark tint and its frame — the values `.chat-messages` has — from ONE rule; the room
//            settings' boxes, the rename box and the add-to-playlist picker's box keep the opaque grey. DECLARED (the cascade);
//            contrast and focus read in Chromium (the report).
//   PART G — a playlist's top row (W1): ← the link box, Add, +All, the lock — one row; ← a square the lock's size; "+All";
//            the box's hint the playlist's name as the list shows it, then " - paste a youtube link..."; no title, no second row;
//            the box and Add doing what they did. Its widths on a phone are Chromium's (the report).
//            AND AT `ddjp_671` (the owner, L1–L3) Add became a blue "+" square — and AT `ddjp_672` (the owner's correction, C1
//            and C4) its own square right after the box, not inside it: the row ← [box] + +All 🔒; ← and + true squares, 30 × 30,
//            the row's height (the lock still 34 × 30); each glyph its square's `::before`, a drawing whose ink is centred in it,
//            read from its path; a title and an aria-label "Add to this playlist"; a click does what Add did and Enter still
//            adds; +All's two clicks as before. DECLARED here; the widths, the row and the glyphs' ink at 360 and 390 px are
//            Chromium's (the report).
//   PART E — an empty playlist shows no text (W1).
//   PART S — SEE-THROUGH ROWS (`ddjp_678`, the owner's): every song row (the room queue's, Now Playing's and the empty play row
//            included, My queue's, History's, a playlist's), the library's rows, the DM list's rows and the Logs box take the
//            chat box's darkness from its own rule, locked or not, none keeping a background of its own; each keeps its frame
//            (the playing row its blue edge), nothing inside a row darkened; DM rows change in DMs only (the room list keeps
//            `.room-item`'s #222 and hover), their hover a see-through wash; and each sits on the panel the Panel dimness slider
//            sets, as the chat box does. (SUBJECT gained ui/screens.js and ui/shell.js with it: the room list, the Logs box.)
//   PART L —a playlist's row (`ddjp_668`, the owner's rule for a phone): unlocked, no ＋ and no separator before ▲ — it reads
//            ▲ ▼ | ⏫ ⏬ | ✕; locked, ＋ | ✕ as before; the list's `pl-locked` class alone flips it, on the same row elements;
//            History's ＋, My queue's rows and the room queue's rows as they were. (SUBJECT gained ui/playlists.js with it.)
//
// DRIVEN: `tests/_screen-world.js` builds the main screen with the eleven ui/ files whole; what a person sees is asked of the
// page's own stylesheet through the harness's cascade (declared values, no layout — the sizes in pixels were measured in
// Chromium, in the report). Every part states its premise first.

"use strict";
const S = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[list-look] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
function part(name, fn) {
  try { fn(); } catch (e) { failed++; console.log("[list-look] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
}
// A part that waits on the world's clock (PART F's tick): the verdict below waits for every one of them.
const pending = [];
function partAsync(name, fn) {
  pending.push(Promise.resolve().then(fn).catch((e) => { failed++; console.log("[list-look] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }));
}

const NOW = 1.9e12;
const LEVEL = { "@dj:hs": 60, "@ann:hs": 20, "@bob:hs": 40, "@cat:hs": 10 };
function screen(o, wo) {   // `wo`: more options for the world (PART F's ResizeObserver and clock)
  const st = Object.assign({
    playing: { dj: "@dj:hs", song: { videoId: "ccccccccccc" }, pi: "p0" },
    rotation: [{ user: "@ann:hs", pending: [{ videoId: "aaaaaaaaaaa" }] }, { user: "@bob:hs", pending: [{ videoId: "bbbbbbbbbbb" }] },
               { user: "@cat:hs", pending: [{ videoId: "ddddddddddd" }] }],
    moderate: true,
    mine: [{ videoId: "eeeeeeeeeee" }, { videoId: "fffffffffff" }],
    // CHANGED ON PURPOSE (J131's correction, `ddjp_663`): a row names how its song was cut short (`cutShortBy`, a neutral
    // kind) — h1 a person's skip, h3 the room's — where it carried `skipped: true`, the mark of the song a skip started.
    history: [{ videoId: "hhhhhhhhhh1", dj: "@ann:hs", at: NOW - 60000, pi: "h1", cutShortBy: "dj" },
              { videoId: "hhhhhhhhhh2", dj: "@bob:hs", at: NOW - 360000, pi: "h2", cutShortBy: false },
              { videoId: "hhhhhhhhhh3", dj: "@cat:hs", at: NOW - 720000, pi: "h3", cutShortBy: "media" }],
    counts: { p0: { votes: 3, saves: 1 }, h1: { votes: 2, saves: 1 }, h2: { votes: 4 } },
    reach: { entries: 3, complete: true },
    // ADDED at `ddjp_668` (PART L): one playlist the library lists and opens. None by default, as before.
    playlist: null,
  }, o || {});
  const features = {
    Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "staff", level: 60 }, { name: "vip", level: 40 }, { name: "player", level: 20 }, { name: "guest", level: 10 }],
            getMyId: () => "@me:hs", getRoster: () => Object.keys(LEVEL).map((u) => ({ userId: u, level: LEVEL[u] })), recentEvents: () => ({ rows: [] }), FEED_KINDS: {} },
    Queue: { getNowPlaying: () => st.playing, getRotation: () => st.rotation, lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
             recentHistory: () => st.history, historyReach: () => st.reach, getState: () => ({ counts: st.counts }) },
    UserQueue: { items: () => st.mine.slice(), count: () => st.mine.length, slotState: () => null, isActive: () => false, stackCount: () => 0, add: () => ({ ok: true }) },
    Reactions: { hasSaved: () => false, hasVoted: () => false },
    Actions: { describe: () => ({ enabled: !!st.moderate, reason: st.moderate ? null : "Not permitted" }), perform: () => Promise.resolve({ ok: true }) },
    // ADDED at `ddjp_670` (PART T): what a part adds to open a DM conversation (`st.chat`). Nothing by default, as before.
    Chat: Object.assign({ conversations: () => (st.dms || []), dmUnreadCount: () => 0, setDMVisible: () => {} }, st.chat || {}),
    ChatPrefs: { layout: () => "wide", setLayout: () => {}, videoHidden: () => false, overlayBlocked: () => false },
    Playlists: { list: () => (st.playlist ? [{ id: st.playlist.id, name: st.playlist.name }] : []),
                 get: (id) => Promise.resolve(st.playlist && st.playlist.id === id ? JSON.parse(JSON.stringify(st.playlist)) : { id, name: "Mine", tracks: [] }),
                 // ADDED at `ddjp_670` (PART G): a playlist's link box adds through the feature, recorded here.
                 addTrackByUrl: (id, v) => { (st.addedByLink = st.addedByLink || []).push([id, v]); return Promise.resolve({ ok: true }); } },
    ServerClock: { serverNow: () => (st.serverNow ? st.serverNow() : NOW) },
    Store: { meta: { peek: (v) => ({ title: "Title " + v, durationSec: 200 }) } },
  };
  const w = S.world(Object.assign({ features }, wo || {}));
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  w.st = st;
  w.q = (sel, root) => (root || w.main).querySelector(sel);
  w.qa = (sel, root) => (root || w.main).querySelectorAll(sel);
  w.kids = (n) => (n ? n.children.filter((c) => c.nodeType === 1) : []);
  w.shown = (n) => w.cas.shown(n, w.main);
  w.decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
  w.rule = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.sel : null; };
  return w;
}
// A row's size, as the sheet declares it — what makes two rows the same size (no layout here: Chromium measured the pixels).
const SIZE = ["min-height", "padding", "border", "border-radius", "background", "font-size", "gap"];
const sizeOf = (w, n) => SIZE.map((p) => [p, w.decl(n, p)]);
// The height a row is DRAWN at (its content is smaller than it: Chromium measured them, the report). My queue's stack sets its
// rows border-box at its own height, inline (J130). A row the sheet alone sizes is its min-height when the page sizes it
// border-box — as it does every box (PART P) — and its min-height plus its padding and border twice if a rule made it
// content-box. Read, not assumed: a declaration this cannot read gives NaN, which equals nothing.
const px = (v) => (/^\d+(\.\d+)?px$/.test(String(v || "").trim()) ? parseFloat(v) : NaN);
function drawnH(w, n) {
  if (n.style && n.style.boxSizing === "border-box" && n.style.height) return px(n.style.height);
  const box = w.decl(n, "box-sizing");
  if (box === "border-box") return px(w.decl(n, "min-height"));
  const pad = String(w.decl(n, "padding") || "").trim().split(/\s+/), bw = /(\d+(?:\.\d+)?)px/.exec(String(w.decl(n, "border") || ""));
  if (box !== "content-box" || !bw) return NaN;
  return px(w.decl(n, "min-height")) + 2 * px(pad[0]) + 2 * parseFloat(bw[1]);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// My queue's rows: the size the room queue's and History's rows take.
function myQueueRow() {
  const w = screen();
  w.refs.tabMine.click();
  const r = w.qa(".song-row", w.refs.queueBody)[0] || null;
  return { w, r, size: r ? sizeOf(w, r) : null, box: r ? r.parent : null };
}

// ═══ PART P — the instrument: the page's stylesheet, read as a browser reads it ═══════════════════════════════════════
part("P", () => {
  const w = screen();
  const plain = w.main;   // a box no rule of the panel's names by class: only `*` sizes it
  const d = w.cas.declared(plain, "box-sizing");
  ok(d && d.val === "border-box" && d.sel === "*",
    "P PROBE — THE PAGE'S FIRST RULE IS READ: `* { box-sizing: border-box; }` sizes a plain box, as in a browser (the reader lost " +
    "it to the head's comment that mentions `<style>`, and every box read content-box)", d);
  const blocks = require("./_page-css.js").styleBlocks("<head><!-- a note about <style> blocks --><style>* { a: b; }</style></head>");
  ok(blocks.length === 1 && blocks[0] === "* { a: b; }", "P PROBE — and a comment that mentions `<style>` is skipped, as a browser skips it (the reader, driven)", blocks);
  // ADDED at the milestone close after `ddjp_658`: the reader's first fix stripped `<!--…-->` across the whole page, inside
  // `<style>` and `<script>` too, where a browser reads raw text — a `<!--` written inside a style rule deleted every real
  // rule up to the next `-->` (measured on the page: 600 rules read, 0 with one planted). Two more probes, both directions.
  const SB = require("./_page-css.js").styleBlocks;
  const inRule = SB("<style>.a::before { content: \"<!--\"; } .b { c: d; }</style><!-- a real comment --><style>.e { f: g; }</style>");
  ok(inRule.length === 2 && /\.b \{ c: d; \}/.test(inRule[0]) && inRule[1] === ".e { f: g; }",
    "P PROBE — A `<!--` INSIDE A STYLE RULE DROPS NO RULE: it is CSS text there, as a browser reads it", inRule);
  const inScript = SB("<script>const s = \"<style>.x { y: z; }</style>\";</script><style>.real { a: b; }</style>");
  ok(inScript.length === 1 && inScript[0] === ".real { a: b; }",
    "P PROBE — A `<style>` WRITTEN INSIDE A SCRIPT IS NOT A STYLE BLOCK: a script's text is raw, as a browser reads it", inScript);
});

// ═══ PART R — no other reader cuts the stylesheet out of index.html on its own ════════════════════════════════════════
// ADDED at the milestone close after `ddjp_658`. Three guards were found reading the page raw after `ddjp_656` moved four
// onto the reader (`check-message-row` F, G and M, `check-rank-faces` E, `check-people-tab` C): each read a rule written
// inside an HTML comment as one of the page's (measured — two false reds and one false green). So the sweep is DERIVED, over
// every `.js` under `tests/` and `tools/` (the probes included): a pattern that cuts a `<style>` element out (both its ends
// in it) is the reader's alone, and a pattern that splits ANY rule (a wildcard selector, `[^{}]`) is applied only to text
// that came through the reader. A pattern that pins ONE named rule in the raw page is out of its scope (the owner's brief):
// the page has that rule once, read either way, and only a page with a decoy in a comment tells the two readings apart —
// which is also why `check-message-row` G and `check-people-tab` C, moved onto the reader, have no break row here.
// Code only: comments and string literals are blanked first, so a pattern quoted in a break row or written in prose is not a
// pattern applied. An application's input is traced back through the file's own `const`/`let`/`var` names to where it was
// read: RAW when it reads "index.html" without `styleBlocks(` / `readSheet(` / `sheetReader(` on the way.
const fsR = require("fs"), pathR = require("path");
function jsCode(src) {   // comments blanked; strings kept aside by position; regex literals kept, with their bodies
  const out = src.split(""), strs = [], res = [];
  const KW = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  let i = 0, prev = "", word = "";
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "\"" || c === "'" || c === "`") {
      let j = i + 1; for (; j < src.length; j++) { if (src[j] === "\\") { j++; continue; } if (src[j] === c) break; }
      strs.push({ s: i, e: j + 1, v: src.slice(i + 1, j) }); blank(i + 1, j); i = j + 1; prev = c; word = ""; continue;
    }
    if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KW.test(word))) {
      let j = i + 1, cls = false;
      for (; j < src.length && src[j] !== "\n"; j++) {
        if (src[j] === "\\") { j++; continue; }
        if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; else if (src[j] === "/" && !cls) break;
      }
      if (src[j] === "/") { let k = j + 1; while (/[a-z]/.test(src[k] || "")) k++; res.push({ s: i, e: k, body: src.slice(i + 1, j) }); i = k; prev = "/"; word = ""; continue; }
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; word = src.slice(i, j); prev = "w"; i = j; continue; }
    prev = c; word = ""; i++;
  }
  return { code: out.join(""), strs, res };
}
function close(code, at, open, shut) { let d = 0; for (let k = at; k < code.length; k++) { if (code[k] === open) d++; else if (code[k] === shut && --d === 0) return k; } return -1; }
function openBack(code, at, open, shut) { let d = 0; for (let k = at; k >= 0; k--) { if (code[k] === shut) d++; else if (code[k] === open && --d === 0) return k; } return -1; }
// Every regex APPLIED: `x.match(/re/)`, `.matchAll`, `.replace`, `.replaceAll`, `.search`, `.split` (with a literal or `new
// RegExp(…)` first), and `/re/.test(x)`, `/re/.exec(x)`. Returns the pattern's text and the input's source range.
function applications(J) {
  const { code, strs, res } = J, apps = [];
  const strIn = (a, b) => strs.filter((t) => t.s >= a && t.e <= b).map((t) => t.v).join("");
  for (const m of code.matchAll(/\.(match|matchAll|replace|replaceAll|search|split)\s*\(/g)) {
    const argAt = m.index + m[0].length;
    let k = argAt; while (/\s/.test(code[k])) k++;
    let pat = null;
    const lit = res.find((r) => r.s === k);
    if (lit) pat = lit.body;
    else if (code.startsWith("new RegExp(", k)) { const e = close(code, k + 10, "(", ")"); pat = strIn(k, e); }
    if (pat === null) continue;
    let r = m.index - 1;                       // the input: back over `.name`, `(…)` and `[…]` to the chain's start
    for (;;) {
      while (r >= 0 && /\s/.test(code[r])) r--;
      if (code[r] === ")") { r = openBack(code, r, "(", ")") - 1; continue; }
      if (code[r] === "]") { r = openBack(code, r, "[", "]") - 1; continue; }
      if (/[\w$]/.test(code[r] || "")) { while (r >= 0 && /[\w$]/.test(code[r])) r--; let q = r; while (q >= 0 && /\s/.test(code[q])) q--; if (code[q] === ".") { r = q - 1; continue; } }
      break;
    }
    apps.push({ at: m.index, pat, from: r + 1, to: m.index });
  }
  for (const lit of res) {
    const m = /^\s*\.(test|exec)\s*\(/.exec(code.slice(lit.e, lit.e + 20));
    if (!m) continue;
    const a = lit.e + m[0].length - 1, e = close(code, a, "(", ")");
    apps.push({ at: lit.s, pat: lit.body, from: a + 1, to: e });
  }
  return apps;
}
const READER = /\b(styleBlocks|readSheet|sheetReader)\s*\(/;
function provenance(J, from, to, seen) {   // "raw" | "reader" | "other", traced through the file's own names
  const { code, strs } = J, text = code.slice(from, to);
  if (READER.test(text)) return "reader";
  if (strs.some((t) => t.s >= from && t.e <= to && /(^|\/)index\.html$/.test(t.v))) return "raw";
  for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g) || [])) {
    if (seen.has(id + "@" + from)) continue; seen.add(id + "@" + from);
    // The NEAREST declaration of the name before this use: a guard declares `css` once per block, and the first in the
    // file is another block's (found by break row RS9, which stayed green on the first's answer). A declaration can follow a
    // comma (`const shell = …, css = read("index.html")`), and an initializer ends at a comma as well as a `;` (found on
    // `check-player-cover`, whose `css` this missed while its `shell` read as the page).
    let d = null;
    for (const m of code.matchAll(new RegExp("(?:\\b(?:const|let|var)\\s+|,\\s*)" + id.replace(/\$/g, "\\$") + "\\s*=(?!=)", "g"))) { if (m.index < from) d = m; else break; }
    if (!d) continue;
    let e = d.index + d[0].length, depth = 0;
    for (; e < code.length; e++) { const c = code[e]; if ("([{".includes(c)) depth++; else if (")]}".includes(c)) { if (--depth < 0) break; } else if ((c === ";" || c === "\n" || c === ",") && depth === 0) break; }
    const p = provenance(J, d.index + d[0].length, e, seen);
    if (p !== "other") return p;
  }
  return "other";
}
function sweep(files, read) {
  const found = { cut: [], split: [], pins: [], apps: 0, appsIn: {} };
  for (const f of files) {
    const J = jsCode(read(f));
    for (const a of applications(J)) {
      found.apps++; const dir = f.replace(/\/[^/]*$/, ""); found.appsIn[dir] = (found.appsIn[dir] || 0) + 1;
      const where = f + ":" + (J.code.slice(0, a.at).split("\n").length);
      const prov = provenance(J, a.from, a.to, new Set());
      const ruleShaped = /\\\{|\\\\\{/.test(a.pat);
      if (/<style/i.test(a.pat) && /<\\?\/style/i.test(a.pat)) found.cut.push(where);   // both ends: an element cut out
      else if (/\[\^\{\}\]/.test(a.pat) && ruleShaped && prov === "raw") found.split.push(where);
      else if (ruleShaped && prov === "raw") found.pins.push(where);   // one named rule, raw: listed, out of scope
    }
  }
  return found;
}
part("R", () => {
  // THE INSTRUMENT FIRST, BOTH WAYS, on a fixture whose answer is known: what is applied is found, what is quoted or commented
  // is not, and an input is traced through two names to the page or to the reader.
  const FIX = {
    "a.js": "const html = fs.readFileSync(p, \"index.html\");\nconst css = html;\n// css.replace(/([^{}]+)\\{([^{}]*)\\}/g, f);\n" +
            "const quoted = \"x.match(/<style[^>]*>/)\";\nfor (const m of css.matchAll(/([^{}]+)\\{([^{}]*)\\}/g)) n++;\n",
    "b.js": "const { styleBlocks } = require(\"./_page-css.js\");\nconst t = styleBlocks(read(\"index.html\")).join(\"\\n\");\n" +
            "t.replace(/([^{}]+)\\{([^{}]*)\\}/g, f);\nconst raw = read(\"index.html\");\nok(/\\.x \\{[^}]*y/.test(raw));\n",
    "d.js": "{ const css = styleBlocks(read(\"index.html\")).join(\"\\n\"); n = css.length; }\n" +
            "{ const css = read(\"index.html\"); css.replace(/([^{}]+)\\{([^{}]*)\\}/g, f); }\n",
    "e.js": "const page = read(\"index.html\"), other = read(\"x.js\");\nother.replace(/([^{}]+)\\{([^{}]*)\\}/g, f);\n" +
            "const a = 1, sheet = read(\"index.html\");\nsheet.replace(/([^{}]+)\\{([^{}]*)\\}/g, f);\n",
    "c.js": "const page = read(\"index.html\");\nconst r = (page.match(/\\.only \\{([^}]*)\\}/) || [])[1];\nconst s = page.match(/<style[^>]*>([\\s\\S]*?)<\\/style>/);\n",
  };
  const fx = sweep(Object.keys(FIX), (f) => FIX[f]);
  ok(fx.apps === 8 && fx.split.join() === "a.js:5,d.js:2,e.js:4" && fx.pins.join() === "b.js:5,c.js:2" && fx.cut.join() === "c.js:3",
    "R PROBE — THE SWEEP, ON A FIXTURE WITH A KNOWN ANSWER: an applied rule splitter on the raw page found through two names, a " +
    "quoted and a commented one not; a reader-fed one passed; a name declared again in a later block traced to its nearest " +
    "declaration; a name declared after a comma traced to its own initializer; the raw single-rule pins told apart from it; a " +
    "`<style>` cut found", fx);
  // THE POPULATION, DERIVED: every .js under tests/ and tools/, but the reader itself.
  const ROOTR = pathR.join(__dirname, "..");
  const files = [];
  (function walk(d) { for (const n of fsR.readdirSync(pathR.join(ROOTR, d))) { if (n === "node_modules") continue; const r = d + "/" + n;
    const st = fsR.statSync(pathR.join(ROOTR, r)); if (st.isDirectory()) walk(r); else if (/\.js$/.test(n) && r !== "tests/_page-css.js") files.push(r); } })("tests");
  (function walk(d) { for (const n of fsR.readdirSync(pathR.join(ROOTR, d))) { const r = d + "/" + n;
    const st = fsR.statSync(pathR.join(ROOTR, r)); if (st.isDirectory()) walk(r); else if (/\.js$/.test(n)) files.push(r); } })("tools");
  const found = sweep(files, (f) => fsR.readFileSync(pathR.join(ROOTR, f), "utf8"));
  ok(["tests", "tools", "tools/probes"].every((d) => found.appsIn[d] > 0) && files.some((f) => /^tests\/check-/.test(f)),
    "R PREMISE — the sweep read tests/, tools/ and tools/probes/, and found regexes applied in each", { files: files.length, appsIn: found.appsIn });
  ok(found.cut.length === 0 && found.split.length === 0,
    "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN — a `<style>` cut is the reader's alone, and every rule splitter reads the reader's text",
    { cut: found.cut, split: found.split });
});

// ═══ PART A — the room queue ══════════════════════════════════════════════════════════════════════════════════════
part("A", () => {
  const mq = myQueueRow();
  ok(mq.r && mq.size && drawnH(mq.w, mq.r) > 0, "A PREMISE — My queue drew its rows, at a height this can read", mq.r && [mq.size, drawnH(mq.w, mq.r)]);
  const w = screen();
  w.refs.tabRoom.click();
  const qb = w.refs.queueBody;
  const rows = w.qa(".song-row", qb);
  ok(rows.length === 4, "A PREMISE — Now Playing and the three waiting DJs were drawn", rows.length);
  const head = w.q(".rq-np-head", qb);
  const kids = w.kids(qb);
  ok(head && kids[0] === head, "A: THE LINE ABOVE THE LIST COMES FIRST", kids.map((c) => c.className));
  const reset = head ? w.kids(head).find((c) => /\brq-reset\b/.test(c.className)) : null;
  const tag = head ? w.q(".rq-np-tag", head) : null, lock = head ? w.q(".panel-lock-btn", head) : null;
  ok(reset && tag && lock && tag.textContent === "Now Playing" && w.kids(head).indexOf(reset) < w.kids(head).indexOf(tag) && w.kids(head).slice(-1)[0] === lock,
    "A: IT KEEPS RESET, THE \"NOW PLAYING\" TAG AND THE LOCK — Reset left of the tag, the lock at the far right", head && w.kids(head).map((c) => c.className + ":" + c.textContent));
  ok(head && !w.q(".who", head) && !/\bdj\b/.test(head.textContent), "A: AND NO DJ — the DJ's name moved to the Now Playing row", head && head.textContent);
  const list = kids[1] || null;
  ok(list && w.kids(list).length === 4 && w.kids(list).every((c) => /\bsong-row\b/.test(c.className)) && rows.every((r) => r.parent === list),
    "A: ONE LIST — every row, Now Playing first, in one block directly under the line, as My queue's", list && { cls: list.className, kids: w.kids(list).map((c) => c.className) });
  ok(!w.q(".rq-group", qb), "A: THE BOX AROUND NOW PLAYING IS GONE", w.q(".rq-group", qb) && w.q(".rq-group", qb).className);
  ok(list && (w.decl(list, "gap") === null || /^0(px)?$/.test(w.decl(list, "gap"))) && (w.decl(mq.box, "gap") === null || /^0(px)?$/.test(w.decl(mq.box, "gap"))),
    "A: THE ROWS ARE TOGETHER — no gap between them, as between My queue's", list && { list: w.decl(list, "gap"), mine: w.decl(mq.box, "gap") });
  const np = list ? w.kids(list)[0] : null;
  ok(np && /\bplaying\b/.test(np.className), "A PREMISE — the first row is the playing one", np && np.className);
  const pos = np ? w.q(".sr-pos", np) : null, sub = np ? w.q(".sr-when", np) : null;
  ok(pos && pos.textContent === "▶", "A: NOW PLAYING HAS ▶ WHERE THE NUMBER GOES", pos && pos.textContent);
  ok(sub && sub.textContent === "dj" && sub.style.color === w.H.rankColor(w.H._rosterLevel("@dj:hs")) && w.H.rankColor(60) !== w.H.rankColor(20),
    "A: THE DJ IS ON ITS SUB LINE, IN THE DJ'S COLOUR", sub && { text: sub.textContent, color: sub.style.color, want: w.H.rankColor(w.H._rosterLevel("@dj:hs")) });
  ok(np && w.q(".np-react.grab", np) && w.q(".np-react.upvote", np), "A: AND ITS ★ AND ▲", np && w.kids(w.q(".uq-actions", np)).map((c) => c.className));
  ok(np && /^#5865f2$/i.test(String(w.decl(np, "border-color") || "")), "A: THE BLUE EDGE MARKS IT, as the box's did", np && [w.decl(np, "border-color"), w.rule(np, "border-color")]);
  const waits = list ? w.kids(list).slice(1) : [];
  ok(same(waits.map((r) => (w.q(".sr-pos", r) || {}).textContent), ["2.", "3.", "4."]), "A: THE WAITING SONGS ARE NUMBERED ON FROM IT — 2, 3, 4", waits.map((r) => (w.q(".sr-pos", r) || {}).textContent));
  ok(same(waits.map((r) => (w.q(".sr-when", r) || {}).textContent), ["ann", "bob", "cat"]) && waits.every((r, i) => w.q(".sr-when", r).style.color === w.H.rankColor(w.H._rosterLevel(w.st.rotation[i].user))),
    "A: each with its DJ on the sub line, in the DJ's colour, as before", waits.map((r) => w.q(".sr-when", r) && [w.q(".sr-when", r).textContent, w.q(".sr-when", r).style.color]));
  ok(mq.size && rows.every((r) => same(sizeOf(w, r), mq.size)),
    "A: EVERY ROW IS MY QUEUE'S ROW, AT ITS SIZE — Now Playing included (the sheet's sizing declarations, each one)",
    { mine: mq.size, room: rows.map((r) => sizeOf(w, r)).filter((s) => !same(s, mq.size)).slice(0, 2) });
  ok(rows.every((r) => drawnH(w, r) === drawnH(mq.w, mq.r)), "A: AND DRAWN AT ITS HEIGHT — every row as tall as My queue's",
    { mine: drawnH(mq.w, mq.r), room: rows.map((r) => drawnH(w, r)) });
  // NOTHING PLAYING.
  const w2 = screen({ playing: null });
  w2.refs.tabRoom.click();
  const qb2 = w2.refs.queueBody;
  const head2 = w2.q(".rq-np-head", qb2), list2 = w2.kids(qb2)[1] || null;
  const tag2 = head2 ? w2.q(".rq-np-tag", head2) : null;
  ok(head2 && w2.kids(qb2)[0] === head2 && tag2 && tag2.textContent === "Nothing playing", "A: NOTHING PLAYING — the line says so, in the tag's place", head2 && head2.textContent);
  const empty = list2 ? w2.kids(list2)[0] : null;
  // CHANGED ON PURPOSE (`ddjp_677`; the owner at `ddjp_674`, his words and his choice of option 1 in `main/04-features.md`
  // §DJ rotation): the first row was an empty box — no picture, no title, no ★ or ▲ (his decision at `ddjp_638`). It is an
  // empty play row now: the playing row's shape — the picture's square, empty; ▶ where the number goes; no title and no DJ
  // line; ★ and ▲ in their places, greyed and not usable, with no numbers. The size row below is kept as it was.
  ok(empty && /\brq-np-empty\b/.test(empty.className) && /\bsong-row\b/.test(empty.className) && !/\bplaying\b/.test(empty.className) && w2.kids(list2).length === 4,
    "A: AND THE LIST'S FIRST ROW IS THE EMPTY PLAY ROW, above the three waiting", list2 && w2.kids(list2).map((c) => c.className));
  const partsOf = (ww, r) => (r ? ww.kids(r).map((c) => c.className.split(/\s+/)[0]) : null);
  ok(empty && np && same(partsOf(w2, empty), ["thumb-slot", "sr-pos", "sr-main", "uq-actions"]) && same(partsOf(w2, empty), partsOf(w, np)),
    "A: THE EMPTY PLAY ROW IS THE PLAYING ROW'S SHAPE — the picture's square, the number's place, the line's place, the buttons, in its order",
    { empty: partsOf(w2, empty), playing: partsOf(w, np) });
  // The ♪ the sheet draws in a picture square is a `::before`, which the cascade here does not apply: read off the page's own
  // sheet instead — every `::before` rule with a `content`, the one of highest specificity that matches the square winning.
  const beforeContent = (ww, n) => {
    let best = null;
    for (const r of S.readSheet(require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8"))) {
      if (!/::before$/.test(r.sel) || !r.decls.content) continue;
      const base = r.sel.replace(/::before$/, "");
      if (!n.matches(base)) continue;
      const spec = S.readSheet("<style>" + base + " { x: y; }</style>")[0].spec;
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) best = { val: r.decls.content.val, sel: r.sel, spec, order: r.order };
    }
    return best;
  };
  const pic = empty ? w2.q(".thumb-slot", empty) : null, npPic = np ? w.q(".thumb-slot", np) : null;
  const picC = pic ? beforeContent(w2, pic) : null, npPicC = npPic ? beforeContent(w, npPic) : null;
  ok(npPicC && /^"/.test(npPicC.val), "A PREMISE — the playing row's picture square draws its ♪ (a `::before` with a quoted `content`), so its absence below is a reading", npPicC);
  ok(pic && w2.kids(pic).length === 0 && !pic.getAttribute("role") && !pic.getAttribute("tabindex") && typeof pic.onclick !== "function" && typeof pic.onkeydown !== "function" &&
     picC && picC.val === "none" && w2.decl(pic, "cursor") !== "pointer" && w2.decl(pic, "width") === w.decl(npPic, "width") && w2.decl(pic, "height") === w.decl(npPic, "height"),
    "A: ITS PICTURE IS AN EMPTY SQUARE — the playing row's size, no ♪, no picture, and no preview click (no role, no key, no handler, no pointer)",
    pic && { kids: w2.kids(pic).length, role: pic.getAttribute("role"), before: picC, cursor: w2.decl(pic, "cursor"), size: [w2.decl(pic, "width"), w2.decl(pic, "height")] });
  const epos = empty ? w2.q(".sr-pos", empty) : null, wpos = list2 ? w2.q(".sr-pos", w2.kids(list2)[1]) : null;
  ok(epos && epos.textContent === "▶" && w2.decl(epos, "color") && w2.decl(epos, "color") === w2.decl(wpos, "color") && !epos.style.color,
    "A: ▶ WHERE THE NUMBER GOES, IN THE NUMBER'S GREY — the waiting rows' numbers' colour, the sheet's", epos && { text: epos.textContent, color: w2.decl(epos, "color"), number: wpos && w2.decl(wpos, "color") });
  ok(empty && !!w2.q(".sr-main", empty) && !w2.q(".sr-title", empty) && !w2.q(".sr-sub", empty) && !w2.q(".sr-when", empty) && w2.kids(w2.q(".sr-main", empty)).length === 0,
    "A: NO TITLE AND NO DJ LINE — the line's place is there, empty", empty && w2.q(".sr-main", empty) && w2.kids(w2.q(".sr-main", empty)).map((c) => c.className));
  const ebtn = empty ? w2.kids(w2.q(".uq-actions", empty)) : [], pbtn = np ? w.kids(w.q(".uq-actions", np)) : [];
  const btnShape = (ww, b) => [b.className, ww.kids(b).map((c) => c.className.split(/\s+/)[0] + ":" + c.textContent)];
  ok(ebtn.length === 2 && /\bnp-react\b/.test(ebtn[0].className) && /\bgrab\b/.test(ebtn[0].className) && /\bnp-react\b/.test(ebtn[1].className) && /\bupvote\b/.test(ebtn[1].className) &&
     same(pbtn.map((b) => b.className), ebtn.map((b) => b.className)),
    "A: ★ AND ▲ SIT IN THEIR PLACES — the playing row's two buttons, ★ then ▲, by the same classes", { empty: ebtn.map((b) => btnShape(w2, b)), playing: pbtn.map((b) => btnShape(w, b)) });
  ok(ebtn.length === 2 && ebtn.every((b) => !w2.q(".np-count", b) && !/\d/.test(b.textContent) && w2.kids(b).length === 1 && /\bnp-ico\b/.test(w2.kids(b)[0].className)) &&
     ebtn[0].textContent === "☆" && ebtn[1].textContent === "▲",
    "A: WITH NO NUMBERS — each only its glyph (☆, ▲), no count beside it, not even 0", ebtn.map((b) => btnShape(w2, b)));
  ok(ebtn.length === 2 && ebtn.every((b) => b.disabled === true && w2.decl(b, "opacity") !== null && w2.rule(b, "opacity") === ".mini:disabled" && w2.decl(b, "opacity") !== w.decl(pbtn[0], "opacity")),
    "A: GREYED AS THE SHEET GREYS A DISABLED BUTTON — disabled, so `.mini:disabled` draws it (its opacity, not the playing row's)",
    ebtn.map((b) => ({ disabled: b.disabled, opacity: w2.decl(b, "opacity"), rule: w2.rule(b, "opacity") })));
  const performed = [];
  w2.sb.Actions.perform = (a) => { performed.push(a); return Promise.resolve({ ok: true }); };
  const nodesNow = () => w2.qa("*", w2.doc.body).length;
  const n0 = nodesNow();
  for (const b of ebtn) b.click();
  if (pic) pic.click();
  ok(ebtn.length === 2 && ebtn.every((b) => typeof b.onclick !== "function") && performed.length === 0 && nodesNow() === n0,
    "A: A CLICK DOES NOTHING — no handler on either button, and clicking them and the picture sends nothing and opens nothing",
    { handlers: ebtn.map((b) => typeof b.onclick), performed, nodes: [n0, nodesNow()] });
  ok(empty && w2.decl(empty, "border-color") === w2.decl(w2.kids(list2)[1], "border-color") && !/^#5865f2$/i.test(String(w2.decl(empty, "border-color") || "")) && /^#5865f2$/i.test(String(w.decl(np, "border-color") || "")),
    "A: ITS EDGE STAYS GREY — the waiting rows' edge; blue stays the mark of a song playing (the owner, `ddjp_646`)",
    empty && { empty: w2.decl(empty, "border-color"), waiting: w2.decl(w2.kids(list2)[1], "border-color"), playing: w.decl(np, "border-color") });
  ok(empty && np && same(sizeOf(w2, empty), sizeOf(w, np)), "A: THE EMPTY ROW IS THE PLAYING ROW'S SIZE — nothing below moves when a song starts or ends",
    { empty: empty && sizeOf(w2, empty), playing: np && sizeOf(w, np) });
  ok(empty && np && drawnH(w2, empty) === drawnH(w, np) && drawnH(w, np) === 48, "A: AND DRAWN AT ITS HEIGHT — 48 px, as the playing row", { empty: empty && drawnH(w2, empty), playing: np && drawnH(w, np) });
  // THE REUSED BUILDERS LEAVE THE OTHERS AS THEY WERE: the playing row's ★ and ▲ — counts, glyphs, handlers, live — and the
  // Player's own two (`ui/shell.js`, kept in step by `_syncNpButtons`), with a song and with none.
  const npB = np ? w.kids(w.q(".uq-actions", np)) : [];
  ok(npB.length === 2 && same(npB.map((b) => btnShape(w, b)), [["mini ico grab np-react", ["np-ico:☆", "np-count:1"]], ["mini ico upvote np-react", ["np-ico:▲", "np-count:3"]]]) &&
     npB.every((b) => b.disabled !== true) && npB[0].onclick === w.sb.ChatPanels._onStarPress && npB[1].onclick === w.sb.ChatPanels._onVotePress &&
     npB[0].title === "Save this song" && npB[1].title === "Upvote this song",
    "A: THE PLAYING ROW'S ★ AND ▲ ARE AS THEY WERE — their glyphs and counts, live, wired to the same handlers, the same titles",
    npB.map((b) => [btnShape(w, b), b.disabled, b.title]));
  const player = (ww) => { ww.sb.ChatPanels._syncNpButtons(); return [ww.refs.grabBtn, ww.refs.upvoteBtn].map((b) => [b.className, ww.kids(b).map((c) => c.textContent), b.disabled, b.title, b.onclick === (b === ww.refs.grabBtn ? ww.sb.ChatPanels._onStarPress : ww.sb.ChatPanels._onVotePress)]); };
  ok(same(player(w), [["mini ico grab np-react", ["☆", "1"], false, "Save this song", true], ["mini ico upvote np-react", ["▲", "3"], false, "Upvote this song", true]]) &&
     same(player(w2), [["mini ico grab np-react", ["☆", "0"], true, "Save to playlist (nothing playing)", true], ["mini ico upvote np-react", ["▲", "0"], true, "Upvote (nothing playing)", true]]),
    "A: AND THE PLAYER'S OWN ★ AND ▲ ARE AS THEY WERE — with a song, its counts, live; with none, \"0\" and disabled, as always (not the room queue's row)",
    { playing: player(w), nothing: player(w2) });
  ok(list2 && same(w2.kids(list2).slice(1).map((r) => (w2.q(".sr-pos", r) || {}).textContent), ["2.", "3.", "4."]), "A: and the waiting songs keep their numbers",
    list2 && w2.kids(list2).slice(1).map((r) => (w2.q(".sr-pos", r) || {}).textContent));
  // A viewer who cannot moderate: the line keeps the tag, the list the same rows; no lock, no Reset.
  const w3 = screen({ moderate: false });
  w3.refs.tabRoom.click();
  const qb3 = w3.refs.queueBody, head3 = w3.q(".rq-np-head", qb3);
  ok(head3 && w3.kids(qb3)[0] === head3 && !w3.q(".panel-lock-btn", head3) && !w3.q(".rq-reset", head3) && w3.qa(".song-row", qb3).length === 4,
    "A: A VIEWER WHO CANNOT MODERATE — the line with only the tag, and the same list", head3 && head3.textContent);
  ok(head3 && head && w3.decl(head3, "min-height") !== null && w3.decl(head3, "min-height") === w.decl(lock, "height"),
    "A: THE LINE KEEPS THE LOCK'S HEIGHT WITHOUT IT, so the list starts at the same place for every viewer", head3 && [w3.decl(head3, "min-height"), w.decl(lock, "height")]);
});

// ═══ PART B — History ═════════════════════════════════════════════════════════════════════════════════════════════
part("B", () => {
  const mq = myQueueRow();
  const w = screen();
  w.refs.tabHistory.click();
  const qb = w.refs.queueBody;
  const rows = w.qa(".song-row", qb);
  ok(rows.length === 3, "B PREMISE — the three played songs were drawn", rows.length);
  const list = rows[0] ? rows[0].parent : null;
  ok(list && list !== qb && rows.every((r) => r.parent === list) && w.kids(list).length === 3 && w.kids(qb).indexOf(list) >= 0,
    "B: ONE LIST — every row in one block, as My queue's", list && { cls: list.className, kids: w.kids(qb).map((c) => c.className) });
  ok(list && (w.decl(list, "gap") === null || /^0(px)?$/.test(w.decl(list, "gap"))), "B: THE ROWS ARE TOGETHER — no gap between them", list && w.decl(list, "gap"));
  ok(mq.size && rows.every((r) => same(sizeOf(w, r), mq.size)), "B: EVERY ROW IS MY QUEUE'S ROW, AT ITS SIZE", { mine: mq.size, history: rows.map((r) => sizeOf(w, r)) });
  ok(rows.every((r) => drawnH(w, r) === drawnH(mq.w, mq.r)), "B: AND DRAWN AT ITS HEIGHT", { mine: drawnH(mq.w, mq.r), history: rows.map((r) => drawnH(w, r)) });
  // The sub line: who, how long ago, then "skipped" (or "Sys Skip"), each its own element; the ▲ and ★ counts in their spot.
  // CHANGED ON PURPOSE (`ddjp_667`, the owner's design for History's row on a phone, `main/04-features.md` §Room History):
  // the room's word is "Sys Skip", where it was "Sys Skipped", and the ▲ and ★ counts left the line for a spot of their own
  // left of the ＋ (PART F holds the spot and the fit) — so the line reads the name, the age and the word, and the counts are
  // read where they are now. CHANGED ON PURPOSE AGAIN (`ddjp_677`; the owner at `ddjp_674`, "i think we can display them always
  // but say 0 if nothing", `main/04-features.md` §Room History): both on every row, 0 where there are none — where each was
  // drawn only where it was not zero.
  const sub = (r) => w.q(".sr-sub", r);
  const skip = rows.map((r) => w.q(".hist-skip", r)), votes = rows.map((r) => w.q(".hist-votes", r)), saves = rows.map((r) => w.q(".hist-saves", r));
  ok(skip[0] && skip[0].textContent === "skipped" && !skip[1] && skip[2] && skip[2].textContent === "Sys Skip" && /\bskipped\b/.test(sub(rows[0]).textContent),
    "B: \"SKIPPED\" (\"SYS SKIP\" FOR THE ROOM'S SKIP) IS ITS OWN ELEMENT, on the rows that were cut short and no other", rows.map((r) => sub(r) && sub(r).textContent));
  ok(same(votes.map((n) => n && n.textContent), ["▲ 2", "▲ 4", "▲ 0"]) && same(saves.map((n) => n && n.textContent), ["★ 1", "★ 0", "★ 0"]),
    "B: SO ARE THE ▲ AND ★ COUNTS — both on every row, 0 where there are none, in the words the line said them in before", rows.map((r) => [votes[rows.indexOf(r)] && votes[rows.indexOf(r)].textContent, saves[rows.indexOf(r)] && saves[rows.indexOf(r)].textContent]));
  ok(rows.map((r) => sub(r).textContent).join("|") === "ann1 min ago · skipped|bob6 mins ago|cat12 mins ago · Sys Skip",
    "B: THE LINE READS AS IT DID, LESS THE COUNTS — the same words in the same order, \"Sys Skip\" for the room's skip", rows.map((r) => sub(r).textContent));
  // THE COLOURS: each read off what it must match, in this world's own sheet.
  const MOD = "chat-feed chat-feed-mod";
  const feedRow = w.sb.ChatPanels._feedRow({ eventId: "$x", sender: "@ann:hs", verb: "skipped a song", moderation: true });
  w.main.appendChild(feedRow);
  const verb = w.q(".chat-feed-verb", feedRow);
  ok(feedRow && feedRow.className === MOD && verb, "B PREMISE — chat's own row for a moderation event was built here, to read its colour", feedRow && feedRow.className);
  const modc = verb ? w.decl(verb, "color") : null;
  // AND THE ROOM'S WORD TOO (J131's correction, `ddjp_663`, the owner: "it can be thiel in history but say sys skipped"; the
  // word is "Sys Skip" since `ddjp_667`, his: "also system skipped news to say Sys Skip to be not far from Skipped").
  ok(skip[0] && skip[2] && modc && w.decl(skip[0], "color") === modc && w.decl(skip[2], "color") === modc && w.decl(skip[0], "color") !== w.decl(sub(rows[0]), "color"),
    "B: \"SKIPPED\" IS THE MODERATION COLOUR — the colour a moderation event's words take in chat (the owner, `ddjp_654`; teal at `ddjp_658`)", skip[0] && { skipped: w.decl(skip[0], "color"), modc, line: w.decl(sub(rows[0]), "color") });
  // The ▲ and ★ buttons, as the screen builds them, and the colour each gives its own count.
  w.refs.tabRoom.click();
  const npRow = w.q(".song-row.playing", w.refs.queueBody);
  const upCount = npRow ? w.q(".np-react.upvote .np-count", npRow) : null, starCount = npRow ? w.q(".np-react.grab .np-count", npRow) : null;
  ok(upCount && starCount && w.decl(upCount, "color") && w.decl(starCount, "color"), "B PREMISE — the ▲ and ★ buttons were built, each count with its colour",
    upCount && starCount && [w.decl(upCount, "color"), w.decl(starCount, "color")]);
  ok(votes[0] && upCount && w.decl(votes[0], "color") === w.decl(upCount, "color"), "B: THE ▲ COUNT IS THE ▲ BUTTON'S OWN COUNT COLOUR (the owner: \"the color the button to do so use\"; bright)",
    votes[0] && upCount && [w.decl(votes[0], "color"), w.decl(upCount, "color")]);
  ok(saves[0] && starCount && w.decl(saves[0], "color") === w.decl(starCount, "color"), "B: THE ★ COUNT IS THE ★ BUTTON'S OWN COUNT COLOUR",
    saves[0] && starCount && [w.decl(saves[0], "color"), w.decl(starCount, "color")]);
  ok([skip[0], votes[0], saves[0]].every((n) => n && !n.style.color), "B: EACH COLOUR IS THE STYLESHEET'S — none set inline", [skip[0], votes[0], saves[0]].map((n) => n && n.style.color));
});

// ═══ PART C — the phone ═══════════════════════════════════════════════════════════════════════════════════════════
part("C", () => {
  const w = screen({ innerWidth: 390 });
  w.H._setLayout("phone");
  const cols = w.q(".columns");
  const col = cols ? w.kids(cols).find((c) => /\bcolumn-left\b/.test(c.className)) : null;
  ok(cols && cols.getAttribute("data-layout") === "phone" && col, "C PREMISE — the phone layout is on, and the queues column is there", cols && cols.getAttribute("data-layout"));
  ok(cols && w.decl(cols, "box-sizing") === "border-box" && w.decl(cols, "width") === "100%" && w.decl(cols, "padding") !== null,
    "C: THE PHONE FRAME IS SIZED BORDER-BOX — its padding falls inside the screen's width, not past it", cols && [w.decl(cols, "box-sizing"), w.decl(cols, "width"), w.decl(cols, "padding")]);
  ok(col && w.decl(col, "box-sizing") === "border-box" && w.decl(col, "width") === "100%",
    "C: AND SO IS EACH COLUMN — its padding and border inside its 100%", col && [w.decl(col, "box-sizing"), w.decl(col, "width")]);
  // CORRECTED AT `ddjp_656`: J131 measured the phone 34 px too wide through the reader PART P corrects — in a browser it fit
  // (measured again, 653 to 655: page width = screen width at 360 and 390) — and added a phone rule for it. The rule that sizes
  // them is the page's own first rule, and no phone rule repeats it.
  ok(cols && col && w.rule(cols, "box-sizing") === "*" && w.rule(col, "box-sizing") === "*",
    "C: BY THE PAGE'S FIRST RULE, AS EVERY BOX — no phone rule of their own (J131's, for an overflow only the instrument saw, is gone)",
    cols && col && [w.rule(cols, "box-sizing"), w.rule(col, "box-sizing")]);
});

// ═══ PART F — History's row on every screen: the counts' spot, and a line that fits ═══════════════════════════════════
// ADDED at `ddjp_667`. The owner's report: on a phone History's ★ count could not be seen — the ▲ and ★ counts sat at the end
// of one grey line cut with "…" ("inspector-gm · 3 days ago · skipped · ▲ 1 ·…"). His design (`main/04-features.md` §Room
// History): the counts in a spot of their own left of the ＋, one width on every row and kept on a row with none — and the
// line, name · age · skipped (or Sys Skip), giving way only as far as needed: the age's short form with "ago", then its
// shortest, and only then the name's end; "skipped" and "Sys Skip" never cut, the long words back when room comes back, every
// age tick keeping each row's form; the DM list's times and the other lists as they were. CHANGED AT `ddjp_677` (the owner at
// `ddjp_674`): the spot is one line, ▲ in its left half and ★ in its right, each centred, both on every row with 0 where there
// are none and 99 over 99, as wide as "▲ 99 ★ 99" needs — where ▲ sat on its top line and ★ on its bottom, each only where it
// was not zero, wide enough for three digits.
//
// A LAYOUT, MODELLED — AND SAID SO. The harness lays nothing out, so where a line's boxes fall is a model (`lineModel`, the
// boxes' `getBoundingClientRect`, which the fit reads): a character is CH px (CH_BOLD in a bold box), plus the separators the
// page's own sheet draws in `::before`/`::after`, laid end to end, and a box shrinks only where that sheet lets it (a flex
// line, the box's `flex` shrinking, `min-width: 0`, `overflow: hidden`). Monotone, and read off the real stylesheet on every
// question the fit asks, which is what the order needs; the pixels were measured in Chromium on the page itself (the report). The fit is driven through its real triggers: the History tab's render, the list's
// ResizeObserver (a recording double — the browser's cannot run here) and the age tick on the world's clock.
const fsF = require("fs"), pathF = require("path");
const CH = 6, CH_BOLD = 6.5;
const textW = (t, bold) => String(t || "").length * (bold ? CH_BOLD : CH);
// The separators the page draws itself: each `::before` / `::after` rule with a quoted `content`, by the box it hangs on.
const PSEUDO = S.readSheet(fsF.readFileSync(pathF.join(__dirname, "..", "index.html"), "utf8"))
  .filter((r) => /::(before|after)$/.test(r.sel) && r.decls.content && /^"[^"]*"$/.test(r.decls.content.val))
  .map((r) => ({ sel: r.sel, base: r.sel.replace(/::(before|after)$/, ""), text: r.decls.content.val.slice(1, -1) }));
// CHANGED ON PURPOSE (`ddjp_677`): the spot holds "▲ 99" and "★ 99" side by side, where it held "★ 999" above "▲ 999" (the
// owner at `ddjp_674`: "99 = max displayed"). Their widths at the spot's 11 px, as Chromium draws them with the page's font
// (Arial, which Liberation Sans stands in for metric for metric; measured at `ddjp_677`, the report): each half holds the wider
// with EDGE_PX at least on either side, so the two never touch each other or the spot's edge.
const UP99_PX = 26.19, STAR99_PX = 26.8, EDGE_PX = 2;
function resizeObservers() {   // a recording ResizeObserver: what it observes, and its callback to call when a width changes
  const made = [];
  function RO(cb) { const ro = { cb, on: [], observe(t) { ro.on.push(t); }, unobserve() {}, disconnect() { ro.on = []; } }; made.push(ro); return ro; }
  RO.made = made;
  return RO;
}
function lineModel(w) {
  const LINE = { w: 1000 };
  // What the sheet says of a box depends on its classes and its line's (every History row is built alike), so it is read
  // once per pair and kept: the sweeps below ask it thousands of times.
  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
  const isFlexLine = (sub) => once("line|" + sub.className, () => String(w.decl(sub, "display") || "") === "flex");
  const mayShrink = (c, sub) => {
    if (c.nodeType !== 1 || !isFlexLine(sub)) return false;   // an inline box never shrinks: its line is cut at the end
    return once("shrink|" + c.className + "|" + sub.className, () => {
      const f = String(w.decl(c, "flex") || "").trim().split(/\s+/);
      const shrink = f[0] === "none" ? 0 : (f.length >= 2 ? Number(f[1]) : 1);
      return shrink > 0 && w.decl(c, "min-width") === "0" && w.decl(c, "overflow") === "hidden";
    });
  };
  const natural = (c) => {
    if (c.nodeType === 3) return textW(c.textContent);
    const bold = once("bold|" + c.className, () => /^(600|700|bold)$/.test(String(w.decl(c, "font-weight") || "")));
    const extra = once("pseudo|" + c.className, () => PSEUDO.filter((ps) => c.matches(ps.base)).reduce((a, ps) => a + textW(ps.text), 0));
    return textW(c.textContent, bold) + extra;
  };
  // The line laid out: its boxes end to end from 0, a shrinking box given what the others leave (never less than nothing).
  const boxes = (sub) => {
    let fixed = 0, give = 0;
    for (const c of sub._kids) { const n = natural(c); if (mayShrink(c, sub)) give += n; else fixed += n; }
    const ratio = give > 0 ? Math.max(0, Math.min(1, (LINE.w - fixed) / give)) : 1;
    const out = new Map(); let x = 0;
    for (const c of sub._kids) { const wd = natural(c) * (mayShrink(c, sub) ? ratio : 1); out.set(c, { left: x, right: x + wd, width: wd }); x += wd; }
    return out;
  };
  const isLine = (n) => !!(n && n.classList && n.classList.contains("sr-sub") && n.closest(".hist-list"));
  const zero = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const orig = w.doc.createElement;
  w.doc.createElement = (t) => {
    const n = orig(t);
    n.getBoundingClientRect = () => {
      if (isLine(n)) return Object.assign({}, zero, { right: LINE.w, width: LINE.w });
      if (isLine(n.parent)) return Object.assign({}, zero, boxes(n.parent).get(n));
      return zero;
    };
    return n;
  };
  LINE.mayShrink = mayShrink;
  // What the fit asks, asked the same way: does the line's last box end past the line?
  LINE.over = (sub) => { const last = sub && sub.lastElementChild; return !!last && last.getBoundingClientRect().right - sub.getBoundingClientRect().right > 0.01; };
  return LINE;
}
const DAY = 86400000, MINUTE = 60000;
// History as the owner's screenshot had it, and one row for every unit of the short words (the supervisor's proposal the
// owner OK'd: "min", "h", "d", "mo", "y"; "just now" → "now").
const FROWS = [
  { pi: "own", dj: "@inspector-gm-longername1:hs", ago: 3 * DAY, cut: "dj", votes: 1, saves: 1, word: "skipped", forms: ["3 days ago", "3d ago", "3d"] },
  { pi: "sys", dj: "@inspector-gm-longername1:hs", ago: 5 * MINUTE, cut: "media", votes: 1, saves: 1, word: "Sys Skip", forms: ["5 mins ago", "5min ago", "5min"] },
  { pi: "none", dj: "@inspector-gm-longername1:hs", ago: 2 * 3600000, cut: false, forms: ["2 hrs ago", "2h ago", "2h"] },
  { pi: "star", dj: "@bob:hs", ago: 20000, saves: 3, forms: ["just now", "now", "now"] },
  { pi: "m1", dj: "@ann:hs", ago: MINUTE, forms: ["1 min ago", "1min ago", "1min"] },
  { pi: "h1", dj: "@ann:hs", ago: 3600000, forms: ["1 hr ago", "1h ago", "1h"] },
  { pi: "d1", dj: "@ann:hs", ago: DAY, forms: ["1 day ago", "1d ago", "1d"] },
  { pi: "mo1", dj: "@ann:hs", ago: 31 * DAY, forms: ["1 month ago", "1mo ago", "1mo"] },
  { pi: "mo2", dj: "@ann:hs", ago: 65 * DAY, votes: 12, forms: ["2 months ago", "2mo ago", "2mo"] },
  { pi: "y1", dj: "@ann:hs", ago: 400 * DAY, votes: 999, saves: 999, forms: ["1 year ago", "1y ago", "1y"] },
  { pi: "y2", dj: "@ann:hs", ago: 800 * DAY, forms: ["2 years ago", "2y ago", "2y"] },
];
function fitScreen(extra, clock) {
  const RO = resizeObservers();
  const counts = {};
  for (const r of FROWS) if (r.votes || r.saves) counts[r.pi] = Object.assign({}, r.votes ? { votes: r.votes } : {}, r.saves ? { saves: r.saves } : {});
  const history = FROWS.concat(extra || []).map((r, i) => ({ videoId: "ffffffff" + String(100 + i), dj: r.dj, at: NOW - r.ago, pi: r.pi, cutShortBy: r.cut === undefined ? false : r.cut }));
  const w = screen({ history, counts, reach: { entries: history.length, complete: true } }, Object.assign({ globals: { ResizeObserver: RO } }, clock ? { clock: NOW } : {}));
  if (clock) w.st.serverNow = () => w.clock.now;
  const LINE = lineModel(w);
  w.refs.tabHistory.click();
  const rows = Array.from(w.qa(".hist-list .song-row", w.refs.queueBody));
  const byPi = {}; (FROWS.concat(extra || [])).forEach((r, i) => { byPi[r.pi] = { spec: r, row: rows[i] }; });
  const histRO = () => RO.made.filter((ro) => ro.on.some((t) => t.classList && t.classList.contains("hist-list") && t.isConnected));
  const resize = (px) => { LINE.w = px; const ros = histRO(); for (const ro of ros) ro.cb([]); return ros.length; };
  const state = (row) => {
    const age = w.q(".hist-ago", row), sub = w.q(".sr-sub", row);
    return { age: age ? age.textContent : null, cut: !!(sub && sub.classList.contains("hist-name-cut")), over: LINE.over(sub) };
  };
  return { w, LINE, RO, rows, byPi, histRO, resize, state };
}
part("F", () => {
  // ── THE COUNTS' SPOT ──
  const f = fitScreen();
  const { w, rows } = f;
  ok(rows.length === FROWS.length && rows.every((r, i) => r.dataset.vid === "ffffffff" + String(100 + i)),
    "F PREMISE — History drew every row, in order", rows.map((r) => r.dataset && r.dataset.vid));
  const kidsCls = (r) => w.kids(r).map((c) => c.className.split(/\s+/)[0]);
  ok(rows.every((r) => same(kidsCls(r), ["thumb-slot", "sr-main", "hist-counts", "uq-actions"])) &&
     rows.every((r) => { const a = w.q(".uq-actions", r); return a && w.kids(a).some((b) => b.textContent === "＋"); }),
    "F: EVERY ROW HAS THE COUNTS' SPOT, ONE, BETWEEN THE LINE AND THE ＋ (left of it)", rows.map(kidsCls).slice(0, 3));
  const spots = rows.map((r) => w.q(".hist-counts", r));
  const sp = (pi) => spots[FROWS.findIndex((x) => x.pi === pi)];
  // CHANGED ON PURPOSE (`ddjp_678`, the owner's "when a vote or save is at zero it should be grey"): a 0 also carries
  // `hist-zero`, so these rows read each count's own class — which count, where — and its words; its grey is the row below.
  const cnt = (n) => (n ? w.kids(n).map((c) => c.className.split(/\s+/)[0] + ":" + c.textContent) : null);
  // CHANGED ON PURPOSE (`ddjp_677`; the owner at `ddjp_674`, his words in `main/04-features.md` §Room History): both counts
  // on every row, 0 where there are none ("i think we can display them always but say 0 if nothing"), where each was drawn only
  // where it was not zero; and over 99 the display reads 99 ("99 = max displayed but the backend of it can count for real") —
  // the 999 row reads 99, where it read 999.
  ok(same(cnt(sp("own")), ["hist-votes:▲ 1", "hist-saves:★ 1"]) && same(cnt(sp("y1")), ["hist-votes:▲ 99", "hist-saves:★ 99"]) &&
     same(cnt(sp("mo2")), ["hist-votes:▲ 12", "hist-saves:★ 0"]) && same(cnt(sp("star")), ["hist-votes:▲ 0", "hist-saves:★ 3"]),
    "F: THE ▲ AND ★ COUNTS ARE IN THE SPOT — ▲ first, ★ second, both on every row, 0 where there are none", spots.map(cnt));
  ok(same(cnt(sp("none")), ["hist-votes:▲ 0", "hist-saves:★ 0"]) && same(cnt(sp("m1")), ["hist-votes:▲ 0", "hist-saves:★ 0"]),
    "F: A ROW WITH NO COUNTS KEEPS ITS SPOT AND SAYS 0, BOTH (\"pre taken\"; \"say 0 if nothing\")", [cnt(sp("none")), cnt(sp("m1"))]);
  // ── A 0 IS IN THE LINE'S GREY (ADDED at `ddjp_678`; the owner: "also in history when a vote or save is at zero it should be
  // grey isntead of colored"): a count of 0 — ▲ 0 or ★ 0 — is drawn in the grey of History's line (`.song-row .sr-sub`), by
  // the line's own colour rule, through a class (`hist-zero`), never an inline colour; above 0, the ▲ and ★ keep their blue and
  // gold (PART B reads them off the buttons). ──
  const countsOf = rows.map((r) => ({ row: r, sub: w.q(".sr-sub", r), kids: w.kids(w.q(".hist-counts", r) || { children: [] }) }));
  const zeros = [], above = [];
  for (const c of countsOf) for (const k of c.kids) (/ 0$/.test(k.textContent) ? zeros : above).push({ k, sub: c.sub });
  const kindOf = (k) => k.className.split(/\s+/)[0];
  ok(zeros.some((z) => kindOf(z.k) === "hist-votes") && zeros.some((z) => kindOf(z.k) === "hist-saves") && above.some((a) => kindOf(a.k) === "hist-votes") && above.some((a) => kindOf(a.k) === "hist-saves"),
    "F PREMISE — History drew a ▲ 0 and a ★ 0, and a ▲ and a ★ above 0", { zeros: zeros.length, above: above.length });
  const GREY = rows[0] ? w.decl(w.q(".sr-sub", rows[0]), "color") : null;
  ok(GREY === "#888", "F PREMISE — History's line is drawn in its grey, #888 (`.song-row .sr-sub`)", GREY);
  // ONE RULE FOR THE TWO: the sheet's rule that colours a 0 is the very rule that colours the line (one declaration, the
  // selectors of one list share it), so the two greys cannot drift.
  const SHEET = S.readSheet(require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8"));
  const sameRule = (k, sub) => { const a = w.rule(k, "color"), b = w.rule(sub, "color");
    const ra = SHEET.find((r) => r.sel === a && r.decls.color), rb = SHEET.find((r) => r.sel === b && r.decls.color);
    return !!ra && !!rb && ra.decls === rb.decls; };
  const zeroBad = zeros.filter(({ k, sub }) => !k.classList.contains("hist-zero") || w.decl(k, "color") !== w.decl(sub, "color") || !sameRule(k, sub) || k.style.color);
  ok(zeros.length && zeroBad.length === 0,
    "F: A COUNT OF 0 IS IN THE LINE'S GREY — ▲ 0 and ★ 0 take the colour History's line is drawn in, from the line's own colour rule, through a class (`hist-zero`), never inline (the owner: \"grey isntead of colored\")",
    zeroBad.slice(0, 3).map(({ k, sub }) => ({ text: k.textContent, cls: k.className, color: w.decl(k, "color"), line: w.decl(sub, "color"), rule: w.rule(k, "color") })));
  const aboveBad = above.filter(({ k }) => k.classList.contains("hist-zero") || w.decl(k, "color") !== (kindOf(k) === "hist-votes" ? "#4aa3ff" : "#ffd24a") || k.style.color);
  ok(above.length && aboveBad.length === 0, "F: ABOVE 0, BLUE AND GOLD AS NOW — no grey class, ▲ #4aa3ff and ★ #ffd24a, from the sheet",
    aboveBad.slice(0, 3).map(({ k }) => ({ text: k.textContent, cls: k.className, color: w.decl(k, "color") })));
  ok(rows.every((r) => { const sub = w.q(".sr-sub", r); return sub && !w.q(".hist-votes", sub) && !w.q(".hist-saves", sub) && !/[▲★]/.test(sub.textContent); }),
    "F: AND THE COUNTS ARE NO LONGER IN THE GREY LINE", rows.map((r) => w.q(".sr-sub", r) && w.q(".sr-sub", r).textContent).slice(0, 4));
  const widths = spots.map((s) => w.decl(s, "width"));
  const lenPx = (v, s) => { const m = /^(\d+(?:\.\d+)?)(px|em)$/.exec(String(v || "")); if (!m) return NaN; return m[2] === "px" ? Number(m[1]) : Number(m[1]) * px(w.decl(s, "font-size")); };
  ok(widths.every((v) => v === widths[0]) && lenPx(widths[0], spots[0]) > 0 && w.decl(spots[0], "flex") === "none",
    "F: THE SPOT IS ONE WIDTH ON EVERY ROW, A FIXED LENGTH, AND NEVER SHRINKS — the line beside it cannot push it out",
    { widths: Array.from(new Set(widths)), flex: w.decl(spots[0], "flex") });
  // CHANGED ON PURPOSE (`ddjp_677`): wide enough for "▲ 99" and "★ 99" side by side, where it was "★ 999" (three digits)
  // stacked — and no wider, the title's room being the price (measured in Chromium at 360, 390 and 1400 px, the report).
  ok(lenPx(widths[0], spots[0]) / 2 >= Math.max(UP99_PX, STAR99_PX) + 2 * EDGE_PX,
    "F: WIDE ENOUGH FOR \"▲ 99\" AND \"★ 99\" SIDE BY SIDE — each half holds the wider (" + STAR99_PX + " px at the line's 11 px in Chromium) with " + EDGE_PX + " px either side",
    { width: widths[0], px: lenPx(widths[0], spots[0]), need: 2 * (Math.max(UP99_PX, STAR99_PX) + 2 * EDGE_PX) });
  ok(lenPx(widths[0], spots[0]) <= 2 * (Math.max(UP99_PX, STAR99_PX) + 2 * EDGE_PX) + 2 * EDGE_PX,
    "F: AND NO WIDER THAN THAT NEEDS — the title gives up what the spot takes, so at most " + (2 * EDGE_PX) + " px over its least (the owner: \"save space\")",
    { px: lenPx(widths[0], spots[0]), most: 2 * (Math.max(UP99_PX, STAR99_PX) + 2 * EDGE_PX) + 2 * EDGE_PX });
  const votesN = w.q(".hist-votes", sp("own")), savesN = w.q(".hist-saves", sp("own")), starOnly = w.q(".hist-saves", sp("star"));
  // CHANGED ON PURPOSE (`ddjp_677`; the owner at `ddjp_674`: "id like to have the history show votes and save horizontally
  // centered and not stacked on top of each other", and, shown sketches, "always on the right"): ONE line, in the middle of
  // the row's height — ▲ in the spot's left half, ★ always in its right half, each centred in its half — where ▲ sat on the
  // spot's top line and ★ on its bottom.
  const halfOf = (n) => w.decl(n, "grid-column");
  ok(w.decl(spots[0], "display") === "grid" && w.decl(spots[0], "grid-template-columns") === "1fr 1fr" && w.decl(spots[0], "grid-template-rows") === null &&
     halfOf(votesN) === "1" && halfOf(savesN) === "2" && halfOf(starOnly) === "2" && w.decl(votesN, "grid-row") === null && w.decl(savesN, "grid-row") === null,
    "F: ONE LINE — ▲ IN THE SPOT'S LEFT HALF, ★ ALWAYS IN ITS RIGHT HALF (two equal halves, one row; never stacked)",
    { display: w.decl(spots[0], "display"), cols: w.decl(spots[0], "grid-template-columns"), rows: w.decl(spots[0], "grid-template-rows"), up: halfOf(votesN), star: halfOf(savesN), alone: halfOf(starOnly) });
  const centredIn = (n) => w.decl(n, "justify-self") === "center" || (w.decl(n, "justify-self") === null && w.decl(spots[0], "justify-items") === "center");
  // In the middle of the row's height, however it is said: the spot centred in its row (its own `align-self`, or none and the
  // row's `align-items`), or stretched to the row's height with its line centred in it (the grid's `align-items`).
  const rowOf = rows[0], selfA = w.decl(spots[0], "align-self"), rowA = w.decl(rowOf, "align-items"), gridA = w.decl(spots[0], "align-items");
  const middle = selfA === "center" || (selfA === null && rowA === "center") || (selfA === "stretch" && gridA === "center");
  ok(centredIn(votesN) && centredIn(savesN) && middle,
    "F: EACH CENTRED IN ITS HALF, AND THE LINE IN THE MIDDLE OF THE ROW'S HEIGHT (the owner's \"centered\")",
    { justifyItems: w.decl(spots[0], "justify-items"), alignSelf: selfA, rowAlign: rowA, gridAlign: gridA });
  ok(w.decl(votesN, "color") === "#4aa3ff" && w.decl(savesN, "color") === "#ffd24a" && !votesN.style.color && !savesN.style.color,
    "F: IN THEIR PRESENT COLOURS, the stylesheet's (PART B reads them off the buttons)", [w.decl(votesN, "color"), w.decl(savesN, "color")]);

  // ── OVER 99 THE DISPLAY READS 99, AND ONLY IN HISTORY (ADDED at `ddjp_677`; the owner at `ddjp_674`: "99 = max displayed but
  // the backend of it can count for real"; "it should show 00 not + to save space, yes show real number for other palces then
  // history" — "00" is 99, his typo). A playing folded to 150 votes and 100 saves reads 99 and 99 on its History row, with no
  // "+"; the fold and the row's own tally still hold 150 and 100; 99 reads 99 and 98 reads 98. Now Playing, the room queue's
  // row and the Player's, shows the real 150. ──
  {
    const cw = screen({ counts: { h1: { votes: 150, saves: 100 }, h2: { votes: 99, saves: 98 }, p0: { votes: 150, saves: 150 } },
      history: [{ videoId: "hhhhhhhhhh1", dj: "@ann:hs", at: NOW - 60000, pi: "h1", cutShortBy: "dj", counts: { votes: 150, saves: 100 } },
                { videoId: "hhhhhhhhhh2", dj: "@bob:hs", at: NOW - 360000, pi: "h2", cutShortBy: false },
                { videoId: "hhhhhhhhhh3", dj: "@cat:hs", at: NOW - 720000, pi: "h3", cutShortBy: false, counts: { votes: 300 } }] });
    const held = JSON.stringify([cw.st.counts, cw.st.history]);
    cw.refs.tabHistory.click();
    const crow = Array.from(cw.qa(".hist-list .song-row", cw.refs.queueBody));
    const read = crow.map((r) => [(cw.q(".hist-votes", r) || {}).textContent, (cw.q(".hist-saves", r) || {}).textContent]);
    ok(crow.length === 3, "F PREMISE — History drew the three rows of the cap's world", crow.length);
    ok(same(read, [["▲ 99", "★ 99"], ["▲ 99", "★ 98"], ["▲ 99", "★ 0"]]) && !read.some((x) => /\+/.test(x.join(""))),
      "F: OVER 99 THE DISPLAY READS 99, WITH NO \"+\" — 150 and 100 read 99, 99 reads 99, 98 reads 98, a row's own tally of 300 reads 99", read);
    ok(JSON.stringify([cw.st.counts, cw.st.history]) === held && cw.st.counts.h1.votes === 150 && cw.st.history[0].counts.votes === 150,
      "F: AND THE COUNTS KEPT AND FOLDED STAY REAL — the fold still holds 150, the row's tally 150 (History only draws 99)", cw.st.counts.h1);
    cw.refs.tabRoom.click();
    const cnp = cw.q(".song-row.playing", cw.refs.queueBody);
    cw.sb.ChatPanels._syncNpButtons();
    const real = { row: cnp ? cw.qa(".np-count", cnp).map((n) => n.textContent) : null, player: [cw.refs.grabCount.textContent, cw.refs.upvoteCount.textContent] };
    ok(same(real, { row: ["150", "150"], player: ["150", "150"] }),
      "F: NOW PLAYING SHOWS THE REAL NUMBER — 150 on the room queue's row and on the Player's ★ and ▲ (the owner: \"show real number for other palces then history\")", real);
  }
  // ── HISTORY'S RECORD OF WHAT IT DREW HOLDS THE COUNTS AS SHOWN (ADDED at `ddjp_677`; J130's record, `historyRecord`): a count
  // that changes what is drawn redraws the tab, and one that does not — 120 → 121, both drawn as 99; none → 0 and 0, both drawn
  // as 0 — redraws nothing. ──
  {
    const rw = screen({ counts: { h1: { votes: 120, saves: 1 }, h2: { votes: 98 } } });
    rw.refs.tabHistory.click();
    const list = () => rw.q(".hist-list", rw.refs.queueBody);
    const first = list(), rec0 = rw.sb.Panels.historyRecord();
    ok(first && rw.q(".hist-votes", first).textContent === "▲ 99", "F PREMISE — History drew 120 votes as 99", first && rw.q(".hist-votes", first).textContent);
    rw.st.counts.h1 = { votes: 121, saves: 1 };
    rw.sb.QueuePanels.roomEvent("queue");
    const same121 = list() === first && rw.sb.Panels.historyRecord() === rec0;
    rw.st.counts.h3 = { votes: 0, saves: 0 };
    rw.sb.QueuePanels.roomEvent("queue");
    const sameZero = list() === first && rw.sb.Panels.historyRecord() === rec0;
    ok(same121 && sameZero, "F: THE RECORD HOLDS THE COUNTS AS SHOWN — 120 → 121 (99 either way), and no counts → 0 and 0, redraw nothing",
      { after121: same121, afterZeros: sameZero, rec: rec0.slice(0, 160) });
    rw.st.counts.h2 = { votes: 99 };
    rw.sb.QueuePanels.roomEvent("queue");
    const redrawn = list() !== first && rw.q(".hist-votes", rw.qa(".hist-list .song-row", rw.refs.queueBody)[1]).textContent === "▲ 99";
    ok(redrawn, "F CONTROL: and a count that changes what is drawn (98 → 99) redraws it", redrawn);
    // ADDED at `ddjp_678`: 0 → 1 changes what is drawn — the number, and the grey to the count's own colour — so it redraws.
    const before = list(), second = () => rw.qa(".hist-list .song-row", rw.refs.queueBody)[1];
    const z0 = rw.q(".hist-saves", second());
    ok(z0 && z0.textContent === "★ 0", "F PREMISE — the second row's ★ reads 0", z0 && z0.textContent);
    const grey0 = z0 && z0.classList.contains("hist-zero") && rw.decl(z0, "color") === rw.decl(rw.q(".sr-sub", second()), "color");
    rw.st.counts.h2 = { votes: 99, saves: 1 };
    rw.sb.QueuePanels.roomEvent("queue");
    const z1 = rw.q(".hist-saves", second());
    ok(grey0 && list() !== before && z1 && z1.textContent === "★ 1" && !z1.classList.contains("hist-zero") && rw.decl(z1, "color") === "#ffd24a",
      "F: AND 0 → 1 REDRAWS THE ROW — its ★ was 0 in the grey, and reads 1 in its gold", { grey0, redrew: list() !== before, now: z1 && [z1.textContent, z1.className, rw.decl(z1, "color")] });
  }

  // ── THE SEPARATOR AFTER THE NAME IS THE AGE'S OWN, so a cut name keeps it ──
  const own = f.byPi.own.row, who = w.q(".sr-who", own), age = w.q(".hist-ago", own);
  const hangs = (n) => PSEUDO.filter((ps) => n && n.matches(ps.base)).map((ps) => ps.sel + " " + JSON.stringify(ps.text));
  ok(PSEUDO.length > 0 && hangs(who).length === 0 && hangs(age).length === 1 && / · /.test(hangs(age)[0]),
    "F: THE \" · \" AFTER THE NAME IS DRAWN BY THE AGE (`::before`), NOT THE NAME — so a cut name still reads \"inspector-g… · 3d\"",
    { name: hangs(who), age: hangs(age) });

  // ── THE ORDER: narrowed a pixel at a time, then widened again ──
  ok(f.histRO().length === 1, "F PREMISE — History's list is observed for its width, once (the header's way)", f.histRO().length);
  const stepOf = (spec, st) => (st.cut ? 3 : spec.forms.indexOf(st.age));
  const seq = {}; for (const r of FROWS) seq[r.pi] = [];
  const bad = { fit: [], least: [], word: [], name: [], shrink: [] };
  const look = (px) => {
    for (const r of FROWS) {
      const row = f.byPi[r.pi].row, st = f.state(row), k = stepOf(r, st);
      const last = seq[r.pi][seq[r.pi].length - 1];
      const key = st.age + (st.cut ? "+cut" : "");
      if (last !== key) seq[r.pi].push(key);
      if (k < 0) bad.fit.push(px + " " + r.pi + " " + key);
      if (st.over && !st.cut) bad.fit.push(px + " " + r.pi + " overflows at " + key);
      // ONLY AS FAR AS NEEDED: one step back would not fit.
      if (k > 0 && k <= 3) {
        const sub = w.q(".sr-sub", row), ag = w.q(".hist-ago", row);
        const was = [ag.textContent, sub.classList.contains("hist-name-cut")];
        ag.textContent = r.forms[Math.min(k - 1, 2)]; sub.classList.toggle("hist-name-cut", k - 1 >= 3);
        const backFits = !f.LINE.over(sub);
        ag.textContent = was[0]; sub.classList.toggle("hist-name-cut", was[1]);
        if (backFits) bad.least.push(px + " " + r.pi + " at step " + k + " where step " + (k - 1) + " fits");
      }
      const sk = w.q(".hist-skip", row);
      if ((r.word || null) !== (sk ? sk.textContent : null) || (sk && f.LINE.mayShrink(sk, w.q(".sr-sub", row)))) bad.word.push(px + " " + r.pi);
      if (w.q(".sr-who", row).textContent !== r.dj.slice(1).split(":")[0]) bad.name.push(px + " " + r.pi);
      const givers = w.kids(w.q(".sr-sub", row)).filter((c) => f.LINE.mayShrink(c, w.q(".sr-sub", row))).map((c) => c.className);
      if (!same(givers, st.cut ? ["sr-who"] : [])) bad.shrink.push(px + " " + r.pi + " " + givers.join());
    }
  };
  ok(f.resize(460) === 1, "F PREMISE — a change of width reaches History's fit through its observer", null);
  look(460);
  const wide = FROWS.map((r) => f.state(f.byPi[r.pi].row));
  ok(FROWS.every((r, i) => wide[i].age === r.forms[0] && !wide[i].cut),
    "F: WITH ROOM, THE FULL WORDS — exactly as before, every row", FROWS.map((r, i) => r.pi + ": " + wide[i].age + (wide[i].cut ? " +cut" : "")));
  for (let px2 = 458; px2 >= 20; px2 -= 2) { f.resize(px2); look(px2); }
  const narrowed = {}; for (const r of FROWS) narrowed[r.pi] = seq[r.pi].slice();
  const expectSeq = (r) => { const out = []; for (const k of [r.forms[0], r.forms[1], r.forms[2], r.forms[2] + "+cut"]) if (out[out.length - 1] !== k) out.push(k); return out; };
  ok(same(narrowed.own, expectSeq(FROWS[0])),
    "F: THE OWNER'S ROW GIVES WAY IN HIS ORDER — \"3 days ago\", then \"3d ago\", then \"3d\", and only then the name's end", narrowed.own);
  ok(FROWS.every((r) => same(narrowed[r.pi], expectSeq(r))),
    "F: EVERY ROW, EVERY UNIT — the age's short form with \"ago\", then its shortest, then the name: min, h, d, mo, y; \"just now\" → \"now\"",
    FROWS.filter((r) => !same(narrowed[r.pi], expectSeq(r))).map((r) => [r.pi, narrowed[r.pi]]));
  ok(bad.least.length === 0, "F: ONLY AS FAR AS NEEDED — at every width each row is at the first step that fits", bad.least.slice(0, 4));
  ok(bad.fit.length === 0, "F: AND ITS LINE FITS (only the name's end is ever lost)", bad.fit.slice(0, 4));
  ok(bad.word.length === 0, "F: \"skipped\" AND \"Sys Skip\" ARE NEVER CUT — whole at every width, and never a box that may shrink", bad.word.slice(0, 4));
  ok(bad.shrink.length === 0 && bad.name.length === 0, "F: THE NAME, AND ONLY THE NAME, MAY GIVE UP ITS END — and only at the last step; its text stays whole (the browser's \"…\")",
    { shrink: bad.shrink.slice(0, 4), name: bad.name.slice(0, 4) });
  // EACH ROW ITS OWN FORM: where the owner's row first gives way, the short names still read in full.
  const firstShort = (() => { for (let px3 = 460; px3 >= 20; px3 -= 2) { f.resize(px3); if (f.state(f.byPi.own.row).age !== "3 days ago") return px3; } return null; })();
  ok(firstShort !== null && ["m1", "h1", "d1", "y2"].every((pi) => f.state(f.byPi[pi].row).age === f.byPi[pi].spec.forms[0]),
    "F: EACH ROW KEEPS THE FORM IT NEEDS — where the owner's row first shortens, the short names keep their full words",
    { at: firstShort, rows: ["own", "m1", "h1", "d1", "y2"].map((pi) => pi + ": " + f.state(f.byPi[pi].row).age) });
  // ROOM COMES BACK: widened again a pixel at a time, the longer forms come back, in the reverse order.
  for (const r of FROWS) seq[r.pi] = [];
  f.resize(20); look(20);
  for (let px4 = 22; px4 <= 460; px4 += 2) { f.resize(px4); look(px4); }
  ok(FROWS.every((r) => same(seq[r.pi], expectSeq(r).slice().reverse())),
    "F: WHEN ROOM COMES BACK (a wider window, a phone turned), THE LONGER FORMS COME BACK — down to the full words",
    FROWS.filter((r) => !same(seq[r.pi], expectSeq(r).slice().reverse())).map((r) => [r.pi, seq[r.pi]]));
  ok(FROWS.every((r) => f.state(f.byPi[r.pi].row).age === r.forms[0] && !f.state(f.byPi[r.pi].row).cut),
    "F: AND AT THE WIDEST AGAIN, EVERY ROW READS AS IT DID", FROWS.map((r) => f.state(f.byPi[r.pi].row).age));

  // ── OTHER LISTS, AND THE LONG WORDS EVERY OTHER SCREEN READS, UNCHANGED ──
  const longs = FROWS.map((r) => w.sb.Panels._fmtAgo(NOW - r.ago, NOW));
  ok(same(longs, FROWS.map((r) => r.forms[0])), "F: `_fmtAgo`'S LONG WORDS ARE AS THEY WERE — the DM list, the Feed and People read them", longs);
  for (const [tab, name] of [["tabRoom", "the room queue"], ["tabMine", "My queue"]]) {
    w.refs[tab].click();
    const rr = w.qa(".song-row", w.refs.queueBody);
    ok(rr.length > 0 && rr.every((r) => !w.q(".hist-counts", r) && !w.q(".hist-name-cut", r) && w.kids(r).every((c) => !/^hist-/.test(c.className))) &&
       rr.every((r) => { const sub = w.q(".sr-sub", r); return sub && w.decl(sub, "display") !== "flex" && w.decl(sub, "white-space") === "nowrap"; }),
      "F: " + name.toUpperCase() + "'S ROWS ARE AS THEY WERE — no counts' spot, their line the shared one-line rule", rr.map(kidsCls).slice(0, 2));
  }
});

// THE WHOLE FIRST MINUTE READS "just now" — ADDED at `ddjp_669`. From 45 to 59 seconds `_fmtAgo` said "0 mins ago" (History's
// short form "0min"), so an age read "just now", then "0 mins ago" for fifteen seconds, then "1 min ago". The rule, with the
// owner's words and the supervisor's proposal made under them: `main/04-features.md` §Room History — "just now" below 60
// seconds, "1 min ago" from 60, every other word as it was. Asked of the real formatter at the edge (it writes every screen's
// "… ago": History, People, the DM list, chat and the Feed), then read off four rows History drew there and narrowed a step at
// a time, as PART F narrows its own: History's short forms follow the long words by themselves.
part("F first minute", () => {
  const S1 = 1000;
  const EDGE = [
    { pi: "s44", dj: "@ann:hs", ago: 44 * S1, forms: ["just now", "now", "now"] },
    { pi: "s45", dj: "@ann:hs", ago: 45 * S1, forms: ["just now", "now", "now"] },
    { pi: "s59", dj: "@ann:hs", ago: 59 * S1, forms: ["just now", "now", "now"] },
    { pi: "s60", dj: "@ann:hs", ago: 60 * S1, forms: ["1 min ago", "1min ago", "1min"] },
  ];
  const f = fitScreen(EDGE);
  ok(f.rows.length === FROWS.length + EDGE.length && EDGE.every((r) => f.byPi[r.pi].row && f.state(f.byPi[r.pi].row).age),
    "F first minute PREMISE — History drew the four rows at the minute's edge, each with its age", f.rows.length);
  const longs = EDGE.map((r) => f.w.sb.Panels._fmtAgo(NOW - r.ago, NOW));
  ok(same(longs, ["just now", "just now", "just now", "1 min ago"]),
    "F: THE WHOLE FIRST MINUTE READS \"just now\" — at 44, 45 and 59 seconds; at 60 \"1 min ago\" (the words every screen's \"… ago\" reads)",
    EDGE.map((r, i) => r.ago / S1 + " s: " + longs[i]));
  const seq = {}; for (const r of EDGE) seq[r.pi] = [];
  const look = () => {
    for (const r of EDGE) {
      const st = f.state(f.byPi[r.pi].row), key = st.age + (st.cut ? "+cut" : ""), s = seq[r.pi];
      if (s[s.length - 1] !== key) s.push(key);
    }
  };
  ok(f.resize(460) === 1, "F first minute PREMISE — a change of width reaches History's fit through its observer", null);
  look();
  for (let px = 458; px >= 20; px -= 2) { f.resize(px); look(); }
  ok(same(seq.s59, ["just now", "now", "now+cut"]) && same(seq.s60, ["1 min ago", "1min ago", "1min", "1min+cut"]) &&
     same(seq.s44, seq.s59) && same(seq.s45, seq.s59),
    "F: AND HISTORY'S SHORT FORMS FOLLOW — at 59 seconds \"now\", never \"0min\"; at 60 \"1min ago\", then \"1min\"",
    EDGE.map((r) => [r.pi, seq[r.pi]]));
});

// THE AGE TICK, ON THE WORLD'S CLOCK, AND THE DM LIST'S TIMES BESIDE IT.
partAsync("F tick", async () => {
  const grow = { pi: "grow", dj: "@ann:hs", ago: 9 * MINUTE + 50000, forms: ["9 mins ago", "9min ago", "9min"] };
  const f = fitScreen([grow], true);
  const { w } = f;
  w.st.dms = [{ userId: "@ann:hs", lastTs: NOW - 3 * DAY, roomIds: ["!dm:hs"], roomId: "!dm:hs" }];
  w.sb.ChatPanels.renderDMPanel();
  const dmWhen = () => { const n = w.q(".dm-when", w.refs.dmBox); return n ? n.textContent : null; };
  ok(dmWhen() === "3 days ago", "F PREMISE — the DM list drew its row, its time in the long words", dmWhen());
  // The narrowest width at which the growing row still reads its long words: a 30 s tick makes them a letter longer.
  f.resize(460);
  let edge = null;
  for (let px = 460; px >= 20; px--) { f.resize(px); if (f.state(f.byPi.grow.row).age !== "9 mins ago") { edge = px + 1; break; } }
  f.resize(edge);
  const before = FROWS.concat([grow]).map((r) => f.state(f.byPi[r.pi].row));
  ok(edge && before[FROWS.length].age === "9 mins ago" && before[0].age !== "3 days ago",
    "F PREMISE — at this width the growing row reads \"9 mins ago\" and the owner's row is shortened", { edge, own: before[0], grow: before[FROWS.length] });
  await w.advance(30000);
  const after = FROWS.concat([grow]).map((r) => f.state(f.byPi[r.pi].row));
  ok(/^10/.test(after[FROWS.length].age), "F PREMISE — the tick ran: thirty seconds later the growing row is ten minutes old", after[FROWS.length]);
  // EVERY ROW, THE 20 S ROW INCLUDED (`ddjp_670`, a guard tightening the owner chose with this job): it was skipped (`i === 3`)
  // because at 50 s it read "0 mins ago" until `ddjp_669`'s first minute; it reads "just now" (History's "now") either side of
  // the tick now, so the comparison holds every row — and goes red if the first minute's "just now" is lost again.
  ok(after[0].age === before[0].age && after[0].cut === before[0].cut && FROWS.every((r, i) => after[i].age === before[i].age && after[i].cut === before[i].cut),
    "F: A TICK KEEPS EACH ROW'S FORM — it writes each age in the form its row needs, never the long words over a short one",
    FROWS.map((r, i) => r.pi + ": " + before[i].age + " → " + after[i].age));
  ok(after[FROWS.length].age === "10min ago" && !after[FROWS.length].over,
    "F: AND IT CHECKS THE FIT AGAIN — an age grown a letter longer (\"9 mins ago\" → \"10 mins ago\") takes its short form",
    after[FROWS.length]);
  f.resize(edge);
  const fresh = FROWS.concat([grow]).map((r) => f.state(f.byPi[r.pi].row));
  ok(same(fresh, after), "F: WHAT THE TICK LEAVES IS WHAT A FRESH FIT DRAWS", { after: after.map((s) => s.age), fresh: fresh.map((s) => s.age) });
  ok(dmWhen() === "3 days ago", "F: THE DM LIST'S TIME IS UNTOUCHED BY HISTORY'S FIT AND TICK — its long words", dmWhen());
  w.sb.Panels._refreshAges(w.refs.dmBox, "dm-when");
  ok(dmWhen() === "3 days ago", "F: AND ITS OWN TICK (`_refreshAges`) STILL WRITES THE LONG WORDS", dmWhen());
  ok(/Panels\._refreshAges\(refs\.dmBox, "dm-when"\)/.test(fsF.readFileSync(pathF.join(__dirname, "..", "ui", "chat.js"), "utf8")),
    "F: the DM list's tick is still `_refreshAges` (source-level; driven just above)");
});

// ═══ PART L — a playlist's row, locked and unlocked: no ＋ while unlocked ══════════════════════════════════════════════
// ADDED at `ddjp_668`. Found at `ddjp_655` and measured in Chromium at the `ddjp_657` audit: on a phone, unlocked, a playlist
// row's title had little room — 23 px at 390 px wide, none at 360, where the row's content ran 7 px past the row and the ✕ sat
// against its edge; locked, the title had the row. The owner's rule, recorded with his words in `main/04-features.md`
// §Playlists: unlocked, a playlist row shows no ＋ and no separator before ▲, so it reads ▲ ▼ | ⏫ ⏬ | ✕; locked, as before,
// ＋ | ✕ (✕ greyed). THE SWITCH IS THE MOVES' OWN, THE OTHER WAY ROUND: the list's `pl-locked` class, so the row is built the
// same either way and the class alone flips what it shows — held on the rows already drawn: the same elements before and
// after, nothing built or removed. (The panel's own lock still redraws the list from the record held — J130's rule for your
// own actions inside a playlist, unchanged — and the ＋ follows the class on the rows it draws; read below too.) The room
// queue's rows are left as they are (the supervisor's proposal the owner accepted, the same home): they have no ＋, and their
// six controls are staff's, shown only unlocked. So History's ＋, My queue's rows and the room queue's rows are read here as
// they were — the same words as on `ddjp_667`, with the Playlists lock set either way and the tab drawn again.
partAsync("L", async () => {
  const PL = { id: "pl_gym", name: "Gym", tracks: ["ppppppppp01", "ppppppppp02", "ppppppppp03", "ppppppppp04"].map((v) => ({ videoId: v })) };
  const w = screen({ playlist: PL });
  const qb = w.refs.queueBody;
  const tick = () => new Promise((r) => setImmediate(r));
  const rows = () => w.qa(".pl-detail-body .song-row", qb);
  const body = () => w.q(".pl-detail-body", qb);
  const acts = (r) => { const a = w.q(".uq-actions", r); return a ? w.kids(a) : []; };
  const sym = (n) => (/\bq-sep\b/.test(n.className) ? "|" : n.textContent.replace(/︎/g, ""));
  const seen = (r) => acts(r).filter((n) => w.shown(n)).map(sym).join(" ");      // what a person sees, in order
  const built = (r) => acts(r).map(sym).join(" ");                                 // what the row holds
  const lock = () => w.q(".pl-detail-head .panel-lock-btn", qb);
  const plus = (r) => acts(r).find((n) => n.textContent === "＋") || null;
  const cross = (r) => acts(r).find((n) => n.textContent === "✕") || null;
  const LOCKED = "＋ | ✕", UNLOCKED = "▲ ▼ | ⏫ ⏬ | ✕", BUILT = "＋ | ▲ ▼ | ⏫ ⏬ | ✕";
  w.refs.tabPlaylists.click();
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Gym");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();                                         // its read lands
  ok(nm && rows().length === 4 && w.H.plLocked() && body() && /\bpl-locked\b/.test(body().className),
    "L PREMISE — the playlist opened from the library, its four songs drawn, the Playlists panel locked (it opens locked)",
    { name: !!nm, rows: rows().length, locked: w.H.plLocked(), body: body() && body().className });
  const lockedSeen = rows().map(seen), lockedBuilt = rows().map(built);
  ok(rows().length === 4 && lockedSeen.every((s) => s === LOCKED) && rows().every((r) => cross(r) && cross(r).disabled === true && plus(r) && !plus(r).disabled),
    "L: LOCKED, EXACTLY AS BEFORE — ＋ | ✕ on every row, ＋ usable and ✕ greyed", { seen: lockedSeen, cross: rows().map((r) => cross(r) && cross(r).disabled) });
  if (lock()) lock().click();                                                        // the panel's own lock: unlocked
  ok(!w.H.plLocked() && body() && !/\bpl-locked\b/.test(body().className) && rows().length === 4,
    "L PREMISE — one click on the panel's lock: unlocked, the four rows drawn", { locked: w.H.plLocked(), body: body() && body().className, rows: rows().length });
  const unlockedSeen = rows().map(seen);
  ok(rows().length === 4 && unlockedSeen.every((s) => s === UNLOCKED),
    "L: UNLOCKED, A PLAYLIST ROW SHOWS NO ＋ AND NO SEPARATOR BEFORE ▲ — it reads ▲ ▼ | ⏫ ⏬ | ✕, so the title has the ＋'s room (the owner's rule)", unlockedSeen);
  // Hidden as the moves are, `display: none` — so they TAKE NO ROOM. Invisible but laid out (`visibility: hidden`) would read
  // as hidden above and leave the title exactly as narrow.
  const pair = (r) => acts(r).slice(0, 2);
  ok(rows().length === 4 && rows().every((r) => pair(r).length === 2 && pair(r)[0].textContent === "＋" && /\bq-sep\b/.test(pair(r)[1].className) &&
       pair(r).every((n) => w.decl(n, "display") === "none")),
    "L: AND THEY TAKE NO ROOM — the ＋ and its separator are `display: none` while unlocked, as the moves are while locked", rows().map((r) => pair(r).map((n) => [sym(n), w.decl(n, "display"), w.rule(n, "display")])));
  ok(rows().length === 4 && rows().every((r) => { const v = acts(r).filter((n) => w.shown(n)); return v.length && !/\bq-sep\b/.test(v[0].className) && v[0].textContent === "▲"; }) &&
     rows().every((r) => cross(r) && !cross(r).disabled && w.shown(cross(r))),
    "L: THE FIRST THING SHOWN IS ▲, NOT A SEPARATOR, and ✕ is usable", rows().map((r) => acts(r).filter((n) => w.shown(n)).map(sym)[0]));
  const unlockedBuilt = rows().map(built);
  ok(same(lockedBuilt, unlockedBuilt) && unlockedBuilt.every((s) => s === BUILT),
    "L: HIDDEN, NOT ABSENT — every row holds ＋, its separator, the moves and ✕, locked and unlocked alike: the row is built the same either way and only the class decides what shows",
    { locked: lockedBuilt, unlocked: unlockedBuilt });
  // THE SWITCH ALONE, ON THE ROWS AS THEY ARE: no click, no redraw — the list's class, flipped as a lock flips it.
  const rs0 = rows(), b0 = body();
  const watch = w.watch(b0);
  b0.classList.add("pl-locked");
  const flipLocked = rows().map(seen);
  b0.classList.remove("pl-locked");
  const flipBack = rows().map(seen);
  const rec = watch.take(), rs1 = rows();
  ok(flipLocked.every((s) => s === LOCKED) && flipBack.every((s) => s === UNLOCKED) && flipLocked.length === 4,
    "L: A LOCK AND AN UNLOCK FLIP IT BY THE CLASS ALONE — the list's `pl-locked` added: ＋ | ✕; taken off: ▲ ▼ | ⏫ ⏬ | ✕", { flipLocked, flipBack });
  ok(body() === b0 && rs1.length === rs0.length && rs1.every((r, i) => r === rs0[i]) && rec.rowsBuilt === 0 && rec.rowsRemoved === 0,
    "L: WITHOUT REBUILDING A ROW — the same row elements before and after, none built or removed", { sameBody: body() === b0, rec });
  // THE PANEL'S OWN LOCK, BOTH WAYS AGAIN (it redraws the list from the record held, as before).
  if (lock()) lock().click();
  const relocked = rows().map(seen);
  if (lock()) lock().click();
  const reunlocked = rows().map(seen);
  ok(w.H.plLocked() === false && relocked.length === 4 && relocked.every((s) => s === LOCKED) && reunlocked.every((s) => s === UNLOCKED),
    "L: AND THE PANEL'S OWN LOCK, CLICKED AGAIN: locked ＋ | ✕, unlocked ▲ ▼ | ⏫ ⏬ | ✕", { relocked, reunlocked });
  // THE OTHER LISTS, AS THEY WERE. Each tab drawn, then the Playlists lock set each way and the tab drawn again (a tab click
  // relocks the queue locks, so the lock is set after it). Their own locks as a tab click leaves them (locked); My queue's and
  // the room queue's also unlocked by their own lock buttons.
  const outside = () => w.qa(".pl-add", w.main).filter((n) => !n.closest(".pl-detail-body"));
  const others = {};
  for (const plOpen of [false, true]) {
    let away = 0;   // `pl-add` outside a playlist's rows, counted on every tab as it is drawn
    const read = (tab, sel) => { w.refs[tab].click(); w.H.setPlLocked(!plOpen); w.sb.QueuePanels.renderQueuePanel();
      away += outside().length; return w.qa(sel, w.refs.queueBody).map(seen); };
    const k = plOpen ? "playlists unlocked" : "playlists locked";
    others[k] = { history: read("tabHistory", ".song-row") };
    others[k].historyPlus = w.qa(".song-row", w.refs.queueBody).map((r) => { const p = plus(r); return p ? [w.shown(p), p.disabled, p.getAttribute("title")] : null; });
    others[k].mine = read("tabMine", ".song-row");
    if (w.refs.uqLockBtn) w.refs.uqLockBtn.click();
    others[k].mineUnlocked = w.qa(".song-row", w.refs.queueBody).map(seen);
    others[k].room = read("tabRoom", ".song-row");
    if (w.refs.roomqLockBtn) w.refs.roomqLockBtn.click();
    others[k].roomUnlocked = w.qa(".song-row", w.refs.queueBody).map(seen);
    others[k].outside = away + outside().length;
  }
  const WANT = {
    history: ["＋", "＋", "＋"], historyPlus: [[true, false, "Add to a playlist"], [true, false, "Add to a playlist"], [true, false, "Add to a playlist"]],
    mine: ["▲ ▼ | ⏫ ⏬", "▲ ▼ | ⏫ ⏬"], mineUnlocked: ["▲ ▼ | ⏫ ⏬ | ✕", "▲ ▼ | ⏫ ⏬ | ✕"],
    room: ["☆1 ▲3", "", "", ""], roomUnlocked: ["☆1 ▲3", "▲ ▼ | ⏫ ⏬ | ✕🎵 ✕👤", "▲ ▼ | ⏫ ⏬ | ✕🎵 ✕👤", "▲ ▼ | ⏫ ⏬ | ✕🎵 ✕👤"], outside: 0 };
  for (const k of Object.keys(others)) {
    const o = others[k];
    ok(same(o.history, WANT.history) && same(o.historyPlus, WANT.historyPlus),
      "L: HISTORY'S ＋ (ADD TO A PLAYLIST) IS AS IT WAS — shown and usable on every row, " + k, { history: o.history, plus: o.historyPlus });
    ok(same(o.mine, WANT.mine) && same(o.mineUnlocked, WANT.mineUnlocked),
      "L: MY QUEUE'S ROWS ARE AS THEY WERE — locked ▲ ▼ | ⏫ ⏬, unlocked by its own lock ▲ ▼ | ⏫ ⏬ | ✕, " + k, { locked: o.mine, unlocked: o.mineUnlocked });
    ok(same(o.room, WANT.room) && same(o.roomUnlocked, WANT.roomUnlocked),
      "L: THE ROOM QUEUE'S ROWS ARE AS THEY WERE (left as they are, the supervisor's proposal the owner accepted) — locked, only Now Playing's ★ and ▲; " +
      "unlocked by its own lock, each waiting row's six controls, " + k, { locked: o.room, unlocked: o.roomUnlocked });
    ok(o.outside === WANT.outside, "L: NO OTHER LIST CARRIES THE ＋'S CLASS — `pl-add` is a playlist row's alone, " + k, o.outside);
  }
});

// ═══ PART T — SIX TYPING BOXES IN THE CHAT'S TINT (`ddjp_670`; the owner, W1, W2, W3) ══════════════════════════════════
// "the grey box should probably be just greyer like how the chat section is above? along side all places where the user can
// write like invite people in people tab, my queue paste youtube link, enter playlist name in playlist, paste a youtube link in
// a particular playlist" (W1); "the box jsut become transparant witht he same more dark tint as the chat backgreound does vs its
// frame" and "the ones in room settings for example have opaque backgrounds, so they can stay grey" (W2); "also the sear people
// in DM should have a tint too" (W3). Each box read where the screen draws it, through the page's own sheet.
partAsync("T", async () => {
  const fsT = require("fs"), pathT = require("path");
  const { styleBlocks } = require("./_page-css.js");
  const tick = () => new Promise((r) => setImmediate(r));
  const PL = { id: "pl_gym", name: "Gym", tracks: [{ videoId: "ppppppppp01" }] };
  const w = screen({ playlist: PL, dms: [{ userId: "@ann:hs", lastTs: NOW - 3000, roomIds: ["!dm:hs"], roomId: "!dm:hs" }],
    chat: { openDMRoom: () => ({ ok: true }), currentDMPerson: () => "@ann:hs", currentDM: () => "!dm:hs",
            backfillDM: () => Promise.resolve({ messages: [] }), dmCaughtUp() {}, setDMLive() {}, closeDM() {} } });
  const qb = w.refs.queueBody;
  const tint = (n) => ({ background: w.decl(n, "background"), border: w.decl(n, "border") });
  const REF = tint(w.refs.chatBox);
  ok(REF.background === "rgba(12,12,16,0.45)" && REF.border === "1px solid rgba(255,255,255,0.06)",
    "T PREMISE — the chat's own box (`.chat-messages`) has the tint the brief names: rgba(12,12,16,0.45), a 1px rgba(255,255,255,0.06) frame", REF);
  const boxes = {};
  boxes["the chat's send box"] = w.refs.chatInput;
  w.sb.ChatPanels.renderDMPanel();
  boxes["the DM list's search"] = w.q(".dm-search", w.refs.dmBox);
  w.sb.ChatPanels._openDMFromAction("!dm:hs");
  boxes["a DM's send box"] = w.q(".dm-input", w.refs.dmBox);
  boxes["People's invite box"] = w.q(".invite-row input", w.main);
  w.refs.tabMine.click();
  boxes["My queue's link box"] = w.q(".uq-add input", qb);
  w.refs.tabPlaylists.click();
  boxes["the library's new-playlist name"] = w.q(".pl-lib-head input", qb);
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Gym");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();
  boxes["a playlist's link box"] = w.q("input", qb);   // the one box inside a playlist, wherever its row puts it (PART G)
  const names = Object.keys(boxes);
  ok(names.every((k) => !!boxes[k]) && /\bdm-input\b/.test(boxes["a DM's send box"].className) && /\bchat-input\b/.test(boxes["a DM's send box"].className),
    "T PREMISE — every box drawn where a person finds it, the DM's send box sharing the chat's class (`dm-input chat-input`)",
    names.map((k) => k + ": " + (boxes[k] ? boxes[k].className : null)));
  const got = names.map((k) => [k, boxes[k] ? tint(boxes[k]) : null]);
  ok(got.every(([, t]) => t && t.background === REF.background && t.border === REF.border),
    "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT — see-through, the chat's darker tint and its frame, exactly as `.chat-messages` has them, the DM's send box with the chat's",
    got.filter(([, t]) => !t || t.background !== REF.background || t.border !== REF.border));
  // ONE RULE, NOT SIX COPIES: the tint's background is declared by one rule of the page, and that rule names the chat's box too.
  const css = styleBlocks(fsT.readFileSync(pathT.join(__dirname, "..", "index.html"), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const withTint = rules.filter((r) => /background\s*:\s*rgba\(\s*12\s*,\s*12\s*,\s*16\s*,\s*0?\.45\s*\)/.test(r.body));
  const selOf = withTint.length ? withTint[0].sel.split(",").map((x) => x.trim()) : [];
  ok(withTint.length === 1 && selOf.indexOf(".chat-messages") >= 0 && names.every((k) => boxes[k] && selOf.some((sl) => boxes[k].matches(sl))),
    "T: FROM ONE SHARED RULE — the tint is declared once in the sheet, for the chat's box and the six, and every box is named by that rule",
    withTint.map((r) => r.sel));
  // NOT THESE: the room settings' boxes, the rename box and the picker's box stay opaque grey (W2).
  const GREY = { background: "#333", border: "1px solid #555" };
  const sn = w.doc.createElement("div"); sn.className = "set-num"; w.refs.settingsBox.appendChild(sn);
  const settingsBox = w.doc.createElement("input"); settingsBox.className = "uq-input"; sn.appendChild(settingsBox);
  const settingsSrc = fsT.readFileSync(pathT.join(__dirname, "..", "ui", "settings.js"), "utf8");
  ok(/H\.el\("input", \{ type: "number", class: "uq-input"/.test(settingsSrc) && !/chat-tint/.test(settingsSrc),
    "T PREMISE — the room settings build their boxes `uq-input` in a `set-num`, and nothing in ui/settings.js carries the tint's class");
  const back = w.q(".pl-back", qb); if (back) back.click();
  w.H.setPlLocked(false); w.sb.QueuePanels.renderQueuePanel();
  const rn = w.qa(".pl-row button", qb).find((b) => b.textContent === "✎");
  if (rn) rn.click();
  const renameBox = w.q(".pl-rename", qb);
  w.refs.tabHistory.click();
  const hr = w.qa(".song-row", qb)[0];
  const plus = hr ? w.kids(w.q(".uq-actions", hr)).find((n) => n.textContent === "＋") : null;
  if (plus) plus.click();
  const pickerBox = w.q(".pl-pick-card .pl-pick-new input", w.doc.body);
  const kept = [["a room settings box", settingsBox], ["the rename box", renameBox], ["the add-to-playlist picker's box", pickerBox]];
  ok(kept.every(([, n]) => !!n), "T PREMISE — the rename box and the picker's box drawn (the settings box's shape as ui/settings.js builds it)",
    kept.map(([k, n]) => k + ": " + !!n));
  ok(kept.every(([, n]) => n && tint(n).background === GREY.background && tint(n).border === GREY.border),
    "T: AND NOT THESE — the room settings' boxes, the rename box and the picker's box keep the opaque grey, #333 in a #555 frame (W2)",
    kept.map(([k, n]) => [k, n ? tint(n) : null]));
});

// ═══ PART G — A PLAYLIST'S TOP ROW (`ddjp_670`; the owner, W1) ═══════════════════════════════════════════════════════════
// "in a particular playlist we may want to change back for a single square with a back arrow, same size as the lock, then + all
// to Q change for +All button / and we may want to put the paste a link and add fields betwhen back and +all, but we would say
// the name of the playlist in the text box instead of paste a youtube link... / for example we would say playlist01 - paste a
// youtube link...". Read in the screen world; the phone's widths are Chromium's (the report).
partAsync("G", async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const PL = { id: "pl_gym", name: "Gym", tracks: ["ppppppppp01", "ppppppppp02"].map((v) => ({ videoId: v })) };
  const w = screen({ playlist: PL });
  const qb = w.refs.queueBody;
  w.refs.tabPlaylists.click();
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Gym");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();
  const head = w.q(".pl-detail-head", qb);
  const rows = () => w.qa(".pl-detail-body .song-row", qb);
  ok(nm && head && rows().length === 2, "G PREMISE — the playlist opened from the library, its two songs drawn", { head: !!head, rows: rows().length });
  // CHANGED ON PURPOSE AT ddjp_672 (the owner, C1: "i dont like to have the + inside the bar, i tought it would be its own square
  // next to it"; C4): the ＋ is its own square right after the box, so the row reads ← [box] + +All 🔒 — where ddjp_671 read the
  // box's holder as one thing, "[box +]".
  const say = (n) => (n.tag === "input" ? "[box]" : /\bpanel-lock-btn\b/.test(n.className) ? "lock" : n.textContent.replace(/︎/g, ""));
  const line = () => { const h = w.q(".pl-detail-head", qb); const out = []; if (!h) return out;
    for (const c of w.kids(h)) { if (/\buq-actions\b/.test(c.className)) out.push(...w.kids(c)); else out.push(c); } return out; };
  ok(head && same(line().map(say), ["←", "[box]", "+", "+All", "lock"]),
    "G: ONE ROW, IN THE OWNER'S ORDER — ←, the link box, the ＋ as its own square, +All, the lock (C1, C4)", line().map(say));
  const back = w.q(".pl-back", head), lock = w.q(".panel-lock-btn", head), box = w.q("input", head);
  // CHANGED ON PURPOSE AT ddjp_672 (the owner, C4: "make sure the back button in the specific playlist is square not rectagle"):
  // ← was the lock's 34 × 30 (W1, ddjp_670), a rectangle; it is a 30 × 30 square now, the row's height (the box's). The lock keeps
  // its 34 × 30 — the owner did not choose to change it.
  const pxOf = (n, p) => { const v = String(w.decl(n, p) || ""); return /^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : (v === "0" ? 0 : NaN); };
  const sq = (n) => n ? { w: pxOf(n, "width"), minW: pxOf(n, "min-width"), h: pxOf(n, "height"), pad: w.decl(n, "padding") } : null;
  const rowH = box ? pxOf(box, "height") : NaN;
  ok(back && sq(back).w === 30 && sq(back).h === 30 && sq(back).minW === 30 && rowH === 30 && sq(back).pad === "0",
    "G: ← IS A TRUE SQUARE, 30 × 30, THE ROW'S HEIGHT — not the lock's 34 × 30 (C4; DECLARED, read off the sheet)", { back: sq(back), rowH });
  ok(lock && pxOf(lock, "width") === 34 && pxOf(lock, "height") === 30,
    "G CONTROL: the lock is as it was, 34 × 30 (not changed: the owner did not choose)", lock && [w.decl(lock, "width"), w.decl(lock, "height")]);
  ok(back && back.textContent === "←" && back.getAttribute("title") === "Back to playlists",
    "G: and it reads only the arrow, its name in its tooltip", back && [back.textContent, back.getAttribute("title")]);
  ok(box && box.placeholder === "Gym - paste a youtube link...",
    "G: THE BOX'S HINT IS THE PLAYLIST'S NAME AS THE LIST SHOWS IT, then \" - paste a youtube link...\" (his example: \"playlist01 - paste a youtube link...\")", box && box.placeholder);
  ok(!w.q(".pl-detail-title", qb) && !/Gym/.test(head ? w.kids(head).filter((n) => n.tag !== "input").map((n) => n.textContent).join("") : "Gym"),
    "G: THE SEPARATE TITLE IS GONE — the name is in the empty box only", head && head.textContent);
  ok(w.qa(".uq-add", qb).length === 0 && !w.qa("input", qb).some((n) => n !== box),
    "G: THE OLD SECOND ROW IS GONE — no add line under the row, one box in the pane", w.qa(".uq-add", qb).length);
  // CHANGED ON PURPOSE AT ddjp_672 (C1): the box is the row's own child again, with no holder and no right padding kept for a ＋.
  ok(box && box.parent === head && w.decl(box, "flex") === "1" && w.decl(box, "min-width") === "0" && w.decl(box, "text-overflow") === "ellipsis" &&
     w.decl(box, "padding-right") === null && w.decl(box, "padding") === "0 8px" && !w.q(".pl-link-box", qb),
    "G: the box takes what the row leaves, and its hint is cut with \"…\" — no holder, and its padding .uq-input's on both sides " +
    "(DECLARED; measured at 360 and 390 px in Chromium)",
    box && { parentIsRow: box.parent === head, flex: w.decl(box, "flex"), minW: w.decl(box, "min-width"), to: w.decl(box, "text-overflow"),
      padR: w.decl(box, "padding-right"), pad: w.decl(box, "padding"), holder: !!w.q(".pl-link-box", qb) });
  // ── THE ＋, ITS OWN SQUARE NEXT TO THE BOX (`ddjp_672`; the owner, C1: "no dont leave it, also i dont like to have the + inside the
  // bar, i tought it would be its own square  next to it"; C4: "... and that the + is its one square next to the search bar not
  // small in it") ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const kids = head ? w.kids(head) : [];
  const plus = kids[2] && /\bpl-link-add\b/.test(kids[2].className) ? kids[2] : null;
  ok(plus && kids[1] === box && plus.parent === head && plus.tag === "button" && plus.textContent === "+" && !line().some((n) => n.textContent === "Add"),
    "G: THE ＋ IS ITS OWN SQUARE RIGHT AFTER THE BOX — a button of the row, not inside the box; \"+\" only; no \"Add\" on the row (C1)",
    kids.map((n) => [n.tag, n.className, n.textContent]));
  ok(plus && plus.getAttribute("title") === "Add to this playlist" && plus.getAttribute("aria-label") === "Add to this playlist",
    "G: its title and its aria-label say what it does — \"Add to this playlist\"", plus && [plus.getAttribute("title"), plus.getAttribute("aria-label")]);
  ok(plus && sq(plus).w === 30 && sq(plus).h === 30 && sq(plus).minW === 30 && sq(plus).pad === "0" && w.decl(plus, "position") !== "absolute" &&
     JSON.stringify(sq(plus)) === JSON.stringify(sq(back)),
    "G: AND IT IS A TRUE SQUARE, 30 × 30, THE ROW'S HEIGHT — ←'s size, placed by the row, not over the box (C4: \"not small in it\")",
    { plus: sq(plus), back: sq(back), pos: plus && w.decl(plus, "position") });
  ok(plus && w.decl(plus, "background") === "#5865F2" && w.decl(plus, "color") === "#fff",
    "G: AND IT IS BLUE, ITS \"+\" WHITE — Add's blue (L1: \"add blue button\")", plus && [w.decl(plus, "background"), w.decl(plus, "color")]);
  // ── EACH GLYPH CENTRED IN ITS SQUARE (`ddjp_672`; the owner, C1: "no dont leave it" — the ＋ sat high, measured) ─────────────────
  // A font puts "+" and "←" where its own metrics say, so no centring of the text can promise the ink is centred, on every font. The
  // square's character is kept as its text, at size 0, and the glyph is the square's `::before`: a box the flex line centres, the
  // size of its drawing's viewBox, the drawing's ink centred in that viewBox — read here from its path and stroke, so the centring
  // holds whatever the font. The pixels are Chromium's (the report: the ink's centre against the painted square's).
  const sheet = S.readSheet(require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8"));
  const pseudo = (sel, prop) => { let v = null; for (const r of sheet) if (r.sel === sel && r.decls[prop]) v = r.decls[prop].val; return v; };
  const svgOf = (v) => { const m = /url\("data:image\/svg\+xml,([^"]+)"\)/.exec(v || ""); return m ? decodeURIComponent(m[1]) : null; };
  // The ink box of a path of straight lines (M L H V and their lower-case forms, Z), widened by half its stroke where stroked.
  function inkBox(svg) {
    if (!svg) return null;
    const vb = (/viewBox='([^']+)'/.exec(svg) || [])[1], d = (/ d='([^']+)'/.exec(svg) || [])[1];
    if (!vb || !d) return null;
    const stroked = /stroke='(?!none)[^']+'/.test(svg), sw = stroked ? parseFloat((/stroke-width='([^']+)'/.exec(svg) || [])[1] || "1") : 0;
    const t = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+/g) || [];
    let x = 0, y = 0, sx = 0, sy = 0, cmd = null, i = 0; const pts = [];
    const num = () => parseFloat(t[i++]);
    while (i < t.length) {
      if (/[A-Za-z]/.test(t[i])) cmd = t[i++];
      if (cmd === "Z" || cmd === "z") { x = sx; y = sy; continue; }
      if (cmd === "M" || cmd === "L") { x = num(); y = num(); }
      else if (cmd === "m" || cmd === "l") { x += num(); y += num(); }
      else if (cmd === "H") x = num(); else if (cmd === "h") x += num();
      else if (cmd === "V") y = num(); else if (cmd === "v") y += num();
      else return null;
      if (cmd === "M" || cmd === "m") { sx = x; sy = y; cmd = cmd === "M" ? "L" : "l"; }
      pts.push([x, y]);
    }
    const v = vb.split(/\s+/).map(Number), h = sw / 2;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { vb: v, ink: [Math.min(...xs) - h, Math.min(...ys) - h, Math.max(...xs) + h, Math.max(...ys) + h] };
  }
  const glyph = (cls) => {
    const sel = ".pl-detail-head ." + cls + "::before", ib = inkBox(svgOf(pseudo(sel, "mask-image"))), wk = svgOf(pseudo(sel, "-webkit-mask-image"));
    const W = parseFloat(pseudo(sel, "width")), Hh = parseFloat(pseudo(sel, "height"));
    return { content: pseudo(sel, "content"), fill: pseudo(sel, "background"), size: [W, Hh], vb: ib && ib.vb, ink: ib && ib.ink,
      maskPos: pseudo(sel, "mask-position"), maskSize: pseudo(sel, "mask-size"), sameForWebkit: wk === svgOf(pseudo(sel, "mask-image")),
      dx: ib ? (ib.ink[0] + ib.ink[2]) / 2 - (ib.vb[0] + ib.vb[2] / 2) : NaN, dy: ib ? (ib.ink[1] + ib.ink[3]) / 2 - (ib.vb[1] + ib.vb[3] / 2) : NaN };
  };
  for (const [n, cls, name] of [[back, "pl-back", "←"], [plus, "pl-link-add", "＋"]]) {
    const g = glyph(cls);
    ok(n && w.decl(n, "font-size") === "0" && w.decl(n, "display") === "inline-flex" && w.decl(n, "align-items") === "center" && w.decl(n, "justify-content") === "center",
      "G: " + name + "'S CHARACTER STAYS ITS TEXT, AT SIZE 0, AND THE SQUARE'S FLEX LINE CENTRES WHAT IT DRAWS (DECLARED)",
      n && ["font-size", "display", "align-items", "justify-content"].map((p) => [p, w.decl(n, p)]));
    ok(g.content === '""' && g.fill === "currentColor" && g.vb && g.size[0] === g.vb[2] && g.size[1] === g.vb[3] && g.maskPos === "center" &&
       g.maskSize === "100% 100%" && g.sameForWebkit && Math.abs(g.dx) <= 0.01 && Math.abs(g.dy) <= 0.01 &&
       g.ink[0] >= 0 && g.ink[1] >= 0 && g.ink[2] <= g.vb[2] && g.ink[3] <= g.vb[3],
      "G: AND " + name + "'S GLYPH IS CENTRED IN ITS SQUARE — its drawing the size of its box, in the button's colour, its ink centred in it " +
      "from the path and the stroke, whatever the font (C1: \"no dont leave it\")", g);
  }
  // EVERYTHING THE LINK BOX AND ADD DID, THEY STILL DO.
  // CHANGED ON PURPOSE AT ddjp_671 (the owner, L1): Add is the ＋ now; a click on it does what Add did. AT ddjp_672 (C1) the ＋ is
  // found as the row's own square.
  if (!box) return;
  box.value = "https://youtu.be/abcdefghijk";
  const add = w.q(".pl-detail-head > .pl-link-add", qb);
  if (add) add.click();
  for (let i = 0; i < 4; i++) await tick();
  ok(same(w.st.addedByLink, [["pl_gym", "https://youtu.be/abcdefghijk"]]), "G: THE ＋ ADDS THE LINK TO THIS PLAYLIST, as Add did", w.st.addedByLink);
  const box2 = w.q("input", qb);
  // CHANGED ON PURPOSE AT ddjp_671: Enter's add is counted from what was added before it, so this row reads Enter alone and does
  // not go red with the ＋ row above it.
  const before = (w.st.addedByLink || []).length;
  box2.value = "https://youtu.be/bbbbbbbbbbb";
  if (box2.onkeydown) box2.onkeydown({ key: "Enter" });
  for (let i = 0; i < 4; i++) await tick();
  const added = w.st.addedByLink || [];
  ok(added.length === before + 1 && same(added[added.length - 1], ["pl_gym", "https://youtu.be/bbbbbbbbbbb"]), "G: and Enter in the box adds too", added);
  // "+All": its two clicks unchanged — the ✔ shown to its left, a second click cancels.
  const allBtn = () => line().find((n) => n.textContent === "+All") || null;
  if (allBtn()) allBtn().click();
  // CHANGED ON PURPOSE AT ddjp_671 (L3: "keep the confirmation button appearing to confirm add all"), AND AT ddjp_672 (C1): the
  // row reads with the ＋ as its own square; the ✔ still shows left of +All, and +All again cancels.
  ok(same(line().map(say), ["←", "[box]", "+", "✔", "+All", "lock"]), "G: \"+All\" CLICKED SHOWS THE GREEN ✔ TO ITS LEFT, as before", line().map(say));
  if (allBtn()) allBtn().click();
  ok(same(line().map(say), ["←", "[box]", "+", "+All", "lock"]), "G: and clicked again it cancels", line().map(say));
  // ← STILL GOES BACK to the library.
  const bk = w.q(".pl-back", qb); if (bk) bk.click();
  ok(!w.q(".pl-detail-head", qb) && w.qa(".pl-name", qb).length === 1, "G: ← GOES BACK TO THE LIBRARY", qb.textContent.slice(0, 80));
});

// ═══ PART E — AN EMPTY PLAYLIST SAYS NOTHING (`ddjp_670`; the owner, W1: "also no more No songs yet — paste a link above, or
// use the ＋ on a song in History or Now Playing. when empty") ══════════════════════════════════════════════════════════════
partAsync("E", async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const w = screen({ playlist: { id: "pl_e", name: "Empty one", tracks: [] } });
  const qb = w.refs.queueBody;
  w.refs.tabPlaylists.click();
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Empty one");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();
  const body = w.q(".pl-detail-body", qb);
  ok(nm && body && w.q("input", qb), "E PREMISE — an empty playlist opened, its link box and its list drawn", { body: !!body });
  ok(body && body.textContent === "" && w.kids(body).length === 0 && !/No songs yet/.test(qb.textContent),
    "E: AN EMPTY PLAYLIST SHOWS NO TEXT — \"No songs yet — paste a link above, …\" is gone, and nothing replaces it", body && body.textContent);
  const PL = { id: "pl_f", name: "Full", tracks: [{ videoId: "ppppppppp01" }] };
  const w2 = screen({ playlist: PL });
  w2.refs.tabPlaylists.click();
  const nm2 = w2.qa(".pl-name", w2.refs.queueBody)[0]; if (nm2) nm2.click();
  for (let i = 0; i < 6; i++) await tick();
  ok(w2.qa(".pl-detail-body .song-row", w2.refs.queueBody).length === 1, "E CONTROL: a playlist with a song still draws it", w2.refs.queueBody.textContent.slice(0, 60));
});

// ═══ PART S — SEE-THROUGH ROWS, ALWAYS, AS DARK AS THE CHAT BOX (`ddjp_678`; the owner's) ══════════════════════════════
// "whle the woerker is working, show me what it would look like if the playlists , inside playlist songs, all room q songs my Q
// songs and history songs, DMs , logs background was transparant"; shown that, "well it can gain some darkness like how settings
// are darker in pannels then the background or chat box"; shown two darknesses, "i think we can go with chat"; and "also we didnt
// do the dm playlsit and songs ones that i wanted", "sorry not feed but logs". So, locked or not: every song row (the room
// queue's — Now Playing's and the empty play row included — My queue's, History's, a playlist's), the library's rows, the DM
// list's rows and the Logs box take the chat box's darkness, from the chat box's own rule; each keeps its frame (the playing row
// its blue edge), its text, buttons and pictures; DM rows change in DMs only — the room list keeps `.room-item`'s #222; and they
// sit on the panel, so they follow the Panel dimness slider as the chat box does. DECLARED (the cascade); what Chromium draws —
// computed backgrounds and a pixel in each, over a room background, at 360, 390 and 1400 px — is in the report.
partAsync("S", async () => {
  const fsS = require("fs"), pathS = require("path");
  const SHEET = S.readSheet(fsS.readFileSync(pathS.join(__dirname, "..", "index.html"), "utf8"));
  const tick = () => new Promise((r) => setImmediate(r));
  const PL = { id: "pl_gym", name: "Gym", tracks: [{ videoId: "ppppppppp01" }, { videoId: "ppppppppp02" }] };
  const w = screen({ playlist: PL, dms: [{ userId: "@ann:hs", lastTs: NOW - 3000, roomIds: ["!dm1:hs"], roomId: "!dm1:hs" },
                                         { userId: "@bob:hs", lastTs: NOW - 9000, roomIds: ["!dm2:hs"], roomId: "!dm2:hs", unread: true }] });
  const qb = w.refs.queueBody;
  // The rule a declaration came from, as one rule: the selectors of one list share their declarations.
  const ruleOf = (n, prop) => { const sel = w.rule(n, prop); const r = sel ? SHEET.find((x) => x.sel === sel && x.decls[prop]) : null; return r ? r.decls : null; };
  const REF = { val: w.decl(w.refs.chatBox, "background"), rule: ruleOf(w.refs.chatBox, "background") };
  ok(REF.val === "rgba(12,12,16,0.45)" && !!REF.rule, "S PREMISE — the chat box's own darkness, rgba(12,12,16,0.45), from its own rule (`.chat-messages` …)", REF.val);
  // Each row is taken as it is drawn, and whether it sits on the panel is read then: the next tab's drawing detaches it.
  const panelOf = (x, n) => { for (let p = n && n.parent; p; p = p.parent) { const b = x.decl(p, "background"); if (b && /var\(--panel-dim/.test(b)) return p; } return null; };
  const onPanel = new Map();
  const rows = new Proxy({}, { set(t, k, v) { t[k] = v; if (v) onPanel.set(v, !!panelOf(w, v)); return true; } });
  const first = (sel, root) => w.q(sel, root || qb);
  w.refs.tabRoom.click();
  rows["Now Playing's row"] = first(".rq-list .song-row.playing");
  rows["a waiting row"] = w.qa(".rq-list .song-row", qb)[1] || null;
  const we = screen({ playing: null });
  we.refs.tabRoom.click();
  const emptyRow = we.q(".rq-list .song-row.rq-np-empty", we.refs.queueBody);
  if (emptyRow) onPanel.set(emptyRow, !!panelOf(we, emptyRow));
  w.refs.tabMine.click();
  rows["My queue's row"] = first(".song-row");
  w.refs.tabHistory.click();
  rows["History's row"] = first(".hist-list .song-row");
  w.refs.tabPlaylists.click();
  rows["the library's row"] = first(".pl-row");
  const nm = w.qa(".pl-name", qb).find((b) => b.textContent === "Gym");
  if (nm) nm.click();
  for (let i = 0; i < 6; i++) await tick();
  rows["a playlist's song"] = first(".song-row");
  w.sb.ChatPanels.renderDMPanel();
  rows["a DM conversation"] = first(".dm-row", w.refs.dmBox);
  rows["an unread DM"] = first(".dm-row.unread", w.refs.dmBox);
  const search = first(".dm-search", w.refs.dmBox);
  const type = (q) => { if (!search) return; search.value = q; if (search.oninput) search.oninput(); };
  type("@zed:hs");
  rows["the \"Start a chat\" row"] = first(".dm-row.dm-start:not(.dm-suggest)", w.refs.dmBox);
  type("ca");
  rows["a suggested person"] = first(".dm-row.dm-suggest", w.refs.dmBox);
  type("");
  rows["the Logs box"] = w.refs.logsBox;
  const looksFor = { "the empty play row": [we, emptyRow] };
  for (const k of Object.keys(rows)) looksFor[k] = [w, rows[k]];
  const names = Object.keys(looksFor);
  ok(names.every((k) => !!looksFor[k][1]), "S PREMISE — every list drew its row where a person finds it, and the Logs box is there",
    names.map((k) => k + ": " + (looksFor[k][1] ? looksFor[k][1].className : null)));
  const bgOf = (x, n) => ({ val: x.decl(n, "background"), rule: (() => { const sel = x.rule(n, "background"); const r = sel ? SHEET.find((y) => y.sel === sel && y.decls.background) : null; return r ? r.decls : null; })() });
  const notTint = names.filter((k) => { const [x, n] = looksFor[k]; const b = n ? bgOf(x, n) : null; return !b || b.val !== REF.val || b.rule !== REF.rule; });
  ok(notTint.length === 0, "S: EVERY ROW TAKES THE CHAT BOX'S DARKNESS, FROM THE CHAT BOX'S OWN RULE — song rows in every list (Now Playing's and the empty play row too), the library's rows, the DM list's rows and the Logs box, locked or not",
    notTint.map((k) => [k, looksFor[k][1] ? bgOf(looksFor[k][0], looksFor[k][1]).val : null]));
  // EACH KEEPS ITS FRAME: its own border, never the chat box's.
  const OWN = { song: "1px solid #2a2a2a", dm: "1px solid #333" };
  const want = (k) => (/DM|Start|suggested/.test(k) ? OWN.dm : OWN.song);
  const frameBad = names.filter((k) => { const [x, n] = looksFor[k]; return !n || x.decl(n, "border") !== want(k); });
  const pr = rows["Now Playing's row"], st = rows["the \"Start a chat\" row"];
  ok(frameBad.length === 0 && pr && w.decl(pr, "border-color") === "#5865F2" && st && w.decl(st, "border-style") === "dashed",
    "S: EACH KEEPS ITS FRAME — its own border, not the chat box's; the playing row its blue edge, the \"Start a chat\" row its dashes",
    { bad: frameBad.map((k) => [k, looksFor[k][1] && looksFor[k][0].decl(looksFor[k][1], "border")]), playing: pr && w.decl(pr, "border-color") });
  // TEXT, BUTTONS, PICTURES AS THEY ARE: nothing inside a row takes the darkness; the picture's square, the title's colour kept.
  const all = (n, out) => { out = out || []; for (const c of (n ? w.kids(n) : [])) { out.push(c); all(c, out); } return out; };
  const inside = names.reduce((acc, k) => acc.concat(all(looksFor[k][1]).map((c) => [k, looksFor[k][0], c])), []);
  const tinted = inside.filter(([, x, c]) => { const b = bgOf(x, c); return b.rule === REF.rule; });
  const pic = first(".thumb-slot", rows["a waiting row"]), title = first(".sr-title", rows["a waiting row"]);
  ok(inside.length > 20 && tinted.length === 0 && pic && w.decl(pic, "background") === "#26262c" && title && w.decl(title, "color") === "#ddd",
    "S: TEXT, BUTTONS AND PICTURES AS THEY ARE — nothing inside a row takes the darkness; the picture's square #26262c, the title #ddd",
    { inside: inside.length, tinted: tinted.slice(0, 3).map(([k, , c]) => k + ": " + c.className), pic: pic && w.decl(pic, "background"), title: title && w.decl(title, "color") });
  // NONE OF THEM HAS A BACKGROUND OF ITS OWN LEFT: the chat box's rule is the one that holds, not one that happens to win.
  const OWNSEL = [".song-row", ".pl-row", ".dm-row", ".logs-box", ".player-shield.waiting"];
  const stray = SHEET.filter((r) => OWNSEL.indexOf(r.sel) >= 0 && (r.decls.background || r.decls["background-color"]) && r.decls !== REF.rule);
  ok(stray.length === 0, "S: AND NONE OF THEM KEEPS A BACKGROUND OF ITS OWN IN THE SHEET — the chat box's rule is theirs", stray.map((r) => r.sel + " " + JSON.stringify(r.decls.background || r.decls["background-color"])));
  // DMs ONLY: the room list the app opens on keeps `.room-item`'s look, and its hover.
  const listEl = w.doc.createElement("div"); listEl.id = "room-list"; w.doc.body.appendChild(listEl);
  let threw = null;
  try { w.sb.Screens.renderRoomList({ owned: [{ spaceId: "!a:hs", name: "Room A" }], joined: [{ spaceId: "!b:hs", name: "Room B" }], invited: [], unconfirmed: [] }); } catch (e) { threw = e.message; }
  const rooms = w.qa(".room-item", listEl);
  ok(threw === null && rooms.length >= 2, "S PREMISE — the room list drew its rooms (`Screens.renderRoomList`, the real one)", { threw, rooms: rooms.length });
  const css = SHEET;
  const hoverOf = (sel) => { const r = css.find((x) => x.sel === sel && x.decls.background); return r ? r.decls.background.val : null; };
  ok(rooms.length && rooms.every((n) => w.decl(n, "background") === "#222") && hoverOf(".room-item:hover") === "#2a2a2a",
    "S: DM ROWS CHANGE IN DMs ONLY — the room list's rows keep `.room-item`'s #222, and its hover #2a2a2a", { rooms: rooms.map((n) => w.decl(n, "background")), hover: hoverOf(".room-item:hover") });
  const alphaOf = (v) => { const m = String(v || "").match(/rgba\(([^)]+)\)/); return m ? parseFloat(m[1].split(",")[3]) : (v ? 1 : 0); };
  const dh = hoverOf(".dm-row:hover");
  ok(dh && alphaOf(dh) < 1, "S: AND A DM ROW'S HOVER IS SEE-THROUGH TOO — a light wash, not a solid colour over the darkness (DECLARED: the cascade reads no :hover)", dh);
  // ON THE PANEL: each row's darkness is see-through, over a column whose own background is the Panel dimness slider's, as the
  // chat box's is — so the slider moves them as it moves the chat box.
  const chatPanel = panelOf(w, w.refs.chatBox);
  ok(!!chatPanel, "S PREMISE — the chat box sits on a panel whose background is the Panel dimness slider's (`--panel-dim`)", chatPanel && chatPanel.className);
  const offPanel = names.filter((k) => { const [x, n] = looksFor[k]; return !n || alphaOf(x.decl(n, "background")) >= 1 || !onPanel.get(n); });
  ok(offPanel.length === 0, "S: THEY SIT ON THE PANEL AND FOLLOW ITS DIMNESS, AS THE CHAT BOX DOES — see-through, each over a panel the slider sets",
    offPanel.map((k) => [k, looksFor[k][1] && looksFor[k][0].decl(looksFor[k][1], "background")]));
});

Promise.all(pending).then(() => {
if (failed) { console.log("[list-look] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[list-look] PASS — the queue pane's lists have one look (J131 B, the owner's at `ddjp_654`; " + asserts + " assertions): the room " +
  "queue is one list under a line that keeps Reset, the \"Now Playing\" tag and the lock — Now Playing its first row, with ▶, the DJ on its " +
  "sub line in the DJ's colour, the blue edge, ★ and ▲, then the waiting songs numbered on, every row My queue's row at its size and the " +
  "rows together; with nothing playing the first row is an empty play row at the playing row's size — its picture's square empty, ▶, no title, " +
  "★ and ▲ greyed with no numbers, inert — the playing row's and the Player's own ★ and ▲ as they were. History is one list at the same size, " +
  "\"skipped\" in the moderation teal chat uses and its ▲ and ★ counts in the colours the ▲ and ★ buttons give theirs, all from the " +
  "stylesheet; its counts in a spot of their own left of the ＋, one width on every row, on one line, ▲ in the left half and ★ in the right, " +
  "each centred, 0 where there are none and 99 over 99 while the fold keeps the real number and Now Playing shows it, its record holding " +
  "the counts as shown; and its line giving way in the owner's order — " +
  "the age's short form with \"ago\", its shortest, then the name's end — only as far as needed, back when room returns, kept by the age " +
  "tick, with the DM list's times and the other lists unchanged; the whole first minute \"just now\" (History's \"now\"), then \"1 min ago\", " +
  "never \"0 mins ago\". A playlist's row shows no ＋ while unlocked (▲ ▼ | ⏫ ⏬ | ✕) and ＋ | ✕ " +
  "locked, flipped by the list's class alone on the same rows, History's ＋, My queue's and the room queue's rows as they were. The six typing " +
  "boxes take the chat's tint from one rule, the settings', rename and picker boxes their grey; every song row, the library's rows, the DM " +
  "list's rows and the Logs box take the chat box's darkness from its rule, see-through on the panel, each its own frame, the room list " +
  "as it was; History's 0 in its line's grey; a playlist's top row is ← (the lock's size), " +
  "its link box hinting its name, Add, +All and the lock, with no title or second row, and an empty playlist says nothing. Every row is drawn at My queue's height, read as a browser reads the page — its first rule, `* { box-sizing: border-box }`, " +
  "which the reader once lost (the owner saw 44 px rows where this read 58), a comment skipped only where one can begin (not inside a " +
  "style rule or a script). And the phone layout's frame and columns are border-box by that rule, so they fit the screen. No other " +
  "reader in tests/ or tools/ cuts the stylesheet out of the page on its own.");
});
