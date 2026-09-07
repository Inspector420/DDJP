// tests/_probe-j15-dm.js
// SHARED HARNESS for J15 (the DM panel) — used by `tests/check-dm-panel.js` and by
// `tools/probes/probe-j15-dm.js`, so the guard and the measurement cannot drift.
//
// ── WHY THINGS ARE EXTRACTED AND RUN RATHER THAN MATCHED ─────────────────────────────────────
// Two of this job's three subjects live in files nothing in the suite executes. `_routeEvent` is
// inside `MatrixBridge.start()`, reachable only with a live SDK client; the DM panel is inside
// `ui/interface.js`, which nine guards read as text and three now run. A regex proving `inScope`
// is SPELLED beside the store call is exactly the check that was green for the whole life of the
// blocked wire (J41) — so both are pulled out by name and driven.
//
// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every reading here has several stages — find the file, find the declaration, brace-match it,
// run it, observe something — and `null` at the end looks identical whichever stage failed. So a
// reading states its preconditions as SEPARATE checks and refuses to be asserted from if one
// fails, naming which. `selfTest()` feeds the gate deliberately broken readings AND sound ones,
// because a gate that refuses everything certifies nothing.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const MB_REL = "backends/backend1/matrixbridge.js";
const UI_REL = "ui/interface.js";

// ── extraction ───────────────────────────────────────────────────────────────────────────────
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return i; }
  }
  return -1;
}
function matchPair(src, open, o, c) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) d++;
    else if (src[i] === c) { d--; if (d === 0) return i; }
  }
  return -1;
}

// Pull one named declaration out of a file. Anchors on the name, so a guard keyed to this cannot
// fail because a comment moved — and if the region is reformatted past recognition it REFUSES
// (naming the stage) rather than passing, which is the safe direction.
function extractNamed(rel, name) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return { ok: false, stage: "stage: " + rel + " is not readable" }; }

  const fnAnchor = "function " + name + "(";
  const constAnchor = "const " + name + " = [";
  const isFn = src.split(fnAnchor).length - 1;
  const isConst = src.split(constAnchor).length - 1;

  if (isFn + isConst === 0) {
    return { ok: false, stage: "stage: `" + name + "` is not declared in " + rel +
      " — this measurement has no subject" };
  }
  if (isFn + isConst !== 1) {
    return { ok: false, stage: "stage: `" + name + "` is declared " + (isFn + isConst) +
      " times in " + rel + ", expected exactly 1 — this measurement cannot tell which one it reads" };
  }
  if (isFn === 1) {
    const at = src.indexOf(fnAnchor);
    const open = src.indexOf("{", src.indexOf(")", at));
    const close = matchBrace(src, open);
    if (open < 0 || close < 0) {
      return { ok: false, stage: "stage: `" + name + "` could not be brace-matched — a fact " +
        "about this probe rather than about the subject" };
    }
    return { ok: true, source: src.slice(at, close + 1), whole: src };
  }
  const at = src.indexOf(constAnchor);
  const open = src.indexOf("[", at);
  const close = matchPair(src, open, "[", "]");
  if (open < 0 || close < 0) {
    return { ok: false, stage: "stage: `" + name + "` could not be bracket-matched" };
  }
  const end = src.indexOf(";", close);
  return { ok: true, source: src.slice(at, (end > 0 ? end : close) + 1), whole: src };
}

// ── STAGE 1 — THE DOOR, extracted from matrixbridge.js and RUN ───────────────────────────────
// `_routeEvent` is the router every live Matrix event passes through. It has two ingest doors:
// `_ingestSpineEvent` (which carries the room-scope gate inside it) and the non-Spine branch that
// stores and folds directly. The second is the one J15's invariant rests on, and the only way to
// see which one an event reaches is to run the router.
//
// The dependencies are stubbed to RECORD, never to decide — `_isSpineChannel` and
// `_isChatChannel` are the REAL predicates, copied by reference out of the loaded module, so a
// change to either is visible here rather than hidden behind a harness copy.
function driveRoute(opts) {
  const o = opts || {};
  const ex = extractNamed(MB_REL, "_routeEvent");
  if (!ex.ok) return { ok: false, stage: ex.stage, calls: [] };

  const calls = [];
  const scope = Object.create(null);
  for (const id of (o.scope || [])) scope[id] = 1;
  const dmScope = Object.create(null);
  for (const id of (o.dmScope || [])) dmScope[id] = 1;

  const sandbox = {
    // THE REAL `ChatBuffer`, because `_dmFoldMessage` now DELEGATES its transition rules to it
    // rather than restating them. A stub here would put the second copy back inside the guard.
    ChatBuffer: require(require("path").join(__dirname, "_load.js"))
      .loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer,
    console,
    // the two REAL predicates, taken from the module's own source rather than restated
    _isSpineChannel: o.isSpineChannel,
    _isChatChannel: o.isChatChannel,
    inScope: (id) => !!(id && scope[id]),
    inDMScope: (id) => !!(id && dmScope[id]),
    deliveryState: () => ({ fold: true }),
    _noteDeferred() {}, _clearDeferred() {},
    _ingestSpineEvent: (e, r) => calls.push({ f: "_ingestSpineEvent", room: r && r.roomId }),
    updateInbound: (l) => calls.push({ f: "updateInbound", l: l }),
    _channelRank: () => 0,
    EventCache: { store: (raw) => calls.push({ f: "EventCache.store", room: raw.room_id, body: raw.content && raw.content.body }) },
    StreamManager: { ingest: (raw) => calls.push({ f: "StreamManager.ingest", room: raw.room_id, body: raw.content && raw.content.body }) },
    _rawListeners: [(raw) => calls.push({ f: "rawListener", room: raw.room_id, body: raw.content && raw.content.body })],
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(ex.source + "\n;globalThis.__route = _routeEvent;", sandbox, { filename: "_routeEvent" });
  } catch (e) {
    return { ok: false, stage: "stage: `_routeEvent` did not evaluate — " + e.message, calls: [] };
  }

  const event = {
    getId: () => o.eventId || "$e1",
    getType: () => o.type || "m.room.message",
    getSender: () => o.sender || "@them:hs",
    getTs: () => o.ts || 1000,
    getContent: () => ({ body: o.body }),
    getUnsigned: () => null,
    status: null,
  };
  try { sandbox.__route(event, o.room); }
  catch (e) { return { ok: false, stage: "stage: `_routeEvent` threw — " + e.message, calls: [] }; }

  const names = calls.map((c) => c.f);
  return {
    ok: true, calls, names,
    stored: names.indexOf("EventCache.store") >= 0,
    folded: names.indexOf("StreamManager.ingest") >= 0,
    spined: names.indexOf("_ingestSpineEvent") >= 0,
    fannedOut: names.indexOf("rawListener") >= 0,
    source: ex.source,
  };
}

// ── STAGE 2 — THE PANEL, extracted from ui/interface.js and RUN ──────────────────────────────
// Four declarations are the subject: `_dmFoldMessage` (the RAM view's cap and upsert),
// `_renderDMBadge` (the notification), `renderDMPanel` (the list) and `_openDMConversation` (the
// list click). Extracted separately so a failure names WHICH one is missing rather than
// reporting "the panel threw".
function drivePanel(opts) {
  const o = opts || {};
  const pieces = ["_dmFoldMessage", "_renderDMBadge", "renderDMPanel", "_openDMConversation"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractNamed(UI_REL, p);
    if (!ex.ok) return { ok: false, stage: ex.stage, offered: [], asked: [] };
    srcs.push(ex.source);
  }

  const asked = [];
  const chatCalls = [];

  function node(tag) {
    return {
      tag, attrs: {}, text: "", children: [], style: {}, dataset: {},
      className: "", classList: {
        _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; },
        toggle(c, on) { if (on) this._s[c] = 1; else delete this._s[c]; },
        contains(c) { return !!this._s[c]; },
      },
      appendChild(c) { this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.children.push(c); },
      remove() {}, focus() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {},
      setAttribute(k, v) { this.attrs[k] = v; },
      get textContent() { return this.text; },
      set textContent(v) { this.text = String(v); },
    };
  }
  // Mirrors the real `el` key for key, including that `onclick`/`disabled`/`value` are
  // PROPERTIES while everything else is an attribute — a harness that wired handlers differently
  // from production could hide a row that is dead in the browser and live here.
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

  const dmBox = node("div");
  const tabDM = node("button");
  const Chat = {
    conversations: () => { asked.push("conversations"); return (o.conversations || []).slice(); },
    dmUnreadCount: () => (o.conversations || []).filter((c) => c.unread).length,
    currentDM: () => o.currentDM || null,
    openDMRoom: (id) => { chatCalls.push({ f: "openDMRoom", id }); return o.openResult || { ok: true, roomId: id }; },
    closeDM: () => { chatCalls.push({ f: "closeDM" }); },
    clearConversations: () => { chatCalls.push({ f: "clearConversations" }); },
    backfillDM: () => Promise.resolve({ messages: (o.backfill || []) }),
    sendDM: () => Promise.resolve({ ok: true }),
  };

  const sandbox = {
    // THE REAL `ChatBuffer`, because `_dmFoldMessage` now DELEGATES its transition rules to it
    // rather than restating them. A stub here would put the second copy back inside the guard.
    ChatBuffer: require(require("path").join(__dirname, "_load.js"))
      .loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer,
    console, el, clear, Chat, Promise,
    refs: { dmBox, tabDM },
    rightTab: o.rightTab || "dm",
    shortName: (id) => String(id),
    _fmtAgo: () => "just now",
    // The DM list reuses the room-list row shape now (v273), so it paints an avatar before the
    // name — a new dependency of `_renderDMList`. The gate caught it (`avatarEl is not defined`)
    // rather than asserting over a panel that had thrown: the FOURTH consecutive job where a gate
    // reported the harness rather than the tree.
    avatarEl: (userId) => { const a = node("img"); a.dataset = {}; a.style = {}; a.alt = String(userId); return a; },
    _wireCardTrigger: (n) => n,
    _renderDMConvo: (box) => { box.appendChild(el("div", { class: "dm-msgs" })); },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(
      "let _dmView = " + JSON.stringify(o.dmView || "list") + ";\n" +
      // The panel's module-level state, declared here because the harness EXTRACTS declarations
      // and these are not inside any of them. Its gate caught each addition (`_dmNewError is not
      // defined`) rather than asserting over a panel that had thrown — which is the harness
      // working, and the reason this list has to grow with the panel.
      "let _dmRows = [];\nlet _dmMessages = [];\nconst DM_MSG_CAP = 500;\n" +
      "let _dmNewError = \"\";\nlet _dmBackfilled = 0;\nconst DM_BACKFILL_STEP = 50;\n" +
      "const REDACTED_TEXT = \"Message deleted\";\n" +
      "function _isOwnMessage(s) { return s === (globalThis.__me || null); }\n" +
      "function _deleteDMMessage() {}\nfunction _loadEarlierDM() {}\n" +
      "function _startDMByUserId() {}\n" +
      srcs.join("\n") +
      "\n;globalThis.__render = renderDMPanel;" +
      "\n;globalThis.__fold = _dmFoldMessage;" +
      "\n;globalThis.__open = _openDMConversation;" +
      "\n;globalThis.__view = () => _dmView;",
      sandbox, { filename: "dm-panel" });
  } catch (e) {
    return { ok: false, stage: "stage: the DM panel did not evaluate — " + e.message, offered: [], asked: [] };
  }

  try { sandbox.__render(); }
  catch (e) { return { ok: false, stage: "stage: renderDMPanel threw — " + e.message, offered: [], asked: [] }; }

  // Walk the rendered tree into a flat description — what a person would actually see.
  const offered = [];
  (function walk(n) {
    if (!n) return;
    offered.push({
      tag: n.tag, cls: n.className || "", text: n.text || "",
      clickable: typeof n.onclick === "function",
      unread: !!(n.className && n.className.indexOf("unread") >= 0),
    });
    for (const c of (n.children || [])) walk(c);
  })(dmBox);

  return {
    ok: true, offered, asked, chatCalls,
    badge: tabDM.text,
    badgeUnread: tabDM.classList.contains("has-unread"),
    fold: sandbox.__fold,
    openRow: (id) => { sandbox.__open(id); return { view: sandbox.__view(), chatCalls }; },
    // ── MATCHED AS A CLASS, NOT AS A PREFIX ────────────────────────────────────────────────
    // This was `indexOf("dm-row") === 0`, which is a claim about POSITION in the class list. The
    // DM row reuses `.room-item` now (v273), so the list begins `room-item dm-row` and every row
    // vanished from the reading — the gate refused, correctly, and said the panel rendered none.
    // A class is a set and not a sequence; matching its first characters was the bug waiting for
    // any second class to be added in front.
    rows: offered.filter((n) => n.cls && n.cls.split(/\s+/).indexOf("dm-row") >= 0),
    source: srcs.join("\n"),
  };
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Each kind states what a SOUND reading of it looks like. `expect*` options let a caller demand
// the premise its own assertion needs — a row that stops pinning anything refuses itself.
function admissible(kind, r, opts) {
  const o = opts || {};
  const problems = [];
  if (!r) { return { ok: false, problems: ["the reading is null — nothing ran"] }; }
  if (r.ok === false) problems.push(r.stage || "the reading refused itself without naming a stage");

  if (r.ok !== false) {
    if (kind === "route") {
      if (!Array.isArray(r.calls)) problems.push("stage: the router recorded no call array");
      if (o.expectAnyCall && r.calls.length === 0) {
        problems.push("stage: the router reached NOTHING — a refusal measured from a run that " +
          "never entered the function is free, and reads identically to a real refusal");
      }
    } else if (kind === "panel") {
      if (!Array.isArray(r.offered)) problems.push("stage: the panel rendered no node list");
      else if (r.offered.length === 0) problems.push("stage: the panel rendered an EMPTY tree — " +
        "an assertion that it offers nothing it should not would pass for free");
      if (o.expectRows && r.rows.length === 0) {
        problems.push("stage: the panel rendered NO conversation rows, so any claim about a row " +
          "is a claim about nothing");
      }
    } else {
      problems.push("stage: unknown reading kind `" + kind + "`");
    }
  }
  return { ok: problems.length === 0, problems };
}

// ── THE GATE IS ITSELF UNTESTED CODE ─────────────────────────────────────────────────────────
// It certifies everything downstream, so it is fed deliberately broken readings AND sound ones.
// `missed` is a gate that would have waved a broken reading through; `falseAlarms` is a gate that
// refuses a sound one, which certifies nothing while looking careful.
function selfTest() {
  const missed = [];
  const falseAlarms = [];

  const broken = [
    ["null reading", "route", null, {}],
    ["stage failure carried", "route", { ok: false, stage: "stage: no subject" }, {}],
    ["router reached nothing", "route", { ok: true, calls: [], names: [] }, { expectAnyCall: true }],
    ["panel rendered an empty tree", "panel", { ok: true, offered: [], rows: [] }, {}],
    ["panel rendered no rows", "panel", { ok: true, offered: [{ tag: "div" }], rows: [] }, { expectRows: true }],
    ["unknown kind", "nonsense", { ok: true }, {}],
  ];
  for (const [name, kind, r, o] of broken) {
    if (admissible(kind, r, o).ok) missed.push(name);
  }

  const sound = [
    ["a router that reached a door", "route", { ok: true, calls: [{ f: "_ingestSpineEvent" }], names: ["_ingestSpineEvent"] }, { expectAnyCall: true }],
    ["a router that reached the raw fan-out only", "route", { ok: true, calls: [{ f: "rawListener" }], names: ["rawListener"] }, { expectAnyCall: true }],
    ["a panel with rows", "panel", { ok: true, offered: [{ tag: "div" }], rows: [{ cls: "dm-row" }] }, { expectRows: true }],
    ["a panel with no rows where none were expected", "panel", { ok: true, offered: [{ tag: "div" }], rows: [] }, {}],
  ];
  for (const [name, kind, r, o] of sound) {
    if (!admissible(kind, r, o).ok) falseAlarms.push(name);
  }
  return { missed, falseAlarms };
}

module.exports = {
  ROOT, MB_REL, UI_REL,
  extractNamed, driveRoute, drivePanel, admissible, selfTest,
};
