// tests/check-room-compat.js
//
// A CHANGE THAT BREAKS EXISTING ROOMS MUST SAY SO, AT THE MOMENT IT IS MADE.
//
// This build supports rooms it creates and no others (main/08-build-and-deploy.md §Legacy), and
// while the project is pre-release that is the intended trade: break freely, make a new room. The
// hazard is not the breakage. It is that the breakage is INVISIBLE — a settings key added in one
// session, a channel level moved in another, and nothing anywhere says the rooms you already have
// stopped working. The cost lands on whoever next opens an old room and reads a failure that looks
// like corruption.
//
// So the surface is DERIVED by executing the modules and compared against a recorded value. Change
// the surface and this fails, naming which part moved and how. Acknowledge by updating BASELINE in
// the same change that caused it — the diff then carries both the break and its acknowledgement.
//
// PRECEDENT: `checkpointformat.js` already does exactly this for save FILES — a version refused BY
// NAME rather than as a hash mismatch, and a key-set check that runs BEFORE the chain check because
// "this file predates key K" and "this file is corrupt" need opposite responses. Rooms had no
// equivalent. This is that mechanism, one level up.
//
// WHY IT FAILS RATHER THAN WARNS. A warning in a suite that reports PASS/FAIL and is read by exit
// code is a line nobody sees twice. The project's own rule elsewhere is that `not-yet-run` is not a
// pass; the same applies here. Failing costs one line in BASELINE and buys the guarantee that the
// break was seen by the person who caused it.
//
// AFTER RELEASE THIS MECHANISM DOES NOT CHANGE — only the response does. It stops meaning "make a
// new room" and starts meaning "this needs a migration". The surface list is the same either way,
// which is the reason to build it now rather than then.
//
// WHAT IS DERIVED, AND WHY EACH BREAKS A ROOM:
//   settingsKeys  the reducer's own key set. A room's blob is posted at creation and its
//                 completeness is judged against a key set; adding one changes what "complete"
//                 means for every blob already written.
//   eventTypes    what the fold will act on. Removing one silently changes derived state; adding
//                 one means old clients ignore what new ones act on.
//   seedShape     what a checkpoint carries forward. A seed missing a field the reducer now needs
//                 is a fold that starts from a wrong place.
//   hashVersion   the canonical byte form. Change it and no two builds agree on any hash.
//   fileVersion   the save-file format. Already refused by name in checkpointformat; recorded here
//                 so the whole surface sits in one place.
//   channels      the taxonomy and its write levels. Rank IS channel origin, so a moved level
//                 re-ranks history.
//
// KNOWN GAP, STATED RATHER THAN PAPERED OVER: the wire version `dv` is a literal inside
// `sendEvent` (`{ t, l, dv: 2 }`) and is not exported, so it cannot be reached by execution. Only a
// text scan would find it, and a regex over source proves a name is spelled and nothing more —
// which is the trap this suite refuses everywhere else. Extracting it as a constant is a one-line
// edit to a `?v=`-tagged file and therefore carries a deploy bump, so it is named here rather than
// taken silently. OWED: fold into the next job that touches matrixbridge.js for its own reasons.
// Until then this guard covers every surface but that one, and says so rather than counting.

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

// ═══ THE RECORDED SURFACE ════════════════════════════════════════════════════════════════════
// Updating this is the acknowledgement. It is a full listing rather than a hash so that the diff
// of THIS FILE shows what changed — a recorded hash would move opaquely and prove only that
// something moved, which is the "figure with no command beside it" shape §6's banner refuses.
const BASELINE = {
  // ACKNOWLEDGED AT v322, and the acknowledgement is the point of this line moving in the same
  // diff as the change. THREE keys were added at once — `activityPresence`, `activityQueue` and
  // `queueIdleMs` — and they were added TOGETHER deliberately: the cost below is per SHAPE CHANGE,
  // not per key, so three landing in one package opens ONE dead-checkpoint window and three
  // landing in three packages would open three. Every room re-fingerprints and forgets nothing
  // until it has sealed two fresh checkpoints. See `docs/consensus/bot-model.md` §5.3.
  // AND AGAIN FOR `botQueueChat` — ONE key, taken deliberately and with the owner's
  // agreement rather than discovered. The queue timer had no chat option at all, so somebody
  // talking in the room still lost their deck; the presence timer already had `botPresenceChat`
  // and needed no key. **One key was added, not two**, and nothing else was batched with it
  // because nothing else was waiting — the cost is per SHAPE CHANGE, so anything that wants a key
  // later should have come now.
  settingsKeys: [
    "activityPresence", "activityQueue", "botQueueChat",
    "bg", "botAfkMs", "botDelegation", "botPingMs", "botPresenceChat", "botPresenceSpine",
    "chat", "checkpointCooldownMs", "checkpointEvery", "checkpointRankOffsetMs", "checkpointTable",
    "graceMs", "maxLen", "minDjRank", "minGate", "minLen", "presendMs", "queueIdleMs",
    // ACKNOWLEDGED HERE, IN THE CHANGE THAT ADDED IT. `repeatCooldownMs` — the room's replay
    // cooldown — invalidates every checkpoint in every room: a seeded reader fills the missing key
    // from the new defaults and cannot reproduce a fingerprint sealed without it, so each room
    // holds no floor and forgets nothing until it has sealed TWO fresh checkpoints, and every save
    // file written before this build is an older-keyset file. Taken deliberately while pre-release,
    // where the answer is a new room. The cost is the same for ANY key, which is why this one
    // shipped alone rather than being bundled with a second.
    "repeatCooldownMs",
    "receiptsPerMessage",
    "selfWitnessCheckpoint", "skipRoads", "vis", "vouchJitter", "vouchTable",
  ],
  eventTypes: [
    "ddjp.count.set", "ddjp.dj.declare", "ddjp.dj.join", "ddjp.dj.leave", "ddjp.dj.move",
    "ddjp.dj.order", "ddjp.dj.play", "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.save",
    "ddjp.dj.skip", "ddjp.dj.strike", "ddjp.dj.undeclare", "ddjp.dj.vote", "ddjp.media.skip",
    "ddjp.play.blocked", "ddjp.play.len", "ddjp.room.settings",
  ],
  seedShape: ["ledger", "liveDecl", "members", "nowPlaying", "settings", "settingsFrom", "tick"],
  hashVersion: 1,
  fileVersion: 1,
  // ACKNOWLEDGED AT v322: one channel ADDED — `presence_chat`, in its own batch 4. Additive rather
  // than a change to an existing batch, which is the whole reason it got a batch of its own: rooms
  // that completed upgrade 2 stay complete and are offered a new upgrade, instead of reporting
  // batch 3 unfinished and re-running it.
  //
  // A pre-v322 room still WORKS — it simply has no presence chat until its owner upgrades, exactly
  // as a pre-batch-3 room has no staff channels. What breaks is the SHAPE comparison this baseline
  // pins, and that is what the acknowledgement is for.
  channels: [
    // ═══ ACKNOWLEDGED: PRE-RELEASE ROOM REBUILD REQUIRED ════════════════════════════════════
    // Two changes are recorded here together, and the owner accepted both knowing existing rooms
    // must be rebuilt — the site is not public, which is exactly the response this guard's own
    // message names.
    //
    // 1. `settings_staff@60` and `settings_high_staff@80` are REMOVED. Built for a per-tier
    //    settings WRITE that delegation then implemented without them — a lower rank sends
    //    `ddjp.bot.request` on its own events channel and the bot authors the change. The reducer
    //    honoured only `settings_owner` throughout. On its own this one was INERT for old rooms:
    //    both an old and a new room reported the same highest batch, because the batch walk asks
    //    the TABLE for keys and never asks about extras.
    //
    // 2. `presence_chat` MOVED from batch 4 into batch 3, so there are three batches, not four.
    //    THIS ONE IS NOT INERT, and it is why `#b<batch>` was added to the surface above. A room
    //    built before it carries a `done` marker for batch 3; `_computeStatus` takes the HIGHER of
    //    that marker and what physically exists, so such a room reports batch 3 complete, is
    //    offered nothing, and NEVER creates the presence channel — the UI says "All ranks
    //    unlocked" over a room missing one. Driven before the change was made.
    //
    // The batch was invisible to this guard until now: `key@level` was identical across the move,
    // so the one guard written to catch room-breaking changes said nothing about the more damaging
    // of the two.
    "chat_guest@10#b2", "chat_staff@60#b3", "chat_uncategorized@0#b1",
    "checkpoints_guest@10#b2", "checkpoints_high_staff@80#b3", "checkpoints_owner@99#b1",
    "checkpoints_player@20#b2", "checkpoints_staff@60#b3", "checkpoints_uncategorized@0#b1",
    "checkpoints_vip@40#b2", "events_guest@10#b2", "events_high_staff@80#b3",
    "events_owner@99#b1", "events_player@20#b2", "events_staff@60#b3",
    "events_uncategorized@0#b1", "events_vip@40#b2", "presence_chat@0#b3",
    "settings_owner@99#b1",
  ],
};

const ctx = loadInContext([
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/checkpointformat.js",
  "backends/backend1/matrixbridge.js",
]);

// DERIVED BY EXECUTION, NOT BY READING SOURCE. Every value below comes from calling the module that
// owns it, so a change made anywhere — including one that leaves the source text looking untouched —
// is seen here.
function derive() {
  return {
    settingsKeys: Object.keys(ctx.StateDeriver.defaultSettings()).sort(),
    eventTypes: ctx.StateDeriver.HANDLED_TYPES.slice().sort(),
    // buildSeed on an empty fold gives the SHAPE with no fixture and no ordering assumptions. The
    // shape is what a checkpoint must carry; the values are per-room and deliberately not here.
    seedShape: Object.keys(ctx.StateDeriver.buildSeed([], null)).sort(),
    hashVersion: ctx.ConsensusHash.HV,
    fileVersion: ctx.CheckpointFormat.FILE_VERSION,
    // channelTaxonomy() answers with no client attached — verified, and the reason this surface is
    // reachable at all from a headless run.
    // THE BATCH IS PART OF THE SURFACE, AND IT WAS NOT UNTIL A CHANGE WALKED STRAIGHT PAST THIS
    // GUARD. Moving `presence_chat` from batch 4 into batch 3 left `key@level` identical, so this
    // stayed GREEN over a change that strands the channel in every room already built: such a room
    // carries a `done` marker for batch 3, `_computeStatus` takes the HIGHER of the marker and
    // what physically exists, so it reports batch 3 complete, offers nothing, and the channel is
    // never created. Driven before the change was made — the room reads "All ranks unlocked" while
    // missing a channel.
    //
    // So a batch move is a room-shape change even though no channel is added, removed or
    // re-levelled: the batch is what an upgrade OFFERS, and rooms carry markers naming batches
    // they have finished.
    channels: ctx.MatrixBridge.channelTaxonomy()
      .map((c) => c.key + "@" + c.level + "#b" + c.batch).sort(),
  };
}

const now = derive();

// ═══ DETERMINISM FIRST ═══════════════════════════════════════════════════════════════════════
// A surface that differs between two calls in one process cannot be a baseline for anything. This
// runs before the comparison so that "the fingerprint moved" can never be an artefact of the
// fingerprint itself.
const again = derive();
assert.deepStrictEqual(
  again, now,
  "[room-compat] FAIL — the derived surface is not stable within a single run, so no recorded " +
  "value could ever hold. Something in the surface depends on call order or on time.");

// ═══ THE BASELINE MUST BE WELL-FORMED BEFORE IT CAN BE COMPARED ══════════════════════════════
// THIS RUNS BEFORE THE DRIFT LOOP, and the ordering is the whole point rather than tidiness. It is
// the same reason checkpointformat checks a key set BEFORE the chain: "the surface moved" and "the
// baseline is malformed" need OPPOSITE responses, and a malformed baseline compared as if it were
// drift reports rooms breaking when nothing about the rooms changed. Written the other way round
// first, and a baseline naming a surface derive() does not produce came out as a room-breaking
// change — a true failure with a misleading verdict, which is worse than no verdict.
const missingFromDerived = Object.keys(BASELINE).filter((k) => !(k in now));
assert.ok(
  missingFromDerived.length === 0,
  "[room-compat] FAIL — BASELINE records a surface that derive() no longer produces, so it is " +
  "being compared against nothing. This is a broken baseline, NOT a broken room: " +
  JSON.stringify(missingFromDerived));

const missingFromBaseline = Object.keys(now).filter((k) => !(k in BASELINE));
assert.ok(
  missingFromBaseline.length === 0,
  "[room-compat] FAIL — derive() produces a surface BASELINE does not record, so a change to it " +
  "would pass unnoticed. Add it, or stop deriving it. This is a broken baseline, NOT a broken " +
  "room: " + JSON.stringify(missingFromBaseline));

// ═══ THE COMPARISON, PER SURFACE ═════════════════════════════════════════════════════════════
// Reported surface by surface rather than as one hash. A hash mismatch says only that something
// moved; what a reader needs is WHICH ROOMS BREAK AND WHY, and that is the difference between a
// message someone acts on and one they re-run hoping it goes away.
const drift = [];
for (const key of Object.keys(BASELINE)) {
  const was = BASELINE[key];
  const is = now[key];
  if (Array.isArray(was)) {
    const added = is.filter((x) => !was.includes(x));
    const removed = was.filter((x) => !is.includes(x));
    if (added.length || removed.length) {
      drift.push(key + ":" +
        (added.length ? " +" + added.join(" +") : "") +
        (removed.length ? " -" + removed.join(" -") : ""));
    }
  } else if (was !== is) {
    drift.push(key + ": " + was + " -> " + is);
  }
}

// THE SETTINGS KEY SET COSTS MORE THAN THE OTHERS, AND THE MESSAGE SAYS SO (J45). Adding one key
// makes `Floor.chainVerifies` refuse EVERY checkpoint sealed before it — driven, `true → false` —
// because the seeded reader fills the missing key from the new defaults and the recomputed blob can
// no longer reproduce a fingerprint sealed without it. The room then holds no floor and forgets
// nothing until it seals TWO fresh ones. That cost is structurally invisible from inside one tree:
// the suite is single-version by design, so a fixture that seals under one reducer and verifies
// under another cannot be expressed in it, and a guard written carelessly would just re-seal under
// the mutated reducer and pass. So this is an ANNOUNCEMENT rather than an assertion — the sentence
// is the deliverable, said at the moment the key is added.
const settingsCost = drift.some((d) => d.indexOf("settingsKeys:") === 0)
  ? "\n      AND THE SETTINGS KEY SET COSTS MORE THAN THE REST: adding or removing a key invalidates" +
    "\n      EVERY CHECKPOINT IN EVERY ROOM. `Floor.chainVerifies` refuses each one sealed before the" +
    "\n      change, because the seeded reader fills the missing key from the new defaults and cannot" +
    "\n      reproduce a fingerprint sealed without it. Each room holds no floor and forgets nothing" +
    "\n      until it has sealed TWO fresh checkpoints. See main/09-roadmap.md J45."
  : "";

assert.ok(
  drift.length === 0,
  "[room-compat] FAIL — THIS CHANGE BREAKS EXISTING ROOMS.\n" +
  "      " + drift.join("\n      ") + settingsCost + "\n" +
  "      Rooms created by the previous build will not work with this one. While pre-release that is\n" +
  "      allowed and the response is to make a new room — see main/08-build-and-deploy.md §Legacy.\n" +
  "      Acknowledge by updating BASELINE in tests/check-room-compat.js in THIS change, so the diff\n" +
  "      carries the break and its acknowledgement together.");

const sig = crypto.createHash("sha256")
  .update(JSON.stringify(now, Object.keys(now).sort()))
  .digest("hex").slice(0, 12);

console.log(
  "[room-compat] PASS — the room-compatibility surface is unchanged, and it is DERIVED by executing " +
  "the modules that own it rather than scanned out of source: the reducer's settings key set and " +
  "handled event types, the seed's shape, the canonical hash version, the save-file version, and the " +
  "channel taxonomy with its write levels. Reported surface by surface rather than as one hash, so a " +
  "break names which rooms stop working and why instead of saying only that something moved. The " +
  "baseline is asserted honest in both directions, so a recorded surface that stopped being derived " +
  "fails here rather than silently comparing against nothing. Determinism is checked before the " +
  "comparison, so a moved fingerprint can never be an artefact of the fingerprint. Not covered, and " +
  "named rather than papered over: the wire version `dv` is a literal inside sendEvent and is not " +
  "reachable by execution — " + Object.keys(now).length + " of " + (Object.keys(now).length + 1) +
  " surfaces, the missing one named above (signature " + sig + ")");
