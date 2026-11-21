// features/rep-geo.js — J153 (d): THE BOT AND BLOCKED SONGS (item 9, the owner's; his words and the plan in
// `main/01-project.md` §9). A REP piece: it needs people's countries, which belong to REP, so it lives beside the bot side,
// reaches the rest of the app only through `RepPorts` and counts through `RepRules` (`check-rep-boundary` B), and the bot
// runtime stays free of REP (`check-rep-boundary` E). It runs only on the room's bot tab, in rooms with a bot, entered and
// left with REP's other pieces (`Rep.enter` / `Rep.leave`, H1 and H2).
//
// ── THE PREDICTION IS THE BOT'S ALONE ──────────────────────────────────────────────────────────────────────────────────
// Where a song is blocked (outside data: this device's own lookups, through the one lookup path) against the countries of
// the people present (the bot's live view, `RepPorts.whoIsActive`, with countries from its own table beside REP's, so one
// set a moment ago counts at once). It never enters the room's record and the room never counts it: people's reports and
// the room's own skips are the room's (`consensus/blocked-content-survival.md`) and work with or without this. The room's
// settings say what the bot may do with it, each on or off on its own (read when it acts):
//   · CHECKING: every song in the room queue and the song playing, always (his "excepot the bot always monitors room
//     queue"). The songs it holds no answer for are asked together (`MetadataService.fetchMany`, under the room queue's
//     list, so the counting and the daily limits are the screens'); a song no source answered is asked again only after
//     `RETRY_MS`.
//   · WARNINGS (`botBlockedWarn`, on): one line in the main chat naming the DJ, once per song while it is queued, as soon
//     as it is found blocked for someone present — how many people, which countries, and what the bot will do. Whose
//     countries count follows "Include unranked people's countries" (`repUnrankedCountries`), and the line says when they
//     are left out.
//   · SKIPS (`botBlockedSkip`, off): at a song's start, decided within `DECIDE_MS` of it or not at all (the repeat sweep's
//     rule, `features/botruntime.js` `sweepRepeat`), when the RANKED people it is blocked for meet the bot's minimums
//     (`botBlockedRoads`, judged by the reducer's one road rule through the ports). Ranked people only, always (his "no
//     option for unranked people"). Sent as the repeat sweep sends its skip, tagged `region`, so it is not counted as a
//     play; one line says why, as `_announceRepeat` does.
//   · STRIKES (`botBlockedStrike`, off), with the fix time (`botBlockedFixMs`, 10 minutes): a queued song that meets the same
//     minimums (ranked people only) is warned about, saying the bot will strike it — even with warnings off, then for those
//     songs alone — and that warning, once DELIVERED, starts the timer for that DJ's song (the AFK warning's rule: an
//     undelivered warning starts no clock). When the DJ is next to play — the head of the rotation, the song their first —
//     and the full fix time has passed, and the minimums are still met at that moment, the bot strikes the song before it
//     plays (`Queue.strike`, the moderator's strike, through the ports) and, once it is gone, says so in one line, as the AFK
//     removal is announced. Before the full time, the song plays and the skip, if on, applies as it starts. After a strike,
//     the DJ's next song, if it too will be struck, is warned again and its timer starts over (his "reset the 10 min timmer
//     for that user if the song is again not valid"). Timers live in this tab's memory: a reload starts them over, from
//     new warnings, so the bot never strikes early.
//
// ── NEVER SILENT ────────────────────────────────────────────────────────────────────────────────────────────────────────
// A setting the bot cannot carry out — this device does not look songs up, or no source is answering — is said once in the
// log, when it changes, and in one muted line at the top of Room settings on this tab (`roomNote`, through `Rep.roomNote`,
// H6; his words: "at the top of room settings or even log only is ok, i dotn want it in the bot card"). So is the nudge to
// add a key for a source that needs one (YouTube). Without data the bot predicts nothing: no warnings, skips or strikes.
const RepGeo = (() => {
  const TICK_MS = 5000;              // a look: short enough to see a song's start inside DECIDE_MS
  const DECIDE_MS = 10000;           // decided at a song's start or not at all: the repeat sweep's window (`REPEAT_DECIDE_MS`)
  const RETRY_MS = 10 * 60 * 1000;   // a song no source answered is asked again after this, never every look
  const SETTLE_MS = 60000;           // a strike sent and its song still queued after this: it did not take, and is tried again
  const ASK = Object.freeze({ list: "room" });   // the lookup path's list: the room queue's
  let _s = null, _gen = 0;

  const _log = (m) => RepPorts.log("info", "blocked songs — " + m);
  const _plural = (n) => n + (n === 1 ? " person" : " people");

  // ── WHAT THE ROOM SETTINGS ASK OF THE BOT ────────────────────────────────────────────────────────────────────────
  function _wants(set) {
    const s = set || {};
    return { warn: s.botBlockedWarn !== false, skip: s.botBlockedSkip === true, unranked: s.repUnrankedCountries !== false,
      roads: Array.isArray(s.botBlockedRoads) ? s.botBlockedRoads : null,
      strike: s.botBlockedStrike === true, fixMs: (Number.isSafeInteger(s.botBlockedFixMs) && s.botBlockedFixMs > 0) ? s.botBlockedFixMs : null };
  }

  // ── THE ONE MUTED LINE, AND THE LOG ──────────────────────────────────────────────────────────────────────────────────
  // `why`: "off" (this device looks nothing up), "noAnswer" (no source answered the last songs asked), "keyless" (a source that
  // needs a key has none: the nudge), or null. Said in the log once per change, never per look.
  function _noteFor(why, keyless) {
    if (why === "off") return "The bot can’t tell where songs are blocked: “Look up where songs are blocked” is off on this " +
      "device, so it warns about and skips nothing.";
    if (why === "noAnswer") return "The bot can’t tell where songs are blocked: no source is answering, so songs it hasn’t looked up " +
      "yet aren’t checked.";
    if (why === "keyless") return "No " + keyless + " key on this device: the bot asks the other sources. Add one under “Where songs " +
      "are blocked” to ask " + keyless + " first.";
    return null;
  }
  function _say(s, why, keyless) {
    const note = _noteFor(why, keyless);
    if (note === s.note) return;
    s.note = note;
    _log(note ? note : "the bot can tell where songs are blocked again");
  }

  // ── LOOK: THE ROOM QUEUE, THE SONG PLAYING, AND WHAT THE SETTINGS ASK ────────────────────────────────────────────────
  // Returns a promise for the guard; the tick ignores it.
  function _look() {
    const s = _s;
    if (!s) return Promise.resolve(null);
    const w = _wants(RepPorts.settings());
    if (!w.warn && !w.skip && !w.strike) { _say(s, null); return Promise.resolve("nothing-asked"); }
    const st = RepPorts.geoStatus() || { on: false, keyless: [] };
    if (st.on !== true) { _say(s, "off"); return Promise.resolve("off"); }
    _say(s, s.noAnswer ? "noAnswer" : ((st.keyless && st.keyless.length) ? "keyless" : null), (st.keyless || [])[0]);
    // ONLY A CAUGHT-UP TAB ACTS, as the repeat sweep: a bot folding a backlog would warn about a queue that has moved on.
    if (!RepPorts.mayAuthor()) return Promise.resolve("not-live");
    const now = RepPorts.serverNow();
    if (now === null) return Promise.resolve("no-clock");
    const np = RepPorts.nowPlaying(), queued = RepPorts.queuedSongs();
    const keys = [];
    if (np && np.songKey) keys.push(np.songKey);
    for (const q of queued) for (const k of q.songKeys) if (keys.indexOf(k) < 0) keys.push(k);
    const want = keys.filter((k) => !s.answers[k] && !(typeof s.tried[k] === "number" && now - s.tried[k] < RETRY_MS));
    let asked = Promise.resolve();
    if (want.length && !s.asking) {
      s.asking = true;
      for (const k of want) s.tried[k] = now;
      asked = Promise.resolve().then(() => RepPorts.geoMany(want, now, ASK)).then((r) => {
        s.asking = false;
        if (_s !== s || !r) return;
        for (const k of Object.keys(r.answers || {})) s.answers[k] = r.answers[k];
        if (r.asked > 0) s.noAnswer = !(r.reached > 0);
      }, () => { s.asking = false; });
    }
    return asked.then(() => Promise.resolve(RepPorts.countriesLoad(s.spaceId)).catch(() => null)).then((stored) => {
      if (_s !== s) return null;
      const cc = (stored && stored.cc && typeof stored.cc === "object") ? stored.cc : {};
      return _act(s, w, now, np, queued, cc);
    });
  }

  // ── WHO A SONG IS BLOCKED FOR, AMONG THE PEOPLE PRESENT ──────────────────────────────────────────────────────────────
  function _present(s, now, cc) {
    const view = RepPorts.whoIsActive(now);
    const here = Object.create(null), bands = Object.create(null);
    for (const p of ((view && Array.isArray(view.people)) ? view.people : [])) {
      const u = p && p.userId;
      if (typeof u !== "string" || typeof cc[u] !== "string" || here[u]) continue;
      here[u] = cc[u];
      const lvl = RepPorts.levelOf(s.spaceId, s.channels, u);
      bands[u] = RepPorts.rankAtLeast(lvl, "vip") ? "vip" : (RepPorts.rankAtLeast(lvl, "guest") ? "guest" : null);
    }
    return { cc: here, bands: bands };
  }
  function _predict(s, songKey, here) {
    const geo = s.answers[songKey];
    if (!geo) return null;
    const v = RepPorts.blockedFor(geo, here.cc);
    if (!v) return null;
    return RepRules.geoCount(v.people, here.bands);
  }

  function _act(s, w, now, np, queued, cc) {
    const here = _present(s, now, cc);
    const done = [];
    if (w.skip && np && np.pi && np.songKey) done.push(_maybeSkip(s, w, now, np, here));
    _settleStrikes(s, now, np, queued);
    if (w.warn || w.strike) done.push(_warnings(s, w, queued, here));
    if (w.strike && w.fixMs) done.push(_maybeStrike(s, w, now, queued, here));
    return Promise.all(done).then(() => "looked");
  }

  // ── THE SKIP AT A SONG'S START ───────────────────────────────────────────────────────────────────────────────────────
  // DECIDED AT THE START OR NOT AT ALL (the repeat sweep's rule): within `DECIDE_MS` of the song's start and with its answer
  // held, the first look decides; a song whose answer arrives later, or a bot that came online mid-song, lets it play. One act
  // per playing, kept by its play instance.
  function _maybeSkip(s, w, now, np, here) {
    if (s.decided === np.pi) return Promise.resolve();
    const late = !(typeof np.startedAt === "number") || now - np.startedAt > DECIDE_MS;
    const c = _predict(s, np.songKey, here);
    if (!c) {
      if (late) s.decided = np.pi;          // no answer by the end of the window: it plays
      return Promise.resolve();
    }
    if (late) { s.decided = np.pi; return Promise.resolve(); }
    s.decided = np.pi;
    if (!(c.ranked.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.guests, c.vips))) return Promise.resolve();
    const name = RepPorts.songName(np.songKey), codes = c.codes.ranked.join(", ");
    _log("skipping " + np.songKey + ": blocked for " + _plural(c.ranked.length) + " ranked here (" + codes + "), the bot's minimums met");
    return RepPorts.skip("region").then((r) => {
      if (!r || !r.ok) {
        // A LOST RACE IS NOT A FAILURE (the repeat sweep's words): the playing has moved on, so there is nothing to skip.
        _log("the skip of " + np.songKey + " did not take — " + ((r && r.reason) || "no reason given") + "; the playing has moved on either way");
        return;
      }
      return _line(s, "Skipped " + name + " — it is blocked for " + _plural(c.ranked.length) + " here (" + codes + ").");
    }, () => {});
  }

  // ── THE WARNINGS ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // Once per (DJ, song) while the song is queued: a song that leaves the queue and comes back is warned about again. A
  // warning that did not arrive is not marked, so the next look tries again (the AFK warning's rule). WHAT IT SAID IS KEPT
  // (`"strike"` or `"plain"`): a song warned about before the bot would strike it is warned again when it would, since only a
  // delivered warning saying so starts its timer; and with warnings off, the bot warns only the songs it will strike. After a
  // strike (`s.rewarn`), the DJ's next song, if it too will be struck, is warned again and its timer starts over.
  const _minutes = (ms) => { const m = Math.max(1, Math.floor(ms / 60000)); return m + (m === 1 ? " minute" : " minutes"); };
  function _warnings(s, w, queued, here) {
    const live = Object.create(null), sends = [];
    for (const q of queued) {
      const again = s.rewarn[q.dj] === true;
      delete s.rewarn[q.dj];
      q.songKeys.forEach((k, at) => {
        const id = q.dj + "\n" + k;
        live[id] = true;
        const said = s.warned[id];
        if (said === "strike" && !(again && at === 0)) return;
        const c = _predict(s, k, here);
        if (!c) return;
        const met = c.ranked.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.guests, c.vips);
        const strikes = !!(w.strike && w.fixMs && met);
        if (said && !strikes) return;                       // warned already, and nothing new to say
        if (!w.warn && !strikes) return;                    // warnings off: only the songs it will strike
        const people = w.unranked ? c.all : c.ranked;
        if (!people.length) return;
        const will = strikes ? "strike" : ((w.skip && met) ? "skip" : "none");
        const codes = w.unranked ? c.codes.all : c.codes.ranked;
        s.warned[id] = strikes ? "strike" : "plain";
        if (strikes) delete s.strikes[id];                  // its timer starts at THIS warning's delivery, or not at all
        const text = q.dj + " — " + RepPorts.songName(k) + " is blocked for " + _plural(people.length) + " here (" + codes.join(", ") + "). " +
          (will === "strike" ? "The bot will remove it when you’re next to play unless you change it within " + _minutes(w.fixMs) +
            ((w.skip && met) ? "; if it starts before then, the bot will skip it." : ".")
            : (will === "skip" ? "The bot will skip it when it starts." : "The bot won’t act on it.")) +
          (w.unranked ? "" : " Unranked people’s countries aren’t counted.");
        _log("warned " + q.dj + " about " + k + ": " + _plural(people.length) + " (" + codes.join(", ") + "); " +
          (will === "strike" ? "the bot will strike it after " + _minutes(w.fixMs) : (will === "skip" ? "the bot will skip it" : "the bot won't act")));
        sends.push(_line(s, text).then((ok) => {
          if (_s !== s) return;
          if (!ok) { delete s.warned[id]; return; }
          if (strikes) { const t = RepPorts.serverNow(); s.strikes[id] = (typeof t === "number") ? t : null; }
        }));
      });
    }
    for (const id of Object.keys(s.warned)) if (!live[id]) delete s.warned[id];
    return Promise.all(sends);
  }

  // ── THE STRIKE, WHEN THE DJ IS NEXT TO PLAY ──────────────────────────────────────────────────────────────────────────
  // The head of the rotation is the DJ who plays next (the reducer moves the playing DJ to the back as their song starts),
  // and their first song is the one that would play. Struck when its delivered warning's timer has run the whole fix time and
  // the minimums are still met NOW, by the people here now (the supervisor's default: re-checked at strike time). Sent as the
  // moderator's strike is (`RepPorts.strike` → `Queue.strike`); only a caught-up tab gets here (`_look`).
  function _maybeStrike(s, w, now, queued, here) {
    const head = queued[0];
    if (!head || !head.songKeys.length) return Promise.resolve();
    const k = head.songKeys[0], id = head.dj + "\n" + k;
    const st = s.striking[id];
    if (st && st !== "failed") return Promise.resolve();             // sent: waiting to see it go
    const t = s.strikes[id];
    if (typeof t !== "number" || now - t < w.fixMs) return Promise.resolve();
    const c = _predict(s, k, here);
    if (!(c && c.ranked.length > 0 && w.roads && RepPorts.roadTableMet(w.roads, c.guests, c.vips))) return Promise.resolve();
    const codes = c.codes.ranked.join(", ");
    s.striking[id] = { at: now, n: c.ranked.length, codes: codes };
    _log("striking " + k + " from " + head.dj + ": blocked for " + _plural(c.ranked.length) + " ranked here (" + codes + "), the fix time over");
    return RepPorts.strike(head.dj, k).then((sent) => {
      if (_s !== s || sent) return;
      s.striking[id] = "failed";
      _log("the strike of " + k + " from " + head.dj + " did not go out; trying again at the next look");
    }, () => { if (_s === s) s.striking[id] = "failed"; });
  }
  // A STRIKE IS SAID ONCE IT HAS HAPPENED (the fortieth signature: a report names outcomes). A struck song gone from the
  // queue, and not playing, is said in one line; one that started playing first lost the race (the skip, if on, applies);
  // one still queued `SETTLE_MS` after its strike was sent did not take, and is tried again. Timers and marks of songs no
  // longer queued go.
  function _settleStrikes(s, now, np, queued) {
    const live = Object.create(null);
    for (const q of queued) for (const k of q.songKeys) live[q.dj + "\n" + k] = true;
    for (const id of Object.keys(s.striking)) {
      const st = s.striking[id];
      if (live[id]) {
        if (st !== "failed" && now - st.at > SETTLE_MS) { s.striking[id] = "failed"; _log("the strike of " + id.split("\n")[1] + " did not take; trying again"); }
        continue;
      }
      delete s.striking[id];
      if (st === "failed") continue;
      const dj = id.split("\n")[0], k = id.split("\n")[1];
      if (np && np.dj === dj && np.songKey === k) { _log("the strike of " + k + " lost the race: it started first"); continue; }
      s.rewarn[dj] = true;
      _line(s, dj + " — " + RepPorts.songName(k) + " was removed from the queue: it is blocked for " + _plural(st.n) + " here (" + st.codes + ").");
    }
    for (const id of Object.keys(s.strikes)) if (!live[id]) delete s.strikes[id];
  }

  // ── ONE LINE IN THE MAIN CHAT ────────────────────────────────────────────────────────────────────────────────────────
  // The room's main tier, resolved when sent, never the tier this tab is looking at (the repeat sweep's and the AFK
  // warning's rule: a tab pointed elsewhere once must not move every line after it). Answers whether it was delivered.
  function _line(s, text) {
    const t = RepPorts.chatTiers();
    const mainId = (t && typeof t.mainId === "string") ? t.mainId : null;
    if (!mainId) return Promise.resolve(false);
    return Promise.resolve().then(() => RepPorts.sendChat(mainId, text)).then((r) => !(r && r.ok === false), () => false);
  }

  // ── LIFECYCLE ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function enter(ctx) {
    const c = ctx || {};
    if (!RepPorts.actingAsBot() || typeof c.spaceId !== "string" || !c.channels) {
      if (_s) _stop("this tab is not the room's bot here");
      return;
    }
    if (_s && _s.spaceId === c.spaceId) { _s.channels = c.channels; return; }   // a rank change in the same room: keep going
    if (_s) _stop("another room");
    _start(c.spaceId, c.channels);
  }
  function leave(why) { if (_s) _stop(why || "the tab left the room"); }
  function _start(spaceId, channels) {
    const s = { gen: ++_gen, spaceId: spaceId, channels: channels, tick: null, asking: false, noAnswer: false, note: null,
      answers: Object.create(null), tried: Object.create(null), warned: Object.create(null), decided: null,
      strikes: Object.create(null), striking: Object.create(null), rewarn: Object.create(null) };
    _s = s;
    s.tick = setInterval(() => { if (_s === s) _look(); }, TICK_MS);
    _log("watching the room queue");
    _look();
  }
  function _stop(why) {
    const s = _s;
    if (!s) return;
    _s = null;
    if (s.tick) { clearInterval(s.tick); s.tick = null; }
    _log("stopped — " + why);
  }

  // H6: the one muted line for Room settings on this tab, or null.
  function roomNote() { return _s ? _s.note : null; }

  // For the guard: a look, awaited, and the running session's state as a plain copy.
  function _lookForTest() { return _look(); }
  function _stateForTest() {
    const s = _s;
    if (!s) return null;
    return { spaceId: s.spaceId, note: s.note, noAnswer: s.noAnswer, asking: s.asking, decided: s.decided,
      answers: Object.assign({}, s.answers), tried: Object.assign({}, s.tried), warned: Object.keys(s.warned).sort(), tick: !!s.tick,
      strikes: Object.assign({}, s.strikes), striking: Object.keys(s.striking).sort() };
  }

  return { enter, leave, roomNote, TICK_MS, DECIDE_MS, RETRY_MS, SETTLE_MS, _lookForTest, _stateForTest };
})();
