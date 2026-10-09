// tests/check-channel-join.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: JOINING A ROOM'S CHANNELS NEVER WAITS, AND RETRIES ONLY WHEN SOMETHING CHANGES (owner's decentralized test, `ddjp_539`:
//   the bot took about 70 s to open the room — every unjoined child was retried for a minute, whatever the error, and the
//   opening awaited it). Driven through the shipped join block and `acceptChannelInvite`, against a scripted client.
//   PART A — opening returns at once, joins or not.     PART B — a normal child joins at the first attempt.
//   PART C — a 429 child: the background retry joins it.
//   PART D — a 403 child: one attempt, one warning naming it and its errcode, then WAITING — no timer retries it.
//   PART E — then a rank change, or an accepted invite: it is joined.     PART F — a demotion: the channel waits for an event.
//   PART G — the wiring: the live m.space.child handler and the rank-change hook.
"use strict";
const fs = require("fs"), path = require("path");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[channel-join] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const cut = (a, b) => { const i = MB.indexOf(a), j = MB.indexOf(b, i); return (i >= 0 && j > i) ? MB.slice(i, j) : ""; };
const SRC = cut("  const JOIN_RETRY_MS = ", "  // --- Invite ---") + cut("  async function acceptChannelInvite(", "\n  }\n") + "\n  }\n";
const tick = () => new Promise((r) => setImmediate(r));
// rules[id]: { fail: n, code: "M_LIMIT_EXCEEDED" } transient n times; { refuse: true } until allowed; { hang: true } never resolves.
function world(rules) {
  const joined = new Set(), tries = {}, logs = [], added = [], rankFns = [];
  let sleeps = 0;
  const children = Object.keys(rules);
  const room = (id) => id === "!space:hs" ? { currentState: { getStateEvents: () => children.map((k) => ({ getStateKey: () => k })) } } : { getMyMembership: () => joined.has(id) ? "join" : "leave" };
  const err = (code, status) => { const e = new Error(code); e.errcode = code; e.httpStatus = status; return e; };
  const client = { getRoom: room, joinRoom: async (id) => {
    tries[id] = (tries[id] || 0) + 1;
    if (id === "!space:hs") return;
    const r = rules[id] || {};
    if (r.hang) return new Promise(() => {});
    if (r.refuse) throw err("M_FORBIDDEN", 403);
    if ((r.fail || 0) >= tries[id]) throw err(r.code || "M_LIMIT_EXCEEDED", 429);
    joined.add(id); } };
  const Logger = { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), debug() {}, error() {} };
  const timers = new Map(); let tid = 0;   // a controllable clock for the debounced rank-change retry
  const make = new Function("client", "Logger", "waitForSpaceChildren", "setTimeout", "clearTimeout", "onRankChange", "_channelAddedListeners", "onSleep", "laterFn",
    SRC + "\n_joinSleep = () => { onSleep(); return Promise.resolve(); };\n_rankRetryLater = laterFn;\nreturn { join: joinDDJPSpace, advertised: _joinAdvertised, retry: retryWaitingJoins, waiting: waitingJoins, accept: acceptChannelInvite, pass: () => _lastJoinPass };");
  const api = make(client, Logger, async () => true, setTimeout, (h) => timers.delete(h), (fn) => rankFns.push(fn), [(id) => added.push(id)], () => { sleeps++; },
    (fn) => { const h = ++tid; timers.set(h, fn); return h; });
  const runTimers = () => { const fs = Array.from(timers.values()); timers.clear(); for (const f of fs) f(); return fs.length; };
  return Object.assign({ joined, tries, logs, added, rules, rankFns, sleeps: () => sleeps, runTimers, timers }, api);
}
(async () => {
  ok(SRC.indexOf("async function joinDDJPSpace") >= 0 && SRC.indexOf("function retryWaitingJoins") >= 0 && SRC.indexOf("async function acceptChannelInvite") >= 0, "PREMISE — the shipped join block and invite accept were found");
  // A, B
  { const w = world({ "!hang:hs": { hang: true }, "!ok:hs": {} });
    const t0 = Date.now(); const r = await w.join("!space:hs");
    ok(r === "!space:hs" && Date.now() - t0 < 200, "A: opening returns at once, though a channel's join is still in flight", Date.now() - t0);
    await tick(); ok(w.joined.has("!ok:hs") && w.tries["!ok:hs"] === 1, "B: a normal child joins at its first attempt", w.tries); }
  // C
  { const w = world({ "!busy:hs": { fail: 2, code: "M_LIMIT_EXCEEDED" } }); await w.join("!space:hs"); await w.pass();
    ok(w.joined.has("!busy:hs") && w.tries["!busy:hs"] === 3 && w.sleeps() === 2, "C: a 429 child is joined by the background retry", { tries: w.tries, sleeps: w.sleeps() }); }
  // D, E (rank change)
  { const w = world({ "!staff:hs": { refuse: true } }); await w.join("!space:hs"); await w.pass();
    const warns = w.logs.filter((l) => l[0] === "warn");
    ok(w.tries["!staff:hs"] === 1 && w.sleeps() === 0 && w.waiting().indexOf("!staff:hs") >= 0, "D: a 403 child: one attempt, no timer retry, and it waits", { tries: w.tries, sleeps: w.sleeps(), waiting: w.waiting() });
    ok(warns.length === 1 && /!staff:hs/.test(warns[0][1]) && /M_FORBIDDEN/.test(warns[0][1]), "D: one warning, naming the channel and its errcode", warns);
    for (let i = 0; i < 5; i++) await tick();
    ok(w.tries["!staff:hs"] === 1, "D: and nothing retries it by itself", w.tries);
    w.rules["!staff:hs"] = {};                                 // promoted: now allowed
    // DEBOUNCED (owner's live test: seven retries in six seconds): seven rank changes in a row, ONE retry after the last.
    for (let k = 0; k < 7; k++) for (const fn of w.rankFns) fn();
    ok(w.timers.size === 1 && w.tries["!staff:hs"] === 1, "E: seven rank changes in a row schedule ONE retry, and nothing is tried before it", { timers: w.timers.size, tries: w.tries });
    w.runTimers(); await tick(); await tick();
    ok(w.joined.has("!staff:hs") && w.tries["!staff:hs"] === 2 && w.waiting().length === 0, "E: then this account's rank changes — it is tried once more, and joined", { tries: w.tries, waiting: w.waiting() }); }
  // E (invite)
  { const w = world({ "!chat:hs": { refuse: true } }); await w.join("!space:hs"); await w.pass();
    w.rules["!chat:hs"] = {};
    const r = await w.accept("!chat:hs");
    ok(r.ok === true && w.joined.has("!chat:hs") && w.waiting().length === 0, "E: or an invite arrives and is accepted — joined, and it waits no more", { r, waiting: w.waiting() }); }
  // F — a demotion: the channel is lost and refused; it waits, and only an event tries it again
  { const w = world({ "!high:hs": {} }); await w.join("!space:hs"); await w.pass();
    ok(w.joined.has("!high:hs"), "F PREMISE — joined before the demotion");
    w.joined.delete("!high:hs"); w.rules["!high:hs"] = { refuse: true };
    for (const fn of w.rankFns) fn(); w.runTimers(); await tick();   // the demotion is itself a rank change: nothing is waiting yet
    await w.advertised("!high:hs"); await tick();               // the space advertises it again: one try, refused
    ok(w.waiting().indexOf("!high:hs") >= 0 && w.sleeps() === 0, "F: after a demotion the removed channel WAITS — no timer retries it", { waiting: w.waiting(), sleeps: w.sleeps() }); }
  // G — the wiring
  ok(/try \{ _joinAdvertised\(childId\); \}/.test(MB) && /onRankChange\(\(\) => \{ try \{ if \(_rankRetryTimer\) clearTimeout\(_rankRetryTimer\); _rankRetryTimer = _rankRetryLater\(/.test(MB),
    "G: the live m.space.child handler tries an advertised channel, and a rank change tries the waiting ones");
  // H — the opening does not wait for channels already marked WAITING (owner's live test: an 8 s timeout after both 403s)
  { const WFS = (() => { const i = MB.indexOf("  async function waitForSpaceChildren("); return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
    const mk = (waiting) => new Function("client", "Logger", "_joinWaiting", WFS + "\nreturn waitForSpaceChildren;")(
      { getRoom: (id) => id === "!space:hs" ? { currentState: { getStateEvents: () => ["!a:hs", "!w:hs"].map((k) => ({ getStateKey: () => k })) } } : (id === "!a:hs" ? {} : null) },
      { warn() {}, info() {} }, new Map(waiting ? [["!w:hs", { errcode: "M_FORBIDDEN" }]] : []));
    const t0 = Date.now(), r = await mk(true)("!space:hs", { needJoined: true, timeoutMs: 1500, intervalMs: 20 });
    ok(r.ready === true && Date.now() - t0 < 600, "H: the opening counts a channel already marked waiting — it does not wait for it", { r, ms: Date.now() - t0 });
    const r2 = await mk(false)("!space:hs", { needJoined: true, timeoutMs: 300, intervalMs: 20 });
    ok(r2.ready === false, "H CONTROL: an unjoined channel that is NOT waiting is still waited for", r2); }
})().then(() => {
  if (failed) { console.log("[channel-join] " + failed + " failure(s)"); process.exit(1); }
  console.log("[channel-join] PASS — joining never waits: refusals wait for an invite, a rank change or a re-advertisement; transient failures retry in the background (" + asserts + " assertions)");
  process.exit(0);
}, (e) => { console.log("[channel-join] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
