// tests/check-strike.js
// ddjp.dj.strike — a Staff+ moderator removes ONE named song (videoId) from ANY DJ's
// buffer: the moderator counterpart to the own-buffer ddjp.dj.undeclare. RANK-BLIND like
// remove / skip-others (Staff+ may strike a higher-ranked DJ, the owner included). Runs the
// REAL StreamManager + StateDeriver pipeline (each client sorts (l, event_id) independently),
// proving: song-targeting (only the named song leaves; a 2nd song shifts up), the Staff+
// gate, rank-blindness, hard fall-out (emptying the buffer drops the DJ, same as undeclare),
// totality (junk = clean no-op), and CONVERGENCE across shuffled arrival orders. The reducer
// reads NO time — the "shared 3s cooldown" is advisory UI only (interface.js / queue.js).

const { loadInContext } = require("./_load");

const RANK = { OWNER: 100, HIGH_STAFF: 80, STAFF: 60, VIP: 40, PLAYER: 20 };

function makeClient() {
  return loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"],
    { Date }
  ).StreamManager;
}
// A raw event exactly as MatrixBridge hands them to StreamManager.ingest.
function raw(eventId, l, sender, body, rank) {
  const r = {
    event_id: eventId, room_id: "!room:hs", type: "m.room.message", sender: sender,
    content: { body: JSON.stringify(Object.assign({ l: l }, body)) }, ts: l * 60000, l: l,
  };
  if (rank !== undefined) r.senderRank = rank;
  return r;
}
function fail(msg, detail) { console.log("[strike] FAIL — " + msg); if (detail) console.log("      " + detail); process.exit(1); }
const j = (x) => JSON.stringify(x);
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
function pendingOf(st, u) { const e = (st.rotation || []).find(r => r.user === u); return e ? e.pending.map(s => s.videoId) : null; }
function run(scn) { const C = makeClient(); scn.forEach(e => C.ingest(e)); return C.getState(); }
// Derive canonically, then prove 200 shuffled arrival orders all reach the same state.
function converges(scn, label) {
  const canon = j(run(scn));
  for (let i = 0; i < 200; i++) {
    const C = makeClient();
    shuffle(scn).forEach(e => C.ingest(e));
    if (j(C.getState()) !== canon) fail("shuffled arrival order diverged: " + label, "run " + i);
  }
  return JSON.parse(canon);
}
const strike = (id, l, actor, x, v, rank) => raw(id, l, actor, { t: "ddjp.dj.strike", x: x, v: v }, rank);

// Base rotation: A[S1,S2] (Player), B[S3] (High-Staff), O[S5] (Owner).
const BASE = [
  raw("$01", 1, "@a:hs", { t: "ddjp.dj.join",    v: "S1" }),
  raw("$02", 2, "@a:hs", { t: "ddjp.dj.declare", v: "S2" }),
  raw("$03", 3, "@b:hs", { t: "ddjp.dj.join",    v: "S3" }, RANK.HIGH_STAFF),
  raw("$04", 4, "@o:hs", { t: "ddjp.dj.join",    v: "S5" }, RANK.OWNER),
];

// 1) Staff strikes A's first song -> only S1 leaves, S2 shifts up, A stays in the rotation.
{
  const st = converges(BASE.concat([strike("$s1", 5, "@st:hs", "@a:hs", "S1", RANK.STAFF)]), "strike-one-song");
  if (j(pendingOf(st, "@a:hs")) !== j(["S2"])) fail("strike must remove exactly S1 and promote S2 to first", "got " + j(pendingOf(st, "@a:hs")));
}
// 2) Rank-blind: Staff strikes the HIGH-STAFF's only song -> B falls out (hard fall-out).
{
  const st = converges(BASE.concat([strike("$s2", 5, "@st:hs", "@b:hs", "S3", RANK.STAFF)]), "strike-higher-rank");
  if (pendingOf(st, "@b:hs") !== null) fail("Staff must be able to strike a HIGH-STAFF's song (rank-blind)");
}
// 3) Owner is not exempt: Staff strikes the OWNER's only song -> O falls out.
{
  const st = converges(BASE.concat([strike("$s3", 5, "@st:hs", "@o:hs", "S5", RANK.STAFF)]), "strike-owner");
  if (pendingOf(st, "@o:hs") !== null) fail("Staff must be able to strike the OWNER's song (rank-blind, like skip-others)");
}
// 4) Gate: a VIP (< Staff) strike is a clean no-op.
{
  const st = run(BASE.concat([strike("$s4", 5, "@vip:hs", "@a:hs", "S1", RANK.VIP)]));
  if (j(pendingOf(st, "@a:hs")) !== j(["S1", "S2"])) fail("a below-Staff strike must be a no-op");
}
// 5) Totality: unknown target / foreign videoId / missing x or v are all clean no-ops.
{
  const st = run(BASE.concat([
    strike("$s5", 5, "@st:hs", "@ghost:hs", "S1", RANK.STAFF),
    strike("$s6", 6, "@st:hs", "@a:hs", "S9", RANK.STAFF),
    raw("$s7", 7, "@st:hs", { t: "ddjp.dj.strike", x: "@a:hs" }, RANK.STAFF),
    raw("$s8", 8, "@st:hs", { t: "ddjp.dj.strike", v: "S1" }, RANK.STAFF),
  ]));
  if (j(pendingOf(st, "@a:hs")) !== j(["S1", "S2"])) fail("junk strikes must be clean no-ops");
}
// 6) Hard fall-out + re-entry: strike both of A's songs -> A leaves; only a fresh join re-enters.
{
  const scn = BASE.concat([
    strike("$s9", 5, "@st:hs", "@a:hs", "S1", RANK.STAFF),   // A -> [S2]
    strike("$s10", 6, "@st:hs", "@a:hs", "S2", RANK.STAFF),  // A -> empty -> fall-out
    raw("$s11", 7, "@a:hs", { t: "ddjp.dj.declare", v: "S7" }),  // declare after fall-out -> NO-OP (not a member)
    raw("$s12", 8, "@a:hs", { t: "ddjp.dj.join",    v: "S8" }),  // fresh join -> back in, at the back
  ]);
  const st = converges(scn, "strike-fallout-rejoin");
  if (j(pendingOf(st, "@a:hs")) !== j(["S8"])) fail("after both songs struck, A must fall out and re-enter only via a fresh join", "got " + j(pendingOf(st, "@a:hs")));
}

console.log("[strike] PASS — Staff+ strikes one named song from ANY DJ (rank-blind, owner included); the 2nd song shifts up; an emptied buffer -> hard fall-out; junk is inert; converges across 200 shuffled orders");
process.exit(0);
