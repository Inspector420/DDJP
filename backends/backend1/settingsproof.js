// backends/backend1/settingsproof.js
//
// SETTINGS PROOF — THE ONE QUESTION: for a decision made at some moment, can I PROVE the rule it
// used was the rule actually in force then?
//
// Almost every decision here depends on a setting. How long before a song may be skipped. How many
// blocked viewers force a skip. How many vouchers make something protected. A client that is wrong
// about which settings applied computes a different room — and it will be confidently wrong, which
// is the worst failure mode this system has.
//
// TWO QUESTIONS, AND ONLY ONE WAS EVER ANSWERED.
//
//   A. "Does this settings event produce the values we claim?"
//      Answered in the old tree: fetch the event the seed NAMES and recompute through the
//      reducer's OWN merge. That last part matters — a verifier carrying its own copy of the range
//      checks would drift the first time a dial was added, and then be quietly more permissive
//      than the fold it is checking.
//
//   B. "Was that the RIGHT settings event for this moment — or was there a newer one in between
//      that should have won instead?"
//      NOBODY ANSWERED THIS. And it is the harder one, because answering it requires certainty
//      that you have seen EVERY settings change up to that point. One missing event and you give a
//      confident wrong answer.
//
// WHY IT GETS ITS OWN READER. Settings live on their own channel, which is quiet — a room might
// see a handful of changes in its whole life. So reading ALL of them is cheap, far cheaper than
// reading the timeline, and it can reach FURTHER BACK than the timeline does: if the setting was
// changed yesterday and the floor is twenty minutes old, the proof lives below the floor. Riding
// along with the main fold would make that impossible.
//
// HOW FAR BACK. As far as needed to be certain, then stop. Certainty here has a precise meaning
// (see `coverage`): either we read to the room's beginning, or we read back past a point whose
// settings a trusted floor already accounts for.
//
// "I CANNOT TELL" IS A REAL ANSWER, and keeping it separate is the whole discipline. Collapsing it
// into "fine" licenses forgetting on no evidence. Collapsing it into "tampered" accuses an honest
// room. There is also a failure LOOP waiting for anyone who gets this wrong: forgetting drops the
// evidence -> the check can no longer run -> if that reads as a pass, it licenses more forgetting.
// The failure grows likelier exactly as the feature is used, and manufactures its own
// justification.
//
// DETECT, DO NOT ENFORCE. A mismatch is RECORDED and changes nothing on its own. What it changes is
// whether this cut may license forgetting. Two clients must never diverge because they disagreed
// about a settings pointer — the reducer judges by log position, identically for everyone, and
// nothing here may become a second opinion about what to accept.
//
// Depends on: StateDeriver (defaults + the reducer's own merge). Nothing depends on it.

const SettingsProof = (() => {

  const TYPE = "ddjp.room.settings";

  // Every settings event we have read, ordered. Small: this is the whole point.
  let _events = [];         // [{ id, l, sender, rank, blob }] sorted by (l, id)
  let _readFromL = null;    // the oldest position we have read back to
  let _readToL = null;      // the newest
  let _reachedGenesis = false;
  let _verdict = { status: "not-yet-run", reason: "nothing-read", at: 0 };

  let _env = {
    now: () => Date.now(),
    pageSettings: null,     // optional: (fromL, toL) => Promise<events> — the settings channel only
  };
  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  // ── ORDER ────────────────────────────────────────────────────────────────────────────────
  // The reducer's own key: position first, id as the tiebreak. Two settings events CAN share a
  // position, and comparing position alone would make "which one won" ambiguous at exactly the
  // moment it matters.
  function _before(a, b) {
    const la = a.l || 0, lb = b.l || 0;
    if (la !== lb) return la < lb;
    return String(a.id) < String(b.id);
  }
  function _sort(list) {
    return list.slice().sort((a, b) => (_before(a, b) ? -1 : (_before(b, a) ? 1 : 0)));
  }

  // ── READ ─────────────────────────────────────────────────────────────────────────────────
  // Only OWNER-originated events are recorded. Rank is the channel the event arrived on, never a
  // body field — a settings event from a lower channel is not a settings event, it is noise, and
  // the reducer ignores it too.
  //
  // (Reserved for later: high-staff settings on their own channel. They would arrive at a
  // non-owner rank and therefore be VOUCHABLE, unlike owner settings which are exempt because only
  // the owner can delete them. Nothing here needs changing for that — the rank filter widens and
  // the rest already works.)
  function ingest(events) {
    const list = Array.isArray(events) ? events : [];
    let added = 0;
    const have = Object.create(null);
    for (const e of _events) have[e.id] = 1;
    for (const ev of list) {
      if (!ev || ev.type !== TYPE) continue;
      const id = ev.eventId || ev.event_id;
      if (!id || have[id]) continue;
      if (!Ranks.atLeast(ev.senderRank, "owner")) continue;      // channel origin is the proof
      const blob = ev.content && ev.content.s;
      _events.push({ id: id, l: (typeof ev.l === "number") ? ev.l : 0,
                     sender: ev.sender || null, rank: ev.senderRank,
                     blob: (blob && typeof blob === "object") ? blob : null });
      have[id] = 1;
      added++;
    }
    if (added) _events = _sort(_events);
    for (const ev of list) {
      const l = (typeof ev.l === "number") ? ev.l : null;
      if (l === null) continue;
      if (_readFromL === null || l < _readFromL) _readFromL = l;
      if (_readToL === null || l > _readToL) _readToL = l;
    }
    return { added: added, total: _events.length };
  }

  // Declare that we have read the channel back to its beginning. Only a caller that actually paged
  // to the start may say so, and saying it is what turns "probably" into "certainly" below.
  function markGenesisReached() { _reachedGenesis = true; }

  // ── "I READ AND FOUND NOTHING" IS NOT "I DID NOT READ" ───────────────────────────────────
  // Found by reading. Coverage was inferred from the positions of events actually ingested, so a
  // caller that paged a stretch of the channel and found NO settings changes in it recorded
  // nothing — and the module then reported the same "incomplete reading" it would have reported
  // had the caller never asked.
  //
  // That matters most in the ordinary case. Settings change rarely, so an empty stretch is the
  // NORMAL result of paging, and a room that had simply not touched its settings lately would be
  // permanently unable to answer. Coverage is a claim about the RANGE examined, not about what
  // happened to be found in it, so the caller has to be able to state it.
  function markReadFrom(l) {
    if (typeof l !== "number") return;
    if (_readFromL === null || l < _readFromL) _readFromL = l;
    if (l <= 0) _reachedGenesis = true;
  }

  // ── COVERAGE — the honest bound on what we can answer ────────────────────────────────────
  // We can answer question B for a position only if we have read every settings event at or before
  // it. Two ways to be sure:
  //   · we read to genesis, so there is nothing earlier, or
  //   · the position is at or above where our reading starts AND something else already accounts
  //     for what came before — a trusted floor, whose seed carries the settings in force at its cut.
  function coverage() {
    return { fromL: _readFromL, toL: _readToL, reachedGenesis: _reachedGenesis, events: _events.length };
  }

  // ── WHAT THE FLOOR ACTUALLY CLOSES, AND WHAT IT DOES NOT ─────────────────────────────────
  // Found by reading, and it was a WRONG ANSWER rather than a missing one — the worse kind.
  //
  // The reasoning that looked right: everything below the floor is accounted for by the floor's
  // seed, so if my reading covers everything above the floor I can answer. True for the VALUES,
  // because the seed carries them. NOT true for the QUESTION "which event governed this moment".
  //
  // Consider a position above the floor with NO settings event above the floor. The governing
  // event is the one the FLOOR names — and I may never have read it, because it is below where my
  // reading starts. The old rule answered `eventId: null`, which means "the room was on defaults
  // here". That is not an unknown; it is a confident falsehood, and it is exactly what a checkpoint
  // claim would be checked against.
  //
  // So the floor closes the gap only when it can SUPPLY the answer, which means the caller must
  // hand over what the floor names. With it, the answer is the floor's own pointer. Without it,
  // the honest answer is "I cannot tell" and the caller should read further back.
  function _canAnswerAt(l, floorL, floorNames) {
    if (_reachedGenesis) return true;
    if (typeof floorL === "number" && floorL >= 0 && l > floorL
        && _readFromL !== null && _readFromL <= floorL + 1
        && floorNames !== undefined) {
      return true;
    }
    return false;
  }

  // ── QUESTION B: WHICH EVENT WAS IN FORCE? ────────────────────────────────────────────────
  // The last settings event sorting at or before the given position. Returns a THREE-WAY answer,
  // never a bare value:
  //   { known: true,  eventId }        we are certain, and this is the one
  //   { known: true,  eventId: null }  we are certain, and the room was on DEFAULTS here
  //   { known: false, reason }         we cannot tell — and that is an answer, not a failure
  //
  // The `known: false` case is the one that must never be smoothed over. A caller that treats it
  // as "defaults" has invented a fact.
  // `floorNames` is what the trusted floor's seed names as its settings event (its `settingsFrom`),
  // or null if the floor says the room was on defaults. Pass it whenever a floor is in play; the
  // answer below the reading window depends on it and cannot be guessed.
  function inForceAt(l, id, floorL, floorNames) {
    if (typeof l !== "number") return { known: false, reason: "no-position" };
    if (!_canAnswerAt(l, floorL, floorNames)) {
      return { known: false, reason: "incomplete-reading", coverage: coverage() };
    }
    const target = { l: l, id: (id == null ? "\uffff" : id) };
    let winner = null;
    for (const e of _events) {
      if (_before(e, target) || (e.l === l && String(e.id) === String(id))) winner = e;
      else break;                                   // sorted, so the first one past ends it
    }
    // NOTHING ABOVE THE FLOOR SET ANYTHING -> the governing event is the one the FLOOR names, which
    // may be below my reading entirely. Answering "defaults" here is the falsehood this rule exists
    // to prevent.
    if (!winner && !_reachedGenesis) {
      return { known: true, eventId: (floorNames === undefined ? null : floorNames),
               blob: null, fromFloor: true };
    }
    return { known: true, eventId: winner ? winner.id : null, blob: winner ? winner.blob : null };
  }

  // The settings VALUES in force at a position, recomputed rather than remembered. Folds every
  // settings event up to that point through the reducer's own merge, in order — so a later event
  // that only sets one field leaves the rest as the earlier ones left them, exactly as the fold
  // would. Restating that merge here would be the drift this module exists to prevent.
  function valuesAt(l, id, floorL, floorNames) {
    const who = inForceAt(l, id, floorL, floorNames);
    if (!who.known) return { known: false, reason: who.reason, coverage: who.coverage };
    let s = StateDeriver.defaultSettings();
    const target = { l: l, id: (id == null ? "\uffff" : id) };
    for (const e of _events) {
      if (!(_before(e, target) || (e.l === l && String(e.id) === String(id)))) break;
      if (e.blob) s = StateDeriver.applySettingsEvent(s, e.blob);
    }
    return { known: true, eventId: who.eventId, settings: s };
  }

  // ── QUESTION A: DOES THE NAMED EVENT PRODUCE THE CLAIMED VALUES? ─────────────────────────
  // Recomputed through the reducer's own merge. Three verdicts, never two.
  //   match         the named event reproduces the claim. It is evidence now, not trust.
  //   mismatch      it reproduces something else. Recorded, never enforced.
  //   unverifiable  the event cannot settle the question at all — absent, or a partial write.
  //
  // A partial write is genuinely unverifiable rather than wrong: verification recomputes from
  // DEFAULTS, so an event carrying only some fields cannot substantiate a full claim even when
  // nothing is amiss.
  function checkClaim(claimed, blob) {
    return StateDeriver.settingsClaimVerdict(claimed, blob);
  }

  // ── THE COMBINED PROOF ───────────────────────────────────────────────────────────────────
  // Both questions, for one checkpoint's claim. This is the thing nothing could do before:
  //   A — the named event produces the claimed values, AND
  //   B — the named event really is the one that was in force at that cut.
  //
  // Either half failing is a mismatch. Either half being unanswerable is unverifiable, and the two
  // are kept apart because one is worth retrying and one is not.
  function proveClaim(opts) {
    const o = opts || {};
    const claimed = o.claimed, namedId = o.settingsFrom, atL = o.atL, floorL = o.floorL;
    const floorNames = o.floorNames;

    // NO CODE-DEFAULTS BRANCH. A room that named no settings event used to be validated by
    // comparing the claim against the reducer's built-in defaults — the one assertion in this
    // system checked against the application rather than against the log, and silent when two
    // builds disagreed. Every room now posts its rules at creation (features/room.js), so a
    // null pointer is no longer "the common case": it is a claim with no evidence behind it,
    // and unverifiable is the honest verdict. Withholding the forget licence is the correct
    // consequence — unverified is not permission.
    if (namedId == null) return _record("unverifiable", "names-no-settings-event");

    // B first, because it is the cheaper of the two and the one that can rule the other moot.
    const who = inForceAt(atL, namedId, floorL, floorNames);
    if (!who.known) return _record("unverifiable", "cannot-establish-which-event-governed");
    if (String(who.eventId) !== String(namedId)) {
      // The claim names a real event that was NOT the governing one — a newer change had already
      // landed. This is the case nothing could previously detect.
      return _record("mismatched", "named-event-was-superseded",
        { named: namedId, governing: who.eventId });
    }

    // A second.
    const named = _events.find((e) => String(e.id) === String(namedId));
    if (!named) return _record("unverifiable", "named-event-not-read");
    const v = checkClaim(claimed, named.blob);
    if (v.verdict === "match") return _record("validated", null);
    if (v.verdict === "mismatch") return _record("mismatched", v.reason);
    return _record("unverifiable", v.reason);
  }

  function _record(status, reason, detail) {
    _verdict = { status: status, reason: reason || null, at: _env.now() };
    if (detail) _verdict.detail = detail;
    return Object.assign({}, _verdict);
  }

  // Queryable, so a caller asks a question instead of inferring one from the absence of a log line.
  // The forget path reads this: anything short of an outright "validated" withholds the licence,
  // because unverified and unverifiable are not permission.
  function verdict() { return Object.assign({}, _override || _verdict); }

  // Guard seam. The licence is TWO independent claims — the fold reproducing genesis says the QUEUE
  // is right and says nothing about whether the settings blob was ever authorised — and a headless
  // harness testing the TRIM should not have to stage the settings half to get there.
  let _override = null;
  function _setVerdictForTest(v) { _override = v || null; }
  function licensesForget() { return verdict().status === "validated"; }

  // ── WOULD READING FURTHER BACK CHANGE THIS ANSWER? ───────────────────────────────────────
  // The caller has to know whether paging is worth doing, and the answer depends on WHICH
  // unverifiable this is. That is knowledge about this module's own reason vocabulary, so it lives
  // here rather than as a list of strings matched by transport (P7 — one rule, one place). A caller
  // that matched the strings itself would be a second copy of the vocabulary, free to drift the
  // first time a reason is renamed, and to drift SILENTLY: a stale match reads as "nothing to page
  // for", which is indistinguishable from a healthy client.
  //
  // Exactly two reasons mean "my reading does not reach far enough", and they are the two halves of
  // one gap:
  //   cannot-establish-which-event-governed   `_canAnswerAt` refused: coverage does not reach the
  //                                           moment being asked about at all.
  //   named-event-not-read                    coverage reaches it, but the event the claim NAMES
  //                                           sits below the reading window, so question A has
  //                                           nothing to recompute from.
  //
  // Everything else is deliberately excluded, and the exclusions are the load-bearing part:
  //   mismatched          CONCLUSIVE. Paging to look for a kinder answer is exactly the retry this
  //                       verdict exists to forbid.
  //   validated           nothing to improve.
  //   names-no-settings-event / no-claim / no-settings-in-event / partial-event
  //                       the evidence is in hand and it does not settle the question. Reading more
  //                       of the channel cannot change what the named event contains.
  //
  // And `_reachedGenesis` short-circuits it: there is nothing earlier to read, so a `true` here
  // would send a caller paging forever against a channel it has already exhausted.
  function needsDeeperRead() {
    if (_reachedGenesis) return false;
    const v = verdict();                       // through the accessor, so the guard seam reaches it
    if (v.status !== "unverifiable") return false;
    return v.reason === "cannot-establish-which-event-governed" ||
           v.reason === "named-event-not-read";
  }

  // ── BACKFILL ─────────────────────────────────────────────────────────────────────────────
  // Reach further back down the settings channel. Cheap because the channel is quiet, and bounded:
  // it stops once it can answer, rather than always paging to the beginning.
  //
  // ── WIRED IN J35. The caller is `matrixbridge.js`'s floor-change subscriber. ──────────────
  // Swept three times as a dead seam before anyone asked the question that decides it, which is not
  // "who calls it" but "is the read-back WANTED". It is, and it is now reached: a client whose
  // reading does not go deep enough to prove its floor's settings claim pages this channel to
  // genesis, re-proves, and then trims on the answer. `needsDeeperRead()` above is what the caller
  // asks; the ordering (page -> prove -> trim) is the licence chain's, because the trim destroys
  // the evidence the proof reads.
  //
  // WHY THE READ-BACK IS THE ONLY ROUTE, MEASURED RATHER THAN REASONED.
  // `_canAnswerAt` has two routes and J35's entry asked whether the caller should reach the second
  // by passing an `atL` distinct from `floorL` — in which case the floor branch would start working
  // and this function would be needed far less. Driven
  // (`tools/probes/probe-settings-readback.js`), and the answer is NO, for a reason stronger than
  // "it does not help": asking at any position other than the cut asks about the WRONG MOMENT, and
  // a seed whose pointer names a settings event that did not exist at its cut is then VALIDATED.
  //
  //     seed    client  atL       verdict
  //     HONEST  full    =floorL   validated
  //     LYING   full    =floorL   mismatched / named-event-was-superseded   <- the protection
  //     LYING   full    =head     validated                                <- it is GONE
  //     LYING   thin    =head     validated                                <- and for this client
  //     HONEST  thin    =head     unverifiable / named-event-not-read      <- and it never helped
  //
  // The claim under proof is "these were the settings in force AT THE FLOOR'S CUT", so question B
  // has to be asked at the cut. The floor branch cannot serve this caller for a second, structural
  // reason: it closes the gap below `floorL` using what the floor NAMES, and here the floor is the
  // thing being verified — it would be its own evidence. What the thin client is missing is not a
  // bound, it is a READING, which is what this function gets.
  //
  // (Also considered and rejected: bounding on the PREVIOUS floor, which is non-circular. `Floor`
  // exports no accessor for a superseded floor, so it would mean new state there — and it does
  // nothing at all for a first floor, which is exactly the thin-join client this exists to serve.)
  async function readBack(toL) {
    if (typeof _env.pageSettings !== "function") return { ok: false, reason: "no-pager" };
    const from = (typeof toL === "number") ? toL : 0;
    if (_reachedGenesis) return { ok: true, reason: "already-complete", added: 0 };
    if (_readFromL !== null && _readFromL <= from) return { ok: true, reason: "already-covered", added: 0 };
    let events = null;
    try { events = await _env.pageSettings(from, _readFromL === null ? Infinity : _readFromL); }
    catch (e) { return { ok: false, reason: "page-threw" }; }
    if (!Array.isArray(events)) return { ok: false, reason: "page-failed" };
    const r = ingest(events);
    markReadFrom(from);          // the RANGE was examined, whatever it happened to contain
    if (from <= 0) _reachedGenesis = true;
    return { ok: true, added: r.added, total: r.total };
  }

  function reset() {
    _events = []; _readFromL = null; _readToL = null; _reachedGenesis = false;
    _verdict = { status: "not-yet-run", reason: "nothing-read", at: 0 };
  }

  function known() { return _events.slice(); }

  return {
    TYPE, attach, ingest, markGenesisReached, markReadFrom, coverage, _setVerdictForTest,
    inForceAt, valuesAt, checkClaim, proveClaim, verdict, licensesForget, needsDeeperRead,
    readBack, reset, known,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { SettingsProof };
