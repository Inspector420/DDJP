// tests/check-rep-bot.js
// SUBJECT: features/rep-bot.js, features/rep-ports.js, features/room.js
//
// WALL: REP'S BOT SIDE COUNTS EACH VOTE AND SAVE ONCE, KEEPS ITS TABLE, WRITES FROM ONE TAB, AND SENDS SUMMARIES AND
// ADDITIONS BY THE RULES, FILLS BACK OR REBUILDS WHAT IT MISSED, AND ANSWERS ITS OWNER (J84-2, J84-4, J84-5, J87, J103; the
// owner's rulings 17, 20, 21a, 25, 28, 30c, 32, 44–46 and Q2–Q8; `main/04-features.md` §Reputation, where rulings 44–46 live). Driven through `Rep` (the
// app's one entry) with the real rules and
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
//      nothing counted, nothing published, and the log says so in Q4's words (and names Rebuild, J117). AND ONLY FOR A ROOM
//      THAT NEVER HAD A TABLE (J117, the owner's decision, `ddjp_630`): its own messages read back to the room's start — a
//      room held whole whose only summaries of its own are older than the window builds nothing; one with none anywhere
//      builds as before; a younger room is read to its start by the window's read alone; a read that cannot reach the start,
//      or fails, builds nothing, and the log and the card say why; read once per opening.
//   E  SUMMARIES: nothing before the tab is caught up; the first at the song change (the new playing its cut), or at
//      once with nothing playing (the last song's play its cut); due again at one interval only if something changed,
//      and then at the song change; an unchanged one at 1.5 intervals, at once — ONLY IF SOMETHING HAPPENED IN THE ROOM SINCE
//      THE LAST (CHANGED ON PURPOSE, the owner's rule, `ddjp_642`): the room's log at a newer position, the bot's own summaries
//      in it aside, the highest seen kept across a move-on's drop and stored across a reload; its rows are the bot's view's
//      people, each as of the cut; the serial only rises; a reaction on a closed playing counts for nothing.
//   F  ADDITIONS: a newly active person gets an addition with their split as of the summary's cut, under that summary's
//      own id, learned from its echo; at least 5 s after any REP message, batched; past 20 people a fresh summary instead.
//   G  THE SIZE CAP AND THE LEFT-OUT RULE: a big room's summary stays under the budget, highest REP first, the rest
//      counted; while it is capped, a newcomer below the lowest REP kept is left out (and not new again), one above it
//      gets an addition.
//   H  THE HOOKS (H1, H2) ON THE BOT'S TAB: the room's entry starts the bot side; a rank change in the same room keeps it
//      running; the one leave step stops it — listeners and timers gone, nothing sent (the table saved and the lock
//      released are driven in B and C, through `Rep.leave`); a tab that is not the bot runs none of it.
//   I  WHAT IT PUBLISHES IS ITS OWN COUNT: each named person's row plus the reactions at and after the cut, counted by
//      the same rules, is the bot's own number for them.
//   J  THE FILL-BACK (J84-4): from the cut, within the window, the held log and the stretch below it
//      paged (`events` only) — a relay batch's member as its actor, receipts throughout, a closed playing never; nothing
//      sent while it runs, a fresh summary after it; one that cannot read the server is tried again.
//   K  THE REBUILD (J84-4; J117): with its storage lost, NOTHING IS REBUILT ON ITS OWN — its own summaries within the window
//      say the table was lost, and nothing is published; the owner's Rebuild then builds from its OWN summaries and additions
//      over the days chosen, each person from their own message's cut — the same numbers as the original for everyone they
//      name, a late reaction the original never counted not counted now, someone unnamed not recovered, its last summary its
//      own newest.
//   L  THE WINDOW (ruling 20): its own setting (1–365 days, a week by default); a reaction older than it is not filled,
//      held or not; a gap longer than it says how many days were not filled and moves `since` to its edge.
//   M  COMMANDS (J84-5): the owner's `!rep @user` and the six top lists, from the full table under the current
//      settings, in the tier asked in; a delegated rank and the bot refused; never a DM; never history; the cooldown and
//      the room limit; 512 characters ("top N of M"); no coverage text; commands off; no table.
//   N  FILES (J84-5, Q4, Q7; J117): the export; Replace — the backup first every time, cancel at the pick or the preview
//      changes nothing, a bad file refused, a file with 0 people refused (the owner, `ddjp_629`), another room flagged and,
//      confirmed, installed (the owner, `ddjp_627`); confirmed: replaced never merged, cut at the current play, a fresh summary
//      at once; Start fresh; with no table the card says so and offers Replace, Rebuild and Start fresh.
//   O  THE BOT'S OWN SETTINGS AND THE CARD (J84-5, H4; J117): the rows and their ranges — Rebuild with its days and Start
//      fresh offered table or not — a change saved and used, refused out of range, read back at start; every row a kind the
//      panel draws (no button missing); a tab that only reads offers nothing; one that is not the bot has no card.
//   P  WHOLE NUMBERS, AND THE BOT A NORMAL USER (J87): on a half-millisecond clock every summary and addition passes the
//      rules' own readers, serials whole and rising, and a rebuild from them finds the same numbers; a table or a file from
//      `?v=535` gives a next summary every reader takes; the bot's own votes and saves count, and it is published and answered.
//   Q  J103 (rulings 44, 45): a Rebuild counts over the days chosen; one that cannot read the room back changes nothing and
//      is never tried again on its own; a rebuild says what it left unread, each of the three ways (older than its days,
//      past the page limit, held events older than its days; J106); nothing is sent while it counts or its preview waits; a
//      summary's id comes from the send's answer.
//   R  THE OWNER'S REBUILD IN ITS SHAPE (ddjp_621): nothing counted twice, in numbers and in words; a fill-back the same.
//   S  J117 — THE OWNER'S REBUILD (`ddjp_623`, answers `ddjp_624`): the backup first; a table of its own, the live one
//      untouched while it counts and while its preview waits; the preview — the people, the dates, the counts; cancelled,
//      nothing changes; confirmed, replaced and a fresh summary; run again with other days, overwritten; with no summary of
//      its own, the room's own votes and saves over the days chosen — partial and said so, or the whole room; one finding
//      nobody refused; refused outside 1–365 days and while catching up.
//   T  THE CARD SAYS WHEN IT WOULD READ DIFFERENTLY (J117, `ddjp_630`): the feature layer's "the bot card changed", raised
//      once per change — a look that changes nothing raises none, nor does a change the panel already drew; the stop and
//      another tab writing are said; each way of having no table is said as the read answers, not at the next look.
"use strict";
const path = require("path");
const { loadInContext, transportSideReserved } = require(path.join(__dirname, "_load.js"));
// The fields a side message may not carry: the REAL transport's one list (the owner's ruling 46, J103), handed to the world's
// transport stand-in so its double cannot be a second copy of the list.
const SIDE_RESERVED = transportSideReserved();

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
    pages: [], readBacks: [], pageFail: false, readFail: false, cardSignals: 0,
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
        // THE PAGE LIMIT (`w.pageCapAt`): the paging stops at that position, short of `from`, and not for time.
        if (typeof w.pageCapAt === "number" && w.pageCapAt > from && !out.stoppedByTime) {
          const kept = out.filter((e) => e.l >= w.pageCapAt); kept.reachedFrom = w.pageCapAt; return kept;
        }
        return out;
        }
      },
      // J117 (`ddjp_630`): the owner-level channel has a START (`ownStart`: when the room began — by default the oldest event
      // anywhere in the world, never later than T0), so a read back past it is complete; a PAGE LIMIT (`ownCapAt`: a read
      // stops there, short of anything older); a read that FAILS past a time (`failBelow`); and a caller's STOP, asked of each
      // message newest first, the read stopping at the first it accepts — as the real transport's (`check-read-back-one`).
      readChannelBack: (ch, key, since, stop) => {
        w.readBacks.push({ key: key, since: since, stop: typeof stop === "function" });
        if (typeof stop === "function") w.lastStop = stop;
        const failed = w.readFail || (typeof w.failBelow === "number" && since < w.failBelow);
        const start = w.ownStartOf();
        let msgs = failed ? [] : w.own.filter((m) => m.ts >= since).sort((a, b) => a.ts - b.ts);
        let complete = !failed && since <= start, stopped = false, reached = complete ? start : since;
        if (!failed && typeof w.ownCapAt === "number" && since < w.ownCapAt) { msgs = msgs.filter((m) => m.ts >= w.ownCapAt); complete = false; reached = w.ownCapAt; }
        if (!failed && typeof stop === "function") {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (stop(JSON.parse(JSON.stringify(msgs[i]))) === true) { stopped = true; complete = false; reached = msgs[i].ts; msgs = msgs.slice(i); break; }
          }
        }
        const out = msgs.map((m) => JSON.parse(JSON.stringify(m)));
        out.ok = !failed; out.complete = complete; out.stopped = stopped; out.pages = failed ? 0 : 1; out.reachedTs = failed ? null : reached;
        return Promise.resolve(out);
      },
      getUserId: () => BOT, mayAuthor: () => ({ ok: w.may }), getUserEffectiveRank: (sid, ch, u) => w.levels[u] || 0,
      sideReserved: () => (SIDE_RESERVED ? SIDE_RESERVED.slice() : null) },
    Room: { presenceView: (now) => ({ people: w.active.map((u) => ({ userId: u, lastTs: now })) }), botCardChanged: () => { w.cardSignals++; },
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
  w.ownStartOf = () => (("ownStart" in o) ? o.ownStart
    : Math.min.apply(null, [T0].concat((w.server || []).concat(w.held, w.own).map((e) => e && e.ts).filter((t) => typeof t === "number"))));
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
  // THE ROOM'S LOG, for the owner's rule (`ddjp_642`): an event the room's log holds (an act, a save point), and the bot's own
  // summaries in it too, as both room types' logs hold them (driven, `ddjp_643`) — never "something happened".
  w.act = (type, l) => { const e = { eventId: "$act" + l, type: type, sender: "@dj:hs", content: { t: type }, l: l, ts: w.now }; w.held.push(e); return e; };
  w.logOwn = () => { for (const m of w.sent) if (!m.logged && (m.type === w.R.TYPES.summary || m.type === w.R.TYPES.addition)) { m.logged = true; w.held.push({ eventId: "$own" + m.l, type: m.type, sender: BOT, content: { t: m.type }, l: m.l, ts: m.at }); } };
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
// The three primitives the panel lends a flow (J84-5), recording: what was asked, in order, and what the preview said. A confirm
// answer may be a promise, so a preview can be held open (J117).
const recUi = (o) => {
  const u = { calls: [], downloads: [], pickAnswer: o && o.pick, confirmAnswer: o && o.confirm, lines: null, other: null };
  u.download = (name, data) => { u.calls.push("download"); u.downloads.push({ name: name, data: JSON.parse(JSON.stringify(data)) }); };
  u.pick = () => { u.calls.push("pick"); return Promise.resolve(u.pickAnswer); };
  u.confirm = (lines, opt) => { u.calls.push("confirm"); u.lines = lines; u.other = !!(opt && opt.other); return Promise.resolve(u.confirmAnswer); };
  return u;
};
const file = (o) => Object.assign({ format: "ddjp-rep-table", v: 1, room: SID, roomName: "Test Room", exportedAt: T0 - DAY, since: null, people: 2,
  rows: { "@a:hs": [10, 10], "@new:hs": [0, 3] } }, o || {});
// A day as the bot side writes it in a preview or a line.
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

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
    // CHANGED AT J117, with the reason: the way in names Rebuild now — the card offers it, table or not.
    ok(w.logs.some((l) => /^REP: no table and no summary within the window \(7 days\) — import a reputation file, rebuild, or start fresh$/.test(l)),
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
  // ── D — J117, THE OWNER'S DECISION (`ddjp_630`): A FIRST TABLE ONLY FOR A ROOM THAT NEVER HAD ONE ──────────────────────
  // `ddjp_629` told a room's first table from a lost one by its own summaries WITHIN THE WINDOW, so a table lost longer ago
  // than the window, in a room this tab holds whole, was counted again from the room's start on its own. Now the bot builds
  // on its own only when it can show the room never had one: no summary of its own anywhere, its own messages read back to
  // the room's start; a read that cannot reach it cannot tell, and counts as lost.
  await part("D", async () => {
    const sum = (w, id, ts, who) => ({ id: id, sender: who || BOT, ts: ts, l: 3, type: w.R.TYPES.summary,
      body: Object.assign(w.R.summary({ n: ts, cut: { pi: "$p0", pos: 2 }, since: null, rows: [{ user: "@a:hs", split: [4] }], more: 0 }), { t: w.R.TYPES.summary, l: 3, dv: 2, hv: 1 }) });
    const noteOf = (w) => (w.B.card() || {}).note;
    const NONE = "No reputation table — nothing is published. Import a file with Replace…, Rebuild, or Start fresh.";
    // LOST LONG AGO, IN A ROOM HELD WHOLE: its only summaries are older than the window.
    const w = world({ ownStart: T0 - 30 * DAY });
    w.own = [sum(w, "$s20", T0 - 20 * DAY), sum(w, "$s10", T0 - 10 * DAY)];
    w.play("$p1", 10); w.vote("$v1", "@a:hs", "$p1", 11);
    await w.enter();
    w.np = null; w.active = ["@a:hs"]; w.now += 2 * HOUR; await w.step();
    ok(w.st().table === null && w.st().noBase === true && w.sent.length === 0,
      "D: A ROOM HELD WHOLE WHOSE ONLY SUMMARIES OF ITS OWN ARE OLDER THAN THE WINDOW BUILDS NOTHING ON ITS OWN — the table was lost, " +
      "however long ago: no table, nothing published (the owner's decision, `ddjp_630`)", { st: w.st(), sent: w.sent.length });
    ok(w.readBacks.length === 2 && w.readBacks[0].since === T0 - 7 * DAY && w.readBacks[1].since === 0 && w.readBacks[1].stop === true,
      "D: it read its own messages back once more, to the room's start, with a stop of its own", w.readBacks);
    const lostLine = "REP: no table; read its own messages back to " + dayOf(T0 - 10 * DAY) + ", 1 page(s): a summary of its own from " + dayOf(T0 - 10 * DAY) +
      " — the room had a table, lost, and it is not rebuilt on its own: nothing is published; import a reputation file, rebuild, or start fresh";
    ok(w.logs.indexOf(lostLine) >= 0 && noteOf(w) === NONE,
      "D: AND THE LOG SAYS HOW FAR IT READ AND WHAT IT FOUND — the newest summary of its own, where the read stopped — and the card that there is no table",
      { logs: w.logs.filter((l) => /no table/.test(l)), note: noteOf(w) });
    const S = w.lastStop;
    const mine = sum(w, "$x", T0 - DAY), theirs = sum(w, "$y", T0 - DAY, "@owner:hs");
    ok(typeof S === "function" && S(mine) === true && S(Object.assign({}, mine, { body: {} })) === true && S(theirs) === false &&
       S(Object.assign({}, mine, { type: w.R.TYPES.addition })) === false && S(Object.assign({}, mine, { sender: null })) === false,
      "D: THE READ STOPS AT THE FIRST SUMMARY OF ITS OWN — the stop it hands accepts a summary of its own, read or not, and nothing else " +
      "(someone else's summary, its own addition, a message with no sender)");
    // NO SUMMARY OF ITS OWN ANYWHERE: its first table, as today — and the log says how far it read.
    const n = world({ ownStart: T0 - 30 * DAY });
    n.own = [sum(n, "$f", T0 - 20 * DAY, "@owner:hs")];   // someone else's summary is not its own
    n.play("$p1", 10); n.vote("$n1", "@a:hs", "$p1", 11); n.vote("$n2", "@b:hs", "$p1", 12);
    await n.enter();
    ok(n.st().table && eq(total(n, "@dj:hs"), [0, 2, 0, 0, 0, 0]) && n.st().table.since === null && n.st().noBase === false,
      "D: A ROOM WITH NO SUMMARY OF ITS OWN ANYWHERE BUILDS ITS FIRST TABLE AS TODAY — counted from its start, exact", { st: n.st(), logs: n.logs });
    const neverLine = "REP: no table; read its own messages back to the room's start (" + dayOf(T0 - 30 * DAY) + "), 1 page(s): no summary of its own — this room never had a table";
    const ni = n.logs.indexOf(neverLine);
    ok(n.readBacks.length === 2 && n.readBacks[1].since === 0 && ni >= 0 && /^REP: no table — counting this room from its start, which this tab holds \(2 vote/.test(n.logs[ni + 1] || ""),
      "D: and the log says how far it read and what it found — the room's start, no summary of its own — before what it counted", { rb: n.readBacks, logs: n.logs });
    // A ROOM YOUNGER THAN THE WINDOW: the window's read reaches its start — no read more.
    const y = world();
    y.play("$p1", 10); y.vote("$y1", "@a:hs", "$p1", 11);
    await y.enter();
    ok(y.st().table && y.readBacks.length === 1 &&
       y.logs.indexOf("REP: no table; its own messages within the window reach back to the room's start (" + dayOf(T0) + "): no summary of its own — this room never had a table") >= 0,
      "D: A ROOM YOUNGER THAN THE WINDOW IS READ TO ITS START BY THE WINDOW'S READ — no read more, and the log says so", { rb: y.readBacks, logs: y.logs });
    // THE READ CANNOT REACH THE ROOM'S START: the page limit, short of it. It cannot tell — built nothing, said so, read once.
    const c = world({ ownStart: T0 - 400 * DAY });
    c.ownCapAt = T0 - 100 * DAY;
    c.play("$p1", 10); c.vote("$c1", "@a:hs", "$p1", 11);
    await c.enter();
    ok(c.st().table === null && c.st().noBase === true && c.sent.length === 0,
      "D: A READ THAT CANNOT REACH THE ROOM'S START BUILDS NOTHING — it cannot tell whether the room had a table, and treats it as lost", c.st());
    const WHY = "could not read back far enough to know whether this room had a table";
    ok(c.logs.indexOf("REP: no table and no summary of its own within the window; read its own messages back to " + dayOf(T0 - 100 * DAY) + ", 1 page(s) — the page " +
       "limit, short of the room's start: it " + WHY + "; nothing is published; import a reputation file, rebuild, or start fresh") >= 0 &&
       noteOf(c) === "No reputation table — nothing is published: it " + WHY + ". Import a file with Replace…, Rebuild, or Start fresh.",
      "D: AND SAYS SO, IN THE LOG AND ON THE CARD — how far it read, and that it " + WHY, { logs: c.logs.filter((l) => /no table/.test(l)), note: noteOf(c) });
    const looked = c.readBacks.length;
    for (let i = 0; i < 3; i++) { c.now += 15000; await c.step(); }
    ok(looked === 2 && c.readBacks.length === looked && c.sent.length === 0 && c.st().table === null,
      "D: READ ONCE PER OPENING — it is never tried again on its own, and nothing is published", { looked: looked, now: c.readBacks.length });
    // THE READ FAILS: the same — nothing built, and said.
    const f = world({ ownStart: T0 - 30 * DAY });
    f.failBelow = T0 - 7 * DAY;   // the window's read answers; the read further back does not
    f.play("$p1", 10); f.vote("$f1", "@a:hs", "$p1", 11);
    await f.enter();
    ok(f.st().table === null && f.st().noBase === true && f.sent.length === 0 &&
       f.logs.some((l) => /^REP: no table and no summary of its own within the window; reading its own messages back to the room's start failed after \d+ page\(s\): it could not read back far enough to know whether this room had a table; nothing is published; /.test(l)) &&
       noteOf(f) === noteOf(c),
      "D: A READ THAT FAILS BUILDS NOTHING EITHER — and the log and the card say why", { st: f.st(), logs: f.logs.filter((l) => /no table/.test(l)) });
  });

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
    // CHANGED ON PURPOSE (the owner's rule, `ddjp_642`): this row held C12 — "at 1.5 intervals it goes at once, unchanged". It
    // still goes, but only if something happened in the room since the last summary: here nothing has (song history's rows
    // are not the room's log), and the bot's own summaries in the log do not count.
    w.logOwn();
    w.now += 30 * MIN; await w.step();
    ok(w.summaries().length === 2 && !w.logs.some((l) => /a refresh/.test(l)),
      "E: NOTHING HAPPENED SINCE THE LAST SUMMARY → NO RE-SEND AT 1.5 INTERVALS (the owner's rule, ddjp_642) — its own summaries in the log not counted", w.summaries().length);
    for (let i = 0; i < 6; i++) { w.now += 30 * MIN; await w.step(); }
    ok(w.summaries().length === 2, "E: and none over three more intervals", w.summaries().length);
    // Each row below counts from where it starts and asserts its own premise, so it reads its own case on any build.
    const lastAt = () => w.st().table.last.at;
    const lastLine = () => w.logs.filter((l) => /^REP: summary n=/.test(l)).pop() || "";
    // SOMETHING HAPPENED, REP UNCHANGED: a join — the re-send goes (the last is far past 1.5 intervals old: at once).
    let k = w.summaries().length;
    ok(w.now - lastAt() >= 1.5 * HOUR, "E PREMISE — the last summary is past 1.5 intervals old", (w.now - lastAt()) / MIN);
    w.act("ddjp.dj.join", 61); await w.step();
    ok(w.summaries().length === k + 1 && /\(a refresh \(the last is .* old\)\)$/.test(lastLine()),
      "E: SOMETHING HAPPENED, REP UNCHANGED → THE RE-SEND GOES, as at 640 (C12)", { n: w.summaries().length - k, last: lastLine() });
    // ...AT 1.5 INTERVALS, not before.
    k = w.summaries().length; let t0 = lastAt();
    w.logOwn(); w.act("ddjp.dj.join", 62); await w.step();
    w.now = t0 + 89 * MIN; await w.step();
    ok(w.summaries().length === k, "E: and with something happening again, not before 1.5 intervals", w.summaries().length - k);
    w.now = t0 + 91 * MIN; await w.step();
    ok(w.summaries().length === k + 1, "E: and at 1.5 intervals it goes, as at 640", w.summaries().length - k);
    // A BOT ROOM'S SHAPE (its move-on drops acts from the held log; its save points never enter it): an act seen, then dropped
    // before the 1.5 point, still counts — the highest position this tab has seen, not what is held now.
    k = w.summaries().length; t0 = lastAt();
    w.logOwn(); w.act("ddjp.dj.join", 63); await w.step();
    w.held = w.held.filter((e) => e.l > 63);
    w.now = t0 + 91 * MIN; await w.step();
    ok(w.summaries().length === k + 1, "E: IN A BOT ROOM'S SHAPE — an act seen and then dropped at a move-on still counts", w.summaries().length - k);
    // REP CHANGED → A SUMMARY, AS AT 640: a vote just after the last one waits out the interval, then the song change.
    k = w.summaries().length; t0 = lastAt();
    w.logOwn(); w.vote("$v9", "@a:hs", "$p5", 64); await w.step();
    ok(w.summaries().length === k && w.st().table.counted === 1 && w.now - t0 < HOUR, "E PREMISE — a vote counted, the last summary moments old", { n: w.summaries().length - k, counted: w.st().table.counted });
    w.now = t0 + 61 * MIN; await w.step();
    ok(w.summaries().length === k, "E: REP changed: past the interval, it waits for the song change, as at 640", w.summaries().length - k);
    w.play("$p9", 70); w.now += 15000; await w.step();
    ok(w.summaries().length === k + 1 && /\(the interval, at the song change\)$/.test(lastLine()),
      "E: REP CHANGED → A SUMMARY, as at 640 — at the song change", { n: w.summaries().length - k, last: lastLine() });
    // AND AFTER THE ROOM'S LAST EVENT, NONE AGAIN: nothing in the log since that summary.
    k = w.summaries().length; t0 = lastAt();
    w.logOwn(); w.now = t0 + 91 * MIN; await w.step(); w.now = t0 + 182 * MIN; await w.step();
    ok(w.summaries().length === k, "E: and with nothing after it, none again — two re-send points pass", w.summaries().length - k);
    // ACROSS A RELOAD: the stored table keeps the value its last summary went at, so a reloaded quiet room sends nothing; a
    // table stored by an older build (no `headL`) says nothing, and the re-send goes as at 640.
    await w.fireSaves();
    const storedAt = w.stored && w.stored.last && w.stored.last.at;
    ok(w.stored && w.stored.last && typeof w.stored.last.headL === "number", "E PREMISE — the stored table's last summary keeps the log's position it went at", w.stored && w.stored.last);
    for (const older of [false, true]) {
      const t = JSON.parse(JSON.stringify(w.stored)); if (older) delete t.last.headL;
      const r = world({ stored: t });
      r.rows = w.rows.slice(); r.np = w.np; r.active = w.active.slice(); r.now = storedAt + 20 * MIN;
      await r.enter(); await r.step();
      r.now = storedAt + 91 * MIN; await r.step();
      ok(r.summaries().length === (older ? 1 : 0),
        older ? "E: A TABLE FROM AN OLDER BUILD (no position kept) — the re-send goes at 1.5 intervals, as at 640"
              : "E: RELOADED, A QUIET ROOM STAYS QUIET — the stored position, nothing newer held, no re-send", r.summaries().length);
    }
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
    const pub = w.R.published(Object.assign({}, w.R.readSummary(s.body, SIDE_RESERVED).value, { id: "$x", l: 1 }), []);
    const cut = s.body.cut, plays = { "$p1": { pi: "$p1", l: 10, dj: "@dj:hs" }, "$p2": { pi: "$p2", l: 20, dj: "@a:hs" } };
    const acc = w.R.newAccumulator();
    for (const e of w.held) w.R.add(acc, { type: e.type, voter: e.sender, pi: e.content.p }, plays[e.content.p], cut, true);
    const fwd = w.R.contributions(acc);
    const mism = ["@a:hs", "@b:hs", "@dj:hs"].filter((u) => !eq(w.R.plus(pub[u], fwd[u] || w.R.zero()), total(w, u)));
    ok(s && mism.length === 0, "I: each named person's published row plus what followed the cut, by the same rules, is the bot's own count", mism);
  }


  // ── J — THE FILL-BACK, FROM THE CUT, WITHIN THE WINDOW (J84-4) ───────────────────────────────────────────────────
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
    ok(sum && w.logs.some((l) => /^REP: summary n=\d+ cut l=28 — .* \(after the fill-back, which counted 4\)$/.test(l)),
      "J: and a fresh summary follows at once (J84-4)", w.logs.filter((l) => /summary/.test(l)));
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

  // ── K — THE REBUILD, AFTER STORAGE LOSS (J84-4) ───────────────────────────────────────────────────────────────────────
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
      "K: IT READS ITS OWN MESSAGES BACK on the owner-level channel, within the window — at readiness, to learn whether the room had a table", r.readBacks);
    // RE-AIMED AT J117 (the owner's `ddjp_623`), with the reason: this table was rebuilt here at readiness, on its own. A lost
    // table is not rebuilt on its own now — its own summaries say the room had one, so nothing is published until the owner
    // acts — and what follows is the owner's Rebuild, from the card, over the days chosen. The numbers it must find are the same.
    r.now += 1000; await r.step();   // a second on: under ruling 25's 5 s, so the summary after the rebuild waits, and its last can be read
    ok(r.st().noBase === true && r.st().table === null && r.sent.length === 0 && r.pages.length === 0 &&
       r.logs.some((l) => /^REP: no table, and its own summaries are in the room \(2 within the window, the newest \d{4}-\d\d-\d\d\) — the table was lost, and is not rebuilt on its own: nothing is published; import a reputation file, rebuild, or start fresh$/.test(l)),
      "K: A LOST TABLE IS NOT REBUILT ON ITS OWN (J117) — its own summaries found: no table, nothing read from the room, nothing published, and the log says the table was lost",
      { noBase: r.st().noBase, table: !!r.st().table, sent: r.sent.length, pages: r.pages.length, logs: r.logs });
    const u = recUi({ confirm: true });
    const rr = await r.B.rebuild(u, 7);
    await r.flush();
    ok(rr.ok === true && u.calls.join() === "download,confirm" && r.readBacks.length === 2 && r.readBacks[1].since === r.now - 7 * DAY,
      "K PREMISE — the owner's Rebuild over 7 days: the backup first, its own messages read back over those days, the preview, confirmed", { r: rr, calls: u.calls, readBacks: r.readBacks });
    const people = ["@a:hs", "@b:hs", "@dj:hs", "@x:hs", "@y:hs"];
    const off = people.filter((u) => !eq(total(r, u), total(w, u)));
    ok(off.length === 0, "K: THE SAME NUMBERS AS BEFORE for everyone its messages name — the newest message naming each, as of its own cut, " +
      "plus what they earned from that cut on (b, named only in the first summary, from l=20; x from the second; y from its addition)", off.map((u) => [u, total(r, u), total(w, u)]));
    ok(!(tb(r).base["@u:hs"]) && tb(w).base["@u:hs"], "K: someone no message names is not recoverable — no row, until an import (J84-4) — though the original had one",
      [tb(r).base["@u:hs"], tb(w).base["@u:hs"]]);
    ok((total(w, "@b:hs") || [])[2] === 0 && (total(r, "@b:hs") || [])[2] === 0,
      "K: and a late save the original never counted — on a playing the second summary had closed, though at or after b's own cut — is not counted now",
      [total(r, "@b:hs"), total(w, "@b:hs")]);
    ok(r.pages.length === 1 && r.pages[0].from === 20 && r.pages[0].to === 24, "K: filled back from the OLDEST cut it used, to the start of its held log", r.pages);
    const L = tb(r).last;
    ok(L && L.n === S[1].body.n && L.id === S[1].id && eq(tb(r).cut, S[1].body.cut),
      "K: its last summary is the newest of its own — not the owner's planted one with a higher serial — so additions go on under its id", L);
    ok(r.logs.some((l) => /^REP: rebuild over the last 7 day\(s\), from its own messages — 5 people from 2 summary\(ies\) and 2 addition\(s\); cut l=30; filling back from l=20/.test(l)) &&
       r.logs.some((l) => /^REP: table rebuilt over the last 7 day\(s\) \(5 people\) — backup downloaded first$/.test(l)),
      "K: and the log says so", r.logs.filter((l) => /rebuil/.test(l)));
    r.now += 6000; await r.step();   // 5 s after its last message (ruling 25)
    ok(r.summaries().length === 1 && r.summaries()[0].body.n > S[1].body.n && r.logs.some((l) => /\(after the rebuild\)$/.test(l)),
      "K: a fresh summary follows, with a higher serial", r.summaries().map((m) => m.body.n));
  }

  // ── L — THE WINDOW, AND A GAP LONGER THAN IT (J84-4; ruling 20) ────────────────────────────────────────────────────────
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

  // ── M — COMMANDS (J84-5; rulings 17 and 32) ────────────────────────────────────────────────────────────────────────────
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

  // ── N — EXPORT, REPLACE, START FRESH (J84-5; Q4, Q7, ruling 14; J117) ─────────────────────────────────────────────────
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
    // A FILE WITH 0 PEOPLE IS REFUSED (the owner, `ddjp_629`): an empty table is Start fresh's, on purpose. The backup still
    // went first; the file is never previewed; nothing changes; and the refusal names Start fresh.
    const c0 = recUi({ pick: file({ people: 0, rows: {} }), confirm: true });
    const r0 = await w.B.replaceTable(c0, false);
    ok(r0.ok === false && /0 people/.test(r0.why || "") && /Start fresh/.test(r0.why || "") && c0.calls.join() === "download,pick" && JSON.stringify(w.st().table) === before &&
       w.logs.some((l) => l === "REP: replace refused — the file holds 0 people; nothing changed (Start fresh gives an empty table)"),
      "N: A FILE WITH 0 PEOPLE IS REFUSED (the owner, `ddjp_629`) — never previewed, nothing changed, and the refusal names Start fresh", { r: r0, calls: c0.calls });
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
    // A FILE OF ANOTHER ROOM, FLAGGED AND CONFIRMED, IS INSTALLED (the owner, `ddjp_627`): it carries a room's reputation to a
    // new room. J117 left it as it was.
    const c7 = recUi({ pick: file({ room: "!other:hs", roomName: "Other Room", people: 1, rows: { "@o:hs": [5, 5] } }), confirm: true });
    const r7 = await w.B.replaceTable(c7, false);
    await w.flush();
    ok(r7.ok === true && c7.other === true && eq(w.st().table.base, { "@o:hs": [5, 5, 0, 0, 0, 0] }) &&
       w.logs.some((l) => /^REP: table replaced from a file \(1 people, room !other:hs, 2023-11-13\) — backup downloaded first$/.test(l)),
      "N: A FILE OF ANOTHER ROOM, FLAGGED AND CONFIRMED, IS INSTALLED — still allowed (the owner, `ddjp_627`)", { r: r7, base: w.st().table.base });
  });
  await part("N", async () => {
    const w = world({ whole: false, server: [OLD] });
    w.rows.push({ pi: "$p1", l: 10, dj: "@dj:hs" }); w.np = "$p1"; w.active = ["@a:hs"];
    await w.enter();
    // CHANGED AT J117, with the reason: Look further back went (the owner's answer 3, `ddjp_624`); with no table the card says
    // so and offers an import (Replace), Rebuild and Start fresh (the owner's `ddjp_623`), each one it can run.
    const nc = w.B.card() || { rows: [], note: "" };
    const keys = nc.rows.map((r) => r.key), on = (k) => (nc.rows.find((r) => r.key === k) || {}).enabled !== false;
    ok(w.st().noBase === true && nc.note === "No reputation table — nothing is published. Import a file with Replace…, Rebuild, or Start fresh." &&
       ["replace", "rebuild", "startFresh"].every((k) => keys.indexOf(k) >= 0 && on(k)) && keys.indexOf("lookFurther") < 0,
      "N: WITH NO BASE (Q4) THE CARD SAYS THERE IS NO TABLE and offers Replace, Rebuild and Start fresh — and no Look further back (J117)", { note: nc.note, keys: keys });
    const u = recUi({ confirm: true });
    const r = await w.B.replaceTable(u, true);
    await w.flush();
    ok(r.ok === true && u.calls.join() === "download,confirm" && w.st().noBase === false && eq(w.st().table.base, {}),
      "N: START FRESH — the backup still first, no file, confirmed: an empty table, and a base at last", { calls: u.calls, st: w.st().noBase });
    ok(w.summaries().length === 1 && w.logs.some((l) => /\(after Start fresh\)$/.test(l)), "N: and a summary at once", w.logs.filter((l) => /summary/.test(l)));
  });
  // LOOK FURTHER BACK WENT WITH J117 (the owner's answer 3, `ddjp_624`): Rebuild with its days replaces it. A room ten days old
  // with a window of a week, rebuilt over thirty days, finds its start — driven in S.

  // ── O — THE BOT'S OWN SETTINGS AND THE BOT CARD (J84-5, H4) ────────────────────────────────────────────────────────────
  await part("O", async () => {
    const w = cmdWorld();
    await w.enter();
    const c = w.B.card();
    const row = (k) => c.rows.find((r) => r.key === k) || {};
    // CHANGED AT J117, with the reason: Rebuild and Start fresh are offered with a table too — a rebuild is the owner's to run
    // again over other days (`ddjp_623`), and Replace's refusal of a file with 0 people points to Start fresh (`ddjp_629`).
    ok(c && c.heading === "Reputation (REP)" && c.rows.map((r) => r.key).join() === "windowDays,commands,cooldownS,roomLimit,export,replace,rebuild,startFresh",
      "O: THE CARD — the window, commands on or off, the cooldown, the room limit, export, Replace, Rebuild and Start fresh, a table or not", c && c.rows.map((r) => r.key));
    const rb = row("rebuild");
    ok(rb.kind === "days" && rb.value === 7 && rb.min === 1 && rb.max === 365 && rb.unit === "days" && rb.action === "Rebuild…" && rb.enabled === true &&
       typeof rb.run === "function" && row("startFresh").enabled === true && typeof row("startFresh").run === "function",
      "O: REBUILD takes its days — the window offered, 1 to 365 — and runs; Start fresh runs (J117)", { rebuild: rb, fresh: row("startFresh") });
    // NO BUTTON MISSING (the owner's ask with `ddjp_629`): every row the bot side hands, with a table or without, is a kind the
    // panel draws — read from `ui/settings.js` `_repRow` itself — and every flow row carries what it runs.
    const panelSrc = require("fs").readFileSync(path.join(__dirname, "..", "ui", "settings.js"), "utf8");
    const repRow = (panelSrc.split("function _repRow(")[1] || "").split("\n  function ")[0];
    const drawn = new Set((repRow.match(/r\.kind === "(\w+)"/g) || []).map((x) => x.split('"')[1]));
    const nob = world({ whole: false, server: [OLD] });
    await nob.enter();
    const both = c.rows.concat((nob.B.card() || { rows: [] }).rows);
    const undrawn = both.filter((r) => !drawn.has(r.kind) || ((r.kind === "button" || r.kind === "days") && typeof r.run !== "function") ||
      (r.kind === "days" && !r.action) || ((r.kind === "number" || r.kind === "toggle") && typeof r.set !== "function"));
    ok(drawn.size >= 4 && undrawn.length === 0 && (nob.B.card() || { rows: [] }).rows.length === c.rows.length,
      "O: NO BUTTON MISSING — every row of the card, a table or not, is one the panel draws, and every flow carries what it runs", { drawn: [...drawn], undrawn: undrawn.map((r) => r.key) });
    ok(row("windowDays").value === 7 && row("windowDays").min === 1 && row("windowDays").max === 365 && row("commands").value === true &&
       row("cooldownS").value === 60 && row("cooldownS").max === 3600 && row("roomLimit").value === 6 && row("roomLimit").min === 1 && row("roomLimit").max === 60,
      "O: each with its default and Q8's range", c.rows.map((r) => [r.key, r.value, r.min, r.max]));
    ok(JSON.stringify(w.sb.Rep.botCard()) === JSON.stringify(c), "O: and `Rep.botCard` (H4) hands over exactly this");
    const bad = [["windowDays", 0], ["windowDays", 366], ["roomLimit", 61], ["cooldownS", 1.5], ["commands", "yes"], ["nope", 1]].map(([k, v]) => w.B.setPref(k, v).ok);
    ok(bad.every((x) => x === false) && w.prefsSaved.length === 0, "O: a value outside its range, of the wrong kind, or for no such setting is refused — nothing saved", bad);
    ok(w.B.setPref("windowDays", 3).ok === true && w.prefsSaved.length === 1 && w.prefsSaved[0].windowDays === 3 && w.st().windowMs === 3 * DAY && w.B.card().rows[0].value === 3,
      "O: A CHANGE IS KEPT AND SAVED for this room — the window used from now on", { saved: w.prefsSaved, win: w.st().windowMs });
    ok((w.B.card().rows.find((r) => r.key === "rebuild") || {}).value === 3, "O: and Rebuild offers the window as it now is", w.B.card().rows.map((r) => [r.key, r.value]));
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

  // ── P — WHOLE NUMBERS, AND THE BOT AS A NORMAL USER (J87, the owner's first live run in a bot room, `?v=535`) ────────────
  // LIVE: the summaries carried n=1792366129640.5 — ServerClock's median of an even number of offsets — and every reader
  // refused them ("no serial"): no device showed REP, and the bot's own rebuild from them failed too. So the bot is driven
  // here on a HALF-MILLISECOND clock, and what it sends is read by RepRules' own readers, the ones every device uses.
  const readsAs = (w, m) => (m.type === w.R.TYPES.summary ? w.R.readSummary(m.body, SIDE_RESERVED) : w.R.readAddition(m.body, SIDE_RESERVED));
  await part("P", async () => {
    const w = world();
    w.now = T0 + 0.5;
    w.play("$p1", 10, "@dj:hs");
    w.vote("$f1", "@a:hs", "$p1", 11);
    w.active = ["@a:hs", "@dj:hs"];
    await w.enter();
    w.play("$p2", 20, "@a:hs"); w.now += 15000; await w.step();          // the first summary, at the song change
    w.echo();
    w.vote("$f2", "@x:hs", "$p2", 21);
    w.active = ["@a:hs", "@dj:hs", "@x:hs"];
    w.now += 6000; await w.step();                                       // x: an addition under it
    w.echoAll();
    w.vote("$f3", "@dj:hs", "$p2", 22);
    w.now += 61 * MIN; await w.step();
    w.play("$p3", 30, "@x:hs"); w.now += 15000; await w.step();          // the interval's summary, at the song change
    w.echo(); w.echoAll();
    const sent = w.summaries().concat(w.additions());
    ok(w.summaries().length === 2 && w.additions().length === 1 && w.now % 1 !== 0,
      "P: PREMISE — on a half-millisecond server clock the bot sent two summaries and an addition", { s: w.summaries().length, a: w.additions().length, now: w.now });
    const refused = sent.map((m) => [m.type, readsAs(w, m)]).filter(([, v]) => !v.ok).map(([t, v]) => [t, v.why]);
    ok(refused.length === 0,
      "P: EVERY SUMMARY AND ADDITION IT SENDS PASSES REPRULES' OWN READERS — the ones every device reads them with (live they all refused: \"no serial\")", refused);
    ok(sent.every((m) => Number.isInteger(m.body.n)) && w.summaries()[1].body.n > w.summaries()[0].body.n,
      "P: whole serials, rising", sent.map((m) => m.body.n));
    // AND A REBUILD FROM THEM WORKS: storage lost, a fresh tab of the bot — the owner's Rebuild (J117) — reads its own messages
    // back and finds its numbers.
    const r = world({ stored: null, whole: false, heldFrom: 25, server: w.held.slice(), own: w.ownFromSent() });
    r.rows = w.rows.slice(); r.np = w.np; r.now = w.now; r.active = w.active.slice();
    r.held = w.held.filter((e) => e.l >= 25);
    await r.enter();
    await r.B.rebuild(recUi({ confirm: true }), 7); await r.flush();
    const off = ["@a:hs", "@dj:hs", "@x:hs"].filter((u) => !eq(total(r, u), total(w, u)));
    ok(r.logs.some((l) => /^REP: rebuild over the last 7 day\(s\), from its own messages — 3 people from 2 summary\(ies\) and 1 addition\(s\)/.test(l)) && off.length === 0,
      "P: AND A REBUILD FROM THEM WORKS — storage lost, the bot reads its own half-millisecond-clock messages back and finds the same numbers",
      { off: off.map((u) => [u, total(r, u), total(w, u)]), logs: r.logs.filter((l) => /rebuil|no table/.test(l)) });
  });
  await part("P", async () => {
    // A TABLE STORED BY `?v=533`–`535`: a `since` and a last serial from the half-millisecond clock. No device ever read
    // that summary, so it is not kept; the next message is a summary every reader takes — never an addition under it.
    const t535 = cmdTable();
    t535.since = T0 - DAY + 0.5; t535.last.n = T0 - 10 * MIN + 0.5;
    const w = world({ stored: t535 });
    w.rows.push({ pi: "$p1", l: 10, dj: "@a:hs" }, { pi: "$p2", l: 20, dj: "@dj:hs" }); w.np = null;
    w.active = ["@a:hs", "@new:hs"];                                   // someone not in that summary: an addition, had it been kept
    await w.enter();
    w.now += 6000; await w.step();
    const first = w.sent[0];
    ok(first && first.type === w.R.TYPES.summary && readsAs(w, first).ok && first.body.since === Math.floor(t535.since),
      "P: A TABLE STORED ON `?v=535` — its unreadable last summary is not kept and its `since` is floored, so the next message is a summary the readers take",
      first && { type: first.type, why: readsAs(w, first).why, since: first.body.since });
    ok(w.logs.some((l) => /^REP: the stored last summary \(n=\d+\.5\) had no whole serial, so no device could read it — not kept; a new summary goes out$/.test(l)),
      "P: and the log says why", w.logs.filter((l) => /stored last/.test(l)));
  });
  await part("P", async () => {
    // A FILE EXPORTED BY `?v=533`–`535`, with half-millisecond stamps: replaced from, the fresh summary is still readable.
    const w = cmdWorld();
    await w.enter();
    const u = recUi({ pick: file({ exportedAt: T0 - DAY + 0.5, since: T0 - 2 * DAY + 0.5 }), confirm: true });
    const r = await w.B.replaceTable(u, false);
    await w.flush();
    const s = w.summaries()[w.summaries().length - 1];
    ok(r.ok === true && s && readsAs(w, s).ok && s.body.since === Math.floor(T0 - 2 * DAY + 0.5),
      "P: A FILE EXPORTED ON `?v=535` — replaced from it, the fresh summary carries a whole `since` and every reader takes it",
      s && { why: readsAs(w, s).why, since: s.body.since });
  });
  await part("P", async () => {
    // THE OWNER'S RULING: IN REP THE BOT IS A NORMAL USER. Its votes and saves count, given and received; active in its own
    // view it is published like anyone — in a summary, and in an addition when it becomes active; `!rep` answers for it.
    const w = world();
    w.play("$p1", 10, "@a:hs");
    w.vote("$b1", BOT, "$p1", 11);                                       // the bot votes on a's song
    w.active = ["@a:hs"];
    await w.enter();
    w.play("$p2", 20, BOT); w.now += 15000; await w.step();             // the bot DJs; the first summary, cut at its song
    w.echo();
    w.vote("$b2", "@a:hs", "$p2", 21); w.save("$b3", "@a:hs", "$p2", 22);   // a votes on and saves the bot's song
    ok(eq(total(w, BOT), [1, 1, 0, 1, 0, 0]),
      "P: THE BOT'S VOTES AND SAVES COUNT LIKE ANYONE'S — a vote given, and a vote and a save received", total(w, BOT));
    w.active = ["@a:hs", BOT];
    w.now += 6000; await w.step();
    const add = w.additions()[0];
    ok(add && add.body.rows.some((row) => row[0] === BOT), "P: ACTIVE IN ITS OWN VIEW, IT IS PUBLISHED — an addition names it when it becomes active",
      add && add.body.rows);
    w.echoAll();
    w.now += 61 * MIN; await w.step();
    w.play("$p3", 30, "@a:hs"); w.now += 15000; await w.step();
    const last = w.summaries()[w.summaries().length - 1];
    ok(w.summaries().length === 2 && last.body.rows.some((row) => row[0] === BOT), "P: and every summary names it like anyone (it left itself out until J87)",
      last && last.body.rows);
    w.now += 61000; await w.say("@owner:hs", "!rep " + BOT);
    ok(lastReply(w).text === BOT + " VG=1 VR=1 SG=0 SR=1", "P: `!rep @<the bot>` answers like for anyone", lastReply(w));
    w.now += 61000; await w.say("@owner:hs", "!rep @topv");
    ok(/@bot:hs 2/.test(lastReply(w).text), "P: and it is in the top lists with its own number", lastReply(w));
  });

  // ── Q — J103 (the owner's rulings 44 and 45, `ddjp_598`) ─────────────────────────────────────────────────────────────
  ok(Array.isArray(SIDE_RESERVED) && SIDE_RESERVED.length >= 10, "Q PREMISE — the transport hands out its one list of reserved fields (ruling 46), which this world's stand-in hands on", SIDE_RESERVED);
  // 44: A REBUILD COUNTS AS FAR BACK AS IT LOOKED — the days the owner chose for it (J117), its own messages read back over
  // them and the room's reactions counted over them; and it says what it left out. THE ROOM: the bot's own summary 20 days
  // old, cut at $q2 (l=20); votes after it 19, 15 and 1 day(s) back; the tab holds from l=50, the server the rest.
  const lookRoom = (o) => {
    const w = world(Object.assign({ stored: null, whole: false, heldFrom: 50 }, o || {}));
    const SUMT = T0 - 20 * DAY;
    w.server = [ev("$q0", "ddjp.dj.vote", "@a:hs", "$q1", 11, SUMT - DAY), ev("$qb", "ddjp.dj.vote", "@b:hs", "$q2", 21, T0 - 19 * DAY),
      ev("$qa", "ddjp.dj.vote", "@a:hs", "$q3", 31, T0 - 15 * DAY), ev("$qc", "ddjp.dj.vote", "@c:hs", "$q4", 41, T0 - DAY)];
    w.rows.push({ pi: "$q1", l: 10, dj: "@dj:hs" }, { pi: "$q2", l: 20, dj: "@dj:hs" }, { pi: "$q3", l: 30, dj: "@x:hs" }, { pi: "$q4", l: 40, dj: "@dj:hs" });
    w.np = "$q4"; w.active = ["@a:hs", "@dj:hs"];
    const body = w.R.summary({ n: SUMT, cut: { pi: "$q2", pos: 20 }, since: null, more: 0,
      rows: [{ user: "@a:hs", split: [1] }, { user: "@dj:hs", split: [0, 1] }] });
    w.own = [{ id: "$qs", sender: BOT, ts: SUMT, l: 25, type: w.R.TYPES.summary, body: Object.assign({}, body, { t: w.R.TYPES.summary, l: 25, dv: 2, hv: 1 }) }];
    return w;
  };
  // Everyone's numbers once all three votes after the summary are counted: a's row plus a's vote on $q3; b's and c's votes;
  // the DJs' votes received.
  const LOOKED = { "@a:hs": [2, 0, 0, 0, 0, 0], "@b:hs": [1, 0, 0, 0, 0, 0], "@c:hs": [1, 0, 0, 0, 0, 0], "@dj:hs": [0, 3, 0, 0, 0, 0], "@x:hs": [0, 1, 0, 0, 0, 0] };
  const offLooked = (w) => Object.keys(LOOKED).filter((u) => !eq(total(w, u), LOOKED[u])).map((u) => [u, total(w, u)]);
  await part("Q", async () => {
    const w = lookRoom();
    await w.enter();
    ok(w.st().noBase === true, "Q PREMISE — its only summary is older than the window: no base, nothing published", w.st().noBase);
    // RE-AIMED AT J117, with the reason: Look further back went; the owner's Rebuild, over the days chosen, is what reads past
    // the window now (the owner's answer 3, `ddjp_624`).
    const rq = await w.B.rebuild(recUi({ confirm: true }), 30);
    await w.flush();
    ok(rq.ok === true, "Q PREMISE — the owner's Rebuild over thirty days, confirmed", rq);
    const pg = w.pages[w.pages.length - 1];
    ok(pg && pg.from === 20 && pg.notBeforeTs === T0 - 30 * DAY && w.readBacks[w.readBacks.length - 1].since === T0 - 30 * DAY,
      "Q: A REBUILD COUNTS OVER THE DAYS CHOSEN — its own messages read back thirty days, and the room paged from the summary's cut back thirty days, not the window's seven (ruling 44)",
      { pages: w.pages, readBacks: w.readBacks });
    ok(offLooked(w).length === 0, "Q: and so every vote since that summary is counted — 19 and 15 days back as well as yesterday", offLooked(w));
    ok(w.logs.some((l) => /^REP: rebuild over the last 30 day\(s\), from its own messages — 2 people from 1 summary\(ies\) and 0 addition\(s\); cut l=20; filling back from l=20/.test(l)),
      "Q: and the log says how far it looked", w.logs.filter((l) => /rebuil/.test(l)));
    ok(w.st().windowMs === 7 * DAY && w.st().noBase === false, "Q: the window itself unchanged, and a base at last", { win: w.st().windowMs, noBase: w.st().noBase });
  });
  await part("Q", async () => {
    // A REBUILD THAT CANNOT READ THE ROOM BACK CHANGES NOTHING. RE-AIMED AT J117, with the reason: a failed read was tried
    // again at the next look, over the same days; a rebuild is the owner's now, so it says so and stops, never tried again on
    // its own, and the owner runs it again.
    const w = lookRoom();
    await w.enter();
    w.pageFail = true;
    const u1 = recUi({ confirm: true });
    const r1 = await w.B.rebuild(u1, 30);
    await w.flush();
    const looked = w.readBacks.length;
    for (let i = 0; i < 3; i++) { w.now += 15000; await w.step(); }
    ok(r1.ok === false && /could not read the room back — nothing changed/.test(r1.why || "") && u1.calls.join() === "download" &&
       w.st().table === null && w.st().noBase === true && w.st().fill === null && w.readBacks.length === looked &&
       w.logs.some((l) => l === "REP: rebuild could not read the room back — nothing changed"),
      "Q: A REBUILD THAT CANNOT READ THE ROOM BACK CHANGES NOTHING AND SAYS SO — never previewed, and never tried again on its own", { r: r1, calls: u1.calls, fill: w.st().fill });
    w.pageFail = false;
    await w.B.rebuild(recUi({ confirm: true }), 30); await w.flush();
    ok(w.st().noBase === false && offLooked(w).length === 0, "Q: and the owner's next run counts what the first would have", offLooked(w));
  });
  await part("Q", async () => {
    // A REBUILD THAT LEAVES A STRETCH UNREAD SAYS SO. Within the window: a summary 6.9 days old, cut at $r2 (l=20); a vote on
    // that song 7.2 days back is older than the window (not counted, as before) — and now it is said. (Only positions and the
    // reactions' times are modelled here; when $r2 started is not.)
    const w = world({ stored: null, whole: false, heldFrom: 50 });
    w.server = [ev("$r21", "ddjp.dj.vote", "@a:hs", "$r2", 21, T0 - 7.2 * DAY), ev("$r22", "ddjp.dj.vote", "@b:hs", "$r2", 22, T0 - 6.95 * DAY),
      ev("$r31", "ddjp.dj.vote", "@c:hs", "$r3", 31, T0 - DAY)];
    w.rows.push({ pi: "$r1", l: 10, dj: "@dj:hs" }, { pi: "$r2", l: 20, dj: "@dj:hs" }, { pi: "$r3", l: 30, dj: "@dj:hs" });
    w.np = "$r3"; w.active = ["@b:hs"];
    const body = w.R.summary({ n: T0 - 6.9 * DAY, cut: { pi: "$r2", pos: 20 }, since: null, more: 0, rows: [{ user: "@dj:hs", split: [0, 4] }] });
    w.own = [{ id: "$rs", sender: BOT, ts: T0 - 6.9 * DAY, l: 25, type: w.R.TYPES.summary, body: Object.assign({}, body, { t: w.R.TYPES.summary, l: 25, dv: 2, hv: 1 }) }];
    await w.enter();
    await w.B.rebuild(recUi({ confirm: true }), 7); await w.flush();   // the owner's, over a week (J117)
    ok(eq(total(w, "@dj:hs"), [0, 6, 0, 0, 0, 0]) && eq(total(w, "@a:hs"), [0, 0, 0, 0, 0, 0]),
      "Q PREMISE — rebuilt within the window: the two votes inside it counted, the one 7.2 days back not", { dj: total(w, "@dj:hs"), a: total(w, "@a:hs") });
    ok(w.logs.some((l) => /^REP: the rebuild read back 7 day\(s\) — l=20 to l=21 is older than that and was not read$/.test(l)),
      "Q: A REBUILD THAT LEAVES A STRETCH UNREAD SAYS SO (ruling 44) — it said nothing", w.logs.filter((l) => /REP: (the rebuild|rebuild over|filling)/.test(l)));
  });
  // THE OTHER TWO THINGS A REBUILD MAY LEAVE UNREAD, EACH SAID (ruling 44; J106 — the owner's audit of `ddjp_601` found only
  // the row above held, so either line could go silent with the suite green). The same room: a summary 6.9 days old, cut at
  // $r2 (l=20); votes on $r2 at l=21 and l=22 and on $r3 at l=31.
  const unreadRoom = (o) => {
    const w = world(Object.assign({ stored: null, whole: false, heldFrom: 50 }, o || {}));
    w.rows.push({ pi: "$r1", l: 10, dj: "@dj:hs" }, { pi: "$r2", l: 20, dj: "@dj:hs" }, { pi: "$r3", l: 30, dj: "@dj:hs" });
    w.np = "$r3"; w.active = ["@b:hs"];
    const body = w.R.summary({ n: T0 - 6.9 * DAY, cut: { pi: "$r2", pos: 20 }, since: null, more: 0, rows: [{ user: "@dj:hs", split: [0, 4] }] });
    w.own = [{ id: "$rs", sender: BOT, ts: T0 - 6.9 * DAY, l: 25, type: w.R.TYPES.summary, body: Object.assign({}, body, { t: w.R.TYPES.summary, l: 25, dv: 2, hv: 1 }) }];
    return w;
  };
  const rebuildLines = (w) => w.logs.filter((l) => /REP: (the rebuild|rebuild over|filling)/.test(l));
  await part("Q", async () => {
    // PAST THE PAGE LIMIT: every vote is inside the window, and the server's paging stops at l=30.
    const w = unreadRoom();
    w.server = [ev("$p21", "ddjp.dj.vote", "@a:hs", "$r2", 21, T0 - 6.8 * DAY), ev("$p22", "ddjp.dj.vote", "@b:hs", "$r2", 22, T0 - 6.5 * DAY),
      ev("$p31", "ddjp.dj.vote", "@c:hs", "$r3", 31, T0 - DAY)];
    w.pageCapAt = 30;
    await w.enter();
    await w.B.rebuild(recUi({ confirm: true }), 7); await w.flush();   // the owner's, over a week (J117)
    ok(eq(total(w, "@dj:hs"), [0, 5, 0, 0, 0, 0]) && !rebuildLines(w).some((l) => /older than/.test(l)),
      "Q PREMISE — the page limit stopped the rebuild at l=30: the vote above it counted, the two below it not, and nothing was too old",
      { dj: total(w, "@dj:hs"), said: rebuildLines(w) });
    ok(w.logs.some((l) => /^REP: the rebuild stopped at l=30 \(the page limit\) — l=20 to l=29 was not read$/.test(l)),
      "Q: A REBUILD STOPPED BY THE PAGE LIMIT SAYS WHERE (ruling 44) — it said nothing", rebuildLines(w));
  });
  await part("Q", async () => {
    // HELD EVENTS OLDER THAN ITS DAYS: the tab holds from l=21, so nothing is paged past the cut, and the vote it holds at
    // l=21 is 7.2 days old.
    const w = unreadRoom({ heldFrom: 21 });
    w.server = [];
    w.held = [ev("$h21", "ddjp.dj.vote", "@a:hs", "$r2", 21, T0 - 7.2 * DAY), ev("$h22", "ddjp.dj.vote", "@b:hs", "$r2", 22, T0 - 6.95 * DAY),
      ev("$h31", "ddjp.dj.vote", "@c:hs", "$r3", 31, T0 - DAY)];
    await w.enter();
    await w.B.rebuild(recUi({ confirm: true }), 7); await w.flush();   // the owner's, over a week (J117)
    ok(eq(total(w, "@dj:hs"), [0, 6, 0, 0, 0, 0]) && !rebuildLines(w).some((l) => /page limit|older than that/.test(l)),
      "Q PREMISE — the two held votes inside the window counted, the one 7.2 days back not, and no stretch was left unread",
      { dj: total(w, "@dj:hs"), said: rebuildLines(w) });
    ok(w.logs.some((l) => /^REP: the rebuild left out 1 held event\(s\) older than 7 day\(s\)$/.test(l)),
      "Q: A REBUILD THAT LEAVES OUT HELD EVENTS SAYS HOW MANY (ruling 44) — it said nothing", rebuildLines(w));
  });
  await part("Q", async () => {
    // NOTHING IS SENT WHILE A REBUILD COUNTS, NOR WHILE ITS PREVIEW WAITS: then, confirmed, a summary at once, with the counted
    // numbers. RE-AIMED AT J117, with the reason: Look further back's rebuild wrote the live table as it counted and held the
    // sends back while it did; a Rebuild counts into a table of its own, so the live one — here none — is never a partial count.
    const w = lookRoom();
    await w.enter();
    w.pageDefer = true;
    let yes = null;
    const p = w.B.rebuild(recUi({ confirm: new Promise((res) => { yes = res; }) }), 30);
    await w.flush();
    for (let i = 0; i < 4; i++) { w.now += 15000; await w.step(); }
    const counting = { sent: w.sent.length, table: w.st().table };
    w.release(); await w.flush();
    for (let i = 0; i < 4; i++) { w.now += 15000; await w.step(); }
    ok(counting.sent === 0 && counting.table === null && w.sent.length === 0 && w.st().table === null,
      "Q: NOTHING IS SENT WHILE A REBUILD COUNTS, NOR WHILE ITS PREVIEW WAITS — the table it builds is not the live one", { counting: counting, sent: w.sent.map((m) => m.type) });
    yes(true); await p; await w.flush();
    w.now += 6000; await w.step();
    const s = w.summaries()[0];
    const pub = s && w.R.published(Object.assign({}, s.body, { id: "$x", l: 1, rows: s.body.rows.map((r) => w.R.decodeRow(r)) }), []);
    // Cut at $q4, the current song: the votes on $q2 and $q3 are in its rows; c's vote on $q4 itself is counted forward.
    ok(s && pub && eq(pub["@a:hs"], [2, 0, 0, 0, 0, 0]) && eq(pub["@dj:hs"], [0, 2, 0, 0, 0, 0]),
      "Q: and then a summary at once, carrying what it counted", s && s.body.rows);
  });
  // 45: THE SUMMARY'S ID FROM THE SEND. A shared room's send answers the event id; an echo handled BEFORE that answer used to
  // go unmatched, and the summary's additions waited for the next summary.
  await part("Q", async () => {
    const w = world();
    let k = 0;
    w.sb.MatrixBridge.sendSide = (ch, type, body) => {
      const id = "$early" + (++k), b = JSON.parse(JSON.stringify(body));
      w.sent.push({ ch: ch, type: type, body: b, at: w.now, l: 100 + k, id: id, echoed: true });
      const raw = { room_id: CH.events_owner, sender: BOT, event_id: id, type: "m.room.message", ddjpType: type, ddjpBody: Object.assign({}, b, { t: type, l: 100 + k }) };
      for (const fn of w.rawL.slice()) fn(raw);                         // the echo, handled before the send answers
      return Promise.resolve({ ok: true, eventId: id });
    };
    w.play("$e1", 10, "@dj:hs"); w.np = null; w.active = ["@a:hs"];
    await w.enter();
    const s1 = w.summaries()[0];
    ok(s1 && s1.id === "$early1", "Q PREMISE — the first summary went, its echo heard before the send answered", s1 && s1.id);
    w.active = ["@a:hs", "@c:hs"];
    w.now += 6000; await w.step();
    const a1 = w.additions()[0];
    ok(a1 && a1.body.of === "$early1" && a1.body.n === s1.body.n,
      "Q: THE SUMMARY'S ID IS TAKEN FROM THE SEND'S ANSWER (ruling 45) — a newcomer's addition goes under it, though its echo came first", { adds: w.additions().length, table: w.st().table.last });
  });

  // ── R — THE OWNER'S REBUILD, IN ITS SHAPE: NOTHING COUNTED TWICE (ddjp_621, item 4) ──────────────────────────────────
  // After the bot's site data was cleared its log said "… 0 event(s) paged, 5 vote(s) and 0 save(s) counted, 5 already
  // counted (5 before the cut, each for its own people)", then a summary "(after the fill-back (5 counted))". Driven in that
  // shape: three people, its own summaries with the people's own cuts apart, the bot's tab holding the room (nothing to
  // page), and the bot's entry replaying every held reaction into REP before it has a table. The rebuilt numbers are compared
  // with the original's for every person. RE-AIMED AT J117, with the reason: the rebuild ran here at readiness, on its own, and
  // read each replayed reaction twice — once held, once heard. It is the owner's Rebuild now; the lost table's replayed
  // reactions went with it (the held log holds them all), so the rebuild reads each once, and its line says nothing was
  // already counted. Read twice is still said, by the fill-back below.
  await part("R", async () => {
    const w = world();
    w.play("$r1", 10, "@a:hs");
    w.active = ["@a:hs", "@b:hs", "@c:hs"];
    await w.enter();
    w.play("$r2", 20, "@b:hs"); w.now += 15000; await w.step();     // the first summary, cut l=20, names a, b, c
    w.echo(); w.echoAll();
    w.vote("$rv1", "@a:hs", "$r2", 21); w.vote("$rv2", "@c:hs", "$r2", 22);
    w.active = ["@a:hs", "@b:hs"];                                   // c stops being active: named only in the first summary
    w.now += 61 * MIN; await w.step();
    w.play("$r3", 30, "@a:hs"); w.now += 15000; await w.step();     // the second summary, cut l=30, names a and b
    w.echo(); w.echoAll();
    w.vote("$rv3", "@b:hs", "$r3", 31); w.vote("$rv4", "@c:hs", "$r3", 32);
    w.now += 61 * MIN; await w.step();
    w.play("$r4", 40, "@b:hs"); w.now += 15000; await w.step();     // the third summary, cut l=40
    w.echo(); w.echoAll();
    const S = w.summaries();
    ok(S.length === 3 && S[0].body.cut.pos === 20 && S[2].body.cut.pos === 40,
      "R: PREMISE — the original sent three summaries (cuts l=20, l=30, l=40); c is named only in the first", S.map((m) => m.body.cut));
    // STORAGE LOST. The new tab holds the whole room (nothing to page), and the bot's entry replays it: every held
    // reaction reaches REP while it has no table yet.
    const r = world({ stored: null, own: w.ownFromSent() });
    r.rows = w.rows.slice(); r.np = w.np; r.now = w.now; r.active = w.active.slice(); r.held = w.held.slice();
    r.sb.Rep.enter({ spaceId: SID, channels: CH });
    for (const e of r.held) for (const [t, fn] of r.reactL.slice()) if (t === e.type) fn(e);
    await r.flush();
    await r.B.rebuild(recUi({ confirm: true }), 7); await r.flush();   // the owner's (J117)
    const reb = r.logs.filter((l) => /^REP: rebuild over the last/.test(l));
    ok(reb.length === 1 && / — 0 event\(s\) paged/.test(reb[0]) && /cut l=40; filling back from l=20/.test(reb[0]),
      "R: PREMISE — the owner's shape: rebuilt from its own messages, cut l=40, filled back from the oldest person's cut, 0 event(s) paged", reb);
    const people = ["@a:hs", "@b:hs", "@c:hs"];
    const off = people.filter((u) => !eq(total(r, u), total(w, u)));
    ok(off.length === 0 && eq(total(r, "@c:hs"), [2, 0, 0, 0, 0, 0]),
      "R: NOTHING WAS COUNTED TWICE — every person's rebuilt numbers are the original's, though each reaction reached the bot " +
      "twice; c (named only in the first summary) gets the two votes after their own cut, a and b none (their rows hold them)",
      people.map((u) => [u, total(r, u), total(w, u)]));
    // THE WORDS. The same reaction read twice is not "already counted" (that says a vote was counted before and is being
    // refused again); and the reactions on songs before the cut are not all "counted" — each is added only for the people
    // whose own row was cut before its song, so the line says how many people's numbers moved.
    ok(reb.length === 1 && !/[1-9]\d* already counted/.test(reb[0]) && !/read twice/.test(reb[0]),
      "R: AND THE REBUILD'S LINE SAYS NOTHING WAS ALREADY COUNTED — not \u201c4 counted, 4 already counted\u201d, which reads as a double count; each reaction read once (J117)", reb);
    ok(/before the cut, 4 vote\(s\) and 0 save\(s\), each added only for the people whose own row was cut before its song — 1 person's numbers moved/.test(reb[0]),
      "R: and that the four on songs before the cut moved ONE person's numbers (c's), not that four were counted", reb);
    r.now += 6000; await r.step();
    const sum = r.logs.filter((l) => /^REP: summary n=/.test(l));
    ok(sum.length === 1 && /\(after the rebuild\)$/.test(sum[0]) && !/\(\d+ counted\)\)/.test(sum[0]),
      "R: the summary after it says why it went — after the rebuild — with no \u201c(after the fill-back (4 counted))\u201d", sum);
    const rows = (r.summaries()[0] || { body: { rows: [] } }).body.rows;
    const named = rows.map((x) => (Array.isArray(x) ? x[0] : x.user));
    ok(named.length === 2 && named.every((u) => total(w, u) !== null),
      "R: and it names the active people, each with the original's numbers (driven above)", rows);

    // THE FILL-BACK, THE SAME WAY: the table survived (saved as it was), and the bot's entry replays the room into REP before the
    // stored table has loaded. What the table already counted is "already counted"; what came in twice is said as that. Two
    // votes after the last cut (J117) make the difference readable: the table holds them, so each is already counted ONCE.
    w.vote("$rv5", "@a:hs", "$r4", 41); w.vote("$rv6", "@c:hs", "$r4", 42);
    await w.fireSaves();
    const f = world({ stored: w.stored });
    f.rows = w.rows.slice(); f.np = w.np; f.now = w.now; f.active = w.active.slice(); f.held = w.held.slice();
    f.sb.Rep.enter({ spaceId: SID, channels: CH });
    for (const e of f.held) for (const [t, fn] of f.reactL.slice()) if (t === e.type) fn(e);
    await f.flush();
    const fill = f.logs.filter((l) => /^REP: filling back from/.test(l));
    const fwdVotes = w.held.filter((e) => /vote/.test(e.type) && e.l > 40).length;
    ok(fill.length === 1 && /0 vote\(s\) and 0 save\(s\) counted/.test(fill[0]) && people.every((u) => eq(total(f, u), total(w, u))),
      "R: a fill-back over a table that survived counts nothing new and moves nobody's numbers, though each reaction reached it twice",
      { fill: fill, totals: people.map((u) => [u, total(f, u), total(w, u)]), fwdVotes: fwdVotes });
    ok(fill.length === 1 && /; \d+ read twice \(held by this tab and heard again as it replayed\), taken once$/.test(fill[0]),
      "R: and its line says what came in twice, rather than counting it among the already counted", fill);
    ok(fill.length === 1 && / 0 vote\(s\) and 0 save\(s\) counted, 2 already counted; 6 read twice \(held by this tab and heard again as it replayed\), taken once$/.test(fill[0]),
      "R: THE LINE SAYS THE REACTIONS READ TWICE WERE TAKEN ONCE — the two its table held are already counted once each, not twice; all six replayed are said as read twice", fill);
  });

  // ── S — J117: THE OWNER'S REBUILD (`ddjp_623`; answers `ddjp_624`) ───────────────────────────────────────────────────
  // A LIVE TABLE, AND ITS OWN MESSAGES BEHIND IT: the room of Q (its own summary 20 days old), with a table the bot kept —
  // someone it holds that the summary does not name, and the cut on the current song.
  const liveTable = () => ({ v: 1, room: SID, since: null, base: { "@zz:hs": [9, 9, 0, 0, 0, 0] }, cut: { pi: "$q4", pos: 40 },
    fwd: { byPi: {}, held: [] }, last: { n: T0 - HOUR, at: T0 - HOUR, id: "$live", named: ["@zz:hs"], leftOut: [], more: 0, lowestKept: null,
      activeSig: "", adds: { k: 0, people: [] } }, lastMsgAt: T0 - HOUR, counted: 0, heard: null });
  await part("S", async () => {
    const w = lookRoom({ stored: liveTable() });
    await w.enter();
    ok(w.st().table && w.st().noBase === false && w.st().fill === null, "S PREMISE — a live table, filled back and ready", w.st() && { fill: w.st().fill });
    const before = JSON.stringify(w.st().table), livePeople = Object.keys(w.B._stateForTest().table.base).length;
    const sent0 = w.summaries().length;
    w.pageDefer = true;
    let yes = null;
    const u = recUi({ confirm: new Promise((res) => { yes = res; }) });
    const p = w.B.rebuild(u, 30);
    await w.flush();
    ok(u.calls.join() === "download" && u.downloads[0] && /-backup\.json$/.test(u.downloads[0].name) && u.downloads[0].data.people >= livePeople &&
       w.logs.some((l) => /^REP: backup downloaded \(\d+ people\) before a rebuild over the last 30 day\(s\)$/.test(l)),
      "S: THE BACKUP DOWNLOADS FIRST — the live table, before anything is read back", { calls: u.calls, downloads: u.downloads.map((d) => d.name) });
    ok(JSON.stringify(w.st().table) === before, "S: WHILE IT COUNTS, THE LIVE TABLE IS UNTOUCHED — it builds into a table of its own");
    w.release(); await w.flush();
    ok(u.calls.join() === "download,confirm" && JSON.stringify(w.st().table) === before,
      "S: AND WHILE ITS PREVIEW WAITS, STILL UNTOUCHED — nothing changes before the confirm", u.calls);
    const want = ["5 people: @dj:hs (3 REP), @a:hs (2 REP), @b:hs (1 REP), @c:hs (1 REP), @x:hs (1 REP)",
      "Read back 30 day(s): " + dayOf(T0 - 30 * DAY) + " to " + dayOf(T0) + ".",
      "From 1 summary(ies) and 0 addition(s) of its own, the newest " + dayOf(T0 - 20 * DAY) + "; 3 vote(s) and 0 save(s) counted."];
    ok(u.lines && eq(u.lines.slice(0, 3), want) && /^It replaces the current table \(\d+ people\), never merged\.$/.test(u.lines[u.lines.length - 1]) && u.lines.length === 4 && u.other === false,
      "S: THE PREVIEW SAYS WHAT IT FOUND — the people (named, REP high first), the dates it read back, what it was built from and the counts, and what it replaces", u.lines);
    yes(true);
    const res = await p; await w.flush();
    w.now += 6000; await w.step();   // 5 s after the live table's last message (ruling 25)
    ok(res.ok === true && offLooked(w).length === 0 && !w.st().table.base["@zz:hs"] && !(total(w, "@zz:hs") || [0]).some((x) => x > 0),
      "S: CONFIRMED, IT REPLACES THE LIVE TABLE — the rebuilt numbers, never merged with the old", { off: offLooked(w), zz: total(w, "@zz:hs") });
    const fresh = w.summaries()[sent0];
    ok(fresh && w.logs.some((l) => /^REP: table rebuilt over the last 30 day\(s\) \(5 people\) — backup downloaded first$/.test(l)) &&
       w.logs.some((l) => /^REP: summary n=\d+ cut l=40 — .*\(after the rebuild\)$/.test(l)) && fresh.body.n > w.summaries()[sent0 - 1].body.n,
      "S: AND A FRESH SUMMARY GOES AT ONCE, its serial above the live table's last", w.logs.filter((l) => /rebuilt|summary n=/.test(l)));
    // CANCELLED: the backup again, the preview, and nothing changes.
    const after1 = JSON.stringify(w.st().table);
    const c = recUi({ confirm: false });
    const rc = await w.B.rebuild(c, 30);
    await w.flush();
    ok(rc.ok === false && rc.why === "cancelled" && c.calls.join() === "download,confirm" && JSON.stringify(w.st().table) === after1 &&
       w.logs.some((l) => l === "REP: rebuild cancelled — nothing changed"),
      "S: CANCELLED AT THE PREVIEW, NOTHING CHANGES — and the backup still went first", { r: rc, calls: c.calls });
  });
  await part("S", async () => {
    // A ROOM WITH A LONG HISTORY THAT NEVER HAD A BOT (the owner's answer 2): ten days of it, a window of a week, no message of
    // its own — no table, nothing published. Rebuilt over a week: the room's own votes and saves in it, PARTIAL and said so.
    // Run again over thirty days, it overwrites the table with the whole room. (This world's read-back holds only the messages
    // it was given, so the second run also finds none of its own.)
    const ago = (d) => T0 - d * DAY;
    const w = world({ whole: false, server: [ev("$g", "ddjp.dj.play", "@dj:hs", null, 1, ago(10)), ev("$gv", "ddjp.dj.vote", "@a:hs", "$p1", 2, ago(10)),
      ev("$h", "ddjp.dj.play", "@dj2:hs", null, 5, ago(2)), ev("$hv", "ddjp.dj.vote", "@b:hs", "$p2", 6, ago(2))] });
    w.rows.push({ pi: "$p1", l: 1, dj: "@dj:hs" }, { pi: "$p2", l: 5, dj: "@dj2:hs" }); w.np = null; w.active = ["@b:hs"];
    await w.enter();
    ok(w.st().noBase === true && w.st().table === null && w.sent.length === 0, "S PREMISE — a room older than the window that never had a bot: no table, nothing published", w.st().noBase);
    const u = recUi({ confirm: true });
    const r1 = await w.B.rebuild(u, 7);
    await w.flush();
    ok(r1.ok === true && eq(u.lines, ["2 people: @b:hs (1 REP), @dj2:hs (1 REP)", "Read back 7 day(s): " + dayOf(ago(7)) + " to " + dayOf(T0) + ".",
      "From the room's own votes and saves: no summary of its own in those days; 1 vote(s) and 0 save(s) counted.",
      "PARTIAL: votes and saves older than 7 day(s) are not in it.", "the rebuild read back 7 day(s) — l=0 to l=4 is older than that and was not read",
      "There is no table now: this becomes it."]),
      "S: WITH NO SUMMARY OF ITS OWN, REBUILD COUNTS THE ROOM'S OWN VOTES AND SAVES over the days chosen — and the preview says it is PARTIAL, and what was not read", u.lines);
    ok(eq(total(w, "@b:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w, "@dj2:hs"), [0, 1, 0, 0, 0, 0]) && eq(total(w, "@a:hs"), w.R.zero()) && tb(w).since === ago(7) &&
       w.summaries().length === 1 && w.logs.some((l) => /^REP: rebuild over the last 7 day\(s\), from the room's own votes and saves \(no summary of its own in them\) — 2 event\(s\) paged, 1 vote\(s\) and 0 save\(s\) counted, 0 already counted; partial: what is older was not counted$/.test(l)),
      "S: confirmed, the partial table is the owner's choice — counted from the days read, `since` at their edge, a summary at once", { b: total(w, "@b:hs"), a: total(w, "@a:hs"), since: tb(w).since });
    const u2 = recUi({ confirm: true });
    const r2 = await w.B.rebuild(u2, 30);
    await w.flush();
    ok(r2.ok === true && u2.lines && u2.lines[3] === "The whole room: nothing in it is older than 30 day(s)." && u2.lines[u2.lines.length - 1] === "It replaces the current table (2 people), never merged." &&
       eq(total(w, "@a:hs"), [1, 0, 0, 0, 0, 0]) && eq(total(w, "@dj:hs"), [0, 1, 0, 0, 0, 0]) && eq(total(w, "@b:hs"), [1, 0, 0, 0, 0, 0]) && tb(w).since === null,
      "S: RUN AGAIN WITH OTHER DAYS, IT OVERWRITES THE TABLE — thirty days reach the room's start: the whole room, said so, `since` the start", { lines: u2.lines, since: tb(w).since });
  });
  await part("S", async () => {
    // REFUSED, AND NOTHING DOWNLOADED: days outside 1–365, or not whole; a tab still catching up. A rebuild that finds nobody
    // is refused after its backup — an empty table is Start fresh's.
    const w = world({ whole: false, server: [OLD] });
    await w.enter();
    const bad = [];
    for (const d of [0, 366, 1.5, "7"]) { const u = recUi({ confirm: true }); const r = await w.B.rebuild(u, d); bad.push([d, r.ok, r.why, u.calls.length]); }
    ok(bad.every((b) => b[1] === false && b[2] === "1 to 365 days" && b[3] === 0), "S: DAYS OUTSIDE 1 TO 365, OR NOT WHOLE, ARE REFUSED — before the backup, nothing changed", bad);
    const u0 = recUi({ confirm: true });
    const r0 = await w.B.rebuild(u0, 7);
    ok(r0.ok === false && /found 0 people/.test(r0.why || "") && /Start fresh/.test(r0.why || "") && u0.calls.join() === "download" && w.st().table === null &&
       w.logs.some((l) => l === "REP: rebuild found 0 people over the last 7 day(s) — nothing changed (Start fresh gives an empty table)"),
      "S: A REBUILD THAT FINDS NOBODY IS REFUSED — never previewed, no table, and the refusal names Start fresh", { r: r0, calls: u0.calls });
    const c = world({ may: false });
    await c.enter();
    const uc = recUi({ confirm: true });
    const rc = await c.B.rebuild(uc, 7);
    const row = ((c.B.card() || { rows: [] }).rows.find((r) => r.key === "rebuild") || {});
    ok(rc.ok === false && /catching up/.test(rc.why || "") && uc.calls.length === 0 && row.enabled === true,
      "S: STILL CATCHING UP, IT IS REFUSED, AND SAYS SO — the card's Rebuild stays pressable, so its reason is shown (greyed, it would read " +
      "as a button that does nothing)", { r: rc, calls: uc.calls, enabled: row.enabled });
  });

  // ── T — THE CARD SAYS WHEN IT WOULD READ DIFFERENTLY (J117, `ddjp_630`) ─────────────────────────────────────────────
  // Nothing redrew the Bot card when the bot side moved on. The bot side now raises the feature layer's "the bot card changed"
  // (`RepPorts.cardChanged`) — only when what its card shows moved since it was last drawn or said: one change, one signal.
  // The panel's half, end to end, is `check-bot-card` F.
  await part("T", async () => {
    const w = world();
    w.play("$p1", 10);
    await w.enter();
    const n0 = w.cardSignals;
    ok(n0 >= 1 && !!w.st().table, "T PREMISE — started, with its first table, and the card said so", { signals: n0, table: !!w.st().table });
    for (let i = 0; i < 3; i++) { w.now += 15000; await w.step(); }
    ok(w.cardSignals === n0, "T: A LOOK THAT CHANGES NOTHING SAYS NOTHING — three looks, no signal", { before: n0, after: w.cardSignals });
    w.vote("$t1", "@a:hs", "$p1", 11);
    w.now += 1000; await w.step();
    const n1 = w.cardSignals, c1 = w.B.card();
    ok(n1 === n0 + 1 && c1.note === "A table of 2 people.", "T: A CHANGE TO WHAT IT SHOWS IS SAID, ONCE — a new person in the table, at the next look", { signals: n1 - n0, note: c1.note });
    w.vote("$t2", "@b:hs", "$p1", 12);
    const drawn = w.B.card();   // the panel draws the change before the bot side's next look
    w.now += 1000; await w.step();
    ok(drawn.note === "A table of 3 people." && w.cardSignals === n1, "T: DRAWN, IT IS NOT SAID AGAIN — a change the panel already drew raises nothing at the next look",
      { note: drawn.note, signals: w.cardSignals - n1 });
    await w.leave();
    ok(w.cardSignals === n1 + 1 && w.B.card() === null, "T: STOPPED, IT SAYS SO — the card is gone, and the panel is told", { signals: w.cardSignals - n1 });
    const ro = world({ lock: false });
    await ro.enter();
    const rc = ro.B.card();
    ok(ro.cardSignals === 1 && rc && /^Another tab of this account writes REP/.test(rc.note), "T: ANOTHER TAB WRITING, IT SAYS SO — the card reads so at once", { signals: ro.cardSignals, note: rc && rc.note });
    // NO TABLE IS SAID AT ONCE: as the read answers, never at the next look — each of the ways (J117).
    const sum = (x, ts) => ({ id: "$ts" + ts, sender: BOT, ts: ts, l: 3, type: x.R.TYPES.summary,
      body: Object.assign(x.R.summary({ n: ts, cut: { pi: "$p0", pos: 2 }, since: null, rows: [{ user: "@a:hs", split: [4] }], more: 0 }), { t: x.R.TYPES.summary, l: 3, dv: 2, hv: 1 }) });
    const ways = [
      ["lost within the window", { ownStart: T0 - 30 * DAY }, (x) => { x.own = [sum(x, T0 - DAY)]; }],
      ["lost long ago", { ownStart: T0 - 30 * DAY }, (x) => { x.own = [sum(x, T0 - 20 * DAY)]; }],
      ["cannot tell", { ownStart: T0 - 400 * DAY }, (x) => { x.ownCapAt = T0 - 100 * DAY; }],
      ["no summary within the window", { whole: false, server: [OLD] }, null]];
    const got = [];
    for (const [what, o, set] of ways) {
      const x = world(o);
      if (set) set(x);
      x.play("$p1", 10);
      await x.enter();
      const n = x.cardSignals, c = x.B.card();
      got.push([what, n, x.st().noBase, c && c.note]);
    }
    ok(got.every((g) => g[1] === 2 && g[2] === true && /^No reputation table — nothing is published/.test(g[3] || "")),
      "T: NO TABLE IS SAID AT ONCE — as the read answers, not at the next look: lost within the window, lost long ago, cannot tell, " +
      "no summary within the window (each: the start's signal, then the no-table one)", got);
  });

  _finished = true;
  // ── R — THE OWNER'S 30-MINUTE FLOOR (`ddjp_644`): a room set below 30 min is read as 30; the fold is not changed ──────────
  // `RepRules.intervalOf` is the one reading both sides use. A room set to 10 min (the fold still takes 10, for the rooms
  // already set there): with a change and a song change every few minutes, the bot sends no faster than every 30 min. (Red on
  // `ddjp_644`: it sent at the first song change past 10 min.) A room set to 45 min behaves as 45, on both builds.
  async function paced(minutes, marks) {
    const w = world({ settings: { repSummaryMs: minutes * MIN } });
    w.play("$r1", 10, "@dj:hs"); w.active = ["@a:hs", "@dj:hs"];
    await w.enter();
    w.vote("$rv1", "@a:hs", "$r1", 11); await w.step();
    w.play("$r2", 20, "@a:hs"); w.now += 15000; await w.step();
    const first = w.summaries().length, t1 = w.st().table && w.st().table.last ? w.st().table.last.at : null;
    const out = [];
    let l = 21, pi = "$r2";
    for (const m of marks) {   // at each mark a vote (a change), and a minute later a song change: when a summary is due, it goes there
      w.now = t1 + m * MIN; w.vote("$rv" + l, "@dj:hs", pi, l); l++; await w.step();
      w.now += MIN; pi = "$r" + l; w.play(pi, l, "@dj:hs"); l++;
      w.now += 15000; await w.step();
      out.push({ at: m, sent: w.summaries().length - first });
    }
    return { w, first, t1, out, sent: w.settings.repSummaryMs };
  }
  await part("R", async () => {
    const a = await paced(10, [11, 20, 29, 31]);
    ok(a.first === 1 && typeof a.t1 === "number" && a.sent === 10 * MIN,
      "R PREMISE — a room set to 10 min: its settings say 10, and the first summary went at the song change", { first: a.first, sent: a.sent });
    ok(a.out[0].sent === 0 && a.out[1].sent === 0 && a.out[2].sent === 0,
      "R: A ROOM SET TO 10 MIN IS READ AS 30 (the owner, ddjp_644) — with a change and a song change at 11, 20 and 29 min, nothing goes " +
      "(on `ddjp_644` it went at the song change after 11)", a.out);
    ok(a.out[2].sent === 0, "R PREMISE — nothing has gone since the first summary, 29 min before (the row below reads only then)", a.out);
    ok(a.out[2].sent === 0 && a.out[3].sent === 1, "R: and past 30 min, with a change, it goes at the song change, as before", a.out);
    const b = await paced(45, [31, 44, 46]);
    ok(b.first === 1 && b.out[0].sent === 0 && b.out[1].sent === 0 && b.out[2].sent === 1,
      "R CONTROL: A ROOM SET TO 45 MIN BEHAVES AS 45 — not at 31 or 44 min, and at 46 it goes", b.out);
  });

  if (failed) { console.log("[rep-bot] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[rep-bot] PASS — REP's bot side counts each vote and save once, keeps its table, writes from one tab, and sends " +
    "summaries and additions by the rules (J84-2, J84-4, J84-5; " + asserts + " assertions). COUNTING: a re-delivery, the no-op duplicate, a " +
    "batch member and the held log counted again each count once; a refused reaction, a closed playing and `count.set` never; " +
    "an unknown playing is held until song history shows it. THE TABLE is saved a second after a change and a new session " +
    "carries on from it. ONE WRITER: refused the lock, it counts and sends nothing. THE BASE: from the room's start when this " +
    "tab holds it or it is younger than the window, and only for a room that never had a table — no summary of its own read " +
    "back to the room's start; one it cannot read back to its start builds nothing and says so — else nothing is published " +
    "(Q4). THE FILL-BACK goes from the cut within the " +
    "window, the held log and the stretch below it, receipts throughout, nothing sent meanwhile, a fresh summary after; THE " +
    "REBUILD from its own messages gives everyone they name the same numbers, each from their own cut; a gap past the window " +
    "says what was not filled. COMMANDS answer the owner alone, in the room's chat tiers, within the cooldown and the room " +
    "limit and 512 characters; FILES: the export, and Replace with the backup first, a preview, nothing changed on cancel, " +
    "never merged, a file with 0 people refused; THE CARD offers the bot's own settings, Rebuild and Start fresh, and says when it would read " +
    "differently — one change, one signal; a look that changes nothing, or a change already drawn, none. A LOST TABLE IS NOT REBUILT ON ITS OWN: THE " +
    "OWNER'S REBUILD downloads the backup first, builds a table of its own over the days chosen — from its own messages, or the " +
    "room's own votes and saves, partial and said so — previews it, and changes nothing until confirmed. SUMMARIES wait for the tab to catch up, go at the song change (or at once " +
    "with nothing playing), again only after an interval with a change, an unchanged one at 1.5 intervals; they name the bot's " +
    "view's people as of the cut, with a rising serial; a room set below 30 min is read as 30 (the owner, ddjp_644). ADDITIONS go under the summary's own id, 5 s apart, batched, and past " +
    "20 people a fresh summary instead. THE SIZE CAP keeps the highest REP under the budget, and the left-out stay out. THE " +
    "HOOKS start it on the bot's tab, keep it across a rank change, and the leave stops it. And what it publishes plus what " +
    "follows the cut is its own count. THIS GUARD CANNOT TELL YOU A HOMESERVER ACCEPTS THE MESSAGES, OR THAT DEVICES READ " +
    "THEM — that is the reader (J84-3) and the batch");
  process.exit(0);
})().catch((e) => { failed++; console.log("[rep-bot] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
