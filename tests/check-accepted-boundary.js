// tests/check-accepted-boundary.js
// J03. WALL: A FLOOR YOU HAVE ACCEPTED BOUNDS WHAT YOU FOLD, LONG BEFORE YOU ARE ALLOWED TO DELETE.
//
// The rule "an event inside a banked stretch is not folded again" existed and worked, but switched
// on `_trimmedBelow !== null` — the client has DELETED. Deleting needs the whole forget licence, so
// a client that had ADOPTED a floor and was not yet licensed to forget had no boundary at all.
//
// ── WHAT THAT ACTUALLY COST, DRIVEN RATHER THAN REASONED ─────────────────────────────────────
// It is NOT double-counting. While untrimmed the client folds from GENESIS, so a below-cut arrival
// is folded once, correctly, into a genesis view. The damage is one layer up, in `_deriveBest`:
// the seed is validated by comparing the genesis fold of EVERYTHING HELD against
// `derive(eventsAfterCheckpoint, seed)`. A late arrival below the cut is in the first and excluded
// from the second, so if it moves forward state the verdict is `mismatched` — which is CONCLUSIVE.
// Measured on an identical pair of runs, one owner settings write arriving late below the cut:
//
//     control (no late arrival)   seedValidation: validated
//     case    (late below-cut)    seedValidation: mismatched / diverges-from-genesis
//     ...and still mismatched five honest events later. Forgetting is never licensed at that cut.
//
// So this is the enforcement half of J02 in a sharper sense than the plan states: without it, one
// routine back-paginated straggler permanently ends forgetting at a floor the room worked to earn.
// PART E is that measurement, with its control, because a mismatch with nothing to compare it to
// proves nothing.
//
// ── WHY A SECOND BOUNDARY AND NOT A MOVED TRIGGER — THE REGRESSION THIS FILE EXISTS TO PIN ────
// `_trimmedBelow !== null` is the sole answer to TWO questions that are not this one:
//   · `Floor._env.trimmed()`  -> withdraw vs demote-to-stale in `_weakened`
//   · `thin`                  -> a field on a SEALED CHECKPOINT BODY, inside the fingerprint
//                                (`fingerprint(n, prev, seed, floorL, thin, covers)`)
// Re-pointing that trigger would have made an adopted-but-untrimmed client publish `thin: true`
// while still holding genesis — a false statement in a hashed field, in the format Phase 6 freezes
// — and would have cost a client that can still safely fall back its withdrawal. PART D is the pin,
// and it is the assertion to check first if this file ever goes red.
//
// Guarantees:
//   PART A — an arrival inside an ACCEPTED floor's stretch is not folded; one just above it is,
//            so the refusal is attributable to the boundary and not to anything else.
//   PART B — and it is IGNORED, never dropped: the client still holds the bytes and can still
//            serve a repair. StreamManager adds no store of its own; the cache is upstream.
//   PART C — belief is retractable. Withdrawing the floor releases the boundary and the same
//            arrival is admissible again — the fallback `_withdraw()` assumes actually exists.
//            AND it records the gap: nothing re-delivers it on its own (see the note in PART C).
//   PART D — adopting does not move `_trimState()`, because two other rules read that value.
//   PART E — the seed-validation poisoning above does not happen, against a control that does.
//   PART F — a client that HAS trimmed behaves exactly as before.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[accepted-boundary] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

// The sandbox must load every module the subject consults. `seedLicensesForget` has an
// absent-engine fallback for SettingsProof that is correct in production and would certify the
// inverse here, so settingsproof.js is loaded rather than omitted. eventcache.js is loaded because
// PART B's whole claim is about who holds the bytes, and a guard that asserts "still held" without
// the holder present is asserting nothing.
const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
  "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js",
  "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, Floor, SettingsProof, EventCache } = C;

// Every room states its own rules: the owner posts a complete settings blob at creation, and a
// room whose seed names no settings event cannot exist — the proof path answers "unverifiable" for
// one, which withholds the forget licence. So genesis is a settings write and the room shifts up.
const SETTINGS_BLOB = StateDeriver.defaultSettings();
const LOG = [
  F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: SETTINGS_BLOB }),
].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
  F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));

const CUT = 7;
const BELOW = LOG.slice(0, CUT);
const SEED = StateDeriver.buildSeed(BELOW);
const BOUNDARY_L = BELOW[BELOW.length - 1].l;
const BOUNDARY_ID = BELOW[BELOW.length - 1].eventId;

function floor(grade) {
  return { n: 1, prev: null, seed: SEED, h: "hhhhhhhh",
           covers: BELOW[0].eventId + ".." + BOUNDARY_ID,
           floorL: BOUNDARY_L, by: "@owner:hs", grade: grade || "verified" };
}

// The arrival under test. An owner settings write is the honest choice for PART E: it is
// forward-relevant by construction (`_canon` reads `settings`), it is owner-gated so it cannot be
// dismissed as junk, and back-paginating the settings channel is exactly how one arrives late.
// Every value stays inside SETTING_RANGES, so nothing is refused for an unrelated reason.
const CHANGED = Object.assign({}, SETTINGS_BLOB, { maxLen: 300 });
const LATE_BELOW = F.reducerEvent("$late-below", BOUNDARY_L - 1, 1500, "@owner:hs",
  F.RANK.owner, { t: "ddjp.room.settings", s: CHANGED });
// THE CONTROL. Same sender, same type, same shape — one position above the boundary instead of
// below it. Without this a refusal is unattributable: a probe that never reaches the gate refuses
// everything for free, and twice in J02 an assertion was green because the arrival was refused
// UPSTREAM by the backdating rule and never reached the rule under test at all.
const LATE_ABOVE = F.reducerEvent("$late-above", BOUNDARY_L + 1, 1500, "@owner:hs",
  F.RANK.owner, { t: "ddjp.room.settings", s: CHANGED });

// Room entry: StreamManager.reset() then Floor.reset(), which is the pair `_initModules` makes via
// MatrixBridge.resetCheckpoints(). Resetting only the first models a client that cannot exist, and
// since J03 it fails three steps from its cause — see check-floor-pairing's feed().
function fresh() {
  StreamManager.reset();
  Floor.reset();
  SettingsProof.reset();
  SettingsProof.attach({ now: () => Date.now(), pageSettings: null });
}
// PRODUCTION ORDER, NOT A CONVENIENCE. `_ingestSpineEvent` stores the raw and THEN ingests it —
// the two lines are adjacent, and that adjacency is the entire reason this job must not add a
// store to StreamManager. A helper that ingests without storing would model a client that never
// existed and would make PART B unfalsifiable.
function deliver(e) {
  const raw = F.toRaw(e);
  try { EventCache.store(raw); } catch (err) {}
  StreamManager.ingest(raw);
}
function feed(events) { for (const e of events) deliver(e); }
const inLog = (id) => StreamManager.getLog().some((e) => e.eventId === id);

// The announcement, held in one place because PART H reports it from inside a microtask callback —
// the re-adoption it measures lands after the synchronous body finishes, and a guard that exits 0
// with no PASS line is one the runner fails, which is the correct failure if that callback never
// runs at all.
const SUMMARY =
  "a floor you have ACCEPTED bounds what you fold, without waiting for permission to delete: an " +
  "arrival from inside its stretch is ignored while one a single position above it is admitted, so " +
  "the refusal is attributable to the boundary; the ignored event is still HELD and still servable " +
  "for repair, because the cache sits upstream of this gate and StreamManager adds no store of its " +
  "own; withdrawing the floor RELEASES the boundary so the fallback `_withdraw()` assumes exists " +
  "actually does; adopting does not move the TRIMMED boundary, which two other rules read — one of " +
  "them `thin`, inside a checkpoint\'s fingerprint; the seed-validation divergence this prevents is " +
  "measured against a control that validates; a client that has genuinely trimmed behaves exactly " +
  "as it did before; and — J37 — the re-delivery GAP is now driven through the production wire " +
  "rather than asserted in a sandbox that could not see it: with `matrixbridge` loaded and " +
  "`_withdraw()` reached through `revalidate`, the real `withdrawn` subscriber re-pages, the pager " +
  "it builds returns the ignored arrival\'s own bytes, and `thinJoin` discards them — so nothing " +
  "re-delivers, proven against an adjacent admission that the same arrival delivered explicitly at " +
  "that moment DOES fold. The assertion this replaces stayed green while re-delivery was built, as " +
  "did all 116 guards. And the release is not always sustained: where the raw cache still supports " +
  "the broken chain the re-page RE-ADOPTS the same floor and the boundary returns within a " +
  "microtask, which is the sub-case J37\'s entry does not anticipate";

// ── PART A: an accepted floor bounds what is folded, and the control proves it is the floor ───
{
  fresh();
  feed(LOG);
  ok(StreamManager.getLog().length === LOG.length,
    "A: APPLIED — the whole log must be held before a floor exists", StreamManager.getLog().length);

  Floor._setTrustedForTest(floor("verified"));
  // NO licence: trimToFloor is a no-op, so this client has ACCEPTED and not DELETED. That is the
  // exact state the old code had no boundary for, and asserting it is what makes the rest of this
  // part about the accepted boundary rather than about trimming.
  const dropped = StreamManager.trimToFloor();
  ok(dropped === 0 && StreamManager._trimState() === null,
    "A: APPLIED — the client under test must have adopted WITHOUT trimming, or this part is " +
    "exercising the old rule", { dropped: dropped, boundary: StreamManager._trimState() });

  deliver(LATE_BELOW);
  deliver(LATE_ABOVE);

  ok(!inLog("$late-below"),
    "A: an arrival from inside an ACCEPTED floor's stretch must not reach the fold — the floor's " +
    "seed already accounts for that region, and folding it again is what makes the seeded and " +
    "genesis views disagree (PART E measures the cost)");
  ok(inLog("$late-above"),
    "A: CONTROL — the same event one position ABOVE the boundary must be admitted, or the " +
    "refusal above is attributable to anything at all");

  // ── THE SAME CONTROL, ON THE AXIS THE ONE ABOVE DOES NOT VARY ──────────────────────────────
  // The control above varies POSITION and holds the id constant, so it proves the boundary is the
  // floor and proves nothing about the (l, event_id) tiebreak. Two events can share a position,
  // and the sibling sorting AFTER the boundary id at that position is genuinely still needed —
  // so the pair below varies the ID and holds the position constant.
  //
  // WHY THIS WAS MISSING, WHICH IS THE TRANSFERABLE PART: `at(b, bid)` was carried over from the
  // working trimmed path rather than written fresh, so it never read as a new claim and nothing
  // pointed a guard at it. The guard that did cover it — `check-floor-pairing` PART C, and
  // `check-derived-log-bound` PART H — stayed pointed at the trimmed boundary. Measured on this
  // tree at v237: dropping the tiebreak on the ACCEPTED path only left the whole suite green in
  // the under-refusing direction, and was caught only incidentally, by an unrelated guard on
  // another file, in the over-refusing one.
  //
  // The under-refusing direction is the one that matters: it admits an arrival the floor's seed
  // already accounts for, which is exactly what PART E measures the cost of.
  const SIB_BANKED_ID   = String(BOUNDARY_ID).slice(0, -1);   // a prefix, so it sorts BEFORE
  const SIB_ADMITTED_ID = String(BOUNDARY_ID) + "z";          // an extension, so it sorts AFTER
  // APPLIED, using the SAME comparison the subject uses — a fixture that does not actually
  // straddle the boundary id would make both assertions below pass for no reason at all.
  ok(String(SIB_BANKED_ID) <= String(BOUNDARY_ID) && !(String(SIB_ADMITTED_ID) <= String(BOUNDARY_ID)),
    "A: APPLIED — the sibling ids must genuinely straddle the boundary id under the comparison " +
    "the gate performs, or the pair below tests nothing",
    { boundary: BOUNDARY_ID, banked: SIB_BANKED_ID, admitted: SIB_ADMITTED_ID });

  // Both sit at the boundary POSITION, and both carry a ts below the room's head so the ordering
  // rule in `validate()` cannot refuse them first — an arrival refused upstream never reaches the
  // gate, and a refusal that never reached the rule under test is the trap this file already
  // guards against in PART A's first control.
  deliver(F.reducerEvent(SIB_BANKED_ID, BOUNDARY_L, 1500, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: CHANGED }));
  deliver(F.reducerEvent(SIB_ADMITTED_ID, BOUNDARY_L, 1500, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: CHANGED }));

  ok(!inLog(SIB_BANKED_ID),
    "A: an arrival AT the boundary position whose id sorts at-or-below the boundary id is inside " +
    "what the floor banked and must be refused. Dropping the tiebreak here admits it, and the " +
    "whole suite stays green — this is J03's own defect reopened at one position",
    { l: BOUNDARY_L, id: SIB_BANKED_ID, boundaryId: BOUNDARY_ID });
  ok(inLog(SIB_ADMITTED_ID),
    "A: CONTROL — and its sibling at the SAME position whose id sorts after the boundary id is " +
    "genuinely still needed and must land. Comparing on position alone would swallow it: not " +
    "below the floor, not in the log, gone",
    { l: BOUNDARY_L, id: SIB_ADMITTED_ID, boundaryId: BOUNDARY_ID });
}

// ── PART B: ignored, not dropped — and the keeping is UPSTREAM ───────────────────────────────
// The instinct J03's own plan encoded was that ignoring loses the event, so StreamManager should
// keep a copy before refusing. It must not: `EventCache.store(raw)` runs one line above
// `StreamManager.ingest(raw)` on every path that reaches the gate. KEEP is already satisfied
// upstream, and a store here would be a second answer to "who holds the bytes".
//
// B1 ALONE WOULD BE DECORATIVE, and this is the shape §12 of the audit list warns about: the
// helper does the storing, so "it is still held" would hold for a reason that has nothing to do
// with the subject. B2 is what makes the pair falsifiable — it drives ingest with NO upstream
// store and requires the cache to stay empty, which is only true while StreamManager adds none of
// its own. Add a store to the refusal path and B2 goes red; that is the assertion doing the work.
{
  ok(!inLog("$late-below"), "B: APPLIED — the arrival must be absent from the fold to begin with");
  const held = EventCache.get("$late-below");
  ok(held && held.event_id === "$late-below",
    "B1: the ignored arrival is still HELD — refusing it at the fold does not reach back and " +
    "remove the copy the cache took one line earlier, so the client remains a repair source",
    held ? held.event_id : null);

  const lone = F.reducerEvent("$lone-below", BOUNDARY_L - 2, 1500, "@owner:hs",
    F.RANK.owner, { t: "ddjp.room.settings", s: CHANGED });
  StreamManager.ingest(F.toRaw(lone));      // ingest ONLY — no upstream store, unlike deliver()
  ok(!inLog("$lone-below"), "B: APPLIED — it must be refused, or B2 tests an admitted event");
  let stored = null;
  try { stored = EventCache.get("$lone-below"); } catch (e) { stored = null; }
  ok(!stored,
    "B2: StreamManager must add NO store of its own. Driven by ingesting without the upstream " +
    "store: if the refusal path kept a copy, the cache would hold one now. J03's plan asserted " +
    "the opposite as a settled premise — that the gate 'drops the event entirely' — and two " +
    "sessions read past it, so the correct instruction is pinned here rather than described",
    stored && stored.event_id);
}

// ── PART C: belief is retractable — withdrawing releases the boundary ────────────────────────
// `_withdraw()` clears the trusted floor and expects the client to fall back to folding what it
// holds. If the boundary outlived the floor, that fallback would be to a log with a hole in it.
//
// ── WHAT THIS PART NO LONGER CLAIMS, AND WHY THE ASSERTION WAS DELETED RATHER THAN MOVED ─────
// It used to carry a second assertion here — `ok(!inLog("$late-below"), "C: THE GAP — nothing
// re-delivers the ignored arrival on withdrawal … if this ever goes red, re-delivery was built")`
// — and J37's entry cited it as the gap being "driven, not assumed". It was assumed. MEASURED
// (`tools/probes/mutate-j37-redelivery.js` row 1): re-delivery was BUILT, in the production
// `withdrawn` subscriber, and that assertion stayed green — as did all 116 guards.
//
// It could not have failed. This sandbox never loads `matrixbridge.js`, where the subscriber
// lives, and `_setTrustedForTest(null)` writes the field directly rather than EMITTING `withdrawn`,
// so no re-delivery reachable from the emission is observable from here at all. What it pinned was
// "StreamManager does not re-deliver by itself, in this sandbox"; what it advertised was a property
// of the system. That is `check-floor-pairing` PART G's shape one release later — a tripwire
// load-bearing for a different claim than the one it announces — and worse in one respect: PART G
// pinned a precondition that went false, while this pinned an ABSENCE and promised to announce the
// presence. A guard that has never failed is a guard nobody has checked.
//
// The claim is now in PART G, which loads the bridge, drives the real emission, and goes red when
// re-delivery is built. Deleted rather than kept alongside it: a second copy would read as a
// control and stop anyone asking whether the rule is covered, which is the failure that produced
// this entry in the first place.
{
  Floor._setTrustedForTest(null);
  ok(Floor.position() === Floor.NO_FLOOR,
    "C: APPLIED — the floor must genuinely be gone", Floor.position());

  deliver(LATE_BELOW);
  ok(inLog("$late-below"),
    "C: once re-delivered, the previously-ignored arrival folds — the boundary was released with " +
    "the floor, so the fallback `_withdraw()` assumes actually exists");
}

// ── PART D: adopting must not move the TRIMMED boundary ──────────────────────────────────────
// THE REGRESSION PIN. Two other rules read `_trimState()`, and neither is this one.
{
  fresh();
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  StreamManager.trimToFloor();          // no licence -> no trim
  deliver(LATE_BELOW);                  // and exercise the accepted gate while we are here

  ok(StreamManager._trimState() === null,
    "D: adopting a floor must NOT set the trimmed boundary. `Floor._env.trimmed()` reads this to " +
    "choose WITHDRAW vs DEMOTE-TO-STALE, and `thin` reads it for a checkpoint body field that is " +
    "INSIDE THE FINGERPRINT — so a moved trigger would publish `thin: true` from a client still " +
    "holding genesis, a false statement in a hashed field. Two boundaries, not one re-pointed",
    StreamManager._trimState());
}

// ── PART E: the cost, measured, with its control ─────────────────────────────────────────────
// The reason the job exists. Two identical runs differing only in one late below-cut arrival.
{
  fresh();
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  feed([F.reducerEvent("$nudgeA", 99, 999999, "@dj:hs", F.RANK.player,
        { t: "ddjp.dj.declare", v: "NUDGE" })]);
  const control = StreamManager.seedValidation();
  ok(control.status === "validated",
    "E: CONTROL — with no late arrival the seed must validate, or a mismatch below would be " +
    "attributable to the fixture rather than to the arrival", control);

  fresh();
  feed(LOG);
  Floor._setTrustedForTest(floor("verified"));
  deliver(LATE_BELOW);
  feed([F.reducerEvent("$nudgeB", 99, 999999, "@dj:hs", F.RANK.player,
        { t: "ddjp.dj.declare", v: "NUDGE" })]);
  const guarded = StreamManager.seedValidation();
  ok(guarded.status === "validated",
    "E: a late arrival from below the cut must not be able to make the seed diverge from genesis. " +
    "`mismatched` is CONCLUSIVE, so without the boundary one routine back-paginated straggler " +
    "permanently ends forgetting at this floor — measured before the fix, and still mismatched " +
    "five honest events later", guarded);
}

// ── PART F: a client that HAS trimmed is unchanged ───────────────────────────────────────────
// The old rule keeps its old behaviour: committed is committed, and there is nothing to fall back
// to, so dropping stays right there.
{
  fresh();
  feed(LOG);
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markGenesisReached();
  SettingsProof.proveClaim({ claimed: SEED.settings, settingsFrom: SEED.settingsFrom,
                             atL: BOUNDARY_L, floorL: BOUNDARY_L });
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  Floor._setTrustedForTest(floor("verified"));
  const dropped = StreamManager.trimToFloor();

  ok(dropped > 0 && StreamManager._trimState() === BOUNDARY_L,
    "F: APPLIED — this client must genuinely have trimmed, or the part below tests nothing",
    { dropped: dropped, boundary: StreamManager._trimState() });

  deliver(LATE_BELOW);
  ok(!inLog("$late-below"),
    "F: a trimmed client still refuses an arrival the floor banked, exactly as before");

  // ── THE BOUNDARY EVENT ITSELF, WHICH ONLY THIS PATH CAN REACH ──────────────────────────────
  // The tiebreak is `<=`, not `<`, and the equality case is the boundary event re-arriving. On the
  // ACCEPTED path that is unreachable — the client has not trimmed, so the boundary event is still
  // in `eventLog` and the dedup check two steps above the gate returns first, which is why PART A's
  // sibling pair straddles the boundary id rather than landing on it.
  //
  // AFTER A TRIM IT IS REACHABLE, because `trimToFloor` filters `e.l > floorL` and so drops the
  // boundary event itself. Dedup can no longer shield it, and back-pagination re-delivers exactly
  // this event. Driven both ways on this tree: with `<=` it stays refused; with `<` it is admitted
  // and re-folded against a seed that already accounts for it — the double-count the whole rule
  // exists to prevent.
  //
  // This predates J03 — the comparison came from the trimmed path and J03 only moved it into
  // `at()` — and NOTHING in the suite caught the `<`/`<=` swap on either path. Same route as the
  // accepted path's missing id control: a line that moved kept the coverage it had where it used
  // to be, which was none.
  const boundaryEvent = BELOW[BELOW.length - 1];
  ok(!StreamManager.getLog().some((e) => e.eventId === BOUNDARY_ID),
    "F: APPLIED — the boundary event must have been dropped by the trim, or dedup would shield " +
    "this case and the assertion below would pass for the wrong reason", BOUNDARY_ID);
  deliver(boundaryEvent);
  ok(!inLog(BOUNDARY_ID),
    "F: the boundary event ITSELF is inside what the floor banked and must stay refused when " +
    "back-pagination re-delivers it. The comparison is `<=` for this one row; `<` admits it and " +
    "double-counts it against a seed that already contains it",
    { l: BOUNDARY_L, id: BOUNDARY_ID });
}

// ── PARTS G AND H: THE GAP, THROUGH THE PRODUCTION WIRE ──────────────────────────────────────
// J37. Everything above drives `StreamManager` and `Floor` with the bridge absent, which is right
// for the rules they own and is exactly why the deleted assertion in PART C could not fail. The
// claim "nothing re-delivers the ignored arrival" is a claim about the WIRING, so it is driven the
// way `check-settings-readback` PART C drives its own: load `matrixbridge.js`, run `_wireConcepts`
// so the REAL `withdrawn` subscriber is installed, and reach `_withdraw()` through `revalidate()`
// rather than by setting a field.
//
// THE ADMISSIBILITY GATE IS THE POINT HERE, not decoration. Every stage below returns the same
// `false` on success and on never having run, and an unreached measurement returns that `false` in
// every tree including a tree where re-delivery exists. So each precondition is a separate `ok`
// naming the stage it covers, and the gap assertion sits after all of them.
{
  const W = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/floor.js", "backends/backend1/continuity.js",
    "backends/backend1/history.js", "backends/backend1/settingsproof.js",
    "backends/backend1/dials.js", "backends/backend1/eventcache.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
  ], { window: { location: { origin: "", pathname: "" }, addEventListener: () => {} },
       document: { addEventListener: () => {} },
       localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
       navigator: {}, indexedDB: null, Date: Date,
       setTimeout: (f) => { if (typeof f === "function") f(); return 1; },
       clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });

  // THE SCOPE IS THE FIXTURE ROOM, and that is load-bearing rather than housekeeping: `_heldHere()`
  // scopes the raw cache, so a mismatched scope makes the pager return nothing — which looks
  // exactly like "the re-page found nothing to re-deliver" and would make PART G pass for the one
  // reason it must never pass for.
  W.MatrixBridge.seedClock("!space:hs");
  W.MatrixBridge.setRoomScope({ events_owner: F.ROOM, settings_owner: "!settings-owner:hs" });
  W.MatrixBridge._wireConcepts({ events_owner: F.ROOM, settings_owner: "!settings-owner:hs" });

  const WLOG = [
    F.reducerEvent("$wGenesis", 1, 900, "@owner:hs", F.RANK.owner,
      { t: "ddjp.room.settings", s: W.StateDeriver.defaultSettings() }),
  ].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
    F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
  const JOIN_EV = WLOG[8];              // a chain JOINING event, between the first and second cut
  const WCHANGED = Object.assign({}, W.StateDeriver.defaultSettings(), { maxLen: 300 });
  const WLATE = F.reducerEvent("$w-late-below", 6, 1500, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: WCHANGED });

  function wcp(n) {
    const below = WLOG.slice(0, n);
    const seed = W.StateDeriver.buildSeed(below);
    const covers = below[0].eventId + ".." + below[below.length - 1].eventId;
    const floorL = below[below.length - 1].l;
    return { n: 1, prev: null, seed, thin: false, covers, floorL,
             h: W.CheckpointFormat.fingerprint(1, null, seed, floorL, false, covers) };
  }
  // `cacheJoin` is the ONE detail G and H differ on: whether the raw copy of the broken chain's
  // joining event is still held. That single axis is what decides whether the release is sustained.
  function adoptedIgnoring(cacheJoin) {
    W.StreamManager.reset(); W.Floor.reset(); W.SettingsProof.reset();
    W.SettingsProof.attach({ now: () => Date.now(), pageSettings: null });
    const put = (e, cache) => {
      const raw = F.toRaw(e);
      if (cache !== false) { try { W.EventCache.store(raw); } catch (x) {} }
      W.StreamManager.ingest(raw);
    };
    for (const e of WLOG) put(e, cacheJoin || e.eventId !== JOIN_EV.eventId);
    W.Floor.remember(wcp(7), F.RANK.highStaff, "@a:hs", 1000);
    W.Floor.remember(wcp(11), F.RANK.highStaff, "@b:hs", 1100);
    W.Floor.remember(wcp(15), F.RANK.highStaff, "@c:hs", 1200);
    // The SDK is absent, so `getMyRank` answers 0. ONLY this field is substituted; `log`,
    // `settings` and `trimmed` stay the wiring `_wireConcepts` installed, which is the wiring
    // under test.
    W.Floor.attach({ myRank: () => F.RANK.highStaff });
    W.Floor.adopt(W.Floor.select(F.RANK.highStaff, W.StateDeriver.defaultSettings(),
      (q) => W.Floor.chainVerifies(q, W.StreamManager.getLog())));
    put(WLATE);
    return put;
  }
  const wInLog = (id) => W.StreamManager.getLog().some((e) => e.eventId === id);

  // ── PART G: sustained withdrawal, and NOTHING re-delivers ──────────────────────────────────
  {
    const put = adoptedIgnoring(false);
    ok(W.Floor.grade() === "quorum",
      "G: APPLIED — a QUORUM floor, because `revalidate` re-checks no other grade and so no other " +
      "grade can reach the withdrawal branch at all", W.Floor.grade());
    ok(W.StreamManager._trimState() === null,
      "G: APPLIED — adopted and NOT trimmed, or `_weakened` demotes to `stale` and never withdraws",
      W.StreamManager._trimState());
    ok(!wInLog("$w-late-below"), "G: APPLIED — the below-cut arrival was ignored");
    ok(!!W.EventCache.get("$w-late-below"),
      "G: APPLIED — and is still HELD, so there is something for a re-delivery to deliver");

    W.StreamManager._setLogForTest(
      W.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
    const r = W.Floor.revalidate();
    ok(r && r.reason === "withdrawn",
      "G: APPLIED — the floor must have been WITHDRAWN through `revalidate`, not cleared by hand. " +
      "The emission is the whole subject: a field set directly announces nothing and no subscriber " +
      "runs, which is precisely how the assertion this part replaces could never fail", r);
    ok(W.Floor.position() === W.Floor.NO_FLOOR,
      "G: APPLIED — and the boundary is released", W.Floor.position());

    ok(!wInLog("$w-late-below"),
      "G: THE GAP — nothing re-delivers the ignored arrival. The `withdrawn` subscriber calls " +
      "`Floor.thinJoin(_localPager())`, and MEASURED (probe-j37-redelivery Q1/Q2) that pager " +
      "returns the arrival's own bytes and `thinJoin` hands paged events to `chainVerifies` and to " +
      "nothing else — the re-page READS it and discards it. Releasing the boundary makes the " +
      "arrival admissible without making it arrive. IF THIS GOES RED, re-delivery was built: " +
      "re-decide this assertion rather than repairing it, and see J37");

    // THE ADJACENT ADMISSION. Without it the refusal above is unattributable — a fold that would
    // have rejected this event anyway refuses it for free, and absence reads exactly like a finding.
    put(WLATE);
    ok(wInLog("$w-late-below"),
      "G: CONTROL — the same arrival, delivered explicitly at this moment, DOES fold. So the line " +
      "above is 'nothing delivered it', not 'it could not have been folded'");
  }

  // ── PART H: the release IS sustained, because local evidence cannot take back a refusal ─────
  // DECIDED AT v321, AND THIS PART WAS INVERTED RATHER THAN DELETED. It used to RECORD the opposite
  // and say so: `_localPager` reads the RAW CACHE, normally a superset of the derived log, so when a
  // chain broke in the log while the cache still held the joining event, the re-page re-verified the
  // very floor that had just stopped verifying and RE-ADOPTED it within one microtask. The note
  // predicted its own end — *"if this goes red the re-page stopped re-adopting, which changes J37's
  // shape and is a decision, not a repair"* — and that is what happened.
  //
  // THE DECISION (J43): a client never holds a truth the room cannot hold. Being behind is ordinary;
  // computing from a base the room rejected is a fork. So local evidence may make a client more
  // cautious and never more permissive, and a floor refused by the derived log is re-adoptable only
  // once something has actually been LEARNED — `Floor.thinJoin` requires the pager to report a
  // genuine fetch. `check-no-local-readopt` drives that rule directly, both ways.
  //
  // WHAT THIS PART NOW PINS is the consequence J37 depends on: the withdrawal HOLDS, so a client
  // that released a boundary is really folding what it holds, and a re-delivery landing afterwards
  // is not ignored by a boundary that quietly came back. PART G is still the control — there the
  // cache does not hold the joining event, and the release is sustained for a different reason.
  {
    adoptedIgnoring(true);
    ok(!!W.EventCache.get(JOIN_EV.eventId),
      "H: APPLIED — the joining event is still in the RAW CACHE. That single detail is all this " +
      "part varies against PART G, so the two are each other's control");
    W.StreamManager._setLogForTest(
      W.StreamManager.getLog().filter((e) => e.eventId !== JOIN_EV.eventId));
    const r = W.Floor.revalidate();
    ok(r && r.reason === "withdrawn", "H: APPLIED — the floor was withdrawn", r);

    // The subscriber is fire-and-forget and `thinJoin` is async, so any re-adoption would land on a
    // later microtask. Reading synchronously here would report a release that no longer exists a
    // tick later — the wrong-moment error this project pays for most often. So the assertion still
    // waits, and now checks that nothing came back.
    Promise.resolve().then(() => {}).then(() => {
      ok(W.Floor.position() !== wcp(7).floorL || W.Floor.grade() !== "quorum",
        "H: the `withdrawn` re-page RE-ADOPTED the same floor from the raw cache. Nothing was " +
        "learned between the refusal and the re-adoption — the client asked a looser question of " +
        "evidence it already held. Local evidence may make a client more cautious and never more " +
        "permissive (J43, decided at v321; `check-no-local-readopt` holds the rule)",
        { at: W.Floor.position(), grade: W.Floor.grade() });

      // ── PART I: a sustained release that leaves an arrival unfolded SAYS SO (J44) ───────────
      // The divergence itself was ruled ACCEPTABLE by J37, which drove all three repairs and
      // refused each: re-delivery would source the fold from `EventCache` — forbidden, because the
      // cache's cap must never change what a client derives — and holding the floor as `stale`
      // recovers nothing while stranding the client on a chain that no longer verifies. So this
      // part is about the SILENCE, which was the half J37 did not rule acceptable.
      //
      // NOTICE IS NOT REACT. The record gates nothing and triggers nothing, exactly like
      // `pairingFault` beside it. What it buys is that a client computing a room no peer computes
      // can be ASKED about it, instead of the difference being invisible from both ends.
      //
      // THE DISTINCTION THAT IS THE WHOLE JOB: `null` means the question never arose, and a count
      // of zero means a boundary was active and refused nothing. A counter starting at zero reads
      // as "never happened" when it means "nobody looked" — which is the shape `README.md` lists
      // among the properties worth knowing, and the reason this is not simply an integer.
      {
        const rec = W.StreamManager.ignoredArrivals();
        ok(rec && typeof rec === "object",
          "I: a sustained release left an arrival held-but-unfolded and the client recorded " +
          "NOTHING. The divergence is accepted; the silence is not — nothing detects this from " +
          "either end, because the arrival is on a type `Continuity` never chains.",
          "ignoredArrivals() returned " + JSON.stringify(rec));

        ok(rec && rec.count >= 1 && Array.isArray(rec.ids) && rec.ids.indexOf("$w-late-below") >= 0,
          "I: the record does not name the arrival it is about. A count with no identity cannot be " +
          "acted on by a person and cannot be checked by anything else.",
          JSON.stringify(rec));

        ok(rec && typeof rec.at === "number",
          "I: the record does not say WHICH boundary refused. Without it the record is a running " +
          "total for the life of the room rather than a fact about one situation.",
          JSON.stringify(rec));
      }

      // ── AND "NONE" MUST NOT READ LIKE "NOT ASKED" ──────────────────────────────────────────
      // The trap, driven rather than described. A fresh client has refused nothing AND been asked
      // nothing; those must not produce the same answer, or the record reads as an all-clear in
      // exactly the case where nobody has looked.
      {
        W.StreamManager.reset();
        ok(W.StreamManager.ignoredArrivals() === null,
          "I: after a reset the record is not `null`. A room change must clear it — a count " +
          "carried into the next room describes a boundary that no longer exists — and the empty " +
          "state must be DISTINGUISHABLE from a boundary that refused nothing.",
          JSON.stringify(W.StreamManager.ignoredArrivals()));

        // AND THE TWO STATES MUST BE TELLABLE APART, which is the whole point of `null`. A client
        // that HAS refused something reports a count; the reset client above reports `null`. If
        // both answered the same, the record would read as an all-clear in exactly the case where
        // nobody had looked. (`adoptedIgnoring` deliberately refuses an arrival — that IS its
        // setup — so the contrast here is against the reset state, not against a second fixture.)
        adoptedIgnoring(false);
        const active = W.StreamManager.ignoredArrivals();
        ok(active && active.count >= 1,
          "I: a boundary that DID refuse an arrival reports nothing, so `null` and a real refusal " +
          "are indistinguishable and the record cannot be read as evidence either way.",
          JSON.stringify(active));
      }

      console.log("[accepted-boundary] PASS — " + SUMMARY);
    });
  }
}
