// tests/check-blocked-wire.js
// THE PLAYER'S FAILURE REACHES THE ROOM (J41) — a guard on the WIRE, not on the module.
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────────────────────
// Two guards already drive this feature and both would pass on a build with no `onError` handler
// anywhere, which is the build that shipped for most of this project's life.
// `check-blocked-reports` hands the module a declaration as though one had arrived (`emitBlocked`);
// `check-blocked-skip` calls `_maybeAuthorSkip` directly. So the chain was exercised at its SECOND
// step and its FOURTH, and the missing FIRST link — nothing converting a player error into a call
// to `MediaBlocked.reportCannotSee` — was invisible from either end. No client authored a
// `ddjp.play.blocked`, the road tally was permanently zero, `advance.skipWarranted` was permanently
// false, and no availability escape could ever fire in a live room, under a fully green suite.
//
// `check-wiring` PART D even carries a row for the `ddjp.play.blocked` send site. It classifies
// whether that send is GATED, which is a different question from whether it is REACHED, and a row
// answering the wrong question reads exactly like coverage.
//
// **So a guard that calls `reportCannotSee` itself would test nothing new.** That is the trap this
// file is written against, and it is why the subject here is the handler the UI actually holds.
//
// ── DRIVEN, NOT MATCHED ──────────────────────────────────────────────────────────────────────
// `ui/interface.js` is read as source text by five guards and executed by none — the weakness that
// let this sit. A regex proving `onError` is SPELLED there would be the same class of check that
// was green while the wire did not exist: it proves a name is present, never that anything runs.
// So this guard EXTRACTS the handler's own source out of the main player's `events` object and
// RUNS it, into the real `features/mediablocked.js`, onto a recording transport. Delete the
// handler and PART A goes red at extraction; re-point it at something else and PART B stops
// reaching the transport.
//
// The handler's closure is not reproduced: `player` is supplied by the harness, exactly as YouTube
// supplies it in production. That is "stub the transport, not the module under test".
//
//   PART Z  the admissibility gate catches its own breakage
//   PART A  the MAIN player's handler set is DERIVED and every member is accounted for, and
//           `onError` is among them
//   PART B  EXECUTE it: every code the reporter maps produces a `ddjp.play.blocked` carrying the
//           token the reducer's own vocabulary agrees with, and an unmapped code is UNTYPED
//   PART C  the UI decides nothing on this path — no reason token, no play instance, no rank
//   PART D  the refusals, each beside the control that must be admitted
//   PART E  the join: the body the wire EMITS is one the fold COUNTS, all the way to a met road
//
// No reason token and no error code is spelled in this file. The vocabulary is the reducer's and
// the code map is the feature's; both are read from their one home, so a token or a code added
// tomorrow is covered tomorrow.

const P = require("./_probe-j41-wire");
const F = require("./_fixtures");
const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[blocked-wire] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
// `ok` COLLECTS rather than exits. Attributing a red means knowing WHICH assertion fired, and in a
// guard whose `ok` exits, one red line names the first assertion rather than the only one that
// would have (08-build-and-deploy.md §Writing a guard).

// ══ PART Z — THE GATE CATCHES ITS OWN BREAKAGE ════════════════════════════════════════════════
// First, because every part below reads its result through it. Everything this measurement can
// return is a small array or a boolean, and EVERY way of failing to reach the code returns exactly
// what "correctly declined to report" returns: nothing sent.
{
  const st = P.selfTest();
  ok(st.missed.length === 0,
    "Z: the admissibility gate ADMITTED a reading it exists to refuse. A hole here silently turns " +
    "an unreached measurement into a passing assertion, which is how three separate audits of this " +
    "surface reported absence as agreement", st.missed);
  ok(!st.rejectedGood,
    "Z: the gate REFUSED a sound reading. A gate that refuses everything is as useless as one that " +
    "refuses nothing, and only the pair distinguishes them", st.rejectedGood);
  ok(st.inversionOk,
    "Z: the expectSend inversion does not work in both directions, so a case that exists to prove " +
    "NOTHING is sent cannot be told apart from a probe that never ran");
}

// ══ PART A — THE MAIN PLAYER'S HANDLER SET, DERIVED AND ACCOUNTED FOR ═════════════════════════
// Derived by scanning rather than listed, so a handler added tomorrow is in scope tomorrow — the
// shape `check-advance-notify` uses, and the answer to the same failure: a hand-listed set can only
// ever see the instances somebody already noticed.
//
// A handler needs an entry here or this guard FAILS. That is DECIDE rather than GATE: a new case
// cannot inherit an answer nobody chose.
const ACCOUNTED = {
  onReady: "no protocol consequence — sets the ready flag, applies the user's volume, starts the " +
           "two-way volume poll",
  onStateChange: "forwards the raw PLAYING duration and the ENDED video id down to Playback, which " +
                 "decides; covered by check-playback-end and check-media-length",
  onError: "THE SUBJECT OF THIS FILE — forwards the raw error code and the video the player says " +
           "is loaded to MediaBlocked, which decides (J41)",
};
{
  const ev = P.playerEvents();
  ok(ev.ok, "A: the main player's `events` object could not be read — " + (ev.stage || ""), ev.stage);
  if (ev.ok) {
    for (const k of ev.keys) {
      ok(!!ACCOUNTED[k],
        "A: the main player wires `" + k + "` and this guard has no entry for it. That is the " +
        "GUARD's failure, not the code's: an unaccounted handler is a handler nobody decided " +
        "about. Add an entry saying what it is for", ev.keys);
    }
    for (const k in ACCOUNTED) {
      ok(ev.keys.indexOf(k) >= 0,
        "A: this guard carries an entry for `" + k + "`, which the main player no longer wires. " +
        (k === "onError"
          ? "THIS IS THE J41 REGRESSION: with no onError handler nothing calls " +
            "MediaBlocked.reportCannotSee, no client authors a ddjp.play.blocked, the road tally " +
            "is permanently zero and the availability escape cannot fire in a live room — while " +
            "check-blocked-reports and check-blocked-skip both stay green, because they enter the " +
            "chain at its second step and its fourth"
          : "An entry for a handler that is not wired is coverage on paper only"), ev.keys);
    }
  }
}

// ══ PART B — EXECUTE IT: THE RIGHT DECLARATION REACHES THE TRANSPORT ══════════════════════════
// The codes come from the FEATURE's own map and the tokens from the REDUCER's own vocabulary. This
// file states neither, so it cannot drift from either.
const CODE_MAP = (() => {
  const sb = loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"],
    { StreamManager: { getState: () => ({ nowPlaying: null }), on() {}, off() {} },
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
      Logger: { info() {}, warn() {}, debug() {} },
      setTimeout: () => 0, clearTimeout: () => {}, Date, Math });
  return (sb.MediaBlocked && sb.MediaBlocked._REASON_FOR_CODE) || {};
})();
{
  const codes = Object.keys(CODE_MAP);
  ok(codes.length > 0,
    "B: the feature's code→token map is empty, so every row below iterates nothing — a filtered " +
    "check that filtered to nothing reads as a pass");

  let drivenCounting = 0;
  for (const code of codes) {
    const r = P.driveHandler("onError", { code: Number(code) });
    const a = P.admissible(r, { expectSend: true });
    ok(a.ok, "B: driving the UI's own onError handler with player code " + code +
      " produced no readable declaration", a.problems);
    if (!a.ok) continue;
    ok(r.blocked.length === 1,
      "B: code " + code + " produced " + r.blocked.length + " declarations; the reducer accepts " +
      "one per person per playing, so more than one is wasted traffic the fold refuses",
      r.blocked.map((b) => b.content));
    const body = r.blocked[0].content;
    ok(body.pi === "$p1",
      "B: the declaration must name the LIVE play instance — a declaration naming anything else is " +
      "refused at its own fold position and is protected by nothing", body);
    ok(body.k === CODE_MAP[code],
      "B: code " + code + " must carry the token the feature's own map assigns it", body);
    ok(Object.prototype.hasOwnProperty.call(P.REASONS, body.k),
      "B: code " + code + " produced token `" + body.k + "`, which the reducer's vocabulary does " +
      "not contain — an unknown token gets the WHOLE declaration refused at the fold, so the " +
      "report is lost as well as the reason", body);
    if (P.REASONS[body.k] && P.REASONS[body.k].counts) drivenCounting++;
  }
  ok(drivenCounting > 0,
    "B: not one mapped player error produced a COUNTING reason. Every declaration this wire can " +
    "author would advance no road, which is the whole feature failing while every row above passes");

  // an unmapped code: reported, and deliberately UNTYPED
  const unk = P.driveHandler("onError", { code: 424242 });
  const a2 = P.admissible(unk, { expectSend: true });
  ok(a2.ok, "B: an unmapped player error must still be REPORTED — the report is worth keeping even " +
    "when the reason is not", a2.problems);
  if (a2.ok) {
    const body = unk.blocked[0].content;
    ok(!Object.prototype.hasOwnProperty.call(body, "k"),
      "B: an unmapped code must OMIT `k` rather than send it as null. The body is fingerprinted, so " +
      "an absent key and an explicit null are different bytes for the same fact, and absent is the " +
      "shape the reducer reads as untyped", body);
  }
}

// ══ PART C — THE UI DECIDES NOTHING ON THIS PATH ══════════════════════════════════════════════
// Narrow and therefore meaningful: the span is the extracted handler, not the whole file. The rule
// is `01-project.md`'s and `check-ui-no-permission`'s, applied to the one new site.
{
  const ev = P.playerEvents();
  if (ev.ok && ev.handlers.onError) {
    const src = ev.handlers.onError;
    for (const token of Object.keys(P.REASONS)) {
      ok(src.indexOf(token) < 0,
        "C: the onError handler names the reason token `" + token + "`. Which player error means " +
        "which token is the FEATURE's one home (J06); a second copy in the UI puts a player's " +
        "error vocabulary one edit away from disagreeing with the reducer", token);
    }
    for (const g of ["StreamManager", "MatrixBridge", "Capabilities"]) {
      ok(src.indexOf(g) < 0,
        "C: the onError handler reaches `" + g + "` — ui/ goes through feature modules only " +
        "(check-boundaries rule D). Resolving the play instance here is exactly the reach that " +
        "rule forbids, which is WHY the feature resolves it", g);
    }
    ok(!/\bpi\b/.test(src),
      "C: the onError handler mentions a play instance. A `pi` is protocol; the UI forwards the raw " +
      "fact and the feature decides, which is the notifyEnded contract in the same handler set");
    ok(!/[Rr]ank/.test(src),
      "C: the onError handler mentions rank. The report is staggered by rank inside the feature, " +
      "and a rank in the UI is a threshold the UI has no business holding");
  }
}

// ══ PART D — THE REFUSALS, EACH BESIDE ITS CONTROL ════════════════════════════════════════════
// A refusal is evidence only if something adjacent was admitted: a handler that never ran refuses
// everything for free, and that reads exactly like a rule working.
{
  const control = P.driveHandler("onError", { code: Number(Object.keys(CODE_MAP)[0]) });
  const ca = P.admissible(control, { expectSend: true });
  ok(ca.ok,
    "D: the CONTROL did not send. Every refusal below would then be free, and this whole part " +
    "would pass on a build with no wire at all", ca.problems);

  const cases = [
    { name: "the player reports a different video than the room is playing",
      opts: { playerVideoId: "BBBBBBBBBBB", npVideoId: "AAAAAAAAAAA" },
      why: "an error fired during a swap would otherwise be declared against the wrong playing, and " +
           "a declaration is judged once and can never be withdrawn" },
    { name: "the player reports no video data at all (mid-swap)",
      opts: { playerVideoId: null },
      why: "getVideoData() can answer undefined; declaring on an unconfirmed reading spends this " +
           "client's single say on a guess" },
    { name: "getVideoData throws",
      opts: { playerThrows: true },
      why: "the same unconfirmed reading arriving as an exception rather than as a missing field" },
    { name: "nothing is playing",
      opts: { nowPlaying: false },
      why: "there is no play instance to declare about, and a declaration naming a dead pi is " +
           "refused at the fold and protected by nothing" },
    // ── THE CASE THE FIRST VERSION OF THIS FIXTURE COULD NOT EXPRESS ────────────────────────
    // Found by a surviving mutation rather than by reading: dropping the `videoId &&` clause from
    // `shouldReportBlocked` left every row above green, because every fixture here gave the room a
    // real video id. The clause looks dominated by the equality beside it — a null id cannot equal
    // a string — and it is the ONLY enforcement when the room's own song carries no id either,
    // where `null === null` answers TRUE and a declaration is authored on a reading nobody made.
    //
    // AND THAT STATE IS REACHABLE, which is what makes this a row rather than a note. A checkpoint
    // SEED restores `song: n.song ? { videoId: n.song.videoId, ... } : null` with no type check on
    // the id, so a seed carrying a song object without one produces exactly this. The reducer
    // itself anticipates it on the very next line (`nowPlaying.song && nowPlaying.song.videoId`).
    { name: "the room's own song carries no video id (a seed-restored nowPlaying) and the player " +
            "reports none either",
      opts: { playerVideoId: null, npVideoId: null },
      why: "without the id-present clause this is `null === null`, so a client would author a " +
           "blocked declaration for a song neither it nor the room can name — spending its one " +
           "say per playing on a confirmation that never happened" },
  ];
  for (const c of cases) {
    const r = P.driveHandler("onError", Object.assign({ code: Number(Object.keys(CODE_MAP)[0]) }, c.opts));
    const a = P.admissible(r, { expectSend: false });
    ok(a.ok, "D: " + c.name + " — expected NO declaration. " + c.why, a.problems);
  }
}

// ══ PART E — THE JOIN: WHAT THE WIRE SENDS IS WHAT THE FOLD COUNTS ════════════════════════════
// The seam neither existing guard covers. `check-blocked-reason` builds its declarations from
// fixtures and never sees what the reporter emits; every part above stops at the transport. So the
// body the wire ACTUALLY produced is folded by the real reducer here, and the road tally is read
// off the reducer's own advance view.
//
// This is the assertion that would have gone red on the shipped tree for the right reason: with no
// handler there is no body to fold.
{
  const countingCode = Object.keys(CODE_MAP).find((c) => P.REASONS[CODE_MAP[c]] && P.REASONS[CODE_MAP[c]].counts);
  const localCode = Object.keys(CODE_MAP).find((c) => P.REASONS[CODE_MAP[c]] && !P.REASONS[CODE_MAP[c]].counts);
  ok(!!countingCode && !!localCode,
    "E: the feature's map does not cover both kinds of reason, so this part cannot vary the axis it " +
    "exists to vary", { countingCode, localCode });

  function foldWireBody(code) {
    const r = P.driveHandler("onError", { code: Number(code) });
    const a = P.admissible(r, { expectSend: true });
    if (!a.ok) return { ok: false, problems: a.problems };
    const body = r.blocked[0].content;
    const room = F.playingRoom({ songs: 2 });
    const pi = room.pis[room.pis.length - 1];
    const decls = [];
    // FIVE DISTINCT PEOPLE, because the reducer counts people and reusing one sender collapses
    // five declarations into one — a fixture that cannot reach the road it is asserting about.
    for (let i = 0; i < 5; i++) {
      decls.push(F.reducerEvent("$w" + i, room.lastL + 1 + i, room.startTs + 1000 + i,
        "@rep" + i + ":hs", F.RANK.guest,
        Object.assign({ t: "ddjp.play.blocked" }, body, { pi })));
    }
    const out = P.StateDeriver.deriveBoth(F.sortLog(room.log.concat(decls)));
    const acc = new Set(out.accepted);
    const accepted = decls.filter((d) => acc.has(d.eventId)).length;
    return { ok: true, accepted, requested: decls.length, advance: out.state.advance, body };
  }

  if (countingCode) {
    const r = foldWireBody(countingCode);
    ok(r.ok, "E: the counting-reason body could not be produced", r.problems);
    if (r.ok) {
      ok(r.accepted === r.requested,
        "E: the fold REFUSED " + (r.requested - r.accepted) + " of " + r.requested + " declarations " +
        "built from the body this wire emits. A body the reporter sends and the reducer refuses is " +
        "the failure mode J06's vocabulary rule exists to prevent, and it would be silent — every " +
        "client authoring, every client refusing, each refusal reading in the log as a lost race",
        { body: r.body, accepted: r.accepted });
      ok(r.advance && r.advance.blockedGuestPlus === 5,
        "E: five distinct reporters at guest rung must reach the tally", r.advance);
      ok(r.advance && r.advance.skipWarranted === true,
        "E: a counting reason from five distinct guests must warrant the escape. This is the whole " +
        "chain — player error, the UI's handler, the feature, the transport, the fold, the road — " +
        "and it is the assertion that could not have passed before the wire existed", r.advance);
    }
  }
  if (localCode) {
    const r = foldWireBody(localCode);
    ok(r.ok, "E: the local-reason body could not be produced", r.problems);
    if (r.ok) {
      ok(r.accepted === r.requested,
        "E: a local-only reason must still be ACCEPTED — it is reported, merely not counted", r.body);
      ok(r.advance && r.advance.skipWarranted === false,
        "E: a reason that says the problem is at the reporter's own end must warrant nothing, " +
        "however many people send it. Without this row the counting assertion above would pass on " +
        "a wire that reported every failure as the song's fault", r.advance);
    }
  }
}

if (failures) process.exit(1);
console.log(
  "[blocked-wire] PASS — the blocked report is REACHED, not merely correct (J41). The main player's " +
  "handler set is DERIVED from ui/interface.js and every member is accounted for, so a handler " +
  "added tomorrow forces someone to say what it is for and a DELETED onError fails here rather " +
  "than passing two guards that enter the chain at its second and fourth steps. The handler's own " +
  "source is EXTRACTED AND EXECUTED — that file is read as text by five guards and run by none, " +
  "and a regex proving `onError` is spelled would be the same check that was green while the wire " +
  "did not exist — driving the real MediaBlocked onto a recording transport: every code the " +
  "feature maps authors one ddjp.play.blocked naming the live pi and carrying a token the " +
  "reducer's own vocabulary contains, an unmapped code OMITS `k` rather than guessing a counting " +
  "reason, and the UI decides nothing on the way — no token, no pi, no rank, no backend global. " +
  "Each refusal (a swapped video, no video data, a throwing player, nothing playing) is driven " +
  "beside the control that must be admitted, because a handler that never ran refuses everything " +
  "for free. And the body the wire actually EMITS is folded by the real reducer: a counting reason " +
  "from five distinct guests reaches the tally and warrants the escape, a local-only one is " +
  "accepted and warrants nothing — the seam where what the reporter sends meets what the fold " +
  "counts, which neither end's guard could see");
