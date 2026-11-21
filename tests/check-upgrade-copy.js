#!/usr/bin/env node
// tests/check-upgrade-copy.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, features/roomupgrade.js
//
// WALL: NEW CHANNELS NAME EVERYONE (the owner's plan, part 2, JOB 1, `ddjp_695`; his "ok", `main/05-matrix.md` §Ranks you can
// trust). A channel an upgrade made named nobody but its creator, so a person ranked before the upgrade held no rights in it.
// Now every channel an upgrade batch creates is born naming every user the Space's power levels name, at their level — the
// Space read at EACH channel's create, the new channel's creator (a version-12 creator) left out — and nothing extra is sent;
// the whole batch holds the room's one rank turn from its start marker to its bot step; and the bot step, the backstop, finds
// every level in place and sends nothing.
// Driven on the REAL modules (both engines, the bridge, `features/room.js`, the REAL `features/roomupgrade.js` loaded into the
// same sandbox) over the homeserver model (`tests/_inviteworld.js`), with `createRoom` modelled as a homeserver applies one: the
// room made from its options (its creation record, its initial power levels, its join rule), its creator joined.
//   A  THE COPY: an upgrade on a shared room holding a Staff, a VIP and a bot — each new channel's create names all three at
//      their levels and not this account (its creator, v12); no power-levels event is sent; the bot step confirms every level and
//      sends nothing (its log line says so); afterwards all three are in step. The Space is read at each create: a level that
//      moves between two creates is carried by the channels made after it. A Space whose list names this account copies all but it.
//   B  THE TURN: while the batch makes its channels a rank change is refused by name (room-upgrading, nothing sent) and every
//      picker waits; a rank change running when the upgrade is asked is waited for — nothing created until it lands, the bar and
//      the log say so — and the channels then made carry its level; left while it waits, nothing is made.
//   C  THE BOT STEP WAITS FOR A NEW CHANNEL TO SYNC (`ddjp_696`, JOB 3; 695's owed): a channel whose create is answered before this
//      client sees it joined is waited for — on the rank change's clock, bounded by the creation's own wait (`CREATE_WAIT_MS`) —
//      before any level is checked, so it is never "not confirmed" for one that simply had not synced; the wait is logged; one that
//      never comes within the bound is named as before.
// RED FIRST ON 694: there a batch's channels name only their creator (A red), and the turn is the bot step's alone (B red). RED
// FIRST ON 695: the bot step checks at once (C red).
"use strict";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const W = require(path.join(__dirname, "_inviteworld.js"));
const ME = W.ME;
const STAFF_U = "@staffer:hs", VIP_U = "@vipper:hs", BOT_U = "@botty:hs", X_U = "@xtra:hs";

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[upgrade-copy] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[upgrade-copy] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
const until = async (cond, n) => { for (let i = 0; i < (n || 400); i++) { if (cond()) return true; await turns(1); } return cond(); };
const cap = (p, ms) => Promise.race([Promise.resolve(p).then((v) => ({ v }), (e) => ({ threw: (e && e.message) || String(e) })),
  new Promise((r) => setTimeout(() => r({ timedOut: true }), ms || 8000))]);

// ── THE WORLD: one shared room this account made, upgraded through batch 2; a Staff, a VIP and a bot ranked in it ──────────────
function upWorld(o) {
  o = o || {};
  const hs = W.homeserver();
  const sid = "!cp:hs";
  const levels = Object.assign({ [STAFF_U]: 60, [VIP_U]: 40, [BOT_U]: 99 }, o.levels || {});
  const creates = [], plSends = [], invites = [], marks = [], log = { gate: null };
  let made = 0;
  // `createRoom` as a homeserver does it: the room from its options, its creator joined (and so a creator, v12).
  const lates = [];   // `ddjp_696`: channels this client sees joined only after `polls` of the rank clock's sleeps (C)
  const createRoom = async (opts) => {
    if (log.gate) await log.gate.p;
    const id = "!made" + (++made) + ":hs";
    const late = o.late && (opts.creation_content || {}).ddjp_kind === o.late.kind;
    const pl = ((opts.initial_state || []).find((e) => e.type === "m.room.power_levels") || {}).content || { users: {}, users_default: 0 };
    const jr = ((opts.initial_state || []).find((e) => e.type === "m.room.join_rules") || {}).content || { join_rule: "invite" };
    const cc = Object.assign({ room_version: opts.room_version || "1" }, opts.creation_content || {});
    hs.room(id, { name: opts.name, creator: ME, content: cc, members: late ? {} : { [ME]: "join" }, joinRule: jr.join_rule, allow: jr.allow ? jr.allow[0].room_id : null,
      power: JSON.parse(JSON.stringify(pl)), parent: cc.ddjp_room || null });
    if (late) lates.push({ id, left: o.late.polls });
    creates.push({ id, name: opts.name, kind: cc.ddjp_kind, users: JSON.parse(JSON.stringify(pl.users || {})) });
    if (typeof o.onCreate === "function") o.onCreate(hs, creates.length);   // after the n-th create is answered
    return { room_id: id };
  };
  const extra = {
    createRoom,
    sendStateEvent: async (rid, type, content, key) => {
      if (type === "m.space.child") { if (hs.rooms[rid].children.indexOf(key) < 0) hs.rooms[rid].children.push(key); return {}; }
      if (type === "m.room.power_levels") {
        plSends.push({ rid, users: JSON.parse(JSON.stringify(content.users || {})) });
        if (log.plGate) await log.plGate.p;
        await turns(2);
        hs.rooms[rid].power = JSON.parse(JSON.stringify(content));
        if (wref) wref.state(rid, "m.room.power_levels", "", hs.rooms[rid].power, ME);
        return {};
      }
      return {};
    },
    invite: async (rid, u) => { invites.push([rid, u]); hs.invite(rid, u, { from: ME }); },
  };
  let wref = null;
  // `ddjp_697`: a paced send's gap (a second at most here) runs for real — the reconcile is paced now, and the bot step waits out
  // the rest of that second on the rank clock.
  const later = (fn, ms) => ((ms || 0) === 20000 ? (setImmediate(fn), 0) : ((ms || 0) <= 1000 ? setTimeout(fn, ms) : 0));   // the creation delay at once; a minute held
  const w = W.inviteWorld({ hs, client: extra, extras: { setTimeout: later } });
  wref = w;
  // THE REAL ROOM UPGRADE, in the same sandbox (the invite world's file list stops at `features/actions.js`).
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "features/roomupgrade.js"), "utf8") + "\n;globalThis.RoomUpgrade = RoomUpgrade;", w.sb);
  const plan = (w.sb.Backends.planFor("backend1") || []);
  const keys = plan.filter((r) => r.batch <= 2).map((r) => r.key);
  const R = hs.ddjpRoom(sid, { mode: "backend1", creator: ME, keys });
  for (const id of [sid].concat(Object.values(R.ch))) { hs.rooms[id].power = { users: Object.assign({}, levels), users_default: 0 }; hs.rooms[id].members[ME] = "join"; }
  for (const u of [STAFF_U, VIP_U, BOT_U, X_U]) { hs.rooms[sid].members[u] = "join"; for (const k of keys) if (!/^chat_/.test(k) || k === "chat_uncategorized") hs.rooms[R.ch[k]].members[u] = "join"; }
  // The rank change's clock (its sleeps and minute) a guard's, as `check-rank-trust` holds it, so a paced send is a reading.
  const clock = { t: 0 };
  const sleeps = [];
  if (typeof w.MB._setRankClockForTest === "function") w.MB._setRankClockForTest(async (ms) => {
    clock.t += ms; sleeps.push(ms);
    for (const L of lates) if (L.left > 0 && --L.left === 0) hs.rooms[L.id].members[ME] = "join";   // the sync brings it
    await turns(1);
  }, () => ({}), () => {}, () => clock.t);
  const sent = [];
  w.Room._enterForTest({ name: "Copy room", spaceId: sid, channels: Object.assign({}, R.ch) }, "backend1");
  // The markers stood in AFTER the room is entered (entering binds its engine, which refills the interface's shell).
  w.MB.sendEvent = async (ch, type, body) => { sent.push(type + " " + (body && body.n)); return { event_id: "$m" + sent.length }; };
  w.sb.RoomUpgrade.init(R.ch.events_owner);
  const top = plan.reduce((m, r) => Math.max(m, r.batch || 1), 1);
  const lastKeys = plan.filter((r) => r.batch === top).map((r) => r.key);
  return { w, hs, sid, R, plan, keys, lastKeys, creates, plSends, invites, sent, log, clock, marks, lates, sleeps,
    hold(k) { let r; log[k || "gate"] = { p: new Promise((x) => { r = x; }) }; log[k || "gate"].r = r; },
    release(k) { const g = log[k || "gate"]; log[k || "gate"] = null; if (g) g.r(); },
    level(u, rid) { const p = hs.rooms[rid].power; return (p.users && p.users[u] !== undefined) ? p.users[u] : p.users_default; } };
}
const applied = (x) => typeof x.w.sb.RoomUpgrade.upgrade === "function" && typeof x.w.MB.createUpgradeBatch === "function";

(async () => {
  // ═══ A — THE COPY ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const x = upWorld();
    ok(applied(x), "A: APPLIED — the real `RoomUpgrade.upgrade` and the bridge's `createUpgradeBatch`");
    const bar = [], from = x.w.logs.length;
    const r = await cap(x.w.sb.RoomUpgrade.upgrade((n, t, label) => bar.push([n, t, label])), 10000);
    await x.w.settle(10);
    const made = x.creates;
    ok(r.v && r.v.ok === true && r.v.batch === 3 && made.length === x.lastKeys.length && x.lastKeys.every((k) => made.some((c) => c.kind === k)),
      "A: PREMISE — the upgrade made the last batch's " + x.lastKeys.length + " channels", { r: r.v || r, made: made.map((c) => c.kind) });
    const want = JSON.stringify({ [BOT_U]: 99, [STAFF_U]: 60, [VIP_U]: 40 });
    const sorted = (u) => JSON.stringify(Object.keys(u).sort().reduce((m, k) => { m[k] = u[k]; return m; }, {}));
    ok(made.length > 0 && made.every((c) => sorted(c.users) === want),
      "A: EACH NEW CHANNEL NAMES ALL THREE AT CREATE — the Staff at 60, the VIP at 40, the bot at 99, in its initial power levels", made.map((c) => [c.kind, c.users]));
    ok(made.every((c) => !Object.prototype.hasOwnProperty.call(c.users, ME)), "A: AND NOT THIS ACCOUNT — the channel's creator, which a version-12 room lists nowhere", made.map((c) => c.users));
    ok(made.every((c) => x.w.MB.getMyPowerLevel(c.id) === 100), "A: (this account reads 100 there, as the room's creator)", made.map((c) => x.w.MB.getMyPowerLevel(c.id)));
    ok(x.plSends.length === 0, "A: NOTHING EXTRA IS SENT — no power-levels event, before or after the creates: the names are part of the create", x.plSends);
    const bot = r.v && r.v.bot;
    ok(bot && bot.ok === true && bot.total === x.lastKeys.length && bot.done === bot.total && JSON.stringify(bot.who) === JSON.stringify([BOT_U]),
      "A: THE BOT STEP STAYS AS THE BACKSTOP — every step confirmed (" + x.lastKeys.length + " of " + x.lastKeys.length + ")", bot);
    ok(x.w.lines(new RegExp("MatrixBridge: upgrade — the bot " + BOT_U + " holds level 99 in the batch's " + x.lastKeys.length + " channel\\(s\\) \\(" + x.lastKeys.length + " of " + x.lastKeys.length + " steps confirmed\\)"), from).length === 1,
      "A: and its log line says every step was confirmed — with nothing sent", x.w.lines(/MatrixBridge: upgrade/, from));
    ok(JSON.stringify(x.sent) === JSON.stringify(["ddjp.room.upgrade.start 3", "ddjp.room.upgrade.done 3"]), "A: the batch's own two markers, as before", x.sent);
    ok(x.invites.length > 0 && x.invites.every(([rid]) => made.some((c) => c.id === rid)),
      "A: the reconcile's invites, as before — to the new channels a level belongs in, and nothing else (membership, not levels)", x.invites);
    for (const u of [STAFF_U, VIP_U, BOT_U]) {
      const st = x.w.Room.rankStanding(u);
      ok(st && st.outOfStep === false, "A: AFTERWARDS " + u + " IS IN STEP — every room a change sets names them at one level", st);
    }
    ok(bar.some((b) => b[2] === "Bot's level" && b[0] === b[1]), "A: the bar's \"Bot's level (N/M)\" reaches N of N", bar.filter((b) => b[2] === "Bot's level"));
  }
  {
    // THE SPACE IS READ AT EACH CREATE: a level that moves after the first channel is made (from another device) is carried by
    // every channel made after it, not by the one before.
    const x = upWorld({ onCreate: (hs, n) => { if (n === 1) hs.rooms["!cp:hs"].power.users[X_U] = 20; } });
    const r = await cap(x.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    ok(r.v && r.v.ok === true && x.creates.length >= 2, "A: PREMISE — two or more channels made", r.v || r);
    ok(x.creates.length >= 2 && !Object.prototype.hasOwnProperty.call(x.creates[0].users, X_U) && x.creates.slice(1).every((c) => c.users[X_U] === 20),
      "A: THE SPACE IS READ AT EACH CHANNEL'S CREATE — a level set between two creates is named by every channel made after it", x.creates.map((c) => c.users[X_U]));
  }
  {
    // A SPACE WHOSE LIST NAMES THIS ACCOUNT (a room this account did not create, say): copied, all but this account.
    const x = upWorld({ levels: { [ME]: 100 } });
    const r = await cap(x.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    ok(r.v && r.v.ok === true && x.creates.length > 0 && x.creates.every((c) => !Object.prototype.hasOwnProperty.call(c.users, ME) && c.users[STAFF_U] === 60),
      "A: A SPACE WHOSE POWER LIST NAMES THIS ACCOUNT — every other user copied, this account (the new channel's creator) left out", x.creates.map((c) => c.users));
  }

  // ═══ B — THE WHOLE BATCH HOLDS THE ROOM'S ONE RANK TURN ═════════════════════════════════════════════════════════════════════
  const UP = "Waiting — the room is upgrading";
  {
    // WHILE THE BATCH MAKES ITS CHANNELS: a rank change is refused by name, nothing sent; every picker waits.
    const x = upWorld();
    x.hold();
    const up = cap(x.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    await until(() => x.sent.length > 0, 400);
    await x.w.settle(6);
    const st = x.w.Room.upgradeBotStep ? x.w.Room.upgradeBotStep() : null;
    ok(st && st.state === "running" && x.creates.length === 0 && x.sent[0] === "ddjp.room.upgrade.start 3",
      "B: PREMISE — the batch has begun (its start marker sent) and its first create is in flight; the room's turn held", { st, sent: x.sent, made: x.creates.length });
    const from = x.w.logs.length;
    const rc = await cap(x.w.Room.assignRank(VIP_U, 20), 2000);
    ok(rc.v && rc.v.ok === false && rc.v.reason === "room-upgrading" && x.plSends.length === 0 && x.w.Room.rankJob() === null,
      "B: A RANK CHANGE ASKED WHILE THE BATCH MAKES ITS CHANNELS IS REFUSED BY NAME — room-upgrading, nothing sent, no change started", rc);
    ok(x.w.lines(/Room: the room is upgrading — an upgrade batch is running — this rank change, @vipper:hs to level 20, was not started/, from).length === 1, "B: and the log says so, naming what holds the turn — an upgrade batch", x.w.lines(/Room:/, from));
    const d = x.w.sb.Actions.describe("rank.assign", { userId: VIP_U, targetRank: 40 });
    ok(d && !d.enabled && d.reason === UP, "B: EVERY RANK PICKER WAITS — the adapter: \"" + UP + "\"", d);
    x.release();
    const r = await up;
    ok(r.v && r.v.ok === true && x.w.Room.upgradeBotStep() === null && x.w.sb.Actions.describe("rank.assign", { userId: VIP_U, targetRank: 40 }).enabled,
      "B: THE BATCH DONE, THE TURN GIVEN BACK — the pickers live again", { r: r.v || r, step: x.w.Room.upgradeBotStep() });
  }
  {
    // A RANK CHANGE RUNNING WHEN THE UPGRADE IS ASKED: nothing is made until it lands; the bar and the log say so; then the
    // channels made carry its level.
    const x = upWorld();
    x.hold("plGate");
    const ch = cap(x.w.Room.assignRank(VIP_U, 20), 10000);
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.plSends.length > 0, 400);
    const bar = [], from = x.w.logs.length;
    const up = cap(x.w.sb.RoomUpgrade.upgrade((n, t, label) => bar.push([n, t, label])), 10000);
    await x.w.settle(10);
    const jn = x.w.Room.rankJob() && x.w.Room.rankJob().name;
    ok(x.creates.length === 0 && x.sent.length === 0, "B: AN UPGRADE ASKED WHILE A RANK CHANGE RUNS WAITS — no marker, nothing made", { sent: x.sent, made: x.creates.length });
    ok(bar.some((b) => b[0] === null && b[2] === "Waiting — a rank change for " + jn + " is running") &&
       x.w.lines(new RegExp("Room: the upgrade waits for the rank change for " + jn + " \\(\\d+ of \\d+\\) before making the batch's channels"), from).length === 1,
      "B: and says so — on the bar (\"Waiting — a rank change for " + jn + " is running\") and in the log", { bar, log: x.w.lines(/Room:/, from) });
    x.release("plGate");
    const rc = await ch, r = await up;
    await x.w.settle(10);
    ok(rc.v && rc.v.ok === true && r.v && r.v.ok === true && x.creates.length === x.lastKeys.length,
      "B: THEN IT RUNS — the change lands, then the batch", { change: rc.v || rc, up: r.v || r });
    ok(x.creates.every((c) => c.users[VIP_U] === 20), "B: AND THE CHANNELS IT MAKES CARRY THE CHANGE'S LEVEL — the Space read at each create, after the change", x.creates.map((c) => c.users[VIP_U]));
  }
  {
    // LEFT WHILE THE UPGRADE WAITS FOR A CHANGE: nothing is made, no marker sent.
    const x = upWorld();
    x.hold("plGate");
    const ch = cap(x.w.Room.assignRank(VIP_U, 20), 10000);
    await until(() => x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.plSends.length > 0, 400);
    const up = cap(x.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    await x.w.settle(10);
    const from = x.w.logs.length;
    try { x.w.Room.leave("the guard leaves"); } catch (e) {}
    x.release("plGate");
    await ch; const r = await up;
    await x.w.settle(10);
    ok(x.creates.length === 0 && x.sent.length === 0 && x.w.Room.upgradeBotStep() === null && !(r.v && r.v.ok),
      "B: LEFT WHILE IT WAITS — nothing made, no marker sent, the turn gone", { made: x.creates.length, sent: x.sent, r: r.v });
    ok(x.w.lines(/Room: the upgrade stopped when the room was left, before it began — nothing sent/, from).length === 1, "B: and the log says so", x.w.lines(/Room:|RoomUpgrade:/, from));
  }

  // ═══ C — THE BOT STEP WAITS FOR A NEW CHANNEL TO SYNC (`ddjp_696`) ═══════════════════════════════════════════════════════════
  {
    const x = upWorld({ late: { kind: "chat_staff", polls: 6 } });
    const from = x.w.logs.length;
    const r = await cap(x.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    await x.w.settle(10);
    const lc = x.creates.find((c) => c.kind === "chat_staff");
    const bot = r.v && r.v.bot;
    ok(lc && x.lates.length === 1 && x.lates[0].left === 0 && x.hs.rooms[lc.id].members[ME] === "join", "C: PREMISE — the staff chat was made, and this client saw it joined only six polls later", { lates: x.lates });
    ok(bot && bot.ok === true && bot.done === x.lastKeys.length && bot.total === x.lastKeys.length && x.plSends.length === 0,
      "C: A CHANNEL THAT SYNCS LATE IS WAITED FOR, NOT NAMED — every step confirmed (" + x.lastKeys.length + " of " + x.lastKeys.length + "), nothing sent", { bot, pl: x.plSends });
    ok(x.w.lines(/MatrixBridge: upgrade — the bot step waited 900 ms for the batch's new channels to sync$/, from).length === 1,
      "C: THE WAIT IS SAID — six polls of 150 ms, on the rank change's clock", x.w.lines(/MatrixBridge: upgrade/, from));
    // ONE THAT NEVER COMES WITHIN THE BOUND IS NAMED AS BEFORE — after the creation's own wait.
    const y = upWorld({ late: { kind: "chat_staff", polls: Infinity } });
    const f2 = y.w.logs.length;
    const r2 = await cap(y.w.sb.RoomUpgrade.upgrade(() => {}), 10000);
    await y.w.settle(10);
    const b2 = r2.v && r2.v.bot;
    const waited = y.sleeps.filter((ms) => ms === 150).reduce((a, b) => a + b, 0);
    ok(b2 && b2.ok === false && waited >= 8000 && waited < 8300 && (b2.failed || []).length === 1 && /chat-staff|chat_staff/.test(b2.failed[0]),
      "C: ONE THAT NEVER SYNCS IS NAMED AFTER THE BOUND — waited " + waited + " ms (the creation's 8 s), then \"not confirmed\" for it alone", { b2, waited });
    ok(y.w.lines(/MatrixBridge: upgrade — the bot step waited 8100 ms for the batch's new channels to sync; 1 still not seen: /, f2).length === 1,
      "C: and the log names it", y.w.lines(/MatrixBridge: upgrade/, f2));
  }

  _finished = true;
  if (failed) { console.log("[upgrade-copy] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[upgrade-copy] PASS — new channels name everyone (the owner's plan, part 2, JOB 1; " + asserts + " assertions): an upgrade's " +
    "channels are born naming every user the Space names, at their level — the Staff, the VIP and the bot — and not their creator, the " +
    "Space read at each create; no power-levels event is sent and the bot step confirms every level and sends nothing, so all are in " +
    "step after; the whole batch holds the room's one rank turn — a rank change asked during it is refused by name, an upgrade asked " +
    "during a change waits for it, says so and then carries its level, and a room left while it waits makes nothing; and the bot " +
    "step waits for a new channel to sync, bounded by the creation's own wait, saying so, and names only one that never comes.");
  process.exit(0);
})().catch((e) => { console.log("[upgrade-copy] FAIL — threw: " + ((e && e.stack) || e)); process.exit(1); });
