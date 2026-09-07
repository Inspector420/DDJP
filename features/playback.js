// features/playback.js
// Reads now-playing from the stream and drives the rotation forward. When the
// current song ends (or nothing is playing but someone is ready), it emits
// ddjp.dj.play with p = the current play-instance. Any present client may emit;
// the advance lock in the reducer keeps the first and drops the rest, so a small
// random jitter + re-check is enough to avoid a thundering herd.
// Depends on: StreamManager, MatrixBridge, Logger

const Playback = (() => {
  const GRACE_MS = 15000;   // don't advance in the first 15s of a song
  const TICK_MS = 2000;
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
  let _emptyAdvanceStreak = 0;    // consecutive advances that resolved to "no real song" — defensive backoff
  let _lastAdvanceAttempt = 0;
  const knownDuration = {};  // videoId -> seconds (player-supplied, never in events)
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
    _endedPi = null; _loggedSongPi = null; _lastAdvanceNote = ""; _declaredLenPi = null;
    const notify = () => _notifyUI();
    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }
    Logger.debug("Playback: wired on " + channel);
  }

  // Begin the live tick loop. Called only after history is in place (after
  // replay for join, immediately after wiring for a fresh create).
  function start() {
    if (loop) clearInterval(loop);
    loop = setInterval(_tick, TICK_MS);
    Logger.debug("Playback: started ticking");
  }

  // Convenience: wire + start in one call. Safe for callers that have nothing
  // to replay between the two phases (and for existing tests).
  function init(channel) {
    initWiring(channel);
    start();
  }

  function destroy() { _cleanup(); eventsChannel = null; }
  function stop() { if (loop) clearInterval(loop); loop = null; }

  // Registering a listener immediately pushes the CURRENT now-playing state,
  // not just future changes. Without this, a joiner who replays history before
  // the UI subscribes (see Room.join) never gets told what's already playing —
  // the player sits at local 0:00 forever, because nothing ever calls
  // loadVideo for a song that was already playing before they joined.
  function onStateChange(fn) {
    _onState = fn;
    if (_onState) _onState(_attach(StreamManager.getState().nowPlaying));
  }
  // knownDuration is MY OWN player's measurement — the LOCAL measured duration. It is
  // the ONLY duration that may drive the wall-clock safety-net advance in _tick (a
  // shared/peer value must never move my queue). We also hand it to MediaLength so it
  // can (a) serve it as this client's authoritative displayDuration and (b) let the
  // rank-staggered ladder decide whether to share it. See features/medialength.js.
  function setDuration(videoId, d) {
    knownDuration[videoId] = d;
    try {
      if (typeof MediaLength !== "undefined" && MediaLength.recordLocalMeasured) {
        MediaLength.recordLocalMeasured(videoId, d);
      }
    } catch (e) {}
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
    // asked at FIRE time and its answer is what travels — exactly as loadVideo asks for the
    // playhead rather than carrying a number through the wait. If the hazard is real this closes
    // it; if it is not, the cost is one extra function call per song.
    try {
      const s = StreamManager.getState();
      const np = s.nowPlaying;
      if (!np || !np.song || np.song.videoId !== videoId || !eventsChannel) return;
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
        const vid = s2.nowPlaying.song ? s2.nowPlaying.song.videoId : null;

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
          knownDuration[vid] = mine;                               // the wall-clock net + countdown
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
        MatrixBridge.sendEvent(eventsChannel, "ddjp.play.len", { pi: np.pi, sec: mine })
          .catch((e) => Logger.warn("Playback: length report failed: " + (e && e.message)));
      });
    } catch (e) {}
  }

  // ── THE PLAYER, ASKED AT FIRE TIME ─────────────────────────────────────────────────────────
  // A PROVIDER, NOT A VALUE — the same shape and the same reason as loadVideo's playhead: a
  // number handed over before a wait is stale by however long the wait lasted. The UI supplies
  // this; nothing here reaches for the player, which stays on ui/'s side of the boundary.
  //
  // Returns { videoId, seconds } — what the player says it is playing and how long that is, read
  // together, right now.
  let _durationProvider = null;
  let _declaredLenPi = null;        // the playing we have already declared a length for
  function setDurationProvider(fn) { _durationProvider = (typeof fn === "function") ? fn : null; }

  // My own player's measured length for a video, or null. Exposed because it drives the
  // wall-clock net and the countdown, and a correction to it has to be observable.
  function knownDurationFor(videoId) {
    return (videoId && knownDuration[videoId] != null) ? knownDuration[videoId] : null;
  }

  // NAMED REFUSALS, not a bare null. "the player cannot answer", "the player is on a different
  // song" and "the player says zero" are three different situations and only some are worth
  // retrying; collapsing them is how a missing seam comes to look like a bad measurement.
  //
  // ── `!expectedVideoId ||` IS DOMINATED TODAY, AND NOTHING IN THE SUITE WATCHES THAT (J49) ───
  // Do not delete it, and do not trust a green suite about it. Driven, journalled, on disk:
  // dropping the clause left EVERY guard green when this was measured (123 of them, at J49; the
  // suite is larger now and the finding is a dated record rather than a live count) — and so does
  // dropping the `no-reading` line
  // above it, because with today's provider a null reading is refused by both and needed by
  // neither. The control (inverting the equality beside it) turns two guards red, so the green is
  // a reading of this clause rather than of a suite that cannot see the function.
  //
  // WHY IT IS REDUNDANT, AND IT IS NOT A FACT ABOUT THIS FILE. A redundancy is a statement about
  // the routes that exist. The only duration provider in the tree lives in `ui/interface.js` and
  // returns `null` WHOLESALE whenever the player cannot name a video (`if (!vd || !vd.video_id)
  // return null;`). Executed against fourteen player shapes — absent, not ready, getVideoData
  // missing/undefined/null/{}, an empty-string id, a null id, zero/absent/NaN durations, both
  // throw paths — not one yields an object carrying a falsy id. So `r` never arrives in the shape
  // this clause refuses, and we return at `no-reading` one line above it.
  //
  // WHAT ENDS THAT: a J29 player adapter returning `{ videoId: null, ... }` instead of `null`.
  // From that moment this clause is the only thing between an unconfirmable reading and a
  // `ddjp.play.len` the reducer accepts once per person per playing and will never let you
  // withdraw. The room's own id is ALREADY falsy on a reachable route — a checkpoint seed builds
  // `song: { videoId: n.song.videoId }` with no type check, so a truthy song the room cannot name
  // reaches the call site above as `vid === null`.
  //
  // AND THE PAIRING IS MATCHING ABSENCES, not any absence. Driven across all twelve combinations,
  // only two change answer: room id `null` against a reading of `{videoId: null}`, and room id
  // absent against a reading whose key is absent. The cross pairs change nothing, because
  // `undefined !== null`. A guard row written from "an object with a missing or null id" can pick
  // a cross pair and pass on a tree where this clause has been deleted.
  //
  // THE PART THAT COST THE MOST TO FIND: **no guard would notice the redundancy ending.**
  // `check-length-freshness` is the only guard that drives `setDurationProvider`, and it installs
  // its OWN provider at every site — it never reads the shipped one, and no guard that reads
  // `ui/interface.js` touches the provider install. Mutating the provider into the J29 shape
  // leaves the suite green; doing that WITH this clause deleted leaves it green too. Whoever
  // lands J29 owes two guards, not one: a row on this clause, and a row on the PROVIDER CONTRACT
  // itself, driven out of `ui/interface.js` the way `check-blocked-wire` executes `onError`.
  // `docs/main/09-roadmap.md` J49 · `docs/roles.md` §9 · `docs/paths.md` §9 entry 13.
  function _confirmReading(expectedVideoId) {
    if (typeof _durationProvider !== "function") return { ok: false, why: "no-provider" };
    let r = null;
    try { r = _durationProvider(); } catch (e) { return { ok: false, why: "provider-threw" }; }
    if (!r || typeof r !== "object") return { ok: false, why: "no-reading" };
    if (!expectedVideoId || r.videoId !== expectedVideoId) {
      return { ok: false, why: "different-video", saw: r.videoId || null };
    }
    const sec = (typeof r.seconds === "number" && isFinite(r.seconds) && r.seconds > 0)
      ? Math.round(r.seconds) : null;
    if (sec === null) return { ok: false, why: "no-duration" };
    return { ok: true, sec: sec };
  }

  // Fire `fn` after this client's rank slot (the ONE shared stagger), deduped by key so a
  // declaration is authored at most once per playing. Re-checks at fire time inside `fn`.
  const _staggerTimers = Object.create(null);
  function _staggeredEmit(key, fn) {
    if (_staggerTimers[key]) return;
    let delay = 0;
    try {
      const st = StreamManager.getState().settings || {};
      delay = Capabilities.staggerMs(_myRank(), st.vouchJitter, null,
        (typeof Store !== "undefined" && Store.stagger) ? Store.stagger.offsetMs() : 0);
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
      const step = (typeof st.vouchJitter === "number" && isFinite(st.vouchJitter)) ? st.vouchJitter : 0;
      const floor = Math.floor(step / 2);
      if (delay < floor) delay = floor;
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
  // This only affects what the UI SHOWS — the advance gate reads the reducer's gateLen, and _tick's
  // wall-clock safety-net reads knownDuration (local only) directly.
  function _displayDurationFor(videoId) {
    if (knownDuration[videoId]) return knownDuration[videoId];
    try {
      const s = StreamManager.getState();
      const np = s.nowPlaying, adv = s.advance;
      if (np && np.song && np.song.videoId === videoId && adv && adv.pi === np.pi
          && typeof adv.displayLenSec === "number" && adv.displayLenSec > 0) {
        return adv.displayLenSec;
      }
    } catch (e) {}
    try {
      if (typeof MediaLength !== "undefined" && MediaLength.displayDuration) {
        const shared = MediaLength.displayDuration(videoId);
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
  // ONLY THE REAL SIGNAL SETS IT. The wall-clock estimate deliberately does not — it trips while
  // a song is genuinely still audible (a short or wrong player-reported duration, a mid-song
  // joiner whose startedAt runs ahead of real audio position), and a false end greys out Skip and
  // shows "nothing playing" over music that is still going.
  let _endedPi = null;
  function _attach(np) {
    if (!np) return np;
    const out = (np.pi && np.pi === _endedPi) ? Object.assign({}, np, { ended: true }) : np;
    if (out.song) {
      const dd = _displayDurationFor(out.song.videoId);
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
  // server-time "now" in ms (for the duration safety-net + grace below). Falls back to local.
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
        " vid=" + (np.song ? np.song.videoId : "none") +
        " dj=" + (np.dj || "?") +
        " startedAt=" + started +
        (np.skipped ? " (arrived by skip)" : "") +
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
      return Capabilities.staggerMs(_myRank(), st.vouchJitter, () => 0,
        (typeof Store !== "undefined" && Store.stagger) ? Store.stagger.offsetMs() : 0);
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
    if (!eventsChannel) return;
    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.play", { p: prev || null });
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
  // no player means no measured duration, so no length is declared and the wall-clock safety net
  // never fires; no player means no `onError`, so no `ddjp.play.blocked` is ever authored. That
  // last one is not cosmetic: blocked reports feed the auto-skip roads, so a deliberate
  // non-watcher reporting "blocked" would help vote off a song everyone else can see fine.
  //
  // WHAT THE BOT IS, WITH ITS VIEW OFF, IS AN OWNER WHO CANNOT SEE THE VIDEO — a state this file
  // already handles and has always handled. It reads the room, sweeps for idle DJs, moderates, and
  // enforces the clock-only ceiling like any other client. It does not advance on song END,
  // because `knownDuration` is MY OWN measurement and a shared value must never move my queue —
  // see `setDuration`. That is not a gap to fill for the bot; it is the same trust rule every
  // blocked viewer already lives under, and the ceiling is what stops the room freezing.

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
    // instead of crashing on np.song.videoId or freezing silently forever.
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

    const dur = knownDuration[np.song.videoId];
    if (!dur) return;                            // wait for the player to report duration
    if (_nowMs() - np.startedAt < GRACE_MS) return;
    const elapsed = (_nowMs() - np.startedAt) / 1000;
    if (elapsed >= dur) {
      // Wall-clock SAFETY-NET advance only. Writers emit the advance to move the
      // rotation on for clients whose real iframe ENDED never fires. We deliberately
      // do NOT declare the song ended to the UI here: this estimate can trip while
      // the song is still actually playing — a short or incorrect player-reported
      // duration, or a mid-song joiner whose startedAt runs ahead of real audio
      // position — and a false "ended" used to grey Skip and flash "Nothing playing"
      // over a song that was still audible. The authoritative end now comes from the
      // real iframe ENDED (notifyEnded); np changing on advance is what updates the
      // UI. We still clamp the progress readout to full so the bar doesn't sit short.
      // Exempt from the early-gate: elapsed has reached the song's real duration, so this is
      // by definition not an EARLY advance — the gate guards advancing before a song ends.
      _maybeAdvance(np.pi, false);   // wall-clock safety net — honours the gate
      if (_onState) _onState(Object.assign({}, _attach(np), { elapsed: dur }));
    } else if (_onState) {
      _onState(Object.assign({}, _attach(np), { elapsed: elapsed }));
    }
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
  function _maybeAdvance(prev, exemptFromGate) {
    if (_advancing) return;
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
        jitter = Capabilities.staggerMs(_myRank(), st.vouchJitter, null,
          (typeof Store !== "undefined" && Store.stagger) ? Store.stagger.offsetMs() : 0);
        if (typeof st.presendMs === "number") presend = st.presendMs;
      } catch (e) { /* fall back to the short jitter — never block the backstop */ }
    }
    // Rank slot + a tiny PRE-SEND pause, folded into ONE timer. The pre-send pause (well under
    // one stagger step) is a final beat to notice a play that landed while we waited our slot;
    // the re-check at fire time is what actually prevents a double advance. Kept smaller than a
    // step so our send lands before the next rank's slot opens. The normal advance takes the
    // pause; the exempt paths (ceiling, observed end, stuck-state) do not — they must move now.
    const totalDelay = jitter + (exemptFromGate ? 0 : Math.max(0, presend));
    setTimeout(async () => {
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
        // stamps, so even a bad offset costs at most a refused attempt. The exempt paths skip it:
        // the ceiling is clock-only by design, and an observed end is by definition not early.
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
        // AND IT IS ASKED ON EVERY PATH, INCLUDING THE EXEMPT ONES. `exemptFromGate` waives the
        // EARLIEST-TIME check above — the ceiling is clock-only by design and an observed end is
        // by definition not early. It does not waive the question of whether this client is in a
        // fit state to author at all; those are different questions that happen to sit next to
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
        await _emitPlay(prev);
      } catch (e) { Logger.warn("Playback advance: " + e.message); }
      _advancing = false;
    }, totalDelay);
  }

  // Pure decision: should an ENDED signal for `videoId` end the current song?
  // True ONLY when the id we were told ended matches the song we believe is
  // now-playing — so a stale ENDED fired during a video swap (or with no id
  // available) can never advance the wrong song. Kept pure + exported so the
  // guard exercises it without the iframe.
  function shouldEndOn(np, videoId) {
    return !!(np && np.song && videoId && np.song.videoId === videoId);
  }

  // The real "song is over" signal from the YouTube iframe (state ENDED),
  // forwarded down from the UI (interface.js onStateChange). This is the
  // authoritative end — unlike the wall-clock _tick fallback it does NOT wait
  // for the GRACE window or a player-reported duration. It routes through the
  // SAME advance path (_maybeAdvance with p = np.pi), so the reducer's advance
  // lock keeps the first emit and drops the rest exactly as for a wall-clock
  // advance — no double-advance. If we can't tell which video ended
  // (getVideoData() can return undefined mid-swap), shouldEndOn is false and we
  // no-op, leaving the wall-clock path to handle it.
  function notifyEnded(videoId) {
    const np = StreamManager.getState().nowPlaying;
    if (!shouldEndOn(np, videoId)) return;
    // RECORDED AGAINST THE INSTANCE, not stamped on this one message. Everything pushed about
    // this song from here on inherits it through _attach.
    _endedPi = np.pi;
    Logger.info("Playback: ENDED pi=" + np.pi + " vid=" + videoId +
      " — holding the finished state until the room advances");
    _maybeAdvance(np.pi, false);   // the real iframe ENDED — honours the gate; the reducer would refuse an early one anyway
    // Reflect "ended" locally even if THIS client can't write the advance —
    // same contract as the wall-clock branch in _tick.
    if (_onState) _onState(_attach(np));
  }

  return { init, initWiring, start, destroy, stop, onStateChange, onHoldChange, elapsedSec: _elapsedSec, setDuration, setDurationProvider, knownDurationFor, notifyEnded, shouldEndOn, setMyRank,
    _tick /* exposed for check-ceiling-convergence (drive one tick with a controllable clock) */ };
})();
