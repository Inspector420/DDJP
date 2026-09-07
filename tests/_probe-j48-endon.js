// tests/_probe-j48-endon.js
// THE DRIVING HARNESS FOR `Playback.shouldEndOn`'s ID-PRESENT CLAUSE (J48), AND ITS
// ADMISSIBILITY GATE.
//
// The clause is `videoId &&` in
//     shouldEndOn(np, videoId) -> !!(np && np.song && videoId && np.song.videoId === videoId)
// and it reads as dominated by the equality beside it, because a null id cannot equal a string.
// It is the ONLY enforcement when the room's own song carries no id EITHER, where the equality
// answers TRUE on two absences and an ENDED nobody could confirm advances the room.
//
// ── WHY THIS FILE EXISTS RATHER THAN A ROW CALLING `shouldEndOn` DIRECTLY ─────────────────────
// A row handing the predicate a hand-built `{ song: { videoId: null } }` would go red under the
// mutation and still prove nothing anyone needs: the open question was never "does the predicate
// compute", it was **can the room ever be in that state, and can the signal ever arrive in the
// shape that collides with it**. Both halves are somebody else's code, so both are driven here:
//
//   the STATE   comes out of `StateDeriver`'s own seed path — the fold applies
//               `song: n.song ? { videoId: n.song.videoId, ... } : null` with no type check on
//               the id, and guards `nowPlaying.song && nowPlaying.song.videoId` on the very next
//               line, which is the reducer acknowledging the shape it just built.
//   the SIGNAL  comes out of `ui/interface.js`'s own ENDED branch, extracted and EXECUTED the way
//               `check-blocked-wire` executes `onError`. That file is read as source text by five
//               guards and run by none, and what it hands over on an unconfirmable reading is the
//               half of the pair no amount of reading `playback.js` can answer.
//
// ── THE MEASUREMENT THAT DECIDED THE SHAPE, RECORDED BECAUSE IT CORRECTS THE JOB ENTRY ───────
// `09-roadmap.md` J48 describes the reachable state as a seed whose song object has NO `videoId`
// key, folding to `videoId === undefined`. That is true of the fold and it is NOT the pairing the
// clause defends, because the shipped UI normalises an unconfirmable reading to `null`
// (`let endedId = null; if (vd && vd.video_id) endedId = vd.video_id;`) and
// `undefined === null` is FALSE. Driven, all four combinations, shipped vs clause-dropped:
//
//     seed id NULL   + ENDED null        0 advances shipped, 1 with the clause dropped   <- the pin
//     seed id ABSENT + ENDED null        0 advances either way                           <- NOT a pin
//     seed id ABSENT + ENDED undefined   0 advances shipped, 1 with the clause dropped
//     seed id REAL   + ENDED matching    1 advance either way                            <- control
//
// So a guard row built from the entry's literal wording would have been DECORATIVE — green on the
// mutated tree, for the reason the entry did not name. The clause defends MATCHING absences, and
// only `null`/`null` is reachable through today's wire; `undefined`/`undefined` needs a caller
// that passes one, which no production caller does today and a J29 player adapter might.
//
// ── EVERY WAY OF FAILING TO REACH THIS CODE LOOKS LIKE "CORRECTLY DECLINED TO ADVANCE" ───────
// A handler that never ran, a seed that never applied, a Playback with no events channel, a
// rotation that was empty, an advance gate that held — every one of them produces `sent: []`,
// which is exactly what the clause working produces. That is why the preconditions below are
// separate named checks run BEFORE any comparison, why the gate names the stage that failed, and
// why `selfTest()` feeds the gate deliberately broken readings to show it catches them.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const F = require("./_fixtures");
const W = require("./_probe-j41-wire");   // the main player's `events` object, already extracted structurally

const PB_REL = "features/playback.js";

const noop = () => {};
const _quiet = { info: noop, warn: noop, debug: noop, error: noop };

// ── STAGE 1 — THE STATE, out of the reducer's own seed path ──────────────────────────────────
// `idValue`: "real" keeps the honest id, `null` writes an explicit null, "absent" deletes the key.
// The seed goes through a JSON round trip first, because a checkpoint reaches a client as a wire
// body and that is where an absent key and an explicit null stop being interchangeable.
function seededState(idValue) {
  const sd = loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"],
    { Logger: _quiet, Date, Math, JSON }
  );
  const room = F.playingRoom({ songs: 1 });
  const seed = sd.StateDeriver.buildSeed(F.sortLog(room.log));
  if (!seed || !seed.nowPlaying || !seed.nowPlaying.song) {
    return { ok: false, stage: "stage: buildSeed produced no playing song, so nothing below is a " +
      "reading of the seed path" };
  }
  const wire = JSON.parse(JSON.stringify(seed));
  if (idValue === "absent") delete wire.nowPlaying.song.videoId;
  else if (idValue !== "real") wire.nowPlaying.song.videoId = idValue;

  const state = sd.StateDeriver.derive([], wire);
  const np = state ? state.nowPlaying : null;
  if (!np) return { ok: false, stage: "stage: the seeded fold produced no nowPlaying at all" };
  return { ok: true, np: np, seed: wire, honestId: seed.nowPlaying.song.videoId };
}

// ── STAGE 2 — THE SIGNAL, out of the shipped UI's own ENDED branch ───────────────────────────
// Extracts `onStateChange` from the MAIN player (the file holds a preview player too, which must
// never touch a consensus path) and RUNS it, recording what it forwards to `Playback.notifyEnded`.
// `videoData` is what the iframe answers: `undefined` is the documented mid-swap reading.
function endedIdFromWire(videoData, opts) {
  const o = opts || {};
  const ev = W.playerEvents();
  if (!ev.ok) return { ok: false, stage: ev.stage };
  const src = ev.handlers.onStateChange;
  if (!src) {
    return { ok: false, stage: "stage: the main player wires no `onStateChange` handler, so there " +
      "is no ENDED branch to drive and nothing below is a reading of the wire" };
  }
  const forwarded = [];
  const player = {
    getVideoData() { if (o.throws) throw new Error("player not ready"); return videoData; },
    getDuration() { return 100; },
  };
  const ctx = {
    Playback: { notifyEnded(v) { forwarded.push(v); }, setDuration() {} },
    YT: { PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2 } },
    Logger: _quiet, player,
    updateVideoTitle: noop, applyVolumeState: noop, _startYtVolumePoll: noop,
    console, Date, Math,
  };
  vm.createContext(ctx);
  let fn;
  try { fn = vm.runInContext("(" + src + ")", ctx); }
  catch (e) {
    return { ok: false, stage: "stage: the extracted `onStateChange` would not evaluate (" +
      e.message + ") — the extractor read something that is not a function" };
  }
  let threw = null;
  try { fn({ data: 0 /* YT.PlayerState.ENDED */, target: player }); }
  catch (e) { threw = e.message; }
  return { ok: true, forwarded: forwarded, threw: threw, handlerSource: src, keys: ev.keys };
}

// ── STAGE 3 — THE SUBJECT: real Playback, real advance path, recording transport ─────────────
// `src` lets a mutation runner drive a modified copy without writing to the tree; the guard passes
// nothing and gets the shipped file. The stagger and pre-send pause are collapsed by running
// whatever is scheduled, because WHEN the advance fires is `check-ceiling-convergence`'s subject
// and WHETHER it fires at all is this one's.
function driveEnded(np, endedId, src) {
  const source = (typeof src === "string") ? src : fs.readFileSync(path.join(ROOT, PB_REL), "utf8");
  const sent = [];
  const pushes = [];
  const sandbox = {
    console, Date, Math, JSON,
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 1; },
    clearTimeout: noop,
    setInterval: () => 1, clearInterval: noop,
    StreamManager: {
      // `advance: null` is a room whose gate has nothing to say — deliberately, so the ONLY thing
      // that can stop the emit below is the subject. A held gate refuses identically and would
      // make every refusal here free.
      getState: () => ({ nowPlaying: np, rotation: [{ user: "@dj:hs", pending: [] }],
                         settings: {}, advance: null }),
      on: noop, off: noop,
    },
    MatrixBridge: {
      getUserId: () => "@me:hs",
      mayAdvance: () => ({ ok: true }),
      async sendEvent(ch, type, body) { sent.push({ channel: ch, type: type, body: body }); },
    },
    Logger: _quiet,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Ranks + Capabilities are loaded so the rank slot is computed by the production formula rather
  // than by playback's fallback catch — a guard that silently exercises the fallback is testing a
  // path production does not take.
  const deps = ["backends/backend1/ranks.js", "backends/backend1/capabilities.js"]
    .map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")).join("\n;\n");
  try {
    vm.runInContext(deps + "\n;\n" + source +
      "\n;globalThis.Playback = Playback; globalThis.Capabilities = Capabilities;",
      sandbox, { filename: PB_REL });
  } catch (e) {
    return { ok: false, stage: "stage: playback.js would not load (" + e.message + ")" };
  }
  const Playback = sandbox.Playback;
  if (!Playback || typeof Playback.notifyEnded !== "function") {
    return { ok: false, stage: "stage: Playback did not load, or exports no notifyEnded" };
  }
  Playback.setMyRank(20);
  Playback.onStateChange((s) => pushes.push(s));
  pushes.length = 0;                       // the subscribe-time push is not a result
  Playback.init("!ev:hs");                 // wire + start: without a channel _emitPlay returns early
  let threw = null;
  try { Playback.notifyEnded(endedId); } catch (e) { threw = e.message; }
  return {
    ok: true, sent: sent, threw: threw, pushes: pushes,
    advances: sent.filter((s) => s.type === "ddjp.dj.play"),
    endedPushes: pushes.filter((p) => p && p.ended === true),
  };
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// `expectAdvance` says whether this case intends an advance to reach the transport. The refusal
// cases intend none, so "nothing sent" is their RESULT — and the gate has to be told which, or it
// cannot tell a clause working from a fixture that never arrived.
//
// `collides` is the precondition that makes a refusal attributable to THIS clause rather than to
// any of the three conditions beside it: the equality `np.song.videoId === videoId` must answer
// TRUE for the row to be about the only thing standing between it and an advance. A row where the
// equality already answers false is a row the clause is not needed for, and asserting a refusal
// there is the decorative assertion this whole file is written against.
function admissible(r, opts) {
  const o = opts || {};
  const expectAdvance = !!o.expectAdvance;
  const problems = [];
  if (!r || typeof r !== "object") return { ok: false, problems: ["no reading at all"] };
  if (!r.ok) { problems.push(r.stage || "stage: the drive did not complete"); return { ok: false, problems }; }
  if (r.threw) {
    problems.push("stage: the drive THREW (" + r.threw + ") — an advance that is absent because " +
      "the subject died is not an advance the clause declined to make");
  }
  if (o.np !== undefined) {
    if (!o.np) problems.push("stage: there is no nowPlaying, so the song-present condition " +
      "refuses this row before the clause is reached");
    else if (!o.np.song) problems.push("stage: nowPlaying carries no song object, so the " +
      "`np.song` condition refuses this row before the clause is reached");
  }
  if (o.collides !== undefined && o.collides !== null) {
    const np = o.np;
    const eq = !!(np && np.song && np.song.videoId === o.collides.videoId);
    if (o.collides.expect === true && !eq) {
      problems.push("stage: the equality beside the clause does NOT answer true here (" +
        JSON.stringify(np && np.song ? np.song.videoId : null) + " vs " +
        JSON.stringify(o.collides.videoId) + "), so this row would refuse with or without the " +
        "clause and pins nothing");
    }
    if (o.collides.expect === false && eq) {
      problems.push("stage: the equality answers TRUE in a row written to show it does not");
    }
  }
  if (expectAdvance && r.advances.length === 0) {
    problems.push("stage: no ddjp.dj.play reached the transport in the CONTROL, so every refusal " +
      "measured beside it is free and this whole part would pass on a build that can never advance");
  }
  if (!expectAdvance && r.advances.length !== 0) {
    problems.push("stage: an advance WAS authored (" + r.advances.length + ") in a case that " +
      "exists to prove none is");
  }
  return { ok: problems.length === 0, problems };
}

// ── THE GATE'S OWN TEST ──────────────────────────────────────────────────────────────────────
// Broken in each way it claims to catch, plus the inverse: a gate that refuses everything is as
// useless as one that refuses nothing, and only the pair distinguishes them.
function selfTest() {
  const advanced = { ok: true, threw: null, advances: [{ type: "ddjp.dj.play" }], endedPushes: [] };
  const refused = { ok: true, threw: null, advances: [], endedPushes: [] };
  const npOk = { song: { videoId: null }, pi: "$p" };
  const cases = [
    { name: "the drive never completed",
      r: { ok: false, stage: "stage: x", advances: [] }, o: { expectAdvance: false } },
    { name: "the subject threw",
      r: { ok: true, threw: "boom", advances: [], endedPushes: [] }, o: { expectAdvance: false } },
    { name: "the control authored nothing",
      r: refused, o: { expectAdvance: true } },
    { name: "a refusal row authored an advance",
      r: advanced, o: { expectAdvance: false } },
    { name: "nothing is playing, so the row is refused before the clause",
      r: refused, o: { expectAdvance: false, np: null } },
    { name: "the song object is missing, likewise",
      r: refused, o: { expectAdvance: false, np: { pi: "$p" } } },
    { name: "the equality does not collide, so the row pins nothing",
      r: refused, o: { expectAdvance: false, np: npOk, collides: { videoId: "OTHER", expect: true } } },
    { name: "nothing at all", r: null, o: {} },
  ];
  const missed = [];
  for (const c of cases) if (admissible(c.r, c.o).ok) missed.push(c.name);

  // and the inverse: the shapes the gate must ADMIT, or it refuses everything for free
  const goodRefusal = admissible(refused,
    { expectAdvance: false, np: npOk, collides: { videoId: null, expect: true } });
  const goodControl = admissible(advanced, { expectAdvance: true, np: { song: { videoId: "V" } } });
  return {
    missed: missed,
    rejectedGood: goodRefusal.ok && goodControl.ok ? null
      : { refusal: goodRefusal.problems, control: goodControl.problems },
  };
}

module.exports = { seededState, endedIdFromWire, driveEnded, admissible, selfTest, PB_REL };
