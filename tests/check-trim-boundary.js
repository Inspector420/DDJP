// tests/check-trim-boundary.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: FORGETTING KEEPS AN EVENT THAT SHARES THE FLOOR'S POSITION AND SORTS AFTER ITS BOUNDARY (J73).
//
// A checkpoint folds every event up to and including its boundary in the fold's own order —
// position, then id — and `floorL` is the boundary's position. Two events can share a position
// (`l` is carried on the event, and concurrent sends collide), so an event AT `floorL` whose id
// sorts after the boundary is NOT in the seed. `tests/check-floor-boundary.js` recorded that
// `trimToFloor` disagreed ("recorded rather than fixed"); `tools/probes/probe-j73-trim-tie.js`
// drove it: with the licence granted, the trim dropped such an event and the trimmed client's queue
// differed from a reader holding everything. Ruling 1 (J73) allows no edge-case mistake in
// forgetting, so the rule now has one home for the drop: what `trimToFloor` keeps is exactly what
// `_aboveCut` folds.
//
// Every row compares against a REFERENCE READER that folded every event from the start
// (PILLARS §3), never against a second client. Controls prove each comparison can pass.
//   PART A — the trim keeps the same-position event that sorts after the boundary.
//   PART B — controls: the same event one position higher; the same tie under a floor that earns
//            no trim; and the boundary event itself still leaves (it IS in the seed).
//   PART C — after the trim, the ingest gate decides by id: a later arrival at the floor's position
//            sorting after the boundary is folded, one sorting before it is refused as banked.
//   PART D — the save-point door (`adoptFloor`, bot rooms) judges a SETTINGS event at the floor's
//            position by id too, in both fallbacks: a seed naming no settings event, and one whose
//            named event this client does not hold.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[trim-boundary] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  ], {});
}
const O = F.RANK.owner, P = F.RANK.player;
const join = (id, l, ts, who, v) => F.reducerEvent(id, l, ts, who, P, { t: "ddjp.dj.join", v: v });
const ROOM = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const roomOf = (st) => { const o = {}; for (const k of ROOM) o[k] = st[k]; return o; };
const same = (a, b) => JSON.stringify(roomOf(a)) === JSON.stringify(roomOf(b));
const who = (st) => (st.rotation || []).map((r) => r.user.split(":")[0]).join(",");

function shared(siblingL) {
  const S = tree().StateDeriver;
  return [
    F.reducerEvent("$a1", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() }),
    join("$b", 2, 2000, "@a:hs", "vidA0000001"),
    join("$c", 3, 3000, "@b:hs", "vidB0000001"),
    join("$m", 5, 5000, "@d:hs", "vidD0000001"),            // the boundary, at the floor
    join("$z", siblingL, 5001, "@c:hs", "vidC0000001"),     // same position, id after "$m"
    join("$q", 7, 7000, "@e:hs", "vidE0000001"),
  ];
}
function reference(log) {
  const R = tree(); R.Floor.reset(); R.StreamManager.reset();
  log.forEach((e) => R.StreamManager.ingest(F.toRaw(e)));
  return R.StreamManager.getState();
}
// The seed a checkpoint would carry: everything up to and including the boundary, in fold order.
function seedThrough(sb, boundaryId) {
  const ordered = sb.StreamManager.getLog();
  return sb.StateDeriver.buildSeed(ordered.slice(0, ordered.findIndex((e) => e.eventId === boundaryId) + 1), undefined);
}
function trimmed(log, grade, holdBack) {
  const D = tree(); D.Floor.reset(); D.StreamManager.reset();
  log.filter((e) => !holdBack || holdBack.indexOf(e.eventId) < 0).forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
  const seed = seedThrough(D, "$m");
  D.Floor._setTrustedForTest(F.real(D.Floor, { n: 1, h: "h1", floorL: 5, grade: grade, covers: "$a1..$m", seed: seed, prev: null, thin: false }));
  const dropped = D.StreamManager.trimToFloor();
  return { D, dropped, state: D.StreamManager.getState(), licence: D.StreamManager.seedValidation() };
}

// ── PART A — the trim keeps the same-position event after the boundary ──────────────────────
{
  const log = shared(5), ref = reference(log), t = trimmed(log, "verified");
  ok(t.licence.status === "validated" && t.dropped > 0,
    "A PREMISE — the licence must be granted and the trim must drop something, or this is not the production path",
    { licence: t.licence, dropped: t.dropped });
  ok(t.D.StreamManager.getLog().some((e) => e.eventId === "$z"),
    "A: an event AT the floor's position whose id sorts AFTER the boundary is not in the seed, so the trim must keep it",
    t.D.StreamManager.getLog().map((e) => e.eventId));
  ok(same(t.state, ref),
    "A: after the trim the client derives what a reader holding everything derives (ruling 1: no edge-case mistake in forgetting)",
    { reference: who(ref), trimmed: who(t.state) });
}
// ── PART B — controls ───────────────────────────────────────────────────────────────────────
{
  const logAbove = shared(6), tA = trimmed(logAbove, "verified");
  ok(tA.dropped > 0 && same(tA.state, reference(logAbove)),
    "B CONTROL: the same event one position higher is kept and matches — the comparison can pass", who(tA.state));
  const log = shared(5), tS = trimmed(log, "stale");
  ok(tS.dropped === 0 && same(tS.state, reference(log)),
    "B CONTROL: a floor that earns no trim drops nothing and matches — the floor alone is not what moves the answer", tS.dropped);
  const t = trimmed(log, "verified");
  ok(!t.D.StreamManager.getLog().some((e) => e.eventId === "$m" || e.eventId === "$c"),
    "B: the boundary event and everything before it STILL leave — they are in the seed, and keeping them would fold them twice",
    t.D.StreamManager.getLog().map((e) => e.eventId));
}
// ── PART C — after the trim, the gate decides by id ─────────────────────────────────────────
{
  const log = shared(5), ref = reference(log);
  const t = trimmed(log, "verified", ["$z"]);                 // $z had not arrived when the floor was adopted
  t.D.StreamManager.ingest(F.toRaw(log.find((e) => e.eventId === "$z")));
  ok(same(t.D.StreamManager.getState(), ref),
    "C: a same-position event arriving AFTER the trim, sorting after the boundary, is folded", who(t.D.StreamManager.getState()));
  const before = JSON.stringify(roomOf(t.D.StreamManager.getState()));
  t.D.StreamManager.ingest(F.toRaw(join("$k", 5, 5002, "@x:hs", "vidX0000001")));
  ok(JSON.stringify(roomOf(t.D.StreamManager.getState())) === before,
    "C CONTROL: one at the same position sorting BEFORE the boundary is refused as banked — the gate is not simply open", who(t.D.StreamManager.getState()));
}
// ── PART D — the save-point door judges a settings event at the floor's position by id ──────
{
  const S = tree().StateDeriver;
  const blob300 = Object.assign(S.defaultSettings(), { maxLen: 300 });
  const settingsAt5 = F.reducerEvent("$z", 5, 5001, "@owner:hs", O, { t: "ddjp.room.settings", s: blob300 });
  const base = [join("$b", 2, 2000, "@a:hs", "vidA0000001"), join("$m", 5, 5000, "@d:hs", "vidD0000001"),
                settingsAt5, join("$q", 7, 7000, "@e:hs", "vidE0000001")];
  // D1: a seed naming no settings event (`!sf`).
  {
    const ref = reference(base);
    ok(ref.settings.maxLen === 300, "D1 PREMISE — the reference reader applies the settings change", ref.settings.maxLen);
    const D = tree(); D.Floor.reset(); D.StreamManager.reset();
    base.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
    const seed = seedThrough(D, "$m");
    ok(seed.settingsFrom === null, "D1 PREMISE — the seed names no settings event", seed.settingsFrom);
    const r = D.StreamManager.adoptFloor({ floorL: 5, seed: seed, covers: "$b..$m" });
    ok(r.ok === true, "D1 PREMISE — the save point is adopted", r);
    ok(same(D.StreamManager.getState(), ref),
      "D1: a settings event at the save point's position sorting after its boundary is applied, not dropped as covered",
      { reference: ref.settings.maxLen, adopted: D.StreamManager.getState().settings.maxLen });
  }
  // D2: a seed naming a settings event this client does not hold (`!pos`).
  {
    const named = F.reducerEvent("$a0", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() });
    const full = [named].concat(base), ref = reference(full);
    const D = tree(); D.Floor.reset(); D.StreamManager.reset();
    full.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
    const seed = seedThrough(D, "$m");
    ok(seed.settingsFrom === "$a0", "D2 PREMISE — the seed names the genesis settings event", seed.settingsFrom);
    const H = tree(); H.Floor.reset(); H.StreamManager.reset();
    base.forEach((e) => H.StreamManager.ingest(F.toRaw(e)));     // this client never received "$a0"
    const r = H.StreamManager.adoptFloor({ floorL: 5, seed: seed, covers: "$a0..$m" });
    ok(r.ok === true, "D2 PREMISE — the save point is adopted", r);
    ok(same(H.StreamManager.getState(), ref),
      "D2: with the named settings event not held, a settings event at the save point's position sorting after its boundary is still applied",
      { reference: ref.settings.maxLen, adopted: H.StreamManager.getState().settings.maxLen });
  }
}

if (failed) { console.log("[trim-boundary] " + failed + " failure(s)"); process.exit(1); }
console.log("[trim-boundary] PASS — forgetting keeps an event that shares the floor's position and sorts after its " +
  "boundary (J73, ruling 1), at both doors that forget: the trim of a shared room and the save-point door of a bot " +
  "room. Every row compares with a reader that folded everything from the start, and controls show each comparison " +
  "can pass: the same event one position higher, a floor that earns no trim, the boundary event itself still leaving, " +
  "and an arrival before the boundary still refused (" + asserts + " assertions)");
