// ui/soundcloud.js — SoundCloudPlayer: SoundCloud's widget, behind the song players' plug (`ui/songplayer.js`; `ddjp_709`)
//
// THE OWNER'S WORDS: "well lets do soundcloud" — the second song service (`main/01-project.md` item 5). THE ONE FILE THAT KNOWS
// SOUNDCLOUD'S PLAYER: its widget's script, `SC.Widget`, its events, its calls and its answers. Everything else plays a song
// through the plug, by its key (`core/songs.js`: `sc:` + the track's path, `<user>/<track>`), and reads back the plug's words.
// `core/songs.js`'s SoundCloud row names this file and the hosts the page lets it reach; the page has its own line for it,
// right after YouTube's.
//
// ── ITS SCRIPT, LOADED AS YOUTUBE'S FILE LOADS ITS OWN ───────────────────────────────────────────────────────────────────
// This file's tag inserts the widget's API script right after itself, at the top of the page's body.
//
// ── THE ROOM'S PLAYER IS MADE ONCE AND REUSED (`ddjp_714`); A PREVIEW'S IS FRESH, AND GOES WHEN IT CLOSES ──────────────────
// The owner's words (`ddjp_714`): "in PC when the tab is not visible, soundcloud waits for you to come back to play and on
// phone it even asks for a tap. can we bypass it? its really stoping the experience". `ddjp_710` gave every SoundCloud song
// its own fresh iframe (his words then: "i want a simple sure way even if it causes a slight load delay like you said, working
// for preview and player"), against a hidden frame playing on. But a fresh frame is a frame that has never played, and
// Chrome defers a frame's autoplay in a tab that is not visible ("Videos which autoplay in the background will now have their
// load deferred until the tab is visible for the first time"; "Once a tab / RenderFrame has ever played media before, it's
// allowed to continue to autoplay/autoload indefinitely" — Chromium change 1292433002); YouTube's room player, made once and
// reused, plays on. So now THE ROOM'S BOX makes its SoundCloud frame at its first SoundCloud song and REUSES it for every one
// after — the next song goes into the same widget (`widget.load`, with the look, `auto_play`, and the room's point sought on
// its PLAY), an early end's one reload too — and a song over leaves the frame where it is (FINISH reports "ended"; the
// box's check keeps it paused and silent while its song is held, or while another service shows). The frame goes for real
// (out of the page, so unloaded) on LEAVING THE ROOM (the plug's `release()`) and when ↻ held rebuilds the player
// (`destroy()`). What `widget.load` does, read in SoundCloud's own `api.js` (`ddjp_715`, two copies years apart agreeing): it
// sets the SAME iframe's `src` to the new track's address and keeps every other listener bound — but a READY handler is heard
// ONCE (a `bind(READY)` runs once and is never kept), so the new track's READY reaches the handle only through the load's own
// `options.callback`. `ddjp_714` gave none, and every SoundCloud song after a room's first stayed "loading" while the widget
// played it from 0:00 by itself, reloaded every 30 s and never named (the owner's log, `?v=631`; his words, `main/01-project.md`
// item 5). So each load into the frame carries a callback and a NUMBER: a callback whose number is not the latest acts on
// nothing (of two loads the latest wins, and an earlier track's ready never names the next song). NO READY WITHIN 5 s (the
// owner's: "ok make that 5 second not 8"): the room's frame is removed and a fresh one made for the same song at the room's
// point, as ↻ held does, with one line — once per song, never a loop; after it the handle waits for SoundCloud. Whether
// Chrome counts the reused iframe as the frame that has already played is seen only live (`LIVE-CHECKS.md` §11v): headless
// Chromium does not show Chrome's background wait. A PREVIEW is as `ddjp_710` made it: its own fresh frame, removed when its song ends or it
// closes; played again after its end it opens afresh — the person starts a preview with a tap. A song asked for and not
// loaded yet never plays once its frame is gone, and one stopped before its PLAY is paused as it starts. Until the widget is
// ready the handle takes every call (the volume is kept and applied when it is up; a seek becomes the song's start point, never
// written into the copy as if done), so the box is never held back by it. The room's, its track up and not playing, reports
// "cued" (`ddjp_715`): the length is known then, and the box's check starts it if it has not started by itself.
//
// ON A PHONE (`ddjp_714`, the supervisor's point 6): a phone's browser wants the person's tap before a new frame makes sound;
// whether a frame that has played needs none for the next song through `widget.load` — a new address in the same frame — is
// the live check's to say. Nothing here plays hidden or silent sound to unlock it.

// ── ITS LOOK (the supervisor's decision 1) ────────────────────────────────────────────────────────────────────────────────
// The big-artwork player, filling the box (`show_artwork`, `visual`; the sheet's `#player > *` sizes it); no buying, sharing or
// download. `visual` is in SoundCloud's help pages only, not its widget docs: if it stops working, the classic bar is what shows.
// `hide_related` (`ddjp_714`): after its track it suggests nothing — harmless if ignored, and the box's check pauses and mutes
// whatever plays after a FINISH while the song is held.
//
// ── EVERY READING IS A CALLBACK, SO READINGS COME FROM A COPY (the plug's decision 3) ────────────────────────────────────────
// The widget answers `getPosition`, `getDuration`, `getCurrentSound`, `isPaused` and `getVolume` later, in milliseconds. This
// file keeps a COPY, in seconds when read: refreshed by every PLAY_PROGRESS and by a poll every POLL_MS (at most one poll old),
// and it reports "playing" only once the copy has been refreshed for the song that started, so the room reads the right song
// and length then. WHAT IT IS DOING, READ BACK (`ddjp_714`, for the box's check): which track it holds (`getCurrentSound` —
// once the track it was asked for is up, another track's id is "another track, by itself", and `id()` names none), whether it
// plays (`isPaused`, once a track it was asked for has played: a play or a pause the widget made by itself is reported as
// the state it is in), and its volume (`getVolume`: a volume set inside SoundCloud's own player is the person's — `volume()`
// and `muted()` say it, and the box makes it this device's). An answer to a question asked before the handle's last command
// of the same kind is not taken: it describes a moment already past.
//
// ── THE LENGTH IS WHAT SOUNDCLOUD SAYS IT CAN PLAY (the supervisor's decision 4; the owner's words on previews) ───────────────
// `getDuration`; and when the current sound shows it is a SNIPPET — SoundCloud's 30-second preview of a paid-only track — the
// snippet's length: a stream of the sound marked `snipped` with its own `duration`, or the sound's `duration` where it is
// shorter than its `full_duration`, under the policy `SNIP`. Those field names are SoundCloud's track data as its data service
// gives it (`media.transcodings[].snipped`), not seen on the widget's own object: SoundCloud refuses automated fetching, so
// whether `getCurrentSound` carries them is seen only live. Where it carries none, the length is `getDuration` alone. The
// room's length agreement and its ending rule are unchanged: a preview the room agrees at 30 s ends at 30 s.
//
// ── ITS ERROR HAS NO CODE ───────────────────────────────────────────────────────────────────────────────────────────────────
// The widget's ERROR event carries none, so it is the app's `unavailable` (the song cannot be played here), and the log's few
// words say SoundCloud gave no code. Volume is 0–100, as the widget's; mute is volume 0, and the volume is remembered.
//
// Depends on: SongPlayer (at load), Songs (at call time), SC (once its script is up), Logger (at call time)

const SoundCloudPlayer = (() => {
  "use strict";
  const SHORT = "sc";                                    // its row in `core/songs.js`
  const API = "https://w.soundcloud.com/player/api.js";
  const WIDGET = "https://w.soundcloud.com/player/";
  const POLL_MS = 250;                                   // the copy's poll
  const INIT_RETRY_MS = 500;                             // open the widget once its script is up
  const READY_WAIT_MS = 5000;                            // no ready this long after a load: a fresh frame, once per song (`ddjp_715`)
  const LOOK = { auto_play: true, hide_related: true, show_artwork: true, visual: true, buying: false, sharing: false, download: false };
  const EV = { READY: "ready", PLAY: "play", PAUSE: "pause", FINISH: "finish", SEEK: "seek", PLAY_PROGRESS: "playProgress", ERROR: "error" };
  function _ev(name) { try { return (SC.Widget.Events && SC.Widget.Events[name]) || EV[name]; } catch (e) { return EV[name]; } }

  // ── THE SCRIPT ──
  function _loadScript() {
    try {
      if (typeof document === "undefined" || !document.createElement || !document.currentScript) return;   // no page being read
      const s = document.createElement("script");
      s.src = API;
      const at = document.currentScript;   // this file's own tag, the page's line for it
      if (at && at.parentNode) at.parentNode.insertBefore(s, at.nextSibling);
    } catch (e) { /* no page: a guard's sandbox */ }
  }
  function available() { return typeof SC !== "undefined" && !!SC && typeof SC.Widget === "function"; }
  function _link(id) { try { return Songs.linkOf(Songs.key(SHORT, id)); } catch (e) { return null; } }
  function _src(link) {
    return WIDGET + "?url=" + encodeURIComponent(link) + Object.keys(LOOK).map((k) => "&" + k + "=" + LOOK[k]).join("");
  }
  // What SoundCloud says it can play, in ms: a snippet's length where the sound shows it is one (above), else `getDuration`.
  function playableMs(sound, durationMs) {
    let ms = (typeof durationMs === "number" && isFinite(durationMs) && durationMs > 0) ? durationMs : 0;
    try {
      if (!sound || typeof sound !== "object") return ms;
      const tr = (sound.media && Array.isArray(sound.media.transcodings)) ? sound.media.transcodings : [];
      const snips = tr.filter((t) => t && t.snipped === true && typeof t.duration === "number" && t.duration > 0).map((t) => t.duration);
      const shorter = (typeof sound.duration === "number" && typeof sound.full_duration === "number" && sound.duration > 0 &&
        sound.duration < sound.full_duration) ? sound.duration : null;
      if (snips.length) return Math.min.apply(null, snips.concat(ms > 0 ? [ms] : []));
      if (shorter !== null && (sound.policy === "SNIP" || snips.length || ms === 0 || ms > shorter)) return shorter;
    } catch (e) { /* an answer of another shape: getDuration alone */ }
    return ms;
  }

  function make(box, opts, on) {
    const o = opts || {}, cb = on || {};
    const mountId = SHORT + "-" + ((box && box.id) || "player");
    const reuse = !o.preview;      // the room's box keeps its one frame for every song (`ddjp_714`); a preview's is fresh
    let el = null, w = null, retry = null, poll = null, destroyed = false, toldReady = false;
    let visible = !!o.id;          // a preview shows at once; the room's box shows its player when the plug says so
    let gen = 0;                   // which frame is current: a handler of a frame since removed acts on nothing
    let reloading = false;         // the widget is loading the next track into this frame: the old track's events are past
    let halted = false;            // stopped or paused by the box: a PLAY arriving now (a load's auto_play) is paused again
    let volSeq = 0, playSeq = 0;   // each volume command, each play/pause/load: an answer asked before one is not taken
    // THE COPY: what every reading answers from (ms inside, seconds outside).
    const copy = { ready: false, id: null, soundId: null, title: null, ms: 0, lengthMs: 0, state: "unstarted", volume: 100,
      muted: !!o.startMuted, applied: null };
    let loading = null;            // the id asked for, until its PLAY is refreshed into the copy
    let wantStartMs = null;        // a load's start, applied once the widget plays it
    let waiting = null;            // a song whose frame waits for the widget's script
    let lastId = null;             // the song this handle last loaded (a preview played again after its end opens it afresh)
    let loadSeq = 0;               // each load's number: a callback of a load that is not the latest acts on nothing (`ddjp_715`)
    let readyWait = null;          // the room's frame waiting for its ready (READY_WAIT_MS)
    let freshFor = null;           // the song already given its one fresh frame, until a ready comes
    let startAsked = 0, startAt = 0;   // the start point asked (ms) and when: the room's point now, for that fresh frame
    let heardPlay = false;         // a PLAY came for this load (its copy may not be refreshed yet): never "cued" then

    function _say(m) { try { if (typeof Logger !== "undefined") Logger.debug("SoundCloud: " + m); } catch (e) {} }
    function _tell(m) { try { if (typeof Logger !== "undefined") Logger.info("SoundCloud: " + m); } catch (e) {} }
    function _report(word) { if (typeof cb.state === "function") cb.state(word); }
    function _applyVolume() {
      volSeq++;
      const v = copy.muted ? 0 : copy.volume;
      try { if (w) { w.setVolume(v); copy.applied = v; } } catch (e) {}
    }
    // THE FRAME GOES, FOR REAL: its widget's events unbound, its poll and its wait for the script stopped, a song asked for and
    // not loaded yet forgotten, and the iframe taken out of the page — unloaded, so nothing in it can play on.
    function _remove() {
      gen++;
      if (retry) { clearTimeout(retry); retry = null; }
      if (readyWait) { clearTimeout(readyWait); readyWait = null; }
      if (poll) { clearTimeout(poll); poll = null; }
      waiting = null; wantStartMs = null; loading = null; reloading = false;
      try { if (w) for (const k of Object.keys(EV)) w.unbind(_ev(k)); } catch (e) {}
      w = null; copy.ready = false; copy.applied = null; copy.soundId = null;
      try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      el = null;
    }
    // The widget's answers, into the copy; `then(sound)` once all are in. From the poll (`fromPoll`), what the widget is doing
    // by itself is taken too: another track, a play or a pause it made, a volume set inside it.
    function refresh(then, fromPoll) {
      if (!w || reloading) return;
      const mine = gen, widget = w, vs = volSeq, ps = playSeq;
      let n = 5, sound = null, dur = 0, paused = null, vol = null;
      const done = () => {
        if (--n !== 0 || mine !== gen || reloading) return;
        copy.lengthMs = playableMs(sound, dur);
        copy.title = (sound && typeof sound.title === "string" && sound.title) ? sound.title : copy.title;
        // ANOTHER TRACK, BY ITSELF: the widget holds a sound that is not the one this handle loaded (a related track after its
        // end, or one played inside it). The handle names none, and the box loads the room's song again, or holds it silent.
        if (sound && sound.id !== undefined && copy.soundId !== null && sound.id !== copy.soundId && copy.id) {
          _say("another track in the widget, by itself: " + (sound.title || sound.id));
          copy.id = null;
        }
        // A VOLUME SET INSIDE IT, by the person: not what this handle last applied, asked after its last volume command.
        if (typeof vol === "number" && vs === volSeq && copy.applied !== null && Math.abs(vol - copy.applied) > 1) {
          if (vol === 0) copy.muted = true; else { copy.volume = Math.round(vol); copy.muted = false; }
          copy.applied = vol;
        }
        if (fromPoll && typeof paused === "boolean" && ps === playSeq && copy.soundId !== null && loading === null) {
          if (!paused && copy.state !== "playing" && copy.state !== "buffering") { copy.state = "playing"; _report("playing"); }
          else if (paused && copy.state === "playing") { copy.state = "paused"; _report("paused"); }
        }
        if (typeof then === "function") then(sound);
      };
      try { widget.getCurrentSound((x) => { sound = x; done(); }); } catch (e) { done(); }
      try { widget.getDuration((ms) => { dur = ms; done(); }); } catch (e) { done(); }
      try { widget.getPosition((ms) => { if (mine === gen && !reloading && typeof ms === "number" && isFinite(ms)) copy.ms = ms; done(); }); } catch (e) { done(); }
      try { widget.isPaused((p) => { paused = p; done(); }); } catch (e) { done(); }
      try { widget.getVolume((v) => { vol = v; done(); }); } catch (e) { done(); }
    }
    function startPoll() {
      if (poll || destroyed) return;
      const mine = gen;
      const tick = () => { poll = null; if (destroyed || mine !== gen || !w) return; refresh(null, true); poll = setTimeout(tick, POLL_MS); };
      poll = setTimeout(tick, POLL_MS);
    }
    // The track this handle was asked for is up: the copy names it, and its sound's id is the one to tell another track from.
    function _own(sound) {
      if (!loading) return;
      copy.id = loading;
      copy.soundId = (sound && sound.id !== undefined) ? sound.id : null;
    }
    // ITS TRACK IS UP — a fresh frame's READY, or a reused frame's load callback (`ddjp_715`): the copy is read for the track
    // asked, and one up and not playing reports "cued" (its length known; the box's check starts it if it does not start itself).
    function _ready() {
      if (readyWait) { clearTimeout(readyWait); readyWait = null; }
      freshFor = null;
      copy.ready = true;
      reloading = false;
      _applyVolume();
      startPoll();
      if (loading) refresh((sound) => {
        if (!copy.id) { _own(sound); }
        if (reuse && copy.id && copy.state === "buffering" && !heardPlay) { copy.state = "cued"; _report("cued"); }   // a preview draws as before
      });
      if (!toldReady) { toldReady = true; if (typeof cb.ready === "function") cb.ready(); }
    }
    // NO READY WITHIN READY_WAIT_MS (the room's frame; a preview stays as it is): the frame removed and a fresh one made for the
    // same song at the room's point — once per song; after it the handle waits for SoundCloud (↻ remains).
    function _waitReady(id) {
      if (!reuse) return;
      if (readyWait) clearTimeout(readyWait);
      const mine = gen, seq = loadSeq;
      readyWait = setTimeout(() => {
        readyWait = null;
        if (destroyed || mine !== gen || seq !== loadSeq || copy.ready || loading !== id || freshFor === id) return;
        freshFor = id;
        const at = Math.max(0, startAsked + (Date.now() - startAt));
        _tell("no ready " + (READY_WAIT_MS / 1000) + " s after loading " + Songs.key(SHORT, id) + " — its frame replaced by a fresh one, at " +
          (at / 1000).toFixed(1) + " s (once for this song)");
        _remove();
        loading = id; lastId = id; wantStartMs = at > 0 ? at : null;
        _open(id);
      }, READY_WAIT_MS);
    }
    function _bind(widget, mine) {
      // A handler acts only for the current frame, and not while the next track is loading into it (the old track's events).
      const on = (name, fn) => widget.bind(_ev(name), (e) => { if (mine === gen && widget === w && (name === "READY" || !reloading)) fn(e); });
      on("READY", _ready);
      on("PLAY", () => {
        if (halted) { try { w.pause(); } catch (e) {} return; }   // stopped by the box before it started: never heard
        heardPlay = true;
        if (wantStartMs !== null) { const s = wantStartMs; wantStartMs = null; try { w.seekTo(s); } catch (e) {} copy.ms = s; }
        refresh((sound) => {
          if (loading) { _own(sound); loading = null; }
          copy.state = "playing";
          _report("playing");
        });
      });
      on("PAUSE", () => { copy.state = "paused"; _report("paused"); });
      // ITS SONG IS OVER: "ended" is reported. A preview's frame then goes — unless the report already loaded the next song into
      // a fresh frame, which stays; the room's frame stays for the next song (`ddjp_714`).
      on("FINISH", () => {
        copy.state = "ended";
        _report("ended");
        if (!reuse && mine === gen) _remove();
      });
      on("SEEK", (e) => { if (e && typeof e.currentPosition === "number") copy.ms = e.currentPosition; });
      on("PLAY_PROGRESS", (e) => { if (e && typeof e.currentPosition === "number") copy.ms = e.currentPosition; });
      // The raw failure goes no further than this file: the plug reports the app's reason, and the log says there was no code.
      on("ERROR", () => { if (typeof cb.failed === "function") cb.failed("unavailable", "SoundCloud gave no code"); });
    }
    // A FRESH FRAME FOR THIS SONG, opened on it — once the widget's script is up (one wait at a time, the latest song's: every
    // load replaces the one before, its wait with it).
    function _open(id) {
      if (destroyed || !box) return;
      const link = _link(id);
      if (!link) return;
      if (!available()) {
        waiting = id;
        retry = setTimeout(() => { retry = null; const q = waiting; waiting = null; if (q && !destroyed) _open(q); }, INIT_RETRY_MS);
        return;
      }
      try {
        el = document.createElement("iframe");
        el.id = mountId;
        el.setAttribute("allow", "autoplay");
        el.setAttribute("frameborder", "0");
        el.setAttribute("scrolling", "no");
        el.setAttribute("title", "SoundCloud");
        if (el.style) el.style.display = visible ? "" : "none";
        el.setAttribute("src", _src(link));
        box.appendChild(el);
      } catch (e) { el = null; _say("no frame made: " + (e && e.message)); return; }
      try { w = SC.Widget(el); _bind(w, gen); _waitReady(id); } catch (e) { _say("its widget refused: " + (e && e.message)); _remove(); }
    }
    // THE NEXT SONG, INTO THE SAME FRAME (the room's, `ddjp_714`): `widget.load` with the look and `auto_play`; the room's point
    // is sought on its PLAY. The track up is told by the load's own callback (`ddjp_715`: api.js tells it no other way), and only
    // the latest load's counts; until then the old track's events are not read.
    function _reload(id) {
      const link = _link(id);
      if (!link) return;
      reloading = true; copy.ready = false; copy.soundId = null;
      if (poll) { clearTimeout(poll); poll = null; }
      const mine = loadSeq, g = gen;
      const callback = () => { if (mine === loadSeq && g === gen && w && reloading) _ready(); };
      try { w.load(link, Object.assign({}, LOOK, { callback })); _waitReady(id); }
      catch (e) { _say("its widget refused the next track: " + (e && e.message)); _remove(); loading = id; lastId = id; _open(id); }
    }
    function _load(id, startSec) {
      const into = reuse && w && el && !waiting;   // the room's frame, already made: the same frame takes it
      if (!into) _remove();                        // a preview's, or none yet: never two at once
      wantStartMs = (typeof startSec === "number" && startSec > 0) ? Math.round(startSec * 1000) : null;
      loadSeq++; startAsked = wantStartMs || 0; startAt = Date.now(); heardPlay = false;
      loading = id; lastId = id; copy.id = null; copy.ms = 0; copy.lengthMs = 0; copy.title = null;
      halted = false; playSeq++;
      copy.state = "buffering";
      if (into) _reload(id); else _open(id);
      _report("buffering");   // after the load is under way: whatever the report sets off finds the new track asked for
    }
    if (o.id) { loading = o.id; lastId = o.id; _open(o.id); }
    return {
      // calls
      load(id, startSec) { _load(id, startSec); },
      // Played with no frame: a preview whose song ended opens it afresh (from where it was sought); the room's box does not —
      // its next song is the room's to load.
      play() {
        halted = false; playSeq++;
        try {
          if (w && copy.ready) w.play();
          else if (!w && !waiting && o.preview && lastId && !destroyed) _load(lastId, copy.ms / 1000);
        } catch (e) {}
      },
      pause() { halted = true; playSeq++; try { if (w && copy.ready) w.pause(); } catch (e) {} },
      // A SEEK BEFORE READY is the song's start point (sought on its PLAY), never written into the copy as if done (`ddjp_715`);
      // one before its PLAY moves that start point too.
      seek(sec) {
        const ms = Math.round(sec * 1000);
        if (w && copy.ready) { try { w.seekTo(ms); } catch (e) {} copy.ms = ms; if (loading) wantStartMs = ms > 0 ? ms : null; }
        else if (loading) { wantStartMs = ms > 0 ? ms : null; startAsked = ms; startAt = Date.now(); }
      },
      // STOPPED: the room's frame is paused and kept for the next song (`ddjp_714`); a preview's has no stop of its own (it is
      // destroyed), and a frame not yet made has nothing to stop.
      stop() {
        halted = true; playSeq++;
        waiting = null;
        if (retry) { clearTimeout(retry); retry = null; }
        if (!reuse) _remove();
        else { try { if (w && copy.ready) w.pause(); } catch (e) {} }
        loading = null; wantStartMs = null;
        copy.ms = 0; if (copy.state !== "unstarted") copy.state = "paused";
      },
      setVolume(n) { copy.volume = n; if (!copy.muted) _applyVolume(); },
      mute() { copy.muted = true; _applyVolume(); },
      unmute() { copy.muted = false; _applyVolume(); },
      show(onOff) { visible = !!onOff; if (el && el.style) el.style.display = onOff ? "" : "none"; },
      shown() { return visible; },   // false in the room's box until the plug shows it (it holds no frame before its first song)
      // LEAVING THE ROOM: the frame goes for real (`ddjp_714`); the next room's entry makes its own box.
      release() { halted = true; _remove(); copy.ms = 0; if (copy.state !== "unstarted") copy.state = "paused"; },
      destroy() { destroyed = true; _remove(); },
      // readings — the copy, in seconds. It takes calls from the start (a load waits for the widget), so it is ready at once.
      ready() { return !destroyed; },
      id() { return copy.id; },
      title() { return copy.title; },
      time() { return copy.ms / 1000; },
      length() { return copy.lengthMs / 1000; },
      state() { return copy.state; },
      volume() { return copy.volume; },
      muted() { return copy.muted; },
    };
  }

  _loadScript();
  const impl = { available, make };
  if (typeof SongPlayer !== "undefined") SongPlayer.register(SHORT, impl);
  return { SHORT, POLL_MS, LOOK, available, make, playableMs };
})();
