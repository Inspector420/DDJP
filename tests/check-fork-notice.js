// tests/check-fork-notice.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: A DIVERGED CLIENT MUST STOP CALLING ITS OWN FORK A LOST RACE.
//
// A client that has forked (CONCEPTS.md Part 6 §16) refuses every later advance forever and used to
// report each one as "A lost race, not a fault". Driven in a live room: three refusals, three
// different senders, the head frozen at the same `pi` throughout, all three reassuring.
//
// A LOST RACE IS *ONE* REFUSAL. This is every refusal, forever, from every sender, with the head
// visibly frozen — the second signature (a message that names an action it does not take) reached
// from the other side, because the reassurance is what stops anybody looking.
//
// THE WORDING FIX AND THE SENSOR ARE ONE COMPUTATION, WHICH IS WHY THIS GUARD DRIVES RATHER THAN
// READS. The ORDER branch is stateless per event: it holds the arriving event and the current
// `nowPlaying` and nothing about the previous refusal. The frozen head and the differing senders
// are visible to a human reading three lines and to nothing writing any one of them. So either the
// line is softened — which makes every refusal ambiguous, including the genuine lost races that are
// the common case, and is strictly worse than saying nothing — or it remembers. That memory IS the
// sensor, and a regex proving the new sentence is spelled in the file would prove nothing about
// whether the memory ever reaches it.
//
// NO NEW DIAL. The tell is derived from what already happened: head unmoved since the last refusal,
// and a different sender. Nothing here is a threshold anybody has to defend.
//
// DETECTION ONLY (CONCEPTS.md §3.4). The output is the `why` clause of a log line. It gates
// nothing, refuses nothing and triggers nothing — PART D asserts the room is byte-identical either
// side of the latch, so a future edit cannot quietly make this a response.
//
// A — a diverged client: head frozen, refusals from different senders, and the line stops
//     claiming a lost race and says the true thing.
// B — a genuine lost race still reads as one: a single refusal, and a refusal AFTER an accepted
//     advance, both keep the reassuring wording. Without this, "never say lost race" passes A.
// C — `reset()` clears the memory, so a new room does not inherit the last room's suspicion.
// D — the latch changes the MESSAGE and nothing else.
//
// THE TWO CLEARS ARE NOT INDEPENDENT, AND THE KEEP-ONE LATTICE IS WHY THIS IS WRITTEN DOWN RATHER
// THAN ASSUMED. Run at `ddjp_399` with a control ADJACENT to the subjects:
//
//   | kept                    | dropped                  | suite            |
//   |-------------------------|--------------------------|------------------|
//   | both (baseline)         | —                        | green            |
//   | the accepted clear only | `reset()`'s              | **green**        |
//   | `reset()`'s only        | the accepted clear       | **RED** [B3]     |
//   | neither                 | both                     | **RED** [B3, C]  |
//   | *(control)*             | the different-sender test| **RED** [B]      |
//
// So THE ACCEPTED-ADVANCE CLEAR IS THE SOLE ENFORCEMENT and `reset()`'s is DOMINATED by it. The
// reason is reachability rather than duplication: a stale-parent refusal needs a `nowPlaying`, and
// in a freshly entered room the only thing that produces one is an accepted advance — which clears
// the memory on its way past. The single-site drop of `reset()`'s line is therefore GREEN, and the
// mutation runner marks it `expectGreen` so a later reader is not told it is doing work it is not.
//
// IT IS KEPT, AND NOT AS DECORATION. The "neither" row reddens PART C as well as B3, so C's
// property is REAL and is merely held by the other site today. The domination is a statement about
// THE ROUTES THAT EXIST, not about the code — `roles.md` §9's `_aboveCut` row is the worked
// precedent for that distinction. **The condition that would end the redundancy** is a room whose
// `nowPlaying` arrives from a checkpoint SEED rather than from an ingested advance, which the
// origin fold already makes reachable: that room has a head, has run no accepted advance this
// session, and would inherit the previous room's latch through `reset()` alone. That route is NOT
// driven here — it needs a Floor, a checkpoint and a seeded fold — and it is named rather than
// claimed, because understating coverage misleads exactly as much as overstating it.

const { loadInContext } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[fork-notice] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// The ORDER verdict is a Logger.info, so the Logger is the instrument. Captured rather than stubbed
// away: what this file measures is whether a SENTENCE reaches a person.
function tree() {
  const lines = [];
  const C = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/consensushash.js", "backends/backend1/vouch.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
  ], {});
  const realInfo = C.Logger.info;
  C.Logger.info = (m) => {
    lines.push(String(m));
    if (realInfo) { try { realInfo(m); } catch (e) {} }
  };
  return { C, lines, orders: () => lines.filter((l) => /StreamManager: ORDER /.test(l)) };
}

const RAW = (id, l, ts, sender, rank, body) => ({
  event_id: id, type: "m.room.message", sender, room_id: "!r:hs",
  ts, senderRank: rank, content: { body: JSON.stringify(Object.assign({ l }, body)) },
});

const LOST_RACE = /A lost race, not a fault/;
const FORK = /MAY HAVE DIVERGED/;

// A room that is genuinely playing, so a stale parent has a real head to be stale against.
function room(t) {
  const SM = t.C.StreamManager, R = require("./_fixtures.js").RANK;
  SM.reset();
  [["$j1", 1, 1000, "@alice:hs", R.player, { t: "ddjp.dj.join", v: "A1" }],
   ["$j2", 2, 1100, "@bob:hs", R.player, { t: "ddjp.dj.join", v: "B1" }],
   ["$d1", 3, 1200, "@alice:hs", R.player, { t: "ddjp.dj.declare", v: "A2" }],
   ["$p0", 4, 100000, "@alice:hs", R.player, { t: "ddjp.dj.play", p: null }],
  ].forEach((a) => SM.ingest(RAW.apply(null, a)));
  return SM;
}
// Last ORDER line emitted, which is the verdict for the event just ingested.
const last = (t) => { const o = t.orders(); return o.length ? o[o.length - 1] : ""; };

// ── PART A — A DIVERGED CLIENT SAYS SO ────────────────────────────────────────────────────────
// The head stays at $p0 throughout: every play below names a parent that is not the head, so each
// is refused by the stale-parent rule and the room never moves.
{
  const t = tree();
  const SM = room(t);
  const head0 = SM.getState().nowPlaying && SM.getState().nowPlaying.pi;

  SM.ingest(RAW("$r1", 5, 200000, "@bob:hs", require("./_fixtures.js").RANK.player,
    { t: "ddjp.dj.play", p: "$ghost1" }));
  const first = last(t);

  SM.ingest(RAW("$r2", 6, 210000, "@carol:hs", require("./_fixtures.js").RANK.player,
    { t: "ddjp.dj.play", p: "$ghost2" }));
  const second = last(t);

  SM.ingest(RAW("$r3", 7, 220000, "@dave:hs", require("./_fixtures.js").RANK.player,
    { t: "ddjp.dj.play", p: "$ghost3" }));
  const third = last(t);

  // Control for the whole part: if these were not refusals, or the head moved, every assertion
  // below is about a path nothing reached.
  ok(t.orders().length >= 4, "A: APPLIED — the ORDER branch emitted a verdict per advance",
    t.orders().length);
  ok(/REFUSED/.test(first) && /REFUSED/.test(second) && /REFUSED/.test(third),
    "A: APPLIED — all three advances were REFUSED, which is the state this entry is about");
  const headNow = SM.getState().nowPlaying && SM.getState().nowPlaying.pi;
  ok(headNow === head0,
    "A: APPLIED — the head did not move across the three refusals, so 'frozen head' is a reading "
    + "of the room rather than an assumption", { head0, headNow });

  ok(LOST_RACE.test(first),
    "A: the FIRST refusal still reads as a lost race — one refusal against a moving room is "
    + "exactly what a lost race is, and the tell needs a second data point", first);
  ok(FORK.test(second) && !LOST_RACE.test(second),
    "A: the SECOND refusal — same frozen head, a DIFFERENT sender — stops claiming a lost race "
    + "and says the client may have diverged", second);
  ok(FORK.test(third) && !LOST_RACE.test(third),
    "A: and it stays said. A fork is not a transient condition and the line must not flicker "
    + "back to reassurance on the next refusal", third);
}

// ── PART B — A GENUINE LOST RACE STILL READS AS ONE ───────────────────────────────────────────
// The control for the whole file. "Never say lost race" would satisfy PART A completely.
{
  const t = tree();
  const R = require("./_fixtures.js").RANK;
  const SM = room(t);

  // B1 — one refusal on its own is a lost race and nothing more.
  SM.ingest(RAW("$b1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$ghost" }));
  ok(LOST_RACE.test(last(t)) && !FORK.test(last(t)),
    "B: a single refusal reads as a lost race — the common case, and the one that must not be "
    + "made ambiguous by this job", last(t));

  // B2 — the SAME sender refused twice is not the tell. A client retrying its own stale play is
  // not evidence of a fork; two different senders failing against one frozen head is.
  SM.ingest(RAW("$b2", 6, 201000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$ghost" }));
  ok(LOST_RACE.test(last(t)) && !FORK.test(last(t)),
    "B: the same sender refused twice against the same head is NOT the tell — one client retrying "
    + "its own stale play says nothing about whether THIS client has diverged", last(t));
}

// ── PART B2 — AN ACCEPTED ADVANCE CLEARS THE MEMORY ───────────────────────────────────────────
// This is what keeps a room that is merely busy from eventually accusing itself.
{
  const t = tree();
  const R = require("./_fixtures.js").RANK;
  const SM = room(t);

  SM.ingest(RAW("$c1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$ghost" }));
  ok(/REFUSED/.test(last(t)), "B2: APPLIED — the first play was refused", last(t));

  // A real advance: names the actual head, so the fold takes it and the room moves.
  const head = SM.getState().nowPlaying.pi;
  SM.ingest(RAW("$c2", 6, 400000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: head }));
  ok(/ACCEPTED/.test(last(t)),
    "B2: APPLIED — an advance naming the real head was ACCEPTED, so the room moved and the "
    + "memory has something to be cleared by", last(t));

  // Now a refusal from a DIFFERENT sender. Without the reset-on-accept this pairs with $c1 and
  // wrongly latches.
  SM.ingest(RAW("$c3", 7, 410000, "@carol:hs", R.player, { t: "ddjp.dj.play", p: "$ghost2" }));
  ok(LOST_RACE.test(last(t)) && !FORK.test(last(t)),
    "B2: a refusal after an ACCEPTED advance reads as a lost race again — the room demonstrably "
    + "moved, so the head is not frozen and the tell must not fire", last(t));
}

// ── PART B3 — A LATCHED CLIENT THAT RECOVERS STOPS SAYING IT ──────────────────────────────────
// THIS is what the accepted-advance clear actually protects, and PART B2 does not reach it. B2
// never latches before the accepted advance, so the `pi` comparison alone carries it — an accepted
// advance always MOVES the head, so `_lastStaleRefusal.pi === np.pi` is false afterwards whether or
// not anything was cleared. Measured: dropping the clear leaves B2 green.
//
// The latch is different in kind, because it is STICKY. Once `_forkSuspected` is true the `pi`
// comparison is no longer consulted for the wording, so nothing but the clear can lower it. A
// client that suspected a fork and then successfully advanced has demonstrated it is NOT forked —
// its arithmetic agreed with the room's — and it must stop saying so.
{
  const t = tree();
  const R = require("./_fixtures.js").RANK;
  const SM = room(t);

  SM.ingest(RAW("$m1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$g1" }));
  SM.ingest(RAW("$m2", 6, 210000, "@carol:hs", R.player, { t: "ddjp.dj.play", p: "$g2" }));
  ok(FORK.test(last(t)),
    "B3: APPLIED — the client is latched before the recovery, so there is a suspicion for an "
    + "accepted advance to clear. Without this the rest of this part proves nothing", last(t));

  const head = SM.getState().nowPlaying.pi;
  SM.ingest(RAW("$m3", 7, 400000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: head }));
  ok(/ACCEPTED/.test(last(t)),
    "B3: APPLIED — an advance naming the real head was ACCEPTED, so this client's arithmetic "
    + "agreed with the room's and it is demonstrably not forked", last(t));

  SM.ingest(RAW("$m4", 8, 410000, "@carol:hs", R.player, { t: "ddjp.dj.play", p: "$g3" }));
  ok(LOST_RACE.test(last(t)) && !FORK.test(last(t)),
    "B3: and the next refusal reads as a lost race again. A latched suspicion that survives a "
    + "successful advance is a client calling itself forked forever on the strength of two "
    + "refusals it has since disproved", last(t));
}

// ── PART C — `reset()` CLEARS IT, SO A NEW ROOM INHERITS NO SUSPICION ─────────────────────────
// CONCEPTS.md §3.11 lists forgetting one of these as a recurring class across six modules. This
// would be the seventh, and it is driven rather than asserted from the source line.
{
  const t = tree();
  const R = require("./_fixtures.js").RANK;
  let SM = room(t);

  // Ids deliberately outside the set `room()` uses. An id it already holds is dropped by the
  // duplicate check BEFORE the ORDER branch, so the refusal never happens and the silence reads
  // exactly like the latch failing to fire — which is what this part reported the first time it
  // was written, with `$d1` colliding with the declare above.
  const n0 = t.orders().length;
  SM.ingest(RAW("$k1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$g1" }));
  SM.ingest(RAW("$k2", 6, 210000, "@carol:hs", R.player, { t: "ddjp.dj.play", p: "$g2" }));
  ok(t.orders().length === n0 + 2,
    "C: APPLIED — both refusals reached the ORDER branch. An id already in the log is dropped as "
    + "a duplicate before this point, and that silence is indistinguishable from the latch not "
    + "firing", { before: n0, after: t.orders().length });
  ok(FORK.test(last(t)),
    "C: APPLIED — the first room is latched, so there is a live suspicion for a room change to "
    + "carry across. Without this the silence below proves nothing", last(t));

  // A new room, built through the same path features/room.js uses.
  SM = room(t);
  SM.ingest(RAW("$e1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$g3" }));
  ok(LOST_RACE.test(last(t)) && !FORK.test(last(t)),
    "C: after a room change the first refusal reads as a lost race again — a suspicion is a fact "
    + "about ONE room's fold and carrying it would accuse the next room of the last one's fork",
    last(t));
}

// ── PART D — DETECTION, NOT RESPONSE ──────────────────────────────────────────────────────────
// CONCEPTS.md §3.4. The latch must change the MESSAGE and nothing else: two rooms fed identical
// events must derive identical state whether or not the tell fired.
{
  const t = tree();
  const R = require("./_fixtures.js").RANK;

  const SM = room(t);
  SM.ingest(RAW("$f1", 5, 200000, "@bob:hs", R.player, { t: "ddjp.dj.play", p: "$g1" }));
  const beforeLatch = JSON.stringify(SM.getState());
  const logBefore = SM.getLog().length;

  SM.ingest(RAW("$f2", 6, 210000, "@carol:hs", R.player, { t: "ddjp.dj.play", p: "$g2" }));
  ok(FORK.test(last(t)), "D: APPLIED — the latch fired, so there is a response to rule out",
    last(t));

  const afterLatch = JSON.stringify(SM.getState());
  ok(beforeLatch === afterLatch,
    "D: derived state is byte-identical either side of the latch — the tell gates nothing, "
    + "refuses nothing and triggers nothing (CONCEPTS.md §3.4, notice is not react)");
  ok(SM.isLegal("$f2") === false && SM.getLog().length === logBefore + 1,
    "D: and the event is still REFUSED BY THE FOLD for the reason it was refused. Note it does "
    + "enter the ordered log — a stale parent is refused by the REDUCER, not dropped at the door, "
    + "so admission is unchanged and `isLegal` is what carries the refusal",
    { legal: SM.isLegal("$f2"), logBefore, after: SM.getLog().length });
}

// ── THE GATE IS BELOW EVERY PART, IN TIME ─────────────────────────────────────────────────────
// The thirty-ninth signature: a file with an async section has its gate where every path arrives,
// not at the end of the source. Everything here is synchronous, and the gate is stated in one
// place so that appending a part cannot leave it above one.
function finish() {
  if (failed) process.exit(1);
  console.log("[fork-notice] PASS — a diverged client stops calling its own fork a lost race, and "
    + "a genuine lost race still reads as one. The tell is DERIVED rather than dialled: the head "
    + "unmoved since the last refusal, and a different sender. A lost race is ONE refusal; a fork "
    + "is every refusal, forever, from every sender, with the head visibly frozen — and the old "
    + "line reassured the reader through all of it, which is what stopped anybody looking. The "
    + "wording and the sensor are ONE computation and this guard DRIVES them, because the ORDER "
    + "branch is stateless per event and a regex proving the sentence is spelled in the file "
    + "would prove nothing about whether the memory ever reaches it. The same sender refused "
    + "twice is deliberately not the tell, an accepted advance clears the memory, and `reset()` "
    + "clears it at a room change (CONCEPTS.md §3.11's seventh module). Detection only: derived "
    + "state is byte-identical either side of the latch (§3.4). THIS GUARD CANNOT TELL YOU A "
    + "PERSON READS THE SENTENCE AS A WARNING — it proves what the line says, never what a reader "
    + "hears, and no guard in this tree can reach that (" + A + " assertions)");
}
finish();
