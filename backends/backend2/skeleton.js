// backends/backend2/skeleton.js — the bot-run engine's registration and channel plan.
//
// THE NAME IS A FOSSIL AND IS KEPT ON PURPOSE. This file was written at J23 as a stub: an engine
// that registered and could not run a room, so the switch the seam built had a real second position
// to reach. A switch with one position is a constant dressed as a condition, and this tree shipped
// that once already — `ddjp_hashref` was a per-room flag whose branch nothing exercised, it read as
// care, and it was deleted along with the compatibility it existed for.
//
// IT IS NOT A STUB ANY MORE. The engine runs rooms. What is left here is what was always here: the
// registration, the channel plan, and the engine's own description. The other slots moved out to
// the files that own them as they became real — `streammanager.js`, `transport.js` — and the last
// two are backend1's, shared rather than copied.
//
// Renaming it would cost every guard, every comment and every doc line that points here, to buy a
// tidier word. The header is cheaper and says more.

const B2_CHANNELS = [
  { kind: "events",   slug: "uncategorized", key: "events_uncategorized", level: 0,  batch: 1, gates: { ban: 60 } },
  { kind: "events",   slug: "owner",         key: "events_owner",         level: 99, batch: 1, gates: { ban: 60 } },
  { kind: "settings", slug: "owner",         key: "settings_owner",       level: 99, batch: 1, gates: { ban: 60 } },
  // ── `gates` LOWERS THE HOMESERVER'S OWN BARS TO THE STAFF RUNG ───────────────────────────────
  // Matrix's defaults are `ban: 99` and `redact: 100`, which are COARSER than the app's ladder:
  // staff sit at 60, so by default they can kick and can never ban, and nobody but the owner can
  // delete a message. A bot room is meant to be run by its staff, so both come down to 60 and
  // `Room.canModerate` — which re-reads both ranks live and refuses acting on anyone at or above
  // you — stays the finer rule. The homeserver gate becomes a floor and the app is stricter than it.
  //
  // This replaces a much larger design (§10a: ban and kick as commands to the bot, with a result
  // event and an async return). One number per room achieves the same visible outcome, keeps
  // `_memberAction` exactly as it is, and — unlike routing through the bot — keeps moderation
  // working while the bot is down.
  { kind: "chat",     slug: "uncategorized", key: "chat_uncategorized",   level: 0,  batch: 1, gates: { redact: 60, ban: 60 } },
  { kind: "chat",     slug: "guest",         key: "chat_guest",           level: 10, batch: 1, gates: { redact: 60, ban: 60 } },
  { kind: "chat",     slug: "staff",         key: "chat_staff",           level: 60, batch: 1, gates: { redact: 60, ban: 60 } },
  { kind: "presence", slug: "chat",          key: "presence_chat",        level: 0,  batch: 1, gates: { ban: 60 } },
];

// Two slots have moved out of this file as the engine has grown real parts: `StreamManager` is
// `streammanager.js` and `MatrixBridge` is `transport.js`, both of which load after the backend1
// module they build on. What is left here is the channel plan, the engine's own description, and
// whichever slots are still stubs.
// THE LAST TWO SLOTS ARE BACKEND1'S, AND NOT AS A SHORTCUT.
//
// `MatrixAccount` is in NO LAYER — login, session, DMs and avatars serve neither pillar and are the
// same job whoever decides what happened in a room. Registering a second one would be two account
// layers for one account.
//
// `Capabilities` is the same table asked the same way. What a rung may do is a property of the
// ROOM'S RULES, not of who counts the votes, and bot mode changes only where the rung comes from
// (a power level rather than a channel) — which is `transport.js`'s job, not this one. Sharing it is
// also what makes determinism true rather than hoped for: `authority.js` asks the very function the
// client asks, because there is only one.
//
// These were empty stubs until the pre-deploy audit. `Backends.isReady` checks that a slot is
// PRESENT, not that it does anything, so `{ _engine: "backend2" }` satisfied it — the readiness flag
// was the only thing standing between a stub and a live bind.
Backends.register("backend2", {
  MatrixAccount: B1MatrixAccount,
  Capabilities:  B1Capabilities,
}, { ready: true, channels: B2_CHANNELS,
     fileMode: "bot",
     // WHAT A BOT ROOM NEVER ACTS ON. backend1's peer backup and stand-in summary machinery still
     // attaches here (`wireCheckpoints` runs for the history pager it also wires), but a bot room
     // has no `checkpoints_` channel for it to seal into or adopt from, and the bot alone decides
     // what stands. So these change nothing. `vouchJitter` is NOT here: playback, blocked-song and
     // length reports stagger by it in every room. Pinned by `check-settings-rows` PART I.
     // NO PEER BACKUPS. A bot room never rebuilds from them — nothing is deleted, and a returning bot
     // or client rebuilds from the newest checkpoint in `events_owner` plus the events after it — so
     // backend1's send path attaches none here and sends none standalone (owner's ruling, ddjp_423).
     backups: false,
     idleSettings: ["vouchTable", "checkpointTable", "checkpointRankOffsetMs",
                    "selfWitnessCheckpoint", "receiptsPerMessage"],
     label: "Bot-run room",
     blurb: "A bot runs the room and decides what stands. Fewer channels, and it must be online." });
