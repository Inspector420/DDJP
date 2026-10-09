// tests/check-forgetting-differential.js
// SUBJECT: backends/backend1/streammanager.js, backends/backend1/history.js, backends/backend1/floor.js
// WALL: FORGETTING ON AND OFF GIVE IDENTICAL STATE AND SONG HISTORY AT EVERY STEP (step 1 of the plan in
//   `consensus/forgetting-alongside-consensus.md`; test only, no application change). Each scenario runs two devices fed the
//   same inputs in the same order through the real paths — real seals (`Checkpoint.seal` on a live sealer device), the
//   bridge's own `_onCheckpointArrived`, and History attached as the bridge attaches it. ON trims on adoption as the bridge
//   does; OFF never forgets. After every step: the derived state on REPRODUCE_FIELDS, and the song-history rows.
//   A scenario that already differs on today's code is a PINNED BASELINE: its divergence is asserted exactly, with the reason
//   and the plan step that removes it — so it cannot change silently, and the step that fixes it must flip it.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[forgetting-differential] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "backends/backend1/dials.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/streammanager.js", "backends/backend1/checkpoint.js"];
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const ARRIVED = (() => { const i = MB.indexOf("  function _onCheckpointArrived(entry) {"); return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); })();
const P = F.RANK.player, O = F.RANK.owner, BOT = 99, T0 = 1.7e12, MIN = 60000;
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
function live(sb) { try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); if (sb.Session.sawEvent) sb.Session.sawEvent(); } catch (e) {}
  if (!sb.Session.mayAuthor() && typeof sb.Session._setPhaseForTest === "function") sb.Session._setPhaseForTest(sb.Session.LIVE); }
function device(forget, myRank, server) {
  const sb = loadInContext(FILES, { Logger: quiet }); sb.Floor.reset(); sb.StreamManager.reset(); try { sb.Checkpoint.reset(); } catch (e) {} live(sb);
  const SM = sb.StreamManager, Fl = sb.Floor;
  sb.History.reset();
  sb.History.attach({ log: () => SM.getLog(), heldFrom: () => (SM.heldFrom ? SM.heldFrom() : null), seed: () => (SM.floorSeed && SM.floorSeed()) || Fl.seed() || undefined,
    cut: () => { const f = Fl.current(); return f && typeof f.floorL === "number" ? f.floorL : null; },   // as the bridge attaches it (ddjp_559)
    settled: () => SETTLED,   // as the bridge attaches it (ddjp_562): floors adopted, replay done
    awaitOpen: AWAIT_OPEN, origin: () => { const c = memChain(Fl); return (c.length && c[0].origin) ? c[0] : null; },   // as the bridge attaches them (ddjp_564)
    heldComplete: () => (SM.holdsWholeRoom ? SM.holdsWholeRoom() : true),   // as the bridge attaches it (ddjp_562)
    // THE SERVER'S HISTORY (`ddjp_556`): the bridge's `pageRange`, here over the whole room as a server holds it.
    pageRange: async (a, b) => { PAGES++; const out = (SERVER_LOG || []).concat(SERVER_CPS || []).filter((e) => typeof e.l === "number" && e.l >= a && e.l <= b); EVENTS_READ += out.length; out.reachedFrom = Math.max(0, a); return out; },
    // as the bridge recognises a checkpoint among paged events (ddjp_560)
    anchorOf: (e) => (e && e.type === "ddjp.checkpoint" && e.content && e.content.seed && typeof e.content.floorL === "number") ? { l: e.content.floorL, seed: e.content.seed } : null });
  // Wired as the bridge wires it (`ddjp_550`): retreat by proof, and a fetch-back on "needs-fetch" through `server` (the pager).
  Fl.attach({ myRank: () => myRank, settings: () => SM.getState().settings, log: () => (SM.proofLog ? SM.proofLog() : SM.getLog()), trimmed: () => SM._trimState() !== null,
              canProve: (f) => SM.canProve(f) });
  const d0 = { pending: null, fetches: [], last: null };
  Fl.onChange((ev) => { if (ev && ev.kind === "needs-fetch") d0.pending = SM.fetchBack({ fetch: async (a, b) => { d0.fetches.push([a, b]); return server ? server(a, b) : []; },
    myRank: () => myRank, settings: () => SM.getState().settings }).then((r) => { d0.last = r; }); });
  // FORGETTING OFF is the same device with the forgetting gate closed: both wire adoption to `trimToFloor` exactly as the
  // bridge does, so both refold there (line 910, before the gate at 911); OFF then refuses to drop anything. That gate
  // (`TrustPolicy.earnsForget`) is consulted only by forgetting — the trim and the raw cache.
  if (!forget) sb.TrustPolicy.earnsForget = () => false;
  Fl.onChange((ev) => { if (ev.kind === "adopted" || ev.kind === "moved") { try { SM.trimToFloor(); } catch (e) {} } });
  // AS THE BRIDGE DOES ON EVERY ADOPTION (`ddjp_556`): rows settled under a replaced floor are dropped, to be re-read.
  // `bridgeReread` is what the bridge does after a drop (`MatrixBridge`'s floor handler).
  Fl.onChange((ev) => { if (ev.kind !== "adopted" && ev.kind !== "moved") return; try { const f = Fl.current(); if (f) { const rc = sb.History.reconcileFloor(Fl.sigOf(f), f.floorL);
    if (rc && rc.dropped > 0 && typeof sb.__reread === "function") sb.__reread(); } } catch (e) {} });
  // J79: the bridge refuses an origin not carried by the room's owner (`_carriedByRoomOwner` reads the sender's level from the
  // room). No room here, so the reader is handed in: the creator `@o:hs` is above the ladder (100, room v12); nobody else is.
  const arrive = new Function("Floor", "TrustPolicy", "Continuity", "StreamManager", "Logger", "_mySettings", "_carriedByRoomOwner", ARRIVED + "\nreturn _onCheckpointArrived;")(
    Fl, sb.TrustPolicy, sb.Continuity, SM, quiet, () => SM.getState().settings, (e) => sb.Ranks.aboveLadder(e && e.sender === "@o:hs" ? 100 : 0));
  return Object.assign(d0, { sb, SM, Fl, arrive, forget });
}
// THE TRUTH: the song history derived from the WHOLE room from its start, by the reducer itself.
let TRUTH_E = null, SERVER_LOG = null, SERVER_CPS = null, SCEN_CPS = null, PAGES = 0, EVENTS_READ = 0, SETTLED = true, AWAIT_OPEN = false;
// THE CHAIN FROM FLOOR'S OWN MEMORY (capped at 24), and its resolution, as the bridge's `_acceptedChain` / `_resolvedChain` (ddjp_564)
function memChain(Fl) { const byH = new Map((Fl.heldCheckpoints() || []).filter((c) => c && c.h).map((c) => [c.h, c])); const out = []; const seen = new Set();
  let f = Fl.current(); while (f && f.h && !seen.has(f.h)) { seen.add(f.h); out.push({ h: f.h, l: f.floorL, seed: f.seed, prev: f.prev || null, prevNull: !f.prev, origin: !f.prev && f.thin === true }); f = f.prev ? byH.get(f.prev) : null; }
  return out.reverse(); }
// J79: the shipped walk skips the page only when the table KNOWS the chain's first floor (`History.knowsFloor`) — mirrored when
// the shipped source has it, so the harness follows the device.
const KNOWS_RULE = /History\.knowsFloor\(c\[0\]\.h\)/.test(fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8"));
function resolvedChain(d) { const c = memChain(d.Fl); if (!c.length || c[0].prevNull) return c; const o = d.sb.History.origin ? d.sb.History.origin() : null;
  const known = KNOWS_RULE ? !!(d.sb.History.knowsFloor && d.sb.History.knowsFloor(c[0].h)) : true;
  if (o && known && (o.start || o.l < c[0].l)) return c;
  if (!/ev = await pageRange\(0, c\[0\]\.l\)/.test(MB_SRC)) return c;   // mirrors the SHIPPED bridge: does it page to find the origin?
  PAGES++; const byH = new Map((SCEN_CPS || []).map((x) => [x.h, x])); const more = []; let h = c[0].prev; const seen = new Set(c.map((x) => x.h));
  while (h && byH.has(h) && !seen.has(h)) { seen.add(h); const k = byH.get(h); more.push({ h: k.h, l: k.floorL, seed: k.seed, prev: k.prev || null, prevNull: !k.prev, origin: !k.prev && k.thin === true }); h = k.prev || null; }
  return more.reverse().concat(c); }
// THE BRIDGE'S CACHE REBUILD, mirrored from the SHIPPED source (ddjp_562): anchored on the accepted chain, or (561) on every held checkpoint
// It folds the device's DURABLE RAW CACHE (`_heldHere()`): every raw it received, banked ones included — not the stream log.
function cacheRebuild(d, heldCps, cached) {
  // 563: the bridge delegates to History's one segment function over the accepted chain
  if (/History\.rebuildAnchored\(held, await _resolvedChain\(\)\)/.test(MB_SRC) && d.sb.History.rebuildAnchored) { d.sb.History.rebuildAnchored(cached || d.SM.getLog(), resolvedChain(d)); return; }
  if (/History\.rebuildAnchored\(held, _acceptedChain\(\)\)/.test(MB_SRC) && d.sb.History.rebuildAnchored) { d.sb.History.rebuildAnchored(cached || d.SM.getLog(), acceptedChain(d)); return; }
  const accepted = /_isHistoryAnchor\(e\) && _acc\.has\(e\.content\.h\)/.test(MB_SRC);   // 562: the FILTER, not only its declaration
  const byL = new Map(); for (const a of (accepted ? acceptedChain(d) : heldCps.map((c) => ({ l: c.floorL, seed: c.seed })))) if (!byL.has(a.l)) byL.set(a.l, a);
  const cuts = [{ l: -Infinity, seed: undefined }].concat(Array.from(byL.values()).sort((x, y) => x.l - y.l)); const held = cached || d.SM.getLog();
  for (let i = 0; i < cuts.length; i++) { const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : Infinity;
    const seg = held.filter((e) => typeof e.l === "number" && e.l > lo && e.l <= hi); if (seg.length) d.sb.History.ingest(seg, cuts[i].seed, { src: "cache" }); } }
// the accepted chain a device follows, oldest first, with fingerprints (as the bridge's `_acceptedChain`, ddjp_561)
function acceptedChain(d) { const byH = new Map((SCEN_CPS || []).map((c) => [c.h, c])); const out = []; let h = d.Fl.current() ? d.Fl.current().h : null; const seen = new Set();
  while (h && byH.has(h) && !seen.has(h)) { seen.add(h); const c = byH.get(h); out.push({ h: c.h, l: c.floorL, seed: c.seed }); h = c.prev; }
  return out.reverse(); }
// the server's checkpoint events for a scenario's floors, and the ACCEPTED chain a device follows (as `_acceptedAnchors`)
function serveCps(cps) { SCEN_CPS = cps; SERVER_CPS = cps.map((c, i) => ({ type: "ddjp.checkpoint", l: c.floorL + 0.5, eventId: "$cpev" + i, content: c })); }
function acceptedAnchors(d) { const byH = new Map((SCEN_CPS || []).map((c) => [c.h, c])); const out = []; let h = d.Fl.current() ? d.Fl.current().h : null; const seen = new Set();
  while (h && byH.has(h) && !seen.has(h)) { seen.add(h); const c = byH.get(h); out.push({ l: c.floorL, seed: c.seed, origin: !c.prev && c.thin === true }); h = c.prev; }
  return out.length ? out.sort((x, y) => x.l - y.l) : (SCEN_CPS || []).map((c) => ({ l: c.floorL, seed: c.seed })); }
function RECON_AFTER_RESTORE() { return /History\.restore\(snap\);[\s\S]{0,900}History\.reconcileFloor\(/.test(MB_SRC); }
const MB_SRC = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
// THE BRIDGE'S BACKFILL TAIL (`backfillHistory`): from the room's start if nothing is covered, then the gaps.
async function bridgeBackfill(d) { const H = d.sb.History; if (H.markOpened) H.markOpened(); H.refresh();
  // THE SHIPPED VERIFY PASS (ddjp_560), BEFORE the coverage check, only when the bridge has it
  if (/History\.verifyIncremental\(await _resolvedChain\(\)\)/.test(MB_SRC) && H.verifyIncremental) await H.verifyIncremental(resolvedChain(d));
  else if (/History\.verifyIncremental\(/.test(MB_SRC) && H.verifyIncremental) await H.verifyIncremental(acceptedChain(d));
  else if (/History\.verifyFrom\(/.test(MB_SRC) && H.verifyFrom) { PAGES++; EVENTS_READ += (SERVER_LOG || []).length; H.verifyFrom((SERVER_LOG || []).concat(SERVER_CPS || []), acceptedAnchors(d)); }   // 560: the whole room, every open
  const cov = H.coverage();
  if (cov && cov.complete) return { complete: true, entries: cov.entries };
  let ceiling = (cov && cov.fromL !== null) ? cov.fromL : null;
  if (ceiling === null) ceiling = d.SM.getLog().reduce((m, e) => (typeof e.l === "number" && (m === null || e.l < m)) ? e.l : m, null);
  // THE SHIPPED CONDITION, read from the bridge (`ddjp_559`): page from the room's start only when nothing is covered (558), or
  // whenever coverage does not reach it (the fix). The harness must do what the device does, not what a test author assumed.
  const _onlyWhenEmpty = /cov && cov\.fromL === null && ceiling !== null && ceiling > 0\) \{?\s*\n?\s*await History\.backfill\(0/.test(MB_SRC);
  if (cov && (_onlyWhenEmpty ? cov.fromL === null : !cov.complete) && ceiling !== null && ceiling > 0) await H.backfill(0, undefined, ceiling);
  await H.fillGaps();
  const after = H.coverage(); return { complete: !!(after && after.complete), entries: after && after.entries }; }
// THE ROOM'S FLOOR-ANCHORED ACCOUNT (the owner's ruling, ddjp_560): what the app follows, over every event of the room
// computed HERE, from StateDeriver alone — independent of History, the code under test — and so a cross-check of deriveAnchored
function truthAnchored(d) {
  const ev = TRUTH_E.slice().sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));
  const _acc = acceptedAnchors(d); const _org = _acc.length && _acc[0].origin; const rows = new Map();
  const cuts = _org ? _acc : [{ l: -Infinity, seed: undefined }].concat(_acc);
  if (_org && _acc[0].seed.nowPlaying && _acc[0].seed.nowPlaying.pi) { const np = _acc[0].seed.nowPlaying; rows.set(np.pi, [np.pi, (np.song || {}).videoId, undefined, null].join("|")); }   // the origin's banked song, in the reducer's row shape
  for (let i = 0; i < cuts.length; i++) { const lo = cuts[i].l, hi = (i + 1 < cuts.length) ? cuts[i + 1].l : Infinity;
    const st = d.sb.StateDeriver.derive(ev.filter((e) => e.l > lo && e.l <= hi), cuts[i].seed);
    for (const r of (st.history || [])) rows.set(r.pi, [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|"));
    // THE CLOSING FLOOR IS THE ROOM'S ACCOUNT (the owner's rule, ddjp_563): its banked song is a row, whatever this segment's fold reached
    const nb = (i + 1 < cuts.length && cuts[i + 1].seed && cuts[i + 1].seed.nowPlaying) ? cuts[i + 1].seed.nowPlaying : null;
    if (nb && nb.pi && !rows.has(nb.pi)) rows.set(nb.pi, [nb.pi, (nb.song || {}).videoId, undefined, null].join("|")); }   // in the reducer's row shape: no `startedAt` field (ddjp_564)
  return Array.from(rows.values()).sort(); }
function truthRows(sb) { const st = sb.StateDeriver.derive(sb.StreamManager.orderEvents ? sb.StreamManager.orderEvents(TRUTH_E.map((e) => e)) : TRUTH_E); return (st.history || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|")).sort(); }
function view(d) {
  const st = d.SM.getState(), out = {};
  for (const f of FIELDS) out[f] = st[f] === undefined ? null : st[f];
  try { d.sb.History.refresh(); } catch (e) {}
  const rows = (d.sb.History.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|"));
  return { state: canon(out), history: rows.join(";"), held: d.SM.getLog().length };
}
// The room's events: settings, DJs joining with songs (re-joining every 20 events so plays continue), plays, votes.
function roomEvents(n, extra) {
  const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(),
    { checkpointEvery: 5, checkpointCooldownMs: 0 });
  const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })];
  let prev = null, ts = T0;
  for (let l = 2; l <= n; l++) {
    const id = "$e" + String(l).padStart(5, "0");
    if (extra && extra[l]) { ts += MIN; E.push(extra[l](id, l, ts, S0)); continue; }
    if (l <= 4 || l % 20 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
    else if (l % 5 === 0) { ts += 4 * MIN; E.push(F.reducerEvent(id, l, ts, "@d" + (l % 3) + ":hs", P, { t: "ddjp.dj.play", p: prev })); prev = id; }
    else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: prev || "$none" })); }
  }
  return E;
}
// Real seals at the given cuts, by a live sealer device holding the room (as the bot's did).
async function sealsAt(E, cuts) {
  const S = device(false, BOT), out = []; let clock = T0;
  S.sb.Checkpoint.attach({ now: () => clock, log: () => S.SM.getLog(), held: () => [], settings: () => S.SM.getState().settings, myRank: () => BOT,
    myUserId: () => "@bot:hs", myDeviceId: () => "BOT", amOwner: () => false, isLegal: () => true, holdForWitness: () => null, thin: () => false,
    floorTs: () => { try { return S.Fl.anchorTs(); } catch (e) { return null; } }, floorPos: () => { try { return S.Fl.position(); } catch (e) { return null; } },
    send: async (t, cp) => { out.push(JSON.parse(JSON.stringify(cp))); } });
  let lo = 1;
  for (const hi of cuts) { for (const e of E.filter((x) => x.l >= lo && x.l <= hi)) S.SM.ingest(F.toRaw(e)); lo = hi + 1; clock += 4 * 60 * MIN; await S.sb.Checkpoint.seal(); }
  return { cps: out, CF: S.sb.CheckpointFormat };
}
// Run a script on ON and OFF; compare after every step. Returns the first divergence, or null.
async function run(script, myRank, opts) {
  const o = opts || {};
  let off = null;
  // The SERVER is the never-forgetting device: it holds every event. A scenario can make it supply nothing.
  const server = (a, b) => o.noServer ? [] : off.SM.getLog().filter((e) => typeof e.l === "number" && e.l >= a && e.l <= b);
  const on = device(true, myRank, server); off = device(false, myRank, server);
  let first = null, maxHeld = 0, steps = 0;
  for (const op of script) {
    for (const d of [on, off]) {
      if (op[0] === "ev") d.SM.ingest(F.toRaw(op[1]));
      else if (op[0] === "cp") d.arrive({ content: op[1], senderRank: op[2], sender: op[3] || "@bot:hs", ts: T0 + op[1].floorL * MIN });
      else if (op[0] === "adopt") d.Fl.adopt({ floor: Object.assign({ u: "@q:hs" }, op[1]), tier: op[2] });
      else if (op[0] === "revalidate") d.Fl.revalidate();
      else if (op[0] === "remember") d.Fl.remember(op[1], op[2], op[3] || "@bot:hs", T0 + op[1].floorL * MIN);
      if (d.pending) { await d.pending; d.pending = null; }
    }
    if (op[0] === "ev" && op[3] === "skipCompare") continue;
    steps++;
    const a = view(on), b = view(off);
    maxHeld = Math.max(maxHeld, a.held);
    if (!first && (a.state !== b.state || a.history !== b.history)) first = { step: steps, op: op[0] + (op[1] && op[1].l ? "@" + op[1].l : (op[1] && op[1].floorL ? "@" + op[1].floorL : "")), what: a.state !== b.state ? "state" : "history" };
  }
  return { first, maxHeld, steps, onHeld: on.SM.getLog().length, offHeld: off.SM.getLog().length, on, off };
}
const evs = (E, lo, hi) => E.filter((x) => x.l >= lo && x.l <= hi).map((e) => ["ev", e]);
(async () => {
  const results = {};
  // S1 — in order; each save point delivered a few events after its cut; a settings change above a cut (l=70)
  { const E = roomEvents(100, { 70: (id, l, ts, S0) => F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.room.settings", s: Object.assign({}, S0, { repeatCooldownMs: 600000 }) }) });
    const { cps } = await sealsAt(E, [17, 66, 89]);
    results.S1 = await run([].concat(evs(E, 1, 25), [["cp", cps[0], BOT]], evs(E, 26, 74), [["cp", cps[1], BOT]], evs(E, 75, 95), [["cp", cps[2], BOT]], evs(E, 96, 100)), BOT); }
  // S2 — a late out-of-order event between two save points (l=40 withheld until after n=2), and a reversed burst above the cut
  { const E = roomEvents(100); const { cps } = await sealsAt(E, [17, 66]);
    const late = E.find((e) => e.l === 40), burst = E.filter((e) => e.l >= 70 && e.l <= 74).reverse().map((e) => ["ev", e]);
    results.S2 = await run([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 39), evs(E, 41, 68), [["cp", cps[1], BOT]], [["ev", late]], evs(E, 69, 69), burst, evs(E, 75, 100)), BOT); }
  // S3 — a same-position race at the cut (the live n=6 shape): an event at the cut's position, sorting BEFORE the boundary, arrives after the seal
  { const E = roomEvents(80); const { cps } = await sealsAt(E, [17, 66]);
    const race = F.reducerEvent("$a00066", 66, T0 + 200 * MIN, "@d9:hs", P, { t: "ddjp.dj.join", v: "vidRACE00066" });
    results.S3 = await run([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 68), [["ev", race]], [["cp", cps[1], BOT]], evs(E, 69, 80)), BOT); }
  // S4 — a broken quorum save point: a high-staff device; an honest owner n=1; a DISHONEST quorum n=2; then it stops verifying
  { const E = roomEvents(80); const { cps, CF } = await sealsAt(E, [17, 66]);
    const bad = JSON.parse(JSON.stringify(cps[1])); bad.seed.settings = Object.assign({}, bad.seed.settings, { repeatCooldownMs: 1234567 });
    bad.h = CF.fingerprint(bad.n, bad.prev, bad.seed, bad.floorL, bad.thin, bad.covers);
    const HS = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("high-staff");
    results.S4 = await run([].concat(evs(E, 1, 20), [["cp", cps[0], BOT]], evs(E, 21, 70), [["adopt", bad, 1]], evs(E, 71, 74), [["revalidate"]], evs(E, 75, 80)), HS); }
  // S5 — a fresh open in the owner's live order: the save point first, the events below it after, then live events and the next
  { const E = roomEvents(80); const { cps } = await sealsAt(E, [17, 66]);
    results.S5 = await run([].concat([["cp", cps[0], BOT]], evs(E, 1, 17), evs(E, 18, 68), [["cp", cps[1], BOT]], evs(E, 69, 80)), BOT); }
  // S6 — 1,000 events, a seal every 40, delivered a few events late; bounded memory on the forgetting device
  { const E = roomEvents(1000); const cuts = []; for (let c = 40; c < 1000; c += 40) cuts.push(c); const { cps } = await sealsAt(E, cuts);
    const script = []; let k = 0;
    for (let l = 1; l <= 1000; l++) {
      const e = E.find((x) => x.l === l); script.push(["ev", e, null, (l % 10 === 0) ? null : "skipCompare"]);
      if (k < cps.length && l === cps[k].floorL + 3) { script.push(["cp", cps[k], BOT]); k++; }
    }
    results.S6 = await run(script, BOT); results.S6.seals = cps.length; }
  // S7 — S1's room, with song history refreshed only at save points and at the end (a batch and a save point arriving
  //      together): the trim's own hand-off of the dropped plays to song history is what keeps it whole.
  { const E = roomEvents(100, { 70: (id, l, ts, S0) => F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.room.settings", s: Object.assign({}, S0, { repeatCooldownMs: 600000 }) }) });
    const { cps } = await sealsAt(E, [17, 66, 89]);
    const quiet = (a) => a.map((op) => ["ev", op[1], null, "skipCompare"]);
    results.S7 = await run([].concat(quiet(evs(E, 1, 25)), [["cp", cps[0], BOT]], quiet(evs(E, 26, 74)), [["cp", cps[1], BOT]], quiet(evs(E, 75, 95)), [["cp", cps[2], BOT]], quiet(evs(E, 96, 99)), evs(E, 100, 100)), BOT); }
  // S4b–S4e — a broken floor on a device that has forgotten past it: retreat by proof, and the fetch-back.
  { const E = roomEvents(100); const { cps, CF } = await sealsAt(E, [17, 40, 66, 89]);
    const HS = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("high-staff");
    const lie = (cp) => { const b = JSON.parse(JSON.stringify(cp)); b.seed.settings = Object.assign({}, b.seed.settings, { repeatCooldownMs: 1234567 }); b.h = CF.fingerprint(b.n, b.prev, b.seed, b.floorL, b.thin, b.covers); return b; };
    // STEP 5b: the quorum floor at 66 proves itself from its predecessor (the seal at 40), which a real room delivers. It is
    // remembered here at PLAYER rank: there for the proof, below this device's tier, so it never binds.
    const P_RANK = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("player");
    const base = [].concat(evs(E, 1, 20), [["cp", cps[0], BOT], ["remember", cps[1], P_RANK, "@p40:hs"]], evs(E, 21, 70), [["adopt", cps[2], 1]], evs(E, 71, 92), [["adopt", lie(cps[3]), 1]], evs(E, 93, 94));
    // S4b: two bad quorum floors in a row — an honest quorum n@66 trimmed under, then a dishonest one at 89; both go
    results.S4b = await run(base.concat([["revalidate"]], evs(E, 95, 100)), HS);
    // S4c: a floor that does NOT prove itself (a dishonest owner checkpoint at 40) is skipped; fetching continues to n=1
    results.S4c = await run(base.slice(0, 23).concat([["remember", lie(cps[1]), BOT]], base.slice(23), [["revalidate"]], evs(E, 95, 100)), HS);
    // S4d: fetching STOPS at the first floor that proves itself (an honest owner checkpoint at 40, proved from n=1's seed)
    results.S4d = await run(base.slice(0, 23).concat([["remember", cps[1], BOT]], base.slice(23), [["revalidate"]], evs(E, 95, 100)), HS);
    // S4e: the server cannot supply events — the last resort: stay, and stop forgetting
    results.S4e = await run(base.concat([["revalidate"]], evs(E, 95, 100)), HS, { noServer: true }); }
  // S8 — an HONEST QUORUM floor re-checked after a trim (owner's rule: keep enough to prove the current floor). Three high-staff
  //      authors' chained seals at 40, 50, 60 reach a high-staff device; the quorum floor (the oldest, 40) is adopted and
  //      trimmed under, then re-checked: it must HOLD — no stale, no fetch — identical to a device that never forgot.
  { const E = roomEvents(80); const { cps } = await sealsAt(E, [40, 50, 60]);
    const HS = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("high-staff");
    // Three AUTHORS: the bridge takes a checkpoint's author from its own `by` (not part of the fingerprint), so each seal names one.
    const by = (cp, who) => Object.assign({}, cp, { by: who });
    results.S8 = await run([].concat(evs(E, 1, 62), [["cp", by(cps[0], "@hs1:hs"), HS, "@hs1:hs"], ["cp", by(cps[1], "@hs2:hs"), HS, "@hs2:hs"], ["cp", by(cps[2], "@hs3:hs"), HS, "@hs3:hs"]],
      evs(E, 63, 70), [["revalidate"]], evs(E, 71, 75), [["revalidate"]], evs(E, 76, 80)), HS); }
  // S9 — BURST TRIMS AT OPEN: every event first, then four floors back to back (the owner's 15:05:02 burst).
  // S10 — THE OWNER'S LIVE ORDER: the first floor before its events, then live events, then a burst of floors.
  // Each device's song history must equal THE TRUTH (derived from the whole room), not only each other.
  { const E = roomEvents(140); const { cps } = await sealsAt(E, [17, 40, 66, 89, 112]);
    TRUTH_E = E.map((e) => e);
    { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
    results.S9 = await run([].concat(evs(E, 1, 120), [["cp", cps[0], BOT], ["cp", cps[1], BOT], ["cp", cps[2], BOT], ["cp", cps[3], BOT], ["cp", cps[4], BOT]], evs(E, 121, 140)), BOT);
    results.S10 = await run([].concat([["cp", cps[0], BOT]], evs(E, 1, 70), [["cp", cps[1], BOT], ["cp", cps[2], BOT]], evs(E, 71, 120), [["cp", cps[3], BOT], ["cp", cps[4], BOT]], evs(E, 121, 140)), BOT);
    for (const name of ["S9", "S10"]) for (const side of ["on", "off"]) {
      const d = results[name][side]; const bf = await bridgeBackfill(d);
      const rows = (d.sb.History.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|")).sort();
      const truth = truthRows(d.sb);
      const missing = truth.filter((x) => rows.indexOf(x) < 0), extra = rows.filter((x) => truth.indexOf(x) < 0);
      ok(missing.length === 0 && extra.length === 0, name + ": the " + side.toUpperCase() + " device's song history equals the truth (the whole room, from its start)",
        { have: rows.length, truth: truth.length, missing: missing.length, extra: extra.length, backfillSaysComplete: bf.complete }); } }
  // S11 — THE OWNER'S LIVE OPEN (`ddjp_557`): a stored table from a previous session — rows stamped under an older floor above the
  //       new cuts, one of them a play the current floors REFUSE, and an unstamped later row that survives — restored by the
  //       bridge's backfill sequence AFTER a burst of floors in the owner's order. The restore step follows the SHIPPED bridge.
  { const E = roomEvents(140); const { cps } = await sealsAt(E, [17, 40, 66, 89, 112]);
    TRUTH_E = E.map((e) => e);
    { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
    const MBsrc = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
    const RECONCILES_AFTER_RESTORE = /History\.restore\(snap\);[\s\S]{0,900}History\.reconcileFloor\(/.test(MBsrc);
    const prev = device(false, BOT, null); for (const e of E) prev.SM.ingest(F.toRaw(e)); prev.sb.History.refresh();
    const snapRows = (prev.sb.History.recent(5000) || []).map((r, i, a) => Object.assign({}, r, { floorSig: (i === a.length - 1) ? undefined : "prev-session-floor" }));
    snapRows.push({ pi: "$ghost-accepted-under-the-old-floor", videoId: "vidGHOST0000", startedAt: T0 + 130 * 4 * MIN, endedAt: T0 + 131 * 4 * MIN, l: 130, floorSig: "prev-session-floor" });
    const SNAP = { v: 2, rows: snapRows, ranges: [[0, 140]], adds: {} };
    const backfillWithRestore = async (d) => { const H = d.sb.History; H.refresh(); H.restore(JSON.parse(JSON.stringify(SNAP)));
      if (RECONCILES_AFTER_RESTORE) { const f = d.Fl.current(); if (f) H.reconcileFloor(d.Fl.sigOf(f), f.floorL); }
      return bridgeBackfill(d); };
    results.S11 = await run([].concat([["cp", cps[0], BOT]], evs(E, 1, 70), [["cp", cps[1], BOT], ["cp", cps[2], BOT]], evs(E, 71, 120), [["cp", cps[3], BOT], ["cp", cps[4], BOT]], evs(E, 121, 140)), BOT);
    for (const side of ["on", "off"]) {
      const d = results.S11[side]; const bf = await backfillWithRestore(d);
      const rows = (d.sb.History.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|")).sort();
      const truth = truthRows(d.sb);
      const missing = truth.filter((x) => rows.indexOf(x) < 0), extra = rows.filter((x) => truth.indexOf(x) < 0);
      ok(missing.length === 0 && extra.length === 0, "S11: the " + side.toUpperCase() + " device's song history equals the truth after the owner's open (a stored table restored after a burst)",
        { have: rows.length, truth: truth.length, missing: missing.length, extra: extra.map((x) => x.split("|")[0]), reconcilesAfterRestore: RECONCILES_AFTER_RESTORE, backfillSaysComplete: bf.complete }); } }
  // S12 — REPEATED RELOADS MID-SONG (`ddjp_558`, the owner's live report: every reload while one song plays makes a counter go up).
  //       The room ends with a song in progress that ARRIVED BY SKIP. Each reload is a fresh device: the previous instance's stored
  //       table restored (as the bridge does at open), the room replayed, reconciled, backfilled and refolded. Everything that can
  //       count must stay exactly the same, reload after reload, and equal the truth.
  { const E = roomEvents(95);
    // THE SONG THAT ARRIVES BY SKIP: DJ A plays, DJ B waits; a skip of A's play starts B's song — then it is in progress, voted on.
    const D0 = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
    E.push(F.reducerEvent("$jA", 96, T0 + 96 * 4 * MIN, "@dA:hs", P, { t: "ddjp.dj.join", v: "vidSONGAAAAA" }));
    E.push(F.reducerEvent("$jB", 97, T0 + 97 * 4 * MIN, "@dB:hs", P, { t: "ddjp.dj.join", v: "vidSONGBBBBB" }));
    const npBefore = (D0.derive(E.slice()).nowPlaying || {}).pi || null;
    E.push(F.reducerEvent("$playA", 98, T0 + 110 * 4 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: npBefore }));
    E.push(F.reducerEvent("$skip", 101, T0 + 111 * 4 * MIN, "@o:hs", O, { t: "ddjp.dj.skip", p: (D0.derive(E.slice()).nowPlaying || {}).pi }));
    const npSkip = (D0.derive(E.slice()).nowPlaying || {}).pi;
    for (let l = 102; l <= 106; l++) E.push(F.reducerEvent("$v" + l, l, T0 + 111 * 4 * MIN + (l - 101) * MIN, "@v" + l + ":hs", P, { t: "ddjp.dj.vote", p: npSkip }));
    if (process.env.S12DBG) console.log("S12SETUP npBefore=" + npBefore + " npAfterSkip=" + npSkip + " song=" + ((D0.derive(E.slice()).nowPlaying || {}).song || {}).videoId);
    const { cps } = await sealsAt(E, [17, 66, 89]);
    TRUTH_E = E.map((e) => e);
    { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
    const MBsrc2 = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
    const RECON = /History\.restore\(snap\);[\s\S]{0,900}History\.reconcileFloor\(/.test(MBsrc2);
    const measure = (d) => { const H = d.sb.History, snap = H.snapshot ? H.snapshot() : {};
      const rows = (H.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null, JSON.stringify(r.counts || null)].join("|")).sort();
      const st = d.SM.getState();
      return { rows: rows, count: H.count ? H.count() : rows.length, adds: canon(snap.adds || {}), addsL: canon(snap.addsL || {}),
               counts: canon(st.counts || {}), np: st.nowPlaying ? st.nowPlaying.pi : null }; };
    let snapshot = null, prevM = null; const seen = [];
    for (let reload = 0; reload < 5; reload++) {
      const d = device(true, BOT, (a, b) => SERVER_LOG.filter((e) => e.l >= a && e.l <= b));
      if (snapshot) { d.sb.History.restore(JSON.parse(JSON.stringify(snapshot))); }
      // the live open: the floors first, then the room's events, as a replay delivers them
      for (const cp of cps) d.arrive({ content: cp, senderRank: BOT, sender: "@bot:hs", ts: T0 + cp.floorL * MIN });
      for (const e of E) d.SM.ingest(F.toRaw(e));
      d.sb.History.refresh();
      if (snapshot) { d.sb.History.restore(JSON.parse(JSON.stringify(snapshot))); if (RECON) { const f = d.Fl.current(); if (f) d.sb.History.reconcileFloor(d.Fl.sigOf(f), f.floorL); } }
      await bridgeBackfill(d);
      const m = measure(d); seen.push(m);
      if (prevM) for (const k of Object.keys(m)) if (JSON.stringify(m[k]) !== JSON.stringify(prevM[k])) { results.S12diff = results.S12diff || { reload: reload, field: k, before: prevM[k], after: m[k] }; }
      prevM = m; snapshot = d.sb.History.snapshot();
      results.S12last = d;
    }
    results.S12seen = seen;
    results.S12truth = truthRows(results.S12last.sb);   // THIS room's truth, before a later scenario replaces the shared one
  }
  // S13 — A RANK-0 DEVICE OPENS FLOORS FIRST AND MUST BACKFILL ITS OLDER HISTORY FROM THE SERVER (`ddjp_559`, the live listener
  //       `@inspectoronline`: 22 songs where the owner had 41). The floors arrive first, the events below them are banked; the
  //       device's history must still equal the whole room's.
  { // A room with songs all along: a new DJ every 10 events, a play every 10 — so most of its history lies BELOW its floors.
    const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
    const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })]; let pv = null, ts = T0;
    for (let l = 2; l <= 140; l++) { const id = "$r" + String(l).padStart(4, "0");
      if (l % 10 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@dj" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
      else if (l % 10 === 7) { ts += 5 * MIN; E.push(F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.dj.play", p: pv })); pv = id; }
      else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: pv || "$none" })); } }
    const { cps } = await sealsAt(E, [40, 89, 112]);
    TRUTH_E = E.map((e) => e);
    { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
    const RANK0 = 0;
    results.S13 = await run([].concat([["cp", cps[0], BOT], ["cp", cps[1], BOT]], evs(E, 1, 140), [["cp", cps[2], BOT]]), RANK0);
    for (const side of ["on", "off"]) {
      const d = results.S13[side]; d.sb.History.refresh();
      const covBefore = d.sb.History.coverage();
      const bf = await bridgeBackfill(d);
      const rows = (d.sb.History.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|")).sort();
      const truth = truthRows(d.sb);
      const missing = truth.filter((x) => rows.indexOf(x) < 0), extra = rows.filter((x) => truth.indexOf(x) < 0);
      if (process.env.S13DBG) console.log("S13DBG " + side + " coverageBefore=" + JSON.stringify(covBefore.ranges) + " fromL=" + covBefore.fromL + " rows=" + rows.length + " truth=" + truth.length + " missingAt=" + missing.map((x) => x.split("|")[0]).join(","));
      ok(missing.length === 0 && extra.length === 0, "S13: the rank-0 " + side.toUpperCase() + " device, opened floors first, backfills its older history — equal to the truth",
        { have: rows.length, truth: truth.length, missing: missing.length, extra: extra.length, coverageBefore: covBefore.ranges, backfillSaysComplete: bf.complete }); } }
  // S14 — A TABLE ALREADY WRONG INSIDE ITS COVERAGE (`ddjp_560`; the live audit): a stored table with a row of the WRONG VIDEO (the
  //       bot's l=122), a MISSING row (l=84) and an EXTRA one — all below the cut, inside complete coverage, where nothing re-reads.
  // S15 — A FRESH DEVICE THAT CANNOT READ ONE CHANNEL (the bot's rank-80 writes in events-high-staff): the floor accounts for a join
  //       this device cannot page, so one fold from the room's start diverges from the floors after it.
  { const mk = () => { const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
      const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })]; let pv = null, ts = T0;
      for (let l = 2; l <= 120; l++) { const id = "$r" + String(l).padStart(4, "0");
        if (l % 10 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@dj" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
        else if (l % 10 === 7) { ts += 5 * MIN; E.push(F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.dj.play", p: pv })); pv = id; }
        else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: pv || "$none" })); } }
      return E; };
    const canon14 = (r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|");
    { const E = mk(); const { cps } = await sealsAt(E, [40, 89]);
      TRUTH_E = E.map((e) => e); serveCps(cps);
      { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
      const prev = device(false, BOT, null); for (const e of E) prev.SM.ingest(F.toRaw(e)); prev.sb.History.refresh();
      const good = (prev.sb.History.recent(5000) || []).filter((r) => typeof r.l === "number" && r.l < 89);
      const bad = good.map((r) => Object.assign({}, r, { floorSig: "prev-floor" }));
      bad[1] = Object.assign({}, bad[1], { videoId: "vidWRONGVIDEO" });            // the wrong video
      const missingPi = bad[2].pi; bad.splice(2, 1);                                 // the missing row
      bad.push({ pi: "$extraRow", l: 55, videoId: "vidEXTRA0000", startedAt: T0 + 55 * MIN, endedAt: T0 + 56 * MIN, floorSig: "prev-floor" });   // the extra row
      const SNAP = { v: 2, rows: bad, ranges: [[0, 120]], adds: {} };
      results.S14 = await run([].concat([["cp", cps[0], BOT], ["cp", cps[1], BOT]], evs(E, 1, 120)), BOT);
      for (const side of ["on", "off"]) { const d = results.S14[side]; d.sb.History.restore(JSON.parse(JSON.stringify(SNAP)));
        { const f = d.Fl.current(); if (f && RECON_AFTER_RESTORE()) d.sb.History.reconcileFloor(d.Fl.sigOf(f), f.floorL); }
        await bridgeBackfill(d);
        const rows = (d.sb.History.recent(5000) || []).map(canon14).sort(), truth = truthAnchored(d);
        const missing = truth.filter((x) => rows.indexOf(x) < 0), extra = rows.filter((x) => truth.indexOf(x) < 0);
        ok(missing.length === 0 && extra.length === 0, "S14: the " + side.toUpperCase() + " device repairs a table wrong inside its coverage — wrong video, missing and extra rows — to equal the room",
          { missing: missing.map((x) => x.split("|").slice(0, 2).join("|")), extra: extra.map((x) => x.split("|").slice(0, 2).join("|")), missingPi: missingPi }); } }
    { const E = mk(); const hidden = F.reducerEvent("$hiddenJoin", 86, T0 + 86 * MIN + 30000, "@rank80:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "vidHIDDEN000" });
      const all = E.concat([hidden]); const { cps } = await sealsAt(all, [40, 89]);
      TRUTH_E = all.map((e) => e); serveCps(cps);
      { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }   // the channel it cannot read: no hidden join
      results.S15 = await run([["cp", cps[0], BOT], ["cp", cps[1], BOT]].concat(evs(E, 90, 120)), 0);   // it replays the recent timeline, as a device does
      for (const side of ["on", "off"]) { const d = results.S15[side]; await bridgeBackfill(d);
        const rows = (d.sb.History.recent(5000) || []).map(canon14).sort(), truth = truthAnchored(d);
        const missing = truth.filter((x) => rows.indexOf(x) < 0), extra = rows.filter((x) => truth.indexOf(x) < 0);
        ok(missing.length === 0 && extra.length === 0, "S15: a fresh rank-0 " + side.toUpperCase() + " device that cannot read one channel backfills the room's history, floor-anchored",
          { have: rows.length, truth: truth.length, missing: missing.map((x) => x.split("|").slice(0, 2).join("|")), extra: extra.map((x) => x.split("|").slice(0, 2).join("|")) }); } }
    // S16 — THE COST OF VERIFYING (`ddjp_561`): each floor-anchored segment is read once; a later open of an unchanged room
    //       reads nothing; a new floor, or a replaced one, reads only its own segment; a coverage reset re-reads above its cut.
    { const E = mk(); const { cps } = await sealsAt(E, [40, 89, 112]); TRUTH_E = E.map((e) => e);
      { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
      const open = async (floors, snap) => { serveCps(floors); const r = await run(floors.map((c) => ["cp", c, BOT]).concat(evs(E, floors[floors.length - 1].floorL + 1, 120)), BOT);
        const d = r.on; if (snap) d.sb.History.restore(JSON.parse(JSON.stringify(snap))); const p0 = PAGES, e0 = EVENTS_READ; await bridgeBackfill(d);
        const rows = (d.sb.History.recent(5000) || []).map(canon14).sort(), truth = truthAnchored(d);
        return { d: d, pages: PAGES - p0, events: EVENTS_READ - e0, same: JSON.stringify(rows) === JSON.stringify(truth) }; };
      const o1 = await open(cps.slice(0, 2), null);
      const o2 = await open(cps.slice(0, 2), o1.d.sb.History.snapshot());
      const o3 = await open(cps.slice(0, 3), o2.d.sb.History.snapshot());
      const reseal = Object.assign({}, cps[2], { thin: true }); const reseal2 = F.real(o3.d.sb.Floor, Object.assign({}, reseal, { prev: cps[1].h, h: "resealed" }));
      const o4 = await open([cps[0], cps[1], reseal2], o3.d.sb.History.snapshot());
      const snap5 = o4.d.sb.History.snapshot(); const d5 = (await run([["cp", cps[0], BOT], ["cp", cps[1], BOT], ["cp", reseal2, BOT]], BOT)).on;
      d5.sb.History.restore(JSON.parse(JSON.stringify(snap5))); d5.sb.History.reconcileFloor("reset-by-a-replaced-answer", 40);   // a coverage reset at l=40
      serveCps([cps[0], cps[1], reseal2]); const p5 = PAGES; let pages5 = null;
      if (typeof d5.sb.History.verifyIncremental === "function") { await d5.sb.History.verifyIncremental(acceptedChain(d5)); pages5 = PAGES - p5; }   // absent before 561
      console.log("[forgetting-differential] COST S16: page requests / events read — first open " + o1.pages + "/" + o1.events + ", unchanged room " + o2.pages + "/" + o2.events + ", a new floor " + o3.pages + "/" + o3.events + ", a replaced floor " + o4.pages + "/" + o4.events + ", a coverage reset " + pages5);
      ok(o1.same && o1.pages === 2, "S16: the first open verifies each floor-anchored segment once (2 page requests) and equals the room", { pages: o1.pages, same: o1.same });
      ok(o2.same && o2.pages === 0 && o2.events === 0, "S16: a later open of an UNCHANGED room reads NOTHING from the room (0 page requests, 0 events), and still equals it", { pages: o2.pages, events: o2.events, same: o2.same });
      ok(o3.same && o3.pages === 1, "S16: a NEW floor reads only its own segment (1 page request)", { pages: o3.pages, same: o3.same });
      ok(o4.same && o4.pages === 1, "S16: a REPLACED floor (a new fingerprint at the same cut) re-verifies only its segment (1 page request)", { pages: o4.pages, same: o4.same });
      ok(pages5 === 2, "S16: a coverage reset at l=40 re-verifies only the segments above its cut (2 page requests)", pages5); }
    // S17 — THE RANK-0 LISTENER'S LIVE OPEN (`ddjp_562`): a stored table and verified keys from a previous open; l<=60 first,
    //       WITHOUT one join (the listener lacked l=2–11), and an early refresh before it is settled; then the accepted floors with a competing
    //       checkpoint (l=33) and a duplicate (l=40) it holds but does not follow; then the rest; then the bridge's open — refresh,
    //       restore, the cache rebuild, verify. It must equal the room; a second open in the same order must read nothing.
    { // two DJs join for every play, so the rotation keeps songs pending: a missing join shifts later VIDEOS, the chain intact
      const S0 = Object.assign(loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings(), { checkpointEvery: 5, checkpointCooldownMs: 0 });
      const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0 })]; let pv = null, ts = T0;
      for (let l = 2; l <= 120; l++) { const id = "$q" + String(l).padStart(4, "0");
        if (l % 10 === 2 || l % 10 === 3) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@dj" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
        else if (l % 10 === 7) { ts += 5 * MIN; E.push(F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.dj.play", p: pv })); pv = id; }
        else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v" + (l % 7) + ":hs", P, { t: "ddjp.dj.vote", p: pv || "$none" })); } }
      const { cps } = await sealsAt(E, [40, 89]); TRUTH_E = E.map((e) => e); serveCps(cps);
      { const srv = device(false, BOT, null); for (const e of E) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
      const SD0 = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
      const hid = F.reducerEvent("$forkJoin", 4, T0 + 90000, "@forker:hs", O, { t: "ddjp.dj.join", v: "vidFORKED000" });   // first in its rotation
      const prev1 = (await run([["cp", cps[0], BOT], ["cp", cps[1], BOT]].concat(evs(E, 90, 120)), 0)).on;
      const fork = F.real(prev1.sb.Floor, { n: 1, prev: null, h: "fork33", floorL: 33, thin: false, by: "@inspectoronline:hs",
        covers: E[0].eventId + ".." + E.find((e) => e.l === 33).eventId, seed: SD0.buildSeed(E.filter((e) => e.l <= 33).concat([hid]).sort((a, b) => a.l - b.l), undefined) });
      const dup = F.real(prev1.sb.Floor, Object.assign({}, cps[0], { thin: true, h: "dup40" }));
      const held = [fork, cps[0], dup, cps[1]];
      await bridgeBackfill(prev1); const SNAP1 = prev1.sb.History.snapshot();      // the previous, correct open: rows and verified keys
      const listenerOpen = async (snap) => {
        const d = device(true, 0, (a, b) => SERVER_LOG.filter((e) => e.l >= a && e.l <= b)); SETTLED = false;
        for (const e of E.filter((x) => x.l <= 60 && x.l !== 23)) d.SM.ingest(F.toRaw(e));                // the early batch: one join (l=23) not yet here
        d.sb.History.refresh();                                                       // the early refresh, before it is settled
        for (const c of held) d.arrive({ content: c, senderRank: (c === cps[0] || c === cps[1]) ? BOT : 0, sender: (c === cps[0] || c === cps[1]) ? "@bot:hs" : "@other:hs", ts: T0 + c.floorL * MIN });
        for (const e of E.filter((x) => x.l === 23 || x.l > 60)) d.SM.ingest(F.toRaw(e));
        SETTLED = true;
        d.sb.History.refresh(); d.sb.History.restore(JSON.parse(JSON.stringify(snap)));
        { const f = d.Fl.current(); if (f && RECON_AFTER_RESTORE()) d.sb.History.reconcileFloor(d.Fl.sigOf(f), f.floorL); }
        cacheRebuild(d, held, SERVER_LOG);   // by now the listener has received every event: its raw cache holds the room
        const p0 = PAGES; await bridgeBackfill(d);
        const rows = (d.sb.History.recent(5000) || []).map(canon14).sort(), truth = truthAnchored(d);
        return { d: d, pages: PAGES - p0, missing: truth.filter((x) => rows.indexOf(x) < 0).map((x) => x.split("|").slice(0, 2).join("|")), extra: rows.filter((x) => truth.indexOf(x) < 0).map((x) => x.split("|").slice(0, 2).join("|")) }; };
      const L1 = await listenerOpen(SNAP1);
      ok(!L1.missing.length && !L1.extra.length, "S17: the rank-0 listener's live open — early refresh, a cache rebuild over a competing and a duplicate checkpoint, a stored table already verified — ends equal to the room",
        { missing: L1.missing, extra: L1.extra });
      const L2 = await listenerOpen(L1.d.sb.History.snapshot());
      console.log("[forgetting-differential] COST S17: the listener's second open read " + L2.pages + " page request(s)");
      ok(!L2.missing.length && !L2.extra.length && L2.pages === 0, "S17: and its second open, in the same order, still equals the room and reads NOTHING (0 page requests)",
        { pages: L2.pages, missing: L2.missing, extra: L2.extra }); }
    // S18 — THE CLOSING FLOOR'S BANKED SONG (`ddjp_563`, the owner's rule): a late join makes the segment's fold refuse the play the
    //       floor banks (the J71 race). The room's account has the floor's song; verify keeps it; a table that lost it regains it.
    { const ev2 = (id, l, ts, who, rank, c) => F.reducerEvent(id, l, ts, who, rank, c);
      const S0 = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
      const R = [ev2("$set", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S0.defaultSettings() }),
        ev2("$jA", 2, T0 + MIN, "@a:hs", O, { t: "ddjp.dj.join", v: "vidSONGAAAAA" }), ev2("$pA", 3, T0 + 2 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: null }),
        ev2("$jK", 4, T0 + 3 * MIN, "@k:hs", P, { t: "ddjp.dj.join", v: "vidLATEJOIN0" }), ev2("$p94", 5, T0 + 12 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$pA" }),
        ev2("$jB", 6, T0 + 13 * MIN, "@b:hs", O, { t: "ddjp.dj.join", v: "GtLkXIzMQck" }), ev2("$X", 7, T0 + 34 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: null }),
        ev2("$jC", 9, T0 + 35 * MIN, "@c:hs", O, { t: "ddjp.dj.join", v: "vidSONGCCCCC" }), ev2("$N", 11, T0 + 45 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$X" }),
        ev2("$jD", 12, T0 + 46 * MIN, "@d:hs", O, { t: "ddjp.dj.join", v: "vidSONGDDDDD" }), ev2("$M", 13, T0 + 55 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$N" }),
        ev2("$jE", 14, T0 + 56 * MIN, "@e:hs", O, { t: "ddjp.dj.join", v: "vidSONGEEEEE" }), ev2("$Q", 15, T0 + 65 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$M" })];
      const base = device(false, BOT, null);
      const seedA = S0.buildSeed(R.filter((e) => e.l <= 8 && e.eventId !== "$jK"), undefined);           // sealed without the late join: banks X
      const FA = F.real(base.sb.Floor, { n: 1, prev: null, h: "fA", floorL: 8, thin: false, by: "@o:hs", covers: "$set..$X", seed: seedA });
      const FB = F.real(base.sb.Floor, { n: 2, prev: FA.h, h: "fB", floorL: 13, thin: false, by: "@o:hs", covers: "$jC..$M", seed: S0.buildSeed(R.filter((e) => e.l > 8 && e.l <= 13), seedA) });
      TRUTH_E = R.map((e) => e); serveCps([FA, FB]);
      { const srv = device(false, BOT, null); for (const e of R) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
      const k3 = (x) => x.split("|").slice(0, 3).join("|");
      const openWith = async (snap) => { const r = await run([["cp", FA, BOT], ["cp", FB, BOT]].concat(evs(R, 14, 15)), BOT); const d = r.on;
        if (snap) d.sb.History.restore(JSON.parse(JSON.stringify(snap)));
        const p0 = PAGES; await bridgeBackfill(d); const rows = (d.sb.History.recent(5000) || []).map(canon14).map(k3).sort(), truth = truthAnchored(d).map(k3);
        return { d: d, pages: PAGES - p0, hasX: rows.some((x) => x.indexOf("$X|GtLkXIzMQck") === 0), same: JSON.stringify(rows) === JSON.stringify(truth), rows: rows }; };
      ok(truthAnchored(base).some((x) => x.indexOf("$X|GtLkXIzMQck") === 0), "S18 PREMISE — the room's account has the closing floor's banked song", truthAnchored(base));
      const fresh = await openWith(null);
      const lost = fresh.d.sb.History.snapshot(); lost.rows = lost.rows.filter((r) => r.pi !== "$X");          // a table whose verify deleted it
      const oldKeys = {}; for (const k of Object.keys(lost.verified || {})) oldKeys[k.replace(/^v2\|/, "")] = lost.verified[k]; lost.verified = oldKeys;   // marks of the older rule
      const regained = await openWith(lost);
      ok(regained.hasX && regained.same, "S18: a table that lost the floor's banked song REGAINS it, and equals the room", { hasX: regained.hasX, rows: regained.rows });
      ok(fresh.hasX && fresh.same, "S18: verify KEEPS the floor's banked song — it never deletes a row a floor banks", { hasX: fresh.hasX, rows: fresh.rows });
      const again = await openWith(regained.d.sb.History.snapshot());
      ok(again.same && again.pages === 0, "S18: and a second open reads nothing and corrects nothing", { pages: again.pages, same: again.same }); }
    // S19 — AN OWNER OVERRIDE (`ddjp_564`, J28, the owner's ruling: history starts fresh at the origin floor). A late-join race below the
    //       cut; two old floors; an override at l=20 (an import floor: prev null, thin, the file's own now-playing song); then 26 floors —
    //       more than Floor remembers (24). Four devices, one history, starting at the cut; a second open reads and corrects nothing.
    { const ev2 = (id, l, ts, who, rank, c) => F.reducerEvent(id, l, ts, who, rank, c);
      const S0 = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
      const set0 = S0.defaultSettings();
      const R = [ev2("$set", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: set0 }),
        ev2("$jA", 2, T0 + MIN, "@a:hs", O, { t: "ddjp.dj.join", v: "vidSONGAAAAA" }), ev2("$pA", 3, T0 + 2 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: null }),
        ev2("$jK", 4, T0 + 3 * MIN, "@k:hs", P, { t: "ddjp.dj.join", v: "vidLATEJOIN0" }), ev2("$p94", 5, T0 + 12 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$pA" }),
        ev2("$jB", 6, T0 + 13 * MIN, "@b:hs", O, { t: "ddjp.dj.join", v: "GtLkXIzMQck" }), ev2("$X", 7, T0 + 34 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: null }),
        ev2("$jC", 9, T0 + 35 * MIN, "@c:hs", O, { t: "ddjp.dj.join", v: "vidSONGCCCCC" }), ev2("$N", 11, T0 + 45 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$X" }),
        ev2("$jD", 12, T0 + 46 * MIN, "@d:hs", O, { t: "ddjp.dj.join", v: "vidSONGDDDDD" }), ev2("$M", 13, T0 + 55 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: "$N" }),
        ev2("$ov", 20, T0 + 60 * MIN, "@o:hs", O, { t: "ddjp.room.settings", s: set0 })];                  // the override's settings, at l=20
      // the FILE: its own room, its own now-playing song, its own queue
      const fileRoom = [ev2("$fs", 1, T0 - 900 * MIN, "@o:hs", O, { t: "ddjp.room.settings", s: set0 }), ev2("$fj", 2, T0 - 899 * MIN, "@f:hs", O, { t: "ddjp.dj.join", v: "vidFILEZZZZZ" }),
        ev2("$fileZ", 3, T0 - 898 * MIN, "@o:hs", O, { t: "ddjp.dj.play", p: null }), ev2("$fq", 4, T0 - 897 * MIN, "@g:hs", O, { t: "ddjp.dj.join", v: "vidFILEQQQQQ" })];
      const fileSeed = S0.buildSeed(fileRoom, undefined);
      let pv = "$fileZ", ts = T0 + 61 * MIN;
      for (let l = 21; l <= 60; l++) { const id = "$o" + l; ts += 4 * MIN;
        if (l % 3 === 0) R.push(ev2(id, l, ts, "@o:hs", O, { t: "ddjp.dj.play", p: pv })), pv = id;
        else R.push(ev2(id, l, ts, "@dj" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
      const base = device(false, BOT, null);
      const FA = F.real(base.sb.Floor, { n: 1, prev: null, h: "fA", floorL: 8, thin: false, by: "@o:hs", covers: "$set..$X", seed: S0.buildSeed(R.filter((e) => e.l <= 8 && e.eventId !== "$jK"), undefined) });
      const FB = F.real(base.sb.Floor, { n: 2, prev: FA.h, h: "fB", floorL: 13, thin: false, by: "@o:hs", covers: "$jC..$M", seed: S0.buildSeed(R.filter((e) => e.l > 8 && e.l <= 13), FA.seed) });
      const IMP = F.real(base.sb.Floor, { n: 1, prev: null, h: "imp", floorL: 20, thin: true, by: "@o:hs", covers: "$ov..$ov", seed: fileSeed });
      const G = []; let prevF = IMP;
      for (let c = 22; c <= 47; c++) { const g = F.real(base.sb.Floor, { n: G.length + 2, prev: prevF.h, h: "g" + c, floorL: c, thin: false, by: "@o:hs", covers: "$o" + (prevF.floorL + 1) + "..$o" + c,
        seed: S0.buildSeed(R.filter((e) => e.l > prevF.floorL && e.l <= c), prevF.seed) }); G.push(g); prevF = g; }
      const ALL = [FA, FB, IMP].concat(G);
      TRUTH_E = R.map((e) => e); serveCps(ALL);
      { const srv = device(false, BOT, null); for (const e of R) srv.SM.ingest(F.toRaw(e)); SERVER_LOG = srv.SM.getLog().slice(); }
      // J79: the override is the room owner's own restore, so the owner carries it (`@o:hs`, the creator) — an origin carried by
      // anyone else is refused at the door now, and S19 is about a restore that happened, not one that was refused.
      const cpEv = (c) => (c === IMP ? { content: c, senderRank: O, sender: "@o:hs", ts: T0 + c.floorL * MIN } : { content: c, senderRank: BOT, sender: "@bot:hs", ts: T0 + c.floorL * MIN });
      const k3 = (r) => [r.pi, r.videoId, r.at].join("|");   // the reducer's own row shape
      AWAIT_OPEN = true;
      const k2 = (x) => x.split("|").slice(0, 2).join("|");   // against the harness truth: play and video
      const open = async (kind, snap) => {
        const d = device(kind !== "all", BOT, (a, b) => SERVER_LOG.filter((e) => e.l >= a && e.l <= b));
        SETTLED = false;   // the replay arrives unsettled, as on a real device: the trim hand-off waits
        if (kind === "all") { for (const e of R.filter((x) => x.l <= 13)) d.SM.ingest(F.toRaw(e)); d.arrive(cpEv(FA)); d.arrive(cpEv(FB)); for (const e of R.filter((x) => x.l > 13)) d.SM.ingest(F.toRaw(e)); }
        else if (kind === "trimmed") { for (const e of R.filter((x) => x.l <= 13 && x.eventId !== "$jK")) d.SM.ingest(F.toRaw(e)); d.arrive(cpEv(FA)); d.arrive(cpEv(FB)); for (const e of R.filter((x) => x.l > 13)) d.SM.ingest(F.toRaw(e)); }
        else { for (const e of R.filter((x) => x.l > 20)) d.SM.ingest(F.toRaw(e)); }
        d.arrive(cpEv(IMP)); d.__originAdopted = !!(d.Fl.current() && d.Fl.current().h === IMP.h); for (const g of G) d.arrive(cpEv(g));
        SETTLED = true;
        if (snap) d.sb.History.restore(JSON.parse(JSON.stringify(snap)));
        cacheRebuild(d, ALL, SERVER_LOG);
        const _vi = d.sb.History.verifyIncremental; d.sb.History.verifyIncremental = async (c) => { const r = await _vi(c); d.__v = r; return r; };
        const p0 = PAGES; await bridgeBackfill(d);
        const rows = (d.sb.History.recent(5000) || []).map(k3).sort();
        const truth = truthAnchored(d).map(k2).sort();
        const audit = d.sb.History.auditAgainst(SERVER_LOG.concat(SERVER_CPS), { anchors: acceptedAnchors(d) });
        return { d: d, pages: PAGES - p0, rows: rows, same: JSON.stringify(rows.map(k2).sort()) === JSON.stringify(truth), audit: audit, truth: truth, v: d.__v }; };
      // J79: A TABLE A REAL OPEN LEAVES. This was folded and snapshotted without the open's verify, so it carried no origin and no
      // verified marks — and a device holding no origin always pages for one, so the hole a REAL table opens never showed: it
      // records the room's start as its origin, and a chain starting above the override read that start as its own (measured in
      // a bot room, `check-bot-restore` PART F). Now opened as the bridge opens it, against the room as it stood then (l <= 13).
      const pre = await (async () => { const d = device(true, BOT, null); for (const e of R.filter((x) => x.l <= 13 && x.eventId !== "$jK")) d.SM.ingest(F.toRaw(e)); d.arrive(cpEv(FA)); d.arrive(cpEv(FB));
        const _sl = SERVER_LOG, _sc = SERVER_CPS; SERVER_LOG = _sl.filter((e) => e.l <= 13); SERVER_CPS = _sc.filter((c) => c.content.floorL <= 13);
        try { await bridgeBackfill(d); } finally { SERVER_LOG = _sl; SERVER_CPS = _sc; }
        return d.sb.History.snapshot(); })();   // a stored table from BEFORE the override
      ok(pre.origin && pre.origin.start === true && Object.keys(pre.verified || {}).length > 0,
        "S19 PREMISE — the table stored before the override is one a real open leaves: the room's start as its origin, and verified marks", { origin: pre.origin, marks: Object.keys(pre.verified || {}).length });
      const devs = { all: await open("all"), trimmed: await open("trimmed"), joined: await open("joined"), restored: await open("joined", pre) };
      const names = Object.keys(devs), ref = devs.all;
      ok(ref.truth.length > 0 && ref.truth.some((x) => x.indexOf("$fileZ|vidFILEZZZZZ") === 0) && !ref.truth.some((x) => /^\$(pA|p94|X|N|M)\|/.test(x)),
        "S19 PREMISE — the room's history starts at the origin: the file's banked song first, nothing from below the cut", ref.truth);
      if (process.env.S19DBG) { const r = ref.rows, tr = ref.truth; console.log("S19DBG missing=" + JSON.stringify(tr.filter((x) => r.indexOf(x) < 0)) + " extra=" + JSON.stringify(r.filter((x) => tr.indexOf(x) < 0)));
        const d2 = devs.all.d; const snap = d2.sb.History.snapshot(); console.log("S19DBG keys=" + Object.keys(snap.verified || {}).length + " origin=" + JSON.stringify(snap.origin && { l: snap.origin.l, start: snap.origin.start, banked: snap.origin.banked && snap.origin.banked.pi }) + " chain=" + resolvedChain(d2).map((c) => c.h + (c.origin ? "*" : "")).slice(0, 4).join(",") + "… n=" + resolvedChain(d2).length + " mem=" + memChain(d2.Fl).length); }
      // J79: the origin must be ADOPTED at the door on every device — the chain the harness walks reaches it whether or not Floor
      // took it, so without this a refused restore would still read as a fresh history here.
      for (const n of names) ok(devs[n].d.__originAdopted === true, "S19: the " + n.toUpperCase() + " device adopted the owner's origin when it arrived", { adopted: devs[n].d.__originAdopted });
      for (const n of names) ok(devs[n].same, "S19: the " + n.toUpperCase() + " device's history is the room's from the origin floor's cut onward", { rows: devs[n].rows, truth: devs[n].truth });
      ok(names.every((n) => JSON.stringify(devs[n].rows) === JSON.stringify(ref.rows)), "S19: all four devices hold the SAME history", names.map((n) => devs[n].rows.length));
      for (const n of names) { const a = devs[n].audit; ok(a.missing.length === 0 && a.extra.length === 0 && a.differs.length === 0 && a.truthCount === a.deviceCount,
        "S19: the audit shows truth = device on the " + n.toUpperCase() + " device", { truth: a.truthCount, device: a.deviceCount, missing: a.missing.map((r) => r.pi), extra: a.extra.map((r) => r.pi) }); }
      const again = { all: await open("all", devs.all.d.sb.History.snapshot()), trimmed: await open("trimmed", devs.trimmed.d.sb.History.snapshot()),
                      joined: await open("joined", devs.joined.d.sb.History.snapshot()), restored: await open("joined", devs.restored.d.sb.History.snapshot()) };
      console.log("[forgetting-differential] COST S19: second opens read " + names.map((n) => n + " " + again[n].pages).join(", ") + " page request(s)");
      if (process.env.S19DBG) for (const n of ["all", "trimmed"]) { const a = again[n].rows, r = ref.rows; console.log("S19DBG " + n + " second: same-as-truth=" + again[n].same + " | lost=" + JSON.stringify(r.filter((x) => a.indexOf(x) < 0).slice(0, 3)) + " gained=" + JSON.stringify(a.filter((x) => r.indexOf(x) < 0).slice(0, 3)) + " | v=" + JSON.stringify(again[n].v)); }
      if (process.env.S19DBG) console.log("S19DBG first verify " + JSON.stringify(devs.all.v) + " | second " + JSON.stringify(again.all.v));
      for (const n of names) ok(again[n].same && again[n].pages === 0 && JSON.stringify(again[n].rows) === JSON.stringify(ref.rows),
        "S19: the " + n.toUpperCase() + " device's second open reads nothing, corrects nothing, and still holds the same history", { pages: again[n].pages, same: again[n].same });
      AWAIT_OPEN = false; }
    SERVER_CPS = null; SCEN_CPS = null; }
  // ── THE BASELINE (today's forgetting, Step A as shipped) ──
  // S4 WAS PINNED AT `ev@75` (`ddjp_549`): a trimmed device whose quorum floor broke went stale on the dishonest floor while
  // the never-forgetting one retreated. Retreat by proof (`ddjp_550`) flips it to IDENTICAL — removed deliberately.
  const PINNED = {};
  const NOT_IDENTITY = { S4e: "the server supplied nothing: the device must STAY, not match a device that never forgot" };
  for (const name of Object.keys(results)) {
    if (NOT_IDENTITY[name]) { console.log("[forgetting-differential] " + name + ": " + NOT_IDENTITY[name]); continue; }
    const r = results[name], pin = PINNED[name];
    console.log("[forgetting-differential] BASELINE " + name + ": " + (r.first ? "DIFFERS at step " + r.first.step + " (" + r.first.op + ", " + r.first.what + ")" : "identical over " + r.steps + " steps") +
      " | held ON " + r.onHeld + " / OFF " + r.offHeld + " (max ON " + r.maxHeld + ")");
    if (pin) ok(!!r.first && r.first.what === pin.what && r.first.op === pin.op, name + ": the pinned baseline divergence is exactly as recorded — " + pin.reason, r.first);
    else ok(!r.first, name + ": forgetting on and off give identical state and history at every step", r.first);
  }
  // S5 is identical but the forgetting device never forgets in the owner's order (banked) — recorded; plan step 5 removes it.
  // CHANGED AT STEP 5b (`ddjp_554`): the owner's order now FORGETS — from its SECOND floor (a fresh open cannot prove its first).
  ok(results.S5.onHeld < results.S5.offHeld && results.S5.on.SM._trimState() === 66, "S5: the owner's arrival order forgets, from its second floor (l=66)",
    { onHeld: results.S5.onHeld, offHeld: results.S5.offHeld, trimmedAt: results.S5.on.SM._trimState() });
  { const b = results.S4b.on, c = results.S4c.on, d = results.S4d.on, e = results.S4e.on;
    ok(b.last && b.last.ok === true && (b.Fl.current() || {}).floorL === 17 && b.fetches.length > 0, "S4b: the device that forgot past n=1 fetched back and stood on it, proved", { last: b.last, fetches: b.fetches });
    ok(c.last && c.last.ok === true && c.last.tried >= 2 && (c.Fl.current() || {}).floorL === 17, "S4c: a fetched floor that does not prove itself is skipped, and fetching continues to one that does", c.last);
    ok(d.last && d.last.ok === true && (d.Fl.current() || {}).floorL === 40 && d.last.fetchedFrom === 17 && d.fetches.every(([a]) => a >= 17),
      "S4d: fetching stops at the first floor that proves itself, never further", { last: d.last, fetches: d.fetches });
    ok(e.last && e.last.reason === "stay" && e.Fl.grade() === "stale" && e.SM.trimToFloor() === 0, "S4e: when the server cannot supply events, the last resort is reached: stay, and stop forgetting", { last: e.last, grade: e.Fl.grade() }); }
  { const q = results.S8.on;
    ok(q.Fl.current() && q.Fl.current().floorL === 40 && q.Fl.grade() === "quorum" && q.SM._trimState() === 40,
      "S8 PREMISE — the honest quorum floor at 40 was adopted and trimmed under", { floor: q.Fl.current() && q.Fl.current().floorL, grade: q.Fl.grade(), trimmed: q.SM._trimState() });
    ok(q.Fl.grade() === "quorum" && q.fetches.length === 0, "S8: an honest quorum floor re-checked after a trim HOLDS — no stale, no fetch", { grade: q.Fl.grade(), fetches: q.fetches });
    ok(q.SM.proofLog().length === q.SM.getLog().length + 1, "S8: the forgetting device keeps exactly one more event than it holds — the floor's boundary", { proof: q.SM.proofLog().length, held: q.SM.getLog().length }); }
  ok(results.S6.on.SM.proofLog().length === results.S6.on.SM.getLog().length, "S6: under owner floors nothing extra is kept — the proof is for quorum floors only", { proof: results.S6.on.SM.proofLog().length, held: results.S6.on.SM.getLog().length });
  ok(results.S6.seals >= 20 && results.S6.maxHeld <= 2 * 40 + 10 && results.S6.offHeld === 1000, "S6: over 1,000 events the forgetting device's held log stays bounded (two cadences plus a tail)", { maxHeld: results.S6.maxHeld, off: results.S6.offHeld, seals: results.S6.seals });
  { const diff = results.S12diff, last = results.S12last;
    const rows = (last.sb.History.recent(5000) || []).map((r) => [r.pi, r.videoId, r.startedAt, r.endedAt || null].join("|")).sort(), truth = results.S12truth;
    if (process.env.S12DBG) for (const [i, m] of results.S12seen.entries()) console.log("S12SEQ reload " + i + ": rows=" + m.rows.length + " count=" + m.count + " addsKeys=" + Object.keys(JSON.parse(m.adds)).length + " addsLKeys=" + Object.keys(JSON.parse(m.addsL)).length + " countsLen=" + m.counts.length + " np=" + m.np + " rowCounts=" + m.rows.map((r) => r.split("|")[4]).join(",").slice(0, 120));
    if (process.env.S12DBG) console.log("S12DBG", JSON.stringify(diff ? { reload: diff.reload, field: diff.field, before: typeof diff.before === "string" ? diff.before.slice(0, 400) : diff.before, after: typeof diff.after === "string" ? diff.after.slice(0, 400) : diff.after } : "no change"));
    ok(!diff, "S12: repeated reloads mid-song change NOTHING — history rows and count, add records, vote counts, state", diff && { reload: diff.reload, field: diff.field });
    ok(JSON.stringify(rows) === JSON.stringify(truth), "S12: and after the reloads the song history equals the truth",
      { have: rows.length, truth: truth.length, missing: truth.filter((x) => rows.indexOf(x) < 0).map((x) => x.split("|")[0]), extra: rows.filter((x) => truth.indexOf(x) < 0).map((x) => x.split("|").slice(0, 2).join("|")) }); }
  if (failed) { console.log("[forgetting-differential] " + failed + " failure(s)"); process.exit(1); }
  console.log("[forgetting-differential] PASS — forgetting on and off are identical at every step in every scenario except the pinned baseline, and memory stays bounded (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[forgetting-differential] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
