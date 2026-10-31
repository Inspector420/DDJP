// tests/check-session-awake.js
// SUBJECT: backends/backend1/session.js, backends/backend1/matrixbridge.js
// WALL: A TAB IS BEHIND WHEN IT HAS STOPPED HEARING THE WORLD, NOT WHEN IT IS OUT OF SIGHT (J68; the owner's decision 1,
// `ddjp_634`: no tab pauses because it is hidden. "Am I behind?" is answered by whether the server kept answering, plus the
// tab's own clock for a real sleep — the laptop closed, the tab frozen. The gate stays: only a live tab authors).
//
// On `ddjp_634` a hidden tab was suspended by the visibility signal, and released by the next SDK answer, because
// `connectionBack` ran on every `sync` SYNCING and cleared every wait; it also reset the beat's clock, so a server answer
// half-worked as a sign of life by accident. Chrome wakes a hidden tab's chained timers once a minute, so its beat came about
// 60 s late — over the 20 s jump test — and the tab went on alternating between suspended and catching up, settling only on a
// beat, and never staying live. Driven: the real Session, wired by the real bridge (`seedClock` -> `_wireSession`); the SDK
// client is a double whose `sync` listeners this guard calls as the SDK does, `(state, prevState)`; the clock, the document,
// the window and the timers are doubles.
//
//   PART A — hiding a tab does not suspend it. (Red on `ddjp_634`.)
//   PART B — a hidden tab whose beats come a minute apart, while the server answers every 30 s, stays LIVE and may author at
//            every beat and every answer for fifteen minutes, at two alignments of beat and answer. (Red on `ddjp_634`.)
//   PART C — THE CONTROL: a real sleep (no beat and no answer for ten minutes) still suspends, catches up and settles.
//   PART D — a slowed tab settles on a server answer, with no beat between; and not while the log is still growing.
//            (Red on `ddjp_634`: only a beat settled.)
//   PART E — a sleep is told (`MatrixBridge.onSlept`, which the bot's alarm hears): on a beat; on an answer, when that is the
//            first sign of life after it (suspended too — on `ddjp_634` the answer hid the sleep); while the tab already waits on
//            its connection. Never for a hidden tab whose beats are a minute apart, whether the server answers or its
//            connection is down. (Red on `ddjp_634`: nothing told it.)
//   PART F — the connection: a loss suspends and beats do not end the wait; the SDK's return ends it; an answer while the
//            browser says offline ends that wait too — the server answered.
//   PART G — THE FIRST ANSWER AFTER A SLEEP (`ddjp_645`, the supervisor's review of `ddjp_644`). The SDK hands an answer's events
//            out BEFORE it says the server answered (41.8.0: `processSyncResponse` emits every `Room.timeline`, then
//            `updateSyncState(SYNCING)`), so after a gap over `SLEEP_MS` the first answer's events reached the raw listeners — the
//            bot's sweep and runner — while Session still said LIVE. Driven through the bridge's REAL live-timeline handler (the one
//            `start()` registers) with a listener that reads `MatrixBridge.mayAuthor()`, the gate both of the bot's author paths
//            read, as each event is handed to it. G1: after a silent gap the tab is suspended before the first event is handed
//            out, the Session line comes first, the sleep is told once, and the answer and a quiet beat then settle it as before.
//            (Red on `ddjp_644`.) G2, THE CONTROL: an ordinary answer with no gap changes nothing. G3, THE CONTROL: during a
//            catch-up an ordinary arrival does not settle the tab — a beat or the server's answer does, as before; an arrival is
//            asked about a sleep only, so the settle never runs half-way through an answer.
// Each part asserts its own premise first: the beat and the sync listener were wired, the tab was live before the window,
// and the schedule ran as written.

const { loadInContext } = require("./_load");

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[session-awake] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const SEC = 1000, MIN = 60 * SEC;
const MODS = ["core/logger.js", "core/storageio.js", "core/idb.js",
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/eventcache.js",
  "backends/backend1/statederiver.js", "backends/backend1/streammanager.js", "backends/backend1/session.js",
  "backends/backend1/matrixbridge.js"];

// ONE TAB: the bridge wires Session at room entry, as `features/room.js` does through `seedClock`.
function world() {
  let now = 1792000000000;
  const D = function (...a) { return a.length ? new Date(...a) : new Date(now); };
  D.now = () => now; D.UTC = Date.UTC; D.parse = Date.parse;
  const intervals = [];
  const doc = { hidden: false, visibilityState: "visible", fns: [],
    addEventListener(t, f) { if (t === "visibilitychange") this.fns.push(f); }, removeEventListener() {} };
  const win = { on: {}, isSecureContext: false,
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }, removeEventListener() {} };
  const sb = loadInContext(MODS, {
    Date: D, Math, JSON, Promise, setTimeout: () => 0, clearTimeout: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
    window: win, document: doc, indexedDB: undefined, matrixcs: {}, navigator: { onLine: true },
  });
  const lines = [];
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = (m) => lines.push(String(m));
  const sync = [], handlers = {};
  sb.MatrixBridge._setClientForTest({ on: (ev, fn) => { if (ev === "sync") sync.push(fn); (handlers[ev] = handlers[ev] || []).push(fn); }, removeListener() {},
    getRoom: () => null, getRooms: () => [], getUserId: () => "@me:hs" });
  sb.MatrixBridge.seedClock("!space:hs");
  const S = sb.Session, MB = sb.MatrixBridge;
  const beats = intervals.filter((t) => t.ms === S.BEAT_MS);
  let last = "SYNCING";   // the client has been syncing since before the room was entered
  const w = {
    sb, S, MB, lines, doc, win, sync, beats, handlers,
    t: () => now, adv(ms) { now += ms; },
    beat() { for (const b of beats) b.fn(); },
    // The SDK's `ClientEvent.Sync`: `(state, prevState)`. Every /sync answer emits SYNCING, empty or not (`sync.js`).
    sdk(state) { const prev = last; last = state; for (const f of sync.slice()) f(state, prev); },
    answer() { w.sdk("SYNCING"); },
    hide(h) { doc.hidden = !!h; doc.visibilityState = h ? "hidden" : "visible"; for (const f of doc.fns.slice()) f(); },
    online(v) { for (const f of (win.on[v ? "online" : "offline"] || []).slice()) f(); },
    may: () => { const r = MB.mayAuthor(); return !!(r && r.ok !== false); },
    // The replay done, then one beat over a quiet log: LIVE, as a tab is once it has caught up.
    toLive() { S.replayFinished(); now += S.BEAT_MS; w.beat(); return S.phase(); },
  };
  return w;
}
// A schedule of [ms after now, "beat" | "answer"], run in order; the phase and the gate read after each.
function run(w, events) {
  const t0 = w.t(), out = [];
  events.sort((a, b) => (a[0] - b[0]) || (a[1] === "answer" ? -1 : 1));
  for (const [at, kind] of events) { w.adv(t0 + at - w.t()); w[kind](); out.push({ at: at / SEC, kind, phase: w.S.phase(), may: w.may() }); }
  return out;
}
// Fifteen minutes hidden: the server answers every 30 s (the long-poll), the beat comes once a minute (Chrome's throttling),
// the first beat `off` seconds after an answer.
function hiddenSchedule(off) {
  const ev = [];
  for (let t = 30 * SEC; t <= 15 * MIN; t += 30 * SEC) ev.push([t, "answer"]);
  for (let t = 30 * SEC + off * SEC; t <= 15 * MIN; t += MIN) ev.push([t, "beat"]);
  return ev;
}
function wired(w, part) {
  ok(w.beats.length === 1 && w.sync.length >= 1,
    part + " PREMISE — the bridge wired Session: one heartbeat at Session's own period, and a listener on the SDK's sync state",
    { beats: w.beats.length, sync: w.sync.length });
  ok(w.toLive() === "live" && w.may(), part + " PREMISE — a tab that has caught up is LIVE and may author", w.S.phase());
}

// ═══ PART A — hiding a tab does not suspend it ═══
{
  const w = world();
  wired(w, "A");
  w.adv(2 * SEC); w.hide(true);
  ok(w.doc.hidden === true && w.doc.visibilityState === "hidden", "A PREMISE — the document says the tab is hidden");
  ok(w.S.phase() === "live" && w.may(),
    "A: HIDING A TAB DOES NOT SUSPEND IT (the owner's decision 1) — being out of sight is not being behind", w.S.phase());
  w.adv(5 * SEC); w.beat(); w.adv(25 * SEC); w.answer();
  ok(w.S.phase() === "live" && w.may(), "A: and its beats and the server's answers keep it live", w.S.phase());
}

// ═══ PART B — a hidden, throttled tab whose server answers stays live ═══
for (const off of [5, 25]) {
  const w = world();
  wired(w, "B");
  w.hide(true);
  const tr = run(w, hiddenSchedule(off));
  const bt = tr.filter((x) => x.kind === "beat"), an = tr.filter((x) => x.kind === "answer");
  ok(w.doc.hidden && an.length === 30 && bt.length === 15 && bt.every((x, i) => i === 0 || x.at - bt[i - 1].at === 60),
    "B PREMISE — fifteen minutes hidden: 30 answers 30 s apart and 15 beats a minute apart (first " + off + " s after an answer)",
    { answers: an.length, beats: bt.length });
  const bad = tr.filter((x) => x.phase !== "live" || !x.may);
  ok(bad.length === 0,
    "B: A HIDDEN TAB WHOSE BEATS COME A MINUTE APART, WHILE THE SERVER ANSWERS EVERY 30 S, STAYS LIVE AND MAY AUTHOR — at every " +
    "beat and every answer for fifteen minutes (first beat " + off + " s after an answer). On `ddjp_634` it alternated: a late " +
    "beat suspended it, the next answer released it, and only a beat could settle it", bad.slice(0, 4));
}

// ═══ PART C — THE CONTROL: a real sleep still suspends, catches up and settles ═══
{
  const w = world();
  wired(w, "C");
  w.adv(10 * MIN);                      // the machine sleeps: no beat, no answer
  w.beat();
  ok(w.S.phase() === "suspended" && !w.may(),
    "C: A REAL SLEEP STILL SUSPENDS — the first beat after ten silent minutes, and the tab may not author", w.S.phase());
  const seen = [];
  for (let i = 1; i <= 12; i++) { w.adv(5 * SEC); if (i % 6 === 0) w.answer(); w.beat(); seen.push(w.S.phase()); }
  ok(seen.indexOf("catching-up") >= 0 && w.S.phase() === "live" && w.may(),
    "C: and on waking it catches up and settles — through CATCHING-UP to LIVE within a minute (the control: green on both)", seen);
}

// ═══ PART D — a slowed tab settles on a server answer ═══
{
  const w = world();
  wired(w, "D");
  w.hide(true);
  w.adv(10 * MIN); w.beat();            // asleep, hidden
  ok(w.S.phase() === "suspended", "D PREMISE — a sleep suspended the hidden tab", w.S.phase());
  w.adv(20 * SEC); w.answer();          // the first answer after waking
  ok(w.S.phase() === "catching-up", "D PREMISE — the next sign of life, an answer, releases it to CATCHING-UP", w.S.phase());
  // The control first: an event arrives and the server answers right behind it — the log is not quiet yet.
  w.adv(10 * SEC); w.S.sawEvent(); w.adv(100); w.answer();
  ok(w.S.phase() === "catching-up",
    "D CONTROL: an answer right behind an arriving event does not settle — the settle is the log quiet for the settle window", w.S.phase());
  w.adv(30 * SEC); w.answer();          // no beat for the last 40 s; the log quiet; the server answers
  ok(w.S.phase() === "live" && w.may(),
    "D: A SLOWED TAB SETTLES ON A SERVER ANSWER — with no beat between, the log quiet, the answer settles it. On `ddjp_634` only a " +
    "beat settled, so a hidden tab could settle once a minute and the next late beat suspended it again", w.S.phase());
}

// ═══ PART E — a sleep is told ═══
function listen(w) {
  const told = [];
  const has = typeof w.MB.onSlept === "function";
  if (has) w.MB.onSlept((x) => told.push(x));
  return { told, has };
}
{
  const w = world(); const L = listen(w);
  ok(L.has, "E: the bridge tells a sleep — `MatrixBridge.onSlept` is a function", typeof w.MB.onSlept);
  wired(w, "E");
  w.hide(true); w.adv(10 * MIN); w.beat();
  ok(L.has && L.told.length === 1 && L.told[0] && L.told[0].gapMs >= 10 * MIN,
    "E: A SLEEP IS TOLD — the first beat after ten silent minutes tells it once, with the gap since the last sign of life", L.told);
  w.adv(5 * SEC); w.beat(); w.adv(25 * SEC); w.answer(); w.adv(30 * SEC); w.answer();
  ok(L.has && L.told.length === 1, "E: once — the signs of life after it tell nothing", L.told.length);
}
{
  const w = world(); const L = listen(w);
  wired(w, "E2");
  w.adv(10 * MIN); w.answer();          // frozen: on waking the server's answer is the first sign of life
  ok(L.has && L.told.length === 1 && w.S.phase() === "suspended" && !w.may(),
    "E: A SLEEP WHOSE FIRST SIGN OF LIFE IS AN ANSWER IS A SLEEP TOO — suspended and told. On `ddjp_634` the answer reset the " +
    "beat's clock, so the sleep was never seen", { told: L.told.length, phase: w.S.phase() });
}
{
  const w = world(); const L = listen(w);
  wired(w, "E3");
  w.adv(10 * MIN); w.sdk("RECONNECTING");   // the machine woke and the failed request reported first
  ok(w.S.phase() === "suspended" && w.S.awaitingSignal() === "connection", "E3 PREMISE — the lost connection suspended it first", w.S.phase());
  w.beat();
  ok(L.has && L.told.length === 1,
    "E: A SLEEP IS TOLD WHILE THE TAB ALREADY WAITS ON ITS CONNECTION — the phase does not change, the sleep still happened", L.told);
}
{
  const w = world(); const L = listen(w);
  wired(w, "E4");
  w.hide(true); run(w, hiddenSchedule(25));
  ok(L.has && L.told.length === 0,
    "E: NEVER FOR A HIDDEN TAB WITH ITS BEATS A MINUTE APART AND ITS SERVER ANSWERING — fifteen minutes, nothing told", L.told);
}
{
  const w = world(); const L = listen(w);
  wired(w, "E5");
  w.hide(true); w.adv(10 * SEC); w.sdk("RECONNECTING");
  for (let i = 0; i < 10; i++) { w.adv(MIN); w.beat(); }
  ok(w.S.phase() === "suspended" && w.S.awaitingSignal() === "connection", "E5 PREMISE — the tab waits on its connection", w.S.phase());
  ok(L.has && L.told.length === 0,
    "E: NOR FOR A HIDDEN TAB WHOSE CONNECTION IS DOWN, ITS BEATS A MINUTE APART — no answer can come, and a beat a minute late is " +
    "Chrome's throttling, not a sleep: the sleep test sits above Chrome's once-a-minute wake", L.told);
  w.sdk("ERROR"); w.adv(10 * SEC); w.sdk("CATCHUP"); w.adv(SEC); w.answer();   // the SDK's way back: ERROR -> CATCHUP -> SYNCING
  ok(w.S.phase() === "catching-up" && L.told.length === 0, "E5: and the SDK's return releases it, still with nothing told", w.S.phase());
}

// ═══ PART F — the connection ═══
{
  const w = world();
  wired(w, "F");
  w.sdk("RECONNECTING");
  ok(w.S.phase() === "suspended" && w.S.awaitingSignal() === "connection", "F: a lost connection suspends, waiting on the connection", w.S.phase());
  for (let i = 0; i < 3; i++) { w.adv(5 * SEC); w.beat(); }
  ok(w.S.phase() === "suspended", "F: and beats do not end that wait", w.S.phase());
  w.sdk("ERROR"); w.adv(5 * SEC); w.sdk("CATCHUP"); w.answer();
  ok(w.S.phase() === "catching-up" && w.lines.some((m) => /connection to the homeserver is back/.test(m)),
    "F: the SDK's return ends it — catching up, and it says the connection is back", { phase: w.S.phase() });
  w.adv(5 * SEC); w.beat();
  ok(w.S.phase() === "live", "F: and the next beat over a quiet log settles it", w.S.phase());
  w.online(false);
  ok(w.S.phase() === "suspended" && w.S.awaitingSignal() === "offline", "F: the browser going offline suspends, waiting on it", w.S.phase());
  w.adv(5 * SEC); w.beat();
  ok(w.S.phase() === "suspended", "F: and a beat does not end that wait", w.S.phase());
  w.adv(10 * SEC); w.answer();
  ok(w.S.phase() === "catching-up",
    "F: AN ANSWER WHILE THE BROWSER SAYS OFFLINE ENDS THAT WAIT — the server answered, whatever the signal says", w.S.phase());
}

// ═══ PART G — the first answer after a sleep: tested before its events are handed to anything ═══
// One chat channel's live events, handed to the bridge's own timeline handler as the SDK does (`liveEvent`), and a listener that
// records, as each one reaches it, the phase and the gate `MatrixBridge.mayAuthor()` — what the bot's sweep and runner read.
function routed(w) {
  if (!w.handlers["Room.timeline"]) { try { const p = w.MB.start(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  const ROOM = { roomId: "!chat:hs", name: "chat-uncategorized" };
  const heard = [];
  w.MB.onRawEvent((raw) => { if (raw && raw.room_id === ROOM.roomId) heard.push({ id: raw.event_id, phase: w.S.phase(), may: w.may(), lines: w.lines.length }); });
  const ev = (id) => ({ getId: () => id, status: null, getContent: () => ({ msgtype: "m.text", body: "hi" }), getType: () => "m.room.message",
    getSender: () => "@dj:hs", getTs: () => w.t(), getUnsigned: () => ({}), getAssociatedId: () => null, getRoomId: () => ROOM.roomId });
  const deliver = (ids) => { for (const id of ids) for (const h of (w.handlers["Room.timeline"] || [])) h(ev(id), ROOM, false, false, { liveEvent: true }); };
  return { heard, deliver };
}
{ // G1 — after a silent gap longer than SLEEP_MS
  const w = world(); const L = listen(w);
  wired(w, "G");
  const R = routed(w);
  ok((w.handlers["Room.timeline"] || []).length === 1, "G PREMISE — the bridge's live timeline handler is the one `start()` registers",
    Object.keys(w.handlers));
  const lines0 = w.lines.length;
  w.adv(w.S.SLEEP_MS + 30 * SEC);          // the machine slept (or Chrome froze the tab): no beat, no answer
  ok(w.S.phase() === "live" && L.told.length === 0, "G PREMISE — the gap is over SLEEP_MS and nothing has looked yet: the tab still reads LIVE", w.S.phase());
  R.deliver(["$a1", "$a2", "$a3"]);        // the first answer's events, handed out before the SDK says SYNCING
  ok(R.heard.length === 3, "G PREMISE — the listener heard the answer's three events through the real handler", R.heard);
  ok(R.heard.length === 3 && R.heard.every((x) => x.phase === "suspended" && !x.may),
    "G1: A TAB THAT SLEPT DOES NOT ACT ON THE FIRST ANSWER AFTER WAKING — it is suspended, and may not author, before any of the " +
    "answer's events reaches a listener (on `ddjp_644` they reached the bot's sweep and runner while it still read LIVE)", R.heard);
  const sus = w.lines.findIndex((m, i) => i >= lines0 && /^Session: suspended \(was live\) — .*the machine slept or the page was frozen/.test(m));
  ok(sus >= 0 && R.heard.length && sus < R.heard[0].lines,
    "G1: and the Session line comes first — `Session: suspended … the machine slept or the page was frozen`, before anything heard the answer",
    { suspendedAt: sus, firstHeardAfterLine: R.heard.length ? R.heard[0].lines : null });
  w.answer();                              // the SDK's SYNCING for the same answer
  ok(L.told.length === 1, "G1: the sleep is told once, not again by the answer that follows its events", L.told.length);
  const after = [w.S.phase()];
  for (let i = 0; i < 3 && w.S.phase() !== "live"; i++) { w.adv(5 * SEC); w.beat(); after.push(w.S.phase()); }
  ok(after.indexOf("catching-up") >= 0 && w.S.phase() === "live" && w.may(),
    "G1: and then it catches up and settles as before — through CATCHING-UP to LIVE, on its next signs of life over a quiet log", after);
}
{ // G2 — THE CONTROL: an ordinary answer, no gap
  const w = world(); const L = listen(w);
  wired(w, "G2");
  const R = routed(w);
  w.adv(20 * SEC); w.answer(); w.adv(10 * SEC);
  const lines0 = w.lines.length;
  R.deliver(["$b1", "$b2", "$b3"]); w.answer();
  ok(R.heard.length === 3 && R.heard.every((x) => x.phase === "live" && x.may) && w.S.phase() === "live" && L.told.length === 0 &&
     !w.lines.slice(lines0).some((m) => /^Session: /.test(m)),
    "G2 CONTROL: AN ORDINARY ANSWER CHANGES NOTHING — its events reach the listener with the tab LIVE and allowed to author, no sleep " +
    "is told, and Session says nothing", { heard: R.heard, phase: w.S.phase(), told: L.told.length, lines: w.lines.slice(lines0) });
}
{ // G3 — THE CONTROL: an arrival during a catch-up does not settle the tab
  const w = world();
  wired(w, "G3");
  const R = routed(w);
  w.adv(10 * MIN); w.beat();               // a sleep, caught by a beat
  w.adv(5 * SEC); w.answer();              // released to CATCHING-UP
  ok(w.S.phase() === "catching-up", "G3 PREMISE — the tab is catching up after a sleep", w.S.phase());
  w.adv(3 * SEC); R.deliver(["$c1", "$c2"]);
  ok(R.heard.length === 2 && w.S.phase() === "catching-up" && R.heard.every((x) => x.phase === "catching-up" && !x.may),
    "G3 CONTROL: AN ARRIVAL DURING A CATCH-UP DOES NOT SETTLE IT — the events reach the listener with the tab still catching up; " +
    "the settle is a beat's or an answer's, never an arrival's half-way through an answer", { heard: R.heard, phase: w.S.phase() });
  w.adv(SEC); w.answer();
  ok(w.S.phase() === "live", "G3 CONTROL: and the server's answer then settles it, as before", w.S.phase());
}

if (failed) { console.log("[session-awake] " + failed + " FAILED of " + asserts); process.exit(1); }
console.log("[session-awake] PASS — a tab is behind when it has stopped hearing the world, not when it is out of sight (" + asserts +
  " assertions): hiding suspends nothing; a hidden tab whose beats come a minute apart while the server answers every 30 s stays live " +
  "and may author for fifteen minutes; a real sleep still suspends, catches up and settles; a slowed tab settles on a server answer, " +
  "not while the log grows; a sleep is told once, on a beat, on an answer and while the connection is already lost, and never for a " +
  "throttled hidden tab; and the connection's waits end on the SDK's return, or on an answer that contradicts the browser; and the first answer after a " +
  "sleep is tested before its events reach anything, so a tab that slept is suspended before the bot could act on it (ddjp_645)");
