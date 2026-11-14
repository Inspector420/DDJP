// features/playback.js
// Reads now-playing from the stream and drives the rotation forward. When the current song ends BY THE ROOM'S CLOCK (its
// agreed length plus the wait, `advance.endsAt`; the owner's decision, `ddjp_711`), or nothing is playing but someone is
// ready, it emits ddjp.dj.play with p = the current play-instance. Any present client may emit; the advance lock in the
// reducer keeps the first and drops the rest, so a rank turn + re-check is enough to avoid a thundering herd. A player's
// end never decides: it is a wake-up that runs the clock check, and it tells this device whether to reload once (an early
// end) or hold quietly (`notifyEnded`).
// Depends on: StreamManager, MatrixBridge, Logger

const Playback = (() => {
  // THE FIRST 15 s OF A SONG CARRY NO ELAPSED TIME in what this module pushes (a song still loading is not seeked by the
  // room player's 10 s check). It holds back no end: the clock end and the ceiling are checked before it.
  const GRACE_MS = 15000;
  const TICK_MS = 2000;
  // AN END IS EARLY only while the room's elapsed time is below the agreed length minus this, or the room's `graceMs` if
  // larger (`notifyEnded`): a player that reaches its own end within it has ended normally and holds quietly.
  const EARLY_MARGIN_MS = 2000;
  // THE LENGTH, DECLARED AGAIN while the room has none (`ddjp_711`): at most this often per play, still one per play.
  const LEN_RETRY_MS = 5000;
  // FALLBACK jitter only. Every advance now takes its rank slot through the one shared
  // stagger (Capabilities.staggerMs); this value is used solely if reading the settings or the
  // rank throws, so the backstop is never blocked by a lookup failure.
  const JITTER_MS = 1200;
  // MY CHANNEL AUTHORITY, injected by room.js on entry and on every rank change — the same
  // pattern MediaLength and MediaBlocked already use. This module used to call
  // MatrixBridge.getMyRank() with NO ARGUMENTS; that function needs the room's channels map and
  // returns 0 without it, so EVERY client (the owner included) computed the weakest stagger slot
  // and the whole turn-taking design was inert on the advance path.
  let _injectedRank = null;
  function setMyRank(r) { if (typeof r === "number") _injectedRank = r; }
  function _myRank() { return _injectedRank != null ? _injectedRank : 0; }
  const MAX_FAST_RETRIES = 5;     // after this many advance attempts with no real song landing, slow down
  const BACKOFF_MS = 15000;       // cooldown between attempts once backing off

  let eventsChannel = null;
  let loop = null;
  let _onState = null;
  let _advancing = false;
  let _advanceTimer = null;      // the advance waiting its jitter (J83: the leave clears it)
  let _emptyAdvanceStreak = 0;    // consecutive advances that resolved to "no real song" — defensive backoff
  let _lastAdvanceAttempt = 0;
  const knownDuration = {};  // songKey -> seconds (player-supplied, never in events)
  const _subs = [];

  // ── EVERY EVENT THAT CAN MOVE THE ROOM ─────────────────────────────────────────────────────
  // `ddjp.media.skip` — the availability escape — was ABSENT, and it advances the room exactly
  // like a play or a skip does. Without it this module never re-notified, so the room genuinely
  // moved to the next song while the player and the now-playing panel kept showing the old one
  // until some unrelated event happened along. From the outside that is indistinguishable from
  // "the song did not advance", which is the complaint that led here. MediaBlocked had already
  // hit the same omission on its own subscription list and fixed it there.
  const TYPES = [
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip", "ddjp.dj.join", "ddjp.dj.declare",
    "ddjp.dj.leave", "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.reset"
  ];

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
    if (loop) clearInterval(loop);
    loop = null;
  }

  // Wiring only: subscribe to stream changes and remember the channel, but do
  // NOT start the live tick loop yet. Room.join calls this BEFORE replay so the
  // loop can't fire _maybeAdvance against empty pre-replay state.
  function initWiring(channel) {
    _cleanup();
    eventsChannel = channel;
    // PER-ROOM STATE DIES WITH THE ROOM. These are only dedupe keys and play-instance ids, and
    // instance ids are globally unique so a stale one could never match — but "per-room state that
    // survives a room change is its own bug class" is a rule in this tree precisely because that
    // reasoning is right until the day it is not.
    _endedPi = null; _loggedSongPi = null; _lastAdvanceNote = ""; _declaredLenPi = null; _reloadedPi = null; _lenRetry = null;
    const notify = () => _notifyUI();
    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }
    // EVERY ARRIVING MESSAGE ARMS THE END (`ddjp_711`, as the bot does since J68): a length declared, a song started, an
    // answer — each sets ONE timer for the song's end moment, from a network task, so a background tab whose interval is
    // held back still ends the song on time.
    const arm = () => _armEnd();
    StreamManager.on("*", arm); _subs.push(["*", arm]);
    Logger.debug("Playback: wired on " + channel);
  }

  // Begin the live tick loop. Called only after history is in place (after
  // replay for join, immediately after wiring for a fresh create).
  function start() {
    if (loop) clearInterval(loop);
    loop = setInterval(_tick, TICK_MS);
    _started = true;
    _armEnd(false);   // a moment ahead is armed; one already due is the first tick's
    Logger.debug("Playback: started ticking");
  }

  // Convenience: wire + start in one call. Safe for callers that have nothing
  // to replay between the two phases (and for existing tests).
  function init(channel) {
    initWiring(channel);
    start();
  }

  // ── STOPPING IS EVERY TIMER, NOT ONLY THE TICK (J83, the owner's ruling 18) ──────────────────────────────────────────────
  // The room's leave calls `stop` then `destroy`. Before J83 nothing called either, and the tick alone is not the room's
  // playback: a declaration waiting its rank slot and an advance waiting its jitter are timers too, and each re-reads the
  // fold when it fires — after a leave, the next room's. Both are cleared here, and the advance latch with them.
  function stop() {
    if (loop) clearInterval(loop);
    loop = null;
    _started = false;
    if (_endTimer) { try { clearTimeout(_endTimer); } catch (e) {} _endTimer = null; }
    for (const k of Object.keys(_staggerTimers)) { try { clearTimeout(_staggerTimers[k]); } catch (e) {} delete _staggerTimers[k]; }
    if (_advanceTimer) { try { clearTimeout(_advanceTimer); } catch (e) {} _advanceTimer = null; }
    _advancing = false;
    _asked = null;
  }
  function destroy() { stop(); _cleanup(); eventsChannel = null; }

  // Registering a listener immediately pushes the CURRENT now-playing state,
  // not just future changes. Without this, a joiner who replays history before
  // the UI subscribes (see Room.join) never gets told what's already playing —
  // the player sits at local 0:00 forever, because nothing ever calls
  // loadSong for a song that was already playing before they joined.
  function onStateChange(fn) {
    _onState = fn;
    if (_onState) _onState(_attach(StreamManager.getState().nowPlaying));
  }
  // knownDuration is MY OWN player's measurement — the LOCAL measured duration. It ends NO song (`ddjp_711`: only the room's
  // agreed length does, through the clock end; the safety net that ended a song at a device's private length is gone). It
  // is what this device DECLARES, and what MediaLength keeps (features/medialength.js).
  function setDuration(songKey, d) {
    knownDuration[songKey] = d;
    try {
      if (typeof MediaLength !== "undefined" && MediaLength.recordLocalMeasured) {
        MediaLength.recordLocalMeasured(songKey, d);
      }
    } catch (e) {}
    _declareLength(songKey, d);
  }
  // THE DECLARATION, FOR THIS PLAYING. From the player's "playing" (`setDuration`) and, while the room agrees no length,
  // again from the tick (`_retryLength`) — one declaration per person per playing either way.
  function _declareLength(songKey, d) {
    // DECLARE my measured length for THIS playing (Step 7), but only if it would change the
    // room's agreed value — declare-only-if-you-disagree, so a song everyone measures the same
    // costs a single message. Scoped to the play instance (pi), never the video, so it can't be
    // stale from an earlier playing. My own copy still governs my own player; this only feeds the
    // shared decision. Authored through the shared stagger by rank so the room doesn't burst.
    //
    // ── THE NUMBER IS MEASURED WHEN IT IS SENT, NOT WHEN THE SONG STARTED ────────────────────
    // WHAT IS PROVEN, AND WHAT IS NOT — because the difference matters to anyone reading this.
    //
    // PROVEN, by folding a log through the reducer: a single wrong-HIGH length at the strongest
    // rank that spoke pins the advance gate for EVERY client until the maxLen ceiling. The rule
    // that carries it — authority cascades, majority within a rank, ties fall to the rank below —
    // is not at fault; it faithfully carries whatever it is given. And because the reducer accepts
    // ONE length per person per playing, a wrong one can never be taken back.
    //
    // NOT PROVEN, and stated as the hazard it is rather than as a diagnosis: that `d` above is
    // ever actually wrong. It arrives from the player's PLAYING event, which also fires during a
    // song SWAP, and the concern is that YouTube may report the new video id (we just handed it
    // over) while getDuration() still describes the previous song — "new id, old length", where
    // the id check passes because the id really is right. That is a plausible reading of the API
    // and it has NOT been observed in a live room; no implausible declaration appears in any
    // capture taken so far.
    //
    // The change is therefore DEFENSIVE, and cheap: a value captured before a wait is stale by
    // however long the wait lasted, whatever the reason, so we do not carry one. The provider is
    // asked at FIRE time and its answer is what travels — exactly as loadSong asks for the
    // playhead rather than carrying a number through the wait. If the hazard is real this closes
    // it; if it is not, the cost is one extra function call per song.
    try {
      const s = StreamManager.getState();
      const np = s.nowPlaying;
      if (!np || !np.song || np.song.songKey !== songKey || !eventsChannel) return;
      if (typeof d !== "number" || !(d > 0)) return;
      // ONE DECLARATION PER PLAYING, AND THE STAGGER KEY IS NOT ENOUGH ON ITS OWN. PLAYING fires
      // again on every unpause, and the stagger key is freed the moment its timer runs — so a
      // second pass could arm a second declaration for the same song. The reducer accepts one per
      // person per playing and would refuse it: a message spent on an event that is then illegal,
      // and therefore unprotected. Remembered here rather than left to the timer's bookkeeping.
      if (_declaredLenPi === np.pi) return;
      _staggeredEmit("len:" + np.pi, () => {
        const s2 = StreamManager.getState();
        if (!s2.nowPlaying || s2.nowPlaying.pi !== np.pi) return;   // song moved on — never mind
        const vid = s2.nowPlaying.song ? s2.nowPlaying.song.songKey : null;

        // ASK AGAIN, NOW. A refusal here is SILENCE, not a guess: the room falls back to the
        // grace floor, which costs a few seconds and is recoverable, where a wrong number costs
        // the ceiling and cannot be withdrawn.
        const r = _confirmReading(vid);
        if (!r.ok) {
          Logger.info("Playback: LEN not declared for pi=" + np.pi + " — " + r.why +
            (r.saw ? " (player is on " + r.saw + ", room says " + vid + ")" : "") +
            " — the room falls back to its grace floor");
          return;
        }
        const mine = r.sec;

        // A REVISED READING, CAUGHT AND NAMED. Warned rather than silently corrected precisely
        // because the hazard above is unconfirmed: if the player really does hand back a previous
        // song's length mid-swap, this line is the evidence, and if it never fires that is
        // evidence too. Either way an operator can watch it rather than infer it from a countdown.
        const captured = knownDurationFor(vid);
        if (typeof captured === "number" && Math.round(captured) !== mine) {
          Logger.warn("Playback: LEN player revised " + vid + " from " + Math.round(captured) +
            "s (read at song start) to " + mine + "s (read now) — declaring the LATER value. The " +
            "earlier one was almost certainly the previous song's length, read mid-swap");
          knownDuration[vid] = mine;                               // the countdown and the 10 s check's limit
          try {
            if (typeof MediaLength !== "undefined" && MediaLength.recordLocalMeasured) {
              MediaLength.recordLocalMeasured(vid, mine);
            }
          } catch (e) {}
        }

        // THE BAIL-OUT THAT MAKES THE STAGGER WORTH ANYTHING. While we waited our slot,
        // peers may have declared and the room may already agree with us. Re-read the agreed
        // value and stay silent if it now matches — otherwise "declare only if you disagree"
        // never fires at all, because at song start nothing is declared and every sighted
        // client sees agreed === null and posts. That turned one message per song into one
        // message PER SIGHTED CLIENT per song.
        const a2 = s2.advance;
        if (a2 && a2.pi === np.pi && typeof a2.gateLenSec === "number" && a2.gateLenSec === mine) {
          Logger.info("Playback: LEN not declared for pi=" + np.pi + " — the room already agrees " +
            "at " + mine + "s");
          return;
        }
        _declaredLenPi = np.pi;
        Logger.info("Playback: LEN declaring " + mine + "s for pi=" + np.pi + " vid=" + vid +
          " (room currently agrees " + (a2 && a2.gateLenSec != null ? a2.gateLenSec + "s" : "nothing") + ")");
        // .catch: sendEvent rejects rather than throwing, and this one had no handler at all —
        // a failed length report became an unhandled rejection.
        // SENT ONCE MORE IF IT WAS LOST AND THE ROOM STILL AGREES NOTHING (J66): the bot ends songs at
        // the agreed length, so a report lost while it reloaded would leave the song to the ceiling.
        const lenPi = np.pi;
        Promise.resolve(MatrixBridge.sendEvent(eventsChannel, "ddjp.play.len", { pi: lenPi, sec: mine }))
          .then((sent) => {
            if (!sent || !sent.eventId || typeof MatrixBridge.awaitAnswer !== "function") return;
            return Promise.resolve(MatrixBridge.awaitAnswer(sent.eventId)).then((ans) => {
              if (!ans || ans.status !== "none") return;
              const s3 = StreamManager.getState();
              const still = s3.nowPlaying && s3.nowPlaying.pi === lenPi;
              const agreed = s3.advance && s3.advance.pi === lenPi && typeof s3.advance.gateLenSec === "number";
              if (still && !agreed) return MatrixBridge.sendEvent(eventsChannel, "ddjp.play.len", { pi: lenPi, sec: mine });
            });
          })
          .catch((e) => Logger.warn("Playback: length report failed: " + (e && e.message)));
      });
    } catch (e) {}
  }

  // ── THE PLAYER, ASKED AT FIRE TIME ─────────────────────────────────────────────────────────
  // A PROVIDER, NOT A VALUE — the same shape and the same reason as loadSong's playhead: a
  // number handed over before a wait is stale by however long the wait lasted. The UI supplies
  // this; nothing here reaches for the player, which stays on ui/'s side of the boundary.
  //
  // Returns { songKey, seconds } — what the player says it is playing and how long that is, read
  // together, right now.
  let _durationProvider = null;
  let _declaredLenPi = null;        // the playing we have already declared a length for
  function setDurationProvider(fn) { _durationProvider = (typeof fn === "function") ? fn : null; }

  // My own player's measured length for a video, or null. Exposed because it drives the
  // countdown and the player's 10 s check (`ui/player.js` `_pastItsEnd`), and a correction to it has to be observable.
  // It ends no song: since `ddjp_711` the room's clock does.
  function knownDurationFor(songKey) {
    return (songKey && knownDuration[songKey] != null) ? knownDuration[songKey] : null;
  }

  // NAMED REFUSALS, not a bare null. "the player cannot answer", "the player is on a different
  // song" and "the player says zero" are three different situations and only some are worth
  // retrying; collapsing them is how a missing seam comes to look like a bad measurement.
  //
  // ── `!expectedSongKey ||` IS DOMINATED TODAY, AND A ROW NOW WATCHES IT (J49) ───────────────
  // Do not delete it. Dropped, it once left EVERY guard green (123 of them, at J49 — a dated record), and so did dropping
  // the `no-reading` line above it: with the shipped provider a null reading is refused by both and needed by neither.
  //
  // WHY IT IS REDUNDANT, AND IT IS NOT A FACT ABOUT THIS FILE. A redundancy is a statement about the routes that exist.
  // The only duration provider is the room player's, which asks the song players' plug (`ui/songplayer.js` `reading()`,
  // J29 step 2): it returns `null` WHOLESALE whenever no key names what the player shows, never an object with a falsy
  // id (`check-duration-provider` executes it, through the plug, against every player shape). So `r` never arrives in the
  // shape this clause refuses, and we return at `no-reading` one line above it.
  //
  // WHAT ENDS THAT: a player whose reading comes back as `{ songKey: null, ... }` instead of `null`. From that moment this
  // clause is the only thing between an unconfirmable reading and a `ddjp.play.len` the reducer accepts once per person
  // per playing and will never let you withdraw. The room's own id is ALREADY falsy on a reachable route — a checkpoint
  // seed builds `song: { songKey: n.song.songKey }` with no type check — so a truthy song the room cannot name reaches the
  // call site above as `vid === null`.
  //
  // AND THE PAIRING IS MATCHING ABSENCES, not any absence: room id `null` against a reading of `{songKey: null}`, and room
  // id absent against a reading whose key is absent. The cross pairs change nothing, because `undefined !== null`.
  // `check-length-freshness` PART E is the row on this clause (`ddjp_706`): built on those two pairings, asserting its own
  // premise that the ids collide, red when the clause is dropped. With the provider's own guard (`ddjp_415`), both of
  // J49's preconditions are met.
  // `docs/main/09-roadmap.md` J49 · `docs/roles.md` §9 · `docs/paths.md` §9 entry 13.
  function _confirmReading(expectedSongKey) {
    if (typeof _durationProvider !== "function") return { ok: false, why: "no-provider" };
    let r = null;
    try { r = _durationProvider(); } catch (e) { return { ok: false, why: "provider-threw" }; }
    if (!r || typeof r !== "object") return { ok: false, why: "no-reading" };
    if (!expectedSongKey || r.songKey !== expectedSongKey) {
      return { ok: false, why: "different-song", saw: r.songKey || null };
    }
    const sec = (typeof r.seconds === "number" && isFinite(r.seconds) && r.seconds > 0)
      ? Math.round(r.seconds) : null;
    if (sec === null) return { ok: false, why: "no-duration" };
    return { ok: true, sec: sec };
  }

  // NO BOT RUNG HERE (the owner's decision, `ddjp_628`): the song acts — the advance, the length declaration — take turns by
  // rank alone, both owner-tier accounts at slot 0. The bot's rung reads rank 99, not whether the bot watches, so in a shared room
  // whose bot does not watch videos every song change waited a step for nothing. Only the seal and the proactive vouch pass
  // keep it (`consensus/trust-cascade.md` §9.1).

  // Fire `fn` after this client's rank slot (the ONE shared stagger), deduped by key so a
  // declaration is authored at most once per playing. Re-checks at fire time inside `fn`.
  const _staggerTimers = Object.create(null);
  function _staggeredEmit(key, fn) {
    if (_staggerTimers[key]) return;
    let delay = 0;
    try {
      const st = StreamManager.getState().settings || {};
      // ── A SETTLING FLOOR, EVEN FOR RANK ZERO ─────────────────────────────────────────────
      // The slot answers "whose turn is it", and for the owner the honest answer is ZERO — the
      // owner goes first, by design. But a job whose whole value is the RE-READ it performs
      // before firing needs some time to have passed for that re-read to observe anything: at
      // delay 0 it runs in the same tick as the capture and can never differ. So the client with
      // the most authority over the room's agreed length had the least chance of being right
      // about it — which is the shape that would let a single bad reading pin everybody's gate.
      //
      // Checkpoint reached this conclusion first and applied minDelayMs for the same reason; the
      // advance path never got it. Derived from the room's own turn step rather than pinned, so
      // it moves with the dial every other wait already moves with.
      //
      // HANDED TO THE ONE FORMULA, not applied here (`ddjp_627`): with no rung it gives `max(floor, slot)`, as this site did.
      const step = (typeof st.vouchJitter === "number" && isFinite(st.vouchJitter)) ? st.vouchJitter : 0;
      const floor = Math.floor(step / 2);
      delay = Capabilities.staggerMs(_myRank(), st.vouchJitter, null, null, floor);   // the song acts take no rung (the owner's decision, `ddjp_628`)
    } catch (e) {}
    _staggerTimers[key] = setTimeout(() => {
      delete _staggerTimers[key];
      try { fn(); } catch (e) { Logger.warn("declaration emit: " + e.message); }
    }, delay);
  }

  // The UI/countdown path. Preference order:
  //   1. my OWN measurement (knownDuration) — most accurate for me, and it's what my player runs on;
  //   2. the reducer's CONSENSUS display length (advance.displayLenSec) — the cascade winner, so a
  //      viewer who CANNOT load the video still gets a countdown from what the room measured;
  //   3. MediaLength's cache (older per-video reports) — a last resort for a video not currently
  //      playing (e.g. a queue preview), where there is no `advance` for it.
  // This only affects what the UI SHOWS — the advance gate and the clock end read the reducer's gateLen.
  function _displayDurationFor(songKey) {
    if (knownDuration[songKey]) return knownDuration[songKey];
    try {
      const s = StreamManager.getState();
      const np = s.nowPlaying, adv = s.advance;
      if (np && np.song && np.song.songKey === songKey && adv && adv.pi === np.pi
          && typeof adv.displayLenSec === "number" && adv.displayLenSec > 0) {
        return adv.displayLenSec;
      }
    } catch (e) {}
    try {
      if (typeof MediaLength !== "undefined" && MediaLength.displayDuration) {
        const shared = MediaLength.displayDuration(songKey);
        if (shared) return shared;
      }
    } catch (e) {}
    return null;
  }

  // ── A FINISHED SONG STAYS FINISHED ─────────────────────────────────────────────────────────
  // `ended` used to ride on the ONE state push made at the moment the iframe reported it, and the
  // ordinary progress tick two seconds later carried no such flag while the song was exactly as
  // over as before. The view believed the second push, tore down everything the first had set up,
  // reloaded the song it had just stopped, and did it again on the next tick — for as long as the
  // room took to advance.
  //
  // The fault was asking each push to remember. The FACT belongs to the play instance: this song
  // ended, and that is true until a different instance replaces it. Recorded once here and
  // stamped onto every push about that instance, so the view is handed something that stops
  // changing its mind.
  //
  // ONLY THIS DEVICE'S PLAYER ENDING SETS IT (`notifyEnded`: a normal end, or a second early one). The room's clock does
  // not: a screen that started late is still playing when the room's end passes, and a false end greys out Skip and shows
  // "nothing playing" over music still going; the room's advance replaces the play moments later.
  let _endedPi = null;
  function _attach(np) {
    if (!np) return np;
    const out = (np.pi && np.pi === _endedPi) ? Object.assign({}, np, { ended: true }) : np;
    if (out.song) {
      const dd = _displayDurationFor(out.song.songKey);
      if (dd) return Object.assign({}, out, { duration: dd });
    }
    return out;
  }
  // NOT EXPOSED. An accessor for this was added and then read by nothing: the view learns a song
  // has finished from `ended` on the state push, which is the same fact arriving by the route it
  // already uses. A second way to ask is a second copy of the answer, free to disagree.

  // Server-time elapsed seconds for a now-playing. Both ends are server-time: startedAt is
  // the play event's shared server ts, and "now" comes from ServerClock (the same server
  // clock, reconstructed locally). So every client computes the SAME elapsed, by construction
  // — no broadcasting, no drift beacon. Falls back to the raw local clock only until the
  // ServerClock has seen its first event (degrades to old behavior, never worse).
  // Timing-only: feeds the ceiling and countdown, NEVER picks a song.
  function _elapsedSec(np) {
    if (!np || typeof np.startedAt !== "number") return 0;
    try {
      if (typeof ServerClock !== "undefined" && ServerClock.elapsedSince) {
        return ServerClock.elapsedSince(np.startedAt) / 1000;
      }
    } catch (e) {}
    // fallback: only until ServerClock has observed its first event (see the note above). Marked
    // on the line because check-playhead scans for a server stamp minus a local clock, and an
    // exemption inferred from prose a few lines up is not an exemption anyone can rely on.
    return Math.max(0, (Date.now() - np.startedAt) / 1000);   // fallback: only until ServerClock has an offset
  }
  // server-time "now" in ms (for the clock end, the ceiling and the gate). Falls back to local.
  function _nowMs() {
    try { if (typeof ServerClock !== "undefined" && ServerClock.serverNow) return ServerClock.serverNow(); }
    catch (e) {}
    return Date.now();
  }
  // ══ THE DIAGNOSTIC TRAIL ═══════════════════════════════════════════════════════════════════
  // Two lines that between them answer "why is this song not moving on", which previously could
  // only be inferred from a countdown looking wrong. Both are INFO, both are one line, and both
  // are deduped so a 2-second tick cannot flood the log.
  //
  //   SONG    once per play instance: what is playing, under whose authority, what the room has
  //           agreed its length is, and when the gate therefore opens.
  //   ADVANCE once per (instance, reason): why this client did or did not author the next play.
  //
  // The gate is the thing worth seeing. It is derived from the room's agreed length, so a single
  // bad declaration shows up here as a gate that opens minutes after the song actually ends —
  // and every client's log says the same thing, which is how you tell a room-wide refusal from
  // one client misbehaving.
  let _loggedSongPi = null;
  let _lastAdvanceNote = "";
  function _rankLabel(r) {
    try { if (typeof Capabilities !== "undefined" && Capabilities.rankNameOf) return Capabilities.rankNameOf(r); }
    catch (e) {}
    return String(r);
  }
  function _logSong(np) {
    if (!np || !np.pi || np.pi === _loggedSongPi) return;
    _loggedSongPi = np.pi;
    _lastAdvanceNote = "";
    try {
      const s = StreamManager.getState();
      const adv = s.advance;
      const started = np.startedAt || 0;
      const rel = (t) => (typeof t === "number" && started ? ("+" + Math.round((t - started) / 1000) + "s") : "?");
      Logger.info("Playback: SONG pi=" + np.pi +
        " vid=" + (np.song ? np.song.songKey : "none") +
        " dj=" + (np.dj || "?") +
        " startedAt=" + started +
        " | agreedLen=" + (adv && adv.gateLenSec != null ? adv.gateLenSec + "s" : "none yet") +
        " gateOpens=" + (adv ? rel(adv.earliestAt) : "?") +
        " ceiling=" + (adv ? rel(adv.ceilingAt) : "?") +
        " | me=" + _rankLabel(_myRank()) + " slot=" + _mySlotMs() + "ms" +
        " blocked=" + (adv ? adv.blockedGuestPlus + "/g " + adv.blockedVipPlus + "/vip" : "?") +
        (adv && adv.skipWarranted ? " SKIP-WARRANTED" : ""));
    } catch (e) {}
  }
  // What this client's turn costs it, reported rather than left to be worked out from the ladder.
  // In a freshly created room only owner and uncategorized channels exist, so almost everybody is
  // at the bottom rung and waits the full ladder before even trying — worth being able to see.
  function _mySlotMs() {
    try {
      const st = StreamManager.getState().settings || {};
      return Capabilities.staggerMs(_myRank(), st.vouchJitter, () => 0);
    } catch (e) { return -1; }
  }
  // Deduped per (instance, reason): the advance path is retried every tick, so an undeduped line
  // would print several times a second for as long as a hold lasts and drown everything else.
  function _noteAdvance(pi, note) {
    const key = String(pi) + "|" + note;
    if (key === _lastAdvanceNote) return;
    _lastAdvanceNote = key;
    Logger.info("Playback: ADVANCE pi=" + pi + " — " + note);
  }

  function _notifyUI() {
    const np = StreamManager.getState().nowPlaying;
    _logSong(np);
    if (_onState) _onState(_attach(np));
  }

  // ── THE HOLD, AND WHY IT IS VISIBLE ────────────────────────────────────────────────────────
  // When mayAdvance refuses, this client stops advancing. That is deliberate and it is the safe
  // direction — but from the outside it is indistinguishable from the app being broken, and "the
  // music stopped and nothing said why" is exactly the kind of silent state this codebase keeps
  // finding. So the reason is published; whether anything renders it is the UI's business.
  //
  // Only transitions are emitted. The advance path is retried every tick, so notifying on each
  // refusal would fire a few times a second for as long as the hold lasts.
  let _hold = null;
  let _onHold = null;
  function _setHold(reason) {
    const next = reason || null;
    if (next === _hold) return;
    _hold = next;
    if (next) Logger.info("Playback: holding — " + next);
    else Logger.info("Playback: hold cleared");
    if (_onHold) { try { _onHold(next); } catch (e) {} }
  }
  function onHoldChange(fn) { _onHold = fn; if (fn) { try { fn(_hold); } catch (e) {} } }

  async function _emitPlay(prev) {
    if (!eventsChannel) return null;
    return await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.play", { p: prev || null });
  }

  // ── THIS FILE HAS NO BOT RULE, AND THAT IS THE DECISION ───────────────────────────────────
  // IT USED TO. Two special cases lived here — the bot did not declare a length, and the bot did
  // not author an advance — added after a live session caught it doing both. They are DELETED, and
  // the reasoning that produced them is kept here because it was wrong in an instructive way.
  //
  // THE OLD ARGUMENT: a length the bot measured is not evidence the room should weigh, and its
  // stagger at the top rung is 0ms so it would win nearly every advance and become the room's sole
  // advancer. Both are true statements about a bot that WATCHES.
  //
  // WHY IT IS GONE: the bot is the owner. It is meant to do what the owner would, and to be first
  // or second when it acts — the 0ms stagger is the POINT, not the problem. A room whose owner has
  // left still has an authority in it. Special-casing playback made the bot a lesser client at
  // exactly the moment it is supposed to be the room's most reliable one.
  //
  // AND THE REAL DIFFERENCE IS ONE THING, ONE LAYER UP: with its view setting off the bot does not
  // LOAD the media. Everything the old rules bought then falls out for free and needs no rule —
  // no player means no measured duration, so no length is declared; no player means no `onError`, so no
  // `ddjp.play.blocked` is ever authored. That
  // last one is not cosmetic: blocked reports feed the auto-skip roads, so a deliberate
  // non-watcher reporting "blocked" would help vote off a song everyone else can see fine.
  //
  // WHAT THE BOT IS, WITH ITS VIEW OFF, IS AN OWNER WHO CANNOT SEE THE VIDEO — a state this file
  // already handles and has always handled. It reads the room, sweeps for idle DJs, moderates, and
  // ends songs by the room's clock like any other client (`ddjp_711`): the agreed length is the room's, declared by those
  // who watch, so a screen that cannot see the song ends it at the same moment as one that can. With no agreed length the
  // ceiling ends it, as it always has.

  function _tick() {
    const s = StreamManager.getState();
    const np = s.nowPlaying;
    const hasHead = (s.rotation || []).length > 0;

    if (!np) {
      // ── A CLIENT THAT CANNOT READ THE RECENT PAST MAY NOT DECLARE THE ROOM IDLE ─────────
      // This is the line that turned a fold confusion into a person hearing the wrong song. A
      // client whose log was short derived `nowPlaying: null`, saw songs still sitting in the
      // buffers it had never consumed, and did the reasonable thing for an idle room: it started
      // one. The room had finished that song an hour earlier.
      //
      // "Nothing is playing" and "I cannot tell what is playing" are different states that look
      // identical here — both arrive as `np === null`. The first is a room waiting for someone to
      // start. The second is this client being wrong, and it is the WORST-PLACED client to decide
      // the room is empty, because the evidence it would need is the evidence it is missing.
      //
      // NARROW ON PURPOSE. It withholds ONE decision — the genesis play — and nothing else. This
      // client still folds, still renders, still ends songs, still votes, and still authors the
      // ceiling advance for a song it CAN see. The room's no-freeze guarantee does not depend on a
      // short client starting things: every whole client still reaches this line and still fires.
      // A general "hold everything when unsure" would trade a wrong song for a stuck room, which
      // is the worse of the two.
      //
      // ASKED AT FIRE TIME AND ON EVIDENCE, never on a feeling. `shortWithoutFloor()` is set by the
      // fold from what the log actually reaches, not from a client's sense of being behind — a
      // guess here would silence healthy clients and stall rooms that were fine.
      let short = null;
      try { short = StreamManager.shortWithoutFloor ? StreamManager.shortWithoutFloor() : null; }
      catch (e) { short = null; }               // unknown is not a yes
      if (short) {
        _noteAdvance("genesis", "HELD — this client's log is short below l=" + short.at +
          " (lowest held " + short.lowestHeld + ") with no floor to seed from, so `nothing is " +
          "playing` may be its own gap rather than the room's state. Not starting a song on it");
        return;
      }
      if (hasHead) _maybeAdvance(null);          // genesis: someone is ready to play
      return;
    }
    // Defensive: nowPlaying can be set but carry no real song if the buffer it
    // was shifted from was empty at processing time (e.g. a declare/join event
    // was deleted out from under a client that already advanced past it — the
    // reducer's own visible() filter prevents this in normal operation, but a
    // client whose view of history changed after the fact, such as after a
    // redaction, replay, or reload, can land here). There is nothing to wait
    // for — no duration will ever arrive for a song that doesn't exist — so
    // treat it the same as nothing playing and try to advance past it,
    // instead of crashing on np.song.songKey or freezing silently forever.
    // _emptyAdvanceStreak is incremented just below, each time this branch is
    // hit — a real song landing resets it to 0 a few lines down. The backoff
    // gate itself lives in _maybeAdvance.
    if (!np.song) {
      if (hasHead) {
        _emptyAdvanceStreak++;
        _maybeAdvance(np.pi, false);   // stuck-state recovery — honours the gate like any advance
      }
      return;
    }
    _emptyAdvanceStreak = 0;

    // ── HARD CEILING (maxLen) ────────────────────────────────────────────────
    // A song may not exceed the room's max length. This is enforced by EVERY client
    // against the SHARED anchor (np.startedAt) and the SHARED constant (maxLen from the
    // log-ordered settings snapshot taken when the song started — np.settings.maxLen).
    // It is INDEPENDENT of local duration: a blocked viewer with no knownDuration still
    // enforces it, which is what guarantees the room can never freeze. Like every other
    // advance it routes through _maybeAdvance → stagger + re-check + advance-lock, so it
    // resolves to exactly ONE authored skip everyone converges on (guarded by
    // check-ceiling-convergence). Pure time vs shared values → no reports, no mod, no
    // reason slot needed. A missing/invalid maxLen (0 or absent) means the ceiling is off.
    const maxLen = (np.settings && typeof np.settings.maxLen === "number") ? np.settings.maxLen : 0;
    // Server-time elapsed (ServerClock): both ends are server-time so the ceiling fires for
    // everyone at the SAME shared moment, with no drift beacon. Timing-only, never the queue.
    const ceilElapsed = _elapsedSec(np);
    if (maxLen > 0 && ceilElapsed >= maxLen) {
      _maybeAdvance(np.pi, true);   // CEILING: the clock-only backstop — exempt from sight and the gate
      // clamp the readout to full so the bar doesn't sit short while the advance resolves
      if (_onState) _onState(Object.assign({}, _attach(np), { elapsed: maxLen }));
      return;
    }

    // ── THE CLOCK END (the owner's decision, `ddjp_711`, replacing "the first screen whose player says ENDED") ──────────
    // His words: "then maybe the room cna be in perfect sync using clock time only and declared lenghts only to know what
    // to do in a pure form with the player unable to alter logic". The song ends at `advance.endsAt` — its agreed length
    // (`StateDeriver.gateLengthSec`, the one rule) plus the wait (`END_WAIT_MS`, 0 now) — the same moment on every screen
    // and for the bot. With no agreed length there is no clock end, and the ceiling above ends it; meanwhile this device
    // declares its length again if it has one. NO PRIVATE LENGTH ENDS A SONG: the safety net that advanced at this
    // device's own measurement is gone, not kept as a fallback. Not exempt from the gate (the ceiling's alone).
    const adv = (s.advance && s.advance.pi === np.pi) ? s.advance : null;
    if (!adv || typeof adv.gateLenSec !== "number") _retryLength(np);
    const elapsed = Math.max(0, (_nowMs() - np.startedAt) / 1000);
    const endsAt = (adv && typeof adv.endsAt === "number") ? adv.endsAt : null;
    if (endsAt !== null && _nowMs() >= endsAt) {
      _maybeAdvance(np.pi, false);   // the clock end — honours the gate
      if (_onState) _onState(Object.assign({}, _attach(np), { elapsed: Math.min(elapsed, adv.gateLenSec) }));
      return;
    }
    if (_nowMs() - np.startedAt < GRACE_MS) return;
    if (_onState && (endsAt !== null || knownDuration[np.song.songKey])) _onState(Object.assign({}, _attach(np), { elapsed: elapsed }));
  }

  // ── THE END, ARMED FROM EACH ARRIVING MESSAGE (`ddjp_711`; the bot's way since J68) ───────────────────────────────────
  // The 2-second tick is a timer chain, and Chrome holds a hidden, silent tab's chain to about once a minute. Each arriving
  // message (and each player end, and each answer to an advance) arms ONE timer for the next due moment — the clock end,
  // the ceiling, or an advance's retry — from that task, so it is not a chain. When it fires it runs the tick, which
  // re-arms from there only if a moment is still ahead; a moment already due runs the clock check at once, never a timer at
  // zero.
  let _started = false;
  let _endTimer = null;
  function _dueIn() {
    let st = null;
    try { st = StreamManager.getState(); } catch (e) { return null; }
    const np = st && st.nowPlaying;
    if (!np || !np.pi || !np.song) return null;
    const adv = (st.advance && st.advance.pi === np.pi) ? st.advance : null;
    const now = _nowMs();
    const ahead = [];
    if (adv && typeof adv.endsAt === "number") ahead.push(Math.max(adv.endsAt, typeof adv.earliestAt === "number" ? adv.earliestAt : 0) - now);
    const maxLen = (np.settings && typeof np.settings.maxLen === "number") ? np.settings.maxLen : 0;
    if (maxLen > 0 && typeof np.startedAt === "number") ahead.push(np.startedAt + maxLen * 1000 - now);
    if (!ahead.length) return null;
    let wait = Math.min.apply(null, ahead);
    if (_asked && _asked.key === np.pi) {
      if (!_asked.answeredAt) return null;          // its answer re-arms
      wait = Math.max(wait, _asked.answeredAt + ADVANCE_RESEND_MS - Date.now());
    }
    return wait;
  }
  function _armEnd(atOnce) {
    if (_endTimer) { try { clearTimeout(_endTimer); } catch (e) {} _endTimer = null; }
    if (!_started) return;
    const wait = _dueIn();
    if (wait === null) return;
    if (wait <= 0) { if (atOnce !== false) _tick(); return; }
    _endTimer = setTimeout(() => { _endTimer = null; _tick(); _armEnd(false); }, wait);
  }

  // ── THE LENGTH, ASKED AGAIN WHILE THE ROOM HAS NONE (`ddjp_711`) ────────────────────────────────────────────────────
  // A declaration whose reading was refused at its moment was never retried, and with no private length ending songs any
  // more such a song would wait for the ceiling. So while the room agrees no length, the tick asks this device's player
  // again — at most every LEN_RETRY_MS — and declares if it reads the song. Still one declaration per person per playing.
  let _lenRetry = null;   // { pi, at }
  function _retryLength(np) {
    if (!np || !np.song || !eventsChannel || _declaredLenPi === np.pi) return;
    const now = Date.now();
    if (_lenRetry && _lenRetry.pi === np.pi && now - _lenRetry.at < LEN_RETRY_MS) return;
    _lenRetry = { pi: np.pi, at: now };
    const r = _confirmReading(np.song.songKey);
    if (!r.ok) return;
    _declareLength(np.song.songKey, r.sec);
  }

  // EVERY advance takes turns by rank through the ONE shared stagger — the ordinary
  // end-of-song advance as much as the ceiling escape. Deciding a song has ended is an
  // authority claim like any other, so seniors present get first refusal; if only the
  // lowest ranks are here the room simply waits its way down the ladder, which is the
  // accepted cost. (The escape path was previously documented as rank-ordered and was in
  // fact pure random jitter reading no rank; the ordinary path had no rank either.)
  // `exemptFromGate` is the CEILING'S privilege and nothing else's. It means: do not wait for the
  // room's agreed length, and do not take the pre-send pause. Only the maxLen ceiling qualifies —
  // it is the anti-freeze backstop and must fire even when nobody present can see the song. An
  // observed ENDED and stuck-state recovery HONOUR the gate: if the player claims the song ended
  // before the room's agreed length, the reducer rejects that advance anyway, so posting it is
  // exactly the wasted traffic the pre-send check exists to prevent. One flag used to mean both
  // "skip the pause" and "skip the check", and every call site passed it, so neither ever ran.
  // ── ONE "NEXT SONG" IN FLIGHT PER SONG (J70) ─────────────────────────────────────────────────
  // `_advancing` covers the send itself and clears when `sendEvent` resolves — a fraction of a
  // second — so the 2-second tick sent the same advance again, and again, until the room moved.
  // In a bot room the room moves only after a relay, and with the bot's tab asleep the owner's app
  // sent 17 in 34 s (bot-501, 09:30:12–09:30:46); every one that later landed read "refused" in the
  // feed. Now, once an advance for a song is sent, no other is sent for that song until its answer
  // comes back; after a "no" or no answer, the next may follow after ADVANCE_RESEND_MS. A transport
  // that cannot answer keeps the old behaviour.
  const ADVANCE_RESEND_MS = 5000;
  let _asked = null;   // { key, at, answeredAt }
  function _waitingOnAnswer(key) {
    if (!_asked || _asked.key !== key) return false;
    const now = Date.now();
    if (!_asked.answeredAt) {
      let deadline = 22000;
      try { if (MatrixBridge && typeof MatrixBridge.answerDeadlineMs === "function") deadline = MatrixBridge.answerDeadlineMs(); } catch (e) {}
      return (now - _asked.at) < deadline;
    }
    return (now - _asked.answeredAt) < ADVANCE_RESEND_MS;
  }
  function _noteAsked(key, sent) {
    if (!sent || !sent.eventId || !MatrixBridge || typeof MatrixBridge.awaitAnswer !== "function") { _asked = null; return; }
    const mine = { key: key, at: Date.now(), answeredAt: null };
    _asked = mine;
    Promise.resolve(MatrixBridge.awaitAnswer(sent.eventId))
      .then(() => { mine.answeredAt = Date.now(); _armEnd(); }, () => { mine.answeredAt = Date.now(); _armEnd(); });
  }

  function _maybeAdvance(prev, exemptFromGate) {
    if (_advancing) return;
    if (_waitingOnAnswer(prev || "genesis")) return;
    // Backoff only kicks in once we've seen several consecutive advances that
    // didn't resolve to a real playing song (see _tick's !np.song branch,
    // which is the only place _emptyAdvanceStreak is ever incremented). A
    // normal genesis or end-of-song advance is unaffected — this only guards
    // against a genuinely stuck state (e.g. a redacted declare leaving an
    // empty buffer) repeatedly re-triggering itself every TICK_MS forever.
    if (_emptyAdvanceStreak >= MAX_FAST_RETRIES) {
      const since = Date.now() - _lastAdvanceAttempt;
      if (since < BACKOFF_MS) return;
    }
    _advancing = true;
    _lastAdvanceAttempt = Date.now();
    let jitter = Math.floor(Math.random() * JITTER_MS);
    let presend = 300;
    {
      try {
        const st = StreamManager.getState().settings || {};
        jitter = Capabilities.staggerMs(_myRank(), st.vouchJitter, null);   // the song acts take no rung (the owner's decision, `ddjp_628`)
        if (typeof st.presendMs === "number") presend = st.presendMs;
      } catch (e) { /* fall back to the short jitter — never block the backstop */ }
    }
    // Rank slot + a tiny PRE-SEND pause, folded into ONE timer. The pre-send pause (well under
    // one stagger step) is a final beat to notice a play that landed while we waited our slot;
    // the re-check at fire time is what actually prevents a double advance. Kept smaller than a
    // step so our send lands before the next rank's slot opens. Every advance takes the pause
    // except the ceiling (`exemptFromGate`), which must move now.
    // THE ROOM'S OWN ADVANCE COMES FIRST WHERE THE ENGINE HAS ONE (J66). In a bot room the runner
    // ends each song itself, so an app's advance is a BACKUP, sent only once the song is well
    // overdue — the transport says how long (`advanceBackupMs`; 0 in a shared room, where every
    // client's advance IS the mechanism). The timer callback stands down if the room moved meanwhile.
    let backup = 0;
    try { if (MatrixBridge && typeof MatrixBridge.advanceBackupMs === "function") backup = Math.max(0, MatrixBridge.advanceBackupMs() || 0); }
    catch (e) { backup = 0; }
    const totalDelay = jitter + (exemptFromGate ? 0 : Math.max(0, presend)) + backup;
    _advanceTimer = setTimeout(async () => {
      _advanceTimer = null;
      try {
        const s0 = StreamManager.getState();
        const cur = s0.nowPlaying;
        const curPi = cur ? cur.pi : null;
        if (curPi !== (prev || null)) {
          _noteAdvance(prev || "genesis", "stood down — the room already moved on to " +
            (curPi || "nothing") + ". A lost race is the protocol working, not a fault");
          _advancing = false; return;
        }

        // Honor the GATE for the normal advance. `advance.earliestAt` is derived from the play
        // event's SERVER timestamp (startedAt), so it must be compared against SERVER time —
        // _nowMs() is ServerClock's locally-reconstructed serverNow(), which is anchored to the
        // same clock that stamped startedAt. Comparing it to the raw local wall clock would mix
        // two clocks and make a skewed device try systematically early or late.
        // This still only decides when we TRY; validity is the reducer's, judged on committed
        // stamps, so even a bad offset costs at most a refused attempt. The ceiling skips it
        // (`exemptFromGate`): it is clock-only by design.
        const adv = s0.advance;
        if (!exemptFromGate && adv && cur && adv.pi === cur.pi && typeof adv.earliestAt === "number") {
          if (_nowMs() < adv.earliestAt) {
            // THE LINE THAT NAMES THE STALL. A gate that opens long after the song really ended
            // means the room's agreed length is wrong, and the agreed length comes from whichever
            // client at the strongest rank declared one. Printing both the wait and the length is
            // what turns "it just sits there" into a readable fault.
            _noteAdvance(cur.pi, "waiting for the gate — " +
              Math.round((adv.earliestAt - _nowMs()) / 1000) + "s to go, because the room's agreed " +
              "length is " + (adv.gateLenSec != null ? adv.gateLenSec + "s" : "unset (grace floor only)"));
            _advancing = false; return;
          }
        }

        // ── AM I FIT TO AUTHOR THIS? ────────────────────────────────────────────────────────
        // Asked at FIRE time, not when the timer was set, for the same reason the Scheduler reads
        // rank at fire time: we may have been short or mid-replay when this was planned and be
        // whole and live by now, or the reverse. A plan is a description, not a snapshot.
        //
        // AND IT IS ASKED ON EVERY PATH, INCLUDING THE EXEMPT ONE. `exemptFromGate` waives the
        // EARLIEST-TIME check above for the ceiling, which is clock-only by design. It does not
        // waive the question of whether this client is in a fit state to author at all; those
        // are different questions that happen to sit next to
        // each other. The room's no-freeze guarantee does not depend on a SHORT client emitting
        // the ceiling advance: every whole client still holds the same ceiling and still fires.
        // Wrapped in its own try/catch rather than relying on the enclosing one. Without this a
        // throwing or missing check falls into the general handler below, which skips the emit —
        // so an infrastructure fault would silently stop the music, the exact opposite of the
        // stated policy. Caught by the guard, not by reading: the intent was written in the seam
        // and the call site quietly did the reverse.
        let fit = null;
        try {
          if (MatrixBridge && typeof MatrixBridge.mayAdvance === "function") fit = MatrixBridge.mayAdvance();
        } catch (e) { fit = null; /* unknown is not a no */ }
        if (fit && fit.ok === false) {
          // Not an error and not a failure — this client is behind or holding a corroborated
          // gap, and the correct behaviour is to stay quiet until it is not. Surfaced rather
          // than swallowed: to the user the music simply stopped, and silence is the one
          // response that makes a deliberate hold indistinguishable from a bug.
          _noteAdvance(curPi || "genesis", "HELD — " + fit.reason +
            (fit.state ? " (" + fit.state + ")" : "") +
            (fit.because ? " because=" + fit.because : "") +
            (fit.awaiting ? " waiting-for=" + fit.awaiting : "") +
            ". This client is not entitled to author " +
            "yet; something else in the room has to, or this one has to catch up first");
          _setHold(fit.reason);
          _advancing = false;
          return;
        }
        _setHold(null);
        _noteAdvance(curPi || "genesis", "SENDING the next play (p=" + (prev || "null") +
          ", waited " + totalDelay + "ms for my slot)");
        const sent = await _emitPlay(prev);
        _noteAsked(prev || "genesis", sent);
      } catch (e) { Logger.warn("Playback advance: " + e.message); }
      _advancing = false;
    }, totalDelay);
  }

  // Pure decision: should an ENDED signal for `songKey` end the current song?
  // True ONLY when the id we were told ended matches the song we believe is
  // now-playing — so a stale ENDED fired during a video swap (or with no id
  // available) can never advance the wrong song. Kept pure + exported so the
  // guard exercises it without the iframe.
  // BY PLAY, NOT ONLY BY VIDEO (owner's test, `ddjp_534`): the same video twice in a row let the first play's late ENDED
  // end the second. When the player names the play that ENDED, an ENDED from any other play is refused; with no play
  // named, the video match stands as before. `tests/check-ended-by-play.js` holds it.
  function shouldEndOn(np, songKey, pi) {
    if (typeof pi === "string" && pi && np && np.pi !== pi) return false;
    return !!(np && np.song && songKey && np.song.songKey === songKey);
  }

  // ── A PLAYER'S END IS A WAKE-UP, NEVER THE DECISION (the owner's decision, `ddjp_711`) ──────────────────────────────
  // The song's player says "ended" (through the players' plug, from ui/player.js's state handler). It no longer advances
  // the room: it runs the clock check (the room ends the song at its agreed length plus the wait, `_tick`), and it answers
  // what THIS DEVICE does with its player:
  //   "reload" — an EARLY end: the room's elapsed time is below the agreed length minus max(graceMs, EARLY_MARGIN_MS)
  //              (with no agreed length, the ceiling stands for it). The device loads the song once more at the room's
  //              point: a person who dragged the player to its end, a player that lost its place. His words: "for sound
  //              cloud, what happens currently if the personal manually clicks tot he end of the song … or maybe gracefull
  //              snap back anyways".
  //   "hold"   — a NORMAL end (its song is over for the room too, give or take the margin), or a SECOND early end in the
  //              same play: the device holds quietly ("Waiting for the next song…") until the room moves on.
  //   null     — not this song (`shouldEndOn`): a late end from another play changes nothing.
  // The hold is recorded against the play (`_endedPi`), so every later push about it carries `ended`.
  let _reloadedPi = null;   // the play this device already reloaded once after an early end
  function _isEarly(np, adv) {
    const set = np.settings || {};
    const grace = (typeof set.graceMs === "number" && isFinite(set.graceMs)) ? set.graceMs : 0;
    const margin = Math.max(grace, EARLY_MARGIN_MS);
    let lenSec = (adv && adv.pi === np.pi && typeof adv.gateLenSec === "number") ? adv.gateLenSec : null;
    if (lenSec === null && typeof set.maxLen === "number" && set.maxLen > 0) lenSec = set.maxLen;
    if (lenSec === null || typeof np.startedAt !== "number") return false;
    return (_nowMs() - np.startedAt) < lenSec * 1000 - margin;
  }
  function notifyEnded(songKey, pi) {
    const s = StreamManager.getState();
    const np = s.nowPlaying;
    if (!shouldEndOn(np, songKey, pi)) return null;
    let out = "hold";
    if (_isEarly(np, s.advance) && _reloadedPi !== np.pi) {
      _reloadedPi = np.pi;
      out = "reload";
      Logger.info("Playback: ENDED EARLY pi=" + np.pi + " vid=" + songKey + " — the room's clock is not there yet: this " +
        "device reloads it once at the room's point");
    } else {
      _endedPi = np.pi;
      Logger.info("Playback: ENDED pi=" + np.pi + " vid=" + songKey + " — holding quietly until the room's clock ends it" +
        (_reloadedPi === np.pi ? " (ended early again after its one reload)" : ""));
    }
    _tick();       // THE WAKE-UP: the clock decides
    _armEnd(false);
    if (out === "hold" && _onState) _onState(_attach(np));
    return out;
  }

  return { init, initWiring, start, destroy, stop, onStateChange, onHoldChange, elapsedSec: _elapsedSec, setDuration, setDurationProvider, knownDurationFor, notifyEnded, shouldEndOn, setMyRank,
    _tick /* exposed for check-ceiling-convergence (drive one tick with a controllable clock) */ };
})();
