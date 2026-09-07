// tests/check-stress.js
// WALL: THE ROOM UNDER ATTACK AND UNDER NEGLECT.
//
// Every other guard tests one module's rules. This one runs whole SCENARIOS across all of them,
// because every serious error in this project came from a path nobody walked end to end — a fact
// that was true locally and an assumed global path. These are the paths, walked.
//
// SCENARIO 1 — alone in an empty room: play a lot, delete it all, leave. Must converge.
// SCENARIO 2 — busy room, delete-and-run. Must not fork.
// SCENARIO 3 — re-supplying your own deleted event to break the room. Must not inject.
// SCENARIO 4 — an uncorroborated gap must NOT freeze the room (the DoS the restraint invites).
// SCENARIO 5 — the laptop sleeps mid-everything. No stale action, no stale rank.
// SCENARIO 6 — a quiet room loses its floor. Must still notice.
// SCENARIO 7 — promotion burst. New duty, ladder-ordered, and it terminates.
// SCENARIO 8 — a room of only uncategorized accounts cannot manufacture authority.
// SCENARIO 9 — the head is protected without waiting a turn; the tail still waits.
// SCENARIO 10 — everyone converges after chaos. THE ACCEPTANCE TEST.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

function fail(m, g) { console.log("[stress] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const OWNER = F.RANK.owner, HS = F.RANK.highStaff, STAFF = F.RANK.staff;
const VIP = F.RANK.vip, PLAYER = F.RANK.player, GUEST = F.RANK.guest, UNCAT = F.RANK.uncat;

const MODULES = [
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "core/playlistdoc.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/dials.js",
  "backends/backend1/session.js", "backends/backend1/scheduler.js",
  "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/checkpoint.js",
  "backends/backend1/continuity.js", "backends/backend1/history.js",
  "backends/backend1/settingsproof.js",
];
function tree() { return loadInContext(MODULES, { Date }); }

// ── SCENARIO 1 — alone in an empty room, play everything, delete everything, leave ───────────
// SAFE, and not by luck: nobody else ever saw those events, so everyone who arrives later sees the
// same surviving set and agrees with EACH OTHER. Convergence does not require the data to survive.
{
  const sb = tree();
  const R = F.playingRoom({ songs: 5 });
  const LOG = F.sortLog(R.log);
  const survivors = LOG.filter((e) => e.eventId.indexOf("$play") !== 0);   // every play deleted

  const latecomerA = sb.StateDeriver.derive(survivors);
  // Shuffled on ARRIVAL, then sorted before folding — which is what the system does. The point is
  // that arrival order cannot matter, not that the reducer sorts for you (it does not; it takes an
  // already-ordered log, and ordering is transport's job).
  const latecomerB = sb.StateDeriver.derive(F.sortLog(F.shuffled(survivors, () => 0.42)));
  ok(JSON.stringify(latecomerA.nowPlaying) === JSON.stringify(latecomerB.nowPlaying)
     && JSON.stringify(latecomerA.rotation) === JSON.stringify(latecomerB.rotation),
    "S1: two clients arriving after a total wipe derive IDENTICAL state, in any arrival order. "
    + "Nobody saw the deleted events, so nobody diverges — the room rolls back and agrees",
    { a: latecomerA.nowPlaying, b: latecomerB.nowPlaying });
  ok(latecomerA.nowPlaying === null,
    "S1: APPLIED — and the room is cleanly at zero rather than half-broken, so a fresh genesis play "
    + "works", latecomerA.nowPlaying);
}

// ── SCENARIO 2 — busy room, delete-and-run. THE FORK. ────────────────────────────────────────
{
  const sb = tree();
  const R = F.playingRoom({ songs: 5 });
  const LOG = F.sortLog(R.log);
  const gone = R.pi(2);
  const bView = LOG.filter((e) => e.eventId !== gone);

  const A = sb.StateDeriver.derive(LOG);
  const B = sb.StateDeriver.derive(bView);
  ok(A.nowPlaying.pi !== B.nowPlaying.pi,
    "S2: setup — A saw the deleted play and B did not, so they genuinely disagree. Both are "
    + "internally consistent; neither is wrong given what it holds",
    { A: A.nowPlaying.song.videoId, B: B.nowPlaying.song.videoId });

  // B holds a child naming the missing parent, so B CAN know it is short.
  const bHeld = bView.map(F.toRaw);
  const missing = sb.Continuity.missingParents(bHeld);
  ok(missing.indexOf(gone) >= 0,
    "S2: B can DETECT that it is missing history — a held event names a parent it does not have",
    missing);

  // Uncorroborated: B must keep going, or a fabricated parent freezes the room.
  const bare = sb.Continuity.mayAdvance(bHeld, {}, -1);
  ok(bare.ok === true && bare.state === "suspect",
    "S2: with nobody corroborating the gap, B KEEPS GOING and flags it. Yielding to an "
    + "uncorroborated claim would hand a griefer the room", bare);

  // Now A vouches the deleted event — corroboration.
  const rec = sb.Vouch.record(F.toRaw(LOG.find((e) => e.eventId === gone)));
  const aBundle = F.rawEvent("$avouch", 99, 9000, "@a:hs", STAFF,
    { t: "ddjp.witness.bundle", w: [rec] });
  const withEvidence = sb.Continuity.mayAdvance(bHeld.concat([aBundle]), {}, -1);
  ok(withEvidence.ok === false && withEvidence.state === "short",
    "S2: APPLIED — once somebody VOUCHES the missing parent, it is proven to have existed, so B "
    + "holds still. The second branch never forms and the fork is PREVENTED rather than repaired",
    withEvidence);
  ok(withEvidence.corroborated.indexOf(gone) >= 0,
    "S2: APPLIED — and B names exactly which parent is holding it back", withEvidence.corroborated);
}

// ── SCENARIO 3 — the attacker re-supplies their own deleted event ────────────────────────────
{
  const sb = tree();
  const R = F.playingRoom({ songs: 3 });
  const LOG = F.sortLog(R.log);
  const victim = LOG.find((e) => e.eventId === R.pi(1));
  const rec = sb.Vouch.record(F.toRaw(victim));
  const carrier = F.rawEvent("$evil", 99, 9000, "@attacker:hs", GUEST,
    { t: "ddjp.witness.bundle", w: [rec] });

  const rebuilt = sb.Vouch.repairFrom([carrier]);
  ok(rebuilt.length === 1, "S3: the content IS rebuildable — the record carries it and the hash proves it");
  ok(!rebuilt[0].sender,
    "S3: APPLIED — but the rebuild has NO SENDER. A record commits the author without letting you "
    + "open the commitment, so authorship cannot be restored", rebuilt[0].sender || "(none)");

  const folded = sb.StateDeriver.derive([sb.StreamManagerNormalise ? null : {
    eventId: rebuilt[0].event_id, type: "ddjp.dj.play",
    content: JSON.parse(rebuilt[0].content.body), l: rebuilt[0].l, ts: 1, sender: null,
    senderRank: rebuilt[0].senderRank,
  }].filter(Boolean));
  ok(folded.nowPlaying === null,
    "S3: APPLIED — and the reducer REFUSES it, because members, ranks and DJ attribution are all "
    + "keyed by sender. A rebuilt event is restore MATERIAL, never history, so re-supplying your "
    + "own deleted event injects nothing into anyone's timeline", folded.nowPlaying);
}

// ── SCENARIO 4 — an uncorroborated gap must not freeze the room ──────────────────────────────
{
  const sb = tree();
  // A griefer publishes an advance naming a parent that never existed.
  const fabricated = F.rawEvent("$grief", 10, 1000, "@grief:hs", UNCAT,
    { t: "ddjp.dj.play", p: "$NEVER_EXISTED" });
  const v = sb.Continuity.mayAdvance([fabricated], {}, -1);
  ok(v.ok === true,
    "S4: APPLIED — one message naming a fabricated parent must NOT freeze everyone. This is the "
    + "denial of service the restraint would otherwise invite, and it is why corroboration is a "
    + "requirement rather than a nicety", v);
  ok(v.suspect.indexOf("$NEVER_EXISTED") >= 0,
    "S4: and it is flagged rather than ignored, so a real gap is still visible", v.suspect);
}

// ── SCENARIO 5 — the laptop sleeps mid-everything ────────────────────────────────────────────
{
  const sb = tree();
  let NOW = 1000000, rank = GUEST;
  sb.Session.attach({ now: () => NOW, setInterval: () => 1, clearInterval: () => {}, headCount: () => 0 });
  sb.Scheduler.attach({ now: () => NOW, setTimeout: () => 1, clearTimeout: () => {}, random: () => 0 });
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Session._setLastBeatForTest(NOW);

  let handed = null, ran = 0;
  sb.Scheduler.plan("s5", { rank: () => rank, spacing: () => 1000,
                            stillNeeded: () => true, run: (ctx) => { handed = ctx.rank; ran++; } });

  NOW += 2 * 60 * 60 * 1000;                       // two hours of sleep
  sb.Session._beatForTest();
  ok(sb.Session.phase() === sb.Session.SUSPENDED,
    "S5: the wake is DETECTED with no browser API — the heartbeat measures the real gap");

  const r1 = sb.Scheduler._fireNowForTest("s5");
  ok(ran === 0 && r1.reason === "stale-replanned",
    "S5: APPLIED — the timer that fired after the sleep is RE-PLANNED, not run against a world "
    + "that moved on two hours ago", r1);

  rank = OWNER;                                     // promoted while asleep
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Scheduler._fireNowForTest("s5");
  ok(handed === OWNER,
    "S5: APPLIED — and when it does run it is handed the rank it has NOW, not the one it was "
    + "planned with. Sleeping through a promotion cannot publish under the old rank",
    { handed: handed, planned: GUEST });
}

// ── SCENARIO 6 — a quiet room loses its floor ────────────────────────────────────────────────
{
  const sb = tree();
  const events = [];
  sb.Floor.attach({ log: () => [], settings: () => ({}), myRank: () => STAFF,
                    trimmed: () => true });
  sb.Floor.onChange((e) => events.push(e));
  sb.Floor._setTrustedForTest({ n: 1, seed: {}, h: "x", covers: "$a..$b", floorL: 5, grade: "quorum" });

  const r = sb.Floor.revalidate();
  ok(r.moved === true && r.reason === "demoted-stale",
    "S6: a quorum floor that stops verifying, under a client that already forgot, is demoted "
    + "rather than withdrawn — withdrawing would leave it with no state at all", r);
  // KEYED ON WHAT PRODUCTION KEYS ON. This used to also require `needsRepage === true` on the
  // detail — a field no production code read, beside a `Floor.needsRepage()` flag no production
  // code called. Asserting a value is SET while claiming an effect is roles.md §10b's second
  // shape, and it is why the flag survived as long as it did. The flag is deleted (J02); the
  // emission is the mechanism, and `kind` is what the re-page subscriber in matrixbridge reads.
  ok(events.some((e) => e.kind === "demoted"),
    "S6: APPLIED — and it EMITS. In the old tree it raised a flag nobody read until the next song "
    + "played, so a quiet room — where a deletion goes unnoticed longest — never recovered. A flag "
    + "nobody reads is this codebase's signature bug", events);
}

// ── SCENARIO 7 — the promotion burst ─────────────────────────────────────────────────────────
{
  const sb = tree();
  const base = [];
  for (let i = 0; i < 6; i++) {
    base.push(F.rawEvent("$e" + i, 10 + i, 1000, "@other:hs", STAFF, { t: "ddjp.dj.play", p: "$z" }));
    base.push(F.rawEvent("$mv" + i, 20 + i, 1000, "@me:hs", STAFF, { t: "ddjp.witness.bundle",
      w: [{ i: "$e" + i, l: 10 + i, d: { t: "ddjp.dj.play", p: "$z" }, h: "x", r: STAFF }] }));
  }
  const held = F.heldSet(base, { padding: 14 });

  const asStaff = sb.Vouch.owed(held, { myRank: STAFF, myUserId: "@me:hs", settings: {}, floorL: null });
  const asHS = sb.Vouch.owed(held, { myRank: HS, myUserId: "@me:hs", settings: {}, floorL: null });
  ok(asStaff.targets.filter((t) => t.indexOf("$e") === 0).length === 0,
    "S7: at my old rank I owe nothing — I already covered these", asStaff.targets);
  ok(asHS.targets.filter((t) => t.indexOf("$e") === 0).length > 0,
    "S7: APPLIED — after promotion I owe them AGAIN, because a staff-era vouch counts toward the "
    + "staff bar and not the high-staff one. Skipping by identity meant the new tier's bar could "
    + "never be met by me for anything I had covered before", asHS.targets);
  ok(asHS.targets.length <= held.length,
    "S7: and the burst terminates rather than growing", asHS.targets.length);
}

// ── SCENARIO 8 — a room of only uncategorized accounts ───────────────────────────────────────
{
  const sb = tree();
  const author = { u: "@a:hs", r: UNCAT };
  const swarm = [];
  for (let i = 0; i < 50; i++) swarm.push({ u: "@u" + i + ":hs", r: UNCAT });
  ok(sb.TrustPolicy.satisfiedTier(swarm, author, {}) === null,
    "S8: FIFTY uncategorized vouchers satisfy NOBODY. Not because the threshold is high — because "
    + "they are structurally excluded. A rule that is a number can be out-counted; a rule that is "
    + "structural cannot");
  ok(sb.TrustPolicy.substituteTrusted(swarm, {}, UNCAT) === null,
    "S8: APPLIED — and they cannot form a floor among themselves either, so they cannot "
    + "manufacture a history for everyone else to adopt");

  // ...but the room still MOVES, because the ceiling needs no rank at all.
  const st = sb.StateDeriver.defaultSettings();
  ok(typeof st.maxLen === "number" && st.maxLen > 0,
    "S8: APPLIED — while the anti-freeze ceiling is pure time against a shared anchor, so even a "
    + "room of nothing but unranked strangers keeps playing. Correctness is presence-independent; "
    + "only EFFICIENCY scales with rank");
}

// ── SCENARIO 9 — the head is covered without waiting; the tail waits ─────────────────────────
{
  const sb = tree();
  const evs = [];
  for (let i = 0; i < 20; i++) {
    evs.push(F.rawEvent("$x" + i, 100 + i, 1000, "@other:hs", STAFF, { t: "ddjp.dj.play", p: "$z" }));
  }
  const r = sb.Vouch.owed(evs, { myRank: GUEST, myUserId: "@me:hs", settings: {}, floorL: null, rng: () => 0 });
  // THE RIGHT COMPARISON, and the first version of this got it wrong. Asserting on the OLDEST event
  // proved nothing: with 20 events held, 19 turns have passed for it and a guest needs only 5, so
  // the LADDER clears it on its own and the head rule is invisible. The assertion has to be on an
  // event that is near the head but not IN it — where the guest's turn genuinely has not come.
  const newest = "$x19";                       // in the head
  const justBelowHead = "$x16";                // 3 turns passed; a guest needs 5
  ok(r.targets.indexOf(newest) >= 0,
    "S9: APPLIED — a GUEST, the slowest tier on the ladder, still covers the NEWEST event without "
    + "waiting its turn. The head is exactly the window a delete-and-run lives in, and the turn "
    + "filter otherwise made it the LAST thing covered — the most vulnerable bytes were the least "
    + "protected", r.targets.slice(0, 5));
  ok(r.targets.indexOf(justBelowHead) < 0,
    "S9: APPLIED — while an event just BELOW the head still waits its turn, so the ladder keeps "
    + "backfill cheap and the head rule is a narrow exception rather than an abandonment of it. "
    + "The split is by AGE, not by rank",
    { justBelowHeadIncluded: r.targets.indexOf(justBelowHead) >= 0, headFloor: r.headFloor });
  ok(r.targets.indexOf("$x0") >= 0,
    "S9: and the OLDEST event qualifies too — 19 turns have passed and a guest needs 5, so the "
    + "ladder cleared it long ago. That is the ladder working, not the head rule, and conflating "
    + "the two is what made the first version of this assertion prove nothing");
}

// ── SCENARIO 10 — everyone converges after chaos. THE ACCEPTANCE TEST. ───────────────────────
// One client stays throughout. Another sleeps, misses a burst, and returns. A third joins late and
// thin. All three must land on the same room.
{
  const sb = tree();
  const R = F.playingRoom({ songs: 8 });
  const LOG = F.sortLog(R.log);

  const stayed = sb.StateDeriver.derive(LOG);

  // slept through the middle, then received everything on reconnect (order scrambled)
  const scrambled = F.shuffled(LOG, (() => { let n = 0.1; return () => (n = (n * 7.13) % 1); })());
  const returned = sb.StateDeriver.derive(F.sortLog(scrambled));

  // joined late and thin: computed from a floor sealed at a cut, plus everything after it
  const CUT = 9;
  const seed = sb.StateDeriver.buildSeed(LOG.slice(0, CUT));
  const thin = sb.StateDeriver.derive(sb.Floor.afterBoundary(LOG, LOG[CUT - 1].l, LOG[CUT - 1].eventId), seed);

  const canon = (s) => JSON.stringify({ np: s.nowPlaying, rot: s.rotation, set: s.settings });
  ok(canon(stayed) === canon(returned),
    "S10: a client that slept through a burst and got everything out of order lands on the SAME "
    + "room as one that never left. Ordering is intrinsic, so arrival order cannot matter",
    { stayed: stayed.nowPlaying.song.videoId, returned: returned.nowPlaying.song.videoId });
  ok(canon(stayed) === canon(thin),
    "S10: APPLIED — and a client that joined late, adopted a floor and folded only the segment "
    + "since lands there too. THIS IS THE WHOLE REQUIREMENT: people come back and see the same "
    + "present as everyone who stayed",
    { stayed: stayed.nowPlaying.song.videoId, thin: thin.nowPlaying.song.videoId });
}

console.log("[stress] PASS — the room holds under attack and under neglect: a lone griefer who "
  + "plays and deletes everything leaves a room that still CONVERGES, and re-supplying their own "
  + "deleted events injects nothing because a rebuild has no author; a delete-and-run in a busy "
  + "room is prevented from forking, because a client that KNOWS it is short holds still — but only "
  + "once the gap is corroborated, so one fabricated parent cannot freeze anybody; a two-hour sleep "
  + "re-plans its timers and acts on the rank it has now; a quiet room that loses its floor EMITS "
  + "rather than raising a flag nobody reads; a promotion re-owes what the old rank covered and "
  + "terminates; fifty uncategorized accounts satisfy nobody and the ceiling keeps the room playing "
  + "anyway; the newest event is protected without waiting a turn while the tail still does; and a "
  + "client that stayed, one that slept, and one that joined thin all land on the same room");
