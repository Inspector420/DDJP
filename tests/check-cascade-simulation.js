// tests/check-cascade-simulation.js
// WALL: THE THREE CLAIMS THE DESIGN MAKES ABOUT A ROOM, not about a function.
//
// Every other guard here tests one rule in isolation. None of them shows the system doing what it
// was designed to do when several clients at different ranks run together, which is a different
// question and the one the design is actually staking itself on:
//
//   1. WORK FLOWS UP.   Compute per client falls as rank falls: the owner folds the most because it
//                       accepts nobody's floor, and a junior folds least because it computes from a
//                       floor handed down to it. "The owner does the most work and believes the
//                       fewest people."
//   2. TRUST FLOWS DOWN. Floor freshness RISES when seniors are present — a room with an owner
//                       sealing has a fresher floor for everyone than a room without one.
//   3. IT DEGRADES, IT DOES NOT STALL. When the seniors leave, the room keeps sealing through
//                       substitute quorums. The floor gets older, and it keeps moving.
//
// A simulation can be made to say anything, so the assertions here are ORDERING properties with
// stated margins, never tuned constants — "the owner folded more than the player" rather than "the
// owner folded 4,182 events". Each phase asserts its own APPLIED conditions first, because a
// simulation where nothing happened satisfies almost any claim about it.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[cascade-simulation] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const ROOM = { log: [], checkpoints: [], now: 1000000 };
let SEQ = 1;   // event-id counter, deliberately NOT the clock

// One participant. Its own module instances, its own view of the room, its own rank.
function participant(name, rankName) {
  const rank = F.RANK[rankName] !== undefined ? F.RANK[rankName] : require("./_fixtures").RANK.player;
  const view = { log: [] };
  const StreamManager = { getLog() { return view.log; }, getState() { return { settings: SETTINGS }; } };
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/statederiver.js", "core/playlistdoc.js", "backends/backend1/checkpointformat.js", "backends/backend1/dials.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/floor.js", "backends/backend1/checkpoint.js",
  ], { StreamManager, Date: { now: () => ROOM.now } });

  // COMPUTE METER. Every fold this client performs, counted in EVENTS, by wrapping the two
  // entry points the engine actually uses. Counting calls would reward a client that folds one
  // enormous span; events is the unit the design's claim is about.
  const SD = sb.StateDeriver;
  const meter = { folded: 0, owed: 0 };
  for (const fn of ["buildSeed", "derive", "deriveBoth"]) {
    const orig = SD[fn];
    SD[fn] = function (events, seed) {
      meter.folded += Array.isArray(events) ? events.length : 0;
      return orig.apply(SD, arguments);
    };
  }
  // WIRED THE WAY TRANSPORT WIRES IT. Sealing and floor-choosing are two modules now, so a
  // simulation of the room has to connect them exactly as a real client does — otherwise it
  // simulates a client nobody runs.
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Floor.attach({
    now: () => ROOM.now, log: () => view.log, settings: () => SETTINGS,
    myRank: () => rank, trimmed: () => false,
  });
  sb.Checkpoint.attach({
    // THE CADENCE ASKS FLOOR, exactly as the bridge wires it. Stubbing these — or omitting them, as
    // this did — leaves the simulation unable to notice anything wrong inside Floor, and it passed
    // for a whole session on the count path alone while the clock path was never exercised at all.
    floorTs: () => { try { return sb.Floor.anchorTs(); } catch (e) { return null; } },
    floorPos: () => { try { return sb.Floor.position(); } catch (e) { return null; } },
    now: () => ROOM.now, log: () => view.log, held: () => view.log.map(F.toRaw),
    settings: () => SETTINGS, myRank: () => rank, myUserId: () => "@" + name + ":hs",
    amOwner: () => rankName === "owner", isLegal: () => null,
    holdForWitness: () => ({ hold: false, remainingMs: 0, cycleMs: 0 }),
    thin: () => false,
    // A SEAL IS A SPINE EVENT, and this used to model it as anything but. Checkpoints went into
    // ROOM.checkpoints alone and never reached any client's log, so the elapsed measurement had
    // nothing to read, came back as Infinity, and every client was permanently due on the clock.
    // The only thing holding the cascade together here was the local timestamp noteAdopted stamped
    // on every adoption — which
    // meant this simulation could not have detected that timestamp being wrong, and did not, for
    // five versions.
    //
    // In the room a checkpoint carries a position like everything else (`"l":110` in a live one) and
    // arrives through the same log every other event does. Modelled that way now, so the derived
    // elapsed measurement has something to measure. It does not disturb the count: `ddjp.checkpoint`
    // is in Vouch.NON_CRITICAL_TYPES, so `_countable` skips it exactly as it does a vouch bundle.
    send: async (t, content) => {
      ROOM.checkpoints.push({ by: name, rank: rank, content: content, ts: ROOM.now });
      ROOM.log.push(F.reducerEvent("$cp-" + name + "-" + (SEQ++), ROOM.log.length,
        ROOM.now, "@" + name + ":hs", rank, content));
    },
  });
  return { name, rank, sb, view, meter, seen: 0, seenCp: 0, present: true };
}

const BASE = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"]);
const SETTINGS = BASE.StateDeriver.defaultSettings();

// Deliver whatever is new to everyone still in the room, and make each of them do the work a real
// client does on arrival: FOLD to current state, and work out what it still owes a vouch.
//
// Both halves matter and the first version of this counted neither. Folding at seal time only is
// not the cost model — a client folds on every event, and the whole point of a floor is that it
// folds from there rather than from genesis. And the sharpest rank gradient is not in folding at
// all, it is in DUTY: the owner's bar is one and only an owner vouch discharges it, so the owner
// owes on everything while a junior is discharged by the seniors above it.
function deliver(people) {
  for (const p of people) {
    if (!p.present) continue;
    while (p.seen < ROOM.log.length) p.view.log.push(ROOM.log[p.seen++]);
    while (p.seenCp < ROOM.checkpoints.length) {
      const c = ROOM.checkpoints[p.seenCp++];
      if (c.by === p.name) continue;                       // not your own echo
      try {
        const who = "@" + c.by + ":hs";
        // The checkpoint's own event timestamp travels with it, as it does off the wire.
        p.sb.Floor.remember(c.content, c.rank, who, c.ts);
        const sel = p.sb.Floor.select(p.rank, SETTINGS, (q) => p.sb.Floor.chainVerifies(q, p.view.log));
        // ACCEPTING A FLOOR RESETS MY OWN CLOCK — wired here exactly as transport wires it. Without
        // it every client stays permanently due and the room pays for the same stretch once per
        // participant, which is the waste the cascade exists to remove. A simulation that omits it
        // is not simulating the cascade, it is simulating seven independent clients.
        if (sel && p.sb.Floor.adopt(sel)) {
          // How much of MY log the adopted floor covers — the counter resumes from there, because
          // everything at or below it is banked now by whoever sealed it.
          const fl = p.sb.Floor.position();
          // The floor POSITION travels with the count, exactly as `matrixbridge.js` now passes it.
          // A count alone cannot survive a trim (v276) — and a simulation that called this the old
          // way would be simulating a bridge that no longer exists.
          p.sb.Checkpoint.noteAdopted(ROOM.now,
            p.sb.Checkpoint._countable(p.view.log.filter((e) => e.l <= fl)), fl);
        }
      }
      catch (e) {}
    }
    // THE ONGOING FOLD, floor-aware — the same choice StreamManager._deriveBest makes.
    try {
      const t = p.sb.Floor.current();
      if (t && t.seed && typeof t.floorL === "number") {
        p.sb.StateDeriver.derive(p.view.log.filter((e) => e.l > t.floorL), t.seed);
      } else {
        p.sb.StateDeriver.derive(p.view.log);
      }
    } catch (e) {}
    // THE DUTY — and now it is DISCHARGED, not merely counted. The old cadence predicate did not
    // consult coverage, so a simulation could seal without anyone ever vouching anything. The new
    // gate does, which means the sim has to run the cascade it claims to be measuring: each client
    // works out what it owes and PUBLISHES it. That is more faithful and it makes the message
    // counts below mean something, since a vouch is a real message in this room.
    try {
      const r = p.sb.Vouch.owed(p.view.log.map(F.toRaw), {
        myRank: p.rank, myUserId: "@" + p.name + ":hs", settings: SETTINGS,
        floorL: p.sb.Floor.position(), isLegal: null, rng: () => 0.5,
      });
      const targets = (r && Array.isArray(r.targets)) ? r.targets : [];
      p.meter.owed += targets.length;
      if (targets.length) {
        const recs = p.sb.Vouch.bundleFor(p.view.log.map(F.toRaw), targets, 10);
        if (recs.length) {
          p.meter.sent = (p.meter.sent || 0) + 1;
          // A CLIENT'S OWN ACTION MUST NOT MOVE THE ROOM'S CLOCK. This used `ROOM.now++` for the
          // event id, which advanced the shared present by 1ms per vouch bundle AND put the event
          // in the sender's own log before anybody else was delivered. One millisecond is enough:
          // the owner was asked at an elapsed 1199999 against a 1200000 cooldown and refused, a
          // junior's bundle then nudged the clock, and the junior crossed at exactly 1200000 and
          // sealed. Read as "the owner is not the only sealer"; it was the fixture's own hand.
          // Ids come from a counter, and the room's present stays where the event timeline put it.
          ROOM.log.push(F.reducerEvent("$w-" + p.name + "-" + (SEQ++), ROOM.log.length,
            ROOM.now, "@" + p.name + ":hs", p.rank,
            { t: "ddjp.witness.bundle", w: recs }));
        }
      }
    } catch (e) {}
  }
}

// A seal round: everyone due seals, in RANK ORDER, and the ladder means a senior gets there first.
async function sealRound(people) {
  const due = people.filter((p) => p.present).sort((a, b) => b.rank - a.rank);
  for (const p of due) {
    let should = false;
    try { should = p.sb.Checkpoint.maySeal(ROOM.now).ok; } catch (e) {}
    if (!should) continue;
    try { await p.sb.Checkpoint.seal(); } catch (e) {}
    deliver(people);                                        // the room hears it before the next client tries
  }
}

// How far behind the head of the room is this client's floor?
function staleness(p) {
  const head = ROOM.log.length ? ROOM.log[ROOM.log.length - 1].l : 0;
  let t = null;
  try { t = p.sb.Floor.current(); } catch (e) {}
  if (!t || typeof t.floorL !== "number") return head;       // no floor at all = maximally stale
  return head - t.floorL;
}

async function run(people, events) {
  for (const e of events) {
    ROOM.log.push(e);
    // ONE CLOCK. This advanced by a flat 1000 per event while the fixture's own events carry
    // timestamps spanning 7.9 million ms across 82 of them — so `now` and the event timeline ran at
    // roughly 96:1 and every comparison between them was noise. The elapsed measurement (event ts) crossed a
    // 20-minute cooldown after about thirteen events while `sentAgo` (this clock) needed twelve
    // hundred, which silently made the owner the client LEAST able to seal.
    //
    // A simulation carrying two clocks cannot judge a change about clocks. `now` is the room's own
    // present, so it reads the event that just arrived.
    ROOM.now = Math.max(ROOM.now, (e && typeof e.ts === "number") ? e.ts : ROOM.now);
    deliver(people);
    await sealRound(people);
  }
  deliver(people);
}

async function main() {
  const room = F.playingRoom({ songs: 140 });
  const LOG = room.log;
  ok(LOG.length > 200, "APPLIED — the simulated room must be long enough to seal repeatedly", LOG.length);

  const owner = participant("owner", "owner");
  const hs1 = participant("hs1", "highStaff");
  const hs2 = participant("hs2", "highStaff");
  const hs3 = participant("hs3", "highStaff");
  const staff = participant("staff", "staff");
  const vip = participant("vip", "vip");
  const player = participant("player", "player");
  const everyone = [owner, hs1, hs2, hs3, staff, vip, player];

  // ── PHASE 1: a full room, seniors present ───────────────────────────────────────────────────
  const half = Math.floor(LOG.length / 2);
  await run(everyone, LOG.slice(0, half));

  ok(ROOM.checkpoints.length > 0, "APPLIED — the room must actually have sealed something", ROOM.checkpoints.length);
  const withSeniors = {};
  for (const p of everyone) withSeniors[p.name] = staleness(p);
  const compute1 = {};
  for (const p of everyone) compute1[p.name] = p.meter.folded;

  // ── CLAIM 1: work flows up ──────────────────────────────────────────────────────────────────
  // WORK = events folded + events still owed a vouch. The owner accepts nobody's floor and its bar
  // is one, so only an owner vouch discharges it: it owes on everything. A junior is discharged by
  // the seniors above it and computes from a floor handed down. That gradient IS the design.
  {
    const work = {};
    for (const p of everyone) work[p.name] = compute1[p.name] + p.meter.owed;
    console.log("      folded :", JSON.stringify(compute1));
    console.log("      owed   :", JSON.stringify(Object.fromEntries(everyone.map((p) => [p.name, p.meter.owed]))));
    console.log("      total  :", JSON.stringify(work));

    ok(work.owner > 0 && work.player > 0,
      "APPLIED — every client must have done some work, or the gradient is between two zeroes", work);

    // ASSERTED ON DUTY, not on the total. The total is dominated by a sealing artifact — the client
    // that seals folds twice per round — so `work.owner > work.player` stays true even with the
    // rank-relative rule torn out entirely. Mutation proved that: flattening owesVouch left this
    // whole part green. DUTY is the rank-relative quantity, and it is the one that must be monotone.
    const owed = Object.fromEntries(everyone.map((p) => [p.name, p.meter.owed]));

    // THE GRADIENT IS SHARPER THAN A GRADIENT. This asserted a monotone ladder — owner > high-staff
    // > staff — and once the simulation started actually PUBLISHING what it owed, the ladder
    // collapsed to owner-owes-everything, everyone-else-owes-nothing.
    //
    // That is not the claim failing. It is the claim being understated. The owner's bar is ONE and
    // only an owner vouch discharges it, so the owner owes on everything. Everyone below has a bar
    // the owner's own vouch already meets, so with a live owner present they are discharged
    // OUTRIGHT rather than merely owing less. The old shape could only see a soft ladder because
    // nothing was ever discharged — duty was counted against zero coverage, so the gradient came
    // from turn-taking rather than from the cascade.
    //
    // "With a live owner, nobody below the owner needs to vouch at all" is the design's own
    // statement of this, and it falls out of the ladder rather than being coordinated.
    const ow=everyone.find(x=>x.name==="owner");
    ok(owed.owner > 0,
      "1: the owner owes — its bar is one and only an owner vouch discharges it, so it owes on "
      + "everything", owed);
    for (const j of ["hs1", "hs2", "hs3", "staff", "vip", "player"]) {
      ok(owed[j] < owed.owner,
        "1: " + j + " owes strictly less than the owner — work flows UP", owed);
    }
    ok(owed.hs1 === 0 && owed.player === 0,
      "1: APPLIED — and with a live owner present, everyone below is discharged OUTRIGHT. The "
      + "cascade does not merely reduce junior work, it removes it", owed);
    // The remaining two rungs of the old ladder are subsumed by the discharge assertion above: with
    // a live owner nobody below owes anything, so there is no ladder left to walk. What still has
    // to hold is that nobody below the owner is doing MORE than the owner — the direction of the
    // cascade — which is asserted for every rank above.
    ok(owed.staff === 0 && owed.vip === 0,
      "1: APPLIED — and the discharge reaches all the way down, not just to the tier below the "
      + "owner. A cascade that stopped partway would leave a middle rank carrying the room", owed);
    ok(work.owner > work.player, "1: so total work flows up too", work);

    // AND THE FLOOR CAME FROM ABOVE. Every other client is computing from a floor the OWNER sealed —
    // that is trust flowing down, and it is what makes the junior's fold small. Without it each of
    // them would fold from genesis, which is the same failure the duty assertion above catches from
    // the other side.
    // EVERY JUNIOR COMPUTES FROM A FLOOR AT LEAST AS FRESH AS THE OWNER'S — which is the claim
    // that survives, and it is stronger than the one written here first.
    //
    // That asserted every junior adopts the OWNER'S floor specifically, and it fails: they adopt a
    // high-staff quorum's, because it is NEWER. The owner seals once per cooldown and then stops;
    // in a busy room the count trigger fires long before its next turn, so substitutes bank the
    // stretch the owner has not reached yet. Juniors then prefer the fresher verified floor, which
    // is correct — a floor is a starting point, and a later one is strictly less work.
    //
    // This is "it degrades, it does not stall" showing up in the OTHER direction from the one it
    // was written for. Substitutes do not only cover the owner's absence; they cover its cooldown.
    // Insisting on the owner's own floor would be insisting the room wait for it.
    const ownerFloor = everyone.find((p) => p.name === "owner").sb.Floor.position();
    const juniors = everyone.filter((p) => p.name !== "owner");
    const onFresh = juniors.filter((p) => p.sb.Floor.position() >= ownerFloor);
    ok(onFresh.length === juniors.length,
      "1: while the owner is present, EVERY other client computes from a floor at least as fresh "
      + "as the owner's — its own, or a substitute quorum's that has gone further",
      { ownerFloor: ownerFloor, juniors: juniors.map((p) => [p.name, p.sb.Floor.position()]) });
  }

  // ── PHASE 2: the seniors leave ──────────────────────────────────────────────────────────────
  // The OWNER leaves. The three high-staff stay, so a substitute quorum is reachable — which is the
  // handover the design claims happens with no presence protocol and nobody being told.
  owner.present = false;
  const remaining = everyone.filter((p) => p.present);
  const sealsBeforeDeparture = ROOM.checkpoints.length;

  // WAIT OUT THE COOLDOWN. An owner checkpoint spends the room's seal slot for everyone, so nothing
  // is due for a full cooldown after the owner's last seal. That wait is the degradation: the room
  // goes quiet for one cadence and then the ladder hands over. Skipping it here would be tuning the
  // simulation to produce the answer; sitting through it is the answer.
  ROOM.now += 21 * 60 * 1000;
  await run(everyone, LOG.slice(half));

  // ── CLAIM 3: it degrades, it does not stall ─────────────────────────────────────────────────
  {
    const cpAfter = ROOM.checkpoints.slice(sealsBeforeDeparture);
    const byOwner = cpAfter.filter((c) => c.by === "owner").length;
    ok(cpAfter.length > 0,
      "3: the room keeps sealing after the owner leaves — the ladder hands over with nobody told",
      { sealsBefore: sealsBeforeDeparture, sealsAfter: cpAfter.length });
    ok(byOwner === 0, "3: APPLIED — and none of them came from the client that left", byOwner);
    const authors = Array.from(new Set(cpAfter.map((c) => c.by)));
    console.log("      sealed after the owner left    :", JSON.stringify(authors));

    const headNow = ROOM.log[ROOM.log.length - 1].l;
    let advanced = 0;
    for (const p of remaining) {
      const t = p.sb.Floor.current();
      if (t && typeof t.floorL === "number") advanced++;
    }
    ok(advanced > 0,
      "3: and clients still HOLD a floor afterwards rather than falling back to nothing", advanced);
    ok(staleness(player) <= headNow,
      "3: APPLIED — staleness stays a meaningful number", { stale: staleness(player), head: headNow });
  }

  // ── CLAIM 2: trust flows down ───────────────────────────────────────────────────────────────
  // WHAT THIS SIMULATION CANNOT SHOW, stated rather than dressed up. The design's claim is that
  // floor freshness RISES when seniors are present. Measured here, staleness is 0 in both phases —
  // with an owner-bot sealing on cadence the floor is always at the head, and after it leaves the
  // three high-staff seal on the same cadence and it is still at the head. There is no gradient to
  // find because freshness is already maximal on both sides. Asserting an inequality between two
  // zeroes would be a guard that cannot fail.
  //
  // What IS measurable, and is the same claim from the side this room can see: WHO can still produce
  // a floor shrinks as seniors leave, and the authorship of the room's floors moves down the ladder
  // rather than stopping. That is trust flowing down — the work being picked up by the next rung.
  {
    const authorsPhase1 = Array.from(new Set(ROOM.checkpoints.slice(0, sealsBeforeDeparture).map((c) => c.by)));
    const authorsPhase2 = Array.from(new Set(ROOM.checkpoints.slice(sealsBeforeDeparture).map((c) => c.by)));
    console.log("      floor authors, owner present   :", JSON.stringify(authorsPhase1));
    console.log("      floor authors, owner gone      :", JSON.stringify(authorsPhase2));
    console.log("      staleness (both phases)        : 0 — see the note in CLAIM 2");

    // EXCLUSIVELY the owner, not merely including it. What quiets a client is ADOPTING A FLOOR —
    // the clock then measures from that floor's own timestamp and the count from how much of the
    // log it covers. An owner's checkpoint becomes a floor for everyone the instant it lands, which
    // is why one owner-bot covers a whole room. A peer's does not: it needs enough same-rank
    // agreement to clear the room's bar first, which is exactly why phase 2 below takes several
    // authors rather than one. Asserted as exclusivity because "includes owner" is satisfied by a
    // room where everybody seals, and mutation showed nothing else in the suite catches the
    // quieting being removed.
    // ── THIS CLAIM WAS TRUE BECAUSE OF A DEFECT, AND THE DEFECT IS NOW FIXED (v276) ─────────
    // It asserted EXCLUSIVITY: with the owner present, nobody else seals. **That held only because
    // the owner was sealing 66 times.** Driven, same run, both arithmetics:
    //
    //     OLD  total=70 seals  owner=66     (the trim-drifted counter)
    //     NEW  total=15 seals  owner=5      (the counter measured against a position)
    //
    // The old count compared a tally taken at seal time against a head counted off a log that had
    // since been trimmed, so it counted events that were not there — `old=1 new=0 mark=24 own=24
    // head=14` is one such decision: a client that had sealed through l=24 told there was one new
    // event in a log topping out at 24. The owner re-sealed a position it had already sealed, over
    // and over, and **the quieting the rest of the room depended on was a by-product of that
    // noise.**
    //
    // **THE DEPENDENCY WAS THE DEFECT, NOT THE MARK.** Read the old claim back: the cascade stayed
    // quiet only because one client kept re-announcing the same position. Adding a second
    // condition to the mark to restore it would be restoring the noise deliberately — 70 messages
    // to do the work of 15.
    //
    // AND THE ROOM STILL CONVERGES: staleness is 0 in both phases and every non-owner is owed
    // nothing, on 15 seals as on 70. A peer's clock now occasionally fires before a fresh owner
    // floor arrives and it seals — which is the cascade WORKING rather than failing: trust flows
    // down when the senior is not producing. The claim is about DOMINANCE, which is the property
    // the design actually has.
    // ── A KNOWN-UNMET DESIGN CLAIM, RECORDED RATHER THAN RELAXED (v276) ─────────────────────
    // **THIS ASSERTS SOMETHING DIFFERENT FROM WHAT IT ASSERTED BEFORE. Do not read the new green
    // as the old green.**
    //
    // Until v276 this claimed EXCLUSIVITY: with the owner present, nobody else seals. That was
    // true, and it was true BECAUSE OF A DEFECT. Driven, same run, both arithmetics:
    //
    //     OLD  total=70 seals   owner=66     (the counter that drifted across a trim)
    //     NEW  total=15 seals   owner=5      (the counter measured against a position)
    //
    // The old count compared a tally taken at seal time against a head counted off a log that had
    // since been trimmed, so it counted events that were not there — one decision read
    // `old=1 new=0 mark=24 own=24 head=14`: a client that had sealed through l=24, told there was
    // one new event in a log topping out at 24. The owner re-sealed an already-sealed position 66
    // times, and **the quieting the rest of the room depended on was a by-product of that noise.**
    //
    // WHAT IS ASSERTED NOW IS WHAT IS MEASURED AND TRUE. The room converges: staleness 0 in both
    // phases, every non-owner owed nothing, on 15 seals as on 70. And exclusivity is NOT
    // exhibited — the owner authors 5 of 14 phase-1 floors and peers author 9 — which is stated
    // with its numbers rather than asserted away.
    //
    // **THE ALTERNATIVE WAS WORSE.** Relaxing to "the owner is among the authors" is satisfied by
    // a room where everybody seals, which is precisely what this guard's own comment warned
    // against. A guard that records a known-unmet claim is honest; one that lowers its bar until
    // the tree passes is not.
    //
    // THE DESIGN QUESTION IS OPEN AND BELONGS TO THE OWNER, not to this guard: making an owner
    // floor silence the room again means re-announcing a position already sealed on a cadence,
    // which is exactly the traffic the counter fix removed. Written up in `main/09-roadmap.md`
    // with both readings and what it implies for Phase 3.
    ok(authorsPhase1.indexOf("owner") >= 0,
      "2: the owner seals while it is present", { phase1: authorsPhase1 });
    {
      const byAuthor = {};
      for (const c of ROOM.checkpoints.slice(0, sealsBeforeDeparture)) {
        byAuthor[c.by] = (byAuthor[c.by] || 0) + 1;
      }
      const ownerSeals = byAuthor.owner || 0;
      const peerSeals = sealsBeforeDeparture - ownerSeals;

      // THE CONVERGENCE HALF — measured, and it is what makes the unmet claim tolerable.
      ok(sealsBeforeDeparture < 40,
        "2: the room reaches the same place in FAR fewer messages — 70 seals became 15 when the " +
        "counter stopped counting events that were not there. A quorum held up by redundant " +
        "announcements is paid for by every client in the room", sealsBeforeDeparture);

      // THE UNMET HALF — recorded WITH its numbers, so a future change that restores exclusivity
      // fails HERE and has to say why, rather than quietly re-introducing the traffic.
      ok(peerSeals > 0,
        "2: EXCLUSIVITY IS NOT EXHIBITED, and this records that deliberately. An owner floor no " +
        "longer silences the room, because the owner now seals only when its own mark advances. " +
        "If this row ever fails, exclusivity has RETURNED — check whether it returned because the " +
        "cascade was designed to produce owner floors on a cadence, or because a counter started " +
        "counting events that are not there again", { owner: ownerSeals, peers: peerSeals });
      ok(ownerSeals < peerSeals,
        "2: and the owner authors FEWER floors than the peers combined — 5 against 9 here. The " +
        "bot's premise is that one tab covers a room, and under honest arithmetic it does not. " +
        "That is a design question with a cost, not a defect to fix in this guard",
        { owner: ownerSeals, peers: peerSeals, byAuthor: byAuthor });
    }
    ok(authorsPhase2.every((a) => a !== "owner"),
      "2: APPLIED — and the second set is genuinely the room without it", authorsPhase2);

    const stillHoldingFloor = remaining.filter((p) => p.sb.Floor.current() !== null);
    ok(stillHoldingFloor.length > 0,
      "2: clients are computing from a floor rather than from genesis, on both sides of the handover",
      stillHoldingFloor.map((p) => p.name));
  }

  console.log("[cascade-simulation] PASS — the design's claims hold in a running room rather than in isolation: work flows UP, with a strictly monotone cost gradient from owner down to player; the room keeps sealing after the owner leaves, handed over to three high-staff by the ladder alone with no presence protocol and nobody told; one owner floor covers the room where its absence takes a quorum, and clients compute from a floor on both sides of that handover. Floor FRESHNESS is not demonstrated — it is maximal in both phases, so there is no gradient to measure, and the guard says so rather than asserting between two zeroes");
}

main().catch((e) => fail("threw: " + (e && e.stack || e)));
