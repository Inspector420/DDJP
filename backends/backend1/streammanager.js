// backends/backend1/streammanager.js
// Single inbound entry point for all protocol events.
// Maintains ordered log, derives state, notifies subscribers.
// Depends on: StateDeriver, Logger, Backends. Reads Floor, TrustPolicy, SettingsProof, Session,
// Activity, History, Vouch and MatrixBridge when they are loaded.

const B1StreamManager = (() => {
  let eventLog = [];
  // How many events have been dropped from the DERIVED LOG for sitting below a banked boundary.
  // They are still held and still servable for repair — this counts only what the fold cannot
  // see, which is exactly what makes a "fold from the beginning" comparison meaningless.
  let _derivedLogTrimmed = 0;
  let derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
  let legalIds = null, heldIds = null;   // eventId -> true: the reducer-accepted set; and every event that fold was GIVEN (J89; see isLegal)
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
  let _cannotTellOn = null;      // { sig, reach }: "cannot tell" (`log-not-from-start`) for that save point over that reach (ddjp_645)
  // Signature of the floor the current fold was derived under, so adoption can re-derive exactly
  // once per floor change rather than on every call (J47). Per-room, and cleared by `reset()` in the
  // same step as the boundary — a value surviving a room change would make the next room's first
  // adoption look like a no-op.
  // WHICH CHECKPOINT IS THIS — asked at several sites here; what they gate is the adoption re-derive (`trimToFloor`), the
  // validation record (which decides `disagreesWithFloor`, and so sealing) and the J73 predicate `seedLicensesForget`. The
  // answer belongs to `Floor`, which owns the floor, so it is READ rather than recomputed — built
  // independently in both modules it was the same expression twice, and a licence keyed on one shape
  // then compared against another is one edit away. Falls back only if Floor is absent, which is the
  // headless-fixture case; `null` then, so a missing floor never accidentally equals a record.
  // FALLING BACK TO `null` WOULD SILENTLY DISABLE EVERY CHECK KEYED ON THIS — the validation record
  // would never match a floor, so a sound seed would read `not-yet-run` forever (until step 5b that stopped forgetting; it
  // would still blind the seal check). Driven: written that way first, `check-seed-validation` went red naming exactly
  // that. A guard loading `streammanager` without `floor` is a legitimate fixture, so the fallback
  // computes the same answer rather than refusing to answer — one shape, stated twice, with the
  // second stated as a fallback rather than as a peer.
  const _sigOf = (f) => {
    try { if (typeof Floor !== "undefined" && Floor.sigOf) return Floor.sigOf(f); } catch (e) {}
    return f ? (f.n + ":" + (f.h || "")) : null;
  };
  let _lastFoldedFloor = null;
  // PRE-FORGET VALIDATION RECORD (J73). Until step 5b (`ddjp_554`) this was the licence to forget; it is a diagnostic now —
  // forgetting follows `_provesForForgetting` (a shared room) or the adoption (a bot room) — and it decides whether this
  // tab may seal on a floor (`disagreesWithFloor`). Forgetting drops the log the check reads, so there is exactly one chance
  // to run it, and "we saw no warning" must not be the signal.
  //   validated    — seeded fold reproduced the genesis queue at this cut.
  //   mismatched   — it ran on the whole room and disagreed. Conclusive: do not retry; this tab does not seal on it.
  //   not-yet-run  — it did not conclude (threw, still replaying, the covered boundary could not be located, or it differed
  //                  on a log that is not the whole room: `set-aside-below-floor`, `log-not-from-start`, `ddjp_627`).
  //                  NOT a pass. Retried on the next ingest, because the reason is usually
  //                  transient and the throttle key is deliberately left unset — except `set-aside-below-floor`, which
  //                  cannot change while this room is open (what the door set aside stays out of the log), so it is asked once.
  let _seedValidation = { status: "not-yet-run", reason: "no-checkpoint", sig: null, at: 0 };
  function _recordValidation(status, reason, sig, settled) {
    _seedValidation = { status: status, reason: reason || null, sig: sig || null, at: Date.now() };
    // THROTTLE ONLY ON A CONCLUSION. Marking the signature before the derive (as this used to do)
    // meant a throw recorded the checkpoint as checked and never retried it — a silent pass for
    // work that never happened, which is the failure signature this codebase is built around.
    if (status === "validated" || status === "mismatched" || settled === true) _lastValidatedCp = sig || null;
    if (reason !== "log-not-from-start") _cannotTellOn = null;
  }
  // WHAT THE TAB HOLDS, AS FAR AS THE GENESIS CHECK READS IT (`ddjp_645`): its first held event, what the door set aside, and
  // the trim. A "cannot tell" because the log does not reach the room's start — the bot's tab, typically — is NOT recorded as
  // checked (a non-conclusion never is, above), but it is not asked again while the save point and this reach are the same:
  // asking again only folds the seed over the same partial log at every arrival, on the tab that should stay lightest.
  // Paging further back, a set-aside, a trim or a new save point changes the key, and the check runs again.
  function _reachOf(ordered) {
    const first = (ordered && ordered.length) ? ordered[0] : null;
    return (first ? first.l + ":" + first.eventId : "none") + "|" + _derivedLogTrimmed + "|" + (_trimmedBelow === null ? "-" : _trimmedBelow);
  }
  // Queryable, so callers ask a question instead of inferring one from the absence of a log line.
  function seedValidation() { return Object.assign({}, _licenceOverride || _seedValidation); }
  // The J73 licensing predicate, kept separate from the record so the rule has ONE home. Detection is
  // not response (consensus-models §2): a mismatch is recorded, never acted on here.
  // ASKED BY NOTHING IN PRODUCTION SINCE J107: a shared room's trim and raw cache ask `_provesForForgetting` (step 5b,
  // `ddjp_554`), and a bot room forgets only when it adopts a save point. Kept as the rule the guards drive, and what
  // `EventCache`'s dry run reports where `seedValidation` is missing.
  function seedLicensesForget() {
    // Reads through seedValidation() so the guard seam reaches the PREDICATE and not only the report.
    // It did not, and the first version of the wiring guard passed on that: the forced "mismatch"
    // case was already failing for an unrelated reason, so it proved nothing.
    const v = seedValidation();
    if (v.status !== "validated") return false;
    // AND IT MUST BELONG TO THE FLOOR IT IS ABOUT TO BE SPENT ON. The record is keyed by checkpoint
    // signature and re-run inside `_deriveBest` — on a FOLD — while this predicate was read (until step 5b) by
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

  // The fold's refusal channel for the CURRENT log, recomputed lazily and cached per fold. Purely
  // DIAGNOSTIC in this module: read for a log line, for the Feed tab's refused lines through
  // `refusalOf` (ddjp_455), and by the act-answer channel (`MatrixBridge.awaitAnswer`, J65), whose
  // "no" features act on (UserQueue gives up a join). The bot engine inherits it: its ingest feeds this log.
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

  // The events that CHANGE WHICH SONG IS PLAYING. Written out rather than inferred, because this
  // list decides only what gets reported and where the AFK replay re-derives (`AFFECTS_ROTATION`, one tab's reading,
  // never sealed), and must never drift into deciding what gets folded.
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

  // --- Ingest — called by MatrixBridge, and by backend2's StreamManager for a bot room ---
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

  // ── J71 ITEM 1: A PRINTED VERDICT THAT CHANGES IS SAID TO HAVE CHANGED (the owner's approval; `ddjp_632`) ──────────────────
  // The ORDER line in `ingest` prints each advance's verdict as it arrives, stamped `finalAtIngest`, because `l` is the sort key:
  // an event arriving LATER but sorting EARLIER re-orders the fold and can change a verdict already printed, and nothing said so
  // (the twenty-first signature). J71's `ddjp_561` study: a late join turned l=98's printed ACCEPTED into the room's REFUSED, and
  // the owner's two opens of one room read as two rooms. So the verdicts the ORDER line printed are remembered — only those, and
  // only for events still held (a trim or a save point that drops one forgets it) — and after each re-derive, the one the fold
  // already does, each is read again from that fold (`isLegal` and the refusal channel; no second fold). A change is said once:
  //   StreamManager: REVISED <type> l=<l> id=<id> — was <verdict>, now <verdict> (after <type> l=<l> id=<id> arrived) | now playing …
  // naming the arrival that changed it — or, where no arrival did, the re-derive that did (a save point adopted, a trim, a
  // fetch-back) — and what is playing now when this re-derive moved it.
  // WHILE LOADING, ONE SUMMARY (the owner's choice on noise). A tab in a room and not yet live (replaying, catching up, suspended)
  // says nothing per change, and one line when it goes live: how many changed, and the first few by position. A verdict that
  // changed and changed back is not counted. A tab with no phase machine, or out of a room, says each change as it happens.
  // A LOG LINE ONLY: it reads the fold's own answers and writes nothing a seed, a fingerprint or a verdict reads (the twenty-third
  // signature); a line that cannot be built or said is dropped and the ingest goes on. Items 2 and 3 of J71 (sealing, and the
  // rule for late arrivals) stay open, the owner's. `tests/check-revised-verdict.js`.
  const _said = new Map();            // eventId -> { type, l, v }: the verdict last printed for it (its ORDER line, or a REVISED line)
  const _revisedLoading = new Map();  // eventId -> { id, type, l, was, now }: changed while loading, said when the tab goes live
  let _liveWatched = false;           // Session's change bus: subscribed once a page, when first needed
  const _REVISED_FIRST = 3;           // how many the summary names
  function _verdictNow(id) {
    if (!legalIds) return null;       // the fold threw: it cannot say
    const took = isLegal(id);
    if (took === null) return null;   // not given to this fold (at or below a save point's cut): it cannot say
    if (took) return "ACCEPTED";
    const r = _refusalFor(id);
    return "REFUSED (" + ((r && r.code) || "no reason recorded") + ")";
  }
  function _noteSaid(entry) {
    try { const v = _verdictNow(entry.eventId); if (v) _said.set(String(entry.eventId), { type: entry.type, l: entry.l, v: v }); } catch (e) {}
  }
  function _loadingRoom() {
    try {
      if (typeof Session === "undefined" || !Session.phase) return false;   // no phase machine is not "loading"
      const p = Session.phase();
      return p !== Session.LIVE && p !== Session.COLD;
    } catch (e) { return false; }
  }
  function _watchLive() {
    if (_liveWatched) return;
    try {
      if (typeof Session === "undefined" || !Session.onChange) return;
      Session.onChange((ch) => { if (ch && ch.to === Session.LIVE) _sayRevisedWhileLoading(); });   // Session hands one { from, to, reason }
      _liveWatched = true;
    } catch (e) {}
  }
  const _playingWords = (np) => (np && np.song ? np.song.videoId : "nothing") + " pi=" + (np ? np.pi : "-");
  function _reviseSaid(cause, npBefore) {
    if (!_said.size) return;
    try {
      const held = new Set(eventLog.map((e) => e && e.eventId));
      const loading = _loadingRoom();
      const npNow = derivedState && derivedState.nowPlaying;
      const moved = (npBefore ? npBefore.pi : null) !== (npNow ? npNow.pi : null);
      const a = cause && cause.arrival;
      const why = a ? "after " + a.type + " l=" + a.l + " id=" + a.eventId + " arrived"
                    : "after " + ((cause && cause.why) || "a re-derive") + ", not an arrival";
      for (const [id, s] of _said) {
        if (!held.has(id)) { _said.delete(id); _revisedLoading.delete(id); continue; }   // no longer held: forgotten
        const v = _verdictNow(id);
        if (!v || v === s.v) continue;
        if (loading) {
          const p = _revisedLoading.get(id);
          _revisedLoading.set(id, { id: id, type: s.type, l: s.l, was: p ? p.was : s.v, now: v });
          _watchLive();
        } else {
          try {
            Logger.info("StreamManager: REVISED " + s.type + " l=" + s.l + " id=" + id + " — was " + s.v + ", now " + v +
              " (" + why + ")" + (moved ? " | now playing " + _playingWords(npNow) : ""));
          } catch (e) {}
        }
        s.v = v;
      }
    } catch (e) { /* a line that cannot be said is not a reason to lose the fold */ }
  }
  function _sayRevisedWhileLoading() {
    try {
      const all = Array.from(_revisedLoading.values()).filter((x) => x.was !== x.now);
      _revisedLoading.clear();
      if (!all.length) return;
      all.sort((x, y) => (x.l - y.l) || (x.id < y.id ? -1 : 1));
      const n = all.length;
      Logger.info("StreamManager: REVISED while this tab was loading or catching up with the room — " + n +
        (n === 1 ? " verdict printed on an ORDER line" : " verdicts printed on ORDER lines") + " changed as later events arrived: " +
        all.slice(0, _REVISED_FIRST).map((x) => x.type + " l=" + x.l + " id=" + x.id + " was " + x.was + ", now " + x.now).join("; ") +
        (n > _REVISED_FIRST ? "; and " + (n - _REVISED_FIRST) + " more" : "") +
        ". Each ORDER line is the verdict at ingest; these are the verdicts now");
    } catch (e) {}
  }
  // Guard seam: what is remembered, by id in the order printed, and how many changes a loading tab owes its summary.
  function _revisedForTest() { return { said: Array.from(_said.keys()), pending: _revisedLoading.size }; }

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
      if (!_adopted) _noteSetAside(raw.event_id, protocolL);   // what a fold from the held base now lacks (J93)
      Logger.debug("StreamManager: ignoring " + protocolType + " l=" +
        ((typeof protocolL === "number") ? protocolL : 0) + " — already banked below the " +
        _bank.kind + " boundary at l=" + _bank.at +
        (_bank.kind === "accepted" ? " (held, and still servable for repair)" : ""));
      if (_bank.kind === "trimmed") _bankedLate();   // below what this device FORGOT: the raw cache's copy may go too (ddjp_566)
      if (_bank.kind === "accepted" && !_adopted) _setAsideLate();   // set aside: its acts and additions are taken once its stretch is whole (J95)
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
    // when pre-checkpoint events are missing. While the full log is still held, _deriveBest also
    // folds genesis and checks the seed against it: a mismatch is RECORDED (and, on complete data,
    // withholds sealing); live state still follows the floor. All derivation is pure; the seed
    // never sets state by assertion.
    // The fold, and with it the LEGAL set — the reducer-accepted ids the vouch layer selects from,
    // so protection is only ever spent on events the reducer actually took. Both come from _refold
    // now: they were written out here, which is why trimming had no way to redo the fold without
    // duplicating it. The arrival rides along for one reader: the REVISED line names it (J71 item 1).
    _refold({ arrival: entry });

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
      // LATER but sorts EARLIER re-orders the fold and can change a verdict already printed. **A
      // log showing two ACCEPTED plays can therefore describe a room that accepted one** — and
      // since J71 item 1 (`ddjp_632`) a REVISED line says when a printed verdict changes (the
      // block above `ingest`; while the tab is loading, one summary when it goes live).
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
      _noteSaid(entry);   // what this line prints is remembered, so a later change to it can be said (J71 item 1)
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
  // module, `MatrixBridge` and `MatrixAccount` (check-boundaries rule F), and the bot asking `StateDeriver`
  // directly was caught by that guard on the first run. The rule is right: a feature that folds
  // for itself is a second reducer.
  //
  // NOT DERIVED STATE, AND DELIBERATELY NOT SEALED. It is one client's reading of a log whose
  // reach is bounded, so two clients holding different amounts of history get different answers —
  // which is exactly why it must never enter the seed. Putting the same fact on the rotation
  // projection was tried and reverted: five guards caught a genesis fold disagreeing with a seeded
  // one, which is two clients disagreeing about who is idle.
  //
  // Cost, measured again at J105 (a room of plays, votes and joins): about 300–400 ms on 960 events, under 10 ms on 60, once
  // at startup. Only the events that can move the rotation are re-derived at; the rest are skipped without a fold.
  //
  // EVERY ADVANCE, NOT ONLY A PLAY (J102). A skip starts the next song exactly as a play does, so a skip that plays a DJ's
  // last song takes them out (the fold's hard fall-out), and their return must be dated by the return. Only the play was
  // here: after a skip a return was dated by the first join, which reads as idle the moment they come back. The advances
  // are taken from `_ADVANCE_TYPES`, this file's one list of them, rather than written a second time.
  const AFFECTS_ROTATION = {
    "ddjp.dj.join": 1, "ddjp.dj.leave": 1, "ddjp.dj.remove": 1, "ddjp.dj.reset": 1,
    "ddjp.dj.undeclare": 1, "ddjp.dj.strike": 1,
  };
  for (const t of _ADVANCE_TYPES) AFFECTS_ROTATION[t] = 1;
  function rotationEntries() {
    const out = {};
    // PAST A SHORT HELD BASE (ruling 43, J94): from the save point the fold stands on, over what is held above its cut.
    const _sb = _shortBase(null), _base = _sb ? _sb.from.seed : _heldBase;
    const log = _sb ? _aboveCut(orderEvents(eventLog), _sb.from) : orderEvents(eventLog);
    if (!Array.isArray(log) || !log.length) return out;
    let prev = [];
    const has = (arr, u) => arr.indexOf(u) >= 0;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      // A DECLARE CAN BRING SOMEONE IN (J105), but only one from a member who holds nothing yet — a join with no usable song
      // makes one. A declare from someone already in the rotation adds a song and moves no one, so it is still skipped
      // without a fold: declares are re-derived at only for the rare declarer who is not in.
      if (e && e.type === "ddjp.dj.declare") { if (has(prev, e.sender)) continue; }
      else if (!e || !AFFECTS_ROTATION[e.type]) continue;
      let st = null;
      // TOTAL, AND SILENT PER EVENT. One unreadable event costs one event's worth of precision,
      // never the whole replay — a throw here used to be the difference between "we know when
      // everybody joined" and "we know nothing".
      // From the seed the held log folds from (owner's live log, `ddjp_537`): seedless, a held log that starts at a floor
      // lost every member the seed carried, so their entry times went missing.
      try { st = StateDeriver.derive(log.slice(0, i + 1), _base); } catch (err) { continue; }
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
  //     `fingerprint(n, prev, seed, floorL, thin, covers)` commits it and `CheckpointFormat.verify` re-derives
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
  function adoptFloor(f, opts) {
    if (!f || typeof f.floorL !== "number" || !f.seed ||
        typeof StateDeriver === "undefined" || !StateDeriver.isSeed || !StateDeriver.isSeed(f.seed)) {
      return { ok: false, reason: "not-a-starting-state" };
    }
    if (_adopted && f.floorL <= _adopted.floorL) return { ok: false, reason: "not-newer" };
    const fl = Object.assign({}, f, { grade: "real" });
    if (typeof fl.covers === "string" && fl.covers.indexOf("..") < 0) fl.covers = ".." + fl.covers;
    const sf = fl.seed.settingsFrom;
    for (const e of eventLog) {
      if (sf && e && e.type === "ddjp.room.settings" && e.eventId === sf) fl._sfPos = { l: e.l, id: e.eventId };
    }
    // PROVE BEFORE DROPPING (J73 job 7, Q6). Moving on, the held log runs from the last save point's
    // seed up to this one's cut, so whether this seed reproduces it can be checked — across every
    // derived field a drop could change — the same `REPRODUCE_FIELDS` `_deriveBest`'s validation compares.
    // Asked by the engine (`opts.prove`); a seed that does not reproduce is refused and nothing goes.
    if (opts && opts.prove) {
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
      if (typeof History !== "undefined" && History.ingest && _drop.length) { try { History.ingest(_drop, _heldBase, Object.assign({ src: "trim", settle: { at: fl.floorL, seed: fl.seed } }, _droppedReach(_prevCut, fl.floorL) || {})); } catch (e) {} }
    }
    const kept = eventLog.filter((e) => !_coveredBy(fl, e));
    eventLog.length = 0;
    for (const e of kept) eventLog.push(e);
    _heldBase = fl.seed;                // the held log now folds from this save point's seed (J73 job 2)
    _retireCached();                    // and the raw cache lets go of what is now banked (J73)
    // The derived log no longer reaches the room's start, so the genesis comparison is off (the
    // counter the door's drops raise — `check-divergence-signal`; a trim is covered by `_trimmedBelow`).
    _derivedLogTrimmed += (before - kept.length) || 1;
    _raiseBoundary(fl.floorL, String(fl.covers).split("..")[1] || null);
    _refold({ why: "adopting the save point at l=" + fl.floorL });
    return { ok: true, floorL: fl.floorL, dropped: before - kept.length };
  }
  function floorSeed() { const f = _trustedFloor(); return (f && f.seed) || null; }
  // What was taken before dropping, for `Room.foldActivity` to merge (J73 job 2). Null until
  // something has been taken, so a room that has not trimmed answers from its held log alone.
  function olderActivity() { return (typeof Activity !== "undefined") ? Activity.read() : null; }

  // EVERY DERIVED FIELD A DROP COULD CHANGE (J73 job 7, Q6): the derived state's keys, less `history`,
  // which no seed may carry and which History takes before anything is dropped.
  const REPRODUCE_FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
  // Does save point `f`'s seed reproduce what is held — the held log up to its cut, folded from the
  // base the held log folds from? Field by field; the first that differs is named. `from` (J93, the shared move-on check
  // only): fold instead from that save point's seed, over what is held above its cut. Bot rooms' licence never passes it.
  function reproduces(f, from) {
    if (!f || !f.seed || typeof f.floorL !== "number") return { ok: false, reason: "no-seed" };
    let held = null, seeded = null;
    try {
      const upTo = orderEvents(eventLog).filter((e) => _coveredBy(f, e));
      held = from ? StateDeriver.derive(_aboveCut(upTo, from), from.seed) : StateDeriver.derive(upTo, _heldBase);
      seeded = StateDeriver.derive([], f.seed);
    } catch (e) { return { ok: false, reason: "fold-threw" }; }
    const k = _firstDiffering(held, seeded);
    return k ? { ok: false, reason: "differs", field: k, held: _field(held, k), seeded: _field(seeded, k) } : { ok: true };
  }
  // The first REPRODUCE_FIELDS entry on which two states differ, by value; null when none does (J95: also the stretch's wholeness).
  function _firstDiffering(a, b) {
    for (const k of REPRODUCE_FIELDS) if (_canonAny(_field(a, k)) !== _canonAny(_field(b, k))) return k;
    return null;
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
    return _adopted ? { floorL: _adopted.floorL, covers: _adopted.covers, seed: _adopted.seed, grade: "verified" } : null;
  }
  // THE BASE THE HELD LOG FOLDS FROM — undefined is the room's start, else the seed of the floor last
  // dropped to. Legality of an event about to be dropped is the verdict of THAT fold: by the time a
  // trim takes, the current fold may already be seeded on the new floor, which no longer contains the
  // events being dropped, so `isLegal` would not count one of them legal (J73 job 2; it answered `false` then, and since J89
  // answers `null`, not given).
  let _heldBase;
  // ── WHAT THIS TAB SET ASIDE ABOVE ITS HELD BASE (J93, the owner's `?v=540` reopen) ─────────────────────────────────────
  // An arrival a boundary declines is not in the held log. At or below the held base's own cut that is what the base banks;
  // ABOVE it, a fold from `_heldBase` is short by exactly those events. The reopen: trimmed at a save point at l=8, then
  // following save points to l=91 whose boundaries it did not hold, the tab set aside the events up to l=91 — and the move-on
  // check folded its own events from l=8 without them and warned of a late arrival nobody sent. Recorded where declined, pruned
  // when the held base moves. Read by the move-on check (`tests/check-move-on-base.js`) and, by the owner's ruling 43 (J94), by
  // what this tab keeps of what it forgets: `_shortBase` below. Nothing here gates anything the room decides.
  let _heldBaseCut = null;      // { l, id }: the cut of the save point `_heldBase` is the seed of; null is the room's start
  const _setAside = new Map();  // eventId -> l, for arrivals declined above that cut
  let _foldFloor = null;        // the save point the trimmed path's last fold stood on
  let _priorFoldFloor = null;   // and the one it stood on before that (J94: a trim reads past the floor it is adopting)
  function _aboveHeldCut(l, id) {
    if (!_heldBaseCut) return true;
    return l > _heldBaseCut.l || (l === _heldBaseCut.l && (!_heldBaseCut.id || String(id) > String(_heldBaseCut.id)));
  }
  function _noteSetAside(id, l) { if (id && typeof l === "number" && _aboveHeldCut(l, id)) _setAside.set(String(id), l); }
  function _moveHeldBase(f) {
    _heldBaseCut = (f && typeof f.floorL === "number") ? { l: f.floorL, id: (typeof f.covers === "string") ? String(f.covers).split("..")[1] || null : null } : null;
    for (const [id, l] of Array.from(_setAside.entries())) if (!_aboveHeldCut(l, id)) _setAside.delete(id);
  }
  // The set-aside arrivals a fold from the held base would need to reach f's cut, and does not hold: how many, and where.
  // ("Does not hold": a fetch-back re-admits what it fetched — `restoreBelow`, `restoreFromStart` — and those are held again.)
  function _setAsideUpTo(f) {
    let n = 0, lo = null, hi = null;
    const held = new Set(eventLog.map((e) => e && e.eventId));
    for (const [id, l] of _setAside) {
      if (held.has(id) || (f && !_atOrBeforeBoundary(f, { l: l, eventId: id }))) continue;
      n++; lo = (lo === null || l < lo) ? l : lo; hi = (hi === null || l > hi) ? l : hi;
    }
    return n ? { n: n, lo: lo, hi: hi } : null;
  }
  // Queryable, a COPY: the held base's cut and what is set aside above it. `null` is a real answer — nothing is.
  function setAside() {
    const r = _setAsideUpTo(null);
    return r ? { base: _heldBaseCut ? _heldBaseCut.l : null, n: r.n, lo: r.lo, hi: r.hi } : null;
  }
  // THE SAVE POINT A SHORT HELD BASE IS READ PAST (J93; the owner's ruling 43, J94) — one home for the move-on check, the trim's
  // record of who was active, song history's hand-offs and the rotation's entry times. Where this tab set aside events above its
  // held base (up to `t`'s cut; with no `t`, any), the save point its fold followed — before `t`, or now — whose cut banks them.
  // Null when the base is not short: every reader then counts from the held base, as before.
  function _shortBase(t) {
    const short = _setAsideUpTo(t || null);
    if (!short) return null;
    const ff = !t ? _foldFloor : (_foldFloor && _sigOf(_foldFloor) !== _sigOf(t)) ? _foldFloor : _priorFoldFloor;
    if (!ff || !ff.seed || typeof ff.floorL !== "number" || ff.floorL < short.hi || (t && _sigOf(ff) === _sigOf(t))) return null;
    return { from: ff, short: short };
  }
  // The set-aside events up to `t`'s cut, back from the raw cache, which holds every arrival it was handed ("held, and still
  // servable for repair"). One the cache no longer holds is not here, and nothing else holds it. Read through `_rawReader`: the
  // engine never names the cache — the bridge wires it (`setRawReader`, beside the cache's retire wiring).
  let _rawReader = null;
  function setRawReader(fn) { _rawReader = (typeof fn === "function") ? fn : null; }
  function _setAsideFromCache(t) {
    const out = [];
    if (!_rawReader) return out;
    const held = new Set(eventLog.map((e) => e && e.eventId));
    for (const [id, l] of _setAside) {
      if (held.has(id) || !_atOrBeforeBoundary(t, { l: l, eventId: id })) continue;
      let e = null;
      try { e = normalise(_rawReader(id)); } catch (x) { e = null; }
      if (e) out.push(e);
    }
    return out;
  }
  // THE JUDGE A TRIM KEEPS BY, past a short base (ruling 43): above the followed save point's cut, a fold from its seed; at or below
  // it, the held events and the set-aside ones from the held base — the stretch as a tab that held every event folded it.
  function _judgedPast(sb, aside) {
    const ordered = orderEvents(eventLog), above = _aboveCut(ordered, sb.from), mine = new Set(above.map((e) => e.eventId));
    const hi = _acceptedBy(above, sb.from.seed);
    const lo = _acceptedBy(orderEvents(ordered.filter((e) => !mine.has(e.eventId)).concat(aside || [])), _heldBase);
    return (id) => (mine.has(id) ? hi(id) : lo(id));
  }
  // SONG HISTORY'S HAND-OFF (J73 job 7; settled by its save point, ruling 41; past a short base, ruling 43): `events` is the
  // stretch `t` closes, as this tab holds it. Past a short base, what is above the followed save point's cut folds from its seed;
  // and where the set-aside stretch below it is all in hand (`aside`, at the trim), that stretch — its held events and the
  // cache's — folds from the held base, settled by the followed save point, so its plays keep their final tallies.
  function _handHistory(events, t, src, sb, aside) {
    if (!sb) return History.ingest(events, _heldBase, Object.assign({ src: src, settle: { at: t.floorL, seed: t.seed } }, _droppedReach(_trimmedBelow, t.floorL) || {}));
    const ordered = orderEvents(events), above = _aboveCut(ordered, sb.from), mine = new Set(above);
    if (aside && aside.length && aside.length === sb.short.n) {
      const below = orderEvents(ordered.filter((e) => !mine.has(e)).concat(aside));
      History.ingest(below, _heldBase, Object.assign({ src: src, settle: { at: sb.from.floorL, seed: sb.from.seed } }, _droppedReach(_trimmedBelow, sb.from.floorL) || {}));
    }
    return above.length ? History.ingest(above, sb.from.seed, Object.assign({ src: src, settle: { at: t.floorL, seed: t.seed } }, _droppedReach(sb.from.floorL, t.floorL) || {})) : null;
  }
  // KEEP ENOUGH TO PROVE THE CURRENT FLOOR (owner's rule, `ddjp_551`): a QUORUM floor is re-proved on every revalidate by
  // `chainVerifies`, which needs the floor's own boundary event — the one thing a trim drops that the proof needs (every event
  // after it is above the cut, and held). Kept here, beside the held log, so no fold of the held log ever sees it.
  let _proofKeep = [];
  let _moveOnLogged = null;   // the floor Step A's log line was last said for (step 5b: at most once per floor)
  let _heldBaseH = null;   // the fingerprint of the floor the held log folds from (proved by its licence when trimmed under)
  function _heldAccepted() { return _acceptedBy(orderEvents(eventLog), _heldBase); }
  // The fold's verdict on `list` from `seed`, as a predicate (J94: the held judge's body, now also the short base's).
  function _acceptedBy(list, seed) {
    try {
      const acc = StateDeriver.deriveAccepted(list, seed);
      if (acc instanceof Set) return (id) => acc.has(id);
      if (Array.isArray(acc)) { const s = new Set(acc); return (id) => s.has(id); }
      if (acc && typeof acc === "object") return (id) => !!acc[id];
    } catch (e) {}
    return isLegal;
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
  function _trustedFloor() {
    if (_adopted) return _adopted;
    try { if (typeof Floor !== "undefined" && Floor.current) return Floor.current(); }
    catch (e) {}
    return null;
  }
  // The fold, in one place. It was written out inline in ingest, so trimming had no way to redo it
  // without either duplicating it or deferring to the next arrival.
  // `cause` is read by one thing, the REVISED line (J71 item 1): the arrival that re-derived, or why it re-derived.
  function _refold(cause) {
    const _npBefore = derivedState && derivedState.nowPlaying;
    const ordered = orderEvents(eventLog);
    const _full = _deriveBest(ordered);
    derivedState = _full.state;
    _foldRefusals = _full.refusals || null;
    legalIds = Object.create(null);
    try { for (const id of _full.accepted) legalIds[id] = true; }
    catch (e) { legalIds = null; }
    heldIds = Object.create(null);
    for (const e of (Array.isArray(_full.given) ? _full.given : [])) { const id = e && (e.eventId || e.event_id); if (id) heldIds[String(id)] = true; }
    _reviseSaid(cause, _npBefore);
    return _full;
  }
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
    _moveHeldBase(f);                    // the held base is this floor now (J93: what it banks is no longer set aside above it)
    if (quorum) { const b = (entries || []).find((e) => e && e.eventId === _trimmedBoundaryId); _proofKeep = b ? [b] : []; } else _proofKeep = [];
    _refold({ why: "a fetch-back to the save point at l=" + f.floorL });
    return n;
  }
  // The held log plus what proves the current floor — what Floor's chain verification reads; no fold reads it.
  function proofLog() {
    const ids = new Set(eventLog.map((e) => e.eventId));
    return orderEvents(_proofKeep.filter((e) => !ids.has(e.eventId)).concat(eventLog));
  }
  // WHAT IS KEPT ONLY TO PROVE THE FLOOR — the quorum floor's boundary event (`_proofKeep`) — by id, so the raw cache keeps the same
  // copy when it retires everything at or below the cut (`ddjp_566`, the owner's ruling). Which floors keep one is decided
  // where the cut is taken: `restoreBelow` (a floor whose tier is above 0) and `trimToFloor` (a quorum floor).
  function proofKept() { return _proofKeep.map((e) => e && e.eventId).filter(Boolean); }
  // THE ROOM'S START: every fetched event is held again, and the log folds from the beginning.
  function restoreFromStart(entries) {
    const have = new Set(eventLog.map((e) => e.eventId)); let n = 0;
    for (const e of (entries || [])) { if (!e || have.has(e.eventId)) continue; eventLog.push(e); have.add(e.eventId); n++; }
    _trimmedBelow = null; _trimmedBoundaryId = null; _heldBase = undefined; _heldBaseH = null; _proofKeep = []; _lastFoldedFloor = null;
    _moveHeldBase(null);                 // the held base is the room's start (J93)
    _refold({ why: "a fetch-back to the room's start" });
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
    const bid = (t && typeof t.covers === "string") ? t.covers.split("..")[1] : null;
    if (!bid || !(eventLog.some((e) => e && e.eventId === bid) || _proofKeep.some((e) => e && e.eventId === bid))) return false;   // boundary held
    try { return typeof Floor !== "undefined" && typeof Floor.proves === "function" && Floor.proves(t, proofLog(), { byPosition: true }).ok === true; }
    catch (e) { return false; }
  }
  function forgettingLicensed() {
    if (_adopted) return false;   // a bot room: nothing through this door (J107, as `trimToFloor`); its cache follows the adoption
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
  // SONG HISTORY FOLLOWS A SAVE POINT FROM ITS ADOPTION (ruling 41; J92). The stretch it closes, as this device holds it, is handed
  // to History to be folded as the save point counted it — at adoption, before and whether or not this device may forget it. A
  // display hand-off like the trim's: nothing here changes what the room folds. (The `?v=540` seal n=7: a play at its own
  // position reached the sealer while the seal was being sent; the room followed the save point, the sealer's history did not.)
  function _settleHistory(t) {
    if (typeof History === "undefined" || !History.ingest || !t || !t.seed || typeof t.floorL !== "number") return;
    const keep = new Set(_aboveCut(orderEvents(eventLog), t));
    const below = eventLog.filter((e) => !keep.has(e));
    if (!below.length) return;
    let r = null;
    try { r = _handHistory(below, t, "settle", _shortBase(t), null); } catch (e) { r = null; }   // past a short base too (ruling 43)
    for (const x of (r && Array.isArray(r.removed)) ? r.removed : []) Logger.info("StreamManager: song history follows save point n=" + t.n + " at l=" + t.floorL +
      " — " + x.pi + " at l=" + x.l + " left it" + (typeof x.settledAt === "number" ? " (the save point counted the other play at l=" + x.l + ", the one that reached its sealer first)" : ""));
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
  function trimToFloor() {
    const t = _trustedFloor();
    if (!t || typeof t.floorL !== "number") return 0;
    // ── ADOPTING A FLOOR RE-DERIVES FROM IT, BEFORE ANY LICENCE IS ASKED (J47) ─────────────────
    // The circularity this broke (when the licence was the J73 verdict, until step 5b): a floor's licence was its validation
    // verdict, keyed to its signature and recorded inside `_deriveBest` — the very fold this function would trigger.
    // Asking for the licence first meant asking for one only its own refold could grant, reading the
    // PREVIOUS floor's verdict, and returning 0: a quiet room serves state from a floor it no longer
    // holds. (J47 found it for a save file's origin floor, which J82 removed; re-measured then, it
    // holds for every ordinary floor — five guards go red without it.)
    //
    // TWO PLACES IT LOOKS LIKE IT COULD GO, AND CANNOT. `trimToFloor`'s no-drop path is BELOW the
    // licence check, so a refold there never runs in the case that needs it. Subscribing to
    // `Floor`'s emission would make this module depend on Floor at load, where it reads it lazily.
    //
    // CONDITIONAL ON THE FLOOR HAVING MOVED, so an adoption path does not become a fold per call —
    // both production callers are adoption paths. `check-adopt-refold` drives both halves.
    const _sig = _sigOf(t);
    if (_sig !== _lastFoldedFloor) { _lastFoldedFloor = _sig; _refold({ why: "following the save point at l=" + t.floorL }); _settleHistory(t); }
    if (typeof TrustPolicy === "undefined" || !TrustPolicy.earnsForget || !TrustPolicy.earnsForget(t.grade)) return 0;
    // STEP 5b — FORGETTING FOLLOWS ACCEPTANCE (owner's ruling, option b, `ddjp_554`): a decentralized device forgets below the
    // floor it stands on — bound to its rank by selection, with a grade that allows it (above) — once that floor's boundary
    // event is held and it PROVES ITSELF by the consensus's exact rebuild (`Floor.proves`). The J73 state comparison is a
    // diagnostic now.
    // A BOT ROOM FORGETS NOTHING THROUGH THIS DOOR (J107). It forgets when it adopts a save point (`adoptFloor`: on the bot's
    // authority when it opens, on the reproduce proof each time it moves on), and this door is never reached there (J106).
    // It used to ask the J73 comparison instead, which never runs after an adoption: a licence that said no unless a test
    // seam said "validated". Now an adopted save point is a no here, whatever the comparison says.
    if (_adopted || !_provesForForgetting(t)) return 0;
    const before = eventLog.length;
    // EXACTLY WHAT THE FOLD READS ABOVE THE CUT, AND NOTHING ELSE (J73). The boundary event and
    // everything before it in the fold's own order — position, then id — are banked into the seed,
    // so they go. This kept `l > floorL`, position alone, and so also dropped an event SHARING the
    // floor's position whose id sorts after the boundary: not in the seed, not in the log, gone —
    // and the trimmed client derived a different queue from a reader holding everything
    // (a probe at J73; `check-trim-boundary` PART A). Asking `_aboveCut` makes
    // the drop and the fold one rule rather than two that can disagree.
    const _keep = new Set(_aboveCut(orderEvents(eventLog), t));
    const kept = eventLog.filter((e) => _keep.has(e));
    // An early exit when nothing is AT OR BELOW the cut — nothing to drop from the held log (this said "nothing is above the
    // floor", the opposite of its condition). The arithmetic below returns 0 either way; the exit avoids rebuilding the array.
    // IT STILL RETIRES (`ddjp_566`, HANDOVER item 3): "nothing to drop HERE" says nothing about the raw cache, because a banked
    // raw never entered the held log. A floor with nothing held below it took this path and left every leftover raw at or below
    // its cut (`check-cache-held` C).
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
      // PAST A SHORT HELD BASE (the owner's ruling 43, J94): what is kept counts from the save point this tab followed, and the
      // events it set aside come back from the raw cache — so the record is what a tab that held every event keeps.
      const _sb = _shortBase(t), _aside = _sb ? _setAsideFromCache(t) : [];
      const _legal = _sb ? _judgedPast(_sb, _aside) : _heldAccepted();
      const _taken = _aside.length ? _drop.concat(_aside) : _drop;
      Activity.take(_taken, _legal, { complete: _fromStart });
      // and the ADDED TIMES of songs still queued, for the repeat rule (J73 Q10): of what is taken, by the same judge — the set-aside
      // events' additions too (ruling 43, J95)
      if (typeof History !== "undefined" && History.noteAdds) History.noteAdds(_taken, _legal);
      if (typeof History !== "undefined" && History.ingest && _drop.length) { try { _handHistory(_drop, t, "trim", _sb, _aside); } catch (e) {} }
    }
    eventLog.length = 0;
    for (const e of kept) eventLog.push(e);
    _heldBase = t.seed;                 // the held log now folds from this floor's seed (J73 job 2)
    _moveHeldBase(t);                   // and what was set aside at or below its cut is banked by it (J93)
    _heldBaseH = t.h || null;           // and that floor was proved here (its licence): it needs no fetch to stand on
    _retireCached();                    // and the raw cache lets go of what is now banked (J73)
    _raiseBoundary(t.floorL, _bid);
    // RE-DERIVE NOW, not at the next ingest. The state in hand was folded from a log that no longer
    // exists; leaving it until something else arrives means the room is correct only by the accident
    // of nobody having asked, and the first post-trim fold would then be the one to expose it. This
    // also makes the switch to the seeded path observable at the moment it happens rather than later.
    _refold({ why: "trimming to the save point at l=" + t.floorL });
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
  // So the second branch WAS live, from J35 until step 5b (`ddjp_554`): a client holding nothing
  // now cannot prove its floor, so the branch is closed by construction. The preference above is
  // kept for the day it reopens, and the reason has changed — which is the whole point of writing
  // it down again rather than leaving the old one:
  //
  //   · BEFORE, it was sound because the first branch always applied. That was a fact about the
  //     licence chain, and J35 removed it.
  //   · NOW, it is sound because the two branches are ORDERED BY TRUTHFULNESS — a stale-but-true
  //     room beats an honestly-empty one, and an honestly-empty one beats a fabricated one — and
  //     because the empty answer is never SILENT. `pairingFault()` comes back
  //     `{seedAt, boundary, held}` on exactly this path (measured: `{seedAt:6, boundary:14,
  //     held:1}`), so "empty because I cannot account for the room" stays distinguishable from
  //     "empty because nothing has played". That distinguishability is what the new reason rests
  //     on, so `check-floor-pairing` PART G holds it: G3 asserts the branch closed, and its EMPTY
  //     and `pairingFault` rows run only if it reopens.
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
    try { _refold({ why: "this tab's history reported " + (next === true ? "complete" : next === false ? "short" : "unknown") }); }
    catch (e) { /* a refold that throws must not take the setter with it */ }
  }
  // WHAT THE FOLD WAS GIVEN rides with it (J89): `isLegal` answers `false` only for an event the fold was given and refused.
  // A fold from a floor is given only what is above the cut, so an event still held below it is unknown to it, not refused.
  function _remember(out, given) { if (out && typeof out === "object") out.given = given; _lastGoodFold = out; return out; }
  //
  // TWO WAYS TO BE UNPAIRED, ONE ANSWER. The original is a seed BELOW what this client destroyed.
  // The second: a client that trimmed and then holds no floor at all, so there is no seed to start
  // from and no genesis to fall back on either. Both are "I cannot account for this room", and both
  // must refuse rather than fabricate — so they share the answer rather than getting a second one
  // that can drift from it. `f === null` distinguishes them in the LOG without becoming a second
  // mechanism.
  function _refuseUnpaired(ordered, f) {
    _pairingFault = { seedAt: f ? f.floorL : null, boundary: _trimmedBelow, held: ordered.length,
                      reason: f ? "seed-below-boundary" : "trimmed-without-floor" };
    Logger.warn("StreamManager: REFUSING TO FOLD — " + (f
      ? ("the floor's seed sits at l=" + f.floorL +
         " but this client has already forgotten everything at or below l=" + _trimmedBelow +
         ", so the seed cannot chain onto what is held (" + ordered.length + " events). ")
      : ("this client has forgotten below a floor it no longer holds, so there is no seed to " +
         "fold from and its own log does not reach the room's beginning (" + ordered.length +
         " events held). ")) +
      (_lastGoodFold ? "Holding the last state that did pair." : "No paired fold to hold: answering empty.") +
      " A floor must be re-earned.");
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

  // THE MOVE-ON CHECK FOR A TRIMMED DEVICE (Step A; a log line only since step 5b): the floor's seed against the held
  // events up to its cut, folded from the held base — `reproduces`, the bot rooms' move-on check — said once per floor.
  // A boundary this device does not hold is said as such, never a pass. `tests/check-trim-every-floor.js` drives it.
  function _recordMoveOnVerdict(f) {
    const sig = _sigOf(f);
    if (!sig || sig === _lastValidatedCp || sig === _moveOnLogged) return;   // concluded, or already said for this floor
    _moveOnLogged = sig;                                     // the LOG LIMIT: at most once per floor (step 5b)
    const bid = (f && typeof f.covers === "string" && f.covers.indexOf("..") >= 0) ? f.covers.split("..")[1] : null;
    if (!bid || !eventLog.some((e) => e && e.eventId === bid)) { Logger.info("StreamManager: move-on check — floor n=" + f.n + " boundary not held"); return; }
    // THE BASE (J93, the owner's `?v=540` reopen). Where this tab set aside events above its held base and up to f's cut, a fold
    // from the held base is short, so the check folds from the save point this tab's last fold stood on, which banks them.
    const _sb = _shortBase(f), short = _sb ? _sb.short : null, from = _sb ? _sb.from : null;
    const r = reproduces(f, from);
    const heldBase = "its held base (" + (_heldBaseCut ? "the save point at l=" + _heldBaseCut.l : "the room's start") + ")";
    const base = from ? "save point n=" + from.n + " at l=" + from.floorL : "the held base";
    // A LOG LINE ONLY (step 5b): no verdict is recorded — forgetting follows acceptance of a floor that proves itself.
    if (r.ok) Logger.info("StreamManager: move-on check — floor n=" + f.n + " reproduces from " + base + (from ? ", the one this tab's fold stood on — not from " +
      heldBase + ", which is short: " + short.n + " event(s) from l=" + short.lo + " to l=" + short.hi + " were set aside as already banked under a save " +
      "point this tab follows but could not trim to" : ""));
    else if (r.field === "nowPlaying") {
      // IN PLAIN WORDS, AND ONLY WHAT THE CHECK KNOWS (J93; J92's line named a cause it could not see): what the save point records,
      // what this tab's own events give and from which base, and — only where both are plays at the save point's own position —
      // that. The room follows the save point either way; so does song history (ruling 41, the hand-off at adoption).
      const _pi = (x) => (x && x.pi) || "nothing";
      const at = (x) => { const e = x && x.pi ? eventLog.find((ev) => ev && ev.eventId === x.pi) : null; return e && e.l === f.floorL && e.type === "ddjp.dj.play"; };
      Logger.warn("StreamManager: move-on check — save point n=" + f.n + " at l=" + f.floorL + " records " + _pi(r.seeded) + " as playing; this tab's own " +
        "events up to it, folded from " + (from ? base + " (the one this tab's fold stood on)" : heldBase) + ", give " + _pi(r.held) + ". " +
        ((at(r.seeded) && at(r.held)) ? "Both are plays at l=" + f.floorL + ", the save point's own position, and it counted " + _pi(r.seeded) + "." : "This check does not say why.") +
        " The room follows the save point; so does song history.");
    }
    else Logger.warn("StreamManager: move-on check — floor n=" + f.n + " does not reproduce from " + base + " (" + (r.field || r.reason || "unknown") + ")");
  }
  // Derive the best available state (Phase 11 — trust-ladder / forget path). Strategy:
  //   1. If no trusted checkpoint is reachable → derive from genesis.
  //   2. If a trusted checkpoint exists → derive from ITS SEED plus the events after it. While
  //      we STILL HOLD the full log, genesis is folded too and the seed is checked against it;
  //      a mismatch is recorded (and, on complete data, withholds sealing), and live state still follows
  //      the floor (LIVE STATE FOLLOWS THE FLOOR, below).
  //   3. Rank only decides WHICH checkpoint we prefer (Floor already keeps the highest
  //      trusted n); recompute decides truth. Nothing trustable → honest genesis derive.
  // Floor is a backend peer (same layer), so consulting it here does not cross the app boundary.
  // Returns { state, accepted, refusals } — ALL from one fold. The reducer computes them in one
  // pass and `derive`/`deriveAccepted` are thin wrappers that each discard what the other wanted, so a
  // caller needing both (this one, on every ingested event) used to fold the whole log twice.
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
    // (J46 widened this branch to rooms that DECLARED an origin — a room created or overridden from a save file, whose
    // floor's seed originates rather than summarises. Room files went at J82, owner's ruling 1, and the branch is the
    // trimmed client's again.)
    const f = _trustedFloor();
    if (_trimmedBelow !== null) {
      if (!f || !f.seed) {
        // Trimmed, and no floor: no seed to start from and no genesis to fall back on. Answering an empty derive here would
        // describe a room that never had a history, which is the fabrication `_refuseUnpaired` exists to refuse.
        // Unreachable today — `Floor._weakened` demotes a trimmed client's floor rather than withdrawing it — and written
        // anyway, because "cannot happen" is the claim this codebase keeps paying for.
        return _refuseUnpaired(ordered, null);
      }
      if (typeof f.floorL === "number" && f.floorL < _trimmedBelow) {
        return _refuseUnpaired(ordered, f);
      }
      _pairingFault = null;
      // STEP A (owner's ruling, `ddjp_545`), a log line only since step 5b (`ddjp_554`): a trimmed device's NEW floor is
      // checked by the move-on check bot rooms use, said once per floor; forgetting follows `_provesForForgetting`.
      // Bot rooms (`_adopted`) are untouched.
      if (!_adopted) _recordMoveOnVerdict(f);
      if (!_adopted && _foldFloor && _sigOf(_foldFloor) !== _sigOf(f)) _priorFoldFloor = _foldFloor;   // and the one before (J94)
      if (!_adopted) _foldFloor = f;   // what this fold stands on, for the next floor's check (J93)
      // ── ABOVE THE CUT, AND THAT IS ONE HELPER RATHER THAN TWO RULES ─────────────────────────
      // The trimmed path used to fold the whole remaining log, which is the same set only because trimming has already
      // removed everything at or below the floor. That equality holds by the accident of a subscriber having fired:
      // `Floor.onChange("moved")` calls `trimToFloor`, so a floor that rises is normally followed by a trim immediately —
      // and in the window before it, the events between the old boundary and the new floor would be folded over a seed
      // that already banked them. Asking the boundary directly makes it structural instead of timed. (It was
      // load-bearing on J28's override route — a real log below an imported cut — which J82 removed with room files.)
      const given = _aboveCut(ordered, f);
      return _remember(StateDeriver.deriveBoth(given, f.seed), given);
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
    // THE FOLD'S COMMENT ONCE NAMED THE THREE ROUTES THAT ABSORB A DOUBLE-FOLD (that comment has since gone) and closed by
    // saying the clause becomes load-bearing "if a reducer rule that absorbs a double-fold is ever
    // relaxed". No rule was relaxed. This is a FOURTH route, and none of the three absorptions
    // applies: this client has not trimmed, and the events are not absorbable because they are
    // ABSENT rather than replayed. (The third, a room created from a file, went with room files at J82.)
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
      const given0 = _aboveCut(ordered, f0);
      return _remember(StateDeriver.deriveBoth(given0, s0), given0);
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
    const genesis = _remember(StateDeriver.deriveBoth(ordered), ordered);
    const seed = _trustedSeed();
    if (!seed) return genesis;                    // no checkpoint → genesis (unchanged)
    // While we STILL HOLD the full pre-checkpoint log, genesis is the complete, correct truth
    // (full counts, full history). Re-folding the same events over a seed that already banked
    // them would double-count — so here we VALIDATE the seed as a capability: derive seeded over
    // ONLY the events AFTER the checkpoint's coverage and confirm the forward state matches
    // genesis. This proves the trusted checkpoint is sound (recompute-verified end-to-end) so that
    // once a client forgets the pre-checkpoint log, the seeded path it will then rely on is
    // known-good (the licence until step 5b; a diagnostic since). Nothing here changes live state; which fold IS live state is decided at the exit.
    // PERF: validating is a second full derive, so we only do it when the trusted checkpoint
    // CHANGES (not on every ingest) — the seed can't silently rot between checks, and a live
    // divergence would show up the next time a new checkpoint lands. Cheap + sufficient.
    try {
      const tr = (typeof Floor !== "undefined" && Floor.current) ? Floor.current() : null;
      const sig = _sigOf(tr);
      const _reach = _reachOf(ordered);
      if (sig && sig !== _lastValidatedCp && !(_cannotTellOn && _cannotTellOn.sig === sig && _cannotTellOn.reach === _reach)) {
        // ── A PARTIAL LOG CANNOT CONCLUDE ────────────────────────────────────────────────
        // During replay the log is incomplete and arrives out of order, so folding it from
        // genesis produces a FRAGMENT rather than the room. A seed compared against a fragment
        // mismatches for reasons that say nothing about the seed — and `mismatched` is
        // CONCLUSIVE, so one spurious verdict here poisons that checkpoint for the rest of the
        // session (until step 5b forgetting was never licensed again; now this tab would not seal on it). Seen live: the warning fired at 70
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
        } else {
          // A TRIMMED TAB NEVER GETS HERE. After a trim the log starts at the floor, so the fold above is not genesis, a seed
          // compared against it must differ, and `mismatched` is conclusive. `_deriveBest` keeps it out: a trimmed tab returns
          // at the top, folding from its floor's seed (or refusing an unpaired one). (v281 added a case here for it; J101 found
          // it could not run and removed it. `check-seed-validation` T drives a trim.)
          const seeded = StateDeriver.derive(after, seed);
          if (_canon(seeded) !== _canon(genesis.state) && !_checkHadCompleteData()) {
            // A DIFFERENCE ON A LOG THAT IS NOT THE WHOLE ROOM SAYS NOTHING (the owner's option (i), `ddjp_627`). The fold
            // "from the start" here lacks what the door set aside below the floor, or never reached the room's first event,
            // so it differs from the save point by construction — the bot's "differs from save point n=2" at `?v=558`, whose
            // tab never trimmed (J100). It is "cannot tell", the rule the seal check (`_checkHadCompleteData`) and the
            // "MY OWN VIEW DISAGREES" line below already keep, and it warns nothing.
            const _gap = (_derivedLogTrimmed !== 0) ? "set-aside-below-floor" : "log-not-from-start";
            _recordValidation("not-yet-run", _gap, sig, _gap === "set-aside-below-floor");
            if (_gap === "log-not-from-start") _cannotTellOn = { sig: sig, reach: _reach };   // asked again when either changes
          } else if (_canon(seeded) !== _canon(genesis.state)) {
            // Recorded, not enforced. The old message here said "seed distrusted" — nothing
            // distrusted anything; _trustedSeed() returned the seed regardless. A log line that
            // claims an action it does not take is worse than silence, because it reads as
            // handled. The seed stays trusted; what changes is that this tab does not seal on it (on complete data).
            // THE LINE SAYS WHAT THE CHECK KNOWS (J115, the wording J100 described). It said "forgetting is not licensed
            // at this cut", true until step 5b and false since: forgetting follows `Floor.proves`, and the next save
            // point's trim went ahead. What this verdict does decide is sealing (`disagreesWithFloor`), so that is what it says.
            _recordValidation("mismatched", "diverges-from-genesis", sig);
            // AND IT SAYS WHAT IT COMPARED (the owner's `?v=558` run: it named only n). Built in its own try, so a line that cannot
            // be built leaves the verdict above as it is rather than turning it into "threw" (the twenty-third signature).
            let _what = "";
            try { _what = _comparedWords(tr, ordered, genesis.state, seeded); } catch (eW) { _what = " (what it compared could not be said)"; }
            Logger && Logger.warn && Logger.warn("StreamManager: this tab's fold of the room from its start differs from save point n=" +
              ((tr && tr.n !== undefined) ? tr.n : "?") + _what + " — most often a race the save point settled by first arrival; recorded " +
              "mismatched, and while this tab holds the room from its start it does not seal on that save point");
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
    // validation record is written. **For a tab that can validate, the choice of which answer to USE belongs here and nowhere
    // earlier** — an early return skips the validation, and `disagreesWithFloor` then reads a record that was never
    // computed (until step 5b the trim read it too, and dropped nothing). (The returns above are the tabs that cannot: one that has trimmed, one whose log is
    // short below its floor, and one with no seed.) That mistake cost two rounds of unexplained guard failures
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
    // `history`, and nothing reads it — its only wrapper, `Queue.getHistory()`, was removed as dead, and the room's History
    // panel pages from the transport. `nowPlaying`, `rotation`, `settings`, `counts` and `advance`
    // are byte-identical. Checkpoint hashes commit the SEED, which has no `history`, so nothing
    // re-fingerprints; and sealing from a seeded fold produces the same checkpoint as sealing from
    // genesis, driven both ways.
    //
    // NOT REMEMBERED AS THE LAST-GOOD FOLD. `_refuseUnpaired` falls back to `_lastGoodFold`, and
    // `check-floor-pairing` PART G requires (should its closed branch reopen) that a client with nothing to hold answers EMPTY rather than a
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
        const _givenSeeded = _aboveCut(ordered, _floorNow);
        const seededOut = StateDeriver.deriveBoth(_givenSeeded, _seedNow);
        // AND IT SAYS WHAT IT WAS GIVEN (the owner's call, `ddjp_633`): the same array, attached here and NOT through
        // `_remember` (which would also make this the last-good fold — see above). Without it `isLegal` answered `null`,
        // "not held", for everything this fold refused above the cut, and REP, the Feed, presence, the refused-join check
        // and the REVISED line read that as "not refused". (`check-shared-room` B, `check-revised-verdict` E.)
        if (seededOut && typeof seededOut === "object") seededOut.given = _givenSeeded;
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
              // IN PLAIN WORDS (the owner's ruling 41, J91). Both answers are what is playing NOW; what the save point itself
              // recorded is a third value, and the line used to call the second one what the floor "banks". And while the tab
              // is still loading the room, the fold from the start simply has not read everything yet (the `?v=538` reopen:
              // three such lines in a second, none of them a disagreement) — so that case says so, and does not warn.
              const _rec = (_seedNow && _seedNow.nowPlaying && _seedNow.nowPlaying.pi) || null;
              let _loading = false;
              try { _loading = typeof Session !== "undefined" && !!Session.phase && Session.phase() !== Session.LIVE; } catch (e3) { _loading = false; }
              if (_loading) {
                Logger.info("StreamManager: still loading the room — so far, folded from the room's start, this tab has " +
                  (pa || "nothing") + " playing, and folded from the save point at l=" + _floorNow.floorL + ", " + (pb || "nothing") +
                  ". Following the save point. This is the tab still reading the room, not a disagreement.");
              } else {
                Logger.warn("StreamManager: MY OWN VIEW DISAGREES WITH THE ROOM'S SETTLED ACCOUNT — playing now, folded from the " +
                  "room's start: " + (pa || "nothing") + "; folded from the save point at l=" + _floorNow.floorL + ": " + (pb || "nothing") +
                  " (that save point recorded " + (_rec || "nothing") + " as playing). Following the save point. Either a save point " +
                  "settled a same-position race by first arrival (song history follows the save point), or this tab is missing an " +
                  "event below it.");
              }
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
  // WHAT THE GENESIS CHECK COMPARED, for its warning (the owner's `?v=558` run). The save point by its author, its own event and
  // the rung of the channel that event arrived on (its channel-origin rank), and the first field that differs with both values —
  // `_firstDiffering` and `_field`, the move-on check's comparator, so the two checks name one field for one difference. A save
  // point this tab adopted before its event came back (its own seal) is said to be not in the log. A LOG LINE ONLY: nothing here
  // reaches a seed, a fingerprint or a verdict.
  function _comparedWords(f, ordered, fromStart, fromSeed) {
    const cp = (f && f.h) ? (ordered || []).find((e) => e && e.type === "ddjp.checkpoint" && e.content && e.content.h === f.h) : null;
    const tier = (cp && typeof cp.senderRank === "number" && typeof Ranks !== "undefined") ? Ranks.nameOf(cp.senderRank) : null;
    const k = _firstDiffering(fromStart, fromSeed);
    return " (sealed by " + ((f && f.by) || "?") + "; " +
      (cp ? "its event " + cp.eventId + " arrived on the " + (tier || "unknown") + " channel" : "its event is not in this tab's log") + ")" +
      (k ? " first at " + k + _keysThatDiffer(_field(fromStart, k), _field(fromSeed, k)) : "");
  }
  // ONLY THE KEYS THAT DIFFER (the owner's yes, `ddjp_627`): `nowPlaying` carries the room's whole settings snapshot, about 3.5 KB,
  // so a field that is an object on both sides is shown by the keys inside it that differ, each with both values, and how many
  // were equal. One level down; a differing key whose value is itself an object is shown whole. DISPLAY ONLY: which field
  // differs is `_firstDiffering`'s answer above, and nothing here is compared for any other purpose.
  function _keysThatDiffer(a, b) {
    const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
    if (!plain(a) || !plain(b)) return " — from the start: " + _canonAny(a) + "; from the save point: " + _canonAny(b);
    const has = (o, x) => Object.prototype.hasOwnProperty.call(o, x);
    const shown = (o, x) => has(o, x) ? _canonAny(o[x]) : "(absent)";
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
    const diff = keys.filter((x) => has(a, x) !== has(b, x) || _canonAny(a[x]) !== _canonAny(b[x]));
    return " — " + diff.length + " of its " + keys.length + " keys " + (diff.length === 1 ? "differs" : "differ") + " (" + (keys.length - diff.length) + " equal): " +
      diff.map((x) => x + " from the start: " + shown(a, x) + ", from the save point: " + shown(b, x)).join("; ");
  }
  // canonical (key-order-insensitive) compare of the forward-relevant state — a seed rebuilds
  // objects in a different field order than a fresh fold, so only VALUE differences should count.
  function _canonAny(x) {
    if (Array.isArray(x)) return "[" + x.map(_canonAny).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + _canonAny(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  // ONE FIELD LIST FOR BOTH CHECKS (J73 job 7b). The validation (then the licence; a diagnostic since step 5b) compared only
  // np, rot and settings while a bot room's move-on compared every derived field a drop could change; a seed wrong only in
  // its live counts or its advance view validated here. Same field list, same live-song counts.
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
  // internal; StreamManager, MatrixBridge and MatrixAccount are the backend globals the app
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
  // `settleBanked`. Below an ACCEPTED boundary nothing is retired: nothing was forgotten there, and those raws are repair material
  // (`check-cache-held` F); a set-aside arrival announces on the same channel (J95), but the sweep retires only what this owed. Announced the way `ddjp.local.forgot` is — straight to its subscribers, never through `notify`.
  function _bankedLate() {
    _bankedOwed = true;
    for (const fn of (subscribers["ddjp.local.banked"] || [])) { try { fn({}); } catch (e) {} }
  }
  // PAY THE DEBT, against the room this engine is in NOW: a room entry clears it with everything else (`reset`), so a sweep the
  // transport scheduled before the change does nothing for the next room (`check-cache-held` E).
  function settleBanked() {
    const aside = _asideOwed;
    _asideOwed = false;
    if (aside) _takeSetAside();   // ruling 43, as they arrive (J95)
    if (!_bankedOwed) return aside;
    _retireCached();
    return true;
  }
  // RULING 43, AS THEY ARRIVE (J95, the owner's call on J94's first decision). An arrival set aside below the save point this tab
  // follows is owed to the "recently active" record and to the repeat rule's added record AT ONCE — not only at the next trim —
  // so a reopened tab's People tab, the bot's AFK checks and the repeat rule are right straight away. Paid by the same coalesced
  // sweep as a late banked arrival (`ddjp.local.banked`, one sweep per burst), and only once the stretch is WHOLE: its fold from
  // the held base — the held events and the set-aside ones from the raw cache — reproduces the followed save point on every field
  // the move-on check compares, so every act is judged as the room judged it. A stretch still paging waits for the next burst;
  // one the cache cannot complete is taken at the trim, as J94 built it. Taking twice changes nothing (the latest time is kept).
  let _asideOwed = false;
  function _setAsideLate() {
    _asideOwed = true;
    for (const fn of (subscribers["ddjp.local.banked"] || [])) { try { fn({}); } catch (e) {} }
  }
  function _takeSetAside() {
    const sb = _shortBase(null);
    if (!sb) return false;
    const aside = _setAsideFromCache(sb.from);
    if (!aside.length) return false;
    const ordered = orderEvents(eventLog), above = new Set(_aboveCut(ordered, sb.from));
    const stretch = orderEvents(ordered.filter((e) => !above.has(e)).concat(aside));
    let st = null;
    try { st = StateDeriver.derive(stretch, _heldBase); } catch (e) { return false; }
    if (_firstDiffering(st, StateDeriver.derive([], sb.from.seed))) return false;   // not whole yet
    const judge = _acceptedBy(stretch, _heldBase);
    if (typeof Activity !== "undefined" && Activity.take) Activity.take(aside, judge, {});
    if (typeof History !== "undefined" && History.noteAdds) History.noteAdds(aside, judge);
    return true;
  }
  // THE INTERFACE TO THE SETTINGS RECORD (owner's repeat rule): since which position `key` has held its current value.
  function settingSince(key) {
    try { return (typeof SettingsProof !== "undefined" && SettingsProof.heldSince) ? SettingsProof.heldSince(key) : null; } catch (e) { return null; }
  }
  // WHERE THE HELD LOG STARTS BEING COMPLETE: just above the adopted save point (a bot room) or the trimmed cut (a shared
  // room); null when nothing was forgotten. History covers the held log from here (owner's re-test).
  function heldFrom() {
    if (_adopted && typeof _adopted.floorL === "number") return _adopted.floorL + 1;
    if (typeof _trimmedBelow === "number") return _trimmedBelow + 1;
    return null;
  }
  // WHAT A FORGETTING DROPPED, AS HISTORY'S REACH: from just above the previous cut (when there is one) up to the new
  // cut. Without it the reach began at the first dropped event, and a save point's position between the cuts became a
  // false hole — the repeat rule went blind after every move-on (owner's test, `ddjp_534`; check-history-floor-reach A).
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
    _asideOwed = false;       // nor a set-aside take (J95)
    _derivedLogTrimmed = 0;   // a new room's genesis fold is complete again
    _setAside.clear(); _heldBaseCut = null; _foldFloor = null; _priorFoldFloor = null;   // and nothing set aside above a held base (J93)
    derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
    // A NEW ROOM INHERITS NO BOUNDARY. Leaving _trimmedBelow set would make the next room fold
    // seeded against a floor from the room we just left.
    //
    // THE ACCEPTED BOUNDARY (J03) IS NOT CLEARED HERE, AND CANNOT BE. It is derived from
    // `Floor.current()` rather than stored, which is what makes withdrawal release it for free —
    // and the same property means this line cannot reach it. What clears it is `Floor.reset()`,
    // which `features/room.js` `leave` calls after this one (J83) via
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
    legalIds = null; heldIds = null;
    _lastValidatedCp = null;
    _cannotTellOn = null;
    // A validation verdict belongs to ONE room's log. Carrying it across a room change would let
    // `disagreesWithFloor` (sealing) answer from a room the check never ran against.
    _seedValidation = { status: "not-yet-run", reason: "no-checkpoint", sig: null, at: 0 };
    // AND THE FORK MEMORY (J34). Per-room by the same rule as every value above: a suspicion
    // is a fact about ONE room's fold, and carrying it into the next room would accuse that
    // room of the last one's fork — which reads as a diverged client rather than as a stale
    // flag, and is exactly the class `CONCEPTS.md` §3.11 describes (per-room state wiped on
    // room change, which makes forgetting a module easy). `check-fork-notice` PART C drives it
    // through a real room change rather than asserting the line is present.
    _lastStaleRefusal = null; _forkSuspected = false;
    // AND WHAT THE ORDER LINE PRINTED (J71 item 1): per room by the same rule — a verdict, and a summary a loading tab owes, are
    // about ONE room's log. (The subscription to Session stays: it is the page's, and asks this map, which is now empty.)
    _said.clear(); _revisedLoading.clear();
    Logger.debug("StreamManager: reset");
  }

  // Is this event part of the derived timeline? The vouch layer's eligibility question.
  // A null cache (derive threw) answers `true`, so a failure here degrades to the old
  // type-only behaviour rather than silently making real history unvouchable.
  // THREE ANSWERS, NOT TWO (J89, the owner's `?v=537` run): `true` the fold accepted it; `false` the fold was GIVEN it and
  // refused it; `null` this engine does not hold it — never ingested here, or dropped below a floor — so it cannot say. It
  // answered `false` for the last, and REP read that as "refused": a self-vote on the summary's own song, trimmed by the seal
  // a second earlier, was not counted, and nothing a device pages from the server ever could be. Every consumer that tests
  // truthiness (Vouch, Checkpoint) reads `null` as it read `false`; the ones that ask `=== false` ask only about held events.
  function isLegal(eventId) {
    if (!legalIds) return true;
    const id = String(eventId);
    if (legalIds[id]) return true;
    return (heldIds && heldIds[id]) ? false : null;
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
  // WHAT A NEW ROOM STARTS WITH (the owner, `ddjp_639`): the reducer's own blob, passed through for the reason above. NOT
  // caught: if it cannot be built, creation's genesis write fails loudly (logged at ERROR there) rather than posting an
  // empty or a defaults blob in its place.
  function newRoomSettings() { return StateDeriver.newRoomSettings(); }

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

  return {
    refusalOf, ingest, normalise, normaliseAll, setDoorScope, doorScope, adoptFloor, floorSeed, on, off, getState, getLog, rotationEntries, projectHistory, reset, isLegal, settingRanges,
    defaultSettings, newRoomSettings, blockedReasons,
    trimToFloor, canProve, restoreBelow, fetchBack, proofLog, proofKept, settleBanked, forgettingLicensed, disagreesWithFloor, holdsWholeRoom, heldFrom, settingSince, olderActivity, reproduces, adoptedFloor, _trimState, pairingFault, ignoredArrivals, setAside, setRawReader, shortWithoutFloor, setHistoryComplete, _setLicenceForTest, _setLogForTest, _revisedForTest /* exposed for the guard */,
    seedValidation, seedLicensesForget };
})();

// ── REGISTER THIS SLOT WITH THE SEAM (J23) ─────────────────────────────────────────────────
// `core/backends.js` owns the four interface names now; this hands it backend1's stream half.
// The module above declares itself `B1StreamManager` and not `StreamManager` because the latter
// is the shared shell: two top-level `const`s of one name in a classic script is a SyntaxError,
// and the shell has to be the one that wins so the binder can swap what features/ sees.
Backends.register("backend1", { StreamManager: B1StreamManager });
