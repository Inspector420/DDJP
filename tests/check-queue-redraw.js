// tests/check-queue-redraw.js
// SUBJECT: ui/queue.js, ui/playlists.js, ui/panels.js, ui/screens.js, ui/chat.js, index.html, features/queue.js, backends/backend1/history.js, backends/backend1/matrixbridge.js
// WALL: J130 — THE LISTS STOP FLICKERING (the owner's decisions, `ddjp_653`; built `ddjp_654`).
//
//   PART A — the room queue: a room event that changes nothing it shows redraws nothing; one that changes something redraws it
//            once, and the change is on screen at once. Every value it draws, changed alone, redraws it once; a change it
//            does not draw redraws nothing — so its record of what it drew is the screen's, in both directions.
//   PART B — Playlists, the library and inside a playlist, ignore room events entirely.
//   PART C — My queue redraws once per change: one DJ event (both features hear it) is one redraw of one window of rows;
//            the settle timer's notify, a vote and a rank change, changing nothing it shows, redraw nothing. Only the list
//            under the add line is redrawn, so a typed link, the focus and the "Added" note survive (the owner, `ddjp_653`).
//   PART D — a redrawn row keeps its title (the held one, at once) and its picture (the same object URL); no object URL is
//            made per redraw, and the live ones stay within the blob cache, each released as its video leaves it.
//   PART E — the playlists library keeps its scroll across a redraw and coming back from inside a playlist; the Playlists
//            tab opens it at the top, as the other tabs (the owner, `ddjp_653`).
//   PART F — timed displays still update: the strike cooldown greys at once and re-enables at its end; the room queue's
//            5-second unlock runs on through a room event and re-locks in place. F STANDS THE QUEUE IN and sets the strike's
//            time BEFORE the event, so it reads the screen and cannot see the order the room tells things in: in the app
//            ✕🎵 stayed live (a reviewer, after `ddjp_659`) while F was green. PART I is the strike as the room delivers it.
//   PART G — the windowed stack paints once per render: the next frame's and the scroll restore's repaints build nothing,
//            a scroll inside the window builds nothing, a scroll event from a replaced list paints nothing, and the
//            browser's scroll anchoring is off on it; it counts each row at the height it is drawn (the owner: "58 drawn, 44
//            counted"), and draws it at the height every song row is drawn, 48 px. CORRECTED AT `ddjp_656`: "fixed with no
//            change in how it looks" was read through a reader that lost the page's `* { box-sizing: border-box }` — in a
//            browser the rows were 44 px, and J130's 58 made them taller; the owner chose 48, between, for every list.
//   PART H — inside a playlist, the owner's own actions draw from the record last read and reconcile when the read lands:
//            the list never empties (the owner, `ddjp_653`).
//   PART I — a strike the ROOM delivers greys ✕🎵 at once, in both orders the app subscribes in, from the strike's server
//            stamp, and its own timer brings it back: the real `features/queue.js`, `UserQueue` and backend1's
//            `StreamManager` and reducer, delivering into this same room queue (added at `ddjp_661`, J130's correction).
//   PART J — SONG HISTORY'S NOTICE, A SHARED ROOM (added at `ddjp_662`, J130's correction): on a page's first room — the
//            queue's notice before the play's refresh, witnessed — a new song is at the top of History at once, redrawn once;
//            after a real rewire too (the control, green on 661); a song that started while the tab was away is there as soon
//            as the tab is settled again; a leave tells nothing, and after it, in another room, the notice still arrives.
//   PART K — A BOT ROOM: the bot's save point moves the device on and the engine hands song history the stretch — one notice,
//            the record read once, nothing redrawn (nothing it shows changed); a song while away, there once settled.
//   PART L — the notice itself, on the real `History` in a room's world: after the write; one per operation, never per row or
//            stretch, an async one when it settles; nothing written, nothing told; a reset quiet, its listeners kept.
//            PARTs J–L are the real engine, `History`, the bridge, `features/room.js` and `features/queue.js` (`tests/_botroom.js`,
//            through its options), into this pane through `globals`.
//
// DRIVEN, ON A TREE SHAPED LIKE THE DOM. `tests/_screen-world.js` loads all eleven ui/ files WHOLE; the main screen is
// entered through the real `Screens.enterMainScreen`, so the triggers are the ones `_wireMainOnce` wires, and each room
// event is delivered as the feature layer delivers it — every listener, in order, each in its own try. `domShaped` gives
// the tree a browser's shape (children an HTMLCollection, no array methods), frames, and a scroll event at the next frame;
// `clock` a virtual clock. What is measured is what a MutationObserver sees on the queue pane: rebuilds of the pane's own
// child list, song rows put in and taken out, and nothing else changed. The same counts are read in real Chromium by the
// screen drive recorded in `docs/HANDOFF.md` (J130). The feature layer is stood in, except in PARTs I–L, where the queue's
// feature and the room's delivery are the real ones (`pane`'s `globals`).
//
// THE ROOM SETTINGS PANEL IS STOOD IN FOR (a no-op render): it is not this guard's subject, its rows read a room's whole
// settings record, and the rank listener reaches it AFTER the queue pane. Every part's premise includes that each listener
// it fired ran to its end — a count read after a listener threw is no count.

"use strict";
const S = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[queue-redraw] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const NOW = 1.9e12;
const V = (p, i) => (p + "_" + String(i)).padEnd(11, "x").slice(0, 11);
const LADDER = [{ name: "owner", level: 99 }, { name: "high-staff", level: 80 }, { name: "staff", level: 60 }, { name: "vip", level: 40 },
  { name: "player", level: 20 }, { name: "guest", level: 10 }, { name: "uncategorized", level: 0 }];

// ── THE PANE, ENTERED ─────────────────────────────────────────────────────────────────────────
async function pane(opts) {
  const o = opts || {};
  const st = {
    np: { dj: "@dj:hs", song: { videoId: V("np", 0) }, pi: "p0" },
    rotation: Array.from({ length: 6 }, (_, i) => ({ user: "@dj" + i + ":hs", pending: [{ videoId: V("rq", i) }, { videoId: V("rn", i) }] })),
    counts: { p0: { votes: 2, saves: 1 } }, saved: false, voted: false,
    levels: { "@dj:hs": 20, "@dj0:hs": 20, "@dj1:hs": 40, "@dj2:hs": 20, "@dj3:hs": 60, "@dj4:hs": 20, "@dj5:hs": 10, "@me:hs": 60 },
    perms: { "dj.reset": true, "dj.move": true, "dj.strike": true, "dj.remove": true }, permFor: {}, lastStrike: {},
    mine: Array.from({ length: o.mine === undefined ? 40 : o.mine }, (_, i) => ({ eid: "e" + i, videoId: V("mq", i) })),
    slots: ["green", "green"], active: false,
    history: Array.from({ length: 30 }, (_, i) => ({ videoId: V("hi", i), dj: "@dj" + (i % 6) + ":hs", at: NOW - (i + 1) * 240000, pi: "h" + i })),
    reach: { entries: 30, complete: true },
    playlists: Array.from({ length: 60 }, (_, i) => ({ id: "pl" + i, name: "List " + String(i).padStart(2, "0") })),
    tracks: {}, held: {}, reads: 0,
  };
  const L = {}, errors = [];
  const listen = (n) => (fn) => { (L[n] = L[n] || []).push(fn); };
  // AS THE FEATURES DELIVER: every listener in order, each in its own try (features/queue.js `_notify` catches per listener).
  const fire = (n) => { for (const fn of (L[n] || []).slice()) { try { fn(); } catch (e) { errors.push(n + ": " + String(e && e.message)); } } return (L[n] || []).length; };
  let w = null;
  const later = (v, ms) => new Promise((res) => w.sb.setTimeout(() => res(typeof v === "function" ? v() : v), ms || 40));
  const meta = (vid) => () => (st.held[vid] = { title: "Title of " + vid, durationSec: 200 });
  const blob = (vid) => ({ vid, type: "image/png", size: 120 });
  // THE BROWSER'S OBJECT URLs, COUNTED: made, and released.
  const urls = { made: [], revoked: new Set(), n: 0 };
  const URLD = { createObjectURL: (b) => { const u = "blob:double/" + (++urls.n); urls.made.push({ u, vid: b && b.vid }); return u; },
    revokeObjectURL: (u) => { urls.revoked.add(u); } };
  // AN IntersectionObserver THE GUARD SCROLLS INTO VIEW: every connected target it observes intersects on `intersect()`.
  const ios = [];
  function IO(cb) { const me = { cb, targets: new Set(), observe(t) { me.targets.add(t); }, unobserve(t) { me.targets.delete(t); }, disconnect() { me.targets.clear(); me.dead = true; } }; ios.push(me); return me; }
  const intersect = () => { for (const io of ios) if (!io.dead) { const es = Array.from(io.targets).filter((t) => t.isConnected).map((t) => ({ target: t, isIntersecting: true })); if (es.length) io.cb(es); } };
  const describe = (a, t) => {
    const who = t && t.userId;
    const pf = st.permFor[a] && who ? st.permFor[a][who] : undefined;
    if (pf !== undefined) return { enabled: false, reason: pf };
    return st.perms[a] ? { enabled: true, reason: null } : { enabled: false, reason: "Not permitted" };
  };
  const features = {
    Room: { rankLadder: () => LADDER, getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!r:hs" }),
      getRoster: () => Object.keys(st.levels).map((u) => ({ userId: u, level: st.levels[u] })),
      onRankChange: listen("rank"), onMembersChange: listen("members"),
      // The People list's order, as ui/roster.js falls back to it when the feature has none.
      peopleOrder: (fold, roster) => roster.map((m) => ({ member: m, active: null })) },
    Queue: { onStateChange: listen("queue"), onHistoryChange: listen("history"), getNowPlaying: () => st.np, getRotation: () => st.rotation,
      getState: () => ({ counts: st.counts, rotation: st.rotation, nowPlaying: st.np }),
      lastStrikeTs: (u) => st.lastStrike[u] || 0, STRIKE_COOLDOWN_MS: 3000,
      recentHistory: () => st.history.slice(), historyReach: () => st.reach },
    UserQueue: { onChange: listen("mine"), items: () => st.mine.slice(), count: () => st.mine.length, isActive: () => st.active, stackCount: () => 0,
      slotState: (i) => (i >= 0 && i < Math.min(2, st.mine.length) ? st.slots[i] : null),
      // ADD, AS THE FEATURE DOES IT: the entry is pushed and its listeners told SYNCHRONOUSLY (`_kick` → `_notify`), then it answers.
      // CHANGED ON PURPOSE (`ddjp_678`): a world may refuse the add (`st.refuse`, its reason), as the feature does a bad link.
      add: (v) => { if (st.refuse) return { ok: false, reason: st.refuse };
        const id = String(v).slice(-11); st.mine.push({ eid: "e" + st.mine.length, videoId: id }); fire("mine"); return { ok: true, videoId: id }; } },
    Reactions: { onChange: listen("reactions"), hasSaved: () => st.saved, hasVoted: () => st.voted, vote() {} },
    // A ▲ PRESSED: the feature latches it as it lands (the room's echo is the guard's own `fire("reactions")`).
    Actions: { describe, perform: (a) => { if (a === "react.vote") { st.voted = true; st.counts.p0.votes++; if (st.echoFirst) st.echoFirst(); } return Promise.resolve({ ok: true }); } },
    Store: { meta: { peek: (vid) => st.held[vid] || null, load: (vid) => later(meta(vid)) }, images: { load: (vid) => later(() => blob(vid)) } },
    Playlists: { init() {}, list: () => st.playlists.slice(), onChange: listen("playlists"), offChange() {},
      get: (id) => { st.reads++; return later(() => ({ id, name: "List " + id, tracks: (st.tracks[id] || (st.tracks[id] = Array.from({ length: 80 }, (_, i) => ({ videoId: V("pt", i) })))).slice() })); },
      removeTrack: (id, vid) => { st.tracks[id] = (st.tracks[id] || []).filter((t) => t.videoId !== vid); return later({ ok: true }); } },
    ServerClock: { serverNow: () => w.clock.now },
    Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, onDMRedaction: listen("x"), onDMMessage: listen("x"),
      onDMNotify: listen("x"), onDMChange: listen("x"), onMessage: listen("x"), onRedaction: listen("x") },
    ChatPrefs: { videoHidden: () => false, overlayBlocked: () => false, tierList: () => [], layout: () => "wide", load() {}, onChange: listen("prefs") },
  };
  const MetadataService = { get: (vid) => later(meta(vid)), ensure: (vid) => later(meta(vid)), thumbUrl: () => null, ensureThumb: (vid) => later(() => blob(vid)) };
  // `o.globals` lays a REAL module over its stand-in (PART I: the queue's feature, delivering from the real door).
  w = S.world({ features, domShaped: true, clock: NOW, globals: Object.assign({ URL: URLD, IntersectionObserver: IO, MetadataService }, o.globals || {}) });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  let entry = null;
  try { w.sb.Screens.enterMainScreen({ roomId: "!r:hs", spaceId: "!s:hs", name: "Test room" }); } catch (e) { entry = String(e && e.message); }
  const P = w.refs.queueBody;
  const x = {
    w, st, L, fire, errors, urls, intersect, entry, P,
    rows: () => Array.from(P.querySelectorAll(".song-row")),
    titles: () => x.rows().map((r) => (r.querySelector(".sr-title") || {}).textContent),
    srcs: () => x.rows().map((r) => { const i = r.querySelector("img.thumb"); return i ? (i.getAttribute("src") || "") : null; }),
    // The rows drawn, their titles held and their pictures loaded: the time a room takes, then the pictures scrolled in — the
    // loader's dwell (250 ms) and its three-wide pump through every row (a stored read is 40 ms here) — and the frames after.
    async settle() { await w.advance(100); await x.frames(); intersect(); await w.advance(1500); await x.frames(); await w.advance(50); },
    async frames() { for (let i = 0; i < 4; i++) { w.frame(); await w.settle(); } },
    async tab(name) { w.refs[{ room: "tabRoom", mine: "tabMine", history: "tabHistory", playlists: "tabPlaylists" }[name]].click(); await x.settle(); },
    // A ROOM EVENT AND WHAT IT DID TO THE PANE, frames included (a stack's repaints land in them).
    async event(...names) {
      const e0 = errors.length;
      const m = w.watch(P);
      for (const n of names) fire(n);
      await x.frames();
      const r = m.take();
      r.threw = errors.slice(e0);
      return r;
    },
  };
  return x;
}
// WHAT THE PANE SHOWS, AS A STRING — everything drawn but the parts that fill in on their own (a title, a duration and a
// picture arriving from the cache, an age's words) and the in-place timers' phase. Two renders of one state read the same.
function shows(node) {
  const out = [];
  (function walk(n, d) {
    if (n.nodeType === 3) { out.push(d + "#" + n.textContent); return; }
    if (n.matches(".sr-title, .sr-dur, .hist-ago")) { out.push(d + "<" + n.tag + "." + n.className + ">"); return; }
    const cls = n.className.split(/\s+/).filter((c) => c && c !== "loaded" && c !== "instant").join(".");
    const at = Object.keys(n.attrs).filter((k) => k !== "src").sort().map((k) => k + "=" + n.attrs[k]).join(",");
    out.push(d + "<" + n.tag + (cls ? "." + cls : "") + (at ? " " + at : "") + (n.disabled ? " disabled" : "") + (n.style.color ? " color=" + n.style.color : "") + ">");
    for (const c of n._kids) walk(c, d + " ");
  })(node, "");
  return out.join("\n");
}
const nothing = (r) => r.records === 0 && r.paneRebuilds === 0 && r.rowsBuilt === 0 && r.rowsRemoved === 0;
const part = async (name, fn) => { try { await fn(); } catch (e) { failed++; console.log("[queue-redraw] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); } };

(async () => {
  // ═══ PROBE, BOTH WAYS — the measuring instrument before anything is measured with it ══════════════════════════════
  await part("PROBE", async () => {
    const x = await pane();
    ok(x.entry === null, "PROBE: the main screen is entered through the real `enterMainScreen`", x.entry);
    const kids = x.P.children;
    ok(typeof kids.map === "undefined" && typeof kids.length === "number", "PROBE: the tree is DOM-shaped — the pane's children an HTMLCollection, no `.map`", typeof kids.map);
    const plain = S.world({});
    const pk = plain.doc.createElement("div").children;
    ok(Array.isArray(pk), "PROBE: and without `domShaped` a world's children are an Array, as every world before J130 built", typeof pk);
    // The watcher hears a change under the pane and nothing elsewhere.
    const m = x.w.watch(x.P);
    x.w.doc.body.appendChild(x.w.doc.createElement("div"));
    const quiet = m.take();
    const m2 = x.w.watch(x.P);
    const tmp = x.w.doc.createElement("div"); tmp.className = "song-row"; x.P.appendChild(tmp); tmp.remove();
    const heard = m2.take();
    ok(quiet.records === 0 && heard.rowsBuilt === 1 && heard.rowsRemoved === 1, "PROBE: the watcher counts a row put into the pane and taken out, and nothing outside it", { quiet, heard });
    // A thrown listener is caught and KEPT, so a premise can refuse a count read after it.
    x.L.queue.push(() => { throw new Error("probe"); });
    const r = await x.event("queue");
    ok(r.threw.length === 1, "PROBE: a listener that throws is recorded, so a count after it can be refused", r.threw);
  });

  // ═══ PART A — the room queue ══════════════════════════════════════════════════════════════════════════════════════
  await part("A", async () => {
    const x = await pane();
    await x.settle();
    const pics = x.srcs().filter((s) => s && s.indexOf("blob:") === 0).length;
    ok(x.rows().length === 7 && pics === 7 && x.titles().every((t) => /^Title of /.test(t)) && x.L.queue.length === 1 && x.L.reactions.length === 1 && x.L.rank.length === 1 && (x.L.history || []).length === 1,
      "A PREMISE — the room queue drew now playing and six DJs, titles held and pictures in, and each trigger is wired once", { rows: x.rows().length, pics, titles: x.titles(), queue: (x.L.queue || []).length, history: (x.L.history || []).length });
    // SONG HISTORY'S NOTICE (J130's correction, `ddjp_662`) is History's alone: the room queue does not hear it, even when
    // song history did change.
    x.st.history.unshift({ videoId: V("hi", 98), dj: "@dj0:hs", at: NOW, pi: "h98" });
    for (const [n, label] of [["queue", "A QUEUE EVENT"], ["reactions", "A REACTIONS EVENT"], ["rank", "A RANK CHANGE"], ["history", "A SONG HISTORY NOTICE"]]) {
      await x.settle();
      const r = await x.event(n);
      ok(r.threw.length === 0, "A PREMISE — " + label + " ran every listener to its end", r.threw);
      ok(nothing(r), "A: " + label + " THAT CHANGES NOTHING THE ROOM QUEUE SHOWS REDRAWS NOTHING", r);
    }
    // YOUR OWN ▲: the vote lands (`Actions.perform`), the button says so (`_reflectReactions`), and the room's echo arrives
    // (`Reactions.onChange`) — after the send answers, or before it. One change on screen, so one redraw in all, either way.
    for (const echoFirst of [false, true]) {
      const y = await pane();
      await y.settle();
      y.st.echoFirst = echoFirst ? () => y.fire("reactions") : null;
      const mv = y.w.watch(y.P);
      // CHANGED ON PURPOSE (J131, the owner): the box around now playing (`.rq-group`) is gone — now playing is the room
      // queue's first row, `.song-row.playing`, and its ▲ is found there.
      y.P.querySelector(".song-row.playing .np-react.upvote").click();
      await y.w.advance(10); await y.frames();
      if (!echoFirst) { y.fire("reactions"); await y.frames(); }
      const v = mv.take();
      const order = echoFirst ? "the echo first" : "the echo after";
      ok(y.st.voted && !!y.P.querySelector(".song-row.playing .np-react.upvote.on"), "A PREMISE — your ▲ landed and now playing shows it (" + order + ")", y.st.voted);
      ok(v.paneRebuilds === 1, "A: YOUR OWN ▲ REDRAWS THE ROOM QUEUE ONCE — the press and the room's echo are one change (" + order + ")", v);
    }
    await x.settle();
    x.st.rotation.push({ user: "@new:hs", pending: [{ videoId: V("nw", 0) }] });
    const r = await x.event("queue");
    ok(r.paneRebuilds === 1 && r.rowsBuilt === 8, "A: A QUEUE EVENT THAT CHANGES IT (a DJ joins) REDRAWS IT ONCE", r);
    ok(x.rows().some((row) => row.dataset.vid === V("nw", 0)), "A: and the change is on screen at once", x.rows().map((row) => row.dataset.vid));
  });

  // EVERY VALUE IT DRAWS, CHANGED ALONE, REDRAWS IT ONCE; A CHANGE IT DOES NOT DRAW REDRAWS NOTHING. What it shows is read
  // off two renders of the two states, so the record of what it drew is held to the screen, not to a list written here.
  const ROOM_CASES = [
    // A new song is a new playing; its counts carried over, so the SONG is the one thing that moved.
    ["now playing's song", "queue", (s) => { s.counts.p1 = Object.assign({}, s.counts.p0); s.np = { dj: s.np.dj, song: { videoId: V("np", 1) }, pi: "p1" }; }],
    ["now playing's DJ", "queue", (s) => { s.np = Object.assign({}, s.np, { dj: "@dj4:hs" }); }],
    ["its votes", "queue", (s) => { s.counts.p0.votes++; }],
    ["its saves, owner-adjusted", "queue", (s) => { s.counts.p0.savesAdjusted = true; }],
    ["my vote's latch", "reactions", (s) => { s.voted = true; }],
    ["my save's latch", "reactions", (s) => { s.saved = true; }],
    ["the rotation's order", "queue", (s) => { const a = s.rotation[1]; s.rotation[1] = s.rotation[2]; s.rotation[2] = a; }],
    ["a DJ's next song", "queue", (s) => { s.rotation[3].pending[0] = { videoId: V("rq", 33) }; }],
    ["a DJ leaving", "queue", (s) => { s.rotation.splice(4, 1); }],
    ["a DJ's rank colour", "rank", (s) => { s.levels["@dj2:hs"] = 60; }],
    ["now playing's DJ's colour", "rank", (s) => { s.levels["@dj:hs"] = 80; }],
    ["Reset taken away", "rank", (s) => { s.perms["dj.reset"] = false; }],
    ["the row controls taken away", "rank", (s) => { s.perms["dj.move"] = false; }],
    ["one row's ✕🎵 refused, with its reason", "rank", (s) => { s.permFor["dj.strike"] = { "@dj1:hs": "Not that one" }; }],
    ["a strike landing (its cooldown)", "queue", (s, w) => { s.lastStrike["@dj2:hs"] = w.clock.now; }],
    ["the song ending", "queue", (s) => { s.np = null; }],
    ["nothing", "queue", () => {}],
    ["a DJ's second song (not shown)", "queue", (s) => { s.rotation[0].pending[1] = { videoId: V("rn", 99) }; }],
    ["a vote on another playing", "queue", (s) => { s.counts.p7 = { votes: 5 }; }],
    ["History gaining a row", "queue", (s) => { s.history.unshift({ videoId: V("hi", 99), dj: "@dj0:hs", at: NOW, pi: "h99" }); }],
    ["a rank change of someone not on it", "rank", (s) => { s.levels["@nobody:hs"] = 60; }],
    ["a minute passing, nobody cooling", "queue", null],
  ];
  await part("A faithful", async () => {
    for (const [what, trig, change] of ROOM_CASES) {
      const x = await pane();
      await x.settle();
      const before = shows(x.P);
      if (change) change(x.st, x.w); else await x.w.advance(60000);
      const r = await x.event(trig);
      const atOnce = shows(x.P);
      x.w.sb.QueuePanels.renderQueuePanel();   // the same state, drawn fresh: what it SHOULD show
      const fresh = shows(x.P);
      const drawn = before !== fresh;
      ok(r.threw.length === 0, "A PREMISE — " + what + ": every listener ran to its end", r.threw);
      if (drawn) {
        ok(r.paneRebuilds === 1, "A: " + what.toUpperCase() + " — DRAWN, SO ONE REDRAW", r);
        ok(atOnce === fresh, "A: " + what + " — and it is on screen at once, as a fresh render draws it", null);
      } else {
        ok(nothing(r), "A: " + what.toUpperCase() + " — NOT DRAWN, SO NO REDRAW", r);
      }
    }
  });

  // HISTORY, THE SAME WAY: what it draws, changed alone, redraws it once; what it does not, nothing.
  const HISTORY_CASES = [
    ["a song finishing (a new row)", "queue", (s) => { s.history.unshift({ videoId: V("hi", 99), dj: "@dj0:hs", at: NOW, pi: "h99" }); }],
    ["a past row's votes", "queue", (s) => { s.counts.h3 = { votes: 4 }; }],
    // CHANGED ON PURPOSE (J131's correction, `ddjp_663`): a row says how its song was cut short (`cutShortBy`, a kind; the
    // tab's words are "skipped" and "Sys Skip" — "Sys Skipped" until `ddjp_667`, a word only, so this case is the same), not
    // `skipped: true` — which the tab no longer reads, so this case went quietly from a drawn change to an undrawn one and
    // pinned nothing. The fourth field says it must be drawn.
    ["a past row cut short", "queue", (s) => { s.history[2] = Object.assign({}, s.history[2], { cutShortBy: "media" }); }, true],
    ["a DJ's rank colour", "rank", (s) => { s.levels["@dj1:hs"] = 60; }],
    ["the reach turning partial", "queue", (s) => { s.reach = { entries: 30, complete: false }; }],
    ["nothing", "queue", () => {}],
    ["now playing's votes (not a row here)", "queue", (s) => { s.counts.p0.votes++; }],
    ["the rotation's order", "queue", (s) => { const a = s.rotation[0]; s.rotation[0] = s.rotation[1]; s.rotation[1] = a; }],
    ["a rank change of someone with no row", "rank", (s) => { s.levels["@nobody:hs"] = 60; }],
    ["a minute passing (the ages tick in place)", "queue", null],
    // SONG HISTORY'S OWN NOTICE (J130's correction, `ddjp_662`): a song entering it, told by song history; and song history
    // writing what it already held (a save point's hand-off) — the tab compares its record, so that redraws nothing.
    ["a song entering song history, told by it", "history", (s) => { s.history.unshift({ videoId: V("hi", 97), dj: "@dj2:hs", at: NOW, pi: "h97" }); }],
    ["the reach turning partial, told by song history", "history", (s) => { s.reach = { entries: 30, complete: false }; }],
    ["song history rewriting what it held, told by it", "history", (s) => { s.history = s.history.map((h) => Object.assign({}, h)); }],
  ];
  await part("A history", async () => {
    for (const [what, trig, change, mustDraw] of HISTORY_CASES) {
      const x = await pane();
      await x.tab("history");
      const before = shows(x.P);
      if (change) change(x.st, x.w); else await x.w.advance(60000);
      const r = await x.event(trig);
      const atOnce = shows(x.P);
      x.w.sb.QueuePanels.renderQueuePanel();
      const fresh = shows(x.P);
      ok(r.threw.length === 0, "A PREMISE — History, " + what + ": every listener ran to its end", r.threw);
      if (mustDraw) ok(before !== fresh, "A PREMISE — History, " + what + ": the change is drawn, or this case pins nothing", null);
      if (before !== fresh) {
        ok(r.paneRebuilds === 1 && atOnce === fresh, "A: HISTORY, " + what.toUpperCase() + " — DRAWN, SO ONE REDRAW, AT ONCE", r);
      } else {
        ok(nothing(r), "A: HISTORY, " + what.toUpperCase() + " — NOT DRAWN, SO NO REDRAW", r);
      }
    }
  });

  // ═══ PART B — Playlists ignore room events ═══════════════════════════════════════════════════════════════════════
  await part("B", async () => {
    const x = await pane();
    await x.tab("playlists");
    ok(x.P.querySelectorAll(".pl-row").length === 60, "B PREMISE — the library drew its sixty playlists", x.P.querySelectorAll(".pl-row").length);
    for (const n of ["queue", "rank", "reactions", "mine"]) {
      await x.settle();
      const r = await x.event(n);
      ok(r.threw.length === 0 && nothing(r), "B: THE LIBRARY IGNORES A ROOM EVENT (" + n + ")", r);
    }
    x.P.querySelector(".pl-row .pl-name").click();
    await x.settle();
    const n0 = x.rows().length;
    ok(n0 > 0 && x.P.querySelector(".pl-detail-head"), "B PREMISE — inside a playlist, its songs drawn", n0);
    for (const n of ["queue", "rank", "reactions", "mine"]) {
      await x.settle();   // whatever the last event set going has landed, so this row counts this event alone
      const reads = x.st.reads;
      const m = x.w.watch(x.P);
      x.fire(n);
      const atOnce = x.rows().length;
      await x.frames(); await x.w.advance(100); await x.frames();
      const r = m.take();
      ok(nothing(r) && atOnce === n0 && x.st.reads === reads, "B: INSIDE A PLAYLIST, A ROOM EVENT (" + n + ") REDRAWS NOTHING AND READS NOTHING — the list never empties", { r, atOnce, reads: x.st.reads - reads });
    }
  });

  // ═══ PART C — My queue ═══════════════════════════════════════════════════════════════════════════════════════════
  await part("C", async () => {
    const x = await pane();
    await x.tab("mine");
    const shown = x.rows().length;
    ok(shown > 0 && shown < 40 && x.L.mine.length === 1, "C PREMISE — My queue drew one window of its forty songs, and its trigger is wired", shown);
    // ONE DJ EVENT, AS BOTH FEATURES HEAR IT (features/room.js wires Queue before UserQueue): my song played. The room's
    // state moves first — my declared slots no longer hold the song at the top, so both bars read "pending" — and Queue tells
    // its listeners; THEN UserQueue absorbs the play, drops the song, and tells its own. A listener that redrew on the first
    // drew a state that lasted until the second.
    await x.settle();
    const e0 = x.errors.length;
    const mw = x.w.watch(x.P);
    x.st.slots = ["pending", "pending"]; x.fire("queue");
    x.st.mine.shift(); x.st.slots = ["green", "pending"]; x.fire("mine");
    await x.frames();
    const r = mw.take(); r.threw = x.errors.slice(e0);
    ok(r.threw.length === 0, "C PREMISE — every listener ran to its end", r.threw);
    ok(r.rowsBuilt === x.rows().length && r.rowsRemoved === shown, "C: ONE DJ EVENT THAT CHANGES MY QUEUE REDRAWS IT ONCE — one window of rows, built once", { r, shown: x.rows().length });
    ok(x.rows()[0].dataset.vid === V("mq", 1), "C: and the change is on screen", x.rows()[0].dataset.vid);
    for (const [n, label] of [["mine", "THE SETTLE TIMER'S NOTIFY, NOTHING CHANGED"], ["queue", "A VOTE"], ["rank", "A RANK CHANGE"], ["reactions", "A REACTIONS EVENT"]]) {
      await x.settle();
      const q = await x.event(n);
      ok(q.threw.length === 0 && nothing(q), "C: " + label + " REDRAWS NOTHING IN MY QUEUE", q);
    }
    x.st.slots[0] = "sent";   // the top song's declare in flight
    await x.settle();
    const s = await x.event("mine");
    ok(s.rowsBuilt === x.rows().length && x.P.querySelectorAll(".commit-bar.sent").length === 1, "C: a slot's state moving (green → sent) is a change: one redraw, and it shows", s);
  });
  await part("C add line", async () => {
    const x = await pane();
    await x.tab("mine");
    const input = x.P.querySelector(".uq-input");
    input.focus(); input.value = "https://youtu.be/half-typed";
    x.st.mine.shift();
    const r = await x.event("mine");
    ok(r.rowsBuilt > 0, "C PREMISE — a real change redrew My queue's list", r);
    const now = x.P.querySelector(".uq-input");
    ok(now === input && now.value === "https://youtu.be/half-typed" && x.w.doc.activeElement === input,
      "C: A TYPED LINK AND THE FOCUS SURVIVE A REDRAW — only the list under the add line is redrawn", { same: now === input, value: now && now.value, focused: x.w.doc.activeElement === input });
    // THE NOTE UNDER THE LINE: the feature tells its listeners synchronously inside `add`, so a redraw that replaced the line
    // would take the note with it before the line wrote it. CHANGED ON PURPOSE (`ddjp_678`, the owner: "need to remove small
    // tests in my queue", then the two notes he pasted, "Added — click Join to start playing." and "Added."): an add writes no
    // note — and clears a refusal's, so the line takes no room — while a refusal still says why, under the same line.
    x.P.querySelector(".uq-input").value = "https://youtu.be/abcdefghijk";   // the box the pane holds now, whichever it is
    const add = Array.from(x.P.querySelectorAll(".uq-add button")).find((b) => b.textContent === "Add");
    await x.settle();
    const ma = x.w.watch(x.P);
    add.click();
    await x.frames();
    const ra = ma.take();
    const note = x.P.querySelector(".uq-note");
    ok(x.st.mine.some((v) => v.videoId === "abcdefghijk") && ra.rowsBuilt > 0, "C PREMISE — the add put the song in My queue and the list was redrawn", ra);
    ok(!!note && note.textContent === "", "C: NO NOTE AFTER AN ADD — neither \"Added.\" nor \"Added — click Join to start playing.\" (the owner's)", { note: note && note.textContent });
    ok(ra.rowsBuilt === x.rows().length, "C: and the add redrew the list once", { built: ra.rowsBuilt, shown: x.rows().length });
    ok(x.P.querySelector(".uq-input").value === "", "C: and the box is emptied for the next link", x.P.querySelector(".uq-input").value);
    // A REFUSAL STILL SAYS WHY, under the line; the next add that lands clears it.
    for (const active of [false, true]) {
      const y = await pane();
      await y.tab("mine");
      y.st.active = active;
      const addY = () => Array.from(y.P.querySelectorAll(".uq-add button")).find((b) => b.textContent === "Add");
      y.st.refuse = "that is not a YouTube link";
      y.P.querySelector(".uq-input").value = "not a link";
      addY().click(); await y.frames();
      const said = y.P.querySelector(".uq-note");
      ok(!!said && said.textContent === "Couldn't add: that is not a YouTube link" && y.P.querySelector(".uq-input").value === "not a link",
        "C: A REFUSAL STILL SAYS WHY — \"Couldn't add: …\" under the line, the link left to fix (" + (active ? "in" : "not in") + " the rotation)", { note: said && said.textContent });
      y.st.refuse = null;
      y.P.querySelector(".uq-input").value = "https://youtu.be/abcdefghijk";
      addY().click(); await y.frames();
      const cleared = y.P.querySelector(".uq-note");
      ok(!!cleared && cleared.textContent === "" && y.st.mine.some((v) => v.videoId === "abcdefghijk"),
        "C: AND THE NEXT ADD CLEARS IT, saying nothing in its place (" + (active ? "in" : "not in") + " the rotation)", { note: cleared && cleared.textContent });
    }
    const qsrc = require("fs").readFileSync(require("path").join(__dirname, "..", "ui", "queue.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    ok(!/"Added\./.test(qsrc) && !/click Join to start playing/.test(qsrc), "C: AND NEITHER NOTE IS LEFT IN ui/queue.js's code (its comments aside)");
    // From empty: the first song brings "✕ Clear" to the line, as a full render does.
    const e = await pane({ mine: 0 });
    await e.tab("mine");
    ok(!e.P.querySelector(".uq-clear"), "C PREMISE — an empty queue shows no Clear", null);
    e.st.mine.push({ eid: "z", videoId: V("mq", 50) });
    await e.event("mine");
    ok(!!e.P.querySelector(".uq-clear") && e.rows().length === 1, "C: the list redraw also brings \"✕ Clear\" to the line when the first song arrives", e.rows().length);
  });

  // ═══ PART D — a redrawn row keeps its title and its picture ═══════════════════════════════════════════════════════
  await part("D", async () => {
    for (const tab of ["room", "mine", "history"]) {
      const x = await pane();
      if (tab !== "room") await x.tab(tab); else await x.settle();
      const t0 = x.titles(), s0 = x.srcs(), made = x.urls.made.length;
      ok(t0.length > 0 && t0.every((t) => /^Title of /.test(t)) && s0.every((s) => s && s.indexOf("blob:") === 0),
        "D PREMISE (" + tab + ") — every row has its title held and its picture in", { t0: t0.slice(0, 3), s0: s0.map((v, i) => i + ":" + v).filter((v) => !/blob:/.test(v)) });
      x.w.sb.QueuePanels.renderQueuePanel();   // a redraw
      const t1 = x.titles(), s1 = x.srcs();
      ok(t1.length === t0.length && t1.every((t) => /^Title of /.test(t)), "D (" + tab + "): A REDRAWN ROW SHOWS ITS HELD TITLE AT ONCE — never the video id", t1.slice(0, 3));
      ok(s1.join() === s0.join(), "D (" + tab + "): A REDRAWN ROW KEEPS THE SAME PICTURE URL", { before: s0.slice(0, 3), after: s1.slice(0, 3) });
      ok(x.urls.made.length === made, "D (" + tab + "): NO OBJECT URL IS MADE PER REDRAW", x.urls.made.length - made);
    }
    // BOUNDED: songs come and go through the room queue — 300 different videos — and the live object URLs stay within the
    // blob cache, each released only as its video leaves it.
    const x = await pane();
    await x.settle();
    for (let k = 1; k <= 50; k++) {
      x.st.rotation = Array.from({ length: 6 }, (_, i) => ({ user: "@dj" + i + ":hs", pending: [{ videoId: V("b" + k, i) }] }));
      x.fire("queue");
      await x.settle();
    }
    const live = x.urls.made.filter((m) => !x.urls.revoked.has(m.u));
    const vids = new Set(live.map((m) => m.vid));
    ok(x.urls.made.length > 200, "D PREMISE — more videos than the cache holds went through it", x.urls.made.length);
    ok(live.length <= 200 && vids.size === live.length, "D: AT MOST ONE LIVE OBJECT URL PER VIDEO, AND NO MORE THAN THE BLOB CACHE HOLDS (200)", { live: live.length, videos: vids.size });
    const shownNow = new Set(x.srcs());
    ok(x.urls.made.filter((m) => x.urls.revoked.has(m.u)).every((m) => !shownNow.has(m.u)), "D: and none released is still on a row", null);
  });

  // ═══ PART E — the library keeps its scroll ══════════════════════════════════════════════════════════════════════
  await part("E", async () => {
    const x = await pane();
    await x.tab("playlists");
    const sc = () => x.P.querySelector(".pl-scroll");
    sc().scrollTop = 400; await x.frames();
    ok(sc().scrollTop === 400, "E PREMISE — the library scrolled to 400", sc().scrollTop);
    x.P.querySelector(".pl-lib-head .panel-lock-btn").click();   // the owner's own redraw: unlock
    await x.frames();
    ok(!!x.P.querySelector(".pl-lib-head .panel-lock-btn:not(.locked)"), "E PREMISE — the library was redrawn (unlocked)", null);
    ok(sc().scrollTop === 400, "E: THE LIBRARY KEEPS ITS SCROLL ACROSS A REDRAW", sc().scrollTop);
    x.P.querySelector(".pl-row .pl-name").click(); await x.settle();
    x.P.querySelector(".pl-back").click(); await x.frames();
    ok(sc().scrollTop === 400, "E: AND COMING BACK FROM INSIDE A PLAYLIST", sc().scrollTop);
    x.w.refs.tabRoom.click(); await x.frames();
    x.w.refs.tabPlaylists.click(); await x.frames();
    ok(sc().scrollTop === 0, "E: the Playlists tab opens it at the top, as the other tabs", sc().scrollTop);
  });

  // ═══ PART F — timed displays still update ══════════════════════════════════════════════════════════════════════════
  await part("F", async () => {
    const x = await pane();
    await x.settle();
    const strikeOf = (u) => { const row = x.rows().find((r) => r.querySelector(".sr-when") && r.querySelector(".sr-when").textContent === u.split(":")[0].slice(1)); return row && row.querySelector(".rq-strike"); };
    ok(!!strikeOf("@dj2:hs") && !strikeOf("@dj2:hs").disabled, "F PREMISE — dj2's ✕🎵 is live", null);
    x.st.lastStrike["@dj2:hs"] = x.w.clock.now;
    const a = await x.event("queue");
    ok(a.paneRebuilds === 1 && strikeOf("@dj2:hs").disabled && /Cooling down/.test(strikeOf("@dj2:hs").title), "F: A STRIKE GREYS ✕🎵 AT ONCE, cooling", a);
    await x.w.advance(1000);
    const b = await x.event("queue");
    ok(nothing(b), "F: AN EVENT THAT CHANGES NOTHING DURING THE COOLDOWN REDRAWS NOTHING", b);
    const m = x.w.watch(x.P);
    await x.w.advance(2500);
    const c = m.take();
    ok(c.paneRebuilds === 1 && !strikeOf("@dj2:hs").disabled, "F: AT THE COOLDOWN'S END ✕🎵 IS LIVE AGAIN — its own timer redraws it", c);
    // THE 5-SECOND UNLOCK.
    x.w.refs.roomqLockBtn.click();
    const lock = x.w.refs.roomqLockBtn;
    ok(!x.P.classList.contains("roomq-locked") && !/\blocked\b/.test(lock.className), "F PREMISE — the room queue's lock opened", lock.className);
    await x.w.advance(2000);
    const d = await x.event("queue");
    ok(nothing(d) && x.w.refs.roomqLockBtn === lock, "F: THE UNLOCK RUNS ON THROUGH A ROOM EVENT THAT CHANGES NOTHING — the same lock, its bar not restarted", d);
    x.st.rotation.pop();
    const e = await x.event("queue");
    const bar = x.w.refs.roomqLockBtn.querySelector(".roomq-lock-timer");
    ok(e.paneRebuilds === 1 && !!bar && /^-\d+ms$/.test(bar.style.animationDelay || ""), "F: a real change during it redraws once, the lock still open and its bar resumed where it was", { e, delay: bar && bar.style.animationDelay });
    const f = x.w.watch(x.P);
    await x.w.advance(3200);
    const g = f.take();
    ok(x.P.classList.contains("roomq-locked") && g.paneRebuilds === 0 && g.rowsBuilt === 0, "F: AT 5 SECONDS IT RE-LOCKS, IN PLACE", g);
  });

  // ═══ PART G — the windowed stack ═══════════════════════════════════════════════════════════════════════════════════
  await part("G", async () => {
    const x = await pane();
    await x.tab("mine");
    const vr = x.w.sb.WindowedList.visibleRange, calls = [];
    x.w.sb.WindowedList.visibleRange = function (top, vh) { calls.push(vh); return vr.apply(this, arguments); };
    const sc = () => x.P.querySelector(".uq-scroll");
    ok(!!sc() && sc().clientHeight === 614, "G PREMISE — My queue's list is a scroller 614 px high, as Chromium measured it", sc() && sc().clientHeight);
    sc().scrollTop = 600; await x.frames();
    const m = x.w.watch(x.P);
    x.w.sb.QueuePanels.renderQueuePanel();   // a render at a saved offset: built, then the next frame, then the scroll restore
    await x.frames();
    const r = m.take();
    const n = x.rows().length;
    ok(n > 0 && sc().scrollTop === 600, "G PREMISE — the render restored the offset and drew a window", { n, top: sc().scrollTop });
    ok(r.rowsBuilt === n, "G: ONE PAINT PER RENDER — the next frame's and the scroll restore's repaints build nothing", { built: r.rowsBuilt, shown: n });
    const m2 = x.w.watch(x.P);
    sc().scrollTop = 610; await x.frames();
    const r2 = m2.take();
    ok(r2.rowsBuilt === 0, "G: A SCROLL INSIDE THE WINDOW BUILDS NOTHING", r2);
    // A SCROLL EVENT FROM A LIST ALREADY REPLACED: a render sets its scroll, and another replaces it before the frame.
    calls.length = 0;
    x.w.sb.QueuePanels.renderQueuePanel(); x.w.sb.QueuePanels.renderQueuePanel();
    await x.frames();
    ok(calls.indexOf(320) < 0, "G: A SCROLL EVENT FROM A REPLACED LIST PAINTS NOTHING (it measured 0 px and fell back to 320)", calls);
    ok(sc().style.overflowAnchor === "none", "G: THE BROWSER'S SCROLL ANCHORING IS OFF ON THE LIST — in Chromium it moved the list on each repaint, 12 paints and 600 → 1356 for one scroll at 653", sc().style.overflowAnchor);
    // EACH ROW COUNTED AT THE HEIGHT IT IS DRAWN, AND DRAWN AT THE HEIGHT EVERY SONG ROW IS. CHANGED ON PURPOSE at `ddjp_656`
    // (J131's correction): this said "drawn as it always was — 58 px, 44 of them content", reading the sheet's `.song-row`
    // content-box. The page sizes every box border-box (its first rule, which the harness's reader lost until `ddjp_656`), so
    // in a browser the sheet drew a row 44 px and the stack's 58 px border-box rows (J130) were taller than every other list's
    // — the owner's screenshots. The owner chose between the two, 48: the sheet draws every song row at it, and the stack's match.
    const row = x.rows()[0];
    const px = (v) => { const m3 = /(-?\d+(?:\.\d+)?)px/.exec(v || ""); return m3 ? Number(m3[1]) : 0; };
    const pad = (x.w.cas.declared(row, "padding") || {}).val || "0", bor = (x.w.cas.declared(row, "border") || {}).val || "0";
    const vpad = px(pad.split(/\s+/)[0]) * 2, vbor = px(bor) * 2;
    const minH = px(((x.w.cas.declared(row, "min-height") || {}).val));
    const sheetBox = (x.w.cas.declared(x.w.main, "box-sizing") || {}).val;   // what the sheet makes a plain box
    const h = px(row.style.height);
    const border = ((x.w.cas.declared(row, "box-sizing") || {}).val) === "border-box";   // as the browser sizes it: inline, else the sheet's
    const drawn = border ? h : h + vpad + vbor, content = border ? h - vpad - vbor : h;
    const kids = Array.from(sc().children), top = kids[0];
    const start = Number(row.querySelector(".sr-pos").textContent.replace(/[^\d]/g, "") || 1) - 1;
    const step = start > 0 ? px(top.style.height) / start : NaN;
    ok(vpad === 12 && vbor === 2 && sheetBox === "border-box", "G PREMISE — the sheet's song row: 6 px padding, a 1 px border; and the page sizes boxes border-box", { vpad, vbor, sheetBox });
    ok(step === drawn, "G: THE STACK COUNTS EACH ROW AT THE HEIGHT IT IS DRAWN (the owner: \"58 drawn, 44 counted\")", { step, drawn, start });
    ok(drawn === minH && drawn === 48 && content === 34,
      "G: AND DRAWS IT AT THE HEIGHT THE SHEET DRAWS EVERY SONG ROW — 48 px, border-box, as the room queue's and History's (the owner, `ddjp_656`–`ddjp_657`: between the old History and the playlist, then 48)",
      { drawn, sheetMinHeight: minH, content });
  });

  // ═══ PART H — inside a playlist, your own actions never empty it ═══════════════════════════════════════════════════
  await part("H", async () => {
    const x = await pane();
    await x.tab("playlists");
    x.P.querySelector(".pl-row .pl-name").click();
    await x.settle();
    const n0 = x.rows().length;
    ok(n0 > 0, "H PREMISE — inside a playlist, its songs drawn", n0);
    x.P.querySelector(".pl-detail-head .panel-lock-btn").click();   // unlock: a redraw of the owner's own
    const atOnce = x.rows().length;
    ok(atOnce === n0, "H: YOUR OWN REDRAW (the lock) DRAWS FROM THE RECORD LAST READ — the list never empties", { atOnce, n0 });
    const m = x.w.watch(x.P);
    await x.w.advance(100); await x.frames();
    const r = m.take();
    ok(r.rowsBuilt === 0 && r.rowsRemoved === 0, "H: and the read, landing with the same record, redraws nothing", r);
    const gone = x.rows()[0].dataset.vid;
    const rm = Array.from(x.rows()[0].querySelectorAll("button")).find((b) => b.textContent === "✕");
    rm.click();
    await x.w.advance(45);   // the removal's write lands, and the redraw is asked for
    const mid = x.rows().length;
    ok(mid > 0, "H: removing a song: the list stays on screen while the read is out", mid);
    await x.w.advance(100); await x.frames();
    ok(!x.rows().some((row) => row.dataset.vid === gone) && x.rows().length > 0, "H: and the read, landing, takes the removed song away", x.rows().length);
  });

  // ═══ PART I — a strike the ROOM delivers greys ✕🎵 at once: the real feature, the real delivery ═══════════════════
  // ADDED AT `ddjp_661` (J130's correction), AND WHY. PART F stands the queue in and sets the strike's time before the event,
  // so it could not see what a reviewer drove in the app: `features/queue.js` recorded the strike's time in a second handler,
  // subscribed after its own notify, and `StreamManager.on` calls a type's handlers in the order they subscribed — so the room
  // queue redrew while the time still read 0, ✕🎵 stayed live, no timer was set, and nothing redrew it after. Here the strike
  // goes through the REAL door: backend1's `StreamManager` and its reducer, the real `features/queue.js` and the real
  // `UserQueue` (the strike's other listener, `roles.md` §5), wired as `features/room.js` wires them, and delivered into the
  // same DOM-shaped room queue as every other part. Two orders, both the app's: at room entry (`_initModules`: Queue, then
  // UserQueue) and after a rank change (`_rewireWriteChannel` inits Queue again, so its handlers come after UserQueue's).
  // A WITNESS on the strike, subscribed where a later listener stands at room entry, reads the screen when it is told — so each
  // world says which order it really delivered in, and a row whose order was not the one it names refuses itself.
  const { loadInContext } = require("./_load");
  async function delivering(rewire) {
    const warns = [];   // `Queue._notify` and `StreamManager`'s notify each catch a listener's throw and say so here
    const Logger = { debug() {}, info() {}, log() {}, error() {}, warn(m) { warns.push(String(m)); } };
    const bridge = { getUserId: () => "@me:hs", roomHistory: () => [], historyCoverage: () => null };
    const kept = {};
    const storage = { save(k, v) { kept[k] = JSON.stringify(v); }, load(k) { return kept[k] ? JSON.parse(kept[k]) : null; }, remove(k) { delete kept[k]; } };
    const f = loadInContext(["core/store.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
      "core/playlistdoc.js", "features/queue.js", "features/userqueue.js"], { Date, URL, Logger, MatrixBridge: bridge, StorageIO: storage });
    const SM = f.StreamManager, Q = f.Queue, UQ = f.UserQueue;
    UQ.setClock({ set: () => 0, clear() {} });   // its reconcile's timer, inert: this part reads the room queue
    let l = 0, n = 0;
    const raw = (sender, rank, t, c, ts) => { l++; n++; return { event_id: "$i" + n, room_id: "!ev:hs", type: "m.room.message", sender, senderRank: rank, ts, l,
      content: { body: JSON.stringify(Object.assign({}, c, { t, l, dv: 1 })) } }; };
    Q.init("!ev:hs"); UQ.init("!s:hs");
    const told = [];
    let witness = () => null;
    SM.on("ddjp.dj.strike", () => { told.push(witness()); });
    for (let i = 0; i < 3; i++) for (const k of [0, 1]) {
      const v = V("rq" + k, i);
      SM.ingest(raw("@dj" + i + ":hs", 20, "ddjp.dj.join", { v, u: "https://www.youtube.com/watch?v=" + v }, NOW - 60000 + n));
    }
    if (rewire) Q.init("!ev:hs");
    const x = await pane({ globals: { Queue: Q } });
    await x.settle();
    const rowOf = (who) => x.rows().find((r) => r.querySelector(".sr-when") && r.querySelector(".sr-when").textContent === who) || null;
    witness = () => { const r = rowOf("dj1"); return r ? r.dataset.vid : null; };
    const strikeOf = (who) => { const r = rowOf(who); return r && r.querySelector(".rq-strike"); };
    const songs = (u) => ((SM.getState().rotation || []).find((r) => r.user === u) || { pending: [] }).pending.map((p) => p.videoId);
    // THE STRIKE, AS THE ROOM DELIVERS IT: a staff member's, stamped by the server half a second before this clock reads.
    async function strike() {
      const ts = x.w.clock.now - 500, w0 = warns.length, e0 = x.errors.length;
      const m = x.w.watch(x.P);
      SM.ingest(raw("@me:hs", 60, "ddjp.dj.strike", { x: "@dj1:hs", v: V("rq0", 1) }, ts));
      await x.frames();
      const r = m.take();
      r.threw = warns.slice(w0).concat(x.errors.slice(e0));
      return { ts, r };
    }
    return { x, SM, Q, told, songs, strikeOf, strike, warns };
  }
  const struck = V("rq0", 1), next = V("rq1", 1);
  for (const [rewire, order] of [[false, "at room entry"], [true, "after a rank change"]]) {
    await part("I " + order, async () => {
      const d = await delivering(rewire);
      const x = d.x;
      ok(d.warns.length === 0 && ["@dj0:hs", "@dj1:hs", "@dj2:hs"].every((u) => d.songs(u).length === 2) && d.songs("@dj1:hs")[0] === struck,
        "I PREMISE (" + order + ") — the real door folded three DJs with two songs each, and nothing it told threw", { warns: d.warns, dj1: d.songs("@dj1:hs") });
      const b0 = d.strikeOf("dj1");
      ok(!!b0 && !b0.disabled && !/Cooling/.test(b0.title), "I PREMISE (" + order + ") — the reader finds dj1's ✕🎵, live, before the strike", b0 && { disabled: b0.disabled, title: b0.title });
      const { ts, r } = await d.strike();
      ok(d.songs("@dj1:hs").join() === next && r.threw.length === 0 && r.paneRebuilds === 1,
        "I PREMISE (" + order + ") — the strike went through the real door (dj1's struck song gone), every listener ran to its end, and the room queue redrew once", { dj1: d.songs("@dj1:hs"), r });
      // WHICH ORDER THIS WORLD DELIVERED IN: at room entry the witness, after the queue, sees dj1's next song already drawn;
      // after a rank change it is told before the queue's handler, while the struck song is still on screen.
      ok(d.told.length === 1 && d.told[0] === (rewire ? struck : next),
        "I PREMISE (" + order + ") — the strike's listeners were told in the app's order " + (rewire ? "after a rank change (UserQueue's side first)" : "at room entry (the queue first)"), d.told);
      const b = d.strikeOf("dj1");
      ok(!!b && b.disabled && /Cooling down/.test(b.title), "I: A STRIKE THE ROOM DELIVERS GREYS ✕🎵 AT ONCE, " + order.toUpperCase() + " — cooling, with nothing else redrawing it", b && { disabled: b.disabled, title: b.title });
      if (!rewire) {
        ok(ts !== x.w.clock.now, "I PREMISE — the strike's server stamp is not this clock's reading, so the two can be told apart", ts);
        ok(d.Q.lastStrikeTs("@dj1:hs") === ts, "I: THE COOLDOWN RUNS FROM THE STRIKE'S SERVER STAMP — the event's `ts`, not this device's clock", { recorded: d.Q.lastStrikeTs("@dj1:hs"), ts, clock: x.w.clock.now });
        // ITS END: the row's own timer, set by the redraw that greyed it. Read only if it greyed — otherwise there is no end to read.
        if (b && b.disabled) {
          const m = x.w.watch(x.P);
          await x.w.advance(3000);
          const e = m.take();
          const back = d.strikeOf("dj1");
          ok(e.paneRebuilds === 1 && !!back && !back.disabled, "I: AT THE COOLDOWN'S END ✕🎵 IS LIVE AGAIN — the redraw that greyed it set the timer that brings it back", { e, disabled: back && back.disabled });
        } else ok(false, "I PREMISE — the cooldown's end cannot be read: ✕🎵 never greyed");
      } else {
        // THE READER, THE OTHER WAY: once the time is recorded, a plain redraw of the same state greys ✕🎵 — so a live button
        // at once is the delivery's order, never a reader that cannot see grey.
        x.w.sb.QueuePanels.renderQueuePanel();
        const g = d.strikeOf("dj1");
        ok(!!g && g.disabled && /Cooling down/.test(g.title), "I PREMISE — the reader sees ✕🎵 grey when the strike's time is recorded before a redraw", g && { disabled: g.disabled, title: g.title });
      }
    });
  }

  // ═══ PART J — SONG HISTORY'S NOTICE, IN A SHARED ROOM: the real engine, song history, the transport and the room ═════════
  // ADDED AT `ddjp_662` (J130's correction), AND WHY. The History tab heard only the queue's notice. On a page's FIRST room the
  // queue's notice of a play comes BEFORE the play's refresh of song history (`_initModules` runs `Queue.init` before
  // `wireCheckpoints`, which subscribes the refresh once a page), so the tab read song history one song late — and nothing told
  // it afterwards; and a song that starts while the tab is away reaches song history when the tab is settled again, with no
  // queue event at all. Song history now says when it wrote (`History.onChange`, through the transport's `onHistoryChange` and
  // `Queue.onHistoryChange`), and History hears it. Driven here with the real modules wherever they load: backend1's engine,
  // `History`, the bridge and `features/room.js` (`tests/_botroom.js`, the SDK client its only double), the real
  // `features/queue.js` laid over this pane's stand-in (`pane`'s `globals`), into the same DOM-shaped History tab.
  // A PAGE'S FIRST ROOM, AS THE APP WIRES IT: the harness wires the checkpoints at its own construction (its stand-in for an
  // entry), so History is loaded only after that, and the room's own entry (`Room._enterForTest` → `_initModules`) is the first
  // wiring to see it — the queue first, then song history's feed, as on a page's first room. A WITNESS on the queue's notice
  // reads song history's count when that notice reaches the screen, so each world says which order it delivered in, and a row
  // whose order is not the one it names refuses itself.
  const fsJ = require("fs"), pathJ = require("path"), vmJ = require("vm");
  const B = require("./_botroom.js");
  const realSettle = (ms) => new Promise((r) => setTimeout(r, ms || 20));
  const historyJs = fsJ.readFileSync(pathJ.join(__dirname, "..", "backends/backend1/history.js"), "utf8");
  function story(CH, server) {   // one room's homeserver: every tab of the story is delivered what is posted
    const R = { CH, server: server || {}, now: 1792447900000, l: 0, n: 0, tabs: [] };
    R.raw = (sender, body, o) => { o = o || {}; R.now += (o.dt !== undefined ? o.dt : 1000); const l = ++R.l;
      const ch = body.t === "ddjp.room.settings" ? CH.settings_owner : (sender === B.STAFF || sender === B.VIP ? CH.events_uncategorized : CH.events_owner);
      return { event_id: "$" + CH.events_owner.slice(1, 4) + (++R.n), type: "m.room.message", room_id: ch, sender, origin_server_ts: R.now,
        content: { msgtype: "m.text", body: JSON.stringify(Object.assign({}, body, { l })) } }; };
    R.post = (r) => { (R.server[r.room_id] = R.server[r.room_id] || []).push(r); for (const w of R.tabs) w.deliver(r, (r.sender === B.STAFF || r.sender === B.VIP) ? 0 : 99); return r; };
    R.put = (sender, body, o) => R.post(R.raw(sender, body, o));
    return R;
  }
  function roomTab(R, me, firstRoom) {
    const order = B.ORDER.filter((f) => !firstRoom || f !== "backends/backend1/history.js").concat(["core/playlistdoc.js", "features/queue.js"]);
    const t = B.world({ mode: "backend1", me, server: R.server, order, fanOut: true, timers: true, extras: {
      ServerClock: { serverNow: () => R.now, init() {}, destroy() {} },
      Store: { history: { load: async () => null, persist() {} }, config: { saveRoom() {} } } } });
    t.sb.MatrixBridge.onRawEvent = t.sb.B1MatrixBridge.onRawEvent; t.sb.MatrixBridge.offRawEvent = t.sb.B1MatrixBridge.offRawEvent;
    if (firstRoom) vmJ.runInContext(historyJs + "\n;globalThis.History = History;", t.sb);
    R.tabs.push(t);
    return t;
  }
  // The History tab's rows, read off the pane the screen shows now (a room change builds a new one).
  const histRows = (x) => Array.from(x.w.refs.queueBody.querySelectorAll(".song-row")).map((r) => r.dataset.vid);
  async function sharedRoom(firstRoom) {
    const R = story(B.FULL_CH);
    const t = roomTab(R, B.STAFF, firstRoom);
    t.sb.Room._enterForTest({ name: B.SPACE, spaceId: B.SPACE, channels: Object.assign({}, B.FULL_CH) }, "backend1");
    await t.open();
    const wit = { on: false, seen: [] };
    t.sb.Queue.onStateChange(() => { if (wit.on) { wit.seen.push(t.sb.History.count()); wit.on = false; } });
    const x = await pane({ globals: { Queue: t.sb.Queue } });
    await x.tab("history");
    const s = { R, t, x, wit, cur: null, k: 0 };
    // ONE SONG: two DJs top up, then the owner's play; what the room took, what song history took, what the queue's notice saw,
    // and what the History tab shows at once.
    s.play = async (Rr) => {
      const RR = Rr || s.R;
      for (const u of [B.OWNER, B.BOT]) RR.put(u, { t: "ddjp.dj.join", v: V("j" + u.slice(1, 3), ++s.k) });
      await x.frames();
      const h0 = t.sb.History.count(), w0 = t.logs.length;
      const m = x.w.watch(x.w.refs.queueBody);
      wit.on = true; const n0 = wit.seen.length;
      const r = RR.put(B.OWNER, { t: "ddjp.dj.play", p: s.cur }, { dt: 20000 });
      await x.frames();
      wit.on = false;
      const np = t.sb.StreamManager.getState().nowPlaying;
      const took = !!(np && np.pi === r.event_id);
      if (took) s.cur = r.event_id;
      return { took, pi: r.event_id, song: np && np.song ? np.song.videoId : null, added: t.sb.History.count() - h0,
        queueSaw: wit.seen.length > n0 ? wit.seen[wit.seen.length - 1] - h0 : null, top: histRows(x)[0] || null, rows: histRows(x).length,
        history: t.sb.History.count(), r: m.take(), threw: t.logs.slice(w0).filter((l) => /^warn: Queue (history )?sub:/.test(l)).concat(x.errors) };
    };
    // AWAY AND BACK, as the transport reports it (`Session.connectionLost`, `connectionBack`) and the session settles.
    s.away = () => t.sb.Session.connectionLost();
    s.back = async () => {
      const SS = t.sb.Session, m = x.w.watch(x.w.refs.queueBody);
      SS.connectionBack();
      for (let i = 0; i < 60 && SS.phase() !== SS.LIVE; i++) { await realSettle(25); SS._beatForTest(); }
      await x.frames();
      return { live: SS.phase() === SS.LIVE, r: m.take(), top: histRows(x)[0] || null, rows: histRows(x).length };
    };
    s.has = (pi) => t.sb.History.recent().some((h) => h.pi === pi);
    return s;
  }
  await part("J first room", async () => {
    const s = await sharedRoom(true);
    const plays = [await s.play(), await s.play()];
    ok(plays.every((p) => p.took && p.added === 1 && p.threw.length === 0),
      "J PREMISE (a page's first room) — each play was taken by the room and entered song history once, and every listener ran to its end", plays);
    ok(plays.every((p) => p.queueSaw === 0),
      "J PREMISE (a page's first room) — the queue's notice of each play reached the screen BEFORE its refresh of song history, as on a page's first room", plays.map((p) => p.queueSaw));
    ok(plays.every((p) => p.top === p.song && p.rows === p.history),
      "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE — told by song history, after its refresh", plays.map((p) => ({ song: p.song, top: p.top, rows: p.rows, history: p.history })));
    ok(plays.every((p) => p.r.paneRebuilds === 1), "J: and History redrew once per song", plays.map((p) => p.r));
    // THE CONTROL: the room's real rewire — a power-levels change, the room's rank listener, `_rewireWriteChannel`, which inits
    // the queue again, after song history's feed. Green on 661 too: the order a page's first room delivers in was the defect.
    const levels0 = Object.assign({}, B.LEVELS);
    try {
      B.LEVELS[B.STAFF] = 99;
      s.t.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => B.FULL_CH.events_owner, getContent: () => ({}) });
      ok(s.t.logs.filter((l) => /Room: rank changed — now writing to .* \(rank 99\)$/.test(l)).length === 1, "J PREMISE — the rank change ran the room's real rewire", s.t.logs.filter((l) => /rank changed/.test(l)));
      const c = await s.play();
      ok(c.took && c.added === 1 && c.queueSaw === 1 && c.threw.length === 0,
        "J PREMISE (after a rewire) — the queue's notice now reaches the screen AFTER the play's refresh", c);
      ok(c.top === c.song && c.r.paneRebuilds === 1, "J: AFTER A REWIRE (THE CONTROL) A NEW SONG IS AT THE TOP OF HISTORY AT ONCE, redrawn once", c);
      // A SONG WHILE THE TAB IS AWAY, in this rewired world, so the order above is not what is measured: the song reaches song
      // history only when the tab is settled again (the refresh it owed, `_payHistory`), with no queue event at all.
      s.away();
      const d = await s.play();
      ok(s.t.sb.Session.phase() === s.t.sb.Session.SUSPENDED && d.took && d.added === 0 && !s.has(d.pi) && d.top !== d.song,
        "J PREMISE — away (the connection lost), a song starts: the room takes it, song history writes nothing until the tab is settled, and History does not show it", d);
      const b = await s.back();
      ok(b.live && s.has(d.pi), "J PREMISE — back, the tab settles and song history takes the song (the refresh it owed)", b);
      ok(b.top === d.song && b.r.paneRebuilds === 1,
        "J: A SONG THAT STARTED WHILE THE TAB WAS AWAY IS AT THE TOP OF HISTORY AS SOON AS THE TAB IS SETTLED AGAIN — no other song needed", { song: d.song, back: b });
    } finally { for (const k of Object.keys(B.LEVELS)) delete B.LEVELS[k]; Object.assign(B.LEVELS, levels0); }
  });
  // LEAVE A ROOM, OPEN ANOTHER: song history's listeners are the page's, and a leave resets song history (`resetCheckpoints`)
  // — so the reset must keep them, or every room after the first is silent again (the owner, `ddjp_662`). And a leave tells
  // nothing: the History tab of the room being left is not redrawn empty.
  await part("J leave and reopen", async () => {
    const s = await sharedRoom(false);   // the order is not what this part measures: its first room's song shows on 661 too
    const a = await s.play();
    ok(a.took && a.top === a.song, "J PREMISE — the first room's song is on its History tab", a);
    const SP2 = "!space2:hs", CH2 = { events_uncategorized: "!f0:hs", events_owner: "!f99:hs", settings_owner: "!t99:hs", checkpoints_owner: "!d99:hs" };
    B.addRoom(s.t, SP2, CH2, { mode: "backend1" });
    const m = s.x.w.watch(s.x.w.refs.queueBody);
    s.t.sb.Room._enterForTest({ name: SP2, spaceId: SP2, channels: CH2 }, "backend1");   // the room's own entry: it leaves the first
    const left = m.take();
    ok(s.t.logs.some((l) => /Room: left .* nothing of it runs on this tab/.test(l)) && s.t.sb.History.count() === 0,
      "J PREMISE — the entry left the first room, and song history was reset with it", s.t.sb.History.count());
    ok(left.records === 0 && left.paneRebuilds === 0, "J: A LEAVE TELLS NOTHING — the History tab of the room being left is not redrawn (song history's reset is quiet)", left);
    // THE SECOND ROOM OPENS as the first did: its channels replayed, live, its history backfill; the screen entered again.
    const R2 = story(CH2, s.R.server);
    R2.tabs.push(s.t);
    await Promise.allSettled(Object.keys(CH2).map((k) => s.t.sb.MatrixBridge.replayRoom(CH2[k])));
    s.t.goLive();
    await s.t.sb.MatrixBridge.backfillHistory();
    s.x.w.sb.Screens.enterMainScreen({ roomId: CH2.events_owner, spaceId: SP2, name: "Room two" });
    await s.x.frames();
    s.cur = null;
    const b = await s.play(R2);
    ok(b.took && b.added === 1 && b.top === b.song && b.threw.length === 0, "J PREMISE — in the second room a song is taken, enters song history, and is on its History tab", b);
    // ITS SONG WHILE AWAY reaches the tab only by song history's notice — so this row is the reset keeping the listeners.
    s.away();
    const d = await s.play(R2);
    const back = await s.back();
    ok(d.took && !d.added && back.live && s.has(d.pi), "J PREMISE — in the second room, a song while away enters song history when the tab is settled again", { d, back });
    ok(back.top === d.song && back.r.paneRebuilds === 1,
      "J: AFTER A LEAVE AND ANOTHER ROOM, SONG HISTORY'S NOTICE STILL REACHES THE HISTORY TAB — its listeners survive the reset", { song: d.song, back });
  });

  // ═══ PART K — SONG HISTORY'S NOTICE, IN A BOT ROOM: the bot's save point, through the engine ═════════════════════════════
  // A bot room changes song history where the bridge never looks: a device moves on at each of the bot's save points
  // (`B2StreamManager` → backend1's `StreamManager.adoptFloor` → `History.ingest`, the dropped stretch handed over). Song
  // history tells for that too, once — and the History tab, comparing its record, redraws nothing when nothing it shows
  // changed (the rows handed over are the songs it already held, with the same tallies). The bot's own world seals as
  // `B2Runner` does (its seed builder, at its head), as `check-catchup-reentry` H does; the device's world has the real queue
  // feature, wired as `_initModules` wires it (its order is not what this part measures). Then the same device away and back.
  await part("K bot room", async () => {
    const BC = B.BOT_CH, MIN = 60000;
    const server = { [B.SPACE]: [], [BC.events_uncategorized]: [], [BC.events_owner]: [], [BC.settings_owner]: [] };
    let L = 0, TS = 1792447900000, nIn = 0;
    const post = (roomId, sender, body) => { L++; TS += MIN;
      const raw = { type: "m.room.message", event_id: "$k" + String(L).padStart(4, "0"), room_id: roomId, sender, origin_server_ts: TS,
        content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ dv: 2 }, body, { l: L })) } };
      server[roomId].push(raw); return raw; };
    const live = [];
    const deliver = (raw) => { for (const d of live) d.live(raw); };
    const bot = B.world({ me: B.BOT, server, opened: false }); await bot.open(); live.push(bot);
    const dev = B.world({ me: B.OWNER, server, opened: false, order: B.ORDER.concat(["core/playlistdoc.js", "features/queue.js"]), timers: true,
      extras: { ServerClock: { serverNow: () => TS, init() {}, destroy() {} } } });
    await dev.open(); live.push(dev);
    dev.sb.Queue.init(BC.events_uncategorized);
    const PL = bot.sb.Ranks.levelOf("player");
    deliver(post(BC.settings_owner, B.OWNER, { t: "ddjp.room.settings", s: Object.assign(bot.sb.StateDeriver.defaultSettings(), { vis: "public" }) }));
    let pi = null;
    const rel = (b, actor, rank) => Object.assign({}, b, { actor, rank, src: "$in" + (++nIn), at: null });
    const play = () => { const r = post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.play", p: pi }, B.BOT, 99)); deliver(r); pi = r.event_id; return r; };
    const join = (who, v) => deliver(post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.join", v, u: "https://www.youtube.com/watch?v=" + v }, who, PL)));
    const vote = (who) => deliver(post(BC.events_owner, B.BOT, rel({ t: "ddjp.dj.vote", p: pi }, who, PL)));
    const seal = () => { const log = bot.sb.StreamManager.getLog(); const head = log[log.length - 1];
      const out = bot.sb.B2Checkpoint.seal(bot.sb.B2Runner._buildSealSeed(log), { isRunner: true, floorL: head.l, covers: head.eventId });
      if (!out.ok) throw new Error("seal refused: " + out.reason); deliver(post(BC.events_owner, B.BOT, out.cp)); return out.cp; };
    let told = 0;
    if (typeof dev.sb.Queue.onHistoryChange === "function") dev.sb.Queue.onHistoryChange(() => { told++; });   // 661 has none: told stays 0
    const x = await pane({ globals: { Queue: dev.sb.Queue } });
    await x.tab("history");
    const recs = { n: 0 }, hr = x.w.sb.Panels.historyRecord;
    x.w.sb.Panels.historyRecord = function () { recs.n++; return hr.apply(this, arguments); };
    for (let k = 0; k < 3; k++) join("@d" + k + ":hs", V("kp" + k, k));
    for (let s = 0; s < 3; s++) { play(); vote("@d1:hs"); join("@d" + s + ":hs", V("kq" + s, s)); }
    await x.frames();
    const songs = dev.sb.History.recent().map((h) => h.videoId);
    const shown0 = shows(x.w.refs.queueBody);
    ok(songs.length === 3 && histRows(x).join() === songs.join() && dev.sb.History.recent().filter((h) => h.pi !== pi).every((h) => h.src === "refresh"),
      "K PREMISE — a bot room: the device's History tab shows the three songs song history holds, each written by the live refresh", { songs, rows: histRows(x) });
    // THE BOT'S SAVE POINT: the device moves on, and the stretch it drops is handed to song history first.
    const t0 = told, n0 = recs.n, m = x.w.watch(x.w.refs.queueBody);
    seal();
    await x.frames();
    const r = m.take(), mo = dev.sb.StreamManager.lastMoveOn ? dev.sb.StreamManager.lastMoveOn() : null;
    ok(mo && mo.ok && mo.dropped > 0 && dev.sb.History.recent().filter((h) => h.pi !== pi).every((h) => h.src === "trim"),
      "K PREMISE — the device moved on at the bot's save point, and the songs it dropped were handed to song history (each row rewritten by the hand-off)", { mo, srcs: dev.sb.History.recent().map((h) => h.src) });
    ok(told - t0 === 1, "K: A BOT ROOM'S SAVE POINT TELLS THE HISTORY TAB ONCE — the engine's hand-off to song history, one notice for the whole stretch", told - t0);
    ok(recs.n - n0 === 1 && nothing(r) && shows(x.w.refs.queueBody) === shown0,
      "K: AND NOTHING IT SHOWS CHANGED, SO HISTORY REDRAWS NOTHING — it read its record once, compared, and touched nothing", { records: recs.n - n0, r });
    // AWAY AND BACK, in the bot room: the song the bot starts meanwhile reaches the tab when the device is settled again.
    const SS = dev.sb.Session;
    SS.connectionLost();
    const p2 = play(); join("@d2:hs", V("kr", 1));
    await x.frames();
    const away = { phase: SS.phase(), has: dev.sb.History.recent().some((h) => h.pi === p2.event_id), top: histRows(x)[0] };
    const mb = x.w.watch(x.w.refs.queueBody);
    SS.connectionBack();
    for (let i = 0; i < 60 && SS.phase() !== SS.LIVE; i++) { await realSettle(25); SS._beatForTest(); }
    await x.frames();
    const song = (dev.sb.History.recent()[0] || {}).videoId, back = mb.take();
    ok(away.phase === SS.SUSPENDED && !away.has && SS.phase() === SS.LIVE && dev.sb.History.recent().some((h) => h.pi === p2.event_id),
      "K PREMISE — away, the bot starts a song: song history takes it only once the device is settled again", away);
    ok(histRows(x)[0] === song && back.paneRebuilds === 1, "K: IN A BOT ROOM TOO, A SONG THAT STARTED WHILE THE TAB WAS AWAY IS AT THE TOP OF HISTORY AS SOON AS IT IS SETTLED AGAIN", { song, top: histRows(x)[0], back });
  });

  // ═══ PART L — THE NOTICE ITSELF: one per operation, after the write, never per row; nothing written, nothing told ════════
  // The real `History`, in a real room's world (its log, its pager and its floor wired by the bridge), its operations called
  // as their callers call them, a listener counting. "Did it change" is DUMB, on purpose (the owner, `ddjp_662`): the table or
  // its reach was written during the operation — never a comparison of contents. So an operation that wrote what was already
  // there tells (and the tab's record decides, PART K); one that wrote nothing does not.
  await part("L the notice", async () => {
    const s = await sharedRoom(false);
    for (let i = 0; i < 4; i++) await s.play();
    const H = s.t.sb.History;
    let n = 0, sawCount = null;
    ok(typeof H.onChange === "function", "L PREMISE — song history announces (`History.onChange`), or there is no notice to count", typeof H.onChange);
    if (typeof H.onChange !== "function") return;
    H.onChange(() => { n++; sawCount = H.count(); });
    const count = async (fn) => { const n0 = n; await fn(); return n - n0; };
    ok(H.count() === 4, "L PREMISE — song history holds the four songs played", H.count());
    // THE ORDINARY PATH: one refresh, one notice, AFTER the write — a listener reads the new row.
    let before = H.count();
    const p = await s.play();
    ok(p.added === 1 && sawCount === before + 1, "L: A SONG'S REFRESH TELLS AFTER IT WROTE — the listener reads the new row", { added: p.added, sawCount, before });
    ok((await count(() => H.refresh())) === 1, "L: ONE REFRESH THAT WROTE, ONE NOTICE (it wrote the rows it held again: dumb, as asked)", n);
    // NOTHING WRITTEN, NOTHING TOLD.
    s.away();
    ok((await count(() => H.refresh())) === 0, "L: A REFRESH DEFERRED (the tab not settled) WRITES NOTHING AND TELLS NOTHING", n);
    await s.back();
    const quiet = await count(() => { H.noteAdds([], null); H.markOpened(); H.setOrigin({ l: 0, start: true, h: "x" }); });
    ok(quiet === 0, "L: ADDED TIMES, THE OPEN MARK AND THE ORIGIN — NOTHING THE TABLE HOLDS FOR THE SCREEN, NO NOTICE", quiet);
    // THE RESET (a leave): quiet. Then the table opened again, as a room's open step does.
    const snap = H.snapshot();
    ok((await count(() => H.reset())) === 0 && H.count() === 0, "L: A RESET (A LEAVE) TELLS NOTHING", n);
    H.markOpened();
    // ONE OPERATION OF MANY WRITES, ONE NOTICE — AND THE LISTENERS SURVIVED THE RESET: a stored table of three stretches (a
    // cover per stretch, then its rows).
    snap.ranges = [[0, 2], [4, 6], [8, snap.toL]];
    ok((await count(() => H.restore(snap))) === 1 && H.count() === snap.rows.length,
      "L: AFTER THE RESET, A RESTORE OF THREE STRETCHES AND ITS ROWS TELLS — ONCE, NEVER ONE PER ROW OR STRETCH", { notices: n, rows: H.count() });
    // AN ASYNC OPERATION, ONCE, WHEN IT SETTLES: the holes the three stretches left, each paged from the room and filled.
    const holes = H.holes().length;
    const gap = await count(() => H.fillGaps());
    ok(holes === 2 && gap === 1 && H.holes().length === 0, "L: A FILL OF TWO HOLES (PAGED, SEVERAL WRITES) — ONE NOTICE, WHEN IT SETTLES", { holes, notices: gap, left: H.holes() });
    // A FLOOR'S RECONCILE (each save point a shared room adopts, and the open's restore): it writes what it keeps, so it tells.
    ok((await count(() => H.reconcileFloor(null, null))) === 1 && H.count() === snap.rows.length,
      "L: A FLOOR'S RECONCILE WRITES WHAT IT KEEPS — ONE NOTICE", { notices: n, rows: H.count() });
  });

  if (failed) { console.log("[queue-redraw] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[queue-redraw] PASS — the queue pane's lists redraw only when what they show changed (" + asserts + " assertions): " +
    "a room event that changes nothing on screen redraws nothing and one that changes something redraws once, at once, held to " +
    "the screen in both directions; Playlists and inside a playlist ignore room events; My queue redraws once per change, only " +
    "its list, so a typed link, the focus and the Added note survive; a redrawn row keeps its held title and its one object " +
    "URL, bounded by the blob cache; the library keeps its scroll; the strike cooldown and the 5-second unlock still run; the " +
    "windowed stack paints once, with anchoring off and each row counted as drawn; inside a playlist your own actions never empty it; " +
    "and a strike the room delivers, through the real queue feature and the real door, greys ✕🎵 at once in both orders the app " +
    "subscribes in, from the strike's server stamp, and comes back at its end; and song history says when it wrote, so a new " +
    "song is on History at once on a page's first room, after a tab away is settled again, in a shared room and a bot room, and " +
    "after a leave and another room — one notice per operation, after the write, and none for a reset or what writes nothing");
})();
