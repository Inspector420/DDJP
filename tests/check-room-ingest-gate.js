// tests/check-room-ingest-gate.js
//
// ONE ROOM AT A TIME — FOREIGN EVENTS MUST NOT REACH THE CONSENSUS LAYER AT ALL.
//
// The sync listener hands every DDJP event it sees to `_ingestSpineEvent`, from every room in
// every Space this client belongs to. Nothing asked which room was active. So at startup — and
// again on every room SWITCH — another room's history was folded into this room's derived log.
//
// Observed in a live two-room session (`test191` + `testroom191-2`), and it produced two faults
// that looked unrelated until the logs were read side by side:
//
//   POSITIONS. The Lamport clock is "one higher than the highest position I hold", read from the
//   derived log. Before the first reset that log held the OTHER room's events, which reached l=93.
//   A brand-new room therefore opened its numbering at 91/93/95 instead of 1. Positions are the
//   ordering key for the entire room, so a room that starts numbering from somewhere else has
//   inherited a stranger's spine.
//
//   RANKS. `rankByUser` is built by folding events, and rank comes from WHICH CHANNEL an event was
//   written to. Fold the other room's events and you import the other room's ranks — the owner's
//   checkpoints recorded `@inspector420-ddjp: 100` because 420 is the owner OVER THERE. It had not
//   said a word in this room. Rank decides who may seal, vouch and forget, so this is the worse of
//   the two by a distance.
//
// It had been seen once before, in a narrower form: check-room-scoping records a vouch bundle
// carrying another room's settings and "lamport positions an order of magnitude beyond anything in
// the current room". That was fixed by scoping the READER (`_heldHere`). This guard closes the
// DOOR, which is the other half — a reader that filters correctly still cannot help a derived log
// that was polluted before anyone read it.
//
// WHY THE GATE LIVES INSIDE `_ingestSpineEvent` AND NOT AT ITS CALLERS:
// the same reason the floor bound moved into `Continuity.mayAdvance` and the liveness check moved
// into ServerClock's subscription handler. A rule placed at the call sites someone happened to
// notice is a rule with holes in it, and this codebase has now found that shape four times.
//
// FAIL DIRECTION, STATED (CONCEPTS.md §3.2): with NO room bound, nothing is ours. Not "everything",
// which is what it did. Replay is the authoritative way this room's history arrives, so refusing
// unscoped events costs nothing and admitting them costs the spine.
//
// FORWARD-COMPATIBILITY (consensus/backend-selection.md §4): discovery and the room list are SHARED
// bootstrap and run before any backend is bound; only consensus is per-room. This gate sits exactly
// on that line — transport still receives everything, consensus accepts only the bound room. When
// the registry/binder arrives, setting the scope becomes part of `bind()` and the gate itself does
// not change. It is deliberately NOT folded into `_recoveryChannels`, which is checkpoint-recovery
// state; a scope that has to lift to the binder later must not drag that with it.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/consensushash.js", "backends/backend1/eventcache.js",
  "backends/backend1/statederiver.js", "backends/backend1/vouch.js",
  "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
], {});
const { MatrixBridge, EventCache } = sb;

// This room is a SPACE: several Matrix rooms, one channel per rank. Scoping to a single room id
// would silently drop this room's other rank channels — the "too narrow" failure check-room-scoping
// already pins. The scope is the channel SET.
const MINE = {
  events_owner: "!mine-events-owner:hs",
  events_uncategorized: "!mine-events-unc:hs",
  checkpoints_owner: "!mine-cp-owner:hs",
  settings_owner: "!mine-settings:hs",
};
const FOREIGN = "!other-room-events:hs";

// ── (a) the scope API exists and is a first-class thing ──────────────────────────────────────
{
  ok(typeof MatrixBridge.setRoomScope === "function",
    "a: there must be ONE place that answers 'which Matrix rooms are mine right now'");
  ok(typeof MatrixBridge.clearRoomScope === "function",
    "a: and leaving a room must be able to clear it, or a switch inherits the last room's scope");
  ok(typeof MatrixBridge.inScope === "function",
    "a: and the gate must be askable as a plain predicate, so every consumer asks the same question");
}

// ── (b) fail closed: no room bound means nothing is ours ─────────────────────────────────────
{
  MatrixBridge.clearRoomScope();
  ok(MatrixBridge.inScope(MINE.events_owner) === false,
    "b: with NO room bound, nothing is in scope — not even a room that will be ours in a moment. " +
    "This is the startup window where another room's history was being folded in.");
  ok(MatrixBridge.inScope(FOREIGN) === false, "b: and certainly not a foreign room");

  // The reader must degrade the same way. Returning EVERY room's cached events when it cannot
  // scope is the shape that leaked another room's settings into a vouch bundle.
  EventCache.store({ event_id: "$foreign", room_id: FOREIGN, type: "m.room.message",
                     sender: "@x:hs", content: { body: "{}" } });
  const held = MatrixBridge.heldHere();
  ok(Array.isArray(held) && held.length === 0,
    "b: the held set with no room bound must be EMPTY, never everything — less evidence, never " +
    "foreign evidence",
    held.map((r) => r && r.room_id));
}

// ── (c) scoped: my channel set, all of it, and nothing else ──────────────────────────────────
{
  const n = MatrixBridge.setRoomScope(MINE);
  ok(n === 4 || MatrixBridge.inScope(MINE.settings_owner),
    "c: APPLIED — the scope must actually have taken the channel map, or everything below is vacuous",
    n);

  for (const k of Object.keys(MINE)) {
    ok(MatrixBridge.inScope(MINE[k]) === true,
      "c: EVERY rank channel of this space is mine — scoping to one room id would drop the others " +
      "(the 'too narrow' failure)", k);
  }
  ok(MatrixBridge.inScope(FOREIGN) === false,
    "c: and another room's channel is not mine, however many Spaces this client belongs to");
  ok(MatrixBridge.inScope(undefined) === false && MatrixBridge.inScope(null) === false,
    "c: an event with no room id is not ours either — unknown is not a yes");
}

// ── (d) switching rooms REPLACES the scope, it does not accumulate ───────────────────────────
// The startup window is only half of it. Rooms are navigable in-app, so the scope must be
// replaced on entry — otherwise the room you just left keeps feeding this one from sync.
{
  const OTHER = { events_owner: FOREIGN };
  MatrixBridge.setRoomScope(OTHER);
  ok(MatrixBridge.inScope(FOREIGN) === true, "d: APPLIED — the new room's channel is now in scope");
  ok(MatrixBridge.inScope(MINE.events_owner) === false,
    "d: after switching, the PREVIOUS room's channels must be out of scope. A scope that " +
    "accumulates makes every room you visit a contributor to every room after it.");
  MatrixBridge.clearRoomScope();
}

// ── (e) the gate is inside the door, not at the callers ──────────────────────────────────────
// _ingestSpineEvent needs a live Matrix SDK to drive, so this half is read from the source. The
// assertion is about PLACEMENT, which is the thing that decays: a gate at two call sites is one
// forgotten call site away from being no gate.
{
  const src = fs.readFileSync(path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  const start = src.indexOf("function _ingestSpineEvent(");
  ok(start > 0, "e: APPLIED — the ingest door must be findable, or this scan proves nothing");

  const body = src.slice(start, start + 1400);
  ok(/inScope\(/.test(body),
    "e: the ingest door itself must ask whether the event's room is ours. Gating at the call " +
    "sites instead is how the floor bound, the clock and the held set each ended up with a hole.");

  // ...and it must be an EARLY return, before anything is stored or folded. A gate placed after
  // the work is a gate that only suppresses the log line.
  const gateAt = body.indexOf("inScope(");
  const storeAt = body.search(/EventCache\.store|StreamManager\.ingest/);
  ok(storeAt < 0 || gateAt < storeAt,
    "e: and it must run BEFORE the event is stored or ingested — otherwise the foreign event is " +
    "already in the spine and only the logging was skipped",
    { gateAt: gateAt, storeAt: storeAt });
}

// ── (f) the scope must be bound BEFORE replay, or the gate eats the room ─────────────────────
// The gate's whole value is that it refuses events from rooms that are not ours. Bind the scope
// AFTER replay and it refuses the replay itself — every channel of this room, silently, and the
// room comes up empty with no error anywhere. That is a worse failure than the bug being fixed,
// it is invisible at runtime (an empty room and a room with no history look identical), and it is
// exactly the ordering class this codebase keeps finding: the advance path that never asked, the
// seal clock nothing polled, the floor loaded before replay could answer it.
//
// So the ORDER is pinned, not just the presence. Read from the join flow's source, because the
// wiring is what decays — the gate itself is fine and will keep passing every test above while
// the room quietly loads nothing.
{
  const room = fs.readFileSync(path.join(__dirname, "..", "features", "room.js"), "utf8");

  // SOURCE POSITION IS NOT EXECUTION ORDER, and a first draft of this guard got that wrong:
  // `_initModules` is DEFINED far below `join` and CALLED from the top of it, so a naive
  // indexOf comparison reports the bind as happening after the replay when it does not. The
  // order that matters is the call order inside join(), plus where the bind sits within the
  // function join calls.
  const joinAt = room.indexOf("async function join(");
  ok(joinAt > 0, "f: APPLIED — the join flow must be findable");
  const join = room.slice(joinAt, room.indexOf("\n  }", joinAt));

  const wireCall = join.indexOf("_initModules(");
  const replayCall = join.indexOf("_replayAllChannels(");
  ok(wireCall > 0 && replayCall > 0,
    "f: APPLIED — join must both wire and replay, or the ordering below proves nothing",
    { wireCall: wireCall, replayCall: replayCall });
  ok(wireCall < replayCall,
    "f: join must wire before it replays", { wireCall: wireCall, replayCall: replayCall });

  // ...and the scope must be bound inside that wiring step. Bound after the replay instead, the
  // ingest door refuses this room's OWN history: every channel, silently, and the room comes up
  // empty. That is worse than the bug this gate fixes and invisible at runtime — an empty room and
  // a room with no history look identical. It is also the ordering class this codebase keeps
  // finding: the advance path that never asked, the seal clock nothing polled, the floor loaded
  // before replay could answer it.
  const wireAt = room.indexOf("function _initModules(");
  ok(wireAt > 0, "f: APPLIED — the wiring step must be findable");
  const wire = room.slice(wireAt, room.indexOf("\n  }", wireAt));

  ok(wire.indexOf("setRoomScope") > 0,
    "f: the room scope must be bound in the WIRING step, which join runs before it replays — " +
    "not somewhere the replay has already passed");
  ok(wire.indexOf("resetCheckpoints") < wire.indexOf("setRoomScope"),
    "f: and bound AFTER the previous room's state is reset, or entering a room clears the scope " +
    "it just bound and the door refuses everything",
    { resetAt: wire.indexOf("resetCheckpoints"), bindAt: wire.indexOf("setRoomScope") });
}

console.log("[room-ingest-gate] PASS — foreign rooms are refused at the ingest door rather than " +
  "filtered afterwards: with no room bound nothing is in scope and the held set is empty rather " +
  "than every room's history, a bound room admits ALL of its rank channels and no others, entering " +
  "a new room REPLACES the scope instead of accumulating it (so an in-app room switch cannot leave " +
  "the previous room feeding this one from sync), and the check sits inside `_ingestSpineEvent` " +
  "ahead of any store or fold rather than at the call sites — which is what stops another room's " +
  "positions seeding this room's clock and another room's channels importing its ranks; and the " +
  "join flow's ORDER is pinned by call order rather than source position — bound inside the " +
  "wiring step, after the previous room is reset and before this room is replayed — because a " +
  "scope bound too late makes the door refuse this room's own history and load it empty, which " +
  "at runtime is indistinguishable from a room that simply has none (" +
  checks + " assertions)");
