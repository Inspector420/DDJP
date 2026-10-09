// backends/backend1/streammanager.js
// Single inbound entry point for all protocol events.
// Maintains ordered log, derives state, notifies subscribers.
// Depends on: StateDeriver, EventCache, Logger

const B1StreamManager = (() => {
  let eventLog = [];
  // How many events have been dropped from the DERIVED LOG for sitting below a banked boundary.
  // They are still held and still servable for repair — this counts only what the fold cannot
  // see, which is exactly what makes a "fold from the beginning" comparison meaningless.
  let _derivedLogTrimmed = 0;
  let derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
  let legalIds = null;              // eventId -> true; the reducer-accepted set (see isLegal)
  // ── J34: THE FORK TELL. A MEMORY, NOT A DIAL, AND IT IS PER-ROOM. ────────────────────
  // The ORDER branch below is STATELESS PER EVENT — it holds the arriving event and the
  // current `nowPlaying`, and nothing about the previous refusal. A lost race and a fork
  // produce the same single line, and what separates them is visible only ACROSS refusals:
  // the head not moving while different senders are refused against it. So the line cannot
  // say the true thing without remembering, and this is that memory. Softening the line
  // instead would make every refusal ambiguous, including the genuine lost races that are
  // the common case — strictly worse than saying nothing.
  // THERE IS DELIBERATELY NO THRESHOLD. Head unmoved since the last refusal plus a different
  // sender is derived from what already happened; a constant here would be one more number
  // somebody has to defend, in a tree where every dial is a decision.
  // DETECTION ONLY (`CONCEPTS.md` §3.4): both values are read by the log line and by nothing
  // else. They gate nothing and refuse nothing — `check-fork-notice` PART D pins that the
  // room derives byte-identically either side of the latch.
  let _lastStaleRefusal = null;     // { pi, sender } of the last stale-parent refusal
  let _forkSuspected = false;       // latched until an accepted advance, or a room change
  let _lastValidatedCp = null;   // signature of the last checkpoint we reached a CONCLUSIVE verdict on
  // Signature of the floor the current fold was derived under, so adoption can re-derive exactly
  // once per floor change rather than on every call (J47). Per-room, and cleared by `reset()` in the
  // same step as the boundary — a value surviving a room change would make the next room's first
  // adoption look like a no-op.
  // WHICH CHECKPOINT IS THIS — asked here four times, and three of those gate something irreversible
  // or expensive: the forget licence, the adoption re-derive, and the two validation records. The
  // answer belongs to `Floor`, which owns the floor, so it is READ rather than recomputed — built
  // independently in both modules it was the same expression twice, and a licence keyed on one shape
  // then compared against another is one edit away. Falls back only if Floor is absent, which is the
  // headless-fixture case; `null` then, so a missing floor never accidentally equals a record.
  // FALLING BACK TO `null` WOULD SILENTLY DISABLE EVERY CHECK KEYED ON THIS — the validation record
  // would never match a floor, so a sound seed would read `not-yet-run` forever and forgetting would
  // simply stop. Driven: written that way first, `check-seed-validation` went red naming exactly
  // that. A guard loading `streammanager` without `floor` is a legitimate fixture, so the fallback
  // computes the same answer rather than refusing to answer — one shape, stated twice, with the
  // second stated as a fallback rather than as a peer.
  const _sigOf = (f) => {
    try { if (typeof Floor !== "undefined" && Floor.sigOf) return Floor.sigOf(f); } catch (e) {}
    return f ? (f.n + ":" + (f.h || "")) : null;
  };
  let _lastFoldedFloor = null;
  // PRE-FORGET VALIDATION RECORD. This is the only evidence that the seeded path a client will
  // rely on AFTER forgetting is sound, and forgetting drops the log that makes the check possible
  // — so there is exactly one chance to run it, and "we saw no warning" must not be the signal.
  //   validated    — seeded fold reproduced the genesis queue at this cut. The ONLY state that
  //                  licenses dropping the pre-checkpoint log.
  //   mismatched   — it ran and disagreed. Conclusive: do not retry, do not forget.
  //   not-yet-run  — it did not conclude (threw, or the covered boundary could not be located).
  //                  NOT a pass. Retried on the next ingest, because the reason is usually
  //                  transient and the throttle key is deliberately left unset.
  let _seedValidation = { status: "not-yet-run", reason: "no-checkpoint", sig: null, at: 0 };
  function _recordValidation(status, reason, sig) {
    _seedValidation = { status: status, reason: reason || null, sig: sig || null, at: Date.now() };
    // THROTTLE ONLY ON A CONCLUSION. Marking the signature before the derive (as this used to do)
    // meant a throw recorded the checkpoint as checked and never retried it — a silent pass for
    // work that never happened, which is the failure signature this codebase is built around.
    if (status === "validated" || status === "mismatched") _lastValidatedCp = sig || null;
  }
  // Queryable, so callers ask a question instead of inferring one from the absence of a log line.
  function seedValidation() { return Object.assign({}, _licenceOverride || _seedValidation); }
  // The licensing predicate, kept separate from the record so the rule has ONE home. Detection is
  // not response (consensus-models §2): a mismatch is recorded, never acted on here. The eviction
  // path asks; nothing is distrusted behind anyone's back.
  function seedLicensesForget() {
    // Reads through seedValidation() so the guard seam reaches the PREDICATE and not only the report.
    // It did not, and the first version of the wiring guard passed on that: the forced "mismatch"
    // case was already failing for an unrelated reason, so it proved nothing.
    const v = seedValidation();
    if (v.status !== "validated") return false;
    // AND IT MUST BELONG TO THE FLOOR IT IS ABOUT TO BE SPENT ON. The record is keyed by checkpoint
    // signature and re-run inside `_deriveBest` — on a FOLD — while this predicate is read by
    // `trimToFloor` BEFORE any fold with a newly adopted floor:
    //     adopted -> _proveFloorSettings (does not fold) -> trimToFloor (reads this)
    //             ... trims ...        -> _refold (only now is the signature change noticed)
    // So the trim reached the licence carrying the PREVIOUS floor's verdict, putting the check that
    // gates an irreversible act immediately AFTER it, on evidence the trim had already destroyed.
    //
    // LATENT RATHER THAN LIVE BEFORE THIS, and worth knowing so nobody reads it as an exploit:
    // `_proveFloorSettings` re-proves the settings claim for the current floor just below, and
    // would have to pass on its own. That is a different gate doing this one's work.
    // `check-forget-licence-floor` isolates this half and drives it.
    //
    // THE TEST OVERRIDE IS EXEMPT: `_setLicenceForTest` says "assume validated" and its callers
    // plant no signature. The rule is about the record the module earns for itself.
    if (!_licenceOverride) {
      const f = _trustedFloor();
      const sig = _sigOf(f);
      if (!sig || v.sig !== sig) return false;
    }
    // AND the settings claim. These are two different assertions and the log proves only one of
    // them: the fold reproducing genesis says the QUEUE is right, and says nothing about whether
    // the settings blob in the seed is one the room ever authorised. Dropping the log below the
    // floor removes the evidence for both, so both have to be settled first.
    // Absent engine -> absent claim -> nothing extra to check. Anything short of an outright
    // "validated" withholds the licence: unverified and unverifiable are not permission.
    try {
      if (typeof SettingsProof === "undefined" || !SettingsProof.verdict) return true;
      return SettingsProof.licensesForget();
    } catch (e) { return false; }
  }
  const subscribers = {};

  // The events that CHANGE WHICH SONG IS PLAYING. Written out rather than inferred, because this
  // list decides only what gets reported and must never drift into deciding what gets folded.
  // The fold's refusal channel for the CURRENT log, recomputed lazily and cached per fold. Purely
  // DIAGNOSTIC: read for a log line and, since ddjp_455, for the Feed tab's refused lines through
  // `refusalOf` — displayed, never decided on. The bot engine inherits it: its ingest feeds this log.
  let _foldRefusals = null;   // the refusals of the fold that became the room's state
  // ONE SOURCE (owner's live log, `ddjp_537`): a refusal is read from the fold that IS the room — the same events, the same
  // seed. A seedless re-derive of a held log that starts at a floor refused its plays, so every vote on them read as
  // "a song the room doesn't know" and the answer was no. `tests/check-answer-after-floor.js` holds it.
  function _refusalFor(eventId) {
    try { return (_foldRefusals && _foldRefusals[String(eventId)]) || null; } catch (e) { return null; }
  }

  // Why the room refused this event: `{ code, detail, text }` in the reducer's own words, or null
  // when it was not refused (or the fold could not say). One reader of reasons, not a second.
  function refusalOf(eventId) {
    const r = _refusalFor(eventId);
    if (!r) return null;
    let text = null;
    try { text = StateDeriver.refusalText ? StateDeriver.refusalText(r.code, r.detail) : null; } catch (e) { text = null; }
    return { code: r.code, detail: r.detail || null, text: text || String(r.code || "refused") };
  }

  const _ADVANCE_TYPES = ["ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip"];

  // --- Lamport order ---
  function orderEvents(events) {
    return events.slice().sort((a, b) => {
      if (a.l !== b.l) return a.l - b.l;
      return a.eventId < b.eventId ? -1 : 1;
    });
  }

  // --- Validate incoming event minimally ---
  // ── AN EVENT MUST NOT BE INSERTED INTO SETTLED HISTORY ───────────────────────────────────
  // The head we have accepted, and the server time it carried. Not for ordering — `l` remains the
  // sort key — but so a claim about the past can be checked against a fact about the present.
  let _headL = null, _headTs = 0;
  // ── ONE HEAD PER ROOM, WHEN THE ENGINE ASKS (J70) ─────────────────────────────────────────
  // The head below is ONE across every room in scope, so the backdating verdict depends on which
  // room's events arrive first — and different clients replay rooms in different orders. Driven on
  // the owner's bot-501 log: the bot replayed `settings_owner` first, today's settings write (l=107,
  // stamped today) became the head, and yesterday's backdated members passed; the owner's app
  // replayed the events first and refused them. Same events, two rooms, two states.
  //
  // A room's own server order is the same for every client, so a head kept PER ROOM gives every
  // client one verdict. The bot engine turns this on: each of its rooms has exactly one writer (the
  // runner, the owner), so "claims the past" is only meaningful inside a room. Shared rooms keep
  // the one head — the same hazard exists across their rank channels, and changing it there trades
  // a protection for determinism, which is an open decision (`main/09-roadmap.md` J71), not a fix.
  let _doorPerRoom = false;
  const _roomHeads = new Map();   // room_id -> { l, ts }
  function setDoorScope(scope) {
    _doorPerRoom = (scope === "per-room");
    _roomHeads.clear();
    return _doorPerRoom ? "per-room" : "global";
  }
  function doorScope() { return _doorPerRoom ? "per-room" : "global"; }

  function validate(raw, l) {
    if (!raw.event_id) return "missing event_id";
    if (!raw.room_id) return "missing room_id";
    if (typeof l !== "number") return "missing or invalid l";

    // SAFE INTEGERS ONLY, AS EVERYWHERE ELSE. A fractional `l` sorts BETWEEN two existing events,
    // and the hash layer throws on one rather than rounding — a throw this path would swallow,
    // silently costing that event its protection. Rejecting is the same answer the rest of the
    // system already gives; accepting NaN or a fraction here was simply an omission.
    if (!Number.isSafeInteger(l)) return "l is not a safe integer: " + l;

    // ── THE ORDERING RULE ────────────────────────────────────────────────────────────────
    // `l` is self-reported. `origin_server_ts` is not — the homeserver stamps it and a client
    // cannot forge it. So an event may not claim a position in the past while the server says it
    // was minted AFTER the events already occupying that position.
    //
    // THIS IS NOT PRIMARILY AN ANTI-ATTACK RULE, which is why it belongs here rather than in a
    // security afterthought. A client that was briefly disconnected, saw up to l=50, and sends
    // l=51 into a room now at l=100 does the identical damage: its event sorts at position 51 and
    // retroactively changes everything derived after it. Inserting into settled history is the
    // hazard, and intent does not change it. So an occasional refusal of an honest-but-stale event
    // is correct rather than collateral: the sender's clock updates on receive, so a resend is
    // automatically well-formed.
    //
    // Measured before this existed: one uncategorized account posting an ordinary dj.join at l=0
    // changed which DJ was playing and which song, and split honest clients permanently — one
    // holding a floor refused it as already-banked while one without accepted it. This is the
    // already-banked rule generalised: below the floor we refuse because that region is settled;
    // here we refuse because the event is NEWER than what it claims to precede.
    //
    // Strictly newer, strictly older. At an equal timestamp the two facts do not contradict —
    // concurrent sends genuinely share a millisecond — and "cannot tell" is not a refusal.
    const ts = (typeof raw.ts === "number") ? raw.ts
             : (typeof raw.origin_server_ts === "number") ? raw.origin_server_ts : 0;
    const head = _doorPerRoom ? (_roomHeads.get(raw.room_id) || null)
                              : (_headL === null ? null : { l: _headL, ts: _headTs });
    if (head && l < head.l && ts > head.ts) {
      return "backdated: claims l=" + l + " (head is l=" + head.l + ") but was minted later";
    }
    return null;
  }

  // --- Ingest — called by MatrixBridge only ---
  // RAW -> REDUCER SHAPE, in one place. A raw Matrix event carries the protocol payload as JSON
  // inside content.body; the reducer needs it unpacked. Nothing enforced that boundary, and a
  // re-page that handed raws straight to the fold got a SILENTLY EMPTY state rather than an error —
  // buildSeed simply ignores every event it cannot read. Exported so the paging paths convert
  // through the same code the live path uses instead of keeping a second copy that can drift.
  function normalise(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.eventId && raw.content && typeof raw.content === "object" && raw.content.t) return raw;  // already reducer-shaped
    if (raw.type !== "m.room.message") return null;
    let parsed = null;
    try { parsed = JSON.parse(raw.content.body); } catch (e) { return null; }
    if (!parsed || !parsed.t || !String(parsed.t).startsWith("ddjp.")) return null;
    return {
      eventId: raw.event_id,
      type: parsed.t,
      content: parsed,
      l: typeof parsed.l === "number" ? parsed.l : 0,
      ts: raw.ts || raw.origin_server_ts || 0,
      roomId: raw.room_id,
      sender: raw.sender || null,
      senderRank: typeof raw.senderRank === "number" ? raw.senderRank : undefined,
    };
  }

  // EVERY protocol event one raw carries, as a list. A shared-room message carries one, so this is
  // `normalise` in a list; the bot engine's door overrides it, because one bot message can carry a
  // group of acts and `normalise` can only answer with the first (J64). Callers that convert held
  // or paged raws — song history above all — ask this, so neither engine needs a branch at the call.
  function normaliseAll(raw) {
    const n = normalise(raw);
    return n ? [n] : [];
  }

  function ingest(raw) {
    if (!raw || typeof raw !== "object") return;   // never crash on a null/garbage delivery
    const _n = normalise(raw);
    if (!_n) return;                                // not a ddjp protocol event
    if (raw.room_id) _roomsSeen.add(raw.room_id);   // this room's raws are the cache's to retire (J73)
    const protocolType = _n.type, protocolL = _n.l;   // `content` was destructured and never read

    const err = validate(raw, protocolL);
    if (err) {
      // NAMED AT THE DOOR, and loudly when it is an advance. An advance refused here never
      // reaches the fold at all, so the ORDER line below never prints for it — and the sender's
      // own client accepts it (its head is legitimately lower at that instant) while everyone
      // else does not. That asymmetry is the hardest failure in this system to read from the
      // outside, so it says which event, from whom, and against what head.
      const _adv = _ADVANCE_TYPES.indexOf(protocolType) >= 0;
      const _msg = "StreamManager: REFUSED AT THE DOOR " + protocolType + " id=" + raw.event_id +
        " from=" + (raw.sender || "?") + " — " + err;
      if (_adv) Logger.warn(_msg + " | this was an ADVANCE: the sender will believe the room moved " +
        "on and every other client will not");
      else Logger.warn(_msg);
      return;
    }

    // Deduplicate
    if (eventLog.some(e => e.eventId === raw.event_id)) return;

    // ALREADY BANKED. Once a floor accounts for a stretch, an event from inside it must not reach
    // the fold. Late arrivals below the boundary are routine, not exotic: back-pagination and a
    // cross-channel replay both deliver them, and in a live room this filled the log with pre-floor
    // events, re-added members the seed already had, and left a client on a song from the past with
    // an empty history. Whether a given event type survived that was luck — a join whose video is
    // already buffered dedupes and looks fine — and correct-by-accident is not correct.
    //
    // Compared on (l, event_id), the reducer's own sort key, for the same reason the seal path is:
    // two events can share a position, and the sibling that sorts AFTER the boundary at that position
    // is genuinely still needed. Waste nothing, miss nothing.
    //
    // ── THIS RETURN DROPS NOTHING. DO NOT ADD A STORE HERE ─────────────────────────────────────
    // The instinct on reading J03 is that ignoring an event loses it, so `StreamManager` should
    // keep a copy before refusing. It must not, and the reason is one line upstream: on EVERY path
    // that reaches this gate, `EventCache.store(raw)` has already run — it sits immediately above
    // `StreamManager.ingest(raw)` in `_ingestSpineEvent`. The two exceptions prove it rather than
    // break it: the redaction-restore path passes `ingest(orig)` deliberately WITHOUT re-storing
    // because the original is already cached, and `ddjp.voucher` is excluded by design and is
    // reducer-inert anyway.
    //
    // So KEEP is already satisfied, upstream, unconditionally. This return drops the event from the
    // DERIVED LOG only; the client still holds the bytes and is still a repair source for anybody
    // asking. A store here would be a second answer to "who holds the bytes", which is the class of
    // defect this project spends its sessions deleting — and J03's own plan asserted the opposite
    // as a settled premise, which is how it survived two readings. Written here because the next
    // reader will have the same instinct.
    // An adopted save point judges a SETTINGS arrival by the change it names, not by position (J67).
    const _adoptedSettings = !!(_adopted && protocolType === "ddjp.room.settings");
    if (_adoptedSettings && _settingsCovered(_adopted, { eventId: raw.event_id, l: protocolL, type: protocolType })) {
      _derivedLogTrimmed++;       // dropped from the derived log: the genesis comparison must know
      Logger.debug("StreamManager: ignoring ddjp.room.settings " + raw.event_id + " — covered by the adopted save point");
      return;
    }
    const _bank = _bankedArrival(protocolL, raw.event_id, _adoptedSettings);
    if (_bank) {
      // THE GENESIS FOLD IS NOW INCOMPLETE, AND THE DIVERGENCE CHECK HAS TO KNOW. This return
      // drops the event from the DERIVED LOG, so a fold "from the beginning" can no longer see
      // it. Below an accepted boundary that routinely means the room's FIRST `ddjp.dj.play` and
      // the `ddjp.dj.join`s that filled the queue it pops from — so the genesis fold reaches
      // `nowPlaying = null` BY CONSTRUCTION, and comparing that against a floor which banked a
      // real `pi` reports a disagreement that is an artefact of the trim rather than a fault.
      //
      // REPORTED FROM A LIVE ROOM: the warning fired on EVERY ingest, on both clients, in a room
      // whose owner had authored every event and whose history reached the beginning — while
      // telling them "This client is missing an event below the cut". It was false on the one
      // client that could not possibly be missing anything.
      _derivedLogTrimmed++;
      Logger.debug("StreamManager: ignoring " + protocolType + " l=" +
        ((typeof protocolL === "number") ? protocolL : 0) + " — already banked below the " +
        _bank.kind + " boundary at l=" + _bank.at +
        (_bank.kind === "accepted" ? " (held, and still servable for repair)" : ""));
      if (_bank.kind === "trimmed") _bankedLate();   // below what this device FORGOT: the raw cache's copy may go too (ddjp_566)
      // A SAVE POINT STILL REACHES `Floor` (`ddjp_571`, the design round's M1). Where a save point is carried in the log
      // used not to matter here: its cut sits below its own event, so one banked by position could never improve on the
      // floor. Since restarts it can — the owner's restore, carried below the cut of a seal the bot made on the old room
      // and delivered first, is a LATER RESTART and must replace it. So it is handed to its subscribers (the bridge's
      // arrival handler, which hands it to `Floor`); only the derived log drops it, as before.
      if (protocolType === "ddjp.checkpoint") notify(_n);
      return;
    }

    const entry = _n;

    // Recovery TRANSPORT (ddjp.voucher) is ephemeral coordination, not
    // durable Spine: notify subscribers (so the recovery handlers fire) but do NOT persist it
    // to the eventLog or re-derive over it — otherwise it would bloat getLog() and every
    // witness scan. It's reducer-inert anyway (proven by check-reducer-ignore), so skipping the
    // derive is behaviour-preserving; this just also keeps it out of the durable log.
    if (protocolType === "ddjp.voucher") {
      notify(entry);
      return;
    }

    eventLog.push(entry);

    // THE HEAD MOVES ONLY ON AN EVENT THAT ENTERED THE LOG. Updated here rather than in validate
    // so a refused, duplicated, banked or transport-only event cannot advance the reference the
    // next event will be judged against. Tracked as a pair because either one alone proves
    // nothing: a high `l` is a claim, a late `ts` is a fact, and it is the contradiction between
    // them that identifies a backdate.
    if (_headL === null || entry.l > _headL) { _headL = entry.l; _headTs = entry.ts || 0; }
    if (raw && raw.room_id) {
      const rh = _roomHeads.get(raw.room_id);
      if (!rh || entry.l > rh.l) _roomHeads.set(raw.room_id, { l: entry.l, ts: entry.ts || 0 });
    }

    // Re-derive. Prefer the trusted-checkpoint seed when one exists (the trust-ladder /
    // forget path, Phase 11): derive from the strongest recompute-verified checkpoint seed +
    // the events after it, instead of always replaying from genesis. This is what lets a
    // client bank a checkpoint and stop needing the pre-checkpoint log, and it's the failsafe
    // when pre-checkpoint events are missing. SAFETY: when we still hold the full log, the
    // seeded result MUST equal the genesis result (the seed is recompute-verified) — so
    // _deriveBest cross-checks and falls back to genesis on any mismatch, never trusting a
    // seed that would diverge. All derivation is pure; the seed never sets state by assertion.
    // The fold, and with it the LEGAL set — the reducer-accepted ids the vouch layer selects from,
    // so protection is only ever spent on events the reducer actually took. Both come from _refold
    // now: they were written out here, which is why trimming had no way to redo the fold without
    // duplicating it.
    _refold();

    // ── THE ORDERING VERDICT, FOR THE EVENTS THAT MOVE THE ROOM ──────────────────────────────
    // The reducer decides whether an advance is legal, silently and identically on every client.
    // From outside, "my skip did nothing" and "my skip was correctly refused because it named a
    // parent that is no longer the head" look the same — and the second is the ordinary outcome
    // of losing a race. Nothing in the log told them apart, which is why a refused advance read
    // as a broken app.
    //
    // Said HERE because this is the only place that knows both facts at once: the event as it
    // arrived, and whether the fold that just ran accepted it. Reported for every client alike,
    // so a room-wide refusal (a gate nobody can pass) is distinguishable from one client's event
    // being dropped — the two need completely different answers from whoever is testing.
    if (_ADVANCE_TYPES.indexOf(entry.type) >= 0) {
      const took = isLegal(entry.eventId);
      const np = derivedState.nowPlaying;
      let why = "";
      if (!took) {
        const adv = derivedState.advance;
        const ts = entry.ts || 0;
        if (adv && typeof adv.earliestAt === "number" && ts > 0 && ts < adv.earliestAt) {
          why = " — TOO EARLY: the gate opens " + Math.round((adv.earliestAt - ts) / 1000) +
            "s later, because the room's agreed length for this song is " +
            (adv.gateLenSec != null ? adv.gateLenSec + "s" : "unset") +
            ". Every client refuses this identically";
        } else if (np && entry.content && entry.content.p !== np.pi) {
          // ── J34: IS THIS A LOST RACE, OR HAS THIS CLIENT FORKED? ───────────────────
          // A LOST RACE IS ONE REFUSAL: somebody got there first, the head MOVED, and the
          // next advance lands. A FORK is every refusal, forever, from every sender, with
          // the head frozen. This line used to reassure the reader through all of it — the
          // second failure signature (a message that names an action it does not take)
          // reached from the other side, because the reassurance is what stops anybody
          // looking. Driven in a live room: three refusals, three senders, one frozen `pi`.
          //
          // THE SAME SENDER REFUSED TWICE IS NOT THE TELL, and that is deliberate: a client
          // retrying its own stale play says nothing about whether WE have diverged. Two
          // different senders failing against one unmoved head is the thing no single
          // refusal can show.
          const who = entry.sender || "?";
          if (_lastStaleRefusal && _lastStaleRefusal.pi === np.pi &&
              _lastStaleRefusal.sender !== who) {
            _forkSuspected = true;
          }
          _lastStaleRefusal = { pi: np.pi, sender: who };
          why = " — stale parent: it names " + (entry.content.p || "null") + " but the head is " +
            np.pi + (_forkSuspected
              ? ". THE HEAD HAS NOT MOVED across refusals from different senders, so this " +
                "client MAY HAVE DIVERGED rather than lost a race. Re-folding cannot repair " +
                "it — a diverged client's own arithmetic is the thing that is wrong, so " +
                "recomputing only reproduces it, and the single exit is adopting somebody " +
                "else's checkpoint, which needs an owner or a quorum (CONCEPTS.md Part 6 §16)"
              : ". A lost race, not a fault");
        } else {
          // ── ITEM 4 IS A DIAGNOSTIC BLOCKER, NOT A UX COMPLAINT ────────────────────────────
          // Naming three causes and identifying none is what stopped THIS investigation: a play
          // was refused, and establishing whether the genesis race was real required knowing
          // WHICH condition fired. It could not be read from the log or the tree, and the
          // diagnosis had to be reconstructed by driving the reducer directly.
          //
          // Left as it is HERE because splitting it means reaching into the fold for the condition
          // that decided, which is a change to the reducer's reporting rather than to this
          // message — scoped as item 4 and not taken in this job. **Recorded so the next reader
          // knows the cost is diagnostic and not cosmetic.**
          // ── THE FOLD NOW SAYS WHICH RULE REFUSED ────────────────────────────────────────
          // This read "the fold did not accept it (rank gate, empty rotation, or no road met)" —
          // three possibilities wearing an explanation's clothes. **It printed that because
          // nothing upstream kept a reason**: every `_rej(ev)` recorded THAT an event was refused
          // and never WHY, so `derive()` returned a rejected set carrying no reasons and no
          // message downstream could name a condition. The fix was in the reducer's reporting,
          // not in this string.
          //
          // The code and its deciding values are read from the fold's own refusal channel, which
          // rides beside state and never inside it — nothing here can move a fingerprint.
          const rf = _refusalFor(entry.eventId);
          why = rf
            ? " — " + rf.code + (rf.detail ? " " + JSON.stringify(rf.detail) : "")
            : " — refused by the fold, and it did not say which rule. That is a defect in the " +
              "reducer's reporting rather than a fact about this event";
        }
      } else {
        // ── J34: AN ACCEPTED ADVANCE CLEARS THE FORK MEMORY. ───────────────────────
        // One line, and it is what keeps a genuine lost race reading as one: the room
        // demonstrably MOVED, so the head is not frozen and no refusal before this is
        // evidence of anything. Without it, any busy room eventually pairs two unrelated
        // refusals from two senders and accuses itself of a fork it does not have.
        _lastStaleRefusal = null;
        _forkSuspected = false;
      }
      // ── "ACCEPTED" HERE IS A VERDICT AT INGEST, NOT A FINAL ONE ───────────────────────────
      // This line is printed as each event arrives. `l` is the sort key, so an event that arrives
      // LATER but sorts EARLIER re-orders the fold and can change a verdict already printed —
      // and no second line is ever emitted. **A log showing two ACCEPTED plays can therefore
      // describe a room that accepted one.**
      //
      // DRIVEN, both arrival orders, two `p=null` plays 165ms apart from different senders:
      //
      //     ingested A then B -> A legal, B REFUSED, history 1, head $pA
      //     ingested B then A -> A legal, B REFUSED, history 1, head $pA
      //
      // **The clients converge, the race is closed, and the second play is refused as a stale
      // parent** — because the rule compares the play's `p` against the CURRENT HEAD, not against
      // the other play's parent, so once `$pA` is the head a `p=null` play names something that is
      // not it. Genesis is not a hole; the stale-parent rule covers it by the same comparison it
      // uses everywhere else.
      //
      // What was misleading was this line's tense. The verdict is stamped `finalAtIngest` so a
      // reader knows it can be superseded, rather than inferring a defect from two ACCEPTEDs that
      // describe one accepted play.
      Logger.info("StreamManager: ORDER " + entry.type +
        " l=" + entry.l + " id=" + entry.eventId +
        " p=" + ((entry.content && entry.content.p) || "null") +
        " ts=" + (entry.ts || 0) + " by=" + (entry.sender || "?") + " finalAtIngest" +
        " -> " + (took ? "ACCEPTED" : "REFUSED") + why +
        " | now playing " + (np && np.song ? np.song.videoId : "nothing") +
        " pi=" + (np ? np.pi : "-"));
    }

    Logger.debug("StreamManager: ingested " + entry.type +
      " l=" + entry.l +
      " id=" + entry.eventId +
      " p=" + (entry.content && entry.content.p !== undefined ? entry.content.p : "-") +
      " rotation=" + derivedState.rotation.length +
      " pi=" + (derivedState.nowPlaying ? derivedState.nowPlaying.pi : "-") +
      " playing=" + (derivedState.nowPlaying && derivedState.nowPlaying.song ? derivedState.nowPlaying.song.videoId : "none"));

    // THE PHASE MACHINE SEES EVERY EVENT. Only matters while catching up, where it keeps the
    // settle window open for as long as the burst continues — which is what stops a client that is
    // still draining a backlog from acting as though it knows the present.
    try { if (typeof Session !== "undefined" && Session.sawEvent) Session.sawEvent(); } catch (e) {}

    // Notify subscribers
    notify(entry);
  }

  // --- Notify subscribers for this event type + wildcard ---
  function notify(entry) {
    const handlers = [
      ...(subscribers[entry.type] || []),
      ...(subscribers["*"] || [])
    ];
    for (const fn of handlers) {
      try { fn(entry); }
      catch (e) { Logger.warn("StreamManager: subscriber error for " + entry.type + ": " + e.message); }
    }
  }

  // --- Subscription ---
  function on(type, fn) {
    if (!subscribers[type]) subscribers[type] = [];
    subscribers[type].push(fn);
  }

  function off(type, fn) {
    if (!subscribers[type]) return;
    subscribers[type] = subscribers[type].filter(f => f !== fn);
  }

  // --- State access ---
  function getState() { return derivedState; }
  function getLog() { return orderEvents(eventLog); }

  // ── WHEN EACH CURRENT MEMBER ENTERED THE ROTATION ─────────────────────────────────────────
  // For the AFK rule. Pressing Join sends nothing of its own: the app sets a local flag and kicks
  // its reconcile loop, which submits songs — and a submit is a join carrying a video, which is
  // deliberately not counted as activity because the same loop fires it unprompted as a buffer
  // tops up. So the one thing a person definitely DID is invisible to a classifier that reads
  // types, and somebody was warned twenty seconds after joining.
  //
  // WHAT DISTINGUISHES THEM IS WHETHER THE JOIN BROUGHT THEM IN, which only the fold knows. This
  // replays with `StateDeriver` ITSELF rather than a second copy of the membership rules — a copy
  // would drift the first time fall-out changed, and fall-out is the subtle half.
  //
  // IT LIVES HERE BECAUSE THE FOLD DOES. `features/` may reach the backend only through this
  // module and `MatrixBridge` (check-boundaries rule F), and the bot asking `StateDeriver`
  // directly was caught by that guard on the first run. The rule is right: a feature that folds
  // for itself is a second reducer.
  //
  // NOT DERIVED STATE, AND DELIBERATELY NOT SEALED. It is one client's reading of a log whose
  // reach is bounded, so two clients holding different amounts of history get different answers —
  // which is exactly why it must never enter the seed. Putting the same fact on the rotation
  // projection was tried and reverted: five guards caught a genesis fold disagreeing with a seeded
  // one, which is two clients disagreeing about who is idle.
  //
  // Cost, measured: 563ms on a 960-event log, 17ms on a 60-event one, once at startup. Only the
  // events that can move the rotation are re-derived at; the rest are skipped without a fold.
  const AFFECTS_ROTATION = {
    "ddjp.dj.join": 1, "ddjp.dj.leave": 1, "ddjp.dj.remove": 1, "ddjp.dj.reset": 1,
    "ddjp.dj.play": 1, "ddjp.dj.undeclare": 1, "ddjp.dj.strike": 1,
  };
  function rotationEntries() {
    const out = {};
    const log = orderEvents(eventLog);
    if (!Array.isArray(log) || !log.length) return out;
    let prev = [];
    const has = (arr, u) => arr.indexOf(u) >= 0;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (!e || !AFFECTS_ROTATION[e.type]) continue;
      let st = null;
      // TOTAL, AND SILENT PER EVENT. One unreadable event costs one event's worth of precision,
      // never the whole replay — a throw here used to be the difference between "we know when
      // everybody joined" and "we know nothing".
      // From the seed the held log folds from (owner's live log, `ddjp_537`): seedless, a held log that starts at a floor
      // lost every member the seed carried, so their entry times went missing.
      try { st = StateDeriver.derive(log.slice(0, i + 1), _heldBase); } catch (err) { continue; }
      const now = [];
      if (st && Array.isArray(st.rotation)) {
        for (const m of st.rotation) { if (m && typeof m.user === "string") now.push(m.user); }
      }
      const ts = (typeof e.ts === "number" && isFinite(e.ts)) ? e.ts : null;
      if (ts !== null) { for (const u of now) { if (!has(prev, u)) out[u] = ts; } }
      // A departure FORGETS its entry, so somebody who leaves and comes back gets a new time
      // rather than an old one that would read as far more idle than they are.
      for (const u of prev) { if (!has(now, u)) delete out[u]; }
      prev = now;
    }
    return out;
  }

  // Derive the best available state (Phase 11 — trust-ladder / forget path). Strategy:
  //   1. If no trusted checkpoint is reachable → derive from genesis (today's behavior).
  //   2. If a trusted checkpoint exists → derive from ITS SEED plus the events after it.
  //      When we STILL HOLD the full log, cross-check the seeded result against the genesis
  //      result: they MUST match (the seed is recompute-verified), so a mismatch means a bad
  //      seed and we fall back to genesis — the seed can never make state diverge. Once a
  //      client forgets the pre-checkpoint log, only the seeded path remains, which is exactly
  //      what "forget before an owner checkpoint" means; it's safe because the seed is proven.
  //   3. Rank only decides WHICH checkpoint we prefer (Floor already keeps the highest
  //      trusted n); recompute decides truth. Nothing trustable → honest genesis derive.
  // Pure: no clock, no storage. Floor is a backend peer (same layer), so consulting it
  // here does not cross the app boundary.
  // ── THE SECOND MEMORY ────────────────────────────────────────────────────────────────────────
  // EventCache has always been bounded — 200 MB, three tiers. This log never was: it is re-sorted
  // and re-folded on every ingest and cleared only on room change, so a long-lived room re-derives
  // its whole history dozens of times a minute and holds all of it. "Hold everything since my floor"
  // has to mean both memories, not the cache alone.
  //
  // GATED ON THE GRADE, and not by a new rule — by the one that already decides forgetting. Trimming
  // below a floor is exactly forgetting, so `earnsForget` governs it: "real" (I computed it),
  // "verified" (an owner floor) AND "quorum" (a substitute the room agreed on) all qualify.
  //
  // Quorum was promoted when substitutes landed, and this comment said it "does not" for a while
  // after that was no longer true — a stale narrative sitting on the function that decides what
  // gets forgotten. The hazard it warned about is real and IS handled, just elsewhere:
  // `Floor.revalidate` demotes a withdrawn quorum floor to "stale" rather than withdrawing it when
  // the client has already trimmed, so nobody is left unable to re-derive.
  //
  // ── THE GRADE SETS ARE NOT DISJOINT, AND HAVE NOT BEEN SINCE SUBSTITUTES LANDED ─────────────
  // This block used to end by saying the two features coexist "only because their grade sets are
  // DISJOINT", that STEP 12 would break that, and that check-derived-log-bound PART C pinned the
  // disjointness. All three were wrong at once: `quorum` earns forgetting (four paragraphs up says
  // so) and is exactly the grade re-validation re-checks, so the sets are IDENTICAL where it
  // matters — and PART C's own body says it stopped guarding disjointness on purpose and now
  // guards that the overlap has ONE answer instead of two. The guard was updated; this was not.
  //
  // THE LESSON, WORTH MORE THAN THE CORRECTION: the paragraph immediately above warns about a
  // stale narrative sitting on the function that decides what gets forgotten, and then the next
  // paragraph was one. PROXIMITY DOES NOT PROTECT. A correct sentence three inches away does not
  // correct a wrong one, a comment fixed once is not thereafter immune, and two wrong sources
  // agreeing with each other reads as corroboration — a session cross-checking this file against
  // that guard's HEADER summary got confirmation, and only PART C's body broke the tie.
  //
  // What actually makes the overlap safe is one joint answer, and it exists: `Floor.revalidate`
  // demotes a weakened quorum floor to "stale" instead of withdrawing it when the client has
  // already trimmed, so nobody is ever left unable to re-derive.
  let _trimmedBelow = null;        // the floorL we have trimmed to, or null while we hold everything
  let _trimmedBoundaryId = null;   // and the id AT that position, for the (l, event_id) tiebreak

  // ── THE BOUNDARY MAY ONLY RISE WITHIN A ROOM ────────────────────────────────────────────────
  // `_trimmedBelow` means "everything at or below this is gone from my derived log". That is a
  // record of something that ALREADY HAPPENED, and you cannot un-delete: lowering it is not a
  // policy change, it is a false statement, because the client then claims to hold what it
  // destroyed. It is the rule `Floor.adopt` already applies to the floor (`_pos(f) <=
  // _pos(_trusted)` refuses a non-improvement), applied to the boundary.
  //
  // Lowering it did two separate kinds of damage, and this closes both with no second rule:
  //   · the seed/holdings pairing below became expressible — while the boundary followed the floor
  //     down, `f.floorL >= _trimmedBelow` held WHILE THE ROOM WAS BROKEN, so comparing the two
  //     numbers proved nothing;
  //   · the banked-arrival gate in `ingest` keys on this value, so lowering it re-opened the door
  //     for events below the old cut and the client folded again what a checkpoint had already
  //     banked. Driven: an arrival at l=7 with the old cut at 14, ingested a second time.
  //
  // THE ID IS THE POSITION'S PARTNER AND MOVES WITH IT OR NOT AT ALL. A boundary at one position
  // carrying an id from another is worse than either alone, because the (l, event_id) tiebreak in
  // the ingest gate would then compare across two different cuts. Assigning both here is what
  // makes that structural rather than remembered.
  function _raiseBoundary(l, id) {
    if (typeof l !== "number") return false;
    if (_trimmedBelow !== null && l <= _trimmedBelow) return false;
    _trimmedBelow = l;
    _trimmedBoundaryId = id;
    return true;
  }

  // ── THE SECOND BOUNDARY: ACCEPTED, NOT DELETED ──────────────────────────────────────────────
  // J03. The rule above answers "what have I destroyed". This one answers "what does the floor I
  // currently trust already account for". They are different questions and the difference is the
  // whole job: trimming needs the full forget licence, so a client that has ADOPTED a floor and is
  // not yet licensed to forget sat with no boundary at all and folded arrivals from inside the
  // banked stretch.
  //
  // WHY THIS IS NOT A MOVED TRIGGER. `_trimmedBelow !== null` is the sole answer to two questions
  // that are not this one, and re-pointing it would have silently changed both:
  //   · `Floor._env.trimmed()` decides WITHDRAW vs DEMOTE-TO-STALE in `_weakened`. A client that
  //     adopted but never trimmed can still safely fall back to folding what it holds, so it must
  //     withdraw; demoting it instead costs it the only recovery it has.
  //   · `thin` on a SEALED CHECKPOINT BODY, and `thin` is inside the fingerprint —
  //     `fingerprint(n, prev, seed, floorL, thin, covers)` commits it and `bodyMatchesH` re-derives
  //     it. A client that adopted while still holding genesis would have published `thin: true`:
  //     a false statement in a hashed field, in the format Phase 6 is about to freeze.
  //
  // WHY IT IS DERIVED AND NOT STORED. `Floor.current()` is already the one home for which floor we
  // trust. A stored copy would be a second answer to that question, free to drift from it — and the
  // release below would then be a rule somebody has to remember rather than a consequence.
  //
  // ── AND ITS MONOTONICITY IS THE OPPOSITE OF THE ONE ABOVE, ON PURPOSE ───────────────────────
  // `_trimmedBelow` may only RISE, and J02 reasoned that from destruction: you cannot un-delete, so
  // lowering it is not a policy change but a false statement. That argument is about the past and
  // does not transfer. An accepted boundary is a statement of BELIEF, and belief is retractable —
  // when a floor is withdrawn the client falls back to folding what it holds, and those arrivals
  // must become admissible again or the fallback is not one. Reading it live IS the retraction.
  //
  // Same shape, opposite rule, for a stated reason. Both are written here so the next reader does
  // not "fix" the inconsistency; `floor.js` carries the other half beside `_pos`.
  function _acceptedBoundary() {
    const t = _trustedFloor();
    if (!t || typeof t.floorL !== "number") return null;
    return { l: t.floorL, id: (typeof t.covers === "string") ? String(t.covers).split("..")[1] : null };
  }

  // Is this arrival inside a stretch some boundary already accounts for? Returns which boundary,
  // because the two are not the same answer even where the action is: below the TRIMMED boundary
  // the client is committed and the bytes may be gone, while below the ACCEPTED one it still holds
  // everything and is merely declining to fold it. Reported so a log line can tell them apart, and
  // so a guard can assert WHICH rule fired rather than only that something did.
  function _bankedArrival(l, rawId, judgedBySettings) {
    if (judgedBySettings) return null;   // an adopted save point already judged this settings arrival (J67)
    const el = (typeof l === "number") ? l : 0;
    const at = (b, bid) => (el < b) || (el === b && (!bid || String(rawId) <= String(bid)));
    if (_trimmedBelow !== null && at(_trimmedBelow, _trimmedBoundaryId)) {
      return { kind: "trimmed", at: _trimmedBelow };
    }
    const acc = _acceptedBoundary();
    if (acc && at(acc.l, acc.id)) {
      // RECORDED HERE because this is the refusal — anywhere else would be inferring it. Keyed on
      // the boundary, so the record describes ONE situation rather than accumulating over the life
      // of the room: a boundary that moves starts a fresh answer.
      if (!_ignoredArrivals || _ignoredArrivals.at !== acc.l) {
        _ignoredArrivals = { at: acc.l, count: 0, ids: [] };
      }
      if (rawId && _ignoredArrivals.ids.indexOf(rawId) < 0) {
        _ignoredArrivals.ids.push(rawId);
        _ignoredArrivals.count = _ignoredArrivals.ids.length;
      }
      return { kind: "accepted", at: acc.l };
    }
    return null;
  }
  // ── ONE FLOOR, ONE HOME ──────────────────────────────────────────────────────────────────
  // This used to consult a StreamManager-local floor override first, set by a guard seam of its
  // own. That made the floor answerable from TWO places, and the two disagreed in exactly the way
  // that matters: trimToFloor read the override, while the seed-validation block below reads
  // Floor.current() directly. A guard that set only the local override therefore exercised
  // trimming with validation permanently stuck at "no-checkpoint" — which is why the trim guard
  // had to force the licence, and part of why nobody could see that forgetting never ran.
  //
  // There is now one accessor. A guard sets the floor through Floor's own seam, which is the same
  // state production reads, so a guard cannot be green on a floor production would not have.
  // ── A FLOOR THE ENGINE ADOPTS (J67) ──────────────────────────────────────────────────────────
  // A bot room opens from the bot's newest save point instead of the room's start: the bot is the
  // room's authority, trusted for every relay, so its save point is trusted the same way. Shared
  // rooms never call `adoptFloor`, and their floor stays `Floor.current()`.
  //
  // WHAT A SAVE POINT COVERS. Events at or before its position are folded into its seed — except
  // SETTINGS, which take their position from the owner's clock and can be numbered before the save
  // point yet minted after it. By the owner's ruling a settings change is judged against the change
  // the seed names (`seed.settingsFrom`): at or before it, covered; after it, applied on top.
  let _adopted = null;
  // ── AT OR BEFORE THE BOUNDARY: POSITION, THEN ID (J73) ───────────────────────────────────────
  // The plain rule both settings fallbacks below used was `el <= f.floorL` — position alone — so a
  // settings event sharing the save point's position and sorting AFTER its boundary read as covered
  // and was dropped, though the seed never folded it. `check-trim-boundary` PART D drives both.
  function _atOrBeforeBoundary(f, e) {
    const el = (e && typeof e.l === "number") ? e.l : 0;
    const bid = (typeof f.covers === "string") ? String(f.covers).split("..")[1] : null;
    return el < f.floorL || (el === f.floorL && (!bid || String(e.eventId) <= String(bid)));
  }
  function _settingsCovered(f, e) {
    const el = (typeof e.l === "number") ? e.l : 0;
    const sf = f.seed && f.seed.settingsFrom;
    if (!sf) return _atOrBeforeBoundary(f, e);
    if (e.eventId === sf) { f._sfPos = { l: el, id: e.eventId }; return true; }
    const pos = f._sfPos;
    if (!pos) return _atOrBeforeBoundary(f, e);      // the named change not seen yet: the plain rule
    return el < pos.l || (el === pos.l && String(e.eventId) <= String(pos.id));
  }
  function _coveredBy(f, e) {
    if (e && e.type === "ddjp.room.settings") return _settingsCovered(f, e);
    return _atOrBeforeBoundary(f, e);
  }
  // ── AN OWNER RESTORE IS ADOPTED AS AN ORIGIN (J79) ────────────────────────────────────────────
  // `opts.origin`: the engine has established that this save point is the room's owner restore —
  // an origin pair (`prev` null, `thin`), carried by a sender above the ladder, whose fingerprint
  // verifies and whose seed is a real starting state (`backend2/streammanager.js` `_replaceWith`) —
  // or, since `ddjp_571`, a save point of a LATER RESTART built on one this device never read.
  // It REPLACES the room rather than summarising what is held, so it is not asked to reproduce it
  // (`prove`), and it is adopted at the same position as the floor it replaces — and, in the one
  // race the docs record, below it. THIS IS NOT A NEW EXCEPTION TO "FORGET ONLY UNDER A SAVE POINT
  // THAT PROVES ITSELF": it is the origin-seed exception decentralized rooms already take
  // (`_recordOriginVerdict`, `validated / origin-seed`) — forgetting below an origin's cut cannot
  // change derived state, because the fold starts above that cut — and it is recorded the same way.
  function adoptFloor(f, opts) {
    if (!f || typeof f.floorL !== "number" || !f.seed ||
        typeof StateDeriver === "undefined" || !StateDeriver.isSeed || !StateDeriver.isSeed(f.seed)) {
      return { ok: false, reason: "not-a-starting-state" };
    }
    const _asOrigin = !!(opts && opts.origin === true);
    // ── THE FOLD NEVER STEPS BACK A RESTART (owner's ruling, `ddjp_571`) ────────────────────────────
    // Each save point comes with its restart (`era`, and its `root`: where that era's restore sits).
    // One from an EARLIER restart than the floor this fold stands on is refused, whatever the engine
    // above hands it — a seal the bot made on the old floor, an older restore. A REPLACEMENT
    // (`opts.origin`: the owner's restore, or a save point built on one this device never read) must
    // be of a LATER restart: the same restore again is not one. It is not asked `not-newer` (its cut
    // may sit below the floor it replaces) nor to reproduce what is held: it replaces the room.
    if (_adopted && typeof CheckpointFormat !== "undefined") {
      const _c = CheckpointFormat.compareRestart({ era: f.era, root: f.root }, { era: _adopted.era, root: _adopted.root });
      if (_c < 0) return { ok: false, reason: "earlier-restart" };
      if (_asOrigin && _c === 0) return { ok: false, reason: "not-a-later-restart" };
    }
    if (_adopted && !_asOrigin && f.floorL <= _adopted.floorL) return { ok: false, reason: "not-newer" };
    const fl = Object.assign({}, f, { grade: "real" });
    if (typeof fl.covers === "string" && fl.covers.indexOf("..") < 0) fl.covers = ".." + fl.covers;
    const sf = fl.seed.settingsFrom;
    for (const e of eventLog) {
      if (sf && e && e.type === "ddjp.room.settings" && e.eventId === sf) fl._sfPos = { l: e.l, id: e.eventId };
    }
    // PROVE BEFORE DROPPING (J73 job 7, Q6). Moving on, the held log runs from the last save point's
    // seed up to this one's cut, so whether this seed reproduces it can be checked — across every
    // derived field a drop could change, not only the three `_deriveBest`'s validation compares.
    // Asked by the engine (`opts.prove`); a seed that does not reproduce is refused and nothing goes.
    if (opts && opts.prove && !_asOrigin) {
      const _p = reproduces(fl);
      if (!_p.ok) return { ok: false, reason: "does-not-reproduce", field: _p.field || null, detail: _p.reason || null };
    }
    // The floor this one replaces: what it dropped is declared to history from just ABOVE it, so a save point's own
    // position (it sits between the cuts, and folds into no row) is covered rather than left as a hole (owner's test).
    const _prevCut = (_adopted && typeof _adopted.floorL === "number") ? _adopted.floorL : null;
    _adopted = fl;
    const before = eventLog.length;
    // TAKE BEFORE DROPPING (J73 job 2). What this save point covers leaves the held log, so its
    // activity is taken first, into the one module. The ENGINE says how legality is judged: a bot
    // room passes `take: "all"` — its judge refuses what the reducer would, so every relayed act
    // was accepted (Q3) — and this fold, which has not seen the room's start, is not asked.
    if (opts && opts.take && typeof Activity !== "undefined") {
      const _drop = eventLog.filter((e) => _coveredBy(fl, e)), _legal = opts.take === "all" ? null : _heldAccepted();
      Activity.take(_drop, _legal);
      if (typeof History !== "undefined" && History.noteAdds) History.noteAdds(_drop, _legal);   // added times (J73 Q10)
      // and the SONGS: what is dropped is folded into history first, from the base it folds from (J73 job 7)
      if (typeof History !== "undefined" && History.ingest && _drop.length) { try { History.ingest(_drop, _heldBase, Object.assign({ src: "trim" }, _droppedReach(_prevCut, fl.floorL) || {})); } catch (e) {} }
    }
    const kept = eventLog.filter((e) => !_coveredBy(fl, e));
    eventLog.length = 0;
    for (const e of kept) eventLog.push(e);
    _heldBase = fl.seed;                // the held log now folds from this save point's seed (J73 job 2)
    _retireCached();                    // and the raw cache lets go of what is now banked (J73)
    // The derived log no longer reaches the room's start, so the genesis comparison is off (the
    // same counter every other drop raises — `check-divergence-signal`).
    _derivedLogTrimmed += (before - kept.length) || 1;
    _raiseBoundary(fl.floorL, String(fl.covers).split("..")[1] || null);
    // The origin-seed verdict — the same record a decentralized origin gets, through the same site (J79).
    if (_asOrigin) _recordOriginVerdict(fl);
    _refold();
    return { ok: true, floorL: fl.floorL, dropped: before - kept.length, origin: _asOrigin };
  }
  function floorSeed() { const f = _trustedFloor(); return (f && f.seed) || null; }
  // What was taken before dropping, for `Room.foldActivity` to merge (J73 job 2). Null until
  // something has been taken, so a room that has not trimmed answers from its held log alone.
  function olderActivity() { return (typeof Activity !== "undefined") ? Activity.read() : null; }

  // EVERY DERIVED FIELD A DROP COULD CHANGE (J73 job 7, Q6): the derived state's keys, less `history`,
  // which no seed may carry and which History takes before anything is dropped.
  const REPRODUCE_FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
  // Does save point `f`'s seed reproduce what is held — the held log up to its cut, folded from the
  // base the held log folds from? Field by field; the first that differs is named.
  function reproduces(f) {
    if (!f || !f.seed || typeof f.floorL !== "number") return { ok: false, reason: "no-seed" };
    let held = null, seeded = null;
    try {
      held = StateDeriver.derive(orderEvents(eventLog).filter((e) => _coveredBy(f, e)), _heldBase);
      seeded = StateDeriver.derive([], f.seed);
    } catch (e) { return { ok: false, reason: "fold-threw" }; }
    for (const k of REPRODUCE_FIELDS) {
      if (_canonAny(_field(held, k)) !== _canonAny(_field(seeded, k))) return { ok: false, reason: "differs", field: k };
    }
    return { ok: true };
  }
  // COUNTS ARE THE LIVE SONG'S. A seed carries only the live song's ledger — past plays' tallies are
  // history, which no seed may carry — so that is what it can be asked to reproduce. (Past tallies
  // leave the derived state at every adoption and every trim; J73 job 7 records it for the owner.)
  function _field(st, k) {
    if (k !== "counts") return (st && st[k] !== undefined) ? st[k] : null;
    const pi = st && st.nowPlaying && st.nowPlaying.pi;
    return (pi && st.counts && st.counts[pi]) ? st.counts[pi] : null;
  }
  // Compared by VALUE through `_canonAny` — the one canonical encoder this file uses for both checks.
  // The save point this engine adopted, for EventCache's banked tier where `Floor` holds none (J73 job 7).
  function adoptedFloor() {
    // `h`, `n` and the restart (`ddjp_571`): which save point the fold stands on, and of which restart — what the
    // bot door compares before it moves, and what the runner reads before it confirms the owner's restore.
    return _adopted ? { floorL: _adopted.floorL, covers: _adopted.covers, seed: _adopted.seed, grade: "verified",
                        h: _adopted.h || null, n: _adopted.n, era: _adopted.era || 0, root: _adopted.root || null } : null;
  }
  // THE BASE THE HELD LOG FOLDS FROM — undefined is the room's start, else the seed of the floor last
  // dropped to. Legality of an event about to be dropped is the verdict of THAT fold: by the time a
  // trim takes, the current fold may already be seeded on the new floor, which no longer contains the
  // events being dropped, so `isLegal` would call every one of them refused (J73 job 2).
  let _heldBase;
  // KEEP ENOUGH TO PROVE THE CURRENT FLOOR (owner's rule, `ddjp_551`): a QUORUM floor is re-proved on every revalidate by
  // `chainVerifies`, which needs the floor's own boundary event — the one thing a trim drops that the proof needs (every event
  // after it is above the cut, and held). Kept here, beside the held log, so no fold of the held log ever sees it.
  let _proofKeep = [];
  let _moveOnLogged = null;   // the floor Step A's log line was last said for (step 5b: at most once per floor)
  let _heldBaseH = null;   // the fingerprint of the floor the held log folds from (proved by its licence when trimmed under)
  function _heldAccepted() {
    try {
      const acc = StateDeriver.deriveAccepted(orderEvents(eventLog), _heldBase);
      if (acc instanceof Set) return (id) => acc.has(id);
      if (Array.isArray(acc)) { const s = new Set(acc); return (id) => s.has(id); }
      if (acc && typeof acc === "object") return (id) => !!acc[id];
    } catch (e) {}
    return isLegal;
  }

  function _trustedFloor() {
    if (_adopted) return _adopted;
    try { if (typeof Floor !== "undefined" && Floor.current) return Floor.current(); }
    catch (e) {}
    return null;
  }
  // The fold, in one place. It was written out inline in ingest, so trimming had no way to redo it
  // without either duplicating it or deferring to the next arrival.
  function _refold() {
    const ordered = orderEvents(eventLog);
    const _full = _deriveBest(ordered);
    derivedState = _full.state;
    _foldRefusals = _full.refusals || null;
    legalIds = Object.create(null);
    try { for (const id of _full.accepted) legalIds[id] = true; }
    catch (e) { legalIds = null; }
    return _full;
  }
  // ── NOW INVOKED — by the subscriber on Floor's change bus ────────────────────────────────────
  // This said "nothing in production calls this", and that stopped being true when adopting a floor
  // was wired to emit and something subscribed. Left uncorrected, a comment like that is worse than
  // no comment: it tells the next reader a live path is dormant.
  //
  // The same block also warned that the two memories gated on DIFFERENT things — this on the floor's
  // grade alone, EventCache additionally on the seed-validation licence — and that a client trimming
  // before validating would bound its derived log and then never shed a raw copy, because the
  // licence needs a genesis fold that no longer exists. That hazard is CLOSED: the licence check
  // below is the ordering, and it is checked here too. The warning was right and the fix landed;
  // what remained was a note describing a danger that had already been dealt with.
  // CAN THIS DEVICE PROVE FLOOR f WITH WHAT IT HOLDS? (owner's model, `ddjp_550`) The floor it trimmed under was proved by its
  // licence; any other is proved by `Floor.proves` against the held log. "needsFetch" when the proof needs older events.
  function canProve(f) {
    if (!f || !f.seed || typeof f.floorL !== "number") return { ok: false, reason: "no-floor" };
    if (_heldBaseH && f.h === _heldBaseH) return { ok: true, reason: "trimmed-under" };
    if (typeof Floor === "undefined" || typeof Floor.proves !== "function") return { ok: _trimmedBelow === null, needsFetch: _trimmedBelow !== null };
    const r = Floor.proves(f, orderEvents(eventLog));
    if (r.ok) return { ok: true };
    if (r.reason === "does-not-rebuild" || r.reason === "no-predecessor" || r.reason === "no-floor") return { ok: false, reason: r.reason };
    return { ok: false, needsFetch: true, reason: r.reason, needFrom: r.needFrom };
  }
  // RE-ADMIT FETCHED EVENTS ABOVE A PROVEN FLOOR'S CUT, and fold the held log from its seed.
  function restoreBelow(f, entries, quorum) {
    const have = new Set(eventLog.map((e) => e.eventId)); let n = 0;
    for (const e of (entries || [])) { if (!e || have.has(e.eventId) || _atOrBeforeBoundary(f, e)) continue; eventLog.push(e); have.add(e.eventId); n++; }
    _trimmedBelow = f.floorL; _trimmedBoundaryId = (typeof f.covers === "string") ? f.covers.split("..")[1] : null;
    _heldBase = f.seed; _heldBaseH = f.h || null; _lastFoldedFloor = null;
    if (quorum) { const b = (entries || []).find((e) => e && e.eventId === _trimmedBoundaryId); _proofKeep = b ? [b] : []; } else _proofKeep = [];
    _refold();
    return n;
  }
  // The held log plus what proves the current floor — what Floor's chain verification reads; no fold reads it.
  function proofLog() {
    const ids = new Set(eventLog.map((e) => e.eventId));
    return orderEvents(_proofKeep.filter((e) => !ids.has(e.eventId)).concat(eventLog));
  }
  // WHAT IS KEPT ONLY TO PROVE THE FLOOR — the quorum floor's boundary event (`_proofKeep`) — by id, so the raw cache keeps the same
  // copy when it retires everything at or below the cut (`ddjp_566`, the owner's ruling). Which floors keep one is decided above, once.
  function proofKept() { return _proofKeep.map((e) => e && e.eventId).filter(Boolean); }
  // THE ROOM'S START: every fetched event is held again, and the log folds from the beginning.
  function restoreFromStart(entries) {
    const have = new Set(eventLog.map((e) => e.eventId)); let n = 0;
    for (const e of (entries || [])) { if (!e || have.has(e.eventId)) continue; eventLog.push(e); have.add(e.eventId); n++; }
    _trimmedBelow = null; _trimmedBoundaryId = null; _heldBase = undefined; _heldBaseH = null; _proofKeep = []; _lastFoldedFloor = null;
    _refold();
    return n;
  }
  // THE FETCH-BACK (owner's model): from the held start backwards, the first floor that BINDS this rank (`Floor.select`) and
  // PROVES ITSELF from the fetched events (`Floor.proves`) — fetching only as far as each proof needs, never past the first
  // floor that proves itself. Last resorts, in order: vouch copies, the room's start, then stay (stale: forgetting stopped).
  // `env.fetch(fromL, toL)` is the existing pager (the bridge's `pageRange`). `tests/check-forgetting-differential.js`.
  async function fetchBack(env) {
    const out = { ok: false, reason: null, fetchedFrom: null, tried: 0 };
    if (!env || typeof env.fetch !== "function" || typeof Floor === "undefined") { out.reason = "no-fetch"; return out; }
    const heldStart = (_trimmedBelow !== null) ? _trimmedBelow : 1;
    const got = new Map();
    const add = (list) => { for (const e of (list || [])) if (e && e.eventId && !got.has(e.eventId)) got.set(e.eventId, e); };
    const fetchFrom = async (fromL) => {
      if (out.fetchedFrom !== null && fromL >= out.fetchedFrom) return true;
      const to = (out.fetchedFrom !== null) ? out.fetchedFrom - 1 : heldStart;
      let list = [];
      try { list = (await env.fetch(fromL, to)) || []; } catch (e) { list = []; }
      if (!list.length) return false;
      add(list); out.fetchedFrom = fromL; return true;
    };
    const tried = new Set(), all = () => orderEvents(Array.from(got.values()).concat(_proofKeep, eventLog).filter((e, i, a) => a.findIndex((x) => x.eventId === e.eventId) === i));
    let starved = false;
    for (let guard = 0; guard < 64; guard++) {
      let sel = null;
      try { sel = Floor.select(env.myRank(), env.settings(), (q) => Floor.chainVerifies(q, all()), tried); } catch (e) { sel = null; }
      if (!sel || !sel.floor) break;
      const c = sel.floor; out.tried++;
      let pr = Floor.proves(c, all());
      if (!pr.ok && typeof pr.needFrom === "number") { if (!(await fetchFrom(pr.needFrom))) { starved = true; break; } pr = Floor.proves(c, all()); }
      if (pr.ok) {
        restoreBelow(c, all(), sel.tier > 0); Floor.standOn(c, sel.tier);
        Logger.info("StreamManager: fetched back to l=" + out.fetchedFrom + " — floor n=" + c.n + " (l=" + c.floorL + ") proved itself; standing on it");
        out.ok = true; out.reason = "proved"; out.floorL = c.floorL; return out;
      }
      tried.add(c.h);                                                    // did not prove itself: keep looking further back
    }
    // LAST RESORTS. 1 — vouch copies, for events the server no longer returns.
    if (starved && typeof Vouch !== "undefined" && typeof Vouch.repairFrom === "function" && typeof env.heldRaws === "function") {
      try { const rep = Vouch.repairFrom(env.heldRaws()); if (rep && rep.length) add(rep.map((r) => r.event || r).filter(Boolean)); } catch (e) {}
    }
    // 2 — the room's start: the events from the beginning, folded from nothing.
    if (await fetchFrom(1)) {
      const a = all();
      if (a.length && typeof a[0].l === "number" && a[0].l <= 1) {
        restoreFromStart(a); Floor.standOnStart();
        Logger.info("StreamManager: fetched back to the room's start — folding from the beginning");
        out.ok = true; out.reason = "room-start"; return out;
      }
    }
    // 3 — stay: the floor stays stale and forgetting stays stopped.
    Logger.warn("StreamManager: fetch-back found no floor that proves itself and could not reach the room's start — staying, not forgetting");
    out.reason = "stay"; return out;
  }
  // DOES THE FLOOR THIS DEVICE STANDS ON LICENSE FORGETTING? (step 5b) Its boundary event is held, and it proves itself by
  // `Floor.proves` — or it is the floor this device already trimmed under (proved then). One rule, for the trim and the cache.
  function _provesForForgetting(t) { return _floorProves(t) && _settingsProofAllows(); }
  // THE SETTINGS PROOF, UNCHANGED: the floor's settings claim proved against the settings event it names. It was half of the
  // old licence and is not the J73 state comparison, so it still gates forgetting.
  function _settingsProofAllows() {
    try { if (typeof SettingsProof === "undefined" || !SettingsProof.verdict) return true; return SettingsProof.licensesForget(); } catch (e) { return false; }
  }
  function _floorProves(t) {
    if (_heldBaseH && t && t.h === _heldBaseH) return true;
    // AN ORIGIN ROOM'S ORIGIN FLOOR is the room's declared beginning, proved by its declaration when the file was imported
    // (the `origin-seed` verdict, recorded without any comparison) — its events are in another room, so nothing here rebuilds it.
    if (_originDeclared && t) { const v = seedValidation(); if (v && v.reason === "origin-seed" && v.sig === _sigOf(t)) return true; }
    const bid = (t && typeof t.covers === "string") ? t.covers.split("..")[1] : null;
    if (!bid || !(eventLog.some((e) => e && e.eventId === bid) || _proofKeep.some((e) => e && e.eventId === bid))) return false;   // boundary held
    try { return typeof Floor !== "undefined" && typeof Floor.proves === "function" && Floor.proves(t, proofLog(), { byPosition: true }).ok === true; }
    catch (e) { return false; }
  }
  function forgettingLicensed() {
    if (_adopted) return seedLicensesForget();
    const t = _trustedFloor();
    if (!t || typeof TrustPolicy === "undefined" || !TrustPolicy.earnsForget(t.grade)) return false;
    return _provesForForgetting(t);
  }
  // DOES THIS DEVICE DISAGREE WITH ITS FLOOR? Its own (diagnostic) J73 verdict says "mismatched" for this floor's signature.
  // It still follows the floor, as the consensus decides, but does not SEAL on it (`Checkpoint.maySeal`).
  // ONLY ON COMPLETE DATA (owner's live test, `ddjp_556`): "disagrees" counts only when this device's own check ran on the
  // whole room — nothing trimmed, nothing banked below a floor, its held log reaching the room's start. Otherwise it CANNOT
  // TELL, and that does not block sealing: it seals from a floor that proved itself. (A banked device's genesis comparison
  // says "mismatched" with no real disagreement — the bot at 15:05:09, which then refused to seal at 15:09:53.)
  function _checkHadCompleteData() {
    if (_trimmedBelow !== null || _derivedLogTrimmed !== 0) return false;
    const ord = orderEvents(eventLog);
    return ord.length > 0 && typeof ord[0].l === "number" && ord[0].l <= 1;
  }
  // DOES THIS DEVICE HOLD THE WHOLE ROOM? (`ddjp_562`) Nothing trimmed, nothing banked below a floor, the held log from the start.
  function holdsWholeRoom() { return _checkHadCompleteData(); }
  function disagreesWithFloor() {
    const t = _trustedFloor(), sig = t ? _sigOf(t) : null, v = seedValidation();
    return !!(sig && v && v.sig === sig && v.status === "mismatched" && _checkHadCompleteData());
  }
  function trimToFloor() {
    const t = _trustedFloor();
    if (!t || typeof t.floorL !== "number") return 0;
    // ── ADOPTING A FLOOR RE-DERIVES FROM IT, BEFORE ANY LICENCE IS ASKED (J47) ─────────────────
    // The circularity this breaks: for an ORIGIN floor the `validated / origin-seed` verdict is
    // recorded by `_recordOriginVerdict` inside `_deriveBest` — the very fold this function would
    // trigger. Asking for the licence first meant asking for one only its own refold could grant,
    // reading the PREVIOUS floor's verdict, and returning 0. Quiet room: the owner clicks restore
    // and the room serves state from a floor it no longer holds, indefinitely and silently.
    //
    // TWO PLACES IT LOOKS LIKE IT COULD GO, AND CANNOT. `trimToFloor`'s no-drop path is BELOW the
    // licence check, so a refold there never runs in the case that needs it. Subscribing to
    // `Floor`'s emission would make this module depend on Floor at load, where it reads it lazily.
    //
    // CONDITIONAL ON THE FLOOR HAVING MOVED, so an adoption path does not become a fold per call —
    // both production callers are adoption paths. `check-adopt-refold` drives both halves.
    const _sig = _sigOf(t);
    if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; _refold(); }
    if (typeof TrustPolicy === "undefined" || !TrustPolicy.earnsForget || !TrustPolicy.earnsForget(t.grade)) return 0;
    // AND THE SEED LICENCE. Not extra caution — an ORDERING that closes a deadlock. The two memories
    // check different things: this trims on the floor's grade, while EventCache additionally requires
    // the seed to have been VALIDATED against a genesis fold. That validation can only run while
    // genesis is still held, so a client that trimmed first would bound its derived log and then
    // never shed a raw copy, because the licence it needs could no longer be computed. Validate
    // first, then forget.
    // STEP 5b — FORGETTING FOLLOWS ACCEPTANCE (owner's ruling, option b, `ddjp_554`): a decentralized device forgets below the
    // floor it stands on — bound to its rank by selection, with a grade that allows it (above) — once that floor's boundary
    // event is held and it PROVES ITSELF by the consensus's exact rebuild (`Floor.proves`). The J73 state comparison is a
    // diagnostic now. Bot rooms (an adopted save point) keep their own licence.
    if (!(_adopted ? seedLicensesForget() : _provesForForgetting(t))) return 0;
    const before = eventLog.length;
    // EXACTLY WHAT THE FOLD READS ABOVE THE CUT, AND NOTHING ELSE (J73). The boundary event and
    // everything before it in the fold's own order — position, then id — are banked into the seed,
    // so they go. This kept `l > floorL`, position alone, and so also dropped an event SHARING the
    // floor's position whose id sorts after the boundary: not in the seed, not in the log, gone —
    // and the trimmed client derived a different queue from a reader holding everything
    // (`tools/probes/probe-j73-trim-tie.js`; `check-trim-boundary` PART A). Asking `_aboveCut` makes
    // the drop and the fold one rule rather than two that can disagree.
    const _keep = new Set(_aboveCut(orderEvents(eventLog), t));
    const kept = eventLog.filter((e) => _keep.has(e));
    // An early exit when nothing is AT OR BELOW the cut — nothing to drop from the held log (this said "nothing is above the
    // floor", the opposite of its condition). The arithmetic below returns 0 either way; the exit avoids rebuilding the array.
    // IT STILL RETIRES (`ddjp_566`, HANDOVER item 3): "nothing to drop HERE" says nothing about the raw cache, because a banked
    // raw never entered the held log. An origin floor, licensed by its declaration with nothing held below it, took this path and
    // left every leftover raw at or below its cut (`check-cache-held` C).
    const _bid = (typeof t.covers === "string") ? String(t.covers).split("..")[1] : null;
    if (t.grade === "quorum") { const _b = eventLog.find((e) => e.eventId === _bid) || _proofKeep.find((e) => e.eventId === _bid); _proofKeep = _b ? [_b] : []; }
    else _proofKeep = [];                                    // owner and own floors are never re-proved: nothing extra
    if (kept.length === before) { _raiseBoundary(t.floorL, _bid); _retireCached(); return 0; }
    // TAKE BEFORE DROPPING (J73 job 2). Presence and AFK read the held log, and this drop would take
    // their evidence with it — after a trim the People tab and the bot said "can't tell" for an hour
    // (`check-activity-taken` PART A). Legality is the fold's own verdict, held right now: a refused
    // act counts for nobody, as it does in the held log. The evidence reaches the room's start only
    // if what is held does — the first trim of a log that begins at position 1; later trims keep
    // whatever the first established.
    if (typeof Activity !== "undefined") {
      const _drop = eventLog.filter((e) => !_keep.has(e));
      const _first = orderEvents(eventLog)[0];
      const _fromStart = _trimmedBelow === null && !!_first && typeof _first.l === "number" && _first.l <= 1;
      const _legal = _heldAccepted();
      Activity.take(_drop, _legal, { complete: _fromStart });
      // and the ADDED TIMES of songs still queued, for the repeat rule (J73 Q10)
      if (typeof History !== "undefined" && History.noteAdds) History.noteAdds(_drop, _legal);
      if (typeof History !== "undefined" && History.ingest && _drop.length) { try { History.ingest(_drop, _heldBase, Object.assign({ src: "trim" }, _droppedReach(_trimmedBelow, t.floorL) || {})); } catch (e) {} }
    }
    eventLog.length = 0;
    for (const e of kept) eventLog.push(e);
    _heldBase = t.seed;                 // the held log now folds from this floor's seed (J73 job 2)
    _heldBaseH = t.h || null;           // and that floor was proved here (its licence): it needs no fetch to stand on
    _retireCached();                    // and the raw cache lets go of what is now banked (J73)
    _raiseBoundary(t.floorL, _bid);
    // RE-DERIVE NOW, not at the next ingest. The state in hand was folded from a log that no longer
    // exists; leaving it until something else arrives means the room is correct only by the accident
    // of nobody having asked, and the first post-trim fold would then be the one to expose it. This
    // also makes the switch to the seeded path observable at the moment it happens rather than later.
    _refold();
    // A TRIM IS WHEN REACHING BACK STARTS TO MATTER. From here on this client cannot fold the
    // room from its beginning on its own, so anything history has not already read has to come
    // from the homeserver. Told rather than inferred, because a pane that quietly stops at the
    // floor looks like a room that has barely played anything.
    try {
      if (typeof MatrixBridge !== "undefined" && MatrixBridge.rearmHistoryBackfill) {
        MatrixBridge.rearmHistoryBackfill();
      }
    } catch (e) {}

    Logger && Logger.debug && Logger.debug("StreamManager: derived log trimmed to floor l=" + t.floorL +
      " (" + (before - kept.length) + " dropped, " + kept.length + " held)");
    return before - kept.length;
  }
  // Guard seam. A floor normally arrives through Floor adoption, which needs a quorum and
  // a transport; what is under test here is what the LOG does once a floor of a given grade exists.
  // Guard seams. The licence is produced by a genesis cross-check that a headless harness cannot
  // stage cheaply, and the log is normally only reachable through ingest.
  let _licenceOverride = null;
  function _setLicenceForTest(v) { _licenceOverride = v || null; }
  function _setLogForTest(l) { eventLog.length = 0; for (const e of (l || [])) eventLog.push(e); _refold(); }
  // Guard seam. Whether we have trimmed decides which fold is TRUTH, and a stale value survives a
  // room change plausibly rather than visibly: the next room folds seeded against a floor it never
  // had and still produces a room-shaped answer. Read directly, because asserting it through the
  // derived state did not catch it.
  function _trimState() { return _trimmedBelow; }

  // THE ADOPTED SAVE POINT FIRST, LIKE `_trustedFloor()`, so the pair cannot drift (audit,
  // ddjp_512): with a save point adopted, `_trustedFloor()` returned it while this still read
  // `Floor.seed()` — null in a bot room — and a caller pairing the two folded the adopted cut from
  // an empty start. Otherwise it reads `Floor.seed()` exactly as before: a shared room is unchanged.
  function _trustedSeed() {
    if (_adopted) return _adopted.seed || null;
    try { if (typeof Floor !== "undefined" && Floor.seed) return Floor.seed(); }
    catch (e) {}
    return null;
  }
  // ── THE ORIGIN DECLARATION (J46) ────────────────────────────────────────────────────────────
  // `prev === null && thin === true`. Two fields already inside the fingerprint, READ TOGETHER,
  // and the conjunction is a third thing neither says alone:
  //   prev = null   I held no floor when I sealed this      (`const prev = floor ? floor.h : null`)
  //   thin = true   I computed from a seed, not from this room's beginning  (`_env.thin()`)
  // Together: my seed did not come from a floor I hold, and it is not this room's beginning
  // either — which is the definition of a seed that REPLACES a log rather than summarising one.
  // Written by `Checkpoint.buildImport` and by no honest seal.
  //
  // A READING, NOT A RECOMPUTE, and that distinction is the settlement's. Inferring an origin from
  // *the seed does not reproduce from my log* would turn every genuine mismatch into a licence —
  // making a red check green by weakening what is under test. A client has to be TOLD, and this is
  // where it is told.
  //
  // NOT `n === 1 && prev === null`, which was proposed and REFUTED by measurement
  // (`probe-j46-origin` R22): an ordinary room's own first seal produces exactly that pair,
  // because holding no floor gives `n = _seq` and `prev = null` together. A predicate firing there
  // makes a client discard its room's real history on the strength of its own genesis checkpoint.
  //
  // ── AND IT RESTS ON AN INVARIANT: NO FLOOR ⟹ NOT TRIMMED ────────────────────────────────────
  // Stated here because it was upheld by nothing that knew it was upholding it, and because a rule
  // stated only in a comment is a wish (08-build-and-deploy.md §Build law).
  //
  //   An honest sealer writes `prev = null` only when it holds NO FLOOR, and `thin = true` only
  //   when it HAS TRIMMED. So the pair is unreachable honestly exactly while no client can be
  //   trimmed and floorless at the same time.
  //
  // Nothing enforced that. It is upheld in two places by two decisions made for other reasons:
  //   · `Floor._weakened` WITHDRAWS an untrimmed client's floor but only DEMOTES a trimmed one to
  //     `stale`, keeping it — because withdrawing would leave a client that has already forgotten
  //     with no state at all. (`probe-j46-fold` R35.)
  //   · `Floor.reset()` and `StreamManager.reset()` are called together on room change, so `thin`
  //     cannot outlive the room it describes. That is a WIRING fact, not a property of either
  //     module — exactly the kind of cross-module precondition that reads as satisfied until
  //     somebody reorders a step. (R36.)
  //
  // The consequence of losing it is not a missed import; it is the opposite direction. An honest
  // seal from that state publishes the origin declaration, and a client reading it DISCARDS THAT
  // ROOM'S REAL HISTORY. Driven rather than argued — R37 constructs the forbidden state and
  // watches `seal()` commit `n=1 prev=null thin=true`. So the invariant is guarded, by
  // `check-origin-fold` PART D, in the same change that started reading the pair.
  function _isOriginFloor(f) {
    if (!f || !f.seed) return false;
    return (f.prev === null || f.prev === undefined) && f.thin === true;
  }
  // Has this room told us it begins somewhere other than genesis? Latching; cleared by `reset()`.
  let _originDeclared = false;
  // Guard seam, and the same reason `_trimState` has one: which fold is TRUTH is not otherwise
  // observable, because being wrong here produces a room-shaped answer rather than an error.
  function _originState() { return _originDeclared; }
  // Everything strictly above a floor's cut, under the reducer's OWN sort key. Position alone is
  // not enough: two events can share a position, and comparing position only silently drops the
  // sibling that sorts after the boundary at that same position — neither below the floor nor
  // inside the segment, gone with no error. `Floor.afterBoundary` is the one home for that
  // comparison, so this asks it rather than restating it.
  function _aboveCut(ordered, f) {
    if (!f || typeof f.floorL !== "number") return ordered;
    if (f === _adopted) return ordered.filter((e) => !_coveredBy(f, e));
    const bid = (typeof f.covers === "string") ? String(f.covers).split("..")[1] : null;
    try {
      if (typeof Floor !== "undefined" && Floor.afterBoundary) {
        return Floor.afterBoundary(ordered, f.floorL, bid);
      }
    } catch (e) {}
    // FALLBACK ONLY, AND UNREACHABLE TODAY: a floor that is neither adopted here nor read from `Floor`
    // cannot exist while `Floor` is absent. It states `Floor.afterBoundary`'s rule rather than a
    // position-only one (J73's sweep), so a future route here does not inherit the tie.
    const _bidF = String(bid == null ? "" : bid);
    return ordered.filter((e) => {
      const el = (typeof e.l === "number") ? e.l : 0;
      return el !== f.floorL ? el > f.floorL : String(e.eventId) > _bidF;
    });
  }
  // ── THE PRE-FORGET CHECK HAS NOTHING TO COMPARE IN AN ORIGIN ROOM, AND MUST SAY SO ──────────
  // The ordinary check derives the seed forward over the events past its cut and compares that
  // against the genesis fold — two independent routes to one answer, which is what makes it
  // evidence. In an origin room there is no second route: the base fold IS the seeded fold, over
  // the same events (measured, `probe-j46-fold` R34 — the two input sets are identical). Letting
  // it fall through the comparison would record `validated` having compared a computation with
  // itself: a verdict naming a check that did not happen, which is P10 and this codebase's second
  // failure signature.
  //
  // So the origin case is recorded as ITSELF, with its own reason, and `seedValidation()` reports
  // it. The licence it grants is real and rests on something narrower than the comparison:
  // forgetting below an origin cut cannot change derived state, because the fold already starts
  // above that cut — the trim frees memory and moves nothing. That is a stronger guarantee than
  // the comparison provides, stated, rather than the comparison's guarantee obtained by weakening
  // what it tests.
  function _recordOriginVerdict(f) {
    const sig = _sigOf(f);
    if (!sig || sig === _lastValidatedCp) return;
    _recordValidation("validated", "origin-seed", sig);
  }
  // ── WHEN THE SEED AND THE HOLDINGS DO NOT MEET ──────────────────────────────────────────────
  // P8: say which way a check fails, and do not inherit the answer from a fall-through. Falling
  // through to the genesis fold is the wrong answer and the comment inside `_deriveBest` already
  // says why — folding the tail from empty describes a room that never had a history. So:
  //
  //   · KEEP THE LAST FOLD WHOSE SEED AND HOLDINGS ACTUALLY MET. It was correct when it was made,
  //     and re-page is the mechanism that already exists for going back and earning a floor
  //     properly. Preferred, because it preserves a true answer rather than discarding one.
  //   · NO SUCH FOLD -> REFUSE TO ANSWER. An empty derive is not a lie about the past; it is this
  //     client saying it cannot account for the room. A stale-but-true room and a fabricated one
  //     are not the same kind of wrong, and only the second can reach the UI as a plausible story.
  //
  // THE SECOND BRANCH WAS NOT REACHABLE, AND WAS WRITTEN ANYWAY. Driven at the time: a client that
  // never established a settings reading never earned the licence (`seedLicensesForget` requires
  // `SettingsProof.licensesForget`), so it never trimmed, so it never folded seeded — a partial-log
  // client with a floor below its holdings trimmed 0 and left the boundary null. Every client that
  // could reach the violation had therefore trimmed at least once, and the real-trim path re-folds,
  // so a last good fold existed.
  //
  // ── J35 HAS LANDED AND THAT PROOF IS GONE. RE-DECIDED HERE RATHER THAN INHERITED. ───────────
  // Wiring the settings read-back lets a thin or post-trim client earn the licence, which is exactly
  // what creates a client that can trim without ever having folded a sound room. Driven, on a client
  // holding NOTHING:
  //
  //     readBack(0) -> proveClaim -> `validated`, licence granted
  //     trimToFloor() on an empty log -> drops 0 and RAISES the boundary to 14 (the early-exit
  //       path writes it), with no fold having happened, so `_lastGoodFold` is still null
  //     a floor below that boundary -> `_refuseUnpaired` with nothing to hold
  //
  // So the second branch is now LIVE. The preference above is re-affirmed, and the reason has
  // changed — which is the whole point of writing it down again rather than leaving the old one:
  //
  //   · BEFORE, it was sound because the first branch always applied. That was a fact about the
  //     licence chain, and J35 removed it.
  //   · NOW, it is sound because the two branches are ORDERED BY TRUTHFULNESS — a stale-but-true
  //     room beats an honestly-empty one, and an honestly-empty one beats a fabricated one — and
  //     because the empty answer is never SILENT. `pairingFault()` comes back
  //     `{seedAt, boundary, held}` on exactly this path (measured: `{seedAt:6, boundary:14,
  //     held:1}`), so "empty because I cannot account for the room" stays distinguishable from
  //     "empty because nothing has played". That distinguishability is what the new reason rests
  //     on, so it is asserted in `check-floor-pairing` PART G rather than described here.
  //
  // What did NOT survive the re-decision is the old TRIPWIRE's claim. PART G used to pin "a client
  // that cannot establish a settings reading must not trim at all" as the precondition; that
  // sentence is now false in production, and the part asserts the consequence instead.
  //
  // DETECTION ONLY (§3.4 — notice is not react). This gates nothing and triggers nothing; it
  // records the fault, names both numbers in the log, and answers honestly.
  let _lastGoodFold = null;
  let _pairingFault = null;
  // ── WHAT THIS BOUNDARY REFUSED THAT WE STILL HOLD (J44) ────────────────────────────────────
  // Where a floor withdrawal is SUSTAINED, an arrival the accepted boundary ignored stays out of
  // the fold with its bytes still held, and this client computes a room no peer holding the same
  // evidence computes. J37 drove all three repairs and refused each — re-delivery would source the
  // fold from `EventCache`, which the cache's cap must never be able to influence, and holding the
  // floor as `stale` recovers nothing. So the divergence is ACCEPTED and the SILENCE is what this
  // fixes: nothing detected it from either end, because the arrival sits on a type `Continuity`
  // never chains.
  //
  // `null` MEANS THE QUESTION NEVER AROSE, and it is not the same as a count of zero, which means a
  // boundary was active and refused nothing. A counter starting at zero reads as "never happened"
  // when it means "nobody looked" — an all-clear in exactly the case nobody has checked.
  //
  // NOTICE IS NOT REACT: this gates nothing and triggers nothing, like `_pairingFault` above it.
  let _ignoredArrivals = null;
  // Set by the fold when the log is short and there is no floor to seed from. Queryable rather
  // than inferable, for the same reason `pairingFault` is: the layer that can repair it is not
  // this one, and it needs to be told rather than made to work it out.
  let _shortWithoutFloor = null;
  // ── DID THIS CLIENT'S HISTORY REACH THE ROOM'S BEGINNING? ─────────────────────────────────
  // `null` means NOBODY HAS SAID, and that is deliberately distinct from `false`. The transport is
  // the only layer that knows — it is the one paginating backwards — so this is told, never
  // guessed. Unknown keeps the existing behaviour, so a caller that never reports is exactly as it
  // was; only an explicit "no" changes the fold.
  //
  // THIS IS LOCAL EVIDENCE AND IT IS ALLOWED HERE, on the one condition `check-local-evidence`
  // names: it may make this client MORE CAUTIOUS and never more permissive. Knowing your own
  // history is short can only send you to the floor's seed, which is the answer that is correct
  // either way. It can never let you accept something the room would refuse.
  let _historyComplete = null;
  // Told by the transport after each backfill. Anything that is not a boolean is "unknown", so a
  // caller passing junk cannot silently pin this to permissive.
  // AND IT REFOLDS WHEN THE ANSWER CHANGES. This is an INPUT to the fold, so setting it and leaving
  // the derived state alone would mean the correction only landed at the next arrival — and in a
  // quiet room there may not be one. Driven: without the refold the fix appeared not to work at
  // all, because the state had been computed before the transport reported.
  //
  // Only on a CHANGE, because the transport reports after every backfill and re-deriving on each
  // identical report would fold the whole log for no reason.
  function setHistoryComplete(v) {
    const next = (typeof v === "boolean") ? v : null;
    if (next === _historyComplete) return;
    _historyComplete = next;
    try { _refold(); } catch (e) { /* a refold that throws must not take the setter with it */ }
  }
  function _remember(out) { _lastGoodFold = out; return out; }
  //
  // TWO WAYS TO BE UNPAIRED, ONE ANSWER. The original is a seed BELOW what this client destroyed.
  // J46 adds a second: a room that declared an origin and then left this client holding no floor
  // at all, so there is no seed to start from and no genesis to fall back on either. Both are "I
  // cannot account for this room", and both must refuse rather than fabricate — so they share the
  // answer rather than getting a second one that can drift from it. `f === null` distinguishes
  // them in the LOG without becoming a second mechanism.
  function _refuseUnpaired(ordered, f) {
    _pairingFault = { seedAt: f ? f.floorL : null, boundary: _trimmedBelow, held: ordered.length,
                      reason: f ? "seed-below-boundary" : "origin-without-floor" };
    Logger.warn("StreamManager: REFUSING TO FOLD — " + (f
      ? ("the floor's seed sits at l=" + f.floorL +
         " but this client has already forgotten everything at or below l=" + _trimmedBelow +
         ", so the seed cannot chain onto what is held (" + ordered.length + " events). ")
      : ("this room declared an origin and this client now holds no floor, so there is no seed to " +
         "fold from and its own log does not reach the room's beginning (" + ordered.length +
         " events held). ")) +
      (_lastGoodFold ? "Holding the last state that did pair." : "No paired fold to hold: answering empty.") +
      " A floor must be re-earned — see 09-roadmap.md J02.");
    return _lastGoodFold || StateDeriver.deriveBoth([]);
  }
  // Guard seam: whether the pairing has been violated is not otherwise observable, because the
  // whole failure mode is that it produces a plausible answer instead of an error.
  function pairingFault() { return _pairingFault; }
  // Queryable rather than inferable, and a COPY so a caller cannot edit the record it is reading.
  // `null` is a real answer — see the declaration.
  // A COPY, and `null` is a real answer meaning "this client can derive from what it holds".
  function shortWithoutFloor() {
    return _shortWithoutFloor ? Object.assign({}, _shortWithoutFloor) : null;
  }
  function ignoredArrivals() {
    return _ignoredArrivals
      ? { at: _ignoredArrivals.at, count: _ignoredArrivals.count, ids: _ignoredArrivals.ids.slice() }
      : null;
  }

  // Returns { state, accepted } — BOTH from one fold. The reducer computes them in a single pass
  // and `derive`/`deriveAccepted` are thin wrappers that each discard what the other wanted, so a
  // caller needing both (this one, on every ingested event) used to fold the whole log twice.
  // THE MOVE-ON VERDICT FOR A TRIMMED DEVICE (Step A): the floor's seed against the held events up to its cut, folded from
  // the held base — `reproduces`, the bot rooms' move-on check — tied to the floor's fingerprint. A boundary this device does
  // not hold is "not-yet-run", never a pass (the degenerate loop). `tests/check-trim-every-floor.js` drives it.
  function _recordMoveOnVerdict(f) {
    const sig = _sigOf(f);
    if (!sig || sig === _lastValidatedCp || sig === _moveOnLogged) return;   // concluded, or already said for this floor
    _moveOnLogged = sig;                                     // the LOG LIMIT: at most once per floor (step 5b)
    const bid = (f && typeof f.covers === "string" && f.covers.indexOf("..") >= 0) ? f.covers.split("..")[1] : null;
    if (!bid || !eventLog.some((e) => e && e.eventId === bid)) { Logger.info("StreamManager: move-on check — floor n=" + f.n + " boundary not held"); return; }
    const r = reproduces(f);
    // A LOG LINE ONLY (step 5b): no verdict is recorded — forgetting follows acceptance of a floor that proves itself.
    if (r.ok) Logger.info("StreamManager: move-on check — floor n=" + f.n + " reproduces from the held base");
    else Logger.warn("StreamManager: move-on check — floor n=" + f.n + " does not reproduce from the held base (" + (r.field || r.reason || "unknown") + ")");
  }
  function _deriveBest(ordered) {
    // ONCE TRIMMED, GENESIS IS NOT AVAILABLE AND NOT TRUTH. Everything below the floor is gone, so
    // folding this log from empty would silently describe a room that never had a history. The floor's
    // seed IS the history now, and the cross-check below has nothing left to compare against — which
    // is precisely why trimming is gated on a grade that was verified before it was trusted.
    // ── THE SEED AND THE HOLDINGS MUST MEET ─────────────────────────────────────────────────
    // This paired whatever seed the floor held with whatever the log was and compared NOTHING.
    // A seed sitting BELOW the boundary this client already forgot past cannot chain onto what it
    // still holds, so the fold describes a room that never happened — and it does so quietly:
    // every early advance names a parent the fold has not seen, the advance lock refuses them all,
    // and a refused play is not an error. Driven: seed at 6, oldest event held at 15, now-playing
    // six songs stale, history empty, nothing thrown.
    //
    // THE ASSERTION IS HERE RATHER THAN IN `Floor.revalidate` ON PURPOSE. Guarding revalidate
    // closes the route we found; guarding the place where the two things actually meet makes the
    // invariant checkable for every route, including ones nobody has found yet.
    //
    // AND IT KEYS ON `_trimmedBelow`, NOT ON THE ACCEPTED BOUNDARY J03 ADDED. The accepted one now
    // sits next to it and looks like a candidate, so: this asks whether the span between my seed
    // and my holdings is genuinely LOST, and only deletion can make that true. An accepted boundary
    // means the events are still here and still foldable the moment the floor is withdrawn — there
    // is no gap to refuse over. Swapping it would fire this refusal at clients that hold everything.
    // ── ONE RULE: THE FOLD STARTS FROM THE ROOM'S ORIGIN ────────────────────────────────────
    // J46. Normally the origin is EMPTY — the room began at genesis and this log holds it, so the
    // fold starts from nothing and reads everything. Two things change the INPUT rather than the
    // rule, and both are facts about what this client can no longer reach from its own log:
    //
    //   · I HAVE TRIMMED. Everything below the floor is destroyed. The floor's seed is the
    //     history now. (The original rule, unchanged in meaning.)
    //   · THIS ROOM DECLARES AN ORIGIN. The floor I hold says its seed ORIGINATES rather than
    //     SUMMARISES — `prev === null && thin === true`, two committed statements read together —
    //     so there is no history below its cut to reach, in this room or anywhere.
    //
    // Before J46 only the first existed, and an imported room satisfied neither: it derived the
    // GENESIS fold of a log that begins two settings events before the import, which is a room
    // that never happened. The circle was that the import took effect only by trimming, the trim
    // needed the forget licence, and the licence needed the seed to reproduce a genesis it never
    // had. Measured, `probe-j46-fold` R31: rotation [] against the file's ["@dj:hs", …].
    //
    // WHY THE ORIGIN LATCHES RATHER THAN BEING RE-READ FROM THE CURRENT FLOOR. The origin is a
    // fact about the ROOM; the floor is a moving mark within it. The moment the owner seals over
    // an imported floor, the new floor carries `prev = <origin.h>` and `thin = false` — an
    // ordinary checkpoint, correctly — so a rule that re-asked the current floor every time would
    // silently fall back to the genesis fold and empty the room again on the room's second
    // checkpoint. That is the same failure this job exists to fix, arriving later and harder to
    // see. Cleared by `reset()` on room change, in the same step that clears the boundary.
    const f = _trustedFloor();
    if (_isOriginFloor(f)) _originDeclared = true;
    if (_trimmedBelow !== null || _originDeclared) {
      if (!f || !f.seed) {
        // No floor and no genesis to fall back on. Answering an empty derive here would describe
        // a room that never had a history, which is the fabrication `_refuseUnpaired` exists to
        // refuse. Unreachable for an ORIGIN floor today — it is owner-graded, so `revalidate`
        // returns `not-a-quorum-floor` before `_weakened` can withdraw it — and written anyway,
        // because "cannot happen" is the claim this codebase keeps paying for.
        return _refuseUnpaired(ordered, null);
      }
      if (_trimmedBelow !== null && typeof f.floorL === "number" && f.floorL < _trimmedBelow) {
        return _refuseUnpaired(ordered, f);
      }
      _pairingFault = null;
      // Only for a DECLARED origin. A client that reached this branch by trimming already ran the
      // ordinary comparison before it was allowed to trim, and re-recording would overwrite real
      // evidence with a weaker claim.
      if (_originDeclared) _recordOriginVerdict(f);
      // STEP A (owner's ruling, `ddjp_545`): a trimmed device's NEW floor — one whose fingerprint has no conclusive
      // verdict yet — is judged by the move-on check bot rooms use, so it forgets at every floor, not only the first.
      // The floor it already trimmed under is never re-recorded (the rule above). Bot rooms (`_adopted`) are untouched.
      else if (_trimmedBelow !== null && !_adopted) _recordMoveOnVerdict(f);
      // ── ABOVE THE CUT, IN BOTH CASES, AND THAT IS ONE HELPER RATHER THAN TWO RULES ────────
      // The trimmed path used to fold the whole remaining log, which is the same set only because
      // trimming has already removed everything at or below the floor. That equality holds by the
      // accident of a subscriber having fired: `Floor.onChange("moved")` calls `trimToFloor`, so a
      // floor that rises is normally followed by a trim immediately — and in the window before it,
      // the events between the old boundary and the new floor would be folded over a seed that
      // already banked them. Asking the boundary directly makes it structural instead of timed,
      // and it is what the origin path needs regardless, since nothing has been destroyed there.
      //
      // ── IT WAS REDUNDANT THROUGH EVERY PRODUCTION ROUTE. J28 ADDED THE ROUTE WHERE IT BITES ──
      // At J46 this clause was measured REDUNDANT and recorded as such: mutation M8 replaced
      // `_aboveCut(ordered, f)` with `ordered` and the guard it asks stayed green, because all
      // three routes that existed then absorbed the double-fold —
      //   · the TRIMMED path holds nothing at or below the floor, so the two inputs are equal;
      //   · an IMPORTED-AT-CREATION room's only below-cut events are the two settings posts, and
      //     re-folding settings is idempotent — the seed carries the same blob;
      //   · in the floor-moved-but-not-yet-trimmed window, the reducer's own prefix rules absorb
      //     the re-fold: the advance lock refuses a replayed play, membership is idempotent, and
      //     the per-DJ buffer is capped.
      // That entry closed by naming the condition under which it would stop being redundant: "if a
      // reducer rule that absorbs a double-fold is ever relaxed, this becomes load-bearing without
      // anything announcing it."
      //
      // THE CONDITION AROSE, AND NOT THE WAY IT WAS FORECAST. No reducer rule was relaxed. J28's
      // OVERRIDE arrives at a room that has a real log below the cut — plays, joins and advances,
      // not two idempotent settings posts — so none of the three absorptions applies. Measured,
      // `probe-j28-running` R43: over the same override seed, folding the whole log instead of only
      // above the cut returns a song that already played to its DJ's PENDING BUFFER, so the room is
      // neither the file's nor the one it replaced — arrived at silently, because a re-folded
      // declare is not an error.
      //
      // THE AXIS IS THE BUFFER, NOT THE PLAYHEAD, and the first reading of this said otherwise.
      // The playheads AGREE: the seeded head is the file's `pi`, and the target room's own advances
      // name a parent that is not it, so the advance lock refuses them either way. Recorded because
      // a comment naming the wrong axis sends the next reader to check a quantity that does not
      // move and conclude the clause is inert.
      //
      // So this clause is now LOAD-BEARING rather than declarative, on the override route, and it
      // is pinned by `check-override-running` PART B and by `mutate-j28-running` M3.
      //
      // ── AND `mutate-j46-fold` M8 STILL REPORTS `REDUNDANT`, WHICH IS NOT A CONTRADICTION ──────
      // Stated here because the two readings look like they disagree and only one of them is about
      // this clause. That runner asks ONE guard per row (`runGuard(r.guard)`), and M8's is
      // `check-origin-fold.js`, which drives the created-from-file route and does not mention the
      // override. So M8's verdict is measured rather than asserted — and what it measures is that
      // ONE GUARD, under which all three absorptions still hold. It is a true statement about
      // `check-origin-fold` and no longer a true statement about the tree.
      //
      // The claim that this clause "matters somewhere it did not before" and the claim that "the
      // mutation which watches it now fires" are DIFFERENT CLAIMS, and only the first is measured.
      // They were briefly conflated in this file's own comment, which is the eleventh instance of
      // true-about-the-mechanism, wrong-about-the-consequence — the first one about the tooling
      // rather than about the code. A mutation runner's verdict is scoped to the guards it asks,
      // and a redundancy is a statement about the routes that exist.
      return _remember(StateDeriver.deriveBoth(_aboveCut(ordered, f), f.seed));
    }
    // ── HAVE I DROPPED ANYTHING BELOW THE CUT? ────────────────────────────────────────────
    // REPORTED FROM A LIVE ROOM: an owner rejoined and played a song the room had finished an hour
    // earlier, while a client that had stayed showed nothing playing. One log, two answers.
    //
    // The genesis fold below is correct for a client that trusts a floor and STILL HOLDS the
    // pre-checkpoint log — that is what the block underneath explains, and re-folding those events
    // over a seed would double-count them. **It is wrong for a client that has DECLINED them.**
    // `_bankedArrival` refuses arrivals at or below the accepted boundary, so on a fresh load where
    // the CHECKPOINT ARRIVES BEFORE THE HISTORY IT COVERS, the floor is adopted first and the
    // history is then turned away — leaving a log short below the cut and a fold that pretends
    // otherwise. `nowPlaying` comes out empty, every later play names a parent this client does not
    // hold and is refused advance-locked, the pending buffers are never consumed, and the client
    // eventually authors a genesis play onto a song that already played.
    //
    // TWO QUESTIONS, NOT ONE, AND THAT IS THE WHOLE FIX. "Do I trust a floor" and "have I dropped
    // things because of it" are different, and only the second makes genesis wrong. `ignoredArrivals`
    // already records exactly that — what was refused, how many, at which cut — and had NO READER.
    // The fact was being written down and never consulted.
    //
    // THE FOLD'S OWN COMMENT NAMED THE THREE ROUTES THAT ABSORB A DOUBLE-FOLD and closed by saying
    // the clause becomes load-bearing "if a reducer rule that absorbs a double-fold is ever
    // relaxed". No rule was relaxed. This is a FOURTH route, and none of the three absorptions
    // applies: this client has not trimmed, was not created from a file, and the events are not
    // absorbable because they are ABSENT rather than replayed.
    // THE TRIGGER IS "IS MY LOG SHORT", NOT "DID I REFUSE SOMETHING", and the first version of this
    // got that wrong. `_ignoredArrivals` records a refusal, and a refusal is not a loss: a client
    // that folded the whole log and THEN adopted a floor turns away re-deliveries of events it
    // already holds, and folding above the cut for that client would discard history it has.
    // `check-accepted-boundary` PART E is exactly that client and went red on the broad trigger —
    // its late arrival is a straggler, not a hole.
    //
    // The honest question is whether the log REACHES below the cut. A client that holds events at
    // or below `floorL` folded them and genesis is complete for it. A client whose earliest held
    // event is above the cut never folded them and genesis is short by exactly the stretch the
    // seed exists to replace. That is a measurement of what is held, not a memory of what was
    // declined — and it stays right however the events arrived.
    // ── A CLIENT THAT KNOWS ITS HISTORY IS SHORT FOLDS FROM THE FLOOR ─────────────────────
    // FOURTH VERSION OF THIS TEST, and the three that failed are worth keeping because each one
    // looked right:
    //   1. "did I refuse anything below the cut" — a refusal is not a loss. A client that folded
    //      everything and then turned away a re-delivery is fine. `check-accepted-boundary` PART E.
    //   2. "does my log REACH below the cut" — SHIPPED AT v305 AND WRONG. A live client held `l=6`
    //      and `l=7` but not `l=8`, `l=9`, `l=11`, `l=12`, or anything from `l=18` to the boundary
    //      at `l=46`. It reached below the cut and was full of holes, so the test passed and the
    //      fold ran genesis over them.
    //   3. "always fold from the floor when there is one" — always correct, but it discards history
    //      a complete client legitimately holds, and six guards said so.
    //
    // The mistake common to all three: **completeness cannot be decided in this module.** A client
    // that cannot read a channel is missing those `l` values BY DESIGN, and no count, contiguity
    // check or refusal record separates that from a hole.
    //
    // The layer paginating backwards knows, and says so — the same fact the transport already
    // prints as "(reaches the beginning)". Told, not inferred; and `null` (nobody said) keeps the
    // old behaviour, so only an explicit "my history is short" moves the fold.
    const f0 = _trustedFloor();
    const s0 = _trustedSeed();
    if (f0 && s0 && typeof f0.floorL === "number" && _historyComplete === false) {
      // `_aboveCut` drops everything at or below the floor and the seed supplies exactly that
      // stretch — disjoint by construction, so this cannot double-count whatever else is held.
      return _remember(StateDeriver.deriveBoth(_aboveCut(ordered, f0), s0));
    }
    // ── THE RESIDUAL CASE: THE FLOOR WENT AWAY AND THE HOLE DID NOT ───────────────────────
    // The branch above covers a client that still HAS its floor. This is the one that lost it.
    //
    // A withdrawal retracts the accepted boundary — `floor.js` is explicit that arrivals from
    // inside the old cut "have to become admissible again or the fallback is not one". They become
    // admissible; they do not come BACK. Anything refused while the floor stood was never stored in
    // the derived log, so a client that ignored history and then withdrew holds a log with a hole
    // and no seed to replace it, and folds genesis over that hole.
    //
    // DETECTED HERE, REPAIRED ELSEWHERE, AND THE BOUNDARY IS THE REASON. The bytes are not gone:
    // `EventCache` holds every raw this client received, and re-feeding them would rebuild the log
    // in one pass. **That repair may not live in this module.** `check-local-evidence` refuses it
    // outright — this file decides what the ROOM IS, and a room that depends on what one client
    // kept locally is not derived from the shared log. The guard caught exactly that when the
    // re-feed was written here, which is the rule working rather than an obstacle.
    //
    // So this reports the fact and stops. `shortWithoutFloor()` below makes it queryable for the
    // layer that IS allowed to hold bytes. Filed rather than half-built: a detection with no
    // repairer is honest, and a repair in the wrong module is a second source for what the room is.
    //
    // A FIRST DRAFT OF THIS BRANCH COULD NEVER FIRE. It tested for a trusted floor with NO seed —
    // but `Floor.seed()` returns null only when `_trusted` is null, so a trusted floor always
    // carries one. A condition that cannot hold reads as a handled case, which is worse than no
    // code because the next reader stops looking. The reachable state is the opposite: no floor,
    // and a log that is short regardless.
    if (!_trustedFloor() && _ignoredArrivals && _ignoredArrivals.count > 0 && ordered.length) {
      let low = Infinity;
      for (const e of ordered) { const l = (typeof e.l === "number") ? e.l : 0; if (l < low) low = l; }
      if (low > _ignoredArrivals.at) {
        _shortWithoutFloor = { at: _ignoredArrivals.at, lowestHeld: low, count: _ignoredArrivals.count };
        Logger.warn("StreamManager: the floor was withdrawn while arrivals below l=" +
          _ignoredArrivals.at + " had already been refused, so this log is short with nothing to " +
          "seed from — lowest held l=" + low + ". The events were declined, not destroyed; the " +
          "layer holding the bytes has to re-feed them.");
      } else {
        _shortWithoutFloor = null;
      }
    } else if (_trustedFloor()) {
      _shortWithoutFloor = null;
    }
    const genesis = _remember(StateDeriver.deriveBoth(ordered));
    const seed = _trustedSeed();
    if (!seed) return genesis;                    // no checkpoint → genesis (unchanged)
    // While we STILL HOLD the full pre-checkpoint log, genesis is the complete, correct truth
    // (full counts, full history). Re-folding the same events over a seed that already banked
    // them would double-count — so we do NOT use the seeded result for live state yet. Instead
    // we VALIDATE the seed as a capability: derive seeded over ONLY the events AFTER the
    // checkpoint's coverage and confirm the forward QUEUE matches genesis. This proves the
    // trusted checkpoint is sound (recompute-verified end-to-end) so that once a client
    // forgets the pre-checkpoint log, the seeded path it will then rely on is known-good.
    // Nothing here changes live state; genesis remains truth until forgetting is enabled.
    // PERF: validating is a second full derive, so we only do it when the trusted checkpoint
    // CHANGES (not on every ingest) — the seed can't silently rot between checks, and a live
    // divergence would show up the next time a new checkpoint lands. Cheap + sufficient.
    try {
      const tr = (typeof Floor !== "undefined" && Floor.current) ? Floor.current() : null;
      const sig = _sigOf(tr);
      if (sig && sig !== _lastValidatedCp) {
        // ── A PARTIAL LOG CANNOT CONCLUDE ────────────────────────────────────────────────
        // During replay the log is incomplete and arrives out of order, so folding it from
        // genesis produces a FRAGMENT rather than the room. A seed compared against a fragment
        // mismatches for reasons that say nothing about the seed — and `mismatched` is
        // CONCLUSIVE, so one spurious verdict here poisons that checkpoint for the rest of the
        // session and forgetting is never licensed again. Seen live: the warning fired at 70
        // events, three before replay finished.
        //
        // "I cannot tell yet" is already the answer this check gives to a throw and to a missing
        // boundary, and it retries. Replay is the same situation.
        //
        // A MISSING PHASE MACHINE IS NOT "REPLAYING". Absence must not be read as the cautious
        // answer here, or a client that never wires one could never validate at all — which is
        // the degenerate loop the boundary case warns about, reached from the other side.
        let _replaying = false;
        try {
          _replaying = (typeof Session !== "undefined" && Session.phase &&
                        Session.phase() === (Session.REPLAYING || "replaying"));
        } catch (e) { _replaying = false; }
        const after = _replaying ? null : _eventsAfterCheckpoint(ordered);
        if (_replaying) {
          _recordValidation("not-yet-run", "still-replaying", sig);
        } else if (!after) {
          // The boundary could not be located — no trusted cp, no `covers`, or the covered id is
          // not in our log. That last case is commented "we've forgotten the boundary or never
          // had it", so it gets MORE likely once forgetting is on, not less.
          //
          // DEGENERATE LOOP — the reason this must never read as a pass. Forgetting drops the
          // boundary event → validation can no longer run → under the original code that recorded
          // as validated → which licenses more forgetting. The failure grows likelier exactly as
          // the feature is used, and it silently manufactures its own justification. Any
          // "optimisation" that marks the signature before the derive concludes reopens it.
          _recordValidation("not-yet-run", "no-boundary", sig);
        } else if (_trimmedBelow !== null) {
          // ── THE THIRD CASE THE LIST WAS SHORT BY ────────────────────────────────────────
          // The comparison below folds the WHOLE log from nothing and calls the result "genesis".
          // **After a trim it is not genesis** — it starts mid-history — so a complete seeded fold
          // is being compared against an incomplete one and they must differ. DRIVEN: a client
          // whose log reaches genesis matches (`validated`); the same client after ANY trim
          // diverges at every cut tried.
          //
          // The comment above already states the rule — a partial log cannot conclude, and
          // `mismatched` is CONCLUSIVE so one spurious verdict poisons that checkpoint for the
          // session. It guarded `_replaying` and `!after` and not this. **The rule was right and
          // the case list was one short**, which is the whole defect: a room that trimmed once
          // could never license forgetting again, and forgetting is what stops it growing without
          // bound.
          //
          // NOT SEEDED FROM THE OLDEST TRUSTED CHECKPOINT, deliberately. That would validate a
          // seed against a fold that itself started from a seed — close to asking a checkpoint to
          // vouch for itself, and this tree's rule is that a component may not rebuild another's
          // truth. **Declining to conclude is the correct answer for a client that cannot see far
          // enough back**, and it is not permanent: `not-yet-run` leaves the licence withheld for
          // THIS cut while a later checkpoint this client can verify from its own log still
          // reaches a verdict.
          _recordValidation("not-yet-run", "log-does-not-reach-genesis", sig);
        } else {
          const seeded = StateDeriver.derive(after, seed);
          if (_canon(seeded) !== _canon(genesis.state)) {
            // Recorded, not enforced. The old message here said "seed distrusted" — nothing
            // distrusted anything; _trustedSeed() returned the seed regardless. A log line that
            // claims an action it does not take is worse than silence, because it reads as
            // handled. The seed stays trusted; what changes is that it no longer licenses a drop.
            _recordValidation("mismatched", "diverges-from-genesis", sig);
            Logger && Logger.warn && Logger.warn("StreamManager: checkpoint seed diverges from genesis queue — recorded mismatched; forgetting is not licensed at this cut");
          } else {
            _recordValidation("validated", null, sig);
          }
        }
      }
    } catch (e) {
      // A throw is NOT a pass. Record it so the state is distinguishable from success, and leave
      // the throttle key unset so the next ingest retries.
      _recordValidation("not-yet-run", "threw:" + ((e && e.message) || "unknown"), null);
    }

    // ── LIVE STATE FOLLOWS THE FLOOR ──────────────────────────────────────────────────────
    // Everything above has run: genesis is folded, the seed is validated against it, and the
    // licence record is written. **The choice of which answer to USE belongs here and nowhere
    // earlier** — an early return skips the validation, and the trim then reads a licence that was
    // never computed and drops nothing. That mistake cost two rounds of unexplained guard failures
    // and is the reason this sits at the single exit.
    //
    // WHY FOLLOW THE FLOOR AT ALL, when the block above says genesis is "the complete, correct
    // truth". Because that sentence has an unchecked precondition — *while we still hold the full
    // pre-checkpoint log* — and a client cannot know whether it does. Reported from a live room:
    // two clients authored a play at the SAME `l` naming the same parent, an ordinary race that
    // `orderEvents` settles by event id. One client had received only ONE of them and made it the
    // head. From then on every later play named a parent it did not hold: thirty `stale parent`
    // refusals and an advance from a head nobody else had.
    //
    // **A FLOOR IS AN ANSWER; A LOG IS INPUTS.** Re-deriving a stretch the room has already settled
    // means re-resolving its races from whatever this client happens to hold. The seed records who
    // WON, so a client folding from it cannot re-litigate anything below the cut.
    //
    // AND THIS IS WHAT MAKES THE TRUST CASCADE REACHABLE. An owner checkpoint is a bar of one
    // (`Floor.select` returns at tier 0 without a quorum) and a run of higher-rank checkpoints
    // substitutes where no owner one covers a stretch. The design is that a high-enough rank can
    // publish a floor and end a divergence — but a client that derives PAST its floor adopts it,
    // verifies it, spends it on the forget licence and then shows its own answer anyway. The
    // corrective floor was accepted and ignored. `check-floor-snapback` drives that end to end.
    //
    // WHAT CHANGES, MEASURED RATHER THAN ASSUMED: genesis and seeded differ in exactly ONE field,
    // `history`, and nothing reads it — `Queue.getHistory()` has no callers and the room's History
    // panel pages from the transport. `nowPlaying`, `rotation`, `settings`, `counts` and `advance`
    // are byte-identical. Checkpoint hashes commit the SEED, which has no `history`, so nothing
    // re-fingerprints; and sealing from a seeded fold produces the same checkpoint as sealing from
    // genesis, driven both ways.
    //
    // NOT REMEMBERED AS THE LAST-GOOD FOLD. `_refuseUnpaired` falls back to `_lastGoodFold`, and
    // `check-floor-pairing` requires that a client with nothing to hold answers EMPTY rather than a
    // room assembled across a gap — *an empty derive is not a lie about the past; a fabricated room
    // is.* Caching this would hand that fallback a room to show instead.
    //
    // AND IT MUST CHAIN — REDUNDANTLY, AND MUTATION SAYS SO. A seed sitting below what this client
    // has already trimmed to cannot be folded forward: the stretch between them is destroyed.
    // `_refuseUnpaired` already returns for exactly that case, above, so removing this clause
    // leaves every guard green (driven: M3). It is kept because it states the precondition at the
    // point a reader is working out what this fold means — and documented as redundant so nobody
    // later mistakes it for the enforcement, which is the note `floor.js` attaches to its own
    // redundant tier check for the same reason.
    const _floorNow = _trustedFloor();
    const _seedNow = _trustedSeed();
    const _chains = _floorNow && typeof _floorNow.floorL === "number"
      && (_trimmedBelow === null || _floorNow.floorL >= _trimmedBelow);
    if (_floorNow && _seedNow && _chains) {
      try {
        // Disjoint by construction: `_aboveCut` drops everything at or below the floor and the
        // seed supplies exactly that stretch, so nothing is counted twice.
        const seededOut = StateDeriver.deriveBoth(_aboveCut(ordered, _floorNow), _seedNow);
        if (seededOut && seededOut.state) {
          // ── THE DIVERGENCE, SAID OUT LOUD ────────────────────────────────────────────
          // Both views are already computed here and the comparison was being thrown away. In the
          // reported room that silence cost thirty `stale parent` lines and no statement of the
          // cause. One line naming it is the difference between a puzzle and a diagnosis.
          try {
            const a = genesis && genesis.state && genesis.state.nowPlaying;
            const b = seededOut.state.nowPlaying;
            const pa = a ? a.pi : null, pb = b ? b.pi : null;
            // ONLY MEANINGFUL WHILE THE GENESIS FOLD IS COMPLETE. Once anything has been dropped
            // from the derived log for sitting below a banked boundary, `genesis` is not "the
            // fold from the beginning" — it is the fold of what survived the trim, and it is
            // MISSING THE INPUTS the floor was built from. A play does not name its song; the
            // reducer pops it off the head DJ's queue, so dropping the early `ddjp.dj.join`s
            // leaves the first play with nothing to pop and the fold reaches `null` no matter how
            // healthy the client is.
            //
            // SO THIS FIRED FOREVER, IN EVERY ROOM THAT HAD EVER CHECKPOINTED PAST ITS FIRST
            // PLAY, on every ingest, on every client — including one that had authored every
            // event in the room. A warning that is always on is a warning nobody can act on, and
            // this one accused the reader of missing data they demonstrably held.
            if (pa !== pb && _derivedLogTrimmed === 0) {
              Logger.warn("StreamManager: MY OWN VIEW DISAGREES WITH THE ROOM'S SETTLED ACCOUNT — " +
                "folding from the beginning gives pi=" + pa + " but the floor at l=" +
                _floorNow.floorL + " banks pi=" + pb + ". Following the floor. This client is " +
                "missing an event below the cut, or resolved a same-position race from one side.");
            }
          } catch (e2) { /* a report that cannot be made is not a reason to lose the fold */ }
          return seededOut;
        }
      } catch (e) {
        Logger.warn("StreamManager: the seeded fold threw (" + ((e && e.message) || "unknown") +
          ") — using genesis for live state; the floor should be re-examined.");
      }
    }
    return genesis;
  }
  // canonical (key-order-insensitive) compare of the forward-relevant state — a seed rebuilds
  // objects in a different field order than a fresh fold, so only VALUE differences should count.
  function _canonAny(x) {
    if (Array.isArray(x)) return "[" + x.map(_canonAny).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + _canonAny(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  // ONE BEFORE-FORGETTING CHECK FOR BOTH ROOM TYPES (J73 job 7b). This licence compared only np, rot and
  // settings while a bot room's move-on compared every derived field a drop could change; a seed wrong
  // only in its live counts or its advance view validated here. Same field list, same live-song counts.
  function _canon(s) { const o = {}; for (const k of REPRODUCE_FIELDS) o[k] = _field(s, k); return _canonAny(o); }
  // Events that sort AFTER the trusted checkpoint's coverage (its `covers` = "$first..$last").
  // Returns null if we can't identify the boundary (then no seeded validation is attempted).
  function _eventsAfterCheckpoint(ordered) {
    let tr = null;
    try { if (typeof Floor !== "undefined" && Floor.current) tr = Floor.current(); }
    catch (e) {}
    if (!tr || typeof tr.covers !== "string") return null;
    const lastId = tr.covers.split("..")[1];
    if (!lastId) return null;
    const idx = ordered.findIndex((e) => e.eventId === lastId);
    if (idx < 0) return null;                     // we've forgotten the boundary or never had it
    return ordered.slice(idx + 1);                // strictly after the checkpoint's last covered event
  }

  // Pure display-shaping of the derived play-history, exposed on the interface so
  // the app never reaches into StateDeriver directly (StateDeriver is a BACKEND
  // internal; StreamManager + MatrixBridge are the only backend globals the app
  // may touch — enforced by check-boundaries). Delegates to the pure reducer helper.
  function projectHistory(history, opts) { return StateDeriver.projectHistory(history, opts); }

  // --- Reset on room change ---
  // The rooms this engine has ingested this room-session — so EventCache retires only THEIR raws (J73).
  const _roomsSeen = new Set();
  // A SWEEP OWED BY A LATE ARRIVAL below what this device forgot (`_bankedLate`); paid by any sweep, cleared on room entry.
  let _bankedOwed = false;
  // ANNOUNCED, NOT DONE HERE: this module decides what the room IS and must not reach a local-only store
  // (check-local-evidence). It says it forgot, and which rooms; the transport, which owns the raw cache,
  // lets go of what is now banked (`MatrixBridge._wireCacheRetire`).
  function _retireCached() {
    _bankedOwed = false;
    for (const fn of (subscribers["ddjp.local.forgot"] || [])) { try { fn({ rooms: Array.from(_roomsSeen) }); } catch (e) {} }
  }
  // A LATE ARRIVAL BELOW WHAT THIS DEVICE FORGOT (`ddjp_566`, HANDOVER item 3). The door banks it (`_bankedArrival`, kind "trimmed"),
  // but the transport cached the raw BEFORE the door judged it, and nothing retired that copy until some later trim happened to drop
  // something — live at `?v=519` the bot's cache held 26 such raws after every open, where the owner's held 2. So it is ANNOUNCED,
  // and the transport coalesces a burst (a replay delivers hundreds at once, and every sweep reads the whole cache) into one
  // `settleBanked`. Below an ACCEPTED boundary nothing is announced: nothing was forgotten there, and those raws are repair material
  // (`check-cache-held` F). Announced the way `ddjp.local.forgot` is — straight to its subscribers, never through `notify`.
  function _bankedLate() {
    _bankedOwed = true;
    for (const fn of (subscribers["ddjp.local.banked"] || [])) { try { fn({}); } catch (e) {} }
  }
  // PAY THE DEBT, against the room this engine is in NOW: a room entry clears it with everything else (`reset`), so a sweep the
  // transport scheduled before the change does nothing for the next room (`check-cache-held` E).
  function settleBanked() {
    if (!_bankedOwed) return false;
    _retireCached();
    return true;
  }
  // WHAT A FORGETTING DROPPED, AS HISTORY'S REACH: from just above the previous cut (when there is one) up to the new
  // cut. Without it the reach began at the first dropped event, and a save point's position between the cuts became a
  // false hole — the repeat rule went blind after every move-on (owner's test, `ddjp_534`; check-history-floor-reach A).
  // WHERE THE HELD LOG STARTS BEING COMPLETE: just above the adopted save point (a bot room) or the trimmed cut (a shared
  // room); null when nothing was forgotten. History covers the held log from here (owner's re-test).
  // THE INTERFACE TO THE SETTINGS RECORD (owner's repeat rule): since which position `key` has held its current value.
  function settingSince(key) {
    // The floor in force names the settings event it was sealed under, and that is the only owner
    // RESTORE ANCHOR the record may count (J79): an anchor whose restore never landed changed nothing.
    let named = null;
    try { const f = _trustedFloor(); named = (f && f.seed && f.seed.settingsFrom) || null; } catch (e) { named = null; }
    try { return (typeof SettingsProof !== "undefined" && SettingsProof.heldSince) ? SettingsProof.heldSince(key, named) : null; } catch (e) { return null; }
  }
  function heldFrom() {
    if (_adopted && typeof _adopted.floorL === "number") return _adopted.floorL + 1;
    if (typeof _trimmedBelow === "number") return _trimmedBelow + 1;
    return null;
  }
  function _droppedReach(prevCut, cut) {
    if (typeof cut !== "number") return undefined;
    return (typeof prevCut === "number" && cut > prevCut) ? { from: prevCut + 1, to: cut } : { to: cut };
  }
  function reset() {
    _proofKeep = [];
    eventLog = [];
    _roomsSeen.clear();
    if (typeof Activity !== "undefined") Activity.reset();   // a new room inherits no activity (J73 job 2)
    _heldBase = undefined;
    // AND THE PROOF THAT WENT WITH IT (`ddjp_566`, the owner's ruling on the `ddjp_565` finding). `_heldBaseH` names the floor this
    // device trimmed under, and two readers trust it as proved — `canProve` ("trimmed-under") and `_floorProves` (the forgetting
    // licence, which passes on it before asking for the boundary). Kept across a room entry it answered both from the LAST visit:
    // re-entering the same room, holding nothing below the floor, the device stood on it and trimmed under it with no fresh proof
    // (`check-reset-proof`). The device proves afresh.
    _heldBaseH = null;
    // AND THE STEP-A LINE'S MEMORY (owed since `ddjp_558`, owner's ruling: ridden with the next change to this file, J79).
    // Log-only: it names the floor the move-on line was last printed for, and a new room has printed none.
    _moveOnLogged = null;
    _bankedOwed = false;      // and a sweep the last room owed is not paid on this one's behalf
    _derivedLogTrimmed = 0;   // a new room's genesis fold is complete again
    derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
    // A NEW ROOM INHERITS NO BOUNDARY. Leaving _trimmedBelow set would make the next room fold
    // seeded against a floor from the room we just left.
    //
    // THE ACCEPTED BOUNDARY (J03) IS NOT CLEARED HERE, AND CANNOT BE. It is derived from
    // `Floor.current()` rather than stored, which is what makes withdrawal release it for free —
    // and the same property means this line cannot reach it. What clears it is `Floor.reset()`,
    // which `features/room.js` `_initModules` calls immediately after this one via
    // `MatrixBridge.resetCheckpoints()`. So the rule this comment states is now satisfied by a
    // PAIR of calls in another module rather than by this line alone. Named because it is exactly
    // the kind of cross-module precondition that reads as satisfied until somebody reorders a
    // wiring step; the new-room half of `check-forget-wiring` drives both together.
    _trimmedBelow = null; _trimmedBoundaryId = null; _headL = null; _headTs = 0;
    _roomHeads.clear(); _doorPerRoom = false;   // a reset is a new room: the shared-room default
    _adopted = null;
    _lastGoodFold = null; _pairingFault = null; _ignoredArrivals = null; _shortWithoutFloor = null;
    _historyComplete = null;
    // AND THE FLOOR THE LAST FOLD RAN UNDER (J47). Same rule as the boundary above: carried into
    // the next room it would make that room's first adoption compare against a signature from the
    // room we just left, match nothing, and simply re-derive once — harmless today, and exactly the
    // kind of stale per-room value `check-room-scope` exists to stop accumulating.
    _lastFoldedFloor = null;
    // AND NEITHER DOES A NEW ROOM INHERIT AN ORIGIN (J46). It is the same rule as the boundary
    // above and it is cleared on the same line for the same reason: an origin is a fact about ONE
    // room, and carrying it would make the next room fold from a seed belonging to the room we
    // just left — which is not merely wrong, it is wrong in the shape that looks like a working
    // room. It is also one half of the invariant the origin marker rests on: `Floor.reset()`
    // clears the floor in the same wiring step, so no client is ever left trimmed-and-floorless,
    // which is the state an honest sealer would publish the origin declaration from.
    _originDeclared = false;
    legalIds = null;
    _lastValidatedCp = null;
    // A validation verdict belongs to ONE room's log. Carrying it across a room change would
    // license forgetting in a room the check never ran against.
    _seedValidation = { status: "not-yet-run", reason: "no-checkpoint", sig: null, at: 0 };
    // AND THE FORK MEMORY (J34). Per-room by the same rule as every value above: a suspicion
    // is a fact about ONE room's fold, and carrying it into the next room would accuse that
    // room of the last one's fork — which reads as a diverged client rather than as a stale
    // flag, and is exactly the class `CONCEPTS.md` §3.11 lists across six modules with
    // "forgetting one" named. This is the seventh. `check-fork-notice` PART C drives it
    // through a real room change rather than asserting the line is present.
    _lastStaleRefusal = null; _forkSuspected = false;
    Logger.debug("StreamManager: reset");
  }

  // Is this event part of the derived timeline? The vouch layer's eligibility question.
  // A null cache (derive threw) answers `true`, so a failure here degrades to the old
  // type-only behaviour rather than silently making real history unvouchable.
  function isLegal(eventId) {
    if (!legalIds) return true;
    return !!legalIds[String(eventId)];
  }
  // `legalSet()` lived here: a whole-map copy of the accepted set, exported and referenced by
  // NOTHING — no production file and no guard. What the vouch layer actually receives is the
  // `isLegal` predicate, handed in at four sites in matrixbridge.js. Deleted in J02 (found by a
  // sweep, verified by reading; 03-modules.md named it as part of the live mechanism and no
  // longer does).

  // The reducer's accepted setting ranges, passed through so the app can render a control that
  // matches what the reducer will actually accept. features/ and ui/ may not reach StateDeriver.
  //
  // A FRESH COPY PER CALL, INCLUDING THE `values` ARRAYS (J07). This used to hand out the reducer's
  // own table BY REFERENCE, which was harmless only for as long as every entry was three numbers a
  // caller had no reason to touch. `minDjRank`'s entry carries a `values` ARRAY — the vocabulary the
  // reducer will accept — and the panel renders one option per entry in it, so by reference a
  // renderer could `push` a rank name into the reducer's own legal set and the fold would then
  // accept a value nobody declared. Same rule and same reason as `blockedReasons()` below and as
  // `Ranks.defaultVouchTable()`: a shared array handed to a caller is the caller's array now.
  function settingRanges() {
    try {
      const out = {};
      const src = StateDeriver.SETTING_RANGES || {};
      for (const k in src) {
        const r = src[k] || {};
        const copy = {};
        for (const f in r) {
          // A MAP entry declares its key domain as a FUNCTION so it can be derived from
          // `defaultSettings()` at call time rather than frozen at module construction (J17). It is
          // RESOLVED here rather than passed across: this seam exists so the feature layer never
          // reaches `StateDeriver`, and handing it a callable into the reducer would be handing it
          // exactly that by another route — `check-boundaries` rule F is textual and would not
          // notice, but the reason it exists would. Resolved to a fresh array, which is the same
          // defensive copy every other field gets.
          if (typeof r[f] === "function") { try { copy[f] = r[f]().slice(); } catch (e) { copy[f] = []; } }
          else copy[f] = Array.isArray(r[f]) ? r[f].slice() : r[f];
        }
        out[k] = copy;
      }
      return out;
    } catch (e) { return {}; }
  }

  // The reducer's OWN default settings blob, re-exported for the app. Same reason and same
  // shape as settingRanges above: features/ may not reach StateDeriver (check-boundaries rule
  // F), and a hand-copied literal in the feature layer is precisely the drift that left the
  // settings panel rendering blank dials. Returned as a fresh object per call so no caller can
  // mutate the reducer's defaults out from under everyone else.
  function defaultSettings() {
    try { return StateDeriver.defaultSettings(); } catch (e) { return {}; }
  }

  // The reducer's typed "can't play" vocabulary, passed through for the same reason and in the
  // same shape as settingRanges above: `features/mediablocked.js` maps a player error code onto
  // one of these tokens, and features/ may not reach StateDeriver (check-boundaries rule F). So
  // the reporter reads the list the reducer will actually accept instead of restating it — the
  // relationship the settings panel already has with SETTING_RANGES, for the same reason.
  //
  // TWO HOMES, TWO QUESTIONS, and they are deliberately not the same table. The reducer owns
  // *which tokens exist and which count*; the feature owns *which player error maps to which
  // token*. Fresh object per call, so no caller can edit the protocol out from under the fold.
  function blockedReasons() {
    try {
      const out = {};
      const src = StateDeriver.BLOCKED_REASONS || {};
      for (const k in src) out[k] = { counts: !!src[k].counts };
      return out;
    } catch (e) { return {}; }
  }

  // ── THE EXPORT SEAM (J26) ────────────────────────────────────────────────────────────────
  // `CheckpointFormat` and `Floor` are walled backend internals (check-boundaries rule F), so
  // nothing in features/ or ui/ can reach `saveFile` or the held list at all. That is why J26's
  // FIRST task is this passthrough and not the UI its Touches field names first — the serialiser
  // J25 built has had no production caller since the day it was written, which is the
  // SettingsProof.readBack shape filed knowingly rather than discovered later.
  //
  // RANK LEAVES HERE AS A NAME, NEVER AS A NUMBER. `_seen` carries `r`, a Matrix power level, and
  // outside the backend a rank is a name (check-boundaries rule H). Resolving it here is not
  // politeness: handing the level out would make the picker's "group by the rank that authored
  // them" a numeric comparison in the UI, which is a build failure and rightly so.
  //
  // AND THE AUTHOR'S MATRIX ID DOES NOT LEAVE AT ALL. The build law's "never show a raw Matrix ID"
  // has one deliberate exception and it is the viewer's OWN id. Grouping is by rank, which is what
  // the job asks for, so the id is not needed above this line and is not passed.
  function heldCheckpoints() {
    try {
      const held = (typeof Floor !== "undefined" && Floor.heldCheckpoints) ? Floor.heldCheckpoints() : [];
      return held.map((e) => ({
        id: e.h,
        rank: (typeof Ranks !== "undefined" && Ranks.nameOf) ? Ranks.nameOf(e.r) : null,
        // THE SERVER STAMP, PASSED THROUGH UNCHANGED, AND null WHEN THERE ISN'T ONE. A checkpoint
        // this client sealed itself is adopted before the event exists anywhere, so it has no
        // arrival time until its own copy syncs back (floor.js, "DATING A FLOOR I SEALED MYSELF").
        // Substituting Date.now() here would put a device clock where the room expects a server
        // one (P2) — in a label whose whole purpose is to be compared against other clients'.
        // The renderer is told "unknown" and says so.
        at: (typeof e.ts === "number") ? e.ts : null,
        covers: e.covers, floorL: e.floorL, n: e.n, thin: e.thin === true,
        era: CheckpointFormat.eraOf(e),                // `ddjp_571`: its restart, for the saves list and the export
      }));
    } catch (e) { return []; }
  }

  // Build the save file for one held checkpoint, chosen by its fingerprint.
  //
  // WHAT GOES IN, AND WHY IT IS NOT ALWAYS ONE SNAPSHOT. `readFile` admits an owner-authored file
  // at one snapshot (an owner floor is adopted on authority with no recompute) and refuses a
  // peer-authored one below two, because a peer file has to carry a chain the importer can fold.
  // So the file's SUBJECT is the pick, and everything held at or below the pick's cut rides along
  // as the chain material that makes it readable. Driven: probe-j26-export.js R8 — the same pick
  // alone answers `chain-too-short` and with its predecessors answers ok.
  //
  // NO PAGING. The Open asked whether export should fetch more first; it must not, and R7 is why —
  // what a short client lacks is the joining SEGMENT, not more snapshots, so paging checkpoints
  // buys nothing the chain needs. `importable` reports the answer instead, computed from what is
  // already held, so the cost of finding out is zero.
  //
  // `hist` IS DELIBERATELY NOT POPULATED. J25 settled that the format CAN carry a play-log tail in
  // the optional `hist?` section; whether export fills it is a separate question and its own
  // entry's Done-when does not ask for it. Filling it would mean a new StreamManager -> History
  // arrow for display data that `checkpoint-contents.md` §2 forbids sealing into the seed anyway,
  // and the cap is still design rather than measurement. Omitted, never nulled — which is the
  // format's own rule for an absent optional section.
  function exportCheckpoint(id) {
    try {
      if (typeof CheckpointFormat === "undefined" || !CheckpointFormat.saveFile) {
        return { ok: false, reason: "no-format-module" };
      }
      const held = (typeof Floor !== "undefined" && Floor.heldCheckpoints) ? Floor.heldCheckpoints() : [];
      const pick = held.find((e) => e.h === id);
      if (!pick) return { ok: false, reason: "not-held" };
      if (typeof pick.floorL !== "number") return { ok: false, reason: "unplaceable" };

      // Ordered by POSITION, the same key the chain fold uses — never by the author's private
      // seal counter `n`, which runs from whatever that author last trusted and is incomparable
      // across authors (floor.js, `_pos`).
      // ONE RESTART AT A TIME (J79; by restart since `ddjp_571`): what sits under a restore belongs to
      // the room it replaced, so a file saved after one carries the restore and what was sealed since,
      // never the old room's save points.
      const _rs = (Floor.restartOf ? Floor.restartOf(pick) : { era: 0, root: null });
      const _same = (e) => !Floor.restartOf || CheckpointFormat.compareRestart(Floor.restartOf(e), _rs) === 0;
      const _all = held
        .filter((e) => typeof e.floorL === "number" && e.floorL <= pick.floorL && _same(e))
        .sort((a, b) => a.floorL - b.floorL);
      // FROM THE NEWEST ORIGIN AT OR BELOW THE PICK (J79) — within the restart, an era-0 room's own
      // J28 restore (no restart number) still starts its file.
      let _o = 0;
      for (let i = 0; i < _all.length; i++) if (!_all[i].prev && _all[i].thin === true) _o = i;
      const chain = _all.slice(_o)
        .map((e) => {
          const o = { t: CheckpointFormat.TYPE, n: e.n, prev: e.prev || null, seed: e.seed,
                      floorL: e.floorL, thin: e.thin === true, covers: e.covers, h: e.h };
          if (CheckpointFormat.eraOf(e) > 0) { o.era = e.era; if (e.root) o.root = { l: e.root.l, id: e.root.id }; }   // committed: it travels (`ddjp_571`)
          return o;
        });

      const rankName = (typeof Ranks !== "undefined" && Ranks.nameOf) ? Ranks.nameOf(pick.r) : null;
      const ownerAuthored = (typeof TrustPolicy !== "undefined" && TrustPolicy.tierOf)
        ? TrustPolicy.tierOf(pick.r) === 0 : false;
      const file = CheckpointFormat.saveFile({
        mode: "full",
        snapshots: chain,
        keyset: Object.keys(defaultSettings()),
        author: { rank: rankName },
      });
      return {
        ok: true, reason: null, file: file,
        // Stated BEFORE the file is written, so the control can say what it will be good for.
        //
        // CORRECTED AT J27, AND THE CORRECTION IS THE MEASUREMENT. This read
        // `ownerAuthored || chain.length >= 2` — the condition `readFile` applies, asked the
        // EXPORTER's way: re-read here, with this client's own log, a two-snapshot peer file
        // verifies. Asked the IMPORTER's way it does not, and cannot: `Floor.chainVerifies` folds
        // the log BETWEEN the cuts and a room that does not exist holds none of it, so every peer
        // file is refused however long its chain (probe-j27-import.js R2, R3, R10). A flag saying
        // otherwise is a control lying to the person about what they just saved — the false
        // narrative `roles.md` §10 names, on the one line stated before the click.
        //
        // The export itself is UNCHANGED: J26's Done-when is that a client shows what it has
        // rather than an error, and a peer file is still written. Only the promise about it moved.
        importable: ownerAuthored,
        ownerAuthored: ownerAuthored, snapshots: chain.length, rank: rankName,
      };
    } catch (e) { return { ok: false, reason: "export-failed" }; }
  }

  // ── THE IMPORT SEAM (J27) ────────────────────────────────────────────────────────────────
  // The other half of J26's passthrough. `CheckpointFormat` is a walled backend internal, so
  // `readFile` had no production caller from the day J25 wrote it — a guard exercising a module is
  // not a caller, and this tree keeps finding that shape (`SettingsProof.readBack`,
  // `MediaBlocked.reportCannotSee`). This is the caller.
  //
  // ── DRIVEN FIRST, AND IT CHANGED THE JOB ──────────────────────────────────────────────────
  // `Floor.chainVerifies` locates each cut by INDEX into the event log and bails on
  // `from <= 0 || to < 0`. A room that does not exist yet has no log, so every index resolves to
  // -1 and a peer chain fails before any fold. Measured (`tools/probes/probe-j27-import.js`):
  //   R1  the same two snapshots verify WITH the exporting client's log        -> true
  //   R2  the same two snapshots with an empty log                             -> false
  //   R3  2, 3 and 4 snapshots with an empty log                               -> false, false, false
  // So the peer path is unreachable at import BY CONSTRUCTION, not for being short. R3 is the row
  // that matters: it varies the axis the framing reaches for (scarcity) and shows the answer does
  // not move, which is what makes this structural rather than a fixture that reached nothing.
  //
  // WHAT A PEER FILE IS TOLD, AND WHY THE ORDER IS THE RULE. Left to itself `readFile` answers
  // `chain-too-short` or `chain-refused` — both true and both UNACTIONABLE here: an operator told
  // "chain refused" re-exports, and no re-export can fix it, because what is missing is the
  // joining SEGMENT of a room this client will never hold. That is exactly the distinction J25
  // drew when it put the keyset diagnosis ahead of the chain check, arriving one seam later. The
  // refusal is therefore translated into one that names the real remedy — ask the room's owner for
  // an owner-authored file — and it is translated AFTER `readFile` has run, so a corrupt peer file
  // still reports its corruption rather than being blamed on its provenance.
  //
  // THE VERIFIER IS GIVEN AN EMPTY LOG DELIBERATELY, not left to default. This client may still
  // hold the last room's events — `Floor.reset()` runs on room ENTRY, never on leave, which is the
  // same fact that makes J26's lobby control possible. A foreign log verifying a chain about
  // another room is the room-scope hazard `roles.md` §7b fails closed on, so the log of the room
  // being created is stated as what it is: empty.
  //
  // ── AND THE AUTHORSHIP COMPARISON DOES NOT TRANSFER TO THIS SEAM ──────────────────────────
  // `readFile` compares the file's `author` declaration against the CALLER's belief. Driven (R5,
  // R6): the comparison discriminates on the file's field in both directions — but the same forged
  // file is admitted or refused by the belief alone, and at import the caller has nothing to form a
  // belief FROM. There is no channel, no prior state, and no room id anywhere in the file. So the
  // belief passed here is the file's own declaration, and the comparison is, at this call site,
  // vacuous by construction. That is stated rather than hidden, because a check that reads as
  // security and is not is the false-narrative failure `roles.md` §10 names.
  //
  // FORGING `owner` STILL BUYS NOTHING, for a reason that has nothing to do with the comparison.
  // The room being created belongs to the importer. Its ranks come from its own channels, which
  // only the importer can write; the seed carries no ranks at all (R7: the per-member fields are
  // `orderKey` and `pending`, and `rankByUser` was deleted); and `author.rank` is read by nothing
  // downstream of here. What the declaration decides at import is READABILITY and nothing else.
  function importFile(file) {
    try {
      if (typeof CheckpointFormat === "undefined" || !CheckpointFormat.readFile) {
        return { ok: false, reason: "no-format-module", detail: null };
      }
      const declaredOwner = !!(file && file.payload && file.payload.author
                               && file.payload.author.rank === "owner");
      const emptyRoomVerify = (snaps) =>
        ((typeof Floor !== "undefined" && Floor.chainVerifies) ? Floor.chainVerifies(snaps, []) : false);

      const read = CheckpointFormat.readFile(file, {
        keys: Object.keys(defaultSettings()),
        ownerAuthored: declaredOwner,
        chainVerify: emptyRoomVerify,
      });

      if (!read.ok) {
        if (!declaredOwner && (read.reason === "chain-too-short" || read.reason === "chain-refused")) {
          return { ok: false, reason: "peer-file-unimportable", declaredRank: _declaredRank(file),
            detail: "a peer-authored file is verified by folding the log BETWEEN its snapshots, and "
              + "a room that does not exist yet holds none of it — so this cannot be fixed by "
              + "exporting again or by exporting more. Ask the room's owner for an owner-authored "
              + "file, which is adopted on authority and needs no fold." };
        }
        return { ok: false, reason: read.reason, detail: read.detail || null,
          missingKeys: read.missingKeys || null, extraKeys: read.extraKeys || null };
      }

      // THE SUBJECT IS THE NEWEST CUT. An owner pick exports with whatever chain material this
      // client held at or below it, so a file may legitimately carry more than one snapshot even
      // on the path that needs only one. Ordered by POSITION, never by the author's private seal
      // counter `n`, which is incomparable across authors.
      const placeable = read.snapshots.filter((c) => Number.isSafeInteger(c.floorL));
      if (!placeable.length) return { ok: false, reason: "unplaceable-snapshots", detail: null };
      const subject = placeable.slice().sort((a, b) => a.floorL - b.floorL).pop();
      if (!subject.seed || typeof subject.seed !== "object") {
        return { ok: false, reason: "no-seed-in-snapshot", detail: null };
      }

      return {
        ok: true, reason: null, detail: read.detail || null,
        seed: subject.seed,
        // MERGED OVER THE CURRENT DEFAULTS so the blob the importer posts is COMPLETE.
        // `settingsBlobComplete` requires every key this build declares, and a partial blob makes
        // the settings claim `unverifiable` for the life of the room.
        settings: Object.assign(defaultSettings(), subject.seed.settings || {}),
        mode: read.mode, version: read.version,
        snapshots: read.snapshots.length,
        warning: read.warning || null, missingKeys: read.missingKeys || null,
      };
    } catch (e) { return { ok: false, reason: "import-failed", detail: null }; }
  }

  function _declaredRank(file) {
    try { return (file.payload.author && file.payload.author.rank) || null; } catch (e) { return null; }
  }

  // Publish the checkpoint the new room will carry. Passed through to `Checkpoint`, which is the
  // module that emits snapshots — the seam adds no format knowledge and names no wire type of its
  // own, and neither does the feature layer above it.
  function importCheckpoint(seed, anchor) {
    try {
      if (typeof Checkpoint === "undefined" || !Checkpoint.publishImport) {
        return Promise.resolve({ ok: false, reason: "no-checkpoint-module" });
      }
      return Checkpoint.publishImport(seed, anchor);
    } catch (e) { return Promise.resolve({ ok: false, reason: "import-checkpoint-failed" }); }
  }

  // ── THE RESTORE'S PRE-FLIGHT: EVERYTHING THAT CAN BE KNOWN BEFORE ANYTHING IS POSTED (J79) ────
  // `features/room.js` asks this after the file has been read and before its first post, so a
  // restore that cannot finish is refused while the room is still untouched. The engine answers
  // for its own placement, and says whether the restore needs a settings ANCHOR: in this engine it
  // does — the checkpoint lives on its own channel and names the settings event its forget licence
  // reads (`SettingsProof`), and the anchor is inert in the fold until the checkpoint names it
  // (`StateDeriver.isRestoreAnchor`). Authority and placement come from `Checkpoint`'s own answer
  // (`mayPublishImport`), the one `publishImport` asks again at the moment of posting; the seed is
  // built once, dry, against a provisional anchor, so a seed that cannot be fingerprinted (the
  // integer contract, `roles.md` §4) is refused here rather than after the anchor has landed.
  function planRestore(seed) {
    try {
      if (typeof Checkpoint === "undefined" || !Checkpoint.buildImport || !Checkpoint.mayPublishImport) {
        return { ok: false, reason: "no-checkpoint-module", detail: null };
      }
      const may = Checkpoint.mayPublishImport();
      if (!may.ok) {
        return { ok: false, reason: may.reason === "no-send" ? "cannot-place" : may.reason,
          detail: may.reason === "no-send" ? "this client has no checkpoints channel it can write to" : null };
      }
      const dry = Checkpoint.buildImport(seed, { settingsFrom: "$plan", eventId: "$plan", l: 1 });
      if (!dry.ok) return { ok: false, reason: dry.reason, detail: null };
      if (!StateDeriver.isSeed(dry.cp.seed) || !CheckpointFormat.verify(dry.cp)) {
        return { ok: false, reason: "unbuildable-seed", detail: null };
      }
      return { ok: true, reason: null, detail: null, anchored: true };
    } catch (e) { return { ok: false, reason: "unbuildable-seed", detail: (e && e.message) || null }; }
  }

  return {
    refusalOf, ingest, normalise, normaliseAll, setDoorScope, doorScope, adoptFloor, floorSeed, on, off, getState, getLog, rotationEntries, projectHistory, reset, isLegal, settingRanges,
    defaultSettings, blockedReasons, heldCheckpoints, exportCheckpoint, importFile, importCheckpoint, planRestore,
    trimToFloor, canProve, restoreBelow, fetchBack, proofLog, proofKept, settleBanked, forgettingLicensed, disagreesWithFloor, holdsWholeRoom, heldFrom, settingSince, olderActivity, reproduces, adoptedFloor, _trimState, _originState, pairingFault, ignoredArrivals, shortWithoutFloor, setHistoryComplete, _setLicenceForTest, _setLogForTest /* exposed for the guard */,
    seedValidation, seedLicensesForget };
})();

// ── REGISTER THIS SLOT WITH THE SEAM (J23) ─────────────────────────────────────────────────
// `core/backends.js` owns the four interface names now; this hands it backend1's stream half.
// The module above declares itself `B1StreamManager` and not `StreamManager` because the latter
// is the shared shell: two top-level `const`s of one name in a classic script is a SyntaxError,
// and the shell has to be the one that wins so the binder can swap what features/ sees.
Backends.register("backend1", { StreamManager: B1StreamManager });
