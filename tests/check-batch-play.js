// tests/check-batch-play.js
// SUBJECT: backends/backend2/streammanager.js, backends/backend2/checkpoint.js, backends/backend1/streammanager.js, backends/backend1/history.js, backends/backend1/floor.js
// WALL: A SONG CHANGE THAT TRAVELS AS A BATCH MEMBER IS NAMED, REFERENCED, REMEMBERED AND FORGOTTEN EXACTLY AS A READER
//   HOLDING EVERYTHING DOES (J76, at the auditor's request). Under the gate the bot's own `ddjp.dj.play` may now travel
//   inside a `ddjp.batch` — an urgent act takes the waiting group along — so it gets a MEMBER id (`carrier#k`). Before J76
//   a play was never a batch member; J67 declined a send clock partly because member ids must be checked wherever a play
//   is referenced. Driven end to end through the real bot door, against a second real door that holds every relay and no
//   save point (a reader holding everything):
//   PART A — the play is the LAST member of a batch; its pi is the member id.
//   PART B — a vote, a skip and the next play all reference it by that pi.
//   PART C — song history, tallies (`counts[pi]` kept in the row) and added-at.
//   PART D — a save point whose cut IS the batch member, then a later save point and a move-on.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[batch-play] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"];
const door = () => { const sb = loadInContext(FILES, {}); sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.History.reset(); return sb; };
const MIN = 60000, T0 = 1700000000000;
let n = 0;
const single = (sb, body, actor, rank, l) => ({ event_id: "$e" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
  content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor: actor, rank: rank, src: "$i" + n, at: null })) } });
const batch = (id, members, l) => ({ event_id: id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
  content: { body: JSON.stringify({ t: "ddjp.batch", l: l, evs: members }) } });
const tally = (c) => c ? JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]])) : null;
const view = (sb) => { const s = sb.B1StreamManager.getState();
  return JSON.stringify({ pi: s.nowPlaying && s.nowPlaying.pi, by: s.nowPlaying && s.nowPlaying.dj,
    rot: (s.rotation || []).map((r) => [r.user, (r.pending || []).map((p) => p.videoId)]), live: s.nowPlaying ? tally(s.counts[s.nowPlaying.pi]) : null }); };
const D = door(), REF = door();
const O = D.Ranks.levelOf("owner"), P = D.Ranks.levelOf("player"), B = D.Ranks.levelOf("owner");
const feed = (raw) => { D.B2StreamManager.ingest(raw); REF.B2StreamManager.ingest(raw); };
const seal = (sb) => { const B1 = sb.B1StreamManager, log = B1.getLog(), last = log[log.length - 1];
  const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
  return { raw: { event_id: "$cp" + last.l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: last.ts + 1, content: { body: JSON.stringify(Object.assign({}, c, { l: last.l + 1 })) } }, head: last.eventId }; };
// ── the room's opening ──
feed(single(D, { t: "ddjp.room.settings", s: D.StateDeriver.defaultSettings() }, "@owner:hs", O, 1));
feed(single(D, { t: "ddjp.dj.join", v: "songAAAAAAA" }, "@a:hs", P, 2));
feed(single(D, { t: "ddjp.dj.join", v: "songBBBBBBB" }, "@b:hs", P, 3));
// ── PART A — the play is the LAST member of a batch ──
const stamp = (t, extra, actor, rank) => Object.assign({ t: t }, extra, { actor: actor, rank: rank, src: "$i" + (++n), at: null });
feed(batch("$c1", [stamp("ddjp.dj.join", { v: "songCCCCCCC" }, "@c:hs", P), stamp("ddjp.dj.play", { p: null }, "@bot:hs", B)], 4));
const PI = "$c1#1";
ok(D.B1StreamManager.getState().nowPlaying && D.B1StreamManager.getState().nowPlaying.pi === PI, "A: the play that travelled as the batch's last member is now playing, named by its member id", view(D));
ok(view(D) === view(REF), "A: and the door's room matches the reader holding everything", [view(D), view(REF)]);
// ── PART D (first half) — a save point whose cut IS the batch member ──
const s1 = seal(D);
ok(s1.head === PI, "D PREMISE — the save point's cut is the batch member itself", s1.head);
D.B2StreamManager.ingest(s1.raw); D.B2StreamManager.openFromSavePoint();
ok(view(D) === view(REF), "D: opening from a save point cut at the batch member leaves the room as the reader holding everything has it", [view(D), view(REF)]);
// ── PART B — a vote, a skip and the next play reference it by pi ──
feed(single(D, { t: "ddjp.dj.vote", p: PI, dv: 1 }, "@v1:hs", P, 6));
feed(single(D, { t: "ddjp.dj.vote", p: PI, dv: -1 }, "@v2:hs", P, 7));
const liveTally = tally(D.B1StreamManager.getState().counts[PI]);
ok(liveTally !== null && liveTally === tally(REF.B1StreamManager.getState().counts[PI]), "B: votes referencing the member id count for it, as for the reader holding everything", [liveTally, tally(REF.B1StreamManager.getState().counts[PI])]);
feed(single(D, { t: "ddjp.dj.skip", p: PI }, "@a:hs", P, 8));
feed(single(D, { t: "ddjp.dj.play", p: PI }, "@bot:hs", B, 9));
const next = D.B1StreamManager.getState().nowPlaying;
ok(next && next.pi !== PI && view(D) === view(REF), "B: the skip and the next play that point at the member id move the room on, as for the reader holding everything", [view(D), view(REF)]);
feed(single(D, { t: "ddjp.dj.vote", p: next.pi, dv: 1 }, "@v1:hs", P, 10));
// ── PART D (second half) — a later save point and a move-on ──
const s2 = seal(D); D.B2StreamManager.ingest(s2.raw);
ok(D.B2StreamManager.lastMoveOn() && D.B2StreamManager.lastMoveOn().ok === true, "D PREMISE — the door moved on past the batch", D.B2StreamManager.lastMoveOn());
ok(view(D) === view(REF), "D: after moving on, the room matches the reader holding everything", [view(D), view(REF)]);
// ── PART C — song history, tallies and added-at ──
const rows = Object.fromEntries(D.History.recent().map((h) => [h.pi, h]));
ok(!!rows[PI], "C: the batch member's play is in song history under its member id", Object.keys(rows));
const vs = (c) => c ? JSON.stringify({ votes: c.votes || 0, saves: c.saves || 0 }) : null;   // a row keeps { votes, saves }
ok(rows[PI] && vs(rows[PI].counts) === vs(REF.B1StreamManager.getState().counts[PI]),
  "C: its row keeps the reference reader's final tally after the counts left the derived state", [rows[PI] && rows[PI].counts, REF.B1StreamManager.getState().counts[PI]]);
ok(!D.B1StreamManager.getState().counts[PI], "C PREMISE — the derived counts no longer have it: the row is the only place it lives");
const added = (sb) => (typeof sb.History.addedAt === "function") ? sb.History.addedAt("@c:hs", "songCCCCCCC", T0 + 100 * MIN) : undefined;
// The reader holding everything never forgot the join, so its answer is the join itself, still in its log.
const refAdd = (REF.B1StreamManager.getLog().find((e) => e.type === "ddjp.dj.join" && e.content && e.content.v === "songCCCCCCC") || {}).ts;
ok(typeof added(D) === "number" && added(D) === refAdd, "C: the song added in the same batch keeps its added time after the move-on, as the reader holding everything has it", [added(D), refAdd]);
if (failed) { console.log("[batch-play] " + failed + " failure(s)"); process.exit(1); }
console.log("[batch-play] PASS — a song change travelling as a batch's last member (J76) is named by its member id, referenced by " +
  "votes, a skip and the next play, kept in song history with its tally and added time, and survives a save point cut at the " +
  "member itself and a later move-on — each matching a reader holding everything (" + asserts + " assertions)");
