// tests/check-vouch.js
// WALL: PROTECTION IS PERSONAL, BOUNDED, AND REGENERATIVE.
//
// PART A — a record REGENERATES, it does not merely point. rebuild(compact(x)) === x exactly.
// PART B — a tampered record loses to the maths.
// PART C — protection is judged AT MY BAR, and coverage from below discharges nobody.
// PART D — the two structural exemptions: owner-by-channel-origin, and never-yourself.
// PART E — DUTY IS BOUNDED BY THE FLOOR, and the bound cannot be forgotten by omission. This is
//          the rule the old tree stated in its docs and enforced nowhere.
// PART F — deficit bands read RANK, not voucher count.
// PART G — silent repair: rebuilt with zero messages, and a record from the FUTURE is refused.
// PART H — the free/paid message policy.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

function fail(m, g) { console.log("[vouch] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
  "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
], {});
const { Vouch, Ranks, StateDeriver, ConsensusHash } = sb;
const OWNER = F.RANK.owner, HS = F.RANK.highStaff, STAFF = F.RANK.staff, GUEST = F.RANK.guest, PLAYER = F.RANK.player;

// ── PART A — regenerate, don't point ─────────────────────────────────────────────────────────
{
  const bodies = [
    { t: "ddjp.dj.join", v: "abcdefghijk", u: "https://www.youtube.com/watch?v=abcdefghijk", l: 5, dv: 2, hv: 1 },
    { t: "ddjp.dj.play", p: "$x", l: 7, dv: 2, pHash: "zz", w: [{ i: "$q" }], og: { ch: "!c", rk: 40 } },
    { t: "ddjp.play.len", pi: "$p", sec: 210, l: 9 },
    { t: "ddjp.dj.strike", x: "@u:hs", v: "abcdefghijk", l: 11 },
  ];
  for (const b of bodies) {
    const round = Vouch.rebuild(Vouch.compact(b));
    const action = Vouch.actionPayload(b);
    ok(JSON.stringify(Object.keys(round).sort().map(k => [k, round[k]]))
       === JSON.stringify(Object.keys(action).sort().map(k => [k, action[k]])),
      "A: rebuild(compact(x)) must equal the action payload byte for byte — " + b.t,
      { round: round, action: action });
  }
  // THE ENVELOPE IS EXCLUDED, AND THAT DISSOLVES A CIRCULARITY. An event's bytes include the
  // witness records it carries, and those records contain hashes — so hashing the whole body would
  // mean hashing a body that contains hashes of bodies. Hashing the ACTION only breaks the loop,
  // which is why the split exists at all. Ported from check-compact-record.
  //
  // NOTE what is NOT in the exclusion any more: POSITION. That file asserted the fingerprint was
  // stable across differing `l`, which sounded like a virtue and was a hole — see PART B4.
  const bare = { t: "ddjp.dj.play", p: "$x", l: 7 };
  const dressed = { t: "ddjp.dj.play", p: "$x", l: 7, dv: 2, hv: 1, pHash: "abc",
                    w: [{ i: "$q", h: "zz" }], og: { ch: "!c", rk: 40 } };
  ok(Vouch.fingerprint(bare) === Vouch.fingerprint(dressed),
    "A: witnessing and envelope fields must NOT change the fingerprint, or a regenerated action "
    + "could never verify without reproducing bytes a record does not carry");

  const withUrl = { t: "ddjp.dj.join", v: "abcdefghijk", u: "https://www.youtube.com/watch?v=abcdefghijk", l: 3 };
  ok(Vouch.compact(withUrl).u === undefined && Vouch.compact(withUrl).cu === 1,
    "A: a canonical url is DROPPED and flagged, because it is provably regenerable from v");
  ok(Vouch.rebuild(Vouch.compact(withUrl)).u === "https://www.youtube.com/watch?v=abcdefghijk",
    "A: APPLIED — and comes back identical");
  const oddUrl = { t: "ddjp.dj.join", v: "abcdefghijk", u: "https://youtu.be/abcdefghijk?t=30", l: 3 };
  ok(Vouch.compact(oddUrl).u === "https://youtu.be/abcdefghijk?t=30",
    "A: anything NOT provably derivable is carried verbatim, so the delta is always sufficient");
}

// ── PART B — the hash gate ───────────────────────────────────────────────────────────────────
{
  const raw = F.rawEvent("$e1", 4, 1000, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$prev" });
  const rec = Vouch.record(raw);
  ok(rec && rec.i === "$e1" && rec.l === 4 && rec.r === STAFF, "B: a record carries id, position and observed rank", rec);
  ok(Vouch.verifyRecord(rec) === true, "B: an honest record verifies");
  const tampered = Object.assign({}, rec, { d: Object.assign({}, rec.d, { p: "$forged" }) });
  ok(Vouch.verifyRecord(tampered) === false,
    "B: APPLIED — a tampered record loses to the maths. Nothing has to notice it is a forgery");
}

// ── PART B2 — THE ANCHOR: what actually proves an event existed ──────────────────────────────
// The reason vouching exists at all: a deleted OR EDITED event must be reconstructable to the byte,
// as far as timeline computation is concerned, AND CHECKED. Self-consistency is not that check —
// anyone can invent content, hash it, and publish a valid record naming any id. The check is the
// CHAIN: a held child already committed the parent's hash, so a forger would have to produce
// content hashing to a value somebody else published first.
//
// This requires the chain to commit the ACTION hash rather than the full body, for two independent
// reasons: a record can only reconstruct the action (the envelope is position and witnessing), and
// hashing the full body is circular because the body contains records that contain hashes.
{
  const parentBody = { t: "ddjp.dj.join", v: "abcdefghijk", l: 5 };
  const rec = Vouch.record(F.rawEvent("$p", 5, 1000, "@a:hs", STAFF, parentBody));

  ok(Vouch.commitFor(parentBody) === Vouch.fingerprint(parentBody),
    "B2: what a child COMMITS and what a record PROVES must be the same value, or none of this "
    + "connects. They were different — full body versus action — and the divergence was recorded "
    + "as 'a later increment'");

  const anchor = F.rawEvent("$c", 6, 2000, "@b:hs", STAFF,
    { t: "ddjp.dj.play", p: "$p", pHash: Vouch.commitFor(parentBody) });
  ok(Vouch.verifyAgainstChain(rec, [anchor]).why === "chain-anchored",
    "B2: APPLIED — a genuine record matching a held anchor is PROOF the event existed");

  // A forger must now include the POSITION in what they hash, since it is committed. They still
  // can — self-consistency was never the barrier — which is exactly why the anchor is.
  const invented = { t: "ddjp.dj.play", p: "$whatever" };
  const forged = { i: "$p", l: 5, d: invented, h: Vouch.fingerprint(Object.assign({ l: 5 }, invented)), r: 0 };
  ok(Vouch.verifyRecord(forged) === true,
    "B2: a forged record is SELF-CONSISTENT — which is why self-consistency was never the gate");
  const vMismatch = Vouch.verifyAgainstChain(forged, [anchor]);
  ok(vMismatch.ok === false && vMismatch.why === "hash-mismatch",
    "B2: APPLIED — but it loses to the anchor. Arithmetic, not authority", vMismatch);

  // ASSERT THE VERDICT, NOT JUST THE LABEL. A first version checked only `why`, so flipping
  // no-anchor to ok:true left it green — the reason string was still right while the answer had
  // become "accepted". A named reason is for diagnosis; the flag is the decision, and a guard that
  // reads the label instead of the decision is testing the wording.
  const vNone = Vouch.verifyAgainstChain(forged, []);
  ok(vNone.ok === false && vNone.why === "no-anchor",
    "B2: APPLIED — with no anchor held the verdict is 'cannot tell' AND it is not an acceptance. "
    + "The two are kept distinct because collapsing them makes a missing anchor read as a forgery "
    + "in one direction, and a forgery read as fine in the other", vNone);

  // unanimity or nothing: a back-dated forgery committing a different hash makes it ambiguous
  const rival = F.rawEvent("$c2", 7, 2100, "@evil:hs", STAFF,
    { t: "ddjp.dj.play", p: "$p", pHash: "somethingelse" });
  ok(Vouch.expectedHashFor("$p", [anchor, rival]) === null,
    "B2: APPLIED — two anchors DISAGREEING resolves to nothing. A forger can DENY recovery this "
    + "way but never poison it, which is the right direction to fail: losing an event is "
    + "recoverable, accepting a fabricated one is not");

  ok(Vouch.acceptOriginal("$p", parentBody, [anchor]) === true,
    "B2: and a re-supplied FULL body is checked the same way");
}

// ── PART B2b — EMIT == VERIFY, ON A REAL BODY ────────────────────────────────────────────────
// Ported from check-voucher-convergence, and it caught a live bug the moment it was written: the
// EMITTER was still stamping contentHash(FULL body) while verification expected the ACTION hash.
//
// The consequence was silent and total. A mismatch is treated as a FORGERY, not as "cannot check",
// so `repairFrom` skipped every record and rebuilt nothing, ever. A recovery mechanism that quietly
// recovers nothing looks exactly like a room where nothing was ever deleted.
//
// THE FIXTURE HAS TO BE A REAL BODY. A first version used a bare {t, v, l} — and the two hashes
// COINCIDE there, because the envelope keys it strips were not present to begin with. It passed
// under both readings and proved nothing. A real emitted event carries dv, hv and its own vouch
// bundle, and only then do they diverge.
{
  const real = { t: "ddjp.dj.join", v: "abcdefghijk", l: 5, dv: 2, hv: 1,
                 w: [{ i: "$q", l: 1, d: {}, h: "zz", r: 40 }], og: { ch: "!c", rk: 40 } };
  ok(Vouch.commitFor(real) !== ConsensusHash.contentHash(real),
    "B2b: on a REAL body the action hash and the full-body hash DIFFER — a fixture where they "
    + "coincide cannot tell the two commitments apart");

  const rec = Vouch.record(F.rawEvent("$p", 5, 1000, "@a:hs", STAFF, real));
  const bundle = F.rawEvent("$w", 7, 3, "@w:hs", STAFF, { t: "ddjp.witness.bundle", w: [rec] });
  const correct = F.rawEvent("$c", 6, 2, "@b:hs", STAFF,
    { t: "ddjp.dj.play", p: "$p", pHash: Vouch.commitFor(real) });
  const wrong = F.rawEvent("$c", 6, 2, "@b:hs", STAFF,
    { t: "ddjp.dj.play", p: "$p", pHash: ConsensusHash.contentHash(real) });

  ok(Vouch.verifyAgainstChain(rec, [correct]).why === "chain-anchored",
    "B2b: what the chain COMMITS and what a record PROVES must be the same value");
  ok(Vouch.verifyAgainstChain(rec, [wrong]).why === "hash-mismatch",
    "B2b: APPLIED — and committing the full body instead makes every honest record read as a "
    + "FORGERY rather than as unverifiable, which is the worse of the two wrong answers");
  ok(Vouch.repairFrom([wrong, bundle]).length === 0
     && Vouch.repairFrom([correct, bundle]).length === 1,
    "B2b: APPLIED — so repair rebuilds NOTHING under the wrong commitment and works under the "
    + "right one. This is the shape of the bug: total, silent, and indistinguishable from a room "
    + "where nothing was ever deleted");

  // AND THE EMITTER MUST USE IT. Testing the definition is not testing the caller — the caller was
  // exactly what was wrong.
  const bridge = require("fs").readFileSync(
    require("path").join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  const i = bridge.indexOf("stamped.pHash");
  ok(i > 0 && /Vouch\.commitFor\(/.test(bridge.slice(Math.max(0, i - 1500), i)),
    "B2b: APPLIED — the EMITTER stamps Vouch.commitFor, not a hash of its own choosing");
}

// ── PART B3 — THE TOMBSTONE: identity and rank come from MATRIX ──────────────────────────────
// A redaction strips CONTENT and leaves the event id, sender, timestamp and ROOM ID — signed. The
// room is the channel and the channel is the rank, so a deleted event's rank is readable by exactly
// the rule a live event's rank is read by. That is the half that was missing: a record cannot carry
// identity (it commits the sender without letting you open the commitment, and a claimed `sender`
// field would be asserted identity, which this system refuses), and it does not need to.
{
  const parentBody = { t: "ddjp.dj.join", v: "abcdefghijk", l: 5 };
  const rec = Vouch.record(F.rawEvent("$p", 5, 1000, "@dj:hs", STAFF, parentBody));
  const anchor = F.rawEvent("$c", 6, 2000, "@b:hs", STAFF,
    { t: "ddjp.dj.play", p: "$p", pHash: Vouch.commitFor(parentBody) });
  const bundle = F.rawEvent("$w", 7, 3000, "@w:hs", STAFF, { t: "ddjp.witness.bundle", w: [rec] });

  Vouch.forgetTombstones();
  ok(Vouch.reconstruct("$p", [anchor, bundle]).why === "no-tombstone",
    "B3: with content but no tombstone, identity is unrecoverable — the PURGE case, and now the "
    + "only irreducible one");

  Vouch.rememberTombstone({ id: "$p", sender: "@dj:hs", rank: STAFF, roomId: "!ev", ts: 1000 });
  const r = Vouch.reconstruct("$p", [anchor, bundle]);
  ok(r.ok === true && r.event.sender === "@dj:hs" && r.event.senderRank === STAFF,
    "B3: APPLIED — tombstone supplies sender and rank, the record supplies content and position, "
    + "and together they are a COMPLETE event", r.ok && { sender: r.event.sender, rank: r.event.senderRank });

  ok(Vouch.reconstruct("$p", [anchor]).why === "no-record",
    "B3: and with the tombstone but no record we know WHO and WHERE but not WHAT — the chain cuts, "
    + "honestly, rather than guessing");

  // the property that was previously impossible
  const st = StateDeriver.derive([{ eventId: r.event.event_id, type: "ddjp.dj.join",
    content: JSON.parse(r.event.content.body), l: r.event.l, ts: r.event.ts,
    sender: r.event.sender, senderRank: r.event.senderRank }]);
  ok(st.rotation.length === 1 && st.rotation[0].user === "@dj:hs",
    "B3: APPLIED — and THE REDUCER FOLDS IT. A rebuilt event was restore-material only because it "
    + "had no author; with Matrix supplying that, a deleted event can re-enter history rather than "
    + "merely sitting in a cache", st.rotation);
  Vouch.forgetTombstones();
}

// ── PART B3b — THE EXTENSION check-restore-invariance ASKED FOR ──────────────────────────────
// That guard's own header says: "a restored event re-derives to identical consensus state
// regardless of the rank stamped at restore ... WHEN attestation's re-ingest or a Phase-B
// checkpoint restore lands, EXTEND this: drive that path with a DELIBERATELY WRONG restore rank
// and assert derived consensus == the origin-rank consensus."
//
// Tombstone reconstruction IS restore-to-consensus landing. And it passes for a reason stronger
// than the guard hoped for: the rank is not something a caller can get wrong, because it does not
// come from the caller at all. It comes from the room the tombstone names.
{
  Vouch.forgetTombstones();
  const body = { t: "ddjp.dj.remove", x: "@victim:hs", l: 5 };
  const rec = Vouch.record(F.rawEvent("$r", 5, 1000, "@mod:hs", STAFF, body));
  const anchor = F.rawEvent("$c", 6, 2000, "@b:hs", STAFF,
    { t: "ddjp.dj.play", p: "$r", pHash: Vouch.commitFor(body) });
  const bundle = F.rawEvent("$w", 7, 3000, "@w:hs", STAFF, { t: "ddjp.witness.bundle", w: [rec] });

  // A WITNESS CLAIMING A DIFFERENT RANK. `r` is the witness's OBSERVED rank and is advisory; the
  // reducer is rank-SENSITIVE for this event type, so believing the record here would let a witness
  // change consensus by mis-observing.
  const lying = Object.assign({}, rec, { r: F.RANK.owner });
  const lyingBundle = F.rawEvent("$w2", 8, 3100, "@liar:hs", STAFF,
    { t: "ddjp.witness.bundle", w: [lying] });

  Vouch.rememberTombstone({ id: "$r", sender: "@mod:hs", rank: STAFF, roomId: "!events-staff", ts: 1000 });
  const a = Vouch.reconstruct("$r", [anchor, bundle]);
  const b = Vouch.reconstruct("$r", [anchor, lyingBundle]);
  ok(a.ok && b.ok, "B3b: both reconstruct");
  ok(a.event.senderRank === STAFF && b.event.senderRank === STAFF,
    "B3b: APPLIED — a record CLAIMING owner rank changes nothing. Rank is taken from the room the "
    + "TOMBSTONE names, so the restore path cannot be driven with a wrong rank at all — the old "
    + "guard asked for consensus to be equal under a wrong rank, and the answer is that a wrong "
    + "rank is unrepresentable here", { honest: a.event.senderRank, lying: b.event.senderRank });

  // and the reducer really is rank-sensitive for this event, so the above is load-bearing
  const asStaff = StateDeriver.derive([
    { eventId: "$j", type: "ddjp.dj.join", content: { t: "ddjp.dj.join", v: "abcdefghijk" }, l: 1, ts: 1, sender: "@victim:hs", senderRank: STAFF },
    { eventId: "$r", type: "ddjp.dj.remove", content: JSON.parse(a.event.content.body), l: 5, ts: 5, sender: "@mod:hs", senderRank: STAFF },
  ]);
  const asGuest = StateDeriver.derive([
    { eventId: "$j", type: "ddjp.dj.join", content: { t: "ddjp.dj.join", v: "abcdefghijk" }, l: 1, ts: 1, sender: "@victim:hs", senderRank: STAFF },
    { eventId: "$r", type: "ddjp.dj.remove", content: JSON.parse(a.event.content.body), l: 5, ts: 5, sender: "@mod:hs", senderRank: F.RANK.guest },
  ]);
  ok(asStaff.rotation.length !== asGuest.rotation.length,
    "B3b: APPLIED — the reducer IS rank-sensitive for this event, so restoring with the wrong rank "
    + "WOULD change consensus. That is exactly why the rank must come from Matrix and not from a "
    + "witness", { staff: asStaff.rotation.length, guest: asGuest.rotation.length });
  Vouch.forgetTombstones();
}

// ── PART B4 — POSITION IS COMMITTED ──────────────────────────────────────────────────────────
{
  ok(Vouch.fingerprint({ t: "ddjp.dj.play", p: "$x", l: 1 })
     !== Vouch.fingerprint({ t: "ddjp.dj.play", p: "$x", l: 2 }),
    "B4: the same action at two positions must hash DIFFERENTLY. 'Invariant to position' sounds "
    + "like a virtue and is a hole");
  const body = { t: "ddjp.dj.play", p: "$x", l: 5 };
  const rec = Vouch.record(F.rawEvent("$e", 5, 1, "@a:hs", STAFF, body));
  ok(Vouch.verifyRecord(rec) === true, "B4: an honest record verifies");
  ok(Vouch.verifyRecord(Object.assign({}, rec, { l: 99 })) === false,
    "B4: APPLIED — a GENUINE record re-supplied with a forged position is refused. Nothing else "
    + "could catch this: `l` lives in the DDJP body, which redaction strips, so not even the "
    + "tombstone knows where an event sat");
}

// ── PART B5 — ONE BAD EVENT MUST NOT POISON THE BATCH ────────────────────────────────────────
// Ported from check-hashable. `record()` is TOTAL: a record it cannot build is a record it skips,
// never one that takes the batch with it.
//
// The failure this guards against was invisible in the worst way. A single throw in here used to
// take down the ENTIRE bundle — both the free ride-along and the paid standalone — silently, and
// for as long as the offending event was held. A client would simply stop protecting anything,
// look completely healthy, and keep looking healthy until whatever it held expired.
{
  const good1 = F.rawEvent("$g1", 5, 1, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$z" });
  const good2 = F.rawEvent("$g2", 6, 2, "@b:hs", STAFF, { t: "ddjp.dj.join", v: "abcdefghijk" });
  // THE BAD EVENT HAS TO REACH THE HASHER. A first version used malformed JSON — which fails at
  // parsing, one step BEFORE the try/catch that makes `record` total, so the guard proved only that
  // unparseable bodies are skipped. The interesting failure is a body that parses cleanly and then
  // throws inside canonicalisation: a non-integer number is exactly that, since the hash refuses
  // anything ambiguous.
  const bad = { event_id: "$bad", l: 7, sender: "@c:hs", senderRank: STAFF,
                content: { body: JSON.stringify({ t: "ddjp.dj.play", p: "$z", sec: 1.5 }) } };
  let hashThrew = false;
  try { ConsensusHash.contentHash({ sec: 1.5 }); } catch (e) { hashThrew = true; }
  ok(hashThrew,
    "B5: APPLIED — the fixture must actually reach the hasher and fail there, or the totality this "
    + "part exists to prove is never exercised");

  ok(Vouch.record(bad) === null,
    "B5: a record that cannot be built comes back as NULL rather than throwing");
  ok(Vouch.record(good1) !== null && Vouch.record(good2) !== null,
    "B5: APPLIED — and the good ones still build, or the next assertion tests nothing");

  const bundle = Vouch.bundleFor([good1, bad, good2], ["$g1", "$bad", "$g2"], 10);
  ok(bundle.length === 2 && bundle.every((r) => Vouch.verifyRecord(r)),
    "B5: APPLIED — a batch containing an unbuildable event still carries the GOOD records. One "
    + "throw here used to take the whole bundle down, silently, for as long as the offending event "
    + "was held — a client that stops protecting anything while looking perfectly healthy",
    bundle.map((r) => r.i));
}

// ── PART C — my bar, and no trusting downward ────────────────────────────────────────────────
{
  const author = { u: "@author:hs", r: STAFF };
  const sixGuests = [];
  for (let i = 0; i < 6; i++) sixGuests.push({ u: "@g" + i + ":hs", r: GUEST });
  ok(Vouch.protectedForMe(sixGuests, author, {}, GUEST) === false,
    "C: guests satisfy nobody by default — quantity below VIP never adds up to protection");
  ok(Vouch.protectedForMe(sixGuests, author, {}, STAFF) === false,
    "C: APPLIED — and a staff observer is certainly not reassured by six guests");
  const oneOwner = [{ u: "@own:hs", r: OWNER }];
  ok(Vouch.protectedForMe(oneOwner, author, {}, STAFF) === true,
    "C: APPLIED — while ONE voucher from above satisfies outright");
  const threeStaff = [{ u: "@s1:hs", r: STAFF }, { u: "@s2:hs", r: STAFF }, { u: "@s3:hs", r: STAFF }];
  ok(Vouch.protectedForMe(threeStaff, author, {}, STAFF) === true,
    "C: three staff meet the staff bar");
  ok(Vouch.protectedForMe(threeStaff, author, {}, HS) === false,
    "C: APPLIED — but the SAME coverage leaves a high-staff observer unprotected. Protection is "
    + "personal; both readings are correct at once");
}

// ── PART D — the two exemptions ──────────────────────────────────────────────────────────────
{
  const mine = F.rawEvent("$m", 5, 1000, "@me:hs", STAFF, { t: "ddjp.dj.play", p: "$a" });
  ok(Vouch.eligible(mine, "@me:hs", null) === false,
    "D: never vouch yourself — your copy dies with your own deletion, which is the deletion a "
    + "vouch exists to survive");
  const ownerEvent = F.rawEvent("$o", 6, 1000, "@own:hs", OWNER, { t: "ddjp.dj.play", p: "$a" });
  ok(Vouch.eligible(ownerEvent, "@me:hs", null) === false,
    "D: APPLIED — an owner event needs no vouching. Nobody below the top rank can delete another "
    + "person's message, so protecting it means defending the owner against the owner");
  const rebuilt = { event_id: "$r", l: 7, senderRank: STAFF, content: { body: JSON.stringify({ t: "ddjp.dj.play", p: "$a" }) } };
  ok(Vouch.eligible(rebuilt, "@me:hs", null) === false,
    "D: APPLIED — a REBUILT event has no sender, so the not-mine test could not fire on it. Without "
    + "this a client could target its own redacted-and-rebuilt event and count its own vouch");
  const vote = F.rawEvent("$v", 8, 1000, "@a:hs", STAFF, { t: "ddjp.dj.vote", p: "$a" });
  ok(Vouch.eligible(vote, "@me:hs", null) === false, "D: display-level types are never protected");
  const decl = F.rawEvent("$d", 9, 1000, "@a:hs", STAFF, { t: "ddjp.play.len", pi: "$a", sec: 100 });
  ok(Vouch.eligible(decl, "@me:hs", null) === true,
    "D: APPLIED — but a per-play DECLARATION is critical: it drives the advance gate, so losing "
    + "one is a divergence rather than a cosmetic glitch");
}

// ── PART E — duty is bounded by the floor, and cannot be omitted ─────────────────────────────
{
  const held = F.heldSet([
    F.rawEvent("$old1", 2, 1000, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$z" }),
    F.rawEvent("$old2", 3, 1000, "@b:hs", STAFF, { t: "ddjp.dj.join", v: "abcdefghijk" }),
    F.rawEvent("$new1", 40, 2000, "@c:hs", STAFF, { t: "ddjp.dj.play", p: "$y" }),
  ], { padding: 14 });

  const noFloor = Vouch.owed(held, { myRank: HS, myUserId: "@me:hs", settings: {}, floorL: null });
  const withFloor = Vouch.owed(held, { myRank: HS, myUserId: "@me:hs", settings: {}, floorL: 10 });
  ok(noFloor.targets.indexOf("$old1") >= 0,
    "E: with no floor, an old event is still owed", noFloor.targets);
  ok(withFloor.targets.indexOf("$old1") < 0 && withFloor.targets.indexOf("$old2") < 0,
    "E: APPLIED — below the floor a checkpoint has BANKED it, so nobody can ever need the raw "
    + "event again and protecting it is wasted work", withFloor.targets);
  ok(withFloor.bankedSkipped >= 2,
    "E: APPLIED — and the module says how much it skipped rather than silently doing less",
    withFloor.bankedSkipped);

  const omitted = Vouch.owed(held, { myRank: HS, myUserId: "@me:hs", settings: {} });
  ok(omitted.error === "floorL-required" && omitted.targets.length === 0,
    "E: APPLIED — omitting the bound is REFUSED. In the old tree the parameter did not exist, so "
    + "the rule lived in the docs and was enforced nowhere, and clients kept protecting banked "
    + "events forever", omitted);
}

// ── PART F — bands read rank ─────────────────────────────────────────────────────────────────
{
  const author = { u: "@author:hs", r: PLAYER };
  const S = {};
  ok(Vouch.bandOf([], author, STAFF, S) === 0, "F: nothing at all -> band 0");
  ok(Vouch.bandOf([{ u: "@g:hs", r: GUEST }], author, STAFF, S) === 1, "F: only below me -> band 1");
  ok(Vouch.bandOf([{ u: "@g1:hs", r: GUEST }, { u: "@g2:hs", r: GUEST }, { u: "@g3:hs", r: GUEST }], author, STAFF, S) === 1,
    "F: APPLIED — three below me is STILL band 1. Quantity below never promotes, which is exactly "
    + "what ordering by voucher count got wrong");
  ok(Vouch.bandOf([{ u: "@s:hs", r: STAFF }], author, STAFF, S) === 2, "F: at my level, short of the bar -> band 2");
  ok(Vouch.bandOf([{ u: "@o:hs", r: OWNER }], author, STAFF, S) === null, "F: one from above discharges me entirely");
}

// ── PART G — silent repair ───────────────────────────────────────────────────────────────────
{
  const lost = F.rawEvent("$lost", 5, 1000, "@a:hs", STAFF, { t: "ddjp.dj.join", v: "abcdefghijk" });
  const rec = Vouch.record(lost);
  const carrier = F.rawEvent("$carry", 9, 2000, "@b:hs", STAFF, { t: "ddjp.dj.play", p: "$x", w: [rec] });
  const rebuilt = Vouch.repairFrom([carrier]);
  ok(rebuilt.length === 1 && rebuilt[0].event_id === "$lost",
    "G: an event is rebuilt from a record we already hold, with ZERO messages", rebuilt.length);
  ok(JSON.parse(rebuilt[0].content.body).v === "abcdefghijk",
    "G: APPLIED — and the content comes back exactly");
  ok(Vouch.repairFrom([carrier, lost]).length === 0, "G: nothing is rebuilt that we already hold");

  // THE HASH GATE, ASSERTED THROUGH REPAIR RATHER THAN IN ISOLATION. Mutation found this: PART B
  // proves verifyRecord() rejects a tampered record, and repairFrom() calls it — but deleting that
  // call left every assertion green, because nothing ever fed repair a bad record. Testing a gate
  // and testing that the gate is WIRED are two different assertions, and only the second one
  // matters here: a tampered record that is rebuilt and believed is content injection.
  const bad = Object.assign({}, rec, { d: Object.assign({}, rec.d, { v: "FORGEDaaaaa" }) });
  const badCarry = F.rawEvent("$c3", 9, 2000, "@b:hs", STAFF, { t: "ddjp.dj.play", p: "$x", w: [bad] });
  ok(Vouch.repairFrom([badCarry]).length === 0,
    "G: APPLIED — a TAMPERED record is refused BY REPAIR, not merely by the verifier it is supposed "
    + "to call. Rebuilding it would inject forged content into the room under a real event id");

  const future = Object.assign({}, rec, { l: 99 });
  const badCarrier = F.rawEvent("$c2", 9, 2000, "@b:hs", STAFF, { t: "ddjp.dj.play", p: "$x", w: [future] });
  ok(Vouch.repairFrom([badCarrier]).length === 0,
    "G: APPLIED — YOU CANNOT WITNESS THE FUTURE. A record after its carrier's position belongs to "
    + "another room's timeline, and rebuilding it would launder foreign history into this room "
    + "past every later scope check");
}

// ── PART G2 — REPAIR DEDUPS, AND THE ASK PATH IS GONE ────────────────────────────────────────
// Ported from check-recovery when that file's module was merged into this one. Two claims with no
// other home, and the second is anti-erosion rather than behaviour.
{
  const lost = F.rawEvent("$lost", 5, 1000, "@a:hs", STAFF, { t: "ddjp.dj.join", v: "abcdefghijk" });
  const rec = Vouch.record(lost);
  // MANY carriers of the SAME record. In a healthy room this is the normal case — a well-protected
  // event is carried by everyone who owes it — so rebuilding once per carrier would turn good
  // coverage into duplicated work that scales with how safe the event is.
  const carriers = ["@b:hs", "@c:hs", "@d:hs", "@e:hs"].map((u, i) =>
    F.rawEvent("$c" + i, 9 + i, 2000, u, STAFF, { t: "ddjp.witness.bundle", w: [rec] }));
  const rebuilt = Vouch.repairFrom(carriers);
  ok(rebuilt.length === 1 && rebuilt[0].event_id === "$lost",
    "G2: four carriers of one record rebuild it ONCE. The better protected an event is, the more "
    + "carriers it has, so this bounds the work by what is MISSING rather than by how safe it is",
    rebuilt.length);

  // THE ASK PATH IS GONE, and this is the guard that keeps it gone. Nobody requests a missing event
  // and nobody answers: a client rebuilds from what it already holds, with zero messages. That is
  // not an optimisation — a request/answer surface is a way to be asked for bytes, which is a way
  // to be lied to about which bytes were asked for.
  for (const fn of ["buildRequest", "hasMerit", "buildAnswer", "pickBackfill", "quorumMet"]) {
    ok(Vouch[fn] === undefined,
      "G2: APPLIED — `" + fn + "` must not come back. The repair path is one-way by construction");
  }
  const bridgeSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  ok(!/ddjp\.voucher\.request/.test(bridgeSrc),
    "G2: APPLIED — and transport references no request type at all, so the surface cannot be "
    + "revived by wiring alone");
}

// ── PART H — free ride versus paid message ───────────────────────────────────────────────────
{
  ok(Vouch.needsStandalone(5, 60000, false) === false, "H: a small backlog rides along and costs nothing");
  ok(Vouch.needsStandalone(50, 1000, false) === false, "H: a big backlog with a recent carrier of my own still rides along");
  ok(Vouch.needsStandalone(50, 60000, false) === true, "H: a real backlog with no carrier coming justifies paying");
  ok(Vouch.needsStandalone(0, 0, true) === true,
    "H: APPLIED — a DETECTED DELETION pays immediately, whatever the backlog and however recently "
    + "I sent something. That is history actively at risk");
  ok(Vouch.carries("ddjp.dj.join") === true && Vouch.carries("ddjp.dj.vote") === false,
    "H: every CRITICAL event carries a bundle — the set that needs protecting and the set that can "
    + "carry it are the same set, so it is the complement of one list rather than a second list");
}

console.log("[vouch] PASS — protection is personal, bounded and regenerative: a record rebuilds an "
  + "event byte for byte and a tampered one loses to the maths; the same coverage protects a guest "
  + "and leaves a high-staff observer exposed, and quantity below never promotes; owner events and "
  + "your own are exempt structurally, and a rebuilt event is restore material rather than a "
  + "target; duty is bounded by the floor and OMITTING that bound is refused rather than defaulted; "
  + "repair costs zero messages and refuses a record that claims to witness the future; and a paid "
  + "message fires only on a real backlog or a detected deletion");
