#!/usr/bin/env node
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js
// check-room-version.js — ROOM VERSION 12 AND ITS CREATORS, read and written by one rule (ddjp_501).
//
// THE RULE (owner, `docs/main/05-matrix.md` §Ranks & power levels): in a room of version 12 or later,
// a CREATOR — the creation event's sender plus any `additional_creators` — reads as 100, the level the
// creator has always had in this app; everybody else, and every room before 12, reads from the power
// list exactly as before. Rooms are created at one requested version, and in a version that has
// creators the creator is never written into a power list (the server refuses it: matrix.org's
// "Creator user … must not appear in content.users", which is what stopped room creation).
//
// Every row drives the REAL bridge (`_setClientForTest`) through a client and rooms shaped like the
// SDK's, and each pairs with a control, because a rule that never ran and a rule that is right look
// alike from outside. The version-11 rows are the other half of the rule: it must NOT apply there.
"use strict";
const path = require("path");
const vm = require("vm");
const { loadInContext } = require("./_load");
const X = require("./_probe-j14-card.js");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[room-version] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const Logger = { debug() {}, info() {}, warn() {}, error() {} };
const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "backends/backend1/matrixbridge.js"],
  { Logger, setTimeout: (f) => { Promise.resolve().then(f); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
const MB = sb.MatrixBridge;
ok(MB && typeof MB._setClientForTest === "function", "APPLIED — the real bridge loaded, with its test seam");

// ── A CLIENT AND ROOMS IN THE SDK'S SHAPE ────────────────────────────────────────────────────────
function ev(type, content, sender, stateKey) {
  return { getType: () => type, getContent: () => content, getSender: () => sender,
           getStateKey: () => (stateKey === undefined ? "" : stateKey) };
}
// version: the create event's `room_version` (undefined = absent, which the spec reads as "1").
function room(id, o) {
  const create = ev("m.room.create", Object.assign({}, o.version === undefined ? {} : { room_version: o.version },
    o.extra ? { additional_creators: o.extra } : {}, o.space ? { type: "m.space" } : {}), o.creator);
  const pl = ev("m.room.power_levels", Object.assign({ users_default: 0, events: { "m.room.message": o.send || 0 } },
    o.users ? { users: o.users } : {}));
  const children = (o.children || []).map((cid) => ev("m.space.child", { via: ["hs"] }, o.creator, cid));
  return {
    roomId: id, name: o.name || id,
    getMyMembership: () => "join",
    getJoinedMembers: () => (o.members || []).map((u) => ({ userId: u, name: u })),
    currentState: {
      getStateEvents: (type, key) => {
        if (type === "m.room.create") return key === "" ? create : [create];
        if (type === "m.room.power_levels") return key === "" ? pl : [pl];
        if (type === "m.space.child") return key === undefined ? children : (children.find((c) => c.getStateKey() === key) || null);
        return key === undefined ? [] : null;
      },
    },
  };
}
function client(me, rooms) {
  const byId = Object.create(null); for (const r of rooms) byId[r.roomId] = r;
  return { getUserId: () => me, getRoom: (id) => byId[id] || null, getRooms: () => rooms.slice() };
}

const O = "@owner:hs", C2 = "@cocreator:hs", BOT = "@bot:hs", G = "@guest:hs";

// ── PART R — READING: a creator of a v12 room reads as 100; nobody else, and no older room, changes
{
  const v12 = room("!v12", { version: "12", creator: O, extra: [C2], users: { [BOT]: 99 }, members: [O, C2, BOT, G] });
  MB._setClientForTest(client(O, [v12]));
  ok(MB.getMyPowerLevel("!v12") === 100,
    "R: the creator of a version-12 room reads as 100 — not absent from the power list, which the server forbids, and not 0", MB.getMyPowerLevel("!v12"));
  const roster = MB.getRoster("!v12"); const lvl = (u) => (roster.find((m) => m.userId === u) || {}).level;
  ok(lvl(O) === 100 && lvl(C2) === 100,
    "R: in the member list the creator AND an additional creator read as 100", roster);
  ok(lvl(BOT) === 99 && lvl(G) === 0,
    "R CONTROL: everybody else keeps their power-list level — the bot its 99, a guest the default", roster);
  ok(MB.getUserEffectiveRank("!v12", {}, C2) === 100,
    "R: an additional creator's effective rank is 100 — the figure every rank decision reads", MB.getUserEffectiveRank("!v12", {}, C2));
  // `allPowerLevels` is private; `accountsAtLevel` is how the rest of the app reads it, so the list is
  // driven through that. (A first draft called it directly and threw: it is not exported.)
  const at99 = MB.accountsAtLevel("!v12", 99);
  ok(at99 && JSON.stringify(at99.who) === JSON.stringify([BOT]),
    "R CONTROL: \"who holds 99\" is still exactly the bot — the creators were not moved anywhere else", at99);
  const at100 = MB.accountsAtLevel("!v12", 100);
  ok(at100 && JSON.stringify(at100.who) === JSON.stringify([C2, O].sort()),
    "R: and \"who holds 100\" finds them", at100);

  const v11 = room("!v11", { version: "11", creator: O, users: { [O]: 50 }, members: [O] });
  MB._setClientForTest(client(O, [v11]));
  ok(MB.getMyPowerLevel("!v11") === 50,
    "R: in a version-11 room the creator has NO special standing — a v11 creator demoted to 50 reads 50, " +
    "because before 12 the power list is the whole truth", MB.getMyPowerLevel("!v11"));
  const old = room("!v1", { creator: O, users: { [O]: 100 }, members: [O] });
  MB._setClientForTest(client(O, [old]));
  ok(MB.getMyPowerLevel("!v1") === 100 && MB.accountsAtLevel("!v1", 100).who.indexOf(O) >= 0,
    "R CONTROL: a room with no version field (the spec's \"1\") reads its power list as it always did", MB.getMyPowerLevel("!v1"));
  const v13 = room("!v13", { version: "13", creator: O, users: {}, members: [O] });
  MB._setClientForTest(client(O, [v13]));
  ok(MB.getMyPowerLevel("!v13") === 100,
    "R: a LATER version than 12 keeps the creator rule — every version after 11 does, as the SDK reads them", MB.getMyPowerLevel("!v13"));
}

// ── PART W — THE WRITE CHANNEL: the creator of v12 channels writes where an owner writes ──────────
{
  const owner = room("!eo", { version: "12", creator: O, users: { [BOT]: 99 }, send: 99, name: MB.channelName("events", "owner") });
  const unc = room("!eu", { version: "12", creator: O, users: {}, send: 0, name: MB.channelName("events", "uncategorized") });
  MB._setClientForTest(client(O, [owner, unc]));
  const ch = { events_owner: "!eo", events_uncategorized: "!eu" };
  ok(MB.getWriteChannelId(ch) === "!eo",
    "W: the creator of version-12 channels writes to the OWNER channel — read as 0, every write the owner's " +
    "client makes would have gone to the lowest one", MB.getWriteChannelId(ch));
  MB._setClientForTest(client(G, [owner, unc]));
  ok(MB.getWriteChannelId(ch) === "!eu", "W CONTROL: a guest in the same rooms still writes to the lowest", MB.getWriteChannelId(ch));
}

// ── PART O — THE OWNED-ROOMS LIST reads the level through the bridge, so the rule reaches it ─────
{
  const sp = room("!sp", { version: "12", space: true, creator: O, users: {}, children: ["!eo2", "!eu2"], members: [O] });
  const eo = room("!eo2", { version: "12", creator: O, users: {}, send: 99, name: MB.channelName("events", "owner") });
  const eu = room("!eu2", { version: "12", creator: O, users: {}, send: 0, name: MB.channelName("events", "uncategorized") });
  MB._setClientForTest(Object.assign(client(O, [sp, eo, eu])));
  const x = X.extractNamed("features/room.js", "scanDDJPRooms");
  ok(x.ok, "O: APPLIED — `scanDDJPRooms` extracted from the real room.js", x.stage);
  if (x.ok) {
    const ctx = { MatrixBridge: MB, Capabilities: sb.Capabilities, Logger, console };
    ctx.MatrixBridge.getClient = MB.getClient;
    vm.createContext(ctx);
    vm.runInContext(x.source + "\n;globalThis.__scan = scanDDJPRooms;", ctx);
    const res = ctx.__scan();
    ok(res.owned.length === 1 && res.owned[0].spaceId === "!sp",
      "O: the creator's own version-12 room is listed as OWNED, not merely joined", res);
    MB._setClientForTest(client(G, [sp, eo, eu]));
    const asGuest = ctx.__scan();
    ok(asGuest.owned.length === 0 && asGuest.joined.length === 1, "O CONTROL: to a guest the same room is joined, not owned", asGuest);
  }
}

// ── PART K — NOBODY CAN CHANGE A CREATOR'S RANK, by the rule the app already has ──────────────────
{
  const x = X.extractNamed("features/room.js", "canAssignRank");
  ok(x.ok, "K: APPLIED — `canAssignRank` extracted from the real room.js", x.stage);
  if (x.ok) {
    const ctx = { Capabilities: sb.Capabilities }; vm.createContext(ctx);
    vm.runInContext(x.source + "\n;globalThis.__can = canAssignRank;", ctx);
    ok(!ctx.__can(99, 100, 60) && !ctx.__can(100, 100, 60),
      "K: a creator, read as 100, is out of reach — the bot at 99 cannot rank them, nor can another creator", null);
    ok(ctx.__can(100, 60, 20), "K CONTROL: the creator can still rank somebody below them", null);
  }
}

// ── PART C — CREATING: one requested version, and no creator in any power list ────────────────────
(async () => {
  const made = [];
  const fake = client(O, []);
  fake.createRoom = async (opts) => { made.push(opts); return { room_id: "!r" + made.length + ":hs" }; };
  fake.sendStateEvent = async () => ({});
  MB._setClientForTest(fake);
  let res = null, err = null;
  try { res = await MB.createDDJPSpace("Test room", null, null); } catch (e) { err = e.message; }
  ok(!err && made.length > 1, "C: APPLIED — a whole room was created through the real flow, the Space and its channels", { err: err, rooms: made.length });
  // AND THE LATER BATCHES, through the real upgrade path. Creation builds batch 1 only; the presence chat
  // and the higher ranks arrive with `createUpgradeBatch` when a rank unlocks. A first draft drove creation
  // alone, and dropping the version from the PRESENCE builder survived it — a builder never called.
  if (res) {
    let chans = Object.assign({}, res.channels);
    for (const n of [2, 3]) {
      try { Object.assign(chans, await MB.createUpgradeBatch(res.spaceId, chans, n)); } catch (e) { err = "batch " + n + ": " + e.message; }
    }
  }
  const presenceName = MB.channelName("presence", "chat");
  ok(!err && made.some((o) => o.name === presenceName),
    "C: APPLIED — the upgrade batches ran, so every builder was called, the presence chat included", { err: err, names: made.map((o) => o.name) });
  const pls = made.map((o) => ((o.initial_state || []).find((s) => s.type === "m.room.power_levels") || {}).content || null);
  ok(made.length > 0 && made.every((o) => o.room_version === MB.ROOM_VERSION) && MB.ROOM_VERSION === "12",
    "C: EVERY room is created at the one requested version, 12 — the Space included — so a server's default " +
    "decides nothing", made.map((o) => o.room_version));
  ok(pls.every((p) => p && !(p.users && Object.prototype.hasOwnProperty.call(p.users, O))),
    "C: and no power list names the creator — the server refuses one that does, and that refusal is what " +
    "stopped room creation", pls.map((p) => p && p.users));
  ok(pls.every((p) => p && p.ban === 99 && p.state_default === 100 && p.events && typeof p.events["m.room.message"] === "number"),
    "C CONTROL: every other part of every power list is exactly what it was — only the creator left it", pls.map((p) => p && { ban: p.ban, sd: p.state_default }));
  const restricted = made.filter((o) => (o.initial_state || []).some((s) => s.type === "m.room.join_rules" && s.content.join_rule === "restricted"));
  ok(restricted.length > 0, "C CONTROL: the restricted-join channels are still restricted to the Space", restricted.length);

  if (failed) process.exit(1);
  console.log("[room-version] PASS — in a room of version 12 or later a creator reads as 100 in every level " +
    "reader, the member list, the write channel and the owned-rooms list, while everybody else and every older " +
    "room reads its power list unchanged; rooms are created at one requested version with no creator in any " +
    "power list; and a creator's rank is out of reach by the existing rule (" + asserts + " assertions)");
})().catch((e) => { console.log("[room-version] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
