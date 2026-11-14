#!/usr/bin/env node
// tests/check-needs-attention.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, ui/screens.js, index.html
//
// WALL: "NEEDS ATTENTION" ON THE ROOM LIST, AND ITS REPAIR (the owner's plan, part 2, JOB 2, `ddjp_695`; his "1 yes", "2 yes" on the
// real room list; `main/05-matrix.md` §Rooms you can trust). Only what this account can tell from what sync already holds: a room
// missing channels it should already have (told only where this account holds every listed channel), a channel whose mark is
// wrong, an opening refused (until the room is next opened). A section first, above "Your rooms"; each row the room's name, one
// plain reason under it and its buttons; a room there is not listed again below. Repair where this account may write the room's
// channel list, working LOCKED, making only what the room should already have — a missing creation channel with its own builder,
// an unfinished batch with the upgrade's own resumable code, never the next upgrade — each new channel born naming everyone the
// Space names, the members invited, the bot step after it; its progress on the row; a failure named, with "Repair again".
// Everyone else reads "Only its owner can repair it."; a wrong mark is Leave only, the room's own Leave behind the lock.
// Driven on the REAL modules over the homeserver model (`tests/_inviteworld.js`, `createRoom` modelled as a homeserver applies one)
// and the REAL ui/ files (`tests/_screen-world.js`) drawn over that same real room:
//   A  THE READING: missing upgrade channels, a missing creation channel, a wrong mark, nothing (a room as today), a channel this
//      account cannot read (nothing told), a room it does not own (Repair "owner"); a refused opening said until the next opening.
//   B  REPAIR: only what is missing — never the next batch; each channel born naming everyone, the members invited, the bot step
//      confirming and sending nothing; its progress; the room's turn held; one Repair at a time; a failure named and Repair again;
//      a creation channel remade by its builder in both room types; refused for a wrong mark and for a non-owner, nothing made.
//   C  THE ROOM LIST: "Needs attention" first, above "Your rooms"; the name, the amber reason, Repair (locked too), Leave only
//      unlocked; the room not listed again; the repair's line and bar; the failure and Repair again; "Only its owner can repair
//      it."; a wrong mark with no Repair; the refused opening's words.
//   D  REPAIR ADOPTS, NEVER DUPLICATES (`ddjp_696`, JOB 3; 695's owed): a missing kind this account made for the room and never
//      listed is listed, not made again — in an unfinished batch and for a creation channel — counted as repaired, invited to;
//      one anyone else made is never adopted and never counted (the room still reads it missing; Repair makes the channel).
//   E  THE UPGRADE'S WAIT RESTARTS WITH NOTHING SENT (`ddjp_696`, JOB 3; 695's owed): it counts from the newer of the last done
//      marker and the newest channel of the room's top batch (`MatrixBridge.batchMadeAt`) — so a batch a Repair finished, with no
//      marker, waits its two hours from the Repair; one made three hours ago does not.
// RED FIRST ON 694: `Room.needsAttention`, `Room.repairRoom` and the bridge's `roomAttention` do not exist — every part refuses by name.
// RED FIRST ON 695: Repair makes a second channel (D), and the wait counts from the last marker alone (E).
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ME = W.ME, OWNER = W.OWNER;
const STAFF_U = "@staffer:hs", BOT_U = "@botty:hs";

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[needs-attention] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[needs-attention] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
const later = async (cond, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 15)); } return cond(); };

// ── THE ACCOUNT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rooms this account made (its creator, v12): M — a shared room whose last batch began and two of its channels were never made;
// T — a shared room upgraded through batch 2 with one of batch 2's channels missing (batch 3 never begun); C — a shared room
// missing its settings channel; K — a shared room listing a channel whose mark names another room; F — a full room, fine; B — a bot
// room missing its guest chat. And rooms this account did NOT make: J — a room it holds every channel of at 99 (the bot), one
// missing; U — a room missing a channel, one of whose listed channels this account holds nothing of.
function account(o) {
  o = o || {};
  const hs = W.homeserver();
  const creates = [], invites = [], plSends = [], gate = { p: null };
  let made = 0;
  const rules = { fail: o.failCreate || null };   // (kind, n) -> an error to throw, or null; a guard may lift it
  const createRoom = async (opts) => {
    if (gate.p) await gate.p;
    if (rules.holdAt === creates.length && rules.holdP) await rules.holdP;   // the n-th create held, the ones before it answered
    const cc = Object.assign({ room_version: opts.room_version || "1" }, opts.creation_content || {});
    const err = rules.fail ? rules.fail(cc.ddjp_kind, creates.length) : null;
    if (err) throw err;
    const id = "!made" + (++made) + ":hs";
    const pl = ((opts.initial_state || []).find((e) => e.type === "m.room.power_levels") || {}).content || { users: {}, users_default: 0 };
    const jr = ((opts.initial_state || []).find((e) => e.type === "m.room.join_rules") || {}).content || { join_rule: "invite" };
    hs.room(id, { name: opts.name, creator: ME, content: cc, members: { [ME]: "join" }, joinRule: jr.join_rule, allow: jr.allow ? jr.allow[0].room_id : null,
      power: JSON.parse(JSON.stringify(pl)), parent: cc.ddjp_room || null });
    creates.push({ id, kind: cc.ddjp_kind, room: cc.ddjp_room, users: JSON.parse(JSON.stringify(pl.users || {})), send: pl.events && pl.events["m.room.message"], joinRule: jr.join_rule });
    return { room_id: id };
  };
  const extra = {
    createRoom,
    sendStateEvent: async (rid, type, content, key) => {
      if (type === "m.space.child") { if (hs.rooms[rid].children.indexOf(key) < 0) hs.rooms[rid].children.push(key); return {}; }
      if (type === "m.room.power_levels") { plSends.push(rid); hs.rooms[rid].power = JSON.parse(JSON.stringify(content)); return {}; }
      return {};
    },
    invite: async (rid, u) => { invites.push([rid, u]); hs.invite(rid, u, { from: ME }); },
  };
  // `ddjp_697`: a paced send's gap (a second at most here) runs for real — the reconcile's invites are paced now, and the bot step
  // right after them waits out the rest of its second on the rank clock; held, it was a promise that never settled.
  const timers = (fn, ms) => ((ms || 0) === 20000 ? (setImmediate(fn), 0) : ((ms || 0) <= 1000 ? setTimeout(fn, ms) : 0));   // the creation delay at once
  const store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {}, loadPendingCreate: () => null, saveLeaving() {}, loadLeaving: () => [] } };
  const w = W.inviteWorld({ hs, client: extra, extras: { setTimeout: timers, Store: store } });
  const plan1 = w.sb.Backends.planFor("backend1") || [], plan2 = w.sb.Backends.planFor("backend2") || [];
  const levels = { [STAFF_U]: 60, [BOT_U]: 99 };
  const room = (sid, mode, keys, opt) => {
    const p = opt || {};
    const R = hs.ddjpRoom(sid, { mode, keys, creator: p.creator || ME, name: p.name });
    for (const id of [sid].concat(Object.values(R.ch))) { hs.rooms[id].power = { users: Object.assign({}, levels, p.levels || {}), users_default: 0 }; hs.rooms[id].members[ME] = "join"; }
    for (const u of [STAFF_U, BOT_U]) { hs.rooms[sid].members[u] = "join"; for (const k of keys) if (!/^chat_/.test(k) || k === "chat_uncategorized") hs.rooms[R.ch[k]].members[u] = "join"; }
    return R;
  };
  const upTo = (n, less) => plan1.filter((r) => r.batch <= n && (less || []).indexOf(r.key) < 0).map((r) => r.key);
  const top = plan1.reduce((m, r) => Math.max(m, r.batch || 1), 1);
  const lastKeys = plan1.filter((r) => r.batch === top).map((r) => r.key);
  const mMissing = [lastKeys[lastKeys.length - 1], lastKeys[lastKeys.length - 2]];
  const R = {};
  R.M = room("!m:hs", "backend1", upTo(top, mMissing), { name: "Room M" });
  const b2 = plan1.filter((r) => r.batch === 2).map((r) => r.key);
  R.T = room("!t:hs", "backend1", upTo(2, [b2[0]]), { name: "Room T" });
  R.C = room("!c:hs", "backend1", upTo(top, ["settings_owner"]), { name: "Room C" });
  R.K = room("!k:hs", "backend1", upTo(top), { name: "Room K" });
  hs.room("!stray:hs", { name: "stray", content: { room_version: "12", ddjp_room: "!elsewhere:hs", ddjp_kind: "chat_staff" }, members: { [ME]: "join" } });
  hs.rooms["!k:hs"].children.push("!stray:hs");
  R.F = room("!f:hs", "backend1", upTo(top), { name: "Room F" });
  R.B = room("!b:hs", "backend2", plan2.map((r) => r.key).filter((k) => k !== "chat_guest"), { name: "Room B" });
  R.J = room("!j:hs", "backend1", upTo(top, ["chat_guest"]), { name: "Room J", creator: OWNER, levels: { [ME]: 99 } });
  R.U = room("!u:hs", "backend1", upTo(top, ["chat_guest"]), { name: "Room U" });
  hs.rooms[R.U.ch.chat_staff].members[ME] = "leave";   // a listed channel this account holds nothing of
  return { hs, w, R, creates, invites, plSends, gate, plan1, plan2, lastKeys, mMissing, b2, top, rules,
    hold() { let r; gate.p = new Promise((x) => { r = x; }); gate.r = r; }, release() { const r = gate.r; gate.p = null; if (r) r(); },
    holdAt(n) { let r; rules.holdAt = n; rules.holdP = new Promise((x) => { r = x; }); return () => { rules.holdAt = null; rules.holdP = null; r(); }; } };
}
const applied = (w) => typeof w.Room.needsAttention === "function" && typeof w.Room.repairRoom === "function" && typeof w.MB.roomAttention === "function";
const byId = (list, sid) => (list || []).find((a) => a.spaceId === sid) || null;

// ── A — THE READING ────────────────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const x = account();
  ok(applied(x.w), "A: APPLIED — `Room.needsAttention`, `Room.repairRoom` and the bridge's `roomAttention` exist", typeof x.w.Room.needsAttention);
  if (!applied(x.w)) return;
  const scan = x.w.Room.scanDDJPRooms();
  const at = x.w.Room.needsAttention(scan);
  const m = byId(at, "!m:hs");
  ok(m && m.kind === "missing" && m.missing === 2 && m.words === "2 of its channels are missing — an upgrade didn't finish." && m.repair === "yes" && m.owned === true,
    "A: MISSING CHANNELS OF A BATCH BEGUN — \"2 of its channels are missing — an upgrade didn't finish.\", Repair (this account may write its channel list)", m);
  const t = byId(at, "!t:hs");
  ok(t && t.kind === "missing" && t.missing === 1 && /^1 of its channels is missing — an upgrade didn't finish\.$/.test(t.words), "A: one of batch 2's, batch 3 never begun — \"1 of its channels is missing — an upgrade didn't finish.\"", t);
  const c = byId(at, "!c:hs");
  ok(c && c.kind === "missing" && c.words === "Its settings channel is missing." && c.repair === "yes", "A: A MISSING CREATION CHANNEL — \"Its settings channel is missing.\"", c);
  const k = byId(at, "!k:hs");
  ok(k && k.kind === "wrong" && k.words === "One of its channels belongs to another room." && k.repair === null, "A: A WRONG MARK — \"One of its channels belongs to another room.\", never repaired", k);
  const b = byId(at, "!b:hs");
  ok(b && b.kind === "missing" && b.words === "Its guest chat is missing." && b.repair === "yes", "A: A BOT ROOM MISSING A CHANNEL — \"Its guest chat is missing.\"", b);
  ok(!byId(at, "!f:hs"), "A: A ROOM WITH NOTHING WRONG IS NOT LISTED", at.map((a) => a.spaceId));
  ok(!byId(at, "!u:hs"), "A: A ROOM ONE OF WHOSE LISTED CHANNELS THIS ACCOUNT HOLDS NOTHING OF — nothing told (it might be the one), listed as normal", byId(at, "!u:hs"));
  const j = byId(at, "!j:hs");
  ok(j && j.kind === "missing" && j.repair === "owner" && j.owned === true, "A: A ROOM THIS ACCOUNT HOLDS EVERY CHANNEL OF BUT CANNOT WRITE THE LIST OF (99) — told, its repair the owner's", j);
  const ra = x.w.MB.roomAttention("!m:hs");
  ok(ra && ra.started === x.top && ra.readable === true && JSON.stringify(ra.missing.map((q) => q.key).sort()) === JSON.stringify(x.mMissing.slice().sort()),
    "A: the bridge's reading — the batch begun (" + x.top + "), every listed channel held, the two missing named", ra);
  // A REFUSED OPENING: said in plain words until the room is next opened. A room whose joined channel carries no mark refuses.
  const y = account();
  const rid = "!old:hs";
  const R0 = y.hs.ddjpRoom(rid, { mode: "backend1", creator: ME, name: "Old room", keys: ["events_uncategorized", "events_owner", "settings_owner"], unmarked: true });
  for (const id of [rid].concat(Object.values(R0.ch))) y.hs.rooms[id].members[ME] = "join";
  let threw = null;
  try { await y.w.Room.join(rid); } catch (e) { threw = (e && e.message) || String(e); }
  const ro = y.w.Room.refusedOpening(rid);
  ok(threw && ro && ro.words === "Its channels were made before they carried their room's mark, so it can't open.", "A: AN OPENING REFUSED — its reason in plain words", { threw, ro });
  const aro = byId(y.w.Room.needsAttention(y.w.Room.scanDDJPRooms()), rid);
  ok(aro && aro.kind === "refused" && aro.words === ro.words && aro.repair === null, "A: and the room is in \"Needs attention\" with it", aro);
  const p2 = y.w.Room.join(rid);
  ok(y.w.Room.refusedOpening(rid) === null, "A: UNTIL IT IS NEXT OPENED — the next opening clears it as it begins", y.w.Room.refusedOpening(rid));
  try { await p2; } catch (e) { /* refused again */ }
  ok(y.w.Room.refusedOpening(rid) !== null, "A: (refused again, said again)");
  ok(y.w.lines(/Room: the opening of !old:hs was refused — the room list says why until it is next opened: Its channels were made before/).length >= 1, "A: and the log says so", y.w.lines(/refused/));
});

// ── B — REPAIR ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const x = account();
  if (!applied(x.w)) { ok(false, "B: APPLIED — `Room.repairRoom` exists"); return; }
  const prog = [];
  x.w.Room.onRepairJob((sid) => { const j = x.w.Room.repairJob(sid); if (sid === "!m:hs" && j) prog.push(j.state + " " + j.done + "/" + j.total); });
  x.hold();
  const p = x.w.Room.repairRoom("!m:hs");
  await later(() => { const j = x.w.Room.repairJob("!m:hs"); return j && j.state === "running"; }, 2000);
  const st = x.w.Room.upgradeBotStep ? x.w.Room.upgradeBotStep() : null;
  ok(st && st.state === "running", "B: A REPAIR HOLDS THE ROOM'S ONE RANK TURN — from start to end", st);
  const rc = await x.w.Room.assignRank(STAFF_U, 40);
  ok(rc && rc.ok === false && rc.reason === "room-upgrading", "B: a rank change asked meanwhile waits for it — refused by name, nothing sent", rc);
  const other = await x.w.Room.repairRoom("!c:hs");
  ok(other && other.ok === false && other.reason === "repair-running" && !x.w.Room.repairJob("!c:hs"), "B: ONE REPAIR AT A TIME — another asked meanwhile is refused, no job made", other);
  x.release();
  const r = await p;
  await x.w.settle(10);
  const made = x.creates.filter((q) => q.room === "!m:hs");
  ok(r && r.ok === true && r.made === 2 && made.length === 2 && JSON.stringify(made.map((q) => q.kind).sort()) === JSON.stringify(x.mMissing.slice().sort()),
    "B: ONLY WHAT IS MISSING IS MADE — the two channels of the batch begun", { r, made: made.map((q) => q.kind) });
  ok(x.creates.length === 2, "B: AND NOTHING ELSE — no other room's, no channel of a batch not begun", x.creates.map((q) => q.room + " " + q.kind));
  ok(made.every((q) => q.users[STAFF_U] === 60 && q.users[BOT_U] === 99 && !Object.prototype.hasOwnProperty.call(q.users, ME)),
    "B: EACH BORN NAMING EVERYONE THE SPACE NAMES (JOB 1's copy) — and not its creator", made.map((q) => q.users));
  ok(made.every((q) => x.hs.rooms["!m:hs"].children.indexOf(q.id) >= 0), "B: each listed by the room (its channel list)", x.hs.rooms["!m:hs"].children.length);
  ok(x.plSends.length === 0, "B: THE BOT STEP CONFIRMS AND SENDS NOTHING — no power-levels event at all", x.plSends);
  ok(x.w.lines(/MatrixBridge: upgrade — the bot @botty:hs holds level 99 in the batch's \d+ channel\(s\)/).length === 1, "B: and its log line says so", x.w.lines(/MatrixBridge: upgrade/));
  ok(x.invites.some(([rid, u]) => u === STAFF_U && made.some((q) => q.id === rid)), "B: THE MEMBERS ARE INVITED where their level belongs (the after-upgrade reconcile)", x.invites);
  ok(prog[0] && /^waiting|^running 0\/2/.test(prog[0]) && prog.indexOf("running 1/2") >= 0 && prog.indexOf("running 2/2") >= 0, "B: ITS PROGRESS — 0, 1, 2 of 2 channels", prog);
  ok(x.w.Room.repairJob("!m:hs") === null && !byId(x.w.Room.needsAttention(x.w.Room.scanDDJPRooms()), "!m:hs") && x.w.Room.upgradeBotStep() === null,
    "B: DONE — the job gone, the room out of \"Needs attention\", the turn given back");
  ok(x.w.lines(/Room: repaired Room M — 2 of 2 missing channel\(s\) made/).length === 1 && x.w.lines(/MatrixBridge: repair of Room M — 2 of 2 missing channel\(s\) made$/).length === 1, "B: and the log lines", x.w.lines(/repair/));
  // NEVER THE NEXT UPGRADE: T began batch 2 only.
  const t0 = x.creates.length;
  const rt = await x.w.Room.repairRoom("!t:hs");
  const tm = x.creates.slice(t0);
  ok(rt && rt.ok === true && tm.length === 1 && tm[0].kind === x.b2[0], "B: NEVER THE NEXT UPGRADE — a room that began batch 2 gets its one missing channel of batch 2, nothing of batch 3", tm.map((q) => q.kind));
  // A CREATION CHANNEL, by its own builder: the settings channel at the owner's level; a bot room's guest chat, invite-only.
  const c0 = x.creates.length;
  const rcx = await x.w.Room.repairRoom("!c:hs");
  const cm = x.creates.slice(c0);
  ok(rcx && rcx.ok === true && cm.length === 1 && cm[0].kind === "settings_owner" && cm[0].send === 99 && cm[0].users[STAFF_U] === 60,
    "B: A MISSING CREATION CHANNEL REMADE BY ITS BUILDER — the settings channel, written at the owner's level, naming everyone", cm);
  ok(cm.length === 1 && x.invites.some(([rid, u]) => rid === cm[0].id && u === STAFF_U), "B: and its members invited (the after-upgrade reconcile, for a creation channel too)", x.invites.filter(([rid]) => cm[0] && rid === cm[0].id));
  const b0 = x.creates.length;
  const rb = await x.w.Room.repairRoom("!b:hs");
  const bm = x.creates.slice(b0);
  ok(rb && rb.ok === true && bm.length === 1 && bm[0].kind === "chat_guest" && bm[0].joinRule === "invite" && bm[0].users[BOT_U] === 99,
    "B: BOTH ROOM TYPES — a bot room's guest chat remade by ITS plan's builder (invite-only), naming everyone", bm);
  // REFUSED: a wrong mark; a room this account may not repair. Nothing made.
  const k0 = x.creates.length;
  const rk = await x.w.Room.repairRoom("!k:hs"), rj = await x.w.Room.repairRoom("!j:hs");
  ok(rk && rk.ok === false && rj && rj.ok === false && x.creates.length === k0, "B: REFUSED, NOTHING MADE — a wrong mark, and a room this account may not repair", { rk, rj });
  const jk = x.w.Room.repairJob("!j:hs");
  ok(jk && jk.state === "failed" && JSON.stringify(jk.failed) === JSON.stringify([{ label: "the repair", why: "only its owner can repair it" }]), "B: and the refusal says why", jk);
  // A REPAIR IS THE LOBBY'S: a room opened meanwhile and left again does not stop it (the leave stops only its own room's turn).
  const v = account();
  const letV = v.holdAt(0);
  const pv = v.w.Room.repairRoom("!m:hs");
  await later(() => { const j = v.w.Room.repairJob("!m:hs"); return j && j.state === "running"; }, 2000);
  v.w.Room._enterForTest({ name: "Room F", spaceId: "!f:hs", channels: Object.assign({}, v.R.F.ch) }, "backend1");
  v.w.Room.leave("the guard leaves Room F");
  const still = v.w.Room.upgradeBotStep();
  letV();
  const rv = await pv;
  ok(still && still.state === "running" && rv && rv.ok === true && rv.made === 2 && v.w.lines(/MatrixBridge: upgrade — the bot @botty:hs holds level 99/).length === 1,
    "B: A ROOM OPENED AND LEFT DURING A REPAIR DOES NOT STOP IT — its turn still held after the leave, both channels made, the bot step run", { still, rv });
  // A FAILURE NAMED, then REPAIR AGAIN finishes it.
  const y = account({ failCreate: (kind, n) => (kind === "presence_chat" ? Object.assign(new Error("Forbidden"), { errcode: "M_FORBIDDEN", httpStatus: 403 }) : null) });
  const ry = await y.w.Room.repairRoom("!m:hs");
  const jy = y.w.Room.repairJob("!m:hs");
  ok(ry && ry.ok === false && jy && jy.state === "failed" && jy.done === 1 && jy.total === 2 && JSON.stringify(jy.failed) === JSON.stringify([{ label: "presence chat", why: "M_FORBIDDEN" }]),
    "B: A FAILURE IS NAMED — 1 of 2 made, \"presence chat (M_FORBIDDEN)\"", jy);
  ok(y.w.lines(/Room: the repair of Room M did not finish — made 1 of 2; presence chat \(M_FORBIDDEN\); Repair again finishes it/).length === 1, "B: and the log says so", y.w.lines(/repair/));
  const n1 = y.creates.length;
  y.rules.fail = null;   // the server lets it through now
  const ry2 = await y.w.Room.repairRoom("!m:hs");
  const again = y.creates.slice(n1);
  ok(ry2 && ry2.ok === true && again.length === 1 && again[0].kind === "presence_chat" && y.w.Room.repairJob("!m:hs") === null,
    "B: REPAIR AGAIN MAKES WHAT IS STILL MISSING — the presence chat alone — and the job goes", { ry2, again: again.map((q) => q.kind) });
});

// ── C — THE ROOM LIST ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function screen(x) {
  const sw = SW.world({ features: { Room: x.w.Room, Chat: { conversations: () => [], dmUnreadCount: () => 0, dmAnswering: () => false } } });
  const doc = sw.doc, S = sw.sb.Screens;
  const add = (tag, id) => { const n = doc.createElement(tag); n.id = id; doc.body.appendChild(n); return n; };
  add("input", "input-join-code"); add("button", "btn-join-room");
  const list = add("div", "room-list"), lock = add("span", "rooms-lock");
  S.showScreen("screen-rooms");
  S.renderRoomList(x.w.Room.scanDDJPRooms());
  const kids = () => list.children;
  const titleAt = (t) => kids().findIndex((c) => c.tag === "h3" && c.textContent === t);
  const rowOf = (name) => kids().find((c) => c.tag !== "h3" && c.querySelector && c.querySelector(".room-item-main") && c.querySelector(".room-item-main").textContent.indexOf(name) === 0) || null;
  const rowsOf = (name) => kids().filter((c) => c.tag !== "h3" && c.textContent.indexOf(name) >= 0);
  const btn = (row, t) => row ? row.querySelectorAll("button").find((b) => b.textContent === t) || null : null;
  return { sw, S, list, lock, kids, titleAt, rowOf, rowsOf, btn, unlock() { lock.querySelectorAll(".panel-lock-btn")[0].click(); } };
}
part("C", async () => {
  const x = account();
  if (!applied(x.w)) { ok(false, "C: APPLIED — `Room.needsAttention` exists (the list has nothing to read)"); return; }
  const s = screen(x);
  const at = s.titleAt("Needs attention"), yr = s.titleAt("Your rooms");
  ok(at >= 0 && yr > at, "C: \"NEEDS ATTENTION\" FIRST, ABOVE \"YOUR ROOMS\"", s.kids().filter((c) => c.tag === "h3").map((c) => c.textContent));
  const m = s.rowOf("Room M");
  const why = m ? m.querySelectorAll(".room-attn-why")[0] : null;
  ok(m && why && why.textContent === "2 of its channels are missing — an upgrade didn't finish." && /\broom-invite-note\b/.test(why.className) &&
     s.sw.cas.declared(why, "color") && s.sw.cas.declared(why, "color").val === "#b58b3a",
    "C: A ROW — the room's name, one plain reason under it in amber (the invite note's amber, borrowed)", m && m.textContent);
  ok(s.kids().indexOf(m) > at && s.kids().indexOf(m) < yr, "C: inside the section", s.kids().indexOf(m));
  ok(s.rowsOf("Room M").length === 1, "C: A ROOM LISTED THERE IS NOT LISTED AGAIN BELOW", s.rowsOf("Room M").length);
  const f = s.rowOf("Room F");
  ok(f && s.kids().indexOf(f) > yr && !f.querySelectorAll(".room-attn-why").length, "C: A ROOM WITH NOTHING WRONG LOOKS AS TODAY — under \"Your rooms\", no reason", f && f.textContent);
  const rep = s.btn(m, "Repair");
  ok(rep && !rep.disabled && !s.btn(m, "Leave"), "C: LOCKED — Repair, live (it only adds); no Leave", m && m.querySelectorAll("button").map((b) => b.textContent));
  const k = s.rowOf("Room K");
  ok(k && !s.btn(k, "Repair") && k.querySelectorAll(".room-attn-why")[0].textContent === "One of its channels belongs to another room.", "C: A WRONG MARK — its reason, and no Repair", k && k.textContent);
  const j = s.rowOf("Room J");
  ok(j && !s.btn(j, "Repair") && j.querySelectorAll(".room-attn-who")[0] && j.querySelectorAll(".room-attn-who")[0].textContent === "Only its owner can repair it.",
    "C: WHERE THIS ACCOUNT MAY NOT — \"Only its owner can repair it.\", no Repair", j && j.textContent);
  s.unlock();
  const k2 = s.rowOf("Room K"), m2 = s.rowOf("Room M");
  ok(k2 && s.btn(k2, "Leave") && /\broom-leave-btn\b/.test(s.btn(k2, "Leave").className) && !s.btn(k2, "Repair"), "C: UNLOCKED — a wrong mark is Leave only, the room's own Leave", k2 && k2.querySelectorAll("button").map((b) => b.textContent));
  ok(m2 && s.btn(m2, "Repair") && s.btn(m2, "Leave"), "C: and a repairable row has Repair and Leave", m2 && m2.querySelectorAll("button").map((b) => b.textContent));
  // THE REPAIR ON THE ROW: "Repairing… 1 of 2 channels" over a bar; done, the row goes and the room is under "Your rooms".
  const y = account();
  const t = screen(y);
  const letGo = y.holdAt(1);   // the second create held: one made, one in flight
  t.btn(t.rowOf("Room M"), "Repair").click();
  await later(() => { const r = t.rowOf("Room M"); return y.creates.length === 1 && r && /Repairing… 1 of 2 channels/.test(r.textContent); }, 3000);
  const mr = t.rowOf("Room M");
  const fill = mr ? mr.querySelectorAll(".room-leave-fill")[0] : null;
  ok(mr && /Repairing… 1 of 2 channels/.test(mr.textContent) && fill && fill.style.width === "50%" && !t.btn(mr, "Repair"),
    "C: A REPAIR RUNNING — \"Repairing… 1 of 2 channels\" over a bar half filled, no second Repair", mr && mr.textContent);
  const c = t.rowOf("Room C");
  ok(c && t.btn(c, "Repair") && t.btn(c, "Repair").disabled === true && t.btn(c, "Repair").title === "Waits for: repairing Room M", "C: ANOTHER ROW'S REPAIR WAITS, greyed, saying for what", c && t.btn(c, "Repair") && t.btn(c, "Repair").title);
  letGo();
  await later(() => !t.rowOf("Room M") || !/Repairing/.test(t.rowOf("Room M").textContent), 3000);
  await later(() => t.titleAt("Your rooms") >= 0 && t.rowOf("Room M") && t.kids().indexOf(t.rowOf("Room M")) > t.titleAt("Your rooms"), 3000);
  ok(t.rowOf("Room M") && t.kids().indexOf(t.rowOf("Room M")) > t.titleAt("Your rooms") && !t.rowOf("Room M").querySelectorAll(".room-attn-why").length,
    "C: DONE — the reason gone, the room under \"Your rooms\" as today", t.rowOf("Room M") && t.rowOf("Room M").textContent);
  // A FAILURE ON THE ROW, with Repair again.
  const z = account({ failCreate: (kind) => (kind === "presence_chat" ? Object.assign(new Error("Forbidden"), { errcode: "M_FORBIDDEN", httpStatus: 403 }) : null) });
  const u = screen(z);
  u.btn(u.rowOf("Room M"), "Repair").click();
  await later(() => { const r = u.rowOf("Room M"); return r && /Repair stopped/.test(r.textContent); }, 3000);
  const fr = u.rowOf("Room M");
  ok(fr && /Repair stopped at 1 of 2 — couldn't make: presence chat \(M_FORBIDDEN\)\./.test(fr.textContent) && u.btn(fr, "Repair again"),
    "C: A FAILURE — \"Repair stopped at 1 of 2 — couldn't make: presence chat (M_FORBIDDEN).\" with \"Repair again\"", fr && fr.textContent);
  // THE REFUSED OPENING'S WORDS on its row.
  const v = account();
  const rid = "!old:hs";
  const R0 = v.hs.ddjpRoom(rid, { mode: "backend1", creator: ME, name: "Old room", keys: ["events_uncategorized", "events_owner", "settings_owner"], unmarked: true });
  for (const id of [rid].concat(Object.values(R0.ch))) v.hs.rooms[id].members[ME] = "join";
  try { await v.w.Room.join(rid); } catch (e) { /* refused */ }
  const vs = screen(v);
  const orow = vs.rowOf("Old room");
  ok(orow && vs.kids().indexOf(orow) < vs.titleAt("Your rooms") && orow.querySelectorAll(".room-attn-why")[0].textContent === "Its channels were made before they carried their room's mark, so it can't open." && !vs.btn(orow, "Repair"),
    "C: A REFUSED OPENING — its plain reason on its row in \"Needs attention\", no Repair", orow && orow.textContent);
});

// ── D — REPAIR ADOPTS, NEVER DUPLICATES (`ddjp_696`) ───────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const x = account();
  if (!applied(x.w)) { ok(false, "D: APPLIED — `Room.repairRoom` exists"); return; }
  // T is missing one of batch 2's channels; a channel of that kind, marked for T, made by THIS account, was never listed.
  const kind = x.b2[0], own = "!own-t:hs";
  x.hs.room(own, { name: "own " + kind, content: { room_version: "12", ddjp_room: "!t:hs", ddjp_kind: kind }, members: { [ME]: "join" }, creator: ME,
    power: { users: { [STAFF_U]: 60, [BOT_U]: 99 }, users_default: 0 }, parent: "!t:hs" });
  const before = x.w.MB.roomAttention("!t:hs");
  ok(before && before.missing.some((m) => m.key === kind), "D: PREMISE — the room does not list it, so it reads missing", before);
  const c0 = x.creates.length, from = x.w.logs.length;
  const r = await x.w.Room.repairRoom("!t:hs");
  ok(r && r.ok === true && r.made === 1 && r.total === 1 && x.creates.length === c0 && x.hs.rooms["!t:hs"].children.indexOf(own) >= 0,
    "D: AN UNFINISHED BATCH — the channel this account made is ADOPTED: listed in the room, nothing made (1 of 1 repaired)", { r, made: x.creates.slice(c0), children: x.hs.rooms["!t:hs"].children });
  ok(x.w.lines(/MatrixBridge: upgrade adopted .* — this account made it and the room did not list it; listed now, not made again \(\d+\/\d+\)$/, from).length === 1 &&
     x.w.lines(/MatrixBridge: repair of Room T — 1 of 1 missing channel\(s\) made \(1 adopted: made by this account before, listed now\)$/, from).length === 1,
    "D: and the log says so", x.w.lines(/MatrixBridge: (repair|upgrade)/, from));
  ok(x.invites.some(([rid, u]) => rid === own && u === STAFF_U), "D: an adopted channel is invited to like one made now", x.invites.filter(([rid]) => rid === own));
  // A CREATION CHANNEL TOO: C is missing its settings channel; this account made one for C and never listed it.
  const y = account();
  const ownS = "!own-c:hs";
  y.hs.room(ownS, { name: "own settings", content: { room_version: "12", ddjp_room: "!c:hs", ddjp_kind: "settings_owner" }, members: { [ME]: "join" }, creator: ME, parent: "!c:hs" });
  const c1 = y.creates.length;
  const ry = await y.w.Room.repairRoom("!c:hs");
  ok(ry && ry.ok === true && ry.made === 1 && y.creates.length === c1 && y.hs.rooms["!c:hs"].children.indexOf(ownS) >= 0,
    "D: A CREATION CHANNEL — adopted the same way, nothing made", { ry, made: y.creates.slice(c1) });
  // ONE ANYONE ELSE MADE IS NEVER ADOPTED, AND NEVER COUNTED.
  const z = account();
  const theirs = "!theirs-c:hs";
  z.hs.room(theirs, { name: "their settings", content: { room_version: "12", ddjp_room: "!c:hs", ddjp_kind: "settings_owner" }, members: { [ME]: "join", [OWNER]: "join" }, creator: OWNER, parent: "!c:hs" });
  const za = z.w.Room.needsAttention(z.w.Room.scanDDJPRooms()).find((a) => a.spaceId === "!c:hs");
  ok(za && za.kind === "missing" && za.words === "Its settings channel is missing.", "D: ONE ANYONE ELSE MADE IS NEVER COUNTED — the room still reads it missing", za);
  const c2 = z.creates.length;
  const rz = await z.w.Room.repairRoom("!c:hs");
  ok(rz && rz.ok === true && z.creates.length === c2 + 1 && z.creates[c2].kind === "settings_owner" && z.hs.rooms["!c:hs"].children.indexOf(theirs) < 0,
    "D: AND NEVER ADOPTED — Repair makes the channel; theirs stays unlisted", { rz, children: z.hs.rooms["!c:hs"].children });
});

// ── E — THE UPGRADE'S WAIT RESTARTS WITH NOTHING SENT (`ddjp_696`) ──────────────────────────────────────────────────────────────
part("E", async () => {
  const fs = require("fs"), vm = require("vm");
  const H2 = 2 * 60 * 60 * 1000, T0 = 1.9e12;
  const x = account();
  if (!applied(x.w)) { ok(false, "E: APPLIED — `Room.repairRoom` exists"); return; }
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "features/roomupgrade.js"), "utf8") + "\n;globalThis.RoomUpgrade = RoomUpgrade;", x.w.sb);
  const RU = x.w.sb.RoomUpgrade;
  // THE RULE, PURE: the newer of the last done marker and the newest channel's making.
  const done2 = [{ kind: "done", n: 2, ts: T0, rank: 99 }];
  ok(RU._computeStatus(done2, T0, 2, x.top, T0 + 3600000).nextAvailableAt === T0 + 3600000 + H2, "E: A CHANNEL NEWER THAN THE MARKER — the wait counts from it", RU._computeStatus(done2, T0, 2, x.top, T0 + 3600000));
  ok(RU._computeStatus(done2, T0, 2, x.top, T0 - 3600000).nextAvailableAt === T0 + H2, "E: AN OLDER ONE — from the marker, as before", RU._computeStatus(done2, T0, 2, x.top, T0 - 3600000));
  ok(RU._computeStatus(done2, T0, 2, x.top, null).nextAvailableAt === T0 + H2 && RU._computeStatus([], T0, 2, x.top, null).nextAvailableAt === 0,
    "E: NONE HELD — the marker alone, as before (and none of either: no wait)");
  // THROUGH THE REAL CODE: T's batch 2 finished by Repair from the lobby — no marker sent — then the room opened.
  const r = await x.w.Room.repairRoom("!t:hs");
  const made = x.creates.find((c) => c.room === "!t:hs");
  ok(r && r.ok === true && made, "E: PREMISE — Repair made T's missing batch-2 channel", r);
  const stamp = (id, ts) => { const v = x.w.client.getRoom(id), g = v.currentState.getStateEvents;
    v.currentState = { getStateEvents: (type, key) => { const e = g(type, key); if (type !== "m.room.create" || !e || Array.isArray(e)) return e; return Object.assign({}, e, { getTs: () => ts }); } }; };
  const chans = {};
  for (const id of x.hs.rooms["!t:hs"].children) { const m = x.w.MB.channelMarkOf(id); if (m && m.kind) chans[m.kind] = id; }
  for (const id of Object.values(chans)) stamp(id, Date.now() - 3 * 86400000);   // the room's channels, made three days ago
  const sent = [];
  x.w.Room._enterForTest({ name: "Room T", spaceId: "!t:hs", channels: chans }, "backend1");
  x.w.MB.sendEvent = async (ch, type, body) => { sent.push(type); return { event_id: "$e" + sent.length }; };
  RU.init(chans.events_owner);
  stamp(made.id, Date.now() - 10 * 60000);   // the Repair, ten minutes ago
  const st = RU.status();
  ok(st.currentBatch === 2 && st.nextBatch === 3 && st.canUpgradeNow === false && Math.abs(st.nextAvailableAt - (Date.now() - 10 * 60000 + H2)) < 5000 && sent.length === 0,
    "E: A BATCH A REPAIR FINISHED WAITS ITS TWO HOURS FROM THE REPAIR — no marker sent, the next upgrade not yet offered", { st, sent });
  const ba = typeof x.w.MB.batchMadeAt === "function" ? x.w.MB.batchMadeAt(chans, 2) : null;
  ok(typeof ba === "number" && Math.abs(ba - (Date.now() - 10 * 60000)) < 5000, "E: the bridge reads it — the newest channel of batch 2, in server time", ba);
  stamp(made.id, Date.now() - 3 * 3600000);   // CONTROL: the same, made three hours ago
  const st2 = RU.status();
  ok(st2.canUpgradeNow === true, "E: CONTROL — made three hours ago, the next upgrade is offered", st2);
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[needs-attention] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[needs-attention] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[needs-attention] PASS — \"Needs attention\" and its Repair (the owner's plan, part 2, JOB 2; " + asserts + " assertions): only what " +
    "this account can tell from what sync holds — missing channels where it holds every listed one, a wrong mark, a refused opening " +
    "until the next — in a section first, above \"Your rooms\", one amber reason a row, the room not listed again; Repair where this " +
    "account may write the room's channel list, locked or not, making only what is missing (never the next batch) with JOB 1's copy, " +
    "the members invited and the bot step sending nothing, in the room's one turn and one at a time, its progress on the row, a " +
    "failure named with Repair again; \"Only its owner can repair it.\" elsewhere; a wrong mark Leave only; both room types; and " +
    "Repair ADOPTS a channel this account made for the room and never listed, never one anyone else made, and the upgrade's wait " +
    "restarts from the newest channel's making, with nothing sent.");
  process.exit(0);
})();
