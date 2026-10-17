// tests/check-rep-reader.js
// SUBJECT: features/rep-reader.js, features/rep-rules.js, features/rep-ports.js
//
// WALL: EVERY DEVICE SHOWS THE BOT'S NUMBERS, OR NONE (J84-3; the owner's rulings 21b, 24, 26, 30d, 32 and 34;
// DESIGN-J84-REP.md §4.3, §4.5). One simulated room — its log, song history and owner-level channel — with the REAL bot
// side on the bot's tab and the REAL reader on every tab, each tab holding the log its own way. The bot's own table (its
// base plus what it counted since the cut, through the rules' own sums) is the truth every reader is measured against.
//
//   A  THE SAME NUMBERS ON EVERY KIND OF DEVICE: the bot's tab, a tab holding everything, one trimmed under a save point
//      (the stretch below it paged from the cut), one joining late, one opening fresh — each shows, for everyone the bot
//      published (a summary or an addition), the bot's own number; nobody else gets one. Counted forward from the cut:
//      a vote counted once, a late vote on a closed playing never, a reaction held until song history shows its playing.
//      A settings change shows at once, everywhere, with no new summary; a newer summary moves every device's cut.
//   B  THE LOOK-BACK IS TWICE THE INTERVAL (ruling 24): asked from now − 2 × `repSummaryMs`, and it follows the setting.
//   C  TRUST: a REP message is believed only top-level, on the owner-level channel, from a sender at 99 or above — never
//      another channel, a relay batch's member, a sender below 99, or a body carrying a relayed act's field. Of two
//      summaries the higher serial wins, then the later position; an older one changes nothing.
//   D  NO SUMMARY MEANS NOTHING: no number on any row, never a 0, and the log says why — with no bot, or with the last
//      summary older than the look-back.
//   E  LEFT OUT MEANS NOTHING: a person active here whom the summary does not name shows no number (their votes still
//      count for the DJ), and the log says why once — "or one of the N it left out" when the summary was capped.
//   F  READY ONLY AFTER READING EVERYTHING FROM THE CUT: not while the tab is catching up, not while the paged stretch
//      stops short of the cut, not when the tab cannot say where its log starts — and then, once it can, the numbers.
//   G  IN REAL TIME (the owner's ruling 35): it raises the feature layer's generic "the people view changed" when what it
//      shows may have moved — it became ready, a vote counted, an addition, a settings change — and not before it shows
//      anything, nor for a reaction that changed nothing.
//   H  THE LIFECYCLE ON EVERY TAB (H1, H2 through `Rep`): the reader starts on a tab that is not the bot, and the bot
//      side does not; a rank change in the same room keeps it; the leave stops it — listeners, timer, numbers gone.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-reader] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[rep-reader] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });

const MIN = 60000, HOUR = 60 * MIN, T0 = 1700000000000;
const SID = "!space:hs", CH = { events_owner: "!own:hs", events_uncategorized: "!in:hs", events_default: "!def:hs" };
const BOT = "@bot:hs", OWNER = "@owner:hs", A = "@a:hs", B = "@b:hs", C = "@c:hs", D = "@d:hs", X = "@x:hs";
const clone = (x) => JSON.parse(JSON.stringify(x));
const SUM = "ddjp.side.rep.summary", ADD = "ddjp.side.rep.add";

// ── THE ROOM: its log, its song history, its owner-level channel — shared by every tab ────────────────────────────────
function makeRoom(o) {
  o = o || {};
  const R = { now: T0, events: [], rows: [], np: null, owner: [], tabs: [], seq: 0, mseq: 0,
    levels: Object.assign({ [BOT]: 99, [OWNER]: 100 }, o.levels || {}), active: [],
    settings: Object.assign({ repSummaryMs: HOUR, repSelfVotes: false, repSelfSaves: false }, o.settings || {}) };
  R.play = (pi, l, dj) => { R.rows.push({ pi: pi, l: l, dj: dj, videoId: "v" + pi }); R.np = pi;
    R.events.push({ eventId: "$play" + pi, type: "ddjp.dj.play", sender: dj, content: { t: "ddjp.dj.play" }, l: l, ts: R.now }); };
  R.react = (type, who, pi, l) => {
    const e = { eventId: "$r" + (++R.seq), type: type, sender: who, content: { t: type, p: pi }, l: l, ts: R.now };
    R.events.push(e);
    for (const t of R.tabs) t.deliver(e);
    return e;
  };
  R.vote = (who, pi, l) => R.react("ddjp.dj.vote", who, pi, l);
  R.save = (who, pi, l) => R.react("ddjp.dj.save", who, pi, l);
  // A message as the transport delivers it: stamped (`t`, `l`, `dv`, `hv`), kept on the owner-level channel's timeline when
  // it is there (what a read-back finds), and fanned out live to every tab in the room.
  R.post = (m) => {
    const l = (typeof m.l === "number") ? m.l : 100000 + (++R.mseq);
    const body = Object.assign({}, clone(m.body), { t: m.type, l: l, dv: 2, hv: 1 });
    const msg = { id: m.id || ("$m" + (++R.mseq)), sender: m.sender, ts: (typeof m.ts === "number") ? m.ts : R.now, l: l, type: m.type, body: body };
    if (m.channel === "events_owner") R.owner.push(msg);
    if (m.live !== false) {
      const raw = { event_id: msg.id, room_id: CH[m.channel] || m.channel, sender: msg.sender, ts: msg.ts, l: msg.l,
        type: "m.room.message", ddjpType: msg.type, ddjpBody: clone(body) };
      setImmediate(() => { for (const t of R.tabs) t.raw(clone(raw)); });
    }
    return msg;
  };
  R.flush = async () => { for (let i = 0; i < 16; i++) await new Promise((r) => setImmediate(r)); };
  R.tick = async (ms) => { R.now += (typeof ms === "number") ? ms : 2000; for (const t of R.tabs) if (t.entered) await t.step(); await R.flush(); };
  return R;
}

// ── A TAB: the real rules, ports, bot side and reader, over this tab's own view of the room ───────────────────────────
function makeTab(R, o) {
  const t = { name: o.name, me: o.me, bot: !!o.bot, heldFrom: ("heldFrom" in o) ? o.heldFrom : null, may: o.may !== false,
    holding: o.holding !== false, active: o.active || null, logs: [], timers: [], reactL: [], rawL: [], readBacks: [], pages: [],
    shortAt: null, stored: null, entered: false, changed: 0, settingsL: [] };
  t.held = () => t.holding ? R.events.filter((e) => t.heldFrom === null || t.heldFrom === undefined || e.l >= t.heldFrom).map(clone) : [];
  t.deliver = (e) => {
    if (!t.entered || !t.holding || (typeof t.heldFrom === "number" && e.l < t.heldFrom)) return;
    for (const [ty, fn] of t.reactL.slice()) if (ty === e.type) fn(clone(e));
  };
  t.raw = (raw) => { if (!t.entered) return; for (const fn of t.rawL.slice()) fn(raw); };
  const ctx = {
    setTimeout: (fn, ms) => { const h = { fn, ms, live: true, kind: "t" }; t.timers.push(h); return h; },
    clearTimeout: (h) => { if (h) h.live = false; },
    setInterval: (fn, ms) => { const h = { fn, ms, live: true, kind: "i" }; t.timers.push(h); return h; },
    clearInterval: (h) => { if (h) h.live = false; },
    StreamManager: {
      on: (ty, fn) => { t.reactL.push([ty, fn]); }, off: (ty, fn) => { t.reactL = t.reactL.filter((x) => !(x[0] === ty && x[1] === fn)); },
      getLog: () => t.held(), isLegal: () => true, holdsWholeRoom: () => t.holding && t.heldFrom === null, heldFrom: () => t.heldFrom,
      getState: () => ({ settings: R.settings, nowPlaying: R.np ? { pi: R.np } : null }) },
    MatrixBridge: {
      roomHistory: (limit) => { const r = R.rows.slice().sort((a, b) => b.l - a.l); return typeof limit === "number" ? r.slice(0, limit) : r; },
      onRawEvent: (fn) => { t.rawL.push(fn); }, offRawEvent: (fn) => { t.rawL = t.rawL.filter((f) => f !== fn); },
      sendSide: (ch, type, body) => {
        if (!t.bot) return Promise.resolve({ ok: false, reason: "not the bot" });
        R.post({ channel: "events_owner", sender: t.me, type: type, body: body });
        return Promise.resolve({ ok: true });
      },
      readChannelBack: (ch, key, since) => {
        t.readBacks.push({ key: key, since: since });
        const out = (key === "events_owner") ? R.owner.filter((m) => m.ts >= since).map((m) => ({ id: m.id, sender: m.sender,
          senderLevel: R.levels[m.sender] || 0, ts: m.ts, l: m.l, type: m.type, body: clone(m.body) })) : [];
        out.ok = true; out.complete = true;
        return Promise.resolve(out);
      },
      pageRange: (from, to, opts) => {
        t.pages.push({ from: from, to: to, opts: opts });
        const out = R.events.filter((e) => e.l >= from && e.l <= to && (t.shortAt === null || e.l >= t.shortAt)).map(clone);
        out.reachedFrom = (t.shortAt === null) ? from : t.shortAt;
        return Promise.resolve(out);
      },
      getUserId: () => t.me, mayAuthor: () => ({ ok: t.may }), getUserEffectiveRank: (sid, ch, u) => R.levels[u] || 0 },
    Room: { presenceView: (now) => ({ people: (t.active || R.active).map((u) => ({ userId: u, lastTs: now })) }),
      peopleViewChanged: () => { t.changed++; }, onSettingsChange: (fn) => { t.settingsL.push(fn); } },
    ServerClock: { serverNow: () => R.now },
    Store: { rep: {
      load: async () => (t.stored ? clone(t.stored) : null),
      save: async (sid, tb) => { t.stored = clone(tb); return true; },
      writerLock: async (sid, held) => { Promise.resolve(held({})); return true; } } },
    BotRuntime: { actingAsBot: () => t.bot },
    Logger: { info: (m) => t.logs.push(m), warn: (m) => t.logs.push("WARN " + m), debug() {}, error() {} },
  };
  t.sb = loadInContext(["features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js", "features/rep-reader.js"], ctx);
  t.RR = t.sb.RepRules;
  t.enter = async () => { t.entered = true; t.sb.Rep.enter({ spaceId: SID, channels: CH }); await R.flush(); };
  t.leave = async (why) => { t.sb.Rep.leave(why || "the tab left the room"); t.entered = false; await R.flush(); };
  t.step = async () => { if (t.bot) t.sb.RepBot._stepForTest(); t.sb.RepReader._stepForTest(); await R.flush(); };
  t.badge = (u) => t.sb.Rep.badge(u);
  t.rep = (u) => { const b = t.badge(u); return b ? b.rep : null; };
  t.st = () => t.sb.RepReader._stateForTest();
  t.said = (re) => t.logs.filter((m) => re.test(m));
  R.tabs.push(t);
  return t;
}

// The bot's own number for a person — its base plus what it counted since the cut, through the rules' own sums — under the
// room's settings as they are now. THE TRUTH every reader is measured against.
function truth(bot, u, settings) {
  const st = bot.sb.RepBot._stateForTest(), RR = bot.RR;
  const add = RR.contributions(st.table.fwd);
  return RR.shown(RR.plus(st.table.base[u] || RR.zero(), add[u] || RR.zero()), settings).REP;
}
function publishedBy(bot) { const last = bot.sb.RepBot._stateForTest().table.last; return last ? last.named.concat(last.adds.people) : []; }
function agree(tabs, bot, R, who) {
  const bad = [];
  for (const t of tabs) for (const u of who) { const want = truth(bot, u, R.settings), got = t.rep(u); if (got !== want) bad.push(t.name + " " + u + " " + got + "≠" + want); }
  return bad;
}
// A summary, as a bot would build it, for the parts that plant their own.
function sumBody(RR, n, cut, rows, more) { return RR.summary({ n: n, cut: cut, since: null, rows: rows.map((r) => ({ user: r[0], split: r.slice(1) })), more: more || 0 }); }

// Each part runs on its own: a part that throws says so by name, and the parts after it still run.
async function part(id, fn) {
  try { await fn(); } catch (e) { ok(false, id + ": threw — " + ((e && e.message) || e)); }
}

(async () => {
  // ── A — THE SAME NUMBERS ON EVERY KIND OF DEVICE, THE BOT'S TABLE AS TRUTH ─────────────────────────────────────────────
  await part("A", async () => {
    const R = makeRoom({ levels: { [A]: 0, [B]: 0, [C]: 0, [D]: 0 } });
    const bot = makeTab(R, { name: "the bot's tab", me: BOT, bot: true });
    const d1 = makeTab(R, { name: "holding everything", me: A });
    R.play("$p1", 10, A); R.vote(B, "$p1", 11); R.save(C, "$p1", 12); R.vote(OWNER, "$p1", 13);
    R.play("$p2", 20, B); R.vote(A, "$p2", 21); R.vote(B, "$p2", 22); R.vote(C, "$p2", 23); R.save(C, "$p2", 24);
    R.active = [A, B, C, OWNER];
    await d1.enter();
    ok(d1.rep(A) === null && d1.said(/^REP: no summary from the bot in the last 2 h — none shown$/).length === 1,
      "A: PREMISE — before the bot has published, a device shows nothing and says why", d1.logs);
    await bot.enter();
    await R.tick();                     // the first summary waits for the song change
    R.play("$p3", 30, C);
    await R.tick();
    const s1 = R.owner.filter((m) => m.type === SUM);
    ok(s1.length === 1 && s1[0].body.cut.pos === 30, "A: PREMISE — the bot's first summary went at the song change, cut at the new playing", s1.map((m) => m.body.cut));
    ok(bot.sb.RepBot._stateForTest().table.last.id === (s1[0] || {}).id, "A: PREMISE — and heard itself back, so additions can name it", bot.sb.RepBot._stateForTest().table.last.id);
    R.vote(A, "$p3", 31); R.save(B, "$p3", 32); R.vote(D, "$p3", 33);
    R.vote(A, "$p3", 34);               // the same vote again: counted once, by everyone
    R.vote(D, "$p1", 35);               // a late vote on a playing the summary closed: counted by no one
    R.active = [A, B, C, D, OWNER];
    await R.tick(6000);                 // D became active: an addition, 5 s after the summary
    const a1 = R.owner.filter((m) => m.type === ADD);
    ok(a1.length === 1 && a1[0].body.rows.some((r) => r[0] === D) && a1[0].body.of === s1[0].id,
      "A: PREMISE — someone newly active went out in an addition under that summary's id", a1.map((m) => m.body));
    const d2 = makeTab(R, { name: "trimmed under a save point", me: B, heldFrom: 33 });
    const d3 = makeTab(R, { name: "joining late", me: C, heldFrom: 36 });
    const d4 = makeTab(R, { name: "opening fresh", me: D, holding: false, may: false });
    await d2.enter(); await d3.enter(); await d4.enter();
    ok(d2.pages.length === 1 && d2.pages[0].from === 30 && d2.pages[0].to === 32 && d3.pages.length === 1 && d3.pages[0].from === 30 && d3.pages[0].to === 35,
      "A: a device whose held log starts above the cut pages exactly the stretch between them, the `events` channels only",
      { d2: d2.pages, d3: d3.pages });
    ok(d2.pages[0] && d2.pages[0].opts && JSON.stringify(d2.pages[0].opts.kinds) === JSON.stringify(["events"]), "A: and through the port's channel stop", d2.pages[0]);
    ok(d1.pages.length === 0 && bot.pages.length === 0, "A: and one whose held log reaches the cut pages nothing", { d1: d1.pages.length, bot: bot.pages.length });
    ok(d4.rep(A) === null && d4.said(/reading back from the cut — none shown yet \(this tab is still catching up\)/).length === 1,
      "A: a device still catching up shows nothing yet, and says so", d4.logs);
    d4.holding = true; d4.may = true;
    await R.tick();
    const pub = publishedBy(bot);
    ok(JSON.stringify(pub.slice().sort()) === JSON.stringify([A, B, C, D, OWNER].sort()), "A: PREMISE — the bot published five people", pub);
    const all = [bot, d1, d2, d3, d4];
    ok(agree(all, bot, R, pub).length === 0,
      "A: EVERY KIND OF DEVICE SHOWS THE BOT'S OWN NUMBER for everyone it published — the bot's tab, holding everything, " +
      "trimmed under a save point, joining late, opening fresh", agree(all, bot, R, pub));
    ok(all.every((t) => t.rep(BOT) === null && t.rep(X) === null),
      "A: and nobody it did not publish gets one — not the bot, not a stranger: nothing, never a 0", all.map((t) => [t.rep(BOT), t.rep(X)]));
    // A: gave a vote on B's playing and received B's and the owner's on its own (the summary's 3), then voted on C's new
    // playing twice — counted once: 4.
    ok(d1.rep(A) === truth(bot, A, R.settings) && truth(bot, A, R.settings) === 4,
      "A: COUNTED FORWARD FROM THE CUT — A's vote on the new playing counts once, beside what the summary carried", { got: d1.rep(A), truth: truth(bot, A, R.settings) });
    ok(d1.rep(D) === 1, "A: and D's late vote on a closed playing counts for nothing, everywhere — only the vote after the cut", d1.rep(D));
    ok(all.every((t) => t.badge(A) && t.badge(A).text === t.rep(A) + " REP"), "A: what the row shows is `<n> REP`", all.map((t) => t.badge(A)));
    // Live, on every device at once.
    R.vote(B, "$p3", 40);
    await R.tick();
    ok(agree(all, bot, R, pub).length === 0, "A: a vote now reaches every device's number as it reaches the bot's", agree(all, bot, R, pub));
    // A SETTINGS CHANGE SHOWS AT ONCE, everywhere, past and future alike, with no new summary.
    const before = d1.rep(B), nSums = R.owner.filter((m) => m.type === SUM).length;
    R.settings.repSelfVotes = true;
    ok(d1.rep(B) === before + 2 && agree(all, bot, R, pub).length === 0 && R.owner.filter((m) => m.type === SUM).length === nSums,
      "A: SELF-VOTES TURNED ON — B's self-vote (inside the summary) adds 2 on every device at once, with no new summary (ruling 26)",
      { before: before, after: d1.rep(B), off: agree(all, bot, R, pub) });
    R.settings.repSelfVotes = false;
    ok(d1.rep(B) === before, "A: and turned off again, back", d1.rep(B));
    // A reaction naming a playing song history has not shown yet is held, and counted once it shows.
    R.vote(A, "$p9", 61);
    await R.tick();
    const heldNow = d1.st().held;
    R.rows.push({ pi: "$p9", l: 60, dj: B, videoId: "v9" });
    await R.tick();
    ok(heldNow === 1 && d1.st().held === 0 && agree(all, bot, R, pub).length === 0,
      "A: a reaction on a playing song history has not shown is held, then counted once it shows — on every device as on the bot",
      { held: heldNow, after: d1.st().held, off: agree(all, bot, R, pub) });
    // A NEWER SUMMARY MOVES EVERY DEVICE'S CUT.
    await R.tick(61 * MIN);
    R.play("$p4", 70, D);
    await R.tick();
    const s2 = R.owner.filter((m) => m.type === SUM);
    ok(s2.length === 2 && s2[1].body.cut.pos === 70, "A: PREMISE — a second summary, at the next song change past the interval", s2.map((m) => m.body.cut));
    ok(all.every((t) => t.st().sum && t.st().sum.id === (s2[1] || {}).id && t.st().ready === true), "A: every device takes the newer summary", all.map((t) => t.st().sum && t.st().sum.id));
    ok(all.every((t) => t.st() && t.st().playings === 0), "A: and its cut closes what came before it — the accumulator keeps only playings at or after the new cut",
      all.map((t) => t.st().playings));
    R.vote(C, "$p4", 71); R.save(A, "$p4", 72);
    await R.tick();
    const pub2 = publishedBy(bot);
    ok(agree(all, bot, R, pub2).length === 0, "A: and every device still shows the bot's number, counted forward from the new cut", agree(all, bot, R, pub2));
    ok(d1.said(/^REP: summary n=\d+ from @bot:hs \(cut l=70, \d+ people, \+0 added; live\) — counting forward from the cut$/).length === 1,
      "A: the log names each summary as it is taken", d1.said(/summary n=/));
  });

  // ── B — THE LOOK-BACK IS TWICE THE INTERVAL ──────────────────────────────────────────────────────────────────────────
  await part("B", async () => {
    const R = makeRoom();
    const d = makeTab(R, { name: "a device", me: A });
    await d.enter();
    ok(d.readBacks.length === 1 && d.readBacks[0].key === "events_owner" && d.readBacks[0].since === R.now - 2 * HOUR,
      "B: a device looks back twice the summary interval, on the owner-level channel (ruling 24)", d.readBacks);
    const R2 = makeRoom({ settings: { repSummaryMs: 30 * MIN } });
    const e = makeTab(R2, { name: "a device", me: A });
    await e.enter();
    ok((e.readBacks[0] || {}).since === R2.now - 60 * MIN && e.said(/^REP: no summary from the bot in the last 60 min — none shown$/).length === 1,
      "B: and the look-back follows the setting — half the interval, half as far, and the log says how far", { rb: e.readBacks, logs: e.logs });
  });

  // ── C — TRUST ────────────────────────────────────────────────────────────────────────────────────────────────────────
  await part("C", async () => {
    const R = makeRoom({ levels: { [A]: 0, [B]: 50 } });
    R.play("$q1", 10, A);
    const d = makeTab(R, { name: "a device", me: B });
    const RR = d.RR;
    R.post({ channel: "events_owner", sender: BOT, type: SUM, body: sumBody(RR, 100, { pi: "$q1", pos: 10 }, [[A, 0, 4]]), live: false });
    await d.enter();
    ok(d.rep(A) === 4, "C: PREMISE — the bot's summary, read back as the transport stamped it, is believed", d.rep(A));
    const plant = async (m) => { R.post(m); await R.flush(); };
    await plant({ channel: "events_uncategorized", sender: BOT, type: SUM, body: sumBody(RR, 200, { pi: "$q1", pos: 10 }, [[A, 0, 99]]) });
    ok(d.rep(A) === 4 && d.said(/ignored a REP summary from events_uncategorized \/ @bot:hs — not the owner-level channel/).length === 1,
      "C: a summary on another channel is ignored — even from the bot, even newer", { rep: d.rep(A), logs: d.logs });
    await plant({ channel: "events_owner", id: "$relay1#2", sender: BOT, type: SUM, body: sumBody(RR, 201, { pi: "$q1", pos: 10 }, [[A, 0, 98]]) });
    ok(d.rep(A) === 4 && d.said(/ignored a REP summary from events_owner \/ @bot:hs — not a top-level event \(a batch member\)/).length === 1,
      "C: a relay batch's member is never believed — only a top-level event", d.logs);
    await plant({ channel: "events_owner", sender: B, type: SUM, body: sumBody(RR, 202, { pi: "$q1", pos: 10 }, [[A, 0, 97]]) });
    ok(d.rep(A) === 4 && d.said(/ignored a REP summary from events_owner \/ @b:hs — its sender is below level 99/).length === 1,
      "C: a summary from a sender below 99 is ignored, on the right channel too", d.logs);
    await plant({ channel: "events_owner", sender: BOT, type: SUM, body: Object.assign(sumBody(RR, 203, { pi: "$q1", pos: 10 }, [[A, 0, 96]]), { actor: A }) });
    ok(d.rep(A) === 4 && d.said(/ignored a REP summary from @bot:hs — a reserved field/).length === 1,
      "C: and a body carrying a relayed act's field is refused — only what the transport stamps is taken off", d.logs);
    await plant({ channel: "events_owner", sender: OWNER, type: SUM, body: sumBody(RR, 300, { pi: "$q1", pos: 10 }, [[A, 0, 7]]) });
    ok(d.rep(A) === 7, "C: THE NEWEST WINS — a higher serial from the owner (100) replaces the bot's", d.rep(A));
    await plant({ channel: "events_owner", sender: BOT, type: SUM, body: sumBody(RR, 250, { pi: "$q1", pos: 10 }, [[A, 0, 55]]) });
    ok(d.rep(A) === 7, "C: and an older serial arriving later changes nothing", d.rep(A));
    await plant({ channel: "events_owner", sender: BOT, type: SUM, body: sumBody(RR, 300, { pi: "$q1", pos: 10 }, [[A, 0, 8]]) });
    ok(d.rep(A) === 8, "C: the same serial at a later position wins", d.rep(A));
    await plant({ channel: "events_owner", sender: BOT, type: ADD, body: RR.addition({ of: "$nope", n: 300, k: 1, rows: [{ user: C, split: [0, 5] }] }) });
    ok(d.rep(C) === null, "C: an addition naming another summary is not applied", d.rep(C));
    const cur = d.st().sum.id;
    await plant({ channel: "events_owner", sender: BOT, type: ADD, body: RR.addition({ of: cur, n: 300, k: 1, rows: [{ user: C, split: [0, 5] }] }) });
    ok(d.rep(C) === 5, "C: and one naming the summary in force is", d.rep(C));
    await plant({ channel: "events_uncategorized", sender: BOT, type: ADD, body: RR.addition({ of: cur, n: 300, k: 2, rows: [{ user: X, split: [0, 9] }] }) });
    ok(d.rep(X) === null, "C: the same trust holds for an addition — another channel, ignored", d.rep(X));
  });

  // ── D — NO SUMMARY MEANS NOTHING ─────────────────────────────────────────────────────────────────────────────────────
  await part("D", async () => {
    const R = makeRoom({ levels: { [A]: 0 } });
    R.play("$z1", 10, A); R.vote(B, "$z1", 11);
    R.post({ channel: "events_owner", sender: BOT, type: SUM, ts: R.now - 3 * HOUR, live: false,
      body: sumBody(makeTab(makeRoom(), { name: "x", me: X }).RR, 5, { pi: "$z1", pos: 10 }, [[A, 0, 3]]) });
    const d = makeTab(R, { name: "a device", me: B });
    R.active = [A, B];
    await d.enter();
    await R.tick();
    ok(d.rep(A) === null && d.rep(B) === null && d.st().sum === null,
      "D: NO SUMMARY WITHIN THE LOOK-BACK — no number on any row, never a 0 (a summary three hours old is not found)", { a: d.rep(A), b: d.rep(B) });
    ok(d.said(/^REP: no summary from the bot in the last 2 h — none shown$/).length === 1, "D: and the log says why, once", d.logs);
  });

  // ── E — LEFT OUT MEANS NOTHING ───────────────────────────────────────────────────────────────────────────────────────
  await part("E", async () => {
    const R = makeRoom({ levels: { [A]: 0, [X]: 0 } });
    R.play("$y1", 10, A);
    const d = makeTab(R, { name: "a device", me: X });
    R.post({ channel: "events_owner", sender: BOT, type: SUM, live: false, body: sumBody(d.RR, 9, { pi: "$y1", pos: 10 }, [[A, 0, 2]], 3) });
    R.active = [A, X, BOT];
    await d.enter();
    await R.tick(); await R.tick();
    ok(d.rep(A) === 2 && d.rep(X) === null, "E: active here and not named by the summary — no number", { a: d.rep(A), x: d.rep(X) });
    const said = d.said(/is active here and has no row from the bot/);
    ok(said.length === 1 && /^REP: @x:hs is active here and has no row from the bot \(not in the bot's view when it last published, or one of the 3 it left out at the size limit\)$/.test(said[0]),
      "E: and the log says why, once per person per summary — capped, so it names the size limit too", said);
    ok(!said.some((m) => /@bot:hs/.test(m)), "E: the bot is never in its own summary, so it is not reported", said);
    R.vote(X, "$y1", 11);
    await R.tick();
    ok(d.rep(A) === 3 && d.rep(X) === null, "E: the left-out person's vote still counts for the DJ, and they still show nothing", { a: d.rep(A), x: d.rep(X) });
  });

  // ── F — READY ONLY AFTER READING EVERYTHING FROM THE CUT ─────────────────────────────────────────────────────────────
  await part("F", async () => {
    const R = makeRoom({ levels: { [A]: 0, [B]: 0 } });
    R.play("$w1", 10, A); R.vote(B, "$w1", 12); R.vote(A, "$w1", 13);
    const d = makeTab(R, { name: "trimmed", me: B, heldFrom: 13 });
    R.post({ channel: "events_owner", sender: BOT, type: SUM, live: false, body: sumBody(d.RR, 9, { pi: "$w1", pos: 10 }, [[A, 1, 1], [B]]) });
    d.shortAt = 12.5;                   // the server ran out before the cut
    await d.enter();
    ok(d.rep(A) === null && d.rep(B) === null && d.st().ready === false,
      "F: THE PAGED STRETCH STOPPED SHORT OF THE CUT — nothing shown: a number now would miss B's vote", { a: d.rep(A), ready: d.st().ready });
    ok(d.said(/reading back from the cut stopped short at l=12\.5 — none shown yet; tried again/).length === 1, "F: and the log says so", d.logs);
    d.shortAt = null;
    await R.tick();
    ok(d.st().ready === true && d.rep(A) === 3 && d.rep(B) === 1, "F: read to the cut, the numbers — B's vote on A's playing and A's self-vote apart", { a: d.rep(A), b: d.rep(B) });
    ok(d.said(/^REP: showing REP from summary n=9 — 2 people \(read back from the cut, l=10 to l=12 \(\d+ event\(s\) paged\); \d+ vote\(s\) and save\(s\) counted forward\)$/).length === 1,
      "F: and says it is showing, and how it got there", d.said(/showing REP/));
    const u = makeTab(R, { name: "cannot say", me: A, heldFrom: undefined });
    await u.enter();
    ok(u.rep(A) === null && u.said(/none shown \(this tab cannot say where its log starts\)/).length === 1,
      "F: a tab that cannot say where its log starts shows nothing — never taken as holding everything", u.logs);
  });

  // ── H — THE LIFECYCLE ON EVERY TAB ────────────────────────────────────────────────────────────────────────────────────
  await part("G", async () => {
    const R = makeRoom({ levels: { [A]: 0, [B]: 0 } });
    R.play("$g1", 10, A);
    const d = makeTab(R, { name: "a device", me: B, may: false });
    R.post({ channel: "events_owner", sender: BOT, type: SUM, live: false, body: sumBody(d.RR, 9, { pi: "$g1", pos: 10 }, [[A, 0, 1], [B]]) });
    await d.enter();
    R.vote(B, "$g1", 11);
    await R.flush();
    ok(d.changed === 0, "G: NOTHING IS SAID BEFORE THE TAB SHOWS ANYTHING — still catching up, a vote raises no signal", d.changed);
    d.may = true; await R.tick();
    const atReady = d.changed;
    ok(atReady >= 1 && d.rep(A) === 2, "G: becoming ready raises it — the numbers appeared", { changed: atReady, a: d.rep(A) });
    R.vote(B, "$g1", 12);                                    // the same vote again: nothing moved
    await R.flush();
    ok(d.changed === atReady, "G: a reaction that changes nothing raises nothing", d.changed - atReady);
    R.save(B, "$g1", 13);
    await R.flush();
    ok(d.changed === atReady + 1 && d.rep(A) === 2, "G: A COUNTED SAVE RAISES IT AT ONCE — the People tab redraws within the second (ruling 35)", d.changed - atReady);
    R.post({ channel: "events_owner", sender: BOT, type: ADD, body: d.RR.addition({ of: d.st().sum.id, n: 9, k: 1, rows: [{ user: X, split: [0, 3] }] }) });
    await R.flush();
    ok(d.changed === atReady + 2 && d.rep(X) === 3, "G: an addition raises it", d.changed - atReady);
    ok(d.settingsL.length === 1, "G: PREMISE — it listens to the room's settings", d.settingsL.length);
    R.settings.repSelfSaves = true; for (const fn of d.settingsL) fn();
    ok(d.changed === atReady + 3, "G: and a settings change raises it — a switch moves numbers with no new summary", d.changed - atReady);
    const e = makeTab(R, { name: "another", me: X });
    await e.enter(); await e.leave(); await e.enter();
    ok(e.settingsL.length === 1, "G: it listens once a page, however often the tab enters a room", e.settingsL.length);
  });

  await part("H", async () => {
    const R = makeRoom({ levels: { [A]: 0 } });
    R.play("$v1", 10, A);
    const d = makeTab(R, { name: "a device", me: A });
    R.post({ channel: "events_owner", sender: BOT, type: SUM, live: false, body: sumBody(d.RR, 9, { pi: "$v1", pos: 10 }, [[A, 0, 4]]) });
    await d.enter();
    const st = d.st() || {};
    ok(st.spaceId === SID && st.timers.tick === true && d.reactL.length === 2 && d.rawL.length === 1,
      "H: H1 — on a tab that is not the bot, the reader starts: its tick, and its listeners for votes, saves and REP messages", st);
    ok(d.sb.RepBot._stateForTest() === null, "H: and the bot side does not", d.sb.RepBot._stateForTest());
    d.sb.Rep.enter({ spaceId: SID, channels: CH });
    ok((d.st() || {}).gen === st.gen && st.gen !== undefined && d.rep(A) === 4, "H: a rank change in the same room keeps it — the same session, its numbers kept", d.st());
    await d.leave("a guard's leave");
    const ticks = d.timers.filter((h) => h.live && h.ms === d.sb.RepReader.TICK_MS);
    ok(d.st() === null && d.reactL.length === 0 && d.rawL.length === 0 && ticks.length === 0 && d.rep(A) === null,
      "H: H2 — the leave stops it: no session, no listener, no tick, and no number", { st: d.st(), r: d.reactL.length, w: d.rawL.length, t: ticks.length });
    ok(d.said(/^REP: reader stopped — a guard's leave$/).length === 1, "H: and it says why", d.said(/stopped/));
    const n = makeTab(R, { name: "no room", me: A });
    n.entered = true; n.sb.Rep.enter({ spaceId: SID, channels: {} }); await R.flush();
    ok(n.st() === null && n.reactL.length === 0, "H: a room with no owner-level channel runs none of it", n.st());
  });

  _finished = true;
  if (failed) { console.log("[rep-reader] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[rep-reader] PASS — every device shows the bot's numbers, or none (J84-3, ruling 35; " + asserts + " assertions). ONE ROOM, THE REAL " +
    "BOT SIDE AND THE REAL READER ON EVERY TAB: the bot's tab, one holding everything, one trimmed under a save point, one joining " +
    "late and one opening fresh each show, for everyone the bot published, the bot's own number — its base plus what it counted " +
    "since the cut — and nobody else gets one, never a 0. COUNTED FORWARD from the cut by the same rules: a vote once, a late vote " +
    "on a closed playing never, a reaction held until song history shows its playing; the stretch between the cut and a held log " +
    "that starts above it paged, the `events` channels only. A SETTINGS CHANGE shows at once, everywhere, with no new summary; a " +
    "newer summary moves every cut. THE LOOK-BACK is twice the interval and follows it. TRUST: top-level, the owner-level channel, " +
    "a sender at 99 or above — another channel, a batch member, a sender below 99 and a relayed act's field are each ignored, " +
    "with a line; the higher serial wins, then the later position. NO SUMMARY, LEFT OUT, OR NOT YET READ TO THE CUT: nothing " +
    "shown, and the log says why. IN REAL TIME: it raises the generic \"the people view changed\" when what it shows moves, and " +
    "only then. The reader starts on every tab and stops at the leave. THIS GUARD RUNS STUBS OF THE APP: it " +
    "cannot see a real room's timing, only that the pieces agree on what they are handed");
})().catch((e) => { console.log("[rep-reader] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
