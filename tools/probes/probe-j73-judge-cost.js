// tools/probes/probe-j73-judge-cost.js
// SUBJECT: backends/backend2/authority.js evaluate (J73 job 2) — what asking the reducer costs.
// QUESTION (audit of job 2): `evaluate` folds the bot's whole held log plus its committed acts on
// every relayed intent, and `_committedFor` scans the log. A bot room's held log grows all session
// until job 7 moves it on. How long does one judgement take at realistic long-session sizes?
// A busy song here brings 1 play, 12 votes and 1 automatic re-join (about 225 events an hour at 15
// songs an hour): ~5,400 a day, ~38,000 a week. The real `evaluate`, the real reducer, timed.
// A MEASUREMENT: exits 0 unless a premise fails.   node tools/probes/probe-j73-judge-cost.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
  "backends/backend2/streammanager.js", "backends/backend2/authority.js"], {});
const { StateDeriver: SD, B2Authority: AU, Ranks: R } = sb;
const PLY = R.levelOf("player"), OWN = R.levelOf("owner");
let bad = 0;
function premise(c, m, d) { if (!c) { bad++; console.log("PREMISE FAILED — " + m + (d ? " :: " + JSON.stringify(d) : "")); } }
function logOf(n) {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: SD.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, k = 0;
  const DJS = 8, LIS = 12;
  for (let d = 0; d < DJS; d++) for (let j = 0; j < 2; j++)
    ev.push(F.reducerEvent("$a" + (k++), l++, ts += 10, "@dj" + d + ":hs", PLY, { t: "ddjp.dj.join", v: "v" + String(k).padStart(10, "0") }));
  let song = 0;
  while (ev.length < n) {
    const pi = "$p" + song;
    ev.push(F.reducerEvent(pi, l++, ts += 240000, "@dj0:hs", PLY, { t: "ddjp.dj.play", p: prev }));
    prev = pi;
    for (let i = 0; i < LIS && ev.length < n; i++)
      ev.push(F.reducerEvent("$v" + song + "_" + i, l++, ts += 5000, "@l" + i + ":hs", PLY, { t: "ddjp.dj.vote", p: pi }));
    ev.push(F.reducerEvent("$r" + song, l++, ts += 10, "@dj" + (song % DJS) + ":hs", PLY, { t: "ddjp.dj.join", v: "v" + String(k++).padStart(10, "0") }));
    song++;
  }
  return { ev: ev.slice(0, n), last: prev };
}
const ms = (f) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log("held log | one judgement, median (ms) | worst of 15 | 12-vote burst with acts committed (ms total) | live song");
for (const n of [1000, 5400, 10000, 25000, 38000, 50000]) {
  const { ev, last } = logOf(n);
  const state = SD.derive(ev, undefined);
  premise(state.nowPlaying && state.nowPlaying.pi === last, "the fixture's chain must hold, or the fold measured is not a room", { n, np: state.nowPlaying && state.nowPlaying.pi, last });
  AU.reset();
  const one = [];
  for (let i = 0; i < 15; i++) one.push(ms(() => AU.evaluate({ t: "ddjp.dj.vote", p: last, actor: "@x" + i + ":hs" }, state, PLY, { log: ev, seed: undefined })));
  AU.reset();
  const burst = ms(() => {
    for (let i = 0; i < 12; i++) {
      const it = { t: "ddjp.dj.vote", p: last, actor: "@b" + i + ":hs" };
      const v = AU.evaluate(it, state, PLY, { log: ev, seed: undefined });
      if (v.ok) AU.submit(AU.stamp({ t: it.t, p: it.p }, it.actor, PLY, "$src" + i, null));
    }
  });
  const v = AU.evaluate({ t: "ddjp.dj.vote", p: last, actor: "@check:hs" }, state, PLY, { log: ev, seed: undefined });
  premise(v.ok === true, "a vote on the live song must be accepted, or the timing is of a refusal path", v);
  console.log(String(n).padStart(8) + " | " + median(one).toFixed(1).padStart(26) + " | " + Math.max(...one).toFixed(1).padStart(11) +
    " | " + burst.toFixed(0).padStart(46) + " | " + (state.nowPlaying && state.nowPlaying.pi));
}
AU.reset();

// ── WITH MOVING ON (J73 job 7) ──────────────────────────────────────────────────────────────
// The same busy room, through the REAL bot door, sealing a real save point every 40 relays as the
// runner does; the door moves on to each. The held log — and the judge's cost — should stay flat.
{
  const MV = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "backends/backend1/history.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
    "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js"], {});
  const D = MV.B2StreamManager, B1 = MV.B1StreamManager, A2 = MV.B2Authority, CPm = MV.B2Checkpoint;
  D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); MV.History.reset();
  const rel = (id, l, ts, actor, body) => ({ event_id: id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: ts,
    content: { body: JSON.stringify(Object.assign({ l: l, actor: actor, rank: actor === "@owner:hs" ? OWN : PLY }, body)) } });
  let l = 1, ts = 1000, prev = null, k = 0, song = 0, n = 0, sinceSeal = 0, opened = false, maxHeld = 0;
  const feed = (r) => {
    D.ingest(r); n++; sinceSeal++;
    if (sinceSeal >= 40) {
      const log = B1.getLog(), last = log[log.length - 1];
      const seed = MV.StateDeriver.buildSeed(log, B1.floorSeed() || undefined);
      const c = CPm.seal(seed, { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
      D.ingest({ event_id: "$cp" + last.l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: last.ts + 1,
                 content: { body: JSON.stringify(Object.assign({}, c, { l: last.l + 1 })) } });
      l = last.l + 2; sinceSeal = 0;
      if (!opened) { D.openFromSavePoint(); opened = true; }
    }
    maxHeld = Math.max(maxHeld, B1.getLog().length);
  };
  feed(rel("$s", l++, ts, "@owner:hs", { t: "ddjp.room.settings", s: SD.defaultSettings() }));
  for (let d = 0; d < 8; d++) for (let j = 0; j < 2; j++) feed(rel("$a" + (k++), l++, ts += 10, "@dj" + d + ":hs", { t: "ddjp.dj.join", v: "v" + String(k).padStart(10, "0") }));
  console.log("\nWITH MOVING ON — relays | held log now | held log max so far | one judgement median (ms) | 12-vote burst (ms) | moved on");
  for (const target of [5400, 38000, 50000]) {
    while (n < target) {
      const pi = "$p" + song;
      feed(rel(pi, l++, ts += 240000, "@dj0:hs", { t: "ddjp.dj.play", p: prev })); prev = pi;
      for (let i = 0; i < 12 && n < target; i++) feed(rel("$v" + song + "_" + i, l++, ts += 5000, "@l" + i + ":hs", { t: "ddjp.dj.vote", p: pi }));
      feed(rel("$r" + song, l++, ts += 10, "@dj" + (song % 8) + ":hs", { t: "ddjp.dj.join", v: "v" + String(k++).padStart(10, "0") }));
      song++;
    }
    const st = B1.getState(), ctx = () => ({ log: B1.getLog(), seed: B1.floorSeed() || undefined });
    A2.reset();
    const one = []; for (let i = 0; i < 15; i++) one.push(ms(() => A2.evaluate({ t: "ddjp.dj.vote", p: prev, actor: "@x" + i + ":hs" }, st, PLY, ctx())));
    A2.reset();
    const burst = ms(() => { for (let i = 0; i < 12; i++) { const it = { t: "ddjp.dj.vote", p: prev, actor: "@b" + i + ":hs" };
      if (A2.evaluate(it, st, PLY, ctx()).ok) A2.submit(A2.stamp({ t: it.t, p: it.p }, it.actor, PLY, "$src" + i, null)); } });
    const mo = D.lastMoveOn();
    premise(mo && mo.ok === true, "the door must be moving on, or the held log measured is not the bounded one", mo);
    premise(st.nowPlaying && st.nowPlaying.pi === prev, "the room's chain must hold through the moves", { np: st.nowPlaying && st.nowPlaying.pi, prev });
    console.log(String(n).padStart(23) + " | " + String(B1.getLog().length).padStart(12) + " | " + String(maxHeld).padStart(19) +
      " | " + median(one).toFixed(2).padStart(26) + " | " + burst.toFixed(1).padStart(18) + " | " + (mo && mo.ok));
  }
  A2.reset();
}
console.log(bad ? "VOID — " + bad + " premise(s) failed" : "MEASURED");
process.exit(bad ? 1 : 0);
