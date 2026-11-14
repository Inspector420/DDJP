// tests/check-player-plug.js
// SUBJECT: ui/songplayer.js, ui/youtube.js, ui/soundcloud.js, core/songs.js, index.html, app.js, ui/player.js, ui/playlists.js, core/, features/, ui/, backends/
//
// WALL: EVERY SONG SERVICE'S PLAYER IS BEHIND ONE PLUG, AND ADDING A SERVICE IS FOUR THINGS (J29, steps 2 and 3; the owner's
// goal for the provider item, his words: "allright the goal is the app the app as if we supported many providers by default and
// not make it hard to add more later"). A service is its ROW in `core/songs.js`, its PLAYER FILE following the plug
// (`ui/songplayer.js`), its HOSTS in the page's allowed hosts, and its LINE in the page (`ddjp_707`). Nothing else names it.
// SoundCloud is the second service (`ddjp_709`, J151, the owner's "well lets do soundcloud"): its four things are held here, and
// its real player file is driven against a stand-in for SoundCloud's widget shaped from its docs (`tests/_sc-player.js`).
//
//   PART A — THE FOUR THINGS HELD TOGETHER (the supervisor's JOB 2 at `ddjp_706`, JOB 3 at `ddjp_707`, JOB 4 at `ddjp_709`). A1
//            the page's allowed hosts (`index.html`'s `script-src` and `frame-src`) are exactly the table's hosts plus the app's
//            own: red for a host missing and for one left over. A2 every row names a player file that exists and, loaded after
//            the plug, registers under the row's short name: red for a row with no player; and the page lists each row's player
//            file in a plain line right after the plug's, in the table's order, with the plug's `?v=`: red for a line missing, a
//            line left over, a line out of order. A3 nothing else names a service: a row's hosts are spelled only in the table
//            and that row's player file (the chat's own link tables cut out by name); YouTube's player — `YT`, its ready hook,
//            its script, its calls, its states, its error codes — is known only to `ui/youtube.js` (another service's player file
//            may use a call name its own service's docs share); the page (outside its allowed hosts, its player lines and the
//            picture slot's CSS) and `app.js` name no service; the plug names none. A4 SoundCloud's four things, by name. Each
//            check is first run on a fixture it must catch.
//   PART B — THE PLUG'S SHAPE, DRIVEN against the REAL YouTube player file over a recording stand-in for `YT.Player`, and the
//            REAL SoundCloud player file over the stand-in widget: made in a box it is given, its own element inside; ready once
//            its script is up (SoundCloud's in the room's box: ONE FRAME, made at its first song and REUSED for every one after —
//            the next song through the widget's own `load`, a song over or stopped leaving the frame paused where it is, the
//            frame gone only when destroyed (`ddjp_714`, replacing `ddjp_710`'s fresh frame per song); an event or an answer of
//            the track before, arriving while the next loads into the frame, is not read; the room's box makes no new frame on
//            `play()`); a key loaded as the service's own id; play, pause, seek, stop, volume and mute as the service's own calls
//            (in its own units); ready, playing, ended and failed reported in the plug's words, a failure as the APP'S reason; the
//            song read back as a key; the length what the service says it can play (a SoundCloud snippet's 30 s); readings
//            synchronous, and HOW FRESH measured (the supervisor's decision 3): YouTube's are the call itself; SoundCloud's are one
//            poll old at most. SoundCloud's file asks its widget for nothing the widget's docs do not list.
//   PART C — SOUNDCLOUD PLAYS IN THE ROOM'S PLAYER. The room's own shipped load path and its plug handlers, extracted from
//            `ui/player.js` (since `ddjp_714` the room's decisions and the plug's check: `_followRoom`, `_checkPlayer`,
//            `_wantOf`, `_act`), play `sc:` keys through the real `ui/soundcloud.js`: the room's first song SoundCloud's
//            (YouTube's empty player hidden), opened once by its link, started at the room's point (in ms), its length reported
//            (a snippet's too), ended and HELD (its frame kept, silent), the next loaded into the SAME frame, a YouTube song
//            between — SoundCloud's frame stepped aside, hidden, paused and silent, YouTube's player stepped aside heard no
//            more, and a hidden player that says it plays paused at once by the check and logged once, said again once a check
//            has found it right in between (`Player: corrected yt — playing while not shown …`) — and its error reaching
//            `MediaBlocked` as `unavailable`.
//   PART D — THE SAME COMMANDS, IN THE SAME ORDER (decision 5). `tests/_player-drive.js` drives both players through the whole UI
//            (a song joined late, a drift seek, the volume and mute, an end and the next, error 150, a preview opened, paused,
//            played, its volume set, muted and closed, the room left), and every call the stand-in `YT.Player` is handed is
//            compared with `ddjp_705`'s recording of the same drive (`tests/_player-calls-705.js`) — with SoundCloud's player
//            file in the page. Until `ddjp_714` every call, entry by entry. Since the plug's CHECK (`ddjp_714`, the
//            supervisor's point 8: "If the check changes YouTube's recorded calls, say exactly which changed and why"): every
//            COMMAND and every event, entry by entry, and exactly two commands more, each at its place — `mute()` right after
//            the held end's `stopVideo()` (a held player's sound is 0) and `unMute()` right after the next song's
//            `loadVideoById` (a song loaded takes this device's volume back). What it READS differs (the check reads the
//            player at every push, every event and every 2 s), and the counts of each reading are measured and printed.
//   PART E — THE TWO PLAYERS SWITCH INDEPENDENTLY (`ddjp_709`, the supervisor's decision 9; the owner's words: "we do want the
//            room player and the preview song playyer to independently switch rightly tot he right one depending on whats
//            playing"). E1 the room's box goes YouTube → SoundCloud → YouTube, each song loaded once, the other player stopped and
//            hidden (and muted, `ddjp_714`), SoundCloud's frame kept; E2 a preview plays a SoundCloud song while the room plays a
//            YouTube one, and the other way round; E3 each box
//            acts only on its own players; E4 through the whole UI, the room's song pauses and resumes around the preview as
//            today, whichever service each plays.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./_load");
const PW = require("./_player-world.js");
const SCW = require("./_sc-player.js");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[player-plug] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// THE PREMISE, BY NAME: the plug and both players' files are in this tree, or nothing below is a reading of them.
const ABSENT = ["ui/songplayer.js", "ui/youtube.js", "ui/soundcloud.js"].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
if (ABSENT.length) {
  console.log("[player-plug] FAIL — PREMISE — the song players' plug and its players' files are not in this tree (J29, step 2; J151): missing " + ABSENT.join(", "));
  process.exit(1);
}
const MEASURED = {};
// The tracks the stand-in widget knows by link: one is a paid-only track, which SoundCloud embeds as a 30-second snippet.
const SNIP_LINK = "https://soundcloud.com/artist-two/go-track";
const TRACKS = { [SNIP_LINK]: { title: "A paid-only track", snippet: true } };

// The player files the table names, in its order (read from the real table, in a sandbox of its own).
function playersOf(src) {
  const c = { console, URL };
  vm.createContext(c);
  vm.runInContext(src + "\n;globalThis.__p = Songs.services().map((r) => r.player);", c, { filename: "core/songs.js (its rows)" });
  return c.__p.filter((p) => typeof p === "string" && fs.existsSync(path.join(ROOT, p)));
}

// ═══ A WORLD: the real table, the plug, and every row's player file, in the page's order ════════════════════════════════
// Stand-ins: `YT.Player` (recording, its events fired by the part) and SoundCloud's `SC.Widget` (`tests/_sc-player.js`: every
// answer a callback that waits for `flush()`), both writing into ONE list of calls; a document just big enough for boxes; and
// a virtual clock (`tick(ms)` runs each timer as it falls due).
function world(o) {
  o = o || {};
  const calls = [];
  const made = { yt: [] };
  const doc = PW.makeDoc();
  const clock = { now: 0, seq: 0, due: [] };
  const setTimeout_ = (fn, ms) => { const id = ++clock.seq; clock.due.push({ id, fn, when: clock.now + Math.max(0, Number(ms) || 0) }); return id; };
  const clearTimeout_ = (id) => { clock.due = clock.due.filter((t) => t.id !== id); };
  const pending = [];   // the widget's answers, waiting
  const logged = [];    // what the plug and the players say in the log
  // YouTube's stand-in: what each call returns is the stand-in's own state, so a reading shows what the player was told.
  function YTPlayer(el, cfg) {
    const name = typeof el === "string" ? el : (el && el.id);
    calls.push("new " + name + " " + JSON.stringify(JSON.parse(JSON.stringify(cfg || {}))));
    // Made muted, it starts muted, as YouTube's player does with `mute: 1` (`ddjp_714`: the box's record of each player's sound starts there).
    const st = { vid: (cfg && cfg.videoId) || null, t: 0, d: 0, vol: 100, muted: !!(cfg && cfg.playerVars && cfg.playerVars.mute), state: -1, title: "" };
    const base = {
      loadVideoById(x) { st.vid = x.videoId; st.t = x.startSeconds || 0; st.state = 3; }, playVideo() { st.state = 1; },
      pauseVideo() { st.state = 2; }, stopVideo() { st.state = 0; }, seekTo(s) { st.t = s; }, getCurrentTime() { return st.t; },
      getDuration() { return st.d; }, getVideoData() { return st.vid ? { video_id: st.vid, title: st.title } : {}; },
      getPlayerState() { return st.state; }, setVolume(v) { st.vol = v; }, getVolume() { return st.vol; }, mute() { st.muted = true; },
      unMute() { st.muted = false; }, isMuted() { return st.muted; }, destroy() {},
    };
    const rec = {};
    for (const k of Object.keys(base)) rec[k] = function () { calls.push(name + "." + k + "(" + JSON.stringify([].slice.call(arguments)).slice(1, -1) + ")"); return base[k].apply(base, arguments); };
    made.yt.push({ name, cfg, st, p: rec });
    return rec;
  }
  const YT = { Player: YTPlayer };
  const sc = SCW.standIn({ calls, later: (fn) => pending.push(fn), document: doc, tracks: TRACKS });
  const sb = { console, window: {}, document: doc, setTimeout: setTimeout_, clearTimeout: clearTimeout_, URL, Date, Math, JSON,
    Logger: { info: (m) => logged.push(String(m)), warn() {}, debug() {}, error() {} } };
  if (o.yt !== false) { sb.window.YT = YT; sb.YT = YT; }
  if (o.sc !== false) { sb.window.SC = sc.SC; sb.SC = sc.SC; }
  sb.globalThis = sb;
  vm.createContext(sb);
  const table = read("core/songs.js");
  const players = playersOf(table);
  const files = [["core/songs.js", table], ["ui/songplayer.js", read("ui/songplayer.js")]].concat(players.map((rel) => [rel, read(rel)]));
  vm.runInContext(files.map((f) => f[1]).join("\n;\n") +
    "\n;globalThis.__x = { Songs, SongPlayer, YouTubePlayer: (typeof YouTubePlayer !== 'undefined' ? YouTubePlayer : null)," +
    " SoundCloudPlayer: (typeof SoundCloudPlayer !== 'undefined' ? SoundCloudPlayer : null) };", sb,
    { filename: files.map((f) => f[0]).join("+") });
  const x = sb.__x;
  async function flush() { for (let i = 0; i < 20 && pending.length; i++) { const p = pending.splice(0); p.forEach((f) => f()); } }
  async function tick(ms) {
    const until = clock.now + ms;
    for (;;) {
      const next = clock.due.filter((t) => t.when <= until).sort((a, b) => a.when - b.when || a.id - b.id)[0];
      if (!next) break;
      clock.now = next.when; clock.due = clock.due.filter((t) => t !== next);
      next.fn();
      await flush();
    }
    clock.now = until;
    await flush();
  }
  return { sb, x, Songs: x.Songs, SongPlayer: x.SongPlayer, YouTubePlayer: x.YouTubePlayer, SCP: x.SoundCloudPlayer, players, calls, made, sc, doc,
    clock, flush, tick,
    box(id) { const b = doc.createElement("div"); b.id = id; doc.body.appendChild(b); return b; },
    giveYT() { sb.window.YT = YT; sb.YT = YT; }, giveSC() { sb.window.SC = sc.SC; sb.SC = sc.SC; },
    yt: (i) => made.yt[i || 0], ytNamed: (name) => made.yt.filter((m) => m.name === name).slice(-1)[0], pendingAnswers: () => pending.length,
    // What a player's element shows: "shown", "hidden", or "gone" (no longer in its box).
    seen(boxEl, id) { const e = (boxEl.children || []).find((c) => c.id === id); return !e ? "gone" : (e.style.display === "none" ? "hidden" : "shown"); },
    // How many of a player's elements a box holds, and the one it holds (`ddjp_710`: one fresh SoundCloud frame per song).
    count: (boxEl, id) => (boxEl.children || []).filter((c) => c.id === id).length,
    el: (boxEl, id) => (boxEl.children || []).find((c) => c.id === id) || null, logged };
}
const childIds = (box) => (box.children || []).map((c) => c.id);
// What a player was told to DO (YouTube's readings left out: they are the box reading, not acting).
const acts = (list) => list.filter((c) => !/^[\w-]+\.(get\w+|isMuted)\(/.test(c) && !/^→ /.test(c));

// ═══ PART A — THE FOUR THINGS ═════════════════════════════════════════════════════════════════════════════════════════
// The app's own sources in the two directives: anything that is not a scheme and host (`'self'`, `'wasm-unsafe-eval'`, a hash)
// and these hosts, which the app itself needs (none today). A host here is the app's, never a service's.
const APP_OWN = { "script-src": [], "frame-src": [] };
function cspOf(html) {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  if (!m) return null;
  const out = {};
  for (const d of m[1].split(";")) { const t = d.trim().split(/\s+/).filter(Boolean); if (t.length) out[t[0]] = t.slice(1); }
  return out;
}
function hostsAgainst(rows, csp) {
  const r = { missing: [], leftOver: [] };
  for (const [kind, dir] of [["script", "script-src"], ["frame", "frame-src"]]) {
    const want = new Set();
    for (const row of rows) for (const h of ((row.hosts && row.hosts[kind]) || [])) want.add(h);
    const page = (csp[dir] || []).filter((t) => /^[a-z][a-z0-9+.-]*:\/\//i.test(t));
    for (const h of want) if (page.indexOf(h) < 0) r.missing.push(dir + " " + h);
    for (const h of page) if (!want.has(h) && APP_OWN[dir].indexOf(h) < 0) r.leftOver.push(dir + " " + h);
  }
  return r;
}
function rowsAgainst(rows, PLAYER_FILE, exists) {
  const bad = [];
  for (const row of rows) {
    if (typeof row.player !== "string" || !row.player) { bad.push(row.short + ": no player file"); continue; }
    if (!PLAYER_FILE.test(row.player)) bad.push(row.short + ": " + row.player + " is not a plain ui/<name>.js the plug loads");
    else if (!exists(row.player)) bad.push(row.short + ": " + row.player + " does not exist");
  }
  return bad;
}
// The page's player lines against the table: the script tags (comments out) in order; those whose file registers with the
// plug are its player lines. Each row's must follow the plug's tag, in the table's order, with the plug's `?v=`.
function linesAgainst(rows, page, isPlayerFile) {
  const tags = Array.from(page.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\s+src="([^"?]+)(?:\?v=(\d+))?"/g)).map((m) => ({ file: m[1], v: m[2] || null }));
  const at = tags.findIndex((t) => t.file === "ui/songplayer.js");
  const want = rows.map((r) => r.player).filter((p) => typeof p === "string");
  const listed = tags.filter((t) => want.indexOf(t.file) >= 0 || isPlayerFile(t.file));
  const files = listed.map((t) => t.file);
  const r = { plug: at >= 0, listed: files, missing: want.filter((p) => files.indexOf(p) < 0), leftOver: files.filter((f) => want.indexOf(f) < 0),
    order: [], version: [] };
  const after = at >= 0 ? tags.slice(at + 1, at + 1 + want.length).map((t) => t.file) : [];
  if (!r.missing.length && JSON.stringify(after) !== JSON.stringify(want)) r.order.push("after the plug: " + after.join(", ") + "; the table: " + want.join(", "));
  const plugV = at >= 0 ? tags[at].v : null;
  for (const t of listed) if (t.v !== plugV) r.version.push(t.file + "?v=" + t.v + " (the plug's ?v=" + plugV + ")");
  return r;
}
let espree = null;
try { espree = require("espree"); } catch (e) { espree = null; }
ok(!!espree, "A PREMISE — `espree` (installed with eslint) must load: run `npm install`");
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
// What knows YouTube's PLAYER: its global, its ready hook, its script's name, the calls it takes, its state table's name.
const YT_IDENTS = new Set(["YT", "onYouTubeIframeAPIReady", "PlayerState", "loadVideoById", "cueVideoById", "getVideoData", "getPlayerState",
  "seekTo", "playVideo", "pauseVideo", "stopVideo", "unMute", "isMuted", "getVolume", "getCurrentTime", "getDuration", "video_id"]);
// The call names SoundCloud's widget docs list too (`seekTo`, `getVolume`, `getDuration`): inside ANOTHER row's player file they
// are that service's own calls, not knowledge of YouTube's player (`ddjp_709`). Everywhere else they still count.
const SHARED = new Set(SCW.DOCUMENTED.filter((n) => YT_IDENTS.has(n)));
const YT_ONLY = new Set(Array.from(YT_IDENTS).filter((n) => !SHARED.has(n)));
const YT_STRINGS = [/iframe_api/, /onYouTubeIframeAPIReady/, /\bYT\.Player\b/];
function knowsYouTube(rel, src, idents) {
  const names = idents || YT_IDENTS;
  const toks = espree.tokenize(src, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const hits = [];
  for (const t of toks) {
    if (t.type === "Identifier" && names.has(t.value)) hits.push(rel + ":" + t.loc.start.line + " " + t.value);
    if ((t.type === "String" || t.type === "Template") && YT_STRINGS.some((re) => re.test(t.value))) hits.push(rel + ":" + t.loc.start.line + " " + t.value.slice(0, 50));
  }
  // its error codes as a table: 101 and 150 together (the codes that mean "the uploader says no")
  const nums = new Set(toks.filter((t) => t.type === "Numeric").map((t) => t.value));
  if (nums.has("101") && nums.has("150")) hits.push(rel + " YouTube's error codes 101 and 150");
  return hits;
}
// THE CHAT'S OWN LINK TABLES (`ddjp_709`): the chat recognises links people post — its groups of hosts, the tracking parameters
// it strips, the short-link hosts it cannot open — and SoundCloud's site is among them since long before SoundCloud played here.
// Those tables describe links in chat messages, not a song service, so the hosts scan cuts them out BY NAME (as
// `check-song-services` does); each cut must be declared exactly once, or the scan refuses.
const CHAT_CUTS = { "core/chatprefs.js": ["LINK_HOST_GROUPS"], "features/chat.js": ["LINK_TRACKING", "LINK_OPAQUE_HOSTS"] };
function cutTokens(rel, toks, cuts) {
  const drop = new Set();
  for (const name of (cuts || [])) {
    const at = [];
    for (let i = 0; i + 3 < toks.length; i++) if (toks[i].type === "Keyword" && toks[i].value === "const" && toks[i + 1].value === name && toks[i + 2].value === "=") at.push(i);
    if (at.length !== 1) return { refused: "the cut `const " + name + " = …` is declared " + at.length + " time(s) in " + rel + ", expected exactly 1" };
    const open = at[0] + 3, opener = toks[open].value, closer = opener === "[" ? "]" : opener === "{" ? "}" : null;
    if (!closer) return { refused: "the cut `" + name + "` in " + rel + " is not a table (`[` or `{`)" };
    let d = 0, k = open;
    for (; k < toks.length; k++) {
      if (toks[k].type !== "Punctuator") continue;
      if (toks[k].value === opener) d++;
      else if (toks[k].value === closer && --d === 0) break;
    }
    for (let i = at[0]; i <= k; i++) drop.add(i);
  }
  return { toks: toks.filter((t, i) => !drop.has(i)) };
}
function spellsHosts(rel, src, hostnames, cuts) {
  const all = espree.tokenize(src, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const c = cutTokens(rel, all, cuts);
  if (c.refused) return { refused: c.refused, hits: [] };
  const hits = [];
  for (const t of c.toks) if (t.type === "String" || t.type === "Template" || t.type === "RegularExpression") {
    for (const h of hostnames) if (t.value.indexOf(h) >= 0) hits.push(rel + ":" + t.loc.start.line + " " + h);
  }
  return { hits };
}
const hostnameOf = (u) => { try { return new URL(u).hostname; } catch (e) { return null; } };

function partA() {
  const w = world();
  const rows = w.Songs.services();
  const html = read("index.html");
  const csp = cspOf(html);
  ok(!!csp && Array.isArray(csp["script-src"]) && Array.isArray(csp["frame-src"]), "A1 PREMISE — the page's allowed hosts are read: its CSP's `script-src` and `frame-src`", csp);
  ok(rows.length >= 2 && rows.every((r) => r.hosts && Array.isArray(r.hosts.frame) && Array.isArray(r.hosts.script)),
    "A1 PREMISE — every row of the table names its hosts, `frame` and `script`", rows.map((r) => r.short));
  if (!csp) return;
  // CONTROLS: a host missing, a host left over — each caught on a fixture (a page allowing exactly the table's hosts, with the
  // app's own keywords) before the real page is read.
  const yt = rows[0];
  const clean = { "script-src": ["'self'"].concat(...rows.map((r) => r.hosts.script)), "frame-src": [].concat(...rows.map((r) => r.hosts.frame)) };
  ok(hostsAgainst(rows, clean).missing.length === 0 && hostsAgainst(rows, clean).leftOver.length === 0, "A1 CONTROL — a page allowing exactly the table's hosts reads clean");
  const cMissing = hostsAgainst(rows, Object.assign({}, clean, { "frame-src": clean["frame-src"].filter((h) => h !== yt.hosts.frame[0]) }));
  ok(cMissing.missing.length === 1 && cMissing.leftOver.length === 0, "A1 CONTROL — a row's host taken out of the page is caught as MISSING", cMissing);
  const cLeft = hostsAgainst(rows, Object.assign({}, clean, { "script-src": clean["script-src"].concat(["https://gone.example"]) }));
  ok(cLeft.leftOver.length === 1 && cLeft.missing.length === 0, "A1 CONTROL — a host the page allows that no row names is caught as LEFT OVER", cLeft);
  const cAdded = hostsAgainst(rows.concat([{ short: "zz", hosts: { frame: ["https://w.zz.test"], script: ["https://w.zz.test"] } }]), clean);
  ok(cAdded.missing.length === 2 && cAdded.missing.every((m) => /w\.zz\.test/.test(m)),
    "A1 CONTROL — a service's row added without its hosts in the page is caught: both of its hosts MISSING", cAdded);
  const sc = rows.find((r) => r.short === "sc");
  if (sc) {
    const scHosts = sc.hosts.script.concat(sc.hosts.frame);
    const noSc = { "script-src": csp["script-src"].filter((h) => scHosts.indexOf(h) < 0), "frame-src": csp["frame-src"].filter((h) => scHosts.indexOf(h) < 0) };
    const cSc = hostsAgainst(rows, noSc);
    ok(cSc.missing.length === sc.hosts.script.length + sc.hosts.frame.length && cSc.leftOver.length === 0,
      "A1 CONTROL — SoundCloud's hosts taken out of the real page are caught: each MISSING", cSc);
  }
  const real = hostsAgainst(rows, csp);
  ok(real.missing.length === 0, "A1 — EVERY HOST A ROW NAMES IS ALLOWED BY THE PAGE (`index.html`'s `script-src`/`frame-src`)", real.missing);
  ok(real.leftOver.length === 0, "A1 — AND THE PAGE ALLOWS NO HOST BEYOND THE TABLE'S AND THE APP'S OWN: none left over", real.leftOver);
  MEASURED.hosts = rows.map((r) => r.short + " " + r.hosts.script.length + " script + " + r.hosts.frame.length + " frame").join(", ");

  // A2 — every row names its player file, which exists and follows the plug.
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const cRows = rowsAgainst([{ short: "zz", player: null }, { short: "zy", player: "ui/nope-player.js" }, { short: "zx", player: "../x.js" }], w.SongPlayer.PLAYER_FILE, exists);
  ok(cRows.length === 3, "A2 CONTROL — a row with no player, a player file that is not there, and a path the plug would not load are each caught", cRows);
  const bad = rowsAgainst(rows, w.SongPlayer.PLAYER_FILE, exists);
  ok(bad.length === 0, "A2 — EVERY ROW NAMES A PLAYER FILE THE PLUG LOADS, AND IT IS THERE", bad);
  ok(JSON.stringify(w.SongPlayer.registered()) === JSON.stringify(rows.map((r) => r.short)),
    "A2 — loaded after the plug, the row's player file REGISTERS under the row's short name, and nothing else registers", w.SongPlayer.registered());
  const shapeOk = rows.every((r) => { try { const src = read(r.player); return /SongPlayer\.register\(/.test(src); } catch (e) { return false; } });
  ok(shapeOk, "A2 — each player file registers itself with the plug (its shape is driven in PART B)");
  // A2 — THE PAGE LISTS EACH ROW'S PLAYER FILE (`ddjp_707`, the supervisor's JOB 3): one plain line for each, right after the
  // plug's, in the table's order, with the plug's `?v=` — red for a line missing, a line left over, a line out of order.
  // A player file is a file that registers itself with the plug (the plug itself, which describes the call, is not one).
  const isPlayerFile = (f) => { if (f === "ui/songplayer.js") return false; try { return /SongPlayer\.register\(/.test(read(f)); } catch (e) { return false; } };
  // The controls read a page and a table of their own — the two real player files — so they hold whatever this tree's page says.
  const CTL_ROWS = [{ player: "ui/youtube.js" }, { player: "ui/soundcloud.js" }];
  const CTL_PAGE = '<script src="ui/songplayer.js?v=1"></script>\n<script src="ui/youtube.js?v=1"></script>\n<script src="ui/soundcloud.js?v=1"></script>';
  const cleanCtl = linesAgainst(CTL_ROWS, CTL_PAGE, isPlayerFile);
  ok(cleanCtl.missing.length + cleanCtl.leftOver.length + cleanCtl.order.length + cleanCtl.version.length === 0 && cleanCtl.plug,
    "A2 CONTROL — a page listing each row's player file after the plug, in order, reads clean", cleanCtl);
  const orderCtl = linesAgainst(CTL_ROWS,
    '<script src="ui/songplayer.js?v=1"></script>\n<script src="ui/soundcloud.js?v=1"></script>\n<script src="ui/youtube.js?v=1"></script>', isPlayerFile);
  ok(orderCtl.order.length === 1 && orderCtl.missing.length === 0, "A2 CONTROL — two lines out of the table's order are caught as OUT OF ORDER", orderCtl);
  const missCtl = linesAgainst(CTL_ROWS, CTL_PAGE.replace('<script src="ui/youtube.js?v=1"></script>\n', ""), isPlayerFile);
  ok(missCtl.missing.length === 1 && missCtl.missing[0] === "ui/youtube.js", "A2 CONTROL — a row's line taken out of the page is caught as MISSING", missCtl);
  const leftCtl = linesAgainst([{ player: "ui/youtube.js" }], CTL_PAGE, isPlayerFile);
  ok(leftCtl.leftOver.length === 1 && leftCtl.leftOver[0] === "ui/soundcloud.js", "A2 CONTROL — a player file listed with no row naming it is caught as LEFT OVER", leftCtl);
  const verCtl = linesAgainst(CTL_ROWS, CTL_PAGE.replace("ui/youtube.js?v=1", "ui/youtube.js?v=2"), isPlayerFile);
  ok(verCtl.version.length === 1, "A2 CONTROL — a player line with another `?v=` than the plug's is caught", verCtl);
  const lines = linesAgainst(rows, html, isPlayerFile);
  ok(lines.plug, "A2 PREMISE — the page carries the plug's line", lines);
  ok(lines.missing.length === 0, "A2 — THE PAGE LISTS EVERY ROW'S PLAYER FILE, one plain line each: none missing", lines.missing);
  ok(lines.leftOver.length === 0, "A2 — AND NO PLAYER FILE NO ROW NAMES: none left over", lines.leftOver);
  ok(lines.order.length === 0, "A2 — THE LINES FOLLOW THE PLUG'S, IN THE TABLE'S ORDER", lines.order);
  ok(lines.version.length === 0, "A2 — each with the plug's `?v=`, so every tag is one number", lines.version);
  MEASURED.lines = lines.listed.join(", ");

  // A3 — nothing else names a service.
  if (!espree) return;
  const files = appFiles();
  const otherPlayers = rows.map((r) => r.player).filter((p) => p !== "ui/youtube.js");
  ok(files.indexOf("ui/youtube.js") >= 0 && files.indexOf("ui/songplayer.js") >= 0 && files.indexOf("ui/soundcloud.js") >= 0 && files.length > 60,
    "A3 PREMISE — the walk finds the app's files, the plug and both players among them", files.length);
  const ytCtl = knowsYouTube("(fixture)", "// YT.Player in a comment\nconst p = new YT.Player(\"x\", {});\nconst t = { 101: 1, 150: 1 };\np.loadVideoById({});\n");
  ok(ytCtl.length === 3, "A3 CONTROL — on a fixture, `YT`, a call and the codes table are each found, and a comment is not", ytCtl);
  const sharedSrc = "w.seekTo(1000); w.getDuration(cb); w.getVolume(cb);\n";
  ok(knowsYouTube("(fixture)", sharedSrc).length === 3 && knowsYouTube("(another player file)", sharedSrc, YT_ONLY).length === 0 &&
    knowsYouTube("(another player file)", sharedSrc + "p.loadVideoById({});\n", YT_ONLY).length === 1,
    "A3 CONTROL — the call names SoundCloud's widget shares (" + Array.from(SHARED).join(", ") + ") count in any file but another row's player " +
    "file, where only YouTube's own still count", Array.from(SHARED));
  const knows = [];
  for (const rel of files) if (rel !== "ui/youtube.js") for (const h of knowsYouTube(rel, read(rel), otherPlayers.indexOf(rel) >= 0 ? YT_ONLY : YT_IDENTS)) knows.push(h);
  ok(knows.length === 0, "A3 — NO FILE BUT YOUTUBE'S PLAYER KNOWS YOUTUBE'S PLAYER: `YT`, its ready hook, its script, its calls, its " +
    "states and its error codes are `ui/youtube.js`'s alone", knows);
  const own = knowsYouTube("ui/youtube.js", read("ui/youtube.js"));
  ok(own.length >= 10, "A3 CONTROL — the scan finds YouTube's player where it is, in its own file", own.length);
  // A row's hosts are spelled only in the table and in that row's player file (the chat's link tables cut out by name).
  const cutCtlSrc = 'const LINK_TRACKING = { "soundcloud.com": ["si"] };\nconst x = "https://soundcloud.com/a/b";\n';
  const cutCtl = spellsHosts("(fixture)", cutCtlSrc, ["soundcloud.com"], ["LINK_TRACKING"]);
  const uncut = spellsHosts("(fixture)", cutCtlSrc, ["soundcloud.com"], []);
  const twice = spellsHosts("(fixture)", cutCtlSrc + "const LINK_TRACKING = {};\n", ["soundcloud.com"], ["LINK_TRACKING"]);
  ok(cutCtl.hits.length === 1 && uncut.hits.length === 2 && !!twice.refused,
    "A3 CONTROL — a cut table's hosts are not counted, a host outside it is, and a cut declared twice is refused", { cutCtl, uncut, twice });
  const spelled = [], refusals = [];
  for (const row of rows) {
    const names = Array.from(new Set(row.hosts.script.concat(row.hosts.frame).map(hostnameOf).filter(Boolean)));
    for (const rel of files) if (rel !== "core/songs.js" && rel !== row.player) {
      const r = spellsHosts(rel, read(rel), names, CHAT_CUTS[rel]);
      if (r.refused) refusals.push(r.refused);
      for (const h of r.hits) spelled.push(row.short + " " + h);
    }
  }
  ok(refusals.length === 0, "A3 PREMISE — the chat's link tables are each found once, by name, to be cut", Array.from(new Set(refusals)));
  ok(spelled.length === 0, "A3 — A ROW'S HOSTS ARE SPELLED ONLY IN THE TABLE AND ITS OWN PLAYER FILE", spelled);
  // The plug names no service: no row's short name as a string, no host.
  const plugToks = espree.tokenize(read("ui/songplayer.js"), { ecmaVersion: "latest", sourceType: "script" });
  const plugNames = plugToks.filter((t) => t.type === "String" && rows.some((r) => t.value.slice(1, -1) === r.short || r.hosts.script.concat(r.hosts.frame).some((h) => t.value.indexOf(hostnameOf(h)) >= 0)));
  ok(plugNames.length === 0, "A3 — THE PLUG NAMES NO SERVICE", plugNames.map((t) => t.value));
  // The page names no service outside its allowed hosts, its player lines (A2) and the picture slot's CSS: its markup and
  // scripts (comments left out) spell no row's host, no service's name, and name a player file only in its line. A song's
  // service is named in the sheet only as the picture slot's `data-service` (`ddjp_709`, JOB 3: the SoundCloud placeholder is
  // drawn by the page's CSS, keyed on the song's service), and only there.
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  let outsideCsp = noComments.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/i, "");
  for (const row of rows) if (typeof row.player === "string") outsideCsp = outsideCsp.split(new RegExp('<script src="' + row.player.replace(/[.]/g, "\\.") + '\\?v=\\d+"></script>')).join("");
  const slotKeyed = Array.from(outsideCsp.matchAll(/data-service\s*=\s*"([^"]*)"/g));
  const slotOutside = slotKeyed.filter((m) => !/\.song-row \.thumb-slot\[$/.test(outsideCsp.slice(Math.max(0, m.index - 22), m.index)));
  ok(slotOutside.length === 0, "A3 — a song's service is named in the page only as the picture slot's `data-service`, in its CSS", slotOutside.map((m) => m[0] + " at " + m.index));
  const pageHits = [];
  for (const row of rows) {
    for (const h of row.hosts.script.concat(row.hosts.frame)) if (outsideCsp.indexOf(hostnameOf(h)) >= 0) pageHits.push(hostnameOf(h));
    if (typeof row.player === "string" && outsideCsp.indexOf(row.player) >= 0) pageHits.push(row.player);
  }
  for (const re of [/youtube/i, /\bYT\b/, /ytimg/i, /soundcloud/i, /\bSC\.Widget\b/]) { const m = re.exec(outsideCsp); if (m) pageHits.push(m[0] + " at " + m.index); }
  ok(pageHits.length === 0, "A3 — THE PAGE NAMES NO SERVICE OUTSIDE ITS ALLOWED HOSTS AND ITS PLAYER LINES (its comments aside): no host, no player file, no YouTube, no SoundCloud", pageHits);
  const tags = Array.from(noComments.matchAll(/<script\s+src="([^"?]+)/g)).map((m) => m[1]);
  ok(tags[0] === "core/songs.js" && tags[1] === "ui/songplayer.js",
    "A3 — the page loads the table and the plug FIRST, at the top of its body, where YouTube's script was asked for — so each player " +
    "file listed after them asks for its service's script at the same moment (decision 7)", tags.slice(0, 4));
  const appJs = read("app.js");
  const appHits = [/youtube/i, /\bYT\b/, /ytimg/i, /soundcloud/i, /\bSC\b/].map((re) => re.exec(appJs)).filter(Boolean).map((m) => m[0]);
  ok(appHits.length === 0, "A3 — `app.js` NAMES NO SERVICE (not even in a comment): the ready hook is the player file's", appHits);

  // A4 — SOUNDCLOUD'S FOUR THINGS, BY NAME (`ddjp_709`, the supervisor's JOB 4): its row, its file, its hosts, its page line.
  ok(!!sc && sc.player === "ui/soundcloud.js" && exists("ui/soundcloud.js"),
    "A4 — SOUNDCLOUD IS A ROW OF THE TABLE, `sc`, naming its player file `ui/soundcloud.js`, which is there", sc && { short: sc.short, player: sc.player });
  if (!sc) return;
  ok(JSON.stringify(sc.hosts) === JSON.stringify({ frame: ["https://w.soundcloud.com"], script: ["https://w.soundcloud.com", "https://soundcloud.com"] }),
    "A4 — ITS HOSTS: the widget's frame (`w.soundcloud.com`), the widget's script and SoundCloud's oEmbed (`soundcloud.com`) as scripts", sc.hosts);
  ok(w.SongPlayer.registered().indexOf("sc") >= 0 && /SongPlayer\.register\(SHORT,/.test(read("ui/soundcloud.js")) && /const SHORT = "sc";/.test(read("ui/soundcloud.js")),
    "A4 — ITS FILE registers with the plug as `sc`", w.SongPlayer.registered());
  ok(sc.hosts.script.every((h) => csp["script-src"].indexOf(h) >= 0) && sc.hosts.frame.every((h) => csp["frame-src"].indexOf(h) >= 0),
    "A4 — ITS HOSTS are in the page's allowed hosts", { script: csp["script-src"], frame: csp["frame-src"] });
  const li = lines.listed;
  ok(li.indexOf("ui/soundcloud.js") === li.indexOf("ui/youtube.js") + 1 && li.indexOf("ui/youtube.js") >= 0,
    "A4 — ITS LINE in the page, right after YouTube's", li);
}

// ═══ PART B — THE PLUG'S SHAPE, DRIVEN AGAINST BOTH REAL PLAYERS ═══════════════════════════════════════════════════════
async function partB() {
  // ── The room's box: both scripts NOT up yet when it is made ──
  {
    const w = world({ yt: false, sc: false });
    const ev = [];
    const box = w.box("player");
    const bp = w.SongPlayer.make(box, { startMuted: true }, { ready: (b, s) => ev.push("ready " + s), state: (word, b, s) => ev.push(s + " " + word),
      failed: (r, b, s, d) => ev.push(s + " failed " + r + " (" + d + ")") });
    ok(JSON.stringify(w.SongPlayer.registered()) === JSON.stringify(["yt", "sc"]), "B PREMISE — both players registered, in the table's order", w.SongPlayer.registered());
    ok(!!w.SCP && typeof w.SCP.playableMs === "function" && w.SCP.POLL_MS === 250, "B PREMISE — SoundCloud's player file loaded, its poll 250 ms", w.SCP && w.SCP.POLL_MS);
    ok(JSON.stringify(childIds(box)) === JSON.stringify(["yt-player"]),
      "B1 — MADE IN THE BOX IT IS GIVEN: YouTube's player puts its OWN element inside the room's box, the box itself untouched; " +
      "SoundCloud's puts none before its first song (its one frame is made then, `ddjp_714`)", childIds(box));
    ok(w.made.yt.length === 0 && w.sc.made.length === 0, "B2 — before a service's script is up, no player of it is made", w.calls);
    w.giveYT(); w.giveSC();
    await w.tick(500);
    ok(w.made.yt.length === 1 && w.sc.made.length === 0, "B2 — once its script is up, YouTube's player is made (its own retry); SoundCloud's widget waits for a song", w.calls);
    ok(w.calls[0] === 'new yt-player {"height":"300","width":"100%","videoId":"","playerVars":{"autoplay":1,"controls":1,"mute":1},"events":{}}',
      "B2 — YouTube's room player is made with the options it always had", w.calls[0]);
    w.yt().cfg.events.onReady({});
    await w.flush();
    ok(JSON.stringify(ev) === JSON.stringify(["ready yt"]) && bp.ready(),
      "B2 — YOUTUBE REPORTS READY, named; SoundCloud's player takes calls from the start (a load waits for its widget), so the box is ready when YouTube's is", ev);
    // A load, YouTube's song: its own id, in its own call; the song read back as the key.
    let n = w.calls.length;
    ok(bp.load("yt:AAAAAAAAAAA", 30) === true && w.calls.slice(n).join(" ") === 'yt-player.loadVideoById({"videoId":"AAAAAAAAAAA","startSeconds":30})',
      "B3 — A KEY IS LOADED AS THE SERVICE'S OWN ID: `yt:` + id → YouTube's `loadVideoById` with the id alone", w.calls.slice(n));
    ok(bp.service() === "yt" && bp.song() === "yt:AAAAAAAAAAA", "B3 — the song showing is read back as its KEY", bp.song());
    ok(w.seen(box, "yt-player") === "shown" && w.seen(box, "sc-player") === "gone", "B3 — and the one showing is the one seen: YouTube's, SoundCloud's no frame at all",
      [w.seen(box, "yt-player"), w.seen(box, "sc-player")]);
    w.yt().st.d = 212; w.yt().st.t = 31.5;
    n = w.calls.length;
    const t0 = bp.time(), l0 = bp.length();
    ok(t0 === 31.5 && l0 === 212 && w.calls.slice(n).join(" ") === "yt-player.getCurrentTime() yt-player.getDuration()",
      "B7 — READINGS ARE SYNCHRONOUS, in seconds: YouTube's are its own calls, made when asked", { t0, l0, calls: w.calls.slice(n) });
    w.yt().st.t = 40;
    ok(bp.time() === 40, "B8 — HOW FRESH (decision 3): YouTube's reading is the call itself — a change in the player is read at once, 0 ms old");
    ok(JSON.stringify(bp.reading()) === JSON.stringify({ songKey: "yt:AAAAAAAAAAA", seconds: 212 }), "B9 — `reading()` is the key and its length", bp.reading());
    n = w.calls.length;
    bp.play(); bp.pause(); bp.seek(12.5); bp.setVolume(40); bp.mute(); bp.unmute(); bp.stop();
    const ytOwn = w.calls.slice(n).filter((c) => /^yt-player\./.test(c));
    ok(JSON.stringify(ytOwn) === JSON.stringify(["yt-player.playVideo()", "yt-player.pauseVideo()", "yt-player.seekTo(12.5,true)", "yt-player.setVolume(40)",
      "yt-player.mute()", "yt-player.unMute()", "yt-player.stopVideo()"]),
      "B4/B5 — PLAY, PAUSE, SEEK, VOLUME, MUTE, STOP reach YouTube as the calls they always were", ytOwn);
    ok(w.calls.slice(n).filter((c) => /^sc-/.test(c)).length === 0, "B5 — SoundCloud's widget, not opened yet, is handed nothing (its player keeps the volume)", w.calls.slice(n));
    // States and failures, YouTube's.
    ev.length = 0;
    for (const s of [3, 1, 2, 0, 5, -1]) w.yt().cfg.events.onStateChange({ data: s });
    ok(JSON.stringify(ev) === JSON.stringify(["yt buffering", "yt playing", "yt paused", "yt ended", "yt cued", "yt unstarted"]),
      "B6 — YouTube's numbered states arrive as the PLUG'S WORDS", ev);
    ev.length = 0;
    for (const c of [150, 101, 100, 5, 2, 999]) w.yt().cfg.events.onError({ data: c });
    ok(JSON.stringify(ev) === JSON.stringify(["yt failed embed-denied (YouTube error 150)", "yt failed embed-denied (YouTube error 101)",
      "yt failed unavailable (YouTube error 100)", "yt failed player-failed (YouTube error 5)", "yt failed player-failed (YouTube error 2)",
      "yt failed null (YouTube error 999)"]),
      "B6 — A FAILURE IS THE APP'S REASON (decision 4): YouTube's codes mapped in its own file, unchanged; one the app does not know is no reason", ev);
    // SoundCloud's song, in the same box: the widget opened on its link; YouTube's player stops and hides.
    n = w.calls.length;
    ev.length = 0;
    ok(bp.load("sc:artist-name/track-name", 7.25) === true, "B3 — the box loads SoundCloud's key");
    ok(JSON.stringify(ev) === JSON.stringify(["sc buffering"]), "B6 — SoundCloud reports BUFFERING as it is handed the song", ev);
    const swap = w.calls.slice(n);
    ok(JSON.stringify(swap) === JSON.stringify(["yt-player.stopVideo()", "yt-player.mute()", "SC.Widget sc-player https://soundcloud.com/artist-name/track-name",
      "sc-player.setVolume(40)"]),
      "B3 — the other service's player STOPS and is MUTED as it steps aside (`ddjp_714`), SoundCloud's widget is OPENED on the key's own " +
      "track — its id, `<user>/<track>`, made its link — and, shown now, takes this device's volume (40): the box's first SoundCloud song", swap);
    const scEl = w.el(box, "sc-player");
    ok(!!scEl && scEl.tagName === "IFRAME" && scEl.getAttribute("allow") === "autoplay" && w.count(box, "sc-player") === 1,
      "B2 — SOUNDCLOUD'S OWN ELEMENT: an iframe, allowed to autoplay, made in the box at its first song, and one only", childIds(box));
    const src = (scEl && scEl.getAttribute("src")) || "";
    const q = (() => { try { return new URL(src); } catch (e) { return null; } })();
    const want = { auto_play: "true", hide_related: "true", show_artwork: "true", visual: "true", buying: "false", sharing: "false", download: "false" };
    ok(!!q && q.origin + q.pathname === "https://w.soundcloud.com/player/" && q.searchParams.get("url") === "https://soundcloud.com/artist-name/track-name" &&
      Object.keys(want).every((k) => q.searchParams.get(k) === want[k]),
      "B2 — SOUNDCLOUD'S WIDGET AND ITS LOOK (decision 1): opened at `w.soundcloud.com/player/` on the track's link, the big-artwork player " +
      "(`show_artwork`, `visual`), playing at once, suggesting nothing after its track (`hide_related`, `ddjp_714`), no buying, sharing or download", src);
    ok(w.seen(box, "yt-player") === "hidden" && w.seen(box, "sc-player") === "shown",
      "B3 — and the one showing is the one seen", [w.seen(box, "yt-player"), w.seen(box, "sc-player")]);
    ev.length = 0;
    n = w.calls.length;
    w.sc.fire("sc-player", "READY");
    ok(ev.indexOf("ready sc") >= 0, "B2 — SoundCloud's player reports READY once its widget is up, named", ev);
    ok(w.calls.slice(n).indexOf("sc-player.setVolume(40)") >= 0,
      "B5 — THIS DEVICE'S VOLUME goes with the player the box shows (`ddjp_714`), so a song of the other service starts at the same sound: " +
      "SoundCloud's widget, opened later, is handed the volume the box was given (40)", w.calls.slice(n));
    ev.length = 0;
    w.sc.fire("sc-player", "PLAY");
    ok(ev.length === 0, "B6 — SoundCloud's player does not report PLAYING until its copy is refreshed for the song", ev);
    await w.flush();
    ok(JSON.stringify(ev) === JSON.stringify(["sc playing"]), "B6 — and then reports it, in the plug's words", ev);
    ok(w.calls.indexOf("sc-player.seekTo(7250)") >= 0, "B4 — the load's start reaches the widget in ITS unit, milliseconds (7.25 s → 7250)", w.calls.slice(n));
    ok(bp.song() === "sc:artist-name/track-name" && bp.length() === 215.3 && bp.time() === 7.25 && bp.title() === "Track artist-name/track-name",
      "B7 — SoundCloud's readings answer AT ONCE, from its copy, in seconds (215300 ms → 215.3 s), the song read back as its key", { song: bp.song(), len: bp.length(), t: bp.time(), title: bp.title() });
    // Freshness, measured: the widget moves without telling; the copy is stale until the poll.
    w.sc.find("sc-player").st.ms = 60000;
    const stale = bp.time();
    await w.tick(w.SCP.POLL_MS - 1);
    const stillStale = bp.time();
    await w.tick(1);
    const fresh = bp.time();
    ok(stale === 7.25 && stillStale === 7.25 && fresh === 60, "B8 — HOW FRESH (decision 3): SoundCloud's reading is at most ONE POLL old — " +
      "stale for " + (w.SCP.POLL_MS - 1) + " ms, fresh at " + w.SCP.POLL_MS + " ms", { stale, stillStale, fresh });
    w.sc.fire("sc-player", "PLAY_PROGRESS", { currentPosition: 61500 });
    ok(bp.time() === 61.5, "B8 — and a progress event refreshes it at once", bp.time());
    MEASURED.fresh = "YouTube 0 ms (each reading is its own call); SoundCloud ≤ " + w.SCP.POLL_MS + " ms (one poll) or one progress event";
    n = w.calls.length;
    bp.mute(); bp.unmute();
    ok(JSON.stringify(acts(w.calls.slice(n)).filter((c) => /^sc-/.test(c))) === JSON.stringify(["sc-player.setVolume(0)", "sc-player.setVolume(40)"]),
      "B5 — SoundCloud's MUTE is volume 0, and the volume is remembered for unmute", w.calls.slice(n));
    n = w.calls.length;
    bp.play(); bp.pause(); bp.seek(30);
    ok(JSON.stringify(w.calls.slice(n)) === JSON.stringify(["sc-player.play()", "sc-player.pause()", "sc-player.seekTo(30000)"]),
      "B4 — play, pause and seek reach the showing player alone, in its own calls and units", w.calls.slice(n));
    const stopped = w.sc.find("sc-player");
    w.sc.fire("sc-player", "PLAY"); await w.flush();
    n = w.calls.length;
    bp.stop();
    await w.tick(w.SCP.POLL_MS * 2);
    ok(w.count(box, "sc-player") === 1 && w.sc.find("sc-player") === stopped && Object.keys(stopped.st.binds).length > 0 &&
      acts(w.calls.slice(n)).filter((c) => /^sc-/.test(c)).join(" ") === "sc-player.pause()",
      "B4 — STOPPED IS PAUSED, THE FRAME KEPT for the next song (`ddjp_714`): the widget paused, its events still bound, its frame where it is",
      { frames: w.count(box, "sc-player"), binds: Object.keys(stopped.st.binds), calls: acts(w.calls.slice(n)) });
    // The next SoundCloud song: INTO THE SAME FRAME, through the widget's own `load`, with the same look (`ddjp_714`).
    n = w.calls.length;
    bp.load("sc:artist-name/second-track", 0);
    const look = JSON.stringify(Object.assign({}, w.SCP.LOOK));
    ok(JSON.stringify(acts(w.calls.slice(n)).filter((c) => /^(SC\.Widget|sc-)/.test(c))) ===
      JSON.stringify(['sc-player.load("https://soundcloud.com/artist-name/second-track",' + look + ')']) &&
      w.count(box, "sc-player") === 1 && w.sc.find("sc-player") === stopped && w.sc.made.length === 1,
      "B3 — THE NEXT SOUNDCLOUD SONG GOES INTO THE SAME FRAME (`ddjp_714`, the owner's \"soundcloud waits for you to come back\"): the " +
      "widget's own `load` on its link, with the look — no new widget, one frame in the box", { calls: w.calls.slice(n), frames: w.count(box, "sc-player"), widgets: w.sc.made.length });
    ok(bp.song() === null, "B9 — while the next song loads, the box names no song (its copy is not yet refreshed for it)", bp.song());
    w.sc.fire("sc-player", "READY");
    w.sc.fire("sc-player", "PLAY"); await w.flush();
    ok(bp.song() === "sc:artist-name/second-track" && bp.length() === 215.3, "B7 — and then names it, with its length", { song: bp.song(), len: bp.length() });
    // A SNIPPET: SoundCloud's 30-second preview of a paid-only track (decision 4).
    const second = w.sc.find("sc-player");
    bp.load("sc:artist-two/go-track", 0);
    ok(w.count(box, "sc-player") === 1 && w.sc.find("sc-player") === second && w.sc.made.length === 1 && Object.keys(second.st.binds).length > 0,
      "B3 — A SONG AFTER A SONG: the same frame, one only", { frames: w.count(box, "sc-player"), widgets: w.sc.made.length });
    w.sc.fire("sc-player", "READY");
    w.sc.fire("sc-player", "PLAY"); await w.flush();
    ok(bp.length() === 30 && JSON.stringify(bp.reading()) === JSON.stringify({ songKey: "sc:artist-two/go-track", seconds: 30 }),
      "B7 — A SNIPPET'S LENGTH IS WHAT SOUNDCLOUD SAYS IT CAN PLAY (decision 4): the current sound shows SoundCloud's 30-second preview, so the " +
      "length is 30 s, though `getDuration` says 215.3", bp.reading());
    ev.length = 0;
    w.sc.fire("sc-player", "ERROR");
    w.sc.fire("sc-player", "FINISH");
    ok(JSON.stringify(ev) === JSON.stringify(["sc failed unavailable (SoundCloud gave no code)", "sc ended"]),
      "B6 — SoundCloud reports its error — which has NO CODE — as the app's reason `unavailable`, and ENDED", ev);
    ok(w.count(box, "sc-player") === 1, "B6 — ITS SONG OVER, ITS FRAME STAYS for the next song (`ddjp_714`): \"ended\" reported, nothing removed", childIds(box));
    ok(bp.song() === "sc:artist-two/go-track" && bp.length() === 30, "B9 — and the box still names the song that ended, with its length, for whoever asks next", bp.reading());
    ok(w.sc.asked().length === 0, "B — SOUNDCLOUD'S FILE ASKS ITS WIDGET FOR NOTHING THE WIDGET'S DOCS DO NOT LIST", w.sc.asked());
    // Destroyed: its poll stops, its events are unbound, its iframe is gone.
    bp.load("sc:artist-name/track-name", 0); w.sc.fire("sc-player", "READY"); await w.tick(w.SCP.POLL_MS);
    const polling = w.clock.due.length;
    bp.destroy();
    const atOnce = w.clock.due.length;
    const before = w.pendingAnswers();
    await w.tick(w.SCP.POLL_MS * 4);
    ok(polling === 1 && atOnce === 0 && w.pendingAnswers() === 0 && before === 0 && w.clock.due.length === 0,
      "B10 — destroyed, SoundCloud's poll stops at once: no timer left", { polling, atOnce, due: w.clock.due.length });
    ok(Object.keys(w.sc.find("sc-player").st.binds).length === 0 && w.seen(box, "sc-player") === "gone",
      "B10 — and its events are unbound and its iframe taken out of the box", { binds: Object.keys(w.sc.find("sc-player").st.binds), seen: w.seen(box, "sc-player") });
  }
  // ── SoundCloud's script not up yet when its songs come: one wait, the latest song's ──
  {
    const w = world({ sc: false });
    const bp = w.SongPlayer.make(w.box("player"), { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    const idle = w.clock.due.length;
    bp.load("sc:artist-one/track-one", 0); await w.tick(200); bp.load("sc:artist-one/track-two", 0); await w.tick(200);
    const waits = w.clock.due.length - idle;
    w.giveSC(); await w.tick(600);
    const opens = w.calls.filter((c) => /^SC\.Widget sc-player /.test(c));
    ok(waits === 1 && JSON.stringify(opens) === JSON.stringify(["SC.Widget sc-player https://soundcloud.com/artist-one/track-two"]),
      "B2 — BEFORE SOUNDCLOUD'S SCRIPT IS UP, ITS SONGS WAIT ONCE: one timer, and the widget opens on the latest song when the script comes", { waits, opens });
  }
  // ── A song stopped before SoundCloud's script came never opens (`ddjp_710`: removed is removed, ready or not) ──
  {
    const w = world({ sc: false });
    const bp = w.SongPlayer.make(w.box("player"), { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    const idle = w.clock.due.length;
    bp.load("sc:artist-one/track-one", 0); await w.tick(200);
    const waiting = w.clock.due.length - idle;
    bp.stop();
    const left = w.clock.due.length - idle;
    w.giveSC(); await w.tick(2000);
    const opens = w.calls.filter((c) => /^SC\.Widget /.test(c));
    ok(waiting === 1 && left === 0 && opens.length === 0 && w.clock.due.length === 0,
      "B2 — A SONG STOPPED BEFORE SOUNDCLOUD'S SCRIPT CAME NEVER OPENS: its wait for the script goes with it at once, and no frame is made when the script comes", { waiting, left, opens, timers: w.clock.due.length });
  }
  // ── THE TRACK BEFORE ACTS ON NOTHING (`ddjp_714`; a removed frame's, `ddjp_710`): a report that loads the next song, an event
  //    of the track before arriving while the next loads into the same frame, a late answer — and the check's not-shown rule
  //    said again for a new stray play once a check has found it right in between ──
  {
    const w = world();
    const box = w.box("player");
    const ev = [];
    let next = null;
    const bp = w.SongPlayer.make(box, { startMuted: true }, {
      state: (s) => { ev.push(s); if (s === "ended" && next) { const k = next; next = null; bp.load(k, 0); } },
      failed: (r) => ev.push("failed " + r),
    });
    w.yt().cfg.events.onReady({}); await w.flush();
    bp.load("sc:artist-one/track-one", 0);
    w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
    const first = w.sc.find("sc-player");
    next = "sc:artist-two/track-two";
    w.sc.fire("sc-player", "FINISH"); await w.flush();
    const nextOne = w.sc.find("sc-player");
    ok(w.count(box, "sc-player") === 1 && nextOne === first && (nextOne.st.asked.slice(-1)[0] || {}).url === "https://soundcloud.com/artist-two/track-two" &&
      w.el(box, "sc-player") === nextOne.el && Object.keys(nextOne.st.binds).length > 0 &&
      w.calls.filter((c) => /^sc-player\.load\("https:\/\/soundcloud\.com\/artist-two\/track-two",/.test(c)).length === 1,
      "B6 — A REPORT THAT LOADS THE NEXT SONG: \"ended\" reported, and the next song loaded into the SAME frame by the widget's own `load` " +
      "(`ddjp_714`)", { frames: childIds(box), asked: (nextOne.st.asked.slice(-1)[0] || {}).url, binds: Object.keys(nextOne.st.binds) });
    // An event of the track before, arriving while the next track loads into the frame (posted before the load), acts on nothing.
    w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
    const second = w.sc.find("sc-player");
    const held = Object.assign({}, second.st.binds);
    bp.load("sc:artist-three/track-three", 0);
    let n = ev.length;
    for (const k of [w.sc.EVENTS.PLAY, w.sc.EVENTS.FINISH, w.sc.EVENTS.ERROR]) if (typeof held[k] === "function") held[k](k === w.sc.EVENTS.ERROR ? undefined : { currentPosition: 1000 });
    await w.flush();
    ok(ev.length === n && w.count(box, "sc-player") === 1 && w.sc.find("sc-player") === second && bp.song() === null && Object.keys(held).length >= 3,
      "B10 — AN EVENT OF THE TRACK BEFORE, ARRIVING WHILE THE NEXT LOADS INTO THE FRAME, ACTS ON NOTHING: its play, end and error report " +
      "nothing, and the frame stays, loading the next", { reported: ev.slice(n), frames: childIds(box), song: bp.song() });
    // A late answer of the track before is not read: its position, length and song stay out of the copy.
    w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
    w.sc.fire("sc-player", "PLAY_PROGRESS", { currentPosition: 90000 });
    w.sc.fire("sc-player", "PLAY");                    // its answers asked, and still on their way
    const asked = w.pendingAnswers();
    bp.load("sc:artist-four/track-four", 0);
    n = ev.length;
    await w.flush();
    ok(asked >= 3 && ev.length === n && bp.song() === null && bp.time() === 0 && bp.length() === 0,
      "B7 — A LATE ANSWER OF THE TRACK BEFORE IS NOT READ: its position, length and song stay out of the copy, and nothing is reported " +
      "playing", { asked, reported: ev.slice(n), song: bp.song(), time: bp.time(), length: bp.length() });
    // The not-shown rule (the check's since `ddjp_714`, in a box given no want) says it again for a new stray play once a check has
    // found the player right in between — here, as it showed again.
    const l0 = w.logged.length;
    bp.load("yt:AAAAAAAAAAA", 0); await w.flush();
    bp.load("sc:artist-one/track-one", 0); await w.flush();
    w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush();      // hidden YouTube says it plays: paused, said
    bp.load("yt:BBBBBBBBBBB", 0); await w.flush();                      // YouTube shows again
    bp.load("sc:artist-two/track-two", 0); await w.flush();             // and steps aside again, saying nothing in between
    w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush();      // a new stray play
    const said = w.logged.slice(l0).filter((x) => /^Player: corrected yt — playing while not shown \(the box shows sc\)$/.test(x));
    ok(said.length === 2, "C — THE CHECK SAYS IT AGAIN FOR A NEW STRAY PLAY once its player has shown in between, though that " +
      "player reported nothing while it showed", w.logged.slice(l0));
  }
  // ── The room's box, its song over, makes no new frame on `play()`: it keeps its one (a preview's opens afresh) ──
  {
    const w = world();
    const box = w.box("player");
    const bp = w.SongPlayer.make(box, { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    bp.load("sc:artist-one/track-one", 0);
    w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
    w.sc.fire("sc-player", "FINISH"); await w.flush();
    const n = w.calls.length;
    bp.play(); await w.tick(1000);
    ok(w.count(box, "sc-player") === 1 && w.calls.slice(n).filter((c) => /^SC\.Widget /.test(c)).length === 0 && w.sc.made.length === 1,
      "B4 — THE ROOM'S BOX, ITS SONG OVER, MAKES NO NEW FRAME ON PLAY: it keeps its one (`ddjp_714`; only a preview's opens afresh)",
      { frames: childIds(box), calls: w.calls.slice(n) });
  }
  // ── The length's rule, read on its own: what SoundCloud says it can play ──
  {
    const w = world();
    const P = w.SCP.playableMs;
    const cases = [
      [null, 215300, 215300, "no sound: getDuration"],
      [{ id: 1, title: "t" }, 215300, 215300, "a sound with no such field: getDuration alone"],
      [{ duration: 215300, full_duration: 215300, policy: "ALLOW", media: { transcodings: [{ snipped: false, duration: 215300 }] } }, 215300, 215300, "a whole track"],
      [{ media: { transcodings: [{ snipped: true, duration: 30000 }] } }, 215300, 30000, "a stream marked snipped: its length"],
      [{ duration: 30000, full_duration: 215300, policy: "SNIP" }, 215300, 30000, "duration under full_duration, policy SNIP"],
      ["not a sound", 0, 0, "an answer of another shape, and no duration"],
    ];
    const wrong = cases.filter((c) => P(c[0], c[1]) !== c[2]).map((c) => c[3] + " → " + P(c[0], c[1]));
    ok(wrong.length === 0, "B7 — THE LENGTH'S RULE (`SoundCloudPlayer.playableMs`): getDuration; a snippet's length where the sound shows one; " +
      "getDuration alone where it carries no such field", wrong);
  }
  // ── A reading no key names is null WHOLESALE; a bare id, an unknown service or a broken id is refused with no call ──
  {
    const w = world();
    const bp = w.SongPlayer.make(w.box("player"), { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    ok(bp.reading() === null && bp.song() === null, "B9 — before a load nothing is named: the reading is null wholesale", bp.reading());
    const n = w.calls.length;
    ok(bp.load("AAAAAAAAAAA", 0) === false && bp.load("zz:AAAAAAAAAAA", 0) === false && bp.load("sc:Artist/Track", 0) === false &&
      bp.load("sc:one-part", 0) === false && w.calls.length === n,
      "B3 — a bare id, an unknown service's key and a key whose id breaks its rule (SoundCloud's: lowercase, two parts) are refused: nothing is loaded", w.calls.slice(n));
  }
  // ── The preview's box: only the song's own service's player is made, and it opens on the song ──
  {
    const w = world();
    const box = w.box("preview-player");
    w.SongPlayer.make(box, { song: "yt:CCCCCCCCCCC", preview: true, startMuted: false }, {});
    ok(JSON.stringify(childIds(box)) === JSON.stringify(["yt-preview-player"]) && w.sc.made.length === 0,
      "B1 — a PREVIEW makes only its song's service's player, in its box, and none of another service", childIds(box));
    ok(w.calls[0] === 'new yt-preview-player {"width":"100%","height":"100%","videoId":"CCCCCCCCCCC","playerVars":{"autoplay":1,"controls":1,"mute":0,"playsinline":1,"rel":0},"events":{}}',
      "B2 — YouTube's preview player is made with the options it always had, on its song's own id", w.calls[0]);
    const box2 = w.box("preview-player-2");
    w.SongPlayer.make(box2, { song: "sc:artist-name/track-name", preview: true, startMuted: false }, {});
    ok(JSON.stringify(childIds(box2)) === JSON.stringify(["sc-preview-player-2"]) && w.sc.made.length === 1 &&
      w.sc.made[0].st.url === "https://soundcloud.com/artist-name/track-name" && w.seen(box2, "sc-preview-player-2") === "shown",
      "B1 — and a preview of a SoundCloud song makes SoundCloud's player alone, shown, its widget opened at once on the song", { ids: childIds(box2), url: w.sc.made[0] && w.sc.made[0].st.url });
  }
}

// ═══ PART C — SOUNDCLOUD PLAYS IN THE ROOM'S PLAYER ═════════════════════════════════════════════════════════════════
async function partC() {
  const PS = read("ui/player.js");
  const fn = (name) => { const i = PS.indexOf("  function " + name + "("); const j = PS.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? PS.slice(i, j + 4) : ""; };
  // The room's push since `ddjp_714`: its own decisions, then the plug's check, and the check's answer back (`_act`).
  const NAMES = ["_loadReason", "loadSong", "_doLoad", "_driveNowPlaying", "_followRoom", "_wantOf", "_checkPlayer"];
  const ACT = (() => { const a = PS.indexOf("  const _act = {"); const b = PS.indexOf("\n  };\n", a); return (a >= 0 && b > a) ? PS.slice(a, b + 5) : ""; })();
  const SRC = NAMES.map(fn).join("") + ACT;
  const W = require("./_probe-j41-wire.js");
  const ev = W.playerEvents();
  ok(ev.ok && ["ready", "state", "failed"].every((k) => !!ev.handlers[k]) && ACT.indexOf("load: (key") >= 0 && NAMES.every((n) => SRC.indexOf("function " + n + "(") >= 0),
    "C PREMISE — the room's shipped load path and its three plug handlers were found in ui/player.js", ev.stage || ev.keys);
  if (!ev.ok) return;
  const w = world();
  ok(w.players.indexOf("ui/soundcloud.js") >= 0, "C PREMISE — the table names SoundCloud's real player file, and the world loads it", w.players);
  const noted = [];
  let np = null;
  const target = { SongPlayer: w.SongPlayer, Songs: w.Songs, _wantSong: null, _loadTimer: null, _currentSong: null, _endedPi: null, _heldPi: null, _lastNp: null,
    PlaylistPanels: { previewActive: () => false }, _lastPlayPi: null,
    _notPlayablePi: null, PLAYER_LOAD_RETRY_MS: 100, VOLUME_APPLY_DELAY_MS: 0, Logger: { info() {}, warn() {}, debug() {}, error() {} }, Date, Math, JSON,
    ServerClock: { serverNow: () => 1e12 + w.clock.now }, setTimeout: () => 0, clearTimeout() {},
    Playback: { elapsedSec: () => (np && np.elapsed) || 0, notifyEnded: (k, pi) => noted.push("ended " + k + " " + pi),
      setDuration: (k, d) => noted.push("length " + k + " " + d), isHeld: () => false, setDurationProvider() {} },
    MediaBlocked: { notifyPlayerFailed: (r, k) => noted.push("blocked " + r + " " + k) },
    _botViewOff: () => false, _loadsByPi: Object.create(null), _plog() {}, _noteLoadState() {} };
  const deep = new Proxy(function () { return undefined; }, { get: (o, k) => (k === "then" || k === Symbol.toPrimitive || k === Symbol.iterator ? undefined : deep), apply: () => deep, set: () => true });
  const scope = new Proxy(target, { has: () => true, set: (o, k, v) => { o[k] = v; return true; },
    get: (o, k) => (k in o) ? o[k] : (k === Symbol.unscopables ? undefined : (k in globalThis ? globalThis[k] : deep)) });
  const api = new Function("scope", "with (scope) {\n" + SRC + "\nreturn { _driveNowPlaying };\n}")(scope);
  const H = {};
  for (const k of ["ready", "state", "failed"]) H[k] = new Function("scope", "with (scope) { return (" + ev.handlers[k] + "); }")(scope);
  // The room's box player, made as `initSongPlayer` makes it, with the room's own handlers.
  const box = w.box("player");
  target.player = w.SongPlayer.make(box, { startMuted: true }, { ready: H.ready, state: H.state, failed: H.failed });
  w.yt().cfg.events.onReady({}); await w.flush();
  // This device's volume, given to the box as the room's `applyVolumeState` gives it once the player is ready (`ddjp_714`).
  target.player.setVolume(60); target.player.unmute();
  const scOpens = () => w.calls.filter((c) => /^SC\.Widget sc-player /.test(c));
  const scLoads = () => w.calls.filter((c) => /^sc-player\.load\(/.test(c));
  const ytLoads = () => w.calls.filter((c) => /\.loadVideoById\(/.test(c));
  const scAll = () => scOpens().length + scLoads().length;
  // A song, joined `elapsed` s in, redrawn as the room redraws (every 200 ms) until it is loaded.
  async function play(pi, key, elapsed, until) {
    np = { pi, dj: "@d:hs", song: { songKey: key }, startedAt: 1e12 + w.clock.now - elapsed * 1000, elapsed, duration: 0 };
    target._lastNp = np;
    for (let i = 0; i < 10; i++) { try { api._driveNowPlaying(np); } catch (e) { /* UI helpers after the load, against stand-ins */ } await w.tick(200); if (until()) break; }
  }
  await play("$s1", "sc:artist-one/track-one", 12, () => scAll() >= 1);
  ok(JSON.stringify(scOpens()) === JSON.stringify(["SC.Widget sc-player https://soundcloud.com/artist-one/track-one"]) && scLoads().length === 0 && ytLoads().length === 0,
    "C — THE ROOM LOADS A SOUNDCLOUD SONG ONCE, BY ITS LINK, through SoundCloud's own player (the widget opened on it) — YouTube's untouched", { opens: scOpens(), loads: scLoads(), yt: ytLoads() });
  ok(w.seen(box, "sc-player") === "shown" && w.seen(box, "yt-player") === "hidden",
    "C — THE ROOM'S FIRST SONG IS SOUNDCLOUD'S: its player is the one seen, YouTube's empty player hidden (the plug's change at " +
    "`ddjp_709`: before it, a box hid only the player that had shown a song)", [w.seen(box, "sc-player"), w.seen(box, "yt-player")]);
  w.sc.fire("sc-player", "READY"); await w.flush();
  w.sc.fire("sc-player", "PLAY"); await w.flush();
  ok(w.calls.indexOf("sc-player.seekTo(12000)") >= 0, "C — joined late, it starts at the room's point, in milliseconds (12 s → 12000)", w.calls.filter((c) => /sc-player/.test(c)));
  ok(noted.indexOf("length sc:artist-one/track-one 215.3") >= 0, "C — ITS LENGTH IS REPORTED to Playback by the room's own state handler, by its key, in seconds", noted);
  ok(JSON.stringify(target.player.reading()) === JSON.stringify({ songKey: "sc:artist-one/track-one", seconds: 215.3 }),
    "C — and the length provider's reading names it by its key", target.player.reading());
  for (let i = 0; i < 6; i++) { try { api._driveNowPlaying(np); } catch (e) {} await w.tick(200); }
  ok(scAll() === 1, "C — redrawn while it plays, it is NOT loaded again", { opens: scOpens(), loads: scLoads() });
  w.sc.fire("sc-player", "FINISH"); await w.flush();
  ok(noted.indexOf("ended sc:artist-one/track-one $s1") >= 0, "C — IT ENDS: the room's handler hands Playback the ended song's key and its play", noted);
  // The room holds the ended song (its push says so): the frame stays, silent; the next song of the same service: the widget's
  // own `load`, into the same frame (`ddjp_714`).
  np = Object.assign({}, np, { ended: true });
  target._lastNp = np;
  const c1 = w.calls.length;
  try { api._driveNowPlaying(np); } catch (e) {}
  ok(w.count(box, "sc-player") === 1 && w.calls.slice(c1).indexOf("sc-player.setVolume(0)") >= 0,
    "C — ITS SONG OVER AND HELD, ITS FRAME STAYS, SILENT (`ddjp_714`): the check holds a held player's sound at 0", { frames: childIds(box), calls: w.calls.slice(c1) });
  await play("$s2", "sc:artist-one/track-two", 0, () => scLoads().length >= 1);
  ok(scOpens().length === 1 && scLoads().length === 1 && /^sc-player\.load\("https:\/\/soundcloud\.com\/artist-one\/track-two",\{"auto_play":true,"hide_related":true/.test(scLoads()[0]) &&
    w.count(box, "sc-player") === 1,
    "C — THE NEXT GOES INTO THE SAME FRAME (`ddjp_714`): the widget's own `load` on its link, with the look and `auto_play` — no new widget", { opens: scOpens(), loads: scLoads() });
  w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
  ok(noted.indexOf("length sc:artist-one/track-two 215.3") >= 0, "C — and its length is reported in turn", noted);
  // A snippet: the room is handed what SoundCloud says it can play, and agrees on it as on any length.
  await play("$s3", "sc:artist-two/go-track", 0, () => scLoads().length >= 2);
  ok(w.count(box, "sc-player") === 1 && scOpens().length === 1 && scLoads().length === 2, "C — a song after a song: one frame, the same", childIds(box));
  w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush();
  ok(noted.indexOf("length sc:artist-two/go-track 30") >= 0,
    "C — A SNIPPET'S LENGTH IS REPORTED AS WHAT SOUNDCLOUD SAYS IT CAN PLAY: 30 s, handed to Playback as any length is (no new room rule)", noted);
  // A YouTube song in the same room, then back.
  await play("$y1", "yt:AAAAAAAAAAA", 5, () => ytLoads().length >= 1);
  ok(JSON.stringify(ytLoads()) === JSON.stringify(['yt-player.loadVideoById({"videoId":"AAAAAAAAAAA","startSeconds":5})']),
    "C — a YouTube song next, in the same box: YouTube's player loads it, at the room's point", ytLoads());
  const asideCalls = w.calls.filter((c) => /^sc-player\.(pause|setVolume)\(/.test(c)).slice(-2);
  ok(target.player.service() === "yt" && w.seen(box, "sc-player") === "hidden" && w.seen(box, "yt-player") === "shown" &&
    JSON.stringify(asideCalls) === JSON.stringify(["sc-player.pause()", "sc-player.setVolume(0)"]),
    "C — and SoundCloud's player stepped aside: its frame kept, hidden, paused and silent (`ddjp_714`)", { ids: childIds(box), asideCalls });
  // The frame stepped aside reports late — an end, an error — while YouTube's song plays: nothing reaches the room.
  const before = noted.length;
  w.sc.fire("sc-player", "FINISH"); w.sc.fire("sc-player", "ERROR"); await w.flush();
  ok(noted.slice(before).filter((x) => /^(ended|blocked) /.test(x)).length === 0,
    "C — A FRAME STEPPED ASIDE REPORTS NOTHING: a late end and an error from SoundCloud's hidden frame neither end nor block the YouTube " +
    "song now showing", noted.slice(before));
  await play("$s4", "sc:artist-three/track-x", 0, () => scLoads().length >= 3);
  ok(scOpens().length === 1 && /^sc-player\.load\("https:\/\/soundcloud\.com\/artist-three\/track-x",/.test(scLoads()[2]) && target.player.service() === "sc" &&
    w.seen(box, "sc-player") === "shown" && w.seen(box, "yt-player") === "hidden" && w.count(box, "sc-player") === 1,
    "C — and back to SoundCloud, in the same frame", { opens: scOpens(), loads: scLoads() });
  // The player stepped aside — YouTube's, hidden and stopped — reports late, an end and an error: the room hears neither (709).
  const b2 = noted.length;
  w.yt().cfg.events.onStateChange({ data: 0 }); w.yt().cfg.events.onError({ data: 150 }); await w.flush();
  ok(noted.slice(b2).filter((x) => /^(ended|blocked) /.test(x)).length === 0,
    "C — THE BOX HEARS ONLY THE PLAYER IT SHOWS: a late end and an error from YouTube's player, stepped aside, neither end nor block " +
    "the SoundCloud song now showing (`ddjp_709`)", noted.slice(b2));
  // ONLY THE PLAYER THE BOX SHOWS MAY MAKE SOUND (`ddjp_710`; the plug's check since `ddjp_714`): YouTube's hidden player says it
  // plays — the check pauses it at once, the log says so once, and the room's SoundCloud song is untouched.
  const b3 = noted.length, c3 = w.calls.length, l3 = w.logged.length;
  const STRAY = /^Player: corrected yt — playing while not shown \(the box shows sc\)$/;
  w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush();
  w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush();
  const strayLines = w.logged.slice(l3).filter((x) => STRAY.test(x));
  ok(acts(w.calls.slice(c3)).filter((c) => /^yt-player\./.test(c)).join(" ") === "yt-player.pauseVideo() yt-player.pauseVideo()" && strayLines.length === 1 &&
    noted.length === b3 && target.player.service() === "sc" && w.count(box, "sc-player") === 1 && acts(w.calls.slice(c3)).filter((c) => /^sc-/.test(c)).length === 0,
    "C — A HIDDEN PLAYER THAT PLAYS IS PAUSED AT ONCE BY THE CHECK AND LOGGED ONCE (`Player: corrected yt — playing while not shown …`); " +
    "the room hears nothing of it and its SoundCloud song is untouched", { calls: w.calls.slice(c3), logged: w.logged.slice(l3), noted: noted.slice(b3) });
  w.yt().cfg.events.onStateChange({ data: 2 }); w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush();
  ok(w.logged.filter((x) => STRAY.test(x)).length === 2,
    "C — and a second play, after a check found it paused, is logged again", w.logged.slice(l3));
  // Its error, which carries no code, reaches MediaBlocked as a reason the room counts in its vocabulary.
  w.sc.fire("sc-player", "READY"); await w.flush();
  w.sc.fire("sc-player", "PLAY"); await w.flush();
  w.sc.fire("sc-player", "ERROR"); await w.flush();
  const blocked = noted.filter((x) => /^blocked /.test(x));
  ok(JSON.stringify(blocked) === JSON.stringify(["blocked unavailable sc:artist-three/track-x"]),
    "C — A FAILURE REACHES MediaBlocked AS A REASON, with the song's key: the service's own error never leaves its file", blocked);
  ok(Object.prototype.hasOwnProperty.call(W.REASONS, "unavailable"), "C — and the reason is one the room's vocabulary knows (`StateDeriver`'s blocked reasons)", Object.keys(W.REASONS));
  MEASURED.second = "SoundCloud: 4 songs loaded once each by link (1 widget opened, 3 loads into the same frame), 3 lengths (a snippet's 30 s), an end held silent, a YouTube song between, a failure as `unavailable`";
}

// ═══ PART D — THE SAME CALLS, IN THE SAME ORDER, AS `ddjp_705` ═══════════════════════════════════════════════════════
async function partD() {
  const CTL = require("./_player-calls-705.js");
  const r = await require("./_player-drive.js").drive();
  const has = (s) => r.calls.indexOf(s) >= 0;
  const LANDMARKS = [
    'new yt-player {"height":"300","width":"100%","videoId":"","playerVars":{"autoplay":1,"controls":1,"mute":1},"events":{}}',
    'yt-player.loadVideoById({"videoId":"AAAAAAAAAAA","startSeconds":30})', "yt-player.seekTo(60,true)", "yt-player.setVolume(40)",
    "yt-player.mute()", "→ yt-player state 0", "yt-player.stopVideo()", 'yt-player.loadVideoById({"videoId":"BBBBBBBBBBB","startSeconds":0})',
    "→ yt-player error 150", "yt-player.pauseVideo()",
    'new yt-preview-player {"width":"100%","height":"100%","videoId":"CCCCCCCCCCC","playerVars":{"autoplay":1,"controls":1,"mute":0,"playsinline":1,"rel":0},"events":{}}',
    "yt-preview-player.pauseVideo()", "yt-preview-player.playVideo()", "yt-preview-player.setVolume(25)", "yt-preview-player.mute()",
    "yt-preview-player.destroy()", "yt-player.playVideo()"];
  const missing = LANDMARKS.filter((s) => !has(s));
  ok(missing.length === 0 && !r.calls.some((c) => /^!!/.test(c)), "D PREMISE — the drive reached every part of the scenario (late join, drift seek, volume, " +
    "mute, end, next, error 150, the preview's open, pause, play, volume, mute and close, the room's pause and resume)", missing.concat(r.calls.filter((c) => /^!!/.test(c))));
  ok(CTL.calls.length > 200, "D PREMISE — the control is 705's recording", CTL.calls.length);
  ok(fs.readFileSync(path.join(__dirname, "_screen-world.js"), "utf8").indexOf('"ui/soundcloud.js"') >= 0,
    "D PREMISE — the drive's page holds SoundCloud's player file, as the real page does (`ddjp_709`)");
  // Commands and events: everything but a reading (a `get…` or `isMuted`).
  const CMD = (c) => !/^[\w-]+\.(get\w+|isMuted)\(/.test(c);
  const ctl = CTL.calls.filter(CMD), now = r.calls.filter(CMD);
  // 705's commands with the check's two put in at their places: what this tree must hand YouTube, entry by entry.
  const want = [];
  let held = false, loads = 0;
  for (let k = 0; k < ctl.length; k++) {
    want.push(ctl[k]);
    if (ctl[k] === "→ yt-player state 0") held = true;
    if (held && ctl[k] === "yt-player.stopVideo()") { want.push("yt-player.mute()"); held = false; }
    if (/^yt-player\.loadVideoById\(/.test(ctl[k]) && ++loads === 2) want.push("yt-player.unMute()");
  }
  let i = 0;
  while (i < want.length && i < now.length && want[i] === now[i]) i++;
  ok(want.length === ctl.length + 2 && i === want.length && now.length === want.length,
    "D — YOUTUBE'S PLAYERS ARE HANDED THE SAME COMMANDS, IN THE SAME ORDER, AS IN `ddjp_705` — every one of " + ctl.length + " (decision 5) — and " +
    "exactly two more, the check's (`ddjp_714`): `mute()` after the held end's `stopVideo()`, `unMute()` after the next song's load",
    { firstDifference: i, want: want.slice(i, i + 4), now: now.slice(i, i + 4) });
  const kinds = (L) => { const m = {}; for (const c of L) { const k = (c.match(/^[\w-]+\.(get\w+|isMuted)\(/) || [])[1]; if (k) m[k] = (m[k] || 0) + 1; } return m; };
  console.log("[player-plug] MEASURED D — YouTube's readings in the drive, 705 → now (the check's): " + JSON.stringify(kinds(CTL.calls)) + " → " + JSON.stringify(kinds(r.calls)));
  const norm = (a) => a.map((x) => x.replace(/^blocked (150|embed-denied) /, "blocked <150> "));
  ok(JSON.stringify(norm(r.noted)) === JSON.stringify(norm(CTL.noted)) && r.noted.some((x) => /^blocked embed-denied /.test(x)),
    "D — and the room hands its features the same: the lengths and the end as before, the blocked song as the app's reason where 705 handed YouTube's code",
    { now: r.noted, ddjp_705: CTL.noted });
  MEASURED.same = ctl.length;
}

// ═══ PART E — THE TWO PLAYERS SWITCH INDEPENDENTLY ═══════════════════════════════════════════════════════════════════
async function partE() {
  // ── E1: the room's box goes YouTube → SoundCloud → YouTube ──
  {
    const w = world();
    const box = w.box("player");
    const room = w.SongPlayer.make(box, { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    const steps = [];
    let n = w.calls.length;
    const take = (label) => { steps.push({ label, acts: acts(w.calls.slice(n)), yt: w.seen(box, "yt-player"), sc: w.seen(box, "sc-player"), service: room.service() }); n = w.calls.length; };
    room.load("yt:AAAAAAAAAAA", 0); w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush(); take("YouTube");
    room.load("sc:artist-one/track-one", 0); w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); await w.flush(); take("SoundCloud");
    room.load("yt:BBBBBBBBBBB", 0); w.yt().cfg.events.onStateChange({ data: 1 }); await w.flush(); take("YouTube again");
    const loadsOf = (s) => s.acts.filter((c) => /loadVideoById\(|^SC\.Widget |\.load\(/.test(c));
    const okSteps = steps.length === 3 &&
      JSON.stringify(steps.map(loadsOf)) === JSON.stringify([['yt-player.loadVideoById({"videoId":"AAAAAAAAAAA","startSeconds":0})'],
        ["SC.Widget sc-player https://soundcloud.com/artist-one/track-one"], ['yt-player.loadVideoById({"videoId":"BBBBBBBBBBB","startSeconds":0})']]) &&
      steps[1].acts.indexOf("yt-player.stopVideo()") === 0 && steps[2].acts.indexOf("sc-player.pause()") === 0 &&
      steps[2].acts.filter((c) => /^SC\.Widget |^sc-player\.load\(/.test(c)).length === 0 &&
      JSON.stringify(steps.map((s) => [s.service, s.yt, s.sc])) === JSON.stringify([["yt", "shown", "gone"], ["sc", "hidden", "shown"], ["yt", "shown", "hidden"]]);
    ok(okSteps, "E1 — THE ROOM'S BOX GOES YOUTUBE → SOUNDCLOUD → YOUTUBE: each song loaded once, by its own service's player; at each switch the " +
      "other player is STOPPED and HIDDEN — YouTube's `stopVideo`, SoundCloud's widget paused, its frame kept (`ddjp_714`) — and the one " +
      "playing is the one seen", steps);
  }
  // ── E2/E3: a preview over a room song of the other service, both ways; each box acts on its own players alone ──
  for (const [roomKey, pvKey] of [["yt:AAAAAAAAAAA", "sc:artist-two/track-two"], ["sc:artist-one/track-one", "yt:CCCCCCCCCCC"]]) {
    const w = world();
    const roomBox = w.box("player");
    const room = w.SongPlayer.make(roomBox, { startMuted: true }, {});
    w.yt().cfg.events.onReady({}); await w.flush();
    room.load(roomKey, 0);
    if (roomKey.indexOf("sc:") === 0) { w.sc.fire("sc-player", "READY"); w.sc.fire("sc-player", "PLAY"); } else w.yt().cfg.events.onStateChange({ data: 1 });
    await w.flush();
    const roomSvc = room.service();
    let n = w.calls.length;
    const pvBox = w.box("preview-player");
    const pv = w.SongPlayer.make(pvBox, { song: pvKey, preview: true, startMuted: false }, {});
    if (pvKey.indexOf("sc:") === 0) { w.sc.fire("sc-preview-player", "READY"); w.sc.fire("sc-preview-player", "PLAY"); } else w.ytNamed("yt-preview-player").cfg.events.onReady({});
    await w.flush();
    const opened = acts(w.calls.slice(n));
    const pvSvc = pvKey.slice(0, 2);
    const pvName = pvSvc + "-preview-player";
    const wantOpen = pvSvc === "sc" ? "SC.Widget sc-preview-player https://soundcloud.com/artist-two/track-two" : 'new yt-preview-player {"width":"100%","height":"100%","videoId":"CCCCCCCCCCC","playerVars":{"autoplay":1,"controls":1,"mute":0,"playsinline":1,"rel":0},"events":{}}';
    ok(opened[0] === wantOpen && JSON.stringify(childIds(pvBox)) === JSON.stringify([pvName]) && opened.every((c) => c.indexOf("preview-player") >= 0) &&
      room.service() === roomSvc && w.seen(roomBox, roomSvc + "-player") === "shown",
      "E2 — THE PREVIEW PLAYS " + (pvSvc === "sc" ? "A SOUNDCLOUD SONG WHILE THE ROOM PLAYS A YOUTUBE ONE" : "A YOUTUBE SONG WHILE THE ROOM PLAYS A SOUNDCLOUD ONE") +
      ": its box makes its song's service's player alone, on its song; the room's box keeps its own showing", { opened, pvBox: childIds(pvBox), room: room.service() });
    n = w.calls.length;
    pv.pause(); pv.play(); pv.seek(5); pv.setVolume(25); pv.mute(); pv.unmute();
    const pvActs = acts(w.calls.slice(n));
    ok(pvActs.length >= 5 && pvActs.every((c) => c.indexOf(pvName + ".") === 0),
      "E3 — EACH BOX ACTS ONLY ON ITS OWN PLAYERS: the preview's pause, play, seek, volume and mute reach `" + pvName + "` alone, the room's box nothing", pvActs);
    n = w.calls.length;
    room.pause(); room.setVolume(30); room.play();
    const roomActs = acts(w.calls.slice(n));
    ok(roomActs.length >= 2 && roomActs.every((c) => /^(yt|sc)-player\./.test(c)),
      "E3 — and the room's pause, volume and play reach the room's own players alone (the volume the one it shows, `ddjp_714`), the preview's nothing", roomActs);
    n = w.calls.length;
    pv.destroy();
    ok(acts(w.calls.slice(n)).every((c) => c.indexOf("preview-player") >= 0) && room.service() === roomSvc && w.seen(roomBox, roomSvc + "-player") === "shown",
      "E3 — the preview closed, the room's box is as it was", { room: room.service(), seen: w.seen(roomBox, roomSvc + "-player") });
  }
  await partE4();
}

// ── E4: through the whole UI — the room's song pauses and resumes around the preview, as today, whichever service each plays ──
async function partE4() {
  const D = require("./_player-drive.js");
  const results = [];
  for (const [roomKey, pvKey] of [["sc:artist-one/track-one", "yt:CCCCCCCCCCC"], ["yt:AAAAAAAAAAA", "sc:artist-two/track-two"]]) {
    const yt = D.standIn();
    const pending = [];
    const sc = SCW.standIn({ calls: yt.calls, later: (fn) => pending.push(fn) });
    const { w } = D.screen(yt, { SC: sc.SC });
    try { w.sb.window.SC = sc.SC; } catch (e) {}
    const P = w.sb.Player;
    const drain = () => { for (let i = 0; i < 20 && pending.length; i++) pending.splice(0).forEach((f) => f()); };
    const step = async (ms) => { drain(); await w.advance(ms); drain(); for (let i = 0; i < 2; i++) w.frame(); drain(); };
    P.initSongPlayer();
    await step(100);
    yt.ready("yt-player");
    await step(1000);
    P.onPlaybackStateChange({ pi: "$r1", dj: "@d:hs", song: { songKey: roomKey }, startedAt: w.clock.now - 10000, elapsed: 10, duration: 200 });
    await step(200);
    if (roomKey.indexOf("sc:") === 0) { sc.fire("sc-player", "READY"); await step(50); sc.fire("sc-player", "PLAY"); await step(1000); }
    else { yt.state("yt-player", 3); await step(300); yt.state("yt-player", 1); await step(1000); }
    const roomName = roomKey.slice(0, 2) + "-player", pvName = pvKey.slice(0, 2) + "-preview-player";
    const playing = acts(yt.calls).some((c) => c === "SC.Widget sc-player https://soundcloud.com/artist-one/track-one" || /^yt-player\.loadVideoById\(\{"videoId":"AAAAAAAAAAA"/.test(c));
    let n = yt.calls.length;
    // The preview: a song row's picture, clicked (as `tests/_player-drive.js` opens it).
    let opened = false;
    try {
      const row = w.sb.PlaylistPanels.songRow(pvKey, {});
      const all = []; (function walk(x) { all.push(x); for (const c of (x._kids || [])) walk(c); })(row);
      const slot = all.find((x) => x.nodeType === 1 && /\bthumb-slot\b/.test(x.className || ""));
      if (slot && typeof slot.onclick === "function") { slot.onclick(); opened = true; }
    } catch (e) { yt.calls.push("!! the preview did not open: " + (e && e.message)); }
    await step(100);
    if (pvKey.indexOf("sc:") === 0) { sc.fire(pvName, "READY"); await step(50); sc.fire(pvName, "PLAY"); } else { yt.ready(pvName); await step(200); yt.state(pvName, 1); }
    await step(1000);
    const atOpen = acts(yt.calls.slice(n));
    n = yt.calls.length;
    const card = w.doc.body._kids.find((x) => /\bpreview-overlay\b/.test(x.className || ""));
    const all = []; if (card) (function walk(x) { all.push(x); for (const c of (x._kids || [])) walk(c); })(card);
    const by = (cls) => all.find((x) => x.nodeType === 1 && new RegExp("\\b" + cls + "\\b").test(x.className || ""));
    const play = by("pv-play"), xBtn = by("preview-x");
    if (play) { play.onclick(); await step(300); play.onclick(); await step(300); }
    const during = acts(yt.calls.slice(n));
    n = yt.calls.length;
    if (xBtn) { xBtn.onclick(); await step(500); }
    const atClose = acts(yt.calls.slice(n));
    results.push({ roomKey, pvKey, opened, playing, atOpen, during, atClose });
    const pauseOf = roomName === "sc-player" ? "sc-player.pause()" : "yt-player.pauseVideo()";
    const playOf = roomName === "sc-player" ? "sc-player.play()" : "yt-player.playVideo()";
    const pvMade = pvName === "sc-preview-player" ? "SC.Widget sc-preview-player https://soundcloud.com/artist-two/track-two" : "new yt-preview-player ";
    const roomOnly = (list) => list.filter((c) => c.indexOf(roomName + ".") === 0);
    ok(opened && playing && !yt.calls.some((c) => /^!!/.test(c)), "E4 PREMISE — through the whole UI, the room plays " + roomKey + " and a song row's picture opens the preview of " + pvKey,
      { opened, playing, bad: yt.calls.filter((c) => /^!!/.test(c)) });
    ok(roomOnly(atOpen)[0] === pauseOf && atOpen.some((c) => c.indexOf(pvMade) === 0) &&
      atOpen.filter((c) => /preview-player/.test(c)).every((c) => c.indexOf(pvName) >= 0),
      "E4 — THE ROOM'S SONG PAUSES AS THE PREVIEW OPENS (" + pauseOf + "), and the preview's box makes " + (pvName === "sc-preview-player" ? "SoundCloud's" : "YouTube's") +
      " player for its song — the room playing " + (roomName === "sc-player" ? "SoundCloud" : "YouTube"), atOpen);
    ok(during.length >= 2 && during.every((c) => c.indexOf(pvName + ".") === 0),
      "E4 — the preview's own play button acts on the preview's player alone", during);
    ok(atClose.indexOf(playOf) >= 0 && roomOnly(atClose).filter((c) => /load/.test(c)).length === 0,
      "E4 — AND RESUMES AS IT CLOSES (" + playOf + "), not loaded again", atClose);
  }
  MEASURED.switch = results.map((r) => r.roomKey.slice(0, 2) + " room / " + r.pvKey.slice(0, 2) + " preview").join(", ");
}

(async () => {
  try { partA(); } catch (e) { ok(false, "A threw — " + (e && e.stack || e)); }
  try { await partB(); } catch (e) { ok(false, "B threw — " + (e && e.stack || e)); }
  try { await partC(); } catch (e) { ok(false, "C threw — " + (e && e.stack || e)); }
  try { await partD(); } catch (e) { ok(false, "D threw — " + (e && e.stack || e)); }
  try { await partE(); } catch (e) { ok(false, "E threw — " + (e && e.stack || e)); }
  if (failed) { console.log("[player-plug] " + failed + " failure(s)"); process.exit(1); }
  console.log("[player-plug] PASS — every song service's player is behind one plug (" + asserts + " assertions): A the page's allowed hosts " +
    "are the table's (" + MEASURED.hosts + ") and the app's own, none missing or left over; every row names a player file that registers; " +
    "the page lists each row's player file after the plug, in the table's order (" + MEASURED.lines + "); nothing but YouTube's player " +
    "file knows YouTube's player, and the page (but for its player lines and the picture slot's CSS), app.js and the plug name no service; " +
    "SoundCloud's four things held by name; B the shape driven against YouTube's player and SoundCloud's (over a stand-in widget shaped from " +
    "its docs) — freshness: " + MEASURED.fresh + "; C " + MEASURED.second + ", in the room's own load path and handlers; D YouTube's players " +
    "handed the same " + MEASURED.same + " commands in the same order as ddjp_705, and the check's two (a held song muted, the next song " +
    "unmuted as it loads); E the room's box and a preview switch independently (" +
    MEASURED.switch + "), the room pausing and resuming around the preview");
})();
