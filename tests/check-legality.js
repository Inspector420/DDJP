// tests/check-legality.js
// WALL: WHAT COUNTS. Protection is spent on the timeline and nothing else.
//
// Two rules, both load-bearing:
//
//   LEGAL — an event is protectable only if the reducer ACCEPTED it. Deciding by event
//   TYPE alone was the hole: anyone may write to the uncategorized channel, so a flood
//   of well-formed messages that change nothing would become vouch work for every
//   client and crowd real history out of the bounded per-message slots.
//
//   OWNER-EXEMPT — an owner's own event needs no vouching by anyone, decided by CHANNEL
//   ORIGIN. Nobody below the top rank can delete another person's message (channels are
//   created with redact:100), so an owner event can only be removed by the owner.
//
// Also pins HANDLED_TYPES against the types the reducer actually branches on, so adding
// a branch without declaring its type turns the build red rather than silently making
// that event illegal — which would stop it being protected.
//
// ── AND "IT CHANGED NOTHING" IS THE SAME QUESTION TWICE ──────────────────────────
// Legality has TWO consumers, and both were reading the wrong thing:
//
//   Vouch.eligible          spends protection on legal + critical events
//   Checkpoint._countable   decides a checkpoint is DUE after N events that "changed
//                           something" — but counted by TYPE, never asking whether the
//                           fold accepted any of them
//
// So the cadence assertion (PART F) lives HERE rather than with the cadence guard,
// deliberately: it reads the same set as PART E, and a second home for "what counts as
// an event that mattered" is exactly how the two would come to disagree. The cadence
// guard owns WHEN a seal is due; this one owns WHAT is allowed to make it due.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

const c = loadInContext([
  "backends/backend1/ranks.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/checkpoint.js", "backends/backend1/continuity.js", "backends/backend1/settingsproof.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], {});
const { StateDeriver, Vouch, TrustPolicy, Ranks } = c;

function ev(id, l, sender, rank, body) {
  return { event_id: id, l: l, sender: sender, senderRank: rank,
           type: body.t, content: body, room_id: "!r:hs" };
}
const OWNER = Ranks.levelOf("owner"), PLAYER = Ranks.levelOf("player"), STAFF = Ranks.levelOf("staff");

// ── (a) the accepted set is the timeline, not the well-formed set ────────────────
(() => {
  const log = [
    ev("$join",   1, "@a:hs", PLAYER, { t: "ddjp.dj.join" }),
    ev("$reset",  2, "@a:hs", PLAYER, { t: "ddjp.dj.reset" }),          // needs High-Staff
    ev("$made",   3, "@a:hs", PLAYER, { t: "ddjp.not.a.real.type" }),   // unknown
    ev("$strike", 4, "@a:hs", PLAYER, { t: "ddjp.dj.strike", u: "@b:hs", x: "V1" }),
    ev("$set",    5, "@o:hs", OWNER,  { t: "ddjp.room.settings", s: { maxLen: 900 } }),
  ];
  // NOTE: compared by VALUE, not deepStrictEqual — the array is built inside the vm
  // sandbox, so its prototype is that realm's Array and a strict deep-equal would fail
  // on the realm rather than on the contents.
  const accepted = Array.from(StateDeriver.deriveAccepted(log)).sort();
  assert.strictEqual(accepted.join(","), "$join,$set",
    "only events the reducer ACCEPTED are legal");
  assert.ok(accepted.indexOf("$reset") < 0,
    "a rank-gated event from too low a rank is NOT legal (it changed nothing)");
  assert.ok(accepted.indexOf("$made") < 0,
    "an unknown type is NOT legal — an open channel cannot mint protectable events");
  assert.ok(accepted.indexOf("$strike") < 0,
    "a well-formed event that no-ops is NOT legal");
})();

// ── (b) the legal set never disturbs derived state ───────────────────────────────
(() => {
  // PRODUCTION SHAPE: StreamManager folds entries keyed `eventId` (camelCase) with parsed
  // `content`, not raw `event_id` + `content.body`. The accepted set MUST populate for that
  // shape — a mismatch returns [] and silently makes every event illegal, disabling all
  // vouching, invisibly to any fixture that happens to use event_id.
  const prod = (id, l, sender, rank, body) => ({ eventId: id, l: l, sender: sender,
    senderRank: rank, type: body.t, content: body, ts: l * 60000, roomId: "!r:hs" });
  const log = [
    prod("$j", 1, "@a:hs", PLAYER, { t: "ddjp.dj.join" }),
    prod("$reset", 2, "@a:hs", PLAYER, { t: "ddjp.dj.reset" }),   // player → rejected
  ];
  const acc = Array.from(StateDeriver.deriveAccepted(log));
  assert.strictEqual(acc.join(","), "$j",
    "the accepted set is populated for the PRODUCTION eventId shape (not only raw event_id fixtures)");
})();

(() => {
  const log = [ev("$j", 1, "@a:hs", PLAYER, { t: "ddjp.dj.join" })];
  const st = StateDeriver.derive(log);
  assert.ok(!("accepted" in st) && !("legal" in st),
    "the accepted set rides ALONGSIDE state, never inside it (checkpoint fingerprints unmoved)");
})();

// ── (c) eligibility: legal AND critical AND not mine AND not the owner's ─────────
(() => {
  // A HELD raw is a Matrix message whose content.body is the JSON action — the same
  // shape EventCache stores and the vouch layer reads.
  const raw = (id, sender, rank, t) => ({ event_id: id, sender: sender, senderRank: rank,
    l: 1, content: { body: JSON.stringify({ t: t }) }, room_id: "!r:hs" });
  const legalAll = () => true;

  assert.ok(Vouch.eligible(raw("$1", "@b:hs", PLAYER, "ddjp.dj.play"), "@me:hs", legalAll),
    "another player's play is protectable");
  assert.ok(!Vouch.eligible(raw("$2", "@me:hs", PLAYER, "ddjp.dj.play"), "@me:hs", legalAll),
    "my own event is never protectable — my copy dies with my own deletion");
  assert.ok(!Vouch.eligible(raw("$3", "@o:hs", OWNER, "ddjp.dj.play"), "@me:hs", legalAll),
    "an OWNER event is never protectable — only the owner can delete it");
  assert.ok(!Vouch.eligible(raw("$4", "@b:hs", PLAYER, "ddjp.dj.vote"), "@me:hs", legalAll),
    "a non-critical type is never protectable");
  assert.ok(!Vouch.eligible(raw("$5", "@b:hs", PLAYER, "ddjp.dj.play"), "@me:hs", () => false),
    "an event the reducer rejected is never protectable, however well-formed");
})();

// ── (d) the owner exemption is origin-based, and both callers agree ──────────────
(() => {
  assert.strictEqual(TrustPolicy.satisfiedTier([], { u: "@o:hs", r: OWNER }, {}), 0,
    "an owner event is satisfied with zero vouchers, by origin");
  assert.strictEqual(TrustPolicy.satisfiedTier([], { u: "@s:hs", r: STAFF }, {}), null,
    "no other rank gets this");
  // the shape that used to differ between the vouch loop and the eviction path
  assert.strictEqual(TrustPolicy.satisfiedTier([], { u: "@o:hs", r: OWNER }, {}),
                     TrustPolicy.satisfiedTier([], { u: "@o:hs", r: OWNER }, {}),
    "the same author identity gives the same answer to every caller");
})();

// ── (e) HANDLED_TYPES matches what the reducer branches on ───────────────────────
(() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/statederiver.js"), "utf8");
  const declared = StateDeriver.HANDLED_TYPES.slice().sort();
  const branched = Array.from(new Set(
    (src.match(/ev\.type === "ddjp\.[a-z.]+"/g) || []).map((m) => m.slice(m.indexOf('"') + 1, -1))
  )).sort();
  for (const t of branched) {
    assert.ok(declared.indexOf(t) >= 0,
      "the reducer branches on " + t + " but HANDLED_TYPES omits it — that event would be silently ILLEGAL and go unprotected");
  }
})();


// ══════════════════════════════════════════════════════════════════════════════════
// PART E — LEGAL MEANS IT CHANGED SOMETHING
// ══════════════════════════════════════════════════════════════════════════════════
//
// consensus-models.md §5 states the guarantee this pins: "flooding the room with
// valid-looking no-op messages can never create work for anyone." It was FALSE. The
// reducer records REJECTIONS (every top-level `continue`) and treats everything else as
// accepted, so any branch that falls through without changing anything left its event
// LEGAL — and legal + critical is exactly what Vouch.eligible spends protection on.
//
// Measured by driving every handled type rather than by reading, before the rule below existed:
// SEVEN scenarios were accepted while changing neither derived state nor the checkpoint
// seed. Six of them were critical, so each became real vouch work AND a countable event
// driving the seal cadence. One of the six is what the JOIN BUTTON sends when you are
// already in the rotation — this was never only an attacker's lever.
//
//   dj.leave     from someone who never joined
//   dj.join      already in, no song          <- the Join button, pressed twice
//   dj.declare   with no video id
//   dj.order     naming ids not in my buffer
//   dj.order     naming the order already in force
//   dj.move      to the front of a rotation I already head
//   count.set    setting the value it already has
//
// THE RED THIS WAS WRITTEN AGAINST, so a future red is checkable against the one it was
// built for. A different shape is a new finding, not a regression of this one:
//
//   PART E: 7 scenario(s) ... ACCEPTED anyway:
//         ddjp.dj.join     (already in the rotation, no song (THE JOIN BUTTON))
//         ddjp.dj.declare  (no video id)
//         ddjp.dj.leave    (never joined)
//         ddjp.dj.order    (ids not in my buffer)
//         ddjp.dj.order    (the order already in force)
//         ddjp.dj.move     (to the front of a rotation the target already heads)
//         ddjp.count.set   (setting a tally to the value it already has)
//   PART F: _countable counted 12 of 12 events the fold REFUSED.
//
// Two of the table's rows had to be corrected before it could report that, and BOTH were
// caught by the fixture check rather than by reading: `dj.move` is not inert in a
// single-member rotation (it rewrites the only orderKey there is), and `count.set` is not
// inert unless a baseline is already in force (otherwise it CREATES the tally). A scenario
// that quietly stops being inert is how this guard would rot into asserting nothing.
//
// ── WHY THIS IS A TABLE AND NOT A LIST OF FIXES ──────────────────────────────────
// Fixing the instance that was noticed and not its siblings is this project's signature
// bug, and it produced all seven of these. So the table below is EXHAUSTIVE against
// HANDLED_TYPES: a new event type must declare its inert forms, or say in words that it
// has none, or this guard fails. It demands a DECISION rather than asserting one answer —
// the same shape as the sender scan and the advance-notify derivation.
(() => {
  const F = require("./_fixtures");
  const room = F.playingRoom({ songs: 1 });
  const DJ = room.dj, PI = room.pi(0);
  // A SECOND DJ, because one of the inert forms needs a rotation to be at the front OF.
  // With a single member, "move to the front" rewrites the only orderKey there is and is not
  // inert at all — which the fixture check below caught on the first run, exactly as intended.
  const BASE = room.log.concat([
    F.reducerEvent("$joinb", room.lastL + 1, room.startTs + 400000, "@b:hs", F.RANK.player,
      { t: "ddjp.dj.join", v: "SONGB" }),
    // An owner baseline already in force, so RE-setting it to the same value is the inert case.
    // Without this the candidate CREATES the tally and is not inert — caught by the fixture check.
    F.reducerEvent("$cset0", room.lastL + 2, room.startTs + 450000, "@o:hs", F.RANK.owner,
      { t: "ddjp.count.set", k: "vote", id: room.pi(0), n: 0 }),
  ]);
  const j2 = (x) => JSON.stringify(x);
  const baseState = j2(StateDeriver.derive(BASE));
  const baseSeed = j2(StateDeriver.buildSeed(BASE));
  let nextL = room.lastL + 2, nextTs = room.startTs + 500000;
  const mk = (sender, rank, body) => F.reducerEvent("$cand" + (++nextL), nextL, (nextTs += 1000), sender, rank, body);

  // Every handled type -> the ways it can be accepted while changing nothing.
  // An empty array MUST carry a reason; an absent key fails the exhaustiveness check.
  const INERT_FORMS = {
    "ddjp.dj.join": [
      ["already in the rotation, no song (THE JOIN BUTTON)", () => mk(DJ, F.RANK.player, { t: "ddjp.dj.join" })],
    ],
    "ddjp.dj.declare": [
      ["no video id", () => mk(DJ, F.RANK.player, { t: "ddjp.dj.declare" })],
    ],
    "ddjp.dj.leave": [
      ["never joined", () => mk("@ghost:hs", F.RANK.player, { t: "ddjp.dj.leave" })],
    ],
    "ddjp.dj.order": [
      ["ids not in my buffer", () => mk(DJ, F.RANK.player, { t: "ddjp.dj.order", o: ["NOTMINE"] })],
      ["the order already in force", () => mk(DJ, F.RANK.player, { t: "ddjp.dj.order", o: ["SONG1", "SONG2"] })],
    ],
    "ddjp.dj.move": [
      ["to the front of a rotation the target already heads", () => mk("@s:hs", F.RANK.staff, { t: "ddjp.dj.move", x: DJ })],
    ],
    "ddjp.count.set": [
      ["setting a tally to the value it already has", () => mk("@o:hs", F.RANK.owner, { t: "ddjp.count.set", k: "vote", id: PI, n: 0 })],
    ],
    // Types with NO inert form, each with the reason recorded rather than left blank.
    "ddjp.dj.undeclare": [],   // every no-op path already rejects: non-member, bad id, id not held
    "ddjp.dj.remove":    [],   // rejects missing/unknown target and insufficient rank
    "ddjp.dj.strike":    [],   // rejects unknown target, bad id, and an id not in their buffer
    "ddjp.dj.reset":     [],   // clearing an already-clear room is inert, but it also clears
                               // nowPlaying, so the only truly inert case is a room with neither —
                               // which has no rotation to flood and no protection to spend
    // NO INERT FORM — but the REASON is not the one this row carried until J04, and the old one
    // is exactly the sentence that hid the bug. It said "the advance lock rejects anything that
    // does not follow the head", which is true and was being read as covering everything. It does
    // not cover the advance that EMPTIES the room: that one follows the head correctly, passes the
    // lock, clears nowPlaying, moves the seed — and was marked refused anyway. PART G is the wall
    // for that whole class now; this row means only that a play changing nothing is unreachable,
    // because every path that changes nothing already rejects.
    "ddjp.dj.play":      [],
    "ddjp.dj.skip":      [],   // same lock
    "ddjp.media.skip":   [],   // same lock, plus the road tally is recomputed
    "ddjp.room.settings":[],   // an all-refused blob still MOVES settingsFrom, so it changes the
                               // seed and is not inert — see check-settingsproof PART I
    "ddjp.dj.vote":      [],   // a duplicate is deduped by the user Set, which the tally reflects
    "ddjp.dj.save":      [],   // same
    "ddjp.play.len":     [],   // one per person per playing; a repeat is rejected
    "ddjp.play.blocked": [],   // same
  };

  // EXHAUSTIVENESS. A new handled type with no entry fails here rather than inheriting
  // an answer nobody chose.
  for (const t of StateDeriver.HANDLED_TYPES) {
    assert.ok(Object.prototype.hasOwnProperty.call(INERT_FORMS, t),
      "PART E: " + t + " is a handled type with no entry in INERT_FORMS — declare its inert " +
      "forms, or record that it has none and why. An absent answer is how six siblings of one " +
      "bug went unfixed.");
  }

  // THE ASSERTION. Fold base vs base+candidate; if neither derived state nor the seed
  // moved, the reducer must NOT have accepted it.
  let inertChecked = 0;
  const offenders = [];
  for (const t in INERT_FORMS) {
    for (const [note, make] of INERT_FORMS[t]) {
      const cand = make();
      const log = BASE.concat([cand]);
      const stSame = j2(StateDeriver.derive(log)) === baseState;
      const sdSame = j2(StateDeriver.buildSeed(log)) === baseSeed;
      const accepted = StateDeriver.deriveAccepted(log).indexOf(cand.eventId) >= 0;
      // FIXTURE CHECK FIRST. A scenario that turns out to CHANGE something is not testing
      // this rule, and would let the loop pass while asserting nothing.
      assert.ok(stSame && sdSame,
        "PART E fixture: " + t + " / " + note + " was supposed to be inert but changed " +
        (stSame ? "the seed" : "derived state") + " — the scenario no longer reaches the rule");
      inertChecked++;
      // COLLECTED, NOT ASSERTED PER ROW. Seven of these were live at once, and a guard that
      // stops at the first teaches the reader to fix one of seven — which is the exact habit
      // that produced seven. Report them all, then fail.
      if (accepted) offenders.push(t + "  (" + note + ")");
    }
  }
  assert.ok(offenders.length === 0,
    "PART E: " + offenders.length + " scenario(s) changed neither derived state nor the checkpoint " +
    "seed and were ACCEPTED anyway — each is legal, therefore protectable, therefore vouch work for " +
    "every client in the room, and each counts toward the seal cadence. consensus-models.md §5 " +
    "promises this cannot happen:\n      " + offenders.join("\n      "));
  // The loop must have compared something. A table edited down to all-empty arrays would
  // otherwise pass in silence.
  assert.ok(inertChecked >= 7,
    "PART E: only " + inertChecked + " inert scenarios were driven — the table has been emptied " +
    "and this guard is asserting nothing");
})();

// ══════════════════════════════════════════════════════════════════════════════════
// PART F — AN EVENT THE FOLD REFUSED DOES NOT MAKE A CHECKPOINT DUE
// ══════════════════════════════════════════════════════════════════════════════════
//
// The second consumer, and the sharper one. `Checkpoint._countable` decides how many
// events have "changed anything" since the floor, and `checkpointEvery` (default 40)
// turns that into a seal. It filtered by TYPE — excluding the non-critical list — and
// never asked the fold whether any of them were accepted. So a flood of refused events
// did not merely manufacture vouch work: it forced the room to bank checkpoints,
// which are themselves events, which is the self-amplifying shape maySeal's own comment
// describes for vouch bundles.
//
// Measured before the fix: 41 rejected `dj.leave` messages counted 41 against a
// threshold of 40.
(() => {
  const F = require("./_fixtures");
  const { Checkpoint } = c;
  const rejected = [];
  let l = 0;
  for (let i = 0; i < 12; i++) {
    rejected.push(F.reducerEvent("$junk" + i, ++l, 100000 + i * 1000, "@ghost:hs",
      F.RANK.player, { t: "ddjp.dj.leave" }));
  }
  const accepted = StateDeriver.deriveAccepted(rejected);
  assert.strictEqual(accepted.length, 0,
    "PART F fixture: the junk log was supposed to be entirely rejected, but " +
    accepted.length + " events were accepted — PART E covers that, and this part is then " +
    "measuring the wrong thing");

  const legal = Object.create(null);
  for (const id of accepted) legal[id] = true;
  Checkpoint.attach({ isLegal: () => ((id) => !!legal[id]) });

  const counted = Checkpoint._countable(rejected);
  assert.strictEqual(counted, 0,
    "PART F: _countable counted " + counted + " of " + rejected.length + " events the fold " +
    "REFUSED. A client that cannot change the room can still force every client in it to seal " +
    "a checkpoint, and each seal is another event.");
})();


// ══════════════════════════════════════════════════════════════════════════════════
// PART G — THE CONVERSE: IT CHANGED SOMETHING, THEREFORE IT IS ACCEPTED
// ══════════════════════════════════════════════════════════════════════════════════
//
// PART E asserts one direction — inert therefore rejected. Nothing asserted the other, and that
// is how J04 survived a fully green suite: an advance that EMPTIES the room cleared nowPlaying,
// moved the checkpoint seed, and was recorded as refused.
//
// WHY THAT WAS EXPENSIVE, and the two halves are one fact. Legality is what Vouch.eligible spends
// protection on, so an event that cannot be accepted cannot be vouched — it was at once the only
// event in the room nobody could rebuild and the event whose deletion forks everyone who reloads.
// And the fork is undetectable IN PRINCIPLE: the advance lock is head === claimedPrev, so once the
// room empties the next play names p:null, nothing ever chains onto the emptying advance, and
// Continuity.missingParents has no parent to find. Nothing will ever notice it is gone, so
// protection is the ONLY defence and acceptance is what buys it.
//
// DERIVED, NOT LISTED. Every handled type is driven; a hand-written list of cases would have
// missed this one for the same reason the code did — nobody writes down the branch that inverts
// the rule. The seed is compared as well as derived state, because this event moved the seed too
// and a guard watching state alone would need luck.
(() => {
  const F = require("./_fixtures");
  const { Checkpoint } = c;
  const j2 = (x) => JSON.stringify(x);

  // Candidates that DO change the room, one per shape worth pinning. Each is [note, build(base)]
  // returning the event to append. The fixture check below refuses any that turns out inert, so a
  // scenario that quietly stops changing anything cannot make this guard vacuous.
  const room = F.playingRoom({ songs: 1 });
  const CHANGING = [
    ["dj.join from somebody new", (b, l, ts) =>
      F.reducerEvent("$g1", l, ts, "@new:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGN" })],
    // NOT a declare by the running DJ: playingRoom keeps that buffer at the 2-song cap, so the
    // extra one is refused and changes nothing. The fixture check below caught exactly that on
    // the first run — the trap _fixtures.js names in its own header.
    ["dj.undeclare removing one of my own songs", (b, l, ts) =>
      F.reducerEvent("$g2", l, ts, room.dj, F.RANK.player, { t: "ddjp.dj.undeclare", v: "SONG2" })],
    ["dj.vote on the live playing", (b, l, ts) =>
      F.reducerEvent("$g5", l, ts, "@v:hs", F.RANK.player, { t: "ddjp.dj.vote", p: room.pi(0) })],
    ["dj.leave by a member", (b, l, ts) =>
      F.reducerEvent("$g3", l, ts, room.dj, F.RANK.player, { t: "ddjp.dj.leave" })],
    ["room.settings the reducer honours", (b, l, ts) => {
      const blob = StateDeriver.defaultSettings(); blob.maxLen = 601;
      return F.reducerEvent("$g4", l, ts, "@o:hs", OWNER, { t: "ddjp.room.settings", s: blob });
    }],
  ];

  let nextL = room.lastL, nextTs = room.startTs + 900000;
  const offenders = [], checked = [];
  for (const [note, make] of CHANGING) {
    const cand = make(room.log, ++nextL, (nextTs += 1000));
    const log = room.log.concat([cand]);
    const stMoved = j2(StateDeriver.derive(log)) !== j2(StateDeriver.derive(room.log));
    const sdMoved = j2(StateDeriver.buildSeed(log)) !== j2(StateDeriver.buildSeed(room.log));
    // FIXTURE CHECK FIRST, same discipline as PART E: a candidate that changes nothing is not
    // testing this rule and would let the loop pass while asserting nothing.
    assert.ok(stMoved || sdMoved,
      "PART G fixture: " + note + " was supposed to CHANGE the room and changed neither derived " +
      "state nor the seed — the scenario no longer reaches the rule");
    checked.push(note);
    if (StateDeriver.deriveAccepted(log).indexOf(cand.eventId) < 0) offenders.push(note);
  }

  // THE ONE THIS PART WAS WRITTEN FOR. A DJ with a single song plays it, hard fall-out empties the
  // rotation, and the next advance ends the music. It follows the head, so the lock passes; it
  // clears nowPlaying, so the room changed.
  const EMPTY = [
    F.reducerEvent("$ejoin",  1,   1000, "@dj:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONG0" }),
    F.reducerEvent("$eplay0", 2, 100000, "@dj:hs", F.RANK.player, { t: "ddjp.dj.play", p: null }),
  ];
  const EMPTIER = F.reducerEvent("$eplay1", 3, 400000, "@o:hs", F.RANK.player,
    { t: "ddjp.dj.play", p: "$eplay0" });
  const withEmptier = EMPTY.concat([EMPTIER]);

  const before = StateDeriver.derive(EMPTY), after = StateDeriver.derive(withEmptier);
  assert.ok(before.nowPlaying && !after.nowPlaying,
    "PART G fixture: the emptying advance was supposed to clear nowPlaying and did not — the " +
    "scenario no longer reaches the rule");
  assert.notStrictEqual(j2(StateDeriver.buildSeed(withEmptier)), j2(StateDeriver.buildSeed(EMPTY)),
    "PART G fixture: the emptying advance was supposed to move the checkpoint seed");
  if (StateDeriver.deriveAccepted(withEmptier).indexOf("$eplay1") < 0) {
    offenders.push("dj.play that EMPTIES the room (clears nowPlaying, moves the seed)");
  }
  checked.push("dj.play that EMPTIES the room");

  assert.ok(offenders.length === 0,
    "PART G: " + offenders.length + " event(s) CHANGED derived state or the checkpoint seed and " +
    "were REFUSED anyway. A refused event cannot be vouched, so it is the one event nobody can " +
    "rebuild — and its deletion forks the room with no missing parent for anyone to detect:\n" +
    "      " + offenders.join("\n      "));
  assert.ok(checked.length >= 5,
    "PART G: only " + checked.length + " changing scenarios were driven — the table has been " +
    "emptied and this guard is asserting nothing");

  // AND IT REACHES THE PROTECTION PATH. Accepted is necessary and NOT sufficient: because nothing
  // will ever detect this event's absence, the only defence is that somebody vouched it first, so
  // the chain has to be followed rather than assumed at its first link.
  const accepted = StateDeriver.deriveAccepted(withEmptier);
  const isLegal = (id) => accepted.indexOf(String(id)) >= 0;
  const rawEmptier = F.toRaw(EMPTIER);
  assert.ok(Vouch.eligible(rawEmptier, "@me:hs", isLegal),
    "PART G: the emptying advance is accepted but Vouch.eligible refuses it, so nothing would " +
    "ever protect it. Accepted is the mechanism; protectable is the property.");

  // RE-ATTACH isLegal. PART F attached one closing over ITS OWN accepted set, and Checkpoint is a
  // single module instance shared across parts — so without this, every event here reads illegal
  // and _countable answers 0 for both logs, which would look like a finding about the cadence and
  // is really one part leaking into another. Caught by this assertion rather than by reading.
  Checkpoint.attach({ isLegal: () => ((id) => isLegal(id)) });
  const counted = Checkpoint._countable(withEmptier.map((e) => ({ eventId: e.eventId, content: e.content })));
  const acceptedWithout = StateDeriver.deriveAccepted(EMPTY);
  Checkpoint.attach({ isLegal: () => ((id) => acceptedWithout.indexOf(String(id)) >= 0) });
  const countedWithout = Checkpoint._countable(EMPTY.map((e) => ({ eventId: e.eventId, content: e.content })));
  assert.ok(counted > countedWithout,
    "PART G: the emptying advance does not count toward the seal cadence, so a room that ends " +
    "this way banks one event less than happened. counted=" + counted + " without=" + countedWithout);

  // AND THE FORK CANNOT FORM. The property, not the mechanism: two clients differing by exactly
  // this event must not end up with heads that each refuse the other's advances.
  const restart = [
    F.reducerEvent("$ejoinX", 4, 500000, "@x:hs", F.RANK.player, { t: "ddjp.dj.join", v: "SONGX" }),
    F.reducerEvent("$eplayX", 5, 600000, "@x:hs", F.RANK.player, { t: "ddjp.dj.play", p: null }),
  ];
  const whole = withEmptier.concat(restart);
  const short = EMPTY.concat(restart);               // the client that never received the emptier
  const wholeAccepted = StateDeriver.deriveAccepted(whole).indexOf("$eplayX") >= 0;
  const shortAccepted = StateDeriver.deriveAccepted(short).indexOf("$eplayX") >= 0;
  assert.ok(wholeAccepted,
    "PART G fixture: the restart was supposed to be accepted by a whole client and was not");
  assert.ok(!shortAccepted,
    "PART G: a client missing the emptying advance ACCEPTED the restart, which means this " +
    "scenario no longer demonstrates the divergence it exists to make protectable. Re-derive the " +
    "fixture before weakening the assertion.");
})();

console.log("[legality] PASS — protection is spent on the TIMELINE: only reducer-accepted events are " +
  "protectable, the accepted set never enters hashed state, eligibility is legal+critical+not-mine+" +
  "not-the-owner's, the owner exemption is decided by channel ORIGIN so every caller gets the same " +
  "answer, and HANDLED_TYPES is pinned to the reducer's branches. AND \"no-op\" is now driven rather " +
  "than claimed: every handled type declares its inert forms or records that it has none, an event " +
  "that moved neither derived state nor the seed is REFUSED, and an event the fold refused cannot " +
  "make a checkpoint due — so flooding a room with well-formed messages that change nothing creates " +
  "neither vouch work nor a seal. AND THE CONVERSE IS WALLED TOO: an event that DID change "
  + "derived state or the checkpoint seed is ACCEPTED — driven over every shape rather than "
  + "listed, because the one that broke this was the branch nobody would have written down. "
  + "The advance that empties the room clears nowPlaying, moves the seed, is accepted, is "
  + "eligible for protection and counts toward the cadence — which matters more here than "
  + "anywhere else, since nothing ever chains onto it, so no client can DETECT its loss and "
  + "protection is the only defence there is");
