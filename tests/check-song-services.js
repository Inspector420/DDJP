// tests/check-song-services.js
// SUBJECT: core/songs.js, core/playlistdoc.js, core/store.js, features/queue.js, features/medialength.js, features/userqueue.js,
//   features/playlists.js, features/metadata.js, features/botruntime.js, ui/songplayer.js, ui/youtube.js, ui/soundcloud.js,
//   ui/player.js, ui/playlists.js, ui/queue.js, backends/backend1/statederiver.js, core/, features/, ui/, backends/, app.js,
//   sw.js, sw-register.js
//
// WALL: A SONG IS NAMED BY ITS SERVICE, AND THE SERVICES HAVE ONE HOME (J29, step 1; the owner's rule, `main/01-project.md`
// §His priorities). Every song a room names is a KEY — `yt:` + YouTube's id — and what a service IS (its id rule, the link
// forms it reads, its canonical link, its picture) lives in `core/songs.js` and nowhere else.
//
//   PART A — nothing outside the module spells a service's id rule, its link hosts or its picture host. Read as the language
//            reads it: every app file is TOKENIZED (espree, which the lint guard already requires) and only its string,
//            template and regular-expression literals are searched, so a comment naming YouTube is not a finding and a
//            `/*` inside a string ("image/*") cannot hide one. Exempt, by name: each service's player file (`ui/youtube.js`,
//            J29's step 2, and `ui/soundcloud.js`, `ddjp_709`: the one file that knows its service's player and loads its
//            script), and three CHAT tables, cut out by their declarations (`LINK_HOST_GROUPS`, `LINK_TRACKING`,
//            `LINK_OPAQUE_HOSTS`): which sites a chat link may come from, which tracking parameters it drops and which short-link
//            hosts it cannot open are chat's questions, not a song's — `soundcloud.com` sits in all three. An anchor that
//            moves REFUSES the part by name rather than letting the cut go stale (the fifty-second signature).
//   PART B — every event that carries a song carries a key: the REAL `UserQueue`, `Queue`, `StreamManager` and
//            `StateDeriver` with the REAL module (no double of it), every song-carrying send driven — a join from each
//            link form, an order, an undeclare, a strike, a length report — and every bare id handed to a send refused,
//            nothing sent.
//   PART C — a round trip for every link form the parser read before keys: link → key → link, and key → service + id,
//            against the OLD parser's own answers (704's `extractVideoId` and `watchUrl`, copied below verbatim as the
//            control and called by nothing in the app). A bare id names no service.
//   PART D — ONE FORM EVERYWHERE (J29, step 2; the owner's, `ddjp_706`: nothing saved before `ddjp_705` carries over). A song
//            is its key in memory, on the device and in a file, and no record or file carries `source`. What was saved in
//            the old form — a playlist record, a single-playlist file, a library file, a picture or a title cached under a
//            bare id, a My queue list — is SKIPPED as invalid: never shown half-read, nothing thrown, and the log says once
//            to clear the site's data. A bare id is refused BY NAME in both add boxes (My queue's and a playlist's). Since J29's
//            step 3 (`ddjp_707`) the field is `songKey`: what 706 saved — a key under the old field name, in a playlist, a file,
//            My queue or the song history table — is skipped the same way; so is My queue's `{ stack }` list (D6), a history
//            row under the old name (D7), and the old hide-the-player preference (D8, decision 7).
//   PART E — a person never reads `yt:`: the bot's "Skipped …" line, the player's title before YouTube names it, a song
//            row's title before one is known, and what the main player and the picture are handed — each EXECUTED (the
//            preview's player is `check-preview-controls`' to drive, PART D). The main player is the REAL box player
//            (`ui/songplayer.js` + `ui/youtube.js`) over a recording stand-in for `YT.Player`.
//   PART F — SOUNDCLOUD'S LINKS (`ddjp_709`, J151; the supervisor's JOB 1, decisions 3 and 5). Its full, `www.` and `m.` links,
//            with `?si=` and `#t=`, read as `sc:<user>/<track>` → its link → the same key. Refused BY NAME, with the words the
//            owner will read: a short link, a set, a user's page (and SoundCloud's own pages), an over-long key — each through
//            the module, through My queue's add box and a playlist's (the words they return are the words on screen). The
//            longest key is the reducer's `songIdMaxLength`, read from the real reducer.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");
const PW = require("./_player-world.js");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[song-services] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const KEY_RE = /^yt:[A-Za-z0-9_-]{11}$/;   // what a YouTube song's key looks like, written here as the guard's own claim

// ═══ PART A — nothing outside the module knows a service ════════════════════════════════════════════════════════════════
const HOME = "core/songs.js";
const PLAYER_CODE = ["ui/youtube.js", "ui/soundcloud.js"];   // each service's player file (J29, step 2; `ddjp_709`: SoundCloud's)
const CHAT_CUTS = { "core/chatprefs.js": ["LINK_HOST_GROUPS"], "features/chat.js": ["LINK_TRACKING", "LINK_OPAQUE_HOSTS"] };
// What a service is, spelled: the id rule's quantifier, the link and picture hosts, the canonical link's path.
const FORBIDDEN = [
  { what: "the YouTube id rule ({11})", re: /\{11\}/ },
  { what: "a YouTube link host (youtube.com)", re: /youtube\.com/i },
  { what: "a YouTube link host (youtu.be)", re: /youtu\.be/i },
  { what: "the YouTube picture host (ytimg.com)", re: /ytimg\.com/i },
  { what: "the YouTube watch path (watch?v=)", re: /watch\?v=/i },
  { what: "a SoundCloud host (soundcloud.com)", re: /soundcloud\.com/i },   // `ddjp_709`: the second service
];
let espree = null;
try { espree = require("espree"); } catch (e) { espree = null; }
// THE TWENTY-SIXTH SIGNATURE: a dependency-backed guard fails when its dependency is absent, naming the one command.
ok(!!espree, "A PREMISE — `espree` (installed with eslint) must load: run `npm install`. A scan that cannot read the language " +
  "would pass while checking nothing");
function appFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    for (const n of fs.readdirSync(abs).sort()) {
      const r = rel + "/" + n;
      if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (n.endsWith(".js")) out.push(r);
    }
  };
  for (const d of ["core", "features", "ui", "backends"]) walk(d);
  for (const f of ["app.js", "sw.js", "sw-register.js"]) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}
// The literals of one source, as tokens, with the named declarations' tokens cut out (each must be found exactly once).
function literalsOf(rel, src, cuts) {
  const toks = espree.tokenize(src, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const drop = new Set();
  for (const name of (cuts || [])) {
    const at = [];
    for (let i = 0; i + 3 < toks.length; i++) {
      if (toks[i].type === "Keyword" && toks[i].value === "const" && toks[i + 1].value === name && toks[i + 2].value === "=") at.push(i);
    }
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
  return { literals: toks.filter((t, i) => !drop.has(i) && (t.type === "String" || t.type === "Template" || t.type === "RegularExpression")) };
}
function findings(rel, src, cuts) {
  const r = literalsOf(rel, src, cuts);
  if (r.refused) return r;
  const hits = [];
  for (const t of r.literals) for (const f of FORBIDDEN) if (f.re.test(t.value)) hits.push(rel + ":" + t.loc.start.line + " " + f.what + " in " + t.value.slice(0, 60));
  return { hits };
}
if (espree) {
  const files = appFiles();
  ok(files.indexOf(HOME) >= 0 && files.length > 60, "A PREMISE — the walk finds the app's files, the module among them", files.length);
  // THE CONTROL BEFORE THE ZERO (the forty-third signature): the scan must see what it is looking for where it is known to be.
  const home = findings(HOME, fs.readFileSync(path.join(ROOT, HOME), "utf8"));
  const homeKinds = new Set((home.hits || []).map((h) => h.replace(/^\S+ /, "").replace(/ in .*$/, "")));
  ok(homeKinds.size === FORBIDDEN.length, "A CONTROL — the scan finds every forbidden spelling in the module itself, so a zero " +
    "elsewhere is a reading of the files and not of a blind scan", [...homeKinds]);
  // And a comment is not a finding, while a `/*` inside a string hides nothing after it.
  const ctl = findings("(fixture)", "// youtube.com in a comment\nconst a = \"image/*\";\nconst b = \"https://i.ytimg.com/x\";\n", []);
  ok(ctl.hits && ctl.hits.length === 1 && /ytimg/.test(ctl.hits[0]), "A CONTROL — on a fixture, a comment is not a finding and a " +
    "string after `\"image/*\"` still is", ctl);
  const all = [], refused = [], exemptUsed = {};
  for (const rel of files) {
    if (rel === HOME) continue;
    const r = findings(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), CHAT_CUTS[rel]);
    if (r.refused) { refused.push(r.refused); continue; }
    if (PLAYER_CODE.indexOf(rel) >= 0) { exemptUsed[rel] = r.hits.length; continue; }
    for (const h of r.hits) all.push(h);
  }
  ok(refused.length === 0, "A REFUSED — a chat table this part cuts out by its declaration was not found as written; the cut " +
    "would otherwise go stale in silence and fire on the chat's own sites (the fifty-second signature)", refused);
  ok(PLAYER_CODE.every((f) => files.indexOf(f) >= 0), "A — the exempt player files are where their names say", PLAYER_CODE);
  ok(all.length === 0, "A — NOTHING OUTSIDE `core/songs.js` KNOWS A SONG SERVICE: its id rule, its link hosts and its picture " +
    "host have one home, and every other file asks it (`Songs`)", all);
  PART_A_NOTE = "the services' player files, the exemptions, hold " + PLAYER_CODE.map((f) => f + " " + exemptUsed[f]).join(", ") + " such spelling(s)";
}
var PART_A_NOTE;

// ═══ PART B — every event that carries a song carries a key ═════════════════════════════════════════════════════════════
const SONG_FIELDS = {   // which field of which type names a song, read from the wire as `features/queue.js` and
  "ddjp.dj.join": (c) => (c.v === undefined ? [] : [c.v]),     // `features/medialength.js` send it (a bare join names none)
  "ddjp.dj.strike": (c) => [c.v],
  "ddjp.dj.undeclare": (c) => [c.v],
  "ddjp.dj.order": (c) => (Array.isArray(c.o) ? c.o : [c.o]),
  "ddjp.media.len": (c) => [c.v],
};
function world() {
  const sent = [], timers = [];
  const bridge = {
    _sm: null, l: 0, n: 0,
    getUserId() { return "@me:hs"; },
    async sendEvent(channel, type, content) {
      bridge.l++; bridge.n++;
      sent.push({ type, content: JSON.parse(JSON.stringify(content)) });
      const body = Object.assign({}, content, { t: type, l: bridge.l, dv: 1 });
      const raw = { event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message", sender: "@me:hs", senderRank: 20,
        ts: 1000 + bridge.n * 60000, content: { body: JSON.stringify(body) }, l: bridge.l };
      bridge._sm.ingest(raw);
      return raw;
    },
  };
  const mem = {};
  const storage = { save(k, v) { mem[k] = JSON.parse(JSON.stringify(v)); }, load(k) { return mem[k] ? JSON.parse(JSON.stringify(mem[k])) : null; }, remove(k) { delete mem[k]; } };
  const sb = loadInContext(
    ["core/logger.js", "core/songs.js", "core/store.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
     "backends/backend1/streammanager.js", "core/playlistdoc.js", "features/queue.js", "features/userqueue.js", "features/medialength.js"],
    { Date, URL, MatrixBridge: bridge, StorageIO: storage,
      Capabilities: { staggerMs: () => 0, atLeast: () => false },
      // MediaLength's ladder waits on a timer; held here and fired by the part, so nothing waits in real time.
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  bridge._sm = sb.StreamManager;
  const clock = { jobs: [], set(fn) { this.jobs.push(fn); return this.jobs.length; }, clear() {}, run() { const j = this.jobs; this.jobs = []; j.forEach((f) => f()); } };
  sb.UserQueue.setClock(clock);
  const flush = () => new Promise((r) => setImmediate(r));
  return { sb, sent, timers, clock, flush, bridge };
}
function songsOn(sent) {
  const out = [];
  for (const e of sent) if (SONG_FIELDS[e.type]) for (const v of SONG_FIELDS[e.type](e.content)) out.push({ type: e.type, v });
  return out;
}
const FORMS = [   // every form the parser read before keys (PART C reads them against the old parser too)
  "https://www.youtube.com/watch?v=AAAAAAAAAAA",
  "https://www.youtube.com/watch?v=BBBBBBBBBBB&t=30s",
  "https://youtu.be/CCCCCCCCCCC?si=x",
  "https://www.youtube.com/shorts/DDDDDDDDDDD",
  "https://www.youtube.com/embed/EEEEEEEEEEE",
  "https://m.youtube.com/watch?v=FFFFFFFFFFF",
  "https://music.youtube.com/watch?v=GGGGGGGGGGG&list=x",
  "https://youtu.be/HHHHHHHHHHH.",
];
async function partB() {
  const w = world();
  const { Queue, UserQueue, MediaLength, StreamManager, Songs } = w.sb;
  ok(!!Songs && typeof Songs.isKey === "function", "B PREMISE — the sandbox holds the REAL `Songs`, not a double");
  // ADDED AT `ddjp_712` (the owner's decision 2: old rooms are not supported): what a person reads for a song is a key's own id,
  // and anything else is nothing — a room's bare id (a room made before keys) was shown as it was until then.
  ok(Songs.shownAs("yt:AAAAAAAAAAA") === "AAAAAAAAAAA" && Songs.shownAs("AAAAAAAAAAA") === "" && Songs.shownAs(null) === "",
    "B — WHAT A PERSON READS FOR A SONG: a key's own id, and anything that is not a key reads as nothing (`ddjp_712`)",
    [Songs.shownAs("yt:AAAAAAAAAAA"), Songs.shownAs("AAAAAAAAAAA"), Songs.shownAs(null)]);
  Queue.init("!ev:hs"); UserQueue.init("space1"); UserQueue.resync();
  // B1 — a join from every link form, through My queue's one door.
  for (const f of FORMS) {
    const r = UserQueue.add(f);
    ok(r && r.ok === true && KEY_RE.test(r.songKey), "B1 — My queue reads " + f + " as a song key", r);
  }
  UserQueue.joinRoomQueue();
  await w.flush(); w.clock.run(); await w.flush();
  const joins = w.sent.filter((e) => e.type === "ddjp.dj.join" && e.content.v !== undefined);
  ok(joins.length >= 2, "B1 PREMISE — the reconcile sent joins for the songs added, so the rows below read the wire", w.sent.map((e) => e.type));
  for (const j of joins) {
    ok(KEY_RE.test(j.content.v) && j.content.u === Songs.linkOf(j.content.v),
      "B1 — a join carries the song's KEY in `v` and its canonical link, rebuilt from the key, in `u`", j.content);
  }
  // B2 — an order: the top two swapped, then settled.
  const before = w.sent.length;
  UserQueue.moveUp(1); w.clock.run(); await w.flush();
  const orders = w.sent.slice(before).filter((e) => e.type === "ddjp.dj.order");
  ok(orders.length === 1, "B2 PREMISE — swapping the top two sends one order", w.sent.slice(before).map((e) => e.type));
  // B3 — an undeclare: the declared head removed.
  const b3 = w.sent.length;
  UserQueue.removeAt(0); w.clock.run(); await w.flush();
  ok(w.sent.slice(b3).some((e) => e.type === "ddjp.dj.undeclare"), "B3 PREMISE — removing a declared song sends an undeclare",
    w.sent.slice(b3).map((e) => e.type));
  // B4 — a strike, named as the room queue names it: the song read from the room's own rotation.
  const mine = (StreamManager.getState().rotation || []).find((r) => r.user === "@me:hs");
  const target = mine && mine.pending.length ? mine.pending[0].songKey : null;
  ok(KEY_RE.test(String(target)), "B4 PREMISE — the room's rotation holds my songs by key", mine);
  await Queue.strike("@me:hs", target);
  ok(w.sent.some((e) => e.type === "ddjp.dj.strike"), "B4 PREMISE — the strike was sent");
  // B5 — a length report for the song on air: a play folded by the real reducer, a length this player measured.
  UserQueue.add(FORMS[0]); UserQueue.joinRoomQueue(); w.clock.run(); await w.flush();
  await w.bridge.sendEvent("!ev:hs", "ddjp.dj.play", { p: null });
  const np = StreamManager.getState().nowPlaying;
  ok(!!(np && np.song && KEY_RE.test(np.song.songKey)), "B5 PREMISE — the room plays a song it names by key", np);
  MediaLength.init("!ev:hs");
  MediaLength.recordLocalMeasured(np.song.songKey, 200);
  while (w.timers.length) w.timers.shift()();
  ok(w.sent.some((e) => e.type === "ddjp.media.len"), "B5 PREMISE — the length report was sent", w.sent.map((e) => e.type));
  // THE ASSERTION OVER THE WHOLE WIRE: every song every send named is a key, and every song-carrying type was sent.
  const named = songsOn(w.sent);
  const types = new Set(named.map((x) => x.type));
  ok(Object.keys(SONG_FIELDS).every((t) => types.has(t)), "B PREMISE — every song-carrying type reached the wire, so the row " +
    "below reads each of them", [...types]);
  const bare = named.filter((x) => !KEY_RE.test(String(x.v)) || !Songs.isKey(x.v));
  ok(bare.length === 0, "B — EVERY EVENT THAT CARRIES A SONG CARRIES A KEY (`yt:` + YouTube's id), whichever send named it", bare);

  // B6 — a bare id handed to every send is refused by name, and nothing goes out.
  const v = w.sb.Logger;
  const lines = [];
  try { v.on((e) => lines.push(e.message)); } catch (e) {}
  const b6 = w.sent.length;
  const r1 = await Queue.submitSong("AAAAAAAAAAA", "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  const r2 = await Queue.strike("@me:hs", "AAAAAAAAAAA");
  const r3 = await Queue.undeclare("AAAAAAAAAAA");
  const r4 = await Queue.reorder([np.song.songKey, "AAAAAAAAAAA"]);
  ok([r1, r2, r3, r4].every((r) => r && r.ok === false && r.reason === "not a song key") && w.sent.length === b6,
    "B6 — a bare id handed to the join, the strike, the undeclare or the order is REFUSED BY NAME and nothing is sent: a room " +
    "made by this build holds no bare id", { answers: [r1, r2, r3, r4], sent: w.sent.slice(b6) });
  // CHANGED ON PURPOSE (`ddjp_712`, the owner's decision 2: old rooms are not supported): MediaLength's door that refused a
  // length for a room naming its song by a bare id (one made before keys) is gone — a song this build loads is a key, and only
  // a song this device's player measured is reported. Driven: in such a room a length measured here is reported as it is.
  const w2 = world();
  w2.sb.Queue.init("!ev:hs");
  w2.bridge.l++;
  w2.sb.StreamManager.ingest({ event_id: "$old", room_id: "!r:hs", type: "m.room.message", sender: "@old:hs", senderRank: 20, ts: 500, l: w2.bridge.l,
    content: { body: JSON.stringify({ t: "ddjp.dj.join", v: "ZZZZZZZZZZZ", u: "https://www.youtube.com/watch?v=ZZZZZZZZZZZ", l: w2.bridge.l, dv: 1 }) } });
  await w2.bridge.sendEvent("!ev:hs", "ddjp.dj.play", { p: null });
  const np2 = w2.sb.StreamManager.getState().nowPlaying;
  ok(!!(np2 && np2.song && np2.song.songKey === "ZZZZZZZZZZZ"), "B6 PREMISE — the reducer stays opaque: a bare id still folds", np2);
  w2.sb.MediaLength.init("!ev:hs");
  w2.sb.MediaLength.recordLocalMeasured("ZZZZZZZZZZZ", 200);
  while (w2.timers.length) w2.timers.shift()();
  ok(w2.sent.some((e) => e.type === "ddjp.media.len"), "B6 — NO DOOR FOR A ROOM'S BARE ID ANY MORE (`ddjp_712`): a length this device " +
    "measured is reported as it is", w2.sent.map((e) => e.type));
}

// ═══ PART C — the round trip, against the old parser's own answers ═════════════════════════════════════════════════════
// THE CONTROL, VERBATIM FROM `ddjp_704`'s core/playlistdoc.js (`VIDEOID_RE`, `cleanId`, `extractVideoId`, `watchUrl`). Called by
// nothing in the app; kept so the module's answers are compared with what the app answered before keys, not with a belief.
const OLD = (() => {
  const VIDEOID_RE = /^[A-Za-z0-9_-]{11}$/;   // YouTube video id shape
  function cleanId(s) {
    if (!s) return null;
    const clean = String(s).replace(/[^A-Za-z0-9_-].*$/, "");
    return VIDEOID_RE.test(clean) ? clean : null;
  }
  function extractVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.indexOf("youtu.be") >= 0) return cleanId(u.pathname.slice(1).split("/")[0]);
      if (u.hostname.indexOf("youtube.com") >= 0) {
        const v = u.searchParams.get("v");
        if (v) return cleanId(v);
        const parts = u.pathname.split("/").filter(Boolean);
        const si = parts.indexOf("shorts"); if (si >= 0 && parts[si + 1]) return cleanId(parts[si + 1]);
        const ei = parts.indexOf("embed");  if (ei >= 0 && parts[ei + 1]) return cleanId(parts[ei + 1]);
      }
      return null;
    } catch (e) { return null; }
  }
  function watchUrl(songKey) {
    if (typeof songKey !== "string" || !songKey) return null;
    return "https://www.youtube.com/watch?v=" + songKey;
  }
  return { extractVideoId, watchUrl };
})();
function partC() {
  const { Songs } = loadInContext(["core/songs.js"], { URL });
  const REFUSED = [   // forms the old parser refused: the module must refuse them too
    "https://example.com/watch?v=AAAAAAAAAAA", "not a url", "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=AAAAAAAAAAAxx", "https://www.youtube.com/channel/AAAAAAAAAAA", "AAAAAAAAAAA",
    "https://youtu.be/", "https://www.youtube.com/v/AAAAAAAAAAA",
  ];
  let read = 0;
  for (const link of FORMS.concat(REFUSED)) {
    const old = OLD.extractVideoId(link);
    const key = Songs.fromLink(link);
    ok((old === null) === (key === null), "C — the module reads " + JSON.stringify(link) + " exactly when the old parser did", { old, key });
    if (old === null || key === null) continue;
    read++;
    ok(key === "yt:" + old, "C — link → key: " + link + " is `yt:` + the id the old parser read", { old, key });
    const p = Songs.parts(key);
    ok(!!p && p.service === "yt" && p.id === old && Songs.idOf(key) === old, "C — key → service + id gives back the old parser's id", p);
    const back = Songs.linkOf(key);
    ok(back === OLD.watchUrl(old), "C — key → link is the canonical link the app wrote before keys (the join's `u`)", { back, old: OLD.watchUrl(old) });
    ok(OLD.extractVideoId(back) === old && Songs.fromLink(back) === key, "C — link → key → link → key closes: the old parser and the " +
      "module both read the canonical link back to the same song", back);
    ok(!Songs.isKey(old) && Songs.parts(old) === null && Songs.serviceOf(old) === null && Songs.isKey(key),
      "C — the bare id the old parser read NAMES NO SERVICE: it is not a key and has no parts (J29, step 2: one form everywhere)",
      { old, parts: Songs.parts(old) });
  }
  ok(read === FORMS.length, "C PREMISE — every listed form was read by both, so the rows above compared answers", read);
  ok(Songs.fromLink("AAAAAAAAAAA") === null, "C — a bare id is not a link: My queue's box refused one before keys and still does");
  const OLD_DOORS = ["keyOf", "idFor", "sourceOf", "fromSource", "formerNameOf"].filter((n) => n in Songs);
  ok(OLD_DOORS.length === 0, "C — the module keeps no door from the old forms (a bare id, a `source`, a former name)", OLD_DOORS);
}

// ═══ PART D — local data carries over ════════════════════════════════════════════════════════════════════════════════
function idb() {
  const map = new Map();
  return { map, supported: () => true, keyFor: (scope, a, b) => ((scope && scope.room) ? "r:" + scope.room : "u") + ":" + a + ":" + b,
    get: (store, k) => Promise.resolve(map.has(store + "|" + k) ? JSON.parse(JSON.stringify(map.get(store + "|" + k))) : undefined),
    set: (store, k, v) => { map.set(store + "|" + k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); },
    del: (store, k) => { map.delete(store + "|" + k); return Promise.resolve(); },
    keys: (store) => Promise.resolve([...map.keys()].filter((k) => k.indexOf(store + "|") === 0).map((k) => k.slice(store.length + 1))),
    indexUpsertEvict: (ix, id, rec) => { const index = Object.assign({}, ix); index[id] = rec; return { index, evicted: [] }; } };
}
async function partD() {
  const I = idb();
  const said = [];
  const sb = loadInContext(["core/logger.js", "core/songs.js", "core/playlistdoc.js", "core/store.js", "features/playlists.js"],
    { IDB: I, URL, Date, UserQueue: { add: () => ({ ok: true }) } });
  const { Store, PlaylistDoc: D, Playlists, Logger } = sb;
  Logger.on((e) => said.push(String(e && e.message)));
  const CLEAR = /clear this site's data/;
  const clears = () => said.filter((m) => CLEAR.test(m));
  const KEYS_ONLY = (tracks) => tracks.every((t) => KEY_RE.test(t.songKey) && !("source" in t));
  // D1 — a playlist this device stored before keys (the id and `source`; one track with no `source`): its songs name no
  // service, so the list reads with none of them — its name and its date kept, nothing thrown, never half-read.
  const OLD_REC = { id: "pl_1", name: "Old", createdAt: 5, tracks: [
    { videoId: "AAAAAAAAAAA", source: "youtube", title: "First" }, { videoId: "BBBBBBBBBBB" }, { videoId: "CCCCCCCCCCC", source: "youtube" }] };
  await I.set("kv", "u:playlists:pl_1", OLD_REC);
  let rec = null, threw = null;
  try { rec = await Store.playlists.loadOne("pl_1"); } catch (e) { threw = String(e); }
  ok(!threw && !!rec && rec.name === "Old" && rec.createdAt === 5 && Array.isArray(rec.tracks) && rec.tracks.length === 0,
    "D1 — A PLAYLIST STORED BEFORE KEYS reads with none of its songs: each names no service, so none is shown half-read; its name " +
    "and date kept, nothing thrown", { rec, threw });
  ok(clears().length === 1, "D1 — and the log says ONCE that songs saved before keys are skipped, and to clear the site's data", said);
  // A record mixing the two forms keeps the songs named by key, in order, and only them.
  await I.set("kv", "u:playlists:pl_2", { id: "pl_2", name: "Mixed", createdAt: 6, tracks: [
    { songKey: "yt:DDDDDDDDDDD", title: "D" }, { videoId: "EEEEEEEEEEE", source: "youtube" }, { videoId: "yt:GGGGGGGGGGG" }, { songKey: "EEEEEEEEEEE" },
    { songKey: "yt:FFFFFFFFFFF" }] });
  const mixed = await Store.playlists.loadOne("pl_2");
  ok(!!mixed && JSON.stringify(mixed.tracks.map((t) => t.songKey)) === JSON.stringify(["yt:DDDDDDDDDDD", "yt:FFFFFFFFFFF"]) && mixed.tracks[0].title === "D",
    "D1 — a record mixing the forms keeps its songs named by key under `songKey`, in order, their fields kept, and drops the rest: a " +
    "bare id (704's form), a key under the old field name (`videoId`, 706's form), a bare id under the new name", mixed);
  ok(clears().length === 1, "D1 — the log line is not said again for a second old record (once a page)", clears());
  // What this build writes is the one form: the record at rest is the record in memory — keys, no `source`.
  await Store.playlists.persist(mixed);
  const atRest = (await I.get("kv", "u:playlists:pl_2")).tracks;
  ok(KEYS_ONLY(atRest) && atRest.length === 2 && JSON.stringify(atRest) === JSON.stringify(mixed.tracks),
    "D1 — ON THE DEVICE A SONG IS ITS KEY: the record is written as it is held, keys and no `source`", atRest);
  // D2 — files written before keys: their songs are skipped and counted as any invalid entry is; nothing thrown.
  // CHANGED ON PURPOSE (`ddjp_712`, decision 2): the single-playlist file is gone, so an old one is refused whole — read as
  // nothing, never as YouTube's.
  const v1 = D.validateLibrary({ ddjp: "playlist", formatVersion: 1, id: "x", name: "Mine", exportedAt: 1,
    tracks: [{ videoId: "AAAAAAAAAAA", source: "youtube", title: "A", thumb: "v1" }, { videoId: "BBBBBBBBBBB", source: "youtube", thumb: "v1" }] });
  ok(!v1.ok && v1.playlists.length === 0 && !("validateImport" in D),
    "D2 — an old single-playlist file is refused whole, none of its songs read as YouTube's (its reader is gone)", v1);
  const THUMB = "data:image/webp;base64,AAAA";
  const lib = D.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 1, exportedAt: 1,
    payload: { playlists: [{ name: "L", tracks: [{ videoId: "CCCCCCCCCCC", title: "C", thumb: THUMB }, { videoId: "DDDDDDDDDDD" }] }] } });
  ok(lib.ok && lib.counts.imported === 0 && lib.counts.skipped === 2 && lib.playlists[0].tracks.length === 0,
    "D2 — an old library file: its list arrives, its bare-id songs skipped and counted", lib.counts);
  // A FILE EXPORTED ON `ddjp_706` names each song by its key under the old field name: its songs are skipped and counted too.
  const lib706 = D.validateLibrary({ app: "ddjp", kind: "playlists", formatVersion: 1, exportedAt: 1,
    payload: { playlists: [{ name: "L6", tracks: [{ videoId: "yt:CCCCCCCCCCC", title: "C" }, { videoId: "yt:DDDDDDDDDDD" }] }] } });
  ok(lib706.ok && lib706.counts.imported === 0 && lib706.counts.skipped === 2 && lib706.playlists[0].tracks.length === 0,
    "D2 — A FILE FROM 706 (keys under the old field name): its list arrives, its songs skipped and counted, none half-read", lib706.counts);
  // IN A FILE A SONG IS ITS KEY: an export writes keys and no `source`, and imports back to the same songs.
  const mine = [{ songKey: "yt:AAAAAAAAAAA", title: "A" }, { songKey: "yt:BBBBBBBBBBB" }];
  const libOut = D.serializeLibrary([{ name: "L", tracks: mine }], {}, 1);
  ok(KEYS_ONLY(libOut.payload.playlists[0].tracks) &&
     JSON.stringify(D.validateLibrary(libOut).playlists[0].tracks.map((t) => t.songKey)) === JSON.stringify(mine.map((t) => t.songKey)),
    "D2 — a library export writes keys too, and imports back to the same songs", libOut.payload);
  const DOC_DOORS = ["trackKey", "fromStored", "toStored"].filter((n) => n in D);
  ok(DOC_DOORS.length === 0, "D2 — the document module keeps no door from the old forms", DOC_DOORS);
  // D3 — a picture and a title cached under the bare id before keys are NOT looked for under any other name: the key reads
  // nothing, and nothing is copied under it. (They re-fetch, as any song seen for the first time does.)
  await I.set("blobs", "u:img:EEEEEEEEEEE", { blob: { size: 3, b: "pic" }, size: 3 });
  await I.set("kv", "u:img:_index", { EEEEEEEEEEE: { order: 1, size: 3 } });
  await I.set("kv", "u:meta:EEEEEEEEEEE", { title: "Saved title", durationSec: 201 });
  const K = "yt:EEEEEEEEEEE";
  ok((await Store.images.has(K)) === false && (await Store.images.load(K)) === null,
    "D3 — a picture saved under a bare id is not had, nor loaded, under the key: no old-name lookup");
  const sizes = await Store.images.sizes();
  ok(!(K in sizes), "D3 — and is not counted under the key in the export's size estimate", sizes);
  ok(!(await I.get("blobs", "u:img:" + K)) && !(await I.get("kv", "u:meta:" + K)), "D3 — and nothing is copied under the key");
  ok((await Store.meta.load(K)) === null && !Store.meta.peek(K), "D3 — a title and a length cached under a bare id read as nothing under the key, the synchronous mirror too");
  // THE CONTROL: the same cache, written under the key, IS read — so the rows above read a working cache, not a broken one.
  await I.set("blobs", "u:img:" + K, { blob: { size: 4, b: "pic2" }, size: 4 });
  await I.set("kv", "u:img:_index", { EEEEEEEEEEE: { order: 1, size: 3 }, [K]: { order: 2, size: 4 } });
  await I.set("kv", "u:meta:" + K, { title: "Keyed title", durationSec: 202 });
  const blob = await Store.images.load(K), m = await Store.meta.load(K);
  ok(!!blob && blob.b === "pic2" && !!m && m.title === "Keyed title", "D3 CONTROL — written under the key, the picture and the title are read", { blob, m });
  // D4 — a bare id is REFUSED BY NAME in a playlist's add box (the supervisor's decision 9): it names no service.
  const pl = await Playlists.create("Box");
  const bare = await Playlists.addTrackByUrl(pl && pl.id, "AAAAAAAAAAA");
  ok(!!bare && bare.ok === false && bare.code === "bad-link", "D4 — A PLAYLIST'S ADD BOX REFUSES A BARE ID, by name", bare);
  const link = await Playlists.addTrackByUrl(pl && pl.id, "https://youtu.be/AAAAAAAAAAA");
  ok(!!link && link.ok === true, "D4 CONTROL — the same song as a link is taken, so the refusal is the bare id's", link);
  // D5 — My queue saved before keys: its bare-id songs skipped, a song by key kept; the log says it once; the add box
  // refuses a bare id by name; and what it writes is keys.
  const w = world();
  const qsaid = [];
  w.sb.Logger.on((e) => qsaid.push(String(e && e.message)));
  w.sb.Store.queue.persist("space9", { intent: [{ eid: "e1", videoId: "GGGGGGGGGGG", url: "u", title: "GGGGGGGGGGG" },
    { eid: "e3", videoId: "yt:JJJJJJJJJJJ", url: "u", title: "J" },
    { eid: "e2", songKey: "yt:HHHHHHHHHHH", url: "https://www.youtube.com/watch?v=HHHHHHHHHHH", title: "H" }], active: false });
  w.sb.UserQueue.init("space9");
  await w.flush(); await w.flush();
  const items = w.sb.UserQueue.items();
  ok(items.length === 1 && items[0].songKey === "yt:HHHHHHHHHHH", "D5 — A MY QUEUE LIST SAVED BEFORE keeps its songs named by key under " +
    "`songKey` and skips the rest: a bare id (704's) and a key under the old field name (706's)", items);
  ok(qsaid.filter((x) => CLEAR.test(x)).length === 1, "D5 — and the log says once to clear the site's data", qsaid);
  const qb = w.sb.UserQueue.add("AAAAAAAAAAA");
  ok(!!qb && qb.ok === false && qb.code === "bad-link", "D5 — MY QUEUE'S ADD BOX REFUSES A BARE ID, by name", qb);
  const ql = w.sb.UserQueue.add("https://youtu.be/AAAAAAAAAAA");
  ok(!!ql && ql.ok === true && ql.songKey === "yt:AAAAAAAAAAA", "D5 CONTROL — the same song as a link is taken, as its key", ql);
  await w.flush();
  const saved = await w.sb.Store.queue.load("space9");
  const list = saved && (saved.intent || []);
  ok(list.length === 2 && list.every((e) => KEY_RE.test(e.songKey) && !("source" in e)), "D5 — ON THE DEVICE My queue names each song by its key", list);
  // D6 — My queue's `{ stack }` list, the form from long before keys, is not read: the list starts empty, the log says it once,
  // nothing thrown (`ddjp_707`, JOB 4).
  {
    const w6 = world();
    const said6 = [];
    w6.sb.Logger.on((e) => said6.push(String(e && e.message)));
    w6.sb.Store.queue.persist("spaceS", { stack: [{ videoId: "yt:KKKKKKKKKKK", url: "u", title: "K" }], active: true });
    let threw6 = null;
    try { w6.sb.UserQueue.init("spaceS"); await w6.flush(); await w6.flush(); } catch (e) { threw6 = String(e); }
    ok(!threw6 && w6.sb.UserQueue.items().length === 0 && w6.sb.UserQueue.isActive() === false,
      "D6 — A MY QUEUE SAVED AS `{ stack }` IS NOT READ: empty, not active, nothing thrown", { items: w6.sb.UserQueue.items(), threw6 });
    ok(said6.filter((x) => CLEAR.test(x)).length === 1, "D6 — and the log says once to clear the site's data", said6);
  }
  // D7 — the song history table this device stored before: its rows under the old field name are skipped, counted for the
  // one log line; a row this build writes (with `songKey`, null or not) is kept.
  {
    const hsb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/history.js"], { Date });
    const H = hsb.History;
    const r = H.restore({ v: 2, rows: [{ pi: "$a", l: 1, songKey: "yt:LLLLLLLLLLL", dj: "@d:hs" }, { pi: "$b", l: 2, videoId: "yt:MMMMMMMMMMM", dj: "@d:hs" },
      { pi: "$c", l: 3, songKey: null, dj: "@d:hs" }], ranges: [[0, 3]], adds: {} });
    ok(!!r && r.ok === true && r.restored === 2 && r.skipped === 1,
      "D7 — A SONG HISTORY ROW SAVED UNDER THE OLD FIELD NAME IS SKIPPED, counted for the log; this build's rows are kept", r);
    const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    ok(/rr\.skipped > 0\) \{ try \{ Store\.noteOldSongs\("song history"\)/.test(MB),
      "D7 — and the bridge, restoring the table, says it once through the store's one log line", null);
  }
  // D8 — the stored preference that hides the player starts fresh: an old `videoHidden` is not read as `playerHidden`.
  {
    const m = {};
    const localStorage = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
    const csb = loadInContext(["core/logger.js", "core/storageio.js", "core/store.js", "core/chatprefs.js"], { localStorage });
    const keys = Object.keys(m);
    csb.ChatPrefs.setPlayerHidden(true);
    const written = Object.keys(m).filter((k) => keys.indexOf(k) < 0);
    const raw = written.length ? JSON.parse(m[written[0]]) : null;
    ok(!!raw && raw.playerHidden === true && !("videoHidden" in raw), "D8 PREMISE — the preference is stored as `playerHidden`", raw);
    for (const k of written) { const o = JSON.parse(m[k]); delete o.playerHidden; o.videoHidden = true; m[k] = JSON.stringify(o); }
    const csb2 = loadInContext(["core/logger.js", "core/storageio.js", "core/store.js", "core/chatprefs.js"], { localStorage });
    ok(csb2.ChatPrefs.playerHidden() === false, "D8 — AN OLD `videoHidden` IS NOT READ: the player starts shown (decision 7)", csb2.ChatPrefs.playerHidden());
  }
}

// ═══ PART E — a person never reads `yt:` ═══════════════════════════════════════════════════════════════════════════════
const grab = (rel, name) => { const x = P.extractNamed(rel, name); ok(x.ok, "E APPLIED — `" + name + "` is extractable from " + rel, x.stage); return x.ok ? x.source : ""; };
function node() {
  return { _t: "", attrs: {}, dataset: {}, children: [], classList: { add() {}, contains: () => false, toggle() {} }, style: {},
    get textContent() { return this._t; }, set textContent(v) { this._t = String(v); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; }, addEventListener() {} };
}
function partE() {
  const { Songs } = loadInContext(["core/songs.js"], { URL });
  const K = "yt:AAAAAAAAAAA";
  // E1 — the bot's chat line when it skips a repeat.
  {
    const sent = [];
    const scope = { Songs, Chat: { sendTo: (id, text) => { sent.push(text); } }, Room: { chatTiers: () => ({ mainId: "!main" }) } };
    const fn = new Function("scope", "with (scope) {\n" + grab("features/botruntime.js", "_announceRepeat") + "\nreturn _announceRepeat;\n}")(scope);
    fn(K, 12);
    ok(sent.length === 1 && /^Skipped AAAAAAAAAAA — /.test(sent[0]) && sent[0].indexOf("yt:") < 0,
      "E1 — the bot's \"Skipped …\" line names the song as it did before keys, never `yt:`", sent);
  }
  // E2 — the player's title before YouTube names the song.
  {
    const refs = { songTitle: node(), songTitleText: node() };
    const player = PW.boxPlayer({ getVideoData: () => ({ video_id: "AAAAAAAAAAA", title: "" }) }).bp;   // the real box player
    const scope = { Songs, refs, player, _currentSong: { songKey: K },
      _fitMarquee() {}, _pushPlayerMeta() {}, setTimeout: () => 0, SONG_META_POLL_MS: 500, SONG_META_MAX_POLLS: 10 };
    const fn = new Function("scope", "with (scope) {\n" + grab("ui/player.js", "updateSongTitle") + "\nreturn updateSongTitle;\n}")(scope);
    fn();
    ok(refs.songTitleText.textContent === "AAAAAAAAAAA", "E2 — the now-playing title reads YouTube's id until YouTube names the " +
      "song, as before keys, never `yt:`", refs.songTitleText.textContent);
  }
  // E3 — a song row's title before one is known.
  {
    const el = (tag, a, kids) => { const n = node(); n.tag = tag; if (a && a.text !== undefined) n._t = String(a.text); for (const c of (kids || [])) n.children.push(c); return n; };
    const scope = { Songs, H: { el }, MetadataService: { thumbUrl: (k) => Songs.pictureOf(k), get: () => Promise.resolve(null) },
      Store: { meta: { peek: () => null } }, _thumbBlobs: new Map(), _thumbSeen: new Set(), _thumbUrl: () => null,
      _observeThumb() {}, _previewFetch() {}, _openPreview() {}, _fmtDur: () => "", Promise };
    const fn = new Function("scope", "with (scope) {\n" + grab("ui/playlists.js", "songRow") + "\nreturn songRow;\n}")(scope);
    const row = fn(K, {});
    const find = (n) => (n.tag === "div" && n.attrs && n._t && n.children.length === 0 && n !== row) ? n : null;
    const all = []; (function walk(n) { all.push(n); for (const c of n.children || []) walk(c); })(row);
    const title = all.find((n) => n.tag === "div" && n._t === "AAAAAAAAAAA");
    ok(!!title && title.title === "AAAAAAAAAAA" && !all.some((n) => String(n._t).indexOf("yt:") >= 0),
      "E3 — a song row with no title yet reads YouTube's id, as before keys, never `yt:` (its text and its hover)", all.map((n) => n._t).filter(Boolean));
    const thumb = all.find((n) => n.tag === "img");
    ok(!!thumb && thumb.dataset.url === "https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg" && thumb.dataset.vid === K,
      "E3 — the row's picture address is built from the bare id, while the row itself is keyed by the key", thumb && thumb.dataset);
    void find;
  }
  // E4 — what the main player is handed, and what it reports back: the service's own id out, the key in. The room's REAL box
  // player (the plug and YouTube's player file) over a recording stand-in for `YT.Player`, driven by the room's own `_doLoad`.
  {
    let shown = null;
    const yt = { loadVideoById: (o) => { shown = o.videoId; }, getVideoData: () => (shown ? { video_id: shown, title: "" } : {}),
      getDuration: () => 0, setVolume() {}, mute() {}, unMute() {} };
    const { bp, w } = PW.boxPlayer(yt);
    const scope = { Songs, _wantSong: { songKey: K, startedAt: 0, elapsedAt: () => 30, pi: "$p" }, player: bp, _loadTimer: null,
      _loadsByPi: {}, _plog() {}, _loadAsk: null, setTimeout: () => 0, applyVolumeState() {}, ServerClock: undefined,
      PLAYER_LOAD_RETRY_MS: 500, VOLUME_APPLY_DELAY_MS: 1000 };
    const doLoad = new Function("scope", "with (scope) {\n" + grab("ui/player.js", "_doLoad") + "\nreturn _doLoad;\n}")(scope);
    const before = w.calls.length;
    doLoad();
    const loads = w.calls.slice(before).filter((c) => /\.loadVideoById\(/.test(c));
    ok(loads.length === 1 && loads[0] === 'yt-player.loadVideoById({"videoId":"AAAAAAAAAAA","startSeconds":30})',
      "E4 — the main player is handed YouTube's own id, never `yt:` (through the plug, into YouTube's player)", w.calls.slice(before));
    ok(bp.song() === K, "E4 — what the player reports comes back as the key", bp.song());
    const n = w.calls.length;
    ok(bp.load("AAAAAAAAAAA", 0) === false && bp.load("zz:AAAAAAAAAAA", 0) === false && w.calls.length === n,
      "E4 — a bare id or a key no player plays gives the player nothing: refused, no call made", w.calls.slice(n));
  }
  // E5 — the preview player is handed YouTube's own id too: EXECUTED by `check-preview-controls` PART D, which opens a song's
  // key in the real `_openPreview` over a YouTube double and asserts the player is constructed, and reloaded, with the bare
  // id. Not repeated here: one world for the preview, that guard's.
}

// ═══ PART F — SoundCloud's links (`ddjp_709`, J151) ═══════════════════════════════════════════════════════════════════
var PART_F_NOTE;
async function partF() {
  const { Songs } = loadInContext(["core/songs.js"], { URL });
  const K = "sc:artist-name/track-name", LINK = "https://soundcloud.com/artist-name/track-name";
  // F1 — the forms: full, `www.`, `m.`, with SoundCloud's share query (`?si=…&utm_…`) and a time (`#t=…`), and a trailing slash.
  const FORMS_SC = [LINK, "https://www.soundcloud.com/artist-name/track-name", "https://m.soundcloud.com/artist-name/track-name",
    LINK + "?si=0123456789abcdef0123456789abcdef&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing", LINK + "#t=1:23",
    "https://m.soundcloud.com/artist-name/track-name?si=abc123#t=0:42", "https://www.soundcloud.com/artist-name/track-name/"];
  const wrong = FORMS_SC.filter((f) => Songs.fromLink(f) !== K || Songs.readLink(f).key !== K).map((f) => f + " → " + Songs.fromLink(f));
  ok(wrong.length === 0, "F1 — SOUNDCLOUD'S FULL, `www.` AND `m.` LINKS, WITH `?si=` AND `#t=`, READ AS `sc:<user>/<track>` (decision 5: the " +
    "track's path, read with no lookup)", wrong);
  const p = Songs.parts(K);
  ok(!!p && p.service === "sc" && p.id === "artist-name/track-name" && Songs.serviceOf(K) === "sc" && Songs.idOf(K) === "artist-name/track-name" && Songs.isKey(K),
    "F1 — key → service + id: `sc` and the path", p);
  ok(Songs.linkOf(K) === LINK && Songs.fromLink(Songs.linkOf(K)) === K, "F1 — key → link → key closes: the link is `https://soundcloud.com/<id>`", Songs.linkOf(K));
  ok(Songs.pictureOf(K) === null, "F1 — a SoundCloud song has no picture address: the page draws its own light ♪ box (decision 2)", Songs.pictureOf(K));
  const t = Songs.titleLookupOf(K);
  ok(t === "https://soundcloud.com/oembed?format=js&url=" + encodeURIComponent(LINK),
    "F1 — its title is SoundCloud's oEmbed in its JSONP form (`format=js`; the caller adds its callback), on the track's link", t);
  ok(Songs.fromLink("http://soundcloud.com/artist-name/track-name") === K, "F1 — and a plain `http:` link reads the same", Songs.fromLink("http://soundcloud.com/artist-name/track-name"));
  // F2 — refused by name, with the words on screen (decision 3).
  const SHORT_W = "Short SoundCloud links can't be read \u2014 open it and copy the full link";
  const SET_W = "That's a SoundCloud playlist, not a song", LONG_W = "This link is too long to play", NOT = "not a song link";
  const u30 = "a".repeat(30), t30 = "b".repeat(30), t31 = "b".repeat(31);
  const REFUSED_SC = [
    ["a short link", "https://on.soundcloud.com/AbCdEf123", "short-link", SHORT_W],
    ["a short link with a query", "https://on.soundcloud.com/AbCdEf123?si=x", "short-link", SHORT_W],
    ["a set", "https://soundcloud.com/artist-name/sets/my-playlist", "playlist-link", SET_W],
    ["a set, shared from the phone", "https://m.soundcloud.com/artist-name/sets/my-playlist?si=abc&utm_source=clipboard", "playlist-link", SET_W],
    ["a user's page", "https://soundcloud.com/artist-name", "bad-link", NOT],
    ["a user's likes", "https://soundcloud.com/artist-name/likes", "bad-link", NOT],
    ["a user's tracks", "https://soundcloud.com/artist-name/tracks", "bad-link", NOT],
    ["SoundCloud's own page", "https://soundcloud.com/discover", "bad-link", NOT],
    ["your own likes", "https://soundcloud.com/you/likes", "bad-link", NOT],
    ["a search", "https://soundcloud.com/search/sounds?q=x", "bad-link", NOT],
    ["a private track's secret path (three parts)", "https://soundcloud.com/artist-name/track-name/s-AbCdE", "bad-link", NOT],
    ["an over-long key (65 characters)", "https://soundcloud.com/" + u30 + "/" + t31, "too-long", LONG_W],
  ];
  const badR = REFUSED_SC.filter(([, link, code, words]) => { const r = Songs.readLink(link); return r.key !== null || r.code !== code || r.reason !== words || Songs.fromLink(link) !== null; })
    .map(([what, link]) => what + " → " + JSON.stringify(Songs.readLink(link)));
  ok(badR.length === 0, "F2 — REFUSED BY NAME, WITH THE WORDS ON SCREEN (decision 3): a short link — \"" + SHORT_W + "\"; a set — \"" + SET_W +
    "\"; an over-long key — \"" + LONG_W + "\"; a user's page and SoundCloud's own pages are not songs", badR);
  ok(Songs.fromLink("https://soundcloud.com/" + u30 + "/" + t30) === "sc:" + u30 + "/" + t30 && ("sc:" + u30 + "/" + t30).length === 64,
    "F2 CONTROL — a key of exactly 64 characters is read: the limit is the room's, unchanged", ("sc:" + u30 + "/" + t30).length);
  ok(Songs.key("sc", u30 + "/" + t31) === null && Songs.parts("sc:" + u30 + "/" + t31) === null, "F2 — and an over-long key is no key at all, so no event could carry it");
  ok(Songs.readLink("https://www.youtube.com/watch?v=AAAAAAAAAAA").key === "yt:AAAAAAAAAAA" && Songs.readLink("https://example.com/x").reason === NOT,
    "F2 CONTROL — YouTube's links read as before, and a link of no service says it is not a song link", Songs.readLink("https://example.com/x"));
  // F3 — the longest key is the reducer's.
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const lim = sd.StateDeriver && sd.StateDeriver.eventLimits ? sd.StateDeriver.eventLimits().songIdMaxLength : null;
  ok(typeof lim === "number" && Songs.KEY_MAX === lim, "F3 — THE LONGEST KEY IS THE ROOM'S: `Songs.KEY_MAX` equals the reducer's `songIdMaxLength`", { KEY_MAX: Songs.KEY_MAX, songIdMaxLength: lim });
  // F4 — the words reach both add boxes: My queue's (`UserQueue.add`) and a playlist's (`Playlists.addTrackByUrl`), which the
  // screen shows as "Couldn't add: " + the reason.
  const qw = world();   // PART B's world: the REAL My queue, store and stream over a recording room
  qw.sb.UserQueue.init("spaceF");
  await qw.flush(); await qw.flush();
  const box = (link) => { try { return qw.sb.UserQueue.add(link); } catch (e) { return { threw: String(e && e.message) }; } };
  const uqBad = REFUSED_SC.filter(([, link, code, words]) => { const r = box(link); return !r || r.ok !== false || r.code !== code || r.reason !== words; })
    .map(([what, link]) => what + " → " + JSON.stringify(box(link)));
  ok(uqBad.length === 0, "F4 — MY QUEUE'S ADD BOX REFUSES EACH, by name, with those words", uqBad);
  const okAdd = box(LINK + "?si=abc");
  ok(!!okAdd && okAdd.ok === true && okAdd.songKey === K, "F4 CONTROL — and takes a full SoundCloud link, as its key", okAdd);
  const plSrc = fs.readFileSync(path.join(ROOT, "features/playlists.js"), "utf8");
  const at = plSrc.indexOf("  async function addTrackByUrl(id, url) {");
  const end = at >= 0 ? plSrc.indexOf("\n  }\n", at) : -1;
  ok(at >= 0 && end > at, "F4 PREMISE — a playlist's add (`addTrackByUrl`) is found in features/playlists.js");
  if (at >= 0 && end > at) {
    const scope = { Songs, addTrack: (id, tr) => Promise.resolve({ ok: true, tr }), Logger: { info() {}, warn() {}, debug() {}, error() {} } };
    const addTrackByUrl = new Function("scope", "with (scope) {\n" + plSrc.slice(at, end + 4) + "\nreturn addTrackByUrl;\n}")(scope);
    const plBad = [];
    for (const [what, link, code, words] of REFUSED_SC) {
      let r; try { r = await addTrackByUrl("pl1", link); } catch (e) { r = { threw: String(e && e.message) }; }
      if (!r || r.ok !== false || r.code !== code || r.reason !== words) plBad.push(what + " → " + JSON.stringify(r));
    }
    ok(plBad.length === 0, "F4 — A PLAYLIST'S ADD BOX REFUSES EACH, by name, with those words", plBad);
  }
  PART_F_NOTE = "SoundCloud's " + FORMS_SC.length + " link forms read as `sc:<user>/<track>` and back; " + REFUSED_SC.length + " refusals by name, with the " +
    "statement's words, in the module and both add boxes; the longest key the reducer's " + lim;
}

(async () => {
  try { await partB(); } catch (e) { ok(false, "B threw — " + (e && e.stack || e)); }
  try { partC(); } catch (e) { ok(false, "C threw — " + (e && e.stack || e)); }
  try { await partD(); } catch (e) { ok(false, "D threw — " + (e && e.stack || e)); }
  try { partE(); } catch (e) { ok(false, "E threw — " + (e && e.stack || e)); }
  try { await partF(); } catch (e) { ok(false, "F threw — " + (e && e.stack || e)); }
  // THE GATE, BELOW EVERY PART IN TIME (the thirty-ninth signature).
  if (failed) { console.log("[song-services] " + failed + " failure(s)"); process.exit(1); }
  console.log("[song-services] PASS — a song is named by its service (" + asserts + " assertions): A nothing outside `core/songs.js` " +
    "spells a service's id rule, link hosts or picture host — read as the language reads it, its control finding every spelling " +
    "in the module itself (" + (PART_A_NOTE || "") + "; chat's three link tables cut out by their declarations); B every song the " +
    "real queue, My queue and the length report put on the wire is a key, and a bare id at any send is refused by name; C every " +
    "link form the old parser read gives the old parser's id, through the key and back, and a bare id names no service; D ONE FORM " +
    "EVERYWHERE — a song is its key in memory, on the device and in a file, no `source` written; a playlist record, old files, a " +
    "picture and a title cached under a bare id, and a saved My queue from before keys are skipped, never half-read, nothing " +
    "thrown, the log saying once to clear the site's data — 706's keys under the old field name, My queue's `{ stack }` and a history " +
    "row under the old name too, and the old hide-the-player preference starts fresh; a bare id refused by name in both add boxes; " +
    "E the bot's line, the " +
    "player's title, a song row and the main player (the real plug over a stand-in YouTube) read the service's own id, never `yt:`; " +
    "F " + (PART_F_NOTE || "") + "");
})();
