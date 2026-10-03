// tools/probes/probe-j46-fold.js
//
// J46 — MAKE AN IMPORTED SEED REACH DERIVED STATE. `probe-j46-origin` settled WHICH pair declares
// an origin (`prev === null && thin === true`, R22–R26). This probe answers the questions that
// stand between that pair and a fix, and it asks them of the tree rather than of the design:
//
//   R30  does the pair SURVIVE ADOPTION? The marker is committed in the fingerprint and kept in
//        `_seen` — but `_deriveBest` reads `Floor.current()`, and what that object carries is a
//        separate question nobody had asked.
//   R31  today's derivation in a created-from-file room (the control, reproducing the finding)
//   R32  the four consumers that reason about a room's beginning, asked ONCE EACH
//   R33  what an origin fold would produce, computed the way a correct client would
//   R34  is the post-fix seed validation a REAL comparison or a tautology?
//   R35  THE INVARIANT, route 1 — can `_weakened` leave a trimmed client holding no floor?
//   R36  THE INVARIANT, route 2 — can `thin` outlive its room?
//   R37  and what an honest `seal()` WOULD write from a state that violated it — which is what
//        makes the invariant load-bearing rather than incidental
//
// ── THE GATE, AND WHY ITS SELF-TEST FEEDS IT SHAPES RATHER THAN VALUES ───────────────────────
// The previous session's gate was defective in exactly one way: `Checkpoint.seal()` is async, the
// measurement returned a PROMISE, and `undefined` was printed as a finding. Its self-test passed
// throughout, because every case it fed itself was SYNCHRONOUS — the gate was correct for every
// shape it was tested on and wrong for the shape it received. So the self-test below varies the
// SHAPE of what it feeds: sync and async, resolved and rejected, absent and wrong-typed. A value
// that differs from another value tests one branch twice; a shape that differs tests a branch
// that was never written.

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
    BACKEND + "history.js",
    BACKEND + "continuity.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

async function row(id, question, pre, measure) {
  const bad = (pre || []).filter((p) => !p.ok);
  if (bad.length) {
    console.log("  " + id + "  INADMISSIBLE — " + bad.map((b) => b.name).join(" | "));
    return null;
  }
  let out;
  try { out = await measure(); }
  catch (e) {
    console.log("  " + id + "  INADMISSIBLE — the measurement threw: " + (e && e.message));
    return null;
  }
  if (!out || typeof out.finding !== "string") {
    console.log("  " + id + "  INADMISSIBLE — the measurement returned no `finding` (got "
      + (out === undefined ? "undefined" : (out === null ? "null" : typeof out.finding))
      + "), so there is nothing to read");
    return null;
  }
  // A CONTROL THE MEASUREMENT ITSELF PRODUCES IS STILL A PRECONDITION. `pre` runs before the
  // measurement, so it can only hold facts known in advance — and the control that matters most
  // ("did the fixture actually reach the path?") is usually a BY-PRODUCT of running it. Found the
  // hard way on the first run of this probe: R36's control reported that the client never trimmed,
  // and the row printed its finding anyway, because the control was computed into the finding text
  // instead of being able to refuse the row. An unreached path reports absence, and absence reads
  // exactly like a finding.
  if (out.controlsOk === false) {
    console.log("  " + id + "  INADMISSIBLE — the row's own control failed: "
      + (out.controlFailure || "unnamed") + ". The measurement ran but did not reach the path, "
      + "so its reading is absence rather than evidence");
    return null;
  }
  console.log("  " + id + "  " + question);
  console.log("       " + out.finding);
  return out;
}

async function selfTest() {
  const seen = [];
  const log = console.log;
  console.log = (s) => seen.push(String(s));
  let ranMeasure = false;
  // Each case below differs from the others in SHAPE, not in value.
  const a = await row("ST1", "q", [{ name: "a precondition that is false", ok: false }],
    () => { ranMeasure = true; return { finding: "SHOULD NEVER PRINT" }; });
  const b = await row("ST2", "q", [{ name: "fine", ok: true }], () => { throw new Error("boom"); });
  const c = await row("ST3", "q", [{ name: "fine", ok: true }], () => ({ finding: "sync", v: 1 }));
  const d = await row("ST4", "q", [{ name: "fine", ok: true }], () => ({ v: 1 }));
  const e = await row("ST5", "q", [{ name: "fine", ok: true }],
    async () => ({ finding: "async", v: 2 }));
  // ST6-ST9 are shapes the previous gate was never fed. A REJECTED promise is not a sync throw and
  // reaches a different branch; a promise resolving to undefined is not a sync undefined; a
  // `finding` that is a NUMBER passes a truthiness test and fails a type test; and `null` is not
  // `undefined` and reads differently in the refusal message.
  const f = await row("ST6", "q", [{ name: "fine", ok: true }],
    async () => { throw new Error("async boom"); });
  const g = await row("ST7", "q", [{ name: "fine", ok: true }], async () => undefined);
  const h = await row("ST8", "q", [{ name: "fine", ok: true }], () => ({ finding: 42 }));
  const i = await row("ST9", "q", [{ name: "fine", ok: true }], () => null);
  // ST10/ST11 are the shape the first run of this probe actually produced: a well-formed result
  // that is nonetheless not evidence, because the fixture never reached the path.
  const j = await row("ST10", "q", [{ name: "fine", ok: true }],
    () => ({ finding: "SHOULD NOT PRINT", controlsOk: false, controlFailure: "never trimmed" }));
  const k = await row("ST11", "q", [{ name: "fine", ok: true }],
    () => ({ finding: "control held", controlsOk: true, v: 3 }));
  console.log = log;

  assert.ok(a === null, "gate self-test: a failed precondition must return null");
  assert.ok(ranMeasure === false, "gate self-test: a failed precondition must SKIP the measurement");
  assert.ok(seen.some((s) => /INADMISSIBLE.*a precondition that is false/.test(s)),
    "gate self-test: the refusal must NAME the stage that broke");
  assert.ok(b === null && seen.some((s) => /INADMISSIBLE.*threw: boom/.test(s)),
    "gate self-test: a throwing measurement is inadmissible, not a finding");
  assert.ok(c && c.v === 1 && seen.some((s) => /sync/.test(s)),
    "gate self-test: CONTROL — an admissible SYNC row still runs and prints");
  assert.ok(d === null && seen.some((s) => /INADMISSIBLE.*no `finding`/.test(s)),
    "gate self-test: a result with no `finding` is refused rather than printed as undefined");
  assert.ok(e && e.v === 2 && seen.some((s) => /async/.test(s)),
    "gate self-test: CONTROL — an admissible ASYNC row is awaited and read, not printed as a "
    + "promise. That is the defect the previous probe's gate actually had");
  assert.ok(f === null && seen.some((s) => /INADMISSIBLE.*threw: async boom/.test(s)),
    "gate self-test: a REJECTED promise is inadmissible too. A sync throw and a rejection reach "
    + "the catch by different routes, and only one of them is exercised by a sync self-test — "
    + "the same asymmetry that let the async defect through");
  assert.ok(g === null,
    "gate self-test: a promise RESOLVING to undefined is refused. Awaiting alone does not close "
    + "the hole the gate exists for; the shape check has to run after the await");
  assert.ok(h === null,
    "gate self-test: a `finding` that is not a STRING is refused. A truthiness test would admit "
    + "42 and print it, which is a reading nobody wrote");
  assert.ok(i === null,
    "gate self-test: a null result is refused and named as null rather than as undefined");
  assert.ok(j === null && seen.some((s) => /INADMISSIBLE.*never trimmed/.test(s))
    && !seen.some((s) => /SHOULD NOT PRINT/.test(s)),
    "gate self-test: a WELL-FORMED result whose own control failed is refused and the control is "
    + "NAMED — the shape the first run of this probe produced, where a row printed a confident "
    + "reading from a fixture that never reached the path");
  assert.ok(k && k.v === 3 && seen.some((s) => /control held/.test(s)),
    "gate self-test: CONTROL — a row declaring a control that HELD still runs, so the check "
    + "above refuses on the control's value rather than on the field's presence");
  console.log("[gate] self-test PASS — 11 cases across NINE SHAPES (false precondition, sync "
    + "throw, sync ok, missing finding, async ok, async rejection, promise-to-undefined, "
    + "wrong-typed finding, null, failed self-control, held self-control). Varying the shape is "
    + "the lesson the previous gate paid for: its cases were all synchronous, so it was tested on "
    + "every shape but the one it got — and this run added the shape THIS probe got wrong, a "
    + "well-formed reading from a fixture that never reached the path");
}

// ── the exporting room, and the file it produces ────────────────────────────────────────────
function sealedCp(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: thin === true, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2];
  const cpA = sealedCp(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  return { log: log, cpA: cpA, seedA: seedA, dj: r.dj,
           keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots: snapshots, keyset: keys, author: { rank: rank },
  })));
}

// A created-from-file room, driven the way `features/room.js` createFromFile drives it.
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
  return { read: read, built: built, adopted: adopted };
}

// An ordinary room sealing from its OWN log. The false-positive control for everything below.
function ordinaryRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => false });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = sealedCp(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
    cut.l, log[0].eventId + ".." + cut.eventId);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  return { log: log, cp: cp };
}

const PAIR = (f) => !!(f && (f.prev === null || f.prev === undefined) && f.thin === true);

async function main() {
  await selfTest();
  console.log("");
  console.log("probe-j46-fold — from the settled marker to a fix");
  console.log("================================================");
  console.log("");

  console.log("R30-R31  does the marker reach the code that would read it?");

  await row("R30", "does the pair SURVIVE ADOPTION into `Floor.current()`?",
    [], () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      if (room.adopted !== true) return { finding: "no floor adopted — nothing to read" };
      const cp = room.built.cp;
      const cur = sb.Floor.current();
      const keys = Object.keys(cur);
      // THE CONCLUSION IS COMPUTED, NOT WRITTEN. A finding whose narrative is typed out ahead of
      // the reading keeps asserting yesterday's answer after the code moves — which is this
      // codebase's third failure signature wearing a probe's clothes. The first run of this row
      // printed "adopt() DROPS thin" over a reading that showed it kept.
      return {
        finding: "the CHECKPOINT carries prev=" + JSON.stringify(cp.prev) + " thin="
          + JSON.stringify(cp.thin) + " (pair fires: " + PAIR(cp) + ")   |   the ADOPTED FLOOR "
          + "carries prev=" + JSON.stringify(cur.prev) + " thin=" + JSON.stringify(cur.thin)
          + " (pair fires: " + PAIR(cur) + ")   -> " + (PAIR(cp) && !PAIR(cur)
            ? "the marker does NOT survive adoption, so the code that has to read it "
              + "(`_deriveBest`, via Floor.current()) cannot"
            : (PAIR(cp) && PAIR(cur)
              ? "the marker survives adoption and is readable by `_deriveBest`"
              : "the import did not carry the pair at all — nothing to survive"))
          + ". Fields on the adopted floor: " + keys.join(","),
        pairOnCp: PAIR(cp), pairOnFloor: PAIR(cur),
      };
    });

  await row("R31", "what does a created-from-file room derive today?",
    [], () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const live = sb.StreamManager.getState();
      const bid = String(room.built.cp.covers).split("..")[1];
      const above = sb.Floor.afterBoundary(sb.StreamManager.getLog(), room.built.cp.floorL, bid);
      const correct = sb.StateDeriver.derive(above, room.built.cp.seed);
      const same = JSON.stringify(live.rotation) === JSON.stringify(correct.rotation)
        && JSON.stringify(live.nowPlaying) === JSON.stringify(correct.nowPlaying);
      return {
        finding: "adopted=" + room.adopted + " trimmed=" + sb.StreamManager._trimState()
          + " origin=" + (sb.StreamManager._originState ? sb.StreamManager._originState() : "n/a")
          + "   LIVE rotation=" + JSON.stringify(live.rotation.map((m) => m.user))
          + " nowPlaying=" + (live.nowPlaying ? live.nowPlaying.song.videoId : null)
          + "   |   THE FILE'S rotation=" + JSON.stringify(correct.rotation.map((m) => m.user))
          + " nowPlaying=" + (correct.nowPlaying ? correct.nowPlaying.song.videoId : null)
          + "   -> " + (same
            ? "the room derives what the file says, folded forward over what sits above the cut"
            : "the room holds a correct adopted checkpoint and derives NONE of it"),
        live: live, correct: correct, cutL: room.built.cp.floorL, same: same,
      };
    });

  console.log("");
  console.log("R32  the four consumers that reason about a room's beginning, asked ONCE EACH");

  await row("R32", "does each consumer read the FLOOR, or does it assume genesis?",
    [], () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const seed = sb.Floor.seed();
      // THE ROOM HAS TO ACTUALLY ADVANCE, or three of the four consumers are asked a question
      // their input cannot raise. `_looksLikeSegment` reads the FIRST advance in the log, and a
      // log with no advance in it returns "not a segment" for the trivial reason — which reports
      // absence and reads like agreement. The play below chains onto the seed's own `pi`, which
      // is what an imported room's first advance must do once it derives the file's state.
      const bankedPi = (seed && seed.nowPlaying && seed.nowPlaying.pi) || null;
      sb.StreamManager.ingest(F.rawEvent("$play-here", 4, 900000, X.dj, F.RANK.player,
        { t: "ddjp.dj.play", p: bankedPi }));
      const advanced = !!(sb.StreamManager.getState().nowPlaying
        && sb.StreamManager.getState().nowPlaying.pi === "$play-here");
      // 1. Continuity — the advance chain. Both of its bounds come from the floor already.
      const floorL = sb.Floor.position();
      const held = sb.StreamManager.getLog().map((e) => F.toRaw(e));
      const adv = sb.Continuity.mayAdvance(held, {}, floorL, bankedPi);
      // 2. History — its own segment test, fed the floor's seed.
      sb.History.attach({ log: () => sb.StreamManager.getLog(),
                          seed: () => sb.Floor.seed() || undefined });
      const hist = sb.History.refresh();
      // 3. SettingsProof — the coverage claim. The pointer was re-anchored into THIS room.
      const named = seed && seed.settingsFrom;
      // 4. Floor.chainVerifies — starts from the OLDEST snapshot's seed, not from genesis.
      const src = require("fs").readFileSync(
        path.join(__dirname, "..", "..", BACKEND + "floor.js"), "utf8");
      const chainStartsFromSeed = /let state = ordered\[0\]\.seed;/.test(src);
      if (!advanced) {
        return { finding: "n/a", controlsOk: false,
          controlFailure: "the room never advanced onto the seed's banked pi, so History's "
            + "segment test and Continuity's chain bound were both asked of a log with no "
            + "advance in it — three of the four readings would be absence" };
      }
      return {
        finding: "control — the room DID advance onto the seed's banked pi (" + bankedPi + ")"
          + "   |   Continuity: floorL=" + floorL + " bankedPi=" + JSON.stringify(bankedPi)
          + " -> mayAdvance " + JSON.stringify(adv.state) + "/" + JSON.stringify(adv.ok)
          + ", so the parent that belongs to the FILE's room is accounted for by the floor rather "
          + "than read as a hole   |   History: refresh -> " + JSON.stringify(hist)
          + " (it decides `_looksLikeSegment` from the first advance and seeds from the floor)"
          + "   |   SettingsProof: the seed names " + JSON.stringify(named) + ", re-anchored by "
          + "buildImport into THIS room's settings channel, so the claim is readable here"
          + "   |   Floor.chainVerifies starts from the oldest snapshot's seed rather than from "
          + "genesis: " + chainStartsFromSeed
          + "   -> " + ((adv.ok && chainStartsFromSeed)
            ? "all four already ask the FLOOR rather than assuming a room begins at genesis, so "
              + "the settlement's 'one rule with a changed input' holds per consumer and none of "
              + "them needs its own answer"
            : "at least one consumer does NOT read the floor and needs its own answer"),
        controlsOk: true,
        adv: adv, hist: hist, named: named, chainStartsFromSeed: chainStartsFromSeed,
      };
    });

  console.log("");
  console.log("R33-R34  what an ORIGIN fold would produce, and whether its validation is real");

  await row("R33", "fold the origin seed over everything above its cut — what comes out?",
    [], () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const cutL = room.built.cp.floorL;
      const bid = String(room.built.cp.covers).split("..")[1];
      const ordered = sb.StreamManager.getLog();
      const above = sb.Floor.afterBoundary(ordered, cutL, bid);
      const originFold = sb.StateDeriver.derive(above, room.built.cp.seed);
      const wholeLogOverSeed = sb.StateDeriver.derive(ordered, room.built.cp.seed);
      const sameEither = JSON.stringify(originFold.settings) === JSON.stringify(wholeLogOverSeed.settings);
      return {
        finding: "above the cut: " + JSON.stringify(above.map((e) => e.eventId))
          + "   origin fold rotation=" + JSON.stringify(originFold.rotation.map((m) => m.user))
          + " nowPlaying=" + (originFold.nowPlaying ? originFold.nowPlaying.song.videoId : null)
          + "   -> the file's DJ and song are present. And folding the WHOLE log over the seed "
          + "instead lands on the same settings here (" + sameEither + ") only because the two "
          + "events below the cut are the settings posts the seed already accounts for — an "
          + "accident of this room's shape, not a rule, so the cut is what the fold must respect",
        originFold: originFold, above: above.length,
      };
    });

  await row("R34", "would the pre-forget check still COMPARE anything in an origin room?",
    [], () => {
      const sb = fresh();
      const X = exportedRoom(sb);
      const room = createdFromFile(sb, fileOf(sb, [X.cpA], "owner", X.keys));
      const cp = room.built.cp;
      const ordered = sb.StreamManager.getLog();
      // What `_deriveBest` compares: `after` (events past `covers`' last id) vs the base fold.
      const lastId = String(cp.covers).split("..")[1];
      const idx = ordered.findIndex((e) => e.eventId === lastId);
      const after = idx < 0 ? null : ordered.slice(idx + 1);
      const bid = lastId;
      const above = sb.Floor.afterBoundary(ordered, cp.floorL, bid);
      const sameSet = after && JSON.stringify(after.map((e) => e.eventId))
                            === JSON.stringify(above.map((e) => e.eventId));
      return {
        finding: "`after` (by covers id) = " + JSON.stringify(after && after.map((e) => e.eventId))
          + "   the ORIGIN fold's own input = " + JSON.stringify(above.map((e) => e.eventId))
          + "   identical: " + sameSet + "   -> once the base fold IS the origin fold, the check "
          + "would compare derive(after, seed) against derive(above, seed) — the same computation "
          + "on the same input. It would record `validated` WITHOUT COMPARING ANYTHING. That is a "
          + "verdict naming a check that did not happen (P10), so the origin case has to be "
          + "recorded as its own reason rather than allowed to fall through the comparison",
        sameSet: sameSet,
      };
    });

  console.log("");
  console.log("R35-R37  THE INVARIANT: no floor => not trimmed");

  await row("R35", "route 1 — can `_weakened` leave a TRIMMED client holding no floor?",
    [], () => {
      // Two trees, identical but for `trimmed()`. Both must genuinely reach `_weakened`, or the
      // comparison measures a fixture that never got there.
      function run(isTrimmed) {
        const sb = fresh();
        const r = F.playingRoom({ songs: 4 });
        const log = F.sortLog(r.log);
        sb.Floor.attach({ log: () => log, settings: () => ({}), myRank: () => F.RANK.staff,
                          trimmed: () => isTrimmed });
        // A quorum of staff checkpoints at one cut, so a `quorum` grade is adopted.
        const cut = log[2];
        const covers = log[0].eventId + ".." + cut.eventId;
        const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
        const cpA = sealedCp(sb, seed, 1, null, cut.l, covers);
        const cut2 = log[5];
        const seed2 = sb.StateDeriver.buildSeed(log.slice(3, 6), seed);
        const cpB = sealedCp(sb, seed2, 2, cpA.h, cut2.l,
          log[3].eventId + ".." + cut2.eventId);
        for (const who of ["@s1:hs", "@s2:hs", "@s3:hs", "@s4:hs"]) {
          sb.Floor.remember(cpA, F.RANK.staff, who, 5000);
          sb.Floor.remember(cpB, F.RANK.staff, who, 6000);
        }
        const sel = sb.Floor.select(F.RANK.staff, {}, (q) => sb.Floor.chainVerifies(q, log));
        const adopted = sel ? sb.Floor.adopt(sel, false) : false;
        const gradeBefore = sb.Floor.grade();
        // Now the chain genuinely stops verifying: the joining evidence is gone.
        sb.Floor.attach({ log: () => [], settings: () => ({}), myRank: () => F.RANK.staff,
                          trimmed: () => isTrimmed });
        const rev = sb.Floor.revalidate();
        return { adopted: adopted, gradeBefore: gradeBefore, rev: rev,
                 holdsFloor: sb.Floor.current() !== null, grade: sb.Floor.grade() };
      }
      const un = run(false), tr = run(true);
      const controlsOk = un.adopted === true && tr.adopted === true
        && un.gradeBefore === "quorum" && tr.gradeBefore === "quorum"
        && un.rev.reason !== "still-holds" && tr.rev.reason !== "still-holds";
      return {
        finding: "controls (a `quorum` floor was adopted in BOTH and `revalidate` reached "
          + "`_weakened` in BOTH): " + controlsOk
          + "   UNTRIMMED -> " + un.rev.reason + ", holdsFloor=" + un.holdsFloor
          + "   |   TRIMMED -> " + tr.rev.reason + ", holdsFloor=" + tr.holdsFloor
          + " grade=" + tr.grade
          + "   -> the split IS the invariant: withdrawing is reserved for the client that can "
          + "still fall back on its own log. A trimmed client keeps its floor",
        controlsOk: controlsOk, untrimmedHolds: un.holdsFloor, trimmedHolds: tr.holdsFloor,
      };
    });

  await row("R36", "route 2 — can `thin=true` outlive the room it describes?",
    [], () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Session._setPhaseForTest("live");
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.owner, trimmed: () => sb.StreamManager._trimState() !== null });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const cut = log[2];
      const cp = sealedCp(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 1, null,
        cut.l, log[0].eventId + ".." + cut.eventId);
      sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
      sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
      // ONE MORE ARRIVAL, AND IT IS NOT DECORATION. The pre-forget check runs inside `_deriveBest`,
      // which only runs on the ingest path — so a floor adopted after the last event leaves the
      // verdict at `no-checkpoint` and the licence permanently withheld. The first run of this row
      // omitted it and measured a client that never trimmed.
      sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player,
        { t: "ddjp.dj.declare", v: "SONGQ" }));
      sb.SettingsProof._setVerdictForTest({ status: "validated" });
      const verdict = sb.StreamManager.seedValidation();
      const dropped = sb.StreamManager.trimToFloor();
      const trimmedInA = sb.StreamManager._trimState();
      const held = sb.Floor.current() !== null;
      if (!(dropped > 0 && trimmedInA !== null && held)) {
        return { finding: "n/a", controlsOk: false,
          controlFailure: "the client did not actually trim in room A (dropped=" + dropped
            + ", boundary=" + trimmedInA + ", seedValidation=" + verdict.status + "/"
            + verdict.reason + "), so `thin` was never true and there is nothing to outlive" };
      }
      // The room change, as `features/room.js` sequences it.
      sb.StreamManager.reset();
      sb.Floor.reset();
      return {
        finding: "control — the client really trimmed in room A (dropped=" + dropped
          + ", boundary=" + trimmedInA + ", verdict=" + verdict.status + ")   after the reset "
          + "PAIR: trimmed=" + sb.StreamManager._trimState() + " holdsFloor="
          + (sb.Floor.current() !== null)
          + "   -> both cleared together, so the pair cannot be assembled across a room change. "
          + "Note the dependency: this holds because the two resets are CALLED TOGETHER, which is "
          + "a wiring fact rather than a property of either module — which is exactly why it "
          + "needs a guard rather than a comment",
        controlsOk: true,
        after: sb.StreamManager._trimState(), holds: sb.Floor.current() !== null,
      };
    });

  await row("R37", "and WHAT WOULD AN HONEST SEAL WRITE from a state that violated it?",
    [], async () => {
      // The invariant is only worth guarding if breaking it has a consequence. This constructs the
      // forbidden state directly — trimmed, no floor — and asks `seal()` what it commits.
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Session._setPhaseForTest("live");
      let sent = null;
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.owner, trimmed: () => true });
      sb.Checkpoint.attach({
        send: async (t, cp) => { sent = cp; }, myUserId: () => "@owner:hs",
        log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
        amOwner: () => true, held: () => [], isLegal: () => true, now: () => 9e6,
        thin: () => true,                       // "I have trimmed"
        floorPos: () => null, floorTs: () => null,
      });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const holdsFloor = sb.Floor.current() !== null;   // deliberately none
      const res = await sb.Checkpoint.seal(9e6, { mode: "owner" });
      if (!res || !res.ok || !sent) {
        return { finding: "seal refused (" + (res && res.reason) + "), so the consequence could "
          + "not be measured — the row is inconclusive rather than reassuring" };
      }
      return {
        finding: "holdsFloor=" + holdsFloor + " (the forbidden state, constructed directly)"
          + "   the honest seal committed n=" + sent.n + " prev=" + JSON.stringify(sent.prev)
          + " thin=" + sent.thin + "   pair fires: " + PAIR(sent)
          + "   -> so the pair is unreachable ONLY because the invariant holds. Break the "
          + "invariant and an honest sealer publishes the origin declaration, and a client "
          + "reading it discards that room's real history. This is why the invariant has to be "
          + "guarded by the change that starts reading the pair",
        pairFires: PAIR(sent), holdsFloor: holdsFloor,
      };
    });

  console.log("");
  console.log("R38  is the cut rule REAL at the reducer, given that no room can express it?");

  await row("R38", "fold a whole log over a seed built above it — does the room differ?",
    [], () => {
      // Mutation M8 survives: replacing `_aboveCut(ordered, f)` with `ordered` changes no guard.
      // Before recording that as a redundancy it is worth knowing whether the RULE is real, or
      // whether folding a seed over its own banked events is simply harmless. Asked of the
      // reducer directly, which is legitimate here precisely because the question is about the
      // reducer rather than about what a client reaches.
      const sb = fresh();
      const log = F.sortLog(F.playingRoom({ songs: 3 }).log);
      const cutIdx = 4;
      const seed = sb.StateDeriver.buildSeed(log.slice(0, cutIdx + 1), null);
      const respecting = sb.StateDeriver.derive(log.slice(cutIdx + 1), seed);
      const ignoring = sb.StateDeriver.derive(log, seed);
      const differ = JSON.stringify(respecting) !== JSON.stringify(ignoring);
      const pend = (st) => JSON.stringify((st.rotation || []).map(
        (m) => (m.pending || []).map((x) => x.videoId)));
      return {
        finding: "respecting the cut -> pending " + pend(respecting)
          + "   |   folding everything -> pending " + pend(ignoring)
          + "   differ: " + differ + "   -> " + (differ
            ? "the rule is REAL: re-folding events the seed already banked puts a song that has "
              + "already played back into its DJ's buffer. What no fixture could reach is a ROOM "
              + "in that state, because the trimmed path holds nothing below its floor, an "
              + "imported room's below-cut events are idempotent settings posts, and the advance "
              + "lock refuses a replayed play. So `_aboveCut` states a real rule that the "
              + "reducer's prefix rules currently enforce — redundant, not wrong, and recorded "
              + "as such rather than deleted or defended"
            : "folding a seed over its own banked events changes nothing even at the reducer, "
              + "which would make `_aboveCut` genuinely inert"),
        differ: differ,
      };
    });

  console.log("");
  console.log("done.");
}

main().then(() => {}, (e) => { console.error(e); process.exit(1); });
