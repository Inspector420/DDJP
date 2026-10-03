// tests/check-feed-tab.js
// SUBJECT: ui/panels.js, ui/chat.js, ui/shell.js, ui/queue.js, ui/screens.js, features/room.js
// WALL: the Gear panel's Feed sub-tab (owner rulings, ddjp_447 — main/04-features.md §The event
// feed). It shows EVERY kind the fold narrates, whatever the chat's checkboxes say; it is
// go-forward from the SAME line chat draws; newest at the bottom; at most 500; each row carries its
// how long ago (no clock time — ddjp_463), read against the SHARED server clock and kept fresh while
// visible; it says how far back it reaches, and shows each refused act as refused (ddjp_455).
//
// Driven, not read: real events go through the real ingest door into the real log, the real fold
// narrates them, and the panel's own code — `ui/panels.js` loaded whole — paints them. The row is
// chat's own `_feedRow`, EXTRACTED from `ui/chat.js` and executed, so the tab and chat cannot draw
// an event two ways. Doubles only at the edges: a DOM, the server clock, chat's line, a timer.
//
// THIS GUARD CANNOT TELL YOU THE TAB LOOKS RIGHT OR SCROLLS WELL. Layout, the scroll position a
// browser keeps, and how a row reads are for a person at a screen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const F = require("./_fixtures");
const P = require("./_probe-j14-card.js");

let asserts = 0;
function fail(msg, got) {
  console.log("[feed-tab] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// The same client `check-event-feed` builds: the real backend, the real door, the real fold.
function client() {
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/settingsproof.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js", "features/room.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };
  return sb;
}

// A DOM just rich enough: children, text, dataset, and the three numbers a scroll position is.
const node = (tag) => ({ tag, attrs: {}, text: "", children: [], style: {}, dataset: {}, className: "",
  scrollTop: 0, clientHeight: 100, scrollHeight: 100,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild(c) { this.children.push(c); this.scrollHeight += 20; return c; },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); },
  get firstChild() { return this.children[0] || null; },
  setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
  get textContent() { return this.text; }, set textContent(v) { this.text = String(v); }, remove() {} });
const el = (tag, a, kids) => {
  const n = node(tag);
  if (a) for (const k in a) {
    if (k === "text") n.text = String(a[k]); else if (k === "class") n.className = a[k];
    else if (k === "onclick") n.onclick = a[k]; else n.attrs[k] = String(a[k]);
  }
  if (kids) for (const c of kids) if (c) n.children.push(c);
  return n;
};
const find = (n, pred, out) => { out = out || []; if (!n || typeof n !== "object") return out;
  if (pred(n)) out.push(n); for (const c of (n.children || [])) find(c, pred, out); return out; };
const textOf = (n) => (n.text || "") + (n.children || []).map(textOf).join("");

const rowText = P.extractNamed("ui/chat.js", "_feedRowText");
const rowFn = P.extractNamed("ui/chat.js", "_feedRow");
ok(rowText.ok && rowFn.ok, "APPLIED — chat's feed row is extractable from ui/chat.js", { a: rowText.stage, b: rowFn.stage });
const panelsSrc = code("ui/panels.js");

// The panel, against a client. `view` decides what the right panel shows; `since` is chat's line.
function panel(sb, opts) {
  const o = opts || {};
  const st = { right: "gear", gear: "feed", since: ("since" in o) ? o.since : 0, server: o.server || 0, calls: [], timers: [] };
  const refs = { feedPanel: node("div"), feedHead: node("div"), feedBox: node("div") };
  const ctx = {
    UIBase: { refs, host: { el, clear: (n) => { if (n) n.children = []; }, shortName: (u) => u,
      rightTab: () => st.right, gearTab: () => st.gear } },
    Room: {
      FEED_KINDS: sb.Room.FEED_KINDS,
      recentEvents: (x) => { st.calls.push(JSON.parse(JSON.stringify(x || {}))); return (o.fold || sb.Room.recentEvents)(x); },
    },
    ChatPanels: { feedSince: () => st.since },
    // Reading chat's checkboxes is not this tab's business; a read turns this red rather than passing.
    ChatPrefs: new Proxy({}, { get: (t, k) => { throw new Error("the Feed tab read ChatPrefs." + String(k)); } }),
    ServerClock: { serverNow: () => st.server },
    Roster: { _wireCardTrigger() {} }, Logger: { info() {}, warn() {}, debug() {}, error() {}, on() {} },
    // `ui/panels.js` also holds the LOGS panel, which hydrates the stored log and subscribes to the
    // logger while it LOADS. Stubbed here because they are the logs panel's business, not the feed's.
    Store: { logs: { load: () => Promise.resolve([]), persist() {} } },
    // A device clock wildly off from the server's: an age read from it would be days wrong.
    Date: class extends Date { static now() { return st.server + 3 * 24 * 3600 * 1000; } },
    setInterval: (fn, ms) => { st.timers.push({ fn, ms, live: true }); return st.timers.length; },
    clearInterval: (id) => { if (st.timers[id - 1]) st.timers[id - 1].live = false; },
    setTimeout: () => 0, clearTimeout() {}, console, Math, JSON, Object, Array, String, Number, Promise, Error, Set,
  };
  vm.createContext(ctx);
  vm.runInContext("const H = UIBase.host;\n" + rowText.source + "\n" + rowFn.source +
    "\n;ChatPanels._feedRow = _feedRow;", ctx);
  vm.runInContext(panelsSrc + "\n;globalThis.__P = Panels;", ctx);
  const P2 = ctx.__P;
  ok(typeof P2.renderFeedPanel === "function", "APPLIED — `Panels.renderFeedPanel` exists", Object.keys(P2));
  return {
    st, refs, ctx, render: () => P2.renderFeedPanel(),
    lines: () => find(refs.feedBox, (n) => /\bfeed-line\b/.test(n.className)),
    head: () => textOf(refs.feedHead),
  };
}

// A room with history, then the line, then new acts.
function scene() {
  const sb = client();
  const room = F.playingRoom({ songs: 2 });
  sb.feed(F.sortLog(room.log));
  const line = sb.Room.recentEvents({ limit: 1 }).newestTs;
  const t = line + 60000;
  return { sb, room, line, t, headL: room.lastL };
}

// ═══ PART A — every kind, whatever chat's checkboxes say; go-forward; newest at the bottom ═════
{
  const { sb, room, line, t, headL } = scene();
  sb.feed([
    F.reducerEvent("$vote", headL + 1, t,        "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) }),
    F.reducerEvent("$save", headL + 2, t + 1000, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.save", p: room.pi(0) }),
  ]);
  const before = sb.Room.recentEvents({ limit: 500 });
  ok(before.rows.some((r) => r.ts <= line), "A: APPLIED — the room has history at or before the line", before.rows.length);
  const p = panel(sb, { since: line, server: t + 5 * 60000 });
  p.render();
  const ids = p.lines().map((n) => n.dataset.fid || (find(n, (x) => x.dataset && x.dataset.fid)[0] || {}).dataset.fid);
  ok(ids.join(",") === "$vote,$save",
    "A: GO-FORWARD — only what happened after chat's line, and NEWEST AT THE BOTTOM (the vote before the save)", ids);
  ok(sb.Room.FEED_KINDS["ddjp.dj.vote"].shownByDefault === false,
    "A: PREMISE — an upvote is a kind chat HIDES by default, so its presence here is the tab ignoring the checkboxes");
  ok(p.st.calls.length > 0 && p.st.calls.every((c) => c.limit === 500 && c.since === line),
    "A: the tab asks the fold for the 500 newest after the SAME line chat uses — one line, one rule", p.st.calls);
}

// ═══ PART B — refused acts: left out, and counted since the line only ═══════════════════════════
{
  const { sb, room, line, t, headL } = scene();
  sb.feed([F.reducerEvent("$vote", headL + 1, t, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) })]);
  sb.feed([F.reducerEvent("$deny", headL + 2, t + 2000, "@ply:hs", F.RANK.player, { t: "ddjp.room.settings", s: { maxLen: 400 } })]);
  ok(sb.StreamManager.isLegal("$deny") === false, "B: APPLIED — the reducer refused `$deny`");
  const p = panel(sb, { since: line, server: t + 60000 });
  p.render();
  // RESTATED AT ddjp_455 (owner ruling): the Feed tab SHOWS a refused act — in red, with the room's
  // reason — where it used to leave it out and only count it. Chat still never shows one.
  const bad = p.lines().filter((n) => /\brefused\b/.test(n.className));
  ok(bad.length === 1 && /room settings/.test(textOf(bad[0])), "B: THE REFUSED ACT IS SHOWN, as a refused line", p.lines().map((n) => n.className + ":" + textOf(n)));
  const why = find(bad[0], (n) => /\bfeed-reason\b/.test(n.className))[0];
  ok(why && why.text && !/not-permitted/.test(why.text) && /rank/i.test(why.text),
    "B: with the room's reason IN PLAIN WORDS — not the code the reducer recorded", why && why.text);
  ok(p.lines().filter((n) => !/\brefused\b/.test(n.className)).length === 1, "B: CONTROL — the accepted vote is an ordinary line", null);
  ok(/1 refused act/.test(p.head()) && /red/.test(p.head()), "B: and the head says one was refused and where it is", p.head());
  ok(p.st.calls.every((c) => c.refused === true), "B: the tab asks the fold for refused acts explicitly", p.st.calls);
  // Chat asks for no refused acts — so the default fold, which chat uses, leaves it out.
  const plain = sb.Room.recentEvents({ limit: 500, since: line });
  ok(!plain.rows.some((r) => r.eventId === "$deny") && plain.refused === 1, "B: CHAT'S FOLD STILL LEAVES IT OUT — it asks for no refused acts", plain.rows.map((r) => r.eventId));
  // Control: the same refused act BEFORE the line is not this tab's to count.
  const p2 = panel(sb, { since: t + 5000, server: t + 60000 });
  p2.render();
  ok(!/refused/.test(p2.head()), "B CONTROL: a refused act before the line is not counted here", p2.head());
}

// ═══ PART C — the time on a row: how long ago only, from the SERVER clock, kept fresh ═════════════
{
  const { sb, room, line, t, headL } = scene();
  sb.feed([F.reducerEvent("$vote", headL + 1, t, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) })]);
  const p = panel(sb, { since: line, server: t + 5 * 60000 });
  p.render();
  const line0 = p.lines()[0];
  ok(line0, "C: APPLIED — one row rendered");
  // RESTATED AT ddjp_463 (owner ruling): the row shows HOW LONG AGO only — no clock time. The ddjp_447
  // ruling asked for both; the owner narrowed it.
  const d = new Date(t), pad = (n) => String(n).padStart(2, "0");
  const clock = pad(d.getHours()) + ":" + pad(d.getMinutes());
  ok(textOf(line0).indexOf(clock) < 0 && !/\d{2}:\d{2}/.test(textOf(line0)),
    "C: THE ROW SHOWS NO CLOCK TIME — how long ago only (owner ruling, ddjp_463)", textOf(line0));
  const ago = find(line0, (n) => /\bfeed-ago\b/.test(n.className))[0];
  ok(ago && ago.text === "5 mins ago",
    "C: and HOW LONG AGO, against the SERVER clock — the device clock here is three days off, so an age read " +
    "from it would say days", ago && ago.text);
  const live = p.st.timers.filter((x) => x.live);
  ok(live.length === 1, "C: a refresh timer runs while the tab is visible", p.st.timers);
  p.st.server = t + 65 * 60000;
  live[0].fn();
  ok(ago.text === "1 hr ago", "C: THE AGE STAYS TRUE — the timer rewrites it in place as the server clock moves", ago.text);
  ok(p.lines()[0] === line0, "C: in place, not by rebuilding the list", null);
}

// ═══ PART D — hidden costs nothing; the cap is stated; the empty and not-started cases say why ══
{
  const { sb, room, line, t, headL } = scene();
  sb.feed([F.reducerEvent("$vote", headL + 1, t, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) })]);
  const p = panel(sb, { since: line, server: t + 60000 });
  p.st.gear = "logs";
  p.render();
  ok(p.st.calls.length === 0 && p.lines().length === 0 && p.st.timers.length === 0,
    "D: WHILE HIDDEN it reads nothing, paints nothing and starts no timer", { calls: p.st.calls.length, timers: p.st.timers.length });
  p.st.right = "chat"; p.st.gear = "feed";
  p.render();
  ok(p.st.calls.length === 0, "D: and the Feed sub-tab behind another right-panel tab is hidden too", p.st.calls.length);
  p.st.right = "gear"; p.render();
  ok(p.lines().length === 1, "D: CONTROL — shown, it paints", p.lines().length);
  // The timer stops itself once the tab is left.
  p.st.gear = "settings";
  const live = p.st.timers.filter((x) => x.live);
  if (live.length) live[0].fn();
  ok(p.st.timers.every((x) => !x.live), "D: and its refresh timer stops once the tab is no longer visible", p.st.timers);

  // Truncation is stated, from the fold's own flag.
  const fake = () => ({ rows: [{ eventId: "$x", type: "ddjp.dj.vote", verb: "upvoted the song", sender: "@a:hs", ts: t, l: 1 }],
    total: 900, truncated: true, limit: 500, refused: 0, newestTs: t, oldestTs: t, origin: "held" });
  const pc = panel(sb, { since: line, server: t + 60000, fold: fake });
  pc.render();
  ok(/newest 500/.test(pc.head()), "D: a truncated feed says it shows the newest 500", pc.head());

  // Nothing since the line: said, with the line's time.
  const pe = panel(client(), { since: line, server: line + 60000 });
  pe.render();
  ok(/Nothing has happened since/.test(pe.head()) && pe.lines().length === 0, "D: an empty go-forward feed says why", pe.head());
  // Chat has not started: there is no line yet, and the tab says so rather than showing history.
  const pn = panel(sb, { since: null, server: t });
  pn.render();
  ok(/starts when/.test(pn.head()) && pn.lines().length === 0, "D: before chat's line exists the tab shows nothing, and says so", pn.head());
}

// ═══ PART E — live: a new act appears on the next re-derive render ═════════════════
{
  const { sb, room, line, t, headL } = scene();
  sb.feed([F.reducerEvent("$vote", headL + 1, t, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) })]);
  const p = panel(sb, { since: line, server: t + 60000 });
  p.render();
  ok(p.lines().length === 1, "E: APPLIED — one row");
  sb.feed([F.reducerEvent("$save", headL + 2, t + 1000, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.save", p: room.pi(0) })]);
  p.render();
  ok(p.lines().length === 2, "E: A NEW ACT APPEARS on the next re-derive render — derived, not accumulated", p.lines().length);
}

// ═══ PART F — the wiring, and the old ruling that still stands (TEXTUAL, and says so) ═══════════
{
  const shell = code("ui/shell.js"), queue = code("ui/queue.js"), screens = code("ui/screens.js"), chat = code("ui/chat.js");
  const sub = shell.slice(shell.indexOf("refs.subtabLogs = el("), shell.indexOf("refs.gear = el("));
  const order = ["subtabLogs", "subtabFeed", "subtabSettings"].map((n) => sub.indexOf("refs." + n + " = el("));
  ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], "F: the sub-tabs are Logs · Feed · Settings", order);
  ok(!/refs\.tabFeed\b/.test(shell), "F: and there is still NO top-row Feed tab — the ddjp_425 ruling stands");
  ok(/refs\.feedPanel/.test(queue) && /"feed"/.test(queue), "F: `_renderGear` shows the feed panel for the feed sub-tab");
  const onState = (screens.match(/Queue\.onStateChange\(\(\) => \{[^\n]*\}\);/) || [""])[0];
  ok(/Panels\.renderFeedPanel\(\)/.test(onState), "F: it re-renders on the re-derive announcement, like chat's feed", onState.slice(0, 120));
  const readFeed = chat.slice(chat.indexOf("function _readFeed("), chat.indexOf("function renderChat("));
  ok(/since:\s*m\.feedFromTs/.test(readFeed) && !/\.filter\(/.test(readFeed),
    "F: chat asks the fold for rows after its line too — `since` is the one rule, not a second filter", readFeed.slice(0, 200));
}

// ═══ PART G — EVERY "how long ago" on screen reads the SERVER clock (ddjp_448) ══════════════════
// `_fmtAgo`'s `now` used to DEFAULT to the device clock, and the DM list relied on it against a
// server stamp — README.md's second trap. The fix is the SHAPE of the function: no default, so a
// caller with no server time gets no age rather than a wrong one, and one helper reads the clock.
{
  const { sb } = scene();
  const p = panel(sb, { since: 0, server: 10 * 86400000 });
  const Pn = vm.runInContext("Panels", p.ctx);
  const at = p.st.server - 5 * 60000;
  ok(Pn._fmtAgo(at) === "", "G: `_fmtAgo` with no `now` gives NO age — the device clock (three days off here) is never a default", Pn._fmtAgo(at));
  ok(Pn._fmtAgo(at, p.st.server) === "5 mins ago", "G: CONTROL — given the server's now, it answers", Pn._fmtAgo(at, p.st.server));
  ok(typeof Pn.agoFromServer === "function" && Pn.agoFromServer(at) === "5 mins ago",
    "G: `agoFromServer` reads the SERVER clock, not the device's", Pn.agoFromServer && Pn.agoFromServer(at));
  p.st.server = 0;
  ok(Pn.agoFromServer(at) === "", "G: and with no server time yet it gives no age rather than guessing", Pn.agoFromServer(at));
  // The population, derived rather than listed: every call in ui/ either uses the helper or hands
  // `_fmtAgo` a second argument. TEXTUAL, and it says so — the behaviour is driven above.
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, "ui")).filter((x) => x.endsWith(".js"))) {
    const src = code("ui/" + f).replace(/\/\/[^\n]*/g, "");
    for (const m of src.matchAll(/_fmtAgo\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      if (/^\s*at\s*,\s*now\s*$/.test(m[1])) continue;                  // its own declaration
      if (m[1].split(",").length < 2) offenders.push(f + ": _fmtAgo(" + m[1] + ")");
    }
  }
  ok(offenders.length === 0, "G: no caller in ui/ hands `_fmtAgo` a stamp without a clock", offenders);
  ok(/Panels\.agoFromServer\(r\.lastTs\)/.test(code("ui/chat.js")), "G: the DM list's age is `agoFromServer` — the call that had the trap");
}

// ═══ PART H — past a month it says MONTHS, past a year YEARS (owner ruling, ddjp_485) ═════════════════
// "N days ago" ran on without end — "400 days ago" is a number nobody reads. One formatter serves every
// "how long ago" on screen (the Feed, chat and DM rows, People), so they all change together. A month is
// 30 days, kept to 1–11 so it never says "0 months" or "12 months"; a year is 365 days.
{
  const { sb } = scene();
  const p = panel(sb, { since: 0, server: 10 * 86400000 });
  const Pn = vm.runInContext("Panels", p.ctx);
  const now = 1e12, D = 86400000, at = (d) => Pn._fmtAgo(now - d * D, now);
  ok(at(1) === "1 day ago" && at(29) === "29 days ago", "H: under 30 days it still counts days", [at(1), at(29)]);
  ok(at(30) === "1 month ago" && at(59) === "1 month ago" && at(60) === "2 months ago", "H: from 30 days it says MONTHS, one per 30 days", [at(30), at(59), at(60)]);
  ok(at(364) === "11 months ago", "H: and never \"12 months\" — 364 days is still eleven", at(364));
  ok(at(365) === "1 year ago" && at(730) === "2 years ago", "H: from 365 days it says YEARS", [at(365), at(730)]);
  const odd = [];
  for (let d = 30; d < 365; d++) if (!/^(1[01]|[1-9]) months? ago$/.test(at(d)) || (at(d) === "1 months ago")) odd.push(d + ": " + at(d));
  ok(odd.length === 0, "H: every age from 30 to 364 days is 1–11 months, singular only for one — never 0 or 12", odd.slice(0, 5));
  ok(Pn._fmtAgo(now - 5 * 60000, now) === "5 mins ago" && Pn._fmtAgo(now - 3 * 3600000, now) === "3 hrs ago", "H: CONTROL — minutes and hours read as before");
}

console.log("[feed-tab] PASS — the Gear panel's Feed sub-tab (" + asserts + " assertions). Real events through the real door " +
  "and the real fold, painted by `ui/panels.js` loaded whole with chat's own row builder: it shows every kind the fold " +
  "narrates — an upvote chat hides by default included — without reading chat's checkboxes at all; it is go-forward from " +
  "the SAME line chat uses, asked of the fold as `since` so there is one rule; newest at the bottom; the 500 newest, and " +
  "says so when there are more. Refused acts are shown and counted since the line only. Each row shows how long ago " +
  "— no clock time, by ruling — against the SERVER clock — the device clock here is three days off — and a timer keeps the age true " +
  "in place while the tab is visible and stops when it is not; past a month it says months, past a year years. Hidden, it reads and paints nothing. The top-row Feed tab " +
  "is still gone. THIS GUARD CANNOT TELL YOU HOW THE TAB LOOKS OR SCROLLS");
process.exit(0);
