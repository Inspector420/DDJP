// tests/check-no-room-files.js
// SUBJECT: features/room.js, features/actions.js, core/backends.js, backends/backend1/capabilities.js,
//          backends/backend1/checkpointformat.js, backends/backend1/checkpoint.js, backends/backend1/floor.js,
//          backends/backend1/streammanager.js, backends/backend1/statederiver.js, backends/backend1/history.js,
//          backends/backend2/checkpoint.js, backends/backend2/streammanager.js, backends/backend2/runner.js,
//          index.html, app.js, ui/screens.js, ui/settings.js
//
// WALL: NO ROOM FILES, IN EITHER ROOM TYPE (J82; the owner's rulings 1, 2, 7 and 9).
//   Nothing saves a room to a file, creates a room from one, or restores one — and nothing READS what a restore once
//   wrote (ruling 9, B1): no origin latch, no restore anchor, no restart number, no carrier check, no confirmation. What
//   stays stays (ruling 2, B2): the automatic save points in both engines, `Floor.heldCheckpoints` (song history's chain),
//   `CheckpointFormat.laterInLog`, the bot engine's `floorChain`, `History.knowsFloor` and `Ranks.aboveLadder` (for REP).
//
//   A  THE CONTROLS ARE GONE: the lobby's create-from-file row and its note, the rooms' Saves button and the saves list, the
//      settings panel's "Restore from file" row — and the empty `#export-section` mount `check-import` used to pin.
//   B  THE VERBS ARE GONE, in BOTH room types, read from the running modules behind the real seam: `Room`, the `room.restore`
//      action and capability, the seam's file mode, each engine's import / export / plan / held list, the file format, the
//      restart, the restore builders, the bot's confirmation.
//   C  THE READING SIDE IS GONE (ruling 9, B1) — driven, not scanned:
//      C1 a settings event marked `restore: true` folds as any settings event (no restore-anchor refusal);
//      C2 a SHARED room: an owner's checkpoint with the old origin pair (`prev` null, `thin`) is an ordinary owner floor — its
//         seed is checked against the room's own fold, never accepted as a beginning (`origin-seed`), and licenses nothing when
//         it is not this room's;
//      C3 a BOT room: an origin pair carried by anyone is an ordinary save point, ordered by its count — no carrier check;
//      C4 a save point a restore-era build wrote (`era` committed) does not verify — rooms that hold one are remade.
//   D  WHAT STAYS: the save points in both engines seal and verify; a restart-0 save point hashes exactly as it always did
//      (the value `check-room-compat` pins); the kept readers exist.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const { world, OWNER, BOT } = require(path.join(__dirname, "_botroom.js"));
const ROOT = path.join(__dirname, "..");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[no-room-files] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// ── A — THE CONTROLS ARE GONE ─────────────────────────────────────────────────────────────────────────────────────────────
// TEXTUAL, because the page and its panels need a DOM to render; what they could only reach through the verbs is driven in B.
{
  const html = src("index.html"), app = src("app.js"), screens = src("ui/screens.js"), settings = src("ui/settings.js");
  for (const id of ["input-import-file", "btn-create-from-file", "import-note", "export-section"]) {
    ok(html.indexOf('id="' + id + '"') < 0, "A: the lobby has no `#" + id + "`");
  }
  ok(!/\.export-section\b/.test(html) && !/room-saves-btn/.test(html), "A: and no style for the saves list or its button");
  ok(!/createFromFile|btn-create-from-file|input-import-file/.test(app), "A: `app.js` wires no create-from-file control");
  ok(!/function savesButton\b|function renderExportSection\b|function _downloadJson\b|_savesWanted/.test(screens),
    "A: the room list draws no Saves button and no saves list, and nothing downloads a file");
  ok(/function openButton\(room\)/.test(screens), "A CONTROL: the owned room's Open button is still drawn");
  ok(!/room\.restore|Restore from a file|renderExportSection/.test(settings),
    "A: the settings panel draws no restore row and no saves section");
}

// ── B — THE VERBS ARE GONE, IN BOTH ROOM TYPES ────────────────────────────────────────────────────────────────────────────
for (const mode of ["backend1", "backend2"]) {
  const w = world({ mode: mode });
  const sb = w.sb, M = mode === "backend2" ? "bot room" : "shared room";
  for (const k of ["createFromFile", "overrideFromFile", "heldCheckpoints", "exportCheckpoint"]) {
    ok(sb.Room[k] === undefined, "B (" + M + "): `Room." + k + "` does not exist");
  }
  const d = sb.Actions.describe("room.restore");
  ok(sb.Actions.ACTIONS.indexOf("room.restore") < 0 && d && d.enabled === false && d.reason === "Unknown action",
    "B (" + M + "): `room.restore` is not an action", d);
  ok(sb.Capabilities.VERBS.indexOf("room.restore") < 0 && sb.Capabilities.TARGET_FREE.indexOf("room.restore") < 0,
    "B (" + M + "): nor a capability verb");
  const can = sb.Capabilities.can("room.restore", {}, { myId: OWNER, myRank: 100 });
  ok(can && can.permitted === false, "B (" + M + "): asked anyway, the room's owner is refused as for an unknown verb", can);
  ok(sb.Backends.forFileMode === undefined, "B (" + M + "): the seam maps no file mode to an engine");
  for (const k of ["importFile", "importCheckpoint", "planRestore", "exportCheckpoint", "heldCheckpoints", "_originState"]) {
    ok(sb.StreamManager[k] === undefined, "B (" + M + "): the bound engine has no `StreamManager." + k + "`");
  }
  ok(typeof sb.StreamManager.reset === "function" && typeof sb.StreamManager.adoptFloor === "function",
    "B CONTROL (" + M + "): the bound engine still answers `reset` and `adoptFloor`");
}
{
  const w = world({ mode: "backend2" }), sb = w.sb;
  for (const k of ["saveFile", "readFile", "filePrint", "FILE_VERSION", "FILE_MODES", "eraOf", "rootOf", "restartOf", "compareRestart"]) {
    ok(sb.CheckpointFormat[k] === undefined, "B: the format has no `" + k + "`");
  }
  for (const k of ["buildImport", "publishImport", "mayPublishImport"]) ok(sb.Checkpoint[k] === undefined, "B: `Checkpoint." + k + "` is gone");
  for (const k of ["restartOf", "bindingRestart"]) ok(sb.Floor[k] === undefined, "B: `Floor." + k + "` is gone");
  ok(sb.StateDeriver.isRestoreAnchor === undefined, "B: the reducer has no restore-anchor predicate");
  for (const k of ["restore", "isOrigin", "floorIsOwnerOrigin", "originSeen", "floorRestart", "restartOf", "floorId"]) {
    ok(sb.B2Checkpoint[k] === undefined, "B: `B2Checkpoint." + k + "` is gone");
  }
  for (const k of ["restoreAdopted", "CONFIRM_JOB", "_confirmOwed", "_keyBelow"]) ok(sb.B2Runner[k] === undefined, "B: the runner has no `" + k + "`");
  // THE ROOM'S START IS THE ONLY ORIGIN HISTORY RECORDS.
  sb.History.reset();
  sb.History.setOrigin({ l: 40, h: "hRestore", seed: { nowPlaying: { pi: "$x", song: { videoId: "v" } } } });
  ok(sb.History.origin() === null, "B: song history records no origin but the room's start", sb.History.origin());
  sb.History.setOrigin({ start: true, l: 0, h: "hFirst" });
  ok(sb.History.origin() && sb.History.origin().start === true, "B CONTROL: the room's start is still recorded", sb.History.origin());
}

// ── C — THE READING SIDE IS GONE (ruling 9, B1) ───────────────────────────────────────────────────────────────────────────
const B1 = "backends/backend1/";
function shared() {
  return loadInContext(["core/logger.js", B1 + "ranks.js", B1 + "consensushash.js", B1 + "trustpolicy.js", B1 + "statederiver.js",
    B1 + "checkpointformat.js", B1 + "dials.js", B1 + "session.js", B1 + "scheduler.js", B1 + "floor.js", B1 + "eventcache.js",
    B1 + "streammanager.js", B1 + "vouch.js", B1 + "checkpoint.js", B1 + "settingsproof.js"], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
// C1 — a settings event marked as a restore's anchor is a settings event.
{
  const sb = shared();
  const s = Object.assign(sb.StateDeriver.defaultSettings(), { maxLen: 777 });
  const st = sb.StateDeriver.derive([F.reducerEvent("$s", 1, 1000, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: s, restore: true })], null);
  ok(st.settings.maxLen === 777, "C1: a settings event carrying `restore: true` is applied like any other — no anchor is inert",
    st.settings.maxLen);
}
// C2 — A SHARED ROOM: an owner floor with the old origin pair (`prev` null, `thin`). The client holds the room's whole log and has
// not trimmed. Before J82 the pair DECLARED an origin: its seed was accepted as the room's beginning without being compared with
// anything (`validated / origin-seed`), which licensed forgetting below its cut. Now it is a floor like any other: its seed is
// checked against the room's own fold from the start, and a seed that is not this room's licenses nothing.
function sharedWithFloor(seedOf, thin) {
  const sb = shared();
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = quiet[k];
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    trimmed: () => sb.StreamManager._trimState() !== null });
  sb.Checkpoint.attach({ send: async () => {}, myUserId: () => "@owner:hs" });
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  const cut = log[2];
  const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seedOf(sb, log), floorL: cut.l, thin: thin, covers: log[0].eventId + ".." + cut.eventId };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
  const sel = sb.Floor.select(F.RANK.owner, {}, () => true);
  const adopted = !!(sel && sb.Floor.adopt(sel, false));
  sb.StreamManager.ingest(F.rawEvent("$settle", 40, 800000, "@dj:hs", F.RANK.player, { t: "ddjp.dj.declare", v: "SONGQ" }));
  return { sb: sb, adopted: adopted, v: sb.StreamManager.seedValidation(), licensed: sb.StreamManager.forgettingLicensed() };
}
{
  // A seed that is NOT this room — another room's rotation, the way a file carried one.
  const elsewhere = (sb) => sb.StateDeriver.buildSeed(F.sortLog(F.playingRoom({ songs: 2, dj: "@elsewhere:hs" }).log), null);
  const x = sharedWithFloor(elsewhere, true);
  ok(x.adopted, "C2 PREMISE: the owner's checkpoint with the origin pair is adopted as the floor, on authority");
  ok(x.v && x.v.status === "mismatched" && x.v.reason !== "origin-seed",
    "C2: its seed is checked against the room's own fold from the start, and one that is not this room's is MISMATCHED — never " +
    "`validated / origin-seed`", x.v);
  ok(x.licensed === false, "C2: so it licenses no forgetting below its cut", x.licensed);
  // CONTROL: the same pair over THIS room's own state at the cut validates as an ordinary floor does.
  const own = sharedWithFloor((sb, log) => sb.StateDeriver.buildSeed(log.slice(0, 3), null), true);
  ok(own.v && own.v.status === "validated" && own.v.reason !== "origin-seed",
    "C2 CONTROL: with this room's own state for a seed the same pair validates by the comparison, like any floor", own.v);
}
// C3 — A BOT ROOM: the origin pair, carried by anyone, is a save point like any other, ordered by its count.
{
  const sb = shared();
  const B2 = loadInContext([B1 + "consensushash.js", B1 + "checkpointformat.js", "backends/backend2/checkpoint.js"], {});
  const mk = (n, prev, thin, l) => {
    const cp = { t: "ddjp.checkpoint", n: n, prev: prev, seed: { s: n }, floorL: l, thin: thin, covers: "$a..$b" + n };
    cp.h = B2.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
    return cp;
  };
  const C = B2.B2Checkpoint;
  C.reset();
  const s1 = mk(1, null, false, 10);
  ok(C.observe(s1, { id: "$c1", l: 11 }).adopted === true, "C3 PREMISE: the room's first save point stands");
  const o = mk(2, null, true, 20);
  const r2 = C.observe(o, { id: "$c2", l: 21, owner: false });
  ok(r2.adopted === true && C.floor() === o, "C3: a save point with the old origin pair, carried by the bot, is adopted by its count — no carrier check", r2);
  const lower = mk(1, null, true, 30);
  const r3 = C.observe(lower, { id: "$c3", l: 31, owner: true });
  ok(r3.adopted === false && /moves forward/.test(String(r3.why)) && C.floor() === o,
    "C3: and one carried by the owner with a lower count does not stand over it — no restore replaces the room", r3);
  void sb;
}
// C4 — A SAVE POINT A RESTORE-ERA BUILD WROTE DOES NOT VERIFY. `ddjp_571`..`ddjp_575` committed `era` and `root` from restart 1;
// this build commits the six fields only, so such a save point's own fingerprint no longer matches it. Rooms that hold one were
// made by a restore or from a file, and are remade (J82; the owner: every supported room was remade at J81).
{
  const sb = shared();
  const body = { n: 1, prev: null, seed: { x: 1 }, floorL: 7, thin: true, covers: "$a..$b" };
  const restoreEra = Object.assign({}, body, { era: 1 });
  const cp = Object.assign({ t: "ddjp.checkpoint" }, restoreEra, { h: sb.ConsensusHash.contentHash(restoreEra) });
  ok(sb.CheckpointFormat.verify(cp) === false, "C4: a restart-1 save point (its `era` committed) does not verify");
  const plain = Object.assign({ t: "ddjp.checkpoint" }, body, { h: sb.ConsensusHash.contentHash(body) });
  ok(sb.CheckpointFormat.verify(plain) === true, "C4 CONTROL: the same body at restart 0 — six fields committed — verifies");
}

// ── D — WHAT STAYS (ruling 2; ruling 9, B2) ───────────────────────────────────────────────────────────────────────────────
{
  const sb = shared();
  // The value `check-room-compat` pins (CHECKPOINT_BASELINE.pinned): never-restored rooms hash as they always did.
  ok(sb.CheckpointFormat.fingerprint(1, "hp", { x: 1 }, 7, false, "$a..$b") === "B_8JmExzZgalgISNt2B8dHXmO7mRkWI8nDWGQlZHsh0",
    "D: a restart-0 save point hashes exactly as `ddjp_570` hashed it");
  ok(typeof sb.CheckpointFormat.laterInLog === "function" && typeof sb.Floor.heldCheckpoints === "function" &&
     typeof sb.Checkpoint.seal === "function" && typeof sb.Ranks.aboveLadder === "function",
    "D: `laterInLog`, `Floor.heldCheckpoints`, the shared seal and `Ranks.aboveLadder` stay");
  const w = world({ mode: "backend2" });
  ok(typeof w.sb.B2StreamManager.floorChain === "function" && typeof w.sb.History.knowsFloor === "function" &&
     typeof w.sb.B2Checkpoint.seal === "function", "D: the bot engine's seal and `floorChain`, and `History.knowsFloor`, stay");
  const out = w.sb.B2Checkpoint.seal({ s: 1 }, { isRunner: true, floorL: 5, covers: "$a" });
  ok(out && out.ok && out.cp.era === undefined && out.cp.root === undefined && w.sb.CheckpointFormat.verify(out.cp) === true,
    "D: the bot's save point is sealed with the six committed fields and verifies", out && out.cp && Object.keys(out.cp));
  void BOT;
}

if (failed) { console.log("[no-room-files] FAIL — " + failed + " of " + asserts + " assertions failed"); process.exit(1); }
console.log("[no-room-files] PASS — no room files in either room type (J82, " + asserts + " assertions). THE CONTROLS ARE GONE: the " +
  "lobby's create-from-file row, the Saves button and list, the restore row, the empty export mount. THE VERBS ARE GONE, read from " +
  "the running modules behind the real seam in both room types: `Room`'s four, the `room.restore` action and capability, the seam's " +
  "file mode, each engine's import, export, plan and held list, the file format, the restart, the restore builders and the bot's " +
  "confirmation; song history records no origin but the room's start. THE READING SIDE IS GONE (ruling 9, B1), driven: a restore " +
  "anchor folds as a settings event; a shared room's owner floor with the old origin pair is an ordinary floor, its seed checked " +
  "against the room's own fold and licensing nothing when it is not this room's; a bot room orders such a save point by its count, carried by anyone; a save point " +
  "a restore-era build wrote does not verify. WHAT STAYS stays: both engines seal, a restart-0 save point hashes as it always did, " +
  "and `laterInLog`, `Floor.heldCheckpoints`, `floorChain`, `History.knowsFloor` and `Ranks.aboveLadder` remain");
