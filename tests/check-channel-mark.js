#!/usr/bin/env node
// tests/check-channel-mark.js
// SUBJECT: backends/backend1/matrixbridge.js
//
// WALL: EVERY CHANNEL IS BORN MARKED AND FILED UNDER ITS ROOM BOTH WAYS, IN EVERY BUILDER (J81; the owner's ruling 8a).
//   A channel's creation record carries its MARK — `ddjp_room` (the space's id) and `ddjp_kind` (its key in the engine's plan) —
//   which the homeserver writes once and nobody can edit, and which every invite preview carries; the channel names its room
//   (`m.space.parent`, set at birth) and the room lists the channel (`m.space.child`). One function, `_createMarkedChannel`, is
//   the only way a builder creates a channel, and it refuses without a room or a kind of the plan: no path for an unmarked
//   channel. Before J81 no channel carried any of this, so an invite named no room and a staff-chat invite read as a DM.
//
//   Driven through the REAL creation flows — `createDDJPSpace` for both engines' plans and `createUpgradeBatch` for the shared
//   room's later batches — against a client that records what was asked of it, as a homeserver would hold it.
//     M1  every channel carries `creation_content { ddjp_room: <its space>, ddjp_kind: <its plan key> }`, the plan's keys each once.
//     M2  every channel carries `m.space.parent` in its initial state: the space, with `via`, canonical.
//     M3  the space lists every channel (`m.space.child` with `via`).
//     M4  the ONE creating function refuses without a space or with a key the plan does not have, and creates nothing.
//     M5  resuming an interrupted creation reads the channels already made BY THEIR MARK and builds only the missing ones.
//     Controls: the space carries no channel mark, only its engine; open channels stay `restricted` to the space and the
//     invite-only chats stay invite-only; every room at the one version.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const { ORDER, deep, botRuntime } = require(path.join(__dirname, "_botroom.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[channel-mark] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[channel-mark] FAIL — the guard did not finish"); process.exitCode = 1; } });

const ME = "@owner:hs";
function sandbox() {
  const sb = loadInContext(ORDER, {
    Date, Math, JSON, Promise, setTimeout: (fn) => { Promise.resolve().then(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    window: { addEventListener() {} }, document: { addEventListener() {}, visibilityState: "visible" }, navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Store: { history: { load: async () => null, persist() {} } }, StorageIO: deep(), IDB: deep(), ChatPrefs: deep(), Queue: deep(), Skip: deep(),
    Playback: deep(), Chat: deep(), Reactions: deep(), MediaLength: deep(), MediaBlocked: deep(), ServerClock: deep(), UserQueue: deep(),
    RoomUpgrade: deep(), BotRuntime: botRuntime(), Interface: deep(),
  });
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = () => {};
  return sb;
}
// A client that RECORDS: every room asked for, and every state event sent; and answers for them as a homeserver would.
function recorder() {
  const made = [], state = [], rooms = Object.create(null);
  let n = 0;
  const view = (id) => {
    const r = rooms[id];
    return { roomId: id, name: r.name, getMyMembership: () => "join", currentState: { getStateEvents: (t, k) => {
      const one = k !== undefined;
      if (t === "m.room.create") {
        const c = { getContent: () => Object.assign({ room_version: r.opts.room_version }, r.opts.creation_content || {}), getSender: () => ME, getStateKey: () => "" };
        return one ? (k === "" ? c : null) : [c];
      }
      if (t === "m.space.child") {
        const list = state.filter((s) => s.roomId === id && s.type === "m.space.child").map((s) => ({ getStateKey: () => s.key, getContent: () => s.content, getSender: () => ME }));
        return one ? (list.find((e) => e.getStateKey() === k) || null) : list;
      }
      if (t === "m.room.power_levels") { const p = { getContent: () => ({ users: {}, users_default: 0 }) }; return one ? p : [p]; }
      return one ? null : [];
    } } };
  };
  const client = {
    getUserId: () => ME, getRoom: (id) => (rooms[id] ? view(id) : null), getRooms: () => Object.keys(rooms).map(view),
    createRoom: async (opts) => { const id = "!r" + (++n) + ":hs"; rooms[id] = { opts, name: opts.name }; made.push({ id, opts }); return { room_id: id }; },
    sendStateEvent: async (roomId, type, content, key) => { state.push({ roomId, type, content, key }); return {}; },
    invite: async () => {}, kick: async () => {},
  };
  return { client, made, state, rooms };
}
const markOf = (o) => (o.creation_content || {});
const parentOf = (o) => ((o.initial_state || []).find((s) => s.type === "m.space.parent") || null);
const joinRuleOf = (o) => (((o.initial_state || []).find((s) => s.type === "m.room.join_rules") || {}).content || {}).join_rule || null;

(async () => {
  // ── M1–M3 for both engines' plans, through the real creation (and, for the shared room, its upgrade batches) ────────────
  for (const mode of ["backend1", "backend2"]) {
    const sb = sandbox(), rec = recorder();
    sb.Backends.bind(mode);
    sb.MatrixBridge._setClientForTest(rec.client);
    let res = null, err = null;
    try { res = await sb.MatrixBridge.createDDJPSpace("Test room", null, mode); } catch (e) { err = e.message; }
    if (res && mode === "backend1") {
      let chans = Object.assign({}, res.channels);
      for (const b of [2, 3]) { try { Object.assign(chans, await sb.MatrixBridge.createUpgradeBatch(res.spaceId, chans, b)); } catch (e) { err = "batch " + b + ": " + e.message; } }
    }
    const plan = (sb.Backends.planFor(mode) || []).map((c) => c.key).sort();
    ok(!err && res && res.spaceId, "M PREMISE (" + mode + ") — a whole room was created through the real flow" + (mode === "backend1" ? ", its upgrade batches too" : ""), err);
    if (!res) continue;
    const space = rec.made.find((m) => m.id === res.spaceId);
    const channels = rec.made.filter((m) => m.id !== res.spaceId);
    const kinds = channels.map((m) => markOf(m.opts).ddjp_kind).sort();
    ok(channels.length === plan.length && JSON.stringify(kinds) === JSON.stringify(plan),
      "M1 (" + mode + "): EVERY channel carries its kind — the plan's keys, each exactly once", { kinds, plan });
    ok(channels.every((m) => markOf(m.opts).ddjp_room === res.spaceId),
      "M1 (" + mode + "): and every channel's mark names ITS room", channels.map((m) => markOf(m.opts)));
    ok(channels.every((m) => { const p = parentOf(m.opts); return p && p.state_key === res.spaceId && Array.isArray(p.content.via) && p.content.via.length > 0 && p.content.canonical === true; }),
      "M2 (" + mode + "): every channel names its room from its own side — `m.space.parent`, the space, with `via`, canonical", channels.map((m) => parentOf(m.opts)));
    const listed = rec.state.filter((s) => s.roomId === res.spaceId && s.type === "m.space.child" && Array.isArray(s.content.via) && s.content.via.length > 0).map((s) => s.key).sort();
    ok(JSON.stringify(listed) === JSON.stringify(channels.map((m) => m.id).sort()), "M3 (" + mode + "): and the room lists every channel — both ways, always (8a)", listed);
    ok(space && markOf(space.opts).type === "m.space" && markOf(space.opts).ddjp_mode === mode && !("ddjp_room" in markOf(space.opts)) && !("ddjp_kind" in markOf(space.opts)),
      "M CONTROL (" + mode + "): the room itself carries its engine and no channel mark", space && markOf(space.opts));
    // Read by the channel's NAME here, not its mark, so this control holds on a tree without marks (it is a control, not M1).
    const plan2 = sb.Backends.planFor(mode) || [];
    const ruleWrong = channels.filter((m) => {
      const row = plan2.find((c) => sb.MatrixBridge.channelName(c.kind, c.slug) === m.opts.name) || {};
      const inviteOnly = row.kind === "presence" || (row.kind === "chat" && row.level > 0);
      // An invite-only chat states `invite` or leaves it to its preset (`private_chat`, which IS invite); never `restricted`.
      return inviteOnly ? !(joinRuleOf(m.opts) === "invite" || (joinRuleOf(m.opts) === null && m.opts.preset === "private_chat")) : joinRuleOf(m.opts) !== "restricted";
    }).map((m) => [m.opts.name, joinRuleOf(m.opts)]);
    ok(ruleWrong.length === 0, "M CONTROL (" + mode + "): open channels stay restricted to the room, invite-only chats stay invite-only", ruleWrong);
    ok(rec.made.every((m) => m.opts.room_version === sb.MatrixBridge.ROOM_VERSION), "M CONTROL (" + mode + "): every room at the one version");
  }

  // ── M4 — THE ONE CREATING FUNCTION REFUSES, BY NAME, AND CREATES NOTHING ──────────────────────────────────────────────────
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
    const from = src.indexOf("  function _isPlanKey(key, modeId) {"), to = src.indexOf("\n  }\n", src.indexOf("  async function _createMarkedChannel(")) + 4;
    ok(from > 0 && to > from, "M4 APPLIED — `_createMarkedChannel` (and its plan check) sliced from the bridge, to run as it ships", { from, to });
    if (from > 0 && to > from) {
      const made = [];
      const ctx = { _createMode: null, _channels: () => [{ key: "chat_staff" }], _viaFor: () => ["hs"],
        client: { createRoom: async (o) => { made.push(o); return { room_id: "!x:hs" }; } } };
      vm.createContext(ctx);
      vm.runInContext(src.slice(from, to) + "\n;globalThis.__make = _createMarkedChannel;", ctx);
      const tryMake = async (sid, key) => { try { await ctx.__make({ name: "x", initial_state: [] }, sid, key); return null; } catch (e) { return e.message; } };
      const noSpace = await tryMake(null, "chat_staff"), noKind = await tryMake("!s:hs", undefined), oddKind = await tryMake("!s:hs", "events_vip");
      ok(/never made without its room/.test(noSpace || "") && /never made without its kind/.test(noKind || "") && /never made without its kind/.test(oddKind || "") && made.length === 0,
        "M4: no space, no kind, or a kind the plan does not have — each REFUSED by name, and nothing created (8a: no path for an unmarked channel)",
        { noSpace, noKind, oddKind, made: made.length });
      const fine = await tryMake("!s:hs", "chat_staff");
      ok(fine === null && made.length === 1 && markOf(made[0]).ddjp_kind === "chat_staff", "M4 CONTROL: with both, it creates the marked channel", made.map(markOf));
    }
  }

  // ── M5 — RESUMING READS THE CHANNELS ALREADY MADE BY THEIR MARK ───────────────────────────────────────────────────────────
  {
    const sb = sandbox(), rec = recorder();
    sb.Backends.bind("backend2");
    sb.MatrixBridge._setClientForTest(rec.client);
    let first = null;
    // An interrupted creation: the space and three channels exist and are listed, then a create fails.
    let calls = 0;
    const create0 = rec.client.createRoom;
    rec.client.createRoom = async (o) => { if (++calls === 5) throw new Error("the homeserver went away"); return create0(o); };
    try { await sb.MatrixBridge.createDDJPSpace("Half room", null, "backend2"); } catch (e) { first = e.partial || null; }
    rec.client.createRoom = create0;
    const before = rec.made.length;
    ok(first && first.spaceId && Object.keys(first.channels).length === 3, "M5 PREMISE — the creation stopped with the room and three channels made", first);
    let res = null;
    try { res = await sb.MatrixBridge.createDDJPSpace("Half room", { spaceId: first.spaceId, channels: {} }, "backend2"); } catch (e) { res = { err: e.message }; }
    const plan = sb.Backends.planFor("backend2").length;
    ok(res && res.channels && Object.keys(res.channels).length === plan && rec.made.length - before === plan - 3,
      "M5: a resume handed NO channel map still builds only the missing channels — the ones already made are found by their MARK in the " +
      "room's list (D2), not by name", { built: rec.made.length - before, res: res && Object.keys(res.channels || {}) });
  }

  _finished = true;
  if (failed) { console.log("[channel-mark] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[channel-mark] PASS — every channel is born marked and filed under its room both ways, in every builder (J81, ruling 8a; " +
    asserts + " assertions): through the real creation of both room types and the shared room's upgrade batches, each channel's " +
    "creation record names its room and its kind — the plan's keys, each once — each channel names its room with `m.space.parent` " +
    "and the room lists each channel; the one creating function refuses without a room or a kind of the plan and creates nothing; " +
    "a resumed creation finds what was already made by its mark; and the room itself carries only its engine, open channels stay " +
    "restricted, invite-only chats invite-only, every room at the one version.");
})().catch((e) => { console.log("[channel-mark] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
