// tests/check-override-origin.js
//
// J28 — OWNER OVERRIDE FROM A FILE. What this guard locks is the state of the question as
// MEASURED, not a design that has been built. J28 is still NOT built.
//
// ── WHAT J46 CHANGED HERE, AND WHY THAT IS THE GUARD WORKING ─────────────────────────────────
// This file was written as a GUARD OVER A GAP: every assertion was phrased to go RED the day
// somebody changed the behaviour it described. J46 changed it, and eleven assertions across PARTs
// A, B and C went red at once — which is what a pin is for, and the reason the count is recorded
// is that attributing it took a collecting `ok` rather than the first red, since one red line
// names the first assertion to fire and not the only one that would have.
//
// The three parts are resolved in three different ways, and the differences are the point:
//
//   PART A  RE-MEASURED, not weakened. The collision J28's entry predicted was real; J46 removed
//           the thing it was measuring, so the verdict is re-read and the new answer asserted
//           together with its REASON, because `validated` by comparison and `validated` because
//           there is nothing to compare are different claims.
//   PART B  NARROWED to what it was really pinning. Its question — "does the room recover by
//           sealing again?" — only mattered while the room was broken. What survives is its
//           control: the verdict is recorded once per checkpoint SIGNATURE rather than on every
//           ingest, which PART A's frozen-`at` assertion depends on and which J46's origin
//           verdict has to obey as well.
//   PART C  DELETED, and the deletion is the honest move rather than a weakening. It pinned "an
//           imported seed never reaches derived state". That behaviour is now `check-origin-fold`
//           PART B, which drives it harder — through ingest and Floor, with the seed-vs-client
//           agreement asserted at the seam where the two answers used to differ. Keeping an
//           inverted copy here would be two guards on one rule, which is the drift P7 is about.
//           Recorded rather than silently removed: a part that disappears with no note reads as
//           coverage nobody chose to drop.
//
// PARTs D, E and F are UNTOUCHED. They answer J28's own questions — adoption over an existing
// floor, owner-authored-only, and whether `publishImport`'s licence to skip `maySeal` transfers —
// and none of them is about how a seed reaches derived state, so J46 does not reach them.
//
//   A  the pre-forget verdict in a created-from-file room, RE-MEASURED after J46
//   B  and it is recorded per checkpoint SIGNATURE rather than per ingest
//   D  the override's checkpoint IS adopted over a room's own floor — the half that always worked
//   E  owner-authored-only still holds for an override, for a DIFFERENT reason than J27 gave
//   F  publishImport's safety argument does not transfer to a running room
//
// EVERYTHING IS DRIVEN THROUGH `StreamManager.ingest` AND `Floor`, never by handing a log to the
// reducer. The verdict under test is computed inside `_deriveBest`, which only runs on the ingest
// path — and the finding that produced J46 was that a guard asking the reducer directly gets a
// different answer from the one a client gets.

const assert = require("assert");
const { loadInContext } = require("./_load.js");
const F = require("./_fixtures.js");

let checks = 0;
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

function sealed(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: thin === true, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// The EXPORTING room — a real fold at a real cut. This is where a save file comes from.
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2], cut2 = log[5];
  const cpA = sealed(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seedA);
  const cpB = sealed(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
  return { log, cpA, cpB, seedA, seedB, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots: snapshots, keyset: keys, author: { rank: rank },
  })));
}

// A created-from-file room, driven the way `features/room.js` `createFromFile` drives it: read the
// file, post this build's defaults, post the file's blob over them, build and adopt the checkpoint.
function createdFromFile(sb, file, opts) {
  const o = opts || {};
  sb.Session._setPhaseForTest("live");
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@importer:hs" });
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => false });
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
  if (o.thenPlay !== false) {
    sb.StreamManager.ingest(F.rawEvent("$after", 3, 2000, "@importer:hs", F.RANK.owner,
      { t: "ddjp.dj.join", v: "SONGX" }));
  }
  return { read, built, adopted };
}

// An ordinary room that seals from its OWN log and adopts it. The control for everything below:
// without it a `mismatched` reading attributes to nothing, because a harness that never reaches
// the validation records the same thing in every tree including its controls.
function ordinaryRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => false });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = sealed(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
    cut.l, log[0].eventId + ".." + cut.eventId);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  sb.Floor.adopt(sel, false);
  sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "SONGQ" }));
  return { log, cp };
}

// ── PART A — the pre-forget verdict, RE-MEASURED after J46 ──────────────────────────────────
// J28's entry predicted a collision: an imported seed cannot reproduce a genesis it never had, so
// the pre-forget check records a mismatch, conclusively, and forgetting ends at the first
// override permanently. That was measured and TRUE at v252 — and it was a consequence of
// `_deriveBest` folding an imported room from genesis, which is the thing J46 fixed. So the
// prediction is not re-asserted; the verdict is re-read.
//
// THE REASON IS PART OF THE ASSERTION, not decoration. In an origin room the seeded fold and the
// base fold are the same computation over the same events, so a bare `validated` would be a
// verdict naming a comparison that did not happen (P10). `origin-seed` says which ground the
// licence rests on, and the ordinary control below says the other ground still exists.
{
  const ctrl = fresh();
  ordinaryRoom(ctrl);
  const cv = ctrl.StreamManager.seedValidation();
  ok(cv.status === "validated" && cv.reason === null,
    "A: CONTROL — an ordinary room, sealing from its OWN log, reaches `validated` BY COMPARISON, "
    + "with no reason recorded. Without this the readings below attribute to nothing: a harness "
    + "that never reaches the validation records the same value in every tree INCLUDING its "
    + "controls, which is the shape of the three null-in-every-tree measurements this project "
    + "has recorded — and without the REASON half, the origin verdict and the ordinary one would "
    + "be indistinguishable", cv);

  const sb = fresh();
  const X = exportedRoom(sb);
  createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
  const v = sb.StreamManager.seedValidation();
  ok(v.status === "validated" && v.reason === "origin-seed",
    "A: a created-from-file room now records `validated / origin-seed`. J28's entry described "
    + "`mismatched / diverges-from-genesis`, which was correct at v252 and was a symptom of the "
    + "genesis fold rather than of the seed: the room was being compared against a history it "
    + "never had. The comparison is not passed here, it is ABSENT — and the record says so "
    + "rather than borrowing the ordinary path's word for it", v);

  // CONCLUSIVE IN THE SAME SENSE AS BEFORE, measured rather than read off the status string: the
  // verdict is written once and not recomputed on every arrival. This matters more for the origin
  // path than it did for the old one, because `_recordOriginVerdict` is REACHED on every ingest
  // and it is the signature throttle alone that stops it rewriting `at` each time.
  const before = sb.StreamManager.seedValidation();
  const t0 = Date.now(); while (Date.now() - t0 < 3) { /* a real interval, so `at` could move */ }
  for (let i = 0; i < 5; i++) {
    sb.StreamManager.ingest(F.rawEvent("$honest" + i, 10 + i, 3000 + i * 1000, "@importer:hs",
      F.RANK.owner, { t: "ddjp.dj.declare", v: "SONG" + i }));
  }
  const later = sb.StreamManager.seedValidation();
  ok(later.status === "validated" && later.reason === "origin-seed",
    "A: five honest events later the verdict is unchanged", later);
  ok(later.at === before.at,
    "A: and it did not RE-RUN — `at` is written on every recording and is unchanged across five "
    + "ingests separated by a real interval, so the verdict is throttled by signature rather than "
    + "rewritten on each arrival. PART B is the control that proves `at` can move at all",
    { before: before.at, later: later.at });

  // THE LICENCE, WITH THE OTHER TERM SATISFIED SO THIS ONE IS THE VARIED AXIS. `seedLicensesForget`
  // ANDs the seed verdict with the settings claim, and SettingsProof withholds on its own in a
  // headless harness — so an assertion here that did not satisfy the settings half would read the
  // same whatever the seed said, which mutation M4 proved decorative in the previous version.
  sb.SettingsProof._setVerdictForTest({ status: "validated" });
  ok(sb.StreamManager.seedLicensesForget() === true,
    "A: and with the settings half satisfied the licence is now GRANTED, where J28's entry "
    + "recorded it permanently withheld. What it licenses in an origin room is narrow and is "
    + "asserted where it belongs — `check-origin-fold` PART B drives the trim and shows derived "
    + "state byte-identical across it, because the fold already starts above the cut");

  const lic = fresh();
  ordinaryRoom(lic);
  lic.SettingsProof._setVerdictForTest({ status: "validated" });
  ok(lic.StreamManager.seedLicensesForget() === true,
    "A: CONTROL — the same predicate answers TRUE in an ordinary room too, so the grant above is "
    + "not evidence that the predicate has stopped discriminating. The refusing case it must "
    + "still produce is a room whose seed genuinely mismatches, which `check-seed-validation` owns");
}

// ── PART B — the verdict is recorded per SIGNATURE, not per ingest ──────────────────────────
// What this part used to ask — "does an honest later checkpoint rescue the room?" — was a
// question about a broken room, and J46 removed the breakage rather than answering it. What it
// was really pinning survives and is now load-bearing for PART A: a NEW checkpoint signature
// makes the check run again and re-record, so PART A's frozen-`at` assertion is measuring a
// throttle rather than a field nothing ever writes.
{
  const sb = fresh();
  const X = exportedRoom(fresh());
  const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
  const first = sb.StreamManager.seedValidation();
  ok(first.status === "validated" && first.reason === "origin-seed",
    "B: PRECONDITION — there is a recorded verdict to re-record", first);

  // The room carries on, and the owner seals the way the cadence would: the new seed built from
  // the segment since the floor, over the floor's own seed. The normal path, not a special one.
  for (let i = 0; i < 4; i++) {
    sb.StreamManager.ingest(F.rawEvent("$post" + i, 60 + i, 950000 + i * 1000, "@importer:hs",
      F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGP" + i }));
  }
  const logNow = sb.StreamManager.getLog();
  const cut = logNow[logNow.length - 1];
  const seg = logNow.filter((e) => e.l > room.built.cp.floorL && e.l <= cut.l);
  const next = sealed(sb, sb.StateDeriver.buildSeed(seg, room.built.cp.seed), 2, room.built.cp.h,
    cut.l, seg[0].eventId + ".." + cut.eventId);
  ok(next.h !== room.built.cp.h,
    "B: CONTROL — the second checkpoint has a DIFFERENT signature, so the check below re-runs "
    + "rather than being answered by the throttle. Without this the assertion would hold for the "
    + "wrong reason, which is the decorative-assertion family");
  sb.Floor.remember(next, F.RANK.owner, "@importer:hs", 960000);
  const s3 = sb.Floor.select(F.RANK.owner, {}, () => true);
  ok(s3 && sb.Floor.adopt(s3, false) === true, "B: and the fresh checkpoint is adopted");
  sb.StreamManager.ingest(F.rawEvent("$tick", 70, 970000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.dj.declare", v: "SONGT" }));

  const after = sb.StreamManager.seedValidation();
  ok(after.at !== first.at,
    "B: a NEW signature does make the check re-run and re-record, so `at` moves here. This is the "
    + "control PART A's 'it did not re-run' rests on — without it that assertion would pass just "
    + "as well on a field nothing ever writes",
    { first: first.at, after: after.at });
  ok(after.status === "validated",
    "B: and the room stays licensed across its own second checkpoint. That the room also stays "
    + "DERIVABLE across it is the latch, asserted in `check-origin-fold` PART C — it is the same "
    + "event and two different questions, and only one of them belongs to J28", after);
}

// ── PART D — the half that works: the override's checkpoint IS adopted ──────────────────────
// Stated because the finding above is easy to over-read as "none of it works". The transport half
// is sound: an owner checkpoint anchored above a room's log outranks that room's own floor and is
// taken, on POSITION — `n` is incomparable across authors, so an n=1 import does not lose to an
// n=3 incumbent.
{
  const sb = fresh();
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => false });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[4];
  const own = sealed(sb, sb.StateDeriver.buildSeed(log.slice(0, 5), null), 3, "$someprev",
    cut.l, log[0].eventId + ".." + cut.eventId);
  sb.Floor.remember(own, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  const held = sb.Floor.current();
  ok(held && held.n === 3, "D: PRECONDITION — the room holds its own floor at n=3", held && held.n);

  const X = exportedRoom(fresh());
  const read = sb.StreamManager.importFile(fileOf(sb, [X.cpA], "owner", X.keys));
  const anchorL = log[log.length - 1].l + 1;
  const built = sb.Checkpoint.buildImport(read.seed,
    { settingsFrom: "$ovr", eventId: "$ovr", l: anchorL });
  ok(built.cp.n === 1 && built.cp.prev === null,
    "D: CONTROL — and the override's is n=1 with no predecessor, so this is the case where a "
    + "counter comparison would have refused it");
  sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 6000);
  const s2 = sb.Floor.select(F.RANK.owner, {}, () => true);
  ok(s2 && sb.Floor.adopt(s2, false) === true,
    "D: the override's checkpoint is adopted over the room's own floor — POSITION decides, which "
    + "is the same rule that stops a peer sealing often from outranking a fresher floor for ever");
  ok(sb.Floor.position() === anchorL,
    "D: and the floor moves to the override's anchor", sb.Floor.position());
}

// ── PART E — owner-authored-only still holds, for a DIFFERENT reason ────────────────────────
// J27 established import as owner-authored-only because `Floor.chainVerifies` locates each cut by
// INDEX into the event log and a room being CREATED has none. An override applies to a room that
// DOES have a log, so that reasoning does not transfer and the constraint has to be re-measured
// rather than inherited. It survives — and the reason is stronger, because it is about the
// PROVENANCE of the log rather than its emptiness.
{
  const sb = fresh();
  const X = exportedRoom(sb);

  ok(sb.Floor.chainVerifies([X.cpA, X.cpB], []) === false,
    "E: CONTROL — J27's finding reproduced: a peer chain with an empty log refuses");
  ok(sb.Floor.chainVerifies([X.cpA, X.cpB], X.log) === true,
    "E: CONTROL — and the same chain verifies against its OWN room's log, so the refusals here "
    + "are attributable to the log rather than to a chain that never verifies at all");

  // The overridden room's log, made genuinely foreign. `F.playingRoom` hard-codes its event ids,
  // so two rooms built from it share every id — the first version of this fixture did exactly
  // that and measured nothing, which the overlap assertion below now catches.
  const Y0 = exportedRoom(fresh());
  const foreign = Y0.log.map((e) => Object.assign({}, e, { eventId: e.eventId + "-other" }));
  const overlap = X.log.filter((e) => foreign.some((y) => y.eventId === e.eventId)).length;
  ok(overlap === 0,
    "E: CONTROL — the overridden room's log shares NO event id with the file's, so it is a "
    + "different room. Without this the row measures a room against itself", { overlap });

  ok(sb.Floor.chainVerifies([X.cpA, X.cpB], foreign) === false,
    "E: a peer chain does not verify against the OVERRIDDEN room's log either — so import stays "
    + "owner-authored-only for an override, and the reason is not J27's. J27's was that a new "
    + "room has no log to index into; this one is that the joining segment belongs to the FILE's "
    + "room, which the target room does not hold and can never hold. Emptiness was the special "
    + "case; provenance is the rule");
}

// ── PART F — publishImport's safety argument does not transfer ──────────────────────────────
// J27 published without asking `maySeal`, arguing that "none of the cadence's questions is about
// an import: the room was created seconds ago, there is no span to cover and no peer to defer to",
// with the counterpart obligation that it is reachable from room creation ALONE. An override
// reaches it from a room with a cadence, a floor and peers, so the obligation is broken and the
// argument has to be rebuilt rather than restated.
//
// THE PHASE GATE IS SATISFIED FIRST IN BOTH TREES. `maySeal` returns the FIRST reason that fires,
// so an unattached harness answers `not-live` in every tree and the comparison measures the
// harness. To attribute a refusal, clear the gates ahead of it and re-ask.
{
  const nu = fresh();
  nu.Session._setPhaseForTest("live");
  nu.Checkpoint.attach({ send: async () => {}, myUserId: () => "@importer:hs",
    log: () => nu.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    amOwner: () => true, held: () => [], isLegal: () => true,
    floorPos: () => (nu.Floor.current() ? nu.Floor.position() : null),
    floorTs: () => nu.Floor.anchorTs() });
  const gNew = nu.Checkpoint.maySeal(Date.now());
  ok(gNew.ok === false && gNew.reason === "nothing-changed",
    "F: in a BRAND-NEW room maySeal refuses with `nothing-changed` — a room that has not moved has "
    + "nothing to bank. That is J27's argument holding: the refusal is not about the import, so "
    + "bypassing it costs nothing", gNew);

  const run = fresh();
  ordinaryRoom(run);
  run.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs",
    log: () => run.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    amOwner: () => true, held: () => [], isLegal: () => true,
    floorPos: () => (run.Floor.current() ? run.Floor.position() : null),
    floorTs: () => run.Floor.anchorTs() });
  const gRun = run.Checkpoint.maySeal(Date.now());
  ok(gRun.ok === false && gRun.reason === "not-due",
    "F: in a RUNNING room it refuses with `not-due` instead — the cooldown, which exists to stop "
    + "the ladder sealing on top of itself. That IS a question about the room, so an override "
    + "reaching `publishImport` would bypass a gate doing real work", gRun);
  ok(gNew.reason !== gRun.reason,
    "F: and the two refusals DIFFER, which is the whole point — 'none of the cadence's questions "
    + "is about an import' is true of a new room and false of a running one. Asserting only that "
    + "both refuse would have passed while proving nothing");
}

console.log("[override-origin] PASS — J28's questions, re-measured after J46 rather than "
  + "inherited from the session that filed them. THE COLLISION IS GONE, and it was a symptom "
  + "rather than the disease: a created-from-file room recorded `mismatched / "
  + "diverges-from-genesis` at v252 because it was being compared against a history it never "
  + "had, and now records `validated / origin-seed` — the REASON asserted alongside the status, "
  + "because in an origin room the comparison is absent rather than passed, and a bare "
  + "`validated` would name a check that did not happen. The verdict is written once per "
  + "checkpoint SIGNATURE and not on every ingest, with the control that a fresh signature does "
  + "make `at` move, so the throttle is measured rather than read off a field nothing writes; and "
  + "the licence J28's entry recorded permanently withheld is now granted, against a control "
  + "showing the predicate still answers the same way for an ordinary room. THE PART THAT PINNED "
  + "THE GAP IS DELETED, not weakened: an imported seed reaching derived state is now "
  + "`check-origin-fold` PART B, which drives it harder and asserts the reducer's answer and the "
  + "client's AGREE at the seam where they used to differ. What J46 does NOT touch is asserted "
  + "unchanged: an n=1 override outranks an n=3 incumbent on position; owner-authored-only "
  + "survives for an override on provenance rather than on J27's emptiness, since the joining "
  + "segment belongs to the file's room; and `publishImport`'s licence to skip `maySeal` does not "
  + "transfer, because a new room refuses `nothing-changed` while a running one refuses "
  + "`not-due`, which is a real cadence question ("+ checks + " assertions)");
