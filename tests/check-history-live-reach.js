// tests/check-history-live-reach.js
// SUBJECT: backends/backend1/history.js, backends/backend1/streammanager.js, backends/backend1/matrixbridge.js, features/room.js
// WALL: SONG HISTORY REACHES THE ROOM'S START LIVE, ACROSS MOVE-ONS, IN A TAB THAT OPENED FROM A SAVE POINT (owner's re-test,
//   `ddjp_535`): both apps opened from save point n=3 with the stored table restored, then moved on live to n=4, and the
//   reach lost "reaches the beginning" — the app accepted a re-add 2.5 minutes after its play. The held log was covered from
//   its first event, so each save point's own position stayed a hole until the next move-on. It is now covered from just
//   above the adopted floor (`StreamManager.heldFrom`), which also makes a REAL gap below the floor show as a hole to fill.
//   PART A — the live sequence: restored table, opened from n=3, moved on to n=4, live songs after — one range from 0.
//   PART B — a table stored BELOW the floor: the summarised stretch is reported as a hole, and "complete" is not claimed.
//   PART C — the app refuses the re-add (Room.canQueue) with a 10-minute cooldown, across the move-on.
//   PART D — the bridge attaches `heldFrom` to history.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[history-live-reach] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"];
const MIN = 60000, T0 = 1.7e12, COOL = 10 * MIN;
function tab(extra) {
  const H = {};
  const sb = loadInContext(FILES.concat(extra || []), extra ? { Queue: { recentHistory: () => sb.History.recent(), historyReach: () => sb.History.coverage() },
    ServerClock: { serverNow: () => H.now }, MatrixBridge: { getUserId: () => "@me:hs" } } : {});
  sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.History.reset();
  // As the bridge attaches it: the held log, its seed (the door's adopted save point first), and where it is complete from.
  sb.History.attach({ log: () => sb.B1StreamManager.getLog(), heldFrom: () => sb.B1StreamManager.heldFrom(),
    seed: () => { const f = sb.B1StreamManager.adoptedFloor ? sb.B1StreamManager.adoptedFloor() : null; return f ? f.seed : undefined; } });
  sb._H = H; return sb;
}
function room(storeBelowFloor) {
  const ALL = []; let n = 0, l = 0, prev = null;
  const A = tab(), P = A.Ranks.levelOf("player"), O = A.Ranks.levelOf("owner");
  const rel = (body, actor, rank) => { l++; const r = { event_id: "$e" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
    content: { body: JSON.stringify(Object.assign({}, body, { l, actor, rank, src: "$i" + n, at: null })) } }; ALL.push(r); return r; };
  const seal = (sb) => { const B1 = sb.B1StreamManager, log = B1.getLog(), last = log[log.length - 1];
    const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
    l++; const r = { event_id: "$cp" + l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN, content: { body: JSON.stringify(Object.assign({}, c, { l })) } }; ALL.push(r); return r; };
  const song = (feedTo, k) => { const out = [rel({ t: "ddjp.dj.join", v: "vid" + String(k).padStart(8, "0") }, "@d" + (k % 3) + ":hs", P)];
    const r = rel({ t: "ddjp.dj.play", p: prev }, "@bot:hs", O); prev = r.event_id; out.push(r);
    for (const x of out) for (const sb of feedTo) sb.B2StreamManager.ingest(x); };
  const S = Object.assign(A.StateDeriver.defaultSettings(), { repeatCooldownMs: COOL });
  A.B2StreamManager.ingest(rel({ t: "ddjp.room.settings", s: S }, "@o:hs", O));
  A.History.ingest(A.B1StreamManager.getLog(), undefined, { from: 0, to: 1 });   // the backfill reached the room's start
  let k = 0, snap = null;
  for (let round = 1; round <= 3; round++) {
    for (let s = 0; s < 4; s++) { song([A], k++); if (round === 3 && storeBelowFloor && s === 1) { A.History.refresh(); snap = A.History.snapshot(); } }   // stored two songs short of the floor
    A.B2StreamManager.ingest(seal(A)); if (round === 1) A.B2StreamManager.openFromSavePoint();
  }
  for (let s = 0; s < 2; s++) song([A], k++);
  A.History.refresh(); if (!snap) snap = A.History.snapshot();       // stored past the floor (the owner's case) unless asked otherwise
  return { A, ALL, rel, seal, song, snap, kRef: () => k, inc: () => k++, n3: ALL.filter((r) => /^\$cp/.test(r.event_id))[2], allAfter: (r) => ALL.slice(ALL.indexOf(r) + 1) };
}
// ── A — the live sequence ──
{
  const R = room(false), B = tab(["features/room.js"]);
  B.History.restore(R.snap);
  B.B2StreamManager.ingest(R.n3); for (const r of R.allAfter(R.n3)) B.B2StreamManager.ingest(r); B.B2StreamManager.openFromSavePoint();
  B.History.refresh();
  let c = B.History.coverage();
  ok(c.complete === true && c.ranges.length === 1, "A: opened from n=3 with the stored table restored, the reach goes back to the room's start", c.ranges);
  for (let s = 0; s < 3; s++) { const before = R.ALL.length; R.song([R.A], R.inc()); for (const r of R.ALL.slice(before)) B.B2StreamManager.ingest(r); }
  const s4 = R.seal(B); B.B2StreamManager.ingest(s4);
  ok(B.B2StreamManager.lastMoveOn() && B.B2StreamManager.lastMoveOn().ok === true, "A PREMISE — the tab moved on live to n=4", B.B2StreamManager.lastMoveOn());
  for (let s = 0; s < 2; s++) { const r1 = R.rel({ t: "ddjp.dj.join", v: "late" + s + "aaaaaa" }, "@d1:hs", B.Ranks.levelOf("player")); B.B2StreamManager.ingest(r1); }
  B.History.refresh(); c = B.History.coverage();
  ok(c.complete === true && c.ranges.length === 1 && c.topFromL === 0, "A: after moving on to n=4 and more events, the reach STILL goes back to the room's start — no hole at n=4's position", c.ranges);
  // ── C — the app refuses the re-add ──
  const live = B.B1StreamManager.getState().nowPlaying, played = B.History.recent().find((h) => h && h.videoId && (!live || h.pi !== live.pi));   // the newest ENDED play, minutes ago
  B._H.now = T0 + (JSON.parse(s4.content.body).l + 2) * MIN;
  const v = B.Room.canQueue(played.videoId, B._H.now);
  ok(v && v.ok === false && v.code === "repeat-cooldown", "C: the app refuses re-adding a song played minutes ago, across the move-on (10-minute cooldown)", v);
}
// ── B — a table stored BELOW the floor ──
{
  const R = room(true), B = tab();
  B.History.restore(R.snap);
  const stored = B.History.coverage().ranges;
  B.B2StreamManager.ingest(R.n3); for (const r of R.allAfter(R.n3)) B.B2StreamManager.ingest(r); B.B2StreamManager.openFromSavePoint();
  B.History.refresh();
  const c = B.History.coverage(), holes = B.History.holes(), floorL = JSON.parse(R.n3.content.body).floorL;
  ok(c.complete === false && holes.length === 1 && holes[0][0] === stored[0][1] + 1 && holes[0][1] === floorL,
    "B: the stretch the save point summarised (and this tab never saw) is a HOLE to fill — not a false 'reaches the beginning'", { stored, ranges: c.ranges, holes, floorL });
}
// ── D — the bridge attaches heldFrom ──
{
  const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  const i = MB.indexOf("History.attach({"), j = MB.indexOf("});", i);
  ok(i > 0 && /heldFrom: \(\) => \{ try \{ return StreamManager\.heldFrom \? StreamManager\.heldFrom\(\) : null; \}/.test(MB.slice(i, j)), "D: the bridge attaches the held log's start to history");
}
if (failed) { console.log("[history-live-reach] " + failed + " failure(s)"); process.exit(1); }
console.log("[history-live-reach] PASS — song history reaches the room's start live across move-ons in a tab opened from a save point; a real gap below the floor is a hole to fill; and the app refuses a re-add inside the cooldown (" + asserts + " assertions)");
