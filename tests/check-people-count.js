// tests/check-people-count.js
// SUBJECT: ui/panels.js, ui/screens.js
// WALL: PEOPLE'S TAB SAYS HOW MANY ARE ACTIVE, LIVE (`ddjp_702`, JOB 6; the owner's: "also the people's tab should say people (0 to 99+) for
// active people previewed in real time in the tab itself"; his words in `main/04-features.md` §Who counts as being around).
//   W  ITS WORDS AND ITS CAP — "People (N)", N from 0 to 99, then "People (99+)"; a count that cannot be read, the plain "People".
//   S  THE SAME COUNT AS PEOPLE'S HEADER — the one fold (`Room.presenceView`), the one count: the tab's N is the header's "N active".
//   E  LIVE WHILE ANOTHER TAB IS SHOWN — something reaching the fold (the app's own change subscription, `Queue.onStateChange`) moves
//      the tab's count with People hidden, and draws nothing of People.
//   K  THROUGH THE TICK THAT KEEPS PEOPLE CURRENT, NO NEW TIMER — time passing with People hidden moves it too (someone ageing out of
//      the window), by the one People refresh, the only interval there is; no room open, it stops.
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`, its virtual clock). Chromium measured "People (99+)" beside ⚙ on one row at
// 390 px (`702-REPORT.md`).
// RED FIRST ON 701: the tab reads "People" whatever the count.
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[people-count] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const T0 = 1.9e12, MIN = 60000;
// People's refresh, read off the panel's own constant, not restated.
const REFRESH = Number((require("fs").readFileSync(path.join(__dirname, "..", "ui/panels.js"), "utf8").match(/const PEOPLE_REFRESH_MS = (\d+);/) || [])[1]) || null;
const fold = (n) => { const people = []; for (let i = 0; i < n; i++) people.push({ userId: "@p" + i + ":hs", lastTs: T0 - MIN, acts: 1 }); return { people, requestedWindowMs: 60 * MIN, effectiveWindowMs: 60 * MIN, reach: 90 * MIN, bounded: false }; };
let current = fold(3);
let room = { roomId: "!s:hs", spaceId: "!s:hs", name: "People room" };
const changes = [];
let rosterDraws = 0;
const features = {
  Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => room, getRoster: () => [], getMyRank: () => 0, getMyAuthorityLevel: () => 0,
    rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [], presenceView: () => current, recentlyActive: () => current },
  Queue: { onStateChange: (fn) => changes.push(fn), onHistoryChange() {} },
  ServerClock: { serverNow: () => T0 },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
  ChatPrefs: { layout: () => "wide", setLayout: () => {} },
};
const w = SW.world({ features, domShaped: true, clock: T0 });
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
(async () => {
  try { w.sb.Screens.enterMainScreen(room); } catch (e) { /* a stand-in not scripted */ }
  const P = w.sb.Panels;
  const tab = () => w.refs.tabPeople && w.refs.tabPeople.textContent;

  // ── W — ITS WORDS AND ITS CAP ──
  ok(typeof P.peopleTabText === "function", "W APPLIED — the tab's words come from one place (`Panels.peopleTabText`)");
  const say = (n) => (typeof P.peopleTabText === "function" ? P.peopleTabText(n) : null);
  ok(say(0) === "People (0)" && say(3) === "People (3)" && say(99) === "People (99)", "W: \"People (N)\" FROM 0 TO 99", [say(0), say(3), say(99)]);
  ok(say(100) === "People (99+)" && say(250) === "People (99+)", "W: THEN \"People (99+)\"", [say(100), say(250)]);
  ok(say(null) === "People" && say(-1) === "People" && say(NaN) === "People", "W: a count that cannot be read — the plain \"People\"", [say(null), say(-1), say(NaN)]);

  // ── S — THE SAME COUNT AS PEOPLE'S HEADER ──
  w.refs.tabPeople.click();
  const head = () => { const n = w.refs.activeBox && w.refs.activeBox.querySelector(".active-count"); return n ? n.textContent : null; };
  ok(head() === "3 active" && tab() === "People (3)", "S: PEOPLE OPEN — the header says \"3 active\", the tab \"People (3)\": one fold, one count", { head: head(), tab: tab() });

  // ── E — LIVE WHILE ANOTHER TAB IS SHOWN ──
  const intervals = () => w.clock.due.filter((t) => t.every > 0);
  const n0 = intervals().length;
  w.refs.tabChat.click();
  const draw = w.sb.Roster.renderRoster;
  w.sb.Roster.renderRoster = function () { rosterDraws++; return draw.apply(this, arguments); };
  current = fold(7);
  ok(changes.length > 0, "E PREMISE — the main screen listens to the room's changes (`Queue.onStateChange`)", changes.length);
  for (const fn of changes) { try { fn({}); } catch (e) { /* the other panes' stand-ins */ } }
  ok(tab() === "People (7)" && rosterDraws === 0, "E: SOMETHING REACHES THE FOLD WITH CHAT SHOWN — the tab reads \"People (7)\", and nothing of People is drawn", { tab: tab(), drawn: rosterDraws });

  // ── K — THROUGH THE ONE TICK ──
  ok(intervals().length === n0 && REFRESH && intervals().filter((t) => t.every === REFRESH).length === 1,
    "K: NO NEW TIMER — People's one refresh runs, and the tab's count added no interval", intervals().map((t) => t.every));
  current = fold(120);
  await w.advance(REFRESH + 1000);
  ok(tab() === "People (99+)" && rosterDraws === 0, "K: TIME PASSES WITH CHAT SHOWN — the refresh's tick counts the tab, \"People (99+)\", and draws nothing of People", { tab: tab(), drawn: rosterDraws });
  current = fold(0);
  await w.advance(REFRESH + 1000);
  ok(tab() === "People (0)", "K: and down to \"People (0)\" the same way", tab());
  room = null;
  await w.advance(REFRESH + 1000);
  ok(intervals().filter((t) => t.every === REFRESH).length === 0, "K: NO ROOM OPEN — the tick stops", intervals().map((t) => t.every));

  if (failed) { console.log("[people-count] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[people-count] PASS — People's tab says how many are active, live (`ddjp_702`, JOB 6; " + asserts + " assertions): \"People (N)\" from 0 " +
    "to 99, then \"People (99+)\" (the plain \"People\" when the count cannot be read); the same count as the header's \"N active\", from the one " +
    "fold; with another tab shown, a change reaching the fold moves it and so does time passing, through People's own refresh — the only " +
    "interval — drawing nothing of People; no room open, the tick stops. Chromium measured \"People (99+)\" beside ⚙ at 390 px (the report)");
  process.exit(0);
})().catch((e) => { ok(false, "threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); console.log("[people-count] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); });
