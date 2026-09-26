// backends/backend1/vouch.js
//
// VOUCH — THE ONE QUESTION: is this event safe from deletion, by MY standard, and if not, what do
// I do about it?
//
// ONE WORD. This concept shipped under two: "witness" and "vouch". They were once genuinely two
// things — witnessing kept a cheap fingerprint, vouching re-supplied the bytes on request — and
// the redesign merged them, but only half the names followed. The wire type `ddjp.witness.bundle`
// keeps the old word because renaming it would break live rooms; nothing else does. A reader
// should not have to learn that two words mean one thing.
//
// WHAT A VOUCH IS. Not a pointer — a FULL COPY of what the message said, plus a fingerprint
// proving the copy is honest. A client missing an event it holds a record for simply REBUILDS it,
// with zero messages. Nobody asks; the request/answer path does not exist. That is the whole
// reason the concept works: in Matrix anyone may delete their own message at any time, without
// permission, so the person who joined the queue can wipe that message afterwards and anyone who
// had not finished reading computes a different room.
//
// PROTECTION IS PERSONAL, NEVER GLOBAL. The owner sets, per rank, how many DIFFERENT people of
// that rank must have vouched an event before it counts. And you never accept protection from
// below your own rank: a staff member is not reassured by six guests; a guest is reassured by one
// staff member. So the same event, at the same instant, is genuinely protected for a guest and
// unprotected for a staff member, and both readings are correct. This is the thing to understand
// before anything else here.
//
// TWO EXEMPTIONS, both structural rather than configurable:
//   · An OWNER's own events need no vouching. Nobody below the top rank can delete another
//     person's message, so an owner event can only be removed by the owner — demanding coverage
//     means defending the owner against the owner. Decided by CHANNEL ORIGIN, not by counting.
//     (It was once done by synthesising a fake voucher entry, which gave two different answers in
//     two places depending on what the caller passed.)
//   · You never vouch YOURSELF. Your copy dies with your own deletion, which is exactly the
//     deletion a vouch exists to survive.
//
// WHAT THIS MODULE FIXES. The old tree's duty scan was never bounded by the floor. The design
// says you protect only what sits ABOVE your floor — that bound is what keeps the work constant
// instead of growing with the age of the room — but the floor was never passed in, so clients
// kept protecting events a checkpoint had already banked. Here the bound is a required argument
// (see `owed`), so it cannot be forgotten by omission.
//
// Depends on: ConsensusHash, TrustPolicy, Ranks, PlaylistDoc (canonical URL), Scheduler (turns).

const Vouch = (() => {

  // ── WHAT IS WORTH PROTECTING ─────────────────────────────────────────────────────────────
  // An EXCLUSION list, deliberately: absence means CRITICAL, so a new event type is protected by
  // default. That is the safe direction — the alternative silently leaves new consensus events
  // unprotected until somebody remembers to add them.
  //
  //   vote / save / count.set   display-level; a lost vote makes a count a stable lower bound
  //   media.len                 the DISPLAY countdown length, emitted per song by
  //                             features/medialength. Reducer-inert — check-media-length PART E
  //                             proves derive(log) is unchanged by it — so it is display-level by
  //                             the only test that matters: losing one changes no decision.
  //
  //                             IT WAS BRIEFLY REMOVED FROM THIS LIST, and the damage is worth
  //                             recording because it was silent in both directions. Removal made
  //                             the type CRITICAL, so protection was spent vouching a display
  //                             event — and _countable began counting it toward the checkpoint
  //                             cadence, which is the exact self-amplifying mistake the note in
  //                             maySeal describes for bundles: frequent traffic that changes
  //                             nothing convincing the room it has fallen behind. It happened
  //                             because a sibling comment said its RETIRED partner was "no longer
  //                             emitted", and both were dropped on the strength of it.
  //                             ddjp.media.blocked really is gone — nothing sends one — and is
  //                             deliberately absent here.
  //   NOTE ddjp.play.len / ddjp.play.blocked are deliberately ABSENT from this list, i.e.
  //                             critical: they drive the advance gate, so losing one is a
  //                             divergence rather than a cosmetic glitch. The near-identical names
  //                             are the trap: media.len is a countdown, play.len is consensus.
  //   witness.bundle            a bundle has no action payload; vouching one regenerates nothing
  //   checkpoint                already self-proving, and its seed dwarfs the per-message budget
  const NON_CRITICAL_TYPES = [
    "ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.media.len",
    "ddjp.witness.bundle", "ddjp.checkpoint",
    // J18 — a settings REQUEST. Non-critical because it is not room truth in any sense: the
    // reducer has never heard of the type, so it changes no derived state and (driven) moves
    // neither the checkpoint seed nor the fingerprint. Vouching it would spend real witness work
    // protecting an event whose entire effect is to ask a question, and counting it toward the
    // seal cadence would let a person hurry the room's checkpoints by making requests — a cheap
    // way to move a cadence that is supposed to track ROOM ACTIVITY. The settings write it may
    // cause is `ddjp.room.settings`, which is critical and is unaffected by this row.
    "ddjp.bot.request",
    // J19 — a reputation SNAPSHOT. Non-critical, and the reasoning is the shape of the whole job:
    // the number is an ASSERTION nobody can check, so spending witness work to protect it would
    // make it look protected — which is the same category error that closed shape (b), arriving
    // through the vouch layer instead of through the fingerprint. Counting snapshots toward the
    // seal cadence would also let a bot hurry the room's checkpoints by publishing more often, and
    // the cadence is supposed to track ROOM ACTIVITY rather than the bot's own housekeeping.
    "ddjp.rep.snapshot",
  ];

  // The wire type. Unchanged on purpose — see the naming note above.
  const BUNDLE_TYPE = "ddjp.witness.bundle";

  // Keys the emitter stamps that are NOT the event's action. `pHash`, `w` and `og` are the
  // witnessing that rides alongside; excluding them is what dissolves the circularity of hashing
  // a body that contains hashes. `l` is position and lives in the record's own field.
  const ENVELOPE_KEYS = ["l", "dv", "hv", "pHash", "w", "og"];

  const RECORD_DEFAULT_RANK = 20;   // player — matches the reducer's default for an unstamped event

  function _has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function _body(raw) {
    try {
      if (!raw || !raw.content || typeof raw.content.body !== "string") return null;
      const b = JSON.parse(raw.content.body);
      return (b && typeof b === "object") ? b : null;
    } catch (e) { return null; }
  }

  // ── PURE: the action payload — type plus state-changing content, nothing else ────────────
  function actionPayload(body) {
    const out = {};
    if (!body || typeof body !== "object") return out;
    for (const k in body) {
      if (!_has(body, k)) continue;
      if (ENVELOPE_KEYS.indexOf(k) >= 0) continue;
      out[k] = body[k];
    }
    return out;
  }

  // ── PURE: the fingerprint — over the ACTION only ─────────────────────────────────────────
  // Invariant to whatever witnessing and position the event happened to carry, so a regenerated
  // action verifies without having to reproduce incidental bytes. Binds type and content.
  // POSITION IS INCLUDED, and it was not. The fingerprint was described as "invariant to the
  // position the event carried", which sounds like a virtue and is a hole: a record carries `l` as
  // a separate field, so a genuine record could be re-supplied with a FORGED position and still
  // verify — reordering the event in everyone's fold. Nothing else can catch it either: `l` lives
  // in the DDJP body, which redaction strips, so not even the Matrix tombstone knows where an
  // event sat.
  //
  // Position invariance was never wanted. An event has ONE position, and reconstructing it "to the
  // byte, as far as timeline computation is concerned" means reconstructing WHERE it sat as much as
  // what it said.
  function _committed(body) {
    const a = actionPayload(body);
    if (body && typeof body.l === "number") a.l = body.l;
    return a;
  }
  function fingerprint(body) { return ConsensusHash.contentHash(_committed(body)); }

  // ── PURE: compact / rebuild, exact inverses BY CONSTRUCTION ──────────────────────────────
  // A field is dropped ONLY when it can be regenerated byte-for-byte, so rebuild(compact(x)) === x
  // for any payload, canonical or not. Today the one provably derivable field is `u` on a
  // join/declare, which after URL canonicalisation equals watchUrl(v).
  function _uDerivable(a) {
    if (typeof PlaylistDoc === "undefined" || !PlaylistDoc.watchUrl) return false;   // degrade, never throw
    return typeof a.v === "string" && typeof a.u === "string" && a.u === PlaylistDoc.watchUrl(a.v);
  }
  function compact(body) {
    const a = actionPayload(body);
    if (_uDerivable(a)) {
      const d = {};
      for (const k in a) if (_has(a, k) && k !== "u") d[k] = a[k];
      d.cu = 1;                     // "canonical url dropped — regenerate u = watchUrl(v)"
      return d;
    }
    return a;
  }
  function rebuild(delta) {
    const a = {};
    if (!delta || typeof delta !== "object") return a;
    if (delta.cu === 1 && typeof delta.v === "string") {
      for (const k in delta) if (_has(delta, k) && k !== "cu") a[k] = delta[k];
      a.u = PlaylistDoc.watchUrl(a.v);
      return a;
    }
    for (const k in delta) if (_has(delta, k)) a[k] = delta[k];
    return a;
  }

  // ── PURE: the record — { i, l, d, h, r } ─────────────────────────────────────────────────
  //   i  the stable id            \ the NAME: content-independent, survives deletion, fixes position
  //   l  the order counter        /
  //   d  the compact delta        ] the PAYLOAD — regenerate, don't merely point
  //   h  the fingerprint          ] the PROOF
  //   r  our observed channel rank] for later corroboration
  //
  // TOTAL. One throw in here used to take down the ENTIRE bundle — both the free ride-along and
  // the paid standalone — silently, for as long as the event was held. A record we cannot build is
  // a record we skip; it is never worth the batch.
  function record(raw) {
    const b = _body(raw);
    if (!b || !raw || !raw.event_id) return null;
    const l = (typeof raw.l === "number") ? raw.l : (typeof b.l === "number" ? b.l : 0);
    const r = (typeof raw.senderRank === "number" && isFinite(raw.senderRank))
      ? Math.floor(raw.senderRank) : RECORD_DEFAULT_RANK;
    try { return { i: raw.event_id, l: l, d: compact(b), h: fingerprint(b), r: r }; }
    catch (e) { return null; }
  }

  // ── TWO GATES, AND ONLY THE SECOND IS PROOF ──────────────────────────────────────────────
  //
  // This distinction is the whole point of vouching and it is easy to get backwards.
  //
  //   SELF-CONSISTENT (verifyRecord)  the record's delta hashes to the record's own fingerprint.
  //                                   Says the record is well-formed. Says NOTHING about whether
  //                                   the event it names ever existed — anyone can invent content,
  //                                   hash it, and publish a valid record for any id at all.
  //
  //   CHAIN-ANCHORED (verifyAgainstChain)  the record's fingerprint equals the hash a HELD CHILD
  //                                   already committed for that parent. THIS is proof. To forge
  //                                   it you would have to produce content hashing to a value
  //                                   somebody else published before you.
  //
  // A vouch exists so a deleted OR EDITED event can be reconstructed to the byte, as far as
  // timeline computation is concerned, and CHECKED — not so that anyone can assert an event into
  // being. The check is the anchor. Without it a record is a claim; with it a record is evidence.
  //
  // ── WHY THE CHAIN MUST COMMIT THE *ACTION* HASH ──────────────────────────────────────────
  // The two hashes have to be the same value or none of this connects, and they were not:
  //
  //     the chain committed   contentHash(FULL body)     — including l, dv, hv, pHash, w, og
  //     a record proves       contentHash(ACTION only)
  //
  // The action hash is the correct one, for two independent reasons:
  //
  //   1. A record CAN ONLY reconstruct the action. The envelope is position and incidental
  //      witnessing — a rebuild does not carry `w` or `og` back — so a full-body commitment is
  //      unverifiable from a record by construction.
  //   2. Hashing the full body is CIRCULAR: the body contains `w` records, and those contain
  //      hashes. Hashing action-only is what dissolves that, which is why the record layer already
  //      does it.
  //
  // So `commitFor` below is what a chained event must stamp as its `pHash`, and it is deliberately
  // the same function a record proves. The old tree hashed the full body and recorded the
  // divergence as "a later increment"; this is that increment. It is a WIRE CHANGE — old events
  // carry the old commitment and cannot be anchor-verified, which is why the resolver below treats
  // an unresolvable anchor as "cannot tell" rather than as a failure.
  function verifyRecord(rec) {
    if (!rec || typeof rec.h !== "string") return false;
    const body = rebuild(rec.d);
    if (typeof rec.l === "number") body.l = rec.l;   // position is committed; check it too
    return ConsensusHash.verify(body, rec.h);
  }

  // What a chained event stamps for its parent. Identical to `fingerprint` on purpose — one
  // function, so the emitter and the verifier can never drift.
  function commitFor(parentBody) {
    if (parentBody === null || parentBody === undefined) return null;   // genesis
    return fingerprint(parentBody);
  }

  // ── THE ANCHOR RESOLVER ──────────────────────────────────────────────────────────────────
  // What hash SHOULD a missing event have, according to the children I already hold?
  //
  // UNANIMITY OR NOTHING. If every held child that names this parent commits the same hash, that
  // is the answer. If any two DISAGREE, return null — a back-dated forgery committing a different
  // hash makes the answer ambiguous, and guessing between them could inject false content. A forger
  // can therefore DENY recovery this way but never poison it, which is the correct direction to
  // fail: losing an event is recoverable, accepting a fabricated one is not.
  //
  // Null also means "no child names it", which is simply "I cannot tell yet".
  function expectedHashFor(eventId, heldRaws) {
    let hash = null, conflict = false;
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      const b = _body(r);
      if (!b || b.p !== eventId || typeof b.pHash !== "string") continue;
      if (hash === null) hash = b.pHash;
      else if (b.pHash !== hash) conflict = true;
    }
    return conflict ? null : hash;
  }

  // Who committed a hash for this parent, and were they distinct people? Two independent authors
  // committing the SAME hash is materially harder to fabricate than one, because they would have
  // to agree on the exact value in advance.
  function anchorsFor(eventId, heldRaws) {
    const seen = Object.create(null);
    let authors = 0, agree = true, hash = null;
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      const b = _body(r);
      if (!b || b.p !== eventId || typeof b.pHash !== "string") continue;
      if (hash === null) hash = b.pHash; else if (b.pHash !== hash) agree = false;
      if (r.sender && !seen[r.sender]) { seen[r.sender] = 1; authors++; }
    }
    return { hash: agree ? hash : null, authors: authors, agree: agree };
  }

  // ── THE REAL GATE: is this record the event it claims to be? ─────────────────────────────
  // Self-consistent AND matching what a held child committed. Returns a NAMED verdict rather than
  // a boolean, because "I cannot check" and "it does not match" are different answers and
  // collapsing them is how a missing anchor comes to read as a forgery.
  function verifyAgainstChain(rec, heldRaws) {
    if (!rec || typeof rec.i !== "string") return { ok: false, why: "malformed" };
    if (!verifyRecord(rec)) return { ok: false, why: "self-inconsistent" };
    const expected = expectedHashFor(rec.i, heldRaws);
    if (expected === null) return { ok: false, why: "no-anchor" };      // cannot tell, not a failure
    if (expected !== rec.h) return { ok: false, why: "hash-mismatch" }; // a forgery, or the wrong event
    return { ok: true, why: "chain-anchored" };
  }

  // A re-supplied FULL body for a gap, checked the same way. Used when someone hands back the
  // original rather than a compact record.
  function acceptOriginal(eventId, candidateBody, heldRaws) {
    const expected = expectedHashFor(eventId, heldRaws);
    if (expected === null) return false;
    // _committed, not actionPayload — the commitment covers the position too, and a re-supplied
    // full body must be checked against the same thing a record is.
    return ConsensusHash.verify(_committed(candidateBody), expected);
  }

  // ── PURE: may this held event be protected at all? ───────────────────────────────────────
  // Asked identically by bundle building, target selection and the seal gate, so those three can
  // never disagree about what counts.
  //
  // NO SENDER, NOT ELIGIBLE. A rebuilt event restores content, position and the WITNESS's observed
  // rank — deliberately not authorship, because a record commits the sender without letting you
  // open the commitment. So the not-mine test below could not fire on a rebuild, and a client
  // could select its OWN redacted-and-rebuilt event as a target and then count its own vouch
  // toward the bar. A rebuild is RESTORE MATERIAL and was never a target.
  function eligible(raw, selfSender, isLegal) {
    if (!raw || !raw.event_id) return false;
    if (!raw.sender) return false;
    if (selfSender && raw.sender === selfSender) return false;     // never vouch yourself
    const b = _body(raw);
    if (!b) return false;
    if (NON_CRITICAL_TYPES.indexOf(b.t) >= 0) return false;        // display-level
    if (Ranks.atLeast(raw.senderRank, "owner")) return false;      // owner exempt, by channel origin
    if (typeof isLegal === "function" && !isLegal(raw.event_id)) return false;
    return true;
  }

  // ══ THE TOMBSTONE — what MATRIX still tells us about a deleted event ═══════════════════════
  //
  // A redaction does not remove an event. It strips its CONTENT and leaves a tombstone: the event
  // id, the sender, the timestamp and the ROOM ID all survive, homeserver-signed. The room id IS
  // the channel, and the channel IS the rank — so the rank of a deleted event is readable directly
  // from what remains, by exactly the rule every live event's rank is read by.
  //
  // THIS IS THE MISSING HALF OF RECONSTRUCTION, and without it the mechanism was lame:
  //
  //     content   <- the vouch record    hash-checked against a held anchor
  //     position  <- the vouch record    committed by that same hash (see above)
  //     sender    <- THE TOMBSTONE       homeserver-signed
  //     rank      <- THE TOMBSTONE room  channel origin, asserted by no witness
  //
  // Neither source alone suffices, which is why "a rebuilt event has no author, so the reducer
  // refuses it" was true of the IMPLEMENTATION rather than of the design. A record cannot carry
  // identity — it commits the sender without letting you open the commitment, and a claimed
  // `sender` field would be asserted identity, which this system refuses everywhere. It does not
  // need to. Matrix kept it.
  //
  // MATRIX FIRST, THEN OUR CHAIN. The homeserver's signature is stronger than anything built on
  // top of it, so existence and identity come from Matrix and only CONTENT comes from our chain —
  // and only when the chain is unambiguous. Our own proof never has to stand alone.
  //
  // THE IRREDUCIBLE CASE, now the only one: a server-side PURGE leaves no tombstone at all, so
  // identity is genuinely unrecoverable and a rebuild stays restore-material. That boundary is the
  // one the design always named. Everything inside it is now recoverable.
  const _tombs = Object.create(null);   // eventId -> { id, sender, rank, roomId, ts }

  // Called by transport when it sees a redacted spine event. `rank` is the CHANNEL rank, resolved
  // by the same function live events use — this module never maps rooms to ranks itself.
  function rememberTombstone(t) {
    if (!t || typeof t.id !== "string" || !t.id) return false;
    if (!t.sender) return false;                       // no identity -> nothing worth keeping
    _tombs[t.id] = { id: t.id, sender: t.sender,
                     rank: (typeof t.rank === "number") ? t.rank : null,
                     roomId: t.roomId || null,
                     ts: (typeof t.ts === "number") ? t.ts : 0 };
    return true;
  }
  function tombstoneFor(id) { return _tombs[id] || null; }
  function forgetTombstones() { for (const k in _tombs) delete _tombs[k]; }

  // ── RECONSTRUCT: tombstone + record -> a real, FOLDABLE event ────────────────────────────
  // Not restore material — every field the reducer needs now has a source that is not a witness's
  // word. A NAMED refusal otherwise, because the three failures are different questions:
  //   no-tombstone  Matrix does not know it existed (purged, or never seen). Cannot attribute.
  //   no-record     we know who and where, but not what. The chain cuts, honestly.
  //   (unproven)    a record exists but does not match a held anchor -> not returned at all.
  function reconstruct(id, heldRaws) {
    const tomb = _tombs[id];
    if (!tomb) return { ok: false, why: "no-tombstone" };
    if (tomb.rank === null) return { ok: false, why: "no-rank" };
    let best = null;
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      const b = _body(r);
      if (!b || !Array.isArray(b.w)) continue;
      for (const rec of b.w) {
        if (!rec || rec.i !== id) continue;
        if (verifyAgainstChain(rec, heldRaws).ok) { best = rec; break; }
      }
      if (best) break;
    }
    if (!best) return { ok: false, why: "no-record" };
    // ── THE RECORD'S OWN `l` IS THE POSITION, AND THE DELTA MUST NOT CARRY ONE ──────────────
    // This composition puts `action` SECOND, so anything the delta carries wins over `best.l`.
    // That is correct only while the delta cannot carry a position — which is what stripping
    // `ENVELOPE_KEYS` upstream guarantees, `l` being its first member.
    //
    // If a position ever reaches the delta, the guarantee inverts and the module's own header
    // stops being true: `verifyRecord` forces `body.l = rec.l` before hashing, so a record whose
    // DELTA names one position and whose `l` names another still hashes to the honest value. It
    // passes self-consistency, it passes `verifyAgainstChain` with `chain-anchored` — the
    // strongest verdict here — and then rebuilds the event at the delta's position. Measured
    // (F2, from the J39 sweep): with the strip's `>= 0` flipped to `> 0`, an honest 42 rebuilt at
    // a forged 9999 while every fingerprint stayed byte-identical and the whole suite stayed
    // green. Position invariance was never wanted; an event has ONE position.
    //
    // Held by `check-membership-index0` PART C, which drives this line rather than reading it.
    // Do not "simplify" by trusting the delta, and do not reorder the assign.
    const action = rebuild(best.d);
    const body = (typeof best.l === "number") ? Object.assign({ l: best.l }, action) : action;
    return { ok: true, event: {
      event_id: id, type: "m.room.message",
      sender: tomb.sender,                 // FROM MATRIX, signed
      senderRank: tomb.rank,               // FROM MATRIX, channel origin
      room_id: tomb.roomId, ts: tomb.ts,
      l: (typeof best.l === "number") ? best.l : 0,
      content: { body: JSON.stringify(body) },
      _reconstructed: true,
    } };
  }

  // ── PURE: coverage read off the wire ─────────────────────────────────────────────────────
  // { eventId: [{ u, r }] } from the bundles carried by held events. The voucher's rank is its
  // trustworthy CHANNEL-ORIGIN rank; the self-declared `og.rk` is a fallback only. Each voucher
  // counts ONCE per id, so repeated bundles from one person cannot inflate coverage.
  function coverage(heldRaws) {
    const cov = Object.create(null);
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      const b = _body(r);
      if (!b || !Array.isArray(b.w)) continue;
      const who = (r && r.sender) ? r.sender : ((b.og && b.og.ch) || "?");
      const rank = (r && typeof r.senderRank === "number") ? r.senderRank
                 : ((b.og && typeof b.og.rk === "number") ? b.og.rk : 0);
      for (const rec of b.w) {
        if (!rec || typeof rec.i !== "string") continue;
        (cov[rec.i] || (cov[rec.i] = Object.create(null)))[who] = rank;
      }
    }
    const out = Object.create(null);
    for (const id in cov) out[id] = Object.keys(cov[id]).map((u) => ({ u: u, r: cov[id][u] }));
    return out;
  }

  // ── PURE: is this protected AT MY BAR? ───────────────────────────────────────────────────
  // Delegated, never restated. One comparison answers four questions — what do I vouch, what do I
  // keep, is this deletion urgent, may I seal — and a second copy of it is exactly how the seal
  // gate and the vouching path once came to disagree.
  function protectedForMe(vouchers, author, settings, myRank) {
    return TrustPolicy.protectedFor(vouchers, author, settings, myRank);
  }

  // ── PURE: the deficit band, judged from where I STAND ────────────────────────────────────
  //   0  nothing has protected it at all
  //   1  protected only by ranks BELOW mine — safer than nothing, discharges me of nothing
  //   2  protected at my rank or above, but not yet to my bar
  //   null  satisfied at my tier or better -> it leaves my list
  //
  // Ordering by raw voucher COUNT cannot see rank, so an event covered by three uncategorized
  // clients looked safer than one covered by a single staff member. The bands read rank.
  function bandOf(vouchers, author, myRank, settings) {
    const myTier = TrustPolicy.tierOf(myRank);
    const sat = TrustPolicy.satisfiedTier(vouchers, author, settings);
    if (sat !== null && sat <= myTier) return null;
    const list = Array.isArray(vouchers) ? vouchers : [];
    if (!list.length) return 0;
    const seen = Object.create(null);
    let atOrAbove = 0;
    for (const v of list) {
      if (!v || !v.u || seen[v.u]) continue;
      seen[v.u] = 1;
      if (TrustPolicy.tierOf(v.r) <= myTier) atOrAbove++;
    }
    return atOrAbove === 0 ? 1 : 2;
  }

  // Fisher-Yates with an injectable rng. Randomness is the RIGHT mechanism between peers: they are
  // equal by definition, so there is nothing to derive an order from, and any deterministic
  // tiebreak would make the same client do all the work forever.
  function _shuffle(arr, rng) {
    const r = (typeof rng === "function") ? rng : Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const k = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[k]; a[k] = t;
    }
    return a;
  }

  // THE HEAD — how many of the newest critical events are covered without waiting a turn. Small on
  // purpose: this is the vulnerable window, not a licence to abandon the ladder. Wide enough that a
  // delete-and-run has no quiet moment to work in; narrow enough that the tail still pays for
  // itself.
  const HEAD_EVENTS = 3;
  function _headBoundary(positions) {
    if (!positions.length) return -Infinity;           // nothing held: everything is head
    const sorted = positions.slice().sort((a, z) => a - z);
    const idx = Math.max(0, sorted.length - HEAD_EVENTS);
    return sorted[idx];
  }

  // Past this many owed events I am LATE — I joined with a backlog — and I stop waiting my turn
  // and work on whatever is unprotected. A safety valve on the ladder, not room policy: without
  // it a client that joined far behind sits stuck behind an absent senior forever.
  const BACKLOG_TRIGGER = 100;

  // ── WHAT DO I OWE RIGHT NOW? ─────────────────────────────────────────────────────────────
  // Recomputed FRESH every pass and never cached. Coverage can go DOWN — a vouch is itself a
  // message and can be deleted — so "not covered yet" and "no longer covered" are the same
  // question, and there is no deletion handler anywhere. That is the design, not an omission.
  //
  // BOUNDED BY THE FLOOR, and it is a REQUIRED argument. Below the floor there is nothing to
  // protect: a checkpoint has banked it and nobody can ever need the raw event to compute state
  // again. This bound is what keeps the work constant rather than growing with the room's age, and
  // in the old tree it was simply never passed — the parameter did not exist, so the rule was
  // stated in the docs and enforced nowhere. Passing `null` means "no floor yet", which is honest;
  // omitting it is now impossible.
  function owed(heldRaws, opts) {
    // REFUSE, DO NOT THROW. The old signature was positional — (held, myRank, userId, settings,
    // isLegal) — and a caller that has not been updated passes a NUMBER here. Throwing on that
    // takes down whatever was building a bundle; answering "I cannot" with a named reason lets it
    // degrade, which is the same discipline every other refusal in this module follows.
    if (opts === null || typeof opts !== "object") {
      return { error: "opts-object-required", targets: [], owedTotal: 0 };
    }
    const o = opts;
    const myRank = o.myRank, myUserId = o.myUserId, settings = o.settings || {};
    const isLegal = o.isLegal, rng = o.rng;
    if (!("floorL" in o)) return { error: "floorL-required", targets: [] };
    const floorL = (typeof o.floorL === "number") ? o.floorL : null;

    const cov = coverage(heldRaws);
    const seen = Object.create(null);
    const bands = [[], [], []];
    let bankedSkipped = 0;

    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      if (!r || !r.event_id || seen[r.event_id]) continue;
      const l = (typeof r.l === "number") ? r.l : 0;
      // THE FLOOR BOUND.
      if (floorL !== null && l <= floorL) { bankedSkipped++; continue; }
      if (!eligible(r, myUserId, isLegal)) continue;
      seen[r.event_id] = 1;
      const vouchers = cov[r.event_id] || [];
      // ALREADY VOUCHED — AT MY CURRENT RANK OR BETTER. The rank qualifier is the whole point and
      // it was missing: this used to skip anything I had vouched BY IDENTITY, whatever rank I held
      // when I wrote it.
      //
      // Rank across a promotion is two questions with two different correct answers:
      //   "is it mine?"              -> YES, permanently. Identity is rank-blind, which is why a
      //                                 vouch I wrote as staff still counts toward MY OWN floor
      //                                 after promotion (see Checkpoint's self-witness).
      //   "what rank does it count as?" -> the rank of the channel it was WRITTEN on, permanently.
      //
      // So a staff-era vouch of mine does nothing for the high-staff bar, and duty correctly says I
      // owe the event again. Skipping by identity meant I never re-vouched, and my new tier's bar
      // could never be met by me for anything I had covered before — silently, with the duty check
      // one line below cheerfully agreeing that I owed it.
      //
      // The consequence is deliberate: A PROMOTION CREATES REAL WORK. Every event covered at the
      // old rank is owed again. It is ladder-ordered and never urgent (see the age split below).
      const myTierNow = TrustPolicy.tierOf(myRank);
      if (myUserId && vouchers.some((v) => v && v.u === myUserId && TrustPolicy.tierOf(v.r) <= myTierNow)) continue;
      const author = { u: r.sender || null, r: (typeof r.senderRank === "number") ? r.senderRank : null };
      if (!TrustPolicy.owesVouch(myRank, myUserId, author, vouchers, settings)) continue;
      const b = bandOf(vouchers, author, myRank, settings);
      if (b === null) continue;
      bands[b].push({ id: r.event_id, l: l, band: b });
    }

    // ── AGGRESSION BY AGE, NOT BY RANK ───────────────────────────────────────────────────
    // The turn ladder is what keeps protection cheap: my rank decides how many critical events must
    // pass before something is mine to cover, so seniors go first and juniors stand down on seeing
    // it done. Measured in EVENTS rather than seconds, so every client derives the same number from
    // the same log with no clock involved.
    //
    // But the ladder has a hole exactly where the danger is. Waiting N events before something is
    // yours means THE NEWEST EVENT IS THE LAST ONE COVERED — and the newest event is precisely the
    // window a delete-and-run attack lives in. The most vulnerable bytes were the least protected.
    //
    // So the split is by AGE:
    //   THE HEAD — the newest few critical events — takes NO turn wait. Anyone who can, covers it
    //              at once, riding along free on their next message. The cost of dropping the
    //              ladder here is zero, because a ride-along is free and the head is small.
    //   THE TAIL — everything older — stays ladder-ordered. Backfill is not urgent, and the ladder
    //              is what stops the room paying for it many times over.
    //
    // Promotion re-vouching (above) is tail work by construction: those events are old.
    const total = bands[0].length + bands[1].length + bands[2].length;
    const late = total >= BACKLOG_TRIGGER;      // joined far behind: stop waiting, just work
    const myTurns = TrustPolicy.tierOf(myRank);
    const positions = _criticalPositions(heldRaws, floorL);
    const headFloor = _headBoundary(positions);

    let targets = [];
    for (const band of bands) {
      const ready = band.filter((e) => {
        if (late) return true;                         // the backlog valve
        if (e.l >= headFloor) return true;             // THE HEAD — no turn wait
        return Scheduler.turnsPassed(positions, e.l) >= myTurns;
      });
      targets = targets.concat(_shuffle(ready.map((e) => e.id), rng));
    }
    return { targets: targets, owedTotal: total, late: late, bankedSkipped: bankedSkipped,
             headFloor: headFloor, bands: bands.map((b) => b.length) };
  }

  // Which positions count as a "turn". Critical events only — a flood of votes must not advance
  // everyone's turn — and above the floor, for the same reason duty is.
  function _criticalPositions(heldRaws, floorL) {
    const out = [];
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      if (!r || typeof r.l !== "number") continue;
      if (floorL !== null && r.l <= floorL) continue;
      const b = _body(r);
      if (!b || NON_CRITICAL_TYPES.indexOf(b.t) >= 0) continue;
      out.push(r.l);
    }
    return out;
  }

  // ── BUILD A BUNDLE for chosen ids, in the given order ────────────────────────────────────
  function bundleFor(heldRaws, ids, cap) {
    const n = (typeof cap === "number" && isFinite(cap) && cap > 0) ? Math.floor(cap) : 0;
    if (n <= 0 || !Array.isArray(ids) || !ids.length) return [];
    const byId = Object.create(null);
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      if (r && r.event_id && !byId[r.event_id]) byId[r.event_id] = r;
    }
    const out = [];
    for (const id of ids) {
      if (out.length >= n) break;
      const rec = byId[id] ? record(byId[id]) : null;
      if (rec) out.push(rec);
    }
    return out;
  }

  // ── WHICH OF MY OUTGOING EVENTS CARRY A BUNDLE ───────────────────────────────────────────
  // Every critical event carries. The set that needs protecting and the set that can carry it are
  // the SAME set, so this is the complement of NON_CRITICAL_TYPES rather than a second list that
  // could drift from it. It was once the play/skip chain only — two of thirteen critical types —
  // so a room where people were queueing but nothing was playing produced no free carriers at all
  // and everything fell to paid standalone messages.
  function carries(type) {
    if (typeof type !== "string" || type.indexOf("ddjp.") !== 0) return false;
    return NON_CRITICAL_TYPES.indexOf(type) < 0;
  }

  // ── FREE RIDE VERSUS PAID MESSAGE ────────────────────────────────────────────────────────
  // A standalone bundle is a PAID message; riding along on something you were sending anyway is
  // free. So the paid path fires only when the free one is unavailable or too slow:
  //   BACKLOG — I owe a lot and have sent no carrier of my own in a while
  //   HOLE    — a deletion was DETECTED. History actively at risk; skips the ladder entirely.
  // Routine under-coverage rides along and costs nothing. Pure, so the policy is assertable.
  const STANDALONE_BACKLOG = 20;
  const CARRIER_QUIET_MS = 30000;
  function needsStandalone(owedTotal, msSinceMyLastCarrier, holeDetected) {
    if (holeDetected) return true;
    return (owedTotal >= STANDALONE_BACKLOG) && (msSinceMyLastCarrier > CARRIER_QUIET_MS);
  }

  // ── SILENT SELF-REPAIR — nobody asks ─────────────────────────────────────────────────────
  // Rebuild events we are missing from records we ALREADY hold. Zero messages: no request, no
  // answer, no round trip. Self-verifying against `h`, so a tampered record is dropped rather than
  // believed.
  function repairFrom(heldRaws) {
    const have = new Set();
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) if (r && r.event_id) have.add(r.event_id);
    const out = [], seen = Object.create(null), anchored = Object.create(null);
    for (const r of (Array.isArray(heldRaws) ? heldRaws : [])) {
      const b = _body(r);
      if (!b || !Array.isArray(b.w)) continue;
      const carrierL = (typeof r.l === "number") ? r.l : (typeof b.l === "number" ? b.l : null);
      for (const rec of b.w) {
        if (!rec || typeof rec.i !== "string") continue;
        if (have.has(rec.i) || seen[rec.i]) continue;
        // THE GATE, in its honest order. A chain-anchored record is EVIDENCE and is rebuilt. A
        // record with no anchor is only a CLAIM — rebuilt still, because the rebuild is restore
        // material and never enters the fold (it has no sender, so the reducer refuses it), and
        // holding content we cannot yet verify costs nothing while an anchor may still arrive.
        // What is never rebuilt is a record that CONTRADICTS an anchor we hold: that is a forgery
        // or the wrong event, and the difference between "cannot check" and "checked and wrong" is
        // exactly the distinction this gate exists to preserve.
        const v = verifyAgainstChain(rec, heldRaws);
        if (!v.ok && v.why !== "no-anchor") continue;
        anchored[rec.i] = (v.why === "chain-anchored");
        // YOU CANNOT WITNESS THE FUTURE. A vouch is for something its author had already seen, so
        // a record must sit at or before its carrier's position. This rejects records belonging to
        // a DIFFERENT room's timeline, which would otherwise be rebuilt and stored under THIS
        // room's id — laundering foreign history past every later scope check.
        if (typeof rec.l === "number" && typeof carrierL === "number" && rec.l > carrierL) continue;
        const action = rebuild(rec.d);
        if (!action) continue;
        const body = (typeof rec.l === "number") ? Object.assign({ l: rec.l }, action) : action;
        seen[rec.i] = 1;
        out.push({
          event_id: rec.i,
          room_id: r.room_id || null,
          l: (typeof rec.l === "number") ? rec.l : undefined,
          senderRank: (typeof rec.r === "number") ? rec.r : 0,   // the WITNESS's observed rank
          content: { body: JSON.stringify(body) },
          _repaired: true,
          _anchored: !!anchored[rec.i],   // was this PROVEN, or merely held pending an anchor?
        });
      }
    }
    return out;
  }

  // ── MAY I DROP MY COPY? ──────────────────────────────────────────────────────────────────
  // Two arms, and they are the two the room actually has:
  //   BANKED  — at or below a floor. A checkpoint summarised it; nobody can need the raw again.
  //   COVERED — protected AT MY OWN BAR.
  //
  // NOT `!owesVouch(...)`, which is what the wording literally suggests. You never owe your OWN
  // event a vouch, so inverting duty reports your own events as discharged the instant you publish
  // them — and those are exactly the events you are the last holder of. Retention shares the
  // COMPARISON inside duty; the never-vouch-yourself clause belongs to duty alone.
  // ── WIRED: EventCache's eviction pass asks this per copy ─────────────────────────────────
  // The per-copy retention rule — "may I drop my copy of this?" — read by the byte-bounded raw
  // cache. It was written before that call site existed and carried a "not wired" note; the note
  // outlived the fact, which is its own small version of the bug it was warning about.
  function mayRetire(eventL, vouchers, author, floorL, settings, myRank) {
    if (typeof floorL === "number" && typeof eventL === "number" && eventL <= floorL) return true;
    return protectedForMe(vouchers, author, settings, myRank);
  }

  // `forgetable(...)` stood here: mayRetire applied over everything below a personal seal.
  // Deleted in J05. `EventCache._plan` asks `mayRetire` per item, which is the same question one
  // item at a time — so this was two functions for one rule (P7), and the batch form had no
  // production caller. The per-item form is the one the eviction path actually walks, and it is
  // the one that can report WHICH tier it stopped in, which a batch answer cannot.

  return {
    NON_CRITICAL_TYPES: NON_CRITICAL_TYPES.slice(), BUNDLE_TYPE, ENVELOPE_KEYS: ENVELOPE_KEYS.slice(),
    BACKLOG_TRIGGER, STANDALONE_BACKLOG, CARRIER_QUIET_MS, HEAD_EVENTS,
    _headBoundary,
    actionPayload, fingerprint, compact, rebuild, record, verifyRecord,
    commitFor, expectedHashFor, anchorsFor, verifyAgainstChain, acceptOriginal,
    rememberTombstone, tombstoneFor, forgetTombstones, reconstruct,
    eligible, coverage, protectedForMe, bandOf, owed, bundleFor, carries,
    needsStandalone, repairFrom, mayRetire,
    _criticalPositions,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Vouch };
