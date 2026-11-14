// core/songs.js — Songs: the song services, and every song named by its service
//
// THE OWNER'S RULE: a song is named by its provider and its id (`main/01-project.md` §His priorities), and his goal for the
// provider item, his words: "allright the goal is the app the app as if we supported many providers by default and not make it
// hard to add more later". This file is the one home of everything a song service is: its id rule, the link forms it reads, its
// canonical link, its picture, its title lookup, the hosts the page must let its player reach, and its player's file. It holds
// one row per service — YouTube's, and SoundCloud's since `ddjp_709` (the owner's "well lets do soundcloud") — and nothing
// outside a row and its player file names its service.
//
// ── ADDING A SERVICE IS FOUR THINGS (`main/01-project.md` item 3) ────────────────────────────────────────────────────────
// Its ROW here; its PLAYER FILE, following the plug (`ui/songplayer.js`), which the row names; its HOSTS in the page's allowed
// hosts (`index.html`'s `script-src` and `frame-src`), which the row names; and its LINE in the page, after the plug's.
// `check-player-plug` fails when one is forgotten: a host missing or left over, a row with no player, a line missing or out of
// order, a service named anywhere else.
//
// ── A SONG'S NAME IS ONE STRING, ITS KEY — ITS ONLY FORM, EVERYWHERE ────────────────────────────────────────────────────
// The service's short name, a colon, and the service's own id: `yt:` + an 11-character YouTube id, `sc:` + a SoundCloud
// track's path. One string rather than two fields, so every place that compares songs (the reducer's buffers, the counts,
// song history, the bot's notes) still compares one string, and the reducer stays blind to what the string means
// (`StateDeriver.songOf` checks type and length only). A KEY IS AT MOST `KEY_MAX` LONG, the reducer's own limit
// (`songIdMaxLength`, 64; `check-song-services` holds the two equal): a longer one is no key, and a link that would make one is
// refused by name ("This link is too long to play"). The key is the form in memory, on the wire, on the device and in files —
// there is no other (the owner's, `ddjp_706`: nothing saved before keys is carried over). A bare id names no service.
//
// THE FIELDS. In the app a song's key travels in `songKey` and its link in `songLink` — named so at J29's step 3
// (`ddjp_707`; before, `videoId` and `videoUrl`, which held the key since step 1). On the wire the short `v`, `u` and `o` stay.
//
// ── WHAT ASKS HERE ────────────────────────────────────────────────────────────────────────────────────────────────────────
//   · a link becomes a key here (`fromLink`), or a refusal with its reason (`readLink`) — My queue's and a playlist's add
//     boxes; a bare id is not a link;
//   · a key becomes its service and id here (`parts`, `idOf`) — the players' plug, which hands each service's player its own
//     id (`ui/songplayer.js`), the title lookup and the picture (`features/metadata.js`);
//   · a key becomes its link, picture and title lookup here (`linkOf`, `pictureOf`, `titleLookupOf`) — the join's `u`, the
//     vouch record's rebuilt `u`, a playlist song handed to My queue;
//   · a key becomes what a person reads here (`shownAs`): the service's own id, so nobody ever sees the key;
//   · the table becomes plain data here (`services`) — the page lists each row's player file by it, the room surface records
//     the form of a song's name from it, and `check-player-plug` checks the page's hosts against it.
// `check-song-services` and `check-player-plug` hold the rest of the tree to it: no other file spells a service's id rule,
// link hosts, picture host or player hosts, except the service's own player file.
//
// Pure: no dependencies, no I/O, no clock; the same input gives the same output, and nothing here throws.

const Songs = (() => {
  "use strict";

  const SEP = ":";

  // ── THE SERVICES ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  //   short       the key's prefix, on every event that names a song
  //   idRule      what the service's own id looks like; a key's id must pass it
  //   example     an id the rule accepts, for the guards and the room surface — never a song anything plays
  //   reads(u)    a parsed URL to the id it names, or null: the link forms the service reads
  //   link(id)    the canonical link: the inverse of `reads` for a valid id
  //   picture(id) the picture's address, keyless — or null for a service with none, whose songs the page draws its own
  //               placeholder for (the sheet's `.thumb-slot[data-service=…]`)
  //   title(id)   the address of a keyless title lookup (oEmbed); the caller adds its own callback
  //   refuses(u)  optional: a parsed URL on the service's own hosts that is not a song it can read → { code, reason }, the
  //               words a person reads (`readLink`)
  //   hosts       what the page must let its player reach: `frame` (the player's own frames) and `script` (its scripts and
  //               its title lookup) — exactly these, with the app's own, are `index.html`'s `frame-src` and `script-src`
  //   player      its player's file, following the plug (`ui/songplayer.js`), which loads it
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  function _ytClean(s) {
    // Trims at the first character no id can hold (copy-paste junk), then requires the whole rule.
    if (!s) return null;
    const clean = String(s).replace(/[^A-Za-z0-9_-].*$/, "");
    return YT_ID.test(clean) ? clean : null;
  }
  function _ytLink(id) { return "https://www.youtube.com/watch?v=" + id; }
  const SC_PART = /^[a-z0-9_-]+$/;
  const SC_ID = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;
  const SC_HOSTS = ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"];
  // SoundCloud's own pages, which a two-part path can name and which are no track: a first part that is not a user, and a
  // second that is one of a user's pages rather than a track.
  const SC_PAGES = ["you", "discover", "search", "stream", "upload", "charts", "settings", "messages", "notifications", "pages",
    "jobs", "terms-of-use", "pro", "people", "tags", "groups", "popular", "feed", "home", "signin", "signup", "logout", "mobile"];
  const SC_USER_PAGES = ["sets", "tracks", "albums", "likes", "reposts", "followers", "following", "comments", "popular-tracks",
    "spotlight", "playlists", "toptracks"];
  function _scLink(id) { return "https://soundcloud.com/" + id; }
  const SERVICES = [
    {
      short: "yt",
      idRule: YT_ID,
      example: "AAAAAAAAAAA",
      // The forms My queue and a playlist read: watch?v=, youtu.be/, /shorts/ and /embed/. The host test is a substring, as
      // it always was (`check-song-services` PART C holds every form against the parser's answers before keys).
      reads: function (u) {
        if (u.hostname.indexOf("youtu.be") >= 0) return _ytClean(u.pathname.slice(1).split("/")[0]);
        if (u.hostname.indexOf("youtube.com") >= 0) {
          const v = u.searchParams.get("v");
          if (v) return _ytClean(v);
          const parts = u.pathname.split("/").filter(Boolean);
          const si = parts.indexOf("shorts"); if (si >= 0 && parts[si + 1]) return _ytClean(parts[si + 1]);
          const ei = parts.indexOf("embed");  if (ei >= 0 && parts[ei + 1]) return _ytClean(parts[ei + 1]);
        }
        return null;
      },
      link: _ytLink,
      // "hqdefault" exists for effectively every video (unlike maxres), so it is the safe source to downscale from.
      picture: function (id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; },
      title: function (id) { return "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(_ytLink(id)); },
      hosts: { frame: ["https://www.youtube.com", "https://www.youtube-nocookie.com"], script: ["https://www.youtube.com", "https://s.ytimg.com"] },
      player: "ui/youtube.js",
    },
    // SOUNDCLOUD (`ddjp_709`, the owner's "well lets do soundcloud"; the supervisor's decisions 2, 3 and 5). ITS ID IS THE
    // TRACK'S PATH, `<user>/<track>`, read straight from the link with no lookup — the widget plays a track by its link, so no
    // numeric id is needed, and a pasted link names its path (the numeric id or URN would need SoundCloud's data service, which
    // wants a secret a browser app cannot keep). Full links only: a short link names no path, and a set is many songs.
    {
      short: "sc",
      idRule: SC_ID,
      example: "artist-name/track-name",
      // `soundcloud.com`, `www.` and `m.` links whose path is exactly two parts of the id's characters, the query and the
      // fragment ignored (`?si=…`, `#t=…`); a path whose part is one of SoundCloud's own pages is no track.
      reads: function (u) {
        if (SC_HOSTS.indexOf(u.hostname) < 0) return null;
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || SC_PAGES.indexOf(parts[0]) >= 0 || SC_USER_PAGES.indexOf(parts[1]) >= 0) return null;
        return SC_PART.test(parts[0]) && SC_PART.test(parts[1]) ? parts[0] + "/" + parts[1] : null;
      },
      link: _scLink,
      picture: function () { return null; },   // none: the page draws its own light ♪ box (the owner's words, decision 2)
      title: function (id) { return "https://soundcloud.com/oembed?format=js&url=" + encodeURIComponent(_scLink(id)); },
      refuses: function (u) {
        if (u.hostname === "on.soundcloud.com") return { code: "short-link", reason: "Short SoundCloud links can't be read \u2014 open it and copy the full link" };
        if (SC_HOSTS.indexOf(u.hostname) >= 0 && u.pathname.split("/").filter(Boolean)[1] === "sets") return { code: "playlist-link", reason: "That's a SoundCloud playlist, not a song" };
        return null;
      },
      hosts: { frame: ["https://w.soundcloud.com"], script: ["https://w.soundcloud.com", "https://soundcloud.com"] },
      player: "ui/soundcloud.js",
    },
  ];
  const _byShort = Object.create(null);
  for (const s of SERVICES) _byShort[s.short] = s;

  // THE LONGEST KEY: the reducer's `songIdMaxLength` (`backends/backend1/statederiver.js`), which this pure module cannot read;
  // `check-song-services` holds the two equal. A key longer than this is no key, so no event could carry it.
  const KEY_MAX = 64;
  function _validId(svc, id) { return !!svc && typeof id === "string" && svc.idRule.test(id) && (svc.short + SEP + id).length <= KEY_MAX; }

  // ── KEYS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A key from a service's short name and its own id, or null when either is wrong.
  function key(short, id) {
    const svc = (typeof short === "string") ? _byShort[short] : null;
    return _validId(svc, id) ? svc.short + SEP + id : null;
  }
  // { service, id } for a key, or null for anything that is not one.
  function parts(k) {
    if (typeof k !== "string") return null;
    const i = k.indexOf(SEP);
    if (i <= 0) return null;
    const svc = _byShort[k.slice(0, i)];
    const id = k.slice(i + 1);
    return _validId(svc, id) ? { service: svc.short, id: id } : null;
  }
  function isKey(k) { return parts(k) !== null; }
  function idOf(k) { const p = parts(k); return p ? p.id : null; }
  function serviceOf(k) { const p = parts(k); return p ? p.service : null; }

  // ── FROM WHAT A PERSON PASTES ────────────────────────────────────────────────────────────────────────────────────────────
  // `readLink`: { key } for a link of any service, or { key: null, code, reason } — the words both add boxes show. A link a
  // service names as not a song it can read gives that service's words (a short link, a set); a link whose key would pass the
  // room's limit, "This link is too long to play"; anything else, a bare id among them, "not a song link".
  const NOT_A_SONG = { code: "bad-link", reason: "not a song link" };
  function readLink(text) {
    let u;
    try { u = new URL(String(text)); } catch (e) { return { key: null, code: NOT_A_SONG.code, reason: NOT_A_SONG.reason }; }
    for (const s of SERVICES) {
      let id = null;
      try { id = s.reads(u); } catch (e) { id = null; }
      if (!id) continue;
      const k = key(s.short, id);
      if (k) return { key: k };
      if (typeof id === "string" && s.idRule.test(id)) return { key: null, code: "too-long", reason: "This link is too long to play" };
    }
    for (const s of SERVICES) {
      let r = null;
      try { r = typeof s.refuses === "function" ? s.refuses(u) : null; } catch (e) { r = null; }
      if (r && r.code && r.reason) return { key: null, code: r.code, reason: r.reason };
    }
    return { key: null, code: NOT_A_SONG.code, reason: NOT_A_SONG.reason };
  }
  // A link of any service's key, or null. A bare id is not a link, and names no service: both add boxes refuse one.
  function fromLink(text) { return readLink(text).key; }

  // ── TO WHAT A SERVICE NEEDS ──────────────────────────────────────────────────────────────────────────────────────────────
  function _with(k, f) { const p = parts(k); return p ? _byShort[p.service][f](p.id) : null; }
  function linkOf(k) { return _with(k, "link"); }
  function pictureOf(k) { return _with(k, "picture"); }
  function titleLookupOf(k) { return _with(k, "title"); }

  // What a person reads for a song whose title is not known yet: the service's own id, exactly what was shown before
  // keys. Anything that is not a key reads as nothing (`ddjp_712`, the owner's: old rooms and versions are not supported —
  // the bare id of a room made before keys was shown as it was until then).
  function shownAs(k) {
    const p = parts(k);
    return p ? p.id : "";
  }

  // The table as plain data — what the plug loads players from, the room surface records and the guards read. Copies.
  function services() {
    return SERVICES.map((s) => ({ short: s.short, idRule: String(s.idRule), example: s.example,
      hosts: { frame: s.hosts.frame.slice(), script: s.hosts.script.slice() }, player: s.player }));
  }

  return {
    SEP, KEY_MAX, services,
    key, parts, isKey, idOf, serviceOf,
    fromLink, readLink,
    linkOf, pictureOf, titleLookupOf, shownAs,
  };
})();
