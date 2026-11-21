// tests/check-song-words.js
// SUBJECT: core/, features/, ui/, backends/, app.js, sw.js, sw-register.js, index.html
//
// WALL: THE APP SAYS "SONG", AND ITS NAMES DO TOO (J29, step 3; the owner's words, `main/01-project.md` item 3: "use the word
// media not song", then "ok just use song"). Outside YouTube's own player file (`ui/youtube.js`), no code name, no string a
// person reads, no reason token, no stored key, and no id or class of the page says "video" or "YouTube" — or "yt" as a
// name's part (`_ytVol`, `YT_VOLUME_POLL_MS`, which said YouTube by abbreviation). Comments and quoted records aside: the app
// files are TOKENIZED (espree, which the lint guard already requires), so only names and literals are read, and the page is
// read with its comments taken out.
//
// WHERE YOUTUBE'S NAME STAYS, BY NAME, EACH CUT OUT BY ITS DECLARATION (an anchor that moves refuses the guard by name):
//   ui/youtube.js         YouTube's player: its script, its calls (`loadVideoById`, `getVideoData`, `video_id`), its codes,
//                         and a failure reason that says YouTube refused ("YouTube error 150", in the log).
//   core/songs.js         YouTube's ROW in the table of services and the three helpers its row is written with (`YT_ID`,
//                         `_ytClean`, `_ytLink`): YouTube's id rule, its link forms, its hosts and its player file are YouTube's.
//   core/chatprefs.js     chat's link groups (`LINK_HOST_GROUPS`): which sites a chat link may come from — its "Video" group is
//                         YouTube's own heading for youtube.com, a chat matter, not a song's.
//   features/chat.js      chat's tracking table (`LINK_TRACKING`): which parameters a youtube.com link in chat drops.
//   index.html            its allowed hosts (the CSP's `script-src` and `frame-src`) and its player lines, which name YouTube's
//                         hosts and player file because the table does (`check-player-plug`).
// Each part runs its check on a fixture first, so a zero below is a reading of the files and not of a blind scan.
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./_load");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[song-words] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got).slice(0, 1500));
}
let espree = null;
try { espree = require("espree"); } catch (e) { espree = null; }
// THE TWENTY-SIXTH SIGNATURE: a dependency-backed guard fails when its dependency is absent, naming the one command.
ok(!!espree, "PREMISE — `espree` (installed with eslint) must load: run `npm install`. A scan that cannot read the language " +
  "would pass while checking nothing");
if (!espree) { console.log("[song-words] " + failed + " failure(s)"); process.exit(1); }

// What says a video or YouTube: in a NAME, "video", "youtube", or "yt" as a part of it (`_ytVol`, `_pollYtVolume`, `YT_…`);
// in a LITERAL (a string, a template, a pattern), "video" or "youtube".
const NAME_PART = (n) => /video|youtube/i.test(n) || /(?:^|_)yt(?=[A-Z_]|$)|(?:^|[a-z0-9])Yt(?=[A-Z])|(?:^|_)YT(?=_|$)/.test(n);
const LIT_RE = /video|youtube/i;

const EXEMPT_FILE = "ui/youtube.js";
// THE CUTS: [kind, name] — `const NAME = <expression>;` or `function NAME(...) {...}`, each found exactly once.
const CUTS = {
  "core/songs.js": [["const", "YT_ID"], ["function", "_ytClean"], ["function", "_ytLink"], ["const", "SERVICES"]],
  "core/chatprefs.js": [["const", "LINK_HOST_GROUPS"]],
  "features/chat.js": [["const", "LINK_TRACKING"]],
};
function tokensOf(src) { return espree.tokenize(src, { ecmaVersion: "latest", sourceType: "script", loc: true }); }
// The token indices a declaration spans: from its keyword to its end — the `;` closing a `const` at depth 0, or the `}`
// closing a function's body.
function cutRange(toks, kind, name) {
  const at = [];
  for (let i = 0; i + 1 < toks.length; i++) if (toks[i].type === "Keyword" && toks[i].value === kind && toks[i + 1].value === name) at.push(i);
  if (at.length !== 1) return { refused: "`" + kind + " " + name + "` is declared " + at.length + " time(s), expected exactly 1" };
  let d = 0, k = at[0] + 2, seenBody = false;
  for (; k < toks.length; k++) {
    const v = toks[k].value, p = toks[k].type === "Punctuator";
    if (p && (v === "(" || v === "[" || v === "{")) { d++; if (v === "{") seenBody = true; }
    else if (p && (v === ")" || v === "]" || v === "}")) { d--; if (kind === "function" && seenBody && d === 0 && v === "}") break; }
    else if (p && v === ";" && d === 0 && kind === "const") break;
  }
  return { from: at[0], to: k };
}
function findings(rel, src, cuts) {
  const toks = tokensOf(src);
  const drop = new Set(), refused = [];
  for (const [kind, name] of (cuts || [])) {
    const r = cutRange(toks, kind, name);
    if (r.refused) { refused.push(rel + ": " + r.refused); continue; }
    for (let i = r.from; i <= r.to; i++) drop.add(i);
  }
  const hits = [];
  toks.forEach((t, i) => {
    if (drop.has(i)) return;
    if (t.type === "Identifier" && NAME_PART(t.value)) hits.push(rel + ":" + t.loc.start.line + " name " + t.value);
    if ((t.type === "String" || t.type === "Template" || t.type === "RegularExpression") && LIT_RE.test(t.value)) hits.push(rel + ":" + t.loc.start.line + " " + t.value.slice(0, 80));
  });
  return { hits, refused };
}
function appFiles() {
  const out = [];
  const walk = (rel) => {
    for (const n of fs.readdirSync(path.join(ROOT, rel)).sort()) {
      const r = rel + "/" + n;
      if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (n.endsWith(".js")) out.push(r);
    }
  };
  for (const d of ["core", "features", "ui", "backends"]) walk(d);
  for (const f of ["app.js", "sw.js", "sw-register.js"]) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}

// ═══ PART A — the app's code: names, words, reason tokens, stored keys ════════════════════════════════════════════════
{
  // THE CONTROL BEFORE THE ZERO: on a fixture, every kind of finding is found, a comment is not, and a cut cuts.
  const fx = "// a video, YouTube's, in a comment\nconst videoTitle = 1;\nconst _ytVol = 2;\nconst w = \"Hide the video\";\n" +
    "const r = { reason: \"no-video\" };\nconst prefs = { videoHidden: true };\nconst bytes = 3; const byTime = 4; const _bgApplyToggle = 5;\n" +
    "const KEPT = [\"youtube.com\"];\n";
  const f = findings("(fixture)", fx, [["const", "KEPT"]]);
  const kinds = f.hits.map((h) => h.replace(/^\(fixture\):\d+ /, ""));
  ok(f.refused.length === 0 && JSON.stringify(kinds) === JSON.stringify(["name videoTitle", "name _ytVol", "\"Hide the video\"", "\"no-video\"", "name videoHidden"]),
    "A CONTROL — on a fixture, a name, a `yt` name part, a word, a reason token and a stored key are found; a comment, `bytes`, " +
    "`byTime`, `_bgApplyToggle` and a cut declaration are not", kinds);
  const files = appFiles();
  ok(files.indexOf(EXEMPT_FILE) >= 0 && files.length > 60, "A PREMISE — the walk finds the app's files, YouTube's player among them", files.length);
  // And the scan sees YouTube where it is: in its own file, and in each cut before it is cut.
  const own = findings(EXEMPT_FILE, fs.readFileSync(path.join(ROOT, EXEMPT_FILE), "utf8"), []);
  ok(own.hits.length >= 5, "A CONTROL — the scan finds YouTube in YouTube's own player file, the one exemption by file", own.hits.length);
  for (const rel of Object.keys(CUTS)) {
    const raw = findings(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), []);
    ok(raw.hits.length > 0, "A CONTROL — before its cuts, " + rel + " shows what the cuts hold, so each cut cuts something", raw.hits.length);
  }
  const all = [], refused = [];
  for (const rel of files) {
    if (rel === EXEMPT_FILE) continue;
    const r = findings(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), CUTS[rel]);
    refused.push(...r.refused);
    all.push(...r.hits);
  }
  ok(refused.length === 0, "A REFUSED — a declaration this guard cuts out by name was not found as written; the cut would go stale in " +
    "silence (the fifty-second signature)", refused);
  ok(all.length === 0, "A — NO CODE NAME, WORD, REASON TOKEN OR STORED KEY OUTSIDE YOUTUBE'S PLAYER FILE SAYS \"VIDEO\" OR \"YOUTUBE\" " +
    "(the owner's: \"ok just use song\"; YouTube's row and chat's link tables aside)", all);
}

// ═══ PART B — the page: its ids, classes, attributes and words ═══════════════════════════════════════════════════════
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  // Its comments out, CSS comments out, its allowed hosts out, its player lines out (each the table's, `check-player-plug`).
  const page = (h) => {
    let t = h.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    t = t.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/i, "");
    t = t.replace(/<script src="ui\/[a-z0-9-]+\.js\?v=\d+"><\/script>/g, (m) => (/youtube/i.test(m) ? "" : m));
    return t;
  };
  const scan = (h) => { const out = []; const re = /video|youtube/gi; const t = page(h); let m; while ((m = re.exec(t))) out.push(t.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " ")); return out; };
  const fx = "<!-- a video -->\n<style>/* video */ .song-title { } .video-x { }</style><span class=\"video-y\">Hide the video</span>";
  ok(scan(fx).length === 3, "B CONTROL — on a fixture, a class in the sheet, a class on an element and a word are found; comments are not", scan(fx));
  const hits = scan(html);
  ok(hits.length === 0, "B — THE PAGE'S IDS, CLASSES AND WORDS SAY NEITHER \"VIDEO\" NOR \"YOUTUBE\" (its allowed hosts and its player " +
    "lines aside)", hits);
}

if (failed) { console.log("[song-words] " + failed + " failure(s)"); process.exit(1); }
console.log("[song-words] PASS — the app says \"song\" (" + asserts + " assertions): outside YouTube's player file no code name, word, " +
  "reason token or stored key says \"video\" or \"YouTube\" (or `yt` as a name's part), read as the language reads it with YouTube's row " +
  "and chat's link tables cut out by their declarations; the page's ids, classes and words neither, its allowed hosts and player lines " +
  "aside; each scan proven on a fixture first");
