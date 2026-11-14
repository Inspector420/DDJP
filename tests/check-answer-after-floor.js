// tests/check-answer-after-floor.js
// SUBJECT: backends/backend1/streammanager.js, backends/backend1/statederiver.js
// WALL: AN ACT IS ANSWERED FROM THE SAME FOLD AS THE ROOM (owner's live log, `ddjp_537`): votes read "a song the room doesn't
//   know" and their latches cleared, because `_refusalFor` re-derived the held log with NO seed — after a save point or a trim
//   the held log starts at a floor, so that fold refused the plays. Refusals now come from the fold that is the room.
//   PART A — a bot room opened from a save point: a vote, a save, a skip and a join, each without a refusal (answered yes).
//   PART B — the same after a decentralized trim.      Both: a genuinely refused act (a vote for no such play) is still refused.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[answer-after-floor] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"];
const MIN = 60000, T0 = 1.7e12;
// ── A — a bot room opened from a save point ──
{
  const sb = loadInContext(FILES, {}), D = sb.B2StreamManager, B1 = sb.B1StreamManager;
  D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
  const P = sb.Ranks.levelOf("player"), O = sb.Ranks.levelOf("owner");
  let l = 0;
  const rel = (body, actor, rank) => { l++; return { event_id: "$e" + l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
    content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor: actor, rank: rank, src: "$i" + l, at: null })) } }; };
  for (const r of [rel({ t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }, "@o:hs", O), rel({ t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d1:hs", P),
                   rel({ t: "ddjp.dj.join", v: "vidBBBBBBBB" }, "@d2:hs", P), rel({ t: "ddjp.dj.play", p: null }, "@bot:hs", O)]) D.ingest(r);
  const log = B1.getLog(), last = log[log.length - 1];
  const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
  l++; D.ingest({ event_id: "$cp", type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN, content: { body: JSON.stringify(Object.assign({}, c, { l: l })) } });
  D.openFromSavePoint();
  const pi = B1.getState().nowPlaying && B1.getState().nowPlaying.pi;
  ok(B1.getLog().length === 0 && !!pi, "A PREMISE — opened from a save point: the held log is empty, a song is playing", { held: B1.getLog().length, pi });
  const acts = [["vote", rel({ t: "ddjp.dj.vote", p: pi, dv: 1 }, "@v:hs", P)], ["save", rel({ t: "ddjp.dj.save", p: pi }, "@v:hs", P)],
                ["join", rel({ t: "ddjp.dj.join", v: "vidCCCCCCCC" }, "@d3:hs", P)]];
  for (const [, r] of acts) D.ingest(r);
  for (const [k, r] of acts) ok(B1.refusalOf(r.event_id) === null, "A: after the save point, a " + k + " is not refused — answered yes", B1.refusalOf(r.event_id));
  ok(B1.getState().counts[pi] && B1.getState().counts[pi].votes === 1, "A: and the vote counted", B1.getState().counts[pi]);
  const skip = rel({ t: "ddjp.dj.skip", p: pi }, "@d1:hs", P); D.ingest(skip);
  ok(B1.refusalOf(skip.event_id) === null, "A: a skip of the playing song is not refused — answered yes", B1.refusalOf(skip.event_id));
  const bad = rel({ t: "ddjp.dj.vote", p: "$nosuchplay", dv: 1 }, "@v2:hs", P); D.ingest(bad);
  ok(B1.refusalOf(bad.event_id) !== null, "A CONTROL: a vote for a play that does not exist is still refused — answered no", B1.refusalOf(bad.event_id));
}
// ── B — a decentralized room after a trim ──
{
  const sb = loadInContext(FILES, {}); const SM = sb.B1StreamManager, P = F.RANK.player, O = F.RANK.owner;   // the decentralized engine itself (StreamManager is the bot door here)
  sb.Floor.reset(); SM.reset();
  let l = 1;
  SM.ingest(F.toRaw(F.reducerEvent("$s", l, T0, "@o:hs", O, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() })));
  const add = (id, body, who) => { l++; SM.ingest(F.toRaw(F.reducerEvent(id, l, T0 + l * MIN, who, P, body))); return id; };
  add("$j1", { t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d1:hs"); add("$j2", { t: "ddjp.dj.join", v: "vidBBBBBBBB" }, "@d2:hs");
  add("$p1", { t: "ddjp.dj.play", p: null }, "@d1:hs");
  for (let k = 0; k < 6; k++) add("$x" + k, { t: "ddjp.dj.vote", p: "$p1" }, "@w" + k + ":hs");
  const ord = SM.getLog(), cut = ord[ord.length - 1];
  sb.Floor._setTrustedForTest(F.real(sb.Floor, { n: 1, h: "h1", floorL: cut.l, grade: "verified", covers: ord[0].eventId + ".." + cut.eventId,
    seed: sb.StateDeriver.buildSeed(ord.slice(0, ord.indexOf(cut) + 1), undefined), prev: null, thin: false }));
  const dropped = SM.trimToFloor();
  ok(dropped > 0 && SM.getLog().length === 0, "B PREMISE — a licensed trim forgot everything held", { dropped, held: SM.getLog().length });
  const ids = { vote: add("$v", { t: "ddjp.dj.vote", p: "$p1" }, "@v:hs"), save: add("$sv", { t: "ddjp.dj.save", p: "$p1" }, "@v:hs"), join: add("$j3", { t: "ddjp.dj.join", v: "vidCCCCCCCC" }, "@d3:hs") };
  for (const k of Object.keys(ids)) ok(SM.refusalOf(ids[k]) === null, "B: after the trim, a " + k + " is not refused — answered yes", SM.refusalOf(ids[k]));
  const sk = add("$sk", { t: "ddjp.dj.skip", p: "$p1" }, "@d1:hs");
  ok(SM.refusalOf(sk) === null, "B: a skip of the playing song is not refused — answered yes", SM.refusalOf(sk));
  const bad = add("$bad", { t: "ddjp.dj.vote", p: "$nosuchplay" }, "@v2:hs");
  ok(SM.refusalOf(bad) !== null, "B CONTROL: a vote for a play that does not exist is still refused", SM.refusalOf(bad));
}
if (failed) { console.log("[answer-after-floor] " + failed + " failure(s)"); process.exit(1); }
console.log("[answer-after-floor] PASS — after a save point or a trim, an act is answered from the same fold as the room: votes, saves, skips and joins are not refused, and a genuinely refused act still is (" + asserts + " assertions)");
