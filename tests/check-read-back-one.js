#!/usr/bin/env node
// tests/check-read-back-one.js
// SUBJECT: backends/backend1/matrixbridge.js
//
// ONE "READ A CHANNEL BACK TO A TIME" STEP (J85; the owner: no duplicated code between the bot's presence reading and REP).
//
// ── WHAT WAS FOUND (the supervisor, `ddjp_582`) ───────────────────────────────────────────────────────────────────────
// Two read-backs ask the same question — "this channel, back to that time":
//   · `MatrixBridge.readBackActivity(roomId, sinceTs)` (J67) — who spoke and when, behind `Room.presenceView`'s chat half;
//   · `MatrixBridge.readChannelBack(channels, key, sinceTs)` (J84, hook E3) — REP's look-back on the owner-level channel.
// They ran the SAME loop (scroll back about 100 at a time until the oldest held event is older than the time, or nothing
// older exists), written twice, and the copies had already drifted: a page cap of 200 against 250; a stop at `<=` against
// `<`; the running room's scope (`inScope`, rulings 14 and 18) checked by REP's only; where it reached reported by the
// chat read's only. Two copies of one rule is two answers to one question, and this tree's record is that the second
// answer is found by a person clicking.
//
// ── WHAT THIS HOLDS ─────────────────────────────────────────────────────────────────────────────────────────────────
//   A  ONE TIME-BASED PAGE-BACK LOOP, by parse. Every `scrollback(` call in the app is in `matrixbridge.js`, inside the
//      shared step `_pageBackTo` or inside one of the KNOWN pagers below — each named with what it stops on, which is not
//      "a time". A new copy, anywhere, goes red by name. The two read-backs call the step once each and page nothing
//      themselves; the cap is ONE constant, declared once and read by the step alone.
//   B  THE SAME RULES, DRIVEN, for both read-backs against a fake client: the room's scope (a channel the running room
//      does not hold is not paged — nothing asked); the stop rule (an oldest event exactly AT the time is not far
//      enough — every event at the time is held; older is); the room's start (complete); the cap (both stop at the same
//      number of requests, not complete, saying where they reached); a request that fails (not ok). AND A CALLER'S OWN STOP
//      (J117, `ddjp_630`: REP's read back to the room's start stops at the first summary of its own): `readChannelBack`
//      asks it of each item, newest first, as the read goes — what is already held first — and the first it accepts stops
//      the paging there: no request further, `stopped`, not the room's start; the item it is asked is the read's own item;
//      a stop that accepts nothing changes nothing; one that throws is a read that failed.
//   C  THE OUTPUTS ARE THEIR OWN, UNCHANGED: `readBackActivity` → { ok, people, reachedTs, complete } — each sender's
//      newest time, encrypted messages counted, this client's own included (J87); `readChannelBack` → an array with ok,
//      complete, pages — DDJP bodies, top-level only, each with its sender's level.
//   D  THE SCOPE HOLDS A CHAT CHANNEL JOINED AFTER THE OPENING. `setRoomScope` takes the map the opening built — every
//      channel joined by then, the chats included (confirmed: `features/room.js` hands it `room.channels`, the map by
//      mark, which `chatTiers()` reads its tiers from). A chat channel joined LATER is mapped without a fresh scope, so
//      without D a tier gained in the room (a promotion: the staff chat) would never be read back. `addToRoomScope` adds
//      one channel to a bound scope and never starts one; `_adoptJoinedChannel` asks it for each chat channel it maps.
//
// ── WHAT THIS DOES NOT HOLD, SAID SO IT IS NOT ASSUMED ──────────────────────────────────────────────────────────────
//   · The known pagers' own rules — each has its guards (`check-history-*`, `check-bot-open`, `check-settings-readback`).
//   · A time loop written INSIDE a known pager would not be told apart by A; B and C would not see it either. A pager
//     added under a new name is what this catches, and that is how both copies came to exist.
//   · D's room-side call is read as text: no guard drives `_adoptJoinedChannel`, an internal of `features/room.js`. Its
//     bridge half is driven.

"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

const ROOT = path.join(__dirname, "..");
const MB_REL = "backends/backend1/matrixbridge.js";
let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[read-back-one] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
const noop = () => {};

// THE KNOWN PAGERS, each with what it stops on. Adding one here is a decision, written down with its reason.
const KNOWN = {
  _pageBackTo: "THE ONE time-based page-back: back to a time (the two read-backs, J85)",
  pageRange: "positions [fromL, toL] — song history's backfill and E4's window (its time stop is a window on a position range)",
  replayRoom: "the room's download: until the timeline stops growing or the engine has enough (a save point)",
  _readActivityBack: "the engine's own answer: until `StreamManager.activityCovered()`",
  _settingsPager: "a settings channel's whole log",
  recentChatMessages: "a count: one request for the last N messages, no loop",
};

// ── A — ONE TIME-BASED LOOP, BY PARSE ──────────────────────────────────────────────────────────────────────────────
let acorn = null;
try { acorn = require(path.join(ROOT, "node_modules", "acorn")); } catch (e) { acorn = null; }
ok(!!acorn, "A: PREMISE — the parser loads (acorn, which eslint's install brings; a missing install fails, never skips)");
function appFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith(".js")) out.push(r.split(path.sep).join("/"));
    }
  };
  for (const d of ["backends", "features", "ui", "core"]) walk(d);
  out.push("app.js");
  return out;
}
// Every call `x.scrollback(...)`, with the name of the nearest enclosing NAMED function (a declaration, or a function
// or arrow assigned to a name).
function scrollbacksIn(src) {
  const found = [];
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
  const visit = (node, names) => {
    if (!node || typeof node.type !== "string") return;
    let here = names;
    if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id) here = names.concat(node.id.name);
    if (node.type === "VariableDeclarator" && node.id && node.id.type === "Identifier" && node.init &&
        /Function|Arrow/.test(node.init.type)) here = names.concat(node.id.name);
    if (node.type === "Property" && node.key && /Function|Arrow/.test(node.value && node.value.type || "")) here = names.concat(node.key.name || node.key.value);
    if (node.type === "CallExpression" && node.callee && node.callee.type === "MemberExpression" &&
        !node.callee.computed && node.callee.property && node.callee.property.name === "scrollback") {
      found.push({ fn: here.length ? here[here.length - 1] : "(top level)", outer: here.slice(), at: node.start });
    }
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) visit(c, here);
      else if (v && typeof v.type === "string") visit(v, here);
    }
  };
  visit(ast, []);
  return found;
}
const MB_SRC = fs.readFileSync(path.join(ROOT, MB_REL), "utf8");
function fnSource(name) {   // a top-level (two-space) function's source, declaration to its closing line
  const m = new RegExp("\\n  (?:async )?function " + name + "\\(").exec(MB_SRC);
  if (!m) return null;
  const end = MB_SRC.indexOf("\n  }\n", m.index + 1);
  return end > m.index ? MB_SRC.slice(m.index, end + 4) : null;
}
if (acorn) {
  const where = [];
  for (const rel of appFiles()) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (src.indexOf("scrollback") < 0) continue;
    let calls = [];
    try { calls = scrollbacksIn(src); } catch (e) { ok(false, "A: " + rel + " parses", String(e && e.message)); continue; }
    for (const c of calls) where.push({ file: rel, fn: c.fn, outer: c.outer });
  }
  ok(where.length > 0, "A: CONTROL — the scan finds the pagers (it read the files it names)", where.length);
  const foreign = where.filter((w) => w.file !== MB_REL);
  ok(foreign.length === 0, "A: every `scrollback(` call in the app is in " + MB_REL + " — nothing else pages a channel back", foreign);
  const unknown = where.filter((w) => w.file === MB_REL && !w.outer.some((n) => Object.prototype.hasOwnProperty.call(KNOWN, n)));
  ok(unknown.length === 0, "A: ONE TIME-BASED PAGE-BACK LOOP — every paging call is inside `_pageBackTo` or a KNOWN pager that " +
    "stops on something else; a new one is a new copy (name it here with what it stops on, or use the step)", unknown);
  const inStep = where.filter((w) => w.fn === "_pageBackTo");
  ok(inStep.length === 1, "A: the shared step pages in one place", inStep.length);
  for (const k of Object.keys(KNOWN)) ok(where.some((w) => w.outer.indexOf(k) >= 0), "A: the known pager `" + k + "` is still there (" + KNOWN[k] + ")");
  for (const name of ["readBackActivity", "readChannelBack"]) {
    const s = fnSource(name) || "";
    ok(s && (s.match(/_pageBackTo\(/g) || []).length === 1 && s.indexOf("scrollback") < 0 && !/\bwhile\s*\(/.test(s),
      "A: `" + name + "` pages only through the shared step — once — and has no loop of its own", s.slice(0, 120));
  }
  const code = MB_SRC.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");   // comments say the name; code reads it
  const decl = (code.match(/\bconst PAGE_BACK_MAX = \d+;/g) || []).length;
  const uses = (code.match(/\bPAGE_BACK_MAX\b/g) || []).length;
  const step = fnSource("_pageBackTo") || "";
  ok(decl === 1 && uses === 2 && /out\.pages < PAGE_BACK_MAX/.test(step),
    "A: ONE CAP — `PAGE_BACK_MAX` declared once and read by the step alone", { decl, uses });
  ok(/!inScope\(roomId\)/.test(step), "A: and the step asks the room's scope (both read-backs inherit it)");
}

// ── B, C, D — DRIVEN ───────────────────────────────────────────────────────────────────────────────────────────────
// A timeline item as the SDK hands it (getters) and as a raw one (`event`), so both read-backs read it their way.
function item(id, ts, sender, type, body) {
  const raw = { event_id: id, type: type || "m.room.message", sender: sender, origin_server_ts: ts,
    content: body === undefined ? { msgtype: "m.text", body: "hi" } : { msgtype: "m.text", body: JSON.stringify(body) } };
  return { event: raw, getId: () => id, getType: () => raw.type, getSender: () => sender, getTs: () => ts, getContent: () => raw.content };
}
// A room whose history lies in `older`, oldest first; each request brings `per` more, oldest last-in.
function room(id, name, recent, older, users, per) {
  return { roomId: id, name: name, timeline: recent.slice(), _older: (older || []).slice(), _per: per || 3,
    currentState: { getStateEvents: (t) => t === "m.room.power_levels" ? { getContent: () => ({ users: users || {}, users_default: 0 }) } : null } };
}
function bridge(rooms, o) {
  o = o || {};
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js", "core/playlistdoc.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    MB_REL], {
    Date, Math, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined, matrixcs: {}, navigator: {} });
  const byId = {}; for (const r of rooms) byId[r.roomId] = r;
  const asked = [];
  sb.MatrixBridge._setClientForTest({ getUserId: () => "@me:hs", getRoom: (id) => byId[id] || null, getRooms: () => rooms,
    scrollback: async (r) => {
      asked.push(r.roomId);
      if (o.fail && asked.length >= o.fail) throw new Error("the homeserver said no");
      if (o.endless) { const t0 = (r.timeline.length ? r.timeline[0].getTs() : 1e6); r.timeline.unshift(item("$x" + asked.length, t0 - 1, "@a:hs")); return; }
      const batch = r._older.splice(-r._per, r._per);
      r.timeline = batch.concat(r.timeline);
    } });
  return { MB: sb.MatrixBridge, asked };
}
const CHAT = "!chat:hs", OWN = "!own:hs", STAFF = "!staff:hs", OTHER = "!other:hs";
const CH = { chat_uncategorized: CHAT, events_owner: OWN };

async function driven() {
  // B: THE SCOPE. Nothing is paged for a channel the running room does not hold — nor with no room at all.
  {
    const mk = () => [room(CHAT, "chat-uncategorized", [item("$c1", 5000, "@a:hs")], [item("$c0", 1000, "@b:hs")]),
      room(OWN, "events-owner", [item("$o1", 5000, "@bot:hs", "m.room.message", { t: "ddjp.side.rep.summary", l: 9 })], []),
      room(OTHER, "chat-uncategorized", [item("$f1", 5000, "@a:hs")], [item("$f0", 1000, "@b:hs")])];
    const none = bridge(mk());
    const a0 = await none.MB.readBackActivity(CHAT, 2000), c0 = await none.MB.readChannelBack(CH, "events_owner", 2000);
    ok(a0.ok === false && c0.ok === false && none.asked.length === 0, "B: NO ROOM RUNNING — neither read-back pages anything", { a0, c0: c0.ok, asked: none.asked });
    const b = bridge(mk());
    b.MB.setRoomScope(CH);
    const a1 = await b.MB.readBackActivity(OTHER, 2000);
    const c1 = await b.MB.readChannelBack({ events_owner: OTHER }, "events_owner", 2000);
    ok(a1.ok === false && c1.ok === false && b.asked.length === 0,
      "B: THE ROOM'S SCOPE, FOR BOTH — a channel of another room is not paged, nothing asked (rulings 14, 18); the chat read " +
      "used to page any room it was handed", { a1, c1: c1.ok, asked: b.asked });
    const a2 = await b.MB.readBackActivity(CHAT, 2000), c2 = await b.MB.readChannelBack(CH, "events_owner", 2000);
    ok(a2.ok === true && c2.ok === true, "B: CONTROL — the running room's channels are read", { a2: a2.ok, c2: c2.ok });
  }
  // B: THE STOP RULE. The oldest held event exactly AT the time is not far enough (an event in the same millisecond may
  // lie further back); once something OLDER is held, it stops. The same for both.
  {
    for (const which of ["chat", "rep"]) {
      const rid = which === "chat" ? CHAT : OWN;
      const body = which === "chat" ? undefined : { t: "ddjp.dj.vote", l: 3 };
      const b = bridge([room(rid, which === "chat" ? "chat-uncategorized" : "events-owner", [item("$at", 2000, "@a:hs", "m.room.message", body)],
        [item("$older", 1500, "@b:hs", "m.room.message", body)], { "@a:hs": 50 }, 1)]);
      b.MB.setRoomScope(CH);
      const r = which === "chat" ? await b.MB.readBackActivity(CHAT, 2000) : await b.MB.readChannelBack(CH, "events_owner", 2000);
      ok(r.ok === true && b.asked.length === 1, "B: ONE STOP RULE (" + which + ") — an oldest event AT the time pages once more; " +
        "the chat read stopped there (`<=`) and REP's did not (`<`)", { asked: b.asked.length });
      const b2 = bridge([room(rid, "x", [item("$in", 2500, "@a:hs", "m.room.message", body)], [item("$o", 1500, "@b:hs", "m.room.message", body)], {}, 1)]);
      b2.MB.setRoomScope(CH);
      const r2 = which === "chat" ? await b2.MB.readBackActivity(CHAT, 1600) : await b2.MB.readChannelBack(CH, "events_owner", 1600);
      ok(r2.ok === true && b2.asked.length === 1 && r2.complete === false, "B: and once an OLDER event is held it stops — not the start (" + which + ")", { asked: b2.asked.length, c: r2.complete });
    }
  }
  // B: THE ROOM'S START, and THE CAP — the same number of requests for both, not complete, saying where it reached.
  {
    const s = bridge([room(CHAT, "chat-uncategorized", [item("$c1", 5000, "@a:hs")], [item("$c0", 3000, "@b:hs")], {}, 3),
      room(OWN, "events-owner", [item("$o1", 5000, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 2 })], [], {}, 3)]);
    s.MB.setRoomScope(CH);
    const a = await s.MB.readBackActivity(CHAT, 0), c = await s.MB.readChannelBack(CH, "events_owner", 0);
    ok(a.ok && a.complete === true && a.reachedTs === 3000 && c.ok && c.complete === true,
      "B: A TIMELINE THAT STOPS GROWING IS THE ROOM'S START — complete, for both", { a, c: { ok: c.ok, complete: c.complete } });
    const e1 = bridge([room(CHAT, "chat-uncategorized", [item("$c1", 1e6, "@a:hs")], [])], { endless: true });
    e1.MB.setRoomScope(CH);
    const ea = await e1.MB.readBackActivity(CHAT, 0);
    const e2 = bridge([room(OWN, "events-owner", [item("$o1", 1e6, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 2 })], [])], { endless: true });
    e2.MB.setRoomScope(CH);
    const ec = await e2.MB.readChannelBack(CH, "events_owner", 0);
    ok(e1.asked.length === e2.asked.length && e1.asked.length === ec.pages,
      "B: ONE CAP — both stop after the same number of requests (they stopped at 200 and 250)", { chat: e1.asked.length, rep: e2.asked.length, pages: ec.pages });
    // PINNED AT NO LESS THAN 250 (J86; the supervisor's break: 250 -> 200 stayed green). 250 was REP's, the higher of the two
    // the copies had: a lower cap would let either read stop short of a window it used to reach.
    ok(e1.asked.length >= 250 && e2.asked.length >= 250,
      "B: AND THE CAP IS NO LESS THAN 250 REQUESTS — neither read stops sooner than it did before J85", { chat: e1.asked.length, rep: e2.asked.length });
    ok(ea.ok === true && ea.complete === false && typeof ea.reachedTs === "number" && ea.reachedTs > 0 && ec.ok === true && ec.complete === false,
      "B: stopped at the cap it is NOT the room's start, and says where it reached", { a: { complete: ea.complete, reached: ea.reachedTs }, c: ec.complete });
  }
  // B: A REQUEST THAT FAILS answers not ok, for both.
  {
    const f = bridge([room(CHAT, "chat-uncategorized", [item("$c1", 5000, "@a:hs")], [item("$c0", 1000, "@b:hs")]),
      room(OWN, "events-owner", [item("$o1", 5000, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 2 })], [item("$o0", 1000, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 1 })])], { fail: 1 });
    f.MB.setRoomScope(CH);
    const a = await f.MB.readBackActivity(CHAT, 2000), c = await f.MB.readChannelBack(CH, "events_owner", 2000);
    ok(a.ok === false && c.ok === false && c.pages === 0, "B: a request that fails is not a read — not ok, for both", { a: a.ok, c: c.ok, pages: c.pages });
  }
  // B: A CALLER'S OWN STOP (J117, `ddjp_630`).
  {
    const sumB = (l) => ({ t: "ddjp.side.rep.summary", l: l });
    const mk = () => room(OWN, "events-owner",
      [item("$n2", 6000, "@x:hs", "m.room.message", { t: "ddjp.dj.vote", l: 20 }), item("$n3", 9000, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 30 })],
      [item("$nm", 500, "@bot:hs", "m.room.message", { t: "ddjp.dj.vote", l: 0 }), item("$n0", 1000, "@bot:hs", "m.room.message", sumB(1)),
       item("$n1", 3000, "@bot:hs", "m.room.message", sumB(10))], { "@bot:hs": 99 }, 2);
    const b = bridge([mk()]); b.MB.setRoomScope(CH);
    const asked = [];
    let handed = null;
    const r = await b.MB.readChannelBack(CH, "events_owner", 0, (m) => { asked.push(m.id); if (m.id === "$n1") handed = m; return m.type === "ddjp.side.rep.summary"; });
    ok(r.ok === true && r.stopped === true && r.complete === false && b.asked.length === 1 && JSON.stringify(asked) === '["$n3","$n2","$n1"]',
      "B: A CALLER'S STOP — asked of each item, newest first, as the read goes; the first it accepts stops the paging there: no " +
      "request further, `stopped`, not the room's start", { ok: r.ok, stopped: r.stopped, complete: r.complete, requests: b.asked.length, asked: asked });
    ok(JSON.stringify(r.map((x) => x.id)) === '["$n0","$n1","$n2","$n3"]' && r.reachedTs === 1000 && r.pages === 1 &&
       JSON.stringify(handed) === JSON.stringify(r.find((x) => x.id === "$n1")),
      "B: and the answer is what is held since the time, oldest first, as without one, saying where it reached — the item the stop " +
      "was asked is the read's own item", { ids: r.map((x) => x.id), reachedTs: r.reachedTs, pages: r.pages, handed: handed });
    const held = bridge([room(OWN, "events-owner", [item("$h", 9000, "@bot:hs", "m.room.message", sumB(3))], [item("$o", 1000, "@bot:hs", "m.room.message", sumB(1))], {}, 1)]);
    held.MB.setRoomScope(CH);
    const r2 = await held.MB.readChannelBack(CH, "events_owner", 0, (m) => m.type === "ddjp.side.rep.summary");
    ok(r2.ok === true && r2.stopped === true && held.asked.length === 0 && r2.length === 1,
      "B: what is already held is asked first — accepted there, no request is made", { stopped: r2.stopped, requests: held.asked.length });
    const none = bridge([mk()]); none.MB.setRoomScope(CH);
    const plain = bridge([mk()]); plain.MB.setRoomScope(CH);
    const r3 = await none.MB.readChannelBack(CH, "events_owner", 0, () => false), r4 = await plain.MB.readChannelBack(CH, "events_owner", 0);
    ok(r3.ok === true && r3.complete === true && r3.stopped === false && JSON.stringify(r3) === JSON.stringify(r4) && none.asked.length === plain.asked.length,
      "B: a stop that accepts nothing changes nothing — the room's start, complete, the same answer as with none", { r3: r3.complete, n: [none.asked.length, plain.asked.length] });
    const boom = bridge([mk()]); boom.MB.setRoomScope(CH);
    let threw = null, r5 = null;
    try { r5 = await boom.MB.readChannelBack(CH, "events_owner", 0, () => { throw new Error("x"); }); } catch (e) { threw = e; }
    ok(threw === null && r5 && r5.ok === false, "B: a stop that throws is a read that failed — not ok, never a throw", { threw: threw && String(threw), ok: r5 && r5.ok });
  }
  // C: THE OUTPUTS, EACH ITS OWN.
  {
    const chat = room(CHAT, "chat-uncategorized", [item("$m2", 4000, "@a:hs"), item("$m3", 4500, "@me:hs"), item("$m4", 4800, "@b:hs", "m.room.encrypted")],
      [item("$m0", 1000, "@a:hs"), item("$m1", 3000, "@c:hs")], {}, 2);
    const own = room(OWN, "events-owner", [item("$s1", 4000, "@bot:hs", "m.room.message", { t: "ddjp.side.rep.summary", l: 40, v: 1 }),
      item("$s2", 4500, "@bot:hs", "m.room.message", { t: "ddjp.batch", l: 41, evs: [{ t: "ddjp.side.rep.add" }] }), item("$s3", 4700, "@x:hs", "m.room.message")],
      [item("$s0", 1000, "@bot:hs", "m.room.message", { t: "ddjp.side.rep.summary", l: 10, v: 1 })], { "@bot:hs": 99 }, 2);
    const b = bridge([chat, own]);
    b.MB.setRoomScope(CH);
    const a = await b.MB.readBackActivity(CHAT, 2000);
    ok(a.ok === true && Object.keys(a).sort().join() === "complete,ok,people,reachedTs" && a.people["@a:hs"] === 4000 && a.people["@c:hs"] === 3000 &&
       a.people["@b:hs"] === 4800 && a.people["@me:hs"] === 4500 && a.reachedTs === 1000 && a.complete === false,
      // RE-AIMED (J87, the owner's ruling: the bot is a normal user): this client's own messages count, as the live record's do.
      "C: `readBackActivity` answers { ok, people, reachedTs, complete } — each sender's newest time, an encrypted message counted, " +
      "this client's own too", a);
    const c = await b.MB.readChannelBack(CH, "events_owner", 2000);
    const ids = c.map((x) => x.id);
    ok(c.ok === true && Array.isArray(c) && typeof c.pages === "number" && c.complete === false && JSON.stringify(ids) === JSON.stringify(["$s1", "$s2"]),
      "C: `readChannelBack` answers an array with ok, complete and pages — DDJP bodies since the time, oldest first; plain text " +
      "and anything older left out", { ids, pages: c.pages });
    const s1 = c.find((x) => x.id === "$s1"), s2 = c.find((x) => x.id === "$s2");
    ok(s1 && s1.senderLevel === 99 && s1.l === 40 && s1.type === "ddjp.side.rep.summary" && s2 && s2.type === "ddjp.batch",
      "C: each with its sender's level and its body — a relay batch is ONE event, never unpacked", [s1, s2]);
  }
  // D: A CHAT CHANNEL JOINED AFTER THE OPENING IS IN THE ROOM'S SCOPE.
  {
    const mk = () => [room(STAFF, "chat-staff", [item("$t1", 5000, "@a:hs")], [item("$t0", 1000, "@b:hs")]), room(CHAT, "chat-uncategorized", [], [])];
    const b = bridge(mk());
    ok(typeof b.MB.addToRoomScope === "function" && b.MB.addToRoomScope(STAFF) === false && b.MB.inScope(STAFF) === false,
      "D: with no room running nothing is added (fail closed: it never starts a scope)");
    b.MB.setRoomScope(CH);
    const before = await b.MB.readBackActivity(STAFF, 2000);
    ok(before.ok === false, "D: PREMISE — the opening's scope does not hold a chat channel joined after it", before);
    ok(b.MB.addToRoomScope(STAFF) === true && b.MB.inScope(STAFF) === true && b.MB.inScope(CHAT) === true,
      "D: added to the bound scope, which keeps the opening's channels — it adds, never replaces");
    const after = await b.MB.readBackActivity(STAFF, 2000);
    ok(after.ok === true && after.people["@b:hs"] === 1000, "D: and a tier gained in the room is read back", after);
    b.MB.setRoomScope({ events_owner: OWN });
    ok(b.MB.inScope(STAFF) === false, "D: the next room's scope replaces it — nothing carries over");
    const room_js = fs.readFileSync(path.join(ROOT, "features", "room.js"), "utf8");
    const a = room_js.indexOf("function _adoptJoinedChannel(");
    const body = a >= 0 ? room_js.slice(a, room_js.indexOf("\n  }\n", a)) : "";
    const merged = body.indexOf("Object.assign(current.channels, add);"), scoped = body.indexOf("MatrixBridge.addToRoomScope(roomId)");
    ok(merged > 0 && scoped > merged, "D (textual): `features/room.js` adds each chat channel it maps after the opening to the room's scope");
  }
}

driven().catch((e) => { failed++; console.log("[read-back-one] FAIL — threw: " + ((e && e.stack) || e)); }).then(() => {
  if (failed) { console.log("[read-back-one] " + failed + " of " + asserts + " assertions failed"); process.exit(1); }
  console.log("[read-back-one] PASS — one \"read a channel back to a time\" step (J85; " + asserts + " assertions). " +
    "ONE TIME-BASED LOOP: every paging call in the app is in matrixbridge.js, in the shared step `_pageBackTo` or in a known " +
    "pager that stops on something else (" + Object.keys(KNOWN).filter((k) => k !== "_pageBackTo").join(", ") + "); the chat " +
    "read and REP's look-back page through the step alone, under one cap. DRIVEN, FOR BOTH: the running room's scope (nothing " +
    "paged for another room's channel), one stop rule (an event AT the time is held), the room's start, the same cap, a failed " +
    "request; and a caller's own stop, asked newest first, stopping the paging at the first item it accepts (J117). Their outputs are their own and unchanged, and a chat channel joined after the opening is in the room's scope. " +
    "THIS GUARD CANNOT TELL YOU A HOMESERVER PAGES AS THE FAKE DOES — that is the live check's (People after opening; REP's look-back).");
});
