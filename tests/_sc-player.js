// tests/_sc-player.js — A STAND-IN FOR SOUNDCLOUD'S WIDGET API, `SC.Widget`, shaped from its docs (`ddjp_709`)
//
// A harness, not a guard (no `check-` prefix). Until `ddjp_709` this file was a test SERVICE shaped like SoundCloud's widget,
// given a row in a test copy of the table; SoundCloud is now a row of the real table with its real player file
// (`ui/soundcloud.js`), so this file became what that player is driven against: the widget itself, as SoundCloud's widget API
// page describes it (developers.soundcloud.com/docs/api/html5-widget). Nothing here is what SoundCloud really answers — it
// refuses automated fetching, so its real answers are seen only live (`LIVE-CHECKS.md`, J151).
//
// WHAT THE DOCS SAY, AND THIS STAND-IN DOES:
//   `SC.Widget(iframe)` — the widget of an iframe already opened on a track (`w.soundcloud.com/player/?url=<track>&…`); the
//       stand-in reads the track from the iframe's `src`.
//   `SC.Widget.Events` — READY, PLAY, PAUSE, FINISH, SEEK, PLAY_PROGRESS, LOAD_PROGRESS, ERROR (and the panel and button
//       events), with the docs' string values. `bind(event, fn)` / `unbind(event)`. PLAY_PROGRESS and SEEK hand
//       `{ currentPosition, relativePosition, loadProgress }`; ERROR hands nothing (no code).
//   `load(url, options)`, `play()`, `pause()`, `toggle()`, `seekTo(ms)`, `setVolume(0–100)`, `next()`, `prev()`, `skip(i)`.
//
// TWO RULES TAKEN FROM SOUNDCLOUD'S OWN `api.js`, NOT ITS DOCS (`ddjp_715`; two copies years apart, read as text, agree — npm's
// `soundcloud-widget` 0.2.1 `vendor/soundcloud-widget.js` and a current build). Until `ddjp_715` this stand-in fired READY at
// every bound handler every time, which is what `ddjp_714` believed, and every guard agreed with that belief while the live
// widget never told the room's player its next track was up (the owner's log, `?v=631`):
//   1. A READY HANDLER IS HEARD ONCE. `bind(READY, fn)` before the widget is ready runs `fn` at its READY, once, and keeps
//      nothing; bound when ready, `fn` runs once, later. A second READY reaches no handler bound before it.
//   2. `load(url, options)` sets the SAME iframe's `src` to the new track's address and keeps every other listener; the new
//      track's READY reaches ONLY `options.callback` (api.js binds it at the iframe's load and adds the listeners back there).
//      Here: every load's callback still waiting runs at the next READY the harness fires — the case where the iframe had
//      loaded between two loads, the harder one for a handle; `staleReady(name)` is the page BEFORE posting its READY after the
//      next load was asked: the earlier loads' callbacks run, and the getters still answer the earlier track.
//   Until a load's READY the getters answer the track up before it.
//   A call that changes the sound is followed, LATER, by its event: `play()` by PLAY and `pause()` by PAUSE when it changes whether
//       the sound plays, `seekTo(ms)` by SEEK — the docs' events are the sound's, whoever moved it.
//   The getters answer BY CALLBACK, LATER, in milliseconds: `getVolume`, `getDuration`, `getPosition`, `getSounds`,
//       `getCurrentSound`, `getCurrentSoundIndex`, `isPaused`. Each answer waits for the harness's `later` queue.
//   `getCurrentSound`'s fields are not listed by the docs. The stand-in answers SoundCloud's track data as its data service
//       gives it — `id`, `title`, `duration`, `full_duration`, `policy`, `media.transcodings[]` with `snipped` and `duration`
//       — so a 30-second snippet can be described (a track's `snippet: true`); whether the widget's object carries those fields
//       is what the live check on a Go+ track shows. A track's `id` is its own, the same every time it is asked (`ddjp_714`:
//       the player tells "another track, by itself" by it).
//
//   standIn({ calls, later, document, tracks }) → { SC, EVENTS, DOCUMENTED, made, find(name), fire(name, EVENT, arg), staleReady(name),
//                                                   asked() — every widget member read that the docs do not list }
//   `calls` is shared with the caller's own recording (YouTube's stand-in writes into the same list), so one list shows both
//   players in the order they were handed things. A track is `{ title, durationMs, snippet }`, by its link; any other link is
//   a track of 215 300 ms titled after its path.
"use strict";

// The docs' event names and their values.
const EVENTS = Object.freeze({ LOAD_PROGRESS: "loadProgress", PLAY_PROGRESS: "playProgress", PLAY: "play", PAUSE: "pause", FINISH: "finish",
  SEEK: "seek", READY: "ready", OPEN_SHARE_PANEL: "sharePanelOpened", CLICK_DOWNLOAD: "downloadClicked", CLICK_BUY: "buyClicked", ERROR: "error" });
// Every member of a widget the docs list.
const DOCUMENTED = Object.freeze(["bind", "unbind", "load", "play", "pause", "toggle", "seekTo", "setVolume", "next", "prev", "skip",
  "getVolume", "getDuration", "getPosition", "getSounds", "getCurrentSound", "getCurrentSoundIndex", "isPaused"]);
const DEFAULT_MS = 215300;

function urlOf(src) {
  try { const u = new URL(src); return u.searchParams.get("url"); } catch (e) { return null; }
}

function standIn(o) {
  o = o || {};
  const calls = o.calls || [];
  const later = o.later || ((fn) => fn());
  const tracks = o.tracks || {};
  const made = [];
  const asked = [];
  const ids = new Map();   // a track's link -> its id, fixed once given
  const idOf = (url) => { if (!ids.has(url)) ids.set(url, 1000 + ids.size); return ids.get(url); };
  function trackOf(url) {
    const t = tracks[url] || {};
    const p = (() => { try { return new URL(url).pathname.slice(1); } catch (e) { return String(url); } })();
    return { title: t.title || ("Track " + p), durationMs: t.durationMs || DEFAULT_MS, snippet: !!t.snippet, path: p };
  }
  // The sound `getCurrentSound` answers: SoundCloud's track data. A snippet is its 30-second preview of a paid-only track.
  function soundOf(url) {
    if (!url) return null;
    const t = trackOf(url);
    const s = { kind: "track", id: idOf(url), title: t.title, permalink_url: url, duration: t.durationMs, full_duration: t.durationMs,
      policy: "ALLOW", media: { transcodings: [{ preset: "mp3_0_0", duration: t.durationMs, snipped: false, format: { protocol: "progressive" } }] } };
    if (t.snippet) {
      s.duration = 30000; s.policy = "SNIP";
      s.media.transcodings = [{ preset: "mp3_0_0", duration: 30000, snipped: true, format: { protocol: "progressive" } }];
    }
    return s;
  }
  function Widget(elOrId) {
    const el = typeof elOrId === "string" ? (o.document && o.document.getElementById(elOrId)) : elOrId;
    const name = (el && el.id) || String(elOrId);
    const src = el && typeof el.getAttribute === "function" ? el.getAttribute("src") : null;
    const st = { url: urlOf(src), ms: 0, vol: 100, paused: true, binds: Object.create(null), src, ready: false, readyOnce: [], asked: [] };
    calls.push("SC.Widget " + name + " " + (st.url || "(no track)"));
    const rec = (k, args) => calls.push(name + "." + k + "(" + JSON.stringify(args).slice(1, -1) + ")");
    const base = {
      // Rule 1: READY once per bind — kept until the widget's READY (or run later if it is ready), then forgotten.
      bind(ev, fn) {
        if (ev === EVENTS.READY) { if (st.ready) later(() => fn()); else st.readyOnce.push(fn); return; }
        st.binds[ev] = fn;
      },
      unbind(ev) { if (ev === EVENTS.READY) st.readyOnce = []; else delete st.binds[ev]; },
      // Rule 2: the new track's READY reaches only `options.callback`.
      load(url, options) {
        rec("load", [url, options]); st.ready = false;
        st.asked.push({ url, callback: options && typeof options.callback === "function" ? options.callback : null });
        // As SoundCloud's `api.js`: the same iframe, a new address on the widget's base with the track and the options.
        try { if (el && typeof el.setAttribute === "function") el.setAttribute("src", "https://w.soundcloud.com/player/?url=" + encodeURIComponent(url)); } catch (e) {}
      },
      // The sound's own events follow a call, LATER, as the widget posts them: PLAY or PAUSE when the call changes whether it
      // plays, SEEK with the new position.
      play() { rec("play", []); if (st.paused) { st.paused = false; later(() => fire(name, "PLAY")); } },
      pause() { rec("pause", []); if (!st.paused) { st.paused = true; later(() => fire(name, "PAUSE")); } },
      toggle() { rec("toggle", []); st.paused = !st.paused; later(() => fire(name, st.paused ? "PAUSE" : "PLAY")); },
      seekTo(ms) { rec("seekTo", [ms]); st.ms = ms; later(() => fire(name, "SEEK", { currentPosition: ms })); },
      setVolume(v) { rec("setVolume", [v]); st.vol = v; },
      next() { rec("next", []); }, prev() { rec("prev", []); }, skip(i) { rec("skip", [i]); },
      getVolume(cb) { later(() => cb(st.vol)); },
      getDuration(cb) { later(() => cb(st.url ? trackOf(st.url).durationMs : 0)); },
      getPosition(cb) { later(() => cb(st.ms)); },
      getSounds(cb) { later(() => cb(st.url ? [soundOf(st.url)] : [])); },
      getCurrentSound(cb) { later(() => cb(soundOf(st.url))); },
      getCurrentSoundIndex(cb) { later(() => cb(0)); },
      isPaused(cb) { later(() => cb(st.paused)); },
    };
    // Every member the player file reads is checked against the docs' list.
    const w = new Proxy(base, { get(t, k) {
      if (typeof k === "string" && DOCUMENTED.indexOf(k) < 0 && k !== "then" && k !== "toJSON") asked.push(name + "." + k);
      return t[k];
    } });
    made.push({ name, el, st, w });
    return w;
  }
  Widget.Events = EVENTS;
  const SC = { Widget };
  const find = (name) => made.filter((m) => m.name === name).slice(-1)[0];
  // Fire one of the docs' events at a widget, as SoundCloud would: `fire("sc-player", "PLAY_PROGRESS", { currentPosition })`.
  function fire(name, EVENT, arg) {
    const m = find(name);
    const ev = EVENTS[EVENT];
    if (!m) { calls.push("!! no widget " + name); return; }
    if (EVENT === "READY") {
      // The latest track asked is up: the getters answer it; the handlers bound before the first READY run once, then every
      // load's callback still waiting runs once (api.js: the wrapper bound at the iframe's load).
      const asked = m.st.asked.splice(0);
      if (asked.length) { m.st.url = asked[asked.length - 1].url; m.st.ms = 0; m.st.paused = true; }
      m.st.ready = true;
      calls.push("→ " + name + " " + ev);
      m.st.readyOnce.splice(0).forEach((fn) => fn());
      asked.forEach((a) => { if (a.callback) a.callback(); });
      return;
    }
    if (EVENT === "PLAY") m.st.paused = false;
    if (EVENT === "PAUSE" || EVENT === "FINISH") m.st.paused = true;
    if ((EVENT === "PLAY_PROGRESS" || EVENT === "SEEK") && arg && typeof arg.currentPosition === "number") m.st.ms = arg.currentPosition;
    calls.push("→ " + name + " " + ev);
    const fn = m.st.binds[ev];
    if (typeof fn === "function") fn(EVENT === "ERROR" ? undefined : Object.assign({ currentPosition: m.st.ms, relativePosition: 0, loadProgress: 1 }, arg || {}));
  }
  // THE PAGE BEFORE POSTS ITS READY after the next load was asked (its iframe had loaded): api.js marks the widget ready and runs
  // the earlier loads' callbacks; the getters still answer the earlier track; the latest load's callback waits for its own READY.
  function staleReady(name) {
    const m = find(name);
    if (!m || m.st.asked.length < 2) { calls.push("!! no earlier load waiting on " + name); return; }
    const before = m.st.asked.splice(0, m.st.asked.length - 1);
    m.st.url = before[before.length - 1].url;
    m.st.ready = true;
    calls.push("→ " + name + " ready (the page before)");
    before.forEach((a) => { if (a.callback) a.callback(); });
  }
  return { SC, EVENTS, DOCUMENTED, made, find, fire, staleReady, asked: () => asked.slice(), trackOf, soundOf };
}

module.exports = { standIn, EVENTS, DOCUMENTED, urlOf, DEFAULT_MS };
