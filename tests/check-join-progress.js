#!/usr/bin/env node
// tests/check-join-progress.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, ui/screens.js, index.html
//
// WALL: REAL PROGRESS WHEN OPENING A ROOM, ONE CHANNEL AT A TIME (J141; the owner's, `?v=605`: "also when accepting an invite to a
// room we should probably see the progress of goinning all rooms before bieng able to join so we dont join too fast"; his answers
// to the proposal, "yes except what do you mean npm", then "yes but joinaccept and leave one at a time"). Before this the one join
// step joined every channel a room lists AT ONCE (`Promise.all`) and the loading card said "Loading room…" over a bar that slid
// forever, whatever the joins were doing.
//
// Driven on the REAL modules against the homeserver MODEL (`tests/_inviteworld.js`), and the REAL ui/ files in the screen world:
//   A  ONE CHANNEL AT A TIME, IN ORDER: at the opening and at a later pass, never two joins in flight, in the order the room lists
//      its channels.
//   B  THE OPENING SAYS HOW FAR IT HAS GOT: "joining" 0 of M, then one more as each channel answers, then "loading", last.
//   C  NEVER WAITING FOR A RETRY (`ddjp_539`): a channel in its backoff — the channels after it not yet tried — and the opening
//      goes on to "loading" without waiting for them; the retry clears later and the channel is joined and mapped then.
//   D  ITS TURN (one at a time): an opening that waits behind another join or leave says what it waits for, and its wait for the
//      channels is counted from its turn — not cut short by the wait (every channel is in its map).
//   E  THE CARD (the screen world): "Joining channels: 3 of 9" over a bar a third full that does not slide (its `steps` look, the
//      creation bar's fill, borrowed); "Loading songs and chat…" over the sliding bar; "Waiting: leaving Room A…"; nothing drawn
//      for an opening the person has left.
//   and, read in C, PASSES WHILE A ROOM RUNS SHOW NO CARD: after "loading", the pass going on says nothing to the opening.
"use strict";
const fs = require("fs");
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const ROOT = path.join(__dirname, "..");
const ME = W.ME, OWNER = W.OWNER;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[join-progress] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[join-progress] FAIL — the guard did not finish: a wait never ended, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };

// A room invited to at level 60, with every invite-only channel invited too: its opening joins all seven. `keys`: the order the
// room lists them (the bot-room plan's by default).
function invited(hs, sid, keys) {
  const R = hs.ddjpRoom(sid, { levels: { [ME]: 60 }, keys: keys });
  hs.invite(sid, ME, { from: OWNER });
  for (const k of ["chat_guest", "chat_staff", "presence_chat"]) hs.invite(R.ch[k], ME, { from: OWNER });
  return R;
}
// JOINS IN FLIGHT, MEASURED: the model answers after a few turns of the event loop, so joins started together overlap.
function measured(w) {
  const join0 = w.client.joinRoom;
  w.inFlight = 0; w.maxInFlight = 0; w.joinOrder = [];
  w.client.joinRoom = async (id) => { w.inFlight++; w.maxInFlight = Math.max(w.maxInFlight, w.inFlight); w.joinOrder.push(id);
    try { for (let i = 0; i < 3; i++) await Promise.resolve(); return await join0(id); } finally { w.inFlight--; } };
  return w;
}

// ── A — ONE CHANNEL AT A TIME, IN ORDER ─────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const hs = W.homeserver();
  const R = invited(hs, "!a:hs");
  const w = measured(W.inviteWorld({ hs }));
  await w.Room.join("!a:hs"); await w.settle(40);
  const listed = W.B2_KEYS.map((k) => R.ch[k]);
  ok(w.joinOrder.length === 8 && w.joinOrder[0] === "!a:hs", "A PREMISE — the opening joined the room and its seven channels", w.joinOrder);
  ok(w.maxInFlight === 1, "A: AT THE OPENING, ONE CHANNEL AT A TIME — never two joins in flight", w.maxInFlight);
  ok(JSON.stringify(w.joinOrder.slice(1)) === JSON.stringify(listed), "A: in the order the room lists them", { got: w.joinOrder.slice(1), listed });
  // A LATER PASS: two new channels the room lists (an upgrade's), taken by one pass, one at a time.
  const hs2 = W.homeserver();
  const B = hs2.ddjpRoom("!b:hs", { levels: { [ME]: 20 } });
  hs2.rooms["!b:hs"].members[ME] = "join";
  const w2 = measured(W.inviteWorld({ hs: hs2 }));
  await w2.Room.join("!b:hs"); await w2.settle(40);
  w2.maxInFlight = 0; w2.joinOrder = [];
  const ids = ["!b-x1:hs", "!b-x2:hs"];
  for (const [i, id] of ids.entries()) {
    hs2.room(id, { name: "x" + i, creator: OWNER, content: { room_version: "12", ddjp_room: "!b:hs", ddjp_kind: "events_x" + i }, members: { [OWNER]: "join" },
      joinRule: "restricted", allow: "!b:hs", parent: "!b:hs" });
    hs2.rooms["!b:hs"].children.push(id);
  }
  w2.state("!b:hs", "m.space.child", ids[1], { via: ["hs"] });
  await w2.settle(60);
  ok(JSON.stringify(w2.joinOrder) === JSON.stringify(ids) && w2.maxInFlight === 1, "A: AT A LATER PASS TOO — one at a time, in order", { order: w2.joinOrder, max: w2.maxInFlight });
  void B;
});

// ── B — THE OPENING SAYS HOW FAR IT HAS GOT ───────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const hs = W.homeserver();
  invited(hs, "!a:hs");
  const w = measured(W.inviteWorld({ hs }));
  const seen = [];
  await w.Room.join("!a:hs", { onProgress: (p) => seen.push(p.step === "joining" ? p.done + "/" + p.total : p.step) });
  const joining = seen.filter((x) => /\//.test(x));
  ok(seen.length > 0, "B: APPLIED — the opening tells its progress (`Room.join(spaceId, { onProgress })`)", seen);
  ok(JSON.stringify(joining.filter((x, i) => i === 0 || x !== joining[i - 1])) === JSON.stringify(["0/7", "1/7", "2/7", "3/7", "4/7", "5/7", "6/7", "7/7"]),
    "B: \"Joining channels\" 0 OF 7, THEN ONE MORE AS EACH CHANNEL ANSWERS", seen);
  ok(seen[seen.length - 1] === "loading" && seen.filter((x) => x === "loading").length === 1 && seen.indexOf("loading") > seen.indexOf("7/7"),
    "B: THEN \"loading\" — once, last, after every channel answered", seen);
});

// ── C — NEVER WAITING FOR A RETRY ─────────────────────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const hs = W.homeserver();
  // The FIRST listed is an invited channel in its backoff (its invite counts as synced in, as before); the six after it, the open
  // ones among them, are not tried yet — and an open channel not joined has not synced in, so only being excused lets the opening go.
  const R = invited(hs, "!a:hs", ["chat_guest", "events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized", "chat_staff", "presence_chat"]);
  hs.failNext[R.ch.chat_guest] = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 }];
  const w = W.inviteWorld({ hs });
  let release = null; const gate = new Promise((r) => { release = r; });
  w.MB._setJoinSleepForTest((ms, why) => (why === "pace" ? Promise.resolve() : gate));   // `ddjp_697`: a join's pace is not its backoff
  const seen = [];
  const l0 = w.logs.length;
  const opening = w.Room.join("!a:hs", { onProgress: (p) => seen.push(p.step === "joining" ? p.done + "/" + p.total : p.step) }).then(() => "opened", (e) => "threw: " + e.message);
  const first = await Promise.race([opening, new Promise((r) => setTimeout(() => r("still opening after 4 s"), 4000))]);
  ok(first === "opened" && hs.rooms[R.ch.events_owner].members[ME] !== "join" && hs.rooms[R.ch.chat_staff].members[ME] === "invite",
    "C: A CHANNEL IN ITS BACKOFF, THE ONES AFTER IT NOT TRIED — and the opening goes on (`ddjp_539`)",
    { first, eventsOwner: hs.rooms[R.ch.events_owner].members[ME], staff: hs.rooms[R.ch.chat_staff].members[ME] });
  ok(seen[seen.length - 1] === "loading" && seen.indexOf("0/7") >= 0 && seen.indexOf("1/7") < 0, "C: its card counted to the channel in its backoff, then said \"loading\"", seen);
  ok(w.lines(/waitForSpaceChildren timed out/, l0).length === 0, "C: the channels not tried yet were not waited for — the opening did not sit out its cap", w.lines(/timed out/, l0));
  release();
  await w.settle(60);
  const ch = (w.Room.getCurrent() || {}).channels || {};
  ok(hs.rooms[R.ch.chat_guest].members[ME] === "join" && ch.chat_guest === R.ch.chat_guest && ch.events_owner === R.ch.events_owner && ch.presence_chat === R.ch.presence_chat,
    "C: when the retry clears, the channel and the ones after it are joined and mapped", ch);
  ok(seen[seen.length - 1] === "loading", "C: and the card, already loading, hears none of it — a pass while the room runs shows no card", seen.slice(-3));
});

// ── D — ITS TURN ───────────────────────────────────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const hs = W.homeserver();
  const R = hs.ddjpRoom("!a:hs", { levels: { [ME]: 20 } });
  hs.rooms["!a:hs"].members[ME] = "join";
  // WHILE THE TURN IS HELD THE CLOCK RUNS FAST, a second a reading: a wait for the channels that started while the opening
  // waited its turn would run out within it, and the room would open with no channel joined. Let go, the clock is still.
  let t = 1.7e12, fast = true;
  class FastDate extends Date { static now() { if (fast) t += 1000; return t; } }
  // THE CAP'S OWN READINGS, NEVER REAL TIME (`ddjp_698`, JOB 3): while the turn is held, each of the cap's readings (its 150 ms
  // poll) is queued here and run by this part one at a time, so a cap that started early runs out on its own clock however
  // loaded the machine is. A fixed 1.5 s of real time was too short under load (OT4 green once in four, at 697).
  const capTicks = [];
  const st = (fn, ms) => ((fast && ms === 150) ? (capTicks.push(fn), 0) : ((ms || 0) < 1000 ? setTimeout(fn, ms) : 0));
  const w = W.inviteWorld({ hs, extras: { Date: FastDate, setTimeout: st } });
  if (typeof w.MB.inTurn !== "function") { ok(false, "D: APPLIED — the door exists"); return; }
  let let_go = null; const held = new Promise((r) => { let_go = r; });
  const turn = w.MB.inTurn("leaving Room Z", {}, () => held);
  const seen = [];
  let atOpen = null;   // the room's map the moment the opening finished
  const l0 = w.logs.length;
  const opening = w.Room.join("!a:hs", { onProgress: (p) => seen.push(p.step === "waiting" ? "waiting: " + p.what : (p.step === "joining" ? p.done + "/" + p.total : p.step)) })
    .then(() => { atOpen = Object.keys(((w.Room.getCurrent() || {}).channels) || {}).sort(); });
  await until(() => seen.length > 0, 3000);
  // Event-loop turns, not wall time: each round lets the opening move, then runs one reading of the cap if one is queued. A cap
  // running while the turn is held runs out within its eight readings and says so in the log; one that waits for the turn queues none.
  let readings = 0;
  for (let round = 0; round < 400 && readings < 40; round++) {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    if (capTicks.length) { capTicks.shift()(); readings++; }
    if (w.lines(/waitForSpaceChildren timed out/, l0).length) break;
  }
  ok(seen[0] === "waiting: leaving Room Z" && hs.joins.length === 0, "D: AN OPENING THAT WAITS ITS TURN SAYS WHAT FOR, and sends nothing", { seen, joins: hs.joins });
  fast = false;
  while (capTicks.length) capTicks.shift()();   // anything still queued runs now, on the real clock
  let_go(); await turn;
  await opening; await w.settle(20);
  ok(JSON.stringify(atOpen) === JSON.stringify(["chat_uncategorized", "events_owner", "events_uncategorized", "settings_owner"]) &&
     w.lines(/waitForSpaceChildren timed out/, l0).length === 0,
    "D: AND ITS WAIT FOR THE CHANNELS COUNTS FROM ITS TURN — the room opened with every open channel in its map, its wait not cut short by the turn's",
    { atOpen, timedOut: w.lines(/timed out/, l0) });
  void R;
});

// ── E — THE CARD ───────────────────────────────────────────────────────────────────────────────────────────────────────────
part("E", async () => {
  let told = null, settleJoin = null;
  const w = SW.world({ features: { Room: { rankLadder: () => [], scanDDJPRooms: () => ({ owned: [], joined: [], invited: [], unconfirmed: [] }),
    cancelOpening: () => ({ ok: true }), getMyId: () => ME,
    join: (sid, o) => { told = o && o.onProgress; return new Promise((r) => { settleJoin = r; }); } } } });
  const S = w.sb.Screens, main = w.main;
  const opened = S.openRoom({ spaceId: "!a:hs", name: "Room A" });
  const q = (sel) => main.querySelectorAll(sel);
  const word = () => (q(".room-loading p")[0] || {}).textContent;
  const fill = () => q(".room-loading-bar-fill")[0];
  const cas = (n, p) => { const d = n && w.cas.declared(n, p); return d ? d.val : null; };
  ok(typeof told === "function", "E: APPLIED — the loading card hands the opening its progress (`Room.join(…, { onProgress })`)", typeof told);
  if (typeof told !== "function") return;
  told({ step: "joining", done: 3, total: 9 });
  const f1 = fill();
  ok(word() === "Joining channels: 3 of 9", "E: \"Joining channels: 3 of 9\"", word());
  ok(f1 && / steps$/.test(f1.className) && f1.style.width === "33%" && cas(f1, "animation") === "none" && cas(f1, "background") === "#5865F2",
    "E: over a bar a third full that does not slide (its `steps` look)", f1 && { cls: f1.className, width: f1.style.width, animation: cas(f1, "animation") });
  const SHEET = SW.readSheet(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
  const dW = w.cas.declared(f1, "transition") || {};
  const rW = SHEET.find((r) => r.order === dW.order), rC = SHEET.find((r) => r.sel === "#create-progress-bar-fill");
  ok(rW && rC && rW.decls === rC.decls, "E: its fill is the creation bar's fill, borrowed from the same rule (not a copy)", dW.sel);
  told({ step: "loading" });
  const f2 = fill();
  ok(word() === "Loading songs and chat…" && f2 && f2.className === "room-loading-bar-fill" && f2.style.width === "" && /room-loading-slide/.test(cas(f2, "animation") || ""),
    "E: then \"Loading songs and chat…\" over the sliding bar", { word: word(), cls: f2 && f2.className, animation: cas(f2, "animation") });
  told({ step: "waiting", what: "leaving Room A" });
  ok(word() === "Waiting: leaving Room A…", "E: and, one at a time, \"Waiting: leaving Room A…\"", word());
  // The person went back: the card is gone and nothing is drawn for this opening.
  const back = q(".back-btn")[0];
  if (back) back.click();
  told({ step: "joining", done: 5, total: 9 });
  ok(!q(".room-loading").length || word() !== "Joining channels: 5 of 9", "E: an opening the person has left draws nothing", word());
  settleJoin(null);
  await opened;
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[join-progress] FAIL — PART " + name + " threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[join-progress] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[join-progress] PASS — real progress when opening a room, one channel at a time (J141; " + asserts + " assertions): at the " +
    "opening and at a later pass never two joins in flight, in the room's listed order; the opening says 0 of M, one more as each " +
    "channel answers, then \"loading\" once, last; a channel in its backoff and the opening goes on without the ones after it, which " +
    "are joined and mapped when the retry clears, the card hearing none of it; an opening that waits its turn says what for and its " +
    "wait counts from its turn; the card draws \"Joining channels: 3 of 9\" over a still bar a third full, then \"Loading songs and " +
    "chat…\" over the sliding bar, and \"Waiting: …\"; and nothing for an opening the person has left.");
})();
