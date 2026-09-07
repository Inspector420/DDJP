// tests/_probe-j14-card.js
// THE DRIVING HARNESS FOR THE USER CARD (J14), AND ITS ADMISSIBILITY GATE.
//
// J14 builds TWO things, and they fail in different ways, so this file drives both separately:
//
//   1. THE RULES — `member.kick` / `member.ban` as gates and capability verbs, shaped after
//      `rank.assign` (act on a target strictly below you). Driven across the whole ladder.
//   2. THE SURFACE — the user card in `ui/interface.js`. Driven by EXTRACTING the card's own
//      opener out of that file and RUNNING it, for the reason `check-blocked-wire` extracts
//      `onError`: nine guards read this file as source text and none executes it, so a regex
//      proving a name is SPELLED there is the same class of check that stayed green for the
//      whole time the blocked wire did not exist.
//
// ── THE THING THAT MAKES THIS JOB DIFFERENT FROM EVERY OTHER GATED VERB ──────────────────────
// Every verb `check-capabilities` covers has a REDUCER branch to be equivalent to: the guard
// drives the fold and asserts `can().permitted` equals whether the reducer acted. `member.kick`
// and `member.ban` have no reducer branch and can never have one — they are Matrix MEMBERSHIP
// acts against the homeserver, in the same family as `rank.assign`, `room.invite` and
// `room.upgrade`, which `capabilities.js` already groups under "feature/transport verbs (NOT
// reducer events)". So the enforcement counterpart is the HOMESERVER's power levels, written by
// `_powerLevels()` in `matrixbridge.js` as `ban: 100` / `kick: 60`.
//
// That is what `homeserverGate()` below reads, and it is the equivalence that matters here: an
// app gate WEAKER than the power level produces a button that reports permitted and yields a 403,
// which is precisely the drift `check-capabilities` exists to catch for reducer verbs, arriving
// through a different enforcer. It is read by EXECUTING `_powerLevels` rather than by regex,
// because the numbers are computed in a function and a regex over them would go quiet the day
// somebody derives them.
//
// ── EVERY WAY OF FAILING TO REACH THIS CODE LOOKS LIKE A CORRECT REFUSAL ─────────────────────
// A ladder loop that filtered to empty, a card opener that never ran, a target that was never
// below the actor, a roster that came back empty — all of them produce "no action offered",
// which is exactly what a correct denial produces. So every measurement below states its
// preconditions as separate named checks, run BEFORE any comparison, and `selfTest()` feeds the
// gate deliberately broken inputs in both directions: a gate that refuses everything is as
// useless as one that refuses nothing, and only the pair distinguishes them.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");

const UI_REL = "ui/interface.js";
const MB_REL = "backends/backend1/matrixbridge.js";

// The card opener. Anchored on the function NAME rather than on a line or a comment, because a
// comment moves and a line number drifts (`roles.md` §Conventions: point at a name, never a line).
const CARD_ANCHOR = "function openUserCard(";

// ── the ladder, DERIVED ──────────────────────────────────────────────────────────────────────
// No rank name and no power level is written in this file. Both come from `Ranks`, so a rung
// added or renamed is covered the day it lands rather than the day somebody remembers this file.
const _backend = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js",
], { Date, Math, JSON });

const Ranks = _backend.Ranks;
const Capabilities = _backend.Capabilities;
const LADDER = Ranks.LADDER.map((r) => ({ name: r.name, level: r.level }));

// ── STAGE 1 — what the HOMESERVER will actually enforce ──────────────────────────────────────
// `_powerLevels(sendLevel, creatorId, isSpace)` is a private function inside the transport IIFE.
// It is extracted and EXECUTED rather than matched, so the numbers read here are the numbers a
// channel is really created with. Returns { ok, stage?, ban, kick, weakestRankFor(n) }.
function homeserverGate() {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, MB_REL), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + MB_REL + " is not readable" }; }

  const anchor = "function _powerLevels(";
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) {
    return { ok: false, stage: "stage: `" + anchor + "` appears " + hits + " times, expected 1 — " +
      "this measurement cannot tell which definition it is reading" };
  }
  const at = src.indexOf(anchor);
  const open = src.indexOf("{", at);
  const close = matchBrace(src, open);
  if (open < 0 || close < 0) {
    return { ok: false, stage: "stage: `_powerLevels` could not be brace-matched — the extractor " +
      "failed, which is a fact about this probe rather than about the power levels" };
  }
  const fnSrc = src.slice(at, close + 1);
  const ctx = {};
  vm.createContext(ctx);
  let pl;
  try {
    vm.runInContext(fnSrc + "\n;globalThis.__pl = _powerLevels(0, '@o:hs', false);", ctx);
    pl = ctx.__pl;
  } catch (e) {
    return { ok: false, stage: "stage: the extracted `_powerLevels` would not run (" + e.message + ")" };
  }
  if (!pl || typeof pl.ban !== "number" || typeof pl.kick !== "number") {
    return { ok: false, stage: "stage: `_powerLevels` returned no numeric ban/kick, so every claim " +
      "below about what the homeserver enforces is a claim about nothing" };
  }
  return {
    ok: true, ban: pl.ban, kick: pl.kick, redact: pl.redact,
    // The WEAKEST ladder rung that meets a power level. `Ranks.nameOf` rounds DOWN between rungs,
    // so a level that is not itself a rung answers the rung below it — which would be a rank that
    // does NOT meet the level. Walk the ladder instead and take the weakest rung at or above it.
    weakestRankFor(n) {
      let best = null;
      for (const r of LADDER) if (r.level >= n) best = r.name;
      return best;
    },
  };
}

// ── a small source scanner ───────────────────────────────────────────────────────────────────
// Bracket matching that is not fooled by brackets inside strings, comments or regex literals.
// Written out rather than regexed because a regex over nested bodies is the textual guard this
// file exists to avoid. Same shape as `_probe-j41-wire.js`'s, and deliberately so — a second
// dialect of the same scanner is a second thing to get wrong. Generalised over the bracket pair
// because the card is partly a `function` (braces) and partly a `const` table (square brackets),
// and one matcher with a parameter is better than two that can drift.
function matchPair(src, openIdx, open, close) {
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
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function matchBrace(src, openIdx) { return matchPair(src, openIdx, "{", "}"); }

// Extract a named declaration's own source out of a file. Handles `function NAME(...) {...}` and
// `const NAME = [...]`, because the card is both. Every failure names its own stage, so an
// extractor that broke is never mistaken for a subject that is absent.
function extractNamed(rel, name) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + rel + " is not readable" }; }

  const fnAnchor = "function " + name + "(";
  const constAnchor = "const " + name + " = [";
  const isFn = src.split(fnAnchor).length - 1;
  const isConst = src.split(constAnchor).length - 1;

  if (isFn + isConst === 0) {
    return { ok: false, stage: "stage: `" + name + "` is not declared in " + rel + " as either a " +
      "function or a const table — this is the ABSENCE J14 exists to close, not a probe fault" };
  }
  if (isFn + isConst !== 1) {
    return { ok: false, stage: "stage: `" + name + "` is declared " + (isFn + isConst) + " times in " +
      rel + ", expected exactly 1 — this measurement cannot tell which one it is reading" };
  }

  if (isFn === 1) {
    const at = src.indexOf(fnAnchor);
    const open = src.indexOf("{", src.indexOf(")", at));
    const close = matchBrace(src, open);
    if (open < 0 || close < 0) {
      return { ok: false, stage: "stage: `" + name + "` could not be brace-matched — the extractor " +
        "failed, which is a fact about this probe rather than about the subject" };
    }
    return { ok: true, source: src.slice(at, close + 1), whole: src };
  }
  const at = src.indexOf(constAnchor);
  const open = src.indexOf("[", at);
  const close = matchPair(src, open, "[", "]");
  if (open < 0 || close < 0) {
    return { ok: false, stage: "stage: `" + name + "` could not be bracket-matched — the extractor " +
      "failed, which is a fact about this probe rather than about the subject" };
  }
  // include the trailing semicolon so the slice is a complete statement
  const end = src.indexOf(";", close);
  return { ok: true, source: src.slice(at, (end > 0 ? end : close) + 1), whole: src };
}

// Kept under its old name for the one caller that reads a function by an explicit anchor.
function extractFunction(rel, anchor) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + rel + " is not readable" }; }
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) {
    return { ok: false, stage: "stage: the anchor " + JSON.stringify(anchor) + " appears " + hits +
      " times in " + rel + ", expected exactly 1 — this measurement cannot tell which definition " +
      "it is reading" };
  }
  const at = src.indexOf(anchor);
  const open = src.indexOf("{", src.indexOf(")", at));
  const close = matchBrace(src, open);
  if (open < 0 || close < 0) {
    return { ok: false, stage: "stage: " + JSON.stringify(anchor) + " could not be brace-matched — " +
      "the extractor failed, which is a fact about this probe rather than about the subject" };
  }
  return { ok: true, source: src.slice(at, close + 1), whole: src };
}

// ── STAGE 2 — the RULES, driven across the ladder ────────────────────────────────────────────
// For one verb, ask `Capabilities.can` for every (actor rung × target rung) pair. Returns a grid
// plus the counts the gate checks, so "permitted nowhere" and "the loop never ran" are different
// readings rather than the same empty answer.
function ladderGrid(verb, mkTarget) {
  const rows = [];
  let asked = 0, permitted = 0;
  for (const actor of LADDER) {
    for (const target of LADDER) {
      const ctx = {
        myId: "@me:hs", myRank: actor.level, now: 0,
        target: (mkTarget ? mkTarget(target, actor) : { targetRank: target.level }),
      };
      let d;
      try { d = Capabilities.can(verb, {}, ctx); }
      catch (e) { d = { permitted: false, reason: "THREW: " + e.message, threw: true }; }
      asked++;
      if (d.permitted) permitted++;
      rows.push({
        actor: actor.name, actorLevel: actor.level,
        target: target.name, targetLevel: target.level,
        permitted: !!d.permitted, reason: d.reason || null, threw: !!d.threw,
      });
    }
  }
  return { verb, rows, asked, permitted, ladder: LADDER.map((r) => r.name) };
}

// ── STAGE 3 — the SURFACE, extracted and RUN ─────────────────────────────────────────────────
// Runs the card opener against a recording `Actions` stub and a DOM stub, and reports what the
// card ASKED and what it OFFERED. The closure the opener lives in is not reproduced — `el`,
// `clear`, `Actions` and the rest are supplied by the harness, which is what production does too
// (the IIFE holds them). That is "stub the transport, not the module under test": the opener is
// the subject; its DOM builders and its adapter are dependencies.
//
// `describeAnswers` maps an action id to the descriptor the stub should return, so a case can put
// the card in front of a permitted or denied answer WITHOUT the card being able to tell the
// difference from anything but the descriptor — which is the whole property under test.
function driveCard(opts) {
  const o = opts || {};
  // THE CARD IS FOUR DECLARATIONS AND ALL FOUR ARE THE SUBJECT. `_CARD_ACTIONS` is the table,
  // `_cardActions` filters it against the adapter's vocabulary (the claim J15 rests on),
  // `openUserCard` builds, `_runCardAction` handles the click. Extracted separately so a
  // failure names WHICH one is missing rather than reporting "the card threw".
  const pieces = ["_CARD_ACTIONS", "_cardActions", "openUserCard", "_runCardAction"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractNamed(UI_REL, p);
    if (!ex.ok) return { ok: false, stage: ex.stage, asked: [], offered: [], performed: [] };
    srcs.push(ex.source);
  }

  const asked = [];      // every Actions.describe(action, target) the card made
  const performed = [];  // every Actions.perform the card fired
  const closed = [];     // every _closeUserCard the card made (see `closeOnRun`)
  const answers = o.describeAnswers || {};
  const knownActions = (o.knownActions === undefined)
    ? Object.keys(answers) : o.knownActions;

  const Actions = {
    ACTIONS: knownActions,
    describe(action, target) {
      asked.push({ action, target: target || null });
      const a = answers[action];
      if (a === undefined) return { enabled: false, reason: "Unknown action", label: null };
      return (typeof a === "function") ? a(target) : a;
    },
    perform(action, args) {
      performed.push({ action, args: args || null });
      const a = answers[action];
      const d = (a === undefined) ? { enabled: false, reason: "Unknown action" }
        : ((typeof a === "function") ? a(args) : a);
      if (!d.enabled) return Promise.reject(new Error(d.reason || "Not permitted"));
      return Promise.resolve(o.performResult || { ok: true });
    },
  };

  // ── the DOM stub ──────────────────────────────────────────────────────────────────────────
  // Text-only, exactly like the real `el`: a node records its tag, attrs, text and children, and
  // `onclick` is captured so a case can fire it. Nothing here can build HTML from a string, which
  // is the same constraint the real primitives are under (`check-html-safety`).
  function node(tag) {
    return {
      tag, attrs: {}, text: "", children: [], style: {}, dataset: {}, classList: {
        add() {}, remove() {}, toggle() {}, contains() { return false; },
      },
      appendChild(c) { this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.children.push(c); },
      remove() {}, replaceWith() {}, closest() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {}, focus() {},
      setAttribute(k, v) { this.attrs[k] = v; },
      get textContent() { return this.text; },
      set textContent(v) { this.text = String(v); },
    };
  }
  // Mirrors the real `el` in `ui/interface.js` key for key, including that `onclick`,
  // `disabled` and `value` are PROPERTIES while everything else is an attribute. A harness that
  // wired handlers differently from production could hide a control that is dead in the browser
  // and live here.
  function el(tag, attrs, kids) {
    const n = node(tag);
    if (attrs) for (const k in attrs) {
      if (k === "text") n.text = String(attrs[k]);
      else if (k === "class") n.className = attrs[k];
      else if (k === "onclick") n.onclick = attrs[k];
      else if (k === "disabled") n.disabled = attrs[k];
      else if (k === "value") n.value = attrs[k];
      else n.attrs[k] = attrs[k];
    }
    if (kids) for (const c of kids) if (c) n.children.push(c);
    return n;
  }
  function clear(n) { if (n) n.children = []; }

  const mounted = [];
  let rankControlOffered = false;
  const sandbox = {
    el, clear, console,
    Actions,
    // the card's own dependencies, stubbed to record rather than to decide
    rankName: (lvl) => String(lvl),
    rankColor: () => "#fff",
    shortName: (id) => String(id),
    avatarEl: () => node("span"),
    // `rankSelect` is a DEPENDENCY, not the subject: it is the existing roster control and its
    // own per-level filtering is guarded where it lives. Stubbed to record that the card offered
    // it, which is the only thing this measurement is asking about.
    rankSelect: (lvl, onPick) => { rankControlOffered = true; const n = node("select"); n.onPick = onPick; return n; },
    Logger: { info() {}, warn() {}, debug() {}, error() {} },
    Room: {
      getRoster: () => (o.roster || []),
      getChannels: () => ({ events_owner: "!e:hs" }),
      isRankUnlocked: () => true,
      getMyId: () => "@me:hs",
    },
    _cardMount: (n) => { mounted.push(n); },
    // RECORDED rather than ignored. `closeOnRun` is the difference between a card that closes
    // behind an action opening its own surface and one that stays up printing a verdict about a
    // room set the action never touched — so whether this was called is the observable.
    _closeUserCard: () => { closed.push(true); },
    document: { body: node("body"), createElement: (t) => node(t), addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn) => { if (o.runTimers) { try { fn(); } catch (e) {} } return 0; },
    clearTimeout: () => {},
    Date, Math, JSON, String, Number, Boolean, Array, Object, Promise, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  let threw = null;
  try {
    vm.runInContext(srcs.join("\n") + "\n;globalThis.__open = openUserCard;", sandbox);
    sandbox.__open(o.member || { userId: "@them:hs", name: "Them", level: 0 });
  } catch (e) { threw = e.message; }

  // Walk whatever the card mounted and collect the controls it actually OFFERED — a button is
  // offered if it was appended, regardless of what it is labelled. `live` is the half that
  // matters: a control the card appended but DISABLED has not been offered as an action.
  const offered = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.tag === "button" || n.tag === "select") {
      offered.push({
        tag: n.tag, text: n.text, action: n.dataset ? n.dataset.action : null,
        disabled: !!n.disabled,
        // the card sets `btn.title = ...` as a PROPERTY; `el` sets it as an attribute. Read both,
        // or a tooltip assertion passes for a reason that has nothing to do with the card.
        title: (n.title !== undefined && n.title !== "") ? n.title : (n.attrs ? n.attrs.title : null),
        live: !n.disabled && typeof n.onclick === "function",
        node: n,
      });
    }
    for (const c of (n.children || [])) walk(c);
  }
  for (const m of mounted) walk(m);

  return {
    ok: threw === null, threw, stage: threw ? ("stage: the extracted card opener THREW (" + threw +
      ") — a card that offers nothing because it died is not a card that declined to offer") : null,
    asked, offered, performed, mounted: mounted.length,
    mountedNodes: mounted,
    rankControlOffered,
    closed,
    // Fire the control for `action`, so a case can drive the click path rather than only the
    // render. Returns the promise `_runCardAction` produced, or null if no such control is live.
    click(action) {
      const c = offered.find((x) => x.action === action && x.live);
      if (!c) return null;
      c.node.onclick();
      return c.node;
    },
    // Every text the card is CURRENTLY showing. Re-walked on demand, because the verdict wording
    // is written into the card AFTER the perform promise settles — a snapshot taken at render
    // time cannot see it.
    texts() {
      const out = [];
      (function walk(n) {
        if (!n) return;
        if (n.text) out.push(n.text);
        for (const c of (n.children || [])) walk(c);
      })({ children: mounted });
      return out;
    },
    source: srcs.join("\n"),
  };
}

// ── STAGE 4 — the ALL-OR-NOTHING loop, driven against a partially-failing homeserver ─────────
// The consequence J14's entry says will bite on day one: a room is 21 Matrix rooms, a ban is 21
// bans, and a partial ban looks exactly like a success. This drives the real transport function
// against a client that refuses a chosen subset, and reports what the caller was TOLD.
//
// `failOn` is a predicate over room ids. `null` fails nothing (the control — without it a refusal
// is not attributable to the partial failure, `09-roadmap.md` §8).
function driveMembershipLoop(fnName, opts) {
  const o = opts || {};
  const spaceId = "!space:hs";
  const channels = {};
  // TWENTY channels plus the Space = the 21 rooms the entry names. Built from the transport's own
  // taxonomy so the count is the tree's rather than this file's.
  const sandboxForTaxonomy = _loadTransport({ calls: [], failOn: null });
  const rows = (sandboxForTaxonomy && sandboxForTaxonomy.MatrixBridge
    && sandboxForTaxonomy.MatrixBridge.channelTaxonomy)
    ? sandboxForTaxonomy.MatrixBridge.channelTaxonomy() : null;
  if (rows && rows.length) {
    for (const r of rows) channels[r.key] = "!" + r.key + ":hs";
  } else {
    return { ok: false, stage: "stage: the channel taxonomy could not be read out of the transport, " +
      "so the loop below would run over a room set this file invented rather than the tree's",
      calls: [], result: null };
  }

  const calls = [];
  const sandbox = _loadTransport({ calls, failOn: o.failOn || null, invisible: o.invisible || null });
  const MB = sandbox.MatrixBridge;
  if (!MB || typeof MB[fnName] !== "function") {
    return { ok: false, stage: "stage: the transport exports no `" + fnName + "`, so there is " +
      "nothing to drive — this is the ABSENCE J14 exists to close, not a probe fault",
      calls: [], result: null, roomCount: 1 + Object.keys(channels).length };
  }

  let result = null, threw = null;
  return MB[fnName](spaceId, channels, o.userId || "@them:hs", o.reason || "test")
    .then((r) => { result = r; })
    .catch((e) => { threw = e && e.message; })
    .then(() => ({
      ok: threw === null, threw,
      stage: threw ? ("stage: `" + fnName + "` REJECTED (" + threw + ") — a caller that was told " +
        "nothing because the call blew up is not a caller that was told the truth") : null,
      calls, result,
      roomCount: 1 + Object.keys(channels).length,
      channels: Object.keys(channels),
    }));
}

// Load the transport with a recording, selectively-failing Matrix client under it.
//
// THE STUB MODELS MEMBERSHIP, and that is not decoration. The subject's whole claim is that it
// VERIFIES rather than trusting the call, so a client whose `getRoom` answered `null` would make
// every room unverified and the control would fail for a reason that has nothing to do with the
// rule. Membership starts at `join` for every room and moves only when a call actually succeeds —
// so a refused call leaves that room readable and still joined, which is exactly the state the
// partial-ban row exists to detect. `invisible` models the third case: a room the client cannot
// see at all, where the honest answer is "unconfirmed" rather than either verdict.
function _loadTransport(env) {
  const calls = env.calls;
  const failOn = env.failOn;
  const invisible = env.invisible || null;
  const membership = Object.create(null);   // roomId -> "join" | "leave" | "ban"
  const client = {
    getRoom(roomId) {
      if (invisible && invisible(roomId)) return null;
      return {
        getMember(userId) {
          return { membership: membership[roomId] || "join", userId: userId };
        },
        currentState: { getStateEvents: () => null },
      };
    },
    getUserId() { return "@me:hs"; },
    async ban(roomId, userId, reason) {
      calls.push({ op: "ban", roomId, userId, reason });
      if (failOn && failOn(roomId, "ban")) throw new Error("M_FORBIDDEN");
      membership[roomId] = "ban";
      return {};
    },
    async kick(roomId, userId, reason) {
      calls.push({ op: "kick", roomId, userId, reason });
      if (failOn && failOn(roomId, "kick")) throw new Error("M_FORBIDDEN");
      membership[roomId] = "leave";
      return {};
    },
    async invite() { return {}; },
    async sendStateEvent() { return {}; },
    on() {}, off() {},
  };
  let sandbox;
  try {
    sandbox = loadInContext([
      "core/logger.js",
      "backends/backend1/ranks.js",
      "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js",
      "backends/backend1/eventcache.js",
      "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js",
      "backends/backend1/streammanager.js",
      "backends/backend1/checkpointformat.js",
      "backends/backend1/dials.js",
      "backends/backend1/session.js",
      "backends/backend1/scheduler.js",
      "backends/backend1/vouch.js",
      "backends/backend1/floor.js",
      "backends/backend1/checkpoint.js",
      "backends/backend1/continuity.js",
      "backends/backend1/history.js",
      "backends/backend1/settingsproof.js",
      "backends/backend1/matrixbridge.js",
    ], {
      Date, Math, JSON, Promise, setTimeout: (fn) => { return 0; }, clearTimeout: () => {},
      setInterval: () => 0, clearInterval: () => {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      indexedDB: undefined,
      window: { addEventListener() {}, removeEventListener() {} },
      document: { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" },
      navigator: { onLine: true },
      crypto: undefined,
      matrixcs: undefined,
    });
  } catch (e) {
    return { __loadError: e.message };
  }
  if (sandbox.MatrixBridge && sandbox.MatrixBridge._setClientForTest) {
    sandbox.MatrixBridge._setClientForTest(client);
  }
  return sandbox;
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Four kinds of reading, four different ways of being empty, and `null` at the end looks the same
// whichever stage failed. Each caller says what it INTENDED, so a refusal is attributable.
function admissible(kind, r, opts) {
  const o = opts || {};
  const problems = [];
  if (!r || typeof r !== "object") return { ok: false, problems: ["no reading at all"] };

  if (kind === "grid") {
    if (!r.rows || r.rows.length === 0) {
      problems.push("stage: the ladder loop produced no rows, so every claim below is a claim " +
        "about an empty grid");
      return { ok: false, problems };
    }
    if (r.asked !== LADDER.length * LADDER.length) {
      problems.push("stage: the grid asked " + r.asked + " pairs, expected " +
        (LADDER.length * LADDER.length) + " — the loop did not cover the ladder");
    }
    if (r.rows.some((x) => x.threw)) {
      problems.push("stage: at least one pair THREW, so a `false` in this grid may be a crash " +
        "rather than a denial");
    }
    // THE ROW'S OWN PREMISE. A grid that permits NOTHING refuses itself: it is what an absent
    // verb produces, and an absent verb is exactly what this measurement exists to distinguish
    // from a correctly strict rule.
    if (o.expectSomePermitted !== false && r.permitted === 0) {
      problems.push("stage: the verb `" + r.verb + "` permitted NOBODY anywhere on the ladder, " +
        "which is what an UNDECLARED verb produces (`can` answers \"Unknown action\") — so this " +
        "grid cannot distinguish a strict rule from a missing one");
    }
    if (o.expectSomeDenied !== false && r.permitted === r.asked) {
      problems.push("stage: the verb `" + r.verb + "` permitted EVERY pair, so the grid pins no " +
        "boundary at all");
    }
    return { ok: problems.length === 0, problems };
  }

  if (kind === "card") {
    if (!r.ok) { problems.push(r.stage || "stage: the card drive did not complete"); return { ok: false, problems }; }
    if (r.mounted === 0) {
      problems.push("stage: the card mounted nothing, so every claim below about what it offered " +
        "is a claim about nothing");
    }
    if (r.asked.length === 0) {
      problems.push("stage: the card asked `Actions.describe` NOTHING — a card that offers no " +
        "action because it never asked reads identically to one that asked and was denied, and " +
        "the difference is the whole property under test");
    }
    if (o.expectOffered && r.offered.length === 0) {
      problems.push("stage: the card offered no control at all in a case that exists to prove one " +
        "is offered");
    }
    return { ok: problems.length === 0, problems };
  }

  if (kind === "loop") {
    if (!r.ok) { problems.push(r.stage || "stage: the membership loop did not complete"); return { ok: false, problems }; }
    if (!r.calls || r.calls.length === 0) {
      problems.push("stage: the loop made no homeserver calls at all, so nothing below is a " +
        "reading of what it does across the room set");
    }
    // DERIVED FROM THE TAXONOMY (v322), not the literal 21 this held. The set is built from the
    // transport's own table a hundred lines up — precisely so the count is the tree's — and then
    // this gate compared it against a number written here, which is the second copy the build
    // above exists to avoid. Adding one channel made a correct measurement inadmissible.
    const _rows = channelTaxonomyRows();
    const _want = (_rows && _rows.length) ? _rows.length + 1 : null;
    if (_want === null) {
      problems.push("stage: the channel taxonomy could not be read, so the room set's size cannot " +
        "be checked against anything");
    } else if (r.roomCount !== _want) {
      problems.push("stage: the room set is " + r.roomCount + " rooms, not the " + _want + " the design " +
        "describes — the premise this measurement rests on has changed and the numbers below " +
        "describe a different room");
    }
    if (!r.result || typeof r.result !== "object") {
      problems.push("stage: the loop returned no verdict object, so `ok` cannot be read from it " +
        "and a partial failure would be indistinguishable from a success by construction");
    }
    return { ok: problems.length === 0, problems };
  }

  return { ok: false, problems: ["unknown reading kind: " + kind] };
}

// ── THE GATE'S OWN TEST ──────────────────────────────────────────────────────────────────────
// Broken in each way it claims to catch, plus the inverse in both directions. A gate that refuses
// everything certifies nothing; a gate that refuses nothing certifies everything on its own
// authority. Only the pair distinguishes them, and the gate is itself untested code.
function selfTest() {
  const missed = [], falseAlarms = [];
  const n = LADDER.length;

  const goodGrid = { verb: "x", asked: n * n, permitted: 3,
    rows: Array.from({ length: n * n }, () => ({ threw: false })) };
  const badGrids = [
    ["no rows", { verb: "x", asked: 0, permitted: 0, rows: [] }],
    ["short loop", { verb: "x", asked: 3, permitted: 1, rows: [{ threw: false }] }],
    ["a pair threw", { verb: "x", asked: n * n, permitted: 1,
      rows: Array.from({ length: n * n }, (_, i) => ({ threw: i === 0 })) }],
    ["permitted nobody (an absent verb)", { verb: "x", asked: n * n, permitted: 0,
      rows: Array.from({ length: n * n }, () => ({ threw: false })) }],
    ["permitted everybody (pins no boundary)", { verb: "x", asked: n * n, permitted: n * n,
      rows: Array.from({ length: n * n }, () => ({ threw: false })) }],
  ];
  for (const [name, g] of badGrids) if (admissible("grid", g).ok) missed.push("grid: " + name);
  if (!admissible("grid", goodGrid).ok) falseAlarms.push("grid: refused a sound reading");

  const goodCard = { ok: true, mounted: 1, asked: [{ action: "a" }], offered: [{ tag: "button" }] };
  const badCards = [
    ["drive did not complete", { ok: false, stage: "stage: x", mounted: 0, asked: [], offered: [] }],
    ["mounted nothing", { ok: true, mounted: 0, asked: [{}], offered: [{}] }],
    ["asked nothing", { ok: true, mounted: 1, asked: [], offered: [{}] }],
  ];
  for (const [name, c] of badCards) if (admissible("card", c).ok) missed.push("card: " + name);
  if (!admissible("card", goodCard).ok) falseAlarms.push("card: refused a sound reading");
  // the inversion: a case that expects an offer must refuse a card that offered none
  if (admissible("card", { ok: true, mounted: 1, asked: [{}], offered: [] }, { expectOffered: true }).ok) {
    missed.push("card: expected an offer and got none");
  }

  const _rowsST = channelTaxonomyRows();
  const goodLoop = { ok: true, calls: [{ op: "ban" }],
                     roomCount: (_rowsST && _rowsST.length) ? _rowsST.length + 1 : 0,
                     result: { ok: true } };
  const badLoops = [
    ["loop did not complete", { ok: false, stage: "stage: x", calls: [], roomCount: 21, result: {} }],
    ["no calls", { ok: true, calls: [], roomCount: 21, result: {} }],
    ["wrong room count", { ok: true, calls: [{}], roomCount: 5, result: {} }],
    ["no verdict object", { ok: true, calls: [{}], roomCount: 21, result: null }],
  ];
  for (const [name, l] of badLoops) if (admissible("loop", l).ok) missed.push("loop: " + name);
  if (!admissible("loop", goodLoop).ok) falseAlarms.push("loop: refused a sound reading");

  if (admissible("nonsense", {}).ok) missed.push("an unknown reading kind was admitted");

  return { missed, falseAlarms, ok: missed.length === 0 && falseAlarms.length === 0 };
}

// The taxonomy the room set is built from, exposed so a caller can DERIVE the room count instead
// of restating it. `check-user-card` PART F needs "every channel, plus the Space", and a literal
// there is a second copy of this table that goes stale the next time a channel is added — which is
// exactly what happened when the presence chat landed at v322.
function channelTaxonomyRows() {
  const sb = _loadTransport({ calls: [], failOn: null });
  return (sb && sb.MatrixBridge && sb.MatrixBridge.channelTaxonomy)
    ? sb.MatrixBridge.channelTaxonomy() : null;
}

module.exports = {
  channelTaxonomyRows,
  LADDER, Ranks, Capabilities,
  homeserverGate, extractFunction, extractNamed, matchBrace, matchPair,
  ladderGrid, driveCard, driveMembershipLoop,
  admissible, selfTest,
  UI_REL, MB_REL, CARD_ANCHOR,
};
