// tests/check-dj-card.js
// SUBJECT: ui/player.js, ui/panels.js, ui/roster.js
//
// WALL: THE DJ'S PICTURE ON THE PLAYER'S LINE OPENS THEIR CARD, AND SO DO THE DJ NAMES IN HISTORY (J138; the owner's, his words
//   in `main/04-features.md` §The user card). Live, `?v=605` (his checks 56 and 64): the name next to the player opened the card
//   and its picture did not; History's names did not. Both now go through the one trigger every surface uses
//   (`Roster._wireCardTrigger`). The picture is wired on a bare wrapper, as People's and Chat's are, because the picture node is
//   replaced when an avatar loads or fails (`ui/screens.js` `_applyUrl`, `H.avatarEl`'s `onerror`).
//
//   EXECUTED, not read: the eleven ui/ files loaded whole in the screen world (`tests/_screen-world.js`), the main screen built by
//   their own code, the player's line drawn by the real `renderNowPlaying`, History by the real `renderQueuePanel`, the clicks
//   bubbling through the DOM double, and the card drawn by the real `openUserCard` into the page's body. The feature layer is
//   the only stand-in, answering what the screen reads.
//
//   A  THE PLAYER'S PICTURE: a trigger (a button to a screen reader, a tab stop, the trigger's class); a click on the picture, or
//      Enter on it, draws that DJ's card; the same after the picture is replaced (an avatar arriving); a tick keeps it; the next
//      DJ's picture opens theirs. The name still opens it (the control).
//   B  NOTHING CHANGES IN THE LOOK: the line holds the picture, the name and the time, in that order; the wrapper carries no
//      class but the trigger's and no style; the picture keeps its own size, margin and alignment; the sheet gives the
//      trigger's class a pointer and no box of its own.
//   C  HISTORY'S DJ NAMES: each row's name is a trigger for that row's DJ, and a click or Enter draws that DJ's card; a click
//      elsewhere on the row draws none.
//   D  HISTORY'S RECORD OF WHAT IT DREW (J130) IS UNDISTURBED: the same record as the rows' data alone gives; an event that
//      changes nothing History shows redraws nothing, and the names still open their cards; an event that changes what it
//      shows redraws it once, and the new rows' names open theirs.
"use strict";
const path = require("path");
const S = require(path.join(__dirname, "_screen-world.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[dj-card] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const NOW = 1.9e12;
const LADDER = [{ name: "owner", level: 99 }, { name: "staff", level: 60 }, { name: "player", level: 20 }, { name: "uncategorized", level: 0 }];

async function screen() {
  const st = {
    np: { dj: "@dj:hs", song: { songKey: "NOWPLAYING1" }, pi: "p0", startedAt: NOW - 10000 },
    history: [{ songKey: "HISTSONG001", dj: "@alice:hs", at: NOW - 300000, pi: "h1" },
      { songKey: "HISTSONG002", dj: "@bob:hs", at: NOW - 600000, pi: "h2" },
      { songKey: "HISTSONG003", dj: "@alice:hs", at: NOW - 900000, pi: "h3", cutShortBy: "dj" }],
    levels: { "@dj:hs": 20, "@alice:hs": 60, "@bob:hs": 0, "@carol:hs": 20, "@me:hs": 99 },
  };
  const L = {};
  const listen = (n) => (fn) => { (L[n] = L[n] || []).push(fn); };
  const fire = (n) => { for (const fn of (L[n] || []).slice()) { try { fn(); } catch (e) { /* as features/queue.js `_notify` */ } } };
  const features = {
    Room: { rankLadder: () => LADDER, getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!r:hs" }),
      getRoster: () => Object.keys(st.levels).map((u) => ({ userId: u, level: st.levels[u] })),
      onRankChange: listen("rank"), onMembersChange: listen("members"),
      peopleOrder: (fold, roster) => roster.map((m) => ({ member: m, active: null })) },
    Queue: { onStateChange: listen("queue"), onHistoryChange: listen("history"), getNowPlaying: () => st.np, getRotation: () => [],
      getState: () => ({ counts: {}, rotation: [], nowPlaying: st.np }),
      recentHistory: () => st.history.slice(), historyReach: () => ({ entries: st.history.length, complete: true }) },
    Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
    ServerClock: { serverNow: () => NOW },
    Media: { getAvatarUrl: () => null },
    ChatPrefs: { playerHidden: () => false, overlayBlocked: () => false, tierList: () => [], layout: () => "wide", load() {}, onChange: listen("prefs") },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, onDMRedaction: listen("x"), onDMMessage: listen("x"),
      onDMNotify: listen("x"), onDMChange: listen("x"), onMessage: listen("x"), onRedaction: listen("x") },
  };
  const w = S.world({ features, domShaped: true, clock: NOW });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  let entry = null;
  try { w.sb.Screens.enterMainScreen({ roomId: "!r:hs", spaceId: "!s:hs", name: "Test room" }); } catch (e) { entry = String(e && e.message); }
  const frames = async () => { for (let i = 0; i < 4; i++) { w.frame(); await w.settle(); } };
  const card = () => { const n = w.doc.body.querySelectorAll(".uc-name"); return { count: n.length, name: n.length ? n[0].textContent : null }; };
  const close = () => { try { w.sb.Roster._closeUserCard ? w.sb.Roster._closeUserCard() : null; } catch (e) {} for (const n of Array.from(w.doc.body.querySelectorAll(".uc-name"))) { let p = n; while (p.parent && p.parent !== w.doc.body) p = p.parent; p.remove(); } };
  const enter = (n) => { let stopped = 0; if (n && n.onkeydown) n.onkeydown({ key: "Enter", preventDefault() { stopped++; } }); return stopped; };
  return { w, st, L, fire, frames, card, close, enter, entry };
}
const isTrigger = (n) => !!n && n.attrs && n.attrs.role === "button" && n.attrs.tabindex === "0" &&
  /(^|\s)uc-trigger(\s|$)/.test(n.className) && typeof n.onclick === "function";
const kids = (n) => (n ? Array.from(n.children) : []);

const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);

// ── A — THE PLAYER'S PICTURE ────────────────────────────────────────────────────────────────────────────────────────────────
part("A", async () => {
  const x = await screen(), w = x.w;
  ok(x.entry === null, "A PREMISE — the main screen was entered by the real code", x.entry);
  w.sb.Player.renderNowPlaying();
  const label = w.refs.npLabel;
  const [box, name] = kids(label);
  ok(label && kids(label).length === 2 && name && name.textContent === "dj", "A PREMISE — the player's line drew the DJ: a picture, then the name",
    kids(label).map((c) => c.tag + "." + c.className + ":" + c.textContent));
  const pic = w.refs.npAvatar;
  ok(pic && box && (box === pic || pic.parent === box), "A PREMISE — the line's first item is the DJ's picture, or holds it", { box: box && box.tag, pic: pic && pic.tag });
  const trig = (box === pic) ? pic : box;
  ok(isTrigger(trig), "A: THE PICTURE IS A CARD TRIGGER — a button to a screen reader, a tab stop, the trigger's class, a click to act on",
    trig && { attrs: trig.attrs, cls: trig.className });
  x.close();
  pic.click();
  ok(x.card().count === 1 && x.card().name === "dj", "A: A CLICK ON THE PICTURE DRAWS THAT DJ'S CARD", x.card());
  x.close();
  ok(x.enter(trig) === 1 && x.card().name === "dj", "A: AND SO DOES ENTER ON IT, as on every name", x.card());
  // An avatar arriving: the picture node replaced in place, as `ui/screens.js` `_applyUrl` does it.
  const img = w.doc.createElement("img");
  img.dataset.avatarFor = "@dj:hs";
  pic.replaceWith(img);
  x.close();
  img.click();
  ok(x.card().count === 1 && x.card().name === "dj", "A: AFTER THE PICTURE IS REPLACED (an avatar arriving) A CLICK ON THE NEW ONE STILL DRAWS THE CARD", x.card());
  // A tick: the same DJ, the line not rebuilt.
  w.sb.Player.renderNowPlaying();
  ok(kids(w.refs.npLabel)[0] === box, "A: A TICK KEEPS IT — the same picture's trigger, the line rebuilt only when the DJ changes");
  // The next DJ.
  x.st.np = { dj: "@carol:hs", song: { songKey: "NOWPLAYING2" }, pi: "p1", startedAt: NOW - 1000 };
  w.sb.Player.renderNowPlaying();
  const [box2, name2] = kids(w.refs.npLabel);
  x.close();
  (w.refs.npAvatar || box2).click();
  ok(box2 !== box && name2 && name2.textContent === "carol" && x.card().name === "carol", "A: THE NEXT DJ'S PICTURE OPENS THEIR CARD, not the last one's", x.card());
  x.close();
  name2.click();
  ok(x.card().name === "carol", "A: CONTROL — the name opens it too, as before", x.card());
});

// ── B — NOTHING CHANGES IN THE LOOK ─────────────────────────────────────────────────────────────────────────────────────────
part("B", async () => {
  const x = await screen(), w = x.w;
  w.sb.Player.renderNowPlaying();
  const [box, name, ...rest] = Array.from(w.refs.npLabel.childNodes);
  const pic = w.refs.npAvatar;
  ok(name && name.textContent === "dj" && rest.length === 1 && rest[0].nodeType === 3 && /\d:\d\d/.test(rest[0].textContent),
    "B: THE LINE HOLDS THE PICTURE, THE NAME AND THE TIME, IN THAT ORDER", Array.from(w.refs.npLabel.childNodes).map((c) => c.tag + ":" + c.textContent));
  if (box !== pic) {
    const own = Object.keys(box.style || {}).filter((k) => typeof box.style[k] !== "function" && box.style[k] !== "");
    ok(box.tag === "span" && box.className === "uc-trigger" && own.length === 0,
      "B: THE PICTURE'S WRAPPER IS A BARE SPAN — no class but the trigger's, no style of its own", { tag: box.tag, cls: box.className, style: own });
    ok(kids(box).length === 1 && kids(box)[0] === pic, "B: and it holds the picture alone", kids(box).map((c) => c.tag));
  }
  // The picture's size is its `cssText` (`H.avatarEl`), which this DOM double keeps as written; its margin and alignment are the
  // player's own lines.
  const css = String((pic && pic.style.cssText) || "");
  ok(pic && /width:22px;height:22px;/.test(css) && pic.style.marginRight === "6px" && pic.style.verticalAlign === "middle",
    "B: THE PICTURE KEEPS ITS SIZE, MARGIN AND ALIGNMENT (22 px, 6 px to the name, middle)", pic && { css: css, mr: pic.style.marginRight, va: pic.style.verticalAlign });
  const cas = (n, p) => { const d = w.cas.declared(n, p); return d ? d.val : null; };
  ok(cas(box, "cursor") === "pointer" && !cas(box, "display") && !cas(box, "padding") && !cas(box, "margin") && !cas(box, "border"),
    "B: THE SHEET GIVES THE TRIGGER'S CLASS A POINTER AND NO BOX OF ITS OWN (no display, padding, margin or border)",
    { cursor: cas(box, "cursor"), display: cas(box, "display"), padding: cas(box, "padding"), margin: cas(box, "margin"), border: cas(box, "border") });
});

// ── C — HISTORY'S DJ NAMES ──────────────────────────────────────────────────────────────────────────────────────────────────
part("C", async () => {
  const x = await screen(), w = x.w;
  w.refs.tabHistory.click();
  await x.frames();
  const rows = Array.from(w.refs.queueBody.querySelectorAll(".song-row"));
  const whos = rows.map((r) => r.querySelector(".sr-who"));
  ok(rows.length === 3 && whos.every(Boolean), "C PREMISE — History drew its three rows, each with the DJ's name", whos.map((n) => n && n.textContent));
  ok(whos.map((n) => n && n.textContent).join(",") === "alice,bob,alice", "C PREMISE — newest first, each row its own DJ", whos.map((n) => n && n.textContent));
  ok(whos.every(isTrigger), "C: EVERY HISTORY ROW'S DJ NAME IS A CARD TRIGGER", whos.map((n) => n && { attrs: n.attrs, cls: n.className }));
  const opened = [];
  for (const n of whos) { x.close(); n.click(); opened.push(x.card().count === 1 ? x.card().name : "(" + x.card().count + " cards)"); }
  ok(opened.join(",") === "alice,bob,alice", "C: A CLICK ON EACH DRAWS THAT ROW'S DJ'S CARD", opened);
  x.close();
  ok(x.enter(whos[1]) === 1 && x.card().name === "bob", "C: AND SO DOES ENTER", x.card());
  x.close();
  rows[1].querySelector(".sr-title").click();
  rows[1].querySelector(".hist-ago").click();
  ok(x.card().count === 0, "C: A CLICK ON THE ROW'S TITLE OR AGE DRAWS NO CARD — only the name is the trigger", x.card());
});

// ── D — HISTORY'S RECORD OF WHAT IT DREW (J130) ─────────────────────────────────────────────────────────────────────────────
part("D", async () => {
  const x = await screen(), w = x.w;
  w.refs.tabHistory.click();
  await x.frames();
  const P = w.refs.queueBody;
  const rec = w.sb.Panels.historyRecord();
  const want = JSON.stringify([0, x.st.history.map((h) => [h.pi, h.songKey, h.dj, w.H.shortName(h.dj), w.H.rankColor(w.H._rosterLevel(h.dj)),
    h.at, h.cutShortBy === "dj" ? "skipped" : "", [0, 0]])]);
  ok(rec === want, "D: THE RECORD IS WHAT THE ROWS' DATA ALONE GIVES — the trigger adds nothing to it", { rec, want });
  // THE SAME EVENTS AS THE REDRAW BELOW, with nothing History shows changed: its record decides, so nothing is redrawn.
  const m = w.watch(P);
  x.fire("rank"); x.fire("history");
  await x.frames();
  const r = m.take();
  ok(r.paneRebuilds === 0 && r.rowsBuilt === 0 && r.rowsRemoved === 0, "D: AN EVENT THAT CHANGES NOTHING HISTORY SHOWS REDRAWS NOTHING", r);
  const who0 = P.querySelector(".sr-who");
  x.close(); who0.click();
  ok(x.card().name === "alice", "D: AND THE NAMES STILL OPEN THEIR CARDS", x.card());
  x.st.levels["@bob:hs"] = 60;   // bob's colour changes: History shows it
  const m2 = w.watch(P);
  x.fire("rank"); x.fire("history");
  await x.frames();
  const r2 = m2.take();
  ok(r2.rowsBuilt === 3, "D: AN EVENT THAT CHANGES WHAT IT SHOWS REDRAWS IT ONCE", r2);
  const bob = Array.from(P.querySelectorAll(".sr-who")).find((n) => n.textContent === "bob");
  x.close(); if (bob) bob.click();
  ok(bob && isTrigger(bob) && x.card().name === "bob", "D: AND THE NEW ROWS' NAMES OPEN THEIR CARDS", x.card());
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[dj-card] FAIL — part " + name + " threw: " + ((e && e.stack) || e)); }
  }
  if (failed) { console.log("[dj-card] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[dj-card] PASS — the DJ's picture on the player's line opens their card, and so do the DJ names in History (J138; " +
    asserts + " assertions). Executed in the screen world, the eleven ui/ files whole: the picture is a trigger, and a click or " +
    "Enter draws that DJ's card through the real openUserCard — after the picture is replaced too, a tick keeps it, the next DJ's " +
    "opens theirs; the line holds the picture, the name and the time as before, the picture's wrapper a bare span with the " +
    "trigger's class alone; each History row's name draws that row's DJ's card, and nothing else on the row does; History's " +
    "record of what it drew is the rows' data alone, an event changing nothing redraws nothing, and the names still open cards " +
    "after a redraw.");
})();
