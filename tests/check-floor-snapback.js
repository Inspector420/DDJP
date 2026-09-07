// tests/check-floor-snapback.js
// WALL: A CLIENT THAT DIVERGED FOLLOWS THE ROOM'S SETTLED ACCOUNT WHEN ONE ARRIVES.
//
// THE PROPERTY THE TRUST CASCADE EXISTS FOR, AND NOTHING TESTED IT. The design is that clients
// derive from the best floor available to them — an owner checkpoint is a bar of ONE (`Floor.select`
// returns at tier 0 without a quorum), a run of higher-rank checkpoints SUBSTITUTES where no owner
// one covers a stretch (`TrustPolicy.substituteTrusted`), and a floor from below you does not bind
// you (`if (t > myTier) continue`). The whole point is that **if clients diverge, a high-enough rank
// publishes a floor and everyone comes back to it.**
//
// REPORTED FROM A LIVE ROOM: that never happens. A client adopts the floor, verifies it, spends it
// to license forgetting — and goes on showing the room it computed for itself. `streammanager.js`
// says so in as many words: *"we do NOT use the seeded result for live state yet … genesis remains
// truth until forgetting is enabled."* The corrective floor is accepted and ignored, so the one
// mechanism built to end a divergence cannot reach the thing diverging.
//
// HOW A CLIENT DIVERGES IN THE FIRST PLACE — reproduced below, from the reported logs. Two clients
// author a play at the SAME `l`, both naming the same parent: an ordinary race. `orderEvents`
// settles it by event id, so every client holding BOTH agrees. A client holding only ONE picks that
// one, and from then on every later play names a parent it does not have. In the reported room that
// produced thirty `stale parent` refusals and a client advancing from a head nobody else had.
//
// PART A — the race genuinely diverges two clients. Without this the rest proves nothing.
// PART B — the ROOM's answer is the one a floor banks.
// PART C — a diverged client that adopts that floor must FOLLOW it.        <-- fails today
// PART D — and where the floor AGREES, adopting it must change nothing.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");
const F = require("./_fixtures");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[floor-snapback] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js",
    "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
  ]);
}

// ── THE RACE, BUILT FROM THE ROOM'S OWN ARITHMETIC ──────────────────────────────────────────
// The two plays sit past `advance.earliestAt`, read off the derived state rather than guessed. A
// first attempt put them one second after the head and BOTH were refused as too-early, so the
// fixture proved nothing while looking like it worked — the shape this tree keeps finding.
const BASE = F.sortLog(F.playingRoom({ songs: 4 }).log);
const SD0 = tree().StateDeriver;
const PRE = SD0.derive(BASE);
const PARENT = PRE.nowPlaying.pi;
const AT = PRE.advance.earliestAt + 1000;
const L = BASE[BASE.length - 1].l + 1;
const mkPlay = (id) => F.reducerEvent(id, L, AT, "@dj:hs", F.RANK.player,
  { t: "ddjp.dj.play", p: PARENT });
// Ids chosen so the ROOM's winner is the one the diverged client does NOT hold.
const WINNER = mkPlay("$Aaaa");     // sorts first — the room's answer
const HELD   = mkPlay("$zzzz");     // the only one this client received

// ── PART A — THE RACE DIVERGES TWO CLIENTS ──────────────────────────────────────────────────
{
  const SD = tree().StateDeriver;
  const room = SD.derive(F.sortLog(BASE.concat([WINNER, HELD])));
  const lone = SD.derive(F.sortLog(BASE.concat([HELD])));

  ok(room.nowPlaying && lone.nowPlaying,
    "A: APPLIED — both plays must be ACCEPTED, or the fixture is testing a refusal instead of a "
    + "race. They sit past `advance.earliestAt`, read from the state rather than assumed",
    { room: !!room.nowPlaying, lone: !!lone.nowPlaying });
  ok(room.nowPlaying.pi === WINNER.eventId,
    "A: the room — holding BOTH — picks the lower event id, which is what `orderEvents` settles a "
    + "tie with and why every client holding both agrees", room.nowPlaying.pi);
  ok(lone.nowPlaying.pi === HELD.eventId,
    "A: a client holding only the other one picks THAT, because a tie cannot be settled from one "
    + "side", lone.nowPlaying.pi);
  ok(room.nowPlaying.pi !== lone.nowPlaying.pi,
    "A: SO THEY HAVE DIVERGED. This is the reported fault reproduced: same room, same rules, two "
    + "heads — and every later play names one of them as parent");

  // AND THE CONTENT AGREED, which is what made it hard to see. The rooms never disagreed about
  // what was playing — only about which play-message counts as the current one.
  ok(JSON.stringify(room.nowPlaying.song) === JSON.stringify(lone.nowPlaying.song),
    "A: both heads play the SAME SONG. The divergence is in the chain's bookkeeping, not in what "
    + "anyone hears, which is why it surfaced as `stale parent` rather than as wrong audio",
    { room: room.nowPlaying.song, lone: lone.nowPlaying.song });
}

// ── PART B — THE FLOOR BANKS THE ROOM'S ANSWER ──────────────────────────────────────────────
{
  const SD = tree().StateDeriver;
  const seed = SD.buildSeed(F.sortLog(BASE.concat([WINNER, HELD])));
  ok(seed && seed.nowPlaying && seed.nowPlaying.pi === WINNER.eventId,
    "B: a checkpoint sealed by a client holding both banks the ROOM's winner. That is why a floor "
    + "can end a divergence at all — it records who won, not what competed", seed && seed.nowPlaying);
}

// ── PART C — THE DIVERGED CLIENT MUST FOLLOW THE FLOOR ──────────────────────────────────────
// THE ASSERTION THIS FILE EXISTS FOR. Fails today.
{
  const C = tree();
  const { StreamManager: SM, Floor: FL, SettingsProof: SP, EventCache: EC, StateDeriver: SD } = C;
  SM.reset(); FL.reset(); SP.reset();
  SP.attach({ now: () => Date.now(), pageSettings: null });
  const deliver = (e) => { const raw = F.toRaw(e); try { EC.store(raw); } catch (x) {} SM.ingest(raw); };

  for (const e of BASE) deliver(e);
  deliver(HELD);                                   // this client never receives WINNER
  const diverged = SM.getState().nowPlaying;
  ok(diverged && diverged.pi === HELD.eventId,
    "C: APPLIED — the client is genuinely on the wrong head before the floor lands, or there is "
    + "nothing for the floor to correct", diverged && diverged.pi);

  // The room seals an OWNER floor covering past the race. Owner is a bar of one — `Floor.select`
  // returns at tier 0 without needing a quorum — so this is the strongest correction available.
  const seed = SD.buildSeed(F.sortLog(BASE.concat([WINNER, HELD])));
  FL._setTrustedForTest({ n: 1, prev: null, seed: seed, h: "hhhhhhhh",
    covers: BASE[0].eventId + ".." + WINNER.eventId, floorL: WINNER.l,
    by: "@owner:hs", grade: "verified" });
  // A nudge, because a floor arriving in a quiet room must still take effect — the refold is wired
  // to a floor-signature change, not to this event.
  deliver(F.reducerEvent("$nudge", L + 50, AT + 50000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "NUDGE" }));

  const after = SM.getState().nowPlaying;
  ok(after && after.pi === WINNER.eventId,
    "C: THE SNAP-BACK. A client that diverged must FOLLOW an owner floor covering the disputed "
    + "stretch. The floor is the room's settled account — it banks which play won — so a client "
    + "deriving from it cannot re-resolve the race from one side. Today the floor is adopted, "
    + "verified and spent on the forget licence while live state keeps the client's own answer: "
    + "`streammanager.js` says `genesis remains truth until forgetting is enabled`. That makes the "
    + "trust cascade unreachable by the thing it exists to correct",
    { expected: WINNER.eventId, got: after && after.pi });
}

// ── PART D — AND AGREEMENT MUST NOT CHURN ───────────────────────────────────────────────────
// The control, and the reason this is safe to do at all: almost always the floor agrees with what
// the client already had, and adopting it must then change nothing. Without this a client could
// pass PART C by thrashing its state on every floor.
{
  const C = tree();
  const { StreamManager: SM, Floor: FL, SettingsProof: SP, EventCache: EC, StateDeriver: SD } = C;
  SM.reset(); FL.reset(); SP.reset();
  SP.attach({ now: () => Date.now(), pageSettings: null });
  const deliver = (e) => { const raw = F.toRaw(e); try { EC.store(raw); } catch (x) {} SM.ingest(raw); };

  const FULL = F.sortLog(BASE.concat([WINNER, HELD]));
  for (const e of FULL) deliver(e);
  const before = SM.getState().nowPlaying;
  ok(before && before.pi === WINNER.eventId,
    "D: APPLIED — a client holding everything is already on the room's answer", before && before.pi);

  const seed = SD.buildSeed(FULL);
  FL._setTrustedForTest({ n: 1, prev: null, seed: seed, h: "hhhhhhhh",
    covers: FULL[0].eventId + ".." + FULL[FULL.length - 1].eventId,
    floorL: FULL[FULL.length - 1].l, by: "@owner:hs", grade: "verified" });
  deliver(F.reducerEvent("$nudge2", L + 60, AT + 60000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "NUDGE2" }));

  const after = SM.getState().nowPlaying;
  ok(after && after.pi === before.pi,
    "D: adopting a floor that AGREES changes nothing. This is the ordinary case — a better floor "
    + "usually says what the client already believed — and it is what makes following one safe "
    + "rather than disruptive", { before: before.pi, after: after && after.pi });
}

if (failed) process.exit(1);
console.log("[floor-snapback] PASS — a client that diverged FOLLOWS the room's settled account when "
  + "one arrives. The divergence is reproduced rather than described: two plays at the same `l` "
  + "naming the same parent, accepted past `advance.earliestAt`, where the room holding both picks "
  + "the lower id and a client holding one picks the other — same song either way, which is why it "
  + "surfaced as `stale parent` rather than as wrong audio. An owner floor banks the room's winner, "
  + "and adopting it moves the diverged client onto it: the trust cascade exists so a high-enough "
  + "rank can end a divergence, and a client that derives past its floor cannot be reached by it. "
  + "Balanced by the control that a floor which AGREES changes nothing, so following one is not "
  + "thrashing (" + A + " assertions)");
