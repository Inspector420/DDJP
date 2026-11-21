// tests/check-history-bot-boundary.js
// SUBJECT: features/history-bot.js, features/history-ports.js, features/room.js, index.html
//
// WALL: THE SONG HISTORY BOT IS ITS OWN PIECE, IN REP'S SHAPE (738; the owner's method — a new part built in the shape the project already
// uses for that kind of thing — and REP, which he named as the model; `check-rep-boundary` and `check-rep-ports` are REP's walls). The bot
// side reaches the app only through its one door, the app reaches it only at its two hook sites, and nothing of it sits inside the bot
// runtime, the seam, the engines or the fold.
//   A  THE BOT SPEAKS ONLY TO THE FORMAT AND ITS DOOR: `features/history-bot.js` names no app global but `HistorySummary` (the pure format,
//      `core/historysummary.js`) and `HistoryPorts`, and no clock (`Date`): every time it judges by is the server's, through its door.
//   B  THE DOOR IS ONE DOOR AND DECIDES NOTHING: `features/history-ports.js` names only the modules it declares — never the format, an
//      engine internal or the UI; `PORTS` is exactly what it exports and every port is called by the bot; driven against a recording
//      stand-in of each module, every port reaches the one function it names with its arguments unchanged and hands its answer back;
//      with no module loaded, every port answers safely, never a throw.
//   C  THE APP REACHES IT AT TWO SITES: outside its two files, `HistoryBot` is named only in `features/room.js` — `HistoryBot.enter` once,
//      in the bot's evaluation (after the runtime decided, and before REP's own early return), and `HistoryBot.leave` once, in the one
//      leave step, before the engine resets; `HistoryPorts` is named nowhere else; the page loads both, after the format.
//   D  NOTHING OF IT INSIDE THE BOT RUNTIME, THE SEAM, THE ENGINES OR THE FOLD.
//   E  EVERY PORT REACHES SOMETHING REAL, IN BOTH ENGINES: each function a port reaches exists on the real module — the bridge's under
//      each engine's binding — so a port pointing at something renamed cannot answer its safe empty answer for ever, silently.
// RED FIRST on `ddjp_737`: neither file exists.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const B = require(path.join(__dirname, "_botroom.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-bot-boundary] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-bot-boundary] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const BOT = "features/history-bot.js", PORT = "features/history-ports.js";
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => (exists(rel) ? fs.readFileSync(path.join(ROOT, rel), "utf8") : "");
// Code only, strings' contents emptied (a word in a log line reaches nothing; a global is reached through an identifier) — REP's reader,
// kept simple: block and line comments dropped, then every quoted string's text blanked.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => {
  let out = "", q = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) { q = null; out += c; } continue; }
    if (c === "/" && l[i + 1] === "/") break;
    if (c === "\"" || c === "'" || c === "`") { q = c; out += c; continue; }
    out += c;
  }
  return out;
}).join("\n");
const word = (name) => new RegExp("(^|[^A-Za-z0-9_$.])" + name + "(?![A-Za-z0-9_$])");
const listJs = (dir) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".js")).map((f) => dir + "/" + f) : []);
// Every app global a piece could reach for — REP's own list (`check-rep-boundary`), with the format and REP's names.
const APP_GLOBALS = ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities", "Room", "Chat", "ServerClock", "Store",
  "BotRuntime", "BotSettings", "Logger", "Backends", "StateDeriver", "Ranks", "History", "Floor", "Vouch", "Checkpoint",
  "EventCache", "Session", "Scheduler", "B1MatrixBridge", "B1StreamManager", "B2Runner", "B2Authority", "B2Checkpoint",
  "Actions", "Queue", "Playback", "Reactions", "UserQueue", "ChatPrefs", "StorageIO", "IDB", "Interface", "Screens",
  "Settings", "Panels", "Roster", "Shell", "localStorage", "sessionStorage", "indexedDB", "navigator", "window", "document",
  "Countries", "MetadataService", "Skip", "Songs", "RepRules", "RepPorts", "RepBot", "RepReader", "RepGeo", "Rep", "HistorySummary", "HistoryBot", "HistoryPorts"];
const PORT_MAY_NAME = ["MatrixBridge", "StreamManager", "ServerClock", "Store", "BotRuntime", "Logger"];

ok(exists(BOT) && exists(PORT), "PREMISE — the bot side and its door exist", { bot: exists(BOT), ports: exists(PORT) });

// ── A — THE BOT SPEAKS ONLY TO THE FORMAT AND ITS DOOR ──────────────────────────────────────────────────────────────────────────
{
  const c = code(read(BOT));
  const named = APP_GLOBALS.filter((g) => g !== "HistoryBot" && word(g).test(c));   // its own name is its declaration
  ok(exists(BOT) && named.slice().sort().join() === "HistoryPorts,HistorySummary", "A: `history-bot.js` names no app global but the format and its door", named);
  ok(!word("Date").test(c), "A: and no clock — every time it judges by is the server's, through its door");
  ok(/\bHistorySummary\.fit\(/.test(c) && /\bHistorySummary\.TYPE\b/.test(c), "A: APPLIED — it writes through the format piece (`fit`, `TYPE`), never a copy of it");
}
// ── B — THE DOOR IS ONE DOOR AND DECIDES NOTHING ────────────────────────────────────────────────────────────────────────────────
async function partB() {
  const c = code(read(PORT));
  const named = APP_GLOBALS.filter((g) => word(g).test(c));
  const extra = named.filter((g) => PORT_MAY_NAME.indexOf(g) < 0 && g !== "HistoryPorts");
  ok(exists(PORT) && extra.length === 0 && named.length >= 4, "B: `history-ports.js` names only the modules it declares — never the format, an engine internal or the UI", named);
  let bare = null;
  try { bare = loadInContext([PORT], {}).HistoryPorts; } catch (e) { bare = null; }
  const exported = bare ? Object.keys(bare).filter((k) => k !== "PORTS" && typeof bare[k] === "function").sort() : [];
  ok(!!bare && Array.isArray(bare.PORTS) && bare.PORTS.slice().sort().join() === exported.join(), "B: `PORTS` lists exactly what it exports", { listed: bare && bare.PORTS, exported });
  const bc = code(read(BOT));
  const idle = (bare && bare.PORTS || []).filter((k) => !new RegExp("\\bHistoryPorts\\." + k + "\\(").test(bc));
  ok(!!bare && idle.length === 0, "B: EVERY PORT IS CALLED BY THE BOT — none kept that nothing uses", idle);
  if (!bare) return;
  // THE PASS-THROUGH, against recording stand-ins (740: the `contradictions` port and `historyContradictions` went with the bot's corrections —
  // nothing else read them — so this list no longer names them; every port left is still driven here)
  const calls = [];
  const rec = (mod, fn, ret) => function () { calls.push(mod + "." + fn + "(" + JSON.stringify(Array.from(arguments).filter((a) => typeof a !== "function")) + ")"); return ret; };
  const fnArg = () => {};
  const stubs = {
    MatrixBridge: { roomHistory: rec("MB", "roomHistory", [{ pi: "$p" }]), historyCoverage: rec("MB", "historyCoverage", { full: true }),
      historySummaries: rec("MB", "historySummaries", [{ n: 1 }]),
      historyReadingOf: rec("MB", "historyReadingOf", [{ pi: "$r" }]), historyIdle: rec("MB", "historyIdle", false),
      readHistorySummaries: rec("MB", "readHistorySummaries", Promise.resolve({ taken: 1 })), rearmHistoryBackfill: rec("MB", "rearmHistoryBackfill"),
      onHistoryChange: rec("MB", "onHistoryChange"), offHistoryChange: rec("MB", "offHistoryChange"), onRawEvent: rec("MB", "onRawEvent"),
      offRawEvent: rec("MB", "offRawEvent"), sendSide: rec("MB", "sendSide", Promise.resolve({ ok: true, eventId: "$s" })),
      mayAuthor: rec("MB", "mayAuthor", { ok: true }), onAuthorReady: rec("MB", "onAuthorReady"), getUserId: rec("MB", "getUserId", "@bot:hs") },
    StreamManager: { getState: rec("SM", "getState", { nowPlaying: { pi: "$np" }, settings: { historySummaryEvery: 15 } }) },
    ServerClock: { serverNow: rec("SC", "serverNow", 1234.75) },
    Store: { history: { writerLock: rec("ST", "writerLock", Promise.resolve(true)) } },
    BotRuntime: { actingAsBot: rec("BR", "actingAsBot", true) },
    Logger: { info: rec("LG", "info"), warn: rec("LG", "warn") },
  };
  const P = loadInContext([PORT], stubs).HistoryPorts;
  const got = {
    rows: P.rows(), coverage: P.coverage(), marks: P.marks(), readingOf: P.readingOf(3, 9), busy: P.busy(),
    readBack: await P.readBack(), playingPi: P.playingPi(), settings: P.settings(), mayAuthor: P.mayAuthor(), serverNow: P.serverNow(), myId: P.myId(),
    actingAsBot: P.actingAsBot(), writerLock: await P.writerLock("!s", fnArg), sendSide: await P.sendSide({ history_owner: "!h" }, "ddjp.side.history.summary", { v: 1 }) };
  P.rearm(); P.onHistoryChange(fnArg); P.offHistoryChange(fnArg); P.onRaw(fnArg); P.offRaw(fnArg); P.onCaughtUp(fnArg); P.log("info", "x"); P.log("warn", "y");
  const want = ["MB.roomHistory([])", "MB.historyCoverage([])", "MB.historySummaries([])", "MB.historyReadingOf([3,9])", "MB.historyIdle([])",
    "MB.readHistorySummaries([])", "SM.getState([])", "SM.getState([])", "MB.mayAuthor([])", "SC.serverNow([])", "MB.getUserId([])", "BR.actingAsBot([])",
    "ST.writerLock([\"!s\"])", "MB.sendSide([{\"history_owner\":\"!h\"},\"ddjp.side.history.summary\",{\"v\":1},\"history_owner\"])",
    "MB.rearmHistoryBackfill([])", "MB.onHistoryChange([])", "MB.offHistoryChange([])", "MB.onRawEvent([])", "MB.offRawEvent([])", "MB.onAuthorReady([])",
    "LG.info([\"History bot: x\"])", "LG.warn([\"History bot: y\"])"];
  ok(JSON.stringify(calls) === JSON.stringify(want), "B: EVERY PORT REACHES THE ONE FUNCTION IT NAMES, its arguments unchanged — the send on the song history channel", calls);
  ok(got.rows[0].pi === "$p" && got.coverage.full === true && got.marks[0].n === 1 && got.readingOf[0].pi === "$r" && got.busy === true &&
     got.readBack.taken === 1 && got.playingPi === "$np" && got.settings.historySummaryEvery === 15 && got.mayAuthor === true && got.serverNow === 1234 && got.myId === "@bot:hs" &&
     got.actingAsBot === true && got.writerLock === true && got.sendSide.ok === true, "B: and hands its answer back (server time in whole milliseconds; `busy` is a run in flight)", got);
  // with nothing loaded: safe answers, never a throw
  let threw = null, empty = null;
  try {
    const N = loadInContext([PORT], {}).HistoryPorts;
    empty = { rows: N.rows(), coverage: N.coverage(), marks: N.marks(), readingOf: N.readingOf(1, 2), busy: N.busy(), readBack: await N.readBack(),
      playingPi: N.playingPi(), settings: N.settings(), mayAuthor: N.mayAuthor(), serverNow: N.serverNow(), myId: N.myId(), actingAsBot: N.actingAsBot(),
      writerLock: await N.writerLock("!s", fnArg), sendSide: await N.sendSide({}, "t", {}) };
    N.rearm(); N.onHistoryChange(fnArg); N.offHistoryChange(fnArg); N.onRaw(fnArg); N.offRaw(fnArg); N.onCaughtUp(fnArg); N.log("info", "x");
  } catch (e) { threw = String(e); }
  ok(threw === null && empty && empty.rows.length === 0 && empty.coverage === null && empty.marks.length === 0 && empty.busy === false && empty.readBack === null &&
     empty.playingPi === null && empty.mayAuthor === false && empty.serverNow === null && empty.actingAsBot === false && empty.writerLock === null && empty.sendSide.ok === false,
    "B: WITH NOTHING LOADED every port answers safely — nothing, false, null, a refused send — never a throw", { threw, empty });
}
// ── C — THE APP REACHES IT AT TWO SITES ─────────────────────────────────────────────────────────────────────────────────────────
{
  const appFiles = ["app.js"].concat(listJs("core"), listJs("features"), listJs("ui"), listJs("backends/backend1"), listJs("backends/backend2"), listJs("backends/backend3"))
    .filter((f) => f !== BOT && f !== PORT);
  const breaches = [];
  for (const f of appFiles) {
    const c = code(read(f));
    if (word("HistoryPorts").test(c)) breaches.push(f + " names HistoryPorts");
    if (word("HistoryBot").test(c) && f !== "features/room.js") breaches.push(f + " names HistoryBot");
  }
  ok(breaches.length === 0, "C: outside its two files no code names the bot side or its door — but `features/room.js`'s two sites", breaches);
  const rm = code(read("features/room.js"));
  const calls = (rm.match(/(^|[^A-Za-z0-9_$.])HistoryBot\.([A-Za-z_$]+)\s*\(/g) || []).map((m) => m.replace(/^[^H]*HistoryBot\./, "").replace(/\s*\($/, ""));
  const within = (start, end, what) => { const a = rm.indexOf(start), b = rm.indexOf(end, a + 1), i = rm.indexOf(what, a); return a >= 0 && b > a && i > a && i < b; };
  ok(calls.slice().sort().join() === "enter,leave", "C: `features/room.js` calls `HistoryBot.enter` and `HistoryBot.leave`, once each, and nothing else of it", calls);
  const ev = rm.indexOf("function _evaluateBot() {");
  ok(within("function _historyBotEnter() {", "function _evaluateBot() {", "HistoryBot.enter(") &&
     within("function _evaluateBot() {", "function _evaluateBotRuntime() {", "_historyBotEnter();") &&
     rm.indexOf("_evaluateBotRuntime();", ev) < rm.indexOf("_historyBotEnter();", ev) && rm.indexOf("_historyBotEnter();", ev) < rm.indexOf("typeof Rep ===", ev) &&
     (rm.match(/(^|[^A-Za-z0-9_$])_historyBotEnter\(\);/g) || []).length === 1,
    "C: `enter` sits in its one helper, which the bot's evaluation alone calls — after the runtime decided, before REP's own early return (so a page without REP still starts it)");
  ok(within("function leave(why, opts) {", "StreamManager.reset(", "HistoryBot.leave("), "C: `leave` sits in the one leave step, before the engine resets");
  const html = read("index.html");
  const iFmt = html.indexOf("core/historysummary.js?v="), iP = html.indexOf("features/history-ports.js?v="), iB = html.indexOf("features/history-bot.js?v=");
  ok(iFmt >= 0 && iP > iFmt && iB > iP, "C: the page loads the door and the bot side, after the format", { iFmt, iP, iB });
}
// ── D — NOTHING OF IT INSIDE THE BOT RUNTIME, THE SEAM, THE ENGINES OR THE FOLD ─────────────────────────────────────────────────
{
  const inside = ["features/botruntime.js", "core/backends.js"].concat(listJs("backends/backend1"), listJs("backends/backend2"), listJs("backends/backend3"));
  const hits = inside.filter((f) => /\b(HistoryBot|HistoryPorts)\b|history-bot|history-ports/.test(code(read(f))));
  ok(inside.length > 10 && hits.length === 0, "D: the bot runtime, the seam and the engines name nothing of it — no global, no file", hits);
}
// ── E — EVERY PORT REACHES SOMETHING REAL, IN BOTH ENGINES ──────────────────────────────────────────────────────────────────────
async function partE() {
  const src = code(read(PORT));
  const reach = (mod) => Array.from(new Set(Array.from(src.matchAll(new RegExp("\\b" + mod + "\\(\\)\\.([A-Za-z_$]+)\\(", "g"))).map((m) => m[1]))).sort();
  const mb = reach("MB"), sm = reach("SM"), sc = reach("SC"), br = reach("BR");
  const st = Array.from(new Set(Array.from(src.matchAll(/\bST\(\)\.history\.([A-Za-z_$]+)\(/g)).map((m) => m[1])));
  ok(mb.length >= 12 && sm.indexOf("getState") >= 0 && sc.indexOf("serverNow") >= 0 && br.indexOf("actingAsBot") >= 0 && st.indexOf("writerLock") >= 0,
    "E PREMISE — the functions the ports reach, read from the door", { mb, sm, sc, br, st });
  for (const mode of ["backend1", "backend2"]) {
    const w = B.world({ mode: mode, order: B.ORDER });
    const missing = mb.filter((f) => typeof w.sb.MatrixBridge[f] !== "function").concat(sm.filter((f) => typeof w.sb.StreamManager[f] !== "function"));
    ok(missing.length === 0, "E: every function the door reaches on the bridge and the engine exists under " + mode + "'s binding", missing);
  }
  const real = loadInContext(["core/store.js", "features/serverclock.js", "features/botruntime.js"], { IDB: { supported: () => false }, StorageIO: { load: () => null, save() {} } });
  const lost = sc.filter((f) => !(real.ServerClock && typeof real.ServerClock[f] === "function")).concat(br.filter((f) => !(real.BotRuntime && typeof real.BotRuntime[f] === "function")))
    .concat(st.filter((f) => !(real.Store && real.Store.history && typeof real.Store.history[f] === "function")));
  ok(lost.length === 0, "E: and the server clock's, the bot runtime's and the store's exist on the real modules", lost);
}

(async () => {
  try { await partB(); } catch (e) { ok(false, "B: THREW — " + e); }
  try { await partE(); } catch (e) { ok(false, "E: THREW — " + e); }
  _finished = true;
  if (failed) { console.log("[history-bot-boundary] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[history-bot-boundary] PASS — THE SONG HISTORY BOT IS ITS OWN PIECE, IN REP'S SHAPE (738; " + asserts + " assertions). THE BOT names no app global but the format " +
    "and its door, and no clock. THE DOOR names only the modules it declares, lists exactly what it exports, every port called by the bot, each a pass-through " +
    "(driven against stand-ins) and safe with nothing loaded. THE APP reaches it at two sites in `features/room.js` — `enter` in the bot's evaluation before REP's early return, " +
    "`leave` in the leave step before the engine resets — and the page loads both after the format. NOTHING OF IT is inside the bot runtime, the seam or the engines. " +
    "EVERY PORT reaches a function that exists on the real modules under both engines. THIS GUARD READS NAMES AND DRIVES THE DOOR: the bot's behaviour is `check-history-bot`'s");
})();
