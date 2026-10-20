// tests/check-side-messages.js
// SUBJECT: backends/backend1/vouch.js, backends/backend1/checkpoint.js, backends/backend1/eventcache.js, backends/backend1/matrixbridge.js, backends/backend2/authority.js, backends/backend2/transport.js
//
// WALL: A SIDE MESSAGE RIDES THE ROOM'S CHANNELS AND TOUCHES NOTHING OF THE ROOM (J84, hooks E1 and E2; the owner's
// ruling 21). A `ddjp.side.*` type is a CLASS the engines know by prefix and nothing more: it is never folded, never in a
// seed or a fingerprint, never vouched, witnessed or counted toward a seal, evicted first, and in a bot room it is the
// runner's own — refused as a client's intent, sent alone through the ordered gate, never merged or batched. The
// engines never learn which feature a side type belongs to; REP is the first user, `check-rep-boundary` keeps its name
// out of them.
//
//   A  THE CLASS: `Vouch.isSide` by prefix, with near-misses refused; non-critical, never eligible to vouch, never
//      carrying a witness bundle — each beside a critical control that does.
//   B  INERT IN STATE, SEED AND FINGERPRINT: a log with side messages folds to the same state and seed as without, so
//      the fingerprint over that seed is the same.
//   C  NOT THE SEAL CADENCE: `Checkpoint._countable` skips them (the bot room's runner counts through it too).
//   D  EVICTED FIRST: the raw cache files them in the non-critical tier.
//   E  A BOT ROOM'S JUDGE: classified as the runner's own, so a client's intent carrying one is refused, needs no send
//      row, and the policy still validates.
//   F  SENT (backend1, `MatrixBridge.sendSide`): refused for a non-side type, a missing body, a reserved field, no
//      owner-level channel, or an account that cannot write it; otherwise ONE message on `events_owner`, its body
//      unchanged, with no witness bundle.
//   G  SENT (backend2): through the runner's gate as a raw item — alone, in order with a relay batch, never merged into
//      it — and refused when no runner runs for this room on this tab.
"use strict";
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[side-messages] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const noop = () => {};
const quiet = { info: noop, warn: noop, error: noop, debug: noop };
const SIDE = "ddjp.side.test.note";

// ── A — THE CLASS ────────────────────────────────────────────────────────────────────────────────────────────────────
const V = loadInContext(["backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "core/playlistdoc.js", "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js"],
  { Logger: quiet, Date }).Vouch;
{
  ok(V.SIDE_PREFIX === "ddjp.side.", "A: the class is the prefix `ddjp.side.`", V.SIDE_PREFIX);
  ok(V.isSide(SIDE) && V.isSide("ddjp.side.rep.summary"), "A: a `ddjp.side.*` type is a side type");
  ok(!V.isSide("ddjp.sidecar") && !V.isSide("ddjp.dj.vote") && !V.isSide("x.ddjp.side.y") && !V.isSide(null),
    "A: and near-misses are not — the prefix is matched whole, at the start");
  ok(V.isNonCritical(SIDE) && V.isNonCritical("ddjp.dj.vote") && !V.isNonCritical("ddjp.dj.play"),
    "A: a side type is non-critical, beside a vote (listed) and a play (critical)");
  ok(V.carries(SIDE) === false && V.carries("ddjp.dj.play") === true,
    "A: a side message never carries a witness bundle; a play (the control) does");
  // RE-AIMED AT J84-1's break run (the reason): this row gave the side message no sender, so `eligible` refused it before
  // it read the type, and `mutate-j84-rep` RE5 (the class dropped from `eligible`) stayed green. Now a sender below the
  // owner rung, which the owner exemption cannot answer for, beside a play from the same sender (the control).
  const body = (t) => ({ t: t, l: 5 });
  const raw = (id, t) => ({ event_id: id, l: 5, sender: "@someone:hs", senderRank: 20, content: { body: JSON.stringify(body(t)) } });
  ok(V.eligible && V.eligible(raw("$p", "ddjp.dj.play")) === true, "A: APPLIED — a play from a sender below the owner rung is eligible (the control)");
  ok(V.eligible && V.eligible(raw("$s", SIDE)) === false, "A: nor is a side message ever eligible to be vouched for, whoever sent it");
  // ADDED AT J84-1's break run (the reason): `owed`'s turn positions are read from the class too (RE6b left this green).
  // The head — the newest few critical events, covered at once — must not move when side messages arrive.
  const held = [1, 2, 3, 4, 5].map((l) => Object.assign(raw("$p" + l, "ddjp.dj.play"), { l: l }));
  const sides = [6, 7, 8, 9].map((l) => Object.assign(raw("$s" + l, SIDE), { l: l }));
  const head = (h) => { const o = V.owed(h, { myRank: 60, myUserId: "@me:hs", settings: {}, floorL: null, rng: () => 0.5 }); return o && o.headFloor; };
  ok(typeof head(held) === "number" && head(held) === head(held.concat(sides)),
    "A: and a side message is not a turn — the head of the turn ladder is the same with side messages beside the plays",
    [head(held), head(held.concat(sides))]);
}

// ── B — INERT IN STATE, SEED AND FINGERPRINT ────────────────────────────────────────────────────────────────────────
{
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js"], {});
  const room = F.playingRoom({ songs: 3 });
  const withSide = room.log.slice();
  let l = room.lastL;
  withSide.push(F.reducerEvent("$side1", ++l, 999000, "@bot:hs", 99, { t: SIDE, v: 1, rows: [["@a:hs", 3]] }));
  withSide.push(F.reducerEvent("$side2", ++l, 999100, "@bot:hs", 99, { t: "ddjp.side.rep.summary", v: 1, n: 1 }));
  const s0 = sb.StateDeriver.derive(room.log, null), s1 = sb.StateDeriver.derive(withSide, null);
  ok(JSON.stringify(s0.rotation) === JSON.stringify(s1.rotation) && JSON.stringify(s0.nowPlaying) === JSON.stringify(s1.nowPlaying) &&
     JSON.stringify(s0.settings) === JSON.stringify(s1.settings) && JSON.stringify(s0.counts) === JSON.stringify(s1.counts),
    "B: side messages change no derived state (rotation, now playing, settings, counts)");
  const seed0 = sb.StateDeriver.buildSeed(room.log, null), seed1 = sb.StateDeriver.buildSeed(withSide, null);
  ok(JSON.stringify(seed0) === JSON.stringify(seed1), "B: nor the seed a checkpoint would carry");
  const fp = (seed) => sb.CheckpointFormat.fingerprint(1, null, seed, l, false, "$join..$side2");
  ok(fp(seed0) === fp(seed1), "B: so the fingerprint over that seed is the same");
  ok(sb.StateDeriver.HANDLED_TYPES.indexOf(SIDE) < 0 && !sb.StateDeriver.HANDLED_TYPES.some((t) => t.indexOf("ddjp.side.") === 0),
    "B: and no side type is a handled type — the reducer has never heard of the class");
}

// ── C — NOT THE SEAL CADENCE ────────────────────────────────────────────────────────────────────────────────────────
{
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/dials.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/continuity.js", "backends/backend1/checkpoint.js"], { Date });
  const plays = [1, 2, 3].map((i) => F.reducerEvent("$p" + i, i, i * 1000, "@a:hs", 20, { t: "ddjp.dj.play", p: null }));
  const sides = [4, 5, 6, 7].map((i) => F.reducerEvent("$s" + i, i, i * 1000, "@bot:hs", 99, { t: SIDE, v: 1 }));
  const n0 = sb.Checkpoint._countable(plays), n1 = sb.Checkpoint._countable(plays.concat(sides));
  ok(n0 === 3, "C: APPLIED — three plays count toward the seal cadence (the control)", n0);
  ok(n1 === n0, "C: and four side messages beside them count for nothing — a sender cannot hurry the room's seals", n1);
}

// ── D — EVICTED FIRST ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "core/playlistdoc.js", "backends/backend1/session.js", "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js", "backends/backend1/eventcache.js"],
    { Logger: quiet, Date, Floor: { current: () => null },
      StreamManager: { getState: () => ({ settings: {} }), seedValidation: () => ({ status: "not-yet-run" }),
        seedLicensesForget: () => false, forgettingLicensed: () => false } });
  sb.EventCache.store(F.rawEvent("$v1", 1, 1000, "@b:hs", 20, { t: "ddjp.dj.vote", p: "$x" }));
  sb.EventCache.store(F.rawEvent("$p1", 2, 2000, "@a:hs", 20, { t: "ddjp.dj.play", p: null }));
  const before = sb.EventCache.dryRunEviction().tiers;
  sb.EventCache.store(F.rawEvent("$s1", 3, 3000, "@bot:hs", 99, { t: SIDE, v: 1 }));
  const after = sb.EventCache.dryRunEviction().tiers;
  const n = (t) => (t && t.nonCritical) ? t.nonCritical.n : null;
  ok(n(before) === 1, "D: APPLIED — the vote is in the non-critical tier and the play is not (the control)", before);
  ok(n(after) === 2, "D: and a side message joins the vote in the tier dropped first", after);
}

// ── E — A BOT ROOM'S JUDGE ──────────────────────────────────────────────────────────────────────────────────────────
function botAuthority() {
  return loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js", "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend2/authority.js"], { Date });
}
{
  const sb = botAuthority();
  const A = sb.B2Authority;
  const c = A.classify(SIDE);
  ok(!!c && c.bot === true, "E: a side type is classified as the runner's own", c);
  ok(A.classify("ddjp.sidecar") === null, "E: a near-miss stays unclassified");
  const v = A.evaluate({ t: SIDE, actor: "@owner:hs", v: 1 }, { settings: {} }, 100, null);
  ok(v && v.ok === false && /only the runner/.test(v.reason || ""),
    "E: so a client's intent carrying one is refused — the owner's included — as claiming to be the runner", v);
  ok(A.validatePolicy().length === 0, "E: and the send table still validates: a side type needs no send row", A.validatePolicy());
  ok(!A.policyOf("ddjp.rep.snapshot") && A.classify("ddjp.rep.snapshot") === null,
    "E: J19's `ddjp.rep.snapshot` is gone from both tables (retired at J84, never published)");
}

// ── F — SENT, backend1 ──────────────────────────────────────────────────────────────────────────────────────────────
function fakeRoom(id, name, users, sendLevel) {
  return { roomId: id, name: name, timeline: [], findEventById: () => null,
    currentState: { getStateEvents: (type) => type === "m.room.power_levels"
      ? { getContent: () => ({ users: users, users_default: 0, events: { "m.room.message": sendLevel }, events_default: 0 }) } : null },
    getMyMembership: () => "join" };
}
function bridge(me) {
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js"], {
    Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined, matrixcs: {}, navigator: {} });
  const rooms = {
    "!own": fakeRoom("!own", "events-owner", { "@bot:hs": 99 }, 99),
    "!unc": fakeRoom("!unc", "events-uncategorized", {}, 0),
  };
  const sent = [];
  sb.MatrixBridge._setClientForTest({ getUserId: () => me, getRoom: (id) => rooms[id] || null, getRooms: () => Object.values(rooms),
    scrollback: async () => {}, sendMessage: async (roomId, content) => { sent.push({ roomId: roomId, content: content }); return { event_id: "$sent" + sent.length }; } });
  return { MB: sb.MatrixBridge, sent: sent, channels: { events_owner: "!own", events_uncategorized: "!unc" } };
}
async function partF() {
  const b = bridge("@bot:hs");
  const no = async (type, body, ch, want) => { const r = await b.MB.sendSide(ch || b.channels, type, body); return r && r.ok === false && (!want || want.test(r.reason || "")) ? null : r; };
  ok(await no("ddjp.dj.vote", { p: "$x" }, null, /side type/) === null, "F: a non-side type is refused — this door sends side messages only");
  ok(await no(SIDE, null, null, /body/) === null && await no(SIDE, [1], null, /body/) === null, "F: a missing or non-object body is refused");
  for (const k of ["t", "l", "actor", "src", "p", "w"]) {
    ok(await no(SIDE, { v: 1, [k]: 1 }, null, new RegExp("reserved field " + k)) === null,
      "F: a body carrying `" + k + "` is refused — the transport stamps it, or a relayed act carries it");
  }
  ok(await no(SIDE, { v: 1 }, { events_uncategorized: "!unc" }, /owner-level/) === null, "F: with no owner-level channel it is refused");
  ok(b.sent.length === 0, "F: and nothing was sent by any refusal", b.sent);
  const r = await b.MB.sendSide(b.channels, SIDE, { v: 1, rows: [["@a:hs", 2]] });
  ok(r && r.ok === true, "F: the bot (99, writes the owner-level channel) sends one", r);
  ok(b.sent.length === 1 && b.sent[0].roomId === "!own", "F: as ONE message on `events_owner`", b.sent.map((s) => s.roomId));
  let body = null; try { body = JSON.parse(b.sent[0].content.body); } catch (e) {}
  ok(!!body && body.t === SIDE && body.v === 1 && JSON.stringify(body.rows) === JSON.stringify([["@a:hs", 2]]) && !("w" in body) && !("og" in body),
    "F: its body arrives unchanged under its type, with no witness bundle", body);
  const p = bridge("@person:hs");
  const pr = await p.MB.sendSide(p.channels, SIDE, { v: 1 });
  ok(pr && pr.ok === false && /cannot write/.test(pr.reason || "") && p.sent.length === 0,
    "F: an account that cannot write the owner-level channel is refused, and sends nothing", pr);
}

// ── G — SENT, backend2 ──────────────────────────────────────────────────────────────────────────────────────────────
async function partG() {
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js", "backends/backend2/authority.js",
    "backends/backend2/transport.js"], {
    Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined, matrixcs: {}, navigator: {},
    B2Runner: { running: () => runnerOn, room: () => ({ log: "!own", intents: "!unc", spaceId: "!space" }) } });
  let runnerOn = false;
  const A = sb.B2Authority, MB = sb.B2MatrixBridge;
  const out = [];
  A.reset(); A.attach((type, payload) => { out.push({ type: type, payload: payload }); return Promise.resolve({ eventId: "$c" + out.length }); });
  const ch = { events_owner: "!own", events_uncategorized: "!unc" };
  const off = await MB.sendSide(ch, SIDE, { v: 1 });
  ok(off && off.ok === false && /no runner/.test(off.reason || ""), "G: with no runner running for this room, it is refused", off);
  ok(A.pending() === 0, "G: and nothing was queued", A.pending());
  runnerOn = true;
  const wrong = await MB.sendSide({ events_owner: "!other", events_uncategorized: "!unc" }, SIDE, { v: 1 });
  ok(wrong && wrong.ok === false, "G: nor for another room's owner-level channel than the runner's", wrong);
  const bad = await MB.sendSide(ch, "ddjp.dj.vote", { p: "$x" });
  ok(bad && bad.ok === false && /side type/.test(bad.reason || ""), "G: and backend1's refusals hold here too (one definition)", bad);
  // A grouped vote waits in the gate; the side message goes through it in order and ALONE.
  A.submit(A.stamp({ t: "ddjp.dj.vote", p: "$play" }, "@b:hs", 20, "$intent1", null));
  const r = await MB.sendSide(ch, SIDE, { v: 1, rows: [["@a:hs", 1]] });
  ok(r && r.ok === true && r.queued === true, "G: the runner's tab queues it in the gate", r);
  A.flush(); A.flush();
  const sideOut = out.filter((o) => o.type === SIDE);
  const batches = out.filter((o) => o.type === "ddjp.batch");
  ok(sideOut.length === 1 && JSON.stringify(sideOut[0].payload) === JSON.stringify({ v: 1, rows: [["@a:hs", 1]] }),
    "G: it is written once, as its own message, its body unchanged", out.map((o) => o.type));
  ok(batches.every((b) => !(b.payload.evs || []).some((e) => e && e.t === SIDE)),
    "G: and never inside a relay batch — not merged, not batched", batches.map((b) => (b.payload.evs || []).map((e) => e.t)));
  ok(out.length >= 2 && out.findIndex((o) => o.type === "ddjp.batch") < out.findIndex((o) => o.type === SIDE),
    "G: in order with what the gate held before it (the vote's batch first)", out.map((o) => o.type));
}

(async () => {
  try { await partF(); } catch (e) { ok(false, "F: threw — " + (e && e.stack || e)); }
  try { await partG(); } catch (e) { ok(false, "G: threw — " + (e && e.stack || e)); }
  if (failed) { console.log("[side-messages] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[side-messages] PASS — a side message rides the room's channels and touches nothing of the room (J84, hooks E1 " +
    "and E2; " + asserts + " assertions). THE CLASS IS A PREFIX the engines know and nothing more: `ddjp.side.*` is non-critical, " +
    "never vouched and never carrying a witness bundle (beside a play that does); it changes no state, no seed and so no " +
    "fingerprint; it counts nothing toward the seal cadence and is evicted first. In a BOT ROOM it is the runner's own: a " +
    "client's intent carrying one is refused (the owner's too), and the runner's gate writes it alone, after what it held, " +
    "never inside a relay batch. SENT through one door per engine, with one set of refusals: not a side type, no body, a " +
    "field the transport stamps or a relayed act carries, no owner-level channel, an account that cannot write it, or (in " +
    "a bot room) no runner for this room. THIS GUARD CANNOT TELL YOU A HOMESERVER ACCEPTS THE MESSAGE — only what this " +
    "client sends");
})();
