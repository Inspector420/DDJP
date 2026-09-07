// tests/check-reducer-ignore.js
// WALL: extensibility invariant (docs/consensus/consensus-models.md §4.1). The reducer must
// be INERT to event types it does not handle — so the future voucher / checkpoint / anchor
// / dispute types (and anything else) can be introduced as ordinary event-channel traffic
// WITHOUT touching StateDeriver. Concretely: derive(log) must equal derive(log + arbitrary
// unknown-type events), for any interleaving. If this ever fails, adding a new event type
// silently changed derived state — a consensus regression.
//
// This is the seam the whole "new types are inert; nothing overwrites the math" story rests
// on. It pairs with check-convergence (which proves ordering/convergence of the KNOWN types).
//
// ── STATE IS NOT THE ONLY THING A FOLD PRODUCES ──────────────────────────────────────────────
// For a long time this guard asserted derived STATE only, and that was not enough. The same fold
// returns the checkpoint SEED, and the seed is committed by the checkpoint FINGERPRINT — which is
// the artefact Floor.chainVerifies recomputes when it decides whether a quorum agrees. So an
// event the reducer ignores could leave state byte-identical and still move the fingerprint, and
// two honest clients differing by one inert message could not verify each other's floors. No
// quorum, no floor, no forgetting, and nothing anywhere reports it: every correctness assertion
// stays green because the ROOM is right. The vector that exposed it was `rankByUser`, written for
// every event carrying a sender before the type dispatch and read by nothing.
//
// ── WHAT COUNTS AS INERT — THE BROAD DEFINITION, DELIBERATELY ────────────────────────────────
// AN EVENT THE REDUCER HANDLES AND REJECTS IS AS INERT AS ONE IT HAS NEVER HEARD OF. THE SEED
// MUST NOT BE ABLE TO TELL THEM APART, BECAUSE THE ROOM'S STATE CAN'T.
//
// Inert here means "does not change derived state", not "is an unknown type". That is the honest
// definition and it is load-bearing, because it rules out the fix somebody will otherwise reach
// for: gating the accumulator write on HANDLED_TYPES. That narrows the vector without closing it —
// a `dj.declare` from a non-member, a `dj.move` from a guest and a `dj.leave` from someone who
// never joined are all handled, all rejected or no-ops, all inert, and all still carry a sender.
//
// ── THE DIFF THIS GUARD WAS WRITTEN RED AGAINST ─────────────────────────────────────────────
// Recorded so a future red is checkable against the one it was built for. If it fails with a
// DIFFERENT shape, that is a new finding rather than a regression of this one, and the next
// reader should treat it as such instead of assuming the old fix came undone.
//
//   PART B  rankByUser clean ["@a:hs","@b:hs","@owner:hs"]
//           rankByUser dirty ["@a:hs","@b:hs","@ghost-declare:hs","@ghost-bundle:hs",
//                             "@ghost-move:hs","@ghost-leave:hs","@ghost-peer:hs",
//                             "@ghost-len:hs","@owner:hs"]
//           extra keys: all six inert senders — INCLUDING the four the reducer handles.
//   PART C  fingerprint CzVhlGVU2sYjtgUD3Se_4fvDdjfUMXAmRsqEjYX77BM (clean)
//                    vs a57ZNYLhJ2O8viWK8TNZ-KPI5WWkCxW9hltx6qi7kBs (dirty)
//   PART D  a hand-injected "@ghost-from-an-old-seal:hs" survived restore and was re-emitted.
//
// PART A(ii) passed in that run, which is the point: the room was identical on both sides.
//
// CONSEQUENCE WORTH STATING SO NOBODY WRITES A SECOND GUARD: the seed effect of the
// accepted-but-no-op `ddjp.dj.leave` (a leave from a non-member is ACCEPTED by the reducer and
// changes nothing) falls out of PART B here. Its OTHER effect — that being accepted makes it
// legal, and therefore protectable vouch work — is a separate question in the reducer's rejection
// paths and is NOT covered here. Fix that one where it lives; do not duplicate this guard for it.

const { loadInContext } = require("./_load");

// Returns the whole sandbox: the seed and fingerprint parts need StateDeriver and
// CheckpointFormat alongside the stream. Driven through StreamManager.ingest + getLog() rather
// than by hand-building reducer entries, so the fixture reaches the fold the way production does
// (transport -> normalise -> ordered log -> buildSeed), which is what Checkpoint.seal actually does.
function makeSandbox() {
  return loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/streammanager.js"], { Date });
}
function makeClient() { return makeSandbox().StreamManager; }
function raw(eventId, l, sender, body, rank) {
  const r = {
    event_id: eventId, room_id: "!room:hs", type: "m.room.message", sender: sender,
    content: { body: JSON.stringify(Object.assign({ l: l }, body)) }, ts: l * 60000, l: l,
  };
  if (rank !== undefined) r.senderRank = rank;
  return r;
}

const RANK = { OWNER: 100, STAFF: 60 };
const j = (x) => JSON.stringify(x);
let failed = 0;
function fail(msg, detail) { console.log("[reducer-ignore] FAIL — " + msg + (detail ? "\n      " + detail : "")); failed++; }

// A real, representative KNOWN-type scenario (join / declare / play chain / settings).
const KNOWN = [
  raw("$01", 1, "@a:hs", { t: "ddjp.dj.join",    v: "S1" }),
  raw("$02", 2, "@b:hs", { t: "ddjp.dj.join",    v: "S2" }),
  raw("$03", 3, "@a:hs", { t: "ddjp.dj.declare", v: "S1b" }),
  raw("$04", 4, "@a:hs", { t: "ddjp.dj.play",    p: null }),
  raw("$05", 5, "@b:hs", { t: "ddjp.dj.play",    p: "$04" }),
  raw("$06", 6, "@owner:hs", { t: "ddjp.room.settings", s: { chat: "guest" } }, RANK.OWNER),
];

// The future / unknown types the reducer must ignore — including ones that carry fields
// with the SAME names the reducer reads for known types (p, s, v, x), interleaved at and
// around the known events' (l, event_id) positions, at high and low rank.
const UNKNOWN = [
  raw("$v1", 4, "@z:hs", { t: "ddjp.voucher", v: [{ id: "$04", body: { t: "ddjp.dj.play", l: 4, p: null } }] }, RANK.OWNER),
  raw("$v2", 5, "@z:hs", { t: "ddjp.some.future.type", ids: ["$04", "$05"] }, RANK.STAFF),
  raw("$c1", 3, "@owner:hs", { t: "ddjp.checkpoint", upto: 6, tallies: { S1: 3 }, s: { chat: "uncategorized" } }, RANK.OWNER),
  raw("$a1", 5, "@owner:hs", { t: "ddjp.dj.anchor", p: "$04", x: "@a:hs" }, RANK.OWNER),
  raw("$q1", 6, "@a:hs", { t: "ddjp.future.unknown", p: "$99", v: "SX", x: "@a:hs", s: { chat: "guest" } }),
  raw("$q2", 1, "@a:hs", { t: "ddjp.dj.dispute", target: "$04", dur: 999 }, RANK.STAFF),
  // J18 — a settings REQUEST. Added here rather than in a new guard, which is what J18's own Open
  // asked for: the question "is this type inert" already has a wall, and a second one would be a
  // second definition of inertness free to drift from this one. It is the FIRST inert type that is
  // actually SENT by a shipped feature rather than being a placeholder for a future one — so if
  // this list's promise is ever going to be load-bearing, it is load-bearing here.
  //
  // NOTE THE PAYLOAD: it carries `s`, the same field name the reducer's settings branch reads its
  // blob from. That is deliberate. A reducer that dispatched on the presence of a field rather
  // than on the TYPE would apply this, and the type-only dispatch is the property being pinned.
  raw("$br1", 6, "@player:hs", { t: "ddjp.bot.request", k: "maxLen", v: 600, s: { chat: "staff" } }, RANK.PLAYER),
];

// Baseline: known events only.
const base = makeClient();
KNOWN.forEach((e) => base.ingest(e));
const baseState = j(base.getState());

// 1) Known + all unknowns interleaved -> identical state.
const mixed = makeClient();
KNOWN.concat(UNKNOWN).forEach((e) => mixed.ingest(e));
if (j(mixed.getState()) !== baseState) fail("unknown-type events changed derived state", "got " + j(mixed.getState()));

// 2) Robust across many random interleavings (the sort places unknowns everywhere).
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
let runs = 0;
for (let i = 0; i < 300; i++) {
  const C = makeClient();
  shuffle(KNOWN.concat(UNKNOWN)).forEach((e) => C.ingest(e));
  if (j(C.getState()) !== baseState) { fail("a shuffled known+unknown order diverged from baseline", "run " + i); break; }
  runs++;
}

// 3) Unknown types ALONE contribute nothing: derived state is the default (no now-playing,
// empty rotation, default settings, empty history). (Asserted field-by-field because a
// never-ingested client's getState() omits the history key entirely — an empty-vs-ingested
// shape quirk unrelated to type handling.)
const onlyUnknown = makeClient();
UNKNOWN.forEach((e) => onlyUnknown.ingest(e));
const su = onlyUnknown.getState();
const DEFAULT_SETTINGS = makeClient().getState().settings;   // the reducer's own default (drift-proof)
if (su.nowPlaying !== null) fail("unknown-only: nowPlaying must stay null", "got " + j(su.nowPlaying));
if (j(su.rotation) !== "[]") fail("unknown-only: rotation must stay empty", "got " + j(su.rotation));
if (j(su.settings) !== j(DEFAULT_SETTINGS)) fail("unknown-only: settings must stay default", "got " + j(su.settings));
if (su.history && su.history.length !== 0) fail("unknown-only: history must stay empty", "got " + j(su.history));


// ══════════════════════════════════════════════════════════════════════════════════════════════
// PART B / C / D — THE SEED, THE FINGERPRINT, AND THE SEED CHAIN
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// ── THE INERT SET, WITH SENDERS THAT APPEAR NOWHERE ELSE ─────────────────────────────────────
// THIS IS THE FIXTURE REQUIREMENT THAT DECIDES WHETHER THIS GUARD CAN FAIL AT ALL. The
// accumulator under test is keyed by SENDER, so an inert event from a sender who also appears in
// KNOWN contributes a key the clean log already has, both sides compare equal, and the guard
// passes while the bug is fully present. A fixture that tidies these senders into the existing
// cast is how this guard would rot — the "too simple to distinguish the mutation" trap in the
// build law, applied to identity rather than to iteration count.
//
// Asserted below (INERT_ONLY_SENDERS) rather than trusted, so a future edit cannot empty it.

// Handled by the reducer and REJECTED or no-op'd — inert by the broad definition, and the half a
// HANDLED_TYPES gate would miss. Positions sit below the cut so the seed sees them.
const INERT_HANDLED = [
  raw("$h1", 2, "@ghost-declare:hs", { t: "ddjp.dj.declare", v: "SX" }),               // not in the rotation -> rejected
  raw("$h2", 3, "@ghost-move:hs",    { t: "ddjp.dj.move", x: "@a:hs" }, 10),           // guest -> no permission -> rejected
  raw("$h3", 3, "@ghost-leave:hs",   { t: "ddjp.dj.leave" }),                          // never joined -> ACCEPTED, changes nothing
  raw("$h4", 4, "@ghost-len:hs",     { t: "ddjp.play.len", pi: "$nonexistent", sec: 30 }), // dead pi -> rejected
];
// Unknown types, same rule about senders.
const INERT_UNKNOWN = [
  raw("$u1", 2, "@ghost-bundle:hs", { t: "ddjp.witness.bundle", w: [] }),
  raw("$u2", 3, "@ghost-peer:hs",   { t: "ddjp.checkpoint", n: 1, seed: {}, h: "x" }, 80),
  // J18 — the request type again, here in the SEED/FINGERPRINT accounting rather than the state
  // one. This is the half that matters: an event leaving state identical while moving the seed
  // would stop two honest clients verifying each other's floors, with every correctness assertion
  // still green. A request is sent by a real feature and can arrive at any rate, so it is exactly
  // the shape that would expose an accumulator written before the type dispatch.
  raw("$u3", 4, "@ghost-request:hs", { t: "ddjp.bot.request", k: "maxLen", v: 600 }, 20),
];
const INERT = INERT_HANDLED.concat(INERT_UNKNOWN);

const knownSenders = new Set(KNOWN.map((e) => e.sender));
const INERT_ONLY_SENDERS = INERT.filter((e) => !knownSenders.has(e.sender)).length;
// THE FIXTURE ASSERTION. Without it, any edit that reuses an existing sender empties the
// comparison and every part below passes vacuously.
if (INERT_ONLY_SENDERS < INERT.length) {
  fail("fixture: every inert event must come from a sender that appears nowhere else",
       "only " + INERT_ONLY_SENDERS + " of " + INERT.length + " are exclusive");
}

function seedOf(events) {
  const sb = makeSandbox();
  events.forEach((e) => sb.StreamManager.ingest(e));
  return { seed: sb.StateDeriver.buildSeed(sb.StreamManager.getLog()), sb: sb, sm: sb.StreamManager };
}

const clean = seedOf(KNOWN);
const dirty = seedOf(KNOWN.concat(INERT));

// PART A(ii) — the premise. These events must genuinely be inert, or B/C/D are testing nothing.
if (j(dirty.sm.getState()) !== j(clean.sm.getState())) {
  fail("PART A(ii): the inert fixture changed derived state, so it is not inert",
       "clean " + j(clean.sm.getState()) + "\n      dirty " + j(dirty.sm.getState()));
}

// ── PART B — THE SEED ────────────────────────────────────────────────────────────────────────
if (j(dirty.seed) !== j(clean.seed)) {
  const ck = Object.keys(clean.seed.rankByUser || {});
  const dk = Object.keys(dirty.seed.rankByUser || {});
  fail("PART B: an inert event changed the checkpoint SEED",
       "rankByUser clean " + j(ck) + "\n      rankByUser dirty " + j(dk) +
       "\n      extra keys: " + j(dk.filter((k) => ck.indexOf(k) < 0)));
}

// ── PART C — THE FINGERPRINT ─────────────────────────────────────────────────────────────────
// The consensus-visible artefact. B alone would pass if somebody later excluded a key from the
// hash instead of from the seed — which is the fix checkpointformat.js's own header forbids, on
// the grounds that an uncommitted body field is one an attacker can rewrite.
{
  const F = clean.sb.CheckpointFormat.fingerprint;
  const covers = clean.sb.CheckpointFormat.coversOf("$01", "$06");
  const hClean = F(1, null, clean.seed, 6, false, covers);
  const hDirty = F(1, null, dirty.seed, 6, false, covers);
  if (hClean !== hDirty) {
    fail("PART C: an inert event changed the checkpoint FINGERPRINT — two honest clients " +
         "differing by one ignored message cannot verify each other's floor",
         "clean " + hClean + "\n      dirty " + hDirty);
  }
}

// ── PART D — THE SEED CHAIN ──────────────────────────────────────────────────────────────────
// The half that a write-side-only fix would leave open. A seed ARRIVES from somebody else's
// checkpoint and is restored into the fold; if the restore re-admits an inert sender's entry, the
// next seal re-emits it and the pollution propagates down the chain forever — from a client that
// never saw the inert event at all. Injected by hand precisely because it models an OLD or
// hostile checkpoint rather than anything this build would produce.
{
  const polluted = JSON.parse(j(clean.seed));
  if (polluted.rankByUser && typeof polluted.rankByUser === "object") {
    polluted.rankByUser["@ghost-from-an-old-seal:hs"] = 60;
  }
  const sb = makeSandbox();
  const after = raw("$07", 7, "@a:hs", { t: "ddjp.dj.join", v: "S9" });
  sb.StreamManager.ingest(after);
  const reEmitted = sb.StateDeriver.buildSeed(sb.StreamManager.getLog(), polluted);
  const carried = Object.keys(reEmitted.rankByUser || {}).indexOf("@ghost-from-an-old-seal:hs") >= 0;
  if (carried) {
    fail("PART D: a seed carrying an inert sender's entry PROPAGATED it into the next seal",
         "re-emitted rankByUser " + j(Object.keys(reEmitted.rankByUser || {})));
  }
}

if (failed) { console.log("[reducer-ignore] " + failed + " failure(s)"); process.exit(1); }
console.log("[reducer-ignore] PASS — a fold is inert to an event that changes nothing, in every artefact it produces: " +
  "derived state is unchanged across " + runs + " interleavings of unknown types; and the checkpoint SEED, its " +
  "FINGERPRINT and the next seal down the seed chain are unchanged by " + INERT.length + " inert events — " +
  INERT_HANDLED.length + " of them types the reducer HANDLES and rejects, because an event it handles and rejects " +
  "is as inert as one it has never heard of and the seed must not be able to tell them apart");
process.exit(0);
