// tests/check-continuity.js
// WALL: A CLIENT THAT KNOWS IT IS MISSING HISTORY MUST NOT ADVANCE — BUT ONLY WHEN IT KNOWS.
//
// This is the sixth concept, and it exists because of what a deletion actually does. A deleted
// event is recoverable as CONTENT but not as HISTORY: a record carries the bytes and the
// fingerprint, never the author, and the reducer needs an author. So two clients — one who saw the
// event and one who did not — cannot be reconciled by vouching at all, and each will correctly
// refuse the other's advances. That is a permanent fork, and the only way to prevent it is for the
// short client to hold still.
//
// PART A — detect: chain parents only, and that is deliberate.
// PART B — a vouch record IS corroboration. Somebody demonstrably held the bytes.
// PART C — a SINGLE builder is NOT corroboration. This was a real bug: the rule was circular.
// PART D — several distinct builders IS corroboration.
// PART E — the restraint: corroborated short -> hold still. Uncorroborated -> keep going.
// PART F — it emits, so the response can live elsewhere. Detection is not response.
// PART G — a stuck gap has a DEFINED trigger, which is what re-anchor was missing.
// PART H — unattached fails visibly rather than quietly working.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

function fail(m, g) { console.log("[continuity] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const STAFF = F.RANK.staff, GUEST = F.RANK.guest;
function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js", "backends/backend1/continuity.js",
  ], {});
}
// STAFF by default — a rank whose word counts. Parts C and D are about HOW MANY, so they must not
// accidentally be about rank as well.
const child = (id, l, parent, sender, rank) =>
  F.rawEvent(id, l, 1000, sender || "@a:hs", (rank === undefined ? STAFF : rank), { t: "ddjp.dj.play", p: parent });
const bundle = (id, l, sender, ids) =>
  F.rawEvent(id, l, 2000, sender, STAFF, { t: "ddjp.witness.bundle",
    w: ids.map((i) => ({ i: i, l: 1, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF })) });

// ── PART A — detect ──────────────────────────────────────────────────────────────────────────
{
  const sb = tree();
  const held = [child("$c", 10, "$missing")];
  ok(sb.Continuity.missingParents(held).indexOf("$missing") >= 0,
    "A: a held event naming a parent I do not hold is a gap I can SEE. I do not need to be told");
  ok(sb.Continuity.missingParents([child("$c", 10, "$p"), child("$p", 9, null)]).length === 0,
    "A: holding the parent means no gap");

  const withVouchRef = F.rawEvent("$v", 11, 1000, "@a:hs", STAFF,
    { t: "ddjp.witness.bundle", w: [{ i: "$never-held", l: 1, d: {}, h: "x", r: STAFF }] });
  ok(sb.Continuity.missingParents([withVouchRef]).length === 0,
    "A: APPLIED — CHAIN PARENTS ONLY. A vouch reference means 'this exists', not 'you need it'. "
    + "Treating every one as a gap makes a partial client demand a pile of events it never held "
    + "and never needed");
}

// ── PART B — a record is proof ───────────────────────────────────────────────────────────────
{
  const sb = tree();
  const held = [child("$c", 10, "$gone"), bundle("$b", 11, "@w:hs", ["$gone"])];
  const c = sb.Continuity.corroboration("$gone", held);
  ok(c.vouchedBy === 1 && c.corroborated === true,
    "B: a VOUCH RECORD is proof the parent existed — whoever wrote it demonstrably held the bytes, "
    + "and it cannot be produced by someone who invented the id", c);
}

// ── PART C — a single builder is NOT corroboration ───────────────────────────────────────────
{
  const sb = tree();
  const only = [child("$c", 10, "$claimed", "@one:hs")];
  const c = sb.Continuity.corroboration("$claimed", only);
  ok(c.builtOnBy === 1 && c.corroborated === false,
    "C: APPLIED — ONE event naming a parent is the CLAIM, not evidence for it. An earlier version "
    + "of this rule counted it, which was circular: a single fabricated advance corroborated itself "
    + "and froze the room. Caught by stress-testing, not by reading", c);
}

// ── PART D — several distinct builders is corroboration ──────────────────────────────────────
{
  const sb = tree();
  const two = [child("$c1", 10, "$claimed", "@one:hs"), child("$c2", 11, "$claimed", "@two:hs")];
  ok(sb.Continuity.corroboration("$claimed", two).corroborated === true,
    "D: two INDEPENDENT authors both building on it is evidence — a fabricator would have to "
    + "persuade a second party to build on their invention. Same distinct-people shape the vouch "
    + "bar and the checkpoint quorum use");
  const sameTwice = [child("$c1", 10, "$claimed", "@one:hs"), child("$c2", 11, "$claimed", "@one:hs")];
  ok(sb.Continuity.corroboration("$claimed", sameTwice).corroborated === false,
    "D: APPLIED — but the SAME author twice is still one author. Counting messages rather than "
    + "people would make the bar free to clear");
}

// ── PART D2 — corroboration respects the STRUCTURAL FLOOR ────────────────────────────────────
// The property the whole design rests on: "a room of only uncategorized accounts cannot
// manufacture authority — not because the threshold is high, but because they are structurally
// excluded." Freezing the room IS manufacturing an effect, and with no rank filter this module had
// quietly become the one place quantity at the bottom added up to something.
//
// It matters more than it looks, because a record does NOT prove existence: verifyRecord checks
// that a delta hashes to its own fingerprint, so anyone can invent content, hash it, and publish a
// valid record naming any id at all. "Somebody vouched it" is evidence about the publisher.
{
  const sb = tree();
  const invented = { t: "ddjp.dj.play", p: "$whatever" };
  const forged = { i: "$NEVER", l: 5, d: invented,
                   h: sb.Vouch.fingerprint(Object.assign({ l: 5 }, invented)), r: 0 };
  ok(sb.Vouch.verifyRecord(forged) === true,
    "D2: a record for an event that NEVER EXISTED still verifies — it proves self-consistency, not "
    + "existence. That is why rank has to carry the weight here");

  const sybils = [child("$a", 1, "$FAKE", "@s1:hs", F.RANK.uncat),
                  child("$b", 2, "$FAKE", "@s2:hs", F.RANK.uncat)];
  const c = sb.Continuity.corroboration("$FAKE", sybils, {});
  ok(c.corroborated === false && c.ignoredBelowFloor === 2,
    "D2: APPLIED — two throwaway accounts cannot corroborate anything, so they cannot stop the "
    + "room. The vouch table already says which ranks satisfy nothing; corroboration reuses that "
    + "rather than inventing a second rule", c);

  const vips = [child("$a", 1, "$REAL", "@v1:hs", F.RANK.vip),
                child("$b", 2, "$REAL", "@v2:hs", F.RANK.vip)];
  ok(sb.Continuity.corroboration("$REAL", vips, {}).corroborated === true,
    "D2: APPLIED — while two ranks whose word counts DO corroborate. The floor is structural, not "
    + "a threshold that can be out-counted");

  // Deliberately more permissive than "my rank or above", and that is a decision.
  ok(sb.Continuity.corroboration("$REAL", vips, {}).corroborated === true,
    "D2: and it is NOT observer-relative: yielding wrongly costs a short wait that unsticks itself, "
    + "while failing to yield costs a permanent fork nothing reconciles. The asymmetry is why this "
    + "takes the structural floor rather than the observer's own bar");
}

// ── PART D3 — PROOF OUTRANKS RANK ────────────────────────────────────────────────────────────
// "Floor nothing on vouching: hash-verified content needs no rank — someone uncategorized who kept
// the bytes is an ideal source. Rank-weight only what the hash cannot reach."
//
// So the order is proof, then evidence, then rank. Deciding by rank FIRST would mean a provable
// event went unproven because whoever supplied it was junior, which inverts the point of hashing
// anything.
{
  const sb = tree();
  const pb = { t: "ddjp.dj.join", v: "abcdefghijk", l: 5 };
  const rec = sb.Vouch.record(F.rawEvent("$p", 5, 1000, "@a:hs", STAFF, pb));
  const anchor = F.rawEvent("$c", 6, 2000, "@b:hs", F.RANK.uncat,
    { t: "ddjp.dj.play", p: "$p", pHash: sb.Vouch.commitFor(pb) });
  const supplied = F.rawEvent("$w", 7, 3000, "@lowly:hs", F.RANK.uncat,
    { t: "ddjp.witness.bundle", w: [rec] });

  const c = sb.Continuity.corroboration("$p", [anchor, supplied], {});
  ok(c.proven === true && c.via === "record-matches-anchor" && c.corroborated === true,
    "D3: APPLIED — an UNCATEGORIZED client supplying a record that matches a held anchor PROVES "
    + "the event. Arithmetic is not out-votable, so the structural rank floor does not apply here "
    + "and must not", c);

  const fb = { t: "ddjp.dj.play", p: "$x" };
  const forged = { i: "$FAKE", l: 5, d: fb, h: sb.Vouch.fingerprint(Object.assign({ l: 5 }, fb)), r: 0 };
  const fake = sb.Continuity.corroboration("$FAKE", [
    F.rawEvent("$c2", 6, 2000, "@s1:hs", F.RANK.uncat, { t: "ddjp.dj.play", p: "$FAKE", pHash: "invented" }),
    F.rawEvent("$w2", 7, 3000, "@s2:hs", F.RANK.uncat, { t: "ddjp.witness.bundle", w: [forged] }),
  ], {});
  ok(fake.proven === false && fake.corroborated === false,
    "D3: APPLIED — while forging BOTH the record and the anchor still fails: the record does not "
    + "match, and neither sybil's rank counts. Both doors are shut", fake);

  // two independent authors committing the SAME hash is the weaker proof, and one is not
  const two = [
    F.rawEvent("$x1", 6, 1, "@one:hs", STAFF, { t: "ddjp.dj.play", p: "$q", pHash: "H" }),
    F.rawEvent("$x2", 7, 2, "@two:hs", STAFF, { t: "ddjp.dj.play", p: "$q", pHash: "H" }),
  ];
  ok(sb.Continuity.corroboration("$q", two, {}).via === "independent-anchors-agree",
    "D3: two DIFFERENT authors committing the same hash is proof of a weaker kind — they would "
    + "have had to agree on the exact value in advance");
  ok(sb.Continuity.corroboration("$q", [two[0]], {}).proven === false,
    "D3: APPLIED — but ONE anchor is not. A single author can stamp any hash for a parent they "
    + "invented and nobody can contradict them. Same circularity as one builder");
}

// ── PART D4 — MATRIX FIRST ───────────────────────────────────────────────────────────────────
// The homeserver's signature is stronger than anything built on top of it. A tombstone says "this
// existed here, by them, and was deleted" — which is exactly the question this module asks, and it
// settles it WITHOUT content: knowing an event was real is enough to know I am behind.
{
  const sb = tree();
  sb.Vouch.forgetTombstones();
  const bare = [child("$c", 10, "$gone", "@a:hs", F.RANK.uncat)];
  ok(sb.Continuity.corroboration("$gone", bare, {}).corroborated === false,
    "D4: with nothing but one uncategorized claim, the gap is not corroborated");

  sb.Vouch.rememberTombstone({ id: "$gone", sender: "@dj:hs", rank: STAFF, roomId: "!ev", ts: 1 });
  const c = sb.Continuity.corroboration("$gone", bare, {});
  ok(c.proven === true && c.via === "matrix-tombstone",
    "D4: APPLIED — the same evidence plus a TOMBSTONE is conclusive. Matrix already knows the "
    + "event existed; no rank, no quorum and no content are needed to establish that", c);
  sb.Vouch.forgetTombstones();
}

// ── PART E — the restraint ───────────────────────────────────────────────────────────────────
{
  const sb = tree();
  ok(sb.Continuity.mayAdvance([child("$c", 10, "$p"), child("$p", 9, null)], {}, -1).state === "whole",
    "E: no gaps -> advance freely");

  const short = sb.Continuity.mayAdvance([child("$c", 10, "$gone"), bundle("$b", 11, "@w:hs", ["$gone"])], {}, -1);
  ok(short.ok === false && short.state === "short",
    "E: APPLIED — a CORROBORATED gap means HOLD STILL. Advancing here creates a branch the other "
    + "side can never accept, and each side is right to refuse the other. The fork is PREVENTED "
    + "rather than repaired", short);

  const suspect = sb.Continuity.mayAdvance([child("$c", 10, "$fabricated", "@grief:hs", GUEST)], {}, -1);
  ok(suspect.ok === true && suspect.state === "suspect",
    "E: APPLIED — an UNCORROBORATED gap must not stop anybody. One message naming an invented "
    + "parent would otherwise freeze the room, which is the denial of service the restraint "
    + "invites if corroboration is not required", suspect);
  ok(suspect.suspect.indexOf("$fabricated") >= 0,
    "E: and it is flagged rather than ignored, so a real gap is still visible");
}

// ── PART F — it emits ────────────────────────────────────────────────────────────────────────
{
  const sb = tree();
  const seen = [];
  let held = [child("$c", 10, "$gone")];
  // LIVE, because the check now refuses to run while catching up — a client folding a backlog is
  // missing history BY DEFINITION, so running it then reports a phantom gap for every event that
  // has not arrived yet, and tells a client that is merely behind to hold still for a reason that
  // resolves itself in seconds.
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Continuity.attach({ held: () => held });
  sb.Continuity.onChange((e) => seen.push(e));

  sb.Continuity.check();
  ok(seen.some((e) => e.kind === "gap-opened"), "F: a new gap is announced", seen);

  held = held.concat([bundle("$b", 11, "@w:hs", ["$gone"])]);
  sb.Continuity.check();
  ok(seen.some((e) => e.kind === "gap-corroborated"),
    "F: APPLIED — and a gap BECOMING corroborated is its own event, because it turns 'keep going "
    + "and flag it' into 'hold still'. That is the moment the question stops being open", seen);

  held = held.concat([child("$gone", 9, null)]);
  sb.Continuity.check();
  ok(seen.some((e) => e.kind === "gap-filled"),
    "F: APPLIED — and filling it is announced too, so whatever yielded knows it may resume. "
    + "Detection is not response: this module never advances, never repairs and never adopts");
}

// ── PART G — a stuck gap has a defined trigger ───────────────────────────────────────────────
{
  const sb = tree();
  const held = [child("$c", 10, "$gone"), bundle("$b", 11, "@w:hs", ["$gone"])];
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Continuity.attach({ held: () => held });
  for (let i = 0; i < sb.Continuity.STUCK_CYCLES + 1; i++) sb.Continuity.check();
  ok(sb.Continuity.stuckGaps().indexOf("$gone") >= 0,
    "G: APPLIED — a CORROBORATED gap that will not fill after N cycles is reported STUCK. This is "
    + "the trigger the re-anchor rule was missing: 'a corroborated gap that will not fill' is a "
    + "defined cause, where 'an unfillable gap' never was", sb.Continuity.stuckGaps());

  const fresh = tree();
  const un = [child("$c", 10, "$fabricated")];
  fresh.Session._setPhaseForTest(fresh.Session.LIVE);
  fresh.Continuity.attach({ held: () => un });
  for (let i = 0; i < fresh.Continuity.STUCK_CYCLES + 3; i++) fresh.Continuity.check();
  ok(fresh.Continuity.stuckGaps().length === 0,
    "G: APPLIED — an UNCORROBORATED gap never becomes stuck however long it persists, so a "
    + "griefer cannot drive the room to re-anchor by naming a parent that never existed");
}

// ── PART H — unattached fails visibly ────────────────────────────────────────────────────────
{
  const sb = tree();
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  const r = sb.Continuity.check();
  ok(r.ok === false && r.state === "unattached",
    "H: APPLIED — a module nobody wired says so. It does NOT quietly work off whatever global "
    + "happens to be loaded, which is how a guard that forgot to attach passes for the wrong "
    + "reason — this codebase's signature failure", r);
}

// ── PART I — not while catching up, and not below the floor ──────────────────────────────────
// Both found by reading rather than by a failing test, and both would have produced a client that
// holds still for no reason.
{
  const sb = tree();
  const held = [child("$c", 10, "$gone"), bundle("$b", 11, "@w:hs", ["$gone"])];
  sb.Continuity.attach({ held: () => held });

  sb.Session._setPhaseForTest(sb.Session.CATCHING_UP);
  const mid = sb.Continuity.check();
  ok(mid.ok === false && mid.state === "not-live",
    "I: APPLIED — a client folding a backlog is missing history BY DEFINITION. Asking 'am I whole?' "
    + "then reports a gap for every event that has not arrived yet, and tells a client that is "
    + "merely behind to hold still over something that resolves itself in seconds", mid);

  sb.Session._setPhaseForTest(sb.Session.LIVE);
  ok(sb.Continuity.check().state === "short", "I: and once live it answers properly");

  const banked = tree();
  banked.Session._setPhaseForTest(banked.Session.LIVE);
  banked.Continuity.attach({ held: () => held, floorL: () => 50 });
  ok(banked.Continuity.check().state === "whole",
    "I: APPLIED — a reference to an event BELOW a floor is not a hole, it is history a checkpoint "
    + "already banked. Without this bound, adopting a floor and forgetting below it would make "
    + "every reference across the boundary look like a gap, and a client would hold still forever "
    + "over events it deliberately dropped");
}

console.log("[continuity] PASS — a client that knows it is missing history holds still, and only "
  + "then: gaps are chain parents only, because a vouch reference means 'this exists' rather than "
  + "'you need it'; a record is proof the parent was real, one builder is only the claim itself "
  + "(a circularity caught by stress-testing) and several distinct builders is evidence; a "
  + "corroborated gap stops the client so the fork never forms, while an uncorroborated one must "
  + "not, or one invented parent freezes everybody; every transition is emitted so the response "
  + "lives elsewhere; a corroborated gap that will not fill becomes STUCK, which is the trigger "
  + "re-anchor never had; and an unwired module says so instead of pretending");
