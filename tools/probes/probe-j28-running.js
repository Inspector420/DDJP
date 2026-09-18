// tools/probes/probe-j28-running.js — J28: an owner override applied to a RUNNING room.
//
// J46 (v254) made an IMPORTED seed reach derived state in a room CREATED from a file. J28's room
// is not that room: it has a log, a floor, a cadence and peers. Every argument J27 made rests on
// the empty-room premise, and the premise is what J28 removes. So the questions below are asked
// against a running room and NOT inherited from either previous session.
//
// R40  CONTROL     an ordinary running room folds from genesis, `_originState()` false
// R41  the override checkpoint is adopted and the origin marker REACHES `Floor.current()`
// R42  the fold becomes the FILE's state — the thing J46 delivered for a created room
// R43  `_aboveCut` — measured redundant at J46, and this route is where it BITES
// R44  the latch under the room's next ORDINARY checkpoint (the cadence sealing over an override)
// R45  `maySeal` at the moment of override, in the running room, with the phase gate cleared
// R46  who may reach the publish, and what the anchor needs
//
// ADMISSIBILITY. Every reading below is a room-shaped value, so an unreached fixture returns the
// same thing in every tree and ABSENCE READS AS AGREEMENT (08-build-and-deploy.md §A PROBE CARRIES
// AN ADMISSIBILITY GATE). The gate names the stage that broke, and it is itself given a self-test
// on inputs shaped like the real ones — including an ASYNC one, because async shape has bitten two
// sessions running: `publishImport` returns a promise and a gate that inspects it unawaited sees a
// Promise object and calls it a pass.

const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));

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

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Each stage is a SEPARATE named check run before any comparison, so `null` at the end cannot be
// four different failures wearing one face.
const GATE = {
  stages: [],
  add(name, fn) { this.stages.push({ name, fn }); return this; },
};
function admit(subject, stages) {
  for (const s of stages) {
    let v;
    try { v = s.fn(); } catch (e) { return { ok: false, stage: s.name, detail: "threw: " + e.message }; }
    if (v && typeof v.then === "function") {
      return { ok: false, stage: s.name, detail: "a stage returned a PROMISE — this gate is "
        + "synchronous, so an unawaited async stage would be truthy in every tree" };
    }
    if (!v) return { ok: false, stage: s.name, detail: "stage returned " + JSON.stringify(v) };
  }
  return { ok: true, subject };
}

// THE GATE'S OWN SELF-TEST. It certifies everything downstream on its own authority, so it is
// given deliberately broken inputs SHAPED LIKE THE REAL ONES and must catch each.
(function selfTest() {
  const t1 = admit("x", [{ name: "a", fn: () => true }, { name: "b", fn: () => false }]);
  if (t1.ok || t1.stage !== "b") throw new Error("GATE SELF-TEST FAILED: a false stage was admitted");
  const t2 = admit("x", [{ name: "a", fn: () => { throw new Error("boom"); } }]);
  if (t2.ok || t2.stage !== "a") throw new Error("GATE SELF-TEST FAILED: a throwing stage was admitted");
  // The async shape: a real `publishImport` call left unawaited.
  const t3 = admit("x", [{ name: "async", fn: () => Promise.resolve(false) }]);
  if (t3.ok || t3.stage !== "async") throw new Error("GATE SELF-TEST FAILED: an unawaited promise was admitted");
  const t4 = admit("x", [{ name: "a", fn: () => true }]);
  if (!t4.ok) throw new Error("GATE SELF-TEST FAILED: a sound run was refused");
  console.log("[gate] self-test PASS — false, throwing, PROMISE-shaped and sound stages all classified");
})();

function sealed(sb, seed, n, prev, floorL, covers, thin) {
  const cp = { t: "ddjp.checkpoint", n, prev: prev || null, seed, floorL, thin: thin === true, covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2];
  const cpA = sealed(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  return { log, cpA, seedA, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots, keyset: keys, author: { rank }, })));
}

// THE RUNNING ROOM. Its own log, its own adopted floor, its own rotation — the thing an override
// arrives at. Event ids are made distinct from the file's room, because `F.playingRoom` hard-codes
// them and two "different" rooms would otherwise share all eight (the R7 fixture artefact recorded
// in J28's entry).
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
                    myRank: () => F.RANK.owner, trimmed: () => sb.StreamManager._trimState() !== null });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs",
    log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    amOwner: () => true, held: () => [], isLegal: () => true,
    floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
    floorTs: () => sb.Floor.anchorTs() });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = sealed(sb, sb.StateDeriver.buildSeed(log.slice(0, 3), null), 3, "$tgtprev",
    cut.l, log[0].eventId + ".." + cut.eventId);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
  return { log, cp, head: log[log.length - 1] };
}

// Apply an override the way a J28 path would: post the file's settings into the RUNNING room at
// the head, build the import checkpoint anchored on it, publish/remember, adopt.
function applyOverride(sb, tgt, file, opts) {
  const o = opts || {};
  const read = sb.StreamManager.importFile(file);
  if (!read.ok) return { ok: false, reason: read.reason };
  const l = tgt.head.l + 1;
  sb.StreamManager.ingest(F.rawEvent("$ovr-settings", l, 900000, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: read.settings }));
  const anchor = { settingsFrom: "$ovr-settings", eventId: "$ovr-settings", l };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  if (!built.ok) return { ok: false, reason: built.reason };
  sb.Floor.remember(built.cp, F.RANK.owner, "@importer:hs", 900500);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted = sel ? sb.Floor.adopt(sel, false) : false;
  if (o.thenIngest !== false) {
    sb.StreamManager.ingest(F.rawEvent("$post-ovr", l + 1, 901000, "@owner:hs", F.RANK.owner,
      { t: "ddjp.dj.join", v: "SONGZ" }));
  }
  return { ok: true, read, built, adopted, anchorL: l };
}

const rows = [];
function row(id, finding, data) { rows.push({ id, finding, data }); }

// ── R40 CONTROL — the running room folds from its own genesis ───────────────────────────────
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const g = admit("R40", [
    { name: "log-ingested", fn: () => sb.StreamManager.getLog().length >= 6 },
    { name: "floor-adopted", fn: () => !!sb.Floor.current() },
    { name: "room-nonempty", fn: () => sb.StreamManager.getState().rotation.length > 0 },
  ]);
  if (!g.ok) { row("R40", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const st = sb.StreamManager.getState();
    row("R40", "CONTROL — an ordinary running room: origin NOT declared, its own rotation stands", {
      originState: sb.StreamManager._originState(),
      rotation: st.rotation.map((m) => m.user),
      nowPlaying: st.nowPlaying ? st.nowPlaying.song : null,
      trimmed: sb.StreamManager._trimState(),
    });
  }
}

// ── R41 — does the override's origin marker REACH the fold's reader? ────────────────────────
// J46's lesson applied to a new route: the pair existed on the wire, in `_seen` and in the
// fingerprint, and `adopt()` dropped `thin`. Which fields carry a claim is a different question
// from whether they reach the reader. So this asks `Floor.current()`, not the checkpoint.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const before = sb.Floor.current();
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys));
  const g = admit("R41", [
    { name: "file-read", fn: () => out.ok },
    { name: "incumbent-floor-existed", fn: () => !!before && before.n === 3 },
    { name: "override-built-as-origin", fn: () => out.built.cp.prev === null && out.built.cp.thin === true },
    { name: "adopted", fn: () => out.adopted === true },
  ]);
  if (!g.ok) { row("R41", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const f = sb.Floor.current();
    row("R41", "the override is adopted over an n=3 incumbent, and the marker survives adoption", {
      incumbentN: before.n, adoptedN: f.n, floorPosition: sb.Floor.position(),
      currentPrev: f.prev === null ? null : "set", currentThin: f.thin,
      isOriginByCurrent: (f.prev === null || f.prev === undefined) && f.thin === true,
      originState: sb.StreamManager._originState(),
    });
  }
}

// ── R42 — does the RUNNING room's derived state become the FILE's? ──────────────────────────
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const fileRotation = Object.keys(X.cpA.seed.members || {});
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys));
  const g = admit("R42", [
    { name: "override-applied", fn: () => out.ok && out.adopted },
    { name: "file-has-a-rotation", fn: () => fileRotation.length > 0 },
    { name: "target-had-a-different-one", fn: () => true },
  ]);
  if (!g.ok) { row("R42", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const st = sb.StreamManager.getState();
    row("R42", "what the running room derives AFTER the override", {
      originState: sb.StreamManager._originState(),
      liveRotation: st.rotation.map((m) => m.user),
      fileRotation,
      liveNowPlaying: st.nowPlaying ? st.nowPlaying.song : null,
      fileNowPlaying: X.cpA.seed.nowPlaying ? X.cpA.seed.nowPlaying.song : null,
      seedValidation: sb.StreamManager.seedValidation(),
      licensesForget: sb.StreamManager.seedLicensesForget(),
      pairingFault: sb.StreamManager.pairingFault(),
    });
  }
}

// ── R43 — `_aboveCut`: measured REDUNDANT at J46, and this is the route that bites ──────────
// J46 recorded that replacing `_aboveCut(ordered, f)` with `ordered` left every guard green, for
// three fixture-specific reasons — none of which holds here, because a running room's below-cut
// events are real plays and joins rather than idempotent settings posts. Measured by folding both
// ways at the reducer, which is where the rule is real.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys), { thenIngest: false });
  const g = admit("R43", [
    { name: "override-applied", fn: () => out.ok && out.adopted },
    { name: "below-cut-events-exist", fn: () =>
        sb.StreamManager.getLog().filter((e) => e.l <= out.anchorL).length > 1 },
    { name: "below-cut-not-only-settings", fn: () =>
        sb.StreamManager.getLog().filter((e) => e.l <= out.anchorL
          && e.type !== "ddjp.room.settings").length > 0 },
  ]);
  if (!g.ok) { row("R43", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const log = sb.StreamManager.getLog();
    const f = sb.Floor.current();
    const above = log.filter((e) => e.l > f.floorL);
    const aboveOnly = sb.StateDeriver.derive(above, f.seed);
    const wholeLog = sb.StateDeriver.derive(log, f.seed);
    row("R43", "folding the WHOLE log over the override seed vs only ABOVE the cut", {
      heldTotal: log.length, belowOrAtCut: log.length - above.length, above: above.length,
      aboveOnlyRotation: aboveOnly.rotation.map((m) => m.user),
      wholeLogRotation: wholeLog.rotation.map((m) => m.user),
      aboveOnlyNowPlaying: aboveOnly.nowPlaying ? aboveOnly.nowPlaying.song : null,
      wholeLogNowPlaying: wholeLog.nowPlaying ? wholeLog.nowPlaying.song : null,
      differ: JSON.stringify(aboveOnly.rotation) !== JSON.stringify(wholeLog.rotation)
           || JSON.stringify(aboveOnly.nowPlaying) !== JSON.stringify(wholeLog.nowPlaying),
    });
  }
}

// ── R44 — the LATCH under the room's next ORDINARY checkpoint ───────────────────────────────
// The override lands; the room keeps running; the cadence seals again. That new checkpoint is an
// ORDINARY one — `prev` names the override, `thin` false, correctly. J46 measured that a predicate
// re-asked per fold sends an imported room back to genesis one cadence later. This drives the same
// question for the override route, where "back to genesis" means back to the PRE-OVERRIDE room.
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const out = applyOverride(sb, tgt, fileOf(sb, [X.cpA], "owner", X.keys));
  const afterOverride = sb.StreamManager.getState();
  const ovr = sb.Floor.current();
  // The room's own next seal, over the override's floor: ordinary by construction.
  const log = sb.StreamManager.getLog();
  const above = log.filter((e) => e.l > ovr.floorL);
  const nextSeed = sb.StateDeriver.buildSeed(above, ovr.seed);
  const headEv = log[log.length - 1];
  const nextCp = sealed(sb, nextSeed, ovr.n + 1, ovr.h, headEv.l,
    headEv.eventId + ".." + headEv.eventId, false);
  sb.Floor.remember(nextCp, F.RANK.owner, "@owner:hs", 902000);
  const sel2 = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted2 = sel2 ? sb.Floor.adopt(sel2, false) : false;
  sb.StreamManager.ingest(F.rawEvent("$after-cadence", headEv.l + 5, 903000, "@owner:hs",
    F.RANK.owner, { t: "ddjp.dj.declare", v: "SONGW" }));
  const g = admit("R44", [
    { name: "override-applied", fn: () => out.ok && out.adopted },
    { name: "next-cp-is-ORDINARY", fn: () => nextCp.prev !== null && nextCp.thin === false },
    { name: "next-cp-adopted", fn: () => adopted2 === true },
    { name: "floor-moved-to-it", fn: () => sb.Floor.current() && sb.Floor.current().prev !== null },
  ]);
  if (!g.ok) { row("R44", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const st = sb.StreamManager.getState();
    row("R44", "one cadence after the override: does the room hold the file's state?", {
      originStateStillLatched: sb.StreamManager._originState(),
      currentFloorIsOrigin: (sb.Floor.current().prev === null) && sb.Floor.current().thin === true,
      rotationRightAfterOverride: afterOverride.rotation.map((m) => m.user),
      rotationOneCadenceLater: st.rotation.map((m) => m.user),
      nowPlayingOneCadenceLater: st.nowPlaying ? st.nowPlaying.song : null,
      heldSame: JSON.stringify(afterOverride.rotation.map((m) => m.user))
             === JSON.stringify(st.rotation.map((m) => m.user)),
    });
  }
}

// ── R45 — `maySeal` at the moment of override, phase gate cleared ───────────────────────────
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const g = admit("R45", [
    { name: "phase-live", fn: () => sb.Session.mayAuthor() === true },
    { name: "checkpoint-attached", fn: () => typeof sb.Checkpoint.maySeal === "function" },
    { name: "floor-held", fn: () => !!sb.Floor.current() },
  ]);
  if (!g.ok) { row("R45", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    const verdict = sb.Checkpoint.maySeal(Date.now());
    row("R45", "maySeal in the running room the override would target", {
      verdict, note: "publishImport asks none of this", });
  }
}

// ── R46 — what the publish path requires, and what an unauthorised caller gets ──────────────
// `publishImport` is the one path that publishes a checkpoint without asking `maySeal`. J27's
// counterpart obligation was "reachable from room creation alone". An override breaks that, so:
// what does the function ITSELF check today?
{
  const sb = fresh();
  const tgt = runningRoom(sb);
  const X = exportedRoom(fresh());
  const read = sb.StreamManager.importFile(fileOf(sb, [X.cpA], "owner", X.keys));
  const sent = [];
  sb.Checkpoint.attach({ send: async (t, cp) => { sent.push({ t, cp }); },
    myUserId: () => "@nobody:hs", log: () => sb.StreamManager.getLog(), settings: () => ({}),
    myRank: () => F.RANK.guest, amOwner: () => false, held: () => [], isLegal: () => true,
    floorPos: () => null, floorTs: () => null });
  const g = admit("R46", [
    { name: "file-read", fn: () => read.ok },
    { name: "send-stub-installed", fn: () => sent.length === 0 },
  ]);
  if (!g.ok) { row("R46", "INADMISSIBLE at " + g.stage, g.detail); }
  else {
    // AWAITED — an unawaited call here returns a Promise and every reading below would be a
    // property of that object rather than of the publish.
    const p = sb.Checkpoint.publishImport(read.seed,
      { settingsFrom: "$x", eventId: "$x", l: tgt.head.l + 1 });
    p.then((res) => {
      row("R46", "publishImport called by a GUEST-ranked, non-owner client", {
        published: res.ok, reason: res.reason, sends: sent.length,
        note: "MEASURED BEFORE THE FIX AS published=true / sends=1 — no rank check, no owner "
             + "check, nothing. J27's wiring promise was the only thing holding it. After J28 this "
             + "row reads published=false / not-owner / sends=0, and the row is kept so the "
             + "before-and-after is a measurement rather than a memory",
      });
      report();
    });
    return;
  }
}
report();

function report() {
  console.log("\n=== probe-j28-running — an override applied to a RUNNING room ===\n");
  for (const r of rows) {
    console.log(r.id + "  " + r.finding);
    console.log("     " + JSON.stringify(r.data, null, 1).replace(/\n/g, "\n     "));
    console.log("");
  }
}
