// tests/check-override-running.js — J28: AN OWNER OVERRIDE APPLIED TO A RUNNING ROOM.
//
// J46 made an imported seed reach derived state in a room CREATED from a file. This guard is about
// the room J46 did not touch: one that already has a log, a floor, a cadence and peers. Every
// argument J27 made rests on the empty-room premise, and J28 is the job that removes it.
//
//   PART A  the marker REACHES the fold's reader on this route too, and the state becomes the file's
//   PART B  `_aboveCut` — measured REDUNDANT at J46, LOAD-BEARING here, and this is what pins it
//   PART C  the latch under the room's next ORDINARY checkpoint
//   PART D  `publishImport`'s owner gate — the half J27 paid for with a wiring promise
//
// EVERYTHING IS DRIVEN THROUGH `StreamManager.ingest` AND `Floor`. The behaviour under test lives
// in `_deriveBest`, which only runs on the ingest path, and J46's whole finding was that a guard
// asking the reducer directly gets a different answer from the one a client gets.
//
// WHY THIS IS A SECOND FILE AND NOT MORE PARTS ON `check-override-origin`. That file answers what
// J28's session MEASURED about a job it did not build; this one holds what the build must keep
// true. Its PARTs D/E/F still own adoption-on-position, owner-authored-only and the `maySeal`
// asymmetry, and none of them is restated here.

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
    "core/logger.js", BACKEND + "ranks.js", BACKEND + "consensushash.js",
    BACKEND + "trustpolicy.js", BACKEND + "statederiver.js", BACKEND + "checkpointformat.js",
    BACKEND + "dials.js", BACKEND + "session.js", BACKEND + "scheduler.js", BACKEND + "floor.js",
    BACKEND + "eventcache.js", BACKEND + "streammanager.js", BACKEND + "vouch.js",
    BACKEND + "checkpoint.js", BACKEND + "settingsproof.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

function sealed(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n, prev: prev || null, seed, floorL, thin: thin === true, covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// The EXPORTING room — where a save file comes from.
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cpA = sealed(sb, seedA, 1, null, log[2].l, log[0].eventId + ".." + log[2].eventId);
  return { log, cpA, seedA, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots, keyset: keys, author: { rank } })));
}

// THE ROOM THE OVERRIDE ARRIVES AT: its own log, its own adopted floor, its own rotation.
//
// ITS EVENT IDS ARE MADE DISTINCT FROM THE FILE'S. `F.playingRoom` hard-codes them, so two
// "different" rooms built from it share every id — the fixture artefact J28's entry records as
// having measured a room against itself. The zero-overlap control below is what catches it.
function runningRoom(sb) {
  // THE SUFFIX MUST CARRY THE PARENT POINTERS, and the first version of this did not. `p` names the
  // play instance an advance follows, and a play instance IS an event id — so renaming the ids and
  // leaving `p` alone left every advance after the first naming a parent that no longer existed,
  // the lock refused them, and the "running" room was frozen on its first song. It read as a room,
  // which is why the control that caught it (the target must be playing something ELSE) is worth
  // more than the assertion it protects.
  const r = F.playingRoom({ songs: 3 });
  const rename = (id) => (typeof id === "string" && id ? id + "-tgt" : id);
  const log = F.sortLog(r.log).map((e) => Object.assign({}, e, {
    eventId: rename(e.eventId),
    content: Object.assign({}, e.content,
      (e.content && typeof e.content.p === "string") ? { p: rename(e.content.p) } : {}),
  }));
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner,
                    trimmed: () => sb.StreamManager._trimState() !== null });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs", amOwner: () => true,
    log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    held: () => [], isLegal: () => true,
    floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
    floorTs: () => sb.Floor.anchorTs() });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cp = sealed(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 3, "$tgtprev",
    log[2].l, log[0].eventId + ".." + log[2].eventId);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  return { log, cp, head: log[log.length - 1] };
}

// Apply an override the way `features/room.js` `overrideFromFile` drives it: read the file, post
// the file's settings at the room's HEAD, build the checkpoint anchored on it, publish, adopt.
function applyOverride(sb, tgt, file, opts) {
  const o = opts || {};
  const read = sb.StreamManager.importFile(file);
  if (!read.ok) throw new Error("the file did not read: " + read.reason);
  const l = tgt.head.l + 1;
  sb.StreamManager.ingest(F.rawEvent("$ovr-settings", l, 900000, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: read.settings }));
  const anchor = { settingsFrom: "$ovr-settings", eventId: "$ovr-settings", l };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  if (!built.ok) throw new Error("buildImport refused: " + built.reason);
  sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 900500);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted = sel ? sb.Floor.adopt(sel, false) : false;
  if (o.thenIngest !== false) {
    sb.StreamManager.ingest(F.rawEvent("$post-ovr", l + 1, 901000, "@owner:hs", F.RANK.owner,
      { t: "ddjp.dj.join", v: "SONGZ" }));
  }
  return { read, built, adopted, anchorL: l };
}

// ── PART A — the override reaches derived state, and the marker reaches the reader ───────────
// J46's lesson is the one that transfers most directly: the origin pair existed on the wire, in
// `_seen` and in the fingerprint, and `adopt()` rebuilt the trusted floor field by field and
// DROPPED `thin` — so the marker reached everywhere except `Floor.current()`, which is what
// `_deriveBest` reads. Which fields carry a claim is a different question from whether they reach
// the reader, and an override travels the same route. So this asks the FLOOR, never the checkpoint.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());

  const beforeFloor = sb.Floor.current();
  const beforeState = sb.StreamManager.getState();
  ok(beforeFloor && beforeFloor.n === 3,
    "A: PRECONDITION — the target room holds its OWN floor at n=3, so what follows is an override "
    + "over an incumbent rather than a first checkpoint", beforeFloor && beforeFloor.n);
  ok(sb.StreamManager._originState() === false,
    "A: PRECONDITION — and it has declared no origin, so the latch asserted in PART C starts down");
  ok(beforeState.nowPlaying && beforeState.rotation.length > 0,
    "A: PRECONDITION — the room is genuinely running: something is playing and somebody is in the "
    + "rotation. Without this the comparison below is between two empty rooms");

  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys));
  ok(out.adopted === true, "A: the override's checkpoint is adopted");

  const f = sb.Floor.current();
  ok((f.prev === null || f.prev === undefined) && f.thin === true,
    "A: APPLIED — and the origin marker SURVIVES adoption on this route: `Floor.current()` carries "
    + "both halves. The checkpoint carrying the pair proves nothing about the fold, because "
    + "`_deriveBest` reads the floor and `adopt()` used to drop `thin` (J46, probe-j46-fold R30)",
    { prev: f.prev === null ? null : "set", thin: f.thin });
  ok(sb.StreamManager._originState() === true,
    "A: so the room reads as declaring an origin");

  const st = sb.StreamManager.getState();
  const fileSeed = X.cpA.seed;
  ok(JSON.stringify(st.nowPlaying && st.nowPlaying.song)
     === JSON.stringify(fileSeed.nowPlaying && fileSeed.nowPlaying.song),
    "A: THE ROOM NOW PLAYS WHAT THE FILE SAYS, which is the job's Done-when reached through the "
    + "client rather than through the reducer", { live: st.nowPlaying && st.nowPlaying.song,
      file: fileSeed.nowPlaying && fileSeed.nowPlaying.song });
  ok(JSON.stringify(st.nowPlaying && st.nowPlaying.song)
     !== JSON.stringify(beforeState.nowPlaying && beforeState.nowPlaying.song),
    "A: CONTROL — and that is a CHANGE. The target room was playing something else, so the "
    + "assertion above cannot be passing because the two rooms happened to agree",
    { was: beforeState.nowPlaying && beforeState.nowPlaying.song });

  const v = sb.StreamManager.seedValidation();
  ok(v.status === "validated" && v.reason === "origin-seed",
    "A: and the pre-forget check records the ORIGIN verdict rather than falling through the "
    + "comparison. The reason is part of the assertion: in an origin room the base fold IS the "
    + "seeded fold, so a bare `validated` would name a check that did not happen (P10)", v);
  ok(sb.StreamManager.pairingFault() === null,
    "A: with no pairing fault — the seed and the holdings meet", sb.StreamManager.pairingFault());
}

// ── PART B — `_aboveCut` STOPS BEING REDUNDANT, AND THIS IS THE ROUTE THAT DOES IT ───────────
// J46 measured the clause redundant through every production route then existing and recorded the
// three reasons, closing with the condition under which it would stop being so: "if a reducer rule
// that absorbs a double-fold is ever relaxed, this becomes load-bearing without anything announcing
// it."
//
// THE CONDITION AROSE AND NOT THE WAY IT WAS FORECAST. No reducer rule was relaxed. J28 added a
// route where the below-cut events are a real room's plays and joins rather than two idempotent
// settings posts, so none of the three absorptions applies. This part is what announces it.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys), { thenIngest: false });

  const log = sb.StreamManager.getLog();
  const f = sb.Floor.current();
  const below = log.filter((e) => (typeof e.l === "number" ? e.l : 0) <= f.floorL);
  const above = log.filter((e) => (typeof e.l === "number" ? e.l : 0) > f.floorL);

  ok(below.length > 1,
    "B: PRECONDITION — there are events below the cut at all. On the created-from-file route there "
    + "are two settings posts and nothing else, which is one of the three reasons J46 could not "
    + "make this fail", { below: below.length });
  ok(below.filter((e) => e.type !== "ddjp.room.settings").length > 0,
    "B: PRECONDITION — and they are NOT all settings posts. This is the axis that differs from the "
    + "creation route: re-folding settings is idempotent, re-folding a room's plays is not",
    { nonSettings: below.filter((e) => e.type !== "ddjp.room.settings").length });

  const aboveOnly = sb.StateDeriver.derive(above, f.seed);
  const wholeLog = sb.StateDeriver.derive(log, f.seed);

  // ── AND THE AXIS IS THE BUFFER, NOT THE PLAYHEAD. MEASURED, AFTER GETTING IT WRONG ────────
  // The first version of this part asserted on `nowPlaying`, and it "passed" against a fixture
  // whose event ids had been suffixed WITHOUT rewriting `p` — so every advance after the first
  // named a parent that did not exist, the lock refused them, and the target room was frozen on
  // its first song while reading as a running one. With the chain repaired the playheads AGREE:
  // the seeded head is the file's `pi`, so the target's own advances name a parent that is not the
  // head and the advance lock refuses them exactly as J46's third absorption says it would.
  //
  // What the lock does NOT absorb is the DECLARE. Re-folding the below-cut log puts a song that
  // has already played in the file's room back into its DJ's pending buffer — which is J46's own
  // R38 finding ("an already-played song back in its DJ's buffer") arriving through a production
  // route for the first time. So the clause is load-bearing here, and the reason it is load-bearing
  // is one axis over from where this part first looked.
  ok(JSON.stringify(aboveOnly.nowPlaying) === JSON.stringify(wholeLog.nowPlaying),
    "B: CONTROL — the PLAYHEAD is absorbed: both folds agree, because the seeded head is the "
    + "file's play instance and the target room's own advances name a parent that is not it, so "
    + "the advance lock refuses them. Asserting a difference here is what a broken fixture made "
    + "this part do once, and the row is kept so nobody re-derives the wrong axis",
    { aboveOnly: aboveOnly.nowPlaying && aboveOnly.nowPlaying.song });

  const rot = (s) => s.rotation.map((m) => m.user + ":" + m.pending.map((p) => p.videoId).join("/"));
  ok(JSON.stringify(rot(aboveOnly)) !== JSON.stringify(rot(wholeLog)),
    "B: THE ROTATION IS NOT ABSORBED. Folding the whole log over the override seed returns a song "
    + "that already played in the FILE's room to its DJ's pending buffer, so the room is neither "
    + "the file's nor the one it replaced — and silently, because a declare is idempotent-looking "
    + "and nothing refuses it", { aboveOnly: rot(aboveOnly), wholeLog: rot(wholeLog) });
  ok(JSON.stringify(aboveOnly) !== JSON.stringify(wholeLog),
    "B: so the two derived states are not equal, which is the claim the clause rests on");

  // ── AND THE CLIENT'S OWN ANSWER NEEDS A FOLD, WHICH IS A FINDING RATHER THAN A DETAIL ─────
  // `_deriveBest` runs on the INGEST path. Adopting a floor does not itself re-derive, so the
  // reading below is taken after one more event arrives — and that "one more event" is not a
  // harness convenience, it is what production depends on too. Recorded in `09-roadmap.md` as
  // J47: in a QUIET room an owner can click restore and see nothing change until something else
  // happens, because the only prompt re-derive is `trimToFloor`'s, which fires just after adoption
  // and returns 0 without refolding whenever the forget licence is not yet granted — and at that
  // instant it never is, since the verdict that grants it (`validated / origin-seed`) is recorded
  // BY the fold that has not run. This guard does not pin that gap; it drives past it deliberately,
  // and says so rather than letting a passing assertion imply the gap is closed.
  sb.StreamManager.ingest(F.rawEvent("$nudge", out.anchorL + 9, 906000, "@owner:hs",
    F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGN" }));
  const st = sb.StreamManager.getState();
  const stRot = rot(st).map((s) => s.replace(/\/?SONGN/, ""));
  ok(JSON.stringify(stRot) === JSON.stringify(rot(aboveOnly)),
    "B: APPLIED — and what the CLIENT derives, once a fold has run, is the above-the-cut answer. "
    + "So `_deriveBest` really is bounding its input rather than the reducer absorbing the "
    + "difference: mutating `_aboveCut(ordered, f)` to `ordered` turns this red, which is what "
    + "J46's M8 could not achieve on any route that existed then",
    { client: rot(st), aboveOnly: rot(aboveOnly) });
}

// ── PART C — THE LATCH, DRIVEN ON THE OVERRIDE ROUTE ─────────────────────────────────────────
// The override lands, the room keeps running, and the cadence seals again. That next checkpoint is
// an ORDINARY one — `prev` names the override and `thin` is false, correctly — so a predicate
// re-asked per fold falls back to genesis and the room reverts. J46 measured that for a created
// room; here "reverts" means back to the PRE-OVERRIDE room, which is worse than empty because it
// looks entirely healthy. Later than the original bug and harder to see.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys));
  const afterOverride = sb.StreamManager.getState();
  const ovr = sb.Floor.current();

  // The room's own next seal, built over the override's floor: ordinary by construction.
  const log = sb.StreamManager.getLog();
  const above = log.filter((e) => (typeof e.l === "number" ? e.l : 0) > ovr.floorL);
  const head = log[log.length - 1];
  const nextCp = sealed(sb, sb.StateDeriver.buildSeed(above, ovr.seed), ovr.n + 1, ovr.h,
    head.l, head.eventId + ".." + head.eventId, false);
  ok(nextCp.prev !== null && nextCp.thin === false,
    "C: PRECONDITION — the room's next checkpoint is an ORDINARY one. It names the override as its "
    + "predecessor and declares no origin, which is correct and is exactly what makes it dangerous "
    + "to a predicate that re-reads the current floor");

  sb.Floor.remember(nextCp, F.RANK.owner, "@owner:hs", 902000);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  ok(sel && sb.Floor.adopt(sel, false) === true,
    "C: PRECONDITION — and it is adopted, so the floor really has moved off the origin checkpoint");
  const now = sb.Floor.current();
  ok(!((now.prev === null || now.prev === undefined) && now.thin === true),
    "C: PRECONDITION — the floor this client now holds does NOT carry the marker. Without this the "
    + "latch is untested, because re-reading the floor would give the same answer either way",
    { prev: now.prev === null ? null : "set", thin: now.thin });

  sb.StreamManager.ingest(F.rawEvent("$after-cadence", head.l + 5, 903000, "@owner:hs",
    F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGW" }));

  ok(sb.StreamManager._originState() === true,
    "C: THE ORIGIN IS STILL DECLARED — it LATCHES, because it describes the ROOM rather than the "
    + "floor, which is a moving mark within it");
  const st = sb.StreamManager.getState();
  ok(JSON.stringify(st.nowPlaying) === JSON.stringify(afterOverride.nowPlaying),
    "C: APPLIED — so one cadence later the room still holds the state the override put there. "
    + "Un-latching (re-reading `_isOriginFloor` per fold) turns this red by sending the room back "
    + "to the genesis fold — the PRE-OVERRIDE room, which reads as healthy",
    { afterOverride: afterOverride.nowPlaying && afterOverride.nowPlaying.song,
      oneCadenceLater: st.nowPlaying && st.nowPlaying.song });

  // AND THE ROOM CHANGE CLEARS IT, which is the other half of a latch being safe.
  sb.StreamManager.reset();
  ok(sb.StreamManager._originState() === false,
    "C: and `reset()` clears it, so an origin cannot outlive the room it describes — the same "
    + "pairing the marker's own soundness rests on (`no floor implies not trimmed`)");
}

// ── PART D — THE OWNER GATE, WHICH REPLACES A WIRING PROMISE WITH A CHECKED QUESTION ─────────
// J27 published an import without asking `maySeal`, and paid for the missing gate with a sentence:
// "it must only ever be reached from room creation, where the caller is the owner by construction."
// J28 adds the second caller. A promise about who calls a function is the thing this codebase keeps
// discovering was never checked (P1), and measurement said so before anything replaced it —
// `probe-j28-running` R46: a guest-ranked non-owner `_env` published, with nothing objecting.
//
// THE FEATURE LAYER DOES NOT RESTATE IT. Authority is asked once, below the seam, where both call
// sites reach it. What `features/room.js` owns instead is the question a created room cannot ask.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  const read = sb.StreamManager.importFile(fileOf(sb, [X.cpA], "owner", X.keys));
  ok(read.ok === true, "D: PRECONDITION — the file reads, so a refusal below is about authority "
    + "rather than about the file", { reason: read.reason });

  const fs = require("fs");
  const path = require("path");
  const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const room = rd("features/room.js");
  const i = room.indexOf("async function overrideFromFile");
  ok(i > 0, "D: `Room.overrideFromFile` exists — the override's entry point in the feature layer");
  const body = room.slice(i, room.indexOf("\n  async function join", i));

  ok(/StreamManager\.importFile/.test(body) && /StreamManager\.importCheckpoint/.test(body),
    "D: it crosses the SAME seam the creation path crosses — no second reader, no second publisher");
  ok(!/CheckpointFormat|Floor\.|Checkpoint\./.test(body),
    "D: and it reaches no backend INTERNAL directly (check-boundaries rule F)");
  ok(body.indexOf("ddjp.checkpoint") < 0,
    "D: it names no checkpoint wire type — the type has one home, and the channel is chosen where "
    + "the channel map lives");
  ok(/MatrixBridge\.mayAuthor\(\)/.test(body),
    "D: IT ASKS WHETHER IT MAY AUTHOR — the question a created room cannot ask, because a room "
    + "being created has no head to be behind. The override anchors its origin on THIS room's head, "
    + "so a client still replaying would anchor at a position the room has already moved past");
  const iAsk = body.indexOf("MatrixBridge.mayAuthor()");
  const iSend = body.indexOf("MatrixBridge.sendEvent");
  ok(iAsk >= 0 && iSend >= 0 && iAsk < iSend,
    "D: APPLIED — and it asks BEFORE it posts anything. Asking after the settings event is in the "
    + "room's log is not a gate, it is a comment", { iAsk, iSend });
  const iRead = body.indexOf("StreamManager.importFile");
  ok(iRead >= 0 && iRead < iSend,
    "D: and the FILE is read before that too, so a refusal computable from the file alone never "
    + "leaves a live room's rules changed with nothing to explain why — the ordering rule J25 "
    + "established for the keyset diagnosis, arriving two seams later", { iRead, iSend });
  ok(!/amOwner|isOwner|rank\s*[=<>]/.test(body),
    "D: and it does NOT restate the owner rule. That question belongs to the artefact and is asked "
    + "in `publishImport`, which both call sites reach — a second copy in the layer that may not "
    + "read the first is the drift P7 is about");
  ok(/return\s*\{\s*ok:\s*false/.test(body),
    "D: refusals are RETURNED rather than dropped, so a click can say why nothing happened "
    + "(paths.md §8c — `undefined` for both sent and declined is the shape that leaves a person "
    + "pressing a button twice)");
}

console.log("[override-running] PASS — an owner override lands in a room that is already running, "
  + "which is the room J46 did not touch. The origin marker survives adoption on this route too "
  + "and is asserted at `Floor.current()` rather than on the checkpoint, because the marker "
  + "existing and the marker REACHING the fold's reader are different claims and only the second "
  + "moves a room; the state becomes the file's against a control proving the target room was "
  + "playing something else, and the pre-forget check records `validated / origin-seed` rather "
  + "than falling through a comparison that is absent. `_aboveCut` is pinned here because J28 is "
  + "the route that makes it LOAD-BEARING: J46 measured it redundant and named the condition, and "
  + "the condition arrived not by a reducer rule relaxing but by a route appearing where the "
  + "below-cut events are a real room's plays instead of two idempotent settings posts — folding "
  + "the whole log over the override seed lands in a room that is neither the file's nor the one "
  + "it replaced. The latch is driven to the room's next ORDINARY checkpoint, with the floor "
  + "asserted to have moved off the marker first so the assertion cannot pass by the floor still "
  + "carrying it, and `reset()` shown to clear it. And `publishImport`'s missing gate — paid for "
  + "by J27 with a promise that it is reachable from room creation alone, which J28 breaks — is "
  + "replaced by a checked owner question with controls either side, while the feature layer asks "
  + "the one thing a created room cannot: am I caught up enough to anchor on the head ("
  + checks + " assertions)");
