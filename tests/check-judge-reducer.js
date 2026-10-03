// tests/check-judge-reducer.js
// SUBJECT: backends/backend2/authority.js, backends/backend2/runner.js
// WALL: THE BOT'S JUDGE REFUSES WHAT THE REDUCER WOULD REFUSE (J73 job 2, Q3).
//
// `tools/probes/probe-j73-refused-relay.js` drove it: a VIP pressing Skip as the song changes was
// relayed — `B2Authority.evaluate` asked about RANK only — and the reducer then refused it
// (`advance-locked`). So the bot's log carried a refused act, and its background read, which cannot
// judge legality, counted it. Q3: the judge refuses what the reducer would refuse, so the log carries
// accepted acts only. It folds the held log, PLUS what the bot has already committed to send, plus the
// candidate — and lets a refusal about TIMING through, because the relay lands later than it is judged.
//   PART A — the stale skip is refused; a skip of the live song is not.
//   PART B — an act depending on one the bot has committed to but not yet echoed is NOT refused.
//   PART C — a refusal about timing ("too-early") does not refuse: the relay lands later.
//   PART D — through the runner's real judge path: the stale skip is refused, not relayed.
//   PART E — committed acts are cleared on room entry.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[judge-reducer] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// A GUARD THAT NEVER FINISHES IS NOT A PASS (J73 job 4, found by `mutate-j73-windows` W12). Its rows
// run in an async block; a promise that never settles stopped it before its verdict, and Node then
// exited 0 — so a mutation that hung the code under test read GREEN. Exiting unfinished fails.
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[judge-reducer] FAIL — the guard did not finish: a promise " +
  "never settled, so its rows are not a reading"); process.exitCode = 1; } });
function room() {
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
    "backends/backend2/streammanager.js", "backends/backend2/authority.js"], {});
  const R = sb.Ranks, B1 = sb.B1StreamManager;
  const PLY = R.levelOf("player"), OWN = R.levelOf("owner");
  B1.reset();
  [F.reducerEvent("$s1", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
   F.reducerEvent("$j1", 2, 2000, "@dj1:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000A" }),
   F.reducerEvent("$j2", 3, 3000, "@dj2:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000B" }),
   F.reducerEvent("$play1", 4, 10000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: null }),
   F.reducerEvent("$play2", 5, 20000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: "$play1" })].forEach((e) => B1.ingest(F.toRaw(e)));
  const ctx = () => ({ log: B1.getLog(), seed: undefined });
  const judge = (intent, actor, rank) => sb.B2Authority.evaluate(Object.assign({}, intent, { actor: actor }), B1.getState(), rank, ctx());
  return { sb, judge, PLY, VIP: R.levelOf("vip"), B1 };
}
{
  const w = room();
  ok(w.B1.getState().nowPlaying && w.B1.getState().nowPlaying.pi === "$play2", "PREMISE — the room has moved on to the second song");
  const stale = w.judge({ t: "ddjp.dj.skip", p: "$play1" }, "@v:hs", w.VIP);
  ok(stale.ok === false, "A: a VIP's skip naming the song that has just ended is refused, as the reducer would", stale);
  const live = w.judge({ t: "ddjp.dj.skip", p: "$play2" }, "@v:hs", w.VIP);
  ok(live.ok === true, "A CONTROL: the same VIP's skip of the live song is not refused", live);
}
{
  const w = room();
  const bareDeclare = w.judge({ t: "ddjp.dj.declare", v: "vid0000000N" }, "@n:hs", w.PLY);
  ok(bareDeclare.ok === false, "B CONTROL: a declare from someone not in the room is refused — the judge does read the reducer", bareDeclare);
  const w2 = room();
  // Adding a song is a join CARRYING a video: that puts them in the rotation. (A bare join does not,
  // so a declare after one is refused for a real reason — this row's first draft used one.)
  w2.sb.B2Authority.submit(w2.sb.B2Authority.stamp({ t: "ddjp.dj.join", v: "vid0000000M" }, "@n:hs", w2.PLY, "$src-n", null));
  const after = w2.judge({ t: "ddjp.dj.declare", v: "vid0000000N" }, "@n:hs", w2.PLY);
  ok(after.ok === true, "B: once the bot has committed to their join, the declare that follows is NOT refused — no false refusal while it echoes", after);
}
{
  const w = room();
  const early = w.judge({ t: "ddjp.dj.play", p: "$play2" }, "@dj2:hs", w.PLY);
  // CHANGED BY J76 (owner ruling 2, `ddjp_529`): a play from anyone but the bot that is MERELY EARLY is ignored in silence
  // — honest apps send one only `advanceBackupMs` overdue. The protective point holds: no false refusal is sent for it.
  ok(early.ok === false && early.silent === true && early.code === "too-early",
    "C: a play judged before its gate is IGNORED in silence — not relayed, and no refusal sent (J76)", early);
}
// ── PARTs D, E — through the runner's REAL judge path ───────────────────────────────────────
// D was a text search for `getLog()` near the call, which layout could satisfy. Now a real B2Runner,
// started with a stub transport, receives a person's intent through `_onRaw` — the route every intent
// takes — and what it SENDS is read: a relay of the act, or the bot's refusal of it.
(async () => {
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
    "backends/backend2/streammanager.js", "backends/backend2/authority.js", "backends/backend2/runner.js"], {});
  const R = sb.Ranks, VIP = R.levelOf("vip"), PLY = R.levelOf("player"), OWN = R.levelOf("owner");
  const sent = [];
  sb.MatrixBridge = {
    mayAuthor: () => ({ ok: true }), onAuthorReady: (fn) => fn(), getMyPowerLevel: () => OWN,
    getCreateContent: () => ({ ddjp_mode: "backend2" }), getUserEffectiveRank: (sp, ch, who) => (who === "@v:hs" ? VIP : PLY),
    onRawEvent: () => {}, offRawEvent: () => {}, getUserId: () => "@bot:hs",
    sendEvent: (room, type, c) => { sent.push(Object.assign({}, c, { t: type, room })); return Promise.resolve("$ok"); },
  };
  const CH = { events_uncategorized: "!intents:hs", events_owner: "!log:hs", settings_owner: "!set:hs" };
  const settle = () => new Promise((r) => setImmediate(r));
  // The runner runs only where the bot engine is the active one; say so, as check-backends' harness does.
  sb.Backends = Object.assign({}, sb.Backends || {}, { active: () => "backend2" });
  sb.setInterval = () => 1; sb.clearInterval = () => {};          // no clock runs here, and nothing keeps the process alive
  const started = sb.B2Runner.start({ channels: CH });
  ok(started && started.ok === true, "D PREMISE — the real runner starts, or nothing below is a reading", started);
  sb.StreamManager.setFoldScope(CH);
  const relay = (id, l, ts, actor, rank, body) => ({ event_id: id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs",
    ts: ts, content: { body: JSON.stringify(Object.assign({ l: l, actor: actor, rank: rank }, body)) } });
  [relay("$c1", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
   relay("$c2", 2, 2000, "@dj1:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000A" }),
   relay("$c3", 3, 3000, "@dj2:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000B" }),
   relay("$c4", 4, 10000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: null }),
   relay("$c5", 5, 20000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: "$c4" })].forEach((r) => sb.StreamManager.ingest(r));
  const np = sb.StreamManager.getState().nowPlaying;
  ok(np && np.pi === "$c5", "D PREMISE — the bot's room has moved on to the second song", np);
  const intent = (id, body, who) => sb.B2Runner._onRaw({ type: "m.room.message", event_id: id, room_id: "!intents:hs",
    sender: who || "@v:hs", ts: 20500, content: { body: JSON.stringify(body) } });
  // What went out, one act per entry: the bot groups acts into a `ddjp.batch`, so batches are unwrapped.
  const flat = () => [].concat(...sent.map((m) => (m.t === "ddjp.batch" && Array.isArray(m.evs)) ? m.evs : [m]));
  const outFor = async (id, body, who) => { sent.length = 0; intent(id, body, who); try { sb.B2Authority.flush(); } catch (e) {} await settle(); return flat(); };
  const isRelayOf = (m, p) => m.t === "ddjp.dj.skip" && m.p === p;
  const refusedOf = (m) => m.t === "ddjp.bot.refused" && m.of === "ddjp.dj.skip";
  const stale = await outFor("$i1", { t: "ddjp.dj.skip", p: "$c4" });
  ok(!stale.some((m) => isRelayOf(m, "$c4")) && stale.some(refusedOf),
    "D: through the runner, a VIP's skip naming the song that just ended is REFUSED, not relayed", stale);
  const live = await outFor("$i2", { t: "ddjp.dj.skip", p: "$c5" });
  ok(live.some((m) => isRelayOf(m, "$c5")), "D CONTROL: through the runner, the same VIP's skip of the live song IS relayed", live);
  // E — committed acts do not survive room entry (`B2Runner.start` calls `B2Authority.reset`).
  sb.B2Authority.submit(sb.B2Authority.stamp({ t: "ddjp.dj.join", v: "vid0000000M" }, "@n:hs", PLY, "$src-n", null));
  const judge = () => sb.B2Authority.evaluate({ t: "ddjp.dj.declare", v: "vid0000000N", actor: "@n:hs" },
    sb.StreamManager.getState(), PLY, { log: sb.StreamManager.getLog(), seed: undefined });
  ok(judge().ok === true, "E PREMISE — while the join is committed, the declare after it is judged on it");
  sb.B2Runner.stop();
  const again = sb.B2Runner.start({ channels: CH });
  ok(again && again.ok === true && !again.already, "E PREMISE — the runner entered the room afresh", again);
  ok(judge().ok === false, "E: after room entry the previous room's committed acts are gone — the declare is judged on the room alone", judge());
  sb.B2Runner.stop();
  finish();
})().catch((e) => { failed++; console.log("[judge-reducer] FAIL — D/E threw: " + (e && e.stack || e)); finish(); });
function finish() {
  _finished = true;
if (failed) { console.log("[judge-reducer] " + failed + " failure(s)"); process.exit(1); }
console.log("[judge-reducer] PASS — the bot's judge refuses what the reducer would refuse (J73 job 2, Q3): a stale skip is " +
  "refused and a live one is not, an act depending on one the bot has committed to is not falsely refused while it " +
  "echoes, and a refusal about timing lets the relay through (" + asserts + " assertions)");
  process.exit(failed ? 1 : 0);
}
