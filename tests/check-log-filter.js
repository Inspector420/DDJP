// tests/check-log-filter.js
// WALL: THE LOG CAN BE NARROWED TO ONE MODULE WITHOUT LOSING WHAT IT DID NOT SHOW,
//       AND THE BOT SAYS ENOUGH TO BE DIAGNOSED FROM IT.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// The Logs panel could already be narrowed by LEVEL, and that is the wrong axis for the question
// people actually arrive with. Every interesting `BotRuntime` line is `info`, and so are
// `MatrixBridge`'s 74 and `Room`'s 58 — so raising the level hides the subject along with the
// noise, and leaving it down buries the subject under several hundred lines. The second filter is
// by MODULE, and it reads the `Module: ` prefix the tree already writes rather than adding a
// `category` argument to `Logger` that every call site in the tree would have to be threaded with.
//
// ── WHAT EACH PART PINS ─────────────────────────────────────────────────────────────────────
//   PART A — the category is DERIVED from the line's own text. Driven against the shapes the tree
//     actually produces, including the diagnostic families (`StreamManager: ORDER …`) and the
//     unprefixed 12%, which must bucket rather than vanish.
//   PART B — the picker's options are derived from the log IN THE BOX, so a module that stops
//     logging leaves the list and one that starts logging joins it. No hand-written vocabulary.
//   PART C — THE FILTER IS VIEW-ONLY. The load-bearing one: a narrowed panel must not narrow the
//     record or the copy-out, because the reason to narrow is that you are hunting something and
//     do not yet know what. Driven by executing the real `_appendLogRow` against a recording box
//     with the filter set, and asserting `_logText` still returns everything.
//   PART D — a selection naming a category the log no longer holds falls back to ALL rather than
//     rendering an empty panel, which is indistinguishable from a broken one.
//   PART E — the bot's three silent returns are COUNTED and reach `status()`, so `seen: 0` can be
//     told apart from "everything arrived and none of it was recognised" — the state that already
//     cost a session when `ddjpType` was not being stamped.
//   PART F — a request verdict is REPORTED, both ways. The refusal half was never missing
//     (`BotSettings` logs its own reason); the GRANT was silent, so "the bot authored the change"
//     and "nothing happened" produced identical logs.
//   PART G — `report()` writes the status a person needs into the log, and IS REACHED from the UI.
//
// ── WHAT THIS GUARD CANNOT DO, STATED SO NOBODY INFERS IT ───────────────────────────────────
// PART G's second half is the only TEXTUAL assertion here, and it is kept deliberately: the
// button's handler is built inline inside `buildMainDom`, which has no name to anchor on, so it
// cannot be extracted and executed the way the panel functions below are. It proves the call site
// is SPELLED in `ui/interface.js` and proves nothing about whether a person can reach the button —
// no guard in this suite renders `index.html`. The executable half is PART G's first: `report()`
// really does emit, driven through a real Logger subscriber.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const { extractFn, node, el, UI_REL, ROOT } = require("./_probe-j16-active");

let asserts = 0;
let failed = false;
// Built once, printed at the single gate at the end of the promise chain. Two guards in this
// suite have printed FAIL and exited 0 because a part was appended below their gate; this file is
// async, so "below every part" means the end of the last `.then` rather than the end of the source.
let PASS_LINE = "";
function fail(msg, got) {
  failed = true;
  console.log("[log-filter] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const UI_SRC = fs.readFileSync(path.join(ROOT, UI_REL), "utf8");

// ── THE SUBJECT, EXTRACTED AND EXECUTED ─────────────────────────────────────────────────────
// The constants and the three pure filter functions are taken as ONE slice, from the constant
// block through the end of `_logCategories`, so the sandbox cannot hold a different value for
// `_LOG_CAT_ALL` than the file does. Restating them here would be the second copy this project
// spends its sessions deleting — and it would be the copy that decides whether the guard passes.
function sliceRegion(src, startAnchor, endFnName) {
  const at = src.indexOf(startAnchor);
  if (at < 0) return { ok: false, stage: "stage: `" + startAnchor + "` is not in " + UI_REL };
  const endAt = src.indexOf("function " + endFnName + "(", at);
  if (endAt < 0) return { ok: false, stage: "stage: `" + endFnName + "` does not follow " + startAnchor };
  let d = 0, i = src.indexOf("{", src.indexOf(")", endAt));
  if (i < 0) return { ok: false, stage: "stage: `" + endFnName + "` has no body" };
  for (; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) return { ok: true, source: src.slice(at, i + 1) }; }
  }
  return { ok: false, stage: "stage: `" + endFnName + "` could not be brace-matched" };
}

const region = sliceRegion(UI_SRC, "const _LOG_CAT_ALL", "_logCategories");
ok(region.ok, "PREMISE — the filter region must be extractable, or this file measures nothing. " +
  (region.stage || ""), region.stage);
if (!region.ok) { console.log("[log-filter] FAIL — no subject"); process.exit(1); }

// `_appendLogRow`, `_logText`, `_passesLevel`, `_lineLevel` and `_syncLogCatOptions` are pulled by
// name. A rename makes this REFUSE rather than pass, which is the safe direction.
const NEEDED = ["_lineLevel", "_passesLevel", "_appendLogRow", "_logText", "_syncLogCatOptions", "_stamp", "_logFullStamp"];
const fns = {};
for (const n of NEEDED) {
  const r = extractFn(UI_REL, n, UI_SRC);
  ok(r.ok, "PREMISE — `" + n + "` must be extractable. " + (r.stage || ""), r.stage);
  if (!r.ok) { console.log("[log-filter] FAIL — no subject"); process.exit(1); }
  fns[n] = r.source;
}

// ── THE RECORDING BOX CARRIES THE SURFACE THE SUBJECT ACTUALLY TOUCHES ──────────────────────
// `_appendLogRow` caps the view and keeps the scroll pinned, so it reads `childNodes`,
// `firstChild`, `removeChild` and the three scroll numbers. The shared probe's `node()` has none
// of them — it was built for panels that only append. A box missing them does not merely fail to
// cover the capping; it throws inside the subject and the throw reads as a finding about the
// subject rather than about this file. `scrollHeight` is derived from the row count so the
// stick-to-bottom branch is exercised rather than short-circuited by two constant zeroes.
function logBox() {
  const n = node("div");
  n.scrollTop = 0;
  n.clientHeight = 100;
  Object.defineProperty(n, "childNodes", { get() { return n.children; } });
  Object.defineProperty(n, "firstChild", { get() { return n.children[0] || null; } });
  Object.defineProperty(n, "scrollHeight", { get() { return n.children.length * 10; } });
  n.removeChild = (c) => { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); return c; };
  return n;
}

// Build a sandbox holding the REAL sources over controllable state.
function panel(opts) {
  const o = opts || {};
  const box = logBox();
  const sel = node("select");
  const src = `
    const _sessionStart = ${o.sessionStart || 0};
    ${region.source}
    ${fns._lineLevel}
    ${fns._passesLevel}
    ${fns._appendLogRow}
    ${fns._logFullStamp}
    ${fns._logText}
    ${fns._syncLogCatOptions}
    ${fns._stamp}
    return { _lineCategory, _passesCategory, _logCategories, _appendLogRow, _logText,
             _syncLogCatOptions, get cat() { return _logCat; }, set cat(v) { _logCat = v; },
             set level(v) { _logLevel = v; } };
  `;
  const make = new Function("refs", "el", "clear", "_priorLog", "_sessionLog", "_LOG_LEVELS",
    "_logLevel", "_logCap", "_updateLogCount", src);
  const api = make(
    { logsBox: box, logsCat: sel },
    el,
    (n) => { n.children.length = 0; },
    o.prior || [],
    o.session || [],
    ["debug", "info", "warn", "error"],
    o.level || "debug",
    2000,
    () => {}
  );
  return { api, box, sel };
}

// ═══ PART A — THE CATEGORY IS READ OFF THE LINE ══════════════════════════════════════════════
{
  const { api } = panel({});
  const cat = api._lineCategory;
  ok(cat("[info] BotRuntime: bot mode on") === "BotRuntime",
    "A: a `Module: ` line categorises as that module", cat("[info] BotRuntime: bot mode on"));
  ok(cat("[info] StreamManager: ORDER ddjp.dj.play ACCEPTED") === "StreamManager",
    "A: THE DIAGNOSTIC FAMILIES CATEGORISE BY MODULE TOO. `ORDER`, `SEAL` and `ADVANCE` read as " +
    "prefixes in prose but are written `Module: TAG …`, so they need no second rule — and a " +
    "category rule that matched the TAG would split one module's lines across several buckets",
    cat("[info] StreamManager: ORDER ddjp.dj.play ACCEPTED"));
  ok(cat("[debug] MatrixBridge: SEAL asked by tick") === "MatrixBridge",
    "A: same, on the transport's own diagnostics", cat("[debug] MatrixBridge: SEAL asked by tick"));
  ok(cat("[warn] a line with no module at all") === "other",
    "A: AN UNPREFIXED LINE BUCKETS RATHER THAN VANISHING — 12% of Logger calls carry no prefix, " +
    "and a line with no category is still evidence. Dropping them would make the picker's `all` " +
    "and the unfiltered view disagree, which is a filter that loses lines while claiming not to",
    cat("[warn] a line with no module at all"));
  ok(cat("") === "other" && cat(null) === "other" && cat(undefined) === "other",
    "A: total on junk — the panel renders whatever reached it and must not throw inside a render");
  // THE LEVEL TAG IS STRIPPED FIRST, and this is the row that would catch it not being.
  ok(cat("[info] Room: x") === "Room",
    "A: the `[level]` tag is stripped before the module is read, or every line would categorise " +
    "as the level and the two filters would be one filter", cat("[info] Room: x"));
}

// ═══ PART B — THE OPTIONS ARE DERIVED FROM THE LOG IN THE BOX ════════════════════════════════
{
  const { api, sel } = panel({
    prior: ["[info] Room: a", "[info] MatrixBridge: b"],
    session: ["[info] BotRuntime: c", "[warn] no prefix here"],
  });
  api._syncLogCatOptions();
  const vals = sel.children.map((c) => c.value);   // `el` stores `value` as a PROPERTY, not an attribute
  ok(vals[0] === "*", "B: `all modules` is first, so the default reads as unfiltered", vals);
  ok(vals.indexOf("BotRuntime") > 0 && vals.indexOf("Room") > 0 && vals.indexOf("MatrixBridge") > 0,
    "B: every module PRESENT in the log is offered", vals);
  ok(vals.indexOf("other") > 0, "B: and the unprefixed bucket is offered too", vals);
  // THE ABSENCE IS THE POINT: a module that has not logged is not in the list.
  ok(vals.indexOf("Playback") < 0,
    "B: A MODULE THAT HAS NOT LOGGED IS NOT OFFERED. The vocabulary is derived from the lines " +
    "rather than written down, so it cannot go stale in either direction — a hand-written list " +
    "is the mechanism that produced the six missing `ddjp.media.skip` subscriptions", vals);
}

// ═══ PART C — VIEW-ONLY: THE RECORD AND THE COPY-OUT ARE UNTOUCHED ═══════════════════════════
// The load-bearing part. A narrowed panel that also narrowed the copy would hand somebody a
// report missing exactly the lines they had filtered away while hunting — and they would not know.
{
  const lines = ["[info] Room: a", "[info] BotRuntime: b", "[info] MatrixBridge: c"];
  const { api, box } = panel({ session: lines });
  api.cat = "BotRuntime";
  for (const l of lines) api._appendLogRow(l, true);
  ok(box.children.length === 1 && box.children[0].text === "[info] BotRuntime: b",
    "C: the VIEW is narrowed to the selected module", box.children.map((c) => c.text));
  const copied = api._logText();
  // ASSERTED ON CONTENT, NOT ON A LINE COUNT. The first version counted lines, which broke the
  // moment PART I's session banners were added — a count is a claim about FORMAT where the
  // property is about CONTENT, and it would have to be re-tuned every time the header changed.
  ok(lines.every((l) => copied.indexOf(l) >= 0),
    "C: AND THE COPY-OUT STILL CARRIES EVERY LINE, including the two the view filtered away. " +
    "This is the property the whole design rests on: narrowing is for reading, never for " +
    "recording, so turning the noise down can never discard the line somebody needed", copied);
  // AND THE CONTROL, or the row above passes on a filter that never filtered.
  const wide = panel({ session: lines });
  for (const l of lines) wide.api._appendLogRow(l, true);
  ok(wide.box.children.length === 3,
    "C: CONTROL — with no category selected all three render, so the row above is a reading of " +
    "the filter rather than of a box nothing ever reached", wide.box.children.length);
  // BOTH FILTERS COMPOSE. A category selection must not resurrect a line the level hid.
  const both = panel({ session: lines, level: "warn" });
  both.api.cat = "BotRuntime";
  both.api.level = "warn";
  for (const l of lines) both.api._appendLogRow(l, true);
  ok(both.box.children.length === 0,
    "C: the two filters COMPOSE — selecting a module does not resurrect a line the level hid, " +
    "which is what a second filter written as an `||` would do", both.box.children.length);
}

// ═══ PART D — A SELECTION THE LOG NO LONGER HOLDS FALLS BACK TO ALL ══════════════════════════
{
  const { api, sel } = panel({ session: ["[info] Room: a"] });
  api.cat = "BotRuntime";              // selected, then the bot's lines rolled off
  api._syncLogCatOptions();
  ok(api.cat === "*",
    "D: A STALE SELECTION FALLS BACK TO ALL. Leaving it selected renders an empty panel, and an " +
    "empty panel is indistinguishable from a broken one — the count beside it would read " +
    "`0 of N lines`, which reads as a fault rather than as a filter", api.cat);
  ok(sel.value === "*" || (sel.children[0] && sel.children[0].value === "*"),
    "D: and the control shows the fallback rather than a selection the state no longer holds");
}

// ═══ PART H — THE STAMP IS ON THE LINE, AND BOTH FILTERS SURVIVE IT ══════════════════════════
// The stamp goes AFTER the level tag because both filters anchor on `^[level]`. Put it in front
// and every line reads as level `info` and category `other` — a filter that silently stops
// filtering rather than one that breaks visibly. This part is what makes that placement checked
// rather than merely commented, and it drives the SUBSCRIBER rather than asserting on a regex:
// the subscriber has no name to extract, so it is sliced from `Logger.on(entry => {` and run.
{
  const at = UI_SRC.indexOf("Logger.on(entry => {");
  ok(at >= 0, "PREMISE — the log subscriber must be locatable, or PART H measures nothing");
  const open = UI_SRC.indexOf("{", at);
  let d = 0, end = -1;
  for (let i = open; i < UI_SRC.length; i++) {
    if (UI_SRC[i] === "{") d++;
    else if (UI_SRC[i] === "}") { d--; if (d === 0) { end = i; break; } }
  }
  ok(end > 0, "PREMISE — the subscriber must brace-match");

  const body = UI_SRC.slice(open + 1, end);
  const stampSrc = extractFn(UI_REL, "_stamp", UI_SRC);
  ok(stampSrc.ok, "PREMISE — `_stamp` must be extractable. " + (stampSrc.stage || ""));

  const session = [];
  const appended = [];
  const run = new Function("entry", "_stamp", "_sessionLog", "_logCap", "_saveLogSoon",
    "_appendLogRow", "_updateLogCount", body);
  const { api } = panel({});
  run({ level: "info", message: "BotRuntime: bot mode on", ts: Date.UTC(2026, 0, 2, 3, 4, 5, 60) },
      new Function("return " + stampSrc.source.replace(/^function _stamp/, "function"))(),
      session, 2000, () => {}, (t) => appended.push(t), () => {});

  ok(session.length === 1, "H: the subscriber records the line", session);
  ok(/^\[info\] \d{2}:\d{2}:\d{2}\.\d{3} BotRuntime: bot mode on$/.test(session[0]),
    "H: THE LINE CARRIES THE TIME `Logger` ALREADY COMPUTED, and carries it AFTER the level tag. " +
    "Every window the bot obeys is a duration — `botAfkMs`, `botPingMs`, `queueIdleMs`, the " +
    "sweep's own minute — so a log without times cannot tell one sweep from forty, cannot " +
    "measure a warning against the removal it authorises, and cannot tell a stalled room from a " +
    "quiet one", session[0]);
  ok(/\.\d{3} /.test(session[0]),
    "H: to MILLISECONDS, because the interesting gaps here are sub-second — a request and its " +
    "verdict resolve on adjacent microtasks", session[0]);
  // AND THE TWO FILTERS STILL READ IT.
  ok(api._lineCategory(session[0]) === "BotRuntime",
    "H: the CATEGORY still reads through the stamp — this is the row that would catch the stamp " +
    "being placed in front of the level tag, which would send every line to `other`",
    api._lineCategory(session[0]));
  // THE MIXED CASE, which is the upgrade this build actually ships into.
  ok(api._lineCategory("[info] Room: an older line with no stamp") === "Room",
    "H: AND A LINE WITH NO STAMP STILL READS. `_priorLog` is restored from storage, so the first " +
    "load after this build sees a whole previous session written in the old shape; a required " +
    "strip would send every one of those to `other` and the previous session would appear to " +
    "have no modules in it", api._lineCategory("[info] Room: an older line with no stamp"));
}

// ═══ PART I — THE COPY-OUT SEPARATES THE SESSIONS, AND THE BANNERS DO NOT PERSIST ════════════
{
  const prior = ["[info] 09:00:00.000 Room: yesterday"];
  const session = ["[info] 22:00:00.000 BotRuntime: today"];
  const { api } = panel({ prior, session });
  const text = api._logText();
  ok(/EARLIER SESSION/.test(text) && /THIS session/.test(text),
    "I: THE COPY NAMES THE SEAM. The panel colours prior lines grey and this session's green, and " +
    "the clipboard lost that entirely — so a pasted log ran two runs together and a stale " +
    "`bot mode on` from yesterday read as the current one. The copy is the form the log is " +
    "actually read in, because nobody diagnoses by scrolling somebody else's screen", text);
  ok(text.indexOf("Room: yesterday") < text.indexOf("BotRuntime: today"),
    "I: in order, oldest first, matching the panel", text);
  ok(/LOCAL clock/.test(text),
    "I: and it says once which clock the line times are on, rather than every line saying it");
  // THE LOAD-BEARING HALF: the banners are built in the returned text and nowhere else.
  ok(prior.length === 1 && session.length === 1,
    "I: THE BANNERS ARE NOT PUSHED INTO THE ARRAYS. Those two are what `_saveLogSoon` persists, " +
    "so a banner placed in them would be restored as an ordinary line next session, banner-ed " +
    "again by the session after that, and accumulate one marker per reload forever",
    { prior: prior.length, session: session.length });
  ok(prior[0].indexOf("===") < 0 && session[0].indexOf("===") < 0,
    "I: and the held lines are untouched, not merely un-lengthened", { prior, session });
}

// ═══ PART E — THE BOT'S SILENT RETURNS ARE COUNTED ═══════════════════════════════════════════
function makeRT(opts) {
  const o = opts || {};
  const subs = [], lines = [];
  let tickFn = null;
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
    "features/botsettings.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, Promise,
    // THE INTERVAL IS CAPTURED, NOT RUN. Driving the callback by hand is what makes PART K a
    // reading of the production path: the reporting lives in the TICK, not in the sweeps it calls,
    // so a guard that called the sweeps directly would say nothing about it.
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Room: { rankLadder: () => null },
    MatrixBridge: {
      getMyPowerLevel: () => (Object.prototype.hasOwnProperty.call(o, "level") ? o.level : 99),
      onRawEvent: (fn) => { subs.push(fn); },
      offRawEvent: () => {},
      sendEvent: async () => {},
      eventsKeyForLevel: (lvl) => "events_L" + lvl,
    },
  });
  sb.Room.rankLadder = () => sb.Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level }));
  sb.Logger.on((e) => lines.push("[" + e.level + "] " + e.message));
  return { RT: sb.BotRuntime, SM: sb.StreamManager, SD: sb.StateDeriver, subs, lines,
           tick: () => tickFn };
}
function settle() { return new Promise((r) => setTimeout(r, 0)); }

{
  const bot = makeRT({});
  bot.SM.getState = () => ({ settings: bot.SD.defaultSettings() });
  bot.RT.start({ roomId: "!r:hs", authorSettings: async () => {} });
  const fire = bot.subs[0];

  // An event the transport did not stamp a ddjp type onto — the shape of the defect that read as
  // `seen: 0` while three requests sat in the log.
  fire({ type: "m.room.message", room_id: "!r:hs", event_id: "$a", sender: "@a:hs", content: {} }, {}, {});
  ok(bot.RT.status().noType === 1 && bot.RT.status().seen === 0,
    "E: AN UNSTAMPED EVENT IS COUNTED AS UNSTAMPED, not lost into a zero. `seen: 0` with " +
    "`noType` high is the signature of a transport that stopped stamping `ddjpType`; `seen: 0` " +
    "with both at zero means nothing arrived. Two different faults in two different files, and " +
    "before this they produced the same three zeroes", bot.RT.status());

  // An event this mode does not handle — the ordinary majority of the fan-out.
  fire({ type: "m.room.message", room_id: "!r:hs", event_id: "$b", sender: "@a:hs",
         content: {}, ddjpType: "ddjp.dj.vote", ddjpBody: { t: "ddjp.dj.vote" } }, {}, {});
  ok(bot.RT.status().notHandled === 1 && bot.RT.status().seen === 0,
    "E: an event outside the mode's table is counted separately — a mode table that stopped " +
    "matching would otherwise look exactly like a room with no requests in it", bot.RT.status());

  // AND THE COUNTERS DO NOT LOG. The fan-out carries every event in the room, so a line here
  // would empty the panel during a replay — the one window the interesting lines are produced in.
  // BOTH SKIP BRANCHES, ALTERNATING — and the first version of this row drove only one of them.
  // A log line added to the `noType` branch flooded exactly as hard and left this row GREEN,
  // because every event it fired carried a `ddjpType` and so took the other branch. The mutation
  // was applied to a real site that this row could not reach, which reports as a survivor and
  // reads as "the silence is unguarded" when the truth was "half of it is". Drive every branch
  // the claim covers, or the claim is narrower than its wording.
  const noisy = bot.lines.filter((l) => /BotRuntime/.test(l)).length;
  for (let i = 0; i < 50; i++) {
    const stamped = (i % 2 === 0);
    fire({ type: "m.room.message", room_id: "!r:hs", event_id: "$n" + i, sender: "@a:hs",
           content: {},
           ddjpType: stamped ? "ddjp.dj.vote" : null,
           ddjpBody: stamped ? {} : null }, {}, {});
  }
  ok(bot.lines.filter((l) => /BotRuntime/.test(l)).length === noisy,
    "E: AND FIFTY SKIPPED EVENTS PRODUCE NO LINES, down EITHER branch. The counters exist " +
    "precisely so this path stays silent; a log line per raw event would flood the 2000-line " +
    "panel during replay, which is the one window the interesting lines are produced in",
    bot.lines.length);
  ok(bot.RT.status().notHandled === 26 && bot.RT.status().noType === 26,
    "E: while both are still counted, so the silence costs no information", bot.RT.status());
}

// ═══ PART F — A REQUEST VERDICT IS REPORTED, BOTH WAYS ═══════════════════════════════════════
{
  const bot = makeRT({});
  const D = bot.SD.defaultSettings();
  bot.SM.getState = () => ({ settings: Object.assign({}, D, { botDelegation: { maxLen: "staff" } }) });
  bot.RT.start({ roomId: "!r:hs", authorSettings: async () => {} });
  const fire = bot.subs[0];
  const req = (k, v, rank, who) => {
    const payload = { k, v, t: "ddjp.bot.request", l: 1 };
    return { type: "m.room.message", room_id: "!r:hs", event_id: "$q" + k + rank,
             sender: who, senderRank: rank, ts: 1,
             content: { msgtype: "m.text", body: JSON.stringify(payload) },
             ddjpType: "ddjp.bot.request", ddjpBody: payload };
  };

  fire(req("maxLen", 600, 60, "@staff:hs"), {}, {});
  settle().then(() => {
    const granted = bot.lines.filter((l) => /BotRuntime: request GRANTED/.test(l));
    ok(granted.length === 1,
      "F: A GRANTED REQUEST SAYS SO. This was the genuinely silent half — `acted++` and nothing " +
      "else, so the bot authoring a change and the bot doing nothing produced identical logs, " +
      "and the settings panel re-renders from derived state either way", bot.lines);
    ok(granted[0].indexOf("@staff:hs") >= 0 && granted[0].indexOf("maxLen") >= 0,
      "F: and it names WHO asked and WHICH key — the half `BotSettings` structurally cannot " +
      "supply, because it is handed a level and deliberately not a user id, so a policy module " +
      "can never start deciding by identity", granted[0]);

    fire(req("maxLen", 600, 20, "@player:hs"), {}, {});
    return settle();
  }).then(() => {
    const refused = bot.lines.filter((l) => /BotRuntime: request REFUSED/.test(l));
    ok(refused.length === 1 && refused[0].indexOf("@player:hs") >= 0,
      "F: a refused request names its requester too", bot.lines);
    ok(/rank/.test(refused[0]),
      "F: AND RESTATES THE VERDICT. Not a second copy of a rule — one value printed twice, by a " +
      "module that did not compute it. Without it, filtering the panel to `BotRuntime` shows a " +
      "refusal with no reason while the reason sits under `BotSettings`, so the one view " +
      "somebody opens to watch the bot is the view that cannot answer the question", refused[0]);

    // ═══ PART G — `report()` WRITES THE STATUS SOMEBODY CAN READ ═══════════════════════════
    const before = bot.lines.length;
    const s = bot.RT.report();
    const said = bot.lines.slice(before).join("\n");
    ok(bot.lines.length > before && /BotRuntime: running/.test(said),
      "G: `report()` EMITS. `status()` returned an object and nothing rendered it, so answering " +
      "\"is this client even the bot\" needed devtools", said);
    ok(/granted 1/.test(said) && /refused 1/.test(said) && /skipped/.test(said),
      "G: and it carries the counters, including the two skip reasons PART E added", said);
    ok(s && s.running === true,
      "G: it REPORTS and returns the same object rather than deciding anything", s);

    const off = makeRT({ level: 20 });
    off.RT.report();
    ok(off.lines.some((l) => /NOT running on this client/.test(l)),
      "G: and a client that is NOT the bot says so, which is the most common form of the " +
      "question — somebody watching the wrong tab wondering why nothing moderates", off.lines);

    // THE WIRING HALF, AND IT IS TEXTUAL — see the header. The button's handler is built inline
    // inside `buildMainDom`, which has no name to anchor on, so it cannot be extracted and run.
    ok(/BotRuntime\.report\(/.test(UI_SRC),
      "G: WIRED — `ui/interface.js` calls `report()`, so it is not another loaded-and-never-" +
      "called seam. THIS ROW IS A REGEX AND SAYS SO: it proves the call is spelled there and " +
      "proves nothing about whether a person can reach the button, because nothing in this " +
      "suite renders `index.html`");

    // ═══ PART J — THE ROOM'S DIALS, SO A VERDICT CAN BE JUDGED ═════════════════════════════
    const setLine = bot.lines.filter((l) => /room settings —/.test(l)).pop() || "";
    ok(/botAfkMs=/.test(setLine) && /botPingMs=/.test(setLine) && /queueIdleMs=/.test(setLine),
      "J: THE WINDOWS THE BOT OBEYS ARE IN THE LOG. Without them \"the bot removed me too fast\" " +
      "is undiagnosable — these are room settings, so a reader cannot assume the defaults", setLine);
    ok(/botDelegation=\{maxLen:staff\}/.test(setLine),
      "J: including the delegation table, which decides every request verdict above it", setLine);
    ok(/minDjRank=/.test(setLine) && /chat=/.test(setLine),
      "J: AND KEYS WITHOUT A `bot` PREFIX. The blob is printed WHOLE rather than a curated list " +
      "of the bot's own dials, because a curated list is a second copy of \"which settings the " +
      "bot reads\" — it would go stale in the direction that hurts, a dial added tomorrow " +
      "governing the bot and silently absent from the one line somebody is reading. `minDjRank` " +
      "decides who may join at all and `chat` decides where the bot announces; neither is " +
      "`bot`-prefixed and both are bot-visible behaviour", setLine);
    // AND IT REFUSES RATHER THAN GUESSING.
    const blind = makeRT({});
    blind.SM.getState = () => { throw new Error("no state"); };
    blind.RT.start({ roomId: "!r:hs", authorSettings: async () => {} });
    blind.RT.report();
    ok(blind.lines.some((l) => /settings UNREADABLE/.test(l)),
      "J: an unreadable blob says UNREADABLE rather than naming defaults. A bot that cannot read " +
      "the room is applying whatever the reducer last handed it, and printing a value it may not " +
      "hold is the plausible-value failure inside the line written to diagnose it", blind.lines);

    // ═══ PART K — THE SWEEPS NAME PEOPLE, AND THE TICK REALLY CALLS THEM ═══════════════════
    // Driven through the REAL interval callback, captured at `start()`. A guard that called the
    // sweeps directly would say nothing about whether the tick's own branches log anything —
    // and it is the tick, not the sweep, that holds the reporting.
    const named = makeRT({ captureTick: true });
    named.SM.getState = () => ({ settings: named.SD.defaultSettings() });
    named.RT.start({ roomId: "!r:hs", authorSettings: async () => {} });
    ok(typeof named.tick() === "function",
      "K: the runtime registers an interval callback, or nothing below drives the production path",
      typeof named.tick());
    named.tick()();
    return settle().then(() => {
      const swept = named.lines.filter((l) => /idle sweep|presence/.test(l));
      ok(swept.length > 0,
        "K: THE TICK REPORTS. A pass that says nothing at all leaves a healthy quiet room and a " +
        "dead timer looking identical, which is the state that ran unnoticed for two days here",
        named.lines);

      // The naming helper itself, executed out of the source rather than reimplemented.
      const nm = extractFn("features/botruntime.js", "_names");
      ok(nm.ok, "PREMISE — `_names` must be extractable. " + (nm.stage || ""));
      const _names = new Function("return " + nm.source.replace(/^function _names/, "function"))();
      ok(_names([]) === "none",
        "K: an empty list reads as `none` rather than as an empty bracket, which reads as a bug");
      ok(_names(["@a:hs", "@b:hs"]) === "@a:hs, @b:hs",
        "K: NAMES, NOT COUNTS. `warned 1, removed 0` cannot answer the question anybody asks " +
        "about a sweep, which is always WHO — and this project has already shipped the bot announcing " +
        "a removal about a person who never left, which a count is exactly as consistent with as " +
        "correct behaviour", _names(["@a:hs", "@b:hs"]));
      ok(/\(\+2 more\)$/.test(_names(["a", "b", "c", "d", "e", "f", "g", "h"])),
        "K: CAPPED, because `added` on a first presence reconcile is everybody the room considers " +
        "around — a line per member is the flood the `_onRaw` counters exist to avoid",
        _names(["a", "b", "c", "d", "e", "f", "g", "h"]));
      ok(_names(["a", null, "b"]) === "a, b",
        "K: and total on a hole in the list, since a render must not throw inside a log line");

      // THE WIRING HALF IS TEXTUAL AND SAYS SO — the tick's branches are inside an inline arrow
      // with no name to anchor on, exactly like PART G's button.
      const BR_SRC = fs.readFileSync(path.join(ROOT, "features/botruntime.js"), "utf8");
      ok(/idle sweep — warned \[" \+ _names\(/.test(BR_SRC) && /presence — added \[" \+ _names\(/.test(BR_SRC),
        "K: WIRED — both sweep lines pass their lists through `_names`. THIS ROW IS A REGEX AND " +
        "SAYS SO: the branches sit inside an inline interval callback with no name to extract, " +
        "so it proves the call is spelled and not that the naming branch ran", BR_SRC.length);

      if (failed) process.exit(1);
      // THE COUNT IS READ AT THE GATE, NOT WHERE THE SENTENCE IS BUILT. Built into the string it
      // was evaluated synchronously — before PARTs F, G, J and K had run — so the guard reported
      // 41 of its own 50 assertions and the shortfall read as parts being skipped. A number
      // describing a moment other than the one it is printed in is this tree's third signature,
      // reached from inside a guard written to catch the first two.
      console.log(PASS_LINE + " (" + asserts + " assertions)");
    });
  }).catch((e) => { console.log("[log-filter] FAIL — threw: " + (e && e.stack)); process.exit(1); });
}
{
  PASS_LINE = "[log-filter] PASS — the log is diagnosable from a paste. It narrows by MODULE as " +
    "well as by level, using the `Module: ` prefix the tree already writes rather than a " +
    "`category` argument threaded through every Logger call site, with the vocabulary DERIVED from the " +
    "lines in the box; the narrowing is VIEW-ONLY — driven, with a control and with both filters " +
    "composing — so the record and the copy-out still carry every line, and a stale selection " +
    "falls back to ALL rather than rendering an empty panel that reads as a fault. Every line " +
    "carries the time `Logger` already computed, placed AFTER the level tag because both filters " +
    "anchor there, and read across BOTH shapes so a previous session written before this build " +
    "still categorises. The copy names the seam between sessions, and the banners are built in " +
    "the returned text alone so they cannot be persisted and accumulate. On the bot side: the " +
    "three silent returns are COUNTED down either branch and reach `status()`, so `seen: 0` can " +
    "be told from everything-arrived-and-nothing-recognised while fifty skipped events still " +
    "produce no lines; a request verdict is reported both ways naming who asked; the room's whole " +
    "settings blob is printed rather than a curated list that would go stale toward silence, and " +
    "refuses rather than naming defaults it may not hold; and the sweeps name people, capped. " +
    "TWO ROWS ARE REGEXES AND SAY SO — the status button and the tick's branches are inline with " +
    "no name to extract, and nothing in this suite renders `index.html`";
}
