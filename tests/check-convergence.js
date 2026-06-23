// tests/check-convergence.js
// WALL: the whole point of the project, now over the real DJ rotation.
// Two independent clients, the same events delivered in DIFFERENT arrival
// orders, must reach the same now-playing and the same rotation. Runs the real
// StreamManager + StateDeriver pipeline (each client sorts independently).
//
// Exercises: join, declare (buffer cap), the advance lock (duplicate advance
// rejected), soft fall-out + re-entry by declare, staff move, staff remove,
// and high-staff reset.

const assert = require("assert");
const { loadInContext } = require("./_load");

const RANK = { OWNER: 100, HIGH_STAFF: 80, STAFF: 60, VIP: 40, PLAYER: 20, GUEST: 10 };

// A fresh, independent client (its own StreamManager singleton).
function makeClient() {
  return loadInContext(
    ["core/logger.js", "core/statederiver.js", "core/streammanager.js"],
    { Date }
  ).StreamManager;
}

// Build a raw event as MatrixBridge hands them to StreamManager.ingest.
// rank is optional and rides on raw.senderRank (the channel-origin seam).
function raw(eventId, l, sender, body, rank) {
  const r = {
    event_id: eventId,
    room_id: "!room:hs",
    type: "m.room.message",
    sender: sender,
    content: { body: JSON.stringify(Object.assign({ l: l }, body)) },
    ts: l * 1000,
    l: l,
  };
  if (rank !== undefined) r.senderRank = rank;
  return r;
}

// --- The scenario, in canonical (l, event_id) order ---------------------------
// A,B,C join with a song; A buffers a 2nd; three advances; a duplicate advance;
// B tries to re-declare after running out (now a NO-OP under hard fall-out) then
// re-JOINS to actually re-enter; staff moves B to the front; staff removes A.
//
// Hard fall-out (changed by explicit request): running out of buffered songs
// removes a DJ from the rotation entirely. They must send ddjp.dj.join to
// re-enter — a bare ddjp.dj.declare no longer resurrects them, because declare
// only adds to an EXISTING member's buffer.
const SCENARIO = [
  raw("$01", 1, "@a:hs", { t: "ddjp.dj.join",    v: "S1" }),
  raw("$02", 2, "@b:hs", { t: "ddjp.dj.join",    v: "S2" }),
  raw("$03", 3, "@c:hs", { t: "ddjp.dj.join",    v: "S3" }),
  raw("$04", 4, "@a:hs", { t: "ddjp.dj.declare", v: "S1b" }),
  raw("$05", 5, "@a:hs", { t: "ddjp.dj.play",    p: null }),   // A plays S1, still has S1b -> [B,C,A]
  raw("$06", 6, "@b:hs", { t: "ddjp.dj.play",    p: "$05" }),  // B plays S2, runs out -> REMOVED -> [C,A]
  raw("$07", 6, "@z:hs", { t: "ddjp.dj.play",    p: "$05" }),  // DUPLICATE advance, stale p -> rejected
  raw("$08", 7, "@c:hs", { t: "ddjp.dj.play",    p: "$06" }),  // C plays S3, runs out -> REMOVED -> [A]
  raw("$09", 8, "@b:hs", { t: "ddjp.dj.declare", v: "Sx" }),   // B declare after leaving -> NO-OP (not a member)
  raw("$10", 9, "@b:hs", { t: "ddjp.dj.join",    v: "S2b" }),  // B re-JOINS at back -> [A,B]
  raw("$11", 10, "@staff:hs", { t: "ddjp.dj.move", x: "@b:hs" }, RANK.STAFF), // B to front -> [B,A]
  raw("$12", 11, "@staff:hs", { t: "ddjp.dj.remove", x: "@a:hs" }, RANK.STAFF), // remove A -> [B]
];

const EXPECTED = {
  nowPlaying: { dj: "@c:hs", song: { videoId: "S3", videoUrl: null }, pi: "$08", startedAt: 7000, skipped: false },
  rotation: [{ user: "@b:hs", pending: [{ videoId: "S2b", videoUrl: null }] }],
};

function fail(msg, detail) {
  console.log("[convergence] FAIL — " + msg);
  if (detail) console.log("      " + detail);
  process.exit(1);
}

const j = (x) => JSON.stringify(x);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[k]; a[k] = t;
  }
  return a;
}

// 1) Canonical run matches the hand-computed expected state.
const base = makeClient();
SCENARIO.forEach((e) => base.ingest(e));
const got = { nowPlaying: base.getState().nowPlaying, rotation: base.getState().rotation };
try {
  assert.deepStrictEqual(JSON.parse(j(got)), EXPECTED);
} catch (e) {
  fail("derived state did not match the expected rotation result", "got " + j(got));
}
const canonical = j(base.getState());

// 2) Convergence: many random arrival orders all reach the same state.
let runs = 0;
for (let i = 0; i < 400; i++) {
  const C = makeClient();
  shuffle(SCENARIO).forEach((e) => C.ingest(e));
  if (j(C.getState()) !== canonical)
    fail("a shuffled arrival order produced different state", "run " + i);
  runs++;
}

// 3) Advance lock held: the duplicate advance ($07) never double-advanced.
//    (If it had, C would not be the DJ and the rotation would differ — covered
//    by the expected check above, asserted here explicitly for clarity.)
if (base.getState().nowPlaying.pi !== "$08")
  fail("advance lock failed — a duplicate advance was applied");

// 4) Reset clears the rotation AND stops whatever is playing — a true zero
// state for both queue and now-playing (changed by explicit request; was
// previously "rotation only" — see git history / STATUS.md for the prior
// design choice 3 if that behavior is ever needed again).
const withReset = makeClient();
SCENARIO.forEach((e) => withReset.ingest(e));
withReset.ingest(raw("$13", 12, "@owner:hs", { t: "ddjp.dj.reset" }, RANK.OWNER));
if (withReset.getState().rotation.length !== 0)
  fail("reset did not clear the rotation");
if (withReset.getState().nowPlaying !== null)
  fail("reset did not stop the playing song — it should zero both queue and now-playing");

// 5) ddjp.dj.order — a DJ reorders their OWN declared buffer (which of their
// up-to-two songs plays next). Pure, no rank gate (own buffer only), and must
// converge: the reorder slots into (l, event_id) order like everything else, so
// every arrival order agrees. Here A declares S1 then S2, reorders to [S2,S1],
// then the genesis play must start S2 (the promoted song), leaving S1 buffered.
const ORDER = [
  raw("$o1", 1, "@a:hs", { t: "ddjp.dj.join",    v: "S1" }),
  raw("$o2", 2, "@a:hs", { t: "ddjp.dj.declare", v: "S2" }),
  raw("$o3", 3, "@a:hs", { t: "ddjp.dj.order",   o: ["S2", "S1"] }),
  raw("$o4", 4, "@a:hs", { t: "ddjp.dj.play",    p: null }),
];
const orderBase = makeClient();
ORDER.forEach((e) => orderBase.ingest(e));
{
  const np = orderBase.getState().nowPlaying;
  if (!np || !np.song || np.song.videoId !== "S2")
    fail("ddjp.dj.order did not promote S2 to the front before the play", "nowPlaying=" + j(np));
  const buf = (orderBase.getState().rotation.find(r => r.user === "@a:hs") || {}).pending || [];
  if (j(buf.map(s => s.videoId)) !== j(["S1"]))
    fail("after playing the promoted song, S1 should remain buffered", j(buf.map(s => s.videoId)));
}
const orderCanonical = j(orderBase.getState());
for (let i = 0; i < 200; i++) {
  const C = makeClient();
  shuffle(ORDER).forEach((e) => C.ingest(e));
  if (j(C.getState()) !== orderCanonical) fail("ddjp.dj.order: a shuffled order diverged", "run " + i);
}

// 6) ddjp.room.settings — owner-only, last-write-wins, derived. A forged (non-
// Owner) settings event is ignored; the latest OWNER write wins regardless of
// arrival order. settings-owner is stamped rank 100 by channel origin, carried
// here on senderRank.
const SETTINGS = [
  raw("$s1", 1, "@owner:hs", { t: "ddjp.room.settings", s: { chat: "guest" } },         RANK.OWNER),
  raw("$s2", 2, "@troll:hs", { t: "ddjp.room.settings", s: { chat: "uncategorized" } }, RANK.PLAYER), // forged -> ignored
  raw("$s3", 3, "@owner:hs", { t: "ddjp.room.settings", s: { chat: "uncategorized" } }, RANK.OWNER), // later owner write wins
];
const setBase = makeClient();
SETTINGS.forEach((e) => setBase.ingest(e));
if (setBase.getState().settings.chat !== "uncategorized")
  fail("settings last-write-wins (owner) did not resolve to uncategorized", j(setBase.getState().settings));
const setCanonical = j(setBase.getState().settings);
for (let i = 0; i < 200; i++) {
  const C = makeClient();
  shuffle(SETTINGS).forEach((e) => C.ingest(e));
  if (j(C.getState().settings) !== setCanonical) fail("ddjp.room.settings: a shuffled order diverged", "run " + i);
}
// And a lone forged settings event never moves the default.
const forgedOnly = makeClient();
forgedOnly.ingest(raw("$sf", 1, "@troll:hs", { t: "ddjp.room.settings", s: { chat: "guest" } }, RANK.PLAYER));
if (forgedOnly.getState().settings.chat !== "uncategorized")
  fail("a non-Owner settings event must be ignored (default stays uncategorized)", j(forgedOnly.getState().settings));

// 7) bg field on ddjp.room.settings — an owner-set room-background LINK, derived
// exactly like chat: owner-only (channel origin), last-write-wins, and it must
// converge across arrival orders. (The link is text only; the image is fetched
// client-side, never over Matrix.) A forged (non-Owner) bg is ignored.
const BG = [
  raw("$b1", 1, "@owner:hs", { t: "ddjp.room.settings", s: { chat: "uncategorized", bg: "https://i.imgur.com/aaa.gif" } }, RANK.OWNER),
  raw("$b2", 2, "@troll:hs", { t: "ddjp.room.settings", s: { bg: "https://evil.example/x.gif" } },                        RANK.PLAYER), // forged -> ignored
  raw("$b3", 3, "@owner:hs", { t: "ddjp.room.settings", s: { chat: "guest", bg: "https://i.imgur.com/bbb.gif" } },        RANK.OWNER),  // later owner write wins
];
const bgBase = makeClient();
BG.forEach((e) => bgBase.ingest(e));
if (bgBase.getState().settings.bg !== "https://i.imgur.com/bbb.gif")
  fail("bg last-write-wins (owner) did not resolve to the latest owner link", j(bgBase.getState().settings));
if (bgBase.getState().settings.chat !== "guest")
  fail("bg test: chat should have followed the last owner write too", j(bgBase.getState().settings));
const bgCanonical = j(bgBase.getState().settings);
for (let i = 0; i < 200; i++) {
  const C = makeClient();
  shuffle(BG).forEach((e) => C.ingest(e));
  if (j(C.getState().settings) !== bgCanonical) fail("ddjp.room.settings bg: a shuffled order diverged", "run " + i);
}
// An explicit bg:null from the owner clears the background.
const bgClear = makeClient();
bgClear.ingest(raw("$bc1", 1, "@owner:hs", { t: "ddjp.room.settings", s: { bg: "https://i.imgur.com/c.gif" } }, RANK.OWNER));
bgClear.ingest(raw("$bc2", 2, "@owner:hs", { t: "ddjp.room.settings", s: { bg: null } },                       RANK.OWNER));
if (bgClear.getState().settings.bg !== null)
  fail("an explicit bg:null from the owner should clear the background", j(bgClear.getState().settings));
// A lone forged bg never moves the default (stays null).
const bgForged = makeClient();
bgForged.ingest(raw("$bf", 1, "@troll:hs", { t: "ddjp.room.settings", s: { bg: "https://i.imgur.com/x.gif" } }, RANK.PLAYER));
if (bgForged.getState().settings.bg !== null)
  fail("a non-Owner bg must be ignored (bg stays null)", j(bgForged.getState().settings));

console.log("[convergence] PASS — rotation, advance lock, fall-out, move/remove/reset, dj.order, and room.settings (chat + bg) all converged across " + runs + " shuffled orders");
process.exit(0);
