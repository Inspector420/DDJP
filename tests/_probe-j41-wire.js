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
// `ui/interface.js` is read as source text by five guards and executed by none, which is exactly
// the weakness that let this sit. A regex proving `onError` is SPELLED in that file would be the
// same class of check that was already green while the wire did not exist — it would prove a name
// is present, not that anything runs. So this file EXTRACTS the handler's own source out of the
// main player's `events` object and RUNS it, against the real `features/mediablocked.js`, with a
// recording transport underneath. If the handler is deleted, extraction fails; if it is re-pointed
// at something else, execution stops reaching the transport.
//
// The closure the handler lives in is not reproduced — `player` is supplied by the harness, which
// is what production does too (YouTube hands the player over; the UI holds a reference to it).
// That is "stub the transport, not the module under test": the handler is the subject, and its
// player is a dependency.
//
// ── EVERY WAY OF FAILING TO REACH THIS CODE LOOKS LIKE "CORRECTLY DECLINED TO REPORT" ────────
// A handler that never ran, a fixture with nothing playing, a video id that never matched, a
// module that never subscribed — all of them produce `sent: []`, which is precisely what a correct
// refusal produces. That is the failure `08-build-and-deploy.md` §Writing a guard records as
// costing three separate audits, so the preconditions are separate named checks run BEFORE any
// comparison, and `selfTest()` feeds the gate deliberately broken inputs to show it catches them.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");

const UI_REL = "ui/interface.js";
// The MAIN player, keyed by the element it is mounted on. The file holds a SECOND `YT.Player` —
// the preview mini-player — whose own comment says it must never touch a consensus path, so the
// element id is what keeps this measurement pointed at the right one. Matching on `new YT.Player`
// alone would let a handler added to the preview satisfy every assertion below.
const MAIN_PLAYER_ANCHOR = 'new YT.Player("yt-player"';

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

// ── STAGE 1 — what the MAIN player wires ─────────────────────────────────────────────────────
// Returns { ok, stage?, keys, handlers } — `handlers[name]` is that handler's own source.
function playerEvents() {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + UI_REL + " is not readable", keys: [], handlers: {} }; }

  const hits = src.split(MAIN_PLAYER_ANCHOR).length - 1;
  if (hits !== 1) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the main player anchor " + JSON.stringify(MAIN_PLAYER_ANCHOR) + " appears " +
             hits + " times, expected exactly 1 — this measurement cannot tell which player it is " +
             "reading, and the file holds a second one (the preview) that must NOT be wired" };
  }
  const at = src.indexOf(MAIN_PLAYER_ANCHOR);
  const evAt = src.indexOf("events:", at);
  if (evAt < 0) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the main player has no `events:` object at all" };
  }
  const open = src.indexOf("{", evAt);
  const close = matchBrace(src, open);
  if (open < 0 || close < 0) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the `events:` object could not be brace-matched — the extractor failed, which " +
             "is a fact about this probe rather than about the wire" };
  }
  const block = src.slice(open, close + 1);
  const handlers = objectEntries(block);
  const keys = Object.keys(handlers);
  if (keys.length === 0) {
    return { ok: false, keys: [], handlers: {},
      stage: "stage: the `events:` object parsed to no handlers, so nothing below is a reading of " +
             "the wire" };
  }
  return { ok: true, keys: keys, handlers: handlers, source: block };
}

// ── STAGE 2 — does a production caller exist at all? ─────────────────────────────────────────
// Textual on purpose and reported as such: this answers "is the name mentioned outside tests",
// which is a candidate scan, never a verdict. The verdict is `driveHandler` below.
function productionCallersOf(name) {
  const out = [];
  for (const dir of ["features", "ui", "core", "app.js"]) {
    const abs = path.join(ROOT, dir);
    let files = [];
    try {
      files = fs.statSync(abs).isDirectory()
        ? fs.readdirSync(abs).filter((f) => f.endsWith(".js")).map((f) => dir + "/" + f)
        : [dir];
    } catch (e) { continue; }
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const re = new RegExp("(^|[^\\w.$])(?:[\\w$]+\\.)?" + name + "\\s*\\(", "g");
      let m;
      while ((m = re.exec(src))) {
        // the declaration itself is not a call site
        const before = src.slice(Math.max(0, m.index - 12), m.index + m[0].length);
        if (/function\s+$/.test(src.slice(Math.max(0, m.index), m.index + m[0].length - name.length - 1))) continue;
        if (/\bfunction\s+[\w$]*$/.test(before.slice(0, before.length - name.length - 1))) continue;
        out.push(rel);
        break;
      }
    }
  }
  return out;
}

// ── STAGE 3 — RUN the handler, into the real module, onto a recording transport ──────────────
// `opts`: { code, playerVideoId, npVideoId (default: same as playerVideoId), nowPlaying: false }
function driveHandler(handlerName, opts) {
  const o = opts || {};
  const ev = playerEvents();
  if (!ev.ok) return { ok: false, stage: ev.stage, sent: [] };
  const srcOfHandler = ev.handlers[handlerName];
  if (!srcOfHandler) {
    return { ok: false, sent: [], keys: ev.keys,
      stage: "stage: the main player wires no `" + handlerName + "` handler, so there is nothing " +
             "to drive — this is the ABSENCE J41 exists to close, not a probe fault" };
  }

  const playerVideoId = (o.playerVideoId === undefined) ? "AAAAAAAAAAA" : o.playerVideoId;
  const npVideoId = (o.npVideoId === undefined) ? "AAAAAAAAAAA" : o.npVideoId;
  const np = (o.nowPlaying === false) ? null
    : { pi: o.pi || "$p1", startedAt: 0, dj: "@dj:hs", song: { videoId: npVideoId } };

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

  // the player object the handler reads — supplied here exactly as YouTube supplies it in
  // production. `undefinedData` drives the mid-swap case, where getVideoData() answers nothing.
  const player = {
    getVideoData() {
      if (o.playerThrows) throw new Error("player not ready");
      return playerVideoId === null ? undefined : { video_id: playerVideoId };
    },
  };

  const ctx = { MediaBlocked, player, Logger, console, Date, Math };
  vm.createContext(ctx);
  let handlerFn;
  try { handlerFn = vm.runInContext("(" + srcOfHandler + ")", ctx); }
  catch (e) {
    return { ok: false, sent: [], stage: "stage: the extracted `" + handlerName +
      "` handler would not evaluate (" + e.message + ") — the extractor read something that is " +
      "not a function, so nothing below is a reading of the wire" };
  }
  if (typeof handlerFn !== "function") {
    return { ok: false, sent: [], stage: "stage: the extracted `" + handlerName +
      "` handler is not a function" };
  }

  let threw = null;
  try { handlerFn({ data: o.code, target: player }); }
  catch (e) { threw = e.message; }

  // the report is staggered — run whatever the module scheduled
  const ran = fired.length;
  for (const fn of fired.slice()) { try { fn(); } catch (e) {} }

  return {
    ok: true, sent: sent, threw: threw, scheduled: ran,
    handlerSource: srcOfHandler, keys: ev.keys,
    blocked: sent.filter((s) => s.type === "ddjp.play.blocked"),
  };
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
  playerEvents, objectEntries, matchBrace, productionCallersOf, driveHandler,
  admissible, selfTest,
  REASONS, COUNTING, LOCAL, UI_REL, MAIN_PLAYER_ANCHOR,
  StateDeriver: _sd.StateDeriver, Ranks: _sd.Ranks,
};
