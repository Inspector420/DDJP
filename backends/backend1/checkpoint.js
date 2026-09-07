// backends/backend1/checkpoint.js
//
// CHECKPOINT — THE ONE QUESTION: may I publish where the room is right now, and what goes in it?
//
// EMITTING ONLY. In the old tree this file also chose floors, verified quorums, adopted, graded,
// re-validated and re-fetched — seven jobs, one of which was its own. Those belong to Floor now,
// and the split is why this file is short. It asks two questions of two other modules and obeys
// the answers:
//
//     "am I covered enough to seal?"        -> Vouch
//     "where does my segment start?"        -> Floor
//
// It does not decide either. That is the point.
//
// A CHECKPOINT IS A CLAIM ABOUT NOW. Not "this happened" — "this is where the room IS". The
// distinction is the nastiest bug this system has had: a client four events into replaying
// yesterday produced a perfectly correct snapshot of a moment that had already ended, published
// it, and then adopted its own answer. Every step was individually right. The result was a lie.
// Sealing therefore asks Session whether it is entitled to speak about the present at all, and
// then re-reads the head after waiting its slot — because liveness alone is a proxy, and a client
// that reconnected and is folding a backlog is live the whole time and just as wrong.
//
// SMALL BY DESIGN. A checkpoint's size tracks how many people and songs are CURRENTLY relevant,
// never how long the room has run — about 2 KB whether the room is an hour or six months old.
// That is what makes it cheap enough for everyone to carry.
//
// Depends on: StateDeriver (the seed), Floor (segment + fingerprint), Vouch (coverage),
// Session (phase), Scheduler (the slot), TrustPolicy (grades).
//
// LOAD ORDER: needs CheckpointFormat AT LOAD TIME (const TYPE = CheckpointFormat.TYPE). Dials,
// Floor, Vouch, Session and Scheduler are all resolved when a function runs, so their order is
// free.

const Checkpoint = (() => {

  const TYPE = CheckpointFormat.TYPE;

  let _seq = 0;                 // our own seal counter. PRIVATE, and never comparable across
                                // authors — it counts from whatever we last trusted.
  let _lastOwnSealAt = 0;
  let _lastSealHead = 0;
  // How far up the log this client has banked, as a POSITION. `l` is assigned once and never
  // renumbered, so it is the one scale a trim cannot move — which is exactly what `_lastSealHead`
  // (a tally) could not survive. `null` means "no position known yet".
  let _sealedThroughL = null;

  function _highestL(log) {
    let top = null;
    for (const e of (Array.isArray(log) ? log : [])) {
      if (e && typeof e.l === "number" && isFinite(e.l) && (top === null || e.l > top)) top = e.l;
    }
    return top;
  }
  let _sealedSinceArrival = false;
  let _sealing = false;
  let _gapFirstSeenAt = 0;   // when THIS module first saw a gap, for its own bounded wait

  let _env = {
    now: () => Date.now(),
    log: () => [],          // no silent global fallback — an unwired module holds nothing
    thin: () => false,      // () => has this client trimmed below its floor?
    held: () => [],
    settings: () => ({}),
    myRank: () => null,
    myUserId: () => null,
    amOwner: () => false,
    isLegal: () => null,
    send: null,               // (type, content) => Promise
    holdForWitness: () => ({ hold: false, remainingMs: 0, cycleMs: 0, capped: false }),
  };
  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  // ── WHAT GOES IN ─────────────────────────────────────────────────────────────────────────
  // Exactly the reducer's CARRY-FORWARD accumulators and nothing recomputable from them. The test
  // for every candidate field: does the reducer need this as a starting point to judge the NEXT
  // event, and can it NOT recompute it from the other sealed fields? Yes -> seal it. No -> drop it.
  //
  // Built by the reducer's own buildSeed rather than assembled here, so the snapshot and the state
  // it describes come from ONE fold and cannot disagree.
  function build(segment, priorSeed) {
    return StateDeriver.buildSeed(segment, priorSeed);
  }

  // ── AN IMPORTED SNAPSHOT (J27) ───────────────────────────────────────────────────────────
  // A save file's checkpoint is a claim about a room that is not this one. It cannot be posted
  // verbatim: `covers` and `floorL` name events in the exporting room, and a floor placed at a
  // position this room's log has never reached is the pairing fault StreamManager already refuses
  // by name. So the imported SEED is carried across and everything that anchors it is rebuilt
  // against the room being created.
  //
  // IT IS BUILT HERE BECAUSE THIS MODULE EMITS SNAPSHOTS. Putting a second fingerprint-builder in
  // the seam would be a second home for the act (P7) — and note that neither this nor `seal()` is
  // a second home for the FORMAT, since both ask `CheckpointFormat.fingerprint`.
  //
  // THREE THINGS ARE REBUILT, AND EACH FOR A STATED REASON:
  //   settingsFrom  the file's pointer names a settings event in the old room, which nobody here
  //                 can read. The importer posts the file's settings blob as this room's genesis
  //                 settings event and the pointer is re-anchored to it — the decision J25 already
  //                 recorded when it settled J28's settings half. THE POINTER DESCRIBES, IT NEVER
  //                 DECIDES, so re-anchoring it changes no verdict; it only makes the claim
  //                 checkable in the room it now describes.
  //   settings      merged over the CURRENT defaults, so the blob is COMPLETE. An older file may
  //                 be missing a key this build defines (`readFile` warns `keyset-older` and
  //                 admits an owner file), and an incomplete blob makes `settingsBlobComplete`
  //                 false, which answers `unverifiable` for ever after. The default is the honest
  //                 reading — that room really was running under it (checkpoint-contents §1.3).
  //   n/prev/covers/floorL/thin
  //                 this is the room's FIRST checkpoint: counter 1, no predecessor, covering the
  //                 genesis settings event alone. `thin` is TRUE and that is not a formality — the
  //                 importer genuinely computed from a seed rather than from this room's
  //                 beginning, and `thin` is the author's own statement about how it computed.
  //
  // NOTHING HERE READS THE FILE'S `author`. Rank in the new room comes from that room's channels
  // (P6); the file's declaration is a claim about a room this one has no channel to, and it buys
  // no authority here. The importer's own owner channel is what makes this checkpoint an owner
  // checkpoint, exactly as it does for every other event.
  function buildImport(seed, anchor) {
    const a = anchor || {};
    if (!seed || typeof seed !== "object") return { ok: false, reason: "no-seed" };
    if (!a.settingsFrom || !a.eventId) return { ok: false, reason: "no-anchor" };
    if (!Number.isSafeInteger(a.l)) return { ok: false, reason: "no-anchor-position" };

    const merged = Object.assign(StateDeriver.defaultSettings(), seed.settings || {});
    const s = Object.assign({}, seed, { settings: merged, settingsFrom: a.settingsFrom });

    const n = 1, prev = null, thin = true;
    const covers = CheckpointFormat.coversOf(a.eventId, a.eventId);
    const h = CheckpointFormat.fingerprint(n, prev, s, a.l, thin, covers);
    const cp = { t: TYPE, n: n, prev: prev, seed: s, h: h,
                 covers: covers, floorL: a.l, thin: thin, dv: 1 };
    const by = a.by || (_env.myUserId ? _env.myUserId() : null);
    if (by) cp.by = by;
    return { ok: true, reason: null, cp: cp };
  }

  // And PUBLISHING it goes through the same door `seal()` uses, for two reasons that are not
  // taste. The type string has ONE home — `_env.send(TYPE, cp)` is the only place a checkpoint's
  // type is named on the wire, and a feature naming `"ddjp.checkpoint"` to post one itself would
  // be a second copy of a protocol constant in a layer that may not read the first (P7). And the
  // send is injected by transport, which is where the checkpoint CHANNEL is chosen — a feature
  // picking that channel would be picking a rank, which is transport's to decide from the map it
  // holds.
  //
  // NO CADENCE, AND THAT IS STILL DELIBERATE. `maySeal` asks whether this client may publish where
  // the room is *right now*: has the cooldown passed, is the span covered, is the room due. None of
  // those questions is about an import. An import does not bank a span of this room's history — it
  // replaces the state, covering the single settings event it was just anchored on — so there is
  // nothing for coverage to verify and no peer whose seal would make this one unnecessary. Routing
  // it through the cadence would make an owner's restore wait on a cooldown that exists to stop the
  // rank ladder sealing on top of itself, which is not a thing an import can do.
  //
  // ── BUT J27's COUNTERPART OBLIGATION IS GONE, AND IT IS REPLACED RATHER THAN RESTATED (J28) ──
  // J27 paid for the missing gate with a WIRING promise: "it must only ever be reached from room
  // creation, where the caller is the owner by construction." J28 adds a second caller — an owner
  // override in a running room — so that sentence is no longer true, and a promise about who calls
  // a function is exactly the thing this codebase keeps discovering was never checked (P1).
  //
  // MEASURED BEFORE IT WAS REPLACED, because the obligation could have been discharged by something
  // else in the tree. It was not: `probe-j28-running` R46 calls this function with a guest-ranked,
  // non-owner `_env` and it PUBLISHES — no rank check, no owner check, nothing. The promise was the
  // only thing holding it.
  //
  // SO THE OWNER QUESTION MOVES INSIDE, AND THE LIVENESS QUESTION DOES NOT. They are two different
  // questions and putting both here would be the wrong shape:
  //
  //   · WHO MAY PUBLISH AN IMPORT is a property of the ARTEFACT, and it is the same at both call
  //     sites. An import checkpoint declares an origin (`prev=null && thin=true`), and a client
  //     that adopts one DISCARDS the history below its cut — which is exactly why `trust-cascade.md`
  //     §6 grants owner floors adoption without recompute and grants nobody else it. So this is
  //     asked here, once, and creation passes it by construction rather than by promise.
  //   · AM I CAUGHT UP ENOUGH TO ANCHOR ON THE ROOM'S HEAD is a property of the OVERRIDE. A room
  //     being created has no head to be behind, so the question is meaningless at that call site and
  //     asking it here would gate J27's shipped path on a phase nothing establishes during creation.
  //     It is asked where it means something — `features/room.js` `overrideFromFile`, before it
  //     posts the settings event the anchor is built from.
  //
  // Refusing rather than throwing, and with a NAMED reason, because "did not publish" with no reason
  // is indistinguishable from "was not asked" — the same rule `maySeal`'s gates follow.
  async function publishImport(seed, anchor) {
    // Fail closed on an absent reader: unknown authority means "not the owner", because the safe
    // default for a duty (do more) is the unsafe one for an acceptance (accept more).
    const amOwner = (typeof _env.amOwner === "function") ? !!_env.amOwner() : false;
    if (!amOwner) return { ok: false, reason: "not-owner" };
    const built = buildImport(seed, anchor);
    if (!built.ok) return built;
    if (typeof _env.send !== "function") return { ok: false, reason: "no-send" };
    try {
      await _env.send(TYPE, built.cp);
      return { ok: true, reason: null, cp: built.cp };
    } catch (e) {
      return { ok: false, reason: "send-failed", detail: (e && e.message) || null };
    }
  }

  // ── MAY I SEAL? ──────────────────────────────────────────────────────────────────────────
  // The gates, in order, cheapest first. Each returns a NAMED reason, because "did not seal" with
  // no reason is indistinguishable from "was not asked".
  //
  //   1. somewhere to post          — you seal only to a channel you may write to
  //   2. am I entitled to speak     — Session. Replaying or catching up is not the present.
  //   3. cooldown                   — binds EVERYONE, the owner included
  //   4. owner-on-arrival shortcut  — an owner who can compute seals at once, ending work the
  //                                   room would otherwise grind through
  //   5. the witness hold           — a deletion may still be repairing; wait one cycle. THIS
  //                                   BINDS THE OWNER TOO, and that is the point: an owner floor
  //                                   is adopted by everyone WITHOUT recompute, so a short owner
  //                                   seed becomes the room's truth. A peer's short seal fails
  //                                   safe instead — someone holding the declaration recomputes,
  //                                   mismatches, and declines.
  //   6. coverage                   — the span since my floor is protected AT MY OWN BAR, or I
  //                                   witnessed all of it myself
  function maySeal(now) {
    if (!_env.send) return { ok: false, reason: "nowhere-to-post" };

    if (typeof Session !== "undefined" && Session.mayAuthor && !Session.mayAuthor()) {
      return { ok: false, reason: "not-live", phase: Session.phase ? Session.phase() : null };
    }

    const settings = _env.settings() || {};
    // Through the ONE home. These used to be written as local fallbacks here while the same
    // numbers already lived in the reducer's defaults — two hand-maintained copies of one value,
    // which is the drift this project records twice and never notices until a room disagrees.
    const cooldown = Dials.live(settings, "checkpointCooldownMs");

    // ── THE CADENCE IS READ OFF THE ROOM, NOT COUNTED IN THE PAGE ────────────────────────
    // `_lastOwnSealAt` is a module variable that starts at 0 on every load, and 0 does not mean
    // "just started" — it means "I have never sealed", which read as INFINITELY overdue. So every
    // client wanted to seal the instant it loaded. Observed: an owner refreshed three times and
    // wrote three checkpoints before any music had started, all empty, then went quiet for the
    // rest of the session because its in-page clock was finally running.
    //
    // Derived instead, from two SERVER timestamps: the floor I hold, and the newest thing that has
    // happened since. Same move as the Lamport clock and the server clock — stop
    // keeping a counter, read the fact.
    //
    // THE FLOOR, NOT THE LAST CHECKPOINT ANYONE POSTED, and the difference is not academic. A
    // checkpoint is not a floor: an owner's becomes one instantly, a peer's needs enough same-rank
    // agreement to clear the room's bar. Measuring from any checkpoint that went past meant a lone
    // high-staff seal — unadoptable, and therefore not covering anybody — silenced the very peers
    // whose agreement it needed, so the quorum could never form and the room never got another
    // floor. Adoption is what discharges the duty, so adoption is what the clock reads.
    //
    // NO LOCAL CLOCK ON EITHER SIDE. `now` is a device clock and a checkpoint's ts is server time;
    // subtracting one from the other is the mixing rule that produced the seek bug and the replay
    // clock bug (CONCEPTS.md §3.6b).
    //
    // And it is the SHARED anchor that makes the rank ladder work at all. Private stopwatches
    // start whenever each page happened to load, so two clients came due minutes apart and the
    // owner's head start never got to matter — a junior whose timer expired first sealed while the
    // owner was still mid-cooldown. Reading the same timestamp, everyone comes due together.
    const _log = _env.log();
    // ELAPSED SINCE THE FLOOR I ADOPTED — not since the newest checkpoint in the log. A checkpoint
    // is not a floor: an owner's is one instantly, a peer's needs enough same-rank agreement to
    // clear the room's bar, and one I cannot adopt tells me nothing about whether the room is
    // covered. Measuring from it answered a question nobody asked, and answered it wrongly twice:
    // a page load looked like a fresh seal, and a lone unadoptable peer checkpoint silenced the
    // very peers whose agreement it needed. Both server timestamps, no device clock either side.
    // No floor at all means nobody has covered anything, which is genuinely overdue.
    const anchorTs = _env.floorTs ? _env.floorTs() : null;
    const sinceFloor = (typeof anchorTs === "number") ? (_newestTs(_log) - anchorTs) : Infinity;

    // The one thing still worth keeping in memory: I may have sealed moments ago and my own
    // checkpoint may not have synced back yet. That is a re-entrancy floor, not the cadence — and
    // it is CORRECT to lose on reload, because after a reload the room's own record governs.
    // Both sides here are the same local clock, so this compares like with like.
    const sentAgo = _lastOwnSealAt ? (now - _lastOwnSealAt) : Infinity;
    // REPORTED UNDER ITS REAL NAME, and it has been renamed twice for the same reason. It began as
    // "how long since *I* sealed", became "how long since anyone banked" (`sinceBanked`), and is now
    // "how long since the floor I hold was established" — `sinceFloor`. Each rename followed the
    // meaning, because a field that keeps an old name while carrying a new meaning is the shape
    // roles.md §10 calls out: a message that names something it is not. Anyone reading a live
    // `not-due` line is told which measurement refused them.
    // ── A FLOOR ON RE-ENTRANCY, NOT A SECOND COOLDOWN ────────────────────────────────────
    // `sentAgo` exists for one narrow window: I sealed moments ago and my own checkpoint has not
    // synced back yet, so my floor is not dated and the derived clock cannot answer. It was gated
    // on the FULL cooldown, which made it a second cadence — and one that binds only clients that
    // have already sealed, so the owner was held for twenty minutes by its own stopwatch while a
    // peer that had never sealed was free the moment the shared clock said due. Its own comment
    // called it a re-entrancy floor; the arithmetic made it the cadence.
    //
    // The window is the FULL LADDER: by the time every rank has had its slot, a checkpoint that
    // has not come back is genuinely missing rather than in flight, and re-sealing is the right
    // answer. Derived from the room's own dials, and clamped to the cooldown so it can never
    // exceed the real cadence. This only works alongside Floor dating a self-sealed floor — undated,
    // `sinceFloor` is Infinity and this short window would become the cadence instead.
    const _step = Dials.live(settings, "checkpointRankOffsetMs");
    const reentrancyMs = Math.min(cooldown, Ranks.TIER_COUNT * _step);

    // ── THE LADDER LIVES HERE TOO, NOT ONLY IN THE SEND SLOT ─────────────────────────────
    // The send slot orders clients that are ASKED at the same instant, and an arriving play does
    // exactly that. A quiet room does not: the only trigger left is a per-client cadence tick
    // anchored to when that page loaded, and a 30-second handicap cannot cover a five-minute
    // difference in when each client was asked. The bottom rank then seals in front of an owner
    // whose own tick simply has not come round yet.
    //
    // It cannot be fixed in the scheduler. That runs on the local clock while the floor carries a
    // SERVER stamp, and anchoring one on the other is the very mixture this cadence was rewritten
    // to remove. So the ladder goes where the arithmetic is already server-to-server: a rank is
    // not DUE until the room has been due for its own slot's worth of time.
    //
    // No jitter. Jitter exists to break up a burst of sends; whose turn it is must be a value
    // every client computes identically for every other client.
    const ladderMs = Ranks.staggerMs(_env.myRank(), _step, () => 0, 0);
    const cooldownDue = (sinceFloor >= cooldown + ladderMs) && (sentAgo >= reentrancyMs);
    // The COUNT trigger keeps no offset: it is event-driven, so every client is already asked
    // together and the send slot is enough to order them.

    // ── THE COUNT MEASURES STATE CHANGES, NOT MESSAGES ───────────────────────────────────
    // This counted every event in the log, and in a healthy room HALF THE LOG IS VOUCH BUNDLES.
    // Measured in the cascade simulation: 82 events, of which 41 were bundles — so the threshold of
    // 40 was tripped by protection traffic alone, in a room where only 41 things had actually
    // happened.
    //
    // A bundle changes NOTHING. It carries no action, the reducer ignores it, and it exists only to
    // protect events that do. Counting one as "an event needing a checkpoint" says a checkpoint is
    // needed because the room has been busy keeping itself safe.
    //
    // And it is self-amplifying, which is what makes it worth fixing rather than tuning: more
    // protection produces more bundles, which produce more checkpoints, which are more events to
    // protect. The busier the protection, the more the room believes it is behind.
    //
    // So the count uses the SAME set that decides what needs protecting in the first place. One
    // definition of "an event that matters", read from `Vouch` rather than restated — a second copy
    // would drift the first time a type was added.
    //
    // AND THAT CLAIM IS ONLY TRUE BECAUSE OF THE LINE BELOW. Protection is legal AND critical; a
    // filter by type alone counts
    // critical ONLY, so events the fold REFUSED still made checkpoints due — the same flood that
    // manufactured vouch work also forced seals, and seals are events. `_countable` now asks the
    // fold as well. Pinned by check-legality PART F.
    const head = _countable(_log);
    const every = Dials.live(settings, "checkpointEvery");
    // THE SECOND DOOR, AND IT HAD THE SAME BUG. `_lastSealHead` also starts at 0 on load, so a
    // freshly-loaded client counted the ENTIRE log as unbanked — instantly over a threshold of 40
    // in any room with 40 events. `EITHER trigger is enough`, so deriving only the clock would
    // have left this one wide open and looked fixed.
    //
    // THE COUNT ANCHORS ON THE FLOOR TOO, and it is DERIVED like the clock is. The old anchor was
    // the newest checkpoint in the log whoever wrote it, which re-blocked the unadoptable-peer case
    // through the second door: the clock would say due and the count would still answer
    // nothing-changed. The new anchor is how much of the log my FLOOR covers, counted off the log
    // itself — not `_lastSealHead` alone, which starts at zero in a fresh page and would read the
    // whole history as unbanked. That bug does not get to come back.
    const floorPos = _env.floorPos ? _env.floorPos() : null;
    const floorHead = (typeof floorPos === "number" && floorPos >= 0)
      ? _countable(_log.filter((e) => typeof e.l === "number" && e.l <= floorPos)) : 0;

    // ── A COUNT IS NOT STABLE UNDER A TRIM, AND THAT IS THE WHOLE DEFECT ────────────────────
    // `head` is `_countable(_log)` — counted off the log AS IT IS NOW. `_lastSealHead` was
    // `_countable(_log)` at seal time, off a log that still had everything below the floor in it.
    // **A trim drops events from the FRONT, so `head` falls and the anchor does not.** Driven: an
    // 80-event log trimmed to l=73 leaves head=7 against an anchor of 80, and `changed` is -73 —
    // permanently, because the log only ever gets shorter at the front. `if (changed <= 0)`
    // is then satisfied forever and **the room can never seal again**. Two browser clients were in
    // exactly this state at -40 and -37.
    //
    // `floorHead` was supposed to re-base the count, and the trim is precisely what empties it:
    // it counts events at or below the floor, which are the events the trim removes. So
    // `Math.max(floorHead, _lastSealHead)` keeps the stale larger number and the anchor never
    // recovers.
    //
    // **THE FIX IS AT THE SCALE, NOT THE SIGN.** `Math.max(0, changed)` would turn a permanent
    // stall into a silent one — the room would look healthy and still never seal on the count,
    // because the anchor would stay wrong and `changed` would read 0 rather than -73. What the
    // count needs is an anchor that survives a trim, and `l` is that: log positions are assigned
    // once and never renumbered, so "how far have I banked" is a POSITION, not a tally.
    //
    // `_sealedThroughL` is that position. `changed` becomes the countable events STRICTLY ABOVE
    // it, which is well-defined whatever the log has dropped: if the trim removed events I had
    // already banked, they are below the mark and were not going to be counted anyway.
    //
    // THE OLD ANCHOR IS KEPT AS A FLOOR-OF-LAST-RESORT for one release: a client loading a
    // persisted state written before this change has `lastSealHead` and no `sealedThroughL`, and
    // deriving a position from a count is not possible. It is used ONLY when no position is known,
    // and it is clamped so it can never make `changed` negative again.
    // THE MARK IS THE HIGHER OF MY OWN LAST SEAL AND THE FLOOR I HAVE ADOPTED. Both are positions
    // and both mean "banked" — mine because I sealed it, the floor's because somebody did and I
    // took it. Taking only my own would let a client that sealed once and then adopted a newer
    // floor go on counting from its own older mark, which is how the first version of this change
    // made every peer seal again instead of leaving it to the owner.
    const mark = (typeof floorPos === "number" && floorPos >= 0)
      ? (_sealedThroughL === null ? floorPos : Math.max(_sealedThroughL, floorPos))
      : _sealedThroughL;
    let changed;
    if (mark !== null) {
      changed = _countable(_log.filter((e) => typeof e.l === "number" && e.l > mark));
    } else {
      // ── NO POSITION YET, AND THIS IS WHERE THE DRIFT ACTUALLY ARRIVES ────────────────────
      // An old persisted state (`lastSealHead` written, `sealedThroughL` absent) or a client that
      // has never sealed. The first version CLAMPED here with `Math.max(0, …)` — **the exact thing
      // this fix rejected**, applied to the legacy path and therefore to precisely the clients who
      // upgrade INTO the stalled state. It made `counter-drift` unreachable: `_countable` cannot
      // return a negative and the clamp removed the only other route, so the announcement was dead
      // code and folding it back into `nothing-changed` changed nothing. Driven — the whole suite
      // stayed green with the word replaced.
      //
      // So the drift is DETECTED, ANNOUNCED, AND REPAIRED. A negative here means a tally anchor is
      // being compared against a log that has since been trimmed, which is the defect itself
      // arriving in a persisted state. Re-basing onto the stable scale is the repair: `l` is
      // assigned once, so the current head is a mark that a trim cannot move, and the next tick
      // takes the position branch and recovers. Announcing without repairing would leave the room
      // stalled but audible; repairing without announcing is how it went unseen for two days.
      const raw = head - Math.max(floorHead, _lastSealHead);
      if (raw < 0) {
        _sealedThroughL = _highestL(_log);
        Logger.error("Checkpoint: seal counter drifted (" + raw + " new events) — a banked TALLY " +
                     "was compared against a trimmed log. Re-basing onto log position " +
                     _sealedThroughL + "; sealing resumes from there.");
        return { ok: false, reason: "counter-drift", newEvents: raw, rebasedTo: _sealedThroughL };
      }
      changed = raw;
    }

    const countDue = changed >= every;

    // ── NOTHING CHANGED IS NOTHING TO BANK ───────────────────────────────────────────────
    // Asked BEFORE the triggers, because it outranks both of them. A checkpoint is a claim about
    // where the room IS; if the room has not moved since the last one was banked or adopted, the
    // claim is already on record and re-stating it costs a message to say the same thing.
    //
    // This is what makes an idle room cost exactly ZERO rather than one checkpoint per client per
    // cooldown, forever. Without it the clock trigger below would fire in a room where nothing has
    // happened for hours, every client would seal an identical snapshot, and each seal would reset
    // everyone else's clock — a room burning messages to record that nothing is happening.
    //
    // It cannot starve a quorum. A client whose own last seal or adoption is BEHIND the head still
    // has changed > 0 and still seals, which is exactly the client whose agreement a quorum needs.
    // Only clients already level with the head go quiet, and their agreement was already banked.
    //
    // ── THIS COMMENT USED TO ARGUE THE CASE IT MISSED ──────────────────────────────────────
    // It read: *"It cannot starve a quorum. A client whose own last seal or adoption is BEHIND the
    // head still has changed > 0"* — true, and reasoning entirely about `changed` being SMALL. It
    // never considered `changed` NEGATIVE, which is the only state a trim can produce. And two
    // lines above it named the mechanism — *"what happens when those two drift apart"* — and
    // assumed it away. **Premise true, consequence unchecked, in a guard clause, about the thing
    // that keeps a room alive.**
    //
    // `changed` is now counted above a POSITION rather than against a tally, so it cannot be
    // negative by construction. A negative arriving here would mean the position arithmetic is
    // wrong, and it is reported as its own reason rather than absorbed into "nothing changed" —
    // a stalled room and an idle room must not look the same.
    // A negative cannot reach here: the position branch counts a filtered array and the fallback
    // above returns before assigning. Kept as a floor rather than deleted — if either of those
    // stops being true, this says so instead of the room going quiet again.
    if (changed < 0) {
      Logger.error("Checkpoint: seal counter went negative (" + changed + ") after the drift " +
                   "check — the position arithmetic is wrong, not the anchor");
      return { ok: false, reason: "counter-drift", newEvents: changed };
    }
    if (changed === 0) {
      return { ok: false, reason: "nothing-changed", newEvents: changed };
    }

    // EITHER trigger is enough — they are two reasons, not a gate and a condition. The clock
    // covers a room that CHANGED but slowly, where the count would take too long to arrive; the
    // count covers a busy one where twenty minutes of history is far more than one checkpoint
    // should span. Making the clock a gate let a room pile up thousands of events and still
    // refuse to bank them.
    //
    // Neither covers a room that has not changed at all — the guard above already returned, and
    // it says so rather than leaving the clock to claim a coverage it never had. Both triggers
    // are also only ever ASKED by something: spine activity, or the cadence tick in MatrixBridge.
    // Eligibility is not an event.
    const ownerFirst = _env.amOwner() && !_sealedSinceArrival && cooldownDue;
    if (!ownerFirst && !cooldownDue && !countDue) {
      // The verdict carries its own numbers so a caller reporting it does not have to re-derive
      // the rank, the dial and the ladder to say anything useful — that would be a second copy of
      // an arithmetic this module already owns.
      return { ok: false, reason: "not-due", sinceFloor: sinceFloor, newEvents: changed,
               ladderMs: ladderMs, cooldownMs: cooldown };
    }

    const hold0 = _env.holdForWitness(now);
    if (hold0 && hold0.hold) return { ok: false, reason: "witness-hold", remainingMs: hold0.remainingMs };
    // THE HOLD CAN END TWO WAYS AND THEY ARE NOT THE SAME EVENT. Either the wait elapsed with
    // nothing outstanding, or the AGGREGATE cap released it while holes were still arriving — a
    // paced attacker, or a genuinely unlucky room. The second means we are sealing over an
    // unrepaired hole, which is exactly what `owner-unstick` already announces for the other route
    // to the same place. A caller that cannot tell them apart cannot report it, and this is a
    // thing an operator should be able to see happening.
    const cappedOver = (hold0 && hold0.capped) ? "hold-capped" : null;

    // ── THE OWNER ASKS A DIFFERENT QUESTION ──────────────────────────────────────────────
    // Everyone else must show the span is PROTECTED before sealing it. The owner must show the
    // span is COMPLETE. Those are different questions and only the second one is the owner's.
    //
    // THE DOCUMENT THAT OWNS THIS DECISION is checkpoint-contents.md §"The owner seals first, and
    // alone", where it is stated and marked [built]. Named here because the asymmetry reads as a
    // missing wire to anyone who meets it in the code first — it has already been mistaken for one,
    // off the back of a guard whose wording implied both branches ask. When the tree looks wrong,
    // find the document that owns the decision before proposing a fix.
    //
    // Vouching exists so a DELETED event can be rebuilt — and nobody below the top rank can delete
    // another person's message, so an owner sealing its own view is not defending against a
    // deletion it cannot see. What it must not do is seal a view with HOLES in it, because an
    // owner floor is adopted by everyone WITHOUT recompute: a short owner seed becomes the room's
    // truth, silently. So the owner's gate is "is my view whole", which Continuity already answers.
    //
    // This is also what lets the owner go FIRST. Under the coverage gate the owner had the
    // strictest bar in the room — one owner voucher, and it is the only owner — so on arrival it
    // had to vouch the entire history itself before it could seal anything, while every junior
    // sealed happily around it. The rank ladder put the owner at slot zero and the coverage gate
    // then made it last.
    if (_env.amOwner()) {
      const whole = _wholeView();
      if (!whole.ok) {
        // ── THE WAIT IS BOUNDED, AND THE OWNER IS THE THING THAT UNSTICKS THE ROOM ────────
        // A gap means WAIT — one repair cycle, purely listening, while whoever holds the missing
        // event vouches it. If it arrives, the view becomes whole and the seal is honest.
        //
        // If it does not, THE OWNER SEALS ANYWAY. That is not a failure of the rule, it is the
        // point of having an owner: an unfillable hole means the event is genuinely gone, and a
        // room that refuses to bank anything until a vanished event comes back is a room that
        // never banks anything again. Sealing makes the loss official, everyone adopts the owner's
        // version without recompute, and the room moves.
        //
        // The wait is bounded by the SAME hold the gate above already uses, rather than a second
        // clock: `holdForWitness` covers exactly one full repair cycle — proactive debounce, half a
        // jitter step, repair debounce, settle margin — and expires on its own. Two clocks for one
        // wait is how two modules come to disagree about whether they are still waiting.
        // ── THE WAIT NEEDS ITS OWN STAMP, AND MUTATION PROVED IT ─────────────────────────
        // This first consulted `holdForWitness` — and deleting the check changed nothing, because
        // the gate ABOVE already refuses everyone, owner included, while that hold runs. It was
        // dead code.
        //
        // Worse, it left a real gap uncovered. That hold is stamped by TRANSPORT when it sees a
        // redaction go past. A client that joined after the deletion never saw one, so it has a
        // gap with no hold — and would have sealed over it INSTANTLY, with no listening period at
        // all. The two detections are different events: "I watched it happen" and "I arrived and
        // something is missing".
        //
        // So the wait is stamped when THIS module first notices, and it borrows the same cycle
        // LENGTH rather than inventing one — one definition of "a full repair cycle", two places
        // that can start one.
        const cycle = (hold0 && typeof hold0.cycleMs === "number" && hold0.cycleMs > 0)
          ? hold0.cycleMs : 6000;
        if (_gapFirstSeenAt === 0) _gapFirstSeenAt = now;
        const waited = now - _gapFirstSeenAt;
        if (waited < cycle) {
          return { ok: false, reason: "waiting-for-repair",
                   remainingMs: cycle - waited, detail: whole.reason };
        }
        // The cycle passed and nobody filled it. Proceed, and SAY SO — a seal over a known hole is
        // a different event from a clean one, and a caller that cannot tell them apart cannot
        // report it either.
        return { ok: true, mode: "owner-unstick", ownerFirst: ownerFirst, over: whole.reason, cappedOver: cappedOver };
      }
      _gapFirstSeenAt = 0;          // whole again — the next gap starts its own wait
      return { ok: true, mode: "owner-complete", ownerFirst: ownerFirst, cappedOver: cappedOver };
    }

    const cov = coverageVerdict();
    if (!cov.ok) return { ok: false, reason: cov.reason };

    return { ok: true, mode: cov.mode, ownerFirst: ownerFirst, cappedOver: cappedOver };
  }

  // ── COVERAGE: the span since MY floor, at MY bar ─────────────────────────────────────────
  // TWO SPANS, TWO QUESTIONS, and conflating them is what made the old gate ask whether the room's
  // entire history was covered — which after the first hour is never true, so it would refuse
  // every seal forever:
  //   the SEGMENT since the floor I trust  -> have we protected what has happened SINCE?
  //   everything I hold below the seal     -> is the chain whole? (the hole check, elsewhere)
  // We do not redo what the owner already secured.
  //
  // AT MY OWN BAR, not anybody's. Reading "satisfied by someone" absolutely would let a staff
  // client seal on the strength of GUEST vouching — the don't-trust-down violation refused one
  // module away.
  function coverageVerdict() {
    const settings = _env.settings() || {};
    const me = _env.myUserId();
    const myRank = _env.myRank();
    const floorL = (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1;
    const held = _env.held() || [];
    const isLegal = _env.isLegal();

    const span = [];
    for (const r of held) {
      const l = (typeof r.l === "number") ? r.l : 0;
      if (floorL >= 0 && l <= floorL) continue;                 // banked — not our problem
      if (!Vouch.eligible(r, null, isLegal)) continue;          // legal + critical + not owner's
      span.push(r);
    }
    if (!span.length) return { ok: true, mode: "empty-span" };

    const cov = Vouch.coverage(held);
    let roomInSpec = true;
    for (const r of span) {
      const a = { u: r.sender || null, r: (typeof r.senderRank === "number") ? r.senderRank : null };
      if (!Vouch.protectedForMe(cov[r.event_id] || [], a, settings, myRank)) { roomInSpec = false; break; }
    }
    if (roomInSpec) return { ok: true, mode: "coverage" };

    // SELF-WITNESS. A real question, and it was not always: the old loop tested whether each event
    // had an id, which `eligible` already guarantees on its first line — so the branch was
    // unreachable and the answer was simply the config flag. A client sealed with ZERO vouching
    // anywhere in the span and reported mode "self", a claim asserted by nothing. The real
    // question was already computed one line above: does the coverage map contain ME.
    const selfOn = Dials.live(settings, "selfWitnessCheckpoint") !== false;
    if (!selfOn) return { ok: false, reason: "unwitnessed" };
    for (const r of span) {
      if (r.sender === me) continue;                             // I do not witness myself
      const vouchers = cov[r.event_id] || [];
      let byMe = false;
      for (const v of vouchers) { if (v && v.u === me) { byMe = true; break; } }
      // A client that does not know who it is fails here through the comparison — no entry can
      // equal an absent id — so the rule keeps one home rather than being stated twice.
      if (!byMe) return { ok: false, reason: "unwitnessed" };
    }
    return { ok: true, mode: "self" };
  }

  // ── WHERE THE CADENCE IS READ FROM ───────────────────────────────────────────────────────
  // The newest thing that has happened, measured against the floor this client holds. Both are
  // server timestamps — the event's, and the one the floor inherited from the checkpoint it was
  // derived from — so neither is a private stopwatch, both survive a reload, and two clients
  // holding the same floor read the same interval. That last property is what the rank ladder
  // needs: everyone comes due at the same moment, so the head start decides who goes.
  //
  // NOT "the last checkpoint anyone posted", which is what this used to pair with. A checkpoint is
  // not a floor, and one that nobody could adopt covered nobody while still resetting everybody.
  //
  // A checkpoint sits one position above its own `floorL`, so it survives the trim it licenses.
  // That is what stops the floor being eaten by the forgetting it authorises.
  function _newestTs(log) {
    const list = Array.isArray(log) ? log : [];
    let m = 0;
    for (const e of list) if (e && typeof e.ts === "number" && e.ts > m) m = e.ts;
    return m;
  }

  // How many events since the beginning actually CHANGED anything. Degrades to the raw length when
  // Vouch is absent, because a partial load must not silently stop a room banking history.
  //
  // ── AND \"CHANGED ANYTHING\" MEANS THE FOLD ACCEPTED IT ────────────────────────────────────
  // This filtered by TYPE alone. The comment in maySeal already claimed it \"uses the SAME set that
  // decides what needs protecting in the first place\" — and it did not: protection is legal AND
  // critical, this was critical only. So every event the reducer REFUSED still counted toward the
  // seal cadence, and a client that could not change the room by a single byte could still force
  // every client in it to bank a checkpoint. Measured before the fix: 12 rejected `dj.leave`
  // messages counted 12; at the shipped `checkpointEvery` of 40, 41 of them counted 41.
  //
  // That is the self-amplifying shape this function's own neighbour warns about for vouch
  // bundles, reached from the other side: seals are events, so forced seals produce more of
  // exactly the thing being counted.
  //
  // No predicate (partial load, headless harness) counts everything, which is the conservative
  // direction — it seals sooner rather than never.
  function _countable(log) {
    const list = Array.isArray(log) ? log : [];
    try {
      if (typeof Vouch === "undefined" || !Vouch.NON_CRITICAL_TYPES) return list.length;
      let isLegal = null;
      try { isLegal = _env.isLegal ? _env.isLegal() : null; } catch (e) { isLegal = null; }
      let n = 0;
      for (const e of list) {
        const t = (e && e.content && e.content.t) || (e && e.type) || null;
        if (t && Vouch.NON_CRITICAL_TYPES.indexOf(t) >= 0) continue;
        if (typeof isLegal === "function") {
          const id = e && (e.eventId || e.event_id);
          if (id && !isLegal(id)) continue;      // the fold refused it: it changed nothing
        }
        n++;
      }
      return n;
    } catch (err) { return list.length; }
  }

  // Is my fold complete — no corroborated gap anywhere above my floor? Delegated rather than
  // restated: Continuity owns "am I whole", and a second opinion about it here is exactly how one
  // concept comes to live in two places. Degrades to "yes" when Continuity is absent, because a
  // partial load must not silently stop an owner from banking history.
  function _wholeView() {
    try {
      if (typeof Continuity === "undefined" || !Continuity.mayAdvance) return { ok: true };
      // The floor's position AND the parent it banked. The owner's seal gate asks the same
      // question the advance path does, so it must be given the same bound — an owner that had
      // forgotten below its floor would otherwise read its own dropped play as a hole and refuse
      // to seal, which is the one client the room cannot afford to have stuck.
      let _banked = null;
      try { const _sd = (typeof Floor !== "undefined" && Floor.seed) ? Floor.seed() : null;
            _banked = (_sd && _sd.nowPlaying && _sd.nowPlaying.pi) || null; } catch (e) {}
      const v = Continuity.mayAdvance(_env.held() || [], _env.settings() || {},
                                      (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1,
                                      _banked);
      if (v.state === "short") return { ok: false, reason: "corroborated-gap" };
      return { ok: true };
    } catch (e) { return { ok: true }; }
  }

  // ── SEAL ─────────────────────────────────────────────────────────────────────────────────
  // Re-entrancy guarded, because generate is async and a burst must not launch overlapping seals.
  async function seal() {
    if (_sealing) return { ok: false, reason: "already-sealing" };
    const now = _env.now();
    const gate = maySeal(now);
    if (!gate.ok) return gate;

    // ── SAY SO, WHERE SOMEONE CAN HEAR IT ────────────────────────────────────────────────────
    // maySeal reports WHY a seal is allowed — `owner-unstick` when the owner banked over a gap
    // nobody filled, `cappedOver` when the aggregate hold bound released it while holes were still
    // arriving. Both were computed and then read by nothing but a guard: seal() consulted only
    // `gate.ok`. A verdict field that no production code reads is the same decorative shape as a
    // value that is stamped and never consulted, and this file has one of those in its history.
    //
    // So it is surfaced. A room sealing over unrepaired holes is a thing an operator should be able
    // to notice while it is happening, rather than infer later from a log that grew forever.
    if (gate.cappedOver || gate.mode === "owner-unstick") {
      try {
        if (typeof Logger !== "undefined" && Logger.warn) {
          Logger.warn("Checkpoint: sealing over an unrepaired hole — mode=" + gate.mode +
            (gate.over ? " over=" + gate.over : "") +
            (gate.cappedOver ? " (" + gate.cappedOver + ")" : ""));
        }
      } catch (e) { /* reporting must never block the seal it is reporting on */ }
    }

    _sealing = true;
    try {
      const log = _env.log();
      const floor = (typeof Floor !== "undefined" && Floor.current) ? Floor.current() : null;
      const seg = _segmentSince(floor, log);
      if (!seg) {
        // We trust a floor we cannot place in what we hold. Sealing anyway would publish a floor
        // nobody can reproduce, so refuse — the conservative direction is to hold more than
        // necessary rather than issue an unverifiable floor.
        return { ok: false, reason: "cannot-place-floor" };
      }
      if (!seg.events.length) return { ok: false, reason: "nothing-new" };

      const last = seg.events[seg.events.length - 1];
      const covers = CheckpointFormat.coversOf(seg.events[0].eventId, last.eventId);
      const seed = build(seg.events, seg.priorSeed);
      const floorL = (typeof last.l === "number") ? last.l : null;

      _seq += 1;
      const n = floor ? floor.n + 1 : _seq;
      const prev = floor ? floor.h : null;
      // AM I COMPUTING THIN? A client folding forward from a seed rather than from the room's
      // beginning. That is a fact about this checkpoint, so it travels with it — and it is
      // committed by the fingerprint, because an uncommitted mark could be stripped by anyone
      // relaying it. GRADE is the receiver's judgment and does NOT travel.
      // INJECTED, not reached for. "Have I trimmed?" is a fact about the client's own storage, which
      // this module has no business knowing how to find — and reaching for a transport global here
      // was the last place an unwired module could quietly answer from whatever was loaded.
      const thin = (typeof _env.thin === "function") ? !!_env.thin() : false;

      const h = CheckpointFormat.fingerprint(n, prev, seed, floorL, thin, covers);
      const cp = { t: TYPE, n: n, prev: prev, seed: seed, h: h,
                   covers: covers, floorL: floorL, thin: thin, by: _env.myUserId(), dv: 1 };

      // ── THE SEAL NAMES THE DEVICE AS WELL AS THE ACCOUNT ──────────────────────────────────
      // `by` is `myUserId()` — an ACCOUNT. So two tabs of one person sealing the same cut appear
      // in a log as "one peer sealed twice", which is indistinguishable from a defect and cost a
      // session to rule out: same `n` (both compute `floor.n + 1` from an unmoved floor), same
      // `prev`, different `floorL`. **Two honest peers sealing one cut is legitimate and
      // `checkpointformat.js` says so** — what was missing was any way to see that the two peers
      // were two devices rather than one client twice.
      //
      // DIAGNOSTIC ONLY, and it does not travel: the device is logged, never added to `cp`. A new
      // committed field re-fingerprints every checkpoint in every room (J17), and a device id is
      // nobody else's business.
      Logger && Logger.info && Logger.info("Checkpoint: sealing n=" + n + " floorL=" + floorL +
        " as " + _env.myUserId() +
        (typeof _env.myDeviceId === "function" ? " device=" + (_env.myDeviceId() || "?") : "") +
        " — two devices of one account seal independently and both are legitimate");
      await _env.send(TYPE, cp);

      _lastOwnSealAt = _env.now();
      _lastSealHead = _countable(log);
      // THE POSITION, which is what survives a trim. Written beside the count rather than instead
      // of it for one release, so a state persisted by this build is readable by the previous one.
      _sealedThroughL = _highestL(log);
      _sealedSinceArrival = true;

      // Trust our own seal at once, graded "real" — I folded it myself, which is the strongest
      // evidence there is. The old tree omitted the grade here entirely, so a client could never
      // resolve an eviction floor from a checkpoint IT SEALED, while a client that merely ADOPTED
      // the same one could. Exactly backwards. Asked through the policy rather than written as a
      // literal, so the rule keeps one home.
      if (typeof Floor !== "undefined" && Floor.adopt) {
        Floor.adopt({ floor: Object.assign({ u: _env.myUserId() }, cp), tier: null }, true);
      }
      return { ok: true, checkpoint: cp, mode: gate.mode };
    } catch (e) {
      return { ok: false, reason: "threw", detail: (e && e.message) || "unknown" };
    } finally { _sealing = false; }
  }

  // The events to seal, and the state to seal them onto. No floor means the genesis segment.
  function _segmentSince(floor, log) {
    if (!floor) return { events: log, priorSeed: undefined };
    const b = Floor.boundaryOf(floor, log);
    if (!b) return null;
    return { events: Floor.afterBoundary(log, b.l, b.id), priorSeed: floor.seed };
  }

  // ── THE SLOT ─────────────────────────────────────────────────────────────────────────────
  // Sealing takes turns like every other herd job, and the step is DELIBERATELY its own dial
  // rather than a share of the vouch jitter: this gap has a job the vouch ladder does not — it
  // has to outlast a homeserver round trip, or a peer wakes before the owner's seal has synced
  // back and seals redundantly on top of it.
  //
  // A SETTLE FLOOR EVEN FOR RANK ZERO. The slot decides ORDER, and the owner's is zero by design —
  // which left the owner with no observation window at all, and the owner is exactly who hit the
  // stale-seal bug. Derived from the room's own turn step rather than pinned.
  function slotSpec(extra) {
    const s = _env.settings() || {};
    const step = Dials.live(s, "vouchJitter");
    return Object.assign({
      rank: () => _env.myRank(),
      spacing: () => Dials.live(s, "checkpointRankOffsetMs"),
      minDelayMs: Math.floor(step / 2),
    }, extra || {});
  }

  // Plan a seal through the shared scheduler: slot, then re-check, then act. The re-check is where
  // the head comparison lives — if the log grew while we waited, the room moved under us and what
  // we were about to bank is already behind.
  function planSeal() {
    if (typeof Scheduler === "undefined") return { ok: false, reason: "no-scheduler" };
    const headAtPlan = _env.log().length;
    return Scheduler.plan("checkpoint:seal", slotSpec({
      stillNeeded: () => {
        if (_env.log().length !== headAtPlan) return false;      // the room moved while we waited
        return maySeal(_env.now()).ok;
      },
      run: () => { seal(); },
    }));
  }

  // ── ADOPTING A FLOOR RESETS THE CLOCK ────────────────────────────────────────────────────
  // The line that makes the cascade a cascade, without any coordination protocol:
  //
  //   the owner seals first (rank zero on the ladder)
  //   -> everyone adopts it as their floor
  //   -> everyone's cooldown resets
  //   -> nobody below is due for another full cooldown
  //   -> the owner alone seals, once per cooldown, for as long as it is present
  //
  // And the degradation needs NO CODE. When the owner leaves, nothing resets anyone's clock, it
  // simply runs out, and substitutes start sealing. "It degrades, it does not stall" falls out of
  // the ABSENCE of the reset rather than from a rule about who takes over.
  //
  // THE CLOCK RESETS OUTRIGHT. THE COUNTER MOVES TO THE FLOOR.
  //
  // The first version reset only the clock and left the counter alone, reasoning that a floor at
  // event 500 with the room at 900 leaves 400 events genuinely unbanked. That is true — and the
  // conclusion drawn from it was wrong. The counter's question is "how many events has NOBODY
  // banked", and adopting a floor answers part of it: everything at or below that floor IS banked
  // now, by whoever sealed it. Leaving the counter where my own last seal was counts those events
  // twice.
  //
  // Measured: with the counter untouched, juniors kept sealing on the count trigger even after
  // adopting the owner's floor, and the cascade never collapsed to one sealer.
  //
  // Moving it to the FLOOR rather than to the HEAD keeps the original point intact. A fresh floor
  // leaves nothing unbanked, so the junior is not due. A floor 400 events behind still shows 400
  // unbanked, so the junior IS due — and a busy room cannot coast on a stale floor, which is the
  // failure that reasoning was protecting against.
  // ADOPTION IS NOT A SEAL, and this must not arm the re-entrancy floor.
  //
  // It used to set `_lastOwnSealAt = now` — a device clock — on every Floor change. The intent was
  // the cascade: accepting a floor should quiet me. It does, but through the two DERIVED paths
  // above: the clock reads the floor's own timestamp, and the count reads how much of the log that
  // floor covers. Neither needs a local stamp. What the stamp actually did was declare, on every
  // page load, that I had just sealed — because adoption happens during replay — and refuse every
  // cadence tick for a full cooldown afterwards. Seen live: a room with three active users sat 2.5
  // days with the elapsed measurement reading 218487742 while the tick asked every five minutes.
  //
  // `_lastOwnSealAt` is still written by seal(), which is the only event that means what it says:
  // my own checkpoint is in flight and has not synced back. Local clock on both sides, seconds not
  // minutes, and correct to lose on reload.
  function noteAdopted(now, floorHead, floorPos) {
    if (typeof floorHead === "number" && floorHead > _lastSealHead) _lastSealHead = floorHead;
    // ADOPTION MOVES THE POSITION TOO. Adopting somebody's checkpoint banks everything it covers,
    // and the floor position is where that coverage ends — the same fact the count was reaching
    // for, expressed on a scale a trim cannot move.
    if (typeof floorPos === "number" && floorPos >= 0 &&
        (_sealedThroughL === null || floorPos > _sealedThroughL)) _sealedThroughL = floorPos;
    return { countedFrom: _lastSealHead, sealedThroughL: _sealedThroughL };
  }

  function noteArrival() { _sealedSinceArrival = false; }
  function reset() { _gapFirstSeenAt = 0; _seq = 0; _lastOwnSealAt = 0; _lastSealHead = 0; _sealedThroughL = null; _sealedSinceArrival = false; _sealing = false; }

  function _setStateForTest(s) {
    if (!s) return;
    if (typeof s.lastOwnSealAt === "number") _lastOwnSealAt = s.lastOwnSealAt;
    if (typeof s.lastSealHead === "number") _lastSealHead = s.lastSealHead;
    if (typeof s.sealedThroughL === "number") _sealedThroughL = s.sealedThroughL;
    if (typeof s.sealedSinceArrival === "boolean") _sealedSinceArrival = s.sealedSinceArrival;
  }

  return {
    TYPE, attach, build, buildImport, publishImport, maySeal, _countable, coverageVerdict, seal, planSeal, slotSpec,
    noteArrival, noteAdopted, reset, _segmentSince, _setStateForTest,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Checkpoint };
