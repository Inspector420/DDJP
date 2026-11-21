#!/usr/bin/env node
// tests/check-chat-picker.js
// SUBJECT: ui/chat.js, features/room.js, core/chatprefs.js, backends/backend1/matrixbridge.js, ui/chatbuffer.js,
//   ui/shell.js, index.html, ui/screens.js
// WALL: THE CHAT BUTTON (J128, the owner's). Which chats a person can read is their MEMBERSHIP of each, and it moves at once;
// one button between the text box and Send opens a menu of those chats; the view goes to Present when it opens, if the device
// says so; unsent text never goes to a chat its writer did not pick; every chat but Present opens with the same twenty
// readable messages for everyone; the notes float over the chat, a deletion's fading while its mark stays.
//
// DRIVEN ON 647 BEFORE ANY OF THIS WAS BUILT (the brief's own inferences, all confirmed): a demotion's kick from the staff
// chat left Staff offered and still received from; the bot's removal from the presence chat dropped Present only when
// something next asked — nothing told the panel — and its re-add was never heard either; two people reading the same chat
// got 7 and 15 readable messages back from the same history, because the one fetch ran only on a short timeline and
// undecryptable messages counted toward the twenty.
//
// WHERE EACH PART IS DRIVEN:
//   PART A — membership, the FEATURE LAYER: the real bridge and the real room in the invite world (`_inviteworld.js`), the
//            homeserver a model. A kick takes the chat away AT ONCE — from what is offered, from what Chat receives, and from
//            the view, which goes to the room's main chat; a re-add brings it back.
//   PART B — Go to Present, the same world, and its stored answer (`ChatPrefs`): on by default, per device and per account.
//   PART C — past messages: the real `MatrixBridge.recentChatMessages` over a model client (two people, different timeline
//            lengths, undecryptable messages), and the panel's asks through the chat world.
//   PART D — the button and its menu: the real `ui/chat.js` over the REAL resolver (`_chat-world.js` `realResolver`).
//   PART E — the typing lock, the same world and the real `sendChat` from `ui/shell.js`.
//   PART F — the note strip: the real setters over held timers, and the stylesheet (DECLARED — layout is a browser's).
//   PART G — a deletion's note fades after 4 s, and its "Message deleted" mark stays (the owner's correction to J128).
// THE OWNER'S TWO CORRECTIONS AT ddjp_649, each DRIVEN on 648 first:
//   PART H — the twenty, whatever else is fetching that chat: the real bridge, room and Chat in the invite world over a client
//            that keeps the SDK's same-promise rule for a second scrollback, called in `enterMainScreen`'s order (read from
//            `ui/screens.js`) and the other. 648 gave 12 readable from a 105-event window in the screen's order. ITS CLIENT IS NOT
//            THE SDK'S IN TWO WAYS (corrected at ddjp_665): it builds a NEW array per page and decrypts at once, where the SDK
//            splices a page into the live timeline's ONE array while decryptions are pending — so H cannot see a read that walks
//            that array by index. PART K's client does both as the SDK does.
//   PART I — Present shows nothing said before this tab first had it, by a server stamp: the feature layer's floor through
//            the real bridge's own handlers (the people list's read-back decrypting history, a re-add's first sync, a
//            reload), the stamp itself, and the panel holding it (no row, no dot, no chime). 648 delivered sixty.
// AND ITS CORRECTION AT ddjp_650, DRIVEN on 649 first:
//   PART J — every chat shows what it opened with and what is said after, nothing older: All's door through the real bridge's
//            handlers (as PART I), what that delivered replayed into the panel, and the panel's rule at its edges (fewer
//            than twenty, nothing to open with, two tabs' read-backs, a kick and re-add). 649 drew every older decrypt.
// AND ITS CORRECTION AT ddjp_665 (the owner's: "for all chats except present, we try to pull up last 20 messages / we place
// them, dont make mistakes in order, and rpesent takes over under it"), DRIVEN on 664 first, through the real bridge and the
// real panel at once, over a client that keeps the SDK's timeline as it is (one array, a page spliced at its front while
// decryptions are pending):
//   PART K — a chat opens on exactly its last twenty, in order, with no gap, while the people list pages it; a failed ridden
//            fetch is not the chat's start; a window holding fewer than twenty shows those and nothing older; a message said
//            while the chat opens goes under the twenty; Present still opens with nothing from before. 664 gave 15 of the
//            twenty replaced by older ones, 0 for 20, 20 for 7 (with and without a page landing), and 19 of the twenty.
// AND TWO PARTS OF THE JOB THE OWNER CHOSE AT ddjp_670 (his words: "lets do  5 and 3 as a single job?", then "one job"), each
// red on 669 by its own rows:
//   PART L — the button and the menu are redrawn only when what they show changes (J130's rule): a live message keeps the
//            same button, the same open menu, its items and "Go to Present" — a focus on any of them survives, a click lands —
//            while a message that changes what they show (a dot) still redraws them. Real focus is read in Chromium (the report).
//   PART M — no send target when the last readable chat goes: the real `Chat.send`, the room's resolution and the real
//            `sendChat` — the box cannot be typed into, Send greyed, Enter sends nothing and says nothing; a chat back works
//            again, aimed at it; the opening's "no chat yet" still says the chat is still connecting.
//            AND A DISABLED SEND LOOKS GREY (`ddjp_671`; the owner, S1: "make send turn grey yes"): Send as `ui/shell.js` builds
//            it, in its row, disabled by the real `_applySendState` through both of its causes — no chat, and the typing lock —
//            takes the Skip button's disabled look from the page's stylesheet (the screen world's cascade, DECLARED); enabled,
//            it is as it was; the send box keeps the chat's tint either way. The computed colours are Chromium's (the report).
// WHAT THIS CANNOT SEE: the menu's position, the strip's place over the chat, a phone's width — `LIVE-CHECKS.md`.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const { loadInContext } = require("./_load");
const IW = require("./_inviteworld");
const CW = require("./_chat-world");

let asserts = 0;
const failures = [];
const show = (x) => { try { return JSON.stringify(x); } catch (e) { return String(x); } };
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failures.push(msg);
  console.log("[chat-picker] FAIL — " + msg + (got !== undefined ? "\n      got " + show(got) : ""));
}
// A part that throws is a failure that NAMES the part, never a crash that names nothing.
async function part(name, fn) { try { await fn(); } catch (e) { ok(false, name + " threw — " + ((e && e.stack) || e)); } }
// RED AS NAMED ON THE PREVIOUS TREE: what this guard calls may not exist there (647 has no button, no strip, no lock), and
// a row must still be READ and fail by its own name rather than be skipped by a throw above it. So the panel is asked
// through these, which answer undefined for a missing name; every row below then reads its own premise.
const call = (o, name, ...args) => (o && typeof o[name] === "function" ? o[name](...args) : undefined);
const pick = (w, label) => { const b = CW.tierButton(w, label); if (b && typeof b.onclick === "function") { b.onclick(); return true; } return false; };
const pickBtn = (w) => (w.refs.chatPick && w.refs.chatPick.children[0]) || null;
const cls = (n) => (n && typeof n.className === "string" ? n.className : "");

let _t = 1.7e12;
class FastDate extends Date { static now() { _t += 1000; return _t; } }

// ── THE BOT ROOM, OPENED (PARTS A, B) ─────────────────────────────────────────────────────────────────────────────────
// A staff member (60) of a bot room, invited to the staff chat and — unless `presence: false` — to the presence chat.
async function botRoom(o) {
  o = o || {};
  const hs = IW.homeserver();
  const sid = "!pick:hs";
  const A = hs.ddjpRoom(sid, { mode: "backend2", levels: { [IW.ME]: 60 } });
  hs.invite(sid, IW.ME, { from: IW.OWNER });
  hs.invite(A.ch.chat_staff, IW.ME, { from: IW.OWNER });
  if (o.presence !== false) hs.invite(A.ch.presence_chat, IW.ME, { from: IW.OWNER });
  const w = IW.inviteWorld({ hs, withChat: true, extras: { Date: FastDate } });
  if (o.goToPresent === false && typeof w.sb.ChatPrefs.setGoToPresent === "function") w.sb.ChatPrefs.setGoToPresent(false);
  const heard = { n: 0 };
  w.Room.onChatTiersChanged(() => heard.n++);
  const sentTo = [];
  const send0 = w.client.sendMessage;
  w.client.sendMessage = async (roomId, c) => { sentTo.push(roomId); return send0(roomId, c); };
  await w.Room.acceptInvite(sid); await w.settle(10);
  await w.Room.join(sid); await w.settle(30);
  const res = () => w.Room.chatTiers();
  const r = {
    w, hs, A, sid, heard, sentTo,
    tiers: () => res().tiers.map((t) => t.tier),
    active: () => res().activeTier,
    readable: () => w.Chat.readableTiers(),
    // A kick: this account's membership of the channel moves, the SDK says so (`Room.myMembership`), and the state follows.
    kick: (id) => {
      hs.rooms[id].members[IW.ME] = "leave";
      w.emit("Room.myMembership");
      w.state(id, "m.room.member", IW.ME, { membership: "leave" }, IW.OWNER);
    },
    // The bot adds this account back: an invite, which the join step takes.
    readd: async (id) => {
      hs.invite(id, IW.ME, { from: IW.OWNER });
      w.emit("Room.myMembership");
      w.state(id, "m.room.member", IW.ME, { membership: "invite" }, IW.OWNER);
      await w.settle(40);
    },
    done: () => { try { w.Room.leave("the guard is done"); } catch (e) {} },
  };
  return r;
}

// ── THE SDK'S SCROLLBACK, ITS SAME-PROMISE RULE ONLY (PARTS H, I; J128's correction) ─────────────────────────────────────
// matrix-js-sdk 41.8.0 `client.js` `scrollback`: while a request for a room is ongoing a second call returns the SAME promise;
// an empty chunk is the room's start, and a call there asks nothing. NOT THE SDK'S TIMELINE (ddjp_665): a page here makes a NEW
// array (`chunk.concat`) and every event is readable at once, where the SDK splices into the live timeline's one array with
// decryptions pending — so a read walking that array by index cannot go wrong here. `sdkTimeline` below (PART K) is the SDK's. Each request is recorded with what it asked and how much
// the room held when it was made. `decrypts` re-emits each event a page brings as `Event.decrypted` through the bridge's own
// handler — what the SDK's event mapper does for an encrypted event (`event-mapper.js`), with no direction. `perRequest` caps
// what one request brings (a homeserver's visibility filter returning fewer than asked).
const NOW = 1.8e12;
const mev = (id, roomId, ts, body, type) => ({ getType: () => type || "m.room.message", getId: () => id, getSender: () => "@a:hs",
  getTs: () => ts, getRoomId: () => roomId, status: null, isDecryptionFailure: () => false, getUnsigned: () => ({}),
  getContent: () => (type === "m.room.member" ? { membership: "join" } : { msgtype: "m.text", body: body || ("said " + id) }) });
async function sdkRoom(o) {
  o = o || {};
  const hs = IW.homeserver();
  const sid = "!sdk:hs";
  const A = hs.ddjpRoom(sid, { mode: "backend2", levels: { [IW.ME]: 0 } });
  hs.invite(sid, IW.ME, { from: IW.OWNER });
  if (o.presence) hs.invite(A.ch.presence_chat, IW.ME, { from: IW.OWNER });
  const server = {}, ongoing = {}, requests = [];
  let H = null;
  const client = {
    decryptEventIfNeeded: async () => {},
    scrollback(room, limit) {
      if (ongoing[room.roomId]) return ongoing[room.roomId];
      if (room._atStart) return Promise.resolve(room);
      requests.push({ room: room.roomId, limit: limit, held: room.timeline.length });
      const p = new Promise((res) => setImmediate(() => {
        const S = server[room.roomId] || [];
        const have = room.timeline.length, end = Math.max(0, S.length - have), start = Math.max(0, end - Math.min(limit, o.perRequest || Infinity));
        const chunk = S.slice(start, end);
        room.timeline = chunk.concat(room.timeline);
        if (!chunk.length) room._atStart = true;
        delete ongoing[room.roomId];
        res(room);
        if (o.decrypts && H) for (const e of chunk.slice().reverse()) for (const fn of (H["Event.decrypted"] || [])) fn(e);
      }));
      ongoing[room.roomId] = p;
      return p;
    },
  };
  const w = IW.inviteWorld({ hs, withChat: true, extras: { Date: FastDate }, client });
  const P = A.ch.presence_chat, main = A.ch.chat_uncategorized;
  // What the client holds of a chat BEFORE the opening (the first sync), and the server's history behind it, oldest first.
  const hold = (id, events) => { server[id] = events.slice(); const r = w.client.getRoom(id); if (r) r.timeline = events.slice(-(o.held && o.held[id] || 1)); };
  if (o.before) o.before({ hold, P, main, server, w, hs });
  // A JOIN BATCH, as the SDK processes one (`sync.ts`): its timeline is injected, THEN `recalculate()` moves the membership.
  // `batchOnJoin[id]` is pushed into the room's timeline when this account joins it, before the membership says joined.
  const batchOnJoin = {};
  const j0 = w.client.joinRoom;
  w.client.joinRoom = async (id) => {
    const b = batchOnJoin[id];
    if (b) { delete batchOnJoin[id]; const r = w.client.getRoom(id); if (r) { r.timeline = r.timeline.concat(b); r._atStart = false; } }
    return j0(id);
  };
  await w.Room.acceptInvite(sid); await w.settle(10);
  await w.Room.join(sid); await w.settle(30);
  try { await w.MB.start(); } catch (e) { /* it stops at crypto and the SDK's startClient; its handlers are on */ }
  H = w.listeners;
  const got = [];
  w.Chat.onMessage((id, sender, body, failed, ts, roomId) => got.push({ id, ts, roomId }));
  return {
    w, hs, A, sid, P, main, server, requests, got, batchOnJoin, hold,
    onChat: (id) => requests.filter((q) => q.room === id),
    kick: (id) => { hs.rooms[id].members[IW.ME] = "leave"; w.emit("Room.myMembership"); w.state(id, "m.room.member", IW.ME, { membership: "leave" }, IW.OWNER); },
    readd: async (id, batch) => {
      if (batch) batchOnJoin[id] = batch;
      hs.invite(id, IW.ME, { from: IW.OWNER }); w.emit("Room.myMembership"); w.state(id, "m.room.member", IW.ME, { membership: "invite" }, IW.OWNER);
      await w.settle(40);
    },
    decrypted: (e) => { for (const fn of (H["Event.decrypted"] || [])) fn(e); },
    done: () => { try { w.Room.leave("the guard is done"); } catch (e) {} },
  };
}
// A chat's server history, oldest first: `n` events, the newest five in the last five seconds and the rest `gap` ms apart;
// a message every 7th event, one in four of them undecryptable on this device.
function chatHistory(roomId, n, gap) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const back = n - 1 - i, ts = back < 5 ? NOW - (back + 1) * 1000 : NOW - 5000 - (back - 4) * gap;
    const msg = i % 7 === 6, failed = msg && (i % 4) === 1;
    const e = mev("$h" + i, roomId, ts, failed ? "** unable to decrypt **" : "m$h" + i, msg ? "m.room.message" : "m.room.member");
    if (failed) { e.isDecryptionFailure = () => true; e.getContent = () => ({ msgtype: "m.bad.encrypted", body: "** unable to decrypt **" }); }
    out.push(e);
  }
  return out;
}
// The owner's answer, from the server's history alone: the last twenty readable among its newest 200 events.
const twenty = (S) => S.slice(Math.max(0, S.length - 200)).filter((e) => e.getType() === "m.room.message" && !e.isDecryptionFailure()).slice(-20).map((e) => e.getId());

// ── THE SDK'S TIMELINE, AS IT IS (PART K; ddjp_665) ───────────────────────────────────────────────────────────────────────
// Shaped from matrix-js-sdk 41.8.0's own source, the one the vendored bundle is built from (`tools/VENDOR_PROVENANCE.md`):
//   · `room.timeline` is ONE array for the room's life: `models/room.js` `get timeline()` returns
//     `getLiveTimeline().getEvents()`, and `models/event-timeline.js` `getEvents()` returns `this.events` itself;
//   · a back page goes INTO that array at its FRONT: `client.js` `scrollback` hands the page to `room.addEventsToTimeline(…,
//     true, …)`, newest first, and `EventTimeline.addEvent` splices each at index 0 (`insertIndex = 0` for
//     `toStartOfTimeline`) — the whole page in one turn, after the request answers; a live event is spliced at the end;
//   · a second `scrollback` while one is out gets the SAME promise; at the room's start (`paginationToken === null`) it
//     answers at once and asks nothing; a failed request rejects and leaves `{ errorTs }` (the SDK then waits up to
//     `SCROLLBACK_DELAY_MS`, 3 s, before the next request — this model does not wait: that changes when, not what);
//   · an ENCRYPTED event is mapped with its decryption STARTED and not finished (`event-mapper.js` calls
//     `decryptEventIfNeeded` without waiting); until it finishes its type is `m.room.encrypted` and it has no body; when it
//     finishes `Event.decrypted` is emitted; `client.decryptEventIfNeeded` hands back the decryption in flight.
// What the model counts, for the rows' premises: requests (what was asked, holding how much, whether it failed), and how many
// page events were spliced in while a `decryptEventIfNeeded` the bridge was awaiting had not finished. `o.decryptTicks` turns
// of the event loop finish a page's decryption; held messages marked pending take `o.heldTicks`; `o.instant` finishes every
// decryption on the spot — the gate's other side (nothing is ever pending, so nothing can land mid-read).
function sdkTimeline(o) {
  o = o || {};
  const listeners = Object.create(null);
  const emit = (evt, ...a) => { for (const fn of (listeners[evt] || []).slice()) fn(...a); };
  const rooms = Object.create(null), server = Object.create(null), ongoing = Object.create(null), requests = [];
  const stats = { awaiting: 0, splicesWhileAwaiting: 0, splices: 0 };
  let failNext = o.failNext || 0;
  const mk = (roomId, s) => {
    const e = { _s: s, _done: !s.enc, _failed: !s.enc && !!s.fails, _prom: null, status: null };
    e.getId = () => s.id; e.getSender = () => "@a:hs"; e.getTs = () => s.ts; e.getRoomId = () => roomId;
    e.getType = () => (s.kind === "member" ? "m.room.member" : (e._done ? "m.room.message" : "m.room.encrypted"));
    e.getContent = () => (s.kind === "member" ? { membership: "join" } : !e._done ? { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "x" }
      : e._failed ? { msgtype: "m.bad.encrypted", body: "** Unable to decrypt **" } : { msgtype: "m.text", body: "said " + s.id });
    e.isDecryptionFailure = () => e._failed; e.isBeingDecrypted = () => !!e._prom && !e._done;
    e.isState = () => s.kind === "member"; e.getUnsigned = () => ({}); e.getAssociatedId = () => null;
    return e;
  };
  const decrypt = (e, turns) => {
    if (e._done || e._prom) return;
    const finish = () => { e._done = true; e._failed = !!e._s.fails; emit("Event.decrypted", e); };
    if (o.instant) { finish(); return; }
    e._prom = new Promise((res) => { let n = turns; const step = () => { if (n-- > 0) return setImmediate(step); finish(); res(); }; setImmediate(step); });
  };
  // A room: `specs` its server history, oldest first; the client holds the newest `held`, decrypted — but for the newest
  // `pendingNewest` messages, or all of them with `allPending`, whose decryptions are still running.
  const room = (id, name, specs, held, pend) => {
    pend = pend || {};
    server[id] = specs;
    const r = { roomId: id, name, _ev: [], _from: Math.max(0, specs.length - held), oldState: { paginationToken: "t" } };
    Object.defineProperty(r, "timeline", { get() { return r._ev; } });
    const h = specs.slice(r._from), msgs = h.map((s, i) => (s.enc ? i : -1)).filter((i) => i >= 0);
    h.forEach((s, i) => {
      const e = mk(id, s);
      if (s.enc && (pend.all || msgs.indexOf(i) >= msgs.length - (pend.newest || 0))) decrypt(e, o.heldTicks || 4);
      else { e._done = true; e._failed = !!s.fails; }
      r._ev.push(e);
    });
    rooms[id] = r;
    return r;
  };
  const client = {
    getRoom: (id) => rooms[id] || null, getRooms: () => Object.values(rooms), getUserId: () => "@me:hs", getSyncState: () => "SYNCING",
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); }, removeListener: () => {},
    decryptEventIfNeeded(ev) {
      if (ev && ev._s && ev._s.enc && !ev._done) decrypt(ev, o.decryptTicks || 4);
      if (!(ev && ev._prom && !ev._done)) return Promise.resolve();
      stats.awaiting++;
      return ev._prom.then(() => { stats.awaiting--; });
    },
    scrollback(r, limit) {
      if (limit === undefined) limit = 30;
      if (ongoing[r.roomId] && ongoing[r.roomId].promise) return ongoing[r.roomId].promise;
      if (r.oldState.paginationToken === null) return Promise.resolve(r);
      const q = { room: r.roomId, limit, held: r._ev.length, failed: false };
      requests.push(q);
      const p = new Promise((res, rej) => setImmediate(() => {
        if (failNext > 0) { failNext--; q.failed = true; ongoing[r.roomId] = { errorTs: 1 }; rej(new Error("the model's request failed")); return; }
        const from = Math.max(0, r._from - limit);
        const chunk = server[r.roomId].slice(from, r._from).map((s) => { const e = mk(r.roomId, s); if (s.enc) decrypt(e, o.decryptTicks || 4); return e; });
        r._from = from;
        for (const e of chunk.slice().reverse()) {
          if (stats.awaiting > 0) stats.splicesWhileAwaiting++;
          stats.splices++;
          r._ev.splice(0, 0, e);
          emit("Room.timeline", e, r, true, false, { liveEvent: false });
        }
        if (!chunk.length) r.oldState.paginationToken = null;
        delete ongoing[r.roomId];
        res(r);
      }));
      ongoing[r.roomId] = { promise: p };
      return p;
    },
  };
  // A message said now: appended at the live end, decrypting, announced as the sync announces it.
  const live = (id, s) => { const r = rooms[id], e = mk(id, s); server[id].push(s); if (s.enc) decrypt(e, o.decryptTicks || 4); r._ev.push(e); emit("Room.timeline", e, r, false, false, { liveEvent: true }); };
  return { client, room, rooms, server, requests, stats, live };
}
// A history of `n` events a second apart ending at NOW, a message (encrypted) on every `every`-th; with `failEvery`, one message
// in that many is undecryptable on this device. `thin` keeps a message in the newest 200 events only every 28th event: 7.
function kHistory(prefix, n, every, failEvery) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const msg = (i % every) === every - 1;
    out.push({ id: prefix + String(i).padStart(4, "0"), ts: NOW - (n - i) * 1000, kind: msg ? "msg" : "member", enc: msg,
      fails: !!(msg && failEvery && (Math.floor(i / every) % failEvery) === 1) });
  }
  return out;
}
const kThin = (prefix) => kHistory(prefix, 700, 2, 0).map((s, i) => (i >= 500 && s.kind === "msg" && (i % 28) !== 1 ? Object.assign({}, s, { kind: "member", enc: false }) : s));
const kTwenty = (S) => S.slice(Math.max(0, S.length - 200)).filter((s) => s.kind === "msg" && !s.fails).slice(-20).map((s) => s.id);

(async () => {
  // ═══ PART A — A KICK TAKES THE CHAT AWAY AT ONCE; A RE-ADD BRINGS IT BACK ════════════════════════════════════════════
  await part("A", async () => {
    const r = await botRoom({});
    const staff = r.A.ch.chat_staff, pres = r.A.ch.presence_chat, main = r.A.ch.chat_uncategorized;
    ok(["uncategorized", "staff", "presence"].every((t) => r.tiers().indexOf(t) >= 0) && r.readable().indexOf(staff) >= 0,
      "A PREMISE — after the opening this staff member reads All, Staff and Present, and Chat receives from the staff chat",
      { tiers: r.tiers(), readable: r.readable() });
    // The person reads Staff — their own pick.
    r.w.Room.selectChatTier("staff");
    ok(r.active() === "staff", "A PREMISE — the person picked Staff and is reading it", r.active());
    // THE DEMOTION: the space's power level drops and the kick lands this account in `leave` in the staff chat.
    const h0 = r.heard.n;
    r.hs.rooms[r.sid].power.users[IW.ME] = 0;
    for (const id of Object.values(r.A.ch)) if (r.hs.rooms[id].power) r.hs.rooms[id].power.users[IW.ME] = 0;
    r.kick(staff);
    // Read BEFORE anything settles: "at once" is the membership trigger itself, not a later redraw.
    ok(r.tiers().indexOf("staff") < 0, "A: A DEMOTION'S KICK TAKES STAFF AWAY AT ONCE — it was still offered on 647", r.tiers());
    ok(r.readable().indexOf(staff) < 0, "A: and Chat no longer receives from the staff chat — on 647 it still did", r.readable());
    ok(r.heard.n > h0, "A: and the panel is told (`Room.onChatTiersChanged`) — on 647 nothing was", { before: h0, after: r.heard.n });
    ok(r.active() === "uncategorized", "A: THE VIEW MOVES AT ONCE TO THE ROOM'S MAIN CHAT, All", r.active());
    ok(r.w.sb.ChatPrefs.chatTier() === null, "A: the view follows the room again — the lost pick is cleared, not left to return",
      r.w.sb.ChatPrefs.chatTier());
    await r.w.Chat.send("after the kick");
    ok(r.sentTo[r.sentTo.length - 1] === main, "A: and the next message goes to the main chat — the chat you read is the chat you send to",
      { sentTo: r.sentTo, main, staff });
    // THE BOT'S REMOVAL FROM PRESENT, while it is being read.
    r.w.Room.selectChatTier("presence");
    ok(r.active() === "presence", "A PREMISE — the person picked Present", r.active());
    const h1 = r.heard.n;
    r.kick(pres);
    ok(r.tiers().indexOf("presence") < 0 && r.readable().indexOf(pres) < 0 && r.heard.n > h1,
      "A: THE BOT'S REMOVAL TAKES PRESENT AWAY AT ONCE, from the menu and from what Chat receives, and the panel is told — on 647 " +
      "it was dropped only when something next asked, and nothing told the panel", { tiers: r.tiers(), readable: r.readable(), heard: [h1, r.heard.n] });
    ok(r.active() === "uncategorized", "A: and the view moves to the main chat", r.active());
    // A MEMBERSHIP EVENT THAT MOVES NOTHING tells the panel nothing (the control: the count above is a reading).
    const h2 = r.heard.n;
    r.w.emit("Room.myMembership");
    ok(r.heard.n === h2, "A CONTROL: a membership change that leaves the chats as they were tells the panel nothing", [h2, r.heard.n]);
    // THE BOT ADDS THIS ACCOUNT BACK.
    await r.readd(pres);
    ok(r.tiers().indexOf("presence") >= 0 && r.readable().indexOf(pres) >= 0 && r.heard.n > h2,
      "A: A RE-ADD BRINGS PRESENT BACK, received from, and the panel is told — on 647 it was never heard", { tiers: r.tiers(), heard: [h2, r.heard.n] });
    r.done();
  });

  // ═══ PART B — GO TO PRESENT ════════════════════════════════════════════════════════════════════════════════════════
  await part("B", async () => {
    {
      const r = await botRoom({});
      ok(r.active() === "presence", "B: THE ROOM OPENS WITH PRESENT READABLE, AND THE VIEW IS PRESENT — Go to Present is on by default",
        { active: r.active(), tiers: r.tiers() });
      r.w.Room.selectChatTier("staff");
      r.kick(r.A.ch.presence_chat);
      ok(r.active() === "staff", "B: A PICK HOLDS — Present going away while Staff is read changes nothing", r.active());
      await r.readd(r.A.ch.presence_chat);
      ok(r.active() === "presence", "B: ...UNTIL PRESENT NEXT OPENS: the bot adds this account back and the view goes to Present", r.active());
      // A ROOM OPENED AGAIN OPENS AFRESH: leaving forgets what was readable, so the next opening is an opening.
      r.w.Room.selectChatTier("staff");
      r.w.Room.leave("the guard opens it again"); await r.w.settle(10);
      await r.w.Room.join(r.sid); await r.w.settle(30);
      ok(r.tiers().indexOf("presence") >= 0 && r.active() === "presence",
        "B: AND THE SAME ROOM OPENED AGAIN, Present readable, opens on Present — leaving forgot what was readable", { tiers: r.tiers(), active: r.active() });
      r.done();
    }
    {
      const r = await botRoom({ goToPresent: false });
      ok(typeof r.w.sb.ChatPrefs.goToPresent === "function" && r.w.sb.ChatPrefs.goToPresent() === false,
        "B PREMISE — this device turned Go to Present off", typeof r.w.sb.ChatPrefs.goToPresent);
      ok(r.tiers().indexOf("presence") >= 0 && r.active() === "uncategorized",
        "B: OFF, the room opens on its main chat though Present is readable", { active: r.active(), tiers: r.tiers() });
      r.kick(r.A.ch.presence_chat);
      await r.readd(r.A.ch.presence_chat);
      ok(r.tiers().indexOf("presence") >= 0 && r.active() === "uncategorized", "B: and Present opening again moves nothing", r.active());
      r.done();
    }
    {
      // A room whose presence chat this account is not in at the opening, and then is added to: "when it becomes readable".
      const r = await botRoom({ presence: false });
      ok(r.tiers().indexOf("presence") < 0 && r.active() === "uncategorized", "B PREMISE — no Present at the opening; the main chat shows",
        { tiers: r.tiers(), active: r.active() });
      await r.readd(r.A.ch.presence_chat);
      ok(r.active() === "presence", "B: PRESENT BECOMING READABLE LATER moves the view to it", r.active());
      r.done();
    }
    // REMEMBERED PER DEVICE AND PER ACCOUNT, the way room settings' advanced toggle is (J127).
    const ns = { cur: "@a:hs" }, blobs = {};
    const Store2 = { prefs: { load: () => blobs[ns.cur] || null, save: (x) => { blobs[ns.cur] = JSON.parse(JSON.stringify(x)); } } };
    const quiet = { info() {}, warn() {}, debug() {}, error() {} };
    const { ChatPrefs: CP } = loadInContext(["core/chatprefs.js"], { URL, Store: Store2, Logger: quiet, StorageIO: { currentNamespace: () => ns.cur } });
    const has = typeof CP.goToPresent === "function" && typeof CP.setGoToPresent === "function";
    ok(has, "B PREMISE — ChatPrefs has Go to Present's reader and setter");
    if (has) {
      CP.load();
      ok(CP.goToPresent() === true, "B: Go to Present is ON by default");
      let fired = 0; CP.onChange(() => fired++);
      CP.setGoToPresent(false);
      ok(blobs["@a:hs"] && blobs["@a:hs"].goToPresent === false, "B: turning it off is stored", blobs["@a:hs"] && blobs["@a:hs"].goToPresent);
      CP.load();
      ok(CP.goToPresent() === false, "B: and survives a reload");
      ok(fired === 0, "B: flipping it fires no onChange — no chat rebuild for a menu checkbox", fired);
      ns.cur = "@b:hs";
      ok(CP.goToPresent() === true, "B: ANOTHER ACCOUNT on this device has its own answer — on until it turns it off");
      ns.cur = "@a:hs";
      ok(CP.goToPresent() === false, "B: and the first account's is still off");
      for (const v of ["false", 0, null, {}]) {
        blobs["@a:hs"] = Object.assign({}, blobs["@a:hs"], { goToPresent: v }); CP.load();
        ok(CP.goToPresent() === true, "B: a stored " + show(v) + " is not a real false, and reads as on");
      }
      // ITS STORED ANSWER IS ITS OWN, BESIDE THE VIEW: one view (`chatTier`, null = follow the room) and one rule for moving
      // it — neither a copy of the room's chat setting.
      ok(CP.chatTier() === null && !("chat" in (blobs["@a:hs"] || {})), "B: and neither answer is a copy of the room's `chat` setting",
        Object.keys(blobs["@a:hs"] || {}).filter((k) => /chat|present/i.test(k)));
    }
  });

  // ═══ PART C — PAST MESSAGES: TWENTY READABLE, THE SAME FOR EVERYONE, PRESENT NONE ═══════════════════════════════════
  await part("C", async () => {
    const quiet = { info() {}, warn() {}, debug() {}, error() {} };
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval, window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
    for (const k of Object.keys(quiet)) sb.Logger[k] = () => {};
    // The server's history since this person joined, oldest first. `every` puts a message on every n-th event (the rest are
    // membership and other events); one message in four is undecryptable on this device.
    const history = (n, every) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const msg = (i % every) === every - 1;
        out.push({ id: "$e" + i, ts: 1000 + i, kind: msg ? "msg" : "member", failed: msg && (i % 4) === 1 });
      }
      return out;
    };
    const evOf = (e) => ({ getType: () => (e.kind === "msg" ? "m.room.message" : "m.room.member"), getId: () => e.id,
      getSender: () => "@a:hs", getTs: () => e.ts, isDecryptionFailure: () => e.failed,
      getContent: () => (e.kind === "msg" ? (e.failed ? { msgtype: "m.bad.encrypted", body: "** unable to decrypt **" } : { msgtype: "m.text", body: "m" + e.id }) : { membership: "join" }) });
    // One person: their client holds the newest `held` events; a scrollback asks for `n` more, one request each.
    const person = (SERVER, held) => {
      const room = { timeline: SERVER.slice(Math.max(0, SERVER.length - held)).map(evOf) };
      const asked = [];
      const client = { getRoom: () => room, decryptEventIfNeeded: async () => {},
        scrollback: async (r, n) => { asked.push(n); const have = r.timeline.length; const start = Math.max(0, SERVER.length - have - n);
          r.timeline = SERVER.slice(start, SERVER.length - have).map(evOf).concat(r.timeline); } };
      return { room, client, asked };
    };
    const read = async (SERVER, held, opts) => {
      const p = person(SERVER, held);
      sb.MatrixBridge._setClientForTest(p.client);
      const r = await sb.MatrixBridge.recentChatMessages("!chat:hs", 20, opts);
      return { msgs: r.messages, ids: r.messages.map((m) => m.event_id), readable: r.messages.filter((m) => !m.failed).length, asked: p.asked };
    };
    const W = { window: 200 };
    for (const [name, SERVER] of [["dense", history(160, 2)], ["sparse", history(200, 5)]]) {
      const P = await read(SERVER, 5, W), Q = await read(SERVER, 120, W);
      ok(P.readable === 20 && Q.readable === 20, "C: " + name + " history — BOTH PEOPLE GET TWENTY READABLE, the short timeline and the one " +
        "another reader lengthened (647: 7 and 15 from the sparse history)", { P: P.readable, Q: Q.readable });
      ok(show(P.ids) === show(Q.ids), "C: " + name + " — and the SAME twenty: the result does not depend on what else the client holds",
        { P: P.ids.slice(0, 3), Q: Q.ids.slice(0, 3) });
      ok(P.msgs.concat(Q.msgs).every((m) => !m.failed), "C: " + name + " — undecryptable messages are not counted and not returned", null);
      ok(P.asked.length <= 1 && Q.asked.length <= 1, "C: " + name + " — at most ONE request each (the owner's: what is missing, in one)",
        { P: P.asked, Q: Q.asked });
      ok(P.asked[0] === 195, "C: " + name + " — the short timeline asks for exactly what is missing of the window: 200 less the 5 it holds",
        P.asked);
      if (name === "dense") ok(Q.asked.length === 0, "C: dense — twenty readable already held in the window: NOTHING is missing, no request", Q.asked);
    }
    {
      // THE WINDOW IS A BOUND, NOT A START: a client holding far more (another reader paged back 400 events) looks at the
      // newest 200 only, and asks nothing — so it gets what the person holding five gets.
      const SERVER = history(600, 2).map((e, i) => (i >= 400 ? Object.assign({}, e, { kind: "member" }) : e));   // newest 200: no messages
      const big = await read(SERVER, 600, W), small = await read(SERVER, 5, W);
      ok(big.ids.length === 0 && small.ids.length === 0 && big.asked.length === 0,
        "C: THE WINDOW BOUNDS THE LOOK — messages older than the newest 200 events are never shown, however much is held, and a full " +
        "window asks for nothing", { big: big.ids.length, small: small.ids.length, askedBig: big.asked });
    }
    {
      // FEWER ONLY WHEN THE CHAT HOLDS FEWER since this person joined (the chats are `joined`-visible: the server starts there).
      const SERVER = history(30, 3);   // ten messages, three of them undecryptable
      const a = await read(SERVER, 2, W), b = await read(SERVER, 30, W);
      const want = SERVER.filter((e) => e.kind === "msg" && !e.failed).length;
      ok(a.readable === want && b.readable === want && show(a.ids) === show(b.ids),
        "C: a chat holding fewer readable messages since this person joined gives everyone those, no more", { want, a: a.readable, b: b.readable });
    }
    {
      // DMs ARE UNCHANGED: without the window, the one bounded fetch on a short timeline, undecryptable messages returned marked.
      const SERVER = history(160, 2);
      const dm = await read(SERVER, 5, undefined);
      ok(dm.asked.length === 1 && dm.asked[0] === 50 && dm.msgs.some((m) => m.failed),
        "C CONTROL: a DM's fetch (no window) is what it was — one request of 2×20+10, failed messages carried", { asked: dm.asked, failed: dm.msgs.filter((m) => m.failed).length });
    }
    {
      // THE PANEL ASKS WITH THE WINDOW, FOR EVERY CHAT BUT PRESENT — and Present opens with nothing in it.
      const w = CW.world({ realResolver: true, history: { "!p:hs": [{ id: "$old", sender: "@a:hs", body: "said before", ts: 50 }] } });
      await w.CP.startChat(w.box); await CW.tick();
      const ids = w.asked.map((a) => a.roomId);
      ok(ids.indexOf("!u:hs") >= 0 && ids.indexOf("!s:hs") >= 0, "C PREMISE — the panel fetched All and Staff on entry", w.asked);
      ok(w.asked.every((a) => a.count === 20 && a.window === 200), "C: each asks for twenty, in the owner's window of 200 events", w.asked);
      ok(ids.indexOf("!p:hs") < 0, "C: PRESENT ASKS FOR NOTHING — it opens with no past messages", ids);
      ok(w.sb.Room.chatTiers().activeTier === "presence" && CW.screen(w.box).length === 0,
        "C: and opened (Go to Present), its chat is empty", { active: w.sb.Room.chatTiers().activeTier, screen: CW.screen(w.box) });
      w.raw("$now", "!p:hs", 9000, "said now");
      ok(show(CW.screen(w.box)) === show(["m:$now"]), "C: and fills with what arrives from now", CW.screen(w.box));
    }
  });

  // ═══ PART D — THE BUTTON AND ITS MENU ════════════════════════════════════════════════════════════════════════════
  await part("D", async () => {
    const w = CW.world({ realResolver: true });
    await w.CP.startChat(w.box); await CW.tick();
    const host = w.refs.chatPick;
    const btn = () => (host && host.children[0]) || null;
    const has = (n, c) => !!n && String(n.className || "").split(/\s+/).indexOf(c) >= 0;
    ok(!!btn() && btn().tag === "button", "D: THE CHAT BUTTON IS THERE, in the holder between the text box and Send",
      host && host.children.map((c) => c.tag + "." + c.className));
    ok(btn() && btn()._text === "P", "D: it shows ONE LETTER — the chat being read, Present (opened by Go to Present)", btn() && btn()._text);
    ok(w.refs.chatInput.placeholder === "Message Present…", "D: THE TEXT BOX'S HINT NAMES THE CHAT IN FULL", w.refs.chatInput.placeholder);
    const menu = CW.chatMenu(w);
    ok(!!menu, "D: clicking the button OPENS THE MENU", host && host.children.map((c) => c.className));
    const items = menu ? menu.children.filter((c) => c.dataset && c.dataset.tier) : [];
    ok(show(items.map((i) => i._text)) === show(["All", "Staff", "Present"]), "D: the menu lists every chat this person can read, BY FULL NAME, in the ladder's order",
      items.map((i) => i._text));
    const tick = (i) => (i.children || []).filter((c) => has(c, "chat-tier-main")).map((c) => c._text).join("");
    ok(items.length === 3 && tick(items[0]) === "✓" && tick(items[1]) === "" && tick(items[2]) === "", "D: THE MAIN CHAT CARRIES THE ✓ (ruling 39), and only it",
      items.map(tick));
    ok(items.length === 3 && has(items[2], "active") && !has(items[0], "active") && items[2].getAttribute("aria-current") === "true",
      "D: and the CURRENT chat is marked", items.map((i) => i.className));
    const box = menu ? menu.children.find((c) => has(c, "chat-pick-go")) : null;
    const cb = box ? box.children.find((c) => c.tag === "input") : null;
    ok(!!box && /Go to Present when it opens/.test(box.textContent) && cb && cb.checked === true,
      "D: AT THE BOTTOM, \"Go to Present when it opens\", ticked by default", box && box.textContent);
    if (cb) { cb.checked = false; cb.onchange(); }
    ok(w.sb.ChatPrefs.goToPresent && w.sb.ChatPrefs.goToPresent() === false, "D: and unticking it is what the device remembers");
    if (cb) { cb.checked = true; cb.onchange(); }
    // Picking a chat shows it, closes the menu and re-letters the button.
    const staff = CW.tierButton(w, "Staff");
    if (staff) staff.onclick();
    ok(btn() && btn()._text === "S" && !host._open && w.refs.chatInput.placeholder === "Message Staff…",
      "D: PICKING Staff shows it: the button reads S, the menu closes, the hint reads \"Message Staff…\"",
      { letter: btn() && btn()._text, open: host && host._open, hint: w.refs.chatInput.placeholder });
    // THE DOT: something unseen in any OTHER chat — orange; a mention of you — purple, which wins.
    w.raw("$all1", "!u:hs", 5000, "hello all");
    call(w.CP, "_renderChatPicker");
    ok(has(btn(), "unread") && !has(btn(), "mentioned"), "D: A NEW MESSAGE IN ANOTHER CHAT PUTS AN ORANGE DOT ON THE BUTTON", btn() && btn().className);
    w.raw("$all2", "!u:hs", 5001, "hey @me:hs look");
    call(w.CP, "_renderChatPicker");
    ok(has(btn(), "mentioned") && !has(btn(), "unread"), "D: A MENTION OF YOU THERE MAKES IT PURPLE — purple over orange, one dot", btn() && btn().className);
    const m2 = CW.chatMenu(w);
    const all = m2 ? m2.children.find((c) => c.dataset && c.dataset.tier === "uncategorized") : null;
    ok(all && has(all, "mentioned") && !has(all, "unread"), "D: and the menu dots that chat, purple over orange", all && all.className);
    call(w.CP, "_closeChatPicker");
    // The chat on screen, with something UNREAD in it — the reader scrolled up, so arriving does not read it: the button still
    // carries no dot for it. (At the bottom a message is read as it arrives, which would hide whether this rule holds.)
    const w2 = CW.world({ realResolver: true });
    const par2 = CW.el("div"); par2.appendChild(w2.box);
    await w2.CP.startChat(w2.box); await CW.tick();
    const p2 = pick(w2, "Staff");
    for (let i = 0; i < 20; i++) w2.raw("$sf" + i, "!s:hs", 6000 + i, "filler " + i);
    w2.box.scrollTop = 0; if (w2.box._onscroll) w2.box._onscroll();
    w2.raw("$s1", "!s:hs", 6100, "in staff, on screen, below the reader");
    call(w2.CP, "_renderChatPicker");
    ok(p2 && w2.sb.ChatPrefs.tierUnread("staff") === true, "D PREMISE — Staff is on screen and holds an unread message (the reader scrolled up)",
      w2.sb.ChatPrefs.tierList());
    ok(p2 && !!pickBtn(w2) && !has(pickBtn(w2), "unread") && !has(pickBtn(w2), "mentioned"),
      "D CONTROL: traffic in the chat ON SCREEN puts no dot on the button — it is in front of you", cls(pickBtn(w2)));
    // ALWAYS SHOWN, EVEN WITH ONE CHAT.
    const w3 = CW.world({ realResolver: true, presenceAtOpen: false });
    w3.real.joined["!s:hs"] = false; w3.sb.Room.applyChatTiers();
    await w3.CP.startChat(w3.box); await CW.tick();
    ok(w3.sb.Room.chatTiers().tiers.length === 1 && !!pickBtn(w3) && pickBtn(w3)._text === "A",
      "D: WITH ONE CHAT THE BUTTON IS STILL THERE, reading A", { tiers: w3.sb.Room.chatTiers().tiers.length, btn: pickBtn(w3) && pickBtn(w3)._text });
    // CHATS APPEAR AND DISAPPEAR IN THE MENU AT ONCE, and come back with their messages.
    const w4 = CW.world({ realResolver: true });
    await w4.CP.startChat(w4.box); await CW.tick();
    w4.raw("$keep", "!s:hs", 7000, "held in staff");
    pick(w4, "Staff");
    w4.member("staff", false);
    const after = CW.chatMenu(w4);
    ok(after && !after.children.some((c) => c.dataset && c.dataset.tier === "staff") && w4.sb.Room.chatTiers().activeTier === "uncategorized"
        && !!pickBtn(w4) && pickBtn(w4)._text === "A",
      "D: A LOST CHAT LEAVES THE MENU AT ONCE and the view moves to the main chat, the button reading A",
      { items: after && after.children.map((c) => c._text), active: w4.sb.Room.chatTiers().activeTier });
    call(w4.CP, "_closeChatPicker");
    w4.member("staff", true);
    const back = CW.tierButton(w4, "Staff");
    ok(!!back, "D: a re-join puts it back in the menu", null);
    if (back) back.onclick();
    ok(show(CW.screen(w4.box)) === show(["m:$keep"]), "D: WITH ITS MESSAGES — held for the session, nothing fetched again",
      { screen: CW.screen(w4.box), asked: w4.asked.filter((a) => a.roomId === "!s:hs").length });
    ok(w4.asked.filter((a) => a.roomId === "!s:hs").length === 1, "D: (one fetch of Staff's history in all, at entry)", w4.asked);
  });

  // ═══ PART E — THE TYPING LOCK ═══════════════════════════════════════════════════════════════════════════════════
  await part("E", async () => {
    // The real `sendChat` and Enter, from ui/shell.js, over this world's refs and its real ChatPanels.
    const shell = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
    const a = shell.indexOf("    const sendChat = async () => {"), b = shell.indexOf("\n    };", a);
    const keyLine = (shell.match(/\n    refs\.chatInput\.onkeydown = [^\n]+\n/) || [""])[0];
    ok(a >= 0 && b > a && !!keyLine, "E PREMISE — the real `sendChat` and the box's Enter were found in ui/shell.js");
    ok(/refs\.chatSend = el\("button", \{[^}]*onclick: sendChat/.test(shell), "E PREMISE — Send is `refs.chatSend`, and it sends through `sendChat`");
    const wire = (w) => {
      const sent = [];
      const ctx = { refs: w.refs, console, ChatPanels: w.CP, _showCryptoBanner: () => {},
        Chat: { cryptoReady: () => true, send: async (v) => { sent.push(v); return { ok: true }; }, charCount: (s) => s.length, MAX_CHARS: 512 } };
      vm.createContext(ctx);
      vm.runInContext(shell.slice(a, b + 7) + keyLine + "\nglobalThis.__send = sendChat;\n", ctx);
      w.refs.chatSend.onclick = ctx.__send;
      return { sent, enter: async () => { await w.refs.chatInput.onkeydown({ key: "Enter" }); await CW.tick(); }, click: async () => { await w.refs.chatSend.onclick(); await CW.tick(); } };
    };
    const open = async (o) => { const w = CW.world(Object.assign({ realResolver: true }, o || {})); await w.CP.startChat(w.box); await CW.tick(); return w; };
    const locked = (w) => !!(w.CP.chatLocked && w.CP.chatLocked());
    const outline = (w) => /\blocked\b/.test(cls(pickBtn(w)));
    {
      // LOST ACCESS, WITH TEXT IN THE BOX.
      const w = await open({});
      pick(w, "Staff");
      ok(w.sb.Room.chatTiers().activeTier === "staff", "E PREMISE — the person picked Staff and is reading it", w.sb.Room.chatTiers().activeTier);
      const s = wire(w);
      w.refs.chatInput.value = "for the staff only"; w.refs.chatInput.focus();
      w.member("staff", false);
      ok(w.sb.Room.chatTiers().activeTier === "uncategorized", "E PREMISE — Staff went away and the view moved to All", w.sb.Room.chatTiers().activeTier);
      ok(locked(w), "E: THE CHAT CHANGED UNDER UNSENT TEXT, SO IT LOCKS", locked(w));
      ok(w.refs.chatInput.focused === false && w.refs.chatSend.disabled === true && outline(w),
        "E: the box LOSES FOCUS, Send is GREYED, and the chat button carries the RED OUTLINE",
        { focused: w.refs.chatInput.focused, disabled: w.refs.chatSend.disabled, btn: cls(pickBtn(w)) });
      ok(w.refs.chatInput.value === "for the staff only", "E: the text stays", w.refs.chatInput.value);
      w.refs.chatInput.focus();
      await s.enter();
      ok(s.sent.length === 0 && w.refs.chatInput.value === "for the staff only", "E: ENTER DOES NOTHING, EVEN AFTER CLICKING BACK INTO THE BOX", s.sent);
      await s.click();
      ok(s.sent.length === 0, "E: and neither does Send", s.sent);
      // Closing the menu without a pick — the button again, or clicking elsewhere / Escape — keeps it.
      CW.chatMenu(w); call(pickBtn(w), "onclick");
      ok(!w.refs.chatPick._open && locked(w), "E: CLOSING THE MENU WITH THE BUTTON KEEPS THE LOCK", locked(w));
      CW.chatMenu(w); call(w.CP, "_closeChatPicker");
      ok(!w.refs.chatPick._open && locked(w), "E: and so does closing it from outside (a click elsewhere, Escape)", locked(w));
      w.refs.chatInput.value = "";
      call(w.CP, "_renderChatPicker");
      ok(locked(w), "E: EMPTYING THE BOX KEEPS IT (the owner's)", locked(w));
      w.refs.chatInput.value = "for the staff only";
      // Only a pick ends it — the current chat, to confirm.
      const picked = pick(w, "All");
      ok(picked && !locked(w) && w.refs.chatSend.disabled === false && !outline(w), "E: PICKING A CHAT ENDS IT — the current one, to confirm",
        { locked: locked(w), disabled: w.refs.chatSend.disabled });
      await s.enter();
      ok(s.sent.length === 1 && s.sent[0] === "for the staff only", "E: and then Enter sends, to the chat that was picked", s.sent);
    }
    {
      // GO TO PRESENT, WITH TEXT IN THE BOX; then picking ANOTHER chat ends it too.
      const w = await open({ presenceAtOpen: false });
      ok(w.sb.Room.chatTiers().activeTier === "uncategorized", "E PREMISE — no Present at the opening; All shows", w.sb.Room.chatTiers().activeTier);
      w.refs.chatInput.value = "a reply";
      w.member("presence", true);
      ok(w.sb.Room.chatTiers().activeTier === "presence" && locked(w), "E: GO TO PRESENT MOVING THE VIEW UNDER TEXT LOCKS TOO", { active: w.sb.Room.chatTiers().activeTier, locked: locked(w) });
      const back = pick(w, "All");
      ok(back && !locked(w) && w.sb.Room.chatTiers().activeTier === "uncategorized", "E: and picking the chat they were in ends it and goes back there",
        { locked: locked(w), active: w.sb.Room.chatTiers().activeTier });
    }
    {
      // THE ROOM'S MAIN CHAT MOVING while this person follows it.
      const w = await open({ presenceAtOpen: false });
      w.refs.chatInput.value = "text";
      w.tiersState.mainTier = "staff";
      w.sb.Room.applyChatTiers(); w.CP.syncChatTier();
      ok(w.sb.Room.chatTiers().activeTier === "staff" && locked(w), "E: THE MAIN CHAT MOVING UNDER TEXT, while following it, LOCKS", { active: w.sb.Room.chatTiers().activeTier, locked: locked(w) });
    }
    {
      // AN EMPTY BOX LOCKS NOTHING; A PICK NEVER LOCKS.
      const w = await open({ presenceAtOpen: false });
      w.refs.chatInput.value = "   ";
      w.member("presence", true);
      ok(w.sb.Room.chatTiers().activeTier === "presence" && !locked(w), "E: AN EMPTY BOX: the move happens and nothing locks", { active: w.sb.Room.chatTiers().activeTier, locked: locked(w) });
      w.refs.chatInput.value = "picked with text in the box";
      const p3 = pick(w, "Staff");
      ok(p3 && w.sb.Room.chatTiers().activeTier === "staff" && !locked(w), "E: and a PICK with text in the box never locks — it is this person's own choice", locked(w));
    }
    {
      // A CHAT ARRIVING WHERE THERE WAS NONE ("still connecting") moves nothing anybody was reading: no lock.
      const w = CW.world({ realResolver: true, presenceAtOpen: false });
      for (const id of ["!u:hs", "!s:hs"]) w.real.joined[id] = false;
      w.sb.Room.applyChatTiers();
      await w.CP.startChat(w.box); await CW.tick();
      ok(w.sb.Room.chatTiers().activeId === null, "E PREMISE — no chat yet: the room opened before any chat was joined", w.sb.Room.chatTiers().activeId);
      w.refs.chatInput.value = "typed while it connects";
      w.member("uncategorized", true);
      ok(w.sb.Room.chatTiers().activeTier === "uncategorized" && typeof w.CP.chatLocked === "function" && !locked(w),
        "E: A CHAT ARRIVING WHERE THERE WAS NONE LOCKS NOTHING — no chat was being read, so nothing changed under the text", { active: w.sb.Room.chatTiers().activeTier, locked: locked(w) });
    }
    {
      // THE OUTLINE'S RED IS THE OVER-LIMIT COUNTER'S (the owner's), read from the stylesheet (DECLARED).
      const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
      const lockRed = (css.match(/\.chat-pick-btn\.locked \{[^}]*outline:\s*\d+px solid (#[0-9a-fA-F]{6})/) || [])[1];
      const overRed = (css.match(/\.chat-count\.over \{[^}]*color:\s*(#[0-9a-fA-F]{6})/) || [])[1];
      ok(!!lockRed && lockRed.toLowerCase() === "#ff6b6b" && lockRed === overRed,
        "E: the lock's red outline is #ff6b6b — the over-limit counter's red (DECLARED)", { lockRed, overRed });
    }
    {
      // NEVER AT THE START: a new room's box starts unlocked.
      const w = await open({});
      ok(typeof w.CP.chatLocked === "function" && !locked(w) && w.refs.chatSend.disabled !== true, "E: a room's chat starts unlocked", locked(w));
    }
  });

  // ═══ PART F — THE NOTE STRIP ════════════════════════════════════════════════════════════════════════════════════
  await part("F", async () => {
    // Held timers: a row says when time passes.
    const timers = []; let now = 0;
    const ST = (fn, ms) => { const t = { fn, at: now + (ms || 0), live: true }; timers.push(t); return t; };
    const CT = (t) => { if (t) t.live = false; };
    const pass = (ms) => { now += ms; for (const t of timers.slice()) if (t.live && t.at <= now) { t.live = false; t.fn(); } };
    const w = CW.world({ realResolver: true, presenceAtOpen: false, extras: { setTimeout: ST, clearTimeout: CT } });
    await w.CP.startChat(w.box);
    const n = w.refs.chatNote;
    const shown = () => (n.classList.contains("show") ? n.textContent : "");
    const fading = () => n.classList.contains("fading");
    ok(typeof w.CP._noteChatOnce === "function" && typeof w.CP._noteChatStay === "function", "F PREMISE — the strip's setters are the panel's");
    ok(shown() === "", "F: with nothing to say, the strip is not shown", shown());
    call(w.CP, "_noteChatConnecting");
    ok(/still connecting/.test(shown()), "F: \"still connecting\" shows", shown());
    pass(60000);
    ok(/still connecting/.test(shown()), "F: A NOTE THAT STAYS TRUE STAYS — a minute later it is still there", shown());
    call(w.CP, "_noteChatOnce", "Deleted for everyone still connected.");
    ok(/^Deleted for everyone/.test(shown()) && !fading(), "F: a deletion's result shows over it", shown());
    pass(3999);
    ok(/^Deleted for everyone/.test(shown()) && !fading(), "F: and is still there at 3.999 s", shown());
    pass(1);
    ok(/^Deleted for everyone/.test(shown()) && fading(), "F: AT 4 S IT FADES (the owner's)", { shown: shown(), fading: fading() });
    pass(499);
    ok(/^Deleted for everyone/.test(shown()), "F: over half a second", shown());
    pass(1);
    ok(/still connecting/.test(shown()) && !fading(), "F: then it is gone, and the note that is still true shows again", shown());
    const wasConnecting = /still connecting/.test(shown());
    w.CP.syncChatTier();
    ok(wasConnecting && shown() === "", "F: \"still connecting\" goes once the chat is there", shown());
    // TOO LONG: set by a refused send, true while the text is over, gone when it fits or is sent.
    call(w.CP, "_noteTooLong", 600, 512, false);
    ok(typeof w.CP._noteTooLong === "function" && shown() === "", "F: the box's own counter never raises \"too long\" by itself — a refused send does", shown());
    call(w.CP, "_noteTooLong", 600, 512, true);
    ok(/Too long — 600\/512/.test(shown()), "F: a refused send says \"Too long\" with its count", shown());
    call(w.CP, "_noteTooLong", 550, 512, false);
    ok(/Too long — 550\/512/.test(shown()), "F: shortening, still over: it stays and the count it states follows the text", shown());
    const over1 = /Too long/.test(shown());
    call(w.CP, "_noteTooLong", 500, 512, false);
    ok(over1 && shown() === "", "F: and it goes when the text fits", shown());
    call(w.CP, "_noteTooLong", 600, 512, true);
    const over2 = /Too long/.test(shown());
    call(w.CP, "_noteChatSent");
    ok(over2 && shown() === "", "F: or when a message is sent", shown());
    const shellNote = (fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8").match(/refs\.chatNote = el\("(\w+)", \{ class: "([^"]*)"[^\n]*/) || []);
    ok(shellNote[1] === "div" && shellNote[2] === "chat-note" && !/onclick/.test(shellNote[0] || ""), "F: the strip the shell builds is not a button",
      shellNote[0]);
    // THE STYLESHEET (DECLARED — layout, and whether a click passes through, are a browser's).
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const rule = (sel) => { const m = new RegExp("\\n\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}").exec(css); return m ? m[1] : null; };
    const px = (decl, prop) => { const m = new RegExp("(?:^|;)\\s*" + prop + ":\\s*(-?\\d+)px").exec(decl || ""); return m ? Number(m[1]) : null; };
    const bar = rule(".chat-note-bar"), note = rule(".chat-note"), live = rule(".chat-live-btn"), col = rule(".chat");
    ok(!!bar && /position:\s*relative/.test(bar) && /height:\s*0/.test(bar) && /pointer-events:\s*none/.test(bar),
      "F: THE STRIP TAKES NO LAYOUT SPACE — a zero-height holder — and lets clicks and scrolling through (DECLARED)", bar);
    ok(!!note && /position:\s*absolute/.test(note) && /pointer-events:\s*none/.test(note) && /display:\s*none/.test(note)
        && /\n\s*\.chat-note\.show \{[^}]*display:\s*block/.test(css),
      "F: the strip floats over the chat, takes no clicks, and is not there until it has something to say (DECLARED)", note);
    ok(px(bar, "margin-top") === -px(col, "gap") && px(col, "gap") > 0,
      "F: the holder cancels the column's gap, so it shares the live bar's line (DECLARED)", { margin: px(bar, "margin-top"), gap: px(col, "gap") });
    ok(px(note, "bottom") >= px(live, "bottom") + px(live, "height") + 4,
      "F: AND IT SITS ABOVE \"Back to live\", NEVER OVER IT: its bottom clears the button's top (DECLARED)",
      { strip: px(note, "bottom"), liveBottom: px(live, "bottom"), liveHeight: px(live, "height") });
    ok(/transition:\s*opacity\s*\.5s/.test(note || "") && /\n\s*\.chat-note\.show\.fading \{[^}]*opacity:\s*0/.test(css),
      "F: and a one-off fades over half a second (DECLARED, beside NOTE_FADE_MS)", note);
    const hex = ((note || "").match(/(?:^|;)\s*color:\s*#([0-9a-fA-F]{6})/) || [])[1];
    const rgb = hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
    const alpha = Number(((note || "").match(/background:\s*rgba\([^)]*,\s*([0-9.]+)\)/) || [])[1]);
    ok(!!rgb && Math.max(...rgb) - Math.min(...rgb) <= 16 && alpha > 0 && alpha < 1,
      "F: grey text on a see-through ground (DECLARED)", { color: hex, alpha });
    const shellSrc = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
    ok(/refs\.chatBox,\s*\n\s*el\("div", \{ class: "chat-note-bar" \}, \[refs\.chatNote\]\),/.test(shellSrc) && !/class: "muted chat-note"/.test(shellSrc),
      "F: the shell puts the strip's holder right after the box, and the note LINE is gone", null);
  });

  // ═══ PART G — A DELETION'S NOTE FADES; ITS MARK STAYS ════════════════════════════════════════════════════════════
  // The owner's correction to J128: a deleted message keeps its "Message deleted" mark exactly as before (`check-chat-redaction`
  // D and `check-chat-view` G hold the mark); only the deletion's NOTE changes — a one-off on the strip, gone after 4 s.
  // Driven the way a person deletes: the row's own ×, through the actions list, and the redaction coming back.
  await part("G", async () => {
    const timers = []; let now = 0;
    const ST = (fn, ms) => { const t = { fn, at: now + (ms || 0), live: true }; timers.push(t); return t; };
    const CT = (t) => { if (t) t.live = false; };
    const pass = (ms) => { now += ms; for (const t of timers.slice()) if (t.live && t.at <= now) { t.live = false; t.fn(); } };
    const w = CW.world({ extras: { setTimeout: ST, clearTimeout: CT } });
    await w.CP.startChat(w.box);
    w.raw("$mine", "!u:hs", 100, "something I regret", "@me:hs");
    const row = w.box.children.find((n) => n.dataset && n.dataset.eid === "$mine");
    const del = row ? row._all().find((n) => n.tag === "button" && /\bchat-del\b/.test(n.className || "")) : null;
    ok(!!del, "G PREMISE — my own message is on screen with its delete ×", CW.screen(w.box));
    if (del) await del.onclick();
    await CW.tick();
    const n = w.refs.chatNote;
    const shown = () => (n.classList.contains("show") ? n.textContent : "");
    ok(w.performed.some((x) => x.a === "chat.redact.own") && /^Deleted for everyone still connected/.test(shown()),
      "G: THE DELETION'S NOTE SHOWS on the strip — the action went through the actions list", { performed: w.performed.map((x) => x.a), note: shown() });
    w.redaction("$mine", "!u:hs");
    const mark = () => { const r = w.box.children.find((x) => x.dataset && x.dataset.eid === "$mine"); return !!r && /Message deleted/.test(r.textContent); };
    ok(mark(), "G: THE MESSAGE KEEPS ITS \"Message deleted\" MARK, in its place — exactly as before (the owner's)", CW.screen(w.box));
    pass(4000);
    const fadingNow = /^Deleted for everyone/.test(shown()) && n.classList.contains("fading");
    ok(fadingNow, "G: at 4 s the note fades", { note: shown(), cls: n.classList._s });
    pass(500);
    ok(fadingNow && shown() === "" && mark(), "G: AND THEN THE NOTE IS GONE — while the mark stays", { note: shown(), mark: mark() });
  });

  // ═══ PART H — THE TWENTY, WHATEVER ELSE IS FETCHING THAT CHAT (the owner's correction to J128) ═══════════════════════
  // "The twenty are the last 20 readable in the newest 200 events, whatever else is fetching that chat. Ride an in-flight
  // fetch rather than adding requests, and keep at most one request of its own when nothing else is fetching." DRIVEN on 648
  // in `enterMainScreen`'s order: 12 readable from a window of 105 events, where a tab already holding the chat got 20.
  await part("H", async () => {
    // THE ORDER IS THE APP'S: read from the entry itself, so the rows below call the two in the order the screen does.
    const scr = fs.readFileSync(path.join(ROOT, "ui/screens.js"), "utf8");
    const m = /function enterMainScreen\(room\) \{([\s\S]*?)\n  \}\n/.exec(scr);
    const body = m ? m[1].split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n") : "";
    const at = (re) => { const x = re.exec(body); return x ? x.index : -1; };
    const iChat = at(/ChatPanels\.startChat\(/), iRoster = at(/Roster\.renderRoster\(/), iPanel = at(/Panels\.renderActivePanel\(/);
    ok(iChat >= 0 && iRoster > iChat && iPanel > iChat, "H PREMISE — `enterMainScreen` starts the chat, THEN draws the people list " +
      "(the roster, the active panel), synchronously", { iChat, iRoster, iPanel });
    const reads = ["ui/roster.js", "ui/panels.js"].every((f) => /Room\.presenceView\(now\)/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    const chatSrc = fs.readFileSync(path.join(ROOT, "ui/chat.js"), "utf8");
    ok(reads && /Chat\.backfillRecent\(CHAT_BACKFILL, channelId, \{ window: CHAT_HISTORY_WINDOW \}\)/.test(chatSrc),
      "H PREMISE — both draws read `Room.presenceView`, and the chat's start asks `Chat.backfillRecent` with the window", reads);
    const S = (id, gap) => chatHistory(id, 400, gap);
    const race = async (order, o) => {
      o = o || {};
      const r = await sdkRoom({ perRequest: o.perRequest });
      const hist = S(r.main, o.gap || 600000);
      r.hold(r.main, hist);
      r.w.client.getRoom(r.main).timeline = hist.slice(hist.length - (o.held || 5));
      let chat;
      if (order === "people first") {                     // the screen's order: startChat, then the people list
        chat = r.w.Chat.backfillRecent(20, r.main, { window: 200 });
        r.w.Room.presenceView(NOW);
      } else if (order === "chat first") {                 // the chat's request already out when the people list reads back
        chat = r.w.Chat.backfillRecent(20, r.main, { window: 200 });
        for (let i = 0; i < 40 && r.onChat(r.main).length === 0; i++) await Promise.resolve();
        r.w.Room.presenceView(NOW);
      } else chat = r.w.Chat.backfillRecent(20, r.main, { window: 200 });
      const res = await chat;
      await r.w.settle(30);
      const out = { ids: res.messages.map((x) => x.id), want: twenty(hist), asked: r.onChat(r.main).map((q) => q.limit + "@" + q.held) };
      r.done();
      return out;
    };
    {
      const a = await race("people first");
      ok(a.asked[0] === "100@5", "H PREMISE — in the screen's order the people list's read-back asks the chat first (100, holding 5)", a.asked);
      ok(show(a.ids) === show(a.want) && a.ids.length === 20, "H: PEOPLE FIRST (THE SCREEN'S ORDER) — THE TWENTY ARE THE LAST 20 READABLE " +
        "OF THE NEWEST 200 EVENTS; on 648 the chat rode the read-back's 100 and stopped there, with 12", { got: a.ids.length, same: show(a.ids) === show(a.want) });
      ok(a.asked.length === 2 && a.asked[1] === "95@105", "H: it RODE the read-back's request, adding none while it was in flight, then " +
        "asked what was still missing — 95 — in ONE request of its own", a.asked);
    }
    {
      const b = await race("chat first");
      ok(show(b.ids) === show(b.want), "H: CHAT FIRST — the same twenty", { got: b.ids.length });
      ok(show(b.asked) === show(["195@5"]), "H: one request, the chat's own — the read-back starting meanwhile rode it", b.asked);
    }
    {
      // A READ-BACK THAT PAGES ON (events a second apart: its window is not reached in one page) is ridden page by page.
      const c = await race("people first", { gap: 1000 });
      ok(show(c.ids) === show(c.want), "H: a read-back that PAGES ON is ridden to the window — the same twenty", { got: c.ids.length });
      ok(c.asked.length >= 2 && c.asked.every((x) => /^100@/.test(x)), "H: and the chat asks NOTHING of its own: every request is the read-back's", c.asked);
    }
    {
      const d = await race("alone", { held: 300 });
      ok(show(d.ids) === show(d.want) && d.asked.length === 0, "H CONTROL: a tab already holding 300 events gets the same twenty and asks nothing", d.asked);
    }
    {
      // AT MOST ONE OF ITS OWN: a request that brings fewer than asked (the homeserver filtered some) is not followed by a second.
      const e = await race("alone", { perRequest: 60 });
      ok(show(e.asked) === show(["195@5"]), "H: AT MOST ONE REQUEST OF ITS OWN — one that brings fewer than asked is not followed by a second", e.asked);
    }
  });

  // ═══ PART I — PRESENT: NOTHING SAID BEFORE THIS TAB FIRST HAD IT (the owner's correction to J128) ══════════════════════
  // "Present shows nothing said before this tab first had Present in this room, measured by a server stamp, never the device
  // clock. Everything held since then stays, through kicks and re-adds." DRIVEN on 648 through the real bridge's handlers:
  // the people list's read-back at the opening paged Present back and the SDK's decrypts of it reached the panel as live —
  // sixty messages from the half hour before the tab opened; and the model homeserver's join delivers no history at all, so a
  // re-add's first sync is delivered here as the SDK processes one (its timeline, then the membership, then the decrypts).
  await part("I", async () => {
    {
      const r = await sdkRoom({ presence: true, decrypts: true, before: (x) => {
        const old = [];
        for (let i = 60; i >= 1; i--) old.push(mev("$p-old" + i, x.P, NOW - 2000 - i * 30000, i % 10 === 0 ? "hey @me:hs" : "earlier " + i));
        x.hold(x.P, old.concat([mev("$p-newest", x.P, NOW - 2000, "the newest before the opening")]));
      } });
      const floor = call(r.w.Room, "chatFloor", r.P);
      ok(floor === NOW - 2000, "I: AT THE OPENING PRESENT'S FLOOR IS THE NEWEST SERVER STAMP THIS CLIENT HOLDS THERE", { floor, want: NOW - 2000 });
      ok(call(r.w.Room, "chatFloor", r.main) === null, "I: the other chats have none — they open on their last twenty", call(r.w.Room, "chatFloor", r.main));
      r.w.Room.presenceView(NOW);
      await r.w.settle(40);
      const fromP = r.got.filter((g) => g.roomId === r.P);
      ok(fromP.length === 60, "I PREMISE — THE DOOR IS OPEN: the people list's read-back paged Present back and its decrypts reached the " +
        "panel as live, all sixty (the bridge's `Event.decrypted` carries no direction)", fromP.length);
      ok(typeof floor === "number" && fromP.every((g) => !(g.ts > floor)), "I: and every one of them is at or below Present's floor, so the " +
        "panel files none — on 648 nothing held them back", { floor, newestDelivered: Math.max.apply(null, fromP.map((g) => g.ts)) });
      // KICKED, AND ADDED BACK WITH A FIRST SYNC THAT CARRIES AN EARLIER STRETCH: the floor stays where this tab first had it.
      r.kick(r.P); await r.w.settle(10);
      const JOIN = NOW + 600000;
      await r.readd(r.P, [mev("$p-stretch", r.P, NOW - 3600000, "an earlier stretch"), mev("$p-join", r.P, JOIN, null, "m.room.member")]);
      ok(r.w.Room.chatTiers().tiers.some((t) => t.tier === "presence"), "I PREMISE — the bot added this account back", r.w.Room.chatTiers().tiers.map((t) => t.tier));
      ok(typeof floor === "number" && call(r.w.Room, "chatFloor", r.P) === floor, "I: THROUGH A KICK AND A RE-ADD THE FLOOR STAYS where this tab first had Present — " +
        "so what was held since then stays", { now: call(r.w.Room, "chatFloor", r.P), first: floor });
      r.decrypted(mev("$p-stretch", r.P, NOW - 3600000, "an earlier stretch"));
      const st = r.got.filter((g) => g.id === "$p-stretch");
      ok(st.length >= 1, "I PREMISE — the re-add's earlier stretch, decrypted, reaches the panel (the door is open here too)", st);
      ok(typeof floor === "number" && st.length >= 1 && !(st[0].ts > floor), "I: and it is below the floor, so the panel files it not", { st, floor });
      // A ROOM OPENED AGAIN OPENS AFRESH: its floor is the opening's.
      r.w.client.getRoom(r.P).timeline.push(mev("$p-later", r.P, JOIN + 5000, "said before the second opening"));
      r.w.Room.leave("the guard opens it again"); await r.w.settle(10);
      await r.w.Room.join(r.sid); await r.w.settle(30);
      ok(call(r.w.Room, "chatFloor", r.P) === JOIN + 5000, "I: and the same room opened again opens afresh — its floor is the new opening's",
        call(r.w.Room, "chatFloor", r.P));
      r.done();
    }
    {
      // A RELOAD WHILE OUT OF PRESENT: the tab first has Present when the bot adds this account back.
      const r = await sdkRoom({ presence: false, decrypts: true });
      ok(!r.w.Room.chatTiers().tiers.some((t) => t.tier === "presence"), "I PREMISE — opened out of Present: it is not offered",
        r.w.Room.chatTiers().tiers.map((t) => t.tier));
      ok(call(r.w.Room, "chatFloor", r.P) === null, "I: and it has no floor yet — never offered in this room, never had", call(r.w.Room, "chatFloor", r.P));
      const JOIN = NOW + 900000;
      await r.readd(r.P, [mev("$r-stretch", r.P, NOW - 7200000, "an earlier stretch, before this page"), mev("$r-join", r.P, JOIN, null, "m.room.member")]);
      ok(r.w.Room.chatTiers().tiers.some((t) => t.tier === "presence"), "I PREMISE — the bot added this account", r.w.Room.chatTiers().tiers.map((t) => t.tier));
      ok(call(r.w.Room, "chatFloor", r.P) === JOIN, "I: AFTER A RELOAD THE FLOOR IS THE RE-ADD'S: the newest server stamp its first sync " +
        "brought — the join", { floor: call(r.w.Room, "chatFloor", r.P), join: JOIN });
      r.done();
    }
    {
      // A SERVER STAMP, NEVER THE DEVICE CLOCK: a local echo is stamped by this device until the server echoes it.
      const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], {
        Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval, window: {}, document: { body: { appendChild() {} } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
      const echo = Object.assign(mev("~!p:hs:txn1", "!p:hs", 9e15, "mine, still sending"), { status: "sending" });
      const room = { timeline: [mev("$s1", "!p:hs", 4000), echo],
        currentState: { getStateEvents: (t, k) => (t === "m.room.member" && k === "@me:hs" ? mev("$j", "!p:hs", 3000, null, "m.room.member") : null) } };
      sb.MatrixBridge._setClientForTest({ getRoom: () => room, getUserId: () => "@me:hs" });
      const s = call(sb.MatrixBridge, "newestStampIn", "!p:hs");
      ok(s === 4000, "I: THE STAMP IS THE SERVER'S — a local echo, stamped by this device's clock until the server echoes it, is skipped", s);
      room.timeline = [];
      ok(call(sb.MatrixBridge, "newestStampIn", "!p:hs") === 3000, "I: and with nothing held, this account's own join is the stamp", call(sb.MatrixBridge, "newestStampIn", "!p:hs"));
    }
    {
      // THE PANEL HOLDS IT: nothing at or below the floor is shown, counted or chimed; what comes after is, and stays.
      const rec = { chimes: 0 };
      const AC = class { constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createGain() { rec.chimes++; return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      const w = CW.world({ realResolver: true, AudioContext: AC, stamps: { "!p:hs": 5000 } });
      await w.CP.startChat(w.box); await CW.tick();
      const P = w.sb.ChatPrefs;
      pick(w, "Staff");
      ok(w.sb.Room.chatTiers().activeTier === "staff", "I PREMISE — the person reads Staff; Present is not on screen", w.sb.Room.chatTiers().activeTier);
      w.raw("$before", "!p:hs", 4000, "hey @me:hs, said before this tab had Present", "@b:hs");
      w.raw("$edge", "!p:hs", 5000, "the newest this client held at the opening", "@b:hs");
      ok(P.tierUnread("presence") === false && P.tierMentioned("presence") === false && rec.chimes === 0,
        "I: A MESSAGE STAMPED BEFORE THE FLOOR — even one that mentions you — lights no dot and plays nothing (on 648: purple and a chime)",
        { unread: P.tierUnread("presence"), mentioned: P.tierMentioned("presence"), chimes: rec.chimes });
      w.raw("$after", "!p:hs", 6000, "hey @me:hs, said now", "@b:hs");
      ok(P.tierMentioned("presence") === true && rec.chimes > 0, "I: one stamped after it is live — the purple dot and the chime. The device " +
        "clock here reads 9e15: the floor is a server stamp", { mentioned: P.tierMentioned("presence"), chimes: rec.chimes });
      pick(w, "Present");
      ok(show(CW.screen(w.box)) === show(["m:$after"]), "I: AND PRESENT SHOWS ONLY WHAT CAME AFTER — the earlier one was never filed", CW.screen(w.box));
      // KICKED AND ADDED BACK — its first sync bringing a later stamp, an earlier stretch, and one said after the floor.
      w.member("presence", false); w.stamp("presence", 9000); w.member("presence", true);
      pick(w, "Present");
      w.raw("$stretch", "!p:hs", 4500, "an earlier stretch", "@b:hs");
      w.raw("$between", "!p:hs", 7000, "said after the floor, before the re-add", "@b:hs");
      ok(show(CW.screen(w.box)) === show(["m:$after", "m:$between"]), "I: THROUGH A KICK AND A RE-ADD what was held stays, the earlier stretch " +
        "stays out, and the floor is still where this tab first had Present (7000 shows though the re-add's stamp is 9000)", CW.screen(w.box));
    }
    {
      // A STAMP THAT CANNOT BE READ: nothing is filed until one can (fail closed — nothing older can slip through), then it fills.
      const w = CW.world({ realResolver: true, stamps: { "!p:hs": "unreadable" } });
      await w.CP.startChat(w.box); await CW.tick();
      w.raw("$u1", "!p:hs", 4000, "said at some time", "@b:hs");
      ok(w.sb.Room.chatTiers().activeTier === "presence" && CW.screen(w.box).length === 0,
        "I: A STAMP THAT CANNOT BE READ SHOWS NOTHING — Present is offered, and files nothing it cannot place", CW.screen(w.box));
      w.stamp("presence", 4500); w.member("presence", true);
      w.raw("$u2", "!p:hs", 4400, "said before the stamp", "@b:hs");
      w.raw("$u3", "!p:hs", 4600, "said after it", "@b:hs");
      ok(show(CW.screen(w.box)) === show(["m:$u3"]), "I: and once it can be read, Present fills from it", CW.screen(w.box));
    }
    {
      // AFTER A RELOAD, OUT OF PRESENT, THE BOT ADDS YOU BACK: nothing older than that moment appears, and nothing chimes.
      const rec = { chimes: 0 };
      const AC = class { constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createGain() { rec.chimes++; return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      const w = CW.world({ realResolver: true, presenceAtOpen: false, AudioContext: AC, stamps: { "!p:hs": 5000 } });
      await w.CP.startChat(w.box); await CW.tick();
      w.stamp("presence", 8000); w.member("presence", true);
      ok(w.sb.Room.chatTiers().activeTier === "presence", "I PREMISE — the bot added this account and the view went to Present", w.sb.Room.chatTiers().activeTier);
      w.raw("$prev", "!p:hs", 7000, "hey @me:hs — from before this page", "@b:hs");
      ok(CW.screen(w.box).length === 0 && rec.chimes === 0, "I: AFTER A RELOAD, WHEN THE BOT ADDS YOU BACK, NOTHING OLDER THAN THAT MOMENT " +
        "APPEARS IN PRESENT, AND NOTHING CHIMES", { screen: CW.screen(w.box), chimes: rec.chimes });
      w.raw("$new", "!p:hs", 8500, "said now", "@b:hs");
      ok(CW.screen(w.box).indexOf("m:$new") >= 0, "I CONTROL: and what is said from then on fills it", CW.screen(w.box));
    }
  });


  // ═══ PART J — EVERY CHAT: WHAT IT OPENED WITH AND WHAT IS SAID AFTER, NOTHING OLDER (the owner's correction, ddjp_650) ══
  // "All, Guest+ and Staff: nothing older than the oldest of their opening twenty, or than what they opened with when fewer
  // exist. A later arrival older than that (the read-back's decrypts, a late decrypt) is not shown, counted or chimed. What a
  // tab holds through a kick and re-add stays." DRIVEN on 649 through the real bridge's handlers, as PART I is for Present:
  // nothing in the read-back's door is Present's alone, and the panel anchored a chat at everything held (`ALL_HELD`) unless
  // MORE than twenty rows were drawn — so with twenty, the normal case, every older decrypt was drawn above them.
  await part("J", async () => {
    const rows = (w) => CW.screen(w.box).filter((x) => /^m:/.test(x));
    let delivered = [], opening = [];
    {
      // THE DOOR, FOR ALL: its history a message every other second, all inside the people list's window. The opening holds
      // its newest five; the screen's order then starts the chat's fetch and the people list's read-back.
      const r = await sdkRoom({ decrypts: true, held: {}, before: (x) => {
        x.hs.invite(x.main, IW.ME, { from: IW.OWNER });
        const S = [];
        for (let i = 0; i < 600; i++) S.push(mev("$a" + i, x.main, NOW - (600 - i) * 1000, "said " + i, i % 2 ? "m.room.message" : "m.room.member"));
        x.server[x.main] = S;
        const v = x.w.client.getRoom(x.main);
        if (v) v.timeline = S.slice(-5);
      } });
      const S = r.server[r.main];
      ok(r.w.Room.chatTiers().tiers.some((t) => t.id === r.main), "J PREMISE — the room opened on All", r.w.Room.chatTiers().tiers.map((t) => t.tier));
      ok(call(r.w.Room, "chatOpenedAt", r.main) === S[S.length - 1].getTs(), "J: THE ROOM RECORDS EVERY CHAT'S OPENING, not only Present's — " +
        "All's is the newest server stamp held there", { opened: call(r.w.Room, "chatOpenedAt", r.main), newest: S[S.length - 1].getTs() });
      ok(call(r.w.Room, "chatFloor", r.main) === null, "J: and All has no floor at the door — its floor is what it opens with", call(r.w.Room, "chatFloor", r.main));
      let phase = "fetching";
      const got = [];
      r.w.Chat.onMessage((id, sender, body, failed, ts, roomId) => { if (roomId === r.main) got.push({ id, ts, body, phase }); });
      const chat = r.w.Chat.backfillRecent(20, r.main, { window: 200 });
      r.w.Room.presenceView(NOW);
      const res = await chat; phase = "after";
      await r.w.settle(80);
      opening = res.messages.slice();
      const oldest = Math.min.apply(null, opening.map((x) => x.ts));
      delivered = got.filter((g) => g.phase === "after");
      ok(opening.length === 20, "J PREMISE — All's twenty landed, in the screen's order", opening.length);
      ok(delivered.length > 0 && delivered.every((g) => g.ts < oldest), "J PREMISE — THE DOOR IS OPEN FOR ALL TOO: after the twenty, the people " +
        "list's read-back went on paging All back and the SDK's decrypts of it reached the panel as live, every one older than the " +
        "oldest of the twenty", { delivered: delivered.length, older: delivered.filter((g) => g.ts < oldest).length });
      r.done();
    }
    {
      // THE PANEL, GIVEN EXACTLY WHAT THE REAL BRIDGE DELIVERED: All opens on those twenty, then the read-back's decrypts arrive.
      const hist = opening.map((x) => ({ id: x.id, sender: x.sender, body: x.body, ts: x.ts }));
      const w = CW.world({ history: { "!u:hs": hist } });
      await w.CP.startChat(w.box); await CW.tick();
      ok(rows(w).length === 20, "J PREMISE — the panel opens All on the same twenty", rows(w).length);
      for (const g of delivered) w.raw(g.id, "!u:hs", g.ts, g.body, "@a:hs");
      ok(rows(w).length === 20 && show(rows(w)) === show(hist.map((h) => "m:" + h.id)), "J: ALL SHOWS WHAT IT OPENED WITH — none of the " +
        delivered.length + " older messages the read-back's decrypts brought is drawn (on 649 every one was, above the twenty)", rows(w).length);
    }
    {
      // THE OWNER'S OWN DRIVE: twenty, a live one, three older than all twenty.
      const hist = []; for (let i = 0; i < 20; i++) hist.push({ id: "$t" + i, sender: "@b:hs", body: "twenty " + i, ts: 1000 + i });
      const rec = { chimes: 0 };
      const AC = class { constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createGain() { rec.chimes++; return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      const w = CW.world({ history: { "!u:hs": hist }, AudioContext: AC });
      await w.CP.startChat(w.box); await CW.tick();
      ok(rows(w).length === 20, "J PREMISE — All opens on twenty rows", rows(w).length);
      w.raw("$live", "!u:hs", 5000, "said now", "@b:hs");
      ok(rows(w).length === 21, "J CONTROL — one live message adds a row", rows(w).length);
      for (const [id, ts] of [["$o1", 100], ["$o2", 200], ["$o3", 300]]) w.raw(id, "!u:hs", ts, "older than all twenty", "@b:hs");
      ok(rows(w).length === 21, "J: THREE MESSAGES OLDER THAN ALL TWENTY ARE NOT SHOWN — 21 rows (on 649: 24)", rows(w).length);
      pick(w, "Staff");
      w.raw("$o4", "!u:hs", 400, "hey @me:hs, older than all twenty", "@b:hs");
      ok(w.sb.ChatPrefs.tierUnread("uncategorized") === false && w.sb.ChatPrefs.tierMentioned("uncategorized") === false && rec.chimes === 0,
        "J: nor counted or chimed — read from Staff, an older mention lights no dot on All and plays nothing", { unread: w.sb.ChatPrefs.tierUnread("uncategorized"), chimes: rec.chimes });
    }
    {
      // FEWER THAN TWENTY: the oldest of what it opened with is the line — a late decrypt inside it is not older, and shows.
      const hist = []; for (let i = 0; i < 7; i++) hist.push({ id: "$f" + i, sender: "@b:hs", body: "few " + i, ts: 1000 + i * 10 });
      const w = CW.world({ history: { "!u:hs": hist } });
      await w.CP.startChat(w.box); await CW.tick();
      ok(rows(w).length === 7, "J PREMISE — a chat holding seven opens on seven", rows(w).length);
      w.raw("$f-old", "!u:hs", 900, "older than the seven", "@b:hs");
      w.raw("$f-in", "!u:hs", 1015, "decrypted late, inside the seven's span", "@b:hs");
      ok(rows(w).indexOf("m:$f-old") < 0 && rows(w).indexOf("m:$f-in") >= 0 && rows(w).length === 8,
        "J: WITH FEWER THAN TWENTY, nothing older than the oldest it opened with — and a late decrypt inside its span is not older, " +
        "and shows", rows(w));
    }
    {
      // AN UNREADABLE RECORD HELD AT THE OPENING IS NOT WHAT IT OPENED WITH: one the decrypt flood left undecryptable while the
      // fetch ran, older than the twenty, decrypted later — a late decrypt older than the twenty — is not drawn.
      const hist = []; for (let i = 0; i < 20; i++) hist.push({ id: "$d" + i, sender: "@b:hs", body: "d " + i, ts: 3000 + i });
      const w = CW.world({ history: { "!u:hs": hist }, holdFetch: true });
      const started = w.CP.startChat(w.box); await CW.tick();
      w.raw("$d-bad", "!u:hs", 2500, "** unable to decrypt **", "@b:hs", true);
      w.releaseFetches(); await started; await CW.tick();
      ok(rows(w).length === 20, "J PREMISE — All opens on its twenty, an undecryptable older record held beside them", rows(w).length);
      w.raw("$d-bad", "!u:hs", 2500, "decrypted at last", "@b:hs");
      ok(rows(w).length === 20 && rows(w).indexOf("m:$d-bad") < 0, "J: A LATE DECRYPT OLDER THAN THE TWENTY IS NOT DRAWN — the unreadable " +
        "record it was is not what the chat opened with", rows(w).length);
    }
    {
      // NOTHING TO OPEN WITH: the chat is shown from its opening's server stamp (`Room.chatOpenedAt`).
      const w = CW.world({ realResolver: true, stamps: { "!u:hs": 5000 } });
      await w.CP.startChat(w.box); await CW.tick();
      pick(w, "All");
      ok(w.sb.Room.chatTiers().activeTier === "uncategorized" && rows(w).length === 0, "J PREMISE — All opened with nothing to show", rows(w));
      w.raw("$e-old", "!u:hs", 4000, "older than the opening", "@b:hs");
      w.raw("$e-at", "!u:hs", 5000, "the opening's own newest", "@b:hs");
      w.raw("$e-new", "!u:hs", 6000, "said after", "@b:hs");
      ok(show(rows(w)) === show(["m:$e-new"]), "J: OPENED WITH NOTHING, it shows only what is said after its opening's server stamp", rows(w));
    }
    {
      // TWO TABS, TWO READ-BACKS: what a person sees no longer depends on how far their own read-back reached.
      const hist = []; for (let i = 0; i < 20; i++) hist.push({ id: "$x" + i, sender: "@b:hs", body: "x " + i, ts: 10000 + i });
      const a = CW.world({ history: { "!u:hs": hist } }), b = CW.world({ history: { "!u:hs": hist } });
      await a.CP.startChat(a.box); await b.CP.startChat(b.box); await CW.tick();
      for (let i = 0; i < 3; i++) a.raw("$y" + i, "!u:hs", 9000 + i, "older", "@b:hs");
      for (let i = 0; i < 50; i++) b.raw("$y" + i, "!u:hs", 9000 + i, "older", "@b:hs");
      a.raw("$z", "!u:hs", 20000, "said after", "@b:hs"); b.raw("$z", "!u:hs", 20000, "said after", "@b:hs");
      ok(show(rows(a)) === show(rows(b)) && rows(a).length === 21, "J: TWO TABS WHOSE READ-BACKS BROUGHT 3 AND 50 OLDER MESSAGES SHOW THE SAME " +
        "rows — the twenty and what was said after", { a: rows(a).length, b: rows(b).length });
    }
    {
      // THROUGH A KICK AND A RE-ADD what a tab holds stays, and an older arrival after it is still not drawn.
      const hist = []; for (let i = 0; i < 20; i++) hist.push({ id: "$s" + i, sender: "@b:hs", body: "staff " + i, ts: 2000 + i });
      const w = CW.world({ realResolver: true, history: { "!s:hs": hist } });
      await w.CP.startChat(w.box); await CW.tick();
      pick(w, "Staff");
      const before = show(rows(w));
      ok(rows(w).length === 20, "J PREMISE — Staff opens on its twenty", rows(w).length);
      w.member("staff", false); w.member("staff", true); await CW.tick();
      pick(w, "Staff");
      ok(show(rows(w)) === before, "J PREMISE — kicked and added back, Staff holds what it held", rows(w).length);
      w.raw("$s-old", "!s:hs", 1500, "older, brought by the re-add's first sync", "@b:hs");
      ok(show(rows(w)) === before, "J: and an older message arriving after the re-add is not drawn either", rows(w));
    }
  });

  // ═══ PART K — EXACTLY ITS LAST TWENTY, IN ORDER, WHILE THE PEOPLE LIST PAGES IT (the owner's correction, ddjp_665) ════════
  // The owner: "for all chats except present, we try to pull up last 20 messages / we place them, dont make mistakes in
  // order, and rpesent takes over under it. / in present we start now and dont even try to see before." DRIVEN on 664
  // through the real bridge and the real panel at once, over the SDK's timeline as it is (`sdkTimeline`): the window read
  // walked `room.timeline` by index while awaiting decryptions, a page landing meanwhile shifted every index (15 of the
  // twenty were older messages, past a gap); a ridden fetch that FAILED ended the read with no request of its own (0 rows);
  // and the panel's line was taken over everything held — so a window of 7 drew 20 (13 older), and a message said while the
  // chat opened pushed out the oldest of the twenty. Every row says what it stands on and refuses itself when that is gone:
  // each premise is a GATE, driven both ways first (a run that must pass it, and one that must not).
  await part("K", async () => {
    const eq = (a, b) => show(a) === show(b);
    // THE REAL BRIDGE, in its own sandbox over the model, its own handlers on (`start()` stops past them: no crypto here).
    const bridge = async (M) => {
      const RB = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"], {
        Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval, window: {}, document: { body: { appendChild() {} } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
      for (const k of ["info", "warn", "debug", "error"]) RB.Logger[k] = () => {};
      RB.MatrixBridge._setClientForTest(M.client);
      RB.MatrixBridge.setRoomScope({ chat_uncategorized: "!u:hs", chat_staff: "!s:hs", presence_chat: "!p:hs" });
      try { await RB.MatrixBridge.start(); } catch (e) { /* it stops past its handlers */ }
      return RB.MatrixBridge;
    };
    // ONE OPENING. The panel starts (every readable chat's fetch, as `enterMainScreen` starts it) and then, in the screen's
    // order, the people list reads the same chat back (`Room.presenceView` asks `readBackActivity`, which pages through the
    // one shared step). The panel's fetch IS the real bridge's — the world's double is replaced — and the bridge's own live
    // fan-out (`_routeEvent`, reached from its `Event.decrypted` and `Room.timeline` handlers) reaches the panel's door with
    // the fields `features/chat.js` `_handleRaw` reads: type, room, id, sender, body, stamp, the event's decryption failure.
    const open = async (o) => {
      const M = sdkTimeline(o);
      const S = o.history, id = o.present ? "!p:hs" : "!u:hs";
      M.room("!u:hs", "chat-uncategorized", o.present ? [] : S, o.present ? 0 : o.held, o.pending);
      M.room("!s:hs", "chat-staff", [], 0);
      if (o.present) M.room("!p:hs", "presence-chat", S, o.held, o.pending);
      const want = o.present ? ["$after"] : kTwenty(S).concat(o.live ? ["$live"] : []);   // from the server's history alone
      const oldest = Math.min.apply(null, S.filter((s) => want.indexOf(s.id) >= 0).map((s) => s.ts));
      const RB = await bridge(M);
      const w = o.present ? CW.world({ realResolver: true, stamps: { "!p:hs": RB.newestStampIn("!p:hs") } }) : CW.world({});
      let phase = "fetching";
      const returned = [], arrived = [];
      w.sb.MatrixBridge.recentChatMessages = (rid, c, op) => RB.recentChatMessages(rid, c, op).then((r) => {
        if (rid === id) { phase = "after"; for (const m of r.messages) returned.push(m.event_id); }
        return r;
      });
      RB.onRawEvent((raw, ev) => {
        if (raw.type !== "m.room.message") return;
        const failed = !!(ev && ev.isDecryptionFailure && ev.isDecryptionFailure());
        if (raw.room_id === id && phase === "fetching") arrived.push({ id: raw.event_id, ts: raw.ts, failed });
        w.raw(raw.event_id, raw.room_id, raw.ts, raw.content && raw.content.body, raw.sender, failed);
      });
      const started = w.CP.startChat(w.box);
      if (o.live === "during") M.live(id, { id: "$live", ts: NOW + 5000, kind: "msg", enc: true });
      const back = o.peopleList === false ? null : RB.readBackActivity(id, NOW - 10 * 3600 * 1000);
      await started; if (back) await back;
      for (let i = 0; i < 200; i++) await CW.tick();
      if (o.live === "after") { M.live(id, { id: "$live", ts: NOW + 5000, kind: "msg", enc: true }); for (let i = 0; i < 40; i++) await CW.tick(); }
      if (o.present) { M.live(id, { id: "$after", ts: NOW + 9000, kind: "msg", enc: true }); for (let i = 0; i < 40; i++) await CW.tick(); }
      const rows = CW.screen(w.box).filter((x) => /^m:/.test(x)).map((x) => x.slice(2));
      return { rows, want, M, arrived, returned, olderArrived: arrived.filter((a) => !a.failed && a.ts < oldest).length,
        asked: M.requests.filter((q) => q.room === id).map((q) => q.limit + "@" + q.held + (q.failed ? "!" : "")),
        active: w.sb.Room.chatTiers().activeTier };
    };
    // THE INSTRUMENT FIRST: the model's timeline is the SDK's, which the old double was not.
    {
      const M = sdkTimeline({});
      const r = M.room("!m:hs", "chat-uncategorized", kHistory("$m", 50, 2, 0), 5);
      const arr = r.timeline, first = arr[0];
      const p = M.client.scrollback(r, 10), again = M.client.scrollback(r, 10);
      await p;
      ok(p === again && r.timeline === arr && arr.length === 15 && arr[10] === first && arr[0].getId() === "$m0035",
        "K INSTRUMENT — THE MODEL'S TIMELINE IS THE SDK'S: one array for the room's life, a page spliced into it at its FRONT, a second " +
        "request while one is out handed the same promise (the double PARTS H–J use builds a new array per page)", { len: arr.length, same: r.timeline === arr });
      ok(arr[0].getType() === "m.room.encrypted" && arr[0].isBeingDecrypted() && arr[10].getType() === "m.room.message",
        "K INSTRUMENT — a page's messages arrive still DECRYPTING (no body, `m.room.encrypted`); held ones are read", [arr[0].getType(), arr[10].getType()]);
      await M.client.decryptEventIfNeeded(arr[0]);
      ok(arr[0].getType() === "m.room.message" && /said \$m0035/.test(arr[0].getContent().body), "K INSTRUMENT — and `decryptEventIfNeeded` hands back that decryption", arr[0].getContent());
    }
    // THE SCENES, and each row's GATE — what the row stands on — driven both ways before any row reads it.
    const S1 = () => kHistory("$e", 600, 7, 4);     // a sparse chat: a message every 7th event, one in four undecryptable
    const K1 = { history: S1(), held: 150, pending: { newest: 1 }, heldTicks: 20 };   // a tab holding 150, the newest still decrypting
    const K1b = { history: S1(), held: 5 };                                            // a tab holding 5 (PART H's shape)
    const K2 = { history: S1(), held: 5, failNext: 1 };                                // the people list's request fails
    const K3 = { history: kThin("$c"), held: 5 };                                      // 7 readable in the newest 200 events
    const K3b = { history: kThin("$d"), held: 300, pending: { all: true }, heldTicks: 20, peopleList: false };   // no page at all
    const K4 = { history: kHistory("$f", 400, 2, 0), held: 300, pending: { newest: 25 }, heldTicks: 30, peopleList: false, live: "during" };
    const K5 = { present: true, history: kHistory("$p", 300, 2, 0), held: 5 };
    const gate = {
      K1: (r) => r.M.stats.splicesWhileAwaiting > 0,                                    // a page landed while the read awaited a decryption
      K2: (r) => r.M.requests.length > 0 && r.M.requests[0].failed && r.M.requests[0].limit === 100,   // the people list's, failed, ridden
      K3: (r) => r.olderArrived > 0,                                                     // older readable reached the panel mid-fetch
      K3b: (r) => r.M.stats.splices === 0 && r.olderArrived > 0,                         // ...with no page landing
      K4: (r) => r.arrived.some((a) => a.id === "$live") && r.returned.indexOf("$live") < 0,   // said while it opened, not in the read
      K5: (r) => r.arrived.some((a) => !a.failed && a.id !== "$after"),                  // Present's history reached its door
    };
    const r1 = await open(K1), r1n = await open(Object.assign({}, K1, { history: S1(), instant: true }));
    const r2 = await open(K2), r2n = await open(Object.assign({}, K2, { history: S1(), failNext: 0 }));
    const r3 = await open(K3), r3n = await open({ history: kThin("$c"), held: 300, peopleList: false });
    const r3b = await open(K3b), r3bn = await open(Object.assign({}, K3b, { history: kThin("$d"), pending: null }));
    const r4 = await open(K4), r4n = await open(Object.assign({}, K4, { history: kHistory("$f", 400, 2, 0), live: "after" }));
    const r5 = await open(K5), r5n = await open(Object.assign({}, K5, { history: kHistory("$p", 300, 2, 0), peopleList: false }));
    for (const [k, pos, neg, why] of [["K1", r1, r1n, "decryptions finishing on the spot"], ["K2", r2, r2n, "no request failing"],
      ["K3", r3, r3n, "a tab holding the window, nothing paging"], ["K3b", r3b, r3bn, "nothing still decrypting"],
      ["K4", r4, r4n, "the message said after the chat opened"], ["K5", r5, r5n, "no read-back"]]) {
      ok(gate[k](pos) === true && gate[k](neg) === false, "K GATE " + k + " — DRIVEN BOTH WAYS: it admits the row's run and refuses one with " + why,
        { admits: gate[k](pos), refuses: !gate[k](neg) });
    }
    {
      // THE CONTROL: nothing pages, nothing is still decrypting — the twenty, and nothing asked (664 got this right too).
      const c = await open({ history: kHistory("$g", 600, 7, 4), held: 300, peopleList: false });
      ok(eq(c.rows, c.want) && c.rows.length === 20 && c.asked.length === 0, "K CONTROL — a tab holding the window, nothing else paging: " +
        "the panel shows the last twenty of the newest 200 events, through the real bridge, asking nothing", { rows: c.rows.length, asked: c.asked });
    }
    ok(gate.K1(r1), "K1 PREMISE — a page was spliced into the chat's timeline while the window read awaited a decryption", r1.M.stats);
    ok(gate.K1(r1) && eq(r1.rows, r1.want), "K1: A TAB HOLDING 150 EVENTS, THE NEWEST STILL DECRYPTING, WHILE THE PEOPLE LIST PAGES THE SAME CHAT — " +
      "the chat opens on exactly its last twenty, in order, no gap (664: 15 of the twenty were older messages past a gap)",
      { rows: r1.rows.length, extra: r1.rows.filter((x) => r1.want.indexOf(x) < 0).length, missing: r1.want.filter((x) => r1.rows.indexOf(x) < 0).length });
    const r1b = await open(K1b);
    ok(gate.K1(r1b) && eq(r1b.rows, r1b.want), "K1: and a tab holding five, in the screen's order — the same exact twenty",
      { rows: r1b.rows.length, same: eq(r1b.rows, r1b.want) });
    ok(gate.K2(r2), "K2 PREMISE — the people list's request failed while the chat's read was riding it", r2.asked);
    ok(gate.K2(r2) && eq(r2.rows, r2.want), "K2: A RIDDEN FETCH THAT FAILED IS NOT THE CHAT'S START — the chat still opens on its twenty " +
      "(664: it opened with none)", { rows: r2.rows.length, asked: r2.asked });
    ok(gate.K2(r2) && eq(r2.asked, ["100@5!", "195@5"]), "K2: by ONE request of its own, after the failure — what was missing of the window",
      r2.asked);
    ok(gate.K3(r3), "K3 PREMISE — readable messages older than the window's reached the panel while the chat's fetch was out", r3.olderArrived);
    ok(gate.K3(r3) && eq(r3.rows, r3.want) && r3.rows.length === 7, "K3: A WINDOW HOLDING SEVEN READABLE, WHILE THE PEOPLE LIST PAGES FAR " +
      "BACK — the chat opens on those seven and nothing older (664: twenty, thirteen of them older)", { rows: r3.rows.length });
    ok(gate.K3b(r3b), "K3b PREMISE — no page landed, and older readable messages still reached the panel mid-fetch (late decryptions)", { splices: r3b.M.stats.splices, older: r3b.olderArrived });
    ok(gate.K3b(r3b) && eq(r3b.rows, r3b.want), "K3b: WITH NO PAGE AT ALL — the panel's line alone: seven, nothing older (664: twenty)",
      { rows: r3b.rows.length });
    ok(gate.K4(r4), "K4 PREMISE — a message said while the chat opened reached the panel before its fetch returned, and was not among what the read returned", r4.arrived.length);
    ok(gate.K4(r4) && eq(r4.rows, r4.want), "K4: A MESSAGE SAID WHILE THE CHAT OPENS GOES UNDER THE TWENTY — the twenty, then it (664: it pushed " +
      "out the oldest of the twenty)", { rows: r4.rows.length, first: r4.rows[0], wantFirst: r4.want[0] });
    ok(eq(r4n.rows, r4n.want), "K4 CONTROL: said after the chat opened, it goes under the twenty too", r4n.rows.length);
    ok(gate.K5(r5), "K5 PREMISE — the people list's read-back brought Present's history to the panel's door", r5.arrived.length);
    ok(gate.K5(r5) && r5.active === "presence" && eq(r5.rows, ["$after"]), "K5: PRESENT STILL OPENS WITH NOTHING FROM BEFORE, while the people " +
      "list pages it — and what is said after shows", { active: r5.active, rows: r5.rows });
  });
  // ═══ PART L — THE BUTTON AND MENU ARE REDRAWN ONLY WHEN WHAT THEY SHOW CHANGES (`ddjp_670`) ══════════════════════════════
  // Found at the milestone review after `ddjp_659` (J128's entry): `_renderChatPicker` emptied the holder and built the button
  // and the menu again for every live message — in a busy room a click could land on a button already gone, and keyboard focus
  // on the button or "Go to Present" dropped to the page. J130's rule, the lists' way: a record of what they drew, compared
  // before rebuilding. A node never taken out keeps a focus and takes a click, so each row reads the node itself — the same
  // object, still in the holder; Chromium's own focus is read with the page's head and markup (the report).
  await part("L", async () => {
    const w = CW.world({ realResolver: true, presenceAtOpen: false });
    await w.CP.startChat(w.box); await CW.tick();
    const host = w.refs.chatPick;
    const inHost = (n) => { for (let p = n; p; p = p.parent) if (p === host) return true; return false; };
    const touched = (tier) => { const r = (w.sb.ChatPrefs.tierList() || []).find((x) => x.tier === tier); return r ? r.lastTs : 0; };
    ok(w.sb.Room.chatTiers().activeTier === "uncategorized" && !!pickBtn(w), "L PREMISE — the room opened on All, the chat button drawn",
      { active: w.sb.Room.chatTiers().activeTier });
    // A LIVE MESSAGE IN THE CHAT ON SCREEN, the reader at its bottom: read as it arrives, so nothing the button shows changes.
    const b0 = pickBtn(w), cls0 = cls(b0);
    for (let i = 0; i < 5; i++) w.raw("$l" + i, "!u:hs", 9000 + i, "busy room " + i);
    ok(touched("uncategorized") === 9004 && CW.screen(w.box).indexOf("m:$l4") >= 0,
      "L PREMISE — five live messages reached the panel as live (the tier touched at the last one's stamp, which is what asks the button to draw)", touched("uncategorized"));
    ok(pickBtn(w) === b0 && inHost(b0) && cls(b0) === cls0,
      "L: A LIVE MESSAGE KEEPS THE SAME BUTTON — not rebuilt, so a focus on it survives and a click lands", { same: pickBtn(w) === b0, cls: cls(pickBtn(w)) });
    // THE MENU OPEN, a person's keyboard in it.
    const m0 = CW.chatMenu(w);
    const items0 = m0 ? m0.children.filter((c) => c.dataset && c.dataset.tier) : [];
    const go0 = m0 ? m0.children.find((c) => /\bchat-pick-go\b/.test(cls(c))) : null;
    const goBox0 = go0 ? go0.children.find((c) => c.tag === "input") : null;
    ok(!!m0 && items0.length === 2 && !!goBox0, "L PREMISE — the menu is open: All, Staff and \"Go to Present\"", m0 && m0.children.map(cls));
    const btnOpen = pickBtn(w);
    for (let i = 5; i < 10; i++) w.raw("$l" + i, "!u:hs", 9000 + i, "busy room " + i);
    const m1 = host.children.find((c) => /\bchat-pick-menu\b/.test(cls(c))) || null;
    ok(touched("uncategorized") === 9009 && host._open === true, "L PREMISE — five more live messages, the menu still open", touched("uncategorized"));
    ok(m1 === m0 && pickBtn(w) === btnOpen && items0.every((it) => inHost(it)) && inHost(goBox0),
      "L: WITH THE MENU OPEN, A LIVE MESSAGE KEEPS IT — the same menu, the same items and \"Go to Present\": a focus on any of them survives",
      { menu: m1 === m0, button: pickBtn(w) === btnOpen, items: items0.map(inHost), go: inHost(goBox0) });
    // "Go to Present" unticked by the person: the box shows its own tick, and the next message rebuilds nothing.
    if (goBox0) { goBox0.checked = false; goBox0.onchange(); }
    w.raw("$l10", "!u:hs", 9010, "after the tick");
    ok(w.sb.ChatPrefs.goToPresent() === false && inHost(goBox0) && goBox0.checked === false &&
       (host.children.find((c) => /\bchat-pick-menu\b/.test(cls(c))) || null) === m0,
      "L: AND UNTICKING \"Go to Present\" IS NOT UNDONE OR REBUILT BY THE NEXT MESSAGE — the same box, unticked, remembered",
      { stored: w.sb.ChatPrefs.goToPresent(), kept: inHost(goBox0), checked: goBox0 && goBox0.checked });
    if (goBox0) { goBox0.checked = true; goBox0.onchange(); }
    // CONTROLS: what they show changes, and they ARE redrawn. A message in ANOTHER chat puts its dot on the item, open...
    w.raw("$st1", "!s:hs", 9100, "in staff");
    const m2 = host.children.find((c) => /\bchat-pick-menu\b/.test(cls(c))) || null;
    const staff2 = m2 ? m2.children.find((c) => c.dataset && c.dataset.tier === "staff") : null;
    ok(staff2 && /\bunread\b/.test(cls(staff2)) && /\bunread\b/.test(cls(pickBtn(w))),
      "L CONTROL: A MESSAGE IN ANOTHER CHAT STILL SHOWS AT ONCE — the button's dot and Staff's, open: what they show changed, so they are redrawn",
      { item: cls(staff2), btn: cls(pickBtn(w)) });
    // ...and, closed, the button gains the dot of a mention, purple over orange.
    call(w.CP, "_closeChatPicker");
    const b3 = pickBtn(w);
    w.raw("$st2", "!s:hs", 9101, "hey @me:hs");
    ok(/\bmentioned\b/.test(cls(pickBtn(w))) && pickBtn(w) !== b3, "L CONTROL: and a mention there turns the closed button's dot purple — a new drawing", cls(pickBtn(w)));
    // ...and the lock's red outline is drawn when the chat changes under text.
    w.refs.chatInput.value = "unsent";
    w.member("staff", false); w.member("staff", true);
    pick(w, "Staff");
    w.member("staff", false);
    ok(/\blocked\b/.test(cls(pickBtn(w))), "L CONTROL: and the typing lock's outline is drawn as it starts", cls(pickBtn(w)));
    // ...and the view moving alone — the menu closed, the box empty, no dot, no lock: Go to Present — re-letters the button.
    const v = CW.world({ realResolver: true, presenceAtOpen: false });
    await v.CP.startChat(v.box); await CW.tick();
    const vb = pickBtn(v);
    ok(vb && vb._text === "A" && !v.refs.chatPick._open, "L PREMISE — All on screen, the menu closed, the box empty", vb && vb._text);
    v.member("presence", true);
    ok(v.sb.Room.chatTiers().activeTier === "presence" && pickBtn(v) && pickBtn(v)._text === "P" && /Present/.test(pickBtn(v).getAttribute("title") || ""),
      "L CONTROL: THE VIEW MOVING ALONE (Go to Present, nothing else changed) RE-LETTERS THE BUTTON AT ONCE — \"P\", its name in the title",
      { active: v.sb.Room.chatTiers().activeTier, letter: pickBtn(v) && pickBtn(v)._text, title: pickBtn(v) && pickBtn(v).getAttribute("title") });
  });

  // ═══ PART M — NO SEND TARGET WHEN THE LAST READABLE CHAT GOES (`ddjp_670`) ═══════════════════════════════════════════════
  // Found at the milestone review after `ddjp_659` (J128's entry): `Room.applyChatTiers` re-pointed Chat only when there was a
  // chat to point at, so when the last chat this account could read went, the send target stayed the room just left, and the
  // typing lock covered it only with text in the box. The owner's (W1, W2 — `main/04-features.md` §Per-tier chat views): no
  // send target; the box cannot be typed into and sends nothing, and it says nothing new; a chat back works again. Driven
  // through the real resolver, the REAL `Chat.send` (the transport records what reaches it) and the real `sendChat`.
  await part("M", async () => {
    const shell = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
    const a = shell.indexOf("    const sendChat = async () => {"), b = shell.indexOf("\n    };", a);
    const keyLine = (shell.match(/\n    refs\.chatInput\.onkeydown = [^\n]+\n/) || [""])[0];
    ok(a >= 0 && b > a && !!keyLine, "M PREMISE — the real `sendChat` and the box's Enter were found in ui/shell.js");
    const wire = (w) => {
      const ctx = { refs: w.refs, console, ChatPanels: w.CP, _showCryptoBanner: () => {},
        Chat: { cryptoReady: () => true, send: (v) => w.sb.Chat.send(v), charCount: (s) => s.length, MAX_CHARS: 512 } };
      vm.createContext(ctx);
      vm.runInContext(shell.slice(a, b + 7) + keyLine + "\nglobalThis.__send = sendChat;\n", ctx);
      w.refs.chatSend.onclick = ctx.__send;
      return { enter: async () => { await w.refs.chatInput.onkeydown({ key: "Enter" }); await CW.tick(); }, click: async () => { await w.refs.chatSend.onclick(); await CW.tick(); } };
    };
    const note = (w) => (w.refs.chatNote.classList.contains("show") ? w.refs.chatNote.textContent : "");
    {
      const w = CW.world({ realResolver: true, presenceAtOpen: false });
      await w.CP.startChat(w.box); await CW.tick();
      const s = wire(w);
      w.refs.chatInput.value = "to all"; await s.enter();
      ok(w.sent.length === 1 && w.sent[0].roomId === "!u:hs" && w.refs.chatInput.disabled !== true,
        "M PREMISE — with All readable, the box is typeable and Enter sends to All", w.sent);
      const hint0 = w.refs.chatInput.placeholder;
      w.member("staff", false); w.member("uncategorized", false);
      const r = w.sb.Room.chatTiers();
      ok(r.tiers.length === 0 && r.activeId === null && w.sb.Chat.readableTiers().length === 0,
        "M PREMISE — the last chat this account could read went: none offered, none received from", { tiers: r.tiers, readable: w.sb.Chat.readableTiers() });
      const n0 = w.sent.length;
      const direct = await w.sb.Chat.send("straight to the transport");
      ok(direct && direct.ok === false && direct.reason === "no-room" && w.sent.length === n0,
        "M: THERE IS NO SEND TARGET — Chat sends nothing, to the room just left or anywhere (\"no-room\")", { direct, sent: w.sent.slice(n0) });
      ok(w.refs.chatInput.disabled === true && w.refs.chatSend.disabled === true,
        "M: THE SEND BOX CANNOT BE TYPED INTO, and Send is greyed", { box: w.refs.chatInput.disabled, send: w.refs.chatSend.disabled });
      w.refs.chatInput.value = "typed anyway";
      await s.enter(); await s.click();
      ok(w.sent.length === n0 && w.refs.chatInput.value === "typed anyway", "M: ENTER AND SEND SEND NOTHING — re-checked at the send itself", w.sent.slice(n0));
      ok(note(w) === "" && w.refs.chatInput.placeholder === hint0.replace(/^Message .*…$/, "Message…"),
        "M: AND IT SAYS NOTHING NEW — no note on the strip, the hint the plain \"Message…\" it reads with no chat (the owner: W1, W2)",
        { note: note(w), hint: w.refs.chatInput.placeholder });
      // A CHAT BACK: the box works again, aimed at it.
      w.refs.chatInput.value = "";
      w.member("uncategorized", true);
      ok(w.sb.Room.chatTiers().activeId === "!u:hs" && w.refs.chatInput.disabled === false && w.refs.chatSend.disabled === false,
        "M: A READABLE CHAT BACK, THE BOX WORKS AGAIN — typeable, Send live", { active: w.sb.Room.chatTiers().activeId, box: w.refs.chatInput.disabled, send: w.refs.chatSend.disabled });
      w.refs.chatInput.value = "back again"; await s.enter();
      ok(w.sent.length === n0 + 1 && w.sent[n0].roomId === "!u:hs", "M: AND ENTER SENDS TO IT", w.sent.slice(n0));
    }
    {
      // TEXT IN THE BOX WHEN THE LAST CHAT GOES: it stays, nothing is sent, and the typing lock (J128) still holds it once a chat is back.
      const w = CW.world({ realResolver: true, presenceAtOpen: false });
      await w.CP.startChat(w.box); await CW.tick();
      const s = wire(w);
      w.member("staff", false);
      w.refs.chatInput.value = "half written";
      w.member("uncategorized", false);
      await s.enter(); await s.click();
      ok(w.sent.length === 0 && w.refs.chatInput.value === "half written" && w.refs.chatInput.disabled === true,
        "M: WITH TEXT IN THE BOX, THE TEXT STAYS AND NOTHING IS SENT — the box not typeable", { sent: w.sent, box: w.refs.chatInput.disabled });
      w.member("uncategorized", true);
      ok(w.refs.chatInput.disabled === false && w.CP.chatLocked() === true && w.refs.chatSend.disabled === true,
        "M: and a chat back makes it typeable, the typing lock holding the text until a chat is picked (J128's rule, unchanged)",
        { box: w.refs.chatInput.disabled, locked: w.CP.chatLocked(), send: w.refs.chatSend.disabled });
    }
    {
      // THE OPENING'S "NO CHAT YET" IS NOT THIS — the box stays typeable and Enter says the chat is still connecting (`ddjp_621`).
      // Nothing is sent: with no chat readable there is no target, even the channel Chat was first pointed at (669 sent there,
      // a chat this account does not read).
      // The world's room was offered its chats as it was built, so this opens ANOTHER room — the same channels, none joined —
      // as a room is opened: the room's record of what it offered starts with the room.
      const w = CW.world({ realResolver: true, presenceAtOpen: false });
      for (const id of ["!u:hs", "!s:hs"]) w.real.joined[id] = false;
      w.sb.Room._setCurrentForTest({ name: "w2", spaceId: "!space-b:hs", channels: w.real.channels });
      w.sb.Room.applyChatTiers();
      await w.CP.startChat(w.box); await CW.tick();
      const s = wire(w);
      ok(w.sb.Room.chatTiers().activeId === null && !w.sb.Room.chatTiers().chatGone,
        "M PREMISE — no chat yet: the room opened before any chat was joined, and it has offered none", w.sb.Room.chatTiers());
      w.refs.chatInput.value = "typed while it connects"; await s.enter();
      ok(w.refs.chatInput.disabled !== true && w.sent.length === 0 && /still connecting/.test(note(w)) && w.refs.chatInput.value === "typed while it connects",
        "M: AT THE OPENING WITH NO CHAT YET, the box stays typeable, nothing is sent, and Enter says the chat is still connecting",
        { box: w.refs.chatInput.disabled, sent: w.sent, note: note(w) });
    }
    {
      // ── A DISABLED SEND IS GREY (`ddjp_671`; the owner, S1: "make send turn grey yes") ─────────────────────────────────────
      // Measured on 670 in Chromium: Send drew rgb(88,101,242) on white, opacity 1, enabled or disabled — no rule covered
      // `:disabled`. Here: the main screen as the app builds it (`tests/_screen-world.js`, the eleven ui/ files whole), the room's
      // resolution a scripted answer the guard moves, and the REAL `ChatPanels.startChat` / `syncChatTier` setting Send's state
      // (`_applySendState`) — so the button read is the one the app disables, and the look is what the page's own stylesheet
      // declares for it. Skip's disabled look is read the same way, off the real Skip button.
      const S = require("./_screen-world.js");
      const ROW = { tiers: [{ tier: "uncategorized", id: "!u:hs", main: true }, { tier: "staff", id: "!s:hs", main: false }],
        activeTier: "uncategorized", activeId: "!u:hs", mainTier: "uncategorized", mainId: "!u:hs", chatGone: false };
      let cur = ROW;
      const sw = S.world({ features: {
        Room: { chatTiers: () => cur, applyChatTiers: () => cur, recentEvents: () => ({ rows: [], newestTs: 0 }), getMyId: () => "@me:hs", rankLadder: () => [] },
        Actions: { describe: () => ({ enabled: false, reason: "Not permitted" }) },
        ChatPrefs: { layout: () => "wide", setLayout: () => {}, chatTier: () => null },
        Chat: { readableTiers: () => cur.tiers.map((t) => t.id), conversations: () => [], dmUnreadCount: () => 0 } } });
      sw.H.buildMainDom(sw.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
      await sw.sb.ChatPanels.startChat(sw.refs.chatBox);
      const send = sw.refs.chatSend, box = sw.refs.chatInput, skip = sw.refs.skipBtn;
      const LOOK = ["background", "color", "cursor"];
      const look = (n) => LOOK.map((p) => { const d = n ? sw.cas.declared(n, p) : null; return d ? d.val : null; });
      const TINT = "rgba(12,12,16,0.45)";
      const tint = () => { const d = box ? sw.cas.declared(box, "background") : null; return d ? d.val : null; };
      ok(send && send.textContent === "Send" && send.parent && /\bchat-input-row\b/.test(send.parent.className) && send.disabled === false && skip,
        "M PREMISE — Send as the shell builds it, in its row, enabled; the Skip button drawn", send && { text: send.textContent, row: send.parent && send.parent.className });
      const enabled = look(send);
      ok(JSON.stringify(enabled) === JSON.stringify(["#5865F2", "#fff", "pointer"]) && tint() === TINT,
        "M: ENABLED, SEND IS AS IT WAS — blue, white, a pointer — and the box in the chat's tint", { send: enabled, box: tint() });
      skip.disabled = true;
      const skipOff = look(skip);
      skip.disabled = false;
      ok(JSON.stringify(skipOff) === JSON.stringify(["#333", "#666", "default"]),
        "M PREMISE — the Skip button disabled is #333, its text #666, the default cursor (`.skip-btn:disabled`)", skipOff);
      cur = { tiers: [], activeTier: null, activeId: null, mainTier: "uncategorized", mainId: null, chatGone: true };
      sw.sb.ChatPanels.syncChatTier();
      const noChat = look(send);
      ok(send.disabled === true && JSON.stringify(noChat) === JSON.stringify(skipOff),
        "M: WITH NO CHAT TO SEND TO, SEND IS GREY — the Skip button's disabled look: #333, #666, the default cursor (S1)", { disabled: send.disabled, look: noChat });
      ok(box.disabled === true && tint() === TINT, "M: and the send box keeps the chat's tint, disabled", { disabled: box.disabled, tint: tint() });
      cur = ROW;
      sw.sb.ChatPanels.syncChatTier();
      ok(send.disabled === false && JSON.stringify(look(send)) === JSON.stringify(enabled), "M: A CHAT BACK, SEND IS BLUE AGAIN", { disabled: send.disabled, look: look(send) });
      box.value = "half written";
      cur = Object.assign({}, ROW, { activeTier: "staff", activeId: "!s:hs" });
      sw.sb.ChatPanels.syncChatTier();
      const locked = look(send);
      ok(sw.sb.ChatPanels.chatLocked() === true && send.disabled === true && JSON.stringify(locked) === JSON.stringify(skipOff) && tint() === TINT,
        "M: THE TYPING LOCK GREYS IT THE SAME WAY — Skip's disabled look — the box still in the chat's tint (J128's lock, S1)",
        { locked: sw.sb.ChatPanels.chatLocked(), disabled: send.disabled, look: locked, tint: tint() });
      const pick = sw.refs.chatPick ? sw.refs.chatPick.children.filter((c) => c.nodeType === 1)[0] : null;
      ok(pick && /\bchat-pick-btn\b/.test(pick.className) && (sw.cas.declared(pick, "background") || {}).val === "#222",
        "M CONTROL: the chat button beside it, in the same row, keeps its own look — the grey is Send's", pick && { cls: pick.className, bg: (sw.cas.declared(pick, "background") || {}).val });
    }
  });
  if (failures.length) { console.log("[chat-picker] " + failures.length + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[chat-picker] PASS — the chat button (J128, the owner's): which chats a person reads is their membership, and a demotion's " +
    "kick or the bot's removal takes the chat away at once — from the menu, from what Chat receives, and from the view, which goes to " +
    "the main chat — while a re-add brings it back with its messages; Go to Present moves the view when Present opens, on by default " +
    "and remembered per device and account, a pick holding until then; one button, one letter, one dot (purple over orange) opens a " +
    "menu of full names with the main chat's ✓, the current one marked and a dot per chat, and the hint names the chat; unsent text " +
    "locks when the chat changes under it — no focus, no Send, no Enter, a red outline — until a chat is picked; every chat but " +
    "Present opens with the same twenty readable messages for everyone, the last twenty of the newest 200 events whatever else is " +
    "fetching that chat — an in-flight fetch ridden, at most one request of its own — and Present shows nothing said before this tab " +
    "first had it, by a server stamp kept through kicks and re-adds, through every door that can bring it — and every other chat " +
    "shows what it opened with and what is said after, nothing older, whatever its own read-back brings — exactly its last twenty " +
    "in order with no gap while the people list pages it, a failed ridden fetch not taken for the chat's start, a thin window's " +
    "few and nothing older, a message said while it opens under the twenty; the notes " +
    "float over the chat, the true ones staying and a deletion's result fading at 4 s over 0.5 s, while the deleted message " +
    "keeps its \"Message deleted\" mark; and a live message rebuilds neither the button nor an open menu, while what they show " +
    "still shows at once; and when the last readable chat goes there is no send target — the box cannot be typed into, sends " +
    "nothing and says nothing, and works again, aimed at a chat that comes back — and a disabled Send, by either cause, takes the " +
    "Skip button's grey (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[chat-picker] FAIL — threw: " + ((e && e.stack) || e)); process.exit(1); });
