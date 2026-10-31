// tests/check-history-store.js
// SUBJECT: core/store.js, backends/backend1/matrixbridge.js, backends/backend1/history.js, features/room.js, features/queue.js, features/botruntime.js
// WALL: SONG HISTORY IS REALLY STORED, A ROOM SWITCH CANNOT OVERWRITE ANOTHER ROOM'S TABLE, AND THE
// ADDED-TIME PATH IS WIRED END TO END (J73 job 6b).
//
// The J73 audit drove it: `Store.history.persist` returned early unless handed an ARRAY, and `load`
// returned only arrays, while `_persistHistory` hands it `History.snapshot()` — an object. So song
// history was never stored on any device, at `ddjp_512` as now; `check-history-durable` F gave the
// snapshot straight to `restore` and never went through the store. Every part here runs real code.
//   PART A — the real `core/store.js` (IDB stubbed, nothing else): persist, a FRESH store loads,
//            restore — rows, reach and added times come back. Control: an old array still loads.
//   PART B — the real debounce and `resetCheckpoints`: a song change, a room switch within 2 s, in
//            both orders; the second room's stored table is intact and the first's latest is kept.
//   PART C — the real bot sweep over the real Room, Queue, bridge functions and History: a song
//            queued twice is skipped, one added after its earlier play is not.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-store] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// A GUARD THAT NEVER FINISHES IS NOT A PASS (J73 job 4, found by `mutate-j73-windows` W12). Its rows
// run in an async block; a promise that never settles stopped it before its verdict, and Node then
// exited 0 — so a mutation that hung the code under test read GREEN. Exiting unfinished fails.
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[history-store] FAIL — the guard did not finish: a promise " +
  "never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MIN = 60000, T = 5000 * MIN, V = "VVVVVVVVVVV";
const HFILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"];
// IndexedDB, stubbed: one shared map, values stored as copies, promises like the real one.
function idb() {
  const map = new Map();
  return { map, supported: () => true, keyFor: (scope, a, b) => JSON.stringify([scope, a, b]),
    get: (s, k) => Promise.resolve(map.has(s + k) ? structuredClone(map.get(s + k)) : undefined),
    set: (s, k, v) => { map.set(s + k, structuredClone(v)); return Promise.resolve(); },
    del: (s, k) => { map.delete(s + k); return Promise.resolve(); } };
}
const storeOn = (IDB) => loadInContext(["core/logger.js", "core/store.js"], { IDB: IDB }).Store;
const tick = () => new Promise((r) => setImmediate(r));
const tableOf = (rows, ranges, adds) => ({ v: 2, rows: rows, ranges: ranges, adds: adds || {} });
const rowsFor = (tag, n) => Array.from({ length: n }, (_, i) => ({ pi: "$" + tag + i, videoId: "vid" + tag + String(i).padStart(6, "0"), dj: "@a:hs", at: 1000 + i, l: 10 + i }));
const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const fnSrc = (sig) => { const i = MB.indexOf(sig); const j = MB.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? MB.slice(i, j + 4) : null; };
const between = (a, b) => { const i = MB.indexOf(a), j = MB.indexOf(b, i + 1); return (i >= 0 && j > i) ? MB.slice(i, j) : null; };

(async () => {
  // ── PART A — through the real store ──────────────────────────────────────────────────────
  {
    const IDB = idb(); const h = loadInContext(HFILES, {}).History; h.reset();
    h.restore(tableOf(rowsFor("a", 12), [[0, 40]], { ["@a:hs\u0000" + V]: [T - 20 * MIN] }));
    const snap = h.snapshot();
    storeOn(IDB).history.persist("!A", snap);
    await tick();
    const loaded = await storeOn(IDB).history.load("!A");                 // a FRESH store, the same device
    ok(!!loaded && loaded.v === 2, "A: the snapshot is written and a fresh store loads it back — it was refused before", loaded && { v: loaded.v });
    const h2 = loadInContext(HFILES, {}).History; h2.reset();
    const r = h2.restore(loaded);
    ok(r.ok && h2.count() === 12 && JSON.stringify(h2.coverage().ranges) === "[[0,40]]" && h2.addedAt("@a:hs", V, Infinity) === T - 20 * MIN,
      "A: restored from it — every row, the reach and the added times come back", { ok: r.ok, count: h2.count(), ranges: h2.coverage().ranges, added: h2.addedAt("@a:hs", V, Infinity) });
    storeOn(IDB).history.persist("!old", rowsFor("o", 3));               // an old bare array
    await tick();
    const old = await storeOn(IDB).history.load("!old");
    const h3 = loadInContext(HFILES, {}).History; h3.reset();
    const r3 = h3.restore(old);
    ok(Array.isArray(old) && r3.ok && h3.count() === 3 && h3.coverage().ranges.length === 0,
      "A CONTROL: an old array still loads and restores — its rows, with no claimed reach", { arr: Array.isArray(old), count: h3.count(), ranges: h3.coverage().ranges });
    storeOn(IDB).history.persist("!junk", { nothing: true }); await tick();
    ok(await storeOn(IDB).history.load("!junk") === null, "A: something that is not a table is not stored");
  }
  // ── PART B — a song change, then a room switch within 2 s ─────────────────────────────────
  for (const order of ["reset-first", "timer-between"]) {
    const IDB = idb(); const store = storeOn(IDB);
    const H = loadInContext(HFILES, {}).History; H.reset();
    store.history.persist("!B", tableOf(rowsFor("b", 7), [[0, 30]])); await tick();     // B's stored copy
    H.restore(tableOf(rowsFor("a", 5), [[0, 20]]));                                       // we are in A
    const timers = [];
    const target = { History: H, Store: store, Logger: { info() {}, warn() {} }, StreamManager: { getLog: () => [] },
      // `_releaseActivityRead` too: since J73 job 4's fix `resetCheckpoints` also stops a read still in flight.
      _tellFoldAboutCoverage: () => {}, clearRoomScope: () => {}, _releaseActivityRead: () => {}, _currentSpaceId: "!A", _lastHistCount: -1,
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => { timers.length = 0; } };
    const scope = new Proxy(target, { has: () => true, get: (t, k) => (k in t) ? t[k] : (k === Symbol.unscopables ? undefined : globalThis[k]),
                                      set: (t, k, v) => { t[k] = v; return true; } });
    const body = between("  const PERSIST_DEBOUNCE_MS = 2000;", "  function _refreshHistory() {") +
      fnSrc("  function _refreshHistory() {") + fnSrc("  function _persistHistory(forSid) {") + fnSrc("  function resetCheckpoints() {");
    ok(!/null$/.test(String(body)) && body.indexOf("function resetCheckpoints") > 0, "B PREMISE — the real functions are extracted (" + order + ")");
    const api = new Function("scope", "with (scope) {\n" + body + "\nreturn { _refreshHistory, resetCheckpoints };\n}")(scope);
    H.restore(tableOf(rowsFor("a", 6), [[0, 21]]));        // a song changed in A ...
    api._refreshHistory();                                  // ... and its save is scheduled, not yet written
    ok(timers.length === 1, "B PREMISE — the song change scheduled one save (" + order + ")", timers.length);
    target._currentSpaceId = "!B";                          // within 2 s, the room switches
    if (order === "timer-between") { timers.splice(0).forEach((f) => f()); await tick(); }
    api.resetCheckpoints();
    timers.splice(0).forEach((f) => f()); await tick();
    const b = await store.history.load("!B"), a = await store.history.load("!A");
    ok(!!b && b.rows.length === 7, "B: the second room's stored table is intact after the switch (" + order + ")", b && b.rows.length);
    if (order === "reset-first") ok(!!a && a.rows.length === 6, "B: the first room's latest table was written before History was reset", a && a.rows.length);
  }
  // ── PART C — the added-time path, end to end ─────────────────────────────────────────────
  // CHANGED BY THE OWNER'S REPEAT RULE (`ddjp_536`, J73), superseding Q10: a copy added AFTER the current cooldown took
  // effect is skipped when history shows a play inside it — so "added after its earlier play" is now SKIPPED; a copy added
  // BEFORE the setting took effect plays. Positions: the earlier play $p1 at 10, the live play $p2 at 20.
  for (const [label, addedAgo, wantSkip, addL, changeL] of [["queued twice", 20, true, 5, null], ["added after its earlier play", 5, true, 15, null],
                                                            ["added before the cooldown took effect", 3, false, 12, 14]]) {
    const calls = { skips: [] };
    let bridge = null;
    const live = { pi: "$p2", dj: "@dj:hs", song: { videoId: V }, startedAt: T - 1000 };
    const sb = loadInContext(HFILES.concat(["backends/backend1/capabilities.js", "backends/backend1/settingsproof.js", "features/room.js", "features/queue.js", "features/botruntime.js"]), {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      window: {}, document: { body: { appendChild() {} }, addEventListener() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      ServerClock: { serverNow: () => T },
      Skip: { skip: (k) => { calls.skips.push(k); return Promise.resolve({ ok: true }); } },
      Chat: { sendTo: () => Promise.resolve({ ok: true }), send: () => Promise.resolve({ ok: true }) },
      MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99, getRoster: () => [],
        onRawEvent() {}, offRawEvent() {}, joinedMembersOf: () => [], invitedMembersOf: () => [],
        mayAuthor: () => ({ ok: true }), onAuthorReady() {},
        historyAddedAt: (...a) => bridge.historyAddedAt(...a), historyAddedAtL: (...a) => bridge.historyAddedAtL(...a), historyCoverage: (...a) => bridge.historyCoverage(...a),
        roomHistory: (...a) => bridge.roomHistory(...a) },
    });
    const S0 = Object.assign(sb.StateDeriver.defaultSettings(), { repeatCooldownMs: changeL === null ? 60 * MIN : 0 });
    const S1 = Object.assign(sb.StateDeriver.defaultSettings(), { repeatCooldownMs: 60 * MIN });
    const roomLog = [{ eventId: "$s0", l: 1, type: "ddjp.room.settings", sender: "@o:hs", content: { t: "ddjp.room.settings", s: S0 } }]
      .concat(changeL === null ? [] : [{ eventId: "$s1", l: changeL, type: "ddjp.room.settings", sender: "@o:hs", content: { t: "ddjp.room.settings", s: S1 } }])
      .concat([{ eventId: "$add", l: addL, type: "ddjp.dj.join", sender: "@dj:hs", content: { t: "ddjp.dj.join", v: V } },
               { eventId: "$p2", l: 20, type: "ddjp.dj.play", sender: "@dj:hs", content: { t: "ddjp.dj.play" } }]).sort((a, b) => a.l - b.l);
    // The REAL settings record, fed the room's settings events as the bridge feeds it (owner-rank senders).
    sb.SettingsProof.reset(); sb.SettingsProof.markGenesisReached(); sb.SettingsProof.ingest(roomLog.filter((e) => e.type === "ddjp.room.settings").map((e) => Object.assign({ senderRank: 100 }, e)));
    sb.StreamManager = { getLog: () => roomLog, isLegal: () => true, on() {}, settingSince: (k) => sb.SettingsProof.heldSince(k),
      getState: () => ({ settings: Object.assign(sb.StateDeriver.defaultSettings(), { repeatCooldownMs: 60 * MIN }), rotation: [], nowPlaying: live }) };
    // THE REAL BRIDGE FUNCTIONS, extracted from matrixbridge.js and bound to this sandbox's History.
    bridge = new Function("History", "StreamManager", fnSrc("  function historyAddedAt(user, videoId, beforeTs) {") + fnSrc("  function historyAddedAtL(user, videoId, beforeL) {") +
      fnSrc("  function historyCoverage() {") + fnSrc("  function roomHistory(limit) {") +
      "\nreturn { historyAddedAt, historyAddedAtL, historyCoverage, roomHistory };")(sb.History, { getLog: () => roomLog });
    try { sb.Room.rankLadder = () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }]; sb.Room.chatTiers = () => ({ mainId: "!main" }); } catch (e) {}
    sb.History.reset();
    sb.History.restore(tableOf([{ pi: "$p1", videoId: V, dj: "@dj:hs", at: T - 12 * MIN, l: 10 }], [[0, 30]],
      { ["@dj:hs\u0000" + V]: [T - addedAgo * MIN] }));
    const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!p" } });
    ok(started && started.ok === true, "C PREMISE — the real bot runtime started (" + label + ")", started);
    const v = sb.Room.playedWithin(V, T, { dj: live.dj, beforeTs: live.startedAt });
    ok(v.addedAt === T - addedAgo * MIN, "C: the real Room reaches the added time through Queue and the bridge (" + label + ")", v);
    const r = sb.BotRuntime.sweepRepeat();
    ok(wantSkip ? (r.reason === "skipping" && calls.skips.length === 1) : (r.reason === "added-before-change" && calls.skips.length === 0),
      "C: through the real path, a song " + label + " is " + (wantSkip ? "SKIPPED" : "played"), { r, skips: calls.skips });
    try { sb.BotRuntime.stop(); } catch (e) {}
  }
})().then(done, (e) => { failed++; console.log("[history-store] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[history-store] " + failed + " failure(s)"); process.exit(1); }
  console.log("[history-store] PASS — song history is really stored (J73 job 6b): the real store writes the snapshot and a " +
    "fresh store loads it back into History, an old array still loads, a room switch within the debounce leaves the next " +
    "room's stored table intact in either order, and through the real bot, Room, Queue and bridge a song queued twice is " +
    "skipped while one added after its earlier play plays (" + asserts + " assertions)");
  process.exit(0);
}
