// tools/probes/probe-j71-arrival-order.js — STUDY ONLY (`ddjp_561`, J71). The owner's two opens judged the same plays differently:
// v505 accepted l=94 with "now playing nothing" and then the p=null l=98; v509 accepted l=94 "now playing ckmQq8Bf39g" and refused
// l=98 ("stale parent ... head is $UCIt3U"). This drives one room through the real StreamManager in two arrival orders: the join
// that puts a song in the rotation arriving before, or after, the plays positioned after it.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/streammanager.js"];
const T0 = 1.79e12, MIN = 60000;
const S = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(), {});
const ev = (id, l, ts, who, rank, c) => F.reducerEvent(id, l, ts, who, rank, c);
const room = [ev("$set", 1, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S }),
  ev("$jA", 2, T0 + MIN, "@a:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "vidSONGAAAAA" }),
  ev("$pA", 3, T0 + 2 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: null }),                     // A starts
  ev("$jK", 4, T0 + 3 * MIN, "@k:hs", F.RANK.player, { t: "ddjp.dj.join", v: "ckmQq8Bf39g" }),           // THE JOIN (the one some devices lacked)
  ev("$p94", 5, T0 + 12 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: "$pA" }),                  // "l=94": ends A, starts the next song if any
  ev("$jB", 6, T0 + 13 * MIN, "@b:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "GtLkXIzMQck" }),
  ev("$p98", 7, T0 + 34 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: null })];                  // "l=98": p=null, 1260 s later (past the ceiling)
function drive(order, label) {
  const sb = loadInContext(FILES, {}); const logs = []; for (const lv of ["info", "warn", "debug", "error"]) sb.Logger[lv] = (m) => logs.push(String(m));
  sb.Floor.reset(); sb.StreamManager.reset();
  const atIngest = {};
  for (const id of order) { const e = room.find((x) => x.eventId === id); sb.StreamManager.ingest(F.toRaw(e));
    if (id === "$p94" || id === "$p98") { const st = sb.StreamManager.getState(); atIngest[id] = { legal: sb.StreamManager.isLegal(id), nowPlaying: st.nowPlaying ? (st.nowPlaying.song || {}).videoId : "nothing" }; } }
  const st = sb.StreamManager.getState();
  console.log(label);
  console.log("  at ingest:  l=94 " + (atIngest.$p94.legal ? "ACCEPTED" : "REFUSED") + " | now playing " + atIngest.$p94.nowPlaying + ";  l=98 " + (atIngest.$p98.legal ? "ACCEPTED" : "REFUSED") + " | now playing " + atIngest.$p98.nowPlaying);
  console.log("  after all:  l=94 " + (sb.StreamManager.isLegal("$p94") ? "ACCEPTED" : "REFUSED") + ";  l=98 " + (sb.StreamManager.isLegal("$p98") ? "ACCEPTED" : "REFUSED") + " | now playing " + (st.nowPlaying ? (st.nowPlaying.song || {}).videoId : "nothing"));
  const lines = logs.filter((m) => /ORDER ddjp\.dj\.play|stale parent/.test(m)).map((m) => "    log: " + m.slice(0, 150));
  for (const x of lines.slice(0, 4)) console.log(x);
}
drive(["$set", "$jA", "$pA", "$jK", "$p94", "$jB", "$p98"], "ORDER 1 — the join arrives in position order (v509's fold, which held it):");
drive(["$set", "$jA", "$pA", "$p94", "$jB", "$p98", "$jK"], "ORDER 2 — the join arrives LAST, after the plays positioned after it (v505's fold, which judged without it):");
