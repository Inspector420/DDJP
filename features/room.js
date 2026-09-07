// features/room.js
// Owns room lifecycle — create, join, invite, rank assignment.
// Wires feature modules to the current room on entry.
// Depends on: MatrixBridge, StreamManager, Playback, Queue, Skip, Chat, Store, Logger
//
// Channel routing:
//   Protocol events write to → the highest-rank events channel we can write to
//   Chat reads/writes → chat_uncategorized (everyone, for now — later settable)
//   Every existing events-[rank] channel is replayed into StreamManager on join
//   Blocks are deferred — the room navigates the raw event stream directly

const Room = (() => {
  let current = null;
  const _rankChangeListeners = [];
  let _rankWired = false;
  let _channelWired = false;
  let _settingsWired = false;
  const _settingsListeners = [];
  let _hasEventsChannel = false;   // set in _initModules (wiring), read in _startModules
  // Same-session resume of an interrupted create. If createDDJPSpace fails part
  // way, it throws with e.partial = { spaceId, channels }; we stash it here so a
  // retry of the SAME room name resumes (building only what's missing) instead of
  // starting a second space. In-memory only — cross-reload resume is a later step.
  let _pendingCreate = null;       // { name, partial: { spaceId, channels } } | null
  let _creatingRoom = false;       // feature-layer re-entrancy guard (transport has its own backstop)

  function getCurrent() { return current; }
  function getChannels() { return current ? current.channels : null; }
  function getMyId() { return MatrixBridge.getUserId(); }
  function getMyRank() { return current ? MatrixBridge.getMyRank(current.channels) : 0; }
  function getRoster() { return current ? MatrixBridge.getRoster(current.spaceId) : []; }
  function onRankChange(fn) { if (fn && !_rankChangeListeners.includes(fn)) _rankChangeListeners.push(fn); }

  // ── WHO HAS DONE SOMETHING RECENTLY (J16) ──────────────────────────────────────────────────
  // This system has no presence protocol, so "who is here" can only ever mean "who has done
  // something recently". The list is folded out of the log every time it is asked for and holds
  // NO state of its own (P5) — in particular there is no side-table of last-seen stamps, because
  // one would survive a trim and go on naming somebody whose evidence this client has destroyed.
  //
  // WHY IT LIVES IN A FEATURE AND NOT IN `ui/`. J16's Touches field and J13's both say
  // `ui/interface.js` reading from `StreamManager.getLog()`, and `check-boundaries` rule D
  // forbids exactly that — `ui/` may not name `StreamManager` at all. So the read is here and the
  // UI renders what it is handed. (Raised rather than worked around: `09-roadmap.md` §9 entry S.)
  //
  // THREE SOURCES REACH THIS, NOT THE FOUR THE JOB ENTRY NAMES. Queue actions, votes and saves are
  // Spine events on the events channel and enter the log through the one door. CHAT CANNOT:
  // `_routeEvent` skips chat-named rooms BEFORE both `EventCache.store` and `StreamManager.ingest`,
  // so a chat message reaches the raw listeners and nothing else. That is not a gap to close —
  // chat is Skin and putting it in the log would persist decrypted plaintext at rest. It is a
  // limit the UI must STATE, and `check-who-is-here` PART E drives a chat event through the real
  // router and asserts it reaches neither the log nor this list, so the sentence in the panel is
  // an assertion something checks rather than a claim nobody re-reads.
  //
  // BOTH TIMES ARE SERVER STAMPS (P2). Every entry's `ts` is the homeserver's, stamped by
  // `matrixbridge`; `nowTs` is the caller's and must be `ServerClock.serverNow()`, never
  // `Date.now()`. This function does not read a clock at all, which is what lets a guard drive it
  // at explicit stamps and what keeps the comparison stamp-minus-stamp.
  //
  // THE LOG'S REACH BOUNDS THE WINDOW, AND THAT IS ONE RULE COVERING TWO CASES. `getLog()` reaches
  // back only as far as this client still holds: to the room's beginning in a young room, and to
  // the trim boundary once a floor has been adopted and the forget licence earned. A window wider
  // than that reach would answer "these four people" while having looked at less than it claims —
  // the plausible-value signature (`roles.md` §10). So the reach is MEASURED from the log itself
  // and the effective window is the smaller of the two, with `bounded` saying which. A young room
  // and a trimmed room narrow the claim through the same arithmetic, so there is no second rule
  // for the trim, and a name whose events fell below the floor disappears in the same step that
  // the panel stops claiming to have looked that far back.
  // ── WHO COUNTS AS ACTIVE: TWO SETTINGS, TWO QUESTIONS, AND THE SEPARATION IS DELIBERATE ────
  // Found in a browser rather than in review: `Room.recentlyActive` was called with
  // `ChatPrefs.activityWindowMs()` (device-local) while the bot's rules — `botPresenceSpine`,
  // `botPresenceChat`, `botAfkMs` — are ROOM settings. Two answers to "who is active", each
  // correct by its own rule, and the moment a bot starts, the People panel and the bot's channel
  // membership would list different people with nothing anywhere reporting it.
  //
  // **v268 SPLIT THIS AND GOT HALF OF IT WRONG.** It made the SOURCES room truth and left the
  // WINDOW device-local, reasoning that *what constitutes activity* is a fact about the room while
  // *how far back I personally look* is a display preference. **That reasoning is right about a
  // display and wrong about this surface**, and the correction is a correctness argument rather
  // than a tidiness one:
  //
  // **THE BOT REMOVES PEOPLE FROM A CHANNEL ON ITS THRESHOLD, AND THIS PANEL IS THE SURFACE
  // SHOWING THE BASIS FOR THAT ACTION.** If the panel's window is wider than `botAfkMs`, the panel
  // does not merely disagree — **it says somebody is present while the bot is about to remove
  // them.** That is a false statement about what is about to happen, not a difference of opinion,
  // and no wording on the panel can repair it because the panel would be reporting the wrong rule
  // confidently. DRIVEN both directions before the change: one log, local window 5 min against
  // `botAfkMs` 15 min, produced two different lists.
  //
  // **SO THE WINDOW IS ROOM TRUTH TOO: `botAfkMs`.** `recentlyActive` takes no window at all now —
  // there is no parameter for a caller to disagree through. Every client folds the same rule the
  // bot acts on, and the device-local `activityWindowMs` is REMOVED rather than narrowed: a second
  // knob able to disagree is the collision itself, and a knob narrowed to *cannot disagree* is a
  // control that does nothing, which this tree files as a visible lie.
  //
  // **J20 INHERITS THIS.** Its entry says so; a presence job that read a different window would
  // re-open exactly this.
  //
  // ── AND THE SEPARATION IS ONLY PARTLY EXPRESSIBLE, WHICH IS THE REAL FINDING ────────────────
  // DRIVEN before deciding:
  //   · `botPresenceSpine` IS expressible — the log holds queue acts, so the fold can honour it.
  //   · `botPresenceChat` IS NOT, AND NEVER WILL BE. `_routeEvent` skips chat-named rooms before
  //     `StreamManager.ingest`, so chat is not in the log and cannot be. This is not a filter the
  //     fold is missing; it is data the fold will never have.
  // So a room with `botPresenceChat: true` has a definition of "active" the panel is structurally
  // incapable of computing. **The two WILL disagree, and the honest response is for the panel to
  // SAY SO rather than to imply agreement** — which is why `unobservable` travels with the fold.
  // Merging them by pretending chat can be counted would be the accident this job exists to avoid.
  //
  // THE DEFAULTS AGREE BY COINCIDENCE, NOT DESIGN, which is why this was invisible: shipped
  // `botPresenceSpine: true` matches what the fold counts and `botPresenceChat: false` matches
  // what it cannot. Flip the second and the accident ends.
  //
  // ── A THIRD DIVERGENCE, UNNAMED UNTIL THIS JOB ─────────────────────────────────────────────
  // The fold counted every log entry with a sender, INCLUDING acts the reducer REFUSED. Driven: a
  // settings event from a player is rejected by the fold and still made its sender "active".
  // J13's feed already excludes refused events on the grounds that a refused act did not happen,
  // and the same reasoning applies here even harder — being listed as present because of an act
  // the room threw away is a claim about a person that no event supports. `isLegalFn` is taken
  // rather than reached for, so the arithmetic stays drivable at explicit values.
  const ACTIVITY_SOURCES = { spine: "botPresenceSpine", chat: "botPresenceChat" };
  // The window is the BOT'S THRESHOLD, named here so the reader indexes one table rather than
  // spelling the key — the same reason the sources are in a table, and the same protection when a
  // key is renamed.
  let ACTIVITY_WINDOW_KEY = "botAfkMs";
  // The PRESENCE map's key. Named here beside the window key for the same reason that one is: the
  // panel reads both to state the rule it applied, and a caller supplying either would be the
  // second answer to one question that `foldActivity`'s header is about.
  let ACTIVITY_GROUPS_KEY = "activityPresence";
  function foldActivity(log, nowTs, windowMs, sources, isLegalFn, groupsWanted, groupOfFn) {
    const now = (typeof nowTs === "number" && isFinite(nowTs)) ? nowTs : 0;
    const want = (typeof windowMs === "number" && isFinite(windowMs) && windowMs > 0) ? Math.floor(windowMs) : 0;
    // FAIL CLOSED on absent sources: with no room definition to read, nothing is counted rather
    // than everything. A panel that listed people under a rule nobody set is the collision again.
    const src = (sources && typeof sources === "object") ? sources : { spine: false, chat: false };
    const wantSpine = src.spine === true;
    const wantChat = src.chat === true;
    const legal = (typeof isLegalFn === "function") ? isLegalFn : function () { return true; };
    // FAIL CLOSED, both halves. With no classifier nothing can be classified, so nothing counts;
    // with no wanted-groups map the room has stated no rule, so nothing counts. Defaulting either
    // to permissive would count events under a rule nobody set, which is the collision this whole
    // fold's header is about.
    const groupOf = (typeof groupOfFn === "function") ? groupOfFn : function () { return null; };
    const wantGroups = (groupsWanted && typeof groupsWanted === "object" && !Array.isArray(groupsWanted))
      ? groupsWanted : {};
    const by = Object.create(null);
    let oldest = null, newest = null, counted = 0, refused = 0;
    for (const e of (Array.isArray(log) ? log : [])) {
      if (!e || !e.sender) continue;
      const ts = (typeof e.ts === "number" && isFinite(e.ts)) ? e.ts : 0;
      if (ts <= 0) continue;              // an entry with no server stamp says nothing about when
      // THE LOG IS THE SPINE, because chat never reaches it — so `wantSpine` still covers the
      // whole SOURCE in one test.
      if (!wantSpine) continue;
      // ── BUT NOT EVERYTHING IN THE LOG MEANS SOMEBODY WAS THERE (v322) ─────────────────────
      // This comment used to say there was no per-type list here to drift. That was true and is
      // no longer: `groupOf` classifies each type as an act a PERSON took or one their CLIENT
      // took, and the room says which kinds count. There is still no list in THIS file — the
      // classification is the reducer's and arrives through `Capabilities`, so this is a second
      // CALLER rather than a second copy.
      //
      // THE ONE THAT MATTERS: when a song ends, the DJ's client authors the next `ddjp.dj.play`
      // on its own. Counting it means a person who queued five songs and walked away looks active
      // until their buffer empties — so the AFK rule could never fire for the person it exists
      // for. `groupOf` answers null for it, and null never counts.
      // THE BODY GOES TOO, AND IT DID NOT UNTIL AN AUDIT ASKED. `ddjp.dj.join` carries two
      // meanings — a person joining, and `Queue.submitSong` topping the buffer up from a playlist
      // — and only the body tells them apart. `idleFor` (the QUEUE sweep) was fixed to pass it and
      // this fold (the PRESENCE sweep) was not, so one rule had two answers: a playlist cycling
      // kept somebody in the presence chat forever while the queue correctly let them go.
      //
      // The same signature change, applied to one of its two call paths. That is the shape a
      // per-call-site fix takes when nobody asks who else calls it.
      const grp = groupOf(e.type, e.content);
      if (grp === null) continue;
      if (wantGroups[grp] !== true) continue;
      if (legal(e.eventId) === false) { refused++; continue; }
      counted++;
      if (oldest === null || ts < oldest) oldest = ts;
      if (newest === null || ts > newest) newest = ts;
      const row = by[e.sender] || (by[e.sender] = { userId: e.sender, lastTs: 0, acts: 0 });
      row.acts++;
      if (ts > row.lastTs) row.lastTs = ts;
    }
    // Reach is measured from NOW back to the oldest thing held, never from the newest event —
    // a quiet room whose last event was an hour ago can still see an hour and a half back, and
    // measuring newest-to-oldest would report half an hour and narrow the claim for no reason.
    // Floored at 0 so a stamp from the future (skew) shrinks the claim rather than widening it.
    const reach = (oldest === null) ? 0 : Math.max(0, now - oldest);
    const effectiveWindowMs = Math.min(want, reach);
    const bounded = want > reach;
    const since = now - effectiveWindowMs;
    const people = Object.keys(by).map((k) => by[k])
      .filter((r) => r.lastTs >= since)
      .sort((a, b) => (b.lastTs - a.lastTs) || (a.userId < b.userId ? -1 : 1));
    return { people: people, since: since, reach: reach, oldestTs: oldest, newestTs: newest,
             counted: counted, refused: refused, requestedWindowMs: want,
             effectiveWindowMs: effectiveWindowMs, bounded: bounded,
             // WHAT THE ROOM ASKED FOR, carried so the panel states the rule it is applying rather
             // than one it assumes.
             sources: { spine: wantSpine, chat: wantChat },
             // The GROUPS this fold applied, carried for the same reason `sources` is: a panel
             // stating the rule must state all of it, and "queue actions count" is now too coarse
             // to be the whole rule.
             groups: wantGroups,
             // AND WHAT THIS PANEL CANNOT HONOUR. Non-empty means the room's definition of active
             // is wider than anything computable here, so this list is a SUBSET of the room's and
             // the panel must say so. This is the field that keeps the two definitions separate
             // instead of quietly merged.
             unobservable: wantChat ? ["chat"] : [] };
  }

  // ── HOW LONG SINCE SOMEBODY LAST DID SOMETHING DELIBERATE (v322) ──────────────────────────
  // `botAfkMs` and `botPingMs` have shipped as dials since v283 with NOTHING computing the number
  // they bound. This is that number.
  //
  // ANSWERS THE QUEUE QUESTION, not the presence one, and reads `activityQueue` because of it. A
  // deck held by somebody who has stopped acting blocks the rotation for everybody else, while a
  // chat member who has gone quiet blocks nobody — so the room may want a stricter list and a
  // shorter window here, and the two keys let it have both.
  //
  // RETURNS null RATHER THAN A NUMBER when it cannot answer, and that distinction is the whole
  // contract. `Infinity` or `0` would each be a plausible value a caller could act on: zero says
  // "active right now" and would hold every deck forever; Infinity says "gone forever" and would
  // remove everybody the moment the log could not be read. A caller that cannot tell "idle for an
  // hour" from "I do not know" is a caller that removes people for the second reason.
  //
  // MEASURED FROM THE LAST QUALIFYING ACT, and somebody with NO qualifying act in the log is
  // `{ known: false }` rather than idle-forever — the log's reach is bounded, so their evidence
  // may simply have been trimmed. Removing on absence would remove everybody after a trim.
  function idleFor(userId, nowTs) {
    if (typeof userId !== "string" || !userId) return null;
    const now = (typeof nowTs === "number" && isFinite(nowTs)) ? nowTs : 0;
    if (now <= 0) return null;
    let log = [], settings = null;
    try { log = StreamManager.getLog() || []; } catch (e) { return null; }
    try { settings = StreamManager.getState().settings || null; } catch (e) { return null; }
    if (!settings) return null;
    const groups = settings.activityQueue;
    if (!groups || typeof groups !== "object" || Array.isArray(groups)) return null;
    const windowMs = settings.queueIdleMs;
    if (typeof windowMs !== "number" || !isFinite(windowMs)) return null;

    let last = null, reachOldest = null;
    for (const e of log) {
      const ts = (e && typeof e.ts === "number" && isFinite(e.ts)) ? e.ts : 0;
      if (ts <= 0) continue;
      if (reachOldest === null || ts < reachOldest) reachOldest = ts;
      if (!e.sender || e.sender !== userId) continue;
      // THE BODY GOES TOO. `ddjp.dj.join` means two different things depending on whether it
      // carries a video, and only one of them is a person doing something.
      const grp = (typeof Capabilities !== "undefined" && Capabilities.activityGroupOf)
        // `content` is the PARSED payload — `streammanager.js` normalises every log entry to
        // `{ eventId, type, content, l, ts, roomId, sender }`, so this is the field, not a guess
        // among several.
        ? Capabilities.activityGroupOf(e.type, e.content) : null;
      if (grp === null || groups[grp] !== true) continue;
      // LEGALITY, same as the fold: an act the room REFUSED is not evidence its sender was here
      // in any sense the room recognises. A refused event that still counted would let somebody
      // hold a deck by doing things the room rejects.
      try { if (StreamManager.isLegal && StreamManager.isLegal(e.eventId) === false) continue; }
      catch (err) { /* an unreadable legality is not a reason to discard the act */ }
      if (last === null || ts > last) last = ts;
    }
    if (last === null) {
      // ── NO QUALIFYING ACT HELD — AND THAT IS TWO DIFFERENT ANSWERS ──────────────────────────
      // This returned `known: false` for both of them, and `sweepIdle` skips anyone unknown. So a
      // person who has done NOTHING was skipped forever — which is precisely the person the AFK
      // rule exists for.
      //
      // REPORTED FROM A LIVE ROOM: both windows set to two minutes, and after three there was no
      // ping and no bot action. It became reachable the moment buffer top-ups stopped counting:
      // before that a playlist kept somebody permanently "active", and after it they had no
      // qualifying acts at all. **Both states look identical from outside — nothing happens.**
      //
      // `reachMs` WAS ALREADY HERE TO SEPARATE THEM and nothing read it. If this client can see
      // back at least a full window and found nothing in it, the person is idle for AT LEAST that
      // window — that is a measurement, not a guess. Only a client that cannot see back far enough
      // genuinely does not know.
      const reachMs = (reachOldest === null) ? 0 : Math.max(0, now - reachOldest);
      if (reachMs >= windowMs) {
        // IDLE FOR AT LEAST THE REACH, reported as exactly that. It is a LOWER BOUND — they may
        // have been idle longer than this client can see — and `overdue` is the only question the
        // sweep asks, which the bound answers on its own.
        return { known: true, idleMs: reachMs, overdue: true, windowMs: windowMs,
                 lastTs: null, reachMs: reachMs, bounded: true };
      }
      return { known: false, idleMs: null, overdue: false, windowMs: windowMs,
               reachMs: reachMs };
    }
    const idleMs = Math.max(0, now - last);
    return { known: true, idleMs: idleMs, overdue: idleMs >= windowMs, windowMs: windowMs,
             lastTs: last, reachMs: (reachOldest === null) ? 0 : Math.max(0, now - reachOldest) };
  }

  // The live reader. Thin on purpose: the log lives behind the backend interface and the fold above
  // is pure, so this is the only line that has to be right about WHERE the log comes from. It reads
  // `getLog()` on every call rather than caching, because a cached list would go on naming somebody
  // after a trim had removed the evidence for them.
  // The live reader. THE SOURCES COME FROM ROOM SETTINGS AND THE WINDOW FROM THE CALLER — that
  // split is the whole decision, in one function. Read fresh on every call, like the log: a cached
  // rule would go on applying a definition the owner has since changed.
  // NO WINDOW PARAMETER. The rule — window AND sources — is read from the room, so there is
  // nothing for a caller to supply and therefore nothing for a caller to disagree through. A
  // signature that still accepted one would leave the collision available to the next caller who
  // had a window to hand.
  function recentlyActive(nowTs) {
    let log = [], legal = null, sources = null, windowMs = 0, groups = null;
    try { log = StreamManager.getLog() || []; } catch (e) { log = []; }
    try { legal = StreamManager.isLegal; } catch (e) { legal = null; }
    try {
      const s = StreamManager.getState().settings || {};
      sources = { spine: s[ACTIVITY_SOURCES.spine] === true, chat: s[ACTIVITY_SOURCES.chat] === true };
      // FAIL CLOSED on an unreadable window, exactly as the sources do: a fold with no window
      // counts nobody, which is a visible failure. Substituting a default here would be inventing
      // a rule nobody set — the second source this change exists to remove, arriving as a fallback.
      const wk = api.ACTIVITY_WINDOW_KEY;
      windowMs = (typeof s[wk] === "number" && isFinite(s[wk])) ? s[wk] : 0;
      // WHICH MAP, named by the caller's purpose rather than assumed. `recentlyActive` answers
      // the PRESENCE question — it is what the people panel renders — so it reads the presence
      // map. `idleFor` below reads the queue map, and the two are separate keys because the room
      // may answer them differently. Fail closed on an unreadable one, like the window above.
      const g = s[api.ACTIVITY_GROUPS_KEY];
      groups = (g && typeof g === "object" && !Array.isArray(g)) ? g : null;
    } catch (e) { sources = null; windowMs = 0; groups = null; }
    return foldActivity(log, nowTs, windowMs, sources,
                        legal ? (id) => StreamManager.isLegal(id) : null,
                        groups,
                        // TYPEOF-GUARDED, like every other cross-module reach in this file. This
                        // runs on EVERY render: a throw here would take the people panel down,
                        // while an absent classifier fails closed and shows nobody — visibly wrong
                        // rather than broken. The same reasoning `MediaBlocked` and `MediaLength`
                        // are wrapped for at their init sites.
                        (typeof Capabilities !== "undefined" && Capabilities.activityGroupOf)
                          ? Capabilities.activityGroupOf : null);
  }

  // ── THE EVENT FEED (J13) ───────────────────────────────────────────────────────────────────
  // A readable running list of what has happened in the room, folded out of the log on every
  // render and holding NO state of its own (P5) — the same shape as `foldActivity` above and for
  // the same reasons, which is why it lives beside it rather than in `ui/` (rule D; §9 entry S).
  //
  // ── WHAT THE JOB ENTRY GOT WRONG, AND IT IS THE DONE-WHEN ──────────────────────────────────
  // The entry asks for "a feed that starts at the floor, not an empty one with no explanation".
  // DRIVEN (`probe-j13-feed.js` R2/R3) — BOTH HALVES OF THAT SENTENCE ARE FALSE:
  //   · A feed can never start AT the floor. `trimToFloor` keeps `e.l > floorL` STRICTLY: the
  //     boundary event is at the floor and is already banked into its seed, so keeping it would
  //     double-count. The oldest row a feed can hold is the first event strictly ABOVE the floor.
  //   · The empty feed is REACHABLE AND CORRECT. A room that seals at its own head holds nothing
  //     above the floor at all — measured, 0 rows — while `getState()` still carries a live
  //     `nowPlaying` from the seed. "Not an empty one" would have the feed fabricate rows it does
  //     not have, which is the one thing a feed must never do.
  // What survives is the half the entry buried: NOT WITH NO EXPLANATION. So the feed states where
  // its reach begins and why, as a READING of what it holds rather than a claim about the floor —
  // the same honesty `foldActivity` applies to its window, and for the same reason.
  //
  // ── HOW AN EMPTY FEED KNOWS WHICH EMPTY IT IS, USING ONLY THE CONTRACT ─────────────────────
  // Two empties look identical from the log alone: a room where nothing has happened yet, and a
  // room whose every row was banked and forgotten. The discriminator is STATE WITHOUT EVIDENCE —
  // rows=0 while `getState()` still describes a running room. Driven across all four cases (R4):
  // fresh client (no state, no rows), young room (state, rows), trimmed part-way (state, rows),
  // trimmed at the head (state, NO rows). Only the last has a room and nothing to show for it.
  //
  // This reads `getLog()` and `getState()` and NOTHING ELSE, which is deliberate: both are on the
  // backend interface, so the discriminator survives a backend swap. The tempting alternative is
  // `StreamManager._trimState()`, which is a GUARD SEAM — an underscore private that a lite or
  // bot backend need not have. Rule F is textual and would not have caught that (StreamManager is
  // an interface global), but the reason rule F exists would. Same answer, contract-shaped.
  // It also covers the IMPORTED room (J46) with no second rule: a client folding from a file's
  // seed has state and no rows, and "the rows before this point are not held by this client" is
  // true of it too.
  //
  // ── A REFUSED EVENT IS STILL IN THE LOG, AND A FEED MUST NOT NARRATE IT ────────────────────
  // Measured (R5): `getLog()` holds what the reducer REFUSED as well as what it accepted — a
  // settings blob from a player, a reset from a guest, a stale skip. `isLegal` discriminates
  // within one kind on one fixture with one detail changed. A feed that listed them would be
  // `roles.md` §10's SECOND SIGNATURE exactly: a narrative naming an action nobody took, which
  // survives review because the reader infers a mechanism and moves on. So refused rows are
  // EXCLUDED from the narration and COUNTED, and the panel states the count — dropping them
  // silently would make the feed under-report without saying so.
  //
  // ONE DIRECTION IS INHERITED AND IS WRITTEN DOWN RATHER THAN FIXED: `isLegal` answers TRUE when
  // the derive failed (`legalIds` null), because over-protecting is the safe failure for the vouch
  // layer that owns it. So on a broken derive this feed narrates everything. That is the contract's
  // choice, not this fold's, and re-deciding it here would be a second copy of a rule (P7).
  //
  // ── THE KINDS ARE A DECISION PER TYPE, NOT A LIST SOMEBODY REMEMBERED ──────────────────────
  // `FEED_KINDS` maps a protocol type to how the feed says it. Every type the reducer handles must
  // be either NAMED here or listed in `FEED_UNNAMED` with a reason — `check-event-feed` PART G
  // fails on a type that is in neither, so a new event type is covered the day it is added rather
  // than inheriting an answer nobody chose (`08-build-and-deploy.md` §Decide, do not merely gate;
  // the same move that fixed the six missing `ddjp.media.skip` subscriptions).
  //
  // AND CHAT IS NOT AMONG THEM, WHICH IS THE SAME LIMIT J16 HAD TO STATE. `_routeEvent` skips
  // chat-named rooms BEFORE both `EventCache.store` and `StreamManager.ingest`, so a chat message
  // reaches the raw listeners and nothing else. The entry's six named kinds are all reachable;
  // chat would have been a seventh and is not, and the panel says so rather than implying it.
  const FEED_KINDS = {
    "ddjp.dj.join":       { verb: "joined the DJ queue",        group: "rotation" },
    "ddjp.dj.leave":      { verb: "left the DJ queue",          group: "rotation" },
    "ddjp.dj.play":       { verb: "started a song",             group: "playback" },
    "ddjp.dj.skip":       { verb: "skipped a song",             group: "playback" },
    "ddjp.media.skip":    { verb: "skipped an unplayable song", group: "playback" },
    "ddjp.dj.vote":       { verb: "upvoted the song",           group: "reaction" },
    "ddjp.dj.save":       { verb: "saved the song",             group: "reaction" },
    "ddjp.room.settings": { verb: "changed the room settings",  group: "settings" },
    "ddjp.dj.strike":     { verb: "struck a song",              group: "moderation" },
    "ddjp.dj.remove":     { verb: "removed a DJ",               group: "moderation" },
    "ddjp.dj.reset":      { verb: "reset the rotation",         group: "moderation" },
    "ddjp.dj.move":       { verb: "moved a DJ",                 group: "moderation" },
  };
  // Handled by the reducer, deliberately NOT narrated. Each carries its reason, because "absent
  // from the feed" and "nobody decided" are different states and only one of them is fine.
  const FEED_UNNAMED = {
    "ddjp.dj.declare":   "your own buffer, not a room act — a feed of these is a feed of typing",
    "ddjp.dj.undeclare": "same: the private buffer, not the room",
    "ddjp.dj.order":     "same: reordering your own buffer changes nothing anybody else sees",
    "ddjp.play.len":     "a per-client measurement of the SAME song, one per person per playing — " +
                         "narrating them would bury every real act under a length declaration",
    "ddjp.play.blocked": "same shape: a report about one person's player, not a room act",
    "ddjp.count.set":    "an owner correction to a display tally; the tally is display-level (P5)",
  };

  // Pure. Ordered log in, feed rows out — newest first, because a running list is read from the
  // top. Takes `isLegalFn` rather than reaching for `StreamManager` so the arithmetic can be
  // driven at explicit values, exactly like `foldActivity` takes `nowTs`.
  function foldFeed(log, isLegalFn, opts) {
    const o = opts || {};
    const limit = (typeof o.limit === "number" && isFinite(o.limit) && o.limit > 0)
      ? Math.floor(o.limit) : 200;
    const legal = (typeof isLegalFn === "function") ? isLegalFn : function () { return true; };
    const rows = [];
    let refused = 0, unnamed = 0, counted = 0;
    let oldestTs = null, newestTs = null, oldestL = null;
    for (const e of (Array.isArray(log) ? log : [])) {
      if (!e || !e.eventId || !e.type) continue;
      const ts = (typeof e.ts === "number" && isFinite(e.ts)) ? e.ts : 0;
      const l = (typeof e.l === "number" && isFinite(e.l)) ? e.l : null;
      counted++;
      // The reach is measured over EVERYTHING held, named or not, because it answers "how far back
      // does this client see" rather than "how far back does it narrate". Measuring it over the
      // narrated rows alone would report a shorter reach in a room full of length declarations.
      if (ts > 0) {
        if (oldestTs === null || ts < oldestTs) oldestTs = ts;
        if (newestTs === null || ts > newestTs) newestTs = ts;
      }
      if (l !== null && (oldestL === null || l < oldestL)) oldestL = l;
      // REFUSED FIRST, so an event the room rejected is never narrated whatever its kind.
      let ok = true;
      try { ok = legal(e.eventId) !== false; } catch (err) { ok = true; }
      if (!ok) { refused++; continue; }
      const k = FEED_KINDS[e.type];
      if (!k) { unnamed++; continue; }
      rows.push({ eventId: e.eventId, type: e.type, verb: k.verb, group: k.group,
                  sender: e.sender || null, ts: ts, l: l });
    }
    // Newest first, ties broken by id — the reducer's own key read backwards, so two events at one
    // position have a stable order here rather than whichever the sort happened to leave.
    rows.sort((a, b) => (b.ts - a.ts) || ((a.eventId < b.eventId) ? 1 : (a.eventId > b.eventId ? -1 : 0)));
    const total = rows.length;
    const shown = rows.slice(0, limit);
    return {
      rows: shown, total: total, truncated: total > limit, limit: limit,
      counted: counted, refused: refused, unnamed: unnamed,
      oldestTs: oldestTs, newestTs: newestTs, oldestL: oldestL,
      // `held` is what the feed can see; `roomExists` is whether there is a room to see. Their
      // DISAGREEMENT is the whole discriminator, so both travel with the fold rather than being
      // recomputed by the panel from two calls that could be answered a render apart.
      held: counted, roomExists: !!o.roomExists,
      // The three states, decided HERE so the panel renders a verdict rather than deriving one.
      // A second copy of this reasoning in `ui/` is the drift P7 is about.
      origin: counted > 0 ? "held" : (o.roomExists ? "forgotten" : "nothing-yet"),
    };
  }

  // The live reader. Thin for the same reason `recentlyActive` is: the log lives behind the
  // interface, the fold above is pure, and this is the only line that has to be right about where
  // the inputs come from. Reads on every call rather than caching — a cached feed would go on
  // narrating rows whose evidence a trim has destroyed.
  function recentEvents(opts) {
    let log = [], legal = null, roomExists = false;
    try { log = StreamManager.getLog() || []; } catch (e) { log = []; }
    try { legal = StreamManager.isLegal; } catch (e) { legal = null; }
    try {
      const st = StreamManager.getState();
      roomExists = !!(st && (st.nowPlaying || (st.rotation && st.rotation.length > 0)));
    } catch (e) { roomExists = false; }
    return foldFeed(log, legal ? (id) => StreamManager.isLegal(id) : null,
                    Object.assign({}, opts, { roomExists: roomExists }));
  }

  // ── EXPORTING A CHECKPOINT (J26) ─────────────────────────────────────────────────────────
  // Two thin passthroughs, and the thinness is the point: the held list lives in `Floor` and the
  // file format in `CheckpointFormat`, both walled backend internals (check-boundaries rule F),
  // so the app reaches them only through the interface. Nothing is decided here — this layer adds
  // the one fact the backend cannot know, which is WHICH ROOM the held checkpoints belong to.
  //
  // AND THAT FACT IS LOAD-BEARING, not a label. `Floor.reset()` runs on room ENTRY (via
  // `_initModules` -> `MatrixBridge.resetCheckpoints`), never on leave — so after backing out to
  // the room list the client still holds the LAST room's checkpoints, which is exactly what makes
  // a lobby export control possible at all. It also means the list is about ONE room and not about
  // whichever row the user is looking at: `current` is reassigned in the same step that clears the
  // floor, so these two always name the same room. A checkpoint seed carries no room id (driven —
  // probe-j26-export.js R6 and the seed's own key list), so this is the only place the answer
  // exists. Offering the export per room-row would silently serve one room's state under another
  // room's name.
  function heldCheckpoints() {
    const held = StreamManager.heldCheckpoints ? StreamManager.heldCheckpoints() : [];
    return { room: current ? { name: current.name, spaceId: current.spaceId } : null, held: held };
  }
  function exportCheckpoint(id) {
    return StreamManager.exportCheckpoint ? StreamManager.exportCheckpoint(id)
                                          : { ok: false, reason: "no-backend-support" };
  }

  // The authority rule, in one pure place so it can be tested:
  //   - only Staff+ may set anyone's rank
  //   - you can only touch someone strictly below you (outranked or rank-matched -> denied)
  //   - you can only set a rank strictly below your own (no granting at/above yourself)
  // NOTE: this deliberately does not know about channel existence — that's a
  // separate, orthogonal gate (see highestUnlockedRank below) so the pure
  // authority rule stays exactly what tests/check-authority.js exercises.
  // The threshold lives in Ranks, reached BY NAME through Capabilities.
  // ── HAS THIS SONG PLAYED TOO RECENTLY TO PLAY AGAIN? ─────────────────────────────────────────
  // ONE reading, two callers, and they must not each grow their own: the bot decides whether to
  // skip the song on air, and every client decides whether to let a song into a personal queue. A
  // second copy of this arithmetic is the drift this project records twice.
  //
  // IT READS THE `History` MODULE, NOT THE FOLD. `state.history` restarts at the floor once a
  // client trims, so a trimmed client would forget a play it can still account for. `History`
  // keeps its own list and pages back past the floor, which is the whole reason it was separated.
  //
  // A PLAY COUNTS ONCE ANOTHER SONG HAS STARTED AFTER IT. A row enters the history when a song
  // STARTS, so the currently-playing song is already in the list — read naively, every song is a
  // repeat of itself and the room skips everything. The live playing is excluded by `pi` rather
  // than by dropping the last row, because with nothing playing the last row is a song that really
  // did play and dropping it would lose a real answer.
  //
  // A REPEAT-SKIP DOES NOT COUNT AS A PLAY. `endedBy === "repeat"` marks a playing a bot cut short
  // for this very rule. Counting it would restart the clock on every attempt — blocked until
  // 11:30, tried again, blocked until 12:30 — until a song people keep queuing is permanently
  // unplayable with nothing saying why. The clock measures from the play that actually happened.
  //
  // THREE ANSWERS, NOT TWO, and the third is why this can be trusted. `known: false` means the
  // history does not reach back a full window, so the question CANNOT be answered — and it never
  // blocks. Treating a short reach as "definitely fresh" is a guess; treating it as "definitely
  // played" would empty every queue after a trim. Same rule and same direction as `idleFor`'s
  // `known: false`, for the same reason.
  //
  // THE RETURN IS SHAPED FOR A SURFACE THAT DOES NOT EXIST YET. Everything a panel would need to
  // explain a refusal — when it last played, when it becomes allowed, how long that is, and how
  // far back this client could actually see — is returned rather than reduced to a boolean, and
  // NONE of it is formatted here. Formatting is a UI concern (`04-features.md` §Room History), and
  // a feature that returned a sentence would be a feature the UI cannot re-word.
  // Held by `check-repeat-cooldown` PARTs D and E: the three answers and the window boundary on
  // both sides, the live playing excluded by `pi` while an earlier playing of the same song still
  // counts, and a playing this rule cut short not counting as a play.
  function playedWithin(videoId, nowTs) {
    const off = { blocked: false, known: true, reason: "off", cooldownMs: 0, at: null,
                  agoMs: null, allowedAt: null, waitMs: null, reach: null, complete: false };
    if (typeof videoId !== "string" || !videoId) return Object.assign({}, off, { reason: "no-video" });

    let cooldownMs = 0;
    try {
      const v = getSettings().repeatCooldownMs;
      if (typeof v === "number" && isFinite(v) && v > 0) cooldownMs = v;
    } catch (e) { cooldownMs = 0; }
    if (!cooldownMs) return off;

    // THE SHARED CLOCK, NEVER `Date.now()`. Every stamp compared here is a server stamp, and this
    // project's second standing trap is mixing the two. No offset yet means no measurement — which
    // is a `known: false`, not a fallback to the device clock.
    let now = (typeof nowTs === "number" && isFinite(nowTs) && nowTs > 0) ? nowTs : 0;
    if (!now) {
      try { if (typeof ServerClock !== "undefined" && ServerClock.serverNow) now = ServerClock.serverNow(); }
      catch (e) { now = 0; }
    }
    const base = { blocked: false, known: false, reason: null, cooldownMs: cooldownMs, at: null,
                   agoMs: null, allowedAt: null, waitMs: null, reach: null, complete: false };
    if (!now) return Object.assign({}, base, { reason: "no-clock" });

    let rows = [];
    try { rows = Queue.recentHistory() || []; } catch (e) { rows = []; }   // newest first
    let cov = null;
    try { cov = Queue.historyReach(); } catch (e) { cov = null; }
    const complete = !!(cov && cov.complete);

    let livePi = null;
    try {
      const np = StreamManager.getState().nowPlaying;
      livePi = (np && np.pi) ? np.pi : null;
    } catch (e) { livePi = null; }

    // How far back this client can actually account for. `complete` means it reached the room's
    // beginning, so a short list is a COMPLETE answer rather than a shallow one — the same
    // distinction `foldActivity` draws, and the reason a young room does not read as unknowable.
    let oldestAt = 0;
    for (const r of rows) { if (r && typeof r.at === "number" && r.at > 0) oldestAt = r.at; }
    const reach = complete ? null : (oldestAt ? Math.max(0, now - oldestAt) : 0);

    for (const r of rows) {                       // newest first: the first match is the last play
      if (!r || r.videoId !== videoId) continue;
      if (livePi && r.pi === livePi) continue;    // the song on air is not a repeat of itself
      if (r.endedBy === "repeat") continue;       // a play this rule already cut short is not a play
      const at = (typeof r.at === "number" && r.at > 0) ? r.at : 0;
      if (!at) continue;
      const allowedAt = at + cooldownMs;
      return { blocked: now < allowedAt, known: true, reason: "played", cooldownMs: cooldownMs,
               at: at, agoMs: Math.max(0, now - at), allowedAt: allowedAt,
               waitMs: Math.max(0, allowedAt - now), reach: reach, complete: complete };
    }

    // Nothing found. That is an ANSWER only if this client could have seen a play that old.
    if (complete || (reach !== null && reach >= cooldownMs)) {
      return Object.assign({}, base, { known: true, reason: "not-played", reach: reach, complete: complete });
    }
    return Object.assign({}, base, { reason: "short-reach", reach: reach, complete: complete });
  }

  function canQueue(videoId, nowTs) {
    const v = playedWithin(videoId, nowTs);
    if (!v.blocked) return { ok: true, code: null, reason: null, detail: v };
    return {
      ok: false,
      // A CODE FOR THE CALLER, A SENTENCE FOR TODAY'S PANELS. Both add surfaces render `reason`
      // as text right now, so removing it would break them; `code` and `detail` are what a surface
      // that wants to say more reads instead, and it can be written without touching this file.
      code: "repeat-cooldown",
      reason: "played too recently",
      detail: v,
    };
  }

  function canAssignRank(actorRank, targetRank, newLevel) {
    if (typeof newLevel !== "number" || newLevel < 0) return false;
    if (!Capabilities.atLeast(actorRank, "staff")) return false;   // only Staff+ may assign
    if (targetRank >= actorRank) return false;   // can't touch equals or superiors
    if (newLevel >= actorRank) return false;     // can't grant at or above yourself
    return true;
  }

  // ── THE MEMBERSHIP ACTS (J14) ────────────────────────────────────────────────────────────────
  // The authority rule for kick and ban, in one pure place beside `canAssignRank` and shaped to
  // match it: the gate, then the target strictly below the actor. No `newLevel` half, because a
  // removal grants nothing — and the same single comparison is what refuses acting on yourself,
  // since nobody is strictly below themselves.
  //
  // WHY THIS EXISTS AT ALL WHEN `Capabilities.can` ALREADY ANSWERS IT. Because for a MEMBERSHIP
  // act there is no reducer to be the backstop. Every gated verb in this tree has two enforcers —
  // the rulebook that renders the button and the fold that judges the event — and kick and ban
  // have only the first, plus a homeserver that will refuse a power level but knows nothing about
  // "strictly below". So this predicate is the second enforcer, and the ranks it reads are read
  // LIVE from Matrix at call time rather than taken from the click: a descriptor rendered before
  // a promotion must not authorise an act after one.
  //
  // It is asked THROUGH Capabilities rather than restating the rule, so the two cannot drift.
  function canModerate(verb, actorRank, targetRank) {
    if (typeof actorRank !== "number" || typeof targetRank !== "number") return false;
    const d = Capabilities.can(verb, {}, { myRank: actorRank, target: { targetRank: targetRank } });
    return !!(d && d.permitted);
  }

  // Shared body for kick and ban. Reads both ranks live, re-checks the rule, then hands off to
  // the transport, which owns the all-or-nothing rule across the room set and returns the verdict
  // unchanged — this layer restates none of it, for the same reason `getSettings` restates no
  // setting shape.
  async function _moderate(verb, userId, reason) {
    if (!current) return { ok: false, reason: "no-room" };
    const me = MatrixBridge.getUserId();
    if (userId === me) {
      Logger.warn("Room: you can't remove yourself from the room");
      return { ok: false, reason: "self" };
    }
    const actorRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, me);
    const targetRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, userId);
    if (!canModerate(verb, actorRank, targetRank)) {
      Logger.warn("Room: " + verb + " denied (you=" + actorRank + ", them=" + targetRank + ")");
      return { ok: false, reason: "denied" };
    }
    const fn = (verb === "member.ban") ? MatrixBridge.banFromRoom : MatrixBridge.kickFromRoom;
    const res = await fn(current.spaceId, current.channels, userId, reason);
    Logger.info("Room: " + verb + " of " + userId + " -> " +
      (res && res.ok ? "complete" : "INCOMPLETE (" + ((res && res.closed) || 0) + "/" + ((res && res.total) || 0) + ")"));
    return res;
  }

  // A KICK REMOVES, IT DOES NOT KEEP OUT — and the caller is told so rather than left to assume.
  // Every read-by-all channel is created `restricted` on Space membership, so a kicked user who
  // can re-enter the Space is re-admitted to all of them automatically. Whether they can re-enter
  // is the Space's own join rule, which is live Matrix state and read here rather than guessed.
  //
  // THE CLAIM IS MADE IN THE DIRECTION IT IS SOUND, which needs saying because the tempting
  // version is not. `getSpaceVisibility` answers `"private"` both for a Space that really is
  // invite-only AND for one this client cannot read at all, so `!== "public"` would report a
  // closed door on no evidence — a message naming a protection it has not established, which is
  // `roles.md` §10's second signature. Only `public` is affirmative here: it is read as `"open"`,
  // meaning re-entry is certain. Everything else is `"gated"`, and the surface's leading sentence
  // ("removes them now, does not keep them out") is true under BOTH, so the reading only ever
  // sharpens a claim that is already correct.
  async function kick(userId, reason) {
    const res = await _moderate("member.kick", userId, reason);
    if (!res || !res.ok) return res;
    let vis = null;
    try { vis = MatrixBridge.getSpaceVisibility(current.spaceId); } catch (e) { vis = null; }
    return Object.assign({}, res, { reentry: (vis === "public") ? "open" : "gated" });
  }
  async function ban(userId, reason) { return _moderate("member.ban", userId, reason); }

  // Pure: does this rank's events channel exist yet? A room can't offer or
  // grant a rank it hasn't unlocked — unlocking happens in batches
  // (RoomUpgrade); granting an unlocked rank would leave the assigned user
  // with no events/checkpoints/chat channel to use. The level -> events-channel
  // key comes from the single channel taxonomy in transport (no local copy).
  function isRankUnlocked(channels, level) {
    if (!channels) return level === 0;   // Uncategorized always exists conceptually
    const key = MatrixBridge.eventsKeyForLevel(level);
    return key ? !!channels[key] : false;
  }

  // The highest rank level whose channels exist, for display purposes (e.g.
  // "all ranks unlocked" UI text). NOT used to gate individual grants — use
  // isRankUnlocked for that, since Owner's channel existing from creation
  // doesn't imply the batch ladder in between has caught up.
  // The ladder, re-exported for ui/. `ui/` may not reach `Capabilities` directly
  // (check-boundaries rule, and check-ui-no-permission) — it must come through a feature
  // module. Levels are the ladder's; display strings are the UI's business and are NOT here.
  function rankLadder() { return Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level })); }

  function highestUnlockedRank(channels) {
    if (!channels) return 0;
    let max = 0;
    // THE LADDER IS READ, NOT RESTATED. This was `[0, 10, 20, 40, 60, 80, 100]` — a hand-written
    // copy that silently disagreed with `Ranks` the moment the owner rung moved from 100 to 99.
    // `Capabilities.LADDER` is the legal way for a feature to reach it (check-boundaries rule F);
    // ascending order matters because the loop keeps the LAST unlocked level.
    const LEVELS = Capabilities.LADDER.map((r) => r.level).sort((a, b) => a - b);
    for (const level of LEVELS) {
      if (isRankUnlocked(channels, level)) max = level;
    }
    return max;
  }

  // Promote/demote. Reads the actor's and target's true authority across all
  // channels first, denies if the actor doesn't strictly outrank both the target
  // and the new level, denies if the room hasn't unlocked the requested rank's
  // channels yet, then sets the target's power across every room.
  // ── MY AUTHORITY LEVEL, WHICH IS NOT MY CHANNEL TIER ──────────────────────────────────────
  // `getMyRank()` answers the highest EVENTS CHANNEL this client can write to. That caps at the
  // owner channel's rank, so a human owner holding Matrix power level 100 answers **99** from it —
  // the same number the bot answers, because both can write there. It is the right reading for
  // "what may I author"; it is the wrong one for "who outranks whom".
  //
  // REPORTED FROM A LIVE ROOM: the owner upgraded a room and the rank dropdown had no Owner option.
  // The rule is "only ranks strictly below your own", the UI asked `getMyRank()`, and `99 < 99` is
  // false — so the one person entitled to appoint a bot could never see the option. `member.kick`
  // and `member.ban` read the same way and are refused against anyone at 99 for the same reason.
  //
  // MEASURED, not assumed: across every verb and target shape, exactly three answers differ between
  // 99 and 100 — `rank.assign`, `member.kick` and `member.ban`, all of them against a target at the
  // top rung. `check-authority-level` derives that set rather than listing it.
  //
  // `getUserEffectiveRank` takes the highest level held across the SPACE and every channel, and the
  // Space is where a human owner's 100 lives. `assignRank` below already enforces with it, which is
  // why the ACT was never broken — only the control that offers it. Enforcement and display
  // disagreeing is how a capability comes to be enforced correctly and shown wrongly.
  function getMyAuthorityLevel() {
    if (!current) return 0;
    try {
      return MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels,
                                               MatrixBridge.getUserId());
    } catch (e) { return 0; }
  }

  async function assignRank(userId, level) {
    if (!current) return false;
    const me = MatrixBridge.getUserId();
    if (userId === me) { Logger.warn("Room: you can't change your own rank"); return false; }
    const actorRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, me);
    const targetRank = MatrixBridge.getUserEffectiveRank(current.spaceId, current.channels, userId);
    if (!canAssignRank(actorRank, targetRank, level)) {
      Logger.warn("Room: rank change denied (you=" + actorRank + ", them=" + targetRank + ", requested=" + level + ")");
      return false;
    }
    if (!isRankUnlocked(current.channels, level)) {
      Logger.warn("Room: rank change denied — level " + level + " has no channels yet (room not upgraded)");
      return false;
    }
    await MatrixBridge.assignRank(current.spaceId, current.channels, userId, level);
    Logger.info("Room: assigned " + userId + " to level " + level);
    return true;
  }

  // ── THE OWNER BOT ─────────────────────────────────────────────────────────────────────────
  // The bot is not a mode anyone switches on. It is what this client BECOMES when the account it
  // is signed in as holds the bot's level in this room, and it stops being one the moment that
  // stops being true. There is no button, no setting and no stored preference, because every one
  // of those would be a SECOND source for a fact Matrix already holds — and the owner grants the
  // level in Matrix either way, so a switch could only ever agree or disagree with it.
  //
  // WIRED AT ONE DOOR. `_initModules` is the single place both room-entry paths pass through
  // (create and join), and the rank hook below covers the level changing while we sit here. A
  // start placed at the two entry sites instead would be the shape J15 found: a rule enforced at
  // one door out of two, correct everywhere the author looked.
  //
  // STOPPED BEFORE STARTED. `_initModules` runs on every room entry including a SWITCH, and a
  // runtime left over from the previous room would go on watching this one — the raw fan-out is
  // not scoped to a room, so it would act on requests from a room the user has left, at a level
  // they may not hold here. That is a leak of AUTHORITY, not of memory, and the ORDER is what
  // prevents it: a stop placed after the start would stop the runtime just started, which
  // `check-bot-wiring` PART C drives.
  //
  // The stop is unconditional because `stop()` on a stopped runtime answers `not-running`
  // harmlessly, so a guard around it could only ever be wrong. MEASURED at v322 rather than
  // asserted: `current` is never set back to null anywhere in this file, and both callers reach
  // here with it set — `_initModules` assigns it immediately before, and `_rewireWriteChannel`
  // returns early without it. So the early-return below cannot currently fire, and its position
  // relative to the stop makes no observable difference. Kept defensive, described as defensive.
  function _evaluateBot() {
    if (typeof BotRuntime === "undefined") return;
    try { BotRuntime.stop(); } catch (e) {}
    if (!current || !current.spaceId) return;

    // THE LEVEL IS READ BY THE RUNTIME, NOT PASSED. `start` takes no level argument on purpose:
    // a caller that could supply one could supply the bot's, and the gate would then be checking
    // this function's claim rather than the room's state. All we hand over is WHERE to look.
    let r = null;
    try {
      r = BotRuntime.start({
        roomId: current.spaceId,
        channels: current.channels,
        // The bot authors settings through the SAME writer the panel uses. Not a second write
        // path: `setSettings` merges onto the current blob and posts the full thing, which is the
        // only shape last-write-wins tolerates. A bot with its own writer would be the second
        // copy that eventually posts a partial blob and silently drops every key it forgot.
        //
        // WRAPPED, BECAUSE THE TWO CALLERS NEED DIFFERENT THINGS FROM A FAILURE (v322 audit).
        // `setSettings` is total and does not throw — the panel wants that, and ignores the
        // return. `authorIfPermitted` reads "did not throw" as "wrote", so handing it the bare
        // function made every silent failure — no channel, a send that threw, a rank lost between
        // the gate and the write — arrive as `ok: true`, and `BotRuntime` counted it as ACTED. A
        // write that never happened, reported as success, to a requester who gets silence either
        // way. This is the ONLY place that translation belongs: changing `setSettings` to throw
        // would push it onto the panel, which has a person watching and does not need it.
        authorSettings: async (partial) => {
          const r = await setSettings(partial);
          if (!r || !r.ok) {
            throw new Error("settings write did not land" + (r && r.reason ? " (" + r.reason + ")" : ""));
          }
          return r;
        },
      });
    } catch (e) { Logger.warn("Room: bot evaluation failed — " + (e && e.message)); return; }

    if (r && r.ok) {
      Logger.info("Room: bot mode ON at level " + r.level + " (" + r.mode + ")");
      _warnIfSecondBot(r.level);
      return;
    }
    // NOT AN ERROR AND NOT LOGGED AS ONE. Every ordinary client reaches this line on every room
    // entry — `too-low` is the answer for everybody who is not the bot, which is nearly everybody.
    // Logging it at warn would put a scary line in every user's console forever.
    if (r && r.reason && r.reason !== "too-low") {
      Logger.info("Room: bot mode off (" + r.reason + ") — " + (r.detail || ""));
    }
  }

  // ── TWO BOTS IS A THING WE DETECT, NOT A THING WE PREVENT ─────────────────────────────────
  // Power levels can be set from any Matrix client, so this app cannot stop a second account
  // reaching the bot's level — the same gap J52 already names for the upgrade gate. What it CAN
  // do is notice, and say so, which turns a silent lost update into a visible warning.
  //
  // Why it matters concretely: two accounts at the bot's level are two authorities on a settings
  // blob that is LAST-WRITE-WINS over the whole object. They do not merge, they overwrite, and
  // the loser's change vanishes with nothing anywhere reporting it. That is the failure `eligible`
  // already refuses the HUMAN owner for; this is the same failure between two bots.
  //
  // DETECTION ONLY: it changes no behaviour and blocks no start. A room that has somehow ended up
  // with two is still a room, and refusing to run would leave it with none — which is worse than
  // running with a warning a person can act on.
  function _warnIfSecondBot(level) {
    let seen = null;
    try { seen = MatrixBridge.accountsAtLevel(current.spaceId, level); } catch (e) { return; }
    if (!seen) return;
    if (seen.defaultIsLevel) {
      Logger.warn("Room: this room's DEFAULT power level is the bot's (" + level + "), so every " +
                  "member is eligible to run as the owner bot. Settings writes will overwrite each " +
                  "other silently. The default should be lowered.");
      return;
    }
    if (seen.who.length > 1) {
      Logger.warn("Room: " + seen.who.length + " accounts hold the bot's level (" + level + "): " +
                  seen.who.join(", ") + ". Settings are last-write-wins over the whole blob, so two " +
                  "bots will overwrite each other with nothing reporting the loss. Demote all but one.");
    }
  }

  // The bot's own reading, for anything that wants to show it. A fresh object from the runtime,
  // never a reference into it.
  function botStatus() {
    if (typeof BotRuntime === "undefined") return { running: false, mode: null, level: null, seen: 0, acted: 0, refused: 0 };
    try { return BotRuntime.status(); }
    catch (e) { return { running: false, mode: null, level: null, seen: 0, acted: 0, refused: 0 }; }
  }

  function _wireRankChange() {
    if (_rankWired) return;
    MatrixBridge.onRankChange(_rewireWriteChannel);
    _rankWired = true;
  }

  // Subscribe once to "a new channel appeared in this space" (an upgrade). When
  // it fires, join the channel as fast as possible — events/checkpoints/settings
  // are restricted, so a space member joins with no invite — and fold it in via
  // mergeChannels (which replays new events channels and re-evaluates our write
  // channel). Wire-once-and-persist, like _wireRankChange: the bridge scopes the
  // event to the current space and _onChannelAdded guards on `current`, so a
  // stale fire after a room switch is a harmless no-op. Idempotent: the owner
  // also reaches the same channels through RoomUpgrade → mergeChannels, and
  // re-handling is a no-op (already-mapped check + StreamManager event_id dedup).
  // ── PENDING INVITES TO THIS SPACE'S OWN CHANNELS, ACCEPTED WITHOUT A CLICK ────────────────
  // Three channels are invite-only ON PURPOSE, and it is the same reason each time: MEMBERSHIP IS
  // THE STATEMENT. Guest and staff chat because membership is the rank gate; presence chat because
  // membership is the bot's activity verdict. If any space member could walk in, none of the three
  // would mean anything — so they cannot be made `restricted` like the open channels.
  //
  // But the CLICK adds nothing. You were invited by `assignRank` or by the bot, and neither invites
  // somebody who has not earned it. The invite already IS the decision; making a person confirm it
  // only produces people sitting outside a channel they are entitled to, silently.
  //
  // SCOPED BY THE SPACE'S OWN CHANNEL LIST, never by a name, so an invite from anywhere else is not
  // considered at all — that is what makes this narrow rather than an auto-accept with a comment
  // claiming it is.
  //
  // AND THE LIST IS THE ADVERTISEMENT, NOT THE RESOLUTION. This paragraph named `current.channels`
  // and that map is a FILTERED SUBSET of the space's children: it drops every child the SDK could
  // not resolve, which is precisely the three invite-only channels a member has not entered yet.
  // The scope was therefore blind to the invites this feature exists for. See `_inviteCandidates`.
  //
  // ── AN INVITE IS A STANDING CONDITION, NOT AN EVENT ───────────────────────────────────────
  // This reconciles STATE. Written as a handler for the arrival it would break three ways for one
  // reason: an invite that landed while the tab was closed is never re-announced, a cooldown that
  // expires has nothing to re-trigger it, and a join that failed is consumed. So it reads what is
  // true now and acts on the difference, the same shape the bot's presence reconcile uses, and it
  // runs at wiring AND on every membership change.
  const _INVITE_COOLDOWN_MS = 10000;
  function _onRoomsChangedInvites() { try { acceptChannelInvites(); } catch (e) {} }
  // roomId -> ts we last attempted a join.
  //
  // NOT CLEARED ON A ROOM CHANGE, AND THAT IS SAFE FOR A STATED REASON rather than by luck. The
  // keys are MATRIX ROOM IDS, which are globally unique — a stale entry from another space cannot
  // name a channel of this one, so it can never hold back a join that should happen. Contrast
  // `_chatSeen` in the bot, which WAS cleared: its keys are user ids, which repeat across rooms,
  // so a value from one room really could be read as evidence in another.
  //
  // It grows by at most one entry per channel ever visited, and each is a string and a number.
  const _inviteTried = Object.create(null);

  // ── THE SCOPE IS THE SPACE'S ADVERTISED CHILDREN, NOT THE CHANNELS I HAPPEN TO HOLD ────────
  // This looped over `current.channels` and could therefore never see the invite it exists for.
  // That map is built ONCE, in `join()`, by walking `m.space.child` and calling `getRoom(roomId)`
  // with `if (!room) continue` — and `getRoom` answers null for a room you are neither in nor
  // invited to. The three invite-only channels are exactly those rooms, so a player's map holds
  // every channel EXCEPT `chat_guest`, `chat_staff` and `presence_chat`. Named rather than
  // counted: the count is one the channel table recomputes and this line would not
  // (`grep -cE '^\s*\{ kind: "' backends/backend1/matrixbridge.js`).
  //
  // MEASURED CONSEQUENCE: promote somebody and `assignRank` sends the invite, `Room.myMembership`
  // fires, this reconcile runs — and loops over a map with no `chat_staff` in it. Nothing is
  // accepted and nothing is logged, because the loop never reaches the branch that reports a hold.
  // A reload fixes it, because that rebuilds the map with the now-resolvable invited room in it,
  // which is why presence looked like it worked: the bot re-invites forever, so its invite is
  // normally still pending at the next room entry. A rank promotion happens once, mid-session.
  //
  // THE SCOPE IS NOT WIDENED BY THIS, IT IS CORRECTED. `spaceChildIds` is the same space's own
  // channel list, read from the advertisement rather than from what this client managed to
  // resolve — which is what the paragraph above always claimed to be reading. The resolved map is
  // still unioned in, so nothing that is accepted today stops being accepted if the space state
  // is momentarily unreadable.
  function _inviteCandidates() {
    const seen = Object.create(null), out = [];
    let advertised = [];
    try {
      if (typeof MatrixBridge.spaceChildIds === "function" && current.spaceId) {
        advertised = MatrixBridge.spaceChildIds(current.spaceId) || [];
      }
    } catch (e) { advertised = []; }
    for (const id of advertised) if (id && !seen[id]) { seen[id] = 1; out.push(id); }
    for (const key in current.channels) {
      const id = current.channels[key];
      if (id && !seen[id]) { seen[id] = 1; out.push(id); }
    }
    return out;
  }

  // A room id -> this space's key for it. The resolved map first, then the room's own name, which
  // is the only route for a channel that is not in the map yet — the case this whole change is
  // about. Null when neither answers, so a caller labels by id rather than inventing a key.
  function _channelKeyFor(roomId) {
    if (current && current.channels) {
      for (const k in current.channels) if (current.channels[k] === roomId) return k;
    }
    try {
      const c = MatrixBridge.getClient();
      const room = c && c.getRoom ? c.getRoom(roomId) : null;
      if (room && room.name && typeof MatrixBridge.channelKeyFromName === "function") {
        return MatrixBridge.channelKeyFromName(room.name);
      }
    } catch (e) { /* unreadable transport: the caller labels by id */ }
    return null;
  }

  // ── ACCEPTING IS HALF THE JOB; THE OTHER HALF IS BEING IN THE MAP ─────────────────────────
  // `chatTiers()` builds from `Object.keys(current.channels)`, so a staff chat this client has
  // just joined is still offered by nothing until its key is mapped. Joining a channel nobody can
  // then read is the same silence as not joining it, one step further along.
  //
  // A CHAT CHANNEL DOES NOT GO THROUGH `mergeChannels`, DELIBERATELY. That helper exists for the
  // upgrade path: it replays `events_*` and re-runs `_rewireWriteChannel`, which re-inits Queue,
  // Skip, Playback, MediaLength, MediaBlocked and the checkpoint wiring. None of that has anything
  // to do with a chat tier — the write channel is an `events_*` channel and is unmoved by this —
  // so routing a chat join through it would tear down and rebuild the playback path every time
  // somebody is added to the presence chat, which the bot does on a one-minute tick. Spine-shaped
  // keys still take that route, because a channel carrying protocol events has to be replayed.
  function _adoptJoinedChannel(roomId) {
    if (!current || !current.channels || !roomId) return;
    if (Object.values(current.channels).indexOf(roomId) >= 0) return;   // already mapped
    const key = _channelKeyFor(roomId);
    if (!key) {
      Logger.warn("Room: joined " + roomId + " but could not resolve which channel it is, so it "
        + "stays unmapped and is offered as no tier — the join landed and the panel cannot show it");
      return;
    }
    let isChatShaped = key.indexOf("chat_") === 0;
    try {
      isChatShaped = isChatShaped
        || (typeof MatrixBridge.presenceChatKey === "function" && key === MatrixBridge.presenceChatKey());
    } catch (e) { /* leave the prefix answer */ }
    const add = {}; add[key] = roomId;
    if (!isChatShaped) { mergeChannels(add); return; }
    Object.assign(current.channels, add);
    Store.config.saveRoom({ name: current.name, spaceId: current.spaceId, channels: current.channels });
    try { applyChatTiers(); }
    catch (e) { Logger.warn("Room: " + key + " is mapped but the tier strip was not re-resolved — "
      + ((e && e.message) || e)); }
    Logger.info("Room: " + key + " is mapped and readable — it is offered as a chat tier now");
  }

  function acceptChannelInvites() {
    if (!current || !current.channels) return { ok: false, reason: "no-room", accepted: [], held: [] };
    const accepted = [], held = [];
    let now = Date.now();
    for (const id of _inviteCandidates()) {
      if (!id) continue;
      let invited = false;
      try { invited = MatrixBridge.amInvited(id); } catch (e) { invited = false; }
      if (!invited) continue;
      const key = _channelKeyFor(id) || id;
      const last = _inviteTried[id];
      if (typeof last === "number" && (now - last) < _INVITE_COOLDOWN_MS) {
        // ── HELD, NOT DROPPED ────────────────────────────────────────────────────────────────
        // The cooldown exists so a join that keeps failing paces into something a person can SEE
        // rather than spinning at network speed and looking like a hang. It must never end the
        // attempt: the invite stays pending and the next pass takes it. And it SAYS SO — a silent
        // skip is the shape that hid a refused kick for three sessions.
        held.push(key);
        Logger.debug("Room: invite to " + key + " held — accepted "
          + Math.round((now - last) / 1000) + "s ago, retrying after the cooldown");
        continue;
      }
      _inviteTried[id] = now;
      accepted.push(key);
      Promise.resolve(MatrixBridge.acceptChannelInvite(id)).then((r) => {
        if (r && r.ok) {
          Logger.info("Room: joined " + key + " (invite accepted automatically)");
          try { _adoptJoinedChannel(id); }
          catch (e) { Logger.warn("Room: joined " + key + " but could not map it — " + ((e && e.message) || e)); }
          return;
        }
        // A FAILURE IS RETRIED, NOT CONSUMED. The mark is cleared so the next pass tries again
        // rather than waiting out a cooldown for an attempt that never landed.
        delete _inviteTried[id];
        Logger.warn("Room: could not accept the invite to " + key + " — "
          + ((r && r.reason) || "failed") + ((r && r.detail) ? ": " + r.detail : "")
          + "; it stays pending and the next pass retries");
      }, () => { delete _inviteTried[id]; });
    }
    return { ok: true, reason: null, accepted: accepted, held: held };
  }

  function _wireChannelAdded() {
    if (_channelWired) return;
    MatrixBridge.onChannelAdded(_onChannelAdded);
    _channelWired = true;
  }

  async function _onChannelAdded(childRoomId) {
    if (!current || !childRoomId) return;
    if (Object.values(current.channels).indexOf(childRoomId) >= 0) return;   // already tracked
    const joined = await MatrixBridge.joinChannel(childRoomId);
    if (!joined) return;   // e.g. a rank-gated chat channel we aren't ranked for
    const client = MatrixBridge.getClient();
    const room = client ? client.getRoom(childRoomId) : null;
    if (!room || !room.name) return;
    const key = MatrixBridge.channelKeyFromName(room.name);   // "events-player" -> "events_player"
    if (current.channels[key] === childRoomId) return;
    const add = {}; add[key] = childRoomId;
    mergeChannels(add);   // map + persist + replay (events_ only) + rewire write channel
    Logger.info("Room: auto-joined new channel " + room.name);
  }

  // ---- Room settings (derived truth; owner writes the full blob) ----------
  // The owner posts the complete settings blob to settings-owner; every client
  // derives the last one (last-write-wins) via StateDeriver. getSettings reads
  // that derived value; setSettings (owner only) writes a new full blob and
  // performs the visibility side effect.
  // Pass through EVERY derived setting. This used to hand-list keys, which silently hid any
  // setting the list forgot — the UI then rendered those as blank/absent no matter what the room
  // actually had. The reducer's defaultSettings() is the single source of what exists, so we copy
  // it wholesale and never restate the shape here.
  function getSettings() {
    const s = StreamManager.getState().settings;
    // Fall back to the reducer's OWN defaults rather than a hand-copied literal. The literal
    // that used to live here had drifted: it predated minGate/graceMs/presendMs/skipRoads and
    // both tables, so if it ever fired the panel rendered those as blank — the exact drift the
    // comment above says this function exists to avoid.
    // Restate NOTHING. The literal that used to live here had drifted — it predated
    // minGate/graceMs/presendMs/skipRoads and both tables, so if it ever fired the panel
    // rendered those as blank. The reducer always seeds StreamManager with its own defaults,
    // so this branch is unreachable defence; an empty object is the only honest answer that
    // does not duplicate a shape this function exists to pass through. (features/ may not
    // reach StateDeriver directly — check-boundaries rule F.)
    if (!s || typeof s !== "object") return {};
    return Object.assign({}, s);
  }
  // Pass-through, like getSettings: the panel renders bounds the reducer actually enforces.
  function getSettingRanges() {
    try { return StreamManager.settingRanges ? StreamManager.settingRanges() : {}; } catch (e) { return {}; }
  }
  function onSettingsChange(fn) { if (fn && !_settingsListeners.includes(fn)) _settingsListeners.push(fn); }

  // Apply derived settings locally: point chat at the chosen tier (everyone),
  // then notify listeners. The visibility side effect is owner-only and is done
  // in setSettings (not here), so non-owners never try to change the space.
  function _applySettings() {
    if (!current) return;
    const s = getSettings();
    // J12 — the resolver below is the ONE place that turns a tier into a channel, and it is
    // reached from here AND from a view switch. Before J12 this line chose the channel inline and
    // was the only caller; adding a second caller with its own copy of that expression is exactly
    // the P7 collision J12's Open warns about, so there is one expression with two callers.
    applyChatTiers();
    for (const fn of _settingsListeners) { try { fn(s); } catch (e) {} }
  }

  // ── PER-TIER CHAT VIEWS (J12) ──────────────────────────────────────────────────────────────
  // THE OPEN THIS JOB HAD TO SETTLE, AND THE ANSWER IS "ONE DEFINITION, TWO QUESTIONS".
  // `settings.chat` is ROOM TRUTH — owner-set, folded, inside the seed the checkpoint fingerprint
  // commits — and it answers *which tier is this room's MAIN chat*. It is not, and must not
  // become, an answer to *which tier am I looking at*: that question did not exist before J12 and
  // is a fact about one device.
  //
  // So the device's view is a NULL-ABLE OVERRIDE in `ChatPrefs`, and null means *follow the
  // room*. That is what keeps it a READER of the setting rather than a second source of it: with
  // no override there is exactly one answer and it is the room's, and with an override there is
  // exactly one answer and it is this device's. What there is never is two answers to one
  // question. `chatTiers()` below is the only function that resolves the pair, and
  // `_applySettings` and the view switch are both its callers rather than two implementations.
  //
  // WHICH TIERS A RANK GRANTS is a structural fact about the room, not a rank comparison: a chat
  // channel you may read is one that EXISTS and that you have joined, and the homeserver enforces
  // that rather than this function. So the list is the chat channels present in `current.channels`
  // — the same "floored against channels that physically exist" rule `RoomUpgrade.status()` uses,
  // and the reason no rank literal appears here (`check-boundaries` rule H).
  function chatTiers() {
    if (!current || !current.channels) return { tiers: [], activeTier: null, activeId: null, mainTier: null };
    const ch = current.channels;
    const s = getSettings();
    const mainTier = (typeof s.chat === "string" && s.chat) ? s.chat : "uncategorized";
    // ── A TIER IS OFFERED ONLY IF THE ROOM HAS UNLOCKED THE RANK IT BELONGS TO ────────────────
    // CONFIRMED IN A BROWSER: a six-channel (batch-1) room offered Uncategorized · Guest · Staff.
    // Existence of a `chat_*` key was the only test, and that is not the same question as *has
    // this room been upgraded far enough for people of that rank to exist* — a chat channel can be
    // present in `current.channels` while the EVENTS ladder behind it has not caught up, which is
    // precisely what `isRankUnlocked`'s own comment warns about ("Owner's channel existing from
    // creation doesn't imply the batch ladder in between has caught up").
    //
    // **THIS IS THE IDENTICAL DEFECT THE RANK PICKER HAD AT v272**, which was fixed by filtering
    // through `isRankUnlocked`, and this picker shipped without the equivalent check. The level for
    // each tier is read from `MatrixBridge.channelTaxonomy()` — the same table that defines the
    // channels — rather than restated here, so a tier added to that table is filtered on the day
    // it is added and no rank literal appears in this function (rule H).
    let levelOfTier = null;
    try {
      levelOfTier = {};
      for (const r of MatrixBridge.channelTaxonomy()) {
        if (r && r.kind === "chat" && typeof r.level === "number") levelOfTier[r.slug] = r.level;
      }
    } catch (e) { levelOfTier = null; }

    const tiers = [];
    for (const key of Object.keys(ch)) {
      if (key.indexOf("chat_") !== 0 || !ch[key]) continue;
      const tier = key.slice("chat_".length);
      // FAIL CLOSED on an unreadable taxonomy: a tier whose level cannot be established is not
      // offered. The alternative — offering it — is what produced the confirmed defect.
      if (!levelOfTier || typeof levelOfTier[tier] !== "number") continue;
      if (!isRankUnlocked(ch, levelOfTier[tier])) continue;
      tiers.push({ tier: tier, id: ch[key], main: tier === mainTier, level: levelOfTier[tier] });
    }

    // ── THE PRESENCE CHANNEL IS A CHAT TIER TOO, WITH ONE EXTRA CONDITION ────────────────────
    // It is an encrypted chat channel like the other three; only its MEMBERSHIP rule differs —
    // the bot adds and removes people by the room's activity rule rather than by rank. So for
    // this one tier "the channel exists" is not the same question as "I can read it", and both
    // are asked. Offering a tier that opens an empty view is the exact defect the rank filter
    // above was added to fix, arriving through the one channel rank does not govern.
    //
    // ITS FEED IS SEPARATE, WHICH NEEDS NO CODE HERE. The panel buckets messages per tier
    // already (`_chatState(box, tier)`), so a tier in this list gets its own feed by construction
    // — merging it into the persistent chat would have been the extra work, not keeping it apart.
    try {
      // THE KEY IS ASKED FOR, NEVER SPELLED. `presenceChatKey()` derives it from the channel
      // table by KIND, so renaming the row renames this with it. A literal fallback here would be
      // a second source for the same fact, free to outlive the row it names — and it would fail
      // in the direction that hides the failure: a stale key finds nothing and the tier silently
      // never appears.
      const pKey = MatrixBridge.presenceChatKey ? MatrixBridge.presenceChatKey() : null;
      const pId = pKey ? ch[pKey] : null;
      if (pId && MatrixBridge.amJoined && MatrixBridge.amJoined(pId)) {
        tiers.push({ tier: "presence", id: pId, main: false, level: null });
      }
    } catch (e) { /* unreadable transport: the tier is simply not offered */ }

    // ── ORDERED BY THE LADDER, WITH PRESENCE LAST ────────────────────────────────────────────
    // This sorted ALPHABETICALLY and said so deliberately: "the CHANNEL order rather than a rank
    // ladder — the UI may not compare ranks (rule H)". That rule is about the UI, and this is the
    // feature layer, which already read every tier's level from `channelTaxonomy()` six lines
    // above. Alphabetical put Everyone last and Guest+ first, which reads as arbitrary to anyone
    // looking at it. Sorted by the level the taxonomy gives, so a tier added to that table lands
    // in the right place on the day it is added and no rank literal appears here.
    //
    // PRESENCE HAS NO LADDER POSITION — its `level: 0` is a write gate, not a rank — so it is
    // pinned last rather than sorted as if it were the widest audience, which is what a level of
    // 0 would otherwise make it.
    tiers.sort((a, b) => {
      const ap = a.level === null, bp = b.level === null;
      if (ap !== bp) return ap ? 1 : -1;
      if (ap && bp) return 0;
      if (a.level !== b.level) return a.level - b.level;
      return a.tier < b.tier ? -1 : (a.tier > b.tier ? 1 : 0);
    });
    // The override wins ONLY while it names a tier this client can actually read. A person who
    // selected `staff` and was then demoted, or whose room lost that channel, falls back to the
    // room's main tier rather than to an empty view — silently, because the alternative is an
    // error about a choice they cannot act on.
    let want = null;
    try { want = ChatPrefs.chatTier(); } catch (e) { want = null; }
    let active = tiers.find((t) => t.tier === want) || tiers.find((t) => t.tier === mainTier) || tiers[0] || null;
    // `mainId` IS RESOLVED HERE, beside `activeId`, because a caller that needs the room's MAIN
    // channel would otherwise rebuild it — and the obvious rebuild ("find the tier flagged main")
    // silently answers null whenever the tier list is empty for a reason that has nothing to do
    // with the main tier, while `mainTier` sits right there looking answered. One resolution, both
    // questions. The bot's AFK warning is the caller: it must reach the room's main chat rather
    // than whichever tab the client last had open.
    const mainRow = tiers.filter((t) => t.tier === mainTier)[0] || null;
    return { tiers: tiers, activeTier: active ? active.tier : null,
             activeId: active ? active.id : null, mainTier: mainTier,
             mainId: mainRow ? mainRow.id : null };
  }

  // Push the resolution down to Chat: the whole readable set for RECEIVING, the one active
  // channel for SENDING. Both come from the same resolution, so the tier you are reading is
  // always the tier your next message goes to.
  function applyChatTiers() {
    const r = chatTiers();
    try { Chat.setReadableTiers(r.tiers.map((t) => t.id)); } catch (e) {}
    if (r.activeId) { try { Chat.setRoom(r.activeId); } catch (e) {} }
    return r;
  }

  // The view switch. Records the choice, re-resolves, and hands back the new resolution — one
  // path, so a switch cannot re-point Chat differently from the way a settings change does.
  function selectChatTier(tier) {
    try { ChatPrefs.setChatTier(tier); } catch (e) {}
    return applyChatTiers();
  }

  function _wireSettings() {
    if (_settingsWired) return;
    StreamManager.on("ddjp.room.settings", _applySettings);   // reads `current` live; safe across rooms
    _settingsWired = true;
  }

  // Owner only. Merge a partial change over the current settings, post the FULL
  // blob (last-write-wins truth everyone derives), and — for visibility — also
  // perform the actual space join-rule change (only the owner can/should).
  // ── THE SETTINGS TABLES' SHAPE, passed through ───────────────────────────────────────────────
  // The panel needs to know how many rows a per-rank table has and which are editable, and it needs
  // to build a complete table from one cell edit. Both are backend policy (Capabilities owns them,
  // derived from the ladder) and the UI may not reach a backend module directly — check-boundaries
  // and check-ui-no-permission both enforce that, and both caught it when this went straight to
  // Capabilities. Passed through here because the panel already writes through Room.setSettings, so
  // reading the shape from the same place keeps one seam rather than two.
  function getSettingRows() { return Capabilities.settingsRows(); }
  function editSettingTable(table, index, enough, withAlways, always) {
    return Capabilities.applyTableEdit(table, index, enough, withAlways, always);
  }

  // ── IT REPORTS NOW, AND THE PANEL IS UNAFFECTED (v322 audit) ────────────────────────────────
  // Every failure path here used to `return` bare: no room, wrong rank, no settings channel, AND
  // a send that threw. Undefined is what success returned too, so a caller could not tell a write
  // that happened from one that never left. For the PANEL that was survivable — a person watches
  // the room not change — but the bot is a caller with nobody watching, and `authorIfPermitted`
  // treats "did not throw" as "wrote". DRIVEN at v322: a writer that silently does nothing returns
  // `ok: true` and `BotRuntime` counts it as ACTED. A write that never happened, reported as a
  // success, with the requester getting silence either way — the plausible-value shape.
  //
  // Still TOTAL and still non-throwing, so the panel's `Room.setSettings(...)` calls are unchanged;
  // it ignores the return today and may go on doing so. The bot's wrapper in `_evaluateBot` is
  // what turns a false into a throw, because only the bot needs to distinguish them.
  async function setSettings(partial) {
    if (!current) return { ok: false, reason: "no-room" };
    if (!Capabilities.atLeast(MatrixBridge.getMyRank(current.channels), "owner")) {
      Logger.warn("Room: only the owner can change settings");
      return { ok: false, reason: "not-owner" };
    }
    const cur = getSettings();
    // The blob is LAST-WRITE-WINS, so it must carry EVERY setting each time. Merge the caller's
    // partial onto the current full blob rather than hand-listing keys: a hand-written list
    // silently drops any setting it forgets — which is exactly how the advanced dials became
    // unwritable, with no error anywhere. The reducer re-validates everything and is TOTAL (a bad
    // value keeps the current one), so a permissive merge here is safe.
    const next = Object.assign({}, cur, partial || {});
    // bg keeps explicit clear semantics: an empty/absent link means "remove the background".
    // (Host-allowlist validation of the link itself lives in the settings UI + validator module.)
    if (partial && Object.prototype.hasOwnProperty.call(partial, "bg")) {
      next.bg = (typeof partial.bg === "string" && partial.bg) ? partial.bg : null;
    }
    const ch = current.channels.settings_owner;
    if (!ch) { Logger.warn("Room: no settings-owner channel"); return { ok: false, reason: "no-channel" }; }
    try {
      await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: next });
    } catch (e) {
      Logger.error("Room: settings write failed: " + e.message);
      return { ok: false, reason: "send-failed", detail: e && e.message };
    }
    // Visibility side effect — open/close the space door. Idempotent if unchanged.
    if (partial && partial.vis && partial.vis !== cur.vis) {
      try { await MatrixBridge.setSpaceJoinRule(current.spaceId, next.vis === "public"); }
      catch (e) { Logger.error("Room: visibility change failed: " + e.message); }
    }
    // The SETTINGS write is what this reports on. A failed join-rule change above is logged and
    // does not make this false: the settings event — the thing every client derives from — landed,
    // and reporting failure would make the bot retry a write that already succeeded.
    return { ok: true, reason: null };
  }

  // Called by RoomUpgrade after a batch creates new channels: fold them into the
  // current map, persist, replay any new events channels, and re-evaluate which
  // channel we should now be writing to (an upgrade may raise our write channel).
  function mergeChannels(newChannels) {
    if (!current || !newChannels) return;
    Object.assign(current.channels, newChannels);
    Store.config.saveRoom({ name: current.name, spaceId: current.spaceId, channels: current.channels });
    for (const key in newChannels) {
      // replayRoom is async and fire-and-forget here — unlike the join path, which collects the
      // promises and awaits Promise.allSettled. Without a handler a failed replay of a newly added
      // channel becomes an unhandled rejection rather than a warning.
      if (key.indexOf("events_") === 0 && newChannels[key]) {
        MatrixBridge.replayRoom(newChannels[key])
          .catch((e) => Logger.warn("Room: replay of a new channel failed: " + (e && e.message)));
      }
    }
    _rewireWriteChannel();
  }

  async function create(name) {
    if (_creatingRoom) { Logger.warn("Room: a create is already in progress"); throw new Error("a room creation is already in progress"); }
    _creatingRoom = true;
    try {
      // Resume an interrupted create of the SAME room if we hold its partial;
      // otherwise start fresh. createDDJPSpace dedups what we pass against the
      // space's real children, so a resume builds only the missing channels.
      const resuming = (_pendingCreate && _pendingCreate.name === name) ? _pendingCreate.partial : null;
      Logger.info("Room: " + (resuming ? "resuming creation of " : "creating ") + name);

      let result;
      try {
        result = await MatrixBridge.createDDJPSpace(name, resuming);
      } catch (e) {
        // Keep what was built so a retry finishes it instead of orphaning it.
        // (createDDJPSpace no longer tears down on failure.) Persist it too, so
        // the half-built room survives a page reload and can be resumed later.
        if (e && e.partial && e.partial.spaceId) {
          _pendingCreate = { name: name, partial: e.partial };
          try { Store.config.savePendingCreate({ name: name, spaceId: e.partial.spaceId, channels: e.partial.channels || {} }); }
          catch (_) {}
        }
        throw e;
      }

      _pendingCreate = null;   // fully built — nothing left to resume
      try { Store.config.clearPendingCreate(); } catch (_) {}
      const { spaceId, channels } = result;
      current = { name, spaceId, channels };
      Store.config.saveRoom({ name, spaceId, channels });
      _initModules(current);
      _wireRankChange();
      _wireChannelAdded();
      // ── GENESIS SETTINGS ──────────────────────────────────────────────────────────────
      // The owner states the room's rules as an EVENT, at position ~0, instead of every client
      // assuming the built-in defaults. Defaults are CODE, so a room that names no settings event
      // is the one claim in this system checked against the application rather than against the
      // log — and two clients on different builds would disagree about what "default" means
      // SILENTLY, each confidently validating against its own idea.
      //
      // SENT DIRECTLY, NOT THROUGH setSettings, AND THAT IS DELIBERATE. setSettings gates on
      // Capabilities.atLeast(getMyRank(...), "owner"), and getMyRank reads POWER LEVELS OUT OF
      // SYNCED ROOM STATE. We have just created these rooms and nothing here waits for that state
      // to come back, so on a slow connection the lookup can still answer "uncategorized" — and
      // setSettings would then log a warning and return, leaving the room permanently without its
      // own rules. A race that fails silently, on the one write this whole change exists to make.
      //
      // Skipping the client-side rank check is safe because it is not the real one: the homeserver
      // enforces the power level on settings_owner, so if we somehow were not the owner the send
      // is rejected at the server. And there is no blob to drift — this is the reducer's own
      // defaults object verbatim, the same value setSettings would have merged to (asserted in
      // check-genesis-settings).
      try {
        const ch = current.channels.settings_owner;
        if (!ch) throw new Error("no settings-owner channel");
        await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: StreamManager.defaultSettings() });
        Logger.info("Room: genesis settings posted");
      } catch (e) {
        // Best-effort by necessity: the channels already exist, so throwing here would orphan a
        // real room. The room still works and simply cannot license forgetting until an owner
        // changes any setting once — which writes the same complete blob and repairs it. A
        // degraded state, not a corrupt one, and logged at ERROR so it is never silent.
        Logger.error("Room: genesis settings NOT posted (" + e.message +
          ") — room is usable but cannot forget until an owner changes a setting once");
      }
      _startModules();   // fresh room, nothing to replay — safe to go live immediately
      await RoomUpgrade.recordCreation();   // seed the 2h cooldown clock (batch 1 done)
      return current;
    } finally {
      _creatingRoom = false;
    }
  }

  // Hydrate the in-memory pending pointer from disk if needed (after a reload,
  // memory is empty but a persisted partial may exist). Returns the normalized
  // { name, partial:{spaceId,channels} } or null.
  function _resolvePending() {
    if (_pendingCreate) return _pendingCreate;
    let p = null;
    try { p = Store.config.loadPendingCreate(); } catch (_) { p = null; }
    if (p && p.name && p.spaceId) {
      _pendingCreate = { name: p.name, partial: { spaceId: p.spaceId, channels: p.channels || {} } };
      return _pendingCreate;
    }
    return null;
  }

  // Is there an interrupted create waiting to be resumed (this session OR a prior
  // one, via persisted state)? Lets the UI show a "Finish creating (N/total)"
  // entry and exclude the half-built space from the normal owned list by spaceId.
  // Returns { name, spaceId, built, total } | null.
  function pendingCreate() {
    const rec = _resolvePending();
    if (!rec) return null;
    const ch = rec.partial && rec.partial.channels ? rec.partial.channels : {};
    // Total batch-1 channels comes from the taxonomy (creationPlan on an empty map
    // reports the full batch-1 count), so this label tracks the channel table and
    // never drifts when the batch composition changes.
    let total = 6;
    try { total = MatrixBridge.creationPlan({}).total; } catch (e) {}
    return { name: rec.name, spaceId: rec.partial ? rec.partial.spaceId : null, built: Object.keys(ch).length, total: total };
  }

  // Resume an interrupted creation (same- or cross-session). Loads the pending
  // partial if not already in memory, then runs create() which dedups against
  // the partial + the space's live children and builds only what's missing.
  async function resumeCreate() {
    const rec = _resolvePending();
    if (!rec) { Logger.warn("Room: nothing to resume"); return null; }
    return create(rec.name);
  }

  // User chose to abandon a half-built room. Best-effort leave of its space +
  // channels, then clear every trace of the pending so its card disappears. The
  // explicit, user-driven counterpart to the (removed) auto-teardown — we never
  // do this on a failure, only when the user asks. Local state is cleared even if
  // some leaves fail, so the abandoned room stops being tracked regardless.
  async function discardPendingCreate() {
    const rec = _resolvePending();
    if (!rec) { Logger.warn("Room: nothing to discard"); return false; }
    const sid = rec.partial ? rec.partial.spaceId : null;
    const ch = rec.partial ? rec.partial.channels : {};
    try { await MatrixBridge.discardCreation(sid, ch); }
    catch (e) { Logger.warn("Room: discard leave failed (clearing locally anyway): " + e.message); }
    _pendingCreate = null;
    try { Store.config.clearPendingCreate(); } catch (_) {}
    Logger.info("Room: discarded interrupted creation of " + rec.name);
    return true;
  }

  // ── CREATE A ROOM FROM A SAVE FILE (J27) ─────────────────────────────────────────────────
  // Thin, like the export pair above it. Every decision lives below the seam: whether the file is
  // readable at all (`StreamManager.importFile`), and what the room's first checkpoint contains
  // (`StreamManager.importCheckpoint` -> `Checkpoint.buildImport`). This layer supplies the one
  // thing the backend cannot know — the room being created and where its genesis settings landed —
  // and sequences the three sends.
  //
  // THE FILE IS READ BEFORE ANY ROOM EXISTS, AND THE ORDER IS THE RULE. Creating twenty-one rooms
  // and then discovering the file is unreadable leaves a real, rate-limited, half-purpose room
  // behind and a person who has to go and delete it. Every refusal `importFile` can produce is
  // computable from the file alone, so all of them are collected first. This is the same shape as
  // the keyset-before-chain ordering J25 established one layer down: both refuse, and the cheap
  // one is the one that can still be acted on.
  //
  // THE CHANNELS ARE BUILT TO THE CURRENT SHAPE, WHICH IS THE HALF OF THE Done-when THAT NEEDS NO
  // CODE. `create()` is called unchanged, so the room gets this build's batch-1 channels whatever
  // shape the file came from. There is no legacy branch, and this is the one place somebody would
  // be tempted to add one (08-build-and-deploy.md §Legacy).
  //
  // THE SETTINGS BLOB COMES FROM THE FILE, THE POINTER IS RE-ANCHORED TO IT. J25 settled this when
  // it answered J28's settings half: an imported seed names a settings event in a room this one
  // cannot read, so the importer POSTS the file's settings as this room's own genesis settings
  // event and `settingsFrom` is rewritten to it. The pointer describes, it never decides — so
  // re-anchoring changes no verdict and makes the claim checkable where it now lives.
  //
  // WHAT AN IMPORT DOES NOT DO: invite anybody, or rank anybody. The file carries no ranks —
  // driven, `tools/probes/probe-j27-import.js` R7/R8: the seed's per-member fields are `orderKey`
  // and `pending`, `rankByUser` was deleted, and the only rank in the whole file is the AUTHOR's
  // declaration about themselves. So there is no roster to make real. The rotation the seed
  // restores is a set of user IDs who are not members here, and that is a starting position rather
  // than a claim about anyone: their declared songs arrive with the file (R11), the room plays
  // them, and each falls out of the rotation when their buffer empties by the hard fall-out rule
  // that already exists (R12: rotation 1 -> 0). Those people rejoin the way anyone joins — invited
  // by this room's owner, at whatever rank this room's owner grants, which is the only place a
  // rank can come from (P6).
  async function createFromFile(name, file) {
    const read = StreamManager.importFile ? StreamManager.importFile(file)
                                          : { ok: false, reason: "no-backend-support" };
    if (!read.ok) {
      Logger.warn("Room: import refused before creating anything — " + read.reason +
        (read.detail ? " (" + read.detail + ")" : ""));
      const err = new Error(read.detail || read.reason);
      err.importReason = read.reason;
      throw err;
    }
    if (read.warning) {
      Logger.warn("Room: importing a file with " + read.warning +
        (read.missingKeys ? " [" + read.missingKeys.join(", ") + "]" : "") +
        " — those values come from this build's defaults");
    }

    const room = await create(name);

    // The genesis settings post inside create() has already run and carried the reducer's
    // defaults. Post the FILE's blob over it as a second owner settings event: last-write-wins by
    // log position, so the room's rules are the file's from here on, and the pointer below names
    // THIS event rather than the defaults one.
    let anchor = null;
    try {
      const ch = room.channels.settings_owner;
      if (!ch) throw new Error("no settings-owner channel");
      const receipt = await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: read.settings });
      if (!receipt || !receipt.eventId || !Number.isSafeInteger(receipt.l)) {
        throw new Error("the settings send reported no position to anchor on");
      }
      anchor = { settingsFrom: receipt.eventId, eventId: receipt.eventId, l: receipt.l };
      Logger.info("Room: imported settings posted at l=" + receipt.l);
    } catch (e) {
      Logger.error("Room: imported settings NOT posted (" + e.message +
        ") — the room exists and is usable, but it is running this build's defaults rather than " +
        "the file's, and no checkpoint has been published for it");
      return room;
    }

    // The room's first checkpoint: the file's seed, re-anchored onto the event just posted.
    // Published THROUGH THE SEAM rather than sent from here — the checkpoint's wire type and the
    // channel it goes to are both transport's, and a feature naming either would be a second copy
    // of a protocol constant it is not allowed to read the first of. It lands on
    // `checkpoints-owner`, so every client reads it with owner authority off the channel it
    // arrived on and adopts it without recompute — which is what makes the restore identical for
    // everyone rather than a thing that happened on one device.
    try {
      const built = await StreamManager.importCheckpoint(read.seed, anchor);
      if (!built || !built.ok) throw new Error(built ? built.reason : "no-checkpoint");
      Logger.info("Room: imported checkpoint published (floorL=" + built.cp.floorL + ")");
    } catch (e) {
      Logger.error("Room: imported checkpoint NOT published (" + e.message +
        ") — the room exists with the file's settings but none of its state; re-import into a " +
        "fresh room rather than expecting this one to catch up");
    }
    return room;
  }

  // ── OWNER OVERRIDE FROM A SAVE FILE (J28) ────────────────────────────────────────────────
  // The same seed crossing the same seam as `createFromFile`, into a room that already exists.
  // Everything below the seam is shared — `importFile` reads it, `importCheckpoint` publishes it,
  // `Checkpoint.buildImport` re-anchors it — and this function owns the three things that are
  // genuinely different about a room that is RUNNING.
  //
  // 1. THE FILE IS READ FIRST, for the same reason creation reads it first: every refusal
  //    `importFile` can produce is computable from the file alone, and posting a settings event
  //    into a live room before discovering the file is unreadable leaves the room's rules changed
  //    with no checkpoint to explain why. Cheap refusals go ahead of irreversible acts.
  //
  // 2. AM I CAUGHT UP? — the question a created room cannot ask. The anchor for an override is an
  //    event this client posts at the room's HEAD, and a client that is still replaying or catching
  //    up does not know where the head is. It is asked through `MatrixBridge.mayAuthor()`, the
  //    interface's own "am I entitled to speak" predicate, because `features/` may not reach
  //    `Session` (check-boundaries rule F) — the same door `Queue.submitSong` and `ServerClock` use.
  //    THE REFUSAL IS RETURNED, NOT SWALLOWED: `undefined` for both sent and declined leaves a
  //    click with no way to say why nothing happened (paths.md §8c).
  //
  // 3. OWNER-ONLY IS ENFORCED BELOW, NOT HERE. `Checkpoint.publishImport` asks `amOwner` itself
  //    since J28, so this layer does not restate it — a second copy of an authority rule in the
  //    layer that may not read the first is the drift P7 is about. What this layer does is report
  //    the refusal in words an operator can act on.
  //
  // WHAT AN OVERRIDE DOES NOT DO, and it is the same list as an import: it invites nobody and ranks
  // nobody. The file carries no ranks (J27 R7/R8), so the rotation it restores is a set of user IDs
  // rather than a claim about anyone. People already in this room keep the rank this room granted
  // them, because rank comes from the channel an event arrives on and nothing in a file can reach
  // that (P6). Members of the file's room who are not here simply drain out of the rotation as
  // their buffered songs play, by the hard fall-out rule that already exists.
  //
  // AND THE ROOM'S HISTORY BELOW THE CUT IS NOT DELETED BY THIS — it stops being COMPUTED FROM.
  // The override declares an origin, so every client folds from the file's seed forward over
  // whatever sits above the cut; the events below it remain in the log and the caches until an
  // ordinary trim sheds them. That is why the act is reversible only by another override, and why
  // it is owner-authored: adopting an origin floor is how a client is told to stop reading its own
  // history (trust-cascade.md §6).
  async function overrideFromFile(file) {
    const read = StreamManager.importFile ? StreamManager.importFile(file)
                                          : { ok: false, reason: "no-backend-support" };
    if (!read.ok) {
      Logger.warn("Room: override refused before changing anything — " + read.reason +
        (read.detail ? " (" + read.detail + ")" : ""));
      return { ok: false, reason: read.reason, detail: read.detail || null };
    }
    if (read.warning) {
      Logger.warn("Room: overriding from a file with " + read.warning +
        (read.missingKeys ? " [" + read.missingKeys.join(", ") + "]" : "") +
        " — those values come from this build's defaults");
    }

    if (MatrixBridge.mayAuthor && !MatrixBridge.mayAuthor()) {
      Logger.warn("Room: override declined — this client is not caught up, so it cannot anchor " +
        "on the room's head");
      return { ok: false, reason: "not-live", detail: "wait until the room has finished loading" };
    }

    if (!current) return { ok: false, reason: "no-room-open", detail: null };
    const ch = current.channels.settings_owner;
    if (!ch) return { ok: false, reason: "no-settings-channel", detail: null };

    // The file's rules, posted into THIS room. Last-write-wins by log position, so from here on the
    // room runs under the file's settings — and the checkpoint below anchors on this very event, so
    // the pointer names something this room really holds.
    let anchor = null;
    try {
      const receipt = await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: read.settings });
      if (!receipt || !receipt.eventId || !Number.isSafeInteger(receipt.l)) {
        throw new Error("the settings send reported no position to anchor on");
      }
      anchor = { settingsFrom: receipt.eventId, eventId: receipt.eventId, l: receipt.l };
      Logger.info("Room: override settings posted at l=" + receipt.l);
    } catch (e) {
      Logger.error("Room: override settings NOT posted (" + e.message +
        ") — nothing has changed and the room is unaffected");
      return { ok: false, reason: "settings-send-failed", detail: e.message };
    }

    // THE POINT OF NO RETURN IS HERE, AND IT IS STATED. The settings event above is already in the
    // room's log; if the checkpoint does not follow, the room keeps its own state under the file's
    // rules, which is a real and confusing halfway house. It is reported as exactly that rather
    // than as a generic failure, because the remedy differs from every other refusal above.
    try {
      const built = await StreamManager.importCheckpoint(read.seed, anchor);
      if (!built || !built.ok) throw new Error(built ? built.reason : "no-checkpoint");
      Logger.info("Room: override checkpoint published (floorL=" + built.cp.floorL + ")");
      return { ok: true, reason: null, floorL: built.cp.floorL, snapshots: read.snapshots };
    } catch (e) {
      Logger.error("Room: override checkpoint NOT published (" + e.message +
        ") — the room is now running the FILE's settings but still its own state. Retry the " +
        "override; it is the checkpoint that carries the state across, and posting the settings " +
        "again is harmless");
      return { ok: false, reason: "checkpoint-not-published", detail: e.message, settingsPosted: true };
    }
  }

  async function join(spaceId) {
    Logger.info("Room: joining " + spaceId);
    await MatrixBridge.joinDDJPSpace(spaceId);
    // joinDDJPSpace has joined the Space + every advertised child; now wait until
    // those child room objects have actually synced in, so the channel map below
    // is COMPLETE (a child still loading would be silently dropped from the map
    // and never replayed). Replaces a fixed 2s sleep; returns as soon as they
    // resolve, capped so it can't hang.
    await MatrixBridge.waitForSpaceChildren(spaceId, { needJoined: true });

    const space = MatrixBridge.getClient().getRoom(spaceId);
    const name = space ? space.name : spaceId;

    // Rebuild channel map from space children by room name
    // Room name "events-player" → key "events_player"
    const channels = {};
    if (space) {
      const children = space.currentState.getStateEvents("m.space.child");
      for (const child of children) {
        const roomId = child.getStateKey();
        const room = MatrixBridge.getClient().getRoom(roomId);
        if (!room) continue;
        const key = MatrixBridge.channelKeyFromName(room.name);
        channels[key] = roomId;
      }
    }

    current = { name, spaceId, channels };
    Store.config.saveRoom({ name, spaceId, channels });
    _initModules(current);
    _wireRankChange();
    _wireChannelAdded();

    // Replay every existing events-[rank] channel — full ordered log across ranks.
    // AWAIT it: history must be fully in StreamManager before we go live, or the
    // playback tick loop fires against pre-replay state (the documented cold-start
    // guarantee). The waitForSpaceChildren above already guaranteed every channel
    // room has synced in, so we go straight to replay (replayRoom paginates each
    // channel's full backlog itself); no fixed pre-replay sleep is needed.
    await _replayAllChannels(channels);

    // Only now, with history fully replayed into StreamManager, go live —
    // this starts Playback's tick loop, so it never ticks against empty state.
    _startModules();

    return current;
  }

  async function invite(userId) {
    if (!current) return;
    await MatrixBridge.inviteToSpace(current.spaceId, current.channels, userId);
    Logger.info("Room: invited " + userId);
  }

  // promote/demote both go through assignRank now.
  async function promote(userId, level) { return assignRank(userId, level); }

  async function _replayAllChannels(channels) {
    // Replay every existing events-[rank] channel so StreamManager sees the
    // complete ordered log across all ranks. Also replay settings-owner so the
    // derived room settings (ddjp.room.settings) are reconstructed. Blocks/
    // checkpoints are deferred.
    //
    // AWAIT every replay before returning. replayRoom is async — it back-paginates
    // each channel's FULL history before ingesting — so firing these without
    // waiting let _startModules() (and with it Playback's tick loop + UserQueue
    // resync) run against a half-replayed Spine. That is the exact race the
    // wire -> replay -> start split exists to prevent (docs/consensus/consensus-models.md "Joiner
    // cold-start"): the advance-lock chain can't anchor from its p=null genesis on
    // a truncated log, so already-played songs resurface. allSettled (not all) so
    // one channel's failure can't strand the rest and leave us never going live.
    const jobs = [];
    for (const key in channels) {
      // Replay every events-* channel (the Spine) and every settings-* channel.
      // settings-owner reconstructs the derived room settings. THE OTHER TWO SETTINGS CHANNELS ARE
      // GONE — `settings-staff` and `settings-high-staff` were removed from the channel table
      // because delegation became bot policy and never wrote to them; see the note there. The loop
      // is unchanged and deliberately so: it walks the ROOM'S OWN channel map, so a room built
      // before the removal still carries those two and still replays them, exactly as it replays
      // any other channel. The reducer honours only settings-owner, so their history changes
      // nothing either way.
      // checkpoints_* are replayed too (Phase 10): a joiner must see existing checkpoints so
      // Floor can verify + adopt the newest trusted one (and later re-seed from it).
      // They're reducer-inert (derive ignores ddjp.checkpoint), so replaying them is safe.
      if ((key.indexOf("events_") === 0 || key.indexOf("settings_") === 0 || key.indexOf("checkpoints_") === 0) && channels[key]) {
        jobs.push(MatrixBridge.replayRoom(channels[key]));
      }
    }
    await Promise.allSettled(jobs);
  }

  // Wiring phase: reset state, seed this room's clock, and wire every module
  // EXCEPT Playback's live tick loop. Safe to call before replay — nothing here
  // acts on stream state on a timer; it only subscribes and prepares.
  function _initModules(room) {
    StreamManager.reset();
    // Reset the per-room reliability modules too, so state from a previous room can't leak in:
    // ServerClock's offset (a different homeserver's clock), Floor's trusted checkpoint
    // + seal baseline, and (via wireCheckpoints below) the recovery queue. StreamManager.reset
    // only clears its OWN state — these are separate modules and must be reset explicitly.
    try { if (typeof ServerClock !== "undefined" && ServerClock.destroy) ServerClock.destroy(); } catch (e) {}
    try { if (typeof MatrixBridge.resetCheckpoints === "function") MatrixBridge.resetCheckpoints(); } catch (e) {}
    MatrixBridge.seedClock(room.spaceId);   // per-room Lamport clock starts/resumes here

    const ch = room.channels;

    // ── BIND THIS ROOM'S SCOPE BEFORE ANYTHING IS REPLAYED ───────────────────────────────
    // resetCheckpoints() above cleared the last room's scope; this sets ours. It has to happen
    // HERE — after the clear, before replay — because sync keeps delivering events from every
    // room the whole time, and until a scope is bound the ingest door refuses everything.
    //
    // Resetting the modules (above) was never enough on its own: it cleaned the state and left
    // the door open, so the room we just left kept feeding this one. That is how a fresh room
    // inherited another room's positions and another room's ranks.
    //
    // When the backend registry lands (consensus/backend-selection.md §2c) this moves into
    // `Backends.bind(modeId)`, which is already specified to sit at exactly this point in the
    // wire → replay → start flow. Nothing else about the gate changes.
    try { if (typeof MatrixBridge.setRoomScope === "function") MatrixBridge.setRoomScope(ch); } catch (e) {}

    // Protocol events — write to the HIGHEST-rank channel we can write to.
    // The rank of that channel is our rank; transport picks it from our write
    // permissions and degrades gracefully if higher-rank channels don't exist.
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;

    // Chat — everyone uses the uncategorized chat for now. (A future room setting
    // will let an owner repoint the default to guest; not hardcoded beyond this.)
    // J12 — the ONE resolver decides the initial channel too, rather than a third inline copy of
    // "which chat channel". `applyChatTiers` is called after wiring below, once `current` is set.
    const chatChannel = ch.chat_uncategorized || ch.chat_guest;

    if (eventsChannel) {
      Queue.init(eventsChannel);
      Skip.init(eventsChannel);
      Playback.initWiring(eventsChannel);   // subscribe only — does NOT start ticking yet
      // Reactions is a non-critical annotation feature (★ save / ▲ vote). It wires LAST and
      // defensively: if features/reactions.js failed to load (stale cache / missing file /
      // bad ?v=), it must NOT throw and take the core play loop (Queue/Skip/Playback) down
      // with it. Guarded so a reactions problem can only ever disable reactions.
      try { if (typeof Reactions !== "undefined" && Reactions.init) Reactions.init(eventsChannel); }
      catch (e) { Logger.warn("Room: Reactions.init failed (reactions disabled): " + (e && e.message)); }
      // MediaLength: shared song length (display-only, reducer-inert). Same defensive
      // wiring as Reactions — a length problem can only ever disable the countdown, never
      // the play loop. We inject MY CHANNEL RANK (authority is the channel, not the person)
      // so the rank-staggered ladder knows my answer slot.
      try {
        if (typeof MediaLength !== "undefined" && MediaLength.init) {
          MediaLength.setMyRank(MatrixBridge.getMyRank(current.channels));
          MediaLength.init(eventsChannel);
        }
      } catch (e) { Logger.warn("Room: MediaLength.init failed (length sharing disabled): " + (e && e.message)); }
      // ServerClock: the local Matrix clock (display/timing-only). Learns a server-time offset
      // from the ts on every incoming event — ZERO extra messages — so playback elapsed and the
      // ceiling are computed in shared server-time and agree across clients. Replaces the old
      // ddjp.media.time drift beacon entirely (deleted). It observes StreamManager directly and
      // is channel-independent, so it's init'd once here (idempotent) — no per-rewire re-init.
      try { if (typeof ServerClock !== "undefined" && ServerClock.init) ServerClock.init(); }
      catch (e) { Logger.warn("Room: ServerClock.init failed (playback falls back to local clock): " + (e && e.message)); }
      // (Live checkpoints are wired inside the backend — MatrixBridge.wireCheckpoints — since
      // the consensus layer is a backend internal; features must not reach it directly. See boundaries.)
      try { if (MatrixBridge.wireCheckpoints) MatrixBridge.wireCheckpoints(current.channels); }
      catch (e) { Logger.warn("Room: wireCheckpoints failed (checkpoints disabled): " + (e && e.message)); }
      // MediaBlocked: "I can't see this" declarations. NOT display-only and NOT reducer-inert —
      // this comment said both and neither has been true since the skip roads landed:
      // `ddjp.play.blocked` is FOLDED, carries a typed reason (J06), and is what the availability
      // escape is derived from. It is also consensus-critical and therefore vouched. Rank injected
      // for the staggered report ladder. Defensive — a blocked-report problem can only ever
      // disable the tally, never the queue.
      try {
        if (typeof MediaBlocked !== "undefined" && MediaBlocked.init) {
          MediaBlocked.setMyRank(MatrixBridge.getMyRank(current.channels));
          if (typeof Playback !== "undefined" && Playback.setMyRank) Playback.setMyRank(MatrixBridge.getMyRank(current.channels));
          MediaBlocked.init(eventsChannel);
        }
      } catch (e) { Logger.warn("Room: MediaBlocked.init failed (blocked reports disabled): " + (e && e.message)); }
    } else {
      Logger.warn("Room: no writable events channel — queue/skip/playback not wired");
    }

    if (chatChannel) {
      Chat.init(chatChannel);
      // J12 — bind the READABLE SET at entry, not only when a settings event arrives. Without
      // this a client that never sees a `ddjp.room.settings` event has an empty readable set and
      // `_handleRaw` fails closed on everything, which is the correct direction and the wrong
      // moment: chat would be silent in a room whose settings never changed. The resolver is the
      // same one the settings path uses (P7) — this is a second CALLER, never a second copy.
      try { applyChatTiers(); } catch (e) { Logger.warn("Room: chat tiers not applied — " + (e && e.message)); }
      // ── AND ANY PENDING INVITE TO THIS SPACE'S OWN CHANNELS ────────────────────────────────
      // AT WIRING, not only on the membership hook: an invite that arrived while this tab was
      // closed is never re-announced, so a client that only listened would come back and stay out.
      try { acceptChannelInvites(); } catch (e) {
        Logger.warn("Room: could not reconcile channel invites — " + ((e && e.message) || e));
      }
    } else {
      Logger.warn("Room: no chat channel available — chat not wired");
    }

    // DMs (J15) bind INDEPENDENTLY of the room's chat channel and are deliberately outside the
    // `if` above: a conversation is with a person, not inside a room, so a room with no chat
    // channel is not a reason to have no conversations. Failing here can only ever disable DMs —
    // the same defensive wiring Reactions and MediaLength get, for the same reason.
    try { if (Chat.dmInit) Chat.dmInit(); }
    catch (e) { Logger.warn("Room: Chat.dmInit failed (DMs disabled): " + (e && e.message)); }

    // Room upgrades watch the owner channel for batch start/done events.
    RoomUpgrade.init(ch.events_owner);

    // Personal song stack that auto-feeds the rotation when active.
    UserQueue.init(room.spaceId);

    // Room settings derive from settings-owner; subscribe once and apply (points
    // chat at the configured tier). Replay (join) feeds the current setting in.
    _wireSettings();
    _applySettings();   // apply current/default immediately so chat starts on the right tier

    // Blocks are deferred — the room navigates the raw event stream directly.

    _hasEventsChannel = !!eventsChannel;

    // ── THE BOT, LAST ─────────────────────────────────────────────────────────────────────
    // After every other module is wired, because the runtime's request handler authors settings
    // through `setSettings`, which reads `current` and the settings the subscription above just
    // applied. Started before them it could act on a request in the same tick with a half-wired
    // room underneath it. It is also the only module here that usually does NOT start: every
    // client that is not the bot reaches this line and is refused, which is the intended path
    // rather than a failure, so it is deliberately not wrapped in a warning.
    _evaluateBot();

    Logger.info("Room: modules wired" +
      " events=" + (eventsChannel || "none") +
      " rank=" + MatrixBridge.getMyRank(ch) +
      " chat=" + (chatChannel || "none"));
  }

  // Start phase: called only AFTER replay (for join) or immediately after
  // wiring (for create, which has no history to replay). This is what actually
  // begins Playback's live tick loop, so the loop never sees empty pre-replay
  // state. Idempotent and safe if there's no events channel.
  function _startModules() {
    UserQueue.resync();   // history is in place — reconcile auto-feed to real membership
    // OPEN THE SEAL GATE. This function runs only AFTER replay, which is exactly the condition a
    // checkpoint needs: it is a claim about where the room IS, and a client still folding history is
    // not there yet. Sealing before this point banked a moment that had already ended, published it,
    // and adopted it — see Checkpoint.maySeal.
    try { MatrixBridge.setRoomLive(true); } catch (e) {}
    if (_hasEventsChannel) Playback.start();
    Logger.info("Room: modules started (live)");
  }

  // Re-route protocol writes when our rank changes (we may gain or lose a higher
  // channel). Re-points the feature modules at the new highest writable channel.
  function _rewireWriteChannel() {
    if (!current) return;
    const ch = current.channels;
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;
    if (!eventsChannel) return;
    Queue.init(eventsChannel);
    Skip.init(eventsChannel);
    Playback.init(eventsChannel);
    try { if (typeof Reactions !== "undefined" && Reactions.init) Reactions.init(eventsChannel); }
    catch (e) { Logger.warn("Room: Reactions.init (rewire) failed: " + (e && e.message)); }
    // my channel authority may have changed — re-inject it so my ladder slot updates
    try {
      if (typeof MediaLength !== "undefined" && MediaLength.init) {
        MediaLength.setMyRank(MatrixBridge.getMyRank(ch));
        MediaLength.init(eventsChannel);
      }
    } catch (e) { Logger.warn("Room: MediaLength.init (rewire) failed: " + (e && e.message)); }
    // ServerClock needs no rewire — it observes StreamManager directly, independent of channel.
    try {
      if (typeof MediaBlocked !== "undefined" && MediaBlocked.init) {
        MediaBlocked.setMyRank(MatrixBridge.getMyRank(ch));
        if (typeof Playback !== "undefined" && Playback.setMyRank) Playback.setMyRank(MatrixBridge.getMyRank(ch));
        MediaBlocked.init(eventsChannel);
      }
    } catch (e) { Logger.warn("Room: MediaBlocked.init (rewire) failed: " + (e && e.message)); }
    // Checkpoints follow the SAME rule as events: re-bind to the highest checkpoints channel we
    // can now write to, so a promotion/demotion switches BOTH immediately (not at next room entry).
    try { if (MatrixBridge.wireCheckpoints) MatrixBridge.wireCheckpoints(ch); }
    catch (e) { Logger.warn("Room: wireCheckpoints (rewire) failed: " + (e && e.message)); }
    // ── AND THE BOT, FOR THE SAME REASON THE OTHER TWO ARE HERE ───────────────────────────
    // Bot mode is a reading of this account's level, so a level change is exactly when it can
    // become true or stop being true. Deferring to the next room entry would leave a demoted
    // account still acting as the bot for as long as it stayed in the room — authoring settings
    // at an authority it no longer holds — and a freshly promoted one inert until it navigated
    // away and back. `_evaluateBot` stops before it starts, so both directions land here.
    _evaluateBot();
    Logger.info("Room: rank changed — now writing to " + eventsChannel +
      " (rank " + MatrixBridge.getMyRank(ch) + ")");
    for (const fn of _rankChangeListeners) { try { fn(MatrixBridge.getMyRank(ch)); } catch (e) {} }
  }

  // --- DDJP room discovery ---
  // Scans the Matrix client's already-synced room list for DDJP-formatted spaces.
  // A space is DDJP if it has children named "events-owner" and "events-uncategorized".
  // Returns { owned: [...], joined: [...], invited: [...] }, each entry
  // { name, spaceId }. "owned"/"joined" are validated DDJP spaces you're
  // already a member of (children synced, checked the same way as before).
  // "invited" are spaces you've been invited to but haven't joined — their
  // child rooms are NOT synced yet (Matrix doesn't sync invite-room children),
  // so they're identified by space type alone; full validation happens once
  // accepted and joined, same as any other join.
  function scanDDJPRooms() {
    const matrixClient = MatrixBridge.getClient();
    if (!matrixClient) return { owned: [], joined: [], invited: [] };

    const userId = MatrixBridge.getUserId();
    const owned = [], joined = [], invited = [];

    for (const room of matrixClient.getRooms()) {
      // Must be a Matrix Space
      const createEvent = room.currentState.getStateEvents("m.room.create", "");
      if (!createEvent || createEvent.getContent().type !== "m.space") continue;

      const membership = room.getMyMembership ? room.getMyMembership() : "join";

      if (membership === "invite") {
        invited.push({ name: room.name || room.roomId, spaceId: room.roomId });
        Logger.debug("Room.scan: " + room.name + " — pending invite");
        continue;
      }
      if (membership !== "join") continue;   // ignore left/banned/etc.

      // Must have children named "events-owner" and "events-uncategorized" —
      // these are the two channels guaranteed to exist from room creation
      // (Batch 1). events-player does NOT exist until the room's first
      // upgrade (Batch 2), so checking for it here would hide every room
      // that hasn't been upgraded yet — including rooms you just created.
      const children = room.currentState.getStateEvents("m.space.child");
      let hasEventsOwner = false;
      let hasEventsUncategorized = false;
      for (const child of children) {
        const childRoom = matrixClient.getRoom(child.getStateKey());
        if (!childRoom) continue;
        if (childRoom.name === MatrixBridge.channelName("events", "owner"))         hasEventsOwner = true;
        if (childRoom.name === MatrixBridge.channelName("events", "uncategorized")) hasEventsUncategorized = true;
      }
      if (!hasEventsOwner || !hasEventsUncategorized) continue;

      // Owner-or-above in the space. Compared BY NAME via Capabilities.atLeast — the owner
      // rung's level is the ladder's business, and a literal here would have gone stale when it
      // moved from 100 to 99.
      const plEvent = room.currentState.getStateEvents("m.room.power_levels", "");
      const pl = plEvent ? plEvent.getContent() : {};
      const userLevel = (pl.users && pl.users[userId] !== undefined)
        ? pl.users[userId]
        : (pl.users_default || 0);
      const isOwner = Capabilities.atLeast(userLevel, "owner");

      const entry = { name: room.name, spaceId: room.roomId };
      (isOwner ? owned : joined).push(entry);
      Logger.debug("Room.scan: " + room.name + " isOwner=" + isOwner);
    }

    Logger.info("Room.scan: owned=" + owned.length + " joined=" + joined.length + " invited=" + invited.length);
    return { owned, joined, invited };
  }

  // Accept a pending space invite: join the space, then join every channel
  // inside it that the room already shows as a child (the channels the user
  // has matching invites/access to). Matrix does not sync an invited space's
  // children automatically, so a join is required before the room's real
  // channel state becomes visible at all.
  async function acceptInvite(spaceId) {
    await MatrixBridge.joinDDJPSpace(spaceId);
    Logger.info("Room: accepted invite to " + spaceId);
  }

  // Live room-list updates. Matrix fires events when you're invited to a room,
  // join/leave one, or a new room appears in sync. We debounce because a single
  // logical change (e.g. accepting an invite) emits several events in a burst;
  // without debouncing the list would re-scan many times in a row.
  const _roomsChangedListeners = [];
  let _roomsWired = false;
  let _roomsDebounce = null;
  function onRoomsChanged(fn) {
    if (fn && !_roomsChangedListeners.includes(fn)) _roomsChangedListeners.push(fn);
    _wireRoomsChanged();
  }
  function _fireRoomsChanged() {
    if (_roomsDebounce) clearTimeout(_roomsDebounce);
    _roomsDebounce = setTimeout(() => {
      _roomsDebounce = null;
      const scanned = scanDDJPRooms();
      for (const fn of _roomsChangedListeners) { try { fn(scanned); } catch (e) {} }
    }, 400);
  }
  function _wireRoomsChanged() {
    if (_roomsWired) return;
    if (!MatrixBridge.getClient()) return;   // not logged in yet; caller can re-invoke after login
    // The SDK listeners live in transport. "Room" fires when a new room/space
    // shows up; "Room.myMembership" fires on invite/join/leave — exactly what
    // moves a space between the owned/joined/invited buckets. We subscribe to
    // the transport emitter and re-scan (debounced); we never attach `.on()` to
    // the client ourselves (that's the transport boundary).
    MatrixBridge.onRoomsChanged(_fireRoomsChanged);
    // THE SAME RECONCILE ON EVERY MEMBERSHIP CHANGE. `Room.myMembership` fires on invite, join and
    // leave, so this catches an invite arriving live — and re-running it is free, because it reads
    // what is true now rather than acting on what the event said.
    // NAMED, NOT ANONYMOUS. `offRoomsChanged` matches by identity, so an inline arrow can never be
    // removed — and `_wireRoomsChanged` is guarded against running twice, which is what keeps this
    // to one listener rather than what makes it removable. The distinction matters the day
    // something wants to tear these down.
    MatrixBridge.onRoomsChanged(_onRoomsChangedInvites);
    _roomsWired = true;
  }

  // NAMED, so the reader can index the EXPORTED table rather than a closure constant. That is not
  // ceremony: `ACTIVITY_SOURCES` is already indexed this way and a guard drives it by MOVING the
  // entry, which is the only way to tell a table lookup from a restated key. The window key needs
  // the same, and `mutate-one-window` M4 came back green until it had it.
  const api = {
    create, createFromFile, overrideFromFile, pendingCreate, resumeCreate, discardPendingCreate, join, invite, acceptInvite, promote, assignRank, canAssignRank, isRankUnlocked, highestUnlockedRank, rankLadder, mergeChannels,
    kick, ban, canModerate,
    // J-repeat: the ONE reading of the replay cooldown, exported beside `idleFor` for the same
    // reason — the fold is pure and drivable at explicit values, and the two callers (the bot's
    // skip and every client's add) must never grow a second copy of it.
    playedWithin, canQueue,
    // Guard seam, and the same argument as `MatrixBridge._setClientForTest`: `current` is
    // established by a join flow that replays every channel and cannot run headless, so without
    // this the live-rank re-check inside `_moderate` could only be asserted as SOURCE TEXT — and
    // a regex proving a comparison is spelled somewhere proves nothing about whether it runs.
    // That re-check is the ONLY backstop a membership act has, because no reducer ever sees one,
    // so it is the last thing in this file that should be guarded by reading.
    botStatus,
    _setCurrentForTest: function (c) { current = c; } /* exposed for the guard */,
    getCurrent, getChannels, scanDDJPRooms, onRoomsChanged,
    getSettings, getSettingRanges, setSettings, onSettingsChange, getSettingRows, editSettingTable,
    getMyId, getMyRank, getMyAuthorityLevel, getRoster, onRankChange,
    // J16 — the activity list. `foldActivity` is pure and exported beside its live reader
    // deliberately: the reach bound and the window bound are the two things that decide whether
    // this list can claim more than it looked at, and a rule only a live client can reach is a
    // rule a guard has to assert as source text.
    recentlyActive, foldActivity, ACTIVITY_SOURCES, ACTIVITY_WINDOW_KEY, ACTIVITY_GROUPS_KEY,
    idleFor,
    // J13 — the event feed. Same shape and same argument as the pair above: the fold is pure so
    // its arithmetic can be driven at explicit values, and the reader is thin so there is one line
    // that decides where the log comes from. `FEED_KINDS` and `FEED_UNNAMED` are exported because
    // the guard asserts they DECIDE about every type the reducer handles — a table read out of the
    // module is a table that cannot drift from the one that ships.
    recentEvents, foldFeed, FEED_KINDS, FEED_UNNAMED,
    // J12 — the one resolver that turns a tier into a channel, and its two callers. Exported
    // because the guard drives the RESOLUTION rather than reading the expression: which tier wins
    // when a device override and the room's setting disagree is the whole of this job's Open.
    chatTiers, applyChatTiers, selectChatTier,
    // EXPORTED FOR THE GUARD AND NOTHING ELSE, said plainly because this tree keeps a list of
    // functions that were exported, never called, and taken for working. Production reaches it
    // through the two wiring sites above, which call it directly. `check-invite-accept` drives it
    // by name because the wiring sites have none.
    acceptChannelInvites,
    heldCheckpoints, exportCheckpoint
  };
  return api;
})();
