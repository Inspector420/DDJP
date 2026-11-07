#!/usr/bin/env node
// tests/check-bot-room-seal.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend2/skeleton.js, core/backends.js
// WALL: A BOT ROOM IS NOT ASKED TO SEAL BY THE SHARED ENGINE, AND ITS HISTORY STILL PAGES (J113).
//
// A bot room seals on the runner's own beat (`runner.js` `_maybeSeal`), into `events_owner`. backend1's seal cadence was
// wired into it anyway, by `wireCheckpoints`, and with no `checkpoints_` channel to post to it said
// `SEAL asked by cadence tick — not yet — nowhere-to-post` in every bot room — noise, not breakage. The function cannot
// simply be skipped there: its first line, `_wireConcepts`, attaches the history pager, and a no-op once took the pager
// with it (`backends/backend2/transport.js`). Now the bot engine declares `peerSeals: false`, and the shared engine's seal
// is not asked in its rooms: the cadence tick is not armed, and a play folding does not ask either (measured: with the tick
// alone stopped, the first play in a bot room logged `SEAL asked by a room event — not yet — nowhere-to-post`).
//   PART A — a bot room, entered through the real switch on the bot's tab: no seal cadence tick is armed, and no seal is
//            asked — every timer period passes and a join and a play fold, with no `nowhere-to-post` or `SEAL asked` line.
//   PART B — the control: a shared room, wired by the same function, arms the tick, and its period passing asks the seal.
//            So the silence in PART A is a reading of the bot room, not of a tick that never runs.
//   PART C — the pager is still attached in the bot room: the room's own history backfill says ok, nothing says
//            `no-pager`, and filling the history's gaps is not refused for want of a pager.
//   PART D — the gate: the bot engine's descriptor declares `peerSeals: false`, the shared engine's says true, and the
//            gate reads them through the registry, failing OPEN (a wrong "no" in a shared room would stop it sealing).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const TW = require(path.join(__dirname, "_tabworld.js"));
const B = require(path.join(__dirname, "_botroom.js"));
const P = require(path.join(__dirname, "_probe-j14-card.js"));
const ROOT = path.join(__dirname, "..");
const { CH, T0, BOT } = TW;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-room-seal] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-room-seal] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

const SEAL = /SEAL asked|nowhere-to-post/;
// Every period a live timer has, three times over: whatever period the tick runs at, it passes.
function passEveryPeriod(w) {
  for (let k = 0; k < 3; k++) {
    const periods = Array.from(new Set(w.timers.live().map((t) => t.ms)));
    for (const ms of periods) { try { w.timers.fire(ms); } catch (e) {} }
  }
}
const relay = (n, body) => ({ type: "m.room.message", event_id: "$r" + n, room_id: CH.events_owner, sender: BOT,
  origin_server_ts: T0 + n * 1000, content: { body: JSON.stringify(Object.assign({ dv: 2 }, body)) } });

(async () => {
  // ═══ PART A — a bot room is not asked to seal ══════════════════════════════════════════════════
  const w = TW.realWorld();
  const l0 = w.logs.length;
  w.enter({ opening: true });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const sealTicks = (x) => x.timers.live().filter((t) => /cadence tick/.test(String(t.fn)));
  ok(sealTicks(w).length === 0, "A: no seal cadence tick is armed in a bot room — the one thing J113 stops", sealTicks(w).map((t) => t.kind + ":" + t.ms));
  passEveryPeriod(w);
  w.deliver(relay(1, { t: "ddjp.dj.join", v: "ABCDEFGHIJK", actor: "@dj1:hs", rank: 20, l: 1 }));
  w.deliver(relay(2, { t: "ddjp.dj.play", p: null, actor: "@owner:hs", rank: 100, l: 2, at: null }));
  passEveryPeriod(w);
  const st = w.sb.StreamManager.getState();
  ok(!!(st && st.nowPlaying && st.nowPlaying.song && st.nowPlaying.song.videoId === "ABCDEFGHIJK"),
    "A PREMISE — the play folded: the song is playing, so a room event that would ask the seal did arrive", st && st.nowPlaying);
  const said = w.logs.slice(l0);
  ok(!said.some((m) => /nowhere-to-post/.test(m)), "A: a bot room writes no `nowhere-to-post` line — not on the cadence " +
    "tick's period, and not on a play", said.filter((m) => SEAL.test(m)));
  ok(!said.some((m) => /SEAL asked/.test(m)), "A: nor any `SEAL asked` line — the shared engine's seal is not asked in a bot " +
    "room, whose bot seals on its own beat", said.filter((m) => SEAL.test(m)));

  // ═══ PART C — the pager is still attached ══════════════════════════════════════════════════════
  ok(said.some((m) => /MatrixBridge: history backfill ok/.test(m)) && !said.some((m) => /no-pager/.test(m)),
    "C: the bot room's own history backfill says ok, and nothing says `no-pager` — `wireCheckpoints` still runs its first " +
    "line, `_wireConcepts`, which attaches the pager", said.filter((m) => /history|pager/.test(m)));
  const g = await w.sb.History.fillGaps(1);
  ok(!!g && g.reason !== "no-pager", "C: filling the history's gaps is not refused for want of a pager", g);
  try { w.sb.Room.leave("the guard is done"); } catch (e) {}

  // ═══ PART B — the control: a shared room is asked ═════════════════════════════════════════════
  const s = B.world({ mode: "backend1", timers: true });
  ok(s.timers.live().filter((t) => /cadence tick/.test(String(t.fn))).length === 1, "B CONTROL — a shared room has its seal cadence " +
    "tick armed, so PART A's \"none\" is a reading of the bot room");
  const s0 = s.logs.length;
  passEveryPeriod(s);
  ok(s.logs.slice(s0).some((m) => /SEAL asked by cadence tick/.test(m)), "B CONTROL — a shared room, wired by the same " +
    "`wireCheckpoints`, arms the cadence tick, and its period passing asks the seal: so PART A's silence is a reading of " +
    "the bot room", s.logs.slice(s0).filter((m) => SEAL.test(m)));

  // ═══ PART D — the gate ═══════════════════════════════════════════════════════════════════════
  const reg = { B1MatrixAccount: {}, B1Capabilities: {}, console, Logger: { info() {}, warn() {} } };
  vm.createContext(reg);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "core/backends.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(ROOT, "backends/backend2/skeleton.js"), "utf8") + "\n;globalThis.__B = Backends;", reg);
  const d2 = reg.__B.describe("backend2");
  ok(!!d2 && d2.peerSeals === false, "D: the bot engine declares that its members do not seal (`peerSeals: false`)", d2);
  const ex = P.extractNamed("backends/backend1/matrixbridge.js", "_enginePeerSeals");
  ok(ex.ok, "D stage — the gate `_enginePeerSeals` is read from the bridge (" + ex.stage + ")");
  if (ex.ok) {
    const run = (backends) => {
      const box = backends ? { Backends: backends } : {};
      vm.createContext(box);
      vm.runInContext(ex.source + ";globalThis.__g = _enginePeerSeals;", box);
      return box.__g();
    };
    const bound = (mode) => ({ active: () => mode, describe: (m) => reg.__B.describe(m) });
    const shared = { active: () => "backend1", describe: () => ({ id: "backend1", peerSeals: true }) };
    ok(run(bound("backend2")) === false, "D: in a bot room the gate says its members do not seal");
    ok(run(shared) === true, "D: in a shared room it says they do");
    ok(run(null) === true && run({ active: () => { throw new Error("x"); }, describe: () => null }) === true,
      "D: and with no registry, or one that throws, it fails OPEN, to yes");
  }

  _finished = true;
  if (failed) { console.log("[bot-room-seal] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[bot-room-seal] PASS — a bot room is not asked to seal by the shared engine, and its history still pages " +
    "(J113): entered through the real switch on the bot's tab, every timer period passes and a join and a play fold " +
    "with no `nowhere-to-post` or `SEAL asked` line, while a shared room wired by the same function is asked on the " +
    "tick's period (the control); the bot room's backfill says ok and its gaps are not refused for want of a pager; and " +
    "the gate reads the engine's `peerSeals`, failing open (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[bot-room-seal] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
