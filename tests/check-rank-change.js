// tests/check-rank-change.js
// SUBJECT: backends/backend1/matrixbridge.js, features/room.js, features/actions.js, ui/roster.js
// WALL: A RANK CHANGE FINISHES, SHOWS ITS PROGRESS, AND REPAIRS (J129, the owner's). One change at a time on a tab, for the
//   whole room; every step confirmed by reading it back; a rate limit waited out as the server says; one minute, then a named
//   error with Try again; the card unlocked between changes and not rebuilt while it is used.
//   Driven in BOTH room types (a shared room, `backend1`; a bot room, `backend2`) through the REAL bridge, room and adapter
//   over a model homeserver (`tests/_inviteworld.js`), and the REAL card and rank picker (`tests/_probe-j14-card.js`):
//   PART A — an invite answered 429 is retried as the server says and confirmed; progress is steps confirmed of steps.
//   PART B — a failure that persists stops at the minute, names the channel, writes no "reconciled" line; Try again repairs.
//            A request still in flight at the minute is waited on no further; a refusal the server means is named at once;
//            the presence chat's level is not a step for an account outside it (the bot's room); any other such room is named;
//            and a room this account LEFT, which the SDK keeps (`ddjp_652`), is read by its membership at every one of those.
//   PART C — a person already at staff, missing the staff-chat invite, gets it from a re-apply; levels in place are not sent;
//            a server's "already in" / "not in the room" answer counts once it is read back.
//   PART D — a second change is refused by name while one runs, nothing is sent for it, and every picker waits.
//   PART E — leaving the room stops a change; the join step runs only when THIS account's level moved, saying from what to what.
//   PART F — the card: unlocked between changes; "Changing to … N of M", "… ✓", the error with Try again; another person's
//            card waits with progress; a burst repaints once; a repaint during it keeps a focused picker open and unlocked.
//   PART G — a pick that starts no change puts its box back (`ddjp_666`, the owner's choice): for every refusal `Room.assignRank`
//            makes before a change starts (read from its source), a send that throws and the locked card's early exit, the box
//            shows the person's real rank and picking that rank again asks again; an accepted pick still starts the change, and
//            a box held open after a refusal is not rebuilt. Red on 665's `ui/roster.js` at exactly those rows.
// RED FIRST ON 650 (the tree before J129). There the clock seam, the progress and the room's change state do not exist: the
// world skips what it cannot install, every scenario is raced against a real-time cap so a change that never ends reads as
// "did not finish", and each row asserts its own premise, so an absent subject reads red by name, never green by silence.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const P = require(path.join(__dirname, "_probe-j14-card.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[rank-change] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }

const ME = W.ME, THEM = "@them:hs", OTHER = "@other:hs";
const lv = (name) => P.Ranks.levelOf(name);
const STAFF = lv("staff"), PLAYER = lv("player"), HIGH = lv("high-staff");
const LABEL = (l) => { const r = P.Ranks.LADDER.find((x) => x.level === l); return r ? (r.label || r.name) : String(l); };
const MODES = [["backend1", "shared room"], ["backend2", "bot room"]];
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
// A REAL-TIME CAP: a change that never ends (650 has no limit, and its retries wait on real timers this world holds) is a
// reading — "did not finish" — not a hung guard.
const cap = (p, ms) => Promise.race([Promise.resolve(p).then((v) => ({ v }), (e) => ({ threw: (e && e.message) || String(e) })),
  new Promise((r) => setTimeout(() => r({ timedOut: true }), ms || 4000))]);
const e429 = (ms) => Object.assign(new Error("Too Many Requests"), { errcode: "M_LIMIT_EXCEEDED", httpStatus: 429, data: { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: ms } });
const e403 = (msg) => Object.assign(new Error(msg || "Forbidden"), { errcode: "M_FORBIDDEN", httpStatus: 403, data: { errcode: "M_FORBIDDEN", error: msg || "Forbidden" } });

// ── THE WORLD: one DDJP room of the given type, this account ("me") able to change ranks, two people at level 0 ─────────────
// The homeserver applies an accepted send a few turns AFTER answering it, as a sync delivers it later, and a power level that
// lands is delivered to the bridge as the sync's state event — so the room and the card hear the burst. `script(send)` answers
// a send: `{ error }` (thrown), `{ error, applied: true }` (thrown, yet the server has it), `{ hang: true }` (never answers),
// `{ lost: true }` (accepted, never shown), and `lag: n` shows what it applied n turns later instead of three (a slow sync).
// `hold()` holds every answer until `release()`.
// AS A HOMESERVER DOES, IT REFUSES A NON-MEMBER (`ddjp_652`): a power level, invite or kick sent into a room this account
// has not joined is answered 403 M_FORBIDDEN, "User … not in room …" — before any script.
// AND A ROOM THIS ACCOUNT LEFT IS KEPT AS THE SDK KEEPS IT (`o.left`, the owner's correction at `ddjp_652`): matrix-js-sdk
// 41.8.0 stores every room of a sync's `rooms.leave`, so `client.getRoom` still answers it, its membership "leave", its
// state as of leaving. `tests/_inviteworld.js` answered null for it until then, so a reading of "in" from `getRoom` agreed
// with that double and not with the SDK, and no row could see it; the double holds it now, and `o.left` puts this account
// out of the rooms it names after the world is built.
function rankWorld(mode, o) {
  o = o || {};
  const hs = W.homeserver();
  const sends = [], clock = { t: 0, sleeps: [], cut: null };
  let gate = null, wref = null;
  const script = { fn: o.script || null };
  const LAG = 3;
  const userOf = (rid, content) => { const now = (hs.rooms[rid] && hs.rooms[rid].power.users) || {}; const u = (content && content.users) || {};
    return Object.keys(u).find((k) => now[k] !== u[k]) || null; };
  async function serve(kind, roomId, userId, content) {
    const n = sends.filter((s) => s.kind === kind && s.roomId === roomId && s.userId === userId).length + 1;
    const s = { kind, roomId, userId, n, at: clock.t };
    sends.push(s);
    if (gate) await gate.p;
    if (!hs.rooms[roomId] || hs.rooms[roomId].members[ME] !== "join") throw e403("User " + ME + " not in room " + roomId);
    const a = (script.fn && script.fn(s)) || {};
    if (a.hang) return new Promise(() => {});
    const apply = () => {
      if (a.lost || !hs.rooms[roomId]) return;
      if (kind === "level") { hs.rooms[roomId].power = JSON.parse(JSON.stringify(content)); if (wref) wref.state(roomId, "m.room.power_levels", "", hs.rooms[roomId].power, ME); }
      else if (kind === "in") { if (hs.rooms[roomId].members[userId] !== "join") hs.invite(roomId, userId, { from: ME }); }
      else hs.rooms[roomId].members[userId] = "leave";
    };
    if (a.error) { if (a.applied) turns(a.lag || LAG).then(apply); throw a.error; }
    turns(a.lag || LAG).then(apply);
    return {};
  }
  const client = {
    sendStateEvent: (rid, type, content) => (type === "m.room.power_levels" ? serve("level", rid, userOf(rid, content), content) : Promise.resolve({})),
    invite: (rid, u) => serve("in", rid, u),
    kick: (rid, u) => serve("out", rid, u),
  };
  const w = W.inviteWorld({ hs, client });
  wref = w;
  const keys = (w.sb.Backends.planFor(mode) || []).map((r) => r.key);
  const sid = "!rc-" + mode + ":hs";
  const R = hs.ddjpRoom(sid, { mode, keys });
  const ids = [sid].concat(Object.values(R.ch));
  const levels = Object.assign({ [ME]: 100 }, o.levels || {});
  for (const id of ids) { hs.rooms[id].power = { users: Object.assign({}, levels), users_default: 0 }; hs.rooms[id].members[ME] = "join"; }
  // Two people at level 0: in the space, in every channel everyone belongs in, and in the open chat only.
  for (const u of [THEM, OTHER]) {
    hs.rooms[sid].members[u] = "join";
    for (const k of keys) if ((!/^chat_/.test(k) && !/presence/.test(k)) || k === "chat_uncategorized") hs.rooms[R.ch[k]].members[u] = "join";
  }
  if (o.setup) o.setup(hs, R, sid);   // `sid` too (`ddjp_666`): PART G's "self" sets this account's level in the space
  // `o.left`: rooms this account was in and LEFT (the bot removing it from Present, say). The SDK — and the double — still hold each.
  for (const k of (o.left || [])) hs.rooms[R.ch[k]].members[ME] = "leave";
  // THE CLOCK: a sleep moves virtual time on and gives the event loop a turn; the minute's timer fires when time passes it.
  const sleep = async (ms) => { clock.sleeps.push(ms); clock.t += ms; if (clock.cut && clock.cut.at <= clock.t) { const f = clock.cut.fn; clock.cut = null; f(); } await turns(1); };
  const later = (fn, ms) => { clock.cut = { fn, at: clock.t + ms }; return clock.cut; };
  const unlater = (h) => { if (clock.cut === h) clock.cut = null; };
  const seam = typeof w.MB._setRankClockForTest === "function";
  if (seam) w.MB._setRankClockForTest(sleep, later, unlater);
  w.Room._enterForTest({ name: "Rank room", spaceId: sid, channels: R.ch }, mode);
  const jobs = [];
  if (typeof w.Room.onRankJob === "function") w.Room.onRankJob((j) => jobs.push(j ? JSON.parse(JSON.stringify(j)) : null));
  return {
    w, hs, sid, ch: R.ch, keys, sends, clock, script, jobs, seam, mode,
    hold() { let r; gate = { p: new Promise((x) => { r = x; }) }; gate.r = r; },
    release() { const g = gate; gate = null; if (g) g.r(); },
    // Time passing with nothing asleep — a request in flight that never answers: the minute's timer fires as it would.
    advance(ms) { clock.t += ms; if (clock.cut && clock.cut.at <= clock.t) { const f = clock.cut.fn; clock.cut = null; f(); } },
    // what a change to `level` must confirm in this room: every level, the space, and every channel but the presence chat
    // (which only an owner-tier level is taken into) — counted from the plan's own rows, not from the rule under test
    total(level) { const pres = keys.filter((k) => /presence/.test(k)).length; return (1 + keys.length) + 1 + keys.length - (level >= lv("owner") ? 0 : pres); },
    level(u, k) { const id = k ? R.ch[k] : sid; const p = hs.rooms[id].power; return (p.users && p.users[u] !== undefined) ? p.users[u] : p.users_default; },
    member(u, k) { return hs.rooms[R.ch[k]].members[u] || null; },
    sentTo(kind, k, u) { const id = k === "space" ? sid : R.ch[k]; return sends.filter((s) => s.kind === kind && s.roomId === id && (u === undefined || s.userId === u)).length; },
    line(re, from) { return w.logs.slice(from || 0).filter((m) => re.test(m)); },
    async settle(n) { await turns(n || 20); },
  };
}
// Any claim of "reconciled" (what a partial must never print), and the line J129 writes (which states what it confirmed).
const reconciled = (x, from) => x.line(/all channels reconciled/, from);
const reconciledAll = (x, from) => x.line(/\(all channels reconciled — (\d+) of \1 steps confirmed\)/, from);
const label = (k) => "invite to " + k.replace(/_/g, "-");

(async () => {
  // ═══ PART A — an invite answered 429 is retried as the server says and confirmed ════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff && s.n <= 2 ? { error: e429(1500) } : null);
    ok(x.ch.chat_staff && x.member(THEM, "chat_staff") === null && x.level(THEM) === 0, "A " + name + ": PREMISE — they are at level 0 and not in the staff chat");
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);   // what the server has is read after the sync that carries it, whatever the change answered
    const v = r.v || {};
    ok(!r.timedOut && v.ok === true && v.done === x.total(STAFF) && v.total === x.total(STAFF), "A " + name + ": the change ends DONE — every step confirmed (" + x.total(STAFF) + ")", r);
    ok(x.sentTo("in", "chat_staff", THEM) === 3, "A " + name + ": the staff-chat invite answered 429 twice was sent again each time, then accepted", x.sentTo("in", "chat_staff", THEM));
    ok(x.clock.sleeps.filter((ms) => ms === 1500).length === 2, "A " + name + ": each 429 waited as the server said (retry_after_ms 1500)", x.clock.sleeps.slice(0, 12));
    ok(x.member(THEM, "chat_staff") === "invite" && x.member(THEM, "chat_guest") === "invite", "A " + name + ": and they ARE invited to the staff chat, on the server", x.member(THEM, "chat_staff"));
    ok(x.keys.every((k) => x.level(THEM, k) === STAFF) && x.level(THEM) === STAFF, "A " + name + ": their level is staff in the space and in every channel, on the server");
    ok(reconciled(x).length === 1 && reconciledAll(x).length === 1 && x.line(/not confirmed/).length === 0,
      "A " + name + ": one \"all channels reconciled\" line, saying every step was confirmed, and nothing \"not confirmed\"", x.line(/MatrixBridge: (assigned|rank change)/));
    ok(x.line(new RegExp("Room: .* is now level " + STAFF + " — all " + x.total(STAFF) + " steps confirmed")).length === 1, "A " + name + ": the room says it is done, and how many steps it confirmed", x.line(/Room: .*level/));
    const prog = x.jobs.filter((j) => j && j.userId === THEM);
    const dones = prog.map((j) => j.done);
    ok(prog.length >= 3 && dones.every((d, i) => i === 0 || d >= dones[i - 1]) && prog[prog.length - 1].state === "done" && prog[prog.length - 1].done === x.total(STAFF),
      "A " + name + ": the progress counts steps confirmed of steps, only upward, and ends at all of them, done", dones);
    ok(x.seam && x.clock.t < 60000, "A " + name + ": inside the minute", x.clock.t);
    ok(x.sentTo("in", "presence_chat") === 0 && x.sentTo("out", "presence_chat") === 0 && x.member(THEM, "presence_chat") === null,
      "A " + name + ": the presence chat stays the bot's — nothing sent there for a staff change", { inv: x.sentTo("in", "presence_chat"), kick: x.sentTo("out", "presence_chat") });
  }

  // ═══ PART B — a failure that persists stops at the minute; Try again repairs ═════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff ? { error: e429(2000) } : null);
    const from = x.w.logs.length;
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    const v = r.v || {};
    ok(!r.timedOut, "B " + name + ": the change ENDS — it does not run on", r);
    ok(v.ok === false && v.reason === "limit" && v.done === x.total(STAFF) - 1 && v.total === x.total(STAFF), "B " + name + ": it ends at the limit, every step but one confirmed", v);
    ok(Array.isArray(v.failed) && v.failed.length === 1 && v.failed[0] === label("chat_staff"), "B " + name + ": and the answer names what did not land — the staff-chat invite", v.failed);
    ok(x.seam && x.clock.t >= 60000 && x.clock.t < 60000 + 2000 + 250 + 1, "B " + name + ": it stopped AT the minute (virtual time " + x.clock.t + " ms)", x.clock.t);
    ok(reconciled(x, from).length === 0, "B " + name + ": NO \"all channels reconciled\" line", x.line(/reconciled/, from));
    ok(x.line(/stopped at the 1-minute limit — \d+ of \d+ steps confirmed; not confirmed: invite to chat-staff \(M_LIMIT_EXCEEDED\)/, from).length === 1,
      "B " + name + ": the log says it stopped at the minute, and names the channel and the error", x.line(/MatrixBridge: rank change/, from));
    ok(x.line(/Room: the rank change for .* did not finish \(\d+ of \d+ steps confirmed\) — not confirmed: invite to chat-staff/, from).length === 1 && x.line(/Room: .* is now level/, from).length === 0,
      "B " + name + ": the room says it did not finish, never that it is done", x.line(/Room: .*(rank|level)/, from));
    const last = x.jobs[x.jobs.length - 1];
    ok(last && last.state === "failed" && JSON.stringify(last.failed) === JSON.stringify([label("chat_staff")]), "B " + name + ": the change's state is failed, with what did not land", last);
    const n0 = x.sends.length; await x.settle(40);
    ok(x.sends.length === n0 && x.clock.cut === null, "B " + name + ": ended means ended — nothing is sent after it, and no timer is left (the background retry is gone)", { more: x.sends.length - n0, timer: !!x.clock.cut });
    // TRY AGAIN IS THE SAME CHANGE AGAIN, and the change is the repair.
    x.script.fn = null;
    const lv0 = x.sends.filter((s) => s.kind === "level").length;
    const r2 = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    ok(x.member(THEM, "chat_staff") === "invite", "B " + name + ": TRY AGAIN REPAIRS — the invite lands", x.member(THEM, "chat_staff"));
    ok(r2.v && r2.v.ok === true && r2.v.done === x.total(STAFF), "B " + name + ": and the change answers done, every step confirmed", r2);
    ok(x.sends.filter((s) => s.kind === "level").length === lv0, "B " + name + ": and it sends no level again — those are read back in place, not sent", x.sends.filter((s) => s.kind === "level").length - lv0);
    ok(reconciled(x, from).length === 1, "B " + name + ": and only now is \"reconciled\" written", reconciled(x, from).length);
  }
  // A request in flight at the minute is waited on no further, and counts as not landed.
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff ? { hang: true } : null);
    const pr = cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(60);
    ok(x.sentTo("in", "chat_staff", THEM) === 1, "B " + name + ": PREMISE — the staff-chat invite is in flight, unanswered", x.sentTo("in", "chat_staff", THEM));
    x.advance(60000);
    const r = await pr;
    const v = r.v || {};
    ok(!r.timedOut && v.ok === false && v.reason === "limit" && JSON.stringify(v.failed) === JSON.stringify([label("chat_staff")]),
      "B " + name + ": A REQUEST STILL IN FLIGHT AT THE MINUTE is waited on no further — the change ends, naming it", r);
    ok(x.line(/not confirmed: invite to chat-staff \(in flight at the limit\)/).length === 1, "B " + name + ": and the log says it was in flight", x.line(/MatrixBridge: rank change/));
  }
  // A refusal the server means (403) is named at once, not sent again for a minute.
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.script.fn = (s) => (s.kind === "level" && s.roomId === x.ch.chat_uncategorized ? { error: e403("You don't have permission to change that") } : null);
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    const v = r.v || {};
    ok(!r.timedOut && v.ok === false && v.reason === "refused" && JSON.stringify(v.failed) === JSON.stringify(["level in chat-uncategorized"]),
      "B " + name + ": A REFUSAL (403) is named — the level in that channel — and the change ends", r);
    ok(x.sentTo("level", "chat_uncategorized") === 1 && x.clock.t < 60000, "B " + name + ": sent once, not again, and long before the minute", { sends: x.sentTo("level", "chat_uncategorized"), t: x.clock.t });
  }
  // A room this account is not in. The presence chat is the bot's — an account the activity rule has not admitted cannot
  // reach it — so its level is not this change's step, and the success line says so; any other such room is named.
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode, { setup: (hs, R) => { delete hs.rooms[R.ch.presence_chat].members[ME]; } });
    ok(x.w.client.getRoom(x.ch.presence_chat) === null, "B " + name + ": PREMISE — this account is not in the presence chat");
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    ok(r.v && r.v.ok === true && r.v.total === x.total(STAFF) - 1 && x.sentTo("level", "presence_chat") === 0,
      "B " + name + ": NOT IN THE PRESENCE CHAT, the change is done without a level there", r);
    ok(x.line(/all channels reconciled — \d+ of \d+ steps confirmed\) — the presence chat is the bot's and this account is not in it: its level there is not set/).length === 1,
      "B " + name + ": and the success line says the presence chat's level was not set", x.line(/MatrixBridge: assigned/));
    const y = rankWorld(mode, { setup: (hs, R) => { delete hs.rooms[R.ch.chat_guest].members[ME]; } });
    const r2 = await cap(y.w.Room.assignRank(THEM, STAFF));
    ok(r2.v && r2.v.ok === false && r2.v.reason === "unreachable" && JSON.stringify(r2.v.failed) === JSON.stringify(["level in chat-guest", "invite to chat-guest"]),
      "B " + name + ": CONTROL — any other room this account is not in is NAMED, and the change is not done", r2);
  }
  // A ROOM THIS ACCOUNT LEFT (the owner's correction, `ddjp_652`): the SDK keeps it, so `getRoom` answers it, membership
  // "leave" — and "in" is read from the membership. A staff account the bot removed from Present first; then any other room.
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode, { levels: { [ME]: STAFF }, left: ["presence_chat"] });
    const held = x.w.client.getRoom(x.ch.presence_chat);
    ok(held && held.getMyMembership() === "leave" && x.member(ME, "presence_chat") === "leave",
      "B " + name + ": PREMISE — a staff account removed from Present, the room still held as the SDK holds it (membership \"leave\")", held && held.getMyMembership());
    const r = await cap(x.w.Room.assignRank(THEM, PLAYER));
    await x.settle(20);
    ok(r.v && r.v.ok === true && r.v.total === x.total(PLAYER) - 1 && x.sentTo("level", "presence_chat") === 0,
      "B " + name + ": A STAFF ACCOUNT REMOVED FROM PRESENT completes its change — no level sent there", r);
    ok(x.line(/all channels reconciled — \d+ of \d+ steps confirmed\) — the presence chat is the bot's and this account is not in it: its level there is not set/).length === 1,
      "B " + name + ": and its success line says the presence chat's level was not set", x.line(/MatrixBridge: (assigned|rank change)/));
  }
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode, { left: ["chat_guest"] });
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    ok(r.v && r.v.ok === false && r.v.reason === "unreachable" && JSON.stringify(r.v.failed) === JSON.stringify(["level in chat-guest", "invite to chat-guest"]) &&
       x.sentTo("level", "chat_guest") + x.sentTo("in", "chat_guest") === 0 && x.clock.t < 60000,
      "B " + name + ": AND ANY OTHER CHANNEL THIS ACCOUNT LEFT is named at once: nothing sent to it, not waited on", { r, sent: x.sentTo("level", "chat_guest") + x.sentTo("in", "chat_guest"), t: x.clock.t });
    // ITS STATE AS OF LEAVING IS NOT A READ-BACK: the person already held the level there, and was in it, when this account left.
    const y = rankWorld(mode, { levels: { [THEM]: STAFF }, left: ["chat_guest"],
      setup: (hs, R) => { hs.rooms[R.ch.chat_guest].members[THEM] = "join"; hs.rooms[R.ch.chat_staff].members[THEM] = "join"; } });
    const r2 = await cap(y.w.Room.assignRank(THEM, STAFF));
    ok(r2.v && r2.v.ok === false && r2.v.reason === "unreachable" && JSON.stringify(r2.v.failed) === JSON.stringify(["level in chat-guest", "invite to chat-guest"]),
      "B " + name + ": A LEFT ROOM'S STATE, AS OF LEAVING, IS NOT A READ-BACK — its steps are named, not counted", r2);
  }

  // ═══ PART C — a re-apply repairs; what is in place is read, not sent; "already" counts once read back ════════════════════
  for (const [mode, name] of MODES) {
    // At staff everywhere and in every channel staff belongs in — except the staff chat, whose invite the owner's log at
    // 01:56:18 lost to the promotion's own burst of requests (a 429). The re-apply meets the same limit once.
    const x = rankWorld(mode, { levels: { [THEM]: STAFF }, setup: (hs, R) => { hs.rooms[R.ch.chat_guest].members[THEM] = "join"; } });
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_staff && s.n === 1 ? { error: e429(800) } : null);
    ok(x.level(THEM) === STAFF && x.member(THEM, "chat_staff") === null && x.member(THEM, "chat_guest") === "join", "C " + name + ": PREMISE — at staff, missing only the staff-chat invite");
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    ok(x.member(THEM, "chat_staff") === "invite", "C " + name + ": THE RE-APPLY REPAIRS — they get the staff-chat invite", x.member(THEM, "chat_staff"));
    ok(r.v && r.v.ok === true && r.v.done === x.total(STAFF), "C " + name + ": and the change answers done, every step confirmed", r);
    ok(x.sends.filter((s) => s.kind === "level").length === 0 && x.sentTo("in", "space") === 0 && x.sentTo("in", "chat_guest") === 0,
      "C " + name + ": nothing already in place is sent — no level, no invite to a room they are in", x.sends.map((s) => s.kind + " " + s.roomId));
  }
  // The server answers "already" while this client has not seen it yet: an accepted send, read back like any other. Each
  // answer in a change of its own, and its sync a slow one — it lands after every other step is confirmed, so only an answer
  // taken as accepted is still being read back when it does (and well inside the ten seconds after which an unseen step is
  // sent again). Two in one change would hide each other: the one still read back keeps the change reading the other.
  for (const [mode, name] of MODES) {
    // "ALREADY IN": at guest, missing only the guest chat on this client — the server has them invited.
    const x = rankWorld(mode, { levels: { [THEM]: lv("guest") } });
    x.script.fn = (s) => (s.kind === "in" && s.roomId === x.ch.chat_guest ? { error: e403(THEM + " is already in the room."), applied: true, lag: 20 } : null);
    ok(x.member(THEM, "chat_guest") === null && x.level(THEM) === lv("guest"), "C " + name + ": PREMISE — at guest, the guest chat not shown here");
    const r = await cap(x.w.Room.assignRank(THEM, lv("guest")));
    await x.settle(20);
    ok(r.v && r.v.ok === true && x.member(THEM, "chat_guest") === "invite", "C " + name + ": \"ALREADY IN\" COUNTS once read back — the change is done", r);
    ok(x.sentTo("in", "chat_guest") === 1, "C " + name + ": sent once — an \"already in\" answer is not sent again", x.sentTo("in", "chat_guest"));
  }
  for (const [mode, name] of MODES) {
    // "NOT IN THE ROOM": demoted from staff to guest, shown here still in the staff chat — the server has them out.
    const x = rankWorld(mode, { levels: { [THEM]: STAFF }, setup: (hs, R) => { hs.rooms[R.ch.chat_staff].members[THEM] = "join"; hs.rooms[R.ch.chat_guest].members[THEM] = "join"; } });
    x.script.fn = (s) => (s.kind === "out" && s.roomId === x.ch.chat_staff ? { error: e403("The target user is not in the room"), applied: true, lag: 20 } : null);
    ok(x.member(THEM, "chat_staff") === "join", "C " + name + ": PREMISE — shown here in the staff chat");
    const r = await cap(x.w.Room.assignRank(THEM, lv("guest")));
    await x.settle(20);
    ok(r.v && r.v.ok === true && x.member(THEM, "chat_staff") === "leave", "C " + name + ": \"NOT IN THE ROOM\" COUNTS once read back — the change is done", r);
    ok(x.sentTo("out", "chat_staff") === 1, "C " + name + ": sent once — a \"not in the room\" answer is not sent again", x.sentTo("out", "chat_staff"));
  }

  // ═══ PART D — one change at a time on this tab; a second is refused by name; every picker waits ═══════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.hold();
    const p1 = cap(x.w.Room.assignRank(THEM, STAFF), 8000);
    await x.settle(10);
    ok(x.sends.length > 0 && x.sends.every((s) => s.userId === THEM || s.userId === null), "D " + name + ": PREMISE — a change for them runs, its request held in flight", x.sends.length);
    const j = typeof x.w.Room.rankJob === "function" ? x.w.Room.rankJob() : null;
    ok(j && j.state === "running" && j.userId === THEM && j.level === STAFF, "D " + name + ": the room holds it as the running change", j);
    const n0 = x.sends.length, from = x.w.logs.length;
    const r2 = await cap(x.w.Room.assignRank(OTHER, PLAYER), 1500);
    const v2 = r2.v || {};
    ok(v2.ok === false && v2.reason === "rank-change-running" && v2.running && v2.running.userId === THEM && v2.running.level === STAFF,
      "D " + name + ": A SECOND CHANGE IS REFUSED BY NAME while one runs — nothing is queued", r2);
    ok(x.sends.slice(n0).every((s) => s.userId !== OTHER), "D " + name + ": and nothing is sent for it", x.sends.slice(n0).filter((s) => s.userId === OTHER).length);
    ok(x.line(/Room: a rank change for .* is running \(\d+ of \d+\) — this one, @other:hs to level 20, was not started/, from).length === 1, "D " + name + ": the log says so", x.line(/Room:/, from));
    const dOther = x.w.sb.Actions.describe("rank.assign", { userId: OTHER, targetRank: 0 });
    const dThem = x.w.sb.Actions.describe("rank.assign", { userId: THEM, targetRank: 0 });
    ok(!dOther.enabled && /^Waiting — a rank change for .+ is running( \(\d+ of \d+\))?$/.test(dOther.reason || "") && !dThem.enabled && dThem.reason === dOther.reason,
      "D " + name + ": every rank picker WAITS — the adapter answers not available, with the running change as the reason", { dOther, dThem });
    x.release();
    const r1 = await p1;
    await x.settle(20);
    ok(!r1.timedOut && x.level(THEM) === STAFF, "D " + name + ": the first change finishes", r1);
    const after = x.w.sb.Actions.describe("rank.assign", { userId: OTHER, targetRank: 0 });
    ok(after.enabled, "D " + name + ": and when it is ready the pickers are live again", after);
    const n3 = x.sends.filter((s) => s.userId === OTHER).length;
    const r3 = await cap(x.w.Room.assignRank(OTHER, PLAYER));
    await x.settle(20);
    ok(!r3.timedOut && x.sends.filter((s) => s.userId === OTHER).length > n3 && x.level(OTHER) === PLAYER, "D " + name + ": a change asked for after it runs", r3);
  }

  // ═══ PART E — the leave stops a change; the join step runs only on this account's own move ═══════════════════════════════
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    x.hold();
    const p = cap(x.w.Room.assignRank(THEM, STAFF), 8000);
    await x.settle(10);
    x.w.Room.leave("the guard left");
    const n0 = x.sends.length;
    x.release();
    const r = await p;
    await x.settle(30);
    ok(r.v && r.v.ok === false && r.v.reason === "stopped", "E " + name + ": LEAVING THE ROOM STOPS THE CHANGE — it answers stopped", r);
    ok(x.sends.length === n0, "E " + name + ": nothing more is sent after the leave", x.sends.length - n0);
    ok(typeof x.w.Room.rankJob === "function" && x.w.Room.rankJob() === null, "E " + name + ": and the change's state goes with the room");
    ok(x.line(/stopped when the room was left/).length === 1, "E " + name + ": the log says why it stopped", x.line(/MatrixBridge: rank change/));
  }
  for (const [mode, name] of MODES) {
    // This account at high staff: a change for somebody else, its burst of power-level events delivered, then this account's own.
    const x = rankWorld(mode, { levels: { [ME]: HIGH } });
    const from = x.w.logs.length;
    const r = await cap(x.w.Room.assignRank(THEM, STAFF));
    await x.settle(20);
    ok(!r.timedOut && x.level(THEM) === STAFF && x.sends.filter((s) => s.kind === "level").length > 3, "E " + name + ": PREMISE — another person's change landed, a burst of power-level events with it", r);
    ok(x.line(/join step for .*this account's rank changed/, from).length === 0, "E " + name + ": ANYBODY ELSE'S CHANGE RUNS NO JOIN STEP", x.line(/join step for/, from).map((m) => m.slice(0, 160)));
    const from2 = x.w.logs.length;
    x.hs.rooms[x.sid].power.users[ME] = 100;
    x.w.state(x.sid, "m.room.power_levels", "", x.hs.rooms[x.sid].power, W.OWNER);
    await x.settle(30);
    const own = x.line(/join step for .*this account's rank changed/, from2);
    ok(own.length === 1 && new RegExp("this account's rank changed \\(" + HIGH + " → 100\\)").test(own[0]), "E " + name + ": THIS ACCOUNT'S OWN MOVE runs one, saying from what to what", own.map((m) => m.slice(0, 200)));
  }

  // ═══ PART F — the card ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // The REAL card, the REAL rank picker, the REAL adapter and room of the world above; focus as Chromium has it (removing a
  // focused node fires its blur). The app's `_peopleChanged` (ui/screens.js) refreshes an open card on every rank change, so
  // the world's rank listener does that here; `check-user-card` J asserts the app's wiring. On a DOM-shaped tree (`card` below).
  const flat = (n) => [n].concat(...Array.from((n && n.children) || []).map(flat));
  const nodes = (c) => [].concat(...c.mountedNodes.map(flat));
  const pickerOf = (c) => nodes(c).find((n) => n.tag === "select");
  const lockOf = (c) => nodes(c).find((n) => typeof n.className === "string" && /\bpanel-lock-btn\b/.test(n.className));
  const lineOf = (c) => { const s = nodes(c).find((n) => typeof n.className === "string" && /\buc-rank-note\b/.test(n.className)); return s ? flat(s).map((n) => n.text || "").filter(Boolean).join(" | ") : null; };
  const btnOf = (c, a) => nodes(c).find((n) => n.tag === "button" && n.dataset && n.dataset.action === a);
  const retryOf = (c) => nodes(c).find((n) => n.tag === "button" && typeof n.className === "string" && /\buc-retry\b/.test(n.className));
  const unlocked = (c) => !!lockOf(c) && !/\blocked\b/.test(lockOf(c).className);
  const until = async (cond, n) => { for (let i = 0; i < (n || 4000); i++) { if (cond()) return true; await turns(1); } return cond(); };
  // ON A TREE SHAPED LIKE THE DOM (`domShaped`, `ddjp_653`): children an HTMLCollection, with no array methods. Without it this
  // part passed on a card that threw in Chromium at its first paint and never opened (the owner's report at `ddjp_652`).
  const card = (x, who, o) => P.driveCard(Object.assign({ domShaped: true, realRankSelect: true, chromiumFocus: true, unlock: true, Room: x.w.Room, Actions: x.w.sb.Actions,
    member: { userId: who, name: who === THEM ? "Them" : "Other", level: 0 } }, o || {}));
  const pick = (c, level) => { const s = pickerOf(c); s.focus(); s.value = String(level); s.onchange(); };
  for (const [mode, name] of MODES) {
    const x = rankWorld(mode);
    const c = card(x, THEM, { rankName: LABEL });
    x.w.Room.onRankChange(() => c.refresh());
    ok(c.ok && unlocked(c) && pickerOf(c) && !pickerOf(c).disabled && pickerOf(c).children.length > 1, "F " + name + ": PREMISE — the card is open and unlocked, its real picker live", c.stage);
    if (!(c.ok && pickerOf(c))) continue;   // a card that did not open has nothing more to read — its premise says why
    x.hold();
    pick(c, STAFF);
    await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state === "running" && x.w.Room.rankJob().total > 0, 200);
    const sel1 = pickerOf(c);
    ok(unlocked(c), "F " + name + ": A RANK CHOSEN DOES NOT LOCK THE CARD", lockOf(c) && lockOf(c).className);
    ok(sel1 && sel1.disabled && /^Waiting — a rank change for .+ is running \(\d+ of \d+\)$/.test(sel1.title || ""), "F " + name + ": while it runs, its own picker WAITS, greyed, with the progress as its reason", sel1 && sel1.title);
    ok(new RegExp("^Changing to " + LABEL(STAFF) + "… \\d+ of " + x.total(STAFF) + "$").test(lineOf(c) || ""), "F " + name + ": the card says \"Changing to " + LABEL(STAFF) + "… N of M\"", lineOf(c));
    // ANOTHER PERSON'S CARD, opened while it runs: waiting, with the progress.
    const o = card(x, OTHER);
    const oSel = pickerOf(o);
    ok(o.ok && oSel && oSel.disabled && /^Waiting — a rank change for .+ is running \(\d+ of \d+\)$/.test(lineOf(o) || ""), "F " + name + ": ANOTHER PERSON'S CARD WAITS — \"Waiting — a rank change for … is running (N of M)\"", { line: lineOf(o), disabled: oSel && oSel.disabled });
    ok(o.performed.length === 0 && !oSel.onchange, "F " + name + ": and its picker cannot ask for a second change (it is the read-only box)", o.performed);
    // A BURST WHILE IT RUNS updates the line, not the picker.
    const kick0 = btnOf(c, "member.kick");
    for (let i = 0; i < 6; i++) c.refresh();
    ok(btnOf(c, "member.kick") === kick0 && pickerOf(c) === sel1 && c.heldTimers() === 0, "F " + name + ": WHILE IT RUNS, A BURST REDRAWS ONLY THE PROGRESS LINE — no repaint, none queued", { same: btnOf(c, "member.kick") === kick0, held: c.heldTimers() });
    x.release();
    await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running");
    await x.settle(20);
    ok(lineOf(c) === LABEL(STAFF) + " ✓", "F " + name + ": then \"" + LABEL(STAFF) + " ✓\"", lineOf(c));
    ok(unlocked(c) && pickerOf(c) && !pickerOf(c).disabled, "F " + name + ": THE CARD STAYS UNLOCKED BETWEEN CHANGES — the picker is live again with no second unlock", { unlocked: unlocked(c), disabled: pickerOf(c) && pickerOf(c).disabled });
    ok(o.ok && pickerOf(o) && !pickerOf(o).disabled && lineOf(o) === "", "F " + name + ": and the other card is live again, its waiting line gone", { line: lineOf(o), disabled: pickerOf(o) && pickerOf(o).disabled });
    // A BURST AFTER IT, the picker OPEN (focused): one repaint, and the open picker is kept — not replaced, not blurred.
    const sel2 = pickerOf(c);
    sel2.focus();
    ok(c.activeElement() === sel2 && btnOf(c, "member.ban").disabled, "F " + name + ": PREMISE — the picker is open (focused), Remove and Ban held while it is");
    const kick1 = btnOf(c, "member.kick");
    for (let i = 0; i < 8; i++) c.refresh();
    ok(c.heldTimers() === 1 && btnOf(c, "member.kick") === kick1, "F " + name + ": A BURST ASKS FOR ONE REPAINT — eight events, one waiting, none done yet", c.heldTimers());
    c.flushTimers();
    ok(btnOf(c, "member.kick") !== kick1, "F " + name + ": and the one repaint happens", null);
    ok(pickerOf(c) === sel2 && c.activeElement() === sel2 && unlocked(c), "F " + name + ": A REPAINT DURING THE BURST KEEPS THE FOCUSED PICKER OPEN AND THE CARD UNLOCKED", { same: pickerOf(c) === sel2, focused: c.activeElement() === sel2, unlocked: unlocked(c) });
    ok(btnOf(c, "member.ban").disabled && btnOf(c, "member.kick").disabled && unlocked(c) && c.activeElement() === sel2,
      "F " + name + ": and Remove and Ban stay held while it is open, through the repaint (ddjp_477, kept) — held by the open picker, the card unlocked", { ban: btnOf(c, "member.ban").disabled, unlocked: unlocked(c) });
    sel2.blur();
    ok(!btnOf(c, "member.ban").disabled && unlocked(c), "F " + name + ": left, it gives them back — and the card stays unlocked", { ban: btnOf(c, "member.ban").disabled, unlocked: unlocked(c) });
    ok(lineOf(c) === LABEL(STAFF) + " ✓", "F " + name + ": the result line stays until the next change", lineOf(c));
    // CHANGE AGAIN RIGHT AFTER ✓, WITHOUT UNLOCKING.
    pick(c, PLAYER);
    await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().level === PLAYER && x.w.Room.rankJob().state !== "running");
    await x.settle(20);
    ok(c.performed.filter((p) => p.action === "rank.assign").length === 2 && x.level(THEM) === PLAYER && lineOf(c) === LABEL(PLAYER) + " ✓",
      "F " + name + ": CHANGED AGAIN RIGHT AFTER ✓ WITHOUT UNLOCKING — done, \"" + LABEL(PLAYER) + " ✓\"", { line: lineOf(c), level: x.level(THEM) });
    // A CHANGE THAT FAILS: the error names what did not land, with Try again, which is the repair. The room's own level is
    // among what fails, so the card still reads them at their old rank — and Try again must be THIS change, not their rank now.
    x.script.fn = (s) => ((s.kind === "in" && s.roomId === x.ch.chat_staff) || (s.kind === "level" && s.roomId === x.sid) ? { error: e429(2000) } : null);
    pick(c, STAFF);
    await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state === "failed");
    await x.settle(20);
    ok(lineOf(c) === "Not finished — not confirmed: level in the room, " + label("chat_staff") + " | Try again" && retryOf(c) && !retryOf(c).disabled,
      "F " + name + ": AT THE MINUTE — \"Not finished — not confirmed: level in the room, " + label("chat_staff") + "\", with Try again", lineOf(c));
    x.script.fn = null;
    if (retryOf(c)) retryOf(c).onclick();
    await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state === "done");
    await x.settle(20);
    ok(lineOf(c) === LABEL(STAFF) + " ✓" && x.member(THEM, "chat_staff") === "invite" && x.level(THEM) === STAFF, "F " + name + ": TRY AGAIN — the same change again — repairs it", { line: lineOf(c), member: x.member(THEM, "chat_staff"), level: x.level(THEM) });
    // CONTROL: the lock is still a lock. Pressed by hand, the card locks and the picker goes with it (unlocked first, as a
    // person would, if it is not — so this row reads the lock, not the rows above).
    if (!unlocked(c) && lockOf(c)) lockOf(c).onclick();
    const was = unlocked(c);
    if (lockOf(c)) lockOf(c).onclick();
    ok(was && !unlocked(c) && pickerOf(c).disabled, "F " + name + ": CONTROL — the lock button still locks the card by hand", lockOf(c) && lockOf(c).className);
  }

  // ═══ PART G — a pick that starts no change puts its box back (J129, corrected at `ddjp_666`) ════════════════════════════════
  // Found at the milestone review after `ddjp_659`, in both room types: a pick `Room.assignRank` refuses before a change starts
  // repaints nothing, a later repaint keeps the mounted picker (a fresh one's shape is the same), so the box went on showing the
  // refused rank, and picking that rank again fired no change — the select's value was that already. The owner's choice (the
  // supervisor's proposal A): the box that made the pick goes back to the option it was drawn with, for a refusal of any reason,
  // a send that throws, and the locked card's early exit; nothing else changes. Same world, card and picker as PART F, on a tree
  // shaped like the DOM whose select is a browser's (`tests/_domshape.js`): a person's pick (`pickOption`) fires a change only
  // when the value changes, as Chromium does, so a box left on the refused rank is a pick that sends nothing.
  // EVERY REFUSAL, READ FROM THE ROOM'S OWN SOURCE: each `return { ok: false, reason: "…" }` in `assignRank` before its change is
  // created, so a refusal added later is driven, or this part names it. Two reach a card that offered the pick from the real room:
  // "denied" (they hold more in one channel than the people list shows) and "self" (my own card, my level in the space below my
  // level in the channels). Three cannot, and the room's answer is supplied as its source writes it (`ok` and `reason`, the two
  // fields the card reads): "upgrade-first" (the picker offers only levels whose channels all exist, by the same reading the room
  // refuses by), "no-room" (with no room the adapter's own re-check refuses first — no room, no rank — so a card sees a thrown
  // send, driven below) and "rank-change-running" (a change starting repaints every open card's picker to the waiting box).
  const fs = require("fs");
  const { pickOption } = require(path.join(__dirname, "_domshape.js"));
  const shows = (s) => { if (!s) return null; const o = Array.from(s.children || []).find((n) => n.selected); return { value: s.value, text: o ? o.text : null }; };
  const noteOf = (c) => { const n = nodes(c).find((x) => typeof x.className === "string" && /\buc-note\b/.test(x.className)); return n ? (n.text || "") : null; };
  const asks = (c) => c.performed.filter((p) => p.action === "rank.assign").length;
  const rsrc = (P.extractNamed("features/room.js", "assignRank") || {}).source || "";
  const KINDS = Array.from(new Set(Array.from(rsrc.slice(0, Math.max(0, rsrc.indexOf("_rankJob = job;"))).matchAll(/return \{ ok: false, reason: "([a-z-]+)"/g)).map((m) => m[1])));
  ok(rsrc.indexOf("_rankJob = job;") > 0 && KINDS.indexOf("denied") >= 0 && KINDS.indexOf("self") >= 0, "G: PREMISE — the room's refusals are read from `assignRank`'s own source, a known one among them", KINDS);
  // The card's own table of what a refusal says (`REFUSED`, ui/roster.js): what the line read before this correction, unchanged.
  const usrc = (P.extractNamed("ui/roster.js", "openUserCard") || {}).source || "";
  const rt = usrc.match(/const REFUSED = (\{[\s\S]*?\});/);
  let REFUSED = null; try { REFUSED = rt ? Function("return " + rt[1])() : null; } catch (e) { REFUSED = null; }
  ok(REFUSED && typeof REFUSED.denied === "string", "G: PREMISE — the card's REFUSED table is read from ui/roster.js", rt && rt[1]);
  const said = (kind) => (REFUSED && REFUSED[kind]) || "";
  const REAL = {
    denied: { who: THEM, setup: (hs, R) => { const id = Object.values(R.ch)[0]; hs.rooms[id].power.users[THEM] = 100; } },
    self: { who: ME, setup: (hs, R, sid) => { hs.rooms[sid].power.users[ME] = lv("vip"); } },
  };
  for (const [mode, name] of MODES) {
    for (const kind of KINDS) {
      const real = REAL[kind];
      const x = rankWorld(mode, real ? { setup: real.setup } : {});
      const who = real ? real.who : THEM;
      const c = card(x, who, { rankName: LABEL });
      x.w.Room.onRankChange(() => c.refresh());
      const box = pickerOf(c);
      const was = shows(box);
      const theirs = String(x.w.Room.getRoster().find((r) => r.userId === who).level);
      ok(c.ok && unlocked(c) && box && !box.disabled && was && was.value === theirs, "G " + name + " " + kind + ": PREMISE — the card is open and unlocked, its live picker showing their real rank", { stage: c.stage, was, theirs });
      if (!(c.ok && box && !box.disabled)) continue;
      // What the room answered, read on its way back to the adapter.
      const answers = [];
      const roomAssign = x.w.Room.assignRank;
      x.w.Room.assignRank = real ? (...a) => { const p = roomAssign.apply(x.w.Room, a); p.then((v) => answers.push(v), () => answers.push("threw")); return p; }
        : async () => { const v = { ok: false, reason: kind }; answers.push(v); return v; };
      const job0 = JSON.stringify(x.w.Room.rankJob ? x.w.Room.rankJob() : null);
      box.focus();
      const fired = pickOption(box, STAFF);
      await x.settle(20);
      ok(fired && asks(c) === 1 && answers.length === 1 && answers[0].ok === false && answers[0].reason === kind && x.sends.length === 0 &&
        JSON.stringify(x.w.Room.rankJob ? x.w.Room.rankJob() : null) === job0, "G " + name + " " + kind + ": PREMISE — the pick asked once, the room refused it as \"" + kind + "\", nothing was sent and no change started", { fired, asks: asks(c), answers, sends: x.sends.length });
      ok(pickerOf(c) === box && shows(box).value === theirs && shows(box).text === was.text && c.activeElement() === box,
        "G " + name + " " + kind + ": AFTER THE REFUSAL, THE BOX SHOWS THEIR REAL RANK — the same box, still open, not redrawn", { now: shows(box), was, same: pickerOf(c) === box });
      ok(noteOf(c) === said(kind), "G " + name + " " + kind + ": and the reason under it is the card's own, as before" + (said(kind) ? "" : " — this refusal says nothing, as before"), noteOf(c));
      const fired2 = pickOption(pickerOf(c), STAFF);
      await x.settle(20);
      ok(fired2 && asks(c) === 2 && answers.length === 2, "G " + name + " " + kind + ": PICKING THE SAME RANK AGAIN ASKS FOR THE CHANGE AGAIN", { fired: fired2, asks: asks(c), answers: answers.length });
      ok(shows(pickerOf(c)).value === theirs && noteOf(c) === said(kind), "G " + name + " " + kind + ": and the box is back on their rank again, the same reason shown", { now: shows(pickerOf(c)), note: noteOf(c) });
      x.w.Room.assignRank = roomAssign;
    }
    // A SEND THAT THROWS, from the real adapter: my own level drops under the open card before its repaint, so `Actions.perform`'s
    // re-check refuses the pick and its promise rejects (as with no room, or a change running).
    {
      const x = rankWorld(mode);
      const c = card(x, THEM, { rankName: LABEL });
      const box = pickerOf(c);
      const was = shows(box);
      ok(c.ok && box && !box.disabled && was.value === "0", "G " + name + " thrown: PREMISE — the live picker shows their rank", { stage: c.stage, was });
      if (!(c.ok && box && !box.disabled)) continue;
      for (const id of Object.keys(x.hs.rooms)) if (x.hs.rooms[id].power && x.hs.rooms[id].power.users) x.hs.rooms[id].power.users[ME] = lv("vip");
      let threw = null;
      const send = x.w.sb.Actions.perform;
      x.w.sb.Actions.perform = (a, args) => { const p = send(a, args); p.catch((e) => { threw = (e && e.message) || String(e); }); return p; };
      box.focus();
      const fired = pickOption(box, STAFF);
      await x.settle(20);
      ok(fired && asks(c) === 1 && threw && x.sends.length === 0, "G " + name + " thrown: PREMISE — the pick's send threw, nothing sent", { fired, threw, sends: x.sends.length });
      ok(pickerOf(c) === box && shows(box).value === "0" && shows(box).text === was.text, "G " + name + " thrown: AFTER A SEND THAT THROWS, THE BOX SHOWS THEIR REAL RANK", shows(box));
      ok(noteOf(c) === threw, "G " + name + " thrown: and the reason under it is the error's, as before", { note: noteOf(c), threw });
      const fired2 = pickOption(pickerOf(c), STAFF);
      await x.settle(20);
      ok(fired2 && asks(c) === 2 && shows(pickerOf(c)).value === "0", "G " + name + " thrown: PICKING THE SAME RANK AGAIN ASKS AGAIN, and the box is back", { fired: fired2, asks: asks(c), now: shows(pickerOf(c)) });
      x.w.sb.Actions.perform = send;
    }
    // THE LOCKED CARD'S EARLY EXIT. Locked by hand, the picker is the disabled one, so no person can pick on it — this holds the
    // rule at the act: a change reaching it anyway (fired by hand here) sends nothing and leaves the box as drawn.
    {
      const x = rankWorld(mode);
      const c = card(x, THEM, { rankName: LABEL });
      if (lockOf(c)) lockOf(c).onclick();
      const box = pickerOf(c);
      ok(c.ok && !unlocked(c) && box && box.disabled && shows(box).value === "0" && !pickOption(box, STAFF), "G " + name + " locked: PREMISE — locked by hand, the picker is disabled, on their rank, and a person cannot pick on it", { stage: c.stage, now: shows(box) });
      if (box && typeof box.onchange === "function") { box.value = String(STAFF); box.onchange({ type: "change", target: box }); }
      await x.settle(20);
      ok(asks(c) === 0 && box && shows(box).value === "0", "G " + name + " locked: A CHANGE ON THE LOCKED PICKER SENDS NOTHING AND THE BOX GOES BACK", { asks: asks(c), now: shows(box) });
    }
    // CONTROLS. A pick the room takes starts the change as before: its box gives way to the waiting box, and the change ends with
    // the new rank shown. And a box someone holds open after a refusal is not rebuilt by a burst (no redraw after a refusal, J130).
    {
      const x = rankWorld(mode);
      const c = card(x, THEM, { rankName: LABEL });
      x.w.Room.onRankChange(() => c.refresh());
      const box = pickerOf(c);
      if (!(c.ok && box)) { ok(false, "G " + name + " control: the card did not open", c.stage); continue; }
      x.hold();
      box.focus();
      pickOption(box, STAFF);
      await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state === "running", 200);
      ok(pickerOf(c) !== box && pickerOf(c).disabled, "G " + name + " control: AN ACCEPTED PICK STARTS THE CHANGE — its box gives way to the waiting box", { same: pickerOf(c) === box });
      x.release();
      await until(() => x.w.Room.rankJob && x.w.Room.rankJob() && x.w.Room.rankJob().state !== "running");
      await x.settle(20);
      ok(lineOf(c) === LABEL(STAFF) + " ✓" && shows(pickerOf(c)).value === String(STAFF) && !pickerOf(c).disabled && asks(c) === 1,
        "G " + name + " control: and it ends with the new rank in a live box, \"" + LABEL(STAFF) + " ✓\"", { line: lineOf(c), now: shows(pickerOf(c)), asks: asks(c) });
    }
    {
      const x = rankWorld(mode, { setup: REAL.denied.setup });
      const c = card(x, THEM, { rankName: LABEL });
      x.w.Room.onRankChange(() => c.refresh());
      const box = pickerOf(c);
      if (!(c.ok && box)) { ok(false, "G " + name + " held open: the card did not open", c.stage); continue; }
      box.focus();
      pickOption(box, STAFF);
      await x.settle(20);
      for (let i = 0; i < 8; i++) c.refresh();
      c.flushTimers();
      ok(pickerOf(c) === box && c.activeElement() === box && unlocked(c),
        "G " + name + " held open: CONTROL — a box held open after a refusal is not rebuilt by a burst: the same box, still open, the card unlocked", { same: pickerOf(c) === box, focused: c.activeElement() === box });
      ok(shows(box).value === "0", "G " + name + " held open: and through the burst it shows their real rank", shows(box));
    }
    // "no-room" FROM THE REAL ROOM (`ddjp_670`, a part of the job the owner chose). With no room open, `assignRank` asks for the
    // room before anything else that needs one: until then `rankAssignable` came first and answered "upgrade-first" for every
    // rung with no room, so its "no-room" line was never reached and a caller after leaving was told the room needed upgrading.
    // Driven on the real room after a real leave, for every rung of the ladder: "no-room", nothing sent, no change started, and
    // no line about upgrading. (No card reaches it — the adapter refuses first, the "thrown" rows above — so the card's rows
    // still supply it as the source writes it.)
    {
      const x = rankWorld(mode);
      ok(KINDS.indexOf("no-room") >= 0, "G " + name + " no-room: PREMISE — \"no-room\" is still among the refusals read from `assignRank`'s source", KINDS);
      x.w.Room.leave("the guard left");
      await x.settle(10);
      ok(!x.w.Room.getCurrent(), "G " + name + " no-room: PREMISE — the room was left, so none is open", !!x.w.Room.getCurrent());
      const from = x.w.logs.length, n0 = x.sends.length;
      const rungs = P.Ranks.LADDER.map((r) => r.level);
      const got = [];
      for (const lvl of rungs) { const r = await cap(x.w.Room.assignRank(THEM, lvl), 2000); got.push(lvl + ": " + (r.v ? r.v.reason : (r.threw ? "threw" : "timed out"))); }
      ok(rungs.length > 1 && got.every((g) => / no-room$/.test(g)),
        "G " + name + " no-room: WITH NO ROOM OPEN, THE ROOM ANSWERS \"no-room\" — for every rung, never \"upgrade-first\"", got);
      ok(x.sends.length === n0 && (typeof x.w.Room.rankJob !== "function" || x.w.Room.rankJob() === null) && x.line(/upgrade the room first/, from).length === 0,
        "G " + name + " no-room: and nothing is sent, no change starts, and nothing says the room needs upgrading",
        { sent: x.sends.length - n0, job: x.w.Room.rankJob ? x.w.Room.rankJob() : null, lines: x.line(/upgrade/, from) });
    }
  }

  // ═══ THE GUARD'S OWN PROBES, BOTH WAYS ═══════════════════════════════════════════════════════════════════════════════════
  // The card double's focus: removing a focused node fires its blur (Chromium), and only then — otherwise PART F's "kept open"
  // would pass on a double that never blurs anything.
  {
    const x = rankWorld("backend2");
    const c = card(x, THEM);
    const s = pickerOf(c) || { focus() {}, remove() {} };   // a card that did not open: the rows below read red, not a throw
    let blurred = 0; const was = s.onblur; s.onblur = () => { blurred++; if (was) was(); };
    s.focus();
    const parent = nodes(c).find((n) => n.children && Array.from(n.children).indexOf(s) >= 0);
    s.remove();
    ok(blurred === 1 && c.activeElement() === null && parent, "PROBE: the double fires blur when the focused picker is removed", blurred);
    const c2 = card(x, THEM, { chromiumFocus: false });
    const s2 = pickerOf(c2) || { focus() {}, remove() {} }; let b2 = 0; s2.onblur = () => { b2++; }; s2.focus(); s2.remove();
    ok(b2 === 0, "PROBE: and without Chromium's focus nothing blurs — the option is what PART F rests on", b2);
  }
  // The double's select (`ddjp_666`; PART G rests on it): on a DOM-shaped tree its value and its chosen option are one, and a
  // person's pick of the option already chosen fires nothing, as in Chromium; without that a select's value is a plain property
  // beside a choice that never moves, and a box left on a refused rank could not be seen.
  {
    const x = rankWorld("backend1");
    const c = card(x, THEM);
    const s = pickerOf(c) || { children: [] };
    let changes = 0; s.onchange = () => { changes++; };
    const drawn = shows(s);
    const again = pickOption(s, drawn && drawn.value);
    s.value = String(STAFF);
    const chosen = Array.from(s.children).filter((o) => o.selected);
    ok(drawn && drawn.value === "0" && !again && changes === 0 && chosen.length === 1 && chosen[0].value === String(STAFF) && shows(s).value === String(STAFF),
      "PROBE: the double's select is a browser's — its value and its chosen option are one, and re-picking the chosen option fires nothing", { drawn, again, changes, chosen: chosen.map((o) => o.value) });
    ok(pickOption(s, "0") && changes === 1 && shows(s).value === "0", "PROBE: and a person's pick of another option fires one change", changes);
    const c2 = card(x, THEM, { domShaped: false });
    const s2 = pickerOf(c2) || { children: [] };
    s2.value = String(STAFF);
    const kept = Array.from(s2.children).filter((o) => o.selected).map((o) => o.value);
    ok(kept.length === 1 && kept[0] === "0", "PROBE: and without domShaped the value is a plain property and the drawn option stays chosen — the option is what PART G rests on", kept);
  }

  if (failed) { console.log("[rank-change] " + failed + " failure(s) of " + asserts); process.exit(1); }
  console.log("[rank-change] PASS — in a shared room and in a bot room, through the real bridge, room, adapter, card and picker: one rank change at a time on a tab, a second refused by name with nothing sent and every picker waiting with the progress; every step read back before it counts, an invite's 429 waited out as the server said and confirmed, a refusal named, \"already\" answers counted once read back, and what is in place not sent; one minute, then a named error, no \"reconciled\" line, and Try again as the repair; the leave stops a change; the join step only on this account's own move; the card unlocked between changes, a burst one repaint, and a focused picker kept open through it; and a pick that starts no change — refused for any reason, a send that throws, a locked card — puts its box back on the person's real rank, so picking it again asks again (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[rank-change] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
