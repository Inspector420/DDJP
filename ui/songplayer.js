// ui/songplayer.js — SongPlayer: the plug every song service's player follows (J29, step 2)
//
// THE OWNER'S GOAL, his words: "allright the goal is the app the app as if we supported many providers by default and not make
// it hard to add more later" (`main/01-project.md` item 3). So nothing that plays a song knows which service plays it. A screen
// gives the plug a BOX; the plug makes, in that box, the player of each service that can play there; and a song is loaded into
// the box by its KEY (`core/songs.js`: the service's short name, a colon, the service's own id). The key says which service's
// player plays it, and that player is handed the service's own id. Everything the screen reads back — which song is showing,
// the time, the length, the state, the volume — comes back the same way for every service, and a song always as a key.
// EACH BOX SWITCHES BY ITSELF, the owner's words (`ddjp_709`): "we do want the room player and the preview song playyer to
// independently switch rightly tot he right one depending on whats playing" — a box keeps its own players and its own showing
// one, and acts on nothing outside it, so the room's player and a preview each follow their own song's service.
// ONLY THE PLAYER A BOX SHOWS MAY MAKE SOUND (`ddjp_710`; the owner found SoundCloud playing with no player showing it): a
// player the box steps aside is paused and its sound held at 0, whatever its service — the check below, since `ddjp_714`.
//
// ── THE CHECK: EVERY PLAYER KEPT TO WHAT THE ROOM SAYS, ALWAYS (`ddjp_714`) ─────────────────────────────────────────────
// The owner's words: "ok just make sure we handle what its doing always like we mute it when needed, we unmute when needed
// and we also send the right songs at right time always". ONE function, `check(want, act)`, for every player of every service
// in a box. WHAT IT SHOULD BE is the screen's to say, from the room and this device alone (`want`): the room's song by its key
// (or null), the room's point (a function, asked when the check runs), whether the song is held (its end reached), whether
// a preview holds the room's player (`aside`), and the length the player measured; this device's volume and mute are the
// box's own (set through `setVolume`/`mute`/`unmute`). WHAT IT IS comes from each player's own readings — its file's
// (YouTube's are its calls; SoundCloud's are its widget's getters, into its copy). Where they differ:
//   the wrong song, or none            → the screen's own load (`act.load(key, why)`), at the room's point;
//   not shown, or held                 → paused, and its sound 0 (`mute()`);
//   shown, not held, paused by itself  → play; and "cued" — its song up and not started (SoundCloud's widget whose `auto_play`
//                                        was held back, `ddjp_715`) — play, at the room's point where there is one;
//   the wrong volume                   → this device's; a volume or mute changed INSIDE a shown player's own frame is the
//                                        person's choice and becomes this device's (`act.chose(level, muted)`, as YouTube's
//                                        two-way volume always did); while a player is not shown its sound is held at 0;
//   more than 10 s from the room's point → a seek, never during the hold, never past the player's length less 1 s.
// WHAT THE BOX ITSELF ASKED IS NOT WRONG: a player the box loaded, paused, stopped, stepped aside or gave this device's volume
// is expected to read so (`exp`). Stepping aside or holding mutes it, and coming back unmutes it to this device's volume,
// quietly. Only a reading that differs from what the box last asked is a correction, and each logs ONE line,
// `Player: corrected <service> — <what was wrong>` — said once until the check finds it right again. Nothing is logged when all
// is right. It runs when the screen asks (the room: every push, and every 2 s) and on every event of a player in a box that
// has been given a `want` (ready, a state, a failure); a box never given one — a preview's — runs it only for a player it does
// not show that says it plays (the not-shown rule alone). Its play and its seek are not repeated within RETRY_MS (a player
// whose readings come later, or a browser that holds a play back); a pause and a mute are, every time. A LOAD IS THE BOX'S
// FIRST ASK TO PLAY (`ddjp_715`): a "cued" player's start comes RETRY_MS after it at the soonest, so a player that starts by
// itself is never pushed. A LOAD NOT YET PLAYED reads what the player does by itself — YouTube mutes itself to start a video the
// browser will not let sound, and its readings lag the box's own unmute — so a volume or mute read then is never the person's
// choice (`ddjp_715`; seen at `?v=631`: "volume from yt — 100, muted" 30 ms after a load).
//
// ── THE SHAPE A SERVICE'S PLAYER FOLLOWS ─────────────────────────────────────────────────────────────────────────────────
// A service's player file (the one its row in `core/songs.js` names) registers itself here, under its short name:
//   SongPlayer.register(short, { available(), make(box, opts, on) })
//     available()            its service's own script is up, so a player can be made now
//     make(box, opts, on)    makes its player inside `box` — its OWN element, which the box holds; the box is the screen's
//       opts.id              the service's own id to open on, or null for an empty player
//       opts.startMuted      start silent (a browser lets a muted player start by itself)
//       opts.preview         a short look at one song: fills its box, plays inline, suggests nothing after it
//       on.ready()           it can take calls now
//       on.state(word)       "unstarted" | "buffering" | "playing" | "paused" | "ended" | "cued" — the plug's own words
//       on.failed(reason, detail)  it cannot play the song: the APP'S reason (`StateDeriver`'s blocked-reason tokens), or null
//                            when its service's error has no meaning the app knows — never the service's own code, which may
//                            ride in `detail`, a few words for the log only
//   and returns a HANDLE:
//     load(id, startSec) · play() · pause() · seek(sec) · stop() · setVolume(0–100) · mute() · unmute() · show(on) · destroy()
//     ready() · id() — the service's own id of what it shows, or null · title() · time() · length() (seconds)
//     · state() — one of the words above · volume() · muted() — what the PLAYER reads, a change made inside its frame included
//     · shown() — optional: false while a player made empty keeps itself hidden until its first song (`ddjp_709`)
//     · release() — optional: a player that keeps an element the page would otherwise hold lets it go (SoundCloud's frame,
//       on leaving the room, `ddjp_714`); without it, the box's `release()` only stops it
//
// ── READINGS ARE SYNCHRONOUS, FROM A FRESH COPY (the supervisor's decision 3) ─────────────────────────────────────────────
// A caller reads `time()` or `length()` the way it always read the player, and never waits. HOW FRESH is the service file's
// to keep: YouTube's player answers each reading with the call it always made, so its copy is the player itself, as fresh as
// it was (`ui/youtube.js`). A service that can only answer through callbacks keeps a copy its events and a short poll update,
// and answers from it — at most one event or one poll old. Times are seconds here whatever the service counts in.
//
// ── THE BOX PLAYER ────────────────────────────────────────────────────────────────────────────────────────────────────────
// `make(box, opts, on)` returns what a screen holds. Given `opts.song` (a key), it makes that song's service's player alone
// and opens on it (the preview). Given none, it makes every registered service's player, empty (the room's): which service the
// room plays next is not known yet, and none is the default. Then:
//   plays(key)        a registered service plays this key
//   load(key, sec)    hands the key's id to its service's player, which becomes the one SHOWING; false when none plays it.
//                     The others step aside (stopped, hidden, muted); the one that shows takes this device's volume.
//   play() pause() seek() stop()   the showing player — or, before anything was loaded, every player made
//   setVolume() mute() unmute()    THIS DEVICE'S volume (`ddjp_714`): the box keeps it, and gives it to every player it
//                     shows that is not held; a player stepped aside or held keeps 0 until it comes back
//   check(want, act)  the check above · chosenVolume() a volume changed inside the shown player's frame, as {level, muted},
//                     or null (the room's 400 ms volume poll; nothing is set) · release() leaving: every player stopped, and
//                     one that keeps an element lets it go
//   song()            the key of what is showing, or null · title() time() length() state() volume() muted()
//   reading()         { songKey: key, seconds } for Playback's length provider, or null WHOLESALE when no key names what
//                     the player shows — a reading never carries a falsy id (`check-duration-provider`)
//   ready(key?)       the player that would play `key` (or the showing one; before a load, every one) can take calls
// Its events name the box player and the service: on.ready(bp, short), on.state(word, bp, short),
// on.failed(reason, bp, short, detail).
//
// ── THE PAGE LISTS EACH SERVICE'S PLAYER FILE ────────────────────────────────────────────────────────────────────────────
// `index.html` loads `core/songs.js`, this file and then, one plain line each, the player file every row of the table names,
// in the table's order, at the top of its body where the page always asked for YouTube's script (J29 step 3, `ddjp_707`: a
// plain line in place of the `document.write` this file did at step 2). Adding a service is four things — its row, its player
// file, its hosts and its line in the page — and `check-player-plug` holds them together. A player file registers itself
// here as it runs, and loads its own service's script.
//
// Nothing here names a service, its script, its states, its codes or its calls: that is each service's player file, and
// `check-player-plug` holds the shape against YouTube's player and SoundCloud's (`ui/soundcloud.js`, over a stand-in widget).
//
// Depends on: Songs (loaded just before this file; read at call time), Logger (at call time)

const SongPlayer = (() => {
  "use strict";
  const _impl = Object.create(null);   // short -> { available, make }
  const _order = [];                   // registration order: the order the players are made in a box
  const WORDS = ["unstarted", "buffering", "playing", "paused", "ended", "cued"];

  function register(short, impl) {
    if (typeof short !== "string" || !short || !impl || typeof impl.make !== "function") return false;
    if (!_impl[short]) _order.push(short);
    _impl[short] = impl;
    return true;
  }
  function registered() { return _order.slice(); }
  function _partsOf(key) { try { return (typeof Songs !== "undefined" && Songs.parts) ? Songs.parts(key) : null; } catch (e) { return null; } }
  // A service's player can play this key, and its script is up.
  function plays(key) {
    const p = _partsOf(key);
    return !!(p && _impl[p.service]);
  }
  function available(key) {
    const p = _partsOf(key);
    const impl = p ? _impl[p.service] : null;
    try { return !!(impl && (typeof impl.available !== "function" || impl.available())); } catch (e) { return false; }
  }

  // THE CHECK'S TWO WAITS (`ddjp_714`): a load asked counts as the right song until the player shows it, or for LOAD_WAIT_MS; a
  // play or a seek the check gave is not given again within RETRY_MS (a pause and a mute always are).
  const LOAD_WAIT_MS = 30000;
  const RETRY_MS = 4000;
  const DRIFT_S = 10;                    // the room's point and the player's, further apart than this: a seek

  function make(box, opts, on) {
    const o = opts || {}, cb = on || {};
    const handles = Object.create(null);   // short -> handle
    let showing = null;                    // the service whose player shows the song now; null before any load
    const bp = {};
    // THIS DEVICE'S VOLUME, the box's own (`ddjp_714`): what `setVolume`/`mute`/`unmute` say, given to every player the box
    // shows and does not hold. And what the box last asked of each player (`exp`): whether it should be playing, its volume and
    // mute — so a reading that differs from it is the player's own doing (or the person's, inside its frame), never the box's.
    const dev = { level: null, muted: !!o.startMuted };
    const exp = Object.create(null);       // short -> { play: true|false|null, level: number|null, muted: boolean }
    const held0 = Object.create(null);     // short -> true while the box holds its sound at 0 (stepped aside, or held)
    const pending = Object.create(null);   // short -> { id, at } the load asked, until the player shows it
    const said = Object.create(null);      // "<short>:<kind>" -> already logged, until the check finds it right
    const gave = Object.create(null);      // "<short>:<kind>" -> when the check last gave a play or a seek
    const loaded = Object.create(null);    // short -> { at, played } the box's last load, for the seek's line (`ddjp_627`'s trail)
    let last = null, lastAct = null;       // the latest `want` and `act` the screen gave (null: never — a preview's box)
    function _exp(s) { return exp[s] || (exp[s] = { play: null, level: null, muted: !!o.startMuted }); }
    function _made() { return _order.filter((s) => !!handles[s]); }
    function _make(short, id) {
      const impl = _impl[short];
      if (!impl) return null;
      if (handles[short]) return handles[short];
      // THE BOX HEARS ONLY THE PLAYER IT SHOWS (`ddjp_709`): a player stepped aside — stopped and hidden as the box switched —
      // may still report (its stop, a late end, an error), and that must never end or block the song another player shows.
      // Before anything shows, every player is heard (one service: as it always was); ready is always heard.
      const heard = () => showing === null || showing === short;
      // Every event runs the check after it is heard (a box given a `want`), and a player not shown that says it plays runs
      // it whatever the box (the not-shown rule — the safety net `ddjp_710` added, folded in here at `ddjp_714`).
      // A player's own word counts as its reading for that check: a reading may lag the event that brought it.
      const after = (w) => { if (last || (!heard() && (w === "playing" || w === "buffering"))) bp.check(undefined, undefined, { short, word: w }); };
      _exp(short);
      const h = impl.make(box, { id: id || null, startMuted: !!o.startMuted, preview: !!o.preview }, {
        ready: () => { if (typeof cb.ready === "function") cb.ready(bp, short); if (last) bp.check(); },
        state: (w) => {
          if (w === "playing" && loaded[short]) loaded[short].played = true;
          if (heard() && typeof cb.state === "function") cb.state(WORDS.indexOf(w) >= 0 ? w : null, bp, short);
          after(w);
        },
        failed: (reason, detail) => {
          if (heard() && typeof cb.failed === "function") cb.failed(typeof reason === "string" && reason ? reason : null, bp, short, typeof detail === "string" ? detail : null);
          if (last) bp.check();
        },
      });
      if (h) handles[short] = h;
      return h || null;
    }
    // Shown: the one the box shows — or, before anything was loaded, every player that shows itself (YouTube's empty player;
    // not SoundCloud's, which keeps itself hidden until its first song).
    function _shown(s) {
      if (showing !== null) return showing === s;
      const h = handles[s];
      try { return !!h && (typeof h.shown !== "function" || h.shown()); } catch (e) { return false; }
    }
    function _held() { return !!(last && last.held); }
    // The players this box acts on: the showing one, or — before anything was loaded — every one made.
    function _acting() { return showing && handles[showing] ? [handles[showing]] : _made().map((s) => handles[s]); }
    // The players that take this device's volume: shown, and not held.
    function _live() { return _made().filter((s) => _shown(s) && !_held()); }
    // A reading: the showing player's; before a load, the first player made that answers (one service: its one answer).
    function _read(f, none) {
      const hs = _acting();
      let v = none;
      for (const h of hs) { v = f(h); if (v !== null && v !== undefined && v !== none) return v; }
      return v;
    }
    // ── THE SOUND, AS THE BOX MOVES A PLAYER (quietly: these are the box's own steps, not corrections) ──
    function _toSilent(s) {
      const h = handles[s], e = _exp(s);
      held0[s] = true;
      if (e.muted !== true) { try { h.mute(); } catch (x) {} e.muted = true; }
    }
    function _toLive(s) {
      const h = handles[s], e = _exp(s);
      held0[s] = false;
      if (dev.level !== null && e.level !== dev.level) { try { h.setVolume(dev.level); } catch (x) {} e.level = dev.level; }
      if (dev.muted) { if (e.muted !== true) { try { h.mute(); } catch (x) {} e.muted = true; } }
      else { try { h.unmute(); } catch (x) {} e.muted = false; }
    }
    // ── ONE CORRECTION: its command, and its one line ──
    function _say(s, kind, what) {
      const k = s + ":" + kind;
      if (said[k]) return;
      said[k] = true;
      try { if (typeof Logger !== "undefined") Logger.info("Player: corrected " + s + " — " + what); } catch (x) {}
    }
    function _right(s, kind) { said[s + ":" + kind] = false; }
    function _mayGive(s, kind) { const k = s + ":" + kind, t = Date.now(); if (gave[k] && t - gave[k] < RETRY_MS) return false; gave[k] = t; return true; }
    const _num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
    const _f1 = (x) => Number(x).toFixed(1);

    if (o.song) {
      const p = _partsOf(o.song);
      if (p && _make(p.service, p.id)) showing = p.service;
    } else {
      for (const s of _order) _make(s, null);
    }

    bp.plays = plays;
    bp.ready = function (key) {
      if (key) { const p = _partsOf(key); const h = p ? handles[p.service] : null; return !!(h && h.ready()); }
      const hs = _acting();
      return hs.length > 0 && hs.every((h) => h.ready());
    };
    bp.load = function (key, startSec) {
      const p = _partsOf(key);
      const h = p ? (handles[p.service] || _make(p.service, null)) : null;
      if (!h) return false;
      if (showing !== p.service) {
        // THE BOX SHOWS ONE PLAYER: the one whose service plays this song. Every other player made in the box hides, and the one
        // that was showing also stops. Before its first load the room's box holds every player empty, so a second service's
        // first song must not sit beside the first service's empty player (`ddjp_709`: SoundCloud's first song in a room).
        // Each one stepped aside is muted too (`ddjp_714`), and comes back to this device's volume when it shows again.
        for (const s of _made()) {
          if (s === p.service) continue;
          try { if (s === showing) { handles[s].stop(); _exp(s).play = false; } handles[s].show(false); } catch (e) {}
          try { _toSilent(s); } catch (e) {}
        }
        // The player that plays it shows: after another service's song (the box hid it then), or on the box's first song if it
        // kept itself hidden until a song came (`shown()` false: SoundCloud's, whose frame has no address before its first song).
        // A player that showed while empty is not touched on its first song, so YouTube's is handed exactly what it was.
        try { if (showing || (typeof h.shown === "function" && !h.shown())) h.show(true); } catch (e) {}
      }
      showing = p.service;
      // A LOAD IS THE SCREEN'S NEW WORD: this song, to be heard. A player's own events during the load (SoundCloud reports
      // "buffering" as it is handed the song) run the check before the screen's next one — never against the song before's
      // want, which may say held (that paused the new song and then "corrected" it, seen in Chromium at `ddjp_714`).
      if (last) last = Object.assign({}, last, { song: key, held: false });
      _right(p.service, "play");
      pending[p.service] = { id: p.id, at: Date.now() };
      loaded[p.service] = { at: Date.now(), played: false };
      gave[p.service + ":start"] = Date.now();   // the load is the box's first ask to play: a "cued" start waits RETRY_MS after it
      h.load(p.id, startSec);
      _exp(p.service).play = true;
      // A song loaded is a song to hear: a player the box held at 0, or never gave this device's volume (SoundCloud's, hidden
      // until its first song), takes it now.
      const e0 = _exp(p.service);
      if (held0[p.service] || e0.level !== dev.level || e0.muted !== dev.muted) { try { _toLive(p.service); } catch (e) {} }
      return true;
    };
    bp.play = function () { for (const s of (showing ? [showing] : _made())) { if (!handles[s]) continue; handles[s].play(); _exp(s).play = true; } };
    bp.pause = function () { for (const s of (showing ? [showing] : _made())) { if (!handles[s]) continue; handles[s].pause(); _exp(s).play = false; } };
    bp.stop = function () { for (const s of (showing ? [showing] : _made())) { if (!handles[s]) continue; handles[s].stop(); _exp(s).play = false; } };
    bp.seek = function (sec) { for (const h of _acting()) h.seek(sec); };
    bp.setVolume = function (n) { dev.level = n; for (const s of _live()) { handles[s].setVolume(n); _exp(s).level = n; } };
    bp.mute = function () { dev.muted = true; for (const s of _live()) { handles[s].mute(); _exp(s).muted = true; } };
    bp.unmute = function () { dev.muted = false; for (const s of _live()) { handles[s].unmute(); _exp(s).muted = false; } };
    bp.destroy = function () { last = null; for (const s of _made()) { try { handles[s].destroy(); } catch (e) {} } };
    // LEAVING (`ddjp_714`): the check stands down, every player stops, and one that keeps an element lets it go.
    bp.release = function () {
      last = null; lastAct = null;
      for (const s of _made()) {
        const h = handles[s];
        try { if (typeof h.release === "function") h.release(); else h.stop(); } catch (e) {}
        _exp(s).play = false; pending[s] = null;
      }
    };
    // A VOLUME CHANGED INSIDE THE SHOWN PLAYER'S FRAME, read as the room's poll always read it (the shown player's `volume()` then
    // `muted()`), and taken only while it is not held: the person's choice, which becomes this device's. Nothing is set.
    function _chosen() {
      let got = null;
      for (const s of _made()) {
        if (!_shown(s)) continue;
        const h = handles[s], e = _exp(s);
        let lv, m;
        try { lv = h.volume(); m = h.muted(); } catch (x) { continue; }
        // Only once the box has given it a volume (as the poll only compared after the room's first push), and not while held.
        if (typeof lv !== "number" || typeof e.level !== "number" || _held() || held0[s]) continue;
        if (loaded[s] && !loaded[s].played) continue;   // a load not yet played: the player's own doing, never the person's
        const moved = Math.abs(lv - e.level) > 1 || (typeof e.muted === "boolean" && !!m !== e.muted);
        if (!moved) continue;
        dev.level = Math.round(lv); dev.muted = !!m;
        e.level = dev.level; e.muted = dev.muted;
        got = { level: dev.level, muted: dev.muted, service: s };
        // Not a correction — the player is right, the device follows it — so its own line.
        try { if (typeof Logger !== "undefined") Logger.info("Player: volume from " + s + " — " + dev.level + (dev.muted ? ", muted" : "") + ", set inside its own player: now this device's"); } catch (x) {}
      }
      return got;
    }
    bp.chosenVolume = function () { return _chosen(); };

    // ── THE CHECK ──
    bp.check = function (want, act, said0) {
      if (want) last = want;
      if (act) lastAct = act;
      const w = last || {};
      const a = lastAct || {};
      const wp = w.song ? _partsOf(w.song) : null;
      const at = (() => { try { return _num(typeof w.at === "function" ? w.at() : w.at); } catch (e) { return null; } })();
      // A volume chosen inside the shown player's frame first: it becomes this device's before anything is compared with it.
      const got = last ? _chosen() : null;
      if (got && typeof a.chose === "function") { try { a.chose(got.level, got.muted, got.service); } catch (e) {} }
      for (const s of _made()) {
        const h = handles[s], e = _exp(s);
        try { if (typeof h.ready === "function" && !h.ready()) continue; } catch (x) { continue; }
        const shown = _shown(s), silent = !shown || !!w.held;
        let st = null;
        try { st = h.state(); } catch (x) {}
        if (said0 && said0.short === s && (said0.word === "playing" || said0.word === "buffering")) st = said0.word;
        if (silent) {
          // NOT SHOWN, OR HELD: paused, and its sound 0. Entering it is the box's own step; a player found playing, or found
          // with its sound back on, did it by itself.
          const why = shown ? "its song is over (held)" : "not shown (the box shows " + (showing || "nothing") + ")";
          if (st === "playing" || st === "buffering") { try { h.pause(); } catch (x) {} e.play = false; _say(s, "play", "playing while " + why); }
          else _right(s, "play");
          let m = null;
          try { m = h.muted(); } catch (x) {}
          if (!held0[s]) { try { _toSilent(s); } catch (x) {} }
          else if (m === false) { try { h.mute(); } catch (x) {} e.muted = true; _say(s, "sound", "its sound on while " + why); }
          else _right(s, "sound");
          continue;
        }
        if (!last) continue;   // never given a want: the not-shown rule alone
        if (held0[s]) { try { _toLive(s); } catch (x) {} }   // coming back: this device's volume, quietly
        // A PREVIEW HOLDS THE ROOM'S PLAYER: it paused it and gives it back when it closes; until then only "it plays by itself".
        if (w.aside) {
          if (e.play === false && st === "playing") { try { h.pause(); } catch (x) {} _say(s, "play", "playing while the song preview holds it"); }
          continue;
        }
        // THE SONG: the room's, by its key, unless a load of it is on its way.
        if (wp) {
          let id = null;
          try { id = h.id(); } catch (x) {}
          const pend = pending[s];
          const coming = !!(pend && pend.id === wp.id && wp.service === s && Date.now() - pend.at < LOAD_WAIT_MS);
          if (wp.service === s && id === wp.id) { pending[s] = null; _right(s, "song"); }
          else if (!coming) {
            let ttl = null;
            try { ttl = id ? null : h.title(); } catch (x) {}
            const shows = id ? Songs.key(s, id) : (ttl ? "another track (\"" + ttl + "\")" : "nothing");
            // The screen answers false when a load of it was already on its way there (waiting for the player): not a correction.
            if (typeof a.load === "function" && _mayGive(s, "song")) {
              let asked = true;
              try { asked = a.load(w.song, "it shows " + shows); } catch (x) {}
              if (asked !== false) _say(s, "song", "it shows " + shows + ", the room plays " + w.song);
            }
            continue;
          }
          if (coming && id !== wp.id) continue;   // still loading: nothing more to judge yet
        } else if (e.play === false && st === "playing") {
          // NOTHING TO PLAY, and it plays: by itself.
          try { h.pause(); } catch (x) {}
          _say(s, "play", "playing while nothing should");
          continue;
        }
        // PLAYING, AS ASKED: a player the box asked to play that reads paused paused by itself.
        if (wp && e.play === true && st === "paused") {
          if (_mayGive(s, "pause")) { try { h.play(); } catch (x) {} _say(s, "pause", "paused while shown, the room playing " + w.song); }
        } else _right(s, "pause");
        // ITS SONG UP AND NEVER STARTED ("cued", `ddjp_715`): started — RETRY_MS after its load at the soonest, so a player that
        // starts by itself is never pushed — at the room's point where there is one. Until then the drift rule leaves it alone.
        if (wp && e.play === true && st === "cued") {
          if (_mayGive(s, "start")) {
            if (at !== null) { try { h.seek(at); } catch (x) {} }
            try { h.play(); } catch (x) {}
            _say(s, "start", "loaded and not started while shown, the room playing " + w.song);
          }
          continue;
        } else _right(s, "start");
        // THE ROOM'S POINT: more than DRIFT_S apart, a seek — never past the player's own length less 1 s (`ddjp_711`).
        if (wp && at !== null) {
          let t = null;
          try { t = _num(h.time()); } catch (x) {}
          if (t !== null && Math.abs(t - at) > DRIFT_S) {
            let cap = _num(w.len);
            if (!(cap > 0)) { try { cap = _num(h.length()); } catch (x) { cap = null; } }
            if (!(cap > 0) || at <= cap - 1) {
              if (_mayGive(s, "seek")) {
                said[s + ":seek"] = false;   // each seek is its own correction, and says so
                const ld = loaded[s];   // how long after its load, as the trail always said (`ddjp_627`: a seek during a load is visible)
                _say(s, "seek", "the player at " + _f1(t) + " s, the room at " + _f1(at) + " s: more than " + DRIFT_S + " s apart (sought to " + _f1(at) + " s" +
                  (ld ? "; " + (Date.now() - ld.at) + " ms after its load" + (ld.played ? "" : ", before it first played") : "") + ")");
                try { h.seek(at); } catch (x) {}
              }
            }
          }
        }
        // THIS DEVICE'S VOLUME: a player that reads otherwise, not by the person's hand (that was taken above), is given it.
        if (dev.level !== null) {
          let lv = null, m = null;
          try { lv = h.volume(); m = h.muted(); } catch (x) {}
          const wrongLevel = dev.level !== null && typeof lv === "number" && Math.abs(lv - dev.level) > 1;
          const wrongMute = typeof m === "boolean" && m !== dev.muted;
          if (wrongLevel || wrongMute) {
            _say(s, "volume", "the volume " + lv + (m ? " (muted)" : "") + ", this device's " + dev.level + (dev.muted ? " (muted)" : ""));
            e.level = null; e.muted = null;
            try { _toLive(s); } catch (x) {}
          } else _right(s, "volume");
        }
      }
    };
    bp.song = function () {
      if (showing && handles[showing]) { const id = handles[showing].id(); return id ? Songs.key(showing, id) : null; }
      for (const s of _made()) { const id = handles[s].id(); if (id) return Songs.key(s, id); }
      return null;
    };
    bp.title = function () { return _read((h) => h.title(), null); };
    bp.time = function () { return _read((h) => h.time(), null); };
    bp.length = function () { return _read((h) => h.length(), 0); };
    bp.state = function () { return _read((h) => h.state(), null); };
    bp.volume = function () { return _read((h) => h.volume(), null); };
    bp.muted = function () { return _read((h) => h.muted(), null); };
    // THE LENGTH PROVIDER'S READING: the song and its length read TOGETHER, in that order, when somebody asks. A reading no
    // key can name is null wholesale — never an object with a falsy id (J49; `check-duration-provider` drives it).
    bp.reading = function () {
      if (!bp.ready()) return null;
      try {
        const k = bp.song();
        const d = bp.length();
        if (!k) return null;
        return { songKey: k, seconds: (typeof d === "number" && isFinite(d)) ? d : 0 };
      } catch (e) { return null; }
    };
    bp.service = function () { return showing; };
    return bp;
  }

  // The form a player file's path takes: a plain `ui/<name>.js`, the page's own (`check-player-plug` reads the rows by it).
  const PLAYER_FILE = /^ui\/[a-z0-9-]+\.js$/;

  return { register, registered, plays, available, make, WORDS, PLAYER_FILE };
})();
