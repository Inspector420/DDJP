// tools/probes/probe-j73-sdk-memory.js
// SUBJECT: J73 job 8 — what the Matrix library holds in memory, in this app's default configuration.
// QUESTION (owner, `ddjp_524`): the library is left alone. How much does matrix-js-sdk hold per 1,000
// timeline events as this app runs it — `createClient` with no store (backends/backend1/matrixaccount.js),
// `startClient({ initialSyncLimit: 1 })` — and what does a bot tab hold after a day and a week?
// MEASURED, not estimated: the real library (the vendored version, 41.8.0, from node_modules), events made
// by the client's own event mapper (the path sync uses), appended to a real Room's live timeline, heap
// measured after forced GC. Needs --expose-gc:   node --expose-gc tools/probes/probe-j73-sdk-memory.js
"use strict";
(async () => {
  if (typeof global.gc !== "function") { console.log("VOID — run with node --expose-gc"); process.exit(1); }
  const sdk = await import("matrix-js-sdk");
  const ver = require("../../node_modules/matrix-js-sdk/package.json").version;
  const client = sdk.createClient({ baseUrl: "http://127.0.0.1:9", accessToken: "x", userId: "@bot:hs", deviceId: "DEV" });
  const mapper = client.getEventMapper();
  const shapes = {
    relay:  (i) => ({ msgtype: "m.text", body: JSON.stringify({ t: "ddjp.dj.vote", p: "$play" + (i >> 4) + ":hs", actor: "@listener" + (i % 12) + ":example.org", rank: 40, src: "$intent" + i + ":hs", at: null, l: 100000 + i }) }),
    intent: (i) => ({ msgtype: "m.text", body: JSON.stringify({ t: "ddjp.dj.vote", p: "$play" + (i >> 4) + ":hs", dv: 2, hv: 1 }) }),
    chat:   (i) => ({ msgtype: "m.text", body: "a typical chat line, about this long — " + i }),
  };
  const raw = (kind, i, roomId) => ({ type: "m.room.message", event_id: "$" + kind + i + "_" + Math.random().toString(36).slice(2, 10),
    room_id: roomId, sender: "@user" + (i % 40) + ":example.org", origin_server_ts: 1700000000000 + i * 1000,
    content: shapes[kind](i), unsigned: { age: 1234 } });
  const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
  const measure = (kind, n) => {
    const room = new sdk.Room("!" + kind + n + ":hs", client, "@bot:hs");
    const t0 = Date.now(); const before = heap();
    const evs = []; for (let i = 0; i < n; i++) evs.push(mapper(raw(kind, i, room.roomId)));
    room.addLiveEvents(evs, { addToState: false });
    evs.length = 0;
    const held = room.getLiveTimeline().getEvents().length;
    const after = heap();
    const kb = (after - before) / 1024 / (n / 1000);
    if (process.env.TIMING) console.log("      (" + kind + " " + n + ": " + (Date.now() - t0) + " ms)");
    return { held, kbPer1000: kb, room };
  };
  console.log("matrix-js-sdk " + ver + ", createClient with no store (store: " + (client.store && client.store.constructor && client.store.constructor.name) + ")");
  console.log("events     kind     held in the Room's live timeline   KB per 1,000 events");
  const keep = [], per = {};
  for (const kind of ["relay", "intent", "chat"]) {
    for (const n of (process.env.SIZES ? process.env.SIZES.split(",").map(Number) : [2000, 5000, 10000])) {
      const r = measure(kind, n); keep.push(r.room);
      console.log(String(n).padStart(6) + "     " + kind.padEnd(8) + " " + String(r.held).padStart(10) + "                         " + r.kbPer1000.toFixed(0));
      per[kind] = r.kbPer1000;   // the largest size measured
    }
  }
  // ── PROJECTION: a bot tab at the cost probe's busy rate ──────────────────────────────────
  // probe-j73-judge-cost's busy room: per song 1 play, 12 votes, 1 re-join; 15 songs an hour. In a bot
  // room every person's act is an INTENT the bot reads and a RELAY it writes, so the tab holds both.
  // Background fills: song history pages the events room back to the room's start once per load, capped
  // at 250 pages x 100 = 25,000 events; the activity read-back reads within the same timeline (<= 25 h).
  const perHour = { relay: 15 * 14 + 6, intent: 15 * 13 };     // relays incl. ~6 save points an hour
  const FILL = 25000;
  const proj = (hours, chatPerHour) => {
    const relays = perHour.relay * hours + FILL, intents = perHour.intent * hours, chat = chatPerHour * hours;
    const mb = (relays * per.relay + intents * per.intent + chat * per.chat) / 1024 / 1000;
    return { relays, intents, chat, mb };
  };
  console.log("\nPROJECTED bot tab (events held by the library, MB):");
  for (const [label, h] of [["one day", 24], ["one week", 168]]) for (const c of [0, 120]) {
    const p = proj(h, c);
    console.log("  " + label.padEnd(9) + " chat " + String(c).padStart(3) + "/h: " + p.relays + " relays (incl. the 25,000-event fill) + " +
      p.intents + " intents + " + p.chat + " chat = " + p.mb.toFixed(0) + " MB");
  }
  console.log("MEASURED");
  process.exit(0);
})().catch((e) => { console.log("VOID — " + (e && e.stack || e)); process.exit(1); });
