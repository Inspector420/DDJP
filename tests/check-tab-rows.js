// tests/check-tab-rows.js
// SUBJECT: ui/shell.js, index.html
// WALL: TWO ROWS OF TABS, TIDIED (`ddjp_702`, JOBS 3 and 5; the owner's: "in settings icon, id like logs feed settings to be the same size
// as chat dms people for the tab", "ok tso the logs sub buttons can stay small but logs settings and feed can be big", and "also in the
// queues my queue and history shoudl switch palces"; his words in `main/04-features.md`).
//   G  THE ⚙ PANEL'S TABS ARE THE MAIN TABS — Logs, Feed and Settings wear the main tabs' own rule (`.tabs` / `.tab` / `.tab.active`):
//      the same size, padding, look and blue when chosen, read off the sheet against the main row's own tab rather than written
//      here; their old small look is gone from the sheet. The log tools under Logs keep their small rules.
//   Q  THE QUEUE TABS' ORDER — Room queue · History · My queue · Playlists, in wide, compact and phone (the phone's short labels too,
//      their full names kept as the tooltip).
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`), the sheet read as a browser reads it (DECLARED, its cascade). The pixels are
// Chromium's (`702-REPORT.md`: Logs 13 px, 6 px 14 px, the app's blue when chosen; the queue row one line at 390 px).
// RED FIRST ON 701: the sub-tabs wear their own small look; My queue sits before History.
"use strict";
const path = require("path");
const fs = require("fs");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[tab-rows] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const cls = (n) => String((n && n.className) || "");
const has = (n, c) => cls(n).split(/\s+/).indexOf(c) >= 0;
const kidsOf = (n) => Array.from((n && n.children) || []).filter((c) => c.nodeType === 1);

const prefs = { layout: "wide" };
const features = {
  Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
    getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
  ChatPrefs: { layout: () => prefs.layout, setLayout: (m) => { prefs.layout = m; } },
};
const w = SW.world({ features, domShaped: true });
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Tabs room" }); } catch (e) { /* a stand-in not scripted */ }
const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const css = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// ── G — THE ⚙ PANEL'S TABS ──
{
  const subs = [w.refs.subtabLogs, w.refs.subtabFeed, w.refs.subtabSettings];
  ok(subs.every(Boolean) && subs.map((b) => b.textContent).join() === "Logs,Feed,Settings", "G APPLIED — the ⚙ panel's three tabs were built", subs.map((b) => b && b.textContent));
  const main = w.refs.tabPeople;
  const bar = subs[0] && subs[0].parentNode;
  ok(subs.every((b) => has(b, "tab")) && has(bar, "tabs"), "G: LOGS, FEED AND SETTINGS WEAR THE MAIN TABS' OWN RULE — `.tab` on each, `.tabs` on their row", { subs: subs.map(cls), bar: cls(bar) });
  const props = ["font-size", "padding", "background", "color", "border", "border-radius"];
  const want = props.map((p) => decl(main, p));
  ok(want.every(Boolean) && subs.every((b) => props.every((p, i) => decl(b, p) === want[i])),
    "G: THE SAME SIZE, PADDING AND LOOK AS CHAT, DMs AND PEOPLE — read against the main row's own tab (DECLARED)",
    { main: want, logs: props.map((p) => decl(subs[0], p)) });
  ok(decl(main, "font-size") === "13px" && decl(main, "padding") === "6px 14px", "G PREMISE — the main tab is 13 px, 6 px 14 px", { fs: decl(main, "font-size"), pad: decl(main, "padding") });
  // Chosen: the tab the gear shows wears `active`, and that is the main row's blue.
  w.refs.tabGear.click();
  subs[1].click();
  ok(has(subs[1], "active") && !has(subs[0], "active") && decl(subs[1], "background") === decl(w.refs.tabGear, "background") && decl(subs[1], "background") === "#5865F2",
    "G: CHOSEN, IT IS THE MAIN TABS' BLUE — Feed clicked, Feed blue, as ⚙ above it", { feed: decl(subs[1], "background"), gear: decl(w.refs.tabGear, "background") });
  ok(decl(bar, "gap") === decl(w.refs.tabPeople.parentNode, "gap") && decl(bar, "margin-bottom") === decl(w.refs.tabPeople.parentNode, "margin-bottom"),
    "G: their row spaced as the main row (DECLARED)", { sub: [decl(bar, "gap"), decl(bar, "margin-bottom")], main: [decl(w.refs.tabPeople.parentNode, "gap"), decl(w.refs.tabPeople.parentNode, "margin-bottom")] });
  ok(!/(^|[\s,}])\.subtabs?\s*[{.:,]/m.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "G: their old small look is gone from the sheet, not overridden");
  // Every tool on the logs bar — the level and module pickers, Bot status, History audit, Copy log — each read, not the first.
  const tools = w.refs.logsBar ? Array.from(w.refs.logsBar.querySelectorAll("button, select")) : [];
  const words = tools.map((n) => n.textContent || n.tagName);
  ok(tools.length >= 5 && ["Bot status", "History audit", "Copy log"].every((t) => words.some((x) => x.indexOf(t) >= 0)),
    "G PREMISE — the logs bar's tools were found: the two pickers, Bot status, History audit, Copy log", words);
  ok(tools.every((n) => !has(n, "tab") && decl(n, "font-size") === "11px"),
    "G: THE LOG TOOLS STAY SMALL — each keeps its own 11 px rule, none wears the tabs'", tools.map((n) => [cls(n), decl(n, "font-size")]));
}

// ── Q — THE QUEUE TABS' ORDER ──
{
  const row = w.refs.tabRoom && w.refs.tabRoom.parentNode;
  const words = () => kidsOf(row).map((t) => t.textContent);
  ok(JSON.stringify(words()) === JSON.stringify(["Room queue", "History", "My queue", "Playlists"]), "Q: WIDE — Room queue · History · My queue · Playlists", words());
  for (const mode of ["compact", "phone"]) {
    w.H._setLayout(mode);
    const got = words();
    const want = mode === "phone" ? ["Room Q", "History", "My Q", "Playlists"] : ["Room queue", "History", "My queue", "Playlists"];
    ok(JSON.stringify(got) === JSON.stringify(want), "Q: " + mode.toUpperCase() + " — the same order" + (mode === "phone" ? ", the short labels too" : ""), got);
    if (mode === "phone") {
      ok(w.refs.tabMine.getAttribute("title") === "My queue" && w.refs.tabRoom.getAttribute("title") === "Room queue", "Q: the phone's short labels keep their full names as the tooltip",
        [w.refs.tabRoom.getAttribute("title"), w.refs.tabMine.getAttribute("title")]);
    }
  }
  w.H._setLayout("wide");
  // Each tab still opens its own list (which list it draws is the queue pane's, held elsewhere; not drawn here).
  w.sb.QueuePanels.renderQueuePanel = () => {};
  w.refs.tabHistory.click();
  ok(w.H.queueTab && w.H.queueTab() === "history", "Q: History opens History", w.H.queueTab && w.H.queueTab());
  w.refs.tabMine.click();
  ok(w.H.queueTab && w.H.queueTab() === "mine", "Q: My queue opens My queue", w.H.queueTab && w.H.queueTab());
}

if (failed) { console.log("[tab-rows] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[tab-rows] PASS — two rows of tabs, tidied (`ddjp_702`, JOBS 3 and 5; " + asserts + " assertions): the ⚙ panel's Logs, Feed and Settings " +
  "wear the main tabs' own rule — the size, padding, look and blue of Chat, DMs and People, read against that row's own tab — their old small " +
  "look gone from the sheet, and the log tools keep their small rules; the queue tabs read Room queue · History · My queue · Playlists in wide, " +
  "compact and phone (Room Q · History · My Q · Playlists, full names as tooltips), each opening its own list. Chromium measured the pixels " +
  "(the report)");
process.exit(0);
