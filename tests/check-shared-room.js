#!/usr/bin/env node
// tests/check-shared-room.js
// SUBJECT: backends/backend1/history.js, backends/backend1/streammanager.js, backends/backend1/matrixbridge.js, features/rep-reader.js, features/rep-bot.js, features/rep-ports.js, features/room.js
//
// WALL: A SHARED ROOM, END TO END — EVERY SONG ENTERS SONG HISTORY AT ONCE, AND REP COUNTS FORWARD, THROUGH A SEAL, ITS TRIM,
// A RANK CHANGE AND A TAB HIDDEN AND SHOWN (J89, the owner's live run on `?v=537`, room "sharednew"; J97, `?v=545`).
//
// ── WHAT WAS FOUND LIVE ───────────────────────────────────────────────────────────────────────────────────────────────
//   1. A song started by a skip never entered song history (`ORDER ddjp.dj.skip l=37 … ACCEPTED`, then no `HISTORY` line;
//      the audit: "1 missing $IRH7… at l=37 — in an uncovered hole"). The skip was only the first advance after a RANK CHANGE:
//      the rewire (`Room._rewireWriteChannel` → `MatrixBridge.wireCheckpoints`) re-attached History with `awaitOpen`, which
//      closed its table, and only the room's opening opens it. Every song after any rewire — a rank change, a late channel,
//      an upgrade — by any advance, was lost.
//   2. REP counted nothing forward: the read-back from the summary's cut counted 0, though a self-vote on the cut's own song
//      was in it. `StreamManager.isLegal` answered `false` — "refused" — for an event the engine no longer held (trimmed by
//      the seal a second earlier) or never held (paged from the server), and REP takes `false` as refused.
//   3. (J90, `?v=538`) Song history kept the LOSER of a same-position race: two plays at l=67, the second to arrive first in
//      the room's order; "HISTORY 8 songs", then "9", and the audit's "1 extra $7FS82… at l=67 — from refresh".
//   4. (J90) The read-back's "0 vote(s) and save(s) counted forward" read as a failure: the vote on the cut's song had been
//      counted live already.
//
// ── WHAT THIS HOLDS, ALL DRIVEN (the real backend1 engine, History, the bridge, `features/room.js`, REP's real ports, reader
//    and bot side; the SDK client is the only double, `tests/_botroom.js`) ─────────────────────────────────────────────────
//   A  EVERY ADVANCE ENTERS HISTORY AT ONCE — a play, a skip and a media skip that start a song each add a row and the
//      `HISTORY` line at the event, before and after a RANK CHANGE delivered as the homeserver delivers it (a power-levels
//      state event → the room's rank listener → the real rewire), and after a second rewire (as an upgrade or a late channel
//      makes). A room change still closes the table until that room's open step.
//   B  LEGALITY HAS THREE ANSWERS — accepted `true`; held and refused `false`; not held — never ingested, or trimmed below a
//      floor — `null`, unknown.
//   C  REP, END TO END, ON TWO TABS (the owner's, and the bot's with the real bot side): a self-vote on the summary's own song,
//      trimmed by a seal before the summary arrives, is counted when each tab reads back from the cut; live votes on a later
//      song count; after a rank change, a song started by a skip enters history and its votes count. Every tab shows the bot's
//      own number for everyone it published.
//   D  WHY A REACTION DID NOT COUNT is said once per song: a vote on a song not in song history yet says it waits.
//   E  A SAME-POSITION RACE (J90, `?v=538`): two plays at one position, heard in either order, with and without a floor — song
//      history holds the play the room's order puts first and not the other ("1 extra $7FS82… — from refresh" live), and the
//      tab that had shown the loser says it left. On History itself: only refresh's own rows, inside the stretch it folded,
//      from a fold that ran.
//   F  THE BOT SIDE COUNTS WHAT IT PAGES (J90): a bot tab opening after a save point holds nothing below the floor, so what
//      it reads back from the room is unknown to its fold — the fill-back from a stored table, and the rebuild from its own
//      messages, count it (unknown is not refused).
//   G  THE BOT'S OWN TAB, AWAY AND BACK (J97, `?v=545`: its People numbers did not move until it reloaded): hidden through a song
//      change while others vote, then shown — the song enters its song history at once, its numbers move within one REP look and
//      equal the owner's tab, the bot side counts them too; away longer than twice the summary interval, nothing is given up, and
//      the next summary carries them to every tab; back, a live vote moves its numbers at once.
//
// ── WHAT IT DOES NOT HOLD ─────────────────────────────────────────────────────────────────────────────────────────────
//   · The live run's 2b — live votes on a song already in history that moved nobody's number — was NOT reproduced: replayed
//     event by event through these modules (both tabs, the seal, its trim), those votes count. Part C holds that they do; D
//     makes a live tab say why one does not.
//   · A homeserver's timing, and a browser's People tab drawing the numbers (`check-people-tab`, `check-rank-faces` D).
//   · A race a FLOOR settled by first arrival (J90 item 2): a seal made while one play of the race was still on its way banks
//     the other; that is consensus, reported to the owner and not changed here.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[shared-room] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const ORDER = B.ORDER.concat(["features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js", "features/rep-reader.js"]);
const CH = B.FULL_CH, SPACE = B.SPACE;
const OWNER = B.OWNER, BOT = B.BOT, STAFF = B.STAFF, VIP = B.VIP;
const MIN = 60000;

// ONE ROOM: its homeserver (shared by every tab of the story), its clock, its positions.
function room(t0, l0) {
  const R = { server: {}, now: t0 || 1792447900000, l: l0 || 0, n: 0, tabs: [] };
  R.raw = (sender, body, o) => {
    o = o || {};
    R.now += (o.dt !== undefined ? o.dt : 1000);
    const l = (o.l !== undefined) ? o.l : ++R.l;
    if (l > R.l) R.l = l;
    const ch = body.t === "ddjp.room.settings" ? CH.settings_owner : (sender === STAFF || sender === VIP ? CH.events_uncategorized : CH.events_owner);
    return { event_id: "$" + (o.id || ("e" + (++R.n))), type: "m.room.message", room_id: ch, sender: sender, origin_server_ts: R.now,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({}, body, { l: l })) } };
  };
  // Posted: onto the homeserver, and delivered live to every tab of the room, as `_ingestSpineEvent` does.
  R.post = (r) => { (R.server[r.room_id] = R.server[r.room_id] || []).push(r);
    for (const w of R.tabs) w.deliver(r, (r.sender === STAFF || r.sender === VIP) ? 0 : 99); return r; };
  R.put = (sender, body, o) => R.post(R.raw(sender, body, o));
  R.pi = (r) => r.event_id;
  return R;
}
// ONE TAB of the room: the real modules behind the real seam, REP loaded, its timers captured.
function tab(R, me, o) {
  o = o || {};
  const deep = B.deep;
  const bot = new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : (k === "actingAsBot" ? () => !!o.bot : (k === "mayOffer" ? () => ({ may: true, why: null }) : deep()))), apply: () => undefined });
  const w = B.world({ mode: "backend1", me: me, server: R.server, order: ORDER, fanOut: true, timers: true, extras: Object.assign({
    ServerClock: { serverNow: () => R.now, init() {}, destroy() {} },
    Store: { history: { load: async () => null, persist() {} }, config: { saveRoom() {} },
             rep: { load: async () => null, save: async () => true, loadPrefs: async () => null, savePrefs: async () => true, writerLock: async () => true } },
    BotRuntime: bot,
  }, o.extras || {}) });
  // The raw fan-out is recorded on the engine part after the seam filled its shell: the shell reads the recorded one too.
  w.sb.MatrixBridge.onRawEvent = w.sb.B1MatrixBridge.onRawEvent; w.sb.MatrixBridge.offRawEvent = w.sb.B1MatrixBridge.offRawEvent;
  w.hist = () => w.sb.History.count();
  w.histLines = () => w.logs.filter((m) => /^info: MatrixBridge: HISTORY \d+ songs/.test(m));
  w.rep = (u) => { const b = w.sb.Rep.badge(u); return b ? b.rep : null; };
  w.said = (re) => w.logs.filter((m) => re.test(m));
  w.fire = async () => { for (let i = 0; i < 3; i++) { w.timers.fire(1000); w.timers.fire(15000); await settle(15); } };
  R.tabs.push(w);
  return w;
}
// The settings a room makes, from the reducer's own defaults.
const settingsOf = (sb, over) => Object.assign({}, sb.StateDeriver.defaultSettings(), over || {});
// A seal by `w`, as `Checkpoint.seal` makes it, posted back to every tab at the next position.
async function seal(R, w) {
  const before = w.sent.length;
  await w.sb.Checkpoint.seal();
  const cp = w.sent.slice(before).filter((s) => s.t === "ddjp.checkpoint");
  for (const s of cp) R.post({ event_id: s.id, type: "m.room.message", room_id: s.roomId, sender: w.me, origin_server_ts: (R.now += 1000),
    content: { body: JSON.stringify(Object.assign({}, s.body, { l: ++R.l })) } });
  await settle();
  return cp.length;
}
// What the bot side sent since the last call, posted back to every tab (each at the next position).
async function relayBot(R, bw) {
  for (const s of bw.sent.filter((x) => /^ddjp\.side\.rep\./.test(x.t) && !x.posted)) {
    s.posted = true;
    R.post({ event_id: s.id, type: "m.room.message", room_id: s.roomId, sender: bw.me, origin_server_ts: (R.now += 500),
      content: { body: JSON.stringify(Object.assign({}, s.body, { l: ++R.l })) } });
  }
  await settle(15);
}
async function beat(R, bw) { for (let i = 0; i < 2; i++) { for (const w of R.tabs) await w.fire(); await relayBot(R, bw); } }
// The bot's own number for a person — its base plus what it counted since the cut, by the rules' own sums.
function truth(bw, u, settings) {
  const st = bw.sb.RepBot._stateForTest(), RR = bw.sb.RepRules;
  const add = RR.contributions(st.table.fwd);
  return RR.shown(RR.plus(st.table.base[u] || RR.zero(), add[u] || RR.zero()), settings).REP;
}

async function main() {
  // ── A — EVERY ADVANCE ENTERS HISTORY AT ONCE, BEFORE AND AFTER A RANK CHANGE ──────────────────────────────────────────
  {
    const levels0 = Object.assign({}, B.LEVELS);
    const R = room();
    const w = tab(R, STAFF);
    try {
      w.sb.Room._enterForTest({ name: SPACE, spaceId: SPACE, channels: Object.assign({}, CH) }, "backend1");
      await w.open();
      const reasons = Object.keys(w.sb.StateDeriver.BLOCKED_REASONS || {}).filter((k) => w.sb.StateDeriver.BLOCKED_REASONS[k].counts);
      R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(w.sb, { skipRoads: [{ guestPlus: 1, vipPlus: 0 }] }) });
      // Three DJs, each topped up before every advance (a buffer holds only a few), so every advance has a next song.
      let cur = null, vids = 0;
      const topUp = () => { for (const u of [OWNER, BOT, VIP]) R.put(u, { t: "ddjp.dj.join", v: ("vid" + String(++vids).padStart(8, "0")) }); };
      const advance = (kind, by) => {
        topUp();
        const h0 = w.hist(), lines0 = w.histLines().length;
        if (kind === "media") R.put(BOT, { t: "ddjp.play.blocked", pi: cur, k: reasons[0] }, { dt: 1000 });   // a block that counts toward the road
        const body = kind === "play" ? { t: "ddjp.dj.play", p: cur } : (kind === "skip" ? { t: "ddjp.dj.skip", p: cur } : { t: "ddjp.media.skip", p: cur });
        const r = R.put(by || OWNER, body, { dt: kind === "skip" ? 2000 : 20000 });
        const np = w.sb.StreamManager.getState().nowPlaying;
        const took = !!(np && np.pi === r.event_id);
        cur = took ? r.event_id : cur;
        return { took, rows: w.hist() - h0, line: w.histLines().length - lines0 };
      };
      ok(reasons.length > 0, "A: PREMISE — the reducer names a block reason that counts toward a skip road", reasons);
      const before = { play0: advance("play"), play: advance("play"), skip: advance("skip"), media: advance("media") };
      ok(Object.values(before).every((x) => x.took), "A: PREMISE — each advance was accepted and started a song", before);
      ok(Object.values(before).every((x) => x.rows === 1 && x.line === 1),
        "A: A PLAY, A SKIP AND A MEDIA SKIP EACH ENTER SONG HISTORY AT ONCE — a row and the HISTORY line at the event", before);
      // THE RANK CHANGE, as a homeserver delivers it: the power levels move, and the room's rank listener rewires.
      B.LEVELS[STAFF] = 99;   // promoted to the top rung: the channel it writes to, and so its rank, changes
      w.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => CH.events_owner, getContent: () => ({}) });
      ok(w.said(/Room: rank changed — now writing to .* \(rank 99\)$/).length === 1, "A: PREMISE — the rank change ran the room's real rewire", w.said(/rank changed/));
      const after = { play: advance("play"), skip: advance("skip"), media: advance("media") };
      ok(Object.values(after).every((x) => x.took), "A: PREMISE — after it, each advance was accepted too", after);
      ok(Object.values(after).every((x) => x.rows === 1 && x.line === 1),
        "A: AND AFTER A RANK CHANGE, EACH STILL ENTERS SONG HISTORY AT ONCE — live, the table stayed closed for the rest of the visit", after);
      w.sb.MatrixBridge.wireCheckpoints(w.sb.Room.getCurrent().channels);   // a second rewire, as a late channel or an upgrade makes
      const again = advance("skip");
      ok(again.took && again.rows === 1 && again.line === 1, "A: and after a second rewire (a late channel, an upgrade)", again);
      // A ROOM CHANGE STILL CLOSES IT until that room's open step (ddjp_564).
      w.sb.History.reset();
      const shut = w.sb.History.refresh();
      ok(shut && shut.deferred === "not-opened", "A: a room change closes the table until its open step — the reason the closing exists", shut);
      w.sb.History.markOpened();
      ok(!(w.sb.History.refresh() || {}).deferred, "A: and the open step opens it", null);
    } finally { for (const k of Object.keys(B.LEVELS)) delete B.LEVELS[k]; Object.assign(B.LEVELS, levels0); }
  }

  // ── B — LEGALITY HAS THREE ANSWERS ──────────────────────────────────────────────────────────────────────────────────
  {
    const R = room();
    const w = tab(R, OWNER);
    await w.open();
    R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(w.sb) });
    R.put(OWNER, { t: "ddjp.dj.join", v: "aaaaaaaaaaa" });
    const p1 = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    const v1 = R.put(STAFF, { t: "ddjp.dj.vote", p: p1.event_id });
    const bad = R.put(STAFF, { t: "ddjp.dj.vote", p: "$no-such-playing" });
    R.put(BOT, { t: "ddjp.dj.play", p: p1.event_id }, { dt: 5 * MIN });
    const SM = w.sb.StreamManager;
    ok(SM.isLegal(v1.event_id) === true && SM.isLegal(bad.event_id) === false,
      "B: HELD — the fold's answer: accepted `true`, refused `false` (a vote naming no playing)", { v1: SM.isLegal(v1.event_id), bad: SM.isLegal(bad.event_id) });
    ok(SM.isLegal("$never-seen") === null, "B: NEVER HELD — unknown, `null` (a device paging the room asks about such events)", SM.isLegal("$never-seen"));
    const sealed = await seal(R, w);
    ok(sealed === 1 && typeof SM.heldFrom() === "number" && SM.heldFrom() > JSON.parse(v1.content.body).l, "B: PREMISE — a seal, and the trim under it dropped the vote", { sealed, heldFrom: SM.heldFrom() });
    ok(SM.isLegal(v1.event_id) === null, "B: TRIMMED BELOW THE FLOOR — unknown, `null`, not refused (it answered `false`, and REP took that as refused)", SM.isLegal(v1.event_id));
  }
  {
    // HELD, BUT BELOW THE CUT OF THE FOLD THAT ANSWERS: a tab whose history does not reach the room's start (here the room's
    // first event this tab knows is l=8) folds from the floor's seed, above the cut, and still holds what is below it.
    const R = room(undefined, 7);
    const w = tab(R, OWNER);
    await w.open();
    R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(w.sb) });
    R.put(OWNER, { t: "ddjp.dj.join", v: "aaaaaaaaaaa" });
    const p1 = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    const v1 = R.put(OWNER, { t: "ddjp.dj.vote", p: p1.event_id });
    R.put(BOT, { t: "ddjp.dj.play", p: p1.event_id }, { dt: 5 * MIN });
    await seal(R, w);
    const SM = w.sb.StreamManager;
    ok(SM.getLog().some((e) => e.eventId === v1.event_id) && w.sb.History.coverage().complete === false,
      "B: PREMISE — the vote is still held, below the floor of a fold that starts above it", { held: SM.getLog().map((e) => e.l), cov: w.sb.History.coverage() });
    ok(SM.isLegal(v1.event_id) === null, "B: HELD BELOW THE FOLD'S CUT — unknown, `null`: the fold was never given it, so it did not refuse it", SM.isLegal(v1.event_id));
  }

  // ── C — REP, END TO END, ON THE OWNER'S TAB AND THE BOT'S ───────────────────────────────────────────────────────────
  {
    const R = room();
    const ow = tab(R, OWNER), bw = tab(R, BOT, { bot: true });
    for (const w of [ow, bw]) await w.open();
    const S = settingsOf(ow.sb, { repSelfVotes: true, repSummaryMs: 10 * MIN });
    R.put(OWNER, { t: "ddjp.room.settings", s: S });
    for (const w of [ow, bw]) w.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    await settle();
    // Song 1, the owner's, and the owner's self-vote on it; it ends with nothing next.
    R.put(OWNER, { t: "ddjp.dj.join", v: "s1s1s1s1s1s" });
    const s1 = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    const self1 = R.put(OWNER, { t: "ddjp.dj.vote", p: s1.event_id });
    R.put(BOT, { t: "ddjp.dj.play", p: s1.event_id }, { dt: 5 * MIN });
    // The seal and its trim, on both tabs, before the bot's first summary is heard.
    await seal(R, ow);
    const l1 = JSON.parse(self1.content.body).l;
    ok([ow, bw].every((w) => typeof w.sb.StreamManager.heldFrom() === "number" && w.sb.StreamManager.heldFrom() > l1),
      "C: PREMISE — the seal's trim dropped the self-vote on both tabs, as live (\"trimmed to floor l=16\")", [ow, bw].map((w) => w.sb.StreamManager.heldFrom()));
    await beat(R, bw);
    const sum = bw.sent.find((x) => x.t === "ddjp.side.rep.summary");
    ok(sum && sum.body.cut && sum.body.cut.pi === s1.event_id, "C: PREMISE — the bot's first summary is cut on song 1", sum && sum.body.cut);
    ok([ow, bw].every((w) => w.said(/REP: showing REP from summary n=\d+ — \d+ people \(.*; 1 newly counted, 0 already counted since the cut\)$/).length === 1),
      "C: THE SELF-VOTE ON THE CUT'S OWN SONG, TRIMMED BY THE SEAL, IS COUNTED when each tab reads back from the cut (live: 0)",
      [ow, bw].map((w) => w.said(/showing REP/)));
    // Song 2, the owner's, and live votes on it: the owner's own, a staff member's, the bot's.
    R.put(OWNER, { t: "ddjp.dj.join", v: "s2s2s2s2s2s" });
    const s2 = R.put(OWNER, { t: "ddjp.dj.play", p: null }, { dt: 2000 });
    for (const u of [OWNER, STAFF, BOT]) R.put(u, { t: "ddjp.dj.vote", p: s2.event_id });
    await beat(R, bw); await beat(R, bw);
    const who = [OWNER, STAFF, BOT];
    const want = who.map((u) => truth(bw, u, S));
    ok(want[0] === 2 + 2 + 2, "C: PREMISE — the bot counts the owner's two self-votes (+2 each, the setting on) and two votes received", want);
    const bad = (label) => [ow, bw].flatMap((w, i) => who.map((u, j) => ({ tab: i ? "bot" : "owner", u, got: w.rep(u), want: want[j] }))).filter((x) => x.got !== x.want);
    ok(bad().length === 0, "C: LIVE VOTES ON A LATER SONG COUNT, AND EVERY TAB SHOWS THE BOT'S OWN NUMBER for everyone it published", bad());
    // A rank change on both tabs (the rewire), then a song started by a SKIP, and votes on it.
    for (const w of [ow, bw]) w.sb.MatrixBridge.wireCheckpoints(CH);
    R.put(BOT, { t: "ddjp.dj.join", v: "s3s3s3s3s3s" });
    const h0 = [ow, bw].map((w) => w.hist());
    const s3 = R.put(OWNER, { t: "ddjp.dj.skip", p: s2.event_id }, { dt: 3000 });
    ok([ow, bw].every((w) => w.sb.StreamManager.getState().nowPlaying && w.sb.StreamManager.getState().nowPlaying.pi === s3.event_id),
      "C: PREMISE — the skip started song 3, the bot's", null);
    ok([ow, bw].every((w, i) => w.hist() === h0[i] + 1), "C: AFTER THE RANK CHANGE, THE SONG A SKIP STARTED ENTERS HISTORY AT ONCE, on both tabs", { before: h0, after: [ow, bw].map((w) => w.hist()) });
    for (const u of [OWNER, STAFF]) R.put(u, { t: "ddjp.dj.vote", p: s3.event_id });
    await beat(R, bw); await beat(R, bw);
    const want3 = who.map((u) => truth(bw, u, S));
    ok(want3[2] === want[2] + 2, "C: PREMISE — the bot counts the two votes the bot received on song 3", { before: want, after: want3 });
    const bad3 = [ow, bw].flatMap((w, i) => who.map((u, j) => ({ tab: i ? "bot" : "owner", u, got: w.rep(u), want: want3[j] }))).filter((x) => x.got !== x.want);
    ok(bad3.length === 0, "C: AND ITS VOTES COUNT ON EVERY TAB — live they could not, the song never being in history", bad3);
    // THE NEXT SUMMARY, cut on song 3, whose two votes and a save every tab already counted live: the read-back counts nothing
    // NEW, and says so in words that cannot read as a failure (J90: live, "0 vote(s) and save(s) counted forward" at 20:21:49).
    R.put(STAFF, { t: "ddjp.dj.save", p: s3.event_id });
    R.now += 2 * 10 * MIN + MIN;   // past one and a half intervals: a refresh, due at once (no song change waited for)
    await beat(R, bw); await beat(R, bw);
    const sum2 = bw.sent.filter((x) => x.t === "ddjp.side.rep.summary").pop();
    ok(sum2 && sum2 !== sum && sum2.body.cut && sum2.body.cut.pi === s3.event_id, "C: PREMISE — the bot's next summary is cut on song 3", sum2 && sum2.body.cut);
    const second = (w) => w.said(/REP: showing REP from summary n=\d+ — /).slice(1);
    ok([ow, bw].every((w) => second(w).length === 1 && / \(the held log reaches the cut; 0 newly counted, 3 already counted since the cut\)$/.test(second(w)[0])),
      "C: A READ-BACK THAT FINDS NOTHING NEW SAYS WHAT WAS ALREADY COUNTED SINCE THE CUT — votes and saves, \"0 newly counted, 3 already counted\", not \"0 … counted forward\"",
      [ow, bw].map(second));
  }

  // ── D — WHY A REACTION DID NOT COUNT, ONCE PER SONG ─────────────────────────────────────────────────────────────────
  {
    const R = room();
    const ow = tab(R, OWNER), bw = tab(R, BOT, { bot: true });
    for (const w of [ow, bw]) await w.open();
    R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(ow.sb, { repSummaryMs: 10 * MIN }) });
    for (const w of [ow, bw]) w.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    R.put(OWNER, { t: "ddjp.dj.join", v: "d1d1d1d1d1d" });
    const p = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    R.put(BOT, { t: "ddjp.dj.play", p: p.event_id }, { dt: 5 * MIN });
    await beat(R, bw);
    ok(ow.said(/REP: showing REP/).length === 1, "D: PREMISE — the owner's tab shows REP", ow.said(/REP:/));
    R.put(STAFF, { t: "ddjp.dj.vote", p: "$a-song-history-does-not-hold" });
    R.put(VIP, { t: "ddjp.dj.vote", p: "$a-song-history-does-not-hold" });
    const lines = ow.said(/REP: a vote on \$a-song-history-does-not-hold \(l=\d+, by @staff:hs\) is not counted — its song is not in song history yet; it waits$/);
    ok(lines.length === 1 && ow.said(/REP: .*a-song-history-does-not-hold/).length === 1,
      "D: A REACTION THAT CANNOT BE PLACED SAYS WHY, ONCE PER SONG — live, nothing on the page could say why numbers did not move", ow.said(/not counted/));
    // A REACTION THE ROOM'S FOLD REFUSED (J90, the supervisor's J89 check: this line had no test). A late vote on the summary's
    // own song, after a save point that banked the NEXT song: the song is in song history and at the cut, but the fold from
    // the floor's seed never saw it start, so it refuses the vote — every device alike — and the tab says so, once.
    R.put(OWNER, { t: "ddjp.dj.join", v: "d2d2d2d2d2d" });
    const q = R.put(OWNER, { t: "ddjp.dj.play", p: null }, { dt: 2000 });
    await seal(R, ow);
    const late = [R.put(STAFF, { t: "ddjp.dj.vote", p: p.event_id }), R.put(VIP, { t: "ddjp.dj.vote", p: p.event_id })];
    const SM = ow.sb.StreamManager;
    ok(ow.sb.History.recent().some((x) => x.pi === p.event_id) && SM.getState().nowPlaying.pi === q.event_id && late.every((v) => SM.isLegal(v.event_id) === false),
      "D: PREMISE — the song is in song history, and the fold refused the late votes on it", { legal: late.map((v) => SM.isLegal(v.event_id)) });
    const refused = ow.said(/^info: REP: a vote on \$\w+ \(l=\d+, by @staff:hs\) is not counted — the room's fold refused it$/);
    ok(refused.length === 1 && refused[0].indexOf(p.event_id) > 0 && ow.said(/the room's fold refused it/).length === 1,
      "D: A REACTION THE ROOM'S FOLD REFUSED SAYS SO, ONCE PER SONG", ow.said(/not counted/));
  }

  // ── F — THE BOT SIDE COUNTS WHAT IT PAGES (J90, the supervisor's J89 check) ─────────────────────────────────────────────
  // A bot tab opening a room after a save point holds nothing below the floor, so every reaction it reads back from the
  // server is one its fold was never given: `isLegal` answers null, unknown — and unknown is not refused. Live, the reader's
  // read-back was the one that counted nothing (J89); its bot-side twins, the fill-back and the rebuild, had no guard.
  const repStore = (load, keep) => ({ Store: { history: { load: async () => null, persist() {} }, config: { saveRoom() {} },
    rep: { load: async () => (load ? JSON.parse(JSON.stringify(load)) : null), save: async (sid, t) => { if (keep) keep.table = JSON.parse(JSON.stringify(t)); return true; },
           loadPrefs: async () => null, savePrefs: async () => true, writerLock: async () => true } } });
  const leaveRoom = (R, w) => { const i = R.tabs.indexOf(w); if (i >= 0) R.tabs.splice(i, 1); };
  {
    // THE FILL-BACK, WITH A STORED TABLE: from the table's cut to now.
    const R = room();
    const kept = { table: null };
    const ow = tab(R, OWNER), b1 = tab(R, BOT, { bot: true, extras: repStore(null, kept) });
    for (const w of [ow, b1]) await w.open();
    const S = settingsOf(ow.sb, { repSummaryMs: 10 * MIN });
    R.put(OWNER, { t: "ddjp.room.settings", s: S });
    for (const w of [ow, b1]) w.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    await settle();
    R.put(OWNER, { t: "ddjp.dj.join", v: "f1f1f1f1f1f" });
    const s1 = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    R.put(STAFF, { t: "ddjp.dj.vote", p: s1.event_id });
    R.put(BOT, { t: "ddjp.dj.play", p: s1.event_id }, { dt: 5 * MIN });   // song 1 ends, nothing next: the first summary goes
    await beat(R, b1);
    ok(kept.table && kept.table.cut && kept.table.cut.pi === s1.event_id, "F: PREMISE — the bot's table is stored, cut on song 1", kept.table && kept.table.cut);
    leaveRoom(R, b1);   // the bot's device goes away; the room goes on
    R.put(OWNER, { t: "ddjp.dj.join", v: "f2f2f2f2f2f" });
    const s2 = R.put(OWNER, { t: "ddjp.dj.play", p: null }, { dt: 2000 });
    const v2 = R.put(STAFF, { t: "ddjp.dj.vote", p: s2.event_id });
    await seal(R, ow);
    const b2 = tab(R, BOT, { bot: true, extras: repStore(kept.table) });
    await b2.open();
    b2.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    await beat(R, b2);
    ok(b2.sb.StreamManager.isLegal(v2.event_id) === null, "F: PREMISE — the reopened bot tab does not hold the vote on song 2: its fold answers unknown", b2.sb.StreamManager.isLegal(v2.event_id));
    const fill = b2.said(/^info: REP: filling back from l=\d+ /);
    const fwd = (b2.sb.RepBot._stateForTest().table || {}).fwd || { byPi: {} };
    ok(fill.length === 1 && / — [1-9]\d* event\(s\) paged, 1 vote\(s\) and 0 save\(s\) counted, 1 already counted$/.test(fill[0]) && !!(fwd.byPi[s2.event_id] && fwd.byPi[s2.event_id].v[STAFF]),
      "F: THE FILL-BACK COUNTS A VOTE IT PAGED FROM THE ROOM — unknown to its fold is not refused", { fill: fill, fwd: Object.keys(fwd.byPi) });
  }
  {
    // THE REBUILD, FROM ITS OWN MESSAGES: a person whose row is older than the newest summary earns what came between.
    const R = room();
    const ow = tab(R, OWNER);
    await ow.open();
    const RR = ow.sb.RepRules;
    R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(ow.sb, { repSummaryMs: 10 * MIN }) });
    ow.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    await settle();
    const posOf = (r) => JSON.parse(r.content.body).l;
    const said = (n, cut, user) => {   // a summary and its one addition, as the bot posted them before this device came
      const sum = R.put(BOT, Object.assign({ t: RR.TYPES.summary }, RR.summary({ n: n, cut: { pi: cut.event_id, pos: posOf(cut) }, rows: [] })));
      R.put(BOT, Object.assign({ t: RR.TYPES.addition }, RR.addition({ of: sum.event_id, n: n, k: 1, rows: [{ user: user, split: RR.zero() }] })));
    };
    R.put(VIP, { t: "ddjp.dj.join", v: "g1g1g1g1g1g" });
    const s1 = R.put(VIP, { t: "ddjp.dj.play", p: null });
    said(1792447001000, s1, VIP);                                   // the VIP named, cut on the VIP's song
    const v1 = R.put(OWNER, { t: "ddjp.dj.vote", p: s1.event_id });  // the VIP receives a vote on it
    R.put(OWNER, { t: "ddjp.dj.join", v: "g2g2g2g2g2g" });
    const s2 = R.put(OWNER, { t: "ddjp.dj.play", p: s1.event_id }, { dt: 5 * MIN });
    said(1792447002000, s2, OWNER);                                 // the newest summary names only the owner
    await seal(R, ow);
    const b3 = tab(R, BOT, { bot: true });
    await b3.open();
    b3.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    await beat(R, b3);
    ok(b3.sb.StreamManager.isLegal(v1.event_id) === null, "F: PREMISE — the rebuilding bot tab does not hold the vote on the VIP's song: unknown", b3.sb.StreamManager.isLegal(v1.event_id));
    const reb = b3.said(/^info: REP: rebuilt the table from its own messages within the window — /);
    const base = ((b3.sb.RepBot._stateForTest().table || {}).base || {})[VIP];
    ok(reb.length === 1 && / \(1 before the cut, each for its own people\)$/.test(reb[0]) && JSON.stringify(base) !== JSON.stringify(RR.zero()),
      "F: THE REBUILD COUNTS, FOR A PERSON WITH AN OLDER ROW, A VOTE IT PAGED FROM THE ROOM — unknown to its fold is not refused", { rebuilt: reb, base: base });
  }

  // ── E — A SAME-POSITION RACE: SONG HISTORY MATCHES THE FOLD, WHICHEVER PLAY ARRIVES FIRST (J90, `?v=538`) ──────────────────
  // Live: `ORDER ddjp.dj.play l=67 id=$7FS82… p=null … ACCEPTED`, a second later `… l=67 id=$5KpTB… p=null … ACCEPTED` (the
  // player switched), "HISTORY 8 songs" then "9 songs", and the audit: "1 extra $7FS82… at l=67 — from refresh". Two tabs, each
  // hearing the race in the other order; once without a floor (the fold from the room's start) and once after a seal (the
  // fold from the floor's seed, above its cut).
  for (const sealed of [false, true]) {
    const tag = sealed ? " (after a seal)" : " (no floor yet)";
    const R = room();
    const ow = tab(R, OWNER), bw = tab(R, BOT);
    for (const w of [ow, bw]) await w.open();
    R.put(OWNER, { t: "ddjp.room.settings", s: settingsOf(ow.sb) });
    R.put(OWNER, { t: "ddjp.dj.join", v: "e1e1e1e1e1e" });
    const s1 = R.put(OWNER, { t: "ddjp.dj.play", p: null });
    R.put(BOT, { t: "ddjp.dj.play", p: s1.event_id }, { dt: 5 * MIN });   // song 1 ends, nothing next
    if (sealed) await seal(R, ow);
    R.put(OWNER, { t: "ddjp.dj.join", v: "e2e2e2e2e2e" });
    R.put(BOT, { t: "ddjp.dj.join", v: "e3e3e3e3e3e" });
    // THE RACE: both name no parent, at one position. The room's order (position, then id) puts $5KpTB first.
    const at = ++R.l;
    const loser = R.raw(BOT, { t: "ddjp.dj.play", p: null }, { l: at, id: "7FS82race", dt: 2000 });
    const winner = R.raw(OWNER, { t: "ddjp.dj.play", p: null }, { l: at, id: "5KpTBrace", dt: 300 });
    for (const r of [loser, winner]) (R.server[r.room_id] = R.server[r.room_id] || []).push(r);
    const head = (w) => { const np = w.sb.StreamManager.getState().nowPlaying; return np ? np.pi : null; };
    const rows = (w) => w.sb.History.recent().map((r) => r.pi).sort();
    ow.deliver(loser, 99);
    const mid = { head: head(ow), rows: rows(ow) };
    ok(mid.head === loser.event_id && mid.rows.indexOf(loser.event_id) >= 0, "E: PREMISE" + tag + " — heard alone, the first play is the song and enters history", mid);
    ow.deliver(winner, 99);
    bw.deliver(winner, 99); bw.deliver(loser, 99);
    await settle();
    ok(sealed === (typeof ow.sb.StreamManager.heldFrom() === "number" && ow.sb.StreamManager.heldFrom() > JSON.parse(s1.content.body).l),
      "E: PREMISE" + tag + " — the fold is " + (sealed ? "from the floor's seed, above its cut" : "from the room's start"), ow.sb.StreamManager.heldFrom());
    ok([ow, bw].every((w) => head(w) === winner.event_id), "E: PREMISE" + tag + " — on both tabs the fold's song is the play the room's order puts first", [ow, bw].map(head));
    const want = [s1.event_id, winner.event_id].sort();
    ok([ow, bw].every((w) => JSON.stringify(rows(w)) === JSON.stringify(want)),
      "E: SONG HISTORY MATCHES THE FOLD, WHICHEVER PLAY ARRIVED FIRST" + tag + " — the race's loser leaves (live: kept, \"1 extra … from refresh\")",
      { owner: rows(ow), bot: rows(bw), want });
    const said = (w) => w.said(/^info: MatrixBridge: HISTORY — \$7FS82race at l=\d+ left song history: the room's fold no longer has its play \(another play at l=\d+ comes first in the room's order\)$/).length;
    ok(said(ow) === 1 && said(bw) === 0 && ow.said(/left song history/).length === 1, "E: AND IT IS SAID, ONCE, ON THE TAB THAT HAD SHOWN IT" + tag, { owner: ow.said(/left song history/), bot: bw.said(/left song history/) });
  }
  {
    // THE RULE'S BOUNDS, on History itself: only a row the live refresh wrote, only inside the stretch it folded, only from a
    // fold that ran. Rows other paths wrote are verify's to correct; below and above the stretch, the fold says nothing.
    const R = room();
    const w = tab(R, OWNER);
    await w.open();
    const H = w.sb.History, SD = w.sb.StateDeriver;
    const ev = (l, type, sender, content) => ({ eventId: "$b" + l, type: type, sender: sender, ts: 1792447900000 + l * 1000, l: l, senderRank: 99, content: Object.assign({ t: type }, content) });
    const seg = [ev(4, "ddjp.room.settings", OWNER, { s: settingsOf(w.sb) }), ev(5, "ddjp.dj.join", OWNER, { v: "b5b5b5b5b5b" }), ev(7, "ddjp.dj.play", OWNER, { p: null })];
    const row = (pi, l, src) => ({ pi: pi, l: l, src: src, videoId: "x", dj: OWNER, at: 1 });
    const table = () => [row("$below", 2, "refresh"), row("$verified", 5, "verify"), row("$gone", 6, "refresh"), row("$above", 9, "refresh")];
    H._setForTest(table());
    const r1 = H.ingest(seg, undefined, { src: "refresh", from: 4, to: 8 });
    const pis = () => H.recent().map((r) => r.pi).sort();
    ok(JSON.stringify(pis()) === JSON.stringify(["$above", "$b7", "$below", "$verified"]) && r1.removed.length === 1 && r1.removed[0].pi === "$gone",
      "E: ONLY A ROW REFRESH WROTE, INSIDE THE STRETCH IT FOLDED, LEAVES — another path's row stays, and so do rows below and above", { rows: pis(), removed: r1.removed });
    H._setForTest(table());
    const r2 = H.ingest(seg, undefined, { src: "backfill", from: 4, to: 8 });
    ok(pis().indexOf("$gone") >= 0 && !(r2.removed || []).length, "E: and only the live refresh removes — a backfill's stretch is not the held log", pis());
    H._setForTest(table());
    const keep = { both: SD.deriveBoth, derive: SD.derive };
    SD.deriveBoth = () => { throw new Error("planted"); }; SD.derive = () => { throw new Error("planted"); };
    try { H.ingest(seg, undefined, { src: "refresh", from: 4, to: 8 }); } finally { SD.deriveBoth = keep.both; SD.derive = keep.derive; }
    ok(pis().indexOf("$gone") >= 0, "E: and a fold that did not run removes nothing — an empty answer is not a room with no songs", pis());
  }

  // ── G — THE BOT'S OWN TAB, AWAY AND BACK (J97, the owner's `?v=545` run) ───────────────────────────────────────────────
  // Live: the bot's tab's People numbers did not move while the owner's and the user's did, until the bot's tab reloaded. A tab
  // that is hidden (or offline, or catching up) is not settled, and song history writes nothing until it is (`ddjp_562`): the
  // song a play started then was never written until the NEXT song change on a settled tab, and REP waits on song history for
  // every vote and save — the reader and the bot side alike. Driven with the browser's own signal (`visibilitychange`, as the
  // session hears it through the bridge) and the session's own settle.
  {
    const page = { hidden: false, visibilityState: "visible", fns: [] };
    page.addEventListener = (t, f) => { if (t === "visibilitychange") page.fns.push(f); };
    page.set = (hidden) => { page.hidden = hidden; page.visibilityState = hidden ? "hidden" : "visible"; for (const f of page.fns.slice()) f(); };
    const R = room();
    const ow = tab(R, OWNER), bw = tab(R, BOT, { bot: true, extras: { document: page } });
    for (const w of [ow, bw]) await w.open();
    const SS = bw.sb.Session;
    const S = settingsOf(ow.sb, { repSelfVotes: true, repSummaryMs: 10 * MIN });
    R.put(OWNER, { t: "ddjp.room.settings", s: S });
    for (const w of [ow, bw]) w.sb.Rep.enter({ spaceId: SPACE, channels: CH });
    let raised = 0;
    bw.sb.Room.onPeopleViewChange(() => { raised++; });
    await settle();
    const who = [OWNER, STAFF, VIP];
    let cur = null, k = 0;
    const song = (dt) => {
      R.put(OWNER, { t: "ddjp.dj.join", v: ("g" + (++k)).padEnd(11, "x") });
      cur = R.put(OWNER, { t: "ddjp.dj.play", p: cur ? cur.event_id : null }, { dt: dt || 4 * MIN });
      return cur;
    };
    const votes = () => { R.put(STAFF, { t: "ddjp.dj.vote", p: cur.event_id }); R.put(VIP, { t: "ddjp.dj.vote", p: cur.event_id }); };
    const nums = (w) => JSON.stringify(who.map((u) => w.rep(u)));
    const mine = () => JSON.stringify(who.map((u) => truth(bw, u, S)));
    const inHistory = (w, p) => w.sb.History.recent().some((x) => x.pi === p.event_id);
    // ONE REP LOOK: a second passes and the one-second timers fire — not the 15-second tick.
    const look = async () => { R.now += bw.sb.RepReader.SOON_MS; bw.timers.fire(bw.sb.RepReader.SOON_MS); await settle(15); };
    // The bot's tab hidden; a song starts and is voted on; `min` minutes pass, every timer running; the tab is shown and settles.
    const away = async (min) => {
      page.set(true);
      const p = song();
      votes();
      const at = { phase: SS.phase(), hist: inHistory(bw, p), owner: nums(ow), bot: nums(bw) };
      for (let t = 0; t < min; t++) { R.now += MIN; for (const w of R.tabs) { w.timers.fire(1000); w.timers.fire(15000); } await settle(5); }
      page.set(false);
      for (let i = 0; i < 60 && SS.phase() !== SS.LIVE; i++) { await settle(25); SS._beatForTest(); }
      return Object.assign(at, { p: p, live: SS.phase() === SS.LIVE });
    };
    song(); votes(); await beat(R, bw);
    song(); votes(); await beat(R, bw); await beat(R, bw);
    ok(bw.sb.RepReader._stateForTest().ready && nums(bw) === nums(ow) && JSON.parse(nums(ow)).every((n) => typeof n === "number"),
      "G: PREMISE — both tabs show REP from the bot's summary, the same numbers", { owner: nums(ow), bot: nums(bw) });
    const a = await away(2);
    ok(a.phase === SS.SUSPENDED && a.hist === false && a.owner !== a.bot,
      "G: PREMISE — while the bot's tab is hidden, the owner's tab counts the votes at once, and the bot tab's song history does not " +
      "take the song (nothing is written until the tab is settled)", a);
    ok(a.live, "G: PREMISE — shown, the bot's tab settles: live again", SS.phase());
    ok(inHistory(bw, a.p), "G: SHOWN AGAIN, THE SONG ENTERS THE BOT TAB'S SONG HISTORY AT ONCE — no song change needed (live: only at the next " +
      "song change on a settled tab, or a reload)", bw.sb.History.recent().map((x) => x.pi));
    const r0 = raised;
    await look();
    ok(nums(bw) === nums(ow) && raised > r0,
      "G: AND WITHIN ONE REP LOOK THE BOT TAB'S NUMBERS MOVE — the votes held while it was away counted, equal to the owner's tab, and the " +
      "People tab told to redraw (live: stale until the reload)", { owner: nums(ow), bot: nums(bw), raised: raised - r0 });
    ok(mine() === nums(ow), "G: and the bot side counted them too", { bot: mine(), owner: nums(ow) });
    // AWAY LONGER THAN TWICE THE SUMMARY INTERVAL: a held reaction is given up after that ("its song never reached song history")
    // — but a tab that was not settled could not have written the song, so its absence then proves nothing.
    const summaries = () => bw.sent.filter((x) => x.t === "ddjp.side.rep.summary");
    const sums = summaries().length;
    const b = await away(25);
    await look();
    ok(b.live && inHistory(bw, b.p) && nums(bw) === nums(ow) && mine() === nums(ow),
      "G: AWAY LONGER THAN TWICE THE SUMMARY INTERVAL, THE VOTES STILL COUNT — on the bot's reader and in the bot side's own count " +
      "(given up before: \"its song never reached song history\")", { owner: nums(ow), bot: nums(bw), botSide: mine() });
    await beat(R, bw); await beat(R, bw);
    const last = summaries().pop(), adopted = ow.sb.RepReader._stateForTest().sum;
    ok(summaries().length > sums && last.body.cut.pi === b.p.event_id && adopted && adopted.id === last.id && nums(ow) === mine() && nums(bw) === mine(),
      "G: AND THE BOT'S NEXT SUMMARY, CUT ON THAT SONG, CARRIES THEM TO EVERY TAB — nobody's number drops when the tabs adopt it",
      { cut: last && last.body.cut, adopted: adopted, owner: nums(ow), bot: nums(bw), botSide: mine() });
    const r1 = raised;
    votes();
    R.put(OWNER, { t: "ddjp.dj.vote", p: cur.event_id });
    ok(nums(bw) === nums(ow) && raised > r1, "G: BACK AND SETTLED, A LIVE VOTE MOVES THE BOT TAB'S NUMBERS AT ONCE", { owner: nums(ow), bot: nums(bw) });
  }

  if (failed) { console.log("[shared-room] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[shared-room] PASS — a shared room, end to end: every song enters song history at once, and REP counts forward through a " +
    "seal, its trim and a rank change; song history matches the fold through a same-position race (J89, J90; " + asserts + " assertions). ALL DRIVEN on the real backend1 engine, History, the bridge, the " +
    "room and REP's real reader and bot side. A PLAY, A SKIP AND A MEDIA SKIP each add a row and the HISTORY line at the event — before " +
    "and after a rank change delivered as a power-levels event through the room's real rewire, and after a second rewire; a room change " +
    "still closes the table until its open step. LEGALITY: accepted true, held and refused false, not held — never seen, or trimmed " +
    "below a floor — null. REP ON TWO TABS: the self-vote on the summary's own song, trimmed before the summary, counted when each tab " +
    "reads back from the cut; live votes on a later song counted; after a rank change, a skip's song in history at once and its votes " +
    "counted; every tab shows the bot's own number; a read-back that finds nothing new says what was already counted since the cut. A " +
    "reaction that cannot be placed, or that the fold refused, says why, once per song. A SAME-POSITION RACE, heard in either order, with " +
    "and without a floor: history holds the play the room's order puts first, and the loser leaves, said once. THE BOT SIDE counts what " +
    "it pages — the fill-back from a stored table and the rebuild from its own messages. THE BOT'S OWN TAB, HIDDEN AND SHOWN (J97): " +
    "the song a play started while it was not settled enters its song history at once when it is, its numbers move within one REP " +
    "look and equal the owner's, nothing held is given up while it was away, and the next summary carries it all. NOT HELD: the live run's " +
    "votes on a song already in history that moved nobody's number did not reproduce here, replayed event by event");
}
main().catch((e) => { console.log("[shared-room] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
