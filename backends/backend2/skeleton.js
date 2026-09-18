// backends/backend2/skeleton.js — a registered engine that cannot run a room yet (J23).
//
// WHY THIS FILE EXISTS AT ALL. J23 builds a switch. A switch with one position is a constant
// dressed as a condition, and this tree has shipped that before: `ddjp_hashref` was a per-room
// flag whose branch nothing exercised, it read as care, and it was deleted along with the
// compatibility it existed for. `consensus/backend-selection.md` opens by warning that the mode
// marker recreates exactly that unless a second engine is real. So backend2 registers now —
// `check-backends.js` binds it, binds back, and proves the four names actually moved.
//
// WHAT IT IS NOT. It is not a bot-run backend. That is J24, which fills these four slots in with
// an engine where the bot holds full authority and nothing is vouched. Until then this registers
// `ready: false`, and `Room.join` refuses a room marked `backend2` BY NAME rather than binding
// an engine with no behaviour behind it and letting the room fail later as something that looks
// like corruption. A silent partial run is far worse than a refusal — J24's own Open says so
// about save-file imports, and it is the same rule.
//
// WHY THE STUBS ARE EMPTY RATHER THAN THROWING. Nothing should reach them: `ready: false` stops
// a room before bind. They carry `_engine` and nothing else, so the guard can assert the shells
// genuinely changed hands, and so that anything that DID somehow call one fails immediately as a
// missing method rather than quietly returning a plausible-looking undefined.


// ── THE CHANNEL PLAN, WHICH IS REAL EVEN THOUGH THE ENGINE IS NOT ──────────────────────────────
// Seven channels where backend1 has nineteen, because the rank ladder stops being encoded in the
// channel topology: everyone writes intents to one room and the bot republishes what it accepts
// into another. Design in `docs/consensus/bot-backend.md` §2.
//
// THE NAMES ARE BACKEND1'S OWN, AND THAT IS LOAD-BEARING. `features/room.js` rebuilds the channel
// map from room NAMES (`channelKeyFromName` is `name.replace(/-/g, "_")`), one key per room, so an
// engine cannot invent an alias table — the app would simply not find its keys. Reusing the names
// makes every key the app asks for resolve, and it is semantically exact in both modes:
// `events-uncategorized` is where anyone may write, `events-owner` is where rank-99 writes land,
// and in a bot room the bot IS the owner.
//
// ONE BATCH. Every row is `batch: 1`, so the room is built in a single burst and there is no
// upgrade path at all — the thing backend1 needs three bursts and a whole upgrade flow for.
// No `checkpoints` row: the bot's checkpoints live in `events-owner` beside the events they cover,
// so there is no cross-room ordering to reconcile (§2c).
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
     label: "Bot-run room",
     blurb: "A bot runs the room and decides what stands. Fewer channels, and it must be online." });
