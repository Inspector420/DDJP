// tests/_probe-j41-wire.js
// THE DRIVING PROBE FOR THE BLOCKED-REPORT WIRE (J41), AND ITS ADMISSIBILITY GATE.
//
// The question this file exists to answer is NOT "does MediaBlocked work" — two guards already
// drive that, one at the chain's second step (`check-blocked-reports` hands the module a
// declaration through `emitBlocked`) and one at its fourth (`check-blocked-skip` calls
// `_maybeAuthorSkip`). Both ends were driven for the whole life of the feature and the FIRST link
// was absent: the main `YT.Player` in `ui/interface.js` wired `onReady` and `onStateChange` and no
// `onError`, so nothing ever called `reportCannotSee`, no `ddjp.play.blocked` was ever authored,
// the road tally was permanently zero and the availability escape could not fire in a live room.
//
// So the question here is: **does the thing the UI actually calls reach the transport?**
//
// ── WHY THE HANDLER IS EXTRACTED AND EXECUTED RATHER THAN MATCHED ────────────────────────────
// The ui/ files are read as source text by many guards and executed by few, which is exactly
// the weakness that let this sit. A regex proving the handler is SPELLED in that file would be the
// same class of check that was already green while the wire did not exist — it would prove a name
// is present, not that anything runs. So this file reads the room player's callbacks out of the
// one place it makes its box player (`SongPlayer.make(refs.player, …)`), EXTRACTS each handler's own
// source and RUNS it, against the real `features/mediablocked.js`, with a recording transport
// underneath. If the handler is deleted, extraction fails; if it is re-pointed at something else,
// execution stops reaching the transport.
//
// THE WHOLE PRODUCTION PATH SINCE J29'S STEP 2 (`ddjp_706`): the failure starts as YouTube's own error
// on a stand-in `YT` player, goes through the real YouTube player file (its error table, unchanged
// from MediaBlocked's) and the real plug (`tests/_player-world.js`), and reaches the room's handler as
// the app's reason — so the YouTube table, the plug's `failed` and the room handler are all on the
// path a guard drives, and none is stood in for.
//
// ── EVERY WAY OF FAILING TO REACH THIS CODE LOOKS LIKE "CORRECTLY DECLINED TO REPORT" ────────
// A handler that never ran, a fixture with nothing playing, a song that never matched, a
// module that never subscribed — all of them produce `sent: []`, which is precisely what a correct
// refusal produces. That is the failure `08-build-and-deploy.md` §Writing a guard records as
// costing three separate audits, so the preconditions are separate named checks run BEFORE any
// comparison, and `selfTest()` feeds the gate deliberately broken inputs to show it catches them.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const PW = require("./_player-world.js");

const UI_REL = "ui/player.js";     // the main player moved here at ddjp_386 (roles.md §5)
// The ROOM's box player, keyed by the box it is made in. The preview's (ui/playlists.js) is made in its own box and must
// never touch a consensus path, so the box is what keeps this measurement pointed at the right one.
const MAIN_PLAYER_ANCHOR = "SongPlayer.make(refs.player,";

// ── the reason vocabulary, DERIVED ───────────────────────────────────────────────────────────
// No token is spelled in this file or in the guard that reads it. The list is protocol and lives
// in the reducer (J06); a second copy here would go quiet the day a token is added.
const _sd = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const REASONS = (_sd.StateDeriver && _sd.StateDeriver.BLOCKED_REASONS) || {};
const COUNTING = Object.keys(REASONS).filter((k) => REASONS[k].counts);
const LOCAL = Object.keys(REASONS).filter((k) => !REASONS[k].counts);

// ── a small source scanner ───────────────────────────────────────────────────────────────────
// Brace matching that is not fooled by braces inside strings, comments or regex literals. Written
// out rather than regexed because a regex over nested object literals is the textual guard this
// file exists to avoid.
function matchBrace(src, openIdx) {
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
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Top-level `key: value` pairs of an object literal, with each value's own source.
function objectEntries(objSrc) {
  const out = {};
  const inner = objSrc.slice(1, -1);
  let i = 0;
  while (i < inner.length) {
    const c = inner[i], c2 = inner[i + 1];
    if (c === "/" && c2 === "/") { while (i < inner.length && inner[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i = inner.indexOf("*/", i + 2); if (i < 0) break; i += 2; continue; }
    if (/\s/.test(c) || c === ",") { i++; continue; }
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(inner.slice(i));
    if (!m) { i++; continue; }
    const key = m[1];
    let j = i + m[0].length;
    // the value runs to the comma that closes it at depth zero
    let depth = 0, start = j;
    for (; j < inner.length; j++) {
      const d = inner[j], d2 = inner[j + 1];
      if (d === "/" && d2 === "/") { while (j < inner.length && inner[j] !== "\n") j++; continue; }
      if (d === "/" && d2 === "*") { j = inner.indexOf("*/", j + 2); if (j < 0) { j = inner.length; break; } j++; continue; }
      if (d === '"' || d === "'" || d === "`") {
        const q = d; j++;
        while (j < inner.length && inner[j] !== q) { if (inner[j] === "\\") j++; j++; }
        continue;
      }
      if (d === "{" || d === "(" || d === "[") depth++;
      else if (d === "}" || d === ")" || d === "]") depth--;
      else if (d === "," && depth === 0) break;
    }
    out[key] = inner.slice(start, j).trim();
    i = j + 1;
  }
  return out;
}

// ── STAGE 1 — what the ROOM's player is told to call ────────────────────────────────────────
// Returns { ok, stage?, keys, handlers } — `handlers[name]` is that callback's own source (the named function it points at).
function playerEvents() {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + UI_REL + " is not readable", keys: [], handlers: {} }; }

  const hits = src.split(MAIN_PLAYER_ANCHOR).length - 1;
  if (hits !== 1) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the room player anchor " + JSON.stringify(MAIN_PLAYER_ANCHOR) + " appears " +
             hits + " times, expected exactly 1 — this measurement cannot tell which player it is " +
             "reading, and the app holds a second one (the preview) that must NOT be wired" };
  }
  const at = src.indexOf(MAIN_PLAYER_ANCHOR);
  const callOpen = at + MAIN_PLAYER_ANCHOR.length - "refs.player,".length - 1;
  let callClose = -1;
  for (let i = callOpen, d = 0; i < src.length; i++) {   // the call's own closing parenthesis
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "(" || c === "{" || c === "[") d++;
    else if (c === ")" || c === "}" || c === "]") { d--; if (d === 0) { callClose = i; break; } }
  }
  if (callClose < 0) return { ok: false, keys: [], handlers: {}, stage: "stage: the box player's making could not be matched" };
  const call = src.slice(callOpen, callClose + 1);
  // the callbacks: the call's LAST top-level object literal (its third argument)
  let open = -1, depth = 0;
  for (let i = 1; i < call.length - 1; i++) {
    const c = call[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < call.length && call[i] !== q) { if (call[i] === "\\") i++; i++; } continue; }
    if (c === "{" && depth === 0) open = i;
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
  }
  const close = matchBrace(call, open);
  if (open < 0 || close < 0) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the box player's callbacks could not be brace-matched — the extractor failed, which " +
             "is a fact about this probe rather than about the wire" };
  }
  const block = call.slice(open, close + 1);
  const named = objectEntries(block);
  const keys = Object.keys(named);
  if (keys.length === 0) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the callbacks parsed to none, so nothing below is a reading of the wire" };
  }
  const handlers = {};
  for (const k of keys) {
    const x = /^[A-Za-z_$][\w$]*$/.test(named[k]) ? PW.extract(UI_REL, named[k]) : { ok: true, source: named[k] };
    handlers[k] = x.ok ? x.source : null;
  }
  return { ok: true, keys: keys, handlers: handlers, names: named, source: block };
}

// ── STAGE 2 — RUN the handler, into the real module, onto a recording transport ──────────────
// `handlerName` is the callback's key ("failed"). `opts`: { code — YouTube's own error, raised on the stand-in, playerVideoId
// (what YouTube's player says is loaded; null: nothing), npVideoId (the room's song, default `yt:` + playerVideoId),
// nowPlaying: false, playerThrows, pi }
function driveHandler(handlerName, opts) {
  const o = opts || {};
  const ev = playerEvents();
  if (!ev.ok) return { ok: false, stage: ev.stage, sent: [] };
  const srcOfHandler = ev.handlers[handlerName];
  if (!srcOfHandler) {
    return { ok: false, sent: [], keys: ev.keys,
      stage: "stage: the room player wires no `" + handlerName + "` callback, so there is nothing " +
             "to drive — this is the ABSENCE J41 exists to close, not a probe fault" };
  }

  // THE ROOM NAMES ITS SONG BY KEY AND YOUTUBE'S PLAYER BY ITS OWN ID (J29): the default room song is the key `yt:` + the id
  // the stand-in reports, so the default case is the production one — YouTube's id coming out of its player and turned into
  // the key by the plug before the feature compares it with the room's.
  const playerVideoId = (o.playerVideoId === undefined) ? "AAAAAAAAAAA" : o.playerVideoId;
  const npVideoId = (o.npVideoId === undefined) ? "yt:AAAAAAAAAAA" : o.npVideoId;
  const np = (o.nowPlaying === false) ? null
    : { pi: o.pi || "$p1", startedAt: 0, dj: "@dj:hs", song: { songKey: npVideoId } };

  const sent = [];
  const subs = Object.create(null);
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [], settings: {}, advance: null }; },
    on(t, fn) { (subs[t] || (subs[t] = [])).push(fn); },
    off(t, fn) { if (subs[t]) subs[t] = subs[t].filter((f) => f !== fn); },
    blockedReasons() {
      const out = {};
      for (const k in REASONS) out[k] = { counts: !!REASONS[k].counts };
      return out;
    },
  };
  const MatrixBridge = {
    getUserId() { return "@me:hs"; },
    async sendEvent(ch, type, content) { sent.push({ channel: ch, type, content }); return {}; },
  };
  const Logger = { info() {}, warn() {}, debug() {}, error() {} };

  // The stagger is the room's, not this module's — driven at zero so the report fires inside the
  // measurement rather than after it. `check-blocked-reports` PART B owns the ladder ORDER; this
  // file owns whether anything reaches the transport at all.
  const fired = [];
  const sandbox = loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"],
    { StreamManager, MatrixBridge, Logger, Date, Math,
      setTimeout: (fn) => { fired.push(fn); return fired.length; },
      clearTimeout: () => {} }
  );
  const MediaBlocked = sandbox.MediaBlocked;
  if (!MediaBlocked) return { ok: false, stage: "stage: MediaBlocked did not load", sent: [] };
  MediaBlocked.setMyRank(20);
  MediaBlocked.init("!ev:hs");

  // YouTube's player as the stand-in hands it over. `playerVideoId: null` drives the mid-swap case, where it answers nothing.
  const yt = {
    getVideoData() {
      if (o.playerThrows) throw new Error("player not ready");
      return playerVideoId === null ? undefined : { video_id: playerVideoId };
    },
  };

  const ctx = { MediaBlocked, Logger, console, Date, Math, player: null, _plog() {} };
  vm.createContext(ctx);
  let handlerFn;
  try { handlerFn = vm.runInContext("(" + srcOfHandler + ")", ctx); }
  catch (e) {
    return { ok: false, sent: [], stage: "stage: the extracted `" + handlerName +
      "` callback would not evaluate (" + e.message + ") — the extractor read something that is " +
      "not a function, so nothing below is a reading of the wire" };
  }
  if (typeof handlerFn !== "function") {
    return { ok: false, sent: [], stage: "stage: the extracted `" + handlerName +
      "` callback is not a function" };
  }
  // The room's box player, made through the real plug with the callback under test, over the stand-in.
  const cb = {}; cb[handlerName] = function () { return handlerFn.apply(null, arguments); };
  const { bp, w } = PW.boxPlayer(yt, { on: cb });
  ctx.player = bp;

  let threw = null;
  try {
    if (handlerName === "failed") w.error(0, o.code);
    else if (handlerName === "state") w.state(0, o.code);
    else w.ready(0);
  } catch (e) { threw = e.message; }

  // the report is staggered — run whatever the module scheduled
  const ran = fired.length;
  for (const fn of fired.slice()) { try { fn(); } catch (e) {} }

  return {
    ok: true, sent: sent, threw: threw, scheduled: ran,
    handlerSource: srcOfHandler, keys: ev.keys,
    blocked: sent.filter((s) => s.type === "ddjp.play.blocked"),
  };
}

// YouTube's own error table, read from its one home (`ui/youtube.js`, moved there unchanged from MediaBlocked at J29 step 2).
function codeMap() {
  const w = PW.world({});
  return (w.YouTubePlayer && w.YouTubePlayer._REASON_FOR_CODE) || {};
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// `expectSend` says whether this case intends a declaration to reach the transport. The refusal
// cases intend NONE, so "nothing sent" is their result rather than a broken fixture — and the gate
// has to be told which, or it cannot tell a finding from a probe that never arrived.
function admissible(r, opts) {
  const o = opts || {};
  const expectSend = (o.expectSend === undefined) ? true : o.expectSend;
  const problems = [];
  if (!r || typeof r !== "object") return { ok: false, problems: ["no reading at all"] };
  if (!r.ok) { problems.push(r.stage || "stage: the drive did not complete"); return { ok: false, problems }; }
  if (r.threw) problems.push("stage: the handler THREW (" + r.threw + ") — a report that is " +
    "absent because the handler died is not a report the feature declined to make");
  if (expectSend && r.blocked.length === 0) {
    problems.push("stage: no ddjp.play.blocked reached the transport, so every claim below about " +
      "WHAT it carried is a claim about nothing");
  }
  if (!expectSend && r.blocked.length !== 0) {
    problems.push("stage: a declaration WAS sent (" + r.blocked.length + ") in a case that exists " +
      "to prove none is");
  }
  if (expectSend && r.scheduled === 0) {
    problems.push("stage: nothing was ever scheduled — the report path was not entered at all, " +
      "which reads identically to a reason that correctly counted toward nothing");
  }
  return { ok: problems.length === 0, problems };
}

// ── THE GATE'S OWN TEST ──────────────────────────────────────────────────────────────────────
// Broken in each way it claims to catch, plus the inverse: a gate that refuses everything is as
// useless as one that refuses nothing, and only the pair distinguishes them.
function selfTest() {
  const good = { ok: true, threw: null, scheduled: 1, blocked: [{ type: "ddjp.play.blocked" }] };
  const cases = [
    { name: "the drive never completed", r: { ok: false, stage: "stage: x", blocked: [] } },
    { name: "the handler threw", r: { ok: true, threw: "boom", scheduled: 1, blocked: [{}] } },
    { name: "nothing reached the transport", r: { ok: true, threw: null, scheduled: 1, blocked: [] } },
    { name: "nothing was scheduled", r: { ok: true, threw: null, scheduled: 0, blocked: [{}] } },
    { name: "nothing at all", r: null },
  ];
  const missed = [];
  for (const c of cases) if (admissible(c.r).ok) missed.push(c.name);
  const rejectedGood = admissible(good).ok ? null : admissible(good).problems;
  const refusal = { ok: true, threw: null, scheduled: 0, blocked: [] };
  const inversionOk = admissible(refusal, { expectSend: false }).ok
    && !admissible(good, { expectSend: false }).ok;
  return { missed, rejectedGood, inversionOk };
}

module.exports = {
  playerEvents, objectEntries, matchBrace, driveHandler, codeMap,
  admissible, selfTest,
  REASONS, COUNTING, LOCAL, UI_REL,
  StateDeriver: _sd.StateDeriver, Ranks: _sd.Ranks,
};
