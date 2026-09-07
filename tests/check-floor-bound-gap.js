// tests/check-floor-bound-gap.js
//
// THE FLOOR BOUND MUST NOT INVENT A HOLE OUT OF AN EVENT WE ARE HOLDING.
//
// Continuity answers "am I whole, and may I act on it". It is bounded by the floor for a good
// reason: an event at or below an adopted floor is BANKED, a checkpoint summarised it, and a
// reference across that boundary is history that has been accounted for rather than a hole.
//
// The bound was applied to the wrong thing. It filtered the HELD SET, and the missing-parent scan
// then built its "what do I have" index from that same filtered list — so every event at or below
// the floor became invisible to the question "do I hold this?", not merely exempt from being
// demanded. The floor's own boundary event is the one every later advance chains onto, by
// construction, so the very act of adopting a floor manufactured a missing parent pointing at an
// event sitting in the cache the whole time.
//
// AND IT WAS ALWAYS "CORROBORATED". Two distinct clients commit the same parent hash for it — a
// vote and the next skip, which is ordinary traffic — so the arithmetic proof fires
// ("independent-anchors-agree"), the gap counts as real, and the client is told to HOLD STILL.
// Permanently: nothing can ever fill a gap that was never a gap.
//
// Observed live, and the log said so in as many words once it was asked to:
//     Playback: ADVANCE pi=$oNZCF... — HELD — missing-history (short)
// Every client that adopted the floor stopped advancing, which is why a song hung for the whole
// room rather than for one person. The restraint is meant to stop a SHORT client forking the room;
// here it stopped a client that was completely whole.
//
// THE RULE, stated so it cannot drift again: WHAT I HOLD is a fact about my cache and is answered
// against everything in it. WHAT I MAY BE DEMANDED TO HOLD is a policy question and is what the
// floor bounds. They are different questions and only the second one has a floor in it.
//
// GUARANTEES:
//   PART A — REPRODUCES IT. With a floor adopted, an event we hold at that floor is not reported
//     missing, and the client is not told it is short.
//   PART B — A BANKED PARENT IS NOT A HOLE. A parent we do NOT hold because a checkpoint banked it
//     below the floor is exempt — named EXACTLY rather than guessed at by position, because an
//     event we do not hold has no position we can check.
//   PART F — ONLY AN ADVANCE CHAINS. A vote or a save carries `p` too, and that is an annotation
//     target rather than a structural need. The rule was already written down and the code was
//     broader than its own rule.
//   PART C — A REAL GAP ABOVE THE FLOOR STILL STOPS THE CLIENT. The anti-fork restraint is
//     narrowed, never deleted.
//   PART D — EVIDENCE IS NOT BOUNDED EITHER. Corroboration is arithmetic about whether an event
//     existed; a record or an anchor is evidence wherever it sits, and hiding half the cache from
//     the question makes the answer worse rather than safer.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[floor-bound-gap] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const sb = loadInContext([
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/scheduler.js",
  "backends/backend1/vouch.js", "backends/backend1/continuity.js",
], { Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout });
const { Continuity } = sb;

const ROOM = "!r:hs";
function raw(id, l, sender, rank, body) {
  return { event_id: id, type: "m.room.message", sender: sender, senderRank: rank,
           l: l, ts: l * 1000, room_id: ROOM,
           content: { body: JSON.stringify(Object.assign({ l: l }, body)) } };
}

// The shape of an ordinary room the moment a floor lands: the boundary event is a play, and the
// traffic just above it — a vote and the next skip, from two different people — chains onto it.
function roomAtFloor() {
  return [
    raw("$playAtFloor", 44, "@dj:hs", 100, { t: "ddjp.dj.play", p: "$older" }),
    raw("$vote", 48, "@p:hs", 0, { t: "ddjp.dj.vote", p: "$playAtFloor", pHash: "HHH" }),
    raw("$skip", 53, "@o:hs", 100, { t: "ddjp.dj.skip", p: "$playAtFloor", pHash: "HHH" }),
  ];
}

// ── PART A — an event we hold is never a hole ─────────────────────────────────────────────────
(() => {
  const held = roomAtFloor();
  const before = Continuity.mayAdvance(held, {}, -1);
  ok(before.ok === true,
    "A: with no floor the client advances freely (the control)", before);

  const after = Continuity.mayAdvance(held, {}, 44);
  ok(after.ok === true && after.state !== "short",
    "A: APPLIED — adopting a floor does NOT make the client short. The boundary event is in the "
    + "cache; every later advance chains onto it by construction, so filtering it out of the "
    + "'what do I hold' index turned the act of adopting a floor into a permanent hold — and "
    + "nothing could ever fill a gap that was never a gap", after);
  ok(!(after.corroborated || []).length,
    "A: and nothing is reported as a corroborated gap", after);
})();

// ── PART B — A BANKED PARENT IS NOT A HOLE, AND IT IS NAMED RATHER THAN GUESSED ───────────────
// A client that has forgotten below its floor holds advances whose chain parent it deliberately
// dropped. Position cannot settle that: the bound can only filter events it HOLDS, and an event it
// does not hold has no position to check. Guessing from the referencing event's position would be
// exactly the kind of almost-right rule this tree keeps deleting.
//
// The floor names it EXACTLY. A checkpoint's seed carries the state at the cut, and
// `seed.nowPlaying.pi` is the last advance accepted at or below it. The oldest advance a trimmed
// client still holds chains onto precisely that one, because the advance chain is dense — every
// advance names the one immediately before it. So there is one banked parent to exempt, it is
// known by id, and anything else missing is a genuine gap.
(() => {
  // TWO DIFFERENT AUTHORS naming the same parent — the ordinary advance race, where both clients
  // advance from the same head and the reducer keeps one. That is what makes the missing parent
  // CORROBORATED, so the control below really does hold the client still.
  const held = [
    raw("$aboveA", 50, "@a:hs", 0, { t: "ddjp.dj.skip", p: "$bankedPlay", pHash: "GGG" }),
    raw("$aboveB", 51, "@b:hs", 0, { t: "ddjp.dj.play", p: "$bankedPlay", pHash: "GGG" }),
  ];
  const unnamed = Continuity.mayAdvance(held, {}, 44);
  ok(unnamed.ok === false && unnamed.state === "short",
    "B: with NO banked parent stated, the dropped one is still a gap — the exemption is never "
    + "inferred, so a caller that does not know cannot accidentally get a pass", unnamed);

  const named = Continuity.mayAdvance(held, {}, 44, "$bankedPlay");
  ok(named.ok === true,
    "B: APPLIED — told which parent the floor banked, the client keeps playing instead of holding "
    + "still forever waiting for an event it deliberately dropped. This is the residual that made "
    + "forgetting unsafe to switch on", named);
})();

// ── PART C — a real gap above the floor still stops the client ────────────────────────────────
(() => {
  const held = [
    raw("$c1", 60, "@a:hs", 0, { t: "ddjp.dj.vote", p: "$reallyMissing", pHash: "FFF" }),
    raw("$c2", 61, "@b:hs", 0, { t: "ddjp.dj.skip", p: "$reallyMissing", pHash: "FFF" }),
  ];
  const v = Continuity.mayAdvance(held, {}, 44);
  ok(v.ok === false && v.state === "short",
    "C: APPLIED — a corroborated parent we do not hold, ABOVE the floor, still holds the client "
    + "still. The bound narrows the anti-fork restraint; it must never delete it", v);
})();

// ── PART D — evidence is not bounded either ───────────────────────────────────────────────────
(() => {
  // The only anchors for a genuinely missing parent sit BELOW the floor. Whether an event existed
  // is arithmetic, not policy, and a hash committed at position 3 proves exactly as much as one
  // committed at position 300.
  const held = [
    raw("$low1", 10, "@a:hs", 0, { t: "ddjp.dj.vote", p: "$ghost", pHash: "EEE" }),
    raw("$low2", 11, "@b:hs", 0, { t: "ddjp.dj.skip", p: "$ghost", pHash: "EEE" }),
    raw("$high", 60, "@c:hs", 0, { t: "ddjp.dj.play", p: "$ghost", pHash: "EEE" }),
  ];
  const c = Continuity.corroboration("$ghost", held, {});
  ok(c.corroborated === true,
    "D: two independent authors committing the same hash prove the parent existed (the control)", c);
  const v = Continuity.mayAdvance(held, {}, 44);
  ok(v.ok === false && v.state === "short",
    "D: APPLIED — and that proof is still reachable when the anchors sit below the floor. Hiding "
    + "half the cache from an arithmetic question does not make the answer safer, it makes it "
    + "worse: the client would keep going on a gap it could have proved was real", v);
})();

// ── PART F — ONLY AN ADVANCE CHAINS ───────────────────────────────────────────────────────────
// The rule at the top of missingParents already says a gap is a STRUCTURAL need: "a held child
// NEEDS its parent, and without it the chain genuinely cannot be derived through". Votes and saves
// carry `p` as well, and theirs is an annotation target — losing it costs the vote and nothing
// else, because the reducer simply does not count it. So the code was broader than its own stated
// rule, and the extra breadth only ever manufactured holds.
//
// It costs no coverage: the advance chain is dense, so a play genuinely missing above the floor is
// still named by the advance that chains onto it. A vote pointing at it adds nothing the chain has
// not already said.
(() => {
  const onlyVotes = [
    raw("$v1", 50, "@a:hs", 0, { t: "ddjp.dj.vote", p: "$goneAnnotationTarget", pHash: "ZZZ" }),
    raw("$v2", 51, "@b:hs", 0, { t: "ddjp.dj.save", p: "$goneAnnotationTarget", pHash: "ZZZ" }),
  ];
  const v = Continuity.mayAdvance(onlyVotes, {}, -1);
  ok(v.ok === true,
    "F: APPLIED — a vote and a save pointing at a play we do not hold do NOT stop the client. They "
    + "are reactions to something, not links in the chain; the reducer just will not count them",
    v);

  const withChain = onlyVotes.concat([
    raw("$adv", 52, "@c:hs", 0, { t: "ddjp.dj.play", p: "$goneAnnotationTarget", pHash: "ZZZ" }),
  ]);
  const w = Continuity.mayAdvance(withChain, {}, -1);
  ok(w.ok === false && w.state === "short",
    "F: and the moment an ADVANCE names the same missing event, it is a gap again — narrowing what "
    + "counts as a chain parent must not narrow what counts as being short", w);
})();

if (failures) process.exit(1);
console.log("[floor-bound-gap] PASS — the floor bounds what a client may be DEMANDED to hold, and "
  + "never what it actually holds: an event sitting in the cache at the floor is not reported "
  + "missing, so adopting a floor no longer manufactures a corroborated gap out of the very "
  + "boundary event every later advance chains onto — which stopped every client that adopted "
  + "that floor from ever advancing again. A real gap above the floor still holds the client "
  + "still, and evidence "
  + "about whether an event existed is read from everything held, because that is arithmetic "
  + "rather than policy");
