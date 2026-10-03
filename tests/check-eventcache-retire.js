// tests/check-eventcache-retire.js
// SUBJECT: backends/backend1/eventcache.js, backends/backend1/streammanager.js
// WALL: THE RAW CACHE LETS GO OF WHAT IS BANKED, AS SOON AS IT IS (J73, owner's order after job 8).
//   EventCache evicted only above 200 MB / 200,000, so a banked raw stayed until the cap, and `ensureLoaded`
//   restored every one on every reload, for every room the device had visited (`probe-j73-eventcache-memory`:
//   all 3,000 of 3,000 kept after a trim, all restored). Ruling 1: forget as it goes, whenever it is safe.
//   PART A — a decentralized room: after a licensed trim every banked raw goes, votes included, from memory and
//            from IndexedDB; what lies above the floor, and the settings event the seed names, stay.
//   PART B — a bot room: the same each time it moves on to a save point.
//   PART C — another room's raws are never judged against this room's floor.
//   PART D — a floor that is not licensed retires nothing.
//   PART E — a reload restores only what is left.
//   PART F — over a long session the cache stays bounded, not growing to the cap.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const fs = require("fs");
// THE WIRING AS SHIPPED: the engine announces `ddjp.local.forgot`; the bridge subscribes the cache to it.
const MBS = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const WIRE = MBS.slice(MBS.indexOf("  let _cacheRetireWired = false;"), MBS.indexOf("\n  }\n", MBS.indexOf("  function _wireCacheRetire()")) + 4);
const wire = (sb) => new Function("StreamManager", "EventCache", WIRE + "\nreturn _wireCacheRetire;")(sb.StreamManager, sb.EventCache)();
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[eventcache-retire] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[eventcache-retire] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/vouch.js",
  "backends/backend1/streammanager.js", "backends/backend1/eventcache.js"];
const idb = (map) => ({ supported: () => true, set: (s, k, v) => { map.set(k, v); return Promise.resolve(); },
  del: (s, k) => { map.delete(k); return Promise.resolve(); }, values: () => Promise.resolve(Array.from(map.values())) });
const MIN = 60000, P = F.RANK.player, O = F.RANK.owner;
function events(S, n) {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, k = 0, song = 0;
  for (let d = 0; d < 4; d++) for (let j = 0; j < 2; j++) ev.push(F.reducerEvent("$a" + (k++), l++, ts += 10, "@dj" + d + ":hs", P, { t: "ddjp.dj.join", v: "v" + String(k).padStart(10, "0") }));
  while (ev.length < n) {
    const pi = "$p" + song; ev.push(F.reducerEvent(pi, l++, ts += 4 * MIN, "@dj0:hs", P, { t: "ddjp.dj.play", p: prev })); prev = pi;
    for (let i = 0; i < 6 && ev.length < n; i++) ev.push(F.reducerEvent("$v" + song + "_" + i, l++, ts += 5000, "@l" + i + ":hs", P, { t: "ddjp.dj.vote", p: pi }));
    ev.push(F.reducerEvent("$r" + song, l++, ts += 10, "@dj" + (song % 4) + ":hs", P, { t: "ddjp.dj.join", v: "v" + String(k++).padStart(10, "0") }));
    song++;
  }
  return ev.slice(0, n);
}
function decentralized(grade) {
  const map = new Map();
  const sb = loadInContext(FILES, { IDB: idb(map) });
  sb.Floor.reset(); sb.StreamManager.reset(); wire(sb);
  const other = F.toRaw(F.reducerEvent("$elsewhere", 1, 500, "@x:hs", P, { t: "ddjp.dj.join" })); other.room_id = "!another-room:hs";
  sb.EventCache.store(other);                                          // a room visited before
  const EV = events(sb.StateDeriver, 200);
  for (const e of EV) { const r = F.toRaw(e); sb.StreamManager.ingest(r); sb.EventCache.store(r); }
  const ord = sb.StreamManager.getLog(), cut = ord[ord.length - 30];
  sb.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: cut.l, grade: grade, covers: ord[0].eventId + ".." + cut.eventId,
    seed: sb.StateDeriver.buildSeed(ord.slice(0, ord.indexOf(cut) + 1), undefined), prev: null, thin: false });
  const dropped = sb.StreamManager.trimToFloor();
  const above = ord.slice(ord.indexOf(cut) + 1).map((e) => e.eventId);
  return { sb, map, dropped, above, cut };
}
(async () => {
  // ── PARTs A, C ────────────────────────────────────────────────────────────────────────────
  {
    const { sb, map, dropped, above, cut } = decentralized("verified");
    ok(dropped > 0 && sb.StreamManager.seedValidation().status === "validated", "A PREMISE — a licensed trim happened", { dropped });
    const held = sb.EventCache.values().map((r) => r.event_id);
    const expect = new Set(above.concat(["$s", "$elsewhere"]));       // above the floor; the named settings event; the other room's
    ok(held.length === expect.size && held.every((id) => expect.has(id)),
      "A: every banked raw is gone — plays, joins and votes alike — and what is above the floor stays", { held: held.length, expect: expect.size, extra: held.filter((id) => !expect.has(id)).slice(0, 5) });
    ok(held.indexOf("$s") >= 0, "A: the settings event the seed names is kept — it is pinned");
    ok(map.size === held.length && held.every((id) => map.has(id)), "A: and IndexedDB holds exactly what memory does — the banked raws left it too", { idb: map.size, mem: held.length });
    ok(held.indexOf("$elsewhere") >= 0, "C: another room's raw is untouched — it is never judged against this room's floor");
    // ── PART E ──
    const sb2 = loadInContext(FILES, { IDB: idb(map) });
    await sb2.EventCache.ensureLoaded();
    ok(sb2.EventCache.values().length === held.length, "E: a reload restores only what is left, not every raw ever seen", sb2.EventCache.values().length);
  }
  // ── PART D ──────────────────────────────────────────────────────────────────────────────────
  {
    const { sb, dropped } = decentralized("stale");
    ok(dropped === 0 && sb.EventCache.values().length === 201, "D: a floor that earns no forgetting retires nothing from the cache", { dropped, held: sb.EventCache.values().length });
  }
  // ── PARTs B, F — a bot room, moving on through a long session ──────────────────────────────
  {
    const map = new Map();
    const sb = loadInContext(FILES.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), { IDB: idb(map) });
    const D = sb.B2StreamManager, B1 = sb.B1StreamManager;
    D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.History.reset(); wire(sb);
    const EV = events(sb.StateDeriver, 1600);
    let k = 0, opened = false, maxHeld = 0, moved = 0;
    for (const e of EV) {
      const r = { event_id: e.eventId, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: e.ts,
        content: { body: JSON.stringify(Object.assign({}, e.content, { l: e.l, actor: e.sender, rank: e.senderRank })) } };
      D.ingest(r); sb.EventCache.store(r);
      if (++k % 40 === 0) {
        const log = B1.getLog(), last = log[log.length - 1];
        const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
        const cr = { event_id: "$cp" + last.l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: last.ts + 1, content: { body: JSON.stringify(Object.assign({}, c, { l: last.l + 1 })) } };
        D.ingest(cr); sb.EventCache.store(cr);
        if (!opened) { D.openFromSavePoint(); opened = true; } else if (D.lastMoveOn() && D.lastMoveOn().ok) moved++;
      }
      maxHeld = Math.max(maxHeld, sb.EventCache.values().length);
    }
    ok(moved > 10, "B PREMISE — the door moved on many times", moved);
    const held = sb.EventCache.values().length;
    ok(held < 120 && map.size === held, "B: after each move the bot room's banked raws are gone from memory and IndexedDB", { held, idb: map.size, relays: EV.length });
    ok(maxHeld < 160, "F: over a long session the cache stays within a few save-point intervals — it does not grow to the cap", { maxHeld, relays: EV.length });
  }
  // ── PART G — the bridge wires the cache to the engine's announcement, once ─────────────────
  ok(/\n      _wireCacheRetire\(\);/.test(MBS) && !/EventCache/.test(fs.readFileSync(path.join(__dirname, "..", "backends/backend1/streammanager.js"), "utf8").replace(/\/\/[^\n]*/g, "")),
    "G: the bridge wires the cache to the engine's announcement, and the engine itself never names the cache");
})().then(done, (e) => { failed++; console.log("[eventcache-retire] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[eventcache-retire] " + failed + " failure(s)"); process.exit(1); }
  console.log("[eventcache-retire] PASS — the raw cache lets go of what is banked as soon as it is (J73): after a licensed trim or a " +
    "save point adopted, every banked raw of that room leaves memory and IndexedDB, votes included; the pinned settings event, " +
    "what lies above the floor and other rooms' raws stay; an unlicensed floor retires nothing; a reload restores only what is " +
    "left; and a long bot session stays bounded (" + asserts + " assertions)");
  process.exit(0);
}
