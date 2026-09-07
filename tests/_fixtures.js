// tests/_fixtures.js
// PRODUCTION-SHAPED EVENT BUILDERS.
//
// Why this exists: nearly every false finding in this codebase's audit history came from a
// hand-typed fixture that did not reach the path under test, and an unreached path reports
// ABSENCE — which reads exactly like a finding. Real examples, all of which produced a
// confident wrong conclusion before the fixture was corrected:
//
//   · every event given a different sender  -> declares came from non-members, the DJ ran dry,
//                                              and the advance gate looked broken
//   · a raw without a top-level `l`         -> the checkpoint floor looked like a no-op
//   · a raw without type "m.room.message"   -> StreamManager ingested nothing at all
//   · four events at the same position      -> nothing passed the vouch turn filter, so the
//                                              bundle looked empty
//   · a buffer over the 2-song cap          -> the extra declare was refused and the rotation
//                                              emptied a step earlier than expected
//
// So: build fixtures from here, not by hand. Every builder produces the shape the real transport
// produces. If a probe using these still shows nothing, that is evidence — not a typo.
//
// AND THIS APPLIES TO THROWAWAY PROBES, NOT ONLY TO GUARDS. A probe written outside tests/ to
// answer one question is exactly where a hand-typed log gets used, because it feels too small to
// deserve a builder. Two probes in one Phase 0 run reported ABSENCE from fixtures that never
// reached the reducer — the first accepted 4 of 14 events with nothing playing, and read as a
// finding until it was rebuilt on these builders; another omitted `Ranks` from its load list and
// threw, which was luck, because a probe that omits a dependency can just as easily certify the
// inverse. This file and `_load.js` are `require`-able by absolute path from anywhere.
//
// TWO SHAPES, both real and NOT interchangeable (see docs/paths.md §3):
//   reducerEvent(...) — what StateDeriver folds:  { eventId, type, content: <parsed>, l, ts,
//                                                   sender, senderRank, roomId }
//   rawEvent(...)     — what the vouch layer holds and StreamManager.ingest accepts:
//                       { event_id, type: "m.room.message", content: { body: <JSON string> },
//                         l, ts, sender, senderRank, room_id }
// Conflating them generates confident wrong reports.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

const _r = loadInContext(["backends/backend1/ranks.js"], {});
const RANK = {
  owner: _r.Ranks.levelOf("owner"),
  highStaff: _r.Ranks.levelOf("high-staff"),
  staff: _r.Ranks.levelOf("staff"),
  vip: _r.Ranks.levelOf("vip"),
  player: _r.Ranks.levelOf("player"),
  guest: _r.Ranks.levelOf("guest"),
  uncat: _r.Ranks.levelOf("uncategorized"),
};

// The blocked-reason vocabulary, DERIVED from the reducer so no token is spelled here. One of each
// kind is all a fixture needs; which specific token it is has never been the point.
const _sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
                           "backends/backend1/statederiver.js"], { Date, Math, JSON });
const _REASONS = (_sd.StateDeriver && _sd.StateDeriver.BLOCKED_REASONS) || {};
const COUNTING_REASON = Object.keys(_REASONS).find((k) => _REASONS[k].counts) || null;
const LOCAL_REASON = Object.keys(_REASONS).find((k) => !_REASONS[k].counts) || null;

const ROOM = "!room:hs";
const BUFFER_CAP = 2;   // the reducer's per-DJ song cap — exceeding it silently refuses the extra

// ── the two event shapes ────────────────────────────────────────────────────────
function reducerEvent(id, l, ts, sender, rank, body) {
  return { eventId: id, l: l, ts: ts, sender: sender, senderRank: rank,
           type: body.t, content: body, roomId: ROOM };
}
function rawEvent(id, l, ts, sender, rank, body) {
  return { event_id: id, type: "m.room.message", sender: sender, senderRank: rank,
           l: l, ts: ts, origin_server_ts: ts, room_id: ROOM,
           content: { body: JSON.stringify(Object.assign({ l: l }, body)) } };
}
const toRaw = (e) => rawEvent(e.eventId, e.l, e.ts, e.sender, e.senderRank, e.content);

// ── a running room ──────────────────────────────────────────────────────────────
// One DJ (`@dj:hs`) who STAYS STOCKED: a fresh song is declared after each play, so the rotation
// never silently empties mid-test. `songs` is how many plays the log should support.
//
//   playingRoom({ songs: 3 })  ->  { log, pi(n), lastL, dj }
//   pi(0) is the genesis play instance, pi(1) the next, and so on.
function playingRoom(opts) {
  const o = opts || {};
  const songs = (typeof o.songs === "number" && o.songs > 0) ? o.songs : 1;
  const dj = o.dj || "@dj:hs";
  const rank = (typeof o.rank === "number") ? o.rank : RANK.player;
  const t0 = (typeof o.startTs === "number") ? o.startTs : 100000;
  const gap = (typeof o.gapMs === "number") ? o.gapMs : 200000;   // well clear of the 8s minGate

  const log = [];
  let l = 0;
  const pis = [];
  log.push(reducerEvent("$join", ++l, 1000, dj, rank, { t: "ddjp.dj.join", v: "SONG0" }));
  log.push(reducerEvent("$dec0", ++l, 1000, dj, rank, { t: "ddjp.dj.declare", v: "SONG1" }));
  for (let i = 0; i < songs; i++) {
    const id = "$play" + i;
    log.push(reducerEvent(id, ++l, t0 + i * gap, dj, rank,
      { t: "ddjp.dj.play", p: i === 0 ? null : pis[i - 1] }));
    pis.push(id);
    // keep the buffer topped up WITHOUT exceeding the cap, so the DJ never falls out mid-test
    log.push(reducerEvent("$dec" + (i + 1), ++l, t0 + i * gap + 500, dj, rank,
      { t: "ddjp.dj.declare", v: "SONG" + (i + 2) }));
  }
  return { log: log, dj: dj, lastL: l, pi: (n) => pis[n || 0], pis: pis, startTs: t0, gapMs: gap };
}

// ── declarations about a playing ────────────────────────────────────────────────
// Distinct senders by default, because the reducer counts DISTINCT people — reusing one sender
// silently collapses five declarations into one.
function lenDecl(id, l, ts, pi, sec, rank, sender) {
  return reducerEvent(id, l, ts, sender || ("@len" + id + ":hs"),
    (typeof rank === "number") ? rank : RANK.vip, { t: "ddjp.play.len", pi: pi, sec: sec });
}
// A blocked declaration DEFAULTS TO A COUNTING REASON (J06), because that is the shape that
// reaches a skip road — which is what almost every caller is here to exercise. The default is read
// from the reducer's own vocabulary rather than written down, so a room that re-tunes the list
// cannot leave this fixture naming a token the fold refuses.
//
// PASS `rsn` EXPLICITLY TO VARY THE AXIS: a non-counting token, or `null` for an UNTYPED
// declaration (the shape an older client sends). A fixture that never varies it is a fixture that
// holds the reason constant while asserting about a rule the reason decides — the "control that
// varies the wrong axis" failure, one axis over.
function blockedDecl(id, l, ts, pi, rank, sender, rsn) {
  const body = { t: "ddjp.play.blocked", pi: pi };
  const k = (rsn === undefined) ? COUNTING_REASON : rsn;
  if (typeof k === "string") body.k = k;
  return reducerEvent(id, l, ts, sender || ("@blk" + id + ":hs"),
    (typeof rank === "number") ? rank : RANK.guest, body);
}
// enough distinct blocked reporters to satisfy the default crowd road (5 guest+)
function blockedCrowd(startL, ts, pi, n, rank) {
  const out = [];
  const count = (typeof n === "number") ? n : 5;
  for (let i = 0; i < count; i++) {
    out.push(blockedDecl("$b" + i, startL + i, ts, pi,
      (typeof rank === "number") ? rank : RANK.guest, "@guest" + i + ":hs"));
  }
  return out;
}

// ── a held set for the vouch layer ──────────────────────────────────────────────
// `vouchTargets` applies a TURN filter: tier-many critical events must sort AFTER an event before
// it is yours to cover. A handful of events at the same position passes nothing, which looks like
// a broken selector. `padding` is how many later critical events to append.
function heldSet(events, opts) {
  const o = opts || {};
  const padding = (typeof o.padding === "number") ? o.padding : 12;
  const out = (events || []).map((e) => (e.event_id ? e : toRaw(e)));
  let l = out.reduce((m, r) => Math.max(m, r.l || 0), 0);
  for (let i = 0; i < padding; i++) {
    out.push(rawEvent("$pad" + i, ++l, 500000 + i, "@padder:hs", RANK.player,
      { t: "ddjp.dj.play", p: "$whatever" }));
  }
  return out;
}

// ── ordering, the same key the reducer uses ─────────────────────────────────────
const sortLog = (log) => log.slice().sort((a, b) => {
  const la = a.l || 0, lb = b.l || 0;
  if (la !== lb) return la - lb;
  const ia = a.eventId || a.event_id, ib = b.eventId || b.event_id;
  return ia < ib ? -1 : (ia > ib ? 1 : 0);
});
function shuffled(log, rnd) {
  const a = log.slice();
  const r = rnd || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ── A CHECKPOINT CHAIN THAT ACTUALLY VERIFIES ───────────────────────────────────
// `Floor.chainVerifies` is the gate on every floor decision — selection, revalidation, thin-join —
// and NOTHING in this suite could build a group that passes it. Every attempt failed on its own
// premise rather than on the tree: a single checkpoint per group returns false at `list.length < 2`
// before anything is examined, and a hand-written `h` is refused by `verify` at `remember`'s door,
// so the candidates vanish and the guard reports a floor problem that is really a fixture problem.
// Six such fixtures were attempted in one session. That absence made the floor's selection logic
// the least testable code in the tree, which is where both of v321's production defects lived.
//
// WHAT THE CHAIN HAS TO SATISFY, read off `chainVerifies` rather than guessed: for each consecutive
// pair it recomputes `buildSeed(events between the previous cut and this one, PREVIOUS SEED)` and
// requires that to fingerprint to this checkpoint's `h`. So a checkpoint's seed is not a summary of
// everything below it — it is the fold of ITS OWN SEGMENT, carried forward from the one before. A
// chain built any other way verifies by luck at best.
//
// The FIRST checkpoint's fingerprint is never checked: the loop seeds `state` from it and starts at
// the second. It is still built honestly here, because a fixture that is wrong in a way the code
// happens not to look at is exactly how a later change starts reporting nonsense.
//
// `cuts` are indices into the SORTED log — sort with `sortLog` first, or the segments are not the
// ones the reducer would fold.
function chainOf(sb, sortedLog, cuts, author) {
  const cps = [];
  let state = null;
  let prevIdx = -1;
  (cuts || []).forEach((cut, i) => {
    const from = prevIdx + 1;
    const seed = sb.StateDeriver.buildSeed(sortedLog.slice(from, cut + 1), state);
    const covers = sortedLog[from].eventId + ".." + sortedLog[cut].eventId;
    const floorL = sortedLog[cut].l;
    const n = i + 1;
    const prev = (i === 0) ? null : cps[i - 1].h;
    cps.push({
      n: n, prev: prev, seed: seed, thin: false, covers: covers, floorL: floorL,
      h: sb.CheckpointFormat.fingerprint(n, prev, seed, floorL, false, covers),
      u: author || "@owner:hs", by: author || "@owner:hs",
    });
    state = seed;
    prevIdx = cut;
  });
  return cps;
}

module.exports = {
  RANK, ROOM, BUFFER_CAP,
  COUNTING_REASON, LOCAL_REASON,
  reducerEvent, rawEvent, toRaw,
  playingRoom, lenDecl, blockedDecl, blockedCrowd,
  heldSet, sortLog, shuffled, chainOf,
};
