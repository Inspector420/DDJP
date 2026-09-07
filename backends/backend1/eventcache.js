// backends/backend1/eventcache.js
// The durable raw-events store — the VOUCHER SEAM (a copy of each Spine event's
// original content, kept so a redaction/edit can be refused by re-ingesting the
// original). MatrixBridge writes here; the redaction path reads here; the future
// voucher layer reads here too. No feature/ui module touches it (check-storage).
//
// Two representations (09 §5.1):
//   • a synchronous RAM map — the HOT read path. store/get/has are synchronous
//     and unchanged, so the redaction-restoration path (which reads inline during
//     ingest/replay) does not move.
//   • IndexedDB (via the private IDB engine) — DURABLE backing + fast-reload seed.
//     Writes are write-through (fire-and-forget); a refresh rehydrates the RAM
//     map from IDB via ensureLoaded() before replay needs it.
//
// This replaces the old localStorage backing, whose ~5 MB cap silently swallowed
// writes once full — which weakened redaction-refusal (an uncached original can't
// be restored). IndexedDB is roomy AND we now cap explicitly (oldest-first), so
// the recent, still-vulnerable tail is reliably retained. The real, consensus-
// driven bound is checkpoint retention (Phase 1b); CAP is the interim ceiling.
//
// Degradation (09 §10): if IndexedDB is unavailable (or the engine isn't loaded,
// e.g. a headless guard), EventCache runs RAM-only — durability is lost across
// reloads, but every synchronous operation still works and the app still runs.
//
// Depends on: IDB (engine, optional at runtime).

const EventCache = (() => {
  const STORE = "events";
  // THE CEILING IS BYTES, NOT A COUNT. What actually constrains a browser tab is memory,
  // and events vary enormously in size — a play is small, a settings event with two full
  // tables is not — so a flat count either wastes room or blows past it. 200MB is roomy but
  // safe: browsers get unstable well before a gigabyte and this is one tab among many.
  const BYTE_CAP = 200 * 1024 * 1024;
  const HARD_COUNT_CAP = 200000;   // backstop against pathological tiny-event floods
  function _sizeOf(raw) {
    try {
      const b = raw && raw.content && typeof raw.content.body === "string" ? raw.content.body.length : 0;
      return b + 200;              // + a flat allowance for the envelope
    } catch (e) { return 200; }
  }

  const _mem = new Map();      // eventId -> raw  (the synchronous hot store, authoritative for reads)
  let _loadPromise = null;     // idempotent hydrate

  function _idbOk() {
    try { return typeof IDB !== "undefined" && IDB.supported(); }
    catch (e) { return false; }
  }

  // Enforce CAP on the RAM map (oldest by Lamport l first), and mirror the
  // evictions into IDB. Uses the engine's pure, guard-tested evictionPlan.
  // Eviction preference. When we must shrink, drop the copies the RETIRE RULE already clears —
  // events SATISFIED under the trust cascade (enough other people can still supply them). An
  // unsatisfied event is kept as long as possible, because we may be its LAST holder; dropping it
  // is the one thing that actually loses history. If shedding every retirable copy still isn't
  // enough we fall back to oldest-first, because the cap has to hold — a browser can't grow without
  // bound. That fallback is safe (losing old history is never corruption) but it's a last resort,
  // not the default. Best-effort: if the trust modules aren't loaded we degrade to oldest-first.
  // THE PLAN. Split out from the execution so it can be DRY-RUN against a real room. The floor
  // resolution below used to be the doubtful part — it had never run against a real checkpoint,
  // because nothing emitted a position to resolve. generate() has emitted `floorL` since floors
  // became segment-scoped, so the first branch now fires and the banked tier is reachable. The plan
  // still names WHY the floor resolved the way it did and which tier the drop loop stopped in,
  // because "0 dropped" on its own tells you nothing either way.
  // `force` computes the plan even when we are under cap (dry runs need it; _evict does not).
  // WHERE I STAND, asked of the same places everything else asks. Both fail CLOSED: an unknown rank
  // holds more, not less, because dropping is the one action here that loses history.
  function _myRank() {
    try { if (typeof Floor !== "undefined" && Floor._envProbe) return Floor._envProbe().myRank; }
    catch (e) {}
    return null;
  }
  function _plan(force) {
    let bytes = 0;
    const all = [];
    for (const [id, raw] of _mem) {
      const sz = _sizeOf(raw);
      bytes += sz;
      all.push({ key: id, order: (raw && raw.l) || 0, raw: raw, size: sz });
    }
    const overCap = bytes > BYTE_CAP || _mem.size > HARD_COUNT_CAP;
    const plan = { bytes: bytes, count: _mem.size, overCap: overCap,
                   floorL: null, floorResolved: null, floorWithheld: false,
                   floorReason: null, grade: null, licence: null,
                   tiers: null, wouldDrop: null };
    if (!overCap && !force) return plan;

    let cov = null, settings = null, floorL = null, floorReason = null, grade = null;
    try { if (typeof Vouch !== "undefined" && Vouch.coverage) cov = Vouch.coverage(Array.from(_mem.values())); } catch (e) {}
    try { if (typeof StreamManager !== "undefined" && StreamManager.getState) settings = StreamManager.getState().settings; } catch (e) {}
    // Pair the floor with the pre-forget verdict. Step 3's licence gate wants evidence behind it
    // rather than a first-run guess, and the pairing is only free to collect while it is recorded
    // at the same moment as the floor.
    // THE WHOLE VERDICT, not a boolean. A first real-room dry run reported `licence: false` and
    // that answer was useless: false conflates mismatched with never-ran with couldn't-locate-the-
    // boundary, which is the exact tri-state StreamManager was just rebuilt to stop collapsing.
    // Collapsing it again one layer up wasted the only field that could have said why.
    try {
      if (typeof StreamManager !== "undefined" && StreamManager.seedValidation) plan.licence = StreamManager.seedValidation();
      else if (typeof StreamManager !== "undefined" && StreamManager.seedLicensesForget) plan.licence = { status: StreamManager.seedLicensesForget() ? "validated" : "unknown", reason: "no-detail-available" };
    } catch (e) { plan.licence = { status: "unknown", reason: "threw" }; }
    const licensed = !!(plan.licence && plan.licence.status === "validated");
    // THE FLOOR. Everything from the last trusted checkpoint to now is held; only what a
    // checkpoint has BANKED is genuinely safe to drop, because once a span is summarised
    // nobody can ever need those events to compute state again. This used to be passed as
    // null, so the "banked, safe to drop" branch could never fire at all and retention was
    // a flat count with no relationship to consensus.
    try {
      if (typeof Floor === "undefined" || !Floor.current) floorReason = "no-engine";
      else {
        const t = Floor.current();
        // ONLY A PROVED FLOOR EARNS THE RIGHT TO DROP THE RAW LOG (consensus-models.md 5.9).
        // Since Step 12 a different-author SUBSTITUTE ("quorum") DOES license forgetting: a quorum
        // whose members chain into each other is proof, not merely liveness. What still does not is
        // "stale" — a quorum floor demoted after it stopped verifying under a client that had already
        // forgotten below it. TrustPolicy.earnsForget encodes both, and was, until this line was
        // fixed, called by nothing but the guards.
        grade = (t && t.grade) || null;
        const proved = (typeof TrustPolicy !== "undefined" && TrustPolicy.earnsForget)
          ? TrustPolicy.earnsForget(t && t.grade) : false;
        if (!t) floorReason = "no-checkpoint";
        else if (!proved) floorReason = "not-proved";
        else {
          // RESOLVE THE FLOOR. `floorL` is the Lamport position of the last event a checkpoint
          // covers, and it is now carried in the body and committed by the fingerprint — so the
          // first branch is the normal path. It was not always: this read `t.floorL` then `t.l`
          // while the old engine emitted neither, so the floor was ALWAYS null and the
          // "banked, safe to drop" tier could never fire. The `covers` fallback remains for floors
          // sealed before the field existed, and needs the boundary event to still be held.
          // Unresolvable -> stay null, the conservative answer: hold more than necessary rather
          // than drop something needed.
          if (typeof t.floorL === "number") { floorL = t.floorL; floorReason = "resolved-floorL"; }
          else if (typeof t.covers === "string" && t.covers.indexOf("..") > 0) {
            const lastId = t.covers.split("..")[1];
            const raw = lastId ? _mem.get(lastId) : null;
            if (raw && typeof raw.l === "number") { floorL = raw.l; floorReason = "resolved-covers"; }
            else floorReason = "boundary-not-held";   // the case dry-run exists to detect
          } else floorReason = "no-covers";
        }
      }
    } catch (e) { floorReason = "threw:" + ((e && e.message) || "unknown"); }
    // RESOLUTION AND USE ARE SEPARATE. `floorResolved` is what the covers lookup produced;
    // `floorL` is what eviction is actually allowed to act on. Fixing the missing grade above made
    // the banked tier reachable for the very first time — a live change in the one direction that
    // loses history — so the resolved floor is WITHHELD unless the pre-forget validation has
    // concluded `validated`. That is step 3's licence gate, placed here so the grade fix cannot
    // silently start dropping data that was previously kept. Reporting both is what makes a dry
    // run useful: "the floor resolves to N, and we are not yet permitted to use it" is evidence;
    // a bare null is not.
    plan.floorResolved = floorL;
    plan.floorReason = floorReason;
    plan.grade = grade;
    if (floorL !== null && !licensed) { plan.floorWithheld = true; floorL = null; }
    plan.floorL = floorL;

    // TIER ZERO — NEVER FORGET. A checkpoint asserts the room's settings, and the seed COPIES
    // them: a copy carries no evidence, so once the events below the floor are gone nobody can
    // check whether those settings are what the log actually produced. The seed now NAMES the
    // event instead (settingsFrom), and this keeps that event reachable so the claim stays
    // checkable by anyone rather than trusted because of who sealed it.
    // ONE reference, not two. The room's CURRENT settings event is pinned because live state needs
    // it and it is the cheapest thing in the room to keep. The per-song frozen reference is NOT
    // pinned: eviction is local, the homeserver still has that event, and MatrixBridge can fetch it
    // back by id when something actually asks "what governed this song". Pinning it would keep an
    // event forever against a question nobody may ever ask.
    // The trade is explicit: a fetch can fail, so a per-song claim may sit UNVERIFIED for a while.
    // That is the right failure — unverified is not the same as disagreeing, and the fetch outcome
    // says which. The one thing no fetch recovers is a REDACTED event, and that is already its own
    // path.
    const neverForget = Object.create(null);
    try {
      const t = (typeof Floor !== "undefined" && Floor.current) ? Floor.current() : null;
      const sd = t && t.seed;
      if (sd && typeof sd.settingsFrom === "string") neverForget[sd.settingsFrom] = true;
    } catch (e) { /* unreadable checkpoint -> keep nothing extra, drop nothing extra */ }
    plan.neverForget = Object.keys(neverForget);

    // Three tiers, dropped in this order and never past the last:
    //   1  NON-CRITICAL — display-level bytes carry no history worth protecting
    //   2  BANKED or SATISFIED — a checkpoint covers it, or enough others hold vouches
    //   3  everything else — I may be the LAST HOLDER, and dropping it is the one action
    //      that actually loses history. Only reached if the first two cannot free enough.
    const nonCritical = [], retirable = [], lastHolder = [], pinned = [];
    for (const it of all) {
      // Pinned events leave the tiers entirely. Not "dropped last" — never offered at all, so no
      // amount of pressure can reach them and no future tier reshuffle can quietly include them.
      if (neverForget[it.key]) { pinned.push(it); continue; }
      let critical = true, ok = false;
      try {
        const b = it.raw && it.raw.content && typeof it.raw.content.body === "string" ? JSON.parse(it.raw.content.body) : null;
        critical = !!b && Vouch.NON_CRITICAL_TYPES.indexOf(b.t) < 0;
      } catch (e) {}
      if (!critical) { nonCritical.push(it); continue; }
      if (cov && typeof Vouch !== "undefined" && Vouch.mayRetire) {
        try {
          // The author is passed as { u, r } — the SAME shape the vouch loop uses, so the
          // owner exemption applies here too. It used to be a bare user id, which meant one
          // event read as satisfied while vouching and unsatisfied while evicting.
          const author = { u: (it.raw && it.raw.sender) || null,
                           r: (it.raw && typeof it.raw.senderRank === "number") ? it.raw.senderRank : null };
          // MY RANK. Without it canRetire asked whether ANYBODY was discharged, so a staff client
          // shed its last copy of an event six guests had covered.
          //
          // AND DELIBERATELY NOT MY ID. `mayRetire` does not take one: the never-vouch-yourself
          // clause belongs to DUTY, not to retention. Inverting duty here would report my own
          // events as discharged the instant I publish them — and those are exactly the ones I am
          // the last holder of. This comment used to say the id WAS needed, beside a call that
          // never passed one and a `_myUserId()` helper nothing called; J05 deleted the helper and
          // corrected the comment, because the comment was the error rather than the call.
          ok = Vouch.mayRetire(it.order, cov[it.key] || [], author, floorL, settings, _myRank());
        } catch (e) { ok = false; }
      }
      (ok ? retirable : lastHolder).push(it);
    }

    // OLDEST FIRST within every tier. Never from the middle, never the newest — the newest
    // is both the most vulnerable and the least likely to be banked.
    const byOldest = (x, y) => x.order - y.order;
    nonCritical.sort(byOldest); retirable.sort(byOldest); lastHolder.sort(byOldest);

    const tierOf = new Map();
    for (const it of nonCritical) tierOf.set(it, "non-critical");
    for (const it of retirable) tierOf.set(it, "banked-or-satisfied");
    for (const it of lastHolder) tierOf.set(it, "last-holder");

    // Walk the same order the executor walks, and record where it would stop.
    const order = nonCritical.concat(retirable, lastHolder);
    const drop = [];
    let simBytes = bytes, simCount = _mem.size, stoppedAt = "under-cap";
    for (const it of order) {
      if (simBytes <= BYTE_CAP && simCount <= HARD_COUNT_CAP) { stoppedAt = drop.length ? tierOf.get(it) : "under-cap"; break; }
      drop.push(it); simBytes -= it.size; simCount -= 1;
      stoppedAt = "exhausted-all-tiers";
    }
    if (drop.length && simBytes <= BYTE_CAP && simCount <= HARD_COUNT_CAP && stoppedAt === "exhausted-all-tiers") {
      stoppedAt = tierOf.get(drop[drop.length - 1]);   // the tier we were in when pressure cleared
    }

    plan.tiers = {
      pinned:      { n: pinned.length,      bytes: pinned.reduce((s, i) => s + i.size, 0) },
      nonCritical: { n: nonCritical.length, bytes: nonCritical.reduce((s, i) => s + i.size, 0) },
      retirable:   { n: retirable.length,   bytes: retirable.reduce((s, i) => s + i.size, 0) },
      lastHolder:  { n: lastHolder.length,  bytes: lastHolder.reduce((s, i) => s + i.size, 0) },
    };
    plan.wouldDrop = { n: drop.length, bytes: drop.reduce((s, i) => s + i.size, 0), stoppedAt: stoppedAt };
    plan._order = drop;   // internal: the executor's list
    return plan;
  }

  // DRY RUN — a DIAGNOSTIC, and it is MEANT to have no production caller. Computes the whole plan
  // and drops NOTHING. Safe to leave on in a live room; it is the only way to learn whether the
  // floor resolves in production before eviction is wired.
  //
  // The word `diagnostic` is load-bearing in that sentence. Three dead-seam sweeps raised this
  // function because its comment described what it does not do without ever saying what it is
  // FOR, so each sweep had to rediscover the answer. Do not remove the word.
  function dryRunEviction() {
    const p = _plan(true);
    const out = Object.assign({}, p);
    delete out._order;
    return out;
  }

  function _evict() {
    const plan = _plan(false);
    if (!plan.overCap || !plan._order) return;
    for (const it of plan._order) {
      _mem.delete(it.key);
      if (_idbOk()) IDB.del(STORE, it.key).catch(() => {});
    }
  }


  function store(raw) {
    if (!raw || !raw.event_id) return;
    _mem.set(raw.event_id, raw);          // hot path: available to a restore decision immediately
    _evict();
    if (_idbOk()) {                       // durability: write-through, never blocks the caller
      try { IDB.set(STORE, raw.event_id, raw).catch((e) => console.warn("EventCache.store IDB:", raw.event_id, e)); }
      catch (e) { console.warn("EventCache.store failed:", raw.event_id, e); }
    }
  }

  function get(eventId) {
    return _mem.has(eventId) ? _mem.get(eventId) : null;
  }

  function has(eventId) {
    return _mem.has(eventId);
  }

  // Read-only snapshot of every held raw (the RAM map values), as a fresh array. Used by
  // the vouch-bundle builder (Vouch.bundleFor) and any future voucher responder
  // to see what originals this client can attest to. Never mutates; safe on the hot path.
  function values() {
    return Array.from(_mem.values());
  }

  // Rehydrate the RAM map from IDB once, before replay relies on cached originals
  // to refuse redactions. Idempotent; resolves immediately (RAM-only) when there
  // is no IndexedDB. Awaited at the top of MatrixBridge.replayRoom.
  function ensureLoaded() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      if (!_idbOk()) return;              // RAM-only: nothing to rehydrate
      try {
        const all = await IDB.values(STORE);
        if (Array.isArray(all)) {
          for (const raw of all) if (raw && raw.event_id) _mem.set(raw.event_id, raw);
          _evict();                       // defensively re-enforce CAP after a bulk load
        }
      } catch (e) {
        console.warn("EventCache.ensureLoaded failed:", e);
      }
    })();
    return _loadPromise;
  }

  return { store, get, has, values, ensureLoaded, dryRunEviction };
})();
