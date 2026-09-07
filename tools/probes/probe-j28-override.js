// tools/probes/probe-j28-override.js
//
// J28 — OWNER OVERRIDE FROM A FILE. The measurements the job turns on, run BEFORE anything is
// decided. Nine jobs running have had a premise true about the mechanism and wrong about the
// consequence, and this job inherits TWO premises nobody drove:
//
//   R1–R4  THE NUMBER J27 REFUSED TO PREDICT. What does `StreamManager.seedValidation()` record in
//          a created-from-file room? J28's entry says `mismatched` — conclusive — and J25's entry
//          says `settingsproof.js` records `unverifiable / named-event-not-read`, retryable, and
//          adds that J28's wording is "worth re-driving before anyone builds against it". Two
//          documents, two answers, neither driven. The verdict decides which of J28's three
//          options is even on the table.
//   R5–R7  DOES THE OWNER-ONLY CONSTRAINT INVERT? J27 measured that a peer file cannot be imported
//          because `Floor.chainVerifies` indexes into a log a room being CREATED does not have. An
//          override applies to a room that DOES have a log. The reasoning does not transfer; the
//          measurement has to be redone rather than the conclusion carried over.
//   R8–R10 WHAT DOES THE OVERRIDE'S CHECKPOINT COLLIDE WITH IN A LIVE ROOM? `publishImport` is the
//          one path that publishes without asking `maySeal`, safe only because it is reachable
//          from room creation alone. An override reaches it from a room with a cadence, a floor,
//          a cooldown and possibly peers.
//
// EVERY ROW SITS BEHIND AN ADMISSIBILITY GATE with its own self-test (--selftest, and run at the
// top of every normal run). `null` at the end of a measurement looks the same whichever stage
// failed, and this project has three recorded cases of absence reading as agreement.

const path = require("path");
const assert = require("assert");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

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

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
function row(id, question, pre, measure) {
  const bad = (pre || []).filter((p) => !p.ok);
  if (bad.length) {
    console.log("  " + id + "  INADMISSIBLE — " + bad.map((b) => b.name).join(" | "));
    return null;
  }
  let out;
  try { out = measure(); }
  catch (e) {
    console.log("  " + id + "  INADMISSIBLE — the measurement threw: " + (e && e.message));
    return null;
  }
  console.log("  " + id + "  " + question);
  console.log("       " + out.finding);
  return out;
}

// THE GATE IS ITSELF UNTESTED CODE unless something feeds it a deliberately broken input.
function selfTest() {
  const seen = [];
  const log = console.log;
  console.log = (s) => seen.push(String(s));
  let ranMeasure = false;
  const a = row("ST1", "q", [{ name: "a precondition that is false", ok: false }],
    () => { ranMeasure = true; return { finding: "SHOULD NEVER PRINT" }; });
  const b = row("ST2", "q", [{ name: "fine", ok: true }], () => { throw new Error("boom"); });
  const c = row("ST3", "q", [{ name: "fine", ok: true }], () => ({ finding: "admitted", v: 1 }));
  console.log = log;

  assert.ok(a === null, "gate self-test: a failed precondition must return null");
  assert.ok(ranMeasure === false, "gate self-test: a failed precondition must SKIP the measurement");
  assert.ok(seen.some((s) => /INADMISSIBLE.*a precondition that is false/.test(s)),
    "gate self-test: the refusal must NAME the stage that broke");
  assert.ok(b === null && seen.some((s) => /INADMISSIBLE.*threw: boom/.test(s)),
    "gate self-test: a throwing measurement is inadmissible, not a finding");
  assert.ok(c && c.v === 1 && seen.some((s) => /admitted/.test(s)),
    "gate self-test: CONTROL — an admissible row still runs and prints, or a gate that refuses "
    + "everything for free is indistinguishable from one that works");
  console.log("[gate] self-test PASS — a false precondition skips the measurement and names "
    + "itself, a throw is inadmissible, and an admissible row still runs (the control without "
    + "which a gate that refuses everything looks identical to one that works)");
}

// ── FIXTURES ─────────────────────────────────────────────────────────────────────────────────
function sealed(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: thin === true, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// The EXPORTING room — a real fold, real cuts. This is where a save file comes from.
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

// ── A CREATED-FROM-FILE ROOM, DRIVEN THE WAY features/room.js DRIVES IT ──────────────────────
// The sequence createFromFile performs, in order, through the production seams:
//   1. importFile(file)                          — read the file before anything exists
//   2. create() posts this build's default settings as the room's genesis settings event
//   3. a SECOND owner settings event carrying the file's blob, at l=2  (the anchor)
//   4. importCheckpoint(seed, anchor) -> Checkpoint.buildImport -> publishImport
//   5. the checkpoint arrives back through sync, is remembered at owner rank and adopted
//   6. the log folds and `seedValidation()` records a verdict
//
// EVENTS GO THROUGH `StreamManager.ingest`, not into a log by hand. The verdict under test is
// computed inside `_deriveBest`, which only runs on the ingest path — a hand-assembled log with
// `_setLogForTest` would reach the same function, but through a seam production does not use, and
// this project's rule is to drive the production path.
function createdFromFile(sb, file, opts) {
  const o = opts || {};
  const sent = [];
  sb.Checkpoint.attach({ send: async (type, cp) => { sent.push({ type, cp }); },
                         myUserId: () => "@importer:hs" });
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => false });

  const read = sb.StreamManager.importFile(file);
  if (!read.ok) return { ok: false, stage: "importFile", reason: read.reason, sent };

  // (2) and (3): the two settings events the create flow posts, through the one door.
  const genesisDefaults = F.rawEvent("$gen-defaults", 1, 1000, "@importer:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() });
  const imported = F.rawEvent("$gen-imported", 2, 1100, "@importer:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: read.settings });
  sb.StreamManager.ingest(genesisDefaults);
  sb.StreamManager.ingest(imported);

  const anchor = { settingsFrom: "$gen-imported", eventId: "$gen-imported", l: 2 };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  if (!built.ok) return { ok: false, stage: "buildImport", reason: built.reason, sent };

  // (5) the checkpoint arrives on `checkpoints-owner`: remembered at OWNER rank, off the channel.
  sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 1200);
  const selected = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted = selected ? sb.Floor.adopt(selected, false) : false;

  // (6) one more ordinary event so the fold runs with the floor in place, exactly as it would
  // when the room starts being used. Without it the verdict is whatever the last fold recorded.
  if (o.thenPlay !== false) {
    sb.StreamManager.ingest(F.rawEvent("$after", 3, 2000, "@importer:hs", F.RANK.owner,
      { t: "ddjp.dj.join", v: "SONGX" }));
  }

  return { ok: true, read, built, adopted, selected, sent,
           floor: sb.Floor.current(), verdict: sb.StreamManager.seedValidation(),
           state: sb.StreamManager.getState() };
}

function main() {
  selfTest();
  if (process.argv.indexOf("--selftest") >= 0) return;
  console.log("");
  console.log("probe-j28-override — the measurements J28 turns on");
  console.log("==================================================");

  // ── R1–R4  THE NUMBER ──────────────────────────────────────────────────────────────────────
  console.log("");
  console.log("R1-R4  what the pre-forget check records in a created-from-file room");

  // R1 — CONTROL FIRST. An ordinary room, an ordinary checkpoint sealed from its own log, adopted.
  // Without this every verdict below attributes to nothing: a harness that never reaches the
  // validation records `not-yet-run/no-checkpoint` in EVERY tree including the control, which is
  // exactly the shape of the three null-in-every-tree failures this project has recorded.
  const r1 = row("R1", "CONTROL — an ordinary room sealing from its OWN log: what is recorded?",
    [{ name: "fixtures load", ok: true }],
    () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.owner, trimmed: () => false });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const cut = log[2];
      const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cp = sealed(sb, seed, 1, null, cut.l, log[0].eventId + ".." + cut.eventId);
      sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
      const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
      const ad = sel ? sb.Floor.adopt(sel, false) : false;
      sb.StreamManager.ingest(F.rawEvent("$more", 99, 900000, "@dj:hs", F.RANK.player,
        { t: "ddjp.dj.declare", v: "SONGZ" }));
      const v = sb.StreamManager.seedValidation();
      return { v, adopted: ad,
        finding: "adopted=" + ad + "   seedValidation: " + v.status
          + (v.reason ? " / " + v.reason : "") };
    });

  // R2 — THE QUESTION. A created-from-file room, driven through the production seams.
  const r2 = row("R2", "THE QUESTION — a created-from-file room (J27's own path), same reading",
    [{ name: "the control reached a conclusive verdict, so this reading is attributable",
       ok: !!(r1 && (r1.v.status === "validated" || r1.v.status === "mismatched")) }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      if (!room.ok) throw new Error("the room never got built: " + room.stage + "/" + room.reason);
      const v = room.verdict;
      return { v, room,
        finding: "adopted=" + room.adopted + "   seedValidation: " + v.status
          + (v.reason ? " / " + v.reason : "")
          + "   licensesForget=" + sb.StreamManager.seedLicensesForget() };
    });

  // R3 — IS IT CONCLUSIVE? `mismatched` is conclusive by design: the throttle key is set, so the
  // check never runs again for that checkpoint. `not-yet-run` retries. The DIFFERENCE between them
  // is the whole of J28's collision, so it is measured rather than read off the status string.
  const r3 = row("R3", "IS THE VERDICT CONCLUSIVE? — five honest events later, does it move?",
    [{ name: "R2 produced a verdict", ok: !!r2 }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const first = sb.StreamManager.seedValidation();
      for (let i = 0; i < 5; i++) {
        sb.StreamManager.ingest(F.rawEvent("$honest" + i, 10 + i, 3000 + i * 1000,
          "@importer:hs", F.RANK.owner, { t: "ddjp.dj.declare", v: "SONG" + i }));
      }
      const later = sb.StreamManager.seedValidation();
      return { first, later,
        finding: "immediately: " + first.status + (first.reason ? "/" + first.reason : "")
          + "   after 5 honest events: " + later.status
          + (later.reason ? "/" + later.reason : "")
          + "   licensesForget=" + sb.StreamManager.seedLicensesForget() };
    });

  // R4 — WHICH TERM DIVERGES? A mismatch says the seeded fold and the genesis fold disagree; it
  // does not say about WHAT. `_canon` compares nowPlaying, rotation and settings. Naming the term
  // is what tells option 2 (re-anchor) apart from a settings problem J25 already solved.
  const r4 = row("R4", "WHICH TERM DIVERGES? — nowPlaying, rotation or settings",
    [{ name: "R2 produced a verdict", ok: !!r2 }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const read = sb.StreamManager.importFile(fileOf(sb, [X.cpA], "owner", X.keys));
      const anchor = { settingsFrom: "$gen-imported", eventId: "$gen-imported", l: 2 };
      const built = sb.Checkpoint.buildImport(read.seed, anchor);
      // The two folds the check compares, reproduced exactly: genesis over what the new room
      // holds, and seeded over what sorts after the cut (nothing, at this moment).
      const genesisLog = [
        F.reducerEvent("$gen-defaults", 1, 1000, "@importer:hs", F.RANK.owner,
          { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
        F.reducerEvent("$gen-imported", 2, 1100, "@importer:hs", F.RANK.owner,
          { t: "ddjp.room.settings", s: read.settings }),
      ];
      const genesis = sb.StateDeriver.derive(genesisLog);
      const seeded = sb.StateDeriver.derive([], built.cp.seed);
      const term = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const diffs = [];
      if (!term(genesis.nowPlaying, seeded.nowPlaying)) diffs.push("nowPlaying");
      if (!term(genesis.rotation, seeded.rotation)) diffs.push("rotation");
      if (!term(genesis.settings, seeded.settings)) diffs.push("settings");
      return { diffs, genesis, seeded,
        finding: "diverging terms: " + (diffs.length ? diffs.join(" + ") : "NONE")
          + "   (genesis rotation=" + genesis.rotation.length
          + ", seeded rotation=" + seeded.rotation.length
          + "; genesis nowPlaying=" + (genesis.nowPlaying ? "set" : "null")
          + ", seeded nowPlaying=" + (seeded.nowPlaying ? "set" : "null") + ")" };
    });

  // ── R5–R7  DOES OWNER-ONLY INVERT FOR AN OVERRIDE? ─────────────────────────────────────────
  console.log("");
  console.log("R5-R7  the owner-only constraint, re-measured on a room that HAS a log");

  // R5 — CONTROL. Reproduce J27's finding in this tree, so R6 is a comparison rather than a
  // reading. A refusal is evidence only if something adjacent was admitted.
  const r5 = row("R5", "CONTROL — J27's finding, reproduced: a peer chain with an EMPTY log",
    [{ name: "two chained snapshots built", ok: true }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const v = sb.Floor.chainVerifies([X.cpA, X.cpB], []);
      return { v, finding: "chainVerifies([cpA,cpB], []) = " + v + "   (J27 measured false)" };
    });

  // R6 — THE QUESTION. The same two snapshots against a room that DOES hold the joining log —
  // which is what an override applies to. If this comes back true, the reason J27 gave for
  // owner-only does not hold here and the constraint has to be re-argued rather than inherited.
  const r6 = row("R6", "THE QUESTION — the same chain against a room that HOLDS the joining log",
    [{ name: "the empty-log control refused, so a difference here is attributable",
       ok: !!(r5 && r5.v === false) }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const v = sb.Floor.chainVerifies([X.cpA, X.cpB], X.log);
      return { v, finding: "chainVerifies([cpA,cpB], log) = " + v
        + "   (log held: " + X.log.length + " events)" };
    });

  // R7 — AND THE ONE THAT DECIDES IT. A room being OVERRIDDEN holds its OWN log, not the exporting
  // room's. The joining segment a peer chain needs is a stretch of the room the FILE came from.
  // R6 holds the exporter's log because it IS the exporter. This row asks the real question:
  // does a DIFFERENT room's log verify the chain?
  //
  // THE FIRST VERSION OF THIS ROW WAS A FIXTURE ARTEFACT AND IS RECORDED RATHER THAN REPLACED
  // QUIETLY. It built the second room with `exportedRoom(fresh())`, and `F.playingRoom` hard-codes
  // its event ids ($join, $dec0, $play0, ...) — so the "unrelated" room's log was byte-identical
  // to the exporter's and `chainVerifies` resolved every cut. It printed `true` and "8 of the
  // file's event ids appear in it", which is the probe telling on itself: two independent rooms
  // sharing every id is not a room property, it is a builder property. The ids are remapped here
  // so the second room is genuinely foreign, and the overlap count stays in the output as the
  // control that would catch the same mistake again.
  const r7 = row("R7", "AND THE DECIDING ONE — a peer chain against a DIFFERENT room's log",
    [{ name: "the same chain verifies against its own room's log (R6)", ok: !!(r6 && r6.v === true) }],
    () => {
      const sb = fresh();
      const X = exportedRoom(sb);          // the file's room
      const Y0 = exportedRoom(fresh());    // an unrelated room being overridden
      const Y = { log: Y0.log.map((e) => Object.assign({}, e, { eventId: e.eventId + "-other" })) };
      const sameIds = X.log.filter((e) => Y.log.some((y) => y.eventId === e.eventId)).length;
      const v = sb.Floor.chainVerifies([X.cpA, X.cpB], Y.log);
      return { v, sameIds,
        finding: "chainVerifies([file's cpA,cpB], the OVERRIDDEN room's log) = " + v
          + "   (that log holds " + Y.log.length + " events; "
          + sameIds + " of the file's event ids appear in it — CONTROL: this must be 0, or the "
          + "two rooms are the same room and the row measures nothing)" };
    });

  // ── R8–R10  WHAT publishImport COLLIDES WITH IN A LIVE ROOM ────────────────────────────────
  console.log("");
  console.log("R8-R10  publishImport's safety argument, tested against a room that is not new");

  // R8 — CONTROL. In the position J27 built it for — a room seconds old, no floor, nothing sealed
  // — what does `maySeal` say? If it would have refused, that is the reason the bypass exists.
  //
  // THE PHASE GATE IS SATISFIED FIRST, DELIBERATELY. `maySeal` returns the FIRST reason that
  // fires, and an unattached harness sits at COLD, so both this row and R9 answered `not-live` on
  // the first run and the comparison measured the harness rather than the rooms. That is the
  // "one red line names the first assertion to fire" rule (08-build-and-deploy.md §Writing a
  // guard) arriving in a probe: to attribute a refusal, clear the gates ahead of it and re-ask.
  const r8 = row("R8", "CONTROL — in a NEW room, would maySeal have allowed the first checkpoint?",
    [{ name: "checkpoint module loads", ok: true }],
    () => {
      const sb = fresh();
      sb.Session._setPhaseForTest("live");
      // The env attached the way transport attaches it, so the cadence reads real inputs. An
      // unwired module holds nothing and refuses for that reason instead of the room's.
      sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@importer:hs",
        log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
        amOwner: () => true, held: () => [], isLegal: () => true,
        floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
        floorTs: () => sb.Floor.anchorTs() });
      const g = sb.Checkpoint.maySeal(Date.now());
      return { g, phase: sb.Session.phase(),
        finding: "maySeal in a brand-new room (phase=" + sb.Session.phase() + ", log=0 events): ok="
          + g.ok + " reason=" + g.reason };
    });

  // R9 — THE QUESTION. The same call in a room that has been running: a floor, a log, a cadence.
  // This is the room an override applies to.
  const r9 = row("R9", "THE QUESTION — the same call in a RUNNING room (an override's target)",
    [{ name: "the new-room control got PAST the phase gate, so a later reason is attributable",
       ok: !!(r8 && r8.g && r8.g.reason !== "not-live") }],
    () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Session._setPhaseForTest("live");
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.owner, trimmed: () => false });
      sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs",
        log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
        amOwner: () => true, held: () => [], isLegal: () => true,
        floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
        floorTs: () => sb.Floor.anchorTs() });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const cut = log[2];
      const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cp = sealed(sb, seed, 1, null, cut.l, log[0].eventId + ".." + cut.eventId);
      sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
      const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
      if (sel) sb.Floor.adopt(sel, false);
      const g = sb.Checkpoint.maySeal(Date.now());
      return { g, finding: "maySeal in a running room with an adopted floor (phase="
        + sb.Session.phase() + "): ok=" + g.ok + " reason=" + g.reason };
    });

  // R10 — AND WHAT THE OVERRIDE'S CHECKPOINT WOULD CLAIM. `buildImport` hard-codes n=1, prev=null.
  // In a room that has already sealed, the room's chain is at some n>1 with a real `prev`. Does an
  // n=1/prev=null checkpoint land as an improvement, or is it refused as not-an-improvement — and
  // what does the position comparison say?
  const r10 = row("R10", "AND THE ANCHOR — does an n=1/prev=null import outrank a room's OWN floor?",
    [{ name: "a running room with an adopted floor is constructible", ok: !!(r9 && r9.g) }],
    () => {
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
      const s1 = sb.Floor.select(F.RANK.owner, {}, () => true);
      sb.Floor.adopt(s1, false);
      const held = sb.Floor.current();

      // The override's checkpoint, anchored on a settings event posted NOW — so above the log.
      const X = exportedRoom(fresh());
      const read = sb.StreamManager.importFile(fileOf(sb, [X.cpA], "owner", X.keys));
      const anchorL = log[log.length - 1].l + 1;
      const built = sb.Checkpoint.buildImport(read.seed,
        { settingsFrom: "$ovr", eventId: "$ovr", l: anchorL });
      sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 6000);
      const s2 = sb.Floor.select(F.RANK.owner, {}, () => true);
      const took = s2 ? sb.Floor.adopt(s2, false) : false;
      const now = sb.Floor.current();
      return { held, now, took,
        finding: "held floor was n=" + held.n + " floorL=" + held.floorL
          + "; the override's is n=" + built.cp.n + " prev=" + built.cp.prev
          + " floorL=" + built.cp.floorL
          + "  -> adopted=" + took + ", floor now floorL=" + (now ? now.floorL : null)
          + " (position decides, `n` is incomparable across authors)" };
    });

  // ── R11–R13  THE OVERRIDE ITSELF: the same act applied to a room that HAS history ───────────
  // R2 measured J27's case — a room created from a file, which starts empty. J28's case is a room
  // that has been playing. The genesis fold the check compares against is therefore a real room's
  // history rather than two settings events, so the divergence is larger, not smaller. Measured
  // rather than reasoned from R2, because "the same only more so" is the shape of premise this
  // project keeps getting wrong.
  console.log("");
  console.log("R11-R13  the override applied to a RUNNING room (J28's own case)");

  // A running room, overridden the way createFromFile overrides a new one: post the file's
  // settings blob as an owner settings event, anchor the imported seed on it, adopt.
  function overridden(sb, file, opts) {
    const o = opts || {};
    const r = F.playingRoom({ songs: 3 });
    const log = F.sortLog(r.log);
    sb.Session._setPhaseForTest("live");
    sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                      myRank: () => F.RANK.owner, trimmed: () => false });
    sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
    for (const e of log) sb.StreamManager.ingest(F.toRaw(e));

    // The room seals and adopts its OWN floor first — this is a room with a working licence.
    const cut = log[2];
    const own = sealed(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
      cut.l, log[0].eventId + ".." + cut.eventId);
    sb.Floor.remember(own, F.RANK.owner, "@owner:hs", 5000);
    const s1 = sb.Floor.select(F.RANK.owner, {}, () => true);
    sb.Floor.adopt(s1, false);
    sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
      { t: "ddjp.dj.declare", v: "SONGQ" }));
    const before = sb.StreamManager.seedValidation();
    if (o.stopBeforeOverride) return { before, sb };

    const read = sb.StreamManager.importFile(file);
    if (!read.ok) throw new Error("the file did not read: " + read.reason);
    const anchorL = 41;
    sb.StreamManager.ingest(F.rawEvent("$ovr-settings", anchorL, 810000, "@owner:hs", F.RANK.owner,
      { t: "ddjp.room.settings", s: read.settings }));
    const built = sb.Checkpoint.buildImport(read.seed,
      { settingsFrom: "$ovr-settings", eventId: "$ovr-settings", l: anchorL });
    if (!built.ok) throw new Error("buildImport refused: " + built.reason);
    sb.Floor.remember(built.cp, F.RANK.owner, "@owner:hs", 820000);
    const s2 = sb.Floor.select(F.RANK.owner, {}, () => true);
    const took = s2 ? sb.Floor.adopt(s2, false) : false;
    sb.StreamManager.ingest(F.rawEvent("$after-ovr", 42, 830000, "@owner:hs", F.RANK.owner,
      { t: "ddjp.dj.join", v: "SONGR" }));
    return { before, after: sb.StreamManager.seedValidation(), took, built, sb, read };
  }

  // R11 — CONTROL. The same room WITHOUT the override: does it reach a licensing verdict at all?
  // Without this, a mismatch after the override attributes to nothing — a room that never
  // validated in the first place would show the same reading for an unrelated reason.
  const r11 = row("R11", "CONTROL — a running room with its own floor, BEFORE any override",
    [{ name: "the created-from-file reading exists to compare against", ok: !!r2 }],
    () => {
      const sb = fresh();
      const out = overridden(sb, null, { stopBeforeOverride: true });
      return { v: out.before,
        finding: "seedValidation: " + out.before.status
          + (out.before.reason ? " / " + out.before.reason : "")
          + "   licensesForget=" + out.sb.StreamManager.seedLicensesForget() };
    });

  // R12 — THE QUESTION. The same room, overridden.
  const r12 = row("R12", "THE QUESTION — the same room after an owner override from a file",
    [{ name: "the pre-override control VALIDATED, so a change here is the override's",
       ok: !!(r11 && r11.v.status === "validated") }],
    () => {
      const sb = fresh();
      const X = exportedRoom(fresh());
      const out = overridden(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      return { out,
        finding: "floor taken=" + out.took + "   before: " + out.before.status
          + "   after: " + out.after.status + (out.after.reason ? " / " + out.after.reason : "")
          + "   licensesForget=" + sb.StreamManager.seedLicensesForget() };
    });

  // R13 — AND IS IT CONCLUSIVE HERE TOO? The distinction that decides whether the room recovers on
  // its own. `mismatched` sets the throttle key and never re-runs for that checkpoint.
  const r13 = row("R13", "IS IT CONCLUSIVE? — six honest events after the override",
    [{ name: "R12 produced an after-verdict", ok: !!r12 }],
    () => {
      const sb = fresh();
      const X = exportedRoom(fresh());
      const out = overridden(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      for (let i = 0; i < 6; i++) {
        sb.StreamManager.ingest(F.rawEvent("$h" + i, 50 + i, 900000 + i * 1000, "@owner:hs",
          F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGH" + i }));
      }
      const later = sb.StreamManager.seedValidation();
      return { later,
        finding: "immediately: " + out.after.status + "   after 6 honest events: " + later.status
          + (later.reason ? " / " + later.reason : "")
          + "   licensesForget=" + sb.StreamManager.seedLicensesForget() };
    });
  // A NOTE THIS ROW USED TO CARRY AND DOES NOT: "the room's own floor licensed forgetting before
  // the override; it does not now". `licensesForget` reads FALSE in the R11 control too, because
  // `SettingsProof` is loaded and never fed in this harness, so the settings link of the chain is
  // withheld for a harness reason in both trees. The claim was true of the seed-validation term
  // and false of the predicate it named — a message naming something it is not (roles.md §10),
  // written by me, in my own output, minutes after reading the rule. The difference that IS
  // measured is the status: `validated` -> `mismatched`.

  // ── R14  DOES THE ROOM RECOVER ON ITS OWN? ─────────────────────────────────────────────────
  // This is what decides whether option 1 ("accept it") is survivable. The verdict is throttled
  // per CHECKPOINT SIGNATURE, so a later checkpoint re-runs the check with a fresh sig. If the
  // room's next honest seal validates, an override costs one cadence of forgetting. If it does
  // not, the room never forgets again for the rest of its life and option 1 is fatal rather than
  // merely expensive.
  console.log("");
  console.log("R14  whether the room recovers when it seals again");

  const r14 = row("R14", "DOES A LATER, HONEST CHECKPOINT RESCUE IT? — seal again above the cut",
    [{ name: "the override produced a mismatch to recover from",
       ok: !!(r12 && r12.out.after.status === "mismatched") }],
    () => {
      const sb = fresh();
      const X = exportedRoom(fresh());
      const out = overridden(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      // The room carries on and the owner seals honestly, the way the cadence would: the new seed
      // is built from the segment since the floor, over the floor's own seed — which is the
      // override's. This is the normal path, not a special one.
      for (let i = 0; i < 4; i++) {
        sb.StreamManager.ingest(F.rawEvent("$post" + i, 60 + i, 950000 + i * 1000, "@owner:hs",
          F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGP" + i }));
      }
      const logNow = sb.StreamManager.getLog();
      const cutIdx = logNow.length - 1;
      const cut = logNow[cutIdx];
      const seg = logNow.filter((e) => e.l > out.built.cp.floorL && e.l <= cut.l);
      const nextSeed = sb.StateDeriver.buildSeed(seg, out.built.cp.seed);
      const next = sealed(sb, nextSeed, 2, out.built.cp.h, cut.l,
        seg[0].eventId + ".." + cut.eventId);
      sb.Floor.remember(next, F.RANK.owner, "@owner:hs", 960000);
      const s3 = sb.Floor.select(F.RANK.owner, {}, () => true);
      const took2 = s3 ? sb.Floor.adopt(s3, false) : false;
      sb.StreamManager.ingest(F.rawEvent("$tick", 70, 970000, "@owner:hs", F.RANK.owner,
        { t: "ddjp.dj.declare", v: "SONGT" }));
      const v = sb.StreamManager.seedValidation();
      return { v, took2,
        finding: "sealed a FRESH checkpoint above the override (n=2, adopted=" + took2
          + ") -> seedValidation: " + v.status + (v.reason ? " / " + v.reason : "")
          + "   (a new signature re-runs the check, so this is not the throttle answering)" };
    });

  // ── R15–R16  DOES THE OVERRIDE ACTUALLY TAKE EFFECT? ───────────────────────────────────────
  // The rows above all measure the LICENCE. This one measures the job's own Done-when: "the room
  // adopts the state and every client converges on it". Reading `_deriveBest` while writing R12
  // raised the question, because the genesis fold it computes is not only the check's input — it
  // is RETURNED as live state (`return genesis`). The seeded fold is used for validation and
  // discarded. So an untrimmed client may be showing the room it had before the override, and the
  // README's stated failure mode for this family is exactly that: a room deriving SOMETHING rather
  // than the file's state reads like a working room.
  console.log("");
  console.log("R15-R16  whether the override reaches derived state at all");

  const r15 = row("R15", "WHAT DOES THE OVERRIDDEN ROOM DERIVE? — the file's state, or its own?",
    [{ name: "the override's floor was adopted (R12)", ok: !!(r12 && r12.out.took === true) }],
    () => {
      const sb = fresh();
      const X = exportedRoom(fresh());
      const out = overridden(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const live = sb.StreamManager.getState();
      const fromFile = sb.StateDeriver.derive([], out.built.cp.seed);
      const same = JSON.stringify(live.rotation) === JSON.stringify(fromFile.rotation);
      return { live, fromFile, same,
        finding: "live rotation = " + JSON.stringify(live.rotation.map((m) => m.user))
          + "   the FILE's rotation = " + JSON.stringify(fromFile.rotation.map((m) => m.user))
          + "   identical=" + same
          + "   (live nowPlaying=" + (live.nowPlaying ? live.nowPlaying.song || "set" : "null")
          + ", file nowPlaying=" + (fromFile.nowPlaying ? "set" : "null") + ")" };
    });

  // R16 — AND THE CONTROL THAT MAKES R15 ATTRIBUTABLE. If the two rotations differ, that could be
  // the override failing to apply — or the fixture having built two rooms with the same rotation,
  // in which case "identical" would have proved nothing either way. So: are they distinguishable
  // at all? A comparison whose two sides cannot come apart proves nothing (J25's PART A control).
  const r16 = row("R16", "CONTROL — can those two rotations differ at all in this fixture?",
    [{ name: "R15 produced both rotations", ok: !!r15 }],
    () => {
      const a = JSON.stringify(r15.live.rotation);
      const b = JSON.stringify(r15.fromFile.rotation);
      return { differ: a !== b,
        finding: "the two rotations are " + (a !== b ? "DISTINGUISHABLE" : "IDENTICAL")
          + " in this fixture, so R15's reading is "
          + (a !== b ? "attributable" : "vacuous — rebuild the fixture before believing it") };
    });

  // ── R17  THE SAME QUESTION ASKED OF J27's SHIPPED PATH ─────────────────────────────────────
  // R15 is about the override. If the mechanism is what it looks like — live state is the GENESIS
  // fold until a client trims, and trimming needs a licence the seed cannot earn — then it is not
  // a property of overriding. It is a property of seeding a room from a foreign seed, and J27's
  // create-from-file path does exactly that. `check-import` PART D compares `derive([], seed)` on
  // each side, which is the seed round-tripping; it never asks what a CLIENT derives. That is the
  // module-versus-wiring distinction (P1) on the guard that closed J27.
  console.log("");
  console.log("R17  the same question asked of J27's SHIPPED create-from-file path");

  const r17 = row("R17", "WHAT DOES A CREATED-FROM-FILE ROOM DERIVE? — the file's state, or empty?",
    [{ name: "the created-from-file room builds and adopts (R2)", ok: !!(r2 && r2.room.adopted) }],
    () => {
      // NOTHING ELSE IN THE ROOM. The earlier reading appended a join so the fold would run with
      // the floor in place, and a reader could fairly say the joiner was what they were seeing.
      // This is the room exactly as `createFromFile` leaves it: two settings events, one adopted
      // owner checkpoint, and nobody has done anything.
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys), { thenPlay: false });
      const live = sb.StreamManager.getState();
      const fromFile = sb.StateDeriver.derive([], room.built.cp.seed);
      const same = JSON.stringify(live.rotation) === JSON.stringify(fromFile.rotation);
      return { live, fromFile, same,
        finding: "live rotation = " + JSON.stringify(live.rotation.map((m) => m.user))
          + "   the FILE's rotation = " + JSON.stringify(fromFile.rotation.map((m) => m.user))
          + "   identical=" + same
          + "   |  the file's nowPlaying=" + (fromFile.nowPlaying ? "set" : "null")
          + ", the room's=" + (live.nowPlaying ? "set" : "null")
          + "   floor adopted=" + room.adopted
          + "   trimmed=" + sb.StreamManager._trimState()
          + "   licensesForget=" + sb.StreamManager.seedLicensesForget() };
    });

  console.log("");
  console.log("done.");
  return { r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17 };
}

main();
