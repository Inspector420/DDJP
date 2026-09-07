// tests/check-origin-fold.js
//
// J46 — AN IMPORTED SEED REACHES DERIVED STATE. What this guard locks is the rule that replaced
// the one `_deriveBest` used to apply: **the fold starts from the room's ORIGIN**, which is
// normally empty and, when the floor declares one, that floor's seed.
//
//   A  THE MARKER — `prev === null && thin === true` fires on an import and on NO honest shape,
//      with both fields varied, and it survives adoption into the object that has to read it
//   B  THE FOLD — a created-from-file room derives what the file says, folded forward over what
//      sits above the cut, driven through `StreamManager.ingest` and `Floor`
//   C  THE LATCH — a later, ordinary checkpoint over an origin does NOT send the room back to
//      the genesis fold
//   D  THE INVARIANT — no floor ⟹ not trimmed, on both routes that uphold it, plus the
//      consequence that makes it load-bearing
//   E  THE FALSE-POSITIVE DIRECTION — an ordinary room is unaffected in every respect measured
//
// ── WHY PART D IS IN THIS FILE AND NOT FILED FOR LATER ───────────────────────────────────────
// The marker's soundness is not a property of the marker. An honest sealer writes `prev = null`
// only when it holds no floor and `thin = true` only when it has trimmed, so the pair is
// unreachable honestly exactly while no client can be trimmed and floorless at once. Nothing
// stated that and nothing checked it: it was upheld by `Floor._weakened`'s branch and by the
// pairing of two `reset()` calls in two modules, neither of which was decided for this reason.
// The failure direction is asymmetric — a missed import costs nothing, a false positive makes a
// client DISCARD A ROOM'S REAL HISTORY — so a change that starts reading the pair without
// guarding the invariant is a change that has moved the risk somewhere nobody is looking.
//
// EVERYTHING IS DRIVEN THROUGH THE PRODUCTION PATH. Checkpoints are built by `Checkpoint.seal()`
// and `Checkpoint.buildImport` through an attached env, floors arrive through `Floor.remember` /
// `select` / `adopt`, and state is read after `StreamManager.ingest` — never by handing a log to
// the reducer. That distinction is the whole reason J46 existed: `check-import` PART D asks the
// reducer directly and was green throughout.

const assert = require("assert");
const { loadInContext } = require("./_load.js");
const F = require("./_fixtures.js");

let checks = 0;
// PART D's consequence is async (`Checkpoint.seal` is), so it is assigned here and awaited at the
// end — after every synchronous part, and BEFORE the PASS line, so the announcement can never
// describe assertions that have not run.
let CONSEQUENCE = null;
function ok(c, m, extra) {
  assert.ok(c, m + (extra ? "  " + JSON.stringify(extra) : ""));
  checks++;
}

const BACKEND = "backends/backend1/";
function fresh() {
  return loadInContext([
    "core/logger.js",
    BACKEND + "ranks.js",
    BACKEND + "consensushash.js",
    BACKEND + "trustpolicy.js",
    BACKEND + "statederiver.js",
    BACKEND + "checkpointformat.js",
    BACKEND + "dials.js",
    BACKEND + "session.js",
    BACKEND + "scheduler.js",
    BACKEND + "floor.js",
    BACKEND + "eventcache.js",
    BACKEND + "streammanager.js",
    BACKEND + "vouch.js",
    BACKEND + "checkpoint.js",
    BACKEND + "settingsproof.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

// THE PREDICATE UNDER TEST, WRITTEN ONCE HERE. It is the same reading `_deriveBest` performs; if
// the two ever disagree PART B goes red, because PART B never consults this — it reads the room.
const PAIR = (x) => !!(x && (x.prev === null || x.prev === undefined) && x.thin === true);

function sealedCp(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: thin === true, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// A client wired the way transport wires one, so `seal()` reaches the real gates and `thin` is
// read from the same place production reads it.
function client(sb, opts) {
  const o = opts || {};
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => !!(o.trimmed && o.trimmed()) });
  sb.Checkpoint.attach({
    send: async () => {}, myUserId: () => o.me || "@owner:hs",
    log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    amOwner: () => true, held: () => [], isLegal: () => true,
    now: () => (o.now ? o.now() : Date.now()),
    thin: () => !!(o.trimmed && o.trimmed()),
    floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
    floorTs: () => sb.Floor.anchorTs(),
  });
}

// The EXPORTING room — a real fold at a real cut, which is where a save file comes from.
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2];
  const cpA = sealedCp(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  return { log: log, cpA: cpA, dj: r.dj, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots: snapshots, keyset: keys, author: { rank: rank },
  })));
}

// A created-from-file room, driven the way `features/room.js` createFromFile drives it: read the
// file, post this build's defaults, post the file's blob over them, build and adopt the checkpoint.
function createdFromFile(sb, file) {
  sb.Session._setPhaseForTest("live");
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@importer:hs" });
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner,
                    trimmed: () => sb.StreamManager._trimState() !== null });
  const read = sb.StreamManager.importFile(file);
  if (!read.ok) throw new Error("the file did not read: " + read.reason);
  sb.StreamManager.ingest(F.rawEvent("$gen-defaults", 1, 1000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }));
  sb.StreamManager.ingest(F.rawEvent("$gen-imported", 2, 1100, "@importer:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: read.settings }));
  const anchor = { settingsFrom: "$gen-imported", eventId: "$gen-imported", l: 2 };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  if (!built.ok) throw new Error("buildImport refused: " + built.reason);
  sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 1200);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted = sel ? sb.Floor.adopt(sel, false) : false;
  sb.StreamManager.ingest(F.rawEvent("$after", 3, 2000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.dj.join", v: "SONGX" }));
  return { read: read, built: built, adopted: adopted };
}

// An ordinary room sealing from its OWN log and adopting it. The control for PART E.
function ordinaryRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner,
                    trimmed: () => sb.StreamManager._trimState() !== null });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = sealedCp(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
    cut.l, log[0].eventId + ".." + cut.eventId);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  // The validation runs inside `_deriveBest`, which only runs on the ingest path — so a floor
  // adopted after the last event leaves the verdict at `no-checkpoint` and nothing to read.
  sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "SONGQ" }));
  return { log: log, cp: cp };
}

// ── PART A — THE MARKER ─────────────────────────────────────────────────────────────────────
// The pair is a conjunction, so BOTH fields have to be varied. Holding one fixed while asserting
// about a rule the pair decides is the "control that varies the wrong axis" failure: an assertion
// pair that looks like a control is read as one, and the question dies there.
//
// ── AND IT IS READ OUT OF THE ROOM, NOT OUT OF A COPY OF THE PREDICATE ──────────────────────
// The first version of this part applied a `PAIR()` helper written HERE to four checkpoint
// objects, and asserted on its answers. Every assertion passed, and mutation M1/M2/M3 proved the
// whole part decorative: breaking `_isOriginFloor` in `streammanager.js` left it green, because
// it was never asking `streammanager.js` anything. It tested this file's reimplementation of the
// rule against this file's understanding of it — a guard on a copy, which is the module/wiring
// failure (P1) reached from inside a guard rather than from outside one.
//
// So each shape is now ADOPTED AS A FLOOR in its own client and the room is asked
// `_originState()`, which is the production reading. The four shapes are built the way the tree
// builds them, and the import through `Checkpoint.buildImport`.
{
  // Every client here holds a full genesis log and has NOT trimmed, so `_originState()` is the
  // only thing that can put it on the seeded path — which is what makes the reading attributable.
  function declaresOrigin(makeCp) {
    const sb = fresh();
    const r = F.playingRoom({ songs: 3 });
    const log = F.sortLog(r.log);
    sb.Session._setPhaseForTest("live");
    sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                      myRank: () => F.RANK.owner,
                      trimmed: () => sb.StreamManager._trimState() !== null });
    sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
    for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
    const cp = makeCp(sb, log);
    sb.Floor.remember(cp, F.RANK.owner, "@peer:hs", 5000);
    const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
    const adopted = sel ? sb.Floor.adopt(sel, false) : false;
    sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
      { t: "ddjp.dj.declare", v: "SONGQ" }));
    return { adopted: adopted, declared: sb.StreamManager._originState(),
             trimmed: sb.StreamManager._trimState(), floor: sb.Floor.current(), sb: sb };
  }

  const seedOf = (sb, log) => sb.StateDeriver.buildSeed(log.slice(0, 3), null);

  // Shape 1 — an ordinary room's FIRST seal, no floor held: n=1, prev=null, thin=false. THE
  // shape that decides this, because `n = floor ? floor.n + 1 : _seq` and `prev = floor ? floor.h
  // : null` make it n=1 AND prev=null, which is exactly what `n === 1 && prev === null` fires on.
  const first = declaresOrigin((sb, log) =>
    sealedCp(sb, seedOf(sb, log), 1, null, log[2].l, log[0].eventId + ".." + log[2].eventId, false));
  // Shape 2 — an ordinary seal made WITH a floor held: n=2, prev=<h>, thin=false.
  const withFloor = declaresOrigin((sb, log) =>
    sealedCp(sb, seedOf(sb, log), 2, "$someh", log[2].l,
      log[0].eventId + ".." + log[2].eventId, false));
  // Shape 3 — a THIN peer's own seal: n=2, prev=<h>, thin=TRUE. The only honest shape carrying
  // thin, and the one that decides whether `thin` alone could ever have been the discriminator.
  // Adopted by a client that has NOT trimmed, which is the case that makes a false positive here
  // discard real history rather than merely mislabel a room.
  const thinSeal = declaresOrigin((sb, log) =>
    sealedCp(sb, seedOf(sb, log), 2, "$someh", log[2].l,
      log[0].eventId + ".." + log[2].eventId, true));

  ok(first.adopted && withFloor.adopted && thinSeal.adopted,
    "A: CONTROL — all three honest shapes were actually ADOPTED as floors. Without this the "
    + "readings below are absence: a floor that never arrived declares no origin for the trivial "
    + "reason, and absence reads exactly like a finding",
    { first: first.adopted, withFloor: withFloor.adopted, thin: thinSeal.adopted });
  ok(first.trimmed === null && withFloor.trimmed === null && thinSeal.trimmed === null,
    "A: CONTROL — and none of them has trimmed, so `_originState()` is the ONLY thing that could "
    + "put these clients on the seeded path. Otherwise a reading of `true` would be attributable "
    + "to the trim instead of to the marker");

  ok(first.declared === false,
    "A: an ordinary room's FIRST seal declares NO origin — same n, same prev as an import, "
    + "thin=false. This is the shape that refuted `n === 1 && prev === null`, and a predicate "
    + "firing here makes a client discard its own room's history on the strength of its own "
    + "genesis checkpoint");
  ok(thinSeal.declared === false,
    "A: a THIN peer's own seal declares NO origin either — thin=true, but `prev` names the floor "
    + "it computed from. That is the OTHER axis, and it is the case where a false positive costs "
    + "an untrimmed client the real history it is still holding");
  ok(withFloor.declared === false,
    "A: nor does an ordinary seal made with a floor held (neither field matches)");

  // Shape 4 — the IMPORT, through the production builder, adopted the way createFromFile adopts.
  const sb = fresh();
  const X = exportedRoom(sb);
  const imp = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
  ok(imp.adopted === true, "A: CONTROL — the imported checkpoint is adopted as the floor");
  ok(sb.StreamManager._originState() === true,
    "A: and an IMPORT declares an origin — `buildImport` writes prev=null and thin=true together, "
    + "and it is the conjunction that says so. Read from the room rather than from a copy of the "
    + "predicate, which is what mutation found this part doing",
    { prev: imp.built.cp.prev, thin: imp.built.cp.thin });
  ok(sb.StreamManager._trimState() === null,
    "A: CONTROL — and it declared that WITHOUT having trimmed, which is the whole point: before "
    + "J46 the seeded path was reachable only by trimming, and an import can never earn the right");

  // AND THE MARKER HAS TO SURVIVE ADOPTION, which is where it used not to. `_deriveBest` reads
  // `Floor.current()`, and `adopt()` rebuilt that object field by field WITHOUT `thin` — so the
  // checkpoint carried the pair, the floor carried half of it, and the predicate could never
  // fire. Measured, `probe-j46-fold` R30. Half a pair is not a pair.
  const held = sb.Floor.current();
  ok(held && held.thin === true && (held.prev === null || held.prev === undefined),
    "A: the pair SURVIVES ADOPTION into `Floor.current()`, which is the object `_deriveBest` "
    + "reads. `prev` was always carried; `thin` was dropped, so the marker existed on the wire "
    + "and not where it had to be read",
    { prev: held && held.prev, thin: held && held.thin, fields: held && Object.keys(held) });
  ok(withFloor.floor && withFloor.floor.thin === false,
    "A: CONTROL — an ordinary room's adopted floor carries `thin` as well, and carries it FALSE. "
    + "So the field is passed through rather than asserted, and the survival assertion above "
    + "cannot be satisfied by a constant",
    { thin: withFloor.floor && withFloor.floor.thin });
  ok(thinSeal.floor && thinSeal.floor.thin === true,
    "A: CONTROL — and a thin peer's floor carries it TRUE, so `thin` really does travel with the "
    + "checkpoint. Together with the row above, the field is proven to vary rather than to exist");
}

// ── PART B — THE FOLD ───────────────────────────────────────────────────────────────────────
// The job's own Done-when: a client in a room seeded from a file derives what the file says,
// folded forward over everything above the cut.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));

  ok(room.adopted === true,
    "B: PRECONDITION — the checkpoint is adopted, so what follows is not a floor that failed to "
    + "arrive");

  const liveState = sb.StreamManager.getState();
  const cutL = room.built.cp.floorL;
  const bid = String(room.built.cp.covers).split("..")[1];
  const above = sb.Floor.afterBoundary(sb.StreamManager.getLog(), cutL, bid);
  const correct = sb.StateDeriver.derive(above, room.built.cp.seed);

  ok(above.length >= 1,
    "B: CONTROL — there IS at least one event above the cut, so the reference is a FOLD rather "
    + "than the seed restated. A reference with nothing above the cut would be satisfied by a "
    + "client that applied the seed and then ignored everything after it", above.length);
  ok(correct.rotation.some((m) => m.user === X.dj),
    "B: CONTROL — and the reference really carries the FILE's dj, so what follows is a statement "
    + "about the room rather than about an empty file",
    correct.rotation.map((m) => m.user));
  ok(correct.rotation.some((m) => m.user === "@importer:hs"),
    "B: CONTROL — and it carries the event above the cut too, so the two halves of "
    + "seed-plus-subsequent-events are both represented in the reference");

  ok(JSON.stringify(liveState.rotation) === JSON.stringify(correct.rotation),
    "B: a created-from-file room DERIVES WHAT THE FILE SAYS, folded forward over what sits above "
    + "the cut — read from the room after ingest, not from the reducer. This is J46's Done-when, "
    + "and the behaviour it replaces returned the genesis fold of a log that begins two settings "
    + "events before the import",
    { live: liveState.rotation.map((m) => m.user), correct: correct.rotation.map((m) => m.user) });
  ok(liveState.nowPlaying !== null
    && JSON.stringify(liveState.nowPlaying) === JSON.stringify(correct.nowPlaying),
    "B: including now-playing — the file records a song playing and the room plays it");

  ok(sb.StreamManager._originState() === true,
    "B: and the room knows WHY it folded that way — the origin is declared rather than inferred "
    + "from the seed failing to reproduce a genesis, which would have turned every genuine "
    + "mismatch into a licence");

  // AND THE TWO QUESTIONS NOW AGREE, WHICH IS THE CLOSURE OF THE P1 GAP ITSELF. `check-import`
  // PART D compares the SEED round-tripping through the reducer; this compares what a CLIENT
  // derives. They had different answers, which is exactly how a green guard sat on top of a room
  // that derived nothing — a guard on the module is not a guard on the wiring. Asserting they
  // agree pins the closure at the seam where they diverged, rather than only asserting the
  // client's half.
  const asReducer = sb.ConsensusHash.contentHash({ rotation: correct.rotation,
    nowPlaying: correct.nowPlaying, counts: correct.counts, history: correct.history });
  const asClient = sb.ConsensusHash.contentHash({ rotation: liveState.rotation,
    nowPlaying: liveState.nowPlaying, counts: liveState.counts, history: liveState.history });
  ok(asReducer === asClient,
    "B: what the REDUCER derives from the seed and what the CLIENT derives are now the same "
    + "answer. Before J46 they differed, and that difference is why `check-import` PART D was "
    + "green for two releases over a room that derived none of its file");

  // THE PRE-FORGET VERDICT, RE-MEASURED. It was `mismatched / diverges-from-genesis` and
  // conclusive; the fix removes the thing it was measuring. The reason is asserted, not just the
  // status, because `validated` reached by a comparison and `validated` reached because there is
  // nothing to compare are different claims and only one of them was checked by anybody.
  const v = sb.StreamManager.seedValidation();
  ok(v.status === "validated" && v.reason === "origin-seed",
    "B: the pre-forget verdict is now `validated / origin-seed` — and the REASON is the assertion, "
    + "because in an origin room the seeded fold and the base fold are the same computation over "
    + "the same events (probe-j46-fold R34). Recording a bare `validated` there would be a verdict "
    + "naming a comparison that did not happen, which is P10", v);

  // THE TRIM IS ATTEMPTED, NOT MERELY OBSERVED NOT TO HAVE HAPPENED — and what it must not do is
  // change the room. Forgetting below an origin cut is a memory saving: the fold already starts
  // above that cut, so the events being dropped contribute nothing.
  sb.SettingsProof._setVerdictForTest({ status: "validated" });
  const beforeTrim = JSON.stringify(sb.StreamManager.getState());
  const dropped = sb.StreamManager.trimToFloor();
  ok(dropped > 0,
    "B: CONTROL — the trim actually ran and dropped something, so the assertion below is about a "
    + "client that forgot rather than one that was never asked to", { dropped });
  ok(JSON.stringify(sb.StreamManager.getState()) === beforeTrim,
    "B: and derived state is BYTE-IDENTICAL across it — which is the licence's real ground in an "
    + "origin room: the fold already starts above the cut, so dropping what is below it moves "
    + "nothing. That is a narrower and stronger claim than the comparison the ordinary path makes");
}

// ── PART C — THE LATCH ──────────────────────────────────────────────────────────────────────
// The origin is a fact about the ROOM; the floor is a moving mark within it. The moment the owner
// seals over an imported floor, the new floor is an ORDINARY checkpoint — `prev` names the origin
// and `thin` is false, correctly — so a rule that re-read the current floor every time would fall
// back to the genesis fold and empty the room on its second checkpoint. Later, and harder to see.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
  const beforeRot = sb.StreamManager.getState().rotation.map((m) => m.user);
  ok(beforeRot.indexOf(X.dj) >= 0,
    "C: PRECONDITION — the room derives the file's dj before the second checkpoint", beforeRot);

  for (let i = 0; i < 4; i++) {
    sb.StreamManager.ingest(F.rawEvent("$post" + i, 60 + i, 950000 + i * 1000, "@importer:hs",
      F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGP" + i }));
  }
  const logNow = sb.StreamManager.getLog();
  const cut = logNow[logNow.length - 1];
  const seg = logNow.filter((e) => e.l > room.built.cp.floorL && e.l <= cut.l);
  const next = sealedCp(sb, sb.StateDeriver.buildSeed(seg, room.built.cp.seed), 2,
    room.built.cp.h, cut.l, seg[0].eventId + ".." + cut.eventId, false);

  ok(PAIR(next) === false,
    "C: CONTROL — the room's OWN second checkpoint does not carry the marker. prev names the "
    + "origin and thin is false, which is exactly right and is why re-reading the current floor "
    + "would lose the origin here", { prev: next.prev === null ? null : "<h>", thin: next.thin });

  sb.Floor.remember(next, F.RANK.owner, "@importer:hs", 960000);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  ok(sel && sb.Floor.adopt(sel, false) === true, "C: CONTROL — and it is adopted over the origin");
  sb.StreamManager.ingest(F.rawEvent("$tick", 70, 970000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.dj.declare", v: "SONGT" }));

  const afterRot = sb.StreamManager.getState().rotation.map((m) => m.user);
  ok(afterRot.indexOf(X.dj) >= 0,
    "C: THE LATCH — the room still derives the file's state after adopting an ordinary checkpoint "
    + "over the origin. Without the latch this is where an imported room would quietly empty, one "
    + "cadence after the import appeared to work", { before: beforeRot, after: afterRot });
  ok(sb.StreamManager._originState() === true,
    "C: and the origin is still declared, because it describes the room rather than the floor");

}

// ── PART D — THE INVARIANT: NO FLOOR ⟹ NOT TRIMMED ──────────────────────────────────────────
// The marker is sound only while this holds. It is upheld in two places, by two decisions made
// for unrelated reasons, and it was written down nowhere and checked by nothing.
{
  // ROUTE 1 — the weakening. `_weakened` splits on exactly this question.
  function weaken(isTrimmed) {
    const sb = fresh();
    const r = F.playingRoom({ songs: 4 });
    const log = F.sortLog(r.log);
    sb.Floor.attach({ log: () => log, settings: () => ({}), myRank: () => F.RANK.staff,
                      trimmed: () => isTrimmed });
    const cut = log[2], cut2 = log[5];
    const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
    const cpA = sealedCp(sb, seed, 1, null, cut.l, log[0].eventId + ".." + cut.eventId, false);
    const cpB = sealedCp(sb, sb.StateDeriver.buildSeed(log.slice(3, 6), seed), 2, cpA.h,
      cut2.l, log[3].eventId + ".." + cut2.eventId, false);
    for (const who of ["@s1:hs", "@s2:hs", "@s3:hs", "@s4:hs"]) {
      sb.Floor.remember(cpA, F.RANK.staff, who, 5000);
      sb.Floor.remember(cpB, F.RANK.staff, who, 6000);
    }
    const sel = sb.Floor.select(F.RANK.staff, {}, (q) => sb.Floor.chainVerifies(q, log));
    const adopted = sel ? sb.Floor.adopt(sel, false) : false;
    const gradeBefore = sb.Floor.grade();
    // The joining evidence removed, so the chain GENUINELY stops verifying rather than being
    // told to fail — a refusal manufactured by the fixture would prove nothing about `_weakened`.
    sb.Floor.attach({ log: () => [], settings: () => ({}), myRank: () => F.RANK.staff,
                      trimmed: () => isTrimmed });
    const rev = sb.Floor.revalidate();
    return { adopted: adopted, gradeBefore: gradeBefore, rev: rev,
             holds: sb.Floor.current() !== null, grade: sb.Floor.grade() };
  }
  const un = weaken(false), tr = weaken(true);

  ok(un.adopted === true && tr.adopted === true && un.gradeBefore === "quorum"
    && tr.gradeBefore === "quorum",
    "D: CONTROL — both trees adopted a QUORUM floor. `revalidate` returns early on any other "
    + "grade, so without this the rows below would measure a function that never ran",
    { untrimmed: un.gradeBefore, trimmed: tr.gradeBefore });
  ok(un.rev.reason !== "still-holds" && tr.rev.reason !== "still-holds",
    "D: CONTROL — and `revalidate` reached `_weakened` in both, rather than finding the floor "
    + "still verifying", { untrimmed: un.rev.reason, trimmed: tr.rev.reason });

  ok(un.holds === false,
    "D: an UNTRIMMED client that loses its floor WITHDRAWS it — correct, because it can still "
    + "fall back on folding what it holds", un.rev);
  ok(tr.holds === true && tr.grade === "stale",
    "D: and a TRIMMED one is DEMOTED to `stale` and KEEPS its floor — which is the invariant. "
    + "Withdrawing here would leave a client that has already forgotten with no state at all, and "
    + "that is why the branch exists; that it also makes the origin marker sound is a consequence "
    + "nobody chose", tr.rev);

  // ROUTE 2 — the room change. `thin` must not outlive the room it describes.
  const sb = fresh();
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  client(sb, { trimmed: () => sb.StreamManager._trimState() !== null });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = sealedCp(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
    cut.l, log[0].eventId + ".." + cut.eventId, false);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "SONGQ" }));
  sb.SettingsProof._setVerdictForTest({ status: "validated" });
  const dropped = sb.StreamManager.trimToFloor();
  ok(dropped > 0 && sb.StreamManager._trimState() !== null,
    "D: CONTROL — the client really trimmed in room A, so `thin` is genuinely true and there is "
    + "something for the room change to have to clear", { dropped });

  sb.StreamManager.reset();
  sb.Floor.reset();
  ok(sb.StreamManager._trimState() === null && sb.Floor.current() === null,
    "D: the room change clears BOTH — the boundary and the floor, in the same wiring step. That "
    + "is what stops `thin=true` being read in a room where no floor is held, and it is a WIRING "
    + "fact rather than a property of either module, which is precisely why it needs a guard");
  // ── AND THE ORIGIN IS CLEARED WITH THEM — IN A ROOM THAT HAD ONE ────────────────────────
  // The first version asserted this on the client above, which is an ORDINARY room that trimmed:
  // it never declared an origin, so "the origin is cleared" was true for the trivial reason that
  // there was never one to clear. Mutation M11 deleted the clearing line and the assertion stayed
  // green. A fixture that does not reach the path reports absence, and absence reads exactly like
  // a finding — so the room change is driven from an IMPORTED room instead.
  const orig = fresh();
  const XO = exportedRoom(orig);
  createdFromFile(orig, fileOf(orig, [XO.cpA], "owner", XO.keys));
  ok(orig.StreamManager._originState() === true,
    "D: CONTROL — this client really did declare an origin, so there is something for the room "
    + "change to have to clear");
  orig.StreamManager.reset();
  orig.Floor.reset();
  ok(orig.StreamManager._originState() === false,
    "D: and the room change clears the ORIGIN too, so a new room cannot inherit the last one's "
    + "seed — the same rule as the boundary, added by the same change that started reading it. "
    + "Carrying it would make the next room fold from a seed belonging to the room just left, "
    + "which is not merely wrong but wrong in the shape that looks like a working room");
  ok(orig.Floor.current() === null,
    "D: CONTROL — with the floor cleared in the same step, so the pair cannot be reassembled "
    + "from a stale latch and a fresh floor");

  // ── WHAT MAKES THE INVARIANT LOAD-BEARING RATHER THAN INCIDENTAL ─────────────────────────
  // An assertion that a state is unreachable proves nothing about why it matters. The block below
  // constructs the forbidden state directly and shows an HONEST `seal()` publishing the origin
  // declaration from it — so the cost of the invariant breaking is measured in the guard rather
  // than described in prose.
  //
  // IT IS AWAITED, AND THE FIRST VERSION OF IT WAS NOT. `Checkpoint.seal()` is async; the first
  // draft fired it with a `.then(() => {}, () => {})` and asserted nothing about what came back,
  // so the block set up the whole fixture and measured none of it — a part that RUNS and checks
  // nothing, which is the shape `run-all`'s announce rule sits one level above. Same async-shape
  // defect the previous session's probe gate had, in a different costume.
  CONSEQUENCE = async () => {
    const bad = fresh();
    let sent = null;
    bad.Session._setPhaseForTest("live");
    bad.Floor.attach({ log: () => bad.StreamManager.getLog(), settings: () => ({}),
                       myRank: () => F.RANK.owner, trimmed: () => true });
    bad.Checkpoint.attach({
      send: async (t, c) => { sent = c; }, myUserId: () => "@owner:hs",
      log: () => bad.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
      amOwner: () => true, held: () => [], isLegal: () => true, now: () => 9e6,
      thin: () => true,                       // "I have trimmed"
      floorPos: () => null, floorTs: () => null,   // "...and I hold no floor" — the forbidden state
    });
    for (const e of F.sortLog(F.playingRoom({ songs: 3 }).log)) bad.StreamManager.ingest(F.toRaw(e));
    ok(bad.Floor.current() === null,
      "D: CONTROL — the forbidden state is really constructed: this client holds NO floor while "
      + "reporting that it has trimmed");
    const res = await bad.Checkpoint.seal(9e6, { mode: "owner" });
    ok(res && res.ok === true && sent !== null,
      "D: CONTROL — and the seal was ACCEPTED rather than refused, so what it committed is "
      + "readable. A refusal here would leave the consequence unmeasured while looking like "
      + "safety", { ok: res && res.ok, reason: res && res.reason });
    ok(PAIR(sent) === true,
      "D: THE CONSEQUENCE — an HONEST seal from that state publishes the origin declaration "
      + "itself (prev=null, thin=true). So the pair is unreachable only because the invariant "
      + "holds, and a client reading this checkpoint would discard the room's real history. That "
      + "is why the invariant had to be stated and guarded by the same change that started "
      + "reading the pair, rather than filed as follow-up work",
      { n: sent.n, prev: sent.prev, thin: sent.thin });
  };
}

// ── PART D2 — A DECLARED ORIGIN WITH NO FLOOR REFUSES RATHER THAN FABRICATING ───────────────
// The branch that answers this exists because "cannot happen" is the claim this codebase keeps
// paying for. It is unreachable through the weakening route today — an origin floor is
// owner-graded, so `revalidate` returns `not-a-quorum-floor` before `_weakened` can withdraw it —
// but a branch nothing drives is a branch nobody has checked, and mutation M13 confirmed that
// replacing it with a genesis fold left every guard green.
//
// The point is WHICH wrong answer it gives. Falling through to the genesis fold would describe a
// room that never had a history — a fabrication that reaches the UI as a plausible story. An
// honest refusal keeps the last state that did pair, and says so.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
  const good = sb.StreamManager.getState();
  ok(sb.StreamManager._originState() === true && good.rotation.some((m) => m.user === X.dj),
    "D2: PRECONDITION — an origin room deriving the file's state, so there is a good fold to lose",
    good.rotation.map((m) => m.user));

  // The floor taken away beneath a latched origin. Through Floor's own seam, which is the state
  // production reads, rather than by reaching into StreamManager.
  sb.Floor._setTrustedForTest(null);
  ok(sb.Floor.current() === null, "D2: CONTROL — the client now holds no floor at all");
  sb.StreamManager.ingest(F.rawEvent("$orphan", 9, 990000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.dj.declare", v: "SONGZ" }));

  const fault = sb.StreamManager.pairingFault();
  ok(fault && fault.reason === "origin-without-floor",
    "D2: the fold REFUSES and records why, distinguishably from the seed-below-boundary case the "
    + "same answer serves. Two ways to be unpaired, one answer, and the reason tells them apart "
    + "in the log without becoming a second mechanism", fault);
  const after = sb.StreamManager.getState();
  ok(JSON.stringify(after.rotation) === JSON.stringify(good.rotation),
    "D2: and it holds the last fold that DID pair rather than folding from empty. An honestly "
    + "stale room and a fabricated one are not the same kind of wrong, and only the second can "
    + "reach a person as a plausible story",
    { held: after.rotation.map((m) => m.user), good: good.rotation.map((m) => m.user) });
}

// ── PART E — THE FALSE-POSITIVE DIRECTION ───────────────────────────────────────────────────
// The failure directions are asymmetric: a missed import costs nothing and a false positive makes
// a client discard real history. So an ordinary room has to be measured as unchanged in every
// respect this change could have touched, not merely asserted to be uninvolved.
{
  const sb = fresh();
  const room = ordinaryRoom(sb);

  ok(sb.StreamManager._originState() === false,
    "E: an ordinary room declares NO origin, so the marker did not fire on a room that has one of "
    + "its own");
  ok(sb.StreamManager._trimState() === null,
    "E: CONTROL — and it has not trimmed either, so the fold below is on the genesis path for "
    + "both of the reasons that path exists");

  const v = sb.StreamManager.seedValidation();
  ok(v.status === "validated" && v.reason === null,
    "E: its pre-forget verdict is reached BY COMPARISON — `validated` with no reason, which is "
    + "the ordinary path. If the origin branch ever swallowed this room the reason would read "
    + "`origin-seed`, so the two are distinguishable rather than both merely green", v);

  // The room's live state must be the GENESIS fold — the full log, not the seed. This is the
  // property whose loss J46's change could most easily cause and least easily be noticed for.
  const genesis = sb.StateDeriver.derive(sb.StreamManager.getLog());
  const live = sb.StreamManager.getState();
  ok(JSON.stringify(live.rotation) === JSON.stringify(genesis.rotation)
    && JSON.stringify(live.nowPlaying) === JSON.stringify(genesis.nowPlaying),
    "E: and live state is the GENESIS fold of everything it holds — the seed summarises a log "
    + "this client still has, so genesis is the fuller truth and re-folding over the seed would "
    + "double-count. That reasoning is unchanged; what changed is only which rooms it applies to",
    { live: live.rotation.map((m) => m.user), genesis: genesis.rotation.map((m) => m.user) });

  // A CONTROL THAT THE REFERENCE COULD DIFFER. Without something below the cut, the genesis fold
  // and a seeded fold would agree trivially and the assertion above would hold for the wrong
  // reason — the decorative-assertion family, reached through the fixture.
  const cutL = room.cp.floorL;
  const below = sb.StreamManager.getLog().filter((e) => e.l <= cutL);
  ok(below.length >= 2,
    "E: CONTROL — there are events at or below the cut, so the genesis fold and the seeded fold "
    + "read different inputs and the assertion above can fail", below.length);

  // AND THE ORDINARY CLIENT STILL FORGETS. The origin branch must not have taken the trim path
  // away from the rooms it was built for.
  sb.SettingsProof._setVerdictForTest({ status: "validated" });
  const dropped = sb.StreamManager.trimToFloor();
  ok(dropped > 0 && sb.StreamManager._trimState() !== null,
    "E: an ordinary room still trims on the ordinary licence, and the boundary is raised",
    { dropped });
  const afterTrim = sb.StreamManager.getState();
  ok(JSON.stringify(afterTrim.rotation) === JSON.stringify(genesis.rotation),
    "E: and the room is unchanged across its trim, which is the property the whole forgetting "
    + "design rests on and the one a change to `_deriveBest` is most likely to break");
}

(async () => {
  await CONSEQUENCE();
  // ═══ A PARTIAL LOG CANNOT CONCLUDE, AND THE CASE LIST WAS ONE SHORT ═════════════════════════
// The seeded-validation site carries a capitalised comment saying a partial log must not reach a
// verdict, and warning that `mismatched` is CONCLUSIVE — one spurious verdict poisons that
// checkpoint for the session. **It guarded `_replaying` and `!after` and not "the log has been
// trimmed."** The rule was right; the enumeration was short by one.
//
// This is the fired-in-production case: `checkpoint seed diverges from genesis queue` in an
// otherwise clean long run, from a client that had trimmed. A room that trimmed once could never
// license forgetting again — and forgetting is what stops it growing without bound.
{
  const SDx = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON }).StateDeriver;
  const F2 = require("./_fixtures");
  const canonAny = (x) => Array.isArray(x) ? "[" + x.map(canonAny).join(",") + "]"
    : (x && typeof x === "object")
      ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonAny(x[k])).join(",") + "}"
      : JSON.stringify(x);
  // The SAME comparison the site performs — nowPlaying, rotation, settings.
  const canon = (st) => canonAny({ np: st.nowPlaying, rot: st.rotation, set: st.settings });

  const room2 = F2.playingRoom({ songs: 6 });
  const full = F2.sortLog(room2.log);
  const CUT = full[Math.floor(full.length * 0.4)].l;
  const seed2 = SDx.buildSeed(full.filter((e) => e.l <= CUT), null);

  // DIRECTION ONE: a client whose log REACHES GENESIS must still reach a verdict. Without this the
  // row below is satisfied by a comparison that never agrees with anything.
  const agrees = canon(SDx.derive(full.filter((e) => e.l > CUT), seed2)) === canon(SDx.derive(full, null));
  ok(agrees,
    "GENESIS: APPLIED — a client whose log reaches genesis MATCHES, so the comparison is capable " +
    "of validating and 'cannot conclude' below is a statement about the trimmed case rather than " +
    "about a check that never agrees", agrees);

  // DIRECTION TWO: after a trim the two sides are not comparable at any cut.
  const diverged = [];
  for (const below of [CUT - 2, CUT, CUT + 3]) {
    const tr = full.filter((e) => e.l > below);
    const same = canon(SDx.derive(tr.filter((e) => e.l > CUT), seed2)) === canon(SDx.derive(tr, null));
    if (!same) diverged.push(below);
  }
  ok(diverged.length === 3,
    "GENESIS: AFTER A TRIM THE COMPARISON DIVERGES AT EVERY CUT — a complete seeded fold against " +
    "one that starts mid-history. This is not a disagreement about events; the two sides are not " +
    "the same question", diverged);

  // ── WHAT IS AND IS NOT GUARDED, MEASURED PER MUTATION SHAPE ─────────────────────────────
  // The direct behavioural row — stand a client up, trim it, read `seedValidation()` — is ABSENT.
  // Two attempts failed and both are worth keeping:
  //
  //   1. Matching the source for `else if (_trimmedBelow !== null)` tests that TEXT IS PRESENT,
  //      not that the case runs — v292's M7 — and it died by CRASH rather than by assertion.
  //      Instrumenting at the decision separated the two hypotheses in one step: print what the
  //      assertion extracted on the clean and mutated trees. The regex DID discriminate; the
  //      earlier `sed` had never applied. **That instrumentation step is the reusable part.**
  //   2. Driving `seedValidation()` needs a client that has actually TRIMMED, and `trimToFloor()`
  //      needs an ADOPTED FLOOR — the Floor and vouch stack with quorum. A fixture, not a row.
  //      The route stands: reuse `check-cascade-simulation`'s stand-up.
  //
  // **BUT THE PROPERTY IS NOT UNGUARDED, AND THE FIRST DRAFT OF THIS COMMENT SAID IT WAS.**
  // Driven, three mutation shapes, on the shipped tree:
  //
  //   DELETE the case (a trimmed log concludes `mismatched` again)
  //       -> RED: check-origin-fold. The enumeration below counts the verdict SITES, so a
  //          removed case fails here.
  //   ALWAYS TAKE the branch (every client declines, nothing ever validates)
  //       -> RED: check-accepted-boundary, check-origin-fold, check-override-origin,
  //          check-seed-validation. Four directions, because a client that never validates
  //          cannot license forgetting and several guards depend on it doing so.
  //   NEVER TAKE the branch, `else if (false)`, wording intact
  //       -> RED: check-lint only, via `no-constant-condition` — and only because the condition
  //          is a literal, not because the behaviour is wrong.
  //   NEVER TAKE it SUBTLY, `_trimmedBelow !== null && _trimmedBelow === null`
  //       -> RED: NOTHING. Re-measured twice, with the mutation confirmed present in the file
  //          during the run and absent after: the full runner reports "All guards passed".
  //
  // **THAT LAST SHAPE IS THE GAP AND IT IS REAL.** A branch present, correctly worded, and
  // unreachable by a condition with no literal in it reproduces the original defect exactly and
  // NOTHING NOTICES — not even the linter, which has nothing static to flag. The behavioural row
  // is what would close it, which is why the route above is written down rather than dropped.
  //
  // ── AND A PROBE AIMED AT THE WRONG SITE IS INADMISSIBLE, NOT A RESULT ───────────────────
  // A contrary measurement was offered — six guards red on that subtle mutation — and it came from
  // an anchor matching `_trimmedBelow !== null || _originDeclared` at line 805: **the ORIGIN-FOLD
  // path, which decides whether to fold from a floor's seed instead of genesis.** The validation
  // case is a different site, far below. So the mutation broke the origin fold and the six reds
  // were the floor guards that failure would be expected to produce.
  //
  // **THE VERDICT LIST WAS THE TELL AND IT SHOULD HAVE BEEN READ AS ONE:** validation coverage
  // appearing as `check-derived-log-bound` / `check-floor-pairing` / `check-override-*` is
  // coverage of a different subject. `_trimmedBelow` appears in a condition at TEN sites in this
  // file; an anchor naming it is not an anchor. **Worse than matching twice** — matching twice
  // VOIDs, while matching one wrong site applies cleanly and reports a number.

  // The site's source, read here because the enumeration below is about the FILE's verdict sites.
  // (The block that used to bind this was removed with the source-grep row; the enumeration still
  // needs it, and losing the binding is why the extracted tree failed with `src is not defined`.)
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "backends/backend1/streammanager.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  // ── THE CASE LIST, ENUMERATED RATHER THAN ASSUMED ────────────────────────────────────────
  // A list short by one was short because nobody counted it. These are every verdict the site can
  // record; a new one must appear here, which is the only thing that stops the next omission.
  const verdicts = [...src.matchAll(/_recordValidation\("([a-z-]+)",\s*("([a-z:+-]*)"|[a-zA-Z_])/g)]
    .map((m) => m[1] + "/" + (m[3] !== undefined ? m[3] : "computed"));
  ok(verdicts.length === 7,
    "GENESIS: APPLIED — seven verdict sites, or the enumeration below is about a different file",
    verdicts);
  const cannotConclude = verdicts.filter((v) => v.indexOf("not-yet-run/") === 0);
  ok(cannotConclude.length === 4,
    "GENESIS: FOUR members of `cannot conclude` — still-replaying, no-boundary, the throw, and " +
    "now log-does-not-reach-genesis. The first three existed and the fourth is this defect: the " +
    "comment stated the rule and the code applied it to two cases out of three", cannotConclude);
}

console.log("[origin-fold] PASS — an imported seed reaches derived state, and the marker that "
    + "lets it is guarded together with the invariant it rests on. THE RULE: the fold starts from "
    + "the room's ORIGIN — normally empty, and when the floor declares one, that floor's seed over "
    + "everything above its cut. THE MARKER is `prev === null && thin === true`, two committed "
    + "fields read together, firing on an import and on none of the three honest shapes with BOTH "
    + "axes varied — and it is asserted to survive ADOPTION, which is where it did not: the "
    + "checkpoint carried the pair and `Floor.current()` carried half of it, so the predicate could "
    + "never have fired. THE FOLD is driven through ingest and Floor rather than by handing a log "
    + "to the reducer, which is the distinction that hid this for two releases while "
    + "`check-import` PART D stayed green. THE LATCH keeps an imported room derivable after it "
    + "seals its own second checkpoint, where re-reading the current floor would have emptied it a "
    + "cadence later. THE INVARIANT — no floor implies not trimmed — is stated and driven on both "
    + "routes that uphold it, with the consequence measured rather than argued: an honest seal from "
    + "the forbidden state publishes the origin declaration, and a client reading it discards a "
    + "real room's history. And the FALSE-POSITIVE direction is measured, not assumed: an ordinary "
    + "room declares no origin, validates by comparison rather than by construction, folds from "
    + "genesis, and still forgets (" + checks + " assertions)");
})().then(() => {}, (e) => { console.error(e); process.exit(1); });
