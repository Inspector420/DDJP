// tests/check-checkpoint.js
// WALL: A CHECKPOINT IS A CLAIM ABOUT NOW, AND IT ASKS RATHER THAN DECIDES.
//
// In the old tree this file also chose floors, verified quorums, adopted, graded, re-validated and
// re-fetched. Those are Floor's now. What is left is emitting, and these are its rules.
//
// PART A — it asks the other modules; it owns neither answer. Structural, asserted on the source.
// PART B — a client that is not LIVE seals nothing. The bug that reached a real room.
// PART C — the seal waits its slot and STANDS DOWN if the room moved while it waited.
// PART D — coverage is judged at MY OWN bar over the SEGMENT since my floor, not the whole history.
// PART E — self-witness is a real question, not the config flag.
// PART F — the witness hold binds the OWNER too, and that is the point.
// PART G — either trigger is enough: the clock OR the count, never both.
// PART H — the seed is the reducer's own, so the snapshot and the state cannot disagree.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");
const fs = require("fs");

function fail(m, g) { console.log("[checkpoint] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const OWNER = F.RANK.owner, STAFF = F.RANK.staff, GUEST = F.RANK.guest;
const ROOM = F.playingRoom({ songs: 6 });
const LOG = F.sortLog(ROOM.log);

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/dials.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/checkpoint.js",
  ], { Date });
}

// A client wired up with controllable surroundings.
function client(opts) {
  const o = opts || {};
  const sb = tree();
  const sent = [];
  sb.Session._setPhaseForTest(o.phase || sb.Session.LIVE);
  sb.Floor.attach({ log: () => (o.log || LOG), settings: () => (o.settings || {}),
                    myRank: () => (o.rank === undefined ? OWNER : o.rank), trimmed: () => false });
  sb.Checkpoint.attach({
    // ASKS FLOOR, exactly as the bridge wires it. Stubbing these would leave every cadence
    // assertion in this file unable to notice anything wrong on the anchor path.
    floorTs: () => (typeof o.floorTs === "function" ? o.floorTs()
                    : (o.floorTs !== undefined ? o.floorTs : sb.Floor.anchorTs())),
    floorPos: () => (typeof o.floorPos === "function" ? o.floorPos()
                     : (o.floorPos !== undefined ? o.floorPos : sb.Floor.position())),
    now: () => (o.now || 10000000),
    log: () => (o.log || LOG),
    held: () => (o.held || []),
    settings: () => (o.settings || {}),
    myRank: () => (o.rank === undefined ? OWNER : o.rank),
    myUserId: () => (o.me || "@me:hs"),
    amOwner: () => (o.amOwner !== false),
    isLegal: () => (o.isLegal || null),
    holdForWitness: () => (o.hold || { hold: false, remainingMs: 0, cycleMs: 0 }),
    send: o.send === null ? null : (async (t, c) => { sent.push({ t: t, c: c }); }),
  });
  sb.sent = sent;
  return sb;
}

// ── PART A — it asks; it does not decide ─────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/checkpoint.js"), "utf8");
  ok(!/function\s+select|function\s+chainVerifies|function\s+revalidate|substituteTrusted/.test(src),
    "A: emitting only — selecting, chaining and re-validating a floor are NOT here. Those seven "
    + "jobs living in this file is what left the floor concept with no owner");
  ok(/Vouch\.protectedForMe|Vouch\.eligible/.test(src),
    "A: it ASKS Vouch whether it is covered rather than re-deriving coverage");
  ok(/Floor\.position|Floor\.boundaryOf|Floor\.fingerprint/.test(src),
    "A: and ASKS Floor where its segment starts rather than searching for one");
}

// ── PART B — not LIVE, no seal ───────────────────────────────────────────────────────────────
{
  for (const phase of ["replaying", "catching-up", "suspended", "cold"]) {
    const sb = client({ phase: phase });
    const g = sb.Checkpoint.maySeal(10000000);
    ok(g.ok === false && g.reason === "not-live",
      "B: a client in phase " + phase + " must not seal", g);
  }
  ok(client({ phase: "live" }).Checkpoint.maySeal(10000000).reason !== "not-live",
    "B: APPLIED — and a LIVE one is not blocked by the phase. A client four events into replaying "
    + "yesterday once produced a faithful snapshot of a moment that had already ended, published "
    + "it, and adopted its own answer. Every step was right; the result was a lie");
}

// ── PART C — the slot, and standing down if the room moved ───────────────────────────────────
{
  let live = LOG.slice();
  const sb = client({ log: () => live });
  sb.Checkpoint.attach({ log: () => live });
  sb.Scheduler.attach({ now: () => 10000000, setTimeout: () => 1, clearTimeout: () => {}, random: () => 0 });
  const r = sb.Checkpoint.planSeal();
  ok(r && r.ok === true, "C: a seal is planned through the shared scheduler rather than a bare timer", r);

  live = live.concat([F.reducerEvent("$late", 999, 9999999, "@x:hs", GUEST, { t: "ddjp.dj.join", v: "abcdefghijk" })]);
  const fired = sb.Scheduler._fireNowForTest("checkpoint:seal");
  ok(fired && fired.reason === "no-longer-needed",
    "C: APPLIED — the room moved while we waited our slot, so what we were about to bank is "
    + "already behind. Liveness alone is a proxy: a client folding a backlog is live the whole "
    + "time and just as wrong", fired);

  // THIS ASSERTION USED TO STOP AT THE FIELD, and that was the whole bug. It checked that
  // slotSpec CARRIED a positive minDelayMs and said "there is a settle floor even for rank zero"
  // — while the Scheduler read rank, spacing, urgent and ownerOffsetMs and never that field, so
  // the floor did not exist and this stayed green for as long as it was missing. A guard that
  // asserts a value is SET, in the same breath as claiming an effect, is the decorative shape
  // this project's build law says to expect in a guard written minutes after the code.
  //
  // What this module owes is the floor's VALUE; that the Scheduler applies it is asserted where
  // it is applied (check-scheduler PART 0), because that is the only place it can be executed.
  const spec = sb.Checkpoint.slotSpec();
  ok(typeof spec.minDelayMs === "number" && spec.minDelayMs > 0,
    "C: APPLIED — the seal plan carries a settle floor, derived from the room's own turn-taking "
    + "step rather than a literal written here. The slot decides ORDER and the owner's is zero by "
    + "design, so without a floor the owner — who is exactly who hit the stale-seal bug — had no "
    + "observation window at all", spec.minDelayMs);
}

// ── PART D — coverage over the SEGMENT, at MY bar ────────────────────────────────────────────
{
  // Three staff vouchers on an event: enough for a staff observer, not for high-staff.
  const target = F.rawEvent("$t", 50, 5000, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$z" });
  // STANDALONE BUNDLES, deliberately. A first version used play events as the carriers — and they
  // are themselves critical events from other authors, so they landed in the span too, unvouched,
  // and the gate correctly refused. The fixture was wrong, not the gate. A bundle is in
  // NON_CRITICAL_TYPES, so it carries coverage without needing any of its own, which is exactly
  // what the real standalone path does.
  const vouchers = ["@s1:hs", "@s2:hs", "@s3:hs"].map((u, i) =>
    F.rawEvent("$v" + i, 51 + i, 5000, u, STAFF, { t: "ddjp.witness.bundle",
      w: [{ i: "$t", l: 50, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF }] }));
  const held = [target].concat(vouchers);

  const asStaff = client({ rank: STAFF, held: held, me: "@me:hs", amOwner: false });
  ok(asStaff.Checkpoint.coverageVerdict().mode === "coverage",
    "D: three staff vouchers satisfy a STAFF observer", asStaff.Checkpoint.coverageVerdict());

  const asHS = client({ rank: F.RANK.highStaff, held: held, me: "@me:hs", amOwner: false,
                        settings: { selfWitnessCheckpoint: false } });
  ok(asHS.Checkpoint.coverageVerdict().ok === false,
    "D: APPLIED — the SAME coverage leaves a high-staff observer unable to seal. Reading "
    + "'satisfied by somebody' absolutely would let a staff client seal on the strength of guest "
    + "vouching, which is the don't-trust-down violation refused one module away",
    asHS.Checkpoint.coverageVerdict());

  // and the segment bound: below a floor is banked, not our problem
  const withFloor = client({ rank: F.RANK.highStaff, held: held, me: "@me:hs", amOwner: false,
                             settings: { selfWitnessCheckpoint: false } });
  withFloor.Floor._setTrustedForTest({ grade: "verified", floorL: 100, seed: {}, h: "h", covers: "$a..$b" });
  ok(withFloor.Checkpoint.coverageVerdict().ok === true,
    "D: APPLIED — with a floor above those events the span is EMPTY and the seal is free. We do "
    + "not redo what the owner already secured; asking about the whole held history is what made "
    + "the old gate refuse every seal forever once the self-witness branch started checking",
    withFloor.Checkpoint.coverageVerdict());
}

// ── PART E — self-witness is a real question ─────────────────────────────────────────────────
{
  const target = F.rawEvent("$t", 50, 5000, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$z" });
  const bare = client({ rank: STAFF, held: [target], me: "@me:hs", amOwner: false,
                        settings: { selfWitnessCheckpoint: true } });
  ok(bare.Checkpoint.coverageVerdict().ok === false,
    "E: APPLIED — with the flag ON but NO vouching anywhere, sealing is refused. The old loop "
    + "tested whether each event had an id, which eligible() already guarantees on its first line, "
    + "so the branch was unreachable and the answer was simply the config flag: a client sealed "
    + "with zero vouching and reported mode 'self', a claim asserted by nothing",
    bare.Checkpoint.coverageVerdict());

  const mine = F.rawEvent("$mine", 52, 5000, "@me:hs", STAFF, { t: "ddjp.witness.bundle",
    w: [{ i: "$t", l: 50, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF }] });
  const withMine = client({ rank: STAFF, held: [target, mine], me: "@me:hs", amOwner: false,
                            settings: { selfWitnessCheckpoint: true } });
  const v = withMine.Checkpoint.coverageVerdict();
  ok(v.ok === true && v.mode === "self",
    "E: APPLIED — and once I have actually vouched the span myself, mode 'self' is earned. That is "
    + "the path a lone high-staff uses to carry a room", v);
}

// ── PART F — the witness hold binds the owner ────────────────────────────────────────────────
{
  const sb = client({ amOwner: true, rank: OWNER, hold: { hold: true, remainingMs: 3000, cycleMs: 6000 } });
  const g = sb.Checkpoint.maySeal(10000000);
  ok(g.ok === false && g.reason === "witness-hold",
    "F: APPLIED — an OWNER on arrival, whose shortcut would otherwise fire, still waits out the "
    + "hold. That is the dangerous moment precisely because an owner floor is adopted by everyone "
    + "WITHOUT recompute, so a short owner seed becomes the room's truth. A peer's short seal fails "
    + "safe instead — someone holding the declaration recomputes, mismatches and declines", g);
}

// ── PART G — either trigger, never both ──────────────────────────────────────────────────────
{
  const settings = { checkpointCooldownMs: 1000000, checkpointEvery: 5, selfWitnessCheckpoint: true };
  const sb = client({ amOwner: false, rank: STAFF, settings: settings, now: 500 });
  sb.Checkpoint._setStateForTest({ lastOwnSealAt: 499, lastSealHead: 0, sealedSinceArrival: true });
  const g = sb.Checkpoint.maySeal(500);
  ok(g.ok === true,
    "G: APPLIED — the cooldown is nowhere near elapsed, but the room has produced far more than "
    + "the event threshold, so a seal is due. Making the clock a GATE let a room pile up thousands "
    + "of events and still refuse to bank them, which is the opposite of what the count is for", g);

  // THE CLOCK COVERS SLOW, NOT STILL — and the difference is the whole point. This case used to
  // seed lastSealHead with LOG.length, a RAW count, and compare it against a COUNTABLE head; the
  // difference came out negative and the case passed as "quiet room, clock covers it" while
  // actually describing a room that had gone BACKWARDS. Two plausible integers on different scales,
  // which is the same mix-up the adoption handler in MatrixBridge had.
  const slowSb = client({ amOwner: false, rank: STAFF, settings: settings, now: 9000000, log: LOG });
  const countable = slowSb.Checkpoint._countable(LOG);
  ok(countable >= 2, "G: the fixture has enough countable events to seed a partial stretch", countable);
  // Something changed, but fewer than `every` — so the count will never fire and only the clock can.
  slowSb.Checkpoint._setStateForTest({ lastOwnSealAt: 1, lastSealHead: countable - 1, sealedSinceArrival: true });
  ok(slowSb.Checkpoint.maySeal(9000000).ok === true,
    "G: APPLIED — a room that CHANGED but too slowly for the count is covered by the clock. This is "
    + "the trigger that had no way of being asked at all until the cadence tick was wired: nothing "
    + "polled, so the cooldown could only ever be evaluated when a play or skip arrived, making it a "
    + "rate limit on the count rather than a second reason to seal");

  // AND A ROOM THAT HAS NOT MOVED SEALS NOTHING, clock or no clock. A checkpoint is a claim about
  // where the room IS; restating an unchanged claim costs a message to say the same thing, and
  // because adopting a seal resets everyone else's clock, an idle room would otherwise burn one
  // checkpoint per client per cooldown forever to record that nothing was happening.
  const still = client({ amOwner: false, rank: STAFF, settings: settings, now: 9000000, log: LOG });
  still.Checkpoint._setStateForTest({ lastOwnSealAt: 1, lastSealHead: still.Checkpoint._countable(LOG), sealedSinceArrival: true });
  const sv = still.Checkpoint.maySeal(9000000);
  ok(sv.ok === false && sv.reason === "nothing-changed",
    "G: APPLIED — with the cooldown long elapsed and nothing countable added since the last seal or "
    + "adoption, the answer is nothing-changed rather than a seal. It outranks both triggers because "
    + "it is about whether there is anything to bank, not about whether we are allowed to", sv);

  // It must not starve a quorum: a client whose own last seal is BEHIND the head still seals, and
  // that is exactly the client whose agreement a quorum needs. Only clients already level go quiet.
  const behind = client({ amOwner: false, rank: STAFF, settings: settings, now: 9000000, log: LOG });
  behind.Checkpoint._setStateForTest({ lastOwnSealAt: 1, lastSealHead: 0, sealedSinceArrival: true });
  ok(behind.Checkpoint.maySeal(9000000).ok === true,
    "G: APPLIED — and a client behind the head is unaffected, so the suppression cannot prevent a "
    + "quorum from forming at a cut nobody has banked yet");
}

// ── PART H — the seed is the reducer's own ───────────────────────────────────────────────────
{
  const sb = client({});
  const mine = sb.Checkpoint.build(LOG);
  const theirs = sb.StateDeriver.buildSeed(LOG);
  ok(JSON.stringify(mine) === JSON.stringify(theirs),
    "H: APPLIED — the snapshot is built by the reducer's own buildSeed, from the SAME fold that "
    + "produces the state. Assembling it here would be a second opinion about what the room is");
}

// ── PART I — dials come from the ONE home ────────────────────────────────────────────────────
// Mutation found this gap: changing the module's fallback for a dial left every assertion green,
// because no test ever read a dial from EMPTY settings. Local fallbacks are how two copies of one
// number come to exist, and the drift is always invisible — the room sets a value and one module
// keeps the old one.
{
  const sb = client({ settings: {} });
  const defaults = sb.StateDeriver.defaultSettings();
  for (const dial of ["checkpointEvery", "checkpointCooldownMs", "checkpointRankOffsetMs", "vouchJitter"]) {
    ok(sb.Dials.live({}, dial) === defaults[dial],
      "I: APPLIED — " + dial + " with no room setting resolves to the REDUCER'S default, not to a "
      + "literal written inside a module. A module may READ a dial; it may never RESTATE one",
      { got: sb.Dials.live({}, dial), want: defaults[dial] });
  }
  ok(sb.Dials.live({ checkpointEvery: 7 }, "checkpointEvery") === 7,
    "I: and a room setting overrides it");

  // AND THAT THE MODULE ACTUALLY USES IT. Testing the helper is not testing that the caller reads
  // through it — mutation proved that, by leaving a local fallback of 9999 inside the cadence and
  // watching every assertion above stay green. So this exercises the module's own behaviour with
  // EMPTY settings: with the reducer's default of 40, exactly 40 new events make a seal due; with
  // any local literal the module invented, it would not.
  const every = defaults.checkpointEvery;
  const logAt = (n) => { const out = []; for (let i = 0; i < n; i++) out.push({ eventId: "$e" + i, l: i }); return out; };

  const due = client({ settings: {}, amOwner: false, rank: STAFF, now: 5,
                       log: logAt(every), held: [] });
  due.Checkpoint._setStateForTest({ lastOwnSealAt: 4, lastSealHead: 0, sealedSinceArrival: true });
  ok(due.Checkpoint.maySeal(5).reason !== "not-due",
    "I: APPLIED — exactly the DEFAULT number of new events makes a seal due, so the cadence is "
    + "reading the one home rather than a literal of its own",
    { every: every, verdict: due.Checkpoint.maySeal(5) });

  const notYet = client({ settings: {}, amOwner: false, rank: STAFF, now: 5,
                          log: logAt(every - 1), held: [] });
  notYet.Checkpoint._setStateForTest({ lastOwnSealAt: 4, lastSealHead: 0, sealedSinceArrival: true });
  ok(notYet.Checkpoint.maySeal(5).reason === "not-due",
    "I: APPLIED — and one event short is not due, so the threshold is the real one and not an "
    + "accident of a large fallback", notYet.Checkpoint.maySeal(5));
  ok(sb.Dials.frozen({ settings: { maxLen: 42 } }, { maxLen: 999 }, "maxLen") === 42,
    "I: APPLIED — a FROZEN dial reads the song's own snapshot, never the live blob. Reading live "
    + "would let a mid-song change re-govern a song already playing, and the frozen snapshot would "
    + "then be a lie");
  ok(sb.Dials.frozen({ settings: {} }, { maxLen: 999 }, "maxLen") === 999,
    "I: falling back to live only when the song carries no snapshot at all");
}

// ── PART J — THE OWNER SEALS FIRST, AND ALONE ────────────────────────────────────────────────
// The owner asks a DIFFERENT question. Everyone else must show the span is PROTECTED; the owner
// must show it is COMPLETE. Vouching exists so a deleted event can be rebuilt, and nobody below the
// top rank can delete an owner's message — so an owner sealing its own view is not defending
// against a deletion it cannot see. What it must not do is seal a view with HOLES, because an owner
// floor is adopted by everyone WITHOUT recompute: a short owner seed becomes the room's truth.
{
  // Under the coverage gate the owner had the STRICTEST bar in the room — one owner voucher, and it
  // is the only owner — so on arrival it had to vouch the whole history itself before it could seal
  // anything, while every junior sealed around it. The ladder put the owner at slot zero and the
  // gate then made it last. Measured in the cascade simulation: the owner sealed zero times while
  // six juniors sealed fifteen.
  const bare = client({ amOwner: true, rank: OWNER, held: [], settings: {} });
  const g = bare.Checkpoint.maySeal(10000000);
  ok(g.ok === true && g.mode === "owner-complete",
    "J: APPLIED — an owner with NO vouching anywhere may seal, because coverage was never the "
    + "owner's question", g);

  const asStaff = client({ amOwner: false, rank: STAFF, held: [], settings: {} });
  ok(asStaff.Checkpoint.maySeal(10000000).mode !== "owner-complete",
    "J: and a non-owner does not get that path — it is the owner's exemption, not a loophole");

  // BUT A HOLE STILL STOPS IT. The one thing an owner must not do.
  const holed = client({ amOwner: true, rank: OWNER, settings: {},
    held: [F.rawEvent("$c", 10, 1, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$gone" }),
           F.rawEvent("$w", 11, 2, "@b:hs", STAFF, { t: "ddjp.witness.bundle",
             w: [{ i: "$gone", l: 9, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF }] })] });
  holed.Session._setPhaseForTest(holed.Session.LIVE);
  const first = holed.Checkpoint.maySeal(10000000);
  ok(first.ok === false && first.reason === "waiting-for-repair",
    "J: seeing a gap starts a WAIT, not a refusal — and the wait begins when THIS client noticed, "
    + "which is not the same moment transport saw a redaction go past. A client that joined after "
    + "the deletion never saw one, and must still listen before it seals", first);

  const later = holed.Checkpoint.maySeal(10000000 + 6000);
  ok(later.ok === true && later.mode === "owner-unstick",
    "J: APPLIED — and once the cycle passes the owner seals ANYWAY. Blocking permanently would let "
    + "one vanished event stop the room banking anything ever again", later);
}

// ── PART J2 — THE WAIT IS BOUNDED, AND OFFLINE CANNOT STRAND IT ──────────────────────────────
// A gap means WAIT — one repair cycle, purely listening, while whoever holds the missing event
// vouches it. If it never arrives, THE OWNER SEALS ANYWAY. That is not the rule failing; it is the
// point of having an owner. An unfillable hole means the event is genuinely gone, and a room that
// refuses to bank anything until a vanished event returns is a room that never banks again.
{
  const holed = () => [
    F.rawEvent("$c", 10, 1, "@a:hs", STAFF, { t: "ddjp.dj.play", p: "$gone" }),
    F.rawEvent("$w", 11, 2, "@b:hs", STAFF, { t: "ddjp.witness.bundle",
      w: [{ i: "$gone", l: 9, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF }] })];

  const waiting = client({ amOwner: true, rank: OWNER, held: holed(), settings: {},
                           hold: { hold: true, remainingMs: 3000, cycleMs: 6000 } });
  waiting.Session._setPhaseForTest(waiting.Session.LIVE);
  const w = waiting.Checkpoint.maySeal(10000000);
  ok(w.ok === false,
    "J2: while the repair cycle is still running the owner WAITS — purely listening, so a vouch "
    + "that is on its way still gets to arrive", w);

  const expired = client({ amOwner: true, rank: OWNER, held: holed(), settings: {},
                           hold: { hold: false, remainingMs: 0, cycleMs: 6000 } });
  expired.Session._setPhaseForTest(expired.Session.LIVE);
  expired.Checkpoint.maySeal(10000000);                 // notice the gap, starting the wait
  const e = expired.Checkpoint.maySeal(10000000 + 6000); // one full cycle later
  ok(e.ok === true && e.mode === "owner-unstick" && e.over === "corroborated-gap",
    "J2: APPLIED — once the cycle passes with nobody filling it, the owner seals ANYWAY and says "
    + "what it sealed over. A seal across a known hole is a different event from a clean one, and "
    + "a caller that cannot tell them apart cannot report it either", e);

  // AND THE STAMP CLEARS WHEN THE VIEW IS WHOLE AGAIN, so the NEXT gap gets its own listening
  // period. Without this the first gap's stamp stays set forever and every later gap is sealed over
  // instantly — the wait would work exactly once per client, then silently stop being a wait.
  let holes = holed();
  const reused = client({ amOwner: true, rank: OWNER, settings: {},
                          held: () => holes, hold: { hold: false, remainingMs: 0, cycleMs: 6000 } });
  reused.Session._setPhaseForTest(reused.Session.LIVE);
  reused.Checkpoint.attach({ held: () => holes });
  reused.Continuity.attach({ held: () => holes, settings: () => ({}), floorL: () => -1 });

  // THE TIMES MATTER. A first version used 1000 / 2000 / 3000 and proved nothing: a STALE stamp at
  // 1000 has not expired by 3000 either, so the client waits under both readings. The second gap
  // has to appear AFTER the first stamp's cycle would have run out — only then does a stamp that
  // failed to clear show itself, by sealing instantly instead of listening.
  reused.Checkpoint.maySeal(1000);                       // gap seen — wait starts
  holes = [];                                            // somebody filled it
  ok(reused.Checkpoint.maySeal(2000).mode === "owner-complete",
    "J2: the gap filled, so the seal is clean rather than an unstick");

  holes = holed();                                       // a NEW gap, well past the first cycle
  const second = reused.Checkpoint.maySeal(20000);
  ok(second.ok === false && second.reason === "waiting-for-repair",
    "J2: APPLIED — and the new gap gets its OWN listening period. If the stamp never cleared, the "
    + "wait would work exactly once per client and then silently stop being a wait — every later "
    + "gap sealed over instantly, with nothing to show it had happened", second);

  // ONE CLOCK, NOT TWO. The wait reuses the same hold the gate above already consults. Two clocks
  // for one wait is how two modules come to disagree about whether they are still waiting.
  const cp = require("fs").readFileSync(
    require("path").join(__dirname, "..", "backends/backend1/checkpoint.js"), "utf8");
  ok(!/setTimeout|Date\.now\(\)\s*\+/.test(cp),
    "J2: APPLIED — and the wait keeps no clock of its own");
}

// ── PART J3 — OFFLINE CANNOT STRAND THE OWNER ────────────────────────────────────────────────
// The wait is measured against a stamp, so an owner that goes offline mid-wait comes back to an
// expired hold — and would seal immediately over a hole the backlog was about to fill.
//
// It does not, and the reason is worth stating because it is not a rule anyone added: the PHASE
// gate refuses before the hold is ever consulted. A returning client is CATCHING-UP until its log
// stops growing, so by the time it is entitled to seal, the backlog is already in and the hole is
// either filled or genuinely gone. Two independent mechanisms, and the ordering makes them compose.
{
  const c = client({ amOwner: true, rank: OWNER, held: [], settings: {},
                     hold: { hold: false, remainingMs: 0, cycleMs: 6000 } });
  for (const phase of ["suspended", "catching-up", "replaying"]) {
    c.Session._setPhaseForTest(phase);
    const r = c.Checkpoint.maySeal(10000000);
    ok(r.ok === false && r.reason === "not-live",
      "J3: an owner in phase " + phase + " does not seal, however long its hold has been expired", r);
  }
  c.Session._setPhaseForTest(c.Session.LIVE);
  ok(c.Checkpoint.maySeal(10000000).ok === true,
    "J3: APPLIED — and once caught up it proceeds. The gate is the PHASE, not the network: a client "
    + "that cannot reach the server is simply never LIVE, so 'offline' needs no special case");
}

// ── PART K — ADOPTING A FLOOR RESETS THE CLOCK ───────────────────────────────────────────────
// The line that makes the cascade a cascade with no coordination protocol at all.
{
  // ASSERTED AS AN OUTCOME, not as a mechanism. This used to call noteAdopted with no floor at all
  // and check that a local timestamp had moved — which passed even after the local timestamp stopped
  // being the thing that quiets anyone, and would have kept passing if adoption stopped working
  // entirely. Adoption now quiets a client through the two derived paths: the clock reads the
  // floor's own timestamp and the count reads how much of the log that floor covers.
  const settings = { checkpointCooldownMs: 1000000, checkpointEvery: 999999 };
  const NEWEST = LOG.reduce((m, e) => Math.max(m, e.ts || 0), 0);
  const held = { ts: null, pos: null };   // the floor this client holds, changed mid-test
  const sb = client({ amOwner: false, rank: STAFF, settings: settings, now: 5000000, log: LOG,
                      floorTs: () => held.ts, floorPos: () => held.pos });
  sb.Checkpoint._setStateForTest({ lastOwnSealAt: 1, lastSealHead: 0, sealedSinceArrival: true });
  ok(sb.Checkpoint.maySeal(5000000).reason !== "not-due",
    "K: setup — holding NO floor, this client is due (probe applied: if it were already quiet, the "
    + "assertion below would pass without adoption doing anything)");

  // Now it holds a floor dated to the newest thing in the log — somebody just sealed.
  held.ts = NEWEST; held.pos = 10000;
  sb.Checkpoint.noteAdopted(5000000, 10000);
  const after = sb.Checkpoint.maySeal(5000000);
  ok(after.ok === false && after.reason === "nothing-changed",
    "K: APPLIED — accepting somebody's floor quiets me completely. Their snapshot banked this "
    + "stretch; mine would say the same thing at a cost. The reason is NOTHING-CHANGED rather than "
    + "not-due, and that is the honest answer: a floor at the head leaves nothing above it to bank. "
    + "With a live owner this is what leaves the owner as the only client sealing at all",
    after);

  // THE COUNTER IS NOT RESET, and that is deliberate.
  const busy = client({ amOwner: false, rank: STAFF, now: 5000000, log: LOG,
                        settings: { checkpointCooldownMs: 1000000, checkpointEvery: 5 } });
  busy.Checkpoint._setStateForTest({ lastOwnSealAt: 4999999, lastSealHead: 0, sealedSinceArrival: true });
  busy.Checkpoint.noteAdopted(5000000);
  ok(busy.Checkpoint.maySeal(5000000).reason !== "not-due",
    "K: APPLIED — but the COUNTER survives. Adopting a floor at event 500 while the room is at 900 "
    + "leaves 400 events genuinely unbanked, and resetting both would let a busy room coast on a "
    + "floor already far behind", busy.Checkpoint.maySeal(5000000));
}

// ═══ THE DRIFT ANNOUNCEMENT — the half that made this invisible for two days ════════════════
// v276 fixed the arithmetic and added `counter-drift` so a stalled room would stop looking like an
// idle one. **The announcement was never pinned**: folding it back into `nothing-changed` left all
// 139 guards green, so the precise condition that hid a permanently stalled room for two days
// could be restored by one word with the suite's approval.
//
// AND WRITING THIS ROW FOUND THE ANNOUNCEMENT WAS UNREACHABLE. The fallback clamped with
// `Math.max(0, …)` — **the exact thing v276 rejected** — applied to the legacy path, which is
// precisely the clients that upgrade INTO the stalled state. `_countable` cannot return a
// negative, so the clamp removed the only other route and the branch was dead code. That is why
// the word could be changed with no effect: there was nothing to change.
{
  // A CLIENT CARRYING AN OLD PERSISTED ANCHOR: `lastSealHead` written by a previous build,
  // `sealedThroughL` absent, and a log that has since been trimmed below where that tally was
  // taken. This is the upgrade path, not a contrived state.
  const TRIMMED = LOG.filter((e) => e.l > 3);
  const c = client({ log: TRIMMED, floorPos: -1, held: [] });
  const STALE = c.Checkpoint._countable(LOG) + 20;   // a tally from a longer log
  c.Checkpoint._setStateForTest({ lastSealHead: STALE, sealedSinceArrival: true });

  // THE PREMISE: the fixture must actually produce a negative. Without this the row passes
  // against a case it never reached — the shape that has taken two rows this month.
  const head = c.Checkpoint._countable(TRIMMED);
  ok(head - STALE < 0,
    "DRIFT: APPLIED — the fixture must put the anchor ABOVE the head, or the row below asserts a " +
    "refusal for a reason that has nothing to do with drift",
    { head: head, staleAnchor: STALE, changed: head - STALE });

  const r = c.Checkpoint.maySeal();
  ok(r && r.ok === false,
    "DRIFT: APPLIED — sealing must be refused", r);
  ok(r.reason === "counter-drift",
    "DRIFT: A NEGATIVE COUNT IS ANNOUNCED AS ITS OWN REASON, not folded into `nothing-changed`. " +
    "A stalled room and an idle room must not look the same — that identity is why two live " +
    "clients reported `nothing-changed` for two days while sealing was permanently impossible",
    r.reason);
  ok(typeof r.newEvents === "number" && r.newEvents < 0,
    "DRIFT: and it CARRIES the negative, so a reader sees the impossible value rather than a " +
    "verdict about it", r.newEvents);

  // AND IT REPAIRS. Announcing without repairing leaves the room stalled but audible; the anchor
  // is re-based onto the scale a trim cannot move, so the next tick recovers.
  ok(typeof r.rebasedTo === "number",
    "DRIFT: the anchor is RE-BASED onto a log position — announcing a stall the client cannot " +
    "leave would be an improvement on silence and not a fix", r.rebasedTo);
  const again = c.Checkpoint.maySeal();
  ok(again.reason !== "counter-drift",
    "DRIFT: and the NEXT tick is no longer drifting — the repair took, so this announces once " +
    "rather than every tick forever", again);

  // THE CONTROL: an ordinary idle client still says `nothing-changed`, so the new reason is a
  // reading of an impossible value rather than a rename of the old refusal.
  const idle = client({ log: LOG, floorPos: -1, held: [] });
  idle.Checkpoint._setStateForTest({ sealedThroughL: Math.max.apply(null, LOG.map((e) => e.l)),
                                     sealedSinceArrival: true });
  const ir = idle.Checkpoint.maySeal();
  ok(ir.ok === false && ir.reason === "nothing-changed",
    "DRIFT control: a client level with the head still reports `nothing-changed` — the two " +
    "refusals are distinguishable, which is the entire point", ir);
}

console.log("[checkpoint] PASS — a checkpoint is a claim about NOW and this module only emits it: "
  + "selecting, chaining and re-validating a floor are gone from here; a client that is not LIVE "
  + "seals nothing, and one whose room moved while it waited its slot stands down; coverage is "
  + "judged at MY bar over the SEGMENT since my floor rather than the whole history, so a floor "
  + "makes the seal free; self-witness is a real question rather than the config flag; the witness "
  + "hold binds the owner precisely because owner floors are adopted without recompute; the clock "
  + "and the count are two reasons rather than a gate and a condition, and BOTH of them measure "
  + "from the floor this client holds, so accepting somebody's floor quiets it completely while a "
  + "checkpoint it could not adopt does not; the seed is the "
  + "reducer's own so snapshot and state cannot disagree; and every dial resolves to the one "
  + "home rather than a literal written here");
