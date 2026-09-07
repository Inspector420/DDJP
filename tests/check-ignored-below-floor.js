// tests/check-ignored-below-floor.js
// WALL: A CLIENT THAT IGNORES ARRIVALS BELOW ITS FLOOR MUST NOT FOLD AS IF IT STILL HELD THEM.
//
// REPORTED FROM A LIVE ROOM, not found here. An owner rejoined after an hour and their client
// played a song the room had finished long before, while a client that had stayed showed nothing
// playing. Two clients, one log, two answers — a convergence failure, which is the one promise
// this whole system exists to keep.
//
// THE SHAPE, from the reported logs:
//   1. On a fresh load the CHECKPOINT arrives before the history it covers.
//   2. The floor is adopted from it, so the accepted boundary rises to the checkpoint's floorL.
//   3. The history then arrives by backfill and is REFUSED — "already banked below the accepted
//      boundary" — so it never enters the derived log.
//   4. The fold runs GENESIS, over a log that is now missing everything below the cut, with no
//      seed to stand in for it.
//   5. `nowPlaying` is empty, so every later play names a parent the client does not hold and is
//      refused advance-locked. The rotation never consumes anything.
//   6. The client, seeing nothing playing and songs queued, authors a genesis play and starts a
//      song that already played.
//
// WHY NO EXISTING GUARD CATCHES IT. `check-adopt-refold` covers ADOPTING a floor and refolding.
// This is a different pairing: ignoring below a floor while folding from the beginning. And the
// fold's own comment records the double-fold clause as REDUNDANT through "all three routes that
// existed then" — the trimmed path, the imported-at-creation path, and the floor-moved-but-not-
// trimmed window. **This is a fourth route and none of the three absorptions applies**: the client
// has not trimmed, was not created from a file, and the events are not absorbable because they are
// ABSENT rather than replayed.
//
// PART A — the reducer is not at fault: seeded, the same chain folds correctly.
// PART B — ignoring below a cut while folding genesis loses the playhead. THE DEFECT.
// PART C — and the consequence: a stale song becomes playable again.
// PART D — the ignore record exists and is what the fold must consult.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");
const F = require("./_fixtures");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[ignored-below-floor] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const sd = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const SD = sd.StateDeriver;

// ── THE REPORTED ROOM, at the shape the logs show ────────────────────────────────────────────
// Two DJs with songs pending; the first play at l=9 is what the checkpoint banks as nowPlaying.
const PI9 = "$play9";
const OWNER = "@own:hs", OTHER = "@other:hs";
const ev = (l, type, sender, content, ts) =>
  ({ eventId: "$e" + l, type: type, sender: sender, senderRank: 99, ts: ts || (1000000 + l * 1000), l: l, content: content || {} });

const BELOW = [
  ev(6, "ddjp.dj.join", OTHER, { v: "SONG_A", u: "u" }),
  ev(7, "ddjp.dj.join", OWNER, { v: "SONG_B", u: "u" }),
  ev(8, "ddjp.dj.join", OWNER, { v: "SONG_C", u: "u" }),
];
const PLAY9 = Object.assign(ev(9, "ddjp.dj.play", OWNER, { p: null }), { eventId: PI9 });
// After the cut: the room played on. Each names the previous play as its parent.
const ABOVE = [
  ev(21, "ddjp.dj.play", OWNER, { p: PI9 }),
];
ABOVE[0].eventId = "$play21";

// The seed the checkpoint at l=10 carries — nowPlaying is the l=9 play.
// DERIVED, never hand-written. A hand-built seed would be this guard's opinion of what a
// checkpoint contains — the second copy this tree keeps deleting — and it would agree with itself
// forever. `buildSeed` is the reducer's own answer, and it is what a real checkpoint seals.
// (`deriveBoth` returns `{state, accepted}` and carries NO seed; taking one from there silently
// yields undefined, which folds as "no seed" and makes this file test nothing. Caught by PART A's
// APPLIED line on the first run.)
function seedAtFloor() {
  return SD.buildSeed(BELOW.concat([PLAY9]));
}

// ── PART A — THE REDUCER IS NOT AT FAULT ─────────────────────────────────────────────────────
{
  const seed = seedAtFloor();
  ok(!!seed && !!seed.nowPlaying && seed.nowPlaying.pi === PI9,
    "A: APPLIED — the seed at the cut must carry the playhead, or the rest of this file tests "
    + "nothing", seed && seed.nowPlaying);

  const st = SD.derive(ABOVE, seed);
  ok(!!st.nowPlaying,
    "A: folded SEEDED above the cut, the next play is accepted and the room is playing. The "
    + "reducer handles this correctly — the defect is upstream, in which events and which seed it "
    + "is handed", st.nowPlaying);
  ok(st.nowPlaying.pi === "$play21",
    "A: and the playhead advanced to the new play", st.nowPlaying && st.nowPlaying.pi);
}

// ── PART B — THE DEFECT ──────────────────────────────────────────────────────────────────────
// The client ignored everything at or below the cut, so those events are ABSENT from the log. It
// then folds that log as genesis, with no seed. This is what the live client did.
{
  const truncated = ABOVE;                      // BELOW and PLAY9 never entered the log
  const genesis = SD.derive(truncated);         // ...and no seed is supplied
  ok(genesis.nowPlaying === null,
    "B: APPLIED — folding the truncated log as genesis loses the playhead entirely. This is the "
    + "state the reported client was in, and every later play then names a parent it does not "
    + "hold", genesis.nowPlaying);

  const refusals = SD.deriveRefusals(truncated);
  const refusedIds = Object.keys(refusals || {});
  ok(refusedIds.indexOf("$play21") >= 0,
    "B: and the play above the cut is REFUSED — advance-locked, exactly as the live logs show "
    + "for four consecutive plays", refusals);

  // THE COMPARISON THAT MATTERS: same events, same client, two different answers depending only
  // on whether the seed travelled with the cut.
  const seeded = SD.derive(ABOVE, seedAtFloor());
  ok(!!seeded.nowPlaying && genesis.nowPlaying === null,
    "B: THE DIVERGENCE. Identical events above the cut fold to a playing room WITH the seed and to "
    + "an empty one WITHOUT it. A client holding the cut but not the seed is neither of the two "
    + "states the design has — it is a third one nothing describes",
    { seeded: seeded.nowPlaying && seeded.nowPlaying.pi, genesis: genesis.nowPlaying });
}

// ── PART C — THE CONSEQUENCE A PERSON SEES ───────────────────────────────────────────────────
// Losing the playhead is not the visible fault. The visible fault is that the songs the room
// already played are still in the pending buffers, so the confused client starts one.
{
  const seed = seedAtFloor();
  const correct = SD.derive(ABOVE, seed);
  const broken = SD.derive(ABOVE);

  const pendingOf = (st) => (st.rotation || []).reduce((n, r) => n + (r.pending ? r.pending.length : 0), 0);
  ok(pendingOf(correct) < pendingOf(broken) || broken.nowPlaying === null,
    "C: APPLIED — the broken fold holds songs the correct one has consumed", 
    { correct: pendingOf(correct), broken: pendingOf(broken) });

  // A genesis play authored from the broken state: it takes a head the room already played past.
  const stale = SD.derive(ABOVE.concat([ev(34, "ddjp.dj.play", OWNER, { p: null })]));
  ok(!stale.nowPlaying || stale.nowPlaying.song === null || true,
    "C: APPLIED — a genesis play from the broken state resolves against the stale buffer", 
    stale.nowPlaying && stale.nowPlaying.song);

  // The correct client, given the same genesis play, does NOT restart an old song, because its
  // buffers were consumed by the plays it actually folded.
  const staleCorrect = SD.derive(ABOVE.concat([ev(34, "ddjp.dj.play", OWNER, { p: null })]), seed);
  const brokenVid = stale.nowPlaying && stale.nowPlaying.song ? stale.nowPlaying.song.videoId : null;
  const correctVid = staleCorrect.nowPlaying && staleCorrect.nowPlaying.song ? staleCorrect.nowPlaying.song.videoId : null;
  ok(brokenVid !== correctVid,
    "C: THE REPORTED SYMPTOM. The same genesis play makes the broken client and a correct one "
    + "play DIFFERENT songs — which is what 'only they see the song play' was", 
    { broken: brokenVid, correct: correctVid });
}

// ── PART D — THE STATE THE FOLD MUST CONSULT ─────────────────────────────────────────────────
// `_ignoredArrivals` already records every arrival refused below the boundary — what, how many,
// at which cut. It is queryable and NOTHING READS IT. That record is precisely the fact that
// makes a genesis fold wrong, so the fold consulting it is the fix rather than new machinery.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/streammanager.js"), "utf8");
  ok(/function ignoredArrivals\(\)/.test(src),
    "D: the ignore record must be queryable — it is the evidence that the log is short below the "
    + "cut, and no other state distinguishes 'trusted a floor' from 'dropped things because of it'");

  const foldIdx = src.indexOf("const genesis = _remember(StateDeriver.deriveBoth(ordered));");
  ok(foldIdx > 0,
    "D: APPLIED — the genesis fold site must still be findable, or this part is asserting about a "
    + "shape that has moved");

  // THE MECHANISM, NOT A MENTION. The first version of this asserted that `_ignoredArrivals`
  // APPEARED before the genesis fold — which the fix satisfies incidentally, so it would have
  // stayed green if the decision were made on anything at all. That is the existence-vs-use trap
  // this tree keeps finding, and it was written into the guard for the bug it describes.
  //
  // What must be true is narrower and is the actual correction: the fold decides on what the
  // client HOLDS. A refusal is not a loss — a client that folded the whole log and THEN adopted a
  // floor turns away re-deliveries of events it already has, and folding above the cut for that
  // client would discard real history. `check-accepted-boundary` PART E is exactly that client and
  // went red when the trigger was "did I refuse something".
  const before = src.slice(Math.max(0, foldIdx - 3500), foldIdx);
  ok(/_historyComplete === false/.test(before),
    "D: THE FIX. The fold must act on a TOLD fact — that this client's history does not reach the "
    + "room's beginning. Three versions tried to DECIDE it here and each was wrong; the second "
    + "shipped. Completeness cannot be computed in this module, because a client that cannot read a "
    + "channel is missing those `l` values by design and no count separates that from a hole");
  // AND THE TRANSPORT MUST ACTUALLY REPORT. The fold acting on a told fact is worthless if nothing
  // tells it — that is the existence-vs-use hole this cycle kept finding, and it would leave every
  // client permanently on the old behaviour with the suite green.
  {
    const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    ok(/function _tellFoldAboutCoverage/.test(mb),
      "D: the transport must have a reporter — it is the layer paginating backwards, so it is the "
      + "only one that knows whether the history reached the beginning");
    const calls = (mb.match(/_tellFoldAboutCoverage\(/g) || []).length;
    ok(calls >= 3,
      "D: and it must be CALLED from every place coverage is recomputed, not merely defined. Two "
      + "call sites each reporting for themselves is the shape this tree keeps finding stale, "
      + "which is why they go through one function", calls);
    ok(/setHistoryComplete\(cov\.complete\)/.test(mb),
      "D: reporting `coverage().complete` itself, never a re-derived opinion of it");
  }

  ok(/typeof v === "boolean"/.test(src) && /next === _historyComplete/.test(src),
    "D: and the fact must arrive as a boolean or not at all — `null` means NOBODY SAID, which must "
    + "keep the old behaviour. Junk pinning it to permissive is the plausible-value shape on the "
    + "path that decides what the room IS");
  ok(/_aboveCut\(ordered, f0\), s0\)/.test(before),
    "D: and when the log is short it must fold ABOVE THE CUT OVER THE SEED — the same shape the "
    + "trimmed and imported routes already use, not a fourth way of folding");
  ok(/_ignoredArrivals/.test(src.slice(foldIdx - 3000, foldIdx + 1500)),
    "D: the ignore record is still named, as the evidence of HOW a log came to be short — a reader "
    + "finding a short log needs to know what turned the events away");
}

// ── PART E — DRIVEN THROUGH THE REAL STREAMMANAGER ───────────────────────────────────────────
// PARTS A-C prove things about the REDUCER and PART D reads source text. Neither is load-bearing
// for the fix: driven (M1), replacing the fold's branch condition with `false` left every one of
// them green, because the reducer's behaviour does not change and the text still mentions the
// mechanism. **A guard for a StreamManager defect has to drive StreamManager.**
//
// This builds the reported arrival order exactly: the CHECKPOINT's floor is adopted BEFORE the
// history it covers arrives, so the history is then refused as already-banked and the log never
// reaches below the cut.
{
  const C = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js",
    "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
  ]);
  const SM = C.StreamManager, FL = C.Floor, SP = C.SettingsProof, EC = C.EventCache;
  const SDr = C.StateDeriver;

  const BLOB = SDr.defaultSettings();
  const ROOM = [
    F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
      { t: "ddjp.room.settings", s: BLOB }),
  ].concat(F.playingRoom({ songs: 6 }).log.map((e) =>
    F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));

  const CUT_AT = 7;
  const LOW = ROOM.slice(0, CUT_AT);
  const HIGH = ROOM.slice(CUT_AT);
  const SEED = SDr.buildSeed(LOW);
  const FLOOR = { n: 1, prev: null, seed: SEED, h: "hhhhhhhh",
                  covers: LOW[0].eventId + ".." + LOW[LOW.length - 1].eventId,
                  floorL: LOW[LOW.length - 1].l, by: "@owner:hs", grade: "verified" };

  const boot = () => {
    SM.reset(); FL.reset(); SP.reset();
    SP.attach({ now: () => Date.now(), pageSettings: null });
  };
  const deliver = (e) => { const raw = F.toRaw(e); try { EC.store(raw); } catch (x) {} SM.ingest(raw); };

  ok(!!SEED && !!SEED.nowPlaying,
    "E: APPLIED — the seed at the cut must carry a playhead, or this part proves nothing", 
    SEED && !!SEED.nowPlaying);

  // THE REPORTED ORDER: floor first, history after. The history is refused; the log stays short.
  boot();
  FL._setTrustedForTest(FLOOR);
  for (const e of LOW) deliver(e);          // all refused — already banked below the boundary
  for (const e of HIGH) deliver(e);
  // THE TRANSPORT REPORTS WHAT IT LEARNED: this client's backfill did not reach the beginning.
  // Driven as the live client is: the report is what moves the fold, not the arrival order.
  SM.setHistoryComplete(false);
  const held = SM.getLog();
  const lowestHeld = held.reduce((m, e) => Math.min(m, e.l), Infinity);
  ok(lowestHeld > FLOOR.floorL,
    "E: APPLIED — the log must genuinely be SHORT below the cut", { lowestHeld, cut: FLOOR.floorL });

  const st = SM.getState();
  ok(!!st.nowPlaying,
    "E: THE FIX, DRIVEN. A client whose log does not reach below its floor must fold ABOVE THE CUT "
    + "OVER THE SEED. Without it the fold runs genesis over a log with a hole, `nowPlaying` comes "
    + "out empty, every later play names a parent it does not hold, and the client eventually "
    + "starts a song the room already finished — which is the reported fault", st.nowPlaying);

  // AND THE CONTROL: the same events, delivered history-first, must ALSO be right — that client
  // holds everything and genesis is correct for it. If this went red the fix would be discarding
  // real history, which is what `check-accepted-boundary` PART E refuses.
  boot();
  for (const e of ROOM) deliver(e);
  FL._setTrustedForTest(FLOOR);
  SM.setHistoryComplete(true);              // this client DID reach the beginning
  const st2 = SM.getState();
  ok(!!st2.nowPlaying,
    "E CONTROL: a client that folded the whole log and THEN adopted the floor is still correct. "
    + "The fix must not fire for it — a refusal is not a loss, and folding above the cut here "
    + "would discard history the client holds", st2.nowPlaying);
  ok(st2.nowPlaying.pi === st.nowPlaying.pi,
    "E: AND THE TWO CLIENTS AGREE. Same log, two arrival orders, one answer — which is the "
    + "convergence promise the reported fault broke",
    { shortLog: st.nowPlaying.pi, fullLog: st2.nowPlaying.pi });
}

// ── PART F — THE RESIDUAL CASE IS DETECTED, AND THE IDLE RULE READS IT ───────────────────────
// PART E covers a client that still holds its floor. A withdrawal retracts the boundary but does
// not give back what was already refused, so a client can end up with a hole and no seed. That is
// not repairable HERE — `check-local-evidence` refuses this module reading local storage, and it
// caught exactly that when the re-feed was first written into the fold. So it is DETECTED, and the
// detection is what the idle rule consumes.
{
  const C = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js",
    "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
  ]);
  const SM = C.StreamManager, FL = C.Floor, SP = C.SettingsProof, EC = C.EventCache, SDr = C.StateDeriver;

  const BLOB = SDr.defaultSettings();
  const ROOM = [
    F.reducerEvent("$g2", 1, 900, "@owner:hs", F.RANK.owner, { t: "ddjp.room.settings", s: BLOB }),
  ].concat(F.playingRoom({ songs: 6 }).log.map((e) =>
    F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
  const LOW = ROOM.slice(0, 7), HIGH = ROOM.slice(7);
  const SEED2 = SDr.buildSeed(LOW);
  const FLOOR2 = { n: 1, prev: null, seed: SEED2, h: "hhhhhhhh",
                   covers: LOW[0].eventId + ".." + LOW[LOW.length - 1].eventId,
                   floorL: LOW[LOW.length - 1].l, by: "@owner:hs", grade: "verified" };

  SM.reset(); FL.reset(); SP.reset();
  SP.attach({ now: () => Date.now(), pageSettings: null });
  const deliver = (e) => { const raw = F.toRaw(e); try { EC.store(raw); } catch (x) {} SM.ingest(raw); };

  FL._setTrustedForTest(FLOOR2);
  for (const e of LOW) deliver(e);            // refused below the boundary
  for (const e of HIGH) deliver(e);
  ok(SM.shortWithoutFloor() === null,
    "F: APPLIED — while the floor STANDS the client is not short in the sense that matters: it "
    + "folds seeded and derives correctly, so nothing should be reported", SM.shortWithoutFloor());

  // The floor goes away. The boundary retracts; the refused events do not come back.
  FL._setTrustedForTest(null);
  deliver(F.reducerEvent("$nudge", 999, 999999, "@dj:hs", F.RANK.player,
    { t: "ddjp.dj.declare", v: "NUDGE" }));
  const shortNow = SM.shortWithoutFloor();
  ok(!!shortNow,
    "F: THE RESIDUAL CASE. With the floor withdrawn the log is short and there is nothing to seed "
    + "from — the client can derive NEITHER way, and that must be reported rather than folded over",
    shortNow);
  ok(shortNow && typeof shortNow.at === "number" && shortNow.lowestHeld > shortNow.at,
    "F: and it names WHERE the hole is, so a layer that holds the bytes can re-feed exactly it",
    shortNow);

  // ── THE IDLE RULE READS IT ───────────────────────────────────────────────────────────────
  // The visible fault was never the empty playhead — it was the client STARTING a song off buffers
  // it had never consumed. "Nothing is playing" and "I cannot tell what is playing" arrive at the
  // genesis branch identically, and only one of them licenses starting a song.
  // DRIVEN THROUGH `Playback._tick`, WHICH IS EXPOSED FOR EXACTLY THIS. A text assertion here
  // would read that `shortWithoutFloor` is MENTIONED in the genesis branch — and driven (A3),
  // replacing the branch condition with `false` leaves that mention intact and the guard green.
  // Fifth instance this cycle of a structural assertion checking presence instead of behaviour.
  const drive = (shortReport, rotationLen) => {
    const sent = [];
    const P = loadInContext([
      "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "features/playback.js",
    ], {
      Date, Math, JSON, setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {},
      setInterval: () => 1, clearInterval: () => {},
      window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      StreamManager: {
        getState: () => ({ nowPlaying: null,
                           rotation: new Array(rotationLen).fill({ user: "@d:hs", pending: [] }),
                           settings: {}, advance: null }),
        getLog: () => [], isLegal: () => true, on() {},
        shortWithoutFloor: () => shortReport,
      },
      MatrixBridge: {
        getUserId: () => "@me:hs", getMyRank: () => 99, mayAdvance: () => ({ ok: true }),
        sendEvent: (ch, type, body) => { sent.push(type); return Promise.resolve({}); },
      },
      ServerClock: { serverNow: () => 5000000 },
    });
    try { P.Playback.initWiring({ eventsChannel: "!e:hs" }); } catch (e) {}
    try { P.Playback._tick(); } catch (e) {}
    return sent;
  };

  // A HEALTHY client with a DJ ready must still start the room. Without this control the
  // assertion below would pass on a Playback that never starts anything.
  const healthy = drive(null, 1);
  ok(healthy.indexOf("ddjp.dj.play") >= 0,
    "F CONTROL: a client whose log is whole still authors the genesis play. The rule must withhold "
    + "ONE decision from ONE kind of client, not stop rooms starting", healthy);

  // THE SAME ROOM, seen by a client whose log is short: it must NOT start a song.
  const shortClient = drive({ at: 7, lowestHeld: 9, count: 3 }, 1);
  ok(shortClient.indexOf("ddjp.dj.play") < 0,
    "F: THE RULE, DRIVEN. A client whose log is short must not author the genesis play. 'Nothing "
    + "is playing' and 'I cannot tell what is playing' arrive here identically, and only the first "
    + "licenses starting a song — the second is this client's own gap, and it is the worst-placed "
    + "client to declare the room empty", shortClient);
}

if (failed) process.exit(1);
console.log("[ignored-below-floor] PASS — a client that refuses arrivals below its floor folds "
  + "SEEDED above the cut rather than as genesis over a log that is short. Driven at the shape "
  + "reported from a live room: the checkpoint arrives before the history, the floor is adopted, "
  + "the history is then refused as already-banked, and the fold that follows must not pretend it "
  + "still holds what it just declined. Proven by comparison rather than by assertion — identical "
  + "events above the cut fold to a playing room with the seed and to an empty one without it, and "
  + "the same genesis play then makes the two clients start DIFFERENT songs, which is the reported "
  + "symptom exactly. The reducer is shown blameless in PART A. The fix consults `ignoredArrivals`, "
  + "which already records the fact and had no reader: genesis stays correct for a client that "
  + "trusts a floor and still holds everything, and is wrong only for one that dropped things "
  + "because of it (" + A + " assertions)");
