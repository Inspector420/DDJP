// tests/check-playlist-moves.js
// SUBJECT: core/playlistdoc.js, features/playlists.js, ui/playlists.js, index.html
// WALL: J131 PART A — REORDER A PLAYLIST'S SONGS (the owner's, settled at `ddjp_654`).
//
//   PART A — the move itself (`PlaylistDoc.moveTrack`, pure): up, down, to the top, to the bottom; the ends refused by name;
//            never a song lost or doubled; the list it was given untouched.
//   PART B — the feature (`Playlists.moveTrack`), through the REAL `Store.playlists` over a stubbed IndexedDB: each move is
//            written at once and the order survives a reload (a fresh store and a fresh feature over the same database);
//            the refusals write nothing. A playlist's edits are written one after another, so two quick edits both land, a
//            read waits for the edits before it, and a playlist deleted while an edit to it is being written stays deleted.
//   PART C — the screen, inside a playlist, on a DOM-shaped tree with a virtual clock, over the REAL feature and store: each
//            row carries the room queue's four moves in its order and with its glyphs — READ OFF THE ROOM QUEUE'S OWN ROW in
//            the same world, not listed here; the ends disabled at the first and last song; the moves hidden while the
//            Playlists panel is locked and a click then inert; ✕ greyed while locked; ＋ shown only while locked (the owner's
//            rule since `ddjp_668`, `check-list-look` L); a move shows the
//            new order at once, never empties the list, never shows an older order again, and the read that follows
//            touches nothing when it agrees; the typed link survives (in the top row's box since ddjp_670); the order survives a
//            reload.
//
// THE READ TAKES TIME IN THIS WORLD, AND THAT IS A PREMISE, NOT A DETAIL: the stubbed database answers a read 40 ms (virtual)
// after it is asked, so "at once" and "after the read" are different moments, and a row says which it measured. The world's
// own instrument is tested both ways (PROBE rows): a playlist opened for the first time shows nothing until its read lands.

"use strict";
const S = require("./_screen-world.js");
const { loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[playlist-moves] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
// A GUARD THAT NEVER FINISHES IS NOT A PASS (J73's rule): a promise that never settles would end the run before the verdict.
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[playlist-moves] FAIL — the guard did not finish: a promise never settled"); process.exitCode = 1; } });

const V = (i) => ("song" + String(i)).padEnd(11, "x").slice(0, 11);
const SONGS = [V(1), V(2), V(3), V(4), V(5)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise((r) => setImmediate(r));

// IndexedDB, stubbed as `check-history-store` stubs it: one map, values stored as copies. `delay(fn)` decides when a read
// answers — at once (PART B) or on the screen world's virtual clock (PART C). A read answers what was written before it
// was asked. Writes are recorded.
function idb(delay) {
  const map = new Map(), writes = [];
  const later = delay || ((v) => Promise.resolve(v));
  return { map, writes, supported: () => true, keyFor: (scope, a, b) => JSON.stringify([scope, a, b]),
    get: (s, k) => later(map.has(s + k) ? structuredClone(map.get(s + k)) : undefined),
    keys: () => Promise.resolve(Array.from(map.keys())),
    set: (s, k, v) => { writes.push(k); map.set(s + k, structuredClone(v)); return Promise.resolve(); },
    del: (s, k) => { writes.push("del " + k); map.delete(s + k); return Promise.resolve(); } };
}
// The REAL feature over the REAL store. A fresh call is a reload: a new store and a new feature over the same database.
function feature(IDB, uq) {
  const sb = loadInContext(["core/logger.js", "core/playlistdoc.js", "core/store.js", "features/playlists.js"],
    { IDB, UserQueue: uq || { add: () => ({ ok: true }) }, Date, URL, setTimeout, clearTimeout });
  return { P: sb.Playlists, D: sb.PlaylistDoc, Store: sb.Store };
}
const recOf = (IDB, id) => { const v = IDB.map.get("kv" + IDB.keyFor(null, "playlists", id)); return v ? v.tracks.map((t) => t.videoId) : null; };
// One playlist of the five songs, written as the app writes it (create, then each song added).
async function seeded(IDB) {
  const f = feature(IDB);
  f.P.init(); await tick();
  const c = await f.P.create("Gym");
  for (const v of SONGS) await f.P.addTrack(c.id, v);
  return { f, id: c.id };
}
// Every order a move should produce, from SONGS, moving the song at `i`.
function expect(i, to) {
  const a = SONGS.slice(), v = a.splice(i, 1)[0];
  const at = { up: i - 1, down: i + 1, top: 0, bottom: a.length }[to];
  a.splice(at, 0, v);
  return a;
}

(async () => {
  // ═══ PART A — the move itself ═══════════════════════════════════════════════════════════════════════════════════════
  {
    const { D } = feature(idb());
    const mv = D && D.moveTrack;
    ok(typeof mv === "function", "A PREMISE — `PlaylistDoc.moveTrack` exists: the move is decided in the pure core, once", D && Object.keys(D));
    if (typeof mv === "function") {
      const tracks = SONGS.map((v) => ({ videoId: v, source: "youtube" }));
      const before = JSON.stringify(tracks);
      for (const to of ["up", "down", "top", "bottom"]) {
        const r = mv(tracks, V(3), to);
        ok(r && r.ok === true && same(r.tracks.map((t) => t.videoId), expect(2, to)),
          "A: MOVE " + to.toUpperCase() + " — the middle song goes " + to + " and nothing else moves", r);
        ok(r && r.ok && r.tracks.length === 5 && new Set(r.tracks.map((t) => t.videoId)).size === 5 && r.tracks.every((t) => t.source === "youtube"),
          "A: " + to + " — every song still there once, each as it was (its fields carried)", r && r.tracks);
      }
      ok(JSON.stringify(tracks) === before, "A: THE LIST IT WAS GIVEN IS UNTOUCHED — the move returns a new list", tracks);
      const refusals = [[V(1), "up", "already first"], [V(1), "top", "already first"], [V(5), "down", "already last"],
        [V(5), "bottom", "already last"], ["nosuchsong1", "up", "not in playlist"], [V(3), "sideways", "not a move"]];
      for (const [v, to, why] of refusals) {
        const r = mv(tracks, v, to);
        ok(r && r.ok === false && r.reason === why && r.tracks === undefined,
          "A: REFUSED BY NAME — " + v + " " + to + " is \"" + why + "\", and no list comes back", r);
      }
      ok(mv(null, V(1), "down").ok === false && mv([], V(1), "down").ok === false, "A: no list, or an empty one, moves nothing and does not throw");
      const one = mv([{ videoId: V(1) }], V(1), "down");
      ok(one.ok === false && one.reason === "already last", "A: a one-song list: its song is both first and last", one);
    }
  }

  // ═══ PART B — the feature, through the real store ═════════════════════════════════════════════════════════════════
  {
    const IDB = idb();
    const { f, id } = await seeded(IDB);
    ok(same(recOf(IDB, id), SONGS), "B PREMISE — a playlist of five songs, written as the app writes it", recOf(IDB, id));
    ok(typeof f.P.moveTrack === "function", "B PREMISE — `Playlists.moveTrack` exists", Object.keys(f.P));
    if (typeof f.P.moveTrack === "function") {
      let order = SONGS.slice();
      for (const [v, to] of [[V(3), "up"], [V(1), "down"], [V(5), "top"], [V(5), "bottom"], [V(4), "top"]]) {
        const i = order.indexOf(v);
        const want = order.slice(); want.splice(i, 1); want.splice({ up: i - 1, down: i + 1, top: 0, bottom: want.length }[to], 0, v);
        const r = await f.P.moveTrack(id, v, to);
        ok(r && r.ok === true && same(recOf(IDB, id), want), "B: " + v + " " + to.toUpperCase() + " IS WRITTEN AT ONCE, ON THIS DEVICE", { r, stored: recOf(IDB, id), want });
        order = want;
      }
      const g = await f.P.get(id);
      ok(g && same(g.tracks.map((t) => t.videoId), order), "B: and the feature reads back what it wrote", g && g.tracks);
      // A RELOAD: a new store and a new feature over the same database.
      const f2 = feature(IDB);
      f2.P.init(); await tick(); await tick();
      const g2 = await f2.P.get(id);
      ok(f2.P.list().some((p) => p.id === id) && g2 && same(g2.tracks.map((t) => t.videoId), order),
        "B: THE ORDER SURVIVES A RELOAD — a fresh store and feature over the same database read the moved order", { list: f2.P.list(), got: g2 && g2.tracks.map((t) => t.videoId), order });
      // REFUSALS WRITE NOTHING.
      const n0 = IDB.writes.length;
      const first = order[0], last = order[order.length - 1];
      const rs = [await f.P.moveTrack(id, first, "up"), await f.P.moveTrack(id, last, "bottom"), await f.P.moveTrack(id, "nosuchsong1", "down"),
        await f.P.moveTrack(id, first, "sideways"), await f.P.moveTrack("pl_none", first, "down")];
      ok(same(rs.map((r) => r && r.reason), ["already first", "already last", "not in playlist", "not a move", "no such playlist"]) && rs.every((r) => r.ok === false),
        "B: THE REFUSALS ARE NAMED — the pure core's, and the feature's own for a playlist that is not there", rs);
      ok(IDB.writes.length === n0 && same(recOf(IDB, id), order), "B: AND A REFUSED MOVE WRITES NOTHING", IDB.writes.slice(n0));
    }
  }
  // ONE AFTER ANOTHER: each edit reads the record, changes it and writes it, so two at once each read the same record and the
  // later write drops the earlier's change. Driven on edits the tree already had (an add and a remove), then with moves.
  {
    const IDB = idb();
    const { f, id } = await seeded(IDB);
    const a = f.P.addTrack(id, V(6)), r = f.P.removeTrack(id, V(1));
    await Promise.all([a, r]); await tick();
    ok(same(recOf(IDB, id), SONGS.slice(1).concat([V(6)])),
      "B: AN ADD AND A REMOVE AT ONCE BOTH LAND — the song added is not lost to the remove's write", recOf(IDB, id));
    if (typeof f.P.moveTrack === "function") {
      const m1 = f.P.moveTrack(id, V(6), "top"), m2 = f.P.moveTrack(id, V(2), "bottom");
      await Promise.all([m1, m2]); await tick();
      ok(same(recOf(IDB, id), [V(6), V(3), V(4), V(5), V(2)]), "B: TWO MOVES AT ONCE BOTH LAND, in the order they were asked", recOf(IDB, id));
      const m3 = f.P.moveTrack(id, V(5), "up"), a2 = f.P.addTrack(id, V(7));
      await Promise.all([m3, a2]); await tick();
      ok(same(recOf(IDB, id), [V(6), V(3), V(5), V(4), V(2), V(7)]), "B: A MOVE AND AN ADD AT ONCE BOTH LAND", recOf(IDB, id));
    }
  }
  {
    const IDB = idb();
    const { f, id } = await seeded(IDB);
    const pend = f.P.addTrack(id, V(6));
    const g = await f.P.get(id);
    await pend;
    ok(g && same(g.tracks.map((t) => t.videoId), SONGS.concat([V(6)])),
      "B: A READ WAITS FOR THE EDITS ASKED BEFORE IT — so a redraw never reads an order older than the one just written", g && g.tracks.map((t) => t.videoId));
  }
  {
    // Reads that take time (5 ms), so the add has read the record before the delete is asked: an add asked first and
    // not yet started would find nothing to write and prove nothing.
    const IDB = idb((v) => new Promise((r) => setTimeout(() => r(v), 5)));
    const { f, id } = await seeded(IDB);
    const pend = f.P.addTrack(id, V(6));
    await new Promise((r) => setTimeout(r, 2));
    const del = f.P.remove(id);
    await Promise.all([pend, del]); await tick(); await tick();
    const f2 = feature(IDB);
    f2.P.init(); await tick(); await tick();
    ok(recOf(IDB, id) === null && !f2.P.list().some((p) => p.id === id),
      "B: A PLAYLIST DELETED WHILE AN EDIT TO IT IS BEING WRITTEN STAYS DELETED — the edit's write does not bring it back, after a reload",
      { record: recOf(IDB, id), list: f2.P.list() });
  }

  // ═══ PART C — the screen ══════════════════════════════════════════════════════════════════════════════════════════
  const NOW = 1.9e12;
  // The screen: the real ui/ files, the real playlists feature and store over a database whose reads take 40 ms; the room
  // queue's data so its own row can be read; everything else answering only what the screen asks.
  async function screen(IDB) {
    let w = null;
    const later = (v) => new Promise((res) => w.sb.setTimeout(() => res(v), 40));
    const db = IDB || idb();
    const delayed = Object.assign({}, db, { get: (s, k) => later(db.map.has(s + k) ? structuredClone(db.map.get(s + k)) : undefined) });
    const f = feature(delayed);
    const rotation = ["@ann:hs", "@bob:hs", "@cat:hs"].map((u, i) => ({ user: u, pending: [{ videoId: ("rq" + i).padEnd(11, "q") }] }));
    const features = {
      Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!r:hs" }), getRoster: () => [],
        onRankChange() {}, onMembersChange() {}, peopleOrder: (fold, roster) => roster.map((m) => ({ member: m, active: null })) },
      Queue: { onStateChange() {}, getNowPlaying: () => ({ dj: "@dj:hs", song: { videoId: "nownownow00" }, pi: "p0" }), getRotation: () => rotation,
        getState: () => ({ counts: {} }), lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000, recentHistory: () => [], historyReach: () => ({ entries: 0, complete: true }) },
      UserQueue: { onChange() {}, items: () => [], count: () => 0, isActive: () => false, stackCount: () => 0, slotState: () => null, add: () => ({ ok: true }) },
      Reactions: { onChange() {}, hasSaved: () => false, hasVoted: () => false },
      Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
      Store: { meta: { peek: (vid) => ({ title: "Title " + vid, durationSec: 200 }), load: () => Promise.resolve(null) }, images: { load: () => Promise.resolve(null) } },
      Playlists: f.P,
      ServerClock: { serverNow: () => NOW },
      Chat: { conversations: () => [], dmUnreadCount: () => 0, setDMVisible() {}, onDMRedaction() {}, onDMMessage() {}, onDMNotify() {}, onDMChange() {}, onMessage() {}, onRedaction() {} },
      ChatPrefs: { videoHidden: () => false, overlayBlocked: () => false, tierList: () => [], layout: () => "wide", load() {}, onChange() {} },
    };
    const MetadataService = { get: () => Promise.resolve(null), ensure: () => Promise.resolve(null), thumbUrl: () => null, ensureThumb: () => Promise.resolve(null) };
    w = S.world({ features, domShaped: true, clock: NOW, globals: { MetadataService } });
    w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
    let entry = null;
    try { w.sb.Screens.enterMainScreen({ roomId: "!r:hs", spaceId: "!s:hs", name: "Test room" }); } catch (e) { entry = String(e && e.message); }
    const qb = w.refs.queueBody;
    const x = {
      w, f, db, entry, qb,
      async frames() { for (let i = 0; i < 4; i++) { w.frame(); await w.settle(); } },
      async settle() { await w.advance(200); await x.frames(); await w.advance(50); },
      rows: () => Array.from(qb.querySelectorAll(".pl-detail-body .song-row")),
      order: () => x.rows().map((r) => r.getAttribute("data-vid")),
      acts: (r) => { const a = r.querySelector(".uq-actions"); return a ? Array.from(a.children) : []; },
      moves: (r) => x.acts(r).filter((n) => /\bpl-ctl\b/.test(n.className || "")),
      btn: (r, title) => x.acts(r).find((n) => n.tag === "button" && n.getAttribute("title") === title) || null,
      plus: (r) => x.acts(r).find((n) => n.textContent === "＋") || null,
      cross: (r) => x.acts(r).find((n) => n.textContent === "✕") || null,
      lock: () => qb.querySelector(".pl-detail-head .panel-lock-btn"),
      locked: () => w.H.plLocked(),
      shown: (n) => w.cas.shown(n, w.main),
      async open(pid) {
        w.refs.tabPlaylists.click(); await x.settle();
        const nm = Array.from(qb.querySelectorAll(".pl-name")).find((b) => b.textContent === "Gym");
        if (nm) nm.click();
        await w.settle();                      // every promise settled, the clock not moved: a read that took no time is in
        return !!nm;
      },
    };
    return x;
  }
  // The playlist on the screen, settled: its read landed.
  async function opened(IDB, pidHolder) {
    const s = await screen(IDB);
    const okOpen = await s.open();
    const atOnce = s.rows().length;     // the first open of a playlist: nothing held yet, the read is out
    await s.settle();
    return { s, okOpen, atOnce };
  }

  {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s, okOpen, atOnce } = await opened(IDB);
    ok(s.entry === null && okOpen && same(s.order(), SONGS),
      "C PREMISE — the main screen was entered, the playlist opened from the library, and its five songs drawn in order", { entry: s.entry, okOpen, order: s.order() });
    ok(atOnce === 0, "C PROBE — THE READ TAKES TIME HERE: opened for the first time, the playlist shows nothing until its read lands — so " +
      "\"at once\" below is a moment before any read (measured once every promise has settled, the clock not moved)", atOnce);
    ok(s.locked() && s.lock() && /\blocked\b/.test(s.lock().className), "C PREMISE — the Playlists panel opens locked", s.lock() && s.lock().className);

    // THE ROOM QUEUE'S MOVES, READ OFF ITS OWN ROW IN THIS WORLD: the order, the glyphs, the names, the separator.
    s.w.refs.tabRoom.click(); await s.settle();
    const rqRows = Array.from(s.qb.querySelectorAll(".song-row")).filter((r) => r.querySelector(".rq-ctl"));
    const rqActs = rqRows.length >= 2 ? Array.from(rqRows[1].querySelector(".uq-actions").children) : [];
    const kind = (n) => n.tag === "button" ? ["button", n.textContent, n.getAttribute("title")] : (/\bq-sep\b/.test(n.className || "") ? ["sep"] : ["?", n.className]);
    const rqMoves = rqActs.slice(0, 5).map(kind);
    ok(rqMoves.length === 5 && same(rqMoves.map((k) => k[0]), ["button", "button", "sep", "button", "button"]) &&
       same(rqMoves.filter((k) => k[0] === "button").map((k) => k[2]), ["Move up", "Move down", "Move to top", "Move to bottom"]),
      "C PREMISE — the room queue's middle row was read: its four moves and the separator between them, in its order", rqMoves);
    s.w.refs.tabPlaylists.click(); await s.settle();
    const nm = Array.from(s.qb.querySelectorAll(".pl-name")).find((b) => b.textContent === "Gym"); if (nm) nm.click();
    await s.settle();
    if (s.lock() && s.locked()) s.lock().click();   // the panel's own lock (a tab click relocks it)
    await s.settle();
    ok(!s.locked() && same(s.order(), SONGS), "C PREMISE — unlocked, the playlist open again in its order", { locked: s.locked(), order: s.order() });
    const r2 = s.rows()[2];
    const plActs = r2 ? s.acts(r2).map(kind) : [];
    const plus = r2 ? s.plus(r2) : null, cross = r2 ? s.cross(r2) : null;
    const pi = plus ? s.acts(r2).indexOf(plus) : -1, ci = cross ? s.acts(r2).indexOf(cross) : -1;
    ok(pi === 0 && ci === plActs.length - 1 && same(plActs.slice(2, 7), rqMoves) && same(plActs[1], ["sep"]) && same(plActs[7], ["sep"]),
      "C: EACH SONG ROW CARRIES THE ROOM QUEUE'S FOUR MOVES, IN ITS ORDER AND WITH ITS GLYPHS — ＋, its separator, ▲ ▼, the separator, " +
      "⏫ ⏬, a separator, ✕ (the owner, `ddjp_654`)", { playlist: plActs, roomQueue: rqMoves });
    const sh = r2 ? s.moves(r2).map((n) => s.shown(n)) : [];
    // CHANGED ON PURPOSE (`ddjp_668`, the owner's rule, `main/04-features.md` §Playlists): unlocked, the row shows no ＋ — it
    // and its separator are hidden by the list's `pl-locked` class, the moves' switch the other way round, so the title has
    // the room on a phone. It read "and ＋ and ✕ usable". `check-list-look` L holds the rule; this row keeps the moves and ✕.
    ok(sh.length === 6 && sh.every(Boolean) && plus && !s.shown(plus) && cross && s.shown(cross) && !cross.disabled,
      "C: UNLOCKED, THE MOVES ARE SHOWN and ✕ usable — and ＋ hidden (the owner's rule since `ddjp_668`)", { moves: sh, plus: plus && s.shown(plus), cross: cross && cross.disabled });
    // THE ENDS.
    const st = (r) => ["Move up", "Move down", "Move to top", "Move to bottom"].map((t) => { const b = s.btn(r, t); return b ? !b.disabled : null; });
    const rows = s.rows();
    ok(same(st(rows[0]), [false, true, false, true]), "C: THE FIRST SONG'S ▲ AND ⏫ ARE DISABLED, ▼ AND ⏬ NOT", st(rows[0]));
    ok(same(st(rows[4]), [true, false, true, false]), "C: THE LAST SONG'S ▼ AND ⏬ ARE DISABLED, ▲ AND ⏫ NOT", st(rows[4]));
    ok([1, 2, 3].every((i) => same(st(rows[i]), [true, true, true, true])), "C: every song between has all four", [1, 2, 3].map((i) => st(rows[i])));
  }

  // EACH MOVE: at once, never empty, never older, the read touching nothing, written, and the typed link kept.
  for (const [i, to, title] of [[2, "up", "Move up"], [2, "down", "Move down"], [2, "top", "Move to top"], [2, "bottom", "Move to bottom"],
                                [4, "top", "Move to top"], [0, "bottom", "Move to bottom"]]) {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s } = await opened(IDB);
    if (s.lock() && s.locked()) s.lock().click();   // unlocked by the panel's own lock
    await s.settle();
    // CHANGED ON PURPOSE AT ddjp_670: the link box is in the playlist's top row now (the owner, W1), the old add line gone.
    const input = s.qb.querySelector(".pl-detail-head input");
    if (input) input.value = "https://youtu.be/half-typed";
    const want = expect(i, to);
    const b = s.rows()[i] ? s.btn(s.rows()[i], title) : null;
    ok(b && !b.disabled && same(s.order(), SONGS), "C PREMISE — song " + (i + 1) + "'s " + title + " is there and usable", { b: !!b, order: s.order() });
    if (!b) continue;
    const reads0 = IDB.writes.length;
    b.click();
    const atOnce = s.order();
    const seen = [atOnce.slice()];
    const watch = s.w.watch(s.qb.querySelector(".pl-detail-body"));
    for (let k = 0; k < 30; k++) { s.w.frame(); await s.w.advance(10); seen.push(s.order()); }
    const rec = watch.take();
    ok(same(atOnce, want), "C: " + title.toUpperCase() + " (song " + (i + 1) + ") SHOWS THE NEW ORDER AT ONCE — before any read lands", { atOnce, want });
    ok(seen.every((o) => o.length === 5), "C: " + title + " — THE LIST NEVER EMPTIES, at once or at any moment after, frames included", seen.map((o) => o.length));
    ok(seen.every((o) => same(o, want)), "C: " + title + " — AND NEVER SHOWS AN OLDER ORDER AGAIN (no blink back)", seen.filter((o) => !same(o, want)).slice(0, 2));
    ok(rec.rowsBuilt === 0 && rec.rowsRemoved === 0, "C: " + title + " — THE READ THAT FOLLOWS AGREES, AND TOUCHES NOTHING", rec);
    ok(same(recOf(IDB, id), want) && IDB.writes.length > reads0, "C: " + title + " — THE NEW ORDER IS WRITTEN, ON THIS DEVICE", { stored: recOf(IDB, id), want });
    const input2 = s.qb.querySelector(".pl-detail-head input");
    ok(input && input2 === input && input2.value === "https://youtu.be/half-typed",
      "C: " + title + " — ONLY THE LIST IS REDRAWN: the add line and a half-typed link in it survive", { same: input2 === input, value: input2 && input2.value });
  }

  // TWO QUICK MOVES: the second clicked before the first's read lands.
  {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s } = await opened(IDB);
    if (s.lock() && s.locked()) s.lock().click();   // unlocked by the panel's own lock
    await s.settle();
    const b1 = s.btn(s.rows()[4], "Move to top");
    if (b1) b1.click();
    const one = s.order();
    await s.w.advance(5);
    const b2 = s.rows()[3] ? s.btn(s.rows()[3], "Move up") : null;
    if (b2) b2.click();
    const two = s.order();
    const seen = [];
    for (let k = 0; k < 30; k++) { s.w.frame(); await s.w.advance(10); seen.push(s.order()); }
    const want1 = [V(5), V(1), V(2), V(3), V(4)], want2 = [V(5), V(1), V(3), V(2), V(4)];
    ok(b1 && b2 && same(one, want1) && same(two, want2), "C PREMISE — two moves clicked 5 ms apart, each shown at once", { one, two });
    ok(seen.every((o) => same(o, want2)), "C: TWO QUICK MOVES — THE FIRST MOVE'S READ NEVER PUTS ITS OLDER ORDER BACK ON SCREEN", seen.filter((o) => !same(o, want2)).slice(0, 2));
    ok(same(recOf(IDB, id), want2), "C: and both are written, in order", recOf(IDB, id));
  }

  // A MOVE'S READ THAT LANDS AFTER A LATER MOVE: the first move's read is asked once its write is done, and answers the first
  // move's order — no longer the screen's once a second move is made. Heard, it becomes the record the next move builds on,
  // and a third move made before the second's own read lands draws over the second one undone.
  {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s } = await opened(IDB);
    if (s.lock() && s.locked()) s.lock().click();
    await s.settle();
    const want2 = [V(5), V(1), V(3), V(2), V(4)], want3 = [V(4), V(5), V(1), V(3), V(2)];   // ⏫ row 5; ▲ row 4; ⏫ row 5
    const b1 = s.rows()[4] ? s.btn(s.rows()[4], "Move to top") : null;
    const w0 = IDB.writes.length;
    if (b1) b1.click();
    let steps = 0;                            // until the first move's write is whole — the record, then the index
    while (b1 && IDB.writes.length < w0 + 2 && steps < 200) { await s.w.advance(1); steps++; }
    await s.w.advance(2);                     // its read is now out
    const b2 = s.rows()[3] ? s.btn(s.rows()[3], "Move up") : null;
    if (b2) b2.click();
    const two = s.order();
    await s.w.advance(45);                    // the first move's read has landed; the second's write is still in its turn
    const b3 = s.rows()[4] ? s.btn(s.rows()[4], "Move to top") : null;
    if (b3) b3.click();
    const seen = [s.order()];
    for (let k = 0; k < 60; k++) { s.w.frame(); await s.w.advance(5); seen.push(s.order()); }
    ok(b1 && b2 && b3 && same(two, want2) && IDB.writes.length >= w0 + 2,
      "C PREMISE — the first move written whole (" + steps + " ms), the second made while its read was out, the third after that read landed", { two });
    ok(seen.every((o) => same(o, want3)), "C: A MOVE'S READ THAT LANDS AFTER A LATER MOVE IS NOT HEARD — the third move builds on the second, at once and after",
      { want3, seen: seen.filter((o) => !same(o, want3)).slice(0, 2) });
    ok(same(recOf(IDB, id), want3), "C: and all three are written, in order", recOf(IDB, id));
  }
  // MOVES DURING A REDRAW'S READ: the lock redraws the panel from the record held and reads it again; two moves are made before
  // that read lands. The read was asked before the moves, so it answers the order before them: it must not become the record
  // the next move builds on, or the second move draws over the first one undone.
  {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s } = await opened(IDB);
    if (s.lock() && s.locked()) s.lock().click();
    await s.settle();
    if (s.lock()) s.lock().click();            // locked: a full redraw
    await s.settle();
    if (s.lock()) s.lock().click();            // unlocked again: a full redraw from the record held, its read out
    const b1 = s.rows()[0] ? s.btn(s.rows()[0], "Move to bottom") : null;
    if (b1) b1.click();
    await s.w.advance(45);                    // the redraw's read lands (40 ms), with the order before the move; the move's
                                              // write is still in its turn
    const b2 = s.rows()[0] ? s.btn(s.rows()[0], "Move to bottom") : null;
    if (b2) b2.click();
    const seen = [s.order()];
    for (let k = 0; k < 40; k++) { s.w.frame(); await s.w.advance(5); seen.push(s.order()); }
    const want = [V(3), V(4), V(5), V(1), V(2)];
    ok(b1 && b2 && !s.locked(), "C PREMISE — two moves made while a redraw's read was out, unlocked", { b1: !!b1, b2: !!b2, locked: s.locked() });
    ok(seen.every((o) => same(o, want)), "C: MOVES DURING A REDRAW'S READ — THE READ DOES NOT BECOME THE RECORD THE NEXT MOVE BUILDS ON: both moves on screen, at once and after",
      { want, seen: seen.filter((o) => !same(o, want)).slice(0, 2) });
    ok(same(recOf(IDB, id), want), "C: and both are written", recOf(IDB, id));
  }

  // LOCKED: the moves hidden and inert; ✕ greyed; ＋ shown (unlocked, hidden: the owner's rule since `ddjp_668`).
  {
    const IDB = idb();
    const { id } = await seeded(IDB);
    const { s } = await opened(IDB);
    ok(s.locked() && same(s.order(), SONGS), "C PREMISE — locked, the playlist open", { locked: s.locked(), order: s.order() });
    const r = s.rows()[2];
    const mv = r ? s.moves(r) : [];
    ok(mv.length >= 4, "C PREMISE — locked, the moves are built (hidden, not absent: the lock toggles their class, as the room queue's)", mv.length);
    ok(mv.length >= 4 && mv.every((n) => !s.shown(n)), "C: LOCKED, THE MOVES ARE HIDDEN — as the room queue's are while it is locked (`.roomq-locked .rq-ctl`)", mv.map((n) => s.shown(n)));
    const cross = r ? s.cross(r) : null, plus = r ? s.plus(r) : null;
    ok(cross && s.shown(cross) && cross.disabled === true, "C: LOCKED, ✕ STAYS VISIBLE AND GREYED, exactly as before", cross && { shown: s.shown(cross), disabled: cross.disabled });
    // CHANGED ON PURPOSE (`ddjp_668`): the words only — ＋ is shown locked, as before, and no longer always (above).
    ok(plus && s.shown(plus) && !plus.disabled, "C: LOCKED, ＋ IS SHOWN AND USABLE, as before", plus && { shown: s.shown(plus), disabled: plus.disabled });
    const down = r ? s.btn(r, "Move down") : null;
    const n0 = IDB.writes.length;
    if (down) { down.disabled = false; down.click(); }
    await s.settle();
    ok(down && same(s.order(), SONGS) && same(recOf(IDB, id), SONGS) && IDB.writes.length === n0,
      "C: LOCKED, A CLICK THAT REACHES A MOVE DOES NOTHING — nothing moves on screen, nothing is written", { order: s.order(), writes: IDB.writes.slice(n0) });
    // The lock's own button unlocks: the moves are then shown, ✕ usable.
    if (s.lock()) s.lock().click();
    await s.settle();
    const r2 = s.rows()[2];
    // CHANGED ON PURPOSE (`ddjp_668`, the owner's rule): unlocked, ＋ is hidden; it read "＋ shown".
    ok(!s.locked() && r2 && s.moves(r2).length === 6 && s.moves(r2).every((n) => s.shown(n)) && s.cross(r2) && !s.cross(r2).disabled && s.plus(r2) && !s.shown(s.plus(r2)),
      "C CONTROL: one click on the panel's lock and the moves are there, ✕ usable, ＋ hidden", { locked: s.locked() });
  }
  // THE PROBE BOTH WAYS: the hidden-ness this guard reads is the sheet's, and it discriminates.
  {
    const IDB = idb();
    await seeded(IDB);
    const { s } = await opened(IDB);
    const r = s.rows()[1];
    const anyMove = r ? s.moves(r)[0] : null;
    const lockedHidden = anyMove ? !s.shown(anyMove) : null;
    if (s.lock() && s.locked()) s.lock().click();   // unlocked by the panel's own lock
    await s.settle();
    const r2 = s.rows()[1];
    const unlockedShown = r2 && s.moves(r2)[0] ? s.shown(s.moves(r2)[0]) : null;
    ok(lockedHidden === true && unlockedShown === true, "C PROBE — the sheet's answer moves with the lock: hidden locked, shown unlocked (one element kind, two answers)",
      { lockedHidden, unlockedShown });
  }

  // THE ORDER SURVIVES A RELOAD, ON THE SCREEN: a move, then a fresh world over the same database.
  {
    const IDB = idb();
    await seeded(IDB);
    const { s } = await opened(IDB);
    if (s.lock() && s.locked()) s.lock().click();   // unlocked by the panel's own lock
    await s.settle();
    const b = s.rows()[0] ? s.btn(s.rows()[0], "Move to bottom") : null;
    if (b) b.click();
    await s.settle();
    const { s: s2 } = await opened(IDB);
    ok(b && same(s2.order(), expect(0, "bottom")), "C: THE ORDER SURVIVES A RELOAD — a fresh screen over the same database opens the playlist in the moved order", s2.order());
  }

  _finished = true;
  if (failed) { console.log("[playlist-moves] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[playlist-moves] PASS — a playlist's songs move as the room queue's do (J131 A, the owner's at `ddjp_654`; " + asserts +
    " assertions): the move is decided once, in the pure core — up, down, top, bottom, the ends refused by name, never a song lost; " +
    "the feature writes it at once through the real store and it survives a reload; a playlist's edits are written one after another, " +
    "so two quick edits both land, a read waits for them and a deleted playlist stays deleted. On the screen each row carries the room " +
    "queue's four moves, read off the room queue's own row: in its order and with its glyphs, the ends disabled, hidden while the " +
    "Playlists panel is locked and inert then, ✕ greyed while locked and ＋ shown only while locked; a move shows the new order at once from the " +
    "held record, never empties the list or shows an older order, and the read that follows touches nothing; the typed link survives.");
})().catch((e) => { _finished = true; console.log("[playlist-moves] FAIL — threw: " + String(e && e.stack || e).split("\n").slice(0, 4).join(" | ")); process.exit(1); });
