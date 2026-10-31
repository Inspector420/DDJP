// features/room.js
// Owns room lifecycle — create, join, invite, rank assignment.
// Wires feature modules to the current room on entry.
// Depends on: MatrixBridge, StreamManager, Playback, Queue, Skip, Chat, Store, Logger
//
// Channel routing:
//   Protocol events write to → the highest-rank events channel we can write to
//   Chat reads/writes → the tiers `chatTiers()` resolves (the room's `chat` setting, or this device's view)
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
  let _replayed = false;           // false from the opening until `_startModules`: the room's history is not folded yet (J115)
  // Same-session resume of an interrupted create. If createDDJPSpace fails part
  // way, it throws with e.partial = { spaceId, channels }; we stash it here so a
  // retry of the SAME room name resumes (building only what's missing) instead of
  // starting a second space. Also saved to disk (`Store.config.savePendingCreate`), so a reload can resume it.
  let _pendingCreate = null;       // { name, partial: { spaceId, channels } } | null
  let _creatingRoom = false;       // feature-layer re-entrancy guard (transport has its own backstop)

  function getCurrent() { return current; }
  function getChannels() { return current ? current.channels : null; }
  function getMyId() { return MatrixBridge.getUserId(); }
  function getMyRank() { return current ? MatrixBridge.getMyRank(current.channels) : 0; }
  function getRoster() { return current ? MatrixBridge.getRoster(current.spaceId) : []; }
  function onRankChange(fn) { if (fn && !_rankChangeListeners.includes(fn)) _rankChangeListeners.push(fn); }
  // Someone joined, left or was removed (ddjp_471) — passed through from the transport, deciding nothing.
  function onMembersChange(fn) { try { if (MatrixBridge.onMemberChange) MatrixBridge.onMemberChange(fn); } catch (e) {} }
  // ── "THE PEOPLE VIEW CHANGED" (the owner's ruling 35; generic) ─────────────────────────────────────────────────────
  // Something the People tab shows changed that the tab does not already listen for — REP's numbers, today, raised by
  // REP's reader through its port. It says only THAT the view changed, never what or why, so it names nothing of REP; the
  // tab redraws once per burst (`Panels.peopleViewChanged`). Listeners are added once per page, like the member feed's.
  const _peopleViewListeners = [];
  function onPeopleViewChange(fn) { if (typeof fn === "function" && _peopleViewListeners.indexOf(fn) < 0) _peopleViewListeners.push(fn); }
  function peopleViewChanged() { for (const fn of _peopleViewListeners.slice()) { try { fn(); } catch (e) {} } }
  // ── "THE BOT CARD CHANGED" (J117, `ddjp_630`; generic) ──────────────────────────────────────────────────────────────
  // What the bot's own card in the settings panel shows has moved — REP's bot side, today, through its port, when its card
  // would read differently. It says only THAT the card changed, never what, so it names nothing of REP; the panel redraws
  // that card alone, while it is open (`Settings.refreshRepCard`). Listeners are added once per page.
  const _botCardListeners = [];
  function onBotCardChange(fn) { if (typeof fn === "function" && _botCardListeners.indexOf(fn) < 0) _botCardListeners.push(fn); }
  function botCardChanged() { for (const fn of _botCardListeners.slice()) { try { fn(); } catch (e) {} } }
  // ── "THE CHAT TIERS CHANGED" (`ddjp_621`) ────────────────────────────────────────────────────────────────────────────
  // A chat channel was mapped after the room was wired — joined late, or its mark read late — so the chat panel re-resolves
  // its tiers (`ChatPanels.syncChatTier`). It says only that the tiers changed. Listeners are added once per page.
  const _chatTiersListeners = [];
  function onChatTiersChanged(fn) { if (typeof fn === "function" && _chatTiersListeners.indexOf(fn) < 0) _chatTiersListeners.push(fn); }
  // Whether this room's chat is wired (`Chat.init`): set at wiring, and when a chat is mapped later; cleared by the leave.
  let _chatWired = false;

  // ── WHO HAS DONE SOMETHING RECENTLY (J16) ──────────────────────────────────────────────────
  // This system has no presence protocol, so "who is here" can only ever mean "who has done
  // something recently". The list is folded out of the log every time it is asked for and holds
  // NO state of its own (P5) — in particular there is no side-table of last-seen stamps, because
  // one would survive a trim and go on naming somebody whose evidence this client has destroyed.
  //
  // THIS LIST DOES NOT DEPEND ON THE BOT, AND THE DEPENDENCY THAT WAS DECLARED WAS NOT REAL.
  // J16 was filed with one on J20 and it was refuted by building this without one: *"who is
  // here"* can only honestly mean *"who has done something recently"*, and that is computable from
  // `StreamManager.getLog()` alone, because every entry already carries a `sender` and a server
  // `ts`. **The bot is J20's mechanism, not this panel's precondition.** A running bot widens what
  // can be SEEN (it reads chat, below); it is never what makes the list derivable. Anything that
  // re-couples the two is re-introducing a dependency that was measured away.
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
  // `ChatPrefs.activityWindowMs()` (device-local) while the bot's rules — `activityPresence`,
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
  // **J20 INHERITED THIS.** The whole AFK rule is in `docs/consensus/bot-model.md` §5.1c, and any presence
  // job that read a different window would re-open exactly this.
  //
  // ── AND THE SEPARATION IS ONLY PARTLY EXPRESSIBLE, WHICH IS THE REAL FINDING ────────────────
  // DRIVEN before deciding:
  //   · Room ACTIONS ARE expressible — the log holds them, so the fold can honour the action list.
  //   · `botPresenceChat` IS NOT, AND NEVER WILL BE. `_routeEvent` skips chat-named rooms before
  //     `StreamManager.ingest`, so chat is not in the log and cannot be. This is not a filter the
  //     fold is missing; it is data the fold will never have.
  // So a room with `botPresenceChat: true` has a definition of "active" the panel is structurally
  // incapable of computing. **The two WILL disagree, and the honest response is for the panel to
  // SAY SO rather than to imply agreement** — which is why `unobservable` travels with the fold.
  // Merging them by pretending chat can be counted would be the accident this job exists to avoid.
  //
  // THE DEFAULTS NO LONGER HIDE IT. This read "shipped `botPresenceChat: false` matches what the
  // fold cannot count — flip it and the accident ends"; the default has since become `true`, so
  // every room on defaults has a presence rule the fold cannot compute, and `unobservable` is what
  // keeps the People panel honest about it in every such room, not only in a changed one.
  //
  // ── A THIRD DIVERGENCE, UNNAMED UNTIL THIS JOB ─────────────────────────────────────────────
  // The fold counted every log entry with a sender, INCLUDING acts the reducer REFUSED. Driven: a
  // settings event from a player is rejected by the fold and still made its sender "active".
  // J13's feed already excludes refused events on the grounds that a refused act did not happen,
  // and the same reasoning applies here even harder — being listed as present because of an act
  // the room threw away is a claim about a person that no event supports. `isLegalFn` is taken
  // rather than reached for, so the arithmetic stays drivable at explicit values.
  // ONE SETTING NOW (ddjp_498): room actions always count, filtered by `activityPresence`; the switch
  // that could turn them off gated nothing an unticked list does not, and was removed. The fold keeps
  // its own `spine` input — a caller can still fold without the log — but no room setting feeds it.
  const ACTIVITY_SOURCES = { chat: "botPresenceChat" };
  // The window is the BOT'S THRESHOLD, named here so the reader indexes one table rather than
  // spelling the key — the same reason the sources are in a table, and the same protection when a
  // key is renamed.
  let ACTIVITY_WINDOW_KEY = "botAfkMs";
  // The PRESENCE map's key. Named here beside the window key for the same reason that one is: the
  // panel reads both to state the rule it applied, and a caller supplying either would be the
  // second answer to one question that `foldActivity`'s header is about.
  let ACTIVITY_GROUPS_KEY = "activityPresence";
  function foldActivity(log, nowTs, windowMs, sources, isLegalFn, groupsWanted, groupOfFn, older) {
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
    // What the background read saw before the held log (J67): its acts under the same groups, and
    // how far back it looked as reach. Spine-derived, so only when the spine is a source.
    if (older && typeof older === "object" && wantSpine) {
      for (const u in (older.by || {})) {
        const row = older.by[u];
        for (const g in row) {
          if (wantGroups[g] !== true || typeof row[g] !== "number") continue;
          const t2 = row[g];
          if (oldest === null || t2 < oldest) oldest = t2;
          if (newest === null || t2 > newest) newest = t2;
          const r2 = by[u] || (by[u] = { userId: u, lastTs: 0, acts: 0 });
          if (t2 > r2.lastTs) r2.lastTs = t2;
        }
      }
      if (typeof older.since === "number" && (oldest === null || older.since < oldest)) oldest = older.since;
    }
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
  // `{ known: false }` rather than idle-forever when the log's reach is shorter than the window —
  // their evidence may simply have been trimmed. Removing on absence would remove everybody after
  // a trim. With a full window of reach, absence is overdue (a lower bound, below).
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
    // ── WHAT THE BACKGROUND READ SAW BEFORE THE HELD LOG (J67, stage 2) ─────────────────────
    // An engine that opened from a save point reads older events back into a last-activity list;
    // its acts count under the same groups, and how far back it looked counts as reach.
    let older = null;
    try { older = (typeof StreamManager.olderActivity === "function") ? StreamManager.olderActivity() : null; }
    catch (e) { older = null; }
    if (older) {
      const row = older.by ? older.by[userId] : null;
      if (row) {
        for (const g in row) {
          if (groups[g] === true && typeof row[g] === "number" && (last === null || row[g] > last)) last = row[g];
        }
      }
      if (typeof older.since === "number" && (reachOldest === null || older.since < reachOldest)) reachOldest = older.since;
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

  // ── THE VIEWER'S OWN CHAT RECORD — THE PEOPLE TAB (J75, owner ruling 1) ─────────────────────────────
  // The People tab works from each viewer's own view; the bot's published list is gone. This app tracks chat itself:
  // WHO spoke and WHEN — never what — in the chat tiers this viewer's rank unlocks (`chatTiers()`), kept PER TIER, only
  // the last time per person, nothing older than the longest window the settings allow (`Activity.maxWindowMs`).
  // Opening a room reads each visible tier back only as far as the window needs — the bot's read-back,
  // `MatrixBridge.readBackActivity`, which stops once it reaches the window; a tier GAINED is read back for the window,
  // and until then the tab says it cannot fully tell for that tier; a tier LOST is dropped, so the tab counts only what
  // this viewer can see now. A wider window reads further back; a narrower one keeps what it has; a room switch starts
  // fresh. Whether chat counts is judged when the tab reads, from what is kept — no download. Accepted: the tab may differ
  // from the bot for people active only in tiers this viewer cannot read.
  // ── THE ONE RECORD, FOR THE BOT TOO (J84-2; the owner's ruling 30a) ──────────────────────────────────────────────────
  // The bot kept a second copy of this record (`_chatSeen`, fed by `Chat.onMessage` and its own read-back) until J84-2. Now
  // the bot's tab reads this one, through `presenceView`, for both of its verdicts — the presence chat's and the queue's
  // (`botQueueChat`) — so "who is active" has one home. Two rules came across with it, each the bot's and now everyone's:
  //   A TIER IS KNOWN FROM THE MOMENT IT IS WATCHED. A record is made with `coveredFrom` at the time it starts listening, so
  //   it can answer for a window once it has watched that long, even when its read-back fails; a read-back that reaches
  //   further lowers it. (Before, a viewer's tier stayed "can't fully tell" until a read-back succeeded.)
  //   THE READ-BACK REACHES THE BOT'S WINDOW (ruling 30b): `Capabilities.activityWindowMs` — the longest away time plus the
  //   longest warning time — not `botAfkMs` alone, so devices and the bot look back exactly as far, with this code.
  const _vc = { key: null, tiers: Object.create(null), gen: 0, wired: false };
  // Read through the module's own exports, so a test can hand it a room and its tiers; the app's behaviour is identical.
  function _vcKey() { try { const c = (api && typeof api.getCurrent === "function") ? api.getCurrent() : current; return (c && c.channels) ? JSON.stringify(c.channels) : null; } catch (e) { return null; } }
  function _vcWire() {
    if (_vc.wired || typeof MatrixBridge === "undefined" || typeof MatrixBridge.onRawEvent !== "function") return;
    _vc.wired = true;
    MatrixBridge.onRawEvent(function (raw) {
      try {
        if (!raw || raw.type !== "m.room.message" || !raw.sender) return;
        const t = _vc.tiers[raw.room_id];
        if (!t) return;
        const ts = (typeof raw.ts === "number") ? raw.ts : raw.origin_server_ts;
        if (typeof ts === "number" && !(t.people[raw.sender] >= ts)) t.people[raw.sender] = ts;   // who and when, never what
      } catch (e) {}
    });
  }
  function _vcRead(id, since) {
    const t = _vc.tiers[id], gen = _vc.gen;
    if (!t || t.reading || typeof MatrixBridge === "undefined" || typeof MatrixBridge.readBackActivity !== "function") return;
    t.reading = true;
    Promise.resolve(MatrixBridge.readBackActivity(id, since)).then(function (r) {
      if (gen !== _vc.gen || _vc.tiers[id] !== t) return;      // the room changed, or the tier was lost, while reading
      t.reading = false;
      if (!r || r.ok !== true) return;
      for (const u of Object.keys(r.people || {})) { const ts = r.people[u]; if (typeof ts === "number" && !(t.people[u] >= ts)) t.people[u] = ts; }
      const reached = r.complete ? -Infinity : r.reachedTs;
      if (typeof reached === "number") t.coveredFrom = (t.coveredFrom === null) ? reached : Math.min(t.coveredFrom, reached);
    }, function () { if (gen === _vc.gen) t.reading = false; });
  }
  // Brought up to date whenever the tab reads it: the room, the tiers the viewer can read NOW, the window.
  function _vcSync(now, windowMs) {
    _vcWire();
    const key = _vcKey();
    if (key !== _vc.key) { _vc.key = key; _vc.tiers = Object.create(null); _vc.gen++; }        // a room switch starts fresh
    let tiers = [];
    try { tiers = (((api && typeof api.chatTiers === "function") ? api.chatTiers() : chatTiers()).tiers || []).filter((x) => x && x.id); } catch (e) { tiers = []; }
    const want = Object.create(null);
    for (const x of tiers) want[x.id] = x.tier;
    for (const id of Object.keys(_vc.tiers)) if (!(id in want)) delete _vc.tiers[id];         // losing access drops its records
    for (const id of Object.keys(want)) if (!_vc.tiers[id]) _vc.tiers[id] = { name: want[id], people: Object.create(null), coveredFrom: now, reading: false };   // known from now: watched from here (J84-2)
    const since = now - Math.max(0, windowMs || 0);
    for (const id of Object.keys(_vc.tiers)) {
      const t = _vc.tiers[id];
      if (t.coveredFrom === null || t.coveredFrom > since) _vcRead(id, since);               // opening, a tier gained, a wider window
    }
    let longest = Infinity;
    try { longest = (typeof Activity !== "undefined" && Activity.maxWindowMs) ? Activity.maxWindowMs() : Infinity; } catch (e) { longest = Infinity; }
    if (isFinite(longest)) for (const id of Object.keys(_vc.tiers)) {
      const t = _vc.tiers[id];
      for (const u of Object.keys(t.people)) if (t.people[u] < now - longest) delete t.people[u];   // self-cleaning
    }
  }
  // THE RECORD, AS EVERY VERDICT READS IT (J84-2): each person's newest chat time across the tiers, and the time from which
  // every tier is known (−Infinity when all were read back to their start; null when no tier is watched at all — a room
  // whose tiers cannot be resolved has certified nothing). A verdict over a window W can rule chat out only when
  // `chatKnownFrom <= now − W` — the bot's rule, now the one rule.
  function _vcRecord() {
    const last = Object.create(null);
    let knownFrom = -Infinity, n = 0;
    for (const id of Object.keys(_vc.tiers)) {
      const t = _vc.tiers[id];
      n++;
      const from = (typeof t.coveredFrom === "number") ? t.coveredFrom : Infinity;
      if (from > knownFrom) knownFrom = from;
      for (const u of Object.keys(t.people)) if (!(last[u] >= t.people[u])) last[u] = t.people[u];
    }
    return { chatLast: last, chatKnownFrom: n ? knownFrom : null, chatTierCount: n };
  }
  function presenceView(nowTs) {
    const f = recentlyActive(nowTs);
    let now = nowTs;
    if (typeof now !== "number") { try { now = ServerClock.serverNow(); } catch (e) { now = 0; } }
    let windowMs = 0, chatCounts = false, readMs = 0;
    try {
      const s = StreamManager.getState().settings || {};
      chatCounts = s[ACTIVITY_SOURCES.chat] === true;
      const w = s[api.ACTIVITY_WINDOW_KEY];
      windowMs = (typeof w === "number" && isFinite(w)) ? w : 0;
      // THE READ-BACK REACHES THE BOT'S WINDOW (ruling 30b): the formula every activity read uses, never less than the verdict's.
      const aw = (typeof Capabilities !== "undefined" && Capabilities.activityWindowMs) ? Capabilities.activityWindowMs(s) : 0;
      readMs = Math.max(windowMs, (typeof aw === "number" && isFinite(aw)) ? aw : 0);
    } catch (e) { chatCounts = false; }
    _vcSync(now, readMs);
    const rec = _vcRecord();
    if (!chatCounts) return Object.assign({}, f, { source: "own", chatSeen: false, unknownTiers: [] }, rec);
    const since = now - windowMs, byId = Object.create(null), unknown = [];
    const people = ((f && f.people) || []).map((p) => { const q = Object.assign({}, p); if (q.userId) byId[q.userId] = q; return q; });
    for (const id of Object.keys(_vc.tiers)) {
      const t = _vc.tiers[id];
      if (t.coveredFrom === null || t.coveredFrom > since) unknown.push(t.name);             // "can't fully tell" for this tier
      for (const u of Object.keys(t.people)) {
        const ts = t.people[u];
        if (!(ts >= since && ts <= now)) continue;
        if (byId[u]) { if (!(byId[u].lastTs >= ts)) byId[u].lastTs = ts; }
        else { byId[u] = { userId: u, lastTs: ts, acts: 0, chat: true }; people.push(byId[u]); }
      }
    }
    return Object.assign({}, f, { people: people, unobservable: [], chatSeen: true, unknownTiers: unknown.sort(), source: "own" }, rec);
  }
  function _viewerChatForTest() { return { key: _vc.key, tiers: JSON.parse(JSON.stringify(_vc.tiers)) }; }
  // ── THE PEOPLE TAB'S ORDER (the owner's rulings 30e, 31 and 34; J84-3) ─────────────────────────────────────────────
  // ONE ORDER, decided here and rendered by the UI. The members are the roster's (the Space's joined members, each with
  // its level there); THIS VIEWER'S view (`presenceView` — J75 stands: nothing from the bot's list is added) splits them
  // into the active, on top, and the inactive, below. Within each group: the higher level first, then the higher number —
  // the People tab's REP, handed in by the UI (`numberOf`, read through H3) — with no number after any number, then the
  // name a–z, case folded, the user ID breaking a tie. Someone the view names who is not a member is not listed: this is
  // the member list. With no numbers (no bot in the room, or none held yet) the same order runs on level and name (30f).
  // Pure — a function of its arguments — so `check-people-tab` runs it as it stands.
  function peopleOrder(view, roster, numberOf) {
    const act = Object.create(null), seen = Object.create(null), rows = [];
    for (const p of ((view && Array.isArray(view.people)) ? view.people : [])) if (p && typeof p.userId === "string" && !act[p.userId]) act[p.userId] = p;
    for (const m of (Array.isArray(roster) ? roster : [])) {
      if (!m || typeof m.userId !== "string" || seen[m.userId]) continue;
      seen[m.userId] = true;
      let n = null;
      if (typeof numberOf === "function") { try { const v = numberOf(m.userId); n = (typeof v === "number" && isFinite(v)) ? v : null; } catch (e) { n = null; } }
      rows.push({ member: m, active: act[m.userId] || null, number: n, lv: (typeof m.level === "number") ? m.level : 0,
        nm: String(m.name || m.userId).toLowerCase() });
    }
    rows.sort((a, b) => {
      if (!a.active !== !b.active) return a.active ? -1 : 1;
      if (a.lv !== b.lv) return b.lv - a.lv;
      if ((a.number === null) !== (b.number === null)) return a.number === null ? 1 : -1;
      if (a.number !== b.number) return b.number - a.number;
      if (a.nm !== b.nm) return a.nm < b.nm ? -1 : 1;
      return a.member.userId < b.member.userId ? -1 : (a.member.userId > b.member.userId ? 1 : 0);
    });
    return rows.map((x) => ({ member: x.member, active: x.active, number: x.number }));
  }
  // The live reader. Thin on purpose: the log lives behind the backend interface and the fold above
  // is pure, so this is the only line that has to be right about WHERE the log comes from. It reads
  // `getLog()` on every call rather than caching, because a cached list would go on naming somebody
  // after a trim had removed the evidence for them.
  // THE SOURCES AND THE WINDOW BOTH COME FROM ROOM SETTINGS, read fresh on every call like the log:
  // a cached rule would go on applying a definition the owner has since changed.
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
      sources = { spine: true, chat: s[ACTIVITY_SOURCES.chat] === true };
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
                          ? Capabilities.activityGroupOf : null,
                        (typeof StreamManager.olderActivity === "function") ? StreamManager.olderActivity() : null);
  }

  // ── THE EVENT FEED (J13) ───────────────────────────────────────────────────────────────────
  // A readable running list of what has happened in the room, folded out of the log on every
  // render and holding NO state of its own (P5) — the same shape as `foldActivity` above and for
  // the same reasons, which is why it lives beside it rather than in `ui/` (rule D; §9 entry S).
  //
  // ── WHAT THE JOB ENTRY GOT WRONG, AND IT IS THE DONE-WHEN ──────────────────────────────────
  // The entry asks for "a feed that starts at the floor, not an empty one with no explanation".
  // DRIVEN (J13's probe, R2/R3) — BOTH HALVES OF THAT SENTENCE ARE FALSE:
  //   · A feed can never start AT the floor. `trimToFloor` keeps what is above the cut by
  //     (position, id): the boundary event is already banked into its seed, so keeping it would
  //     double-count. The oldest row a feed can hold is the first event above the boundary.
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
  // ── WHICH KINDS A DEVICE SHOWS BY DEFAULT, DECIDED HERE BESIDE EACH NAME (owner ruling, ddjp_427) ─
  // The feed's rows sit between chat messages, and whether a kind shows is one checkbox per kind in
  // the user settings panel. ON BY DEFAULT: saves, skips and unplayable-song skips — and, the owner's
  // at `ddjp_639`, room settings changes, strikes, removals, resets and moves; every other kind
  // OFF. The default lives in this table because this table is where a kind is named — a second list
  // of defaults anywhere else would be a second copy of the vocabulary to drift. Every row states
  // `shownByDefault` explicitly, and `check-chat-view` PART E fails on a row that does not, so a new
  // kind is decided the day it is added. `ChatPrefs` stores only what a person CHANGED from this.
  const FEED_KINDS = {
    "ddjp.dj.join":       { verb: "joined the DJ queue",        group: "rotation", shownByDefault: false },
    "ddjp.dj.leave":      { verb: "left the DJ queue",          group: "rotation", shownByDefault: false },
    "ddjp.dj.play":       { verb: "started a song",             group: "playback", shownByDefault: false },
    "ddjp.dj.skip":       { verb: "skipped a song",             group: "playback", shownByDefault: true  },
    "ddjp.media.skip":    { verb: "skipped an unplayable song", group: "playback", shownByDefault: true  },
    "ddjp.dj.vote":       { verb: "upvoted the song",           group: "reaction", shownByDefault: false },
    "ddjp.dj.save":       { verb: "saved the song",             group: "reaction", shownByDefault: true  },
    "ddjp.room.settings": { verb: "changed the room settings",  group: "settings", shownByDefault: true  },
    "ddjp.dj.strike":     { verb: "struck a song",              group: "moderation", shownByDefault: true  },
    "ddjp.dj.remove":     { verb: "removed a DJ",               group: "moderation", shownByDefault: true  },
    "ddjp.dj.reset":      { verb: "reset the rotation",         group: "moderation", shownByDefault: true  },
    "ddjp.dj.move":       { verb: "moved a DJ",                 group: "moderation", shownByDefault: true  },
    // NAMED, NOT "REFUSED" (J65). Neither is judged by the room's rules, so the feed used to show each
    // as "sent something — refused: the room didn't record why". Off by default in chat; the Gear
    // Feed tab shows every kind, which is where they help with debugging.
    "ddjp.media.len":     { verb: "reported the song's length", group: "playback", shownByDefault: false },
    "ddjp.bot.here":      { verb: "came online as the room's bot", group: "settings", shownByDefault: false },
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
    // GO-FORWARD, when asked (`since`, ddjp_447): rows and refusals count only STRICTLY AFTER the line.
    // Chat and the Gear Feed tab both ask for it rather than filtering rows themselves, so "after the
    // line" is one rule in one place. The reach (`counted`, `oldestTs`, `newestTs`) is still measured
    // over everything held — it answers how far back this client sees, not what it narrates.
    const since = (typeof o.since === "number" && isFinite(o.since)) ? o.since : null;
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
      if (since !== null && !(ts > since)) continue;
      // REFUSED FIRST, so an event the room rejected is never narrated AS IF IT HAPPENED, whatever
      // its kind. It is counted always; and when the caller asks (`refused`, ddjp_455 — the Gear
      // Feed tab does, chat does not) it is narrated AS REFUSED, with the room's reason from
      // `reasonOf`. A refused event of an unnamed kind is still shown, since the refusal is the news.
      let ok = true;
      try { ok = legal(e.eventId) !== false; } catch (err) { ok = true; }
      // A BOT ROOM'S "NO" (J65) is the refusal of the act it names, attributed to the person, with
      // the runner's reason — narrated exactly as a refused act is in a shared room.
      if (e.type === "ddjp.bot.refused") {
        refused++;
        if (o.refused === true) {
          const c = e.content || {};
          const rk = FEED_KINDS[c.of];
          rows.push({ eventId: e.eventId, type: c.of || e.type, verb: rk ? rk.verb : "sent something",
                      group: rk ? rk.group : null, sender: e.sender || null, ts: ts, l: l, refused: true,
                      reason: { code: "bot-refused", detail: null, text: String(c.reason || "refused") } });
        }
        continue;
      }
      // NOT JUDGED IS NOT REFUSED (J65). The legal set holds only types the reducer handles, so an
      // inert type (a length report, the bot's arrival) reads "not legal" without ever having been
      // judged. Every real refusal carries a reason (`check-refusal-reasons`), so when the caller can
      // ask, "no reason" means "not judged" and the event is narrated by its kind instead.
      if (!ok && typeof o.judgedOf === "function") {
        let judged = true;
        try { judged = !!o.judgedOf(e.eventId); } catch (err) { judged = true; }
        if (!judged) ok = true;
      }
      if (!ok) {
        refused++;
        if (o.refused === true) {
          const rk = FEED_KINDS[e.type];
          let reason = null;
          try { reason = (typeof o.reasonOf === "function") ? o.reasonOf(e.eventId) : null; } catch (err) { reason = null; }
          rows.push({ eventId: e.eventId, type: e.type, verb: rk ? rk.verb : "sent something", group: rk ? rk.group : null,
                      sender: e.sender || null, ts: ts, l: l, refused: true, reason: reason });
        }
        continue;
      }
      const k = FEED_KINDS[e.type];
      if (!k) { unnamed++; continue; }
      rows.push({ eventId: e.eventId, type: e.type, verb: k.verb, group: k.group,
                  sender: e.sender || null, ts: ts, l: l });
    }
    // Newest first by server stamp, ties broken by id (descending), so two events at one stamp
    // have a stable order here rather than whichever the sort happened to leave.
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
    // Refused acts are narrated only when asked for, and then with the room's own reason.
    const reasonOf = (opts && opts.refused === true)
      ? (id) => { try { return StreamManager.refusalOf ? StreamManager.refusalOf(id) : null; } catch (e) { return null; } }
      : null;
    // "Was it judged?" is asked by BOTH readers — chat and the Feed tab — so an inert type is never
    // counted as refused by one and named by the other (J65). Without a reader of reasons, the old
    // behaviour holds: an unreadable answer is never taken as "not judged".
    const judgedOf = (StreamManager && typeof StreamManager.refusalOf === "function")
      ? (id) => { try { return !!StreamManager.refusalOf(id); } catch (e) { return true; } }
      : null;
    return foldFeed(log, legal ? (id) => StreamManager.isLegal(id) : null,
                    Object.assign({}, opts, { roomExists: roomExists, reasonOf: reasonOf, judgedOf: judgedOf }));
  }

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
  function playedWithin(videoId, nowTs, opts) {
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
    // NEVER PAST THE REACH (J73 job 6). Coverage has holes now; only the unbroken stretch back from the
    // newest position may decide. A row below a hole is a real play, but a newer one may sit in the
    // hole, so it can neither block nor clear. Rows without a position cannot be placed and wait too.
    const topFrom = (cov && !complete && typeof cov.topFromL === "number") ? cov.topFromL : null;
    if (topFrom !== null) rows = rows.filter((r) => r && typeof r.l === "number" && r.l >= topFrom);
    let oldestAt = 0;
    for (const r of rows) { if (r && typeof r.at === "number" && r.at > 0) oldestAt = r.at; }
    // When this DJ last added this video, up to the song's start (J73 Q10). The rule that replaced Q10
    // compares add positions through `MatrixBridge.historyAddedAtL`; the app no longer reads this field.
    let addedAt = null;
    if (opts && opts.dj && typeof opts.beforeTs === "number") {
      try { addedAt = Queue.historyAddedAt ? Queue.historyAddedAt(opts.dj, videoId, opts.beforeTs) : null; } catch (e) { addedAt = null; }
    }
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
               waitMs: Math.max(0, allowedAt - now), reach: reach, complete: complete, addedAt: addedAt };
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

  // The authority rule, in one pure place so it can be tested:
  //   - only Staff+ may set anyone's rank
  //   - you can only touch someone strictly below you (outranked or rank-matched -> denied)
  //   - you can only set a rank strictly below your own (no granting at/above yourself)
  // NOTE: this deliberately does not know about channel existence — that's a
  // separate, orthogonal gate (see isRankUnlocked below) so the pure
  // authority rule stays exactly what tests/check-authority.js exercises.
  // The threshold lives in Ranks, reached BY NAME through Capabilities.
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

  // Does every channel this rank belongs in exist yet (the bridge's `rankAssignable`)? A room can't offer or
  // grant a rank it hasn't unlocked — unlocking happens in batches
  // (RoomUpgrade); granting an unlocked rank would leave the assigned user
  // with no events/checkpoints/chat channel to use. The level -> events-channel
  // key comes from the single channel taxonomy in transport (no local copy).
  // A LEVEL IS OFFERED ONLY WHEN EVERY CHANNEL IT BELONGS IN EXISTS (owner, `ddjp_539`) — the bridge's one rule.
  function rankAssignable(level) {
    try { return MatrixBridge.rankAssignable(current && current.spaceId, (current && current.channels) || {}, level); } catch (e) { return { ok: false, missing: [] }; }
  }
  function isRankUnlocked(channels, level) {
    if (!channels) return level === 0;   // Uncategorized always exists conceptually
    if (typeof MatrixBridge.rankAssignable === "function") return MatrixBridge.rankAssignable(current && current.spaceId, channels, level).ok === true;
    const key = MatrixBridge.eventsKeyForLevel(level);
    return key ? !!channels[key] : false;
  }

  // AND THIS IS WHAT ACTUALLY BOUNDS A BOT AT 99. A bot holding owner-tier power cannot grant a
  // rank whose channels do not exist: `assignRank` refuses through `rankAssignable`, which needs
  // every channel the level belongs in (`eventsKeyForLevel` is only the fallback). So a bot running an
  // un-upgraded room fails LOUDLY at the promotion rather than silently at an upgrade it was never
  // going to attempt — the limit is narrower than "the bot cannot upgrade the room" and it is
  // already enforced here. Upgrades stay human-only for a separate reason; see `roomupgrade.js`.

  // The ladder, re-exported for ui/. `ui/` may not reach `Capabilities` directly
  // (check-boundaries rule, and check-ui-no-permission) — it must come through a feature
  // module. Levels are the ladder's; display strings are the UI's business and are NOT here.
  // `label` rides along with `name` and `level` (J36). `ui/` may not reach `Capabilities`, so this
  // is the ONLY route by which the UI can read a rank's written form — and without it the UI has
  // to keep its own copy of the strings, which is what it was doing and what disagreed with
  // `capabilities.js` about "VIP".
  function rankLadder() { return Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level, label: r.label })); }

  // The highest rank level whose channels exist, for display purposes (e.g.
  // "all ranks unlocked" UI text). NOT used to gate individual grants — use
  // isRankUnlocked for that, since Owner's channel existing from creation
  // doesn't imply the batch ladder in between has caught up.
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
  // MEASURED, not assumed: across every verb and target shape, exactly five answers differ between
  // 99 and 100 — `rank.assign`, `member.kick`, `member.ban` and `chat.redact` against a target at the
  // top rung, and `bot.command` (above it). `check-authority-level` derives that set rather than listing it.
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

  // Promote/demote. Denies if the room hasn't unlocked the requested rank's channels yet, reads the
  // actor's and target's true authority across all channels, denies if the actor doesn't strictly
  // outrank both the target and the new level, then sets the target's power across every room.
  async function assignRank(userId, level) {
    { const g = rankAssignable(level); if (!g.ok) { Logger.warn("Room: level " + level + " cannot be assigned yet — upgrade the room first"); return { ok: false, reason: "upgrade-first", missing: g.missing }; } }
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
  // harmlessly, so a guard around it could only ever be wrong. Both callers reach here with
  // `current` set — `_initModules` runs right after the switch sets it, and `_rewireWriteChannel`
  // returns early without it, which since J83 includes the lobby (the leave clears `current`, and
  // stops the runtime itself, first). So the early-return below cannot currently fire. Kept
  // defensive, described as defensive.
  // ── THE BOT, THEN REP (H1, J84-2) ─────────────────────────────────────────────────────────────────────────────────
  // REP is told on room entry and on every rank change, after the runtime has said whether this tab is the room's bot, at
  // this ONE site (`check-rep-boundary` D lists it): its reader runs on every tab (J84-3), its bot side on the bot's alone.
  function _evaluateBot() {
    _evaluateBotRuntime();
    if (typeof Rep === "undefined" || typeof Rep.enter !== "function") return;
    try { Rep.enter({ spaceId: current && current.spaceId, channels: current && current.channels }); }
    catch (e) { Logger.warn("Room: REP could not be told the room changed — " + ((e && e.message) || e)); }
  }
  function _evaluateBotRuntime() {
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
        // ON ROOM ENTRY THE BOT STARTS BEFORE THE REPLAY (J115): it hears live requests from the start, and reads join
        // times only once `_startModules` says the history is in (`BotRuntime.reseed`). A restart on a rank change, after
        // the replay, seeds at once.
        replayPending: !_replayed,
        // The bot authors settings through the SAME writer the panel uses. Not a second write
        // path: `setSettings` merges onto the current blob and posts the full thing, which is the
        // only shape last-write-wins tolerates. A bot with its own writer would be the second
        // copy that eventually posts a partial blob and silently drops every key it forgot.
        //
        // WRAPPED, BECAUSE THE TWO CALLERS NEED DIFFERENT THINGS FROM A FAILURE (v322 audit).
        // `setSettings` is total and does not throw — the panel wants that, and reads `{ok:false}`
        // as a failed save. `authorIfPermitted` reads "did not throw" as "wrote", so handing it the bare
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
    // ── `too-low` IS SILENT FOR A MEMBER AND SHOULD NOT BE FOR AN OWNER ──────────────────────
    // Every ordinary member entering a room is `too-low`, so printing it would be noise on every
    // join — which is why it is excluded above, correctly. But an OWNER is the one person who
    // expects a bot, and for them the same silence means a bot that did not start and said
    // nothing. COST MEASURED IN A LIVE SESSION: the absence of any `BotRuntime:` line was read as
    // "the bot never started", and the wrong thing was investigated for several exchanges before
    // `status()` showed it running all along.
    //
    // Owner only, so the noise stays where it was.
    else if (r && r.reason === "too-low") {
      let mine = -1;
      try { mine = MatrixBridge.getMyRank(current.channels); } catch (e) { mine = -1; }
      if (mine >= 99) {
        Logger.info("Room: bot mode off (too-low) — this account is the owner here but its POWER "
          + "LEVEL in the space is below what the bot needs. Rank in the room and power level in "
          + "the space are different things; the bot reads the second");
      }
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

  // ── THE RUNNING ROOM, READ THROUGH ONE FUNCTION (J81; the owner's rulings 8b, 14 and 18) ─────────────────────────────
  // The room this tab is IN: `current`, set by the opening (`_enter`) immediately before `_initModules`, and cleared by the
  // ONE leave step (`leave`, J83) on every way out — so in the lobby it answers none, and nothing of a room runs there. One
  // room at a time: opening a room leaves the running one first. NOTHING ELSE DECIDES "RUNNING" ANOTHER WAY: the bridge
  // reports listings, joins and rank changes for any room and this answers which one they apply to.
  // `check-runner-room-change` holds it to the runner's switch, `check-room-leave` to the leave.
  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }

  // ── THE ONE JOIN STEP, FOR THE ROOM THAT RUNS HERE AND NO OTHER (J81) ─────────────────────────────────────────────────
  // `MatrixBridge.joinRoomChannels` does the joining, with retries and one log line; this decides WHICH room, and only the
  // running one (ruling 14: nothing of one room is joined for another). An invite for a room that is not running waits,
  // and the lobby shows it under that room; opening the room accepts it. Triggers: an invite or membership change, a rank
  // that settled (the bridge debounces), the running room listing a new channel, and the room's own opening.
  // `o.ifWouldJoin` (J84-1): this trigger only checks for work, so the bridge skips the pass, with no line, when it would
  // join nothing — a room-list change and the "the room is open" catch-up (`joinRoomChannels` says why only these two).
  function _runJoinStep(why, o) {
    const sid = runningRoom();
    if (!sid || typeof MatrixBridge.joinRoomChannels !== "function") return null;
    try { return MatrixBridge.joinRoomChannels(sid, why, { wanted: () => runningRoom() === sid, ifWouldJoin: !!(o && o.ifWouldJoin) }); }
    catch (e) { Logger.warn("Room: the join step could not start — " + ((e && e.message) || e)); return null; }
  }
  // A BURST OF ROOM-LIST CHANGES ASKS FOR ONE PASS (J84-1; the owner's quick live check at `?v=528`: six passes in five
  // seconds right after opening, each "an invite or membership changed", nothing joined). Opening a room fires many
  // room-list changes, and each one ran a pass. Now the first change of a burst arms ONE request, one turn of the event
  // loop plus JOIN_COALESCE_MS later, and the changes inside that time join it. It is made for the room that runs here when
  // it fires, and goes with `ifWouldJoin`. The leave cancels it with the room.
  const JOIN_COALESCE_MS = 250;
  let _joinLater = (fn, ms) => setTimeout(fn, ms);
  let _joinSoonTimer = null;
  function _joinSoon(why) {
    if (_joinSoonTimer) return;
    _joinSoonTimer = _joinLater(() => { _joinSoonTimer = null; _runJoinStep(why, { ifWouldJoin: true }); }, JOIN_COALESCE_MS);
  }
  function _joinSoonCancel() { if (_joinSoonTimer) { try { clearTimeout(_joinSoonTimer); } catch (e) {} _joinSoonTimer = null; } }

  // ── EVERY INVITE'S VERDICT, LOGGED ONCE AND AGAIN WHEN IT CHANGES (J81; ruling 15: never silent) ──────────────────────
  // The classifier stays free of "running", which only this file knows; so the line is written here, with the running
  // room's part of the answer ("waits: … is not running on this tab"). Once per invite per session, and again when its
  // verdict changes — so a channel invite that waits says so, and says so again when its room opens and takes it.
  const _inviteLogged = Object.create(null);
  function _short(id) { return (typeof id === "string" && id.length > 12) ? id.slice(0, 10) + "…" : String(id); }
  function inviteVerdictText(v, running) {
    if (!v) return "";
    const cr = v.create;
    const pre = "invite " + _short(v.roomId) + " from " + (v.from || "?") + " — " + (cr
      ? "create{type:" + (cr.type || "-") + ", ddjp_mode:" + (cr.ddjp_mode || "-") + ", ddjp_room:" + (cr.ddjp_room ? _short(cr.ddjp_room) : "-") +
        ", ddjp_kind:" + (cr.ddjp_kind || "-") + ", sender:" + (cr.sender || "-") + "}"
      : "no creation record") +
      "; name " + JSON.stringify(v.name || "") + "; members shown join=" + v.people.joined + " invite=" + v.people.invited +
      "; is_direct=" + !!v.direct + " → ";
    if (v.verdict === "room") return pre + "ROOM (the lobby's room invitations)";
    if (v.verdict === "unreadable") return pre + "UNREADABLE — " + v.why + " (never accepted, never a DM)";
    if (v.verdict === "other") {
      const s = v.summary;
      return pre + "NOT DDJP (DM panel; " + (v.warn === "group" ? "warn: more people than the two of you" : v.warn === "two" ? "just the two of you" : "warn: can't see who else is in it") +
        "; summary: " + (s ? (s.state === "ok" ? s.joined + " joined" : s.state) : "not asked") + ")";
    }
    if (v.verified) return pre + "CHANNEL " + v.kind + " of " + _short(v.room) + " (verified) — " +
      (running === v.room ? "taken by the join step" : "waits: " + _short(v.room) + " is not running on this tab");
    if (v.waitsUnder) return pre + "CHANNEL " + v.kind + " of " + _short(v.room) + " — waits under its room's invitation (joined when you open the room)";
    return pre + "CHANNEL not confirmed: " + v.why + " (never accepted, never a DM; Decline in the lobby)";
  }
  function _logInviteVerdicts() {
    if (typeof MatrixAccount === "undefined" || !MatrixAccount.invites) return;
    const running = runningRoom();
    const seen = Object.create(null);
    for (const v of (MatrixAccount.invites() || [])) {
      seen[v.roomId] = 1;
      const t = inviteVerdictText(v, running);
      if (_inviteLogged[v.roomId] === t) continue;
      _inviteLogged[v.roomId] = t;
      Logger.info("Room: " + t);
    }
    for (const id in _inviteLogged) if (!seen[id]) delete _inviteLogged[id];   // answered: a new invite to it is logged afresh
  }
  function _onRoomsChangedInvites() {
    // REMOVED ELSEWHERE (J83, the owner's E7): kicked, banned, or left from another app — the running room leaves itself and
    // says why, rather than running on with every send refused.
    if (_removedFromRunningRoom()) leave("you are no longer in this room", { removed: true });
    try { _logInviteVerdicts(); } catch (e) { Logger.warn("Room: could not read the pending invites — " + ((e && e.message) || e)); }
    _joinSoon("an invite or membership changed");
  }
  function _removedFromRunningRoom() {
    const sid = runningRoom();
    if (!sid) return false;
    try {
      const c = MatrixBridge.getClient ? MatrixBridge.getClient() : null;
      if (!c || typeof c.getRoom !== "function") return false;
      const r = c.getRoom(sid);
      if (!r) return true;   // the client no longer holds the room at all (left and forgotten)
      const m = (typeof r.getMyMembership === "function") ? r.getMyMembership() : null;
      return m === "leave" || m === "ban";
    } catch (e) { return false; }
  }

  // A room id -> this room's key for it: the map first, then the channel's MARK (D2: names are display only). Null when
  // neither answers, or when the mark names ANOTHER room — that channel is not this room's, whatever it is called.
  function _channelKeyFor(roomId) {
    if (current && current.channels) {
      for (const k in current.channels) if (current.channels[k] === roomId) return k;
    }
    let m = null;
    try { m = MatrixBridge.channelMarkOf ? MatrixBridge.channelMarkOf(roomId) : null; } catch (e) { m = null; }
    return (m && current && m.room === current.spaceId && m.kind) ? m.kind : null;
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
  // somebody is added to the presence chat, which the bot does on its sweep tick. Spine-shaped
  // keys still take that route, because a channel carrying protocol events has to be replayed.
  //
  // ONLY INTO ITS OWN ROOM (J81; ruling 14). The join step announces every channel it joins, and an opening's pass for room
  // B can still be running while room A runs; a channel whose mark does not name the running room is never mapped into it.
  function _adoptJoinedChannel(roomId) {
    if (!current || !current.channels || !roomId) return;
    if (Object.values(current.channels).indexOf(roomId) >= 0) return;   // already mapped
    const key = _channelKeyFor(roomId);
    if (!key) {
      // NOT READABLE YET IS NOT "NOT OURS" (`ddjp_621`): a channel joined before its state synced has no readable mark, and the
      // bridge announces it again once it has one; the line says which of the two this is.
      let unread = false;
      try { unread = !(MatrixBridge.channelMarkOf && MatrixBridge.channelMarkOf(roomId)); } catch (e) { unread = false; }
      Logger.debug("Room: joined " + roomId + (unread ? ", whose mark is not readable yet (its state has not synced) — mapped when it is"
        : ", which is not a channel of the room running here (its mark names another room) — not mapped"));
      return;
    }
    let isChatShaped = key.indexOf("chat_") === 0;
    try {
      isChatShaped = isChatShaped
        || (typeof MatrixBridge.presenceChatKey === "function" && key === MatrixBridge.presenceChatKey());
    } catch (e) { /* leave the prefix answer */ }
    const add = {}; add[key] = roomId;
    if (!isChatShaped) { mergeChannels(add, current.spaceId); Logger.info("Room: joined channel " + key + " — mapped and replayed"); return; }
    Object.assign(current.channels, add);
    // AND INTO THE ROOM'S SCOPE (J85): the scope was taken at the opening, and the read-backs page only the running room's
    // channels — without this a chat tier gained here would never be read back (the People tab's record of it).
    try { if (typeof MatrixBridge.addToRoomScope === "function") MatrixBridge.addToRoomScope(roomId); } catch (e) {}
    Store.config.saveRoom({ name: current.name, spaceId: current.spaceId, channels: current.channels });
    // A ROOM WIRED WITH NO CHAT GETS ITS CHAT NOW (`ddjp_621`; found in the owner's check 8): `Chat.init` — the subscription to
    // the room's messages — ran only at wiring, so a chat mapped later only re-pointed the tiers, and nothing was received.
    // The same choice of channel as the wiring makes (`_initModules`).
    if (!_chatWired) {
      const cc = current.channels.chat_uncategorized || current.channels.chat_guest || roomId;
      try { Chat.init(cc); _chatWired = true; Logger.info("Room: chat wired — " + key + " was joined after the room opened"); }
      catch (e) { Logger.warn("Room: " + key + " is mapped but chat could not be wired — " + ((e && e.message) || e)); }
    }
    try { applyChatTiers(); }
    catch (e) { Logger.warn("Room: " + key + " is mapped but the tier strip was not re-resolved — "
      + ((e && e.message) || e)); }
    for (const fn of _chatTiersListeners.slice()) { try { fn(); } catch (e) {} }
    Logger.info("Room: " + key + " is mapped and readable — it is offered as a chat tier now");
  }

  // Wired once and kept (like _wireRankChange): each handler asks `runningRoom()` itself, so a stale fire after a room
  // switch acts on the room that runs now, or on nothing.
  function _wireChannelAdded() {
    if (_channelWired) return;
    MatrixBridge.onChannelJoined(_onChannelJoined);
    MatrixBridge.onChildListed(_onChildListed);
    MatrixBridge.onRankSettled(_onRankSettled);
    // THE MEMBERSHIP TRIGGER TOO, NOT ONLY WHEN THE LOBBY HAS DRAWN (J81). It was wired only by the room list's first render;
    // a room opened before that (by Space ID, or a future reopen after a reload) would have heard no invite arrive.
    _wireRoomsChanged();
    _channelWired = true;
  }
  function _onChannelJoined(roomId) { try { _adoptJoinedChannel(roomId); } catch (e) { Logger.warn("Room: joined " + roomId + " but could not map it — " + ((e && e.message) || e)); } }
  function _onChildListed(spaceId) { if (spaceId && spaceId === runningRoom()) _runJoinStep("the room listed a new channel"); }
  function _onRankSettled(why) { _runJoinStep(why || "this account's rank changed"); }

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
    // reached from here, from a view switch, from a newly joined chat channel and from room entry.
    // Before J12 this line chose the channel inline and was the only caller; a second caller with
    // its own copy of that expression is exactly the P7 collision (roadmap §3), so there is one
    // expression with four callers.
    applyChatTiers();
    for (const fn of _settingsListeners) { try { fn(s); } catch (e) {} }
    // A window may have grown: the transport reads activity further back where it no longer covers it
    // (J73 job 4). Generic — the engine decides whether there is a read to extend.
    try { if (typeof MatrixBridge !== "undefined" && MatrixBridge.extendActivityRead) MatrixBridge.extendActivityRead(); } catch (e) {}
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
    // precisely what `highestUnlockedRank`'s comment warns about ("Owner's channel existing from
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
    // ITS CHAT IS SEPARATE, WHICH NEEDS NO CODE HERE. The panel files every message by the channel it
    // ARRIVED on (`ui/chat.js` §CHAT — one buffer per channel id), so a tier in this list gets its own
    // buffer by construction — merging it into the persistent chat would have been the extra work,
    // not keeping it apart.
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
    // feature layer, which already read every tier's level from `channelTaxonomy()`
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
    // questions. The bot is the caller — its warnings, thank-yous and removal and repeat
    // announcements must reach the room's main chat rather than whichever tab the client last had open.
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

  // Owner only. Merge a partial change over the current settings, post the FULL
  // blob (last-write-wins truth everyone derives), and — for visibility — also
  // perform the actual space join-rule change (only the owner can/should).
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
  // it reads `{ok:false}` as a failed save. The bot's wrapper in `_evaluateBotRuntime` is what
  // turns a false into a throw, because only the bot needs a throw.
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
  // ONLY INTO THE ROOM THEY BELONG TO (J86): `spaceId` names it, and a merge for a room that is not the one running is
  // refused. An upgrade's batch is slow (many creates, rate-limit waits); a room left and another opened while it ran would
  // otherwise take the old room's channels into the new one's map — and, with the scope below, its events.
  // INTO THE ROOM'S SCOPE BEFORE THE REPLAY (J86, the owner's call on J85's finding): `setRoomScope` took the map the
  // opening built, so a channel joined after it — an upgrade's new channel, or an open channel whose join landed late —
  // was refused at the ingest door, its replay and its live events alike, until the room was reopened. Each new channel
  // is added first, so the scope is what the next opening would give and its replay folds.
  function mergeChannels(newChannels, spaceId) {
    if (!current || !newChannels) return;
    if (spaceId !== current.spaceId) {
      Logger.warn("Room: " + Object.keys(newChannels).length + " channel(s) of " + spaceId + " not merged — the room running " +
        "here is " + current.spaceId);
      return;
    }
    Object.assign(current.channels, newChannels);
    for (const key in newChannels) {
      try { if (newChannels[key] && typeof MatrixBridge.addToRoomScope === "function") MatrixBridge.addToRoomScope(newChannels[key]); } catch (e) {}
    }
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
    // THE CHANNELS CHANGED, so the writers are rewired IN FULL — as on entering a room (ddjp_473). The skip
    // keys on my write channel and rank, and an upgrade can add a channel (a new checkpoints channel,
    // where backups now belong) without changing either.
    _wiredFor = null;
    _rewireWriteChannel();
  }

  // ── WHAT ROOM TYPES THIS BUILD CAN MAKE ─────────────────────────────────────────────────────
  // The engines that are REGISTERED AND READY, each describing itself. No name for an engine — id
  // or label — lives above the seam: `ui/` may not name the registry at all (`check-boundaries`
  // rule D), and `check-backends` PART E forbids a concrete mode id anywhere above it.
  //
  // WITH ONE READY ENGINE THIS RETURNS ONE ENTRY AND THE PICKER IS NOT DRAWN, so the create screen
  // is unchanged until a second engine is actually finished — and the control appears exactly when
  // there is a choice to make, rather than being a dropdown with one option for a release or two.
  function availableTypes() {
    if (typeof Backends === "undefined" || !Backends.modes) return [];
    return Backends.modes()
      .filter((m) => Backends.isReady(m))
      .map((m) => Backends.describe(m))
      .filter(Boolean);
  }

  // `modeId` optional — omitted means the engine this client is running, which is what every
  // existing caller gets. Named, it builds the room from THAT engine's channel plan and stamps its
  // marker, WITHOUT binding it: binding before the room exists would leave the lobby holding an
  // engine with nothing in it if creation then failed (`bot-backend.md` §10b).
  async function create(name, modeId) {
    const _createMode = modeId ||
      ((typeof Backends !== "undefined" && Backends.active) ? Backends.active() : null);
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
        result = await MatrixBridge.createDDJPSpace(name, resuming, _createMode);
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
      // Bind the mode the room was CREATED AS, which `createDDJPSpace` just stamped into its
      // create record — not whatever happened to be active. Those are the same thing today and
      // stop being the same the moment a second engine can be chosen. Entered through the same
      // switch an opening uses (J83): the running room, if any, is left first.
      _enter({ name, spaceId, channels }, _createMode);
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
      // object, the same value setSettings would have merged to (asserted in check-genesis-settings).
      // A NEW ROOM'S SETTINGS, NOT THE DEFAULTS VERBATIM (the owner, `ddjp_639`: new rooms only): the reducer's defaults
      // with the owner's values written over them (`newRoomSettings`), so the room carries them from its first event.
      // The built-in defaults are unchanged, so no room made before moves.
      try {
        const ch = current.channels.settings_owner;
        if (!ch) throw new Error("no settings-owner channel");
        await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: StreamManager.newRoomSettings() });
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

  // The room being OPENED right now, between the space join and the switch: its opening pass may join its channels while
  // the previous room still runs (and only its own channels — the pass's `wanted` asks this or `runningRoom()`). Cleared by
  // `cancelOpening` (J83, E8), which the opening checks after every wait: a cancelled opening opens nothing.
  let _opening = null;
  async function join(spaceId) {
    _wiredFor = null;   // a room entered is wired afresh (ddjp_472)
    Logger.info("Room: joining " + spaceId);
    _opening = spaceId;
    try {
      return await _openRoom(spaceId);
    } finally { if (_opening === spaceId) _opening = null; }
  }
  function _stillOpening(spaceId) {
    if (_opening === spaceId) return;
    const e = new Error("the opening of " + spaceId + " was cancelled");
    e.cancelled = true;
    throw e;
  }
  async function _openRoom(spaceId) {
    // THE ROOM ITSELF FIRST (J81): joined if this is the first opening, and its channel list read. Nothing else is joined
    // until the engine check below has passed, so a room this build cannot serve leaves nothing behind but its space.
    await MatrixBridge.joinSpace(spaceId);
    _stillOpening(spaceId);

    const space = MatrixBridge.getClient().getRoom(spaceId);
    const name = space ? space.name : spaceId;

    // ── WHICH ENGINE DOES THIS ROOM RUN? (J23) ───────────────────────────────────────────────
    // Resolved HERE, before a single thing is reset. `_enter` runs `leave()`, which clears the
    // previous room (`BEHAVIOUR.md` §Entering and leaving a room). Refusing after the clear would
    // leave the tab in no room for a room we never entered, so every reason to refuse is checked first.
    //
    // REFUSED BY NAME, in words, never as a later failure that reads like corruption. This is
    // the `checkpointformat.js` pattern: a room this build cannot serve is TOLD it cannot be
    // served. An unmarked room is a room created before the marker existed — those are not
    // supported and there is deliberately no fall-back that guesses backend1 for them.
    const _mode = Backends.resolveMode(MatrixBridge.getCreateContent(spaceId));
    if (!_mode) {
      throw new Error("This room was made before rooms declared their engine, so this build " +
        "cannot open it. It needs to be created again.");
    }
    if (!Backends.has(_mode)) {
      throw new Error("This room runs an engine this build does not have (\"" + _mode + "\").");
    }
    if (!Backends.isReady(_mode)) {
      throw new Error("This room runs \"" + _mode + "\", which is registered but not finished " +
        "in this build, so it cannot be opened yet.");
    }

    // ── THE ONE JOIN STEP, AS PART OF THE OPENING (J81; ruling 8b) ──────────────────────────────────────────────────────
    // Open channels joined, invited ones verified and joined, the rest wait — one log line. Not awaited: an opening never
    // waits for retries (`ddjp_539`). It waits, as before, only until the children have synced in, capped so it cannot hang
    // (a channel that waits counts as answered); a channel joined later is announced and mapped then.
    _wireChannelAdded();   // BEFORE the pass: a channel it joins after the map is built is announced and mapped, never lost
    MatrixBridge.joinRoomChannels(spaceId, "opening", { opening: true, wanted: () => _opening === spaceId || runningRoom() === spaceId });
    await MatrixBridge.waitForSpaceChildren(spaceId, { needJoined: true });
    _stillOpening(spaceId);

    // ── THE CHANNEL MAP, BY MARK (J81, D2), AND THE OLD-ROOM REFUSAL (ruling 7) ─────────────────────────────────────────
    // Each listed channel this account has JOINED, keyed by the kind its mark declares — names are display only. A joined
    // channel the room lists whose mark is missing, names another room, or names a kind this engine does not have refuses
    // the room BY NAME, before anything of the previous room is reset: there is no path for an unmarked channel.
    const plan = (typeof Backends !== "undefined" && Backends.planFor) ? (Backends.planFor(_mode) || []) : [];
    const channels = {};
    for (const roomId of (MatrixBridge.spaceChildIds(spaceId) || [])) {
      const room = MatrixBridge.getClient().getRoom(roomId);
      if (!room || !room.getMyMembership || room.getMyMembership() !== "join") continue;
      const m = MatrixBridge.channelMarkOf(roomId);
      if (!m || !m.room || !m.kind) {
        throw new Error("This room was made before its channels carried their room's mark, so this build cannot open it. " +
          "It needs to be created again.");
      }
      if (m.room !== spaceId) {
        throw new Error("A channel this room lists belongs to another room (its mark names " + m.room + "), so this build " +
          "will not open it.");
      }
      if (!plan.some((c) => c && c.key === m.kind)) {
        throw new Error("A channel this room lists is a kind this build does not have (\"" + m.kind + "\"), so it cannot open " +
          "it. It needs to be created again.");
      }
      if (!channels[m.kind]) channels[m.kind] = roomId;
    }

    _enter({ name, spaceId, channels }, _mode);

    // Replay every existing events-[rank] channel — full ordered log across ranks.
    // AWAIT it: history must be fully in StreamManager before we go live, or the
    // playback tick loop fires against pre-replay state (the documented cold-start
    // guarantee). The waitForSpaceChildren above waited for every channel room to sync in
    // (a channel that waits counts as answered; capped at 8 s), so we go straight to replay
    // (replayRoom pages each channel back itself: to its start, or in a bot room to the save point it opens from); no fixed
    // pre-replay sleep is needed.
    await _replayAllChannels(channels);
    // CANCELLED OR SUPERSEDED DURING THE REPLAY (J83): the leave has already stopped what was wired; nothing starts.
    if (!current || current.spaceId !== spaceId) {
      const e = new Error("the opening of " + spaceId + " was cancelled");
      e.cancelled = true;
      throw e;
    }

    // Only now, with history fully replayed into StreamManager, go live —
    // this starts Playback's tick loop, so it never ticks against empty state.
    _startModules();

    return current;
  }

  // ── ENTERING: ONE ROOM AT A TIME (J83, the owner's ruling 18) ───────────────────────────────────────────────────────
  // The switch both openings make (`_openRoom`, `create`): the running room is LEFT first — the one leave step — so the tab is
  // in one room or none; then this room becomes the running one, the tab remembers it (E2), and its modules are wired.
  function _enter(room, modeId) {
    leave("opening another room");
    _wiredFor = null;
    _replayed = false;
    current = { name: room.name, spaceId: room.spaceId, channels: room.channels };
    _rememberRoom(current.spaceId);
    try { Store.config.saveRoom({ name: current.name, spaceId: current.spaceId, channels: current.channels }); } catch (e) {}
    _initModules(current, modeId);
    _wireRankChange();
    _wireChannelAdded();
  }

  // ── LEAVING A ROOM: THE ONE LEAVE STEP (J83, the owner's ruling 18) ─────────────────────────────────────────────────
  // A room's processes run only while the tab is IN it. This stops all of them, in the reverse of the order the entry started
  // them, and every way out calls it — both back buttons, logging out, switching account, the reloads (the secure-chat
  // reconnect, the bot's daily one, the page closing), being removed elsewhere, a cancelled opening, and opening another room.
  // The lobby keeps only what is the lobby's and the account's: sync, the room list, invites and DMs. Nothing is sent for the
  // person (E4): their own queue stays on disk and in the room, and the room's rules handle their absence. Does nothing when
  // no room runs. `opts.reloading` keeps the tab's memory of the room, so the reload opens it again (E1, E5, E6).
  const _leftListeners = [];
  function onLeft(fn) { if (typeof fn === "function" && !_leftListeners.includes(fn)) _leftListeners.push(fn); }
  function leave(why, opts) {
    const o = opts || {};
    const c = current;
    if (!c) return { ok: true, left: null };
    const name = c.name || c.spaceId, reason = why || "asked to leave";
    Logger.info("Room: leaving " + name + " (" + reason + ") — stopping its processes");
    // 1. THE BOT FIRST, WITH THE ROOM'S ENGINE STILL BOUND. Its raw listener comes off through the binding it went on (a
    //    bot room's transport wraps it), and the engine reset stops the runner, whose closing flush sends what the gate had
    //    promised to its own room at its own positions (J80).
    let rs = null;
    try { if (typeof BotRuntime !== "undefined" && BotRuntime.stop) BotRuntime.stop("the tab left the room"); } catch (e) {}
    // REP beside the bot (H2, J84-2): its table saved, nothing sent, its listeners, timers and writer lock let go.
    try { if (typeof Rep !== "undefined" && Rep.leave) Rep.leave("the tab left the room (" + reason + ")"); } catch (e) {}
    try { rs = StreamManager.reset("the tab left the room (" + reason + ")"); }
    catch (e) { Logger.warn("Room: the engine did not reset cleanly — " + ((e && e.message) || e)); }
    // 2. THE ROOM'S MODULES, each through its own stop.
    const stops = [
      ["Playback", () => { if (typeof Playback !== "undefined") { Playback.stop(); Playback.destroy(); } }],
      ["Queue", () => { if (typeof Queue !== "undefined" && Queue.destroy) Queue.destroy(); }],
      ["Skip", () => { if (typeof Skip !== "undefined" && Skip.destroy) Skip.destroy(); }],
      ["Reactions", () => { if (typeof Reactions !== "undefined" && Reactions.destroy) Reactions.destroy(); }],
      ["MediaLength", () => { if (typeof MediaLength !== "undefined" && MediaLength.destroy) MediaLength.destroy(); }],
      ["MediaBlocked", () => { if (typeof MediaBlocked !== "undefined" && MediaBlocked.destroy) MediaBlocked.destroy(); }],
      ["UserQueue", () => { if (typeof UserQueue !== "undefined" && UserQueue.destroy) UserQueue.destroy(); }],
      ["RoomUpgrade", () => { if (typeof RoomUpgrade !== "undefined" && RoomUpgrade.destroy) RoomUpgrade.destroy(); }],
      ["Chat", () => { _chatWired = false; if (typeof Chat !== "undefined" && Chat.destroy) Chat.destroy(); }],   // room chat only; DMs are the account's
    ];
    for (const [n, fn] of stops) {
      try { fn(); } catch (e) { Logger.warn("Room: " + n + " did not stop cleanly — " + ((e && e.message) || e)); }
    }
    _vc.gen++; _vc.key = null; _vc.tiers = Object.create(null);   // who-is-here: a read-back in flight lands nowhere
    // 3. THE ENGINE AND THE TRANSPORT: the clock's offset, the reliability modules (the pending history save lands under
    //    this room first) and the scope, then the transport's own half — timers, answers, the backfill, the phase.
    let tr = null;
    try { if (typeof ServerClock !== "undefined" && ServerClock.destroy) ServerClock.destroy(); } catch (e) {}
    try { if (typeof MatrixBridge.resetCheckpoints === "function") MatrixBridge.resetCheckpoints(); } catch (e) {}
    try { if (typeof MatrixBridge.leaveRoom === "function") tr = MatrixBridge.leaveRoom(); } catch (e) {}
    // 4. NO ROOM RUNS: the join step's `wanted()` turns false, invites wait, and the lobby's engine is bound.
    current = null;
    _wiredFor = null;
    _hasEventsChannel = false;
    _joinSoonCancel();   // a room-list change's pending join request goes with the room (J84-1)
    if (!o.reloading) _forgetRoom();
    try { if (typeof Backends !== "undefined" && Backends.bindBootstrap) Backends.bindBootstrap(); } catch (e) {}
    const runner = rs && rs.runner;
    const sent = (runner && runner.sent) || 0, dropped = (runner && runner.dropped) || 0;
    Logger.info("Room: left " + name + " — nothing of it runs on this tab (the bot: " + sent + " promised act(s) sent, " +
      dropped + " held intent(s) dropped)");
    const info = { ok: true, left: c.spaceId, name: name, why: reason, sent: sent, dropped: dropped,
      answers: (tr && tr.answers) || 0, reloading: !!o.reloading, removed: !!o.removed };
    for (const fn of _leftListeners.slice()) { try { fn(info); } catch (e) {} }
    return info;
  }
  // BACK ON THE LOADING CARD (J83, E8): the opening stops at its next step and opens nothing; if it had already switched, the
  // room it switched to is left.
  function cancelOpening(why) {
    const sid = _opening;
    if (!sid) return { ok: true, cancelled: null };
    _opening = null;
    Logger.info("Room: the opening of " + sid + " was cancelled (" + (why || "asked") + ") — nothing of it runs");
    if (current && current.spaceId === sid) leave(why || "the opening was cancelled");
    return { ok: true, cancelled: sid };
  }

  // ── THE TAB REMEMBERS ITS ROOM (J83, the owner's E1 and E2) ───────────────────────────────────────────────────────────
  // Per tab (`sessionStorage`, which a reload keeps and a closed tab forgets) and per account (the key names it, so another
  // account's room is never read). Written at the switch, cleared by the leave unless the leave is for a reload. After a
  // reload the boot path opens it again (`reopen`).
  function _tabKey() { let u = null; try { u = MatrixBridge.getUserId ? MatrixBridge.getUserId() : null; } catch (e) { u = null; } return u ? "ddjp_room:" + u : null; }
  function _tabStore() { try { return (typeof sessionStorage !== "undefined") ? sessionStorage : null; } catch (e) { return null; } }
  function _rememberRoom(spaceId) { const k = _tabKey(), st = _tabStore(); if (!k || !st || !spaceId) return; try { st.setItem(k, spaceId); } catch (e) {} }
  function _forgetRoom() { const k = _tabKey(), st = _tabStore(); if (!k || !st) return; try { st.removeItem(k); } catch (e) {} }
  function rememberedRoom() { const k = _tabKey(), st = _tabStore(); if (!k || !st) return null; try { return st.getItem(k) || null; } catch (e) { return null; } }
  async function reopen(spaceId) {
    const sid = spaceId || rememberedRoom();
    if (!sid) return null;
    Logger.info("Room: reopening " + sid + " after a reload — this tab was in it");
    try { return await join(sid); }
    catch (e) {
      if (e && e.cancelled) throw e;
      Logger.info("Room: reopen refused — " + ((e && e.message) || e) + "; the lobby");
      _forgetRoom();
      throw e;
    }
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
    // derived room settings (ddjp.room.settings) are reconstructed, and the
    // checkpoints_* channels (below).
    //
    // AWAIT every replay before returning. replayRoom is async — it pages each
    // channel back to its start (in a bot room, to the save point it opens from)
    // before ingesting — so firing these without
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
    // ── OPEN FROM THE BOT'S SAVE POINT, ONCE EVERY CHANNEL IS IN (J67) ───────────────────────
    // An engine that can open from a save point does so here, from the newest usable one; who was
    // active before it is read back in the background. Detected, not branched on: a shared room's
    // engine has no such method and nothing happens.
    try {
      if (typeof StreamManager !== "undefined" && typeof StreamManager.openFromSavePoint === "function") {
        const r = StreamManager.openFromSavePoint();
        if (r && r.ok) {
          Logger.info("Room: opened from the bot's save point — dropped " + r.dropped + " covered event(s) below l=" + r.floorL);
        } else if (r && r.stopped) {
          Logger.warn("Room: the download stopped at a save point but none could be opened from (" +
            (r.reason || "unknown") + ") — this room's log is INCOMPLETE; reload");
        } else {
          Logger.info("Room: no save point to open from (" + ((r && r.reason) || "unknown") + ") — the full download is kept");
        }
      }
    } catch (e) { Logger.warn("Room: opening from a save point failed — " + (e && e.message) + "; nothing was dropped"); }
  }

  // Wiring phase: bind this room's engine, seed its clock, and wire every module
  // EXCEPT Playback's live tick loop. Safe to call before replay — nothing here
  // acts on stream state on a timer; it only subscribes and prepares.
  function _initModules(room, modeId) {
    // ── THE RESETS ARE THE LEAVE'S NOW (J83, the owner's ruling 18) ──────────────────────────
    // The outgoing engine's reset, `ServerClock.destroy` and `resetCheckpoints` ran HERE, first, on
    // every entry (J23's order: reset what is bound, then bind). They moved, in that order and with
    // the rest of the room's stops, into `leave` — which the opening runs immediately before this
    // (`_enter`), and which every way out of a room runs too. So the engine bound here is the lobby's
    // bootstrap one holding nothing, whatever this tab did before, and a room left for the lobby no
    // longer keeps running until the next entry.
    if (modeId) Backends.bind(modeId);

    MatrixBridge.seedClock(room.spaceId);   // per-room Lamport clock starts/resumes here

    const ch = room.channels;

    // ── BIND THIS ROOM'S SCOPE BEFORE ANYTHING IS REPLAYED ───────────────────────────────
    // resetCheckpoints() in `leave` cleared the last room's scope; this sets ours. It has to happen
    // HERE — after the clear, before replay — because sync keeps delivering events from every
    // room the whole time, and until a scope is bound the ingest door refuses everything.
    //
    // Resetting the modules (now in `leave`) was never enough on its own: it cleaned the state and left
    // the door open, so the room we just left kept feeding this one. That is how a fresh room
    // inherited another room's positions and another room's ranks.
    try { if (typeof MatrixBridge.setRoomScope === "function") MatrixBridge.setRoomScope(ch); } catch (e) {}

    // Protocol events — write to the HIGHEST-rank channel we can write to.
    // The rank of that channel is our rank; transport picks it from our write
    // permissions and degrades gracefully if higher-rank channels don't exist.
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;

    // Chat — the uncategorized chat to start (guest if there is none); the room's `chat` setting and
    // this device's view are applied by `applyChatTiers` below.
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

    _chatWired = !!chatChannel;
    if (chatChannel) {
      Chat.init(chatChannel);
      // J12 — bind the READABLE SET at entry, not only when a settings event arrives. Without
      // this a client that never sees a `ddjp.room.settings` event reads only the channel
      // `Chat.init` seeded, and every other tier it may read would be silent in a room whose
      // settings never changed. The resolver is the
      // same one the settings path uses (P7) — this is a second CALLER, never a second copy.
      try { applyChatTiers(); } catch (e) { Logger.warn("Room: chat tiers not applied — " + (e && e.message)); }
    } else {
      Logger.warn("Room: no chat channel available — chat not wired yet (it is wired when one is joined)");
    }

    // DMs (J15) bind INDEPENDENTLY of the room's chat channel and are deliberately outside the
    // `if` above: a conversation is with a person, not inside a room, so a room with no chat
    // channel is not a reason to have no conversations. Failing here can only ever disable DMs —
    // the same defensive wiring Reactions and MediaLength get, for the same reason. Since J83 they
    // are bound at LOGIN (`app.js`, E3) and this only refreshes their scope; a world that enters a
    // room with no login binds them here, once.
    try { if (Chat.dmInit) Chat.dmInit(); }
    catch (e) { Logger.warn("Room: Chat.dmInit failed (DMs disabled): " + (e && e.message)); }

    // ── THE ONE JOIN STEP, NOW THAT THIS ROOM RUNS HERE (J81) ─────────────────────────────────────────────────────────
    // AT WIRING, not only on the hooks: an invite that arrived while this tab was closed, or during the opening, is never
    // re-announced, so a client that only listened would come back and stay out. It coalesces with the opening's own pass
    // when that is still running (one more pass after it, not a second one beside it), and, as a catch-up that names no
    // change, runs only when it would join something (J84-1).
    _runJoinStep("the room is open", { ifWouldJoin: true });

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
    // THE BOT'S JOIN TIMES, NOW THAT THE HISTORY IS IN (J115). The bot started at the room's entry, before the replay, and
    // its seed then read an empty log; this reads them again from the replayed queue, before the room goes live.
    _replayed = true;
    try { if (typeof BotRuntime !== "undefined" && typeof BotRuntime.reseed === "function") BotRuntime.reseed(); }
    catch (e) { Logger.warn("Room: the bot could not re-read join times after the replay — " + ((e && e.message) || e)); }
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
  // What the room's writers were last wired for — "channel|my rank" (ddjp_472). A power-level change
  // fires for ANYONE's rank, and restarting the queue, skip, playback, reactions and the rest for someone
  // else's promotion was work for nothing; they are restarted only when MY channel or rank changed. The
  // listeners below hear every change — People and the user card need someone else's too.
  let _wiredFor = null;
  function _rewireWriteChannel() {
    if (!current) return;
    const ch = current.channels;
    const eventsChannel = MatrixBridge.getWriteChannelId(ch) ||
      ch.events_player || ch.events_uncategorized;
    if (!eventsChannel) return;
    const key = eventsChannel + "|" + MatrixBridge.getMyRank(ch);
    if (key !== _wiredFor) {
      _wiredFor = key;
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
    }
    for (const fn of _rankChangeListeners) { try { fn(MatrixBridge.getMyRank(ch)); } catch (e) {} }
  }

  // --- DDJP room discovery ---
  // A channel's display name from its kind ("chat_staff" -> "staff chat"); the kind itself when the plan does not know it.
  function _channelLabel(kind) {
    try {
      const row = (MatrixBridge.channelTaxonomy() || []).find((c) => c.key === kind);
      if (row) return row.kind === "presence" ? "presence chat" : row.slug.replace(/_/g, " ") + " " + row.kind;
    } catch (e) { /* the key is still a name */ }
    return String(kind);
  }
  // ── THE LOBBY'S INVITES COME FROM THE ONE CLASSIFIER (J81; rulings 8f, 16, 17) ──────────────────────────────────────
  // Room invitations: ONLY DDJP rooms (`ddjp_mode`) — another app's space is the DM panel's (ruling 17). Under each: the
  // channel invitations that wait for it (their mark names it, its creator made them). Under a joined room that is not
  // running on this tab: how many verified channel invitations wait for its opening. And "Invitations not confirmed":
  // every DDJP-looking invite that could not be verified, and every unreadable one, with its reason — Decline only.
  function scanDDJPRooms() {
    const matrixClient = MatrixBridge.getClient();
    if (!matrixClient) return { owned: [], joined: [], invited: [], unconfirmed: [] };

    const owned = [], joined = [], invited = [], unconfirmed = [];
    let verdicts = [];
    try { verdicts = (typeof MatrixAccount !== "undefined" && MatrixAccount.invites) ? (MatrixAccount.invites() || []) : []; }
    catch (e) { verdicts = []; Logger.warn("Room.scan: the pending invites could not be read — " + ((e && e.message) || e)); }
    const running = runningRoom();
    const waitingFor = Object.create(null), underInvite = Object.create(null);
    for (const v of verdicts) {
      if (v.verdict === "room") {
        invited.push({ name: v.name || v.roomId, spaceId: v.roomId, from: v.from, ts: v.ts, waiting: [] });
      } else if (v.verdict === "channel" && v.verified) {
        if (v.room !== running) (waitingFor[v.room] = waitingFor[v.room] || []).push(v.kind);
      } else if (v.verdict === "channel" && v.waitsUnder) {
        (underInvite[v.waitsUnder] = underInvite[v.waitsUnder] || []).push(v.kind);
      } else if (v.verdict === "channel" || v.verdict === "unreadable") {
        unconfirmed.push({ roomId: v.roomId, name: v.name || v.roomId, from: v.from, ts: v.ts, why: v.why });
      }
    }
    for (const r of invited) r.waiting = (underInvite[r.spaceId] || []).map(_channelLabel);

    for (const room of matrixClient.getRooms()) {
      // Must be a Matrix Space
      const createEvent = room.currentState.getStateEvents("m.room.create", "");
      if (!createEvent || createEvent.getContent().type !== "m.space") continue;

      const membership = room.getMyMembership ? room.getMyMembership() : "join";
      if (membership !== "join") continue;   // invites are the classifier's (above); ignore left/banned/etc.

      // A JOINED DDJP ROOM IS ONE THAT DECLARES ITS ENGINE (J81). This asked for two children NAMED events-owner and
      // events-uncategorized, which only a client already inside those channels can see. Accepting a room invitation now
      // joins the room alone (D4) — its channels are joined at its first opening — so a room just accepted would have
      // vanished from the list until opened, which it never could be from here. The room's own declaration (`ddjp_mode`,
      // fixed in its creation record since J23) is what a DDJP room is; names are display only (D2). A room that declares
      // no engine could never be opened anyway (refused by name since J23), so it is not listed.
      if (!Backends.resolveMode(createEvent.getContent())) continue;

      // Owner-or-above in the space. Compared BY NAME via Capabilities.atLeast — the owner
      // rung's level is the ladder's business, and a literal here would have gone stale when it
      // moved from 100 to 99.
      // THROUGH THE BRIDGE (ddjp_501). This read the power list inline, a copy of the bridge's, and so
      // missed the room-version-12 creator rule: the owner's own room listed as merely joined.
      const userLevel = MatrixBridge.getMyPowerLevel(room.roomId);
      const isOwner = typeof userLevel === "number" && Capabilities.atLeast(userLevel, "owner");

      const entry = { name: room.name, spaceId: room.roomId, waiting: (waitingFor[room.roomId] || []).length };
      (isOwner ? owned : joined).push(entry);
      Logger.debug("Room.scan: " + room.name + " isOwner=" + isOwner);
    }

    Logger.info("Room.scan: owned=" + owned.length + " joined=" + joined.length + " invited=" + invited.length + " not-confirmed=" + unconfirmed.length);
    return { owned, joined, invited, unconfirmed };
  }

  // ── A ROOM INVITATION: ACCEPT JOINS THE ROOM ONLY; DECLINE REFUSES IT AND ITS WAITING CHANNELS (J81, D4; ruling 16) ──
  // Accepting is not opening: the room running on this tab keeps running, and the new room's channels are joined by the
  // join step when it is first opened. A failure throws with its reason, which the lobby shows beside the re-enabled button.
  async function acceptInvite(spaceId) {
    await MatrixBridge.joinSpace(spaceId);
    Logger.info("Room: accepted the invitation to " + spaceId + " — its channels are joined when you open it");
  }
  // Declining a room invitation also declines the channel invitations waiting under it (their mark names it and its
  // creator made them): they belong to it and cannot be joined without it. Any invite in "Invitations not confirmed" is
  // declined on its own. A decline that fails SAYS SO and the invite stays (ruling 15).
  async function declineInvite(roomId) {
    const ids = [roomId];
    try {
      for (const v of (MatrixAccount.invites() || [])) if (v.verdict === "channel" && v.waitsUnder === roomId) ids.push(v.roomId);
    } catch (e) { /* the room itself is declined regardless */ }
    const failed = [];
    for (const id of ids) {
      const r = await MatrixBridge.declineInvite(id);
      if (!r || !r.ok) failed.push(id + " (" + ((r && (r.detail || r.reason)) || "failed") + ")");
    }
    if (failed.length) {
      Logger.warn("Room: could not decline " + failed.join(", ") + " — it stays; try again");
      return { ok: false, failed: failed };
    }
    Logger.info("Room: declined the invitation to " + roomId + (ids.length > 1 ? " and the " + (ids.length - 1) + " channel invitation(s) waiting under it" : ""));
    return { ok: true, declined: ids.length };
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
    // AND THE INVITES ALREADY PENDING, SAID ONCE AT WIRING (J81; ruling 15: never silent): an invite that arrived while the tab
    // was closed is never re-announced, so after a reload its line — "waits: … is not running on this tab" — comes from here.
    try { _logInviteVerdicts(); } catch (e) { /* the next change says it */ }
  }

  // SETTINGS THIS ROOM'S ENGINE NEVER ACTS ON, as the engine itself declares them
  // (`core/backends.js` `idleSettings`). The settings panel leaves these out rather than offer
  // controls that change nothing here; it holds no list of its own, so a second engine cannot
  // disagree with it. Empty when nothing is bound or the engine declares none.
  function idleSettings() {
    try {
      const d = (typeof Backends !== "undefined" && Backends.active) ? Backends.describe(Backends.active()) : null;
      return (d && Array.isArray(d.idleSettings)) ? d.idleSettings.slice() : [];
    } catch (e) { return []; }
  }

  // NAMED, so the reader can index the EXPORTED table rather than a closure constant. That is not
  // ceremony: `ACTIVITY_SOURCES` is already indexed this way and a guard drives it by MOVING the
  // entry, which is the only way to tell a table lookup from a restated key. The window key needs
  // the same, and `mutate-one-window` M4 came back green until it had it.
  const api = {
    create, pendingCreate, resumeCreate, discardPendingCreate, join, invite, acceptInvite, promote, assignRank, canAssignRank, isRankUnlocked, rankAssignable, highestUnlockedRank, rankLadder, mergeChannels,
    kick, ban, canModerate,
    // J-repeat: the ONE reading of the replay cooldown, exported beside `idleFor` for the same
    // reason — the fold is pure and drivable at explicit values, and the two callers (the bot's
    // skip and every client's add) must never grow a second copy of it.
    playedWithin, canQueue,
    botStatus,
    // Guard seam, and the same argument as `MatrixBridge._setClientForTest`: `current` is
    // established by a join flow that replays every channel and cannot run headless, so without
    // this the live-rank re-check inside `_moderate` could only be asserted as SOURCE TEXT — and
    // a regex proving a comparison is spelled somewhere proves nothing about whether it runs.
    // That re-check is the ONLY backstop a membership act has, because no reducer ever sees one,
    // so it is the last thing in this file that should be guarded by reading.
    _setCurrentForTest: function (c) { current = c; } /* exposed for the guard */,
    _setJoinLaterForTest: function (fn) { _joinLater = fn; } /* exposed for the guard: the room-list burst's one timer (J84-1) */,
    // J83: THE REAL SWITCH, for the guards that walk a tab from room to room with no homeserver to join through — `_enter` is
    // what both openings run (leave the running room, then wire this one). `opening: true` leaves the opening flag set, as a
    // join does while it replays, so a cancel can be driven; `start: true` then goes live, as the opening does after its replay.
    _enterForTest: function (room, modeId, o) { if (o && o.opening) _opening = room.spaceId; _enter(room, modeId); if (o && typeof o.replay === "function") o.replay(); if (o && o.start) _startModules(); } /* exposed for the guard: `replay` stands where the opening's replay runs */,
    getCurrent, getChannels, scanDDJPRooms, onRoomsChanged,
    getSettings, getSettingRanges, setSettings, onSettingsChange, getSettingRows, editSettingTable,
    presenceView, _viewerChatForTest,   // the People tab's view (J75) and its guard seam
    onChatTiersChanged,                 // a chat mapped after wiring (ddjp_621): the chat panel re-resolves
    peopleOrder,                        // the People tab's one order (J84-3, rulings 31 and 34)
    getMyId, getMyRank, getMyAuthorityLevel, getRoster, onRankChange, onMembersChange, onPeopleViewChange, peopleViewChanged,
    onBotCardChange, botCardChanged,    // the bot card's own "it changed" (J117, `ddjp_630`)
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
    // J81. `runningRoom` is the ONE reading of "which room runs on this tab" (`current`); this module reads it directly,
    // and it is exported for the guards that drive it by name (`check-join-step`, `check-runner-room-change` P-i) and for
    // J83. `declineInvite` is the lobby's Decline (`ui/screens.js`).
    runningRoom, declineInvite,
    // J83 — the ONE leave step and what calls it: every way out (`ui/shell.js`, `ui/screens.js`, `app.js`, the bot's daily
    // reload), a cancelled opening, the tab's memory of its room and the reopen after a reload, and who hears that a room was
    // left (the UI, for a removal).
    leave, cancelOpening, onLeft, rememberedRoom, reopen,
    availableTypes,
    idleSettings
  };
  // THE HISTORY AUDIT (ddjp_559): the debug tools' read-only check of this device's song history against the room's.
  function historyAudit() { return (typeof MatrixBridge !== "undefined" && MatrixBridge.historyAudit) ? MatrixBridge.historyAudit() : Promise.resolve(null); }
  api.historyAudit = historyAudit;
  return api;
})();
