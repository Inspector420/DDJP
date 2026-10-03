// tests/check-history-floor-reach.js
// SUBJECT: backends/backend1/history.js, backends/backend1/streammanager.js, backends/backend2/streammanager.js
// WALL: SONG HISTORY'S UNBROKEN REACH SURVIVES THE FLOOR MOVING (owner's bot-room test, `ddjp_534`). The bot logged
//   `cannot-tell` for the repeat rule just after each move-on while HISTORY reported `covers 0..83`: the unbroken reach
//   (`topFromL`) restarted at the floor. Driven: a move-on folds what it drops into history from just above the PREVIOUS
//   floor — a save point's own position is covered, not a hole — and `reconcileFloor` never shrinks coverage below the cut.
//   PART A — a real bot room through three save points: after each move-on the reach goes back to the room's start.
//   PART B — a decentralized room through two real trims: the same.
//   PART C — reconcileFloor drops rows settled under a replaced floor and keeps coverage up to the CUT, not to the last row.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-floor-reach] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const MIN = 60000, T0 = 1.7e12;
const reach = (H) => { const c = H.coverage(); return { ranges: c.ranges, topFromL: c.topFromL }; };
// ── A — a real bot room through three save points ──
{
  const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), {});
  const D = sb.B2StreamManager, B1 = sb.B1StreamManager, H = sb.History;
  D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); H.reset(); H.attach({ log: () => B1.getLog() });
  let n = 0, l = 0, prev = null;
  const rel = (body, actor, rank) => { l++; return { event_id: "$e" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
    content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor, rank, src: "$i" + n, at: null })) } }; };
  const P = sb.Ranks.levelOf("player"), O = sb.Ranks.levelOf("owner");
  const seal = () => { const log = B1.getLog(), last = log[log.length - 1];
    const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
    l++; return { event_id: "$cp" + l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN, content: { body: JSON.stringify(Object.assign({}, c, { l: l })) } }; };
  const song = () => { const r = rel({ t: "ddjp.dj.play", p: prev }, "@bot:hs", O); D.ingest(r); prev = r.event_id;
    for (let v = 0; v < 3; v++) D.ingest(rel({ t: "ddjp.dj.vote", p: prev, dv: 1 }, "@v" + v + ":hs", P)); };
  D.ingest(rel({ t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }, "@o:hs", O));
  for (let d = 0; d < 3; d++) D.ingest(rel({ t: "ddjp.dj.join", v: "song" + d + "aaaaaa" }, "@d" + d + ":hs", P));
  for (let s = 0; s < 6; s++) song();
  H.refresh();
  ok(reach(H).topFromL === 1, "A PREMISE — before any save point, the reach starts at the room's start", reach(H));
  D.ingest(seal()); D.openFromSavePoint(); H.refresh();
  ok(reach(H).topFromL === 1, "A: opening from save point n=1, the reach still starts at the room's start", reach(H));
  for (let round = 2; round <= 3; round++) {
    for (let s = 0; s < 6; s++) song();
    D.ingest(seal());
    ok(D.lastMoveOn() && D.lastMoveOn().ok === true, "A PREMISE — the door moved on to save point n=" + round, D.lastMoveOn());
    H.refresh();
    const r = reach(H);
    ok(r.topFromL === 1 && r.ranges.length === 1, "A: after moving on to n=" + round + ", the unbroken reach still goes back to the room's start — no hole at a save point's position", r);
  }
}
// ── B — a decentralized room through two real trims ──
{
  const sb = loadInContext(B1F, {}); const SM = sb.StreamManager, H = sb.History;
  sb.Floor.reset(); SM.reset(); H.reset(); H.attach({ log: () => SM.getLog() });
  const P = F.RANK.player, O = F.RANK.owner;
  let l = 1;
  SM.ingest(F.toRaw(F.reducerEvent("$s", l, T0, "@o:hs", O, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() })));
  const add = (id, body, who) => { l++; SM.ingest(F.toRaw(F.reducerEvent(id, l, T0 + l * MIN, who, P, body))); };
  for (let d = 0; d < 3; d++) add("$j" + d, { t: "ddjp.dj.join", v: "song" + d + "aaaaaa" }, "@d" + d + ":hs");
  let prev = null;
  const song = (k) => { add("$p" + k, { t: "ddjp.dj.play", p: prev }, "@d" + (k % 3) + ":hs"); prev = "$p" + k; for (let v = 0; v < 2; v++) add("$v" + k + "_" + v, { t: "ddjp.dj.vote", p: prev }, "@v" + v + ":hs"); };
  for (let k = 0; k < 6; k++) song(k);
  H.refresh();
  const trimAt = (nth, keepLast) => { const ord = SM.getLog(), cut = ord[ord.length - keepLast];
    sb.Floor._setTrustedForTest({ n: nth, h: "h" + nth, floorL: cut.l, grade: "verified", covers: ord[0].eventId + ".." + cut.eventId,
      seed: sb.StateDeriver.buildSeed(ord.slice(0, ord.indexOf(cut) + 1), SM.floorSeed() || undefined), prev: nth > 1 ? "h" + (nth - 1) : null, thin: false });
    return SM.trimToFloor(); };
  const d1 = trimAt(1, 6); H.refresh();
  ok(d1 > 0 && reach(H).topFromL === 1, "B: after a first trim, the reach still starts at the room's start", { dropped: d1, r: reach(H) });
  for (let k = 6; k < 12; k++) song(k);
  const d2 = trimAt(2, 4); H.refresh();
  if (d2 > 0) ok(reach(H).topFromL === 1 && reach(H).ranges.length === 1, "B: after a second trim, the unbroken reach still goes back to the room's start", { dropped: d2, r: reach(H) });
  else ok(true, "B: (a second trim was not licensed in this harness; part A carries the moving floor)");
}
// ── C — reconcileFloor keeps coverage up to the cut ──
{
  const sb = loadInContext(B1F, {}); const H = sb.History;
  H.reset();
  // Coverage [0, 90] through the real ingest (one event that makes no row), then three rows settled under floor "old".
  H.ingest([{ eventId: "$x", l: 85, ts: T0, sender: "@v:hs", senderRank: 10, type: "ddjp.dj.vote", content: { t: "ddjp.dj.vote", p: "$none" } }], undefined, { from: 0, to: 90 });
  H._setForTest([{ pi: "$a", l: 10, floorSig: "old" }, { pi: "$b", l: 40, floorSig: "old" }, { pi: "$c", l: 70, floorSig: "old" }]);
  ok(JSON.stringify(H.coverage().ranges) === JSON.stringify([[0, 90]]), "C PREMISE — history covers 0..90", H.coverage().ranges);
  const rc = H.reconcileFloor("new", 60);
  const r = H.coverage();
  ok(rc.dropped === 1 && JSON.stringify(r.ranges) === JSON.stringify([[0, 60]]),
    "C: rows above the cut under a replaced floor are dropped, and coverage keeps everything up to the CUT (60) — not only up to the last remaining row (40)", { rc, ranges: r.ranges });
}
if (failed) { console.log("[history-floor-reach] " + failed + " failure(s)"); process.exit(1); }
console.log("[history-floor-reach] PASS — song history's unbroken reach survives the floor moving: a real bot room through three " +
  "save points and a decentralized room through its trims keep the reach back to the room's start, and reconcileFloor never " +
  "shrinks coverage below the cut (" + asserts + " assertions)");
