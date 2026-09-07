// tests/check-ordering.js
//
// AN EVENT MUST NOT BE INSERTED INTO SETTLED HISTORY.
//
// Ordering is by `l`, a Lamport clock the sender stamps on its own message. Nothing bounded it.
// `validate` checked only that it was a number, so a client could claim any position it liked —
// and the reducer takes the DJ and the song from STATE rather than from the event:
//
//     const head = order[0];
//     const song = members[head].pending.shift();
//
// so anything that changes the rotation retroactively changes who is playing and what. Measured:
// one uncategorized account posting an ordinary dj.join at l=0 changed both, and split honest
// clients permanently — a client holding a floor refused it as already-banked while a client
// without one accepted it, and nothing reconciles them.
//
// WHY THIS IS A CORRECTNESS RULE AND NOT A SECURITY PATCH, which decides where it lives and how
// harshly it may refuse. A client that was briefly disconnected, saw up to l=50, and sends l=51
// into a room now at l=100 does the identical damage. Inserting into settled history is the
// hazard; intent does not change it. So refusing an honest-but-stale event is correct rather than
// collateral — the sender's clock updates on receive, so a resend is automatically well-formed.
//
// The rule uses the one fact a client cannot forge: `origin_server_ts`. An event may not claim a
// position in the past while the server says it was minted after what it claims to precede. This
// is the already-banked rule generalised — below the floor we refuse because that region is
// settled, here because the event is NEWER than what it would sort before.
//
// PART B is the part that matters most. A rule of "refuse anything below the head" would pass
// every attack assertion here and break scrollback, replay and cross-channel delivery, which
// legitimately deliver low-`l` events all the time. The refusal has to be narrow.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
  "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js"], {});
const SM = sb.StreamManager, R = F.RANK;

// RAW matrix-shaped, because that is what ingest takes. _fixtures warns that conflating raw and
// reducer events "generates confident wrong reports" — it does, and it has, in this file's siblings.
const raw = (id, l, ts, sender, rank, body) => ({
  event_id: id, type: "m.room.message", sender: sender, room_id: "!r:hs",
  ts: ts, senderRank: rank, content: { body: JSON.stringify(Object.assign({ l: l }, body)) },
});

const view = () => {
  const s = SM.getState();
  return JSON.stringify({ dj: s.nowPlaying && s.nowPlaying.dj,
                          song: s.nowPlaying && s.nowPlaying.song && s.nowPlaying.song.videoId });
};

// A room that is genuinely playing, so a rewrite has something to rewrite.
function room() {
  SM.reset();
  [["$j1", 1, 1000, "@alice:hs", R.player, { t: "ddjp.dj.join", v: "A1" }],
   ["$j2", 2, 1100, "@bob:hs", R.player, { t: "ddjp.dj.join", v: "B1" }],
   ["$d1", 3, 1200, "@alice:hs", R.player, { t: "ddjp.dj.declare", v: "A2" }],
   ["$p0", 4, 100000, "@alice:hs", R.player, { t: "ddjp.dj.play", p: null }],
   ["$p1", 5, 300000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$p0" }],
  ].forEach((a) => SM.ingest(raw.apply(null, a)));
}
// head after room() is l=5 at ts=300000.
const accepted = (ev) => { const n = SM.getLog().length; SM.ingest(ev); return SM.getLog().length > n; };

// ── PART A — a backdated event is refused, and the room does not move ────────────────────────
{
  room();
  const before = view();
  ok(before.indexOf("@bob") > 0, "A: the control room is playing bob's song before anything is tried", before);

  const took = accepted(raw("$x", 0, 400000, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "E1" }));
  ok(took === false, "A: an event claiming l=0 while minted after the head is refused");
  ok(view() === before,
    "A: APPLIED — and the room is untouched. Refusing at the gate is the point: once folded, a "
    + "backdated join changes which DJ is playing and which song, because the reducer reads both "
    + "from state rather than from the event", { before: before, after: view() });

  room();
  ok(accepted(raw("$y", -9999, 400000, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "E1" })) === false,
    "A: APPLIED — a negative position is the same claim and gets the same answer");
}

// ── PART B — THE NON-REGRESSION. Legitimate low-`l` delivery must still work ──────────────────
// Scrollback, cross-channel replay and simple late delivery all hand over events whose `l` is far
// below the head. Their timestamps are old, because they really are old. A rule that refused on
// position alone would pass every assertion in PART A and silently break joining a room.
{
  room();
  ok(accepted(raw("$back", 2, 1150, "@carol:hs", R.player, { t: "ddjp.dj.join", v: "C1" })) === true,
    "B: a genuinely OLD event — low l AND an old timestamp — is accepted. This is backfill, and it "
    + "is the common case every replay depends on");

  room();
  ok(accepted(raw("$conc", 5, 300000, "@dave:hs", R.player, { t: "ddjp.dj.join", v: "D1" })) === true,
    "B: APPLIED — and an event sharing the head's exact timestamp is accepted. Two clients really "
    + "do send in the same millisecond, and at equal times the two facts do not contradict: "
    + "'cannot tell' is not a refusal");

  room();
  ok(accepted(raw("$fwd", 6, 400000, "@erin:hs", R.player, { t: "ddjp.dj.join", v: "E9" })) === true,
    "B: APPLIED — and an ordinary forward send is untouched");
}

// ── PART C — `l` must be a safe integer, as everywhere else in this system ───────────────────
// A fractional position sorts BETWEEN two existing events, and the hash layer throws on one rather
// than rounding — a throw this path would swallow, silently costing that event its protection.
{
  for (const [l, label] of [[0.5, "fractional"], [NaN, "NaN"], [Infinity, "Infinity"],
                            [1e18, "beyond safe integers"]]) {
    room();
    ok(accepted(raw("$s", l, 400000, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "X" })) === false,
      "C: l=" + label + " is refused rather than rounded or folded");
  }
}

// ── PART D — the head advances only on events that ENTERED the log ───────────────────────────
// If a refused event moved the reference, one rejected message would poison the bar for every
// honest one after it. The case that exposes it is a refusal for a reason OTHER than position: an
// unsafe `l` is far ABOVE the head, so a head that moved on refusal would jump to it and then
// refuse every ordinary send as "backdated".
{
  room();
  ok(accepted(raw("$huge", 1e18, 400000, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "X" })) === false,
    "D: an unsafe position is refused (setup for the real assertion)");
  ok(accepted(raw("$after", 6, 400001, "@erin:hs", R.player, { t: "ddjp.dj.join", v: "E9" })) === true,
    "D: APPLIED — and an ordinary send AFTER that refusal still works. A head that moved on refused "
    + "events would have jumped to 1e18 here and locked the room out of its own future, which is a "
    + "denial of service handed to anyone who can send one malformed message");

  room();
  SM.ingest(raw("$r1", 0, 400000, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "E1" }));   // refused
  ok(accepted(raw("$r2", 1, 400001, "@evil:hs", R.uncat, { t: "ddjp.dj.join", v: "E2" })) === false,
    "D: APPLIED — and a refused backdate does not lower the bar for the next one either");
}

// ── PART E — a song payload is bounded in SHAPE, at its one entry point ──────────────────────
// songOf is the single funnel every song passes through, and it only checked truthiness. Anything
// truthy became a song: an object, an array, a number, a 5000-character string — all of which
// entered the rotation's pending buffer and from there every checkpoint SEED, which is specified
// at roughly 2 KB regardless of room age.
//
// Type and size only. Whether a string is a REAL video id belongs to metadata.js and PlaylistDoc,
// which already own that question; restating it inside a pure reducer that may depend on neither
// would be a second copy free to drift. The reducer's promise is narrower and total: state cannot
// be poisoned by shape.
{
  const inRotation = (v) => {
    SM.reset();
    SM.ingest(raw("$j", 1, 1000, "@e:hs", R.uncat, { t: "ddjp.dj.join", v: v }));
    return (SM.getState().rotation || []).some((m) => m.user === "@e:hs");
  };
  for (const [v, label] of [["x".repeat(5000), "5000-char string"], [{ a: 1 }, "object"],
                            [[1, 2], "array"], [12345, "number"], [true, "boolean"],
                            [null, "null"], ["", "empty string"]]) {
    ok(inRotation(v) === false, "E: a join carrying " + label + " does not enter the rotation");
  }
  ok(inRotation("dQw4w9WgXcQ") === true,
    "E: APPLIED — and an ordinary 11-character id still joins. A bound that refused real songs "
    + "would be a worse failure than the one it replaced");

  // Rejected, never truncated: a clipped id is a DIFFERENT id, and would look like a song while
  // playing as nothing.
  SM.reset();
  SM.ingest(raw("$j2", 1, 1000, "@e:hs", R.uncat, { t: "ddjp.dj.join", v: "y".repeat(5000) }));
  const rot = SM.getState().rotation || [];
  ok(JSON.stringify(rot).length < 200,
    "E: APPLIED — and nothing oversized is carried in truncated form either, so the rotation (and "
    + "with it every checkpoint seed) stays small", { size: JSON.stringify(rot).length });
}

console.log("[ordering] PASS — a claim about the past is checked against a fact about the present: "
  + "an event may not claim a position below the head while the server says it was minted after "
  + "what it would sort before, so a backdated join can no longer rewrite which DJ is playing nor "
  + "split a room between clients that hold a floor and clients that do not; genuinely old events "
  + "still arrive freely, because backfill and cross-channel replay depend on it and a rule that "
  + "refused on position alone would break joining entirely; a fractional or unsafe position is "
  + "refused rather than rounded; and a refused event never moves the bar the next one is judged "
  + "against (" + checks + " assertions)");
