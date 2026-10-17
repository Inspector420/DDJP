// tests/check-rep-bot.js
// SUBJECT: features/rep-bot.js, features/rep-ports.js, features/room.js
//
// WALL: REP'S BOT SIDE COUNTS EACH VOTE AND SAVE ONCE, KEEPS ITS TABLE, WRITES FROM ONE TAB, AND SENDS SUMMARIES AND
// ADDITIONS BY THE RULES, FILLS BACK OR REBUILDS WHAT IT MISSED, AND ANSWERS ITS OWNER (J84-2, J84-4, J84-5; the owner's
// rulings 17, 20, 21a, 25, 28, 30c, 32 and Q2–Q8; DESIGN-J84-REP.md §3.1–§3.4, §4.2, §4.4, §5.1–§5.3). Driven through `Rep` (the app's one entry) with the real rules and
// ports over recording stubs of the app — the room's reactions, song history, the current playing, who is active, the
// transport, the server (paged, and the owner-level channel read back), the store, the prefs and the lock — on a clock and
// timers this guard moves by hand. PART H drives the hooks through the real `features/room.js` on the bot's tab.
//
//   A  COUNTING WITH RECEIPTS: a re-delivery, the reducer's no-op duplicate, a relay batch's member and the held log
//      counted again at readiness each count once; a vote and a save by one person both count; a refused reaction, a
//      reaction on a playing before the cut and `ddjp.count.set` never; a reaction naming a playing song history has not
//      shown yet is held, and counted when it does.
//   B  THE TABLE PERSISTS: saved one second after a change; a new session loads it and carries on, counting nothing
//      twice; a stored table that does not read is no table.
//   C  THE SINGLE WRITER: with the lock, it writes; refused, it counts and sends nothing and says so; with no Web Locks
//      it writes and says so.
//   D  THE BASE (Q4; J84-4): no table and the room held from its start — counted from the start; not held whole but
//      younger than the window — paged from its start and counted; older than the window with no message of its own —
//      nothing counted, nothing published, and the log says so in Q4's words.
//   E  SUMMARIES: nothing before the tab is caught up; the first at the song change (the new playing its cut), or at
//      once with nothing playing (the last song's play its cut); due again at one interval only if something changed,
//      and then at the song change; an unchanged one at 1.5 intervals, at once; its rows are the bot's view's people,
//      each as of the cut; the serial only rises; a reaction on a closed playing counts for nothing.
//   F  ADDITIONS: a newly active person gets an addition with their split as of the summary's cut, under that summary's
//      own id, learned from its echo; at least 5 s after any REP message, batched; past 20 people a fresh summary instead.
//   G  THE SIZE CAP AND THE LEFT-OUT RULE: a big room's summary stays under the budget, highest REP first, the rest
//      counted; while it is capped, a newcomer below the lowest REP kept is left out (and not new again), one above it
//      gets an addition.
//   H  THE HOOKS (H1, H2) ON THE BOT'S TAB: the room's entry starts the bot side; a rank change in the same room keeps it
//      running; the one leave step stops it — listeners and timers gone, table saved, lock released, nothing sent; a tab
//      that is not the bot runs none of it.
//   I  WHAT IT PUBLISHES IS ITS OWN COUNT: each named person's row plus the reactions at and after the cut, counted by
//      the same rules, is the bot's own number for them.
//   J  THE FILL-BACK (J84-4, the design's §3.2): from the cut, within the window, the held log and the stretch below it
//      paged (`events` only) — a relay batch's member as its actor, receipts throughout, a closed playing never; nothing
//      sent while it runs, a fresh summary after it; one that cannot read the server is tried again.
//   K  THE REBUILD (§3.2): with its storage lost, from its OWN summaries and additions within the window, each person from
//      their own message's cut — the same numbers as the original for everyone they name, a late reaction the original
//      never counted not counted now, someone unnamed not recovered, its last summary its own newest.
//   L  THE WINDOW (ruling 20): its own setting (1–365 days, a week by default); a reaction older than it is not filled,
//      held or not; a gap longer than it says how many days were not filled and moves `since` to its edge.
//   M  COMMANDS (J84-5, §5.2): the owner's `!rep @user` and the six top lists, from the full table under the current
//      settings, in the tier asked in; a delegated rank and the bot refused; never a DM; never history; the cooldown and
//      the room limit; 512 characters ("top N of M"); no coverage text; commands off; no table.
//   N  FILES (§5.3, Q4, Q7): the export; Replace — the backup first every time, cancel at the pick or the preview changes
//      nothing, a bad file refused, another room flagged, confirmed: replaced never merged, cut at the current play, a
//      fresh summary at once; Start fresh; Look further back, once, 1–365 days.
//   O  THE BOT'S OWN SETTINGS AND THE CARD (§5.1, H4): the rows and their ranges, a change saved and used, refused out of
//      range, read back at start; a tab that only reads offers nothing; one that is not the bot has no card.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-bot] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[rep-bot] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, T0 = 1700000000000;
// An event older than the default window (a week): the server holding it makes a read from the room's start stop by time.
const OLD = { eventId: "$old", type: "ddjp.dj.play", sender: "@dj:hs", content: { t: "ddjp.dj.play" }, l: 1, ts: T0 - 8 * DAY };
const BOT = "@bot:hs", SID = "!space:hs", CH = { events_owner: "!own:hs", events_uncategorized: "!in:hs" };
const TIER_U = "!chat-u:hs", TIER_S = "!chat-s:hs";   // the room's chat tiers (J84-5's commands are answered only there)

// ── THE WORLD: the real rules, ports and bot side over recording stubs ─────────────────────────────────────────────────
function world(o) {
  o = o || {};
  // J84-4: the world has a SERVER now — the room's whole log (`server`, else what the tab holds), paged by `pageRange` with
  // its window stop, and the owner-level channel read back by `readChannelBack` (`own`, the bot's messages there) — and
  // the bot's prefs (`prefs`), because the bot fills back from the server and rebuilds from its own messages.
  const w = { now: T0, sent: [], saved: [], logs: [], rows: [], np: null, active: [], legal: Object.create(null), held: [],
    whole: o.whole !== false, may: o.may !== false, lock: ("lock" in o) ? o.lock : true, released: 0, stored: o.stored || null,
    timers: [], reactL: [], rawL: [], bot: o.bot !== false, sendAnswer: null, echoed: 0,
    server: o.server || null, own: o.own || [], prefs: o.prefs || null, heldFrom: ("heldFrom" in o) ? o.heldFrom : undefined,
    pages: [], readBacks: [], pageFail: false, readFail: false,
    // J84-5: chat (its listeners and the replies sent), the room's tiers and name, everyone's level, the saved prefs.
    chatL: [], replies: [], prefsSaved: [], levels: Object.assign({ "@owner:hs": 100, [BOT]: 99, "@staff:hs": 50 }, o.levels || {}), cid: 0,
    settings: Object.assign({ repSummaryMs: HOUR, repSelfVotes: false, repSelfSaves: false }, o.settings || {}) };
  const ctx = {
    setTimeout: (fn, ms) => { const h = { fn, ms, live: true, kind: "t" }; w.timers.push(h); return h; },
    clearTimeout: (h) => { if (h) h.live = false; },
    setInterval: (fn, ms) => { const h = { fn, ms, live: true, kind: "i" }; w.timers.push(h); return h; },
    clearInterval: (h) => { if (h) h.live = false; },
    StreamManager: { on: (t, fn) => { w.reactL.push([t, fn]); }, off: (t, fn) => { w.reactL = w.reactL.filter((x) => !(x[0] === t && x[1] === fn)); },
      getLog: () => w.held.slice(), isLegal: (id) => (id in w.legal ? w.legal[id] : true), holdsWholeRoom: () => w.whole,
      heldFrom: () => (w.heldFrom !== undefined ? w.heldFrom : (w.whole ? null : undefined)),
      getState: () => ({ settings: w.settings, nowPlaying: w.np ? { pi: w.np, dj: "@dj:hs" } : null }) },
    MatrixBridge: {
      roomHistory: (limit) => { const r = w.rows.slice().sort((a, b) => b.l - a.l); return typeof limit === "number" ? r.slice(0, limit) : r; },
      onRawEvent: (fn) => { w.rawL.push(fn); }, offRawEvent: (fn) => { w.rawL = w.rawL.filter((f) => f !== fn); },
      sendSide: (ch, type, body) => {
        const l = (w.server || w.held).reduce((m, e) => Math.max(m, e.l || 0), 0) + 1;   // its position: above all it has seen
        w.sent.push({ ch: ch, type: type, body: JSON.parse(JSON.stringify(body)), at: w.now, l: l });
        return Promise.resolve(w.sendAnswer || { ok: true });
      },
      pageRange: (from, to, opts) => {
        const nb = opts && typeof opts.notBeforeTs === "number" ? opts.notBeforeTs : null;
        w.pages.push({ from: from, to: to, notBeforeTs: nb, kinds: opts && opts.kinds });
        if (w.pageFail) return Promise.resolve([]);
        if (w.pageDefer) return new Promise((res) => { w.release = () => { w.pageDefer = false; res(page()); }; });
        return Promise.resolve(page());
        function page() {
        const all = (w.server || w.held).filter((e) => e.l >= from && e.l <= to);
        const out = all.filter((e) => nb === null || !(e.ts < nb)).map((e) => JSON.parse(JSON.stringify(e)));
        out.reachedFrom = from;
        if (nb !== null && all.some((e) => e.ts < nb)) { out.stoppedByTime = true; out.reachedFrom = Math.min.apply(null, out.map((e) => e.l).concat([to + 1])); }
        return out;
        }
      },
      readChannelBack: (ch, key, since) => {
        w.readBacks.push({ key: key, since: since });
        const out = w.readFail ? [] : w.own.filter((m) => m.ts >= since).map((m) => JSON.parse(JSON.stringify(m)));
        out.ok = !w.readFail;
        return Promise.resolve(out);
      },
      getUserId: () => BOT, mayAuthor: () => ({ ok: w.may }), getUserEffectiveRank: (sid, ch, u) => w.levels[u] || 0 },
    Room: { presenceView: (now) => ({ people: w.active.map((u) => ({ userId: u, lastTs: now })) }),
      chatTiers: () => ({ tiers: [{ tier: "uncategorized", id: TIER_U, main: true }, { tier: "staff", id: TIER_S, main: false }] }),
      getCurrent: () => ({ name: "Test Room", spaceId: SID }) },
    Chat: { onMessage: (fn) => { w.chatL.push(fn); }, sendTo: (id, text) => { w.replies.push({ id: id, text: text }); return Promise.resolve({ ok: true }); } },
    Capabilities: { can: (verb, t, c) => ({ permitted: verb === "bot.command" && !!c && c.myRank >= 100 }) },
    ServerClock: { serverNow: () => w.now },
    Store: { rep: {
      load: async () => (w.stored ? JSON.parse(JSON.stringify(w.stored)) : null),
      loadPrefs: async () => (w.prefs ? JSON.parse(JSON.stringify(w.prefs)) : null),
      savePrefs: async (sid, p) => { w.prefsSaved.push(JSON.parse(JSON.stringify(p))); w.prefs = JSON.parse(JSON.stringify(p)); return true; },
      save: async (sid, t) => { w.saved.push(JSON.parse(JSON.stringify(t))); w.stored = JSON.parse(JSON.stringify(t)); return true; },
      writerLock: async (sid, held) => { if (w.lock === true) { Promise.resolve(held({})).then(() => { w.released++; }); return true; } return w.lock; } } },
    BotRuntime: { actingAsBot: () => w.bot },
    Logger: { info: (m) => w.logs.push(m), warn: (m) => w.logs.push("WARN " + m), debug() {}, error() {} },
  };
  const sb = loadInContext(["features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js"], ctx);
  w.sb = sb; w.R = sb.RepRules; w.B = sb.RepBot;
  w.flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  w.enter = async () => { sb.Rep.enter({ spaceId: SID, channels: CH }); await w.flush(); };
  w.leave = async (why) => { sb.Rep.leave(why || "the tab left the room"); await w.flush(); };
  w.step = async () => { w.B._stepForTest(); await w.flush(); };
  w.st = () => w.B._stateForTest();
  w.play = (pi, l, dj) => { w.rows.push({ pi: pi, l: l, dj: dj || "@dj:hs", videoId: "v-" + pi }); w.np = pi; };
  w.react = (id, type, who, pi, l) => {
    const e = { eventId: id, type: type, sender: who, content: { t: type, p: pi }, l: l || 0, ts: w.now };
    w.held.push(e);
    for (const [t, fn] of w.reactL.slice()) if (t === type) fn(e);
    return e;
  };
  w.vote = (id, who, pi, l) => w.react(id, "ddjp.dj.vote", who, pi, l);
  w.save = (id, who, pi, l) => w.react(id, "ddjp.dj.save", who, pi, l);
  // The echo of every summary not yet heard back: its raw event on the owner-level channel, from the bot.
  w.echo = () => {
    for (const m of w.sent) {
      if (m.type !== w.R.TYPES.summary || m.echoed) continue;
      m.echoed = true; m.id = "$sum" + (++w.echoed);
      const raw = { room_id: CH.events_owner, sender: BOT, event_id: m.id, type: "m.room.message", ddjpType: m.type, ddjpBody: m.body };
      for (const fn of w.rawL.slice()) fn(raw);
    }
  };
  // The bot's messages heard back, as the owner-level channel holds them for a read-back: stamped by the transport.
  w.ownFromSent = () => w.sent.filter((m) => m.id).map((m) => ({ id: m.id, sender: BOT, ts: m.at, l: m.l, type: m.type,
    body: Object.assign({}, m.body, { t: m.type, l: m.l, dv: 2, hv: 1 }) }));
  w.echoAll = () => { for (const m of w.sent) { if (m.echoed) continue; m.echoed = true; m.id = m.id || ("$msg" + (++w.echoed)); } };
  // A chat message, live (now) unless told otherwise, in the uncategorized tier unless told otherwise.
  w.say = async (who, text, o2) => {
    const q = o2 || {};
    for (const fn of w.chatL.slice()) fn("$c" + (++w.cid), who, text, false, ("ts" in q) ? q.ts : w.now, q.room || TIER_U, false);
    await w.flush();
  };
  w.fireSaves = async () => { for (const h of w.timers.slice()) if (h.live && h.kind === "t" && h.ms === w.B.SAVE_MS) { h.live = false; h.fn(); } await w.flush(); };
  w.summaries = () => w.sent.filter((m) => m.type === w.R.TYPES.summary);
  w.additions = () => w.sent.filter((m) => m.type === w.R.TYPES.addition);
  w.live = () => w.timers.filter((h) => h.live);
  return w;
}
// A person's six numbers in the bot's table: the base plus the forward record, through the rules' own sums.
function total(w, u) {
  const st = w.st();
  if (!st || !st.table) return null;
  const add = w.R.contributions(st.table.fwd);
  return w.R.plus(st.table.base[u] || w.R.zero(), add[u] || w.R.zero());
}
// Each J84-5 part runs on its own: one that throws says so by name, and the parts after it still run.
async function part(id, fn) {
  try { await fn(); } catch (e) { ok(false, id + ": threw — " + ((e && e.message) || e)); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The table a world's bot side holds, or an empty one — so a part goes on reading when there is none.
const tb = (w) => (w.st() && w.st().table) || { base: {}, last: null, cut: null, since: undefined };

(async () => {
  // ── A — COUNTING WITH RECEIPTS ─────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    w.play("$p1", 10, "@dj:hs");
    w.vote("$v0", "@pre:hs", "$p1", 11);   // in the held log before the bot side started
    await w.enter();
    const st = w.st();
    ok(st && st.writer === true && st.loaded && st.ready && st.table, "A PREMISE — the bot side runs, writes, and has a table (the room is held from its start)", st);
    ok(eq(w.reactL.map((x) => x[0]).sort(), ["ddjp.dj.save", "ddjp.dj.vote"]), "A: it hears votes and saves and nothing else — `ddjp.count.set` never reaches it", w.reactL.map((x) => x[0]));
    w.vote("$v1", "@a:hs", "$p1", 12);
    w.vote("$v1", "@a:hs", "$p1", 12);          // re-delivered
    w.vote("$v1b", "@a:hs", "$p1", 13);         // the reducer's no-op duplicate: same person, same playing, a new id
    w.vote("$carrier#2", "@b:hs", "$p1", 14);    // a relay batch's member: the actor is the sender
    w.save("$s1", "@a:hs", "$p1", 15);
    w.legal["$v9"] = false; w.vote("$v9", "@c:hs", "$p1", 16);   // the room refused it
    w.vote("$v0", "@pre:hs", "$p1", 11);        // the held log's reaction, live again
    ok(eq(total(w, "@a:hs"), [1, 0, 1, 0, 0, 0]) && eq(total(w, "@b:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w, "@pre:hs"), [1, 0, 0, 0, 0, 0]),
      "A: a re-delivery, the no-op duplicate, a batch member and the held log again each count once; a vote and a save both count",
      { a: total(w, "@a:hs"), b: total(w, "@b:hs"), pre: total(w, "@pre:hs") });
    ok(eq(total(w, "@dj:hs"), [0, 3, 0, 1, 0, 0]), "A: the DJ receives each — three votes and a save", total(w, "@dj:hs"));
    ok(total(w, "@c:hs") === null || eq(total(w, "@c:hs"), w.R.zero()), "A: a reaction the room refused counts for nothing", total(w, "@c:hs"));
    w.vote("$v5", "@d:hs", "$p2", 25);           // names a playing song history has not shown yet
    ok(eq(total(w, "@d:hs"), w.R.zero()) && w.st().table.fwd.held.length === 1, "A: a reaction on a playing not yet in song history is HELD, not counted", w.st().table.fwd.held);
    w.rows.push({ pi: "$p2", l: 20, dj: "@dj2:hs" });   // song history shows it (the current song unchanged, so no summary moves the cut)
    w.now += 2000;
    await w.step();
    ok(eq(total(w, "@d:hs"), [1, 0, 0, 0, 0, 0]) && w.st().table.fwd.held.length === 0, "A: and counted once song history shows it", total(w, "@d:hs"));
    w.vote("$v6", "@dj:hs", "$p1", 26);          // a self-vote: kept apart
    ok(eq(total(w, "@dj:hs"), [0, 3, 0, 1, 1, 0]), "A: a vote on one's own playing is a self-vote, kept apart (shown by the room's setting)", total(w, "@dj:hs"));
  }

  // ── B — THE TABLE PERSISTS ─────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    w.play("$p1", 10);
    await w.enter();
    w.vote("$v1", "@a:hs", "$p1", 11);
    ok(w.live().some((h) => h.kind === "t" && h.ms === w.B.SAVE_MS) && w.saved.length === 0, "B: a change arms the save, one second on — nothing written yet", w.saved.length);
    await w.fireSaves();
    ok(w.saved.length === 1 && w.saved[0].room === SID && w.saved[0].v === w.B.TABLE_V, "B: and it is written then, for this room", w.saved.length);
    w.vote("$v1x", "@x:hs", "$p1", 13);
    const savedBefore = w.saved.length;
    await w.leave();
    ok(w.saved.length === savedBefore + 1 && w.saved[w.saved.length - 1].fwd.byPi["$p1"].v["@x:hs"] === 1,
      "B: the leave saves the table as it stands, the change of the last second included", w.saved.length - savedBefore);
    const w2 = world({ stored: w.stored });
    w2.rows = w.rows.slice(); w2.np = "$p1"; w2.held = w.held.slice();
    await w2.enter();
    w2.vote("$v1", "@a:hs", "$p1", 11);          // the same vote, heard again after the reload
    w2.vote("$v2", "@b:hs", "$p1", 12);
    ok(eq(total(w2, "@a:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w2, "@b:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w2, "@dj:hs"), [0, 3, 0, 0, 0, 0]),
      "B: a new session loads the table and carries on — the vote heard again after the reload counts nothing", { a: total(w2, "@a:hs"), dj: total(w2, "@dj:hs") });
    ok(w2.logs.some((l) => /^REP: bot side started for .* — table of \d+ people/.test(l)), "B: and says it started from its table", w2.logs);
    // RE-AIMED AT J84-4: with no table the bot now looks for a base (its own messages, the room's start) — so the room here
    // is older than the window and the bot has published nothing, leaving no base: the stored table must not have been one.
    const w3 = world({ stored: Object.assign({}, w.stored, { v: 99 }), whole: false, server: [OLD] });
    await w3.enter();
    ok(w3.st() && w3.st().table === null && w3.st().noBase === true && w3.logs.some((l) => /— no table; window/.test(l)),
      "B: a stored table that does not read (another version) is no table at all", w3.st());
  }

  // ── C — THE SINGLE WRITER ──────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world({ lock: false });
    w.play("$p1", 10);
    await w.enter();
    w.vote("$v1", "@a:hs", "$p1", 11);
    w.now += 2 * HOUR; await w.step();
    ok(w.st() && w.st().writer === false && w.st().table === null && w.sent.length === 0 && w.reactL.length === 0,
      "C: another tab of this account holds the lock — this one counts nothing, sends nothing, and stops listening", w.st());
    ok(w.logs.some((l) => /another tab of this account writes REP for this room — this tab only reads/.test(l)), "C: and says so", w.logs);
    const n = world({ lock: null });
    n.play("$p1", 10);
    await n.enter();
    ok(n.st().writer === true && n.logs.some((l) => /no single-writer lock \(no Web Locks\)/.test(l)), "C: with no Web Locks it writes, and says there is no lock", n.logs);
    const y = world();
    await y.enter();
    ok(y.st().writer === true && y.released === 0, "C: with the lock it writes, and holds the lock while it runs");
    await y.leave();
    ok(y.released === 1, "C: and the leave releases it", y.released);
  }

  // ── D — THE BASE ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    // RE-AIMED AT J84-4: a room this tab does not hold whole is no longer refused outright — it is paged from its start
    // within the window. Refused (Q4) only when it is OLDER than the window and the bot has no message of its own in it.
    const w = world({ whole: false, server: [OLD] });
    w.play("$p1", 10);
    await w.enter();
    w.vote("$v1", "@a:hs", "$p1", 11);
    w.stopPlaying = null; w.np = null; w.active = ["@a:hs"];
    w.now += 2 * HOUR; await w.step();
    ok(w.st().noBase === true && w.st().table === null && w.sent.length === 0,
      "D: no table, no summary of its own, and a room older than the window — nothing counted, nothing published (Q4)", w.st());
    ok(w.logs.some((l) => /^REP: no table and no summary within the window \(7 days\) — import a reputation file, or start fresh$/.test(l)),
      "D: and the log says why, in Q4's words", w.logs);
    const y = world({ whole: false });
    y.play("$p1", 10); y.vote("$y1", "@a:hs", "$p1", 11); y.save("$y2", "@b:hs", "$p1", 12);
    await y.enter();
    ok(eq(total(y, "@dj:hs"), [0, 1, 0, 1, 0, 0]) && y.st().table.since === null && y.pages.length === 1 && y.pages[0].from === 0 &&
       y.logs.some((l) => /the room is younger than the window: counted from its start \(2 event\(s\) paged, 1 vote\(s\) and 1 save\(s\) counted/.test(l)),
      "D: no table, not held whole, but YOUNGER than the window — paged from its start and counted, exact", { dj: total(y, "@dj:hs"), logs: y.logs });
    const s = world();
    s.play("$p1", 10); s.vote("$v0", "@a:hs", "$p1", 11); s.vote("$v00", "@b:hs", "$p1", 12);
    await s.enter();
    ok(eq(total(s, "@dj:hs"), [0, 2, 0, 0, 0, 0]) && s.st().table.since === null && s.logs.some((l) => /counting this room from its start, which this tab holds \(2 vote/.test(l)),
      "D: no table and the room held from its start — the held log is counted from the start, exact", s.logs);
  }

  // ── E — SUMMARIES ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world({ may: false });
    w.play("$p1", 10, "@dj:hs");
    w.active = ["@a:hs", "@dj:hs"];
    await w.enter();
    w.np = null; await w.step();
    ok(w.sent.length === 0 && w.st().ready === false, "E: nothing goes before the tab is caught up — a summary built then would be a partial count", w.st());
    w.may = true; w.np = "$p1";
    w.vote("$v1", "@a:hs", "$p1", 11);
    await w.step();
    ok(w.summaries().length === 0, "E: the first summary waits for the song change while a song plays", w.sent.length);
    w.play("$p2", 20, "@a:hs");
    w.now += 15000; await w.step();
    const s1 = w.summaries()[0];
    ok(s1 && eq(s1.body.cut, { pi: "$p2", pos: 20 }) && s1.ch.events_owner === CH.events_owner, "E: at the song change it goes, the new playing its cut, on the owner-level channel", s1 && s1.body.cut);
    const rows1 = s1 ? s1.body.rows.map((r) => w.R.decodeRow(r)) : [];
    ok(rows1.length === 2 && eq(rows1.find((r) => r.user === "@a:hs").split, [1, 0, 0, 0, 0, 0]) && eq(rows1.find((r) => r.user === "@dj:hs").split, [0, 1, 0, 0, 0, 0]),
      "E: its rows are the people active in the bot's view, each as of the cut — the closed playing folded in", rows1);
    ok(w.logs.some((l) => /^REP: summary n=\d+ cut l=20 — 2 people, \d+ bytes \(the first summary, at the song change\)$/.test(l)), "E: and the log line says so", w.logs.filter((l) => /summary/.test(l)));
    w.vote("$late", "@b:hs", "$p1", 30);           // a late vote on the closed playing
    ok(total(w, "@b:hs") === null || eq(total(w, "@b:hs"), w.R.zero()), "E: a reaction on a playing before the cut counts for nothing — closed for everyone, the bot included", total(w, "@b:hs"));
    w.now += 30 * MIN; w.vote("$v2", "@dj:hs", "$p2", 31); w.play("$p3", 40);
    await w.step();
    ok(w.summaries().length === 1, "E: not again before the interval, though something changed and a song changed", w.summaries().length);
    w.now += 31 * MIN; await w.step();
    ok(w.summaries().length === 1, "E: past the interval with a change, it waits for the next song change", w.summaries().length);
    w.play("$p4", 50); w.now += 15000; await w.step();
    const s2 = w.summaries()[1];
    ok(s2 && eq(s2.body.cut, { pi: "$p4", pos: 50 }) && s2.body.n > s1.body.n, "E: and goes at it — a new cut, a higher serial", s2 && [s2.body.cut, s2.body.n, s1.body.n]);
    w.now += 61 * MIN; await w.step();                    // past the interval, nothing changed, the same song
    w.play("$p5", 60); w.now += 15000; await w.step();     // and then a song change
    ok(w.summaries().length === 2, "E: an UNCHANGED summary is not sent at one interval, song change or not", w.summaries().length);
    w.now += 30 * MIN; await w.step();
    const s3 = w.summaries()[2];
    ok(s3 && w.summaries().length === 3 && s3.body.n > s2.body.n, "E: but at 1.5 intervals it goes at once, unchanged, so no device's look-back is ever empty (C12)", w.summaries().length);
    const e2 = world();
    e2.rows.push({ pi: "$q1", l: 5, dj: "@dj:hs" }); e2.np = null; e2.active = ["@x:hs"];
    await e2.enter();
    const q = e2.summaries()[0];
    ok(q && eq(q.body.cut, { pi: "$q1", pos: 5 }), "E: with nothing playing it goes at once, the last song's play its cut", q && q.body.cut);
  }

  // ── F — ADDITIONS ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    w.rows.push({ pi: "$p0", l: 5, dj: "@dj:hs" }, { pi: "$p1", l: 10, dj: "@dj:hs" }); w.np = null;
    w.vote("$v1", "@c:hs", "$p0", 6);   // on a playing BEFORE the cut the summary will take ($p1, the last song's play)
    w.active = ["@a:hs"];
    await w.enter();
    const s1 = w.summaries()[0];
    ok(s1 && s1.body.rows.length === 1 && eq(s1.body.cut, { pi: "$p1", pos: 10 }), "F PREMISE — a summary naming one person, cut at the last song's play", s1 && s1.body);
    w.vote("$v1c", "@c:hs", "$p1", 12);   // and on the cut playing: forward — not in a split AS OF THE CUT
    w.active = ["@a:hs", "@c:hs"];
    w.now += 10000; await w.step();
    ok(w.additions().length === 0, "F: a newly active person waits until the summary's own id is heard back", w.sent.length);
    w.echo(); w.now += 1000; await w.step();
    const a1 = w.additions()[0];
    ok(a1 && a1.body.of === "$sum1" && a1.body.n === s1.body.n && a1.body.k === 1 && eq(a1.body.rows, [["@c:hs", 1]]),
      "F: then an addition — under that summary's id and serial, with their split as of its cut", a1 && a1.body);
    ok(w.logs.some((l) => /^REP: addition to n=\d+ — 1 people \(1 since the summary\)$/.test(l)), "F: and the log line says so", w.logs.filter((l) => /addition/.test(l)));
    w.active = ["@a:hs", "@c:hs", "@d:hs"];
    w.now += 1000; await w.step();
    w.active = ["@a:hs", "@c:hs", "@d:hs", "@e:hs"];
    w.now += 1000; await w.step();
    ok(w.additions().length === 1, "F: none within 5 s of the last REP message", w.additions().length);
    w.now += 4000; await w.step();
    const a2 = w.additions()[1];
    ok(a2 && a2.body.k === 2 && eq(a2.body.rows.map((r) => r[0]), ["@d:hs", "@e:hs"]), "F: and then ONE addition for everyone who came in between", a2 && a2.body);
    const many = [];
    for (let i = 0; i < 25; i++) many.push("@m" + String(i).padStart(2, "0") + ":hs");
    w.active = ["@a:hs", "@c:hs", "@d:hs", "@e:hs"].concat(many);
    w.now += 6000; await w.step(); w.now += 6000; await w.step();
    ok(w.additions().length === 2 && w.summaries().length === 2 && w.summaries()[1].body.rows.length === 29,
      "F: past 20 people added under one summary, a FRESH summary goes instead, naming everyone (ruling 25; Q3: people)", { adds: w.additions().length, sums: w.summaries().length });
  }

  // ── G — THE SIZE CAP AND THE LEFT-OUT RULE ────────────────────────────────────────────────────────────────────────
  {
    const people = [];
    for (let i = 0; i < 1500; i++) people.push("@" + "member-with-a-long-name-".repeat(4) + String(i).padStart(4, "0") + ":example.org");
    const base = {};
    people.forEach((u, i) => { base[u] = [i + 1, 0, 0, 0, 0, 0]; });
    base["@low:hs"] = [0, 0, 0, 0, 0, 0]; base["@high:hs"] = [100000, 0, 0, 0, 0, 0];
    const stored = { v: 1, room: SID, since: null, base: base, cut: null, fwd: { byPi: {}, held: [] }, last: null, lastMsgAt: null, counted: 0, heard: null };
    const w = world({ stored: stored });
    w.rows.push({ pi: "$p1", l: 10, dj: "@dj:hs" }); w.np = null;
    w.active = people.slice();
    await w.enter();
    const s = w.summaries()[0];
    const bytes = s ? w.R.sentBytes(s.type, s.body) : 0;
    const reps = s ? s.body.rows.map((r) => r[1] || 0) : [];
    ok(s && bytes <= w.R.LIMITS.budgetBytes && s.body.more > 0 && s.body.rows.length + s.body.more === 1500,
      "G: a big room's summary, as sent, stays under the budget; the rest are counted in `more` (ruling 28)", { bytes: bytes, kept: s && s.body.rows.length, more: s && s.body.more });
    ok(reps.every((v, i) => i === 0 || reps[i - 1] >= v) && reps[0] === 1500, "G: the people kept are the highest REP, in order", reps.slice(0, 3));
    w.echo();
    w.active = people.concat(["@low:hs"]);
    w.now += 6000; await w.step();
    ok(w.additions().length === 0 && w.st().table.last.leftOut.indexOf("@low:hs") >= 0, "G: while capped, a newcomer below the lowest REP kept is LEFT OUT — no addition", w.additions().length);
    w.active = people.concat(["@low:hs", "@high:hs"]);
    w.now += 6000; await w.step();
    const a = w.additions()[0];
    ok(a && eq(a.body.rows.map((r) => r[0]), ["@high:hs"]), "G: one above it gets an addition — and the left-out person is not new again", a && a.body.rows);
  }

  // ── H — THE HOOKS, ON THE BOT'S TAB, THROUGH THE REAL ROOM ─────────────────────────────────────────────────────────
  {
    const T = require(path.join(__dirname, "_tabworld.js"));
    const w = T.realWorld();
    w.enter();
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
    const st = w.sb.RepBot._stateForTest();
    ok(st && st.spaceId === T.ROOM && st.writer === true, "H: H1 — the room's entry on the bot's tab starts the bot side, for this room", st);
    const gen = st && st.gen;
    w.sb.Rep.enter({ spaceId: T.ROOM, channels: T.CH });   // what a rank change in the same room does, through H1
    ok(w.sb.RepBot._stateForTest() && w.sb.RepBot._stateForTest().gen === gen, "H: a rank change in the same room keeps it running — the same session, its table and lock kept");
    // REP's bot-side tick, the bot's own sweep (the same period), and since J84-3 REP's reader tick, which runs on every
    // tab and so on the bot's too (`check-rep-reader` H holds the reader's own lifecycle) — three, one of each.
    const tick = () => w.timers.live().filter((t) => t.ms === w.sb.RepBot.TICK_MS);
    ok(w.sb.RepBot._stateForTest().timers.tick === true && w.sb.RepReader._stateForTest() && w.sb.RepReader._stateForTest().timers.tick === true &&
      tick().length === 3, "H: APPLIED — while it runs, its tick is armed beside the bot's sweep and the reader's tick", tick().length);
    const sentBefore = w.sent ? w.sent.length : 0;
    w.sb.Room.leave("a guard's leave");
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    ok(w.sb.RepBot._stateForTest() === null && tick().length === 0, "H: H2 — the one leave step stops it: no session, its tick gone", tick().length);
    ok(w.logs.some((m) => /REP: stopped — the tab left the room \(a guard's leave\);/.test(m)), "H: and it says why, beside the bot's own stop", w.logs.filter((m) => /REP:/.test(m)));
    ok(!w.sent || w.sent.slice(sentBefore).every((m) => !/ddjp\.side\./.test(m.t || "")), "H: and nothing is sent at the leave", w.sent && w.sent.slice(sentBefore));
    const v = world({ bot: false });
    await v.enter();
    ok(v.st() === null && v.reactL.length === 0 && v.timers.length === 0, "H: a tab that is not the room's bot runs none of it — no session, no listener, no timer", v.st());
    const u = world();
    await u.enter();
    u.bot = false; u.sb.Rep.enter({ spaceId: SID, channels: CH });   // demoted, through H1
    ok(u.st() === null && u.reactL.length === 0 && u.live().length === 0, "H: and a rank change away from the bot stops it — listeners and timers gone", u.live().length);
  }

  // ── I — WHAT IT PUBLISHES IS ITS OWN COUNT ────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    w.play("$p1", 10, "@dj:hs");
    w.vote("$v1", "@a:hs", "$p1", 11); w.save("$s1", "@b:hs", "$p1", 12);
    w.active = ["@a:hs", "@b:hs", "@dj:hs"];
    await w.enter();
    w.play("$p2", 20, "@a:hs");
    w.now += 15000; await w.step();
    w.vote("$v2", "@b:hs", "$p2", 21); w.vote("$v3", "@dj:hs", "$p2", 22); w.save("$s2", "@a:hs", "$p2", 23);
    const s = w.summaries()[0];
    const pub = w.R.published(Object.assign({}, w.R.readSummary(s.body).value, { id: "$x", l: 1 }), []);
    const cut = s.body.cut, plays = { "$p1": { pi: "$p1", l: 10, dj: "@dj:hs" }, "$p2": { pi: "$p2", l: 20, dj: "@a:hs" } };
    const acc = w.R.newAccumulator();
    for (const e of w.held) w.R.add(acc, { type: e.type, voter: e.sender, pi: e.content.p }, plays[e.content.p], cut, true);
    const fwd = w.R.contributions(acc);
    const mism = ["@a:hs", "@b:hs", "@dj:hs"].filter((u) => !eq(w.R.plus(pub[u], fwd[u] || w.R.zero()), total(w, u)));
    ok(s && mism.length === 0, "I: each named person's published row plus what followed the cut, by the same rules, is the bot's own count", mism);
  }


  // ── J — THE FILL-BACK, FROM THE CUT, WITHIN THE WINDOW (J84-4; the design's §3.2, §3.4) ──────────────────────────────
  const ev = (id, type, who, pi, l, ts) => ({ eventId: id, type: type, sender: who, content: { t: type, p: pi }, l: l, ts: (typeof ts === "number") ? ts : T0 - 30 * MIN });
  // A table from before the bot went away: cut at $p2 (l=20), A's vote on $p2 counted then — its receipt kept.
  const awayTable = (o) => Object.assign({ v: 1, room: SID, since: null, base: { "@a:hs": [2, 0, 0, 0, 0, 0], "@dj:hs": [0, 2, 0, 0, 0, 0] },
    cut: { pi: "$p2", pos: 20 }, fwd: { byPi: { "$p2": { dj: "@dj:hs", l: 20, v: { "@a:hs": 1 }, s: {} } }, held: [] },
    last: { n: T0 - HOUR, at: T0 - HOUR, id: "$sumOld", named: ["@a:hs", "@dj:hs"], leftOut: [], more: 0, lowestKept: null, activeSig: "", adds: { k: 0, people: [] } },
    lastMsgAt: T0 - HOUR, counted: 0, heard: { l: 21, ts: T0 - HOUR } }, o || {});
  const awayRows = (w) => { w.rows.push({ pi: "$p1", l: 10, dj: "@dj:hs" }, { pi: "$p2", l: 20, dj: "@dj:hs" }, { pi: "$p3", l: 28, dj: "@b:hs" }); w.np = "$p3"; };
  {
    // The tab holds the room from l=30 (a save point at 29 in a bot room, a trim in a shared one); the server holds the rest.
    const w = world({ stored: awayTable(), heldFrom: 30 });
    awayRows(w);
    w.server = [ev("$va", "ddjp.dj.vote", "@a:hs", "$p2", 21), ev("$vb", "ddjp.dj.vote", "@b:hs", "$p2", 22), ev("$sc", "ddjp.dj.save", "@c:hs", "$p2", 23),
      ev("$vlate", "ddjp.dj.vote", "@d:hs", "$p1", 24), ev("$relay7#2", "ddjp.dj.vote", "@c:hs", "$p3", 29), ev("$vd", "ddjp.dj.vote", "@d:hs", "$p3", 31)];
    w.held = [w.server[5]];
    w.active = ["@a:hs", "@b:hs", "@dj:hs"];
    await w.enter();
    ok(w.pages.length === 1 && w.pages[0].from === 20 && w.pages[0].to === 29 && JSON.stringify(w.pages[0].kinds) === '["events"]' && w.pages[0].notBeforeTs === T0 - 7 * DAY,
      "J: FROM THE CUT, WITHIN THE WINDOW — the stretch between the cut and the held log is paged, the `events` channels only, no older than a week", w.pages);
    ok(eq(total(w, "@a:hs"), [3, 0, 0, 0, 0, 0]) && eq(total(w, "@b:hs"), [1, 2, 0, 0, 0, 0]) && eq(total(w, "@c:hs"), [1, 0, 1, 0, 0, 0]) &&
       eq(total(w, "@d:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w, "@dj:hs"), [0, 4, 0, 1, 0, 0]),
      "J: WHAT HAPPENED WHILE IT WAS AWAY IS COUNTED — paged and held alike, a relay batch's member as its actor; a late vote on a closed playing never",
      { a: total(w, "@a:hs"), b: total(w, "@b:hs"), c: total(w, "@c:hs"), d: total(w, "@d:hs"), dj: total(w, "@dj:hs") });
    ok(w.logs.some((l) => /^REP: filling back from l=20 \(the last 7 day\(s\)\) — 5 event\(s\) paged, 3 vote\(s\) and 1 save\(s\) counted, 1 already counted$/.test(l)),
      "J: RECEIPTS THROUGHOUT — A's vote, counted before it went away, is \"already counted\", and the log says what was filled", w.logs.filter((l) => /filling/.test(l)));
    const sum = w.summaries()[0];
    ok(sum && w.logs.some((l) => /^REP: summary n=\d+ cut l=28 — .* \(after the fill-back \(4 counted\)\)$/.test(l)),
      "J: and a fresh summary follows at once (§4.2)", w.logs.filter((l) => /summary/.test(l)));
    w.react("$relay7#2", "ddjp.dj.vote", "@c:hs", "$p3", 29);   // the same member, heard again live
    ok(eq(total(w, "@c:hs"), [1, 0, 1, 0, 0, 0]), "J: and the member heard again counts nothing", total(w, "@c:hs"));
  }
  {
    // NOTHING IS SENT WHILE IT FILLS: the page is held open; two intervals have passed, nothing playing — due at once, and not sent.
    const w = world({ stored: awayTable(), heldFrom: 30 });
    awayRows(w); w.np = null; w.active = ["@a:hs"];
    w.server = [ev("$va", "ddjp.dj.vote", "@b:hs", "$p2", 22)];
    w.pageDefer = true; w.now = T0 + 2 * HOUR;
    await w.enter(); await w.step();
    ok(w.st().fill === "running" && w.sent.length === 0, "J: NOTHING IS SENT WHILE A FILL-BACK RUNS — a summary due at once waits for it", w.st());
    if (w.release) w.release();   // (no page was asked for, on a bot side that does not fill back: nothing to release)
    await w.flush();
    ok(w.st().fill === null && w.summaries().length === 1, "J: and goes when it is done", w.summaries().length);
    const f = world({ stored: awayTable(), heldFrom: 30 });
    awayRows(f); f.np = null; f.active = ["@a:hs"];
    f.pageFail = true;
    await f.enter();
    ok(f.st().fill === "retry" && f.sent.length === 0 && f.logs.some((l) => /^REP: the fill-back could not read the room back — tried again at the next look$/.test(l)),
      "J: A FILL-BACK THAT CANNOT READ the server sends nothing, says so, and is tried again", f.logs);
    f.pageFail = false; f.now += 15000; await f.step();
    ok(f.st().fill === null && f.logs.some((l) => /^REP: filling back from l=20/.test(l)), "J: at the next look — and then it fills", f.logs.filter((l) => /fill/.test(l)));
  }

  // ── K — THE REBUILD, AFTER STORAGE LOSS (J84-4; the design's §3.2) ─────────────────────────────────────────────────────
  {
    // THE ORIGINAL: two summaries and an addition, people active and not, a late vote. Its table is the truth.
    const w = world();
    w.play("$p1", 10, "@dj:hs");
    w.vote("$k1", "@a:hs", "$p1", 11); w.vote("$k2", "@b:hs", "$p1", 12); w.vote("$k3", "@u:hs", "$p1", 13);   // u is never active: never named
    w.vote("$k3y", "@y:hs", "$p1", 14);                                 // y: active only after the second summary — an addition under it
    w.active = ["@a:hs", "@b:hs", "@dj:hs"];
    await w.enter();
    w.play("$p2", 20, "@a:hs"); w.now += 15000; await w.step();
    w.echo();
    w.vote("$k4", "@b:hs", "$p2", 21); w.vote("$k5", "@x:hs", "$p2", 22); w.vote("$k6", "@dj:hs", "$p2", 23); w.vote("$k6u", "@u:hs", "$p2", 24);
    w.active = ["@a:hs", "@b:hs", "@dj:hs", "@x:hs"];
    w.now += 6000; await w.step();                                   // x: an addition under the first summary
    w.echoAll();
    w.active = ["@a:hs", "@dj:hs", "@x:hs"];                           // b stops being active: never in a later summary
    w.now += 61 * MIN; await w.step();
    w.play("$p3", 30, "@x:hs"); w.now += 15000; await w.step();       // the second summary, cut at $p3
    w.echo(); w.echoAll();
    w.active = ["@a:hs", "@dj:hs", "@x:hs", "@y:hs"];
    w.now += 6000; await w.step();                                   // y: an addition under the second summary
    w.echoAll();
    w.save("$k7", "@b:hs", "$p2", 35);                                 // LATE, on a playing the second summary closed — b's own cut is older
    w.vote("$k8", "@b:hs", "$p3", 36); w.save("$k9", "@a:hs", "$p3", 37);
    const S = w.summaries(), A = w.additions();
    ok(S.length === 2 && A.length === 2 && S[1].body.cut.pos === 30 && A[0].body.rows[0][0] === "@x:hs" && A[1].body.rows[0][0] === "@y:hs" && A[1].body.of === S[1].id,
      "K: PREMISE — the original sent two summaries (cuts l=20, l=30), an addition naming x under the first and one naming y under the second",
      { s: S.map((m) => m.body.cut), a: A.map((m) => [m.body.of, m.body.rows]) });
    // STORAGE LOST: a fresh tab of the bot, no table, opened from a save point at l=24; the server holds the whole room.
    const r = world({ stored: null, whole: false, heldFrom: 25, server: w.held.slice(), own: w.ownFromSent().concat([
      { id: "$fake", sender: "@owner:hs", ts: w.now, l: 999, type: w.R.TYPES.summary,
        body: Object.assign(w.R.summary({ n: w.now + 5, cut: { pi: "$p3", pos: 30 }, since: null, rows: [{ user: "@a:hs", split: [99] }], more: 0 }), { t: w.R.TYPES.summary, l: 999, dv: 2, hv: 1 }) }]) });
    r.rows = w.rows.slice(); r.np = w.np; r.now = w.now; r.active = w.active.slice();
    r.held = w.held.filter((e) => e.l >= 25);
    await r.enter();
    ok(r.readBacks.length === 1 && r.readBacks[0].key === "events_owner" && r.readBacks[0].since === r.now - 7 * DAY,
      "K: IT READS ITS OWN MESSAGES BACK on the owner-level channel, within the window", r.readBacks);
    const people = ["@a:hs", "@b:hs", "@dj:hs", "@x:hs", "@y:hs"];
    const off = people.filter((u) => !eq(total(r, u), total(w, u)));
    ok(off.length === 0, "K: THE SAME NUMBERS AS BEFORE for everyone its messages name — the newest message naming each, as of its own cut, " +
      "plus what they earned from that cut on (b, named only in the first summary, from l=20; x from the second; y from its addition)", off.map((u) => [u, total(r, u), total(w, u)]));
    ok(!(tb(r).base["@u:hs"]) && tb(w).base["@u:hs"], "K: someone no message names is not recoverable — no row, until an import (§3.2) — though the original had one",
      [tb(r).base["@u:hs"], tb(w).base["@u:hs"]]);
    ok((total(w, "@b:hs") || [])[2] === 0 && (total(r, "@b:hs") || [])[2] === 0,
      "K: and a late save the original never counted — on a playing the second summary had closed, though at or after b's own cut — is not counted now",
      [total(r, "@b:hs"), total(w, "@b:hs")]);
    ok(r.pages.length === 1 && r.pages[0].from === 20 && r.pages[0].to === 24, "K: filled back from the OLDEST cut it used, to the start of its held log", r.pages);
    const L = tb(r).last;
    ok(L && L.n === S[1].body.n && L.id === S[1].id && eq(tb(r).cut, S[1].body.cut),
      "K: its last summary is the newest of its own — not the owner's planted one with a higher serial — so additions go on under its id", L);
    ok(r.logs.some((l) => /^REP: rebuilt the table from its own messages within the window — 5 people from 2 summary\(ies\) and 2 addition\(s\); cut l=30; filling back from l=20/.test(l)),
      "K: and the log says so", r.logs.filter((l) => /rebuilt/.test(l)));
    r.now += 6000; await r.step();   // 5 s after its last message (ruling 25)
    ok(r.summaries().length === 1 && r.summaries()[0].body.n > S[1].body.n && r.logs.some((l) => /\(after the fill-back \(\d+ counted\)\)$/.test(l)),
      "K: a fresh summary follows, with a higher serial", r.summaries().map((m) => m.body.n));
  }

  // ── L — THE WINDOW, AND A GAP LONGER THAN IT (J84-4; ruling 20, the design's §3.2) ─────────────────────────────────────
  {
    // Away ten days, a window of a week: what the tab holds older than the window is not counted, the three days beyond it
    // are said, and `since` moves to the window's edge.
    const w = world({ stored: awayTable({ heard: { l: 21, ts: T0 - 10 * DAY }, last: Object.assign(awayTable().last, { at: T0 - 10 * DAY, n: T0 - 10 * DAY }), lastMsgAt: T0 - 10 * DAY }) });
    awayRows(w); w.np = null; w.active = ["@a:hs"];
    w.held = [ev("$o1", "ddjp.dj.vote", "@b:hs", "$p2", 22, T0 - 9 * DAY), ev("$o2", "ddjp.dj.vote", "@c:hs", "$p2", 25, T0 - DAY)];
    await w.enter();
    ok(eq(total(w, "@b:hs"), [0, 0, 0, 0, 0, 0]) || total(w, "@b:hs") === null, "L: a reaction older than the window is not filled — held or not", total(w, "@b:hs"));
    ok(eq(total(w, "@c:hs"), [1, 0, 0, 0, 0, 0]), "L: one inside it is", total(w, "@c:hs"));
    ok(w.logs.some((l) => /^REP: 3 day\(s\) beyond the window were not filled$/.test(l)) && tb(w).since === T0 - 7 * DAY,
      "L: BEYOND THE WINDOW — the log says how many days were not filled, and `since` moves to the window's edge", { logs: w.logs, since: tb(w).since });
    const p = world({ stored: awayTable(), heldFrom: 30, prefs: { windowDays: 2 } });
    awayRows(p); p.active = ["@a:hs"];
    await p.enter();
    ok(p.pages[0] && p.pages[0].notBeforeTs === T0 - 2 * DAY && p.logs.some((l) => /; window 2 day\(s\)$/.test(l)),
      "L: THE WINDOW IS THE BOT'S OWN SETTING — two days stored, two days filled", { pages: p.pages, logs: p.logs });
    const q = world({ stored: awayTable(), heldFrom: 30, prefs: { windowDays: 400 } });
    awayRows(q); q.active = ["@a:hs"];
    await q.enter();
    ok(q.pages[0] && q.pages[0].notBeforeTs === T0 - 7 * DAY, "L: and one outside 1–365 days is not read — the default week", q.pages);
  }

  // ── M — COMMANDS (J84-5; the design's §5.2, rulings 17 and 32) ─────────────────────────────────────────────────────────
  const cmdTable = () => ({ v: 1, room: SID, since: null,
    base: { "@a:hs": [3, 4, 1, 2, 1, 0], "@b:hs": [2, 9, 0, 5, 0, 0], "@dj:hs": [0, 6, 0, 0, 0, 2] }, cut: { pi: "$p2", pos: 20 },
    fwd: { byPi: { "$p2": { dj: "@dj:hs", l: 20, v: { "@a:hs": 1 }, s: {} } }, held: [] },
    last: { n: T0 - 10 * MIN, at: T0 - 10 * MIN, id: "$s0", named: ["@a:hs", "@b:hs", "@dj:hs"], leftOut: [], more: 0, lowestKept: null, activeSig: "", adds: { k: 0, people: [] } },
    lastMsgAt: T0 - 10 * MIN, counted: 0, heard: { l: 21, ts: T0 - 10 * MIN } });
  const cmdWorld = (o) => { const w = world(Object.assign({ stored: cmdTable() }, o || {}));
    w.rows.push({ pi: "$p1", l: 10, dj: "@a:hs" }, { pi: "$p2", l: 20, dj: "@dj:hs" }); w.np = "$p2"; w.active = ["@a:hs"]; return w; };
  const lastReply = (w) => w.replies[w.replies.length - 1] || { id: null, text: "" };
  await part("M", async () => {
    const w = cmdWorld();
    await w.enter();
    await w.say("@owner:hs", "!rep @a:hs");
    ok(w.replies.length === 1 && lastReply(w).id === TIER_U && lastReply(w).text === "@a:hs VG=4 VR=4 SG=1 SR=2",
      "M: THE OWNER ASKS, THE BOT ANSWERS — from its full table (base plus what followed the cut), in the tier asked in", w.replies);
    ok(w.logs.some((l) => l === "REP: command !rep @a:hs from @owner:hs → replied in uncategorized"), "M: and the log says so", w.logs.filter((l) => /command/.test(l)));
    ok(w.replies.length > 0 && !/since|counted/i.test(lastReply(w).text), "M: and no coverage text — the numbers alone (Q6)", lastReply(w).text);
    w.now += 61000; w.settings.repSelfVotes = true;
    await w.say("@owner:hs", "!rep @a:hs", { room: TIER_S });
    ok(lastReply(w).id === TIER_S && lastReply(w).text === "@a:hs VG=5 VR=5 SG=1 SR=2",
      "M: under the room's CURRENT settings (a self-vote now counts both ways), and in the staff tier when asked there", lastReply(w));
    w.settings.repSelfVotes = false;
    const n0 = w.replies.length;
    await w.say("@owner:hs", "!rep @a:hs");
    ok(w.replies.length === n0 && w.logs.some((l) => /^REP: command !rep @a:hs from @owner:hs ignored — cooldown$/.test(l)),
      "M: THE COOLDOWN PER PERSON — again within a minute, ignored, not answered, one line", w.logs.filter((l) => /ignored/.test(l)));
    await w.say("@staff:hs", "!rep @a:hs"); await w.say(BOT, "!rep @a:hs");
    ok(w.replies.length === n0 && w.logs.filter((l) => /ignored — not the owner$/.test(l)).length === 2,
      "M: OWNER ONLY — a delegated rank and the bot itself are refused, silently (`bot.command`, above the ladder)", w.logs.filter((l) => /ignored/.test(l)));
    w.now += 61000;
    await w.say("@owner:hs", "!rep @a:hs", { room: "!dm-owner:hs" });
    ok(w.replies.length === n0 && w.logs.some((l) => /ignored — a DM$/.test(l)), "M: NEVER A DM — nor any channel that is not one of the room's chat tiers (ruling 17)", w.replies.length);
    await w.say("@owner:hs", "!rep @a:hs", { ts: T0 - 1000 });
    await w.say("@owner:hs", "!rep @a:hs", { ts: w.now - 3 * MIN });
    ok(w.replies.length === n0, "M: HISTORY IS NEVER ANSWERED — a command from before the bot side started, or older than two minutes", w.replies.length);
    await w.say("@owner:hs", "!rep @zz:hs");
    ok(lastReply(w).text === "@zz:hs is not in the reputation table.", "M: someone the table does not hold is said to be not in it — never a row of zeros", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @topvr");
    ok(lastReply(w).text === "Top 3 by votes received: 1. @b:hs 9 · 2. @dj:hs 7 · 3. @a:hs 4", "M: @topvr — by votes received", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @TOPV");
    ok(lastReply(w).text === "Top 3 by votes: 1. @b:hs 11 · 2. @a:hs 8 · 3. @dj:hs 7", "M: @topv — by both (REP), the keyword in any case", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @tops");
    ok(lastReply(w).text === "Top 2 by saves: 1. @b:hs 5 · 2. @a:hs 3", "M: @tops — by saves both ways; nobody at 0 is listed", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @topsg");
    ok(lastReply(w).text === "Top 1 by saves given: 1. @a:hs 1", "M: @topsg — by saves given", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @topvg"); w.now += 61000; await w.say("@owner:hs", "!rep @topsr");
    ok(/^Top 2 by votes given: 1\. @a:hs 4 · 2\. @b:hs 2$/.test(w.replies[w.replies.length - 2].text) && /^Top 2 by saves received: 1\. @b:hs 5 · 2\. @a:hs 2$/.test(lastReply(w).text),
      "M: @topvg and @topsr — the other two", w.replies.slice(-2));
    w.now += 61000; await w.say("@owner:hs", "!rep foo");
    ok(w.logs.some((l) => /^REP: command !rep foo from @owner:hs ignored — not a command it knows/.test(l)), "M: a command it does not know is ignored, with a line", w.logs.filter((l) => /foo/.test(l)));
    ok(w.B.setPref("cooldownS", 0).ok === true && w.B.setPref("roomLimit", 2).ok === true, "M: PREMISE — no cooldown, two replies a minute");
    w.now += 61000;
    const r0 = w.replies.length;
    await w.say("@owner:hs", "!rep @a:hs"); await w.say("@owner:hs", "!rep @b:hs"); await w.say("@owner:hs", "!rep @dj:hs");
    ok(w.replies.length === r0 + 2 && w.logs.some((l) => /^REP: command !rep @dj:hs from @owner:hs ignored — room limit$/.test(l)),
      "M: THE ROOM-WIDE LIMIT — the third reply within the minute is not sent", w.replies.length - r0);
  });
  await part("M", async () => {
    const people = {};
    for (let i = 0; i < 12; i++) people["@" + "a-rather-long-matrix-user-name-".repeat(2) + String(i).padStart(2, "0") + ":example.org"] = [0, 100 + i];
    const w = cmdWorld({ stored: Object.assign(cmdTable(), { base: people }) });
    await w.enter();
    await w.say("@owner:hs", "!rep @topvr");
    const t = lastReply(w) ? lastReply(w).text : "";
    ok(t.length <= 512 && /^Top (\d+) of 10 by votes received: 1\. @a-rather/.test(t) && Number(/^Top (\d+)/.exec(t)[1]) < 10,
      "M: AT MOST 512 CHARACTERS — a top ten that would not fit shows as many as fit, and says \"top N of 10\"", { len: t.length, head: t.slice(0, 40) });
    const off = cmdWorld({ prefs: { commands: false } });
    await off.enter();
    await off.say("@owner:hs", "!rep @a:hs");
    ok(off.replies.length === 0 && off.logs.some((l) => /ignored — commands are off on this device$/.test(l)), "M: commands off — nothing answered, and the line says why", off.logs);
    const nb = world({ whole: false, server: [OLD] });
    await nb.enter();
    await nb.say("@owner:hs", "!rep @a:hs");
    ok(lastReply(nb) && lastReply(nb).text === "No reputation table yet.", "M: with no table, it says so — no number", nb.replies);
  });

  // ── N — EXPORT, REPLACE, START FRESH, LOOK FURTHER BACK (J84-5; the design's §5.3, Q4, Q7, ruling 14) ─────────────────
  const recUi = (o) => {
    const u = { calls: [], downloads: [], pickAnswer: o && o.pick, confirmAnswer: o && o.confirm, lines: null, other: null };
    u.download = (name, data) => { u.calls.push("download"); u.downloads.push({ name: name, data: JSON.parse(JSON.stringify(data)) }); };
    u.pick = () => { u.calls.push("pick"); return Promise.resolve(u.pickAnswer); };
    u.confirm = (lines, opt) => { u.calls.push("confirm"); u.lines = lines; u.other = !!(opt && opt.other); return Promise.resolve(u.confirmAnswer); };
    return u;
  };
  const file = (o) => Object.assign({ format: "ddjp-rep-table", v: 1, room: SID, roomName: "Test Room", exportedAt: T0 - DAY, since: null, people: 2,
    rows: { "@a:hs": [10, 10], "@new:hs": [0, 3] } }, o || {});
  await part("N", async () => {
    const w = cmdWorld();
    w.held = [{ eventId: "$hc", type: "ddjp.dj.vote", sender: "@c:hs", content: { t: "ddjp.dj.vote", p: "$p2" }, l: 22, ts: T0 - MIN },
      { eventId: "$hd", type: "ddjp.dj.vote", sender: "@d:hs", content: { t: "ddjp.dj.vote", p: "$p1" }, l: 12, ts: T0 - 2 * MIN }];
    await w.enter();
    const ex = recUi();
    ok(w.B.exportTable(ex).ok === true && ex.downloads.length === 1 && ex.downloads[0].name === "ddjp-rep-test-room-2023-11-14.json",
      "N: EXPORT — one file, named for the room and the day", ex.downloads.map((d) => d.name));
    const d = ex.downloads[0] && ex.downloads[0].data;
    ok(d && d.format === "ddjp-rep-table" && d.v === 1 && d.room === SID && d.roomName === "Test Room" && d.exportedAt === T0 && d.people === 4 &&
       eq(d.rows["@a:hs"], [4, 4, 1, 2, 1, 0]) && eq(d.rows["@c:hs"], [1, 0, 0, 0, 0, 0]),
      "N: the whole table as it is now — base plus what followed the cut, everyone", d);
    const before = JSON.stringify(w.st().table);
    const c1 = recUi({ pick: null });
    const r1 = await w.B.replaceTable(c1, false);
    ok(c1.calls.join() === "download,pick" && /-backup\.json$/.test(c1.downloads[0].name) && r1.ok === false && JSON.stringify(w.st().table) === before,
      "N: REPLACE — THE BACKUP DOWNLOADS FIRST, before the file is even asked for; cancelled at the pick, NOTHING CHANGED", { calls: c1.calls, r: r1 });
    const c2 = recUi({ pick: { format: "something-else" } });
    const r2 = await w.B.replaceTable(c2, false);
    ok(r2.ok === false && r2.why === "not a reputation file" && JSON.stringify(w.st().table) === before && c2.calls.join() === "download,pick",
      "N: a file that is not a reputation table is refused with the reason, nothing changed, never previewed", r2);
    const c3 = recUi({ pick: file(), confirm: false });
    const r3 = await w.B.replaceTable(c3, false);
    ok(c3.calls.join() === "download,pick,confirm" && r3.ok === false && JSON.stringify(w.st().table) === before,
      "N: cancelled at the preview — nothing changed", { calls: c3.calls, r: r3 });
    // The preview NAMES the people and the room (the owner's J84-5 item 2, "a preview naming the room and the people"):
    // each person by ID with their REP under the current settings, highest first, and this room by its name.
    ok(eq(c3.lines, ["2 people: @a:hs (20 REP), @new:hs (3 REP)", "Exported 2023-11-13", "This room: Test Room", "Votes and saves since 2023-11-13 are not added."]) && c3.other === false,
      "N: THE PREVIEW names the people, the date, the room — and that votes since are not added (Q7)", c3.lines);
    const many = {}; for (let i = 0; i < 10; i++) many["@p" + i + ":hs"] = [i + 1, 0];
    const c3b = recUi({ pick: file({ people: 10, rows: many }), confirm: false });
    await w.B.replaceTable(c3b, false);
    ok(c3b.lines && c3b.lines[0] === "10 people: @p9:hs (10 REP), @p8:hs (9 REP), @p7:hs (8 REP), @p6:hs (7 REP), @p5:hs (6 REP), " +
       "@p4:hs (5 REP), @p3:hs (4 REP), @p2:hs (3 REP) and 2 more" && JSON.stringify(w.st().table) === before,
      "N: a long file: the first eight by REP named, the rest counted", c3b.lines && c3b.lines[0]);
    const c4 = recUi({ pick: file({ room: "!other:hs", roomName: "Other Room" }), confirm: false });
    await w.B.replaceTable(c4, false);
    ok(c4.lines && c4.lines[2] === "ANOTHER ROOM: Other Room (!other:hs)" && c4.other === true, "N: a file from ANOTHER ROOM is named and flagged (ruling 14)", c4.lines);
    const nSum = w.summaries().length;
    w.now += 6000;
    const c5 = recUi({ pick: file(), confirm: true });
    const r5 = await w.B.replaceTable(c5, false);
    await w.flush();
    const t = w.st().table;
    ok(r5.ok === true && eq(t.base, { "@a:hs": [10, 10, 0, 0, 0, 0], "@new:hs": [0, 3, 0, 0, 0, 0] }),
      "N: CONFIRMED, THE TABLE IS REPLACED — NEVER MERGED: the file's rows exactly; those only in the old table are gone", t.base);
    ok(eq(t.cut, { pi: "$p2", pos: 20 }) && eq(total(w, "@c:hs"), [1, 0, 0, 0, 0, 0]) && (total(w, "@d:hs") === null || eq(total(w, "@d:hs"), w.R.zero())),
      "N: cut at the current song's play — what this tab holds from it counted forward, what came before it not", { cut: t.cut, c: total(w, "@c:hs"), d: total(w, "@d:hs") });
    const fresh = w.summaries()[nSum];
    ok(fresh && w.logs.some((l) => /\(after a Replace\)$/.test(l)) && fresh.body.n > cmdTable().last.n,
      "N: A FRESH SUMMARY GOES AT ONCE, with a higher serial — devices take it", w.logs.filter((l) => /summary n=/.test(l)));
    ok(w.logs.some((l) => /^REP: table replaced from a file \(2 people, room !space:hs, 2023-11-13\) — backup downloaded first$/.test(l)), "N: and the log says so",
      w.logs.filter((l) => /replaced/.test(l)));
    const c6 = recUi({ pick: file(), confirm: false });
    await w.B.replaceTable(c6, false);
    ok(c6.downloads.length === 1 && c6.calls[0] === "download", "N: and the backup downloads EVERY time", c6.calls);
  });
  await part("N", async () => {
    const w = world({ whole: false, server: [OLD] });
    w.rows.push({ pi: "$p1", l: 10, dj: "@dj:hs" }); w.np = "$p1"; w.active = ["@a:hs"];
    await w.enter();
    const keys = (w.B.card() || { rows: [] }).rows.map((r) => r.key);
    ok(w.st().noBase === true && keys.indexOf("startFresh") >= 0 && keys.indexOf("lookFurther") >= 0,
      "N: WITH NO BASE (Q4) the card offers Start fresh and Look further back", keys);
    const u = recUi({ confirm: true });
    const r = await w.B.replaceTable(u, true);
    await w.flush();
    ok(r.ok === true && u.calls.join() === "download,confirm" && w.st().noBase === false && eq(w.st().table.base, {}),
      "N: START FRESH — the backup still first, no file, confirmed: an empty table, and a base at last", { calls: u.calls, st: w.st().noBase });
    ok(w.summaries().length === 1 && w.logs.some((l) => /\(after Start fresh\)$/.test(l)), "N: and a summary at once", w.logs.filter((l) => /summary/.test(l)));
  });
  await part("N", async () => {
    // A room ten days old, a window of a week: no base. Looking back thirty days, once, finds its start.
    const old = (id, l, type, who, p) => ({ eventId: id, type: type, sender: who, content: { t: type, p: p }, l: l, ts: T0 - 10 * DAY });
    const w = world({ whole: false, server: [old("$g", 1, "ddjp.dj.play", "@dj:hs", null), old("$gv", 2, "ddjp.dj.vote", "@a:hs", "$p1")] });
    w.rows.push({ pi: "$p1", l: 1, dj: "@dj:hs" }); w.np = null; w.active = ["@a:hs"];
    await w.enter();
    ok(w.st().noBase === true, "N: PREMISE — older than the window: no base", w.st().noBase);
    ok(w.B.lookFurther(0).ok === false && w.B.lookFurther(400).ok === false, "N: LOOK FURTHER BACK takes 1 to 365 days, nothing else");
    ok(w.B.lookFurther(30).ok === true, "N: thirty days asked");
    await w.flush();
    ok(w.st().noBase === false && eq(total(w, "@dj:hs"), [0, 1, 0, 0, 0, 0]) && w.st().windowMs === 7 * DAY &&
       w.logs.some((l) => /^REP: looking further back — 30 day\(s\), this once$/.test(l)) && w.logs.some((l) => /younger than the window: counted from its start/.test(l)),
      "N: the room's start found within thirty days, counted, a base — and the window itself unchanged (once)", { st: w.st().noBase, dj: total(w, "@dj:hs"), win: w.st().windowMs });
    ok(w.B.lookFurther(30).ok === false, "N: and offered only while there is no base", w.B.lookFurther(30));
  });

  // ── O — THE BOT'S OWN SETTINGS AND THE BOT CARD (J84-5; §5.1, H4) ──────────────────────────────────────────────────────
  await part("O", async () => {
    const w = cmdWorld();
    await w.enter();
    const c = w.B.card();
    const row = (k) => c.rows.find((r) => r.key === k) || {};
    ok(c && c.heading === "Reputation (REP)" && c.rows.map((r) => r.key).join() === "windowDays,commands,cooldownS,roomLimit,export,replace",
      "O: THE CARD — the window, commands on or off, the cooldown, the room limit, export, Replace (no Q4 offers with a table)", c && c.rows.map((r) => r.key));
    ok(row("windowDays").value === 7 && row("windowDays").min === 1 && row("windowDays").max === 365 && row("commands").value === true &&
       row("cooldownS").value === 60 && row("cooldownS").max === 3600 && row("roomLimit").value === 6 && row("roomLimit").min === 1 && row("roomLimit").max === 60,
      "O: each with its default and Q8's range", c.rows.map((r) => [r.key, r.value, r.min, r.max]));
    ok(JSON.stringify(w.sb.Rep.botCard()) === JSON.stringify(c), "O: and `Rep.botCard` (H4) hands over exactly this");
    const bad = [["windowDays", 0], ["windowDays", 366], ["roomLimit", 61], ["cooldownS", 1.5], ["commands", "yes"], ["nope", 1]].map(([k, v]) => w.B.setPref(k, v).ok);
    ok(bad.every((x) => x === false) && w.prefsSaved.length === 0, "O: a value outside its range, of the wrong kind, or for no such setting is refused — nothing saved", bad);
    ok(w.B.setPref("windowDays", 3).ok === true && w.prefsSaved.length === 1 && w.prefsSaved[0].windowDays === 3 && w.st().windowMs === 3 * DAY && w.B.card().rows[0].value === 3,
      "O: A CHANGE IS KEPT AND SAVED for this room — the window used from now on", { saved: w.prefsSaved, win: w.st().windowMs });
    const p = cmdWorld({ prefs: { windowDays: 3, cooldownS: 10, commands: false, roomLimit: 9 } });
    await p.enter();
    ok(eq(p.B.card().rows.slice(0, 4).map((r) => r.value), [3, false, 10, 9]), "O: and read back at the next start", p.B.card().rows.map((r) => r.value));
    const ro = cmdWorld({ lock: false });
    await ro.enter();
    ok(ro.B.card() && ro.B.card().rows.length === 0 && /only reads/.test(ro.B.card().note), "O: a tab that does not hold the lock offers nothing — it only reads", ro.B.card());
    const nb = world({ bot: false });
    await nb.enter();
    ok(nb.sb.Rep.botCard() === null, "O: a tab that is not the bot has no card at all", nb.sb.Rep.botCard());
  });

  _finished = true;
  if (failed) { console.log("[rep-bot] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[rep-bot] PASS — REP's bot side counts each vote and save once, keeps its table, writes from one tab, and sends " +
    "summaries and additions by the rules (J84-2, J84-4, J84-5; " + asserts + " assertions). COUNTING: a re-delivery, the no-op duplicate, a " +
    "batch member and the held log counted again each count once; a refused reaction, a closed playing and `count.set` never; " +
    "an unknown playing is held until song history shows it. THE TABLE is saved a second after a change and a new session " +
    "carries on from it. ONE WRITER: refused the lock, it counts and sends nothing. THE BASE: from the room's start when this " +
    "tab holds it or it is younger than the window, else nothing is published (Q4). THE FILL-BACK goes from the cut within the " +
    "window, the held log and the stretch below it, receipts throughout, nothing sent meanwhile, a fresh summary after; THE " +
    "REBUILD from its own messages gives everyone they name the same numbers, each from their own cut; a gap past the window " +
    "says what was not filled. COMMANDS answer the owner alone, in the room's chat tiers, within the cooldown and the room " +
    "limit and 512 characters; FILES: the export, and Replace with the backup first, a preview, nothing changed on cancel, " +
    "never merged; THE CARD offers the bot's own settings and, with no base, Start fresh and Look further back. SUMMARIES wait for the tab to catch up, go at the song change (or at once " +
    "with nothing playing), again only after an interval with a change, an unchanged one at 1.5 intervals; they name the bot's " +
    "view's people as of the cut, with a rising serial. ADDITIONS go under the summary's own id, 5 s apart, batched, and past " +
    "20 people a fresh summary instead. THE SIZE CAP keeps the highest REP under the budget, and the left-out stay out. THE " +
    "HOOKS start it on the bot's tab, keep it across a rank change, and the leave stops it. And what it publishes plus what " +
    "follows the cut is its own count. THIS GUARD CANNOT TELL YOU A HOMESERVER ACCEPTS THE MESSAGES, OR THAT DEVICES READ " +
    "THEM — that is the reader (J84-3) and the batch");
  process.exit(0);
})().catch((e) => { failed++; console.log("[rep-bot] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
