#!/usr/bin/env node
// tests/check-people-loading.js
// SUBJECT: ui/roster.js, features/room.js, backends/backend1/matrixbridge.js, index.html
//
// WALL: "LOADING PEOPLE…" WHILE THE MEMBERS LOAD (`ddjp_700`, JOB 2; the owner's "2 ok"). Since `ddjp_699` People shows nobody
// until the open room's Space members land (its decision 4), and a read past the transport's wait cannot tell (its decision 3).
// Now the list's place says so: "Loading people…", muted, where the first person would be; past the wait (10 s) "Couldn't load
// people yet — retrying", until they land.
//   PART W — THE WORDS, the real ui/ files in the screen world: People's list holds only the waiting line while the roster is not
//            loaded — "Loading people…" before the wait ends, "Couldn't load people yet — retrying" after — muted, in a person
//            row's box (its height and padding, from the page's own sheet), and the list replaces it when the members land;
//            "Just you so far" is unchanged for a room of one.
//   PART L — THE WAIT AND THE RETRY, the real transport in the invite world, its rooms' members on request, its clock the
//            guard's: a room's load asked, not late before 10 s, late at 10 s, and the member listeners told then (People
//            redraws in the late words); a load that FAILS is not asked again for 10 s — a read meanwhile asks nothing — then the
//            listeners are told and the next read asks again; one that lands is no longer late and its wait's tell is
//            cancelled. And THE ROOM'S WORD: `Room.peopleLate()` reads the open room's Space — false while it waits, true past
//            10 s, false when its members land.
// RED FIRST ON 699: W (People held nothing while it waited) and L (no wait was kept; a failed load was asked again at the next
// read, at once).
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[people-loading] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[people-loading] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const LOADING = "Loading people…", LATE = "Couldn't load people yet — retrying";

// ── W — THE WORDS ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function partW() {
  const NOW = 1.9e12;
  const st = { roster: null, late: false };
  const features = {
    Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getMyRank: () => 0, getMyAuthorityLevel: () => 0,
      getRoster: () => st.roster, peopleLate: () => st.late, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {},
      peopleOrder: (v, roster) => roster.map((m) => ({ member: m, active: null })), presenceView: () => ({ people: [], effectiveWindowMs: 3600000 }), recentlyActive: () => ({ people: [] }) },
    Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
    ChatPrefs: { layout: () => "wide", setLayout() {} },
    Media: { getAvatarUrl: () => null },
    ServerClock: { serverNow: () => NOW },
  };
  const w = SW.world({ features, domShaped: true });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  try { w.H.buildMainDom(w.main, { roomId: "!s:hs", spaceId: "!s:hs", name: "Loading room" }); } catch (e) { /* a stand-in not scripted may throw after the tabs are built */ }
  const box = w.refs.rosterBox;
  const read = () => {
    w.sb.Roster.renderRoster();
    const kids = Array.from(box.children).filter((c) => c.nodeType === 1);
    return { n: kids.length, cls: kids.map((k) => String(k.className)), text: kids.map((k) => k.textContent) };
  };
  ok(!!box, "W PREMISE — People's list box was built by the real code");
  let r = read();
  ok(r.n === 1 && /(^|\s)people-wait(\s|$)/.test(r.cls[0]) && /(^|\s)muted(\s|$)/.test(r.cls[0]) && r.text[0] === LOADING,
    "W: WHILE THE MEMBERS LOAD, PEOPLE SAYS \"" + LOADING + "\" — alone in the list's place, muted", r);
  const wait = Array.from(box.children).find((c) => /people-wait/.test(String(c.className)));
  const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
  ok(wait && decl(wait, "min-height") === "34px" && decl(wait, "padding") === "4px 10px" && decl(wait, "box-sizing") === "border-box" && decl(wait, "align-items") === "center",
    "W: IN A PERSON ROW'S BOX — 34 px high, 4 px 10 px in, its words centred — so they sit where the first name would (DECLARED)",
    wait && { h: decl(wait, "min-height"), pad: decl(wait, "padding"), align: decl(wait, "align-items") });
  ok(wait && decl(wait, "color") === "#888", "W: and muted — the page's muted grey (DECLARED)", wait && decl(wait, "color"));
  st.late = true;
  r = read();
  ok(r.n === 1 && /people-wait/.test(r.cls[0]) && r.text[0] === LATE, "W: PAST THE WAIT, \"" + LATE + "\"", r);
  st.roster = [{ userId: "@ann:hs", name: "ann", level: 0 }, { userId: "@me:hs", name: "me", level: 0 }];
  r = read();
  ok(r.n === 2 && r.cls.every((c) => /(^|\s)person(\s|$)/.test(c)) && !r.cls.some((c) => /people-wait/.test(c)), "W: WHEN THEY LAND, THE LIST REPLACES IT", r);
  st.roster = [];
  r = read();
  ok(r.n === 1 && r.text[0] === "Just you so far", "W: and a room of one still says \"Just you so far\"", r);
}

// ── L — THE WAIT AND THE RETRY ───────────────────────────────────────────────────────────────────────────────────────────────
// A homeserver whose joined rooms hold only this account's member until loaded; each load is answered by the guard (`answer`).
function lazyClient(hs, me) {
  const base = W.clientFor(hs, me);
  const views = Object.create(null), loaded = new Set(), asks = [], pending = [];
  const wrap = (v) => {
    if (!v) return v;
    if (views[v.roomId]) return views[v.roomId];
    const id = v.roomId;
    const partial = () => v.getMyMembership() === "join" && !loaded.has(id);
    return (views[id] = Object.assign(Object.create(v), {
      roomId: id, getMyMembership: () => v.getMyMembership(),
      getMember: (u) => (partial() && u !== me) ? null : v.getMember(u),
      getJoinedMembers: () => partial() ? v.getJoinedMembers().filter((m) => m.userId === me) : v.getJoinedMembers(),
      membersLoaded: () => !partial(),
      loadMembersIfNeeded: () => { asks.push(id); return new Promise((res, rej) => pending.push({ id, land: () => { loaded.add(id); res(true); }, fail: () => rej(Object.assign(new Error("boom"), { errcode: "M_UNKNOWN" })) })); },
    }));
  };
  const client = { getRoom: (id) => wrap(base.client.getRoom(id)), getRooms: () => base.client.getRooms().map(wrap) };
  const answer = (id, how) => { const i = pending.findIndex((p) => p.id === id); if (i < 0) return false; const p = pending.splice(i, 1)[0]; p[how](); return true; };
  return { client, asks, pending, loaded, answer };
}
async function partL() {
  const hs = W.homeserver();
  const SP = "!wait:hs";
  hs.room(SP, { name: "wait", members: { [W.ME]: "join", "@ann:hs": "join", "@bea:hs": "join" } });
  const lc = lazyClient(hs, W.ME);
  const w = W.inviteWorld({ hs, client: lc.client });
  if (!ok(typeof w.MB.membersLate === "function" && typeof w.MB._setMembersClockForTest === "function",
    "L APPLIED — the transport keeps a room's wait (`membersLate`) and lets the guard hold its clock")) return;
  let t = 0;
  const timers = [];
  w.MB._setMembersClockForTest((fn, ms) => { const h = { at: t + ms, fn, live: true }; timers.push(h); return h; }, (h) => { if (h) h.live = false; }, () => t);
  const advance = async (ms) => { t += ms; for (const h of timers.slice()) if (h.live && h.at <= t) { h.live = false; h.fn(); } await settle(); };
  let told = 0;
  w.MB.onMemberChange(() => { told++; });
  const room = () => lc.client.getRoom(SP);
  const read = () => w.MB.membersOf(room(), "joined", "People");
  ok(w.MB.membersLate(SP) === false, "L: NOTHING ASKED YET — not late");
  ok(read() === null && lc.asks.length === 1, "L PREMISE — a read of the room before its members are held cannot tell, and asks their load", { asks: lc.asks });
  await advance(9999);
  ok(w.MB.membersLate(SP) === false && told === 0, "L: BEFORE 10 S, NOT LATE — and nothing told", { late: w.MB.membersLate(SP), told });
  await advance(1);
  ok(w.MB.membersLate(SP) === true && told === 1, "L: AT 10 S, LATE — and the member listeners told once (People redraws in the late words)", { late: w.MB.membersLate(SP), told });
  // the load fails
  lc.answer(SP, "fail"); await settle();
  ok(w.lines(/the members of .* could not be loaded — M_UNKNOWN; asked again in 10 s/).length === 1, "L: A FAILED LOAD IS SAID, AND WHEN IT IS ASKED AGAIN", w.lines(/could not be loaded/));
  read(); read(); await settle();
  ok(lc.asks.length === 1 && w.MB.membersLate(SP) === true, "L: AND IT IS NOT ASKED AGAIN AT ONCE — reads meanwhile ask nothing; still late", { asks: lc.asks.length });
  const toldBefore = told;
  await advance(10000);
  ok(told === toldBefore + 1, "L: 10 S AFTER THE FAILURE THE LISTENERS ARE TOLD", { told, before: toldBefore });
  read(); await settle();
  ok(lc.asks.length === 2, "L: AND THE READ THEY MAKE ASKS AGAIN — retrying, every 10 s, never in a loop", { asks: lc.asks.length });
  // it lands
  const toldLand = told;
  lc.answer(SP, "land"); await settle();
  ok(w.MB.membersLate(SP) === false && told === toldLand + 1 && Array.isArray(read()) && read().length === 3,
    "L: WHEN THEY LAND — not late, the listeners told, the list whole", { late: w.MB.membersLate(SP), told, list: (read() || []).map((m) => m.userId) });
  // A second room: its load lands before the wait ends — the wait's tell is cancelled.
  hs.room("!quick:hs", { name: "quick", members: { [W.ME]: "join", "@ann:hs": "join" } });
  w.MB.membersOf(lc.client.getRoom("!quick:hs"), "joined", "People");
  const toldQ = told;
  lc.answer("!quick:hs", "land"); await settle();
  await advance(20000);
  ok(told === toldQ + 1, "L: A LOAD THAT LANDS IN TIME TELLS ONCE, AND ITS WAIT'S TELL IS CANCELLED", { told, before: toldQ });
}

// THE ROOM'S WORD: the open room's Space, through the real opening.
async function partR() {
  const hs = W.homeserver();
  const R = hs.ddjpRoom("!open:hs", { mode: "backend2", levels: { [W.ME]: 0 } });
  for (const id of ["!open:hs"].concat(Object.values(R.ch))) if (!W.INVITE_ONLY[Object.keys(R.ch).find((k) => R.ch[k] === id)] || id === "!open:hs") hs.rooms[id].members[W.ME] = "join";
  hs.rooms["!open:hs"].members["@ann:hs"] = "join";
  const lc = lazyClient(hs, W.ME);
  const w = W.inviteWorld({ hs, client: lc.client });
  if (!ok(typeof w.Room.peopleLate === "function", "R APPLIED — the room says whether People has waited past the limit (`Room.peopleLate`)")) return;
  ok(w.Room.peopleLate() === false, "R: NO ROOM OPEN — not late");
  let t = 0;
  const timers = [];
  w.MB._setMembersClockForTest((fn, ms) => { const h = { at: t + ms, fn, live: true }; timers.push(h); return h; }, (h) => { if (h) h.live = false; }, () => t);
  const advance = async (ms) => { t += ms; for (const h of timers.slice()) if (h.live && h.at <= t) { h.live = false; h.fn(); } await settle(20); };
  let opened = false;
  const opening = w.Room.join("!open:hs").then(() => { opened = true; }, (e) => { opened = true; w.logs.push("error: join — " + e.message); });
  // The opening runs; every channel's load lands as it is asked, the Space's waits; the guard's clock moves a second at a time
  // until the opening's wait for the Space ends and the room is entered (a cap, so a stuck opening reads as a failure, not a hang).
  // (The opening's own short waits — a channel's 150 ms poll — run in real time in this world, so each step lets real time pass.)
  for (let i = 0; i < 60 && !opened; i++) {
    await new Promise((r) => setTimeout(r, 40));
    await settle(20);
    for (const p of lc.pending.slice()) if (p.id !== "!open:hs") lc.answer(p.id, "land");
    await advance(1000);
  }
  await settle(20);
  void opening;
  ok((w.Room.getCurrent() || {}).spaceId === "!open:hs", "R PREMISE — the room opened, its Space's members still loading", w.lines(/error/));
  ok(w.Room.getRoster() === null && w.Room.peopleLate() === true, "R: PAST THE WAIT, THE OPEN ROOM'S PEOPLE ARE LATE (`Room.peopleLate`)", { roster: w.Room.getRoster(), late: w.Room.peopleLate() });
  lc.answer("!open:hs", "land"); await settle(20);
  ok(w.Room.peopleLate() === false && Array.isArray(w.Room.getRoster()), "R: AND WHEN THEY LAND, NOT LATE — the list", { late: w.Room.peopleLate(), roster: w.Room.getRoster() });
}

(async () => {
  try { partW(); } catch (e) { ok(false, "W threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  for (const [name, fn] of [["L", partL], ["R", partR]]) {
    try { await fn(); } catch (e) { ok(false, name + " threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[people-loading] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[people-loading] PASS — \"" + LOADING + "\" while the members load (`ddjp_700`, JOB 2; " + asserts + " assertions): People's list holds only " +
    "the waiting line, muted, in a person row's box, while the open room's Space members load, and \"" + LATE + "\" past the transport's " +
    "10 s wait; the list replaces it when they land; a room of one still says \"Just you so far\". The transport keeps each room's wait: late " +
    "at 10 s and the member listeners told then; a failed load asked again 10 s later, never at once; a landing tells once and cancels the " +
    "wait's tell; the room's `peopleLate` reads the open room's Space through the real opening");
  process.exit(0);
})();
