// backends/backend1/floor.js
//
// FLOOR — THE ONE QUESTION: where do I start computing from, and is that still trustworthy?
//
// This concept had no home. Its seven jobs were spread across three files: the backward search
// lived in the vouching policy, the agreement check lived in the checkpoint engine, and
// adopting, grading, re-checking and re-fetching were mixed into the same file that also emits
// checkpoints. Nothing owned the concept, so its rules never reached the paths that needed them.
//
// That is not a tidiness argument. Four separate bugs came from it, and they are the reason this
// module exists:
//
//   · a lost floor raised a "fetch history" flag that only got read when a song played — so a
//     quiet room, which is exactly when a deletion is least likely to be noticed, never recovered
//   · the availability skip moved the room forward without waking any of this
//   · vouching was never bounded by the floor, because the floor was never passed in, so clients
//     kept protecting events a checkpoint had already banked
//   · the saved floor was discarded on every reload — the restore ran during wiring, before
//     replay, so it verified against an empty log and failed every time
//
// THE LAST OF THOSE IS NO LONGER FIXED HERE; IT IS GONE. Moving the restore after replay was not
// enough, because the restore rule was STRICTER THAN THE ACCEPTANCE RULE it was restoring: it
// demanded a recompute of every grade, including `verified` floors taken on an owner's authority
// which by definition were never computed. It also could not succeed in the common case — the
// recompute looks for the floor's `covers` START, which is below the floor by definition and which
// trimming has already dropped — so the answer was `did-not-recompute` and the saved floor was
// DELETED. Two rules that contradicted each other, and the stricter one ran second.
// There is one path now: replay rebuilds the log, checkpoints arrive, adoption picks the best one.
// The floor is IN MEMORY ONLY and is re-earned on every load. See check-floor-reload.
//
// Nobody wrote those. They are what happens when a concept is spread thin enough that no single
// file is responsible for it.
//
// WHAT THIS MODULE OWNS: collect · search · verify · adopt · grade · re-check · re-fetch ·
// authorise forgetting.
// WHAT IT DOES NOT OWN: emitting checkpoints (that is Checkpoint) and deciding what "protected"
// means (that is Vouch). Floor never asks Vouch. The arrows point one way and there are no loops:
//
//     Checkpoint ──asks──▶ Floor   "where does my segment start?"
//     Vouch      ──reads─▶ Floor   "don't bother with anything below it"
//     Floor      ──tells──▶ Memory "you may forget below here"
//
// Depends on: TrustPolicy (the bar), StateDeriver (recompute), CheckpointFormat (the fingerprint,
// at load time). **Not Ranks** — that was listed here and never used; the tiers reach this module
// through the settings tables the caller passes, not through the ladder. It no longer asks
// Session anything: the only question that needed a phase was "has replay finished, so is it safe
// to verify a stored floor?", and there is no stored floor.
//
// EXPORTS `sigOf` — the floor's identity, owned here because the floor is owned here. StreamManager
// keys its validation record and its adoption re-derive on the same value and READS it rather than
// recomputing, so a licence keyed on one shape can never be compared against another.
//
// LOAD ORDER: needs CheckpointFormat AT LOAD TIME (it aliases the format's functions into
// constants). Everything else it uses is resolved when a function runs, so order does not matter
// for those. Two guards failed on exactly this the moment the format was extracted — which is the
// right failure: a real constraint should break loudly rather than resolve to undefined later.

const Floor = (() => {

  // Every VERIFIED checkpoint we have seen. This is the search space, and each entry has to be a
  // whole checkpoint including its seed — the search can hand back a floor authored by someone
  // else at an older cut, and adopting it means computing from ITS state.
  //
  // `prev` matters as much as `seed`: the fingerprint spans n, prev, seed, floorL, thin and
  // covers, so an entry missing prev recomputes as prev:null and mismatches whenever its author
  // chained onto a floor of their own. That made a quorum adoptable only from each author's
  // first-ever seal — silently, with no failing guard.
  const SEEN_CAP = 24;   // each entry carries a seed (bounded by room size, not history), so tens
                         // of KB. Comfortably above any bar the shipped table can ask for.
  let _seen = [];
  let _trusted = null;          // { n, prev, seed, h, covers, floorL, thin, by, grade, ts }
  // WHAT THE SHARED DERIVATION JUST REFUSED. `thinJoin` runs immediately after a refusal, so this is
  // what tells it whether a candidate is a recovery or the floor it has just rejected coming back.
  let _refusedSig = null;
  // WHICH CHECKPOINT IS THIS — the floor's identity, owned here because the floor is owned here, and
  // EXPORTED because `streammanager` asks the same question to key its validation record and its
  // adoption re-derive. Built independently in both modules it was the same expression twice, and a
  // licence keyed on one shape then compared against another is one edit away. `null` for no floor
  // rather than a string, so a missing floor can never accidentally equal a recorded value.
  const sigOf = (f) => (f ? (f.n + ":" + (f.h || "")) : null);
                                // `ts` is WHEN this floor came into existence — the seal cadence
                                // measures its cooldown from it. See _anchorTsFor.
  // NO `_needsRepage` FLAG. It existed alongside `needsRepage()`/`clearRepage()` and nothing in
  // production ever read either: the re-page wiring subscribes to the `demoted`/`withdrawn`
  // EMISSIONS instead. A flag beside an emission that says the same thing is two answers to one
  // question, and the flag is the one nobody reads — which is the bug this module's change bus
  // was built to delete. Resolved in J02, the job that owns the weakening path. See 09-roadmap.md.

  // NO SILENT GLOBAL FALLBACKS. These used to default to reaching for StreamManager, so a caller
  // that forgot to attach quietly worked off whatever happened to be loaded — and a guard that
  // forgot to attach passed for the wrong reason, which is this codebase's signature failure. An
  // unwired module must fail VISIBLY. Empty defaults do that: the answers become "I hold nothing",
  // which refuses rather than invents.
  let _env = {
    // NO `now`. One was injected here and read by nothing — every time this module needs a
    // timestamp it is a SERVER stamp carried in on a checkpoint (see `remember`/`_anchorTsFor`),
    // never a local clock, so the field could only ever have been a way to get that wrong.
    // Deleted in J05 along with the attach site that supplied it.
    log: () => [],
    settings: () => ({}),
    myRank: () => null,
    trimmed: () => false,       // has this client already forgotten below its floor?
    // NO STORAGE PROVIDERS. The floor is held in memory and re-earned on every load; see the
    // header. A `save` with no `load` is a write nobody reads, which is how the restore rule and
    // the acceptance rule were able to drift apart without anything noticing.
  };
  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  // ── THE CHANGE BUS ───────────────────────────────────────────────────────────────────────
  // Adopting, moving or losing a floor is the most consequential state change in the system: it
  // decides what everyone computes from, bounds what vouching owes, and licenses forgetting. In the
  // old tree it told NOBODY — a client raised an "I need history" flag and nothing read it until
  // the next song played, so a quiet room never recovered.
  //
  // A flag nobody reads is this codebase's signature bug. Emitting makes wiring declarative —
  // "floor changed -> recompute duty" — rather than an orchestrator remembering to call things in
  // the right order, which is precisely what it kept failing to do.
  const _listeners = [];
  function onChange(fn) { if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }

  // EMITTING IS RE-ENTRANT AND MUST NOT BE. A listener is going to be something like "the floor
  // moved, recompute duty" — and a listener that reaches back into this module (asking it to
  // re-validate, say) would run while an adoption is still half-applied, reading a floor whose
  // fields are set but whose announcement has not finished. Worse, a chain of listeners could loop.
  //
  // Found by reading rather than by a crash, which is the point: this fires zero times in a test
  // that has no listeners, so it would have stayed invisible until something was wired to it.
  //
  // Two defences, both cheap. The DEPTH guard makes re-entry a no-op rather than a recursion, and
  // emitting AFTER the mutation is complete means any listener that does read back sees a settled
  // floor. Listener errors are swallowed for the usual reason: a subscriber must never be able to
  // fail an adoption that has already been verified.
  let _emitting = false;
  function _emit(kind, detail) {
    if (_emitting) return;
    _emitting = true;
    const ev = Object.assign({ kind: kind, floorL: position(), grade: grade() }, detail || {});
    try { for (const fn of _listeners) { try { fn(ev); } catch (e) {} } }
    finally { _emitting = false; }
  }

  // ── THE FORMAT IS NOT OURS ───────────────────────────────────────────────────────────────
  // The fingerprint used to live here, and Checkpoint called Floor.fingerprint to build one — so
  // Checkpoint depended on Floor for two unrelated reasons and only one was legitimate. The format
  // is what a checkpoint IS; Floor is a CONSUMER of it, exactly like Checkpoint. Re-exported so
  // callers keep working, but the definition has one home now.
  const fingerprint = CheckpointFormat.fingerprint;
  const verify = CheckpointFormat.verify;

  // ── COLLECT ──────────────────────────────────────────────────────────────────────────────
  // Rank is the CHANNEL the checkpoint arrived on, never a body field. Identity is what the
  // substitute bar counts.
  // `ts` IS KEPT, and it is the one field that makes the seal cadence expressible. A checkpoint
  // records when it was written; a floor derived from it inherits that time. Without it the cadence
  // had to ask "when did a checkpoint last go PAST me", which is a different question from "when
  // did I last get a floor" and answers wrongly in both directions — see check-seal-cadence-derived
  // part (g). Server time, from the event, never a local clock.
  function remember(cp, originRank, author, ts) {
    if (!cp || !verify(cp) || !author) return false;
    _seen = _seen.filter((x) => !(x.u === author && x.covers === cp.covers)).concat([{
      u: author, r: (typeof originRank === "number") ? originRank : 0,
      ts: (typeof ts === "number") ? ts : null,
      n: cp.n, prev: cp.prev || null, h: cp.h, seed: cp.seed,
      covers: cp.covers || null,
      floorL: (typeof cp.floorL === "number") ? cp.floorL : null,
      thin: cp.thin === true,
    }]);
    if (_seen.length > SEEN_CAP) _seen = _seen.slice(-SEEN_CAP);
    // ── DATING A FLOOR I SEALED MYSELF ───────────────────────────────────────────────────────
    // `seal()` adopts its own checkpoint immediately — correctly, because I folded it and that is
    // the strongest evidence there is. But it adopts DIRECTLY, before the event exists anywhere,
    // so there is no arrival time to read and `ts` is null. When my own checkpoint later syncs
    // back, `adopt` refuses it as "not an improvement" (identical position), which is also right —
    // and the arrival TIME is then thrown away with it.
    //
    // That time is not a nicety. The seal cadence is `newest event's ts - my floor's ts`, so an
    // undated floor reads as Infinity and the client is permanently clock-due — falling back to
    // the page-local stopwatch that the derived cadence exists to replace. The result was two
    // cadences in one room: peers on the shared server clock, and the client that seals most on a
    // private timer, so they never came due together and the rank ladder could not order them.
    //
    // Dating is not adopting. Nothing about which floor I hold changes here, so there is nothing
    // to announce; only a field that was unknowable at adoption time becomes known.
    if (_trusted && _trusted.h === cp.h && (_trusted.ts === null || _trusted.ts === undefined)
        && typeof ts === "number") {
      _trusted.ts = ts;
    }
    return true;
  }

  // ── SEGMENT HELPERS ──────────────────────────────────────────────────────────────────────
  // "After the boundary" means after it under the reducer's OWN sort key (position, then id) —
  // not position alone. Two events can share a position, and comparing position only silently
  // drops the sibling that sorts after the boundary at that same position: neither below the
  // floor nor inside the segment. Gone, with no error.
  function afterBoundary(events, floorL, boundaryId) {
    const bid = String(boundaryId == null ? "" : boundaryId);
    return (events || []).filter((e) => {
      const l = (typeof e.l === "number") ? e.l : 0;
      if (l !== floorL) return l > floorL;
      return String(e.eventId) > bid;
    });
  }

  // floorL is preferred over locating the boundary event, because the boundary is AT the floor and
  // therefore already retirable — a client that has forgotten below its floor does not hold it,
  // which is exactly when a floor still has to be placeable.
  function boundaryOf(floor, log) {
    if (!floor) return null;
    const id = (typeof floor.covers === "string") ? floor.covers.split("..")[1] : null;
    if (typeof floor.floorL === "number") return { l: floor.floorL, id: id };
    if (id) {
      const e = (log || []).find((x) => x.eventId === id);
      if (e && typeof e.l === "number") return { l: e.l, id: id };
    }
    return null;   // neither available: refuse rather than guess
  }

  // ── AGREEMENT IS RECOMPUTATION ───────────────────────────────────────────────────────────
  // Never a fingerprint comparison. `h` commits each author's own private bookkeeping, so two
  // honest peers sealing the very same cut produce DIFFERENT fingerprints — comparing them would
  // reject honest peers as a fork.
  //
  // Take the oldest, fold forward through the events to the next one's cut, and require it to
  // reproduce that checkpoint exactly. Repeat. If it holds end to end, all N authors agree with
  // each other by construction.
  //
  // This is also the only method that survives a thin client: chaining needs only the events
  // BETWEEN members — a bounded stretch that can be paged — while checking each against your own
  // fold requires you to have one.
  //
  // What it proves is AGREEMENT ABOUT STATE, not honesty about history. A quorum that forged
  // identical history from the start would still reproduce each other. What it prevents is any
  // ONE of them diverging, and any drift after the fact.
  function chainVerifies(cps, log) {
    const list = (Array.isArray(cps) ? cps : []).filter((c) => c && typeof c.covers === "string" && typeof c.h === "string");
    if (list.length < 2) return false;
    const events = Array.isArray(log) ? log : _env.log();
    const idx = (id) => events.findIndex((e) => e.eventId === id);
    const lastId = (c) => c.covers.split("..")[1];
    const posOf = (c) => (typeof c.floorL === "number") ? c.floorL : idx(lastId(c));
    const ordered = list.slice().sort((a, b) => posOf(a) - posOf(b));
    let state = ordered[0].seed;
    for (let i = 1; i < ordered.length; i++) {
      const cp = ordered[i];
      const from = idx(ordered[i - 1].covers.split("..")[1]) + 1;
      const to = idx(lastId(cp));
      if (from <= 0 || to < 0 || to < from - 1) return false;   // the joining segment is not held
      const seed = StateDeriver.buildSeed(events.slice(from, to + 1), state);
      if (fingerprint(cp.n, cp.prev || null, seed, cp.floorL, cp.thin, cp.covers) !== cp.h) return false;
      state = cp.seed;
    }
    return true;
  }

  // ── THE BACKWARD SEARCH ──────────────────────────────────────────────────────────────────
  // Walk backward from the present collecting checkpoints at MY TIER OR ABOVE, and stop at the
  // first cut where some tier's bar is met. That cut is the floor.
  //
  // ADOPT THE OLDEST CUT OF THE QUORUM, NOT THE NEWEST. Three high-staff sealing at 100, 120 and
  // 140 have all implicitly attested to everything up to 100, because each of their checkpoints
  // incorporates it. 140 has exactly ONE author behind it — a single-author floor wearing a
  // quorum's name. The quorum is real at 100 and thins above it.
  //
  // ORDERED BY POSITION, never by the author's private counter `n`. That counter runs from
  // whatever its author last trusted, so it is incomparable across authors — a peer that seals
  // often would outrank a fresher floor forever. Position means the same thing to everyone and is
  // readable WITHOUT holding the log, which is what lets a thin client run this search at all.
  //
  // THE WINDOW RETREATS WHEN THE CHAIN BREAKS. Only ever testing sets that end at the newest
  // checkpoint lets one broken stretch near the present kill every candidate, because a superset
  // cannot chain across a gap its subset already failed on. The newest end has to be allowed to
  // move back too.
  //
  // THE OWNER BRANCH IS DELIBERATELY ASYMMETRIC and must stay that way. An owner floor has a bar
  // of 1 and ends the search on authority with NO recompute; a substitute must chain. This was
  // raised and decided: the containment for a bad owner floor is a later owner recompute and,
  // failing that, the social path — export a trusted snapshot, migrate, re-seed. Do not close it.
  function select(myRank, settings, chainVerify) {
    const myTier = TrustPolicy.observerTier(myRank);
    // A floor with no position cannot be placed without holding the log — which is exactly the
    // client this search exists to serve.
    const list = _seen.filter((cp) => cp && typeof cp.h === "string" && typeof cp.covers === "string" && typeof cp.floorL === "number");
    const ordered = list.slice().sort((a, b) => b.floorL - a.floorL);   // newest cut first

    for (let start = 0; start < ordered.length; start++) {
      const seenAuthor = Object.create(null);
      const quorum = [];
      for (let i = start; i < ordered.length; i++) {
        const cp = ordered[i];
        const t = TrustPolicy.tierOf(cp.r);
        // REDUNDANT, DELIBERATELY, AND MUTATION SAYS SO. Break this line and every guard stays
        // green, because the rule is already enforced one layer down: TrustPolicy._countDistinct
        // ignores entries below the observer's tier, and substituteTrusted stops scanning past it.
        // Kept because it states the walk's rule at the point where a reader is working out what
        // the walk means — and documented as redundant so nobody mistakes it for the enforcement.
        // (The old tree carried the same clause with the same note. Copying the clause and dropping
        // the note is how a redundant line gets mistaken for a load-bearing one.)
        if (t > myTier) continue;                                   // below me: does not bind me
        if (t === 0) return { floor: cp, tier: 0, verified: false }; // OWNER: bar 1, stop here
        const who = cp.u || null;
        if (!who || seenAuthor[who]) continue;                      // one entry per author
        seenAuthor[who] = 1;
        quorum.push(cp);
        const tier = TrustPolicy.substituteTrusted(quorum, settings, myRank);
        if (tier === null) continue;                                // bar not met — keep walking
        if (typeof chainVerify === "function" && chainVerify(quorum) !== true) break;
        // THE GROUP COMES BACK TOO. The floor sits at the OLDEST cut, because that is the position
        // all of them vouch for — but the floor came into EXISTENCE when the last of them arrived
        // and completed the agreement. Those are different moments and the cadence needs the
        // second one; anchoring on the oldest would leave you overdue the instant you adopted.
        return { floor: quorum[quorum.length - 1], tier: tier, verified: true, group: quorum };   // the OLDEST cut
      }
    }
    return null;   // adopt nothing and keep computing from what we hold — always safe
  }

  // ── ADOPT ────────────────────────────────────────────────────────────────────────────────
  // Position decides whether a floor is an improvement, for the same reason the search orders by
  // it: `n` is incomparable across authors.
  //
  // ── THIS POSITION IS READ AS A BOUNDARY, AND IT IS ALLOWED TO GO AWAY ───────────────────────
  // J03 made `StreamManager`'s ingest gate derive its ACCEPTED boundary from `current()` here,
  // rather than keeping a copy. That gives adoption and withdrawal their effect for free, and it
  // is the reason this must stay retractable: `_withdraw()` sets `_trusted` to null and the client
  // falls back to folding what it holds, so arrivals from inside the old cut have to become
  // admissible again or the fallback is not one.
  //
  // Note the contrast with `StreamManager._raiseBoundary`, which may only ever RISE. That rule was
  // reasoned from destruction — you cannot un-delete, so lowering it is a false statement about
  // your own history. This is a statement of BELIEF about where the room is banked, and belief is
  // retractable. Two boundaries, opposite monotonicity, both correct. Do not "fix" the
  // inconsistency; the reasoning for each is written beside it.
  function _pos(x) { return (x && typeof x.floorL === "number") ? x.floorL : NO_FLOOR; }

  function adopt(selected, computedSelf) {
    if (!selected || !selected.floor) return false;
    const grade = TrustPolicy.gradeForTier(selected.tier, computedSelf === true);
    if (grade === "none") return false;                            // failsafe: keep computing
    const f = selected.floor;
    if (_trusted && _pos(f) <= _pos(_trusted)) return false;        // not an improvement
    // ── `thin` TRAVELS WITH THE FLOOR, AND IT USED NOT TO (J46) ────────────────────────────
    // `prev` was kept here from the start and `thin` was dropped, which read as tidiness: nothing
    // downstream asked for it. Then J46 needed the two TOGETHER — `prev === null && thin === true`
    // is the author's declaration that its seed ORIGINATES rather than SUMMARISES — and half a
    // pair is not a pair. Measured (`probe-j46-fold` R30): the checkpoint carried both, the
    // adopted floor carried one, so the marker settled by the previous session could not be read
    // by the code that had to read it.
    //
    // It is not a new fact and not a new field. `remember` already keeps it in `_seen` and the
    // FINGERPRINT already commits it, so carrying it forward is declining to discard something
    // that arrived committed — the opposite of a body claim honoured on trust.
    _trusted = {
      n: f.n, prev: f.prev || null, seed: f.seed, h: f.h, covers: f.covers,
      floorL: (typeof f.floorL === "number") ? f.floorL : null,
      thin: f.thin === true,
      by: f.by || f.u || null, grade: grade,
      ts: _anchorTsFor(selected),
    };
    _emit("adopted", { by: _trusted.by, computedSelf: computedSelf === true });
    // A refusal is about ONE decision. Once anything is genuinely adopted the client has moved on,
    // and holding the old signature would lock out a floor that later becomes provable.
    _refusedSig = null;
    return true;
  }

  // ── THIN JOIN — hold little, and FETCH WHAT YOU NEED TO VERIFY ───────────────────────────
  // "To verify" is the whole clause. Paging is the slow part, so "three high-staff already said so,
  // and paging would only confirm it" is exactly the shortcut that turns the cascade into
  // trust-by-assertion at every level — every tier resting on the tier above having checked, and
  // nobody having checked. It also makes forgetting unsafe: once a substitute floor earns the right
  // to drop history, an unverified adoption is a licence to delete on somebody's word.
  //
  // Two paths, and the cheap one is the common one:
  //   an OWNER floor  adopt on authority, NO paging at all. In a room with a live owner-bot this is
  //                   the ordinary case, which is what makes thin joining nearly free.
  //   a SUBSTITUTE    page only the stretch between the quorum's oldest and newest member — bounded
  //                   by segment length, not by history — chain them into each other, adopt the
  //                   OLDEST cut.
  //
  // A REFUSAL TO CHECK IS NOT A PASS. Every failure below adopts nothing and says why.
  async function thinJoin(pageFn) {
    // First WITHOUT paging. A chainVerify that always refuses means only the owner short-circuit
    // can return, so this asks "is there an owner floor?" using the one search rather than a second
    // copy of the rule.
    const free = select(_env.myRank(), _env.settings(), function () { return false; });
    if (free && free.tier === 0) {
      if (!adopt(free)) return { mode: "none", reason: "owner-floor-ungraded" };
      return { mode: "owner", paged: 0, floorL: position() };
    }

    const span = _quorumSpan();
    if (!span) return { mode: "none", reason: "no-candidates" };
    if (typeof pageFn !== "function") return { mode: "none", reason: "no-pager" };

    let paged = null;
    try { paged = await pageFn(span.fromL, span.toL); }
    catch (e) { return { mode: "none", reason: "page-threw" }; }

    // ── WHAT DID WE ACTUALLY LEARN? ────────────────────────────────────────────────────────────
    // A pager answers either from the raw cache or from the room, and only the second is new
    // evidence. This function runs immediately after `revalidate` REFUSED a floor, so taking the
    // same one back on the same pile means a looser question was asked of evidence already held.
    // A BARE ARRAY is read as "learned nothing": callers that say nothing about provenance must not
    // count as having fetched, or the rule holds only for callers that opted in.
    const events = Array.isArray(paged) ? paged : (paged && paged.events);
    const fetched = !Array.isArray(paged) && !!(paged && paged.fetched);
    if (!Array.isArray(events) || !events.length) return { mode: "none", reason: "page-empty" };

    const selected = select(_env.myRank(), _env.settings(),
      function (quorum) { return chainVerifies(quorum, events); });
    if (!selected) return { mode: "none", reason: "unverified", paged: events.length };

    // ── LOCAL EVIDENCE MAY NOT TAKE BACK WHAT THE SHARED DERIVATION REFUSED (J43) ──────────────
    // `Continuity`'s rule applied to the floor: evidence nobody else has is not grounds to act.
    // Being behind is ordinary; computing from a base the room rejected is a fork. Narrow on
    // purpose — a genuine fetch still recovers, and `_refusedSig` clears on adopt and on reset, so
    // this is one decision rather than a standing ban against a floor that may later be provable.
    if (!fetched && _refusedSig && sigOf(selected.floor) === _refusedSig) {
      return { mode: "none", reason: "refused-and-nothing-learned", paged: events.length };
    }
    if (!adopt(selected)) return { mode: "none", reason: "ungraded", paged: events.length };
    return { mode: "quorum", paged: events.length, floorL: position() };
  }

  // The Lamport range the candidates span — at MY TIER OR ABOVE only, because paging a stretch to
  // check floors that could never bind me is work for nothing.
  //
  // INCLUSIVE of the oldest member's own cut. Chaining folds FORWARD from that member's seed, so
  // the event AT its cut is already banked and asking for it is one event of waste — but asking
  // from lo+1 would be wrong the moment two events share a position, since the sibling that sorts
  // after the boundary is genuinely needed. Waste one, never miss one.
  function _quorumSpan() {
    const myTier = TrustPolicy.observerTier(_env.myRank());
    let lo = null, hi = null;
    for (const e of _seen) {
      if (!e || typeof e.floorL !== "number") continue;
      if (TrustPolicy.tierOf(e.r) > myTier) continue;
      if (lo === null || e.floorL < lo) lo = e.floorL;
      if (hi === null || e.floorL > hi) hi = e.floorL;
    }
    if (lo === null) return null;
    return { fromL: lo, toL: hi };
  }

  // ── RE-CHECK ─────────────────────────────────────────────────────────────────────────────
  // A floor is monitored, not verified once and forgotten.
  //
  // THE GRADE DECIDES WHAT GETS RE-CHECKED, and it is the asymmetry already decided rather than a
  // new rule:
  //   "real"     I computed it. There is no removal path in the derived log, so a deletion cannot
  //              change a state already computed. Nothing to re-check.
  //   "verified" an OWNER floor, adopted on authority with no recompute, ever. Re-checking here
  //              would add that recompute by the back door.
  //   "quorum"   the only grade whose trust came from recomputation, so the only one whose
  //              verification can stop holding.
  //
  // WITHDRAWAL IS CONDITIONAL. A quorum floor now earns forgetting, so it may already have caused
  // history to be dropped — and withdrawing it would then leave NOTHING to compute from (vouch
  // records carry no sender, and the reducer needs one). So:
  //   NOT TRIMMED — withdraw. Falling back to what we hold is safe.
  //   TRIMMED     — demote to "stale", keep it as the compute base because it is the only one we
  //                 have, earn nothing further from it, and flag a re-page.
  function revalidate() {
    // ── ONLY A QUORUM FLOOR IS RE-CHECKED, AND THAT IS THE DECISION, NOT AN OMISSION ────────
    // This line reads like an unfinished job and is not one. The four grades rest on different
    // things, and only one of them rests on something that can decay:
    //
    //   quorum    several peers agreed, and I verified by recompute. Peers can retract, and the
    //             chain between them can stop verifying — evidence, and evidence goes stale.
    //   real      I computed it myself. Nothing anyone else does can make my own arithmetic
    //             untrue, so there is nothing to re-check.
    //   verified  the OWNER said so, adopted on authority WITHOUT recompute by design. Re-running
    //             the search would find the same checkpoint and say "still holds" — or, on a
    //             transient miss, find nothing and fall through to _withdraw() below, throwing
    //             away the strongest floor in the room over a hiccup. The early return is what
    //             prevents that.
    //
    // A floor is a SNAPSHOT, not a live pointer: `seed` is copied in, so deleting the checkpoint it
    // came from cannot invalidate it. What deletion removes is the evidence OTHERS would use to
    // reach the same floor independently.
    //
    // THE RESIDUAL, AND IT IS WIDER THAN IT WAS: if the chain under a non-quorum floor stops
    // verifying at runtime, nothing notices. That used to be bounded by a reload, because the
    // restore path re-checked every grade on load. Deleting the restore removes that bound — a
    // reload now re-earns the floor from arriving checkpoints instead of re-checking the old one,
    // which is a different thing. The bound was worth little in practice (the restore failed on
    // every reload it ever ran, so nothing was actually being re-checked), but it was claimed here
    // and is no longer claimed. Recorded rather than fixed, and recorded as WIDER.
    if (!_trusted || _trusted.grade !== "quorum") return { moved: false, reason: "not-a-quorum-floor" };
    let selected = null;
    try {
      selected = select(_env.myRank(), _env.settings(), (q) => chainVerifies(q, _env.log()));
    } catch (e) { return { moved: false, reason: "check-threw" }; }   // failing to CHECK is not evidence

    if (selected && selected.floor && _pos(selected.floor) === _pos(_trusted)) {
      return { moved: false, reason: "still-holds" };
    }
    if (selected) {
      const grade = TrustPolicy.gradeForTier(selected.tier, false);
      if (grade === "none") { _withdraw(); return { moved: true, reason: "ungradeable" }; }
      const f = selected.floor;
      // ── A REPLACEMENT THAT STEPS BACKWARDS IS A RETREAT, NOT A MOVE AND NOT A WEAKENING (J54) ─
      // There used to be a third exit here: when an OLDER group still verified, the floor was
      // replaced with it and the change announced as `moved`. That is the shape of an improvement,
      // and the whole system reads it as one — `moved` is what the TRIM subscriber acts on, so the
      // forget boundary followed the floor DOWN, and the re-page subscriber (demoted/withdrawn)
      // never fired. The client ended up computing from a mark beneath its own holdings with
      // nothing told to fix it. Driven: seed at 6, oldest event actually held at 15, the room
      // reporting a state six songs old with an empty history and nothing thrown.
      //
      // THE IDEA WAS NOT WRONG; THE ANNOUNCEMENT WAS. Discarding `f` left a client either computing
      // from a floor that FAILED verification (demoted `stale`) or holding none at all (withdrawn)
      // — both worse than the floor `select` has already handed us, which PASSES. Driven at v321 on
      // a real chain: a client holding a valid floor one cut below came out `withdrawn`.
      //
      // SO IT IS ITS OWN KIND, AND THE POINT IS THAT NOTHING SUBSCRIBES TO IT. The trim subscriber
      // keys on `adopted`/`moved` and must not follow a retreat down; the re-page subscriber keys on
      // `demoted`/`withdrawn` and must not fire, because after this the client holds a floor that
      // verifies. The recorded objection to a new kind — "a second thing to forget to subscribe to"
      // — inverts here: nobody subscribing is the requirement. `check-floor-retreat` asserts all
      // three, so a later subscriber added to this kind turns the build red.
      //
      // ONLY WHILE WE STILL HOLD EVERYTHING. A trimmed client may have forgotten below the older
      // floor, and computing from a mark beneath its own holdings is the failure above, exactly.
      // Untrimmed means the log reaches genesis, so any position is computable. A trimmed client
      // falls through to `_weakened` unchanged — the new path is taken only where it is provably
      // safe, rather than being made general and then guarded.
      // ONE CONSTRUCTION, TWO ANNOUNCEMENTS. The retreat and the ordinary replacement build the
      // SAME floor from the same selection; only what they tell the room differs, and that
      // difference is a subscriber contract rather than a shape. `thin` is carried here for the
      // same reason as in `adopt` — this and `adopt` are the two places a floor is built, and a
      // field kept in one and dropped in the other is silent. `_weakened`'s demotion uses
      // Object.assign and preserves it already.
      const _next = { n: f.n, prev: f.prev || null, seed: f.seed, h: f.h, covers: f.covers,
                      floorL: _pos(f), thin: f.thin === true,
                      by: f.by || f.u || null, grade: grade,
                      ts: _anchorTsFor(selected) };
      if (_pos(f) < _pos(_trusted)) {
        let stillHoldAll = false;
        try { stillHoldAll = !_env.trimmed(); } catch (e) { stillHoldAll = false; }
        if (!stillHoldAll) return _weakened("replaced-by-older");
        _trusted = _next;
        _emit("retreated", { reason: "replaced-by-older" });
        return { moved: true, reason: "retreated" };
      }
      _trusted = _next;
      _emit("moved", { reason: "revalidated" });
      return { moved: true, reason: "replaced" };
    }

    return _weakened("stopped-verifying");
  }

  // The one place that decides what a WEAKENED floor does — reached both when nothing verifies any
  // more and when the only thing that still verifies sits below where we already compute from.
  // `reason` distinguishes them in the log without becoming a second thing to subscribe to: the
  // subscriber keys on `kind`, a human reads the reason. A new emission kind would be clearer in
  // one log line and a second thing to forget to subscribe to, which is the failure this whole job
  // is about.
  function _weakened(why) {
    _refusedSig = sigOf(_trusted);
    let trimmed = true;
    // CANNOT TELL -> ASSUME TRIMMED, which demotes rather than withdraws. Withdrawing on a guess
    // could leave a client that HAS forgotten with no state at all; demoting on a guess only costs
    // it the right to forget more.
    try { trimmed = !!_env.trimmed(); } catch (e) { trimmed = true; }
    if (!trimmed) { _withdraw(); return { moved: true, reason: "withdrawn", why: why }; }
    if (_trusted.grade === "stale") return { moved: false, reason: "already-stale", why: why };
    _trusted = Object.assign({}, _trusted, { grade: "stale" });
    _emit("demoted", { reason: why });
    return { moved: true, reason: "demoted-stale", why: why };
  }

  // Only the persistence was deleted. Withdrawing still clears the trusted floor, flags a re-page
  // and announces itself — that is the real work, and none of it involved a disk.
  function _withdraw() { _refusedSig = sigOf(_trusted); _trusted = null; _emit("withdrawn", {}); }

  // ── WHAT EVERYONE ELSE ASKS ──────────────────────────────────────────────────────────────
  // WHEN THIS FLOOR CAME INTO EXISTENCE. One checkpoint for an owner floor or a self-witnessed
  // one, several for a quorum — and for a quorum it is the NEWEST of them, the arrival that
  // completed the agreement. Read out of `_seen`, which is where the timestamps live, so the
  // caller never has to hand one in and cannot hand in a local clock by mistake.
  function _anchorTsFor(selected) {
    const set = (selected && Array.isArray(selected.group) && selected.group.length)
      ? selected.group : [selected && selected.floor];
    let best = null;
    for (const c of set) {
      if (!c || !c.h) continue;
      const e = _seen.find((x) => x.h === c.h);
      if (e && typeof e.ts === "number" && (best === null || e.ts > best)) best = e.ts;
    }
    return best;
  }

  function current() { return _trusted; }
  function anchorTs() { return _trusted ? (typeof _trusted.ts === "number" ? _trusted.ts : null) : null; }
  function position() { return _pos(_trusted); }
  function seed() { return _trusted ? _trusted.seed : null; }
  function grade() { return _trusted ? _trusted.grade : null; }

  // Vouching reads this so it only protects events ABOVE the floor, and Continuity reads it so a
  // reference across the boundary is not mistaken for a hole. The old tree never passed the floor
  // in at all, so clients kept protecting events a checkpoint had already banked — which is what
  // "vouching work stays constant rather than growing with room age" was supposed to prevent.
  //
  // NO FLOOR IS -1, AND THAT IS A DECISION RATHER THAN AN ACCIDENT. Every consumer bounds with
  // `l <= floorL`, and no real event sits at or below -1, so -1 means "bound nothing" without any
  // caller needing a null branch. Returning null instead would push a special case into every
  // consumer, and a consumer that forgot it would compare against null and silently bound
  // EVERYTHING — the failure being cheap and silent is exactly why the sentinel is chosen here and
  // written down.
  //
  // ── WHY THE CONSTANT STAYS, AND WHY THE HAND-WRITTEN -1s DO TOO (decided in J05) ──────────
  // This was filed three times as "exported with no consumer, delete it". It has one, and it is
  // the good kind: `check-floor.js` PART H asserts `position() === Floor.NO_FLOOR` rather than
  // restating -1, precisely so a guard cannot agree with a value this module has stopped using.
  // Deleting the constant would force that guard to hardcode the literal — the exact drift it
  // exists to catch. The build law's "a guard exercising it does not count as a caller" is about
  // a guard DRIVING A FUNCTION; a guard reading a constant as its ORACLE is the opposite case.
  //
  // COUNT THE SHAPES, NOT THE SITES — the site count has been got wrong twice (six, then nine),
  // because it is a count of one pattern rather than of the categories. There are FOUR, and only
  // the last can take the constant:
  //
  //   1. SIX `typeof Floor !== "undefined" && Floor.position ? Floor.position() : -1` fallbacks
  //      (four in matrixbridge.js, two in checkpoint.js). Naming NO_FLOOR here is impossible BY
  //      CONSTRUCTION: the branch exists because `Floor` may not be loaded, so the constant is
  //      unreachable exactly where the sentinel is needed.
  //   2. ONE default on an injected reader — `continuity.js`'s `_env.floorL() : -1`. Continuity
  //      does not depend on Floor and must not start.
  //   3. ONE `catch (e) { return -1; }` — matrixbridge's Continuity attach. Reached when
  //      `Floor.position()` THREW, so the constant is again the thing that may be unavailable.
  //   4. `_pos()`, above, inside this module. It names NO_FLOOR, and it is the only one that can.
  //
  // So the literals are deliberate, and they are not a home the constant is competing with: they
  // are the answer for callers that cannot see it. If this is ever raised a fourth time, the
  // question to ask is not "how many -1s are there" but "which of the four shapes is this".
  const NO_FLOOR = -1;

  // `boundFor(vouching)` used to sit here: a synonym for position() that took a `vouching`
  // argument and ignored it. Deleted after an audit of all twelve production floor reads. (No version
// is cited: this tree keeps exactly one version number, in index.html, and a date stamped into a
// comment is a second one that nothing updates.)
  //
  // It was meant to be the door through which consumers took their bound, with the argument
  // distinguishing one consumer from another. It never acquired a production caller — only a
  // guard, which is not a caller. And a door in front of the READ could not have done the job
  // anyway: the bound has to reach the CONSUMER, so what matters is what each consumer does when
  // it does not get one. That is four different things, not one:
  //
  //   Vouch.owed            REFUSES   — { error: "floorL-required" }, guarded in check-vouch
  //   Continuity.mayAdvance FAILS OPEN — { ok: true, state: "unbounded" }, deliberately; a wiring
  //                                     bug must not be able to stop the music. Its three call
  //                                     sites are held only by check-advance-floor-bound, which
  //                                     scans SOURCE. See CONCEPTS.md Part 6 items 10 and 11.
  //   SettingsProof         degrades to "unverifiable", which withholds the forget licence
  //   Checkpoint cadence    floorHead = 0 — conservative; seals sooner rather than later
  //
  // An earlier version of this note said the bound was enforced at the consumer by refusal, "which
  // no routing convention can match — a caller can forget to use a door, but it cannot forget an
  // argument the callee will not proceed without." That is true of Vouch and INVERTED for
  // Continuity, where the callee proceeds and answers permissively. It is corrected here rather
  // than quietly replaced, because a tombstone is read by someone who can no longer check it
  // against the code it describes.

  // Only a PROVED grade earns dropping history. "stale" — a quorum floor demoted after it stopped
  // verifying under a client that had already forgotten — earns nothing further. Routed through
  // the trust seam rather than restated, so the rule keeps one home.
  function earnsForget() { return TrustPolicy.earnsForget(grade()); }

  function reset() { _seen = []; _trusted = null; _refusedSig = null; }

  // Guard seams.
  // Guard seam. Whether this module was ATTACHED is not otherwise observable — an unattached Floor
  // answers "I hold nothing" and so does an attached one in an empty room, and a textual guard can
  // only see that `Floor.attach({` appears in a file, which stays true when the call is disabled.
  // Reporting what the injected environment answers makes the wiring testable by EXECUTION.
  function _envProbe() {
    let logLen = -1, rank = null;
    try { logLen = (_env.log() || []).length; } catch (e) {}
    try { rank = _env.myRank(); } catch (e) {}
    return { logLen: logLen, myRank: rank };
  }

  function _setTrustedForTest(t) { _trusted = t || null; }

  // `_seenForTest()` stood here — `_seen.slice()` under a name that said "no production caller is
  // expected". J26 needed exactly this list for the export picker, and reaching a test seam from
  // production is the shape this tree keeps deleting (SettingsProof.readBack, MediaBlocked's
  // unfinished wire). Replaced by `heldCheckpoints()` below rather than called: the name is the
  // whole point, because a seam named ForTest tells the next reader that nothing depends on it and
  // it may be changed freely. Nothing else referenced it — not one guard — so this is a rename
  // with a copy rule attached rather than a second door onto the same state (P7).

  // ── WHAT THIS CLIENT HOLDS ───────────────────────────────────────────────────────────────
  // The search space, read-only, for anyone who needs to SHOW it rather than search it. J26's
  // export picker is the first such caller: it lists what is held, groups by the rank that
  // authored each one, and labels each with its own stamp.
  //
  // A FRESH COPY PER CALL, PER ENTRY. Same rule and same reason as StreamManager.settingRanges()
  // and Ranks.defaultVouchTable(): a shared array handed to a caller is the caller's array now,
  // and these entries carry the fields adoption reads — `r` decides which tier a candidate binds,
  // `ts` anchors the seal cadence, `floorL` places the cut. A renderer that sorted this list in
  // place would be reordering the search space; one that stamped a display time onto `ts` would
  // be feeding a device clock into the cadence (P2). The entries are copied so it cannot.
  //
  // `seed` is deliberately NOT deep-copied. It is a large object whose only consumers hash or
  // serialise it, both reads — and a deep copy per call on the export path would clone the whole
  // room's state once per render. The shallow copy protects this module's own bookkeeping, which
  // is what a caller can plausibly damage by accident.
  function heldCheckpoints() {
    return _seen.map((e) => Object.assign({}, e));
  }

  return {
    attach, onChange, remember, select, adopt, revalidate, reset, thinJoin, _quorumSpan, anchorTs,
    NO_FLOOR, current, position, seed, grade, earnsForget, heldCheckpoints,
    // pure / verification, exported so the rules are asserted directly
    fingerprint, verify, chainVerifies, afterBoundary, boundaryOf, sigOf,
    _setTrustedForTest, _envProbe,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Floor };
