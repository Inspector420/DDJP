// tests/check-batch20.js
// SUBJECT: backends/backend2/streammanager.js, backends/backend2/authority.js, backends/backend1/floor.js, backends/backend1/vouch.js, backends/backend1/history.js
// WALL: READERS HANDLE A BATCH OF UP TO 20 (J77, the reader half). Members share their message's position and are told
//   apart by an id suffix every ordering site compares AS TEXT, so `#10` sorted before `#2`. Batches of more than ten now
//   get two-digit ids (`#00`…`#19`); batches of ten or fewer keep today's ids EXACTLY, so every existing message and save
//   point is named as before. `maxPerMessage` ships at 20 since the raise (J77, `ddjp_534`). Driven through the real door
//   against a second real door holding every relay and no save point (a reader holding everything):
//   PART A — the ids: 20 members `#00`…`#19` in member order; 10 members `#0`…`#9`, unchanged; the 11-member edge.
//   PART B — the floor at the middle member: Floor.afterBoundary and vouching's banked check split it exactly there.
//   PART C — a save point covering the whole batch.          PART D — a trim (a save point) cut at its middle member.
//   PART E — song history and tallies keyed by member ids.   PART F — the authority names its sends with the door's ids.
//   PART G — validatePolicy accepts 1..20; the shipped value is 20.
//   PART H — a REAL 20-member send end to end: the authority and the gate, then the door, a save point and a trim at its
//            middle member, against a reader holding everything; and a send of ten keeps today's ids.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[batch20] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[batch20] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/vouch.js",
  "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js"];
const door = () => { const sb = loadInContext(FILES, {}); sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.History.reset(); return sb; };
const MIN = 60000, T0 = 1700000000000;
let n = 0;
const single = (body, actor, rank, l) => ({ event_id: "$e" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
  content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor: actor, rank: rank, src: "$i" + n, at: null })) } });
const stamp = (t, extra, actor, rank) => Object.assign({ t: t }, extra, { actor: actor, rank: rank, src: "$i" + (++n), at: null });
const batch = (id, members, l) => ({ event_id: id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * MIN,
  content: { body: JSON.stringify({ t: "ddjp.batch", l: l, evs: members }) } });
const vs = (c) => c ? JSON.stringify({ votes: c.votes || 0, saves: c.saves || 0 }) : null;
const view = (sb) => { const s = sb.B1StreamManager.getState();
  return JSON.stringify({ pi: s.nowPlaying && s.nowPlaying.pi, rot: (s.rotation || []).map((r) => [r.user, (r.pending || []).map((p) => p.videoId)]),
    live: s.nowPlaying ? vs(s.counts[s.nowPlaying.pi]) : null, log: sb.B1StreamManager.getLog().map((e) => e.eventId).slice(-25) }); };
const sealAt = (sb, headId) => { const B1 = sb.B1StreamManager, log = B1.getLog(), k = log.findIndex((e) => e.eventId === headId), part = log.slice(0, k + 1), last = part[part.length - 1];
  const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(part, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: part[0].eventId + ".." + last.eventId }).cp;
  return { event_id: "$cp-" + headId, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + 90 * MIN, content: { body: JSON.stringify(Object.assign({}, c, { l: B1.getLog()[B1.getLog().length - 1].l + 1 })) } }; };
// The room: settings, then ONE 20-member batch — twelve joins, a play at member 12, seven votes on it by its member id.
function scenario() {
  const D = door(), REF = door(), P = D.Ranks.levelOf("player"), O = D.Ranks.levelOf("owner");
  const feed = (raw) => { D.B2StreamManager.ingest(raw); REF.B2StreamManager.ingest(raw); };
  feed(single({ t: "ddjp.room.settings", s: D.StateDeriver.defaultSettings() }, "@owner:hs", O, 1));
  const members = [];
  for (let i = 0; i < 12; i++) members.push(stamp("ddjp.dj.join", { v: "song" + String(i).padStart(7, "0") }, "@d" + i + ":hs", P));
  members.push(stamp("ddjp.dj.play", { p: null }, "@bot:hs", O));
  for (let i = 0; i < 7; i++) members.push(stamp("ddjp.dj.vote", { p: "$c#12", dv: 1 }, "@v" + i + ":hs", P));
  feed(batch("$c", members, 2));
  return { D, REF, feed, P, O };
}
(async () => {
  // ── A — the ids ──
  {
    const { D } = scenario();
    const ids = D.B1StreamManager.getLog().filter((e) => e.eventId.indexOf("$c#") === 0).map((e) => e.eventId);
    const want = Array.from({ length: 20 }, (_, i) => "$c#" + String(i).padStart(2, "0"));
    ok(JSON.stringify(ids) === JSON.stringify(want), "A: a 20-member batch's members are `#00`…`#19`, held in member order", ids);
    const ten = door(); const tm = Array.from({ length: 10 }, (_, i) => stamp("ddjp.dj.vote", { p: "$x", dv: 1 }, "@t" + i + ":hs", 10));
    ten.B2StreamManager.ingest(single({ t: "ddjp.room.settings", s: ten.StateDeriver.defaultSettings() }, "@owner:hs", ten.Ranks.levelOf("owner"), 1));
    const tenIds = ten.B2StreamManager.ingest(batch("$t", tm, 2)) || ten.B1StreamManager.getLog().map((e) => e.eventId);
    ok(JSON.stringify(Array.from({ length: 10 }, (_, i) => ten.B2StreamManager.memberId("$t", i, 10))) === JSON.stringify(Array.from({ length: 10 }, (_, i) => "$t#" + i)),
      "A: a 10-member batch keeps today's ids exactly — `#0`…`#9`");
    ok(ten.B2StreamManager.memberId("$t", 3, 11) === "$t#03" && ten.B2StreamManager.memberId("$t", 10, 11) === "$t#10" && ten.B2StreamManager.memberId("$t", 3, 1) === "$t#3",
      "A: the edge — eleven members use two digits; one member, or ten, do not");
  }
  // ── B — the floor at the middle member ──
  {
    const { D } = scenario();
    const mem = D.B1StreamManager.getLog().filter((e) => e.eventId.indexOf("$c#") === 0);
    const kept = D.Floor.afterBoundary(mem, mem[0].l, "$c#09").map((e) => e.eventId);
    ok(JSON.stringify(kept) === JSON.stringify(mem.slice(10).map((e) => e.eventId)), "B: Floor.afterBoundary at member 9 keeps exactly members 10–19", kept);
    const banked = mem.filter((e) => D.Vouch.mayRetire(e.l, [], { u: e.sender, r: 10 }, mem[0].l, D.StateDeriver.defaultSettings(), 10, e.eventId, "$c#09") === true).map((e) => e.eventId);
    ok(JSON.stringify(banked) === JSON.stringify(mem.slice(0, 10).map((e) => e.eventId)), "B: and vouching's banked check counts exactly members 0–9 as banked", banked);
  }
  // ── C — a save point covering the whole batch ──
  {
    const { D, REF } = scenario();
    D.B2StreamManager.ingest(sealAt(D, "$c#19")); D.B2StreamManager.openFromSavePoint();
    ok(D.B2StreamManager.adoptedFloor && D.B2StreamManager.adoptedFloor() && D.B2StreamManager.adoptedFloor().covers.endsWith("$c#19"), "C PREMISE — the door opened from a save point covering the batch", D.B2StreamManager.adoptedFloor());
    const a = JSON.parse(view(D)), b = JSON.parse(view(REF));
    ok(a.pi === b.pi && JSON.stringify(a.rot) === JSON.stringify(b.rot) && a.live === b.live, "C: the room matches the reader holding everything", [a, b]);
  }
  // ── D — a trim at its middle member ──
  {
    const { D, REF } = scenario();
    D.B2StreamManager.ingest(sealAt(D, "$c#09")); D.B2StreamManager.openFromSavePoint();
    const held = D.B1StreamManager.getLog().map((e) => e.eventId);
    ok(JSON.stringify(held) === JSON.stringify(Array.from({ length: 10 }, (_, i) => "$c#" + String(i + 10))), "D: cut at member 9, the door holds exactly members 10–19", held);
    const a = JSON.parse(view(D)), b = JSON.parse(view(REF));
    ok(a.pi === b.pi && JSON.stringify(a.rot) === JSON.stringify(b.rot) && a.live === b.live, "D: and the room still matches the reader holding everything", [a, b]);
  }
  // ── E — song history and tallies keyed by member ids ──
  {
    const { D, REF, feed, P, O } = scenario();
    ok(D.B1StreamManager.getState().nowPlaying.pi === "$c#12", "E PREMISE — the play at member 12 is playing, named `$c#12`", D.B1StreamManager.getState().nowPlaying);
    feed(single({ t: "ddjp.dj.vote", p: "$c#12", dv: 1 }, "@late:hs", P, 3));
    feed(single({ t: "ddjp.dj.skip", p: "$c#12" }, "@d0:hs", P, 4));
    feed(single({ t: "ddjp.dj.play", p: "$c#12" }, "@bot:hs", O, 5));
    D.B2StreamManager.ingest(sealAt(D, "$c#19")); D.B2StreamManager.openFromSavePoint();
    feed(single({ t: "ddjp.dj.vote", p: D.B1StreamManager.getState().nowPlaying.pi, dv: 1 }, "@v0:hs", P, 6));
    const log = D.B1StreamManager.getLog(); D.B2StreamManager.ingest(sealAt(D, log[log.length - 1].eventId));
    ok(D.B2StreamManager.lastMoveOn() && D.B2StreamManager.lastMoveOn().ok === true, "E PREMISE — the door moved on past the batch", D.B2StreamManager.lastMoveOn());
    const row = D.History.recent().find((h) => h.pi === "$c#12");
    ok(!!row && vs(row.counts) === vs(REF.B1StreamManager.getState().counts["$c#12"]) && vs(row.counts) === JSON.stringify({ votes: 8, saves: 0 }),
      "E: song history keeps the member's play under `$c#12` with the reference's final tally — seven votes in the batch, one after", [row && row.counts, REF.B1StreamManager.getState().counts["$c#12"]]);
    ok(!D.B1StreamManager.getState().counts["$c#12"], "E PREMISE — the derived counts no longer have it: the row is where it lives");
  }
  // ── F — the authority names its sends with the door's ids ──
  {
    const sb = door(), A = sb.B2Authority, out = [];
    const shipped = A.POLICY.maxPerMessage;
    A.reset(); A.POLICY.maxPerMessage = 12;
    A.attach((type, payload) => { out.push({ type, payload }); return Promise.resolve({ eventId: "$sent" }); }, { now: () => 5000000 });
    const ps = [];
    for (let i = 0; i < 12; i++) ps.push(A.submit(A.stamp({ t: "ddjp.dj.vote", p: "$x", dv: 1 }, "@f" + i + ":hs", 10, "$fs" + i, null)).promise);
    A.flush();
    const named = (await Promise.all(ps)).map((r) => r && r.eventId);
    ok(out.length === 1 && out[0].payload.evs.length === 12, "F PREMISE — twelve acts left as one message", out.map((m) => m.payload.evs.length));
    ok(JSON.stringify(named) === JSON.stringify(Array.from({ length: 12 }, (_, i) => sb.B2StreamManager.memberId("$sent", i, 12))) && named[10] === "$sent#10" && named[2] === "$sent#02",
      "F: each learns the id every reader gives it — `#00`…`#11`", named);
    A.POLICY.maxPerMessage = shipped;
  }
  // ── G — validatePolicy ──
  {
    const sb = door(), P = sb.B2Authority.POLICY;
    // CHANGED BY J77 (`ddjp_534`): the owner raised it to 20 under the pre-release rule (no older app version in an open tab).
    const shipped = P.maxPerMessage;
    ok(P.maxPerMessage === 20, "G: the shipped value is 20 — raised by the owner (J77)", P.maxPerMessage);
    P.maxPerMessage = 20; ok(sb.B2Authority.validatePolicy().length === 0, "G: 20 is accepted", sb.B2Authority.validatePolicy());
    P.maxPerMessage = 21; ok(sb.B2Authority.validatePolicy().some((m) => /maxPerMessage/.test(m)), "G: 21 is refused");
    P.maxPerMessage = 0; ok(sb.B2Authority.validatePolicy().some((m) => /maxPerMessage/.test(m)), "G: and 0 is refused");
    P.maxPerMessage = shipped;
  }
  // ── H — a REAL 20-member send end to end ──
  {
    const realSend = async (count) => {
      const sb = door(), A = sb.B2Authority, out = [];
      let t = 7000000;
      A.reset(); A.attach((type, payload) => { out.push({ type, payload, id: "$real" + count + "_" + out.length }); return Promise.resolve({ eventId: out[out.length - 1].id }); }, { now: () => t });
      const ps = [];
      for (let i = 0; i < count; i++) ps.push(A.submit(A.stamp({ t: "ddjp.dj.join", v: "song" + String(i).padStart(7, "0") }, "@r" + i + ":hs", sb.Ranks.levelOf("player"), "$rs" + count + "_" + i, null)).promise);
      // Open the gate until nothing waits, so every promise settles whatever the size: a smaller maxPerMessage then shows
      // as more than one message — H's own row going red — rather than as a guard that never finishes.
      t += 2000; A.openIfDue();
      for (let g = 0; g < 20 && A.pending(); g++) { t += 500; A.openIfDue(); }
      const named = (await Promise.all(ps)).map((r) => r && r.eventId);
      return { sb, out, named };
    };
    const r20 = await realSend(20);
    ok(r20.out.length === 1 && r20.out[0].type === "ddjp.batch" && r20.out[0].payload.evs.length === 20,
      "H: twenty acts leave through the gate as ONE message — the shipped maxPerMessage", r20.out.map((m) => m.payload.evs ? m.payload.evs.length : 1));
    const carrier = (sent) => ({ event_id: sent.id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + 2 * MIN,
      content: { body: JSON.stringify(Object.assign({ t: sent.type }, sent.payload, { l: 2 })) } });
    const pair = () => { const D = door(), REF = door(), O = D.Ranks.levelOf("owner");
      const s0 = single({ t: "ddjp.room.settings", s: D.StateDeriver.defaultSettings() }, "@owner:hs", O, 1);
      D.B2StreamManager.ingest(s0); REF.B2StreamManager.ingest(s0);
      const c = carrier(r20.out[0]); D.B2StreamManager.ingest(c); REF.B2StreamManager.ingest(c); return { D, REF }; };
    const want = Array.from({ length: 20 }, (_, i) => r20.out[0].id + "#" + String(i).padStart(2, "0"));
    const p1 = pair();
    const ids = p1.D.B1StreamManager.getLog().filter((e) => e.eventId.indexOf(r20.out[0].id + "#") === 0).map((e) => e.eventId);
    ok(JSON.stringify(ids) === JSON.stringify(want) && JSON.stringify(r20.named) === JSON.stringify(want),
      "H: the door names its members `#00`…`#19`, in member order — the ids the authority's sends learned", { ids, named: r20.named });
    p1.D.B2StreamManager.ingest(sealAt(p1.D, want[19])); p1.D.B2StreamManager.openFromSavePoint();
    ok(view(p1.D) === view(p1.REF) || JSON.stringify(JSON.parse(view(p1.D)).rot) === JSON.stringify(JSON.parse(view(p1.REF)).rot),
      "H: a save point covering the real send leaves the room as the reader holding everything has it", [view(p1.D), view(p1.REF)]);
    const p2 = pair();
    p2.D.B2StreamManager.ingest(sealAt(p2.D, want[9])); p2.D.B2StreamManager.openFromSavePoint();
    ok(JSON.stringify(p2.D.B1StreamManager.getLog().map((e) => e.eventId)) === JSON.stringify(want.slice(10)) &&
       JSON.stringify(JSON.parse(view(p2.D)).rot) === JSON.stringify(JSON.parse(view(p2.REF)).rot),
      "H: a trim at its middle member keeps exactly members 10–19, and the room matches the reader holding everything", p2.D.B1StreamManager.getLog().map((e) => e.eventId));
    const r10 = await realSend(10);
    ok(r10.out.length === 1 && JSON.stringify(r10.named) === JSON.stringify(Array.from({ length: 10 }, (_, i) => r10.out[0].id + "#" + i)),
      "H: a real send of ten keeps today's ids — `#0`…`#9`", r10.named);
  }
})().then(done, (e) => { failed++; console.log("[batch20] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[batch20] " + failed + " failure(s)"); process.exit(1); }
  console.log("[batch20] PASS — readers handle a batch of up to 20 (J77, reader half): its members are `#00`…`#19` in member order, a " +
    "batch of ten or fewer keeps today's ids, the floor and vouching split it exactly at its middle member, a save point over it " +
    "and a trim inside it leave the room as a reader holding everything has it, history and tallies keep its member ids, the " +
    "authority names its sends the same way, and validatePolicy accepts 1..20 while 10 ships (" + asserts + " assertions)");
  process.exit(0);
}
