// tests/check-blocked-skip.js
// SUBJECT: features/mediablocked.js, backends/backend1/statederiver.js
// BOTH SIDES, because the guard exists BECAUSE they must agree (compares-two, `ddjp_366` — this row
// was declared before that rule and named only the authoring half). The WALL below already says so:
// a client AUTHORS a reasoned skip and the reducer JUDGES it, re-validating the same tally. Two
// behaviours in two disjoint sandboxes — PARTS A/B/C/E load `capabilities.js` + `mediablocked.js` and
// never the reducer; PART D loads `statederiver.js` and never `mediablocked.js`, drives `SD.derive`
// four times and asserts on its verdicts ("a media.skip with no road met must be rejected by the
// reducer"). `capabilities.js` is NOT a subject: it is loaded so `mediablocked.js` resolves and never
// appears as `Capabilities.` anywhere in the file.
// WALL: the blocked-skip escape (features/mediablocked.js + the reducer's ddjp.media.skip
// advance). When too few clients can see a song (per the skip roads), a client authors a REASONED
// ddjp.media.skip; it is judged as a real, advance-locked skip so N competing escapes resolve to
// ONE. Below the roads → no early skip (the ceiling backstops, tested in check-ceiling-convergence).
//
// ── THE AUTHOR'S RANK DOES NOT GATE THIS, AND THIS HEADER SAID IT DID (J42) ──────────────────
// It read "the highest-present VIP+ authority authors" and "Sub-VIP never authors", with a PART B
// promising a rank refusal. The body below has asserted the OPPOSITE since the escape was built:
// a GUEST authors it, and the assertion message says why — "room decides, not rank".
//
// The ROOM derives the escape from the blocked-report tally across rank BANDS, and the reducer
// re-validates that tally when it folds the skip — so the author cannot fake it, and no rank gate
// is needed to stop them. Gating by rank instead would break the case the roads exist for: a room
// with no VIPs present must still be able to escape a dead song. `ddjp.media.skip` is deliberately
// absent from `Ranks.GATES` and from `Capabilities` for exactly this reason — see
// `docs/main/10-capabilities.md` and `docs/consensus/blocked-content-survival.md` §Who authors.
//
// The rank a client HAS still decides WHEN it tries — `Ranks.staggerMs` gives seniors the earlier
// slot — but the last one to the line may still author it, and that is the design rather than a
// gap. Rank orders the attempt; the roads authorise it.
//
// Guarantees:
//   PART A — ANY RANK AUTHORS past threshold. With enough blocked reports to meet a skip road,
//     a client authors exactly one ddjp.media.skip carrying the reason (tally/threshold) — driven
//     at VIP and, separately, at GUEST in a room with no VIPs at all.
//   PART B — RE-CHECKED AT FIRE TIME. If the derived decision flips off during the stagger wait,
//     nothing is sent. (This is the slot PART B's rank refusal used to occupy; the roads are what
//     is enforced here, so this is what there is to enforce.)
//   PART C — BELOW THRESHOLD → NO SKIP. If enough can still see it, no skip is authored.
//   PART D — REASONED + ADVANCE-LOCKED. ddjp.media.skip advances the rotation like a skip, has its
//     tally re-validated by the reducer, and N competing escapes resolve to exactly ONE.
//   PART E — PRESENCE FROM SPINE. present count = distinct recent senders in the log (shared).
//   PART F — THE ESCAPE WAITS FOR ITS MOMENT AND ASKS ONCE (J153, `ddjp_721`). On a fake clock, against the REAL module and the
//     real `Playback` (for its ADVANCE_RESEND_MS): a refused media.skip's echo does not re-arm the escape (720 sent 49 in 2 s
//     from an owner-tier screen; the read-through's skip-loop probe, driven here); the escape goes no sooner than
//     `advance.skipAt` and no later for a length that holds only the play (`earliestAt`); a ranked length that ends the room's
//     willingness while it waits sends nothing (J153, `ddjp_722`); no second escape before the answer (or its deadline), and
//     the next only ADVANCE_RESEND_MS after it.
//   PART G — QUIET ONCE THE ROOM WILL ACT (J153, `ddjp_721`). A report whose timer fires once the room's advance for the same
//     playing says the skip is warranted is not sent, and the same for the retry of a report that got no answer; each
//     beside a control in which the room does not yet act, which sends. This is the re-check `check-spine` names for a
//     blocked report.
//   PART H — THE QUIET PERSON REPORTS AFTER ALL (J153, `ddjp_722`). The room's willingness can turn false within a playing: a
//     ranked length closes the dead-song route. A person who stayed quiet then owes their report, so `MediaBlocked` listens for
//     `ddjp.play.len`: after a ranked length the report goes, once, in its rank slot; a length that changes nothing (an
//     unranked one, the room still acting) and one for another playing send nothing.

const assert = require("assert");
const { loadInContext } = require("./_load");
const RANK = { OWNER: 100, VIP: 40, PLAYER: 20, GUEST: 10, UNCAT: 0 };

function fail(msg, got) {
  console.log("[blocked-skip] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// Harness with a settable log tail (for presence) + nowPlaying + rank.
function harness(me, myRank, logTail) {
  let np = { pi: "$p1", startedAt: 0, song: { songKey: "yt:AAAAAAAAAAA" }, settings: { maxLen: 600 } };
  const subs = {};
  const sent = [];
  let adv = null;   // the reducer-derived advance decision; tests set it via setAdvance
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [], advance: adv }; },
    getLog() { return logTail || []; },
    on(t, fn) { (subs[t] = subs[t] || []).push(fn); },
    off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
  };
  const MatrixBridge = {
    getUserId() { return me; },
    getMyRank() { return myRank; },
    async sendEvent(ch, type, content) { sent.push({ type, content }); },
  };
  const Logger = { info() {}, warn() {}, debug() {} };
  return {
    StreamManager, MatrixBridge, Logger, sent, subs,
    setAdvance(a) { adv = a; },
    emitBlocked(p, sender) { const e = { type: "ddjp.play.blocked", sender, content: { pi: p } }; for (const fn of subs["ddjp.play.blocked"] || []) fn(e); },
  };
}
function load(h, myRank) {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"], {
    StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Logger: h.Logger,
    setTimeout, clearTimeout, Date,
  });
  if (!sb.MediaBlocked) fail("MediaBlocked did not load");
  sb.MediaBlocked.setMyRank(myRank);
  return sb.MediaBlocked;
}

// present = 4 distinct recent senders in the log tail
const LOG4 = [
  { sender: "@a:hs" }, { sender: "@b:hs" }, { sender: "@c:hs" }, { sender: "@d:hs" },
];

// ---- FEATURE-SIDE AUTHORING (roads model) --------------------------------------
// The feature no longer computes its own threshold. It authors a media.skip when the REDUCER
// has derived that a road is met (advance.skipWarranted), staggered by rank, and the reducer
// re-validates the tally. So these tests drive the derived `advance` object, not a raw count.

// authors exactly one escape when the room has derived a skip is warranted
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  // not warranted yet -> silence
  h.setAdvance({ pi: "$p1", skipWarranted: false, blockedGuestPlus: 2, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 0) fail("no skip while the room has not derived one", h.sent);
  // road met -> the reducer says skipWarranted -> author exactly one, from ANY rank (guest here)
  h.setAdvance({ pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 1) fail("author exactly one escape once the room derives a skip", h.sent);
  assert.strictEqual(h.sent[0].type, "ddjp.media.skip", "escape is a ddjp.media.skip");
  assert.strictEqual(h.sent[0].content.p, "$p1", "escape carries p (advance-lock anchor)");
  assert.strictEqual(h.sent[0].content.blockedGuestPlus, 5, "reason carries the derived guest+ tally");
})();

// a room with NO VIPs still escapes: a guest authors it because the ROOM derived it (not rank)
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  h.setAdvance({ pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 1) fail("a room with no VIPs still authors the escape (room decides, not rank)", h.sent);
})();

// the road is re-checked at fire time: if the derived decision flips off, nothing is sent
(() => {
  const h = harness("@g:hs", RANK.GUEST, LOG4);
  const M = load(h, RANK.GUEST);
  M.init("!ev:hs");
  h.setAdvance({ pi: "$p1", skipWarranted: false, blockedGuestPlus: 2, blockedVipPlus: 0 });
  M._maybeAuthorSkip("$p1");
  if (h.sent.length !== 0) fail("no skip when the road is not met at fire time", h.sent);
})();


// ---- PART D: reasoned skip advances + advance-locked to one ---------------------
(() => {
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
  const SD = ctx.StateDeriver;
  let L = 0;
  const mk = (type, sender, rank, body) => { L++; return { eventId: "$e" + L, type, sender, senderRank: rank, ts: L * 60000, l: L, content: Object.assign({}, body) }; };
  const base = [
    mk("ddjp.dj.join", "@a:hs", 20, { v: "yt:AAAAAAAAAAA", u: "https://y/a" }),
    mk("ddjp.dj.join", "@b:hs", 20, { v: "yt:BBBBBBBBBBB", u: "https://y/b" }),
  ];
  const genesis = mk("ddjp.dj.play", "@a:hs", 20, { p: null }); base.push(genesis);
  const livePi = genesis.eventId;
  // A media.skip needs its ts past the minGate floor (default 8s) — it is an automatic advance,
  // not a manual skip, so it honors the floor. mk stamps ts = L*60000, well past it.
  // A COUNTING REASON (J06), derived from the reducer's own vocabulary rather than spelled here.
  // This guard is about the ROADS, so its declarations have to be the kind a road counts; an
  // untyped one is accepted and counts toward nothing, which is the reason axis and is
  // `check-blocked-reason`'s subject rather than this file's.
  const COUNTS = Object.keys(SD.BLOCKED_REASONS).find((k) => SD.BLOCKED_REASONS[k].counts);
  if (!COUNTS) fail("setup: the reducer declares no counting blocked reason, so no road here can fire");
  const blocked = (who, rank) => mk("ddjp.play.blocked", who, rank, { pi: livePi, k: COUNTS });

  // A media.skip is authorised by the ROADS, not by the author's rank. The default crowd road is
  // 5 guest+ blocked. With 5 guest-or-above blocked, a media.skip from ANYONE advances — a room
  // with no VIPs must still be able to escape a dead song.
  const enough = base.concat([
    blocked("@g1:hs", RANK.GUEST), blocked("@g2:hs", RANK.GUEST), blocked("@g3:hs", RANK.GUEST),
    blocked("@g4:hs", RANK.GUEST), blocked("@g5:hs", RANK.GUEST),
    mk("ddjp.media.skip", "@g1:hs", RANK.GUEST, { p: livePi }),
  ]);
  const okSkip = SD.derive(enough);
  if (!okSkip.nowPlaying || okSkip.nowPlaying.pi === livePi) fail("a road-backed media.skip should advance the rotation", okSkip.nowPlaying);
  // CHANGED ON PURPOSE (J131's correction, `ddjp_663`): this asserted the NEW song was marked as reached by a skip — the mark
  // History copied onto the wrong song, now gone. The room's skip is recorded on the song it ENDED (`check-history-skip`).
  assert.strictEqual((okSkip.cutShortBy || {})[livePi], "media", "media.skip records the song it cut short as the room's skip");

  // NO road met (too few blocked) -> the same media.skip is REJECTED; the tally is recomputed, so
  // the author cannot assert it.
  const notEnough = base.concat([
    blocked("@g1:hs", RANK.GUEST), blocked("@g2:hs", RANK.GUEST),
    mk("ddjp.media.skip", "@g1:hs", RANK.GUEST, { p: livePi }),
  ]);
  const badSkip = SD.derive(notEnough);
  if (!badSkip.nowPlaying || badSkip.nowPlaying.pi !== livePi) fail("a media.skip with no road met must be rejected by the reducer", badSkip.nowPlaying);

  // uncategorized count toward NO road, so they can never authorise a skip among themselves
  const uncatOnly = base.concat([
    blocked("@u1:hs", RANK.UNCAT), blocked("@u2:hs", RANK.UNCAT), blocked("@u3:hs", RANK.UNCAT),
    blocked("@u4:hs", RANK.UNCAT), blocked("@u5:hs", RANK.UNCAT), blocked("@u6:hs", RANK.UNCAT),
    mk("ddjp.media.skip", "@u1:hs", RANK.UNCAT, { p: livePi }),
  ]);
  const uncatSkip = SD.derive(uncatOnly);
  if (!uncatSkip.nowPlaying || uncatSkip.nowPlaying.pi !== livePi) fail("uncategorized can never reach a road - their skip is rejected", uncatSkip.nowPlaying);

  // N competing road-backed escapes -> advance-lock keeps exactly ONE
  const many = enough.slice();
  for (let i = 0; i < 5; i++) many.push(mk("ddjp.media.skip", "@g" + i + ":hs", RANK.GUEST, { p: livePi }));
  const st = SD.derive(many);
  if (st.history.length !== 2) fail("N competing escapes must resolve to exactly ONE advance (advance-lock)", { plays: st.history.length });
})();

// ---- PARTS F and G: a fake clock, the real module ------------------------------------------------------------------
// The timers, `Date.now()` and `ServerClock.serverNow()` all read one fake clock, and every promise the module chains is let
// run between timers, so an answer arriving 40 ms after a send is an answer the module sees before its next timer.
function clockWorld(myRank, o) {
  const opts = o || {};
  let now = 0, seq = 0;
  const timers = [];
  const setT = (fn, ms) => { const t = { id: ++seq, at: now + Math.max(0, Number(ms) || 0), fn }; timers.push(t); return t.id; };
  const clrT = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const np = { pi: "$p1", startedAt: 0, song: { songKey: "yt:AAAAAAAAAAA" }, settings: { maxLen: 600 } };
  const world = { adv: null, sent: [], said: [], answers: opts.answers || null };
  const subs = {};
  const StreamManager = {
    getState: () => ({ nowPlaying: np, rotation: [], advance: world.adv, settings: { vouchJitter: 1000 } }),
    getLog: () => [], on(t, fn) { (subs[t] = subs[t] || []).push(fn); }, off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
    blockedReasons: () => JSON.parse(JSON.stringify(world.REASONS || {})),
  };
  const MatrixBridge = {
    getUserId: () => "@me:hs",
    sendEvent(ch, type, content) {
      const id = "$s" + (world.sent.length + 1);
      world.sent.push({ type, content, at: now, id });
      // THE ECHO, 40 ms later: ingested, REFUSED (the state is unchanged) and still notified, as `StreamManager.notify` does.
      if (type === "ddjp.media.skip") setT(() => { for (const fn of (subs[type] || []).slice()) fn({ type, sender: "@me:hs", content }); }, 40);
      return Promise.resolve({ eventId: id });
    },
  };
  // THE ANSWER: "refused" 40 ms after the send, or "none" at the transport's deadline (`opts.answers`); absent, no transport answer.
  if (world.answers) MatrixBridge.awaitAnswer = (id) => new Promise((res) => setT(() => res({ status: world.answers.status }), world.answers.afterMs));
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/playback.js", "features/mediablocked.js"], {
    StreamManager, MatrixBridge, Logger: { info: (m) => world.said.push(String(m)), warn() {}, debug() {} },
    ServerClock: { serverNow: () => now }, Date: { now: () => now }, setTimeout: setT, clearTimeout: clrT,
  });
  world.M = sb.MediaBlocked; world.P = sb.Playback;
  world.M.setMyRank(myRank);
  const flush = () => new Promise((r) => setImmediate(r));
  world.now = () => now;
  world.emit = (type, entry) => { for (const fn of (subs[type] || []).slice()) fn(entry); };
  world.runUntil = async (T) => {
    if (typeof T !== "number" || !isFinite(T)) throw new Error("runUntil: no finite time to run to");
    await flush(); await flush();
    // A CIRCUIT BREAKER, so a module that re-arms itself without time passing (a broken resend wait) is a RESULT the rows read
    // — sends piling up at one instant — rather than a guard that never finishes and reads as a timeout.
    let sameInstant = 0, last = -1;
    for (;;) {
      timers.sort((a, b) => (a.at - b.at) || (a.id - b.id));
      const t = timers[0];
      if (!t || t.at > T) break;
      sameInstant = (t.at === last) ? sameInstant + 1 : 0; last = t.at;
      if (sameInstant > 500) { world.runaway = true; break; }
      timers.shift(); now = t.at; t.fn();
      await flush(); await flush();
    }
    if (!world.runaway) now = T;
  };
  return world;
}
const skips = (w) => w.sent.filter((x) => x.type === "ddjp.media.skip");
const reports = (w) => w.sent.filter((x) => x.type === "ddjp.play.blocked");

(async () => {
  // These parts COLLECT rather than exit, so one run names every row that fails (attribution, as `check-blocked-reason` does).
  let ffails = 0;
  const ffail = (msg, got) => { ffails++; console.log("[blocked-skip] FAIL — " + msg); if (got !== undefined) console.log("      got " + JSON.stringify(got)); };
  const SDR = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date }).StateDeriver;
  const REASONS = SDR.BLOCKED_REASONS;
  const COUNTS = Object.keys(REASONS).find((k) => REASONS[k].counts);
  // The view as the reducer gives it: `skipAt` is the room skip's moment, `earliestAt` the plain play's gate (J153: two fields,
  // since a length can hold a play and not a room skip). Equal here unless a row says otherwise.
  const WARRANT = (skipAt, earliestAt) => ({ pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0, skipAt: skipAt,
    earliestAt: (earliestAt === undefined) ? skipAt : earliestAt });

  // F1 — THE LOOP (the read-through's skip-loop probe, driven): owner tier (slot 0), the gate open by the view's clock, every
  // escape refused and echoed 40 ms later, no transport answer. 720 sent 49 in 2 s.
  {
    const w = clockWorld(RANK.OWNER);
    w.adv = WARRANT(0);
    w.M.init("!ev:hs");
    await w.runUntil(2000);
    if (skips(w).length < 1) ffail("F1 PREMISE — the escape was never sent, so nothing below measures the loop", w.sent);
    if (skips(w).length > 1) ffail("F1 — A REFUSED media.skip's ECHO RE-ARMED THE ESCAPE: " + skips(w).length + " sent in 2 s from an owner-tier " +
      "screen (720: 49). An event that did not change the playing must not re-arm it (J153)", skips(w).map((x) => x.at));
  }
  // F2 — ASKS ONCE, AND THE NEXT ONLY ADVANCE_RESEND_MS AFTER THE ANSWER: every escape refused 40 ms after it is sent.
  {
    const w = clockWorld(RANK.OWNER, { answers: { status: "refused", afterMs: 40 } });
    const R0 = w.P.ADVANCE_RESEND_MS;
    if (typeof R0 !== "number" || R0 <= 0) ffail("F2 PREMISE — the real Playback exposes no ADVANCE_RESEND_MS to read", R0);
    // With the premise failed (the run is red already) the rows still measure, against the 5 s the next-song advance uses.
    const R = (typeof R0 === "number" && R0 > 0) ? R0 : 5000;
    w.adv = WARRANT(0);
    w.M.init("!ev:hs");
    await w.runUntil(2 * R + 2000);
    const at = skips(w).map((x) => x.at);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    if (at.length < 2) ffail("F2 PREMISE — no second escape after a refusal: a refused escape must be asked again, after the wait", at);
    if (gaps.some((g) => g < R + 40)) ffail("F2 — AFTER A REFUSAL THE NEXT ESCAPE WAITS ADVANCE_RESEND_MS FROM THE ANSWER (the next-song advance's " +
      "shape, `features/playback.js`), never sooner", { at: at, resendMs: R });
    if (at.length > 3) ffail("F2 — more escapes than one per answer and wait", at);
  }
  // F3 — NO SECOND ESCAPE BEFORE THE ANSWER: the transport answers "none" only at its deadline (22 s here).
  {
    const w = clockWorld(RANK.OWNER, { answers: { status: "none", afterMs: 22000 } });
    const R = (typeof w.P.ADVANCE_RESEND_MS === "number" && w.P.ADVANCE_RESEND_MS > 0) ? w.P.ADVANCE_RESEND_MS : 5000;   // as F2
    w.adv = WARRANT(0);
    w.M.init("!ev:hs");
    await w.runUntil(1000);
    // A NEW PERSON'S REPORT ARRIVES WHILE THE ESCAPE WAITS FOR ITS ANSWER: it asks the escape to arm again, which it must not.
    w.emit("ddjp.play.blocked", { type: "ddjp.play.blocked", sender: "@late:hs", content: { pi: "$p1", k: COUNTS } });
    await w.runUntil(21000);
    if (skips(w).length !== 1) ffail("F3 — A SECOND ESCAPE WENT BEFORE THE FIRST ONE'S ANSWER (or its deadline), though a new report asked it to arm", skips(w).map((x) => x.at));
    await w.runUntil(22000 + R + 100);
    if (skips(w).length !== 2 || skips(w)[1].at < 22000 + R) ffail("F3 — once the deadline answers, the next escape follows after ADVANCE_RESEND_MS, once", skips(w).map((x) => x.at));
  }
  // F4 — THE ESCAPE WAITS FOR advance.skipAt, by the shared clock. CHANGED ON PURPOSE AT J153 (`ddjp_722`): its second half
  // pinned "a length declared meanwhile moves the escape's moment" (8 s to 239 s), which the room's rule no longer allows — a
  // length never moves a room skip's moment: a ranked one closes the route (no escape at all), an unranked one holds only the
  // play (`earliestAt`). So: none before `skipAt`, one at it however far off `earliestAt` is; a ranked length while it waits
  // sends nothing; an unranked one changes nothing.
  {
    const w = clockWorld(RANK.OWNER);
    w.adv = WARRANT(8000, 239000);              // an unranked 240 s length holds the play, not the room skip
    w.M.init("!ev:hs");
    await w.runUntil(7999);
    if (skips(w).length !== 0) ffail("F4 — THE ESCAPE WENT BEFORE advance.skipAt: the reducer refuses a media.skip before it, so sending is a " +
      "message spent on a refusal", skips(w).map((x) => x.at));
    await w.runUntil(8100);
    if (skips(w).length !== 1 || skips(w)[0].at < 8000) ffail("F4 — AT advance.skipAt THE ESCAPE GOES, ONCE, not at the play's gate " +
      "(`earliestAt`, held by a length that does not hold a room skip)", skips(w).map((x) => x.at));
    for (const ranked of [true, false]) {
      const v = clockWorld(RANK.OWNER);
      v.adv = WARRANT(8000);
      v.M.init("!ev:hs");
      await v.runUntil(4000);
      // A length arrives while the escape waits. Ranked: the view turns the room's willingness off; unranked: unchanged.
      if (ranked) v.adv = Object.assign({}, v.adv, { skipWarranted: false, earliestAt: 239000 });
      else v.adv = Object.assign({}, v.adv, { earliestAt: 239000 });
      v.emit("ddjp.play.len", { type: "ddjp.play.len", sender: "@sees:hs", content: { pi: "$p1", sec: 240 } });
      await v.runUntil(239100);
      if (ranked && skips(v).length !== 0) ffail("F4 — A RANKED LENGTH WHILE THE ESCAPE WAITED: the room no longer acts, so nothing may be sent",
        skips(v).map((x) => x.at));
      // (No transport answer here, so 721's bounded resend follows every ADVANCE_RESEND_MS; the row reads the FIRST send.)
      if (!ranked && (skips(v).length < 1 || skips(v)[0].at < 8000 || skips(v)[0].at > 8100)) ffail("F4 CONTROL — an unranked length changes " +
        "nothing: the escape goes at skipAt", skips(v).map((x) => x.at));
    }
  }

  // G1 — A REPORT WHOSE TIMER FIRES ONCE THE ROOM WILL ACT IS NOT SENT (a guest: its rank slot is a real wait).
  for (const roomActs of [false, true]) {
    const w = clockWorld(RANK.GUEST);
    w.REASONS = REASONS;
    w.adv = { pi: "$p1", skipWarranted: false, blockedGuestPlus: 0, blockedVipPlus: 0, earliestAt: 8000 };
    w.M.init("!ev:hs");
    w.M.reportCannotSee("$p1", COUNTS);
    if (roomActs) w.adv = Object.assign({}, w.adv, { skipWarranted: true, blockedGuestPlus: 5 });
    await w.runUntil(60000);
    if (!roomActs && reports(w).length !== 1) ffail("G1 CONTROL — while the room does not yet act, the report goes, once", reports(w));
    if (roomActs && reports(w).length !== 0) ffail("G1 — A REPORT WAS SENT AFTER THE ROOM'S ADVANCE FOR THIS PLAYING SAID THE SKIP IS WARRANTED: " +
      "the cascade's re-check — the job is no longer needed (J153, the owner's: efficient with traffic)", reports(w));
    if (roomActs && !w.said.some((m) => /not sent — the room already acts on the reports it has/.test(m)))
      ffail("G1 — and the log says the report was not sent, and why", w.said);
  }
  // G2 — AND THE RETRY OF A REPORT THAT GOT NO ANSWER (J66) STAYS QUIET THE SAME WAY.
  for (const roomActs of [false, true]) {
    const w = clockWorld(RANK.GUEST, { answers: { status: "none", afterMs: 100 } });
    w.REASONS = REASONS;
    w.adv = { pi: "$p1", skipWarranted: false, blockedGuestPlus: 0, blockedVipPlus: 0, earliestAt: 8000 };
    w.M.init("!ev:hs");
    w.M.reportCannotSee("$p1", COUNTS);
    for (let t = 0; t < 60000 && reports(w).length === 0; t += 50) await w.runUntil(t);
    if (reports(w).length !== 1) ffail("G2 PREMISE — the first report was never sent, so its retry is never reached", reports(w));
    if (roomActs) w.adv = Object.assign({}, w.adv, { skipWarranted: true, blockedGuestPlus: 5 });
    await w.runUntil(w.now() + 1000);
    if (!roomActs && reports(w).length !== 2) ffail("G2 CONTROL — with no answer and the room not yet acting, the report is sent once more", reports(w));
    if (roomActs && reports(w).length !== 1) ffail("G2 — THE RETRY WENT ALTHOUGH THE ROOM NOW ACTS ON THE REPORTS IT HAS", reports(w));
  }
  // H1 — THE QUIET PERSON REPORTS AFTER ALL, once a ranked length ends the room's willingness to act (a guest: its slot is real).
  // Each case starts with the room acting, so the guest's report is held back (G1's quiet); then a length arrives.
  for (const c of [{ name: "a ranked length for this playing", stops: true, pi: "$p1" },
                   { name: "an unranked length (the room still acts)", stops: false, pi: "$p1" },
                   { name: "a length for another playing", stops: true, pi: "$p0" }]) {
    const w = clockWorld(RANK.GUEST);
    w.REASONS = REASONS;
    w.adv = { pi: "$p1", skipWarranted: true, blockedGuestPlus: 5, blockedVipPlus: 0, skipAt: 8000, earliestAt: 8000 };
    w.M.init("!ev:hs");
    w.M.reportCannotSee("$p1", COUNTS);
    await w.runUntil(30000);
    if (reports(w).length !== 0) ffail("H1 PREMISE (" + c.name + ") — the report was sent while the room acted, so nothing below measures the late report", reports(w));
    if (c.stops && c.pi === "$p1") w.adv = Object.assign({}, w.adv, { skipWarranted: false, earliestAt: 239000 });
    w.emit("ddjp.play.len", { type: "ddjp.play.len", sender: "@sees:hs", content: { pi: c.pi, sec: 240 } });
    await w.runUntil(90000);
    const want = (c.stops && c.pi === "$p1") ? 1 : 0;
    if (reports(w).length !== want) ffail("H1 — after " + c.name + ", " + want + " report(s) must go: " + (want
      ? "the room no longer acts on the reports it has, so a person who stayed quiet owes theirs (`ddjp.play.len` re-arms it, J153)"
      : "nothing the room does changed, so the person stays quiet"), reports(w));
    if (want && reports(w).length === 1 && reports(w)[0].at < 30000 + 1) ffail("H1 — the late report waits for its rank slot after the length", reports(w));
  }
  if (ffails) process.exit(1);
  console.log("[blocked-skip] PASS — the availability escape is authorised by the SKIP ROADS (recomputed blocked tally), not by author rank: a road-backed media.skip advances from any rank, no road met is rejected, uncategorized reach no road, and N competing escapes resolve to one via the advance-lock; and (J153) the escape waits for advance.skipAt (never a length), a refused escape's echo never re-arms it, it is asked once and again only ADVANCE_RESEND_MS after its answer, a report or its retry stays quiet once the room already acts on the reports it has, and a quiet person reports after all once a ranked length ends the room's willingness");
})().catch((e) => fail("PARTS F/G threw: " + (e && e.stack)));
