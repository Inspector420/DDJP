#!/usr/bin/env node
// tests/check-bot-entry-replay.js
// SUBJECT: features/room.js, features/botruntime.js
// WALL: THE BOT READS JOIN TIMES FROM THE REPLAYED ROOM, NOT FROM AN EMPTY ONE (J115, item 4).
//
// On room entry the bot starts inside the opening's wiring, before the channels are replayed — on purpose, so it hears
// the room's live requests from the moment the room is entered. Its seed of who joined when (`StreamManager.rotationEntries`)
// then read an empty log, and replayed events never reach the raw listeners, so it learned nothing more until the first
// live event, which stamped the WHOLE rotation as arriving at that moment: after every reload the AFK clock started again
// for everybody. Now the room tells the bot the replay is pending, and `_startModules` — which runs only once the history
// is in — has the bot read the join times again.
//
// Driven on the bot's own tab (`tests/_tabworld.js`: the real `features/room.js`, the real bot runtime, the real bot
// engine), through the real switch: the room is entered, its history is ingested the way the opening's replay ingests it
// (into the door, never to the raw listeners), and then the room starts.
//   PART A — after the opening, each DJ's join time is the time their replayed join was sent.
//   PART B — and the live watch's baseline is the replayed rotation: the next arrival is dated as one arrival, and
//            nobody already in moves.
//   PART C — a live event that lands DURING the replay is not a join time (`ddjp_620`). The bot hears the room while the
//            replay runs; a live event that arrives once the replay has put a DJ in the rotation stamps that DJ with the
//            event's time. For a DJ whose join the log no longer reaches (the room opened from a save point that holds
//            them), the replayed queue has no join time to give, so after the replay they read as unknown — the read
//            starts again from nothing, rather than keeping the live stamp.
"use strict";
const path = require("path");
const TW = require(path.join(__dirname, "_tabworld.js"));
const { CH, T0, BOT } = TW;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-entry-replay] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-entry-replay] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

// A DJ relayed into the room's log, as the runner writes it (the same shape `check-room-leave` uses).
const relay = (n, l) => ({ type: "m.room.message", event_id: "$r" + n, room_id: CH.events_owner, sender: BOT, origin_server_ts: T0 + n * 1000,
  content: { body: JSON.stringify({ t: "ddjp.dj.join", v: "ABCDEFGHIJ" + n, actor: "@dj" + n + ":hs", rank: 20, l: l, dv: 2 }) } });

(async () => {
  const w = TW.realWorld();
  const BR = w.sb.BotRuntime;
  let ingestedBeforeStart = null;
  w.enter({ opening: true, replay: () => {
    // THE OPENING'S REPLAY: into the door, not to the listeners (`replayRoom` folds with isLive false).
    w.live(relay(1, 1)); w.live(relay(2, 2));
    ingestedBeforeStart = (w.sb.StreamManager.getState().rotation || []).map((m) => m.user);
  } });
  ok(Array.isArray(ingestedBeforeStart) && ingestedBeforeStart.indexOf("@dj1:hs") >= 0 && ingestedBeforeStart.indexOf("@dj2:hs") >= 0,
    "PREMISE — the replay stand-in put both DJs in the rotation before the room started; otherwise nothing below has a " +
    "history to read", ingestedBeforeStart);
  ok(BR.status && BR.status().running !== false, "PREMISE — the bot is running on its own tab", BR.status && BR.status());

  // ═══ PART A — join times come from the replayed room ═══════════════════════════════════════════
  ok(BR.enteredAt("@dj1:hs") === T0 + 1000 && BR.enteredAt("@dj2:hs") === T0 + 2000,
    "A: after the opening, each DJ's join time is when their replayed join was sent — it was unknown (the seed read an " +
    "empty log before the replay)", { dj1: BR.enteredAt("@dj1:hs"), dj2: BR.enteredAt("@dj2:hs") });
  ok(w.logs.some((m) => /BotRuntime: join times are read once the room is replayed/.test(m)) &&
     !w.logs.some((m) => /BotRuntime: replayed the queue — 0 member\(s\)/.test(m)),
    "A: at the room's entry, before the replay, the bot says it will read join times once the room is replayed — it " +
    "said it had replayed the queue and found nobody", w.logs.filter((m) => /BotRuntime: (replayed|join times)/.test(m)));
  ok(w.logs.some((m) => /BotRuntime: replayed the queue — 2 member\(s\) with a known join time/.test(m)),
    "A: and the bot says so once the replay is done, naming the two it read",
    w.logs.filter((m) => /BotRuntime: (replayed|join times)/.test(m)));

  // ═══ PART B — the baseline is the replayed rotation ════════════════════════════════════════════
  w.deliver(relay(3, 3));                                    // a LIVE arrival after the room started
  await new Promise((r) => setImmediate(r));
  ok(BR.enteredAt("@dj3:hs") === T0 + 3000, "B: the next arrival is dated by its own join", BR.enteredAt("@dj3:hs"));
  ok(BR.enteredAt("@dj1:hs") === T0 + 1000 && BR.enteredAt("@dj2:hs") === T0 + 2000,
    "B: and nobody already in moves — the first live event no longer reads as the whole room joining at once",
    { dj1: BR.enteredAt("@dj1:hs"), dj2: BR.enteredAt("@dj2:hs") });

  try { w.sb.Room.leave("the guard is done"); } catch (e) {}

  // ═══ PART C — a live stamp made during the replay is not a join time ═══════════════════════════
  // A second tab world. Its replay brings dj4 in and then opens from a save point that holds dj4, so dj4's join is below
  // the cut and gone from the held log, as in a room whose log no longer reaches back to that join. Two live chat messages
  // land while it runs: one before the history is in, which sets the watch's baseline, and one after, which stamps dj4.
  {
    const w2 = TW.realWorld();
    const BR2 = w2.sb.BotRuntime, SM2 = w2.sb.StreamManager;
    const talk = (n, ts) => ({ type: "m.room.message", event_id: "$talk" + n, room_id: CH.chat_uncategorized, sender: "@listener:hs",
      origin_server_ts: ts, content: { msgtype: "m.text", body: "hello " + n } });
    let opened = null, stamped = null, heldIds = null, rot = null;
    w2.enter({ opening: true, replay: () => {
      w2.deliver(talk(1, T0 + 500));                         // LIVE, before the history is in
      w2.live(relay(4, 1));                                  // dj4's join, replayed
      const log = SM2.getLog(), head = log[log.length - 1];
      const seed = w2.sb.StateDeriver.buildSeed(log, undefined);
      const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: head.l, thin: false, covers: head.eventId, l: head.l + 1, dv: 2, hv: 1 };
      cp.h = w2.sb.CheckpointFormat.fingerprint(1, null, seed, head.l, false, head.eventId);
      w2.live({ type: "m.room.message", event_id: "$cp1", room_id: CH.events_owner, sender: BOT, origin_server_ts: T0 + 4500,
        content: { body: JSON.stringify(cp) } });
      opened = SM2.openFromSavePoint();                      // the opening, from the save point: dj4's join is below its cut
      heldIds = SM2.getLog().map((e) => e.eventId);
      rot = (SM2.getState().rotation || []).map((m) => m.user);
      w2.deliver(talk(2, T0 + 9000));                        // LIVE, with dj4 now in the rotation
      stamped = BR2.enteredAt("@dj4:hs");
    } });
    ok(!!(opened && opened.ok) && Array.isArray(rot) && rot.indexOf("@dj4:hs") >= 0 && Array.isArray(heldIds) && heldIds.indexOf("$r4") < 0,
      "C PREMISE — the replay opened from the save point: dj4 is in the rotation and their join is not in the held log",
      { opened, rot, heldIds });
    ok(stamped === T0 + 9000, "C PREMISE — during the replay, the live message stamped dj4 with its own time; otherwise the row " +
      "below has nothing to undo", stamped);
    ok(BR2.enteredAt("@dj4:hs") === null, "C: once the room is replayed, dj4 — whose join the log does not reach — reads as an " +
      "unknown join time, not the live message's time (the re-read starts from nothing)", BR2.enteredAt("@dj4:hs"));
    try { w2.sb.Room.leave("the guard is done"); } catch (e) {}
  }
  _finished = true;
  if (failed) { console.log("[bot-entry-replay] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[bot-entry-replay] PASS — the bot reads join times from the replayed room (J115): entered through the real " +
    "switch on its own tab, with the history ingested as the opening's replay ingests it, each DJ's join time is when " +
    "their join was sent and the bot says how many it read; the next live arrival is dated by its own join and nobody " +
    "already in moves; and a live event that stamped a DJ during the replay leaves no join time behind — a DJ whose " +
    "join the log does not reach reads as unknown once the room is replayed (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[bot-entry-replay] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
