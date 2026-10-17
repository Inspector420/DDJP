// tools/probes/probe-j73-eventcache-memory.js
// SUBJECT: backends/backend1/eventcache.js — the app's own raw cache (J73, owner's order after job 8).
// QUESTION: what does EventCache hold in a long bot session and a long decentralized session, and does a
// reload restore it from IndexedDB — UNWIRED (the cache alone, as at `ddjp_524`) and WIRED through the
// bridge's shipped `_wireCacheRetire`, extracted from matrixbridge.js exactly as `check-eventcache-retire` does?
// (A first version measured the 'after' case only while the engine called the cache directly — a state
// that never shipped — so its after-figures could not be reproduced. Corrected at the `ddjp_525` audit.)
// Original question: what does EventCache hold, and does a
// reload restore it from IndexedDB? It evicts only above BYTE_CAP (200 MB) or HARD_COUNT_CAP (200,000), so
// banked raws stay until the cap. Real EventCache, Vouch, Floor and both engines; IndexedDB stubbed as an
// in-memory map; heap measured after forced GC.   node --expose-gc tools/probes/probe-j73-eventcache-memory.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
if (typeof global.gc !== "function") { console.log("VOID — run with node --expose-gc"); process.exit(1); }
// BOTH BY DEFAULT (corrected at the `ddjp_526` audit: run as documented it printed the unwired half alone, and
// nothing named the switch). With WIRED unset, it runs itself twice — the cache alone, then through the bridge.
if (process.env.WIRED === undefined) {
  const { spawnSync } = require("child_process");
  for (const w of ["0", "1"]) {
    console.log("\n── " + (w === "1" ? "WIRED: through the bridge's shipped _wireCacheRetire" : "UNWIRED: the cache alone, as at ddjp_524") + " ──");
    const r = spawnSync(process.execPath, ["--expose-gc", __filename], { env: Object.assign({}, process.env, { WIRED: w }), stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  process.exit(0);
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/vouch.js",
  "backends/backend1/streammanager.js", "backends/backend1/eventcache.js"];
const fs = require("fs");
const MBS = fs.readFileSync(path.join(__dirname, "..", "..", "backends/backend1/matrixbridge.js"), "utf8");
const WIRE = MBS.slice(MBS.indexOf("  let _cacheRetireWired = false;"), MBS.indexOf("\n  }\n", MBS.indexOf("  function _wireCacheRetire()")) + 4);
const wire = (sb) => new Function("StreamManager", "EventCache", WIRE + "\nreturn _wireCacheRetire;")(sb.StreamManager, sb.EventCache)();
const WIRED = process.env.WIRED === "1";
const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
const idb = (map) => ({ supported: () => true, set: (s, k, v) => { map.set(k, v); return Promise.resolve(); },
  del: (s, k) => { map.delete(k); return Promise.resolve(); }, values: () => Promise.resolve(Array.from(map.values())) });
const MIN = 60000, P = F.RANK.player, O = F.RANK.owner;
// A busy room as reducer events: per song a play, 12 votes, a re-add (the cost probe's rate).
function events(S, n) {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, k = 0, song = 0;
  for (let d = 0; d < 8; d++) for (let j = 0; j < 2; j++) ev.push(F.reducerEvent("$a" + (k++), l++, ts += 10, "@dj" + d + ":hs", P, { t: "ddjp.dj.join", v: "v" + String(k).padStart(10, "0") }));
  while (ev.length < n) {
    const pi = "$p" + song; ev.push(F.reducerEvent(pi, l++, ts += 4 * MIN, "@dj0:hs", P, { t: "ddjp.dj.play", p: prev })); prev = pi;
    for (let i = 0; i < 12 && ev.length < n; i++) ev.push(F.reducerEvent("$v" + song + "_" + i, l++, ts += 5000, "@l" + i + ":hs", P, { t: "ddjp.dj.vote", p: pi }));
    ev.push(F.reducerEvent("$r" + song, l++, ts += 10, "@dj" + (song % 8) + ":hs", P, { t: "ddjp.dj.join", v: "v" + String(k++).padStart(10, "0") }));
    song++;
  }
  return ev.slice(0, n);
}
const N = Number(process.env.N || 4000);
const report = (label, sb, map, h0) => {
  const plan = sb.EventCache.dryRunEviction();
  const kb = (heap() - h0) / 1024;
  console.log(label.padEnd(30) + " | held in memory " + String(plan.count).padStart(6) + " raws, " + (plan.bytes / 1024).toFixed(0).padStart(6) +
    " KB by its own count, heap +" + kb.toFixed(0).padStart(6) + " KB | in IndexedDB " + String(map.size).padStart(6) +
    " | banked (retirable) " + (plan.tiers ? plan.tiers.retirable.n : "?") + ", over cap " + plan.overCap);
  return plan;
};
// ── a long DECENTRALIZED session: every raw cached; a licensed trim at the end of it ──────────
{
  const map = new Map(), h0 = heap();
  const sb = loadInContext(FILES, { IDB: idb(map) });
  sb.Floor.reset(); sb.StreamManager.reset(); if (WIRED) wire(sb);
  const EV = events(sb.StateDeriver, N);
  for (const e of EV) { const r = F.toRaw(e); sb.StreamManager.ingest(r); sb.EventCache.store(r); }
  const ord = sb.StreamManager.getLog(), cut = ord[ord.length - 40];
  sb.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: cut.l, grade: "verified", covers: ord[0].eventId + ".." + cut.eventId,
    seed: sb.StateDeriver.buildSeed(ord.slice(0, ord.indexOf(cut) + 1), undefined), prev: null, thin: false });
  const dropped = sb.StreamManager.trimToFloor();
  const plan = report((WIRED ? "WIRED" : "UNWIRED") + " decentralized, " + N, sb, map, h0);
  console.log("  the trim dropped " + dropped + " events from the held log; the cache kept all " + plan.count + " raws, " + plan.tiers.retirable.n + " of them banked");
  // A reload: a fresh EventCache over the same IndexedDB.
  const sb2 = loadInContext(FILES, { IDB: idb(map) });
  sb2.EventCache.ensureLoaded().then(() => {
    console.log("  RELOAD: ensureLoaded() restored " + sb2.EventCache.values().length + " of " + map.size + " raws from IndexedDB into memory");
    bot();
  });
}
// ── a long BOT session: relays, save points every 40, the door moving on ──────────────────────
function bot() {
  const map = new Map(), h0 = heap();
  const sb = loadInContext(FILES.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), { IDB: idb(map) });
  const D = sb.B2StreamManager, B1 = sb.B1StreamManager;
  D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.History.reset(); if (WIRED) wire(sb);
  const EV = events(sb.StateDeriver, N);
  let k = 0, opened = false;
  for (const e of EV) {
    const r = { event_id: e.eventId, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: e.ts,
      content: { body: JSON.stringify(Object.assign({}, e.content, { l: e.l, actor: e.sender, rank: e.senderRank })) } };
    D.ingest(r); sb.EventCache.store(r);
    if (++k % 40 === 0) {
      const log = B1.getLog(), last = log[log.length - 1];
      const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
      const cr = { event_id: "$cp" + last.l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: last.ts + 1, content: { body: JSON.stringify(Object.assign({}, c, { l: last.l + 1 })) } };
      D.ingest(cr); sb.EventCache.store(cr);
      if (!opened) { D.openFromSavePoint(); opened = true; }
    }
  }
  const plan = report((WIRED ? "WIRED" : "UNWIRED") + " bot room, " + N, sb, map, h0);
  console.log("  the door holds " + B1.getLog().length + " events (it moved on); the cache kept all " + plan.count + " raws, " + plan.tiers.retirable.n + " of them banked");
  console.log("\nKEPT after the session: " + plan.count + " of " + (N + Math.floor(N / 40)) + " raws cached — " +
    (plan.count < N / 10 ? "only what lies above the last floor (banked raws are retired as they bank)" : "every raw (nothing is retired below the 200 MB / 200,000 cap)"));
  console.log("MEASURED");
  process.exit(0);
}
