// tests/_probe-j49-confirm.js
// THE DRIVING HARNESS FOR `Playback._confirmReading`'s `!expectedVideoId ||` CLAUSE (J49), AND
// ITS ADMISSIBILITY GATE.
//
// The clause is the opening term of
//     if (!expectedVideoId || r.videoId !== expectedVideoId) return { ok:false, why:"different-video" }
// and it is the THIRD instance of the id-present idiom, after `Playback.shouldEndOn` (J48) and
// `MediaBlocked.shouldReportBlocked` (J41). It is the only one of the three that is DOMINATED.
//
// ── WHAT IS ACTUALLY IN QUESTION, WHICH IS NOT THE PREDICATE ─────────────────────────────────
// Whether `_confirmReading` computes correctly is not interesting and a row calling it with a
// hand-built `{ videoId: null }` would answer it while proving nothing. J48's lesson is that both
// ENDS of a pairing belong to somebody else's module and both must be driven. Here they are:
//
//   the EXPECTED id  comes from the call site: `s2.nowPlaying.song ? s2.nowPlaying.song.videoId
//                    : null`, so a truthy song the room cannot name yields a FALSY expected id.
//                    That state comes out of `StateDeriver`'s own seed path — the same reachable
//                    state J48 measured, driven here rather than inherited from its entry.
//   the READING      comes from whatever `Playback.setDurationProvider` was handed. In the shipped
//                    tree that is exactly one function, defined in `ui/interface.js`, and what it
//                    returns when the player cannot name a video is the whole question. It is
//                    EXTRACTED and EXECUTED here, the way `check-blocked-wire` executes `onError`,
//                    because that file is read as source text by five guards and run by none.
//
// ── WHY THIS IS A MEASUREMENT OF A PREMISE RATHER THAN OF A CLAUSE ───────────────────────────
// A redundancy is a statement about THE ROUTES THAT EXIST (`roles.md` §9). The route that would
// end this one is a provider returning an object with a falsy id instead of returning `null`
// wholesale — a J29 player adapter, and nothing else in the tree. So the load-bearing question is
// not "does the clause refuse" but "can any provider produce the reading it refuses". That is a
// property of `ui/interface.js`, so it is DRIVEN here rather than read: R1 runs the shipped
// provider against every player shape the YouTube API can present, including the ones its own
// comments name as reachable, and records whether ANY of them yields an object carrying a falsy
// id. If one did, the domination would be over and the clause would want a row today.
//
// ── EVERY WAY OF FAILING TO REACH THIS CODE LOOKS LIKE "CORRECTLY REFUSED TO DECLARE" ────────
// No provider, a provider that threw, a fixture with nothing playing, a stagger that never fired,
// a room that already agrees, a declaration already made for this playing — every one of them
// produces `sent: []`, which is exactly what the clause working produces. `_confirmReading` is
// itself a wall of five named refusals and only one of them is this clause. So each measurement
// carries the REFUSAL REASON it reached, the gate checks that the reason is the one the row is
// about, and `selfTest()` feeds the gate deliberately broken readings to show it catches them.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const F = require("./_fixtures");

const PB_REL = "features/playback.js";
const UI_REL = "ui/interface.js";

// The provider is installed on Playback by the UI. Anchored on the call rather than on a line, and
// asserted to appear exactly once — two installs and this measurement could not say which one the
// tree actually uses.
const PROVIDER_ANCHOR = "Playback.setDurationProvider(";

const noop = () => {};
const _quiet = { info: noop, warn: noop, debug: noop, error: noop };

// ── a paren matcher that is not fooled by strings or comments ────────────────────────────────
// Written out rather than regexed for the same reason `_probe-j41-wire.js` writes out its brace
// matcher: a regex over a nested arrow function is the textual guard this file exists to avoid.
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i = src.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ── STAGE 1 — THE PROVIDER, out of the shipped UI's own source ───────────────────────────────
// Returns { ok, stage?, source } — the provider callback's own text, extracted structurally.
function providerSource() {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + UI_REL + " is not readable" }; }

  const hits = src.split(PROVIDER_ANCHOR).length - 1;
  if (hits !== 1) {
    return { ok: false, stage: "stage: " + JSON.stringify(PROVIDER_ANCHOR) + " appears " + hits +
      " times in " + UI_REL + ", expected exactly 1 — with none there is no provider in the tree " +
      "at all and the domination is vacuous rather than measured; with two this cannot say which " +
      "one Playback ends up holding" };
  }
  const at = src.indexOf(PROVIDER_ANCHOR);
  const open = at + PROVIDER_ANCHOR.length - 1;
  const close = matchParen(src, open);
  if (close < 0) return { ok: false, stage: "stage: the provider install call does not close" };
  const inner = src.slice(open + 1, close).trim();
  if (!inner) return { ok: false, stage: "stage: the provider is installed with no argument" };
  return { ok: true, source: inner };
}

// Runs the extracted provider against a stubbed player and returns what it hands back.
// `player` is the dependency (YouTube supplies it in production, exactly as J41's harness supplies
// one to `onError`); the provider is the subject.
function runProvider(providerSrc, player, opts) {
  const o = opts || {};
  const ctx = { player: player, playerReady: ("ready" in o) ? o.ready : true, Logger: _quiet,
                console, Date, Math, JSON };
  vm.createContext(ctx);
  let fn;
  try { fn = vm.runInContext("(" + providerSrc + ")", ctx); }
  catch (e) {
    return { ok: false, stage: "stage: the extracted provider would not evaluate (" + e.message +
      ") — the extractor read something that is not a function" };
  }
  if (typeof fn !== "function") {
    return { ok: false, stage: "stage: the extracted provider is not a function" };
  }
  let out, threw = null;
  try { out = fn(); } catch (e) { threw = e.message; }
  return { ok: true, out: out, threw: threw };
}

// The classification the whole domination rests on. An object carrying a FALSY id is the one
// shape that reaches the clause; anything else is refused above it or matches honestly.
function classify(out) {
  if (out === null || out === undefined) return "null-wholesale";
  if (typeof out !== "object") return "non-object";
  if (!out.videoId) return "OBJECT-WITH-FALSY-ID";      // <- the shape that would end the domination
  return "object-with-id";
}

// ── STAGE 2 — THE EXPECTED ID, out of the reducer's own seed path ────────────────────────────
// `idValue`: "real" keeps the honest id, `null` writes an explicit null, "absent" deletes the key.
// The seed goes through a JSON round trip first, because a checkpoint reaches a client as a wire
// body and that is where an absent key and an explicit null stop being interchangeable.
function seededPlaying(idValue) {
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
  // What the call site computes. Reproduced from the site rather than assumed, because the whole
  // point of the row is that a truthy song can still yield a falsy expected id.
  const expected = np.song ? np.song.videoId : null;
  return { ok: true, np: np, expected: expected, truthySong: !!np.song,
           honestId: seed.nowPlaying.song.videoId };
}

// ── STAGE 3 — THE SUBJECT: real Playback, real declaration path, recording transport ─────────
// `src` lets a mutation runner drive a modified copy without writing to the tree; the guard passes
// nothing and gets the shipped file. The rank slot is collapsed by running whatever is scheduled —
// WHEN the declaration fires is `check-length-freshness` PART C's subject and WHETHER it fires at
// all is this one's.
function driveDeclare(opts) {
  const o = opts || {};
  const source = (typeof o.src === "string") ? o.src : fs.readFileSync(path.join(ROOT, PB_REL), "utf8");
  const np = o.np;
  const sent = [];
  const timers = [];
  const sandbox = {
    console, Date, Math, JSON,
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: ms || 0 }); return timers.length; },
    clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    StreamManager: {
      // `advance: null` is a room whose gate has nothing to say. The bail-out that compares the
      // room's agreed length would otherwise silence this row for a reason that is not the clause.
      getState: () => ({ nowPlaying: np, rotation: [{ user: "@dj:hs", pending: [] }],
                         settings: { vouchJitter: 1000 }, advance: null }),
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
  if (!Playback || typeof Playback.setDurationProvider !== "function") {
    return { ok: false, stage: "stage: Playback did not load, or exposes no setDurationProvider — " +
      "with no seam there is no provider contract to measure and every row below is free" };
  }
  Playback.initWiring("!ev:hs");
  Playback.setMyRank(20);
  if ("reading" in o) Playback.setDurationProvider(() => o.reading);
  let threw = null;
  try {
    // The id handed to setDuration is the player's own, which is what production passes; the
    // declaration path then re-reads the ROOM's id at fire time and that is the one under test.
    Playback.setDuration(o.playerId !== undefined ? o.playerId : (np && np.song ? np.song.videoId : null), 200);
    const due = timers.splice(0).sort((a, b) => a.at - b.at);
    due.forEach((t) => { try { t.fn(); } catch (e) { threw = e.message; } });
  } catch (e) { threw = e.message; }
  return {
    ok: true, sent: sent, threw: threw,
    lens: sent.filter((s) => s.type === "ddjp.play.len"),
  };
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// `expectDeclare` says whether this case intends a declaration to reach the transport. The refusal
// cases intend none, so "nothing sent" is their RESULT — and the gate has to be told which, or it
// cannot tell a clause working from a fixture that never arrived.
//
// `collides` is the precondition that makes a refusal attributable to THIS clause rather than to
// the four refusals beside it: the equality `r.videoId !== expectedVideoId` must answer FALSE — i.e.
// the two ids must MATCH — for the clause to be the only thing left standing. A row where the
// equality already refuses is a row the clause is not needed for, and asserting a refusal there is
// the decorative-premise failure J48 found and `paths.md` §9 now carries as a fourth shape.
function admissible(r, opts) {
  const o = opts || {};
  const expectDeclare = !!o.expectDeclare;
  const problems = [];
  if (!r || typeof r !== "object") return { ok: false, problems: ["no reading at all"] };
  if (!r.ok) { problems.push(r.stage || "stage: the drive did not complete"); return { ok: false, problems }; }
  if (r.threw) {
    problems.push("stage: the drive THREW (" + r.threw + ") — a declaration that is absent " +
      "because the subject died is not one the clause declined to make");
  }
  if (o.np !== undefined) {
    if (!o.np) problems.push("stage: there is no nowPlaying, so the declaration path returns " +
      "before the clause is reached");
    else if (!o.np.song) problems.push("stage: nowPlaying carries no song object, so the " +
      "`!np.song` guard refuses this row before the clause is reached");
  }
  if (o.providerInstalled === false) {
    problems.push("stage: no provider was installed, so `_confirmReading` refuses at no-provider " +
      "and every row measured here is free");
  }
  if (o.collides !== undefined && o.collides !== null) {
    const eq = (o.collides.readingId === o.collides.expectedId);
    if (o.collides.expect === true && !eq) {
      problems.push("stage: the equality beside the clause REFUSES here (" +
        JSON.stringify(o.collides.readingId) + " vs " + JSON.stringify(o.collides.expectedId) +
        "), so this row would refuse with or without the clause and pins nothing");
    }
    if (o.collides.expect === false && eq) {
      problems.push("stage: the two ids MATCH in a row written to show they do not");
    }
  }
  if (expectDeclare && r.lens.length === 0) {
    problems.push("stage: no ddjp.play.len reached the transport in the CONTROL, so every refusal " +
      "measured beside it is free and this whole part would pass on a build that can never declare");
  }
  if (!expectDeclare && r.lens.length !== 0) {
    problems.push("stage: a declaration WAS authored (" + r.lens.length + ") in a case that " +
      "exists to prove none is");
  }
  return { ok: problems.length === 0, problems };
}

// ── THE GATE'S OWN TEST ──────────────────────────────────────────────────────────────────────
// Broken in each way it claims to catch, plus the inverse: a gate that refuses everything is as
// useless as one that refuses nothing, and only the pair distinguishes them.
function selfTest() {
  const declared = { ok: true, threw: null, lens: [{ type: "ddjp.play.len" }] };
  const refused = { ok: true, threw: null, lens: [] };
  const npOk = { song: { videoId: null }, pi: "$p" };
  const cases = [
    { name: "the drive never completed",
      r: { ok: false, stage: "stage: x", lens: [] }, o: { expectDeclare: false } },
    { name: "the subject threw",
      r: { ok: true, threw: "boom", lens: [] }, o: { expectDeclare: false } },
    { name: "the control declared nothing",
      r: refused, o: { expectDeclare: true } },
    { name: "a refusal row authored a declaration",
      r: declared, o: { expectDeclare: false } },
    { name: "nothing is playing, so the row is refused before the clause",
      r: refused, o: { expectDeclare: false, np: null } },
    { name: "the song object is missing, likewise",
      r: refused, o: { expectDeclare: false, np: { pi: "$p" } } },
    { name: "no provider was installed, so the refusal is free",
      r: refused, o: { expectDeclare: false, providerInstalled: false } },
    { name: "the ids do not match, so the row pins nothing",
      r: refused, o: { expectDeclare: false, np: npOk,
                       collides: { readingId: "ABC", expectedId: null, expect: true } } },
    { name: "nothing at all", r: null, o: {} },
  ];
  const missed = [];
  for (const c of cases) if (admissible(c.r, c.o).ok) missed.push(c.name);

  // and the inverse: the shapes the gate must ADMIT, or it refuses everything for free
  const goodRefusal = admissible(refused,
    { expectDeclare: false, np: npOk, collides: { readingId: null, expectedId: null, expect: true } });
  const goodControl = admissible(declared,
    { expectDeclare: true, np: { song: { videoId: "V" } } });

  // and the classifier, which is what the whole domination rests on
  const classes = {
    "null-wholesale": classify(null),
    "undefined": classify(undefined),
    "falsy-id-null": classify({ videoId: null, seconds: 200 }),
    "falsy-id-empty": classify({ videoId: "", seconds: 200 }),
    "falsy-id-absent": classify({ seconds: 200 }),
    "honest": classify({ videoId: "ABC", seconds: 200 }),
  };
  const classifierWrong = [];
  if (classes["null-wholesale"] !== "null-wholesale") classifierWrong.push("null");
  if (classes["undefined"] !== "null-wholesale") classifierWrong.push("undefined");
  if (classes["falsy-id-null"] !== "OBJECT-WITH-FALSY-ID") classifierWrong.push("videoId:null");
  if (classes["falsy-id-empty"] !== "OBJECT-WITH-FALSY-ID") classifierWrong.push('videoId:""');
  if (classes["falsy-id-absent"] !== "OBJECT-WITH-FALSY-ID") classifierWrong.push("videoId absent");
  if (classes["honest"] !== "object-with-id") classifierWrong.push("honest id");

  return {
    missed: missed,
    rejectedGood: goodRefusal.ok && goodControl.ok ? null
      : { refusal: goodRefusal.problems, control: goodControl.problems },
    classifierWrong: classifierWrong,
  };
}

module.exports = {
  providerSource, runProvider, classify, seededPlaying, driveDeclare, admissible, selfTest,
  PB_REL, UI_REL, PROVIDER_ANCHOR,
};
