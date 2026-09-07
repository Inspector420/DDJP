// tests/check-seal-cadence-derived.js
//
// THE SEAL CADENCE IS DERIVED FROM THE ROOM, NOT COUNTED IN THE PAGE.
//
// Both triggers lived in module variables that start at zero on every load:
//
//     let _lastOwnSealAt = 0;   ->  sinceOwn = Infinity   ->  the clock is INFINITELY overdue
//     let _lastSealHead  = 0;   ->  changed  = the WHOLE log  ->  the count is instantly over
//
// Zero does not mean "just started". It means "I have never done this", and both triggers read
// that as maximally due. So every client, on every page load, wanted to seal immediately — and
// `EITHER trigger is enough`, so fixing one alone leaves the other door wide open.
//
// Seen live: an owner refreshed three times and wrote three checkpoints at l=91, 93 and 95, all
// before any music started, so all three were EMPTY — no members, no nowPlaying, tick 0. It then
// went silent for the whole eight-song session, because now its in-page clock was finally running.
// The uncategorized client's timer ran down mid-session and it sealed the only checkpoint that
// contained anything — one that, by that room's own checkpointTable (`null` = never), no client
// can ever adopt. The room banked its entire session into a note nobody may read, and the only
// readable notes were blank.
//
// THE FIX IS THE SAME MOVE AS THE LAMPORT CLOCK AND THE SERVER CLOCK: stop keeping
// a private counter, derive the value from something written down. Here that is the checkpoint
// itself — every client can see it, and a reload cannot forget it.
//
// TWO PROPERTIES THAT MATTER MORE THAN THE ARITHMETIC:
//
//   SHARED ANCHOR. Private stopwatches start at different moments, so two clients come due at
//   different times and the rank ladder's head start never gets to matter — a junior whose timer
//   happened to expire first would seal while the owner was still mid-cooldown. Reading the SAME
//   timestamp, everyone comes due together, and the ladder does its job.
//
//   NO LOCAL CLOCK ANYWHERE. Elapsed is measured as `newest event's ts - checkpoint's ts` — both
//   server-stamped Matrix events. Subtracting a server stamp from Date.now() would be the mixing
//   rule this project has already been bitten by twice (the seek, and the replay clock).
//   CONCEPTS.md §3.6b: both ends of a time comparison must be server time.
//
// WHAT IS DELIBERATELY KEPT: a short in-session guard against sealing twice before your own
// checkpoint has synced back. That one is CORRECT to lose on reload — after a reload the room's
// own record governs — so it is a floor on re-entrancy, never the source of the cadence.
//
// PART (h) EXISTS BECAUSE THE ABOVE WAS TRUE OF PEERS AND FALSE OF SEALERS, and this guard did not
// notice for several versions. Two faults, and they compound:
//
//   1. A client that SEALS its own floor never gets a timestamp on it. `seal()` adopts the
//      checkpoint directly, bypassing the store where arrival timestamps live; when its own
//      checkpoint later syncs back, adoption refuses it as "not an improvement" (same position),
//      so the date is never filled in. `sinceFloor` is then `newest - null` = Infinity: the
//      sealer is ALWAYS clock-due.
//   2. With the derived anchor gone, the only thing left holding it back is `_lastOwnSealAt` —
//      the private stopwatch this whole file exists to remove — and it was gated on the FULL
//      cooldown rather than the short window its own comment describes.
//
// So the room ran two different cadences at once: peers on the shared server clock, and the client
// that seals most on a page-local timer. That is precisely the "junior's timer expired first"
// failure in the note above, arriving from the other side — and it is what an operator saw when an
// uncategorized client sealed while the owner was present and active.

const assert = require("assert");
const { loadInContext } = require("./_load");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const COOLDOWN = 1200000;   // 20 min, the shipped default
const T0 = 1785400000000;

function ctx() {
  const c = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
    "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
    "backends/backend1/dials.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/floor.js", "backends/backend1/checkpoint.js"], {});
  return c;
}

// A log entry as StreamManager produces one: server ts, position, and the action type.
function ev(l, t, ts) { return { eventId: "$e" + l, l: l, ts: ts, content: { t: t }, type: t }; }

// `plays` countable events then a checkpoint, then `after` more — the shape of a real room.
function room(opts) {
  const log = [];
  let ts = T0;
  for (let i = 1; i <= (opts.before || 3); i++) log.push(ev(log.length + 1, "ddjp.dj.play", ts += 1000));
  if (opts.checkpointAgeMs !== null && opts.checkpointAgeMs !== undefined) {
    log.push(ev(log.length + 1, "ddjp.checkpoint", ts));
    // everything after the checkpoint happens `checkpointAgeMs` later
    for (let i = 0; i < (opts.after || 0); i++) {
      log.push(ev(log.length + 1, "ddjp.dj.play", ts + opts.checkpointAgeMs));
    }
    if (!opts.after) log.push(ev(log.length + 1, "ddjp.dj.play", ts + opts.checkpointAgeMs));
  }
  return log;
}

function fresh(log, over) {
  const c = ctx();
  // THE FLOOR THIS CLIENT HOLDS. Parts (a)-(f) model a client that has replayed a log containing a
  // checkpoint, and a real client in that position has ADOPTED it — replay delivers it, adoption
  // follows. So the default anchor is that checkpoint's own timestamp. Overridden explicitly by
  // part (g), which is about the cases where the two come apart: a checkpoint present but not
  // adoptable, and a floor adopted long ago.
  const _cps = (log || []).filter((e) => ((e.content && e.content.t) || e.type) === "ddjp.checkpoint");
  const _defaultFloorTs = _cps.length ? _cps[_cps.length - 1].ts : null;
  c.Checkpoint.attach(Object.assign({
    now: () => T0,                       // a LOCAL clock that is deliberately useless here
    floorTs: () => _defaultFloorTs,
    floorPos: () => (_cps.length ? _cps[_cps.length - 1].l : null),   // the floor covers everything at or below the checkpoint
    log: () => log,
    settings: () => ({ checkpointCooldownMs: COOLDOWN, checkpointEvery: 40 }),
    myRank: () => c.Ranks.levelOf("uncategorized"),
    amOwner: () => false,
    send: async () => ({}),
    holdForWitness: () => ({ hold: false, remainingMs: 0 }),
    thin: () => false, held: () => [], myUserId: () => "@me:hs", isLegal: () => null,
  }, over || {}));
  return c.Checkpoint;
}

// ── (a) a freshly-loaded page is NOT automatically overdue ───────────────────────────────────
{
  // A room checkpointed one minute ago. A client that has just loaded knows nothing in memory —
  // and must read that minute off the room rather than assuming it has been forever.
  const log = room({ before: 3, checkpointAgeMs: 60000, after: 2 });
  const CP = fresh(log);
  const v = CP.maySeal(T0);

  ok(v && typeof v.ok === "boolean", "a: APPLIED — maySeal must actually answer", v);
  ok(v.ok === false,
    "a: one minute after the room's last checkpoint, a just-loaded client must NOT be due. " +
    "In-page counters start at zero and read as infinitely overdue — that is the refresh spam.",
    v);
  ok(v.reason === "not-due",
    "a: and it must say it is not DUE — not 'nothing changed', which would be a different " +
    "reason arriving at the right answer by accident",
    v);
}

// ── (b) past the cooldown, measured off the room, it IS due ──────────────────────────────────
// Without this, "never due" passes (a) while deleting checkpointing entirely.
{
  const log = room({ before: 3, checkpointAgeMs: COOLDOWN + 60000, after: 2 });
  const CP = fresh(log);
  const v = CP.maySeal(T0);
  ok(v.reason !== "not-due",
    "b: past the cooldown — measured from the room's own last checkpoint — a client must become " +
    "due. A fix that never seals would satisfy (a) and do nothing.",
    v);
}

// ── (c) no checkpoint at all: due ────────────────────────────────────────────────────────────
{
  const log = room({ before: 5, checkpointAgeMs: null });
  const CP = fresh(log);
  const v = CP.maySeal(T0);
  ok(v.reason !== "not-due",
    "c: a room that has never been checkpointed has nobody to wait for — somebody must go first",
    v);
}

// ── (d) THE OTHER DOOR. The count must be derived too. ───────────────────────────────────────
// `EITHER trigger is enough`. Fixing only the clock leaves a freshly-loaded client counting the
// entire log as unsaved, which trips the threshold instantly in any room with 40+ events.
{
  const log = room({ before: 60, checkpointAgeMs: 60000, after: 3 });
  const CP = fresh(log);
  const v = CP.maySeal(T0);
  ok(v.ok === false && v.reason === "not-due",
    "d: a 60-event room checkpointed one minute ago must not be due on the COUNT either. The " +
    "counter also starts at zero on load, so it read the whole log as unbanked — the same bug " +
    "through the second door.",
    v);
}

// ── (e) no local clock in the measurement ────────────────────────────────────────────────────
// The injected `now` is pinned to T0 while the room's events run far past it. If the cadence
// consulted the local clock at all, these two would disagree.
{
  const log = room({ before: 3, checkpointAgeMs: COOLDOWN + 60000, after: 2 });
  const a = fresh(log, { now: () => T0 }).maySeal(T0);
  const b = fresh(log, { now: () => T0 + 99999999 }).maySeal(T0 + 99999999);
  ok(a.reason === b.reason,
    "e: the verdict must not depend on the LOCAL clock — both ends of the elapsed measurement " +
    "are server-stamped events (CONCEPTS.md §3.6b). A local `now` on one side is the mixing bug " +
    "this project has already paid for twice.",
    { pinned: a.reason, skewed: b.reason });
}

// ── (g) THE CADENCE ANCHORS ON THE FLOOR YOU ADOPTED, NOT ON ANY CHECKPOINT THAT WENT PAST ───
// The rule the previous three parts approximate. Elapsed was measured from the newest checkpoint
// IN THE LOG, whoever wrote it and whether or not anybody could accept it. But a checkpoint is not
// a floor. An owner's is one instantly; a peer's needs enough same-rank agreement to clear the
// room's bar; your own self-witnessed one is yours alone. Measuring from a checkpoint you cannot
// adopt answers a question nobody asked.
//
// TWO BUGS, ONE CAUSE, and that is why this is a single change rather than two:
//   · ON LOAD — replay delivers an old checkpoint, you adopt it, and the old code stamped
//     Date.now() as though you had just sealed. Anchored on the floor's own timestamp, adopting
//     something two days old says two days old. Live: a room sat 2.5 days with the elapsed
//     reading 218487742 and every five-minute tick refused.
//   · AFTER THE OWNER LEAVES — one high staff seals. Three must agree before anyone can adopt it,
//     so it is NOT a floor. It still reset everyone's clock, so the other two never became due, the
//     agreement could never form, and the room could never get another floor. One client wrote
//     checkpoints nobody could accept, forever.
//
// AND SEALING WHEN YOU CANNOT ADOPT IS CORRECT, not a stampede to be suppressed. Adoption is the
// cheap path; failing to find one is exactly the signal that you owe a checkpoint yourself.
{
  const log = room({ before: 3, checkpointAgeMs: 218487742, after: 9 });
  const NOW = T0 + 218487742;

  // A peer's checkpoint sits in the log and is NOT adoptable — no floor, so no anchor.
  const unadopted = fresh(log, { now: () => NOW, floorTs: () => null });
  const v1 = unadopted.maySeal(NOW);
  ok(v1 && v1.ok === true,
    "g: APPLIED — a checkpoint I could not adopt does not quiet me. This is the whole of the " +
    "owner-gone stall: a lone high-staff seal reset every peer's clock, so the two peers whose " +
    "agreement it needed never became due and the quorum could never form", v1);

  // The same log, but I hold a floor anchored to that checkpoint: quiet.
  const adopted = fresh(log, { now: () => NOW, floorTs: () => NOW - 1000 });
  const v2 = adopted.maySeal(NOW);
  ok(v2 && v2.ok === false,
    "g: APPLIED — and a floor I DID adopt a second ago quiets me completely, however long the " +
    "room has been running. Adoption is what discharges the duty, which is what makes one owner " +
    "cover a room", v2);

  // THE COUNT HAS THE SAME DOOR, and it has to be closed with it. Here my floor is an old
  // checkpoint and a NEWER peer checkpoint sits above it in the log — one I cannot adopt. Counted
  // from the newest checkpoint, nothing has changed since it and I am quiet. Counted from MY FLOOR,
  // five events stand above it unbanked, which is the truth. Without this the clock fix would be
  // undone through the second door: due on time, silent on count.
  {
    const mixed = [];
    let t = T0;
    for (let i = 1; i <= 3; i++) mixed.push(ev(mixed.length + 1, "ddjp.dj.play", t += 1000));
    mixed.push(ev(mixed.length + 1, "ddjp.checkpoint", t));          // MY floor, at position 4
    const myFloorPos = mixed.length, myFloorTs = t;
    for (let i = 0; i < 5; i++) mixed.push(ev(mixed.length + 1, "ddjp.dj.play", t += 1000));
    // Far enough past the cooldown that the CLOCK is unambiguously due, so the only thing this
    // assertion can turn on is whether the count was measured from my floor or from their seal.
    mixed.push(ev(mixed.length + 1, "ddjp.checkpoint", t += 2000000));  // a peer's, NOT adoptable

    const c = fresh(mixed, { now: () => t, floorTs: () => myFloorTs, floorPos: () => myFloorPos });
    const v = c.maySeal(t);
    ok(v && v.ok === true,
      "g: APPLIED — the change count is measured from MY FLOOR, not from the newest checkpoint in " +
      "the log. Five events stand above my floor unbanked; a peer's checkpoint I cannot adopt does " +
      "not bank them on my behalf", v);
  }

  // THE PAGE LOAD ITSELF, driven through the call the bridge actually makes. Every fixture above
  // builds a Checkpoint that has never adopted anything, so `_lastOwnSealAt` sits at 0 and the
  // re-entrancy gate reads Infinity — permanently open. That made the whole of this part blind to
  // the second door, and the second door is where the live bug was: `noteAdopted` stamped
  // Date.now(), adoption happens during replay on every load, and the client declared it had just
  // sealed. Anchoring the clock fixed one gate and left the other one holding it shut.
  {
    const c = fresh(log, { now: () => NOW, floorTs: () => T0, floorPos: () => 4 });
    c.noteAdopted(NOW, 3);   // exactly what the bridge calls when replay delivers the old floor
    const v = c.maySeal(NOW);
    ok(v && v.ok === true,
      "g: APPLIED — adopting a 2.5-day-old floor ON LOAD leaves the room 2.5 days overdue through " +
      "BOTH gates. Adoption is not a seal: it does not arm the re-entrancy floor, which exists " +
      "only for a checkpoint I sent that has not synced back yet", v);
  }

  // The page load: an old floor is old, not new.
  const reloaded = fresh(log, { now: () => NOW, floorTs: () => T0 });
  const v3 = reloaded.maySeal(NOW);
  ok(v3 && v3.ok === true,
    "g: APPLIED — adopting a 2.5-day-old floor during replay leaves the room 2.5 days overdue. " +
    "A page load cannot make the room look recently sealed, because the anchor is the floor's own " +
    "server timestamp and reloading does not change when somebody else wrote it", v3);
}

// ── (i) THE LADDER LIVES IN THE DUENESS, NOT ONLY IN THE SEND SLOT ────────────────────────────
// The rank ladder gives the owner a head start, and it works — when both clients are ASKED at the
// same instant. An arriving play does that: every client sees it within milliseconds. A quiet room
// does not: the only trigger left is a per-client cadence tick anchored to when that page loaded,
// and a 30-second handicap cannot cover a five-minute difference in when each was asked. Measured:
// asked together the owner fires at 500ms and the bottom rank at 30908ms; asked three minutes
// apart the bottom rank fires first and the ladder never gets a say.
//
// The slot cannot be anchored to a shared INSTANT, because the scheduler runs on `Date.now()` and
// the floor carries a SERVER stamp — anchoring one on the other is the local-clock-meets-server-
// stamp mixture this file exists to remove.
//
// So the ladder goes where the arithmetic is already server-to-server: DUENESS. A rank is not due
// until the room has been due for its own slot's worth of time. Owner at the cooldown, the rank
// below 5s later, the bottom rank 30s later — derived from the same dial the send slot uses, and
// with no jitter, because jitter breaks up a burst of sends and has no business deciding whose
// turn it is.
//
// WHAT THIS DOES NOT CLAIM. Far past the cooldown everyone is due whatever their rank, so a client
// that wakes hours later still seals. That is correct: the ladder orders clients that are present
// and due, and a sleeping owner is not present. The count trigger keeps no offset either — it is
// event-driven, so every client is already asked together and the send slot orders them.
(() => {
  const c = ctx();
  const FLOOR_TS = T0;
  const log = [];
  for (let i = 1; i <= 9; i++) log.push({ eventId: "$e" + i, l: i, ts: T0 + i * 1000, type: "ddjp.dj.play", content: { t: "ddjp.dj.play" } });

  function dueAt(rank, elapsedMs) {
    const now = FLOOR_TS + elapsedMs;
    const l2 = log.concat([{ eventId: "$last", l: 99, ts: now, type: "ddjp.dj.play", content: { t: "ddjp.dj.play" } }]);
    const cc = ctx();
    cc.Checkpoint.attach({
      now: () => now, log: () => l2, held: () => [], settings: () => ({}),
      myRank: () => rank, myUserId: () => "@u:hs", amOwner: () => rank === 100,
      isLegal: () => null, send: async () => {}, holdForWitness: () => ({ hold: false }),
      thin: () => false, floorTs: () => FLOOR_TS, floorPos: () => 2,
    });
    return cc.Checkpoint.maySeal(now).ok;
  }

  const COOLDOWN = 1200000;
  ok(dueAt(100, COOLDOWN + 500) === true,
    "i: the OWNER is due as soon as the cooldown has passed", true);
  ok(dueAt(0, COOLDOWN + 500) === false,
    "i: APPLIED — the BOTTOM rank is NOT yet due half a second later. Its turn is 30s further on, "
    + "so an early tick no longer lets it seal in front of an owner whose own tick has not fired "
    + "yet. Without this the ladder existed only in the send slot, which orders nothing when the "
    + "two clients were asked minutes apart", false);
  ok(dueAt(0, COOLDOWN + 31000) === true,
    "i: and once its own turn has come it IS due — the ladder delays a rank, it does not silence "
    + "one", true);
})();

// ── (h) MY OWN FLOOR IS DATED, AND THE RE-ENTRANCY FLOOR IS SHORT ────────────────────────────
// The two properties at the top of this file, applied to the client the file forgot: the one that
// SEALS. Without them a sealer runs on a private stopwatch while every peer runs on the shared
// clock, so they never come due together and the ladder cannot order them.
(() => {
  const c = ctx();
  c.Floor.attach({ now: () => T0, log: () => [], settings: () => ({}), myRank: () => 100,
                   trimmed: () => false });
  const seed = { members: {}, rankByUser: {}, settings: {}, tick: 0, nowPlaying: null };
  const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: 44, thin: false,
               covers: "$a..$b" };
  cp.h = c.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);

  // I seal it myself: seal() adopts directly, so at this instant there is no arrival time to read.
  c.Floor.adopt({ floor: Object.assign({ u: "@me:hs" }, cp), tier: null }, true);
  ok(c.Floor.current() !== null, "h: my own seal becomes my floor", c.Floor.current());

  // ...and then it syncs back, carrying the server's stamp.
  const SERVER_TS = T0 + 5000;
  c.Floor.remember(cp, 100, "@me:hs", SERVER_TS);
  ok(c.Floor.anchorTs() === SERVER_TS,
    "h: APPLIED — my own floor is DATED when my checkpoint syncs back. Adoption refuses it as 'not "
    + "an improvement', which is right, but the arrival TIME is new information and the cadence "
    + "reads exactly that. Left undated, `newest - null` is Infinity and the sealer is permanently "
    + "clock-due — running on the page-local timer this whole file exists to delete",
    c.Floor.anchorTs());

  // A peer that adopts the same checkpoint reads the SAME anchor — which is the shared-clock
  // property, and the only reason the rank ladder can order anybody.
  const peer = ctx();
  peer.Floor.attach({ now: () => T0, log: () => [], settings: () => ({}), myRank: () => 0,
                      trimmed: () => false });
  peer.Floor.remember(cp, 100, "@me:hs", SERVER_TS);
  peer.Floor.adopt({ floor: Object.assign({ u: "@me:hs" }, cp), tier: 0 });
  ok(peer.Floor.anchorTs() === c.Floor.anchorTs(),
    "h: APPLIED — the sealer and a peer that adopted the same checkpoint hold the SAME anchor, so "
    + "they come due at the same moment and the ladder's head start decides who goes. Two clients "
    + "on two different clocks is how a junior came to seal while the owner was present",
    { sealer: c.Floor.anchorTs(), peer: peer.Floor.anchorTs() });
})();

console.log("[seal-cadence-derived] PASS — both seal triggers are derived from the room rather " +
  "than counted in the page, and both anchor on the FLOOR I HOLD rather than on whatever " +
  "checkpoint went past: elapsed is the newest event's timestamp minus the floor's own, and the " +
  "change count is how much of the log that floor leaves above it — closing both doors, since " +
  "either trigger alone is enough to seal. A checkpoint is not a floor, so one I could not adopt " +
  "does not quiet me, which is what lets a quorum form once the owner leaves; a floor I adopted a " +
  "second ago quiets me completely; a floor adopted on RELOAD is as old as it was, through both " +
  "gates, because adoption is not a seal and does not arm the re-entrancy floor; a room with no " +
  "floor at all still lets somebody go first; and the whole measurement uses two server " +
  "timestamps with no local clock on either side, so every client holding the same floor comes " +
  "due at the same moment and the rank ladder's head start can actually decide who goes (" +
  checks + " assertions)");
