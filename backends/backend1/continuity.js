// backends/backend1/continuity.js
//
// CONTINUITY — THE ONE QUESTION: is my view of history whole, and may I act on it?
//
// THIS IS A SIXTH CONCEPT, and it was not in the original five. It was discovered by working out
// what actually happens when an event is deleted in a busy room, and it earns its own home because
// it asks a question none of the others do:
//
//     Vouch      "is this safe from deletion?"
//     Floor      "where do I start computing from?"
//     Continuity "AM I WHOLE?"
//
// ── WHY IT HAD TO EXIST ──────────────────────────────────────────────────────────────────────
// A deleted event is recoverable as CONTENT but not as HISTORY. A vouch record carries the content
// and its fingerprint; it does NOT carry the author, and it cannot, because a record commits the
// sender without letting you open the commitment. The reducer needs a sender in three places, so a
// rebuilt event is restore material and never enters anyone's fold.
//
// The consequence is the thing this module exists for. Two clients — one who saw the event and one
// who did not — CANNOT be reconciled by vouching at all. Measured on five plays, with play 2
// deleted before the second client arrived:
//
//     A (saw everything)   now playing: song 4    queue: [song 5, song 6]
//     B (missed play 2)    now playing: song 1    queue: [song 2, song 3]
//
// Both internally consistent. Both correct given what they hold. They disagree.
//
// And it COMPOUNDS: B can legitimately advance from its own head. A rejects B's advance — wrong
// parent. B rejects A's — same reason. Each is right to refuse the other, and they fork
// permanently.
//
// ── THE RESTRAINT ────────────────────────────────────────────────────────────────────────────
// No new consensus machinery is needed. One rule is enough:
//
//     A CLIENT THAT KNOWS IT IS MISSING HISTORY MUST NOT ADVANCE.
//
// B already knows it is short — it holds an event naming a parent it does not have. Holding still
// means the second branch never forms. The fork is prevented rather than repaired.
//
// ── THE GUARD, OR THIS BECOMES A DENIAL OF SERVICE ───────────────────────────────────────────
// A griefer could publish an advance naming a fabricated parent and freeze the room. So a client
// yields ONLY when the missing parent is CORROBORATED — somebody vouched it, or somebody is
// building on it. Uncorroborated, flag it and keep going.
//
// This is why the first vouch matters so much (see Vouch's header). A record is the discriminator
// between "that parent was real and got deleted" and "that parent is fabricated". Aggression and
// arbitration are the same lever.
//
// ── WHAT THIS MODULE DOES NOT DO ─────────────────────────────────────────────────────────────
// It does not repair (that is Vouch), does not adopt (that is Floor), and does not advance (that
// is playback). It answers one question and emits when the answer changes. Detection is not
// response — the module that notices and the module that acts stay apart, which is what lets the
// same detection drive "fix it automatically" in one room mode and "tell a human" in another.
//
// Depends on: Vouch (corroboration). Injected: the held set and the log.

const Continuity = (() => {

  // How many re-check cycles a corroborated gap may persist before we stop waiting. This is the
  // trigger the re-anchor rule was missing while it sat open: "a corroborated gap that will not
  // fill after N cycles" is a defined cause, where "an unfillable gap" never was.
  //
  // Reaching it does NOT re-anchor here — this module only reports. Something with authority acts.
  const STUCK_CYCLES = 6;

  let _env = {
    // No global fallbacks, deliberately. An unattached module must fail VISIBLY rather than quietly
    // work off whatever happens to be loaded — a test that forgets to attach would otherwise pass
    // for the wrong reason, which is this codebase's signature failure.
    held: null,      // () => raw events I hold
    // NO `log`. One was injected and read by nothing: every question this module asks is about
    // what it HOLDS (raw events with their bundles and parents), never about the reducer-shaped
    // fold. Deleted in J05 with its attach site.
    floorL: null,    // () => my floor's position, or -1 for none. Gaps below it are BANKED.
    bankedPi: null,  // () => the play instance my floor's seed banked, or null if I have no floor
    settings: () => ({}),   // () => live room settings, for the vouch table's structural floor
  };
  function attach(env) { _env = Object.assign({}, _env, env || {}); }

  let _gaps = Object.create(null);     // parentId -> { firstSeen, cycles, corroborated }
  let _cycle = 0;
  const _listeners = [];
  function onChange(fn) { if (typeof fn === "function" && _listeners.indexOf(fn) < 0) _listeners.push(fn); }
  function _emit(ev) { for (const fn of _listeners) { try { fn(ev); } catch (e) {} } }

  function _body(raw) {
    try {
      if (!raw || !raw.content || typeof raw.content.body !== "string") return null;
      const b = JSON.parse(raw.content.body);
      return (b && typeof b === "object") ? b : null;
    } catch (e) { return null; }
  }

  // ── THE OWNER-EVENT GAP, AND WHY IT RESOLVES ELSEWHERE ───────────────────────────────────
  // Owner events are never vouched — nobody below the top rank can delete another person's message,
  // so protecting them would mean defending the owner against the owner. The consequence lands
  // here: a missing OWNER event can never be corroborated by a record, because no record of it was
  // ever made.
  //
  // That is not a hole to plug, it is the trust model showing through. A missing owner event means
  // either the owner removed it, which is their prerogative, or you never held it. Neither is
  // settled by evidence from below; both are settled by the OWNER'S FLOOR, which is adopted on
  // authority without recompute and bounds this module's question away entirely (see the floor
  // bound in `check`). Until such a floor arrives, the gap reads as suspect and the client keeps
  // going — which is the right default, because the alternative is stopping on the word of people
  // who cannot see any further than you can.
  //
  // ── PURE: which parents am I short of? ───────────────────────────────────────────────────
  // CHAIN PARENTS ONLY, and that is deliberate rather than a limitation. A vouch reference means
  // "this exists", not "you need it" — treating every one as a gap makes a partial client demand a
  // pile of events it never held and never needed. A `p` reference is different: a held child
  // structurally NEEDS its parent, and without it the chain genuinely cannot be derived through.
  //
  // TWO SETS, AND CONFLATING THEM COST A ROOM EVERY SONG. `scan` is what may DEMAND a parent —
  // bounded by the floor, because a banked event's needs are already accounted for. `haveFrom` is
  // WHAT I ACTUALLY HOLD, and that is a fact about my cache with no floor in it at all.
  //
  // They used to be the same list. The floor's own boundary event is the one every later advance
  // chains onto, by construction — so filtering it out of `have` made adopting a floor manufacture
  // a missing parent pointing at an event sitting in the cache the whole time. Two clients
  // committing the same parent hash then PROVED it, the gap counted as real, and the client was
  // told to hold still. Permanently: nothing can ever fill a gap that was never a gap.
  //
  // EVIDENCE, kept apart from inference. One live client's log shows exactly this hold
  // ("HELD — missing-history"), and the mechanism is reproduced headlessly in
  // check-floor-bound-gap. That it hung the WHOLE room is the operator's report rather than
  // something captured: it follows from every client having adopted a floor, but no second
  // client's log was taken.
  // ── ONLY AN ADVANCE IS A CHAIN LINK ──────────────────────────────────────────────────────
  // The rule above says a gap is a STRUCTURAL need — a held child that cannot be derived through
  // without its parent. Votes and saves carry `p` as well, and theirs is an ANNOTATION TARGET:
  // losing it costs that one reaction and nothing else, because the reducer simply does not count
  // a vote whose playing it never saw. So the code was broader than its own stated rule, and the
  // extra breadth could only ever manufacture holds.
  //
  // It costs no coverage. The advance chain is DENSE — every advance names the one immediately
  // before it — so a play genuinely missing above the floor is still named by whatever chained
  // onto it. A vote pointing at the same event adds nothing the chain has not already said.
  const CHAIN_TYPES = ["ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip"];

  // `bankedPi` is the one parent a floor accounts for BY NAME. See mayAdvance.
  function missingParents(scan, haveFrom, bankedPi) {
    const have = new Set();
    const holdings = Array.isArray(haveFrom) ? haveFrom : (Array.isArray(scan) ? scan : []);
    for (const r of holdings) if (r && r.event_id) have.add(r.event_id);
    const out = [];
    for (const r of (Array.isArray(scan) ? scan : [])) {
      const b = _body(r);
      if (!b) continue;
      if (CHAIN_TYPES.indexOf(b.t) < 0) continue;                 // not a link in the chain
      if (bankedPi && b.p === bankedPi) continue;                 // the floor accounts for it
      if (typeof b.p === "string" && b.p && !have.has(b.p)) {
        if (out.indexOf(b.p) < 0) out.push(b.p);
      }
    }
    return out;
  }

  // ── PURE: is a missing parent CORROBORATED? ──────────────────────────────────────────────
  // What counts as evidence that a parent I lack was REAL — and the answer is narrower than it
  // first looks. Stress-testing caught an earlier version of this rule being CIRCULAR: it treated
  // "an event names this parent" as corroboration, but the event doing the naming is the very
  // claim under question. One message asserting a parent is not evidence of that parent, and under
  // that rule a single fabricated advance corroborated itself and froze the room — the exact denial
  // of service the restraint exists to avoid.
  //
  // So, two kinds of real evidence:
  //
  //   VOUCHED — somebody published a RECORD for it. This is proof: a record carries the content and
  //             its fingerprint, so whoever wrote it demonstrably HELD the bytes. It cannot be
  //             produced by someone who invented the id.
  //
  //   BUILT ON BY SEVERAL — two or more DISTINCT authors independently name it as their parent.
  //             Not proof, but a fabricator would have to persuade an independent second party to
  //             build on their invention, which is materially harder than publishing one message.
  //             The same distinct-people shape the vouch bar and the checkpoint quorum both use.
  //
  // A SINGLE builder is explicitly NOT corroboration, however plausible it looks. That is the
  // circularity above, and holding it as evidence is what a griefer needs.
  //
  // Deliberately NOT "I remember seeing it": memory is not evidence anyone else can check.
  const BUILDERS_NEEDED = 2;

  // ── WHOSE WORD COUNTS — AND WHY THIS IS NOT OPTIONAL ─────────────────────────────────────
  // Two things were wrong here and the second is the serious one. Both found by reading.
  //
  // FIRST: A RECORD DOES NOT PROVE EXISTENCE. `Vouch.verifyRecord` checks that a record's delta
  // hashes to its own fingerprint — SELF-CONSISTENCY. It says nothing about whether the event id
  // the record names ever existed. Anyone can invent content, hash it, and publish a perfectly
  // valid record claiming it is event $X. So "somebody vouched it" is evidence about the PUBLISHER,
  // not about the event.
  //
  // SECOND, AND WORSE: with no rank filter, two throwaway accounts could corroborate a fabricated
  // parent and stop every client in the room. That is a direct violation of the property the whole
  // design rests on —
  //
  //     "a room of only uncategorized accounts cannot manufacture authority — not because the
  //      threshold is high, but because they are structurally excluded"
  //
  // — because freezing the room IS manufacturing an effect. This module had quietly become the one
  // place quantity at the bottom added up to something.
  //
  // THE FIX REUSES THE RULE THE SYSTEM ALREADY HAS rather than inventing a second one. The vouch
  // table already says which ranks satisfy anything: `enough: null` means "this rank's word counts
  // for nobody". Corroboration counts only evidence from ranks that can satisfy something, so the
  // structural exclusion at the bottom holds here exactly as it holds everywhere else.
  //
  // WHY NOT "MY RANK OR ABOVE", as trust decisions normally are? Because the costs are asymmetric.
  // Yielding wrongly costs a short wait that unsticks itself; failing to yield costs a permanent
  // fork that no mechanism reconciles. So this is deliberately more permissive than the acceptance
  // rule — it takes the structural floor, not the observer's own bar. That is a considered
  // difference from "don't trust down", not an oversight, and it is the reason it is written out.
  function _counts(rank, settings) {
    const rows = (settings && Array.isArray(settings.vouchTable)) ? settings.vouchTable
               : Ranks.defaultVouchTable();
    const tier = TrustPolicy.tierOf(rank);
    const row = rows[tier];
    const n = row && row.enough;
    return (typeof n === "number" && isFinite(n) && n >= 1);
  }

  function corroboration(parentId, held, settings) {
    // ── PROOF FIRST, THEN EVIDENCE, THEN RANK ────────────────────────────────────────────
    // A record checked against a HELD ANCHOR is proof: the fabricator would have to produce
    // content hashing to a value somebody else published first. That is not a trust question and
    // it does not need a rank — it is arithmetic, and arithmetic is not out-votable.
    //
    // Rank only carries the cases arithmetic cannot reach: an event nobody has re-supplied, or one
    // whose anchor we do not hold. There it is a proxy for "whose word would I stop on", and the
    // structural floor applies as it does everywhere else.
    //
    // Getting this order right matters more than it looks. Deciding by rank FIRST would mean a
    // provable event went unproven because the person who supplied it was junior — which inverts
    // the whole point of hashing anything.
    // MATRIX FIRST. A tombstone is the homeserver saying "this event existed here, by them, and was
    // deleted" — signed, and stronger than anything we can build on top of it. It settles the only
    // question this module asks. Note it settles it WITHOUT content: knowing an event was real is
    // enough to know I am behind, even if nobody has re-supplied what it said.
    if (typeof Vouch !== "undefined" && Vouch.tombstoneFor && Vouch.tombstoneFor(parentId)) {
      return { vouchedBy: 0, builtOnBy: 0, ignoredBelowFloor: 0,
               proven: true, via: "matrix-tombstone", corroborated: true };
    }
    const proof = _chainProof(parentId, held);
    if (proof.proven) {
      return { vouchedBy: 0, builtOnBy: 0, ignoredBelowFloor: 0,
               proven: true, via: proof.via, corroborated: true };
    }

    let vouchedBy = 0, builtOnBy = 0, ignoredBelowFloor = 0;
    const seenVouchers = Object.create(null), seenBuilders = Object.create(null);
    for (const r of (Array.isArray(held) ? held : [])) {
      const b = _body(r);
      if (!b) continue;
      const rank = (typeof r.senderRank === "number") ? r.senderRank : null;
      if (!_counts(rank, settings)) {
        // A rank whose word satisfies nobody cannot corroborate either. Counted so the refusal is
        // visible rather than looking like nothing happened.
        if ((Array.isArray(b.w) && b.w.some((rec) => rec && rec.i === parentId)) || b.p === parentId) {
          ignoredBelowFloor++;
        }
        continue;
      }
      if (Array.isArray(b.w)) {
        for (const rec of b.w) {
          if (rec && rec.i === parentId && r.sender && !seenVouchers[r.sender]) {
            seenVouchers[r.sender] = 1; vouchedBy++;
          }
        }
      }
      if (b.p === parentId && r.sender && !seenBuilders[r.sender]) {
        seenBuilders[r.sender] = 1; builtOnBy++;
      }
    }
    return { vouchedBy: vouchedBy, builtOnBy: builtOnBy, ignoredBelowFloor: ignoredBelowFloor,
             proven: false, via: null,
             corroborated: (vouchedBy > 0 || builtOnBy >= BUILDERS_NEEDED) };
  }

  // Is there arithmetic proof this parent existed? Two independent shapes:
  //
  //   MATRIX TOMBSTONE — checked before either of these, in `corroboration`. See there.
  //   RECORD MATCHES ANCHOR — somebody re-supplied content whose fingerprint equals the hash a
  //     held child already committed. Conclusive.
  //   TWO ANCHORS AGREE — two DIFFERENT authors' children commit the SAME hash for it. They would
  //     have had to agree on the exact value in advance, which means holding the event or
  //     colluding on it. Strong, though not conclusive.
  //
  // A SINGLE anchor is not proof: one author can stamp any hash they like for a parent they
  // invented, and nobody can contradict them. That is the same circularity as one builder, and it
  // is refused for the same reason.
  function _chainProof(parentId, held) {
    if (typeof Vouch === "undefined" || !Vouch.verifyAgainstChain) return { proven: false };
    for (const r of (Array.isArray(held) ? held : [])) {
      const b = _body(r);
      if (!b || !Array.isArray(b.w)) continue;
      for (const rec of b.w) {
        if (!rec || rec.i !== parentId) continue;
        if (Vouch.verifyAgainstChain(rec, held).ok) return { proven: true, via: "record-matches-anchor" };
      }
    }
    const a = Vouch.anchorsFor(parentId, held);
    if (a.agree && a.hash !== null && a.authors >= BUILDERS_NEEDED) {
      return { proven: true, via: "independent-anchors-agree" };
    }
    return { proven: false };
  }

  // ── THE COLLISION WITH THE ANTI-FREEZE CEILING ───────────────────────────────────────────
  // Found by reading rather than by running, and it changes a stated guarantee, so it is written
  // out rather than buried.
  //
  // The room has one promise that holds no matter who is present: a song cannot exceed maxLen,
  // because every client enforces it against a shared anchor with no rank, no votes and no
  // declarations. That is why the room can never freeze.
  //
  // This module tells a client to HOLD STILL. Those two things meet, and the answer is not obvious:
  //
  //   · Exempt the ceiling from the restraint? Then a short client advances from ITS head, which is
  //     precisely the branch the restraint exists to prevent. The exemption would defeat the rule.
  //   · Apply the restraint to the ceiling too? Then a short client's playback genuinely stops.
  //
  // THE SECOND IS CORRECT, and the reason is that the two failure modes are not comparable. A
  // client that stops is BEHIND — recoverable, and it converges the moment it adopts a floor. A
  // client that invents its own branch is FORKED, and no mechanism reconciles two histories that
  // each correctly refuse the other. Waiting is repairable; forking is not.
  //
  // So the guarantee is refined rather than abandoned:
  //
  //   OLD: "the room never freezes."
  //   NEW: "a client whose view is WHOLE never freezes. A client that is corroborated-short waits,
  //         and its wait is BOUNDED — after STUCK_CYCLES it is reported stuck, and re-anchor is
  //         the escape."
  //
  // Note what does NOT change: if EVERY client is short of the same parent, they all hold together,
  // all agree, and the ceiling then advances them from the same head with no fork at all. The
  // restraint only bites where clients genuinely differ, which is exactly where it should.
  //
  // ── PURE: THE RESTRAINT ──────────────────────────────────────────────────────────────────
  // May I advance? Three outcomes, and the middle one is the whole point:
  //   whole        no gaps. Advance freely.
  //   short        a CORROBORATED gap. HOLD STILL — advancing here forks the room.
  //   suspect      a gap nobody corroborates. It may be fabricated, so keep going and flag it.
  //                Yielding to an uncorroborated claim hands a griefer the room.
  // ── THE BOUND BELONGS TO THE RULE, NOT TO THE CALLER ─────────────────────────────────────
  // An event at or below an adopted floor is BANKED: a checkpoint summarised it, nobody can ever
  // need the raw event to compute state again, and this client dropped it on purpose. So a
  // reference across that boundary is history that has been ACCOUNTED FOR, not a hole
  // (trust-cascade.md §7b).
  //
  // This bound existed and lived in `check()` alone. The two callers that actually decide
  // something — the ADVANCE path and the owner's SEAL path — passed everything they held, so once
  // a client had forgotten below its floor its own held events referenced parents it had thrown
  // away. Those read as corroborated gaps, and the client stopped advancing, waiting for events
  // that were never coming back. Silent, permanent, and indistinguishable from a broken app.
  //
  // Moved here rather than fixed at the two call sites, because a rule with a copy at each caller
  // is a rule free to drift — and this defect IS the drift: one of three copies had it. Now every
  // caller inherits it and a new caller cannot forget.
  function aboveFloor(held, floorL) {
    const list = Array.isArray(held) ? held : [];
    if (typeof floorL !== "number" || floorL < 0) return list;   // -1 = NO_FLOOR: bound nothing
    return list.filter((r) => ((typeof r.l === "number") ? r.l : 0) > floorL);
  }

  // ── THE ONE PARENT A FLOOR ACCOUNTS FOR, NAMED RATHER THAN GUESSED ───────────────────────
  // A client that has forgotten below its floor holds advances whose chain parent it deliberately
  // dropped. Position cannot settle that: the floor bound can only filter events we HOLD, and an
  // event we do not hold has no position to check. Inferring one from the referencing event's
  // position would be the sort of almost-right rule this tree keeps having to delete.
  //
  // The floor names it exactly. A checkpoint's seed is the state AT THE CUT, so
  // `seed.nowPlaying.pi` is the last advance accepted at or below it — and because the chain is
  // dense, the oldest advance a trimmed client still holds chains onto precisely that one. So
  // there is exactly one banked parent, it is known by id, and anything else missing is a real gap.
  //
  // NEVER INFERRED. A caller that does not state it gets no exemption, for the same reason `owed`
  // refuses to answer without a floor: a rule that quietly supplies a default is a rule that
  // stops being asked.
  // Every call that reached the fail-open branch. Read by `check-advance-floor-bound`, which asserts
  // it is EMPTY after driving the production paths — see the branch for why a record rather than a
  // scan. Per-room like everything else here, and cleared by `reset()`.
  let _unbounded = [];
  function unboundedCalls() { return _unbounded.slice(); }
  function _resetUnboundedForTest() { _unbounded = []; }

  function mayAdvance(held, settings, floorL, bankedPi) {
    // FAIL OPEN, AND SAY SO. A caller that does not state its floor is a WIRING bug, and a wiring
    // bug must not be able to stop the music. This whole defect was expensive precisely because a
    // check that exists to save messages acquired a veto — the reducer is what decides whether an
    // advance is legal, from committed facts, and it has never been wrong here. Answering
    // "unbounded" is visible; blocking would repeat the mistake one level up.
    // (CONCEPTS.md §3.2 — never inherit a default; state which way this question fails.)
    if (floorL === undefined) {
      // ── RECORDED, BECAUSE THE ANSWER PROTECTS NOBODY (J38) ────────────────────────────────
      // Failing open is deliberate — a wiring bug must not stop the music — but it means this
      // callee cannot enforce the bound, and what kept every call site honest was a SOURCE SCAN
      // that counts arguments. Hoisting the position into a local leaves the count identical and
      // the scan green; a call through an alias is not a call site to it at all.
      //
      // So the branch records that it was taken, and `check-advance-floor-bound` drives the
      // production paths and asserts the record is EMPTY. Nothing has to be provoked: the
      // observation IS the assertion, and a caller the scanner cannot follow still lands here.
      // Same settlement as `check-advance-notify` — an executed check goes red where a textual one
      // stays green.
      //
      _unbounded.push({ at: Date.now(), held: Array.isArray(held) ? held.length : null });
      // AND IT SAYS SO AT RUNTIME. A client silently receiving the permissive answer is the case
      // this cannot otherwise be seen in; the log line names the caller's omission rather than the
      // rule. `Logger` is the ONLY use of it in this module, so a fixture that loads `continuity`
      // without it must not crash — but a bare `catch {}` would swallow a genuine logging fault in
      // production too, which is the silence this whole branch exists to end. So the fallback still
      // speaks, and the RECORD above is written first either way: it is the load-bearing half, and
      // it does not depend on anything being loaded.
      const _msg = "Continuity: mayAdvance asked WITHOUT a floor bound — answering `unbounded`, " +
                   "which protects nothing. The caller did not state its floor.";
      try {
        if (typeof Logger !== "undefined" && Logger.warn) Logger.warn(_msg);
        else if (typeof console !== "undefined" && console.warn) console.warn(_msg);
      } catch (e) {
        try { console.warn(_msg); } catch (e2) {}
      }
      return { ok: true, state: "unbounded", reason: "floorL-not-stated" };
    }
    const all = Array.isArray(held) ? held : [];
    const bounded = aboveFloor(all, floorL);
    // SCAN the bounded set; answer "do I hold it?" against EVERYTHING. See missingParents.
    const missing = missingParents(bounded, all, bankedPi);
    if (!missing.length) return { ok: true, state: "whole" };
    const corroborated = [], suspect = [];
    for (const id of missing) {
      // EVIDENCE IS NOT BOUNDED EITHER. Whether an event existed is arithmetic — a hash committed
      // at position 3 proves exactly what one committed at position 300 proves — so it is read
      // from everything held. Hiding half the cache from an arithmetic question does not make the
      // answer safer; it makes the client keep going on a gap it could have proved was real.
      (corroboration(id, all, settings).corroborated ? corroborated : suspect).push(id);
    }
    if (corroborated.length) {
      return { ok: false, state: "short", corroborated: corroborated, suspect: suspect,
               reason: "corroborated-gap" };
    }
    return { ok: true, state: "suspect", suspect: suspect,
             reason: "uncorroborated-gap-ignored" };
  }

  // ── THE PASS ─────────────────────────────────────────────────────────────────────────────
  // Re-run on room activity. Nothing is cached as "whole": a gap can appear at any moment and a
  // gap can fill at any moment, so "not whole yet" and "no longer whole" are the same question —
  // which is why there is no deletion handler here, exactly as there is none in the vouching loop.
  function check() {
    if (typeof _env.held !== "function") {
      return { ok: false, state: "unattached", reason: "no-held-source" };
    }
    // NOT WHILE CATCHING UP. A client folding a backlog is missing history BY DEFINITION — that is
    // what catching up means — so running this then reports a gap for every event that has not
    // arrived yet. It would raise phantom gaps in bursts, and worse, it would tell a client that is
    // merely behind to hold still for a reason that resolves itself in seconds. The question
    // "am I whole?" is only meaningful once the answer is supposed to be yes.
    if (typeof Session !== "undefined" && Session.mayAuthor && !Session.mayAuthor()) {
      return { ok: false, state: "not-live", reason: "catching-up" };
    }
    _cycle++;
    const all = _env.held() || [];
    // BOUNDED BY THE FLOOR, for the same reason duty is. An event at or below a floor is BANKED —
    // a checkpoint summarised it and nobody can ever need the raw event again — so a reference to
    // it is not a gap, it is history that has been accounted for. Without this bound, adopting a
    // floor and forgetting below it would make every reference across the boundary look like a
    // hole, and a client would hold still forever over events it deliberately dropped.
    const floorL = (typeof _env.floorL === "function") ? _env.floorL() : -1;
    // The parent our floor banked, from the floor's own seed. Injected like everything else here,
    // so this module still reaches for no global and an unwired copy answers "I know of none"
    // rather than inventing one.
    let bankedPi = null;
    try { if (typeof _env.bankedPi === "function") bankedPi = _env.bankedPi(); } catch (e) { bankedPi = null; }
    // The filter used to live here, which is exactly why the other two callers did not have it.
    // State the floor; the rule applies it.
    const v = mayAdvance(all, _env.settings(), floorL, bankedPi);

    const seen = Object.create(null);
    for (const id of (v.corroborated || []).concat(v.suspect || [])) {
      seen[id] = 1;
      if (!_gaps[id]) {
        _gaps[id] = { firstSeen: _cycle, cycles: 0, corroborated: (v.corroborated || []).indexOf(id) >= 0 };
        _emit({ kind: "gap-opened", id: id, corroborated: _gaps[id].corroborated });
      } else {
        _gaps[id].cycles = _cycle - _gaps[id].firstSeen;
        const nowCorr = (v.corroborated || []).indexOf(id) >= 0;
        if (nowCorr && !_gaps[id].corroborated) {
          _gaps[id].corroborated = true;
          // A gap that becomes corroborated is a state change worth acting on: it turns "keep
          // going and flag it" into "hold still". The moment somebody vouches the parent, the
          // question stops being open.
          _emit({ kind: "gap-corroborated", id: id });
        }
      }
    }
    for (const id in _gaps) {
      if (!seen[id]) { delete _gaps[id]; _emit({ kind: "gap-filled", id: id }); }
    }

    const stuck = stuckGaps();
    if (stuck.length) _emit({ kind: "stuck", ids: stuck, cycles: STUCK_CYCLES });
    return Object.assign({}, v, { stuck: stuck });
  }

  // Gaps that are corroborated (so they were real) and have not filled after enough cycles. This
  // is the defined trigger for re-anchor. Reporting only — acting on it is somebody else's job,
  // and welding the two is exactly what this codebase separates on purpose.
  function stuckGaps() {
    const out = [];
    for (const id in _gaps) {
      const g = _gaps[id];
      if (g.corroborated && g.cycles >= STUCK_CYCLES) out.push(id);
    }
    return out;
  }

  function gaps() {
    const out = {};
    for (const id in _gaps) out[id] = Object.assign({}, _gaps[id]);
    return out;
  }

  // A room change wipes everything. A gap in the room we just left must never hold back the next.
  function reset() { _gaps = Object.create(null); _cycle = 0; _unbounded = []; }

  function _setGapForTest(id, g) { _gaps[id] = g; }
  function _setCycleForTest(c) { _cycle = c; }

  return {
    STUCK_CYCLES, BUILDERS_NEEDED, attach, onChange, check, mayAdvance, missingParents, corroboration,
    stuckGaps, gaps, reset, _setGapForTest, _setCycleForTest, unboundedCalls, _resetUnboundedForTest,};
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Continuity };
