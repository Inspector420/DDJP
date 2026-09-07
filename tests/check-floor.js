// tests/check-floor.js
// WALL: THE FLOOR IS A CONCEPT WITH ONE OWNER.
//
// In the old tree this concept had no home — the backward search lived in the vouching policy, the
// agreement check lived in the checkpoint engine, and adopting, grading, re-checking and
// re-fetching were mixed into the file that also emits checkpoints. Four bugs came from that, and
// PART A is the one nobody had noticed at all.
//
// PART A — a floor is ADOPTED from an arriving checkpoint, and adopting ANNOUNCES itself. This
//          part used to end in a reload, because a floor was written to disk and restored on load.
//          It is not any more: the restore demanded a recompute of grades that were never computed
//          and deleted the floors it was meant to bring back, so the path was removed rather than
//          patched. Its absence is check-floor-reload's question, not this file's.
// PART B — the OLDEST cut of a quorum is adopted, never the newest.
// PART B1 — a floor knows WHEN it came into existence, and a quorum is dated from the NEWEST of
//          its group — the arrival that completed the agreement — even though it sits at the
//          oldest cut. The seal cadence measures its cooldown from that timestamp. B1b is the
//          same question for an owner floor, which has exactly one checkpoint to be dated from.
// PART C — ordering is by POSITION, never by the author's private counter.
// PART D — an owner floor ends the search on authority with no recompute. Decided, and not to be
//          closed by accident.
// PART E — a floor from BELOW me never binds me.
// PART F — retraction is CONDITIONAL: withdraw if we still hold history, demote to stale if we
//          have already forgotten below it. Withdrawing there would leave nothing to compute from.
// PART G — only a proved grade earns forgetting.
// PART H — vouching can be bounded by the floor, because the floor is askable.
// PART I — a segment is folded onto the state it claims to continue from, never from EMPTY, and a
//          joining segment we do not hold is REFUSED rather than waved through. Re-homed here from
//          the deleted restore path, which was the only other place that folded.
// PART J — a thin join fetches what it needs to VERIFY, not what it needs to display.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

function fail(msg, got) {
  console.log("[floor] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const F = require("./_fixtures");
const OWNER = F.RANK.owner, HS = F.RANK.highStaff, STAFF = F.RANK.staff;

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js",
  ], { Date });
}

// A room, and a checkpoint sealed over a prefix of it by a given author.
const ROOM = F.playingRoom({ songs: 8 });
const LOG = F.sortLog(ROOM.log);

function sealAt(sb, cutIndex, author, rank) {
  const seg = LOG.slice(0, cutIndex);
  const last = seg[seg.length - 1];
  const seed = sb.StateDeriver.buildSeed(seg);
  const covers = seg[0].eventId + ".." + last.eventId;
  const floorL = last.l;
  const n = 1, prev = null, thin = false;
  const h = sb.Floor.fingerprint(n, prev, seed, floorL, thin, covers);
  return { t: "ddjp.checkpoint", n: n, prev: prev, seed: seed, h: h,
           covers: covers, floorL: floorL, thin: thin, by: author, _rank: rank };
}

// ── PART A — a floor is ADOPTED, and adopting announces itself ───────────────────────────────
// This part used to end in a reload: adopt, persist, reload, restore. There is no persistence any
// more — the restore rule demanded a recompute of grades that were never computed, so it deleted
// the very floors it was meant to bring back, and the path was removed rather than patched. What
// survives here is the half that was never about disk: selecting an owner floor and adopting it.
// The absence of the stored path is asserted in check-floor-reload, which owns that question.
{
  const sb = tree();
  const cp = sealAt(sb, 6, "@own:hs", OWNER);

  sb.Floor.attach({
    log: () => LOG,
    settings: () => ({}),
    myRank: () => STAFF,
    trimmed: () => false,
  });

  sb.Floor.remember(cp, OWNER, "@own:hs");
  const sel = sb.Floor.select(STAFF, {}, () => true);
  ok(sel && sel.tier === 0, "A: setup — an owner floor is selectable", sel);
  // THE EMISSION, asserted rather than assumed. Mutation found that deleting the adopt event left
  // every assertion green: the floor still changed, so nothing noticed nobody had been TOLD. A
  // floor change is the most consequential state change in the system — it decides what everyone
  // computes from, bounds what vouching owes, and licenses forgetting — and in the old tree it
  // announced itself to nobody. A flag nobody reads is this codebase's signature bug.
  const emitted = [];
  sb.Floor.onChange((e) => emitted.push(e));
  ok(sb.Floor.adopt(sel) === true, "A: setup — and adoptable");
  ok(emitted.some((e) => e.kind === "adopted" && typeof e.floorL === "number"),
    "A: APPLIED — adopting a floor EMITS, so wiring can be declarative ('floor changed -> "
    + "recompute duty') instead of an orchestrator remembering to call things in the right order",
    emitted);
  ok(sb.Floor.position() === cp.floorL,
    "A: APPLIED — and the floor is where the checkpoint put it",
    { got: sb.Floor.position(), want: cp.floorL });
  rest();
}

function rest() {

// ── PART A2 — emitting is not re-entrant ─────────────────────────────────────────────────────
// A listener is going to be something like "the floor moved, recompute duty". A listener that
// reaches back INTO this module would otherwise run while an adoption is half-applied — reading a
// floor whose fields are set but whose announcement has not finished — and a chain of them could
// loop. Found by reading, and
// invisible to any test with no listeners, which is every test until this one.
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF,
                    trimmed: () => false });
  const cp = sealAt(sb, 6, "@own:hs", OWNER);
  sb.Floor.remember(cp, OWNER, "@own:hs");

  // THE LISTENER MUST ACTUALLY RE-ENTER, or this proves nothing. A first version had the listener
  // call revalidate(), which returns early for any grade but "quorum" — so it never re-emitted and
  // the guard was never exercised. The fixture has to trigger a real second emission.
  const later = sealAt(sb, 9, "@own2:hs", OWNER);
  sb.Floor.remember(later, OWNER, "@own2:hs");

  let depth = 0, maxDepth = 0, calls = 0;
  sb.Floor.onChange(() => {
    calls++; depth++; maxDepth = Math.max(maxDepth, depth);
    // adopting a HIGHER floor from inside the handler is a genuine second emission
    try { sb.Floor.adopt({ floor: later, tier: 0 }); } catch (e) {}
    depth--;
  });
  // Adopt the LOWER floor explicitly. Going through select() would return the newest — which is
  // `later` — so the nested adopt would be a no-op and the guard would never be reached. That is
  // the second fixture mistake in this one test, and both had the same shape: the assertion looked
  // right and the path was never entered.
  sb.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, cp), tier: 0 });
  ok(maxDepth === 1,
    "A2: APPLIED — a listener that calls back into Floor must not re-enter the emit. Without the "
    + "guard this nests, and a listener chain could loop", { maxDepth: maxDepth, calls: calls });
  ok(calls >= 1, "A2: and the listener did actually run, so the guard is not just silence", calls);
}

// ── PART B — the OLDEST cut of a quorum, never the newest ────────────────────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => HS, trimmed: () => false });
  const a = sealAt(sb, 4, "@hs1:hs", HS);
  const b = sealAt(sb, 6, "@hs2:hs", HS);
  const c = sealAt(sb, 8, "@hs3:hs", HS);
  sb.Floor.remember(a, HS, "@hs1:hs");
  sb.Floor.remember(b, HS, "@hs2:hs");
  sb.Floor.remember(c, HS, "@hs3:hs");
  const sel = sb.Floor.select(HS, {}, () => true);   // chaining stubbed; selection is under test
  ok(sel && sel.floor.floorL === a.floorL,
    "B: three peers sealing at different moments have all attested to the OLDEST cut. Adopting the "
    + "newest would be a single-author floor wearing a quorum's name",
    { got: sel && sel.floor.floorL, want: a.floorL });
}

// ── PART B1 — A FLOOR KNOWS WHEN IT CAME INTO EXISTENCE ──────────────────────────────────────
// The seal cadence measures from the floor you hold rather than from whatever checkpoint went past,
// which it can only do if a floor carries a time. `remember` keeps the arriving event's server
// timestamp and adoption records it. No local clock is involved anywhere on this path.
//
// FOR A QUORUM IT IS THE NEWEST OF THE GROUP, and that is not the same as the floor's position. The
// floor sits at the OLDEST cut, because that is the position all of them attest to (PART B). But the
// floor did not EXIST until the last of them arrived and completed the agreement. Dating it from the
// oldest would leave a client overdue the instant it adopted, which is the loop this measurement
// exists to escape.
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => HS, trimmed: () => false });
  const a = sealAt(sb, 4, "@hs1:hs", HS);
  const b = sealAt(sb, 6, "@hs2:hs", HS);
  const c = sealAt(sb, 8, "@hs3:hs", HS);
  sb.Floor.remember(a, HS, "@hs1:hs", 1000);
  sb.Floor.remember(b, HS, "@hs2:hs", 5000);
  sb.Floor.remember(c, HS, "@hs3:hs", 9000);

  ok(sb.Floor.anchorTs() === null,
    "B1: setup — with no floor adopted there is no anchor (probe applied: a stale value here would "
    + "make every assertion below pass without adoption doing anything)", sb.Floor.anchorTs());

  const sel = sb.Floor.select(HS, {}, () => true);
  ok(sel && sb.Floor.adopt(sel) === true, "B1: setup — the quorum is adoptable");
  ok(sb.Floor.position() === a.floorL,
    "B1: setup — and it sits at the OLDEST cut, so position and age are genuinely different "
    + "questions here rather than the same one asked twice",
    { got: sb.Floor.position(), want: a.floorL });

  ok(sb.Floor.anchorTs() === 9000,
    "B1: APPLIED — the floor is dated from the NEWEST checkpoint in the quorum, the arrival that "
    + "completed the agreement, even though it sits at the oldest cut. Dating it from the oldest "
    + "would make a client overdue the moment it adopted",
    sb.Floor.anchorTs());
}

// ── PART B1b — AN OWNER FLOOR IS DATED FROM ITS OWN CHECKPOINT ───────────────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });
  const cp = sealAt(sb, 6, "@own:hs", OWNER);
  sb.Floor.remember(cp, OWNER, "@own:hs", 4242);
  ok(sb.Floor.adopt(sb.Floor.select(STAFF, {}, () => true)) === true, "B1b: setup — adopted");
  ok(sb.Floor.anchorTs() === 4242,
    "B1b: APPLIED — one checkpoint, one timestamp, carried from the event that delivered it. The "
    + "cadence reads this and never a device clock, so a page load cannot make an old floor look "
    + "like a fresh seal", sb.Floor.anchorTs());
}

// ── PART B2 — WHAT IS NOT A QUORUM ───────────────────────────────────────────────────────────
// Ported from check-retention. Two edge cases, both of which look like a quorum from a distance.
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => HS, trimmed: () => false });

  // ONE AUTHOR, THREE CHECKPOINTS. Sealing often is not the same as being agreed with: the bar
  // counts DISTINCT PEOPLE, for the reason every bar in this system does — repetition must never
  // look like breadth, or a single prolific client is a one-person quorum.
  for (const cut of [4, 6, 8]) sb.Floor.remember(sealAt(sb, cut, "@solo:hs", HS), HS, "@solo:hs");
  ok(sb.Floor.select(HS, {}, () => true) === null,
    "B2: three checkpoints from ONE author are not a quorum, however many there are");
  // ENFORCED ONE LAYER DOWN, and mutation says so: deleting Floor's own per-author dedup leaves
  // this green, because TrustPolicy._countDistinct already counts distinct users. Asserted at the
  // layer that enforces it, so the property is pinned by something rather than by a clause that
  // only looks load-bearing.
  ok(sb.TrustPolicy.substituteTrusted(
       [{ u: "@solo:hs", r: HS }, { u: "@solo:hs", r: HS }, { u: "@solo:hs", r: HS }], {}, HS) === null,
    "B2: APPLIED at the enforcing layer — the trust seam counts one person once, however many "
    + "checkpoints they sealed");

  // A CANDIDATE WITH NO POSITION. Every consumer bounds with `l <= floorL`, and the backward search
  // orders by position — so a floor that cannot say where it sits cannot be placed, and a thin
  // client (the one this search exists to serve) could not place it even in principle.
  const sb2 = tree();
  sb2.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => HS, trimmed: () => false });
  // THE FIXTURE HAS TO VERIFY. A first version deleted `floorL` AFTER hashing, so the checkpoints
  // failed `remember`'s own gate and never entered the search at all — the assertion passed on an
  // empty candidate set and proved nothing. A positionless floor has to be one whose fingerprint
  // was computed WITHOUT a position, which is exactly what an older or sloppier author would emit.
  for (const [i, cut] of [[0, 4], [1, 6], [2, 8]]) {
    const seg = LOG.slice(0, cut), last = seg[seg.length - 1];
    const cp = { n: 1, prev: null, seed: sb2.StateDeriver.buildSeed(seg),
                 covers: sb2.CheckpointFormat.coversOf(seg[0].eventId, last.eventId), thin: false };
    cp.h = sb2.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, undefined, cp.thin, cp.covers);
    ok(sb2.Floor.remember(cp, HS, "@hs" + i + ":hs") === true,
      "B2: APPLIED — a positionless checkpoint is well-formed and IS remembered, or the next "
      + "assertion tests an empty set");
  }
  ok(sb2.Floor.select(HS, {}, () => true) === null,
    "B2: APPLIED — and a quorum of candidates with NO POSITION resolves to nothing. Refusing beats "
    + "guessing: a floor placed at the wrong position bounds vouching and eviction at the wrong "
    + "point, and both of those delete things");
}

// ── PART C — ordered by position, never by the private counter ───────────────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => OWNER, trimmed: () => false });
  const older = sealAt(sb, 4, "@own:hs", OWNER);
  older.n = 99;                                    // a peer that seals often
  const newer = sealAt(sb, 8, "@own2:hs", OWNER);
  newer.n = 1;                                     // a fresher floor, lower counter
  sb.Floor.remember(older, OWNER, "@own:hs");
  sb.Floor.remember(newer, OWNER, "@own2:hs");
  const sel = sb.Floor.select(OWNER, {}, () => true);
  ok(sel && sel.floor.floorL === newer.floorL,
    "C: `n` counts from whatever its author last trusted, so it is incomparable across authors — a "
    + "peer that seals often would otherwise outrank a fresher floor forever",
    { got: sel && sel.floor.floorL, want: newer.floorL });
}

// ── PART D — an owner floor is adopted on authority, with NO recompute ───────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });
  const cp = sealAt(sb, 6, "@own:hs", OWNER);
  sb.Floor.remember(cp, OWNER, "@own:hs");
  let chainCalled = false;
  const sel = sb.Floor.select(STAFF, {}, () => { chainCalled = true; return false; });
  ok(sel && sel.tier === 0,
    "D: an owner floor ends the search immediately, even with chaining refusing everything", sel);
  ok(chainCalled === false,
    "D: APPLIED — and the chain check is never even consulted. This asymmetry was raised and "
    + "DECIDED; the containment for a bad owner floor is a later owner recompute, then the social "
    + "path. Do not close it here");
  ok(sel.verified === false, "D: and it is honestly marked as adopted-not-verified");
}

// ── PART E — a floor from below me never binds me ────────────────────────────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => OWNER, trimmed: () => false });
  const cp = sealAt(sb, 6, "@staff:hs", STAFF);
  sb.Floor.remember(cp, STAFF, "@staff:hs");
  const sel = sb.Floor.select(OWNER, {}, () => true);
  ok(sel === null,
    "E: the owner accepts tier 0 only. 'The owner trusts nobody' is not a special case — it is the "
    + "walk refusing everything below the observer", sel);

  // WHERE THIS RULE IS ACTUALLY ENFORCED — traced by mutation, two layers deep.
  //   · deleting Floor's own `t > myTier` skip           -> still refused
  //   · deleting substituteTrusted's `t > myTier` break   -> STILL refused
  // Both are early exits. The enforcement is TrustPolicy._countDistinct, which skips any entry
  // whose tier is below the observer's, so a staff entry is invisible at row 0 whatever the two
  // layers above it do. Three statements of one rule, and only the innermost is load-bearing.
  //
  // That is worth knowing rather than tidying: each layer states the rule where a reader is
  // deciding what that layer means. What must not happen is a future reader assuming the outer
  // two are the enforcement — which is exactly the mistake the old tree's `earnsForget` invited.
  // So the assertion below is on the BEHAVIOUR, which survives all three, rather than on any one
  // of the clauses.
  ok(sb.TrustPolicy.substituteTrusted([{ u: "@s:hs", r: STAFF }], {}, OWNER) === null,
    "E: APPLIED at the enforcing layer — the trust seam refuses a staff quorum for an owner "
    + "observer, whatever the walk above it does");
  ok(sb.TrustPolicy.substituteTrusted([{ u: "@o:hs", r: OWNER }], {}, STAFF) === 0,
    "E: APPLIED — while a floor from ABOVE binds a lower observer, so the refusal is directional "
    + "rather than a blanket rejection");
}

// ── PART F — retraction is conditional ───────────────────────────────────────────────────────
{
  // (i) still holding history -> withdraw
  const a = tree();
  let trimmedA = false;
  a.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF,
                   trimmed: () => trimmedA });
  a.Floor._setTrustedForTest({ n: 1, seed: {}, h: "x", covers: "$a..$b", floorL: 3, grade: "quorum" });
  const rA = a.Floor.revalidate();
  ok(rA.moved === true && rA.reason === "withdrawn",
    "F: a quorum floor that stops verifying, while we still hold our history, is WITHDRAWN — "
    + "falling back to folding what we have is safe", rA);
  ok(a.Floor.current() === null, "F: APPLIED — and it is gone");

  // (ii) already forgotten below it -> demote, never withdraw
  const b = tree();
  const bEmits = [];
  b.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF,
                   trimmed: () => true });
  b.Floor.onChange((e) => bEmits.push(e));
  b.Floor._setTrustedForTest({ n: 1, seed: {}, h: "x", covers: "$a..$b", floorL: 3, grade: "quorum" });
  const rB = b.Floor.revalidate();
  ok(rB.moved === true && rB.reason === "demoted-stale",
    "F: APPLIED — but a client that has ALREADY FORGOTTEN below it must not withdraw: that would "
    + "leave it with no state at all, since vouch records carry no sender", rB);
  ok(b.Floor.current() !== null && b.Floor.grade() === "stale",
    "F: APPLIED — it is kept as the compute base, graded stale", b.Floor.grade());
  ok(bEmits.some((e) => e.kind === "demoted"),
    "F: APPLIED — and a re-page is ANNOUNCED. This asserted a `needsRepage()` flag instead, with "
    + "the reasoning that a flag nobody reads is this codebase's signature bug 'so the flag is the "
    + "module's own and askable' — but nothing ever asked it, which made the assertion the very "
    + "shape it cited. The flag is deleted (J02) and the emission is what the subscriber reads");
}

// ── PART G — only a proved grade earns forgetting ────────────────────────────────────────────
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });
  for (const [g, expect] of [["real", true], ["verified", true], ["quorum", true],
                             ["stale", false], [null, false]]) {
    sb.Floor._setTrustedForTest(g ? { grade: g, floorL: 1 } : null);
    ok(sb.Floor.earnsForget() === expect,
      "G: grade " + g + " earns forgetting = " + expect, { grade: g, got: sb.Floor.earnsForget() });
  }
}

// ── PART H — vouching can be bounded by the floor ────────────────────────────────────────────
// Asserted against position(), which is the door PRODUCTION uses at all twelve floor reads. This
// part used to ask Floor.boundFor("vouch") — a synonym that no production code called, so the
// guard was exercising a path the app never took. A guard on a module is not a guard on the
// wiring; boundFor is deleted and the assertion now drives the real one.
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });
  sb.Floor._setTrustedForTest({ grade: "verified", floorL: 42, seed: {}, h: "x", covers: "$a..$b" });
  ok(sb.Floor.position() === 42,
    "H: the floor is ASKABLE, so vouching can stop protecting what a checkpoint already banked. "
    + "In the old tree the floor was never passed in, so that bound was never applied and the work "
    + "grew with the age of the room", sb.Floor.position());
  sb.Floor._setTrustedForTest(null);
  ok(sb.Floor.position() === sb.Floor.NO_FLOOR,
    "H: and with no floor it bounds nothing rather than guessing — the NO_FLOOR sentinel read from "
    + "the module rather than restated as -1 here, so a guard cannot agree with a value the module "
    + "has stopped using", { position: sb.Floor.position(), NO_FLOOR: sb.Floor.NO_FLOOR });
  ok(sb.Floor.boundFor === undefined,
    "H: boundFor is gone rather than merely unused. A dead synonym left exported is a door a "
    + "future caller can take, and the next reader cannot tell it from a deliberate seam",
    typeof sb.Floor.boundFor);
}

// ── PART I — A SEGMENT IS FOLDED ONTO WHAT IT CLAIMS TO CONTINUE FROM, NEVER FROM EMPTY ──────
// This part used to assert the rule against Floor.computesThrough / _priorStateFor, which existed
// only to re-verify a floor loaded from disk. That path is deleted (see check-floor-reload), and
// for one turn the rule was left unasserted anywhere — which is how a rule comes back. It is
// re-homed here against chainVerifies, the surviving fold, where it is a live property rather than
// a historical one.
//
// WHY THE RULE MATTERS. Folding from empty is an ANSWER, and a wrong one: it makes the check agree
// with any author who also folded from empty, i.e. every author who has forgotten anything — so it
// returns true for precisely the floors it exists to reject. "Cannot establish" must stay distinct
// from "verified".
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });

  const segA = LOG.slice(0, 5);
  const lastA = segA[segA.length - 1];
  const cpA = { n: 1, prev: null, seed: sb.StateDeriver.buildSeed(segA), thin: false,
                covers: sb.CheckpointFormat.coversOf(segA[0].eventId, lastA.eventId), floorL: lastA.l };
  cpA.h = sb.Floor.fingerprint(cpA.n, cpA.prev, cpA.seed, cpA.floorL, cpA.thin, cpA.covers);

  // The JOINING SEGMENT — everything since cpA's cut — chained onto cpA's state.
  const segB = LOG.slice(5, 8);
  const lastB = segB[segB.length - 1];
  const chained = { n: 2, prev: cpA.h, seed: sb.StateDeriver.buildSeed(segB, cpA.seed), thin: false,
                    covers: sb.CheckpointFormat.coversOf(segB[0].eventId, lastB.eventId), floorL: lastB.l };
  chained.h = sb.Floor.fingerprint(chained.n, chained.prev, chained.seed, chained.floorL, chained.thin, chained.covers);

  // A THIRD LINK, and it is not padding. With only two checkpoints the loop body runs once and the
  // carried state is never read again, so a chain that FAILS TO ADVANCE its state between links
  // verifies anyway — mutation found exactly that, and a two-link fixture could not see it.
  const segC = LOG.slice(8, 12);
  const lastC = segC[segC.length - 1];
  const third = { n: 3, prev: chained.h, seed: sb.StateDeriver.buildSeed(segC, chained.seed), thin: false,
                  covers: sb.CheckpointFormat.coversOf(segC[0].eventId, lastC.eventId), floorL: lastC.l };
  third.h = sb.Floor.fingerprint(third.n, third.prev, third.seed, third.floorL, third.thin, third.covers);

  ok(sb.Floor.chainVerifies([cpA, chained, third], LOG) === true,
    "I: setup — an honestly chained trio verifies (probe applied: the fold is actually reached, "
    + "and a false result below would otherwise be indistinguishable from a fixture that never ran)");

  // AND THE CHAIN ORDERS ITSELF BY POSITION. Checkpoints arrive in whatever order the log hands
  // them over, which is not the order they seal in. Mutation found this unasserted: a fixture that
  // happens to pass them in order cannot tell whether the sort is doing anything.
  ok(sb.Floor.chainVerifies([third, cpA, chained], LOG) === true,
    "I: APPLIED — the same trio shuffled still verifies, because the chain sorts by POSITION "
    + "rather than trusting arrival order. Position means the same thing to every author; `n` does "
    + "not, so ordering by it would break honest chains between peers who seal at different rates");

  // THE RULE. Same events, same cut, same author — folded from EMPTY instead of from cpA's state.
  const fromEmpty = Object.assign({}, chained, { seed: sb.StateDeriver.buildSeed(segB) });
  fromEmpty.h = sb.Floor.fingerprint(fromEmpty.n, fromEmpty.prev, fromEmpty.seed, fromEmpty.floorL,
                                     fromEmpty.thin, fromEmpty.covers);
  ok(sb.Floor.chainVerifies([cpA, fromEmpty, third], LOG) === false,
    "I: APPLIED — a checkpoint that folded its segment from EMPTY does not chain. The chain seeds "
    + "from the previous checkpoint's OWN seed, so an author who had forgotten what came before "
    + "cannot have their amnesia confirmed by anyone who had also forgotten it");

  // AND A FOLD IT CANNOT PERFORM IS NOT A FOLD IT PASSES. Asked against a log that does not contain
  // the joining segment, the honest pair must still be refused: not holding the events is "cannot
  // establish", and cannot establish is never verified.
  ok(sb.Floor.chainVerifies([cpA, chained, third], LOG.slice(5)) === false,
    "I: APPLIED — with the joining segment not held, the same honest pair is REFUSED rather than "
    + "waved through. A refusal to check is not a pass");
}

// ── PART I2 — TWO HONEST PEERS SEALING THE SAME CUT ──────────────────────────────────────────
// Ported from check-segment-floor, where it was the only home for a rule the whole verification
// method rests on:
//
//   AGREEMENT IS RECOMPUTATION, NEVER FINGERPRINT COMPARISON.
//
// A checkpoint's `h` commits its author's own private bookkeeping — their seal counter `n`, and the
// `prev` of whatever floor THEY were chained onto. Two peers who folded the very same events to the
// very same state therefore produce DIFFERENT fingerprints. Comparing them would reject honest
// peers as a fork, and the room would tear itself apart on agreement.
//
// What must match is the SEED. That is what chainVerifies checks, by folding forward and requiring
// the result to reproduce the next author's claim.
{
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF, trimmed: () => false });

  const seg = LOG.slice(0, 7);
  const last = seg[seg.length - 1];
  const seed = sb.StateDeriver.buildSeed(seg);
  const covers = sb.CheckpointFormat.coversOf(seg[0].eventId, last.eventId);

  // Same cut, same fold — different private bookkeeping. `n` counts from whatever each author last
  // trusted, so it is incomparable across authors by construction.
  const a = { n: 1,  prev: null,   seed: seed, covers: covers, floorL: last.l, thin: false };
  const b = { n: 47, prev: "$xyz", seed: seed, covers: covers, floorL: last.l, thin: false };
  a.h = sb.CheckpointFormat.fingerprint(a.n, a.prev, a.seed, a.floorL, a.thin, a.covers);
  b.h = sb.CheckpointFormat.fingerprint(b.n, b.prev, b.seed, b.floorL, b.thin, b.covers);

  ok(JSON.stringify(a.seed) === JSON.stringify(b.seed),
    "I2: two honest peers folding the same events reach the SAME state — that is the thing that "
    + "actually has to agree");
  ok(a.h !== b.h,
    "I2: APPLIED — and produce DIFFERENT fingerprints, because `h` commits each author's own seal "
    + "counter and chain. Comparing fingerprints to test agreement would reject honest peers as a "
    + "fork and tear the room apart on agreement", { a: a.h.slice(0, 12), b: b.h.slice(0, 12) });

  ok(sb.CheckpointFormat.verify(a) && sb.CheckpointFormat.verify(b),
    "I2: both are internally consistent, so neither is malformed — the difference is not damage");
}

// ── PART J — THIN JOIN: fetch what you need to VERIFY ────────────────────────────────────────
// "To verify" is the whole clause. Paging is the slow part, so "three high-staff already said so,
// and paging would only confirm it" is the shortcut that turns the cascade into trust-by-assertion
// at every level — every tier resting on the tier above having checked, and nobody having checked.
{
  // An OWNER floor costs no paging at all. In a room with a live owner-bot this is the ordinary
  // case, which is what makes thin joining nearly free.
  const sb = tree();
  sb.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => STAFF,
                    trimmed: () => false });
  const cp = sealAt(sb, 6, "@own:hs", OWNER);
  sb.Floor.remember(cp, OWNER, "@own:hs");
  let pagerCalls = 0;
  const pager = async () => { pagerCalls++; return LOG; };

  return sb.Floor.thinJoin(pager).then((r) => {
    ok(r.mode === "owner" && r.paged === 0 && pagerCalls === 0,
      "J: an owner floor is adopted on authority with ZERO paging — the cheap path is the common "
      + "one", r);

    // A SUBSTITUTE must page and chain. A pager that returns nothing adopts nothing.
    const sb2 = tree();
    sb2.Floor.attach({ log: () => LOG, settings: () => ({}), myRank: () => HS,
                       trimmed: () => false });
    sb2.Floor.remember(sealAt(sb2, 4, "@hs1:hs", HS), HS, "@hs1:hs");
    sb2.Floor.remember(sealAt(sb2, 6, "@hs2:hs", HS), HS, "@hs2:hs");
    sb2.Floor.remember(sealAt(sb2, 8, "@hs3:hs", HS), HS, "@hs3:hs");

    const span = sb2.Floor._quorumSpan();
    ok(span && span.fromL <= span.toL,
      "J: the paging span is bounded by the quorum's own cuts — segment length, not history length. "
      + "That is what makes chaining the verification method a thin client can actually run", span);

    return sb2.Floor.thinJoin(async () => []).then((empty) => {
      ok(empty.mode === "none" && empty.reason === "page-empty",
        "J: APPLIED — A REFUSAL TO CHECK IS NOT A PASS. A pager that returns nothing adopts "
        + "nothing, rather than falling back to somebody's word", empty);
      return sb2.Floor.thinJoin(null);
    }).then((noPager) => {
      ok(noPager.mode === "none" && noPager.reason === "no-pager",
        "J: and with no pager at all it says so, rather than adopting unverified", noPager);

      // THE CASE THAT MAKES THE CHAIN CHECK LOAD-BEARING. A first version tested only the failure
      // paths — empty pager, no pager — so forcing chain verification to always succeed changed
      // nothing and the check was asserted by nobody. What matters is a pager that RETURNS events
      // which do not let the quorum chain: paging is not the point, VERIFYING is.
      return sb2.Floor.thinJoin(async () => LOG.slice(-2));
    }).then((wrongEvents) => {
      ok(wrongEvents.mode === "none" && wrongEvents.reason === "unverified",
        "J: APPLIED — events were fetched, and the quorum still does not chain through them, so "
        + "NOTHING is adopted. 'They already said so and paging would only confirm it' is exactly "
        + "the shortcut that turns the cascade into trust-by-assertion at every level",
        wrongEvents);
      done();
    });
  });
}

function done() {
console.log("[floor] PASS — the floor is one concept with one owner: it is ADOPTED from an arriving "
  + "checkpoint and adopting ANNOUNCES itself, because in the old tree the most consequential "
  + "state change in the system told nobody; a quorum is adopted at its OLDEST cut and ordered by "
  + "position rather than by any author's private counter; an owner floor ends the search on "
  + "authority with the chain check never consulted, and a floor from below the observer never "
  + "binds it; retraction withdraws while history is held and demotes to stale once it is not; "
  + "only a proved grade earns forgetting; two honest peers folding the same events reach the same "
  + "state but different fingerprints, so agreement is tested on the fold; the chain seeds from the "
  + "previous checkpoint's OWN seed and orders itself by position, so a segment folded from EMPTY "
  + "does not chain and an author's amnesia cannot be confirmed by anyone who shared it, while a "
  + "joining segment we do not hold is REFUSED rather than waved through; and the floor is askable "
  + "so vouching can finally be bounded by it. It is NOT persisted — that path is deleted, and its "
  + "absence is check-floor-reload's question, not this guard's");
}
}
