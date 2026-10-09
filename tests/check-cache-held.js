// tests/check-cache-held.js
// SUBJECT: backends/backend1/eventcache.js, backends/backend1/streammanager.js, backends/backend1/matrixbridge.js
// WALL: AFTER FORGETTING, THE RAW CACHE HOLDS WHAT THE ENGINE HOLDS — WHATEVER ORDER THE OLD EVENTS ARRIVE IN (`ddjp_566`,
//   HANDOVER item 3; the owner's ruling: on a trim, every cached event at or below the cut goes, banked ones included, except
//   the proof boundary event). Live at `?v=519` the bot's history rebuilt from 28 locally held events and the owner's from 2:
//   the extra 26 were old events delivered AFTER its floors, banked "below the trimmed boundary" — and the cache keeps a copy
//   of every raw BEFORE the door judges it (`_ingestSpineEvent`: `EventCache.store(raw)` then `StreamManager.ingest(raw)`), so a
//   banked arrival stayed cached until some later trim happened to drop something. Measured on `ddjp_565` through the real
//   paths — real seals, the bridge's own `_onCheckpointArrived` and `_wireCacheRetire`, raws stored before ingest:
//   PART A — old events from a second channel arriving after the trim: the cache ends as a device's that received them in order.
//   PART B — every old event re-delivered after the trim (a replay of the server): the same.
//   PART C — an ORIGIN floor, licensed by its declaration with nothing held below it (the no-drop trim): the leftover raws go
//            AT THAT TRIM, not at some later one.
//   PART D — under a QUORUM floor the boundary event the engine keeps to re-prove it stays cached; nothing else below does.
//   PART E — a sweep owed when the room changes is not run on the next room's behalf.
//   PART F — the other direction: raws banked under a floor that is accepted but NOT LICENSED stay (servable for repair).
//   The named settings event (`settingsFrom`) is pinned by the cache's own never-forget rule and stays in every part.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0, _finished = false;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[cache-held] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
process.on("exit", () => { if (!_finished) { console.log("[cache-held] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/vouch.js", "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js", "backends/backend1/eventcache.js"];
// THE BRIDGE AS SHIPPED: its checkpoint arrival handler and its cache wiring, taken out of the file rather than copied.
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return i < 0 ? null : MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
const WIRE = (() => { const i = MB.indexOf("  let _cacheRetireWired = false;"), j = MB.indexOf("  function _wireCacheRetire()");
  return (i < 0 || j < 0) ? null : MB.slice(i, MB.indexOf("\n  }\n", j) + 4); })();
// AND THE ORDER THE DOOR USES — the cache first, then the engine — read from the bridge rather than assumed.
const DOOR = (() => { const i = MB.indexOf("  function _ingestSpineEvent(event, room, isLive) {"); return i < 0 ? "" : MB.slice(i, MB.indexOf("\n  }\n", i)); })();
ok(ARRIVED && WIRE, "PREMISE — the bridge's `_onCheckpointArrived` and `_wireCacheRetire` could not be taken from the shipped file");
ok(/if \(!_isRecoveryTransport\) EventCache\.store\(raw\);[^\n]*\n\s*StreamManager\.ingest\(raw\);/.test(DOOR),
  "PREMISE — `_ingestSpineEvent` no longer stores a raw BEFORE the engine judges it; this guard delivers in that order and would be " +
  "testing a door that does not exist (a textual premise: it proves the order is written, and the parts below prove what it costs)");
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const idb = (map) => ({ supported: () => true, set: (s, k, v) => { map.set(k, v); return Promise.resolve(); },
  del: (s, k) => { map.delete(k); return Promise.resolve(); }, values: () => Promise.resolve(Array.from(map.values())) });
function live(sb) { try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); } catch (e) {}
  if (!sb.Session.mayAuthor() && sb.Session._setPhaseForTest) sb.Session._setPhaseForTest(sb.Session.LIVE); }
function device(myRank) {
  const map = new Map();
  const sb = loadInContext(FILES, { Logger: quiet, IDB: idb(map) }); sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {} live(sb);
  const SM = sb.StreamManager, Fl = sb.Floor;
  // Floor attached as `check-forgetting-differential` attaches it; the bridge's own attach object is `check-floor-wire`'s subject.
  Fl.attach({ myRank: () => myRank, settings: () => SM.getState().settings, log: () => (SM.proofLog ? SM.proofLog() : SM.getLog()),
    trimmed: () => SM._trimState() !== null, canProve: (f) => SM.canProve(f) });
  Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { SM.trimToFloor(); } catch (e) {} } });   // the bridge's trim subscriber
  new Function("StreamManager", "EventCache", WIRE + "\nreturn _wireCacheRetire;")(SM, sb.EventCache)();
  // J79: the bridge now refuses an origin not carried by the room's owner (`_carriedByRoomOwner`, which reads the sender's
  // level from the room). This harness has no room, so the reader is handed in: the creator `@o:hs` is above the ladder (100,
  // room v12), everyone else reads at their rung. PART C's origin is the creator's, as an owner's restore is.
  const arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", "_carriedByRoomOwner", ARRIVED + "\nreturn _onCheckpointArrived;")(
    Fl, sb.TrustPolicy, sb.Continuity, SM, quiet, () => SM.getState().settings, (e) => sb.Ranks.aboveLadder(e && e.sender === "@o:hs" ? 100 : 0));
  const deliver = (e) => { const r = F.toRaw(e); sb.EventCache.store(r); SM.ingest(r); };   // as `_ingestSpineEvent` does
  return { sb, SM, Fl, arrive, deliver, map };
}
function roomEvents(n) {
  const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(),
    { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })];
  let prev = null, ts = T0;
  for (let l = 2; l <= n; l++) {
    const id = "$e" + String(l).padStart(5, "0");
    if (l <= 4 || l % 20 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
    else if (l % 5 === 0) { ts += 4 * MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
    else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); }
  }
  return E;
}
// Real seals at the given cuts, by a live sealer device holding the room (as the bot's did).
async function sealsAt(E, cuts) {
  const S = device(BOT), out = []; let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings, myRank: () => BOT,
    myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { out.push(JSON.parse(JSON.stringify(cp))); } });
  let lo = 1;
  for (const hi of cuts) { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) S.SM.ingest(F.toRaw(e)); lo = hi + 1; clock += 4 * 60 * MIN; await S.sb.Checkpoint.seal(); }
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const evs = (E, lo, hi) => E.filter((x) => x.l >= lo && x.l <= hi).map((e) => ["ev", e]);
async function play(script, rank) {
  const d = device(rank);
  for (const op of script) {
    if (op[0] === "ev") d.deliver(op[1]);
    else if (op[0] === "cp") d.arrive({ content: op[1], senderRank: op[2], sender: "@bot:hs", ts: T0 + op[1].floorL * MIN });
    await tick();
  }
  await tick();
  return d;
}
const cachedIds = (d) => d.sb.EventCache.values().map((r) => r.event_id).sort();
const heldIds = (d) => d.SM.getLog().map((e) => e.eventId);
const extraOf = (d) => { const h = new Set(heldIds(d)); return cachedIds(d).filter((id) => !h.has(id)); };
const idbMatches = (d) => d.map.size === d.sb.EventCache.values().length && cachedIds(d).every((id) => d.map.has(id));

(async () => {
  const E = roomEvents(80); const cps = await sealsAt(E, [17, 66]);
  ok(cps.length === 2 && cps[0].floorL === 17 && cps[1].floorL === 66, "PREMISE — two real seals, at 17 and 66", cps.map((c) => c.floorL));
  // THE REFERENCE: a device that received everything in log order.
  const ref = await play([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 70), [["cp", cps[1], BOT]], evs(E, 71, 80)), BOT);
  ok(ref.SM._trimState() === 66 && extraOf(ref).join() === "$s", "PREMISE — the device that received everything in order trimmed at 66 and caches " +
    "exactly its held events plus the pinned settings event (this is also the control that the cache is being read)", { trim: ref.SM._trimState(), extra: extraOf(ref) });
  const REF = cachedIds(ref).join();

  // ── PART A — a second channel's old events arrive after the trim ────────────────────────────────────────────────────────
  { const d = await play([].concat(evs(E, 1, 11), evs(E, 17, 20), [["cp", cps[0], BOT]], evs(E, 21, 70), [["cp", cps[1], BOT]], evs(E, 12, 16), evs(E, 71, 80)), BOT);
    ok(d.SM._trimState() === 66 && heldIds(d).join() === heldIds(ref).join(), "A PREMISE — the late device trimmed at 66 and holds what the reference holds",
      { trim: d.SM._trimState(), held: heldIds(d).length });
    ok(cachedIds(d).join() === REF, "A: old events arriving AFTER the trim stayed in the cache — banked by the door, kept by the cache. It must end as a " +
      "device that received them in order", { extra: extraOf(d) });
    ok(idbMatches(d), "A: and IndexedDB holds exactly what memory does", { idb: d.map.size, mem: d.sb.EventCache.values().length });
  }
  // ── PART B — every old event re-delivered after the trim ────────────────────────────────────────────────────────────────
  { const d = await play([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 70), [["cp", cps[1], BOT]], evs(E, 71, 80), evs(E, 1, 66)), BOT);
    ok(cachedIds(d).join() === REF, "B: old events RE-DELIVERED after the trim (a replay of the server) stayed in the cache", { extra: extraOf(d).length, first: extraOf(d).slice(0, 4) });
    ok(idbMatches(d), "B: and IndexedDB holds exactly what memory does", { idb: d.map.size, mem: d.sb.EventCache.values().length });
  }
  // ── PART C — an origin floor's no-drop trim ─────────────────────────────────────────────────────────────────────────────
  { const E3 = roomEvents(40); const d = device(O);
    for (const e of E3.filter((x) => x.l <= 30)) d.sb.EventCache.store(F.toRaw(e));      // leftovers, as rehydrated: cached, never ingested
    const seed = d.sb.StateDeriver.buildSeed(E3.filter((x) => x.l <= 30), undefined);
    const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed, floorL: 30, thin: true, covers: E3[0].eventId + ".." + E3[29].eventId };   // the origin pair
    cp.h = d.sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
    d.deliver(E3[30]);                                                                         // one live event of the room, above the cut
    d.arrive({ content: cp, senderRank: O, sender: "@o:hs", ts: T0 + 31 * MIN });           // adopted -> the trim subscriber -> trimToFloor
    ok(d.SM._originState() === true && d.SM.seedValidation().reason === "origin-seed" && d.SM.forgettingLicensed() === true && d.SM._trimState() === 30,
      "C PREMISE — the origin floor is licensed by its declaration and the device trimmed at its cut", { origin: d.SM._originState(), v: d.SM.seedValidation(), trim: d.SM._trimState() });
    ok(heldIds(d).length === 1, "C PREMISE — nothing was held below the cut, so the trim dropped nothing (the no-drop path)", heldIds(d));
    const atTrim = extraOf(d);                                                                 // read BEFORE any tick: what the trim itself retired
    ok(atTrim.join() === "$s", "C: a licensed trim that dropped nothing from the held log left every cached raw at or below its cut — " +
      "the trim must retire them itself, banked ones included", { extra: atTrim.length, first: atTrim.slice(0, 4) });
    ok(idbMatches(d), "C: and IndexedDB holds exactly what memory does", { idb: d.map.size, mem: d.sb.EventCache.values().length });
  }
  // ── PART D — the quorum floor's proof boundary ──────────────────────────────────────────────────────────────────────────
  { const E2 = roomEvents(80); const q = await sealsAt(E2, [40, 50, 60]);
    const HS = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("high-staff");
    const by = (cp, who) => Object.assign({}, cp, { by: who });
    const d = device(HS);
    for (const e of E2.filter((x) => x.l <= 62)) d.deliver(e);
    [["@hs1:hs", 0], ["@hs2:hs", 1], ["@hs3:hs", 2]].forEach(([who, i]) => d.arrive({ content: by(q[i], who), senderRank: HS, sender: who, ts: T0 + q[i].floorL * MIN }));
    await tick();
    const f = d.Fl.current(), bid = f && String(f.covers).split("..")[1];
    const kept = d.SM.proofLog().map((e) => e.eventId).filter((id) => heldIds(d).indexOf(id) < 0);
    ok(f && f.floorL === 40 && d.Fl.grade() === "quorum" && d.SM._trimState() === 40 && kept.join() === bid,
      "D PREMISE — a quorum floor at 40 was trimmed under and the engine keeps its boundary to re-prove it", { floor: f && f.floorL, grade: d.Fl.grade(), trim: d.SM._trimState(), kept });
    ok(d.sb.EventCache.has(bid) && d.map.has(bid), "D: the quorum floor's boundary event — the one the engine keeps to re-prove the floor — was deleted " +
      "from the cache. The proof boundary is the exception to retiring everything at or below the cut", { boundary: bid });
    ok(extraOf(d).sort().join() === [bid, "$s"].sort().join(), "D: and nothing else at or below the cut stays cached", extraOf(d));
  }
  // ── PART E — a sweep owed across a room change ──────────────────────────────────────────────────────────────────────────
  { const d = await play([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 70), [["cp", cps[1], BOT]]), BOT);
    let announced = 0; d.SM.on("ddjp.local.banked", () => { announced++; });
    const late = F.toRaw(E.find((x) => x.l === 12)); d.sb.EventCache.store(late); d.SM.ingest(late);   // banked below the trim, a sweep owed
    ok(announced === 1 && d.SM._trimState() === 66 && !heldIds(d).includes(late.event_id),
      "E PREMISE — the late arrival was banked below the trim and announced, so a sweep really is owed when the room changes", { announced, trim: d.SM._trimState() });
    d.SM.reset(); d.Fl.reset();                                                                         // room entry before the sweep runs
    const other = F.toRaw(F.reducerEvent("$next-room", 5, T0, "@x:hs", P, { t: "ddjp.dj.join", v: "vidNEXT00001" })); other.room_id = "!next-room:hs";
    d.sb.EventCache.store(other); d.SM.ingest(other);                                                   // the next room has begun
    await tick();
    ok(d.sb.EventCache.has("$next-room"), "E: a sweep owed by the last room ran on the next room's behalf and judged its raws", cachedIds(d).slice(0, 5));
  }
  // ── PART F — accepted, not licensed: kept ───────────────────────────────────────────────────────────────────────────────
  { // The floor first; its events after it are banked under the ACCEPTED boundary, and it cannot prove itself (its boundary is
    // banked, never held) — so nothing here is licensed to forget, and those raws are the device's repair material.
    const d = await play([].concat([["cp", cps[0], BOT]], evs(E, 1, 17)), BOT);
    ok(d.SM._trimState() === null && d.SM.forgettingLicensed() === false && heldIds(d).length === 0, "F PREMISE — the floor is accepted, not licensed, and nothing is held",
      { trim: d.SM._trimState(), licensed: d.SM.forgettingLicensed(), held: heldIds(d).length });
    ok(cachedIds(d).length === 17, "F: raws banked under a floor that is ACCEPTED BUT NOT LICENSED were retired — they are kept, servable for repair, " +
      "until a licensed trim", { cached: cachedIds(d).length });
  }
})().then(done, (e) => { failed++; console.log("[cache-held] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[cache-held] " + failed + " failure(s)"); process.exit(1); }
  console.log("[cache-held] PASS — after forgetting, the raw cache holds what the engine holds, whatever order the old events arrive in: old " +
    "events from a later channel, or every old event re-delivered, after the trim end exactly as on a device that received them in order, in " +
    "memory and IndexedDB; an origin floor's no-drop trim retires the leftovers itself; under a quorum floor the boundary the engine keeps " +
    "to re-prove it stays and nothing else below does; a sweep owed when the room changes does not run for the next room; and raws under " +
    "a floor that is accepted but not licensed are kept for repair. Driven through real seals, the door's own order (cache, then " +
    "engine) and the bridge's own arrival handler and cache wiring (" + asserts + " assertions)");
  process.exit(0);
}
